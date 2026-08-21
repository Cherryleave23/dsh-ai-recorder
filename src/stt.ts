/**
 * STT 可插拔适配层 —— 不绑定任何单一模型。
 *
 * providers:
 *  - mock          联调占位, 返回固定文本
 *  - openai-compat OpenAI 兼容 /audio/transcriptions（本地 whisper server / faster-whisper / 云端 API 通吃）
 *  - whisper-cpp-cli 本地子进程离线转写（whisper-cli -m model -f wav -otxt）
 */
import { execFile, spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Config } from './config.js'
import { normalizeAudio } from './audio.js'

export interface TranscribeInput {
  bytes: Uint8Array
  /** 原始提示: opus(raw 包流/已封口) / ogg / wav / auto(自动探测) */
  ext: 'opus' | 'ogg' | 'wav' | 'auto'
  language?: string
  sessionId?: string
}

export interface SttResult {
  text: string
  provider: string
  meta?: Record<string, unknown>
}

export type SttProvider = (input: TranscribeInput, cfg: Config) => Promise<SttResult>

async function mockProvider(input: TranscribeInput): Promise<SttResult> {
  return {
    text: `[mock 转写] 收到 ${input.ext} 音频 ${input.bytes.length}B${input.language ? `，语言=${input.language}` : ''}（配置 sttProvider 切换真实转写）`,
    provider: 'mock',
  }
}

async function openaiCompatProvider(input: TranscribeInput, cfg: Config): Promise<SttResult> {
  const base = cfg.openaiCompatBaseUrl.replace(/\/+$/, '')
  const url = `${base}/audio/transcriptions`
  const norm = normalizeAudio(input.bytes, input.ext)
  const fileName = `rec_${Date.now()}.${norm.ext}`
  const mime = norm.ext === 'wav' ? 'audio/wav' : 'audio/ogg'

  const form = new FormData()
  const ab = new ArrayBuffer(norm.bytes.byteLength)
  new Uint8Array(ab).set(norm.bytes)
  form.append('file', new Blob([ab], { type: mime }), fileName)
  form.append('model', cfg.openaiCompatModel)
  if (input.language && input.language !== 'auto') form.append('language', input.language)
  // 不指定 response_format：默认 json（兼容 OpenAI 官方与 whisper.cpp server）

  const headers: Record<string, string> = {}
  if (cfg.openaiCompatApiKey) headers['Authorization'] = `Bearer ${cfg.openaiCompatApiKey}`

  const resp = await fetch(url, { method: 'POST', headers, body: form })
  const raw = await resp.text()
  if (!resp.ok) throw new Error(`STT HTTP ${resp.status}: ${raw.slice(0, 300)}`)
  try {
    const json = JSON.parse(raw)
    const text = typeof json.text === 'string' ? json.text : ''
    return { text: text.trim(), provider: 'openai-compat', meta: { model: cfg.openaiCompatModel, url } }
  } catch {
    return { text: raw.trim(), provider: 'openai-compat', meta: { model: cfg.openaiCompatModel, url } }
  }
}

const LANG_MAP: Record<string, string> = {
  zh: 'zh', zh_cn: 'zh', cn: 'zh', en: 'en', ja: 'ja', ko: 'ko', ru: 'ru', auto: 'auto',
}

/** 内嵌 faster-whisper 转写脚本（自包含：插件运行时可写入磁盘供子进程调用） */
const EMBEDDED_TRANSCRIBE_SCRIPT = `#!/usr/bin/env python3
import argparse, sys
from pathlib import Path
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('-m', '--model', required=True)
    ap.add_argument('-f', '--file', required=True)
    ap.add_argument('-l', '--language', default=None)
    ap.add_argument('-o', '--output', default=None)
    args = ap.parse_args()
    if not Path(args.file).exists():
        print('ERR: audio file missing: ' + args.file, file=sys.stderr); return 2
    try:
        from faster_whisper import WhisperModel
    except Exception as e:
        print('ERR: faster_whisper not installed: ' + str(e), file=sys.stderr); return 3
    try:
        model = WhisperModel(args.model, device='cpu', compute_type='int8')
        segments, _info = model.transcribe(args.file, language=args.language, beam_size=5,
            vad_filter=True, vad_parameters=dict(min_silence_duration_ms=500))
        texts = [seg.text.strip() for seg in segments if seg.text and seg.text.strip()]
        out = '\\n'.join(texts)
        if args.output:
            Path(args.output).write_text(out, 'utf-8')
            print('OK: ' + str(len(texts)) + ' segments -> ' + args.output)
        else:
            print(out)
        return 0
    except Exception as e:
        print('ERR: transcription failed: ' + str(e), file=sys.stderr); return 4
if __name__ == '__main__':
    sys.exit(main())
`

