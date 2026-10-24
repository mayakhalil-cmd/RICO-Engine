import * as THREE from 'three'

// Painting on objects. Each object can have a few pictures: the colors you
// paint, a mask (white where a material layer shows), and material maps:
// roughness, metal, glow, glass and bumps. A brush material paints into
// several of them at once (gold is a color, metal and a little roughness).
// A pen works: pressure changes the size and how strong the paint is.
//
// The paint is stored as six flat pictures, one for each side of a box
// around the object (right, top, front, left, bottom, back), and each point
// of the surface takes its paint from the sides it faces. This does not
// depend on how the model is cut into pieces, so there are no seams, and
// sculpting does not tear it. Paint saved by older versions (one picture
// wrapped around the model) still shows the old way.

export const PAINT_SIZE = 1024
export const CELL = 512
const BOX_W = CELL * 3, BOX_H = CELL * 2
export type PaintBox = [number, number, number, number]   // center x, y, z and half size, in the object's own space
export type Channel = 'color' | 'mask' | 'rough' | 'metal' | 'glow' | 'glass' | 'bump'
export const MAP_CHANNELS: Channel[] = ['rough', 'metal', 'glow', 'glass', 'bump']

interface Layer { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture }
interface Paint { layers: Partial<Record<Channel, Layer>>; loaded: string; boxed: boolean; box: PaintBox | null }
const paints = new Map<string, Paint>()

function layer(boxed: boolean, fill?: string, srgb = false): Layer {
  const c = document.createElement('canvas')
  c.width = boxed ? BOX_W : PAINT_SIZE
  c.height = boxed ? BOX_H : PAINT_SIZE
  if (fill) { const g = c.getContext('2d')!; g.fillStyle = fill; g.fillRect(0, 0, c.width, c.height) }
  const tex = new THREE.CanvasTexture(c)
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace
  if (boxed) {
    // no blurring across the borders of the six pictures
    tex.generateMipmaps = false
    tex.minFilter = THREE.LinearFilter
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
  }
  return { canvas: c, tex }
}

function draw(l: Layer, url: string | undefined, fill?: string) {
  const g = l.canvas.getContext('2d')!
  const W = l.canvas.width, H = l.canvas.height
  g.clearRect(0, 0, W, H)
  if (fill) { g.fillStyle = fill; g.fillRect(0, 0, W, H) }
  if (!url) { l.tex.needsUpdate = true; return Promise.resolve() }
  return new Promise<void>((res) => {
    const img = new Image()
    img.onload = () => { g.drawImage(img, 0, 0, W, H); l.tex.needsUpdate = true; res() }
    img.onerror = () => res()
    img.src = url
  })
}

const sig = (u?: string) => `${u?.length ?? 0}:${u?.slice(-40) ?? ''}`

export interface PaintSource { id: string; paint?: string; paintMask?: string; paintMaps?: Record<string, string>; paintBox?: PaintBox }

// The paint of an object, made (and loaded from the saved pictures) when needed.
export function paintOf(o: PaintSource) {
  const { id, paint: color, paintMask: mask, paintMaps: maps } = o
  // Old paint (saved before the box method) keeps the wrapped way.
  const boxed = Boolean(o.paintBox) || !color
  let p = paints.get(id)
  if (p && p.boxed !== boxed && !stroking) {
    for (const l of Object.values(p.layers)) l?.tex.dispose()
    p = undefined
  }
  if (!p) {
    p = { layers: { color: layer(boxed, undefined, true), mask: layer(boxed, '#000') }, loaded: '', boxed, box: o.paintBox ?? null }
    paints.set(id, p)
  }
  if (o.paintBox && !stroking) p.box = o.paintBox
  const key = [sig(color), sig(mask), ...MAP_CHANNELS.map((c) => sig(maps?.[c]))].join('|')
  if (p.loaded !== key && !stroking) {
    p.loaded = key
    void draw(p.layers.color!, color)
    void draw(p.layers.mask!, mask, '#000')
    for (const ch of MAP_CHANNELS) {
      if (!maps?.[ch]) continue
      const l = p.layers[ch] ?? (p.layers[ch] = layer(p.boxed, undefined, ch === 'glow'))
      void draw(l, maps[ch])
    }
  }
  return {
    colorTex: p.layers.color!.tex, maskTex: p.layers.mask!.tex,
    tex: (ch: Channel) => p!.layers[ch]?.tex ?? null,
    box: p.boxed ? (p.box ?? [0, 0, 0, 1] as PaintBox) : null,
  }
}

