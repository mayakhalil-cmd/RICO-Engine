import * as THREE from 'three'
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js'
import { meshesOf, noise3, sdfOf, trianglesOf } from './fluidMorph'
import type { Obj3D } from './world'
import { symOf } from './symbioteParams'

// The symbiote: a living alien goo, moving the way the symbiote in the films
// does.
//
// The body: the object's shape is rebuilt once as one closed, smooth skin
// (rounder with Blob). Every frame that skin crawls, swells and breathes, with
// lumps and ridges flowing over it. Veins run under the skin: they show
// through it, push it out a little and throb with a beat.
//
// Tendrils: only toward things closer than Reach, from the side that faces
// them, shooting out fast one after another, a few thick ones and many thin
// ones. Each one rises out of a soft, uneven mound of skin, whips on the way,
// and grabs on with a spreading grip. It is a bundle: a main strand with
// thinner strands along it. Pull the two apart and the bundle sags, opens into
// a web of strings and gets thin in the middle. Each tendril snaps at its own
// point: the body half springs back with a wobble and its loose end curls, a
// piece left on the other thing pulls back into it, the last thin strings hold
// a moment longer and break into drips. Drips fall with gravity and puddle on
// a floor, then stay or fade away.
//
// Two symbiotes reach for each other: where one's tendrils land, the other's
// skin rises to meet them.

type Sy = ReturnType<typeof symOf>

interface Arm {
  target: string
  at: THREE.Vector3          // where it holds, in the target's own space
  atN: THREE.Vector3
  ri: number                 // the skin point it grows from
  size: number               // thick or thin, around 1
  grow: number               // 0..1
  hold: number               // 0..1 how far the grip has spread
  leaving: boolean
  broke: boolean
  brokeT: number
  breakU: number             // where along it it tears
  breakL: number             // how long it was when it tore
  strD: boolean[]            // the last strings: already dripped
  dripped: boolean
  breakAt: number            // its own let go distance
  seed: number
  lastB?: THREE.Vector3
  lastN?: THREE.Vector3
}
interface Drip { p: THREE.Vector3; v: THREE.Vector3; r: number; floor: number | null; age: number; flat: number; seed: number }
interface State {
  key: string; size: number
  base: Float32Array; baseN: Float32Array       // the skin at rest, this object's space
  cur: Float32Array                              // the skin this frame
  samples: Int32Array                            // a few skin points to grow from
  body: THREE.Mesh; geo: THREE.BufferGeometry; rest: THREE.BufferGeometry; hidden: THREE.Mesh[]
  toMesh: THREE.Matrix4 | null
  mat: THREE.MeshPhysicalMaterial; own: THREE.Material | THREE.Material[]
  tube: THREE.Mesh; cap: number
  drips: Drip[]; dripMesh: THREE.InstancedMesh
  arms: Arm[]; lastT: number
  lastSpawn: Map<string, number>
  disp?: Float32Array
  spawnN?: number
}

// ---- floors, set by the 3D view each frame (world boxes) ----
let floors: THREE.Box3[] = []
export function setSymbioteFloors(b: THREE.Box3[]) { floors = b }
const floorUnder = (p: THREE.Vector3) => {
  let best: number | null = null
  for (const b of floors) if (p.x >= b.min.x && p.x <= b.max.x && p.z >= b.min.z && p.z <= b.max.z && b.max.y <= p.y + 1e-3 && (best === null || b.max.y > best)) best = b.max.y
  return best
}

// ---- where other symbiotes' tendrils land on this one (world space, one frame late) ----
const incoming = new Map<THREE.Object3D, Map<THREE.Object3D, { p: THREE.Vector3; d: THREE.Vector3; h: number }[]>>()

// points and directions on each thing's surface, in its own space (kept while its shape stays)
const pointCache = new WeakMap<THREE.Object3D, { key: string; pts: Float32Array; nrm: Float32Array }>()
function surfacePoints(o3: THREE.Object3D) {
  const sym = o3.userData.symbiote as State | undefined
  const meshes = sym ? [sym.body] : meshesOf(o3).filter((m) => !m.userData.symArm)
  const key = sym ? `sym:${sym.key}` : meshes.map((m) => m.geometry.uuid).join()
  const have = pointCache.get(o3)
  if (have && have.key === key) return have
  o3.updateMatrixWorld(true)
  const inv = o3.matrixWorld.clone().invert()
  const out: number[] = [], on: number[] = []
  const v = new THREE.Vector3(), nv = new THREE.Vector3()
  if (sym) {
    // another symbiote: its skin points are spread evenly already
    const g = sym.geo, p = g.getAttribute('position'), nA = g.getAttribute('normal')
    const M = inv.clone().multiply(sym.body.matrixWorld)
    const NM = new THREE.Matrix3().getNormalMatrix(M)
    const step = Math.max(1, Math.ceil(p.count / 360))
    for (let i = 0; i < p.count; i += step) {
      v.fromBufferAttribute(p, i).applyMatrix4(M); out.push(v.x, v.y, v.z)
      nv.fromBufferAttribute(nA, i).applyMatrix3(NM).normalize(); on.push(nv.x, nv.y, nv.z)
    }
  } else {
    // points spread evenly over the surface (by area, not by the corners of the shape)
    const areas = meshes.map((m) => {
      const g = m.geometry, p = g.getAttribute('position')
      if (!p) return 0
      const idx = g.getIndex()
      const tri = idx ? idx.count / 3 : p.count / 3
      const a = new THREE.Vector3(), b2 = new THREE.Vector3(), c = new THREE.Vector3()
      let sum = 0
      const W = m.matrixWorld
      for (let k = 0; k < tri; k++) {
        const i0 = idx ? idx.getX(k * 3) : k * 3, i1 = idx ? idx.getX(k * 3 + 1) : k * 3 + 1, i2 = idx ? idx.getX(k * 3 + 2) : k * 3 + 2
        a.fromBufferAttribute(p, i0).applyMatrix4(W); b2.fromBufferAttribute(p, i1).applyMatrix4(W); c.fromBufferAttribute(p, i2).applyMatrix4(W)
        sum += b2.sub(a).cross(c.sub(a)).length() / 2
      }
      return sum
    })
    const total = areas.reduce((x, y) => x + y, 0) || 1
    let seed = 12345
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
    meshes.forEach((m, k) => {
      if (!areas[k]) return
      const g = m.geometry
      if (!g.getAttribute('normal')) g.computeVertexNormals()
      const M = inv.clone().multiply(m.matrixWorld)
      const NM = new THREE.Matrix3().getNormalMatrix(M)
      const sampler = new MeshSurfaceSampler(new THREE.Mesh(g))
      ;(sampler as unknown as { randomFunction: () => number }).randomFunction = rnd
      sampler.build()
      const n = Math.max(16, Math.round((360 * areas[k]) / total))
      for (let i = 0; i < n; i++) {
        sampler.sample(v, nv)
        v.applyMatrix4(M); out.push(v.x, v.y, v.z)
        nv.applyMatrix3(NM).normalize(); on.push(nv.x, nv.y, nv.z)
      }
    })
  }
  const r = { key, pts: new Float32Array(out), nrm: new Float32Array(on) }
  pointCache.set(o3, r)
  return r
}

interface VeinU {
  uVein: { value: THREE.Color }; uVein2: { value: THREE.Color }; uVeinOn: { value: number }; uDepth: { value: number }; uGlow: { value: number }
  uTime: { value: number }; uRate: { value: number }; uThrob: { value: number }; uFreq: { value: number }; uWidth: { value: number }; uSoft: { value: number }; uAmount: { value: number }; uBump: { value: number }
}

