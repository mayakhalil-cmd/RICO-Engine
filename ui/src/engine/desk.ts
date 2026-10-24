import { useSyncExternalStore } from 'react'
import { rico } from './connection'
import { readSignal } from './signals'
import { getWorld } from '../three/world'

// The lighting desk: patch fixtures (not raw channels) on any universe, set
// them by what they do (intensity, color, pan and tilt...), run effects,
// store cues with fades, and link anything to a signal (audio, MIDI, OSC,
// the timeline, a phone). RICO sends every universe about 40 times a
// second over Art-Net or sACN.

export type ChType = 'dim' | 'r' | 'g' | 'b' | 'w' | 'a' | 'uv' | 'pan' | 'panFine' | 'tilt' | 'tiltFine' | 'strobe' | 'zoom' | 'colorWheel' | 'gobo' | 'speed' | 'fog' | 'raw'
export interface ChDef { type: ChType; name?: string; cell?: number; def?: number }
export interface Profile { id: string; name: string; channels: ChDef[]; custom?: boolean }

export const CH_LABEL: Record<ChType, string> = {
  dim: 'Intensity', r: 'Red', g: 'Green', b: 'Blue', w: 'White', a: 'Amber', uv: 'UV', pan: 'Pan', panFine: 'Pan fine', tilt: 'Tilt', tiltFine: 'Tilt fine',
  strobe: 'Strobe', zoom: 'Zoom', colorWheel: 'Color wheel', gobo: 'Gobo', speed: 'Move speed', fog: 'Fog', raw: 'Other',
}
const ch = (...types: (ChType | [ChType, string])[]) => types.map((t) => (Array.isArray(t) ? { type: t[0], name: t[1] } : { type: t }))
const cells = (n: number, per: ChType[]) => Array.from({ length: n }, (_, c) => per.map((type) => ({ type, cell: c }))).flat()

export const PROFILES: Profile[] = [
  { id: 'dimmer', name: 'Dimmer (1 ch)', channels: ch('dim') },
  { id: 'rgb', name: 'RGB (3 ch)', channels: ch('r', 'g', 'b') },
  { id: 'drgb', name: 'Dimmer + RGB (4 ch)', channels: ch('dim', 'r', 'g', 'b') },
  { id: 'rgbw', name: 'RGBW (4 ch)', channels: ch('r', 'g', 'b', 'w') },
  { id: 'par6', name: 'LED par: dim RGBW strobe (6 ch)', channels: ch('dim', 'r', 'g', 'b', 'w', 'strobe') },
  { id: 'par7', name: 'LED par: dim RGB strobe mode speed (7 ch)', channels: ch('dim', 'r', 'g', 'b', 'strobe', ['raw', 'Mode'], 'speed') },
  { id: 'par8', name: 'LED par: dim RGBWA UV strobe (8 ch)', channels: ch('dim', 'r', 'g', 'b', 'w', 'a', 'uv', 'strobe') },
  { id: 'spot11', name: 'Moving head spot (11 ch)', channels: ch('pan', 'panFine', 'tilt', 'tiltFine', 'speed', 'dim', 'strobe', 'colorWheel', 'gobo', ['raw', 'Prism'], ['raw', 'Focus']) },
  { id: 'wash13', name: 'Moving head wash (13 ch)', channels: ch('pan', 'panFine', 'tilt', 'tiltFine', 'speed', 'dim', 'strobe', 'r', 'g', 'b', 'w', 'zoom', ['raw', 'Macro']) },
  { id: 'bar8', name: 'Pixel bar, 8 RGB cells (24 ch)', channels: cells(8, ['r', 'g', 'b']) },
  { id: 'strobe2', name: 'Strobe: dim + rate (2 ch)', channels: ch('dim', 'strobe') },
  { id: 'fog', name: 'Fog or haze (1 ch)', channels: ch('fog') },
]

