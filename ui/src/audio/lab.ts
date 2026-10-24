import { useSyncExternalStore } from 'react'
import { rico } from '../engine/connection'
import { putAudioSignal, setAudioOwner } from '../engine/signals'
import { SCENE_DEFAULT, SHAPE_DEFAULT, type Band, type LabFrame, type LabSettings, type SceneTune, type Shape } from './types'

// The audio lab: where sound comes in, what bands you want, and the
// analysis results as signals ("audio:low", "audio:kick", your own bands...)
// that everything in RICO can follow.

export type SourceKind = 'rico' | 'mic' | 'screen' | 'player' | 'demo'
export const SOURCE_LABEL: Record<SourceKind, string> = {
  rico: 'System audio (RICO captures it)',
  mic: 'Microphone or audio interface',
  screen: 'Sound of a window or the screen',
  player: 'Sound editor and generator',
  demo: 'Demo beat (no sound needed)',
}

const rid = () => Math.random().toString(36).slice(2, 8)
export const band = (id: string, name: string, lo: number, hi: number, part: Partial<Band> = {}): Band => ({
  id, name, lo, hi, on: true, mode: 'energy', gain: 0, floor: -70, ceiling: -12, auto: true, attack: 10, release: 180, curve: 1, gate: 0, sens: 0.5, color: '#3bff03', ...part,
})

// The six bands RICO always had keep their ids, so old links keep working.
export const PRESETS: { id: string; name: string; bands: () => Band[] }[] = [
  { id: 'default', name: 'RICO default (9 bands)', bands: () => [
    band('level', 'Level', 20, 20000, { color: '#ffffff', release: 250 }),
    band('sub', 'Sub', 20, 60, { color: '#8a5cff' }),
    band('low', 'Low', 60, 250, { color: '#6f86ff' }),
    band('lowmid', 'Low mid', 250, 500, { color: '#30e0ff' }),
    band('mid', 'Mid', 500, 2000, { color: '#3bff03' }),
    band('presence', 'Presence', 2000, 6000, { color: '#ffd23f' }),
    band('high', 'High', 6000, 16000, { color: '#ff8a3d', release: 120 }),
    band('kick', 'Kick hit', 40, 120, { mode: 'hit', color: '#f820a0', release: 150, sens: 0.55 }),
    band('snare', 'Snare hit', 1500, 5000, { mode: 'hit', color: '#ffb3e6', release: 140, sens: 0.45 }),
  ] },
  { id: 'dj', name: 'DJ mixer (3 bands)', bands: () => [
    band('low', 'Low', 20, 250, { color: '#6f86ff' }), band('mid', 'Mid', 250, 4000, { color: '#3bff03' }), band('high', 'High', 4000, 20000, { color: '#ff8a3d' }),
  ] },
  { id: 'octave', name: 'Octaves (10 bands)', bands: () => [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000].map((f, i) =>
    band(`oct${i + 1}`, `${f >= 1000 ? `${f / 1000}k` : f} Hz`, f / Math.SQRT2, Math.min(20000, f * Math.SQRT2), { color: `hsl(${200 - i * 18} 90% 60%)` })) },
  { id: 'third', name: 'Third octaves (31 bands)', bands: () => Array.from({ length: 31 }, (_, i) => {
    const f = 1000 * Math.pow(2, (i - 17) / 3)
    return band(`third${i + 1}`, `${f >= 1000 ? `${(f / 1000).toFixed(1)}k` : Math.round(f)}`, f / Math.pow(2, 1 / 6), Math.min(20000, f * Math.pow(2, 1 / 6)), { color: `hsl(${220 - i * 7} 90% 60%)`, release: 120 })
  }) },
  { id: 'drums', name: 'Drum kit (hits)', bands: () => [
    band('kick', 'Kick', 40, 120, { mode: 'hit', color: '#f820a0', sens: 0.55 }),
    band('snare', 'Snare', 180, 400, { mode: 'hit', color: '#ffb3e6' }),
    band('clap', 'Clap and snare crack', 1500, 5000, { mode: 'hit', color: '#ffd23f' }),
    band('hats', 'Hi-hats', 7000, 16000, { mode: 'hit', color: '#30e0ff', release: 80, sens: 0.6 }),
    band('toms', 'Toms', 80, 250, { mode: 'hit', color: '#6f86ff', sens: 0.4 }),
  ] },
  { id: 'voice', name: 'Voice', bands: () => [
    band('voice', 'Voice body', 120, 1000, { color: '#3bff03' }), band('sibilance', 'S sounds', 5000, 9000, { color: '#ffd23f', mode: 'peak', release: 90 }),
    band('breath', 'Breath and air', 9000, 16000, { color: '#30e0ff' }),
  ] },
]

