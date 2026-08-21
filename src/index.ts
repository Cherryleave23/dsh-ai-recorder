/**
 * dsh-ai-recorder — AI 录音卡(CB08/QS668)后端（阶段1+2+3）。
 *
 * 路由总表：
 *   POST /api/qs668/transcribe            官方兼容（audioBase64+language+codec）
 *   POST /api/recorder/audio              上传转写（带 sessionId 则追加会话）
 *   POST /api/recorder/stream             实时分段（带 sessionId 则追加会话）
 *   POST /api/recorder/session            新建/复用会话
 *   GET  /api/recorder/session/<id>       会话详情
 *   GET  /api/recorder/session/<id>/events SSE 事件流
 *   POST /api/recorder/session/<id>/process 处理器执行（work/summary/自定义）
 *   POST /api/recorder/session/<id>/revise  事后修订（默认 text）
 *   GET  /api/recorder/sessions           会话列表
 *   GET  /api/recorder/notes              笔记列表
 *   GET  /api/recorder/notes/<id>         笔记 raw md
 *   POST /api/recorder/batch              批量转写入会话
 *   GET  /api/recorder/jobs               批处理状态
 *   GET  /api/recorder/files              历史记录
 *   GET  /api/recorder/health             健康检查
 */
import type { Context } from '@deepseek-ai/cordis'
import type LlmService from '@deepseek-ai/dsh-llm'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId, type Session, type SessionStore } from '@deepseek-ai/dsh-session'
import { mkdirSync, existsSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Config } from './config.js'
import { createProvider, disposeQwenWorker } from './stt.js'
import { SessionManager, type Session as RecorderSession } from './session.js'
import { NoteStore } from './notes.js'
import { Pipeline, type ModelSelection } from './pipeline.js'
import { BleCentral, type BleEvent } from './ble.js'
import { normalizeAudio } from './audio.js'
import { installSelfCleanup } from './self-cleanup.js'

export const name = 'dsh-ai-recorder'
export const inject = ['webServer', 'llm', 'agentDefaultModel', 'agents', 'sessions']
export { Config }

/** 本插件实际消费的官方 service 最小类型面（只声明用到的字段）。 */
type AppContext = Context & {
  webServer: {
    register(route: { kind: 'exact' | 'prefix'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }): () => void
  }
  llm: LlmService
  agentDefaultModel: { currentSelection(): ModelSelection }
  agents: { get(sessionId: SessionId): Agent | undefined }
  sessions: SessionStore
}

const VERSION = '0.1.1'
const MAX_BODY = 64 * 1024 * 1024 // 64MB

interface RecordItem {
  id: string
  ts: string
  sessionId?: string
  ext: string
  bytes: number
  language?: string
  mode?: string
  text: string
  provider: string
  ok: boolean
}

interface Job {
  id: string
  status: 'running' | 'done' | 'failed'
  total: number
  done: number
  okCount: number
  failed: number
  createdAt: string
  error?: string
}

