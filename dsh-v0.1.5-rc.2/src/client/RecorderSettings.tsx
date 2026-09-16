/**
 * 「录音卡后端」页 —— 环境、配置与蓝牙操作。
 *
 * 整页布局（原先是设置页里的一张卡）：环境 → 配置 → 蓝牙 → 实时文本流。
 * 录音库已拆到独立页面（recorder:library），这里不再列会话。
 */
import * as React from 'react'
import {
  eventsUrl,
  fmtAgo,
  fmtBattery,
  fmtBytes,
  fmtRssi,
  get,
  knownDevices,
  post,
  startScan,
  stopScan,
  type BleStatus,
  type DeviceEntry,
  type FunasrStatus,
  type KnownDevice,
  type RuntimeConfig,
} from './api.js'
import { Btn, C, Chip, ErrorBar, Field, Grid, Loading, Muted, NumberInput, Panel, Row, Select, Switch } from './ui.js'

const mono = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

/** 功能键 → 中文名（用于「本预设不支持」的说明） */
const FEATURE_LABEL: Record<string, string> = {
  vad: 'VAD 断句',
  punc: '标点恢复',
  spk: '说话人分离',
  language: '语种选择',
  realtime: '实时转写',
  hotword: '热词表',
  timestamps: '时间戳',
}
export function RecorderSettings(): React.ReactElement {
  const [status, setStatus] = React.useState<FunasrStatus | null>(null)
  /** 后处理：配置 + 提示词模板 */
  const [pp, setPp] = React.useState<{
    config: { enabled: boolean; templateId: string; conversationId: string; mode: 'auto' | 'confirm' }
    templates: Array<{ id: string; name: string; summary: string; builtin: boolean; body: string }>
    /**
     * 手动确认模式下待发送的合并消息（一轮同步 = 一条）。
     * **可选**：热装切换的瞬间可能取到旧实例的响应，那时没有这个键。
     */
    pending?: {
      at: string
      templateName: string
      items: Array<{ name: string; title: string }>
      text: string
    } | null
    /** 待确认队列长度（>1 说明还有上一轮没处理） */
    pendingCount?: number
  } | null>(null)
  /** DSH 会话列表（供「转向对话」挑选） */
  const [dshSessions, setDshSessions] = React.useState<
    Array<{ sessionId: string; title: string; running: boolean; updatedAt: number }>
  >([])
  /** 正在编辑/查看的模板 id（null = 只看列表） */
  const [tplEdit, setTplEdit] = React.useState<string | null>(null)
  const [tplDraft, setTplDraft] = React.useState<{ name: string; summary: string; body: string } | null>(null)
  /** 预设与环境组件（按当前预设过滤后展示） */
  const [presets, setPresets] = React.useState<{
    presets: Array<{
      id: string
      label: string
      summary: string
      needs: string[]
      features: string[]
      languages: string[]
      limits?: Record<string, string>
      reference?: boolean
    }>
    active: string
    needed: string[]
    /** 用户还想要哪些预设 —— 卸载时按引用计数判定共用组件是否可回收 */
    enabled: string[]
    /** 每个预设的卸载计划：会删什么、会保留什么 */
    uninstallPlans: Array<{
      presetId: string
      label: string
      remove: string[]
      keep: Array<{ key: string; stillNeededBy: string[] }>
      summary: string
    }>
    envs: Array<{
      key: string
      label: string
      detail: string
      shared: boolean
      installed: boolean | null
      bytes: number | null
      canUninstall: boolean
      blockedBy: string[]
      message: string
    }>
  } | null>(null)

  const refreshPresets = React.useCallback(async () => {
    try {
      setPresets(await get<NonNullable<typeof presets>>('/presets'))
    } catch {
      /* 预设接口失败不影响其他区域 */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const uninstallEnv = React.useCallback(
    async (key: string) => {
      await run(`uninstall-${key}`, async () => {
        const r = await post<{ result: { message: string } }>('/env/uninstall', { key })
        setMsg(r.result.message)
        await refreshPresets()
        await refreshStatus(true)
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refreshPresets],
  )
  /** Qwen3-ASR 独立环境状态（接口单独上报，以前界面没显示） */
  const [qwen, setQwen] = React.useState<FunasrStatus['qwen'] | undefined>(undefined)
  const [cfg, setCfg] = React.useState<RuntimeConfig | null>(null)
  const [ble, setBle] = React.useState<BleStatus | null>(null)
  const [knownList, setKnownList] = React.useState<KnownDevice[]>([])
  const [files, setFiles] = React.useState<DeviceEntry[]>([])
  /** 是否已经查过设备文件列表——用来区分「还没查」与「查了但卡是空的」 */
  const [filesQueried, setFilesQueried] = React.useState(false)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [msg, setMsg] = React.useState<string | null>(null)
  const [err, setErr] = React.useState<string | null>(null)
  const [partial, setPartial] = React.useState('')
  const [liveSession, setLiveSession] = React.useState<string | null>(null)
  const esRef = React.useRef<EventSource | null>(null)

  const run = React.useCallback(async (tag: string, fn: () => Promise<void>) => {
    setBusy(tag)
    setErr(null)
    try {
      await fn()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }, [])

  // probe=false 走 host 缓存（瞬时）；probe=true 才真去探测（会给 Python worker 发命令，慢）
  const refreshStatus = React.useCallback(async (probe = false) => {
    const r = await get<{ status: FunasrStatus; qwen?: FunasrStatus['qwen'] }>(
      probe ? '/asr/status?probe=1' : '/asr/status',
    )
    setStatus(r.status)
    // Qwen3 是独立环境，以前接口有返回、界面却从没显示过 ——
    // 于是用户在看「识别环境」时根本找不到 Qwen3-ASR 这一项
    if (r.qwen !== undefined) setQwen(r.qwen)
  }, [])

  /** 当前预设 */
  const activePreset = presets?.presets.find((p) => p.id === presets.active)
  /** 当前预设是否支持某个功能开关 */
  const feat = (k: string): boolean => {
    if (!activePreset) return true // 预设数据没拉到时不误伤，按支持处理
    return activePreset.features.includes(k)
  }
  /** 当前预设不支持的功能 + 原因 */
  const unsupported: Array<[string, string]> = activePreset
    ? Object.entries(activePreset.limits ?? {}).filter(([k]) => !activePreset.features.includes(k))
    : []
  // 有组件还是「检测中」（installed === null）时，过几秒自动重拉一次：
  // FunASR 运行环境要靠一次真实探测才能确认，插件挂载后约 6 秒才出结果。
  // 不自动重拉的话面板会一直停在「检测中」。
  const hasUnknown =
    presets !== null && presets.envs.some((e) => e.installed === null && presets.needed.includes(e.key))
  React.useEffect(() => {
    if (!hasUnknown) return
    const t = window.setTimeout(() => void refreshPresets(), 4000)
    return () => window.clearTimeout(t)
  }, [hasUnknown, refreshPresets])
  const refreshConfig = React.useCallback(async () => {
    const r = await get<{ config: RuntimeConfig }>('/config')
    setCfg(r.config)
  }, [])

  /** 完全卸载一个预设：按引用计数回收它独占的组件 */
  const uninstallPresetAction = React.useCallback(
    async (presetId: string) => {
      await run(`uninstall-preset-${presetId}`, async () => {
        const r = await post<{ result: { message: string } }>('/env/uninstall-preset', { presetId })
        setMsg(r.result.message)
        await refreshPresets()
        await refreshConfig()
        await refreshStatus(true)
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refreshPresets, refreshConfig],
  )

  const refreshPostProcess = React.useCallback(async () => {
    try {
      setPp(await get<NonNullable<typeof pp>>('/post-process'))
    } catch {
      /* 后处理接口失败不影响其他区域 */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 手动确认模式下轮询「待确认」。
  //
  // 没有这个轮询的话，同步完成后主机把消息放进了待确认队列，但界面只在挂载时
  // 拉过一次 /post-process —— 那个块永远不会出现，手动确认模式等于失效。
  // 只在「已启用 + 手动确认」时轮询，其余情况不打扰后端。
  const ppNeedsPoll = pp?.config.enabled === true && pp.config.mode === 'confirm'
  React.useEffect(() => {
    if (!ppNeedsPoll) return
    const t = window.setInterval(() => void refreshPostProcess(), 3000)
    return () => window.clearInterval(t)
  }, [ppNeedsPoll, refreshPostProcess])

  const refreshDshSessions = React.useCallback(async () => {
    try {
      const r = await get<{
        items: Array<{
          sessionId: string
          running?: boolean
          updatedAt?: number
          projections?: { values?: { title?: string | null } }
        }>
      }>('/dsh/sessions')
      setDshSessions(
        (r.items ?? []).map((x) => ({
          sessionId: x.sessionId,
          title: x.projections?.values?.title ?? '',
          running: x.running === true,
          updatedAt: x.updatedAt ?? 0,
        })),
      )
    } catch {
      /* 内核没给 sessionController 时静默降级 */
    }
  }, [])

  const patchPostProcess = React.useCallback(
    async (next: Partial<NonNullable<typeof pp>['config']>) => {
      // **只发变更的字段**，绝不展开本地 pp.config。
      // 展开是个正反馈陷阱：一旦主机侧的 postProcess 被污染成「整份配置」，
      // /post-process 返回的 config 就是整份配置，这里再展开送回去，
      // 每点一次开关就多嵌一层，最终把配置写成递归结构。
      await post('/config', { postProcess: next })
      // **不要用响应里的 config**：POST /config 返回的是**整份 RuntimeConfig**，
      // 而 GET /post-process 返回的 config 只是 postProcess 那 4 个字段。
      // 之前把响应直接塞进 pp.config，于是一次点击后 pp.config.enabled 就成了
      // undefined —— 开关永远显示关闭，关了再也打不开（主机其实存对了）。
      // 这里只合并刚发出去的字段，形状永远正确。
      setPp((cur) => (cur ? { ...cur, config: { ...cur.config, ...next } } : cur))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pp],
  )
  const refreshBle = React.useCallback(async () => {
    setBle(await get<BleStatus>('/ble/status'))
  }, [])

  const scan = ble?.scan
  const scanned = scan?.devices ?? []
  const scanMsg = scan?.message ?? null

  // 常驻轮询 BLE 状态。
  //
  // 以前**只在扫描时才轮询**，于是后台自动重连成功的那一刻界面根本不会重新拉状态——
  // 「已连接」标签一直停在旧值上，用户完全感知不到连上了（这正是「哪怕连上了也没感觉」的根因）。
  // 现在无论是否扫描都轮询，扫描期间加快到 1.2s 让设备列表长得更跟手。
  React.useEffect(() => {
    let alive = true
    const tick = () => {
      void refreshBle().catch(() => undefined)
      if (!alive) return
    }
    const ms = scan?.running ? 800 : 1200
    const t = window.setInterval(tick, ms)
    return () => {
      alive = false
      window.clearInterval(t)
    }
  }, [scan?.running, refreshBle])

  // 状态从「未连接」翻到「已连接」时提示一次——自动重连是后台发生的，
  // 不主动说一声用户不知道已经连上了
  const wasConnected = React.useRef(false)
  React.useEffect(() => {
    const now = ble?.connected === true
    if (now && !wasConnected.current) {
      setMsg(`已连接 ${ble?.address ?? ''}${ble?.battery != null ? ` · 电量 ${fmtBattery(ble.battery)}` : ''}`)
    }
    wasConnected.current = now
  }, [ble?.connected, ble?.address, ble?.battery])

  // 扫描结束后把「连过的设备」缓存拉一次，用于底部提示
  React.useEffect(() => {
    void knownDevices()
      .then((r) => setKnownList(r.items ?? []))
      .catch(() => undefined)
  }, [scan?.running, ble?.connected])

  React.useEffect(() => {
    void run('init', async () => {
      await Promise.all([
        refreshStatus(),
        refreshConfig(),
        refreshPresets(),
        refreshPostProcess(),
        refreshDshSessions(),
      ])
      // 后台把 BLE 守护进程拉起来。
      //
      // 原来是懒启动（点了「扫描设备」才起），于是面板默认显示「BLE 守护进程未启动」——
      // 这状态没错，但对用户是纯噪音：蓝牙功能全依赖它，用户还得猜「大概点一下就会启动」。
      // 启动只要 0.3 秒，放到挂载后异步做，不阻塞首屏。
      void post('/ble/setup', {})
        .then(() => refreshBle())
        .catch(() => undefined)
      await refreshBle().catch(() => undefined)
    })
  }, [run, refreshStatus, refreshConfig, refreshBle])

  // 实时逐字：SSE
  React.useEffect(() => {
    if (!liveSession) {
      esRef.current?.close()
      esRef.current = null
      return
    }
    const es = new EventSource(eventsUrl(liveSession))
    esRef.current = es
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data)
        if (data.type === 'partial') setPartial(data.partial ?? '')
        else if (data.type === 'segment') setPartial(data.transcript ?? '')
        else if (data.type === 'hello') setPartial(data.partial || data.transcript || '')
        else if (data.type === 'closed') setPartial(data.record?.transcript ?? '')
      } catch {
        /* 忽略非 JSON 帧 */
      }
    }
    return () => {
      es.close()
      esRef.current = null
    }
  }, [liveSession])

  const patch = (p: Partial<RuntimeConfig>) =>
    run('cfg', async () => {
      const r = await post<{ config: RuntimeConfig }>('/config', p)
      setCfg(r.config)
    })

  if (!cfg && !status) return <Loading text="正在检测识别环境…" />

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: C.bg1, color: C.ink }}>
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '18px 20px 40px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <ErrorBar text={err} onClose={() => setErr(null)} />

        {/* ───────── 识别环境 ───────── */}
        <Panel
          title="识别环境（FunASR）"
          extra={
            <Row>
              <Chip tone={status?.ready ? 'ok' : 'warn'}>{status?.ready ? '就绪' : '未就绪'}</Chip>
              <Chip tone={status?.cudaAvailable ? 'ok' : 'neutral'}>
                {status?.cudaAvailable ? `CUDA · ${status.cudaDeviceName ?? ''}` : 'CPU'}
              </Chip>
            </Row>
          }
        >
          {!status ? (
            <Loading />
          ) : (
            <>
              <Muted>
                Python {status.pythonVersion ?? '?'} · funasr {status.funasrVersion ?? '未装'} · torch{' '}
                {status.torchVersion ?? '未装'}
              </Muted>
              <Muted style={{ wordBreak: 'break-all', marginTop: 2 }}>模型目录：{status.modelDir}</Muted>

              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '10px 0' }}>
                {status.models.map((m) => (
                  <Chip
                    key={m.key}
                    tone={m.ready ? 'ok' : 'warn'}
                    title={
                      m.partial
                        ? `${m.path}\n目录存在但里面没有权重文件——下载可能被打断，请重新「安装 / 修复环境」`
                        : m.path
                    }
                  >
                    {m.label}
                    {m.partial ? '（不完整）' : ''}
                  </Chip>
                ))}
              </div>

              {/* 依赖的**真实导入**体检：包版本元数据在、import 却失败，是最隐蔽的一种坏法。
                  以前这里会显示「全部就绪」而识别其实已经全线失效。 */}
              {status.deps && Object.values(status.deps).some((d) => !d.ok) && (
                <div style={{ fontSize: 12, color: C.danger, lineHeight: 1.8, marginBottom: 6 }}>
                  ⚠ 依赖导入失败（识别会不可用）：
                  {Object.entries(status.deps)
                    .filter(([, d]) => !d.ok)
                    .map(([k, d]) => (
                      <div key={k} style={{ paddingLeft: 10, wordBreak: 'break-all' }}>
                        <b>{k}</b>：{d.error}
                      </div>
                    ))}
                  <div style={{ paddingLeft: 10 }}>
                    执行「安装 / 修复环境」可修复（会一并升级 modelscope-hub——那是常见的版本错配来源）。
                  </div>
                </div>
              )}

                            {/* ───── 识别环境：每个组件一张紧凑卡片 ───── */}
              {presets && (
                <div style={{ margin: '10px 0', borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
                  <Row>
                    <b style={{ fontSize: 12 }}>识别环境</b>
                    <Muted>
                      「{presets.presets.find((p) => p.id === presets.active)?.label ?? presets.active}」需要{' '}
                      {presets.needed.length} 个组件
                    </Muted>
                  </Row>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                    {presets.envs
                      .filter((x) => presets.needed.includes(x.key))
                      .map((x) => {
                        const busyKey = `uninstall-${x.key}`
                        const tone = x.installed === null ? C.brand : x.installed ? C.ok : C.ink3
                        const short = x.label.replace(/（[^）]*）/g, '').trim()
                        return (
                          <div
                            key={x.key}
                            title={`${x.label}\n${x.detail}${
                              x.installed === true && !x.canUninstall ? `\n\n${x.message}` : ''
                            }`}
                            style={{
                              border: `1px solid ${C.border}`,
                              borderRadius: 6,
                              padding: '4px 8px',
                              background: C.bg2,
                              fontSize: 11,
                              maxWidth: 210,
                              lineHeight: 1.5,
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                              <span style={{ color: tone, fontSize: 10 }}>●</span>
                              <span
                                style={{
                                  fontWeight: 600,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {short}
                              </span>
                              {x.bytes !== null && (
                                <span style={{ marginLeft: 'auto', color: C.ink3, flexShrink: 0 }}>
                                  {fmtBytes(x.bytes)}
                                </span>
                              )}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: C.ink3 }}>
                              <span>
                                {x.installed === null
                                  ? '检测中…'
                                  : x.installed
                                    ? x.canUninstall
                                      ? '已安装'
                                      : '使用中'
                                    : '未安装'}
                              </span>
                              {x.installed === true && x.canUninstall && (
                                <Btn
                                  disabled={busy !== null}
                                  onClick={() => void uninstallEnv(x.key)}
                                  title={x.message}
                                >
                                  {busy === busyKey ? '…' : '卸载'}
                                </Btn>
                              )}
                            </div>
                          </div>
                        )
                      })}
                  </div>
                </div>
              )}
              <Row style={{ marginTop: 10 }}>
                <Btn
                  primary
                  disabled={busy !== null}
                  onClick={() =>
                    void run('install', async () => {
                      setMsg('安装中（首次可能需要几分钟到十几分钟）…')
                      try {
                        const r = await post<{
                          status: FunasrStatus
                          qwen?: FunasrStatus['qwen']
                          steps?: Array<{ stage: string; message: string; ok: boolean }>
                        }>('/asr/install', {})
                        // 返回里带着 qwen，以前被丢掉 → 装完 Qwen 那块永远不更新
                        if (r.qwen !== undefined) setQwen(r.qwen)
                        if (r.status) setStatus(r.status)
                        await refreshStatus(true)
                        const failedSteps = (r.steps ?? []).filter((s) => !s.ok)
                        setMsg(
                          failedSteps.length
                            ? `安装结束，但有步骤失败：${failedSteps.map((s) => s.message).join('；')}`
                            : '安装 / 修复完成，环境已就绪',
                        )
                      } catch (e) {
                        setMsg(`安装失败：${e instanceof Error ? e.message : String(e)}`)
                        throw e
                      }
                    })
                  }
                >
                  {busy === 'install' ? '安装中…' : '安装 / 修复环境'}
                </Btn>
                {/* 完全卸载此预设：卸载 = 「我不想再用它了」，
                    它独占的组件会被删；与其他预设共用的会被保留（引用计数） */}
                <Btn
                  danger
                  disabled={busy !== null || !presets}
                  title={
                    presets?.uninstallPlans.find((x) => x.presetId === presets.active)?.summary ??
                    '卸载当前预设及其独占的环境组件'
                  }
                  onClick={() => {
                    const plan = presets?.uninstallPlans.find((x) => x.presetId === presets.active)
                    if (plan) void uninstallPresetAction(plan.presetId)
                  }}
                >
                  {busy?.startsWith('uninstall-preset-') ? '卸载中…' : '完全卸载此预设'}
                </Btn>
                <Btn
                  disabled={busy !== null}
                  onClick={() =>
                    void run('recheck', async () => {
                      await refreshStatus(true)
                      // 必须同时重拉预设数据：环境组件的「已安装/未安装」来自 /presets，
                      // 只刷 /asr/status 的话，那些状态会永远停在页面挂载时的值
                      // （而挂载那一刻预热还没跑完，FunASR 运行环境会被记成「未安装」）。
                      await refreshPresets()
                    })
                  }
                >
                  重新检测
                </Btn>
                {msg && <Muted>{msg}</Muted>}
              </Row>
            </>
          )}
        </Panel>

        {/* ───────── 运行配置 ───────── */}
        {cfg && (
          <Panel title="运行配置">
            <Grid cols="auto 1fr auto 1fr">
              <Field label="识别模型">
                <Select
                  value={cfg.asrModel}
                  onChange={(v) => {
                        patch({ asrModel: v as RuntimeConfig['asrModel'] })
                        // 换预设后「识别环境」显示什么、哪些能卸载都会变
                        void refreshPresets()
                      }}
                  options={[
                    { value: 'paraformer-zh', label: 'Paraformer-large（中文高精度）' },
                    { value: 'sensevoice', label: 'SenseVoiceSmall（多语种·快速）' },
                    { value: 'qwen3-asr', label: 'Qwen3-ASR（最强·需下载）' },
                  ]}
                />
              </Field>
              {cfg.asrModel === 'qwen3-asr' && (
                <Muted style={{ gridColumn: '1 / -1' }}>
                  Qwen3-ASR 用于离线识别（中英文都强）；说话人分离仍由 FunASR 的 cam++ 提供——
                  按说话人切段后再逐段识别，因此不需要强制对齐。实时转写仍走 Paraformer 流式
                  （Qwen3 的流式仅 vLLM 支持，Windows 原生跑不了）。首次使用需点「安装 / 修复环境」
                  创建 qwen venv 并下载权重（约 3.4GB，走 hf-mirror）。
                </Muted>
              )}
              <Field label="识别语种">
                <Select
                  value={cfg.language}
                  onChange={(v) => patch({ language: v as RuntimeConfig['language'] })}
                  options={[
                    { value: 'auto', label: '自动判断（推荐）' },
                    { value: 'zh', label: '中文' },
                    { value: 'en', label: '英语' },
                    { value: 'yue', label: '粤语' },
                    { value: 'ja', label: '日语' },
                    { value: 'ko', label: '韩语' },
                  ]}
                />
              </Field>
              {cfg.asrModel === 'paraformer-zh' && cfg.language !== 'zh' && cfg.language !== 'auto' && (
                <Muted style={{ gridColumn: '1 / -1', color: C.warn }}>
                  ⚠ Paraformer-large 是中文专用模型，选这一项不会生效——要识别英语/粤语/日语/韩语，
                  请把「识别模型」切成 SenseVoiceSmall。
                </Muted>
              )}
              {cfg.asrModel === 'sensevoice' && cfg.language === 'zh' && (
                <Muted style={{ gridColumn: '1 / -1', color: C.warn }}>
                  ⚠ 已锁定中文：SenseVoiceSmall 支持中/粤/英/日/韩，语种设为「自动判断」才能识别外语录音。
                </Muted>
              )}
              <Field label="推理设备">
                <Select
                  value={cfg.asrDevice}
                  onChange={(v) => patch({ asrDevice: v as RuntimeConfig['asrDevice'] })}
                  options={[
                    { value: 'auto', label: '自动（有 CUDA 就用）' },
                    { value: 'cuda', label: '强制 CUDA' },
                    { value: 'cpu', label: '强制 CPU' },
                  ]}
                />
              </Field>
              <span />
              <Field label="语言">
                <Select
                  value={cfg.language}
                  onChange={(v) => patch({ language: v as RuntimeConfig['language'] })}
                  options={[
                    { value: 'auto', label: '自动判断（推荐）' },
                    { value: 'zh', label: '中文' },
                    { value: 'en', label: '英语' },
                    { value: 'ja', label: '日语' },
                    { value: 'ko', label: '韩语' },
                    { value: 'yue', label: '粤语' },
                  ]}
                />
              </Field>
              <span />
              <Field label="流式窗口（毫秒 / chunk）" hint="越小越实时，越吃算力">
                <NumberInput
                  value={cfg.streamChunkMs}
                  min={60}
                  max={2000}
                  step={60}
                  onChange={(v) => patch({ streamChunkMs: v })}
                />
              </Field>
              <Field label="自动标题取字数" hint="标题同时用作音频与 Markdown 的文件名">
                <NumberInput
                  value={cfg.titleMaxChars}
                  min={2}
                  max={64}
                  step={1}
                  onChange={(v) => patch({ titleMaxChars: v })}
                />
              </Field>
            </Grid>

            <Row style={{ marginTop: 14 }}>
              {/* 功能开关随预设变化：预设不支持的直接隐藏，并在下面说明原因 ——
                  静默隐藏会让用户以为功能丢了，所以必须给理由 */}
              {feat('vad') && <Switch label="VAD 断句" on={cfg.asrVad} onChange={(v) => patch({ asrVad: v })} />}
              {feat('punc') && (
                <Switch label="标点恢复" on={cfg.asrPunc} onChange={(v) => patch({ asrPunc: v })} />
              )}
              {feat('spk') && (
                <Switch label="说话人分离" on={cfg.asrSpk} onChange={(v) => patch({ asrSpk: v })} />
              )}
              <Switch
                label="自动命名"
                on={cfg.autoTitle}
                title="按转写内容开头几个字给录音命名，并把磁盘上的音频与 Markdown 一起改成这个名字"
                onChange={(v) => patch({ autoTitle: v })}
              />
              <Switch
                label="下载优先 .opus"
                on={cfg.opusPreferred}
                title=".opus 是设备原生格式（≈2 KB/s）；.wav 是设备转码产物（32 KB/s，体积约 16 倍）"
                onChange={(v) => patch({ opusPreferred: v })}
              />
              {unsupported.length > 0 && (
                <div style={{ marginTop: 8, fontSize: 12, color: C.ink3, lineHeight: 1.8 }}>
                  {unsupported.map(([k, reason]) => (
                    <div key={k}>· 「{FEATURE_LABEL[k] ?? k}」不可用：{reason}</div>
                  ))}
                </div>
              )}
              <Switch label="产出 Markdown" on={cfg.markdownEnabled} onChange={(v) => patch({ markdownEnabled: v })} />
              <Switch label="归档音频" on={cfg.keepAudio} onChange={(v) => patch({ keepAudio: v })} />
              <Switch label="连上自动同步" on={cfg.bleAutoSync} onChange={(v) => patch({ bleAutoSync: v })} />
              <Switch
                label="同步后删卡上原件"
                on={cfg.bleSyncDeleteAfter}
                title="录音转到电脑并落盘后，自动从录音卡删掉这条。只有本地音频确实存在且非空才会删；删除不可逆。"
                onChange={(v) => patch({ bleSyncDeleteAfter: v })}
              />
            </Row>
            <Muted style={{ marginTop: 8 }}>
              预设：录音默认拿转写开头的几个字当标题，磁盘上就是「标题.ogg / 标题.md」；手动改过的标题不会被自动命名覆盖。
              同步失败的会按「瞬时/永久」区分——断线这类瞬时失败下次自动重试（最多 3 次），文件本身坏了的不再重试。
            </Muted>
            {cfg.bleSyncDeleteAfter && (
              <Muted style={{ marginTop: 4, display: 'block', color: C.warn }}>
                ⚠ 已开启「同步后删卡上原件」：每条录音转成功后会从录音卡删除。删除不可逆，请确认本地副本已妥善保存
                （「归档音频」关闭时不会保留音频，那种情况下本插件会拒绝删除卡上原件）。
              </Muted>
            )}
          </Panel>
        )}

        {/* ───────── 后处理 ───────── */}
        {pp && (
          <Panel
            title="后处理选择"
            extra={
              <Row>
                {pp.pending && <Chip tone="warn">待确认 {(pp.pendingCount ?? 1)}</Chip>}
                <Chip tone={pp.config.enabled ? 'ok' : 'neutral'}>{pp.config.enabled ? '已启用' : '未启用'}</Chip>
              </Row>
            }
          >
            <Switch
              label="转写完成后交给 Agent 后处理"
              on={pp.config.enabled}
              title="把转写文本按下面的提示词模板发给指定对话"
              onChange={(v) => void patchPostProcess({ enabled: v })}
            />

            {/* 「待确认」常驻显示。
                以前只在有 pending 时渲染 —— 而 pending 只有同步跑完才会产生，
                所以没同步过的人根本看不到这块在哪，等于功能不可发现。
                现在无论有没有都占位，没有时说明它何时会出现。 */}
            {pp.config.enabled && pp.config.mode === 'confirm' && (
              <div
                style={{
                  marginTop: 10,
                  border: `1px solid ${pp.pending ? C.warn : C.border}`,
                  borderRadius: 6,
                  padding: 8,
                  background: C.bg1,
                }}
              >
                <Row>
                  <b style={{ fontSize: 12, color: pp.pending ? C.warn : C.ink2 }}>待确认发送</b>
                  {pp.pending ? (
                    <Muted>
                      模板「{pp.pending.templateName}」· {pp.pending.items.length} 条录音已合并成 1 条消息
                      {(pp.pendingCount ?? 1) > 1
                        ? ' · 另有 ' + String((pp.pendingCount ?? 1) - 1) + ' 条待确认'
                        : ''}
                    </Muted>
                  ) : (
                    <Muted>暂无 —— 同步完成后，这一轮的录音会合并成 1 条消息出现在这里</Muted>
                  )}
                </Row>
                {pp.pending && (
                  <>
                    <Muted style={{ display: 'block', marginTop: 2 }}>
                      {pp.pending.items.map((x) => x.title || x.name).join('、')}
                    </Muted>
                    <details style={{ marginTop: 4 }}>
                      <summary style={{ cursor: 'pointer', fontSize: 12, color: C.ink3 }}>
                        展开预览（{pp.pending.text.length} 字）
                      </summary>
                      <pre
                        style={{
                          maxHeight: 240,
                          overflow: 'auto',
                          fontSize: 11,
                          whiteSpace: 'pre-wrap',
                          background: C.bg2,
                          padding: 6,
                          borderRadius: 4,
                        }}
                      >
                        {pp.pending.text}
                      </pre>
                    </details>
                    <Row style={{ marginTop: 6 }}>
                      <Btn
                        primary
                        disabled={busy !== null}
                        onClick={() =>
                          void run('pp-send', async () => {
                            const r = await post<{ sessionId: string }>('/post-process/resolve', {
                              action: 'send',
                            })
                            setMsg(`已发送到会话 ${r.sessionId}`)
                            await refreshPostProcess()
                            await refreshDshSessions()
                          })
                        }
                      >
                        {busy === 'pp-send' ? '发送中…' : '发送'}
                      </Btn>
                      <Btn
                        disabled={busy !== null}
                        onClick={() =>
                          void run('pp-discard', async () => {
                            await post('/post-process/resolve', { action: 'discard' })
                            await refreshPostProcess()
                            setMsg('已丢弃这条后处理消息')
                          })
                        }
                      >
                        丢弃
                      </Btn>
                    </Row>
                  </>
                )}
              </div>
            )}

            {pp.config.enabled && (
              <>
                {/* ① 与 ② 并排，填满面板宽度（以前三个板块竖排，右侧空一大块）*/}
                <Grid cols="1fr 1fr" style={{ alignItems: 'start', marginTop: 10 }}>
                {/* ① 提示词模板 */}
                <div>
                  <Row>
                    <b style={{ fontSize: 12 }}>提示词模板</b>
                    <Muted>内置 {pp.templates.filter((x) => x.builtin).length} 套，可另存为自定义</Muted>
                  </Row>
                  <Row style={{ marginTop: 6 }}>
                    <Select
                      value={pp.config.templateId}
                      onChange={(v) => void patchPostProcess({ templateId: v })}
                      options={pp.templates.map((x) => ({
                        value: x.id,
                        label: `${x.name}${x.builtin ? '' : '（自定义）'}`,
                      }))}
                    />
                    <Btn
                      onClick={() => {
                        const cur = pp.templates.find((x) => x.id === pp.config.templateId)
                        if (!cur) return
                        setTplEdit(cur.id)
                        setTplDraft({
                          name: cur.builtin ? `${cur.name}（副本）` : cur.name,
                          summary: cur.summary,
                          body: cur.body,
                        })
                      }}
                    >
                      查看 / 编辑
                    </Btn>
                  </Row>
                  <Muted style={{ display: 'block', marginTop: 4 }}>
                    {pp.templates.find((x) => x.id === pp.config.templateId)?.summary}
                  </Muted>
                </div>

                {/* ② 转向对话 */}
                <div>
                  <Row>
                    <b style={{ fontSize: 12 }}>转向对话</b>
                    <Btn onClick={() => void refreshDshSessions()}>刷新列表</Btn>
                  </Row>
                  <Row style={{ marginTop: 6 }}>
                    <Select
                      value={pp.config.conversationId}
                      onChange={(v) => void patchPostProcess({ conversationId: v })}
                      options={[
                        { value: '', label: '新建对话（每次新建）' },
                        ...dshSessions.slice(0, 100).map((s) => ({
                          value: s.sessionId,
                          label: `${s.running ? '● ' : ''}${s.title || s.sessionId.slice(0, 16)}`,
                        })),
                      ]}
                    />
                  </Row>
                  <Muted style={{ display: 'block', marginTop: 4 }}>
                    {pp.config.conversationId
                      ? '内容会发到选中的对话；它不清晰时 Agent 可反问。'
                      : '每次转写完成都会新建一个对话，不打扰你现有的会话。'}
                  </Muted>
                </div>

                </Grid>


                {tplEdit !== null && tplDraft !== null && (
                  <div
                    style={{
                      marginTop: 8,
                      border: `1px solid ${C.border}`,
                      borderRadius: 6,
                      padding: 8,
                    }}
                  >
                    <Row>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>
                        {pp.templates.find((x) => x.id === tplEdit)?.builtin ? '内置模板（另存为新模板）' : '编辑自定义模板'}
                      </span>
                    </Row>
                    <Field label="名称">
                      <input
                        value={tplDraft.name}
                        onChange={(e) => setTplDraft({ ...tplDraft, name: e.target.value })}
                        style={{ width: '100%' }}
                      />
                    </Field>
                    <Field label="说明">
                      <input
                        value={tplDraft.summary}
                        onChange={(e) => setTplDraft({ ...tplDraft, summary: e.target.value })}
                        style={{ width: '100%' }}
                      />
                    </Field>
                    <Field label="提示词正文">
                      <textarea
                        value={tplDraft.body}
                        onChange={(e) => setTplDraft({ ...tplDraft, body: e.target.value })}
                        rows={10}
                        style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
                      />
                    </Field>
                    <Row style={{ marginTop: 6 }}>
                      <Btn
                        primary
                        disabled={busy !== null}
                        onClick={() =>
                          void run('tpl-save', async () => {
                            // 内置模板不覆盖：另存为新的自定义模板
                            const isBuiltin = pp.templates.find((x) => x.id === tplEdit)?.builtin === true
                            const payload: Record<string, unknown> = { ...tplDraft }
                            if (!isBuiltin) payload.id = tplEdit
                            const r = await post<{ templates: NonNullable<typeof pp>['templates']; template: { id: string } }>(
                              '/post-process/template',
                              { template: payload },
                            )
                            setPp((cur) => (cur ? { ...cur, templates: r.templates } : cur))
                            if (isBuiltin) await patchPostProcess({ templateId: r.template.id })
                            setTplEdit(null)
                            setTplDraft(null)
                            setMsg(isBuiltin ? '已另存为自定义模板并选中' : '模板已保存')
                          })
                        }
                      >
                        保存
                      </Btn>
                      <Btn
                        onClick={() => {
                          setTplEdit(null)
                          setTplDraft(null)
                        }}
                      >
                        取消
                      </Btn>
                      {pp.templates.find((x) => x.id === tplEdit)?.builtin === false && (
                        <Btn
                          disabled={busy !== null}
                          onClick={() =>
                            void run('tpl-del', async () => {
                              const r = await post<{ templates: NonNullable<typeof pp>['templates'] }>(
                                '/post-process/template/delete',
                                { id: tplEdit },
                              )
                              setPp((cur) => (cur ? { ...cur, templates: r.templates } : cur))
                              setTplEdit(null)
                              setTplDraft(null)
                              // 必须重拉 config：主机在模板被删时会把 templateId 回落到内置默认，
                              // 只更新 templates 的话界面还指着那个已删除的 id（下拉显示错位，
                              // 而且之后任何一次保存都会把陈旧 id 写回去）。
                              await refreshPostProcess()
                              setMsg('自定义模板已删除')
                            })
                          }
                        >
                          删除
                        </Btn>
                      )}
                    </Row>
                  </div>
                )}

                {/* ③ 运转方式 */}
                <div style={{ marginTop: 10 }}>
                  <Row>
                    <b style={{ fontSize: 12 }}>运转方式</b>
                  </Row>
                  <Row style={{ marginTop: 6 }}>
                    <Select
                      value={pp.config.mode}
                      onChange={(v) => void patchPostProcess({ mode: v as 'auto' | 'confirm' })}
                      options={[
                        { value: 'confirm', label: '同步后手动确认再流转' },
                        { value: 'auto', label: '单次同步后自动流转' },
                      ]}
                    />
                  </Row>
                  <Muted style={{ display: 'block', marginTop: 4 }}>
                    {pp.config.mode === 'auto'
                      ? '同步一完成就自动发出，无需你干预。'
                      : '同步完成后会先给你看内容，你确认后才发出。'}
                  </Muted>
                </div>
              </>
            )}
          </Panel>
        )}
        {/* ───────── 蓝牙 ───────── */}
        <Panel
          title="蓝牙直连"
          extra={
            <Row>
              <Chip tone={ble?.connected ? 'ok' : ble?.reconnecting ? 'warn' : 'neutral'}>
                {ble?.connected
                  ? '已连接'
                  : ble?.reconnecting
                    ? `自动重连中${ble.reconnectAttempt ? `（第 ${ble.reconnectAttempt} 次）` : ''}`
                    : '未连接'}
              </Chip>
              {ble?.battery !== null && ble?.battery !== undefined && (
                <Muted>{fmtBattery(ble.battery)}</Muted>
              )}
              {ble?.mtu ? <Muted>MTU {ble.mtu}</Muted> : null}
            </Row>
          }
        >
          <Muted>
            bleak {ble?.bleak ?? '未探测'} · {ble?.address ?? '未连接设备'}
            {ble?.sync?.running ? ' · 同步中' : ''}
          </Muted>

          <Row style={{ marginTop: 12 }}>
            <Btn
              primary={scan?.running}
              onClick={() =>
                void run('scan', async () => {
                  if (scan?.running) {
                    await stopScan()
                    await refreshBle()
                    setMsg('已停止扫描')
                    return
                  }
                  setMsg(null)
                  await post('/ble/setup', {})
                  await startScan({ roundMs: 3000, autoConnect: true })
                  await refreshBle()
                })
              }
            >
              {scan?.running ? '停止扫描' : '扫描设备'}
            </Btn>
            <Btn
              disabled={busy !== null}
              onClick={() =>
                void run('files', async () => {
                  const r = await get<{ entries: DeviceEntry[] }>('/ble/filelist')
                  const list = r.entries ?? []
                  setFiles(list)
                  setFilesQueried(true)
                  // 空卡也必须给反馈：以前渲染条件是 files.length > 0，
                  // 卡是空的时候点「文件列表」什么都不显示，看起来就像按钮坏了
                  setMsg(list.length ? `录音卡上有 ${list.length} 条录音` : '录音卡上没有录音（空卡）')
                })
              }
            >
              文件列表
            </Btn>
            <Btn
              disabled={busy !== null}
              onClick={() =>
                void run('sync', async () => {
                  setMsg('同步中…')
                  const r = await post<{ sync: { downloaded: number; skipped: number; failed: number } }>(
                    '/ble/sync',
                    {},
                  )
                  setMsg(`同步完成：下载 ${r.sync.downloaded} / 跳过 ${r.sync.skipped} / 失败 ${r.sync.failed}`)
                })
              }
            >
              同步离线录音
            </Btn>
            <Btn
              primary
              disabled={busy !== null}
              onClick={() =>
                void run('live', async () => {
                  if (liveSession) {
                    await post('/ble/realtime', { action: 'stop' })
                    setLiveSession(null)
                  } else {
                    const r = await post<{ sessionId: string }>('/ble/realtime', { action: 'start' })
                    setPartial('')
                    setLiveSession(r.sessionId)
                  }
                })
              }
            >
              {liveSession ? '停止实时转写' : '开始实时转写'}
            </Btn>
            {ble?.connected && (
              <Btn
                disabled={busy !== null}
                onClick={() =>
                  void run('disc', async () => {
                    await post('/ble/disconnect', {})
                    await refreshBle()
                  })
                }
              >
                断开
              </Btn>
            )}
            <Btn small disabled={busy !== null} onClick={() => void run('blefresh', refreshBle)}>
              刷新状态
            </Btn>
          </Row>

          {/* 扫描状态与结果 */}
          {(scan?.running || scanMsg || scan?.lastError) && (
            <div style={{ marginTop: 10, fontSize: 12, lineHeight: 1.8 }}>
              {scan?.running && (
                <div style={{ color: C.brand, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Loading />
                  <span>
                    正在扫描… 已发现 {scan.devices.length} 个设备
                    {scan.autoConnect ? '，发现连接过的设备会自动连上' : ''}
                  </span>
                </div>
              )}
              {scanMsg && !scan?.running && <div style={{ color: C.ink2 }}>{scanMsg}</div>}
              {scan?.lastError && <div style={{ color: C.danger }}>{scan.lastError}</div>}
            </div>
          )}

          {scanned.length > 0 && (
            <div
              style={{
                marginTop: 10,
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                overflow: 'hidden',
              }}
            >
              {scanned.map((d) => {
                const isCurrent = ble?.connected && ble.address === d.address
                return (
                  <div
                    key={d.address}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 12px',
                      borderTop: `1px solid ${C.border}`,
                      flexWrap: 'wrap',
                    }}
                  >
                    <span style={{ fontWeight: 600, fontSize: 12.5, color: C.ink, minWidth: 90 }}>
                      {d.name || '(未命名)'}
                    </span>
                    <span style={{ fontFamily: mono, fontSize: 11, color: C.ink3 }}>{d.address}</span>
                    <span
                      title={fmtRssi(d.rssi)}
                      style={{
                        fontSize: 11,
                        color: d.rssi >= -75 ? C.ink2 : C.warn,
                        fontFamily: mono,
                      }}
                    >
                      {d.rssi} dBm
                    </span>
                    {d.has_ae20 && <Chip tone="brand">录音卡</Chip>}
                    {d.known && (
                      <Chip tone="ok">
                        连过
                        {d.lastConnectedAt ? ` · ${fmtAgo(d.lastConnectedAt)}` : ''}
                      </Chip>
                    )}
                    {!d.known && !d.has_ae20 && <span style={{ fontSize: 11, color: C.ink3 }}>非录音卡</span>}
                    <span style={{ marginLeft: 'auto' }}>
                      {isCurrent ? (
                        <Chip tone="ok">已连接</Chip>
                      ) : (
                        <Btn
                          small
                          primary={d.known}
                          disabled={busy !== null || scan?.running === true}
                          onClick={() =>
                            void run('connect', async () => {
                              await post('/ble/connect', { address: d.address, retries: 5 })
                              await refreshBle()
                              setMsg(`已连接 ${d.name || d.address}`)
                            })
                          }
                        >
                          连接
                        </Btn>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          {knownList.length > 0 && (
            <Muted style={{ marginTop: 8, display: 'block' }}>
              连过的设备：{knownList.map((k) => `${k.name || k.address}（${fmtAgo(k.lastConnectedAt)}）`).join('、')}
            </Muted>
          )}

          {filesQueried && files.length === 0 && (
                <Muted style={{ marginTop: 8, display: 'block' }}>
                  录音卡上没有录音（空卡）。在卡上录一段后按「同步」或点「扫描设备」会自动接回。
                </Muted>
              )}
              {files.length > 0 && (
            <div style={{ marginTop: 12, maxHeight: 260, overflowY: 'auto', border: `1px solid ${C.border}`, borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ color: C.ink3, textAlign: 'left' }}>
                    <th style={{ padding: '6px 10px', fontWeight: 500 }}>文件</th>
                    <th style={{ padding: '6px 10px', fontWeight: 500 }}>时长</th>
                    <th style={{ padding: '6px 10px', fontWeight: 500 }}>大小</th>
                    <th style={{ padding: '6px 10px', fontWeight: 500 }} />
                  </tr>
                </thead>
                <tbody>
                  {files.map((f) => (
                    <tr key={f.name} style={{ borderTop: `1px solid ${C.border}` }}>
                      <td style={{ padding: '6px 10px', wordBreak: 'break-all' }}>{f.name}</td>
                      <td style={{ padding: '6px 10px' }}>{f.time}s</td>
                      <td style={{ padding: '6px 10px' }}>{fmtBytes(f.size)}</td>
                      <td style={{ padding: '6px 10px' }}>
                        <Btn
                          small
                          primary
                          disabled={busy !== null}
                          onClick={() =>
                            void run('dl', async () => {
                              setMsg(`识别中：${f.name}（opus 优先，体积约为 wav 的 1/16）…`)
                              const r = await post<{ sessionId: string; text: string }>('/ble/download', {
                                name: f.name,
                              })
                              setMsg(`完成 ${r.sessionId}：${(r.text ?? '').slice(0, 60)}`)
                            })
                          }
                        >
                          下载并识别
                        </Btn>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        {/* ───────── 实时文本流 ───────── */}
        {liveSession && (
          <Panel
            title="实时文本流"
            extra={<Muted>{liveSession}</Muted>}
          >
            <pre
              style={{
                margin: 0,
                padding: 12,
                borderRadius: 8,
                background: C.bg1,
                border: `1px solid ${C.border}`,
                fontFamily: 'var(--ds-font-family-code, monospace)',
                fontSize: 13,
                lineHeight: 1.9,
                whiteSpace: 'pre-wrap',
                maxHeight: 240,
                overflowY: 'auto',
                color: C.ink,
              }}
            >
              {partial || '（等待语音…）'}
            </pre>
          </Panel>
        )}
      </div>
    </div>
  )
}
