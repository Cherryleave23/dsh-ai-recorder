/**
 * ASR 预设注册表。
 *
 * 设计要点：**预设**与**环境组件**是多对多关系，这是「卸载」安全的全部依据。
 *
 *   - 一个预设需要若干环境组件（needs）
 *   - 一个预设负责安装若干环境组件（provides）
 *   - 同一个组件可能被多个预设共用 —— 就是用户说的「公用键」
 *
 * 实测出来的真实共享关系（这是本文件存在的理由）：
 *
 *   funasr-py     系统 python 里的 funasr / modelscope / modelscope-hub / torch /
 *                 torchaudio / torchcodec / soundfile
 *                 → paraformer-zh、sensevoice 都要；**qwen3-asr 也要**
 *                   （它的说话人分离靠 FunASR 的 cam++，跑在同一个 python 里）
 *   funasr-models FunASR 权重目录（paraformer-zh / sensevoice / fsmn-vad / ct-punc / cam++）
 *                 → 同样三个预设都要（cam++ 是共享里最容易被忽略的那个）
 *   qwen-venv     独立 venv（qwen-asr 及其依赖）
 *                 → 只有 qwen3-asr 要
 *   qwen-models   Qwen3-ASR 权重
 *                 → 只有 qwen3-asr 要
 *
 * 所以「卸载 FunASR 环境」在 qwen3-asr 仍是候选时必须拒绝或明确警告 ——
 * 否则会把 qwen 的说话人分离一起打断，而且是静默降级（整段识别、无说话人标注），
 * 这种坏法最难查。
 */

/** 环境组件：可被单独安装/卸载的最小单位。 */
export type EnvKey =
  | 'funasr-py'
  | 'model-paraformer'
  | 'model-paraformer-online'
  | 'model-sensevoice'
  | 'model-vad'
  | 'model-punc'
  | 'model-spk'
  | 'qwen-venv'
  | 'qwen-models'

export interface EnvComponent {
  key: EnvKey
  label: string
  /** 卸载时给用户看的说明：删掉什么、占多大 */
  detail: string
  /** 它是否属于「公共基础设施」——多个预设共用，卸载需要额外确认 */
  shared: boolean
  /**
   * 在 FunASR 模型目录下按**子串**匹配的目录名片段。
   * 按子串而不是全名匹配：不同 funasr 版本的目录命名会变，
   * 写死全名会在升级后静默失配（显示未安装、实际占着磁盘）。
   */
  match?: string
}

/**
 * ⚠ 模型必须**按个**建组件，不能合成一个「FunASR 模型权重」。
 *
 * 我一开始就是这么合的，结果是：卸掉 sensevoice 之后，它那 896MB 的
 * SenseVoiceSmall 权重因为「paraformer 还要用 funasr-models」而永远清不掉。
 * Paraformer-large 和 SenseVoiceSmall 是两套独立权重，占的空间还都不小。
 */
