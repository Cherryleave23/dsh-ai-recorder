/**
 * 环境组件的状态探测与安装/卸载执行。
 *
 * 与 presets.ts 的分工：
 *   presets.ts     纯数据 + 纯逻辑，判断「能不能卸载」（可被单测覆盖）
 *   env-manage.ts  落地执行：真的去探、真的去删
 *
 * 卸载安全的**唯一入口**是 planUninstall()：这里在执行前再判一次，
 * 绝不因为界面上按钮可点就直接删。删错了是静默降级（比如把 cam++ 删了，
 * Qwen3 仍然能跑、只是没有说话人标注），非常难查。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** FunASR 运行环境包含的包（用于「装没装」的元数据检查）。 */
export const FUNASR_PY_PACKAGES = ['funasr', 'modelscope', 'modelscope-hub', 'torch', 'torchaudio']

/**
 * 由 Python 解释器路径推出可能的 site-packages 目录。
 *
 * 注意 `python` 可能是**裸命令**（从 PATH 解析的，如 `python`），这时推不出任何路径 ——
 * 所以要能回退到「问一次解释器」。而问解释器本身只 import `site`（标准库，毫秒级），
 * 绝不能 import torch。
 */
const siteDirsCache = new Map<string, string[]>()

function sitePackagesCandidates(python: string): string[] {
  const cached = siteDirsCache.get(python)
  if (cached !== undefined) return cached
  const out: string[] = []
  if (/[\\/]/.test(python)) {
    const norm = python.replace(/[\\/][^\\/]+$/, '') // 去掉 python.exe / python
    out.push(join(norm, 'Lib', 'site-packages')) // Windows 常规布局
    out.push(join(norm, '..', 'Lib', 'site-packages')) // python.exe 在 Scripts 下的 venv
    try {
      const libDir = join(norm, 'lib')
      if (existsSync(libDir)) {
        for (const d of readdirSync(libDir)) {
          if (/^python3\.\d+$/.test(d)) out.push(join(libDir, d, 'site-packages')) // venv / POSIX
        }
      }
    } catch {
      /* 无 lib 目录 */
    }
  }
  // 裸命令或路径推导失败 → 问解释器。
  // 只 import site：这是标准库，毫秒级；**绝不 import torch**（那才是 6 秒的元凶）。
  try {
    const cmd = python || 'python'
    const raw = execFileSync(
      cmd,
      ['-c', 'import site,json;print(json.dumps(site.getsitepackages()+[site.getusersitepackages()]))'],
      { encoding: 'utf8', timeout: 15_000, windowsHide: true },
    )
    const dirs = JSON.parse(raw.trim().split('\n').pop() || '[]') as string[]
    for (const d of dirs) if (typeof d === 'string' && d) out.push(d)
  } catch {
    /* 解释器不可用 → 返回已有候选 */
  }
  const uniq = [...new Set(out.map((p) => resolve(p)))]
  siteDirsCache.set(python, uniq)
  return uniq
}

/**
 * 只读元数据判断包是否已安装（**不 import、不起进程**）。
 *
 * 为什么必须这样：之前「FunASR 运行环境」的装没装是靠 `readiness(true)`
 * 起 Python 进程真 `import torch` + `import funasr` 来判的 —— 一次 6 秒以上，
 * 所以它每次都显示「检测中…」很久。**用最贵的办法回答一个文件系统就能回答的
 * 问题，是设计错误。** dist-info 目录在不在就是权威答案，且是毫秒级。
 *
 * 返回 null = 无法确定（找不到 site-packages）—— 调用方按「不知道」处理，
 * 绝不能当成「未安装」。
 */
export function pkgInstalledByMetadata(python: string, names: string[]): boolean | null {
  const dirs = sitePackagesCandidates(python).filter((d) => existsSync(d))
  if (dirs.length === 0) return null
  const has = (name: string): boolean => {
    const prefix = name.toLowerCase().replace(/-/g, '_')
    const alt = name.toLowerCase()
    return dirs.some((d) => {
      try {
        return readdirSync(d).some((e) => {
          const low = e.toLowerCase()
          if (!low.endsWith('.dist-info')) return false
          return low.startsWith(prefix + '-') || low.startsWith(alt + '-')
        })
      } catch {
        return false
      }
    })
  }
  // funasr 是核心包：它不在就算这个环境没装
  if (!has('funasr')) return false
  return names.some((n) => has(n))
}

