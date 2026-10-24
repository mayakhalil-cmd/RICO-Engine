import * as THREE from 'three'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import type { MeshData } from './world'

// Modeling, the plain math: a mesh is a list of points and triangles.
// Extrude, delete, subdivide, smooth and flip work on that; the 3D view
// turns it into a three.js geometry.

export function fromGeometry(g: THREE.BufferGeometry): MeshData {
  const c = new THREE.BufferGeometry()
  c.setAttribute('position', g.getAttribute('position').clone())
  if (g.index) c.setIndex(g.index.clone())
  const m = mergeVertices(c, 1e-4)
  const p = Array.from(m.getAttribute('position').array as ArrayLike<number>)
  const f = m.index ? Array.from(m.index.array as ArrayLike<number>) : p.map((_, i) => i).slice(0, p.length / 3)
  return { p, f }
}

// UVs by projecting from the side each point faces most (box mapping), so
// pictures and painting work on shapes you model.
export function toGeometry(d: MeshData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(d.p, 3))
  g.setIndex(d.f)
  g.computeVertexNormals()
  g.computeBoundingBox()
  const bb = g.boundingBox!
  const size = bb.getSize(new THREE.Vector3())
  const s = Math.max(size.x, size.y, size.z, 1e-6)
  const n = g.getAttribute('normal')
  const uv = new Float32Array((d.p.length / 3) * 2)
  for (let i = 0; i < d.p.length / 3; i++) {
    const x = (d.p[i * 3] - bb.min.x) / s, y = (d.p[i * 3 + 1] - bb.min.y) / s, z = (d.p[i * 3 + 2] - bb.min.z) / s
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i))
    // Three areas of the picture, one for each direction.
    if (ax >= ay && ax >= az) { uv[i * 2] = z / 3; uv[i * 2 + 1] = y }
    else if (ay >= az) { uv[i * 2] = 1 / 3 + x / 3; uv[i * 2 + 1] = z }
    else { uv[i * 2] = 2 / 3 + x / 3; uv[i * 2 + 1] = y }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  return g
}

const facesOf = (d: MeshData) => d.f.length / 3
export function selectedFaces(d: MeshData, sel: Set<number>): number[] {
  const out: number[] = []
  for (let i = 0; i < facesOf(d); i++) if (sel.has(d.f[i * 3]) && sel.has(d.f[i * 3 + 1]) && sel.has(d.f[i * 3 + 2])) out.push(i)
  return out
}

function faceNormal(d: MeshData, i: number): THREE.Vector3 {
  const v = (k: number) => new THREE.Vector3(d.p[d.f[i * 3 + k] * 3], d.p[d.f[i * 3 + k] * 3 + 1], d.p[d.f[i * 3 + k] * 3 + 2])
  const a = v(0), b = v(1), c = v(2)
  return b.sub(a).cross(c.sub(a)).normalize()
}

