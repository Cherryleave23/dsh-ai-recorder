#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""下载 Qwen3-ASR 权重到本地目录（在 qwen venv 里运行）。

单独成脚本而不是塞进 worker，是因为模型必须在 worker 能启动**之前**就位。

**优先走 modelscope**：它是国内源、直连稳定，而且本机现有全部 FunASR 模型都来自它
（老项目的注释也写明「Qwen/Qwen3-ASR-1.7B（modelscope 下载到本地目录）」）。
hf-mirror 作为兜底——实测它的 API 能通但文件下载链路会抛 LocalEntryNotFoundError。

用法: <qwen-venv>/python qwen_fetch_model.py --repo Qwen/Qwen3-ASR-1.7B --dest <目录>
输出: 每行一个 JSON 进度事件到 stdout；成功时最后一行 {"ok":true,"path":...}
"""
from __future__ import annotations

import argparse
import json
import os
import sys


def emit(**kw) -> None:
    print(json.dumps(kw, ensure_ascii=False), flush=True)


def _already_there(dest: str) -> bool:
    for probe in ("config.json", "model.safetensors.index.json", "model.safetensors"):
        if os.path.exists(os.path.join(dest, probe)):
            return True
    return False


def _via_modelscope(repo: str, dest: str, revision: str) -> tuple:
    try:
        from modelscope import snapshot_download
    except Exception as e:
        return None, f"modelscope 不可用: {e}"
    emit(stage="download", message=f"[modelscope] 拉取 {repo}")
    try:
        path = snapshot_download(repo, revision=revision or None, local_dir=dest)
        return str(path), None
    except Exception as e:
        return None, f"modelscope 失败: {type(e).__name__}: {e}"


def _via_hf(repo: str, dest: str, endpoint: str) -> tuple:
    os.environ["HF_ENDPOINT"] = endpoint
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    try:
        from huggingface_hub import snapshot_download
    except Exception as e:
        return None, f"huggingface_hub 不可用: {e}"
    emit(stage="download", message=f"[hf] 从 {endpoint} 拉取 {repo}")
    try:
        path = snapshot_download(
            repo_id=repo,
            local_dir=dest,
            ignore_patterns=["*.msgpack", "*.h5", "*.ot", "*.onnx", "*.gguf", "flax_model*", "tf_model*"],
            max_workers=4,
        )
        return str(path), None
    except Exception as e:
        return None, f"hf 失败: {type(e).__name__}: {e}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default="Qwen/Qwen3-ASR-1.7B")
    ap.add_argument("--dest", required=True)
    ap.add_argument("--revision", default="")
    ap.add_argument("--endpoint", default=os.environ.get("HF_ENDPOINT") or "https://hf-mirror.com")
    args = ap.parse_args()

    os.makedirs(args.dest, exist_ok=True)

    if _already_there(args.dest):
        emit(stage="detect", message="模型已存在，跳过下载")
        emit(ok=True, path=args.dest, skipped=True)
        return 0

    errors = []

    # ① modelscope（国内直连，首选）
    path, err = _via_modelscope(args.repo, args.dest, args.revision)
    if path and _already_there(args.dest):
        emit(stage="done", message="模型下载完成（modelscope）")
        emit(ok=True, path=path, source="modelscope")
        return 0
    if err:
        errors.append(err)
        emit(stage="fallback", message=err + " → 改用 hf-mirror")

    # ② hf-mirror 兜底
    path, err = _via_hf(args.repo, args.dest, args.endpoint)
    if path and _already_there(args.dest):
        emit(stage="done", message="模型下载完成（hf-mirror）")
        emit(ok=True, path=path, source="hf")
        return 0
    if err:
        errors.append(err)

    emit(ok=False, error="；".join(errors) or "两个源都没能取到模型")
    return 3


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())

