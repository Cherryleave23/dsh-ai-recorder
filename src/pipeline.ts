/**
 * 处理管线：处理器注册表（高度可扩展）+ 内置 work/summary/revise-text/echo。
 * LLM 驱动：agentDefaultModel 默认路由 + dsh-llm 流式调用。
 */
import type LlmService from '@deepseek-ai/dsh-llm'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { Config } from './config.js'
import type { SessionManager } from './session.js'
import type { NoteStore } from './notes.js'

export interface ProcessRequest {
  sessionId: string
  mode: string
  text?: string
  params?: Record<string, unknown>
}

export interface ProcessResult {
  ok: boolean
  text?: string
  note?: string
  notePath?: string
  error?: string
}

export interface ModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

export interface PipelineDeps {
  llm: LlmService
  getDefaultModel: () => ModelSelection | null
  cfg: Config
  sessions: SessionManager
  notes: NoteStore
  log: (...args: unknown[]) => void
}

export type Processor = (req: ProcessRequest, deps: PipelineDeps) => Promise<ProcessResult>

const DEFAULT_WORK_SYSTEM =
  '你是任务执行 agent。用户会给你一段录音转写文本和任务指令。' +
  '请基于转写内容完成指令要求（提取信息、整理、执行动作说明等），' +
  '直接输出结果，不要复述过程，不要客套。'

const DEFAULT_SUMMARY_SYSTEM =
  '你是会议记录专家。用户会给你一段录音转写文本，请生成一份结构化 Markdown 笔记，包含：' +
  '\n- 标题（第一行 # 开头，简洁概括主题）' +
  '\n- ## 主题与背景' +
  '\n- ## 要点（分条列出关键内容）' +
  '\n- ## 行动项（如无则写"无"）' +
  '\n- ## 决议 / 结论' +
  '\n- ## 待跟进（如无则写"无"）' +
  '\n只输出 Markdown 正文，不要额外说明。'

const DEFAULT_REVISE_SYSTEM =
  '你是语音转写文本修订专家。请将口语化语音转写文本修订为书面化、通顺、逻辑清晰的文本：' +
  '修正错别字与同音词、去除语气词与重复、按语义分段（空行分隔）、保留原意与信息完整性。' +
  '只输出修订后的文本，不要任何说明。'

export class Pipeline {
  private registry = new Map<string, Processor>()

  constructor() {
    this.register('echo', async (req, deps) => {
      const text = req.text ?? deps.sessions.get(req.sessionId)?.transcript ?? ''
      return { ok: true, text }
    })
    this.register('work', this.workProcessor)
    this.register('summary', this.summaryProcessor)
    this.register('revise-text', this.reviseTextProcessor)
  }

  register(mode: string, fn: Processor): void {
    this.registry.set(mode, fn)
  }

  list(): string[] {
    return [...this.registry.keys()]
  }

  async run(req: ProcessRequest, deps: PipelineDeps): Promise<ProcessResult> {
    const fn = this.registry.get(req.mode)
    if (!fn) return { ok: false, error: `未知处理模式: ${req.mode}（可用: ${this.list().join(', ')}）` }
    try {
      return await fn(req, deps)
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  // ═══ 内置处理器 ═══

  private async callLlm(deps: PipelineDeps, system: string, user: string, maxTokens = 4000): Promise<string> {
    const sel = deps.getDefaultModel()
    if (!sel) throw new Error('无默认模型路由（agentDefaultModel 未配置）')
    let text = ''
    const stream = deps.llm.stream({
      provider: sel.provider,
      model: sel.model,
      system,
      messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: user }] })],
      temperature: 0,
      reasoningEffort: ReasoningEffortId('off'),
      maxTokens,
    })
    for await (const chunk of stream) {
      if (chunk.type === 'text-delta') text += chunk.text
    }
    return text.trim()
  }

  private readonly workProcessor: Processor = async (req, deps) => {
    const text = req.text ?? deps.sessions.get(req.sessionId)?.transcript ?? ''
    if (!text.trim()) return { ok: false, error: '无可用转写文本' }
    const instruction = (req.params?.instruction as string | undefined)?.trim() || '基于以上转写内容完成任务并给出结果。'
    const user = `【转写文本】\n${text}\n\n【任务指令】\n${instruction}`
    const out = await this.callLlm(deps, deps.cfg.llmSystemWork, user)
    return { ok: true, text: out }
  }

  private readonly summaryProcessor: Processor = async (req, deps) => {
    const text = req.text ?? deps.sessions.get(req.sessionId)?.transcript ?? ''
    if (!text.trim()) return { ok: false, error: '无可用转写文本' }
    const style = deps.cfg.noteStyle === 'detailed' ? '（尽量详尽，保留关键细节与数字）' : '（简洁，聚焦要点）'
    const user = `【转写文本】\n${text}\n\n请生成${style} Markdown 笔记。`
    const md = await this.callLlm(deps, deps.cfg.llmSystemSummary, user, 6000)
    const titleMatch = md.match(/^#\s+(.+)$/m)
    const title = titleMatch?.[1]?.trim() || `会话笔记 ${req.sessionId}`
    const meta = deps.notes.save(req.sessionId, title, md)
    deps.log('note saved', meta.id, meta.path)
    return { ok: true, text: md, note: meta.id, notePath: meta.path }
  }

  private readonly reviseTextProcessor: Processor = async (req, deps) => {
    const text = req.text ?? deps.sessions.get(req.sessionId)?.transcript ?? ''
    if (!text.trim()) return { ok: false, error: '无可用转写文本' }
    const user = `【原始转写文本】\n${text}\n\n请修订为书面化文本。`
    const out = await this.callLlm(deps, deps.cfg.llmSystemRevise, user, 6000)
    const session = deps.sessions.setRevision(req.sessionId, out, 'text')
    return { ok: true, text: out, note: session?.revision ? `revision@${session.revision.at}` : undefined }
  }
}