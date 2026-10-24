import { useSyncExternalStore } from 'react'
import { rico } from './connection'
import { listSignals, readSignal } from './signals'
import { adalight, artnet, ddp, ledPoints, opc, sacn, shape, toB64, wledUdp, type Layout, type Order } from './ledProtocols'

// Outputs to anything: LED strips and walls (pixels from a picture) and
// values (any RICO signal) to Raspberry Pis, microcontrollers, web hooks,
// MQTT and more. Each output samples, packs and sends on its own clock.

export type Kind = 'pixels' | 'values'
export type PixelProto = 'ddp' | 'wled' | 'artnet' | 'sacn' | 'opc' | 'adalight' | 'udp-raw' | 'serial-raw'
export type ValueProto = 'osc' | 'udp' | 'tcp' | 'serial' | 'mqtt' | 'http' | 'websocket'
export type Format = 'line' | 'json' | 'csv' | 'bytes'

export interface Output {
  id: string; name: string; on: boolean; kind: Kind; preset: string
  // where
  host: string; port: number; serial: string; baud: number; universe: number; topic: string; url: string; method: 'GET' | 'POST'
  // pixels
  pixelProto: PixelProto; picture: string; layout: Layout; order: Order; white: boolean; brightness: number; gamma: number; fps: number
  // values
  valueProto: ValueProto; signals: string[]; format: Format; template: string; onlyChanges: boolean; scale: number
}

const rid = () => Math.random().toString(36).slice(2, 8)
export function newOutput(part: Partial<Output> = {}): Output {
  return {
    id: rid(), name: 'Output', on: false, kind: 'pixels', preset: 'custom',
    host: '192.168.1.50', port: 4048, serial: 'COM3', baud: 115200, universe: 0, topic: 'rico/{name}', url: 'http://192.168.1.50/set?{name}={value}', method: 'GET',
    pixelProto: 'ddp', picture: 'Create', layout: { shape: 'strip', count: 60, cols: 16, rows: 16, serpentine: true, vertical: false, area: [0.05, 0.5, 0.95, 0.5] },
    order: 'GRB', white: false, brightness: 0.6, gamma: 2.2, fps: 40,
    valueProto: 'osc', signals: [], format: 'line', template: '{name}:{value}', onlyChanges: true, scale: 1,
    ...part,
  }
}

export interface Preset { id: string; group: 'LEDs' | 'Values'; name: string; about: string; part: Partial<Output>; code?: string }
export const PRESETS: Preset[] = [
  { id: 'wled', group: 'LEDs', name: 'WLED (ESP32 or ESP8266 on Wi-Fi)', about: 'The easiest Wi-Fi LED controller. Uses DDP, which WLED turns on by itself.', part: { kind: 'pixels', pixelProto: 'ddp', port: 4048, order: 'RGB' }, code: 'wled' },
  { id: 'artnet', group: 'LEDs', name: 'Art-Net LED controller', about: 'Pixel controllers and DMX nodes. 170 RGB LEDs per universe; more LEDs use the next universes.', part: { kind: 'pixels', pixelProto: 'artnet', port: 6454, order: 'RGB' } },
  { id: 'sacn', group: 'LEDs', name: 'sACN (E1.31) LED controller', about: 'Like Art-Net, sent straight to the controller.', part: { kind: 'pixels', pixelProto: 'sacn', port: 5568, universe: 1, order: 'RGB' } },
  { id: 'arduino-leds', group: 'LEDs', name: 'Arduino or ESP over USB (Adalight)', about: 'A strip on a microcontroller plugged in with USB. Load the sketch below.', part: { kind: 'pixels', pixelProto: 'adalight', baud: 115200, order: 'GRB' }, code: 'adalight' },
  { id: 'pi-leds', group: 'LEDs', name: 'Raspberry Pi LED strip', about: 'Plain colors over UDP to a short Python script on the Pi.', part: { kind: 'pixels', pixelProto: 'udp-raw', port: 7000, order: 'RGB' }, code: 'pi-leds' },
  { id: 'opc', group: 'LEDs', name: 'Fadecandy or Open Pixel Control server', about: 'OPC over TCP, port 7890.', part: { kind: 'pixels', pixelProto: 'opc', port: 7890, order: 'RGB' } },
  { id: 'pi-osc', group: 'Values', name: 'Raspberry Pi (OSC)', about: 'Signals as OSC messages to a Python script. Good for motors, relays, servos and sensors.', part: { kind: 'values', valueProto: 'osc', port: 9000, template: '/rico/{name}' }, code: 'pi-osc' },
  { id: 'mcu-serial', group: 'Values', name: 'Microcontroller over USB (text)', about: 'Lines like "fader1:0.42" an Arduino, ESP32 or Pico reads with a few lines of code.', part: { kind: 'values', valueProto: 'serial', format: 'line', template: '{name}:{value}' }, code: 'mcu-serial' },
  { id: 'esp-udp', group: 'Values', name: 'ESP32 or Pico W on Wi-Fi (UDP)', about: 'The same lines over Wi-Fi.', part: { kind: 'values', valueProto: 'udp', port: 7001, format: 'line', template: '{name}:{value}' }, code: 'esp-udp' },
  { id: 'mqtt', group: 'Values', name: 'MQTT (ESPHome, Home Assistant, Node-RED)', about: 'Through the MQTT broker set up in Devices.', part: { kind: 'values', valueProto: 'mqtt', topic: 'rico/{name}' } },
  { id: 'http', group: 'Values', name: 'Web address (HTTP)', about: 'Calls an address for every change: smart lights, Shelly relays, web hooks.', part: { kind: 'values', valueProto: 'http', method: 'GET', fps: 10 } },
  { id: 'ws', group: 'Values', name: 'WebSocket', about: 'JSON to a web page, a Node.js app or a browser game.', part: { kind: 'values', valueProto: 'websocket', port: 8080, format: 'json' } },
  { id: 'tcp', group: 'Values', name: 'TCP', about: 'Lines or JSON over a TCP connection.', part: { kind: 'values', valueProto: 'tcp', port: 7002, format: 'line' } },
]

