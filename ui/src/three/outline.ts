import * as THREE from 'three'
import { Line2 } from 'three/addons/lines/Line2.js'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { OUTLINE_DEFAULT, type Outline } from './world'

// Hand-drawn outlines, like a grease pencil stroke around a cartoon:
// 1. the shape's silhouette: a slightly bigger copy, drawn inside out, so
//    only its edge shows around the object (the "inverted hull" trick);
// 2. the sharp edges inside the shape (creases), as real lines.
// Both can wobble and "boil": the wobble changes a few times a second, like
// animation drawn by hand on twos. Offset lets the line float off the shape.

const HULL_VERT = `
uniform float uWidth; uniform float uWobble; uniform float uSeed; uniform vec2 uOffset;
float oHash(vec3 p) { p = fract(p * 0.3183099 + uSeed); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float oNoise(vec3 x) { vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(oHash(i), oHash(i + vec3(1,0,0)), f.x), mix(oHash(i + vec3(0,1,0)), oHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(oHash(i + vec3(0,0,1)), oHash(i + vec3(1,0,1)), f.x), mix(oHash(i + vec3(0,1,1)), oHash(i + vec3(1,1,1)), f.x), f.y), f.z); }
void main() {
  float w = uWidth * (1.0 + uWobble * (oNoise(position * 4.0) * 2.0 - 1.0) * 1.4);
  vec3 p = position + normal * max(0.0, w);
  vec4 c = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  c.xy += uOffset * c.w;
  gl_Position = c;
}`
const HULL_FRAG = `uniform vec3 uColor; void main() { gl_FragColor = vec4(uColor, 1.0); }`

interface Built { group: THREE.Group; hull: THREE.Mesh; lines: LineSegments2 | null; base: Float32Array | null; key: string; seedAt: number }

function smoothCopy(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const c = new THREE.BufferGeometry()
  c.setAttribute('position', g.getAttribute('position').clone())
  if (g.index) c.setIndex(g.index.clone())
  const m = mergeVertices(c, 1e-4)
  m.computeVertexNormals()
  return m
}

export function buildOutline(mesh: THREE.Mesh, o: Outline): Built {
  const group = new THREE.Group()
  group.userData.helper = true
  group.userData.outline = true
  const hullMat = new THREE.ShaderMaterial({
    uniforms: { uWidth: { value: o.width }, uWobble: { value: o.wobble }, uSeed: { value: 0.1 }, uOffset: { value: new THREE.Vector2() }, uColor: { value: new THREE.Color(o.color) } },
    vertexShader: HULL_VERT, fragmentShader: HULL_FRAG, side: THREE.BackSide,
  })
  // a shape that bends or morphs: the outline uses the live shape, so it follows
  const live = Boolean(mesh.geometry.userData.rig || mesh.geometry.userData.live)
  const hull = new THREE.Mesh(live ? mesh.geometry : smoothCopy(mesh.geometry), hullMat)
  hull.userData.shared = live
  hull.userData.helper = true
  group.add(hull)
  let lines: LineSegments2 | null = null
  let base: Float32Array | null = null
  if (o.creases && !mesh.geometry.userData.live) {
    const edges = new THREE.EdgesGeometry(mesh.geometry, o.crease)
    base = new Float32Array(edges.getAttribute('position').array as ArrayLike<number>)
    if (base.length) {
      const lg = new LineSegmentsGeometry()
      lg.setPositions(base)
      const lm = new LineMaterial({ color: new THREE.Color(o.color).getHex(), linewidth: o.lineWidth, worldUnits: false })
      lines = new LineSegments2(lg, lm)
      lines.userData.helper = true
      group.add(lines)
    }
    edges.dispose()
  }
  return { group, hull, lines, base, key: '', seedAt: 0 }
}

export const outlineKey = (mesh: THREE.Mesh, o: Outline) => `${mesh.geometry.uuid}|${o.creases}|${o.crease}|${mesh.geometry.userData.rig || mesh.geometry.userData.live ? 'live' : ''}`

