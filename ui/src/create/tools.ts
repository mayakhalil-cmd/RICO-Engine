import { useSyncExternalStore } from 'react'
import { setSnap } from '../shell/snap'

// The Motion tool you are using, shared by the tool strip, the picture and
// the keys: V select, H hand, Z zoom, Y anchor, Q shape (Q again for the
// next shape), G pen, T text, and your own tools ("custom:<id>").

export type Tool = 'v' | 'y' | 'q' | 'g' | 'h' | 'z' | 't' | `custom:${string}`
export const SHAPES = ['Rectangle', 'Ellipse', 'Polygon', 'Star']
export const SHAPE_ICON = ['rect', 'ellipse', 'polygon', 'star']

const ts = { tool: 'v' as Tool, shape: 0, pen: false, finish: 0 }
let tv = 0
const tl = new Set<() => void>()
export function setTools(part: Partial<typeof ts>) { Object.assign(ts, part); tv++; tl.forEach((l) => l()) }
export function useTools() { useSyncExternalStore((l) => { tl.add(l); return () => tl.delete(l) }, () => tv); return ts }
export const getTools = () => ts
export function chooseTool(t: Tool | 'w') {
  if (t === 'w') { setSnap('motion', { handles: 'rotate' }); return setTools({ tool: 'v' }) }
  if (t === 'q' && ts.tool === 'q') return setTools({ shape: (ts.shape + 1) % SHAPES.length })
  setTools({ tool: t, ...(t !== 'g' ? { finish: ts.finish + 1 } : {}) })
}
