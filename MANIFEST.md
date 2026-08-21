# MANIFEST — dsh-ai-recorder

> 插件依赖闭包、官方装卸命令、API 契约与验证状态。宿主升级后先对照本文件判断是否需适配。

## 身份

| 项 | 值 |
|---|---|
| 包名 | `dsh-ai-recorder` |
| 版本 | 0.1.1 |
| 插件 id（装配栈） | `dsh-ai-recorder` |
| 数据目录 | `~/.dsh/recorder-backend/`（`config.outDir` 可覆盖） |
| 日志身份 | `[dsh-ai-recorder]`（ctx.logger + `plugin.log`） |

## 适配目标

- **当前适配内核**：`@deepseek-ai/dsh 0.1.1-rc.1`（官方源码 `dsh-official/deepseek-harness-v0.1.1-rc.1/`，根 package.json version 已核验）。
- **适配方式**：单目录原地适配（非 dsh-v 多版本目录）。typecheck 环境 `typecheck-tmp/recorder/tsconfig.rc1.json`（extends dsh-msg-link rc.1 配置，paths 指向 rc.1 源码）。
- **适配结论**：**无需代码迁移**。消费面闸门（Stage 5）逐项取证，dsh-ai-recorder 不命中任何破坏性变更（详见下方判定表）。

### 消费面判定表（0.1.0-rc.7 → 0.1.1-rc.1，报告 `dsh-official/docs/0.1.1-rc.1.md`）

| 报告破坏项 | 插件消费点证据 | 判定 |
|---|---|---|
| `commands.execute` 插入必填 `images` | 全源码零命中 `commands.execute` / `.execute(` | 不命中 |
| `session-projection` 签名重构（schema→stateSchema） | 全源码零命中 `sessionProjection` / `ProjectionDefinition` / `projection` | 不命中 |
| `credentials/updated` → `reference-updated` | 全源码零命中 `credentials/updated` | 不命中 |
| 移除 `client/schema-form`、`client/web-react` | 全源码零命中；peerDeps 无此二包 | 不命中 |
| `webServer` index 注入（tapIndex→index-inject） | 零命中 `tapIndex` / `index-inject`（仅用 `webServer.register` 挂路由，无破坏） | 不命中 |
| `credentials/authorization` 等新增能力 | 零消费（可选，无需动作） | 不命中 |

- 消费的官方 service（`agents.get` / `agent.followup` / `sessions.*` / `llm.stream` / `agentDefaultModel.currentSelection` / `webServer.register` / `sessionTitle` 读侧）在 rc.1 均无签名破坏（报告哨兵 + 哨兵清单确认）。
- **typecheck 实证**：`tsc --noEmit -p tsconfig.rc1.json` → 插件 src 0 错误（9 个官方源码噪音，与 rc.7 同型）。

## 依赖闭包

### peerDependencies（运行时，宿主提供）

| 包 | 版本 | 消费面 |
|---|---|---|
| `@deepseek-ai/cordis` | >=4.0.0-rc <5 | `Context`、`ctx.effect`、`ctx.get`、`ctx.inject` |
| `@deepseek-ai/dsh-llm` | >=0.0.1-rc <2 | `createUserMessage`、`ReasoningEffortId`、`LlmService.stream` |
| `@deepseek-ai/dsh-session` | >=0.0.1-rc <2 | `SessionId`、`SessionStore`、`Session` |
| `@deepseek-ai/schemastery` | ^3.18.0 | `Config` schema |
| `@deepseek-ai/dsh-client-ui-slots` | >=0.0.1-rc <2 | client `slots` service |

### 类型-only（devDependencies，编译后擦除）

| 包 | 用途 |
|---|---|
| `@deepseek-ai/dsh-agent` | `Agent` 类型、`agentDefaultModel.currentSelection()` 的 `ModelSelection` |

### 外部进程（非 npm 依赖，运行时探测）

