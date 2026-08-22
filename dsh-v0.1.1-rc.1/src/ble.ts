/**
 * BLE Central 管理（录音卡自实现收端）。
 *
 * 拉起 scripts/ble_central.py（bleak 守护进程），stdio JSON-lines 通信：
 *   请求 -> {"id":N,"cmd":...,...}；响应 -> {"id":N,"ok":true|false,...}
 *   事件 -> {"event":...}（无 id，主动推送）
 *
 * 职责：python/bleak 探测与自动安装、子进程生命周期（崩溃自动重启）、
 *       请求/响应关联与超时、事件分发、卸载时干净退出。
 */
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url)) // <插件>/lib/
export const BLE_SCRIPT = join(here, '..', 'scripts', 'ble_central.py')

export interface BleDevice { address: string; name: string; rssi: number; has_ae20: boolean }
export interface BleFileEntry { time: number; size: number; name: string }

export type BleLog = (...args: unknown[]) => void

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: NodeJS.Timeout
}

/** 守护进程事件（除 ready/battery 等字段外，stream 事件由 index.ts 消费） */
export type BleEvent = Record<string, unknown> & { event: string }

export class BleCentral {
  private proc: ChildProcessWithoutNullStreams | null = null
  private seq = 0
  private pending = new Map<number, Pending>()
  private buf = ''
  private disposed = false
  private restartTimer: NodeJS.Timeout | null = null
  private stopping = false

  python: string | null = null
  bleakVersion: string | null = null
  lastError: string | null = null
  connected = false
  reconnecting = false
  address: string | null = null
  mtu: number | null = null
  battery: number | null = null
  realtimeActive = false
  /** 距上次成功命令的时间（面板显示最后活跃） */
  lastActivity: number | null = null

  constructor(
    private readonly log: BleLog,
    private readonly onEvent?: (ev: BleEvent) => void,
  ) {}

  // ─────────── 环境探测 / 安装 ───────────
  /** 探测可用的 python + bleak；缺失时自动 pip 安装 bleak（幂等）。 */
  prepare(pythonCandidates: string[]): { ok: boolean; python?: string; error?: string } {
    for (const py of pythonCandidates) {
      try {
        execFileSync(py, ['--version'], { stdio: 'ignore', timeout: 8000 })
      } catch {
        continue
      }
      const check = (): string | null => {
        try {
          return execFileSync(py, ['-c', 'from importlib.metadata import version; print(version("bleak"))'], { encoding: 'utf8', timeout: 20000 }).trim()
        } catch {
          return null
        }
      }
      let ver = check()
      if (ver) {
        this.python = py
        this.bleakVersion = ver
        return { ok: true, python: py }
      }
      // 自动安装 bleak
      try {
        this.log('BLE: 未检测到 bleak，自动 pip 安装 ...')
        execFileSync(py, ['-m', 'pip', 'install', '--disable-pip-version-check', '--quiet', 'bleak'], { stdio: 'ignore', timeout: 240000 })
        ver = check()
        if (ver) {
          this.python = py
          this.bleakVersion = ver
          this.log('BLE: bleak 安装成功', ver)
          return { ok: true, python: py }
        }
      } catch (e) {
        this.lastError = String(e)
      }
      return { ok: false, error: `${py} 的 bleak 安装失败: ${this.lastError}` }
    }
    return { ok: false, error: '未找到可用的 Python 解释器（BLE 收端依赖 Python 3.9+）' }
  }

  // ─────────── 进程生命周期 ───────────
  get running(): boolean {
    return this.proc !== null
  }

