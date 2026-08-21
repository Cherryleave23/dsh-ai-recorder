/**
 * 笔记库（NoteStore）：summary 处理器产出结构化 MD 笔记，落盘 outDir/notes/<yyyy-mm>/<slug>.md
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export interface NoteMeta {
  id: string
  sessionId: string
  title: string
  createdAt: string
  path: string
}

export class NoteStore {
  private dir: string

  constructor(outDir: string) {
    this.dir = join(outDir, 'notes')
    mkdirSync(this.dir, { recursive: true })
  }

  private slug(title: string): string {
    const cleaned = title
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40)
    return cleaned || 'note'
  }

  /** 保存笔记；返回 meta（含磁盘路径） */
  save(sessionId: string, title: string, md: string): NoteMeta {
    const now = new Date()
    const ym = now.toISOString().slice(0, 7)
    const monthDir = join(this.dir, ym)
    mkdirSync(monthDir, { recursive: true })
    const id = `${now.toISOString().slice(0, 10)}-${this.slug(title)}-${sessionId.replace(/^sess-/, '').slice(0, 6)}`
    const fileName = id + '.md'
    const path = join(monthDir, fileName)
    const header = `---\nid: ${id}\nsessionId: ${sessionId}\ntitle: ${title.replace(/[:\n]/g, ' ')}\ncreatedAt: ${now.toISOString()}\n---\n\n`
    writeFileSync(path, header + md, 'utf8')
    return { id, sessionId, title, createdAt: now.toISOString(), path }
  }

  list(): NoteMeta[] {
    const out: NoteMeta[] = []
    try {
      for (const month of readdirSync(this.dir)) {
        const monthDir = join(this.dir, month)
        if (!existsSync(monthDir) || !readdirSync(this.dir).length) continue
        for (const f of readdirSync(monthDir)) {
          if (!f.endsWith('.md')) continue
          const path = join(monthDir, f)
          try {
            const head = readFileSync(path, 'utf8').split('\n---')[0] ?? ''
            const grab = (k: string) => head.match(new RegExp(`^${k}:\\s*(.+)$`, 'm'))?.[1]?.trim() ?? ''
            out.push({
              id: grab('id') || f.replace(/\.md$/, ''),
              sessionId: grab('sessionId'),
              title: grab('title'),
              createdAt: grab('createdAt'),
              path,
            })
          } catch { /* skip */ }
        }
      }
    } catch { /* skip */ }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  read(id: string): { md: string; meta?: NoteMeta } | undefined {
    const hit = this.list().find((n) => n.id === id)
    if (!hit) return undefined
    try {
      return { md: readFileSync(hit.path, 'utf8'), meta: hit }
    } catch {
      return undefined
    }
  }
}