| 资源 | 说明 |
|---|---|
| Python 3.9+ | BLE 收端 + 本地 ASR；`bleak` 首次自动 pip 安装 |
| faster-whisper 模型 | `~/.dsh/recorder-backend/whisper/faster-whisper-base/`（4 文件） |
| Qwen3-ASR | `qwen-venv` + 模型目录（可选，GPU） |
| whisper.cpp CLI | 可选本地引擎 |

## 官方装卸命令

```bash
# 安装（file: 协议让包管理器落实依赖并录入装配栈）
dsh plugin add file:D:\AI\默认工作流\dsh-plugins\dsh-AIrecorder

# 卸载（移除包、依赖闭包与装配登记；自持状态由运行时自检自动清理）
dsh plugin remove dsh-ai-recorder
```

- 装配层：`cordis.patch.yml`（`- insert: - id: dsh-ai-recorder`），可被 profile 层按 id 覆盖。
- 卸载自检：`src/self-cleanup.ts` 监听 profile manifest，连续 12 次（约 60s）检测到已移除后清理自持状态（runtime-config / deliver-target / sync-index / pending-deliveries / history / plugin.log / session-configs），**保留** recordings / whisper / qwen / qwen-venv / sessions / notes 用户资产。

## API 契约（对外 HTTP）

挂载于 DSH webServer，前缀 `/api/recorder`（业务）+ `/api/qs668`（官方测试网页兼容）。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/recorder/session` | 新建/复用录音会话 |
| POST | `/api/recorder/audio` `/stream` | 上传音频 → 转写 → 追加会话（按模式自动投递） |
| POST | `/api/recorder/session/<id>/process` `/revise` | 模式投递 / 文本修订 |
| POST | `/api/recorder/config` | 全局/会话配置（`?sessionId=` 会话覆盖，`clear:true` 清除） |
| POST | `/api/recorder/deliver-target` | 设置默认投递目标 |
| POST | `/api/recorder/batch` | 批量转写 |
| GET | `/api/recorder/session/<id>` `/events` | 会话详情 / SSE 事件流 |
| GET | `/api/recorder/sessions` `/files` `/notes` `/notes/<id>` `/jobs` `/dsh-sessions` `/config` `/health` | 查询类 |
| POST | `/api/recorder/open-model-dir` | 打开模型目录 |
| GET/POST | `/api/recorder/ble/*` | BLE 收端：status/setup/scan/connect/disconnect/battery/timesync/filelist/download/realtime/sync/pending |
| POST | `/api/qs668/transcribe` | 官方兼容 `{audioBase64, language, codec}` |

### client 挂载点

| slot | id | 说明 |
|---|---|---|
| `settings.section` | `dsh-ai-recorder-settings` | 设置页全局卡片 |
| `conversation.view` | `dsh-ai-recorder-panel` | 会话内覆盖面板 |

## 验证状态

| 项 | 状态 |
|---|---|
| typecheck（插件 src，rc.1 类型环境） | ✅ 0 错误（`tsconfig.rc1.json`，9 个官方源码噪音与 rc.7 同型） |
| host build（build-lib.mjs） | ✅ 9 文件 → lib/ |
| client build（tsdown） | ✅ client.js 35.94 kB |
| 装卸验证 | ✅ 2026-08-21 实测通过：`dsh plugin add file:<目录>` 安装（bundles/dependencies/node_modules 闭包完整）→ 重启加载（日志 + HTTP health）→ `dsh plugin remove` 卸载（bundles/dependencies/node_modules 移除）→ 自检清理（60s 宽限期后自持状态清除、用户资产保留）→ 重装恢复 |
| 真机 BLE 实测 | ⏳ 待真机（scan/connect/download/realtime） |

## 不许碰清单（私有实现，勿依赖）

| 项 | 应改用官方替代 |
|---|---|
| `~/.dsh/storages/session_projcache.json` 等内部 state-file | 官方 `sessions` / `sessionTitle` service |
| 宿主 profile 内部文件 | 官方 `desktopProfiles` service（仅只读探测） |
