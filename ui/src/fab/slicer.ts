// A small slicer: cuts a part into layers and turns each layer into the
// paths a 3D printer's nozzle follows (walls, infill, supports).
//
// How it works, layer by layer:
// 1. Cut every triangle at the middle of the layer: that gives the outline.
// 2. Fill the outline on a fine grid (each closed shell on its own, so parts
//    that touch or overlap join up instead of cancelling out).
// 3. Measure, for every grid cell, how far it is from the edge (an exact
//    distance transform). Walls are the lines at 0.5, 1.5, 2.5 line widths
//    from the edge; that also handles holes and thin parts.
// 4. Infill fills what is left, in the pattern you pick. Areas near the top
//    or the bottom of the part are filled solid.
//
// Everything is in millimetres, z up, the part standing on z = 0.

import { planSupports, type Grid } from './supports'
import { SLICE_DEFAULTS, type Layer, type Path, type PathKind, type SliceSettings } from './settings'

export * from './settings'
export { gcode, type Gcode, type PrintEvent } from './gcode'

const INF = 1e10

// Squared distance of every inside cell to the nearest outside cell
// (Felzenszwalb and Huttenlocher), rows then columns.
export function distance2(inside: Uint8Array, w: number, h: number): Float64Array {
  const d = new Float64Array(w * h)
  for (let i = 0; i < w * h; i++) d[i] = inside[i] ? INF : 0
  const n = Math.max(w, h)
  const f = new Float64Array(n), out = new Float64Array(n), z = new Float64Array(n + 1)
  const v = new Int32Array(n)
  const pass = (len: number) => {
    let k = 0
    v[0] = 0; z[0] = -INF; z[1] = INF
    for (let q = 1; q < len; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
      while (s <= z[k]) { k--; s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]) }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF
    }
    k = 0
    for (let q = 0; q < len; q++) {
      while (z[k + 1] < q) k++
      out[q] = (q - v[k]) * (q - v[k]) + f[v[k]]
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = d[y * w + x]
    pass(h)
    for (let y = 0; y < h; y++) d[y * w + x] = out[y]
  }
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) f[x] = d[row + x]
    pass(w)
    for (let x = 0; x < w; x++) d[row + x] = out[x]
  }
  return d
}

// How far each inside cell is from the edge, in cells, minus half a cell (so
// the edge itself is at 0); outside cells are -0.5. Only distances up to maxD
// are needed, so big areas are done in tiles and the empty middle is skipped.
export function edgeField(inside: Uint8Array, w: number, h: number, maxD: number): Float32Array {
  const field = new Float32Array(w * h).fill(-0.5)
  const T = 128
  if (w * h <= T * T * 4 || maxD > T) {
    const d2 = distance2(inside, w, h)
    for (let p = 0; p < field.length; p++) if (inside[p]) field[p] = Math.sqrt(d2[p]) - 0.5
    return field
  }
  const M = Math.ceil(maxD) + 2
  for (let ty = 0; ty < h; ty += T) for (let tx = 0; tx < w; tx += T) {
    const ex = Math.min(w, tx + T), ey = Math.min(h, ty + T)
    let any = false
    for (let y = ty; y < ey && !any; y++) for (let x = tx; x < ex; x++) if (inside[y * w + x]) { any = true; break }
    if (!any) continue
    const sx = Math.max(0, tx - M), sy = Math.max(0, ty - M), sw = Math.min(w, ex + M) - sx, sh = Math.min(h, ey + M) - sy
    const sub = new Uint8Array(sw * sh)
    for (let y = 0; y < sh; y++) sub.set(inside.subarray((sy + y) * w + sx, (sy + y) * w + sx + sw), y * sw)
    const d2 = distance2(sub, sw, sh)
    for (let y = ty; y < ey; y++) for (let x = tx; x < ex; x++) {
      const p = y * w + x
      if (inside[p]) field[p] = Math.min(M, Math.sqrt(d2[(y - sy) * sw + (x - sx)]) - 0.5)
    }
  }
  return field
}

// Lines where the field crosses t (marching squares), chained into loops.
// Points are in cell units (cell centers at whole numbers).
export function isoLoops(field: Float32Array, w: number, h: number, t: number): number[][] {
  const next = new Map<number, number[]>()
  const pos = new Map<number, [number, number]>()
  const H = (x: number, y: number) => (y * w + x) * 2
  const V = (x: number, y: number) => (y * w + x) * 2 + 1
  const pt = (e: number): [number, number] => {
    const p = pos.get(e)
    if (p) return p
    const cell = e >> 1, x = cell % w, y = (cell - x) / w
    let q: [number, number]
    if ((e & 1) === 0) { const a = field[cell], b = field[cell + 1]; q = [x + (t - a) / (b - a || 1e-9), y] }
    else { const a = field[cell], b = field[cell + w]; q = [x, y + (t - a) / (b - a || 1e-9)] }
    pos.set(e, q)
    return q
  }
  const link = (a: number, b: number) => {
    const la = next.get(a); if (la) la.push(b); else next.set(a, [b])
    const lb = next.get(b); if (lb) lb.push(a); else next.set(b, [a])
  }
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const i = y * w + x
      const a = field[i] >= t ? 1 : 0, b = field[i + 1] >= t ? 2 : 0, c = field[i + w + 1] >= t ? 4 : 0, d = field[i + w] >= t ? 8 : 0
      const k = a | b | c | d
      if (k === 0 || k === 15) continue
      const e0 = H(x, y), e1 = V(x + 1, y), e2 = H(x, y + 1), e3 = V(x, y)
      const mid = (field[i] + field[i + 1] + field[i + w] + field[i + w + 1]) / 4 >= t
      switch (k) {
        case 1: case 14: link(e3, e0); break
        case 2: case 13: link(e0, e1); break
        case 3: case 12: link(e3, e1); break
        case 4: case 11: link(e1, e2); break
        case 6: case 9: link(e0, e2); break
        case 7: case 8: link(e3, e2); break
        case 5: if (mid) { link(e0, e1); link(e2, e3) } else { link(e3, e0); link(e1, e2) } break
        case 10: if (mid) { link(e3, e0); link(e1, e2) } else { link(e0, e1); link(e2, e3) } break
      }
    }
  }
  const seen = new Set<number>()
  const loops: number[][] = []
  const starts = [...next.keys()]
  starts.sort((a, b) => (next.get(a)!.length === 1 ? 0 : 1) - (next.get(b)!.length === 1 ? 0 : 1))
  for (const start of starts) {
    if (seen.has(start)) continue
    const loop: number[] = []
    let prev = -1, cur = start
    for (;;) {
      seen.add(cur)
      const [x, y] = pt(cur)
      loop.push(x, y)
      const nb = next.get(cur)!
      const nxt = nb[0] !== prev ? nb[0] : nb[1]
      if (nxt === undefined || nxt === start || seen.has(nxt)) break
      prev = cur
      cur = nxt
    }
    if (loop.length >= 6) loops.push(loop)
  }
  return loops
}

