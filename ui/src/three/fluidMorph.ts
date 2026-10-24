import * as THREE from 'three'
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js'
import type { Obj3D } from './world'

// The fluid morph: a shape melts into another like a living liquid.
//
// Both shapes become a field of distances on a 3D grid (negative inside,
// positive outside): the object from its triangles, the target from its
// triangles too (any object, a model from a file) or from a formula (a ball,
// a box, a ring, a can). The morph blends the two fields, with the change
// moving across the shape unevenly and some slow noise on the way, so it
// crawls and reaches out like a living goo, and the surface is rebuilt from
// the blended field each frame. Because the surface is a new shape each
// frame, it can split, merge and grow arms that the points of either shape
// could never make. Outlines and looks are drawn on the same surface, so they
// follow it.

export const MORPH_SHAPES: [string, string][] = [['sphere', 'A ball'], ['cube', 'A box'], ['torus', 'A ring'], ['cylinder', 'A can']]
const INF = 1e20

// distances on a grid

function pass1d(f: Float64Array, d: Float64Array, v: Int32Array, z: Float64Array, n: number) {
  let k = 0
  v[0] = 0; z[0] = -INF; z[1] = INF
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    while (s <= z[k]) { k--; s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]) }
    k++; v[k] = q; z[k] = s; z[k + 1] = INF
  }
  k = 0
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]] }
}

// Squared distance (in cells) from every cell with on = 1 to the nearest cell with on = 0.
function dist3(on: Uint8Array, R: number): Float64Array {
  const N = R * R * R
  const g = new Float64Array(N)
  for (let i = 0; i < N; i++) g[i] = on[i] ? INF : 0
  const f = new Float64Array(R), d = new Float64Array(R), v = new Int32Array(R), z = new Float64Array(R + 1)
  const axis = (stride: number, a: number, b: number) => {
    for (let i = 0; i < R; i++) for (let j = 0; j < R; j++) {
      const base = i * a + j * b
      for (let k = 0; k < R; k++) f[k] = g[base + k * stride]
      pass1d(f, d, v, z, R)
      for (let k = 0; k < R; k++) g[base + k * stride] = d[k]
    }
  }
  axis(1, R, R * R)          // along x
  axis(R, 1, R * R)          // along y
  axis(R * R, 1, R)          // along z
  return g
}

// Which cells are inside the triangles: rays along x, y and z count the
// crossings, and two of three must agree, so meshes with small holes (many
// files have them) still fill.
function solidOf(tris: Float32Array, R: number, min: THREE.Vector3, cell: number): Uint8Array {
  const N = R * R * R
  const votes = new Uint8Array(N)
  const cols: number[][] = []
  for (let ax = 0; ax < 3; ax++) {
    const u = (ax + 1) % 3, w = (ax + 2) % 3
    cols.length = 0
    for (let i = 0; i < R * R; i++) cols.push([])
    const mn = [min.x, min.y, min.z]
    for (let t = 0; t < tris.length; t += 9) {
      const au = tris[t + u], aw = tris[t + w], bu = tris[t + 3 + u], bw = tris[t + 3 + w], cu = tris[t + 6 + u], cw = tris[t + 6 + w]
      const det = (bw - cw) * (au - cu) + (cu - bu) * (aw - cw)
      if (Math.abs(det) < 1e-12) continue
      const i0 = Math.max(0, Math.floor((Math.min(au, bu, cu) - mn[u]) / cell - 0.5)), i1 = Math.min(R - 1, Math.ceil((Math.max(au, bu, cu) - mn[u]) / cell - 0.5))
      const j0 = Math.max(0, Math.floor((Math.min(aw, bw, cw) - mn[w]) / cell - 0.5)), j1 = Math.min(R - 1, Math.ceil((Math.max(aw, bw, cw) - mn[w]) / cell - 0.5))
      for (let i = i0; i <= i1; i++) {
        const pu = mn[u] + (i + 0.5) * cell
        for (let j = j0; j <= j1; j++) {
          const pw = mn[w] + (j + 0.5) * cell
          const l1 = ((bw - cw) * (pu - cu) + (cu - bu) * (pw - cw)) / det
          const l2 = ((cw - aw) * (pu - cu) + (au - cu) * (pw - cw)) / det
          const l3 = 1 - l1 - l2
          if (l1 < 0 || l2 < 0 || l3 < 0) continue
          cols[i * R + j].push(l1 * tris[t + ax] + l2 * tris[t + 3 + ax] + l3 * tris[t + 6 + ax])
        }
      }
    }
    const stride = [1, R, R * R]
    for (let i = 0; i < R; i++) for (let j = 0; j < R; j++) {
      const c = cols[i * R + j]
      if (c.length < 2) continue
      c.sort((a, b) => a - b)
      let k = 0
      for (let s = 0; s < R; s++) {
        const p = mn[ax] + (s + 0.5) * cell
        while (k < c.length && c[k] < p) k++
        if (k % 2 === 1) votes[i * stride[u] + j * stride[w] + s * stride[ax]]++
      }
    }
  }
  const out = new Uint8Array(N)
  for (let i = 0; i < N; i++) out[i] = votes[i] >= 2 ? 1 : 0
  return out
}

