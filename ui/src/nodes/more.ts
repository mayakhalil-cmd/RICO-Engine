import { rico } from '../engine/connection'
import { readSignal } from '../engine/signals'
import { clamp01, changed, n, rising, type NodeType, type Port } from './kit'

// Events and logic, data (text and tables), and direct ins and outs for every protocol.

const T = (key: string, label = key): Port => ({ key, label })
const pulse = (c: { state: Record<string, unknown> }, key: string) => {
  // A trigger lasts one step: 1 now, 0 next time.
  c.state[`pulse_${key}`] = 1
}
const takePulse = (c: { state: Record<string, unknown> }, key: string) => {
  const v = c.state[`pulse_${key}`] ? 1 : 0
  c.state[`pulse_${key}`] = 0
  return v
}

// Keys held down, for the Key node.
const keys = new Set<string>()
const pressed = new Set<string>()
window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).closest?.('input, textarea, select, [contenteditable]') || e.ctrlKey || e.metaKey) return
  const k = e.key.toUpperCase()
  if (!keys.has(k)) pressed.add(k)
  keys.add(k)
})
window.addEventListener('keyup', (e) => keys.delete(e.key.toUpperCase()))
window.addEventListener('blur', () => keys.clear())

// OSC messages that came in since the last step, by address.
const oscIn = new Map<string, { value: number; at: number; args: number[] }>()
rico.onLive((live) => {
  for (const e of live.log) if (e.type === 'OSC in' && e.address) oscIn.set(e.address, { value: e.value, at: performance.now(), args: [e.value] })
})

