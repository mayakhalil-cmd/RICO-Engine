import * as THREE from 'three'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Outline } from './world'

// Contour strokes: the shape's real outline as the camera sees it, every
// edge where the surface turns away from you. That includes the inner
// edges, where a knot passes in front of itself. The strokes are pushed a
// little off the surface, wobble, break open, and are drawn again a few
// times a second (boil), like hand-drawn animation. They can be lines,
// pop-art dots, letters of your own words, or lines with letters or dots.
// Everything is depth tested, so other objects in front hide them.

interface Topo { pos: Float32Array; nrm: Float32Array; tri: Uint32Array; fn: Float32Array; edges: Uint32Array; size: number }

function topology(g: THREE.BufferGeometry): Topo {
  const c = new THREE.BufferGeometry()
  c.setAttribute('position', g.getAttribute('position').clone())
  if (g.index) c.setIndex(g.index.clone())
  const m = mergeVertices(c, 1e-4)
  m.computeVertexNormals()
  const pos = m.getAttribute('position').array as Float32Array
  const nrm = m.getAttribute('normal').array as Float32Array
  const tri = m.index ? new Uint32Array(m.index.array) : new Uint32Array(pos.length / 3).map((_, i) => i)
  const nt = tri.length / 3
  const fn = new Float32Array(nt * 3)
  const a = new THREE.Vector3(), b = new THREE.Vector3(), cc = new THREE.Vector3()
  for (let f = 0; f < nt; f++) {
    a.fromArray(pos, tri[f * 3] * 3); b.fromArray(pos, tri[f * 3 + 1] * 3); cc.fromArray(pos, tri[f * 3 + 2] * 3)
    const n = b.sub(a).cross(cc.sub(a)).normalize()
    fn[f * 3] = n.x; fn[f * 3 + 1] = n.y; fn[f * 3 + 2] = n.z
  }
  // every edge once: its two points and the faces on each side (or none)
  const map = new Map<string, number>()
  const list: number[] = []
  for (let f = 0; f < nt; f++) for (let k = 0; k < 3; k++) {
    const i = tri[f * 3 + k], j = tri[f * 3 + ((k + 1) % 3)]
    const key = i < j ? `${i}_${j}` : `${j}_${i}`
    const at = map.get(key)
    if (at === undefined) { map.set(key, list.length); list.push(Math.min(i, j), Math.max(i, j), f, 0xffffffff) }
    else list[at + 3] = f
  }
  m.computeBoundingSphere()
  const size = m.boundingSphere?.radius ?? 1
  m.dispose(); c.dispose()
  return { pos, nrm, tri, fn, edges: new Uint32Array(list), size }
}

