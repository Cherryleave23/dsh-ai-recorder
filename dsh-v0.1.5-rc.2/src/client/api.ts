/**
 * 录音卡后端 · 前端 HTTP 客户端与共享类型。
 *
 * 所有请求都打在同源前缀 `/api/recorder` 下（host 半边注册的 prefix 路由）。
 */

export const API = '/api/recorder'

// ─────────────────────────── 类型 ───────────────────────────

export interface FunasrModelRow {
  key: string
  id: string
  label: string
  ready: boolean
  path: string
  /** 目录在但无权重文件：下载被打断 */
  partial?: boolean
}

export interface FunasrStatus {
  ready: boolean
  python: string | null
  pythonVersion: string | null
  funasrInstalled: boolean
  funasrVersion: string | null
  torchVersion: string | null
  cudaAvailable: boolean
  cudaDeviceName: string | null
  device: 'cpu' | 'cuda'
  modelDir: string
  models: FunasrModelRow[]
  /** Qwen3-ASR 是独立环境（自己的 venv + 权重），单独上报 */
  qwen?: {
    ready: boolean
    venv: string | null
    modelName: string
    modelPath: string
    modelPresent: boolean
    lastInstall: { ok: boolean; error?: string } | null
    hint: string
    /** 逐模块 import 体检结果（缺哪个模块、什么错误） */
    importCheck?: { ok: boolean; failed: Array<{ mod: string; error: string }> }
  }
  /** 关键依赖的真实导入体检 */
  deps?: Record<string, { ok: boolean; error: string | null }>
  missing: string[]
  installHint: string
}

export interface RuntimeConfig {
  asrModel: 'paraformer-zh' | 'sensevoice' | 'qwen3-asr'
  asrDevice: 'auto' | 'cpu' | 'cuda'
  asrVad: boolean
  asrPunc: boolean
  asrSpk: boolean
  /** auto = 交给模型判语种（SenseVoice 多语种时必须用 auto） */
  language: 'auto' | 'zh' | 'en' | 'yue' | 'ja' | 'ko'
  funasrPythonPath: string
  funasrModelDir: string
  streamChunkMs: number
  opusPreferred: boolean
  bleAutoSync: boolean
  bleSyncDeleteAfter: boolean
  markdownEnabled: boolean
  keepAudio: boolean
  /** 按转写开头自动给录音命名（标题同时是磁盘上的文件名） */
  autoTitle: boolean
  /** 自动标题取多少个字 */
  titleMaxChars: number
}

export interface Segment {
  seq?: number
  start: number
  end: number
  text: string
  speaker?: number
  final?: boolean
}

export interface SessionRecord {
  id: string
  createdAt: string
  updatedAt: string
  status: 'open' | 'closed'
  source: 'realtime' | 'file' | 'upload'
  language: string
  device?: { name?: string; address?: string }
  deviceFile?: string
  durationMs: number
  model?: string
  device_?: string
  speakerCount?: number
  /** 人看得懂的标题，同时是磁盘上音频/Markdown 的文件名 */
  title?: string
  /** auto=取自转写开头；llm=LLM 汇总给的；user=手动改的 */
  titleSource?: 'auto' | 'llm' | 'user'
  audio?: { file: string; bytes: number; updatedAt: string } | null
  markdown?: { file: string; bytes: number; updatedAt: string } | null
  segments: Segment[]
  transcript: string
  partial?: string
  error?: string
}

export interface SessionListRow {
  id: string
  title: string
  titleSource: string
  createdAt: string
  updatedAt: string
  status: string
  source: string
  segments: number
  durationMs: number
  transcriptLength: number
  hasAudio: boolean
  hasMarkdown: boolean
  /** 已有 LLM 总结：删除时总结会先归档到 summaries/，不会丢 */
  hasSummary: boolean
  /** 音频 + 文档字节数 */
  bytes: number
}

export interface ArtifactSlot {
  present: boolean
  ref: string | null
  bytes?: number
  updatedAt?: string
}

export interface SessionArtifacts {
  audio: ArtifactSlot
  markdown: ArtifactSlot
  stream: { ref: string }
}

export interface ScanDevice {
  address: string
  name: string
  rssi: number
  has_ae20: boolean
  /** 以前连过（在设备缓存里） */
  known: boolean
  /** 最近一次连上它的时刻 */
  lastConnectedAt?: string
}

export interface ScanState {
  running: boolean
  startedAt: string | null
  roundMs: number
  autoConnect: boolean
  /** 已发现的设备，按信号从强到弱 */
  devices: ScanDevice[]
  autoConnected: string | null
  message: string | null
  lastError: string | null
}

export interface KnownDevice {
  address: string
  name: string
  lastConnectedAt: string
  connectCount: number
  lastRssi?: number
}

/** 扫描控制：start 立刻返回，停止最多等一轮（≈roundMs）就生效。 */
export const startScan = (opts?: { roundMs?: number; autoConnect?: boolean; timeoutMs?: number }) =>
  post<{ ok: true; scan: ScanState }>('/ble/scan', { action: 'start', ...opts })

export const stopScan = () => post<{ ok: true; scan: ScanState }>('/ble/scan', { action: 'stop' })

export const knownDevices = () => get<{ ok: true; items: KnownDevice[] }>('/ble/known')

