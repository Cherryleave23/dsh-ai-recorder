/**
 * 流转日志：记录每条录音是否已经被交给过 LLM。
 *
 * 为什么要单独存一个文件、而不是挂进会话记录里：
 *   ① 会话记录是插件自己的产物，格式改动要迁就已有数据；
 *   ② 流转是**外部副作用**的记录（发出去了、发到哪、什么时候），
 *      和录音本身的元数据不是一类东西；
 *   ③ 独立文件可以在会话被删掉之后仍然保留（纪要归档也是这个思路）。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** 流转方式 */
export type FlowKind = 'summary' | 'deliver' | 'auto'

export interface FlowRecord {
  /** 被流转的录音会话 id */
  sessionId: string
  kind: FlowKind
  /** 发到了哪个对话（新建对话时是新建出来的那个 id） */
  targetSessionId: string
  at: string
  /** 用了哪个提示词模板（自动流转时有） */
  templateId?: string
  /** 这一轮带上了几条录音（合并发送时 > 1） */
  batchSize?: number
}

type FlowFile = Record<string, FlowRecord[]>

function flowFile(outDir: string): string {
  return join(outDir, 'flow-log.json')
}

function read(outDir: string): FlowFile {
  try {
    const raw = JSON.parse(readFileSync(flowFile(outDir), 'utf8'))
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as FlowFile
  } catch {
    /* 首次运行没有这个文件 */
  }
  return {}
}

function write(outDir: string, data: FlowFile): void {
  try {
    writeFileSync(flowFile(outDir), JSON.stringify(data, null, 2), 'utf8')
  } catch {
    /* 写不进去不该影响主流程 */
  }
}

/** 记一次流转。同一条录音同一目标同一模板的重复记录会被合并（重发不刷屏）。 */
export function markFlowed(outDir: string, rec: FlowRecord): void {
  if (!rec.sessionId || !rec.targetSessionId) return
  const data = read(outDir)
  const list = data[rec.sessionId] ?? []
  const dup = list.find(
    (x) => x.targetSessionId === rec.targetSessionId && x.templateId === rec.templateId && x.kind === rec.kind,
  )
  if (dup) dup.at = rec.at
  else list.push(rec)
  data[rec.sessionId] = list
  write(outDir, data)
}

/** 某条录音的流转记录（按时间倒序）。 */
export function flowsFor(outDir: string, sessionId: string): FlowRecord[] {
  return (read(outDir)[sessionId] ?? []).slice().sort((a, b) => b.at.localeCompare(a.at))
}

/** 全部流转记录，按录音会话分组（列表页批量显示标记用）。 */
export function allFlows(outDir: string): FlowFile {
  return read(outDir)
}

/** 会话被彻底删除时清掉它的流转记录。 */
export function clearFlows(outDir: string, sessionId: string): void {
  const data = read(outDir)
  if (data[sessionId] === undefined) return
  delete data[sessionId]
  write(outDir, data)
}
