import { useRef, useState } from 'react'

// A number you drag left and right to change, like the blue values in After
// Effects. Click to type a value (any number you like, past the usual
// range too), Shift drags faster, Ctrl slower.

export default function Scrub({ value, onChange, step = 1, digits = 1, suffix = '', min, max, title, onStart, strict }: {
  value: number
  onChange: (v: number) => void
  step?: number
  digits?: number
  suffix?: string
  min?: number
  max?: number
  title?: string
  onStart?: () => void
  strict?: boolean     // also limit typed numbers (only for things like counts)
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const drag = useRef<{ x: number; v: number; moved: boolean } | null>(null)
  const clamp = (v: number) => Math.max(min ?? -Infinity, Math.min(max ?? Infinity, v))

  if (editing) {
    return (
      <input
        className="scrub-input"
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => { setEditing(false); const v = Number(text); if (Number.isFinite(v)) onChange(strict ? clamp(v) : v) }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') setEditing(false)
        }}
      />
    )
  }
  return (
    <span
      className="scrub"
      title={title ?? 'Drag to change, click to type'}
      onPointerDown={(e) => {
        e.stopPropagation()
        ;(e.target as Element).setPointerCapture(e.pointerId)
        drag.current = { x: e.clientX, v: value, moved: false }
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        const dx = e.clientX - d.x
        if (!d.moved && Math.abs(dx) < 3) return
        if (!d.moved) onStart?.()
        d.moved = true
        const k = e.shiftKey ? 10 : e.ctrlKey || e.metaKey ? 0.1 : 1
        onChange(clamp(d.v + dx * step * k))
      }}
      onPointerUp={() => {
        const d = drag.current
        drag.current = null
        if (d && !d.moved) { setText(value.toFixed(digits)); setEditing(true) }
      }}
    >{value.toFixed(digits)}{suffix}</span>
  )
}
