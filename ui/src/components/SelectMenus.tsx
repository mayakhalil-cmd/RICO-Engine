import { useEffect, useRef, useState } from 'react'
import PopMenu from './PopMenu'

// Every dropdown in RICO opens the same menu: the style of the menus next to
// the logo. Dropdowns with groups fold open like the Window menu (the group
// of the current choice starts open); plain ones are a simple list. It works
// for every <select> on the page, so they all look and behave alike. The
// keyboard still works the usual way (arrows on a focused dropdown).

interface Opt { value: string; label: string; disabled: boolean }
interface Group { name: string | null; opts: Opt[] }

function readGroups(sel: HTMLSelectElement): Group[] {
  const out: Group[] = []
  for (const child of Array.from(sel.children)) {
    if (child instanceof HTMLOptGroupElement) {
      out.push({ name: child.label, opts: Array.from(child.children).filter((c): c is HTMLOptionElement => c instanceof HTMLOptionElement).map((o) => ({ value: o.value, label: o.text, disabled: o.disabled })) })
    } else if (child instanceof HTMLOptionElement) {
      const last = out[out.length - 1]
      const o = { value: child.value, label: child.text, disabled: child.disabled }
      // a placeholder like "+ Add an effect..." is the button's own words, not a choice
      if (o.value === '' && /(\.\.\.|…)$|^\+ /.test(o.label)) continue
      if (last && last.name === null) last.opts.push(o)
      else out.push({ name: null, opts: [o] })
    }
  }
  return out
}

// Sets the value the way a person picking it would, so React sees the change.
function choose(sel: HTMLSelectElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
  set?.call(sel, value)
  sel.dispatchEvent(new Event('change', { bubbles: true }))
}

export default function SelectMenus() {
  const [sel, setSel] = useState<HTMLSelectElement | null>(null)
  const anchor = useRef<HTMLElement | null>(null)
  const [folds, setFolds] = useState<string[]>([])
  useEffect(() => {
    const down = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      const s = t?.closest?.('select') as HTMLSelectElement | null
      if (!s || s.multiple || s.disabled || s.size > 1 || e.button !== 0) return
      e.preventDefault()
      s.focus()
      anchor.current = s
      const groups = readGroups(s)
      setFolds(groups.filter((g) => g.name && g.opts.some((o) => o.value === s.value)).map((g) => g.name!))
      setSel((cur) => (cur === s ? null : s))
    }
    window.addEventListener('mousedown', down, true)
    return () => window.removeEventListener('mousedown', down, true)
  }, [])
  if (!sel || !document.contains(sel)) return null
  const groups = readGroups(sel)
  const close = () => setSel(null)
  const pick = (v: string) => { choose(sel, v); close() }
  const item = (o: Opt) => (
    <button key={`${o.value}|${o.label}`} role="menuitem" disabled={o.disabled} className={o.value === sel.value ? 'picked' : ''} onClick={() => pick(o.value)}>
      <span>{o.label}</span>
    </button>
  )
  const width = Math.max(280, sel.getBoundingClientRect().width)
  return (
    <PopMenu anchor={anchor} onClose={close} className="group-pick-list select-menu" width={width}>
      {groups.map((g, i) => {
        if (!g.name) return <div key={`flat${i}`} className="select-flat">{g.opts.map(item)}</div>
        const on = folds.includes(g.name)
        return (
          <div key={g.name} className={`menu-fold${on ? ' open' : ''}`}>
            <button role="menuitem" aria-expanded={on} className="fold-head" onClick={() => setFolds((f) => (f.includes(g.name!) ? f.filter((x) => x !== g.name) : [...f, g.name!]))}>
              <span><i className="fold-arrow" aria-hidden="true">{on ? '▾' : '▸'}</i>{g.name}</span>
              <span className="dim small">{g.opts.length}</span>
            </button>
            {on && <div className="fold-items">{g.opts.map(item)}</div>}
          </div>
        )
      })}
    </PopMenu>
  )
}
