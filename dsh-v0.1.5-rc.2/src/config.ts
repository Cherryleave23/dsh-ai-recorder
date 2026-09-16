import z from '@deepseek-ai/schemastery'

/**
 * dsh-ai-recorder 配置（五层架构）。
 *
 * 识别层已收敛为 FunASR 单一引擎——旧的 mock / openai-compat / whisper-cpp-cli /
 * faster-whisper-py / qwen-audio-py 五个 provider 全部移除。
 */
export interface Config {
  // ─────────── L1 采集层 ───────────
  /** BLE 收端使用的 Python 解释器（留空=自动探测 python/python3/py） */
  pythonPath: string
  /** 连接设备后自动同步离线录音 */
  bleAutoSync: boolean
  /** 同步成功后删除设备端文件（默认不删，靠本地索引去重） */
  bleSyncDeleteAfter: boolean
  /**
   * 离线下载优先请求 .opus（设备原生格式，16 kbps ≈ 2 KB/s）。
   * 关闭则退回旧行为：优先 .wav（设备转码，32 KB/s，体积 16 倍）。
   */
  opusPreferred: boolean
  /** 下载件允许跳过的前导字节上限（设备导入通道会先吐一段非确定性数据） */
  captureSkipScanMax: number
  /** 实时流攒段窗口（毫秒）：把 40B/20ms 的包聚成一次送入识别的块 */
  realtimeWindowMs: number

  // ─────────── L2 预处理层 ───────────
  /** 统一格式：目标采样率 */
  targetSampleRate: number
  /** 统一格式：目标声道数 */
  targetChannels: number
  /** 统一格式：目标位深 */
  targetBits: number

  // ─────────── L3 识别层 ───────────
  /** ASR 模型 */
  asrModel: 'paraformer-zh' | 'sensevoice' | 'qwen3-asr'
  /**
   * 用户**还想要**哪些预设（不只是当前激活的那个）。
   *
   * 这是卸载时按引用计数回收共用组件的依据：组件 X 被 A、B 共用，
   * 卸 A 时 X 保留（B 还要），再卸 B 时 X 才被删。
   * 空数组 = 还没记录过，按「只有当前激活的预设」处理。
   */
  enabledPresets: string[]
  /** 后处理配置（提示词模板 / 转向对话 / 运转方式） */
  postProcess: {
    enabled: boolean
    templateId: string
    /** 转向的对话 id；空字符串 = 每次都新建对话 */
    conversationId: string
    mode: 'auto' | 'confirm'
  }
  /** 推理设备 */
  asrDevice: 'auto' | 'cpu' | 'cuda'
  /** 离线 VAD 断句 */
  asrVad: boolean
  /** 离线标点恢复 */
  asrPunc: boolean
  /** 离线说话人分离（cam++） */
  asrSpk: boolean
  /** 识别语言：auto = 交给模型判语种（SenseVoice 多语种时必须用 auto） */
  language: 'auto' | 'zh' | 'en' | 'yue' | 'ja' | 'ko'
  /** FunASR 专用 venv 的 python（留空=用 pythonPath） */
  funasrPythonPath: string
  /** FunASR 模型根目录（留空=outDir/funasr） */
  funasrModelDir: string
  /** Qwen3-ASR 模型根目录（留空=outDir/qwen）；venv 建在 outDir/qwen-venv */
  qwenModelDir: string
  /** Qwen3-ASR 权重目录名（在 qwenModelDir 下） */
  qwenModelName: string
  /** Qwen3-ASR 专用 venv 的 python（留空=outDir/qwen-venv） */
  qwenPythonPath: string
  /** 子进程代理；留空=剔除继承来的代理（国内源直连，推荐） */
  proxyUrl: string
  /** 流式 chunk 步长（毫秒）：FunASR online 模型建议 600ms */
  streamChunkMs: number
  /** 流式编码器/解码器回看块数（paraformer-streaming 默认 4 / 1） */
  streamEncoderLookBack: number
  streamDecoderLookBack: number

  // ─────────── L4 输出层 ───────────
  /** 数据根目录（留空=<DSH 数据目录>/recorder-backend） */
  outDir: string
  /** 每次识别产出 Markdown 转写文档 */
  markdownEnabled: boolean
  /** 会话目录保留原始音频（Opus Ogg 原档，体积 ≈ 2 KB/s） */
  keepAudio: boolean
  /** 转写历史保留条数 */
  historyLimit: number
  /** 自动按转写开头取标题（标题同时用作音频/Markdown 的文件名） */
  autoTitle: boolean
  /** 自动标题取多少个字 */
  titleMaxChars: number

