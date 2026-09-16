/**
 * L3 识别层 · FunASR 引擎
 *
 * 两条识别路径，对应流程图里的「识别模式」分叉：
 *
 *   离线（离线模型）：VAD + ASR + 标点 + 说话人 → 完整转写结果
 *   实时（流式模型）：增量 Chunk 解码 → 实时逐字输出
 *
 * 两者都在 `scripts/funasr_worker.py` 里执行（模型只加载一次，常驻进程），这里只负责
 * 把音频喂进去、把增量文本接出来。
 *
 * 旧的 5 个 provider（mock / openai-compat / whisper-cpp-cli / faster-whisper-py /
 * qwen-audio-py）已全部移除。
 */
import type { PyWorker } from '../../py-worker.js'

export interface RecognizedSegment {
  /** 起始毫秒 */
  start: number
  /** 结束毫秒 */
  end: number
  text: string
  /** 说话人编号（0 起）；未启用说话人分离时为 undefined */
  speaker?: number
}

export interface OfflineResult {
  text: string
  segments: RecognizedSegment[]
  durationMs: number
  model: string
  device: string
  /** 说话人分离是否真的生效（cam++ 不可用时会为 false） */
  speakerApplied: boolean
}

export interface StreamFeedResult {
  /** 当前累计的完整文本（含未定稿部分） */
  partial: string
  /** 本轮新增的定稿分段 */
  segments: RecognizedSegment[]
}

export interface FunasrOptions {
  model: 'paraformer-zh' | 'sensevoice'
  device: 'auto' | 'cpu' | 'cuda'
  language: string
  vad: boolean
  punc: boolean
  spk: boolean
  modelDir: string
  streamChunkMs: number
  encoderLookBack: number
  decoderLookBack: number
}

export class FunasrNotReadyError extends Error {}

export class FunasrEngine {
  constructor(
    private readonly worker: PyWorker,
    private readonly getOptions: () => FunasrOptions,
    private readonly log: (...args: unknown[]) => void,
  ) {}

  /** 离线识别：完整音频文件 → VAD 断句 + ASR + 标点 + 说话人。 */
  async recognizeFile(wavPath: string): Promise<OfflineResult> {
    const o = this.getOptions()
    const r = await this.worker.request<{
      text: string
      segments: RecognizedSegment[]
      durationMs: number
      model: string
      device: string
      speakerApplied: boolean
    }>(
      'offline',
      {
        inputPath: wavPath,
        model: o.model,
        device: o.device,
        language: o.language,
        vad: o.vad,
        punc: o.punc,
        spk: o.spk,
        modelDir: o.modelDir,
      },
      30 * 60 * 1000,
    )
    return {
      text: String(r.text ?? ''),
      segments: Array.isArray(r.segments) ? r.segments : [],
      durationMs: Number(r.durationMs ?? 0),
      model: String(r.model ?? o.model),
      device: String(r.device ?? o.device),
      speakerApplied: r.speakerApplied === true,
    }
  }

  // ═══════════════ 实时流（增量 chunk 解码 → 逐字输出） ═══════════════

  /** 打开一条流式识别会话（worker 侧持有 online 模型的 cache）。 */
  async openStream(streamId: string): Promise<void> {
    const o = this.getOptions()
    await this.worker.request(
      'stream_open',
      {
        streamId,
        model: o.model,
        device: o.device,
        language: o.language,
        modelDir: o.modelDir,
        chunkMs: o.streamChunkMs,
        encoderLookBack: o.encoderLookBack,
        decoderLookBack: o.decoderLookBack,
        punc: o.punc,
      },
      5 * 60 * 1000,
    )
    this.log('流式识别已打开:', streamId)
  }

  /**
   * 喂一段裸 Opus 包流（设备推来的 40B/20ms），取回增量文本。
   * 解码在 worker 内完成，避免每段都落临时文件。
   */
  async feedStream(streamId: string, rawOpus: Uint8Array): Promise<StreamFeedResult> {
    const r = await this.worker.request<{ partial: string; segments: RecognizedSegment[] }>(
      'stream_feed',
      { streamId, opusB64: Buffer.from(rawOpus).toString('base64') },
      2 * 60 * 1000,
    )
    return {
      partial: String(r.partial ?? ''),
      segments: Array.isArray(r.segments) ? r.segments : [],
    }
  }

  /** 结束流式识别，取回终稿。 */
  async closeStream(streamId: string): Promise<OfflineResult> {
    const r = await this.worker.request<{
      text: string
      segments: RecognizedSegment[]
      durationMs: number
      model: string
      device: string
      speakerApplied: boolean
    }>('stream_close', { streamId }, 5 * 60 * 1000)
    this.log('流式识别已关闭:', streamId)
    return {
      text: String(r.text ?? ''),
      segments: Array.isArray(r.segments) ? r.segments : [],
      durationMs: Number(r.durationMs ?? 0),
      model: String(r.model ?? this.getOptions().model),
      device: String(r.device ?? this.getOptions().device),
      speakerApplied: r.speakerApplied === true,
    }
  }
}
