import * as THREE from 'three'
import { withKeys } from './keyed'
import { useSyncExternalStore } from 'react'
import { FLUID_DEFAULT, PHYSICS_DEFAULT, type Obj3D, type World3D } from './world'

// Light, quick simulation for live work: gravity, things bumping into each
// other and the floor, breaking into pieces, and a small liquid. It is made
// to look right and run fast, not to be exact. Press Play in the 3D strip:
// the scene falls from where you built it. Reset puts everything back, and
// Keep makes the new places the real ones.

interface Body {
  id: string
  obj: THREE.Object3D
  pos: THREE.Vector3
  vel: THREE.Vector3
  quat: THREE.Quaternion
  spin: THREE.Vector3
  r: number                 // reach from the middle (for bumping)
  low: number               // how far the bottom is below the middle
  still: boolean
  bounce: number
  friction: number
  mass: number
}

interface Piece { mesh: THREE.Mesh; body: Body }
interface Fluid { id: string; inst: THREE.InstancedMesh; p: Float32Array; v: Float32Array; n: number; set: typeof FLUID_DEFAULT; box: THREE.Box3 }

const st = { playing: false, t: 0, gravity: 9.8, floor: true, wind: 0 }
let ver = 0
const ls = new Set<() => void>()
const emit = () => { ver++; ls.forEach((l) => l()) }
export function useSim() { useSyncExternalStore((l) => { ls.add(l); return () => ls.delete(l) }, () => ver); return st }
export const simPlaying = () => st.playing

let bodies = new Map<string, Body>()
let pieces: { id: string; list: Piece[]; scene: THREE.Object3D }[] = []
let fluids = new Map<string, Fluid>()
let started = false

export function playSim() { st.playing = true; emit() }
export function pauseSim() { st.playing = false; emit() }
export function setSim(part: Partial<typeof st>) { Object.assign(st, part); emit() }
export function resetSim() {
  st.playing = false; st.t = 0
  for (const p of pieces) { for (const x of p.list) { p.scene.remove(x.mesh); x.mesh.geometry.dispose() } }
  pieces = []
  bodies = new Map()
  for (const f of fluids.values()) resetFluid(f)
  started = false
  emit()
}
// Where things ended up, to keep them (the caller writes them into the scene).
export function simPlaces(): { id: string; position: [number, number, number]; rotation: [number, number, number] }[] {
  const out: { id: string; position: [number, number, number]; rotation: [number, number, number] }[] = []
  for (const b of bodies.values()) {
    if (b.still) continue
    const e = new THREE.Euler().setFromQuaternion(b.quat)
    out.push({ id: b.id, position: [b.pos.x, b.pos.y, b.pos.z], rotation: [e.x * 180 / Math.PI, e.y * 180 / Math.PI, e.z * 180 / Math.PI] })
  }
  return out
}

function bodyOf(o: Obj3D, obj: THREE.Object3D): Body {
  obj.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(obj)
  const size = box.getSize(new THREE.Vector3())
  const ph = { ...PHYSICS_DEFAULT, ...(o.physics ?? {}) }
  const pos = obj.position.clone()
  return {
    id: o.id, obj, pos, vel: new THREE.Vector3(), quat: obj.quaternion.clone(), spin: new THREE.Vector3(),
    r: Math.max(0.05, Math.max(size.x, size.y, size.z) * 0.5), low: Math.max(0.02, pos.y - box.min.y),
    still: Boolean(ph.still), bounce: ph.bounce, friction: ph.friction, mass: Math.max(0.05, ph.mass),
  }
}

