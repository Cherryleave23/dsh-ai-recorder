/**
 * dsh-ai-recorder · client 半边
 *
 * 两个界面：录音卡后端（识别环境 / 运行配置 / 蓝牙直连）与录音内容（列表 + 详情）。
 *
 * **挂载位置按可用性回退**：
 *   - 有 dsh-whlab  → 挂成两个工作台页面（whlab 的 `ctx.workbench.mount`）
 *   - 没有 whlab    → 挂成 DSH 自带右侧边栏的两个标签页（`sidebarRightTabs`）
 *
 * 两种宿主的能力形状完全不同，但都通过 `ctx.effect` 绑定到本插件的 fiber，
 * 卸载时自动收回。
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// 引入本地的工作台契约声明（给 ctx.workbench 提供类型）。纯类型导入。
import type {} from './workbench-contract.js'
import { post } from './api.js'
import { RecorderLibrary } from './RecorderLibrary.js'
import { RecorderSettings } from './RecorderSettings.js'

/**
 * 硬依赖声明。
 *
 * 这两项是真实 Cordis 插件访问服务的前提：声明了才能用 ctx.slots /
 * ctx.sidebarRightTabs。**不能省** —— 之前我把它删掉，客户端半边就再也没
 * 被挂载过（apply 一次都没执行）。
 *
 * whlab（workbench）是可选的，所以不进这里，用 ctx.get 取。
 */
export const inject = ['slots', 'sidebarRightTabs']

const PLUGIN_KEY = 'recorder'
/** 右侧边栏标签类型 id。约定 `<插件>/<名字>`，同时用作两个 Slot 的 key。 */
const RB_LIBRARY = 'dsh-ai-recorder/library'
const RB_BACKEND = 'dsh-ai-recorder/backend'

/** 右侧边栏标签定义（档位规则见 dsh-client-ui-sidebar-right 的 RANKS）。 */
interface RightTabDef {
  id: string
  kind: string
  /** 不写 = extension 档（第三方扩展的默认档） */
  priority?: 'extension' | 'builtin' | 'fallback'
  title: () => string
  guide: Array<{ order: number; title: () => string; description: () => string }>
}

interface SidebarRightTabs {
  register: (def: RightTabDef) => () => void
}

interface SlotHost {
  inject: (key: string, cb: () => () => void) => () => void
  register: (opts: Record<string, unknown>, render: (props: never) => unknown) => () => void
}

/**
 * 上报「当前会话」。
 *
 * 权威来源是会话存储本身：`sessions.list.getSnapshot().current` ——
 * 这正是内核判断"哪个会话是当前"所用的字段（`sessions.open(id)` 的语义就是
 * "Select a session as current"）。而且这个 store 有 `subscribe`，
 * 所以是**事件驱动**，不需要轮询、也不依赖组件挂载时机。
 *
 * 之前我用的是往 `conversation.session.header.utilities` 这个会话作用域 Slot
 * 里挂一个隐形上报器 —— 那个能拿到 sessionId，但依赖"组件何时挂载"，
 * 属于间接推断。直接读 store 才是确切的。
 */
function reportOpenSession(ctx: ClientContext): void {
  const sessions = (ctx as unknown as { get: (n: string) => unknown }).get('sessions') as
    | {
        list?: {
          getSnapshot: () => { current?: string | null } | undefined
          subscribe: (fn: () => void) => () => void
        }
      }
    | undefined
  const store = sessions?.list
  if (store === undefined) return

  ctx.effect(() => {
    let last: string | null = null
    const report = (): void => {
      try {
        const id = store.getSnapshot()?.current ?? null
        if (id === null || id === last) return
        last = id
        void post('/session/open', { sessionId: id }).catch(() => undefined)
      } catch {
        /* store 形状不符时静默跳过，不影响主功能 */
      }
    }
    report()
    return store.subscribe(report)
  })
}

/**
 * 挂进 DSH 自带的右侧边栏。
 *
 * 与 whlab 的工作台页面不是一回事：右侧边栏是 **session 作用域**的，
 * 标签体挂在会话的右栏里，宽度远比工作台页面窄，所以外面套一层撑满高度的容器。
 *
 * 三步（照内核 files 插件与 dsh-planner 的写法）：
 *   ① sidebarRightTabs.register  声明标签类型
 *   ② sidebar.right.pane.tab     注册标签体（key = 标签 id）
 *   ③ sidebar.right.pane.tab.title 注册标签标题
 */
