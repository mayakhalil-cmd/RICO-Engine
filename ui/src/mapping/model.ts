import { useSyncExternalStore } from 'react'
import type { Pair, Solved } from './calib'
import { record } from '../shell/history'

// Projection mapping: each output window (a projector) has
// surfaces. A surface takes a picture (Create, a node picture, the 3D scene
// seen from a calibrated projector, a test pattern) and warps it onto a
// shape: four corners, or a grid of points for curved surfaces. Masks
// black out light where it should not go. Everything is in output units:
// 0..1 across the window, y down.
//
// The main window and the output windows share this through the browser
// (localStorage and a BroadcastChannel), so dragging a point in either one
// moves it in both.

export type P2 = [number, number]

export interface Surface {
  id: string
  name: string
  on: boolean
  kind: 'quad' | 'mesh'
  source: string            // 'Create', '3D', 'test', 'solid', or a picture name
  color: string             // for 'solid'
  crop: [number, number, number, number]   // part of the source: u0, v0, u1, v1
  points: P2[]              // quad: 4 (top left, top right, bottom right, bottom left); mesh: cols x rows
  cols: number
  rows: number
  opacity: number
  brightness: number
  contrast: number
  gamma: number
  hue: number
  feather: number           // soft edge, 0..0.2 of the surface
  blend: 'normal' | 'add'
  flipX: boolean
  flipY: boolean
  locked?: boolean         // cannot be moved or deleted by accident
}

export interface Mask {
  id: string
  name: string
  on: boolean
  points: P2[]
  invert: boolean           // invert: only light inside
  feather: number           // pixels
  locked?: boolean
  over?: string             // older files: the surface it sat on (now the layer order says it)
  clip?: boolean            // only the layer right under it (like a clipping mask), not everything under it
}

export interface OutputMap {
  id: string
  surfaces: Surface[]
  masks: Mask[]
  test: boolean
  brightness: number
  softLeft: number
  softRight: number
  softTop: number
  softBottom: number
  softGamma: number
  showPoints: boolean       // show the 3D calibration crosshairs on the projector
  res: [number, number]     // the projector's pixels (the output window size when full screen)
  resFixed?: boolean        // you set the size: the output window does not change it
  order?: string[]          // the layer stack, bottom to top: surface and mask ids mixed, like Photoshop layers
  pairs: Pair[]             // 3D calibration: a point on the object and where it lands in this output
  solved: Solved | null     // the projector, once six or more points are placed
}

// The picture of the 3D scene seen from this projector, once calibrated.
export const projectorPicture = (id: string) => `3D from ${outputName(id)}`
export const outputName = (id: string) => `Output ${id.replace('out', '')}`

const rid = () => Math.random().toString(36).slice(2, 9)

export function quadPoints(x0 = 0.1, y0 = 0.1, x1 = 0.9, y1 = 0.9): P2[] {
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
}
export function meshPoints(cols: number, rows: number, from?: P2[]): P2[] {
  const q = from ?? quadPoints()
  const out: P2[] = []
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const u = c / (cols - 1), v = r / (rows - 1)
    out.push(bilinear(q, u, v))
  }
  return out
}
export function bilinear(q: P2[], u: number, v: number): P2 {
  const top: P2 = [q[0][0] + (q[1][0] - q[0][0]) * u, q[0][1] + (q[1][1] - q[0][1]) * u]
  const bot: P2 = [q[3][0] + (q[2][0] - q[3][0]) * u, q[3][1] + (q[2][1] - q[3][1]) * u]
  return [top[0] + (bot[0] - top[0]) * v, top[1] + (bot[1] - top[1]) * v]
}

export function newSurface(part: Partial<Surface> = {}): Surface {
  return {
    id: rid(), name: 'Surface', on: true, kind: 'quad', source: 'Create', color: '#ffffff', crop: [0, 0, 1, 1],
    points: quadPoints(), cols: 4, rows: 4, opacity: 1, brightness: 1, contrast: 1, gamma: 1, hue: 0, feather: 0,
    blend: 'normal', flipX: false, flipY: false, ...part,
  }
}
export function newMask(part: Partial<Mask> = {}): Mask {
  return { id: rid(), name: 'Mask', on: true, points: [[0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7]], invert: false, feather: 0, ...part }
}
const fresh = (id: string): OutputMap => ({
  id, surfaces: [newSurface({ name: 'Surface 1', points: quadPoints(0, 0, 1, 1) })], masks: [], test: false, brightness: 1,
  softLeft: 0, softRight: 0, softTop: 0, softBottom: 0, softGamma: 2.2, showPoints: false, res: [1920, 1080], pairs: [], solved: null,
})

