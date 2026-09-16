/**
 * L4 输出层 · 会话存储（session_id 为主键）
 *
 * 一次录音 = 一个 session 目录，三件产物同主键落在一起（流程图 L5 的「对应关系」）：
 *
 *   <outDir>/sessions/<session_id>/
 *     audio.ogg        本地音频文件（设备原生 Opus 归档；keepAudio=false 则不落）
 *     audio.16k.wav    统一格式音频（16k/mono/16bit，解码中间产物，默认不保留）
 *     transcript.md    Markdown 转写文档（markdownEnabled=false 则不落）
 *     session.json     会话记录（分段/时长/来源/产物索引）
 *
 * 另有 <outDir>/index.json 维护会话索引，列表接口不必扫目录。
 */
import { EventEmitter } from 'node:events'
import {
  existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { renderArchivedSummary } from './markdown.js'
import { deriveTitle, extOf, fallbackTitle, sanitizeFileName } from './title.js'

export interface Segment {
  seq: number
  /** 相对录音起点的毫秒 */
  start: number
  end: number
  text: string
  speaker?: number
  /** 该分段是否由流式模型的未定稿结果升级而来 */
  final: boolean
}

export interface ArtifactRef {
  file: string
  bytes: number
  updatedAt: string
}

export interface SessionRecord {
  id: string
  createdAt: string
  updatedAt: string
  status: 'open' | 'closed'
  /** 录入来源 */
  source: 'realtime' | 'file' | 'upload'
  language: string
  device?: { name?: string; address?: string }
  /** 设备侧文件名（离线同步时有值） */
  deviceFile?: string
  durationMs: number
  model?: string
  device_?: string
  speakerCount?: number
  /**
   * 人看得懂的标题，同时用作磁盘上音频/Markdown 的文件名（`<title>.ogg` / `<title>.md`）。
   * 默认取转写文本开头几个字；LLM 汇总或用户手动改过则以它们为准。
   */
  title?: string
  /** 标题来源，决定谁能覆盖谁：user > llm > auto */
  titleSource?: 'auto' | 'llm' | 'user'
  /** 三件套索引 */
  audio?: ArtifactRef | null
  markdown?: ArtifactRef | null
  segments: Segment[]
  transcript: string
  /** 未定稿的实时文本（流式进行中） */
  partial?: string
  revision?: { text: string; at: string }
  /** LLM 汇总结果（投递层尚未回归，先留结构位） */
  summary?: { title?: string; text: string; at: string }
  error?: string
}

export type SessionEvent =
  | { type: 'opened'; sessionId: string }
  | { type: 'segment'; sessionId: string; segment: Segment; transcript: string }
  | { type: 'partial'; sessionId: string; partial: string }
  | { type: 'artifact'; sessionId: string; kind: 'audio' | 'markdown'; ref: ArtifactRef }
  | { type: 'titled'; sessionId: string; title: string; source: 'auto' | 'llm' | 'user' }
  | { type: 'closed'; sessionId: string; record: SessionRecord }

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
  /** 是否已有 LLM 总结（删除时它会被归档而不是丢掉） */
  hasSummary: boolean
  /** 音频 + 文档的字节数（批量删除时要显示共释放多少） */
  bytes: number
}

/** 删除结果。`ok:false` 时带 error，调用方必须如实上报而不是假报成功。 */
export interface RemoveResult {
  ok: boolean
  /** 释放的字节数 */
  freedBytes: number
  /** LLM 总结的归档路径（没有总结则为 null） */
  archivedSummary: string | null
  error?: string
}

const ID_RE = /^[A-Za-z0-9._-]{1,80}$/

/**
 * session_id 是否合法。
 *
 * 路由层必须拿它先校验：id 是从 URL 里来的，而目录是 `join(root, id)`，
 * 一个 `../..` 就能让删除/读取跑到数据目录外面去。
 */
export function isValidSessionId(id: string): boolean {
  return ID_RE.test(id)
}

export class SessionStore {
  private readonly root: string
  private readonly summaryDir: string
  private readonly indexFile: string
  private emitters = new Map<string, EventEmitter>()

