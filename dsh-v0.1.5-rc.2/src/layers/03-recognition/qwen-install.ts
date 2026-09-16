/**
 * L3 识别层 · Qwen3-ASR 环境安装
 *
 * 与 FunASR 的安装路径不同：FunASR 是「worker 自己 pip install 自己」，
 * 但 Qwen3 的 venv 必须在 qwen worker **能启动之前**就存在（否则没有解释器去跑它），
 * 所以 venv 创建与 pip 安装只能由宿主进程来做。
 *
 * 三步：
 *   ① `python -m venv <outDir>/qwen-venv`
 *   ② `<venv>/python -m pip install -U qwen-asr`
 *   ③ `<venv>/python qwen_fetch_model.py --dest <outDir>/qwen/<modelName>`
 *
 * 为什么必须是**独立 venv**：`qwen-asr` 与 `funasr` 在同环境会打架。
 * 官方 issue #3042：只升 funasr 会报 `'Qwen3ASRConfig' object has no attribute 'thinker_config'`，
 * 必须 `pip install -U funasr qwen-asr transformers` 三件套一起动。
 * 分成两个 venv 从根上避开这个耦合，也避开它的 transformers 版本冲突。
 */
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { scriptPath } from '../../py-worker.js'

export interface QwenInstallOptions {
  /** 用来创建 venv 的基础 python（FunASR 那个即可，只是个普通解释器） */
  basePython: string
  /** 插件数据目录 */
  outDir: string
  /** 模型根目录（venv 之外的权重放这儿） */
  modelDir: string
  /** 权重目录名，如 Qwen3-ASR-1.7B */
  modelName: string
  log: (...args: unknown[]) => void
  onProgress?: (stage: string, message: string) => void
  /** 国内 pip 镜像；留空则用默认源 */
  pipIndex?: string
  /** 代理；留空=剔除继承来的代理（国内源直连） */
  proxyUrl?: string
}

export interface QwenInstallResult {
  ok: boolean
  venvPython: string
  modelPath: string
  /** 各步骤的人话记录，面板可直接显示 */
  steps: { stage: string; message: string; ok: boolean }[]
  error?: string
}

export function qwenVenvDir(outDir: string): string {
  return join(outDir, 'qwen-venv')
}

export function qwenVenvPythonPath(outDir: string): string {
  const win = process.platform === 'win32'
  return join(qwenVenvDir(outDir), win ? 'Scripts' : 'bin', win ? 'python.exe' : 'python')
}

function run(
  bin: string,
  args: string[],
  timeoutMs: number,
  env: Record<string, string> | undefined,
  proxyUrl: string | undefined,
): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(
      bin,
      args,
      {
        timeout: timeoutMs,
        maxBuffer: 32 * 1024 * 1024,
        env: childEnv(env, proxyUrl),
        windowsHide: true,
      },
      (err, stdout, stderr) => {
        const out = `${stdout ?? ''}${stderr ?? ''}`.trim()
        const code = err ? ((err as NodeJS.ErrnoException & { code?: number }).code ?? 1) : 0
        resolve({ code: typeof code === 'number' ? code : 1, out })
      },
    )
  })
}

/** 需要从子进程环境里剔除的代理变量（各种大小写形态）。 */
const PROXY_KEYS = [
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
  'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
]

/**
 * 构造子进程环境：**默认剔除继承来的代理**。
 *
 * 两个理由：
 *  ① 我们用的都是国内源（清华 pypi / hf-mirror.com），直连更快，走代理反而绕远；
 *  ② 这台机器的 HTTP_PROXY 指向 127.0.0.1:10809 —— **那是个已经死掉的端口**
 *     （活的 v2ray 在 10808）。原样继承会让 pip / modelscope 直接连接失败，
 *     报 `ProxyError: Cannot connect to proxy` 或 WinError 10061。
 *
 * 需要走代理时传 `proxyUrl`（如 http://127.0.0.1:10808）显式指定。
 */
export function childEnv(
  extra?: Record<string, string>,
  proxyUrl?: string,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const k of PROXY_KEYS) delete env[k]
  if (proxyUrl) {
    env.HTTP_PROXY = proxyUrl
    env.HTTPS_PROXY = proxyUrl
  }
  return { ...env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', ...(extra ?? {}) }
}

/** 环境是否可用（venv 存在且 qwen-asr 能导入）。 */
/**
 * Qwen3-ASR 运行时**真正需要**能 import 的模块清单。
 *
 * 为什么不能只试 `import qwen_asr, torch`：`qwen-asr` 的依赖树里有几个
 * **未声明的传递依赖**，`pip check` 认为一切正常、`import qwen_asr` 也过得去，
 * 但要用的那个代码路径一跑就炸。实测踩过两次：
 *   - `qwen_omni_utils` → 缺 `audioread`
 *   - 补上后 → 又缺 `torchvision`
 * 这类缺口必须在**体检**时就报出来，而不是等用户识别到一半才失败。
 */
