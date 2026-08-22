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

    def feed(self, chunk: bytes) -> list[dict]:
        frames: list[dict] = []
        self._buf += chunk
        while True:
            if len(self._buf) < 6:
                break
            if self._buf[0] != MAGIC:
                del self._buf[0]
                continue
            data_len = struct.unpack_from("<H", self._buf, 4)[0]
            total = 6 + data_len
            if len(self._buf) < total:
                break
            raw = bytes(self._buf[:total])
            del self._buf[:total]
            crc_stored = struct.unpack_from("<H", raw, 2)[0]
            if crc_stored != Crc16Xmodem.compute(raw[4:]):
                self.dropped_crc += 1
                continue
            body = raw[6:]
            frames.append({
                "seq": raw[1], "type": body[0],
                "cmd": body[1] if len(body) > 1 else 0xFF,
                "params": body[2:] if len(body) > 2 else b"",
            })
        return frames


def parse_file_list_entry(entry: bytes) -> dict:
    """28B: time:4B BE + size:4B BE + name:20B NUL 截断"""
    assert len(entry) == 28
    time_s = int.from_bytes(entry[0:4], "big")
    size = int.from_bytes(entry[4:8], "big")
    name = entry[8:28].split(b"\x00", 1)[0].decode("utf-8", "replace")
    return {"time": time_s, "size": size, "name": name}


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
        # 链路探活（Windows WinRT 在信号丢失时可能不触发断连回调，需主动 ping）
        self._last_rx = 0.0          # 最近一次收到通知帧的时间（探活依据）
        self._pinging = False
        self._watchdog_task: Optional[asyncio.Task] = None
        # 增益（TYPE=3 CMD=25/27：1低 2中 3高）
        self.gain: Optional[int] = None

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
                self.fw = p.decode("ascii", "replace")
                self.emit(event="fw", version=self.fw)
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
                self.emit(event="gain_set", ok=p[0] == 0, raw=p[0])
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

        scanner = BleakScanner(on_detect, scanning_mode="active")
        await scanner.start()
        await asyncio.sleep(timeout)
        await scanner.stop()
        devices = sorted(best.values(), key=lambda d: -d["rssi"])
        return {"devices": devices}

    async def _do_connect(self, address: str, retries: int) -> dict:
        """核心连接流程：find→connect→订阅→状态→时间同步→电量。失败抛 RuntimeError。"""
        if bleak is None:
            raise RuntimeError("bleak 未安装: " + (_BLEAK_IMPORT_ERROR or ""))
        client: Optional[BleakClient] = None
        last_err: Optional[Exception] = None
        last_dev = None
        for i in range(retries):
            if i:
                await asyncio.sleep(1.5)
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
            except Exception as e:
                last_err = e
                try:
                    await cand.disconnect()
                except Exception:
                    pass
        if client is None or not client.is_connected:
            raise RuntimeError(f"连接失败（重试 {retries} 次）：{last_err}（请确认录音卡开机且在电脑 1-3 米内）")

        # 服务与特征
        try:
            svc = client.services.get_service(SERVICE_UUID)
        except Exception as e:
            await client.disconnect()
            raise RuntimeError(f"已连接但未发现 AE20 服务（{e}）——设备可能不是录音卡固件")
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
        self._cancel_reconnect()
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

    def _start_reconnect_loop(self) -> None:
        if self._reconnect_task and not self._reconnect_task.done():
            return
        try:
            self._reconnect_task = asyncio.get_running_loop().create_task(self._reconnect_loop())
        except Exception:
            pass

    async def _reconnect_loop(self) -> None:
        """意外断连后自动重连：每 5s 重试；地址失效（重启后随机地址可能变）则定期扫描换新地址。"""
        attempt = 0
        while self._auto_reconnect and not self.connected and not self._manual_disconnect and not self._quitting:
            attempt += 1
            self.emit(event="reconnecting", attempt=attempt, address=self.address)
            try:
                await self._do_connect(self.address, retries=3)
                self.emit(event="connected", address=self.address, mtu=self.mtu, battery=self.battery)
                return
            except Exception as e:
                self.emit(event="reconnect_failed", attempt=attempt, error=str(e))
                if attempt % 3 == 0:
                    # 周期性扫描：设备重启后随机地址可能变化
                    try:
                        scan = await self.cmd_scan({"timeout": 6})
                        for d in scan["devices"]:
                            if d.get("has_ae20") or "cb08" in (d.get("name") or "").lower():
                                if d["address"] != self.address:
                                    self.emit(event="device_address_changed", old=self.address, new=d["address"])
                                self.address = d["address"]
                                break
                    except Exception:
                        pass
            try:
                await asyncio.sleep(5)
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
        """连接期间每 10s 探活一次；下载进行中或已有活跃通知时跳过。"""
        while self.connected and self.client and not self._quitting and not self._manual_disconnect:
            await asyncio.sleep(10)
            if not (self.connected and self.client):
                break
            if self._dl is not None or self._pinging:
                continue
            now = time.monotonic()
            if now - self._last_rx < 5:  # 最近 5s 内有流量 → 链路活着
                continue
            self._pinging = True
            try:
                await asyncio.wait_for(self._probe_link(3.0), timeout=5)
            except Exception:
                if self.connected:
                    self._spawn(self._handle_disconnect())
            finally:
                self._pinging = False
        self._watchdog_task = None

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
            await self.send(TYPE_KEY, CMD_SET_GAIN, bytes([level]))
            self.gain = level  # 乐观更新
            return {"ok": True, "level": level}
        raise ValueError(f"未知 gain action: {action}")

    async def cmd_delete(self, req: dict) -> dict:
        """删除单个文件（TYPE=2 CMD=8，28B 条目）。ack 可能不返回（旧固件），发完即返回。"""
        name = str(req.get("name", "")).strip()
        if not name:
            raise RuntimeError("缺少文件名")
        time_s = int(req.get("time", 0))
        size = int(req.get("size", 0))
        await self.send(TYPE_FILE, CMD_DELETE_ONE, pack_delete_entry(name, time_s, size))
        await asyncio.sleep(0.8)  # 留时间给设备处理（ack 不一定发）
        return {"ok": True, "name": name}

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
        candidates = []
        for cand in [base + ".wav", base + ".opus", base, name]:
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