  constructor(outDir: string) {
    this.root = join(outDir, 'sessions')
    // LLM 总结的独立归档区，刻意放在 sessions/ 外面：
    // 删录音是删整个会话目录，总结放在里面就跟着没了
    this.summaryDir = join(outDir, 'summaries')
    mkdirSync(this.root, { recursive: true })
    this.indexFile = join(outDir, 'index.json')
  }

  /** session_id → 会话目录。 */
  dirOf(sessionId: string): string {
    return join(this.root, sessionId)
  }

  pathOf(sessionId: string, file: string): string {
    return join(this.dirOf(sessionId), file)
  }

  /**
   * 新建或复用会话。id 非法或未给则生成。
   *
   * `recordedAt` 是**录制时刻**——离线同步时从设备文件名（`note20260820-235231.opus`）
   * 解析出来，它才是 `createdAt` 的正确取值。不传才用当前时间：实时转写与上传
   * 本来就是「现在」录的。会话 id 也跟着录制时间生成，两者对得上。
   */
  open(opts: {
    id?: string
    source: SessionRecord['source']
    language: string
    device?: SessionRecord['device']
    deviceFile?: string
    recordedAt?: string
  }): SessionRecord {
    const id = opts.id && ID_RE.test(opts.id) ? opts.id : newSessionId(opts.recordedAt)
    const existing = this.get(id)
    if (existing) return existing
    const now = new Date().toISOString()
    const rec: SessionRecord = {
      id,
      createdAt: opts.recordedAt ?? now,
      updatedAt: now,
      status: 'open',
      source: opts.source,
      language: opts.language,
      device: opts.device,
      deviceFile: opts.deviceFile,
      durationMs: 0,
      segments: [],
      transcript: '',
    }
    mkdirSync(this.dirOf(id), { recursive: true })
    this.persist(rec)
    this.emit(id, { type: 'opened', sessionId: id })
    return rec
  }

  get(sessionId: string): SessionRecord | undefined {
    const p = this.pathOf(sessionId, 'session.json')
    if (!existsSync(p)) return undefined
    try {
      return JSON.parse(readFileSync(p, 'utf8')) as SessionRecord
    } catch {
      return undefined
    }
  }

  /** 追加一个定稿分段（流式逐字升级 / 离线结果都走这里）。 */
  appendSegment(sessionId: string, seg: Omit<Segment, 'seq'>): SessionRecord | undefined {
    const rec = this.get(sessionId)
    if (!rec) return undefined
    const segment: Segment = { seq: rec.segments.length + 1, ...seg }
    rec.segments.push(segment)
    rec.transcript = rec.segments.map((s) => s.text).filter(Boolean).join('\n')
    rec.durationMs = Math.max(rec.durationMs, segment.end)
    rec.updatedAt = new Date().toISOString()
    this.persist(rec)
    this.emit(sessionId, { type: 'segment', sessionId, segment, transcript: rec.transcript })
    return rec
  }

  /** 批量写入分段（离线识别一次性产出）。 */
  replaceSegments(sessionId: string, segs: Omit<Segment, 'seq'>[]): SessionRecord | undefined {
    const rec = this.get(sessionId)
    if (!rec) return undefined
    rec.segments = segs.map((s, i) => ({ seq: i + 1, ...s }))
    rec.transcript = rec.segments.map((s) => s.text).filter(Boolean).join('\n')
    rec.durationMs = rec.segments.reduce((m, s) => Math.max(m, s.end), 0)
    rec.updatedAt = new Date().toISOString()
    this.persist(rec)
    return rec
  }

  /** 更新实时未定稿文本（逐字输出）。 */
  setPartial(sessionId: string, partial: string): void {
    const rec = this.get(sessionId)
    if (!rec) return
    rec.partial = partial
    rec.updatedAt = new Date().toISOString()
    this.persist(rec)
    this.emit(sessionId, { type: 'partial', sessionId, partial })
  }

