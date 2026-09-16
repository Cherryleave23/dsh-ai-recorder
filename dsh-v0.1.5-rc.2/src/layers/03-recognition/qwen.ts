/**
 * L3 识别层 · Qwen3-ASR 引擎（离线）
 *
 * ## 为什么长这样
 *
 * Qwen3-ASR 官方**没有说话人分离**（GitHub 全库搜 `diarization` 只有一条被关闭未合并的 PR
 * #116），`transcribe()` 默认也只回 `.text`，连时间戳都要另挂 Qwen3-ForcedAligner。
 *
 * 所以这里走「先分离、后识别」：
 *
 *   ① FunASR 的 cam++ 跑出带 speaker 的时间段（复用现成管线，它的 ASR 文本被丢弃）
 *   ② 把时间段交给 qwen_worker，它按段切音频、逐段识别
 *
 * 切出来的每段天然只含一个说话人，于是**不需要强制对齐**，也就绕开了
 * 「段边界与说话人切换点不重合 → 少数说话人的词被吞掉」这个合并难题。
 *
 * 有论文背书（Interspeech 2026 MLC-SLM Workshop, arXiv:2607.08208）：3D-Speaker 做分离前端
 * （FSMN-VAD + CAMPPlus + 谱聚类 + 切音频）再分组喂 Qwen3-ASR-1.7B。
 * FunASR 的 cam++ 就是 CAMPPlus，即同一套。
 *
 * ## 代价
 *
 * 说话人分离这一步仍要跑一遍 FunASR 的 ASR（cam++ 的段信息依附在 ASR 的 sentence_info 上），
 * 那份文本被丢弃。换来的是零额外模型、零对齐依赖。
 *
 * ## 实时
 *
 * Qwen3-ASR 的流式**仅 vLLM 后端支持**，而 vLLM 在 Windows 原生跑不通（要 WSL2），
 * 所以实时转写继续走 FunASR 的 paraformer-online，本引擎只管离线。
 */
import type { PyWorker } from '../../py-worker.js'
import type { FunasrEngine, OfflineResult, RecognizedSegment } from './funasr.js'

export class QwenNotReadyError extends Error {}

export interface QwenEngineDeps {
  /** 只用来拿说话人时间段的 FunASR 引擎（cam++） */
  diarizer: FunasrEngine
  /** Qwen3-ASR worker */
  worker: PyWorker
  /** 当前配置（每次调用现取，切换模型后立即生效） */
  getOptions: () => { language: string; spk: boolean }
  log: (...args: unknown[]) => void
}

export class QwenEngine {
  constructor(private readonly deps: QwenEngineDeps) {}

  /**
   * 离线识别：FunASR 出说话人时间段 → Qwen3 逐段识别 → 合并。
   *
   * 任何一个环节拿不到说话人时间段，都退回「整段喂 Qwen3」——
   * 宁可丢掉说话人标签，也不能因为分离失败就整条录音转不出来。
   */
  async recognizeFile(wavPath: string): Promise<OfflineResult> {
    const o = this.deps.getOptions()
    let spans: RecognizedSegment[] = []
    let diarizeFailed: string | null = null

    try {
      const d = await this.deps.diarizer.recognizeFile(wavPath)
      spans = d.segments
      this.deps.log(`Qwen3: 分离得到 ${spans.length} 个说话人时段（FunASR 文本已丢弃）`)
    } catch (e) {
      diarizeFailed = e instanceof Error ? e.message : String(e)
      this.deps.log('Qwen3: 说话人分离失败，退化为整段识别:', diarizeFailed)
    }

    const r = await this.deps.worker.request<{
      text: string
      segments: { start: number; end: number; speaker?: number; text: string }[]
      durationMs: number
      device?: string
    }>(
      'transcribe',
      {
        file: wavPath,
        language: o.language,
        // 只有分离成功且确实带说话人时才传 segments
        segments: spans.length && spans.some((s) => s.speaker !== undefined)
          ? spans.map((s) => ({ start: Math.round(s.start), end: Math.round(s.end), speaker: s.speaker }))
          : undefined,
      },
      // 1.7B 在 16GB 卡上转 20 分钟音频约 3–8 分钟；给足余量
      30 * 60 * 1000,
    )

    const segs: RecognizedSegment[] = Array.isArray(r.segments)
      ? r.segments.map((s) => ({
          start: Number(s.start ?? 0),
          end: Number(s.end ?? 0),
          text: String(s.text ?? ''),
          speaker: typeof s.speaker === 'number' ? s.speaker : undefined,
        }))
      : []

    const text = String(r.text ?? '')
    const speakerApplied = o.spk && segs.some((s) => s.speaker !== undefined)

    return {
      text,
      segments: segs,
      durationMs: Number(r.durationMs ?? 0),
      model: 'qwen3-asr',
      device: String(r.device ?? 'auto'),
      speakerApplied,
    }
  }
}
