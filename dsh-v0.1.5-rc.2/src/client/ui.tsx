/**
 * 共享 UI 原语与主题令牌。
 *
 * 令牌一律带字面量兜底（`var(--x, #fff)`）：DSH 主题令牌名在版本间改过
 * （`--dsw-alias-label-primary` ↔ `--dsw-alias-text-primary`），兜底能保证
 * 任何主题下文字都不会变成同色不可见。
 */
import * as React from 'react'

export const C = {
  bg1: 'var(--dsw-alias-bg-layer-1, #ffffff)',
  bg2: 'var(--dsw-alias-bg-layer-2, #f7f7f8)',
  bg3: 'var(--dsw-alias-bg-layer-3, #f0f0f2)',
  ink: 'var(--dsw-alias-label-primary, var(--dsw-alias-text-primary, #1a1a1a))',
  ink2: 'var(--dsw-alias-label-secondary, var(--dsw-alias-text-secondary, #555555))',
  ink3: 'var(--dsw-alias-label-tertiary, var(--dsw-alias-text-tertiary, #8a8a8a))',
  border: 'var(--dsw-alias-border-l2, #e4e4e4)',
  border3: 'var(--dsw-alias-border-l3, #d0d0d0)',
  brand: 'var(--dsw-alias-brand-primary, #4a7cff)',
  ok: 'var(--dsw-alias-state-success-primary, #1a8a4a)',
  warn: 'var(--dsw-alias-state-warn-label, #b06a00)',
  danger: 'var(--dsw-alias-state-error-primary, #c0392b)',
  hoverDanger: 'var(--dsw-alias-interactive-bg-hover-danger, #fdecea)',
} as const

export const mono = 'var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)'

// ─────────────────────────── 基础块 ───────────────────────────

export function Btn(props: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  primary?: boolean
  danger?: boolean
  title?: string
  small?: boolean
  style?: React.CSSProperties
}): React.ReactElement {
  const [hover, setHover] = React.useState(false)
  const base: React.CSSProperties = {
    border: `1px solid ${props.primary ? 'transparent' : C.border3}`,
    background: props.primary ? C.brand : props.danger && hover ? C.hoverDanger : C.bg3,
    color: props.primary ? '#fff' : props.danger && hover ? C.danger : C.ink,
    borderRadius: 6,
    padding: props.small ? '2px 8px' : '5px 12px',
    fontSize: props.small ? 12 : 13,
    lineHeight: 1.5,
    cursor: props.disabled ? 'not-allowed' : 'pointer',
    opacity: props.disabled ? 0.5 : 1,
    whiteSpace: 'nowrap',
    transition: 'background 120ms, border-color 120ms',
    ...props.style,
  }
  return (
    <button
      type="button"
      title={props.title}
      disabled={props.disabled}
      onClick={props.onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={base}
    >
      {props.children}
    </button>
  )
}

export function Chip(props: {
  children: React.ReactNode
  tone?: 'neutral' | 'ok' | 'warn' | 'brand'
  title?: string
}): React.ReactElement {
  const color =
    props.tone === 'ok' ? C.ok : props.tone === 'warn' ? C.warn : props.tone === 'brand' ? C.brand : C.ink3
  return (
    <span
      title={props.title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '1px 8px',
        borderRadius: 999,
        fontSize: 11,
        lineHeight: 1.7,
        border: `1px solid ${C.border}`,
        color,
        whiteSpace: 'nowrap',
      }}
    >
      {props.children}
    </span>
  )
}

export function Panel(props: {
  title?: React.ReactNode
  extra?: React.ReactNode
  children: React.ReactNode
  style?: React.CSSProperties
  bodyStyle?: React.CSSProperties
}): React.ReactElement {
  return (
    <section
      style={{
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        background: C.bg2,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        ...props.style,
      }}
    >
      {props.title !== undefined && (
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            padding: '9px 14px',
            borderBottom: `1px solid ${C.border}`,
            fontSize: 13,
            fontWeight: 600,
            color: C.ink,
            flexShrink: 0,
          }}
        >
          <span>{props.title}</span>
          {props.extra}
        </header>
      )}
      <div style={{ padding: 14, minHeight: 0, ...props.bodyStyle }}>{props.children}</div>
    </section>
  )
}

