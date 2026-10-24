import { useEffect, useState } from 'react'

// A small code editor: monospace, Tab indents, and it only commits when you
// stop typing for a moment (or leave the box), so a half-written formula
// does not break the picture on every key.

export default function CodeBox({ value, onChange, rows = 8, label, error, delay = 400 }: {
  value: string
  onChange: (v: string) => void
  rows?: number
  label?: string
  error?: string
  delay?: number
}) {
  const [text, setText] = useState(value)
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) setText(value)
  }, [value, focused])
  useEffect(() => {
    if (text === value) return
    const id = setTimeout(() => onChange(text), delay)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])
  return (
    <label className="codebox">
      {label && <span className="param-label">{label}</span>}
      <textarea
        className="codebox-text"
        spellCheck={false}
        rows={rows}
        value={text}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); if (text !== value) onChange(text) }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key !== 'Tab') return
          e.preventDefault()
          const el = e.currentTarget
          const s = el.selectionStart, end = el.selectionEnd
          const next = `${text.slice(0, s)}  ${text.slice(end)}`
          setText(next)
          requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 2 })
        }}
      />
      {error && <span className="codebox-err">{error}</span>}
    </label>
  )
}
