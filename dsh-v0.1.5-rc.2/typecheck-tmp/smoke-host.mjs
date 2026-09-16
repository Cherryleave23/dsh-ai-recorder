/**
 * host 半边冒烟：从**已安装位置**加载 lib/index.js，用 mock cordis ctx 跑通路由。
 *
 * 为什么不重启 DSH 直接测：当前实例是本会话赖以运行的宿主，重启会杀掉会话。
 * 这里用等价的进程内验证——加载真实产物、装配真实 ctx、发真实请求。
 *
 * 用法：node typecheck-tmp/smoke-host.mjs [插件安装目录]
 */
import { EventEmitter } from 'node:events'
import { Writable } from 'node:stream'
import { createHash } from 'node:crypto'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const sourceDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 找要加载的产物目录。
 *
 * 多 profile 环境下不能写死 `profiles/web`：DSH 升级后活动 profile 会变
 * （0.1.2-alpha.5 → 0.1.5-rc.2 就是如此），写死就会加载到**旧 profile 里的陈旧副本**
 * 然后「通过」——一个会骗人的假绿。所以按 `lib/index.js` 哈希与当前构建比对，
 * 优先选真正由这份源码编出来的那一个。
 */
function resolveDir() {
  const profiles = join(homedir(), '.dsh', 'profiles')
  const wanted = createHash('sha256').update(readFileSync(join(sourceDir, 'lib', 'index.js'))).digest('hex')
  const candidates = []
  try {
    for (const pf of readdirSync(profiles)) {
      const nm = join(profiles, pf, 'node_modules')
      let names = []
      try {
        names = readdirSync(nm)
      } catch {
        continue
      }
      for (const name of names) {
        if (!/^dsh-ai-recorder(-hot\d+)?$/.test(name)) continue
        const dir = join(nm, name)
        const entry = join(dir, 'lib', 'index.js')
        if (!existsSync(entry)) continue
        let hash = ''
        let mtime = 0
        try {
          hash = createHash('sha256').update(readFileSync(entry)).digest('hex')
          mtime = statSync(entry).mtimeMs
        } catch {
          /* 读不到就当不匹配 */
        }
        candidates.push({ dir, hash, mtime, profile: pf, matches: hash === wanted })
      }
    }
  } catch {
    /* profiles 目录不存在 */
  }
  candidates.sort((a, b) => Number(b.matches) - Number(a.matches) || b.mtime - a.mtime)
  const hit = candidates[0]
  if (hit) {
    if (!hit.matches) {
      console.warn(`[smoke] 警告：没有安装副本与当前构建一致，退回最新的 ${hit.profile}/${hit.dir.split(/[\\/]/).pop()}`)
    }
    return { dir: hit.dir, exact: hit.matches, profile: hit.profile }
  }
  return { dir: sourceDir, exact: false, profile: '(源码目录，缺依赖时加载会失败)' }
}

const resolved = process.argv[2]
  ? { dir: process.argv[2], exact: null, profile: '(参数指定)' }
  : resolveDir()
const INSTALL_DIR = resolved.dir

const entry = join(INSTALL_DIR, 'lib', 'index.js')
if (!existsSync(entry)) {
  console.error('找不到 host 产物:', entry)
  process.exit(1)
}
if (!process.argv[2]) console.log('[smoke] 产物目录:', INSTALL_DIR)

// ── mock req/res ──
function makeReq(method, url, body) {
  const req = new EventEmitter()
  req.method = method
  req.url = url
  req.headers = { 'content-type': 'application/json' }
  req.destroy = () => undefined
  const buf = body === undefined ? null : Buffer.from(JSON.stringify(body))
  process.nextTick(() => {
    if (buf) req.emit('data', buf)
    req.emit('end')
  })
  return req
}

/**
 * mock 响应必须是真的 Writable —— 音频路由用 `createReadStream(file).pipe(res)`
 * 流式回数据，普通字面量对象没有 `.on`，pipe 会直接抛 `dest.on is not a function`。
 * 这个坑第一次踩到时表现为「Range 全 500」，差点被误判成插件 bug。
 */
