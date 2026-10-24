import { useSyncExternalStore } from 'react'

// Look-up tables (.cube files) and curves for the color effects.
// LUTs are kept in this browser profile and inside project files, so a scene
// that uses one keeps working when you open it on another computer.

export interface Lut {
  id: string
  name: string
  size: number          // points per side, 2 to 65
  data: string          // base64 of size^3 RGB bytes, red changing fastest
}

const KEY = 'rico.luts'
let luts: Lut[] = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
})()
let version = 0
const listeners = new Set<() => void>()
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(luts))
  } catch {
    /* too big to remember, still works this session */
  }
  version++
  listeners.forEach((l) => l())
}

export function useLuts(): Lut[] {
  useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => version)
  return luts
}
export const getLuts = () => luts
export const getLut = (id: string) => luts.find((l) => l.id === id)
export const lutVersion = () => version

export function putLut(l: Lut) {
  luts = luts.some((x) => x.id === l.id) ? luts.map((x) => (x.id === l.id ? l : x)) : [...luts, l]
  save()
}
export function removeLut(id: string) {
  luts = luts.filter((l) => l.id !== id)
  save()
}
export function importLuts(list: Lut[]) {
  for (const l of list) if (l?.id && l.size && l.data && !getLut(l.id)) luts = [...luts, l]
  save()
}

const b64 = (bytes: Uint8Array) => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
export const lutBytes = (l: Lut) => Uint8Array.from(atob(l.data), (c) => c.charCodeAt(0))
const rid = () => Math.random().toString(36).slice(2, 9)

// ---- .cube files ----

export function parseCube(text: string, name: string): Lut {
  let size = 0
  const vals: number[] = []
  let dmin = [0, 0, 0], dmax = [1, 1, 1]
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const parts = line.split(/\s+/)
    const k = parts[0].toUpperCase()
    if (k === 'LUT_3D_SIZE') size = Number(parts[1])
    else if (k === 'DOMAIN_MIN') dmin = parts.slice(1, 4).map(Number)
    else if (k === 'DOMAIN_MAX') dmax = parts.slice(1, 4).map(Number)
    else if (k === 'LUT_1D_SIZE') throw new Error('This is a 1D LUT. RICO uses 3D .cube LUTs.')
    else if (/^[-\d.]/.test(parts[0]) && parts.length >= 3) vals.push(Number(parts[0]), Number(parts[1]), Number(parts[2]))
  }
  if (size < 2 || vals.length < size ** 3 * 3) throw new Error('This .cube file is missing its table.')
  // Big LUTs are brought down to 33 points, plenty for real-time use.
  const out = size > 33 ? 33 : size
  const bytes = new Uint8Array(out ** 3 * 3)
  const at = (r: number, g: number, b: number, c: number) => vals[(r + g * size + b * size * size) * 3 + c]
  for (let b = 0; b < out; b++) for (let g = 0; g < out; g++) for (let r = 0; r < out; r++) {
    const src = [r, g, b].map((v) => (v * (size - 1)) / (out - 1))
    for (let c = 0; c < 3; c++) {
      // Trilinear pick from the original table.
      const [x, y, z] = src
      const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z)
      const x1 = Math.min(size - 1, x0 + 1), y1 = Math.min(size - 1, y0 + 1), z1 = Math.min(size - 1, z0 + 1)
      const fx = x - x0, fy = y - y0, fz = z - z0
      const l = (a: number, bb: number, t: number) => a + (bb - a) * t
      const v = l(
        l(l(at(x0, y0, z0, c), at(x1, y0, z0, c), fx), l(at(x0, y1, z0, c), at(x1, y1, z0, c), fx), fy),
        l(l(at(x0, y0, z1, c), at(x1, y0, z1, c), fx), l(at(x0, y1, z1, c), at(x1, y1, z1, c), fx), fy), fz)
      const norm = (v - dmin[c]) / ((dmax[c] - dmin[c]) || 1)
      bytes[(r + g * out + b * out * out) * 3 + c] = Math.round(Math.max(0, Math.min(1, norm)) * 255)
    }
  }
  return { id: rid(), name, size: out, data: b64(bytes) }
}

