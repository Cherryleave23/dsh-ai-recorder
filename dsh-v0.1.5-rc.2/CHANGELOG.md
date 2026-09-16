# CHANGELOG — dsh-ai-recorder

## 0.1.2-alpha.5（五层重构）

按用户给定的流程图把插件重构为五层架构，并把识别层收敛为 FunASR 单一引擎。
相对 `dsh-v0.1.1-rc.1` 是一次结构性重写，**不是增量修补**。

### 同步：转成功即删卡上原件 + 失败自动重试

**转成功即删卡上原件**（`bleSyncDeleteAfter`，**默认开**）

用户要的就是「录音转到电脑上后，卡里别留了」。但**从卡上删是不可逆的**，
所以删之前必须证明本地真留住了东西，而不是只看识别流程有没有抛异常：

```
isSafelyOnDisk(sessionId)   // 会话存在 + 音频已归档 + 文件确实落盘且非空
```

最容易出事的是 `keepAudio=false`：那种情况只留转写文本、不留音频，
若还去删卡，原始录音就永久没了。判定不通过就**保留在卡上**并把原因写进日志——
宁可卡里多留一份，也不能出现「卡上删了、电脑上没有」。

另解决了**历史积压**：以前同步过、当时没开这个开关的录音，卡上还在，现在会在跳过分支里补删。

**失败自动重试**（瞬时 vs 永久）

原逻辑 `prev?.failed && !force → 永久跳过`，断线这类**瞬时**失败也被当成永久失败，
重连后永不重试。现在区分：

- 瞬时（未连接/超时/扫描未发现/busy…）→ 下次同步自动重试，最多 `SYNC_MAX_ATTEMPTS = 3` 次
- 永久（WAV 头非法/长度不符/解码失败…）→ 不再重试，省得白占同步时间
- 判定不出来按瞬时处理：多试几次的代价远小于「一次失败就永久放弃」
- 索引持久化 `attempts` / `permanent` / `failedAt`

还加了**断线即中断本轮**：连接掉了就别把剩下十几个根本没被尝试过的文件逐个标成失败。

### 断点续传：协议有字段，但这版固件不能用（附实测）

协议 2-2 的下载请求带 4 字节 offset，本卡**接受**非零 offset（不报 code=2），
看起来断点续传可行。**但实测续传出来的数据是坏的**：

| 方式 | 收到字节数 | 期望 | 转写 |
|---|---|---|---|
| 单次（offset=0） | 11840 / 11840 | 11840 | 嘿你好嘿你好你，。 （两次完全一致） |
| 分片 chunk=4000 | 11200 | 11840 | 哎，你好，哎，嘿你好哦你，。 |
| 分片 chunk=8000 | 12000 | 11840 | 嘿你好嘿，你，。 |
| 分片 chunk=3000 | 13760 | 11840 | 嘿嘿嘿你好哦你，。 |
| 分片 chunk=2001 | code=2 被拒 | — | — |

**误差有正有负、无规律**：设备端「大致」遵守 offset，但在包边界处会丢字节或重复字节
（偏差 640 / 1920 都是 40 的整数倍，40B = 一个 20ms Opus 包）。
**没有任何 chunk 大小能得到精确值。**

参考实现（`uui77/NextProto`）的对照印证了这点：**它从不做自动分片**——
`offset` 只是一个**人工续传旋钮**，所有自动化路径都传 `offset=0`；
代码里没有 offset 累加、没有包对齐、没有字节回退，也**没有任何字节数对账**
（只有 WAV 头自洽检查，`.opus` 路径连这个都没有）。它不是**规避**了这个问题，
而是**绕开**了——从不在非零 offset 上循环，自然观测不到误差。
协议文档本身也只写「首次下载为 00 00 00 00」，**全篇未定义续传的字节语义**。

**结论**：问题在**设备侧 offset 语义未定义**，不在帧编码（我们的 36B 帧与参考实现逐字节一致）。
真实管线**一律单次传输**，并加硬校验兜底（`dl.chunks > 1 && dl.size !== e.size` 直接判失败）；
`/ble/download` 保留 `chunkBytes` 参数，供固件升级后重新验证。

### 从参考实现挖出的一个真 bug：删除 payload 格式

我们原来用**格式 A**（`time:4B BE + size:4B BE + name:20B`，即列表条目格式），
而且 `cmd_delete` **无条件返回 `ok: true`**——连回执都不看，**删失败也报成功**。
这会直接毁掉「同步后自动删除」：日志说已删除，卡上文件还在。

参考实现（`device.py::delete_file`）实测：**V1.0.0 固件只认格式 B**——
`偏移量 4B LE(0x00000000) + 文件名 24B（带扩展名）`，**不是**协议文档写的「与列表相同的 28B 条目」
（文档与真机不一致，桌面版以真机为准）。

修法三层：

1. 三种 payload 候选按 `B(.opus) → B(截断名) → A(列表条目)` 递进尝试；
   格式 A 要的是**列表里的原始 28B 条目**，所以 `parse_file_list_entry` 现在保留 `raw`
   （base64——直接塞 bytes 会让 `json.dumps` 抛 `TypeError` 把守护进程整个带崩，已踩过一次）
2. 等 2-13 回执（`DELETE_RESP_TIMEOUT = 3s`，旧固件可能不回）
3. **回执说了不算，重拉列表才算**：删完 `cmd_filelist()` 核对这条是否真不在了。
   回执语义在各固件版本间并不一致，列表才是事实

**实测**：`{"ok":true,"format":"B(.opus)","verified":"ack+list"}`，一次命中；
设备列表 25 → 24 条，目标确实消失。

新增 `POST /ble/delete` 手工删除路由（同样走完整核对，删不掉会抛异常而不是假报成功）。

### 可启停的扫描 + 认出连过的卡自动接回

原来「扫描设备」是一次阻塞 8 秒的请求：按下去没反应、中途停不掉、扫完还得自己从列表里挑。
而用户按这个按钮的真实意图通常就是**把我的卡接回来**。

**扫描改成短轮次循环**

`POST /ble/scan {action:'start'}` 立刻返回，后台每 3 秒扫一轮并把结果累积进
`scanState.devices`；按钮马上切成「停止扫描」。`{action:'stop'}` 作废当前循环，
**最多等一轮（≈3s）就停**。设备列表通过 `/ble/status` 的 `scan` 字段轮询长出来，
前端在扫描期间每 1.5s 拉一次。

刻意不做「一次长扫」：那样「停止」要等整轮结束才有反应，列表也要等十几秒才出现。

**认出连过的卡就自动接**

新增设备缓存 `<outDir>/ble-devices.json`（`KnownDeviceStore`）：

```json
{ "devices": [{ "address": "D1:A1:C4:00:09:63", "name": "CB08",
                "lastConnectedAt": "…", "connectCount": 2, "lastRssi": -100 }] }
```

- 任何一次成功连接都会写入缓存（手动连接与扫描自动连接都走 `connectAndRemember`）
- 每轮扫描结束后，若开着自动连接且列表里有**连过的**设备 → 直接连它，而不是等用户挑
- 有多张连过的卡时，优先连接**次数最多**的那张
- 地址对不上时用**名字**兜底（防设备换随机地址），命中后把记录迁到新地址，
  不在缓存里留一条死地址
- 缓存按地址 + 名字识别，UI 上打「连过 · 2 小时前」标签，手动连接的按钮对它高亮

API：`POST /ble/scan {action:'start'|'stop', roundMs?, autoConnect?, timeoutMs?}`、
`GET|POST /ble/known`（POST 带 `forget` 可删除）、`/ble/status` 增加 `scan` 字段。

