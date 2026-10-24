import { rico } from '../engine/connection'
import { putSignal, readSignal } from '../engine/signals'
import { driven } from '../create/renderer'
import { runCommand } from '../shell/commands'

import { IN, OUT, clamp01, changed, n, rising, type NodeType } from './kit'

// The first family: numbers that move. Sources make values, the middle shapes them, outputs send them.

export const BASIC_TYPES: NodeType[] = [
  // sources
  {
    type: 'signal', name: 'Signal', group: 'Sources', about: 'Anything RICO hears: a knob, an OSC address, an audio band', inputs: [], outputs: OUT,
    params: [{ key: 'signal', label: 'From', kind: 'signal', default: '' }],
    run: (c) => ({ out: c.p.signal ? readSignal(String(c.p.signal)) : 0 }),
  },
  {
    type: 'slider', name: 'Slider', group: 'Sources', about: 'A value you set by hand', inputs: [], outputs: OUT,
    params: [n('value', 'Value', 0.5, 0, 1, 0.001)],
    run: (c) => ({ out: Number(c.p.value) }),
  },
  {
    type: 'constant', name: 'Number', group: 'Sources', about: 'A fixed number', inputs: [], outputs: OUT,
    params: [n('value', 'Value', 1)],
    run: (c) => ({ out: Number(c.p.value) }),
  },
  {
    type: 'lfo', name: 'LFO', group: 'Sources', about: 'A wave that goes up and down by itself',
    inputs: [{ key: 'rate', label: 'rate' }], outputs: OUT,
    params: [{ key: 'shape', label: 'Shape', kind: 'choice', default: 0, choices: ['Sine', 'Triangle', 'Saw', 'Square', 'Random'] }, n('rate', 'Speed (Hz)', 0.5, 0, 20, 0.01)],
    run: (c) => {
      const ph = (((c.state.ph as number) ?? 0) + c.dt * Math.max(0, c.in.rate)) % 1
      c.state.ph = ph
      const shape = Number(c.p.shape)
      let v = 0
      if (shape === 0) v = 0.5 - 0.5 * Math.cos(ph * Math.PI * 2)
      else if (shape === 1) v = 1 - Math.abs(ph * 2 - 1)
      else if (shape === 2) v = ph
      else if (shape === 3) v = ph < 0.5 ? 1 : 0
      else {
        const prev = (c.state.prevPh as number) ?? 0
        if (ph < prev) c.state.rnd = Math.random()
        c.state.prevPh = ph
        v = (c.state.rnd as number) ?? 0.5
      }
      return { out: v }
    },
  },
  {
    type: 'clock', name: 'Clock', group: 'Sources', about: 'Beats at a tempo', inputs: [],
    outputs: [{ key: 'beat', label: 'beat' }, { key: 'bar', label: 'bar' }, { key: 'pulse', label: 'pulse' }],
    params: [n('bpm', 'BPM', 120, 20, 300, 0.1)],
    run: (c) => {
      const beats = c.t * Number(c.p.bpm) / 60
      const beat = beats % 1
      return { beat, bar: (beats / 4) % 1, pulse: beat < 0.1 ? 1 : 0 }
    },
  },
  {
    type: 'noise', name: 'Wander', group: 'Sources', about: 'A smooth random value that drifts', inputs: [], outputs: OUT,
    params: [n('speed', 'Speed', 0.5, 0, 10, 0.01)],
    run: (c) => {
      const x = c.t * Number(c.p.speed) + c.id.length * 13.7
      const i = Math.floor(x), f = x - i
      const h = (k: number) => { const s = Math.sin(k * 127.1 + c.id.charCodeAt(0) * 3.1) * 43758.5453; return s - Math.floor(s) }
      const u = f * f * (3 - 2 * f)
      return { out: h(i) * (1 - u) + h(i + 1) * u }
    },
  },
  {
    type: 'time', name: 'Time', group: 'Sources', about: 'Seconds since RICO started', inputs: [], outputs: OUT, params: [],
    run: (c) => ({ out: c.t }),
  },

  // shape
  {
    type: 'map', name: 'Range', group: 'Shape', about: 'Turns one range into another, like 0..1 into 30..110',
    inputs: IN, outputs: OUT,
    params: [n('inMin', 'From low', 0), n('inMax', 'From high', 1), n('outMin', 'To low', 0), n('outMax', 'To high', 1), { key: 'clamp', label: 'Keep inside', kind: 'bool', default: true }],
    run: (c) => {
      const a = Number(c.p.inMin), b = Number(c.p.inMax)
      let t = (c.in.in - a) / (b - a || 1)
      if (c.p.clamp) t = clamp01(t)
      return { out: Number(c.p.outMin) + t * (Number(c.p.outMax) - Number(c.p.outMin)) }
    },
  },
  {
    type: 'smooth', name: 'Smooth', group: 'Shape', about: 'Takes the jumps out', inputs: IN, outputs: OUT,
    params: [n('amount', 'Amount', 0.8, 0, 0.995, 0.001)],
    run: (c) => {
      const prev = (c.state.v as number) ?? c.in.in
      const k = Math.pow(Number(c.p.amount), c.dt * 60)
      const v = prev * k + c.in.in * (1 - k)
      c.state.v = v
      return { out: v }
    },
  },
  {
    type: 'math', name: 'Math', group: 'Shape', about: 'Add, subtract, multiply, divide, min, max, power',
    inputs: [{ key: 'a', label: 'a' }, { key: 'b', label: 'b' }], outputs: OUT,
    params: [{ key: 'op', label: 'Do', kind: 'choice', default: 2, choices: ['a + b', 'a - b', 'a x b', 'a / b', 'smaller', 'bigger', 'a ^ b', 'average'] }, n('a', 'a', 0), n('b', 'b', 1)],
    run: (c) => {
      const { a, b } = c.in
      const op = Number(c.p.op)
      const out = [a + b, a - b, a * b, b === 0 ? 0 : a / b, Math.min(a, b), Math.max(a, b), Math.pow(Math.abs(a), b), (a + b) / 2][op] ?? 0
      return { out }
    },
  },
  {
    type: 'mix', name: 'Mix', group: 'Shape', about: 'Blends between two values', inputs: [{ key: 'a', label: 'a' }, { key: 'b', label: 'b' }, { key: 't', label: 'mix' }], outputs: OUT,
    params: [n('a', 'a', 0), n('b', 'b', 1), n('t', 'Mix', 0.5, 0, 1, 0.001)],
    run: (c) => ({ out: c.in.a + (c.in.b - c.in.a) * c.in.t }),
  },
  {
    type: 'invert', name: 'Flip', group: 'Shape', about: 'Turns 0 into 1 and 1 into 0', inputs: IN, outputs: OUT, params: [],
    run: (c) => ({ out: 1 - c.in.in }),
  },
  {
    type: 'curve', name: 'Curve', group: 'Shape', about: 'Eases a 0..1 value: slow start, slow end, or both', inputs: IN, outputs: OUT,
    params: [{ key: 'shape', label: 'Shape', kind: 'choice', default: 2, choices: ['Ease in', 'Ease out', 'Ease both', 'Steps'] }, n('steps', 'Steps', 4, 2, 32, 1)],
    run: (c) => {
      const x = clamp01(c.in.in)
      const s = Number(c.p.shape)
      const out = s === 0 ? x * x * x : s === 1 ? 1 - Math.pow(1 - x, 3) : s === 2 ? x * x * (3 - 2 * x) : Math.floor(x * Number(c.p.steps)) / (Number(c.p.steps) - 1 || 1)
      return { out }
    },
  },
  {
    type: 'expr', name: 'Expression', group: 'Shape', about: 'Your own formula with a, b, c and t, like sin(t * 2) * a',
    inputs: [{ key: 'a', label: 'a' }, { key: 'b', label: 'b' }, { key: 'c', label: 'c' }], outputs: OUT,
    params: [{ key: 'expr', label: 'Formula', kind: 'text', default: 'a * b' }, n('a', 'a', 0), n('b', 'b', 1), n('c', 'c', 0)],
    run: (c) => {
      const src = String(c.p.expr)
      if (c.state.src !== src) {
        c.state.src = src
        try {
          // eslint-disable-next-line @typescript-eslint/no-implied-eval
          c.state.fn = new Function('a', 'b', 'c', 't', `const {sin,cos,tan,abs,floor,ceil,round,min,max,pow,sqrt,exp,log,PI,random}=Math;const clamp=(x,l=0,h=1)=>min(h,max(l,x));return (${src});`) as (...a: number[]) => number
          c.state.err = 0
        } catch {
          c.state.fn = undefined
          c.state.err = 1
        }
      }
      const fn = c.state.fn as ((...a: number[]) => number) | undefined
      if (!fn) return { out: 0 }
      try {
        const v = Number(fn(c.in.a, c.in.b, c.in.c, c.t))
        return { out: Number.isFinite(v) ? v : 0 }
      } catch {
        return { out: 0 }
      }
    },
  },

  // logic
  {
    type: 'gate', name: 'Threshold', group: 'Logic', about: '1 when the value is over the line, 0 under it', inputs: IN, outputs: OUT,
    params: [n('level', 'Line', 0.5, 0, 1, 0.001)],
    run: (c) => ({ out: c.in.in > Number(c.p.level) ? 1 : 0 }),
  },
  {
    type: 'envelope', name: 'Envelope', group: 'Logic', about: 'A hit makes it jump up, then fall back down. Good for kicks and pads.',
    inputs: [{ key: 'in', label: 'hit' }], outputs: OUT,
    params: [n('attack', 'Rise (s)', 0.01, 0, 2, 0.001), n('release', 'Fall (s)', 0.4, 0.01, 5, 0.01)],
    run: (c) => {
      let v = (c.state.v as number) ?? 0
      if (rising(c, 'in', c.in.in)) c.state.up = 1
      if (c.state.up) {
        v += c.dt / Math.max(0.001, Number(c.p.attack))
        if (v >= 1) { v = 1; c.state.up = 0 }
      } else {
        v -= c.dt / Math.max(0.001, Number(c.p.release))
      }
      v = clamp01(v)
      c.state.v = v
      return { out: v }
    },
  },
  {
    type: 'toggle', name: 'Toggle', group: 'Logic', about: 'Each hit switches between 0 and 1', inputs: [{ key: 'in', label: 'hit' }], outputs: OUT, params: [],
    run: (c) => {
      if (rising(c, 'in', c.in.in)) c.state.on = c.state.on ? 0 : 1
      return { out: (c.state.on as number) ?? 0 }
    },
  },
  {
    type: 'counter', name: 'Counter', group: 'Logic', about: 'Counts hits and starts over at the end',
    inputs: [{ key: 'in', label: 'hit' }, { key: 'reset', label: 'reset' }], outputs: [{ key: 'count', label: 'count' }, { key: 'out', label: '0..1' }],
    params: [n('steps', 'Steps', 4, 2, 128, 1)],
    run: (c) => {
      const steps = Math.max(2, Number(c.p.steps))
      let k = (c.state.k as number) ?? 0
      if (rising(c, 'in', c.in.in)) k = (k + 1) % steps
      if (rising(c, 'reset', c.in.reset)) k = 0
      c.state.k = k
      return { count: k, out: k / (steps - 1) }
    },
  },
  {
    type: 'hold', name: 'Sample and hold', group: 'Logic', about: 'Grabs the value on each hit and keeps it',
    inputs: [{ key: 'in', label: 'in' }, { key: 'hit', label: 'hit' }], outputs: OUT, params: [],
    run: (c) => {
      if (rising(c, 'hit', c.in.hit)) c.state.v = c.in.in
      return { out: (c.state.v as number) ?? 0 }
    },
  },
  {
    type: 'change', name: 'On change', group: 'Logic', about: 'Gives a short hit every time the value changes', inputs: IN, outputs: OUT,
    params: [n('amount', 'Smallest change', 0.02, 0, 1, 0.001)],
    run: (c) => {
      const last = (c.state.last as number) ?? c.in.in
      const hit = Math.abs(c.in.in - last) > Number(c.p.amount)
      if (hit) c.state.last = c.in.in
      return { out: hit ? 1 : 0 }
    },
  },

  // outputs
  {
    type: 'osc-out', name: 'OSC out', group: 'Outputs', about: 'Sends to an app that listens for OSC', inputs: IN, outputs: [],
    params: [{ key: 'host', label: 'Computer', kind: 'text', default: '127.0.0.1' }, n('port', 'Port', 8000, 1, 65535, 1), { key: 'address', label: 'Address', kind: 'text', default: '/rico/node' }],
    run: (c) => {
      const addr = String(c.p.address)
      const throttle = (c.state.at as number) ?? 0
      if (addr.startsWith('/') && c.t - throttle > 1 / 120 && changed(c, c.in.in)) {
        c.state.at = c.t
        rico.send('net.osc', { host: String(c.p.host), port: Number(c.p.port), address: addr, args: [c.in.in] })
      }
    },
  },
  {
    type: 'midi-out', name: 'MIDI out', group: 'Outputs', about: 'A knob (CC) or a note on the MIDI output and virtual ports', inputs: IN, outputs: [],
    params: [{ key: 'kind', label: 'As', kind: 'choice', default: 0, choices: ['Knob (CC)', 'Note'] }, n('channel', 'Channel', 1, 1, 16, 1), n('number', 'Number', 20, 0, 127, 1)],
    run: (c) => {
      const ch = (Number(c.p.channel) - 1) & 15, num = Number(c.p.number) & 127
      if (Number(c.p.kind) === 0) {
        const v = Math.round(clamp01(c.in.in) * 127)
        if (changed(c, v, 0.5)) rico.send('midi.send', { bytes: [0xb0 + ch, num, v] })
      } else {
        const on = c.in.in > 0.5 ? 1 : 0
        if (changed(c, on, 0.5)) rico.send('midi.send', { bytes: [(on ? 0x90 : 0x80) + ch, num, on ? 100 : 0] })
      }
    },
  },
  {
    type: 'dmx-out', name: 'DMX out', group: 'Outputs', about: 'One Art-Net channel', inputs: IN, outputs: [],
    params: [n('channel', 'Channel', 1, 1, 512, 1)],
    run: (c) => {
      const v = clamp01(c.in.in)
      if (changed(c, v, 1 / 512)) rico.send('dmx.set', { channel: Number(c.p.channel), value: v })
    },
  },
  {
    type: 'mqtt-out', name: 'MQTT out', group: 'Outputs', about: 'A topic on your MQTT broker (10 times a second at most)', inputs: IN, outputs: [],
    params: [{ key: 'topic', label: 'Topic', kind: 'text', default: 'rico/node' }],
    run: (c) => {
      if (c.t - ((c.state.at as number) ?? -1) < 0.1) return
      if (changed(c, c.in.in, 0.001)) {
        c.state.at = c.t
        rico.send('mqtt.publish', { topic: String(c.p.topic), payload: c.in.in.toFixed(4) })
      }
    },
  },
  {
    type: 'create', name: 'Drive a setting', group: 'Outputs', about: 'Drives a setting of a Motion layer or a 3D object directly', inputs: IN, outputs: [],
    params: [{ key: 'target', label: 'Setting', kind: 'param', default: '' }],
    run: (c) => {
      const target = String(c.p.target)
      const prev = c.state.target as string | undefined
      if (prev && prev !== target) driven.delete(prev)
      c.state.target = target
      if (target) driven.set(target, c.in.in)
    },
  },
  {
    type: 'signal-out', name: 'Make a signal', group: 'Outputs', about: 'Becomes a signal you can link anywhere, like a knob', inputs: IN, outputs: [],
    params: [{ key: 'name', label: 'Name', kind: 'text', default: 'My signal' }],
    run: (c) => { putSignal(`node:${String(c.p.name)}`, `Nodes: ${String(c.p.name)}`, clamp01(c.in.in)) },
  },
  {
    type: 'command', name: 'Run command', group: 'Outputs', about: 'Runs any RICO command on a hit (next workspace, start video...)', inputs: [{ key: 'in', label: 'hit' }], outputs: [],
    params: [{ key: 'command', label: 'Command', kind: 'command', default: '' }],
    run: (c) => { if (rising(c, 'in', c.in.in) && c.p.command) runCommand(String(c.p.command)) },
  },
  {
    type: 'watch', name: 'Watch', group: 'Outputs', about: 'Shows the value and its recent history', inputs: IN, outputs: OUT, params: [],
    run: (c) => {
      const h = (c.state.h as number[] | undefined) ?? []
      h.push(c.in.in)
      if (h.length > 90) h.shift()
      c.state.h = h
      return { out: c.in.in }
    },
  },
]

