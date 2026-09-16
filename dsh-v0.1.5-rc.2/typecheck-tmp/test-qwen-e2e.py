"""Qwen3-ASR worker 端到端验证：真实音频 + 按说话人切段。"""
import glob
import json
import os
import subprocess
import sys
import time

VENV = os.path.expanduser(r"~\.dsh\recorder-backend\qwen-venv\Scripts\python.exe")
MODEL = os.path.expanduser(r"~\.dsh\recorder-backend\qwen\Qwen3-ASR-1.7B")
HOT = sorted(glob.glob(os.path.expanduser(r"~\.dsh\profiles\0.1.5-rc.2\node_modules\dsh-ai-recorder-hot*")))
WORKER = os.path.join(HOT[-1], "scripts", "qwen_worker.py")

root = os.path.expanduser("~/.dsh/recorder-backend/sessions")
wavs = []
for d in os.listdir(root):
    wavs += glob.glob(os.path.join(root, d, "*.ogg"))
wavs = sorted(wavs, key=os.path.getsize)
# 挑一条有语音的中等长度文件
target = next((w for w in wavs if 20000 < os.path.getsize(w) < 90000), wavs[len(wavs) // 2])

print("worker:", WORKER)
print("音频  :", os.path.basename(target), os.path.getsize(target), "B")

proc = subprocess.Popen(
    [VENV, "-u", WORKER, "-m", MODEL],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    text=True, encoding="utf-8", errors="replace", bufsize=1,
)

t0 = time.monotonic()
ready = None
while time.monotonic() - t0 < 600:
    line = proc.stdout.readline()
    if not line:
        break
    obj = json.loads(line)
    if obj.get("event") == "ready":
        ready = obj
        break
print(f"就绪  : {time.monotonic()-t0:.1f}s  {ready}")

if not ready or ready.get("error"):
    print("启动失败，stderr 尾部：")
    print(proc.stderr.read()[-1500:])
    sys.exit(1)


def call(payload: dict) -> dict:
    proc.stdin.write(json.dumps(payload, ensure_ascii=False) + "\n")
    proc.stdin.flush()
    deadline = time.monotonic() + 900
    while time.monotonic() < deadline:
        line = proc.stdout.readline()
        if not line:
            raise RuntimeError("worker 退出")
        obj = json.loads(line)
        if obj.get("id") == payload["id"]:
            return obj
    raise RuntimeError("超时")


# ① 整段识别
t0 = time.monotonic()
r = call({"id": 1, "cmd": "transcribe", "file": target, "language": "auto"})
dt = time.monotonic() - t0
print(f"\n① 整段识别  {dt:.1f}s  device={r.get('device')}")
print("   文本:", repr(str(r.get("text"))[:120]))

# ② 按说话人切段识别
segs = [
    {"start": 0, "end": 8000, "speaker": 0},
    {"start": 8000, "end": 16000, "speaker": 1},
    {"start": 16000, "end": 24000, "speaker": 0},
]
t0 = time.monotonic()
r2 = call({"id": 2, "cmd": "transcribe", "file": target, "language": "auto", "segments": segs})
dt2 = time.monotonic() - t0
print(f"\n② 按说话人切段  {dt2:.1f}s  返回段数={len(r2.get('segments') or [])}  时长={r2.get('durationMs')}ms")
for s in (r2.get("segments") or []):
    print(f"   [{s['start']:>6}-{s['end']:>6}ms] 说话人{s.get('speaker')}: {s.get('text')!r}")

proc.stdin.write(json.dumps({"id": 3, "cmd": "quit"}) + "\n")
proc.stdin.flush()
try:
    proc.wait(timeout=10)
except Exception:
    proc.kill()
print("\n完成")
