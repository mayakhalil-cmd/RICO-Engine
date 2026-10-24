import { useSyncExternalStore } from 'react'

// Snapping and which handles the gizmo shows, for everything you place by
// hand: 3D objects, Motion layers and projection mapping. Each place has its
// own steps (meters in 3D, pixels on pictures), and you pick one from a list,
// with snapping for moving, turning and sizing switched on and off apart.

export type Place = '3d' | 'motion' | 'mapping'
export type Handles = 'move' | 'rotate' | 'scale' | 'all'
export interface Snap { move: boolean; moveStep: number; rot: boolean; rotStep: number; size: boolean; sizeStep: number; handles: Handles; edges?: boolean }

export const MOVE_STEPS: Record<Place, number[]> = {
  '3d': [0.01, 0.05, 0.1, 0.25, 0.5, 1, 5, 10],
  motion: [1, 5, 10, 25, 50, 100],
  mapping: [1, 5, 10, 25, 50, 100],
}
export const ROT_STEPS = [1, 5, 10, 15, 22.5, 30, 45, 90]
export const SIZE_STEPS = [0.01, 0.05, 0.1, 0.25, 0.5, 1]
export const UNIT: Record<Place, string> = { '3d': 'm', motion: 'px', mapping: 'px' }

const DEFAULT: Record<Place, Snap> = {
  '3d': { move: false, moveStep: 0.1, rot: false, rotStep: 15, size: false, sizeStep: 0.1, handles: 'move' },
  motion: { move: false, moveStep: 10, rot: false, rotStep: 15, size: false, sizeStep: 0.1, handles: 'all' },
  mapping: { move: false, moveStep: 10, rot: false, rotStep: 15, size: false, sizeStep: 0.1, handles: 'move', edges: true },
}
const KEY = 'rico.snap'
let state: Record<Place, Snap> = (() => {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? 'null'); return { '3d': { ...DEFAULT['3d'], ...v?.['3d'] }, motion: { ...DEFAULT.motion, ...v?.motion }, mapping: { ...DEFAULT.mapping, ...v?.mapping } } } catch { return { ...DEFAULT } }
})()
let version = 0
const listeners = new Set<() => void>()

export const getSnap = (p: Place) => state[p]
export function setSnap(p: Place, part: Partial<Snap>) {
  state = { ...state, [p]: { ...state[p], ...part } }
  version++
  listeners.forEach((l) => l())
  try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* not remembered */ }
}
export function onSnap(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } }
export function useSnap(p: Place): Snap {
  useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => version)
  return state[p]
}

// Round to the step when that kind of snapping is on (Ctrl flips it while you drag).
export const snapTo = (v: number, step: number, on: boolean) => (on && step > 0 ? Math.round(v / step) * step : v)
