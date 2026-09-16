// 生成 dsh-v0.1.2-alpha.5/typecheck-tmp/tsconfig.json
//
// 合并官方 deepseek-harness-v0.1.2-alpha.5 的 tsconfig.base.json paths
// （@deepseek-ai/* → 该源码树），再补 react / @types.node（官方源码树无 node_modules，
// 复用 alpha.1 checkout 的 pnpm store）。
//
// 与旧版（dsh-v0.1.1-rc.1）的关键差别：基线从 rc.1 换成 alpha.5。
// 旧版 extends 到 dsh-msg-link 的 rc.1 配置，导致 typecheck 实际校验的是 rc.1 类型——
// 迁移后等于没有防线。这里直接由 alpha.5 源码树生成。
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

const BASE_DIR = 'D:/AI/dsh-coder/dsh-plugins/dsh-official/deepseek-harness-v0.1.2-alpha.5'
// 类型包 store（官方源码树自身不带 node_modules）
const TYPE_STORES = [
  'D:/AI/dsh-coder/dsh-plugins/dsh-official/deepseek-harness-v0.1.2-alpha.1/node_modules/.pnpm',
  'D:/AI/dsh-coder/dsh-deepknow/dsh-plugin-dev/node_modules/.pnpm',
]

function pickStore() {
  for (const s of TYPE_STORES) {
    if (existsSync(join(s, '@types+node@22.20.0')) && existsSync(join(s, '@types+react@18.3.31'))) return s
  }
  throw new Error('找不到含 @types/node@22.20.0 与 @types/react@18.3.31 的 pnpm store')
}

const store = pickStore()
const baseFile = join(BASE_DIR, 'tsconfig.base.json')
if (!existsSync(baseFile)) throw new Error('官方 tsconfig.base.json 不存在: ' + baseFile)

const rawBase = readFileSync(baseFile, 'utf8').replace(/^\s*\/\/[^\r\n]*\r?$/gm, '')
const base = JSON.parse(rawBase)

const paths = {}
for (const [key, targets] of Object.entries(base.compilerOptions?.paths ?? {})) {
  paths[key] = targets.map((t) => (t.startsWith('.') ? BASE_DIR + '/' + t.replace(/^\.\//, '') : t))
}

const reactTypes = store + '/@types+react@18.3.31/node_modules/@types/react'
paths['react'] = [reactTypes]
paths['react/jsx-runtime'] = [reactTypes + '/jsx-runtime.d.ts']

// 官方 base 只映射了包根；设置页槽位契约（SlotMap 增强）在 /client 子路径下，
// 而插件要注册 settings.section，必须让该模块进入编译，否则 SlotMap 里没有这个 key。
paths['@deepseek-ai/dsh-client-ui-settings/client'] = [
  BASE_DIR + '/packages/client/ui-settings/src/client/index.ts',
]
paths['@deepseek-ai/dsh-client-ui-settings/client/contract/slots'] = [
  BASE_DIR + '/packages/client/ui-settings/src/client/contract/slots.ts',
]

// 官方源码树没有 node_modules，这些第三方类型包从 store 借。
// 纯为降低官方源码自身的 «Cannot find module» 噪音；插件类型的判定不受影响。
const STORE_PACKAGES = [
  ['zustand', 'zustand@4.4.7_@types+react@18.3.31_immer@10.2.0_react@18.3.1'],
  ['immer', 'immer@10.2.0'],
  ['use-sync-external-store', 'use-sync-external-store@1.2.0_react@18.3.1'],
  ['@standard-schema/spec', '@standard-schema+spec@1.1.0'],
]
for (const [name, dir] of STORE_PACKAGES) {
  const base = `${store}/${dir}/node_modules/${name}`
  if (!existsSync(base)) continue
  paths[name] = [base]
}
const STORE_SUBPATHS = [
  ['zustand/vanilla', 'zustand@4.4.7_@types+react@18.3.31_immer@10.2.0_react@18.3.1/node_modules/zustand/vanilla.d.ts'],
  ['zustand/middleware', 'zustand@4.4.7_@types+react@18.3.31_immer@10.2.0_react@18.3.1/node_modules/zustand/middleware.d.ts'],
  ['zustand/shallow', 'zustand@4.4.7_@types+react@18.3.31_immer@10.2.0_react@18.3.1/node_modules/zustand/shallow.d.ts'],
  ['use-sync-external-store/shim/with-selector', 'use-sync-external-store@1.2.0_react@18.3.1/node_modules/use-sync-external-store/shim/with-selector.d.ts'],
]
for (const [sub, target] of STORE_SUBPATHS) {
  const abs = `${store}/${target}`
  if (existsSync(abs)) paths[sub] = [abs]
}

// @types/react-dom 的 store 目录名带 peer 后缀（`@types+react-dom@18.3.7_@types+react@18.3.31`），
// 不能硬编码，扫描实际目录名。
const reactDomDir = readdirSync(store).filter((n) => n.startsWith('@types+react-dom@')).sort().at(-1)
if (reactDomDir) {
  const rd = store + '/' + reactDomDir + '/node_modules/@types/react-dom'
  paths['react-dom'] = [rd]
  paths['react-dom/client'] = [rd + '/client.d.ts']
}

const config = {
  compilerOptions: {
    target: 'ES2023',
    module: 'ESNext',
    moduleResolution: 'Bundler',
    strict: true,
    noEmit: true,
    jsx: 'react-jsx',
    allowImportingTsExtensions: true,
    skipLibCheck: true,
    esModuleInterop: true,
    resolveJsonModule: true,
    forceConsistentCasingInFileNames: true,
    types: ['node'],
    typeRoots: [
      store + '/@types+node@22.20.0/node_modules/@types',
      store + '/@types+react@18.3.31/node_modules/@types',
    ],
    lib: ['ES2023', 'DOM', 'DOM.Iterable'],
    paths,
  },
  // client 也纳入检查（旧版把 src/client 排除在外，等于前端零类型防线）
  include: ['../src/**/*.ts', '../src/**/*.tsx'],
}

writeFileSync(join(here, 'tsconfig.json'), JSON.stringify(config, null, 2) + '\n')
console.log('[recorder] generated tsconfig with', Object.keys(paths).length, 'path entries ->', BASE_DIR)
