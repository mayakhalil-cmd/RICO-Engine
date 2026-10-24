import * as THREE from 'three'
import { TessellateModifier } from 'three/addons/modifiers/TessellateModifier.js'
import type { Deform, Obj3D } from './world'
import { fluidMorph, stopFluid } from './fluidMorph'
import { stopSymbiote, symbiote } from './symbiote'

// Rigging for any shape, without bones: deformers bend, twist, taper,
// squash or wave a shape along one of its axes, and a morph melts it into a
// ball, a box or another object. They work on the shape's points, so every
// material, look and outline follows them. The amounts can be linked to the
// music or animated on the timeline.

interface Base { pos: Float32Array; box: THREE.Box3; key: string; targets: Map<string, Float32Array> }

function baseOf(g: THREE.BufferGeometry): Base {
  let b = g.userData.rig as Base | undefined
  const p = g.getAttribute('position') as THREE.BufferAttribute
  if (!b || b.pos.length !== p.array.length) {
    const pos = new Float32Array(p.array as Float32Array)
    const box = new THREE.Box3()
    for (let i = 0; i < pos.length; i += 3) box.expandByPoint(new THREE.Vector3(pos[i], pos[i + 1], pos[i + 2]))
    b = { pos, box, key: '', targets: new Map() }
    g.userData.rig = b
  }
  return b
}

const AX = { x: 0, y: 1, z: 2 } as const

function deformPoint(p: number[], d: Deform, box: THREE.Box3, amt: number, t: number) {
  // Everything bends, twists and tapers from the pivot (the object's own 0,
  // which you can move): what is above it bends one way, what is below the other.
  const a = AX[d.axis], u = (a + 1) % 3, w = (a + 2) % 3
  const lo = box.min.getComponent(a), hi = box.max.getComponent(a)
  const len = Math.max(1e-5, hi - lo)
  const k = p[a] / len                             // 0 at the pivot, 1 one full height above it
  const cu = 0, cw = 0
  switch (d.kind) {
    case 'bend': {
      const ang = amt * Math.PI                       // amount 1 = a half circle over the height
      if (Math.abs(ang) < 1e-4) return
      const r = len / ang
      const th = k * ang
      const x = p[u] - cu
      p[u] = cu + r - (r - x) * Math.cos(th)
      p[a] = (r - x) * Math.sin(th)
      return
    }
    case 'twist': {
      const th = k * amt * Math.PI * 2
      const x = p[u] - cu, z = p[w] - cw
      p[u] = cu + x * Math.cos(th) - z * Math.sin(th)
      p[w] = cw + x * Math.sin(th) + z * Math.cos(th)
      return
    }
    case 'taper': {
      const s = Math.max(0, 1 - amt * k)
      p[u] = cu + (p[u] - cu) * s
      p[w] = cw + (p[w] - cw) * s
      return
    }
    case 'squash': {
      // shorter and wider (or taller and thinner) toward the pivot, keeping its volume
      const s = Math.max(0.05, 1 - amt * 0.6)
      const side = 1 / Math.sqrt(s)
      p[a] = p[a] * s
      p[u] = cu + (p[u] - cu) * side
      p[w] = cw + (p[w] - cw) * side
      return
    }
    case 'wave': {
      const f = d.freq ?? 2, sp = d.speed ?? 1
      p[u] += Math.sin((k * f + t * sp) * Math.PI * 2) * amt * len * 0.1
      return
    }
  }
}

// The whole object's middle and size (in the object's own space), so all its
// parts (every letter of a text) melt into one ball, not one ball each.
export interface Frame { key: string; c: THREE.Vector3; h: THREE.Vector3; r: number }