// Breaking: the shape is cut into pieces around random points, and the
// pieces fly apart. Each piece is a body of its own.
function shatter(o: Obj3D, obj: THREE.Object3D, scene: THREE.Scene) {
  const n = Math.max(2, Math.min(60, Math.round(o.physics?.pieces ?? 12)))
  const blast = o.physics?.blast ?? 2
  obj.updateMatrixWorld(true)
  const list: Piece[] = []
  const center = new THREE.Box3().setFromObject(obj).getCenter(new THREE.Vector3())
  obj.traverse((c) => {
    const m = c as THREE.Mesh
    if (!m.isMesh || m.userData.helper) return
    const g0 = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()
    g0.applyMatrix4(m.matrixWorld)
    const pos = g0.getAttribute('position') as THREE.BufferAttribute
    const nrm = g0.getAttribute('normal') as THREE.BufferAttribute | undefined
    const box = new THREE.Box3().setFromBufferAttribute(pos)
    const size = box.getSize(new THREE.Vector3())
    const seeds = Array.from({ length: n }, () => new THREE.Vector3(box.min.x + Math.random() * size.x, box.min.y + Math.random() * size.y, box.min.z + Math.random() * size.z))
    const buckets: number[][] = seeds.map(() => [])
    const a = new THREE.Vector3(), b = new THREE.Vector3(), cc = new THREE.Vector3()
    for (let t = 0; t < pos.count; t += 3) {
      a.fromBufferAttribute(pos, t); b.fromBufferAttribute(pos, t + 1); cc.fromBufferAttribute(pos, t + 2)
      const mid = a.add(b).add(cc).multiplyScalar(1 / 3)
      let best = 0, bd = Infinity
      seeds.forEach((s, i) => { const d = s.distanceToSquared(mid); if (d < bd) { bd = d; best = i } })
      buckets[best].push(t)
    }
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.Material
    buckets.forEach((tris, i) => {
      if (!tris.length) return
      const p = new Float32Array(tris.length * 9), q = new Float32Array(tris.length * 9)
      tris.forEach((t, j) => {
        for (let k = 0; k < 3; k++) {
          p.set([pos.getX(t + k) - seeds[i].x, pos.getY(t + k) - seeds[i].y, pos.getZ(t + k) - seeds[i].z], j * 9 + k * 3)
          if (nrm) q.set([nrm.getX(t + k), nrm.getY(t + k), nrm.getZ(t + k)], j * 9 + k * 3)
        }
      })
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(p, 3))
      if (nrm) g.setAttribute('normal', new THREE.BufferAttribute(q, 3)); else g.computeVertexNormals()
      const pm = mat.clone()
      pm.side = THREE.DoubleSide
      const mesh = new THREE.Mesh(g, pm)
      mesh.position.copy(seeds[i])
      mesh.castShadow = true
      scene.add(mesh)
      const gb = new THREE.Box3().setFromBufferAttribute(g.getAttribute('position') as THREE.BufferAttribute)
      const out = seeds[i].clone().sub(center).normalize().multiplyScalar(blast * (0.5 + Math.random()))
      const body: Body = {
        id: `${o.id}#${i}`, obj: mesh, pos: seeds[i].clone(), vel: out.add(new THREE.Vector3(0, blast * 0.5, 0)), quat: new THREE.Quaternion(),
        spin: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(blast * 3),
        r: Math.max(0.02, gb.getSize(new THREE.Vector3()).length() * 0.35), low: Math.max(0.01, -gb.min.y * 0.8), still: false,
        bounce: o.physics?.bounce ?? 0.3, friction: o.physics?.friction ?? 0.5, mass: 0.2,
      }
      list.push({ mesh, body })
    })
  })
  obj.visible = false
  pieces.push({ id: o.id, list, scene })
}

function start(world: World3D, objs: Map<string, { obj: THREE.Object3D }>, scene: THREE.Scene) {
  started = true
  for (const o of world.objects) {
    const e = objs.get(o.id)
    if (!e || !o.visible) continue
    if (o.physics?.on) {
      if ((o.physics.pieces ?? 0) > 1 && !o.physics.still) shatter(o, e.obj, scene)
      else bodies.set(o.id, bodyOf(o, e.obj))
    }
  }
}