// Paint saved before the box method (it can show seams on modeled shapes).
export const isOldPaint = (id: string) => paints.get(id)?.boxed === false

// The box the paint sits on, fixed the first time you paint, so later
// sculpting does not slide the paint around. A bit of room is left around
// the shape for growing it.
export function ensureBox(id: string, geo: THREE.BufferGeometry): PaintBox | null {
  const p = paints.get(id)
  if (!p || !p.boxed) return null
  if (!p.box) {
    if (!geo.boundingBox) geo.computeBoundingBox()
    const bb = geo.boundingBox!
    const c = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3())
    p.box = [c.x, c.y, c.z, Math.max(sz.x, sz.y, sz.z, 1e-3) * 0.5 * 1.35]
  }
  return p.box
}

// How big the brush is on the object, in the object's own units.
export function brushRadius(id: string): number {
  const p = paints.get(id)
  if (p?.boxed && p.box) return (brush.size * 0.5 / (CELL / 2)) * p.box[3]
  return (brush.size / PAINT_SIZE) * 2
}
export const hasPaint = (id: string) => paints.has(id)

// brushes

export interface BrushMat { name: string; color?: boolean; mask?: boolean; rough?: number; metal?: number; glow?: boolean; glass?: number; bump?: number; tint?: string }
export const BRUSH_MATS: BrushMat[] = [
  { name: 'Paint', color: true },
  { name: 'Gloss paint', color: true, rough: 0.05 },
  { name: 'Matte paint', color: true, rough: 1 },
  { name: 'Metal', color: true, metal: 1, rough: 0.25 },
  { name: 'Gold leaf', color: true, metal: 1, rough: 0.2, tint: '#d4a43a' },
  { name: 'Neon (glows)', color: true, glow: true },
  { name: 'Glass (see-through)', glass: 1, rough: 0.02 },
  { name: 'Raise (bumps)', bump: 1 },
  { name: 'Mask (for layers)', mask: true },
]

export type BrushTexture = 'soft' | 'grain' | 'bristle' | 'canvas' | 'dots' | 'image'
export interface Brush { color: string; size: number; opacity: number; hardness: number; mat: number; erase: boolean; texture: BrushTexture; target: 'color' | 'mask' }
export const brush: Brush = { color: '#f820a0', size: 40, opacity: 0.8, hardness: 0.5, mat: 0, erase: false, texture: 'soft', target: 'color' }