export function Field(props: { label: string; children: React.ReactNode; hint?: string }): React.ReactElement {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12, color: C.ink2 }}>{props.label}</span>
      {props.children}
      {props.hint && <span style={{ fontSize: 11, color: C.ink3 }}>{props.hint}</span>}
    </label>
  )
}

export function Select(props: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  width?: number
}): React.ReactElement {
  return (
    <select
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      style={{
        border: `1px solid ${C.border3}`,
        background: C.bg1,
        color: C.ink,
        borderRadius: 6,
        padding: '4px 8px',
        fontSize: 12,
        width: props.width,
      }}
    >
      {props.options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function NumberInput(props: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  width?: number
}): React.ReactElement {
  return (
    <input
      type="number"
      value={props.value}
      min={props.min}
      max={props.max}
      step={props.step}
      onChange={(e) => {
        const n = Number(e.target.value)
        if (Number.isFinite(n)) props.onChange(n)
      }}
      style={{
        border: `1px solid ${C.border3}`,
        background: C.bg1,
        color: C.ink,
        borderRadius: 6,
        padding: '4px 8px',
        fontSize: 12,
        width: props.width ?? 96,
      }}
    />
  )
}

export function Switch(props: {
  label: string
  on: boolean
  onChange: (v: boolean) => void
  title?: string
}): React.ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.on}
      title={props.title}
      onClick={() => props.onChange(!props.on)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        border: `1px solid ${props.on ? C.border3 : C.border}`,
        background: props.on ? C.bg3 : 'transparent',
        color: props.on ? C.ink : C.ink3,
        borderRadius: 999,
        padding: '3px 10px 3px 4px',
        fontSize: 12,
        cursor: 'pointer',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 26,
          height: 15,
          borderRadius: 999,
          background: props.on ? C.brand : C.border3,
          position: 'relative',
          flexShrink: 0,
          transition: 'background 140ms',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 2,
            left: props.on ? 13 : 2,
            width: 11,
            height: 11,
            borderRadius: '50%',
            background: '#fff',
            transition: 'left 140ms',
          }}
        />
      </span>
      {props.label}
    </button>
  )
}

export function Row(props: { children: React.ReactNode; style?: React.CSSProperties }): React.ReactElement {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', ...props.style }}>
      {props.children}
    </div>
  )
}

export function Grid(props: {
  children: React.ReactNode
  cols: string
  gap?: number
  style?: React.CSSProperties
}): React.ReactElement {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: props.cols,
        gap: props.gap ?? 10,
        alignItems: 'center',
        ...props.style,
      }}
    >
      {props.children}
    </div>
  )
}

export function Muted(props: { children: React.ReactNode; style?: React.CSSProperties }): React.ReactElement {
  return <div style={{ fontSize: 12, color: C.ink3, lineHeight: 1.7, ...props.style }}>{props.children}</div>
}

export function Empty(props: { children: React.ReactNode }): React.ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        minHeight: 120,
        color: C.ink3,
        fontSize: 13,
        textAlign: 'center',
        padding: 20,
        lineHeight: 1.9,
      }}
    >
      {props.children}
    </div>
  )
}

export function ErrorBar(props: { text: string | null; onClose?: () => void }): React.ReactElement | null {
  if (!props.text) return null
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 10,
        border: `1px solid ${C.danger}`,
        background: C.hoverDanger,
        color: C.danger,
        borderRadius: 8,
        padding: '8px 12px',
        fontSize: 12,
        lineHeight: 1.7,
        wordBreak: 'break-word',
      }}
    >
      <span>{props.text}</span>
      {props.onClose && (
        <button
          type="button"
          onClick={props.onClose}
          style={{ border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}
        >
          ×
        </button>
      )}
    </div>
  )
}

/** 全页加载态 */
export function Loading(props: { text?: string }): React.ReactElement {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.ink3, fontSize: 13, padding: 20 }}>
      <span
        style={{
          width: 14,
          height: 14,
          borderRadius: '50%',
          border: `2px solid ${C.border3}`,
          borderTopColor: C.brand,
          animation: 'dsh-rec-spin 700ms linear infinite',
        }}
      />
      {props.text ?? '加载中…'}
      <style>{'@keyframes dsh-rec-spin{to{transform:rotate(360deg)}}'}</style>
    </div>
  )
}
