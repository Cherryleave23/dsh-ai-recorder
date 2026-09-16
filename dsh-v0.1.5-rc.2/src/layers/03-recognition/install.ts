/**
 * L3 识别层 · 环境与模型安装
 *
 * FunASR 需要 Python 侧依赖（funasr + torch + modelscope + funasr-onnx 等）与模型权重。
 * 探测与安装都由 `scripts/funasr_worker.py` 执行（它才是真正 import funasr 的一方），
 * 这里只做类型化封装与进度事件转发。
 */
import type { PyWorker } from '../../py-worker.js'

export interface FunasrModelState {
  key: string
  id: string
  label: string
  ready: boolean
  path: string
  /** 目录在但里面没有实际权重/配置（下载被打断） */
  partial?: boolean
}

/** 依赖的真实导入体检结果（不是包版本元数据） */
export interface FunasrDepState {
  ok: boolean
  error: string | null
}

export interface FunasrReadiness {
  python: string | null
  pythonVersion: string | null
  /** funasr 包是否可导入 */
  funasrInstalled: boolean
  funasrVersion: string | null
  torchVersion: string | null
  /** torch 是否检测到可用 CUDA */
  cudaAvailable: boolean
  cudaDeviceName: string | null
  /** 实际生效的推理设备 */
  device: 'cpu' | 'cuda'
  models: FunasrModelState[]
  /** 关键依赖的真实导入体检（torch / funasr / modelscope） */
  deps?: Record<string, FunasrDepState>
  /** 还缺什么（面向面板的人话） */
  missing: string[]
  /** 建议执行的安装命令 */
  installHint: string
  /** 是否已具备识别能力 */
  ready: boolean
}

export interface InstallProgress {
  stage: string
  message: string
  percent?: number
}

/** 从 worker 的 ready/probe 载荷里取出就绪信息（字段缺失一律按未就绪处理）。 */
export function readReadiness(payload: Record<string, unknown> | null): FunasrReadiness {
  const p = payload ?? {}
  const models = Array.isArray(p.models) ? (p.models as Record<string, unknown>[]) : []
  return {
    python: typeof p.python === 'string' ? p.python : null,
    pythonVersion: typeof p.pythonVersion === 'string' ? p.pythonVersion : null,
    funasrInstalled: p.funasrInstalled === true,
    funasrVersion: typeof p.funasrVersion === 'string' ? p.funasrVersion : null,
    torchVersion: typeof p.torchVersion === 'string' ? p.torchVersion : null,
    cudaAvailable: p.cudaAvailable === true,
    cudaDeviceName: typeof p.cudaDeviceName === 'string' ? p.cudaDeviceName : null,
    device: p.device === 'cuda' ? 'cuda' : 'cpu',
    models: models.map((m) => ({
      key: String(m.key ?? ''),
      id: String(m.id ?? ''),
      label: String(m.label ?? m.key ?? ''),
      ready: m.ready === true,
      path: String(m.path ?? ''),
      // 目录在但内容是空的：下载被打断，与「完全没下」要区分开
      partial: m.partial === true,
    })),
    deps: (p.deps && typeof p.deps === 'object' ? p.deps : {}) as Record<string, FunasrDepState>,
    missing: Array.isArray(p.missing) ? p.missing.map(String) : [],
    installHint: typeof p.installHint === 'string' ? p.installHint : '',
    ready: p.ready === true,
  }
}

/** 主动重新探测（worker 侧重新 import + 查模型目录）。 */
export async function probeFunasr(worker: PyWorker): Promise<FunasrReadiness> {
  const r = await worker.request('probe', {}, 120_000)
  return readReadiness(r)
}

/**
 * 触发安装（pip 装依赖 + 下载模型）。
 * 进度通过 worker 的 event 通道推送，调用方用 onProgress 消费。
 */
export async function installFunasr(
  worker: PyWorker,
  opts: { device: 'auto' | 'cpu' | 'cuda'; model: string },
  timeoutMs = 60 * 60 * 1000,
): Promise<FunasrReadiness> {
  const r = await worker.request('install', { device: opts.device, model: opts.model }, timeoutMs)
  return readReadiness(r)
}