// Tiles that give a brush its texture (white, see-through where no paint goes).
const tiles = new Map<BrushTexture, HTMLCanvasElement>()
let imageTile: HTMLCanvasElement | null = null
export function setBrushImage(img: CanvasImageSource, w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = 256; c.height = 256
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.drawImage(img, 0, 0, w, h, 0, 0, 256, 256)
  const d = g.getImageData(0, 0, 256, 256)
  for (let i = 0; i < d.data.length; i += 4) { const v = (d.data[i] + d.data[i + 1] + d.data[i + 2]) / 3; d.data[i] = d.data[i + 1] = d.data[i + 2] = 255; d.data[i + 3] = v }
  g.putImageData(d, 0, 0)
  imageTile = c
  brush.texture = 'image'
}
function tile(t: BrushTexture): HTMLCanvasElement | null {
  if (t === 'soft') return null
  if (t === 'image') return imageTile
  const hit = tiles.get(t)
  if (hit) return hit
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const g = c.getContext('2d')!
  const d = g.createImageData(256, 256)
  let seed = 7
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    let a = 1
    if (t === 'grain') a = rnd() > 0.45 ? 0.4 + rnd() * 0.6 : 0
    else if (t === 'canvas') a = 0.45 + 0.55 * Math.abs(Math.sin(x * 0.8) * Math.sin(y * 0.8))
    else if (t === 'dots') a = Math.hypot((x % 16) - 8, (y % 16) - 8) < 4 ? 1 : 0
    const i = (y * 256 + x) * 4
    d.data[i] = d.data[i + 1] = d.data[i + 2] = 255
    d.data[i + 3] = Math.round(a * 255)
  }
  if (t === 'bristle') {
    // Hairs of a brush: thin streaks of different strength.
    for (let y = 0; y < 256; y++) {
      const a = rnd() < 0.7 ? 0.35 + rnd() * 0.65 : 0.05
      for (let x = 0; x < 256; x++) { const i = (y * 256 + x) * 4; d.data[i] = d.data[i + 1] = d.data[i + 2] = 255; d.data[i + 3] = Math.round(a * 255 * (0.85 + 0.15 * rnd())) }
    }
  }
  g.putImageData(d, 0, 0)
  tiles.set(t, c)
  return c
}

let stroking = false
let last: THREE.Vector2 | null = null
export function beginStroke() { stroking = true; last = null; lastLocal = null }
export function endStroke() { stroking = false; last = null; lastLocal = null }

// What one dab writes into which picture.
function writes(): { ch: Channel; color: string }[] {
  if (brush.target === 'mask') return [{ ch: 'mask', color: '#ffffff' }]
  const m = BRUSH_MATS[brush.mat] ?? BRUSH_MATS[0]
  const gray = (v: number) => { const n = Math.round(Math.max(0, Math.min(1, v)) * 255); return `rgb(${n},${n},${n})` }
  const out: { ch: Channel; color: string }[] = []
  const col = m.tint ?? brush.color
  if (m.mask) out.push({ ch: 'mask', color: '#ffffff' })
  if (m.color) out.push({ ch: 'color', color: col })
  if (m.rough !== undefined) out.push({ ch: 'rough', color: gray(m.rough) })
  if (m.metal !== undefined) out.push({ ch: 'metal', color: gray(m.metal) })
  if (m.glow) out.push({ ch: 'glow', color: col })
  if (m.glass !== undefined) out.push({ ch: 'glass', color: gray(m.glass) })
  if (m.bump !== undefined) out.push({ ch: 'bump', color: gray(m.bump) })
  return out
}
// The channels a brush material uses, so the material knows to show them.
export const brushChannels = () => writes().map((w) => w.ch)

const stamp = document.createElement('canvas')

function makeStamp(r: number, a: number, color: string, px: number, py: number, angle: number) {
  const size = Math.ceil(r * 2) + 2
  if (stamp.width !== size) { stamp.width = size; stamp.height = size }
  const sg = stamp.getContext('2d')!
  // The dab shape: soft circle, then the brush texture, then the color.
  sg.globalCompositeOperation = 'source-over'
  sg.clearRect(0, 0, size, size)
  const grad = sg.createRadialGradient(size / 2, size / 2, r * brush.hardness * 0.95, size / 2, size / 2, r)
  grad.addColorStop(0, `rgba(255,255,255,${a})`)
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  sg.fillStyle = grad
  sg.fillRect(0, 0, size, size)
  const tl = tile(brush.texture)
  if (tl) {
    const pat = sg.createPattern(tl, 'repeat')!
    // The texture stays put on the object (and turns with the stroke for bristles).
    const m = new DOMMatrix().translateSelf(-(px - size / 2), -(py - size / 2))
    if (brush.texture === 'bristle') m.rotateSelf((angle * 180) / Math.PI + 90)
    pat.setTransform(m)
    sg.globalCompositeOperation = 'destination-in'
    sg.fillStyle = pat
    sg.fillRect(0, 0, size, size)
  }
  sg.globalCompositeOperation = 'source-in'
  sg.fillStyle = color
  sg.fillRect(0, 0, size, size)
  return size
}

