// 用官方 checkout 里的 TypeScript 跑 typecheck（插件自身不装 node_modules）。
//
// 先由 generate-tsconfig.mjs 生成指向 alpha.5 源码树的 tsconfig，再调 tsc。
// 输出按来源分流：插件自身 src/ 的错误 = 阻断；官方源码树自身的类型噪音 = 仅计数
// （官方源码在 TS6 下有若干已知噪音，且官方 tsconfig.base 未提供全部第三方类型路径）。
import { existsSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(here, '..')

const STORES = [
  'D:/AI/dsh-coder/dsh-plugins/dsh-official/deepseek-harness-v0.1.2-alpha.1/node_modules/.pnpm',
  'D:/AI/dsh-coder/dsh-deepknow/dsh-plugin-dev/node_modules/.pnpm',
]

function findTsc() {
  for (const store of STORES) {
    if (!existsSync(store)) continue
    const hits = readdirSync(store).filter((n) => n.startsWith('typescript@')).sort().reverse()
    for (const h of hits) {
      const tsc = join(store, h, 'node_modules', 'typescript', 'bin', 'tsc')
      if (existsSync(tsc)) return tsc
    }
  }
  throw new Error('找不到 typescript，检查 STORES 里的 pnpm store。')
}

const tsc = findTsc()
console.log('[recorder] tsc:', tsc)

const r = spawnSync(process.execPath, [tsc, '-p', join(here, 'tsconfig.json'), '--pretty', 'false'], {
  cwd: ROOT,
  encoding: 'utf8',
})

const raw = `${r.stdout ?? ''}${r.stderr ?? ''}`
const lines = raw.split(/\r?\n/).filter((l) => l.trim() !== '')

// 形如 `src/index.ts(12,3): error TS2345: ...`
const diagRe = /^(.+?)\((\d+),(\d+)\): (error|warning) (TS\d+): (.*)$/
const ours = []
const official = []
const other = []
for (const line of lines) {
  const m = diagRe.exec(line.trim())
  if (!m) {
    other.push(line)
    continue
  }
  const file = m[1].replace(/\\/g, '/')
  if (file.startsWith('src/')) ours.push(line.trim())
  else if (file.includes('dsh-official/')) official.push(line.trim())
  else other.push(line.trim())
}

if (ours.length > 0) {
  console.log(`\n=== 插件自身类型错误（${ours.length}）===`)
  for (const l of ours) console.log('  ' + l)
}
if (official.length > 0) {
  console.log(`\n[噪声] 官方源码树自身类型噪音 ${official.length} 条（不计入失败）`)
  const uniqFiles = new Set(official.map((l) => l.split('(')[0]))
  console.log('[噪声] 涉及文件：' + [...uniqFiles].slice(0, 8).join(', ') + (uniqFiles.size > 8 ? ` …共 ${uniqFiles.size} 个` : ''))
}
if (other.length > 0 && ours.length === 0) {
  console.log(`\n=== 其它输出（${other.length} 行，前 12 行）===`)
  for (const l of other.slice(0, 12)) console.log('  ' + l)
}

if (ours.length === 0) {
  console.log('\n[recorder] typecheck 通过：插件 src 0 错误')
  process.exit(0)
}
console.log(`\n[recorder] typecheck 失败：插件 src ${ours.length} 个错误`)
process.exit(1)
