import { useSyncExternalStore } from 'react'
import { rico } from '../engine/connection'
import { putSignal } from '../engine/signals'

// Control surfaces for a phone or tablet: faders, knobs, pads, step
// sequencers, tilt and more, that send OSC, MIDI, DMX, or RICO signals
// (anything in RICO can follow "phone:<name>"). Titles, text, logos and
// pictures design the page. You build them on the computer; the phone opens a link
// (or scans a QR code) and gets them through RICO's own server.

export type SendKind = 'osc' | 'osc-to' | 'midi-cc' | 'midi-note' | 'dmx' | 'mqtt' | 'udp' | 'http' | 'signal' | 'go'
export interface Send { kind: SendKind; address: string; channel: number; number: number; name: string; host?: string; port?: number; url?: string }
export type ControlKind =
  | 'fader' | 'hfader' | 'knob' | 'encoder' | 'button' | 'toggle' | 'pads' | 'radio' | 'xy' | 'range' | 'cross' | 'color'
  | 'steps' | 'tap' | 'tilt'
  | 'label' | 'text' | 'image'
export interface PControl {
  id: string; kind: ControlKind; label: string; color: string
  x: number; y: number; w: number; h: number       // grid cells
  send: Send; sendY?: Send                         // XY, range, color, tilt: the second value
  min: number; max: number
  // look
  fill?: boolean                                   // solid color instead of an outline
  textColor?: string
  textSize?: number                                // 1 = normal
  align?: 'left' | 'center' | 'right'
  image?: string                                   // picture (image, or a button's icon), as a data URL
  fit?: 'contain' | 'cover'
  hideLabel?: boolean
  // what some kinds need
  options?: string[]                               // radio
  padCols?: number; padRows?: number               // pads
  steps?: number; bpm?: number                     // step sequencer
}
export type Device = 'phone' | 'tablet'
export interface Surface {
  id: string; name: string; cols: number; rows: number; controls: PControl[]
  device?: Device; landscape?: boolean
  bg?: string; bgImage?: string; bgFit?: 'cover' | 'contain'; bgDim?: number
  gap?: number; radius?: number
}

// Display names and groups, for the builder.
export const KIND_NAME: Record<ControlKind, string> = {
  fader: 'Fader', hfader: 'Slider', knob: 'Knob', encoder: 'Endless knob', button: 'Button', toggle: 'Toggle', pads: 'Pad grid', radio: 'Choice',
  xy: 'XY pad', range: 'Range', cross: 'Crossfader', color: 'Color picker', steps: 'Step sequencer', tap: 'Tap tempo', tilt: 'Tilt (motion)',
  label: 'Title', text: 'Text', image: 'Image or logo',
}
export const KIND_GROUPS: { name: string; kinds: ControlKind[] }[] = [
  { name: 'Move', kinds: ['fader', 'hfader', 'knob', 'encoder', 'xy', 'range', 'cross', 'color'] },
  { name: 'Press', kinds: ['button', 'toggle', 'pads', 'radio'] },
  { name: 'Time and motion', kinds: ['steps', 'tap', 'tilt'] },
  { name: 'Design', kinds: ['label', 'text', 'image'] },
]
export const isDesign = (k: ControlKind) => k === 'label' || k === 'text' || k === 'image'
export const hasY = (k: ControlKind) => k === 'xy' || k === 'range' || k === 'color' || k === 'tilt'

const rid = () => Math.random().toString(36).slice(2, 8)
export const newSend = (kind: SendKind = 'signal', n = 1): Send => ({ kind, address: `/rico/phone/${n}`, channel: 1, number: n, name: `control${n}` })