export const MORE_TYPES: NodeType[] = [
  // ---- events (Max, Blueprint) ----
  {
    type: 'button', name: 'Button', group: 'Events', about: 'Click it to send a hit', inputs: [], outputs: [T('out', 'hit')], params: [], ui: 'button',
    run: (c) => ({ out: c.state.click ? (c.state.click = 0, 1) : 0 }),
  },
  {
    type: 'start', name: 'On start', group: 'Events', about: 'One hit when the network starts', inputs: [], outputs: [T('out', 'hit')], params: [],
    run: (c) => {
      if (c.state.done) return { out: 0 }
      c.state.done = 1
      return { out: 1 }
    },
  },
  {
    type: 'metro', name: 'Metro', group: 'Events', about: 'A hit every so often, like a metronome', inputs: [T('on'), T('ms', 'every ms')], outputs: [T('out', 'hit')],
    params: [{ key: 'on', label: 'On', kind: 'bool', default: true }, n('ms', 'Every (ms)', 500, 5, 10000, 1)],
    run: (c) => {
      if (Number(c.in.on) <= 0.5) { c.state.acc = 0; return { out: 0 } }
      const ms = Math.max(5, Number(c.in.ms) || 500)
      c.state.acc = (c.state.acc ?? 0) + c.dt * 1000
      if (c.state.acc >= ms) { c.state.acc %= ms; return { out: 1 } }
      return { out: 0 }
    },
  },
  {
    type: 'delay', name: 'Delay', group: 'Events', about: 'Passes a hit on later', inputs: [T('in', 'hit')], outputs: [T('out', 'hit')], params: [n('ms', 'After (ms)', 250, 0, 20000, 1)],
    run: (c) => {
      const queue = (c.state.q ?? []) as number[]
      if (rising(c, 'in', c.in.in)) queue.push(c.t + Number(c.p.ms) / 1000)
      let out = 0
      while (queue.length && queue[0] <= c.t) { queue.shift(); out = 1 }
      c.state.q = queue
      return { out }
    },
  },
  {
    type: 'line', name: 'Line', group: 'Events', about: 'Glides to each new value over time', inputs: [T('in', 'to')], outputs: [T('out')],
    params: [n('ms', 'Over (ms)', 500, 0, 20000, 1), { key: 'shape', label: 'Shape', kind: 'choice', default: 1, choices: ['Straight', 'Smooth', 'Bounce'] }],
    run: (c) => {
      const target = Number(c.in.in) || 0
      if (c.state.target !== target) { c.state.from = c.state.v ?? target; c.state.target = target; c.state.start = c.t }
      const dur = Math.max(0.001, Number(c.p.ms) / 1000)
      let u = Math.min(1, (c.t - (c.state.start ?? 0)) / dur)
      const s = Number(c.p.shape)
      if (s === 1) u = u * u * (3 - 2 * u)
      else if (s === 2) u = 1 - Math.abs(Math.cos(u * Math.PI * 2.5)) * (1 - u)
      const v = (c.state.from ?? target) + (target - (c.state.from ?? target)) * u
      c.state.v = v
      return { out: v }
    },
  },
  {
    type: 'random', name: 'Random', group: 'Events', about: 'A new random number on each hit', inputs: [T('in', 'hit')], outputs: [T('out')],
    params: [n('min', 'From', 0), n('max', 'To', 1), { key: 'whole', label: 'Whole numbers', kind: 'bool', default: false }],
    run: (c) => {
      if (rising(c, 'in', c.in.in) || c.state.v === undefined) {
        const v = Number(c.p.min) + Math.random() * (Number(c.p.max) - Number(c.p.min))
        c.state.v = c.p.whole ? Math.round(v) : v
      }
      return { out: c.state.v }
    },
  },
  {
    type: 'branch', name: 'Branch', group: 'Events', about: 'A hit goes to yes or no, depending on the condition',
    inputs: [T('in', 'hit'), T('if', 'condition')], outputs: [T('yes'), T('no')], params: [n('if', 'Condition', 1, 0, 1, 1)],
    run: (c) => {
      if (!rising(c, 'in', c.in.in)) return { yes: 0, no: 0 }
      return Number(c.in.if) > 0.5 ? { yes: 1, no: 0 } : { yes: 0, no: 1 }
    },
  },
  {
    type: 'sequence', name: 'Sequence', group: 'Events', about: 'One hit becomes hits on each output, one after the other', inputs: [T('in', 'hit')],
    outputs: [T('a', '1'), T('b', '2'), T('c', '3'), T('d', '4')], params: [n('ms', 'Gap (ms)', 0, 0, 5000, 1)],
    run: (c) => {
      if (rising(c, 'in', c.in.in)) c.state.next = { i: 0, at: c.t }
      const s = c.state.next as { i: number; at: number } | undefined
      const out = { a: 0, b: 0, c: 0, d: 0 } as Record<string, number>
      if (s && s.i < 4 && c.t >= s.at) {
        out['abcd'[s.i]] = 1
        s.i++
        s.at = c.t + Number(c.p.ms) / 1000
      }
      return out
    },
  },
  {
    type: 'gate', name: 'Gate', group: 'Events', about: 'Lets values through only while it is open', inputs: [T('in'), T('open')], outputs: [T('out')],
    params: [n('open', 'Open', 1, 0, 1, 1), { key: 'hold', label: 'Keep last value when closed', kind: 'bool', default: true }],
    run: (c) => {
      if (Number(c.in.open) > 0.5) c.state.v = c.in.in
      else if (!c.p.hold) c.state.v = 0
      return { out: c.state.v ?? 0 }
    },
  },
  {
    type: 'select', name: 'Select', group: 'Events', about: 'A hit when the value matches 1, 2, 3 or 4', inputs: [T('in')],
    outputs: [T('a', '= A'), T('b', '= B'), T('c', '= C'), T('d', '= D'), T('other')],
    params: [n('a', 'A', 0), n('b', 'B', 1), n('c', 'C', 2), n('d', 'D', 3)],
    run: (c) => {
      const v = Math.round(Number(c.in.in) * 1000) / 1000
      if (v === c.state.last) return { a: 0, b: 0, c: 0, d: 0, other: 0 }
      c.state.last = v
      const out = { a: 0, b: 0, c: 0, d: 0, other: 1 } as Record<string, number>
      for (const k of ['a', 'b', 'c', 'd']) if (v === Number(c.p[k])) { out[k] = 1; out.other = 0 }
      return out
    },
  },
  {
    type: 'key', name: 'Key', group: 'Events', about: 'A key on the keyboard: 1 while you hold it, and a hit when you press it', inputs: [],
    outputs: [T('held'), T('hit')], params: [{ key: 'key', label: 'Key', kind: 'text', default: 'SPACE' }],
    run: (c) => {
      const k = String(c.p.key).toUpperCase().replace('SPACE', ' ')
      const hit = pressed.has(k) ? 1 : 0
      if (hit) pressed.delete(k)
      return { held: keys.has(k) ? 1 : 0, hit }
    },
  },
  {
    type: 'print', name: 'Print', group: 'Events', about: 'Writes values down as they change, to see what is happening', inputs: [T('in')], outputs: [], params: [], ui: 'log',
    run: (c) => {
      const v = c.in.in
      const text = typeof v === 'number' ? v.toFixed(3) : Array.isArray(v) ? `[${v.map((x) => Number(x).toFixed(2)).join(', ')}]` : String(v ?? '')
      if (text === c.state.lastText) return
      c.state.lastText = text
      const lines = ((c.state.lines ?? []) as string[]).slice(-5)
      lines.push(text)
      c.state.lines = lines
    },
  },

  // ---- lists ----
  {
    type: 'pack', name: 'Pack', group: 'Data', about: 'Puts up to four values into one list', inputs: [T('a'), T('b'), T('c'), T('d')],
    outputs: [{ key: 'out', label: 'list', type: 'list' }], params: [n('count', 'How many', 2, 1, 4, 1), n('a', 'a', 0), n('b', 'b', 0), n('c', 'c', 0), n('d', 'd', 0)],
    run: (c) => ({ out: [c.in.a, c.in.b, c.in.c, c.in.d].slice(0, Math.max(1, Math.min(4, Number(c.p.count)))).map(Number) }),
  },
  {
    type: 'unpack', name: 'Unpack', group: 'Data', about: 'Splits a list into values', inputs: [{ key: 'in', label: 'list', type: 'list' }],
    outputs: [T('a'), T('b'), T('c'), T('d'), T('size')], params: [],
    run: (c) => {
      const l = Array.isArray(c.in.in) ? c.in.in : []
      return { a: l[0] ?? 0, b: l[1] ?? 0, c: l[2] ?? 0, d: l[3] ?? 0, size: l.length }
    },
  },

  // ---- data (DATs) ----
  {
    type: 'text', name: 'Text', group: 'Data', about: 'A piece of text, with {a} and {b} filled in', inputs: [T('a'), T('b')], outputs: [{ key: 'out', label: 'text', type: 'text' }],
    params: [{ key: 'text', label: 'Text', kind: 'text', default: 'Value {a}' }, n('a', 'a', 0), n('b', 'b', 0)],
    run: (c) => {
      const fmt = (v: unknown) => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : String(v ?? ''))
      return { out: String(c.p.text).replace(/\{a\}/g, fmt(c.in.a)).replace(/\{b\}/g, fmt(c.in.b)) }
    },
  },
  {
    type: 'table', name: 'Table', group: 'Data', about: 'Rows and columns of numbers or words. Pick a cell by row and column',
    inputs: [T('row'), T('col', 'column')], outputs: [T('out', 'number'), { key: 'text', label: 'text', type: 'text' }, T('rows')],
    params: [{ key: 'data', label: 'Rows (one per line, commas between)', kind: 'code', default: 'red, 1, 0, 0\ngreen, 0, 1, 0\nblue, 0, 0, 1' }, n('row', 'Row', 0, 0, 1000, 1), n('col', 'Column', 1, 0, 100, 1)],
    ui: 'table',
    run: (c) => {
      const src = String(c.p.data)
      if (c.state.src !== src) { c.state.src = src; c.state.rows = src.split('\n').map((l) => l.split(',').map((x) => x.trim())) }
      const rows = c.state.rows as string[][]
      const r = rows[Math.max(0, Math.min(rows.length - 1, Math.floor(Number(c.in.row))))] ?? []
      const cell = r[Math.max(0, Math.floor(Number(c.in.col)))] ?? ''
      return { out: Number(cell) || 0, text: cell, rows: rows.length }
    },
  },
  {
    type: 'json', name: 'JSON', group: 'Data', about: 'Reads a number from JSON text, like data.temperature', inputs: [{ key: 'in', label: 'text', type: 'text' }],
    outputs: [T('out')], params: [{ key: 'path', label: 'Path', kind: 'text', default: 'value' }],
    run: (c) => {
      const text = String(c.in.in ?? '')
      if (text !== c.state.text) {
        c.state.text = text
        try {
          let v: unknown = JSON.parse(text)
          for (const part of String(c.p.path).split('.').filter(Boolean)) v = (v as Record<string, unknown>)?.[part]
          c.state.v = Number(v) || 0
        } catch {
          c.state.v = 0
        }
      }
      return { out: c.state.v ?? 0 }
    },
  },

  // ---- ins ----
  {
    type: 'osc-in', name: 'OSC in', group: 'Sources', about: 'The value of an OSC address coming in, and a hit for each message', inputs: [],
    outputs: [T('out'), T('hit')], params: [{ key: 'address', label: 'Address', kind: 'text', default: '/fader/1' }],
    run: (c) => {
      const m = oscIn.get(String(c.p.address))
      const hit = m && m.at !== c.state.at ? 1 : 0
      if (m) c.state.at = m.at
      return { out: m?.value ?? 0, hit }
    },
  },
  {
    type: 'midi-in', name: 'MIDI in', group: 'Sources', about: 'A knob or a note from any MIDI controller', inputs: [], outputs: [T('out'), T('hit')],
    params: [{ key: 'kind', label: 'Kind', kind: 'choice', default: 1, choices: ['Note', 'Knob (CC)'] }, n('channel', 'Channel', 1, 1, 16, 1), n('number', 'Number', 1, 0, 127, 1)],
    run: (c) => {
      const v = readSignal(`midi:${Number(c.p.kind) === 0 ? 0 : 1}:${c.p.channel}:${c.p.number}`)
      return { out: v, hit: rising(c, 'v', v) ? 1 : 0 }
    },
  },
  {
    type: 'audio', name: 'Audio', group: 'Sources', about: 'Every band of the sound your computer plays', inputs: [],
    outputs: [T('level'), T('low'), T('mid'), T('high'), T('kick'), T('snare')], params: [],
    run: () => ({
      level: readSignal('audio:level'), low: readSignal('audio:low'), mid: readSignal('audio:mid'),
      high: readSignal('audio:high'), kick: readSignal('audio:kick'), snare: readSignal('audio:snare'),
    }),
  },

  // ---- outs ----
  {
    type: 'osc-list-out', name: 'OSC message', group: 'Outputs', about: 'Sends a list, or text, as one OSC message with many values',
    inputs: [{ key: 'in', label: 'list', type: 'list' }, { key: 'text', label: 'text', type: 'text' }, T('send', 'hit')], outputs: [],
    params: [{ key: 'host', label: 'Computer', kind: 'text', default: '127.0.0.1' }, n('port', 'Port', 8000, 1, 65535, 1), { key: 'address', label: 'Address', kind: 'text', default: '/rico/list' },
      { key: 'when', label: 'Send', kind: 'choice', default: 0, choices: ['When it changes', 'On a hit only'] }],
    run: (c) => {
      const list = Array.isArray(c.in.in) ? c.in.in : []
      const args: (number | string)[] = [...list.map(Number), ...(c.in.text ? [String(c.in.text)] : [])]
      const key = JSON.stringify(args)
      const hit = rising(c, 'send', Number(c.in.send))
      if (Number(c.p.when) === 1 ? !hit : key === c.state.key) return
      c.state.key = key
      if (String(c.p.address).startsWith('/')) rico.send('net.osc', { host: String(c.p.host), port: Number(c.p.port), address: String(c.p.address), args })
    },
  },
  {
    type: 'dmx-many', name: 'DMX fixture', group: 'Outputs', about: 'Several DMX channels in a row, like the red, green and blue of one light',
    inputs: [T('a', 'ch 1'), T('b', 'ch 2'), T('c', 'ch 3'), T('d', 'ch 4')], outputs: [],
    params: [n('first', 'First channel', 1, 1, 509, 1), n('count', 'Channels', 3, 1, 4, 1)],
    run: (c) => {
      const count = Math.max(1, Math.min(4, Number(c.p.count)))
      ;['a', 'b', 'c', 'd'].slice(0, count).forEach((k, i) => {
        const v = clamp01(Number(c.in[k]) || 0)
        const last = c.state[`s${k}`] as number | undefined
        if (last === undefined || Math.abs(last - v) > 1 / 512) {
          c.state[`s${k}`] = v
          rico.send('dmx.set', { channel: Number(c.p.first) + i, value: v })
        }
      })
    },
  },
  {
    type: 'serial-out', name: 'Serial out', group: 'Outputs', about: 'Writes a line of text to a board on a COM port, like L128 for LEDs',
    inputs: [T('in'), { key: 'text', label: 'text', type: 'text' }], outputs: [],
    params: [{ key: 'port', label: 'Port', kind: 'text', default: 'COM3' }, n('baud', 'Speed', 115200, 300, 2000000, 1), { key: 'format', label: 'Line', kind: 'text', default: 'L{v}' }, n('scale', 'Value times', 255, 0, 65535, 1)],
    run: (c) => {
      const id = `node-serial-${c.id}`
      const port = String(c.p.port)
      if (c.state.port !== port) {
        c.state.port = port
        rico.send('net.serial.open', { id, port, baud: Number(c.p.baud) })
      }
      const v = Math.round((Number(c.in.in) || 0) * Number(c.p.scale))
      const line = c.in.text ? String(c.in.text) : String(c.p.format).replace('{v}', String(v))
      if (line === c.state.line || c.t - (c.state.at ?? -1) < 1 / 60) return
      c.state.line = line
      c.state.at = c.t
      rico.send('net.serial.send', { id, text: `${line}\n` })
    },
    release: (_s, id) => { rico.send('net.close', { id: `node-serial-${id}` }) },
  },
  {
    type: 'udp-out', name: 'UDP out', group: 'Outputs', about: 'Sends text to any device that listens for UDP', inputs: [{ key: 'text', label: 'text', type: 'text' }, T('send', 'hit')], outputs: [],
    params: [{ key: 'host', label: 'Computer', kind: 'text', default: '127.0.0.1' }, n('port', 'Port', 7000, 1, 65535, 1), { key: 'when', label: 'Send', kind: 'choice', default: 0, choices: ['When it changes', 'On a hit only'] }],
    run: (c) => {
      const text = String(c.in.text ?? '')
      const hit = rising(c, 'send', Number(c.in.send))
      if (Number(c.p.when) === 1 ? !hit : text === c.state.text || !text) return
      c.state.text = text
      rico.send('net.udp.send', { host: String(c.p.host), port: Number(c.p.port), text })
    },
  },
]

export { pulse, takePulse, changed }
