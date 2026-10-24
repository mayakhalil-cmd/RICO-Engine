import type { Ack, EngineState, LiveState, LogEntry, Mapping } from './types'

// A pretend RICO engine. It is used when the interface is opened without
// the app (while designing it, or on the website), so every screen can be
// tried with moving data. Nothing here touches real devices.

type Emit = (msg: { t: string } & Record<string, unknown>) => void

const PRESETS = [
  ['Unreal Engine', '/game', 8000, 'OSC plugin in Unreal: OSC server listening on port 8000.'],
  ['Unity', '/unity', 8001, 'OSC Jack or extOSC listening on port 8001.'],
  ['Ableton Live', '/live', 9000, 'Max for Live OSC device on port 9000.'],
  ['Logic Pro', '/logic', 8002, 'OSC control surface on port 8002.'],
  ['TouchDesigner', '/td', 9001, 'OSC In CHOP on port 9001.'],
  ['Max/MSP', '/max', 7400, 'udpreceive 7400.'],
  ['Reaper', '/reaper', 8003, 'OSC control surface on port 8003.'],
  ['VCV Rack', '/vcv', 8004, 'OSC-CV module on port 8004.'],
  ['Bitwig Studio', '/bitwig', 8005, 'OSC controller script on port 8005.'],
  ['Custom', '/custom', 8000, 'Any app that speaks OSC.'],
] as const

function time() {
  const d = new Date()
  return d.toTimeString().slice(0, 8)
}

export class DemoEngine {
  private state: EngineState
  private serial = 0
  private pendingLog: LogEntry[] = []
  private values: Record<string, number> = {}
  private notes = new Set<number>()
  private t0 = performance.now()
  private timers: number[] = []
  private emit: Emit
  private udpPorts = new Map<number, string>()

  constructor(emit: Emit) {
    this.emit = emit
    const mappings: Mapping[] = [
      { key: '1:1:74', type: 'cc', channel: 1, number: 74, name: 'Cutoff knob', address: '/game/light/intensity', min: 0, max: 1, momentary: false },
      { key: '1:1:71', type: 'cc', channel: 1, number: 71, name: 'Resonance knob', address: '/game/camera/fov', min: 30, max: 110, momentary: false },
      { key: '1:1:1', type: 'cc', channel: 1, number: 1, name: 'Mod wheel', address: '/game/fog/density', min: 0, max: 1, momentary: false },
      { key: '0:10:36', type: 'note', channel: 10, number: 36, name: 'Pad 1', address: '/game/trigger/burst', min: 0, max: 1, momentary: true },
      { key: '0:10:38', type: 'note', channel: 10, number: 38, name: 'Pad 2', address: '/game/trigger/flash', min: 0, max: 1, momentary: true },
    ]
    this.state = {
      midi: {
        backend: 1,
        backends: ['Classic Windows MIDI', 'Windows MIDI Services'],
        inputs: ['Twin Ctrl (Pico)', 'Launch Control XL', 'RICO Port'],
        outputs: ['Microsoft GS Wavetable Synth', 'RICO Port'],
        inIndex: 0,
        outIndex: -1,
        inOpen: true,
        outOpen: false,
        thru: false,
        autoConnect: true,
        virtualPorts: ['RICO Port'],
        windowsMidi: { compiled: true, ready: true, status: 'Ready' },
      },
      osc: {
        ip: '127.0.0.1',
        port: 8000,
        listenPort: 9000,
        address: '/game',
        sendToOSC: true,
        oscToMidi: false,
        listening: true,
        preset: 0,
        presets: PRESETS.map(([name, address, port, about], index) => ({ index, name, address, port, about, setup: '' })),
        destinations: [
          { name: 'Blender', ip: '127.0.0.1', port: 9010, enabled: true },
          { name: 'Houdini', ip: '127.0.0.1', port: 9020, enabled: false },
        ],
        localIp: '192.168.1.24',
      },
      mappings,
      video: {
        transports: [
          { id: 'omt', name: 'OMT', builtIn: true, available: true, status: 'Ready', about: 'Open Media Transport. Open source network video, built into RICO.', homepage: 'https://github.com/openmediatransport' },
          { id: 'ndi', name: 'NDI', builtIn: false, available: false, status: 'NDI runtime not found. Install NDI Tools from ndi.video, then restart RICO.', about: 'Send and receive video over the network with NDI. Needs the free NDI runtime.', homepage: 'https://ndi.video/tools/' },
        ],
        pluginProblems: [],
        pluginFolder: 'D:\\RICO\\plugins\\',
        transport: 0,
        sending: false,
        source: 3,
        monitor: 0,
        name: 'RICO',
        width: 1280,
        height: 720,
        receiving: false,
        receivingFrom: '',
        receivedWidth: 0,
        receivedHeight: 0,
        sources: [],
        bridgeToSpout: false,
        bridgeName: 'RICO Network In',
        error: '',
        spout: { sending: false, name: 'RICO', senders: ['Blender Viewport', 'TouchDesigner'], receiving: false, receivingFrom: '' },
      },
      audio: { capturing: true, device: 'System Audio (Loopback)' },
      dmx: { running: false, ip: '255.255.255.255', universe: 0, channels: new Array(512).fill(0) },
      mqtt: {
        connected: true,
        broker: 'tcp://127.0.0.1:1883',
        status: 'Connected',
        messages: [
          { topic: 'rico/twinctrl/knob1', payload: '0.42' },
          { topic: 'rico/twinctrl/button', payload: '1' },
          { topic: 'rico/esp32/temp', payload: '23.5' },
        ],
      },
      app: { version: '3.0.0', dataFolder: 'D:\\RICO\\data\\', classic: false },
    }
  }

