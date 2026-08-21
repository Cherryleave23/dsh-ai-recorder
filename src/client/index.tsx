/**
 * dsh-ai-recorder — client 面板。
 * 两个挂载点：
 *  - settings.section（设置页卡片，参考 dsh-vision）：全局设置（流转目标/模式/ASR/模型目录/录音会话概览）
 *  - conversation.view（会话内面板）：本会话配置覆盖（模式/ASR）
 */
import React, { useEffect, useState } from 'react'
import type { SlotsService } from '@deepseek-ai/dsh-client-ui-slots'

export const inject = ['slots']

const API = '/api/recorder'

interface DshSessionItem { id: string; title: string | null }
interface RecorderSessionItem { id: string; segments: number; meta?: { dshSessionId?: string } }
interface RuntimeConfig { sttProvider: string; autoProcessMode: string; deliverWakeup: boolean; language: string }
interface AsrStatus {
  modelReady: boolean
  python: string | null
  missing: string[]
  installHint: string
  available: { id: string; label: string; ready: boolean; detail: string }[]
}
interface BleStatus {
  ready: boolean
  error: string | null
  python: string | null
  bleak: string | null
  daemonRunning: boolean
  connected: boolean
  reconnecting: boolean
  address: string | null
  mtu: number | null
  battery: number | null
  realtimeActive: boolean
  lastActivity: number | null
}
interface BleDevice { address: string; name: string; rssi: number; has_ae20: boolean }
interface BleFileEntry { time: number; size: number; name: string }

async function api(path: string, init?: RequestInit): Promise<any> {
  const resp = await fetch(API + path, init)
  return resp.json()
}

const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }
const labelStyle: React.CSSProperties = { width: 76, opacity: 0.75, fontSize: 12, flexShrink: 0 }
const selectStyle: React.CSSProperties = {
  flex: 1, padding: '3px 6px', borderRadius: 4, fontSize: 12,
  background: 'transparent', color: 'inherit', border: '1px solid rgba(128,128,128,.35)',
}
const btnStyle: React.CSSProperties = {
  padding: '3px 12px', borderRadius: 4, fontSize: 12,
  border: '1px solid rgba(128,128,128,.35)', background: 'transparent', color: 'inherit', cursor: 'pointer',
}
const sectionStyle: React.CSSProperties = { padding: '6px 0' }
const sepStyle: React.CSSProperties = { borderTop: '1px solid rgba(128,128,128,.15)', margin: '4px 0' }

function AsrSelector(props: {
  asr: string
  onChange: (v: string) => void
  asrStatus: AsrStatus | null
}): React.ReactElement {
  const { asr, onChange, asrStatus } = props
  return (
    <div style={rowStyle}>
      <span style={labelStyle}>ASR 引擎</span>
      <select value={asr} onChange={(e) => onChange(e.target.value)} style={selectStyle}>
        {asrStatus
          ? asrStatus.available.filter((a) => a.ready).map((a) => (
            <option key={a.id} value={a.id}>{a.label}</option>
          ))
          : <option value="mock">mock（占位）</option>}
      </select>
    </div>
  )
}

