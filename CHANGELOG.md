# CHANGELOG — dsh-ai-recorder

## 0.1.1（2026-08-21）适配 DSH 内核 0.1.1-rc.1

适配 `@deepseek-ai/dsh` 内核 `0.1.0-rc.7 → 0.1.1-rc.1`（报告 `dsh-official/docs/0.1.1-rc.1.md`）。**无代码迁移**——消费面闸门逐项取证，插件不命中任何破坏性变更。

### 命中表（报告破坏项 → 插件判定）

| 报告破坏项 | 判定 | 依据 |
|---|---|---|
| `commands.execute` 插入必填 `images` | 不命中 | 全源码零命中 `commands.execute` |
| `session-projection` 签名重构（schema→stateSchema） | 不命中 | 全源码零命中投影声明 |
| `credentials/updated` → `reference-updated` | 不命中 | 全源码零命中凭证事件 |
| 移除 `client/schema-form` / `client/web-react` | 不命中 | 零依赖、零消费 |
| `webServer` index 注入（tapIndex→index-inject） | 不命中 | 仅用 `webServer.register` 挂路由 |

### 变更

- **版本**：`0.1.0` → `0.1.1`（patch，标记 rc.1 内核适配）。
- **typecheck 环境**：新增 `typecheck-tmp/recorder/tsconfig.rc1.json`（extends dsh-msg-link rc.1 配置，paths 指向 `dsh-official/deepseek-harness-v0.1.1-rc.1/`）；`package.json` typecheck script 改指该配置。
- **MANIFEST**：新增「适配目标」节 + 消费面判定表；验证状态标注 rc.1 类型环境。

### 兼容性

- 对外 HTTP API、client 挂载点、数据目录格式**全部不变**。
- peerDependencies 范围已覆盖 rc.1（cordis 4.0.1、schemastery 3.18.1、dsh-llm/session/ui-slots 0.1.1-rc.1），无需调整。
- 消费的官方 service（agents/sessions/llm/agentDefaultModel/webServer/sessionTitle 读侧）在 rc.1 均无签名破坏。

### 验证

- typecheck（rc.1 类型环境）：插件 src **0 错误**；9 个官方源码噪音（core/session、llm/llm、vendor/cordis）与 rc.7 同型。

## 0.1.0（2026-08-21）优雅化改造

由 `@dsh-external/dsh-recorder-backend`（unpacked-recorder 阶段产物）重构而来，**全部 HTTP API 与 client 挂载点保持兼容**，仅调整装配与生命周期。

### 变更

- **包名/身份**：`@dsh-external/dsh-recorder-backend` → `dsh-ai-recorder`；去掉 `private` 与 `@dsh-external` 手动注入 scope；logger/事件源/挂载点 id 统一为 `dsh-ai-recorder`。
- **官方渠道装卸**（判据 6）：新增 `cordis.patch.yml` bundle patch + `dsh.bundle.patch`；安装改为 `dsh plugin add file:<目录>`，卸载 `dsh plugin remove dsh-ai-recorder`；移除 `dev_inject_plugin` 手拷注入路径。
- **卸载自检清理**：新增 `src/self-cleanup.ts`（复用 dsh-msg-link 模式），卸载后自动清理自持状态（runtime-config / deliver-target / sync-index / pending-deliveries / history / plugin.log / session-configs），**保留**录音/模型/会话/笔记用户资产。
- **生命周期修复**（判据 4）：teardown 释放 Qwen worker 子进程（`disposeQwenWorker` 导出并在卸载时调用），修复插件卸载后 qwen 子进程残留泄漏。
- **最小面**（判据 5）：删除未引用的死代码 `src/protocol.ts`（BLE 帧解析在 `scripts/ble_central.py`，TS 侧不重复维护）；exports 精简为 `default`（对齐 dsh-c 约定，去掉 types 引用）。
- **文档产物**（§11）：新增 `MANIFEST.md`（依赖闭包/装卸命令/API 契约/验证状态）、`CHANGELOG.md`；README 安装方式改为官方渠道。

### 兼容性

- 对外 HTTP API（`/api/recorder/*`、`/api/qs668/*`）**不变**。
- client 挂载点（`settings.section` / `conversation.view`）**不变**（仅 id 字符串随包名更新）。
- 数据目录 `~/.dsh/recorder-backend/` 与既有数据格式**不变**，升级可无缝沿用旧数据。
- 依赖闭包不变（peer 面与旧版一致）。
