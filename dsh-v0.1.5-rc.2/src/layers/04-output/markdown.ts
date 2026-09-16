/**
 * L4 输出层 · Markdown 转写文档
 *
 * 流程图 L4：「完整转写结果 → Markdown 文档」。每次识别都产出，不依赖任何 LLM
 * （旧版的 summary 笔记库属于被砍掉的 AGENT 投递层）。
 */
import type { SessionRecord } from './session-store.js'

/** 毫秒 → mm:ss（超过 1 小时为 h:mm:ss） */
export function fmtClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const p = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`
}

/** 毫秒 → 2h13m 这种人话 */
export function fmtDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h${m}m`
  if (m > 0) return `${m}m${s}s`
  return `${s}s`
}

function fmtLocal(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

const SOURCE_LABEL: Record<SessionRecord['source'], string> = {
  realtime: '实时转写',
  file: '离线录音同步',
  upload: '音频上传',
}

/** 生成转写 Markdown：YAML 头（机读）+ 正文（人读）。 */
export function renderTranscriptMarkdown(rec: SessionRecord): string {
  const speakers = new Set(rec.segments.map((s) => s.speaker).filter((x): x is number => typeof x === 'number'))
  const title = rec.title?.trim() || `录音转写 · ${fmtLocal(rec.createdAt)}`
  const head = [
    '---',
    `title: ${yamlScalar(title)}`,
    `session_id: ${rec.id}`,
    `created_at: ${rec.createdAt}`,
    `source: ${rec.source}`,
    rec.titleSource ? `title_source: ${rec.titleSource}` : null,
    rec.device?.name ? `device: ${rec.device.name}` : null,
    rec.deviceFile ? `device_file: ${rec.deviceFile}` : null,
    `duration_ms: ${rec.durationMs}`,
    `duration: ${fmtDuration(rec.durationMs)}`,
    rec.model ? `model: ${rec.model}` : null,
    speakers.size > 0 ? `speakers: ${speakers.size}` : null,
    '---',
    '',
  ].filter((l): l is string => l !== null)

  const meta = [
    `- 时间：${fmtLocal(rec.createdAt)}`,
    `- 来源：${SOURCE_LABEL[rec.source]}`,
    rec.device?.name ? `- 设备：${rec.device.name}${rec.device.address ? `（${rec.device.address}）` : ''}` : null,
    `- 时长：${fmtDuration(rec.durationMs)}`,
    rec.model ? `- 识别模型：${rec.model}` : null,
    `- 分段数：${rec.segments.length}`,
  ].filter((l): l is string => l !== null)

  const body: string[] = []
  const segs = rec.segments
  if (segs.length === 0) {
    body.push('_（无转写内容）_')
  } else if (speakers.size > 0) {
    // 有说话人 → 对话体，更接近会议记录的可读性
    let last: number | undefined
    for (const s of segs) {
      const who = typeof s.speaker === 'number' ? `说话人 ${s.speaker + 1}` : '说话人 —'
      if (s.speaker !== last) {
        body.push('', `**${who}** · ${fmtClock(s.start)}`, '')
        last = s.speaker
      }
      body.push(s.text)
    }
  } else {
    // 无说话人 → 时间轴列表
    body.push('| 时间 | 内容 |', '| --- | --- |')
    for (const s of segs) {
      body.push(`| ${fmtClock(s.start)} | ${s.text.replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`)
    }
  }

  const revision: string[] = []
  if (rec.revision?.text) {
    revision.push('', '---', '', '## 修订稿', '', rec.revision.text)
  }

  return [...head, `# ${title}`, '', ...meta, '', '## 转写内容', ...body, ...revision, ''].join('\n')
}

/** YAML 标量：含特殊字符时加引号并转义，避免标题里的 `:` 把 front matter 弄坏。 */
function yamlScalar(v: string): string {
  if (/^[\w\u4e00-\u9fa5][\w\u4e00-\u9fa5 .-]*$/.test(v)) return v
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * 归档用的 LLM 总结文档。
 *
 * 删除录音会删掉整个会话目录（音频 + 转写 md），但 LLM 总结是**花过算力的产物**，
 * 不能跟着没了——删之前把它单独抄到 `<outDir>/summaries/`。这里刻意**不**附带
 * 完整转写原文（那等于把转写 md 又留了一份），只保留机读元信息 + 总结正文。
 */
export function renderArchivedSummary(rec: SessionRecord): string {
  const title = rec.summary?.title?.trim() || rec.title?.trim() || `总结 · ${fmtLocal(rec.createdAt)}`
  const head = [
    '---',
    `title: ${yamlScalar(title)}`,
    `session_id: ${rec.id}`,
    `recorded_at: ${rec.createdAt}`,
    `archived_at: ${new Date().toISOString()}`,
    `source: ${rec.source}`,
    rec.deviceFile ? `device_file: ${rec.deviceFile}` : null,
    `duration_ms: ${rec.durationMs}`,
    `duration: ${fmtDuration(rec.durationMs)}`,
    rec.model ? `model: ${rec.model}` : null,
    rec.speakerCount && rec.speakerCount > 0 ? `speakers: ${rec.speakerCount}` : null,
    `segments: ${rec.segments.length}`,
    '---',
    '',
  ].filter((l): l is string => l !== null)

  return [
    ...head,
    `# ${title}`,
    '',
    `> 原录音与转写文档已删除，本文件是保留下来的 LLM 总结。`,
    `> 录制时间：${fmtLocal(rec.createdAt)}　时长：${fmtDuration(rec.durationMs)}`,
    '',
    rec.summary?.text ?? '',
    '',
  ].join('\n')
}