function makeRes() {
  const chunks = []
  const res = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(Buffer.from(chunk))
      cb()
    },
  })
  res.statusCode = 0
  res.headers = {}
  res.chunks = chunks
  res.headersSent = false
  res.writeHead = function (code, headers) {
    this.statusCode = code
    this.headers = headers ?? {}
    this.headersSent = true
  }
  res.setHeader = function (key, value) {
    this.headers[key] = value
  }
  return res
}

// ── mock cordis ctx ──
const routes = new Map()
const effects = []
const logs = []
const ctx = {
  webServer: {
    register(route) {
      const key = `${route.kind}:${route.path}`
      if (routes.has(key)) throw new Error(`duplicate ${key}`)
      routes.set(key, route.handler)
      return () => routes.delete(key)
    },
  },
  effect(fn, label) {
    const dispose = fn()
    effects.push({ label, dispose })
    return () => dispose?.()
  },
  get() {
    return undefined
  },
  logger: {
    info: (...a) => logs.push(['info', ...a].join(' ')),
    warn: (...a) => logs.push(['warn', ...a].join(' ')),
    error: (...a) => logs.push(['error', ...a].join(' ')),
    debug: () => undefined,
  },
}

/** pipe 是异步的：等响应流真正写完，否则统计到的字节数会偏小 */
function settled(res) {
  return new Promise((resolve) => {
    if (res.writableFinished) return resolve()
    res.once('finish', resolve)
    res.once('close', resolve)
    setTimeout(resolve, 3000)
  })
}

async function call(pathname, method = 'GET', body) {
  const handler = routes.get('prefix:/api/recorder')
  if (!handler) throw new Error('未注册 /api/recorder 路由')
  const req = makeReq(method, pathname, body)
  const res = makeRes()
  await handler(req, res)
  await settled(res)
  const raw = Buffer.concat(res.chunks).toString('utf8')
  let json
  try {
    json = JSON.parse(raw)
  } catch {
    json = raw
  }
  return { status: res.statusCode, json, raw, res }
}

/** 发一个带自定义头的请求，返回状态/响应头/字节数（不解析 body）。 */
async function callRaw(pathname, headers = {}, method = 'GET') {
  const handler = routes.get('prefix:/api/recorder')
  const req = makeReq(method, pathname)
  req.headers = { ...req.headers, ...headers }
  const res = makeRes()
  await handler(req, res)
  await settled(res)
  return { status: res.statusCode, headers: res.headers ?? {}, bytes: Buffer.concat(res.chunks).length }
}

// ── 跑 ──
const mod = await import('file://' + entry.replace(/\\/g, '/'))
const { Config } = mod
const config = Config({ outDir: join(homedir(), '.dsh', 'recorder-backend') })

console.log('=== 装配 ===')
console.log('name       :', mod.name)
console.log('inject     :', JSON.stringify(mod.inject))
mod.apply(ctx, config)
console.log('已注册路由 :', [...routes.keys()].join(', '))
console.log('effect     :', effects.map((e) => e.label).join(', '))

