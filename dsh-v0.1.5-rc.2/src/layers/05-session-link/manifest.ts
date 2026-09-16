/**
 * L5 对应关系层 · session_id ↔ 三件产物
 *
 * 流程图 L5 要求 session_id 把三样东西串起来：本地音频文件、Markdown 文档、实时文本流。
 * 本层是唯一的「查得到」入口——任何消费方拿一个 session_id，就能得到：
 *
 *   - 会话目录（三件套落在一起的物理位置）
 *   - 音频文件路径
 *   - Markdown 文件路径
 *   - 实时文本流的订阅地址（SSE）
 *   - 以及每条产物是否已就位
 *
 * 这样「按 session_id 找齐东西」这件事只有一个实现，不会散落在各处。
 */
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { SessionRecord, SessionStore } from '../04-output/session-store.js'

export interface ArtifactSlot {
  /** 是否存在 */
  present: boolean
  /** 绝对路径（音频/Markdown）；实时流为订阅地址 */
  ref: string
  bytes?: number
}

export interface SessionArtifacts {
  sessionId: string
  /** 会话目录 */
  dir: string
  /** 本地音频文件 */
  audio: ArtifactSlot
  /** Markdown 转写文档 */
  markdown: ArtifactSlot
  /** 实时文本流（SSE 端点路径） */
  stream: ArtifactSlot
  /** 会话记录文件 */
  record: ArtifactSlot
}

export const AUDIO_BASENAME = 'audio'
export const MARKDOWN_FILE = 'transcript.md'
export const RECORD_FILE = 'session.json'

/** 三件套的物理布局定义（**默认名**，仅用于没有记录可依的新会话/历史会话）。 */
export function layout(dir: string) {
  return {
    dir,
    audioOgg: join(dir, `${AUDIO_BASENAME}.ogg`),
    audioWav: join(dir, `${AUDIO_BASENAME}.wav`),
    markdown: join(dir, MARKDOWN_FILE),
    record: join(dir, RECORD_FILE),
  }
}

function slot(path: string): ArtifactSlot {
  if (!existsSync(path)) return { present: false, ref: path }
  try {
    return { present: true, ref: path, bytes: statSync(path).size }
  } catch {
    return { present: false, ref: path }
  }
}

/**
 * 解析某个产物的实际位置。
 *
 * 产物名会随标题变化（`<标题>.ogg` / `<标题>.md`），所以**先信会话记录里的文件名**，
 * 记录缺失或文件已不在时才退回默认名。老会话（改名功能上线前建的）正是走这条回退路径。
 */
function resolveSlot(dir: string, recorded: { file: string } | null | undefined, fallbacks: string[]): ArtifactSlot {
  if (recorded?.file) {
    const s = slot(join(dir, recorded.file))
    if (s.present) return s
  }
  for (const name of fallbacks) {
    const s = slot(join(dir, name))
    if (s.present) return s
  }
  // 都不在：给出记录里期望的路径，让调用方能打印出「本来该在哪」
  return { present: false, ref: join(dir, recorded?.file ?? fallbacks[0]) }
}

/**
 * 按 session_id 解析三件产物。
 * `streamPath` 由调用方给出（HTTP 前缀属于插件入口，不归本层）。
 */
export function resolveArtifacts(
  store: SessionStore,
  sessionId: string,
  streamPathFor: (sessionId: string) => string,
): SessionArtifacts | undefined {
  const rec = store.get(sessionId)
  if (!rec) return undefined
  const dir = store.dirOf(sessionId)
  const L = layout(dir)
  // 音频可能是 ogg（Opus 归档）或 wav（设备转码）
  const audio = resolveSlot(dir, rec.audio, [`${AUDIO_BASENAME}.ogg`, `${AUDIO_BASENAME}.wav`])
  return {
    sessionId,
    dir,
    audio,
    markdown: resolveSlot(dir, rec.markdown, [MARKDOWN_FILE]),
    stream: { present: rec.status === 'open', ref: streamPathFor(sessionId) },
    record: slot(L.record),
  }
}

/** 三件套是否齐备（会话关闭时应为 true）。 */
export function artifactsComplete(a: SessionArtifacts): boolean {
  return a.audio.present && a.markdown.present && a.record.present
}

/** 会话摘要行的「齐备度」标记，供列表展示。 */
export function completenessOf(rec: SessionRecord): string {
  const marks: string[] = []
  marks.push(rec.audio ? '音频' : '—')
  marks.push(rec.markdown ? 'MD' : '—')
  marks.push(rec.status === 'open' ? '流中' : '已闭')
  return marks.join(' / ')
}