export function cubeText(l: Lut): string {
  const bytes = lutBytes(l)
  const lines = [`TITLE "${l.name.replace(/"/g, '')}"`, '# Made with RICO', `LUT_3D_SIZE ${l.size}`, 'DOMAIN_MIN 0.0 0.0 0.0', 'DOMAIN_MAX 1.0 1.0 1.0']
  for (let i = 0; i < l.size ** 3; i++) lines.push(`${(bytes[i * 3] / 255).toFixed(6)} ${(bytes[i * 3 + 1] / 255).toFixed(6)} ${(bytes[i * 3 + 2] / 255).toFixed(6)}`)
  return lines.join('\n') + '\n'
}

export function makeLut(name: string, size: number, fn: (r: number, g: number, b: number) => [number, number, number]): Lut {
  const bytes = new Uint8Array(size ** 3 * 3)
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
    const c = fn(r / (size - 1), g / (size - 1), b / (size - 1))
    const i = (r + g * size + b * size * size) * 3
    for (let k = 0; k < 3; k++) bytes[i + k] = Math.round(Math.max(0, Math.min(1, c[k])) * 255)
  }
  return { id: rid(), name, size, data: b64(bytes) }
}

// ---- matching a look from one frame ----
// Works in Lab: brightness is matched by its histogram, color by the mean and
// spread of a and b. The result is baked into a 33 point LUT.

const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)
const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116)
const fi = (t: number) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27))

export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const R = toLin(r), G = toLin(g), B = toLin(b)
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883
  const fx = f(X), fy = f(Y), fz = f(Z)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

export function labToRgb(L: number, a: number, bb: number): [number, number, number] {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - bb / 200
  const X = fi(fx) * 0.95047, Y = fi(fy), Z = fi(fz) * 1.08883
  const R = 3.2406 * X - 1.5372 * Y - 0.4986 * Z
  const G = -0.9689 * X + 1.8758 * Y + 0.0415 * Z
  const B = 0.0557 * X - 0.204 * Y + 1.057 * Z
  return [toSrgb(Math.max(0, R)), toSrgb(Math.max(0, G)), toSrgb(Math.max(0, B))]
}

interface Stats { cdf: Float64Array; ma: number; sa: number; mb: number; sb: number }

function stats(px: Uint8ClampedArray | Uint8Array): Stats {
  const hist = new Float64Array(101)
  let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 16) continue
    const [L, a, b] = rgbToLab(px[i] / 255, px[i + 1] / 255, px[i + 2] / 255)
    hist[Math.max(0, Math.min(100, Math.round(L)))]++
    sa += a; sb += b; saa += a * a; sbb += b * b
    n++
  }
  n = Math.max(1, n)
  // A little of every brightness, so the curve stays smooth where the frame has none.
  const prior = n * 0.003
  const total = n + prior * 101
  const cdf = new Float64Array(101)
  let acc = 0
  for (let i = 0; i <= 100; i++) { acc += hist[i] + prior; cdf[i] = acc / total }
  const ma = sa / n, mb = sb / n
  return { cdf, ma, sa: Math.sqrt(Math.max(1e-6, saa / n - ma * ma)), mb, sb: Math.sqrt(Math.max(1e-6, sbb / n - mb * mb)) }
}