const tmp = new THREE.Vector3(), axis = new THREE.Vector3(), dq = new THREE.Quaternion()
function stepBodies(dt: number, list: Body[]) {
  for (const b of list) {
    if (b.still) continue
    b.vel.y -= st.gravity * dt
    b.vel.x += st.wind * dt
    b.pos.addScaledVector(b.vel, dt)
    // the floor
    if (st.floor && b.pos.y - b.low < 0) {
      b.pos.y = b.low
      if (b.vel.y < 0) b.vel.y = -b.vel.y * b.bounce
      if (Math.abs(b.vel.y) < 0.15) b.vel.y = 0
      const f = Math.max(0, 1 - b.friction * dt * 6)
      b.vel.x *= f; b.vel.z *= f
      // rolls along the floor
      axis.set(b.vel.z, 0, -b.vel.x)
      if (axis.lengthSq() > 1e-6) b.spin.lerp(axis.multiplyScalar(1 / b.r), 0.2)
      b.spin.multiplyScalar(Math.max(0, 1 - b.friction * dt * 2))
    }
    const w = b.spin.length()
    if (w > 1e-4) { dq.setFromAxisAngle(tmp.copy(b.spin).multiplyScalar(1 / w), w * dt); b.quat.premultiply(dq) }
  }
  // bumping into each other (as balls)
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], c = list[j]
    if (a.still && c.still) continue
    tmp.subVectors(c.pos, a.pos)
    const d = tmp.length(), min = a.r + c.r
    if (d >= min || d < 1e-6) continue
    const nrm = tmp.multiplyScalar(1 / d)
    const push = min - d
    const wa = a.still ? 0 : 1 / a.mass, wc = c.still ? 0 : 1 / c.mass, sum = wa + wc || 1
    a.pos.addScaledVector(nrm, -push * wa / sum)
    c.pos.addScaledVector(nrm, push * wc / sum)
    const rel = c.vel.clone().sub(a.vel).dot(nrm)
    if (rel < 0) {
      const e = Math.min(a.bounce, c.bounce)
      const jmp = -(1 + e) * rel / sum
      a.vel.addScaledVector(nrm, -jmp * wa)
      c.vel.addScaledVector(nrm, jmp * wc)
    }
  }
}

// liquid: particles that push apart, stick together a little, and pour
export function buildFluid(o: Obj3D, material: THREE.Material): THREE.Object3D {
  const set = { ...FLUID_DEFAULT, ...(o.fluid ?? {}) }
  const n = Math.max(50, Math.min(4000, Math.round(set.count)))
  const inst = new THREE.InstancedMesh(new THREE.SphereGeometry(set.size, 10, 8), material, n)
  inst.castShadow = true
  inst.frustumCulled = false
  const f: Fluid = { id: o.id, inst, p: new Float32Array(n * 3), v: new Float32Array(n * 3), n, set, box: new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5)) }
  resetFluid(f)
  fluids.set(o.id, f)
  inst.userData.fluid = o.id
  const group = new THREE.Group()
  group.add(inst)
  return group
}
export function dropFluid(id: string) { fluids.delete(id) }

function resetFluid(f: Fluid) {
  // a block of liquid where you put it, the size of the object
  const side = Math.ceil(Math.cbrt(f.n))
  for (let i = 0; i < f.n; i++) {
    const x = i % side, y = Math.floor(i / side) % side, z = Math.floor(i / side / side)
    f.p[i * 3] = (x / side - 0.5) * 0.9 + (Math.random() - 0.5) * 0.01
    f.p[i * 3 + 1] = (y / side - 0.5) * 0.9
    f.p[i * 3 + 2] = (z / side - 0.5) * 0.9 + (Math.random() - 0.5) * 0.01
    f.v[i * 3] = f.v[i * 3 + 1] = f.v[i * 3 + 2] = 0
  }
  writeFluid(f)
}
const m4 = new THREE.Matrix4()
function writeFluid(f: Fluid) {
  for (let i = 0; i < f.n; i++) { m4.makeTranslation(f.p[i * 3], f.p[i * 3 + 1], f.p[i * 3 + 2]); f.inst.setMatrixAt(i, m4) }
  f.inst.instanceMatrix.needsUpdate = true
}