import {
  type EnvKey,
  ENV_COMPONENTS,
  planPresetUninstall,
  planUninstall,
  presetById,
} from './presets.js'

export interface EnvComponentStatus {
  key: EnvKey
  label: string
  detail: string
  shared: boolean
  /**
   * 是否已在本地存在。
   *
   * `null` = **还不知道**：FunASR 运行环境要靠一次真实探测才能确认，
   * 而那次探测很贵、不能放在页面加载路径上。绝不能把「不知道」当成「未安装」——
   * 那会在插件刚启动 / 改过配置后谎报未安装，而环境其实是好的。
   */
  installed: boolean | null
  /** 占用字节数（估算，目录不可读时为 null） */
  bytes: number | null
  /** 实际路径（若有） */
  paths: string[]
  /** 能否卸载：还要看当前保留的预设是否需要它 */
  canUninstall: boolean
  /** 不能卸载时说明谁在用 */
  blockedBy: string[]
  /** 给用户看的提示 */
  message: string
}

export interface EnvPaths {
  /** 系统 python 的 site-packages（funasr-py 所在环境） */
  basePython: string
  funasrModelDir: string
  qwenVenvDir: string
  qwenModelDir: string
  qwenModelName: string
}

/**
 * 目录体积缓存。
 *
 * dirSize 要递归遍历十几 GB（FunASR 权重 3.7G + qwen venv 5.3G + qwen 权重 4.5G），
 * 实测让 /presets 从 0.07s 涨到 0.77s —— 而它是**每次打开页面都会调的**。
 * 体积变化很慢，缓存 10 分钟足够；卸载/安装后由调用方主动失效。
 */
const sizeCache = new Map<string, { at: number; bytes: number | null }>()

/** 清空体积缓存（安装/卸载后调用，避免显示旧数字）。 */
export function invalidateSizeCache(): void {
  sizeCache.clear()
}

function dirSize(p: string, cap = 200_000): number | null {
  const hit = sizeCache.get(p)
  const now = Date.now()
  if (hit && now - hit.at < 600_000) return hit.bytes
  const bytes = dirSizeUncached(p, cap)
  sizeCache.set(p, { at: now, bytes })
  return bytes
}

function dirSizeUncached(p: string, cap = 200_000): number | null {
  try {
    if (!existsSync(p)) return null
    let total = 0
    let seen = 0
    const walk = (d: string): void => {
      if (seen++ > cap) return
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const f = join(d, e.name)
        try {
          if (e.isDirectory()) walk(f)
          else total += statSync(f).size
        } catch {
          /* 个别文件读不到不影响估算 */
        }
      }
    }
    walk(p)
    return total
  } catch {
    return null
  }
}

/** 一个组件在磁盘上的实际位置（可能多处）。 */
/** FunASR 模型目录下按子串找实际目录（命名随 funasr 版本变，不能写死全名）。 */
function findModelDir(p: EnvPaths, match: string): string | null {
  try {
    const root = join(p.funasrModelDir, 'models')
    const base = existsSync(root) ? root : p.funasrModelDir
    for (const name of readdirSync(base)) {
      if (name.includes(match)) return join(base, name)
    }
  } catch {
    /* 目录不存在 */
  }
  return null
}

function componentPaths(key: EnvKey, p: EnvPaths): string[] {
  if (key === 'funasr-py') return [] // 装在系统 python 里，只能靠 pip uninstall
  if (key === 'qwen-venv') return [p.qwenVenvDir]
  if (key === 'qwen-models') return [join(p.qwenModelDir, p.qwenModelName)]
  const match = ENV_COMPONENTS[key].match
  if (match === undefined) return []
  const dir = findModelDir(p, match)
  return dir === null ? [] : [dir]
}

function componentInstalled(key: EnvKey, p: EnvPaths, funasrPkgOk: boolean | null): boolean | null {
  switch (key) {
    case 'funasr-py':
      return funasrPkgOk
    case 'model-paraformer':
    case 'model-paraformer-online':
    case 'model-sensevoice':
    case 'model-vad':
    case 'model-punc':
    case 'model-spk': {
      const match = ENV_COMPONENTS[key].match
      return match !== undefined && findModelDir(p, match) !== null
    }
    case 'qwen-venv':
      return existsSync(join(p.qwenVenvDir, 'Scripts', 'python.exe')) || existsSync(join(p.qwenVenvDir, 'bin', 'python'))
    case 'qwen-models':
      return existsSync(join(p.qwenModelDir, p.qwenModelName, 'config.json'))
  }
}