  /** 落一个产物（音频/Markdown），并登记进会话记录。 */
  putArtifact(sessionId: string, kind: 'audio' | 'markdown', file: string, bytes: Uint8Array): ArtifactRef {
    const dir = this.dirOf(sessionId)
    mkdirSync(dir, { recursive: true })
    const target = join(dir, file)
    const tmp = target + '.tmp'
    writeFileSync(tmp, bytes)
    renameSync(tmp, target) // 原子替换，避免半截文件被当成成品
    const ref: ArtifactRef = { file, bytes: bytes.length, updatedAt: new Date().toISOString() }
    const rec = this.get(sessionId)
    if (rec) {
      const prev = kind === 'audio' ? rec.audio : rec.markdown
      if (kind === 'audio') rec.audio = ref
      else rec.markdown = ref
      rec.updatedAt = ref.updatedAt
      this.persist(rec)
      // 换了文件名就把旧文件删掉，否则改一次标题就多留一份孤儿文档
      if (prev?.file && prev.file !== file) {
        try {
          rmSync(join(dir, prev.file), { force: true })
        } catch {
          /* 删不掉不影响主流程 */
        }
      }
    }
    this.emit(sessionId, { type: 'artifact', sessionId, kind, ref })
    return ref
  }

  setMeta(sessionId: string, patch: Partial<Pick<SessionRecord, 'model' | 'speakerCount' | 'durationMs' | 'error' | 'language'>>): void {
    const rec = this.get(sessionId)
    if (!rec) return
    Object.assign(rec, patch)
    rec.updatedAt = new Date().toISOString()
    this.persist(rec)
  }

  setRevision(sessionId: string, text: string): SessionRecord | undefined {
    const rec = this.get(sessionId)
    if (!rec) return undefined
    rec.revision = { text, at: new Date().toISOString() }
    rec.updatedAt = rec.revision.at
    this.persist(rec)
    return rec
  }

  // ─────────── 标题与文件名 ───────────

  /**
   * 设置标题，并把磁盘上的音频 / Markdown 一起改名成 `<标题>.<ext>`。
   *
   * 三件套的解析走记录里的文件名（见 L5 的 resolveArtifacts），所以改名后
   * 播放链接与文档入口都不会失效——`session_id` 始终是主键。
   */
  setTitle(sessionId: string, title: string, source: 'auto' | 'llm' | 'user'): SessionRecord | undefined {
    const rec = this.get(sessionId)
    if (!rec) return undefined
    const clean = (title ?? '').replace(/\s+/g, ' ').trim()
    if (!clean) return rec
    if (rec.title === clean && rec.titleSource === source) return rec
    rec.title = clean
    rec.titleSource = source
    rec.updatedAt = new Date().toISOString()
    this.renameArtifacts(rec, sanitizeFileName(clean, fallbackTitle(rec.createdAt)))
    this.persist(rec)
    this.emit(sessionId, { type: 'titled', sessionId, title: clean, source })
    return rec
  }

  /**
   * 按转写文本自动取名。只在该会话**还没有标题**时生效：
   * 实时转写过程中文本会不断增长，若每次都重新取头几个字，文件名会被反复改，
   * 所以自动标题一次定稿；之后 LLM 或用户仍可覆盖。
   */
  applyAutoTitle(sessionId: string, maxChars: number): SessionRecord | undefined {
    const rec = this.get(sessionId)
    if (!rec) return undefined
    if (rec.title) return rec
    const derived = deriveTitle(rec.transcript, maxChars)
    return this.setTitle(sessionId, derived || fallbackTitle(rec.createdAt), 'auto')
  }

  /**
   * 给历史会话补标题（老数据没有 title 字段）。
   * 只处理缺标题的，已命名的一律不动。返回处理条数。
   */
  backfillTitles(maxChars: number): number {
    let n = 0
    try {
      for (const id of readdirSync(this.root)) {
        const rec = this.get(id)
        if (!rec || rec.title) continue
        const derived = deriveTitle(rec.transcript, maxChars)
        this.setTitle(id, derived || fallbackTitle(rec.createdAt), 'auto')
        n += 1
      }
    } catch {
      /* 目录缺失等情况忽略：补标题失败不该影响插件启动 */
    }
    return n
  }

