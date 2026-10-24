import { useSyncExternalStore } from 'react'
import { toast } from '../components/Toasts'
import { readSignal } from '../engine/signals'
import { getPlay } from '../create/timeline'
import { addObject, duplicateObject, getSelected3d, getWorld, newObject, removeObject, select3d, updateObject, type ObjKind, type Obj3D, type Vec3 } from './world'

// Your own 3D tools, like the Motion ones: a name, an icon and a little
// JavaScript. "Runs once" tools run when you press them. "Click in the 3D
// view" tools stay picked and run each time you click, with the spot you
// clicked (x, y, z) and the object under it.

export interface Tool3D { id: string; name: string; icon: string; kind: 'action' | 'canvas'; key?: string; code: string }

const KEY = 'rico.3d.tools'
let tools: Tool3D[] = (() => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') } catch { return [] } })()
let active: string | null = null
let v = 0
const ls = new Set<() => void>()
const emit = () => { v++; ls.forEach((l) => l()) }
function save() { try { localStorage.setItem(KEY, JSON.stringify(tools)) } catch { /* not kept */ } emit() }
export function use3dTools() { useSyncExternalStore((l) => { ls.add(l); return () => ls.delete(l) }, () => v); return { tools, active } }
export function put3dTool(t: Tool3D) { const i = tools.findIndex((x) => x.id === t.id); tools = i >= 0 ? tools.map((x) => (x.id === t.id ? t : x)) : [...tools, t]; save() }
export function remove3dTool(id: string) { tools = tools.filter((t) => t.id !== id); if (active === id) active = null; save() }
export function import3dTools(list: Tool3D[]) { for (const t of list) if (t && t.id && t.code) put3dTool({ ...t, kind: t.kind === 'canvas' ? 'canvas' : 'action' }) }
export const active3dTool = () => active
export function pick3dTool(id: string | null) { active = active === id ? null : id; emit() }

export const TOOL3D_TEMPLATE = {
  action: `// Runs once when you press the tool.
// rico.objects(), rico.selected(), rico.add(kind, values), rico.set(id, key, value),
// rico.move(id, x, y, z), rico.turn(id, x, y, z), rico.size(id, s), rico.color(id, '#ff00ff'),
// rico.copy(id), rico.remove(id), rico.select(id), rico.signal(name), rico.time(), rico.toast(text)
// A ring of eight balls around the picked object:
const o = rico.selected()
const [cx, cy, cz] = o ? o.position : [0, 1, 0]
for (let i = 0; i < 8; i++) {
  const a = i / 8 * Math.PI * 2
  rico.add('sphere', { position: [cx + Math.cos(a) * 2, cy, cz + Math.sin(a) * 2], scale: [0.3, 0.3, 0.3] })
}
`,
  canvas: `// Runs each time you click in the 3D view.
// x, y, z: the spot you clicked (on an object or the floor), hit: the object's id (or null).
const id = rico.add('box', { position: [x, y + 0.25, z], scale: [0.5, 0.5, 0.5] })
rico.color(id, '#3bff03')
`,
}

function api() {
  const find = (id: string) => getWorld().objects.find((o) => o.id === id)
  return {
    objects: () => getWorld().objects.map((o) => ({ ...o })),
    selected: (): Obj3D | null => { const id = getSelected3d(); return id ? find(id) ?? null : null },
    add: (kind: string, values: Partial<Obj3D> = {}) => { const o = newObject(kind as ObjKind, values); addObject(o); return o.id },
    set: (id: string, key: string, value: unknown) => updateObject(id, { [key]: value } as Partial<Obj3D>, `Tool: ${key}`),
    move: (id: string, x: number, y: number, z: number) => updateObject(id, { position: [x, y, z] as Vec3 }, 'Tool: move'),
    turn: (id: string, x: number, y: number, z: number) => updateObject(id, { rotation: [x, y, z] as Vec3 }, 'Tool: turn'),
    size: (id: string, s: number | Vec3) => updateObject(id, { scale: (typeof s === 'number' ? [s, s, s] : s) as Vec3 }, 'Tool: size'),
    color: (id: string, c: string) => updateObject(id, { color: c }, 'Tool: color'),
    copy: (id: string) => duplicateObject(id),
    remove: (id: string) => removeObject(id),
    select: (id: string | null) => select3d(id),
    signal: (name: string) => readSignal(name),
    time: () => getPlay().time,
    toast: (text: string) => toast(String(text), true),
  }
}

function run(t: Tool3D, args: Record<string, unknown>) {
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function('rico', ...Object.keys(args), t.code)
    fn(api(), ...Object.values(args))
  } catch (e) {
    toast(`${t.name}: ${(e as Error).message}`)
  }
}
export function run3dAction(id: string) { const t = tools.find((x) => x.id === id); if (t) run(t, {}) }
// From the 3D view: true when a click tool took the click.
export function run3dClick(p: Vec3 | null, hit: string | null): boolean {
  const t = active ? tools.find((x) => x.id === active) : null
  if (!t || t.kind !== 'canvas') return false
  if (!p) { toast('Click on an object or the floor.'); return true }
  run(t, { x: p[0], y: p[1], z: p[2], hit })
  return true
}