/**
 * 探测全部环境组件。
 *
 * `enabled` = 用户**还想要**哪些预设（不只是当前激活的那个）。
 * 卸载判据用整个集合 —— 这就是引用计数：组件被 A、B 共用时，
 * 只要 enabled 里还有一个需要它，就不能删。
 */
export function envStatus(
  p: EnvPaths,
  enabled: string[],
  funasrPkgOk: boolean | null,
): EnvComponentStatus[] {
  const keep = enabled
  return (Object.keys(ENV_COMPONENTS) as EnvKey[]).map((key) => {
    const comp = ENV_COMPONENTS[key]
    const plan = planUninstall(key, keep)
    const paths = componentPaths(key, p)
    return {
      key,
      label: comp.label,
      detail: comp.detail,
      shared: comp.shared,
      installed: componentInstalled(key, p, funasrPkgOk),
      bytes: paths.length ? dirSize(paths[0]) : null,
      paths,
      canUninstall: plan.allowed,
      blockedBy: plan.stillNeededBy.map((x) => x.id),
      message: plan.message,
    }
  })
}

export interface UninstallResult {
  ok: boolean
  key: EnvKey
  removed: string[]
  /** funasr-py 需要 pip uninstall，列出卸掉的包 */
  pipRemoved?: string[]
  message: string
  error?: string
}

const FUNASR_PIP_PACKAGES = ['funasr', 'modelscope', 'modelscope-hub', 'funasr-onnx']

/**
 * 卸载一个环境组件。
 *
 * 三道闸门，缺一不可：
 *   ① 组件必须存在（不存在就如实说，不假装成功）
 *   ② planUninstall 必须放行（当前预设还需要它 → 拒绝）
 *   ③ 只删**已知归属**的路径（venv / 权重目录），绝不递归删父目录
 *
 * `funasr-py` 没有单一目录可删，走 pip uninstall；pip 卸 Python 包本身是幂等的。
 */