  /**
   * 把会话目录里的产物改名到新的基名。扩展名保留，冲突时加 ` (2)` 之类的后缀。
   * 文件不在（被手工删过）时只改记录，不报错。
   */
  private renameArtifacts(rec: SessionRecord, base: string): void {
    const dir = this.dirOf(rec.id)
    const now = new Date().toISOString()
    const slots: Array<ArtifactRef | null | undefined> = [rec.audio, rec.markdown]
    const taken = new Set<string>()

    for (const ref of slots) {
      if (!ref) continue
      const ext = extOf(ref.file)
      const desired = `${base}${ext}`
      if (desired === ref.file) {
        taken.add(desired)
        continue
      }
      let target = desired
      let n = 2
      // taken 管住同一批内的互撞（音频与 Markdown 扩展名不同，通常不会撞），
      // existsSync 管住目录里已有的别的文件
      while (taken.has(target) || (existsSync(join(dir, target)) && !existsSync(join(dir, ref.file)))) {
        target = `${base} (${n})${ext}`
        n += 1
        if (n > 50) break
      }
      const src = join(dir, ref.file)
      if (existsSync(src)) {
        try {
          renameSync(src, join(dir, target))
        } catch {
          // 改名失败（占用/权限）→ 保留原名，至少记录仍然指向真实存在的文件
          taken.add(ref.file)
          continue
        }
      }
      ref.file = target
      ref.updatedAt = now
      taken.add(target)
    }
  }

  /**
   * 标题自愈。
   *
   * 自动标题若停在「时间兜底名」而转写文本其实已经有了，说明取名发生在文本就位之前
   * （或者传进去的 `titleMaxChars` 是非法值，让 `deriveTitle` 返回了空串）。
   * 这里按文本重新取名并同步改名。
   *
   * 判定刻意收紧到「当前标题确实是兜底名」：`未转写 2026-09-15 012923` 这种
   * 绝不可能是内容派生的标题，所以重取不会误伤正常标题，也不会在实时转写
   * 文本增长过程中反复改名。用户手改的与 LLM 给的名字（titleSource 非 auto）一律不动。
   */
  refreshAutoTitle(sessionId: string, maxChars: number): SessionRecord | undefined {
    const rec = this.get(sessionId)
    if (!rec) return undefined
    if (rec.titleSource !== 'auto') return rec
    const cur = rec.title ?? ''
    if (cur !== fallbackTitle(rec.createdAt) && !/^(未转写|录音)\s+\d{4}-\d{2}-\d{2}/.test(cur)) return rec
    const derived = deriveTitle(rec.transcript, maxChars)
    if (!derived || derived === cur) return rec
    return this.setTitle(sessionId, derived, 'auto')
  }

  /**
   * 修正录制时间。
   *
   * 早期版本把「同步时刻」当成了录制时刻，一卡旧录音全变成「刚刚」。
   * 这里只改 `createdAt`，**不动 id**——id 是主键，已被 sync-index、产物路径等引用，
   * 为了一次时间修正去重命名目录与全部引用不划算。
   */
  setRecordedAt(sessionId: string, iso: string): SessionRecord | undefined {
    const rec = this.get(sessionId)
    if (!rec || rec.createdAt === iso) return rec
    rec.createdAt = iso
    this.persist(rec)
    return rec
  }

  close(sessionId: string): SessionRecord | undefined {
    const rec = this.get(sessionId)
    if (!rec) return undefined
    rec.status = 'closed'
    rec.partial = undefined
    rec.updatedAt = new Date().toISOString()
    this.persist(rec)
    this.emit(sessionId, { type: 'closed', sessionId, record: rec })
    return rec
  }

