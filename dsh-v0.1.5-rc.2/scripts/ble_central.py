#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""CB08 / NextProto AI 录音卡 —— BLE Central 守护进程（bleak, 自实现收端）。

与插件（Node 侧）通过 stdio JSON-lines 通信：
  请求 (stdin) : {"id":1,"cmd":"scan","timeout":8}
  响应 (stdout): {"id":1,"ok":true,"result":...} / {"id":1,"ok":false,"error":"..."}
  事件 (stdout): {"event":"battery","level":96} 等（无 id，主动推送）

协议依据《AI录音卡 BLE 通讯协议 V1.0》：
  Service 0xAE20 / 写 0xAE21 (WRITE_NO_RSP) / 通知 0xAE22(应答+音频+文件) / 0xAE23(按键状态)
  帧: 5A SEQ CRC16LE(范围=LEN+DATA) LENLE DATA[TYPE CMD PARAMS]; CRC-16/XMODEM
  文件列表 count/time/size 大端; 下载请求 2-2 必须整帧 36B 单写; 文件名 20B 截断需重建扩展名

命令: hello / scan / connect / disconnect / status / battery / timesync / filelist
      / download / realtime(start|stop|pause|resume) / quit
用法: python ble_central.py            # 守护模式（stdio JSON-lines）
      python ble_central.py --selfcheck  # 帧/CRC 自检（无需设备）