// the list
const KEY = 'rico.sends'
let outputs: Output[] = (() => { try { const v = JSON.parse(localStorage.getItem(KEY) ?? '[]'); return Array.isArray(v) ? v.map((o: Output) => newOutput(o)) : [] } catch { return [] } })()
let version = 0
const listeners = new Set<() => void>()
const emit = () => { version++; listeners.forEach((l) => l()) }
export const getOutputs = () => outputs
export function setOutputs(next: Output[]) {
  outputs = next
  emit()
  try { localStorage.setItem(KEY, JSON.stringify(outputs)) } catch { /* not remembered */ }
}
export function useSendOutputs() { useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => version); return outputs }

// live state, for the panel
export interface Live { rate: number; error: string; colors?: Uint8Array }
const live = new Map<string, Live>()
export const liveOf = (id: string) => live.get(id)
const counts = new Map<string, number>()

// sampling pictures
type PictureSource = (name: string) => CanvasImageSource | null
let source: PictureSource = () => null
export function setPictureSource(fn: PictureSource) { source = fn }
export const pictureOf = (name: string) => source(name)
const sampler = document.createElement('canvas')
const sg = sampler.getContext('2d', { willReadFrequently: true })!
function sample(o: Output): Uint8Array | null {
  const src = source(o.picture)
  if (!src) return null
  const w = 192, h = 108
  sampler.width = w; sampler.height = h
  sg.imageSmoothingEnabled = true
  sg.imageSmoothingQuality = 'high'
  try { sg.drawImage(src, 0, 0, w, h) } catch { return null }
  const d = sg.getImageData(0, 0, w, h).data
  const pts = ledPoints(o.layout)
  const out = new Uint8Array(pts.length * 3)
  pts.forEach(([x, y], i) => {
    const px = Math.max(0, Math.min(w - 1, Math.round(x * (w - 1)))), py = Math.max(0, Math.min(h - 1, Math.round(y * (h - 1))))
    const k = (py * w + px) * 4
    out[i * 3] = d[k]; out[i * 3 + 1] = d[k + 1]; out[i * 3 + 2] = d[k + 2]
  })
  return out
}

// sending
const opened = new Map<string, string>()      // output id -> what it opened (serial or tcp key)
const sockets = new Map<string, WebSocket>()
const last = new Map<string, number>()
const lastValues = new Map<string, Map<string, number>>()
let seq = 0

