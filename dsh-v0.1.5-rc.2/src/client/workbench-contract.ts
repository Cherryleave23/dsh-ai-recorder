/**
 * 工作台适配契约（**本地结构类型**）。
 *
 * 工作台页面目录由 `dsh-whlab` 在运行时提供（`ctx.workbench`）。这里刻意**不**把
 * whlab 声明成依赖，而是照它的公开契约在本地复述一遍结构类型：为一个单方法服务
 * 和纯类型引入第三方包依赖并不划算，而契约一旦漂移，首次 `mount` 就会立刻暴露，
 * 不会静默失效。
 *
 * 契约来源（已核对 whlab 源码 `src/client/workbench.ts`）：
 * 每个页面项恰好是 `{ id, title, icon?, render, plugin?, pluginTitle? }`，
 * 其中 `id` 里第一个冒号前的片段就是插件键。
 */
import type { ReactNode } from 'react'

/** 页面渲染时框架注入的标准属性。 */
export interface TabRenderProps {
  /** 该页当前是否为激活标签。 */
  active: boolean
  setTitle: (title: string) => void
  setBadge: (badge?: number | string) => void
}

export interface WorkbenchMount {
  /** 全局唯一，形如 `'插件键:页面名'`。 */
  id: string
  title: string
  icon?: string
  /** `render` 完全由插件定义；其余字段是标签栏投影用的契约。 */
  render: (props: TabRenderProps) => ReactNode
  /** 覆盖从 id 推导出的插件键。 */
  plugin?: string
  /** 覆盖卡片显示名（默认等于插件键）。 */
  pluginTitle?: string
}

export interface WorkbenchFace {
  /** 把一个页面放进工作台目录；返回绑定到调用方 fiber 的回收函数。 */
  mount(definition: WorkbenchMount): () => void
  /** 在一个新标签里打开目录中的页面。 */
  open(pageId: string): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** 由 dsh-whlab 提供的工作台适配面（whlab 休眠时是 no-op 面）。 */
    workbench: WorkbenchFace
  }
}
