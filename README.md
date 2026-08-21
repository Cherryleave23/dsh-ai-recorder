# dsh-ai-recorder

AI 录音卡（NextProto N0001 / CB08 · QS668）后端：**蓝牙直连收端（自实现 BLE Central）** → 可插拔 ASR 转写 → 按模式投递给 DSH 会话中的 AGENT 处理。

```
[录音卡设备] --BLE(AE20)--> [本插件内置 Central(bleak 子进程)] --agent.followup--> [DSH 会话 AGENT]
                                                                        │
                                                                        ├─ ASR: mock / faster-whisper / whisper.cpp / OpenAI 兼容
                                                                        ├─ 模式: work（直接给）/ summary（会议记录）
                                                                        └─ 输出: 会话消息 / MD 笔记 / 历史
```

## 功能

- **蓝牙直连（自实现收端）**：插件内置 bleak Central（`scripts/ble_central.py` 守护进程），
  可直接扫描/连接 CB08，支持电量、时间同步、文件列表、录音文件下载、实时转写流，无需外部中转工具
- HTTP 服务（挂载于 DSH webServer）：`/api/qs668/*`（兼容官方测试网页）、`/api/recorder/*`
- 会话模型：录音分段聚合、transcript 累积、SSE 事件流、批处理
- **处理模式**（运行时可选、持久化）：
  - `work`：转写内容 + 任务指令 → 直接投给 AGENT
  - `summary`：转写内容 + "会议记录处理"指令 → AGENT 生成结构化纪要
- **投递**：录音处理结果进入指定 DSH 会话（agent.followup 唤醒 AGENT 真实处理）
- **配置粒度**：全局配置（设置页）+ 每会话覆盖（会话内面板）
- ASR 可插拔：mock / faster-whisper（本地）/ whisper.cpp（本地）/ OpenAI 兼容（远程）

## 依赖

### 运行时依赖

| 依赖 | 必需 | 说明 |
|---|---|---|
| DSH Desktop（宿主） | ✅ 必需 | 插件运行环境，提供 webServer / agents / llm 等服务 |
| Node.js ≥ 18 | ✅ 必需 | DSH Desktop 自带 |
| Python 3.9+ | ⚠️ 蓝牙直连需要 | **自动 pip 安装 bleak**（首次使用时）；也可手动 `pip install bleak` |
| Qwen3-ASR（本地 GPU） | 可选 | 转写引擎 `qwen-audio-py`：Python 3.12 venv + `pip install -U qwen-asr` + `modelscope download --model Qwen/Qwen3-ASR-1.7B`；中文/方言准确率显著高于 whisper-base（需 NVIDIA GPU） |
| `faster-whisper`（pip 包） | ⚠️ 本地 ASR 需要 | `pip install faster-whisper` |
| faster-whisper 模型文件（4 个） | ⚠️ 本地 ASR 需要 | model.bin / config.json / tokenizer.json / vocabulary.txt，约 145MB |
| whisper.cpp CLI + ggml 模型 | 可选 | 本地替代引擎（whisper-cpp-cli provider） |
| OpenAI 兼容端点（含 API Key） | 可选 | 远程 ASR（openai-compat provider），在设置页配置端点 |

> 蓝牙直连使用与本地 ASR 相同的 Python 解释器（`pythonPath` 配置 / `DSH_RECORDER_PYTHON` 环境变量）。
> 无 Python / 无模型时插件自动回退 `mock`（占位转写），其余功能不受影响。

### 构建依赖（开发者）

- DSH 源码 checkout（build.sh 自动探测，可用 `DSH_CHECKOUT` 指定）
- TypeScript 5.x、tsdown（构建脚本自动链接/本地安装）

## 安装

```bash
# 1. 构建（在插件目录）
npm run build        # host 侧：src → lib（transpileModule，不查类型）
npm run build:client # client 侧：src/client/index.tsx → lib/client.js（tsdown）

# 2. 官方渠道安装（DSH 插件管理命令，file: 协议让包管理器落实依赖并录入装配栈）
dsh plugin add file:D:\AI\默认工作流\dsh-plugins\dsh-AIrecorder

# 3. 卸载（同一命令移除包、依赖闭包与装配登记；自持状态由运行时自检自动清理）
dsh plugin remove dsh-ai-recorder
```