const fail = (o: Output, e?: string) => { const l = live.get(o.id) ?? { rate: 0, error: '' }; l.error = e ?? ''; live.set(o.id, l) }
const sendBytes = (o: Output, op: string, args: Record<string, unknown>, bytes: Uint8Array) => {
  counts.set(o.id, (counts.get(o.id) ?? 0) + 1)
  void rico.send(op, { ...args, b64: toB64(bytes) }).then((a) => fail(o, a.ok ? '' : a.error))
}
const sendText = (o: Output, op: string, args: Record<string, unknown>, text: string) => {
  counts.set(o.id, (counts.get(o.id) ?? 0) + 1)
  void rico.send(op, { ...args, text }).then((a) => fail(o, a.ok ? '' : a.error))
}
function ensure(o: Output, kind: 'serial' | 'tcp') {
  const want = kind === 'serial' ? `serial:${o.serial}:${o.baud}` : `tcp:${o.host}:${o.port}`
  if (opened.get(o.id) === want) return
  opened.set(o.id, want)
  const id = `send-${o.id}`
  void (kind === 'serial' ? rico.send('net.serial.open', { id, port: o.serial, baud: o.baud }) : rico.send('net.tcp.connect', { id, host: o.host, port: o.port })).then((a) => { if (!a.ok) { fail(o, a.error); opened.delete(o.id) } })
}

function sendPixels(o: Output) {
  const rgb = sample(o)
  if (!rgb) return fail(o, `No picture called "${o.picture}" right now.`)
  const l = live.get(o.id) ?? { rate: 0, error: '' }
  l.colors = rgb
  live.set(o.id, l)
  const data = shape(rgb, o.order, o.brightness, o.gamma, o.white)
  const udp = (p: Uint8Array, port = o.port) => sendBytes(o, 'net.udp.send', { host: o.host, port }, p)
  seq = (seq + 1) & 255
  switch (o.pixelProto) {
    case 'ddp': ddp(data, seq).forEach((p) => udp(p)); break
    case 'wled': wledUdp(shape(rgb, 'RGB', o.brightness, o.gamma)).forEach((p) => udp(p)); break
    case 'artnet': artnet(data, o.universe, seq, o.white ? 512 : 510).forEach((p) => udp(p)); break
    case 'sacn': sacn(data, o.universe, seq, o.white ? 512 : 510).forEach((p) => udp(p)); break
    case 'udp-raw': udp(data); break
    case 'opc': ensure(o, 'tcp'); sendBytes(o, 'net.tcp.send', { id: `send-${o.id}` }, opc(data)); break
    case 'adalight': ensure(o, 'serial'); sendBytes(o, 'net.serial.send', { id: `send-${o.id}` }, adalight(data, o.white ? 4 : 3)); break
    case 'serial-raw': ensure(o, 'serial'); sendBytes(o, 'net.serial.send', { id: `send-${o.id}` }, data); break
  }
}

const nameOf = (id: string) => listSignals().find((s) => s.id === id)?.name ?? id
const slug = (s: string) => s.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'value'
const fill = (t: string, name: string, value: number) => t.replace(/\{name\}/g, name).replace(/\{value\}/g, String(Math.round(value * 1000) / 1000)).replace(/\{byte\}/g, String(Math.round(Math.max(0, Math.min(1, value)) * 255)))