function morphTarget(b: Base, to: string, other: THREE.Object3D | undefined, mesh: THREE.Mesh, frame?: Frame, toObj?: THREE.Matrix4): Float32Array | null {
  const key = to === 'sphere' || to === 'cube' ? `${to}|${frame?.key ?? ''}` : `${to}|${other?.uuid}`
  const hit = b.targets.get(key)
  if (hit) return hit
  const out = new Float32Array(b.pos.length)
  const c = frame ? frame.c.clone() : b.box.getCenter(new THREE.Vector3())
  const h = frame ? frame.h.clone() : b.box.getSize(new THREE.Vector3()).multiplyScalar(0.5)
  const r = frame ? frame.r : Math.max(h.x, h.y, h.z)
  const back = toObj ? toObj.clone().invert() : null
  const v = new THREE.Vector3()
  if (to === 'sphere' || to === 'cube') {
    // Stretch the shape into a cube first (axis by axis), then round it: the
    // front of a flat thing becomes the front half of the ball, the back the
    // back half, the sides the sides. Thin axes are not blown up too much.
    const hx = Math.max(h.x, r * 0.15), hy = Math.max(h.y, r * 0.15), hz = Math.max(h.z, r * 0.15)
    for (let i = 0; i < out.length; i += 3) {
      v.set(b.pos[i], b.pos[i + 1], b.pos[i + 2])
      if (toObj) v.applyMatrix4(toObj)
      v.set((v.x - c.x) / hx, (v.y - c.y) / hy, (v.z - c.z) / hz)
      if (v.lengthSq() < 1e-12) v.set(0, 1e-3, 0)
      if (to === 'sphere') {
        // the cube-to-ball map keeps points spread out (no bunching at the corners)
        const x = Math.max(-1, Math.min(1, v.x)), y = Math.max(-1, Math.min(1, v.y)), z = Math.max(-1, Math.min(1, v.z))
        const m = Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) || 1
        const X = x / m, Y = y / m, Z = z / m
        v.set(X * Math.sqrt(1 - Y * Y / 2 - Z * Z / 2 + Y * Y * Z * Z / 3), Y * Math.sqrt(1 - Z * Z / 2 - X * X / 2 + Z * Z * X * X / 3), Z * Math.sqrt(1 - X * X / 2 - Y * Y / 2 + X * X * Y * Y / 3))
        v.normalize().multiplyScalar(r)
      } else v.multiplyScalar(r / Math.max(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)))
      v.add(c)
      if (back) v.applyMatrix4(back)
      out[i] = v.x; out[i + 1] = v.y; out[i + 2] = v.z
    }
  } else {
    if (!other) return null
    // the nearest point of the other object, found through a grid of its points
    const pts: number[] = []
    other.updateMatrixWorld(true)
    mesh.updateMatrixWorld(true)
    const inv = mesh.matrixWorld.clone().invert()
    other.traverse((x) => {
      const m = x as THREE.Mesh
      if (!m.isMesh || m.userData.helper) return
      const a = m.geometry.getAttribute('position')
      if (!a) return
      const step = Math.max(1, Math.floor(a.count / 6000))
      for (let i = 0; i < a.count; i += step) { v.fromBufferAttribute(a, i).applyMatrix4(m.matrixWorld).applyMatrix4(inv); pts.push(v.x, v.y, v.z) }
    })
    if (!pts.length) return null
    const cell = r / 6 || 0.1
    const grid = new Map<string, number[]>()
    const kOf = (x: number, y: number, z: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`
    for (let i = 0; i < pts.length; i += 3) { const k = kOf(pts[i], pts[i + 1], pts[i + 2]); let l = grid.get(k); if (!l) grid.set(k, (l = [])); l.push(i) }
    for (let i = 0; i < out.length; i += 3) {
      const x = b.pos[i], y = b.pos[i + 1], z = b.pos[i + 2]
      let best = -1, bd = Infinity
      for (let ring = 0; ring < 8 && best < 0; ring++) {
        const gx = Math.floor(x / cell), gy = Math.floor(y / cell), gz = Math.floor(z / cell)
        for (let dx = -ring; dx <= ring; dx++) for (let dy = -ring; dy <= ring; dy++) for (let dz = -ring; dz <= ring; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== ring) continue
          const l = grid.get(`${gx + dx},${gy + dy},${gz + dz}`)
          if (!l) continue
          for (const j of l) { const d = (pts[j] - x) ** 2 + (pts[j + 1] - y) ** 2 + (pts[j + 2] - z) ** 2; if (d < bd) { bd = d; best = j } }
        }
      }
      if (best < 0) { out[i] = x; out[i + 1] = y; out[i + 2] = z } else { out[i] = pts[best]; out[i + 1] = pts[best + 1]; out[i + 2] = pts[best + 2] }
    }
  }
  b.targets.set(key, out)
  return out
}

// Puts the deformers and the morph on one mesh. Cheap when nothing changed.
// A shape needs enough points to curve: big flat faces (text, boxes) get
// more points once, the first time they are morphed or bent.
function dense(mesh: THREE.Mesh) {
  const g = mesh.geometry
  if (g.userData.dense) return
  // not built yet (a text still loading its font): try again next frame
  if (!g.getAttribute('position')?.count) return
  g.computeBoundingBox()
  const size = g.boundingBox!.getSize(new THREE.Vector3()).length() || 1
  const pos = g.getAttribute('position')
  let longest = 0
  const a = new THREE.Vector3(), b2 = new THREE.Vector3()
  const idx = g.index
  const tri = (idx ? idx.count : pos.count) / 3
  for (let i = 0; i < Math.min(tri, 20000); i++) {
    for (let e = 0; e < 3; e++) {
      const i0 = idx ? idx.getX(i * 3 + e) : i * 3 + e, i1 = idx ? idx.getX(i * 3 + ((e + 1) % 3)) : i * 3 + ((e + 1) % 3)
      a.fromBufferAttribute(pos, i0); b2.fromBufferAttribute(pos, i1)
      longest = Math.max(longest, a.distanceTo(b2))
    }
  }
  g.userData.dense = true
  if (longest < size / 14 || tri > 60000) return
  let out: THREE.BufferGeometry | null = null
  for (let iter = 6; iter >= 2 && !out; iter--) {
    const m = new TessellateModifier(size / 24, iter).modify(g.index ? g.toNonIndexed() : g)
    if ((m.getAttribute('position')?.count ?? Infinity) / 3 <= 160000) out = m
    else m.dispose()
  }
  if (!out) return
  out.userData.dense = true
  out.userData.pivot = g.userData.pivot
  mesh.geometry = out
}

export function rigMesh(mesh: THREE.Mesh, o: Obj3D, t: number, deformMul: number, morphAmt: number, findObj: (id: string) => THREE.Object3D | undefined, frame?: Frame, toObj?: THREE.Matrix4) {
  if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) return
  if (!mesh.geometry.getAttribute('position')?.count) return    // not built yet
  if ((o.morph?.style === 'points' && morphAmt > 0.0001) || o.deform?.some((d) => d.on !== false && (d.kind === 'bend' || d.kind === 'twist' || d.kind === 'wave'))) dense(mesh)
  const g = mesh.geometry
  const list = (o.deform ?? []).filter((d) => d.on !== false)
  const hasMorph = Boolean(o.morph && morphAmt > 0.0001 && o.morph.style === 'points')
  if (!list.length && !hasMorph) {
    const b = g.userData.rig as Base | undefined
    if (b && b.key !== '') {
      // back to the shape it was
      ;(g.getAttribute('position').array as Float32Array).set(b.pos)
      g.getAttribute('position').needsUpdate = true
      g.computeVertexNormals(); g.computeBoundingSphere(); g.computeBoundingBox()
      b.key = ''
    }
    return
  }
  const b = baseOf(g)
  const moving = list.some((d) => d.kind === 'wave')
  const key = `${JSON.stringify(list)}|${deformMul.toFixed(4)}|${o.morph?.to}|${morphAmt.toFixed(4)}|${moving ? t.toFixed(3) : ''}|${frame?.key ?? ''}`
  if (key === b.key) return
  b.key = key
  const attr = g.getAttribute('position') as THREE.BufferAttribute
  const arr = attr.array as Float32Array
  const target = hasMorph ? morphTarget(b, o.morph!.to, o.morph!.to === 'sphere' || o.morph!.to === 'cube' ? undefined : findObj(o.morph!.to), mesh, frame, toObj) : null
  const p = [0, 0, 0]
  for (let i = 0; i < arr.length; i += 3) {
    p[0] = b.pos[i]; p[1] = b.pos[i + 1]; p[2] = b.pos[i + 2]
    if (target) { p[0] += (target[i] - p[0]) * morphAmt; p[1] += (target[i + 1] - p[1]) * morphAmt; p[2] += (target[i + 2] - p[2]) * morphAmt }
    for (const d of list) deformPoint(p, d, b.box, d.amount * deformMul, t)
    arr[i] = p[0]; arr[i + 1] = p[1]; arr[i + 2] = p[2]
  }
  attr.needsUpdate = true
  g.computeVertexNormals()
  g.computeBoundingSphere()
  g.computeBoundingBox()
}

// For a whole object (every mesh of a model).
export function rigObject(obj: THREE.Object3D, o: Obj3D, t: number, deformMul: number, morphAmt: number, findObj: (id: string) => THREE.Object3D | undefined, others: () => Iterable<[string, THREE.Object3D]> = () => []) {
  // the symbiote and the fluid morph rebuild the surface themselves
  if (o.kind !== 'fluid' && o.symbiote?.on) {
    if (obj.userData.fluid) stopFluid(obj)
    if (symbiote(obj, o, t, others)) return
  } else if (obj.userData.symbiote) stopSymbiote(obj)
  if (o.kind !== 'fluid' && o.morph && (o.morph.style ?? 'fluid') === 'fluid' && !o.symbiote?.on) {
    if (fluidMorph(obj, o, morphAmt, t, findObj)) return
  } else if (obj.userData.fluid) stopFluid(obj)
  if (o.kind === 'shape' || o.kind === 'math-surface' || o.kind === 'math-solid' || o.kind === 'code-shape' || o.kind === 'fluid') return
  if (!o.deform?.length && !o.morph && !obj.userData.rigged) return
  obj.userData.rigged = true
  const meshes: THREE.Mesh[] = []
  obj.traverse((c) => { const m = c as THREE.Mesh; if (m.isMesh && !m.userData.helper && !m.userData.symArm && !isHelperChild(m)) meshes.push(m) })
  // the frame of the whole object, from its shape at rest, in its own space
  let frame: Frame | undefined
  const toObj = new Map<THREE.Mesh, THREE.Matrix4>()
  if (o.morph?.style === 'points' && morphAmt > 0.0001 && (o.morph.to === 'sphere' || o.morph.to === 'cube')) {
    obj.updateMatrixWorld(true)
    const inv = obj.matrixWorld.clone().invert()
    for (const m of meshes) { if (o.morph) dense(m); toObj.set(m, inv.clone().multiply(m.matrixWorld)) }
    const fk = meshes.map((m) => `${m.geometry.uuid}`).join() + toObj.size
    const have = obj.userData.mframe as Frame | undefined
    if (have && have.key === fk) frame = have
    else {
      const box = new THREE.Box3()
      const v = new THREE.Vector3()
      for (const m of meshes) {
        if (!m.geometry.getAttribute('position')?.count) continue
        const b = baseOf(m.geometry)
        const M = toObj.get(m)!
        for (let i = 0; i < b.pos.length; i += 3) box.expandByPoint(v.set(b.pos[i], b.pos[i + 1], b.pos[i + 2]).applyMatrix4(M))
      }
      const h = box.getSize(new THREE.Vector3()).multiplyScalar(0.5)
      const sorted = [h.x, h.y, h.z].sort((a, b) => b - a)
      frame = { key: fk, c: box.getCenter(new THREE.Vector3()), h, r: (sorted[0] + sorted[1]) / 2 }
      obj.userData.mframe = frame
    }
  }
  for (const m of meshes) rigMesh(m, o, t, deformMul, morphAmt, findObj, frame, toObj.get(m))
}
function isHelperChild(o: THREE.Object3D): boolean { for (let p = o.parent; p; p = p.parent) if (p.userData.helper) return true; return false }

// Detail matters for bending: a plain box has 8 points and would not bend.
export function needsDetail(o: Obj3D) { return Boolean(o.deform?.some((d) => d.on !== false && d.kind !== 'squash' && d.kind !== 'taper')) }
