# MANIFEST — dsh-ai-recorder

> 插件依赖闭包、官方装卸命令、API 契约与验证状态。宿主升级后先对照本文件判断是否需适配。

## 身份

| 项 | 值 |
|---|---|
| 包名 | `dsh-ai-recorder` |
| 版本 | `0.1.2-alpha.5` |
| 插件 id（装配栈） | `dsh-ai-recorder` |
| 数据目录 | `~/.dsh/recorder-backend/`（`config.outDir` 可覆盖） |
| 会话目录 | `<outDir>/sessions/<session_id>/`（音频 + Markdown + 会话记录三件套，**文件名 = 录音标题**） |
| 日志身份 | `[dsh-ai-recorder]`（ctx.logger + `plugin.log`） |

## 适配目标

- **适配内核**：`@deepseek-ai/dsh 0.1.2-alpha.5`
- **官方源码基准**：`D:\AI\dsh-coder\dsh-plugins\dsh-official\deepseek-harness-v0.1.2-alpha.5\`
- **旧版本存档**：`dsh-v0.1.1-rc.1/`（适配 `0.1.1-rc.1`，保持不动）

### 消费面判定（rc.1 → alpha.5）

跨 `0.1.1-rc.2` / `0.1.2-alpha.1` / `.2` / `.3` / `.5` 五份消费面变化日志逐条核对：

| 报告破坏项 | 本插件消费点 | 判定 |
|---|---|---|
| `client/runtime` 整包移除 | `package.json` 的 `dsh.client.inject` 曾列该包 | **命中**：已换成真实存在的 `dsh-client-ui-renderer` / `-ui-settings` / `-ui-conversation` |
| `host/apiproxy` 整体移除（RPC 迁 Remote） | 自建 `/api/recorder` `/api/qs668` 前缀路由 | 不命中：webserver 是**最长前缀优先**，`/api/recorder` 胜出，不冲突 |
| `subagents.followup → sendMessage` | — | **不命中，且不可照改**：这是 *subagent 服务*的方法；本插件（旧版）用的是 *Agent 实例*的 `followup`/`inject`。新版已砍掉投递层，两者都不再用 |
| session-title / session-projection 契约变更 | 旧版只读 `sessionTitle.get()` | 不命中（新版已移除该消费） |
| `./invariant` 子路径移除、SessionSeq 品牌化、`isSeeded`、session persistence/query 各簇 | 零命中 | 不命中 |
| `client/modules` boot 协议内容寻址化 | 自建 bundle banner/footer | 不命中：注册 id = 包名，`exports["./client"]` 齐备 |

**结论：无需代码迁移**；仅 `dsh.client.inject` 声明需要更新（已改）。

## 依赖闭包

### peerDependencies（运行时，宿主提供）

| 包 | 版本 | 消费面 |
|---|---|---|
| `@deepseek-ai/cordis` | >=4.0.0-rc <5 | `Context`、`ctx.effect`、`ctx.get`、`ctx.logger` |
| `@deepseek-ai/schemastery` | ^3.18.0 | `Config` schema |

> 旧版的 `dsh-llm` / `dsh-session` / `dsh-agent` / `dsh-client-ui-slots` 四条已随 AGENT 投递层与
> client 类型修正一并移除。当前 host 产物运行时只 require `@deepseek-ai/schemastery`。

### 外部进程（非 npm 依赖，运行时探测 + 自动安装）

| 资源 | 说明 |
|---|---|
| Python 3.10+ | BLE 守护进程 + FunASR 运行时 |
| `bleak` | BLE 收端；首次自动 `pip install` |
| `funasr` + `torch` + `torchaudio` | 识别层；面板「安装 / 修复环境」一键装（CUDA 走 cu128 索引，自动回退 CPU） |
| `modelscope` | 模型权重下载 |
| `soundfile` | L2 解码链的兜底解码器（无 funasr 时 L2 也要能用） |
| 模型权重 | paraformer-zh / fsmn-vad / ct-punc / cam++ / paraformer-zh-streaming，落 `<outDir>/funasr/` |

## 官方装卸命令

```bash
# 安装（file: 协议让包管理器落实依赖并录入装配栈）
node <DSH>/lib/bin.js plugin --profile <profile> add "file:D:/AI/dsh-coder/dsh-plugins/dsh-AIrecorder/dsh-v0.1.2-alpha.5"

