import { useSyncExternalStore } from 'react'
import type { GoboPlan } from '../mapping/gobo'
import { baseUrl, http, multipart, streamSerial, type Stream } from './net'

// Laser cutting: the outline of a gobo plate (or the shapes of an SVG file)
// as cuts, inside shapes first so the plate never drops before its holes are
// done. G-code for GRBL lasers (most diode and CO2 lasers with a USB cable,
// and Wi-Fi boards like FluidNC).

export type Loop = number[]   // x, y pairs in mm, closed

export interface LaserJob { name: string; loops: Loop[]; size: [number, number] }

export interface LaserSettings {
  material: string
  power: number          // 0..1
  speed: number          // mm/min
  passes: number
  maxS: number           // the laser's full power value ($30, often 1000)
  air: boolean           // air assist (M8)
  origin: 'corner' | 'here'   // the laser's 0,0, or where the head is now
  at: [number, number]   // mm from the origin
  link: 'usb' | 'wifi' | 'file'
  port: string
  baud: number
  host: string
  area: [number, number] // mm the laser can reach
}

export interface LaserMaterial { id: string; name: string; about: string; power: number; speed: number; passes: number }
export const LASER_MATERIALS: LaserMaterial[] = [
  { id: 'card', name: 'Black card', about: 'Thin card or paper, about 0.3 mm. Fast, good for testing a gobo.', power: 0.45, speed: 1800, passes: 1 },
  { id: 'cardboard', name: 'Cardboard 2 mm', about: 'Grey board or cardboard.', power: 0.9, speed: 600, passes: 2 },
  { id: 'ply3', name: 'Plywood 3 mm', about: 'Most diode lasers cut it in a few slow passes.', power: 1, speed: 250, passes: 3 },
  { id: 'acrylic', name: 'Black acrylic 3 mm', about: 'Only black or dark acrylic works on a diode laser. Clear needs a CO2 laser.', power: 1, speed: 180, passes: 3 },
  { id: 'foil', name: 'Black foil tape', about: 'Black aluminium tape on glass or clear plastic: cut, then peel the openings.', power: 0.35, speed: 1500, passes: 1 },
]

export const LASER_DEFAULTS: LaserSettings = { material: 'card', power: 0.45, speed: 1800, passes: 1, maxS: 1000, air: false, origin: 'corner', at: [5, 5], link: 'file', port: 'COM4', baud: 115200, host: '', area: [400, 400] }

const KEY = 'rico.laser'
let cur: LaserSettings | null = null
let v = 0
const ls = new Set<() => void>()
export function getLaser(): LaserSettings {
  if (cur) return cur
  try { const s = JSON.parse(localStorage.getItem(KEY) ?? 'null'); if (s) cur = { ...LASER_DEFAULTS, ...s } } catch { /* defaults */ }
  return (cur ??= { ...LASER_DEFAULTS })
}
export function setLaser(part: Partial<LaserSettings>) { cur = { ...getLaser(), ...part }; try { localStorage.setItem(KEY, JSON.stringify(cur)) } catch { /* not kept */ } v++; ls.forEach((l) => l()) }
export function useLaser() { useSyncExternalStore((l) => { ls.add(l); return () => ls.delete(l) }, () => v); return getLaser() }

// The plate of a gobo: its openings, the screw holes and the outside edge
// (with its round corners), from the bottom left corner.
export function goboLoops(p: GoboPlan, corner: number, holeDia: number): Loop[] {
  const [x0, y0, x1, y1] = p.plate
  const loops: Loop[] = p.openings.filter((c) => c.length >= 3).map((c) => c.flatMap(([x, y]) => [x - x0, y - y0]))
  for (const [hx, hy] of p.holes) {
    const l: number[] = []
    for (let a = 0; a < 32; a++) l.push(hx - x0 + Math.cos((a / 32) * Math.PI * 2) * holeDia / 2, hy - y0 + Math.sin((a / 32) * Math.PI * 2) * holeDia / 2)
    loops.push(l)
  }
  const w = x1 - x0, h = y1 - y0
  if (p.round) {
    const circle: number[] = []
    for (let a = 0; a < 180; a++) circle.push(-x0 + Math.cos((a / 180) * Math.PI * 2) * p.round, -y0 + Math.sin((a / 180) * Math.PI * 2) * p.round)
    loops.push(circle)
    return loops
  }
  const rc = Math.max(0, Math.min(corner, w / 2 - 0.1, h / 2 - 0.1))
  const edge: number[] = []
  const arc = (cx: number, cy: number, a0: number) => { for (let k = 0; k <= 8; k++) { const a = a0 + (k / 8) * (Math.PI / 2); edge.push(cx + Math.cos(a) * rc, cy + Math.sin(a) * rc) } }
  if (rc > 0) { arc(w - rc, rc, -Math.PI / 2); arc(w - rc, h - rc, 0); arc(rc, h - rc, Math.PI / 2); arc(rc, rc, Math.PI) }
  else edge.push(0, 0, w, 0, w, h, 0, h)
  loops.push(edge)
  return loops
}