// Every frame: the wobble, boil, color and widths.
export function updateOutline(b: Built, o: Outline, t: number, res: THREE.Vector2) {
  const u = (b.hull.material as THREE.ShaderMaterial).uniforms
  u.uWidth.value = o.width
  u.uWobble.value = o.wobble
  ;(u.uColor.value as THREE.Color).set(o.color)
  const fps = Math.max(0, o.boil)
  const step = fps > 0 ? Math.floor(t * fps) : 0
  if (step !== b.seedAt) {
    b.seedAt = step
    u.uSeed.value = fps > 0 ? (step * 0.618) % 1 : 0.1
    const off = o.offset * 0.01
    u.uOffset.value.set(off ? Math.sin(step * 2.1) * off : 0, off ? Math.cos(step * 1.7) * off : 0)
    if (b.lines && b.base) {
      // Each line end moves a little, a new way each "drawing".
      const j = o.wobble * 0.012
      const pos = new Float32Array(b.base.length)
      let seed = step * 9301 + 49297
      const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280 - 0.5 }
      for (let i = 0; i < pos.length; i++) pos[i] = b.base[i] + (j ? rnd() * j : 0)
      ;(b.lines.geometry as LineSegmentsGeometry).setPositions(pos)
    }
  }
  if (b.lines) {
    const lm = b.lines.material as LineMaterial
    lm.color.set(o.color)
    lm.linewidth = o.lineWidth
    lm.resolution.copy(res)
  }
}

export function disposeOutline(b: Built) {
  if (!b.hull.userData.shared) b.hull.geometry.dispose()
  ;(b.hull.material as THREE.Material).dispose()
  if (b.lines) { b.lines.geometry.dispose(); (b.lines.material as THREE.Material).dispose() }
}

export const outlineOf = (o?: Outline) => ({ ...OUTLINE_DEFAULT, ...(o ?? {}) })
export type { Built as OutlineBuilt }

// ---- floating lines ----
// Loose strokes drawn around the shape, a little away from it, like a
// sketch over a painting. RICO finds the shape's outline as the camera sees
// it, pushes it out, smooths it, leaves a gap, and shakes it a little. With
// boil, it is drawn again a few times a second, like stop motion.


export interface Floating { group: THREE.Group; lines: Line2[]; step: number; camKey: string }

export function buildFloating(count: number): Floating {
  const group = new THREE.Group()
  group.userData.helper = true
  const lines: Line2[] = []
  for (let i = 0; i < Math.max(1, Math.min(5, count)); i++) {
    const g = new LineGeometry()
    g.setPositions([0, 0, 0, 0, 0, 0])
    const m = new LineMaterial({ color: 0xffe14a, linewidth: 2, worldUnits: false, transparent: true })
    const l = new Line2(g, m)
    l.userData.helper = true
    l.frustumCulled = false
    l.renderOrder = 100
    group.add(l)
    lines.push(l)
  }
  return { group, lines, step: -1, camKey: '' }
}

function hull2(pts: [number, number][]): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (p.length < 3) return p
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lo: [number, number][] = [], up: [number, number][] = []
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q) }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q) }
  return lo.slice(0, -1).concat(up.slice(0, -1))
}