// Pulls the selected faces out, with new side walls.
export function extrude(d: MeshData, sel: Set<number>, distance = 0.25): { data: MeshData; sel: Set<number> } | null {
  const faces = selectedFaces(d, sel)
  if (!faces.length) return null
  const inRegion = new Set(faces)
  const edgeCount = new Map<string, number>()
  const key = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`)
  for (const fi of faces) for (let k = 0; k < 3; k++) { const a = d.f[fi * 3 + k], b = d.f[fi * 3 + ((k + 1) % 3)]; edgeCount.set(key(a, b), (edgeCount.get(key(a, b)) ?? 0) + 1) }
  const p = [...d.p], f = [...d.f]
  const map = new Map<number, number>()
  const dup = (v: number) => { let n = map.get(v); if (n === undefined) { n = p.length / 3; p.push(d.p[v * 3], d.p[v * 3 + 1], d.p[v * 3 + 2]); map.set(v, n) } return n }
  const normal = new THREE.Vector3()
  for (const fi of faces) normal.add(faceNormal(d, fi))
  normal.normalize()
  for (let i = 0; i < facesOf(d); i++) {
    if (!inRegion.has(i)) continue
    const a = d.f[i * 3], b = d.f[i * 3 + 1], c = d.f[i * 3 + 2]
    // Side walls on the edges at the border of the selection.
    for (const [x, y] of [[a, b], [b, c], [c, a]]) {
      if (edgeCount.get(key(x, y)) === 1) { const x2 = dup(x), y2 = dup(y); f.push(x, y, y2, x, y2, x2) }
    }
    f[i * 3] = dup(a); f[i * 3 + 1] = dup(b); f[i * 3 + 2] = dup(c)
  }
  for (const n of map.values()) { p[n * 3] += normal.x * distance; p[n * 3 + 1] += normal.y * distance; p[n * 3 + 2] += normal.z * distance }
  return { data: { p, f }, sel: new Set(map.values()) }
}

// Deletes the selected faces (or every face that touches a selected point)
// and the points nothing uses any more.
export function deleteSelected(d: MeshData, sel: Set<number>): MeshData {
  let gone = new Set(selectedFaces(d, sel))
  if (!gone.size) for (let i = 0; i < facesOf(d); i++) if (sel.has(d.f[i * 3]) || sel.has(d.f[i * 3 + 1]) || sel.has(d.f[i * 3 + 2])) gone.add(i)
  const f: number[] = []
  for (let i = 0; i < facesOf(d); i++) if (!gone.has(i)) f.push(d.f[i * 3], d.f[i * 3 + 1], d.f[i * 3 + 2])
  gone = new Set()
  return compact({ p: d.p, f })
}

function compact(d: MeshData): MeshData {
  const used = new Map<number, number>()
  const p: number[] = []
  const f = d.f.map((v) => { let n = used.get(v); if (n === undefined) { n = p.length / 3; p.push(d.p[v * 3], d.p[v * 3 + 1], d.p[v * 3 + 2]); used.set(v, n) } return n })
  return { p, f }
}

// Each triangle becomes four (more detail for sculpting). With a selection,
// only the selected faces, and the neighbors split to keep it closed.
export function subdivide(d: MeshData): MeshData {
  const p = [...d.p], f: number[] = []
  const mids = new Map<string, number>()
  const mid = (a: number, b: number) => {
    const k = a < b ? `${a}_${b}` : `${b}_${a}`
    let n = mids.get(k)
    if (n === undefined) { n = p.length / 3; p.push((d.p[a * 3] + d.p[b * 3]) / 2, (d.p[a * 3 + 1] + d.p[b * 3 + 1]) / 2, (d.p[a * 3 + 2] + d.p[b * 3 + 2]) / 2); mids.set(k, n) }
    return n
  }
  for (let i = 0; i < facesOf(d); i++) {
    const a = d.f[i * 3], b = d.f[i * 3 + 1], c = d.f[i * 3 + 2]
    const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a)
    f.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca)
  }
  return { p, f }
}

export function neighbors(d: MeshData): number[][] {
  const n: Set<number>[] = Array.from({ length: d.p.length / 3 }, () => new Set())
  for (let i = 0; i < d.f.length; i += 3) {
    const a = d.f[i], b = d.f[i + 1], c = d.f[i + 2]
    n[a].add(b); n[a].add(c); n[b].add(a); n[b].add(c); n[c].add(a); n[c].add(b)
  }
  return n.map((s) => [...s])
}

// Smooths the selected points (all when nothing is selected). Taubin
// smoothing: a step in and a step back out, so the shape does not shrink.
export function smooth(d: MeshData, sel: Set<number> | null, rounds = 2): MeshData {
  const nb = neighbors(d)
  let p = [...d.p]
  const step = (k: number) => {
    const next = [...p]
    for (let v = 0; v < nb.length; v++) {
      if (sel && sel.size && !sel.has(v)) continue
      const list = nb[v]
      if (!list.length) continue
      let x = 0, y = 0, z = 0
      for (const u of list) { x += p[u * 3]; y += p[u * 3 + 1]; z += p[u * 3 + 2] }
      x /= list.length; y /= list.length; z /= list.length
      next[v * 3] += (x - p[v * 3]) * k; next[v * 3 + 1] += (y - p[v * 3 + 1]) * k; next[v * 3 + 2] += (z - p[v * 3 + 2]) * k
    }
    p = next
  }
  for (let r = 0; r < rounds; r++) { step(0.5); step(-0.53) }
  return { p, f: d.f }
}

export function flip(d: MeshData): MeshData {
  const f = [...d.f]
  for (let i = 0; i < f.length; i += 3) [f[i + 1], f[i + 2]] = [f[i + 2], f[i + 1]]
  return { p: d.p, f }
}

// Sculpt brushes, moving points around a spot on the surface.
export type SculptTool = 'draw' | 'clay' | 'crease' | 'inflate' | 'smooth' | 'flatten' | 'pinch' | 'grab' | 'snake'
export interface SculptHit { point: THREE.Vector3; normal: THREE.Vector3 }

export function sculpt(pos: Float32Array, normals: THREE.BufferAttribute, nb: number[][], tool: SculptTool, hit: SculptHit, radius: number, strength: number, grabDelta?: THREE.Vector3, sym = false, invert = false): void {
  const hits = [hit]
  if (sym) hits.push({ point: new THREE.Vector3(-hit.point.x, hit.point.y, hit.point.z), normal: new THREE.Vector3(-hit.normal.x, hit.normal.y, hit.normal.z) })
  const sign = invert ? -1 : 1
  for (const h of hits) {
    const mirrored = h !== hit
    const r2 = radius * radius
    // The average plane under the brush (for flatten).
    let cx = 0, cy = 0, cz = 0, cn = 0
    if (tool === 'flatten' || tool === 'clay') {
      for (let v = 0; v < pos.length / 3; v++) {
        const dx = pos[v * 3] - h.point.x, dy = pos[v * 3 + 1] - h.point.y, dz = pos[v * 3 + 2] - h.point.z
        if (dx * dx + dy * dy + dz * dz < r2) { cx += pos[v * 3]; cy += pos[v * 3 + 1]; cz += pos[v * 3 + 2]; cn++ }
      }
      if (cn) { cx /= cn; cy /= cn; cz /= cn }
    }
    for (let v = 0; v < pos.length / 3; v++) {
      const dx = pos[v * 3] - h.point.x, dy = pos[v * 3 + 1] - h.point.y, dz = pos[v * 3 + 2] - h.point.z
      const dd = dx * dx + dy * dy + dz * dz
      if (dd >= r2) continue
      const t = 1 - Math.sqrt(dd) / radius
      const fall = t * t * (3 - 2 * t) * strength
      if (tool === 'draw') {
        pos[v * 3] += h.normal.x * fall * radius * 0.08 * sign; pos[v * 3 + 1] += h.normal.y * fall * radius * 0.08 * sign; pos[v * 3 + 2] += h.normal.z * fall * radius * 0.08 * sign
      } else if (tool === 'inflate') {
        pos[v * 3] += normals.getX(v) * fall * radius * 0.06 * sign; pos[v * 3 + 1] += normals.getY(v) * fall * radius * 0.06 * sign; pos[v * 3 + 2] += normals.getZ(v) * fall * radius * 0.06 * sign
      } else if (tool === 'smooth') {
        const list = nb[v]
        if (!list?.length) continue
        let x = 0, y = 0, z = 0
        for (const u of list) { x += pos[u * 3]; y += pos[u * 3 + 1]; z += pos[u * 3 + 2] }
        const k = Math.min(1, fall * 0.8)
        pos[v * 3] += (x / list.length - pos[v * 3]) * k; pos[v * 3 + 1] += (y / list.length - pos[v * 3 + 1]) * k; pos[v * 3 + 2] += (z / list.length - pos[v * 3 + 2]) * k
      } else if (tool === 'flatten' && cn) {
        const d0 = (pos[v * 3] - cx) * h.normal.x + (pos[v * 3 + 1] - cy) * h.normal.y + (pos[v * 3 + 2] - cz) * h.normal.z
        const k = Math.min(1, fall * 0.5)
        pos[v * 3] -= h.normal.x * d0 * k; pos[v * 3 + 1] -= h.normal.y * d0 * k; pos[v * 3 + 2] -= h.normal.z * d0 * k
      } else if (tool === 'clay' && cn) {
        // Builds up like layers of clay: only raises what is under a plane a
        // little above the surface, so strokes stack and stay flat on top.
        const lift = radius * 0.06 * sign
        const d0 = (pos[v * 3] - cx) * h.normal.x + (pos[v * 3 + 1] - cy) * h.normal.y + (pos[v * 3 + 2] - cz) * h.normal.z
        const want = lift - d0
        if (sign > 0 ? want > 0 : want < 0) {
          const k = Math.min(1, fall * 0.35)
          pos[v * 3] += h.normal.x * want * k; pos[v * 3 + 1] += h.normal.y * want * k; pos[v * 3 + 2] += h.normal.z * want * k
        }
      } else if (tool === 'crease') {
        // A sharp line: pulls the sides together and cuts in.
        const k = fall * 0.12
        pos[v * 3] -= dx * k; pos[v * 3 + 1] -= dy * k; pos[v * 3 + 2] -= dz * k
        const cut = fall * fall * radius * 0.05 * sign
        pos[v * 3] -= h.normal.x * cut; pos[v * 3 + 1] -= h.normal.y * cut; pos[v * 3 + 2] -= h.normal.z * cut
      } else if (tool === 'pinch') {
        const k = fall * 0.1 * sign
        pos[v * 3] -= dx * k; pos[v * 3 + 1] -= dy * k; pos[v * 3 + 2] -= dz * k
      } else if (tool === 'grab' && grabDelta) {
        const gx = mirrored ? -grabDelta.x : grabDelta.x
        pos[v * 3] += gx * fall; pos[v * 3 + 1] += grabDelta.y * fall; pos[v * 3 + 2] += grabDelta.z * fall
      }
    }
  }
}