**实测**：手动连一次写入缓存 → 断开 → 按扫描 → 第 2 轮就认出 `CB08（连过）`
并自动连接，约 27 秒后连上（-93 dBm 弱信号要重试）；停止扫描 1 秒内生效。

### 与参考实现的全量协议对照审计（修掉 4 个 P0）

拿 `uui77/NextProto`（含厂家官方测试页 JS）与官方 `docs/协议.md` 对我们的**每一个设备操作**
做了逐项对照。结论：**协议帧层完全一致**（有官方 §7.3 真实 TX 帧逐字节自检背书：
MAGIC/SEQ 布局、CRC16-XMODEM（poly 0x1021/init 0/不反射/xorout 0）、CRC 覆盖 `LEN+DATA`、
小端 CRC/LEN、大端列表整数，全部相同）。

列表解析、时间同步、电量、暂停/继续、增益、实时流启动的**报文格式也都一致**。
但对照挖出 4 类真问题（都已修）：

**P0-1 解析器会被一个字节翻转永久卡死**

`feed()` 用帧头里的 LEN 决定「还差多少字节才算整帧」，却没有上限。
一个字节翻转撞出 MAGIC + 垃圾 LEN（最大 65541）后，解析器会一直等一个**永远凑不齐的整帧**，
后续所有真帧全被堵死——只能重启守护进程。参考实现用 `MAX_DATA_LEN = 8192` 防这个。

三处一起修：

- 加 `MAX_DATA_LEN = 8192`，超限即判定为假帧头并重同步
- **CRC 失败只丢 1 字节**（原来丢整个 `total` 长度）：坏帧后面往往紧跟着真帧，
  整帧丢弃会把真帧一起吞掉
- 记 `bad_frames`（原始 hex），便于按文档 §9 要求做诊断

**P0-2 断连不清接收缓冲**：缓冲里残留半帧/垃圾，重连后真帧解析不出来。
加了 `FrameParser.reset()`，`_handle_disconnect()` 里对两个通知特征都调用。

**P0-3 长度 0 的帧会 IndexError**：`data_len == 0` 时 `body[0]` 越界。改为直接跳过。

**P0-4 裸 ACK 被误判成按键事件**：`cmd` 缺省填 `0xFF`，导致「只有 1 字节、没有 cmd」
的裸 ACK 掉进 `TYPE_KEY` 的 `else` 分支，被当成"未知按键码"上报。改为 `cmd = None`
并单独走 `ack` 事件。

**另有 2 个「假成功」**：

- `wait_battery()` 的 `self.battery` **从不清空**，第二次查询会**立刻返回上一次的旧值**——
  看着成功，实际根本没问设备。增益读取同理（`cmd_gain` get）。两处都改为**先置空再请求**。
- `cmd_gain` 的 set 分支**发完就乐观返回 `ok=True`**，设备拒绝也看不出来。改为等 3-28 回执；
  旧固件不回则如实返回「状态未知」，不谎报成功。

**固件串没去 NUL**：`CMD_FW_ACK` 的版本号是 NUL 填充定长字段，原来会拖一串 `\x00`。

**`TYPE_CTRL` 缺 `else` 兜底**：未知控制帧被静默丢弃（`CMD_AUTH_ACK` 就这样被吞了）。
现在补了 `AUTH_ACK` 分支与 `ctrl_unknown` 事件，便于固件升级后第一时间发现新命令。

**解析器加固自测**（`typecheck-tmp/test-parser.py`，10 项全过）：假帧头后仍能解出真帧、
坏帧后紧跟的真帧被解出、裸 ACK 不再误报、长度 0 帧不崩、`reset()` 生效、连续 5 帧全解出。

**真机回归**：13 条自动删除的记录逐条核实，日志声明的本地字节数与磁盘上音频文件的实际大小
**13/13 精确吻合**（2897 / 3676 / 9743 … 48591），没有一条是「删了卡却没留副本」。

**审计发现但暂不动的（功能缺失，非 bug）**：容量查询（0-1）、固件版本查询（0-10）、
授权码（0-12）三个命令我们**定义了常量却从未发送**，所以状态里 `capacity`/`fw` 恒为 `null`
（解析代码是半成品，已在本次补上 NUL 处理与 AUTH 分支，补发请求即可用）；
`TYPE=3` 的录音控制（1/3/5/7）与分段导入（2-12）也未实现。
这些都不是当前流程需要的，等真要用时再补。

### 「8 秒检测没生效、一直显示已连接」—— 三个真 bug 叠在一起

上一轮我加了 8 秒探活，但用户实测**完全没生效**。日志给出了答案，而且都是我自己的错。

**① `NameError: name 'log' is not defined` —— 探活一失败就把 watchdog 自己崩掉**

```python
File ".../ble_central.py", line 844, in _watchdog_loop
    log('探活失败，判定为断链:', str(exc))
NameError: name 'log' is not defined. Did you mean: 'self.log'?
```

`ble_central.py` 里日志是 **`self.log` 方法**，没有模块级 `log()`
（`qwen_worker.py` 里才是模块级的，我串了）。于是探活一旦失败、正要处理断链的那一刻，
watchdog 抛 NameError **自己死掉**，断链永远处理不了 → 「一直已连接」。

三处 `log(` 全部改为 `self.log(`。**并加了 pyflakes 静态门禁**
（`typecheck-tmp/test-pyscripts.py`）—— 语法检查查不出这类错误，pyflakes 可以。
现在 4 个 Python 脚本零未定义名字。

**② `asyncio.CancelledError` 把整个守护进程打死**

```python
File ".../ble_central.py", line 572, in _do_connect_locked
    await cand.connect()
bleak/backends/winrt/client.py", line 1127, in result
    raise asyncio.CancelledError
[16:18:20.726] BLE 守护进程退出，2s 后自动重启
```

bleak 的 winrt 后端在底层连接被中止时会**直接抛 `CancelledError`**，
而它继承自 `BaseException` —— `except Exception` 拦不住，一路穿过 `cmd_connect`
把守护进程干掉，然后重启、再连、再崩。界面就永远停在「正在自动连接…」。

两处修：
- `_do_connect_locked` 里单独捕获它，**只有真的有人在取消这个任务**（`task.cancelling() > 0`）
  才向上传播，否则当成一次普通连接失败继续重试；
- `process_request` 增加 `except BaseException` 兜底：**守护进程绝不能被单条命令打死**。

**③ 扫描缓存的 BLEDevice 句柄失效（我自己上一轮引入的回归）**

为了省掉重复扫描，我缓存了扫描得到的 `BLEDevice` 并在连接时复用。
但那个对象属于**已经停止的那个扫描器会话**，句柄可能失效 → `connect()` 一直失败，
而 15s 内重试拿到的还是同一个坏对象。表现就是「扫描明明看见卡了、自动连接却一直连不上」。
现在快速路径失败即**作废缓存**，退回真正的 `find_device_by_address`。

**验证**（用 `simulate_disconnect` + 真机）：
```
守护进程退出次数: 0
watchdog 单测: 探活失败 → 触发断链 ✓
最终: connected=True 电量=46 MTU=527 ✓
```

### 断链漏检导致「卡拿回来再也接不上」——加两层兜底

用户复现路径：**原本连着 → 把卡拿出范围 → 卡自己显示无连接，插件却仍显示已连接 →
卡放回来 → 插件报「自动连接失败」**。

根因是「重连只在捕获到断链事件时才启动」这一条单点依赖。而断链有两条漏法：