"""
from __future__ import annotations

import asyncio
import base64
import json
import struct
import sys
import threading
import time
from datetime import datetime
from typing import Any, Optional

try:
    import bleak
    from bleak import BleakClient, BleakScanner
except Exception as e:  # 未装 bleak 时仍可 --selfcheck / 友好报错
    bleak = None
    BleakClient = None
    BleakScanner = None
    _BLEAK_IMPORT_ERROR = str(e)
else:
    _BLEAK_IMPORT_ERROR = None
    try:
        from importlib.metadata import version as _pkg_version
        _BLEAK_VERSION = _pkg_version("bleak")
    except Exception:
        _BLEAK_VERSION = getattr(bleak, "__version__", "?")

# ─────────────────────────── 协议常量 ───────────────────────────
MAGIC = 0x5A
SERVICE_UUID = "0000ae20-0000-1000-8000-00805f9b34fb"
CMD_CHAR_UUID = "0000ae21-0000-1000-8000-00805f9b34fb"
NOTIFY_CHAR_UUID = "0000ae22-0000-1000-8000-00805f9b34fb"
EVENT_CHAR_UUID = "0000ae23-0000-1000-8000-00805f9b34fb"

TYPE_CTRL, TYPE_AUDIO, TYPE_FILE, TYPE_KEY = 0, 1, 2, 3

# TYPE=0 控制
CMD_SYNC_TIME, CMD_GET_CAPACITY, CMD_CAPACITY_ACK = 0, 1, 2
CMD_GET_BATTERY, CMD_BATTERY_ACK = 3, 4
CMD_GET_FW, CMD_FW_ACK = 10, 11
CMD_GET_AUTH, CMD_AUTH_ACK = 12, 13
# TYPE=1 实时音频
CMD_START_STREAM, CMD_STREAM_FILE_NAME = 0, 0
CMD_AUDIO_DATA = 1
CMD_STOP_STREAM = 2
CMD_PAUSE_RESUME = 3
CMD_STREAM_STATE = 4
# TYPE=2 文件
CMD_LIST, CMD_LIST_DATA = 0, 1
CMD_IMPORT, CMD_IMPORT_START = 2, 3
CMD_FILE_DATA, CMD_IMPORT_END = 4, 5
CMD_IMPORT_ABORT = 7
CMD_DELETE_ONE = 8
CMD_DELETE_ONE_ACK = 13
CMD_LIST_DONE = 18
# TYPE=3 按键/录音
CMD_REC_START, CMD_REC_SAVE, CMD_REC_PAUSE, CMD_REC_RESUME = 1, 3, 5, 7
CMD_GET_GAIN, CMD_GAIN_ACK, CMD_SET_GAIN, CMD_SET_GAIN_ACK = 25, 26, 27, 28

# 删除等回执的时长：参考实现用 3s；旧固件可能压根不回，超时后靠「重拉列表」核对
DELETE_RESP_TIMEOUT = 3.0

# 单帧 DATA 长度上限。参考实现用 8192；没有这个上限时，一个字节翻转撞出的
# 假 MAGIC + 垃圾 LEN（最大 65541）会让解析器一直等一个凑不齐的"整帧"而永久卡死。
MAX_DATA_LEN = 8192

# 实时流攒段参数（与官方平台一致）
ASR_MIN_BYTES = 600     # 至少 600B
ASR_MAX_BYTES = 3200    # 最多 3200B
ASR_MIN_MS = 800        # 至少 800ms
PACKET_SIZE = 40        # QS668 40B 定长 Opus 包 = 20ms @16kHz 单声道


# ─────────────────────────── CRC / 帧 ───────────────────────────
class Crc16Xmodem:
    """poly 0x1021, init 0, no reflect, xorout 0; 向量 '123456789' -> 0x31C3"""

    _table: list[int] | None = None

    @classmethod
    def _ensure_table(cls) -> None:
        if cls._table is not None:
            return
        table = []
        for v in range(256):
            crc = v << 8
            for _ in range(8):
                crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
            table.append(crc)
        cls._table = table

    @classmethod
    def compute(cls, data: bytes) -> int:
        cls._ensure_table()
        crc = 0
        for b in data:
            crc = ((crc << 8) & 0xFFFF) ^ cls._table[((crc >> 8) & 0xFF) ^ b]
        return crc


def make_frame(seq: int, type_: int, cmd: int, params: bytes = b"") -> bytes:
    data = bytes([type_ & 0xFF, cmd & 0xFF]) + params
    len_le = struct.pack("<H", len(data))
    crc = Crc16Xmodem.compute(len_le + data)
    return bytes([MAGIC, seq & 0xFF]) + struct.pack("<H", crc) + len_le + data


def pack_sync_time(dt: datetime) -> bytes:
    """year:2B LE + month/day/hour/minute/second 各 1B"""
    return struct.pack("<HBBBBB", dt.year, dt.month, dt.day, dt.hour, dt.minute, dt.second)


def pack_import_request(offset: int, filename: bytes) -> bytes:
    """2-2 下载请求: offset:4B LE + filename:24B(NUL 补齐); 总帧 36B 必须整帧单写"""
    assert 1 <= len(filename) <= 24, "filename must be 1..24 bytes"
    return struct.pack("<I", offset) + filename.ljust(24, b"\x00")


def pack_delete_entry(name: str, time_s: int, size: int) -> bytes:
    """2-8 删除单个文件: 28B 条目 = time:4B BE + size:4B BE + name:20B NUL 截断"""
    name_b = name.encode("utf-8", "replace")[:20].ljust(20, b"\x00")
    return struct.pack(">II", time_s, size) + name_b


class FrameParser:
    """增量流式帧解析: 半帧/多帧/坏字节重同步/CRC 校验"""

    def __init__(self) -> None:
        self._buf = bytearray()
        self.dropped_crc = 0
        # 最近几个坏帧的原始 hex，供诊断（文档 §9 要求「记录原始hex」）
        self.bad_frames: list = []

    def reset(self) -> None:
        """
        清空接收缓冲与诊断计数。

        断连/重连时必须调用：缓冲里一旦残留半帧或垃圾，
        重连后新的真帧会被堵在后面解析不出来，只能重启守护进程。
        """
        self._buf = bytearray()
        self.dropped_crc = 0
        self.bad_frames = []

    def feed(self, chunk: bytes) -> list[dict]:
        frames: list[dict] = []
        self._buf += chunk
        while True:
            if len(self._buf) < 6:
                break
            if self._buf[0] != MAGIC:
                # 只丢 1 字节重同步：坏字节后面往往紧接着真帧，
                # 整段丢弃会把真帧一起吞掉
                del self._buf[0]
                continue
            data_len = struct.unpack_from("<H", self._buf, 4)[0]
            # 假帧头防护：一个字节翻转就能撞出 MAGIC + 垃圾 LEN（最大 65541），
            # 不设上限的话解析器会一直等一个永远凑不齐的"整帧"，**永久卡死**。
            if data_len > MAX_DATA_LEN:
                self.dropped_crc += 1
                self._note_bad(bytes(self._buf[:6]))
                del self._buf[0]
                continue
            if data_len == 0:
                # 长度为 0 的 DATA 帧无意义（也取不出 type），跳过而不是崩
                del self._buf[:6]
                continue
            total = 6 + data_len
            if len(self._buf) < total:
                break
            raw = bytes(self._buf[:total])
            crc_stored = struct.unpack_from("<H", raw, 2)[0]
            if crc_stored != Crc16Xmodem.compute(raw[4:]):
                self.dropped_crc += 1
                self._note_bad(raw)
                # 只丢 1 字节：这一帧坏了，但窗口里后面可能还有真帧，
                # 整帧丢弃会连带把真帧吞掉
                del self._buf[0]
                continue
            del self._buf[:total]
            body = raw[6:]
            frames.append({
                "seq": raw[1], "type": body[0],
                # 裸 ACK（只有 1 字节）没有 cmd：标成 None 而不是 0xFF，
                # 免得下游把它当成"未知按键码"误报成按键事件
                "cmd": body[1] if len(body) > 1 else None,
                "params": body[2:] if len(body) > 2 else b"",
            })
        return frames

    def _note_bad(self, raw: bytes) -> None:
        try:
            self.bad_frames.append(raw[:32].hex())
            if len(self.bad_frames) > 5:
                del self.bad_frames[0]
        except Exception:
            pass


def parse_file_list_entry(entry: bytes) -> dict:
    """28B: time:4B BE + size:4B BE + name:20B NUL 截断"""
    assert len(entry) == 28
    time_s = int.from_bytes(entry[0:4], "big")
    size = int.from_bytes(entry[4:8], "big")
    name = entry[8:28].split(b"\x00", 1)[0].decode("utf-8", "replace")
    # 保留原始 28B：删除请求的「格式 A」要的就是这条原始条目。
    # 必须 base64 —— 守护进程的输出走 json.dumps，直接塞 bytes 会
    # TypeError: Object of type bytes is not JSON serializable 把整个进程带崩。
    return {"time": time_s, "size": size, "name": name, "raw": base64.b64encode(entry).decode("ascii")}


def _truncate_name(name: str) -> str:
    """列表里的名字带 20B 截断，去掉尾部残留的 '.' 再重建扩展名。"""
    base = name
    if base.endswith(".wav") or base.endswith(".opus"):
        base = base[: -4]
    if base.endswith("."):
        base = base[: -1]
    return base


def pack_delete_variants(name: str, time_s: int, size: int, raw: Optional[bytes] = None) -> list:
    """
    删除单文件（TYPE=2 CMD=8）的 payload 候选，按「最可能是对的」排序。

    协议文档写的是「与文件列表相同的 28B 条目」（格式 A），但参考实现
    （uui77/NextProto desktop/recorder/device.py::delete_file）实测 V1.0.0 固件
    **只认格式 B**：`偏移量 4B LE(0x00000000) + 文件名 24B（带扩展名）`。
    两个说法冲突且都与固件版本相关，所以三种都试，谁被接受用谁。
    """
    base = _truncate_name(name)
    out: list = []

    def add(label: str, payload: bytes) -> None:
        if payload not in [p for _, p in out]:
            out.append((label, payload))

    # 格式 B(.opus)：参考实现验证过的那一种
    ext_opus = (base + ".opus").encode("utf-8", "replace")[:24].ljust(24, b"\x00")
    add("B(.opus)", struct.pack("<I", 0) + ext_opus)
    # 格式 B(截断名)：名字本来就是截断的，原样带上
    add("B(截断名)", struct.pack("<I", 0) + name.encode("utf-8", "replace")[:24].ljust(24, b"\x00"))
    # 格式 A(列表条目)：协议文档写的那种
    if raw and len(raw) == 28:
        add("A(列表条目)", bytes(raw))
    else:
        add("A(构造条目)", pack_delete_entry(name, time_s, size))
    return out


# ─────────────────────────── 实时流攒段 ───────────────────────────
class RealtimeAccumulator:
    """OPUS raw 流攒段: 达到 min/max 或窗口时间即 flush 一帧（40B 整数倍）。

    窗口可配：默认 10s/16000B —— whisper 对 10s 级片段识别远优于 0.8s 碎片
    （官方平台用 800ms 是演示近实时，实际转写质量很差）。
    """

    def __init__(self, emit, min_bytes: int = 600, max_bytes: int = 16000, min_ms: int = 10000) -> None:
        self._emit = emit
        self._buf = bytearray()
        self._start = time.monotonic()
        self.packets = 0
        self.min_bytes = min_bytes
        self.max_bytes = max_bytes
        self.min_ms = min_ms

    def feed(self, data: bytes) -> None:
        self._buf += data
        now = time.monotonic()
        elapsed_ms = (now - self._start) * 1000
        n = len(self._buf)
        if n >= self.max_bytes or (n >= self.min_bytes and elapsed_ms >= self.min_ms):
            self.flush()

    def flush(self) -> None:
        n = len(self._buf) // PACKET_SIZE * PACKET_SIZE
        if n <= 0:
            return
        chunk = bytes(self._buf[:n])
        del self._buf[:n]
        self.packets += n // PACKET_SIZE
        self._start = time.monotonic()
        self._emit("audio", {"data": base64.b64encode(chunk).decode("ascii"), "bytes": n})


# ─────────────────────────── 守护进程主体 ───────────────────────────
class BleCentralDaemon:
    def __init__(self, log=None) -> None:
        self.log = log or (lambda *a: None)
        self.client: Optional[BleakClient] = None
        self.connected = False
        self.address: Optional[str] = None
        self.mtu: Optional[int] = None
        self.battery: Optional[int] = None
        self.capacity: Optional[dict] = None
        self.fw: Optional[str] = None
        # 授权/绑定应答（0-13）。该命令我们目前不发，先留状态位以便真机验证时能看见回应
        self.auth_ack: Optional[str] = None
        self.seq = 0
        self._ae21 = None
        self._parsers = {"ae22": FrameParser(), "ae23": FrameParser()}
        # 文件列表
        self._list_buf: list[dict] = []
        self._list_last = 0.0
        self._list_done = False
        # 下载
        self._dl: Optional[dict] = None
        # 实时
        self._rt: Optional[RealtimeAccumulator] = None
        self.realtime_active = False
        self._disconnected_evt = asyncio.Event()
        # 自动重连（意外断连后）
        self._auto_reconnect = True
        self._manual_disconnect = False
        self._quitting = False
        self._reconnect_task: Optional[asyncio.Task] = None
        self._reconnect_attempt = 0
        # 连接互斥：同一时刻只允许一次连接尝试。
        # 重连循环与手动 connect 若并发驱动同一个适配器，WinRT 下必然双双失败——
        # 这正是「一直在重连、手动也连不上」的根因。
        self._connect_lock: Optional[asyncio.Lock] = None
        # 扫描互斥：同一适配器上**只能有一个扫描器**。用户扫描与重连循环内部扫描
        # （_do_connect 的 find_device_by_address 也是一次扫描）必须串行，
        # 否则在 WinRT 上会双双扫不到任何设备。
        self._scan_lock: Optional[asyncio.Lock] = None
        # 最近一次扫描到的 BLEDevice 对象：地址 → (device, 时间戳)。
        # 连接时直接复用，省掉 _do_connect 里那次重复扫描（弱信号下最多 12s/次）。
        self._scan_cache: dict = {}
        # 删除回执（2-13）；None 表示还没收到，旧固件可能一直不回
        self._del_ack: Optional[bool] = None
        # 链路探活（Windows WinRT 在信号丢失时可能不触发断连回调，需主动 ping）
        self._last_rx = 0.0          # 最近一次收到通知帧的时间（探活依据）
        self._pinging = False
        self._watchdog_task: Optional[asyncio.Task] = None
        # 增益（TYPE=3 CMD=25/27：1低 2中 3高）
        self.gain: Optional[int] = None
        # 设增益的成败回执（3-28）；None = 还没收到
        self._gain_ack: Optional[bool] = None

    # ---------- 工具 ----------
    def emit(self, **ev: Any) -> None:
        try:
            print(json.dumps(ev, ensure_ascii=False), flush=True)
        except Exception:
            pass

    def _next_seq(self) -> int:
        self.seq = (self.seq + 1) & 0xFF
        return self.seq

    def _require_connected(self) -> BleakClient:
        if not self.client or not self.connected:
            raise RuntimeError("未连接录音卡（先执行 connect）")
        return self.client

    async def send(self, type_: int, cmd: int, params: bytes = b"") -> None:
        c = self._require_connected()
        frame = make_frame(self._next_seq(), type_, cmd, params)
        try:
            await c.write_gatt_char(self._ae21, frame, response=False)
        except Exception as e:
            # 写失败 = 链路已断（信号丢失/设备重启）：立即修正状态并触发自动重连
            if self.connected:
                self._spawn(self._handle_disconnect())
            raise

    # ---------- 通知分发 ----------
    async def on_notify(self, key: str, data: bytes) -> None:
        self._last_rx = time.monotonic()
        for f in self._parsers[key].feed(data):
            self._dispatch(f)

    def _dispatch(self, f: dict) -> None:
        t, cmd, p = f["type"], f["cmd"], f["params"]
        if t == TYPE_CTRL:
            if cmd == CMD_BATTERY_ACK and len(p) >= 1:
                self.battery = p[0]
                self.emit(event="battery", level=self.battery)
            elif cmd == CMD_CAPACITY_ACK and len(p) >= 8:
                self.capacity = {"remain": int.from_bytes(p[0:4], "little"), "total": int.from_bytes(p[4:8], "little")}
                self.emit(event="capacity", capacity=self.capacity)
            elif cmd == CMD_FW_ACK:
                # 固件串是 NUL 填充的定长字段，不去掉的话版本号后面会拖一串 \x00
                self.fw = p.split(b"\x00", 1)[0].decode("ascii", "replace").strip()
                self.emit(event="fw", version=self.fw)
            elif cmd == CMD_AUTH_ACK:
                # 授权码应答：以前没有分支，直接被静默丢掉
                self.auth_ack = p.hex()
                self.emit(event="auth_ack", ok=(len(p) >= 1 and p[0] == 0), raw=p.hex())
            else:
                # 未知控制帧别静默丢弃——设备固件升级后可能出现新命令，
                # 留个事件便于发现，而不是让人对着"没反应"猜
                self.emit(event="ctrl_unknown", cmd=cmd, params=p.hex())
        elif t == TYPE_AUDIO:
            if cmd == CMD_STREAM_FILE_NAME:
                name = p.split(b"\x00", 1)[0].decode("utf-8", "replace")
                self.emit(event="stream", kind="file_name", name=name)
            elif cmd == CMD_AUDIO_DATA:
                if self._rt is not None:
                    self._rt.feed(p)
            elif cmd == CMD_STREAM_STATE and len(p) >= 1:
                state = p[0]
                self.emit(event="stream", kind="state", state=state)
                if state == 2:  # 设备停止推流
                    self._finish_realtime()
        elif t == TYPE_FILE:
            if cmd == CMD_LIST_DATA:
                try:
                    count = int.from_bytes(p[0:4], "big")
                except Exception:
                    count = 0
                for i in range(count):
                    entry = p[4 + i * 28: 4 + (i + 1) * 28]
                    if len(entry) < 28:
                        break
                    try:
                        self._list_buf.append(parse_file_list_entry(entry))
                    except Exception:
                        continue
                self._list_last = time.monotonic()
            elif cmd == CMD_LIST_DONE:
                self._list_done = True
            elif cmd == CMD_DELETE_ONE_ACK and len(p) >= 1:
                self._del_ack = p[0] == 0
                self.emit(event="delete_ack", ok=p[0] == 0, raw=p[0])
            elif cmd == CMD_IMPORT_START:
                if self._dl is not None:
                    self._dl["state"] = "start"
            elif cmd == CMD_FILE_DATA:
                if self._dl is not None:
                    self._dl["data"] += p
                    self._dl["last"] = time.monotonic()
            elif cmd == CMD_IMPORT_END and len(p) >= 1:
                if self._dl is not None and not self._dl["future"].done():
                    self._dl["code"] = p[0]
                    self._dl["future"].set_result(p[0])
        elif t == TYPE_KEY:
            if cmd == CMD_GAIN_ACK and len(p) >= 1:
                self.gain = p[0]
                self.emit(event="gain", level=self.gain)
            elif cmd == CMD_SET_GAIN_ACK and len(p) >= 1:
                self._gain_ack = p[0] == 0
                self.emit(event="gain_set", ok=p[0] == 0, raw=p[0])
            elif cmd == 0xFF or cmd is None:
                # 裸 ACK：只有 1 字节、没有 cmd。以前会掉进 else 被当成
                # 「未知按键码」误报成按键事件。设备对某些命令就回裸 ACK。
                self.emit(event="ack", type=t, params=p.hex())
            else:
                self.emit(event="key", cmd=cmd, params=p.hex())

    # ---------- 命令实现 ----------
    def cmd_hello(self) -> dict:
        return {
            "ok": True,
            "version": "0.1.0",
            "bleak": (_BLEAK_VERSION if bleak else None),
            "bleak_ok": bleak is not None,
            "connected": self.connected,
            "address": self.address,
            "battery": self.battery,
        }

    async def cmd_scan(self, req: dict) -> dict:
        if bleak is None:
            raise RuntimeError("bleak 未安装: " + (_BLEAK_IMPORT_ERROR or ""))
        timeout = float(req.get("timeout", 8))
        best: dict[str, dict] = {}

        def on_detect(device, adv) -> None:
            addr = device.address.lower()
            rssi = adv.rssi if adv.rssi is not None else -999
            if addr not in best or rssi > best[addr]["rssi"]:
                svcs = {s.lower() for s in (adv.service_uuids or [])}
                best[addr] = {
                    "address": device.address,
                    "name": adv.local_name or device.name or "",
                    "rssi": rssi,
                    "has_ae20": SERVICE_UUID.lower() in svcs,
                }
                # 顺手把 bleak 的 BLEDevice 对象也留下：连接时可以直接用，
                # 省掉 _do_connect 里那次重复的 find_device_by_address。
                # 弱信号下那次重复扫描最多白等 12 秒（timeout=12），重试 3 次就是 36 秒。
                self._scan_cache[addr] = (device, time.monotonic())

        # ① 用户发起的扫描先把自动重连循环停掉并**等它退出**。
        #
        # 重连循环内部也会调 `_do_connect` → `BleakScanner.find_device_by_address`，
        # 那本身就是一次扫描。两个扫描器同时驱动同一个适配器，
        # 在 WinRT 上会**双双扫不到任何设备** —— 这正是「一直扫描不到设备」的根因。
        # 重连循环自己发起的扫描要传 suspend_reconnect=False，否则它会把**自己**取消掉。
        if bool(req.get("suspend_reconnect", True)):
            await self._stop_reconnect_and_wait(timeout=12)

        if self._connect_lock is None:
            self._connect_lock = asyncio.Lock()
        if self._scan_lock is None:
            self._scan_lock = asyncio.Lock()

        # ② 锁顺序固定为 connect → scan，另一条路径只拿 connect，不会死锁。
        #    `_do_connect` 里的 find_device_by_address 也是一次扫描，必须一起互斥。
        async with self._connect_lock:
            async with self._scan_lock:
                scanner = BleakScanner(on_detect, scanning_mode="active")
                await scanner.start()
                try:
                    await asyncio.sleep(timeout)
                finally:
                    # 停止失败也必须放锁，否则一次异常会把扫描永久锁死
                    try:
                        await scanner.stop()
                    except Exception:
                        pass

        devices = sorted(best.values(), key=lambda d: -d["rssi"])
        return {"devices": devices}

    async def _do_connect(self, address: str, retries: int) -> dict:
        """核心连接流程：find→connect→订阅→状态→时间同步→电量。失败抛 RuntimeError。"""
        if bleak is None:
            raise RuntimeError("bleak 未安装: " + (_BLEAK_IMPORT_ERROR or ""))
        # 同一时刻只允许一次连接尝试：重连循环与手动 connect 并发驱动同一个适配器
        # 在 WinRT 下必然双双失败，这是「一直重连、手动也连不上」的根因。
        if self._connect_lock is None:
            self._connect_lock = asyncio.Lock()
        async with self._connect_lock:
            return await self._do_connect_locked(address, retries)

    async def _do_connect_locked(self, address: str, retries: int) -> dict:
        client: Optional[BleakClient] = None
        last_err: Optional[Exception] = None
        last_dev = None
        for i in range(retries):
            if i:
                await asyncio.sleep(1.5)
            # 优先用刚扫描到的 BLEDevice 对象，省掉一次 find_device_by_address。
            # 扫描缓存太旧（>15s）才重新扫——设备地址可能已变或已休眠。
            dev = None
            used_cache = False
            cached = self._scan_cache.get(address.lower())
            if cached is not None and time.monotonic() - cached[1] < 15.0:
                dev = cached[0]
                used_cache = True
            if dev is None:
                dev = await BleakScanner.find_device_by_address(address, timeout=12)
            if not dev:
                last_err = RuntimeError("扫描未发现该地址（设备可能休眠/超范围）")
                continue
            last_dev = dev
            cand = BleakClient(dev, timeout=20)
            try:
                await cand.connect()
                client = cand
                break
            except asyncio.CancelledError as e:
                # ⚠ bleak 的 winrt 后端在底层连接被中止时**直接抛 CancelledError**，
                # 而它继承自 BaseException，`except Exception` 根本拦不住 ——
                # 会一路穿过 cmd_connect、process_request，把**整个守护进程打死**
                # （日志表现为「BLE 守护进程退出，2s 后自动重启」反复循环，
                #  而界面永远停在「正在自动连接…」）。
                # 只有"真的有人在取消这个任务"时才该向上传播；否则当成一次普通连接失败。
                cur = asyncio.current_task()
                if cur is not None and cur.cancelling() > 0:
                    raise
                last_err = RuntimeError(f"连接被底层中止（winrt CancelledError）：{e}")
                self.log('连接被 winrt 底层中止，按普通失败重试')
                try:
                    await cand.disconnect()
                except Exception:
                    pass
                continue
            except Exception as e:
                last_err = e
                # **快速路径失败就作废缓存**。
                # 扫描到的 BLEDevice 属于那个**已经停止**的扫描器会话，句柄可能已失效：
                # 直接拿它 connect 会一直失败，而 15s 内重试拿到的还是同一个坏对象。
                # 表现就是「扫描明明看见卡了、自动连接却一直连不上」。
                # 作废之后下一轮会退回真正的 find_device_by_address。
                if used_cache:
                    self._scan_cache.pop(address.lower(), None)
                    self.log('扫描缓存的设备句柄连接失败，作废缓存、改用重新发现:', str(e))
                try:
                    await cand.disconnect()
                except Exception:
                    pass
        if client is None or not client.is_connected:
            raise RuntimeError(f"连接失败（重试 {retries} 次）：{last_err}（请确认录音卡开机且在电脑 1-3 米内）")

        # 服务与特征
        #
        # 注意：bleak 的 `get_service()` **找不到时返回 None，不抛异常**。
        # 早先这里写成 try/except 包住它，于是「服务不存在」这个正常分支永远不走，
        # 直接掉到下一行 `svc.characteristics` 炸成
        # `AttributeError: 'NoneType' object has no attribute 'characteristics'`，
        # 把「设备不是录音卡固件」这个真正的原因吞掉了。必须显式判 None。
        svc = None
        svc_err: Optional[Exception] = None
        try:
            svc = client.services.get_service(SERVICE_UUID)
        except Exception as e:  # 少数后端可能真的抛
            svc_err = e
        if svc is None:
            found: list = []
            try:
                for s in client.services:
                    found.append(f"{s.uuid}")
            except Exception as e:
                found = [f"（读取服务表失败：{e}）"]
            await client.disconnect()
            detail = f"；get_service 报错 {svc_err}" if svc_err else ""
            raise RuntimeError(
                f"已连接但未发现 AE20 服务——设备可能不是录音卡固件{detail}；"
                f"实际发现的服务：{', '.join(found) if found else '（空）'}"
            )
        chars = {c.uuid.lower(): c for c in svc.characteristics}
        for uuid, label in [(CMD_CHAR_UUID, "AE21"), (NOTIFY_CHAR_UUID, "AE22"), (EVENT_CHAR_UUID, "AE23")]:
            if uuid.lower() not in chars:
                await client.disconnect()
                raise RuntimeError(f"AE20 服务缺少特征 {label}")
        self._ae21 = chars[CMD_CHAR_UUID.lower()]
        try:
            await client.start_notify(chars[NOTIFY_CHAR_UUID.lower()], lambda h, d: self._spawn(self.on_notify("ae22", bytes(d))))
            await client.start_notify(chars[EVENT_CHAR_UUID.lower()], lambda h, d: self._spawn(self.on_notify("ae23", bytes(d))))
        except Exception as e:
            await client.disconnect()
            raise RuntimeError(f"订阅通知失败: {e}")

        def on_disconnect(client_=None) -> None:
            self._spawn(self._handle_disconnect())

        try:
            client.set_disconnected_callback(on_disconnect)
        except Exception:
            pass

        self.client = client
        self.connected = True
        self.address = last_dev.address if last_dev else address
        try:
            self.mtu = client.mtu_size
        except Exception:
            self.mtu = None

        # 链路一通、通知已订阅 —— **立刻**把 connected 事件发出去。
        #
        # 以前要等 _do_connect 整个返回（后面还有时间同步 + 查电量，其中
        # wait_battery(2.5) 最多干等 2.5 秒）才由调用方发事件。于是物理上早就连上了，
        # 界面却还停在「自动重连中」，用户要再过十几秒才看到「已连接」——
        # 卡上灯都亮了、插件还说在重连，就是这里压着没发。
        # 电量随后由 CMD_BATTERY_ACK 的 battery 事件单独补上，不阻塞「已连接」的呈现。
        self._reconnect_attempt = 0
        self.emit(
            event="connected",
            address=self.address,
            mtu=self.mtu,
            battery=self.battery,
            phase="link",
        )

        # 连接后自动：同步时间 + 查电量
        try:
            await self.send(TYPE_CTRL, CMD_SYNC_TIME, pack_sync_time(datetime.now()))
        except Exception:
            pass
        battery: Optional[int] = None
        try:
            battery = await self.wait_battery(2.5)
        except Exception:
            pass
        self._start_watchdog()
        return {
            "address": self.address,
            "mtu": self.mtu,
            "battery": battery,
            "bleak_retries": retries,
        }

    async def cmd_connect(self, req: dict) -> dict:
        # 先让重连循环彻底退场，否则它会和这次手动连接抢适配器
        self._auto_reconnect = True
        await self._stop_reconnect_and_wait()
        self._manual_disconnect = False
        if self.connected and self.client:
            # winrt 的 is_connected 在信号丢失后可能仍为 True：真实帧往返验证
            if await self._is_link_alive(2.0):
                return self.cmd_status()
            # 死链：清理旧状态后走正常连接流程
            self.connected = False
            try:
                await self.client.disconnect()
            except Exception:
                pass
            self.client = None
            self._finish_realtime()
            self.emit(event="disconnected", address=self.address)
            await asyncio.sleep(1.0)  # 给系统清理旧连接的时间
        address = req.get("address") or self.address
        retries = int(req.get("retries", 5))
        if not address:
            # 未指定地址：扫描自动挑选广播 AE20 的设备
            scan = await self.cmd_scan({"timeout": 8})
            for d in scan["devices"]:
                if d.get("has_ae20") or "cb08" in (d.get("name") or "").lower():
                    address = d["address"]
                    break
        if not address:
            raise RuntimeError("未指定地址且扫描未发现录音卡")
        result = await self._do_connect(address, retries)
        self._auto_reconnect = bool(req.get("auto_reconnect", True))
        self.emit(event="connected", address=self.address, mtu=self.mtu, battery=self.battery)
        return result

    # ---------- 自动重连 ----------
    def _cancel_reconnect(self) -> None:
        if self._reconnect_task and not self._reconnect_task.done():
            self._reconnect_task.cancel()
        self._reconnect_task = None

    async def _stop_reconnect_and_wait(self, timeout: float = 20.0) -> None:
        """
        取消重连循环并**等它真正退出**再返回。

        只调 cancel() 不够：它被取消时可能正卡在 `_do_connect` 的
        `find_device_by_address` 里，适配器仍被占着。不等它结束就发手动连接，
        两个连接尝试会互相踩，结果谁也连不上（弱信号下尤其明显）。
        """
        task = self._reconnect_task
        self._reconnect_task = None
        self._reconnect_attempt = 0
        if not task or task.done():
            return
        task.cancel()
        try:
            await asyncio.wait_for(task, timeout=timeout)
        except (asyncio.CancelledError, asyncio.TimeoutError):
            pass
        except Exception:
            pass

    def _start_reconnect_loop(self) -> None:
        if self._reconnect_task and not self._reconnect_task.done():
            return
        try:
            self._reconnect_task = asyncio.get_running_loop().create_task(self._reconnect_loop())
        except Exception:
            pass

    async def _reconnect_loop(self) -> None:
        """
        意外断连后自动重连；地址失效（设备重启后随机地址可能变）则定期扫描换新地址。

        重试间隔做退避。一断就每 5s 猛敲适配器会把手动连接也挤掉——
        弱信号下这是「越重连越连不上」的主因。
        """
        attempt = 0
        while self._auto_reconnect and not self.connected and not self._manual_disconnect and not self._quitting:
            attempt += 1
            self._reconnect_attempt = attempt
            self.emit(event="reconnecting", attempt=attempt, address=self.address)
            try:
                await self._do_connect(self.address, retries=3)
                self.emit(event="connected", address=self.address, mtu=self.mtu, battery=self.battery)
                self._reconnect_attempt = 0
                return
            except asyncio.CancelledError:
                raise
            except Exception as e:
                self.emit(event="reconnect_failed", attempt=attempt, error=str(e))
                if attempt % 3 == 0:
                    # 周期性扫描：设备重启后随机地址可能变化
                    try:
                        scan = await self.cmd_scan({"timeout": 6, "suspend_reconnect": False})
                        for d in scan["devices"]:
                            if d.get("has_ae20") or "cb08" in (d.get("name") or "").lower():
                                if d["address"] != self.address:
                                    self.emit(event="device_address_changed", old=self.address, new=d["address"])
                                self.address = d["address"]
                                break
                    except asyncio.CancelledError:
                        raise
                    except Exception:
                        pass
            # 退避：5s → 10s → 20s → 30s 封顶
            delay = min(30.0, 5.0 * (2 ** min(attempt - 1, 3)))
            try:
                await asyncio.sleep(delay)
            except asyncio.CancelledError:
                return

    # ---------- 链路探活（watchdog）----------
    def _start_watchdog(self) -> None:
        if self._watchdog_task and not self._watchdog_task.done():
            return
        try:
            self._watchdog_task = asyncio.get_running_loop().create_task(self._watchdog_loop())
        except Exception:
            pass

    async def _probe_link(self, timeout: float = 3.0) -> None:
        """发一条电量查询，等待任何新通知帧（_last_rx 前进）证明链路活着。"""
        before = self._last_rx
        await self.send(TYPE_CTRL, CMD_GET_BATTERY)
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self._last_rx > before:
                return
            await asyncio.sleep(0.1)
        raise TimeoutError("链路无应答（信号丢失/设备离线）")

    async def _is_link_alive(self, timeout: float = 2.0) -> bool:
        """winrt 的 is_connected 在信号丢失后可能仍为 True，用真实帧往返验证。"""
        if not self.client:
            return False
        try:
            if not self.client.is_connected:
                return False
            await asyncio.wait_for(self._probe_link(1.5), timeout=timeout + 1)
            return True
        except Exception:
            return False

    async def _watchdog_loop(self) -> None:
        """
        连接期间**周期性真的探活**。

        原来的两个跳过条件叠加出一个要命的缺口：
          - 「最近 5s 有过任何流量就跳过探测」
          - 「`_dl` 非空（下载中）一律跳过」
        于是只要断链那一刻没被 `set_disconnected_callback` 捕获、而恰好又有过流量，
        就**永远探不到**。表现正是用户报的：卡离范围了、卡自己显示无连接，
        插件却还显示已连接；又因为 `connected` 一直为 True，
        重连循环根本不会启动，卡回来了也没人去接。

        现在每个周期都发一条探活帧 —— 一次往返远比漏掉一次断链便宜。
        下载期间仍跳过（那时链路本来在高频传数据），但加了下限：
        超过 45s 一个字节都没收到，照样探。
        """
        while self.connected and self.client and not self._quitting and not self._manual_disconnect:
            await asyncio.sleep(8)
            if not (self.connected and self.client):
                break
            if self._pinging:
                continue
            idle = time.monotonic() - self._last_rx
            if self._dl is not None and idle < 45:
                continue
            self._pinging = True
            try:
                await asyncio.wait_for(self._probe_link(3.0), timeout=6)
            except Exception as exc:
                self.log('探活失败，判定为断链:', str(exc))
                if self.connected:
                    self._spawn(self._handle_disconnect())
            finally:
                self._pinging = False
        self._watchdog_task = None

    async def _supervisor_loop(self) -> None:
        """
        常驻兜底监督：只要「没连上 + 允许自动重连」，就保证重连循环在跑。

        为什么需要它：`_start_reconnect_loop()` 原来**只在 `_handle_disconnect` 里**
        被调用。一旦某次断链没被捕获（漏事件、watchdog 那次恰好跳过），
        `connected` 会一直是 True，重连循环永不启动 —— 卡拿回来也没人接。
        这个循环不管断链是"怎么"被发现的，只要发现状态不对就把重连拉起来。
        """
        while not self._quitting:
            await asyncio.sleep(5)
            try:
                if self._quitting or self._manual_disconnect:
                    continue
                if not self._auto_reconnect:
                    continue
                if self.connected:
                    continue
                # 只负责「恢复原本有过的连接」，不主动去连一个还没连过的设备。
                # 没有 self.address 说明这次生命周期里根本没连过——
                # 那种情况该由用户按「扫描设备」发起，不该被后台偷偷连上。
                if not self.address:
                    continue
                task = self._reconnect_task
                if task is not None and not task.done():
                    continue
                self.log('监督：发现处于未连接状态，启动自动重连（恢复', self.address, '）')
                self._start_reconnect_loop()
            except Exception as exc:  # noqa: BLE001 - 监督循环自己不能死
                self.log('监督循环异常:', str(exc))

    def _spawn(self, coro) -> None:
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(coro)
        except Exception:
            pass

    async def _handle_disconnect(self) -> None:
        was = self.connected
        self.connected = False
        self._finish_realtime()

        # **立刻**让在途的下载会话失败，而不是干等它自己超时。
        #
        # `_do_download` 的空闲超时是 12 秒：链路已经断了，它却还要傻等 12s 才肯
        # 抛错返回。而守护进程是单命令串行的 —— 这 12 秒里重连命令排不上队，
        # 于是用户看到「卡上早就重新连上了、插件还在转圈」。
        # 这里直接把 future 置异常，让下载立即收尾、把命令循环让出来。
        dl = self._dl
        if dl is not None:
            fut = dl.get("future")
            if fut is not None and not fut.done():
                fut.set_exception(RuntimeError("连接已断开，下载中止"))
            self._dl = None

        # 清接收缓冲：残留半帧/垃圾不清掉的话，重连后真帧会被堵在
        # 旧数据后面解析不出来，只能重启守护进程才能恢复
        for p in self._parsers.values():
            try:
                p.reset()
            except Exception:
                pass
        try:
            if self.client:
                await self.client.disconnect()
        except Exception:
            pass
        self.client = None
        if was:
            self.emit(event="disconnected", address=self.address)
        self._disconnected_evt.set()
        # 意外断连（非手动）→ 自动重连
        if self._auto_reconnect and not self._manual_disconnect and not self._quitting:
            self._start_reconnect_loop()

    async def cmd_disconnect(self) -> dict:
        self._manual_disconnect = True
        self._auto_reconnect = False
        self._cancel_reconnect()
        if self.client:
            try:
                await self.client.disconnect()
            except Exception:
                pass
        self.connected = False
        self.client = None
        self._finish_realtime()
        self.emit(event="disconnected", address=self.address)
        return {"ok": True}

    def cmd_status(self) -> dict:
        reconnecting = bool(self._reconnect_task and not self._reconnect_task.done() and not self.connected)
        return {
            "ok": True,
            "connected": self.connected,
            "reconnecting": reconnecting,
            # 让界面能显示「第 N 次」，而不是一个看不出进展的「重连中」
            "reconnect_attempt": self._reconnect_attempt if reconnecting else 0,
            "reconnect_task_alive": bool(self._reconnect_task and not self._reconnect_task.done()),
            "address": self.address,
            "mtu": self.mtu,
            "battery": self.battery,
            "capacity": self.capacity,
            "fw": self.fw,
            "realtime_active": self.realtime_active,
        }

    async def wait_battery(self, timeout: float) -> int:
        fut = asyncio.get_running_loop().create_future()

        async def waiter():
            # 必须先把缓存置空：self.battery 从不清空，第二次查询会
            # **立刻返回上一次的旧值**——看着成功，实际根本没问设备
            self.battery = None
            await self.send(TYPE_CTRL, CMD_GET_BATTERY)
            deadline = time.monotonic() + timeout
            while time.monotonic() < deadline:
                if self.battery is not None:
                    fut.set_result(self.battery)
                    return
                await asyncio.sleep(0.05)
            if not fut.done():
                fut.set_exception(RuntimeError("电量应答超时"))

        await asyncio.wait_for(waiter(), timeout + 1)
        return await fut

    async def cmd_battery(self) -> dict:
        level = await self.wait_battery(3.0)
        return {"level": level}

    async def cmd_timesync(self) -> dict:
        await self.send(TYPE_CTRL, CMD_SYNC_TIME, pack_sync_time(datetime.now()))
        return {"synced": True, "time": datetime.now().isoformat(timespec="seconds")}

    async def cmd_gain(self, req: dict) -> dict:
        """增益：action=get → {level}；action=set, level=1|2|3 → {ok}"""
        action = req.get("action", "get")
        if action == "get":
            fut = asyncio.get_running_loop().create_future()

            async def waiter():
                # 同电量：不先置空的话，set 之后（乐观写的）旧值会被当成设备回读值
                self.gain = None
                await self.send(TYPE_KEY, CMD_GET_GAIN)
                deadline = time.monotonic() + 2.5
                while time.monotonic() < deadline:
                    if self.gain is not None:
                        fut.set_result(self.gain)
                        return
                    await asyncio.sleep(0.05)
                if not fut.done():
                    fut.set_exception(RuntimeError("增益应答超时"))

            await asyncio.wait_for(waiter(), 3.5)
            return {"level": await fut}
        if action == "set":
            level = int(req.get("level", 3))
            if level not in (1, 2, 3):
                raise ValueError(f"增益等级需为 1|2|3, 收到 {level}")
            # 等 3-28 的成败回执再下结论：以前发完就乐观返回 ok=True，
            # 设备拒绝也看不出来（而这条链路此前根本没有 UI 调用，问题被藏着）
            self._gain_ack = None
            await self.send(TYPE_KEY, CMD_SET_GAIN, bytes([level]))
            deadline = time.monotonic() + 3.0
            while time.monotonic() < deadline:
                if self._gain_ack is not None:
                    break
                await asyncio.sleep(0.05)
            if self._gain_ack is None:
                # 旧固件可能不回：如实说明"未确认"，不谎报成功
                return {"ok": False, "level": level, "error": "设备未回设增益应答（旧固件可能不支持），状态未知"}
            if self._gain_ack is not True:
                return {"ok": False, "level": level, "error": "设备拒绝了该增益设置"}
            self.gain = level
            return {"ok": True, "level": level}
        raise ValueError(f"未知 gain action: {action}")

    async def cmd_delete(self, req: dict) -> dict:
        """删除单个文件（TYPE=2 CMD=8，28B 条目）。ack 可能不返回（旧固件），发完即返回。"""
        name = str(req.get("name", "")).strip()
        if not name:
            raise RuntimeError("缺少文件名")
        time_s = int(req.get("time", 0))
        size = int(req.get("size", 0))
        raw = req.get("raw")
        # JSON 通道传过来的是 base64 字符串；模块内调用可能是 bytes
        raw_b: Optional[bytes] = None
        if isinstance(raw, str) and raw:
            try:
                raw_b = base64.b64decode(raw)
            except Exception:
                raw_b = None
        elif isinstance(raw, (bytes, bytearray)):
            raw_b = bytes(raw)
        variants = pack_delete_variants(name, time_s, size, raw_b)
        want = name

        tried: list = []
        for label, payload in variants:
            await self.send(TYPE_FILE, CMD_DELETE_ONE, payload)
            # 等回执：新固件会回 2-13（body[0]==0 表示成功），旧固件可能不回
            acked = await self.wait_delete_ack(DELETE_RESP_TIMEOUT)
            tried.append({"format": label, "ack": acked})
            if acked is True:
                # 回执说成功还不够——回执语义在各固件版本间并不一致，
                # 真正说了算的是「再拉一次列表，这条还在不在」。
                if await self._file_gone(want):
                    return {"ok": True, "name": name, "format": label, "verified": "ack+list", "tried": tried}
                tried[-1]["ack_note"] = "设备回执成功但列表里仍在"
                continue
            if acked is False:
                continue  # 明确被拒，换下一种格式
            # 无回执（旧固件）：给设备一点时间落盘后再核对列表
            if await self._file_gone(want):
                return {"ok": True, "name": name, "format": label, "verified": "list", "tried": tried}

        # 三种格式都没能删掉它
        still = await self._file_present(want)
        raise RuntimeError(
            f"删除失败：{name} 仍在设备上（已尝试 {len(variants)} 种 payload 格式："
            + "、".join(t["format"] for t in tried)
            + "；最后列表核对=" + ("仍存在" if still else "已消失")
            + "）"
        )

    async def wait_delete_ack(self, timeout: float) -> Optional[bool]:
        """等 2-13 删除回执。返回 True/False；超时（旧固件不回）返回 None。"""
        self._del_ack = None
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self._del_ack is not None:
                return self._del_ack
            await asyncio.sleep(0.05)
        return self._del_ack

    async def _file_gone(self, name: str) -> bool:
        """删完核对：重新拉列表，看这条还在不在。设备回执不足为凭，列表才是事实。"""
        try:
            await asyncio.sleep(0.6)  # 给设备时间把目录写下去
            r = await self.cmd_filelist()
            return not any(e["name"] == name for e in r["entries"])
        except Exception:
            return False

    async def _file_present(self, name: str) -> bool:
        try:
            r = await self.cmd_filelist()
            return any(e["name"] == name for e in r["entries"])
        except Exception:
            return True

    async def cmd_filelist(self) -> dict:
        self._list_buf = []
        self._list_last = time.monotonic()
        self._list_done = False
        await self.send(TYPE_FILE, CMD_LIST)
        start = time.monotonic()
        while True:
            if self._list_done:
                break
            elapsed = time.monotonic() - start
            idle = time.monotonic() - self._list_last
            if len(self._list_buf) > 0 and idle >= 1.2:  # 兼容无 CMD=18 旧固件
                break
            if elapsed >= 3.5:
                break
            await asyncio.sleep(0.1)

        # 一帧都没收到、也没收到终止帧 → 不能谎报「设备上没有文件」。
        # 同步/下载占用连接时正是这个表现（固件不会并发响应），弱信号丢包也一样。
        # 真正的空设备会回终止帧（CMD=18），所以用 done_frame 区分这两种情况。
        if not self._list_buf and not self._list_done:
            raise RuntimeError(
                "未收到文件列表响应——连接可能正被同步/下载占用，或信号太弱丢包"
                "（设备确实为空时会收到终止帧，此处没有）"
            )
        return {"entries": self._list_buf, "done_frame": self._list_done}

    @staticmethod
    def _validate_audio(data: bytes, filename: str) -> tuple[bool, str]:
        """下载完整性校验（弱信号下帧损坏/截断的兜底检测）"""
        if not data:
            return False, "收到 0 字节"
        low = filename.lower()
        if low.endswith(".wav"):
            if data[:4] != b"RIFF" or data[8:12] != b"WAVE":
                return False, "WAV 头非法（RIFF/WAVE 缺失）"
            declared = int.from_bytes(data[4:8], "little") + 8
            if declared != len(data):
                return False, f"WAV 长度不符: 声明 {declared} 实际 {len(data)}"
            return True, "ok"
        if len(data) % PACKET_SIZE != 0:
            return False, f"OPUS 长度非 40B 倍数: {len(data)}"
        if len(data) < PACKET_SIZE * 10:
            return False, f"OPUS 过短: {len(data)}B"
        return True, "ok"

    async def _do_download(self, filename: str, chunk_time: float = 60.0, chunk_bytes: int = 262144,
                           total_budget: float = 1500.0) -> tuple[bytes, int, dict]:
        """下载单个候选名（协议 2-2；chunk_bytes<=0 时单次传输，否则分片+offset 续传）。

        分片模式每片受「时间预算 / 字节预算」约束，超限 abort 后用 offset 续传，
        直到设备回 CMD=5（完成）或总预算耗尽。真机验证：部分设备固件不接受非零 offset
        （返回 code=2），由 cmd_download 降级为单次传输。

        返回 (data, code, stats)；code: 0=成功 1=不存在 2=offset过大 3=设备停止 4=失败(重试耗尽/无进展/超预算)
        """
        name_bytes = filename.encode("utf-8", "replace")[:24]
        last_err = ""
        single_shot = chunk_bytes <= 0
        for attempt in range(1, 3):
            all_data = bytearray()
            offset = 0
            chunks = 0
            crc_total_before = self._parsers["ae22"].dropped_crc
            start_all = time.monotonic()
            while True:
                fut = asyncio.get_running_loop().create_future()
                self._dl = {"future": fut, "data": bytearray(), "last": time.monotonic(), "state": "idle", "code": None, "crc_before": crc_total_before}
                await self.send(TYPE_FILE, CMD_IMPORT, pack_import_request(offset, name_bytes))  # 整帧 36B 单写
                chunk_start = time.monotonic()
                code: Optional[int] = None
                while True:
                    if fut.done():
                        code = self._dl["code"]
                        break
                    if time.monotonic() - self._dl["last"] > 12:  # 空闲超时（无数据）
                        break
                    if not single_shot and time.monotonic() - chunk_start > chunk_time:  # 分片时间预算
                        break
                    if not single_shot and len(self._dl["data"]) >= chunk_bytes:  # 分片字节预算
                        break
                    await asyncio.sleep(0.05)
                received = bytes(self._dl["data"]) if self._dl is not None else b""
                if self._dl is not None:
                    if code is None:
                        # 未完成的分片会话 → abort 清理（完成后不要发 abort，避免污染设备状态机）
                        try:
                            await self.send(TYPE_FILE, CMD_IMPORT_ABORT)
                        except Exception:
                            pass
                    self._dl = None
                if code is not None:
                    if code != 0:
                        return b"", code, {"attempts": attempt, "crc_drops": 0, "chunks": chunks}
                    # CMD=5 完成 → 校验整包
                    all_data += received
                    crc_drops = self._parsers["ae22"].dropped_crc - crc_total_before
                    ok, reason = self._validate_audio(bytes(all_data), filename)
                    if ok and crc_drops == 0:
                        return bytes(all_data), 0, {"attempts": attempt, "crc_drops": crc_drops, "chunks": chunks + 1}
                    last_err = f"数据异常(第{attempt}次): {reason}, crc_drops={crc_drops}, bytes={len(all_data)}"
                    break  # 校验不过 → 整体重试
                if single_shot:
                    # 单次传输：空闲超时即失败（总预算由外层 while 判定）
                    last_err = f"传输空闲超时(第{attempt}次)"
                    break
                # 分片预算到，未完成 → 续传
                all_data += received
                offset += len(received)
                chunks += 1
                if not received:
                    last_err = f"分片无进展(第{attempt}次)"
                    break
                if time.monotonic() - start_all > total_budget:
                    last_err = f"总预算超时({total_budget:.0f}s)，已收 {len(all_data)}B"
                    break
                await asyncio.sleep(0.8)  # 两次请求间给设备喘息
        return b"", 4, {"attempts": 2, "crc_drops": 0, "reason": last_err, "chunks": chunks}

    async def cmd_download(self, req: dict) -> dict:
        name = str(req.get("name", "")).strip()
        if not name:
            raise RuntimeError("缺少文件名")
        base = name
        if base.endswith(".wav") or base.endswith(".opus"):
            base = base[: -4]
        if base.endswith("."):
            base = base[: -1]  # 20B 截断会在末尾留下 '.', 重建扩展名前必须去掉
        # 候选名顺序：.opus 优先。
        #   .opus 是设备**实际存储格式**（16 kbps ≈ 2 KB/s），.wav 是设备实时转码产物
        #   （16kHz/16bit/mono = 32 KB/s，体积 16 倍）。BLE 传输慢，优先小体积格式；
        #   .wav 仅作为 .opus 不存在时的兜底。
        #   社区实现（uui77/nextproto）在同一结论上做过同样的改动。
        prefer = str(req.get("prefer", "opus")).lower()
        if prefer == "wav":
            order = [base + ".wav", base + ".opus", base, name]
        else:
            order = [base + ".opus", base + ".wav", base, name]
        candidates = []
        for cand in order:
            if cand not in candidates:
                candidates.append(cand)
        last_err = ""
        rounds = 2  # 弱信号下设备转码/传输可能偶发异常，候选名轮两轮
        for round_no in range(1, rounds + 1):
            for cand in candidates:
                self.emit(event="download", kind="trying", name=cand, round=round_no)
                total_budget = float(req.get("total_budget", 1500))
                # 默认单次传输（本设备固件不支持 offset 续传）；显式传 chunk_bytes>0 才分片
                data, code, stats = await self._do_download(
                    cand,
                    chunk_time=float(req.get("chunk_time", 60)),
                    chunk_bytes=int(req.get("chunk_bytes", 0)),
                    total_budget=total_budget,
                )
                if code == 0:
                    ext = "wav" if cand.lower().endswith(".wav") else "opus"
                    return {
                        "name": cand,
                        "ext": ext,
                        "size": len(data),
                        "data": base64.b64encode(data).decode("ascii"),
                        "attempts": stats.get("attempts", 1),
                        "crc_drops": stats.get("crc_drops", 0),
                        "chunks": stats.get("chunks", 1),
                    }
                if code in (2, 3):
                    raise RuntimeError(f"下载失败：候选名 {cand} 返回 code={code}（设备错误）")
                last_err = f"候选名 {cand} 返回 code={code}（第{round_no}轮）"
        raise RuntimeError(f"下载失败：{last_err}（文件名 20B 截断，已自动尝试重建扩展名；弱信号下已自动重试）")

    # ---------- 实时流 ----------
    def _finish_realtime(self) -> None:
        if self._rt is not None:
            self._rt.flush()
            self._rt = None
        if self.realtime_active:
            self.realtime_active = False
            self.emit(event="stream", kind="stopped")

    async def cmd_realtime(self, req: dict) -> dict:
        action = req.get("action")
        if action == "start":
            self._require_connected()
            if self._rt is None:
                # 攒段窗口可配（默认 10s 大窗口，保证转写质量）
                self._rt = RealtimeAccumulator(
                    lambda kind, payload: self.emit(event="stream", kind=kind, **payload),
                    min_bytes=int(req.get("min_bytes", 600)),
                    max_bytes=int(req.get("max_bytes", 16000)),
                    min_ms=int(req.get("window_ms", 10000)),
                )
            await self.send(TYPE_AUDIO, CMD_START_STREAM)
            self.realtime_active = True
            self.emit(event="stream", kind="started", window_ms=int(req.get("window_ms", 10000)))
            return {"active": True}
        if action in ("stop", "pause", "resume"):
            self._require_connected()
            if action == "stop":
                await self.send(TYPE_AUDIO, CMD_STOP_STREAM)
                self._finish_realtime()
                return {"active": False}
            await self.send(TYPE_AUDIO, CMD_PAUSE_RESUME, bytes([1 if action == "pause" else 0]))
            return {"action": action}
        raise RuntimeError(f"未知 realtime action: {action}")

    # ---------- 请求入口（顺序执行） ----------
    async def process_request(self, req: dict) -> dict:
        cmd = req.get("cmd")
        try:
            if cmd == "hello":
                return self.cmd_hello()
            if cmd == "scan":
                return {"ok": True, **await self.cmd_scan(req)}
            if cmd == "connect":
                return {"ok": True, **await self.cmd_connect(req)}
            if cmd == "disconnect":
                return await self.cmd_disconnect()
            if cmd == "simulate_disconnect":
                # 调试/测试：模拟意外断连（触发自动重连）
                if not self.connected:
                    return {"ok": True, "already_disconnected": True}
                self._spawn(self._handle_disconnect())
                return {"ok": True, "simulated": True}
            if cmd == "status":
                return self.cmd_status()
            if cmd == "battery":
                return {"ok": True, **await self.cmd_battery()}
            if cmd == "timesync":
                return {"ok": True, **await self.cmd_timesync()}
            if cmd == "gain":
                return {"ok": True, **await self.cmd_gain(req)}
            if cmd == "filelist":
                return {"ok": True, **await self.cmd_filelist()}
            if cmd == "delete":
                return {"ok": True, **await self.cmd_delete(req)}
            if cmd == "download":
                return {"ok": True, **await self.cmd_download(req)}
            if cmd == "realtime":
                return {"ok": True, **await self.cmd_realtime(req)}
            if cmd == "quit":
                self._quitting = True
                self._cancel_reconnect()
                if self.client:
                    try:
                        await self.client.disconnect()
                    except Exception:
                        pass
                self.connected = False
                self.client = None
                return {"bye": True}
            raise ValueError(f"未知命令: {cmd}")
        except Exception as e:
            return {"ok": False, "error": f"{type(e).__name__}: {e}"}
        except BaseException as e:  # noqa: BLE001
            # ⚠ 守护进程**绝不能被单条命令打死**。
            #
            # bleak 的 winrt 后端会抛 `asyncio.CancelledError` 表示"底层连接被中止"，
            # 而 CancelledError 继承自 BaseException —— 上面的 `except Exception` 拦不住，
            # 它会一路穿过命令循环，把整个守护进程干掉（日志里表现为
            # 「BLE 守护进程退出，2s 后自动重启」反复循环，界面永远停在「正在自动连接…」）。
            #
            # 这里兜住所有 BaseException：除非真的是**外部在取消这个任务**
            # （进程要退出/被显式 cancel），否则一律降级成一条命令失败返回。
            cur = asyncio.current_task()
            if isinstance(e, asyncio.CancelledError) and cur is not None and cur.cancelling() > 0:
                raise
            self.log('命令抛出 BaseException，已拦下以免守护进程退出:', cmd, repr(e))
            return {"ok": False, "error": f"{type(e).__name__}: {e}"}


# ─────────────────────────── 主入口 ───────────────────────────
def selfcheck() -> int:
    """帧/CRC 自检（无需设备）：官方示例帧 + 标准向量"""
    ok = True
    # 1) CRC 标准向量
    crc = Crc16Xmodem.compute(b"123456789")
    if crc != 0x31C3:
        print(f"FAIL crc vector: {crc:#06x} != 0x31C3")
        ok = False
    else:
        print("OK  crc vector '123456789' -> 0x31C3")
    # 2) 官方真实 TX 帧（7.3 节 note20260710-162938.wav 下载请求）
    official = bytes.fromhex(
        "5a 03 9e 20 1e 00 02 02 00 00 00 00 6e 6f 74 65"
        "32 30 32 36 30 37 31 30 2d 31 36 32 39 33 38 2e"
        "77 61 76 00".replace(" ", "")
    )
    frame = make_frame(3, 2, 2, pack_import_request(0, b"note20260710-162938.wav"))
    if frame == official:
        print("OK  official TX frame matches byte-for-byte")
    else:
        print(f"FAIL official frame\n  expect {official.hex()}\n  actual {frame.hex()}")
        ok = False
    # 3) 解析器自检（坏字节重同步 + CRC 校验；干扰字节不含 0x5A）
    parser = FrameParser()
    frames = parser.feed(bytes([0x00, 0x41]) + official + bytes([0x01]))
    if len(frames) == 1 and frames[0]["type"] == 2 and frames[0]["cmd"] == 2:
        print("OK  parser resync + parse")
    else:
        print(f"FAIL parser: {frames}")
        ok = False
    return 0 if ok else 1


async def amain() -> int:
    if bleak is None:
        print(json.dumps({"event": "ready", "error": "bleak 未安装: " + (_BLEAK_IMPORT_ERROR or "")}), flush=True)
        while True:  # 仍保持存活，Node 侧可探测
            await asyncio.sleep(3600)
    daemon = BleCentralDaemon()
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()

    def reader() -> None:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                req = json.loads(line)
            except Exception:
                continue
            loop.call_soon_threadsafe(queue.put_nowait, req)

    threading.Thread(target=reader, daemon=True).start()
    # 常驻监督：保证「未连接且允许自动重连」时重连循环一定在跑。
    # 它不依赖任何单次断链事件，是漏检的兜底。
    asyncio.get_running_loop().create_task(daemon._supervisor_loop())
    print(json.dumps({
        "event": "ready",
        "version": "0.1.0",
        "bleak": (_BLEAK_VERSION if bleak else None),
    }, ensure_ascii=False), flush=True)
    while True:
        req = await queue.get()
        result = await daemon.process_request(req)
        rid = req.get("id")
        if result.get("bye"):
            if rid is not None:
                result["id"] = rid
                print(json.dumps(result, ensure_ascii=False), flush=True)
            break
        if rid is not None:
            result["id"] = rid
        print(json.dumps(result, ensure_ascii=False), flush=True)
    return 0


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stdin.reconfigure(encoding="utf-8", errors="replace")
    if "--selfcheck" in sys.argv:
        return selfcheck()
    try:
        return asyncio.run(amain())
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    sys.exit(main())