// A signed distance field in cells: negative inside.
export function sdfOf(tris: Float32Array, R: number, min: THREE.Vector3, cell: number): Float32Array {
  const inside = solidOf(tris, R, min, cell)
  const out = new Uint8Array(inside.length)
  for (let i = 0; i < inside.length; i++) out[i] = inside[i] ? 0 : 1
  const dIn = dist3(inside, R), dOut = dist3(out, R)
  const f = new Float32Array(inside.length)
  for (let i = 0; i < f.length; i++) f[i] = inside[i] ? -(Math.sqrt(dIn[i]) - 0.5) : Math.sqrt(dOut[i]) - 0.5
  return f
}

function shapeSdf(kind: string, R: number, min: THREE.Vector3, cell: number, c: THREE.Vector3, r: number): Float32Array {
  const f = new Float32Array(R * R * R)
  let i = 0
  for (let z = 0; z < R; z++) for (let y = 0; y < R; y++) for (let x = 0; x < R; x++, i++) {
    const px = min.x + (x + 0.5) * cell - c.x, py = min.y + (y + 0.5) * cell - c.y, pz = min.z + (z + 0.5) * cell - c.z
    let d: number
    if (kind === 'cube') {
      const qx = Math.abs(px) - r * 0.82, qy = Math.abs(py) - r * 0.82, qz = Math.abs(pz) - r * 0.82
      d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0)
    } else if (kind === 'torus') {
      const q = Math.hypot(px, pz) - r * 0.68
      d = Math.hypot(q, py) - r * 0.3
    } else if (kind === 'cylinder') {
      const dx = Math.hypot(px, pz) - r * 0.75, dy = Math.abs(py) - r * 0.9
      d = Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0))
    } else d = Math.hypot(px, py, pz) - r
    f[i] = d / cell
  }
  return f
}

// smooth noise, cheap enough to run for every cell every frame

const LAT = 17
const lattice = (() => { const a = new Float32Array(LAT * LAT * LAT); let s = 1234567; for (let i = 0; i < a.length; i++) { s = (s * 16807) % 2147483647; a[i] = s / 2147483647 } return a })()
export function noise3(x: number, y: number, z: number): number {
  const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z)
  let tx = x - fx, ty = y - fy, tz = z - fz
  tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty); tz = tz * tz * (3 - 2 * tz)
  const m = (v: number) => ((v % (LAT - 1)) + (LAT - 1)) % (LAT - 1)
  // wrap both corners, so the pattern repeats without a seam
  const x0 = m(fx), y0 = m(fy), z0 = m(fz), x1 = m(fx + 1), y1 = m(fy + 1), z1 = m(fz + 1)
  const L = (a: number, b: number, c: number) => lattice[(c * LAT + b) * LAT + a]
  const a = L(x0, y0, z0) + (L(x1, y0, z0) - L(x0, y0, z0)) * tx, b = L(x0, y1, z0) + (L(x1, y1, z0) - L(x0, y1, z0)) * tx
  const c = L(x0, y0, z1) + (L(x1, y0, z1) - L(x0, y0, z1)) * tx, d = L(x0, y1, z1) + (L(x1, y1, z1) - L(x0, y1, z1)) * tx
  const e = a + (b - a) * ty, g = c + (d - c) * ty
  return e + (g - e) * tz
}


