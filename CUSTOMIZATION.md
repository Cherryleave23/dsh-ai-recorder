# 定制文档：可定制性与定制方法

> 本插件设计为**分层可定制**：配置层免改代码、处理器层注册扩展、STT 层插拔、投递层可调模板、协议层可对接新设备。
> 目标：把"录音 → 转写 → 交给 AGENT"这条管线改造成您自己的形态，而不需要重写。

## 一、可定制性总览

| 层 | 定制点 | 难度 | 需要改代码 |
|---|---|---|---|
| 1. 配置层 | 模式 / ASR / 语言 / 投递目标 / 模型目录（全局 + 会话级） | 无需 | ❌ |
| 2. 处理器层 | 新增处理模式（mode），注册表热扩展 | 低 | ✅ src/pipeline.ts |
| 3. 提示词层 | work/summary/修订 的 system prompt 与指令模板 | 低 | ✅ 配置或 src/index.ts |
| 4. STT 层 | 新增 ASR 引擎（provider 插拔） | 中 | ✅ src/stt.ts |
| 5. 投递层 | 投递消息格式、唤醒策略、消息源 | 低 | ✅ src/index.ts |
| 6. 协议层 | 对接其它录音设备（BLE 协议） | 中 | ✅ scripts/ble_central.py |
| 7. 面板层 | 设置页卡片 / 会话面板的控件与布局 | 中 | ✅ src/client/index.tsx |
| 8. 数据层 | 存储格式（JSON/JSONL/MD）、归档策略 | 低 | ✅ src/session.ts / notes.ts |

## 二、配置层定制（免改代码）

全部可通过 HTTP API 或面板完成，持久化、免重启：

```bash
# 全局：模式 / ASR / 语言 / 模型目录 / 外部端点
POST /api/recorder/config {"autoProcessMode":"summary","sttProvider":"faster-whisper-py","language":"zh"}
POST /api/recorder/config {"fwModelDir":"D:/my-models/faster-whisper-base"}
POST /api/recorder/config {"openaiCompatBaseUrl":"https://api.xxx.com/v1"}
# 会话级覆盖（只影响该 DSH 会话）
POST "/api/recorder/config?sessionId=<dsh会话id>" {"autoProcessMode":"work"}
POST "/api/recorder/config?sessionId=<dsh会话id>" {"clear":true}   # 清除覆盖
# 投递目标
POST /api/recorder/deliver-target {"sessionId":"<dsh会话id>"}
```

**优先级**：会话覆盖 > 全局配置 > 插件 schema 默认值。

## 三、处理器层：新增处理模式（推荐起点）

处理管线是**注册表**结构（`Pipeline` 类），新增模式 = 注册一个函数：

```ts
// src/pipeline.ts
export class Pipeline {
  constructor() {
    this.register('echo', ...)
    this.register('work', this.workProcessor)
    this.register('summary', this.summaryProcessor)
    this.register('revise-text', this.reviseTextProcessor)
    // 在这里注册您的自定义模式：
    this.register('todo-extract', async (req, deps) => {
      // req: { sessionId, mode, text?, params? }
      // deps: { llm, getDefaultModel, cfg, sessions, notes, log }
      const text = req.text ?? deps.sessions.get(req.sessionId)?.transcript ?? ''
      const out = await callLlm(deps, '你是行动项提取器…', text)
      return { ok: true, text: out }
    })
  }
}
```

注册后**无需其它改动**：`POST /api/recorder/session/<id>/process {"mode":"todo-extract"}` 即可调用；自动投递（上传后按全局/会话模式）也支持任意 mode 字符串。

### 定制模式提示词

- 内置指令模板在 `src/index.ts` 的 `modeInstruction()`：work / summary 的指令文案在此修改；
- LLM system prompt 在 `src/config.ts` 的 `llmSystemWork` / `llmSystemSummary` / `llmSystemRevise`（也是配置项，可运行时覆盖）。

## 四、STT 层：新增 ASR 引擎

`src/stt.ts` 定义 `SttProvider = (input, cfg) => Promise<{text, provider, meta?}>`。新增引擎四步：

