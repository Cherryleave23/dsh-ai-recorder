#!/usr/bin/env python3
"""dsh-ai-recorder 的 Python 侧运行时（stdio JSON-lines 常驻进程）。

它同时承载两层的重活：

  L2 预处理层
    decode       任意容器音频 → 统一格式（16k/mono/16bit PCM WAV）
    opus_probe   设备 .opus 下载件的前导污染探测（见下）

  L3 识别层
    offline      离线模型：VAD + ASR + 标点 + 说话人 → 完整转写结果
    stream_open / stream_feed / stream_close
                 流式模型：增量 chunk 解码 → 实时逐字输出

协议（与宿主 src/py-worker.ts 一致）：
  请求  {"id":N,"cmd":"...", ...}
  响应  {"id":N,"ok":true|false, ...}
  事件  {"event":"..."}          —— 无 id
启动完成后立即推一条 {"event":"ready", ...}，载荷即就绪信息（不含 id）。

设计约束：
  - **funasr 必须懒加载**：未安装时本进程仍要能启动并如实上报就绪状态，
    这样面板才能显示「缺什么」并给出安装入口，而不是插件加载失败。
  - 解码不依赖 funasr：优先 soundfile / torchaudio / av / pydub，逐级回退。

关于「前导污染」（真机实测，2026-08）：
  设备 `.opus` 文件下载件的前 ~4160 字节是非确定性数据（同一文件多次下载字节不同，
  之后的内容字节完全一致；前段呈 PCM 样貌，后段是熵编码样貌）。整包按 40B/包封装后
  交给解码器会从第一个包就失败，只能解出 0.05~0.11s。跳过该前导后，5/5 样本解出
  与「包数 × 20ms」精确吻合的长度。opus_probe 负责扫出最小可解码偏移。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import struct
import subprocess
import sys
import tempfile
import traceback
from pathlib import Path
from typing import Any, Optional

PACKET_SIZE = 40          # 设备裸 Opus：固定 40B/包
PACKET_MS = 20            # 每包 20ms
GRANULE_PER_PACKET = 960  # Ogg granule 走 48kHz 时间线
OGG_SERIAL = 0x51533638   # 'QS68'
PAGE_PACKETS = 50

# ── 模型清单 ──────────────────────────────────────────────────
# 一律用**显式 ModelScope repo id**，不用 funasr 的短别名。
# 原因：别名表随 funasr 版本漂移（如 'paraformer-zh' 在 1.4.15 指向 seaco_paraformer，
# 而不是 paraformer-large），用别名会出现「下载的模型」与「实际加载的模型」不是同一个。
PARAFORMER_ZH = 'iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch'
PARAFORMER_ZH_STREAM = 'iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-online'
FSMN_VAD = 'iic/speech_fsmn_vad_zh-cn-16k-common-pytorch'
CT_PUNC = 'iic/punc_ct-transformer_cn-en-common-vocab471067-large'
CAMPP = 'iic/speech_campplus_sv_zh-cn_16k-common'
SENSEVOICE = 'iic/SenseVoiceSmall'

# 与 funasr 1.4.15 的 name_maps_ms 对齐，供「别名 → repo id」换算（不 import funasr，
# 这样 funasr 没装时 readiness 也能工作）。
MODEL_REPOS = {
    'paraformer': 'iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch',
    'paraformer-zh': 'iic/speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch',
    'paraformer-zh-streaming': PARAFORMER_ZH_STREAM,
    'fsmn-vad': FSMN_VAD,
    'ct-punc': CT_PUNC,
    'cam++': CAMPP,
    'sensevoice': SENSEVOICE,
}

OFFLINE_MODELS = {
    'paraformer-zh': {
        'label': 'Paraformer-large（中文高精度）',
        'model': PARAFORMER_ZH,
        'needs_punc': True,
        'needs_spk': True,
    },
    'sensevoice': {
        'label': 'SenseVoiceSmall（多语种·快速）',
        'model': SENSEVOICE,
        'needs_punc': False,   # SenseVoice 自带标点与情感
        'needs_spk': True,
    },
}
STREAM_MODEL = PARAFORMER_ZH_STREAM

log_lock = None


def log(*args: Any) -> None:
    print('[worker]', *args, file=sys.stderr, flush=True)


def emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + '\n')
    sys.stdout.flush()


# ══════════════════════════════════════════════════════════════════
# Ogg/Opus 封装（与宿主 src/layers/02-preprocess/opus.ts 同算法）
# ══════════════════════════════════════════════════════════════════

_CRC_TABLE: Optional[list] = None


def _crc_table() -> list:
    global _CRC_TABLE
    if _CRC_TABLE is None:
        table = []
        for value in range(256):
            reg = value << 24
            for _ in range(8):
                reg = ((reg << 1) ^ 0x04C11DB7) & 0xFFFFFFFF if reg & 0x80000000 else (reg << 1) & 0xFFFFFFFF
            table.append(reg)
        _CRC_TABLE = table
    return _CRC_TABLE


def ogg_crc(data: bytes) -> int:
    table = _crc_table()
    crc = 0
    for byte in data:
        crc = ((crc << 8) & 0xFFFFFFFF) ^ table[((crc >> 24) & 0xFF) ^ byte]
    return crc


def ogg_make_page(payloads: list, granule: int, serial: int, seq: int, flags: int) -> bytes:
    body = b''.join(payloads)
    laces = []
    for payload in payloads:
        remaining = len(payload)
        while remaining >= 255:
            laces.append(255)
            remaining -= 255
        laces.append(remaining)
    header = bytearray()
    header += b'OggS'
    header += bytes([0, flags])
    header += struct.pack('<Q', granule)
    header += struct.pack('<I', serial)
    header += struct.pack('<I', seq)
    header += struct.pack('<I', 0)
    header += bytes([len(laces)])
    header += bytes(laces)
    page = header + body
    page[22:26] = struct.pack('<I', ogg_crc(bytes(page)))
    return bytes(page)


def wrap_raw_opus(raw: bytes, sample_rate: int = 16000) -> tuple:
    """裸 40B 包流 → Ogg/Opus。返回 (ogg_bytes, packet_count, trailing_bytes)。"""
    usable = len(raw) - (len(raw) % PACKET_SIZE)
    trailing = len(raw) - usable
    if usable == 0:
        raise ValueError(f'裸 Opus 包流不足一整包（{len(raw)}B）')
    packets = [raw[i:i + PACKET_SIZE] for i in range(0, usable, PACKET_SIZE)]
    pages = []
    seq = 0
    head = (b'OpusHead' + bytes([1, 1]) + struct.pack('<H', 312)
            + struct.pack('<I', sample_rate) + struct.pack('<h', 0) + bytes([0]))
    tags = b'OpusTags' + struct.pack('<I', len(b'QS668')) + b'QS668' + struct.pack('<I', 0)
    pages.append(ogg_make_page([head], 0, OGG_SERIAL, seq, 0x02))
    seq += 1
    pages.append(ogg_make_page([tags], 0, OGG_SERIAL, seq, 0x00))
    seq += 1
    granule = 0
    for start in range(0, len(packets), PAGE_PACKETS):
        group = packets[start:start + PAGE_PACKETS]
        granule += GRANULE_PER_PACKET * len(group)
        flags = 0x04 if start + PAGE_PACKETS >= len(packets) else 0x00
        pages.append(ogg_make_page(group, granule, OGG_SERIAL, seq, flags))
        seq += 1
    return b''.join(pages), len(packets), trailing


# ══════════════════════════════════════════════════════════════════
# 音频解码（不依赖 funasr）
# ══════════════════════════════════════════════════════════════════

def _decode_with_soundfile(path: str):
    import soundfile as sf  # type: ignore
    data, sr = sf.read(path, dtype='float32', always_2d=True)
    return data, sr


def _decode_with_torchaudio(path: str):
    import torchaudio  # type: ignore
    wav, sr = torchaudio.load(path)
    return wav.numpy().T, sr


def _decode_with_av(path: str):
    import av  # type: ignore
    import numpy as np
    with av.open(path) as container:
        stream = container.streams.audio[0]
        frames = []
        for frame in container.decode(stream):
            frames.append(frame.to_ndarray().reshape(-1))
        if not frames:
            raise RuntimeError('av 未解出任何音频帧')
        return np.concatenate(frames).reshape(-1, 1), stream.rate


def _decode_with_pydub(path: str):
    import numpy as np
    from pydub import AudioSegment  # type: ignore
    seg = AudioSegment.from_file(path)
    samples = np.array(seg.get_array_of_samples(), dtype='float32')
    samples = samples.reshape(-1, seg.channels) / float(1 << (8 * seg.sample_width - 1))
    return samples, seg.frame_rate


DECODERS = (
    ('soundfile', _decode_with_soundfile),
    ('torchaudio', _decode_with_torchaudio),
    ('av', _decode_with_av),
    ('pydub', _decode_with_pydub),
)


def decode_audio_any(path: str):
    """任意容器音频 → (float32 ndarray [n, ch], sample_rate)。逐级回退。"""
    errors = []
    for name, fn in DECODERS:
        try:
            return fn(path)
        except Exception as exc:  # noqa: BLE001
            errors.append(f'{name}: {type(exc).__name__}: {exc}')
    raise RuntimeError('所有解码器均失败 → ' + ' | '.join(errors))


def resample_linear(data, src_rate: int, dst_rate: int):
    import numpy as np
    if src_rate == dst_rate:
        return data
    n_src = data.shape[0]
    n_dst = int(round(n_src * dst_rate / src_rate))
    if n_dst <= 0:
        return data
    idx = np.linspace(0, n_src - 1, n_dst)
    lo = np.floor(idx).astype('int64')
    hi = np.minimum(lo + 1, n_src - 1)
    frac = (idx - lo).reshape(-1, 1)
    return data[lo] * (1 - frac) + data[hi] * frac


def write_wav(path: str, data, sample_rate: int, channels: int, bits: int = 16) -> int:
    """统一格式音频落盘（默认 16k/mono/16bit）。返回字节数。"""
    import numpy as np
    import wave
    if data.ndim == 2:
        if data.shape[1] > 1:
            data = data.mean(axis=1, keepdims=True)
        if channels == 1 and data.shape[1] != 1:
            data = data[:, :1]
    else:
        data = data.reshape(-1, 1)
    clipped = np.clip(data, -1.0, 1.0)
    pcm = (clipped * 32767.0).astype('<i2') if bits == 16 else (clipped * 127.0).astype('i1')
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with wave.open(path, 'wb') as w:
        w.setnchannels(pcm.shape[1])
        w.setsampwidth(2 if bits == 16 else 1)
        w.setframerate(sample_rate)
        w.writeframes(pcm.tobytes())
    return os.path.getsize(path)


def probe_duration_ms(path: str) -> float:
    """只求时长，尽量少解。"""
    try:
        data, sr = decode_audio_any(path)
        return len(data) / float(sr) * 1000.0
    except Exception:  # noqa: BLE001
        return 0.0


# ══════════════════════════════════════════════════════════════════
# 就绪探测 / 安装
# ══════════════════════════════════════════════════════════════════

MODEL_DIR_DEFAULT = os.path.join(os.path.expanduser('~'), '.dsh', 'recorder-backend', 'funasr')


def _pkg_version(name: str) -> Optional[str]:
    try:
        from importlib.metadata import version
        return version(name)
    except Exception:  # noqa: BLE001
        return None


_TORCH_PROBE_CODE = (
    'import json\n'
    'd = {"installed": False, "version": None, "cuda": False, "device": None}\n'
    'try:\n'
    '    import torch\n'
    '    d["installed"] = True\n'
    '    d["version"] = torch.__version__\n'
    '    try:\n'
    '        d["cuda"] = bool(torch.cuda.is_available())\n'
    '        d["device"] = torch.cuda.get_device_name(0) if d["cuda"] else None\n'
    '    except Exception:\n'
    '        pass\n'
    'except Exception as e:\n'
    '    d["error"] = f"{type(e).__name__}: {e}"\n'
    'print(json.dumps(d))\n'
)


def _torch_probe_subprocess() -> dict:
    """在**全新进程**里探测 torch。

    为什么不能在 worker 进程内探测：pip 改动的是磁盘上的 torch，而本进程早已 import 过它，
    内存里的模块是陈旧的。实测踩过这个坑——cu128 强装失败、磁盘上的 torch 已半损坏，
    worker 却仍报告「torch 2.14.0+cpu 可用」，于是自检放行，坏环境被当成好的。
    """
    try:
        env = dict(os.environ)
        env['PYTHONIOENCODING'] = 'utf-8'
        proc = subprocess.run([sys.executable, '-c', _TORCH_PROBE_CODE],
                              capture_output=True, text=True, env=env,
                              encoding='utf-8', errors='replace', timeout=180)
        line = (proc.stdout or '').strip().splitlines()
        if line:
            return json.loads(line[-1])
    except Exception as exc:  # noqa: BLE001
        log('torch 子进程探测失败:', exc)
    return {'installed': False, 'version': None, 'cuda': False, 'device': None}


def _torch_state(fresh: bool = False) -> dict:
    """fresh=True 时走子进程探测（pip 动过 torch 之后必须用这个）。"""
    if fresh:
        return _torch_probe_subprocess()
    try:
        import torch  # type: ignore
    except Exception:  # noqa: BLE001
        return {'installed': False, 'version': None, 'cuda': False, 'device': None}
    cuda = False
    device = None
    try:
        cuda = bool(torch.cuda.is_available())
        if cuda:
            device = torch.cuda.get_device_name(0)
    except Exception:  # noqa: BLE001
        cuda = False
    return {'installed': True, 'version': getattr(torch, '__version__', None), 'cuda': cuda, 'device': device}


def _model_dir_has(path: str) -> bool:
    if not path or not os.path.isdir(path):
        return False
    # modelscope 会把模型放在 <dir>/<owner>/<name>/ 或直接 <dir>/
    for root, _dirs, files in os.walk(path):
        if any(f.endswith('.pt') or f.endswith('.bin') or f.endswith('.pb') for f in files):
            return True
        if len(root) - len(path) > 200:
            break
    return False


# ── 本地模型解析（离线优先）───────────────────────────────────────
#
# funasr 的 model='paraformer-zh' 是**别名**，要访问模型仓库拉下 config.yaml 才能
# 解析成模型类。网络一旦不通（例如宿主进程被注入了指向死端口的 HTTP_PROXY），
# 下载会**静默失败**，funasr 只抛一句极具误导性的 "model is not registered"。
#
# 关键机制在 funasr/download/download_model_from_hub.py：
#     if not os.path.exists(model_or_path) and "model_path" not in kwargs:
#         ... 联网下载 ...
# 也就是说，**只要把 model 直接指向本地快照目录**，联网分支根本不会进入，
# 随后它读本地 config.yaml 就得到模型类名 —— 识别完全离线可用。


def _modelscope_caches(model_dir: str = '') -> list:
    caches = []
    env = os.environ.get('MODELSCOPE_CACHE')
    if env:
        caches.append(env)
    caches.append(os.path.join(os.path.expanduser('~'), '.cache', 'modelscope'))
    if model_dir:
        caches.append(model_dir)
    return caches


def _local_model_dir(repo: str, model_dir: str = ''):
    """按 modelscope 缓存布局推算本地快照目录，命中（含 config）则返回路径。"""
    flat = repo.replace('/', '--')
    for cache in _modelscope_caches(model_dir):
        for rel in (os.path.join('models', flat, 'snapshots', 'master'),
                    os.path.join(flat, 'snapshots', 'master')):
            candidate = os.path.join(cache, rel)
            if (os.path.exists(os.path.join(candidate, 'config.yaml'))
                    or os.path.exists(os.path.join(candidate, 'configuration.json'))):
                return candidate
    return None


def _repo_of(alias_or_repo: str) -> str:
    """别名 → repo id；本来就是 repo id 或路径则原样返回。"""
    if alias_or_repo in MODEL_REPOS:
        return MODEL_REPOS[alias_or_repo]
    return alias_or_repo


def _model_arg(alias_or_repo: str, model_dir: str = ''):
    """返回可交给 funasr 的 model 取值：本地目录优先（离线），否则回退原值。"""
    repo = _repo_of(alias_or_repo)
    if os.path.sep in repo and os.path.isdir(repo):
        return repo
    local = _local_model_dir(repo, model_dir)
    return local or repo


# 依赖体检结果缓存；probe/install 传入 force=True 强制重测
_DEP_CACHE: Optional[dict] = None


def _dep_health(force: bool = False) -> dict:
    """逐个**真正 import 一次**，记录每个依赖是否健康以及失败原因。

    为什么不能只看包版本：`_pkg_version()` 读的是安装元数据，**并不 import**。
    实测踩过一次：modelscope 升到 1.40.1 却留下旧的 modelscope-hub 0.4.2，
    `import modelscope` 直接抛
    `cannot import name 'DEFAULT_CREDENTIALS_PATH' from 'modelscope_hub.compat.constants'`，
    FunASR 识别**全线失效**——但 readiness 依然显示「全部就绪」，
    因为版本元数据还在、模型目录也还在。这个假绿会让排查严重跑偏。
    """
    global _DEP_CACHE
    if _DEP_CACHE is not None and not force:
        return _DEP_CACHE
    out: dict = {}
    for name, mod in (('torch', 'torch'), ('funasr', 'funasr'), ('modelscope', 'modelscope')):
        try:
            __import__(mod)
            out[name] = {'ok': True, 'error': None}
        except Exception as exc:  # noqa: BLE001 - 任何导入异常都要如实上报
            out[name] = {'ok': False, 'error': f'{type(exc).__name__}: {exc}'}
    _DEP_CACHE = out
    return out


# 一个模型目录要算「真的在本地」，至少得有其中之一
_MODEL_FILE_HINTS = ('model.pt', 'model.safetensors', 'configuration.json', 'config.json')


def _model_dir_complete(local: Optional[str]) -> bool:
    """目录存在还不够：里面得有实际权重/配置文件，否则算没就绪。

    只判 `os.path.isdir` 会把「下载到一半被打断」的目录也算成就绪。
    """
    if not local:
        return False
    try:
        if any(os.path.exists(os.path.join(local, h)) for h in _MODEL_FILE_HINTS):
            return True
        # 分片权重（model-00001-of-00002.safetensors）或子目录里再放一层
        for root, _dirs, files in os.walk(local):
            for f in files:
                if f.endswith('.safetensors') or f.endswith('.pt') or f == 'configuration.json':
                    return True
            if root.count(os.sep) - local.count(os.sep) > 2:
                break
    except Exception:
        return False
    return False


def readiness(model_dir: str) -> dict:
    torch_state = _torch_state()
    funasr_ver = _pkg_version('funasr')
    onnx_ver = _pkg_version('funasr-onnx')
    cuda_ready = torch_state['installed'] and torch_state['cuda']
    device = 'cuda' if cuda_ready else 'cpu'

    # 逐个模型如实上报「本地是否就绪」，让面板能显示到底缺哪一块，
    # 而不是笼统说一句「模型未下载」。
    model_rows = [
        ('paraformer-zh', OFFLINE_MODELS['paraformer-zh']['model'], OFFLINE_MODELS['paraformer-zh']['label']),
        ('sensevoice', SENSEVOICE, OFFLINE_MODELS['sensevoice']['label']),
        ('fsmn-vad', FSMN_VAD, 'FSMN-VAD（断句）'),
        ('ct-punc', CT_PUNC, 'CT-Transformer（标点）'),
        ('cam++', CAMPP, 'CAM++（说话人）'),
        ('paraformer-zh-streaming', STREAM_MODEL, 'Paraformer 流式（实时逐字）'),
    ]
    models = []
    for key, repo, label in model_rows:
        local = _local_model_dir(repo, model_dir)
        complete = _model_dir_complete(local)
        models.append({'key': key, 'id': repo, 'label': label,
                       'ready': complete, 'path': local or model_dir,
                       # 目录在但内容不全 → 说明下载被打断，面板要能区分出来
                       'partial': bool(local) and not complete,
                       'offline': complete})

    deps = _dep_health()

    missing = []
    if funasr_ver is None:
        missing.append('未安装 funasr 包')
    if not torch_state['installed']:
        missing.append('未安装 torch')
    elif not torch_state['cuda']:
        missing.append('torch 未检测到可用 CUDA（将回退 CPU 推理）')
    # 依赖能 import 才算数——包版本元数据在但导入失败是最隐蔽的一种坏法
    for dep, st in deps.items():
        if not st['ok']:
            missing.append(f'{dep} 导入失败：{st["error"]}')
    not_ready = [m['key'] for m in models if not m['ready']]
    if not_ready:
        missing.append(f'模型未就绪（{", ".join(not_ready)}），可在面板执行「安装 / 修复环境」')

    # 识别能力判据：依赖真能 import + funasr + torch + 离线主模型完整。
    # 注意不要求联网 —— 模型已在本地时，识别是完全离线可用的。
    deps_ok = all(st['ok'] for st in deps.values())
    core_ready = _model_dir_complete(_local_model_dir(OFFLINE_MODELS['paraformer-zh']['model'], model_dir))

    return {
        'python': sys.executable,
        'pythonVersion': sys.version.split()[0],
        'funasrInstalled': funasr_ver is not None,
        'funasrVersion': funasr_ver,
        'funasrOnnxVersion': onnx_ver,
        'torchVersion': torch_state['version'],
        'cudaAvailable': cuda_ready,
        'cudaDeviceName': torch_state['device'],
        'device': device,
        'modelDir': model_dir,
        'models': models,
        'deps': deps,
        'missing': missing,
        'installHint': f'{sys.executable} -m pip install -U funasr modelscope modelscope-hub torch torchaudio',
        'ready': funasr_ver is not None and torch_state['installed'] and deps_ok and core_ready,
    }


def _purge_torch_leftovers() -> None:
    """清掉 pip 卸载失败留下的 torch 残留目录。

    pip 卸载时先把旧目录改名成 `~orch` 一类再删；中途失败就留下残留。
    重新安装的文件与这些残留混在同一目录里，会让 `import torch` 直接崩
    （实测报 `cannot import name 'autocast' from 'torch.amp'`）。
    注意不要误删 `torch_complex`——那是另一个独立包。
    """
    import shutil
    import site

    roots = set(site.getsitepackages())
    try:
        roots.add(site.getusersitepackages())
    except Exception:  # noqa: BLE001
        pass
    targets = {'torch', 'torchgen', 'functorch'}
    for root in roots:
        if not root or not os.path.isdir(root):
            continue
        for name in os.listdir(root):
            if not (name.startswith('~') or name in targets):
                continue
            path = os.path.join(root, name)
            try:
                shutil.rmtree(path)
                log('清理 torch 残留:', path)
            except OSError as exc:
                log('清理残留失败（忽略）:', path, exc)


def do_install(params: dict) -> dict:
    model_dir = params.get('modelDir') or MODEL_DIR_DEFAULT
    device_pref = params.get('device', 'auto')

    def progress(message: str) -> None:
        emit({'event': 'install-progress', 'message': message})

    torch_state = _torch_state()
    want_cuda = device_pref in ('auto', 'cuda')

    # ① torch / torchaudio —— 必须先装。
    #    顺序反了会踩坑：funasr 依赖 torch，若先装 funasr，pip 会从 PyPI 拉一份
    #    **CPU 版** torch（例如 2.14.0）；之后再用 cu128 索引装 CUDA 版时，
    #    pip 会认为「本地 2.14.0 比索引里的 2.11.0+cu128 新」，直接报
    #    "Requirement already satisfied" 什么也不做 —— 表面成功，实际永远没有 CUDA。
    if not torch_state['installed']:
        if want_cuda:
            progress('安装 CUDA 版 torch / torchaudio（cu128 索引，体积较大）…')
            _run_pip(_CUDA_PIP, progress, allow_fail=True)
            torch_state = _torch_state(fresh=True)
        if not torch_state['installed']:
            progress('安装 CPU 版 torch / torchaudio…')
            _run_pip([sys.executable, '-m', 'pip', 'install', '-U', 'torch', 'torchaudio'], progress)
            torch_state = _torch_state(fresh=True)
    elif want_cuda and not torch_state['cuda']:
        progress(f'检测到已装 CPU 版 torch {torch_state["version"]}，强制重装为 CUDA 版…')
        # 必须 --force-reinstall：CPU 版版本号往往高于 cu128 索引里的版本，
        # 不加这个参数 pip 会判定「已满足」而静默跳过。
        _run_pip([*_CUDA_PIP, '--force-reinstall', '--no-deps'], progress, allow_fail=True)
        torch_state = _torch_state(fresh=True)
        if not torch_state['installed']:
            # 强制重装把原有 torch 弄坏了：必须补回一份能用的，否则识别功能整体失效。
            # 实测踩过：pip 卸载旧 torch 中途失败会留下 ~orch 之类的残留目录，
            # 新装的文件与残留混在一起，import torch 直接报 cannot import name 'autocast'。
            progress('CUDA 重装后 torch 不可用，正在清理残留并回退安装 CPU 版…')
            _purge_torch_leftovers()
            _run_pip([sys.executable, '-m', 'pip', 'install', '--force-reinstall', '--no-deps',
                      'torch', 'torchaudio'], progress, allow_fail=True)
            torch_state = _torch_state(fresh=True)
        if not torch_state['installed']:
            raise RuntimeError(
                'torch 安装后仍无法导入，环境已损坏。请手动执行：\n'
                f'  {sys.executable} -m pip uninstall -y torch torchaudio\n'
                '  （并删除 site-packages 下所有 torch* 与 ~orch 残留目录）\n'
                f'  {sys.executable} -m pip install torch torchaudio'
            )
        if not torch_state['cuda']:
            progress('CUDA 版仍不可用，继续使用 CPU（不影响功能，仅速度较慢）')

    # ② funasr 与其运行依赖（torch 已就位，不会再被拉成 CPU 版）
    #
    # ⚠ modelscope-hub 必须和 modelscope **一起升**。实测踩过：
    #   只升 modelscope 到 1.40.1 而留下 modelscope-hub 0.4.2，
    #   `import modelscope` 会抛
    #   `cannot import name 'DEFAULT_CREDENTIALS_PATH' from 'modelscope_hub.compat.constants'`，
    #   FunASR 识别全线失效（而 readiness 只看包版本元数据，还会显示"就绪"）。
    progress('安装 Python 依赖（funasr / modelscope / modelscope-hub / soundfile）…')
    _run_pip(
        [sys.executable, '-m', 'pip', 'install', '-U', 'funasr', 'modelscope', 'modelscope-hub', 'soundfile'],
        progress,
    )

    # ③ 模型权重
    progress('下载 FunASR 模型权重…')
    _download_models(model_dir, progress)

    # 装完强制重测依赖：上面的 pip 可能刚换过版本，缓存必须作废
    _dep_health(force=True)
    progress('安装完成')
    return readiness(model_dir)


_CUDA_PIP = [sys.executable, '-m', 'pip', 'install', '-U', 'torch', 'torchaudio',
             '--index-url', 'https://download.pytorch.org/whl/cu128']


def _run_pip(cmd: list, progress, allow_fail: bool = False) -> None:
    env = dict(os.environ)
    env['PYTHONIOENCODING'] = 'utf-8'
    proc = subprocess.run(cmd, capture_output=True, text=True, env=env, encoding='utf-8', errors='replace')
    tail = (proc.stdout or '')[-2000:] + (proc.stderr or '')[-2000:]
    if proc.returncode != 0:
        if allow_fail:
            progress(f'命令失败（继续尝试回退）：{" ".join(cmd[3:])}')
            log(tail)
            return
        raise RuntimeError(f'pip 安装失败（exit {proc.returncode}）：{tail[-800:]}')
    log('pip ok:', ' '.join(cmd[3:]))


def _download_models(model_dir: str, progress) -> None:
    os.makedirs(model_dir, exist_ok=True)
    try:
        from modelscope import snapshot_download  # type: ignore
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f'modelscope 不可用，无法下载模型：{exc}') from exc

    targets = [
        ('paraformer-zh', PARAFORMER_ZH),
        ('fsmn-vad', FSMN_VAD),
        ('ct-punc', CT_PUNC),
        ('cam++', CAMPP),
        ('paraformer-zh-streaming', PARAFORMER_ZH_STREAM),
        ('sensevoice', SENSEVOICE),
    ]
    for name, repo in targets:
        # 逐个判就绪：只要本地已有快照就跳过，避免每次「安装」都重新拉一遍。
        if _local_model_dir(repo, model_dir):
            progress(f'模型 {name} 已在本地，跳过')
            continue
        progress(f'下载模型 {name}（{repo}）…')
        try:
            snapshot_download(repo, cache_dir=model_dir)
        except Exception as exc:  # noqa: BLE001
            # 单个模型失败不致命：离线/流式/说话人各有降级路径
            progress(f'模型 {name} 下载失败，跳过：{type(exc).__name__}: {exc}')


# ══════════════════════════════════════════════════════════════════
# L3 识别：离线 / 流式
# ══════════════════════════════════════════════════════════════════

_offline_cache: dict = {}
_stream_cache: dict = {}


def _require_funasr():
    try:
        from funasr import AutoModel  # type: ignore
        return AutoModel
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(
            'funasr 未安装或不可导入；请先在面板执行「安装 FunASR 环境」。'
            f'（{type(exc).__name__}: {exc}）'
        ) from exc


def _parse_sentences(res: Any) -> list:
    """把 FunASR 结果里的 sentence_info 归一成 [{start,end,text,speaker}]。"""
    out = []
    if not isinstance(res, list):
        return out
    for item in res:
        if not isinstance(item, dict):
            continue
        info = item.get('sentence_info')
        if isinstance(info, list) and info:
            for s in info:
                if not isinstance(s, dict):
                    continue
                text = str(s.get('text', '')).strip()
                if not text:
                    continue
                out.append({
                    'start': int(s.get('start', 0) or 0),
                    'end': int(s.get('end', 0) or 0),
                    'text': text,
                    'speaker': int(s['spk']) if isinstance(s.get('spk'), (int, float)) else None,
                })
        else:
            text = str(item.get('text', '')).strip()
            if text:
                out.append({'start': 0, 'end': 0, 'text': text, 'speaker': None})
    return out


def _build_auto_model(**kwargs):
    """构造 AutoModel，并把最常见的失败翻译成人能看懂的话。

    funasr 的模型名可能是**别名**（如 'paraformer-zh'）。别名要靠访问模型仓库把
    config.yaml 拉下来才能解析成模型类；一旦网络不通（例如代理没配），下载静默失败，
    funasr 抛出的却是 "model 'paraformer-zh' is not registered" —— 极具误导性。
    这里把它改写成「大概率是网络/仓库问题」。
    """
    AutoModel = _require_funasr()
    try:
        return AutoModel(**kwargs)
    except RuntimeError as exc:
        msg = str(exc)
        if 'is not registered' in msg:
            raise RuntimeError(
                f'FunASR 无法解析模型 {kwargs.get("model")!r}。'
                '正常路径下模型应指向**本地快照目录**（离线可用）；出现这个错误说明本地没有该模型，'
                '且回退到仓库 id 后联网也失败了（别名需要访问模型仓库拉 config.yaml 才能解析）。'
                '请在面板执行「安装 / 修复环境」把模型拉到本地。'
                f'（原始错误：{msg.splitlines()[0]}）'
            ) from exc
        raise


def get_offline_model(params: dict):
    key = (params.get('model', 'paraformer-zh'), params.get('device', 'auto'),
           bool(params.get('vad', True)), bool(params.get('punc', True)), bool(params.get('spk', True)),
           params.get('modelDir'))
    if key in _offline_cache:
        return _offline_cache[key]
    spec = OFFLINE_MODELS.get(str(params.get('model')), OFFLINE_MODELS['paraformer-zh'])
    mdir = params.get('modelDir') or MODEL_DIR_DEFAULT
    # 全部走 _model_arg：能命中本地快照就传本地目录，彻底不联网。
    kwargs: dict = {'model': _model_arg(spec['model'], mdir),
                    'device': _resolve_device(params.get('device', 'auto')),
                    'disable_update': True, 'disable_pbar': True}
    if params.get('vad', True):
        kwargs['vad_model'] = _model_arg(FSMN_VAD, mdir)
    if spec['needs_punc'] and params.get('punc', True):
        kwargs['punc_model'] = _model_arg(CT_PUNC, mdir)
    if params.get('spk', True):
        kwargs['spk_model'] = _model_arg(CAMPP, mdir)
    log('加载离线模型:', {k: (v if not isinstance(v, str) or len(v) < 90 else '…' + v[-88:]) for k, v in kwargs.items()})
    model = _build_auto_model(**kwargs)
    _offline_cache[key] = (model, bool(params.get('spk', True)) and 'spk_model' in kwargs)
    return _offline_cache[key]


def _resolve_device(pref: str) -> str:
    if pref == 'cpu':
        return 'cpu'
    state = _torch_state()
    if state['installed'] and state['cuda']:
        return 'cuda:0'
    return 'cpu'


# SenseVoice 的输出形如 `<|zh|><|HAPPY|><|Speech|><|woitn|>正文`：
# 这些标签直接显示会污染转写文本，甚至连标题都会被带脏。
# 但标签内容本身有价值（语种/情感/音频事件），所以剥下来单独回传而不是丢掉。
SV_TAG_RE = re.compile(r'<\|([^|]+)\|>')


def _strip_sv_tags(s: str) -> tuple:
    """返回 (去掉标签的正文, 标签内容列表)。"""
    if not s:
        return s, []
    return SV_TAG_RE.sub('', s).strip(), SV_TAG_RE.findall(s)


def do_offline(params: dict) -> dict:
    input_path = str(params['inputPath'])
    model, spk_on = get_offline_model(params)
    language = str(params.get('language', 'auto'))
    kwargs: dict = {'input': input_path, 'batch_size_s': 300, 'disable_pbar': True}
    # language='auto' 表示交给模型自己判语种——这是英文录音能被正确识别的前提。
    # （历史上默认写死 'zh'，导致换成 SenseVoice 后英文照样按中文识别。）
    if language and language != 'auto':
        kwargs['language'] = language
    res = model.generate(**kwargs)

    segments = _parse_sentences(res)
    # 剥离富文本标签（SenseVoice 用；paraformer 的输出里不会有这种模式，无副作用）
    sv_tags: list = []
    for s in segments:
        if s.get('text'):
            cleaned, tags = _strip_sv_tags(s['text'])
            s['text'] = cleaned
            sv_tags += tags

    text = '\n'.join(s['text'] for s in segments if s['text'])
    if not text:
        raw = ''.join(str(i.get('text', '')) for i in res if isinstance(i, dict)).strip()
        text, tags = _strip_sv_tags(raw)
        sv_tags += tags

    duration_ms = probe_duration_ms(input_path)
    if segments and not any(s['end'] for s in segments):
        # 没有 ZF 时间戳时用均匀切分兜底，保证时间轴可用
        if segments:
            step = duration_ms / len(segments)
            for i, s in enumerate(segments):
                s['start'] = int(i * step)
                s['end'] = int((i + 1) * step)

    speaker_applied = spk_on and any(s.get('speaker') is not None for s in segments)
    # 语种标签（zh/en/yue/ja/ko…）单独挑出来，前端可以显示「检测到英语」
    lang_tags = [t for t in sv_tags if t.lower() in ('zh', 'en', 'yue', 'ja', 'ko', 'auto', 'nospeech')]
    return {
        'text': text,
        'segments': segments,
        'durationMs': int(duration_ms),
        'model': str(params.get('model', 'paraformer-zh')),
        'device': _resolve_device(params.get('device', 'auto')),
        'speakerApplied': speaker_applied,
        'tags': sorted(set(sv_tags)),
        'detectedLanguage': lang_tags[0] if lang_tags else None,
    }


def get_stream_model(params: dict):
    key = (params.get('model', 'paraformer-zh'), params.get('device', 'auto'), params.get('modelDir'))
    if key not in _stream_cache:
        log('加载流式模型:', STREAM_MODEL)
        _stream_cache[key] = _build_auto_model(
            model=_model_arg(STREAM_MODEL, params.get('modelDir') or MODEL_DIR_DEFAULT),
            device=_resolve_device(params.get('device', 'auto')),
            disable_update=True,
            disable_pbar=True,
        )
    return _stream_cache[key]


def do_stream_open(params: dict) -> dict:
    sid = str(params['streamId'])
    model = get_stream_model(params)
    chunk_ms = int(params.get('chunkMs', 600))
    # FunASR online chunk_size 形如 [0, 10, 5]：0*60 / 10*60 / 5*60 毫秒
    chunk_size = [0, max(1, chunk_ms // 60 // 2), max(1, chunk_ms // 60 // 4)]
    _stream_cache[('state', sid)] = {
        'cache': {},
        'chunkSize': chunk_size,
        'encoderLookBack': int(params.get('encoderLookBack', 4)),
        'decoderLookBack': int(params.get('decoderLookBack', 4)),
        'texts': [],
        'segments': [],
        'pcm': bytearray(),
        'sampleRate': 16000,
        'fedSamples': 0,
        'model': model,
    }
    log('流式会话已打开:', sid, 'chunk_size=', chunk_size)
    return {'streamId': sid, 'chunkSize': chunk_size}


def do_stream_feed(params: dict) -> dict:
    import base64
    import numpy as np

    sid = str(params['streamId'])
    state = _stream_cache.get(('state', sid))
    if state is None:
        raise RuntimeError(f'流式会话不存在: {sid}')

    raw = base64.b64decode(params.get('opusB64', ''))
    ogg, _packets, _trailing = wrap_raw_opus(raw, 16000)
    with tempfile.NamedTemporaryFile(suffix='.ogg', delete=False) as tf:
        tf.write(ogg)
        tmp = tf.name
    try:
        data, sr = decode_audio_any(tmp)
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass

    if data.ndim == 2 and data.shape[1] > 1:
        data = data.mean(axis=1)
    else:
        data = data.reshape(-1)
    if sr != 16000:
        data = resample_linear(data.reshape(-1, 1), sr, 16000).reshape(-1)
    pcm = (np.clip(data, -1, 1) * 32767).astype('<i2').tobytes()
    state['pcm'] += pcm

    chunk_bytes = int(16000 * 2 * (state['chunkSize'][1] * 60) / 1000) or 19200
    new_texts = []
    while len(state['pcm']) >= chunk_bytes:
        piece = bytes(state['pcm'][:chunk_bytes])
        del state['pcm'][:chunk_bytes]
        new_texts.append(_stream_step(state, piece, is_final=False))

    partial = ''.join(state['texts']) + ''.join(new_texts)
    if new_texts:
        joined = ''.join(new_texts).strip()
        if joined:
            end_ms = int(state['fedSamples'] / 16000 * 1000)
            state['segments'].append({'start': max(0, end_ms - len(new_texts) * 600), 'end': end_ms,
                                      'text': joined, 'speaker': None})
    return {'partial': partial, 'segments': state['segments'][-2:]}


def _stream_step(state: dict, pcm_chunk: bytes, is_final: bool) -> str:
    import numpy as np
    audio = np.frombuffer(pcm_chunk, dtype='<i2').astype('float32') / 32768.0
    state['fedSamples'] += len(audio)
    res = state['model'].generate(
        input=audio,
        cache=state['cache'],
        is_final=is_final,
        chunk_size=state['chunkSize'],
        encoder_chunk_look_back=state['encoderLookBack'],
        decoder_chunk_look_back=state['decoderLookBack'],
        disable_pbar=True,
    )
    text = ''
    if isinstance(res, list) and res and isinstance(res[0], dict):
        text = str(res[0].get('text', ''))
    state['texts'].append(text)
    return text


def do_stream_close(params: dict) -> dict:
    import numpy as np

    sid = str(params['streamId'])
    state = _stream_cache.pop(('state', sid), None)
    if state is None:
        raise RuntimeError(f'流式会话不存在: {sid}')

    # 尾部残余不足一个 chunk：补零到整块并标记 is_final
    if state['pcm']:
        chunk_bytes = int(16000 * 2 * (state['chunkSize'][1] * 60) / 1000) or 19200
        piece = bytes(state['pcm'])
        if len(piece) < chunk_bytes:
            piece = piece + b'\x00' * (chunk_bytes - len(piece))
        _stream_step(state, piece, is_final=True)
        state['pcm'] = bytearray()
    else:
        _stream_step(state, b'\x00' * 1920, is_final=True)

    text = ''.join(state['texts']).strip()
    duration_ms = int(state['fedSamples'] / 16000 * 1000)
    segments = list(state['segments'])
    if text and not segments:
        segments = [{'start': 0, 'end': duration_ms, 'text': text, 'speaker': None}]
    return {
        'text': text,
        'segments': segments,
        'durationMs': duration_ms,
        'model': STREAM_MODEL,
        'device': _resolve_device(params.get('device', 'auto')),
        'speakerApplied': False,
    }


# ══════════════════════════════════════════════════════════════════
# L2 解码 / 前导污染探测
# ══════════════════════════════════════════════════════════════════

def _is_container(raw: bytes) -> bool:
    return raw[:4] == b'OggS' or (raw[:4] == b'RIFF' and raw[8:12] == b'WAVE')


def do_decode(params: dict) -> dict:
    input_path = str(params['inputPath'])
    output_path = str(params['outputPath'])
    target_rate = int(params.get('sampleRate', 16000))
    target_ch = int(params.get('channels', 1))
    bits = int(params.get('bits', 16))

    # 防御：调用方可能直接给裸 40B Opus 包流（未过 L2 的容器化步骤）。
    # 长度是 40 的整数倍且没有容器头 → 现场包成 Ogg，避免解码器报难以理解的错。
    cleanup = None
    raw = Path(input_path).read_bytes()
    if not _is_container(raw):
        if len(raw) % PACKET_SIZE != 0:
            raise ValueError(
                f'既不是 Ogg/WAV 容器，长度也不是 {PACKET_SIZE}B 的整数倍（{len(raw)}B）；无法识别格式'
            )
        ogg, _n, _t = wrap_raw_opus(raw, target_rate)
        with tempfile.NamedTemporaryFile(suffix='.ogg', delete=False) as tf:
            tf.write(ogg)
            cleanup = tf.name
        input_path = cleanup

    try:
        data, sr = decode_audio_any(input_path)
    finally:
        if cleanup:
            try:
                os.unlink(cleanup)
            except OSError:
                pass
    if sr != target_rate:
        data = resample_linear(data, sr, target_rate)
        sr = target_rate
    size = write_wav(output_path, data, sr, target_ch, bits)
    frames = data.shape[0]
    return {
        'outputPath': output_path,
        'durationMs': int(frames / float(sr) * 1000),
        'sampleRate': sr,
        'channels': target_ch,
        'bits': bits,
        'bytes': size,
    }


def _probe_window_ratio(raw: bytes, skip: int, probe_bytes: int) -> float:
    """从 skip 起取一段裸包封成 Ogg 解码，返回 解码时长/应有长度。"""
    window = raw[skip:skip + probe_bytes]
    usable = len(window) - (len(window) % PACKET_SIZE)
    if usable < PACKET_SIZE * 10:
        return 0.0
    expected_ms = (usable // PACKET_SIZE) * PACKET_MS
    try:
        ogg, _n, _t = wrap_raw_opus(window[:usable], 16000)
    except Exception:  # noqa: BLE001
        return 0.0
    with tempfile.NamedTemporaryFile(suffix='.ogg', delete=False) as tf:
        tf.write(ogg)
        tmp = tf.name
    try:
        got_ms = probe_duration_ms(tmp)
    except Exception:  # noqa: BLE001
        got_ms = 0.0
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass
    return (got_ms / expected_ms) if expected_ms > 0 else 0.0


def do_opus_probe(params: dict) -> dict:
    input_path = str(params['inputPath'])
    raw = Path(input_path).read_bytes()
    expected_ms = int(params.get('expectedMs', (len(raw) // PACKET_SIZE) * PACKET_MS))
    max_skip = int(params.get('maxSkip', 65536))
    min_ratio = float(params.get('minRatio', 0.9))
    # 探测窗口取 ~20s：足以区分「解不出来」和「解得对」，又不必解开整段
    probe_bytes = PACKET_SIZE * 1000  # 20s

    # 快路径：原样能解就不动
    ratio0 = _probe_window_ratio(raw, 0, probe_bytes)
    if ratio0 >= min_ratio:
        got_ms = ratio0 * ((min(len(raw), probe_bytes) // PACKET_SIZE) * PACKET_MS)
        return {'skipBytes': 0, 'decodedMs': int(got_ms), 'expectedMs': expected_ms, 'ratio': ratio0}

    # 慢路径：粗扫（step 取 8 包）再细化到单包
    limit = min(max_skip, len(raw) - PACKET_SIZE * 10)
    coarse = PACKET_SIZE * 8
    found = None
    skip = coarse
    while skip <= limit:
        if _probe_window_ratio(raw, skip, probe_bytes) >= min_ratio:
            found = skip
            break
        skip += coarse
    if found is not None:
        start = max(0, found - coarse)
        for s in range(start, found + 1, PACKET_SIZE):
            if _probe_window_ratio(raw, s, probe_bytes) >= min_ratio:
                found = s
                break
    skip_bytes = found or 0
    remaining = (len(raw) - skip_bytes) // PACKET_SIZE
    return {
        'skipBytes': skip_bytes,
        'decodedMs': remaining * PACKET_MS if found is not None else 0,
        'expectedMs': expected_ms,
        'ratio': 1.0 if found is not None else ratio0,
    }


# ══════════════════════════════════════════════════════════════════
# 主循环
# ══════════════════════════════════════════════════════════════════

HANDLERS = {
    # probe 是面板的「刷新状态」，必须强制重测依赖——用户刚修完环境就指望它反映出来
    'probe': lambda p: (_dep_health(force=True), readiness(p.get('modelDir') or MODEL_DIR_DEFAULT))[1],
    'install': do_install,
    'decode': do_decode,
    'opus_probe': do_opus_probe,
    'offline': do_offline,
    'stream_open': do_stream_open,
    'stream_feed': do_stream_feed,
    'stream_close': do_stream_close,
}


def main() -> int:
    global MODEL_DIR_DEFAULT

    ap = argparse.ArgumentParser()
    ap.add_argument('--model-dir', default=MODEL_DIR_DEFAULT)
    args = ap.parse_args()

    MODEL_DIR_DEFAULT = args.model_dir

    # 启动即上报就绪信息（探测失败也要上报，面板需要看到失败原因）
    try:
        payload = readiness(args.model_dir)
    except Exception as exc:  # noqa: BLE001
        payload = {'error': f'就绪探测异常：{type(exc).__name__}: {exc}', 'ready': False,
                   'python': sys.executable, 'models': [], 'missing': ['就绪探测异常']}
    payload['event'] = 'ready'
    emit(payload)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception:  # noqa: BLE001
            log('无法解析请求:', line[:200])
            continue

        cmd = req.get('cmd')
        if cmd == 'quit':
            break
        rid = req.get('id')
        handler = HANDLERS.get(str(cmd))
        if handler is None:
            emit({'id': rid, 'ok': False, 'error': f'未知命令: {cmd}'})
            continue
        try:
            result = handler(req)
            emit({'id': rid, 'ok': True, **(result or {})})
        except Exception as exc:  # noqa: BLE001
            log('命令失败:', cmd, traceback.format_exc())
            emit({'id': rid, 'ok': False, 'error': f'{type(exc).__name__}: {exc}'})
    return 0


if __name__ == '__main__':
    sys.exit(main())
