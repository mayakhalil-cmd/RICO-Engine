import type { Ack, EngineState, LiveState, LogEntry, NetEvent } from './types'
import { DemoEngine } from './demo'

// Keeps one connection to the RICO engine and turns its messages into a
// small store the interface can subscribe to.
//
// Inside RICO the page is served by the engine itself, so the socket lives
// on the same host. Opened anywhere else (for example while designing the
// interface), it looks for a running RICO on this computer and falls back
// to a demo engine so every screen still works.

export type Status = 'connecting' | 'live' | 'demo' | 'lost'

export interface Snapshot {
  status: Status
  state: EngineState | null
  live: LiveState
  log: LogEntry[]
  version: string
}

const EMPTY_LIVE: LiveState = { log: [], notes: [], values: {}, audio: null, lfos: [], midiActive: false }
const LOG_LIMIT = 600

type Listener = () => void
type LiveListener = (live: LiveState) => void

interface Pending {
  resolve: (a: Ack) => void
  timer: number
}

class Connection {
  private ws: WebSocket | null = null
  private demo: DemoEngine | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()
  private listeners = new Set<Listener>()
  private liveListeners = new Set<LiveListener>()
  private netListeners = new Set<(e: NetEvent) => void>()
  private binaryListeners = new Set<(b: ArrayBuffer) => void>()
  private syncListeners = new Set<(channel: string, data: unknown) => void>()
  private retry = 0
  private snap: Snapshot = { status: 'connecting', state: null, live: EMPTY_LIVE, log: [], version: '' }

  start() {
    const params = new URLSearchParams(location.search)
    if (params.has('demo')) return this.startDemo()
    this.open(this.socketUrl(), true)
  }

  // True when RICO itself serves this page (inside the app, or a browser
  // pointed at it). Anywhere else a missing RICO means demo mode.
  private servedByRico() {
    return location.protocol === 'http:' && location.port !== '' && !import.meta.env.DEV
  }

  private socketUrl() {
    return this.servedByRico() ? `ws://${location.host}/ws` : 'ws://127.0.0.1:47900/ws'
  }

  private open(url: string, firstTry: boolean) {
    let opened = false
    const ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    ws.onopen = () => {
      opened = true
      this.retry = 0
    }
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') this.onMessage(JSON.parse(e.data))
      else if (e.data instanceof ArrayBuffer) for (const l of this.binaryListeners) l(e.data)
    }
    ws.onclose = () => {
      this.ws = null
      for (const p of this.pending.values()) p.resolve({ ok: false, error: 'RICO is not answering.' })
      this.pending.clear()
      if (!opened && firstTry && !this.servedByRico()) return this.startDemo()
      this.set({ status: 'lost' })
      this.retry = Math.min(this.retry + 1, 6)
      window.setTimeout(() => this.open(url, false), 300 * this.retry)
    }
  }

  private startDemo() {
    this.demo = new DemoEngine((msg) => this.onMessage(msg))
    this.set({ status: 'demo' })
    this.demo.start()
  }

  private onMessage(msg: { t: string } & Record<string, unknown>) {
    switch (msg.t) {
      case 'hello':
        this.set({ version: String(msg.version ?? ''), status: this.demo ? 'demo' : 'live', log: [] })
        break
      case 'state': {
        const { t: _t, ...state } = msg
        this.set({ state: state as unknown as EngineState })
        break
      }
      case 'live': {
        const live = msg as unknown as LiveState
        let log = this.snap.log
        if (live.log.length) log = [...log, ...live.log].slice(-LOG_LIMIT)
        this.snap = { ...this.snap, live, log }
        for (const l of this.liveListeners) l(live)
        this.emit()
        break
      }
      case 'ack': {
        const p = this.pending.get(Number(msg.id))
        if (p) {
          window.clearTimeout(p.timer)
          this.pending.delete(Number(msg.id))
          const { t: _t, id: _id, ...rest } = msg
          p.resolve({ ...rest, ok: Boolean(msg.ok), error: msg.error as string | undefined })
        }
        break
      }
      case 'sync':
        for (const l of this.syncListeners) l(String(msg.channel ?? ''), msg.data)
        break
      case 'net':
        for (const l of this.netListeners) l(msg as unknown as NetEvent)
        break
    }
  }

  // Sends a command and resolves when RICO has run it.
  send(op: string, args: Record<string, unknown> = {}): Promise<Ack> {
    const id = this.nextId++
    const msg = { t: 'cmd', id, op, args }
    return new Promise((resolve) => {
      if (this.demo) return resolve(this.demo.command(op, args))
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return resolve({ ok: false, error: 'Not connected to RICO.' })
      const timer = window.setTimeout(() => {
        this.pending.delete(id)
        resolve({ ok: false, error: 'RICO took too long to answer.' })
      }, 6000)
      this.pending.set(id, { resolve, timer })
      this.ws.send(JSON.stringify(msg))
    })
  }

  // Create workspace frames. Returns false when the socket is still busy
  // with the previous frame, so slow machines skip frames instead of lagging.
  sendFrame(rgba: Uint8Array, width: number, height: number): boolean {
    if (this.demo) return true
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN) return false
    if (ws.bufferedAmount > rgba.byteLength) return false
    const buf = new Uint8Array(12 + rgba.byteLength)
    buf.set([82, 70, 82, 77]) // "RFRM"
    const view = new DataView(buf.buffer)
    view.setUint32(4, width, true)
    view.setUint32(8, height, true)
    buf.set(rgba, 12)
    ws.send(buf)
    return true
  }

  clearLog() {
    this.set({ log: [] })
  }

  subscribe = (l: Listener) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  onLive(l: LiveListener) {
    this.liveListeners.add(l)
    return () => {
      this.liveListeners.delete(l)
    }
  }

  // Raw UDP, TCP and serial data for script panels.
  // Raw data from RICO, like captured audio.
  onBinary(l: (b: ArrayBuffer) => void) {
    this.binaryListeners.add(l)
    return () => {
      this.binaryListeners.delete(l)
    }
  }

  onNet(l: (e: NetEvent) => void) {
    this.netListeners.add(l)
    return () => {
      this.netListeners.delete(l)
    }
  }

  // Live sharing between screens (see shell/sync.ts).
  onSync(l: (channel: string, data: unknown) => void) {
    this.syncListeners.add(l)
    return () => {
      this.syncListeners.delete(l)
    }
  }

  get = () => this.snap

  private set(part: Partial<Snapshot>) {
    this.snap = { ...this.snap, ...part }
    this.emit()
  }

  private emit() {
    for (const l of this.listeners) l()
  }
}

export const rico = new Connection()