async function fasterWhisperPyProvider(input: TranscribeInput, cfg: Config): Promise<SttResult> {
  const norm = normalizeAudio(input.bytes, input.ext)
  const dir = await fs.mkdtemp(join(tmpdir(), 'rec-stt-'))
  const inpFile = join(dir, `in.${norm.ext}`)
  const outTxt = join(dir, 'out.txt')
  await fs.writeFile(inpFile, norm.bytes)
  // 自包含脚本：模型目录旁写入（首次）
  const script = cfg.fasterWhisperScript || join(dirname(cfg.fasterWhisperModelDir || '.'), 'transcribe.py')
  try {
    if (!(await fs.stat(script)).isFile()) await fs.writeFile(script, EMBEDDED_TRANSCRIBE_SCRIPT, 'utf8')
  } catch {
    await fs.writeFile(script, EMBEDDED_TRANSCRIBE_SCRIPT, 'utf8')
  }
  const lang = LANG_MAP[(input.language ?? cfg.language ?? 'auto').toLowerCase()] ?? 'auto'
  const args = [script, '-m', cfg.fasterWhisperModelDir, '-f', inpFile, '-l', lang, '-o', outTxt]
  await new Promise<void>((resolve, reject) => {
    execFile(cfg.pythonPath || 'python', args, { timeout: 300_000, maxBuffer: 16 * 1024 * 1024 }, (err, _stdout, stderr) => {
      if (err) reject(new Error(`faster-whisper 失败: ${stderr || err.message}`))
      else resolve()
    })
  })
  let text = ''
  try {
    text = await fs.readFile(outTxt, 'utf8')
  } catch (e) {
    throw new Error(`faster-whisper 未产出文本: ${String(e)}`)
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
  return { text: text.trim(), provider: 'faster-whisper-py', meta: { model: cfg.fasterWhisperModelDir } }
}

const QWEN_LANG_MAP: Record<string, string> = {
  zh: 'zh', zh_cn: 'zh', cn: 'zh', en: 'en', ja: 'ja', ko: 'ko', ru: 'ru', auto: 'auto',
}

// ─────────── Qwen3-ASR 常驻 worker（模型只加载一次；stdio JSON-lines，同 BLE 守护进程模式）───────────
interface QwenWorkerState {
  proc: import('node:child_process').ChildProcessWithoutNullStreams
  seq: number
  buf: string
  ready: boolean
  readyError?: string
  python: string
  modelDir: string
  pending: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>
}
let qwenWorker: QwenWorkerState | null = null

function qwenScript(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'qwen_worker.py')
}

export async function disposeQwenWorker(): Promise<void> {
  const w = qwenWorker
  qwenWorker = null
  if (!w) return
  try { w.proc.stdin.write(JSON.stringify({ cmd: 'quit' }) + '\n') } catch { /* ignore */ }
  for (const { reject, timer } of w.pending.values()) {
    clearTimeout(timer)
    reject(new Error('Qwen worker 已重置'))
  }
  w.pending.clear()
  setTimeout(() => { try { w.proc.kill() } catch { /* ignore */ } }, 1500).unref?.()
}

async function ensureQwenWorker(cfg: Config): Promise<QwenWorkerState> {
  const script = qwenScript()
  if (qwenWorker && qwenWorker.proc.exitCode === null && qwenWorker.python === cfg.qwenPythonPath && qwenWorker.modelDir === cfg.qwenModelDir) {
    return qwenWorker
  }
  await disposeQwenWorker()
  const state: QwenWorkerState = {
    proc: null as unknown as QwenWorkerState['proc'],
    seq: 0, buf: '', ready: false,
    python: cfg.qwenPythonPath, modelDir: cfg.qwenModelDir,
    pending: new Map(),
  }
  const proc = spawn(cfg.qwenPythonPath, ['-u', script, '-m', cfg.qwenModelDir], { windowsHide: true })
  state.proc = proc
  proc.stdout.setEncoding('utf8')
  proc.stderr.setEncoding('utf8')
  proc.stdout.on('data', (c: string) => {
    state.buf += c
    let idx: number
    while ((idx = state.buf.indexOf('\n')) >= 0) {
      const line = state.buf.slice(0, idx).trim()
      state.buf = state.buf.slice(idx + 1)
      if (!line) continue
      try {
        const obj = JSON.parse(line) as Record<string, unknown>
        if (obj.event === 'ready') {
          state.ready = true
          if (typeof obj.error === 'string') state.readyError = obj.error
        } else if (typeof obj.id === 'number') {
          const p = state.pending.get(obj.id)
          if (p) {
            state.pending.delete(obj.id)
            clearTimeout(p.timer)
            if (obj.ok === false) p.reject(new Error(String(obj.error ?? 'Qwen 转写失败')))
            else p.resolve(obj)
          }
        }
      } catch { /* ignore */ }
    }
  })
  proc.stderr.on('data', (c: string) => { /* 静默（模型加载进度等） */ })
  proc.on('exit', () => {
    for (const { reject, timer } of state.pending.values()) {
      clearTimeout(timer)
      reject(new Error('Qwen worker 已退出'))
    }
    state.pending.clear()
    if (qwenWorker === state) qwenWorker = null
  })
  // 等待 ready（最多 240s：torch+模型加载）
  const deadline = Date.now() + 240000
  await new Promise<void>((resolve, reject) => {
    const timer = setInterval(() => {
      if (state.ready) {
        clearInterval(timer)
        if (state.readyError) reject(new Error('Qwen worker 启动失败: ' + state.readyError))
        else resolve()
      } else if (Date.now() > deadline) {
        clearInterval(timer)
        reject(new Error('Qwen worker 启动超时（torch/模型加载过慢）'))
      }
    }, 150)
  })
  qwenWorker = state
  return state
}

