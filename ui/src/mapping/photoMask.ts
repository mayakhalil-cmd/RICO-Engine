import { contours } from './gobo'
import { homography, type P2 } from './model'

// Masks from a photo: you take a picture of the real object from where the
// projector stands, line the photo up with the projector's picture (four
// corners), click the object with a magic wand, and RICO traces its edge
// into a mask. Also: a mask from a 3D object seen by a calibrated projector.

export interface Photo { w: number; h: number; px: Uint8ClampedArray }

export function photoFrom(img: CanvasImageSource, iw: number, ih: number, maxW = 720): { photo: Photo; canvas: HTMLCanvasElement } {
  const k = Math.min(1, maxW / iw)
  const w = Math.max(8, Math.round(iw * k)), h = Math.max(8, Math.round(ih * k))
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.drawImage(img, 0, 0, w, h)
  return { photo: { w, h, px: g.getImageData(0, 0, w, h).data }, canvas: c }
}

// Magic wand: every pixel close enough in color to the clicked one, joined
// to it (or anywhere, when "contiguous" is off).
export function wand(p: Photo, x: number, y: number, tolerance: number, contiguous = true): Uint8Array {
  const { w, h, px } = p
  const out = new Uint8Array(w * h)
  const i0 = (y * w + x) * 4
  const r0 = px[i0], g0 = px[i0 + 1], b0 = px[i0 + 2]
  const tol2 = (tolerance * 441.7) ** 2
  const close = (i: number) => { const dr = px[i * 4] - r0, dg = px[i * 4 + 1] - g0, db = px[i * 4 + 2] - b0; return dr * dr + dg * dg + db * db <= tol2 }
  if (!contiguous) { for (let i = 0; i < w * h; i++) if (close(i)) out[i] = 1; return out }
  const stack = [y * w + x]
  out[y * w + x] = 1
  while (stack.length) {
    const i = stack.pop()!
    const cx = i % w, cy = (i - cx) / w
    const n = [cx > 0 ? i - 1 : -1, cx < w - 1 ? i + 1 : -1, cy > 0 ? i - w : -1, cy < h - 1 ? i + w : -1]
    for (const j of n) if (j >= 0 && !out[j] && close(j)) { out[j] = 1; stack.push(j) }
  }
  return out
}

export function combine(a: Uint8Array, b: Uint8Array, mode: 'set' | 'add' | 'sub'): Uint8Array {
  if (mode === 'set') return b
  const out = new Uint8Array(a.length)
  for (let i = 0; i < a.length; i++) out[i] = mode === 'add' ? (a[i] | b[i]) : (a[i] && !b[i] ? 1 : 0)
  return out
}

// Grows (n > 0) or shrinks (n < 0) the selection by n pixels.
export function grow(sel: Uint8Array, w: number, h: number, n: number): Uint8Array {
  let cur = sel
  const want = n > 0 ? 1 : 0
  for (let k = 0; k < Math.abs(n); k++) {
    const next = new Uint8Array(cur)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (cur[i] === want) continue
      if ((x > 0 && cur[i - 1] === want) || (x < w - 1 && cur[i + 1] === want) || (y > 0 && cur[i - w] === want) || (y < h - 1 && cur[i + w] === want)) next[i] = want
    }
    cur = next
  }
  return cur
}

// Rounds off small bumps and fills small holes (a blur, then a threshold).
export function smoothSel(sel: Uint8Array, w: number, h: number, r = 2): Uint8Array {
  const out = new Uint8Array(sel.length)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const X = x + dx, Y = y + dy
      if (X < 0 || Y < 0 || X >= w || Y >= h) continue
      s += sel[Y * w + X]; n++
    }
    out[y * w + x] = s * 2 >= n ? 1 : 0
  }
  return out
}

function invert3(m: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g
  const det = a * A + b * B + c * C || 1e-12
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det]
}

// The selection's outlines, in output units (0..1 of the projector's picture).
// quad: where the projector's picture corners are in the photo (0..1 of the photo).
export function selectionToMasks(sel: Uint8Array, w: number, h: number, quad: P2[]): P2[][] {
  const Hinv = invert3(homography(quad))
  return contours(sel, w, h).filter((c) => c.length >= 3).map((c) => c.map(([x, y]) => {
    const u = x / w, v = y / h
    const z = Hinv[6] * u + Hinv[7] * v + Hinv[8]
    return [(Hinv[0] * u + Hinv[1] * v + Hinv[2]) / z, (Hinv[3] * u + Hinv[4] * v + Hinv[5]) / z] as P2
  }))
}

