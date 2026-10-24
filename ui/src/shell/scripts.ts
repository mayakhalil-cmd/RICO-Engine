import { useSyncExternalStore } from 'react'
import { rico } from '../engine/connection'
import { putSignal, readSignal } from '../engine/signals'
import { dropPicture, putPicture } from '../engine/shared'
import type { LogEntry, NetEvent } from '../engine/types'

// Script panels: small JavaScript programs that live inside a workspace.
//
// They are how you add a protocol RICO does not know yet. A script can open
// raw UDP, TCP and serial ports, send OSC anywhere, read every signal RICO
// has, make its own signals for Create, and draw a few controls. When you
// export a workspace, its scripts go with it.

export interface Script {
  id: string
  name: string
  code: string
}

const KEY = 'rico.scripts'

function load(): Script[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

let scripts: Script[] = load()
let version = 0
const listeners = new Set<() => void>()

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(scripts))
  } catch {
    /* storage blocked: scripts last for this session */
  }
  version++
  listeners.forEach((l) => l())
}

export function useScripts(): Script[] {
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => version,
  )
  return scripts
}

export const getScriptList = () => scripts
export const getScript = (id: string) => scripts.find((s) => s.id === id)

export function putScript(s: Script) {
  const i = scripts.findIndex((x) => x.id === s.id)
  if (i >= 0) scripts = scripts.map((x) => (x.id === s.id ? s : x))
  else scripts = [...scripts, s]
  save()
}

export function newScript(name: string, code: string): Script {
  const s = { id: Math.random().toString(36).slice(2, 9), name, code }
  putScript(s)
  return s
}

export function removeScript(id: string) {
  scripts = scripts.filter((s) => s.id !== id)
  save()
}

// ---- running a script ------------------------------------------------------

type Data = string | number[] | Uint8Array
const toArgs = (d: Data) => (typeof d === 'string' ? { text: d } : { bytes: Array.from(d) })
const text = (bytes: number[]) => new TextDecoder().decode(new Uint8Array(bytes))

export interface ScriptOutput {
  log: (line: string, kind?: 'info' | 'error' | 'out') => void
  root: HTMLElement
}

const MIDI_TYPES = new Set(['CC', 'Note On', 'Note Off', 'Pitch Bend', 'Aftertouch', 'Program'])

// Runs a script. Returns a function that stops it and frees everything it
// opened: ports, timers, listeners and controls.
let running = 0
export const runningScripts = () => running

