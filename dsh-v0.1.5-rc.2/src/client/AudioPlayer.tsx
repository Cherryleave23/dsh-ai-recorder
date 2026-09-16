/**
 * 自绘音频播放器。
 *
 * 为什么不用 `<audio controls>`：原生控件样式跟主题脱节，且无法把时长 /
 * 进度和会话元信息排成一体。这里隐藏原生元素、自绘控件，交互按常见播放器
 * 手感做：点击进度条定位、按住拖动 scrub、拖动时只更新视觉、松手才 seek
 * （避免拖动过程中疯狂发 Range 请求）。
 *
 * 关于时长：Ogg/Opus 若没有正确的末页 granule，浏览器会把 duration 报成
 * Infinity。这里以 `audio.duration` 为准，拿不到就回退到会话记录里的
 * durationMs —— 进度条必须始终可用。
 */
import * as React from 'react'
import { C, mono } from './ui.js'
import { fmtClock } from './api.js'

export interface AudioPlayerProps {
  src: string
  /** 会话记录里的时长，浏览器报不出 duration 时用它兜底 */
  fallbackDurationMs?: number
  /** 下载 / 新窗口打开的直链 */
  downloadName?: string
  /** 把 seek 能力交给父组件（转写稿点时间戳跳转用） */
  seekRef?: React.MutableRefObject<((sec: number) => void) | null>
}

const RATES = [0.75, 1, 1.25, 1.5, 2]