export const QWEN_REQUIRED_MODULES = [
  'torch',
  'torchaudio',
  'torchvision',
  'transformers',
  'qwen_asr',
  'qwen_omni_utils',
  'soundfile',
  'librosa',
  'audioread',
] as const

/** 逐模块 import 体检，返回失败的模块与首行错误。 */
export function qwenImportCheck(outDir: string): { ok: boolean; failed: Array<{ mod: string; error: string }> } {
  const py = qwenVenvPythonPath(outDir)
  if (!existsSync(py)) return { ok: false, failed: [{ mod: '(venv)', error: 'venv 不存在' }] }
  const code =
    'import importlib,json\n' +
    `mods=${JSON.stringify(QWEN_REQUIRED_MODULES)}\n` +
    'bad=[]\n' +
    'for m in mods:\n' +
    '    try: importlib.import_module(m)\n' +
    '    except Exception as e: bad.append({"mod":m,"error":f"{type(e).__name__}: {e}"[:200]})\n' +
    'print(json.dumps(bad))\n'
  try {
    const out = execFileSync(py, ['-c', code], { encoding: 'utf8', timeout: 180_000 })
    const failed = JSON.parse(out.trim().split('\n').pop() || '[]') as Array<{ mod: string; error: string }>
    return { ok: failed.length === 0, failed }
  } catch (e) {
    return { ok: false, failed: [{ mod: '(探测失败)', error: e instanceof Error ? e.message : String(e) }] }
  }
}

export function qwenEnvReady(outDir: string): boolean {
  const py = qwenVenvPythonPath(outDir)
  if (!existsSync(py)) return false
  return qwenImportCheck(outDir).ok
}

/**
 * 安装/修复 Qwen3-ASR 环境。幂等：已就绪的步骤会跳过。
 * 任何一步失败都原样返回错误与已完成的步骤，不吞异常——面板要如实显示卡在哪。
 */
