import * as THREE from 'three'
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js'

// Shape building: primitives, surfaces from
// math, shapes from code, and changes on top (bend, twist, displace, copy).
// Used by geometry nodes and by the math shapes in the 3D playground.

export { THREE }

const MATH = 'const {sin,cos,tan,asin,acos,atan,atan2,abs,floor,ceil,round,min,max,pow,sqrt,exp,log,sign,hypot,PI,random}=Math;const TAU=PI*2;const clamp=(x,l=0,h=1)=>min(h,max(l,x));const mix=(a,b,t)=>a+(b-a)*t;const fract=(x)=>x-floor(x);'

// ---- noise for displacement ----
const perm = new Uint8Array(512)
{
  const p = Array.from({ length: 256 }, (_, i) => i)
  let seed = 1337
  for (let i = 255; i > 0; i--) {
    seed = (seed * 16807) % 2147483647
    const j = seed % (i + 1)
    ;[p[i], p[j]] = [p[j], p[i]]
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]
}
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)
function grad(h: number, x: number, y: number, z: number) {
  const u = h < 8 ? x : y, v = h < 4 ? y : h === 12 || h === 14 ? x : z
  return ((h & 1) ? -u : u) + ((h & 2) ? -v : v)
}
export function noise3(x: number, y: number, z: number) {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255
  x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z)
  const u = fade(x), v = fade(y), w = fade(z)
  const A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z, B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z
  const l = (a: number, b: number, t: number) => a + t * (b - a)
  return l(l(l(grad(perm[AA] & 15, x, y, z), grad(perm[BA] & 15, x - 1, y, z), u), l(grad(perm[AB] & 15, x, y - 1, z), grad(perm[BB] & 15, x - 1, y - 1, z), u), v),
    l(l(grad(perm[AA + 1] & 15, x, y, z - 1), grad(perm[BA + 1] & 15, x - 1, y, z - 1), u), l(grad(perm[AB + 1] & 15, x, y - 1, z - 1), grad(perm[BB + 1] & 15, x - 1, y - 1, z - 1), u), v), w)
}

// ---- making shapes ----

export const PRIMITIVES = ['Sphere', 'Cube', 'Donut', 'Knot', 'Plane', 'Cylinder', 'Crystal', 'Cone']

export function primitive(kind: number, detail: number): THREE.BufferGeometry {
  const d = Math.max(1, Math.round(detail))
  switch (kind) {
    case 1: return new THREE.BoxGeometry(1, 1, 1, d, d, d)
    case 2: return new THREE.TorusGeometry(0.55, 0.22, 8 * d, 24 * d)
    case 3: return new THREE.TorusKnotGeometry(0.5, 0.16, 48 * d, 8 * d)
    case 4: return new THREE.PlaneGeometry(2, 2, 8 * d, 8 * d).rotateX(-Math.PI / 2)
    case 5: return new THREE.CylinderGeometry(0.5, 0.5, 1.2, 16 * d, 4 * d)
    case 6: return new THREE.IcosahedronGeometry(0.7, Math.min(5, d - 1))
    case 7: return new THREE.ConeGeometry(0.6, 1.2, 16 * d, 4 * d)
    default: return new THREE.SphereGeometry(0.6, 16 * d, 8 * d)
  }
}

type Fn3 = (u: number, v: number, t: number, a: number, b: number) => number

const fnCache = new Map<string, Fn3 | null>()
function compileExpr(expr: string, args: string[]): Fn3 | null {
  const key = `${args.join()}|${expr}`
  if (fnCache.has(key)) return fnCache.get(key)!
  let fn: Fn3 | null = null
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    fn = new Function(...args, `${MATH}return (${expr});`) as Fn3
    fn(0.5, 0.5, 0, 0, 0)
  } catch {
    fn = null
  }
  fnCache.set(key, fn)
  if (fnCache.size > 300) fnCache.delete(fnCache.keys().next().value!)
  return fn
}

