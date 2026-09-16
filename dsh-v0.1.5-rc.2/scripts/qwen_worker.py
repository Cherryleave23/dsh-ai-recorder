#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Qwen3-ASR 常驻转写 worker —— 模型只加载一次，stdio JSON-lines 批量服务。

## 为什么是「先分离、后识别」

Qwen3-ASR 官方**不提供说话人分离**（GitHub 全库搜 diarization 只有一条被关闭未合并的 PR），
`transcribe()` 默认也只回 `.text`、没有时间戳。所以说话人来自 FunASR 的 cam++：
调用方先用 FunASR 跑出带 `speaker` 的时间段，再把时间段交给本 worker，
本 worker 按段切音频、逐段识别。

这样**每段天然只含一个说话人**，于是：
  - 不需要 Qwen3-ForcedAligner（省一个模型、省掉 ≤5 分钟的单次限制）
  - 不需要词级时间戳对齐，也就没有「段边界与说话人边界不重合」的合并难题

这条路线有论文背书（Interspeech 2026 MLC-SLM Workshop, arXiv:2607.08208）：
3D-Speaker 做分离前端（FSMN-VAD + CAMPPlus + 谱聚类 + 切音频）→ 分组喂 Qwen3-ASR。
FunASR 的 cam++ 就是 CAMPPlus，也就是同一套。

## 协议（与 funasr_worker.py / BLE 守护进程同模式）

  请求 (stdin) : {"id":1,"cmd":"transcribe","file":"<wav>","language":"auto",
                  "segments":[{"start":0,"end":1500,"speaker":0}]}
                 省略 segments → 整段转写
                 {"id":1,"cmd":"status"} / {"id":1,"cmd":"quit"}
  响应 (stdout): {"id":1,"ok":true,"text":"...","segments":[...],"durationMs":N}
                 {"id":1,"ok":false,"error":"..."}
  事件 (stdout): {"event":"ready",...} / {"event":"error",...}

用法: <qwen-venv>/python qwen_worker.py -m <模型目录>
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import traceback
from pathlib import Path
from typing import Any, Optional

# Qwen3-ASR 的 language 参数用自然语言名，不是 ISO 码
LANG_MAP = {
    "zh": "Chinese",
    "zh_cn": "Chinese",
    "cn": "Chinese",
    "en": "English",
    "ja": "Japanese",
    "ko": "Korean",
    "yue": "Cantonese",
    "ru": "Russian",
    "auto": None,  # None = 让模型自己判语种
}

# 过短的片段容易让 LLM 类识别模型产生幻觉/重复（官方 discussion #23），直接丢弃
MIN_SEG_MS = 300
# 相邻同说话人且间隔小于此值则合并，避免把一句话切成碎片
MERGE_GAP_MS = 500


def log(*args: Any) -> None:
    print("[qwen]", *args, file=sys.stderr, flush=True)


def _respond(rid: Any, **kw: Any) -> None:
    if rid is not None:
        kw["id"] = rid
    print(json.dumps(kw, ensure_ascii=False), flush=True)


def _emit_event(**kw: Any) -> None:
    print(json.dumps({"event": "ready", **kw}, ensure_ascii=False), flush=True)


def _merge_segments(segs: list) -> list:
    """合并相邻同说话人的段（间隔 < MERGE_GAP_MS），丢掉过短段。

    切得太碎对 LLM 类识别模型不友好：既有每段的推理开销，短音频还容易触发幻觉。
    """
    out: list = []
    for s in sorted(segs, key=lambda x: x.get("start", 0)):
        start = int(s.get("start") or 0)
        end = int(s.get("end") or 0)
        spk = s.get("speaker")
        if end <= start:
            continue
        if out and out[-1].get("speaker") == spk and start - int(out[-1]["end"]) < MERGE_GAP_MS:
            out[-1]["end"] = end
            continue
        out.append({"start": start, "end": end, "speaker": spk})
    # 合并后再丢过短段（合并可能让原本过短的段变长）
    return [s for s in out if int(s["end"]) - int(s["start"]) >= MIN_SEG_MS]


def _load_audio(path: str):
    """读音频 → (waveform[C,N] 的 torch 张量, sample_rate)。

    新版 torchaudio 的 `load()` 走 TorchCodec，而 torchcodec 是独立包、不一定随
    torchaudio 装上（实测报 `TorchCodec is required for load_with_torchcodec`）。
    所以这里按 torchaudio → soundfile → 直接让 qwen 自己读文件 三级降级，
    别让一个解码后端把整条识别链路卡死。
    """
    try:
        import torchaudio

        return torchaudio.load(str(path))
    except Exception as e:
        log("torchaudio 解码失败，改用 soundfile：", str(e))
    try:
        import soundfile as sf
        import torch

        data, sr = sf.read(str(path), dtype="float32", always_2d=True)
        # soundfile 给的是 [N, C]，转成 torchaudio 的 [C, N]
        return torch.from_numpy(data.T).contiguous(), int(sr)
    except Exception as e:
        log("soundfile 解码也失败：", str(e))
    return None, None