// Fewer points on a closed loop, keeping it within tol.
export function simplifyLoop(p: number[], tol: number): number[] {
  const n = p.length / 2
  if (n < 5) return p
  const keep = new Uint8Array(n)
  // split at the point farthest from the first
  let far = 0, fd = -1
  for (let i = 1; i < n; i++) { const d = (p[i * 2] - p[0]) ** 2 + (p[i * 2 + 1] - p[1]) ** 2; if (d > fd) { fd = d; far = i } }
  keep[0] = keep[far] = 1
  const stack: [number, number][] = [[0, far], [far, n]]
  const at = (i: number) => (i % n) * 2
  while (stack.length) {
    const [a, b] = stack.pop()!
    const ax = p[at(a)], ay = p[at(a) + 1], bx = p[at(b)], by = p[at(b) + 1]
    const len = Math.hypot(bx - ax, by - ay) || 1e-9
    let best = -1, bd = 0
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - p[at(i) + 1]) - (ax - p[at(i)]) * (by - ay)) / len
      if (d > bd) { bd = d; best = i }
    }
    if (bd > tol && best > 0) { keep[best % n] = 1; stack.push([a, best], [best, b]) }
  }
  const out: number[] = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(p[i * 2], p[i * 2 + 1])
  return out
}


// The cut of one layer: a segment (x1, y1, x2, y2) for each triangle it
// crosses, grouped by shell.
function cutLayer(tris: Float32Array, ids: number[], shellOf: Int32Array, zc: number): Map<number, number[]> {
  const byShell = new Map<number, number[]>()
  for (const t of ids) {
    const o = t * 9
    const pts: number[] = []
    for (let e = 0; e < 3; e++) {
      const a = o + e * 3, b = o + ((e + 1) % 3) * 3
      const za = tris[a + 2] - zc, zb = tris[b + 2] - zc
      if ((za < 0) !== (zb < 0)) {
        const k = za / (za - zb)
        pts.push(tris[a] + (tris[b] - tris[a]) * k, tris[a + 1] + (tris[b + 1] - tris[a + 1]) * k)
      }
    }
    if (pts.length !== 4) continue
    const sh = shellOf[t]
    const l = byShell.get(sh); if (l) l.push(...pts); else byShell.set(sh, pts)
  }
  return byShell
}

// Fills shells on a grid: even-odd inside each shell, shells added together.
function fillShells(shells: number[][], g: Grid, out: Uint8Array) {
  const rows: number[][] = Array.from({ length: g.h }, () => [])
  for (const segs of shells) {
    for (const r of rows) r.length = 0
    for (let i = 0; i < segs.length; i += 4) {
      let x1 = segs[i], y1 = segs[i + 1], x2 = segs[i + 2], y2 = segs[i + 3]
      if (y1 === y2) continue
      if (y1 > y2) { [x1, x2] = [x2, x1]; [y1, y2] = [y2, y1] }
      const j0 = Math.max(0, Math.ceil((y1 - g.y0) / g.r - 0.5)), j1 = Math.min(g.h - 1, Math.ceil((y2 - g.y0) / g.r - 0.5) - 1)
      for (let j = j0; j <= j1; j++) {
        const y = g.y0 + (j + 0.5) * g.r
        rows[j].push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1))
      }
    }
    for (let j = 0; j < g.h; j++) {
      const xs = rows[j]
      if (xs.length < 2) continue
      xs.sort((a, b) => a - b)
      const row = j * g.w
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil((xs[k] - g.x0) / g.r - 0.5)), i1 = Math.min(g.w - 1, Math.ceil((xs[k + 1] - g.x0) / g.r - 0.5) - 1)
        for (let i = i0; i <= i1; i++) out[row + i] = 1
      }
    }
  }
}

// One island of a layer: shells that touch, on a small grid of its own
// (cells line up with the big grid at ox, oy).
interface Island { ox: number; oy: number; g: Grid; inside: Uint8Array }

interface HatchOpts { oneWay?: boolean; offset?: number; w?: number; flow?: number }

// Straight lines across a region at an angle, as paths.
function hatch(mask: Uint8Array, g: Grid, angle: number, spacing: number, minLen: number, kind: PathKind, from: [number, number], o: HatchOpts = {}): Path[] {
  const ca = Math.cos(angle), sa = Math.sin(angle)
  const off = o.offset ?? 0
  // the region's corners on the line's normal
  const W = g.w * g.r, Hh = g.h * g.r
  const corners = [[g.x0, g.y0], [g.x0 + W, g.y0], [g.x0, g.y0 + Hh], [g.x0 + W, g.y0 + Hh]]
  let n0 = Infinity, n1 = -Infinity, t0 = Infinity, t1 = -Infinity
  for (const [x, y] of corners) {
    const nn = -sa * x + ca * y, tt = ca * x + sa * y
    n0 = Math.min(n0, nn); n1 = Math.max(n1, nn); t0 = Math.min(t0, tt); t1 = Math.max(t1, tt)
  }
  const step = g.r * 0.6
  const lines: [number, number, number, number][][] = []
  // lines sit on a fixed grid, so sparse infill lines up from layer to layer
  for (let k = Math.ceil((n0 - off) / spacing); k * spacing + off <= n1; k++) {
    const nn = k * spacing + off
    const spans: [number, number, number, number][] = []
    let on = 0, inSpan = false
    let lastT = 0
    for (let tt = t0; tt <= t1 + step; tt += step) {
      const x = ca * tt - sa * nn, y = sa * tt + ca * nn
      const i = Math.floor((x - g.x0) / g.r), j = Math.floor((y - g.y0) / g.r)
      const inside = i >= 0 && j >= 0 && i < g.w && j < g.h && mask[j * g.w + i] === 1
      if (inside && !inSpan) { on = tt; inSpan = true }
      if (!inside && inSpan) {
        if (lastT - on >= minLen) spans.push([ca * on - sa * nn, sa * on + ca * nn, ca * lastT - sa * nn, sa * lastT + ca * nn])
        inSpan = false
      }
      if (inside) lastT = tt
    }
    if (spans.length) lines.push(spans)
  }
  const make = (pts: number[]): Path => {
    const p: Path = { kind, pts, closed: false }
    if (o.w) p.w = o.w
    if (o.flow !== undefined) p.flow = o.flow
    return p
  }
  const out: Path[] = []
  if (o.oneWay) {
    // every line the same way, one after the other (smoother tops)
    for (const spans of lines) for (const [a, b, c, d] of spans) out.push(make([a, b, c, d]))
    return out
  }
  // back and forth, and join a line to the next when they are close
  let cur: Path | null = null
  let flip = false
  let [px, py] = from
  for (const spans of lines) {
    const ordered = flip ? spans.slice().reverse().map(([a, b, c, d]) => [c, d, a, b] as [number, number, number, number]) : spans
    for (const [a, b, c, d] of ordered) {
      if (cur && Math.hypot(a - px, b - py) < spacing * 1.6) cur.pts.push(a, b, c, d)
      else { cur = make([a, b, c, d]); out.push(cur) }
      px = c; py = d
    }
    flip = !flip
  }
  return out
}