  /**
   * 删除会话：整个目录移除（音频 + Markdown + 记录）。
   *
   * **LLM 总结必须活下来**：只要会话里有 `summary`，就先把总结抄进
   * `<outDir>/summaries/` 再删目录；**抄写失败就中止删除**并返回错误——
   * 宁可这次删不掉，也不能把 LLM 已经做出来的活儿删了。
   */
  remove(sessionId: string): RemoveResult {
    if (!ID_RE.test(sessionId)) {
      return { ok: false, freedBytes: 0, archivedSummary: null, error: '非法 session id' }
    }
    const rec = this.get(sessionId)
    const dir = this.dirOf(sessionId)
    let archived: string | null = null

    if (rec?.summary?.text) {
      try {
        archived = this.archiveSummary(rec)
      } catch (e) {
        return {
          ok: false,
          freedBytes: 0,
          archivedSummary: null,
          error: `LLM 总结归档失败，已中止删除以免丢失总结：${e instanceof Error ? e.message : String(e)}`,
        }
      }
    }

    const freed = dirSize(dir)
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      return { ok: false, freedBytes: 0, archivedSummary: archived, error: '文件可能正被占用' }
    }
    this.emitters.delete(sessionId)
    try {
      this.writeIndex(this.list().filter((r) => r.id !== sessionId))
    } catch {
      /* 索引写失败不阻断删除本身 */
    }
    return { ok: !existsSync(dir), freedBytes: freed, archivedSummary: archived }
  }

  /**
   * 把 LLM 总结抄到 `<outDir>/summaries/`，返回落地路径。
   * 文件名用「录音时间 + 标题」：总结目录按录音时间排序比按归档时间排序更好找。
   */
  archiveSummary(rec: SessionRecord): string {
    if (!rec.summary?.text) throw new Error('该会话没有 LLM 总结')
    mkdirSync(this.summaryDir, { recursive: true })
    const stamp = fileStamp(rec.createdAt)
    const wanted = sanitizeFileName(rec.summary.title || rec.title || '', `总结 ${stamp}`)
    const md = renderArchivedSummary(rec)

    let file = `${stamp} ${wanted}.md`
    let n = 2
    while (existsSync(join(this.summaryDir, file))) {
      file = `${stamp} ${wanted} (${n}).md`
      n += 1
      if (n > 50) break
    }
    const target = join(this.summaryDir, file)
    const tmp = target + '.tmp'
    writeFileSync(tmp, md, 'utf8')
    renameSync(tmp, target) // 原子落盘：不会留下半截归档
    return target
  }

  /** 已归档的总结清单（给面板显示）。 */
  listSummaries(): Array<{ file: string; bytes: number; updatedAt: string }> {
    const rows: Array<{ file: string; bytes: number; updatedAt: string }> = []
    try {
      for (const name of readdirSync(this.summaryDir)) {
        if (!name.endsWith('.md')) continue
        try {
          const st = statSync(join(this.summaryDir, name))
          rows.push({ file: name, bytes: st.size, updatedAt: new Date(st.mtimeMs).toISOString() })
        } catch {
          /* skip */
        }
      }
    } catch {
      /* 目录还不存在 */
    }
    return rows.sort((a, b) => b.file.localeCompare(a.file))
  }

  /** 记一份 LLM 总结（汇总层回归后由它调用；现在也可手动写，便于联调）。 */
  setSummary(sessionId: string, text: string, title?: string): SessionRecord | undefined {
    const rec = this.get(sessionId)
    if (!rec) return undefined
    const clean = (text ?? '').trim()
    if (!clean) return rec
    rec.summary = { text: clean, title: title?.trim() || undefined, at: new Date().toISOString() }
    rec.updatedAt = rec.summary.at
    this.persist(rec)
    // LLM 给出的标题直接接管命名（优先级高于自动标题）
    if (title?.trim()) return this.setTitle(sessionId, title, 'llm')
    return rec
  }

  /** 会话目录占用体积（删除前给用户看「要删掉多少东西」）。 */
  sizeOf(sessionId: string): number {
    return dirSize(this.dirOf(sessionId))
  }

  list(): SessionListRow[] {
    try {
      const raw = JSON.parse(readFileSync(this.indexFile, 'utf8')) as { sessions?: SessionListRow[] }
      if (Array.isArray(raw.sessions)) return raw.sessions
    } catch {
      /* 索引缺失 → 重建 */
    }
    return this.rebuildIndex()
  }

  /** 扫目录重建索引（索引损坏或缺席时的兜底）。 */
  rebuildIndex(): SessionListRow[] {
    const rows: SessionListRow[] = []
    try {
      for (const name of readdirSync(this.root)) {
        const rec = this.get(name)
        if (!rec) continue
        rows.push(toRow(rec))
      }
    } catch {
      /* 目录缺失 */
    }
    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    this.writeIndex(rows)
    return rows
  }

  // ─────────── SSE 订阅 ───────────

  on(sessionId: string, handler: (ev: SessionEvent) => void): () => void {
    let em = this.emitters.get(sessionId)
    if (!em) {
      em = new EventEmitter()
      this.emitters.set(sessionId, em)
    }
    em.on('event', handler)
    const refs = ((em as unknown as { _refs?: number })._refs ?? 0) + 1
    ;(em as unknown as { _refs?: number })._refs = refs
    return () => {
      em.off('event', handler)
      const left = ((em as unknown as { _refs?: number })._refs ?? 1) - 1
      ;(em as unknown as { _refs?: number })._refs = left
      if (left <= 0) this.emitters.delete(sessionId)
    }
  }

  private emit(sessionId: string, ev: SessionEvent): void {
    this.emitters.get(sessionId)?.emit('event', ev)
  }

  private persist(rec: SessionRecord): void {
    const dir = this.dirOf(rec.id)
    mkdirSync(dir, { recursive: true })
    const target = join(dir, 'session.json')
    const tmp = target + '.tmp'
    writeFileSync(tmp, JSON.stringify(rec, null, 2), 'utf8')
    renameSync(tmp, target) // 崩溃时不会留下半截 JSON
    this.touchIndex(rec)
  }

  private touchIndex(rec: SessionRecord): void {
    const rows = this.list().filter((r) => r.id !== rec.id)
    rows.push(toRow(rec))
    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    this.writeIndex(rows)
  }

  private writeIndex(rows: SessionListRow[]): void {
    try {
      const tmp = this.indexFile + '.tmp'
      writeFileSync(tmp, JSON.stringify({ updatedAt: new Date().toISOString(), sessions: rows }, null, 2), 'utf8')
      renameSync(tmp, this.indexFile)
    } catch {
      /* 索引写失败不阻断主流程 */
    }
  }
}

