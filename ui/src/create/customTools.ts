import { useSyncExternalStore } from 'react'
import { toast } from '../components/Toasts'
import { readSignal } from '../engine/signals'
import { insertLayer, newShape, newSolid, newText, updateLayer } from './ops'
import { newLayer, type Layer } from './scene'
import { changeScene, getCreate, select } from './store'
import { getPlay } from './timeline'

// Your own Motion tools. A tool has a name, an icon (one of RICO's or your
// own picture), and a little JavaScript. An "action" tool runs once when you
// press it. A "canvas" tool is picked like Select or Pen, and runs when you
// click or drag on the picture, with x and y where you clicked.
// Tools are kept in this browser profile and can be saved to a file to share.

export interface CustomTool { id: string; name: string; icon: string; kind: 'action' | 'canvas'; key?: string; code: string }

const KEY = 'rico.motion.tools'
let tools: CustomTool[] = (() => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') } catch { return [] } })()
let v = 0
const ls = new Set<() => void>()
function save() { try { localStorage.setItem(KEY, JSON.stringify(tools)) } catch { /* not kept */ } v++; ls.forEach((l) => l()) }
export const getCustomTools = () => tools
export function useCustomTools() { useSyncExternalStore((l) => { ls.add(l); return () => ls.delete(l) }, () => v); return tools }
export function putTool(t: CustomTool) { const i = tools.findIndex((x) => x.id === t.id); tools = i >= 0 ? tools.map((x) => (x.id === t.id ? t : x)) : [...tools, t]; save() }
export function removeTool(id: string) { tools = tools.filter((t) => t.id !== id); save() }
export function importTools(list: CustomTool[]) { for (const t of list) if (t && t.id && t.code) putTool({ ...t, kind: t.kind === 'canvas' ? 'canvas' : 'action' }) }

export const TOOL_TEMPLATE = {
  action: `// Runs once when you press the tool.
// rico.layers(), rico.selected(), rico.add(type, values), rico.solid(color),
// rico.text(words), rico.shape(kind, w, h, x, y), rico.set(id, key, value),
// rico.move(id, x, y), rico.select(id), rico.signal(name), rico.time(), rico.toast(text)
const l = rico.selected()
if (!l) return rico.toast('Pick a layer first')
rico.set(l.id, 'opacity', 0.5)
`,
  canvas: `// Runs when you click or drag on the picture.
// x and y: where (0, 0 is the middle, y goes up), phase: 'down', 'drag' or 'up'.
if (phase !== 'down') return
for (let i = 0; i < 8; i++) {
  const a = i / 8 * Math.PI * 2
  const id = rico.shape(1, 0.04, 0.04, x + Math.cos(a) * 0.12, y + Math.sin(a) * 0.12)
}
`,
}

function api() {
  const scene = () => getCreate().scene
  return {
    layers: () => scene().layers.map((l) => ({ ...l })),
    selected: (): Layer | null => scene().layers.find((l) => l.id === getCreate().selected) ?? null,
    add: (type: string, values: Record<string, number | string> = {}) => { const l = newLayer(type); l.values = { ...l.values, ...values }; return insertLayer(l) },
    solid: (color?: string) => newSolid(color),
    text: (words?: string) => newText(words),
    shape: (kind = 0, w = 0.3, h = 0.3, x = 0, y = 0) => newShape(kind, w, h, x, y),
    set: (id: string, key: string, value: number | string) => updateLayer(id, `Tool: ${key}`, (l) => (key === 'opacity' && typeof value === 'number' ? { ...l, opacity: value } : { ...l, values: { ...l.values, [key]: value } })),
    move: (id: string, x: number, y: number) => updateLayer(id, 'Tool: move', (l) => ({ ...l, values: { ...l.values, tr_px: x, tr_py: y } })),
    select: (id: string | null) => select(id),
    signal: (name: string) => readSignal(name),
    time: () => getPlay().time,
    scene: () => ({ width: scene().width, height: scene().height, name: scene().name }),
    rename: (name: string) => changeScene('Tool: rename', (s) => ({ ...s, name })),
    toast: (text: string) => toast(String(text), true),
  }
}

function run(t: CustomTool, args: Record<string, unknown>) {
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function('rico', ...Object.keys(args), t.code)
    fn(api(), ...Object.values(args))
  } catch (e) {
    toast(`${t.name}: ${(e as Error).message}`)
  }
}

export function runActionTool(id: string) { const t = tools.find((x) => x.id === id); if (t) run(t, {}) }
export function runCanvasTool(id: string, x: number, y: number, phase: 'down' | 'drag' | 'up') { const t = tools.find((x2) => x2.id === id); if (t) run(t, { x, y, phase }) }
