/**
 * 预设「公用键」判定逻辑的自测 —— 这是卸载安全性的全部依据。
 *
 * 最关键的一条：**只保留 qwen3-asr 时，FunASR 环境仍然不能卸载**，
 * 因为 Qwen3 的说话人分离靠 FunASR 的 cam++。这一条错了会导致
 * 「卸载 FunASR → Qwen 静默降级成整段识别、没有说话人标注」，非常难查。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

const STORES = [
  resolve(ROOT, 'node_modules/.pnpm'),
  'D:/AI/dsh-coder/dsh-plugins/dsh-official/deepseek-harness-v0.1.2-alpha.1/node_modules/.pnpm',
  'D:/AI/dsh-coder/dsh-deepknow/dsh-plugin-dev/node_modules/.pnpm',
]

function loadEsbuild() {
  try {
    return createRequire(resolve(ROOT, 'package.json'))('esbuild')
  } catch {
    /* 走 store 扫描 */
  }
  const candidates = []
  for (const store of STORES) {
    if (!existsSync(store)) continue
    for (const entry of readdirSync(store)) {
      if (!entry.startsWith('esbuild@')) continue
      const dir = resolve(store, entry, 'node_modules', 'esbuild')
      if (existsSync(resolve(dir, 'package.json'))) candidates.push(dir)
    }
  }
  if (!candidates.length) throw new Error('找不到 esbuild')
  const pick = candidates.sort().at(-1)
  return createRequire(resolve(pick, 'package.json'))(pick)
}