// The vein network on the body is drawn for every pixel, so it stays sharp
// at any size: thick veins with thinner ones off them, only in some places.
// The beat runs along them. They show through the skin (softer and darker
// the deeper they are), push the skin up (a bump on the surface), and the
// wet coat stays on top. Tendrils carry their own veins from the tube.
const VEIN_GLSL = `
uniform vec3 uVein; uniform vec3 uVein2; uniform float uVeinOn; uniform float uDepth; uniform float uGlow;
uniform float uTime; uniform float uRate; uniform float uThrob; uniform float uFreq; uniform float uWidth; uniform float uSoft; uniform float uAmount; uniform float uBump;
varying float vVein; varying float vVeinMix; varying vec3 vRest; varying float vVeinBody;
float symH(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float symN(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(symH(i), symH(i + vec3(1, 0, 0)), f.x), mix(symH(i + vec3(0, 1, 0)), symH(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(symH(i + vec3(0, 0, 1)), symH(i + vec3(1, 0, 1)), f.x), mix(symH(i + vec3(0, 1, 1)), symH(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float symBeat(float ph) { float a = 0.5 + 0.5 * sin(ph); float b = 0.5 + 0.5 * sin(ph - 0.9); return pow(a, 8.0) + 0.5 * pow(b, 8.0); }
float symVein(vec3 p, out float pulse) {
  // long, branching lines that mostly run one way (like veins), bent by a slow warp
  vec3 w = vec3(symN(p * uFreq * 0.45 + 3.1), symN(p * uFreq * 0.45 + 7.2), symN(p * uFreq * 0.45 + 1.4)) - 0.5;
  vec3 q = p * uFreq * vec3(1.0, 0.38, 1.0) + w * 2.2;
  float n1 = 2.0 * symN(q) - 1.0;
  float n2 = 2.0 * symN(q * vec3(1.9, 1.3, 1.9) + 5.0) - 1.0;
  float r1 = 1.0 - abs(n1);
  float r2 = 1.0 - abs(n2);
  float m1 = smoothstep(1.0 - uWidth - uSoft, 1.0 - uWidth * 0.2, r1);
  // thinner branches only next to the thick veins
  float m2 = smoothstep(1.0 - uWidth * 0.6 - uSoft, 1.0 - uWidth * 0.1, r2) * smoothstep(0.55, 0.85, r1) * 0.7;
  float cover = smoothstep(0.62 - 0.8 * uAmount, 0.8 - 0.8 * uAmount, symN(p * uFreq * 0.35 + vec3(9.0, 4.0, 1.0)));
  pulse = symBeat(uTime * uRate * 6.2831853 - symN(p * uFreq * 0.2 + 2.2) * 18.0);
  return max(m1, m2) * cover;
}
float gVein = 0.0;
`

