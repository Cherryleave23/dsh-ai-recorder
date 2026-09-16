"""静态门禁：Python 脚本不得有未定义名字。

为什么要有这个：我曾在 ble_central.py 里写了 `log(...)`，而那个文件里日志是
`self.log` 方法、并没有模块级 `log()`。于是 watchdog 一探到链路失败就抛
`NameError: name 'log' is not defined` **把自己崩掉**，断链永远处理不了 ——
表现就是「卡都离范围了插件还一直显示已连接」。语法检查查不出这类错误，
pyflakes 可以。
"""
import ast
import subprocess
import sys
from pathlib import Path

SRC = Path(r"D:\AI\dsh-coder\dsh-plugins\dsh-AIrecorder\dsh-v0.1.2-alpha.5")
SCRIPTS = ["ble_central.py", "funasr_worker.py", "qwen_worker.py", "qwen_fetch_model.py"]

ok = True

print("=== pyflakes：未定义名字 / 重复定义 ===")
try:
    r = subprocess.run(
        [sys.executable, "-m", "pyflakes"] + [str(SRC / "scripts" / s) for s in SCRIPTS],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    bad = [ln for ln in (r.stdout or "").splitlines() if "undefined name" in ln or "redefinition" in ln]
    for ln in bad:
        print("  FAIL", ln)
    ok = ok and not bad
    if not bad:
        print(f"  全部 {len(SCRIPTS)} 个脚本通过（无未定义名字）")
except FileNotFoundError:
    print("  SKIP pyflakes 未安装")

print("\n=== 语法检查 ===")
for s in SCRIPTS:
    p = SRC / "scripts" / s
    try:
        ast.parse(p.read_text(encoding="utf-8"))
        print(f"  OK   {s}")
    except SyntaxError as e:
        print(f"  FAIL {s}: {e}")
        ok = False

print("\n=== watchdog 失败分支：探活失败必须真的触发断链处理 ===")
import asyncio
import importlib.util
import time

spec = importlib.util.spec_from_file_location("bc", SRC / "scripts" / "ble_central.py")
bc = importlib.util.module_from_spec(spec)
sys.modules["bc"] = bc
try:
    spec.loader.exec_module(bc)
except SystemExit:
    pass

if getattr(bc, "bleak", None) is None:
    print("  SKIP bleak 未安装")
else:
    class FakeClient:
        is_connected = True

    d = bc.BleCentralDaemon.__new__(bc.BleCentralDaemon)
    d.connected = True
    d.client = FakeClient()
    d._quitting = False
    d._manual_disconnect = False
    d._pinging = False
    d._dl = None
    d._last_rx = time.monotonic() - 100
    d.logs = []
    d.log = lambda *a, **k: d.logs.append(" ".join(str(x) for x in a))
    d.emits = []
    d.emit = lambda **kw: d.emits.append(kw)

    async def boom(timeout=3.0):
        raise TimeoutError("链路无应答（信号丢失/设备离线）")

    d._probe_link = boom
    handled = []
    d._handle_disconnect = lambda: handled.append(1) or asyncio.sleep(0)
    d._spawn = lambda coro: (handled.append(1), coro.close())

    async def run():
        t = asyncio.create_task(d._watchdog_loop())
        await asyncio.sleep(9.5)   # 越过一个 8s 周期
        t.cancel()
        try:
            await t
        except asyncio.CancelledError:
            pass

    asyncio.run(run())
    crashed = [x for x in d.logs if "NameError" in x]
    print(f"  探活失败日志: {[x for x in d.logs if '探活' in x]}")
    print(f"  触发断链处理次数: {len(handled)}")
    good = len(handled) >= 1 and not crashed
    print(f"  {'OK  ' if good else 'FAIL'} watchdog 探活失败 → 触发断链")
    ok = ok and good

print("\n结论:", "全部通过" if ok else "有失败项")
sys.exit(0 if ok else 1)