export function apply(ctx: AppContext, config: Config): void {
  const outDir = config.outDir || join(homedir(), '.dsh', 'recorder-backend')
  const historyFile = join(outDir, 'history.jsonl')
  mkdirSync(outDir, { recursive: true })
  if (!existsSync(historyFile)) writeFileSync(historyFile, '', 'utf8')

  const provider = createProvider(config.sttProvider)
  const sessions = new SessionManager(outDir)
  const notes = new NoteStore(outDir)
  const pipeline = new Pipeline()
  const jobs = new Map<string, Job>()

  const pluginLogFile = join(outDir, 'plugin.log')
  const log = (...args: unknown[]): void => {
    const line = '[' + new Date().toISOString() + '] ' + args.map(String).join(' ')
    ctx.logger?.info?.('[dsh-ai-recorder]', ...args)
    try { appendFileSync(pluginLogFile, line + '\n', 'utf8') } catch { /* ignore */ }
  }

  // 卸载自检：检测到本插件被移除后自动清理自持状态（保留录音/模型/会话/笔记资产）
  const disposeSelfCleanup = installSelfCleanup(ctx, outDir, async () => {
    ble.dispose()
    await disposeQwenWorker()
  })

  // ═══ ASR 环境探测（可移植：显式配置 > 运行时配置 > 环境变量 > 默认目录）═══
  const whisperDir = process.env.DSH_RECORDER_WHISPER_DIR || join(outDir, 'whisper')
  const defaultFwModelDir = config.fasterWhisperModelDir || join(whisperDir, 'faster-whisper-base')
  const FW_FILES = ['model.bin', 'config.json', 'tokenizer.json', 'vocabulary.txt'] as const
  // python 解释器探测（显式配置优先，其次常见命令）
  const pythonCandidates = config.pythonPath && config.pythonPath !== 'python'
    ? [config.pythonPath]
    : [process.env.DSH_RECORDER_PYTHON, 'python', 'python3', 'py'].filter(Boolean) as string[]
  const pythonBin = pythonCandidates.find((p) => {
    try {
      execFileSync(p, ['--version'], { stdio: 'ignore', timeout: 8000 })
      return true
    } catch { return false }
  }) ?? null

  // ═══ 运行时配置（可动态选择模式/ASR/投递目标/模型目录，持久化到 outDir/runtime-config.json）═══
  interface RuntimeConfig {
    sttProvider: typeof config.sttProvider
    autoProcessMode: 'none' | 'work' | 'summary'
    deliverWakeup: boolean
    language: string
    fwModelDir: string
    openaiCompatBaseUrl: string
    qwenPythonPath: string
    qwenModelDir: string
    bleAutoSync: boolean
    bleSyncDeleteAfter: boolean
  }
  const runtimeFile = join(outDir, 'runtime-config.json')
  const runtimeDefaults: RuntimeConfig = {
    sttProvider: config.sttProvider,
    autoProcessMode: config.autoProcessMode,
    deliverWakeup: config.deliverWakeup,
    language: config.language,
    fwModelDir: defaultFwModelDir,
    openaiCompatBaseUrl: '',
    qwenPythonPath: config.qwenPythonPath,
    qwenModelDir: config.qwenModelDir,
    bleAutoSync: config.bleAutoSync,
    bleSyncDeleteAfter: config.bleSyncDeleteAfter,
  }
  let runtime: RuntimeConfig = runtimeDefaults
  try {
    const saved = JSON.parse(readFileSync(runtimeFile, 'utf8')) as Partial<RuntimeConfig>
    runtime = { ...runtimeDefaults, ...saved }
  } catch { /* 无保存配置 */ }

  // whisper.cpp 就绪探测（CLI 可执行 + 模型存在）
  const whisperCppReady = (() => {
    try {
      execFileSync(config.whisperCppCliPath, ['--help'], { stdio: 'ignore', timeout: 8000 })
    } catch { return false }
    if (config.whisperCppModelPath !== 'models/ggml-base.bin') {
      return existsSync(config.whisperCppModelPath)
    }
    return false // 默认模型路径未配置 → 视为未就绪
  })()

  // 动态函数（基于 runtime.fwModelDir，支持运行时改模型目录）
  const fwReady = (): boolean => FW_FILES.every((f) => existsSync(join(runtime.fwModelDir, f)))
  const getSttCfg = (): typeof config => ({
    ...config,
    pythonPath: pythonBin ?? config.pythonPath,
    fasterWhisperModelDir: runtime.fwModelDir,
    fasterWhisperScript: config.fasterWhisperScript || join(dirname(runtime.fwModelDir), 'transcribe.py'),
    openaiCompatBaseUrl: runtime.openaiCompatBaseUrl || config.openaiCompatBaseUrl,
    qwenPythonPath: runtime.qwenPythonPath,
    qwenModelDir: runtime.qwenModelDir,
  })
  /** 解析实际生效的 STT：不可用的选择一律回退 mock（"只显示有的"的服务端保障） */
  const resolveSttKind = (p: typeof config.sttProvider): typeof config.sttProvider => {
    if (p === 'mock') return fwReady() && pythonBin ? 'faster-whisper-py' : 'mock'
    if (p === 'faster-whisper-py') return fwReady() && pythonBin ? 'faster-whisper-py' : 'mock'
    if (p === 'openai-compat') return runtime.openaiCompatBaseUrl ? 'openai-compat' : 'mock'
    if (p === 'whisper-cpp-cli') return whisperCppReady ? 'whisper-cpp-cli' : 'mock'
    if (p === 'qwen-audio-py') return qwenReady() ? 'qwen-audio-py' : 'mock'
    return p
  }
  /** qwen-audio-py 就绪：venv python 存在 + 模型目录含 config.json 与 safetensors */
  const qwenReady = (): boolean => {
    if (!runtime.qwenPythonPath || !runtime.qwenModelDir) return false
    try {
      execFileSync(runtime.qwenPythonPath, ['--version'], { stdio: 'ignore', timeout: 8000 })
    } catch {
      return false
    }
    return existsSync(join(runtime.qwenModelDir, 'config.json'))
  }
  /** ASR 状态报告（面板展示 + 安装引导；available 列表只含"可用"项） */
  const asrStatus = () => {
    const fw = fwReady() && pythonBin !== null
    const openai = Boolean(runtime.openaiCompatBaseUrl)
    const qwen = qwenReady()
    return {
      engine: 'faster-whisper-py',
      modelDir: runtime.fwModelDir,
      modelReady: fwReady(),
      python: pythonBin,
      available: [
        { id: 'mock', label: 'mock（占位）', ready: true, detail: '始终可用（调试/占位）' },
        { id: 'faster-whisper-py', label: 'faster-whisper（本地）', ready: fw, detail: fw ? '模型与 Python 就绪' : '需模型文件 + pip install faster-whisper' },
        { id: 'qwen-audio-py', label: 'Qwen3-ASR 1.7B（本地 GPU）', ready: qwen, detail: qwen ? `模型就绪（${runtime.qwenModelDir}）` : '需 qwen venv + 模型目录（config.json）' },
        { id: 'whisper-cpp-cli', label: 'whisper.cpp（本地）', ready: whisperCppReady, detail: whisperCppReady ? 'CLI 与模型就绪' : '需 whisper-cli 与 ggml 模型' },
        { id: 'openai-compat', label: 'OpenAI 兼容（外部 API）', ready: openai, detail: openai ? `端点: ${runtime.openaiCompatBaseUrl}` : '需配置端点（POST /api/recorder/config 设置 openaiCompatBaseUrl）' },
      ],
      missing: [
        ...(pythonBin ? [] : ['Python 解释器缺失（需安装 Python 3.8+ 与 faster-whisper 包）']),
        ...FW_FILES.filter((f) => !existsSync(join(runtime.fwModelDir, f))).map((f) => `模型文件缺失: ${f}`),
      ],
      installHint: `将 faster-whisper-base 的 4 个文件（model.bin / config.json / tokenizer.json / vocabulary.txt）放入目录: ${runtime.fwModelDir}`,
    }
  }
  let stt = createProvider(resolveSttKind(runtime.sttProvider))
  const saveRuntime = (): void => {
    try { writeFileSync(runtimeFile, JSON.stringify(runtime, null, 2), 'utf8') } catch { /* ignore */ }
  }
  if (resolveSttKind(runtime.sttProvider) !== runtime.sttProvider) {
    log('STT 生效提供方: ' + resolveSttKind(runtime.sttProvider) + '（配置: ' + runtime.sttProvider + '，模型: ' + runtime.fwModelDir + '）')
  }

  /** 模式提示词：work=直接给（+任务指令）；summary=让 AGENT 按会议记录处理 */
  function modeInstruction(mode: string, paramsInstruction?: unknown): string | undefined {
    if (mode === 'work') {
      return typeof paramsInstruction === 'string' && paramsInstruction
        ? paramsInstruction
        : '请处理以上录音转写内容并执行任务。'
    }
    if (mode === 'summary') {
      return '请将以上录音转写内容作为会议记录处理，生成一份结构化会议纪要（Markdown，含主题/要点/行动项/决议）。'
    }
    return undefined
  }

  function sendJson(res: ServerResponse, code: number, obj: unknown): void {
    const body = JSON.stringify(obj)
    res.writeHead(code, {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type, x-recorder-token',
    })
    res.end(body)
  }

  function readBody(req: IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      let size = 0
      req.on('data', (c: Buffer) => {
        size += c.length
        if (size > MAX_BODY) {
          req.destroy()
          reject(new Error('body too large'))
          return
        }
        chunks.push(c)
      })
      req.on('end', () => resolve(Buffer.concat(chunks)))
      req.on('error', reject)
    })
  }

  function authOk(req: IncomingMessage): boolean {
    return !config.token || req.headers['x-recorder-token'] === config.token
  }

  function b64ToBytes(b64: string): Uint8Array {
    const buf = Buffer.from(String(b64 ?? '').trim(), 'base64')
    return new Uint8Array(buf)
  }

  function appendHistory(item: RecordItem): void {
    try {
      appendFileSync(historyFile, JSON.stringify(item) + '\n', 'utf8')
    } catch (e) {
      log('history append failed', String(e))
    }
  }

  function readHistory(limit: number): RecordItem[] {
    try {
      const lines = readFileSync(historyFile, 'utf8').trim().split('\n').filter(Boolean)
      const items = lines.map((l) => {
        try { return JSON.parse(l) as RecordItem } catch { return null }
      }).filter((x): x is RecordItem => x !== null)
      return items.slice(-limit).reverse()
    } catch {
      return []
    }
  }

  /** 转写核心：bytes → STT；带 sessionId 则追加会话分段；autoProcessMode 非 none 时自动投递。
   *  会话级覆盖（按绑定 DSH 会话）优先于全局 runtime。 */
  async function transcribeToSession(body: any, hintExt: 'opus' | 'ogg' | 'wav' | 'auto') {
    const sessionId = typeof body.sessionId === 'string' && body.sessionId ? body.sessionId : undefined
    const bytes = b64ToBytes(body.audioBase64 ?? body.audio ?? '')
    if (!bytes.length) throw new Error('缺少 audioBase64/audio 音频数据')

    // 先打开/绑定会话，解析会话级覆盖配置（语言/ASR/模式/唤醒）
    let resolved: { runtime: RuntimeConfig; override: SessionOverride | undefined } | undefined
    if (sessionId) {
      sessions.open(sessionId, { language: typeof body.language === 'string' ? body.language : undefined, mode: typeof body.mode === 'string' ? body.mode : undefined })
      if (!sessions.get(sessionId)?.meta?.dshSessionId) {
        const target = getDeliverTarget()
        if (target) sessions.bindDsh(sessionId, target)
      }
      resolved = resolveSessionConfig(sessions.get(sessionId)?.meta?.dshSessionId as string | undefined)
    }
    const eff = resolved?.runtime ?? runtime
    const language = typeof body.language === 'string' && body.language.trim() ? body.language.trim() : eff.language
    const mode = typeof body.mode === 'string' ? body.mode : (eff.autoProcessMode !== 'none' ? eff.autoProcessMode : undefined)

    // STT：会话覆盖的 provider 与全局不同则临时创建实例
    const effSttKind = resolveSttKind(eff.sttProvider)
    const sttFor = effSttKind === resolveSttKind(runtime.sttProvider) ? stt : createProvider(effSttKind)
    const result = await sttFor({ bytes, ext: hintExt, language, sessionId }, getSttCfg())
    const item: RecordItem = {
      id: randomUUID(),
      ts: new Date().toISOString(),
      sessionId,
      ext: hintExt,
      bytes: bytes.length,
      language,
      mode,
      text: result.text,
      provider: result.provider,
      ok: true,
    }
    appendHistory(item)

    let session: ReturnType<SessionManager['append']> | undefined
    if (sessionId) {
      session = sessions.append(sessionId, { ext: hintExt, bytes: bytes.length, text: result.text, provider: result.provider })
      // 上传后自动按（会话覆盖后的）模式处理并投递
      const sessionAfter = sessions.get(sessionId)
      if (eff.autoProcessMode !== 'none' && sessionAfter?.meta?.dshSessionId && !body.noProcess) {
        const autoMode = eff.autoProcessMode
        const instruction = modeInstruction(autoMode, body.params?.instruction)
        const delivered = deliverToDsh(sessionAfter, { mode: autoMode, instruction, wakeup: eff.deliverWakeup })
        if (!delivered.ok) log('自动投递失败:', delivered.error ?? '')
      }
    }
    return {
      recordId: item.id,
      text: result.text,
      provider: result.provider,
      mode: mode ?? null,
      sessionId: session ? session.id : sessionId ?? null,
      segments: session ? session.segments.length : undefined,
      transcript: session?.transcript,
    }
  }

  const pipelineDeps = () => ({
    llm: ctx.llm,
    getDefaultModel: () => {
      try { return ctx.agentDefaultModel?.currentSelection?.() ?? null } catch { return null }
    },
    cfg: config,
    sessions,
    notes,
    log,
  })

  /** 会话级配置覆盖（每个 DSH 会话可独立设置，无覆盖=用全局默认） */
  interface SessionOverride {
    autoProcessMode?: 'none' | 'work' | 'summary'
    sttProvider?: typeof config.sttProvider
    language?: string
    deliverWakeup?: boolean
  }
  const sessionCfgDir = join(outDir, 'session-configs')
  mkdirSync(sessionCfgDir, { recursive: true })
  const sessionCfgFile = (dshSessionId: string): string => join(sessionCfgDir, encodeURIComponent(dshSessionId) + '.json')
  const readSessionOverride = (dshSessionId: string): SessionOverride | undefined => {
    try {
      const p = sessionCfgFile(dshSessionId)
      if (!existsSync(p)) return undefined
      return JSON.parse(readFileSync(p, 'utf8')) as SessionOverride
    } catch { return undefined }
  }
  const writeSessionOverride = (dshSessionId: string, ov: SessionOverride): void => {
    writeFileSync(sessionCfgFile(dshSessionId), JSON.stringify(ov, null, 2), 'utf8')
  }
  const clearSessionOverride = (dshSessionId: string): void => {
    try { writeFileSync(sessionCfgFile(dshSessionId), JSON.stringify({ __cleared: true }), 'utf8') } catch { /* ignore */ }
  }
  /** 解析某 DSH 会话的有效配置（覆盖 > 全局 runtime） */
  const resolveSessionConfig = (dshSessionId: string | undefined): { runtime: RuntimeConfig; override: SessionOverride | undefined } => {
    if (!dshSessionId) return { runtime, override: undefined }
    const ov = readSessionOverride(dshSessionId)
    if (!ov) return { runtime, override: undefined }
    return {
      runtime: {
        ...runtime,
        autoProcessMode: ov.autoProcessMode ?? runtime.autoProcessMode,
        sttProvider: ov.sttProvider ?? runtime.sttProvider,
        deliverWakeup: ov.deliverWakeup ?? runtime.deliverWakeup,
        language: ov.language ?? runtime.language,
      },
      override: ov,
    }
  }

  /** 把录音转写文本 + 模式提示词投递给绑定的 DSH 会话 AGENT（普通 user 消息 + followup 唤醒）。
   *  work=直接给（+用户任务指令）；summary=让 AGENT 按会议记录处理。 */
  function deliverToDsh(session: RecorderSession, opts: { mode: string; instruction?: string; wakeup?: boolean }): { ok: boolean; error?: string } {
    const dshSessionId = session.meta?.dshSessionId as string | undefined
    if (!dshSessionId) return { ok: false, error: '未绑定 DSH 会话' }
    const agent = ctx.agents?.get(SessionId(dshSessionId))
    if (!agent) return { ok: false, error: '未找到 DSH agent: ' + dshSessionId }
    const transcript = session.transcript || '(空转写)'
    try {
      // 结构化消息：明确区分"转写内容"与"处理指令"，避免 AGENT 混淆
      const text = [
        '【录音转写内容】',
        transcript,
        '',
        '【处理指令】',
        opts.instruction ?? '（无）',
      ].join('\n')
      const msg = createUserMessage({
        source: { kind: 'user' },
        content: [{ type: 'text', text }],
      })
      if (opts.wakeup ?? config.deliverWakeup) agent.followup(msg)
      else agent.inject(msg)
      log('已投递给 DSH agent:', dshSessionId, 'mode=' + opts.mode, 'wakeup=' + (opts.wakeup ?? config.deliverWakeup))
      return { ok: true }
    } catch (e) {
      log('DSH 投递失败:', String(e))
      return { ok: false, error: String(e) }
    }
  }

  /** 默认投递目标（DSH 会话 id）：由桌面端面板选择；录音会话未显式指定时自动流转到它 */
  const deliverTargetFile = join(outDir, 'deliver-target.json')
  function getDeliverTarget(): string | undefined {
    try {
      const j = JSON.parse(readFileSync(deliverTargetFile, 'utf8')) as { sessionId?: string }
      return typeof j.sessionId === 'string' && j.sessionId ? j.sessionId : undefined
    } catch {
      return undefined
    }
  }
  function setDeliverTarget(sessionId: string): void {
    try {
      writeFileSync(deliverTargetFile, JSON.stringify({ sessionId, at: new Date().toISOString() }, null, 2), 'utf8')
    } catch (e) {
      log('写入默认投递目标失败:', String(e))
    }
  }

  /** 投递任意文本到指定 DSH 会话（待审批路由用）：结构化消息 = 【录音转写内容】+【处理指令】 */
  function deliverTextToDsh(dshSessionId: string, content: string, instruction?: string, wakeup?: boolean): { ok: boolean; error?: string } {
    const agent = ctx.agents?.get(SessionId(dshSessionId))
    if (!agent) return { ok: false, error: '未找到 DSH agent: ' + dshSessionId }
    try {
      const text = [
        '【录音转写内容】',
        content || '(空转写)',
        '',
        '【处理指令】',
        instruction ?? '（无）',
      ].join('\n')
      const msg = createUserMessage({
        source: { kind: 'user' },
        content: [{ type: 'text', text }],
      })
      if (wakeup ?? config.deliverWakeup) agent.followup(msg)
      else agent.inject(msg)
      log('已投递文本给 DSH agent:', dshSessionId, 'wakeup=' + (wakeup ?? config.deliverWakeup))
      return { ok: true }
    } catch (e) {
      log('DSH 投递失败:', String(e))
      return { ok: false, error: String(e) }
    }
  }

  // ═══ 蓝牙直连（自实现 BLE Central）═══
  // 当前实时流会话（bleLive != null 表示正在实时收流）
  let bleLive: { sessionId: string } | null = null
  const ble = new BleCentral(log, (ev) => onBleEvent(ev))
  let bleReady: { ok: boolean; error?: string } | null = null
  /** 探测 python/bleak → 启动守护进程（幂等；首次自动 pip install bleak） */
  async function ensureBle(): Promise<{ ok: boolean; error?: string }> {
    if (bleReady?.ok) return bleReady
    if (!bleReady) bleReady = ble.prepare(pythonCandidates)
    if (!bleReady.ok) return bleReady
    try {
      await ble.ensureStarted()
      bleReady = { ok: true }
    } catch (e) {
      bleReady = { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    return bleReady
  }
  /** BLE 实时段：转写入录音会话（不自动投递，避免逐段轰炸 AGENT） */
  async function ingestBleAudio(sessionId: string, b64: string, ext: 'opus' | 'wav'): Promise<void> {
    await transcribeToSession({ sessionId, audioBase64: b64, ext, noProcess: true }, ext)
  }
  /** 实时流结束（设备停止/手动停止/断连）：按配置模式投递一次 */
  function finalizeBleLive(): void {
    if (!bleLive) return
    const { sessionId } = bleLive
    bleLive = null
    const s = sessions.get(sessionId)
    if (!s) return
    const dshSessionId = s.meta?.dshSessionId as string | undefined
    if (!dshSessionId) return
    const eff = resolveSessionConfig(dshSessionId).runtime
    if (eff.autoProcessMode === 'none') return
    const instruction = modeInstruction(eff.autoProcessMode)
    const delivered = deliverToDsh(s, { mode: eff.autoProcessMode, instruction, wakeup: eff.deliverWakeup })
    log('BLE 实时流结束，模式投递:', eff.autoProcessMode, delivered.ok ? 'ok' : delivered.error ?? '')
  }
  function onBleEvent(ev: BleEvent): void {
    if (ev.event === 'stream') {
      if (ev.kind === 'audio' && typeof ev.data === 'string' && bleLive) {
        ingestBleAudio(bleLive.sessionId, ev.data, 'opus').catch((e) => log('BLE 实时段转写失败:', String(e)))
      } else if (ev.kind === 'stopped') {
        finalizeBleLive()
      }
    } else if (ev.event === 'disconnected') {
      log('BLE 连接断开，进入自动重连')
      finalizeBleLive()
    } else if (ev.event === 'reconnecting') {
      log('BLE 自动重连中（第', String(ev.attempt ?? '?'), '次）')
    } else if (ev.event === 'connected') {
      log('BLE 已连接:', String(ev.address ?? ''), 'MTU=' + String(ev.mtu ?? '?'))
      // 连接后自动同步离线录音（可配置关闭）
      if (runtime.bleAutoSync) {
        runSync().catch((e) => log('连接后自动同步失败:', String(e)))
      }
    }
  }

  // ═══ 离线录音同步（下载 → 存储 → 转写 → 投递/待审批）+ 待审批链 ═══
  const recordingsDir = join(outDir, 'recordings')
  mkdirSync(recordingsDir, { recursive: true })
  const syncIndexFile = join(outDir, 'sync-index.json')
  const pendingFile = join(outDir, 'pending-deliveries.json')
  interface SyncIndexEntry {
    size: number
    time: number
    saved: string
    ext: 'wav' | 'ogg'
    spokenAt: string
    text: string
    syncedAt: string
    failed?: string
  }
  type SyncIndex = Record<string, SyncIndexEntry>
  interface PendingItem {
    id: string
    name: string
    spokenAt: string
    duration: number
    text: string
    status: 'pending' | 'delivered' | 'rejected'
    targetSessionId?: string
    createdAt: string
    deliveredAt?: string
  }
  interface SyncState {
    running: boolean
    lastSyncAt: string | null
    lastResult: { downloaded: number; skipped: number; failed: number; delivered: number; pendingAdded: number } | null
    lastError: string | null
  }
  const syncState: SyncState = { running: false, lastSyncAt: null, lastResult: null, lastError: null }

  const readSyncIndex = (): SyncIndex => {
    try { return JSON.parse(readFileSync(syncIndexFile, 'utf8')) as SyncIndex } catch { return {} }
  }
  const writeSyncIndex = (idx: SyncIndex): void => {
    try { writeFileSync(syncIndexFile, JSON.stringify(idx, null, 2), 'utf8') } catch { /* ignore */ }
  }
  const readPending = (): PendingItem[] => {
    try { return JSON.parse(readFileSync(pendingFile, 'utf8')) as PendingItem[] } catch { return [] }
  }
  const writePending = (items: PendingItem[]): void => {
    try { writeFileSync(pendingFile, JSON.stringify(items, null, 2), 'utf8') } catch { /* ignore */ }
  }

  /** 从设备文件名解析说话时间：note20260820-214813 → '2026-08-20 21:48:13' */
  function spokenFromName(name: string): string {
    const m = name.match(/note(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/)
    if (!m) return '未知时间'
    return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`
  }

  /** 下载音频落盘（WAV 原样；OPUS 封装为可播放 Ogg），按月份归档 */
  function storeRecordingFile(name: string, dl: { data: string; ext: 'wav' | 'opus' }): { path: string; ext: 'wav' | 'ogg' } {
    const raw = b64ToBytes(dl.data)
    const norm = normalizeAudio(raw, dl.ext)
    const now = new Date()
    const monthDir = join(recordingsDir, `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
    mkdirSync(monthDir, { recursive: true })
    const base = name.replace(/[^\w.\-]/g, '_').replace(/\.+$/, '')
    const out = join(monthDir, `${base}.${norm.ext}`)
    writeFileSync(out, norm.bytes)
    return { path: out, ext: norm.ext }
  }

  let syncRunningGuard = false
  /** 离线录音同步：拉取未处理文件 → 存盘 → 转写 → 按模式投递/进待审批。mode 缺省取运行时 autoProcessMode。 */
  async function runSync(opts: { mode?: string; deleteAfter?: boolean; force?: boolean } = {}): Promise<SyncState['lastResult']> {
    if (syncRunningGuard) throw new Error('同步已在运行中')
    syncRunningGuard = true
    syncState.running = true
    syncState.lastError = null
    try {
      const entries = await ble.filelist()
      const index = readSyncIndex()
      // 设备上已删除的文件 → 清理索引（无二次拉取风险）
      const live = new Set(entries.map((e) => e.name))
      for (const k of Object.keys(index)) if (!live.has(k)) delete index[k]

      const mode = opts.mode ?? runtime.autoProcessMode ?? 'none'
      const deleteAfter = opts.deleteAfter ?? runtime.bleSyncDeleteAfter ?? false
      const force = opts.force ?? false
      const target = getDeliverTarget()
      const result: SyncState['lastResult'] = { downloaded: 0, skipped: 0, failed: 0, delivered: 0, pendingAdded: 0 }
      const newTexts: { name: string; spokenAt: string; duration: number; text: string }[] = []
      const failedNames: string[] = []

      // 从小到大处理：小文件快速出结果，大文件（如 20+ 分钟长录音）排最后慢慢传
      const ordered = [...entries].sort((a, b) => a.size - b.size)
      for (const e of ordered) {
        const prev = index[e.name]
        if (prev && !prev.failed && prev.size === e.size && prev.text) {
          result.skipped++
          continue
        }
        if (prev?.failed && !force) {
          // 标记 failed 的不自动重试（避免坏文件反复阻塞）；force=true 时重试
          result.skipped++
          continue
        }
        log('同步: 处理', e.name, `${e.time}s/${e.size}B`)
        try {
          const dl = await ble.download(e.name)
          const saved = storeRecordingFile(e.name, dl)
          // noProcess：同步批次统一处理投递，避免逐条自动投递
          const tr = await transcribeToSession({ sessionId: undefined, audioBase64: dl.data, ext: dl.ext, noProcess: true }, dl.ext)
          const spokenAt = spokenFromName(e.name)
          index[e.name] = {
            size: e.size, time: e.time, saved: saved.path, ext: saved.ext,
            spokenAt, text: tr.text, syncedAt: new Date().toISOString(),
          }
          newTexts.push({ name: e.name, spokenAt, duration: e.time, text: tr.text })
          result.downloaded++
          log('同步: 完成', e.name, '->', saved.path, '文本:', tr.text.slice(0, 40))
          if (deleteAfter) {
            try { await ble.deleteFile(e.name, e.time, e.size) } catch (err) { log('同步后删除失败:', e.name, String(err)) }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          index[e.name] = { size: e.size, time: e.time, saved: '', ext: 'wav', spokenAt: spokenFromName(e.name), text: '', syncedAt: new Date().toISOString(), failed: msg.slice(0, 200) }
          result.failed++
          failedNames.push(e.name)
          log('同步: 失败', e.name, msg.slice(0, 120))
        }
      }
      writeSyncIndex(index)

      // 投递分流：summary=拼接一次投递；work=进待审批链；none/无目标=本地留存
      if (newTexts.length > 0 && target && mode !== 'none') {
        if (mode === 'summary') {
          const instruction = modeInstruction('summary')
          const body = newTexts.map((t) => `[${t.spokenAt}]${t.duration ? `（${t.duration}s）` : ''}\n${t.text}`).join('\n\n')
          const delivered = deliverTextToDsh(target, body, instruction, runtime.deliverWakeup)
          if (delivered.ok) result.delivered = newTexts.length
          else syncState.lastError = delivered.error ?? 'summary 投递失败'
        } else if (mode === 'work') {
          // 待审批链：每条一条待审批，用户选择目标会话后投递
          const pending = readPending()
          for (const t of newTexts) {
            pending.push({
              id: randomUUID(),
              name: t.name,
              spokenAt: t.spokenAt,
              duration: t.duration,
              text: t.text,
              status: 'pending',
              createdAt: new Date().toISOString(),
            })
          }
          writePending(pending)
          result.pendingAdded = newTexts.length
        }
      }

      syncState.lastSyncAt = new Date().toISOString()
      syncState.lastResult = result
      log('离线录音同步完成:', JSON.stringify(result), failedNames.length ? '失败: ' + failedNames.join(',') : '')
      return result
    } catch (e) {
      syncState.lastError = e instanceof Error ? e.message : String(e)
      log('离线录音同步失败:', syncState.lastError)
      throw e
    } finally {
      syncRunningGuard = false
      syncState.running = false
    }
  }

  /** 从官方 sessionTitle 投影（可选 service，ctx.get 探测）读取会话标题；宿主未提供时返回 null。 */
  function readSessionTitle(sessionId: string): string | null {
    try {
      const session = ctx.sessions.get(SessionId(sessionId))
      if (!session) return null
      const titleService = ctx.get('sessionTitle') as { get(session: Session): { title: string } | undefined } | undefined
      const title = titleService?.get(session)?.title
      return typeof title === 'string' && title ? title : null
    } catch {
      return null
    }
  }

  /** 列出宿主全部 DSH 会话（id + 标题，供面板选择流转目标）。 */
  function listDshSessions() {
    try {
      return ctx.sessions.list().map((s) => {
        const id = String(s.id)
        return { id, title: readSessionTitle(id), createdAt: s.header?.createdAt ?? null }
      }).sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
    } catch (e) {
      log('列出 DSH 会话失败:', String(e))
      return []
    }
  }

  // ═══ 路由注册 ═══
  const activeSse = new Set<ServerResponse>()
  let disposed = false
  const batchAbort = new AbortController()
  ctx.effect(() => {
    const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (req.method === 'OPTIONS') return sendJson(res, 204, {})
      if (req.method !== 'GET' && req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })

      let pathname = '/'
      try { pathname = new URL(req.url ?? '/', 'http://x').pathname } catch { /* ignore */ }

      const isQ = pathname.startsWith('/api/qs668')
      const isR = pathname.startsWith('/api/recorder')
      if (!isQ && !isR) return sendJson(res, 404, { ok: false, error: 'not found: ' + pathname })
      if (!authOk(req)) return sendJson(res, 403, { ok: false, error: 'invalid token' })

      try {
        // ── GET ──
        if (req.method === 'GET') {
          if (isR && pathname.endsWith('/health')) {
            return sendJson(res, 200, { ok: true, name, version: VERSION, sttProvider: config.sttProvider, outDir, processors: pipeline.list() })
          }
          if (isR && pathname.endsWith('/files')) {
            const limit = Number(new URL(req.url ?? '/', 'http://x').searchParams.get('limit') ?? config.historyLimit) || config.historyLimit
            return sendJson(res, 200, { ok: true, items: readHistory(limit) })
          }
          if (isR && pathname.endsWith('/sessions')) {
            return sendJson(res, 200, { ok: true, items: sessions.list() })
          }
          if (isR && pathname.endsWith('/notes')) {
            return sendJson(res, 200, { ok: true, items: notes.list() })
          }
          if (isR && pathname.endsWith('/jobs')) {
            return sendJson(res, 200, { ok: true, items: [...jobs.values()].reverse() })
          }
          if (isR && pathname.endsWith('/dsh-sessions')) {
            return sendJson(res, 200, { ok: true, items: listDshSessions(), defaultTarget: getDeliverTarget() ?? null })
          }
          if (isR && pathname.endsWith('/deliver-target')) {
            return sendJson(res, 200, { ok: true, sessionId: getDeliverTarget() ?? null })
          }
          if (isR && pathname.endsWith('/config')) {
            const qSessionId = new URL(req.url ?? '/', 'http://x').searchParams.get('sessionId') ?? undefined
            const eff = resolveSessionConfig(qSessionId)
            return sendJson(res, 200, {
              ok: true,
              config: eff.runtime,
              override: eff.override ?? null,
              effectiveSttProvider: resolveSttKind(eff.runtime.sttProvider),
              asrStatus: asrStatus(),
            })
          }
          // /api/recorder/session/<id> 与 /api/recorder/session/<id>/events
          const sessMatch = pathname.match(/^\/api\/recorder\/session\/([^/]+)(\/events)?$/)
          if (isR && sessMatch) {
            const [, sid, isEvents] = sessMatch
            if (isEvents) {
              // SSE 事件流（长连接：卸载时由 activeSse 统一关闭）
              const session = sessions.get(sid)
              if (!session) return sendJson(res, 404, { ok: false, error: 'session not found: ' + sid })
              res.writeHead(200, {
                'content-type': 'text/event-stream; charset=utf-8',
                'cache-control': 'no-cache',
                'connection': 'keep-alive',
                'access-control-allow-origin': '*',
              })
              res.write(`data: ${JSON.stringify({ type: 'hello', sessionId: sid, transcript: session.transcript })}\n\n`)
              activeSse.add(res)
              const off = sessions.on(sid, (ev) => {
                try { res.write(`data: ${JSON.stringify(ev)}\n\n`) } catch { /* client gone */ }
              })
              const cleanup = (): void => {
                off()
                activeSse.delete(res)
                try { res.end() } catch { /* ignore */ }
              }
              req.on('close', cleanup)
              return // 长连接，不 end
            }
            const session = sessions.get(sid)
            if (!session) return sendJson(res, 404, { ok: false, error: 'session not found: ' + sid })
            return sendJson(res, 200, { ok: true, session })
          }
          // /api/recorder/notes/<id>
          const noteMatch = pathname.match(/^\/api\/recorder\/notes\/([^/]+)$/)
          if (isR && noteMatch) {
            const hit = notes.read(decodeURIComponent(noteMatch[1]))
            if (!hit) return sendJson(res, 404, { ok: false, error: 'note not found' })
            res.writeHead(200, {
              'content-type': 'text/markdown; charset=utf-8',
              'access-control-allow-origin': '*',
            })
            res.end(hit.md)
            return
          }
          // ── BLE 直连状态 / 文件列表 ──
          if (isR && pathname.endsWith('/ble/status')) {
            const st = await ensureBle()
            return sendJson(res, 200, {
              ok: true,
              ready: st.ok,
              error: st.ok ? null : st.error ?? null,
              python: ble.python,
              bleak: ble.bleakVersion,
              daemonRunning: ble.running,
              connected: ble.connected,
              reconnecting: ble.reconnecting,
              address: ble.address,
              mtu: ble.mtu,
              battery: ble.battery,
              realtimeActive: ble.realtimeActive,
              lastActivity: ble.lastActivity,
              sync: syncState,
            })
          }
          if (isR && pathname.endsWith('/ble/filelist')) {
            const st = await ensureBle()
            if (!st.ok) return sendJson(res, 500, { ok: false, error: st.error ?? 'BLE 未就绪' })
            try {
              const entries = await ble.filelist()
              return sendJson(res, 200, { ok: true, entries })
            } catch (e) {
              return sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) })
            }
          }
          if (isR && pathname.endsWith('/ble/sync/status')) {
            return sendJson(res, 200, { ok: true, ...syncState })
          }
          if (isR && pathname.endsWith('/ble/pending')) {
            return sendJson(res, 200, { ok: true, items: readPending().filter((p) => p.status === 'pending'), all: readPending(), sessions: listDshSessions() })
          }
          return sendJson(res, 404, { ok: false, error: 'unknown GET ' + pathname })
        }

        // ── POST ──
        const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')

        // 官方兼容: {audioBase64, language, codec}
        if (isQ && pathname.endsWith('/transcribe')) {
          const codec = typeof body.codec === 'string' ? body.codec.toLowerCase() : 'auto'
          const hint: 'opus' | 'ogg' | 'wav' | 'auto' = codec === 'opus' ? 'opus' : codec === 'wav' ? 'wav' : codec === 'ogg' ? 'ogg' : 'auto'
          const result = await transcribeToSession(body, hint)
          return sendJson(res, 200, { ok: true, ...result })
        }
        if (isR && pathname.endsWith('/audio')) {
          const hint = (typeof body.ext === 'string' ? body.ext.toLowerCase() : 'auto') as 'opus' | 'ogg' | 'wav' | 'auto'
          const result = await transcribeToSession(body, hint)
          return sendJson(res, 200, { ok: true, ...result })
        }
        if (isR && pathname.endsWith('/stream')) {
          const result = await transcribeToSession(body, 'opus')
          return sendJson(res, 200, { ok: true, ...result, stream: true })
        }
        // ── BLE 直连（自实现收端：scan/connect/control/files/realtime）──
        if (isR && pathname.endsWith('/ble/setup')) {
          bleReady = null // 强制重新探测/安装 bleak
          const st = await ensureBle()
          return sendJson(res, st.ok ? 200 : 500, { ok: st.ok, error: st.error ?? null, python: ble.python, bleak: ble.bleakVersion })
        }
        if (isR && pathname.endsWith('/ble/scan')) {
          const st = await ensureBle()
          if (!st.ok) return sendJson(res, 500, { ok: false, error: st.error ?? 'BLE 未就绪' })
          try {
            const devices = await ble.scan(typeof body.timeout === 'number' ? body.timeout : 8)
            return sendJson(res, 200, { ok: true, devices })
          } catch (e) {
            return sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) })
          }
        }
        if (isR && pathname.endsWith('/ble/connect')) {
          const st = await ensureBle()
          if (!st.ok) return sendJson(res, 500, { ok: false, error: st.error ?? 'BLE 未就绪' })
          if (typeof body.address !== 'string' || !body.address) return sendJson(res, 400, { ok: false, error: '缺少 address' })
          try {
            const r = await ble.connect(body.address, typeof body.retries === 'number' ? body.retries : 5)
            return sendJson(res, 200, { ok: true, ...r })
          } catch (e) {
            return sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) })
          }
        }
        if (isR && pathname.endsWith('/ble/disconnect')) {
          try {
            await ble.disconnect()
            finalizeBleLive()
            return sendJson(res, 200, { ok: true })
          } catch (e) {
            return sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) })
          }
        }
        if (isR && pathname.endsWith('/ble/battery')) {
          try {
            const level = await ble.queryBattery()
            return sendJson(res, 200, { ok: true, level })
          } catch (e) {
            return sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) })
          }
        }
        if (isR && pathname.endsWith('/ble/timesync')) {
          try {
            await ble.timesync()
            return sendJson(res, 200, { ok: true, synced: true })
          } catch (e) {
            return sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) })
          }
        }
        if (isR && pathname.endsWith('/ble/download')) {
          const st = await ensureBle()
          if (!st.ok) return sendJson(res, 500, { ok: false, error: st.error ?? 'BLE 未就绪' })
          if (typeof body.name !== 'string' || !body.name.trim()) return sendJson(res, 400, { ok: false, error: '缺少 name（录音文件名）' })
          try {
            const dl = await ble.download(body.name.trim())
            const result = await transcribeToSession({ sessionId: typeof body.sessionId === 'string' ? body.sessionId : undefined, audioBase64: dl.data, ext: dl.ext }, dl.ext)
            return sendJson(res, 200, { ok: true, file: { name: dl.name, ext: dl.ext, size: dl.size }, ...result })
          } catch (e) {
            return sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) })
          }
        }
        if (isR && pathname.endsWith('/ble/realtime')) {
          const st = await ensureBle()
          if (!st.ok) return sendJson(res, 500, { ok: false, error: st.error ?? 'BLE 未就绪' })
          const action = typeof body.action === 'string' ? body.action : ''
          try {
            if (action === 'start') {
              const rec = sessions.open(typeof body.sessionId === 'string' ? body.sessionId : undefined)
              if (!rec.meta?.dshSessionId) {
                const target = getDeliverTarget()
                if (target) sessions.bindDsh(rec.id, target)
              }
              // 攒段窗口可配（默认 10s 高质量；2s/5s 低延迟）
              const windowMs = typeof body.windowMs === 'number' && body.windowMs > 0 ? body.windowMs : 10000
              const opts = {
                windowMs,
                minBytes: typeof body.minBytes === 'number' ? body.minBytes : Math.max(300, Math.round(windowMs * 0.2)),
                maxBytes: typeof body.maxBytes === 'number' ? body.maxBytes : Math.max(2400, Math.round(windowMs * 1.6)),
              }
              await ble.realtime('start', opts)
              bleLive = { sessionId: rec.id }
              return sendJson(res, 200, { ok: true, live: true, sessionId: rec.id, windowMs })
            }
            if (action === 'stop') {
              await ble.realtime('stop')
              finalizeBleLive()
              return sendJson(res, 200, { ok: true, live: false })
            }
            if (action === 'pause' || action === 'resume') {
              await ble.realtime(action)
              return sendJson(res, 200, { ok: true, action })
            }
            return sendJson(res, 400, { ok: false, error: 'action 需为 start|stop|pause|resume' })
          } catch (e) {
            return sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) })
          }
        }
        // ── 离线录音同步：拉取未处理文件 → 存盘 → 转写 → 投递/待审批 ──
        if (isR && pathname.endsWith('/ble/sync')) {
          const st = await ensureBle()
          if (!st.ok) return sendJson(res, 500, { ok: false, error: st.error ?? 'BLE 未就绪' })
          try {
            const result = await runSync({
              mode: typeof body.mode === 'string' ? body.mode : undefined,
              deleteAfter: typeof body.deleteAfter === 'boolean' ? body.deleteAfter : undefined,
              force: typeof body.force === 'boolean' ? body.force : undefined,
            })
            return sendJson(res, 200, { ok: true, sync: result, lastSyncAt: syncState.lastSyncAt, pending: readPending().filter((p) => p.status === 'pending').length })
          } catch (e) {
            return sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) })
          }
        }
        // ── 待审批链（work 模式同步结果的流向选择）──
        const pendingMatch = pathname.match(/^\/api\/recorder\/ble\/pending\/([^/]+)\/(approve|reject)$/)
        if (isR && pendingMatch) {
          const [, pid, action] = pendingMatch
          const items = readPending()
          const item = items.find((p) => p.id === pid)
          if (!item) return sendJson(res, 404, { ok: false, error: '待审批项不存在: ' + pid })
          if (action === 'reject') {
            item.status = 'rejected'
            writePending(items)
            return sendJson(res, 200, { ok: true, status: 'rejected' })
          }
          // approve：投递到指定 DSH 会话
          const dshSessionId = typeof body.sessionId === 'string' && body.sessionId ? body.sessionId : undefined
          if (!dshSessionId) return sendJson(res, 400, { ok: false, error: '缺少 sessionId（投递目标会话）' })
          if (!ctx.sessions.get(SessionId(dshSessionId))) return sendJson(res, 404, { ok: false, error: '目标 DSH 会话不存在: ' + dshSessionId })
          const content = `[${item.spokenAt}]${item.duration ? `（${item.duration}s）` : ''}\n${item.text}`
          const delivered = deliverTextToDsh(dshSessionId, content, modeInstruction('work'), runtime.deliverWakeup)
          if (!delivered.ok) return sendJson(res, 500, delivered)
          item.status = 'delivered'
          item.targetSessionId = dshSessionId
          item.deliveredAt = new Date().toISOString()
          writePending(items)
          return sendJson(res, 200, { ok: true, status: 'delivered', targetSessionId: dshSessionId })
        }
        if (isR && pathname.endsWith('/session')) {
          const session = sessions.open(
            typeof body.sessionId === 'string' ? body.sessionId : undefined,
            {
              language: typeof body.language === 'string' ? body.language : undefined,
              mode: typeof body.mode === 'string' ? body.mode : undefined,
              dshSessionId: typeof body.dshSessionId === 'string' ? body.dshSessionId : undefined,
            },
          )
          // 未显式指定时：自动流转到面板选择的默认投递目标（若有）
          if (!session.meta?.dshSessionId) {
            const target = getDeliverTarget()
            if (target) sessions.bindDsh(session.id, target)
          }
          return sendJson(res, 200, { ok: true, session: sessions.get(session.id) })
        }
        if (isR && pathname.endsWith('/deliver-target')) {
          const target = typeof body.sessionId === 'string' && body.sessionId ? body.sessionId : null
          if (!target) return sendJson(res, 400, { ok: false, error: '缺少 sessionId' })
          if (!ctx.sessions.get(SessionId(target))) return sendJson(res, 404, { ok: false, error: '目标 DSH 会话不存在: ' + target })
          setDeliverTarget(target)
          return sendJson(res, 200, { ok: true, sessionId: target })
        }
        // 运行时配置：选择模式 / ASR / 模型目录 / 投递行为（持久化，免重启）
        // 带 ?sessionId= 时写入该 DSH 会话的覆盖层；无则写全局
        if (isR && pathname.endsWith('/config')) {
          const qSessionId = new URL(req.url ?? '/', 'http://x').searchParams.get('sessionId') ?? undefined
          if (body.clear === true && qSessionId) {
            clearSessionOverride(qSessionId)
            return sendJson(res, 200, { ok: true, cleared: qSessionId })
          }
          const allowed = ['sttProvider', 'autoProcessMode', 'deliverWakeup', 'language', 'fwModelDir', 'openaiCompatBaseUrl', 'qwenPythonPath', 'qwenModelDir', 'bleAutoSync', 'bleSyncDeleteAfter'] as const
          const changed: string[] = []
          if (qSessionId) {
            // 会话覆盖层：只存会话相关字段
            const ov = readSessionOverride(qSessionId) ?? {}
            for (const k of ['sttProvider', 'autoProcessMode', 'deliverWakeup', 'language'] as const) {
              if (body[k] !== undefined) {
                ;(ov as any)[k] = body[k]
                changed.push(k)
              }
            }
            if (changed.length) writeSessionOverride(qSessionId, ov as SessionOverride)
            const eff = resolveSessionConfig(qSessionId)
            return sendJson(res, 200, { ok: true, sessionId: qSessionId, override: readSessionOverride(qSessionId) ?? null, config: eff.runtime, effectiveSttProvider: resolveSttKind(eff.runtime.sttProvider), asrStatus: asrStatus() })
          }
          for (const k of allowed) {
            if (body[k] !== undefined) {
              ;(runtime as any)[k] = body[k]
              changed.push(k)
            }
          }
          if (changed.length) {
            if (body.sttProvider !== undefined || body.fwModelDir !== undefined) {
              stt = createProvider(resolveSttKind(runtime.sttProvider))
              log('ASR 配置已更新: provider=' + resolveSttKind(runtime.sttProvider) + ' modelDir=' + runtime.fwModelDir)
            }
            saveRuntime()
          }
          return sendJson(res, 200, { ok: true, config: runtime, effectiveSttProvider: resolveSttKind(runtime.sttProvider), asrStatus: asrStatus() })
        }
        // 在文件管理器中打开模型目录（Windows: explorer）
        if (isR && pathname.endsWith('/open-model-dir')) {
          const dir = runtime.fwModelDir
          try {
            mkdirSync(dir, { recursive: true })
            if (process.platform === 'win32') {
              const { execFile } = await import('node:child_process')
              const child = execFile('explorer', [dir])
              child.unref?.()
            } else if (process.platform === 'darwin') {
              const { execFile } = await import('node:child_process')
              const child = execFile('open', [dir])
              child.unref?.()
            } else {
              const { execFile } = await import('node:child_process')
              const child = execFile('xdg-open', [dir])
              child.unref?.()
            }
            return sendJson(res, 200, { ok: true, dir })
          } catch (e) {
            return sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) })
          }
        }
        // /api/recorder/session/<id>/process 与 /revise
        const procMatch = pathname.match(/^\/api\/recorder\/session\/([^/]+)\/(process|revise)$/)
        if (isR && procMatch) {
          const [, sid, action] = procMatch
          const session = sessions.get(sid)
          if (!session) return sendJson(res, 404, { ok: false, error: 'session not found: ' + sid })
          if (action === 'process') {
            const eff = resolveSessionConfig(sid).runtime
            const mode = typeof body.mode === 'string' ? body.mode : (eff.autoProcessMode !== 'none' ? eff.autoProcessMode : undefined)
            if (!mode || mode === 'none') return sendJson(res, 400, { ok: false, error: '未指定 mode' })
            const instruction = modeInstruction(mode, body.params?.instruction)
            const delivered = deliverToDsh(session, { mode, instruction, wakeup: eff.deliverWakeup })
            if (!delivered.ok) return sendJson(res, 500, delivered)
            return sendJson(res, 200, { ok: true, delivered: true, mode, sessionId: sid, instruction })
          }
          // revise: 默认文本级修订
          const method = typeof body.method === 'string' ? body.method : 'text'
          if (method !== 'text') return sendJson(res, 400, { ok: false, error: '当前仅支持 method=text（音频级重转待设备闭环后启用）' })
          const result = await pipeline.run({ sessionId: sid, mode: 'revise-text' }, pipelineDeps())
          if (!result.ok) return sendJson(res, 500, result)
          return sendJson(res, 200, { ...result, revision: sessions.get(sid)?.revision ?? null })
        }
        if (isR && pathname.endsWith('/batch')) {
          const sessionId = typeof body.sessionId === 'string' && body.sessionId ? body.sessionId : undefined
          const items: any[] = Array.isArray(body.items) ? body.items : []
          if (!sessionId) return sendJson(res, 400, { ok: false, error: 'batch 需要 sessionId' })
          if (!items.length) return sendJson(res, 400, { ok: false, error: 'items 为空' })
          const job: Job = { id: randomUUID(), status: 'running', total: items.length, done: 0, okCount: 0, failed: 0, createdAt: new Date().toISOString() }
          jobs.set(job.id, job)
          const results: any[] = []
          for (const item of items) {
            if (batchAbort.signal.aborted || disposed) {
              job.status = 'failed'
              job.error = '插件已卸载，批处理被取消'
              break
            }
            try {
              const r = await transcribeToSession({ sessionId, audioBase64: item.audioBase64, ext: item.ext, language: item.language }, (typeof item.ext === 'string' ? item.ext : 'auto') as any)
              results.push({ name: item.name, ok: true, ...r })
              job.okCount += 1
            } catch (e) {
              results.push({ name: item.name, ok: false, error: e instanceof Error ? e.message : String(e) })
              job.failed += 1
            }
            job.done += 1
          }
          if (job.status !== 'failed') job.status = job.failed ? (job.okCount ? 'done' : 'failed') : 'done'
          return sendJson(res, 200, { ok: true, jobId: job.id, job, results })
        }
        return sendJson(res, 404, { ok: false, error: 'unknown POST ' + pathname })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        log('route error', pathname, msg)
        return sendJson(res, 500, { ok: false, error: msg })
      }
    }

    ctx.webServer.register({ kind: 'prefix', path: '/api/recorder', handler })
    ctx.webServer.register({ kind: 'prefix', path: '/api/qs668', handler })
    log('HTTP 后端已挂载: /api/recorder, /api/qs668 (sttProvider=' + config.sttProvider + ', processors=' + pipeline.list().join(',') + ', outDir=' + outDir + ')')
    return () => {
      disposed = true
      batchAbort.abort(new Error('dsh-ai-recorder 卸载'))
      ble.dispose()
      void disposeQwenWorker()
      disposeSelfCleanup()
      // 关闭所有活跃 SSE 长连接，避免泄漏
      for (const res of activeSse) {
        try { res.end() } catch { /* ignore */ }
      }
      activeSse.clear()
      log('HTTP 后端卸载')
    }
  }, 'dsh-ai-recorder: api')
}