**① watchdog 的跳过条件叠加出缺口**

```python
if self._dl is not None or self._pinging: continue   # 下载中一律跳过
if now - self._last_rx < 5: continue                 # 最近 5s 有流量就跳过
```

只要断链那一刻 `set_disconnected_callback` 没触发、而恰好又有过流量，就**永远探不到**。
而 `connected` 一直为 True → 重连循环压根不启动 → 卡回来了也没人接。

改为**每个周期（8s）都真的发一条探活帧**：一次往返远比漏掉一次断链便宜。
下载期间仍跳过（那时链路本就在高频传数据），但加了下限——45s 一个字节都没收到照样探。

**② 补一个常驻监督循环（daemon 侧）**

`_start_reconnect_loop()` 原来**只在 `_handle_disconnect` 里**被调用。
现在增加 `_supervisor_loop()`：每 5s 检查一次，只要「未连接 + 允许自动重连 +
有过地址 + 重连任务没在跑」就把重连拉起来。它不依赖任何单次事件，是漏检的兜底。
（带 address 守卫：只负责**恢复原本有过的连接**，不会在插件刚启动时偷偷去连一个没连过的设备。）

**③ 补一个连接自愈循环（host 侧，本次实测生效的就是它）**

"我连过哪些卡"这个知识在 host 侧的 known-devices 缓存里，所以兜底也该放在 host 侧。
每 10s 检查：**未连接 + 没在扫描 + 没在同步 + 缓存里有连过的设备** → 主动发起
「扫描 + 自动连接」把卡接回来。不看断链是"怎么"被发现的。

**实测**（卡离范围造成未连接状态后）：

```
15:48:04  自愈：当前未连接且存在连过的设备，发起扫描 + 自动连接
15:48:36  BLE 已连接 MTU=527
15:48:38  扫描时自动连接了连过的设备 CB08
```

### 切页面卡顿 / 空卡按钮像坏了 —— 两个"看着没反应"的问题

**① 每次切走再切回来页面都卡半天（实测 6.45s → 0.01s）**

两处叠加：

- `/asr/status` 路由**无条件**走 `readiness(true)`，也就是每次调用都发一条 probe 命令
  给 Python worker。worker 单线程，冷启动要 import torch+funasr，忙起来还会把 probe
  排在识别/同步后面 —— 所以**同步时切页面更卡**。
- 更贵的是我自己写的 `qwenReadyCached()`：它调 `qwenEnvReady()`，而那会
  `execFileSync(python -c "import qwen_asr, torch")` —— **真起一个进程去 import torch**，
  数秒；而且只缓存 30 秒，于是每 30 秒就再卡一次。

修法：`/asr/status` **默认读缓存**，只有显式 `?probe=1` 才真探测（面板的「重新检测」按钮
用这个）；Qwen 就绪判定改为**纯文件检查**（venv + 权重配置在不在），深度 import 校验
只在 `?probe=1` 时做且缓存 60 秒。

实测 4 轮连续调用：**6.45s → 0.01~0.02s**，且不再有 30 秒周期性卡顿。

**② 「文件列表」按钮像是完全失效**

渲染条件是 `files.length > 0` —— 卡是空的时候点了什么都不显示，
**看起来就是按钮坏了**（接口其实是好的，0.2s 返回空数组）。
现在查完一定会给反馈：有录音就显示条数并列出，空卡显示
「录音卡上没有录音（空卡）」。用 `filesQueried` 区分「还没查」与「查了但是空的」。

### 蓝牙「扫描不到 / 连不上 / 连上没感知」三连修

**① 扫描一直扫不到设备 —— 两个扫描器抢同一个适配器**

`_reconnect_loop` 会循环调 `_do_connect`，而它内部的
`BleakScanner.find_device_by_address` **本身就是一次扫描**；`cmd_scan` 又开一个扫描器。
WinRT 下同一适配器上有两个扫描器时，**两边都扫不到任何东西**。
而 `cmd_scan` 既没拿连接锁、也不会暂停重连循环，于是重连一开，扫描就永远空手而归。

日志铁证：

```
14:55:51  BLE 自动重连中（第 1 次）
14:56:53  开始扫描设备            ← 扫描启动了
14:57:09  BLE 自动重连中（第 2 次）  ← 扫描期间重连又抢了一次适配器
```

修法：扫描前先 `_stop_reconnect_and_wait()` **等重连真正退出**（只 cancel 不够，
它可能正卡在 `find_device_by_address` 里占着适配器），再用 `_connect_lock` +
新增的 `_scan_lock` 把「扫描」与「连接尝试」串行化。
重连循环自己发起的扫描传 `suspend_reconnect=False`，否则它会**把自己取消掉**。

实测：30 秒 0 个 → **5 秒内 3–4 个**（CB08 -88 dBm）。

**② 连上没感知 —— 界面只在扫描时才轮询**

```ts
React.useEffect(() => {
  if (!scan?.running) return   // ← 不扫描就完全不刷新
  setInterval(refreshBle, 1500)
}, [scan?.running, refreshBle])
```

后台自动重连成功时界面**永远不会重新拉状态**，「已连接」标签一直停在旧值。
改为**常驻轮询**（空闲 1.2s / 扫描中 0.8s），并在状态从「未连接」翻到「已连接」时
主动提示一次（带电量）——自动重连是后台发生的，不主动说一声用户不会知道。

**③ 事件压着不发 + 连接被同步阻塞（那十几秒的真凶）**

- `connected` 事件原本要等 `_do_connect` **整个返回**才由调用方发出，而后面还有
  时间同步 + `wait_battery(2.5)`（最多干等 2.5 秒）。物理链路早通了、事件却压着 →
  卡上灯都亮了、插件还说「自动重连中」。现在**链路一通、通知订阅完就立即 emit**
  （`phase='link'`），电量随后由 `battery` 事件补上。
- 该早期事件**不能触发自动同步**：守护进程单命令串行，同步一跑 `filelist`/`download`
  就把命令循环占住，之后的重连命令只能排队——这才是「断开后十几秒才恢复」的来源。
  故 `phase === 'link'` 的事件只用于呈现，不启动同步。
- 断线时**立即让在途下载失败**：`_do_download` 的空闲超时是 12 秒，链路已断它还要
  傻等 12s 才返回；这 12 秒里重连排不上队。现在 `_handle_disconnect` 直接把
  `_dl` 的 future 置异常，下载立即收尾、让出命令循环。
- **重复扫描**：`scanLoop` 明明已经扫到设备并拿到地址，`_do_connect` 却又做一次
  `find_device_by_address(timeout=12)`，弱信号下每次最多白等 12 秒、重试 3 次就是 36 秒。
  现在把扫描到的 `BLEDevice` 对象缓存（15s 内有效）直接复用。

**实测**：扫描→连上 **38.6s → 15.9~19.1s**；链路建立→界面翻转 **~0.2s**。

### Qwen3-ASR 接入（离线引擎）+ 三处环境/健康检查的真问题

**Qwen3-ASR 作为第三档离线引擎接入**，走「先分离、后识别」：

```
FunASR cam++ 出说话人时间段 → 按段切音频 → 逐段喂 Qwen3-ASR → 合并
```

Qwen3-ASR 官方**没有说话人分离**（GitHub 全库搜 `diarization` 只有一条被关闭未合并的 PR #116），
`transcribe()` 只回 `.text`、时间戳还要另挂 ForcedAligner。切出来的每段天然只含一个说话人，
所以**不需要强制对齐**，也就绕开了「段边界与说话人切换点不重合 → 少数说话人的词被吞掉」的难题。
论文背书：Interspeech 2026 MLC-SLM Workshop（arXiv:2607.08208）用的 3D-Speaker 就是
FSMN-VAD + **CAMPPlus**，正是我们现有的 cam++。

