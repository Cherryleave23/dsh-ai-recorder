/**
 * L2 预处理层 · Opus 容器化
 *
 * 设备（QS668 / CB08）推流与存储的都是**固定 40 字节一包的裸 Opus 码流**
 * （每包 20ms，granule 走 48kHz 时间线故每包 960），不是合法容器，任何播放器/解码器
 * 都不认。这里把它包装成合法 Ogg/Opus。
 *
 * 移植自厂商《解码 OPUS 文件脚本.py》，并与社区实现（uui77/nextproto 的
 * `Qs668OggOpusWriter`）逐项核对一致：
 *   - serial = 0x51533638 ('QS68')
 *   - OpusHead: version 1 / channels 1 / pre-skip 312 / input-sample-rate 16000
 *   - 每 50 包刷一页 data page，末页带 EOS(0x04)
 *   - Ogg page CRC-32（poly 0x04C11DB7, init 0, MSB-first）
 *
 * 真机实测（2026-08）：实时流 1224 包 → 解码 24.474s，与「包数 × 20ms = 24.48s」
 * 精确吻合，说明 40B/20ms 这个前提成立。
 */

/** 一包 = 20ms，Ogg granule 走 48kHz 时间线 → 960 样本/包 */
export const OPUS_PACKET_BYTES = 40
export const OPUS_PACKET_MS = 20
export const OPUS_GRANULE_PER_PACKET = 960
const OGG_SERIAL = 0x51533638 // 'QS68'
const PAGE_PACKETS = 50

/** Ogg 页 CRC-32（poly 0x04C11DB7, init 0, MSB-first，与官方脚本一致） */
function oggCrc(data: Uint8Array): number {
  let crc = 0
  for (const b of data) {
    crc ^= b << 24
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x80000000 ? (((crc << 1) ^ 0x04c11db7) >>> 0) : ((crc << 1) >>> 0)
    }
  }
  return crc >>> 0
}

function writeU32LE(v: number): Uint8Array {
  return new Uint8Array([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff])
}

function writeU64LE(v: number): Uint8Array {
  const lo = v >>> 0
  const hi = Math.floor(v / 0x100000000) >>> 0
  return new Uint8Array([
    lo & 0xff, (lo >> 8) & 0xff, (lo >> 16) & 0xff, (lo >> 24) & 0xff,
    hi & 0xff, (hi >> 8) & 0xff, (hi >> 16) & 0xff, (hi >> 24) & 0xff,
  ])
}

function makePage(payloads: Uint8Array[], granule: number, serial: number, seq: number, flags: number): Uint8Array {
  const body = new Uint8Array(payloads.reduce((s, p) => s + p.length, 0))
  let o = 0
  for (const p of payloads) {
    body.set(p, o)
    o += p.length
  }
  const laces: number[] = []
  for (const p of payloads) {
    let r = p.length
    while (r >= 255) {
      laces.push(255)
      r -= 255
    }
    laces.push(r)
  }
  const header = new Uint8Array(27 + laces.length)
  header.set([0x4f, 0x67, 0x67, 0x53], 0) // 'OggS'
  header[4] = 0
  header[5] = flags
  header.set(writeU64LE(granule), 6)
  header.set(writeU32LE(serial), 14)
  header.set(writeU32LE(seq), 18)
  header.set(writeU32LE(0), 22) // crc 占位
  header[26] = laces.length
  header.set(laces, 27)
  const page = new Uint8Array(header.length + body.length)
  page.set(header, 0)
  page.set(body, header.length)
  const crc = oggCrc(page)
  page[22] = crc & 0xff
  page[23] = (crc >> 8) & 0xff
  page[24] = (crc >> 16) & 0xff
  page[25] = (crc >> 24) & 0xff
  return page
}