function qwenWorkerRequest(w: QwenWorkerState, cmd: string, params: Record<string, unknown>, timeoutMs: number): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    if (w.proc.exitCode !== null) {
      reject(new Error('Qwen worker 未运行'))
      return
    }
    const id = ++w.seq
    const timer = setTimeout(() => {
      w.pending.delete(id)
      reject(new Error(`Qwen worker 命令超时: ${cmd}`))
    }, timeoutMs)
    w.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
    w.proc.stdin.write(JSON.stringify({ id, cmd, ...params }) + '\n')
  })
}

/** Qwen3-ASR（本地 GPU，Qwen/Qwen3-ASR-1.7B）—— 常驻 worker，失败回退一次性 CLI */
async function qwenAudioPyProvider(input: TranscribeInput, cfg: Config): Promise<SttResult> {
  if (!cfg.qwenModelDir) throw new Error('Qwen-ASR: 未配置模型目录 qwenModelDir')
  if (!cfg.qwenPythonPath) throw new Error('Qwen-ASR: 未配置 Python（venv）路径 qwenPythonPath')
  const norm = normalizeAudio(input.bytes, input.ext)
  const dir = await fs.mkdtemp(join(tmpdir(), 'rec-qwen-'))
  const inpFile = join(dir, `in.${norm.ext}`)
  const outTxt = join(dir, 'out.txt')
  await fs.writeFile(inpFile, norm.bytes)
  const lang = QWEN_LANG_MAP[(input.language ?? cfg.language ?? 'auto').toLowerCase()] ?? 'auto'
  try {
    // 常驻 worker 优先（实时转写不重复加载模型）
    const w = await ensureQwenWorker(cfg)
    const r = await qwenWorkerRequest(w, 'transcribe', { file: inpFile, language: lang }, 180000)
    return { text: String(r.text ?? '').trim(), provider: 'qwen-audio-py', meta: { model: cfg.qwenModelDir, worker: true } }
  } catch (e) {
    // 回退一次性 CLI
    const script = qwenScript()
    const args = [join(dirname(script), 'transcribe_qwen.py'), '-m', cfg.qwenModelDir, '-f', inpFile, '-l', lang, '-o', outTxt]
    await new Promise<void>((resolve, reject) => {
      execFile(cfg.qwenPythonPath, args, { timeout: 600_000, maxBuffer: 16 * 1024 * 1024 }, (err, _stdout, stderr) => {
        if (err) reject(new Error(`Qwen-ASR 失败: ${stderr || err.message}（worker 错误: ${e instanceof Error ? e.message : e}）`))
        else resolve()
      })
    })
    let text = ''
    try {
      text = await fs.readFile(outTxt, 'utf8')
    } catch (e2) {
      throw new Error(`Qwen-ASR 未产出文本: ${String(e2)}`)
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
    return { text: text.trim(), provider: 'qwen-audio-py', meta: { model: cfg.qwenModelDir, worker: false } }
  }
}

async function whisperCppCliProvider(input: TranscribeInput, cfg: Config): Promise<SttResult> {
  const norm = normalizeAudio(input.bytes, input.ext)
  const dir = await fs.mkdtemp(join(tmpdir(), 'rec-stt-'))
  const inpFile = join(dir, `in.${norm.ext}`)
  const outBase = join(dir, 'out')
  await fs.writeFile(inpFile, norm.bytes)
  const lang = LANG_MAP[(input.language ?? cfg.language ?? 'auto').toLowerCase()] ?? 'auto'
  const args = ['-m', cfg.whisperCppModelPath, '-f', inpFile, '-otxt', '-of', outBase, '-l', lang]
  await new Promise<void>((resolve, reject) => {
    execFile(cfg.whisperCppCliPath, args, { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 }, (err) => {
      if (err) reject(new Error(`whisper-cli 失败: ${err.message}`))
      else resolve()
    })
  })
  const outTxt = join(dir, 'out.txt')
  let text = ''
  try {
    text = await fs.readFile(outTxt, 'utf8')
  } catch (e) {
    throw new Error(`whisper-cli 未产出 out.txt: ${String(e)}`)
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
  return { text: text.trim(), provider: 'whisper-cpp-cli', meta: { model: cfg.whisperCppModelPath } }
}

export function createProvider(kind: Config['sttProvider']): SttProvider {
  if (kind === 'mock') return mockProvider
  if (kind === 'openai-compat') return openaiCompatProvider
  if (kind === 'whisper-cpp-cli') return whisperCppCliProvider
  if (kind === 'faster-whisper-py') return fasterWhisperPyProvider
  if (kind === 'qwen-audio-py') return qwenAudioPyProvider
  throw new Error(`未知 sttProvider: ${kind}`)
}