export const ENV_COMPONENTS: Record<EnvKey, EnvComponent> = {
  'funasr-py': {
    key: 'funasr-py',
    label: 'FunASR 运行环境（Python 包）',
    detail: '系统 Python 中的 funasr / modelscope / modelscope-hub / torch / torchaudio / torchcodec / soundfile',
    shared: true,
  },
  'model-paraformer': {
    key: 'model-paraformer',
    label: 'Paraformer-large 权重',
    detail: '中文离线识别主模型（约 850MB）',
    shared: false,
    match: 'speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch',
  },
  'model-paraformer-online': {
    key: 'model-paraformer-online',
    label: 'Paraformer 流式权重',
    detail: '实时转写用的流式模型（约 850MB）',
    shared: true,
    match: 'vocab8404-online',
  },
  'model-sensevoice': {
    key: 'model-sensevoice',
    label: 'SenseVoiceSmall 权重',
    detail: '多语种快速识别模型（约 900MB），与参考项目 NextProto 同款',
    shared: false,
    match: 'SenseVoiceSmall',
  },
  'model-vad': {
    key: 'model-vad',
    label: 'VAD 断句权重',
    detail: 'fsmn-vad，负责切分语音段（约 4MB）',
    shared: true,
    match: 'speech_fsmn_vad',
  },
  'model-punc': {
    key: 'model-punc',
    label: '标点恢复权重',
    detail: 'ct-punc 中英标点模型（约 1.1GB，是最大的一块）',
    shared: true,
    match: 'punc_ct-transformer',
  },
  'model-spk': {
    key: 'model-spk',
    label: '说话人分离权重（cam++）',
    detail: 'cam++ 说话人聚类（约 28MB）——**Qwen3-ASR 也依赖它**，Qwen 自己没有说话人分离',
    shared: true,
    match: 'campplus',
  },
  'qwen-venv': {
    key: 'qwen-venv',
    label: 'Qwen3-ASR 独立环境（venv）',
    detail: '独立虚拟环境中的 qwen-asr 及其依赖（约 5.3GB）',
    shared: false,
  },
  'qwen-models': {
    key: 'qwen-models',
    label: 'Qwen3-ASR 模型权重',
    detail: 'Qwen3-ASR-1.7B 权重（约 4.5GB）',
    shared: false,
  },
}

/** 功能开关的键（对应 RuntimeConfig 里可被预设约束的那些）。 */
export type FeatureKey =
  | 'vad'
  | 'punc'
  | 'spk'
  | 'language'
  | 'realtime'
  | 'hotword'
  | 'timestamps'

export interface AsrPreset {
  id: string
  label: string
  /** 一句话说明它适合什么场景 */
  summary: string
  /** 该预设需要哪些环境组件（决定「识别环境」面板显示什么、体检什么） */
  needs: EnvKey[]
  /** 该预设负责安装哪些环境组件 */
  provides: EnvKey[]
  /** 该预设支持哪些功能开关；不在列表里的开关在界面上要隐藏或禁用并说明原因 */
  features: FeatureKey[]
  /** 该预设支持的语种（空数组 = 不限制） */
  languages: string[]
  /** 功能被禁用的原因（按 FeatureKey 给出），用于界面上如实说明 */
  limits?: Partial<Record<FeatureKey, string>>
  /** 是否为参考实现（NextProto / lomehong-record）使用的方案 */
  reference?: boolean
}

export const ASR_PRESETS: AsrPreset[] = [
  {
    id: 'paraformer-zh',
    label: 'FunASR Paraformer-large',
    summary: '中文高精度，纯中文场景最稳',
    needs: ['funasr-py', 'model-paraformer', 'model-paraformer-online', 'model-vad', 'model-punc', 'model-spk'],
    provides: ['model-paraformer'],
    features: ['vad', 'punc', 'spk', 'language', 'realtime', 'hotword', 'timestamps'],
    languages: ['zh'],
    limits: {
      language: 'Paraformer-large 只针对中文训练，识别其他语种请改用 SenseVoiceSmall 或 Qwen3-ASR。',
    },
  },
  {
    id: 'sensevoice',
    label: 'FunASR SenseVoiceSmall',
    summary: '多语种·快速·CPU 可跑 —— 与参考项目 NextProto 同款',
    needs: ['funasr-py', 'model-sensevoice', 'model-paraformer-online', 'model-vad', 'model-punc', 'model-spk'],
    provides: ['model-sensevoice'],
    features: ['vad', 'punc', 'spk', 'language', 'realtime', 'timestamps'],
    languages: ['auto', 'zh', 'yue', 'en', 'ja', 'ko'],
    limits: {
      hotword: 'SenseVoiceSmall 不支持热词表。',
    },
    reference: true,
  },
  {
    id: 'qwen3-asr',
    label: 'Qwen3-ASR',
    summary: '中英文最强；需要独立环境与约 3.4GB 权重',
    // cam++ 来自 funasr-models，跑在 funasr-py 上 —— 这就是公用键
    needs: ['funasr-py', 'model-vad', 'model-spk', 'qwen-venv', 'qwen-models'],
    provides: ['qwen-venv', 'qwen-models'],
    features: ['vad', 'spk', 'language', 'timestamps'],
    languages: ['auto', 'zh', 'en', 'yue', 'ja', 'ko'],
    limits: {
      realtime: 'Qwen3-ASR 的流式仅 vLLM 后端支持，而 vLLM 在 Windows 原生跑不通，故不支持实时转写。',
      punc: 'Qwen3-ASR 自带标点，无需外挂标点模型。',
      hotword: 'Qwen3-ASR 不支持热词表。',
    },
  },
]