// A 3D object's shape as a projector sees it: its triangles drawn flat, then
// traced. view and proj are the projector's camera (column-major 4x4).
export function silhouette(tris: Float32Array, view: number[], proj: number[], gw = 480, gh = 270): P2[][] {
  const mul = (m: number[], x: number, y: number, z: number, w: number) => [m[0] * x + m[4] * y + m[8] * z + m[12] * w, m[1] * x + m[5] * y + m[9] * z + m[13] * w, m[2] * x + m[6] * y + m[10] * z + m[14] * w, m[3] * x + m[7] * y + m[11] * z + m[15] * w]
  const c = document.createElement('canvas')
  c.width = gw; c.height = gh
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.fillStyle = '#fff'
  g.strokeStyle = '#fff'
  g.lineWidth = 1
  for (let i = 0; i < tris.length; i += 9) {
    const pts: [number, number][] = []
    let behind = false
    for (let k = 0; k < 3; k++) {
      const vv = mul(view, tris[i + k * 3], tris[i + k * 3 + 1], tris[i + k * 3 + 2], 1)
      const cc = mul(proj, vv[0], vv[1], vv[2], vv[3])
      if (cc[3] <= 1e-6) { behind = true; break }
      pts.push([((cc[0] / cc[3] + 1) / 2) * gw, ((1 - cc[1] / cc[3]) / 2) * gh])
    }
    if (behind) continue
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); g.lineTo(pts[1][0], pts[1][1]); g.lineTo(pts[2][0], pts[2][1]); g.closePath(); g.fill(); g.stroke()
  }
  const data = g.getImageData(0, 0, gw, gh).data
  const on = new Uint8Array(gw * gh)
  for (let i = 0; i < on.length; i++) on[i] = data[i * 4 + 3] > 100 ? 1 : 0
  return contours(on, gw, gh).filter((cc) => cc.length >= 3).map((cc) => cc.map(([x, y]) => [x / gw, y / gh] as P2))
}

// smarter selections

const lum = (p: Photo, i: number) => 0.299 * p.px[i * 4] + 0.587 * p.px[i * 4 + 1] + 0.114 * p.px[i * 4 + 2]

// How strong the edge is at every pixel (Sobel), 0..1.
export function edges(p: Photo): Float32Array {
  const { w, h } = p
  const out = new Float32Array(w * h)
  let max = 1
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const L = (dx: number, dy: number) => lum(p, (y + dy) * w + x + dx)
    const gx = -L(-1, -1) - 2 * L(-1, 0) - L(-1, 1) + L(1, -1) + 2 * L(1, 0) + L(1, 1)
    const gy = -L(-1, -1) - 2 * L(0, -1) - L(1, -1) + L(-1, 1) + 2 * L(0, 1) + L(1, 1)
    const v = Math.hypot(gx, gy)
    out[y * w + x] = v
    if (v > max) max = v
  }
  for (let i = 0; i < out.length; i++) out[i] /= max
  return out
}

// Fills holes: anything not selected that the outside can not reach.
export function fillHoles(sel: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(sel)
  const seen = new Uint8Array(w * h)
  const stack: number[] = []
  const push = (i: number) => { if (!seen[i] && !sel[i]) { seen[i] = 1; stack.push(i) } }
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x) }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1) }
  while (stack.length) {
    const i = stack.pop()!
    const x = i % w, y = (i - x) / w
    if (x > 0) push(i - 1); if (x < w - 1) push(i + 1); if (y > 0) push(i - w); if (y < h - 1) push(i + w)
  }
  for (let i = 0; i < out.length; i++) if (!sel[i] && !seen[i]) out[i] = 1
  return out
}

// Keeps only the biggest joined area (or the one under a point).
export function biggest(sel: Uint8Array, w: number, h: number, at?: number): Uint8Array {
  const label = new Int32Array(w * h).fill(-1)
  let best = -1, bestN = 0, n = 0, want = -1
  for (let s = 0; s < w * h; s++) {
    if (!sel[s] || label[s] >= 0) continue
    const stack = [s]; label[s] = n; let count = 0
    while (stack.length) {
      const i = stack.pop()!; count++
      const x = i % w, y = (i - x) / w
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (j >= 0 && sel[j] && label[j] < 0) { label[j] = n; stack.push(j) }
    }
    if (at !== undefined && label[at] === n) want = n
    if (count > bestN) { bestN = count; best = n }
    n++
  }
  const keep = want >= 0 ? want : best
  const out = new Uint8Array(w * h)
  for (let i = 0; i < out.length; i++) out[i] = label[i] === keep ? 1 : 0
  return out
}