// Builds the surface from the field in mc and puts it in the mesh's own space.
export function surfaceOf(mc: MarchingCubes, n: number, min: THREE.Vector3, cell: number, M: THREE.Matrix4) {
  mc.update()
  // from the grid (-1..1) to the object's space, then the mesh's own space
  const g = mc.geometry
  const pos = (mc as unknown as { positionArray: Float32Array }).positionArray
  const nor = (mc as unknown as { normalArray: Float32Array }).normalArray
  const count = (mc as unknown as { count: number }).count
  const half = n / 2
  const e = M.elements
  const identity = M.equals(new THREE.Matrix4())
  const nm = new THREE.Matrix3().getNormalMatrix(M)
  const ne = nm.elements
  const bb = new THREE.Box3()
  const v = new THREE.Vector3()
  for (let q = 0; q < count; q++) {
    const a = q * 3
    let px = min.x + (0.5 + (pos[a] + 1) * half) * cell
    let py = min.y + (0.5 + (pos[a + 1] + 1) * half) * cell
    let pz = min.z + (0.5 + (pos[a + 2] + 1) * half) * cell
    if (!identity) {
      const X = e[0] * px + e[4] * py + e[8] * pz + e[12], Y = e[1] * px + e[5] * py + e[9] * pz + e[13], Z = e[2] * px + e[6] * py + e[10] * pz + e[14]
      px = X; py = Y; pz = Z
      const nx = nor[a], ny = nor[a + 1], nz = nor[a + 2]
      nor[a] = ne[0] * nx + ne[3] * ny + ne[6] * nz; nor[a + 1] = ne[1] * nx + ne[4] * ny + ne[7] * nz; nor[a + 2] = ne[2] * nx + ne[5] * ny + ne[8] * nz
    }
    pos[a] = px; pos[a + 1] = py; pos[a + 2] = pz
    bb.expandByPoint(v.set(px, py, pz))
  }
  g.getAttribute('position').needsUpdate = true
  g.getAttribute('normal').needsUpdate = true
  g.boundingBox = bb
  g.boundingSphere = bb.isEmpty() ? new THREE.Sphere() : bb.getBoundingSphere(new THREE.Sphere())
}

// the morph on an object

interface State {
  R: number; min: THREE.Vector3; cell: number
  srcKey: string; src: Float32Array
  tgtKey: string; tgt: Float32Array
  spread: Float32Array            // where the change starts first, 0..1 for each cell
  mc: MarchingCubes
  mesh: THREE.Mesh                // the mesh that shows the surface
  rest: THREE.BufferGeometry      // its own shape, to put back
  hidden: THREE.Mesh[]
  toMesh: THREE.Matrix4           // object space to the mesh's own space
  lastKey: string
}

export function trianglesOf(meshes: THREE.Mesh[], toSpace: (m: THREE.Mesh) => THREE.Matrix4): Float32Array {
  const out: number[] = []
  const v = new THREE.Vector3()
  for (const m of meshes) {
    const g = (m.userData.fluidRest as THREE.BufferGeometry | undefined) ?? m.geometry
    const rig = g.userData.rig as { pos: Float32Array } | undefined
    const p = g.getAttribute('position')
    if (!p) continue
    const arr = rig?.pos && rig.pos.length === p.array.length ? rig.pos : (p.array as Float32Array)
    const M = toSpace(m)
    const idx = g.index
    const n = idx ? idx.count : p.count
    for (let i = 0; i < n; i++) {
      const k = idx ? idx.getX(i) : i
      v.set(arr[k * 3], arr[k * 3 + 1], arr[k * 3 + 2]).applyMatrix4(M)
      out.push(v.x, v.y, v.z)
    }
  }
  return new Float32Array(out)
}
export function boxOf(tris: Float32Array): THREE.Box3 {
  const b = new THREE.Box3()
  const v = new THREE.Vector3()
  for (let i = 0; i < tris.length; i += 3) b.expandByPoint(v.set(tris[i], tris[i + 1], tris[i + 2]))
  return b
}