# 卸载
node <DSH>/lib/bin.js plugin --profile <profile> remove dsh-ai-recorder
```

- 装配层：`cordis.patch.yml`（`- insert: - id: dsh-ai-recorder`），可被 profile 层按 id 覆盖。
- 卸载自检：`src/host-self-cleanup.ts` 监听 profile manifest，连续 12 次（约 60s）检测到已移除后
  清理自持状态（`runtime-config.json` / `sync-index.json` / `plugin.log`），**保留** `sessions/`
  三件套与 `funasr/` 模型。
- ⚠️ 自检依赖 `desktopProfiles` 服务，该服务在官方 alpha.5 发行里**不存在**（三方桌面壳才提供），
  因此官方发行下自检静默降级为 no-op，不影响功能。

## API 契约（对外 HTTP）

挂载于 DSH webServer，前缀 `/api/recorder`（业务）+ `/api/qs668`（厂商测试页兼容）。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 健康检查（返回五层清单） |
| GET/POST | `/config` | 运行时配置读写（热生效并持久化） |
| POST | `/session` | 新建/复用录音会话 |
| GET | `/sessions` | 会话列表（含三件套齐备度） |
| GET | `/session/<id>` | 会话详情 + **三件套对应关系** + 齐备度 |
| POST | `/title` | 改标题（`{sessionId, title, source:'user'\|'llm'}`）→ 同步改磁盘文件名并重写 Markdown |
| DELETE | `/session/<id>` | 删除录音（整目录：音频 + Markdown + 记录），幂等，返回 `freedBytes`；有 LLM 总结时先归档 |
| POST | `/sessions/delete` | 批量删除 `{ids}`，逐条走同一路径，返回 `deleted`/`failed`/`freedBytes`/`archivedSummaries` |
| POST | `/summary` | 记入 LLM 总结 `{sessionId, text, title?}`；带 title 时接管命名。有总结的会话删除时总结会被归档 |
| GET | `/summaries` | 已归档的 LLM 总结清单 |
| GET | `/session/<id>/events` | SSE 实时文本流（`hello`/`partial`/`segment`/`artifact`/`titled`/`closed`） |
| GET | `/session/<id>/audio` | 取音频文件（**支持 Range**：206/416/HEAD，播放拖动进度条用） |
| GET | `/session/<id>/markdown` | 取 Markdown 文档（同样支持 Range） |
| POST | `/audio` | 上传音频 → 离线识别 → 三件套 |
| POST | `/batch` | 批量上传识别 |
| POST | `/qs668/transcribe` | 厂商测试页兼容（`{audioBase64, language, codec}`） |
| GET | `/asr/status` | FunASR 就绪检测（Python/torch/CUDA/模型/缺项/安装提示） |
| POST | `/asr/install` | 自动安装依赖与模型（幂等） |
| GET | `/ble/status` | BLE 收端状态（含实时流转写进度、**扫描状态与已发现设备**） |
| POST | `/ble/setup` | 探测 Python + 自动安装 bleak |
| POST | `/ble/scan` | 扫描设备 `{action:'start'\|'stop', roundMs?, autoConnect?}`；短轮次循环，扫到**连过的**设备自动连接 |
| GET/POST | `/ble/known` | 连接过的设备缓存（POST 带 `forget` 删除某条） |
| POST | `/ble/connect` | 连接（自动重试；成功后同步时间+查电量） |
| POST | `/ble/disconnect` | 断开 |
| POST | `/ble/battery` | 电量（110=充电中） |
| POST | `/ble/timesync` | 同步设备时间 |
| GET | `/ble/filelist` | 设备录音文件列表（20B 截断名） |
| POST | `/ble/download` | 下载单个录音 → 三件套（**默认 .opus 优先**） |
| POST | `/ble/realtime` | 实时转写 `{action: start\|stop\|pause\|resume}`（逐字输出） |
| POST | `/ble/sync` | 离线批量同步（.opus 优先 + 前导污染自检） |
| GET | `/ble/sync/status` | 同步状态 |

可选鉴权：请求头 `X-Recorder-Token`（`config.token` 为空则不鉴权，仅限本机）。

### client 挂载点

| slot | id | 说明 |
|---|---|---|
| `settings.section` | `recorder-backend` | 设置页「录音卡后端」：就绪检测/安装、运行配置、BLE 操作、实时逐字、三件套列表 |

## 构建与类型检查

```bash
node typecheck-tmp/generate-tsconfig.mjs   # 从 alpha.5 官方源码树生成 paths（392 条）
node typecheck-tmp/run-tsc.mjs             # 插件 src 0 错误；官方源码噪音分流计数
node build.mjs                             # esbuild：lib/index.js (host ESM) + lib/client.js (client CJS)
node typecheck-tmp/smoke-host.mjs          # 从安装目录加载产物，mock ctx 跑通路由
```

## 验证状态

| 项 | 状态 |
|---|---|
| typecheck（插件 src，alpha.5 类型环境） | ✅ 0 错误（官方源码 34 条自身噪音分流） |
| host 构建 | ✅ 77.9 kB |
| client 构建 | ✅ 26.7 kB |
| host 外部化自检 | ✅ 仅 node: + schemastery |
| 装卸验证 | ✅ `dsh plugin add file:` 成功，进 `dsh.profile.bundles` |
| host 冒烟 | ✅ 全部通过 |
| client 冒烟 | ✅ banner id / footer / require 白名单 |
| L2 真机样本（解码 + 前导污染修复） | ✅ 5/5 精确吻合 |
| **L3+L4+L5 端到端离线识别** | ✅ 真机样本 → 转写「嘿你好嘿你好你，」、时长 5.91s、2 分段、说话人分离生效；三件套齐备；L5 解析正常 |
| FunASR 自动安装 | ✅ 幂等；重复执行会识别已就绪并跳过 |
| **CUDA 加速** | ✅ torch 2.11.0+cu128 / CUDA 12.8 / RTX 5070 Ti（sm_120 Blackwell）/ GPU 实算通过 |
| **真实 DSH 实例内验证** | ✅ 实例 `i-f314c9b1` 内全部只读端点 200、`POST /audio` 端到端 **HTTP 200 / 18.7s / cuda:0 / 转写正确** |
| **前端已注册** | ✅ 出现在页面预加载清单的 47 个前端插件中 |
| **模型解析离线优先** | ✅ 5/5 模型命中本地快照；在注入了死端口代理的实例里识别依然正常 |
| L3 流式逐字 | ⏳ 需真机 BLE 推流 |
| 真机 BLE | ⏳ 待设备在手 |

### 已知环境依赖

- **代理**：pip / modelscope / funasr 的**下载**走 `HTTP_PROXY` / `HTTPS_PROXY`；指到不可用端口会
  让下载失败（本机启动器注入的是死端口 10809，可用的是 10808）。**但识别本身不受影响**——
  模型一旦落到本地，解析走本地快照目录，完全不联网。
- **torch 与 torchaudio 必须同版本**（如 2.11.0+cu128 ↔ 2.11.0+cu128）。安装脚本已保证成对安装，
  并会清理 pip 卸载失败遗留的 `~torch` 类残留目录。
- Blackwell（RTX 50 系）需要 CUDA 12.8 及以上的轮子，安装脚本使用 cu128 索引。
- **模型别名不可信**：funasr 的短别名（如 `paraformer-zh`）随版本漂移，本插件一律用显式 repo id，
  并把 `model` 直接指向本地快照目录以避免任何联网解析。

## 不许碰清单（私有实现，勿依赖）

| 项 | 应改用官方替代 |
|---|---|
| `~/.dsh/storages/session_projcache.json` 等内部 state-file | 官方 `sessions` / `sessionTitle` service |
| 宿主 profile 内部文件 | 官方 `desktopProfiles` service（仅只读探测，官方发行下不存在） |