const KEY = 'rico.audio.lab'
interface Saved { settings: LabSettings; source: SourceKind; device: string; monitor: boolean }
const saved: Partial<Saved> = (() => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') } catch { return {} }
})()

let settings: LabSettings = saved.settings?.bands ? saved.settings : { fftSize: 4096, inputGain: 0, weighting: 'none', bands: PRESETS[0].bands() }
let source: SourceKind = saved.source ?? 'rico'
let device = saved.device ?? ''
let monitor = saved.monitor ?? false
let running = false
let status = 'Stopped'
let version = 0
const listeners = new Set<() => void>()

function emit() {
  version++
  listeners.forEach((l) => l())
}
function persist() {
  try { localStorage.setItem(KEY, JSON.stringify({ settings, source, device, monitor })) } catch { /* not remembered */ }
}

export function useLab() {
  useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => version)
  return { settings, source, device, monitor, running, status }
}
export const getLab = () => ({ settings, source, device, monitor, running, status })

// the worker

let worker: Worker | null = null
let frame: LabFrame | null = null
export const getFrame = () => frame

function ensureWorker() {
  if (worker) return worker
  worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<LabFrame>) => {
    frame = e.data
    publish(frame)
  }
  worker.postMessage({ type: 'config', settings })
  return worker
}

export function setSettings(fn: (s: LabSettings) => LabSettings) {
  settings = fn(settings)
  updateMonitorChain()
  worker?.postMessage({ type: 'config', settings })
  persist()
  emit()
}
export function setShape(part: Partial<Shape>) {
  setSettings((s) => ({ ...s, shape: { ...SHAPE_DEFAULT, ...(s.shape ?? {}), ...part } }))
  updateMonitorChain()
}
export function setSceneTune(part: Partial<SceneTune>) {
  setSettings((s) => ({ ...s, scene: { ...SCENE_DEFAULT, ...(s.scene ?? {}), ...part } }))
}
export const shapeOf = (s: LabSettings): Shape => ({ ...SHAPE_DEFAULT, ...(s.shape ?? {}) })
export const sceneOf = (s: LabSettings): SceneTune => ({ ...SCENE_DEFAULT, ...(s.scene ?? {}) })

export function updateBand(id: string, part: Partial<Band>) {
  setSettings((s) => ({ ...s, bands: s.bands.map((b) => (b.id === id ? { ...b, ...part } : b)) }))
}
export function addBand(part: Partial<Band> = {}) {
  const n = settings.bands.filter((b) => b.id.startsWith('band')).length + 1
  const b = band(`band${n}-${rid()}`, `My band ${n}`, 200, 800, { color: '#b48cff', ...part })
  setSettings((s) => ({ ...s, bands: [...s.bands, b] }))
  return b.id
}
export function removeBand(id: string) {
  setSettings((s) => ({ ...s, bands: s.bands.filter((b) => b.id !== id) }))
}
export function usePreset(id: string) {
  const p = PRESETS.find((x) => x.id === id)
  if (p) setSettings((s) => ({ ...s, bands: p.bands() }))
}

// signals