  start() {
    this.emit({ t: 'hello', version: '3.0.0-demo', engine: 'demo' })
    this.pushState()
    this.timers.push(window.setInterval(() => this.pushState(), 1000))
    this.timers.push(window.setInterval(() => this.tick(), 33))
  }

  private pushState() {
    this.emit({ t: 'state', ...structuredClone(this.state) })
  }

  private log(type: string, text: string, address = '', value = 0, ch = -1, d1 = -1, d2 = -1) {
    this.pendingLog.push({ n: ++this.serial, time: time(), type, text, address, value, ch, d1, d2 })
  }

  private midi(m: Mapping, raw: number) {
    const v = raw / 127
    this.values[m.key] = v
    const label = m.type === 'note' ? (raw > 0 ? 'Note On' : 'Note Off') : 'CC'
    this.log(label, `${label} Ch:${m.channel} ${m.number}:${raw}`, m.address, v, m.channel, m.number, raw)
    if (this.state.osc.sendToOSC) {
      const out = m.min + v * (m.max - m.min)
      this.log('OSC out', `Sent ${m.address}`, m.address, out)
    }
  }

  private tick() {
    const t = (performance.now() - this.t0) / 1000
    const [cutoff, reso, wheel, pad1, pad2] = this.state.mappings
    // A slow hand on two knobs
    if (Math.floor(t * 12) % 2 === 0 && cutoff) {
      const raw = Math.round(63 + 63 * Math.sin(t * 0.7))
      if (Math.round((this.values[cutoff.key] ?? 0) * 127) !== raw) this.midi(cutoff, raw)
    }
    if (reso && Math.random() < 0.08) this.midi(reso, Math.round(63 + 60 * Math.sin(t * 0.31 + 1)))
    if (wheel && Math.random() < 0.02) this.midi(wheel, Math.round(Math.random() * 127))
    // A beat on the pads
    const beat = Math.floor(t * 2)
    const phase = t * 2 - beat
    for (const [pad, every] of [[pad1, 1], [pad2, 2]] as const) {
      if (!pad) continue
      const on = beat % every === 0 && phase < 0.15
      const was = this.notes.has(pad.number)
      if (on && !was) { this.notes.add(pad.number); this.midi(pad, 110) }
      if (!on && was) { this.notes.delete(pad.number); this.midi(pad, 0) }
    }
    if (Math.random() < 0.01) this.log('OSC in', 'Received: /blender/frame', '/blender/frame', Math.floor(t * 24) % 250)

    const kick = phase < 0.12 ? 1 - phase / 0.12 : 0
    const live: LiveState = {
      log: this.pendingLog,
      notes: [...this.notes],
      values: { ...this.values },
      audio: this.state.audio.capturing
        ? {
            low: 0.35 + 0.5 * kick + 0.1 * Math.sin(t * 3),
            mid: 0.4 + 0.25 * Math.sin(t * 1.7) * Math.sin(t * 5.1),
            high: 0.3 + 0.2 * Math.abs(Math.sin(t * 9.3)),
            level: 0.5 + 0.3 * kick,
            kick,
            snare: beat % 2 === 1 && phase < 0.1 ? 1 : 0,
          }
        : null,
      lfos: [
        { name: 'LFO 1', value: 0.5 + 0.5 * Math.sin(t * 2 * Math.PI * 0.25) },
        { name: 'LFO 2', value: (t * 0.5) % 1 },
      ],
      midiActive: this.pendingLog.length > 0,
    }
    this.pendingLog = []
    this.emit({ t: 'live', ...live })
  }