export function updateFloating(f: Floating, mesh: THREE.Mesh, o: Outline, camera: THREE.Camera, t: number, res: THREE.Vector2) {
  const fps = Math.max(0, o.boil)
  const step = fps > 0 ? Math.floor(t * fps) : 0
  camera.updateMatrixWorld()
  mesh.updateMatrixWorld()
  const camKey = `${camera.matrixWorld.elements.map((v) => v.toFixed(3)).join()}|${mesh.matrixWorld.elements.map((v) => v.toFixed(3)).join()}|${o.gap}|${o.wobble}|${o.open}`
  for (const l of f.lines) {
    const m = l.material as LineMaterial
    m.color.set(o.floatColor ?? '#ffe14a')
    m.linewidth = o.floatWidth ?? 2
    m.resolution.copy(res)
    m.depthTest = !o.overAll
    l.visible = true
  }
  if (step === f.step && camKey === f.camKey) return
  f.step = step
  f.camKey = camKey
  const pos = mesh.geometry.getAttribute('position')
  if (!pos?.count) return
  // The shape seen from the camera, on a plane through its middle.
  const view = camera.matrixWorldInverse
  const every = Math.max(1, Math.floor(pos.count / 1500))
  const v = new THREE.Vector3()
  const center = new THREE.Vector3()
  mesh.geometry.computeBoundingSphere()
  center.copy(mesh.geometry.boundingSphere!.center).applyMatrix4(mesh.matrixWorld).applyMatrix4(view)
  const z0 = center.z
  if (z0 >= -1e-3) return
  const pts: [number, number][] = []
  for (let i = 0; i < pos.count; i += every) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).applyMatrix4(view)
    if (v.z >= -1e-3) continue
    const k = z0 / v.z
    pts.push([v.x * k, v.y * k])
  }
  const h = hull2(pts)
  if (h.length < 3) return
  let cx = 0, cy = 0
  for (const [x, y] of h) { cx += x; cy += y }
  cx /= h.length; cy /= h.length
  const size = Math.max(...h.map(([x, y]) => Math.hypot(x - cx, y - cy)))
  const gap = (o.gap ?? 0.12) * size
  // Even points around the outline, pushed out by the gap.
  const N = 72
  const ring: [number, number][] = []
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2
    // The farthest hull point in this direction (a star-shaped outline).
    let best = 0
    for (let j = 0; j < h.length; j++) {
      const [x0, y0] = h[j], [x1, y1] = h[(j + 1) % h.length]
      const dx = Math.cos(a), dy = Math.sin(a)
      const ex = x1 - x0, ey = y1 - y0
      const den = dx * ey - dy * ex
      if (Math.abs(den) < 1e-9) continue
      const tt = ((x0 - cx) * ey - (y0 - cy) * ex) / den
      const u = ((x0 - cx) * dy - (y0 - cy) * dx) / den
      if (tt > 0 && u >= -1e-6 && u <= 1 + 1e-6) best = Math.max(best, tt)
    }
    ring.push([cx + Math.cos(a) * (best + gap), cy + Math.sin(a) * (best + gap)])
  }
  let seed = step * 7919 + 17
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5 }
  const inv = camera.matrixWorld
  f.lines.forEach((line, li) => {
    // Each stroke: a slightly different size, a twist, a gap, and a wobble.
    const scale = 1 + rnd() * 0.12 + li * 0.05
    const twist = rnd() * 0.8
    const start = Math.floor((rnd() + 0.5) * N)
    const open = Math.max(0, Math.min(0.9, (o.open ?? 0.15) + rnd() * 0.1))
    const count = Math.max(8, Math.round(N * (1 - open)) + 4)
    const wob = (o.wobble ?? 0.3) * size * 0.06
    const out: number[] = []
    for (let k = 0; k <= count; k++) {
      const idx = (start + k) % N
      const [x, y] = ring[idx]
      const a = twist * 0.05
      const rx = cx + ((x - cx) * Math.cos(a) - (y - cy) * Math.sin(a)) * scale + rnd() * wob
      const ry = cy + ((x - cx) * Math.sin(a) + (y - cy) * Math.cos(a)) * scale + rnd() * wob
      const w = new THREE.Vector3(rx, ry, z0).applyMatrix4(inv)
      mesh.worldToLocal(w)
      out.push(w.x, w.y, w.z)
    }
    ;(line.geometry as LineGeometry).setPositions(out)
  })
}

export function disposeFloating(f: Floating) {
  for (const l of f.lines) { l.geometry.dispose(); (l.material as THREE.Material).dispose() }
}
