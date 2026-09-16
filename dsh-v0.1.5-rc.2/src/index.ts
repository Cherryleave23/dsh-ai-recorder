/**
 * dsh-ai-recorder — AI 录音卡(CB08/QS668)后端。
 *
 * 五层架构（与流程图一一对应）：
 *
 *   L1 采集层   layers/01-capture     BLE 直连收端（Python/bleak 守护进程），离线下载优先 .opus
 *   L2 预处理层 layers/02-preprocess  裸 40B Opus 包 → Ogg 容器 → 解码为 16k/mono/16bit 统一格式
 *   L3 识别层   layers/03-recognition FunASR：离线(VAD+ASR+标点+说话人) / 实时(增量 chunk 逐字)
 *   L4 输出层   layers/04-output      以 session_id 为主键落三件套：音频 + Markdown + 实时文本流
 *   L5 对应关系 layers/05-session-link session_id ↔ 三件套的唯一解析入口
 *
 * 路由总表：
 *   GET  /api/recorder/health                     健康检查
 *   GET  /api/recorder/config   POST              运行时配置
 *   POST /api/recorder/session                    新建/复用会话
 *   GET  /api/recorder/sessions                   会话列表
 *   GET  /api/recorder/session/<id>               会话详情 + 三件套对应关系
 *   GET  /api/recorder/session/<id>/events        SSE 实时文本流
 *   GET  /api/recorder/session/<id>/audio         取音频文件
 *   GET  /api/recorder/session/<id>/markdown      取 Markdown 文档
 *   POST /api/recorder/audio                      上传音频 → 离线识别 → 三件套
 *   POST /api/recorder/batch                      批量上传识别
 *   POST /api/qs668/transcribe                    厂商测试页兼容
 *   GET  /api/recorder/asr/status                 FunASR 就绪检测
 *   POST /api/recorder/asr/install                自动安装依赖与模型
 *   GET  /api/recorder/ble/status                 BLE 收端状态
 *   POST /api/recorder/ble/setup|scan|connect|disconnect|battery|timesync
 *   GET  /api/recorder/ble/filelist
 *   POST /api/recorder/ble/download               下载单个录音 → 三件套
 *   POST /api/recorder/ble/realtime               实时转写 start|stop|pause|resume（逐字输出）
 *   POST /api/recorder/ble/sync                   离线批量同步
 *   GET  /api/recorder/ble/sync/status
 */
import type { Context } from '@deepseek-ai/cordis'
import { appendFileSync, createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync, type Stats } from 'node:fs'
import { execFile, execFileSync } from 'node:child_process'
import {
  type EnvKey,
  ASR_PRESETS,
  ENV_COMPONENTS,
  normalizeEnabledPresets,
  planPresetUninstall,
  presetById,
} from './presets.js'
import {
  FUNASR_PY_PACKAGES,
  envStatus,
  invalidateSizeCache,
  pkgInstalledByMetadata,
  uninstallEnv,
  uninstallPreset,
} from './env-manage.js'
import { spawnEnv } from './py-worker.js'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Config } from './config.js'
import { PyWorker, scriptPath } from './py-worker.js'
import { installSelfCleanup } from './host-self-cleanup.js'
import { BleCentral, deviceFileTime, type BleDevice, type BleEvent } from './layers/01-capture/ble.js'
import { KnownDeviceStore, matchKnown, type KnownDevice } from './layers/01-capture/known-devices.js'
import { containAudio, expectedMsForRawOpus, type AudioHint, type ArchiveAudio } from './layers/02-preprocess/normalize.js'
import { applySkip, decodeToUnified, disposeTmp, makeTmpDir, probeOpusPackets } from './layers/02-preprocess/decode.js'
import { FunasrEngine, type FunasrOptions, type RecognizedSegment } from './layers/03-recognition/funasr.js'
import { QwenEngine } from './layers/03-recognition/qwen.js'
import { installQwen, qwenEnvReady, qwenImportCheck, qwenVenvPythonPath } from './layers/03-recognition/qwen-install.js'
import { allFlows, clearFlows, flowsFor, markFlowed } from './flow-log.js'
import { listAllNotes, listNotes, readNote, saveNote } from './notes-store.js'
import {
  allTemplates,
  normalizeTemplate,
  templateIdFrom,
  type PromptTemplate,
} from './post-process.js'
import { installFunasr, probeFunasr, readReadiness, type FunasrReadiness } from './layers/03-recognition/install.js'
import { SessionStore, isValidSessionId, type SessionRecord } from './layers/04-output/session-store.js'
import { fmtDuration, renderTranscriptMarkdown } from './layers/04-output/markdown.js'
import { sanitizeFileName, fallbackTitle } from './layers/04-output/title.js'
import { MARKDOWN_FILE, completenessOf, resolveArtifacts } from './layers/05-session-link/manifest.js'

export const name = 'dsh-ai-recorder'
/** 只消费官方 webServer：AGENT 投递层已砍掉，不再需要 llm/agents/sessions。 */
export const inject = ['webServer']
export { Config }

interface WebServerLike {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

type AppContext = Context & { webServer: WebServerLike }

const VERSION = '0.1.2-alpha.5'
const MAX_BODY = 64 * 1024 * 1024
/** 设备推流码率：40B / 20ms = 2000 B/s（用于把攒段窗口换算成字节阈值） */
const STREAM_BYTES_PER_SEC = 2000

interface RuntimeConfig {
  asrModel: 'paraformer-zh' | 'sensevoice' | 'qwen3-asr'
  /** 用户还想要哪些预设 —— 卸载时按引用计数回收共用组件的依据 */
  enabledPresets: string[]
  postProcess: {
    enabled: boolean
    templateId: string
    /** 转向的对话 id；空字符串 = 每次都新建对话 */
    conversationId: string
    mode: 'auto' | 'confirm'
  }
  asrDevice: 'auto' | 'cpu' | 'cuda'
  asrVad: boolean
  asrPunc: boolean
  asrSpk: boolean
  language: 'auto' | 'zh' | 'en' | 'yue' | 'ja' | 'ko'
  funasrPythonPath: string
  funasrModelDir: string
  qwenModelDir: string
  qwenModelName: string
  qwenPythonPath: string
  proxyUrl: string
  streamChunkMs: number
  opusPreferred: boolean
  bleAutoSync: boolean
  bleSyncDeleteAfter: boolean
  markdownEnabled: boolean
  keepAudio: boolean
  autoTitle: boolean
  titleMaxChars: number
}

export function apply(ctx: AppContext, config: Config): void {
  const outDir = config.outDir || join(homedir(), '.dsh', 'recorder-backend')
  mkdirSync(outDir, { recursive: true })

  const pluginLogFile = join(outDir, 'plugin.log')
  const log = (...args: unknown[]): void => {
    const line = `[${new Date().toISOString()}] ${args.map(String).join(' ')}`
    ctx.logger?.info?.('[dsh-ai-recorder]', ...args)
    try {
      appendFileSync(pluginLogFile, line + '\n', 'utf8')
    } catch {
      /* 日志失败不阻断 */
    }
  }

  // ═══════════════════ 运行时配置（可热改，持久化） ═══════════════════
  const runtimeFile = join(outDir, 'runtime-config.json')
  // 用户自定义提示词模板（内置的在代码里，这里只存用户新增/复制的）
  const templatesFile = join(outDir, 'prompt-templates.json')
  let userTemplates: PromptTemplate[] = []
  try {
    const raw = JSON.parse(readFileSync(templatesFile, 'utf8'))
    if (Array.isArray(raw)) userTemplates = raw.map(normalizeTemplate).filter((x): x is PromptTemplate => x !== null)
  } catch {
    /* 首次运行没有该文件 */
  }
  function saveTemplates(): void {
    try {
      writeFileSync(templatesFile, JSON.stringify(userTemplates, null, 2), 'utf8')
    } catch (e) {
      log('保存提示词模板失败:', e instanceof Error ? e.message : String(e))
    }
  }
  const defaults: RuntimeConfig = {
    asrModel: config.asrModel,
    enabledPresets: config.enabledPresets,
    postProcess: config.postProcess,
    asrDevice: config.asrDevice,
    asrVad: config.asrVad,
    asrPunc: config.asrPunc,
    asrSpk: config.asrSpk,
    language: config.language,
    funasrPythonPath: config.funasrPythonPath,
    funasrModelDir: config.funasrModelDir || join(outDir, 'funasr'),
    qwenModelDir: config.qwenModelDir || join(outDir, 'qwen'),
    qwenModelName: config.qwenModelName,
    qwenPythonPath: config.qwenPythonPath,
    proxyUrl: config.proxyUrl,
    streamChunkMs: config.streamChunkMs,
    opusPreferred: config.opusPreferred,
    bleAutoSync: config.bleAutoSync,
    bleSyncDeleteAfter: config.bleSyncDeleteAfter,
    markdownEnabled: config.markdownEnabled,
    keepAudio: config.keepAudio,
    autoTitle: config.autoTitle,
    titleMaxChars: config.titleMaxChars,
  }
  let runtime: RuntimeConfig = defaults
  try {
    runtime = { ...defaults, ...(JSON.parse(readFileSync(runtimeFile, 'utf8')) as Partial<RuntimeConfig>) }
  } catch {
    /* 首次运行无保存配置 */
  }
  const saveRuntime = (): void => {
    try {
      writeFileSync(runtimeFile, JSON.stringify(runtime, null, 2), 'utf8')
    } catch (e) {
      log('运行时配置写入失败:', String(e))
    }
  }

  // ═══════════════════ Python 解释器探测 ═══════════════════
  const pythonCandidates = (explicit: string): string[] => {
    const list = explicit && explicit !== 'python' ? [explicit] : []
    list.push(process.env.DSH_RECORDER_PYTHON ?? '', 'python', 'python3', 'py')
    return [...new Set(list.filter(Boolean))]
  }
  const resolvePython = (explicit: string): string | null =>
    pythonCandidates(explicit).find((p) => {
      try {
        execFileSync(p, ['--version'], { stdio: 'ignore', timeout: 8000 })
        return true
      } catch {
        return false
      }
    }) ?? null

  const blePython = resolvePython(config.pythonPath)
  const funasrPython = resolvePython(runtime.funasrPythonPath || config.pythonPath) ?? blePython

  // ═══════════════════ 层实例 ═══════════════════
  const sessions = new SessionStore(outDir)
  // 连接过的录音卡缓存：扫描默认是为了「把常用的卡接回来」，不是每次都让人从列表里挑
  const knownDevices = new KnownDeviceStore(join(outDir, 'ble-devices.json'))

  // L3 的 Python 侧运行时（同时提供 L2 的解码能力）
  const funasrWorker = new PyWorker({
    python: funasrPython ?? 'python',
    script: scriptPath('funasr_worker.py'),
    args: ['--model-dir', runtime.funasrModelDir],
    proxyUrl: runtime.proxyUrl || undefined,
    readyTimeoutMs: 180_000,
    commandTimeoutMs: 30 * 60 * 1000,
    log,
    onEvent: (ev) => {
      if (ev.event === 'install-progress') {
        log('[安装]', String(ev.message ?? ''))
      }
    },
  })
  const engine = new FunasrEngine(funasrWorker, funasrOptions, log)

  // L3 的 Qwen3-ASR 侧：独立 venv（qwen-asr 与 funasr 在同环境会打架）。
  // 它只负责「按说话人时段逐段识别」，说话人时段由上面的 FunASR cam++ 提供。
  const qwenPython = resolvePython(runtime.qwenPythonPath || config.pythonPath)
  const qwenDir = runtime.qwenModelDir || join(outDir, 'qwen')
  const qwenWorker = new PyWorker({
    python: qwenVenvPython() ?? 'python',
    script: scriptPath('qwen_worker.py'),
    args: ['-m', join(qwenDir, config.qwenModelName)],
    proxyUrl: runtime.proxyUrl || undefined,
    // 1.7B 首次加载 + 权重量化准备，给足时间
    readyTimeoutMs: 600_000,
    commandTimeoutMs: 30 * 60 * 1000,
    log,
  })
  const qwenEngine = new QwenEngine({
    diarizer: engine,
    worker: qwenWorker,
    getOptions: () => ({ language: runtime.language, spk: runtime.asrSpk }),
    log,
  })

  /**
   * qwen venv 的 python（只做「文件在不在」的快检查）。
   *
   * 不在这里 `import qwen_asr` 验证——那会真的把 torch 拉起来，几百毫秒到数秒，
   * 而这条路径每次识别都会走。导入坏了就让 worker 启动时如实报错。
   */
  function qwenVenvPython(): string | null {
    const p = qwenVenvPythonPath(outDir)
    return existsSync(p) ? p : null
  }

  /** 最近一次 Qwen 安装结果（面板显示用） */
  let cachedQwenStatus: { ok: boolean; at: string; modelPath?: string; error?: string } | null = null
  /** 逐模块 import 体检结果的缓存（体检要起 Python + import torch ≈ 6 秒，绝不能每次查状态都做） */
  /** 体检预热是否正在进行（防止并发重复起 Python 进程） */
  let qwenCheckPending = false
  let qwenCheckCache: { at: number; value: { ok: boolean; failed: Array<{ mod: string; error: string }> } } | null =
    null

  /**
   * Qwen 环境是否就绪 —— **只做文件检查，绝不拉起 Python**。
   *
   * 早先这里调 `qwenEnvReady()`，它会 `execFileSync(python -c "import qwen_asr, torch")`
   * 起一个真进程去 import torch —— 实测数秒，而 `/asr/status` 是**每次切页面都会调的**，
   * 于是"切走再切回来就卡半天"。判定就绪本来只需要看 venv 与权重在不在。
   * 真要验证依赖是否能 import，走显式 `?probe=1`。
   */
  let qwenDeepCache: { at: number; ok: boolean } | null = null
  function qwenReadyCached(deep = false): boolean {
    const venvOk = existsSync(qwenVenvPythonPath(outDir))
    const modelOk = existsSync(join(qwenDir, config.qwenModelName, 'config.json'))
    if (!venvOk || !modelOk) return false
    if (!deep) return true
    const now = Date.now()
    if (qwenDeepCache && now - qwenDeepCache.at < 60_000) return qwenDeepCache.ok
    const ok = qwenEnvReady(outDir)
    qwenDeepCache = { at: now, ok }
    return ok
  }

  /**
   * L3 分派：qwen3-asr 走 Qwen3（离线），其余走 FunASR。
   *
   * 实时流永远走 FunASR——Qwen3-ASR 的流式仅 vLLM 后端支持，
   * 而 vLLM 在 Windows 原生跑不通（要 WSL2）。
   */
  const recognizeEngine = {
    async recognizeFile(wavPath: string) {
      if (runtime.asrModel === 'qwen3-asr') {
        if (!qwenVenvPython()) {
          throw new Error('Qwen3-ASR 环境未就绪：先在面板执行「安装 / 修复环境」创建 qwen venv 并下载模型')
        }
        return qwenEngine.recognizeFile(wavPath)
      }
      return engine.recognizeFile(wavPath)
    },
  }

  function funasrOptions(): FunasrOptions {
    return {
      // qwen3-asr 模式下 FunASR 只被当作「说话人分离前端」，它的 ASR 文本会被丢弃，
      // 所以这里退回到已下载的 paraformer-zh，避免为了分离再去拉一套模型
      model: runtime.asrModel === 'sensevoice' ? 'sensevoice' : 'paraformer-zh',
      device: runtime.asrDevice,
      language: runtime.language,
      vad: runtime.asrVad,
      punc: runtime.asrPunc,
      spk: runtime.asrSpk,
      modelDir: runtime.funasrModelDir,
      streamChunkMs: runtime.streamChunkMs,
      encoderLookBack: config.streamEncoderLookBack,
      decoderLookBack: config.streamDecoderLookBack,
    }
  }

  // L1 的 Python 侧运行时
  const ble = new BleCentral(log, (ev) => onBleEvent(ev))

  // 卸载自检
  const disposeSelfCleanup = installSelfCleanup(ctx, outDir, async () => {
    ble.dispose()
    await funasrWorker.dispose()
  })

  // ═══════════════════ HTTP 小工具 ═══════════════════
  function sendJson(res: ServerResponse, code: number, obj: unknown): void {
    res.writeHead(code, {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type, x-recorder-token',
    })
    res.end(JSON.stringify(obj))
  }

  /**
   * 以「支持 Range」的方式回文件。
   *
   * 为什么必须支持 Range：浏览器 `<audio>` 拖进度条时会发
   * `Range: bytes=N-`，服务端必须回 206 + `Content-Range` 才能定位；
   * 只回整文件 200 的话进度条拖不动（Chrome 会退化成只能从头播）。
   * 另外这里用流式读取而不是 readFileSync：录音可以很长，整文件进内存
   * 既浪费又会在并发时爆内存。
   */
  function serveFile(res: ServerResponse, req: IncomingMessage, file: string, contentType: string): void {
    let st: Stats
    try {
      st = statSync(file)
    } catch {
      return sendJson(res, 404, { ok: false, error: '文件不存在: ' + file })
    }
    const total = st.size
    const base: Record<string, string> = {
      'content-type': contentType,
      'accept-ranges': 'bytes',
      'cache-control': 'no-cache',
      'access-control-allow-origin': '*',
      'access-control-expose-headers': 'content-range, accept-ranges, content-length',
    }

    const raw = req.headers.range
    const range = typeof raw === 'string' ? /^bytes=(\d*)-(\d*)$/.exec(raw.trim()) : null

    if (!range) {
      res.writeHead(200, { ...base, 'content-length': String(total) })
      if (req.method === 'HEAD') {
        res.end()
        return
      }
      createReadStream(file).pipe(res)
      return
    }

    const hasStart = range[1] !== ''
    const hasEnd = range[2] !== ''
    let start: number
    let end: number
    if (hasStart) {
      start = Number(range[1])
      end = hasEnd ? Math.min(Number(range[2]), total - 1) : total - 1
    } else if (hasEnd) {
      // `bytes=-N`：最后 N 字节
      start = Math.max(0, total - Number(range[2]))
      end = total - 1
    } else {
      start = 0
      end = total - 1
    }

    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) {
      res.writeHead(416, { ...base, 'content-range': `bytes */${total}` })
      res.end()
      return
    }

    res.writeHead(206, {
      ...base,
      'content-range': `bytes ${start}-${end}/${total}`,
      'content-length': String(end - start + 1),
    })
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    createReadStream(file, { start, end }).pipe(res)
  }