export function runScript(script: Script, out: ScriptOutput): () => void {
  running++
  const cleanups: (() => void)[] = []
  const ports = new Set<string>()
  let stopped = false
  const prefix = `${script.id}:`
  const fail = (e: unknown) => out.log(e instanceof Error ? e.message : String(e), 'error')
  const guard = <A extends unknown[]>(fn: (...a: A) => void) => (...a: A) => {
    if (stopped) return
    try {
      fn(...a)
    } catch (e) {
      fail(e)
    }
  }
  const send = async (op: string, args: Record<string, unknown>) => {
    const ack = await rico.send(op, args)
    if (!ack.ok) out.log(ack.error ?? `${op} did not work`, 'error')
    return ack
  }

  // Incoming raw data, routed to whichever port the script opened.
  const netHandlers = new Map<string, (e: NetEvent) => void>()
  cleanups.push(rico.onNet((e) => {
    if (!e.id.startsWith(prefix)) return
    netHandlers.get(e.id)?.(e)
  }))

  const logListeners: ((e: LogEntry) => void)[] = []
  cleanups.push(rico.onLive((live) => {
    for (const e of live.log) logListeners.forEach((l) => l(e))
  }))

  const open = (name: string) => {
    const id = prefix + name
    ports.add(id)
    return id
  }

  const signalName = (label: string) => `script:${script.name}/${label}`

  const api = {
    osc: {
      // To the main OSC app and every extra destination, like a mapping does.
      send: (address: string, value = 1) => void send('osc.send', { address, value: Number(value) }),
      // To any app on any port, with as many values as you like.
      sendTo: (host: string, port: number, address: string, ...args: (number | string | boolean)[]) =>
        void send('net.osc', { host, port, address, args }),
      on: (address: string, fn: (value: number, address: string) => void) => {
        const g = guard(fn)
        logListeners.push((e) => {
          if (e.type === 'OSC in' && (address === '*' || e.address === address || (address.endsWith('*') && e.address.startsWith(address.slice(0, -1))))) g(e.value, e.address)
        })
      },
    },
    midi: {
      send: (bytes: number[]) => void send('midi.send', { bytes }),
      cc: (channel: number, number: number, value: number) =>
        void send('midi.send', { bytes: [0xb0 + ((channel - 1) & 15), number & 127, Math.round(value <= 1 ? value * 127 : value) & 127] }),
      note: (channel: number, number: number, velocity = 100) =>
        void send('midi.send', { bytes: [(velocity > 0 ? 0x90 : 0x80) + ((channel - 1) & 15), number & 127, velocity & 127] }),
      on: (fn: (m: { type: string; channel: number; number: number; value: number }) => void) => {
        const g = guard(fn)
        logListeners.push((e) => {
          if (MIDI_TYPES.has(e.type)) g({ type: e.type, channel: e.ch, number: e.d1, value: e.d2 })
        })
      },
    },
    udp: {
      listen: (port: number, fn: (text: string, bytes: number[], from: string) => void) => {
        const id = open(`udp${port}`)
        netHandlers.set(id, guard((e: NetEvent) => fn(text(e.bytes), e.bytes, e.from)))
        void send('net.udp.open', { id, port })
      },
      send: (host: string, port: number, data: Data) => void send('net.udp.send', { host, port, ...toArgs(data) }),
    },
    tcp: {
      connect: (host: string, port: number, fn?: (text: string, bytes: number[]) => void) => {
        const id = open(`tcp-${host}-${port}`)
        netHandlers.set(id, guard((e: NetEvent) => {
          if (e.kind === 'closed') out.log(`${host}:${port} closed the connection.`)
          else fn?.(text(e.bytes), e.bytes)
        }))
        void send('net.tcp.connect', { id, host, port })
        return {
          send: (data: Data) => void send('net.tcp.send', { id, ...toArgs(data) }),
          close: () => void send('net.close', { id }),
        }
      },
    },
    serial: {
      list: async (): Promise<string[]> => ((await rico.send('net.serial.list')).ports as string[] | undefined) ?? [],
      open: (port: string, baud = 115200, fn?: (text: string, bytes: number[]) => void) => {
        const id = open(`serial-${port}`)
        netHandlers.set(id, guard((e: NetEvent) => {
          if (e.kind === 'closed') out.log(`${port} was unplugged.`)
          else fn?.(text(e.bytes), e.bytes)
        }))
        void send('net.serial.open', { id, port, baud })
        return {
          send: (data: Data) => void send('net.serial.send', { id, ...toArgs(data) }),
          close: () => void send('net.close', { id }),
        }
      },
    },
    dmx: { set: (channel: number, value: number) => void send('dmx.set', { channel, value }) },
    mqtt: { publish: (topic: string, payload: string | number) => void send('mqtt.publish', { topic, payload: String(payload) }) },
    audio: () => ({
      level: readSignal('audio:level'), low: readSignal('audio:low'), mid: readSignal('audio:mid'),
      high: readSignal('audio:high'), kick: readSignal('audio:kick'), snare: readSignal('audio:snare'),
    }),
    // Any signal by id: 'audio:low', 'midi:1:1:74', 'osc:/my/address', 'clock:beat'.
    read: (id: string) => readSignal(id),
    // Makes a signal you can link in Create, like a knob.
    signal: (name: string, value: number) => putSignal(signalName(name), `${script.name}: ${name}`, value),
    every: (ms: number, fn: () => void) => {
      const id = window.setInterval(guard(fn), Math.max(5, ms))
      cleanups.push(() => window.clearInterval(id))
    },
    after: (ms: number, fn: () => void) => {
      const id = window.setTimeout(guard(fn), ms)
      cleanups.push(() => window.clearTimeout(id))
    },
    frame: (fn: (dt: number, time: number) => void) => {
      let raf = 0, last = performance.now()
      const g = guard(fn)
      const loop = (now: number) => {
        g((now - last) / 1000, now / 1000)
        last = now
        raf = requestAnimationFrame(loop)
      }
      raf = requestAnimationFrame(loop)
      cleanups.push(() => cancelAnimationFrame(raf))
    },
    log: (...a: unknown[]) => out.log(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '), 'out'),
    // A picture this script draws, by name. Create ("Node picture" layer), 3D
    // materials and nodes ("Picture in") can all use it. Call show() after drawing.
    picture: (name: string, width = 1280, height = 720) => {
      const pic = putPicture(name, `script:${script.id}`)
      pic.canvas.width = width
      pic.canvas.height = height
      cleanups.push(() => dropPicture(name))
      const ctx = pic.canvas.getContext('2d')!
      return { ctx, width, height, show: () => { pic.version++ } }
    },
  }

  // ---- controls --------------------------------------------------------------

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, txt?: string) => {
    const e = document.createElement(tag)
    if (cls) e.className = cls
    if (txt !== undefined) e.textContent = txt
    return e
  }
  let parent: HTMLElement = out.root
  const add = (node: HTMLElement) => {
    parent.appendChild(node)
    return node
  }

  const ui = {
    title: (t: string) => { add(el('h3', 'script-title', t)) },
    label: (t: string) => {
      const p = add(el('p', 'script-label', t))
      return { set: (v: string | number) => { p.textContent = String(v) } }
    },
    slider: (label: string, opts: { min?: number; max?: number; value?: number; step?: number } = {}, fn?: (v: number) => void) => {
      const min = opts.min ?? 0, max = opts.max ?? 1
      const wrap = add(el('label', 'param'))
      const head = wrap.appendChild(el('span', 'param-head'))
      head.appendChild(el('span', 'param-label', label))
      const val = head.appendChild(el('span', 'param-value'))
      const input = wrap.appendChild(el('input', 'range')) as HTMLInputElement
      input.type = 'range'
      input.min = String(min)
      input.max = String(max)
      input.step = String(opts.step ?? (max - min) / 1000)
      input.value = String(opts.value ?? min)
      const g = fn ? guard(fn) : null
      const update = () => {
        const v = Number(input.value)
        val.textContent = Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)
        api.signal(label, (v - min) / (max - min || 1))
        g?.(v)
      }
      input.oninput = update
      update()
      return { get value() { return Number(input.value) }, set: (v: number) => { input.value = String(v); update() } }
    },
    button: (label: string, fn: () => void) => {
      const b = add(el('button', 'btn small', label)) as HTMLButtonElement
      b.onclick = guard(fn)
      return b
    },
    toggle: (label: string, on: boolean, fn: (on: boolean) => void) => {
      const wrap = add(el('label', 'switch'))
      const input = wrap.appendChild(el('input')) as HTMLInputElement
      input.type = 'checkbox'
      input.setAttribute('role', 'switch')
      input.checked = on
      wrap.appendChild(el('span', undefined, label))
      const g = guard(fn)
      input.onchange = () => {
        api.signal(label, input.checked ? 1 : 0)
        g(input.checked)
      }
      api.signal(label, on ? 1 : 0)
      return { get on() { return input.checked } }
    },
    text: (label: string, value: string, fn: (v: string) => void) => {
      const wrap = add(el('label', 'field'))
      wrap.appendChild(el('span', undefined, label))
      const input = wrap.appendChild(el('input', 'input')) as HTMLInputElement
      input.value = value
      input.spellcheck = false
      const g = guard(fn)
      input.onchange = () => g(input.value)
      return { get value() { return input.value } }
    },
    meter: (label: string) => {
      const wrap = add(el('div', 'script-meter'))
      wrap.appendChild(el('span', 'param-label', label))
      const bar = wrap.appendChild(el('div', 'meter'))
      const fill = bar.appendChild(el('i'))
      return { set: (v: number) => { fill.style.width = `${Math.max(0, Math.min(1, v)) * 100}%` } }
    },
    // A drawing area. onPointer gets x and y from 0 to 1, and what happened
    // ('down', 'move', 'up'), so a canvas can be a pad, a grid or a fader bank.
    canvas: (height = 160, onPointer?: (p: { x: number; y: number; type: 'down' | 'move' | 'up'; buttons: number }) => void) => {
      const c = add(el('canvas', 'script-canvas')) as HTMLCanvasElement
      // You draw on a 600 wide area; the pixels follow the real size on
      // screen and the screen's density, so it stays sharp at any size.
      c.width = 600
      c.height = height
      c.style.aspectRatio = `600 / ${height}`
      const sharp = () => {
        const dpr = Math.min(3, window.devicePixelRatio || 1)
        const cw = c.clientWidth || 600
        const w = Math.max(1, Math.round(cw * dpr)), h = Math.max(1, Math.round(((cw * height) / 600) * dpr))
        if (c.width === w && c.height === h) return
        c.width = w
        c.height = h
        c.getContext('2d')?.setTransform(w / 600, 0, 0, w / 600, 0, 0)
      }
      const ro = new ResizeObserver(sharp)
      ro.observe(c)
      cleanups.push(() => ro.disconnect())
      requestAnimationFrame(sharp)
      if (onPointer) {
        const g = guard(onPointer)
        c.style.touchAction = 'none'
        c.style.cursor = 'crosshair'
        const at = (e: PointerEvent, type: 'down' | 'move' | 'up') => {
          const r = c.getBoundingClientRect()
          g({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, type, buttons: e.buttons })
        }
        c.onpointerdown = (e) => { c.setPointerCapture(e.pointerId); at(e, 'down') }
        c.onpointermove = (e) => at(e, 'move')
        c.onpointerup = (e) => at(e, 'up')
      }
      return c.getContext('2d')!
    },
    select: (label: string, options: string[], value: string, fn: (v: string) => void) => {
      const wrap = add(el('label', 'field'))
      wrap.appendChild(el('span', undefined, label))
      const sel = wrap.appendChild(el('select', 'select')) as HTMLSelectElement
      for (const o of options) { const opt = sel.appendChild(el('option', undefined, o)) as HTMLOptionElement; opt.value = o }
      sel.value = value
      const g = guard(fn)
      sel.onchange = () => g(sel.value)
      return { get value() { return sel.value }, set: (v: string) => { sel.value = v } }
    },
    row: (build: () => void) => {
      const prev = parent
      parent = add(el('div', 'row wrap'))
      try {
        build()
      } finally {
        parent = prev
      }
    },
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function('rico', 'ui', `"use strict";\n${script.code}\n//# sourceURL=${script.name.replace(/\W/g, '_')}.js`)
    const result = fn(api, ui)
    if (typeof result === 'function') cleanups.push(result)
  } catch (e) {
    fail(e)
  }

  return () => {
    if (!stopped) running--
    stopped = true
    cleanups.forEach((c) => {
      try {
        c()
      } catch {
        /* already gone */
      }
    })
    ports.forEach((id) => void rico.send('net.close', { id }))
    out.root.replaceChildren()
  }
}

