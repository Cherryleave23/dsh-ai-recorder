# dsh-ai-recorder — AI 录音卡后端

> 让 **AI 录音卡（NextProto N0001 / CB08 · QS668）** 的录音直接进入 DSH：蓝牙直连收端 → 自动转写 → 按模式投递给 DSH 会话中的 AGENT 处理，产出会话消息或结构化会议纪要。

```
[录音卡设备] --BLE(AE20)--> [本插件内置收端(bleak 子进程)] --agent.followup--> [DSH 会话 AGENT]
                                                                        │
                                                                        ├─ ASR: mock / faster-whisper / whisper.cpp / OpenAI 兼容
                                                                        ├─ 模式: work（直接给）/ summary（会议记录）
                                                                        └─ 输出: 会话消息 / MD 笔记 / 历史
```

## 功能特性

- **蓝牙直连（无需外部中转工具）**：插件内置 BLE 收端，可直接扫描/连接录音卡，支持电量查询、时间同步、文件列表、录音下载、实时转写流。
- **自动转写（ASR 可插拔）**：mock / faster-whisper（本地）/ whisper.cpp（本地）/ OpenAI 兼容（远程），无模型时自动回退 mock，其余功能不受影响。
- **两种处理模式**：
  - `work`：转写内容 + 任务指令 → 直接投给 AGENT 执行
  - `summary`：转写内容 → AGENT 生成结构化会议纪要（Markdown）
- **投递到 DSH 会话**：处理结果进入指定会话，唤醒 AGENT 真实处理。
- **配置灵活**：全局配置（设置页）+ 每会话覆盖（会话内面板）。

## 快速开始

### 1. 安装

克隆本仓库后，在 DSH 中执行（`file:` 协议让包管理器落实依赖并录入装配栈）：

```bash
git clone https://github.com/Cherryleave23/dsh-ai-recorder.git
dsh plugin add file:<克隆路径>/dsh-v0.1.1-rc.1/plugin
```

> 卸载：`dsh plugin remove dsh-ai-recorder`（自持状态由运行时自检自动清理，录音/模型/会话/笔记等用户资产保留）。

### 2. 首次使用

1. 打开 **设置 → 录音卡后端**，配置「流转目标」（默认投递会话）与「处理模式」。
2. 连接录音卡（见下方「蓝牙直连」），或直接通过 HTTP 上传音频。
3. 录音处理结果会自动进入绑定的 DSH 会话。

## 使用指南

| 我想… | 操作 |
| --- | --- |
| 录一段音并让它处理 | 连接录音卡 → 点「实时转写」或「下载转写」 |
| 上传已有的音频文件 | `POST /api/recorder/audio`（见附录 API） |
| 让 AGENT 直接执行任务 | 处理模式选 `work` |
| 生成会议纪要 | 处理模式选 `summary` |
| 只转写不投递 | 处理模式选 `none` |
| 给某个会话单独设置 | 会话内面板覆盖全局配置 |

**配置优先级**：会话覆盖 > 全局配置。会话面板保存的内容只影响该会话；「清除覆盖」恢复全局默认。

## 配置

| 配置项 | 位置 | 说明 |
|---|---|---|
| 流转目标（默认投递会话） | 设置页 | 录音会话创建时自动绑定到该 DSH 会话 |
| 处理模式（none/work/summary） | 设置页 + 会话面板 | 全局默认 + 每会话覆盖 |
| ASR 引擎 | 设置页 + 会话面板 | 只显示可用的引擎（本地/外部 API 分类） |
| 模型目录 | 设置页 | 可改、可打开文件夹 |
| 语言 | 设置页 | 转写语言（zh/en/ja/ko/ru/auto） |

## 蓝牙直连（自实现收端）

插件内置 BLE 收端，无需外部中转工具即可直接连接录音卡：

1. 打开 **设置 → 录音卡后端**，在「🔵 蓝牙直连」卡片点「扫描设备」（首次会自动检测 Python 并安装 bleak，或手动点「安装环境」）。
2. 列表中找到广播名 `CB08`（带 `AE20✔` 标记）的设备，点「连接」——**自动重试**，卡片休眠时可能要等它的广播窗口（建议把卡放电脑 1-3 米内、保持开机、手机 App 勿占用）。
3. 连接后可：查电量 / 同步时间 / 拉文件列表 / **下载转写**（自动重建截断扩展名）/ **实时转写**（分段 ASR 追加到录音会话，停止后按全局或会话模式投递给 AGENT）。

