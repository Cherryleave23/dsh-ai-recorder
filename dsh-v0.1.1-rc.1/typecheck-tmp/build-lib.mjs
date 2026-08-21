// Host 侧构建：用 TS 的 transpileModule 把 unpacked-recorder/src/*.ts → lib/*.js（+ sourcemap）。
// 只做语法转译（不做类型检查；类型检查由 typecheck 单独完成），规避官方源码在 TS6 下的类型噪音。
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const here = dirname(fileURLToPath(import.meta.url))
const SRC = join(here, '..', 'plugin', 'src')
const OUT = join(here, '..', 'plugin', 'lib')

const options = {
  target: ts.ScriptTarget.ES2024,
  // 包是 "type": "module"，必须产出 ESM（import/export）。
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  esModuleInterop: true,
  sourceMap: true,
  inlineSources: false,
  jsx: ts.JsxEmit.ReactJSX,
  verbatimModuleSyntax: false,
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'client') continue
      walk(full, out)
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      out.push(full)
    }
  }
  return out
}

const files = walk(SRC)
let count = 0
for (const file of files) {
  const source = readFileSync(file, 'utf8')
  const result = ts.transpileModule(source, {
    compilerOptions: options,
    fileName: file,
    reportDiagnostics: false,
  })
  const rel = relative(SRC, file).replace(/\.ts$/, '')
  const outJs = join(OUT, rel + '.js')
  mkdirSync(dirname(outJs), { recursive: true })
  writeFileSync(outJs, result.outputText)
  if (result.sourceMapText) {
    writeFileSync(outJs + '.map', result.sourceMapText)
  }
  count += 1
}
console.log(`transpiled ${count} host files -> ${OUT}`)
