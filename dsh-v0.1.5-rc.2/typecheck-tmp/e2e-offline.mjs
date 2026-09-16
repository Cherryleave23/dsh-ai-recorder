/**
 * L3/L4/L5 端到端：拿真机样本走完整管线，验证「识别文本 + 三件套落盘」。
 *
 * 用法：node typecheck-tmp/e2e-offline.mjs [样本路径]
 */
import { EventEmitter } from 'node:events'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const INSTALL_DIR = join(homedir(), '.dsh', 'profiles', 'web', 'node_modules', 'dsh-ai-recorder')
const OUT_DIR = join(homedir(), '.dsh', 'recorder-backend')
const SAMPLE = process.argv[2] ?? 'D:/AI/dsh-coder/recorder-bt/device-audio/note20260820-210054.opus'

const entry = join(INSTALL_DIR, 'lib', 'index.js')
if (!existsSync(entry)) { console.error('找不到 host 产物:', entry); process.exit(1) }
if (!existsSync(SAMPLE)) { console.error('找不到样本:', SAMPLE); process.exit(1) }

function makeReq(method, url, body) {
  const req = new EventEmitter()
  req.method = method
  req.url = url
  req.headers = { 'content-type': 'application/json' }
  req.destroy = () => undefined
  const buf = body === undefined ? null : Buffer.from(JSON.stringify(body))
  process.nextTick(() => { if (buf) req.emit('data', buf); req.emit('end') })
  return req
}
function makeRes() {
  return {
    statusCode: 0, chunks: [], headersSent: false,
    writeHead(c, h) { this.statusCode = c; this.headers = h ?? {}; this.headersSent = true },
    write(c) { this.chunks.push(Buffer.from(c)); return true },
    end(c) { if (c != null) this.chunks.push(Buffer.from(c)); this.ended = true },
  }
}

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
  effect(fn, label) { const d = fn(); effects.push({ label, dispose: d }); return () => d?.() },
  get() { return undefined },
  logger: {
    info: (...a) => { const l = ['info', ...a].join(' '); logs.push(l); if (process.env.E2E_VERBOSE) console.log('  ' + l) },
    warn: (...a) => logs.push(['warn', ...a].join(' ')),
    error: (...a) => logs.push(['error', ...a].join(' ')),
    debug: () => undefined,
  },
}

const mod = await import('file://' + entry.replace(/\\/g, '/'))
mod.apply(ctx, mod.Config({ outDir: OUT_DIR }))

console.log('=== 就绪检查 ===')
const status = await (async () => {
  const req = makeReq('GET', '/api/recorder/asr/status')
  const res = makeRes()
  await routes.get('prefix:/api/recorder')(req, res)
  return JSON.parse(Buffer.concat(res.chunks).toString('utf8'))
})()
console.log('  ready        :', status.ready)
console.log('  funasr       :', status.status.funasrVersion, ' torch:', status.status.torchVersion, ' device:', status.status.device)
console.log('  missing      :', JSON.stringify(status.status.missing))

console.log('\n=== 端到端识别（真机样本）===')
console.log('  样本:', SAMPLE, `(${(statSync(SAMPLE).size / 1024).toFixed(1)} KB)`)
const t0 = Date.now()
const req = makeReq('POST', '/api/recorder/audio', { audioBase64: readFileSync(SAMPLE).toString('base64'), ext: 'opus' })
const res = makeRes()
await routes.get('prefix:/api/recorder')(req, res)
const json = JSON.parse(Buffer.concat(res.chunks).toString('utf8'))
const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
console.log(`  HTTP ${res.statusCode}  耗时 ${elapsed}s`)

if (!json.ok) {
  console.log('  失败:', json.error)
  console.log('\n  最后日志:')
  for (const l of logs.slice(-6)) console.log('    ' + l)
  process.exit(1)
}

console.log('  sessionId    :', json.sessionId)
console.log('  时长         :', (json.durationMs / 1000).toFixed(2), 's')
console.log('  模型         :', json.model, '/', json.device)
console.log('  分段数       :', json.segments?.length ?? 0)
console.log('  说话人       :', json.segments?.some((s) => s.speaker !== undefined) ? '有标注' : '无')
console.log('  文本         :', JSON.stringify(json.text?.slice(0, 160)))
if (json.segments?.length) {
  console.log('  前 3 段      :')
  for (const s of json.segments.slice(0, 3)) {
    console.log(`    [${(s.start / 1000).toFixed(1)}-${(s.end / 1000).toFixed(1)}s] spk=${s.speaker ?? '-'} ${s.text}`)
  }
}

console.log('\n=== L4/L5 三件套 ===')
const dir = join(OUT_DIR, 'sessions', json.sessionId)
console.log('  会话目录     :', dir)
const files = existsSync(dir) ? readdirSync(dir) : []
console.log('  目录内容     :', files.join(', ') || '(空)')
const fails = []
const need = ['audio.ogg', 'transcript.md', 'session.json']
for (const f of need) {
  const ok = files.includes(f)
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${f}`)
  if (!ok) fails.push(f)
}

if (files.includes('transcript.md')) {
  const md = readFileSync(join(dir, 'transcript.md'), 'utf8')
  console.log('\n=== Markdown 前 22 行 ===')
  for (const l of md.split('\n').slice(0, 22)) console.log('  ' + l)
}

// L5 解析入口
const detailReq = makeReq('GET', `/api/recorder/session/${json.sessionId}`)
const detailRes = makeRes()
await routes.get('prefix:/api/recorder')(detailReq, detailRes)
const detail = JSON.parse(Buffer.concat(detailRes.chunks).toString('utf8'))
const arts = detail.artifacts
console.log('\n=== L5 对应关系 ===')
console.log('  音频    :', arts?.audio?.present ? `✓ ${arts.audio.bytes}B` : '✗', arts?.audio?.ref)
console.log('  Markdown:', arts?.markdown?.present ? `✓ ${arts.markdown.bytes}B` : '✗', arts?.markdown?.ref)
console.log('  实时流  :', arts?.stream?.ref)
console.log('  齐备度  :', detail.completeness)
if (!(arts?.audio?.present && arts?.markdown?.present)) fails.push('L5 解析')

for (const e of effects) e.dispose?.()
console.log(fails.length ? `\n[e2e] 失败: ${fails.join(', ')}` : '\n[e2e] 全部通过')
process.exit(fails.length ? 1 : 0)