// A surface from three formulas of u and v (both 0 to 1), like a sphere:
// x = sin(v*PI)*cos(u*TAU), y = cos(v*PI), z = sin(v*PI)*sin(u*TAU)
export function parametric(xs: string, ys: string, zs: string, resU: number, resV: number, t: number, a: number, b: number): THREE.BufferGeometry | string {
  const fx = compileExpr(xs, ['u', 'v', 't', 'a', 'b']), fy = compileExpr(ys, ['u', 'v', 't', 'a', 'b']), fz = compileExpr(zs, ['u', 'v', 't', 'a', 'b'])
  if (!fx || !fy || !fz) return `A formula has a mistake: ${!fx ? 'x' : !fy ? 'y' : 'z'}`
  const nu = Math.max(2, Math.min(512, Math.round(resU))), nv = Math.max(2, Math.min(512, Math.round(resV)))
  const pos = new Float32Array((nu + 1) * (nv + 1) * 3), uv = new Float32Array((nu + 1) * (nv + 1) * 2)
  let k = 0, m = 0
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const u = i / nu, v = j / nv
      pos[k++] = Number(fx(u, v, t, a, b)) || 0
      pos[k++] = Number(fy(u, v, t, a, b)) || 0
      pos[k++] = Number(fz(u, v, t, a, b)) || 0
      uv[m++] = u
      uv[m++] = v
    }
  }
  const index: number[] = []
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const p = j * (nu + 1) + i
    index.push(p, p + nu + 1, p + 1, p + 1, p + nu + 1, p + nu + 2)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  g.setIndex(index)
  g.computeVertexNormals()
  return g
}

// A closed shape where a formula of x, y, z is below zero (an implicit
// surface, like a signed distance field): x*x + y*y + z*z - 0.5 is a ball.
let cubes: MarchingCubes | null = null
let cubesRes = 0
export function implicit(expr: string, res: number, size: number, t: number, a: number, b: number): THREE.BufferGeometry | string {
  const f = compileExpr(expr, ['x', 'y', 'z', 't', 'a', 'b']) as unknown as ((x: number, y: number, z: number, t: number, a: number, b: number) => number) | null
  if (!f) return 'The formula has a mistake.'
  const r = Math.max(16, Math.min(96, Math.round(res)))
  if (!cubes || cubesRes !== r) {
    cubes = new MarchingCubes(r, new THREE.MeshBasicMaterial(), true, false, 200000)
    cubesRes = r
  }
  const mc = cubes
  mc.reset()
  mc.isolation = 0
  const half = mc.size / 2
  for (let z = 0; z < mc.size; z++) for (let y = 0; y < mc.size; y++) for (let x = 0; x < mc.size; x++) {
    const fx = ((x - half) / half) * size, fy = ((y - half) / half) * size, fz = ((z - half) / half) * size
    mc.field[x + y * mc.size + z * mc.size2] = -(Number(f(fx, fy, fz, t, a, b)) || 0)
  }
  mc.update()
  const count = mc.count
  const src = mc.geometry
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute((src.getAttribute('position').array as Float32Array).slice(0, count * 3).map((v) => v * size), 3))
  g.setAttribute('normal', new THREE.BufferAttribute((src.getAttribute('normal').array as Float32Array).slice(0, count * 3), 3))
  const uvAttr = src.getAttribute('uv')
  if (uvAttr) g.setAttribute('uv', new THREE.BufferAttribute((uvAttr.array as Float32Array).slice(0, count * 2), 2))
  return g
}

// A shape from your own code. Push points and triangles, or return any
// three.js geometry (THREE is there for you):
//   for (let i = 0; i < 100; i++) point(sin(i), i / 50, cos(i))
//   tri(0, 1, 2)
export function fromCode(code: string, t: number, a: number, b: number, c: number): THREE.BufferGeometry | string {
  const pos: number[] = [], idx: number[] = []
  const point = (x: number, y: number, z: number) => { pos.push(x, y, z); return pos.length / 3 - 1 }
  const tri = (i: number, j: number, k: number) => { idx.push(i, j, k) }
  const quad = (i: number, j: number, k: number, l: number) => { idx.push(i, j, k, i, k, l) }
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function('THREE', 'point', 'tri', 'quad', 't', 'a', 'b', 'c', `${MATH}\n${code}`)
    const res = fn(THREE, point, tri, quad, t, a, b, c)
    if (res instanceof THREE.BufferGeometry) return res
    if (!pos.length) return 'The code made no points. Use point(x, y, z) and tri(i, j, k).'
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    if (idx.length) g.setIndex(idx)
    g.computeVertexNormals()
    return g
  } catch (e) {
    return (e as Error).message
  }
}

// ---- changing shapes (each returns a new geometry) ----

