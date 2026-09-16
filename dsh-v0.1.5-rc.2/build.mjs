/**
 * dsh-ai-recorder — build script（esbuild，一次构建两个 half）。
 *
 *   lib/index.js   host half    ESM,  node22   —— 五层管线 + HTTP 路由
 *   lib/client.js  client half  CJS,  browser  —— 包在 window.__ModuleLoader__.load 工厂契约里
 *
 * `@deepseek-ai/*` 一律保持 external：已安装插件的 node_modules 是 profile 的链接，
 * 运行时由 DSH 模块加载器解析成与宿主同一份模块实例。
 *
 * 用法：node build.mjs
 */
import { createRequire } from 'node:module'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ID = 'dsh-ai-recorder'

/** esbuild 兜底来源：插件自身没装就借用官方 checkout 的 pnpm store。 */
const ESBUILD_STORES = [
  'D:/AI/dsh-coder/dsh-plugins/dsh-official/deepseek-harness-v0.1.2-alpha.1/node_modules/.pnpm',
  'D:/AI/dsh-coder/dsh-deepknow/dsh-plugin-dev/node_modules/.pnpm',
]

function loadEsbuild() {
  const localRequire = createRequire(resolve(HERE, 'package.json'))
  try {
    return localRequire('esbuild')
  } catch {
    /* 本地没装，走 store 扫描 */
  }
  const candidates = []
  for (const store of ESBUILD_STORES) {
    if (!existsSync(store)) continue
    for (const entry of readdirSync(store)) {
      if (!entry.startsWith('esbuild@')) continue
      const dir = resolve(store, entry, 'node_modules', 'esbuild')
      if (existsSync(resolve(dir, 'package.json'))) candidates.push(dir)
    }
  }
  if (candidates.length > 0) {
    const pick = candidates.sort().at(-1)
    return createRequire(resolve(pick, 'package.json'))(pick)
  }
  throw new Error(
    'cannot find esbuild.\n'
    + '  Run `pnpm install` here, or point ESBUILD_STORES at a DSH checkout store.',
  )
}

const esbuild = loadEsbuild()

/** 平台种子模块：由 DSH 运行时模块表提供，不能打进包里。 */
const CLIENT_EXTERNAL = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client']

/** host half 允许留给运行时解析的裸标识符白名单。 */
const HOST_RUNTIME_EXTERNAL_ALLOWLIST = new Set([
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/schemastery',
])

const externalPlatform = (tag) => ({
  name: `recorder-external-${tag}`,
  setup(build) {
    build.onResolve({ filter: /^@deepseek-ai\// }, (args) => ({ path: args.path, external: true }))
    build.onResolve({ filter: /^node:/ }, (args) => ({ path: args.path, external: true }))
  },
})

const hostBundle = {
  entryPoints: [resolve(HERE, 'src/index.ts')],
  outfile: resolve(HERE, 'lib/index.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  logLevel: 'info',
  plugins: [externalPlatform('host')],
}

const clientBundle = {
  entryPoints: [resolve(HERE, 'src/client/index.tsx')],
  outfile: resolve(HERE, 'lib/client.js'),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: ['es2020'],
  jsx: 'automatic',
  sourcemap: true,
  logLevel: 'info',
  external: CLIENT_EXTERNAL,
  plugins: [externalPlatform('client')],
  banner: {
    js: [
      // 热安装换键适配：loader 按**服务键**分发 client bundle，而服务键在
      // `pm_tempLoad` 同名冲突时会变成 `dsh-ai-recorder-hotN`，构建时无从得知。
      // 若 bundle 仍以旧 id 注册，loader 会报 "loaded without registering"，
      // 整个插件的前端都起不来。所以这里在运行期从自身脚本 URL 反推服务键：
      //   /plugins/??@deepseek-ai/x/client.js,dsh-ai-recorder-hot1/client.js&rev=…
      // 依次尝试 document.currentScript，再回退到扫描页面里所有 /plugins/ 脚本
      // （currentScript 只在经典脚本同步执行时有值，直连 import 时为 null）。
      // 匹配不到（直装、或将来改了包名）就回退到构建时的 id —— 与旧行为一致。
      clientIdResolver(),
      `window.__ModuleLoader__.load({ id: __dsRecorderId, factory: (require) => {`,
      'var module = { exports: {} };',
      'var exports = module.exports;',
      'Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
    ].join('\n'),
  },
  footer: { js: 'return module.exports; } });' },
}

/**
 * 生成「运行期反推服务键」的横幅片段。
 *
 * 为什么不能只信 `document.currentScript`：它只在经典脚本**同步执行**期间有值，
 * 由 import() 或延迟注入时是 null。所以再加一条兜底：扫页面里所有 `/plugins/`
 * 脚本标签，谁含本包名前缀就用谁。
 */
function clientIdResolver() {
  const prefix = JSON.stringify(PLUGIN_ID)
  return [
    `var __dsRecorderId = ${prefix};`,
    'try {',
    '  var __dsUrls = [];',
    '  if (typeof document !== "undefined") {',
    '    if (document.currentScript && document.currentScript.src) __dsUrls.push(document.currentScript.src);',
    '    var __dsTags = document.querySelectorAll("script[src]");',
    '    for (var __i = 0; __i < __dsTags.length; __i++) __dsUrls.push(__dsTags[__i].src);',
    '  }',
    `  var __dsRe = new RegExp("(${PLUGIN_ID}[^\\\\/,.?&]*)/client\\\\.js");`,
    '  for (var __j = 0; __j < __dsUrls.length; __j++) {',
    '    var __m = __dsRe.exec(__dsUrls[__j] || "");',
    '    if (__m && __m[1]) { __dsRecorderId = __m[1]; break; }',
    '  }',
    '} catch (__e) { /* 反推失败就用构建时的 id */ }',
  ].join('\n')
}

/** 构建后自检：host 产物不允许残留不可解析的裸标识符。 */
function assertHostExternals(outfile) {
  const source = readFileSync(outfile, 'utf8')
  const specifiers = new Set()
  for (const m of source.matchAll(/(?:^|[;\n])\s*(?:import|export)[\s\S]*?from\s*["']([^"']+)["']/g)) {
    specifiers.add(m[1])
  }
  for (const m of source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) specifiers.add(m[1])
  const violations = [...specifiers].filter((s) => !s.startsWith('node:') && !HOST_RUNTIME_EXTERNAL_ALLOWLIST.has(s))
  if (violations.length > 0) {
    throw new Error(
      'host bundle imports packages an installed plugin cannot resolve:\n'
      + violations.map((v) => `  - ${v}`).join('\n')
      + '\n\nAdd it to HOST_RUNTIME_EXTERNAL_ALLOWLIST only after verifying DSH ships runtime JS for it.',
    )
  }
  return [...specifiers]
}

await Promise.all([esbuild.build(hostBundle), esbuild.build(clientBundle)])
const hostExternals = assertHostExternals(resolve(HERE, 'lib/index.js'))
console.log('[recorder] built lib/index.js + lib/client.js')
console.log(`[recorder] host runtime imports: ${hostExternals.length === 0 ? '(none)' : hostExternals.join(', ')}`)