// ---- storage and sync ----

const key = (id: string) => `rico.mapping.${id}`
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('rico-mapping') : null
const maps = new Map<string, OutputMap>()
let version = 0
const listeners = new Set<() => void>()
const emit = () => { version++; listeners.forEach((l) => l()) }

export function getMap(id: string): OutputMap {
  let m = maps.get(id)
  if (!m) {
    try {
      const raw = JSON.parse(localStorage.getItem(key(id)) ?? 'null')
      // Output windows from before the mapping studio kept corners only.
      if (!raw) {
        const old = JSON.parse(localStorage.getItem(`rico.output.${id}`) ?? 'null')
        m = fresh(id)
        if (old?.corners) {
          const c = old.corners as P2[]
          m.surfaces[0].points = [c[0], c[1], c[3], c[2]]
          m.softLeft = old.softLeft ?? 0
          m.softRight = old.softRight ?? 0
          m.brightness = old.brightness ?? 1
        }
      } else m = { ...fresh(id), ...raw, surfaces: (raw.surfaces ?? []).map((s: Surface) => ({ ...newSurface(), ...s })), masks: raw.masks ?? [] }
    } catch {
      m = fresh(id)
    }
    maps.set(id, m!)
  }
  return m!
}

let saveTimer = 0
function put(id: string, next: OutputMap, broadcast: boolean) {
  maps.set(id, next)
  emit()
  if (broadcast) channel?.postMessage({ id, map: next })
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    try { localStorage.setItem(key(id), JSON.stringify(next)) } catch { /* not remembered */ }
  }, 200)
}
// Every change can be undone. Quick repeated changes (a drag) are one step.
export function setMap(id: string, fn: (m: OutputMap) => OutputMap, broadcast = true, label = 'Change mapping', mergeKey?: string) {
  const before = getMap(id)
  const next = fn(before)
  if (next === before) return
  put(id, next, broadcast)
  if (broadcast) record({ label, key: mergeKey ?? `map.${id}.${label}`, undo: () => put(id, before, true), redo: () => put(id, next, true) })
}
// Changes that are not yours to undo (the projector's pixel size).
export function setMapQuiet(id: string, fn: (m: OutputMap) => OutputMap) { put(id, fn(getMap(id)), true) }
channel?.addEventListener('message', (e: MessageEvent<{ id: string; map: OutputMap }>) => {
  if (!e.data?.id) return
  maps.set(e.data.id, e.data.map)
  emit()
})

// Output ids that have a mapping saved in this browser profile.
export function knownOutputs(): string[] {
  const ids = new Set<string>(maps.keys())
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) ?? ''
      // only outputs: other mapping settings (sections, photo corners) have a dot in their name
      if (k.startsWith('rico.mapping.') && !k.slice(13).includes('.')) ids.add(k.slice(13))
    }
  } catch { /* no storage */ }
  return [...ids].sort()
}

// Changes when any output's mapping changes.
export function useMapVersion(): number {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => version)
}

export function useMap(id: string): OutputMap {
  useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => version)
  return getMap(id)
}

export const updateSurface = (out: string, sid: string, part: Partial<Surface>) =>
  setMap(out, (m) => ({ ...m, surfaces: m.surfaces.map((s) => (s.id === sid ? { ...s, ...part } : s)) }))
export const updateMask = (out: string, mid: string, part: Partial<Mask>) =>
  setMap(out, (m) => ({ ...m, masks: m.masks.map((s) => (s.id === mid ? { ...s, ...part } : s)) }))

// The outline of a surface in output units (for drawing, picking and gobos).
export function outline(s: Surface): P2[] {
  if (s.kind === 'quad') return s.points
  const out: P2[] = []
  const at = (c: number, r: number) => s.points[r * s.cols + c]
  for (let c = 0; c < s.cols; c++) out.push(at(c, 0))
  for (let r = 1; r < s.rows; r++) out.push(at(s.cols - 1, r))
  for (let c = s.cols - 2; c >= 0; c--) out.push(at(c, s.rows - 1))
  for (let r = s.rows - 2; r > 0; r--) out.push(at(0, r))
  return out
}

// ---- the layer stack ----

export interface StackItem { kind: 'surface' | 'mask'; id: string }