function mountRightSidebar(ctx: ClientContext, tabs: SidebarRightTabs, slots: SlotHost): void {
  const defs: Array<{ id: string; kind: string; order: number; label: string; desc: string; body: () => unknown }> = [
    {
      id: RB_LIBRARY,
      // kind 必须各不相同：内核 coexists 规则里**同档位同 kind 不能共存**
      // （extension 与 builtin 可配对一次，fallback 独占），两个同 kind 会互相顶掉。
      kind: 'recorder-library',
      order: 30,
      label: '录音内容',
      desc: '录音列表 · 转写 · 纪要',
      body: () => <RecorderLibrary />,
    },
    {
      id: RB_BACKEND,
      kind: 'recorder-backend',
      order: 31,
      label: '录音卡后端',
      desc: '识别环境 · 运行配置 · 蓝牙',
      body: () => <RecorderSettings />,
    },
  ]

  for (const d of defs) {
    // ① 标签类型。priority 不写 → extension 档（第三方扩展的默认档位）
    ctx.effect(
      () =>
        tabs.register({
          id: d.id,
          kind: d.kind,
          title: () => d.label,
          guide: [{ order: d.order, title: () => d.label, description: () => d.desc }],
        }),
      `dsh-ai-recorder: right tab ${d.id}`,
    )
    // ② 标签体。必须用 slots.inject 等 Slot 声明出来再注册
    ctx.effect(
      () =>
        slots.inject('sidebar.right.pane.tab', () =>
          slots.register({ name: 'sidebar.right.pane.tab', key: d.id }, (() => (
            <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              {d.body() as never}
            </div>
          )) as never),
        ),
      `dsh-ai-recorder: right body ${d.id}`,
    )
    // ③ 标签标题
    ctx.effect(
      () =>
        slots.inject('sidebar.right.pane.tab.title', () =>
          slots.register(
            { name: 'sidebar.right.pane.tab.title', key: d.id },
            (() => <span>{d.label}</span>) as never,
          ),
        ),
      `dsh-ai-recorder: right title ${d.id}`,
    )
  }
}

export function apply(ctx: ClientContext): void {
  reportOpenSession(ctx)

  // 把「实际走了哪条挂载路径」报给主机，否则这个分支在界面上完全不可见
  // （回退路径有没有生效、被哪个服务挡住了，都无从判断）。
  //
  // 注意：`slots` / `sidebarRightTabs` 是**硬声明的依赖**（见上方 inject），
  // 必须用 `ctx.slots` / `ctx.sidebarRightTabs` 访问；`ctx.get()` 是动态插件的
  // harness API，真实插件里用它可能取不到东西。workbench（whlab）是可选的，
  // 所以它才用 ctx.get。
  // Cordis 的 Context 类型不为这两个服务生成属性声明（访问靠 inject），故一次性转型。
  const c = ctx as unknown as {
    slots: SlotHost
    sidebarRightTabs: SidebarRightTabs
    get: (name: string) => unknown
  }
  const workbench = c.get('workbench') as
    | { mount: (opts: Record<string, unknown>) => () => void }
    | undefined
  const tabs = c.sidebarRightTabs
  const slots = c.slots

  void post('/ui-surface', {
    surface: workbench !== undefined ? 'workbench' : 'rightbar',
    hasWorkbench: workbench !== undefined,
    hasTabs: tabs !== undefined,
    hasSlots: slots !== undefined,
  }).catch(() => undefined)

  // 优先 whlab：有它就挂工作台页面
  if (workbench !== undefined) {
    ctx.effect(() => {
      return workbench.mount({
        id: `${PLUGIN_KEY}:backend`,
        title: '录音卡后端',
        icon: '🎙',
        plugin: PLUGIN_KEY,
        pluginTitle: '录音卡后端',
        render: () => <RecorderSettings />,
      })
    }, 'dsh-ai-recorder: page backend')

    ctx.effect(() => {
      return workbench.mount({
        id: `${PLUGIN_KEY}:library`,
        title: '录音内容',
        icon: '📚',
        plugin: PLUGIN_KEY,
        pluginTitle: '录音卡后端',
        render: () => <RecorderLibrary />,
      })
    }, 'dsh-ai-recorder: page library')
    return
  }

  // 没有 whlab → 退回 DSH 自带的右侧边栏
  mountRightSidebar(ctx, tabs, slots)
}