// Smart select: click the object. The selection grows over similar colors
// and stops at strong edges, so it follows the object's outline even when
// its colors change a little. Holes are filled.
export function smartSelect(p: Photo, x: number, y: number, sensitivity: number, edge?: Float32Array): Uint8Array {
  const { w, h, px } = p
  const e = edge ?? edges(p)
  const out = new Uint8Array(w * h)
  const start = y * w + x
  let r = px[start * 4], g = px[start * 4 + 1], b = px[start * 4 + 2], count = 1
  const tol = 18 + sensitivity * 110
  const edgeStop = 0.12 + sensitivity * 0.35
  const queue = [start]
  out[start] = 1
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q]
    const cx = i % w, cy = (i - cx) / w
    for (const j of [cx > 0 ? i - 1 : -1, cx < w - 1 ? i + 1 : -1, cy > 0 ? i - w : -1, cy < h - 1 ? i + w : -1]) {
      if (j < 0 || out[j]) continue
      if (e[j] > edgeStop) continue
      const dr = px[j * 4] - r / count, dg = px[j * 4 + 1] - g / count, db = px[j * 4 + 2] - b / count
      if (dr * dr + dg * dg + db * db > tol * tol) continue
      out[j] = 1
      queue.push(j)
      r += px[j * 4]; g += px[j * 4 + 1]; b += px[j * 4 + 2]; count++
    }
  }
  // Take back the edge pixels the growth stopped at.
  return fillHoles(grow(out, w, h, 1), w, h)
}

// Box select: drag a box around the object. RICO learns the background from
// the box's border and keeps what looks different from it.
export function boxSelect(p: Photo, x0: number, y0: number, x1: number, y1: number, sensitivity = 0.5): Uint8Array {
  const { w, h, px } = p
  const ax = Math.max(0, Math.min(x0, x1)), bx = Math.min(w - 1, Math.max(x0, x1))
  const ay = Math.max(0, Math.min(y0, y1)), by = Math.min(h - 1, Math.max(y0, y1))
  const out = new Uint8Array(w * h)
  if (bx - ax < 4 || by - ay < 4) return out
  // Background colors: the box border, grouped into a few colors (k-means).
  const samples: number[][] = []
  const add = (x: number, y: number) => { const i = (y * w + x) * 4; samples.push([px[i], px[i + 1], px[i + 2]]) }
  for (let x = ax; x <= bx; x += 1) { add(x, ay); add(x, by); if (ay + 2 <= by) { add(x, ay + 2); add(x, by - 2) } }
  for (let y = ay; y <= by; y += 1) { add(ax, y); add(bx, y); if (ax + 2 <= bx) { add(ax + 2, y); add(bx - 2, y) } }
  const K = 5
  let centers = Array.from({ length: K }, (_, k) => [...samples[Math.floor((k / K) * samples.length)]])
  for (let it = 0; it < 8; it++) {
    const sum = centers.map(() => [0, 0, 0, 0])
    for (const s of samples) {
      let bi = 0, bd = Infinity
      centers.forEach((c, k) => { const d = (s[0] - c[0]) ** 2 + (s[1] - c[1]) ** 2 + (s[2] - c[2]) ** 2; if (d < bd) { bd = d; bi = k } })
      sum[bi][0] += s[0]; sum[bi][1] += s[1]; sum[bi][2] += s[2]; sum[bi][3]++
    }
    centers = centers.map((c, k) => (sum[k][3] ? [sum[k][0] / sum[k][3], sum[k][1] / sum[k][3], sum[k][2] / sum[k][3]] : c))
  }
  const near = (r: number, g: number, b: number) => Math.sqrt(Math.min(...centers.map((c) => (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2)))
  // How far the background itself spreads from its colors.
  const spread = samples.map((s) => near(s[0], s[1], s[2])).sort((a, b) => a - b)
  const thr = spread[Math.floor(spread.length * 0.95)] * (1.2 + (1 - sensitivity)) + 8
  for (let y = ay + 1; y < by; y++) for (let x = ax + 1; x < bx; x++) {
    const i = y * w + x
    if (near(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]) > thr) out[i] = 1
  }
  const cleaned = grow(grow(grow(grow(out, w, h, 1), w, h, -2), w, h, 1), w, h, 0)
  return fillHoles(biggest(cleaned, w, h), w, h)
}