  function contentTypeOf(kind: 'audio' | 'markdown', file: string): string {
    if (kind === 'markdown') return 'text/markdown; charset=utf-8'
    const lower = file.toLowerCase()
    if (lower.endsWith('.wav')) return 'audio/wav'
    if (lower.endsWith('.opus')) return 'audio/opus'
    if (lower.endsWith('.mp3')) return 'audio/mpeg'
    if (lower.endsWith('.m4a')) return 'audio/mp4'
    return 'audio/ogg'
  }

  function readBody(req: IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      let size = 0
      req.on('data', (c: Buffer) => {
        size += c.length
        if (size > MAX_BODY) {
          req.destroy()
          reject(new Error('请求体过大'))
          return
        }
        chunks.push(c)
      })
      req.on('end', () => resolve(Buffer.concat(chunks)))
      req.on('error', reject)
    })
  }

  const authOk = (req: IncomingMessage): boolean => !config.token || req.headers['x-recorder-token'] === config.token
  const b64ToBytes = (b64: unknown): Uint8Array => new Uint8Array(Buffer.from(String(b64 ?? '').trim(), 'base64'))
  const streamPathFor = (id: string): string => `/api/recorder/session/${id}/events`

  // ═══════════════════ 核心：一次识别的完整管线 ═══════════════════

  interface RecognizeInput {
    bytes: Uint8Array
    hint: AudioHint
    source: SessionRecord['source']
    sessionId?: string
    deviceFile?: string
    /** 录制时刻（离线同步时从设备文件名解析）；不给就是「现在」录的 */
    recordedAt?: string
    device?: SessionRecord['device']
    language?: string
    /** 是否复用已有会话（实时流终稿时用） */
    reuse?: boolean
  }

  interface RecognizeOutput {
    sessionId: string
    text: string
    segments: RecognizedSegment[]
    durationMs: number
    markdownPath: string | null
    audioPath: string | null
    model: string
    device: string
    speakerApplied: boolean
  }

  /**
   * L2 → L3 → L4 全流程：音频字节进，三件套出。
   * 这是离线路径（上传 / 设备下载 / 批量同步）的唯一入口。
   */
  async function recognize(input: RecognizeInput): Promise<RecognizeOutput> {
    const tmp = await makeTmpDir('pipe')
    // 会话在管线中段才建立；失败时要把错误写回会话，否则列表里会留下一条
    // 没有产物也没有原因的「幽灵会话」。
    let openedSid: string | null = null
    try {
      // ── L1/L2：容器归一 ──
      let archive: ArchiveAudio = containAudio(input.bytes, input.hint, true)

      // 下载件自检：设备裸 Opus（无论来自离线下载还是外部上传）前若干字节是非确定性数据，
      // 整包解码会从第一个包就失败。扫描出最小可解码偏移后裁掉重包。
      // （真机实测：5/5 样本跳过后精确解出应有长度；良性输入走 skip=0 快路径，代价一次探测解码）
      if (archive.origin === 'raw-opus') {
        const expected = expectedMsForRawOpus(input.bytes.length)
        if (expected > 500) {
          try {
            const probe = await probeOpusPackets(funasrWorker, input.bytes, expected, tmp, {
              maxSkip: config.captureSkipScanMax,
            })
            if (probe.skipBytes > 0) {
              log(`下载件前导污染 ${probe.skipBytes}B，已裁掉（解出 ${Math.round(probe.decodedMs)}ms / 应有 ${expected}ms）`)
              archive = applySkip(archive, input.bytes, probe.skipBytes)
            } else if (!probe.ok) {
              log(`下载件自检异常：解出 ${Math.round(probe.decodedMs)}ms / 应有 ${expected}ms（ratio ${probe.ratio.toFixed(2)}）`)
            }
          } catch (e) {
            log('下载件自检失败（继续按原样处理）:', String(e))
          }
        }
      }

      // ── L4：先开会话（拿 session_id），音频归档落进会话目录 ──
      const rec = sessions.open({
        id: input.reuse ? input.sessionId : input.sessionId,
        source: input.source,
        language: input.language ?? runtime.language,
        device: input.device,
        deviceFile: input.deviceFile,
        recordedAt: input.recordedAt,
      })
      const sid = rec.id
      openedSid = sid
      let audioPath: string | null = null
      if (runtime.keepAudio) {
        const ref = sessions.putArtifact(sid, 'audio', `audio.${archive.ext}`, archive.bytes)
        audioPath = sessions.pathOf(sid, ref.file)
      }

      // ── L2：解码为统一格式（16k/mono/16bit PCM）──
      const unified = await decodeToUnified(
        funasrWorker,
        archive,
        { sampleRate: config.targetSampleRate, channels: config.targetChannels, bits: config.targetBits },
        tmp,
        'archive',
      )

      // ── L3：离线识别（VAD + ASR + 标点 + 说话人）──
      const result = await recognizeEngine.recognizeFile(unified.path)

      // ── L4：写分段 + 定标题 + Markdown ──
      sessions.replaceSegments(
        sid,
        result.segments.map((s) => ({
          start: s.start,
          end: s.end,
          text: s.text,
          speaker: s.speaker,
          final: true,
        })),
      )
      sessions.setMeta(sid, {
        model: result.model,
        durationMs: result.durationMs || unified.durationMs || archive.durationMs || 0,
        speakerCount: countSpeakers(result.segments),
      })

      // 标题定在音频之后、Markdown 之前：
      // 音频这时已经落盘，改标题会把它一起改名；Markdown 还没写，直接用最终文件名。
      const titled = runtime.autoTitle ? sessions.applyAutoTitle(sid, runtime.titleMaxChars) : sessions.get(sid)
      if (titled?.title) log(`标题「${titled.title}」（来源 ${titled.titleSource}）`)
      let markdownPath: string | null = null
      if (runtime.markdownEnabled) {
        const record = sessions.get(sid)
        if (record) {
          const md = renderTranscriptMarkdown(record)
          const ref = sessions.putArtifact(sid, 'markdown', markdownFileName(record), new TextEncoder().encode(md))
          markdownPath = sessions.pathOf(sid, ref.file)
        }
      }

      sessions.close(sid)
      log(
        `识别完成 session=${sid} 来源=${input.source} 时长=${fmtDuration(result.durationMs)} ` +
          `分段=${result.segments.length} 说话人=${result.speakerApplied ? 'cam++' : '未启用'}`,
      )

      return {
        sessionId: sid,
        text: result.text,
        segments: result.segments,
        durationMs: result.durationMs,
        markdownPath,
        audioPath,
        model: result.model,
        device: result.device,
        speakerApplied: result.speakerApplied,
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (openedSid) {
        sessions.setMeta(openedSid, { error: msg })
        // 失败会话也要有个能认的名字，否则在列表里只是一串 session_id
        if (runtime.autoTitle) sessions.applyAutoTitle(openedSid, runtime.titleMaxChars)
        sessions.close(openedSid)
      }
      throw e
    } finally {
      await disposeTmp(tmp)
    }
  }

  function countSpeakers(segs: RecognizedSegment[]): number {
    const set = new Set(segs.map((s) => s.speaker).filter((x): x is number => typeof x === 'number'))
    return set.size
  }

  /** Markdown 的最终文件名：跟着标题走；没有标题时用默认名（MANIFEST 里的 MARKDOWN_FILE）。 */
  function markdownFileName(rec: SessionRecord | undefined): string {
    const fallback = MARKDOWN_FILE.replace(/\.md$/, '')
    return `${sanitizeFileName(rec?.title ?? '', fallback)}.md`
  }

  /**
   * 标题变了就重写 Markdown——标题同时写在 front matter 与正文 H1 里，
   * 只改文件名不改内容会前后矛盾。已经产出过 Markdown 的会话才重写，不凭空生成。
   */
  function refreshMarkdown(sessionId: string): void {
    if (!runtime.markdownEnabled) return
    const rec = sessions.get(sessionId)
    if (!rec?.markdown) return
    try {
      const md = renderTranscriptMarkdown(rec)
      sessions.putArtifact(sessionId, 'markdown', markdownFileName(rec), new TextEncoder().encode(md))
    } catch (e) {
      log('重写 Markdown 失败:', String(e))
    }
  }

  // ═══════════════════ L1 实时流 → L3 流式识别（逐字输出） ═══════════════════

  interface LiveState {
    sessionId: string
    sourceFile?: string
    chunks: Uint8Array[]
    buffered: number
    total: number
    feeding: boolean
    /** 已归档的音频（结束后一次性包成 Ogg 落盘） */
    archiveChunks: Uint8Array[]
    closed: boolean
  }
  let live: LiveState | null = null

  const streamFlushBytes = (): number => Math.max(320, Math.round((runtime.streamChunkMs / 1000) * STREAM_BYTES_PER_SEC))

  /** 把攒够的裸 Opus 包喂给流式模型，回写增量文本。 */
  async function flushLive(): Promise<void> {
    const st = live
    if (!st || st.closed || st.feeding || st.buffered < streamFlushBytes()) return
    st.feeding = true
    const chunk = Buffer.concat(st.chunks.map((c) => Buffer.from(c)))
    st.chunks = []
    st.buffered = 0
    try {
      const r = await engine.feedStream(st.sessionId, new Uint8Array(chunk))
      st.archiveChunks.push(new Uint8Array(chunk))
      st.total += chunk.length
      if (r.partial) sessions.setPartial(st.sessionId, r.partial)
      for (const seg of r.segments) {
        sessions.appendSegment(st.sessionId, {
          start: seg.start,
          end: seg.end,
          text: seg.text,
          speaker: seg.speaker,
          final: true,
        })
      }
    } catch (e) {
      log('流式识别分段失败:', String(e))
    } finally {
      st.feeding = false
    }
  }

  /** 结束实时流：出终稿 → 归档音频 → 写 Markdown → 关会话。 */
  async function finalizeLive(reason: string): Promise<void> {
    const st = live
    if (!st || st.closed) return
    st.closed = true
    live = null
    try {
      // 收尾：把残余包先喂完
      if (st.buffered > 0) {
        st.feeding = false
        const chunk = Buffer.concat(st.chunks.map((c) => new Uint8Array(c)))
        st.chunks = []
        st.buffered = 0
        try {
          await engine.feedStream(st.sessionId, new Uint8Array(chunk))
          st.archiveChunks.push(new Uint8Array(chunk))
          st.total += chunk.length
        } catch (e) {
          log('流式收尾喂包失败:', String(e))
        }
      }

      const result = await engine.closeStream(st.sessionId).catch((e) => {
        log('流式终稿失败:', String(e))
        return null
      })

      if (result && result.segments.length > 0) {
        sessions.replaceSegments(
          st.sessionId,
          result.segments.map((s) => ({ start: s.start, end: s.end, text: s.text, speaker: s.speaker, final: true })),
        )
      }
      sessions.setMeta(st.sessionId, {
        model: result?.model ?? runtime.asrModel,
        durationMs: result?.durationMs ?? Math.round(st.total / STREAM_BYTES_PER_SEC) * 1000,
        speakerCount: result ? countSpeakers(result.segments) : 0,
      })

      // 音频归档：整段裸包一次性包成 Ogg（只有一段连续流时才合法）
      if (runtime.keepAudio && st.archiveChunks.length > 0) {
        try {
          const raw = Buffer.concat(st.archiveChunks.map((c) => Buffer.from(c)))
          const archive = containAudio(new Uint8Array(raw), 'opus', false)
          sessions.putArtifact(st.sessionId, 'audio', `audio.${archive.ext}`, archive.bytes)
        } catch (e) {
          log('实时流音频归档失败:', String(e))
        }
      }

      // 标题定在音频归档之后、Markdown 之前（同离线路径的理由）
      const titled = runtime.autoTitle
        ? sessions.applyAutoTitle(st.sessionId, runtime.titleMaxChars)
        : sessions.get(st.sessionId)
      if (titled?.title) log(`标题「${titled.title}」（来源 ${titled.titleSource}）`)

      if (runtime.markdownEnabled) {
        const record = sessions.get(st.sessionId)
        if (record) {
          const md = renderTranscriptMarkdown(record)
          sessions.putArtifact(st.sessionId, 'markdown', markdownFileName(record), new TextEncoder().encode(md))
        }
      }

      sessions.close(st.sessionId)
      log(`实时流转写结束 session=${st.sessionId}（${reason}）`)
    } catch (e) {
      log('实时流收尾异常:', String(e))
      sessions.setMeta(st.sessionId, { error: String(e) })
      sessions.close(st.sessionId)
    }
  }

  function onBleEvent(ev: BleEvent): void {
    if (ev.event === 'stream') {
      if (ev.kind === 'audio' && typeof ev.data === 'string' && live && !live.closed) {
        const bytes = b64ToBytes(ev.data)
        live.chunks.push(bytes)
        live.buffered += bytes.length
        void flushLive()
      } else if (ev.kind === 'stopped') {
        void finalizeLive('设备停止')
      }
      return
    }
    if (ev.event === 'disconnected') {
      log('BLE 连接断开，进入自动重连')
      void finalizeLive('连接断开')
      return
    }
    if (ev.event === 'connected') {
      log('BLE 已连接:', String(ev.address ?? ''), `MTU=${String(ev.mtu ?? '?')}`)
      // phase='link' 是「链路刚通、时间同步与电量还没查」的早期事件，
      // 只用于让界面立刻显示「已连接」。**不能在这里启动自动同步** ——
      // 守护进程是单命令串行的，同步一旦开始跑 filelist/download 就会占住它，
      // 之后的重连命令只能排在后面等，那正是「断开后要十几秒才恢复」的来源。
      if (ev.phase === 'link') return
      if (runtime.bleAutoSync) {
        const at = new Date().toISOString()
        lastAutoSync = { at, ok: false, error: '已触发，尚未返回' }
        void runSync()
          .then((r) => {
            lastAutoSync = {
              at,
              ok: true,
              error:
                '下载 ' +
                String(r.downloaded) +
                ' / 跳过 ' +
                String(r.skipped) +
                ' / 失败 ' +
                String(r.failed),
            }
          })
          .catch((e) => {
            const msg = e instanceof Error ? e.message : String(e)
            lastAutoSync = { at, ok: false, error: msg }
            log('连接后自动同步失败:', msg)
          })
      }
      return
    }
    if (ev.event === 'reconnecting') {
      log('BLE 自动重连中（第 ' + String(ev.attempt ?? '?') + ' 次）')
    }
  }

  // ═══════════════════ L1 离线同步 ═══════════════════

  const syncIndexFile = join(outDir, 'sync-index.json')
  interface SyncEntry {
    size: number
    time: number
    sessionId?: string
    skipBytes?: number
    text?: string
    syncedAt: string
    failed?: string
    /** 已尝试次数（含首次）。用来给瞬时失败留重试机会。 */
    attempts?: number
    /**
     * 已判定为永久失败（文件本身有问题）。
     * 与「瞬时失败」区分开：断线导致的失败下次连上就该重试，而
     * 「WAV 头非法」这类重试多少次都一样，只会白占时间。
     */
    permanent?: boolean
    failedAt?: string
  }
  type SyncIndex = Record<string, SyncEntry>
  const readSyncIndex = (): SyncIndex => {
    try {
      return JSON.parse(readFileSync(syncIndexFile, 'utf8')) as SyncIndex
    } catch {
      return {}
    }
  }
  const writeSyncIndex = (idx: SyncIndex): void => {
    try {
      writeFileSync(syncIndexFile, JSON.stringify(idx, null, 2), 'utf8')
    } catch {
      /* ignore */
    }
  }
  interface SyncState {
    running: boolean
    lastSyncAt: string | null
    lastResult: { downloaded: number; skipped: number; failed: number } | null
    lastError: string | null
  }
  const syncState: SyncState = { running: false, lastSyncAt: null, lastResult: null, lastError: null }

  let blePrepared: { ok: boolean; error?: string } | null = null
  async function ensureBle(): Promise<{ ok: boolean; error?: string }> {
    // prepare 会做 python/bleak 探测（缺 bleak 时可能触发 pip 安装），只跑一次
    if (!blePrepared) blePrepared = ble.prepare(pythonCandidates(config.pythonPath))
    if (!blePrepared.ok) return blePrepared
    try {
      await ble.ensureStarted()
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  /** 离线下载的候选名偏好：默认 .opus（体积 16 倍优势） */
  const downloadPrefer = (): 'opus' | 'wav' => (runtime.opusPreferred ? 'opus' : 'wav')

  // ─────────── 设备扫描：可启停 + 认出连过的卡就自动接回来 ───────────

  interface ScanDevice extends BleDevice {
    known: boolean
    lastConnectedAt?: string
  }

  interface ScanState {
    running: boolean
    startedAt: string | null
    roundMs: number
    autoConnect: boolean
    /** 已发现的设备，按信号从强到弱（跨轮次累积，掉出范围的会保留最后一次所见） */
    devices: ScanDevice[]
    /** 本轮自动连上的地址 */
    autoConnected: string | null
    message: string | null
    lastError: string | null
  }

  let scanState: ScanState = {
    running: false,
    startedAt: null,
    roundMs: 3000,
    autoConnect: true,
    devices: [],
    autoConnected: null,
    message: null,
    lastError: null,
  }
  /** 自增令牌：调一次就作废正在跑的那轮循环，用于「停止扫描」 */
  let scanToken = 0

  function decorateScanned(devs: BleDevice[]): ScanDevice[] {
    return devs.map((d) => {
      const hit = matchKnown(knownDevices, d)
      return { ...d, known: Boolean(hit), lastConnectedAt: hit?.lastConnectedAt }
    })
  }

  /** 连接成功后把设备记进缓存——手动连接与自动重连都走这里，缓存才不会漏。 */
  async function connectAndRemember(
    address: string,
    retries: number,
    dev?: { name?: string; rssi?: number },
  ): Promise<Record<string, unknown>> {
    const r = await ble.connect(address, retries)
    try {
      knownDevices.remember({ address: ble.address ?? address, name: dev?.name, rssi: dev?.rssi })
    } catch {
      /* 缓存写失败不影响连接 */
    }
    return r
  }

  /**
   * 扫描循环。
   *
   * 刻意用**短轮次反复扫**而不是一次长扫：这样「停止扫描」最多等一轮（≈3s）就能响应，
   * 设备列表也能一轮一轮地长出来，而不是按下按钮后干等十几秒什么都没有。
   *
   * 每轮结束后，若开着自动连接且发现了**连过的**设备，就直接把它接回来——
   * 用户按「扫描设备」的真实意图通常就是「把我的卡接回来」，不该让他再从列表里挑。
   */
  /**
   * 后台预热。
   *
   * FunASR worker 冷启动要 import torch + funasr（实测约 6 秒），而 `/asr/status`
   * 在缓存为空时会 `await ensureStarted()`。于是**插件刚加载后第一次打开页面**
   * 必然卡 6 秒 —— 面板表现为「加载中… · BLE 守护进程未启动」，
   * 因为页面挂载被堵住，连 /ble/setup 都排在后面没跑。
   *
   * 这里在插件挂载后主动把 worker 拉起来（顺带做 Qwen 的逐模块体检），
   * 等用户真正打开面板时缓存已经有了，首屏就是瞬时的。
   */
  const warmTimer = setTimeout(() => {
    void (async () => {
      try {
        // 必须把结果存回 cachedReadiness：readiness() 自己不写这个变量，
        // 赋值是在路由里做的。不存的话 /presets 会一直显示 funasr-py 未安装。
        cachedReadiness = await readiness(true)
        log('预热完成：识别环境状态已就绪')
      } catch (e) {
        log('预热失败（不影响使用，打开面板时会重试）:', e instanceof Error ? e.message : String(e))
      }
      try {
        if (qwenCheckCache === null && !qwenCheckPending) {
          qwenCheckPending = true
          qwenCheckCache = { at: Date.now(), value: qwenImportCheck(outDir) }
        }
      } catch {
        /* 预热失败不影响使用 */
      } finally {
        qwenCheckPending = false
      }
    })()
  }, 2_000)
  ctx.effect(() => () => clearTimeout(warmTimer))

  /**
   * 连接自愈（host 侧兜底）。
   *
   * 为什么需要：重连原来**只在捕获到断链事件时才启动**。而现实里断链有两种漏法——
   * 一次 `set_disconnected_callback` 没触发、或那次探活恰好被跳过——于是
   * `connected` 一直停在 True：卡离范围了插件还显示已连接，卡拿回来也没人去接，
   * 用户只能看到「自动连接失败」。
   *
   * 这里不管断链是"怎么"被发现的：只要**我们连过设备（有缓存）**、现在没连上、
   * 也没在扫描，就主动发起一次「扫描 + 自动连接」把卡接回来。
   * 知识在 host 侧（known-devices 缓存），所以兜底也就该放在 host 侧。
   */
  const bleRecoverTimer = setInterval(() => {
    try {
      if (disposed) return
      // 用户没开自动同步 → 也不替他自作主张重连
      if (!runtime.bleAutoSync) return
      if (ble.connected || scanState.running || syncState.running) return
      if (knownDevices.list().length === 0) return
      log('自愈：当前未连接且存在连过的设备，发起扫描 + 自动连接')
      void scanLoop({ roundMs: 3000, autoConnect: true, timeoutMs: 180_000 })
    } catch (e) {
      log('自愈循环异常:', e instanceof Error ? e.message : String(e))
    }
  }, 10_000)
  ctx.effect(() => () => clearInterval(bleRecoverTimer))

  async function scanLoop(opts: { roundMs: number; autoConnect: boolean; timeoutMs: number }): Promise<void> {
    const my = ++scanToken
    const started = Date.now()
    const seen = new Map<string, ScanDevice>()
    scanState = {
      running: true,
      startedAt: new Date().toISOString(),
      roundMs: opts.roundMs,
      autoConnect: opts.autoConnect,
      devices: [],
      autoConnected: null,
      message: null,
      lastError: null,
    }
    try {
      while (scanToken === my && !disposed) {
        if (ble.connected) {
          scanState.message = '已连接，停止扫描'
          break
        }
        if (opts.timeoutMs > 0 && Date.now() - started > opts.timeoutMs) {
          scanState.message = '扫描结束（未发现连接过的设备）'
          break
        }
        let round: BleDevice[] = []
        try {
          round = await ble.scan(Math.max(1, Math.round(opts.roundMs / 1000)))
          scanState.lastError = null
        } catch (e) {
          scanState.lastError = e instanceof Error ? e.message : String(e)
          await new Promise((r) => setTimeout(r, 1200))
          continue
        }
        for (const d of decorateScanned(round)) seen.set(d.address, d)
        scanState.devices = [...seen.values()].sort((a, b) => b.rssi - a.rssi)

        if (!opts.autoConnect) continue
        // 有多张连过的卡时，优先接用得最多的那张
        const target = scanState.devices
          .filter((d) => d.known)
          .sort(
            (a, b) =>
              (knownDevices.find(b.address)?.connectCount ?? 0) -
              (knownDevices.find(a.address)?.connectCount ?? 0),
          )[0]
        if (!target) continue

        const label = target.name || target.address
        scanState.message = `发现连接过的设备 ${label}，正在自动连接…`
        try {
          await connectAndRemember(target.address, 3, target)
          scanState.autoConnected = target.address
          scanState.message = `已自动连接 ${label}`
          log(`扫描时自动连接了连过的设备 ${label}`)
          break
        } catch (e) {
          scanState.lastError = `自动连接 ${label} 失败：${e instanceof Error ? e.message : String(e)}`
        }
      }
    } finally {
      if (scanToken === my) scanState.running = false
    }
  }

  function stopScan(message?: string): void {
    scanToken += 1
    if (scanState.running) scanState.running = false
    if (message) scanState.message = message
  }

  /** 离线批量同步：拉列表 → 逐个下载（Opus 优先）→ 识别 → 三件套。 */
  /**
   * 「这条录音确实已经在电脑上了」的判定。
   *
   * 从卡上删录音是**不可逆**的，所以删之前必须证明本地留住了东西，
   * 而不是只看识别流程有没有抛异常。最容易出事的是 `keepAudio=false`：
   * 那种情况下只留转写文本、不留音频，若还去删卡，原始录音就永久没了。
   */
  function isSafelyOnDisk(sessionId: string): { ok: boolean; bytes: number; reason?: string } {
    const rec = sessions.get(sessionId)
    if (!rec) return { ok: false, bytes: 0, reason: '会话记录不存在' }
    if (!rec.audio) {
      return {
        ok: false,
        bytes: 0,
        reason: runtime.keepAudio ? '音频未归档' : '配置未保留音频（keepAudio=false）',
      }
    }
    try {
      const st = statSync(sessions.pathOf(sessionId, rec.audio.file))
      if (!st.isFile() || st.size === 0) return { ok: false, bytes: 0, reason: '本地音频为空' }
      return { ok: true, bytes: st.size }
    } catch {
      return { ok: false, bytes: 0, reason: '本地音频文件不存在' }
    }
  }

  /**
   * 转成功之后把卡上这条删掉。
   * 判定不通过就**保留在卡上**并把原因写进日志——宁可卡里多留一份，
   * 也不能出现「卡上删了、电脑上没有」。
   */
  async function deleteFromDeviceAfterTransfer(
    entry: { name: string; time: number; size: number; raw?: string },
    sessionId: string,
  ): Promise<'deleted' | 'kept' | 'failed'> {
    const guard = isSafelyOnDisk(sessionId)
    if (!guard.ok) {
      log(`未删除设备上的 ${entry.name}：${guard.reason}（本地没有可靠副本，先留在卡上）`)
      return 'kept'
    }
    try {
      // deleteFile 内部会核对设备回执并重拉列表确认；删不掉会抛异常，
      // 不会像以前那样「发完就报成功」。
      const r = await ble.deleteFile(entry.name, entry.time, entry.size, entry.raw)
      const fmt = typeof r.format === 'string' ? `，payload=${r.format}` : ''
      log(`已从录音卡删除 ${entry.name}（本地已存 ${guard.bytes} 字节，session=${sessionId}${fmt}）`)
      return 'deleted'
    } catch (err) {
      log(`删除设备上的 ${entry.name} 失败：${String(err)}（本地副本仍在，卡上也还在）`)
      return 'failed'
    }
  }

  /**
   * 同步失败是「瞬时」还是「永久」。
   *
   * 瞬时（断线、信号弱、扫描超时）值得下次连上再试；
   * 永久（卡上数据本身有问题）重试多少次都一样，只会白占同步时间。
   * 拿不准时按瞬时处理——多试几次的代价远小于「一次失败就永久放弃」。
   */
  function isTransientFailure(msg: string): boolean {
    const m = (msg ?? '').toLowerCase()
    if (/未连接|连接失败|已断开|断开连接|扫描未发现|超时|timeout|timed out|busy|winerror|bluetooth|重置/.test(m)) {
      return true
    }
    if (/wav 头非法|长度不符|收到 0 字节|校验失败|完整性|不支持|unsupported|invalid|解码失败|code=1/.test(m)) {
      return false
    }
    return true
  }

  /** 瞬时失败最多尝试几次；到顶就放弃，除非显式 force。 */
  const SYNC_MAX_ATTEMPTS = 3

  // ═══════════════════ 后处理：一轮同步 = 一条消息 ═══════════════════

  interface PendingPost {
    at: string
    templateId: string
    templateName: string
    /** 这一轮涉及的录音（供界面展示 + 确认后记流转用） */
    items: Array<{ name: string; title: string; sessionId: string }>
    text: string
  }
  /**
   * 待确认队列。**必须是数组**：如果只存一条，第二轮同步会把还没确认的
   * 上一轮直接覆盖掉，用户那条内容就无声无息地没了。
   */
  const pendingQueue: PendingPost[] = []

  /**
   * 用户**真正打开着**的会话 id —— 由前端会话作用域的上报器写入。
   *
   * 为什么不能用「最近活跃的会话」代替：投放本身会刷新目标会话的 updatedAt，
   * 于是那个替代方案会**自我锁死** —— 越投越固定，用户明明切到了别的对话，
   * 投放还是发进原来那个。
   */
  let openSessionId: string | null = null

  /** 前端实际走的挂载路径（诊断用） */
  let lastUiSurface: Record<string, unknown> | null = null

  /**
   * 自动链路的可观测记录。
   *
   * 之前这条链路失败只进 log()，界面上完全看不到 —— 于是「连接后没自动同步」
   * 「同步后没自动流转」都无从判断到底是没触发、还是触发了但报错。
   * 这两条记录通过 /ble/status 暴露出去。
   */
  let lastAutoSync: { at: string; ok: boolean; error: string | null } | null = null
  let lastPostProcess: {
    at: string
    ok: boolean
    mode: string
    count: number
    target: string | null
    error: string | null
  } | null = null

  /** DSH 会话标题缓存。界面每 3 秒轮询，不该每次都去读会话持久化。 */
  const dshTitleCache = new Map<string, { title: string | null; at: number }>()

  async function dshSessionTitle(sessionId: string): Promise<string | null> {
    const hit = dshTitleCache.get(sessionId)
    if (hit !== undefined && Date.now() - hit.at < 10_000) return hit.title
    let title: string | null = null
    try {
      const sc = ctx.get('sessionController') as
        | { list: (req: unknown, signal: AbortSignal) => Promise<{ items: unknown[] }> }
        | undefined
      if (sc !== undefined) {
        const v = await sc.list({}, new AbortController().signal)
        const row = (v.items ?? []).find(
          (x) => (x as { sessionId?: string }).sessionId === sessionId,
        ) as { projections?: { values?: { title?: string | null } } } | undefined
        const t = row?.projections?.values?.title
        if (typeof t === 'string' && t.trim()) title = t
      }
    } catch {
      /* 取不到就返回 null，界面退回显示 id */
    }
    dshTitleCache.set(sessionId, { title, at: Date.now() })
    return title
  }

  /** 取一条录音的显示标题（优先会话标题，退回文件名）。 */
  function titleForEntry(sessionId: string, fallback: string): string {
    return sessions.get(sessionId)?.title ?? fallback
  }

  /**
   * 把本轮所有转写拼成**一条**消息发给目标会话。
   *
   * 用户明确要求：一轮同步里 5 条录音 → 5 条都转写后**拼接成一份**再发，
   * 不是发 5 条消息。所以这里先合并，再按运转方式决定立即发送还是等你确认。
   */
  async function buildPostMessage(
    items: Array<{ name: string; sessionId: string; text: string }>,
  ): Promise<{
    text: string
    template: PromptTemplate
    titleList: Array<{ name: string; title: string; sessionId: string }>
  } | null> {
    const tpl = allTemplates(userTemplates).find((x) => x.id === runtime.postProcess.templateId)
    if (tpl === undefined) return null
    const titleList = items.map((it) => ({
      name: it.name,
      title: titleForEntry(it.sessionId, it.name),
      // 必须带上：确认发送后要按 sessionId 记流转标记
      sessionId: it.sessionId,
    }))
    const body = items
      // 每条都带上录音会话 id：Agent 之后要用它调 recorder_attach_notes
      // 把纪要挂回**这条**录音。没有 id，工具就不知道该挂到哪。
      .map(
        (it, i) =>
          `## 录音 ${i + 1}：${titleList[i].title}\n\n录音会话 id：${it.sessionId}\n\n${it.text.trim()}`,
      )
      .join('\n\n---\n\n')
    const text = `${tpl.body}\n\n---\n\n以下是本轮从录音卡同步到的 ${items.length} 条录音的转写文本：\n\n${body}`
    return { text, template: tpl, titleList }
  }

  /**
   * 解析目标会话：指定了就用它，没指定就**新建一个**。
   *
   * ⚠ 绝不把新建的 id 写回配置。
   * 之前这里写了 `runtime.postProcess.conversationId = v.sessionId`，
   * 于是用户选的「新建对话（每次新建）」在第一次同步后就被偷偷改成"固定那个对话"，
   * 那个选项从此永远失效 —— 而且是在后台同步路径里改用户配置，完全无感知。
   */
  async function resolveTargetSession(): Promise<string> {
    const sc = ctx.get('sessionController') as
      | { create: (req: unknown) => Promise<{ sessionId: string }> }
      | undefined
    if (sc === undefined) throw new Error('内核未提供 sessionController')
    if (runtime.postProcess.conversationId) return runtime.postProcess.conversationId
    const v = await sc.create({})
    return v.sessionId
  }

  /** 真正发出去。 */
  async function sendPostMessage(sessionId: string, text: string): Promise<void> {
    const sc = ctx.get('sessionController') as
      | { prompt: (req: unknown, signal: AbortSignal) => Promise<unknown> }
      | undefined
    if (sc === undefined) throw new Error('内核未提供 sessionController')
    await sc.prompt(
      {
        requestId: `rec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        sessionId,
        mode: 'queue',
        content: [{ type: 'text', text }],
      },
      new AbortController().signal,
    )
  }

  /**
   * 同步收尾时调用。一轮同步 = 一条消息。
   * `auto` 立即发；`confirm` 存成待确认，由界面预览后决定。
   */
  async function triggerPostProcess(items: Array<{ name: string; sessionId: string; text: string }>): Promise<void> {
    const built = await buildPostMessage(items)
    if (built === null) {
      log('后处理跳过：找不到提示词模板', runtime.postProcess.templateId)
      return
    }
    lastPostProcess = {
      at: new Date().toISOString(),
      ok: false,
      mode: runtime.postProcess.mode,
      count: items.length,
      target: null,
      error: null,
    }
    if (runtime.postProcess.mode === 'confirm') {
      pendingQueue.push({
        at: new Date().toISOString(),
        templateId: built.template.id,
        templateName: built.template.name,
        items: built.titleList,
        text: built.text,
      })
      log(
        `后处理：已备好 ${items.length} 条录音的合并消息，等待你确认后发送` +
          (pendingQueue.length > 1 ? `（另有 ${pendingQueue.length - 1} 条待确认）` : ''),
      )
      if (lastPostProcess) lastPostProcess.error = '已备好，等你手动确认'
      return
    }
    try {
      const sid = await resolveTargetSession()
      await sendPostMessage(sid, built.text)
      if (lastPostProcess) {
        lastPostProcess.ok = true
        lastPostProcess.target = sid
      }
      // 记流转
      for (const it of items) {
        markFlowed(outDir, {
          sessionId: it.sessionId,
          kind: 'auto',
          targetSessionId: sid,
          at: new Date().toISOString(),
          templateId: built.template.id,
          batchSize: items.length,
        })
      }
      log(`后处理：已把 ${items.length} 条录音的合并消息发到会话 ${sid}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (lastPostProcess) lastPostProcess.error = msg
      throw e
    }
  }
  async function runSync(opts: { deleteAfter?: boolean; force?: boolean } = {}) {
    if (syncState.running) throw new Error('同步已在运行中')
    syncState.running = true
    syncState.lastError = null
    try {
      const entries = await ble.filelist()
      const index = readSyncIndex()
      const alive = new Set(entries.map((e) => e.name))
      for (const k of Object.keys(index)) if (!alive.has(k)) delete index[k]

      const deleteAfter = opts.deleteAfter ?? runtime.bleSyncDeleteAfter
      const force = opts.force ?? false
      const result = { downloaded: 0, skipped: 0, failed: 0, retried: 0, deleted: 0, kept: 0 }
      // 小文件优先：快速拿到结果，长录音排后面慢慢传
      const ordered = [...entries].sort((a, b) => a.size - b.size)
      // 这一轮的完整转写（索引里只存前 200 字，后处理需要全文）
      const roundTranscripts: Array<{ name: string; sessionId: string; text: string }> = []
      for (const e of ordered) {
        const prev = index[e.name]
        if (prev && !prev.failed && prev.size === e.size && prev.text) {
          result.skipped++
          // 以前同步过但当时没开「同步后删除」，卡上这条还在 → 补删。
          // 这解决了历史积压：开开关之前转过的录音也该被清掉。
          if (deleteAfter && prev.sessionId) {
            const r = await deleteFromDeviceAfterTransfer(e, prev.sessionId)
            if (r === 'deleted') result.deleted++
            else if (r === 'kept') result.kept++
          }
          continue
        }
        // 失败过的文件：瞬时失败留重试机会，永久失败/超次数才跳过
        if (prev?.failed && !force) {
          const attempts = prev.attempts ?? 1
          if (prev.permanent === true || attempts >= SYNC_MAX_ATTEMPTS) {
            result.skipped++
            continue
          }
          result.retried++
          log(`同步: 重试 ${e.name}（第 ${attempts + 1}/${SYNC_MAX_ATTEMPTS} 次，上次：${prev.failed ?? ''}）`)
        }
        if (!ble.connected) {
          // 断线了就别把剩下的一堆文件逐个标成失败——它们根本没被尝试过
          log(`同步中断：录音卡已断开，剩余文件留待下次（已完成 ${result.downloaded}）`)
          break
        }
        log('同步: 处理', e.name, `${e.time}s/${e.size}B`)
        try {
          const dl = await ble.download(e.name, { prefer: downloadPrefer() })

          // 分片/续传的字节数必须与设备报的一致。
          // 真机实测：本卡固件接受非零 offset，但续传边界会丢字节或重复字节
          // （11840B 的文件续传出 11200 / 12000 / 13760 都有），数据是坏的。
          // 所以真实管线一律单次传输，这里再加一道硬校验兜底。
          if (dl.chunks && dl.chunks > 1 && dl.size !== e.size) {
            throw new Error(`分片传输字节数不符（设备 ${e.size}B，收到 ${dl.size}B）——本机固件的 offset 续传不可靠`)
          }

          const out = await recognize({
            bytes: b64ToBytes(dl.data),
            hint: dl.ext === 'wav' ? 'wav' : 'opus',
            source: 'file',
            deviceFile: dl.name,
            // 录制时间取自设备文件名，不是同步时刻
            recordedAt: deviceFileTime(dl.name)?.toISOString(),
            device: { address: ble.address ?? undefined },
          })
          index[e.name] = {
            size: e.size,
            time: e.time,
            sessionId: out.sessionId,
            text: out.text.slice(0, 200),
            syncedAt: new Date().toISOString(),
          }
          result.downloaded++
          // 收集本轮完整转写，供收尾时做后处理。
          // 注意：同步索引里只存 text.slice(0,200)（截断的），所以必须在这里
          // 拿 out.text 全文，不能回头从索引读。
          roundTranscripts.push({ name: e.name, sessionId: out.sessionId, text: out.text })
          log('同步: 完成', e.name, '→', out.sessionId, out.text.slice(0, 40))
          if (deleteAfter) {
            const r = await deleteFromDeviceAfterTransfer(e, out.sessionId)
            if (r === 'deleted') result.deleted++
            else if (r === 'kept') result.kept++
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          const attempts = (prev?.attempts ?? 0) + 1
          const permanent = !isTransientFailure(msg)
          const now = new Date().toISOString()
          index[e.name] = {
            size: e.size,
            time: e.time,
            syncedAt: now,
            failed: msg.slice(0, 200),
            failedAt: now,
            attempts,
            permanent,
          }
          result.failed++
          log(
            `同步: 失败 ${e.name} ${msg.slice(0, 140)}` +
              `（第 ${attempts}/${SYNC_MAX_ATTEMPTS} 次，${permanent ? '永久失败，不再重试' : '瞬时失败，下次自动重试'}）`,
          )
        }
      }
      writeSyncIndex(index)
      syncState.lastSyncAt = new Date().toISOString()
      syncState.lastResult = result
      if (result.deleted > 0) log(`同步后从录音卡删除 ${result.deleted} 条（本地均有副本）`)
      if (result.kept > 0) log(`有 ${result.kept} 条未从录音卡删除（本地无可靠副本，保留）`)
      if (result.retried > 0) log(`本次重试了 ${result.retried} 条此前失败的文件`)
      // 后处理：把**这一轮**的转写合并成一份发出去（一轮 = 一条消息）
      if (runtime.postProcess.enabled) {
        const items = roundTranscripts.filter((x) => x.text.trim().length > 0)
        if (items.length > 0) {
          await triggerPostProcess(items).catch((err) =>
            log('后处理失败（不影响同步结果）:', err instanceof Error ? err.message : String(err)),
          )
        }
      }
      return result
    } catch (e) {
      syncState.lastError = e instanceof Error ? e.message : String(e)
      throw e
    } finally {
      syncState.running = false
    }
  }

  // ═══════════════════ FunASR 就绪 / 安装 ═══════════════════
  let cachedReadiness: FunasrReadiness | null = null

  async function readiness(force = false): Promise<FunasrReadiness> {
    if (cachedReadiness && !force) return cachedReadiness
    try {
      await funasrWorker.ensureStarted()
      cachedReadiness = force ? await probeFunasr(funasrWorker) : readReadiness(funasrWorker.readyPayload)
    } catch (e) {
      cachedReadiness = {
        python: funasrPython,
        pythonVersion: null,
        funasrInstalled: false,
        funasrVersion: null,
        torchVersion: null,
        cudaAvailable: false,
        cudaDeviceName: null,
        device: 'cpu',
        models: [],
        missing: [`FunASR worker 启动失败：${e instanceof Error ? e.message : String(e)}`],
        installHint: '检查 Python 解释器与 scripts/funasr_worker.py 是否存在于插件安装目录',
        ready: false,
      }
    }
    return cachedReadiness
  }

  // ═══════════════════ 路由 ═══════════════════
  const activeSse = new Set<ServerResponse>()
  let disposed = false

  ctx.effect(() => {
    const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (req.method === 'OPTIONS') return sendJson(res, 204, {})
      if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'HEAD' && req.method !== 'DELETE') {
        return sendJson(res, 405, { ok: false, error: 'method not allowed' })
      }

      let pathname = '/'
      let search = new URLSearchParams()
      try {
        const u = new URL(req.url ?? '/', 'http://x')
        pathname = u.pathname
        search = u.searchParams
      } catch {
        /* ignore */
      }

      const isRecorder = pathname.startsWith('/api/recorder')
      const isQs668 = pathname.startsWith('/api/qs668')
      if (!isRecorder && !isQs668) return sendJson(res, 404, { ok: false, error: 'not found: ' + pathname })
      if (!authOk(req)) return sendJson(res, 403, { ok: false, error: 'invalid token' })

      try {
        // ───────────────── DELETE ─────────────────
        if (req.method === 'DELETE') {
          const m = pathname.match(/^\/api\/recorder\/session\/([^/]+)$/)
          if (isRecorder && m) {
            const sid = decodeURIComponent(m[1])
            // id 来自 URL，而目录是 join(root, id)：不校验就能用 ../ 删到数据目录外面
            if (!isValidSessionId(sid)) return sendJson(res, 400, { ok: false, error: '非法 session id' })
            const existed = sessions.get(sid) !== undefined
            if (live && live.sessionId === sid) await finalizeLive('删除会话')
            const r = sessions.remove(sid)
            if (!r.ok) return sendJson(res, 500, { ok: false, error: r.error ?? '删除失败' })
            log(
              `已删除会话 ${sid}（释放 ${r.freedBytes} 字节${existed ? '' : '，记录本就不存在'}` +
                `${r.archivedSummary ? `，LLM 总结已归档到 ${r.archivedSummary}` : ''}）`,
            )
            return sendJson(res, 200, {
              ok: true,
              sessionId: sid,
              existed,
              freedBytes: r.freedBytes,
              archivedSummary: r.archivedSummary,
            })
          }
          return sendJson(res, 404, { ok: false, error: 'unknown DELETE ' + pathname })
        }

        // ───────────────── GET / HEAD ─────────────────
        if (req.method === 'GET' || req.method === 'HEAD') {
          if (isRecorder && pathname === '/api/recorder/health') {
            return sendJson(res, 200, { ok: true, name, version: VERSION, outDir, layers: ['capture', 'preprocess', 'recognition', 'output', 'session-link'] })
          }
          if (isRecorder && pathname === '/api/recorder/config') {
            return sendJson(res, 200, { ok: true, config: runtime, python: funasrPython })
          }
          // 投放目标：返回「当前打开的会话」及其标题，供界面显示
          if (isRecorder && pathname === '/api/recorder/open-session') {
            const title = openSessionId === null ? null : await dshSessionTitle(openSessionId)
            return sendJson(res, 200, { ok: true, sessionId: openSessionId, title })
          }
          // 流转记录：全量（列表页批量显示「已流转」标记）
          if (isRecorder && pathname === '/api/recorder/flows') {
            return sendJson(res, 200, { ok: true, bySession: allFlows(outDir) })
          }
          // 纪要：列出全部（按录音会话分组）
          if (isRecorder && pathname === '/api/recorder/notes') {
            return sendJson(res, 200, { ok: true, bySession: listAllNotes(outDir) })
          }

          // 纪要：读取某一份的正文
          if (isRecorder && pathname === '/api/recorder/note') {
            const p = new URL(req.url ?? '', 'http://x').searchParams.get('path') ?? ''
            const text = readNote(p, outDir)
            if (text === null) {
              return sendJson(res, 404, { ok: false, error: '找不到该纪要（或路径不在纪要目录内）' })
            }
            return sendJson(res, 200, { ok: true, path: p, text })
          }

          // 纪要：某条录音名下的列表
          if (isRecorder && pathname === '/api/recorder/notes-for') {
            const sid = new URL(req.url ?? '', 'http://x').searchParams.get('sessionId') ?? ''
            return sendJson(res, 200, { ok: true, sessionId: sid, docs: listNotes(outDir, sid) })
          }
          // 后处理：查看待确认的合并消息（手动确认模式）
          if (isRecorder && pathname === '/api/recorder/post-process/pending') {
            return sendJson(res, 200, {
              ok: true,
              pending: pendingQueue[0] ?? null,
              pendingCount: pendingQueue.length,
            })
          }
          // 后处理用：列出 DSH 的会话，供用户挑选「转向对话」
          if (isRecorder && pathname === '/api/recorder/dsh/sessions') {
            const sc = ctx.get('sessionController') as
              | {
                  list: (req: unknown, signal: AbortSignal) => Promise<{ items: unknown[] }>
                }
              | undefined
            if (sc === undefined) {
              return sendJson(res, 503, { ok: false, error: '内核未提供 sessionController（无法列出会话）' })
            }
            try {
              const ac = new AbortController()
              const v = await sc.list({}, ac.signal)
              return sendJson(res, 200, { ok: true, items: v.items ?? [] })
            } catch (e) {
              return sendJson(res, 500, {
                ok: false,
                error: `列出会话失败：${e instanceof Error ? e.message : String(e)}`,
              })
            }
          }
          // 后处理配置 + 提示词模板列表
          if (isRecorder && pathname === '/api/recorder/post-process') {
            return sendJson(res, 200, {
              ok: true,
              config: runtime.postProcess,
              templates: allTemplates(userTemplates),
              // 必须带上：界面靠它渲染「待确认发送」块。
              // 之前这行没生效，导致该块永远不出现（手动确认模式形同虚设）。
              pending: pendingQueue[0] ?? null,
              pendingCount: pendingQueue.length,
            })
          }

          // 预设列表 + 每个环境组件的状态/能否卸载
          if (isRecorder && pathname === '/api/recorder/presets') {
            const active = String(runtime.asrModel ?? 'paraformer-zh')
            const activePreset = presetById(active)
            if (activePreset === undefined) {
              return sendJson(res, 400, { ok: false, error: `未知预设: ${active}` })
            }
            const enabled = normalizeEnabledPresets(runtime.enabledPresets, active)
            // cachedReadiness 为空 = **还不知道**，不能当成「未安装」（那会在刚启动/改过配置后谎报）
            const funasrPkgOk = cachedReadiness === null ? null : cachedReadiness.funasrInstalled === true
            const envs = envStatus(
              {
                basePython: funasrPython ?? 'python',
                funasrModelDir: runtime.funasrModelDir || join(outDir, 'funasr'),
                qwenVenvDir: join(outDir, 'qwen-venv'),
                qwenModelDir: qwenDir,
                qwenModelName: config.qwenModelName,
              },
              enabled,
              funasrPkgOk,
            )
            return sendJson(res, 200, {
              ok: true,
              presets: ASR_PRESETS,
              active,
              components: ENV_COMPONENTS,
              envs,
              // 当前预设需要哪些组件 —— 界面「识别环境」只该显示这些
              needed: activePreset.needs,
              enabled,
              // 每个预设的卸载计划：会删什么、会保留什么（引用计数结果）
              uninstallPlans: ASR_PRESETS.map((p) => planPresetUninstall(p.id, enabled)),
            })
          }

          if (isRecorder && pathname === '/api/recorder/asr/status') {
            // **默认走缓存**，只有显式 `?probe=1` 才真去探测。
            //
            // 原来这里是无条件 `readiness(true)`，也就是每次调用都发一条 probe 命令给
            // Python worker。worker 是单线程的，冷启动要 import torch+funasr（实测 6 秒），
            // 忙起来还会把 probe 排在识别/同步后面 —— 于是「一切走再切回来页面就卡住」、
            // 「同步时切页面更卡」。切页面读状态本来就该是瞬时的。
            const wantProbe = /[?&]probe=1/.test(req.url ?? '')
            const r = await readiness(wantProbe)
            // Qwen3 是独立于 FunASR 的一套环境（自己的 venv + 权重），单独如实上报
            //
            // ⚠ 逐模块 import 体检**极其昂贵**（起 Python 进程 + import torch ≈ 6 秒），
            //   绝不能放在默认路径上：否则每次切页面都要等 6 秒，而且会把页面挂载堵住，
            //   连 /ble/setup 都来不及跑 —— 面板表现为
            //   「加载中… · BLE 守护进程未启动 · bleak 未探测 · 已发现 0 个设备」。
            //   只在显式 ?probe=1 时真做，结果缓存 10 分钟供默认读取。
            const nowQ = Date.now()
            const qwenStale = qwenCheckCache === null || nowQ - qwenCheckCache.at > 600_000
            if (qwenStale) {
              if (wantProbe) {
                // 显式探测：就同步等这一次（用户主动点的，慢也有预期）
                qwenCheckCache = { at: nowQ, value: qwenImportCheck(outDir) }
              } else if (!qwenCheckPending) {
                // 默认路径：**后台预热，绝不阻塞这次请求**。
                // 否则插件刚加载后的第一次打开页面仍要等 6 秒（用户看到的就是
                // 「加载中… · BLE 守护进程未启动」，因为挂载被堵住、/ble/setup 还没跑）。
                qwenCheckPending = true
                void (async () => {
                  try {
                    qwenCheckCache = { at: Date.now(), value: qwenImportCheck(outDir) }
                  } catch {
                    /* 预热失败不影响请求 */
                  } finally {
                    qwenCheckPending = false
                  }
                })()
              }
            }
            const qwenCheck = qwenCheckCache?.value ?? null
            const qwen = {
              // 默认走文件检查（瞬时）；有体检结果就以它为准，
              // 避免「体检报缺失、就绪却是 true」的假绿
              ready: qwenReadyCached(false) && (qwenCheck === null || qwenCheck.ok),
              venv: qwenVenvPythonPath(outDir),
              modelName: config.qwenModelName,
              modelPath: join(qwenDir, config.qwenModelName),
              modelPresent: existsSync(join(qwenDir, config.qwenModelName, 'config.json')),
              lastInstall: cachedQwenStatus,
              // 逐模块 import 体检：缺哪个模块、什么错误，如实报给面板
              importCheck: qwenCheck,
              hint: '点「安装 / 修复环境」会创建 qwen venv、安装 qwen-asr 并下载权重（约 3.4GB，走 hf-mirror）',
            }
            return sendJson(res, 200, { ok: true, ready: r.ready, status: r, qwen, probed: wantProbe })
          }
          if (isRecorder && pathname === '/api/recorder/sessions') {
            return sendJson(res, 200, { ok: true, items: sessions.list() })
          }
          if (isRecorder && pathname === '/api/recorder/summaries') {
            return sendJson(res, 200, { ok: true, items: sessions.listSummaries() })
          }
          if (isRecorder && pathname === '/api/recorder/ble/known') {
            return sendJson(res, 200, { ok: true, items: knownDevices.list() })
          }
          if (isRecorder && pathname === '/api/recorder/ble/status') {
            return sendJson(res, 200, {
              ok: true,
              python: ble.python,
              bleak: ble.bleakVersion,
              daemonRunning: ble.running,
              connected: ble.connected,
              reconnecting: ble.reconnecting,
              reconnectAttempt: ble.reconnectAttempt,
              address: ble.address,
              mtu: ble.mtu,
              battery: ble.battery,
              realtimeActive: ble.realtimeActive,
              live: live ? { sessionId: live.sessionId, bufferedBytes: live.buffered, totalBytes: live.total } : null,
              sync: syncState,
              scan: scanState,
              // 自动链路的可观测记录：失败原因不再只进日志
              lastAutoSync,
              lastPostProcess,
            })
          }
          if (isRecorder && pathname === '/api/recorder/ble/filelist') {
            const st = await ensureBle()
            if (!st.ok) return sendJson(res, 500, { ok: false, error: st.error })
            try {
              return sendJson(res, 200, { ok: true, entries: await ble.filelist(), opusPreferred: runtime.opusPreferred })
            } catch (e) {
              return sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) })
            }
          }
          if (isRecorder && pathname === '/api/recorder/ble/sync/status') {
            return sendJson(res, 200, { ok: true, ...syncState })
          }

          // 会话详情 / 事件流 / 音频 / Markdown
          const detail = pathname.match(/^\/api\/recorder\/session\/([^/]+)(?:\/(events|audio|markdown))?$/)
          if (isRecorder && detail) {
            const sid = decodeURIComponent(detail[1])
            const sub = detail[2]
            if (!isValidSessionId(sid)) return sendJson(res, 400, { ok: false, error: '非法 session id' })
            const rec = sessions.get(sid)
            if (!rec) return sendJson(res, 404, { ok: false, error: 'session not found: ' + sid })

            if (sub === 'events') {
              res.writeHead(200, {
                'content-type': 'text/event-stream; charset=utf-8',
                'cache-control': 'no-cache',
                connection: 'keep-alive',
                'access-control-allow-origin': '*',
              })
              res.write(`data: ${JSON.stringify({ type: 'hello', sessionId: sid, transcript: rec.transcript, partial: rec.partial ?? '' })}\n\n`)
              activeSse.add(res)
              const off = sessions.on(sid, (ev) => {
                try {
                  res.write(`data: ${JSON.stringify(ev)}\n\n`)
                } catch {
                  /* 客户端已断开 */
                }
              })
              const cleanup = (): void => {
                off()
                activeSse.delete(res)
                try {
                  res.end()
                } catch {
                  /* ignore */
                }
              }
              req.on('close', cleanup)
              return
            }

            if (sub === 'audio' || sub === 'markdown') {
              const arts = resolveArtifacts(sessions, sid, streamPathFor)
              const slot = sub === 'audio' ? arts?.audio : arts?.markdown
              if (!slot?.present) return sendJson(res, 404, { ok: false, error: `${sub} 尚未产出` })
              return serveFile(res, req, slot.ref, contentTypeOf(sub, slot.ref))
            }

            const arts = resolveArtifacts(sessions, sid, streamPathFor)
            return sendJson(res, 200, {
              ok: true,
              session: rec,
              artifacts: arts,
              completeness: completenessOf(rec),
              // 这条录音被流转给 LLM 的历史（「录音内容」页据此显示标记）
              flows: flowsFor(outDir, sid),
              // Agent 关联进来的纪要
              notes: listNotes(outDir, sid),
            })
          }
          return sendJson(res, 404, { ok: false, error: 'unknown GET ' + pathname })
        }

        // ───────────────── POST ─────────────────
        const body = JSON.parse((await readBody(req)).toString('utf8') || '{}') as Record<string, any>

        if (isRecorder && pathname === '/api/recorder/config') {
          const allowed: (keyof RuntimeConfig)[] = [
            'asrModel', 'asrDevice', 'asrVad', 'asrPunc', 'asrSpk', 'language',
            'funasrPythonPath', 'funasrModelDir', 'streamChunkMs',
            'opusPreferred', 'bleAutoSync', 'bleSyncDeleteAfter', 'markdownEnabled', 'keepAudio',
            'autoTitle', 'titleMaxChars', 'postProcess',
          ]
          const changed: string[] = []
          // 记下切换前的预设：累积 enabled 时要先把它算进去。
          // 否则「paraformer → sensevoice」会把 paraformer 从集合里丢掉，
          // 而它其实还在用（环境还装着）—— 引用计数的前提就不成立了。
          const prevModel = runtime.asrModel
          for (const k of allowed) {
            if (body[k] === undefined) continue
            if (k === 'postProcess') {
              // **只接受白名单内的字段，合并而不是覆盖。**
              //
              // 曾经出过一个正反馈循环：客户端把 pp.config 整个展开发送，
              // 一旦 postProcess 里被塞进整个配置，/post-process 返回的 config
              // 就是整个配置，客户端再展开 → 每点一次开关就深一层，
              // 最终 postProcess 里嵌套了整份 RuntimeConfig。
              // 所以这里必须**按字段白名单**取值，多一个键都不收。
              const raw = (body.postProcess ?? {}) as Record<string, unknown>
              const clean: Record<string, unknown> = {}
              for (const pk of ['enabled', 'templateId', 'conversationId', 'mode'] as const) {
                if (raw[pk] !== undefined) clean[pk] = raw[pk]
              }
              runtime.postProcess = {
                ...runtime.postProcess,
                ...clean,
              } as RuntimeConfig['postProcess']
            } else {
              ;(runtime as unknown as Record<string, unknown>)[k] = body[k]
            }
            changed.push(k)
          }

          // 切换预设 = 用户想要它 → 加进「还想要的预设」集合。
          // 这个集合是卸载时按引用计数回收共用组件的依据：
          // 组件被 A、B 共用，卸 A 时保留（B 还要），再卸 B 才真正删除。
          if (changed.includes('asrModel')) {
            const before = normalizeEnabledPresets(runtime.enabledPresets, prevModel)
            runtime.enabledPresets = normalizeEnabledPresets([...before, runtime.asrModel], runtime.asrModel)
            changed.push('enabledPresets')
          }
          if (changed.length) {
            saveRuntime()
            cachedReadiness = null
            log('运行时配置已更新:', changed.join(','))
          }
          return sendJson(res, 200, { ok: true, config: runtime, changed })
        }

        // 批量删除：逐条走同一个 remove，好让「总结归档 / 占用中失败」的语义完全一致。
        // 单条失败不中断其余，最后把失败清单原样报回去。
        if (isRecorder && pathname === '/api/recorder/sessions/delete') {
          const ids = Array.isArray(body.ids) ? (body.ids as unknown[]).map(String) : []
          if (ids.length === 0) return sendJson(res, 400, { ok: false, error: 'ids 为空' })
          if (ids.length > 500) return sendJson(res, 400, { ok: false, error: '一次最多删 500 条' })
          const deleted: string[] = []
          const failed: Array<{ id: string; error: string }> = []
          const summaries: string[] = []
          let freedBytes = 0
          for (const id of ids) {
            if (!isValidSessionId(id)) {
              failed.push({ id, error: '非法 session id' })
              continue
            }
            if (live && live.sessionId === id) await finalizeLive('批量删除会话')
            const r = sessions.remove(id)
            if (!r.ok) {
              failed.push({ id, error: r.error ?? '删除失败' })
              continue
            }
            deleted.push(id)
            freedBytes += r.freedBytes
            if (r.archivedSummary) summaries.push(r.archivedSummary)
          }
          log(
            `批量删除：成功 ${deleted.length} / 失败 ${failed.length}，释放 ${freedBytes} 字节` +
              `${summaries.length ? `，归档 LLM 总结 ${summaries.length} 份` : ''}`,
          )
          return sendJson(res, 200, {
            ok: true,
            deleted,
            failed,
            freedBytes,
            archivedSummaries: summaries,
            items: sessions.list(),
          })
        }

        // 记入一份 LLM 总结。汇总层回归后由它调用；带 title 时同时接管录音命名。
        // 有 summary 的会话，删除时总结会被归档到 summaries/ 而不是丢掉。
        if (isRecorder && pathname === '/api/recorder/summary') {
          const sid = String(body.sessionId ?? '')
          if (!isValidSessionId(sid)) return sendJson(res, 400, { ok: false, error: '非法 session id' })
          const rec = sessions.setSummary(sid, String(body.text ?? ''), body.title ? String(body.title) : undefined)
          if (!rec) return sendJson(res, 404, { ok: false, error: 'session not found: ' + sid })
          refreshMarkdown(sid)
          log(`已记入 LLM 总结 session=${sid}（${rec.summary?.text.length ?? 0} 字${rec.summary?.title ? `，标题「${rec.summary.title}」` : ''}）`)
          return sendJson(res, 200, { ok: true, session: sessions.get(sid) ?? rec })
        }

        // 改标题：会把磁盘上的音频与 Markdown 一起改名。
        // source 默认 user；将来 LLM 汇总层回归后传 'llm' 即可，且不会被自动标题覆盖。
        if (isRecorder && pathname === '/api/recorder/title') {
          const sid = String(body.sessionId ?? '')
          const title = String(body.title ?? '')
          const source = body.source === 'llm' || body.source === 'auto' ? body.source : 'user'
          if (!title.trim()) return sendJson(res, 400, { ok: false, error: '标题不能为空' })
          const rec = sessions.setTitle(sid, title, source)
          if (!rec) return sendJson(res, 404, { ok: false, error: 'session not found: ' + sid })
          refreshMarkdown(sid)
          const fresh = sessions.get(sid) ?? rec
          log(`标题改为「${fresh.title}」（来源 ${fresh.titleSource}）`)
          return sendJson(res, 200, {
            ok: true,
            session: fresh,
            artifacts: resolveArtifacts(sessions, sid, streamPathFor),
          })
        }

          // 保存 / 更新一个用户提示词模板
          if (isRecorder && pathname === '/api/recorder/post-process/template') {
            const tpl = normalizeTemplate(body.template ?? body)
            if (tpl === null) {
              return sendJson(res, 400, {
                ok: false,
                error: '模板无效：需要 name 与 body，且 id 不能与内置模板重名（可先「另存为」）',
              })
            }
            // 没给 id（新建）就生成一个；给了 id 就是更新那一份
            const id = tpl.id || templateIdFrom(tpl.name)
            const next = { ...tpl, id }
            const i = userTemplates.findIndex((x) => x.id === id)
            if (i >= 0) userTemplates[i] = next
            else userTemplates.push(next)
            saveTemplates()
            log('提示词模板已保存:', id, next.name)
            return sendJson(res, 200, { ok: true, template: next, templates: allTemplates(userTemplates) })
          }

          // 删除一个用户模板（内置模板不允许删除）
          if (isRecorder && pathname === '/api/recorder/post-process/template/delete') {
            const id = String(body.id ?? '')
            if (userTemplates.every((x) => x.id !== id)) {
              return sendJson(res, 400, { ok: false, error: '找不到该自定义模板（内置模板不可删除）' })
            }
            userTemplates = userTemplates.filter((x) => x.id !== id)
            saveTemplates()
            // 选中被删的模板时回落到内置默认
            if (runtime.postProcess.templateId === id) {
              runtime.postProcess.templateId = 'meeting-notes'
              saveRuntime()
            }
            return sendJson(res, 200, { ok: true, templates: allTemplates(userTemplates) })
          }

          // 后处理：确认发出 / 丢弃
          if (isRecorder && pathname === '/api/recorder/post-process/resolve') {
            if (pendingQueue.length === 0) return sendJson(res, 400, { ok: false, error: '没有待确认的后处理消息' })
            if (body.action === 'discard') {
              pendingQueue.shift()
              return sendJson(res, 200, { ok: true, discarded: true })
            }
            const cur = pendingQueue[0]
            try {
              const sid = await resolveTargetSession()
              await sendPostMessage(sid, cur.text)
              for (const it of cur.items) {
                markFlowed(outDir, {
                  sessionId: it.sessionId,
                  kind: 'summary',
                  targetSessionId: sid,
                  at: new Date().toISOString(),
                  templateId: cur.templateId,
                  batchSize: cur.items.length,
                })
              }
              pendingQueue.shift()
              log(`后处理：已把 ${cur.items.length} 条录音的合并消息发到会话 ${sid}`)
              return sendJson(res, 200, { ok: true, sessionId: sid })
            } catch (e) {
              return sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) })
            }
          }
          // 后处理用：新建一个会话（「转向对话」选"新建对话"时用）
          if (isRecorder && pathname === '/api/recorder/dsh/sessions/create') {
            const sc = ctx.get('sessionController') as
              | { create: (req: unknown) => Promise<{ sessionId: string }> }
              | undefined
            if (sc === undefined) return sendJson(res, 503, { ok: false, error: '内核未提供 sessionController' })
            try {
              const v = await sc.create({ cwd: typeof body.cwd === 'string' ? body.cwd : undefined })
              return sendJson(res, 200, { ok: true, sessionId: v.sessionId })
            } catch (e) {
              return sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) })
            }
          }

          // 后处理用：往指定会话发一条消息（这就是「直接往那个会话发消息」）
          if (isRecorder && pathname === '/api/recorder/dsh/send') {
            const sc = ctx.get('sessionController') as
              | {
                  prompt: (
                    req: unknown,
                    signal: AbortSignal,
                  ) => Promise<{ accepted: boolean }>
                }
              | undefined
            if (sc === undefined) return sendJson(res, 503, { ok: false, error: '内核未提供 sessionController' })
            const sessionId = String(body.sessionId ?? '')
            const text = String(body.text ?? '')
            if (!sessionId || !text) return sendJson(res, 400, { ok: false, error: 'sessionId 与 text 必填' })
            try {
              const ac = new AbortController()
              await sc.prompt(
                {
                  // requestId 是幂等标识：同一个 id 重复投递不会被接受两次
                  requestId: `rec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
                  sessionId,
                  mode: body.mode === 'steer' ? 'steer' : 'queue',
                  content: [{ type: 'text', text }],
                },
                ac.signal,
              )
              log('已向后处理会话发送消息:', sessionId)
              return sendJson(res, 200, { ok: true, sessionId })
            } catch (e) {
              return sendJson(res, 500, {
                ok: false,
                error: `发送失败：${e instanceof Error ? e.message : String(e)}`,
              })
            }
          }
          // 投放：把选中的录音（转写原文 / Markdown / 纪要）按选定模板发给一个对话
          if (isRecorder && pathname === '/api/recorder/deliver') {
            const ids = Array.isArray(body.sessionIds) ? (body.sessionIds as string[]) : []
            const format = String(body.format ?? 'transcript') as 'transcript' | 'markdown' | 'notes'
            if (ids.length === 0) return sendJson(res, 400, { ok: false, error: '没有选中任何录音' })

            const tpl = allTemplates(userTemplates).find((x) => x.id === String(body.templateId ?? ''))
            if (tpl === undefined) return sendJson(res, 400, { ok: false, error: '找不到该提示词模板' })

            // 逐条取内容。取不到内容的条目跳过而不是让整次投放失败 ——
            // 用户多选时很可能混进一条没有转写的，不该因此全发不出去。
            const picked: Array<{ id: string; title: string; text: string; kind: string }> = []
            const skipped: string[] = []
            for (const id of ids) {
              const rec = sessions.get(id)
              if (rec === undefined) {
                skipped.push(`${id}（找不到）`)
                continue
              }
              if (format === 'notes') {
                const docs = listNotes(outDir, id)
                const parts: string[] = []
                for (const doc of docs) {
                  const text = readNote(doc.path, outDir)
                  if (text !== null) parts.push(`### ${doc.title}\n\n${text}`)
                }
                if (parts.length === 0) {
                  skipped.push(`${rec.title}（没有纪要）`)
                  continue
                }
                picked.push({ id, title: rec.title ?? id, text: parts.join('\n\n---\n\n'), kind: '纪要' })
              } else if (format === 'markdown') {
                const md = readNote(join(sessions.dirOf(id), `${rec.title}.md`), sessions.dirOf(id))
                if (md === null) {
                  skipped.push(`${rec.title}（没有 Markdown 文档）`)
                  continue
                }
                picked.push({ id, title: rec.title ?? id, text: md, kind: 'Markdown 文档' })
              } else {
                const text = (rec.transcript ?? '').trim()
                if (!text) {
                  skipped.push(`${rec.title}（没有转写原文）`)
                  continue
                }
                picked.push({ id, title: rec.title ?? id, text, kind: '转写原文' })
              }
            }
            if (picked.length === 0) {
              return sendJson(res, 400, {
                ok: false,
                error: `选中的内容都取不到：${skipped.join('、')}`,
              })
            }

            // 多选 = 拼接成一条（用户明确要求）
            const body2 = picked
              .map((p) => `## ${p.title}\n\n录音会话 id：${p.id}\n\n${p.text}`)
              .join('\n\n---\n\n')
            const head =
              picked.length === 1
                ? `以下是「${picked[0].title}」的${picked[0].kind}：`
                : `以下是从录音卡选出的 ${picked.length} 条录音（各自的${picked[0].kind}）：`
            const text = `${tpl.body}\n\n---\n\n${head}\n\n${body2}`

            // 目标对话：给了就用，没给就用最近活跃的那个
            // 优先用**真正打开着**的会话；只有它还没被上报过时才退回启发式。
            let sid = String(body.targetSessionId ?? '') || (openSessionId ?? '')
            if (!sid) {
              try {
                const sc = ctx.get('sessionController') as
                  | { list: (req: unknown, signal: AbortSignal) => Promise<{ items: unknown[] }> }
                  | undefined
                if (sc !== undefined) {
                  const v = await sc.list({}, new AbortController().signal)
                  const rows = (v.items ?? []) as Array<{
                    sessionId: string
                    updatedAt?: number
                    parentSessionId?: string | null
                    origin?: string | null
                  }>
                  // 排除子会话：后台 subagent 的 updatedAt 可能比用户正开着的
                  // 对话更新，会把目标抢走 —— 那样用户就看不到自己投放的东西了。
                  const own = rows.filter((x) => !x.parentSessionId && x.origin !== 'subagent')
                  const pool = own.length > 0 ? own : rows
                  const best = pool.slice().sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0]
                  if (best) sid = best.sessionId
                }
              } catch {
                /* 取不到就让下面报错 */
              }
            }
            if (!sid) return sendJson(res, 400, { ok: false, error: '无法确定目标对话' })

            try {
              await sendPostMessage(sid, text)
            } catch (e) {
              return sendJson(res, 500, {
                ok: false,
                error: `投放失败：${e instanceof Error ? e.message : String(e)}`,
              })
            }
            for (const p of picked) {
              markFlowed(outDir, {
                sessionId: p.id,
                kind: 'deliver',
                targetSessionId: sid,
                at: new Date().toISOString(),
                templateId: tpl.id,
                batchSize: picked.length,
              })
            }
            log(`投放：${picked.length} 条录音 → 会话 ${sid}（模板「${tpl.name}」，格式 ${format}）`)
            return sendJson(res, 200, { ok: true, sessionId: sid, sent: picked.length, skipped })
          }
          // 前端上报「当前打开的会话」
          if (isRecorder && pathname === '/api/recorder/session/open') {
            const sid = String(body.sessionId ?? '')
            if (sid) {
              if (openSessionId !== sid) log('当前打开的会话变更:', sid)
              openSessionId = sid
            }
            return sendJson(res, 200, { ok: true })
          }
          // 前端上报实际挂载路径（诊断回退是否生效）
          if (isRecorder && pathname === '/api/recorder/ui-surface') {
            lastUiSurface = {
              at: new Date().toISOString(),
              surface: String(body.surface ?? ''),
              hasWorkbench: body.hasWorkbench === true,
              hasTabs: body.hasTabs === true,
              hasSlots: body.hasSlots === true,
            }
            log('前端挂载路径:', JSON.stringify(lastUiSurface))
            return sendJson(res, 200, { ok: true })
          }
          // 卸载一个**预设**：按引用计数回收它独占的组件。
          // 共用组件只有在所有想要它的预设都被卸掉后才会消失。
          if (isRecorder && pathname === '/api/recorder/env/uninstall-preset') {
            const presetId = String(body.presetId ?? '')
            if (presetById(presetId) === undefined) {
              return sendJson(res, 400, { ok: false, error: `未知预设: ${presetId}` })
            }
            const active = String(runtime.asrModel ?? 'paraformer-zh')
            const enabled = normalizeEnabledPresets(runtime.enabledPresets, active)
            const r = await uninstallPreset({
              presetId,
              enabled,
              paths: {
                basePython: funasrPython ?? 'python',
                funasrModelDir: runtime.funasrModelDir || join(outDir, 'funasr'),
                qwenVenvDir: join(outDir, 'qwen-venv'),
                qwenModelDir: qwenDir,
                qwenModelName: config.qwenModelName,
              },
              funasrPkgOk: cachedReadiness === null ? false : cachedReadiness.funasrInstalled === true,
              run: (cmd, args, timeoutMs) =>
                new Promise((resolve) => {
                  execFile(
                    cmd,
                    args,
                    { timeout: timeoutMs, env: spawnEnv(undefined, runtime.proxyUrl || undefined), maxBuffer: 8 << 20 },
                    (err, stdout, stderr) => resolve({ code: err ? 1 : 0, out: `${stdout ?? ''}\n${stderr ?? ''}` }),
                  )
                }),
              log: (m, ...rest) => log(m, ...rest),
            })
            // 记住「用户不再想要这个预设了」
            runtime.enabledPresets = r.enabledAfter
            // 如果卸的正是当前激活的，切到仍保留的第一个（没有就保持原值，界面会提示）
            if (runtime.asrModel === presetId && r.enabledAfter.length > 0) {
              runtime.asrModel = r.enabledAfter[0] as RuntimeConfig['asrModel']
            }
            saveRuntime()
            cachedReadiness = null
            qwenCheckCache = null
            invalidateSizeCache()
            if (!r.ok) return sendJson(res, 400, { ok: false, error: r.error ?? r.message, result: r })
            return sendJson(res, 200, { ok: true, result: r })
          }
          // 卸载某个环境组件（共享组件会被 planUninstall 拦下）
          if (isRecorder && pathname === '/api/recorder/env/uninstall') {
            const key = String(body.key ?? '') as EnvKey
            if (!(key in ENV_COMPONENTS)) {
              return sendJson(res, 400, { ok: false, error: `未知环境组件: ${key}` })
            }
            const active = String(runtime.asrModel ?? 'paraformer-zh')
            const r = await uninstallEnv({
              key,
              paths: {
                basePython: funasrPython ?? 'python',
                funasrModelDir: runtime.funasrModelDir || join(outDir, 'funasr'),
                qwenVenvDir: join(outDir, 'qwen-venv'),
                qwenModelDir: qwenDir,
                qwenModelName: config.qwenModelName,
              },
              activePresetId: active,
              funasrPkgOk: cachedReadiness === null ? false : cachedReadiness.funasrInstalled === true,
              run: (cmd, args, timeoutMs) =>
                new Promise((resolve) => {
                  execFile(
                    cmd,
                    args,
                    { timeout: timeoutMs, env: spawnEnv(undefined, runtime.proxyUrl || undefined), maxBuffer: 8 << 20 },
                    (err, stdout, stderr) => {
                      resolve({ code: err ? 1 : 0, out: `${stdout ?? ''}\n${stderr ?? ''}` })
                    },
                  )
                }),
              log: (m, ...rest) => log(m, ...rest),
            })
            // 卸载后环境肯定变了，缓存作废
            cachedReadiness = null
            qwenCheckCache = null
            invalidateSizeCache()
            if (!r.ok) return sendJson(res, 400, { ok: false, error: r.error ?? r.message, result: r })
            return sendJson(res, 200, { ok: true, result: r })
          }

        if (isRecorder && pathname === '/api/recorder/asr/install') {
          const wantModel = String(body.model ?? runtime.asrModel)
          // Qwen3 走独立 venv，必须由宿主先建好环境（worker 自己要靠它才能启动）
          if (wantModel === 'qwen3-asr' || body.withQwen === true) {
            const qr = await installQwen({
              basePython: funasrPython ?? blePython ?? 'python',
              outDir,
              modelDir: qwenDir,
              modelName: config.qwenModelName,
              pipIndex: typeof body.pipIndex === 'string' ? body.pipIndex : 'https://pypi.tuna.tsinghua.edu.cn/simple',
              proxyUrl: runtime.proxyUrl || undefined,
              log,
              onProgress: (stage, message) => log(`[安装 ${stage}] ${message}`),
            })
            if (!qr.ok) {
              return sendJson(res, 500, { ok: false, error: qr.error, steps: qr.steps })
            }
            cachedQwenStatus = { ok: true, at: new Date().toISOString(), modelPath: qr.modelPath }
            // 装完 Qwen 直接返回，**不去动 FunASR 的环境**。
            //
            // 之前这里会继续调 installFunasr，而它执行的是
            // `pip install -U funasr modelscope torch torchaudio` —— 那会把系统 python 的
            // modelscope 升到 1.40.1 却留下旧的 modelscope-hub，导致
            // `cannot import name 'DEFAULT_CREDENTIALS_PATH' from 'modelscope_hub.compat.constants'`，
            // **整个 FunASR 识别随之失效**（而且 readiness 只查目录存在性，还会显示成"全部就绪"的假绿）。
            // Qwen 只需要 FunASR 的 cam++ 出说话人时段，那些模型本来就已经在本地了。
            const qStatus = await readiness(true).catch(() => null)
            if (qStatus) cachedReadiness = qStatus
            return sendJson(res, 200, { ok: true, status: cachedReadiness, qwen: cachedQwenStatus })
          }
          await funasrWorker.ensureStarted()
          const r = await installFunasr(funasrWorker, {
            // qwen 模式下 FunASR 只当分离前端，装它自己那套 paraformer 即可
            device: (body.device as 'auto' | 'cpu' | 'cuda') ?? runtime.asrDevice,
            model: wantModel === 'qwen3-asr' ? 'paraformer-zh' : wantModel,
          })
          cachedReadiness = r
          return sendJson(res, 200, { ok: true, status: r, qwen: cachedQwenStatus })
        }

        if (isRecorder && pathname === '/api/recorder/session') {
          const rec = sessions.open({
            id: typeof body.sessionId === 'string' ? body.sessionId : undefined,
            source: 'realtime',
            language: typeof body.language === 'string' ? body.language : runtime.language,
          })
          return sendJson(res, 200, { ok: true, session: sessions.get(rec.id) })
        }

        // 上传音频 → 离线识别 → 三件套
        if (isRecorder && (pathname === '/api/recorder/audio' || pathname === '/api/qs668/transcribe')) {
          const hintRaw = String(body.ext ?? body.codec ?? 'auto').toLowerCase()
          const hint: AudioHint = hintRaw === 'opus' || hintRaw === 'ogg' || hintRaw === 'wav' ? hintRaw : 'auto'
          const out = await recognize({
            bytes: b64ToBytes(body.audioBase64 ?? body.audio),
            hint,
            source: 'upload',
            sessionId: typeof body.sessionId === 'string' ? body.sessionId : undefined,
            language: typeof body.language === 'string' ? body.language : undefined,
          })
          // 厂商测试页兼容：返回 text/segments
          return sendJson(res, 200, {
            ok: true,
            sessionId: out.sessionId,
            text: out.text,
            segments: out.segments,
            durationMs: out.durationMs,
            model: out.model,
            device: out.device,
            markdown: out.markdownPath,
            audio: out.audioPath,
          })
        }

        if (isRecorder && pathname === '/api/recorder/batch') {
          const items = Array.isArray(body.items) ? (body.items as Record<string, unknown>[]) : []
          if (!items.length) return sendJson(res, 400, { ok: false, error: 'items 为空' })
          const results: unknown[] = []
          for (const item of items) {
            try {
              const out = await recognize({
                bytes: b64ToBytes(item.audioBase64),
                hint: (String(item.ext ?? 'auto').toLowerCase() as AudioHint) ?? 'auto',
                source: 'upload',
                language: typeof item.language === 'string' ? item.language : undefined,
              })
              results.push({ name: item.name, ok: true, sessionId: out.sessionId, text: out.text })
            } catch (e) {
              results.push({ name: item.name, ok: false, error: e instanceof Error ? e.message : String(e) })
            }
          }
          return sendJson(res, 200, { ok: true, results })
        }

        // ── BLE 直连 ──
        if (isRecorder && pathname === '/api/recorder/ble/setup') {
          const st = await ensureBle()
          return sendJson(res, st.ok ? 200 : 500, { ok: st.ok, error: st.error ?? null, python: ble.python, bleak: ble.bleakVersion })
        }
        if (isRecorder && pathname === '/api/recorder/ble/scan') {
          const st = await ensureBle()
          if (!st.ok) return sendJson(res, 500, { ok: false, error: st.error })
          const action = String(body.action ?? 'start')
          if (action === 'stop') {
            stopScan('已停止扫描')
            return sendJson(res, 200, { ok: true, scan: scanState })
          }
          if (scanState.running) return sendJson(res, 200, { ok: true, scan: scanState, note: '已在扫描中' })
          const roundMs = typeof body.roundMs === 'number' ? Math.max(1000, Math.min(20000, body.roundMs)) : 3000
          const timeoutMs = typeof body.timeoutMs === 'number' ? Math.max(0, body.timeoutMs) : 120000
          const autoConnect = body.autoConnect !== false
          // 立刻返回，让按钮马上切换到「停止扫描」；设备列表通过 /ble/status 轮询长出来
          void scanLoop({ roundMs, autoConnect, timeoutMs })
          log(`开始扫描设备（每轮 ${roundMs}ms，自动连接${autoConnect ? '开' : '关'}）`)
          return sendJson(res, 200, { ok: true, scan: scanState })
        }
        if (isRecorder && pathname === '/api/recorder/ble/known') {
          if (body.forget) {
            const removed = knownDevices.forget(String(body.forget))
            return sendJson(res, 200, { ok: true, removed, items: knownDevices.list() })
          }
          return sendJson(res, 200, { ok: true, items: knownDevices.list() })
        }
        if (isRecorder && pathname === '/api/recorder/ble/connect') {
          const st = await ensureBle()
          if (!st.ok) return sendJson(res, 500, { ok: false, error: st.error })
          if (typeof body.address !== 'string' || !body.address) return sendJson(res, 400, { ok: false, error: '缺少 address' })
          stopScan() // 手动连接即接管，扫描循环让位，免得两边抢适配器
          const dev = scanState.devices.find((d) => d.address === body.address)
          return sendJson(res, 200, {
            ok: true,
            ...(await connectAndRemember(body.address, typeof body.retries === 'number' ? body.retries : 5, dev)),
          })
        }
        if (isRecorder && pathname === '/api/recorder/ble/disconnect') {
          await ble.disconnect()
          await finalizeLive('手动断开')
          return sendJson(res, 200, { ok: true })
        }
        if (isRecorder && pathname === '/api/recorder/ble/battery') {
          return sendJson(res, 200, { ok: true, level: await ble.queryBattery() })
        }
        if (isRecorder && pathname === '/api/recorder/ble/timesync') {
          await ble.timesync()
          return sendJson(res, 200, { ok: true, synced: true })
        }
        if (isRecorder && pathname === '/api/recorder/ble/delete') {
          const st = await ensureBle()
          if (!st.ok) return sendJson(res, 500, { ok: false, error: st.error })
          if (typeof body.name !== 'string' || !body.name.trim()) {
            return sendJson(res, 400, { ok: false, error: '缺少 name' })
          }
          // 删不掉会抛异常（守护进程会核对回执并重拉列表确认），不会假报成功
          const r = await ble.deleteFile(
            body.name.trim(),
            typeof body.time === 'number' ? body.time : 0,
            typeof body.size === 'number' ? body.size : 0,
            typeof body.raw === 'string' ? body.raw : undefined,
          )
          log(`已删除设备文件 ${body.name}（payload=${String(r.format ?? '?')}，核对=${String(r.verified ?? '?')}）`)
          return sendJson(res, 200, { ok: true, ...r })
        }
        if (isRecorder && pathname === '/api/recorder/ble/download') {
          const st = await ensureBle()
          if (!st.ok) return sendJson(res, 500, { ok: false, error: st.error })
          if (typeof body.name !== 'string' || !body.name.trim()) return sendJson(res, 400, { ok: false, error: '缺少 name' })
          const dl = await ble.download(body.name.trim(), {
            prefer: downloadPrefer(),
            // 分片/offset 续传参数：断点续传探测与实现都走这里
            chunkBytes: typeof body.chunkBytes === 'number' ? body.chunkBytes : undefined,
            chunkTime: typeof body.chunkTime === 'number' ? body.chunkTime : undefined,
          })
          const out = await recognize({
            bytes: b64ToBytes(dl.data),
            hint: dl.ext === 'wav' ? 'wav' : 'opus',
            source: 'file',
            deviceFile: dl.name,
            recordedAt: deviceFileTime(dl.name)?.toISOString(),
            device: { address: ble.address ?? undefined },
            language: typeof body.language === 'string' ? body.language : undefined,
          })
          return sendJson(res, 200, {
            ok: true,
            file: { name: dl.name, ext: dl.ext, size: dl.size, chunks: dl.chunks ?? 1 },
            ...out,
          })
        }
        if (isRecorder && pathname === '/api/recorder/ble/realtime') {
          const st = await ensureBle()
          if (!st.ok) return sendJson(res, 500, { ok: false, error: st.error })
          const action = String(body.action ?? '')
          if (action === 'start') {
            if (live) return sendJson(res, 409, { ok: false, error: '已有实时转写在运行: ' + live.sessionId })
            const rec = sessions.open({
              id: typeof body.sessionId === 'string' ? body.sessionId : undefined,
              source: 'realtime',
              language: typeof body.language === 'string' ? body.language : runtime.language,
              device: { address: ble.address ?? undefined },
            })
            await engine.openStream(rec.id)
            live = { sessionId: rec.id, chunks: [], buffered: 0, total: 0, feeding: false, archiveChunks: [], closed: false }
            try {
              await ble.realtime('start', {
                windowMs: typeof body.windowMs === 'number' ? body.windowMs : 1000,
              })
            } catch (e) {
              await finalizeLive('启动失败')
              throw e
            }
            return sendJson(res, 200, { ok: true, live: true, sessionId: rec.id, events: streamPathFor(rec.id) })
          }
          if (action === 'stop') {
            await ble.realtime('stop').catch((e) => log('发送 stop 失败:', String(e)))
            const sid = live?.sessionId ?? null
            await finalizeLive('手动停止')
            return sendJson(res, 200, { ok: true, live: false, sessionId: sid })
          }
          if (action === 'pause' || action === 'resume') {
            await ble.realtime(action)
            return sendJson(res, 200, { ok: true, action })
          }
          return sendJson(res, 400, { ok: false, error: 'action 需为 start|stop|pause|resume' })
        }
        if (isRecorder && pathname === '/api/recorder/ble/sync') {
          const st = await ensureBle()
          if (!st.ok) return sendJson(res, 500, { ok: false, error: st.error })
          const result = await runSync({
            deleteAfter: typeof body.deleteAfter === 'boolean' ? body.deleteAfter : undefined,
            force: typeof body.force === 'boolean' ? body.force : undefined,
          })
          return sendJson(res, 200, { ok: true, sync: result, lastSyncAt: syncState.lastSyncAt })
        }

        return sendJson(res, 404, { ok: false, error: 'unknown POST ' + pathname })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        log('路由错误', pathname, msg)
        return sendJson(res, 500, { ok: false, error: msg })
      }
    }

    // ── 交给 Agent 的工具：把整理好的纪要关联回录音 ──
    //
    // 为什么要做成工具而不是让 Agent 自己写文件：
    // 「纪要查看」页要能稳定读到，就必须有约定好的落点。Agent 自己挑路径的话，
    // 它可能写到工作目录、可能写到别处，页面无从得知。工具负责把产出**收拢到
    // 固定路径**并回报真实位置，这样 Agent 写的东西一定能被看到。
    const disposeAttachNotes = ctx.effect(() => {
      const tools = ctx.get('tools') as
        | { register: (def: Record<string, unknown>) => () => void }
        | undefined
      if (tools === undefined) return () => {}
      return tools.register({
        name: 'recorder_attach_notes',
        description:
          '把整理好的纪要 Markdown 关联到某条录音卡的录音上。调用后这份文档会出现在录音卡面板的「纪要查看」页。' +
          '一条录音可以关联多份文档（例如同一段录音里讲了多个主题，分别产出多份纪要）。' +
          '标题相同会覆盖上一份。',
        parameters: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: '录音的会话 id，形如 session-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx。在录音内容里会给出。',
            },
            title: { type: 'string', description: '这份纪要的标题，同时用作文件名。' },
            markdown: { type: 'string', description: '纪要正文，Markdown 格式。' },
          },
          required: ['sessionId', 'title', 'markdown'],
          additionalProperties: false,
        },
        output: {
          schema: {
            type: 'object',
            properties: {
              ok: { type: 'boolean' },
              sessionId: { type: 'string' },
              title: { type: 'string' },
              path: { type: 'string' },
            },
            required: ['ok', 'sessionId', 'title', 'path'],
          },
          render(_args: unknown, value: unknown): Array<{ type: 'text'; text: string }> {
            const v = value as { title?: string; path?: string }
            return [{ type: 'text', text: `已关联纪要「${v.title ?? ''}」→ ${v.path ?? ''}` }]
          },
        },
        async execute(args: unknown): Promise<Record<string, unknown>> {
          const a = args as { sessionId?: string; title?: string; markdown?: string }
          if (!a.sessionId || !a.title || !a.markdown) {
            throw new Error('sessionId / title / markdown 三个参数都必填')
          }
          const r = saveNote(outDir, a.sessionId, a.title, a.markdown)
          if (!r.ok) throw new Error(r.error)
          log(`纪要已关联到录音 ${a.sessionId}：「${r.doc.title}」→ ${r.doc.path}`)
          return { ok: true, sessionId: a.sessionId, title: r.doc.title, path: r.doc.path }
        },
      })
    })

    const disposeRecorder = ctx.webServer.register({ kind: 'prefix', path: '/api/recorder', handler })
    const disposeQs668 = ctx.webServer.register({ kind: 'prefix', path: '/api/qs668', handler })
    log(`已挂载 /api/recorder, /api/qs668（outDir=${outDir}，python=${funasrPython ?? '未探测到'}）`)
    // 后台预热就绪探测（不阻塞加载）
    void readiness().catch((e) => log('就绪探测失败:', String(e)))

    // 给历史会话补标题并改名（老数据没有 title 字段）。放后台，不拖慢插件加载。
    if (runtime.autoTitle) {
      setTimeout(() => {
        try {
          const n = sessions.backfillTitles(runtime.titleMaxChars)
          if (n > 0) {
            // 补完标题再重写一遍 Markdown：正文 H1 与 front matter 里都带标题
            for (const row of sessions.list()) refreshMarkdown(row.id)
            log(`历史会话补标题并改名：${n} 条（Markdown 已同步重写）`)
          }
        } catch (e) {
          log('历史会话补标题失败（忽略）:', String(e))
        }
      }, 1500)
    }

    // 修正离线同步会话的录制时间：早期版本误把「同步时刻」当成了录制时间，
    // 导致一卡旧录音全显示成刚刚。录制时间就在设备文件名里。
    setTimeout(() => {
      try {
        let fixed = 0
        for (const row of sessions.list()) {
          const rec = sessions.get(row.id)
          if (!rec || rec.source !== 'file' || !rec.deviceFile) continue
          const t = deviceFileTime(rec.deviceFile)
          if (!t) continue
          const prev = new Date(rec.createdAt).getTime()
          if (Number.isFinite(prev) && Math.abs(prev - t.getTime()) < 60_000) continue // 已经是录制时间
          sessions.setRecordedAt(row.id, t.toISOString())
          // 没有转写文本的会话，兜底标题里也写着时间，得跟着录制时间一起改；
          // 有转写文本的标题取自内容，不受影响。
          if (!rec.transcript && rec.titleSource === 'auto') {
            sessions.setTitle(row.id, fallbackTitle(t.toISOString()), 'auto')
          }
          fixed += 1
        }
        if (fixed > 0) log(`修正离线录音的录制时间：${fixed} 条（取自设备文件名）`)
      } catch (e) {
        log('修正录制时间失败（忽略）:', String(e))
      }
    }, 1800)

    // 标题自愈：有转写文本却挂着「未转写 …」时间兜底名的，按内容重取。
    // 成因是取名发生在文本就位之前（或 maxChars 取到非法值让 deriveTitle 返回空串）。
    // 放在启动时跑，已有的坏标题也能自动恢复，不必重录。
    setTimeout(() => {
      try {
        let healed = 0
        for (const row of sessions.list()) {
          const before = sessions.get(row.id)?.title
          const after = sessions.refreshAutoTitle(row.id, runtime.titleMaxChars)
          if (after && after.title !== before) healed += 1
        }
        if (healed > 0) log(`标题自愈：${healed} 条（时间兜底名 → 按转写内容取名）`)
      } catch (e) {
        log('标题自愈失败（忽略）:', String(e))
      }
    }, 2200)

    return () => {
      disposeRecorder?.()
      disposeQs668?.()
      disposed = true
      stopScan('插件卸载，扫描已停止')
      void finalizeLive('插件卸载')
      ble.dispose()
      void funasrWorker.dispose()
      disposeSelfCleanup()
      for (const r of activeSse) {
        try {
          r.end()
        } catch {
          /* ignore */
        }
      }
      activeSse.clear()
      log('已卸载')
    }
  }, 'dsh-ai-recorder: api')
}