export interface WrappedOpus {
  /** 合法 Ogg/Opus 字节 */
  bytes: Uint8Array
  /** 实际使用的包数 */
  packetCount: number
  /** 按 20ms/包推算的时长（毫秒） */
  durationMs: number
  /** 因尾部不足 40B 被丢弃的字节数（0 为正常） */
  trailingBytes: number
}

/**
 * 裸 40B 包流 → Ogg/Opus。
 *
 * `allowTrailing`：设备传输偶发会让尾部不足一整包。实时流场景按“尽量出结果”处理，
 * 丢弃残尾；离线归档场景应传 false，让调用方把不足包视为传输异常。
 */
export function wrapRawOpusPackets(
  raw: Uint8Array,
  sampleRate = 16000,
  allowTrailing = true,
): WrappedOpus {
  if (raw.length === 0) throw new Error('裸 Opus 包流为空')
  const usable = raw.length - (raw.length % OPUS_PACKET_BYTES)
  const trailingBytes = raw.length - usable
  if (usable === 0) {
    throw new Error(`裸 Opus 包流不足一整包（${raw.length}B < ${OPUS_PACKET_BYTES}B）`)
  }
  if (trailingBytes !== 0 && !allowTrailing) {
    throw new Error(`裸 Opus 包流长度不是 ${OPUS_PACKET_BYTES}B 的整数倍（余 ${trailingBytes}B）`)
  }

  const packets: Uint8Array[] = []
  for (let i = 0; i < usable; i += OPUS_PACKET_BYTES) {
    packets.push(raw.slice(i, i + OPUS_PACKET_BYTES))
  }

  const pages: Uint8Array[] = []
  let seq = 0
  const head = new Uint8Array([
    0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, // 'OpusHead'
    1, 1, // version, channels
    312 & 0xff, (312 >> 8) & 0xff, // pre-skip
    ...writeU32LE(sampleRate),
    0, 0, // output gain
    0, // channel mapping family
  ])
  const tagsName = [0x51, 0x53, 0x36, 0x36, 0x38] // 'QS668'
  const tags = new Uint8Array([
    0x4f, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73, // 'OpusTags'
    tagsName.length & 0xff, 0, 0, 0,
    ...tagsName,
    0, 0, 0, 0,
  ])
  pages.push(makePage([head], 0, OGG_SERIAL, seq++, 0x02)) // BOS
  pages.push(makePage([tags], 0, OGG_SERIAL, seq++, 0x00))

  let granule = 0
  for (let start = 0; start < packets.length; start += PAGE_PACKETS) {
    const group = packets.slice(start, start + PAGE_PACKETS)
    granule += OPUS_GRANULE_PER_PACKET * group.length
    const flags = start + PAGE_PACKETS >= packets.length ? 0x04 : 0x00 // EOS
    pages.push(makePage(group, granule, OGG_SERIAL, seq++, flags))
  }

  const out = new Uint8Array(pages.reduce((s, p) => s + p.length, 0))
  let o = 0
  for (const p of pages) {
    out.set(p, o)
    o += p.length
  }
  return {
    bytes: out,
    packetCount: packets.length,
    durationMs: packets.length * OPUS_PACKET_MS,
    trailingBytes,
  }
}

export function isOgg(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53
}

export function isWav(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && // RIFF
    bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45 // WAVE
  )
}

export interface WavInfo {
  ok: boolean
  declared?: number
  actual?: number
  channels?: number
  sampleRate?: number
  bitsPerSample?: number
  dataBytes?: number
}

export function wavInfo(bytes: Uint8Array): WavInfo {
  if (!isWav(bytes) || bytes.length < 44) return { ok: false }
  const declared = ((bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24)) >>> 0) + 8
  const channels = bytes[22] | (bytes[23] << 8)
  const sampleRate = (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16) | (bytes[27] << 24)) >>> 0
  const bitsPerSample = bytes[34] | (bytes[35] << 8)
  return { ok: declared === bytes.length, declared, actual: bytes.length, channels, sampleRate, bitsPerSample, dataBytes: bytes.length - 44 }
}