def _save_audio(path: str, wave, sr: int) -> None:
    try:
        import torchaudio

        torchaudio.save(path, wave, sr)
        return
    except Exception as e:
        log("torchaudio 保存失败，改用 soundfile：", str(e))
    import soundfile as sf

    sf.write(path, wave.detach().cpu().numpy().T, sr)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("-m", "--model", required=True)
    ap.add_argument("--max-new-tokens", type=int, default=1024)
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stdin.reconfigure(encoding="utf-8", errors="replace")

    try:
        import torch
        from qwen_asr import Qwen3ASRModel
    except Exception as e:
        # 保持存活：让宿主能通过 ready.error 如实报告「依赖缺失」而不是反复崩溃重启
        _emit_event(error="qwen-asr 未安装: " + str(e))
        for _ in sys.stdin:
            pass
        return 3

    model_path = Path(args.model)
    if not model_path.exists():
        _emit_event(error=f"模型目录不存在: {args.model}")
        for _ in sys.stdin:
            pass
        return 4

    try:
        use_cuda = torch.cuda.is_available()
        model = Qwen3ASRModel.from_pretrained(
            str(model_path),
            dtype=torch.bfloat16 if use_cuda else torch.float32,
            device_map="cuda:0" if use_cuda else "cpu",
            max_inference_batch_size=4,
            max_new_tokens=args.max_new_tokens,
        )
    except Exception as e:
        _emit_event(error="模型加载失败: " + str(e))
        for _ in sys.stdin:
            pass
        return 5

    _emit_event(device="cuda" if use_cuda else "cpu", model=str(model_path), ok=True)

    try:
        import torchaudio
    except Exception:
        torchaudio = None  # type: ignore

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception:
            continue
        rid = req.get("id")
        cmd = req.get("cmd")

        if cmd == "quit":
            _respond(rid, bye=True)
            return 0

        if cmd == "status":
            _respond(rid, ok=True, model=str(model_path), device="cuda" if use_cuda else "cpu")
            continue

        if cmd == "transcribe":
            try:
                f = req.get("file")
                if not f or not Path(f).exists():
                    raise RuntimeError("音频文件不存在: " + str(f))
                lang = LANG_MAP.get(str(req.get("language") or "auto").lower().replace("-", "_"))
                raw_segs = req.get("segments") or []
                segs = _merge_segments(raw_segs) if raw_segs else []

                with tempfile.TemporaryDirectory(prefix="qwen-seg-") as tmpd:
                    if segs:
                        wave, sr = _load_audio(f)
                        if wave is None or not sr:
                            raise RuntimeError(
                                "需要 torchcodec 或 soundfile 才能按说话人切分音频"
                                "（venv 里执行 pip install torchcodec soundfile 即可）"
                            )
                        total = wave.shape[1]
                        paths = []
                        kept = []
                        for i, s in enumerate(segs):
                            a = max(0, int(sr * int(s["start"]) / 1000))
                            b = min(total, int(sr * int(s["end"]) / 1000))
                            if b <= a:
                                continue
                            p = os.path.join(tmpd, f"seg{i:04d}.wav")
                            _save_audio(p, wave[:, a:b], sr)
                            paths.append(p)
                            kept.append(s)
                        if not paths:
                            raise RuntimeError("按说话人切分后没有可用片段")
                        texts = _transcribe_many(model, paths, lang)
                        out_segs = []
                        for s, t in zip(kept, texts):
                            out_segs.append({
                                "start": int(s["start"]), "end": int(s["end"]),
                                "speaker": s.get("speaker"), "text": t,
                            })
                        text = "\n".join(x["text"] for x in out_segs if x["text"])
                        duration_ms = int(round(total / sr * 1000)) if sr else 0
                    else:
                        texts = _transcribe_many(model, [str(f)], lang)
                        text = "\n".join(t for t in texts if t)
                        out_segs = []
                        duration_ms = 0

                _respond(rid, ok=True, text=text, segments=out_segs, durationMs=duration_ms)
            except Exception as e:
                log(traceback.format_exc())
                _respond(rid, ok=False, error=f"{type(e).__name__}: {e}")
            continue

        _respond(rid, ok=False, error=f"未知命令: {cmd}")
    return 0


def _transcribe_many(model: Any, paths: list, lang: Optional[str]) -> list:
    """批量转写；批量不被支持时退回逐个（不同版本 qwen-asr 的入参形态不完全一致）。"""
    if not paths:
        return []
    try:
        results = model.transcribe(audio=list(paths), language=lang)
        if isinstance(results, list) and len(results) == len(paths):
            return [(getattr(r, "text", "") or "").strip() for r in results]
    except Exception as e:
        log("批量转写失败，退回逐个：", str(e))
    out = []
    for p in paths:
        try:
            r = model.transcribe(audio=p, language=lang)
            if isinstance(r, list):
                out.append("\n".join((getattr(x, "text", "") or "").strip() for x in r).strip())
            else:
                out.append((getattr(r, "text", "") or "").strip())
        except Exception as e:
            log("片段转写失败：", p, str(e))
            out.append("")
    return out


if __name__ == "__main__":
    sys.exit(main())
