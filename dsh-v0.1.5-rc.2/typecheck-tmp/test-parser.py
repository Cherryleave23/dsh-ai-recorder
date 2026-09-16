"""FrameParser 加固自测：假帧头卡死 / 坏帧重同步 / 裸 ACK / reset。"""
import importlib.util
import struct
import sys

PATH = r"D:\AI\dsh-coder\dsh-plugins\dsh-AIrecorder\dsh-v0.1.2-alpha.5\scripts\ble_central.py"
spec = importlib.util.spec_from_file_location("bc", PATH)
m = importlib.util.module_from_spec(spec)
sys.modules["bc"] = m
spec.loader.exec_module(m)

ok_all = True


def check(name, cond, extra=""):
    global ok_all
    ok_all = ok_all and bool(cond)
    print(f"  [{'OK  ' if cond else 'FAIL'}] {name}{('  ' + extra) if extra else ''}")


# ── 1) 假帧头：MAGIC + 垃圾大 LEN，不能卡死，后续真帧仍要解出 ──
p = m.FrameParser()
p.feed(bytes([m.MAGIC, 1, 0x02, 0x03]) + struct.pack("<H", 0xFFFF))
out = p.feed(m.make_frame(9, 0, 3))  # 真帧与垃圾混在同一缓冲里
check("假帧头后仍能解析出真帧", len(out) == 1 and out[0]["cmd"] == 3, f"frames={len(out)}")
check("假帧头被记为坏帧", p.dropped_crc >= 1 and len(p.bad_frames) >= 1, f"dropped={p.dropped_crc}")

# ── 2) 坏帧只丢 1 字节：紧跟其后的真帧要被解出 ──
p2 = m.FrameParser()
good = m.make_frame(7, 0, 4, bytes([55]))
bad = bytearray(good)
bad[7] ^= 0xFF  # 破坏 payload → CRC 不过
out2 = p2.feed(bytes(bad) + good)
got = [f for f in out2 if f["cmd"] == 4 and f["params"] == bytes([55])]
check("坏帧后紧跟的真帧被解出", len(got) == 1, f"frames={len(out2)}")
check("坏帧被计数", p2.dropped_crc == 1, f"dropped={p2.dropped_crc}")

# ── 3) 裸 ACK（data 只 1 字节）不应被当成按键码 ──
p3 = m.FrameParser()
# 手工造一个 data 长度为 1 的帧（只有 type，没有 cmd）
data = bytes([m.TYPE_KEY])
crc = m.Crc16Xmodem.compute(struct.pack("<H", len(data)) + data)
raw = bytes([m.MAGIC, 5]) + struct.pack("<H", crc) + struct.pack("<H", len(data)) + data
out3 = p3.feed(raw)
check("裸 ACK 解析出 1 帧", len(out3) == 1, f"frames={len(out3)}")
check("裸 ACK 的 cmd 为 None", out3 and out3[0]["cmd"] is None, f"cmd={out3[0]['cmd'] if out3 else 'N/A'}")

# ── 4) 长度 0 的帧不崩 ──
p4 = m.FrameParser()
d0 = b""
crc0 = m.Crc16Xmodem.compute(struct.pack("<H", 0) + d0)
raw0 = bytes([m.MAGIC, 6]) + struct.pack("<H", crc0) + struct.pack("<H", 0) + d0
try:
    p4.feed(raw0)
    check("长度 0 的帧不抛异常", True)
except Exception as e:
    check("长度 0 的帧不抛异常", False, repr(e))

# ── 5) reset 清缓冲与计数 ──
p4.feed(b"\x5a\x01\x02\x03\xff")
p4.reset()
check("reset 后缓冲为空", len(p4._buf) == 0)
check("reset 后坏帧记录清空", p4.bad_frames == [])

# ── 6) 正常多帧连续解析 ──
p5 = m.FrameParser()
blob = b"".join(m.make_frame(i, 0, 3, bytes([i])) for i in range(1, 6))
out5 = p5.feed(blob)
check("连续 5 帧全部解出", len(out5) == 5, f"frames={len(out5)}")

print("\n  结论:", "全部通过" if ok_all else "有失败项")
sys.exit(0 if ok_all else 1)