export interface Fixture {
  id: string; name: string; profile: string; universe: number; address: number; invertPan?: boolean; invertTilt?: boolean
  mount?: 'down' | 'up'   // hung (the beam points down at the middle of tilt) or standing (up)
  panRange?: number       // degrees the fixture turns (often 540)
  tiltRange?: number      // degrees it tilts (often 270)
  follow?: string         // a 3D object it aims at, in the room
}
export interface Group { id: string; name: string; fixtures: string[] }
export type Attr = 'dim' | 'color' | 'pan' | 'tilt' | 'strobe' | 'zoom' | 'gobo' | 'colorWheel' | 'speed' | 'fog' | 'uv' | 'raw'
// One fixture's state: numbers 0..1, color as #rrggbb, and "Other" channels by index.
export interface Look { dim?: number; color?: string; pan?: number; tilt?: number; strobe?: number; zoom?: number; gobo?: number; colorWheel?: number; speed?: number; fog?: number; uv?: number; white?: number; raw?: Record<number, number> }
export interface Effect {
  id: string; name: string; on: boolean
  fixtures: string[]                         // in order: the spread goes along them
  attr: 'dim' | 'pan' | 'tilt' | 'circle' | 'color'
  shape: 'sine' | 'square' | 'saw' | 'ramp' | 'random' | 'chase'
  rate: number                               // cycles a second, or beats when synced
  sync: boolean                              // follow the tempo (BPM) instead
  size: number; base: number; spread: number
  colors: string[]
}
export interface Cue { id: string; name: string; looks: Record<string, Look>; fade: number; effects: string[] }
export interface Link { id: string; fixtures: string[]; attr: 'dim' | 'pan' | 'tilt' | 'strobe' | 'zoom' | 'hue'; signal: string; min: number; max: number }
export interface Desk {
  fixtures: Fixture[]; groups: Group[]; profiles: Profile[]
  programmer: Record<string, Look>
  effects: Effect[]; cues: Cue[]; links: Link[]
  current: string | null                     // the cue that is up
  master: number; blackout: boolean; bpm: number
  output: { on: boolean; protocol: 'artnet' | 'sacn'; ip: string; rate: number }
}

const KEY = 'rico.desk'
const rid = () => Math.random().toString(36).slice(2, 9)
const fresh = (): Desk => ({
  fixtures: [], groups: [], profiles: [], programmer: {}, effects: [], cues: [], links: [], current: null,
  master: 1, blackout: false, bpm: 120, output: { on: false, protocol: 'artnet', ip: '255.255.255.255', rate: 40 },
})
let desk: Desk = (() => { try { const d = JSON.parse(localStorage.getItem(KEY) ?? 'null'); if (d?.fixtures) return { ...fresh(), ...d } } catch { /* new */ } return fresh() })()
let version = 0
const listeners = new Set<() => void>()
let saveTimer = 0
function emit() {
  version++
  listeners.forEach((l) => l())
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(desk)) } catch { /* full */ } }, 300)
}
export function useDesk() { useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => version); return desk }
export const getDesk = () => desk
export function changeDesk(fn: (d: Desk) => Desk) { desk = fn(desk); emit() }

export const profileOf = (id: string) => [...PROFILES, ...desk.profiles].find((p) => p.id === id) ?? PROFILES[0]
export const footprint = (f: Fixture) => profileOf(f.profile).channels.length

// Patches n fixtures one after the other from an address.
export function patch(profile: string, count: number, universe: number, address: number, name: string) {
  const p = profileOf(profile)
  const made: Fixture[] = []
  let at = address
  for (let i = 0; i < count; i++) {
    if (at + p.channels.length - 1 > 512) { universe++; at = 1 }
    made.push({ id: rid(), name: count > 1 ? `${name} ${i + 1}` : name, profile, universe, address: at })
    at += p.channels.length
  }
  changeDesk((d) => ({ ...d, fixtures: [...d.fixtures, ...made], groups: count > 1 ? [...d.groups, { id: rid(), name, fixtures: made.map((f) => f.id) }] : d.groups }))
  return made
}
// The next free address after everything patched in a universe.
export function nextAddress(universe: number) {
  let end = 1
  for (const f of desk.fixtures) if (f.universe === universe) end = Math.max(end, f.address + footprint(f))
  return end
}
export function clashes(): string[] {
  const out: string[] = []
  const used = new Map<string, string>()
  for (const f of desk.fixtures) for (let c = 0; c < footprint(f); c++) {
    const k = `${f.universe}:${f.address + c}`
    const other = used.get(k)
    if (other && other !== f.id) out.push(f.id)
    used.set(k, f.id)
  }
  return [...new Set(out)]
}

export function setLook(ids: string[], part: Look) {
  changeDesk((d) => {
    const programmer = { ...d.programmer }
    for (const id of ids) programmer[id] = { ...(programmer[id] ?? {}), ...part }
    return { ...d, programmer }
  })
}
export function clearProgrammer() { changeDesk((d) => ({ ...d, programmer: {} })) }