  command(op: string, a: Record<string, unknown>): Ack {
    const s = this.state
    const str = (k: string, d = '') => (typeof a[k] === 'string' ? (a[k] as string) : d)
    const num = (k: string, d = 0) => (typeof a[k] === 'number' ? (a[k] as number) : d)
    const on = Boolean(a.on)
    switch (op) {
      case 'midi.openIn': s.midi.inIndex = num('index'); s.midi.inOpen = true; break
      case 'midi.openOut': s.midi.outIndex = num('index'); s.midi.outOpen = true; break
      case 'midi.close': s.midi.inOpen = s.midi.outOpen = false; s.midi.inIndex = s.midi.outIndex = -1; break
      case 'midi.backend': s.midi.backend = num('index'); break
      case 'midi.thru': s.midi.thru = on; break
      case 'midi.autoConnect': s.midi.autoConnect = on; break
      case 'midi.virtual.create': {
        const name = str('name', 'RICO Port')
        if (!s.midi.virtualPorts.includes(name)) {
          s.midi.virtualPorts.push(name)
          s.midi.inputs.push(name)
          s.midi.outputs.push(name)
        }
        this.log('RICO', `Virtual port ready: ${name}`)
        break
      }
      case 'midi.virtual.remove': {
        const name = str('name')
        s.midi.virtualPorts = s.midi.virtualPorts.filter((p) => p !== name)
        s.midi.inputs = s.midi.inputs.filter((p) => p !== name)
        s.midi.outputs = s.midi.outputs.filter((p) => p !== name)
        break
      }
      case 'midi.send': this.log('MIDI out', `Sent ${(a.bytes as number[]).join(' ')}`); break
      case 'midi.clock': this.log('MIDI out', a.on ? `Clock running at ${a.bpm} BPM` : 'Clock stopped'); return { ok: true, running: Boolean(a.on), bpm: Number(a.bpm) || 120 }
      case 'midi.panic': this.log('MIDI out', 'All notes off on every channel'); break
      case 'audio.devices': return { ok: true, devices: ['System Default (Loopback)', 'Microphone (demo)'] }
      case 'osc.target': s.osc.ip = str('ip', s.osc.ip); s.osc.port = num('port', s.osc.port); s.osc.address = str('address', s.osc.address); break
      case 'osc.preset': {
        const p = s.osc.presets[num('index')]
        if (p) { s.osc.preset = p.index; s.osc.port = p.port; s.osc.address = p.address }
        break
      }
      case 'osc.enabled': s.osc.sendToOSC = on; break
      case 'osc.toMidi': s.osc.oscToMidi = on; break
      case 'osc.dest.add': s.osc.destinations.push({ name: str('name', 'Destination'), ip: str('ip', '127.0.0.1'), port: num('port', 8000), enabled: true }); break
      case 'osc.dest.remove': s.osc.destinations.splice(num('index', -1), 1); break
      case 'osc.dest.enable': { const d = s.osc.destinations[num('index')]; if (d) d.enabled = on; break }
      case 'osc.send': this.log('OSC out', `Sent ${str('address')}`, str('address'), num('value')); break
      case 'mapping.update': {
        const m = s.mappings.find((x) => x.key === str('key'))
        if (!m) return { ok: false, error: 'No such mapping' }
        m.address = str('address', m.address); m.name = str('name', m.name); m.min = num('min', m.min); m.max = num('max', m.max)
        break
      }
      case 'mapping.add': {
        const type = num('type', 1), channel = num('channel', 1), number = num('number', 0)
        const key = `${type}:${channel}:${number}`
        const kinds: Mapping['type'][] = ['note', 'cc', 'pitchbend', 'program', 'aftertouch']
        const existing = s.mappings.find((m) => m.key === key)
        const m: Mapping = existing ?? { key, type: kinds[type] ?? 'cc', channel, number, name: '', address: '', min: 0, max: 1, momentary: type === 0 }
        m.name = str('name', m.name || `${kinds[type]} ${number}`)
        m.address = str('address', m.address || `${s.osc.address}/ctrl${s.mappings.length + 1}`)
        m.min = num('min', m.min); m.max = num('max', m.max)
        if (!existing) s.mappings.push(m)
        this.pushState()
        return { ok: true, key }
      }
      case 'mapping.set': {
        const m = s.mappings.find((x) => x.key === str('key'))
        if (!m) return { ok: false, error: 'No such mapping' }
        this.midi(m, Math.round(Math.max(0, Math.min(1, num('value'))) * 127))
        break
      }
      case 'mapping.remove': s.mappings = s.mappings.filter((m) => m.key !== str('key')); break
      case 'mapping.clear': s.mappings = []; break
      case 'video.transport': {
        const t = s.video.transports[num('index')]
        if (!t?.available) return { ok: false, error: t?.status ?? 'No such transport' }
        s.video.transport = num('index')
        break
      }
      case 'video.name': s.video.name = str('name', 'RICO'); break
      case 'video.source': s.video.source = num('source'); s.video.monitor = num('monitor'); break
      case 'video.start': s.video.sending = true; this.log('RICO', `Network video: sending "${s.video.name}" over OMT`); break
      case 'video.stop': s.video.sending = false; break
      case 'video.scan': s.video.sources = ['STUDIO-PC (TouchDesigner)', 'LAPTOP (Unreal Viewport)']; break
      case 'video.connect': s.video.receiving = true; s.video.receivingFrom = str('name'); s.video.receivedWidth = 1920; s.video.receivedHeight = 1080; break
      case 'video.disconnect': s.video.receiving = false; s.video.receivingFrom = ''; break
      case 'video.bridge': s.video.bridgeToSpout = on; s.video.bridgeName = str('name', s.video.bridgeName); break
      case 'spout.start': s.video.spout.sending = true; s.video.spout.name = str('name', 'RICO'); break
      case 'spout.stop': s.video.spout.sending = false; break
      case 'spout.connect': s.video.spout.receiving = true; s.video.spout.receivingFrom = str('name'); break
      case 'spout.disconnect': s.video.spout.receiving = false; break
      case 'audio.start': s.audio.capturing = true; break
      case 'audio.stop': s.audio.capturing = false; break
      case 'dmx.start': s.dmx.running = true; s.dmx.ip = str('ip', s.dmx.ip); break
      case 'dmx.stop': s.dmx.running = false; break
      case 'dmx.set': { const ch = num('channel', 1); if (ch >= 1 && ch <= 512) s.dmx.channels[ch - 1] = Math.round(num('value') * 255); break }
      case 'mqtt.connect': return { ok: false, error: 'There is no broker in demo mode.' }
      case 'net.udp.open': this.udpPorts.set(num('port', 9000), str('id')); break
      case 'net.close': for (const [port, id] of this.udpPorts) if (id === str('id')) this.udpPorts.delete(port); break
      case 'net.udp.send': {
        // Demo mode loops packets sent to this computer back to any port a script opened.
        const id = this.udpPorts.get(num('port', 9000))
        const bytes = Array.isArray(a.bytes) ? (a.bytes as number[]) : Array.from(new TextEncoder().encode(str('text')))
        if (id && ['127.0.0.1', 'localhost'].includes(str('host', '127.0.0.1'))) {
          window.setTimeout(() => this.emit({ t: 'net', kind: 'udp', id, from: '127.0.0.1:50000', bytes }), 30)
        }
        break
      }
      case 'net.tcp.connect': return { ok: false, error: 'There are no TCP devices in demo mode.' }
      case 'net.serial.list': return { ok: true, ports: ['COM3', 'COM4'] }
      case 'net.serial.open': return { ok: false, error: 'There are no serial devices in demo mode.' }
      case 'net.osc': this.log('OSC out', `Script sent ${str('address')}`, str('address'), Number((a.args as unknown[] | undefined)?.[0]) || 0); break
      case 'mqtt.publish': s.mqtt.messages.unshift({ topic: str('topic'), payload: str('payload') }); break
      case 'app.classic': return { ok: false, error: 'The classic interface is only available inside the RICO app.' }
      case 'app.openUrl': window.open(str('url'), '_blank', 'noopener'); break
      default: break
    }
    // packets going out change nothing on screen (LED outputs send many a second)
    if (op === 'net.udp.send' || op === 'net.tcp.send' || op === 'net.serial.send') return { ok: true }
    this.pushState()
    return { ok: true }
  }
}