const SIZE: Partial<Record<ControlKind, [number, number]>> = {
  xy: [2, 3], fader: [1, 4], hfader: [4, 1], cross: [4, 1], range: [4, 1], label: [4, 1], text: [4, 1], image: [2, 2],
  pads: [4, 2], radio: [4, 1], steps: [4, 2], color: [2, 2], tilt: [2, 2], tap: [2, 1],
}
export function newControl(kind: ControlKind, x: number, y: number, n: number): PControl {
  const big = SIZE[kind] ?? [1, 1]
  const c: PControl = {
    id: rid(), kind, label: kind === 'label' ? 'Title' : kind === 'text' ? 'Write something here.' : `${KIND_NAME[kind]} ${n}`,
    color: ['#3bff03', '#f820a0', '#30e0ff', '#ffd23f'][n % 4],
    x, y, w: big[0], h: big[1], send: newSend('signal', n), sendY: hasY(kind) ? newSend('signal', n + 100) : undefined, min: 0, max: 1,
  }
  if (kind === 'pads') { c.padCols = 4; c.padRows = 2; c.send = { ...newSend('midi-note', 36), number: 36 } }
  if (kind === 'radio') c.options = ['One', 'Two', 'Three']
  if (kind === 'steps') { c.steps = 8; c.bpm = 120 }
  if (kind === 'text') { c.align = 'left'; c.textColor = '#ffffff' }
  if (kind === 'image') c.fit = 'contain'
  return c
}
export function newSurface(name = 'My controls', device: Device = 'phone'): Surface {
  const s: Surface = device === 'tablet'
    ? { id: rid(), name, cols: 12, rows: 8, controls: [], device, landscape: true, gap: 8, radius: 10 }
    : { id: rid(), name, cols: 4, rows: 8, controls: [], device, gap: 8, radius: 10 }
  if (device === 'tablet') {
    s.controls = [newControl('label', 0, 0, 0), newControl('fader', 0, 1, 1), newControl('fader', 1, 1, 2), newControl('fader', 2, 1, 3), newControl('fader', 3, 1, 4),
      newControl('pads', 4, 1, 5), newControl('xy', 8, 1, 6), newControl('steps', 4, 3, 7), newControl('knob', 0, 5, 8), newControl('knob', 1, 5, 9), newControl('tap', 2, 5, 10), newControl('toggle', 4, 5, 11)]
    s.controls[0].w = 8
    s.controls[6].w = 4; s.controls[6].h = 4
    s.controls[7].w = 4
    s.controls[11].w = 2
  } else {
    s.controls = [newControl('label', 0, 0, 0), newControl('fader', 0, 1, 1), newControl('fader', 1, 1, 2), newControl('knob', 2, 1, 3), newControl('knob', 3, 1, 4), newControl('button', 2, 2, 5), newControl('toggle', 3, 2, 6), newControl('xy', 2, 3, 7)]
  }
  s.controls[0].label = name
  return s
}

// The device a surface is made for, as a width / height shape.
export function deviceAspect(s: Surface): number {
  const d = s.device === 'tablet' ? 4 / 3 : 9 / 19
  const portrait = d < 1 ? d : 1 / d
  return s.landscape ? 1 / portrait : portrait
}

// One pad of a pad grid sends to the next number, name or address.
export function offsetSend(s: Send, i: number): Send {
  if (!i) return s
  return { ...s, number: s.number + i, name: `${s.name}-${i + 1}`, address: `${s.address}/${i + 1}` }
}

// Pictures are made small before they go to the phone (and into saved settings).
export function shrinkImage(file: File, max = 900): Promise<string> {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k))
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url)
      let out = c.toDataURL('image/webp', 0.86)
      if (!out.startsWith('data:image/webp')) out = c.toDataURL('image/png')
      res(out)
    }
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('That picture did not open.')) }
    img.src = url
  })
}

const KEY = 'rico.phone'
let surfaces: Surface[] = (() => { try { const v = JSON.parse(localStorage.getItem(KEY) ?? 'null'); return Array.isArray(v) ? v : [] } catch { return [] } })()
let version = 0
const listeners = new Set<() => void>()
function emit() { version++; listeners.forEach((l) => l()) }
export function useSurfaces() { useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => version); return surfaces }
export const getSurfaces = () => surfaces
let pubTimer = 0
export function setSurfaces(next: Surface[], save = true) {
  surfaces = next
  emit()
  if (!save) return
  try { localStorage.setItem(KEY, JSON.stringify(surfaces)) } catch { /* full */ }
  window.clearTimeout(pubTimer)
  pubTimer = window.setTimeout(publish, 200)
}
export function publish() { if (rico.get().status === 'live') void rico.send('sync.publish', { channel: 'phone', data: surfaces }) }

