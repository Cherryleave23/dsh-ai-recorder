#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Qwen3-ASR 常驻转写 worker —— 模型只加载一次，stdio JSON-lines 批量服务。

协议（与 BLE 守护进程同模式）:
  请求 (stdin) : {"id":1,"cmd":"transcribe","file":"<路径>","language":"zh"}
                 {"id":1,"cmd":"status"} / {"id":1,"cmd":"quit"}
  响应 (stdout): {"id":1,"ok":true,"text":"..."} / {"id":1,"ok":false,"error":"..."}
  事件 (stdout): {"event":"ready",...} / {"event":"error",...}

用法: <qwen-venv> python qwen_worker.py -m <模型目录>
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

LANG_MAP = {
    "zh": "Chinese",
    "zh_cn": "Chinese",
    "cn": "Chinese",
    "en": "English",
    "ja": "Japanese",
    "ko": "Korean",
    "ru": "Russian",
    "auto": None,
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("-m", "--model", required=True)
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stdin.reconfigure(encoding="utf-8", errors="replace")

    try:
        import torch
        from qwen_asr import Qwen3ASRModel
    except Exception as e:
        print(json.dumps({"event": "ready", "error": "qwen-asr 未安装: " + str(e)}, ensure_ascii=False), flush=True)
        for _ in sys.stdin:  # 保持存活，让宿主探测到错误
            pass
        return 3

    try:
        use_cuda = torch.cuda.is_available()
        model = Qwen3ASRModel.from_pretrained(
            args.model,
            dtype=torch.bfloat16 if use_cuda else torch.float32,
            device_map="cuda:0" if use_cuda else "cpu",
            max_inference_batch_size=4,
            max_new_tokens=1024,
        )
    except Exception as e:
        print(json.dumps({"event": "ready", "error": "模型加载失败: " + str(e)}, ensure_ascii=False), flush=True)
        for _ in sys.stdin:
            pass
        return 4
    print(json.dumps({"event": "ready", "device": "cuda" if use_cuda else "cpu", "model": args.model}, ensure_ascii=False), flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception:
            continue
        rid = req.get("id")

        def respond(**kw):
            if rid is not None:
                kw["id"] = rid
            print(json.dumps(kw, ensure_ascii=False), flush=True)

        cmd = req.get("cmd")
        if cmd == "quit":
            respond(bye=True)
            return 0
        if cmd == "status":
            respond(ok=True, model=args.model, device="cuda" if use_cuda else "cpu")
            continue
        if cmd == "transcribe":
            f = req.get("file")
            lang = req.get("language")
            try:
                if not f or not Path(f).exists():
                    raise RuntimeError("音频文件不存在: " + str(f))
                language = LANG_MAP.get((lang or "auto").lower().replace("-", "_"))
                results = model.transcribe(audio=f, language=language)
                texts = [r.text.strip() for r in results if r.text and r.text.strip()]
                respond(ok=True, text="\n".join(texts))
            except Exception as e:
                respond(ok=False, error=f"{type(e).__name__}: {e}")
            continue
        respond(ok=False, error=f"未知命令: {cmd}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