const fails = []
const check = (label, ok, detail) => {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ' — ' + detail : ''}`)
  if (!ok) fails.push(label)
}

console.log('\n=== 路由 ===')
const health = await call('/api/recorder/health')
check('GET /health 200', health.status === 200, `层=${health.json?.layers?.join('/')}`)

const cfg = await call('/api/recorder/config')
check('GET /config 200', cfg.status === 200 && cfg.json?.config?.asrModel !== undefined,
  `opusPreferred=${cfg.json?.config?.opusPreferred} asrModel=${cfg.json?.config?.asrModel}`)

const sess = await call('/api/recorder/sessions')
check('GET /sessions 200', sess.status === 200 && Array.isArray(sess.json?.items), `已有 ${sess.json?.items?.length} 条`)

const notFound = await call('/api/recorder/nope')
check('未知路径 404', notFound.status === 404)

const asr = await call('/api/recorder/asr/status')
check('GET /asr/status 200', asr.status === 200, `ready=${asr.json?.ready} missing=${JSON.stringify(asr.json?.status?.missing)}`)

// ── L2 真实样本：走完整 TS 管线（容器归一 → 前导污染探测 → 裁掉 → 解码）──
console.log('\n=== L2 真机样本（走完整 TS 管线）===')
const sample = 'D:/AI/dsh-coder/recorder-bt/device-audio/note20260820-210054.opus'
if (existsSync(sample)) {
  const b64 = readFileSync(sample).toString('base64')
  const r = await call('/api/recorder/audio', 'POST', { audioBase64: b64, ext: 'opus' })
  const funasrReady = asr.json?.ready === true
  if (funasrReady) {
    // 识别环境就绪时应整条通路跑通
    check('完整管线跑通（含 L3 识别）', r.status === 200 && (r.json?.text ?? '').length > 0,
      `status=${r.status} 时长=${r.json?.durationMs}ms 分段=${r.json?.segments?.length} 文本=${JSON.stringify((r.json?.text ?? '').slice(0, 40))}`)
  } else {
    // 未就绪时应在 L3 处给出明确的 funasr 报错，而不是含糊失败
    check('在 L3 处因缺 funasr 明确报错', /funasr/i.test(String(r.json?.error ?? '')),
      String(r.json?.error ?? '').slice(0, 160))
  }
} else {
  console.log('  [SKIP] 样本不存在:', sample)
}

// ── 音频 Range：播放器拖进度条依赖这个 ──
console.log('\n=== 音频 Range（拖进度条的前提）===')
const withAudio = (sess.json?.items ?? []).find((r) => r.hasAudio === true)
if (!withAudio) {
  console.log('  [SKIP] 没有带音频的会话，先跑一次 e2e-offline.mjs 造一条')
} else {
  const p = `/api/recorder/session/${encodeURIComponent(withAudio.id)}/audio`
  const full = await callRaw(p)
  check('无 Range → 200 且声明 Accept-Ranges: bytes',
    full.status === 200 && String(full.headers['accept-ranges']).toLowerCase() === 'bytes',
    `status=${full.status} accept-ranges=${full.headers['accept-ranges']} bytes=${full.bytes}`)

  const total = Number(full.headers['content-length'])
  const part = await callRaw(p, { range: 'bytes=100-199' })
  check('bytes=100-199 → 206 + Content-Range 且正好 100 字节',
    part.status === 206 && part.headers['content-range'] === `bytes 100-199/${total}` && part.bytes === 100,
    `status=${part.status} range=${part.headers['content-range']} bytes=${part.bytes}`)

  const open = await callRaw(p, { range: 'bytes=1000-' })
  check('bytes=1000- → 206 且长度为 total-1000',
    open.status === 206 && open.bytes === total - 1000,
    `status=${open.status} bytes=${open.bytes} 期望=${total - 1000}`)

  const suffix = await callRaw(p, { range: 'bytes=-50' })
  check('bytes=-50 → 206 且正好 50 字节（末尾）',
    suffix.status === 206 && suffix.bytes === 50,
    `status=${suffix.status} bytes=${suffix.bytes}`)

  const bad = await callRaw(p, { range: `bytes=${total + 10}-` })
  check('越界 Range → 416', bad.status === 416, `status=${bad.status}`)

  const head = await callRaw(p, {}, 'HEAD')
  check('HEAD → 200 且不带 body', head.status === 200 && head.bytes === 0,
    `status=${head.status} bytes=${head.bytes}`)

  const md = await callRaw(`/api/recorder/session/${encodeURIComponent(withAudio.id)}/markdown`)
  check('Markdown 也走同一套 Range 服务',
    md.status === 200 && String(md.headers['accept-ranges']).toLowerCase() === 'bytes',
    `status=${md.status} type=${md.headers['content-type']}`)
}

console.log('\n=== 卸载 ===')
for (const e of effects) e.dispose?.()
check('disposer 清空路由', routes.size === 0, `剩 ${routes.size}`)

console.log('\n=== 日志（最后 8 条）===')
for (const l of logs.slice(-30)) console.log('  ' + l)

console.log(fails.length === 0 ? '\n[smoke] 全部通过' : `\n[smoke] 失败 ${fails.length} 项: ${fails.join(', ')}`)
process.exit(fails.length === 0 ? 0 : 1)