  // ─────────── 其他 ───────────
  /** 可选鉴权 token（请求头 X-Recorder-Token；留空=不鉴权，仅限本机） */
  token: string
}

export const Config = z.object({
  pythonPath: z.string().default(''),
  bleAutoSync: z.boolean().default(true),
  // 同步成功后从卡上删掉该条。默认开——用户要的就是「转到电脑上后卡里别留了」。
  // 安全性由 isSafelyOnDisk() 兜底：只有本地音频确实落盘且非空才删。
  bleSyncDeleteAfter: z.boolean().default(true),
  opusPreferred: z.boolean().default(true),
  captureSkipScanMax: z.number().min(0).max(65536).default(65536),
  realtimeWindowMs: z.number().min(200).max(30000).default(1000),

  targetSampleRate: z.number().default(16000),
  targetChannels: z.number().default(1),
  targetBits: z.number().default(16),

  asrModel: z.union(['paraformer-zh', 'sensevoice', 'qwen3-asr']).default('paraformer-zh'),
  enabledPresets: z.array(z.string()).default([]),
  postProcess: z
    .object({
      enabled: z.boolean().default(false),
      templateId: z.string().default('meeting-notes'),
      conversationId: z.string().default(''),
      mode: z.union(['auto', 'confirm']).default('confirm'),
    })
    .default({ enabled: false, templateId: 'meeting-notes', conversationId: '', mode: 'confirm' }),
  asrDevice: z.union(['auto', 'cpu', 'cuda']).default('auto'),
  asrVad: z.boolean().default(true),
  asrPunc: z.boolean().default(true),
  asrSpk: z.boolean().default(true),
  /**
   * 识别语种。`auto` = 交给模型判语种。
   *
   * 默认必须是 `auto` 而不是 `zh`：paraformer-zh 是中文专用，写死 zh 无所谓；
   * 但一旦切换到 SenseVoiceSmall（多语种），写死 zh 会让英文录音**照样按中文识别**，
   * 白白浪费了多语种能力——这正是「换了模型英文还是乱码」的根因。
   */
  language: z.union(['auto', 'zh', 'en', 'yue', 'ja', 'ko']).default('auto'),
  funasrPythonPath: z.string().default(''),
  funasrModelDir: z.string().default(''),
  /**
   * Qwen3-ASR 模型目录（留空=outDir/qwen）。venv 固定建在 outDir/qwen-venv。
   *
   * 独立 venv 是必须的：`qwen-asr` 会和 `funasr` 在同环境里打架
   * （官方 issue #3042：单独升 funasr 会报 'Qwen3ASRConfig' object has no attribute 'thinker_config'）。
   */
  qwenModelDir: z.string().default(''),
  /** Qwen3-ASR 权重目录名（在 qwenModelDir 下）。0.6B 更省显存、1.7B 更准 */
  qwenModelName: z.string().default('Qwen3-ASR-1.7B'),
  /** Qwen3-ASR 专用 venv 的 python（留空=outDir/qwen-venv） */
  qwenPythonPath: z.string().default(''),
  /**
   * 子进程代理地址；**留空 = 不使用代理**（推荐）。
   *
   * 模型与依赖都走国内源（modelscope / 清华 pypi / hf-mirror），直连即可。
   * 若系统环境里配了代理，本插件会**主动剔除**而不是继承——本机环境里的
   * HTTP_PROXY 指向已死端口 10809（活的 v2ray 在 10808），继承下去会让下载全失败。
   * 确实需要走代理时填 `http://127.0.0.1:10808`。
   */
  proxyUrl: z.string().default(''),
  streamChunkMs: z.number().min(60).max(2000).default(600),
  streamEncoderLookBack: z.number().min(0).max(32).default(4),
  streamDecoderLookBack: z.number().min(0).max(32).default(1),

  outDir: z.string().default(''),
  markdownEnabled: z.boolean().default(true),
  keepAudio: z.boolean().default(true),
  historyLimit: z.number().min(1).max(10000).default(1000),
  autoTitle: z.boolean().default(true),
  titleMaxChars: z.number().min(2).max(64).default(12),

  token: z.string().default(''),
})