- 新增 `scripts/qwen_worker.py`（按说话人切段、批量识别、相邻同说话人合并、<0.3s 碎段丢弃）
- 新增 `scripts/qwen_fetch_model.py`（**优先 modelscope**，hf-mirror 兜底）
- 新增 `src/layers/03-recognition/qwen.ts`、`qwen-install.ts`
- `asrModel` 增加 `'qwen3-asr'`；新增 `qwenModelDir` / `qwenModelName` / `qwenPythonPath` / `proxyUrl`
- **实时仍走 paraformer-online**：Qwen3 的流式仅 vLLM 后端支持，而 vLLM 在 Windows 原生跑不通

独立 venv 是必须的：`qwen-asr` 与 `funasr` 在同环境会打架（官方 issue #3042）。

**① 继承坏代理导致下载全线失败**

安装第一步就失败：

```
ProxyError: Cannot connect to proxy. [WinError 10061] 目标计算机积极拒绝
```

根因：环境里 `HTTP_PROXY = 127.0.0.1:10809`，**那是个死端口**（活的 v2ray 在 10808）。
而清华 pypi / modelscope / hf-mirror 都是国内源，**本来就不该走代理**。

**影响面比 Qwen 大得多**：`PyWorker` 原样继承 `process.env`，
所以 **FunASR 下载模型时同样会踩**。已在 `py-worker.ts` 与 `qwen-install.ts` 加统一的
`spawnEnv()` / `childEnv()`：**默认剔除继承来的代理**，需要时用 `proxyUrl` 显式指定
（填 `http://127.0.0.1:10808`）。

**② PyPI 的 Windows torch 是 CPU 版**

装出来是 `2.14.0+cpu`、`cuda.is_available() == False`。CUDA 版只能从
`download.pytorch.org/whl/cu128` 装，而那是境外站、国内直连不通 → 必须走代理。
（清华的 `/pytorch-wheels/` 镜像实测 404，不可用。）安装器已加 torch CUDA 检查与补装步骤，
装不上则如实降级为 CPU 并在面板说明，不算安装失败。

**③ readiness 假绿（自己踩出来的）**

Qwen 安装路由末尾原本会继续调 `installFunasr`，它执行
`pip install -U funasr modelscope soundfile` —— 把 modelscope 升到 1.40.1 却**没带上
`modelscope-hub`**，于是：

```
cannot import name 'DEFAULT_CREDENTIALS_PATH' from 'modelscope_hub.compat.constants'
```

**整个 FunASR 识别随之失效。** 而 `/asr/status` 依然显示「全部模型就绪」——
因为 `_pkg_version()` 只读**安装元数据、不 import**，`core_ready` 只判**目录存在**。

三处一起修：

1. `do_install` 的 pip 行补上 `modelscope-hub`（必须与 modelscope 同步升级）
2. 新增 `_dep_health()`：对 `torch` / `funasr` / `modelscope` **真正 `__import__` 一次**，
   记录每个的成功与否及异常原文；`ready` 判据纳入它，`probe` 与安装后强制刷新
3. 新增 `_model_dir_complete()`：目录存在还不够，里面得有实际权重/配置，
   否则标 `partial`（区分「完全没下」与「下到一半被打断」）

面板同步展示：依赖导入失败会红字列出**具体是哪个包、什么异常**，
不完整模型显示「（不完整）」而不是默默算就绪。

**自测**：`typecheck-tmp/test-readiness.py` 10 项全过（空目录/无权重不算就绪、
有配置或分片才算、依赖体检覆盖三项、缓存与 force 刷新）。

### 真机联调修掉的一批问题（0.1.5-rc.2 内核）

首次接真录音卡（CB08 / `D1:A1:C4:00:09:63`）跑通全链路：扫描 → 连接（MTU 527、电量 55%）
→ 列表 24 个录音 → 下载 Opus → 解码 → FunASR(CUDA) → 自动命名 → 三件套。
设备文件名形如 `note20260820-235231.opus`，体积 ~2000 B/s，印证 16 kbps Opus。

**1. `get_service()` 找不到时返回 None，不抛异常**

`try: svc = client.services.get_service(UUID) / except ...` 这种写法让「服务不存在」这个
正常分支永远不走，直接掉到下一行 `svc.characteristics`，炸成
`AttributeError: 'NoneType' object has no attribute 'characteristics'`，
**把「设备可能不是录音卡固件」这个真正原因吞掉了**。现在显式判 None，
并列出**设备实际广播的服务**——测固件时这信息最关键。

**2. `filelist` 静默撒谎**

`cmd_filelist` 超时后照样返回 `entries: []` 且不报错。同步占用连接时（固件不并发响应）
UI 就显示「设备上没有文件」——一个假答案。现在区分：一帧没收到且无终止帧 → 报错；
收到终止帧但为空 → 真是空设备。

**3. 自动重连会把手动连接挤掉（「一直在重连、手动也连不上」）**

`cmd_connect` 里 `_cancel_reconnect()` 只调 `task.cancel()` 就返回，**不等那个任务真正退出**。
它被取消时可能正卡在 `_do_connect` 的 `find_device_by_address` 里，适配器仍被占着；
紧接着发起手动连接，两个连接尝试并发驱动同一个适配器——WinRT 下必然双双失败。

- 加 `_connect_lock`，`_do_connect` 全程持锁，**同一时刻只允许一次连接尝试**
- `_stop_reconnect_and_wait()`：取消后 `await` 等它真的退出（上限 20s）再继续
- 重连间隔退避 5s → 10s → 20s → 30s 封顶，不再每 5s 猛敲适配器
- 重连次数透到界面：显示「自动重连中（第 N 次）」并标黄，而不是看不出进展的「重连中」

**4. 录制时间被当成了同步时刻**

离线同步的会话 `createdAt` 记的是**同步那一刻**，于是一卡 8 月的旧录音全显示成「刚刚」，
列表排序、兜底标题、总结归档时间戳全错。**录制时间就在设备文件名里**
（`note20260820-235231.opus` → 2026-08-20 23:52:31）。

- 新增 `deviceFileTime()`：解析文件名，逐字段回读挡掉 `20261345-996161` 这类
  能被 Date 归一化的假时间
- `open()` 接受 `recordedAt`，`createdAt` 与**会话 id** 都用它
- 启动时一次性修正历史会话（只改 `createdAt`，不动 id——id 是主键，已被 sync-index
  与产物路径引用）
- 无转写文本的会话，兜底标题里也写着时间，一并跟着改

**5. 有转写文本却挂着「未转写 …」时间兜底名**

`deriveTitle` 的 `maxChars` 若是 undefined/null/NaN，`Math.floor` 得到 NaN，
而 **`flat.slice(0, NaN)` 返回空串** → 每条自动标题都退化成时间兜底名。
现在非有限值或非正数一律退回默认 12。

另加**标题自愈**：启动时扫一遍，凡标题确实是时间兜底名（`未转写 …` / `录音 …`）
而文本已存在的，按内容重取并同步改名。判定刻意收紧到「当前标题确实是兜底名」，
既不误伤正常标题，也不会在实时转写文本增长过程中反复改名；
用户手改的与 LLM 给的名字（titleSource 非 auto）一律不动。实测修好 3 条存量坏数据。

**6. 冒烟脚本的假绿**

