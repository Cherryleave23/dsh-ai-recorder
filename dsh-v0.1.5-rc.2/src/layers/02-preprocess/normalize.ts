/**
 * L2 预处理层 · 容器归一
 *
 * 输入是三形态之一：
 *   1. 设备裸 Opus 包流（40B/包）        → 包成 Ogg/Opus
 *   2. 已经是 Ogg/Opus                    → 原样
 *   3. 设备转码出的标准 WAV（16k/16bit/mono）→ 原样
 *
 * 输出是「可落盘的原始归档」+ 时长信息；真正的 PCM 解码（→ 16k mono）由 decode.ts
 * 交给 Python 侧完成（Node 不做原生 Opus 解码，避免原生依赖）。
 */
import { OPUS_PACKET_MS, isOgg, isWav, wavInfo, wrapRawOpusPackets } from './opus.js'

export type AudioHint = 'opus' | 'ogg' | 'wav' | 'auto'

export interface ArchiveAudio {
  /** 可落盘的容器字节（Ogg/Opus 或 WAV） */
  bytes: Uint8Array
  ext: 'ogg' | 'wav'
  /** 容器来源：raw-opus=由裸包流包成；native=输入本就带合法容器 */
  origin: 'raw-opus' | 'native'
  /** 裸包流的包数（origin=raw-opus 时有值） */
  packetCount?: number
  /** 推算/声明时长（毫秒）；未知则 undefined */
  durationMs?: number
  /** 尾部不足一整包被丢弃的字节数 */
  trailingBytes?: number
}

export class AudioFormatError extends Error {}

/**
 * 把任意输入字节归一为「带合法容器的归档音频」。
 *
 * `strict`：离线归档场景传 true —— 裸包流长度必须是 40B 整数倍，尾部残字节视为传输异常；
 * 实时流场景传 false —— 尽量出结果。
 */
export function containAudio(raw: Uint8Array, hint: AudioHint, strict = false): ArchiveAudio {
  if (raw.length === 0) throw new AudioFormatError('音频数据为空')

  // 已经带容器：直接放行（WAV 还要校验长度自洽，设备转码偶发截断）
  if (isWav(raw)) {
    const info = wavInfo(raw)
    if (!info.ok && strict) {
      throw new AudioFormatError(`WAV 长度不自洽：声明 ${info.declared}B 实际 ${info.actual}B`)
    }
    const durationMs =
      info.sampleRate && info.channels && info.bitsPerSample && info.dataBytes !== undefined
        ? Math.round((info.dataBytes / (info.sampleRate * info.channels * (info.bitsPerSample / 8))) * 1000)
        : undefined
    return { bytes: raw, ext: 'wav', origin: 'native', durationMs }
  }
  if (isOgg(raw)) {
    return { bytes: raw, ext: 'ogg', origin: 'native' }
  }

  // 输入自称 WAV 但没有 RIFF 头 → 明确报错，不要当成 Opus 硬包
  if (hint === 'wav') {
    throw new AudioFormatError('输入标注为 wav，但 RIFF/WAVE 头不合法')
  }

  const wrapped = wrapRawOpusPackets(raw, 16000, !strict)
  return {
    bytes: wrapped.bytes,
    ext: 'ogg',
    origin: 'raw-opus',
    packetCount: wrapped.packetCount,
    durationMs: wrapped.durationMs,
    trailingBytes: wrapped.trailingBytes,
  }
}

/** 裸包流按 40B/20ms 推算的时长（毫秒）。 */
export function expectedMsForRawOpus(byteLength: number): number {
  return Math.floor(byteLength / 40) * OPUS_PACKET_MS
}
