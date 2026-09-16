/**
 * 后处理：录音转写完成后，把内容交给 Agent 做进一步加工。
 *
 * 三块配置（用户明确要求的）：
 *   ① 提示词模板   内置两套 + 用户自定义可保存
 *   ② 转向对话     第一次默认新建对话，用户可指定
 *   ③ 运转方式     单次同步后自动流转 / 同步后手动确认流转
 */

/** 运转方式 */
export type PostFlowMode = 'auto' | 'confirm'

export interface PromptTemplate {
  id: string
  name: string
  /** 一句话说明它适合什么场景 */
  summary: string
  /** 是否为内置（内置不可删除，可复制成自定义再改） */
  builtin: boolean
  body: string
}

export interface PostProcessConfig {
  enabled: boolean
  /** 当前选中的模板 id */
  templateId: string
  /**
   * 转向哪个对话。
   * `null` = 每次都新建一个对话（首次使用的默认行为）。
   */
  conversationId: string | null
  mode: PostFlowMode
}

export const DEFAULT_POST_PROCESS: PostProcessConfig = {
  enabled: false,
  templateId: 'meeting-notes',
  conversationId: null,
  mode: 'confirm',
}

/**
 * 内置模板。
 *
 * 措辞都是刻意的：
 *  - 音质免责必须写在里面。录音卡是 16kbps Opus、单麦、-90dBm 弱信号链路，
 *    识别误差是常态；不告诉 Agent 它会把明显的错字当成事实继续推理。
 *  - 「不漂移」这个约束同样必要：只说「适当补全」的话，模型很容易顺着上下文
 *    编出原文没有的内容。
 *  - 想法输送那条要求「不清晰时先问」，因为那条路径产出的是**指令**，
 *    按猜测执行比不执行更糟。
 */
export const BUILTIN_TEMPLATES: PromptTemplate[] = [
  {
    id: 'meeting-notes',
    name: '纪要整理',
    summary: '把录音整理成 Markdown 纪要；不同主题分别产出不同文档',
    builtin: true,
    body: `你收到的是一段来自录音卡的录音转写文本。请把它整理成结构化的 Markdown 纪要。

【关键要求：按主题拆分】
这段录音里可能混着**多个互不相关的主题**。你必须先判断有几个主题，然后**为每个主题单独产出一份 Markdown 文档**，不要把无关内容混在一份文档里。

例如录音里依次提到「插件A的开发进展」「今天中午吃什么」「一次会议内容」，那就应该产出 3 份不同的 md 文档，各自独立、各有标题。

【关于识别误差】
这段文本来自蓝牙录音卡（16kbps Opus、单麦克风、链路信号弱），**存在识别误差是常态**：同音字、专有名词、数字、人名都可能被识别错。

因此在整理时：
- 应当结合上下文**适当补全**明显被截断或识别错误的词句，让文意通顺；
- 但**整体不得漂移**：不得添加原文没有的事实、结论、数字或人名；
- 补全的把握不大时，保留原文并标注「（此处疑似识别有误，原文：…）」，不要替用户下判断。

【输出格式】
每份文档用一级标题（# 主题名）开头，正文按内容组织小标题与要点。

【必须把成果关联回录音卡】
每份纪要整理好后，**都要调用 recorder_attach_notes 工具把它关联到来源录音**（参数名不要加反引号，直接传字符串）：

- sessionId：填这段内容对应的「录音会话 id」（每条录音的转写正文前都标了，形如 session-…）
- title：这份纪要的主题标题（和文档一级标题一致）
- markdown：这份纪要的完整 Markdown 正文

**一份主题调用一次**。例如拆出 3 个主题，就调用 3 次、传 3 个不同的 title。
只有调用过工具，这份纪要才会出现在录音卡面板的「纪要查看」页；只在对话里输出正文的话用户看不到。

最后再用一两句话告诉用户：拆出了几个主题、各自关联成了哪份文档。`,
  },
  {
    id: 'voice-command',
    name: '想法输送',
    summary: '把录音当成一条给你的指令来处理',
    builtin: true,
    body: `你收到的是一段来自录音卡的语音转写文本。**这不是普通的录音内容，而是一条发给你的指令**——用户是口述给你听的，希望你去执行。

【关于识别误差】
这段文本来自蓝牙录音卡（16kbps Opus、单麦克风、链路信号弱），**存在识别误差是常态**：同音字、专有名词、数字、路径、人名都可能被识别错。

因此：
- 可以结合上下文补全明显被识别错的词句；
- **但涉及重要事项（要执行的命令、文件路径、参数、数量、人名、时间）时，如果不清晰或存在多种合理解读，必须先向用户询问确认，不要按猜测直接执行**；
- 不确定的地方明确说出来，不要默默替你理解。

【先复述再执行】
在执行任何操作之前，先用一两句话复述你理解的指令是什么，以及你打算怎么做，让用户有机会纠正。

【输出】
如果这条指令只是要一个结果或回答，直接给出；如果它要求修改文件、执行命令等有副作用的操作，先说明计划并等待确认。`,
  },
]

/** 把内置 + 用户自定义合成完整列表（自定义可覆盖同名 id）。 */
export function allTemplates(userTemplates: PromptTemplate[]): PromptTemplate[] {
  const byId = new Map<string, PromptTemplate>()
  for (const t of BUILTIN_TEMPLATES) byId.set(t.id, t)
  for (const t of userTemplates) byId.set(t.id, { ...t, builtin: false })
  return [...byId.values()]
}

/** 校验一份用户模板（来自界面，必须当作不可信输入）。 */
export function normalizeTemplate(raw: unknown): PromptTemplate | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  // id 可以为空 —— **新建模板本来就没有 id**，由服务端生成。
  // 但若客户端给了一个 id，就必须合法且不能占用内置的 id。
  const rawId = typeof o.id === 'string' ? o.id.trim() : ''
  if (rawId && BUILTIN_TEMPLATES.some((t) => t.id === rawId)) return null
  if (rawId && !/^[A-Za-z0-9_-]{1,64}$/.test(rawId)) return null
  const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim() : null
  const body = typeof o.body === 'string' && o.body.trim() ? o.body : null
  if (!name || !body) return null
  if (name.length > 64) return null
  // 长度上限：提示词会被整段塞进 Agent，过大没有意义
  if (body.length > 20_000) return null
  return {
    id: rawId,
    name,
    summary: typeof o.summary === 'string' ? o.summary.slice(0, 200) : '',
    builtin: false,
    body,
  }
}

/** 由模板名生成一个可用的 id。 */
export function templateIdFrom(name: string): string {
  const ascii = name.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()
  const base = ascii || 'tpl'
  return `${base}-${Date.now().toString(36).slice(-5)}`
}