export const forgetDevice = (address: string) =>
  post<{ ok: true; removed: boolean; items: KnownDevice[] }>('/ble/known', { forget: address })

/** 信号强度 → 人话。BLE 里 -60 很好，-90 已经快连不上了。 */
export function fmtRssi(rssi: number): string {
  if (rssi >= -60) return '信号很好'
  if (rssi >= -75) return '信号良好'
  if (rssi >= -85) return '信号偏弱'
  return '信号很弱'
}

/** 「2 小时前」这种相对时间。 */
export function fmtAgo(iso: string): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const s = Math.max(0, Math.round((Date.now() - t) / 1000))
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`
  return `${Math.floor(s / 86400)} 天前`
}

export interface BleStatus {
  python: string | null
  bleak: string | null
  daemonRunning: boolean
  connected: boolean
  reconnecting: boolean
  /** 已尝试的自动重连次数（显示「第 N 次」，让用户看得出在进展而不是卡死） */
  reconnectAttempt?: number
  address: string | null
  mtu: number | null
  battery: number | null
  realtimeActive: boolean
  live: { sessionId: string; bufferedBytes: number; totalBytes: number } | null
  sync: { running: boolean; lastSyncAt: string | null; lastResult: unknown; lastError: string | null }
  /** 扫描状态与已发现设备（轮询这个字段来长列表，不用单独接口） */
  scan?: ScanState
}

export interface DeviceEntry {
  name: string
  time: number
  size: number
}

// ─────────────────────────── 请求 ───────────────────────────

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(API + path, {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
  const text = await r.text()
  let json: any = {}
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    json = { ok: false, error: text.slice(0, 300) }
  }
  if (!r.ok || json.ok === false) {
    throw new Error(json?.error ?? `HTTP ${r.status}`)
  }
  return json as T
}

export const get = <T,>(path: string): Promise<T> => api<T>(path)

export const post = <T,>(path: string, body?: unknown): Promise<T> =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) })

/** 音频/文档这类二进制资源的直链。 */
export const audioUrl = (sessionId: string): string =>
  `${API}/session/${encodeURIComponent(sessionId)}/audio`

export const markdownUrl = (sessionId: string): string =>
  `${API}/session/${encodeURIComponent(sessionId)}/markdown`

export const eventsUrl = (sessionId: string): string =>
  `${API}/session/${encodeURIComponent(sessionId)}/events`

/**
 * 改标题。host 会把磁盘上的音频与 Markdown 一起改名成 `<标题>.<ext>`。
 * `source` 默认 `user`（最高优先级，自动标题不会覆盖它）；
 * 将来 LLM 汇总层回归时传 `'llm'`。
 */
export const setTitle = (
  sessionId: string,
  title: string,
  source: 'user' | 'llm' = 'user',
): Promise<{ ok: true; session: SessionRecord; artifacts: SessionArtifacts }> =>
  post('/title', { sessionId, title, source })

/** 下载用的文件名：跟着标题走，并去掉文件系统不接受的字符。 */
export function downloadName(rec: { title?: string; id: string }, ext: string): string {
  const base = (rec.title ?? '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()
  return `${base || rec.id}${ext}`
}

/** 取扩展名（含点）。 */
export function extOf(file: string): string {
  const i = file.lastIndexOf('.')
  return i > 0 ? file.slice(i) : ''
}

/**
 * 删除一条录音：host 会把整个会话目录删掉（音频 + Markdown + 记录），**不可恢复**。
 * 所以调用方必须先让用户确认。
 */
export const deleteSession = (
  sessionId: string,
): Promise<{ ok: true; sessionId: string; existed: boolean; freedBytes: number; archivedSummary: string | null }> =>
  api(`/session/${encodeURIComponent(sessionId)}`, { method: 'DELETE' })

/**
 * 批量删除。host 逐条走同一个删除路径，单条失败不中断其余。
 * `failed` 非空时必须如实报给用户，不能当成全成功。
 */
export const deleteSessions = (
  ids: string[],
): Promise<{
  ok: true
  deleted: string[]
  failed: Array<{ id: string; error: string }>
  freedBytes: number
  archivedSummaries: string[]
  items: SessionListRow[]
}> => post('/sessions/delete', { ids })

/** 已归档的 LLM 总结清单。 */
export const listSummaries = (): Promise<{ ok: true; items: Array<{ file: string; bytes: number; updatedAt: string }> }> =>
  get('/summaries')

/**
 * 记入一份 LLM 总结（汇总层回归后由它调用）。
 * 带 `title` 时会同时接管录音命名。
 */
export const setSummary = (
  sessionId: string,
  text: string,
  title?: string,
): Promise<{ ok: true; session: SessionRecord }> => post('/summary', { sessionId, text, title })

// ─────────────────────────── 格式化 ───────────────────────────

export function fmtClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const p = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function fmtDay(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  const p = (n: number) => String(n).padStart(2, '0')
  if (sameDay) return `今天 ${p(d.getHours())}:${p(d.getMinutes())}`
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

export const SOURCE_LABEL: Record<string, string> = {
  realtime: '实时',
  file: '设备',
  upload: '上传',
}

export function fmtBattery(v: number | null): string {
  if (v === null || v === undefined) return '—'
  if (v === 110) return '充电中'
  return `${v}%`
}