function stepFluid(f: Fluid, dt: number, holder: THREE.Object3D, colliders: Body[]) {
  // the liquid moves in the object's own space; the floor is at world y = 0
  holder.updateMatrixWorld(true)
  const inv = holder.matrixWorld.clone().invert()
  const sc = holder.getWorldScale(new THREE.Vector3())
  const floorY = new THREE.Vector3(0, 0, 0).applyMatrix4(inv).y
  const g = new THREE.Vector3(0, -st.gravity, 0).transformDirection(inv).multiplyScalar(st.gravity / Math.max(0.01, sc.y))
  const h = f.set.size * 2.2 / Math.max(0.01, sc.x)
  const cell = h
  const grid = new Map<number, number[]>()
  const key = (x: number, y: number, z: number) => ((Math.floor(x / cell) + 512) * 1048576 + (Math.floor(y / cell) + 512) * 1024 + (Math.floor(z / cell) + 512))
  const steps = 2, sdt = dt / steps
  for (let s = 0; s < steps; s++) {
    grid.clear()
    for (let i = 0; i < f.n; i++) { const k = key(f.p[i * 3], f.p[i * 3 + 1], f.p[i * 3 + 2]); let l = grid.get(k); if (!l) grid.set(k, (l = [])); l.push(i) }
    for (let i = 0; i < f.n; i++) {
      const ix = i * 3
      f.v[ix] += g.x * sdt; f.v[ix + 1] += g.y * sdt; f.v[ix + 2] += g.z * sdt
      const px = f.p[ix], py = f.p[ix + 1], pz = f.p[ix + 2]
      const gx = Math.floor(px / cell), gy = Math.floor(py / cell), gz = Math.floor(pz / cell)
      let ax = 0, ay = 0, az = 0, vx = 0, vy = 0, vz = 0, cnt = 0
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const l = grid.get(((gx + dx) + 512) * 1048576 + ((gy + dy) + 512) * 1024 + ((gz + dz) + 512))
        if (!l) continue
        for (const j of l) {
          if (j === i) continue
          const jx = j * 3
          const rx = px - f.p[jx], ry = py - f.p[jx + 1], rz = pz - f.p[jx + 2]
          const d2 = rx * rx + ry * ry + rz * rz
          if (d2 >= h * h || d2 < 1e-12) continue
          const d = Math.sqrt(d2), q = 1 - d / h
          // push apart when close, pull together a little (surface), share speed (thickness)
          const push = q * q * 60 - q * 6
          ax += (rx / d) * push; ay += (ry / d) * push; az += (rz / d) * push
          vx += f.v[jx]; vy += f.v[jx + 1]; vz += f.v[jx + 2]; cnt++
        }
      }
      f.v[ix] += ax * sdt * h; f.v[ix + 1] += ay * sdt * h; f.v[ix + 2] += az * sdt * h
      if (cnt) {
        const k = Math.min(1, f.set.thick * sdt * 20)
        f.v[ix] += (vx / cnt - f.v[ix]) * k; f.v[ix + 1] += (vy / cnt - f.v[ix + 1]) * k; f.v[ix + 2] += (vz / cnt - f.v[ix + 2]) * k
      }
    }
    for (let i = 0; i < f.n; i++) {
      const ix = i * 3
      f.p[ix] += f.v[ix] * sdt; f.p[ix + 1] += f.v[ix + 1] * sdt; f.p[ix + 2] += f.v[ix + 2] * sdt
      const r = f.set.size / Math.max(0.01, sc.y)
      if (st.floor && f.p[ix + 1] < floorY + r) { f.p[ix + 1] = floorY + r; f.v[ix + 1] *= -0.2; f.v[ix] *= 0.98; f.v[ix + 2] *= 0.98 }
      if (f.set.box) {
        // the object's box holds the liquid like a glass tank (open on top)
        for (const [k, lo, hi] of [[0, -0.5, 0.5], [2, -0.5, 0.5]] as const) {
          if (f.p[ix + k] < lo + r) { f.p[ix + k] = lo + r; f.v[ix + k] *= -0.3 }
          if (f.p[ix + k] > hi - r) { f.p[ix + k] = hi - r; f.v[ix + k] *= -0.3 }
        }
        if (f.p[ix + 1] < -0.5 + r) { f.p[ix + 1] = -0.5 + r; f.v[ix + 1] *= -0.2 }
      }
    }
    // around the things that have physics
    for (const b of colliders) {
      const c = b.pos.clone().applyMatrix4(inv)
      const rr = b.r / Math.max(0.01, sc.x) + f.set.size / Math.max(0.01, sc.x)
      for (let i = 0; i < f.n; i++) {
        const ix = i * 3
        const rx = f.p[ix] - c.x, ry = f.p[ix + 1] - c.y, rz = f.p[ix + 2] - c.z
        const d2 = rx * rx + ry * ry + rz * rz
        if (d2 >= rr * rr || d2 < 1e-12) continue
        const d = Math.sqrt(d2), k = (rr - d) / d
        f.p[ix] += rx * k; f.p[ix + 1] += ry * k; f.p[ix + 2] += rz * k
        const vn = (f.v[ix] * rx + f.v[ix + 1] * ry + f.v[ix + 2] * rz) / d
        if (vn < 0) { f.v[ix] -= (rx / d) * vn * 1.2; f.v[ix + 1] -= (ry / d) * vn * 1.2; f.v[ix + 2] -= (rz / d) * vn * 1.2 }
      }
    }
  }
  writeFluid(f)
}

