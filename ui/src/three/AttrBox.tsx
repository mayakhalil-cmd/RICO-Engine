import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import Icon from '../components/Icon'
import RIcon from '../components/RIcons'
import { KeyRow3d } from '../sections/KeyControls'
import { animatables } from './keyed'
import { DeformEditor, FluidEditor, Group, PhysicsEditor, PoseEditor } from './RigPanels'
import { getSelected3d, getWorld, useWorld } from './world'

// The property box, like Maya's attribute editor: a window over the 3D view
// with everything of the picked object you can change, each with its own
// keys. Tools in the strip (deform, morph, physics, liquid, fog, looks) open
// it at their part. Drag it by its top; it remembers where you left it.

type Part = 'Object' | 'Deform' | 'Morph' | 'Physics' | 'Liquid' | 'Fog' | 'Look layers' | null
let open = false
let focus: Part = null
let v = 0
const ls = new Set<() => void>()
const emit = () => { v++; ls.forEach((l) => l()) }
export function openAttr(part: Part = null) { open = true; focus = part; emit() }
export function closeAttr() { open = false; emit() }
export const attrOpen = () => open

const ICON: Record<string, string> = { Object: 'move', Deform: 'bend', Morph: 'morph', Physics: 'physics', Liquid: 'fluid', Fog: 'fluid', 'Look layers': 'texturing' }

export default function AttrBox() {
  useSyncExternalStore((l) => { ls.add(l); return () => ls.delete(l) }, () => v)
  const sel = useWorld(() => getSelected3d())
  useWorld((w) => w.objects)
  const [at, setAt] = useState<[number, number]>(() => { try { return JSON.parse(localStorage.getItem('rico.3d.attrbox') ?? '') } catch { return [window.innerWidth - 420, 140] } })
  const box = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open || !focus) return
    const t = window.setTimeout(() => box.current?.querySelector(`[data-part="${focus}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60)
    return () => window.clearTimeout(t)
  }, [v])  // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null
  const w = getWorld()
  const o = sel ? w.objects.find((x) => x.id === sel) : undefined
  const drag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    const x0 = e.clientX - at[0], y0 = e.clientY - at[1]
    let last = at
    const move = (ev: PointerEvent) => { last = [Math.max(0, Math.min(window.innerWidth - 120, ev.clientX - x0)), Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - y0))]; setAt(last) }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); try { localStorage.setItem('rico.3d.attrbox', JSON.stringify(last)) } catch { /* not kept */ } }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const all = o ? animatables(o, w) : []
  const groups = [...new Set(all.map((a) => a.group))]
  return createPortal(
    <div ref={box} className="attr-box" style={{ left: at[0], top: at[1] }} role="dialog" aria-label="Properties">
      <div className="attr-head" onPointerDown={drag}>
        <RIcon name="settings" size={14} />
        <b>{o ? o.name : 'Properties'}</b>
        <span className="grow" />
        <span className="dim small">diamonds put keys</span>
        <button className="icon-btn small" title="Close (Esc)" onClick={closeAttr}><Icon name="x" /></button>
      </div>
      <div className="attr-body">
        {!o && <p className="dim small">Click something in the 3D view.</p>}
        {o && <>
          {groups.includes('Object') && (
            <div data-part="Object"><Group icon="move" title="Place, turn, size" open={focus === null || focus === 'Object'}>
              {all.filter((a) => a.group === 'Object').map((a) => <KeyRow3d key={a.key} o={o} an={a} />)}
            </Group></div>
          )}
          {(o.deform?.length || o.morph) ? <div data-part={focus === 'Morph' ? 'Morph' : 'Deform'}><DeformEditor o={o} /></div> : null}
          <PoseEditor o={o} />
          {o.physics && <div data-part="Physics"><PhysicsEditor o={o} /></div>}
          {o.kind === 'fluid' && <div data-part="Liquid"><FluidEditor o={o} /></div>}
          {(['Fog', 'Look layers'] as const).filter((g) => groups.includes(g)).map((g) => (
            <div key={g} data-part={g}><Group icon={ICON[g]} title={g} open={focus === g || focus === null}>
              {all.filter((a) => a.group === g).map((a) => <KeyRow3d key={a.key} o={o} an={a} />)}
            </Group></div>
          ))}
          {!o.deform?.length && !o.morph && !o.physics && <p className="dim small">Add deform, morph, physics or a look with the tools in the strip: their settings show up here.</p>}
        </>}
      </div>
    </div>,
    document.body,
  )
}
