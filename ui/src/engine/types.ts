// Shapes of the messages the RICO engine sends. They match src/web/Bridge.cpp.

export interface OscPreset {
  index: number
  name: string
  address: string
  port: number
  about: string
  setup: string
}

export interface OscDestination {
  name: string
  ip: string
  port: number
  enabled: boolean
}

export interface Mapping {
  key: string
  type: 'note' | 'cc' | 'pitchbend' | 'program' | 'aftertouch' | 'other'
  channel: number
  number: number
  name: string
  address: string
  min: number
  max: number
  momentary: boolean
}

export interface Transport {
  id: string
  name: string
  builtIn: boolean
  available: boolean
  status: string
  about: string
  homepage: string
}

export interface EngineState {
  midi: {
    backend: number
    backends: string[]
    inputs: string[]
    outputs: string[]
    inIndex: number
    outIndex: number
    inOpen: boolean
    outOpen: boolean
    thru: boolean
    autoConnect: boolean
    virtualPorts: string[]
    windowsMidi: { compiled: boolean; ready: boolean; status: string }
  }
  osc: {
    ip: string
    port: number
    listenPort: number
    address: string
    sendToOSC: boolean
    oscToMidi: boolean
    listening: boolean
    preset: number
    presets: OscPreset[]
    destinations: OscDestination[]
    localIp: string
  }
  mappings: Mapping[]
  video: {
    transports: Transport[]
    pluginProblems: { file: string; reason: string }[]
    pluginFolder: string
    transport: number
    sending: boolean
    source: number
    monitor: number
    name: string
    width: number
    height: number
    receiving: boolean
    receivingFrom: string
    receivedWidth: number
    receivedHeight: number
    sources: string[]
    bridgeToSpout: boolean
    bridgeName: string
    error: string
    spout: { sending: boolean; name: string; senders: string[]; receiving: boolean; receivingFrom: string }
  }
  audio: { capturing: boolean; device: string }
  dmx: { running: boolean; ip: string; universe: number; channels: number[] }
  mqtt: { connected: boolean; broker: string; status: string; messages: { topic: string; payload: string }[] }
  app: { version: string; dataFolder: string; classic: boolean; network?: boolean; screens?: number; port?: number }
}

export interface LogEntry {
  n: number
  time: string
  type: string
  text: string
  address: string
  value: number
  ch: number
  d1: number
  d2: number
}

export interface LiveState {
  log: LogEntry[]
  notes: number[]
  values: Record<string, number>
  audio: null | { low: number; mid: number; high: number; level: number; kick: number; snare: number }
  lfos: { name: string; value: number }[]
  midiActive: boolean
}

export type Ack = { ok: boolean; error?: string; [extra: string]: unknown }

// Bytes from a raw port opened by a script panel.
export interface NetEvent { kind: 'udp' | 'tcp' | 'serial' | 'closed' | 'http'; id: string; from: string; bytes: number[] }