`smoke-host.mjs` 写死 `profiles/web`。DSH 升级后活动 profile 变成 `0.1.5-rc.2`，
它还去加载**旧 profile 里的陈旧副本**然后「通过」。现在扫全部 profile，
按 `lib/index.js` 哈希与当前构建比对，优先选真正由这份源码编出来的那个；
都不匹配就**明确警告**，不再假装通过。

**待办（已发现未修）**：同步失败的文件会被永久跳过（`prev?.failed && !force`），
掉线这种**瞬时**失败也被当成永久失败，重连后不会自动重试。需要区分
「连接断了」与「文件本身有问题」，或改成失败后允许有限次重试。

### 架构：五层化

流程图 ↔ 代码目录一一对应：

| 层 | 目录 | 职责 |
|---|---|---|
| L1 采集层 | `src/layers/01-capture/` | BLE AE20 直连收端（Python/bleak 守护进程）；离线下载 **.opus 优先** |
| L2 预处理层 | `src/layers/02-preprocess/` | 裸 40B Opus → Ogg 容器化；解码为 16k/mono/16bit 统一格式；**下载件前导污染自检** |
| L3 识别层 | `src/layers/03-recognition/` | FunASR：离线（VAD+ASR+标点+说话人）/ 实时（增量 chunk 逐字）；环境与模型自动安装 |
| L4 输出层 | `src/layers/04-output/` | 以 session_id 为主键落三件套：音频 + Markdown + 实时文本流 |
| L5 对应关系层 | `src/layers/05-session-link/` | session_id ↔ 三件套的唯一解析入口 |

### 识别层：收敛为 FunASR

- **移除** 全部旧 provider：`mock` / `openai-compat` / `whisper-cpp-cli` / `faster-whisper-py` / `qwen-audio-py`。
- **新增** `scripts/funasr_worker.py` 常驻进程（stdio JSON-lines），承载两条识别路径：
  - 离线：`AutoModel(model=paraformer-zh, vad_model=fsmn-vad, punc_model=ct-punc, spk_model=cam++)`
    → 完整转写 + 分段 + 说话人。
  - 实时：`AutoModel(model=paraformer-zh-streaming)` + cache + `chunk_size` 增量解码
    → 边收边逐字输出（默认 600ms 步长）。
- **funasr 懒加载**：未安装时 worker 仍能启动并如实上报就绪状态，面板可显示「缺什么」并给出安装入口。
- **自动安装**：`POST /api/recorder/asr/install` 执行 pip（funasr / modelscope / soundfile /
  torch / torchaudio，CUDA 走 cu128 索引并自动回退 CPU）+ modelscope 下载模型权重。

### 采集层：离线下载改 .opus 优先

- 候选名顺序从 `[.wav, .opus, 截断名]` 改为 **`[.opus, .wav, 截断名]`**（`cmd_download` 新增 `prefer` 参数，
  默认 `opus`，可由配置 `opusPreferred` 切回）。
- 依据（真机实测 + 社区实现交叉验证）：

  | 格式 | 码率 | 4.64s 录音 | 22.24s 折算 |
  |---|---|---|---|
  | `.opus`（设备原生 40B/20ms） | 16 kbps ≈ 2 KB/s | — | 44,480 B |
  | `.wav`（设备转码 16k/16bit/mono） | 32 KB/s | 148,524 B | ≈ 711 KB |

  **体积差 16 倍**，直接决定 BLE 传输耗时。