```ts
// 1. 实现 provider（仿 fasterWhisperPyProvider：落盘音频 → 调引擎 → 读文本）
async function myEngineProvider(input: TranscribeInput, cfg: Config): Promise<SttResult> { ... }

// 2. 注册
export function createProvider(kind: Config['sttProvider']): SttProvider {
  ...
  if (kind === 'my-engine') return myEngineProvider
}

// 3. config.ts 的 sttProvider 联合类型加 'my-engine'（及所需配置字段）

// 4. src/index.ts 的 asrStatus().available 增加探测项（面板"只显示有的"自动生效）
{ id: 'my-engine', label: '我的引擎', ready: 探测结果, detail: '...' }
```

可用性探测决定面板下拉与 `resolveSttKind` 回退：**不可用自动回退 mock**，保证任何配置下插件可用。

## 五、投递层定制

投递发生在 `src/index.ts` 的 `deliverToDsh()`：

| 可定制项 | 位置 | 说明 |
|---|---|---|
| 消息结构（【录音转写内容】/【处理指令】） | `deliverToDsh` 内 `text` 拼接 | 可按您的 AGENT 习惯改分隔符/包裹 |
| 唤醒策略 | 配置 `deliverWakeup` | true=`agent.followup`（触发 AGENT 回合）；false=`agent.inject`（仅入上下文） |
| 消息源 | `createUserMessage({ source: { kind: 'user' } })` | 可改 `kind:'plugin'` + `form:'notice'`（系统消息样式） |
| 自动投递开关 | 全局/会话 `autoProcessMode='none'` | 关闭后仅手动 `/process` 投递 |

## 六、协议层：对接其它录音设备

BLE 收端协议（AE20 服务）实现在 `scripts/ble_central.py`（bleak 守护进程，stdio JSON-lines 与插件通信）。
对接新设备时：
1. 修改/扩展 `scripts/ble_central.py` 的 UUID、帧格式、命令表（依据设备协议文档）；
2. Central 收端（设备 → 插件的搬运层）按新协议实现，最终仍以 `POST /api/recorder/audio|stream` 将音频交给本插件；
3. **插件后端与设备协议解耦**——换设备不动后端。

## 七、面板层定制

`src/client/index.tsx` 两个挂载点：
- `settings.section`（设置页卡片）：全局设置 UI；
- `conversation.view`（会话 tab）：会话覆盖 UI。

可增删控件、改布局（React 组件 + 内联样式）；数据均通过 `/api/recorder/*` 获取，host 侧无需改动。

## 八、数据层定制

- 会话持久化：`src/session.ts`（JSON，`<id>.json`），`Session` 接口含 `meta`（可挂自定义字段）；
- 历史：`history.jsonl`（每行一条转写记录）；
- 笔记：`src/notes.ts`（Markdown + YAML 头，按月归档）——summary 结果落盘于此；
- 配置：`runtime-config.json`（全局）、`session-configs/<id>.json`（覆盖）。
- 会话标题（面板列表显示）：从官方 `sessionTitle` service 读取（可选，`ctx.get` 探测），不再直接解析 DSH 内部 `session_projcache.json`。若宿主未提供标题服务则显示会话 id。

## 九、推荐的定制路线

1. **不改代码**：用设置页/API 调整模式、ASR、目标——覆盖 80% 需求；
2. **改提示词**：`modeInstruction` + `llmSystem*`——让 AGENT 按您的业务口吻处理；
3. **加处理器**：`pipeline.register('my-mode', fn)`——新业务模式（提取、翻译、归档…）；
4. **加 ASR**：`stt.ts` 新 provider——接任何语音识别服务；
5. **换设备**：`scripts/ble_central.py`（BLE 收端守护进程）+ `src/ble.ts`（Central 封装）。

## 十、扩展示例：说话人分离（未来）

在后端管线加一个 `diarize` 处理器（whisperX 开源实现）：
- 处理器：对分段音频做说话人分离 → 输出"甲：…\n乙：…"文本；
- 投递模板：`【录音转写内容（含说话人）】`；
- 注册后模式选择即可出现 `diarize`——无需改动其它层。