function hull(pts: number[]): number[] {
  const p: [number, number][] = []
  for (let i = 0; i < pts.length; i += 2) p.push([pts[i], pts[i + 1]])
  p.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (p.length < 3) return pts
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lo: [number, number][] = [], hi: [number, number][] = []
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q) }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q) }
  return [...lo.slice(0, -1), ...hi.slice(0, -1)].flat()
}

// Starts a closed loop at the point closest to (x, y).
function startNear(p: number[], x: number, y: number): number[] {
  let best = 0, bd = Infinity
  for (let i = 0; i < p.length; i += 2) { const d = (p[i] - x) ** 2 + (p[i + 1] - y) ** 2; if (d < bd) { bd = d; best = i } }
  return best ? [...p.slice(best), ...p.slice(0, best)] : p
}

// Random numbers that come out the same every time (for seams and fuzzy skin).
function seeded(seed: number) {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

// Grows (+) or shrinks (-) a mask by a number of cells.
function offsetMask(inside: Uint8Array, w: number, h: number, cells: number) {
  if (Math.abs(cells) < 0.05) return
  if (cells > 0) {
    const out = new Uint8Array(w * h)
    for (let p = 0; p < w * h; p++) out[p] = inside[p] ? 0 : 1
    const d2 = distance2(out, w, h), c2 = (cells + 0.5) ** 2
    for (let p = 0; p < w * h; p++) if (!inside[p] && d2[p] <= c2) inside[p] = 1
  } else {
    const d2 = distance2(inside, w, h), c2 = (-cells + 0.5) ** 2
    for (let p = 0; p < w * h; p++) if (inside[p] && d2[p] <= c2) inside[p] = 0
  }
}

// The cells outside that can be reached from the edge of the grid (so not holes).
function outsideOf(inside: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h)
  const stack = new Int32Array(w * h)
  let top = 0
  const push = (p: number) => { if (!inside[p] && !out[p]) { out[p] = 1; stack[top++] = p } }
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x) }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1) }
  while (top) {
    const p = stack[--top], x = p % w
    if (x > 0) push(p - 1)
    if (x < w - 1) push(p + 1)
    if (p >= w) push(p - w)
    if (p < (h - 1) * w) push(p + w)
  }
  return out
}

// Holes grow (+) or shrink (-) by a number of cells.
function offsetHoles(inside: Uint8Array, w: number, h: number, cells: number) {
  if (Math.abs(cells) < 0.05) return
  const outside = outsideOf(inside, w, h)
  const holes = new Uint8Array(w * h)
  let any = false
  for (let p = 0; p < w * h; p++) if (!inside[p] && !outside[p]) { holes[p] = 1; any = true }
  if (!any) return
  if (cells > 0) {
    const notHole = new Uint8Array(w * h)
    for (let p = 0; p < w * h; p++) notHole[p] = holes[p] ? 0 : 1
    const d2 = distance2(notHole, w, h), c2 = (cells + 0.5) ** 2
    for (let p = 0; p < w * h; p++) if (inside[p] && d2[p] <= c2) inside[p] = 0
  } else {
    const d2 = distance2(holes, w, h), c2 = (-cells + 0.5) ** 2
    for (let p = 0; p < w * h; p++) if (holes[p] && d2[p] <= c2) inside[p] = 1
  }
}

// Bumps along a closed loop (fuzzy skin).
function fuzz(p: number[], thick: number, dist: number, rnd: () => number): number[] {
  const out: number[] = []
  const n = p.length / 2
  let carry = 0
  for (let i = 0; i < n; i++) {
    const ax = p[i * 2], ay = p[i * 2 + 1], bx = p[((i + 1) % n) * 2], by = p[((i + 1) % n) * 2 + 1]
    const L = Math.hypot(bx - ax, by - ay)
    if (L < 1e-6) continue
    const nx = -(by - ay) / L, ny = (bx - ax) / L
    for (let t = carry; t < L; t += dist) {
      const k = (rnd() * 2 - 1) * thick
      out.push(ax + ((bx - ax) * t) / L + nx * k, ay + ((by - ay) * t) / L + ny * k)
    }
    carry = (carry - L) % dist
    if (carry < 0) carry += dist
  }
  return out.length >= 6 ? out : p
}

// Fewer points on an open line, keeping it within tol.
function simplifyLine(p: number[], tol: number): number[] {
  const n = p.length / 2
  if (n < 3) return p
  const keep = new Uint8Array(n)
  keep[0] = keep[n - 1] = 1
  const stack: [number, number][] = [[0, n - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    const ax = p[a * 2], ay = p[a * 2 + 1], bx = p[b * 2], by = p[b * 2 + 1]
    const len = Math.hypot(bx - ax, by - ay) || 1e-9
    let best = -1, bd = 0
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - p[i * 2 + 1]) - (ax - p[i * 2]) * (by - ay)) / len
      if (d > bd) { bd = d; best = i }
    }
    if (bd > tol && best > 0) { keep[best] = 1; stack.push([a, best], [best, b]) }
  }
  const out: number[] = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(p[i * 2], p[i * 2 + 1])
  return out
}

