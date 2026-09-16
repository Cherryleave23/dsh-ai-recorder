/**
 * 通用 Python 常驻进程客户端（stdio JSON-lines）。
 *
 * 与 scripts/*.py 的约定（与既有 BLE 守护进程同款，已被验证稳定）：
 *   请求  → {"id":N, "cmd":"...", ...params}
 *   响应  → {"id":N, "ok":true|false, ...}    （`ok:false` 时带 error）
 *   事件  → {"event":"..."}                   （无 id，主动推送）
 *
 * 职责：进程生命周期、请求/响应关联与超时、事件分发、崩溃自动重启、卸载时干净退出。
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url)) // <插件>/lib/

/** 子进程环境里要剔除的代理变量（各种大小写形态）。 */
const PROXY_KEYS = [
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
  'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
]

/**
 * 构造子进程环境：默认**不继承代理**，需要时用 proxyUrl 显式指定。
 *
 * 本机 HTTP_PROXY 指向已死端口 10809（活的 v2ray 在 10808），
 * 继承下去会让 worker 里的模型下载报 ProxyError / WinError 10061。
 */
export function spawnEnv(extra?: Record<string, string>, proxyUrl?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const k of PROXY_KEYS) delete env[k]
  if (proxyUrl) {
    env.HTTP_PROXY = proxyUrl
    env.HTTPS_PROXY = proxyUrl
  }
  return { ...env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', ...(extra ?? {}) }
}

/** 插件安装目录下的 scripts/（lib/index.js → ../scripts/） */
export function scriptPath(name: string): string {
  return join(here, '..', 'scripts', name)
}

export interface PyWorkerOptions {
  /** python 解释器 */
  python: string
  /** 脚本绝对路径 */
  script: string
  /** 传给脚本的固定参数 */
  args?: string[]
  /** 启动就绪超时（毫秒） */
  readyTimeoutMs?: number
  /** 单条命令默认超时（毫秒） */
  commandTimeoutMs?: number
  log: (...args: unknown[]) => void
  onEvent?: (ev: Record<string, unknown>) => void
  /** 额外环境变量 */
  env?: Record<string, string>
  /**
   * 代理地址；留空=**剔除继承来的代理**。
   *
   * 本机环境里 HTTP_PROXY 指向一个已死端口（10809，活的 v2ray 在 10808），
   * 原样继承会让 worker 里的 modelscope / huggingface 下载全部失败。
   * 而我们要访问的国内源（modelscope / hf-mirror）本来就不需要代理。
   */
  proxyUrl?: string
  /** 进程最大重启次数（超过则放弃，避免无休止拉起） */
  maxRestarts?: number
}

interface Pending {
  resolve: (v: Record<string, unknown>) => void
  reject: (e: Error) => void
  timer: NodeJS.Timeout
}

export class PyWorker {
  private proc: ChildProcessWithoutNullStreams | null = null
  private seq = 0
  private buf = ''
  private pending = new Map<number, Pending>()
  private disposed = false
  private starting: Promise<void> | null = null
  private restarts = 0

  /** 最近一次就绪事件携带的信息（如 worker 自报的设备/模型状态） */
  readyPayload: Record<string, unknown> | null = null
  readyError: string | null = null
  /** 上次非零退出码 */
  lastExit: { code: number | null; signal: string | null } | null = null

  constructor(private readonly opts: PyWorkerOptions) {}

  get running(): boolean {
    return this.proc !== null
  }

  get pid(): number | null {
    return this.proc?.pid ?? null
  }

  /** 启动并等待 ready 事件；幂等。 */
  async ensureStarted(): Promise<void> {
    if (this.proc) return
    if (this.disposed) throw new Error('PyWorker 已随插件卸载')
    if (this.starting) return this.starting
    this.starting = this.start().finally(() => {
      this.starting = null
    })
    return this.starting
  }

