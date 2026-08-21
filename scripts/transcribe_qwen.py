#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Qwen3-ASR 转写脚本（插件调用契约与 faster-whisper 的 transcribe.py 一致）。

用法: python transcribe_qwen.py -m <模型目录> -f <音频文件> [-l zh|en|ja|ko|ru] [-o 输出.txt]
依赖: Python 3.12 venv + `pip install -U qwen-asr`（自动拉 torch/transformers/torchaudio）
模型: Qwen/Qwen3-ASR-1.7B（modelscope 下载到本地目录）
输出: -o 时写文本文件并打印 OK；否则直接打印文本。
"""
from __future__ import annotations

import argparse
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
    ap.add_argument("-f", "--file", required=True)
    ap.add_argument("-l", "--language", default=None)
    ap.add_argument("-o", "--output", default=None)
    args = ap.parse_args()

    if not Path(args.file).exists():
        print("ERR: audio file missing: " + args.file, file=sys.stderr)
        return 2
    try:
        import torch
        from qwen_asr import Qwen3ASRModel
    except Exception as e:
        print("ERR: qwen-asr 未安装（venv: pip install -U qwen-asr）: " + str(e), file=sys.stderr)
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
        lang = LANG_MAP.get((args.language or "auto").lower().replace("-", "_"))
        results = model.transcribe(
            audio=args.file,
            language=lang,  # None = 自动识别语言
        )
        texts = [r.text.strip() for r in results if r.text and r.text.strip()]
        out = "\n".join(texts)
        if args.output:
            Path(args.output).write_text(out, "utf-8")
            print(f"OK: {len(texts)} segments -> {args.output}")
        else:
            print(out)
        return 0
    except Exception as e:
        print("ERR: transcription failed: " + str(e), file=sys.stderr)
        return 4


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