function sendValues(o: Output) {
  const before = lastValues.get(o.id) ?? new Map<string, number>()
  const now = new Map<string, number>()
  const changed: { name: string; value: number }[] = []
  for (const id of o.signals) {
    const v = readSignal(id) * o.scale
    now.set(id, v)
    if (!o.onlyChanges || before.get(id) === undefined || Math.abs((before.get(id) ?? 0) - v) > 1e-4) changed.push({ name: slug(nameOf(id)), value: v })
  }
  lastValues.set(o.id, now)
  if (!changed.length) return
  const all = o.signals.map((id) => ({ name: slug(nameOf(id)), value: now.get(id) ?? 0 }))
  // one message per value (lines, OSC, MQTT, HTTP) or one for all (JSON, CSV, bytes)
  const body = (): string | Uint8Array => {
    if (o.format === 'json') return JSON.stringify(Object.fromEntries(all.map((a) => [a.name, Math.round(a.value * 1000) / 1000]))) + '\n'
    if (o.format === 'csv') return all.map((a) => Math.round(a.value * 1000) / 1000).join(',') + '\n'
    if (o.format === 'bytes') return new Uint8Array([0xff, ...all.map((a) => Math.round(Math.max(0, Math.min(1, a.value)) * 254))])
    return changed.map((c) => fill(o.template, c.name, c.value)).join('\n') + '\n'
  }
  switch (o.valueProto) {
    case 'osc':
      for (const c of changed) { counts.set(o.id, (counts.get(o.id) ?? 0) + 1); void rico.send('net.osc', { host: o.host, port: o.port, address: fill(o.template.startsWith('/') ? o.template : '/rico/{name}', c.name, c.value), args: [c.value] }).then((a) => fail(o, a.ok ? '' : a.error)) }
      break
    case 'mqtt':
      for (const c of changed) { counts.set(o.id, (counts.get(o.id) ?? 0) + 1); void rico.send('mqtt.publish', { topic: fill(o.topic, c.name, c.value), payload: String(Math.round(c.value * 1000) / 1000) }).then((a) => fail(o, a.ok ? '' : a.error)) }
      break
    case 'http':
      for (const c of changed) {
        counts.set(o.id, (counts.get(o.id) ?? 0) + 1)
        const url = fill(o.url, c.name, c.value)
        fetch(url, o.method === 'POST' ? { method: 'POST', mode: 'no-cors', body: JSON.stringify({ [c.name]: c.value }), headers: { 'Content-Type': 'text/plain' } } : { mode: 'no-cors' })
          .then(() => fail(o, '')).catch(() => fail(o, `Could not reach ${url}`))
      }
      break
    case 'websocket': {
      let ws = sockets.get(o.id)
      const url = `ws://${o.host}:${o.port}`
      if (!ws || ws.url !== `${url}/` && ws.url !== url || ws.readyState > 1) { try { ws = new WebSocket(url); sockets.set(o.id, ws); ws.onerror = () => fail(o, `Could not connect to ${url}`) } catch { return fail(o, `Could not connect to ${url}`) } }
      if (ws.readyState !== 1) return
      const b = body()
      ws.send(typeof b === 'string' ? b : new Uint8Array(b))
      counts.set(o.id, (counts.get(o.id) ?? 0) + 1)
      fail(o, '')
      break
    }
    default: {
      const b = body()
      const args = o.valueProto === 'udp' ? { host: o.host, port: o.port } : { id: `send-${o.id}` }
      const op = o.valueProto === 'udp' ? 'net.udp.send' : o.valueProto === 'tcp' ? 'net.tcp.send' : 'net.serial.send'
      if (o.valueProto === 'tcp') ensure(o, 'tcp')
      if (o.valueProto === 'serial') ensure(o, 'serial')
      if (typeof b === 'string') sendText(o, op, args, b)
      else sendBytes(o, op, args, b)
    }
  }
}

// Closes what an output opened (when it is switched off or removed).
export function closeOutput(id: string) {
  if (opened.has(id)) { void rico.send('net.close', { id: `send-${id}` }); opened.delete(id) }
  sockets.get(id)?.close()
  sockets.delete(id)
  lastValues.delete(id)
}

// Tests an output once, even when it is off.
export function sendOnce(o: Output) { if (o.kind === 'pixels') sendPixels(o); else { lastValues.delete(o.id); sendValues({ ...o, onlyChanges: false }) } }

let started = false
export function startSends() {
  if (started) return
  started = true
  let wasOn = new Set<string>()
  window.setInterval(() => {
    const now = performance.now()
    const on = new Set<string>()
    for (const o of outputs) {
      if (!o.on) continue
      on.add(o.id)
      const every = 1000 / Math.max(1, Math.min(120, o.fps))
      if (now - (last.get(o.id) ?? 0) < every - 2) continue
      last.set(o.id, now)
      try { if (o.kind === 'pixels') sendPixels(o); else sendValues(o) } catch (e) { fail(o, (e as Error).message) }
    }
    for (const id of wasOn) if (!on.has(id)) closeOutput(id)
    wasOn = on
  }, 8)
  window.setInterval(() => {
    for (const o of outputs) { const l = live.get(o.id) ?? { rate: 0, error: '' }; l.rate = counts.get(o.id) ?? 0; live.set(o.id, l) }
    counts.clear()
  }, 1000)
}