function toRow(rec: SessionRecord): SessionListRow {
  return {
    id: rec.id,
    title: rec.title ?? rec.id,
    titleSource: rec.titleSource ?? 'none',
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
    status: rec.status,
    source: rec.source,
    segments: rec.segments.length,
    durationMs: rec.durationMs,
    transcriptLength: rec.transcript.length,
    hasAudio: Boolean(rec.audio),
    hasMarkdown: Boolean(rec.markdown),
    hasSummary: Boolean(rec.summary?.text),
    bytes: (rec.audio?.bytes ?? 0) + (rec.markdown?.bytes ?? 0),
  }
}

/** `20260915-004600` 这种按本地时间排的稳定前缀。 */
function fileStamp(iso: string): string {
  const d = new Date(iso)
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  if (Number.isNaN(d.getTime())) return '00000000-000000'
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function newSessionId(at?: string): string {
  const d = at ? new Date(at) : new Date()
  const t = Number.isNaN(d.getTime()) ? new Date() : d
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `rec-${t.getFullYear()}${p(t.getMonth() + 1)}${p(t.getDate())}-${p(t.getHours())}${p(t.getMinutes())}${p(t.getSeconds())}-${randomUUID().slice(0, 6)}`
}

/** 目录体积（用于面板显示）。 */
export function dirSize(path: string): number {
  try {
    let total = 0
    for (const f of readdirSync(path)) {
      try {
        const st = statSync(join(path, f))
        if (st.isFile()) total += st.size
      } catch {
        /* skip */
      }
    }
    return total
  } catch {
    return 0
  }
}
