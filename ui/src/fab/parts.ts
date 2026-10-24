import { useSyncExternalStore } from 'react'
import * as THREE from 'three'
import { goboGeometry } from '../mapping/gobo'
import { getGobos, goboPlan, onGobos, type Gobo } from '../mapping/gobos'

// What goes on the print bed: your gobos (always up to date with the gobo
// maker) and STL files you open. Parts are placed for you, or where you drag them.

export interface BedPart {
  id: string              // the gobo id, or a file id
  name: string
  kind: 'gobo' | 'file'
  on: boolean
  flip: boolean           // upside down (a gobo prints best with the plate on the bed)
  turn: number            // degrees around up
  scale: number           // %
  at: [number, number] | null   // mm on the bed, null: placed for you
}

const files = new Map<string, THREE.BufferGeometry>()
let parts: Record<string, BedPart> = {}
try { parts = JSON.parse(localStorage.getItem('rico.bed') ?? '{}') } catch { /* empty bed */ }
for (const p of Object.values(parts)) p.scale = Math.max(10, Math.min(500, Number(p.scale) || 100))
let version = 0
const ls = new Set<() => void>()
const save = () => {
  // files are not kept between starts, only their settings
  try { localStorage.setItem('rico.bed', JSON.stringify(Object.fromEntries(Object.entries(parts).filter(([, p]) => p.kind === 'gobo')))) } catch { /* not kept */ }
  version++; ls.forEach((l) => l())
}
onGobos(() => { version++; ls.forEach((l) => l()) })

export function bedParts(): BedPart[] {
  const gobos = getGobos()
  const out: BedPart[] = []
  for (const g of gobos) out.push(parts[g.id] ?? { id: g.id, name: g.name, kind: 'gobo', on: true, flip: true, turn: 0, scale: 100, at: null })
  for (const [id, p] of Object.entries(parts)) if (p.kind === 'file' && files.has(id)) out.push(p)
  return out.map((p) => (p.kind === 'gobo' ? { ...p, name: gobos.find((g) => g.id === p.id)?.name ?? p.name } : p))
}
export function useBed(): BedPart[] {
  useSyncExternalStore((l) => { ls.add(l); return () => ls.delete(l) }, () => version)
  return bedParts()
}
export function updatePart(id: string, part: Partial<BedPart>) {
  const cur = bedParts().find((p) => p.id === id)
  if (!cur) return
  const next = { ...cur, ...part }
  next.scale = Math.max(10, Math.min(500, Number(next.scale) || 100))
  parts = { ...parts, [id]: next }
  save()
}
export function onlyPart(id: string) { for (const p of bedParts()) parts[p.id] = { ...p, on: p.id === id }; save() }
export function removeFile(id: string) { files.delete(id); const n = { ...parts }; delete n[id]; parts = n; save() }

export async function addStl(file: File): Promise<string> {
  const { STLLoader } = await import('three/addons/loaders/STLLoader.js')
  let g: THREE.BufferGeometry
  try { g = new STLLoader().parse(await file.arrayBuffer()) } catch { return 'That STL file did not open.' }
  if (!g.getAttribute('position')?.count) return 'That file has no shape in it.'
  const id = `f${Math.random().toString(36).slice(2, 8)}`
  files.set(id, g.index ? g.toNonIndexed() : g)
  parts = { ...parts, [id]: { id, name: file.name.replace(/\.stl$/i, ''), kind: 'file', on: true, flip: false, turn: 0, scale: 100, at: null } }
  save()
  return ''
}

// ---- the shapes, placed ----

const goboCache = new Map<string, { key: string; geo: THREE.BufferGeometry }>()
async function rawGeometry(p: BedPart): Promise<THREE.BufferGeometry | null> {
  if (p.kind === 'file') return files.get(p.id) ?? null
  const g = getGobos().find((x) => x.id === p.id)
  if (!g) return null
  const plan = goboPlan(g)
  if (!plan.openings.length) return null
  const key = JSON.stringify([plan.openings, plan.plate, plan.holes, g.opts])
  const c = goboCache.get(g.id)
  if (c && c.key === key) return c.geo
  const geo = await goboGeometry(plan, g.opts)
  goboCache.set(g.id, { key, geo })
  return geo
}

export interface Placed { part: BedPart; geo: THREE.BufferGeometry; size: [number, number, number]; at: [number, number]; fits: boolean }

// The part turned, flipped and sized, standing on z = 0, centered on 0,0.
function shaped(p: BedPart, src: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = src.clone()
  const m = new THREE.Matrix4()
  if (p.flip) g.applyMatrix4(m.makeRotationX(Math.PI))
  if (p.turn) g.applyMatrix4(m.makeRotationZ(THREE.MathUtils.degToRad(p.turn)))
  if (p.scale !== 100) g.applyMatrix4(m.makeScale(p.scale / 100, p.scale / 100, p.scale / 100))
  g.computeBoundingBox()
  const bb = g.boundingBox!
  g.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -bb.min.z)
  return g
}

// Rows from the front left corner, a gap between parts.
export async function placeAll(bed: [number, number, number], gap = 6): Promise<Placed[]> {
  const list = bedParts().filter((p) => p.on)
  const out: Placed[] = []
  let x = gap, y = gap, rowH = 0
  for (const p of list) {
    const src = await rawGeometry(p)
    if (!src) continue
    const geo = shaped(p, src)
    geo.computeBoundingBox()
    const s = geo.boundingBox!.getSize(new THREE.Vector3())
    let at: [number, number]
    if (p.at) at = p.at
    else {
      if (x + s.x > bed[0] - gap && x > gap) { x = gap; y += rowH + gap; rowH = 0 }
      at = [x + s.x / 2, y + s.y / 2]
      x += s.x + gap
      rowH = Math.max(rowH, s.y)
    }
    const fits = at[0] - s.x / 2 >= 0 && at[1] - s.y / 2 >= 0 && at[0] + s.x / 2 <= bed[0] && at[1] + s.y / 2 <= bed[1] && s.z <= bed[2]
    out.push({ part: p, geo, size: [s.x, s.y, s.z], at, fits })
  }
  return out
}

// Triangles of everything on the bed, in bed millimetres, and the shells
// (each part's pieces) for the slicer.
export function bedTriangles(placed: Placed[]): { tris: Float32Array; shells: [number, number][] } {
  let n = 0
  for (const p of placed) n += p.geo.getAttribute('position').count
  const tris = new Float32Array(n * 3)
  const shells: [number, number][] = []
  let at = 0
  for (const p of placed) {
    const pos = p.geo.getAttribute('position')
    const base = at / 9
    for (let i = 0; i < pos.count; i++) {
      tris[at++] = pos.getX(i) + p.at[0]
      tris[at++] = pos.getY(i) + p.at[1]
      tris[at++] = pos.getZ(i)
    }
    const groups = p.geo.groups.length ? p.geo.groups : [{ start: 0, count: pos.count }]
    for (const gr of groups) shells.push([base + gr.start / 3, gr.count / 3])
  }
  return { tris, shells }
}

export const goboOf = (id: string): Gobo | undefined => getGobos().find((g) => g.id === id)