/** ═══ 蓝牙直连面板（自实现 BLE 收端，嵌入录音卡后端设置卡片）═══ */
function BlePanel(): React.ReactElement {
  const [status, setStatus] = useState<BleStatus | null>(null)
  const [devices, setDevices] = useState<BleDevice[]>([])
  const [files, setFiles] = useState<BleFileEntry[]>([])
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [windowMs, setWindowMs] = useState(10000)
  const [pending, setPending] = useState<any[]>([])
  const [pendingSessions, setPendingSessions] = useState<DshSessionItem[]>([])
  const [pendingTargets, setPendingTargets] = useState<Record<string, string>>({})

  const refresh = async (): Promise<void> => {
    try {
      const s = await api('/ble/status')
      setStatus(s)
    } catch (e) {
      setMsg('状态获取失败: ' + String(e))
    }
  }

  useEffect(() => { void refresh(); void loadPending() }, [])

  const post = async (path: string, body?: unknown, label = ''): Promise<any> => {
    setBusy(label)
    try {
      const r = await api(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? '{}' : JSON.stringify(body),
      })
      if (!r.ok) throw new Error(r.error ?? (label + ' 失败'))
      return r
    } finally {
      setBusy('')
    }
  }

  const scan = async (): Promise<void> => {
    try {
      setMsg('🔍 扫描中（8s）… 请确认录音卡已开机')
      const r = await post('/ble/scan', { timeout: 8 }, '扫描')
      setDevices(Array.isArray(r.devices) ? r.devices : [])
      setMsg(`扫描完成，发现 ${(r.devices ?? []).length} 个 BLE 设备`)
    } catch (e) {
      setMsg('❌ ' + String(e))
    }
  }

  const connect = async (address: string): Promise<void> => {
    try {
      setMsg('连接中（自动重试，请确认录音卡在电脑 1-3 米内、未被手机 App 占用）…')
      const r = await post('/ble/connect', { address, retries: 6 }, '连接')
      setMsg(`✅ 已连接 ${address}，MTU=${r.mtu ?? '?'}，电量=${r.battery ?? '?'}%`)
      await refresh()
    } catch (e) {
      setMsg('❌ ' + String(e))
    }
  }

  const disconnect = async (): Promise<void> => {
    try {
      await post('/ble/disconnect', {}, '断开')
      setDevices([])
      setFiles([])
      setMsg('✅ 已断开')
      await refresh()
    } catch (e) {
      setMsg('❌ ' + String(e))
    }
  }

  const battery = async (): Promise<void> => {
    try {
      const r = await post('/ble/battery', {}, '电量')
      setMsg(`🔋 电量: ${r.level}%${r.level === 110 ? '（充电中）' : ''}`)
      await refresh()
    } catch (e) {
      setMsg('❌ ' + String(e))
    }
  }

  const timesync = async (): Promise<void> => {
    try {
      await post('/ble/timesync', {}, '时间同步')
      setMsg('✅ 已同步设备时间')
    } catch (e) {
      setMsg('❌ ' + String(e))
    }
  }

  const listFiles = async (): Promise<void> => {
    try {
      setMsg('📂 拉取文件列表…')
      const r = await api('/ble/filelist')
      if (!r.ok) throw new Error(r.error ?? '文件列表失败')
      setFiles(Array.isArray(r.entries) ? r.entries : [])
      setMsg(`📂 共 ${(r.entries ?? []).length} 条录音`)
    } catch (e) {
      setMsg('❌ ' + String(e))
    }
  }

  const download = async (name: string): Promise<void> => {
    try {
      setMsg(`⬇️ 下载并转写 ${name} …（会尝试 .wav/.opus 重建扩展名）`)
      const r = await post('/ble/download', { name }, '下载')
      setMsg(`✅ ${r.file?.name ?? name}（${r.file?.size ?? '?'}B）转写完成：${(r.text ?? '').slice(0, 60)}${(r.text ?? '').length > 60 ? '…' : ''}`)
    } catch (e) {
      setMsg('❌ ' + String(e))
    }
  }

  const realtime = async (action: 'start' | 'stop'): Promise<void> => {
    try {
      if (action === 'start') {
        setMsg(`🎙️ 实时转写已开始（${windowMs / 1000} 秒窗口）：设备推流 → 分段 ASR → 追加会话（停止后按模式投递）`)
      }
      const r = await post('/ble/realtime', action === 'start' ? { action, windowMs } : { action }, action === 'start' ? '开始实时' : '停止实时')
      if (action === 'stop') setMsg('⏹ 实时转写已停止' + (r.sessionId ? `（会话 ${r.sessionId}）` : ''))
      await refresh()
    } catch (e) {
      setMsg('❌ ' + String(e))
    }
  }

  const setup = async (): Promise<void> => {
    try {
      setMsg('🔧 检测 Python / 自动安装 bleak …')
      const r = await post('/ble/setup', {}, '安装')
      setMsg(r.ok ? '✅ BLE 环境就绪（python=' + r.python + ', bleak=' + r.bleak + '）' : '❌ ' + (r.error ?? '安装失败'))
      await refresh()
    } catch (e) {
      setMsg('❌ ' + String(e))
    }
  }

  // ── 离线录音同步 + 待审批链 ──
  const syncRecordings = async (): Promise<void> => {
    try {
      setMsg('📥 同步离线录音中…（下载未处理文件 → 存盘 → 转写）')
      const r = await post('/ble/sync', {}, '同步')
      const s = r.sync ?? {}
      setMsg(`📥 同步完成：新增 ${s.downloaded ?? 0} 段，跳过 ${s.skipped ?? 0}，失败 ${s.failed ?? 0}；投递 ${s.delivered ?? 0}，待审批 ${s.pendingAdded ?? 0}`)
      await loadPending()
    } catch (e) {
      setMsg('❌ 同步失败: ' + String(e))
    }
  }

  const loadPending = async (): Promise<void> => {
    try {
      const r = await api('/ble/pending')
      setPending(Array.isArray(r.items) ? r.items : [])
      setPendingSessions(Array.isArray(r.sessions) ? r.sessions : [])
    } catch { /* 面板不阻塞 */ }
  }

  const approvePending = async (id: string): Promise<void> => {
    const target = pendingTargets[id]
    if (!target) { setMsg('⚠️ 请先选择目标会话'); return }
    try {
      const r = await post(`/ble/pending/${id}/approve`, { sessionId: target }, '投递')
      setMsg(`✅ 已投递到 ${target.slice(0, 12)}…`)
      await loadPending()
    } catch (e) {
      setMsg('❌ ' + String(e))
    }
  }

  const rejectPending = async (id: string): Promise<void> => {
    try {
      await post(`/ble/pending/${id}/reject`, {}, '忽略')
      setMsg('⏭ 已忽略（本地保留，不投递）')
      await loadPending()
    } catch (e) {
      setMsg('❌ ' + String(e))
    }
  }

  const connected = Boolean(status?.connected)
  const ready = Boolean(status?.ready)
  const fmtSize = (n: number): string => (n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + 'MB' : (n / 1024).toFixed(1) + 'KB')

  return (
    <div style={{ padding: '4px 0' }}>
      <div style={{ fontWeight: 600, padding: '2px 0' }}>🔵 蓝牙直连（自实现收端）</div>
      <div style={{ opacity: 0.7, fontSize: 11, paddingBottom: 4 }}>
        {ready
          ? `环境就绪: python=${status?.python ?? '?'} / bleak=${status?.bleak ?? '?'} / 守护进程=${status?.daemonRunning ? '运行中' : '未启动'}`
          : `⚠️ BLE 未就绪: ${status?.error ?? '检测中…'}`}
        {connected && (
          <div>
            ✅ 已连接 {status?.address}（MTU={status?.mtu ?? '?'}，电量={status?.battery != null ? status.battery + '%' : '?'}）
            {status?.realtimeActive && <span style={{ color: '#e0a030' }}> ｜🎙️ 实时转写进行中</span>}
          </div>
        )}
        {status?.reconnecting && (
          <div style={{ color: '#e0a030' }}>
            ⚙️ 连接断开，自动重连中…（每 5s 重试，设备重启后随机地址变化也会自动重扫）
          </div>
        )}
      </div>

      <div style={rowStyle}>
        <button onClick={() => void refresh()} style={btnStyle}>刷新状态</button>
        <button onClick={() => void scan()} disabled={Boolean(busy) || !ready} style={btnStyle}>扫描设备</button>
        {connected && <button onClick={() => void disconnect()} disabled={Boolean(busy)} style={btnStyle}>断开</button>}
        {!ready && status && !status.ready && (
          <button onClick={() => void setup()} disabled={Boolean(busy)} style={btnStyle}>安装环境</button>
        )}
        {connected && (
          <>
            <button onClick={() => void battery()} disabled={Boolean(busy)} style={btnStyle}>电量</button>
            <button onClick={() => void timesync()} disabled={Boolean(busy)} style={btnStyle}>时间同步</button>
            <button onClick={() => void listFiles()} disabled={Boolean(busy)} style={btnStyle}>文件列表</button>
            <button onClick={() => void syncRecordings()} disabled={Boolean(busy)} style={btnStyle}>📥 同步离线录音</button>
            {status?.realtimeActive
              ? <button onClick={() => void realtime('stop')} disabled={Boolean(busy)} style={btnStyle}>⏹ 停止实时</button>
              : (
                <>
                  <select value={windowMs} onChange={(e) => setWindowMs(Number(e.target.value))} style={{ ...selectStyle, width: 84 }} title="攒段窗口：2s 低延迟（句边界可能被切） / 10s 高质量">
                    <option value={2000}>2s 低延迟</option>
                    <option value={5000}>5s 均衡</option>
                    <option value={10000}>10s 高质量</option>
                  </select>
                  <button onClick={() => void realtime('start')} disabled={Boolean(busy)} style={btnStyle}>🎙️ 实时转写</button>
                </>
              )}
          </>
        )}
        {busy && <span style={{ opacity: 0.6 }}>{busy}…</span>}
      </div>

      {devices.length > 0 && (
        <div style={{ padding: '2px 0' }}>
          {devices.map((d) => (
            <div key={d.address} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0', fontSize: 11 }}>
              <span style={{ opacity: 0.55, fontFamily: 'monospace' }}>{d.address}</span>
              <span>{d.name || '(无名)'}</span>
              <span style={{ opacity: 0.5 }}>RSSI={d.rssi}</span>
              {d.has_ae20 && <span style={{ opacity: 0.7, color: '#6c8' }}>AE20✔</span>}
              {!connected && (
                <button onClick={() => void connect(d.address)} disabled={Boolean(busy)} style={{ ...btnStyle, padding: '1px 8px' }}>
                  连接
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {files.length > 0 && (
        <div style={{ padding: '2px 0' }}>
          <div style={{ opacity: 0.7, fontSize: 11, paddingBottom: 2 }}>设备录音（文件名 20B 截断，下载时自动重建扩展名）：</div>
          {files.map((f) => (
            <div key={f.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0', fontSize: 11 }}>
              <span style={{ fontFamily: 'monospace' }}>{f.name}</span>
              <span style={{ opacity: 0.5 }}>{f.time}s / {fmtSize(f.size)}</span>
              <button onClick={() => void download(f.name)} disabled={Boolean(busy)} style={{ ...btnStyle, padding: '1px 8px' }}>
                下载转写
              </button>
            </div>
          ))}
        </div>
      )}

      {pending.length > 0 && (
        <div style={{ padding: '4px 0', borderTop: '1px dashed rgba(128,128,128,.25)', marginTop: 4 }}>
          <div style={{ fontWeight: 600, padding: '2px 0' }}>⏳ 待审批投递（work 模式同步结果，{pending.length} 条）</div>
          <div style={{ opacity: 0.6, fontSize: 11, paddingBottom: 2 }}>选择目标会话后「投递」；「忽略」则本地保留不投递</div>
          {pending.map((p) => (
            <div key={p.id} style={{ padding: '4px 0', fontSize: 11, borderTop: '1px solid rgba(128,128,128,.12)' }}>
              <div style={{ opacity: 0.6 }}>{p.spokenAt}{p.duration ? `（${p.duration}s）` : ''} — {p.name}</div>
              <div style={{ padding: '2px 0 4px', lineHeight: 1.4 }}>{p.text}</div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <select
                  value={pendingTargets[p.id] ?? ''}
                  onChange={(e) => setPendingTargets((prev) => ({ ...prev, [p.id]: e.target.value }))}
                  style={selectStyle}
                >
                  <option value="">— 选择目标会话 —</option>
                  {pendingSessions.map((s) => (
                    <option key={s.id} value={s.id}>{s.title ? `${s.title}（${s.id.slice(0, 8)}…）` : s.id}</option>
                  ))}
                </select>
                <button onClick={() => void approvePending(p.id)} disabled={Boolean(busy)} style={{ ...btnStyle, padding: '1px 10px' }}>投递</button>
                <button onClick={() => void rejectPending(p.id)} disabled={Boolean(busy)} style={{ ...btnStyle, padding: '1px 10px' }}>忽略</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {msg && <div style={{ opacity: 0.7, fontSize: 11, paddingTop: 2 }}>{msg}</div>}
    </div>
  )
}

/** ═══ 全局设置卡片（settings.section）═══ */
function GlobalSettingsCard(): React.ReactElement {
  const [sessions, setSessions] = useState<DshSessionItem[]>([])
  const [target, setTarget] = useState('')
  const [mode, setMode] = useState('none')
  const [asr, setAsr] = useState('mock')
  const [effectiveAsr, setEffectiveAsr] = useState('')
  const [asrStatus, setAsrStatus] = useState<AsrStatus | null>(null)
  const [modelDir, setModelDir] = useState('')
  const [recorders, setRecorders] = useState<RecorderSessionItem[]>([])
  const [msg, setMsg] = useState('')
  const [loaded, setLoaded] = useState(false)

  const load = async (): Promise<void> => {
    try {
      const [d, c, r] = await Promise.all([api('/dsh-sessions'), api('/config'), api('/sessions')])
      setSessions(Array.isArray(d.items) ? d.items : [])
      setTarget(typeof d.defaultTarget === 'string' ? d.defaultTarget : '')
      setMode(typeof c.config?.autoProcessMode === 'string' ? c.config.autoProcessMode : 'none')
      setAsr(typeof c.config?.sttProvider === 'string' ? c.config.sttProvider : 'mock')
      setEffectiveAsr(typeof c.effectiveSttProvider === 'string' ? c.effectiveSttProvider : '')
      setAsrStatus(c.asrStatus ?? null)
      setModelDir(typeof c.asrStatus?.modelDir === 'string' ? c.asrStatus.modelDir : '')
      setRecorders(Array.isArray(r.items) ? r.items : [])
    } catch (e) {
      setMsg('加载失败: ' + String(e))
    } finally {
      setLoaded(true)
    }
  }

  useEffect(() => { void load() }, [])

  const save = async (): Promise<void> => {
    try {
      if (target) {
        const dt = await api('/deliver-target', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: target }),
        })
        if (!dt.ok) throw new Error(dt.error ?? '目标设置失败')
      }
      const cfg = await api('/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ autoProcessMode: mode, sttProvider: asr }),
      })
      if (!cfg.ok) throw new Error(cfg.error ?? '配置失败')
      setEffectiveAsr(typeof cfg.effectiveSttProvider === 'string' ? cfg.effectiveSttProvider : '')
      setMsg('✅ 已保存为全局配置')
    } catch (e) {
      setMsg('❌ ' + String(e))
    }
  }

  const applyModelDir = async (): Promise<void> => {
    try {
      const cfg = await api('/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fwModelDir: modelDir }),
      })
      if (!cfg.ok) throw new Error(cfg.error ?? '目录设置失败')
      setAsrStatus(cfg.asrStatus ?? null)
      setMsg('✅ 模型目录已更新')
    } catch (e) {
      setMsg('❌ ' + String(e))
    }
  }

  const openModelDir = async (): Promise<void> => {
    try {
      const r = await api('/open-model-dir', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      setMsg(r.ok ? `已打开: ${r.dir}` : '❌ ' + (r.error ?? '打开失败'))
    } catch (e) {
      setMsg('❌ ' + String(e))
    }
  }

  return (
    <div style={{ padding: '4px 0', fontFamily: 'system-ui,sans-serif', fontSize: 12, maxWidth: 520 }}>
      <div style={{ fontWeight: 600, fontSize: 13, padding: '4px 0' }}>🎙️ 录音卡后端（全局设置）</div>

      <div style={sectionStyle}>
        <div style={rowStyle}>
          <span style={labelStyle}>流转目标</span>
          <select value={target} onChange={(e) => setTarget(e.target.value)} style={selectStyle}>
            <option value="">— 不投递 —</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>{s.title ? `${s.title}（${s.id.slice(0, 8)}…）` : s.id}</option>
            ))}
          </select>
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>处理模式</span>
          <select value={mode} onChange={(e) => setMode(e.target.value)} style={selectStyle}>
            <option value="none">不自动处理</option>
            <option value="work">工作模式（直接给 AGENT）</option>
            <option value="summary">总结模式（会议记录）</option>
          </select>
        </div>
        <AsrSelector asr={asr} onChange={setAsr} asrStatus={asrStatus} />
        {asrStatus && (
          <div style={{ padding: '2px 0 4px 84px', opacity: 0.7, fontSize: 11, lineHeight: 1.5 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 2 }}>
              <span>模型目录</span>
              <input
                value={modelDir}
                onChange={(e) => setModelDir(e.target.value)}
                style={{ flex: 1, padding: '2px 6px', fontSize: 11, background: 'transparent', color: 'inherit', border: '1px solid rgba(128,128,128,.35)', borderRadius: 4 }}
              />
              <button onClick={() => void applyModelDir()} style={btnStyle}>应用</button>
              <button onClick={() => void openModelDir()} style={btnStyle}>📂 打开</button>
            </div>
            {asrStatus.modelReady
              ? <div>✅ 模型就绪（python: {asrStatus.python ?? '?'}）</div>
              : (
                <>
                  <div>⚠️ 未检测到 ASR 模型 → 当前使用 mock（占位转写）</div>
                  {asrStatus.missing.length > 0 && <div>缺失：{asrStatus.missing.join('；')}</div>}
                </>
              )}
          </div>
        )}
        <div style={rowStyle}>
          <button onClick={() => void save()} style={btnStyle}>保存</button>
          <button onClick={() => void load()} style={btnStyle}>刷新</button>
          <span style={{ opacity: 0.6, fontSize: 11 }}>{msg || (effectiveAsr ? `当前 ASR: ${effectiveAsr}` : '')}</span>
        </div>
      </div>

      <div style={sepStyle} />
      <div style={sectionStyle}>
        <div style={{ fontWeight: 600, padding: '2px 0' }}>📼 录音会话</div>
        {!loaded && <div style={{ opacity: 0.5 }}>加载中…</div>}
        {loaded && recorders.length === 0 && <div style={{ opacity: 0.5 }}>暂无录音会话</div>}
        {recorders.slice(0, 20).map((s) => (
          <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
            <span>{s.id}（{s.segments} 段）</span>
            <span style={{ opacity: 0.6 }}>{s.meta?.dshSessionId ? `→ ${s.meta.dshSessionId.slice(0, 12)}…` : '未绑定'}</span>
          </div>
        ))}
      </div>

      <div style={sepStyle} />
      <BlePanel />
    </div>
  )
}

/** ═══ 会话内面板（conversation.view）：本会话配置覆盖 ═══ */
function SessionPanelView(props: { sessionId?: string }): React.ReactElement {
  const sessionId = props.sessionId
  const [mode, setMode] = useState('none')
  const [asr, setAsr] = useState('mock')
  const [effectiveAsr, setEffectiveAsr] = useState('')
  const [asrStatus, setAsrStatus] = useState<AsrStatus | null>(null)
  const [hasOverride, setHasOverride] = useState(false)
  const [msg, setMsg] = useState('')
  const [loaded, setLoaded] = useState(false)

  const cfgQuery = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''

  const load = async (): Promise<void> => {
    try {
      const c = await api('/config' + cfgQuery)
      setMode(typeof c.config?.autoProcessMode === 'string' ? c.config.autoProcessMode : 'none')
      setAsr(typeof c.config?.sttProvider === 'string' ? c.config.sttProvider : 'mock')
      setEffectiveAsr(typeof c.effectiveSttProvider === 'string' ? c.effectiveSttProvider : '')
      setHasOverride(Boolean(c.override))
      setAsrStatus(c.asrStatus ?? null)
    } catch (e) {
      setMsg('加载失败: ' + String(e))
    } finally {
      setLoaded(true)
    }
  }

  useEffect(() => { void load() }, [sessionId])

  const save = async (): Promise<void> => {
    try {
      const cfg = await api('/config' + cfgQuery, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ autoProcessMode: mode, sttProvider: asr }),
      })
      if (!cfg.ok) throw new Error(cfg.error ?? '配置失败')
      setEffectiveAsr(typeof cfg.effectiveSttProvider === 'string' ? cfg.effectiveSttProvider : '')
      setHasOverride(Boolean(cfg.override))
      setMsg('✅ 已保存为本会话配置')
    } catch (e) {
      setMsg('❌ ' + String(e))
    }
  }

  const clearOverride = async (): Promise<void> => {
    try {
      const cfg = await api('/config' + cfgQuery, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clear: true }),
      })
      if (!cfg.ok) throw new Error(cfg.error ?? '清除失败')
      setHasOverride(false)
      setMsg('✅ 已清除覆盖（使用全局配置）')
      await load()
    } catch (e) {
      setMsg('❌ ' + String(e))
    }
  }

  return (
    <div style={{ padding: '8px 12px', fontFamily: 'system-ui,sans-serif', fontSize: 12, maxWidth: 520 }}>
      <div style={{ fontWeight: 600, fontSize: 13, padding: '4px 0' }}>
        🎙️ 录音卡后端
        <span style={{ opacity: 0.55, fontWeight: 400, marginLeft: 8, fontSize: 11 }}>
          {hasOverride ? '（本会话覆盖）' : '（使用全局配置）'}
        </span>
      </div>
      <div style={{ opacity: 0.5, fontSize: 11, paddingBottom: 4 }}>全局设置在「设置 → 录音卡后端」</div>

      <div style={sectionStyle}>
        <div style={rowStyle}>
          <span style={labelStyle}>处理模式</span>
          <select value={mode} onChange={(e) => setMode(e.target.value)} style={selectStyle}>
            <option value="none">不自动处理</option>
            <option value="work">工作模式（直接给 AGENT）</option>
            <option value="summary">总结模式（会议记录）</option>
          </select>
        </div>
        <AsrSelector asr={asr} onChange={setAsr} asrStatus={asrStatus} />
        <div style={rowStyle}>
          <button onClick={() => void save()} style={btnStyle}>保存</button>
          {hasOverride && <button onClick={() => void clearOverride()} style={btnStyle}>清除覆盖</button>}
          <button onClick={() => void load()} style={btnStyle}>刷新</button>
          <span style={{ opacity: 0.6, fontSize: 11 }}>{msg || (loaded && effectiveAsr ? `当前 ASR: ${effectiveAsr}` : '')}</span>
        </div>
      </div>
    </div>
  )
}

export function apply(ctx: { slots: SlotsService }): void {
  // 设置页全局卡片（参考 dsh-vision 的 settings.section）
  ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'dsh-ai-recorder-settings',
    order: 30,
    label: () => '录音卡后端',
  }, GlobalSettingsCard)), 'dsh-ai-recorder: settings.section')
  // 会话内覆盖面板
  ctx.effect(() => ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'dsh-ai-recorder-panel',
    order: 30,
    label: () => '录音卡后端',
  }, SessionPanelView)), 'dsh-ai-recorder: conversation.view')
}