export const meshesOf = (o3: THREE.Object3D) => {
  const out: THREE.Mesh[] = []
  o3.traverse((c) => { const m = c as THREE.Mesh; if (m.isMesh && !m.userData.helper && !m.userData.symArm && !(m as unknown as { isMarchingCubes?: boolean }).isMarchingCubes && !isHelperChild(m)) out.push(m) })
  return out
}
function isHelperChild(o: THREE.Object3D): boolean { for (let p = o.parent; p; p = p.parent) if (p.userData.helper) return true; return false }

export function stopFluid(obj: THREE.Object3D) {
  const s = obj.userData.fluid as State | undefined
  if (!s) return
  s.mesh.geometry = s.rest
  delete s.mesh.userData.fluidRest
  for (const m of s.hidden) m.visible = true
  s.mc.geometry.dispose()
  obj.userData.fluid = undefined
}

/**
 * Runs the fluid morph on an object. Returns true while it shows the fluid
 * surface (the object's own shape is put back when the morph is at 0).
 */
export function fluidMorph(obj: THREE.Object3D, o: Obj3D, amt: number, t: number, findObj: (id: string) => THREE.Object3D | undefined): boolean {
  const m = o.morph
  if (!m || amt <= 0.0005) { stopFluid(obj); return false }
  obj.updateMatrixWorld(true)
  let st = obj.userData.fluid as State | undefined
  const meshes = st ? [st.mesh, ...st.hidden] : meshesOf(obj)
  if (!meshes.length) return false
  if (!meshes[0].geometry.getAttribute('position')?.count && !st) return false
  const inv = obj.matrixWorld.clone().invert()
  const toObj = (x: THREE.Mesh) => inv.clone().multiply(x.matrixWorld)
  const R = Math.max(24, Math.min(96, Math.round(m.detail ?? 56)))
  // the object's own shape (its rest shape)
  const srcKey = `${R}|${meshes.map((x) => `${((x.userData.fluidRest as THREE.BufferGeometry | undefined) ?? x.geometry).uuid}`).join()}`
  const target = m.to
  const other = MORPH_SHAPES.some(([k]) => k === target) ? undefined : findObj(target)
  if (!MORPH_SHAPES.some(([k]) => k === target) && !other) { stopFluid(obj); return false }
  let srcTris: Float32Array | null = null
  let tgtTris: Float32Array | null = null
  const otherKey = other ? `${other.uuid}|${meshesOf(other).map((x) => x.geometry.uuid).join()}|${other.matrixWorld.elements.map((e) => e.toFixed(3)).join()}|${obj.matrixWorld.elements.map((e) => e.toFixed(3)).join()}` : ''
  const tgtKey = `${srcKey}|${target}|${otherKey}`
  if (!st || st.srcKey !== srcKey || st.tgtKey !== tgtKey) {
    srcTris = trianglesOf(meshes, toObj)
    const sb = boxOf(srcTris)
    if (sb.isEmpty()) return false
    const c = sb.getCenter(new THREE.Vector3())
    const h = sb.getSize(new THREE.Vector3()).multiplyScalar(0.5)
    const sorted = [h.x, h.y, h.z].sort((a, b) => b - a)
    const r = (sorted[0] + sorted[1]) / 2
    const box = sb.clone()
    if (other) {
      other.updateMatrixWorld(true)
      tgtTris = trianglesOf(meshesOf(other), (x) => inv.clone().multiply(x.matrixWorld))
      box.union(boxOf(tgtTris))
    } else box.union(new THREE.Box3(c.clone().subScalar(r * 1.05), c.clone().addScalar(r * 1.05)))
    // a cube of cells around both shapes, with room for the goo to reach out
    const size = box.getSize(new THREE.Vector3())
    const edge = Math.max(size.x, size.y, size.z) * 1.25 + 1e-4
    const cell = edge / R
    const mid = box.getCenter(new THREE.Vector3())
    const min = mid.clone().subScalar(edge / 2)
    const src = sdfOf(srcTris, R, min, cell)
    const tgt = tgtTris ? sdfOf(tgtTris, R, min, cell) : shapeSdf(target, R, min, cell, c, r)
    const spread = new Float32Array(R * R * R)
    let i = 0
    // the change starts where the target reaches out the most, and moves across with some noise
    for (let z = 0; z < R; z++) for (let y = 0; y < R; y++) for (let x = 0; x < R; x++, i++) spread[i] = Math.min(1, Math.max(0, noise3(x * 0.09, y * 0.09, z * 0.09) * 0.7 + (Math.max(-6, Math.min(6, src[i] - tgt[i])) / 12 + 0.5) * 0.3))
    if (!st) {
      const mesh = meshes[0]
      const mc = new MarchingCubes(R, mesh.material as THREE.Material, false, false, 140000)
      mc.isolation = 0
      st = { R, min, cell, srcKey, src, tgtKey, tgt, spread, mc, mesh, rest: mesh.geometry, hidden: meshes.slice(1), toMesh: toObj(mesh).invert(), lastKey: '' }
      obj.userData.fluid = st
      mesh.userData.fluidRest = mesh.geometry
      const g = mc.geometry
      g.userData.live = true
    } else if (st.R !== R) {
      st.mc.geometry.dispose()
      st.mc = new MarchingCubes(R, st.mesh.material as THREE.Material, false, false, 140000)
      st.mc.isolation = 0
      st.mc.geometry.userData.live = true
      Object.assign(st, { R, min, cell, srcKey, src, tgtKey, tgt, spread, lastKey: '' })
    } else Object.assign(st, { min, cell, srcKey, src, tgtKey, tgt, spread, lastKey: '' })
  }
  const s = st!
  const goo = Math.max(0, Math.min(1, m.goo ?? 0.6))
  const sp = Math.max(0, Math.min(1, m.spread ?? 0.6))
  const moving = goo > 0.001 && amt < 0.999
  const key = `${amt.toFixed(4)}|${goo}|${sp}|${moving ? Math.floor(t * 24) : ''}`
  if (key !== s.lastKey) {
    s.lastKey = key
    const { R: n, src, tgt, spread, mc } = s
    mc.reset()
    const field = mc.field as Float32Array
    const span = 1 + sp * 1.6
    const mid = 4 * amt * (1 - amt)
    const amp = goo * 3.2 * mid
    const tt = t * (m.speed ?? 0.6)
    let i = 0
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++, i++) {
      if (x === 0 || y === 0 || z === 0 || x === n - 1 || y === n - 1 || z === n - 1) { field[i] = -50; continue }
      // each cell changes at its own time: the morph moves across like a liquid
      let k = amt * span - spread[i] * (span - 1)
      k = k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k)
      let f = src[i] + (tgt[i] - src[i]) * k
      // living goo: slow noise that pulls the surface out and in, strongest halfway
      if (amp > 0.001 && f < 6) f += (noise3(x * 0.16 + tt, y * 0.16 - tt * 0.7, z * 0.16 + tt * 0.4) - 0.5) * 2 * amp * (0.4 + 4 * k * (1 - k))
      field[i] = -f
    }
    surfaceOf(mc, n, s.min, s.cell, s.toMesh)
  }
  if (s.mesh.geometry !== s.mc.geometry) s.mesh.geometry = s.mc.geometry
  for (const h of s.hidden) h.visible = false
  return true
}