  private start(): Promise<void> {
    const { python, script, args = [], readyTimeoutMs = 120_000, log } = this.opts
    return new Promise<void>((resolve, reject) => {
      const proc = spawn(python, ['-u', script, ...args], {
        // 剔除继承来的坏代理（见 PyWorkerOptions.proxyUrl 的说明）
        env: spawnEnv(this.opts.env, this.opts.proxyUrl),
        windowsHide: true,
      })
      this.proc = proc
      this.buf = ''
      this.readyPayload = null
      this.readyError = null
      proc.stdout.setEncoding('utf8')
      proc.stderr.setEncoding('utf8')
      proc.stdout.on('data', (c: string) => this.onStdout(c))
      // stderr 只做日志：模型加载进度、警告等噪声不该污染协议流
      proc.stderr.on('data', (c: string) => {
        const t = c.trim()
        if (t) log('[py stderr]', t)
      })
      proc.on('error', (e) => {
        log('PyWorker 启动错误:', String(e))
        this.failAll(new Error(`PyWorker 启动失败: ${String(e)}`))
        reject(e)
      })
      proc.on('exit', (code, signal) => {
        const wasCurrent = this.proc === proc
        if (wasCurrent) this.proc = null
        this.lastExit = { code, signal }
        this.failAll(new Error(`PyWorker 已退出（code=${code ?? 'null'} signal=${signal ?? 'null'}）`))
        if (!this.disposed && wasCurrent && code !== 0) this.scheduleRestart()
      })

      const deadline = Date.now() + readyTimeoutMs
      const timer = setInterval(() => {
        if (this.readyPayload) {
          clearInterval(timer)
          if (this.readyError) reject(new Error(this.readyError))
          else resolve()
        } else if (Date.now() > deadline) {
          clearInterval(timer)
          reject(new Error(`PyWorker 启动超时（${Math.round(readyTimeoutMs / 1000)}s 内未就绪）`))
        }
      }, 150)
    })
  }

  private scheduleRestart(): void {
    const max = this.opts.maxRestarts ?? 3
    if (this.restarts >= max) {
      this.opts.log(`PyWorker 连续异常退出 ${this.restarts} 次，放弃重启`)
      return
    }
    this.restarts += 1
    const delay = Math.min(30_000, 2000 * this.restarts)
    this.opts.log(`PyWorker 将在 ${delay}ms 后重启（第 ${this.restarts}/${max} 次）`)
    const t = setTimeout(() => {
      if (this.disposed) return
      this.ensureStarted().catch((e) => this.opts.log('PyWorker 重启失败:', String(e)))
    }, delay)
    t.unref?.()
  }

  private onStdout(chunk: string): void {
    this.buf += chunk
    let idx: number
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx).trim()
      this.buf = this.buf.slice(idx + 1)
      if (!line) continue
      let obj: Record<string, unknown>
      try {
        obj = JSON.parse(line) as Record<string, unknown>
      } catch {
        this.opts.log('PyWorker 非 JSON 输出（忽略）:', line.slice(0, 200))
        continue
      }
      this.dispatch(obj)
    }
  }

  private dispatch(obj: Record<string, unknown>): void {
    if (typeof obj.id === 'number') {
      const p = this.pending.get(obj.id)
      if (!p) return
      this.pending.delete(obj.id)
      clearTimeout(p.timer)
      if (obj.ok === false) p.reject(new Error(String(obj.error ?? '未知错误')))
      else p.resolve(obj)
      return
    }
    if (obj.event === 'ready') {
      this.readyPayload = obj
      if (typeof obj.error === 'string' && obj.error) this.readyError = obj.error
      else this.restarts = 0
      return
    }
    this.opts.onEvent?.(obj)
  }

  private failAll(err: Error): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.reject(err)
    }
    this.pending.clear()
  }

  /** 发送一条命令并等待响应。 */
  async request<T extends Record<string, unknown> = Record<string, unknown>>(
    cmd: string,
    params: Record<string, unknown> = {},
    timeoutMs?: number,
  ): Promise<T> {
    await this.ensureStarted()
    const proc = this.proc
    if (!proc || proc.exitCode !== null) throw new Error('PyWorker 未运行')
    const id = ++this.seq
    const limit = timeoutMs ?? this.opts.commandTimeoutMs ?? 120_000
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`PyWorker 命令超时（${cmd}, ${Math.round(limit / 1000)}s）`))
      }, limit)
      this.pending.set(id, { resolve: resolve as (v: Record<string, unknown>) => void, reject, timer })
      try {
        proc.stdin.write(JSON.stringify({ id, cmd, ...params }) + '\n')
      } catch (e) {
        this.pending.delete(id)
        clearTimeout(timer)
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
  }

  /** 停止进程（幂等）。 */
  async dispose(): Promise<void> {
    this.disposed = true
    const proc = this.proc
    this.proc = null
    this.failAll(new Error('PyWorker 已停止'))
    if (!proc) return
    try {
      proc.stdin.write(JSON.stringify({ cmd: 'quit' }) + '\n')
    } catch {
      /* 已关闭 */
    }
    const t = setTimeout(() => {
      try {
        proc.kill()
      } catch {
        /* 已退出 */
      }
    }, 1500)
    t.unref?.()
  }
}