> 类型检查独立于构建（§3 三平面）：`npm run typecheck`（tsconfig 指向 `typecheck-tmp/recorder`，peer 类型经 paths 映射到官方 checkout）。

## ASR 模型放置

插件**自动探测**模型目录：有模型 → 真实转写；没有 → 自动回退 mock。

- 默认模型目录：`<DSH 数据目录>/recorder-backend/whisper/faster-whisper-base/`
  （Windows 通常为 `C:\Users\<你>\.dsh\recorder-backend\whisper\faster-whisper-base\`）
- 放入 4 个文件：`model.bin`、`config.json`、`tokenizer.json`、`vocabulary.txt`
- 获取：ModelScope 仓库 `pengzhendong/faster-whisper-base`（如 `https://modelscope.cn/models/pengzhendong/faster-whisper-base/resolve/master/model.bin`）
- 模型目录可在「设置 → 录音卡后端」中修改（持久化），并有「📂 打开」按钮直接弹出资源管理器
- 环境变量覆盖：`DSH_RECORDER_WHISPER_DIR`（指向包含 `faster-whisper-base` 的父目录）、`DSH_RECORDER_PYTHON`（指定 Python 解释器）

## 配置

| 配置项 | 位置 | 说明 |
|---|---|---|
| 流转目标（默认投递会话） | 设置页 | 录音会话创建时自动绑定到该 DSH 会话 |
| 处理模式（none/work/summary） | 设置页 + 会话面板 | 全局默认 + 每会话覆盖 |
| ASR 引擎 | 设置页 + 会话面板 | 只显示可用的引擎（本地/外部 API 分类） |
| 模型目录 | 设置页 | 可改、可打开文件夹 |
| 语言 | 设置页 | 转写语言（zh/en/ja/ko/ru/auto） |

**优先级**：会话覆盖 > 全局配置。会话面板保存的内容只影响该会话；「清除覆盖」恢复全局默认。

## API 参考（面向 AGENT）

> 所有端点位于 `http://127.0.0.1:63510`（DSH webServer）。音频以 Base64 传入 JSON。

### 典型流程

```
1.（可选）POST /api/recorder/config   选择模式/ASR（也可用面板）
2. POST /api/recorder/session         创建录音会话（自动绑定默认投递目标）
3. POST /api/recorder/audio|stream    上传音频 → ASR 转写 → 追加会话 →（按模式自动投递）
4. POST /api/recorder/session/<id>/process  手动触发模式投递
```

