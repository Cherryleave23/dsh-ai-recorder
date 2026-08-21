import z from '@deepseek-ai/schemastery'

/**
 * 录音卡后端配置 —— STT 可插拔（mock / openai-compat / whisper-cpp-cli），不绑定单一模型。
 */
export interface Config {
  /** STT 提供方: mock=联调占位 / openai-compat=OpenAI 兼容HTTP(本地server或云端API) / whisper-cpp-cli=本地子进程离线 / faster-whisper-py=本地Python离线 / qwen-audio-py=Qwen3-ASR本地GPU */
  sttProvider: 'mock' | 'openai-compat' | 'whisper-cpp-cli' | 'faster-whisper-py' | 'qwen-audio-py'
  /** openai-compat: 端点 base（如 http://127.0.0.1:8080/v1 或 https://api.openai.com/v1） */
  openaiCompatBaseUrl: string
  openaiCompatApiKey: string
  openaiCompatModel: string
  /** whisper-cpp-cli: 可执行文件与模型路径 */
  whisperCppCliPath: string
  whisperCppModelPath: string
  /** faster-whisper(py): python 解释器 / 模型目录 / 转写脚本（留空=自动探测 outDir/whisper/） */
  pythonPath: string
  fasterWhisperModelDir: string
  fasterWhisperScript: string
  /** qwen-audio-py: Qwen3-ASR 专用 venv python 与模型目录（如 ~/.dsh/recorder-backend/qwen-venv / qwen/Qwen3-ASR-1.7B） */
  qwenPythonPath: string
  qwenModelDir: string
  /** 默认识别语言: zh / en / ja / ko / ru / auto */
  language: string
  /** 输出目录: 转写文本 / 中间音频 / (批B) MD 笔记 */
  outDir: string
  /** 可选鉴权 token（请求头 X-Recorder-Token；留空则不鉴权，仅限本机场景） */
  token: string
  /** 转写完成后自动处理模式（批B接入 agent；当前占位: none） */
  autoProcessMode: 'none' | 'work' | 'summary'
  /** 转写文本保留份数（JSONL 历史） */
  historyLimit: number
  /** work 处理器 system prompt */
  llmSystemWork: string
  /** summary 处理器 system prompt */
  llmSystemSummary: string
  /** revise-text 处理器 system prompt */
  llmSystemRevise: string
  /** 笔记风格 */
  noteStyle: 'concise' | 'detailed'
  /** DSH 对话投递模式（会话显式绑定 dshSessionId 时生效）: off=不投递 / transcript-only / result-only / both */
  deliverMode: 'off' | 'transcript-only' | 'result-only' | 'both'
  /** 投递是否唤醒目标 agent 处理（true=agent.followup 触发回合并回复；false=agent.inject 仅入上下文） */
  deliverWakeup: boolean
  /** 连接蓝牙后自动同步离线录音（true=连上即拉取未处理文件） */
  bleAutoSync: boolean
  /** 离线录音同步成功后是否删除设备端文件（默认不删，靠索引去重） */
  bleSyncDeleteAfter: boolean
}

export const Config = z.object({
  sttProvider: z.union(['mock', 'openai-compat', 'whisper-cpp-cli', 'faster-whisper-py', 'qwen-audio-py']).default('mock'),
  openaiCompatBaseUrl: z.string().default('http://127.0.0.1:8080/v1'),
  openaiCompatApiKey: z.string().default(''),
  openaiCompatModel: z.string().default('whisper-1'),
  whisperCppCliPath: z.string().default('whisper-cli'),
  whisperCppModelPath: z.string().default('models/ggml-base.bin'),
  pythonPath: z.string().default('python'),
  fasterWhisperModelDir: z.string().default(''),
  fasterWhisperScript: z.string().default(''),
  qwenPythonPath: z.string().default(''),
  qwenModelDir: z.string().default(''),
  language: z.string().default('zh'),
  outDir: z.string().default(''),
  token: z.string().default(''),
  autoProcessMode: z.union(['none', 'work', 'summary']).default('none'),
  historyLimit: z.number().min(1).max(10000).default(1000),
  llmSystemWork: z.string().default(
    '你是任务执行 agent。用户会给你一段录音转写文本和任务指令。' +
    '请基于转写内容完成指令要求（提取信息、整理、执行动作说明等），' +
    '直接输出结果，不要复述过程，不要客套。'
  ),
  llmSystemSummary: z.string().default(
    '你是会议记录专家。用户会给你一段录音转写文本，请生成一份结构化 Markdown 笔记，包含：' +
    '\n- 标题（第一行 # 开头，简洁概括主题）' +
    '\n- ## 主题与背景' +
    '\n- ## 要点（分条列出关键内容）' +
    '\n- ## 行动项（如无则写"无"）' +
    '\n- ## 决议 / 结论' +
    '\n- ## 待跟进（如无则写"无"）' +
    '\n只输出 Markdown 正文，不要额外说明。'
  ),
  llmSystemRevise: z.string().default(
    '你是语音转写文本修订专家。请将口语化语音转写文本修订为书面化、通顺、逻辑清晰的文本：' +
    '修正错别字与同音词、去除语气词与重复、按语义分段（空行分隔）、保留原意与信息完整性。' +
    '只输出修订后的文本，不要任何说明。'
  ),
  noteStyle: z.union(['concise', 'detailed']).default('concise'),
  deliverMode: z.union(['off', 'transcript-only', 'result-only', 'both']).default('both'),
  deliverWakeup: z.boolean().default(true),
  bleAutoSync: z.boolean().default(true),
  bleSyncDeleteAfter: z.boolean().default(false),
})