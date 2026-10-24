import { useSyncExternalStore } from 'react'
import { rico } from './connection'
import { putSignal, readSignal } from './signals'
import { record } from '../shell/history'

// Routes: when something moves, send it somewhere. One source (a knob, an
// OSC address, an audio band, a script value) can go to as many places as
// you want, each with its own range.

export type TargetKind = 'osc' | 'midi-cc' | 'midi-note' | 'dmx' | 'mqtt'

export interface Target {
  id: string
  kind: TargetKind
  host: string        // osc
  port: number        // osc
  address: string     // osc
  channel: number     // midi 1-16, dmx 1-512
  number: number      // midi cc or note number
  topic: string       // mqtt
  min: number
  max: number
}

export interface Route {
  id: string
  name: string
  source: string      // a signal id like "midi:1:1:74", "osc:/fader/1", "audio:low", or "manual" (a fader here) or "key:A"
  manual?: number     // the fader's value, for manual routes
  enabled: boolean
  smooth: number      // 0 = none, 0.95 = very smooth
  invert: boolean
  targets: Target[]
}

export const TARGET_KINDS: { id: TargetKind; label: string; about: string }[] = [
  { id: 'osc', label: 'OSC', about: 'An app that listens for OSC: Unreal, TouchDesigner, Resolume, Blender...' },
  { id: 'midi-cc', label: 'MIDI knob (CC)', about: 'MIDI out and RICO virtual ports, as a control change' },
  { id: 'midi-note', label: 'MIDI note', about: 'A note that turns on past halfway and off below it' },
  { id: 'dmx', label: 'DMX light', about: 'One Art-Net channel' },
  { id: 'mqtt', label: 'MQTT', about: 'A topic on your MQTT broker' },
]

const KEY = 'rico.routes'
let routes: Route[] = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
})()
let version = 0
const listeners = new Set<() => void>()

function commit(next: Route[]) {
  routes = next
  try {
    localStorage.setItem(KEY, JSON.stringify(routes))
  } catch {
    /* not remembered */
  }
  version++
  listeners.forEach((l) => l())
}

function change(label: string, fn: (r: Route[]) => Route[], key?: string) {
  const before = routes
  const after = fn(routes)
  commit(after)
  record({ label, key, undo: () => commit(before), redo: () => commit(after) })
}

export function useRoutes(): Route[] {
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => version,
  )
  return routes
}

export const getRoutes = () => routes
export function onRoutesChange(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
export const setAllRoutes = (r: Route[]) => commit(r)

const uid = () => Math.random().toString(36).slice(2, 9)

export function newTarget(kind: TargetKind = 'osc'): Target {
  const osc = rico.get().state?.osc
  return {
    id: uid(), kind,
    host: osc?.ip ?? '127.0.0.1', port: osc?.port ?? 8000, address: `${osc?.address ?? '/rico'}/value`,
    channel: 1, number: 20, topic: 'rico/value', min: 0, max: 1,
  }
}

export function addRoute(source = '', name = 'New route'): string {
  const r: Route = { id: uid(), name, source, enabled: true, smooth: 0, invert: false, targets: [newTarget()] }
  change('Add route', (all) => [...all, r])
  return r.id
}

export function updateRoute(id: string, part: Partial<Route>, label = 'Change route', key?: string) {
  change(label, (all) => all.map((r) => (r.id === id ? { ...r, ...part } : r)), key ?? `${id}.${Object.keys(part).join()}`)
}

// Moving a fader by hand: live, not an undo step for every pixel.
export function setManual(id: string, v: number) {
  routes = routes.map((r) => (r.id === id ? { ...r, manual: Math.max(0, Math.min(1, v)) } : r))
  version++
  listeners.forEach((l) => l())
  window.clearTimeout(manualSave)
  manualSave = window.setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(routes))
    } catch {
      /* not remembered */
    }
  }, 500)
}
let manualSave = 0

// Many rows at once. {n} in the name or address becomes 1, 2, 3...
export function addMany(opts: { count: number; name: string; source: 'manual' | 'midi-cc' | 'midi-note' | 'osc'; channel: number; first: number; inAddress: string; target: TargetKind; outAddress: string; host: string; port: number; outFirst: number }) {
  const made: Route[] = []
  for (let i = 0; i < opts.count; i++) {
    const n = String(i + 1)
    const fill = (x: string) => x.split('{n}').join(n)
    const num = opts.first + i
    const source = opts.source === 'manual' ? 'manual'
      : opts.source === 'osc' ? `osc:${fill(opts.inAddress)}`
      : `midi:${opts.source === 'midi-note' ? 0 : 1}:${opts.channel}:${num}`
    const t = { ...newTarget(opts.target), host: opts.host, port: opts.port, address: fill(opts.outAddress), channel: opts.target === 'dmx' ? opts.outFirst + i : opts.channel, number: opts.outFirst + i, topic: fill(opts.outAddress) }
    made.push({ id: uid(), name: fill(opts.name), source, manual: 0, enabled: true, smooth: 0, invert: false, targets: [t] })
  }
  change(`Add ${opts.count} rows`, (all) => [...all, ...made])
}