// The outline edges for a camera at `eye` (in the object's own space), joined into strokes.
function contours(t: Topo, eye: THREE.Vector3, creaseCos: number): number[][] {
  const nt = t.tri.length / 3
  const front = new Uint8Array(nt)
  for (let f = 0; f < nt; f++) {
    const i = t.tri[f * 3] * 3
    const dx = eye.x - t.pos[i], dy = eye.y - t.pos[i + 1], dz = eye.z - t.pos[i + 2]
    front[f] = t.fn[f * 3] * dx + t.fn[f * 3 + 1] * dy + t.fn[f * 3 + 2] * dz > 0 ? 1 : 0
  }
  // vertex -> its outline neighbours
  const nb = new Map<number, number[]>()
  const add = (a: number, b: number) => { (nb.get(a) ?? nb.set(a, []).get(a)!).push(b); (nb.get(b) ?? nb.set(b, []).get(b)!).push(a) }
  for (let e = 0; e < t.edges.length; e += 4) {
    const a = t.edges[e], b = t.edges[e + 1], f1 = t.edges[e + 2], f2 = t.edges[e + 3]
    if (f2 === 0xffffffff) { if (front[f1]) add(a, b); continue }
    if (front[f1] !== front[f2]) { add(a, b); continue }
    // sharp creases facing you
    if (creaseCos < 1 && front[f1]) {
      const d = t.fn[f1 * 3] * t.fn[f2 * 3] + t.fn[f1 * 3 + 1] * t.fn[f2 * 3 + 1] + t.fn[f1 * 3 + 2] * t.fn[f2 * 3 + 2]
      if (d < creaseCos) add(a, b)
    }
  }
  // walk them into chains
  const used = new Set<string>()
  const key = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`)
  const chains: number[][] = []
  const starts = [...nb.keys()].sort((a, b) => (nb.get(a)!.length === 1 ? -1 : 0) - (nb.get(b)!.length === 1 ? -1 : 0))
  for (const s of starts) {
    for (const n0 of nb.get(s)!) {
      if (used.has(key(s, n0))) continue
      const chain = [s, n0]
      used.add(key(s, n0))
      let prev = s, cur = n0
      for (let guard = 0; guard < 100000; guard++) {
        const next = nb.get(cur)!.find((x) => x !== prev && !used.has(key(cur, x)))
        if (next === undefined) break
        used.add(key(cur, next))
        chain.push(next)
        prev = cur; cur = next
        if (cur === s) break
      }
      if (chain.length >= 2) chains.push(chain)
    }
  }
  return chains
}

// dots and letters: little billboards that keep their size on screen
const GLYPH_VERT = `
attribute vec3 iPos; attribute float iAngle; attribute float iCell; attribute float iScale;
uniform vec2 uRes; uniform float uSize; uniform float uCells;
varying vec2 vUv;
void main() {
  vec4 c = projectionMatrix * modelViewMatrix * vec4(iPos, 1.0);
  float s = sin(iAngle), co = cos(iAngle);
  vec2 p = position.xy;
  vec2 r = vec2(p.x * co - p.y * s, p.x * s + p.y * co);
  c.xy += r * uSize * iScale / uRes * 2.0 * c.w;
  gl_Position = c;
  vUv = vec2((iCell + uv.x) / uCells, uv.y);
}`
const GLYPH_FRAG = `
uniform sampler2D uAtlas; uniform vec3 uColor; varying vec2 vUv;
void main() { float a = texture2D(uAtlas, vUv).a; if (a < 0.35) discard; gl_FragColor = vec4(uColor, a); }`

const atlases = new Map<string, { tex: THREE.CanvasTexture; cells: number; chars: string }>()
function atlasOf(text: string, font: string) {
  const chars = [...new Set(('●' + text.replace(/\s+/g, '')).split(''))].join('').slice(0, 64)
  const k = `${chars}|${font}`
  const hit = atlases.get(k)
  if (hit) return hit
  const S = 64
  const c = document.createElement('canvas')
  c.width = S * chars.length; c.height = S
  const g = c.getContext('2d')!
  g.fillStyle = '#fff'
  g.textAlign = 'center'; g.textBaseline = 'middle'
  ;[...chars].forEach((ch, i) => {
    if (i === 0) { g.beginPath(); g.arc(i * S + S / 2, S / 2, S * 0.3, 0, Math.PI * 2); g.fill(); return }
    g.font = `${Math.round(S * 0.78)}px ${font}`
    g.fillText(ch, i * S + S / 2, S / 2 + 2)
  })
  const tex = new THREE.CanvasTexture(c)
  tex.minFilter = THREE.LinearFilter
  const a = { tex, cells: chars.length, chars }
  atlases.set(k, a)
  return a
}

export interface ContourBuilt { group: THREE.Group; lines: LineSegments2; glyphs: THREE.Mesh | null; topo: Topo; key: string; step: number; camKey: string }

export function buildContour(mesh: THREE.Mesh): ContourBuilt {
  const group = new THREE.Group()
  group.userData.helper = true
  const lg = new LineSegmentsGeometry()
  lg.setPositions([0, 0, 0, 0, 0, 0])
  const lines = new LineSegments2(lg, new LineMaterial({ color: 0xffe14a, linewidth: 2, worldUnits: false }))
  lines.frustumCulled = false
  lines.userData.helper = true
  group.add(lines)
  return { group, lines, glyphs: null, topo: topology(mesh.geometry), key: mesh.geometry.uuid, step: -1, camKey: '' }
}

const MAX_GLYPHS = 4000
function glyphMesh(): THREE.Mesh {
  const base = new THREE.PlaneGeometry(1, 1)
  const g = new THREE.InstancedBufferGeometry()
  g.index = base.index
  g.setAttribute('position', base.getAttribute('position'))
  g.setAttribute('uv', base.getAttribute('uv'))
  g.setAttribute('iPos', new THREE.InstancedBufferAttribute(new Float32Array(MAX_GLYPHS * 3), 3))
  g.setAttribute('iAngle', new THREE.InstancedBufferAttribute(new Float32Array(MAX_GLYPHS), 1))
  g.setAttribute('iCell', new THREE.InstancedBufferAttribute(new Float32Array(MAX_GLYPHS), 1))
  g.setAttribute('iScale', new THREE.InstancedBufferAttribute(new Float32Array(MAX_GLYPHS), 1))
  g.instanceCount = 0
  const m = new THREE.ShaderMaterial({
    vertexShader: GLYPH_VERT, fragmentShader: GLYPH_FRAG, transparent: true,
    uniforms: { uRes: { value: new THREE.Vector2(1280, 720) }, uSize: { value: 14 }, uCells: { value: 1 }, uAtlas: { value: null }, uColor: { value: new THREE.Color() } },
  })
  const mesh = new THREE.Mesh(g, m)
  mesh.frustumCulled = false
  mesh.userData.helper = true
  return mesh
}

export function updateContour(b: ContourBuilt, mesh: THREE.Mesh, o: Outline, camera: THREE.Camera, t: number, res: THREE.Vector2) {
  const draw = o.drawWith ?? 'lines'
  const wantLines = draw === 'lines' || draw === 'lines+letters' || draw === 'lines+dots'
  const wantGlyphs = draw !== 'lines'
  const lm = b.lines.material as LineMaterial
  lm.color.set(o.floatColor ?? '#ffe14a')
  lm.linewidth = o.floatWidth ?? 2
  lm.resolution.copy(res)
  lm.depthTest = !o.overAll
  b.lines.visible = wantLines
  if (wantGlyphs && !b.glyphs) { b.glyphs = glyphMesh(); b.group.add(b.glyphs) }
  if (b.glyphs) {
    b.glyphs.visible = wantGlyphs
    const gm = b.glyphs.material as THREE.ShaderMaterial
    gm.depthTest = !o.overAll
    ;(gm.uniforms.uRes.value as THREE.Vector2).copy(res)
    gm.uniforms.uSize.value = draw.includes('letters') ? o.letterSize ?? 18 : o.dotSize ?? 6
    ;(gm.uniforms.uColor.value as THREE.Color).set(o.glyphColor ?? o.floatColor ?? '#ffe14a')
  }

  const fps = Math.max(0, o.boil)
  const step = fps > 0 ? Math.floor(t * fps) : 0
  camera.updateMatrixWorld()
  mesh.updateMatrixWorld()
  const eye = mesh.worldToLocal(camera.getWorldPosition(new THREE.Vector3()))
  const camKey = `${eye.x.toFixed(3)},${eye.y.toFixed(3)},${eye.z.toFixed(3)}|${draw}|${o.gap}|${o.wobble}|${o.open}|${o.strokes}|${o.text}|${o.dotGap}|${o.creases}`
  if (step === b.step && camKey === b.camKey) return
  b.step = step
  b.camKey = camKey

  const T = b.topo
  const chains = contours(T, eye, o.creases ? Math.cos(((o.crease ?? 35) * Math.PI) / 180) : 1)
  let seed = step * 7919 + 17
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5 }
  const gap = (o.gap ?? 0.12) * T.size * 0.35
  const wob = (o.wobble ?? 0.3) * T.size * 0.02
  const open = Math.max(0, Math.min(0.95, o.open ?? 0.15))
  const passes = Math.max(1, Math.min(5, Math.round(o.strokes ?? 2)))
  // a point pushed off the surface (along its normal) and a little towards you, then shaken
  const P = (v: number, pass: number, out: number[]) => {
    const i = v * 3
    const push = gap * (1 + pass * 0.35)
    let x = T.pos[i] + T.nrm[i] * push, y = T.pos[i + 1] + T.nrm[i + 1] * push, z = T.pos[i + 2] + T.nrm[i + 2] * push
    const ex = eye.x - x, ey = eye.y - y, ez = eye.z - z, d = Math.hypot(ex, ey, ez) || 1
    const toward = T.size * 0.01
    x += (ex / d) * toward + rnd() * wob; y += (ey / d) * toward + rnd() * wob; z += (ez / d) * toward + rnd() * wob
    out.push(x, y, z)
  }
  const segs: number[] = []
  const strokes: number[][] = []        // the drawn strokes as points, for dots and letters
  for (let pass = 0; pass < passes; pass++) {
    for (const ch of chains) {
      // break the stroke open in places, like a quick sketch
      let k = 0
      while (k < ch.length - 1) {
        const len = Math.max(2, Math.round(ch.length * (1 - open) * (0.5 + (rnd() + 0.5) * 0.5)))
        const piece: number[] = []
        for (let j = k; j < Math.min(ch.length, k + len); j++) P(ch[j], pass, piece)
        if (piece.length >= 6) {
          strokes.push(piece)
          for (let j = 0; j + 5 < piece.length; j += 3) segs.push(piece[j], piece[j + 1], piece[j + 2], piece[j + 3], piece[j + 4], piece[j + 5])
        }
        k += len + Math.max(1, Math.round(ch.length * open * (rnd() + 0.5) * 0.6))
      }
    }
  }
  ;(b.lines.geometry as LineSegmentsGeometry).setPositions(segs.length ? segs : [0, 0, 0, 0, 0, 0])

  if (b.glyphs && wantGlyphs) {
    const letters = draw.includes('letters')
    const text = (o.text ?? 'RICO').replace(/\s+/g, '') || 'RICO'
    const at = atlasOf(text, o.font ?? "'Teletactile', monospace")
    const gm = b.glyphs.material as THREE.ShaderMaterial
    gm.uniforms.uAtlas.value = at.tex
    gm.uniforms.uCells.value = at.cells
    const g = b.glyphs.geometry as THREE.InstancedBufferGeometry
    const ip = g.getAttribute('iPos') as THREE.InstancedBufferAttribute, ia = g.getAttribute('iAngle') as THREE.InstancedBufferAttribute
    const ic = g.getAttribute('iCell') as THREE.InstancedBufferAttribute, is = g.getAttribute('iScale') as THREE.InstancedBufferAttribute
    const spacing = letters ? (o.letterSize ?? 18) * 0.9 : (o.dotSize ?? 6) * (1 + (o.dotGap ?? 1))
    // place them along each stroke, evenly on screen
    const v = new THREE.Vector3(), w2 = new THREE.Vector3()
    const toScreen = (x: number, y: number, z: number, into: THREE.Vector3) => into.set(x, y, z).applyMatrix4(mesh.matrixWorld).project(camera).multiply(new THREE.Vector3(res.x / 2, res.y / 2, 1))
    let n = 0, letter = 0
    for (const s of strokes) {
      let carry = 0
      for (let j = 0; j + 5 < s.length && n < MAX_GLYPHS; j += 3) {
        toScreen(s[j], s[j + 1], s[j + 2], v); toScreen(s[j + 3], s[j + 4], s[j + 5], w2)
        const dx = w2.x - v.x, dy = w2.y - v.y, L = Math.hypot(dx, dy)
        let d = carry
        while (d < L && n < MAX_GLYPHS) {
          const f = d / Math.max(1e-6, L)
          ip.setXYZ(n, s[j] + (s[j + 3] - s[j]) * f, s[j + 1] + (s[j + 4] - s[j + 1]) * f, s[j + 2] + (s[j + 5] - s[j + 2]) * f)
          ia.setX(n, letters ? Math.atan2(dy, dx) : 0)
          ic.setX(n, letters ? 1 + at.chars.slice(1).indexOf(text[letter++ % text.length]) : 0)
          is.setX(n, letters ? 1 + rnd() * 0.25 : 1)
          n++
          d += spacing
        }
        carry = d - L
      }
    }
    g.instanceCount = n
    ip.needsUpdate = ia.needsUpdate = ic.needsUpdate = is.needsUpdate = true
  }
}

export function disposeContour(b: ContourBuilt) {
  b.lines.geometry.dispose(); (b.lines.material as THREE.Material).dispose()
  if (b.glyphs) { b.glyphs.geometry.dispose(); (b.glyphs.material as THREE.Material).dispose() }
}

// The strokes as plain line points in world space (for exporting to other apps).
export function contourWorldLines(b: ContourBuilt, mesh: THREE.Mesh): Float32Array {
  const g = b.lines.geometry as LineSegmentsGeometry
  const s = g.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute, e = g.getAttribute('instanceEnd') as THREE.InterleavedBufferAttribute
  const out = new Float32Array(s.count * 6)
  const v = new THREE.Vector3()
  for (let i = 0; i < s.count; i++) {
    v.fromBufferAttribute(s, i).applyMatrix4(mesh.matrixWorld); out.set([v.x, v.y, v.z], i * 6)
    v.fromBufferAttribute(e, i).applyMatrix4(mesh.matrixWorld); out.set([v.x, v.y, v.z], i * 6 + 3)
  }
  return out
}
