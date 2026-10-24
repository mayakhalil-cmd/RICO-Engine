import { useMemo, useState } from 'react'
import { PANELS } from './panels'
import { TEMPLATES, newScript, useScripts } from './scripts'
import { newGraph, useGraphs } from '../nodes/store'

// The library of everything that can go in a workspace: the built-in
// panels, your scripts, and script templates for new protocols. Items can be
// clicked or dragged into place.

export const PANEL_DRAG = 'application/x-rico-panel'

// Turns a pick into a panel id: built-in ids stay as they are, scripts
// become "script-<id>", templates make a new script first.
export function resolvePick(pick: string): string {
  if (pick === 'new-nodes') return `nodes-${newGraph('Node network').id}`
  if (pick.startsWith('new:')) {
    const t = TEMPLATES.find((x) => x.id === pick.slice(4)) ?? TEMPLATES[0]
    const s = newScript(t.id === 'blank' ? 'My script' : t.name, t.code)
    return `script-${s.id}`
  }
  return pick
}

interface Props {
  onPick: (pick: string) => void
  selected?: string[]       // multi-select mode: shows checks
  compact?: boolean
  autoFocus?: boolean
}

export default function PanelPicker({ onPick, selected, compact, autoFocus }: Props) {
  const [q, setQ] = useState('')
  const scripts = useScripts()
  const graphs = useGraphs()
  const groups = useMemo(() => {
    const query = q.trim().toLowerCase()
    const match = (...s: string[]) => !query || s.some((x) => x.toLowerCase().includes(query))
    const out: { name: string; items: { pick: string; title: string; about: string }[] }[] = []
    for (const p of PANELS) {
      if (!match(p.title, p.group, p.about)) continue
      let g = out.find((x) => x.name === p.group)
      if (!g) out.push((g = { name: p.group, items: [] }))
      g.items.push({ pick: p.id, title: p.title, about: p.about })
    }
    const nets = graphs.filter((g) => !g.inside && match(g.name, 'nodes network')).map((g) => ({ pick: `nodes-${g.id}`, title: g.name, about: `Node network, ${g.nodes.length} nodes` }))
    if (match('new node network nodes patch')) nets.push({ pick: 'new-nodes', title: 'New node network', about: 'Wire sources, shapers and outputs together' })
    if (nets.length) out.push({ name: 'Nodes', items: nets })
    const mine = scripts.filter((s) => match(s.name, 'script')).map((s) => ({ pick: `script-${s.id}`, title: s.name, about: 'Your script' }))
    if (mine.length) out.push({ name: 'Your scripts', items: mine })
    const temps = TEMPLATES.filter((t) => match(t.name, t.about, 'script new protocol code')).map((t) => ({ pick: `new:${t.id}`, title: t.name, about: t.about }))
    if (temps.length) out.push({ name: 'New script', items: temps })
    return out
  }, [q, scripts, graphs])

  return (
    <div className={`picker${compact ? ' compact' : ''}`}>
      <input
        className="input picker-search"
        placeholder="Find a panel, or type script"
        value={q}
        autoFocus={autoFocus}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const first = groups[0]?.items[0]
            if (first) onPick(first.pick)
          }
        }}
      />
      <div className="picker-groups">
        {groups.map((g) => (
          <section key={g.name} className="picker-group">
            <h4 className={g.name === 'New script' || g.name === 'Your scripts' || g.name === 'Nodes' ? 'script-group' : ''}>{g.name}</h4>
            <div className="picker-items">
              {g.items.map((it) => {
                const on = selected?.includes(it.pick)
                return (
                  <button
                    key={it.pick}
                    className={`picker-item${on ? ' on' : ''}`}
                    draggable={!selected}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(PANEL_DRAG, it.pick)
                      e.dataTransfer.effectAllowed = 'copy'
                    }}
                    onClick={() => onPick(it.pick)}
                    title={it.about}
                  >
                    <span className="picker-title">{selected && <i className="check" aria-hidden="true">{on ? '■' : '□'}</i>}{it.title}</span>
                    {!compact && <span className="picker-about">{it.about}</span>}
                  </button>
                )
              })}
            </div>
          </section>
        ))}
        {groups.length === 0 && <p className="dim small">Nothing matches "{q}".</p>}
      </div>
    </div>
  )
}
