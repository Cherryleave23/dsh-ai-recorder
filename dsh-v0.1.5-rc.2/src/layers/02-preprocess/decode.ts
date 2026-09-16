/**
 * L2 预处理层 · 解码
 *
 * 把归档音频（Ogg/Opus 或 WAV）解码成**统一格式音频流**：默认 16kHz / 单声道 / 16bit PCM WAV。
 * 这是流程图里 L2 的「音频解码与规范化」落点。
 *
 * 解码在 Python 侧做（`scripts/funasr_worker.py` 的 decode / opus_probe 命令）：
 * FunASR 需要 PCM 输入，而 Node 侧不引入原生 Opus 依赖。
 *
 * 另含「下载件自检」：真机实测设备的 .opus 下载件**前若干字节是非确定性数据**
 * （同一文件多次下载字节不同，之后的内容字节完全一致）。整包交给解码器会从第一个包就失败，
 * 解出 0.05~0.11s 而非应有长度。probeOpusPackets 会扫描最小可解码偏移。
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PyWorker } from '../../py-worker.js'
import { wrapRawOpusPackets } from './opus.js'
import type { ArchiveAudio } from './normalize.js'

export interface UnifiedAudio {
  /** 统一格式音频（16k/mono/16bit PCM WAV）的磁盘路径 */
  path: string
  durationMs: number
  sampleRate: number
  channels: number
  bits: number
  bytes: number
}

export interface DecodeTarget {
  sampleRate: number
  channels: number
  bits: number
}

/** 临时工作目录（调用方负责 disposeTmp）。 */
export async function makeTmpDir(tag: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `rec-${tag}-`))
}

export async function disposeTmp(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true }).catch(() => undefined)
}

/** 落一个临时文件，返回其路径。 */
export async function writeTmp(dir: string, name: string, bytes: Uint8Array): Promise<string> {
  const p = join(dir, name)
  await writeFile(p, bytes)
  return p
}

/**
 * 归档音频 → 统一格式 PCM。
 * `dir` 由调用方提供（便于整批复用同一临时目录）。
 */
export async function decodeToUnified(
  worker: PyWorker,
  archive: ArchiveAudio,
  target: DecodeTarget,
  dir: string,
  basename = 'archive',
): Promise<UnifiedAudio> {
  const inputPath = await writeTmp(dir, `${basename}.${archive.ext}`, archive.bytes)
  const outputPath = join(dir, `${basename}.16k.wav`)
  const r = await worker.request<{
    outputPath: string
    durationMs: number
    sampleRate: number
    channels: number
    bits: number
    bytes: number
  }>(
    'decode',
    {
      inputPath,
      outputPath,
      sampleRate: target.sampleRate,
      channels: target.channels,
      bits: target.bits,
    },
    10 * 60 * 1000,
  )
  return {
    path: String(r.outputPath ?? outputPath),
    durationMs: Number(r.durationMs ?? 0),
    sampleRate: Number(r.sampleRate ?? target.sampleRate),
    channels: Number(r.channels ?? target.channels),
    bits: Number(r.bits ?? target.bits),
    bytes: Number(r.bytes ?? 0),
  }
}

export interface OpusProbeResult {
  /** 建议丢弃的前导字节数（0 表示原样可用） */
  skipBytes: number
  /** 跳过后解出的时长（毫秒） */
  decodedMs: number
  /** 按包数推算的应有长度（毫秒） */
  expectedMs: number
  /** decodedMs / expectedMs */
  ratio: number
  /** ratio 是否达到可接受阈值 */
  ok: boolean
}

/**
 * 下载件自检：在 [0, maxSkip] 内按 step 扫描最小可解码偏移。
 *
 * 先试 0；若解出时长与「包数 × 20ms」的比值达标就直接返回。
 * 否则逐步加大偏移，取第一个达标的偏移。
 */
export async function probeOpusPackets(
  worker: PyWorker,
  rawOpus: Uint8Array,
  expectedMs: number,
  dir: string,
  opts: { maxSkip?: number; step?: number; minRatio?: number; basename?: string } = {},
): Promise<OpusProbeResult> {
  const maxSkip = opts.maxSkip ?? 65536
  const step = opts.step ?? 40
  const minRatio = opts.minRatio ?? 0.9
  const inputPath = await writeTmp(dir, `${opts.basename ?? 'probe'}.opus`, rawOpus)
  const r = await worker.request<{ skipBytes: number; decodedMs: number; expectedMs: number }>(
    'opus_probe',
    { inputPath, expectedMs, maxSkip, step, minRatio },
    10 * 60 * 1000,
  )
  const decodedMs = Number(r.decodedMs ?? 0)
  const exp = Number(r.expectedMs ?? expectedMs)
  const ratio = exp > 0 ? decodedMs / exp : 0
  const skipBytes = Number(r.skipBytes ?? 0)
  return { skipBytes, decodedMs, expectedMs: exp, ratio, ok: ratio >= minRatio || (skipBytes === 0 && decodedMs > 0) }
}

/**
 * 按探测结果裁掉前导污染，再重新包成 Ogg/Opus。
 * 返回新的归档；skipBytes=0 时原样返回。
 */
export function applySkip(archive: ArchiveAudio, rawOpus: Uint8Array, skipBytes: number): ArchiveAudio {
  if (skipBytes <= 0 || archive.origin !== 'raw-opus') return archive
  const trimmed = rawOpus.subarray(skipBytes)
  const wrapped = wrapRawOpusPackets(trimmed, 16000, true)
  return {
    bytes: wrapped.bytes,
    ext: 'ogg',
    origin: 'raw-opus',
    packetCount: wrapped.packetCount,
    durationMs: wrapped.durationMs,
    trailingBytes: wrapped.trailingBytes,
  }
}