export async function uninstallEnv(opts: {
  key: EnvKey
  paths: EnvPaths
  activePresetId: string
  funasrPkgOk: boolean
  run: (cmd: string, args: string[], timeoutMs: number) => Promise<{ code: number; out: string }>
  log: (msg: string, ...rest: unknown[]) => void
}): Promise<UninstallResult> {
  const { key, paths, activePresetId, funasrPkgOk, run, log } = opts
  const comp = ENV_COMPONENTS[key]

  const plan = planUninstall(key, [activePresetId])
  if (!plan.allowed) {
    return { ok: false, key, removed: [], message: plan.message, error: plan.message }
  }
  if (!componentInstalled(key, paths, funasrPkgOk)) {
    return { ok: false, key, removed: [], message: `「${comp.label}」本来就没有安装，无需卸载。`, error: 'not-installed' }
  }

  const removed: string[] = []
  try {
    if (key === 'funasr-py') {
      // 装在哪就卸在哪：用配置里的基础 python
      const py = paths.basePython || 'python'
      log('卸载 FunASR Python 包:', FUNASR_PIP_PACKAGES.join(' '))
      const r = await run(py, ['-m', 'pip', 'uninstall', '-y', ...FUNASR_PIP_PACKAGES], 600_000)
      if (r.code !== 0) {
        return {
          ok: false,
          key,
          removed,
          message: `pip 卸载失败（exit ${r.code}）`,
          error: r.out.slice(-600),
        }
      }
      return {
        ok: true,
        key,
        removed,
        pipRemoved: FUNASR_PIP_PACKAGES,
        message: `已卸载 FunASR 运行环境（${FUNASR_PIP_PACKAGES.join('、')}）。注意：这会让所有 FunASR 系预设以及 Qwen3 的说话人分离失效。`,
      }
    }

    for (const target of componentPaths(key, paths)) {
      if (!existsSync(target)) continue
      // ③ 只删明确归属的目录，且拒绝删到盘根 / 用户主目录这种危险目标
      const guard = target.replace(/[\\/]+$/, '')
      if (guard.length < 8 || /^[A-Za-z]:$/.test(guard)) {
        return { ok: false, key, removed, message: `拒绝删除可疑路径：${target}`, error: 'unsafe-path' }
      }
      rmSync(target, { recursive: true, force: true })
      removed.push(target)
      log('已删除:', target)
    }

    const detail =
      key === 'qwen-venv'
        ? '下次使用 Qwen3-ASR 时需重新「安装 / 修复环境」'
        : '下次使用该预设时需重新下载'
    return {
      ok: true,
      key,
      removed,
      message: `已卸载「${comp.label}」${removed.length ? `（${removed.join('、')}）` : ''}。${detail}。`,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    log('卸载失败:', key, msg)
    // 部分删除要如实说，不能让用户以为环境还完整
    return {
      ok: false,
      key,
      removed,
      message: `卸载「${comp.label}」失败：${msg}${removed.length ? `（已删除 ${removed.join('、')}，环境可能不完整）` : ''}`,
      error: msg,
    }
  }
}

/** 校验预设 id 是否合法，避免把任意字符串塞进 keep 列表。 */
export function isValidPresetId(id: string): boolean {
  return presetById(id) !== undefined
}

export interface PresetUninstallResult {
  ok: boolean
  presetId: string
  /** 真正删掉的组件 */
  removedComponents: EnvKey[]
  /** 保留下来的组件（还有别人用） */
  keptComponents: Array<{ key: EnvKey; stillNeededBy: string[] }>
  enabledAfter: string[]
  message: string
  error?: string
}

/**
 * 卸载一个**预设**，并按引用计数回收它独占的组件。
 *
 * 这是用户要的语义：卸载预设 = 「我不想再用它了」，而不是逐个删组件。
 * 共用组件只有在**所有**想要它的预设都被卸掉之后才会消失。
 */
export async function uninstallPreset(opts: {
  presetId: string
  enabled: string[]
  paths: EnvPaths
  funasrPkgOk: boolean
  run: (cmd: string, args: string[], timeoutMs: number) => Promise<{ code: number; out: string }>
  log: (msg: string, ...rest: unknown[]) => void
}): Promise<PresetUninstallResult> {
  const { presetId, enabled, paths, funasrPkgOk, run, log } = opts
  const plan = planPresetUninstall(presetId, enabled)
  if (presetById(presetId) === undefined) {
    return {
      ok: false,
      presetId,
      removedComponents: [],
      keptComponents: [],
      enabledAfter: enabled,
      message: `未知预设: ${presetId}`,
      error: 'unknown-preset',
    }
  }

  const removedComponents: EnvKey[] = []
  const failures: string[] = []

  for (const key of plan.remove) {
    const r = await uninstallEnv({
      key,
      paths,
      // 这里传「卸载后仍保留的预设」：uninstallEnv 内部还会再判一次，
      // 传空数组表示「就这一个组件，没有别的预设需要它」——但真正的安全判据
      // 是 planPresetUninstall 已经算过的 remove 列表，不会误删共用组件。
      activePresetId: plan.enabledAfter[0] ?? '',
      funasrPkgOk,
      run,
      log,
    })
    if (r.ok) removedComponents.push(key)
    else if (r.error === 'not-installed') {
      // 本来就没装 —— 不算失败，也不算删掉了
      log('组件本来就没安装，跳过:', key)
    } else {
      failures.push(`${ENV_COMPONENTS[key].label}：${r.error ?? r.message}`)
    }
  }

  const parts: string[] = [`已卸载预设「${plan.label}」`]
  if (removedComponents.length) {
    parts.push(`并删除了 ${removedComponents.map((k) => ENV_COMPONENTS[k].label).join('、')}`)
  } else {
    parts.push('没有可回收的环境组件')
  }
  for (const k of plan.keep) {
    parts.push(
      `保留了 ${ENV_COMPONENTS[k.key].label}（${k.stillNeededBy.map((id) => presetById(id)?.label ?? id).join('、')} 仍在使用）`,
    )
  }
  if (failures.length) parts.push(`失败：${failures.join('；')}`)

  return {
    ok: failures.length === 0,
    presetId,
    removedComponents,
    keptComponents: plan.keep,
    enabledAfter: plan.enabledAfter,
    message: parts.join('；') + '。',
    error: failures.length ? failures.join('；') : undefined,
  }
}
