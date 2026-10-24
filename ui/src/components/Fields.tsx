import { useEffect, useState, type ReactNode } from 'react'
import { useInDock } from '../shell/dockContext'

// Form pieces shared by every screen.

export function Switch({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  )
}

// A text box that only reports its value when you finish typing (Enter or
// leaving the box), so RICO isn't reconfigured on every keystroke.
export function TextField({ label, value, onCommit, placeholder, numeric, width }: {
  label?: string
  value: string | number
  onCommit: (v: string) => void
  placeholder?: string
  numeric?: boolean
  width?: number
}) {
  const [draft, setDraft] = useState(String(value))
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    if (!editing) setDraft(String(value))
  }, [value, editing])
  const commit = () => {
    setEditing(false)
    if (draft !== String(value)) onCommit(draft)
  }
  const input = (
    <input
      className={`input${numeric ? ' num' : ''}`}
      style={width ? { width } : undefined}
      value={draft}
      placeholder={placeholder}
      inputMode={numeric ? 'numeric' : undefined}
      spellCheck={false}
      onFocus={() => setEditing(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') { setDraft(String(value)); setEditing(false) }
      }}
    />
  )
  if (!label) return input
  return (
    <label className="field">
      <span>{label}</span>
      {input}
    </label>
  )
}

export function Select({ label, value, options, onChange, placeholder }: {
  label?: string
  value: number | string
  options: { value: number | string; label: string; disabled?: boolean }[]
  onChange: (v: string) => void
  placeholder?: string
}) {
  const select = (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
      {placeholder !== undefined && <option value={-1}>{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
      ))}
    </select>
  )
  if (!label) return select
  return (
    <label className="field">
      <span>{label}</span>
      {select}
    </label>
  )
}

export function Panel({ title, sub, actions, live, nested, children }: { title: string; sub?: ReactNode; actions?: ReactNode; live?: boolean; nested?: boolean; children: ReactNode }) {
  const docked = useInDock()
  if (docked && !nested) {
    return (
      <div className={`dpanel${live ? ' live' : ''}`}>
        {(sub || actions) && (
          <div className="dpanel-head">
            {sub && <p>{sub}</p>}
            {actions}
          </div>
        )}
        {children}
      </div>
    )
  }
  return (
    <section className={`panel${live ? ' live' : ''}`}>
      <div className="panel-head">
        <div>
          <h2>{title}</h2>
          {sub && <p>{sub}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}

export function Meter({ value, kind }: { value: number; kind?: 'in' | 'out' }) {
  const v = Math.max(0, Math.min(1, value))
  return (
    <div className={`meter${kind ? ' ' + kind : ''}`} role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={Number(v.toFixed(2))}>
      <i style={{ width: `${v * 100}%` }} />
    </div>
  )
}