function prep(g: THREE.BufferGeometry) {
  const out = g.clone()
  if (!out.getAttribute('normal')) out.computeVertexNormals()
  return out
}

export function displace(g: THREE.BufferGeometry, amount: number, scale: number, t: number) {
  const out = prep(g)
  const p = out.getAttribute('position') as THREE.BufferAttribute
  const nrm = out.getAttribute('normal') as THREE.BufferAttribute
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i)
    const d = noise3(x * scale + t * 0.3, y * scale, z * scale - t * 0.2) * amount
    p.setXYZ(i, x + nrm.getX(i) * d, y + nrm.getY(i) * d, z + nrm.getZ(i) * d)
  }
  out.computeVertexNormals()
  return out
}

export function twist(g: THREE.BufferGeometry, amount: number, axis: number) {
  const out = prep(g)
  const p = out.getAttribute('position') as THREE.BufferAttribute
  for (let i = 0; i < p.count; i++) {
    const v = [p.getX(i), p.getY(i), p.getZ(i)]
    const along = v[axis]
    const a = along * amount
    const [i1, i2] = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1]
    const c = Math.cos(a), s = Math.sin(a)
    const x = v[i1], y = v[i2]
    v[i1] = x * c - y * s
    v[i2] = x * s + y * c
    p.setXYZ(i, v[0], v[1], v[2])
  }
  out.computeVertexNormals()
  return out
}

export function wave(g: THREE.BufferGeometry, amp: number, freq: number, speed: number, t: number) {
  const out = prep(g)
  const p = out.getAttribute('position') as THREE.BufferAttribute
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i)
    p.setY(i, y + Math.sin(x * freq + t * speed) * Math.cos(z * freq * 0.8 + t * speed * 0.7) * amp)
  }
  out.computeVertexNormals()
  return out
}

export function transform(g: THREE.BufferGeometry, tx: number, ty: number, tz: number, rx: number, ry: number, rz: number, s: number) {
  const out = g.clone()
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(tx, ty, tz),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx * Math.PI / 180, ry * Math.PI / 180, rz * Math.PI / 180)),
    new THREE.Vector3(s, s, s),
  )
  out.applyMatrix4(m)
  return out
}

function plain(g: THREE.BufferGeometry) {
  const x = g.index ? g.toNonIndexed() : g.clone()
  for (const name of Object.keys(x.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') x.deleteAttribute(name)
  if (!x.getAttribute('normal')) x.computeVertexNormals()
  return x
}

export function merge(list: THREE.BufferGeometry[]) {
  const parts = list.filter(Boolean).map(plain)
  if (!parts.length) return new THREE.BufferGeometry()
  const withUv = parts.every((p) => p.getAttribute('uv'))
  const total = parts.reduce((s, p) => s + p.getAttribute('position').count, 0)
  const pos = new Float32Array(total * 3), nrm = new Float32Array(total * 3), uv = withUv ? new Float32Array(total * 2) : null
  let o = 0
  for (const p of parts) {
    const n = p.getAttribute('position').count
    pos.set(p.getAttribute('position').array as Float32Array, o * 3)
    nrm.set(p.getAttribute('normal').array as Float32Array, o * 3)
    if (uv) uv.set(p.getAttribute('uv').array as Float32Array, o * 2)
    o += n
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3))
  if (uv) g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  return g
}

// Copies of a shape in a row, a circle or a spiral (Array modifier, instances).
export function array(g: THREE.BufferGeometry, count: number, mode: number, spacing: number, turn: number, grow: number) {
  const n = Math.max(1, Math.min(500, Math.round(count)))
  const copies: THREE.BufferGeometry[] = []
  for (let i = 0; i < n; i++) {
    const s = Math.pow(grow, i)
    let tx = 0, ty = 0, tz = 0
    if (mode === 0) tx = (i - (n - 1) / 2) * spacing
    else if (mode === 1) { const a = (i / n) * Math.PI * 2; tx = Math.cos(a) * spacing; tz = Math.sin(a) * spacing }
    else { const a = i * 0.5; tx = Math.cos(a) * spacing * (1 + i * 0.1); tz = Math.sin(a) * spacing * (1 + i * 0.1); ty = i * spacing * 0.15 }
    copies.push(transform(g, tx, ty, tz, 0, i * turn, 0, s))
  }
  return merge(copies)
}

export function vertexCount(g: THREE.BufferGeometry) {
  return g.getAttribute('position')?.count ?? 0
}