// "source" is your frame, "reference" the look you want.
export function matchLut(source: Uint8ClampedArray | Uint8Array, reference: Uint8ClampedArray | Uint8Array, name: string, colorAmount = 1, lightAmount = 1): Lut {
  const s = stats(source), r = stats(reference)
  // Brightness: for each L of the source, the L in the reference with the same rank.
  const map = new Float64Array(101)
  for (let i = 0; i <= 100; i++) {
    const q = s.cdf[i]
    let j = 0
    while (j < 100 && r.cdf[j] < q) j++
    const lo = j > 0 ? r.cdf[j - 1] : 0
    map[i] = j > 0 ? j - 1 + (q - lo) / Math.max(1e-9, r.cdf[j] - lo) : j
  }
  // Smooth the map so the result has no banding.
  const sm = new Float64Array(101)
  for (let i = 0; i <= 100; i++) {
    let acc = 0, w = 0
    for (let k = -3; k <= 3; k++) { const j = Math.max(0, Math.min(100, i + k)); const ww = 1 / (1 + Math.abs(k)); acc += map[j] * ww; w += ww }
    sm[i] = acc / w
  }
  return makeLut(name, 33, (R, G, B) => {
    const [L, a, b] = rgbToLab(R, G, B)
    const li = Math.max(0, Math.min(100, L))
    const i0 = Math.floor(li), i1 = Math.min(100, i0 + 1)
    const L2 = sm[i0] + (sm[i1] - sm[i0]) * (li - i0)
    const a2 = (a - s.ma) / s.sa * r.sa + r.ma
    const b2 = (b - s.mb) / s.sb * r.sb + r.mb
    return labToRgb(L + (L2 - L) * lightAmount, a + (a2 - a) * colorAmount, b + (b2 - b) * colorAmount)
  })
}

// ---- curves ----
// Stored as text: "m:0,0 1,1|r:0,0 1,1|g:0,0 1,1|b:0,0 1,1".

export type CurvePoints = [number, number][]
export interface Curves { m: CurvePoints; r: CurvePoints; g: CurvePoints; b: CurvePoints }
const LINE: CurvePoints = [[0, 0], [1, 1]]

export function parseCurves(text: string): Curves {
  const out: Curves = { m: LINE, r: LINE, g: LINE, b: LINE }
  for (const part of (text || '').split('|')) {
    const [k, pts] = part.split(':')
    if (!pts || !['m', 'r', 'g', 'b'].includes(k)) continue
    const list = pts.trim().split(/\s+/).map((p) => p.split(',').map(Number) as [number, number]).filter((p) => p.length === 2 && p.every(Number.isFinite))
    if (list.length >= 2) out[k as keyof Curves] = list.sort((a, b) => a[0] - b[0])
  }
  return out
}
export const curvesText = (c: Curves) => (['m', 'r', 'g', 'b'] as const).map((k) => `${k}:${c[k].map((p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`).join(' ')}`).join('|')

// Smooth curve through the points that never overshoots (monotone cubic).
export function curveAt(pts: CurvePoints, x: number): number {
  const n = pts.length
  if (x <= pts[0][0]) return pts[0][1]
  if (x >= pts[n - 1][0]) return pts[n - 1][1]
  const d: number[] = [], m: number[] = []
  for (let i = 0; i < n - 1; i++) d.push((pts[i + 1][1] - pts[i][1]) / Math.max(1e-6, pts[i + 1][0] - pts[i][0]))
  m.push(d[0])
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2)
  m.push(d[n - 2])
  let i = 0
  while (i < n - 2 && x > pts[i + 1][0]) i++
  const h = pts[i + 1][0] - pts[i][0], t = (x - pts[i][0]) / h
  const t2 = t * t, t3 = t2 * t
  return (2 * t3 - 3 * t2 + 1) * pts[i][1] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * pts[i + 1][1] + (t3 - t2) * h * m[i + 1]
}

// 256 RGBA bytes: each channel's own curve after the master curve.
export function bakeCurves(text: string): Uint8Array {
  const c = parseCurves(text)
  const out = new Uint8Array(256 * 4)
  for (let i = 0; i < 256; i++) {
    const m = Math.max(0, Math.min(1, curveAt(c.m, i / 255)))
    out[i * 4] = Math.round(Math.max(0, Math.min(1, curveAt(c.r, m))) * 255)
    out[i * 4 + 1] = Math.round(Math.max(0, Math.min(1, curveAt(c.g, m))) * 255)
    out[i * 4 + 2] = Math.round(Math.max(0, Math.min(1, curveAt(c.b, m))) * 255)
    out[i * 4 + 3] = 255
  }
  return out
}
