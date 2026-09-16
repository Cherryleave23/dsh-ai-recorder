/**
 * L1 采集层 · 连接过的录音卡缓存
 *
 * 「扫描」的默认意图其实是**重连**：用户按扫描，是希望把平时用的那张卡接回来，
 * 而不是每次都从一堆陌生广播里挑一个。所以这里记住连过的设备，扫描到就自动接上。
 *
 * 按 address 记忆（AE20 卡的地址在固件层面稳定）；同时留一份 name 索引，
 * 万一设备侧换了随机地址，还能靠名字认出来「这是同一张卡」。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { dirname } from 'node:path'

export interface KnownDevice {
  address: string
  name: string
  /** 最近一次成功连接的时刻 */
  lastConnectedAt: string
  /** 累计连接次数，用来把「常用卡」排前面 */
  connectCount: number
  lastRssi?: number
}

interface CacheFile {
  updatedAt: string
  devices: KnownDevice[]
}

export class KnownDeviceStore {
  private readonly file: string
  private cache: KnownDevice[] | null = null

  constructor(file: string) {
    this.file = file
  }

  list(): KnownDevice[] {
    if (this.cache) return this.cache
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as CacheFile
      this.cache = Array.isArray(raw?.devices) ? raw.devices.filter((d) => d && d.address) : []
    } catch {
      // 首次运行或文件损坏：空缓存即可，不值得为此报错
      this.cache = []
    }
    return this.cache
  }

  find(address: string): KnownDevice | undefined {
    const key = (address ?? '').toLowerCase()
    return this.list().find((d) => d.address.toLowerCase() === key)
  }

  /** 同名的另一张卡（设备换随机地址时靠名字兜底）。 */
  findByName(name: string): KnownDevice | undefined {
    const key = (name ?? '').trim().toLowerCase()
    if (!key) return undefined
    return this.list().find((d) => (d.name ?? '').trim().toLowerCase() === key)
  }

  /** 连接成功后记住它。address 变了但名字对得上时，视为同一张卡（迁移计数）。 */
  remember(dev: { address: string; name?: string; rssi?: number }): KnownDevice {
    const now = new Date().toISOString()
    const list = this.list()
    let hit = list.find((d) => d.address.toLowerCase() === dev.address.toLowerCase())
    if (!hit && dev.name) hit = list.find((d) => (d.name ?? '').toLowerCase() === dev.name!.toLowerCase())
    if (hit) {
      // 设备换了地址：以新地址为准，把旧记录并过来而不是留下一条死地址
      if (hit.address.toLowerCase() !== dev.address.toLowerCase()) {
        hit.address = dev.address
      }
      if (dev.name) hit.name = dev.name
      hit.lastConnectedAt = now
      hit.connectCount += 1
      if (typeof dev.rssi === 'number') hit.lastRssi = dev.rssi
    } else {
      hit = {
        address: dev.address,
        name: dev.name ?? '',
        lastConnectedAt: now,
        connectCount: 1,
        lastRssi: dev.rssi,
      }
      list.push(hit)
    }
    this.save()
    return hit
  }

  forget(address: string): boolean {
    const key = (address ?? '').toLowerCase()
    const list = this.list()
    const i = list.findIndex((d) => d.address.toLowerCase() === key)
    if (i < 0) return false
    list.splice(i, 1)
    this.save()
    return true
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const body: CacheFile = { updatedAt: new Date().toISOString(), devices: this.list() }
      const tmp = this.file + '.tmp'
      writeFileSync(tmp, JSON.stringify(body, null, 2), 'utf8')
      renameSync(tmp, this.file) // 原子落盘，避免半截 JSON 让下次启动读不出来
    } catch {
      /* 缓存写失败不该影响连接本身 */
    }
  }
}

/** 把一个扫描到的广播与缓存对上号：先地址，后名字。 */
export function matchKnown(
  store: KnownDeviceStore,
  dev: { address: string; name?: string },
): KnownDevice | undefined {
  return store.find(dev.address) ?? (dev.name ? store.findByName(dev.name) : undefined)
}
