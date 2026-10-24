import { useRef, useState } from 'react'
import PopMenu from './PopMenu'

// A compact pick list: shows the choice, opens a short list. Each choice can
// have a short explanation that shows when you rest the mouse on it.

export interface Choice { id: string; name: string; about?: string; group?: string }

export default function Dropdown({ value, choices, onPick, placeholder = 'Pick one', label }: { value: string | undefined; choices: Choice[]; onPick: (id: string) => void; placeholder?: string; label?: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement | null>(null)
  const cur = choices.find((c) => c.id === value)
  let lastGroup: string | undefined
  return (
    <>
      <button ref={ref} type="button" className="dd-btn" aria-haspopup="listbox" aria-expanded={open} aria-label={label} title={cur?.about} onClick={() => setOpen(!open)}>
        <span>{cur?.name ?? placeholder}</span><i aria-hidden>▾</i>
      </button>
      {open && (
        <PopMenu anchor={ref} onClose={() => setOpen(false)} className="dd-list">
          {choices.map((c) => {
            const head = c.group && c.group !== lastGroup ? <div className="menu-head" key={`h-${c.group}`}>{c.group}</div> : null
            lastGroup = c.group
            return [head, (
              <button key={c.id} role="option" aria-selected={c.id === value} className={c.id === value ? 'on' : ''} title={c.about} onClick={() => { onPick(c.id); setOpen(false) }}>
                <span>{c.name}</span>
              </button>
            )]
          })}
        </PopMenu>
      )}
    </>
  )
}