// cues

let fadeFrom: Record<string, Look> = {}
let fadeTo: Record<string, Look> = {}
let fadeStart = 0
let fadeLen = 0
let cueLooks: Record<string, Look> = {}

export function recordCue(name?: string) {
  const looks: Record<string, Look> = {}
  const live = computeLooks(performance.now() / 1000, false)
  for (const f of desk.fixtures) looks[f.id] = { ...(live[f.id] ?? {}) }
  const cue: Cue = { id: rid(), name: name ?? `Cue ${desk.cues.length + 1}`, looks, fade: 2, effects: desk.effects.filter((e) => e.on).map((e) => e.id) }
  changeDesk((d) => ({ ...d, cues: [...d.cues, cue], current: cue.id, programmer: {} }))
  cueLooks = looks
  return cue
}
export function goCue(id: string) {
  const cue = desk.cues.find((c) => c.id === id)
  if (!cue) return
  fadeFrom = computeLooks(performance.now() / 1000, true)
  fadeTo = cue.looks
  fadeStart = performance.now() / 1000
  fadeLen = Math.max(0, cue.fade)
  cueLooks = cue.looks
  changeDesk((d) => ({ ...d, current: id, effects: d.effects.map((e) => ({ ...e, on: cue.effects.includes(e.id) })) }))
}
export function goNext() {
  const i = desk.cues.findIndex((c) => c.id === desk.current)
  const next = desk.cues[(i + 1) % Math.max(1, desk.cues.length)]
  if (next) goCue(next.id)
}

// computing what every fixture does right now

const hex = (c: string) => { const n = parseInt(c.replace('#', ''), 16) || 0; return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255] }
const toHex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('')
const mixLook = (a: Look, b: Look, k: number): Look => {
  const out: Look = { ...a, ...b }
  for (const key of ['dim', 'pan', 'tilt', 'strobe', 'zoom', 'speed', 'fog', 'uv', 'white'] as const) {
    if (a[key] !== undefined && b[key] !== undefined) out[key] = a[key]! + (b[key]! - a[key]!) * k
  }
  if (a.color && b.color) { const x = hex(a.color), y = hex(b.color); out.color = toHex(x[0] + (y[0] - x[0]) * k, x[1] + (y[1] - x[1]) * k, x[2] + (y[2] - x[2]) * k) }
  return out
}

function wave(shape: Effect['shape'], ph: number, seed: number): number {
  const p = ((ph % 1) + 1) % 1
  switch (shape) {
    case 'square': return p < 0.5 ? 1 : 0
    case 'saw': return 1 - p
    case 'ramp': return p
    case 'random': { const k = Math.floor(ph) * 7919 + seed * 104729; return ((Math.sin(k) * 43758.5453) % 1 + 1) % 1 }
    case 'chase': return p < 0.25 ? 1 : 0
    default: return 0.5 + 0.5 * Math.sin(p * Math.PI * 2)
  }
}

