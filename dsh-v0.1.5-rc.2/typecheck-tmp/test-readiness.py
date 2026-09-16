"""readiness 假绿修复的自测：模型目录完整性 + 依赖真实导入体检。"""
import importlib.util
import os
import sys
import tempfile

PATH = r"D:\AI\dsh-coder\dsh-plugins\dsh-AIrecorder\dsh-v0.1.2-alpha.5\scripts\funasr_worker.py"
spec = importlib.util.spec_from_file_location("fw", PATH)
m = importlib.util.module_from_spec(spec)
sys.modules["fw"] = m
try:
    spec.loader.exec_module(m)
except SystemExit:
    pass

ok = True


def check(name, cond, extra=""):
    global ok
    ok = ok and bool(cond)
    print(f"  [{'OK  ' if cond else 'FAIL'}] {name}{('  ' + extra) if extra else ''}")


print("=== 模型目录完整性（以前只看目录存在）===")
empty = tempfile.mkdtemp()
check("空目录 => 不算就绪", m._model_dir_complete(empty) is False)
check("None => 不算就绪", m._model_dir_complete(None) is False)

withcfg = tempfile.mkdtemp()
open(os.path.join(withcfg, "configuration.json"), "w").write("{}")
check("有 configuration.json => 就绪", m._model_dir_complete(withcfg) is True)

withpt = tempfile.mkdtemp()
open(os.path.join(withpt, "model.pt"), "wb").write(b"x")
check("有 model.pt => 就绪", m._model_dir_complete(withpt) is True)

shard = tempfile.mkdtemp()
open(os.path.join(shard, "model-00001-of-00002.safetensors"), "wb").write(b"x")
check("有分片 safetensors => 就绪", m._model_dir_complete(shard) is True)

print("\n=== 依赖真实导入体检（以前只读包版本元数据）===")
h = m._dep_health(force=True)
for k, v in h.items():
    print(f"    {k:12s} ok={v['ok']}  err={str(v['error'])[:70]}")
check("体检覆盖 torch/funasr/modelscope", set(h.keys()) == {"torch", "funasr", "modelscope"})
check("本机三项依赖现在都健康", all(v["ok"] for v in h.values()))

print("\n=== 缓存行为 ===")
h2 = m._dep_health()
check("默认走缓存（同一对象）", h2 is h)
h3 = m._dep_health(force=True)
check("force=True 重测", h3 is not h)

print("\n  结论:", "全部通过" if ok else "有失败项")
sys.exit(0 if ok else 1)