// Shapes from an SVG file, in mm (from its width and height, or 96 per inch).
export function svgLoops(text: string): { loops: Loop[]; size: [number, number] } | string {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
  const root = doc.documentElement
  if (root.nodeName !== 'svg') return 'That does not look like an SVG file.'
  // it has to be on the page to measure it
  const holder = document.createElement('div')
  holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:10px;height:10px;overflow:hidden;visibility:hidden'
  const svg = document.importNode(root, true) as unknown as SVGSVGElement
  holder.appendChild(svg)
  document.body.appendChild(holder)
  try {
    const vb = svg.viewBox?.baseVal
    const unit = (s: string | null, fallback: number) => {
      if (!s) return fallback
      const n = parseFloat(s)
      if (/mm$/.test(s)) return n
      if (/cm$/.test(s)) return n * 10
      if (/in$/.test(s)) return n * 25.4
      if (/pt$/.test(s)) return n * 25.4 / 72
      return n * 25.4 / 96
    }
    const vw = vb && vb.width ? vb.width : parseFloat(svg.getAttribute('width') ?? '100')
    const vh = vb && vb.height ? vb.height : parseFloat(svg.getAttribute('height') ?? '100')
    const wmm = unit(svg.getAttribute('width'), vw * 25.4 / 96), hmm = unit(svg.getAttribute('height'), vh * 25.4 / 96)
    const sx = wmm / vw, sy = hmm / vh
    const ox = vb ? vb.x : 0, oy = vb ? vb.y : 0
    const loops: Loop[] = []
    for (const el of Array.from(svg.querySelectorAll('path, rect, circle, ellipse, polygon, polyline, line'))) {
      const g = el as SVGGeometryElement
      if (typeof g.getTotalLength !== 'function') continue
      const len = g.getTotalLength()
      if (!len) continue
      const m = g.getCTM() ?? svg.createSVGMatrix()
      const inv = svg.getCTM()?.inverse() ?? svg.createSVGMatrix()
      const step = Math.max(0.15 / Math.max(sx, sy), len / 4000)
      // a path can hold several shapes: start a new loop where it jumps
      let loop: number[] = []
      let lx = NaN, ly = NaN
      for (let d = 0; d <= len + 1e-6; d += step) {
        const p = g.getPointAtLength(Math.min(d, len)).matrixTransform(m).matrixTransform(inv)
        const x = (p.x - ox) * sx, y = hmm - (p.y - oy) * sy
        if (loop.length && Math.hypot(x - lx, y - ly) > step * Math.max(sx, sy) * 6) { if (loop.length >= 4) loops.push(loop); loop = [] }
        loop.push(x, y); lx = x; ly = y
      }
      if (loop.length >= 4) loops.push(loop)
    }
    if (!loops.length) return 'No shapes found in that SVG.'
    return { loops, size: [wmm, hmm] }
  } finally { holder.remove() }
}

const area = (l: Loop) => { let a = 0; for (let i = 0; i < l.length; i += 2) { const j = (i + 2) % l.length; a += l[i] * l[j + 1] - l[j] * l[i + 1] } return Math.abs(a / 2) }
const inside = (x: number, y: number, l: Loop) => {
  let c = false
  for (let i = 0, j = l.length - 2; i < l.length; j = i, i += 2) {
    if ((l[i + 1] > y) !== (l[j + 1] > y) && x < ((l[j] - l[i]) * (y - l[i + 1])) / (l[j + 1] - l[i + 1]) + l[i]) c = !c
  }
  return c
}

// Cut order: shapes inside other shapes first, then nearest next.
export function cutOrder(loops: Loop[]): Loop[] {
  const depth = loops.map((l, i) => loops.reduce((d, o, j) => (j !== i && area(o) > area(l) && inside(l[0], l[1], o) ? d + 1 : d), 0))
  const left = loops.map((l, i) => ({ l, d: depth[i] }))
  const out: Loop[] = []
  let x = 0, y = 0
  while (left.length) {
    const deepest = Math.max(...left.map((o) => o.d))
    let best = -1, bd = Infinity
    left.forEach((o, k) => { if (o.d === deepest) { const d = Math.hypot(o.l[0] - x, o.l[1] - y); if (d < bd) { bd = d; best = k } } })
    const [o] = left.splice(best, 1)
    out.push(o.l)
    x = o.l[0]; y = o.l[1]
  }
  return out
}

export interface LaserGcode { text: string; seconds: number; length: number }