const smoothSig = new Map<string, number>()
export function computeLooks(t: number, withProgrammer = true): Record<string, Look> {
  const out: Record<string, Look> = {}
  const k = fadeLen > 0 ? Math.min(1, (t - fadeStart) / fadeLen) : 1
  for (const f of desk.fixtures) {
    const base = k < 1 ? mixLook(fadeFrom[f.id] ?? {}, fadeTo[f.id] ?? {}, k * k * (3 - 2 * k)) : (cueLooks[f.id] ?? {})
    out[f.id] = { dim: 0, color: '#ffffff', pan: 0.5, tilt: 0.5, ...base }
  }
  // Effects
  for (const e of desk.effects) {
    if (!e.on || !e.fixtures.length) continue
    const hz = e.sync ? desk.bpm / 60 / Math.max(0.0625, e.rate) : e.rate
    e.fixtures.forEach((id, i) => {
      const L = out[id]
      if (!L) return
      const ph = t * hz + (e.spread * i) / Math.max(1, e.fixtures.length)
      const v = wave(e.shape, ph, i)
      if (e.attr === 'dim') L.dim = Math.max(0, Math.min(1, e.base + (v - 0.5) * e.size * 2))
      else if (e.attr === 'pan') L.pan = Math.max(0, Math.min(1, e.base + (v - 0.5) * e.size))
      else if (e.attr === 'tilt') L.tilt = Math.max(0, Math.min(1, e.base + (v - 0.5) * e.size))
      else if (e.attr === 'circle') { L.pan = 0.5 + Math.cos(ph * Math.PI * 2) * e.size * 0.5; L.tilt = e.base + Math.sin(ph * Math.PI * 2) * e.size * 0.5 }
      else if (e.attr === 'color' && e.colors.length) {
        const pos = (((ph % 1) + 1) % 1) * e.colors.length
        const a = hex(e.colors[Math.floor(pos) % e.colors.length]), b = hex(e.colors[(Math.floor(pos) + 1) % e.colors.length])
        const m = e.shape === 'square' || e.shape === 'chase' ? 0 : pos % 1
        L.color = toHex(a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m, a[2] + (b[2] - a[2]) * m)
      }
    })
  }
  // Links to signals
  for (const l of desk.links) {
    if (!l.signal) continue
    const raw = Math.max(0, Math.min(1, readSignal(l.signal)))
    const prev = smoothSig.get(l.id) ?? raw
    const v = prev * 0.5 + raw * 0.5
    smoothSig.set(l.id, v)
    const x = l.min + v * (l.max - l.min)
    for (const id of l.fixtures) {
      const L = out[id]
      if (!L) continue
      if (l.attr === 'hue') { const [r, g, b] = hsv(x, 1, 1); L.color = toHex(r, g, b) }
      else L[l.attr] = x
    }
  }
  // Aiming at things in 3D: the fixture's place is its 3D twin, in meters
  for (const f of desk.fixtures) {
    if (!f.follow || !out[f.id]) continue
    const to = where(f.follow)
    const twin = twinOf(f.id)
    const from = twin ? where(twin.id) ?? twin.position : null
    if (!to || !from) continue
    const a = aimAt(f, from, to)
    out[f.id].pan = a.pan
    out[f.id].tilt = a.tilt
  }
  // The programmer is on top of everything
  if (withProgrammer) for (const [id, p] of Object.entries(desk.programmer)) if (out[id]) out[id] = { ...out[id], ...p, raw: { ...(out[id].raw ?? {}), ...(p.raw ?? {}) } }
  return out
}
function hsv(h: number, s: number, v: number) {
  const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), u = v * (1 - (1 - f) * s)
  return [[v, u, p], [q, v, p], [p, v, u], [p, q, v], [u, p, v], [v, p, q]][((i % 6) + 6) % 6]
}

// in 3D and in the room

type V3 = [number, number, number]
// where a 3D object is right now (the 3D view puts in its live places)
let where: (id: string) => V3 | null = (id) => getWorld().objects.find((o) => o.id === id)?.position ?? null
export function setWhere(fn: (id: string) => V3 | null) { where = fn }
// the 3D light that stands for a fixture
export const twinOf = (fixture: string) => getWorld().objects.find((o) => o.fixture === fixture)

const DEG = Math.PI / 180
// Pan and tilt (0..1) that point a fixture from one place at another. The
// middle of pan looks toward +Z, the middle of tilt straight down (hung) or up.
export function aimAt(f: Fixture, from: V3, to: V3): { pan: number; tilt: number } {
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2]
  const len = Math.hypot(dx, dy, dz) || 1
  const up = f.mount === 'up'
  const th = Math.acos(Math.max(-1, Math.min(1, (up ? dy : -dy) / len)))
  let ph = Math.atan2(dx, dz)
  const P = (f.panRange ?? 540) * DEG, T = (f.tiltRange ?? 270) * DEG
  let pan = 0.5 + ph / P, tilt = 0.5 + th / T
  // out of reach: turn the other way round and tilt back instead
  if (pan < 0 || pan > 1) { ph = ph > 0 ? ph - Math.PI : ph + Math.PI; pan = 0.5 + ph / P; tilt = 0.5 - th / T }
  return { pan: Math.max(0, Math.min(1, pan)), tilt: Math.max(0, Math.min(1, tilt)) }
}
// Which way the beam goes for a pan and tilt (the same rule, backwards).
export function beamDir(f: Fixture, pan: number, tilt: number): V3 {
  const ph = (pan - 0.5) * (f.panRange ?? 540) * DEG, th = (tilt - 0.5) * (f.tiltRange ?? 270) * DEG
  const sn = Math.sin(th)
  return [sn * Math.sin(ph), (f.mount === 'up' ? 1 : -1) * Math.cos(th), sn * Math.cos(ph)]
}
let lastLooks: Record<string, Look> = {}
export const latestLooks = () => lastLooks