export const presetById = (id: string): AsrPreset | undefined => ASR_PRESETS.find((p) => p.id === id)

/** 某个环境组件被哪些预设需要（用于判断卸载安全性）。 */
export function presetsNeeding(key: EnvKey, only?: string[]): AsrPreset[] {
  return ASR_PRESETS.filter((p) => (only ? only.includes(p.id) : true) && p.needs.includes(key))
}

/** 某个环境组件由哪些预设负责安装。 */
export function presetsProviding(key: EnvKey): AsrPreset[] {
  return ASR_PRESETS.filter((p) => p.provides.includes(key))
}

export interface UninstallPlan {
  key: EnvKey
  /** 是否可以安全卸载 */
  allowed: boolean
  /** 仍需要它的其他预设（allowed=false 时的原因） */
  stillNeededBy: AsrPreset[]
  /** 它是公共基础设施 */
  shared: boolean
  /** 给用户看的提示 */
  message: string
}

/**
 * 判断能否卸载某个环境组件。
 *
 * `keepPresetIds` = 用户明确要保留的预设（默认：除要卸载的那个之外的全部预设）。
 * 只要还有保留中的预设需要它，就不能删 —— 这正是「注意其他预设的公用键」。
 */
export function planUninstall(key: EnvKey, keepPresetIds?: string[]): UninstallPlan {
  const comp = ENV_COMPONENTS[key]
  const keep = keepPresetIds ?? ASR_PRESETS.map((p) => p.id)
  const others = presetsNeeding(key, keep)
  const allowed = others.length === 0
  return {
    key,
    allowed,
    stillNeededBy: others,
    shared: comp.shared,
    message: allowed
      ? comp.shared
        ? `将卸载「${comp.label}」。它是共享组件，但当前没有任何保留中的预设需要它。`
        : `将卸载「${comp.label}」。`
      : `不能卸载「${comp.label}」：${others.map((p) => p.label).join('、')} 仍在使用它。` +
        (key === 'funasr-py' || key === 'model-spk' || key === 'model-vad'
          ? '（Qwen3-ASR 的说话人分离依赖 FunASR 的 cam++，所以它也算使用者）'
          : ''),
  }
}

/** 该预设不需要的组件（卸载时会成为「孤儿」，可提示用户清理）。 */
export function orphanComponents(keepPresetIds: string[]): EnvKey[] {
  const needed = new Set<EnvKey>()
  for (const p of ASR_PRESETS) {
    if (keepPresetIds.includes(p.id)) for (const k of p.needs) needed.add(k)
  }
  return (Object.keys(ENV_COMPONENTS) as EnvKey[]).filter((k) => !needed.has(k))
}

// ───────────────────────── 预设级卸载（引用计数回收）─────────────────────────

export interface PresetUninstallPlan {
  presetId: string
  label: string
  /** 卸载该预设后，仍然被保留的预设集合 */
  enabledAfter: string[]
  /** 真正会被删除的组件（卸载后没有任何保留中的预设需要它） */
  remove: EnvKey[]
  /** 会被保留的组件，以及是谁还在用它 */
  keep: Array<{ key: EnvKey; stillNeededBy: string[] }>
  /** 一句话说明 */
  summary: string
}