// Surfaces and masks in one stack, bottom to top. Things that are not in the
// saved order yet go on top (a new mask covers everything, as you would expect).
export function stackOf(m: OutputMap): StackItem[] {
  const kinds = new Map<string, StackItem['kind']>([...m.surfaces.map((s) => [s.id, 'surface'] as const), ...m.masks.map((k) => [k.id, 'mask'] as const)])
  let base: string[]
  if (m.order?.length) base = m.order.filter((id) => kinds.has(id))
  else {
    // older files: masks after the surface they sat on, the rest on top, '-' at the bottom
    base = m.masks.filter((k) => k.over === '-').map((k) => k.id)
    for (const s of m.surfaces) { base.push(s.id); for (const k of m.masks) if (k.over === s.id) base.push(k.id) }
  }
  const seen = new Set(base)
  for (const s of m.surfaces) if (!seen.has(s.id)) { base.push(s.id); seen.add(s.id) }
  for (const k of m.masks) if (!seen.has(k.id)) { base.push(k.id); seen.add(k.id) }
  return base.map((id) => ({ kind: kinds.get(id)!, id }))
}

// Moves a layer to sit right above (or below) another one in the stack.
export function moveInStack(m: OutputMap, id: string, ref: string, place: 'above' | 'below'): OutputMap {
  const ids = stackOf(m).map((x) => x.id).filter((x) => x !== id)
  const at = ids.indexOf(ref)
  if (at < 0) return m
  ids.splice(place === 'above' ? at + 1 : at, 0, id)
  return { ...m, order: ids }
}

// What each mask darkens, from the stack: a mask covers every surface under
// it (it is applied right after the surface under it is drawn), or, clipped,
// only the surface right under it. Masks with nothing under them do nothing.
export function maskLayers(m: OutputMap): Map<string, Mask[]> {
  const out = new Map<string, Mask[]>()
  let below: string | null = null
  for (const it of stackOf(m)) {
    if (it.kind === 'surface') { below = it.id; continue }
    const k = m.masks.find((x) => x.id === it.id)!
    if (!below || k.clip) continue
    const l = out.get(below); if (l) l.push(k); else out.set(below, [k])
  }
  return out
}
export function clipLayers(m: OutputMap): Map<string, Mask[]> {
  const out = new Map<string, Mask[]>()
  let below: string | null = null
  for (const it of stackOf(m)) {
    if (it.kind === 'surface') { below = it.id; continue }
    const k = m.masks.find((x) => x.id === it.id)!
    if (!below || !k.clip) continue
    const l = out.get(below); if (l) l.push(k); else out.set(below, [k])
  }
  return out
}
// The surfaces in the order they are drawn (bottom first).
export function surfacesInOrder(m: OutputMap): Surface[] {
  return stackOf(m).filter((x) => x.kind === 'surface').map((x) => m.surfaces.find((s) => s.id === x.id)!)
}

// ---- lining up: snap a picked surface or mask to the output ----

export type Align = 'center' | 'fill' | 'fit' | 'left' | 'right' | 'top' | 'bottom' | 'hcenter' | 'vcenter'
export function alignPoints(pts: P2[], how: Align): P2[] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
  const w = x1 - x0 || 1e-6, h = y1 - y0 || 1e-6
  const move = (dx: number, dy: number) => pts.map(([x, y]) => [x + dx, y + dy] as P2)
  switch (how) {
    case 'center': return move(0.5 - (x0 + x1) / 2, 0.5 - (y0 + y1) / 2)
    case 'hcenter': return move(0.5 - (x0 + x1) / 2, 0)
    case 'vcenter': return move(0, 0.5 - (y0 + y1) / 2)
    case 'left': return move(-x0, 0)
    case 'right': return move(1 - x1, 0)
    case 'top': return move(0, -y0)
    case 'bottom': return move(0, 1 - y1)
    case 'fill': return pts.map(([x, y]) => [(x - x0) / w, (y - y0) / h] as P2)
    case 'fit': {
      // as big as it goes without changing its shape, in the middle
      const f = Math.min(1 / w, 1 / h)
      return pts.map(([x, y]) => [0.5 + (x - (x0 + x1) / 2) * f, 0.5 + (y - (y0 + y1) / 2) * f] as P2)
    }
  }
}

// ---- homography: maps the unit square to four points (perspective-correct quads) ----
export function homography(q: P2[]): number[] {
  // Square (0,0) (1,0) (1,1) (0,1) to q[0..3].
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2
  const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3
  const den = dx1 * dy2 - dx2 * dy1 || 1e-12
  const g = (sx * dy2 - dx2 * sy) / den, h = (dx1 * sy - sx * dy1) / den
  return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1]
}
export function applyH(H: number[], u: number, v: number): P2 {
  const w = H[6] * u + H[7] * v + H[8]
  return [(H[0] * u + H[1] * v + H[2]) / w, (H[3] * u + H[4] * v + H[5]) / w]
}