const out = resolve(HERE, '_presets.built.mjs')
loadEsbuild().buildSync({
  entryPoints: [resolve(ROOT, 'src/presets.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: out,
  logLevel: 'silent',
})

const m = await import(`file:///${out.replace(/\\/g, '/')}`)
const { planUninstall, planPresetUninstall, orphanComponents, ASR_PRESETS, ENV_COMPONENTS } = m

let ok = true
const chk = (name, cond, extra = '') => {
  if (!cond) ok = false
  console.log(`  [${cond ? 'OK  ' : 'FAIL'}] ${name}${extra ? '  ' + extra : ''}`)
}

console.log('=== 共享组件：还有预设需要时不能卸载 ===')
chk('保留全部预设 → funasr-py 不可卸载', planUninstall('funasr-py').allowed === false)
chk('保留全部预设 → model-paraformer 不可卸载', planUninstall('model-paraformer').allowed === false)
chk('保留全部预设 → qwen-venv 不可卸载', planUninstall('qwen-venv').allowed === false)

console.log('\n=== 最关键的公用键：qwen3-asr 仍需 FunASR（cam++ 说话人分离）===')
const p1 = planUninstall('funasr-py', ['qwen3-asr'])
chk('只留 qwen3-asr → funasr-py 不可卸载', p1.allowed === false, '使用者: ' + p1.stillNeededBy.map((x) => x.id).join(','))
chk('  且明确指出是 qwen3-asr', p1.stillNeededBy.some((x) => x.id === 'qwen3-asr'))
chk('  提示里说明了 cam++ 的原因', /cam\+\+/.test(p1.message))
chk('只留 qwen3-asr → cam++ 不可卸载（Qwen 的说话人分离靠它）', planUninstall('model-spk', ['qwen3-asr']).allowed === false)

console.log('\n=== qwen 独占组件：FunASR 预设保留时可以卸载 ===')
chk('只留 paraformer-zh → qwen-venv 可卸载', planUninstall('qwen-venv', ['paraformer-zh']).allowed === true)
chk('只留 paraformer-zh → qwen-models 可卸载', planUninstall('qwen-models', ['paraformer-zh']).allowed === true)
chk('只留 sensevoice → qwen-venv 可卸载', planUninstall('qwen-venv', ['sensevoice']).allowed === true)
chk('只留 sensevoice → VAD 不可卸载', planUninstall('model-vad', ['sensevoice']).allowed === false)
chk('只留 sensevoice → funasr-py 不可卸载', planUninstall('funasr-py', ['sensevoice']).allowed === false)

console.log('\n=== 孤儿组件（可提示清理）===')
const o1 = orphanComponents(['paraformer-zh'])
chk('只留 paraformer-zh → 孤儿含 qwen 两项 + SenseVoice 权重', o1.includes('qwen-venv') && o1.includes('qwen-models') && o1.includes('model-sensevoice'), o1.join(','))
chk('只留 qwen3-asr → 孤儿含两套 ASR 权重与标点（符合预期）',
  ['model-paraformer','model-sensevoice','model-punc'].every((k) => orphanComponents(['qwen3-asr']).includes(k)),
  orphanComponents(['qwen3-asr']).join(','))
chk('保留全部 → 无孤儿', orphanComponents(ASR_PRESETS.map((x) => x.id)).length === 0)

console.log('\n=== 预设能力差异确实被声明（界面要据此隐藏/禁用开关）===')
const q = ASR_PRESETS.find((x) => x.id === 'qwen3-asr')
const p = ASR_PRESETS.find((x) => x.id === 'paraformer-zh')
const s = ASR_PRESETS.find((x) => x.id === 'sensevoice')
chk('qwen3-asr 不支持实时转写', !q.features.includes('realtime'))
chk('qwen3-asr 有禁用原因说明', typeof q.limits?.realtime === 'string')
chk('qwen3-asr 不支持热词', !q.features.includes('hotword'))
chk('paraformer-zh 支持实时转写', p.features.includes('realtime'))
chk('paraformer-zh 仅中文', p.languages.join(',') === 'zh')
chk('sensevoice 支持多语种', s.languages.length >= 5)
chk('sensevoice 标为参考实现同款', s.reference === true)
chk('sensevoice 不支持热词', !s.features.includes('hotword'))

console.log('\n=== 模型按个回收（用户指出的关键点）===')
// paraformer 与 sensevoice 各自需要**不同的**权重，卸一个不该保留另一个的权重
const planSS = planPresetUninstall('sensevoice', ['paraformer-zh', 'sensevoice'])
chk('卸 sensevoice 会删 SenseVoiceSmall 权重', planSS.remove.includes('model-sensevoice'), planSS.remove.join(','))
chk('  但保留 Paraformer 权重（paraformer 还要）', !planSS.remove.includes('model-paraformer'))
chk('  也保留 VAD/标点/cam++（paraformer 还要）',
  !planSS.remove.includes('model-vad') && !planSS.remove.includes('model-punc') && !planSS.remove.includes('model-spk'))
const planPF = planPresetUninstall('paraformer-zh', ['paraformer-zh', 'sensevoice'])
chk('卸 paraformer 会删 Paraformer 权重', planPF.remove.includes('model-paraformer'), planPF.remove.join(','))
chk('  但不删 SenseVoiceSmall 权重', !planPF.remove.includes('model-sensevoice'))
console.log('\n=== 全卸光后共享组件才被回收 ===')
const all = ['paraformer-zh', 'sensevoice', 'qwen3-asr']
const last = planPresetUninstall('qwen3-asr', ['qwen3-asr'])
chk('只留 qwen3 时卸它 → 清掉 qwen 那套与它需要的 FunASR 组件',
  last.remove.includes('qwen-venv') && last.remove.includes('qwen-models') && last.remove.includes('funasr-py') && last.remove.includes('model-spk'),
  last.remove.join(','))
const noQwen = planPresetUninstall('qwen3-asr', ['paraformer-zh'])
chk('paraformer 还在时卸 qwen → 不碰 funasr 任何东西',
  !noQwen.remove.some((k) => k.startsWith('model-') || k === 'funasr-py'), noQwen.remove.join(','))
chk('  且 cam++ 被保留（paraformer 用）', !noQwen.remove.includes('model-spk'))

console.log('\n  结论:', ok ? '全部通过' : '有失败项')
process.exit(ok ? 0 : 1)