function put(l: Layer, px: number, py: number, size: number, clip?: [number, number, number, number]) {
  const g = l.canvas.getContext('2d')!
  g.save()
  if (clip) { g.beginPath(); g.rect(clip[0], clip[1], clip[2], clip[3]); g.clip() }
  g.globalCompositeOperation = brush.erase ? 'destination-out' : 'source-over'
  g.drawImage(stamp, px - size / 2, py - size / 2)
  g.restore()
}

// The six sides: which axis, which sign, and where its picture sits.
const SIDES: { axis: 0 | 1 | 2; sign: 1 | -1; col: number; row: number }[] = [
  { axis: 0, sign: 1, col: 0, row: 0 }, { axis: 1, sign: 1, col: 1, row: 0 }, { axis: 2, sign: 1, col: 2, row: 0 },
  { axis: 0, sign: -1, col: 0, row: 1 }, { axis: 1, sign: -1, col: 1, row: 1 }, { axis: 2, sign: -1, col: 2, row: 1 },
]
// The two flat coordinates (0..1) of a point seen from one axis. The shader
// does the same (see materials.ts, pTex).
function sideUV(q: THREE.Vector3, axis: number): [number, number] {
  return axis === 0 ? [q.z, q.y] : axis === 1 ? [q.x, q.z] : [q.x, q.y]
}

export interface Hit { uv?: THREE.Vector2 | null; local: THREE.Vector3; normal: THREE.Vector3 }
let lastLocal: THREE.Vector3 | null = null

// One dab (and the dabs between it and the last one, so fast strokes stay solid).
export function dab(id: string, hit: Hit, pressure: number) {
  const p = paints.get(id)
  if (!p) return
  if (!p.boxed) { if (hit.uv) dabUV(p, hit.uv, pressure); return }
  if (!p.box) return
  const [cx, cy, cz, half] = p.box
  const rPx = Math.max(1, brush.size * 0.5 * (0.3 + 0.7 * pressure))
  const rObj = (rPx / (CELL / 2)) * half
  const from = lastLocal && lastLocal.distanceTo(hit.local) < half * 0.5 ? lastLocal : hit.local
  const dist = from.distanceTo(hit.local)
  const steps = Math.max(1, Math.ceil(dist / (rObj * 0.25)))
  const n = hit.normal.clone().normalize()
  const wts = [Math.abs(n.x) ** 4, Math.abs(n.y) ** 4, Math.abs(n.z) ** 4]
  const sum = wts[0] + wts[1] + wts[2] || 1
  const nv = [n.x, n.y, n.z]
  const sides = SIDES.filter((sd) => wts[sd.axis] / sum > 0.04 && Math.sign(nv[sd.axis] || 1) === sd.sign)
  const ws = writes()
  const q = new THREE.Vector3(), pt = new THREE.Vector3()
  for (let s = 1; s <= steps; s++) {
    pt.lerpVectors(from, hit.local, s / steps)
    q.set((pt.x - cx) / half * 0.5 + 0.5, (pt.y - cy) / half * 0.5 + 0.5, (pt.z - cz) / half * 0.5 + 0.5)
    const a = Math.min(1, brush.opacity * (0.25 + 0.75 * pressure) / Math.max(1, steps * 0.35))
    for (const sd of sides) {
      const [u, v] = sideUV(q, sd.axis)
      const px = (sd.col + u) * CELL, py = (sd.row + 1 - v) * CELL
      const [fu, fv] = sideUV(new THREE.Vector3().subVectors(hit.local, from), sd.axis)
      const angle = Math.atan2(-fv, fu)
      for (const w of ws) {
        const l = p.layers[w.ch] ?? (p.layers[w.ch] = layer(true, undefined, w.ch === 'glow'))
        const size = makeStamp(rPx, a, w.color, px, py, angle)
        put(l, px, py, size, [sd.col * CELL, sd.row * CELL, CELL, CELL])
      }
    }
  }
  for (const w of ws) { const l = p.layers[w.ch]; if (l) l.tex.needsUpdate = true }
  lastLocal = hit.local.clone()
}