  /** 确保守护进程已启动并就绪。 */
  async ensureStarted(): Promise<void> {
    if (this.proc) return
    if (this.disposed) throw new Error('BLE 已随插件卸载')
    if (!this.python) throw new Error('BLE: python 未就绪，先调用 prepare()')
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(this.python!, ['-u', BLE_SCRIPT], {
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        windowsHide: true,
      })
      this.proc = proc
      proc.stdout.setEncoding('utf8')
      proc.stderr.setEncoding('utf8')
      proc.stdout.on('data', (c: string) => this.onStdout(c))
      proc.stderr.on('data', (c: string) => this.log('BLE daemon stderr:', c.trim()))
      proc.on('error', (e) => {
        this.log('BLE daemon 启动错误:', String(e))
        this.proc = null
        this.lastError = String(e)
        reject(e)
      })
      proc.on('exit', (code, signal) => this.onExit(code, signal))
      // 等待 ready 事件
      const deadline = Date.now() + 15000
      const timer = setInterval(() => {
        if (this.readySeen) {
          clearInterval(timer)
          resolve()
        } else if (Date.now() > deadline) {
          clearInterval(timer)
          this.lastError = 'BLE 守护进程启动超时'
          this.log('BLE 守护进程启动超时')
          reject(new Error(this.lastError))
        }
      }, 100)
      this.readySeen = false
    })
  }

  private readySeen = false

  private onExit(code: number | null, signal: string | null): void {
    const wasRunning = this.proc !== null
    this.proc = null
    this.readySeen = false
    this.connected = false
    this.realtimeActive = false
    // 拒绝所有挂起请求
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer)
      reject(new Error(`BLE 守护进程退出（code=${code} signal=${signal}）`))
    }
    this.pending.clear()
    if (!this.disposed && !this.stopping) {
      this.log('BLE 守护进程退出，2s 后自动重启')
      this.lastError = `守护进程退出 code=${code}`
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null
        this.ensureStarted().catch((e) => this.log('BLE 重启失败:', String(e)))
      }, 2000)
    }
  }

  private onStdout(chunk: string): void {
    this.buf += chunk
    let idx: number
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx).trim()
      this.buf = this.buf.slice(idx + 1)
      if (!line) continue
      try {
        const obj = JSON.parse(line) as Record<string, unknown>
        this.handleMessage(obj)
      } catch {
        this.log('BLE daemon 非 JSON 输出:', line.slice(0, 200))
      }
    }
  }

  private handleMessage(obj: Record<string, unknown>): void {
    const id = typeof obj.id === 'number' ? obj.id : undefined
    if (id !== undefined) {
      const p = this.pending.get(id)
      if (p) {
        this.pending.delete(id)
        clearTimeout(p.timer)
        if (obj.ok === false) {
          p.reject(new Error(String(obj.error ?? 'BLE 命令失败')))
        } else {
          p.resolve(obj)
        }
        return
      }
      return
    }
    // 事件推送
    if (obj.event === 'ready') {
      this.readySeen = true
      if (typeof obj.error === 'string') this.lastError = obj.error
      return
    }
    if (obj.event === 'battery' && typeof obj.level === 'number') {
      this.battery = obj.level
    } else if (obj.event === 'stream') {
      if (obj.kind === 'started') this.realtimeActive = true
      if (obj.kind === 'stopped') this.realtimeActive = false
    } else if (obj.event === 'disconnected') {
      this.connected = false
      this.realtimeActive = false
      this.reconnecting = false
    } else if (obj.event === 'connected') {
      this.connected = true
      this.reconnecting = false
      if (typeof obj.address === 'string') this.address = obj.address
      if (typeof obj.mtu === 'number') this.mtu = obj.mtu
      if (typeof obj.battery === 'number') this.battery = obj.battery
    } else if (obj.event === 'reconnecting') {
      this.reconnecting = true
      this.lastError = `连接断开，自动重连中（第 ${String(obj.attempt ?? '?')} 次）`
    } else if (obj.event === 'reconnect_failed') {
      this.lastError = `自动重连失败: ${String(obj.error ?? '')}`
    } else if (obj.event === 'device_address_changed') {
      this.address = typeof obj.new === 'string' ? obj.new : this.address
    }
    this.onEvent?.(obj as BleEvent)
  }

  /** 发送请求并等待响应（默认 40s 超时；connect/download 用更长）。 */
  request<T = Record<string, unknown>>(cmd: string, params: Record<string, unknown> = {}, timeoutMs = 40000): Promise<T> {
    return new Promise((resolve, reject) => {
      const proc = this.proc
      if (!proc) {
        reject(new Error('BLE 守护进程未启动'))
        return
      }
      const id = ++this.seq
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`BLE 命令超时: ${cmd}`))
      }, timeoutMs)
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
      proc.stdin.write(JSON.stringify({ id, cmd, ...params }) + '\n')
    })
  }

  // ─────────── 业务命令 ───────────
  async status(): Promise<Record<string, unknown>> {
    const r = await this.request('status', {}, 10000)
    this.lastActivity = Date.now()
    return r
  }

  async scan(timeout = 8): Promise<BleDevice[]> {
    const r = await this.request<{ devices: BleDevice[] }>('scan', { timeout }, timeout * 1000 + 15000)
    this.lastActivity = Date.now()
    return r.devices ?? []
  }

  async connect(address: string, retries = 5): Promise<Record<string, unknown>> {
    const r = await this.request('connect', { address, retries }, 240000)
    this.connected = true
    this.address = String(r.address ?? address)
    if (typeof r.mtu === 'number') this.mtu = r.mtu
    if (typeof r.battery === 'number') this.battery = r.battery
    this.lastActivity = Date.now()
    return r
  }

  async disconnect(): Promise<void> {
    try {
      await this.request('disconnect', {}, 15000)
    } finally {
      this.connected = false
      this.realtimeActive = false
    }
  }

  async queryBattery(): Promise<number> {
    const r = await this.request<{ level: number }>('battery', {}, 20000)
    this.battery = r.level
    return r.level
  }

  async timesync(): Promise<void> {
    await this.request('timesync', {}, 15000)
  }

  async filelist(): Promise<BleFileEntry[]> {
    const r = await this.request<{ entries: BleFileEntry[] }>('filelist', {}, 30000)
    return r.entries ?? []
  }

  async download(name: string, opts: { chunkBytes?: number; chunkTime?: number } = {}): Promise<{ name: string; ext: 'wav' | 'opus'; size: number; data: string; chunks?: number }> {
    const params: Record<string, unknown> = { name }
    if (opts.chunkBytes) params.chunk_bytes = opts.chunkBytes
    if (opts.chunkTime) params.chunk_time = opts.chunkTime
    // 分片下载大文件可能耗时较长：30 分钟超时
    const r = await this.request<{ name: string; ext: 'wav' | 'opus'; size: number; data: string; chunks?: number }>('download', params, 1800000)
    return r
  }

  async deleteFile(name: string, time: number, size: number): Promise<void> {
    await this.request('delete', { name, time, size }, 20000)
  }

  async realtime(action: 'start' | 'stop' | 'pause' | 'resume', opts: { windowMs?: number; minBytes?: number; maxBytes?: number } = {}): Promise<void> {
    const params: Record<string, unknown> = { action }
    if (action === 'start') {
      if (opts.windowMs) params.window_ms = opts.windowMs
      if (opts.minBytes) params.min_bytes = opts.minBytes
      if (opts.maxBytes) params.max_bytes = opts.maxBytes
    }
    const r = await this.request<{ active?: boolean; window_ms?: number }>('realtime', params, 15000)
    if (action === 'start') this.realtimeActive = Boolean(r.active)
    if (action === 'stop') this.realtimeActive = false
  }

  // ─────────── 清理 ───────────
  dispose(): void {
    this.disposed = true
    this.stopping = true
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    const proc = this.proc
    this.proc = null
    if (proc) {
      try {
        proc.stdin.write(JSON.stringify({ cmd: 'quit' }) + '\n')
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        try {
          proc.kill()
        } catch {
          /* ignore */
        }
      }, 1500).unref?.()
    }
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer)
      reject(new Error('BLE 已随插件卸载'))
    }
    this.pending.clear()
  }
}
