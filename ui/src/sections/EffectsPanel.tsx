import { useState } from 'react'
import RIcon from '../components/RIcons'
import { EFFECT_GROUPS, EFFECT_TYPES } from '../create/effects'
import { LAYER_TYPES } from '../create/layers'
import { addEffect } from '../create/ops'
import { STARTERS } from '../create/scene'
import { getCreate, replaceScene, useCreate } from '../create/store'
import { addLayer } from './Create'

// Effects and presets: every effect by group, the layers you can make, and
// ready-made scenes. Click to add to the picked layer (or to the whole
// composition when no layer is picked). Type to find one.

export default function EffectsPanel() {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem('rico.fxp.open') ?? '{}') } catch { return {} } })
  const selected = useCreate((s) => s.selected)
  const layer = useCreate((s) => s.scene.layers.find((l) => l.id === s.selected))
  const toggle = (k: string) => { const next = { ...open, [k]: !open[k] }; setOpen(next); try { localStorage.setItem('rico.fxp.open', JSON.stringify(next)) } catch { /* not kept */ } }
  const f = q.trim().toLowerCase()
  const hit = (s: string) => !f || s.toLowerCase().includes(f)
  const groups: { key: string; title: string; icon: string; items: { id: string; name: string; about: string; run: () => void }[] }[] = [
    ...EFFECT_GROUPS.map((g) => ({
      key: `fx.${g}`, title: g, icon: 'fx',
      items: EFFECT_TYPES.filter((e) => e.group === g).map((e) => ({ id: e.id, name: e.name, about: e.about, run: () => addEffect(getCreate().selected ?? 'master', e.id) })),
    })),
    { key: 'layers', title: 'New layers', icon: 'newLayer', items: LAYER_TYPES.map((t) => ({ id: t.id, name: t.name, about: t.about, run: () => addLayer(t.id) })) },
    { key: 'starters', title: 'Ready-made scenes', icon: 'comp', items: STARTERS.map((s) => ({ id: s.id, name: s.name, about: 'Replaces the composition (Ctrl+Z brings it back)', run: () => replaceScene(s.make(), `Starter: ${s.name}`) })) },
  ]
  return (
    <div className="dpanel fxp" data-keyscope="create">
      <div className="fxp-search">
        <RIcon name="zoom" size={14} />
        <input className="input" placeholder="Find an effect or layer" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find" />
      </div>
      <p className="dim small fxp-to">Adds to: <b>{selected && layer ? layer.name : 'the whole composition'}</b></p>
      {groups.map((g) => {
        const items = g.items.filter((x) => hit(x.name) || hit(g.title))
        if (!items.length) return null
        const shown = f ? true : open[g.key]
        return (
          <section key={g.key} className="fxp-group">
            <button className={`fxp-head no-corner${shown ? ' open' : ''}`} onClick={() => toggle(g.key)}>
              <i className="fxp-twirl" aria-hidden="true">{shown ? '▾' : '▸'}</i><RIcon name={g.icon} size={14} /><span>{g.title}</span><span className="dim small">{items.length}</span>
            </button>
            {shown && <ul>{items.map((x) => <li key={x.id}><button className="fxp-item no-corner" title={x.about} onClick={x.run}><RIcon name={g.icon === 'fx' ? 'fx' : g.icon} size={12} />{x.name}</button></li>)}</ul>}
          </section>
        )
      })}
    </div>
  )
}