// The 512 channels of each universe.
export function frames(looks: Record<string, Look>): Map<number, Uint8Array> {
  const out = new Map<number, Uint8Array>()
  const master = desk.blackout ? 0 : desk.master
  for (const f of desk.fixtures) {
    const L = looks[f.id] ?? {}
    const p = profileOf(f.profile)
    let u = out.get(f.universe)
    if (!u) { u = new Uint8Array(512); out.set(f.universe, u) }
    const hasDim = p.channels.some((c) => c.type === 'dim')
    const [r, g, b] = hex(L.color ?? '#ffffff')
    const white = L.white ?? Math.min(r, g, b)
    const scale = hasDim ? 1 : (L.dim ?? 0) * master
    const pan = f.invertPan ? 1 - (L.pan ?? 0.5) : (L.pan ?? 0.5)
    const tilt = f.invertTilt ? 1 - (L.tilt ?? 0.5) : (L.tilt ?? 0.5)
    let rawIndex = 0
    p.channels.forEach((c, i) => {
      const a = f.address - 1 + i
      if (a < 0 || a >= 512) return
      let v = 0
      switch (c.type) {
        case 'dim': v = (L.dim ?? 0) * master; break
        case 'r': v = r * scale; break
        case 'g': v = g * scale; break
        case 'b': v = b * scale; break
        case 'w': v = white * scale; break
        case 'a': v = Math.min(r, g * 1.6) * 0.6 * scale; break
        case 'uv': v = (L.uv ?? 0) * (hasDim ? 1 : master); break
        case 'pan': v = pan; break
        case 'panFine': v = (pan * 255) % 1; break
        case 'tilt': v = tilt; break
        case 'tiltFine': v = (tilt * 255) % 1; break
        case 'strobe': v = L.strobe ?? 0; break
        case 'zoom': v = L.zoom ?? 0.5; break
        case 'colorWheel': v = L.colorWheel ?? 0; break
        case 'gobo': v = L.gobo ?? 0; break
        case 'speed': v = L.speed ?? 0; break
        case 'fog': v = (L.fog ?? 0) * (desk.blackout ? 0 : 1); break
        case 'raw': v = L.raw?.[rawIndex] ?? (c.def ?? 0); rawIndex++; break
      }
      u![a] = Math.round(Math.max(0, Math.min(1, v)) * 255)
    })
  }
  return out
}

// sending

let latest = new Map<number, Uint8Array>()
export const latestFrames = () => latest
let lastSend = 0
function tick() {
  const now = performance.now()
  const every = 1000 / Math.max(1, Math.min(44, desk.output.rate))
  if (now - lastSend >= every) {
    lastSend = now
    if (desk.fixtures.length) {
      lastLooks = computeLooks(now / 1000)
      latest = frames(lastLooks)
      if (desk.output.on && rico.get().status === 'live') {
        for (const [universe, data] of latest) void rico.send('dmx.universe', { universe, data: Array.from(data), protocol: desk.output.protocol })
      }
    }
  }
}
let started = false
export function startDesk() {
  if (started) return
  started = true
  window.setInterval(tick, 10)
}
export function setTarget(ip: string) {
  changeDesk((d) => ({ ...d, output: { ...d.output, ip } }))
  void rico.send('dmx.target', { ip })
}
export const newEffect = (fixtures: string[], attr: Effect['attr']): Effect => ({
  id: rid(), name: attr === 'color' ? 'Color chase' : attr === 'circle' ? 'Circle' : attr === 'dim' ? 'Intensity wave' : `${attr} wave`,
  on: true, fixtures, attr, shape: attr === 'color' ? 'chase' : 'sine', rate: attr === 'circle' ? 0.25 : 1, sync: attr !== 'circle', size: attr === 'dim' ? 0.5 : 0.4, base: 0.5, spread: 1,
  colors: ['#f820a0', '#30e0ff', '#3bff03'],
})
export const newLink = (fixtures: string[]): Link => ({ id: rid(), fixtures, attr: 'dim', signal: 'audio:kick', min: 0, max: 1 })
export const newGroup = (name: string, fixtures: string[]): Group => ({ id: rid(), name, fixtures })
export const newProfile = (): Profile => ({ id: rid(), name: 'My fixture', channels: ch('dim', 'r', 'g', 'b'), custom: true })

// After a restart, the cue that was up is up again.
{
  const c = desk.cues.find((x) => x.id === desk.current)
  if (c) cueLooks = c.looks
}