- 参考：[uui77/nextproto](https://github.com/uui77/nextproto) 在同一天做了同样改动
  （commit `1dc63f9`，注释「优先 base.opus（体积小、BLE 传输快）」）。

### 新增：下载件前导污染自检（重要缺陷修复）

**真机取证结论**：设备 `.opus` 下载件的**前约 3–4 KB 是非确定性数据**——

- 同一文件下载 5 次得到 5 个不同 SHA256；
- 逐字节 diff 显示差异**全部集中在前 4160 字节**（= 104 包），之后字节完全一致；
- 前段呈 PCM 样貌（相邻样本相关 +0.83~+0.99），后段是熵编码样貌（相关 ≈ −0.03、熵 7.90）。

旧代码把整包按 40B/包封装后交给解码器，解码器从第一个包就失败，**只能解出 0.05~0.11s**
（应为 17.6~22.2s）。这解释了旧版 `recordings/` 里 `.ogg` 转写几乎全是空文本。

修复方式（`opus_probe`）：在 `[0, captureSkipScanMax]` 内按 8 包粗扫 + 单包细化，
用「解码时长 / 应有长度（包数 × 20ms）≥ 0.9」判定最小可解码偏移，裁掉后重新包容器。
良性输入走 `skip=0` 快路径，代价仅一次探测解码。

**真机验证（5/5）**：

| 样本 | 包数 | 应有 | 探测 skip | 跳过后实解 |
|---|---|---|---|---|
| note20260211-142645 | 1112 | 22.24s | 4080B | 20.31s / 20.20s ✓ |
| note20260820-210054 | 400 | 8.00s | 4160B | 5.91s / 5.92s ✓ |
| note20260820-211224 | 878 | 17.56s | 4160B | 15.47s / 15.48s ✓ |
| note20260211-140838 | 2092 | 41.84s | 3160B | 40.24s / 40.26s ✓ |
| note20260211-141508 | 2894 | 57.88s | 3960B | 55.88s / 55.90s ✓ |

同时把下载件的弱校验（只查 `len % 40 == 0`，坏数据能静默通过）替换为解码自检。

### 输出层：session_id 主键三件套

一次录音 = 一个会话目录，三样产物同主键落在一起：

```
<outDir>/sessions/<session_id>/
  audio.ogg        本地音频文件（设备原生 Opus 归档）
  transcript.md    Markdown 转写文档（每次识别都产出）
  session.json     会话记录（分段/时长/来源/产物索引）
```

- 旧版音频落在 `recordings/<yyyy-mm>/<设备文件名>`，与会话无关联；Markdown 只在 LLM `summary`
  模式产出。现在三者由同一个 `session_id` 串起，L5 层提供唯一解析入口。
- 另加 `<outDir>/index.json` 会话索引（列表不再扫目录），JSON 全部 tmp+rename 原子写。

### 移除：AGENT 投递层

按用户决定整块砍掉（后续另行定制），因此 `inject` 从
`['webServer','llm','agentDefaultModel','agents','sessions']` 收敛为 **`['webServer']`**：

- 删除 `src/pipeline.ts`（work/summary/revise-text 处理器注册表）
- 删除 `src/notes.ts`（LLM 笔记库）
- 删除 work/summary 模式投递、待审批链（`pending-deliveries`）、默认投递目标（`deliver-target`）
- 删除会话级配置覆盖（`session-configs`）
- 自检清理的 `OWNED_FILES` 相应收缩为 `runtime-config.json` / `sync-index.json` / `plugin.log`

### 内核适配 0.1.1-rc.1 → 0.1.2-alpha.5

消费面逐项核对结论：**无需代码迁移**（`webServer.register`、`schemastery`、
client `slots.inject/register` 在 alpha.5 签名未变）。

工具链修复（旧版真正的风险点）：

- **typecheck 基线重定向**：旧版 `typecheck-tmp/tsconfig.json` extends 到 dsh-msg-link 的 rc.1 配置，
  全部 `@deepseek-ai/*` 指向 **rc.1 源码**——即迁到 alpha.5 后 typecheck 校验的仍是 rc.1，
  等于没有防线。现在由 `typecheck-tmp/generate-tsconfig.mjs` 从 alpha.5 的 `tsconfig.base.json`
  现场生成（当前 392 条 paths）。同时把 `src/client` 纳入检查（旧版排除，前端零类型防线）。
- **构建重写**：旧版 client 构建的 `tsdown.config.mjs` 里 `ROOT` 指向
  `D:/AI/默认工作流/...`（不存在），`npm run build:client` 必然失败。现改用
  `build.mjs`（esbuild 一次产出 host ESM + client CJS），带 host 外部化白名单自检。
- `dsh.client.inject` 里已不存在的 `@deepseek-ai/dsh-client-runtime` 换成
  `dsh-client-ui-renderer` / `-ui-settings` / `-ui-conversation`。
- client 类型从并不存在的 `SlotsService` 改为真实存在的 `SlotRegistry`
  （`@deepseek-ai/dsh-client-ui-renderer/client`）。

### 安装链上踩过的五个坑（都已修）

1. **pip 顺序反了会永远装不上 CUDA 版 torch**。`funasr` 依赖 torch；若先装 funasr，
   pip 会从 PyPI 拉一份 **CPU 版** torch（实测 2.14.0）。之后再用 cu128 索引装 CUDA 版时，
   pip 认为「本地 2.14.0 比索引里的 2.11.0+cu128 新」，报 `Requirement already satisfied`
   什么也不做——**表面成功，实际永远没有 CUDA**。
   修法：先装 torch/torchaudio，再装 funasr；已装 CPU 版时用
   `--force-reinstall --no-deps` 强制换。

2. **在 worker 进程内自检 torch 是无效的**。pip 改的是磁盘上的 torch，而 worker 早已
   `import torch`，内存模块是陈旧的。实测踩过：cu128 强装失败、磁盘 torch 已半损坏，
   worker 仍报「torch 2.14.0+cpu 可用」，自检放行，坏环境被当成好的。
   修法：`_torch_state(fresh=True)` 走**子进程**探测，pip 动过 torch 之后一律用它。

3. **pip 卸载失败会留下 `~orch` 残留**，与重新安装的文件混在同一目录，`import torch` 直接崩
   （实测报 `cannot import name 'autocast' from 'torch.amp'`）。
   修法：`_purge_torch_leftovers()` 清理 `~*` / `torch` / `torchgen` / `functorch`
   （刻意不碰 `torch_complex`，那是独立包），并在最终仍不可用时抛出带手修命令的明确错误。

4. **模型别名依赖联网，失败时报错极具误导性**。FunASR 的 `model='paraformer-zh'` 是**别名**，
   需要访问模型仓库拉 config.yaml 才能解析成模型类。代理没配时下载静默失败，funasr 抛的是
   `model 'paraformer-zh' is not registered` + 一坨 import 失败清单，看起来像版本不兼容，
   实际是网络问题。修法：`_build_auto_model` 捕获该错误并改写为「大概率访问不了模型仓库，
   检查 HTTP_PROXY / HTTPS_PROXY」。

5. **本机代理端口**：`HTTP_PROXY` / `HTTPS_PROXY` 指向 `10809`（不通），实际可用的是 `10808`。
   pip / modelscope / funasr 全部走这两个环境变量，指错就全线失败。

### 识别层：模型解析改为「离线优先」（重要）

**踩坑现场**：插件在真实 DSH 实例里跑识别时 500，报 `FunASR 无法解析模型 'paraformer-zh'`。
根因不在插件逻辑——**启动器给 DSH 进程注入了 `HTTP_PROXY=http://127.0.0.1:10809`**
（启动器配置里 `proxy_apply_dsh: true` + `proxy_port: 10809`），而 **10809 是死端口**
（本机真正可用的是 10808）。worker 继承该环境变量后，funasr 连不上模型仓库。

放大问题的是 funasr 的实现：`download_from_ms()` 里下载失败被 `except` **静默吞掉**（只 `print` 一行），
随后因为没读出 `config.yaml`，`kwargs["model"]` 仍是别名 `'paraformer-zh'`，最终抛出一句极具
误导性的 `model is not registered` + 一长串无关的 import 失败清单，看起来像版本不兼容。

**修法不是让它联网，而是让它彻底不联网。** funasr 的 `download_model_from_hub.py` 有一行关键判断：

```python
if not os.path.exists(model_or_path) and "model_path" not in kwargs:
    ... 联网下载 ...
```

**只要把 `model` 直接指向本地快照目录，联网分支根本不会进入**，随后它读本地 `config.yaml`
就得到模型类名。于是新增 `_local_model_dir()` / `_model_arg()`：按 modelscope 缓存布局
（`<cache>/models/<owner>--<name>/snapshots/master`）推算本地目录，命中即传本地路径，
`model` / `vad_model` / `punc_model` / `spk_model` 四处全部走这条路径。

附带修掉的两个问题：

- **别名与下载目标不一致**：旧代码下载 `speech_paraformer-large_...`，却把别名 `'paraformer-zh'`
  交给 funasr，而该别名在 funasr 1.4.15 里指向 **seaco_paraformer**——下的是 A，跑的是 B。
  现在一律用显式 repo id（`PARAFORMER_ZH` 等常量），彻底消除歧义。
- **就绪检测过于笼统**：原来只有「模型目录里有任意权重」一个布尔值，无法指出缺哪一块。
  现在逐个模型报 `ready` 与本地路径，`ready` 判据是「funasr + torch + 离线主模型都在本地」，
  **不要求联网**。

结果：在注入了死端口代理的真实 DSH 实例里，识别完全正常（18.7s / cuda:0 / 转写正确）。

### UI：拆成两个工作台页面 + 录音播放

原先只有设置页里的一张卡片，现改为**两个工作台页面**（页面目录由 `dsh-whlab` 的
`ctx.workbench` 提供，注册契约是 `ctx.workbench.mount({ id, title, render })`）：

| 页面 id | 标题 | 内容 |
|---|---|---|
| `recorder:backend` | 录音卡后端 | 识别环境（就绪检测 + 一键安装）、运行配置、蓝牙直连、实时文本流 |
| `recorder:library` | 录音内容 | 左侧录音列表 + 右侧详情（上音频播放器、下转写文档） |

- **录音内容页**：左侧列表可搜索，显示日期/时长/来源/分段数；右侧详情头部是会话元信息
  （来源、时长、模型、说话人数、音频体积），中间是播放器，下面是转写稿。转写稿按说话人
  分块，**点时间戳直接跳到对应播放位置**。
- **播放器自绘**：隐藏原生 `<audio>`，自己做播放/暂停、缓冲进度、点击与拖动定位、
  键盘方向键微调、0.75×~2× 变速、悬停时间气泡。拖动时只更新视觉、松手才 seek，
  避免拖动过程中狂发请求。
- **时长兜底**：Ogg/Opus 若缺正确的末页 granule，浏览器会把 `duration` 报成 `Infinity`；
  此时回退到会话记录里的 `durationMs`，保证进度条始终可用。
- 原先的 `settings.section` 设置卡已移除，避免与两个页面重复。

### HTTP：音频/文档端点支持 Range（播放拖动的前提）

原先音频端点把**整个文件读进内存**再以 200 返回，没有 `Accept-Ranges`：浏览器
`<audio>` 拖进度条时会发 `Range: bytes=N-`，服务端只回整文件的话进度条拖不动
（Chrome 会退化成只能从头播）。

现在改为 `serveFile()`：

- 无 Range → `200` + `Accept-Ranges: bytes`，用 `createReadStream().pipe(res)` 流式回；
- `bytes=a-b` / `bytes=a-` / `bytes=-n` → `206` + 精确的 `Content-Range`；
- 越界 → `416` + `Content-Range: bytes */total`；
- `HEAD` → `200` 且不带 body（路由层放行 HEAD）。

顺带把「整文件进内存」换成流式：录音可以很长，并发下载时整文件读会爆内存。

> 踩坑：改 `cordis.patch.yml` 会让启动器**整体重启实例**（端口会变），而不是热应用；
> 因此**host 半边（lib/index.js）的改动必须等实例重启后才生效**，只改 client 半边则刷新页面即可。
> 另外冒烟骨架里 mock 的 `res` 必须是真的 `Writable`——`createReadStream().pipe(res)`
> 遇到普通对象会抛 `dest.on is not a function`，一开始被误读成「Range 全 500」。

### 删除录音

列表与详情都能删，**两处共用同一个确认态**（不会出现两个「确认」同时挂着）。

- **列表**：悬停或选中时行右侧出现 `✕`，点击后该行就地变成「删除这条录音？不可恢复 [删除][取消]」。
- **详情**：头部「删除」按钮 → 下方弹出确认条，写明要删掉什么（音频多大、是否含 Markdown），
  确认后才执行。
- 删除后自动选中原位置的邻居，列表不会跳回第一条。
- 删除正在实时转写的会话时，先收流再删——否则收尾流程会把刚删掉的目录又写回来。

### 批量删除

列表头「多选」进入选择态：每行左侧出现勾选框，点行即勾选（不再切换详情），
头部变成「全选 / 已选 N 条 · 共 X MB / 删除选中」。确认条里写明条数、总体积，
以及**其中多少条带 LLM 总结**。删完自动退出选择态并刷新。

Host 侧 `POST /api/recorder/sessions/delete { ids }` **逐条走同一个 `remove()`**，
好让「总结归档」和「文件占用中失败」的语义与单条删除完全一致；单条失败不中断其余，
最后把失败清单原样报回，前端如实显示（`3 条已删除，1 条失败：…`），不假报全成功。
空 ids 与超过 500 条都返回 400。

### LLM 总结：删录音不许把总结一起删掉

录音删掉是删整个会话目录（音频 + 转写 md），但 **LLM 总结是花过算力的产物，必须活下来**。
所以总结归档在 `<outDir>/summaries/`——**刻意放在 `sessions/` 外面**，放在里面就会跟着
会话目录一起被删。

删除时：

1. 会话有 `summary` → 先把它渲染成独立文档写进 `summaries/`
2. **写失败就中止删除**，返回错误、目录原样留下
3. 写成功才删目录

第 2 条是这条需求的全部意义所在：宁可这次删不掉，也不能把 LLM 的活儿删了。
归档文件名用「录音时间 + 标题」（`20260915-012708 季度复盘会.md`）——按录音时间排序比
按归档时间排序更好找。归档文档保留机读元信息（session_id / 录制时间 / 时长 / 模型 /
说话人数 / 分段数）与总结正文，**不附带完整转写原文**（那等于把转写 md 又留了一份）。

配套端点：

```http
POST /api/recorder/summary      # 记入总结 {sessionId, text, title?}；带 title 时同时接管录音命名
GET  /api/recorder/summaries    # 已归档总结清单
```

`hasSummary` 也进了会话列表行，UI 上用 🧠 标出来，删除确认条会说明「总结会先归档」。
汇总层回归后直接调 `/summary` 即可，删除保护自动生效。

> ⚠️ 待确认：当前**归档文档不含转写原文**。若希望总结连同转写正文一起归档，说一声即可改。

**顺带补了一个安全漏洞**：`session_id` 来自 URL，而目录是 `join(root, id)`——
`../..` 就能让删除/读取跑到数据目录外面去。现在所有带 session id 的路由都先用
`isValidSessionId()`（`^[A-Za-z0-9._-]{1,80}$`）校验，非法直接 400。
删除是破坏性操作，这条尤其不能省。实测 `..%2F..%2F..%2Fetc` 被挡在 400。

> 当前是**硬删除**（不进回收站）。要「回收站 + 恢复」的话需要再单独做一轮。

**实测**：

| 项 | 结果 |
|---|---|
| 单条删除 | ✅ 目录消失、索引 16→15、`freedBytes` 正确 |
| 重复删除 | ✅ 200 / `existed:false`（幂等） |
| 批量删除 | ✅ 提交 5 个（含 2 非法）→ 删 4、失败 1（`a/b` 非法 id）、释放 41326 B、归档 1 份总结、返回新列表 11 条 |
| 路径穿越 / 非法 id | ✅ 均 400，数据目录根完好 |
| **归档失败中止删除** | ✅ 用同名文件顶掉 `summaries/` 制造归档失败 → 删除被拒，**会话目录与列表记录都原样还在**；恢复后重删成功并归档 |
| 空 ids / 超 500 条 | ✅ 均 400 |

### 录音自动命名（标题即文件名）

录音原先只有时间戳，认不出哪条是哪条。现在每条录音都有一个人看得懂的名字，
**并且这个名字就是磁盘上的文件名**——音频是 `<标题>.ogg`，文档是 `<标题>.md`。

- **自动命名**：识别完成后取转写内容开头若干字（默认 12 字，配置项 `titleMaxChars`）
  作为标题。会压平空白、去掉开头标点，并且不把英文单词从中间切断
  （避免出现 `meetin` 这种半截词）。
- **文件名清洗**：`\ / : * ? " < > |` 与控制字符替换为空格，去掉首尾的点和空格
  （Windows 不允许），规避 `CON`/`NUL`/`COM1` 等保留设备名，长度压到 64 字符以内。
- **零转写文本时兜底**为 `未转写 2026-09-15 001612`，识别失败的会话也能在列表里认出来。
- **一次定稿**：自动标题只在会话还没有标题时生效。实时转写过程中文本会不断增长，
  若每次都重取开头几个字，文件名会被反复改。
- **三层优先级**（`titleSource`）：`user` > `llm` > `auto`。用户手动改过的标题不会被
  任何自动流程覆盖。

**LLM 标题的接口已经就位**（等汇总层回归即可接）：

```http
POST /api/recorder/title
{ "sessionId": "rec-…", "title": "Q3 路线图沟通", "source": "llm" }
```

host 收到后会同步做三件事：改会话标题、把磁盘上的音频与 Markdown 一起改名、
**重写 Markdown 正文**（标题同时写在 front matter 与 H1 里，只改文件名不改内容会前后矛盾）。

配套改动：

- **`resolveArtifacts` 改为先信会话记录里的文件名**。原先它把 `audio.ogg` /
  `transcript.md` 写死，产物一改名就会解析失败、播放 404。现在记录缺失或文件不在时才
  退回默认名——老会话正是走这条回退路径。
- **`putArtifact` 换名时删除旧文件**，否则每改一次标题就多留一份孤儿文档。
- 启动后 1.5s 给**历史会话补标题并改名**（老数据没有 `title` 字段），改完顺带重写 Markdown。
- 列表项主行由日期改为标题，日期降为副行；带 `✎`/`✨` 标记区分手动命名与 LLM 命名；
  详情头部可就地编辑标题（回车保存、Esc 取消），搜索也能匹配标题。
- 下载音频时文件名跟着标题走。

**实测**：14 条历史会话全部补名并改名成功（`嘿你好嘿你好你.ogg` / 未转写会话为
`未转写 2026-09-15 001612.ogg`）；改名为「季度复盘会议」后文件名、front matter 的
`title`/`title_source`、正文 H1 三处同步更新且无残留文件；改名后 Range 播放仍是 206 正常。

### 开发流程：pm 真卸载 → 热装（host 改动的免重启迭代）

改 host 半边（`lib/index.js`）原本必须重启整个 DSH 实例才生效。用 pm 系列工具可以避免：

```bash
pm_uninstall  { name: 'dsh-ai-recorder' }          # 真卸载（clearData 默认 false，保住录音与模型）
# ↓ 关键一步，见下面第 1 个坑
#   往 cordis.patch.yml 加:  - id: dsh-ai-recorder / disabled: true
pm_tempLoad   { spec: '<插件目录绝对路径>' }        # 热装（换键为 dsh-ai-recorder-hotN）
pm_reloadClient                                    # 前端可见
# 迭代：改源码 → node build.mjs → pm_tempLoad → pm_reloadClient
# 定稿：pm_promote { name: '<返回的 packageName>' } 转正为持久装配
```

实测：卸载 → 热装 → Range 生效，**全程实例未重启**（同 PID、同端口）。

#### 坑 1：真卸载不会释放运行中的 fiber

`pm_uninstall` 在 profile 层面是干净的（`bundles` / `dependencies` / `node_modules` 全部移除、
`residue: false`），但**运行进程里那个 fiber 还活着**，仍然占着 `/api/recorder` 前缀路由。
此时 `pm_tempLoad` 会直接失败：

```
webserver: duplicate prefix route "/api/recorder"
```

因为 webServer 的 `register()` 对重复的 `(kind, path)` 是**抛异常**的（见官方
`host/webserver` 源码），第二个实例挂不上。

修法：往 `cordis.patch.yml` 写一条 `- id: dsh-ai-recorder / disabled: true`。
patch 层是**热生效**的（profile 目录被监听），这条会把这个 entry 停掉并 dispose 掉它的
fiber，路由随之释放，之后热装即可成功。**不需要重启实例。**

#### 坑 2：热装换键会让前端 bundle 注册错 id

`pm_tempLoad` 在同名冲突时会把包复制成 `dsh-ai-recorder-hotN`（换键机制，绕开模块缓存）。
loader 按**服务键**分发 client bundle，若 bundle 里仍以构建时写死的 `dsh-ai-recorder`
调 `__ModuleLoader__.load({ id })`，就会报「loaded without registering」，整个插件的前端起不来。

修法：`build.mjs` 的 banner 改为**运行期从自身脚本 URL 反推服务键**：

```
/plugins/??@deepseek-ai/x/client.js,dsh-ai-recorder-hot2/client.js&rev=…
                        ↑ 用 /(dsh-ai-recorder[^\/,.?&]*)\/client\.js/ 抓出来
```

依次尝试 `document.currentScript`，再回退到扫描页面里所有 `/plugins/` 脚本标签
（`currentScript` 只在经典脚本同步执行时有值，延迟注入时为 null）；都匹配不到就回退到
构建时的 id。同时**页面 id 保持稳定**（`recorder:backend` / `recorder:library`），
热重装不会在工作台目录里产生重复条目。

> ⚠️ 当前 `cordis.patch.yml` 里留了那条临时 `disabled: true`。它指向的包已不在 profile 里，
> 重启后是无害的空操作；**但若将来以 `dsh-ai-recorder` 这个原始包名重新持久安装，这条会把它禁掉**——
> 转正或重装前需先删掉它。

### 验证状态

| 项 | 状态 |
|---|---|
| typecheck（插件 src，alpha.5 类型环境） | ✅ 0 错误（官方源码树 34 条自身噪音已分流不计） |
| host 构建（esbuild → lib/index.js） | ✅ 77.9 kB |
| client 构建（esbuild → lib/client.js） | ✅ 26.7 kB |
| host 外部化自检 | ✅ 仅 node: 内建 + `@deepseek-ai/schemastery` |
| 装入 alpha.5 web profile | ✅ `dsh plugin add file:...` 成功，已进 `dsh.profile.bundles` |
| host 冒烟（`typecheck-tmp/smoke-host.mjs`） | ✅ 全部通过（路由/配置/会话/404/就绪/完整管线识别/**Range 七项**/卸载清路由） |
| **音频 Range** | ✅ 无 Range→200+`Accept-Ranges`；`bytes=100-199`→206 且正好 100 字节；`bytes=1000-`→206 且 11394 字节（= total−1000）；`bytes=-50`→206 且 50 字节；越界→416；`HEAD`→200 无 body；Markdown 同一套服务 |
| client 冒烟（`typecheck-tmp/smoke-client.mjs`） | ✅ banner id / footer / require 白名单均正确 |
| **两个工作台页面已注册** | ✅ `recorder:backend` 与 `recorder:library` 均在目录中，且已成功在工作台打开「录音内容（录音卡后端）」 |
| **pm 真卸载 → 热装闭环** | ✅ `pm_uninstall` 干净（residue:false，录音与模型保留）→ 热装为 `dsh-ai-recorder-hot2`（active, residue:false）→ 全程**实例未重启**（同 PID 156884 / 同端口 54071） |
| **热装后 Range 实测** | ✅ HEAD→200+`accept-ranges`；`bytes=100-199`→206 `bytes 100-199/12394`（100B）；`bytes=1000-`→206 `bytes 1000-12393/12394`（11394B）；`bytes=-50`→206 `bytes 12344-12393/12394`（50B）；越界→416 `bytes */12394` |
| L2 真机样本（解码 + 前导污染修复） | ✅ 5/5 精确吻合 |
| **L3+L4+L5 端到端离线识别** | ✅ 真机样本 → 转写「嘿你好嘿你好你，」、时长 5.91s、2 分段、说话人分离生效；三件套齐备；L5 解析正常 |
| FunASR 自动安装 | ✅ funasr 1.4.15 + torch + 模型权重安装成功；幂等，重跑会识别已就绪并跳过 |
| **CUDA 加速** | ✅ torch **2.11.0+cu128** / CUDA 12.8 / **RTX 5070 Ti，算力 (12,0) = sm_120 Blackwell** / GPU 实算通过 |
| **真实 DSH 实例内验证** | ✅ 实例 `i-f314c9b1`（端口 49412）内 `/health`、`/asr/status`（`ready:true`、`device:cuda`、`missing:[]`）、`/sessions`、`/session/<id>` 全部 200；`POST /audio` 端到端 **HTTP 200 / 18.7s / cuda:0 / 转写正确**；未知路径与未知会话正确 404 |
| **前端已注册** | ✅ `dsh-ai-recorder/client.js&rev=dc663e1fceba` 出现在页面预加载清单的 47 个前端插件中；bundle 内含 `settings.section` / `id: recorder-backend` / `label: 录音卡后端` |
| L3 流式逐字 | ⏳ 需真机 BLE 推流 |
| 真机 BLE（scan/connect/download/realtime） | ⏳ 待设备在手 |

### 复现命令

```bash
# 类型检查（自动从 alpha.5 官方源码树生成 paths）
node typecheck-tmp/generate-tsconfig.mjs && node typecheck-tmp/run-tsc.mjs

# 构建
node build.mjs

# host / client 冒烟（从安装目录加载真实产物）
node typecheck-tmp/smoke-host.mjs
node typecheck-tmp/smoke-client.mjs

# 端到端（需已装 FunASR；模型已在本地时不需要代理）
node typecheck-tmp/e2e-offline.mjs <某 .opus 样本>

# 真实实例内验证
curl -X POST http://127.0.0.1:<port>/api/recorder/audio \
     -H 'content-type: application/json' \
     -d "{\"audioBase64\":\"$(base64 -w0 <样本>)\",\"ext\":\"opus\"}"
```