// One material per symbiote.
function makeMaterial(): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({ vertexColors: true, side: THREE.DoubleSide, clearcoat: 1, clearcoatRoughness: 0.04, sheen: 0.35, sheenRoughness: 0.3, envMapIntensity: 1.3 })
  const u: VeinU = {
    uVein: { value: new THREE.Color('#2f8f3a') }, uVein2: { value: new THREE.Color('#1d6b4a') }, uVeinOn: { value: 0 }, uDepth: { value: 0.55 }, uGlow: { value: 0 },
    uTime: { value: 0 }, uRate: { value: 1 }, uThrob: { value: 0.6 }, uFreq: { value: 4 }, uWidth: { value: 0.07 }, uSoft: { value: 0.08 }, uAmount: { value: 0.5 }, uBump: { value: 0 },
  }
  m.userData.veinU = u
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float vein;\nattribute float veinMix;\nattribute vec3 rest;\nattribute float veinBody;\nvarying float vVein;\nvarying float vVeinMix;\nvarying vec3 vRest;\nvarying float vVeinBody;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvVein = vein;\nvVeinMix = veinMix;\nvRest = rest;\nvVeinBody = veinBody;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + VEIN_GLSL)
      .replace('#include <color_fragment>', `#include <color_fragment>
  float symPulse = 0.0;
  float symBody = vVeinBody > 0.5 && uVeinOn > 0.5 ? symVein(vRest, symPulse) : 0.0;
  float symTube = max(vVein, 0.0);
  gVein = max(symBody * (1.0 + uThrob * symPulse * 0.8), symTube) * uVeinOn;
  vec3 vcol = mix(uVein, uVein2, clamp(vVeinMix, 0.0, 1.0));
  vec3 under = mix(vcol, vcol * 0.7 + diffuseColor.rgb * 0.2, uDepth);
  diffuseColor.rgb = mix(diffuseColor.rgb, under, clamp(gVein, 0.0, 1.0) * (1.0 - 0.25 * uDepth));`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  if (uBump > 0.0 && gVein > 0.001) {
    // the veins push the skin up
    vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition);
    float hx = dFdx(gVein) * uBump, hy = dFdy(gVein) * uBump;
    vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx);
    float det = dot(dpx, r1);
    vec3 grad = sign(det) * (hx * r1 + hy * r2);
    normal = normalize(abs(det) * normal - grad);
  }`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += mix(uVein, uVein2, clamp(vVeinMix, 0.0, 1.0)) * gVein * (uGlow + 0.28 * (1.0 - 0.4 * uDepth));')
  }
  m.customProgramCacheKey = () => 'rico-symbiote-7'
  return m
}
function styleMaterial(m: THREE.MeshPhysicalMaterial, sy: Sy, t: number, size: number, scale: number) {
  const shader = sy.shader
  m.color.set(sy.color)
  m.sheenColor.set(sy.shine)
  m.emissive.setHex(0); m.emissiveIntensity = 1
  m.metalness = 0.04
  const gloss = Math.max(0, Math.min(1, sy.gloss))
  m.roughness = shader === 'flesh' ? 0.35 + (1 - gloss) * 0.4 : 0.03 + (1 - gloss) * 0.8
  m.clearcoat = (shader === 'flesh' ? 0.35 : 1) * sy.coat
  m.sheen = sy.shineAmount * (shader === 'flesh' ? 1.6 : 1)
  const ir = shader === 'oily' ? 1 : 0
  if (m.iridescence !== ir) { m.iridescence = ir; m.iridescenceIOR = 1.6; m.iridescenceThicknessRange = [180, 760] }
  const u = m.userData.veinU as VeinU
  u.uVein.value.set(sy.veins); u.uVein2.value.set(sy.veins2)
  u.uVeinOn.value = sy.veinsOn ? 1 : 0
  u.uDepth.value = sy.veinDepth
  u.uGlow.value = sy.veinGlow
  u.uTime.value = t
  u.uRate.value = sy.throbRate
  u.uThrob.value = sy.throb
  u.uFreq.value = (3 + 7 * sy.veinAmount) / size
  u.uWidth.value = 0.02 + 0.12 * sy.veinWidth
  u.uSoft.value = 0.02 + 0.1 * sy.veinDepth
  u.uAmount.value = sy.veinAmount
  // the height of a vein, in the world: bigger with Bulge, flatter when deep
  u.uBump.value = size * scale * 0.02 * sy.veinBulge * (1 - 0.6 * sy.veinDepth)
}

export function stopSymbiote(obj: THREE.Object3D) {
  const s = obj.userData.symbiote as State | undefined
  if (!s) return
  s.body.geometry = s.rest
  s.body.material = s.own
  delete s.body.userData.fluidRest
  for (const h of s.hidden) h.visible = true
  s.geo.dispose()
  s.tube.parent?.remove(s.tube); s.tube.geometry.dispose()
  s.dripMesh.parent?.remove(s.dripMesh); s.dripMesh.dispose()
  s.mat.dispose()
  incoming.delete(obj)
  for (const v of incoming.values()) v.delete(obj)
  obj.userData.symbiote = undefined
}

/** The tendrils' mesh (for outlines and tests). */
export const symbioteMesh = (obj: THREE.Object3D | undefined) => (obj?.userData.symbiote as State | undefined)?.tube
/** The drips (for tests). */
export const dripsOf = (obj: THREE.Object3D | undefined) => (obj?.userData.symbiote as State | undefined)?.drips ?? []
/** The tendrils (for tests). */
export const tendrilsOf = (obj: THREE.Object3D | undefined) => (obj?.userData.symbiote as State | undefined)?.arms ?? []

const smooth = (x: number) => { const c = Math.max(0, Math.min(1, x)); return c * c * (3 - 2 * c) }
const hash = (n: number) => { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x) }
// a heartbeat: a sharp beat and a softer one after it
const beat = (ph: number) => { const a = 0.5 + 0.5 * Math.sin(ph), b = 0.5 + 0.5 * Math.sin(ph - 0.9); return Math.pow(a, 8) + 0.5 * Math.pow(b, 8) }

// ---- the body skin, built once ----
function buildSkin(tris: Float32Array, blob: number, detail: number) {
  const box = new THREE.Box3()
  const v0 = new THREE.Vector3()
  for (let i = 0; i < tris.length; i += 3) box.expandByPoint(v0.set(tris[i], tris[i + 1], tris[i + 2]))
  const size = box.getSize(new THREE.Vector3())
  const R = Math.max(28, Math.min(88, Math.round(detail)))
  const edge = Math.max(size.x, size.y, size.z) * 1.25 + 1e-3
  const cell = edge / R
  const min = box.getCenter(new THREE.Vector3()).subScalar(edge / 2)
  let f: Float32Array = sdfOf(tris, R, min, cell)
  // Blob rounds the edges: blur the distances a few times
  const passes = 1 + Math.round(Math.max(0, Math.min(1, blob)) * 5)
  const n = R
  let tmp: Float32Array = new Float32Array(f.length)
  for (let k = 0; k < passes; k++) for (const ax of [1, n, n * n]) {
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = (z * n + y) * n + x
      const c = ax === 1 ? x : ax === n ? y : z
      const a = c > 0 ? f[i - ax] : f[i], b = c < n - 1 ? f[i + ax] : f[i]
      tmp[i] = (a + 2 * f[i] + b) / 4
    }
    const sw = f; f = tmp; tmp = sw
  }
  const mc = new MarchingCubes(R, new THREE.MeshBasicMaterial(), false, false, 240000)
  mc.isolation = 0
  const fld = mc.field as Float32Array
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = (z * n + y) * n + x
    fld[i] = x === 0 || y === 0 || z === 0 || x === n - 1 || y === n - 1 || z === n - 1 ? -50 : -f[i]
  }
  mc.update()
  const pos = (mc as unknown as { positionArray: Float32Array }).positionArray
  const count = (mc as unknown as { count: number }).count
  const half = n / 2
  const arr = new Float32Array(count * 3)
  for (let q = 0; q < count; q++) {
    const a = q * 3
    arr[a] = min.x + (0.5 + (pos[a] + 1) * half) * cell
    arr[a + 1] = min.y + (0.5 + (pos[a + 1] + 1) * half) * cell
    arr[a + 2] = min.z + (0.5 + (pos[a + 2] + 1) * half) * cell
  }
  mc.geometry.dispose()
  const soup = new THREE.BufferGeometry()
  soup.setAttribute('position', new THREE.BufferAttribute(arr, 3))
  const g = mergeVertices(soup, cell * 1e-3)
  soup.dispose()
  // a light smoothing that keeps the size (no steps from the grid)
  const P = g.getAttribute('position').array as Float32Array
  const idx = g.getIndex()!.array
  const V = P.length / 3
  const nb: Set<number>[] = Array.from({ length: V }, () => new Set<number>())
  for (let i = 0; i < idx.length; i += 3) { const a = idx[i], b = idx[i + 1], c = idx[i + 2]; nb[a].add(b).add(c); nb[b].add(a).add(c); nb[c].add(a).add(b) }
  const tmpP = new Float32Array(P.length)
  for (let it = 0; it < 6; it++) {
    const lam = it % 2 ? -0.53 : 0.5
    for (let v = 0; v < V; v++) {
      let sx = 0, sy2 = 0, sz = 0, c = 0
      for (const w of nb[v]) { sx += P[w * 3]; sy2 += P[w * 3 + 1]; sz += P[w * 3 + 2]; c++ }
      if (!c) { tmpP[v * 3] = P[v * 3]; tmpP[v * 3 + 1] = P[v * 3 + 1]; tmpP[v * 3 + 2] = P[v * 3 + 2]; continue }
      tmpP[v * 3] = P[v * 3] + lam * (sx / c - P[v * 3])
      tmpP[v * 3 + 1] = P[v * 3 + 1] + lam * (sy2 / c - P[v * 3 + 1])
      tmpP[v * 3 + 2] = P[v * 3 + 2] + lam * (sz / c - P[v * 3 + 2])
    }
    P.set(tmpP)
  }
  g.computeVertexNormals()
  return { g, size: Math.max(1e-3, (size.x + size.y + size.z) / 3) }
}

// ---- tubes ----
interface TubeOpt { lobe?: (i: number) => number; seed?: number; vein?: (i: number, a: number) => number; bulge?: number; mix?: number }
class TubeBuilder {
  pos: number[] = []; nor: number[] = []; idx: number[] = []; vein: number[] = []; mix: number[] = []
  constructor(public rs: number) {}
  add(pts: THREE.Vector3[], r: number[], o: TubeOpt = {}) {
    const n = pts.length
    if (n < 2) return
    const rs = this.rs
    const base = this.pos.length / 3
    const T: THREE.Vector3[] = []
    for (let i = 0; i < n; i++) {
      const d = pts[Math.min(n - 1, i + 1)].clone().sub(pts[Math.max(0, i - 1)])
      T.push(d.lengthSq() > 1e-14 ? d.normalize() : (T[i - 1]?.clone() ?? new THREE.Vector3(0, 1, 0)))
    }
    // a frame that does not twist, carried along the curve
    const N = new THREE.Vector3(0, 1, 0)
    if (Math.abs(N.dot(T[0])) > 0.9) N.set(1, 0, 0)
    N.sub(T[0].clone().multiplyScalar(N.dot(T[0]))).normalize()
    const B = new THREE.Vector3()
    const seed = o.seed ?? 0, bulge = o.bulge ?? 0, mix = o.mix ?? 0
    for (let i = 0; i < n; i++) {
      if (i) {
        N.sub(T[i].clone().multiplyScalar(N.dot(T[i])))
        if (N.lengthSq() < 1e-10) { N.set(0, 1, 0); if (Math.abs(N.dot(T[i])) > 0.9) N.set(1, 0, 0); N.sub(T[i].clone().multiplyScalar(N.dot(T[i]))) }
        N.normalize()
      }
      B.crossVectors(T[i], N)
      const p = pts[i], rr = Math.max(0, r[i])
      const lobe = o.lobe ? o.lobe(i) : 0
      for (let k = 0; k < rs; k++) {
        const a = (k / rs) * Math.PI * 2
        const cx = Math.cos(a), sx = Math.sin(a)
        const nx = N.x * cx + B.x * sx, ny = N.y * cx + B.y * sx, nz = N.z * cx + B.z * sx
        const v = o.vein ? o.vein(i, a) : 0
        // an uneven edge where it leaves the skin and where it holds, and veins that push it out
        const rk = rr * (1 + lobe * (0.6 * Math.sin(3 * a + seed) + 0.4 * Math.sin(5 * a + seed * 2.3))) * (1 + v * 0.14 * bulge)
        this.pos.push(p.x + nx * rk, p.y + ny * rk, p.z + nz * rk)
        this.nor.push(nx, ny, nz)
        this.vein.push(v); this.mix.push(mix)
      }
    }
    for (let i = 0; i < n - 1; i++) for (let k = 0; k < rs; k++) {
      const a = base + i * rs + k, b = base + i * rs + ((k + 1) % rs), c = a + rs, d = b + rs
      this.idx.push(a, b, c, b, d, c)
    }
  }
}

const bez = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, u: number, out: THREE.Vector3) => {
  const v = 1 - u
  return out.set(0, 0, 0).addScaledVector(a, v * v * v).addScaledVector(b, 3 * v * v * u).addScaledVector(c, 3 * v * u * u).addScaledVector(d, u * u * u)
}
const sideOf = (d: THREE.Vector3) => { const x = Math.abs(d.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0); const sd = x.cross(d).normalize(); return [sd, d.clone().cross(sd).normalize()] as const }

let dripGeo: THREE.BufferGeometry | null = null
const DRIP_GEO = () => {
  if (!dripGeo) {
    dripGeo = new THREE.SphereGeometry(1, 18, 12)
    const n = dripGeo.getAttribute('position').count
    dripGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3))
    dripGeo.setAttribute('vein', new THREE.BufferAttribute(new Float32Array(n), 1))
    dripGeo.setAttribute('veinMix', new THREE.BufferAttribute(new Float32Array(n), 1))
  }
  return dripGeo
}
const MAX_DRIPS = 180

/**
 * Runs the symbiote on an object. others: every other object in the scene.
 * Returns true while it is on (it shows its own living skin).
 */
export function symbiote(obj: THREE.Object3D, o: Obj3D, t: number, others: () => Iterable<[string, THREE.Object3D]>): boolean {
  if (!o.symbiote?.on) { stopSymbiote(obj); return false }
  const sy = symOf(o.symbiote)
  obj.updateMatrixWorld(true)
  let st = obj.userData.symbiote as State | undefined
  const inv = obj.matrixWorld.clone().invert()
  const meshes = st ? [st.body, ...st.hidden] : meshesOf(obj).filter((m) => !m.userData.symArm)
  if (!meshes.length) return false
  const restOf = (m: THREE.Mesh) => (st && m === st.body && (m.geometry === st.geo || m.geometry === st.rest) ? st.rest : m.geometry)
  const blob = Math.max(0, Math.min(1, sy.blob))
  const detail = sy.detail
  const key = `${meshes.map((m) => `${restOf(m).uuid}:${restOf(m).userData.pivot ?? ''}`).join()}|${Math.round(blob * 5)}|${Math.round(detail)}`
  if (!st || st.key !== key) {
    if (st) { stopSymbiote(obj); st = undefined }
    const toObj = (m: THREE.Mesh) => inv.clone().multiply(m.matrixWorld)
    const tris = trianglesOf(meshes, toObj)
    if (tris.length < 9) return false
    const { g, size } = buildSkin(tris, blob, detail)
    const V = g.getAttribute('position').count
    if (!V) return false
    const base = new Float32Array(g.getAttribute('position').array as Float32Array)
    const baseN = new Float32Array(g.getAttribute('normal').array as Float32Array)
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(V * 3).fill(1), 3))
    g.setAttribute('vein', new THREE.BufferAttribute(new Float32Array(V), 1))
    g.setAttribute('veinMix', new THREE.BufferAttribute(new Float32Array(V), 1))
    g.setAttribute('rest', new THREE.BufferAttribute(new Float32Array(base), 3))
    g.setAttribute('veinBody', new THREE.BufferAttribute(new Float32Array(V).fill(1), 1))
    g.userData.live = true
    for (const a of ['position', 'normal', 'color', 'vein', 'veinMix']) (g.getAttribute(a) as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage)
    const step = Math.max(1, Math.floor(V / 420))
    const samples: number[] = []
    for (let i = 0; i < V; i += step) samples.push(i)
    const body = meshes[0]
    const tm = toObj(body)
    const toMesh = tm.equals(new THREE.Matrix4()) ? null : tm.clone().invert()
    const mat = makeMaterial()
    const tube = new THREE.Mesh(new THREE.BufferGeometry(), mat)
    tube.userData.symArm = true
    tube.geometry.userData.live = true
    tube.castShadow = true; tube.receiveShadow = true; tube.frustumCulled = false
    obj.add(tube)
    const dripMesh = new THREE.InstancedMesh(DRIP_GEO(), mat, MAX_DRIPS)
    dripMesh.userData.symArm = true
    dripMesh.count = 0
    dripMesh.castShadow = true; dripMesh.receiveShadow = true; dripMesh.frustumCulled = false
    dripMesh.matrixAutoUpdate = false
    obj.add(dripMesh)
    st = {
      key, size, base, baseN, cur: new Float32Array(base), samples: new Int32Array(samples),
      body, geo: g, rest: body.geometry, hidden: meshes.slice(1), toMesh,
      mat, own: body.material, tube, cap: 0, drips: [], dripMesh, arms: [], lastT: t, lastSpawn: new Map(),
    }
    obj.userData.symbiote = st
    body.userData.fluidRest = body.geometry
    body.geometry = g
    for (const h of st.hidden) h.visible = false
  }
  const s = st!
  const dt = Math.max(0, Math.min(0.1, t - s.lastT))
  s.lastT = t
  const ws = new THREE.Vector3().setFromMatrixScale(obj.matrixWorld)
  const toLocal = 1 / Math.max(1e-6, (ws.x + ws.y + ws.z) / 3)
  const reach = sy.reach * toLocal, detach = Math.max(sy.reach * 1.1, sy.detach) * toLocal
  const speed = Math.max(0.05, sy.speed)
  const thick = Math.max(0.002, sy.thick * toLocal)
  const goo = Math.max(0, Math.min(1, sy.goo))
  const latch = Math.max(0.05, sy.latch)
  const tt = t * speed
  const down = new THREE.Vector3(0, -1, 0).transformDirection(inv)

  // ---- the look ----
  if (sy.shader === 'own') {
    const own = Array.isArray(s.own) ? s.own[0] : s.own
    s.body.material = s.own; s.tube.material = own; s.dripMesh.material = own
  } else {
    styleMaterial(s.mat, sy, t, s.size, 1 / toLocal)
    s.body.material = s.mat; s.tube.material = s.mat; s.dripMesh.material = s.mat
  }

  // ---- who is near ----
  const base = s.base, baseN = s.baseN, V = base.length / 3
  const nearestSample = (p: THREE.Vector3) => {
    let bi = 0, bd = Infinity
    for (const i of s.samples) { const d = (base[i * 3] - p.x) ** 2 + (base[i * 3 + 1] - p.y) ** 2 + (base[i * 3 + 2] - p.z) ** 2; if (d < bd) { bd = d; bi = i } }
    return { i: bi, d: Math.sqrt(bd) }
  }
  const live = new Map<string, THREE.Object3D>()
  const swells: { i: number; d: THREE.Vector3; k: number }[] = []
  const armsMax = Math.max(1, Math.round(sy.arms)), allMax = Math.max(1, Math.round(sy.maxArms))
  const sigma = thick * (2.4 + goo * 3)
  const vtmp = new THREE.Vector3()
  for (const [id, other] of others()) {
    if (id === o.id || other === obj) continue
    live.set(id, other)
    const sp = surfacePoints(other)
    if (!sp.pts.length) continue
    other.updateMatrixWorld(true)
    const toMe = inv.clone().multiply(other.matrixWorld)
    const toMeN = new THREE.Matrix3().getNormalMatrix(toMe)
    const wn = new THREE.Vector3(), toward = new THREE.Vector3()
    // the closest point of the other thing (for the swell toward it), and the spots in reach
    let close: { i: number; d: number; q: THREE.Vector3 } | null = null
    const cands: { j: number; i: number; d: number }[] = []
    for (let j = 0; j < sp.pts.length; j += 3) {
      vtmp.set(sp.pts[j], sp.pts[j + 1], sp.pts[j + 2]).applyMatrix4(toMe)
      const n = nearestSample(vtmp)
      if (!close || n.d < close.d) close = { i: n.i, d: n.d, q: vtmp.clone() }
      if (n.d < reach) {
        // only spots that face this body, so they do not wrap around the far side
        const nx = sp.nrm[j], ny = sp.nrm[j + 1], nz = sp.nrm[j + 2]
        wn.set(nx, ny, nz).applyMatrix3(toMeN)
        toward.set(base[n.i * 3], base[n.i * 3 + 1], base[n.i * 3 + 2]).sub(vtmp)
        if (wn.dot(toward) > -0.15 * wn.length() * toward.length()) cands.push({ j, i: n.i, d: n.d })
      }
    }
    if (close && close.d < reach * 1.6) {
      const p0 = new THREE.Vector3(base[close.i * 3], base[close.i * 3 + 1], base[close.i * 3 + 2])
      swells.push({ i: close.i, d: close.q.clone().sub(p0).normalize(), k: smooth(1 - close.d / (reach * 1.6)) })
    }
    const mine = s.arms.filter((a) => a.target === id && !a.leaving && !a.broke)
    if (!cands.length || mine.length >= armsMax || s.arms.filter((a) => !a.broke).length >= allMax) continue
    // they shoot out one right after another
    if (t - (s.lastSpawn.get(id) ?? -1e9) < 0.07 / (latch * speed)) continue
    const sepR = sigma * 0.7
    // where to grab: a free spot on the other thing, near ones first, with a little chance
    let best: { j: number; i: number; d: number } | null = null
    for (const c of cands) {
      const tp = new THREE.Vector3(sp.pts[c.j], sp.pts[c.j + 1], sp.pts[c.j + 2])
      if (mine.some((a) => a.at.distanceTo(tp) < (sepR * 0.8) / Math.max(1e-6, toLocal))) continue
      const score = c.d * (0.7 + 0.8 * hash(c.j * 0.37 + t))
      if (!best || score < best.d) best = { ...c, d: score }
    }
    if (!best) continue
    // where it grows from: any free spot of the skin that faces that point, so they come out all over that side
    {
      const tp = new THREE.Vector3(sp.pts[best.j], sp.pts[best.j + 1], sp.pts[best.j + 2]).applyMatrix4(toMe)
      let bi = -1, bs = Infinity
      for (const i of s.samples) {
        const px = base[i * 3], py = base[i * 3 + 1], pz = base[i * 3 + 2]
        const dx = tp.x - px, dy = tp.y - py, dz = tp.z - pz
        const d = Math.hypot(dx, dy, dz)
        if (d > reach || d < 1e-6) continue
        if ((baseN[i * 3] * dx + baseN[i * 3 + 1] * dy + baseN[i * 3 + 2] * dz) / d < 0.25) continue
        if (s.arms.some((a) => !a.broke && (base[a.ri * 3] - px) ** 2 + (base[a.ri * 3 + 1] - py) ** 2 + (base[a.ri * 3 + 2] - pz) ** 2 < sepR * sepR)) continue
        const sc = d * (0.8 + 0.7 * hash(i * 0.73 + t * 3.1))
        if (sc < bs) { bs = sc; bi = i }
      }
      if (bi < 0) continue
      best.i = bi
    }
    s.lastSpawn.set(id, t)
    const j = best.j
    // a few thick ones and many thin ones
    const r = Math.random()
    const nth = (s.spawnN = (s.spawnN ?? 0) + 1)
    const raw = nth % 4 === 1 ? 1.6 + r * 0.7 : 0.4 + r * 0.7
    const size = 1 + (raw - 1) * Math.max(0, Math.min(1, sy.sizeVar))
    const dv = Math.max(0, Math.min(1, sy.detachVar))
    s.arms.push({
      target: id, at: new THREE.Vector3(sp.pts[j], sp.pts[j + 1], sp.pts[j + 2]), atN: new THREE.Vector3(sp.nrm[j], sp.nrm[j + 1], sp.nrm[j + 2]),
      ri: best.i, size, grow: 0.001, hold: 0, leaving: false, broke: false, brokeT: 0, breakU: 0.5, breakL: 0, strD: [], dripped: false,
      breakAt: detach * (1 - 0.35 * dv + 0.7 * dv * Math.random()), seed: Math.random() * 100,
    })
  }

  // ---- the skin this frame: alive, with veins under it ----
  const cur = s.cur
  const self = Math.max(0, Math.min(1, sy.self)), bumps = Math.max(0, Math.min(1, sy.bumps))
  const amp = s.size * 0.05 * self, bAmp = s.size * 0.022 * bumps
  const f1 = 1.3 / s.size, f2 = 4.2 / (s.size * Math.max(0.2, sy.lumpSize))
  const col = s.geo.getAttribute('color') as THREE.BufferAttribute, vein = s.geo.getAttribute('vein') as THREE.BufferAttribute, vmixA = s.geo.getAttribute('veinMix') as THREE.BufferAttribute
  const ca = col.array as Float32Array, va = vein.array as Float32Array, vx = vmixA.array as Float32Array
  const veinsOn = sy.veinsOn && sy.shader !== 'own'
  const ta = tt * 0.22 * sy.crawl
  const beatPh = t * sy.throbRate * Math.PI * 2
  const breathe = Math.sin(tt * 1.7) * sy.breathe * s.size * 0.012
  for (let i = 0; i < V; i++) {
    const x = base[i * 3], y = base[i * 3 + 1], z = base[i * 3 + 2]
    let d = breathe * (0.7 + 0.3 * Math.sin(y * f1 * 3 + tt)), shade = 1
    if (amp > 1e-6) {
      // a slow flow: the pattern is pushed around by another pattern
      const wx = noise3(x * f1 + ta, y * f1, z * f1 - ta * 0.5) - 0.5
      const wy = noise3(x * f1 + 5.2, y * f1 - ta * 0.7, z * f1 + 1.3) - 0.5
      const w = noise3(x * f1 * 1.7 + wx * 1.8 + 3.1, y * f1 * 1.7 + wy * 1.8 - ta * 0.4, z * f1 * 1.7 + ta * 0.3)
      d += (w - 0.5) * 2 * amp + Math.sin(tt * 1.3 + (x + y * 0.7 + z * 0.4) * f1 * 3) * amp * 0.25
      shade = 0.75 + 0.5 * w
    }
    if (bAmp > 1e-6) {
      // lumps and ridges, like an alien skin
      // a soft ridge (squared, not a sharp fold), so there are no jagged creases
      const nn = 2 * noise3(x * f2 - ta * 0.3, y * f2 + 7.7, z * f2 + ta * 0.2) - 1
      const r = 1 - nn * nn
      d += (r * r * r - 0.3) * bAmp
      shade *= 0.8 + 0.3 * r
    }
    // the veins themselves are drawn by the material; here only which color they take
    va[i] = 0
    if (veinsOn) vx[i] = noise3(x * f1 * 0.6 + 9.9, y * f1 * 0.6, z * f1 * 0.6 + 3.3)
    const c = Math.max(0.35, Math.min(1.15, shade))
    ca[i * 3] = c; ca[i * 3 + 1] = c; ca[i * 3 + 2] = c
    cur[i * 3] = x + baseN[i * 3] * d; cur[i * 3 + 1] = y + baseN[i * 3 + 1] * d; cur[i * 3 + 2] = z + baseN[i * 3 + 2] * d
  }

  // ---- mounds: the skin rises where tendrils leave it, swells toward near things, meets other symbiotes ----
  const mounds: { p: THREE.Vector3; d: THREE.Vector3; h: number; s: number }[] = []
  for (const w of swells) mounds.push({ p: new THREE.Vector3(base[w.i * 3], base[w.i * 3 + 1], base[w.i * 3 + 2]), d: w.d, h: s.size * 0.05 * sy.swell * w.k * (0.5 + self), s: s.size * 0.22 })
  const inc = incoming.get(obj)
  if (inc) for (const list of inc.values()) for (const m of list) {
    const n = nearestSample(m.p.clone().applyMatrix4(inv))
    mounds.push({ p: new THREE.Vector3(base[n.i * 3], base[n.i * 3 + 1], base[n.i * 3 + 2]), d: m.d.clone().transformDirection(inv), h: m.h * toLocal, s: sigma * 1.2 })
  }

  // ---- tendrils: shoot out, grab, stretch, snap ----
  const tb = new TubeBuilder(Math.max(8, Math.min(16, Math.round(detail / 5))))
  const segs = Math.max(16, Math.min(56, Math.round(detail * 0.6)))
  const sent = new Map<THREE.Object3D, { p: THREE.Vector3; d: THREE.Vector3; h: number }[]>()
  const toWorld = obj.matrixWorld
  const dripAmt = Math.max(0, Math.min(1, sy.drips))
  const spawnDrip = (p: THREE.Vector3, v: THREE.Vector3, r: number) => {
    if (dripAmt <= 0) return
    if (s.drips.length >= MAX_DRIPS) { const k = s.drips.findIndex((d) => d.floor !== null); s.drips.splice(k >= 0 ? k : 0, 1) }
    const wp = p.clone().applyMatrix4(toWorld)
    const rr = (r * sy.dripSize) / toLocal
    // never start under the floor
    const fl = floorUnder(vtmp.set(wp.x, 1e9, wp.z))
    if (fl !== null && wp.y < fl + rr) wp.y = fl + rr
    const wv = v.clone().transformDirection(toWorld).multiplyScalar(v.length() / toLocal)
    s.drips.push({ p: wp, v: wv, r: rr, floor: null, age: 0, flat: 0, seed: Math.random() * 10 })
  }
  const nStrings = Math.round(sy.snapStrings * 3)
  const tendrilVeins = veinsOn && sy.veinTendrils > 0.001
  const dead = new Set<Arm>()
  for (const arm of s.arms) {
    let b: THREE.Vector3, nb: THREE.Vector3
    const other = live.get(arm.target)
    if (other) {
      const M = inv.clone().multiply(other.matrixWorld)
      b = arm.at.clone().applyMatrix4(M)
      nb = arm.atN.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(M)).normalize()
      arm.lastB = b.clone(); arm.lastN = nb.clone()
    } else if (arm.lastB) { b = arm.lastB.clone(); nb = arm.lastN!.clone(); if (!arm.broke) arm.leaving = true }
    else { dead.add(arm); continue }
    const bReal = b.clone(), nReal = nb.clone()
    const ri = arm.ri
    const rp = new THREE.Vector3(cur[ri * 3], cur[ri * 3 + 1], cur[ri * 3 + 2])
    const rn = new THREE.Vector3(baseN[ri * 3], baseN[ri * 3 + 1], baseN[ri * 3 + 2])
    const L0 = bReal.distanceTo(rp)
    if (!arm.broke && !arm.leaving && arm.grow >= 1 && L0 > arm.breakAt) {
      arm.broke = true; arm.brokeT = t; arm.breakL = Math.max(reach * 0.3, Math.min(L0, arm.breakAt))
      arm.breakU = 0.3 + 0.4 * hash(arm.seed * 5.3); arm.strD = Array.from({ length: nStrings }, () => false)
    } else if (!arm.broke && !arm.leaving && arm.grow < 1 && L0 > reach * 1.5) arm.leaving = true
    const sz = arm.size
    if (!arm.broke) {
      if (arm.leaving) { arm.grow -= dt * speed * latch * 3; arm.hold = Math.max(0, arm.hold - dt * speed * 3) }
      else arm.grow = Math.min(1, arm.grow + (dt * speed * latch * 2.2 * (1.3 - 0.35 * Math.min(2, sz))) / Math.max(0.6, L0 / Math.max(1e-6, reach)))
      if (arm.grow >= 1 && !arm.leaving) arm.hold = Math.min(1, arm.hold + dt * speed * latch * 3.5)
      if (arm.grow <= 0) { dead.add(arm); continue }
    }
    // after a snap: time since, how much of the body half is left, and the piece on the other thing
    const tau = arm.broke ? (t - arm.brokeT) * speed * Math.max(0.05, sy.recoil) : 0
    const g = arm.broke ? Math.max(0, Math.exp(-3.2 * tau) * (1 + 0.22 * Math.sin(tau * 11))) : 1
    const farK = arm.broke ? Math.exp(-2.6 * tau) * sy.leftover : 0
    const delays = arm.strD.map((_, j) => 0.1 + 0.35 * hash(arm.seed + j * 3.1))
    if (arm.broke && g < 0.03 && farK < 0.03 && delays.every((d, j) => tau > d || arm.strD[j])) { dead.add(arm); continue }
    if (arm.broke) b = rp.clone().add(bReal.clone().sub(rp).normalize().multiplyScalar(arm.breakL))
    const Le = arm.broke ? arm.breakL : L0
    // stretched it gets thin; after it snaps it pulls back together and gets thick again
    const stretch = smooth((Le - reach) / Math.max(1e-6, arm.breakAt - reach)) * (arm.broke ? Math.exp(-4 * tau) : 1)
    const core = thick * sz
    const rootR = thick * Math.max(0.6, sz) * (1.3 + goo) * sy.rootSize
    const out = arm.broke ? g : smooth(arm.grow * 3) * (arm.leaving ? arm.grow : 1)
    const dir0 = b.clone().sub(rp).normalize().multiplyScalar(0.5).add(rn).normalize()
    // the skin rises around where it leaves
    mounds.push({ p: new THREE.Vector3(base[ri * 3], base[ri * 3 + 1], base[ri * 3 + 2]), d: dir0, h: rootR * (0.55 + goo * 0.45) * out * (1 + stretch * 0.4), s: rootR * (1.3 + goo * 1.3) })
    // it starts a little under the skin, so the edge is never seen
    const a = rp.clone().addScaledVector(rn, -rootR * 0.7)
    const endR = core * (1 + sy.grip * 1.8) * smooth(arm.hold)
    const bIn = b.clone().addScaledVector(nb, -core * 0.5)
    const L = Math.max(1e-6, a.distanceTo(bIn))
    const c1 = a.clone().addScaledVector(dir0, L * 0.4)
    const c2 = bIn.clone().addScaledVector(nb, L * 0.3)
    const sag = L * sy.gravity * (0.12 + 0.55 * stretch)
    const dir = bIn.clone().sub(a).divideScalar(L)
    const [sd, up] = sideOf(dir)
    const seed = arm.seed
    const ext = arm.broke ? arm.breakU * g : 1 - Math.pow(1 - Math.max(0, Math.min(1, arm.grow)), 3)
    const lungeW = sy.lunge * L * 0.2 * (1 - arm.hold)
    const holdW = sy.holdMotion * L * 0.035
    const curlA = sy.curl * Math.PI * 1.5 * (1 - g)
    const curveAt = (u: number, outV: THREE.Vector3) => {
      bez(a, c1, c2, bIn, u, outV)
      const m = Math.sin(Math.PI * u)
      outV.addScaledVector(down, sag * m)
      if (!arm.broke) {
        // a fast whip on the way, a slow writhe while it holds
        const lead = Math.sin(Math.PI * Math.min(1, u / Math.max(1e-3, ext)))
        const w1 = lungeW * lead, w2 = holdW * m
        outV.addScaledVector(sd, Math.sin(tt * 7 + seed + u * 5) * w1 + Math.sin(tt * 2.6 + u * 7 + seed) * w2)
        outV.addScaledVector(up, Math.cos(tt * 6 + seed * 1.7 + u * 4) * w1 + Math.cos(tt * 2.1 + u * 6 + seed * 1.3) * w2)
      } else {
        // the loose end curls back, whips, and hangs
        const w = ext > 1e-4 ? Math.min(1, u / ext) ** 2 : 0
        const th = curlA * w
        outV.addScaledVector(down, (Math.sin(th) * sy.curl * 0.14 + 0.15 * sy.gravity * (1 - g)) * L * w)
        outV.addScaledVector(dir, -(1 - Math.cos(th)) * sy.curl * 0.14 * L * w)
        outV.addScaledVector(sd, Math.sin(tau * 18 + seed) * Math.exp(-2.5 * tau) * sy.whipSnap * L * 0.12 * w)
      }
      return outV
    }
    const mainR = (u: number) => {
      const mid = Math.sin(Math.PI * u)
      const neck = 1 - sy.thin * stretch * Math.pow(mid, 1.6)
      const organic = 1 + 0.22 * (noise3(u * 3.2 + seed, seed * 0.3, tt * 0.25) - 0.5)
      const r = core * (1 - 0.22 * mid) * neck * organic
      const dist = u * L, left = (1 - u) * L
      const rf = Math.max(0, rootR - r) * Math.exp(-((dist / (rootR * (1.5 + goo * 1.5))) ** 2))
      const gf = !arm.broke && endR > r ? (endR - r) * Math.exp(-((left / (endR * 1.7 + 1e-6)) ** 2)) : 0
      return Math.max(core * 0.05, r + rf + gf)
    }
    const lobeAt = (u: number) => goo * 0.4 * Math.exp(-(((u * L) / (rootR * 1.8)) ** 2)) + (arm.broke ? 0 : sy.grip * 0.35 * arm.hold * Math.exp(-((((1 - u) * L) / (endR * 2 + 1e-6)) ** 2)))
    // the main piece: from the body out to its tip (pointed while it grows, a round drop once it snapped)
    const u1 = Math.max(0.002, ext)
    const openTip = arm.broke || arm.grow < 1 || arm.leaving
    const n = Math.max(5, Math.round(segs * u1) + 2)
    const eRound = Math.min(u1 * 0.45, (mainR(u1) * 1.6) / L)
    const taper = (u: number) => {
      if (!openTip) return 1
      if (arm.broke) {
        let k = 1 + 0.45 * smooth((u - (u1 - eRound * 3)) / (eRound * 2))
        const x = (u - (u1 - eRound)) / eRound
        if (x > 0) k *= Math.sqrt(Math.max(0, 1 - x * x))
        return k
      }
      return Math.pow(smooth((u1 - u) / Math.min(0.14, u1 * 0.45)), 0.55)
    }
    const pts: THREE.Vector3[] = [], rad: number[] = [], us: number[] = []
    for (let i = 0; i <= n; i++) {
      const u = (u1 * i) / n
      us.push(u)
      pts.push(curveAt(u, new THREE.Vector3()))
      rad.push(mainR(u) * taper(u) * (openTip && i === n ? 0 : 1))
    }
    const ph = seed * 1.9
    tb.add(pts, rad, {
      seed, lobe: (i) => lobeAt(us[i]), bulge: sy.veinBulge, mix: hash(seed * 2.2),
      vein: tendrilVeins && sz > 0.55 ? (i, ang) => {
        const u = us[i]
        const m = sy.veinTendrils * smooth((Math.cos(ang - (ph + u * 3)) - 0.82) / 0.16) * smooth(u / 0.08) * smooth((u1 - u) / 0.1)
        return m * (1 + sy.throb * beat(beatPh - u * 5 + seed) * 0.8)
      } : undefined,
    })
    // strands along it: close at rest, a web of strings when it stretches
    const base2 = Math.round(sy.strands * Math.max(0.3, Math.min(1.5, sz)))
    const extra = arm.broke ? 0 : Math.round(sy.strings * 3 * stretch)
    const tmp = new THREE.Vector3()
    for (let k = 0; k < base2 + extra; k++) {
      const isString = k >= base2
      const phk = seed * 2.3 + (k * Math.PI * 2) / Math.max(1, base2 + extra)
      const spts: THREE.Vector3[] = [], srad: number[] = []
      for (let i = 0; i <= n; i++) {
        const u = us[i]
        const c = curveAt(u, new THREE.Vector3())
        const env = Math.pow(Math.sin(Math.PI * u), 1.3)
        const off = (mainR(u) * 0.75 + sy.web * stretch * L * 0.09 * (0.5 + 0.5 * hash(seed + k)) * (isString ? 1.6 : 1)) * env
        curveAt(Math.min(1, u + 0.01), tmp)
        const tg = tmp.sub(c)
        const [a1, a2] = sideOf(tg.lengthSq() > 1e-12 ? tg.normalize() : dir)
        const th = phk + u * 1.4 + tt * 0.15
        c.addScaledVector(a1, Math.cos(th) * off).addScaledVector(a2, Math.sin(th) * off)
        // the web sags more than the main strand
        c.addScaledVector(down, sag * (isString ? 0.6 : 0.35) * env * (0.5 + hash(seed * 3 + k)))
        spts.push(c)
        const rr = isString ? core * 0.1 + thick * 0.02 : core * (0.28 + 0.12 * hash(seed + k * 7)) * (1 - 0.5 * stretch) * (0.55 + 0.45 * (1 - env)) + thick * 0.04
        srad.push(rr * taper(u) * (openTip && i === n ? 0 : 1))
      }
      tb.add(spts, srad)
    }
    if (arm.broke) {
      const tip = curveAt(u1, new THREE.Vector3())
      // the piece left on the other thing: a short lump that pulls back into it
      let farTip = bReal.clone()
      if (farK > 0.02 && other) {
        const len = (1 - arm.breakU) * arm.breakL * 0.35 * farK
        const toBody = rp.clone().sub(bReal).normalize()
        const p0 = bReal.clone().addScaledVector(nReal, -core * 0.5)
        const p3 = bReal.clone().addScaledVector(toBody, len).addScaledVector(down, len * 0.5)
        const p1 = p0.clone().addScaledVector(nReal, len * 0.5), p2 = p3.clone().addScaledVector(down, -len * 0.2)
        const fp: THREE.Vector3[] = [], fr: number[] = []
        const nF = 12
        const r0 = core * (1 + sy.grip * 1.2) * (0.5 + 0.5 * farK)
        for (let i = 0; i <= nF; i++) {
          const u = i / nF
          fp.push(bez(p0, p1, p2, p3, u, new THREE.Vector3()))
          const x = (u - 0.72) / 0.28
          fr.push(r0 * (1 - 0.3 * u) * (x > 0 ? Math.sqrt(Math.max(0, 1 - x * x)) : 1))
        }
        tb.add(fp, fr, { seed, lobe: (i) => (i < 3 ? sy.grip * 0.3 : 0) })
        farTip = p3
      }
      // the last thin strings between the two: they hold a moment longer, then break into drips
      for (let j = 0; j < arm.strD.length; j++) {
        if (arm.strD[j]) continue
        const dl = delays[j]
        if (tau < dl) {
          const k = tau / dl
          const p0 = tip.clone(), p3 = farTip.clone()
          const span = p0.distanceTo(p3)
          const mid = p0.clone().lerp(p3, 0.5).addScaledVector(down, span * (0.15 + 0.35 * k) * (0.5 + sy.gravity)).addScaledVector(sd, (hash(seed + j) - 0.5) * span * 0.2)
          const sp2: THREE.Vector3[] = [], sr2: number[] = []
          for (let i = 0; i <= 10; i++) {
            const u = i / 10
            const q = p0.clone().multiplyScalar((1 - u) * (1 - u)).addScaledVector(mid, 2 * u * (1 - u)).addScaledVector(p3, u * u)
            sp2.push(q)
            sr2.push((core * 0.12 * (1 - k) + thick * 0.015) * (1 - 0.5 * Math.sin(Math.PI * u)))
          }
          tb.add(sp2, sr2)
        } else {
          arm.strD[j] = true
          const m = tip.clone().lerp(farTip, 0.5).addScaledVector(down, tip.distanceTo(farTip) * 0.3)
          spawnDrip(m, down.clone().multiplyScalar(0.3), thick * (0.5 + Math.random() * 0.4))
        }
      }
      // a few drips right where it tore
      if (!arm.dripped) {
        arm.dripped = true
        const k = hash(seed * 1.7) < 0.35 ? 0 : Math.round(dripAmt * 3)
        for (let q = 0; q < k; q++) {
          const v = new THREE.Vector3().randomDirection().multiplyScalar(0.4).addScaledVector(down, 0.3)
          spawnDrip(tip.clone().lerp(farTip, 0.3 + Math.random() * 0.4), v, thick * (0.7 + Math.random() * 0.8))
        }
      }
    } else if (stretch > 0.45 && Math.random() < dt * dripAmt * stretch * 2.2) {
      // a stretched bundle drips now and then
      spawnDrip(curveAt(0.35 + Math.random() * 0.3, new THREE.Vector3()), down.clone().multiplyScalar(0.2), thick * (0.6 + Math.random() * 0.5))
    }
    // tell another symbiote where this one holds on, so its skin rises to meet it
    if (other?.userData.symbiote && !arm.broke && arm.grow > 0.6) {
      const list = sent.get(other) ?? []
      list.push({ p: bReal.clone().applyMatrix4(toWorld), d: nReal.clone().transformDirection(toWorld), h: (Math.min(sigma, L * 0.25) / toLocal) * arm.hold })
      sent.set(other, list)
    }
  }
  s.arms = s.arms.filter((a) => !dead.has(a))
  for (const [other, list] of sent) { let m = incoming.get(other); if (!m) { m = new Map(); incoming.set(other, m) } m.set(obj, list) }
  for (const [other, m] of incoming) if (!sent.has(other)) m.delete(obj)

  // ---- apply the mounds to the skin (where they overlap they do not pile up too high) ----
  if (mounds.length) {
    const D = (s.disp ??= new Float32Array(V * 3))
    D.fill(0)
    let any = false
    for (const m of mounds) {
      if (m.h < 1e-6) continue
      any = true
      const s2 = m.s * m.s, lim = s2 * 9
      for (let i = 0; i < V; i++) {
        const dx = base[i * 3] - m.p.x, dy = base[i * 3 + 1] - m.p.y, dz = base[i * 3 + 2] - m.p.z
        const d2 = dx * dx + dy * dy + dz * dz
        if (d2 > lim) continue
        const w = Math.exp(-d2 / s2) * m.h
        D[i * 3] += m.d.x * w; D[i * 3 + 1] += m.d.y * w; D[i * 3 + 2] += m.d.z * w
      }
    }
    if (any) {
      // a soft limit (no flat tops where many overlap)
      const maxH = Math.max(sigma * 1.2, s.size * 0.05)
      for (let i = 0; i < V; i++) {
        const x = D[i * 3], y = D[i * 3 + 1], z = D[i * 3 + 2]
        const l = Math.hypot(x, y, z)
        if (l < 1e-9) continue
        const k = 1 / (1 + l / maxH)
        cur[i * 3] += x * k; cur[i * 3 + 1] += y * k; cur[i * 3 + 2] += z * k
      }
    }
  }
  const posA = s.geo.getAttribute('position') as THREE.BufferAttribute
  const pa = posA.array as Float32Array
  if (s.toMesh) {
    const v = new THREE.Vector3()
    for (let i = 0; i < V; i++) { v.set(cur[i * 3], cur[i * 3 + 1], cur[i * 3 + 2]).applyMatrix4(s.toMesh); pa[i * 3] = v.x; pa[i * 3 + 1] = v.y; pa[i * 3 + 2] = v.z }
  } else pa.set(cur)
  posA.needsUpdate = true; col.needsUpdate = true; vein.needsUpdate = true; vmixA.needsUpdate = true
  s.geo.computeVertexNormals()
  s.geo.computeBoundingSphere()
  s.geo.computeBoundingBox()

  // ---- write the tubes ----
  const g = s.tube.geometry
  const nv = tb.pos.length
  if (nv > s.cap) {
    s.cap = Math.ceil((nv * 1.5) / 3) * 3
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(s.cap), 3).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(s.cap), 3).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(s.cap).fill(1), 3))
    g.setAttribute('vein', new THREE.BufferAttribute(new Float32Array(s.cap / 3), 1).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('veinMix', new THREE.BufferAttribute(new Float32Array(s.cap / 3), 1).setUsage(THREE.DynamicDrawUsage))
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(Math.ceil(s.cap / 3) * 6 + 6), 1).setUsage(THREE.DynamicDrawUsage))
  }
  if (s.cap) {
    const P = g.getAttribute('position') as THREE.BufferAttribute, Nn = g.getAttribute('normal') as THREE.BufferAttribute, I = g.getIndex()!
    const Va = g.getAttribute('vein') as THREE.BufferAttribute, Mx = g.getAttribute('veinMix') as THREE.BufferAttribute
    ;(P.array as Float32Array).set(tb.pos); (Nn.array as Float32Array).set(tb.nor); (I.array as Uint32Array).set(tb.idx)
    ;(Va.array as Float32Array).set(tb.vein); (Mx.array as Float32Array).set(tb.mix)
    P.needsUpdate = true; Nn.needsUpdate = true; I.needsUpdate = true; Va.needsUpdate = true; Mx.needsUpdate = true
    g.setDrawRange(0, tb.idx.length)
    if (nv) { g.computeBoundingBox(); g.computeBoundingSphere() }
  }
  s.tube.visible = tb.idx.length > 0

  // ---- drips: fall, land, spread, stay or fade ----
  const grav = 9.8 * 0.6 * sy.dripGravity
  const fadeAfter = Math.max(0.5, sy.puddleTime)
  const keep = sy.puddle === 'stay'
  s.drips = s.drips.filter((d) => {
    d.age += dt
    if (d.floor === null) {
      d.v.y -= grav * dt
      d.v.multiplyScalar(1 - 0.5 * dt)
      const fl = floorUnder(d.p)
      d.p.addScaledVector(d.v, dt)
      if (fl !== null && d.p.y - d.r * 0.5 <= fl) { d.floor = fl; d.p.y = fl; d.age = 0 }
      else if (d.age > 12) return false
    } else {
      d.flat = Math.min(1, d.flat + dt * 3)
      if (!keep && d.age > fadeAfter + 1.6) return false
    }
    return true
  })
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3()
  const yUp = new THREE.Vector3(0, 1, 0)
  let cnt = 0
  for (const d of s.drips) {
    if (cnt >= MAX_DRIPS) break
    if (d.floor === null) {
      // a drop, stretched along the way it falls
      const sp = d.v.length()
      const st2 = 1 + Math.min(1.6, sp * 0.3)
      q.setFromUnitVectors(yUp, sp > 1e-4 ? vtmp.copy(d.v).divideScalar(sp) : vtmp.set(0, -1, 0))
      sc.set(d.r / Math.sqrt(st2), d.r * st2, d.r / Math.sqrt(st2))
      M.compose(d.p, q, sc)
    } else {
      // a puddle: it spreads, and if it fades it shrinks and sinks away
      const fade = keep ? 1 : 1 - smooth((d.age - fadeAfter) / 1.5)
      const spread = d.r * (1 + 1.4 * sy.puddleSpread * smooth(d.flat)) * (0.6 + 0.4 * fade)
      q.setFromAxisAngle(yUp, d.seed)
      sc.set(spread * (1 + 0.25 * Math.sin(d.seed * 3)), d.r * (0.9 - 0.7 * smooth(d.flat)) * fade + 1e-4, spread)
      M.compose(vtmp.set(d.p.x, d.floor + sc.y * 0.3 - (1 - fade) * d.r * 0.4, d.p.z), q, sc)
    }
    s.dripMesh.setMatrixAt(cnt++, M)
  }
  s.dripMesh.count = cnt
  s.dripMesh.instanceMatrix.needsUpdate = true
  // the drips live in the world, not in this object
  s.dripMesh.matrix.copy(inv)
  s.dripMesh.matrixWorldNeedsUpdate = true
  s.dripMesh.visible = cnt > 0
  return true
}

/** How many tendrils hold on right now (for the property box). */
export const armsOf = (obj: THREE.Object3D | undefined) => ((obj?.userData.symbiote as State | undefined)?.arms.filter((a) => a.grow >= 1 && !a.leaving && !a.broke).length ?? 0)
