import { useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import RIcon from './RIcons'
import PopMenu from './PopMenu'

// The green tool strip along the top of a workspace: black icons, the
// picked tool turned black. A tool with more choices has a small corner
// triangle; click the triangle (or right-click, or hold) to open them.

export interface ToolChoice { id: string; icon: string; label: string; key?: string; on?: boolean; run: () => void }
export interface ToolItem {
  id: string
  icon: string
  label: string
  key?: string
  on?: boolean
  run: () => void
  more?: ToolChoice[]
  menu?: boolean        // clicking opens the choices (a dropdown), instead of running
  text?: string         // a word instead of the icon (like the stage picker)
  quiet?: boolean       // a small grey button (like the + at the end)
}

export function ToolBtn({ t }: { t: ToolItem }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement | null>(null)
  const hold = useRef(0)
  const [tipAt, setTipAt] = useState<DOMRect | null>(null)
  return (
    <>
      <button ref={ref} className={`ts-btn no-corner${t.on ? ' on' : ''}${t.more ? ' has-more' : ''}${t.menu ? ' is-menu' : ''}${t.text ? ' is-text' : ''}${t.quiet ? ' is-quiet' : ''}`} aria-label={t.label} aria-pressed={t.on}
        onMouseEnter={(e) => setTipAt(e.currentTarget.getBoundingClientRect())} onMouseLeave={() => setTipAt(null)} onFocus={(e) => setTipAt(e.currentTarget.getBoundingClientRect())} onBlur={() => setTipAt(null)}
        onClick={() => { setTipAt(null); if (t.menu && t.more) setOpen(!open); else t.run() }}
        onContextMenu={(e) => { if (t.more) { e.preventDefault(); setOpen(true) } }}
        onPointerDown={() => { if (t.more) hold.current = window.setTimeout(() => setOpen(true), 420) }}
        onPointerUp={() => window.clearTimeout(hold.current)} onPointerLeave={() => window.clearTimeout(hold.current)}>
        {t.text ? <span className="ts-text">{t.text}</span> : <RIcon name={t.icon} size={t.quiet ? 14 : undefined} />}
        {t.menu && <i className="ts-caret" aria-hidden="true" />}
        {t.more && !t.menu && <i className="ts-more" onClick={(e) => { e.stopPropagation(); setOpen(!open) }} aria-hidden="true" />}
      </button>
      {tipAt && !open && createPortal(<Tip at={tipAt} label={t.label} keys={t.key} more={Boolean(t.more) && !t.menu} />, document.body)}
      {open && t.more && (
        <PopMenu anchor={ref} onClose={() => setOpen(false)} className="ts-menu">
          {t.more.map((c) => (
            <button key={c.id} role="menuitem" className={c.on ? 'on' : ''} onClick={() => { c.run(); setOpen(false) }}>
              <RIcon name={c.icon} size={16} /><span>{c.label}</span>{c.key && <kbd>{c.key}</kbd>}
            </button>
          ))}
        </PopMenu>
      )}
    </>
  )
}

// The name of a tool, right away under it (and its key, and if it has more).
export function Tip({ at, label, keys, more }: { at: DOMRect; label: string; keys?: string; more?: boolean }) {
  const left = Math.max(8, Math.min(window.innerWidth - 268, at.left + at.width / 2 - 130))
  return (
    <div className="ts-tip" role="tooltip" style={{ left, top: at.bottom + 6 }}>
      <b>{label}</b>{keys && <kbd>{keys}</kbd>}{more && <span>More choices: the corner, or right-click</span>}
    </div>
  )
}

// A group of tools. Its name is for screen readers; the icons speak for themselves.
// tone: pink for the picking, moving and snapping tools in every strip, so
// they stand apart from the tools of each workspace.
export function ToolGroup({ label, children, tone }: { label?: string; children: ReactNode; tone?: 'pink' }) {
  return <div className={`ts-group${tone ? ` ${tone}` : ''}`} role="group" aria-label={label}>{children}</div>
}

export default function ToolStrip({ children, label }: { children: ReactNode; label: string }) {
  return <div className="tool-strip" role="toolbar" aria-label={label}>{children}</div>
}