// Many destinations on one row: one knob to ten OSC addresses.
export function addManyTargets(route: string, count: number, kind: TargetKind, address: string, first: number) {
  change(`Add ${count} destinations`, (all) => all.map((r) => {
    if (r.id !== route) return r
    const base = r.targets[r.targets.length - 1] ?? newTarget(kind)
    const extra = Array.from({ length: count }, (_, i) => ({
      ...base, id: uid(), kind,
      address: address.split('{n}').join(String(i + 1)), topic: address.split('{n}').join(String(i + 1)),
      channel: kind === 'dmx' ? first + i : base.channel, number: first + i,
    }))
    return { ...r, targets: [...r.targets, ...extra] }
  }))
}

export function duplicateRoute(id: string) {
  const r = routes.find((x) => x.id === id)
  if (!r) return
  const copy = { ...r, id: uid(), name: `${r.name} copy`, targets: r.targets.map((t) => ({ ...t, id: uid() })) }
  change('Duplicate row', (all) => {
    const i = all.findIndex((x) => x.id === id)
    return [...all.slice(0, i + 1), copy, ...all.slice(i + 1)]
  })
}

export function removeRoute(id: string) {
  change('Delete route', (all) => all.filter((r) => r.id !== id))
}

export function updateTarget(route: string, target: string, part: Partial<Target>) {
  sent.delete(target)
  change('Change destination', (all) => all.map((r) => (r.id === route ? { ...r, targets: r.targets.map((t) => (t.id === target ? { ...t, ...part } : t)) } : r)), `${target}.${Object.keys(part).join()}`)
}

export function addTarget(route: string, kind: TargetKind = 'osc') {
  change('Add destination', (all) => all.map((r) => (r.id === route ? { ...r, targets: [...r.targets, newTarget(kind)] } : r)))
}

export function removeTarget(route: string, target: string) {
  change('Remove destination', (all) => all.map((r) => (r.id === route ? { ...r, targets: r.targets.filter((t) => t.id !== target) } : r)))
}

// running

const smoothed = new Map<string, number>()
const sent = new Map<string, number>()     // last value sent to each target
const lastMqtt = new Map<string, number>()
export const routeValue = (id: string) => smoothed.get(id) ?? 0

function send(t: Target, v: number) {
  const out = t.min + v * (t.max - t.min)
  switch (t.kind) {
    case 'osc':
      if (t.address.startsWith('/')) rico.send('net.osc', { host: t.host, port: t.port, address: t.address, args: [out] })
      break
    case 'midi-cc':
      rico.send('midi.send', { bytes: [0xb0 + ((t.channel - 1) & 15), t.number & 127, Math.round(Math.max(0, Math.min(1, out)) * 127)] })
      break
    case 'midi-note': {
      const on = v > 0.5
      const was = (sent.get(`${t.id}:note`) ?? 0) > 0.5
      if (on !== was) rico.send('midi.send', { bytes: [(on ? 0x90 : 0x80) + ((t.channel - 1) & 15), t.number & 127, on ? Math.max(1, Math.round(Math.min(1, out) * 127)) : 0] })
      sent.set(`${t.id}:note`, v)
      break
    }
    case 'dmx':
      rico.send('dmx.set', { channel: t.channel, value: Math.max(0, Math.min(1, out)) })
      break
    case 'mqtt': {
      const now = performance.now()
      if (now - (lastMqtt.get(t.id) ?? 0) < 100) return false   // MQTT brokers don't like 60 messages a second
      lastMqtt.set(t.id, now)
      rico.send('mqtt.publish', { topic: t.topic, payload: out.toFixed(4) })
      break
    }
  }
  return true
}

// Keys held down, for routes that come from the keyboard.
const keysDown = new Set<string>()
const typing = (e: KeyboardEvent) => Boolean((e.target as HTMLElement).closest?.('input, textarea, select, [contenteditable]'))
window.addEventListener('keydown', (e) => { if (!typing(e) && !e.ctrlKey && !e.metaKey) keysDown.add(e.key.toUpperCase()) })
window.addEventListener('keyup', (e) => keysDown.delete(e.key.toUpperCase()))
window.addEventListener('blur', () => keysDown.clear())

export function sourceValue(r: Route): number {
  if (r.source === 'manual') return r.manual ?? 0
  if (r.source.startsWith('key:')) return keysDown.has(r.source.slice(4)) ? 1 : 0
  return readSignal(r.source)
}

window.setInterval(() => {
  for (const r of routes) {
    // Faders here are signals too, so Create, nodes and scripts can use them.
    if (r.source === 'manual') putSignal(`fader:${r.id}`, `Fader: ${r.name}`, r.manual ?? 0)
    if (!r.enabled || !r.source) continue
    let v = Math.max(0, Math.min(1, sourceValue(r)))
    if (r.invert) v = 1 - v
    const prev = smoothed.get(r.id) ?? v
    v = prev * r.smooth + v * (1 - r.smooth)
    smoothed.set(r.id, v)
    for (const t of r.targets) {
      const last = sent.get(t.id)
      if (last !== undefined && Math.abs(last - v) < 0.002) continue
      if (send(t, v)) sent.set(t.id, v)
    }
  }
}, 16)