export function laserGcode(jobs: { loops: Loop[]; at: [number, number] }[], s: LaserSettings): LaserGcode {
  const f = (n: number) => (Math.round(n * 1000) / 1000).toString()
  const S = Math.round(Math.max(0, Math.min(1, s.power)) * s.maxS)
  const out = ['; made with RICO', `; power ${Math.round(s.power * 100)}%, speed ${s.speed} mm/min, ${s.passes} pass${s.passes > 1 ? 'es' : ''}`, 'G21 ; millimetres', 'G90 ; absolute moves']
  if (s.origin === 'here') out.push('G92 X0 Y0 ; start where the head is now')
  out.push('M5', 'G0 F6000')
  if (s.air) out.push('M8 ; air assist')
  // M4: the power follows the speed, so corners do not burn
  out.push(`M4 S0`)
  let seconds = 0, length = 0, x = 0, y = 0
  const loops = cutOrder(jobs.flatMap((j) => j.loops.map((l) => l.map((v, i) => v + (i % 2 ? j.at[1] : j.at[0])))))
  for (let pass = 0; pass < Math.max(1, s.passes); pass++) {
    if (s.passes > 1) out.push(`; pass ${pass + 1}`)
    for (const l of loops) {
      const d0 = Math.hypot(l[0] - x, l[1] - y)
      out.push(`G0 X${f(l[0])} Y${f(l[1])} S0`)
      seconds += d0 / 100
      let first = true
      for (let i = 2; i <= l.length; i += 2) {
        const k = i % l.length
        const nx = l[k], ny = l[k + 1]
        const d = Math.hypot(nx - (i === 2 ? l[0] : l[i - 2]), ny - (i === 2 ? l[1] : l[i - 1]))
        length += d; seconds += (d / s.speed) * 60
        out.push(`G1 X${f(nx)} Y${f(ny)}${first ? ` S${S} F${Math.round(s.speed)}` : ''}`)
        first = false
      }
      x = l[0]; y = l[1]
    }
  }
  out.push('M5 ; laser off')
  if (s.air) out.push('M9')
  out.push(s.origin === 'here' ? 'G0 X0 Y0' : 'G0 X0 Y0')
  return { text: out.join('\n') + '\n', seconds: seconds * 1.1, length }
}

// The outline of everything, laser off (or barely on), to check where it lands.
export function frameGcode(jobs: { size: [number, number]; at: [number, number] }[], s: LaserSettings, glow: boolean): string {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const j of jobs) { x0 = Math.min(x0, j.at[0]); y0 = Math.min(y0, j.at[1]); x1 = Math.max(x1, j.at[0] + j.size[0]); y1 = Math.max(y1, j.at[1] + j.size[1]) }
  const S = glow ? Math.round(s.maxS * 0.01) : 0
  return ['G21', 'G90', s.origin === 'here' ? 'G92 X0 Y0' : '', `M${glow ? 3 : 5} S${S}`, `G1 X${x0.toFixed(2)} Y${y0.toFixed(2)} F3000`, `G1 X${x1.toFixed(2)} Y${y0.toFixed(2)}`, `G1 X${x1.toFixed(2)} Y${y1.toFixed(2)}`, `G1 X${x0.toFixed(2)} Y${y1.toFixed(2)}`, `G1 X${x0.toFixed(2)} Y${y0.toFixed(2)}`, 'M5', s.origin === 'here' ? 'G0 X0 Y0' : ''].filter(Boolean).join('\n') + '\n'
}

// sending

export const LASER_LINKS: { id: LaserSettings['link']; name: string; about: string }[] = [
  { id: 'usb', name: 'USB cable (GRBL)', about: 'Most diode lasers. Pick its COM port. Keep RICO open while it cuts.' },
  { id: 'wifi', name: 'Wi-Fi (FluidNC)', about: 'Boards with a web page: RICO puts the file on its SD card and starts it.' },
  { id: 'file', name: 'Save the file', about: 'Save the G-code and open it in your laser\'s own app.' },
]

export async function sendToLaser(s: LaserSettings, name: string, text: string, on: { progress: (f: number) => void; log: (t: string) => void; error: (t: string) => void }): Promise<{ error: string; stream?: Stream }> {
  if (s.link === 'usb') {
    const stream = streamSerial(s.port, s.baud, text.split('\n'), 'grbl', { progress: (d, t) => on.progress(t ? d / t : 0), log: on.log, error: on.error })
    return { error: '', stream }
  }
  if (s.link === 'wifi') {
    const u = baseUrl(s.host)
    if (!u) return { error: 'Type the laser\'s address first.' }
    const file = `${name.replace(/[^\w\-.]+/g, '-')}.gcode`
    const data = new TextEncoder().encode(text)
    const m = multipart({ path: '/', [`/${file}S`]: String(data.length) }, { field: 'myfile[]', name: `/${file}`, type: 'text/plain', data })
    const a = await http('POST', `${u}/upload`, { headers: { 'Content-Type': m.type }, body: m.body, timeout: 120000 })
    if (!a.ok) return { error: a.status ? `The laser did not take the file (${a.status}).` : a.error ?? 'Could not reach the laser.' }
    const cmd = encodeURIComponent(`$SD/Run=/${file}`)
    let r = await http('GET', `${u}/command?commandText=${cmd}`)
    if (!r.ok) r = await http('GET', `${u}/command?plain=${cmd}`)
    return { error: r.ok ? '' : 'The file is on the laser, but it did not start. Start it from its page.' }
  }
  return { error: '' }
}