const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
function publish(f: LabFrame) {
  settings.bands.forEach((b, i) => {
    putAudioSignal(`audio:${b.id}`, b.name, f.bands[i] ?? 0)
    if (b.mode !== 'hit') putAudioSignal(`audio:${b.id}:hit`, `${b.name} hit`, f.hits[i] ?? 0)
  })
  const x = f.features
  const n01 = (v: number, lo: number, hi: number) => Math.max(0, Math.min(1, (v - lo) / (hi - lo)))
  putAudioSignal('audio:onset', 'Any attack', x.onset)
  putAudioSignal('audio:beat', 'Beat', x.beat)
  putAudioSignal('audio:beatPhase', 'Beat phase (0 to 1)', x.beatPhase)
  putAudioSignal('audio:loudness', 'Loudness (LUFS, -60 to 0)', n01(x.lufsM, -60, 0))
  putAudioSignal('audio:brightness', 'Brightness (spectral centroid)', n01(Math.log2(Math.max(20, x.centroid)), Math.log2(20), Math.log2(20000)))
  putAudioSignal('audio:noisiness', 'Noisiness (flatness)', x.flatness)
  putAudioSignal('audio:pitch', 'Pitch (C1 to C7)', x.pitch > 0 ? n01(69 + 12 * Math.log2(x.pitch / 440), 24, 96) : 0)
  putAudioSignal('audio:bpm', 'Tempo (60 to 200 BPM)', n01(x.bpm, 60, 200))
  putAudioSignal('audio:width', 'Stereo width', x.width)
  const names = sceneOf(settings).names
  const KIND_IDS = ['silence', 'speech', 'music', 'foley']
  KIND_IDS.forEach((id, i) => {
    putAudioSignal(`audio:is:${id}`, `Is it ${names[i].toLowerCase()}? (sure 0 to 1)`, x.kinds?.[i] ?? 0)
    if (i > 0) putAudioSignal(`audio:${id}`, `${names[i]} level`, x.kindLevels?.[i] ?? 0)
  })
  putAudioSignal('audio:harmonic', 'Harmonic part (held notes, voices)', x.harmonic ?? 0)
  putAudioSignal('audio:percussive', 'Percussive part (hits, steps)', x.percussive ?? 0)
  x.chroma.forEach((c, i) => putAudioSignal(`audio:chroma:${NOTE[i]}`, `Note ${NOTE[i]}`, c))
}

// sources

let ctx: AudioContext | null = null
let tap: AudioWorkletNode | null = null
let stopSource: (() => void) | null = null
let tapReady: Promise<void> | null = null

const TAP_CODE = `
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.out = null; this.buf = new Float32Array(1024); this.n = 0
    this.port.onmessage = (e) => { if (e.data.port) this.out = e.data.port } }
  process(inputs) {
    const inp = inputs[0]
    if (inp && inp.length && this.out) {
      const l = inp[0], r = inp[1] || inp[0]
      for (let i = 0; i < l.length; i++) { this.buf[this.n++] = l[i]; this.buf[this.n++] = r[i] }
      if (this.n >= 1024) { const d = this.buf.slice(0, this.n); this.out.postMessage({ type: 'pcm', rate: sampleRate, channels: 2, data: d }, [d.buffer]); this.n = 0 }
    }
    return true
  }
}
registerProcessor('rico-tap', Tap)`