// ---- starting points ---------------------------------------------------------

export const TEMPLATES: { id: string; name: string; about: string; code: string }[] = [
  {
    id: 'blank',
    name: 'Blank',
    about: 'An empty script with the basics written out',
    code: `// A RICO script. It runs while this panel is open.
// Press Ctrl+Enter to run it again after a change.
//
// rico.osc.sendTo('127.0.0.1', 9000, '/hello', 1, 'text')
// rico.osc.on('/my/address', (value) => ...)
// rico.midi.cc(1, 74, 0.5)        rico.midi.on((m) => ...)
// rico.udp.listen(7000, (text, bytes, from) => ...)
// rico.udp.send('192.168.1.20', 7000, 'hello')
// const dev = rico.tcp.connect('192.168.1.30', 4352, (text) => ...)
// const pico = rico.serial.open('COM3', 115200, (text) => ...)
// rico.dmx.set(1, 0.5)            rico.mqtt.publish('room/light', 'on')
// rico.audio().low                rico.read('midi:1:1:74')
// rico.signal('My value', 0.5)    makes a signal you can link in Create
// rico.every(100, () => ...)      rico.frame((dt) => ...)
// ui.slider('Speed', { min: 0, max: 10 }, (v) => ...)
// ui.button('Go', () => ...)       ui.toggle('On', true, (on) => ...)
// ui.label('text')  ui.meter('Level')  ui.text('Host', 'x', (v) => ...)

ui.title('My protocol')
const status = ui.label('Ready.')
ui.button('Say hello', () => {
  rico.osc.sendTo('127.0.0.1', 9000, '/hello', 1)
  status.set('Sent /hello to port 9000.')
})
`,
  },
  {
    id: 'udp',
    name: 'UDP device',
    about: 'Listen on a port and send text or bytes back',
    code: `// Talks to a device that speaks plain UDP, like a media server, a show
// controller or a microcontroller on Wi-Fi.

const HOST = '127.0.0.1'
const PORT = 7000

ui.title('UDP device')
const last = ui.label('Nothing yet. Listening on port ' + PORT + '.')
const count = ui.meter('Activity')
let hits = 0

rico.udp.listen(PORT, (text, bytes, from) => {
  last.set(from + ': ' + text)
  hits = 1
  // Numbers that come in become a signal you can link in Create.
  const n = parseFloat(text)
  if (!Number.isNaN(n)) rico.signal('Incoming', n)
})

rico.frame(() => { hits *= 0.92; count.set(hits) })

const message = ui.text('Message', 'PLAY 1', () => {})
ui.button('Send', () => rico.udp.send(HOST, PORT, message.value))
`,
  },
  {
    id: 'serial',
    name: 'Serial LEDs',
    about: 'Send audio to a Pi Pico or Arduino over USB',
    code: `// Sends the low band of the audio to a board on a COM port, as a line of
// text like "L128". On the board, read a line and set your LEDs.

let pico = null
const port = ui.text('Port', 'COM3', () => {})
ui.row(() => {
  ui.button('Connect', () => {
    pico?.close()
    pico = rico.serial.open(port.value, 115200, (text) => rico.log('board:', text.trim()))
  })
  ui.button('Find ports', async () => rico.log('Ports:', (await rico.serial.list()).join(', ') || 'none'))
})
const gain = ui.slider('Gain', { min: 0, max: 3, value: 1.2 })
const level = ui.meter('Sent')

rico.every(33, () => {
  const v = Math.min(1, rico.audio().low * gain.value)
  level.set(v)
  pico?.send('L' + Math.round(v * 255) + '\\n')
})
`,
  },
  {
    id: 'tcp',
    name: 'Projector (TCP)',
    about: 'Turn a projector on and off with PJLink',
    code: `// PJLink is a TCP protocol most projectors understand (port 4352).
// Set the projector's address, then use the buttons or link them to pads
// with custom shortcuts.

const host = ui.text('Projector address', '192.168.1.50', () => {})
const status = ui.label('Not connected.')
let pj = null

ui.row(() => {
  ui.button('Connect', () => {
    pj = rico.tcp.connect(host.value, 4352, (text) => status.set(text.trim()))
  })
  ui.button('Power on', () => pj?.send('%1POWR 1\\r'))
  ui.button('Power off', () => pj?.send('%1POWR 0\\r'))
  ui.button('Shutter', () => pj?.send('%1AVMT 31\\r'))
})
`,
  },
  {
    id: 'euclid',
    name: 'Stress test: Euclid engine',
    about: 'Four rhythm tracks driving MIDI, OSC, DMX, signals and a picture at once, with UDP remote control',
    code: `// EUCLID ENGINE: a stress test for RICO scripts.
//
// Four Euclidean rhythm tracks drive everything at once:
//   - MIDI notes (one channel per track) with note offs
//   - OSC with several values per message, to any app
//   - a DMX chase over 16 channels that flashes and fades
//   - signals you can link in Create, 3D and Nodes ("Euclid: track 1"...)
//   - a picture called "Euclid" for Create (Node picture layer) and 3D (Picture material)
//   - remote control over UDP, OSC and MIDI, with a loopback self test
//   - a Flood slider that sends hundreds of extra OSC messages a second
//
// Click the rings to add or remove accents. Watch the numbers at the bottom:
// clock jitter, messages a second, and how long one frame of drawing takes.
//
// Remote control (UDP port 7400, plain text):
//   bpm 128          mute 2          rotate 1 3          hits 4 5
// OSC in: /euclid/bpm 140      MIDI in: CC 1 to 4 set the hits of tracks 1 to 4

const HOST = '127.0.0.1'
const OSC_PORT = 9000
const UDP_PORT = 7400
const DMX_START = 1

// ---- the tracks ----

const tracks = [
  { name: 'Kick',  steps: 16, hits: 4, rotate: 0, note: 36, ch: 10, color: '#3bff03', muted: false },
  { name: 'Snare', steps: 16, hits: 2, rotate: 4, note: 38, ch: 10, color: '#f820a0', muted: false },
  { name: 'Hat',   steps: 16, hits: 11, rotate: 0, note: 42, ch: 10, color: '#6f86ff', muted: false },
  { name: 'Bass',  steps: 13, hits: 5, rotate: 2, note: 33, ch: 2,  color: '#ffd23f', muted: false },
]
for (const t of tracks) { t.pattern = []; t.accents = new Set(); t.env = 0; t.pos = -1 }

// Spreads the hits over the steps as evenly as possible (the same rhythms
// as Bjorklund's method, found in a lot of world music).
function euclid(steps, hits, rotate) {
  hits = Math.max(0, Math.min(steps, hits))
  const out = []
  for (let i = 0; i < steps; i++) out.push((i * hits) % steps < hits ? 1 : 0)
  const r = ((rotate % steps) + steps) % steps
  return out.slice(steps - r).concat(out.slice(0, steps - r))
}
const rebuild = () => tracks.forEach((t) => { t.pattern = euclid(t.steps, t.hits, t.rotate) })
rebuild()

// ---- controls ----

ui.title('Euclid engine')
const bpm = ui.slider('Tempo (BPM)', { min: 40, max: 220, value: 124, step: 1 })
const swing = ui.slider('Swing', { min: 0, max: 0.5, value: 0.12 })
const flood = ui.slider('Flood (extra OSC a step)', { min: 0, max: 200, value: 0, step: 1 })
const target = ui.select('Send OSC to', ['127.0.0.1:9000', '127.0.0.1:7000', '127.0.0.1:8000'], \`\${HOST}:\${OSC_PORT}\`, () => {})
ui.row(() => {
  for (const t of tracks) {
    ui.toggle(t.name, true, (on) => { t.muted = !on })
  }
})
ui.row(() => {
  ui.button('Shuffle rhythms', () => {
    for (const t of tracks) { t.hits = 1 + Math.floor(Math.random() * (t.steps - 1)); t.rotate = Math.floor(Math.random() * t.steps) }
    rebuild()
  })
  ui.button('Loopback self test', () => {
    selfTest = { sent: performance.now(), got: 0 }
    rico.udp.send('127.0.0.1', UDP_PORT, 'ping ' + Math.round(selfTest.sent))
  })
  ui.button('All notes off', allOff)
})

// The rings. Click a step to add or remove an accent.
const view = ui.canvas(300, (p) => {
  if (p.type !== 'down') return
  const W = 600, H = 300
  const x = p.x * W, y = p.y * H
  tracks.forEach((t, i) => {
    const cx = 75 + i * 150, cy = 150
    const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy)
    if (d < 35 || d > 72) return
    let a = Math.atan2(dy, dx) + Math.PI / 2
    if (a < 0) a += Math.PI * 2
    const step = Math.floor((a / (Math.PI * 2)) * t.steps) % t.steps
    if (t.accents.has(step)) t.accents.delete(step)
    else t.accents.add(step)
  })
})
const stats = ui.label('Starting...')
const pic = rico.picture('Euclid', 960, 540)

// ---- sending ----

let sentCount = 0, sentLast = 0, rate = 0
let selfTest = null
const dmx = new Array(16).fill(0)
const dmxSent = new Array(16).fill(-1)

function oscOut(address, ...args) {
  const [host, port] = target.value.split(':')
  rico.osc.sendTo(host, Number(port), address, ...args)
  sentCount++
}

function hit(t, i, step) {
  const accent = t.accents.has(step)
  const vel = accent ? 127 : 80 + Math.floor(Math.random() * 30)
  t.env = accent ? 1 : 0.7
  rico.midi.note(t.ch, t.note, vel)
  rico.after(90, () => rico.midi.note(t.ch, t.note, 0))
  oscOut(\`/euclid/track/\${i + 1}\`, step, vel / 127, t.name, accent ? 1 : 0)
  // The chase: each hit lights the next fixture of this track's group of 4.
  const fixture = i * 4 + (step % 4)
  dmx[fixture] = 1
  sentCount += 2
}

function allOff() {
  for (const t of tracks) rico.midi.note(t.ch, t.note, 0)
  for (let c = 0; c < 16; c++) { dmx[c] = 0; dmxSent[c] = 0; rico.dmx.set(DMX_START + c, 0) }
}

// ---- remote control ----

rico.udp.listen(UDP_PORT, (text, bytes, from) => {
  const [cmd, a, b] = text.trim().split(/\\s+/)
  if (cmd === 'ping' && selfTest) {
    selfTest.got = performance.now()
    rico.log(\`Loopback: UDP came back in \${(selfTest.got - selfTest.sent).toFixed(1)} ms\`)
  } else if (cmd === 'bpm') bpm.set(Number(a))
  else if (cmd === 'mute') { const t = tracks[Number(a) - 1]; if (t) t.muted = !t.muted }
  else if (cmd === 'rotate') { const t = tracks[Number(a) - 1]; if (t) { t.rotate = Number(b) || 0; rebuild() } }
  else if (cmd === 'hits') { const t = tracks[Number(a) - 1]; if (t) { t.hits = Number(b) || 0; rebuild() } }
  else rico.log(\`From \${from}: \${text.trim()}\`)
})
rico.osc.on('/euclid/bpm', (v) => bpm.set(v))
rico.midi.on((m) => {
  if (m.type === 'CC' && m.number >= 1 && m.number <= 4) {
    const t = tracks[m.number - 1]
    t.hits = Math.round((m.value / 127) * t.steps)
    rebuild()
  }
})

// ---- the clock ----
// Checked every 5 ms against the real time, so the timing does not drift.

let step = 0
let next = performance.now() + 100
let jitter = 0
rico.every(5, () => {
  const now = performance.now()
  if (now < next) return
  jitter = jitter * 0.9 + Math.abs(now - next) * 0.1
  const sixteenth = 60000 / bpm.value / 4
  const swingMs = (step % 2 === 0 ? 1 : -1) * swing.value * sixteenth
  next += sixteenth + swingMs
  if (now - next > 200) next = now + sixteenth   // came back from a pause
  tracks.forEach((t, i) => {
    const s = step % t.steps
    t.pos = s
    if (!t.muted && t.pattern[s]) hit(t, i, s)
  })
  for (let k = 0; k < flood.value; k++) oscOut('/euclid/flood', k, step, Math.random())
  step++
})

// ---- every frame: fades, signals, DMX, drawing ----

rico.frame((dt, time) => {
  const t0 = performance.now()
  for (const t of tracks) {
    t.env = Math.max(0, t.env - dt * 4)
    rico.signal(\`track \${tracks.indexOf(t) + 1}\`, t.env)
  }
  for (let c = 0; c < 16; c++) {
    dmx[c] = Math.max(0, dmx[c] - dt * 3)
    const level = Math.round(dmx[c] * 255)
    if (level !== dmxSent[c]) { dmxSent[c] = level; rico.dmx.set(DMX_START + c, level / 255); sentCount++ }
  }
  if (time - sentLast >= 1) { rate = sentCount / (time - sentLast); sentCount = 0; sentLast = time }

  // The rings in the panel.
  view.fillStyle = '#000'
  view.fillRect(0, 0, 600, 300)
  tracks.forEach((t, i) => drawRing(view, 75 + i * 150, 150, 55, t))

  // The shared picture: bigger rings that pulse, for Create and 3D.
  const g = pic.ctx
  g.fillStyle = 'rgba(0, 0, 0, 0.25)'
  g.fillRect(0, 0, pic.width, pic.height)
  tracks.forEach((t, i) => {
    const r = 70 + t.env * 60
    drawRing(g, 150 + i * 220, 270, r, t)
  })
  pic.show()

  const drawMs = performance.now() - t0
  stats.set(\`\${bpm.value.toFixed(0)} BPM   jitter \${jitter.toFixed(2)} ms   \${rate.toFixed(0)} messages/s   frame \${drawMs.toFixed(2)} ms\`)
})

function drawRing(g, cx, cy, r, t) {
  g.save()
  g.lineWidth = 2
  for (let s = 0; s < t.steps; s++) {
    const a0 = (s / t.steps) * Math.PI * 2 - Math.PI / 2
    const a1 = ((s + 1) / t.steps) * Math.PI * 2 - Math.PI / 2 - 0.05
    g.beginPath()
    g.arc(cx, cy, r, a0, a1)
    const on = t.pattern[s], here = s === t.pos
    g.strokeStyle = here ? '#ffffff' : on ? t.color : '#1a4a08'
    g.lineWidth = on ? (t.accents.has(s) ? 12 : 7) : 2
    g.globalAlpha = t.muted ? 0.3 : 1
    g.stroke()
  }
  g.globalAlpha = 1
  g.fillStyle = t.color
  g.beginPath()
  g.arc(cx, cy, 6 + t.env * r * 0.4, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#fff'
  g.font = '14px "Courier Prime", monospace'
  g.textAlign = 'center'
  g.fillText(\`\${t.name} \${t.hits}/\${t.steps}\`, cx, cy + r + 24)
  g.restore()
}

// Stopping the script turns everything off.
return () => allOff()
`,
  },
  {
    id: 'osc',
    name: 'Custom OSC',
    about: 'Sliders that send OSC with several values',
    code: `// Sends a color as three values in one message, which apps like
// TouchDesigner and Resolume understand.

const host = ui.text('Host', '127.0.0.1', () => {})
const port = ui.text('Port', '9000', () => {})
const r = ui.slider('Red', { value: 1 })
const g = ui.slider('Green', { value: 0.2 })
const b = ui.slider('Blue', { value: 0.6 })

rico.every(33, () => {
  rico.osc.sendTo(host.value, Number(port.value), '/rico/color', r.value, g.value, b.value)
})
`,
  },
  {
    id: 'signals',
    name: 'Signal maker',
    about: 'Make new signals out of others, for Motion',
    code: `// Mixes signals into new ones. They show up in Motion under "Script"
// and in Learn, like any knob.

const amount = ui.slider('Mix', { value: 0.5 })
const out = ui.meter('Out')

rico.frame((dt, t) => {
  const a = rico.audio()
  const wobble = 0.5 + 0.5 * Math.sin(t * 2)
  const v = a.low * (1 - amount.value) + wobble * amount.value
  rico.signal('Bass wobble', v)
  out.set(v)
})
`,
  },
]