// What a control does when it moves (on the phone, or when you try it here).
export function fire(s: Send, v: number, press?: boolean) {
  const ch = Math.max(1, Math.min(16, s.channel)) - 1
  switch (s.kind) {
    case 'osc': if (s.address.startsWith('/')) void rico.send('osc.send', { address: s.address, value: v }); break
    case 'midi-cc': void rico.send('midi.send', { bytes: [0xb0 | ch, s.number & 127, Math.round(Math.max(0, Math.min(1, v)) * 127)] }); break
    case 'midi-note': void rico.send('midi.send', { bytes: press === false || v <= 0 ? [0x80 | ch, s.number & 127, 0] : [0x90 | ch, s.number & 127, Math.max(1, Math.round(v * 127))] }); break
    case 'dmx': void rico.send('dmx.set', { channel: Math.max(1, Math.min(512, s.number)), value: Math.max(0, Math.min(1, v)) }); break
    case 'go': if (press !== false && v > 0) remote({ action: 'go' }); break
    // any other device or app: OSC to an address you pick, MQTT, UDP text or a web address ({value} is put in)
    case 'osc-to': if (s.address.startsWith('/')) void rico.send('net.osc', { host: s.host || '127.0.0.1', port: s.port || 9000, address: s.address, args: [v] }); break
    case 'mqtt': void rico.send('mqtt.publish', { topic: s.address || `rico/${s.name}`, payload: String(Math.round(v * 1000) / 1000) }); break
    case 'udp': void rico.send('net.udp.send', { host: s.host || '127.0.0.1', port: s.port || 9000, text: (s.address || '{name}:{value}').replace('{name}', s.name).replace('{value}', String(Math.round(v * 1000) / 1000)) + '\n' }); break
    case 'http': if (s.url) fetch(s.url.replace('{name}', encodeURIComponent(s.name)).replace('{value}', String(Math.round(v * 1000) / 1000)), { mode: 'no-cors' }).catch(() => { /* not reachable */ }); break
    default: remote({ signal: s.name, value: v })
  }
}
// Signals and actions travel to every RICO screen; the computer turns them into "phone:<name>".
function remote(data: { signal?: string; value?: number; action?: string }) {
  if (isPhone) void rico.send('sync.publish', { channel: 'phone-signal', data })
  apply(data)
}
function apply(data: { signal?: string; value?: number; action?: string }) {
  if (data.signal) putSignal(`phone:${data.signal}`, `Phone: ${data.signal}`, Math.max(0, Math.min(1, Number(data.value) || 0)))
  if (data.action === 'go') void import('../engine/desk').then((m) => m.goNext())
}

let isPhone = false
let started = false
// On the computer: answer phones asking for the surfaces, and take their signals.
export function startPhoneHost() {
  if (started) return
  started = true
  rico.onSync((channel, data) => {
    if (channel === 'phone-hello') publish()
    else if (channel === 'phone-signal' && data && typeof data === 'object') apply(data as { signal?: string; value?: number; action?: string })
  })
  let was = false
  rico.subscribe(() => { const live = rico.get().status === 'live'; if (live && !was) publish(); was = live })
}
// On the phone: ask for the surfaces and keep them up to date.
export function startPhoneClient() {
  isPhone = true
  rico.onSync((channel, data) => { if (channel === 'phone' && Array.isArray(data)) setSurfaces(data as Surface[], false) })
  let said = false
  rico.subscribe(() => {
    const live = rico.get().status === 'live'
    if (live && !said) { said = true; void rico.send('sync.publish', { channel: 'phone-hello', data: null }) }
    if (!live) said = false
  })
}
