/**
 * 音频工具：QS668 40B 定长 Opus 包流 -> Ogg/Opus（移植官方 qs668-raw-opus-to-ogg.py），
 * 以及 WAV 头检测。后端不做原生 Opus 解码（避免原生依赖），
 * 统一打包为 Ogg/Opus 或直接 WAV 交给 STT（OpenAI 兼容端点/whisper 均支持 Ogg/Opus 输入）。
 */

const OGG_SERIAL = 0x51533638 // 'QS68'

/** Ogg 页 CRC-32（poly 0x04C11DB7, init 0, MSB-first — 与官方脚本一致） */
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
  header.set([...'OggS'].map((c) => c.charCodeAt(0)), 0)
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

function writeU32LE(v: number): Uint8Array {
  return new Uint8Array([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff])
}

function writeU64LE(v: number): Uint8Array {
  const lo = v >>> 0
  const hi = Math.floor(v / 0x100000000) >>> 0
  return new Uint8Array([lo & 0xff, (lo >> 8) & 0xff, (lo >> 16) & 0xff, (lo >> 24) & 0xff,
    hi & 0xff, (hi >> 8) & 0xff, (hi >> 16) & 0xff, (hi >> 24) & 0xff])
}

/** 把 QS668 40B 定长 Opus 包流包装为合法 Ogg/Opus（每包=20ms/16kHz，granule=960/包） */
export function wrapRawOpusPackets(raw: Uint8Array, sampleRate = 16000): Uint8Array {
  if (raw.length === 0 || raw.length % 40 !== 0) {
    throw new Error(`QS668 raw OPUS length must be a positive multiple of 40, got ${raw.length}`)
  }
  const packets: Uint8Array[] = []
  for (let i = 0; i < raw.length; i += 40) packets.push(raw.slice(i, i + 40))
  let seq = 0
  const pages: Uint8Array[] = []

  const head = new Uint8Array([
    ...[...'OpusHead'].map((c) => c.charCodeAt(0)),
    1, 1, // version, channels
    312 & 0xff, (312 >> 8) & 0xff, // pre-skip
    ...writeU32LE(sampleRate),
    0, 0, // gain
    0, // mapping family
  ])
  const tagsName = [...'QS668'].map((c) => c.charCodeAt(0))
  const tags = new Uint8Array([
    ...[...'OpusTags'].map((c) => c.charCodeAt(0)),
    tagsName.length & 0xff, (tagsName.length >> 8) & 0xff, (tagsName.length >> 16) & 0xff, (tagsName.length >> 24) & 0xff,
    ...tagsName,
    0, 0, 0, 0,
  ])

  pages.push(makePage([head], 0, OGG_SERIAL, seq++, 0x02))
  pages.push(makePage([tags], 0, OGG_SERIAL, seq++, 0x00))

  let granule = 0
  for (let start = 0; start < packets.length; start += 50) {
    const group = packets.slice(start, start + 50)
    granule += 960 * group.length
    const flags = start + 50 >= packets.length ? 0x04 : 0x00
    pages.push(makePage(group, granule, OGG_SERIAL, seq++, flags))
  }
  const out = new Uint8Array(pages.reduce((s, p) => s + p.length, 0))
  let o = 0
  for (const p of pages) {
    out.set(p, o)
    o += p.length
  }
  return out
}

export function isOgg(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53 // 'OggS'
}

export function isWav(bytes: Uint8Array): boolean {
  return bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && // RIFF
    bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45 // WAVE
}

export interface WavInfo {
  ok: boolean
  declared?: number
  actual?: number
  channels?: number
  sampleRate?: number
  bitsPerSample?: number
}

export function wavInfo(bytes: Uint8Array): WavInfo {
  if (!isWav(bytes) || bytes.length < 44) return { ok: false }
  const declared = ((bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24)) >>> 0) + 8
  const channels = bytes[22] | (bytes[23] << 8)
  const sampleRate = (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16) | (bytes[27] << 24)) >>> 0
  const bitsPerSample = bytes[34] | (bytes[35] << 8)
  return { ok: declared === bytes.length, declared, actual: bytes.length, channels, sampleRate, bitsPerSample }
}

/** 归一化: 任意输入字节 -> {bytes, ext}（raw opus 流自动包 Ogg; 已带容器原样返回） */
export function normalizeAudio(raw: Uint8Array, hint: 'opus' | 'ogg' | 'wav' | 'auto'): { bytes: Uint8Array; ext: 'ogg' | 'wav' } {
  if (isOgg(raw)) return { bytes: raw, ext: 'ogg' }
  if (isWav(raw)) return { bytes: raw, ext: 'wav' }
  if (hint === 'wav') throw new Error('输入标注为 wav 但 WAV 头不合法')
  // raw opus 包流（40B 倍数）或 ogg 流——按 raw 包流打包
  return { bytes: wrapRawOpusPackets(raw), ext: 'ogg' }
}