// The old way, for paint saved before the box method.
function dabUV(p: Paint, uv: THREE.Vector2, pressure: number) {
  const x = uv.x * PAINT_SIZE, y = (1 - uv.y) * PAINT_SIZE
  const r = Math.max(1, brush.size * (0.3 + 0.7 * pressure))
  const from = last && Math.hypot(last.x - x, last.y - y) < PAINT_SIZE * 0.25 ? last : new THREE.Vector2(x, y)
  const dist = Math.hypot(x - from.x, y - from.y)
  const steps = Math.max(1, Math.ceil(dist / (r * 0.25)))
  const angle = Math.atan2(y - from.y, x - from.x)
  for (const w of writes()) {
    const l = p.layers[w.ch] ?? (p.layers[w.ch] = layer(false, undefined, w.ch === 'glow'))
    for (let s = 1; s <= steps; s++) {
      const px = from.x + ((x - from.x) * s) / steps, py = from.y + ((y - from.y) * s) / steps
      const a = Math.min(1, brush.opacity * (0.25 + 0.75 * pressure) / Math.max(1, steps * 0.35))
      const size = makeStamp(r, a, w.color, px, py, angle)
      put(l, px, py, size)
    }
    l.tex.needsUpdate = true
  }
  last = new THREE.Vector2(x, y)
}

// Starts the paint over with the box method (no seams).
export function restartPaint(id: string) {
  const p = paints.get(id)
  if (p) for (const l of Object.values(p.layers)) l?.tex.dispose()
  paints.set(id, { layers: { color: layer(true, undefined, true), mask: layer(true, '#000') }, loaded: '', boxed: true, box: null })
}

export function fillPaint(id: string, target: 'color' | 'mask', clear: boolean) {
  const p = paints.get(id)
  if (!p) return
  const chans: Channel[] = target === 'mask' ? ['mask'] : writes().map((w) => w.ch)
  for (const ch of chans) {
    const l = p.layers[ch] ?? (p.layers[ch] = layer(p.boxed, undefined, ch === 'glow'))
    const g = l.canvas.getContext('2d')!
    const W = l.canvas.width, H = l.canvas.height
    g.clearRect(0, 0, W, H)
    if (!clear) { g.fillStyle = ch === 'mask' ? '#ffffff' : writes().find((w) => w.ch === ch)?.color ?? brush.color; g.fillRect(0, 0, W, H) }
    else if (ch === 'mask') { g.fillStyle = '#000'; g.fillRect(0, 0, W, H) }
    l.tex.needsUpdate = true
  }
}

// The pictures to save with the object.
export function savePaint(id: string): { paint: string; paintMask: string; paintMaps: Record<string, string>; paintBox?: PaintBox } | null {
  const p = paints.get(id)
  if (!p) return null
  const paintMaps: Record<string, string> = {}
  for (const ch of MAP_CHANNELS) { const l = p.layers[ch]; if (l) paintMaps[ch] = l.canvas.toDataURL('image/png') }
  const out = { paint: p.layers.color!.canvas.toDataURL('image/png'), paintMask: p.layers.mask!.canvas.toDataURL('image/png'), paintMaps, ...(p.boxed && p.box ? { paintBox: p.box } : {}) }
  p.loaded = [sig(out.paint), sig(out.paintMask), ...MAP_CHANNELS.map((c) => sig(paintMaps[c]))].join('|')
  return out
}