// The parts of a line (in mm) that are inside a mask.
function clipToMask(pts: number[], closed: boolean, m: Uint8Array, g: Grid): number[][] {
  const at = (x: number, y: number) => { const i = Math.floor((x - g.x0) / g.r), j = Math.floor((y - g.y0) / g.r); return i >= 0 && j >= 0 && i < g.w && j < g.h && m[j * g.w + i] === 1 }
  const runs: number[][] = []
  let cur: number[] | null = null
  const n = pts.length / 2
  let allIn = true
  for (let i = 0; i < n; i++) {
    if (at(pts[i * 2], pts[i * 2 + 1])) { (cur ??= []).push(pts[i * 2], pts[i * 2 + 1]) }
    else { allIn = false; if (cur && cur.length >= 4) runs.push(cur); cur = null }
  }
  if (cur && cur.length >= 4) runs.push(cur)
  if (closed && allIn) return [pts]
  return runs
}

const lineLen = (p: number[]) => { let L = 0; for (let i = 2; i < p.length; i += 2) L += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); return L }

/**
 * Slices triangles (9 numbers each) into layers. shells: the triangles of
 * each closed part as [first, count]; leave it out for one part.
 */
export function slice(tris: Float32Array, s0: SliceSettings, shells?: [number, number][], progress?: (f: number) => void): Layer[] {
  const s: SliceSettings = { ...SLICE_DEFAULTS, ...s0 }
  const nt = Math.floor(tris.length / 9)
  if (!nt) return []
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity
  for (let i = 0; i < nt * 3; i++) {
    const x = tris[i * 3], y = tris[i * 3 + 1], z = tris[i * 3 + 2]
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z > z1) z1 = z
  }
  const shellOf = new Int32Array(nt)
  if (shells) shells.forEach(([a, c], k) => shellOf.fill(k, a, a + c))
  const lw = s.lineWidth
  const W0 = { outer: s.outerWidth || lw, inner: s.innerWidth || lw, infill: s.infillWidth || lw, solid: s.solidWidth || lw, top: s.topWidth || s.solidWidth || lw, support: s.supportWidth || lw }
  const firstW = s.firstWidth || lw
  const maxW = Math.max(firstW, ...Object.values(W0))
  const raftN = Math.max(0, Math.round(s.raftLayers ?? 0))
  const ef = raftN ? 0 : Math.max(0, s.elephantFoot ?? 0)
  const xyComp = s.xyComp ?? 0, holeComp = s.holeComp ?? 0
  const vase = Boolean(s.vase)

  // layer tops and the height each one cuts at
  const tops: number[] = [s.firstLayer]
  while (tops[tops.length - 1] < z1 - s.layer * 0.5 && tops.length < 20000) tops.push(Math.round((tops[tops.length - 1] + s.layer) * 1000) / 1000)
  const n = tops.length
  const cutAt = tops.map((t, i) => t - (i ? s.layer : s.firstLayer) / 2 + 1e-5)
  // which triangles each layer cuts
  const byLayer: number[][] = tops.map(() => [])
  for (let t = 0; t < nt; t++) {
    const o = t * 9
    const za = tris[o + 2], zb = tris[o + 5], zc = tris[o + 8]
    const lo = Math.min(za, zb, zc), hi = Math.max(za, zb, zc)
    if (hi - lo < 1e-9) continue
    let k = 0, top = n
    while (k < top) { const m = (k + top) >> 1; if (cutAt[m] <= lo) k = m + 1; else top = m }
    for (let i = k; i < n && cutAt[i] < hi; i++) byLayer[i].push(t)
  }
  const span = Math.max(x1 - x0, y1 - y0)
  const r = s.res ?? Math.max(lw / 5, span / 1600, 0.02)
  const pad = Math.ceil((maxW * 2 + Math.max(0, xyComp)) / r) + 3
  const brimOn = (s.brim ?? 'none') !== 'none' && (s.brimWidth ?? 0) > 0 && !raftN
  const outer = Math.ceil(((brimOn ? (s.brimGap ?? 0.1) + (s.brimWidth ?? 5) : 0) + (raftN ? (s.raftExpand ?? 1.5) : 0) + 1) / r)
  const P0 = pad + outer
  const G: Grid = { x0: x0 - P0 * r, y0: y0 - P0 * r, r, w: Math.ceil((x1 - x0) / r) + P0 * 2, h: Math.ceil((y1 - y0) / r) + P0 * 2 }
  const N = G.w * G.h
  const solidAll = s.infill >= 0.99
  const tl = solidAll ? 0 : Math.max(0, Math.round(vase ? 0 : (s.topLayers ?? s.solidLayers)))
  const bl = solidAll ? 0 : Math.max(0, Math.round(s.bottomLayers ?? s.solidLayers))
  const rnd = seeded(7)

  // supports, worked out from the top down on a coarse grid (supports.ts)
  let plan: ReturnType<typeof planSupports> | null = null
  if (s.support && s.support !== 'none') {
    const c = Math.max(0.5, span / 220)
    const SG: Grid = { x0: G.x0, y0: G.y0, r: c, w: Math.ceil((G.w * r) / c) + 1, h: Math.ceil((G.h * r) / c) + 1 }
    const coarse: Uint8Array[] = new Array(n)
    for (let i = 0; i < n; i++) {
      const m = new Uint8Array(SG.w * SG.h)
      fillShells([...cutLayer(tris, byLayer[i], shellOf, cutAt[i]).values()], SG, m)
      coarse[i] = m
    }
    plan = planSupports(coarse, SG, tops, s, tris)
    if (!plan.base.some(Boolean) && !plan.trees.some((t) => t.length)) plan = null
  }

  // each layer cut into islands, a few layers ahead
  const cutCache = new Map<number, Island[]>()
  const islandsOf = (i: number): Island[] => {
    if (i < 0 || i >= n) return []
    const have = cutCache.get(i)
    if (have) return have
    const segs = cutLayer(tris, byLayer[i], shellOf, cutAt[i])
    // the box of each shell, in big grid cells
    const boxes: { b: [number, number, number, number]; segs: number[][] }[] = []
    for (const sg of segs.values()) {
      let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity
      for (let k = 0; k < sg.length; k += 2) { a = Math.min(a, sg[k]); c = Math.max(c, sg[k]); b = Math.min(b, sg[k + 1]); d = Math.max(d, sg[k + 1]) }
      boxes.push({ b: [Math.floor((a - G.x0) / r) - pad, Math.floor((b - G.y0) / r) - pad, Math.ceil((c - G.x0) / r) + pad, Math.ceil((d - G.y0) / r) + pad], segs: [sg] })
    }
    // shells whose boxes touch become one island
    for (let merged = true; merged;) {
      merged = false
      for (let p = 0; p < boxes.length && !merged; p++) for (let q = p + 1; q < boxes.length; q++) {
        const A = boxes[p].b, B = boxes[q].b
        if (A[0] <= B[2] && B[0] <= A[2] && A[1] <= B[3] && B[1] <= A[3]) {
          boxes[p] = { b: [Math.min(A[0], B[0]), Math.min(A[1], B[1]), Math.max(A[2], B[2]), Math.max(A[3], B[3])], segs: [...boxes[p].segs, ...boxes[q].segs] }
          boxes.splice(q, 1)
          merged = true
          break
        }
      }
    }
    const out = boxes.map(({ b, segs: sg }) => {
      const ox = Math.max(0, b[0]), oy = Math.max(0, b[1])
      const w = Math.min(G.w, b[2]) - ox, h = Math.min(G.h, b[3]) - oy
      const g: Grid = { x0: G.x0 + ox * r, y0: G.y0 + oy * r, r, w, h }
      const inside = new Uint8Array(w * h)
      fillShells(sg, g, inside)
      if (xyComp) offsetMask(inside, w, h, xyComp / r)
      if (holeComp) offsetHoles(inside, w, h, holeComp / r)
      return { ox, oy, g, inside }
    })
    cutCache.set(i, out)
    return out
  }
  // layer j's part on the grid of an island
  const cover = (j: number, isl: Island): Uint8Array => {
    const m = new Uint8Array(isl.g.w * isl.g.h)
    for (const o of islandsOf(j)) {
      const xa = Math.max(isl.ox, o.ox), xb = Math.min(isl.ox + isl.g.w, o.ox + o.g.w)
      const ya = Math.max(isl.oy, o.oy), yb = Math.min(isl.oy + isl.g.h, o.oy + o.g.h)
      for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) if (o.inside[(y - o.oy) * o.g.w + (x - o.ox)]) m[(y - isl.oy) * isl.g.w + (x - isl.ox)] = 1
    }
    return m
  }
  // the whole layer on the big grid
  const whole = (j: number): Uint8Array => {
    const m = new Uint8Array(N)
    for (const o of islandsOf(j)) for (let y = 0; y < o.g.h; y++) {
      const row = (o.oy + y) * G.w + o.ox, lrow = y * o.g.w
      for (let x = 0; x < o.g.w; x++) if (o.inside[lrow + x]) m[row + x] = 1
    }
    return m
  }
  // how many layers around (bottom layers below to top layers above) are inside, for every cell of the big grid
  const count = tl + bl > 0 ? new Uint8Array(N) : null
  const addLayer = (i: number, sign: 1 | -1) => {
    if (!count || i < 0 || i >= n) return
    for (const isl of islandsOf(i)) for (let y = 0; y < isl.g.h; y++) {
      const row = (isl.oy + y) * G.w + isl.ox, lrow = y * isl.g.w
      for (let x = 0; x < isl.g.w; x++) if (isl.inside[lrow + x]) count[row + x] += sign
    }
  }
  for (let j = 0; j <= tl; j++) addLayer(j, 1)
  const full = tl + bl + 1

  // a raft under everything, and the part lifted onto it
  const raftLayers: Layer[] = []
  let lift = 0
  if (raftN) {
    const m0 = whole(0)
    if (plan) {
      // supports on the first layer go on the raft too
      const b = plan.base[0], SG = plan.g
      if (b) for (let y = 0; y < G.h; y++) for (let x = 0; x < G.w; x++) {
        const i = Math.floor((G.x0 + (x + 0.5) * r - SG.x0) / SG.r), j = Math.floor((G.y0 + (y + 0.5) * r - SG.y0) / SG.r)
        if (i >= 0 && j >= 0 && i < SG.w && j < SG.h && b[j * SG.w + i]) m0[y * G.w + x] = 1
      }
    }
    const out = new Uint8Array(N)
    for (let p = 0; p < N; p++) out[p] = m0[p] ? 0 : 1
    const ex = (s.raftExpand ?? 1.5) / r
    const d = edgeField(out, G.w, G.h, ex + 2)
    const raft = new Uint8Array(N)
    for (let p = 0; p < N; p++) raft[p] = m0[p] || d[p] <= ex ? 1 : 0
    const rf = edgeField(raft, G.w, G.h, (firstW * 2) / r)
    let z = 0
    for (let k = 0; k < raftN; k++) {
      const h = k ? s.layer : s.firstLayer
      z = Math.round((z + h) * 1000) / 1000
      const w = k ? lw : firstW
      const sp = w - h * (1 - Math.PI / 4)
      const paths: Path[] = []
      for (const loop of isoLoops(rf, G.w, G.h, (0.5 * w) / r)) {
        const pts: number[] = []
        for (let q = 0; q < loop.length; q += 2) pts.push(G.x0 + (loop[q] + 0.5) * r, G.y0 + (loop[q + 1] + 0.5) * r)
        if (pts.length >= 6) paths.push({ kind: 'raft', pts: simplifyLoop(pts, Math.min(0.03, r * 0.4)), closed: true, ...(w !== lw ? { w } : {}) })
      }
      const fill = new Uint8Array(N)
      for (let p = 0; p < N; p++) if (rf[p] >= (w + 0.5 * sp) / r) fill[p] = 1
      const topOne = k === raftN - 1
      paths.push(...hatch(fill, G, topOne ? Math.PI / 4 : (k % 2 ? Math.PI / 2 : 0), topOne ? sp : w * 2.5, w, 'raft', [x0, y0], w !== lw ? { w } : {}))
      raftLayers.push({ z, h, paths, raft: true })
    }
    lift = z + Math.max(0, s.raftGap ?? 0.15)
  }

  const layers: Layer[] = []
  let nozzle: [number, number] = [x0, y0]
  const reuse = new Map<number, { islands: Island[]; paths: Path[] }>()
  const same = (a: Island[], b: Island[]) => a.length === b.length && a.every((x, k) => {
    const y = b[k]
    if (x.ox !== y.ox || x.oy !== y.oy || x.g.w !== y.g.w || x.g.h !== y.g.h) return false
    for (let p = 0; p < x.inside.length; p++) if (x.inside[p] !== y.inside[p]) return false
    return true
  })
  const skirtH = s.skirt ? Math.max(1, Math.round(s.skirtHeight ?? 1)) : 0
  const canReuse = !plan && (s.ironing ?? 'none') === 'none' && !vase
  let skirtBase: number[] | null = null
  let prevSeams: number[] = []
  const pattern = s.infillPattern ?? 'rectilinear'
  const baseAngle = ((s.infillAngle ?? 45) * Math.PI) / 180
  const overlap = s.infillOverlap ?? 0.15

  for (let i = 0; i < n; i++) {
    if (i > 0) { addLayer(i + tl, 1); addLayer(i - bl - 1, -1) }
    for (const k of cutCache.keys()) if (k < i - bl - 1) cutCache.delete(k)
    const islands = islandsOf(i)
    const h = i ? s.layer : s.firstLayer
    const z = Math.round((tops[i] + lift) * 1000) / 1000
    const first = i === 0 && !raftN
    const Wd = first ? { outer: firstW, inner: firstW, infill: firstW, solid: firstW, top: firstW, support: firstW } : W0
    const spw = (w: number) => w - h * (1 - Math.PI / 4)
    const solidLayer = solidAll || i < bl || i >= n - tl
    const vaseHere = vase && i >= bl
    // A solid layer just like the ones under and over it (a flat plate) is cut the same way.
    if (canReuse && i > 0 && i < n - 1 && i >= skirtH && solidLayer) {
      const c = reuse.get(i % 2)
      if (c && same(c.islands, islands) && same(islandsOf(i + 1), islands) && same(islandsOf(i - 1), islands)) { layers.push({ z, h, paths: c.paths }); progress?.((i + 1) / n); continue }
    }
    const paths: Path[] = []
    const W = (p: Path, w: number) => { if (Math.abs(w - lw) > 1e-6) p.w = w; return p }

    // the first layer: skirt and brim
    if (i === 0 || (skirtBase && i < skirtH)) {
      if (i === 0 && s.skirt) {
        const pts: number[] = []
        for (const isl of islands) {
          const f = edgeField(isl.inside, isl.g.w, isl.g.h, 2)
          for (const l of isoLoops(f, isl.g.w, isl.g.h, 0)) for (let q = 0; q < l.length; q += 2) pts.push(isl.g.x0 + (l[q] + 0.5) * r, isl.g.y0 + (l[q + 1] + 0.5) * r)
        }
        if (pts.length >= 6) skirtBase = hull(pts)
      }
      if (skirtBase && i < skirtH) {
        const extra = (raftN ? (s.raftExpand ?? 1.5) : 0) + (brimOn ? (s.brimGap ?? 0.1) + (s.brimWidth ?? 5) : 0)
        const loops = Math.max(1, Math.round(s.skirtLoops ?? 1))
        for (let k = loops - 1; k >= 0; k--) {
          const d = (s.skirtDistance ?? 3) + extra + Wd.outer / 2 + k * spw(Wd.outer)
          const ring: number[] = []
          for (let q = 0; q < skirtBase.length; q += 2) for (let a = 0; a < 24; a++) ring.push(skirtBase[q] + Math.cos((a / 24) * Math.PI * 2) * d, skirtBase[q + 1] + Math.sin((a / 24) * Math.PI * 2) * d)
          const p = W({ kind: 'skirt', pts: startNear(hull(ring), ...nozzle), closed: true }, Wd.outer)
          paths.push(p)
          nozzle = [p.pts[0], p.pts[1]]
        }
      }
      if (i === 0 && brimOn) {
        const m = whole(0)
        const dom = s.brim === 'outer' ? outsideOf(m, G.w, G.h) : m.map((v) => (v ? 0 : 1))
        const gap = s.brimGap ?? 0.1, bw = s.brimWidth ?? 5
        const f = edgeField(dom, G.w, G.h, (gap + bw) / r + 2)
        const sp = spw(firstW)
        const loops = Math.max(1, Math.floor(bw / sp))
        for (let k = loops - 1; k >= 0; k--) {
          for (const l of isoLoops(f, G.w, G.h, (gap + firstW / 2 + k * sp) / r)) {
            const pts: number[] = []
            for (let q = 0; q < l.length; q += 2) pts.push(G.x0 + (l[q] + 0.5) * r, G.y0 + (l[q + 1] + 0.5) * r)
            if (pts.length < 6) continue
            const p = W({ kind: 'brim', pts: startNear(simplifyLoop(pts, Math.min(0.03, r * 0.4)), ...nozzle), closed: true }, firstW)
            paths.push(p)
            nozzle = [p.pts[0], p.pts[1]]
          }
        }
      }
    }

    // walls and fill, one island at a time, nearest first
    const P = vaseHere ? 1 : Math.max(0, Math.round(s.perimeters))
    const centers: number[] = []
    let cpos = Wd.outer / 2 + (first ? ef : 0)
    for (let k = 0; k < P; k++) { centers.push(cpos); cpos += (spw(k === 0 ? Wd.outer : Wd.inner) + spw(Wd.inner)) / 2 }
    const wLast = P ? (P === 1 ? Wd.outer : Wd.inner) : 0
    const fillW = solidLayer ? Wd.solid : Wd.infill
    const thrMm = P ? centers[P - 1] + 0.5 * wLast + 0.5 * spw(fillW) - overlap * wLast : 0.5 * spw(fillW) + (first ? ef : 0)
    const wantFar = pattern === 'concentric' || s.topPattern === 'concentric' || s.bottomPattern === 'concentric'
    const curSeams: number[] = []
    const seamOf = (pts: number[]): number[] => {
      const mode = s.seam ?? 'nearest'
      if (mode === 'random') { const k = Math.floor(rnd() * (pts.length / 2)) * 2; return k ? [...pts.slice(k), ...pts.slice(0, k)] : pts }
      if (mode === 'nearest') return startNear(pts, ...nozzle)
      let cx = 0; for (let q = 0; q < pts.length; q += 2) cx += pts[q]; cx /= pts.length / 2
      let cy = 0; for (let q = 1; q < pts.length; q += 2) cy += pts[q]; cy /= pts.length / 2
      if (mode === 'aligned' && prevSeams.length) {
        let bx = 0, by = 0, bd = Infinity
        for (let q = 0; q < prevSeams.length; q += 2) { const d = (prevSeams[q] - cx) ** 2 + (prevSeams[q + 1] - cy) ** 2; if (d < bd) { bd = d; bx = prevSeams[q]; by = prevSeams[q + 1] } }
        return startNear(pts, bx, by)
      }
      return startNear(pts, cx, cy + 1e6)      // the back of the bed
    }
    const order = islands.map((isl, k) => ({ isl, k, cx: isl.g.x0 + (isl.g.w * r) / 2, cy: isl.g.y0 + (isl.g.h * r) / 2 }))
    const todo = [...order]
    while (todo.length) {
      let bi = 0, bd = Infinity
      todo.forEach((o, k) => { const d = (o.cx - nozzle[0]) ** 2 + (o.cy - nozzle[1]) ** 2; if (d < bd) { bd = d; bi = k } })
      const { isl } = todo.splice(bi, 1)[0]
      const { g, inside } = isl
      const field = edgeField(inside, g.w, g.h, wantFar ? 1e9 : (cpos + maxW * 2) / r)
      const toMm = (loop: number[]) => { const out: number[] = []; for (let k = 0; k < loop.length; k += 2) out.push(g.x0 + (loop[k] + 0.5) * r, g.y0 + (loop[k + 1] + 0.5) * r); return simplifyLoop(out, Math.min(0.03, r * 0.4)) }
      // walls
      const walls: Path[][] = []
      for (let k = 0; k < P; k++) {
        let loops = isoLoops(field, g.w, g.h, centers[k] / r).map(toMm).filter((l) => l.length >= 6)
        if (vaseHere) loops = loops.length ? [loops.reduce((a, b) => (lineLen(a) >= lineLen(b) ? a : b))] : []
        const fz = !first && !vaseHere && (s.fuzzy === 'all' || (s.fuzzy === 'outer' && k === 0))
        walls.push(loops.map((pts): Path => W({ kind: k === 0 ? 'outer' : 'inner', pts: fz ? fuzz(pts, s.fuzzyThick ?? 0.3, Math.max(0.1, s.fuzzyDist ?? 0.8), rnd) : pts, closed: true }, k === 0 ? Wd.outer : Wd.inner)))
      }
      const seq = (s.wallOrder ?? 'inner-outer') === 'outer-inner' ? walls : [...walls].reverse()
      for (const ring of seq) for (const w of ring) {
        w.pts = seamOf(w.pts)
        if (w.kind === 'outer') curSeams.push(w.pts[0], w.pts[1])
        paths.push(w)
        nozzle = [w.pts[0], w.pts[1]]
      }
      if (vaseHere) continue
      // fill
      const fill = new Uint8Array(field.length)
      let any = false
      for (let p = 0; p < field.length; p++) if (field[p] >= thrMm / r) { fill[p] = 1; any = true }
      if (!any) continue
      const ang = (i % 2 ? -1 : 1) * baseAngle
      const last = () => (paths.length ? (() => { const p = paths[paths.length - 1]; return [p.pts[p.pts.length - 2], p.pts[p.pts.length - 1]] as [number, number] })() : nozzle)
      const loopsIn = (m: Uint8Array, startMm: number, spacing: number, kind: PathKind, w: number) => {
        const out: Path[] = []
        for (let k = 0; k < 2000; k++) {
          const loops = isoLoops(field, g.w, g.h, (startMm + k * spacing) / r)
          if (!loops.length) break
          for (const l of loops) {
            const mm = toMm(l)
            for (const run of clipToMask(mm, true, m, g)) if (lineLen(run) > w) out.push(W({ kind, pts: run, closed: run === mm }, w))
          }
        }
        return out
      }
      const solidFill = (m: Uint8Array, pat: string, kind: PathKind, w: number) => {
        if (pat === 'concentric') return loopsIn(m, thrMm - 0.5 * spw(fillW) + 0.5 * spw(w), spw(w), kind, w)
        return hatch(m, g, ang, spw(w), w * 0.6, kind, last(), { oneWay: pat === 'monotonic', w: Math.abs(w - lw) > 1e-6 ? w : undefined })
      }
      // which cells are solid, and which of those face up or down
      let solid: Uint8Array, sparse: Uint8Array | null = null
      if (solidLayer) solid = fill
      else {
        solid = new Uint8Array(fill.length); sparse = new Uint8Array(fill.length)
        for (let y = 0; y < g.h; y++) {
          const row = (isl.oy + y) * G.w + isl.ox, lrow = y * g.w
          for (let x = 0; x < g.w; x++) {
            const p = lrow + x
            if (!fill[p]) continue
            if (count![row + x] >= full) sparse[p] = 1; else solid[p] = 1
          }
        }
      }
      if (solid.some((v) => v)) {
        const above = i < n - 1 ? cover(i + 1, isl) : new Uint8Array(fill.length)
        const below = i > 0 ? cover(i - 1, isl) : new Uint8Array(fill.length)
        const topM = new Uint8Array(fill.length), botM = new Uint8Array(fill.length), midM = new Uint8Array(fill.length)
        let aT = false, aB = false, aM = false
        for (let p = 0; p < fill.length; p++) {
          if (!solid[p]) continue
          if (!above[p]) { topM[p] = 1; aT = true } else if (!below[p]) { botM[p] = 1; aB = true } else { midM[p] = 1; aM = true }
        }
        if (aB) paths.push(...solidFill(botM, s.bottomPattern ?? 'lines', 'solid', Wd.solid))
        if (aM) paths.push(...solidFill(midM, 'lines', 'solid', Wd.solid))
        if (aT) {
          paths.push(...solidFill(topM, s.topPattern ?? 'lines', 'top', Wd.top))
          const iron = s.ironing ?? 'none'
          if (iron === 'top' || (iron === 'topmost' && i === n - 1)) {
            const im = new Uint8Array(fill.length)
            const lim = (thrMm + 0.5 * Wd.top) / r
            let ai = false
            for (let p = 0; p < fill.length; p++) if (topM[p] && field[p] >= lim) { im[p] = 1; ai = true }
            if (ai) paths.push(...hatch(im, g, ang + Math.PI / 2, Math.max(0.03, s.ironSpacing ?? 0.1), Wd.top, 'ironing', last(), { flow: s.ironFlow ?? 0.1 }))
          }
        }
      }
      if (sparse && s.infill > 0.01 && sparse.some((v) => v)) {
        const d = Math.max(0.02, s.infill), w = Wd.infill
        const base = w / d
        const ww = Math.abs(w - lw) > 1e-6 ? w : undefined
        const H = (a: number, sp: number, off = 0) => hatch(sparse!, g, a, sp, w, 'infill', last(), { offset: off, w: ww })
        switch (pattern) {
          case 'aligned': paths.push(...H(baseAngle, base)); break
          case 'grid': paths.push(...H(baseAngle, base * 2), ...H(baseAngle + Math.PI / 2, base * 2)); break
          case 'triangles': for (let k = 0; k < 3; k++) paths.push(...H(baseAngle + (k * Math.PI) / 3, base * 3)); break
          case 'cubic': {
            const zz = tops[i] - h / 2
            for (let k = 0; k < 3; k++) paths.push(...H(baseAngle + (k * Math.PI) / 3, base * 3, (k % 2 ? -1 : 1) * zz * Math.SQRT2))
            break
          }
          case 'gyroid': {
            const L = (3.09 * w) / d, kk = (Math.PI * 2) / L, zz = (tops[i] - h / 2) * kk
            const f = new Float32Array(g.w * g.h)
            const sx = new Float32Array(g.w), cxs = new Float32Array(g.w)
            for (let x = 0; x < g.w; x++) { const X = (g.x0 + (x + 0.5) * r) * kk; sx[x] = Math.sin(X); cxs[x] = Math.cos(X) }
            const cz = Math.cos(zz), sz = Math.sin(zz)
            for (let y = 0; y < g.h; y++) {
              const Y = (g.y0 + (y + 0.5) * r) * kk, sy = Math.sin(Y), cy = Math.cos(Y)
              for (let x = 0; x < g.w; x++) f[y * g.w + x] = sx[x] * cy + sy * cz + sz * cxs[x]
            }
            for (const l of isoLoops(f, g.w, g.h, 0)) {
              const mm: number[] = []
              for (let q = 0; q < l.length; q += 2) mm.push(g.x0 + (l[q] + 0.5) * r, g.y0 + (l[q + 1] + 0.5) * r)
              for (const run of clipToMask(mm, false, sparse, g)) { const pts = simplifyLine(run, Math.min(0.03, r * 0.4)); if (lineLen(pts) > w) paths.push(W({ kind: 'infill', pts, closed: false }, w)) }
            }
            break
          }
          case 'concentric': paths.push(...loopsIn(sparse, thrMm + base / 2, base, 'infill', w)); break
          default: paths.push(...H(ang, base))
        }
      }
      nozzle = last()
    }
    if (s.seam === 'aligned') prevSeams = curSeams.length ? curSeams : prevSeams

    // supports
    if (plan) {
      const SG = plan.g, base = plan.base[i], ifc = plan.iface[i]
      const ws = Wd.support
      const wsOpt = Math.abs(ws - lw) > 1e-6 ? ws : undefined
      if (base) {
        const only = ifc ? base.map((v, p) => (v && !ifc[p] ? 1 : 0)) : base
        const sp = Math.max(0.8, s.supportSpacing ?? 2.5)
        // a wall around each piece of support, so tall thin ones do not fall over
        const nw = Math.max(0, Math.round(s.supportWalls ?? 1))
        if (nw > 0) {
          const f = edgeField(base, SG.w, SG.h, nw + 2)
          for (let k = 0; k < nw; k++) for (const l of isoLoops(f, SG.w, SG.h, 0.35 + k * Math.max(0.5, spw(ws) / SG.r))) {
            const pts: number[] = []
            for (let q = 0; q < l.length; q += 2) pts.push(SG.x0 + (l[q] + 0.5) * SG.r, SG.y0 + (l[q + 1] + 0.5) * SG.r)
            if (pts.length >= 6) paths.push(W({ kind: 'support', pts: startNear(simplifyLoop(pts, SG.r * 0.3), ...nozzle), closed: true }, ws))
          }
        }
        if (i === 0) paths.push(...hatch(only, SG, Math.PI / 4, sp * 0.6, ws * 2, 'support', nozzle, { w: wsOpt }))
        else {
          paths.push(...hatch(only, SG, 0, sp, ws * 2, 'support', nozzle, { w: wsOpt }))
          if (s.supportPattern === 'grid') paths.push(...hatch(only, SG, Math.PI / 2, sp, ws * 2, 'support', nozzle, { w: wsOpt }))
        }
      }
      if (ifc) paths.push(...hatch(ifc, SG, i % 2 ? 0 : Math.PI / 2, Math.max(spw(ws), s.interfaceSpacing ?? 0.5), ws, 'interface', nozzle, { w: wsOpt }))
      for (const [tx, ty, R] of plan.trees[i]) {
        const ring = (rad: number): Path => {
          const segs = Math.max(8, Math.min(64, Math.round((Math.PI * 2 * rad) / 0.6)))
          const pts: number[] = []
          for (let a = 0; a < segs; a++) pts.push(tx + Math.cos((a / segs) * Math.PI * 2) * rad, ty + Math.sin((a / segs) * Math.PI * 2) * rad)
          return W({ kind: 'support', pts: startNear(pts, ...nozzle), closed: true }, ws)
        }
        const r0 = Math.max(ws * 0.5, R - ws / 2)
        paths.push(ring(r0))
        const step = i === 0 ? spw(ws) : ws * 2
        for (let rr = r0 - step; rr > ws * 0.5; rr -= step) paths.push(ring(rr))
        const lp = paths[paths.length - 1]
        nozzle = [lp.pts[0], lp.pts[1]]
      }
    }
    const L: Layer = { z, h, paths }
    if (vaseHere) L.vase = true
    layers.push(L)
    if (canReuse && i > 0 && i < n - 1 && solidLayer && same(islandsOf(i + 1), islands) && same(islandsOf(i - 1), islands)) reuse.set(i % 2, { islands, paths })
    progress?.((i + 1) / n)
  }
  return raftLayers.length ? [...raftLayers, ...layers] : layers
}