### 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/recorder/session` | 新建/复用录音会话 `{sessionId?, language?, mode?, dshSessionId?}` |
| POST | `/api/recorder/audio` | 上传音频 `{sessionId?, audioBase64, ext: wav\|opus\|ogg\|auto, language?}` |
| POST | `/api/recorder/stream` | 实时流分段（同 audio，按 opus 处理） |
| POST | `/api/recorder/session/<id>/process` | 模式投递 `{mode: work\|summary, params?: {instruction?}}` |
| POST | `/api/recorder/session/<id>/revise` | 文本级修订（LLM 润色全文） |
| POST | `/api/recorder/config` | 全局/会话配置 `{sttProvider?, autoProcessMode?, language?, deliverWakeup?, fwModelDir?, openaiCompatBaseUrl?}`；带 `?sessionId=` 写会话覆盖；`{clear:true}` 清除覆盖 |
| POST | `/api/recorder/deliver-target` | 设置全局投递目标 `{sessionId}` |
| POST | `/api/recorder/batch` | 批量转写 `{sessionId, items:[{name, ext, audioBase64}]}` |
| POST | `/api/qs668/transcribe` | 官方测试网页兼容 `{audioBase64, language, codec}` |
| GET | `/api/recorder/session/<id>` | 会话详情（分段/transcript/绑定） |
| GET | `/api/recorder/session/<id>/events` | SSE 事件流（segment/revised/note/close） |
| GET | `/api/recorder/sessions` `/files` `/notes` `/notes/<id>` `/jobs` `/dsh-sessions` `/config` `/health` | 查询类 |
| POST | `/api/recorder/open-model-dir` | 在文件管理器中打开模型目录 |
| GET | `/api/recorder/ble/status` | BLE 收端状态（python/bleak/守护进程/连接/电量/MTU） |
| POST | `/api/recorder/ble/setup` | 探测 Python + 自动安装 bleak（幂等） |
| POST | `/api/recorder/ble/scan` | BLE 扫描 `{timeout?}` → 设备列表（AE20 标记） |
| POST | `/api/recorder/ble/connect` | 连接 `{address, retries?}`（自动重试，成功后同步时间+查电量） |
| POST | `/api/recorder/ble/disconnect` | 断开 |
| POST | `/api/recorder/ble/battery` | 电量查询 → `{level}`（110=充电中） |
| POST | `/api/recorder/ble/timesync` | 同步设备时间 |
| GET | `/api/recorder/ble/filelist` | 设备录音文件列表（20B 截断名） |
| POST | `/api/recorder/ble/download` | 下载+转写 `{name, sessionId?}`（自动尝试 .wav/.opus 重建扩展名） |
| POST | `/api/recorder/ble/realtime` | 实时转写流 `{action: start\|stop\|pause\|resume, sessionId?}`（分段 ASR 追加会话，停止后按模式投递） |

### 调用示例

```bash
# 上传 WAV 音频并自动按模式投递（二进制转 base64）
curl -X POST http://127.0.0.1:63510/api/recorder/audio \
  -H 'content-type: application/json' \
  -d '{"sessionId":"meet-01","audioBase64":"<base64>","ext":"wav"}'
# → {"ok":true,"text":"转写结果","provider":"faster-whisper-py","sessionId":"meet-01",...}

# 手动触发 summary 模式投递到绑定会话
curl -X POST http://127.0.0.1:63510/api/recorder/session/meet-01/process \
  -H 'content-type: application/json' -d '{"mode":"summary"}'
# → {"ok":true,"delivered":true,"mode":"summary","instruction":"请将以上录音转写内容作为会议记录处理…"}

# 查询配置
curl http://127.0.0.1:63510/api/recorder/config
```

### 关键语义（AGENT 必须理解）

- **投递消息是结构化文本**，明确分两段：`【录音转写内容】` 与 `【处理指令】`——AGENT 应基于【录音转写内容】执行【处理指令】；
- **work 模式**：指令 = 用户自定义 `params.instruction`，缺省"请处理以上录音转写内容并执行任务"；
- **summary 模式**：指令 = "请将以上录音转写内容作为会议记录处理，生成结构化会议纪要（Markdown）"；
- **会话绑定**：录音会话 `meta.dshSessionId` 指向目标 DSH 会话（创建时自动绑定全局默认目标）；投递即 `agent.followup` 唤醒该会话 AGENT；
- **音频格式**：WAV 直通；OPUS 支持 40 字节定长包流（QS668 设备格式，自动封装 Ogg）；`ext=auto` 自动探测；
- **配置优先级**：会话覆盖（`?sessionId=` 写入）> 全局（设置页/runtime-config.json）。

## 蓝牙直连（自实现收端）

插件内置 BLE Central，无需外部中转工具即可直接连接录音卡：

1. **打开「设置 → 录音卡后端」**，在「🔵 蓝牙直连」卡片点「扫描设备」（首次会自动检测 Python 并安装 bleak，或手动点「安装环境」）；
2. 列表中找到广播名 `CB08`（带 `AE20✔` 标记）的设备，点「连接」——**自动重试**，卡片休眠时可能要等它的广播窗口（建议把卡放电脑 1-3 米内、保持开机、手机 App 勿占用）；
3. 连接后可：查电量 / 同步时间 / 拉文件列表 / **下载转写**（自动重建截断扩展名）/ **实时转写**（分段 ASR 追加到录音会话，停止后按全局或会话模式投递给 AGENT）；
4. 命令行等价操作（curl）：

