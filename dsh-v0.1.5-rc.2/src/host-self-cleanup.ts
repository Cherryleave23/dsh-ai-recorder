/**
 * 卸载自检：监听 profile manifest，检测到本插件被移除后自动清理自持状态。
 *
 * 背景：`dsh plugin remove` 是纯 pnpm 转发器，npm v7+/pnpm 又移除了 uninstall
 * 生命周期脚本，官方卸载链路没有任何钩子可执行清理代码。唯一可行的自动机制是
 * 运行时自检——插件常驻内存，卸载删的是磁盘文件，内存代码仍可执行。
 *
 * 纪律：
 *  - 只删插件可再生的运行时状态（runtime-config / sync-index / plugin.log），
 *    保留用户资产（sessions 会话三件套、funasr 模型与 venv）；
 *  - 宽限期：连续 GRACE_CHECKS 次检测到已移除才触发，避免「remove 后立刻 add
 *    重装」误删；更新（dsh plugin update）不会让 manifest 短暂丢失包名；
 *  - 拿不到 profile 目录时不启用，回退手动脚本。
 *
 * 注意：`desktopProfiles` 服务在当前官方 alpha.5 发行里不存在（三方桌面壳才提供），
 * 因此这里的自检在官方发行下会静默降级为 no-op，不影响插件功能。
 */
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'

const PACKAGE_NAME = 'dsh-ai-recorder'
const POLL_INTERVAL_MS = 5_000
const GRACE_CHECKS = 12
/** 可再生的运行时状态（目录整体删除；文件逐个删除）。 */
const OWNED_DIRS: string[] = []
const OWNED_FILES = ['runtime-config.json', 'sync-index.json', 'plugin.log']

/** DSH Desktop 宿主公开的 desktopProfiles 服务最小类型面（只读探测用）。 */
interface DesktopProfiles {
  readonly current: { readonly name: string; readonly dir: string }
}

/** 本插件是否仍被 active profile 引用（dependencies 或 dsh.profile.bundles）。 */
function stillInstalled(profileDir: string): boolean {
  try {
    const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, unknown>
      dsh?: { profile?: { bundles?: unknown[] } }
    }
    const dependencies = manifest.dependencies ?? {}
    const bundles = manifest.dsh?.profile?.bundles ?? []
    return Object.prototype.hasOwnProperty.call(dependencies, PACKAGE_NAME) || bundles.includes(PACKAGE_NAME)
  } catch {
    // 读不到（文件缺失/原子写间隙）时保守视为仍安装，避免误删。
    return true
  }
}

/** 删除插件自持状态；目录清空后连目录一并删除。 */
function removeOwnedData(dataDir: string): void {
  if (!existsSync(dataDir)) return
  for (const name of readdirSync(dataDir)) {
    if (OWNED_DIRS.includes(name)) {
      rmSync(join(dataDir, name), { recursive: true, force: true })
    } else if (OWNED_FILES.includes(name)) {
      rmSync(join(dataDir, name), { force: true })
    }
  }
  if (readdirSync(dataDir).length === 0) rmSync(dataDir, { recursive: true, force: true })
}

/**
 * 安装卸载自检。返回 disposer；dispose 时若已确认被移除则补一次清理。
 * @param stopResources - 清理前先停后台资源（BLE 守护进程 / Qwen worker，幂等）。
 */
export function installSelfCleanup(
  ctx: Context,
  dataDir: string,
  stopResources: () => Promise<void>,
): () => void {
  const profiles = ctx.get('desktopProfiles') as DesktopProfiles | undefined
  const profileDir = profiles?.current?.dir
  if (typeof profileDir !== 'string' || profileDir === '') return () => undefined

  const log = ctx.logger(PACKAGE_NAME)
  let timer: ReturnType<typeof setInterval> | undefined
  let absentChecks = 0
  let cleaned = false

  const cleanup = (): void => {
    if (cleaned) return
    cleaned = true
    if (timer !== undefined) clearInterval(timer)
    log.info('plugin removed from profile — stopping resources and removing self-owned state')
    void stopResources().finally(() => {
      try {
        removeOwnedData(dataDir)
      } catch (error) {
        log.warn('self-owned data cleanup failed: %s', String(error))
      }
    })
  }

  const check = (): void => {
    if (cleaned) return
    if (stillInstalled(profileDir)) {
      absentChecks = 0
      return
    }
    absentChecks += 1
    if (absentChecks >= GRACE_CHECKS) cleanup()
  }

  timer = setInterval(check, POLL_INTERVAL_MS)
  timer.unref?.()

  return () => {
    if (timer !== undefined) clearInterval(timer)
    if (absentChecks >= GRACE_CHECKS) cleanup()
  }
}