// Called by the 3D engine every frame, after it has placed things.
export function stepSim(dt: number, world: World3D, objs: Map<string, { obj: THREE.Object3D }>, scene: THREE.Scene) {
  if (!st.playing) {
    if (!started) return
    applyBodies()
    return
  }
  if (!started) start(world, objs, scene)
  // new things with physics, added while it runs
  for (const o of world.objects) if (o.physics?.on && !bodies.has(o.id) && !pieces.some((p) => p.id === o.id)) { const e = objs.get(o.id); if (e) bodies.set(o.id, bodyOf(o, e.obj)) }
  // small steps, so things do not pass through each other on a slow frame
  const total = Math.min(0.1, dt)
  const n = Math.max(1, Math.min(6, Math.ceil(total / (1 / 60))))
  st.t += total
  const list = [...bodies.values(), ...pieces.flatMap((p) => p.list.map((x) => x.body))]
  // keys on the timeline change bounce, friction and weight while it runs
  const byId = new Map(world.objects.map((o) => [o.id, o]))
  for (const b of list) {
    const src = byId.get(b.id.split('#')[0])
    if (!src) continue
    const ph = withKeys(src).physics
    if (!ph) continue
    b.bounce = ph.bounce; b.friction = ph.friction
    if (!b.id.includes('#')) b.mass = Math.max(0.05, ph.mass)
  }
  for (const f of fluids.values()) { const src = byId.get(f.id); if (src) { const fl = withKeys(src).fluid; if (fl) f.set = { ...f.set, thick: fl.thick } } }
  for (let i = 0; i < n; i++) stepBodies(total / n, list)
  for (const f of fluids.values()) { const holder = objs.get(f.id)?.obj; if (holder) stepFluid(f, Math.min(1 / 30, total), holder, list) }
  applyBodies()
}
function applyBodies() {
  for (const b of bodies.values()) { if (!b.still) { b.obj.position.copy(b.pos); b.obj.quaternion.copy(b.quat) } }
  for (const p of pieces) for (const x of p.list) { x.mesh.position.copy(x.body.pos); x.mesh.quaternion.copy(x.body.quat) }
}
// While it runs, the engine leaves these alone.
export const simOwns = (id: string) => started && (bodies.has(id) && !bodies.get(id)!.still || pieces.some((p) => p.id === id))
export const simHides = (id: string) => pieces.some((p) => p.id === id)
