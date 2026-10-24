import { Suspense, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import Icon from '../components/Icon'
import PopMenu from '../components/PopMenu'
import { PANELS } from '../shell/panels'

// Tabs along the right edge of the 3D view. View options are there to start;
// the + adds any other 3D panel (the scene, object settings...) as a tab, so
// it opens over the view without changing the layout. Tabs show as words or
// as icons.

export interface SideState { tabs: string[]; style: 'text' | 'icons'; open: string | null }
const KEY = 'rico.3d.sidetabs'
let st: SideState = (() => {
  try { return { tabs: ['view'], style: 'text', open: null, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') } as SideState } catch { return { tabs: ['view'], style: 'text', open: null } }
})()
// the old single tab remembered whether it was open
try { if (localStorage.getItem('rico.3d.viewtab') === '1' && st.open === null) st = { ...st, open: 'view' } } catch { /* fine */ }
let v = 0
const ls = new Set<() => void>()
const set = (part: Partial<SideState>) => { st = { ...st, ...part }; try { localStorage.setItem(KEY, JSON.stringify(st)) } catch { /* not kept */ } v++; ls.forEach((l) => l()) }
export function useSideTabs(): SideState { useSyncExternalStore((l) => { ls.add(l); return () => ls.delete(l) }, () => v); return st }

const ICONS: Record<string, string> = { view: 'eye', '3d-outliner': 'folder', '3d-props': 'settings', '3d-timeline': 'stopwatch' }
const CHOICES = () => [{ id: 'view', title: 'View options' }, ...PANELS.filter((p) => p.group === '3D' && p.id !== '3d-view').map((p) => ({ id: p.id, title: p.id === '3d-props' ? 'Object settings' : p.title }))]

export function SideTabs({ side, viewTab }: { side: SideState; viewTab: ReactNode }) {
  const [adding, setAdding] = useState(false)
  const plus = useRef<HTMLButtonElement | null>(null)
  const choices = CHOICES()
  const titleOf = (id: string) => choices.find((c) => c.id === id)?.title ?? id
  useEffect(() => { if (side.open && !side.tabs.includes(side.open)) set({ open: null }) }, [side.open, side.tabs])
  const content = side.open === 'view' ? viewTab : side.open ? PANELS.find((p) => p.id === side.open)?.render() : null
  return (
    <div className={`vg-side${side.open ? ' open' : ''}`}>
      <div className={`vg-rail ${side.style}`} role="tablist" aria-label="Side tabs">
        {side.tabs.map((id) => (
          <button key={id} role="tab" aria-selected={side.open === id} className={`vg-tab no-corner${side.open === id ? ' on' : ''}`} title={titleOf(id)}
            onClick={() => set({ open: side.open === id ? null : id })}>
            {side.style === 'icons' ? <Icon name={ICONS[id] ?? 'create'} /> : <span>{titleOf(id)}</span>}
          </button>
        ))}
        <button ref={plus} className="vg-tab vg-plus no-corner" title="Add or remove side tabs" aria-label="Side tabs" onClick={() => setAdding(!adding)}><Icon name="plus" /></button>
        {adding && (
          <PopMenu anchor={plus} onClose={() => setAdding(false)} className="vg-add">
            <div className="menu-head">Side tabs</div>
            {choices.map((c) => {
              const on = side.tabs.includes(c.id)
              return (
                <button key={c.id} role="menuitemcheckbox" aria-checked={on} onClick={() => set({ tabs: on ? side.tabs.filter((x) => x !== c.id) : [...side.tabs, c.id] })}>
                  <span>{c.title}</span><span className="dim">{on ? 'on' : ''}</span>
                </button>
              )
            })}
            <hr />
            <div className="menu-head">Show tabs as</div>
            <button role="menuitemradio" aria-checked={side.style === 'text'} onClick={() => set({ style: 'text' })}><span>Words</span><span className="dim">{side.style === 'text' ? 'on' : ''}</span></button>
            <button role="menuitemradio" aria-checked={side.style === 'icons'} onClick={() => set({ style: 'icons' })}><span>Icons</span><span className="dim">{side.style === 'icons' ? 'on' : ''}</span></button>
          </PopMenu>
        )}
      </div>
      {content && <div className={`vg-drawer${side.open === 'view' ? ' small' : ''}`}><Suspense fallback={null}>{content}</Suspense></div>}
    </div>
  )
}
