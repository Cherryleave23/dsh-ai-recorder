/**
 * 会话管理（SessionManager）：一个录音会话 = N 个转写分段；
 * 持久化到 outDir/sessions/<id>.json；内存 EventEmitter 供 SSE 订阅。
 */
import { EventEmitter } from 'node:events'
import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export interface Segment {
  id: string
  seq: number
  ts: string
  ext: string
  bytes: number
  text: string
  provider: string
}

export interface Revision {
  text: string
  at: string
  method: string
}

export interface Session {
  id: string
  createdAt: string
  language?: string
  mode?: string
  segments: Segment[]
  status: 'open' | 'closed'
  transcript: string
  revision?: Revision
  meta?: Record<string, unknown>
}

export type SessionEvent =
  | { type: 'segment'; sessionId: string; segment: Segment; transcript: string }
  | { type: 'revised'; sessionId: string; revision: Revision }
  | { type: 'note'; sessionId: string; noteId: string; notePath: string }
  | { type: 'close'; sessionId: string }

export class SessionManager {
  private dir: string
  private emitters = new Map<string, EventEmitter>()

  constructor(outDir: string) {
    this.dir = join(outDir, 'sessions')
    mkdirSync(this.dir, { recursive: true })
  }

  private pathOf(id: string): string {
    return join(this.dir, encodeURIComponent(id) + '.json')
  }

  /** 新建或按 id 复用会话 */
  open(id: string | undefined, opts: { language?: string; mode?: string; dshSessionId?: string } = {}): Session {
    const sessionId = id && /^[A-Za-z0-9._-]{1,80}$/.test(id) ? id : 'sess-' + randomUUID().slice(0, 8)
    const existing = this.get(sessionId)
    if (existing) {
      // 复用：补充绑定（不覆盖已有 meta）
      if (opts.dshSessionId && !existing.meta?.dshSessionId) {
        existing.meta = { ...(existing.meta ?? {}), dshSessionId: opts.dshSessionId }
        this.persist(existing)
      }
      return existing
    }
    const session: Session = {
      id: sessionId,
      createdAt: new Date().toISOString(),
      language: opts.language,
      mode: opts.mode,
      segments: [],
      status: 'open',
      transcript: '',
      meta: opts.dshSessionId ? { dshSessionId: opts.dshSessionId } : undefined,
    }
    this.persist(session)
    return session
  }

  get(id: string): Session | undefined {
    const p = this.pathOf(id)
    if (!existsSync(p)) return undefined
    try {
      return JSON.parse(readFileSync(p, 'utf8')) as Session
    } catch {
      return undefined
    }
  }

  append(sessionId: string, seg: Omit<Segment, 'id' | 'seq' | 'ts'>): Session | undefined {
    const session = this.get(sessionId)
    if (!session) return undefined
    const segment: Segment = {
      id: randomUUID(),
      seq: session.segments.length + 1,
      ts: new Date().toISOString(),
      ...seg,
    }
    session.segments.push(segment)
    session.transcript = session.segments.map((s) => s.text).filter(Boolean).join('\n')
    this.persist(session)
    this.emit(sessionId, { type: 'segment', sessionId, segment, transcript: session.transcript })
    return session
  }

  setRevision(sessionId: string, text: string, method: string): Session | undefined {
    const session = this.get(sessionId)
    if (!session) return undefined
    session.revision = { text, at: new Date().toISOString(), method }
    this.persist(session)
    this.emit(sessionId, { type: 'revised', sessionId, revision: session.revision })
    return session
  }

  /** 绑定/更新 DSH 会话关联（meta.dshSessionId）并持久化 */
  bindDsh(sessionId: string, dshSessionId: string): Session | undefined {
    const session = this.get(sessionId)
    if (!session) return undefined
    session.meta = { ...(session.meta ?? {}), dshSessionId }
    this.persist(session)
    return session
  }

  close(sessionId: string): Session | undefined {
    const session = this.get(sessionId)
    if (!session) return undefined
    session.status = 'closed'
    this.persist(session)
    this.emit(sessionId, { type: 'close', sessionId })
    return session
  }

  list(): { id: string; createdAt: string; status: string; segments: number; transcriptLength: number; language?: string; mode?: string }[] {
    try {
      return readdirSync(this.dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => {
          try {
            const s = JSON.parse(readFileSync(join(this.dir, f), 'utf8')) as Session
            return {
              id: s.id,
              createdAt: s.createdAt,
              status: s.status,
              segments: s.segments.length,
              transcriptLength: s.transcript.length,
              language: s.language,
              mode: s.mode,
            }
          } catch { return null }
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    } catch {
      return []
    }
  }

  private persist(session: Session): void {
    try {
      writeFileSync(this.pathOf(session.id), JSON.stringify(session, null, 2), 'utf8')
    } catch (e) {
      // 持久化失败不阻断主流程
      console.error('[dsh-ai-recorder] session persist failed', e)
    }
  }

  /** SSE 事件订阅 */
  on(sessionId: string, handler: (ev: SessionEvent) => void): () => void {
    let em = this.emitters.get(sessionId)
    if (!em) {
      em = new EventEmitter()
      this.emitters.set(sessionId, em)
    }
    em.on('event', handler)
    let refs = (em as any)._refs ?? 0
    ;(em as any)._refs = ++refs
    return () => {
      em.off('event', handler)
      ;(em as any)._refs = (em as any)._refs - 1
      if ((em as any)._refs <= 0) {
        this.emitters.delete(sessionId)
      }
    }
  }

  private emit(sessionId: string, ev: SessionEvent): void {
    this.emitters.get(sessionId)?.emit('event', ev)
  }
}