export async function installQwen(opts: QwenInstallOptions): Promise<QwenInstallResult> {
  const venvPython = qwenVenvPythonPath(opts.outDir)
  const modelPath = join(opts.modelDir, opts.modelName)
  const steps: QwenInstallResult['steps'] = []
  const note = (stage: string, message: string, ok = true) => {
    steps.push({ stage, message, ok })
    opts.onProgress?.(stage, message)
    opts.log(`[Qwen 安装] ${message}`)
  }

  // ── ① venv ──
  if (existsSync(venvPython)) {
    note('venv', `venv 已存在，跳过创建`)
  } else {
    mkdirSync(opts.outDir, { recursive: true })
    note('venv', `创建虚拟环境 ${qwenVenvDir(opts.outDir)}`)
    const r = await run(opts.basePython, ['-m', 'venv', qwenVenvDir(opts.outDir)], 300_000, undefined, opts.proxyUrl)
    if (r.code !== 0 || !existsSync(venvPython)) {
      const error = `创建 venv 失败（exit ${r.code}）：${r.out.slice(-600)}`
      note('venv', error, false)
      return { ok: false, venvPython, modelPath, steps, error }
    }
    note('venv', 'venv 创建完成')
  }

  // ── ② qwen-asr ──
  const pipBase = ['-m', 'pip', 'install', '--disable-pip-version-check']
  const index = opts.pipIndex ? ['-i', opts.pipIndex] : []
  if (qwenEnvReady(opts.outDir)) {
    note('pip', 'qwen-asr 已可导入，跳过安装')
  } else {
    note('pip', '安装 qwen-asr（会自动带上 torch / transformers / torchaudio）…')
    // 先升 pip，老 pip 解析依赖会失败
    await run(venvPython, [...pipBase, '-U', 'pip'], 600_000, undefined, opts.proxyUrl)
    const r = await run(venvPython, [...pipBase, '-U', ...index, 'qwen-asr'], 3_600_000, undefined, opts.proxyUrl)
    if (r.code !== 0) {
      const error = `安装 qwen-asr 失败（exit ${r.code}）：${r.out.slice(-800)}`
      note('pip', error, false)
      return { ok: false, venvPython, modelPath, steps, error }
    }
    // torchcodec：新版 torchaudio 的 load() 走 TorchCodec，而它是独立包、不随 torchaudio 装。
    // 缺了它 `torchaudio.load()` 会抛
    // `TorchCodec is required for load_with_torchcodec`，把「按说话人切音频」那步直接卡死。
    // soundfile 作为兜底解码器一并装上。
    note('pip', '安装音频解码依赖 torchcodec / soundfile…')
    const r2 = await run(venvPython, [...pipBase, '-U', ...index, 'torchcodec', 'soundfile', 'audioread'], 1_800_000, undefined, opts.proxyUrl)
    if (r2.code !== 0) {
      // 不致命：worker 里有 soundfile 兜底，但没有它 ogg/opus 可能解不开
      note('pip', `torchcodec / soundfile 安装失败（若识别时报解码错误再手动补装）：${r2.out.slice(-300)}`, false)
    }
    if (!qwenEnvReady(opts.outDir)) {
      const error = 'qwen-asr 安装后仍无法 import，请检查上面的 pip 输出'
      note('pip', error, false)
      return { ok: false, venvPython, modelPath, steps, error }
    }
    note('pip', 'qwen-asr 安装完成')
  }

  // ── ③ CUDA torch ──
  //
  // PyPI（含清华镜像）的 **Windows torch 是 CPU 版**：实测装出来是 `2.14.0+cpu`、
  // `cuda.is_available() == False`。CUDA 版只能从 PyTorch 官方 wheel 源装，
  // 而 download.pytorch.org 是境外站、国内直连不通 —— 必须走代理。
  // （清华的 /pytorch-wheels/ 镜像实测 404，不可用。）
  const cudaProbe = await run(
    venvPython,
    ['-c', 'import torch,sys; sys.exit(0 if torch.cuda.is_available() else 1)'],
    120_000,
    undefined,
    opts.proxyUrl,
  )
  if (cudaProbe.code === 0) {
    note('torch', 'CUDA 可用，跳过 torch 重装')
  } else {
    const torchProxy = opts.proxyUrl || 'http://127.0.0.1:10808'
    note('torch', `当前 torch 无 CUDA，改从官方源装 cu128 版（经 ${torchProxy}）…`)
    const r = await run(
      venvPython,
      // 注意 pipBase 里已经含 'install'，这里不能再拼一个，否则 pip 会去找
      // 一个名叫 "install" 的包（实测报 No matching distribution found for install）
      [...pipBase, '--force-reinstall', '--index-url', 'https://download.pytorch.org/whl/cu128', 'torch', 'torchaudio', 'torchvision'],
      3_600_000,
      undefined,
      torchProxy,
    )
    if (r.code !== 0) {
      // 装不上不致命：CPU 也能跑，只是慢。如实告知，不让整条安装失败
      note('torch', `CUDA torch 安装失败，将回退 CPU 推理（较慢）：${r.out.slice(-400)}`, false)
    } else {
      const again = await run(
        venvPython,
        ['-c', 'import torch,sys; print(torch.__version__); sys.exit(0 if torch.cuda.is_available() else 1)'],
        120_000,
        undefined,
        opts.proxyUrl,
      )
      const ver = again.out.split(/\r?\n/).filter(Boolean).pop() ?? ''
      if (again.code === 0) note('torch', `CUDA 就绪：${ver}`)
      else note('torch', `装完仍无 CUDA，将用 CPU 推理：${ver}`, false)
    }
  }

  // ── ④ 模型权重 ──
  note('model', `下载 ${opts.modelName} 到 ${modelPath}（优先 modelscope 国内直连，约 3.4GB）`)
  const r = await run(
    venvPython,
    [scriptPath('qwen_fetch_model.py'), '--repo', `Qwen/${opts.modelName}`, '--dest', modelPath],
    2 * 60 * 60 * 1000,
    { HF_ENDPOINT: 'https://hf-mirror.com' },
    opts.proxyUrl,
  )
  // 逐行解析脚本的 JSON 事件，把有意义的转发给面板
  let lastError = ''
  for (const line of r.out.split(/\r?\n/)) {
    const t = line.trim()
    if (!t.startsWith('{')) continue
    try {
      const ev = JSON.parse(t) as Record<string, unknown>
      if (typeof ev.message === 'string') note(String(ev.stage ?? 'model'), ev.message)
      if (ev.ok === false && typeof ev.error === 'string') lastError = ev.error
    } catch {
      /* 非 JSON 行忽略 */
    }
  }
  const hasModel = existsSync(join(modelPath, 'config.json'))
  if (r.code !== 0 || !hasModel) {
    const error = lastError || `模型下载失败（exit ${r.code}）：${r.out.slice(-600)}`
    note('model', error, false)
    return { ok: false, venvPython, modelPath, steps, error }
  }
  note('model', '模型就绪')

  return { ok: true, venvPython, modelPath, steps }
}
