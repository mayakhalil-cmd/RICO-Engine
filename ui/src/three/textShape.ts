import * as THREE from 'three'
import { fontFile } from '../shell/fonts'

// 3D text in any font (yours too), and a hollow comic book page: a frame
// with panel windows you can put 3D things inside.

export interface Text3D { text: string; font: string; size: number; depth: number; bevel: number; curve: number; spacing: number; align: 'left' | 'center' | 'right' }
export const TEXT_DEFAULT: Text3D = { text: 'RICO', font: 'Teletactile', size: 0.6, depth: 0.15, bevel: 0.01, curve: 8, spacing: 0, align: 'center' }

export interface Comic { width: number; height: number; rows: number; cols: number; gutter: number; border: number; depth: number; tilt: number; seed: number; back: boolean }
export const COMIC_DEFAULT: Comic = { width: 2.4, height: 3.2, rows: 3, cols: 2, gutter: 0.08, border: 0.12, depth: 0.25, tilt: 0.35, seed: 3, back: false }

type Font = import('three/addons/loaders/FontLoader.js').Font
const fonts = new Map<string, Promise<Font | null>>()
function fontOf(name: string): Promise<Font | null> {
  let hit = fonts.get(name)
  if (!hit) {
    hit = (async () => {
      const buf = await fontFile(name)
      if (!buf) return null
      const { TTFLoader } = await import('three/addons/loaders/TTFLoader.js')
      const { FontLoader } = await import('three/addons/loaders/FontLoader.js')
      try { return new FontLoader().parse(new TTFLoader().parse(buf)) } catch { return null }
    })()
    fonts.set(name, hit)
  }
  return hit
}
export const forgetFont = (name: string) => fonts.delete(name)

export async function textGeometry(t: Text3D): Promise<THREE.BufferGeometry | string> {
  const font = await fontOf(t.font)
  if (!font) return `The font "${t.font}" could not be read for 3D. Try a TTF or OTF file.`
  const { TextGeometry } = await import('three/addons/geometries/TextGeometry.js')
  const lines = (t.text || ' ').split('\n')
  const parts: THREE.BufferGeometry[] = []
  const lineH = t.size * 1.25
  lines.forEach((line, i) => {
    // letter spacing: each letter on its own, moved along
    const g = new THREE.BufferGeometry()
    const letters: THREE.BufferGeometry[] = []
    let x = 0
    for (const ch of [...line]) {
      if (ch === ' ') { x += t.size * 0.35 + t.spacing; continue }
      const lg = new TextGeometry(ch, { font, size: t.size, depth: t.depth, curveSegments: Math.max(1, Math.round(t.curve)), bevelEnabled: t.bevel > 0, bevelThickness: t.bevel, bevelSize: t.bevel * 0.8, bevelSegments: 3 })
      lg.computeBoundingBox()
      const w = lg.boundingBox ? lg.boundingBox.max.x - Math.min(0, lg.boundingBox.min.x) : t.size * 0.6
      lg.translate(x, -i * lineH, 0)
      letters.push(lg.index ? lg.toNonIndexed() : lg)
      x += w + t.size * 0.06 + t.spacing
    }
    if (!letters.length) return
    const merged = mergeAll(letters)
    merged.computeBoundingBox()
    const bb = merged.boundingBox!
    const width = bb.max.x - bb.min.x
    merged.translate(t.align === 'center' ? -width / 2 - bb.min.x : t.align === 'right' ? -width - bb.min.x : -bb.min.x, 0, 0)
    parts.push(merged)
    g.dispose()
  })
  if (!parts.length) return new THREE.BufferGeometry()
  const all = mergeAll(parts)
  all.computeBoundingBox()
  const bb = all.boundingBox!
  all.translate(0, -(bb.min.y + bb.max.y) / 2, -t.depth / 2)
  all.computeVertexNormals()
  return all
}

function mergeAll(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let n = 0
  for (const g of list) n += g.getAttribute('position').count
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2)
  let k = 0
  for (const g of list) {
    const p = g.getAttribute('position'), q = g.getAttribute('normal'), u = g.getAttribute('uv')
    pos.set(p.array as Float32Array, k * 3)
    if (q) nrm.set(q.array as Float32Array, k * 3)
    if (u) uv.set(u.array as Float32Array, k * 2)
    k += p.count
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3))
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  return out
}

// The comic page: an outer frame, panels cut out of it (with tilted gutters
// for some energy), as deep as you like, and an optional back.
export function comicGeometry(c: Comic): THREE.BufferGeometry {
  const W = c.width, H = c.height
  const x0 = -W / 2, y0 = -H / 2
  const shape = new THREE.Shape()
  shape.moveTo(x0, y0); shape.lineTo(x0 + W, y0); shape.lineTo(x0 + W, y0 + H); shape.lineTo(x0, y0 + H); shape.closePath()
  let seed = Math.max(1, Math.round(c.seed)) * 9301
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5 }
  const iw = W - c.border * 2, ih = H - c.border * 2
  const rows = Math.max(1, Math.round(c.rows)), cols = Math.max(1, Math.round(c.cols))
  // row lines (tilted) and, inside each row, column lines (tilted)
  const rowY: [number, number][] = [[0, 0]]
  for (let r = 1; r < rows; r++) { const base = (r / rows) * ih; const d = rnd() * c.tilt * ih / rows; rowY.push([base + d, base - d]) }
  rowY.push([ih, ih])
  const g = c.gutter / 2
  for (let r = 0; r < rows; r++) {
    const ncol = r % 2 === 1 && cols > 1 ? cols - 1 : cols
    const colX: [number, number][] = [[0, 0]]
    for (let k = 1; k < ncol; k++) { const base = (k / ncol) * iw; const d = rnd() * c.tilt * iw / ncol * 0.6; colX.push([base + d, base - d]) }
    colX.push([iw, iw])
    for (let k = 0; k < ncol; k++) {
      // the four corners: bottom left, bottom right, top right, top left (y up, rows from the top)
      const top = (xFrac: number) => ih - (rowY[r][0] + (rowY[r][1] - rowY[r][0]) * xFrac) - g
      const bot = (xFrac: number) => ih - (rowY[r + 1][0] + (rowY[r + 1][1] - rowY[r + 1][0]) * xFrac) + g
      const xl = (yFrac: number) => colX[k][0] + (colX[k][1] - colX[k][0]) * yFrac + g
      const xr = (yFrac: number) => colX[k + 1][0] + (colX[k + 1][1] - colX[k + 1][0]) * yFrac - g
      const pts: [number, number][] = [[xl(1), bot(xl(1) / iw)], [xr(1), bot(xr(1) / iw)], [xr(0), top(xr(0) / iw)], [xl(0), top(xl(0) / iw)]]
      const hole = new THREE.Path()
      pts.forEach(([x, y], i) => (i ? hole.lineTo(x0 + c.border + x, y0 + c.border + y) : hole.moveTo(x0 + c.border + x, y0 + c.border + y)))
      hole.closePath()
      shape.holes.push(hole)
    }
  }
  const frame = new THREE.ExtrudeGeometry(shape, { depth: c.depth, bevelEnabled: false })
  frame.translate(0, 0, -c.depth / 2)
  if (!c.back) return frame
  const back = new THREE.BoxGeometry(W, H, Math.max(0.01, c.depth * 0.1))
  back.translate(0, 0, -c.depth / 2 - c.depth * 0.05)
  const parts = [frame.index ? frame.toNonIndexed() : frame, back.toNonIndexed()]
  return mergeAll(parts)
}