// What you hear when Listen is on goes through the same shaping as the
// analysis (filters, gate as a soft expander, compressor), plus its own volume.
let mon: { input: GainNode; nodes: { hp: BiquadFilterNode; low: BiquadFilterNode; mid: BiquadFilterNode; high: BiquadFilterNode; lp: BiquadFilterNode; comp: DynamicsCompressorNode; out: GainNode } } | null = null
async function monitorNode(): Promise<AudioNode> {
  const c = await audioContext()
  if (!mon) {
    const input = c.createGain()
    const hp = c.createBiquadFilter(); hp.type = 'highpass'
    const low = c.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = 120
    const mid = c.createBiquadFilter(); mid.type = 'peaking'
    const high = c.createBiquadFilter(); high.type = 'highshelf'; high.frequency.value = 6000
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'
    const comp = c.createDynamicsCompressor()
    const out = c.createGain()
    input.connect(hp); hp.connect(low); low.connect(mid); mid.connect(high); high.connect(lp); lp.connect(comp); comp.connect(out); out.connect(c.destination)
    mon = { input, nodes: { hp, low, mid, high, lp, comp, out } }
  }
  updateMonitorChain()
  return mon.input
}
function updateMonitorChain() {
  if (!mon) return
  const sh = shapeOf(settings)
  const on = sh.on
  const n = mon.nodes
  n.hp.frequency.value = on && sh.hp > 0 ? sh.hp : 1
  n.lp.frequency.value = on && sh.lp > 0 ? sh.lp : 22000
  n.low.gain.value = on ? sh.low : 0
  n.mid.frequency.value = sh.midHz; n.mid.Q.value = Math.max(0.1, sh.midQ); n.mid.gain.value = on ? sh.mid : 0
  n.high.gain.value = on ? sh.high : 0
  n.comp.threshold.value = on && sh.comp < 0 ? sh.comp : 0
  n.comp.ratio.value = on && sh.comp < 0 ? Math.min(20, Math.max(1, sh.ratio)) : 1
  n.comp.knee.value = 6
  n.out.gain.value = Math.pow(10, ((on ? sh.makeup : 0) + sh.monitor + settings.inputGain) / 20)
}

// One AudioContext for the lab, the sound editor and the generator.
export async function audioContext(): Promise<AudioContext> {
  if (!ctx) ctx = new AudioContext({ latencyHint: 'interactive' })
  if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined)
  return ctx
}

// The node that sound goes into to be analysed. Its samples go straight to
// the worker, without passing through the interface thread.
export async function analyserInput(): Promise<AudioNode> {
  const c = await audioContext()
  if (!tapReady) {
    tapReady = (async () => {
      const url = URL.createObjectURL(new Blob([TAP_CODE], { type: 'application/javascript' }))
      await c.audioWorklet.addModule(url)
      tap = new AudioWorkletNode(c, 'rico-tap', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2, channelCountMode: 'explicit' })
      const ch = new MessageChannel()
      tap.port.postMessage({ port: ch.port1 }, [ch.port1])
      ensureWorker().postMessage({ type: 'port', port: ch.port2 }, [ch.port2])
    })()
  }
  await tapReady
  return tap!
}

// The engine streams what it captures as 16-bit PCM.
let engineOff: (() => void) | null = null
function listenToEngine() {
  engineOff?.()
  engineOff = rico.onBinary((buf) => {
    const v = new DataView(buf)
    if (buf.byteLength < 12 || v.getUint32(0, false) !== 0x5250434d) return   // "RPCM"
    const r = v.getUint32(4, true), ch = v.getUint16(8, true)
    const pcm = new Int16Array(buf, 12, (buf.byteLength - 12) >> 1)
    const f = new Float32Array(pcm.length)
    for (let i = 0; i < pcm.length; i++) f[i] = pcm[i] / 32768
    ensureWorker().postMessage({ type: 'pcm', rate: r, channels: ch, data: f }, [f.buffer])
  })
}