export function AudioPlayer(props: AudioPlayerProps): React.ReactElement {
  const ref = React.useRef<HTMLAudioElement | null>(null)
  const trackRef = React.useRef<HTMLDivElement | null>(null)
  const [playing, setPlaying] = React.useState(false)
  const [ready, setReady] = React.useState(false)
  const [failed, setFailed] = React.useState<string | null>(null)
  const [mediaDuration, setMediaDuration] = React.useState(0)
  const [current, setCurrent] = React.useState(0)
  const [buffered, setBuffered] = React.useState(0)
  const [rate, setRate] = React.useState(1)
  const [drag, setDrag] = React.useState<number | null>(null)
  const [hoverRatio, setHoverRatio] = React.useState<number | null>(null)

  const fallbackSec = Math.max(0, (props.fallbackDurationMs ?? 0) / 1000)
  const duration = mediaDuration > 0 ? mediaDuration : fallbackSec
  const shown = drag !== null ? drag * duration : current

  // 播放中用 rAF 平滑推进（timeupdate 只有 ~4Hz，进度条会一跳一跳）
  React.useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = (): void => {
      const el = ref.current
      if (el) {
        setCurrent(el.currentTime)
        try {
          if (el.buffered.length > 0) setBuffered(el.buffered.end(el.buffered.length - 1))
        } catch {
          /* 某些实现读 buffered 会抛 */
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  // 切会话 / 换源时复位
  React.useEffect(() => {
    setPlaying(false)
    setReady(false)
    setFailed(null)
    setMediaDuration(0)
    setCurrent(0)
    setBuffered(0)
    setDrag(null)
  }, [props.src])

  const toggle = (): void => {
    const el = ref.current
    if (!el) return
    if (el.paused) {
      void el.play().catch((e: unknown) => {
        setFailed(e instanceof Error ? e.message : String(e))
      })
    } else {
      el.pause()
    }
  }

  const seekTo = (sec: number): void => {
    const el = ref.current
    if (!el) return
    const clamped = Math.max(0, Math.min(sec, duration > 0 ? duration : sec))
    try {
      el.currentTime = clamped
    } catch {
      /* 元数据未就绪时会抛，忽略 */
    }
    setCurrent(clamped)
  }

  const ratioFromEvent = (clientX: number): number => {
    const track = trackRef.current
    if (!track) return 0
    const r = track.getBoundingClientRect()
    if (r.width <= 0) return 0
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width))
  }

  // 把 seek 暴露给父组件（转写稿点时间戳跳转）
  React.useEffect(() => {
    if (!props.seekRef) return
    props.seekRef.current = (sec: number) => {
      seekTo(sec)
      const el = ref.current
      if (el && el.paused) void el.play().catch(() => undefined)
    }
    return () => {
      if (props.seekRef) props.seekRef.current = null
    }
    // seekTo 只依赖 ref 与 duration
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.seekRef, duration])

  // 拖动：pointermove / pointerup 挂在 window 上，拖出控件也能继续 scrub
  React.useEffect(() => {
    if (drag === null) return
    const move = (e: PointerEvent): void => setDrag(ratioFromEvent(e.clientX))
    const up = (e: PointerEvent): void => {
      const ratio = ratioFromEvent(e.clientX)
      setDrag(null)
      seekTo(ratio * duration)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    // ratioFromEvent 只读 ref，无需进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, duration])

  const pct = (v: number) => `${duration > 0 ? Math.min(100, (v / duration) * 100) : 0}%`

  const barPct = drag !== null ? `${drag * 100}%` : pct(shown)

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '12px 14px',
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        background: C.bg1,
      }}
    >
      <audio
        ref={ref}
        src={props.src}
        preload="metadata"
        onLoadedMetadata={(e) => {
          const el = e.currentTarget
          setReady(true)
          setFailed(null)
          if (Number.isFinite(el.duration) && el.duration > 0) setMediaDuration(el.duration)
        }}
        onDurationChange={(e) => {
          const el = e.currentTarget
          if (Number.isFinite(el.duration) && el.duration > 0) setMediaDuration(el.duration)
        }}
        onTimeUpdate={(e) => {
          if (drag === null) setCurrent(e.currentTarget.currentTime)
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false)
          setCurrent(0)
        }}
        onError={() => setFailed('浏览器无法解码这段音频（可能是不受支持的编码）')}
        style={{ display: 'none' }}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          type="button"
          onClick={toggle}
          disabled={!!failed}
          title={playing ? '暂停' : '播放'}
          style={{
            width: 38,
            height: 38,
            flexShrink: 0,
            borderRadius: '50%',
            border: 'none',
            background: failed ? C.border3 : C.brand,
            color: '#fff',
            cursor: failed ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'transform 100ms',
          }}
        >
          {playing ? (
            <svg width="13" height="13" viewBox="0 0 12 12" aria-hidden>
              <rect x="1.5" y="1" width="3" height="10" rx="1" fill="currentColor" />
              <rect x="7.5" y="1" width="3" height="10" rx="1" fill="currentColor" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 12 12" aria-hidden style={{ marginLeft: 2 }}>
              <path d="M2 1.2 10.4 6 2 10.8Z" fill="currentColor" />
            </svg>
          )}
        </button>

        <span style={{ fontFamily: mono, fontSize: 12, color: C.ink2, minWidth: 46, textAlign: 'right' }}>
          {fmtClock(shown * 1000)}
        </span>

        <div
          ref={trackRef}
          role="slider"
          aria-label="播放进度"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(shown)}
          tabIndex={0}
          onPointerDown={(e) => {
            e.preventDefault()
            setDrag(ratioFromEvent(e.clientX))
          }}
          onPointerMove={(e) => {
            if (drag === null) setHoverRatio(ratioFromEvent(e.clientX))
          }}
          onPointerLeave={() => setHoverRatio(null)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') seekTo(shown - 5)
            else if (e.key === 'ArrowRight') seekTo(shown + 5)
            else if (e.key === ' ') {
              e.preventDefault()
              toggle()
            }
          }}
          style={{
            position: 'relative',
            flex: 1,
            height: 20,
            display: 'flex',
            alignItems: 'center',
            cursor: 'pointer',
            touchAction: 'none',
            outline: 'none',
          }}
        >
          <div style={{ position: 'absolute', inset: '8px 0', borderRadius: 999, background: C.bg3 }} />
          <div
            style={{
              position: 'absolute',
              top: 8,
              bottom: 8,
              left: 0,
              width: pct(buffered),
              borderRadius: 999,
              background: C.border3,
              opacity: 0.7,
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: 8,
              bottom: 8,
              left: 0,
              width: barPct,
              borderRadius: 999,
              background: C.brand,
              transition: drag === null ? 'width 80ms linear' : 'none',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: barPct,
              width: 12,
              height: 12,
              marginLeft: -6,
              borderRadius: '50%',
              background: '#fff',
              border: `2px solid ${C.brand}`,
              boxShadow: '0 1px 3px rgba(0,0,0,.25)',
              transform: drag !== null ? 'scale(1.15)' : 'scale(1)',
              transition: 'transform 100ms',
            }}
          />
          {hoverRatio !== null && drag === null && (
            <div
              style={{
                position: 'absolute',
                left: `${hoverRatio * 100}%`,
                bottom: 22,
                transform: 'translateX(-50%)',
                background: C.ink,
                color: C.bg1,
                borderRadius: 4,
                padding: '1px 6px',
                fontSize: 11,
                fontFamily: mono,
                pointerEvents: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              {fmtClock(hoverRatio * duration * 1000)}
            </div>
          )}
        </div>

        <span style={{ fontFamily: mono, fontSize: 12, color: C.ink3, minWidth: 46 }}>
          {duration > 0 ? fmtClock(duration * 1000) : '--:--'}
        </span>

        <select
          value={String(rate)}
          onChange={(e) => {
            const v = Number(e.target.value)
            setRate(v)
            if (ref.current) ref.current.playbackRate = v
          }}
          title="播放速度"
          style={{
            border: `1px solid ${C.border3}`,
            background: C.bg2,
            color: C.ink2,
            borderRadius: 6,
            padding: '3px 6px',
            fontSize: 11,
          }}
        >
          {RATES.map((r) => (
            <option key={r} value={String(r)}>
              {r}×
            </option>
          ))}
        </select>
      </div>

      {failed && (
        <div style={{ fontSize: 12, color: C.danger, lineHeight: 1.7 }}>
          {failed}
          {' · '}
          <a href={props.src} download={props.downloadName} style={{ color: C.brand }}>
            下载后用本地播放器打开
          </a>
        </div>
      )}
      {!failed && !ready && (
        <div style={{ fontSize: 11, color: C.ink3 }}>正在读取音频元数据…</div>
      )}
    </div>
  )
}