```bash
curl -X POST http://127.0.0.1:63510/api/recorder/ble/connect -H 'content-type: application/json' \
  -d '{"address":"D1:A1:C4:00:09:63"}'
curl http://127.0.0.1:63510/api/recorder/ble/filelist
curl -X POST http://127.0.0.1:63510/api/recorder/ble/download -H 'content-type: application/json' \
  -d '{"name":"note20260211-142645."}'
curl -X POST http://127.0.0.1:63510/api/recorder/ble/realtime -H 'content-type: application/json' -d '{"action":"start"}'
```

> 连接经验：该卡低功耗间歇广播（可能 10-30s 无广播），连接逻辑已内置「看到广播立即连 + 失败重试」；信号弱时（RSSI < -85）请把卡贴近电脑。
> **自动重连**：意外断连（信号丢失/设备重启/关机再开）后守护进程每 5s 自动重连，设备重启后随机地址变化也会自动重扫；
>   同时内置**链路探活**（每 10s 空载 ping 一次），弥补 Windows WinRT 信号丢失时不触发断连回调的问题；
>   手动点「断开」则不自动重连。面板状态栏会显示「⚙️ 自动重连中…」。
> 设备文件表可能含已删除文件的过期条目（下载返回 code=1），属于设备侧固件行为，换候选名或重新列表即可。

## 数据目录

`<DSH 数据目录>/recorder-backend/`：
- `sessions/` 录音会话持久化（JSON）
- `notes/` 笔记（Markdown，按月份归档）
- `session-configs/` 会话级配置覆盖
- `history.jsonl` 转写历史
- `runtime-config.json` 全局运行时配置
- `deliver-target.json` 默认投递目标
- `whisper/` ASR 模型目录
- `plugin.log` 插件日志

## 生态规范（遵循 DSH 插件开发档案）

本项目按 DSH 插件开发档案实践（组合优先 / 声明清晰 / 兼容优先 / 最小面 / 官方渠道装卸）：

- **声明清晰**：`inject` 只声明真实消费的官方 service（`webServer`/`llm`/`agentDefaultModel`/`agents`/`sessions`）；`peerDependencies` 与实际 import 对齐；`AppContext` 使用官方类型（`WebServer` 最小接口、`@deepseek-ai/dsh-session` 的 `SessionStore`/`SessionId`、`@deepseek-ai/dsh-agent` 的 `Agent`）。
- **组合优先**：仅通过官方 `webServer` 注册路由、官方 `agents`/`sessions` service 读会话与投递；**不再直接读取 `~/.dsh/storages/session_projcache.json` 等 DSH 内部 state-file**，会话标题改从官方 `sessionTitle` service（可选，`ctx.get` 探测）读取，宿主未提供时优雅降级为 null。
- **兼容优先**：全部 HTTP API（`/api/recorder/*`、`/api/qs668/*`）与 client 挂载点（`settings.section` / `conversation.view`）保持不变；依赖闭包与装卸命令见 [MANIFEST.md](./MANIFEST.md)。
- **生命周期**：HTTP 长连接（SSE`/events`）在插件卸载时统一关闭；`batch` 任务在卸载时取消并标记状态；Qwen worker 子进程与 BLE 守护进程在 teardown 时释放，避免泄漏。
- **官方渠道装卸**：经 `dsh plugin add file:<目录>` 安装（`cordis.patch.yml` bundle patch 录入装配栈），`dsh plugin remove` 卸载；卸载后自持状态由运行时自检自动清理（保留录音/模型/会话/笔记资产）。

## 定制

可定制性说明与定制方法见 [CUSTOMIZATION.md](./CUSTOMIZATION.md)。

## 开发

- 设备侧 BLE 协议（AE20）分析：见项目文档 `nextproto-ble-protocol-analysis.md`（协议实现位于 `scripts/ble_central.py`，TS 侧不重复维护帧解析）
