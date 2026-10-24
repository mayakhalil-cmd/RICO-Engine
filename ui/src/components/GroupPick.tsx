import { useRef, useState } from 'react'
import PopMenu from './PopMenu'

// A dropdown in the style of the menus next to the logo: groups that fold
// open (with how many are inside), and the choices under them. The group of
// the current choice starts open.

export interface PickGroup { name: string; items: { value: string; label: string; hint?: string }[] }

export default function GroupPick({ value, groups, onPick, label, className = '' }: { value: string; groups: PickGroup[]; onPick: (v: string) => void; label?: string; className?: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement | null>(null)
  const cur = groups.flatMap((g) => g.items).find((i) => i.value === value)
  const [folds, setFolds] = useState<string[]>(() => groups.filter((g) => g.items.some((i) => i.value === value)).map((g) => g.name))
  const toggle = (n: string) => setFolds((f) => (f.includes(n) ? f.filter((x) => x !== n) : [...f, n]))
  return (
    <>
      <button ref={ref} type="button" className={`select group-pick no-corner ${className}`} aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen(!open)}>
        <span>{cur?.label ?? value}</span>
      </button>
      {open && (
        <PopMenu anchor={ref} onClose={() => setOpen(false)} className="group-pick-list">
          {groups.map((g) => {
            const on = folds.includes(g.name)
            return (
              <div key={g.name} className={`menu-fold${on ? ' open' : ''}`}>
                <button role="menuitem" aria-expanded={on} className="fold-head" onClick={() => toggle(g.name)}>
                  <span><i className="fold-arrow" aria-hidden="true">{on ? '▾' : '▸'}</i>{g.name}</span>
                  <span className="dim small">{g.items.length}</span>
                </button>
                {on && (
                  <div className="fold-items">
                    {g.items.map((i) => (
                      <button key={i.value} role="menuitem" className={i.value === value ? 'picked' : ''} onClick={() => { onPick(i.value); setOpen(false) }} title={i.hint}>
                        <span>{i.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </PopMenu>
      )}
    </>
  )
}