> **自动重连**：意外断连（信号丢失/设备重启/关机再开）后守护进程每 5s 自动重连，设备重启后随机地址变化也会自动重扫；内置链路探活（每 10s 空载 ping）弥补 Windows 信号丢失时不触发断连回调的问题；手动点「断开」则不自动重连。
> **连接经验**：该卡低功耗间歇广播（可能 10-30s 无广播），连接逻辑已内置「看到广播立即连 + 失败重试」；信号弱时（RSSI < -85）请把卡贴近电脑。

## ASR 模型放置

插件**自动探测**模型目录：有模型 → 真实转写；没有 → 自动回退 mock。

- 默认模型目录：`<DSH 数据目录>/recorder-backend/whisper/faster-whisper-base/`
  （Windows 通常为 `C:\Users\<你>\.dsh\recorder-backend\whisper\faster-whisper-base\`）
- 放入 4 个文件：`model.bin`、`config.json`、`tokenizer.json`、`vocabulary.txt`
- 获取：ModelScope 仓库 `pengzhendong/faster-whisper-base`
- 模型目录可在「设置 → 录音卡后端」中修改（持久化），并有「📂 打开」按钮直接弹出资源管理器
- 环境变量覆盖：`DSH_RECORDER_WHISPER_DIR`（指向包含 `faster-whisper-base` 的父目录）、`DSH_RECORDER_PYTHON`（指定 Python 解释器）

## 数据目录

`<DSH 数据目录>/recorder-backend/`：

| 内容 | 说明 |
|---|---|
| `sessions/` | 录音会话持久化（JSON） |
| `notes/` | 笔记（Markdown，按月份归档） |
| `session-configs/` | 会话级配置覆盖 |
| `history.jsonl` | 转写历史 |
| `runtime-config.json` | 全局运行时配置 |
| `deliver-target.json` | 默认投递目标 |
| `whisper/` | ASR 模型目录 |
| `plugin.log` | 插件日志 |

## 常见问题

| 问题 | 处理 |
| --- | --- |
| 没有 Python / 模型 | 插件自动回退 mock 转写，其余功能不受影响；装好 Python 与模型后自动启用真实转写 |
| 扫描不到设备 | 确认卡开机、靠近电脑（1-3 米）、手机 App 未占用；等待广播窗口（10-30s）重试 |
| 下载返回 code=1 | 设备文件表可能含已删除文件的过期条目（设备侧固件行为），换候选名或重新列表 |
| 想换转写引擎 | 设置页选择可用引擎（本地/远程分类） |

## 版本与维护

| 版本目录 | 适配目标内核 | 说明 |
| --- | --- | --- |
| `dsh-v0.1.5-rc.2/` | v0.1.5-rc.2 | 当前版本（ASR 预设与环境引用计数卸载、后处理流转、纪要关联、界面双挂载面） |
| `dsh-v0.1.1-rc.1/` | v0.1.1-rc.1 | 归档（依赖闭包/装卸/API 契约见其 `MANIFEST.md`，变更见 `CHANGELOG.md`） |

> 各版本目录按「插件 → 版本」组织，官方 DSH 源码独立存放于同级 `dsh-official/`（不在本仓库内）。

## 附录 A：API 参考（面向 AGENT / 高级用户）

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

## 附录 B：开发者信息

- 依赖闭包、装卸命令、API 契约与验证状态见各版本目录 `MANIFEST.md`；版本变更见 `CHANGELOG.md`。
- 构建：`npm run build`（host：src → lib）+ `npm run build:client`（client：src/client → lib/client.js）。
- 类型检查：`npm run typecheck`（tsconfig 指向 `../typecheck-tmp`，peer 类型经 paths 映射到官方 checkout）。
- 设备侧 BLE 协议（AE20）分析见项目文档 `nextproto-ble-protocol-analysis.md`（协议实现位于 `scripts/ble_central.py`，TS 侧不重复维护帧解析）。

## 许可

BSD-3-Clause。