// Smooth mesh: Catmull-Rom through the grid points.
function cr(p0: number, p1: number, p2: number, p3: number, t: number) {
  const t2 = t * t, t3 = t2 * t
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
}
export function meshAt(s: Surface, u: number, v: number): P2 {
  const cx = u * (s.cols - 1), cy = v * (s.rows - 1)
  const c = Math.min(s.cols - 2, Math.floor(cx)), r = Math.min(s.rows - 2, Math.floor(cy))
  const tu = cx - c, tv = cy - r
  const P = (cc: number, rr: number) => s.points[Math.max(0, Math.min(s.rows - 1, rr)) * s.cols + Math.max(0, Math.min(s.cols - 1, cc))]
  const row = (rr: number, k: 0 | 1) => cr(P(c - 1, rr)[k], P(c, rr)[k], P(c + 1, rr)[k], P(c + 2, rr)[k], tu)
  const out: P2 = [0, 0]
  for (const k of [0, 1] as const) out[k] = cr(row(r - 1, k), row(r, k), row(r + 1, k), row(r + 2, k), tv)
  return out
}
export function warp(s: Surface, u: number, v: number, H?: number[]): P2 {
  return s.kind === 'quad' ? applyH(H ?? homography(s.points), u, v) : meshAt(s, u, v)
}

// ---- the stack as Photoshop shows it: each surface with its clipped masks under it ----

export interface StackGroup { head: StackItem; clips: string[] }   // clips: bottom first

// Bottom first. A clipped mask belongs to the surface right under it in the
// stack; other masks (and clipped masks with no surface under them) stand alone.
export function stackGroups(m: OutputMap): StackGroup[] {
  const out: StackGroup[] = []
  const clip = new Set(m.masks.filter((k) => k.clip).map((k) => k.id))
  for (const it of stackOf(m)) {
    const last = out[out.length - 1]
    if (it.kind === 'mask' && clip.has(it.id) && last && last.head.kind === 'surface') last.clips.push(it.id)
    else out.push({ head: it, clips: [] })
  }
  return out
}
export const orderOfGroups = (groups: StackGroup[]): string[] => groups.flatMap((g) => [g.head.id, ...g.clips])

// Moves a whole group (a surface and its masks) one step up or down.
export function stepGroup(m: OutputMap, id: string, d: 1 | -1): OutputMap {
  const gs = stackGroups(m)
  const gi = gs.findIndex((g) => g.head.id === id)
  if (gi >= 0) {
    const j = gi + d
    if (j < 0 || j >= gs.length) return m
    ;[gs[gi], gs[j]] = [gs[j], gs[gi]]
    return { ...m, order: orderOfGroups(gs) }
  }
  // a clipped mask moves among the masks of its surface
  const g = gs.find((x) => x.clips.includes(id))
  if (!g) return m
  const i = g.clips.indexOf(id), j = i + d
  if (j < 0 || j >= g.clips.length) return m
  ;[g.clips[i], g.clips[j]] = [g.clips[j], g.clips[i]]
  return { ...m, order: orderOfGroups(gs) }
}

// Puts a mask under a surface (clipped to it), like dropping a mask on a layer.
export function attachMask(m: OutputMap, maskId: string, surfaceId: string): OutputMap {
  const gs = stackGroups({ ...m, masks: m.masks.map((k) => (k.id === maskId ? { ...k, clip: false } : k)) }).filter((g) => g.head.id !== maskId)
  for (const g of gs) g.clips = g.clips.filter((x) => x !== maskId)
  const g = gs.find((x) => x.head.id === surfaceId)
  if (!g) return m
  g.clips.push(maskId)
  return { ...m, order: orderOfGroups(gs), masks: m.masks.map((k) => (k.id === maskId ? { ...k, clip: true } : k)) }
}

// Moves a group (or a lone mask) above or below another group.
export function moveGroup(m: OutputMap, id: string, ref: string, place: 'above' | 'below'): OutputMap {
  const gs = stackGroups(m)
  let moving = gs.find((g) => g.head.id === id)
  if (!moving) {
    // a clipped mask dragged out of its surface stands alone
    for (const g of gs) g.clips = g.clips.filter((x) => x !== id)
    moving = { head: { kind: 'mask', id }, clips: [] }
    m = { ...m, masks: m.masks.map((k) => (k.id === id ? { ...k, clip: false } : k)) }
  }
  const rest = gs.filter((g) => g !== moving)
  const at = rest.findIndex((g) => g.head.id === ref || g.clips.includes(ref))
  if (at < 0) return m
  rest.splice(place === 'above' ? at + 1 : at, 0, moving)
  return { ...m, order: orderOfGroups(rest) }
}
