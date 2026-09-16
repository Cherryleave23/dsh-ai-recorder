/**
 * 纪要文档存储。
 *
 * 固定路径：`<outDir>/notes/<录音会话 id>/<标题>.md`
 *
 * 为什么按「录音会话 id」分目录而不是按标题平铺：
 *   一个录音可能被拆成多份纪要（比如一段录音里既讲了「插件A开发」又讲了
 *   「午饭吃什么」，纪要模板要求分别产出两份 md）。它们同源于一条录音，
 *   放在同一个目录下才能被「纪要查看」页一次读出来。
 *
 * 为什么由插件自己管目录、而不是让 Agent 随便写文件：
 *   Agent 写到哪里是它自己的自由，但「纪要查看」要能稳定读到，
 *   就必须有一个约定好的落点。所以工具负责**把 Agent 的产出收拢到这条路径**，
 *   并返回真实路径，让 Agent 知道东西放哪了。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export interface NoteDoc {
  /** 文件名（不含 .md） */
  slug: string
  title: string
  /** 绝对路径 */
  path: string
  bytes: number
  updatedAt: string
}

/** 会话 id 会被当成目录名，必须白名单化，避免 `../` 逃逸。 */
export function isSafeId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,80}$/.test(id)
}

/** 标题 → 文件名。保留中文（用户要看得懂），只剔除路径危险字符。 */
export function slugify(title: string): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return cleaned || `note-${Date.now().toString(36)}`
}

function notesRoot(outDir: string): string {
  return join(outDir, 'notes')
}

function sessionDir(outDir: string, sessionId: string): string {
  return join(notesRoot(outDir), sessionId)
}

/**
 * 写入一份纪要。同名会被覆盖（Agent 重跑同一段录音时应当覆盖而不是堆一堆副本）。
 * 返回落盘的真实路径。
 */
export function saveNote(
  outDir: string,
  sessionId: string,
  title: string,
  markdown: string,
): { ok: true; doc: NoteDoc } | { ok: false; error: string } {
  if (!isSafeId(sessionId)) {
    return { ok: false, error: `会话 id 不合法：${sessionId}` }
  }
  const slug = slugify(title)
  const dir = sessionDir(outDir, sessionId)
  try {
    mkdirSync(dir, { recursive: true })
    const path = join(dir, `${slug}.md`)
    // 路径安全兜底：确认最终路径确实在 notes 根下（防住 slug 里残留的奇怪字符）
    if (!resolve(path).startsWith(resolve(notesRoot(outDir)))) {
      return { ok: false, error: '拒绝写入 notes 目录之外的路径' }
    }
    writeFileSync(path, markdown, 'utf8')
    const st = statSync(path)
    return {
      ok: true,
      doc: { slug, title, path, bytes: st.size, updatedAt: new Date(st.mtimeMs).toISOString() },
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 列出某个录音会话名下的全部纪要。 */
export function listNotes(outDir: string, sessionId: string): NoteDoc[] {
  if (!isSafeId(sessionId)) return []
  const dir = sessionDir(outDir, sessionId)
  if (!existsSync(dir)) return []
  const out: NoteDoc[] = []
  try {
    for (const f of readdirSync(dir)) {
      if (!f.toLowerCase().endsWith('.md')) continue
      const path = join(dir, f)
      try {
        const st = statSync(path)
        out.push({
          slug: f.slice(0, -3),
          title: f.slice(0, -3),
          path,
          bytes: st.size,
          updatedAt: new Date(st.mtimeMs).toISOString(),
        })
      } catch {
        /* 单个文件读不到就跳过 */
      }
    }
  } catch {
    return []
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/** 读一份纪要的正文。 */
export function readNote(path: string, outDir: string): string | null {
  // 只允许读 notes 目录下的文件：Agent 传进来的 path 是不可信输入
  if (!resolve(path).startsWith(resolve(notesRoot(outDir)))) return null
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/** 扫描 notes 下所有录音会话 → 各有多少篇纪要（「纪要查看」列表用）。 */
export function listAllNotes(outDir: string): Record<string, NoteDoc[]> {
  const root = notesRoot(outDir)
  const out: Record<string, NoteDoc[]> = {}
  if (!existsSync(root)) return out
  try {
    for (const d of readdirSync(root)) {
      if (!isSafeId(d)) continue
      const docs = listNotes(outDir, d)
      if (docs.length > 0) out[d] = docs
    }
  } catch {
    /* 目录不可读 */
  }
  return out
}
