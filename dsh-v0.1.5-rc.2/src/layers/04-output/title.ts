/**
 * L4 输出层 · 会话标题
 *
 * 一次录音默认没有名字，只有时间戳。这里按流程图「完整转写结果」派生出一个人看得懂的名字：
 * 取转写文本开头的若干字，并清洗成**合法文件名**——因为它同时用作磁盘上的
 * 音频/Markdown 文件名（`<标题>.ogg` / `<标题>.md`）。
 *
 * 三层优先级（见 SessionRecord.titleSource）：
 *   user  用户手动改的，任何自动流程都不覆盖
 *   llm   LLM 汇总给出的标题，自动流程不覆盖
 *   auto  从转写开头截的，仅在没有更高优先级标题时使用
 */

/** 文件名里不能出现的字符（Windows 最严：`\ / : * ? " < > |` 加控制字符）。 */
const ILLEGAL = /[\\/:*?"<>|\u0000-\u001f]/g
/** Windows 保留设备名，做文件名会导致创建失败。 */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
/** 单个路径段的保守上限（Windows 255，留足后缀与去重空间）。 */
const MAX_BASE_LEN = 64

/** 清洗成可安全用作文件名的片段；清不出东西就返回 fallback。 */
export function sanitizeFileName(name: string, fallback: string): string {
  let s = (name ?? '')
    .replace(ILLEGAL, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  // Windows 不允许路径段以点或空格结尾
  s = s.replace(/^[. ]+/, '').replace(/[. ]+$/, '')
  if (s.length > MAX_BASE_LEN) s = s.slice(0, MAX_BASE_LEN).replace(/[. ]+$/, '')
  if (!s) return fallback
  if (RESERVED.test(s)) s = `_${s}`
  return s
}

/**
 * 从转写文本派生标题：取开头 maxChars 个字。
 * 会压平空白、去掉开头的标点，并且不把英文单词从中间切断。
 */
export function deriveTitle(transcript: string, maxChars = 12): string {
  const flat = (transcript ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s，。、！？；：,.!?;:）)】」』"']+/, '')
    .trim()
  if (!flat) return ''

  const n = Number(maxChars)
  // maxChars 若是 undefined/null/NaN，Math.floor 得到 NaN，
  // 而 `flat.slice(0, NaN)` 返回**空串**——于是每条自动标题都退化成时间兜底名，
  // 表现为「明明有转写却没有名字」。非有限值或非正数一律退回默认 12。
  const limit = Number.isFinite(n) && n > 0 ? Math.max(1, Math.min(64, Math.floor(n))) : 12
  let cut = flat.slice(0, limit)

  // 截断点落在英文/数字单词中间时，退到词边界，避免出现 "meetin" 这种半截词
  const next = flat.charAt(limit)
  if (cut && /[A-Za-z0-9]$/.test(cut) && /[A-Za-z0-9]/.test(next)) {
    const m = /[A-Za-z0-9]+$/.exec(cut)
    if (m && cut.length - m[0].length > 0) cut = cut.slice(0, cut.length - m[0].length)
  }

  return cut.replace(/[\s，。、！？；：,.!?;:]+$/, '').trim()
}

/**
 * 没有转写文本时的兜底名字（识别失败、空录音等）。
 * 用本地时间而不是 session_id：文件名要给人看。
 */
export function fallbackTitle(createdAt: string, kind: '录音' | '未转写' = '未转写'): string {
  const d = new Date(createdAt)
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  if (Number.isNaN(d.getTime())) return kind
  return `${kind} ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/** 取扩展名（含点）；没有扩展名返回空串。 */
export function extOf(file: string): string {
  const i = file.lastIndexOf('.')
  return i > 0 ? file.slice(i) : ''
}