// A drum loop made right here, so the lab moves without any sound playing.
async function demoBeat(dest: AudioNode, c: AudioContext): Promise<() => void> {
  const out = c.createGain()
  out.gain.value = 0.8
  out.connect(dest)
  if (monitor) out.connect(await monitorNode())
  const noise = c.createBuffer(1, c.sampleRate, c.sampleRate)
  const d = noise.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  let next = c.currentTime + 0.1, step = 0
  const spb = 60 / 124 / 4
  const hit = (t: number, kind: 'kick' | 'snare' | 'hat' | 'bass', note = 41) => {
    const g = c.createGain()
    g.connect(out)
    if (kind === 'kick') {
      const o = c.createOscillator(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12)
      g.gain.setValueAtTime(1, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35); o.connect(g); o.start(t); o.stop(t + 0.4)
    } else if (kind === 'bass') {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 440 * Math.pow(2, (note - 69) / 12)
      const f = c.createBiquadFilter(); f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(150, t + 0.2)
      g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22); o.connect(f); f.connect(g); o.start(t); o.stop(t + 0.25)
    } else {
      const s = c.createBufferSource(); s.buffer = noise
      const f = c.createBiquadFilter(); f.type = kind === 'hat' ? 'highpass' : 'bandpass'; f.frequency.value = kind === 'hat' ? 8000 : 2000
      g.gain.setValueAtTime(kind === 'hat' ? 0.25 : 0.7, t); g.gain.exponentialRampToValueAtTime(0.001, t + (kind === 'hat' ? 0.05 : 0.18))
      s.connect(f); f.connect(g); s.start(t); s.stop(t + 0.2)
    }
  }
  const id = window.setInterval(() => {
    while (next < c.currentTime + 0.15) {
      const s = step % 16
      if (s % 4 === 0) hit(next, 'kick')
      if (s === 4 || s === 12) hit(next, 'snare')
      if (s % 2 === 0) hit(next, 'hat')
      if ([0, 3, 6, 10, 11, 14].includes(s)) hit(next, 'bass', [41, 41, 44, 39, 41, 46][[0, 3, 6, 10, 11, 14].indexOf(s)])
      next += spb
      step++
    }
  }, 25)
  return () => { window.clearInterval(id); out.disconnect() }
}

export async function start(kind: SourceKind = source, dev = device): Promise<boolean> {
  stop(false)
  source = kind
  device = dev
  persist()
  ensureWorker().postMessage({ type: 'reset' })
  setAudioOwner('lab')
  running = true
  status = 'Starting...'
  emit()
  try {
    if (kind === 'rico') {
      if (rico.get().status !== 'live') throw new Error('RICO itself is not running (this is the demo). Pick the demo beat, a microphone or a file.')
      listenToEngine()
      const ack = await rico.send('audio.start', dev ? { device: Number(dev) } : {})
      if (!ack.ok) throw new Error(ack.error ?? 'RICO could not listen.')
      await rico.send('audio.stream', { on: true })
      stopSource = () => { engineOff?.(); engineOff = null; void rico.send('audio.stream', { on: false }) }
      status = `Listening to ${rico.get().state?.audio.device ?? 'system audio'}`
    } else if (kind === 'mic' || kind === 'screen') {
      const c = await audioContext()
      const input = await analyserInput()
      const stream = kind === 'mic'
        ? await navigator.mediaDevices.getUserMedia({ audio: { deviceId: dev ? { exact: dev } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 } })
        : await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })
      stream.getVideoTracks().forEach((t) => t.stop())
      if (!stream.getAudioTracks().length) throw new Error('No sound came with that. When sharing, turn on "Share audio".')
      const node = c.createMediaStreamSource(stream)
      node.connect(input)
      if (monitor) node.connect(await monitorNode())
      stopSource = () => { node.disconnect(); stream.getTracks().forEach((t) => t.stop()) }
      status = `Listening to ${stream.getAudioTracks()[0].label || 'the input'}`
    } else if (kind === 'player') {
      await analyserInput()
      stopSource = null
      status = 'Listening to the sound editor and generator'
    } else {
      const c = await audioContext()
      const input = await analyserInput()
      stopSource = await demoBeat(input, c)
      status = 'Playing the demo beat'
    }
    emit()
    return true
  } catch (e) {
    status = (e as Error).message || 'That source did not start.'
    running = false
    setAudioOwner('engine')
    emit()
    return false
  }
}

export function stop(notify = true) {
  stopSource?.()
  stopSource = null
  running = false
  if (notify) {
    status = 'Stopped'
    setAudioOwner('engine')
    emit()
  }
}

export function setMonitor(on: boolean) {
  monitor = on
  persist()
  emit()
  if (running && source !== 'rico' && source !== 'player') void start()
}

export async function inputDevices(): Promise<MediaDeviceInfo[]> {
  try {
    const list = await navigator.mediaDevices.enumerateDevices()
    return list.filter((d) => d.kind === 'audioinput')
  } catch {
    return []
  }
}