/**
 * 计算「卸载某个预设」会连带删掉哪些组件。
 *
 * 引用计数语义（用户明确要求的）：
 *   组件 X 被 A、B 共用 → 卸 A 时 X 保留（B 还要）→ 再卸 B 时 X 才被删。
 *
 * 所以判据不是「当前激活的预设」，而是「用户还想要哪些预设」(`enabled`)。
 * 只回收该预设 **provides** 的组件 —— 它 needs 但不由它安装的（比如 Qwen 需要
 * FunASR 的 cam++）不该由它来删，那是别人的资产。
 */
export function planPresetUninstall(presetId: string, enabled: string[]): PresetUninstallPlan {
  const preset = presetById(presetId)
  if (preset === undefined) {
    return { presetId, label: presetId, enabledAfter: enabled, remove: [], keep: [], summary: `未知预设: ${presetId}` }
  }
  const enabledAfter = enabled.filter((id) => id !== presetId)
  const remove: EnvKey[] = []
  const keep: Array<{ key: EnvKey; stillNeededBy: string[] }> = []

  // **对所有组件求值**，而不只看 preset.provides。
  //
  // 为什么：共享基础设施（funasr-py / VAD / 标点 / cam++）不属于任何单个预设，
  // 只看 provides 的话它们永远不会被回收 —— 卸掉所有 FunASR 预设后，
  // 那 1.1GB 的标点模型还会赖在磁盘上。真正的引用计数是：
  // 「剩余启用预设都不需要的组件，就该回收」。
  // 只回收**与本次卸载相关**的组件（该预设 needs 的那些），而不是对所有组件求值。
  //
  // 对全体求值会「顺手」删掉与本预设无关的孤儿 —— 实测出现过
  // 「卸载 Qwen3 却把 SenseVoiceSmall 权重删了」，非常意外也可能误删。
  // 限定在 needs 范围内，你的场景依然成立：
  //   A、B 共用 X → 卸 A（X 在 A.needs 里）→ B 还要 → 保留
  //                → 再卸 B（X 在 B.needs 里）→ 没人要 → 删除
  for (const key of preset.needs) {
    const others = presetsNeeding(key, enabledAfter)
    if (others.length === 0) remove.push(key)
    else keep.push({ key, stillNeededBy: others.map((p) => p.id) })
  }

  const labelOf = (id: string): string => presetById(id)?.label ?? id
  const parts: string[] = []
  if (remove.length) parts.push(`将删除 ${remove.map((k) => ENV_COMPONENTS[k].label).join('、')}`)
  if (keep.length)
    parts.push(
      keep
        .map(
          (k) =>
            `保留 ${ENV_COMPONENTS[k.key].label}（${k.stillNeededBy.map(labelOf).join('、')} 仍在使用）`,
        )
        .join('；'),
    )
  return {
    presetId,
    label: preset.label,
    enabledAfter,
    remove,
    keep,
    summary: parts.length ? `${parts.join('；')}。` : '该预设没有独占的环境组件。',
  }
}

/** 用户还想要哪些预设。默认集合 = 当前激活的那个。 */
export function normalizeEnabledPresets(enabled: unknown, active: string): string[] {
  const list = Array.isArray(enabled) ? enabled.filter((x): x is string => typeof x === 'string') : []
  // **去重**：这套集合会被反复「累积」，不去重就会长成这样：
  //   [sensevoice, qwen3-asr, sensevoice, paraformer-zh, sensevoice, ...]
  // 集合语义必须唯一，否则引用计数看着对、实际全是噪声。
  const valid: string[] = []
  for (const id of list) {
    if (presetById(id) === undefined) continue
    if (!valid.includes(id)) valid.push(id)
  }
  // 激活的预设必须在集合里 —— 否则会出现「正在用却显示未启用」的矛盾状态
  if (presetById(active) && !valid.includes(active)) valid.push(active)
  return valid
}
