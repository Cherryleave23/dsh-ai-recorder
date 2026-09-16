// 检查 client 产物形状：banner 注册 id、footer 闭合、运行时 require 白名单。
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

// 热装期间插件不在 profile 里，产物只能从源码目录取；已持久安装时优先用安装位置。
const installed = join(homedir(), '.dsh', 'profiles', 'web', 'node_modules', 'dsh-ai-recorder')
const sourceDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dir = process.argv[2] ?? (existsSync(join(installed, 'lib', 'client.js')) ? installed : sourceDir)
const s = readFileSync(join(dir, 'lib', 'client.js'), 'utf8')

const banner = /__dsRecorderId = "([^"]+)"/.exec(s)
// esbuild 会在末尾追加 //# sourceMappingURL=... 注释，判定 footer 时先剥掉尾注释。
const withoutMap = s.replace(/\n?\/\/# sourceMappingURL=.*\s*$/, '')
const footerOk = withoutMap.trimEnd().endsWith('return module.exports; } });')
const reqs = [...s.matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1])
const uniq = [...new Set(reqs)]
const allowed = new Set(['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'])

console.log('  banner id      :', banner?.[1] ?? '(未找到)')
console.log('  footer 正确闭合:', footerOk)
console.log('  运行时 require :', uniq.length ? uniq.join(', ') : '(无)')
const bad = uniq.filter((r) => !allowed.has(r))
console.log('  非白名单 require:', bad.length ? bad.join(', ') : '(无)')

const fails = []
if (banner?.[1] !== 'dsh-ai-recorder') fails.push('banner id 不是 dsh-ai-recorder')
if (!footerOk) fails.push('footer 不闭合')
if (bad.length) fails.push('存在非白名单 require: ' + bad.join(', '))
console.log(fails.length ? '[client] FAIL: ' + fails.join('; ') : '[client] 产物形状 OK')
process.exit(fails.length ? 1 : 0)
