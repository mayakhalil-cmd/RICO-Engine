import { useSyncExternalStore } from 'react'
import { rico } from '../engine/connection'
import { wav } from './editor'
import { deleteSounds, getSound, putSound } from './idb'
import { analyserInput, audioContext, getLab } from './lab'
import { SYNTH_PRESETS, midiHz, voice, type Synth } from './synth'

// The multitrack session: tracks with clips on one timeline, each track with volume, pan,
// mute, solo and its own live effects. Audio tracks hold recordings and
// files. Instrument tracks hold notes played by a synth from the generator,
// so you can play live (computer keys or MIDI) and record it.

// ---- the data ----------------------------------------------------------------------------

export type FxType = 'eq' | 'comp' | 'filter' | 'delay' | 'reverb' | 'drive' | 'chorus'
export interface TrackFx { id: string; type: FxType; on: boolean; p: Record<string, number> }
interface FxParam { k: string; label: string; min: number; max: number; def: number; step: number; suffix?: string; digits?: number; choices?: string[] }
export const FX_INFO: Record<FxType, { name: string; about: string; params: FxParam[] }> = {
  eq: { name: 'EQ', about: 'Low cut, three tone controls and a high cut', params: [
    { k: 'hp', label: 'Low cut', min: 0, max: 1000, def: 0, step: 1, suffix: ' Hz', digits: 0 },
    { k: 'low', label: 'Low', min: -24, max: 24, def: 0, step: 0.2, suffix: ' dB' },
    { k: 'mid', label: 'Mid', min: -24, max: 24, def: 0, step: 0.2, suffix: ' dB' },
    { k: 'midHz', label: 'Mid at', min: 40, max: 16000, def: 1000, step: 10, suffix: ' Hz', digits: 0 },
    { k: 'q', label: 'Mid width', min: 0.1, max: 12, def: 1, step: 0.02, digits: 2 },
    { k: 'high', label: 'High', min: -24, max: 24, def: 0, step: 0.2, suffix: ' dB' },
    { k: 'lp', label: 'High cut', min: 0, max: 20000, def: 0, step: 20, suffix: ' Hz', digits: 0 },
  ] },
  comp: { name: 'Compressor', about: 'Turns loud parts down so the level is even', params: [
    { k: 'threshold', label: 'Threshold', min: -60, max: 0, def: -20, step: 0.5, suffix: ' dB' },
    { k: 'ratio', label: 'Ratio', min: 1, max: 20, def: 4, step: 0.1, suffix: ':1' },
    { k: 'attack', label: 'Attack', min: 0, max: 200, def: 5, step: 0.5, suffix: ' ms' },
    { k: 'release', label: 'Release', min: 10, max: 1000, def: 150, step: 5, suffix: ' ms', digits: 0 },
    { k: 'makeup', label: 'Make-up', min: -12, max: 24, def: 4, step: 0.2, suffix: ' dB' },
  ] },
  filter: { name: 'Auto filter', about: 'A filter that can move by itself (wah, sweeps)', params: [
    { k: 'type', label: 'Type', min: 0, max: 2, def: 0, step: 1, choices: ['Low pass', 'High pass', 'Band pass'] },
    { k: 'freq', label: 'Frequency', min: 30, max: 18000, def: 1200, step: 10, suffix: ' Hz', digits: 0 },
    { k: 'q', label: 'Resonance', min: 0.1, max: 20, def: 2, step: 0.05, digits: 2 },
    { k: 'rate', label: 'Move speed', min: 0, max: 20, def: 0.5, step: 0.01, suffix: ' Hz', digits: 2 },
    { k: 'depth', label: 'Move amount', min: 0, max: 4, def: 0, step: 0.05, suffix: ' oct', digits: 2 },
  ] },
  delay: { name: 'Echo', about: 'Repeats, in time with the tempo if you like', params: [
    { k: 'beats', label: 'Time (beats)', min: 0, max: 4, def: 0.75, step: 0.125, digits: 3 },
    { k: 'time', label: 'or seconds', min: 0.01, max: 2, def: 0.3, step: 0.005, suffix: ' s', digits: 3 },
    { k: 'feedback', label: 'Repeats', min: 0, max: 0.95, def: 0.4, step: 0.01, digits: 2 },
    { k: 'tone', label: 'Darker', min: 500, max: 18000, def: 6000, step: 50, suffix: ' Hz', digits: 0 },
    { k: 'mix', label: 'Wet', min: 0, max: 1, def: 0.3, step: 0.01, digits: 2 },
  ] },
  reverb: { name: 'Reverb', about: 'A room around the sound', params: [
    { k: 'size', label: 'Length', min: 0.2, max: 10, def: 2.2, step: 0.05, suffix: ' s' },
    { k: 'pre', label: 'Pre-delay', min: 0, max: 0.2, def: 0.02, step: 0.002, suffix: ' s', digits: 3 },
    { k: 'tone', label: 'Darker', min: 1000, max: 18000, def: 9000, step: 100, suffix: ' Hz', digits: 0 },
    { k: 'mix', label: 'Wet', min: 0, max: 1, def: 0.3, step: 0.01, digits: 2 },
  ] },
  drive: { name: 'Drive', about: 'Warm saturation up to distortion', params: [
    { k: 'amount', label: 'Amount', min: 0, max: 1, def: 0.4, step: 0.01, digits: 2 },
    { k: 'tone', label: 'Tone', min: 500, max: 18000, def: 8000, step: 50, suffix: ' Hz', digits: 0 },
    { k: 'mix', label: 'Mix', min: 0, max: 1, def: 1, step: 0.01, digits: 2 },
  ] },
  chorus: { name: 'Chorus', about: 'A wider, moving sound', params: [
    { k: 'rate', label: 'Speed', min: 0.05, max: 8, def: 0.8, step: 0.01, suffix: ' Hz', digits: 2 },
    { k: 'depth', label: 'Depth', min: 0, max: 10, def: 3, step: 0.1, suffix: ' ms' },
    { k: 'mix', label: 'Mix', min: 0, max: 1, def: 0.5, step: 0.01, digits: 2 },
  ] },
}

export interface AudioClip { id: string; kind: 'audio'; track: string; name: string; start: number; offset: number; length: number; gain: number; fadeIn: number; fadeOut: number; source: string }
export interface Note { t: number; d: number; n: number; v: number }     // t from the clip start, seconds
export interface NoteClip { id: string; kind: 'notes'; track: string; name: string; start: number; length: number; notes: Note[] }
export type SClip = AudioClip | NoteClip
export interface STrack {
  id: string; name: string; kind: 'audio' | 'instrument'; color: string
  vol: number; pan: number; mute: boolean; solo: boolean; arm: boolean; monitor: boolean
  fx: TrackFx[]; synth?: Synth; height?: number
}
export interface Session { tracks: STrack[]; clips: SClip[]; bpm: number; loop: boolean; loopA: number; loopB: number; snap: boolean; master: number; metronome: boolean }

const COLORS = ['#3bff03', '#30e0ff', '#f820a0', '#ffd23f', '#b48cff', '#ff8a3d', '#6f86ff', '#ffb3e6']
export const sid = () => Math.random().toString(36).slice(2, 10)

export function newTrack(kind: STrack['kind'], n: number, part: Partial<STrack> = {}): STrack {
  return {
    id: sid(), name: kind === 'audio' ? `Audio ${n}` : `Instrument ${n}`, kind, color: COLORS[(n - 1) % COLORS.length],
    vol: 0, pan: 0, mute: false, solo: false, arm: false, monitor: false, fx: [],
    synth: kind === 'instrument' ? { ...(SYNTH_PRESETS.find((p) => p.name === 'Bass pluck') ?? SYNTH_PRESETS[0]) } : undefined,
    ...part,
  }
}
export function newFx(type: FxType): TrackFx {
  return { id: sid(), type, on: true, p: Object.fromEntries(FX_INFO[type].params.map((q) => [q.k, q.def])) }
}

const KEY = 'rico.sound.session'
const fresh = (): Session => ({ tracks: [newTrack('audio', 1), newTrack('audio', 2), newTrack('instrument', 1)], clips: [], bpm: 120, loop: false, loopA: 0, loopB: 8, snap: true, master: 0, metronome: false })
let session: Session = (() => {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Session | null
    if (s?.tracks) return { ...fresh(), ...s }
  } catch { /* new */ }
  return fresh()
})()

// ---- the store, with undo ----

let version = 0
const listeners = new Set<() => void>()
const undoList: Session[] = []
const redoList: Session[] = []
let lastMerge = ''
let lastMergeAt = 0
let selectedClip: string | null = null
let selectedTrack: string | null = session.tracks[0]?.id ?? null

function emit() { version++; listeners.forEach((l) => l()) }
function persist() { try { localStorage.setItem(KEY, JSON.stringify(session)) } catch { /* full */ } }

export function useSession() {
  useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => version)
  return { session, selectedClip, selectedTrack, pos: position(), playing: Boolean(play), recording: Boolean(rec), canUndo: undoList.length > 0, canRedo: redoList.length > 0, loaded: buffers }
}
export const getSession = () => session

export function change(label: string, fn: (s: Session) => Session, merge?: string) {
  const now = performance.now()
  if (!(merge && merge === lastMerge && now - lastMergeAt < 1500)) {
    undoList.push(session)
    if (undoList.length > 200) undoList.shift()
    redoList.length = 0
  }
  lastMerge = merge ?? ''
  lastMergeAt = now
  void label
  session = fn(session)
  persist()
  syncGraph()
  emit()
  if (play) restartSoon()
}
export function undo() { const p = undoList.pop(); if (!p) return; redoList.push(session); session = p; persist(); syncGraph(); emit() }
export function redo() { const n = redoList.pop(); if (!n) return; undoList.push(session); session = n; persist(); syncGraph(); emit() }

export function selectClip(id: string | null) { selectedClip = id; const c = session.clips.find((x) => x.id === id); if (c) selectedTrack = c.track; emit() }
export function selectTrack(id: string | null) { selectedTrack = id; emit() }

export const updateTrack = (id: string, part: Partial<STrack>, label = 'Change track', merge?: string) =>
  change(label, (s) => ({ ...s, tracks: s.tracks.map((t) => (t.id === id ? { ...t, ...part } : t)) }), merge ?? `track.${id}.${Object.keys(part).join()}`)
export const updateClip = (id: string, part: Partial<AudioClip> | Partial<NoteClip>, label = 'Change clip', merge?: string) =>
  change(label, (s) => ({ ...s, clips: s.clips.map((c) => (c.id === id ? ({ ...c, ...part } as SClip) : c)) }), merge)
export function addTrack(kind: STrack['kind']) {
  const n = session.tracks.filter((t) => t.kind === kind).length + 1
  const t = newTrack(kind, n)
  change('Add track', (s) => ({ ...s, tracks: [...s.tracks, t] }))
  selectTrack(t.id)
}
export function removeTrack(id: string) {
  change('Delete track', (s) => ({ ...s, tracks: s.tracks.filter((t) => t.id !== id), clips: s.clips.filter((c) => c.track !== id) }))
}
export function moveTrack(id: string, d: number) {
  change('Move track', (s) => {
    const i = s.tracks.findIndex((t) => t.id === id), j = i + d
    if (i < 0 || j < 0 || j >= s.tracks.length) return s
    const tracks = [...s.tracks]; [tracks[i], tracks[j]] = [tracks[j], tracks[i]]
    return { ...s, tracks }
  })
}
export function removeClip(id: string) { change('Delete clip', (s) => ({ ...s, clips: s.clips.filter((c) => c.id !== id) })); if (selectedClip === id) selectedClip = null }
export function duplicateClip(id: string) {
  const c = session.clips.find((x) => x.id === id)
  if (!c) return
  const copy = { ...c, id: sid(), start: c.start + c.length } as SClip
  change('Duplicate clip', (s) => ({ ...s, clips: [...s.clips, copy] }))
  selectClip(copy.id)
}
// Cuts the clip at a time into two clips.
export function splitClip(id: string, t: number) {
  const c = session.clips.find((x) => x.id === id)
  if (!c || t <= c.start + 0.005 || t >= c.start + c.length - 0.005) return
  const at = t - c.start
  let a: SClip, b: SClip
  if (c.kind === 'audio') {
    a = { ...c, length: at, fadeOut: Math.min(c.fadeOut, at) }
    b = { ...c, id: sid(), start: t, offset: c.offset + at, length: c.length - at, fadeIn: 0 }
  } else {
    a = { ...c, length: at, notes: c.notes.filter((n) => n.t < at).map((n) => ({ ...n, d: Math.min(n.d, at - n.t) })) }
    b = { ...c, id: sid(), start: t, length: c.length - at, notes: c.notes.filter((n) => n.t >= at).map((n) => ({ ...n, t: n.t - at })) }
  }
  change('Split clip', (s) => ({ ...s, clips: s.clips.flatMap((x) => (x.id === id ? [a, b] : [x])) }))
}
export const beat = () => 60 / session.bpm
export const snapTime = (t: number, on = session.snap) => (on ? Math.round(t / (beat() / 4)) * (beat() / 4) : t)
export const sessionEnd = () => Math.max(4, ...session.clips.map((c) => c.start + c.length))

// ---- sounds (decoded audio) ----

const buffers = new Map<string, AudioBuffer>()
export const bufferOf = (id: string) => buffers.get(id)
let loading = false
async function loadBuffers() {
  if (loading) return
  loading = true
  const c = await audioContext()
  const ids = new Set(session.clips.filter((x): x is AudioClip => x.kind === 'audio').map((x) => x.source))
  for (const id of ids) {
    if (buffers.has(id)) continue
    const s = await getSound(id)
    if (!s) continue
    const b = c.createBuffer(s.channels.length, s.channels[0].length, s.rate)
    s.channels.forEach((d, i) => b.copyToChannel(new Float32Array(d), i))
    buffers.set(id, b)
  }
  loading = false
  emit()
}
export async function startSession() { await loadBuffers(); await ensureGraph() }

export async function addSound(b: AudioBuffer): Promise<string> {
  const id = sid()
  buffers.set(id, b)
  await putSound(id, { rate: b.sampleRate, channels: Array.from({ length: b.numberOfChannels }, (_, i) => b.getChannelData(i).slice()) })
  return id
}
// Puts a sound on a track at a time (a new clip).
export async function placeSound(b: AudioBuffer, name: string, track?: string, at?: number) {
  const src = await addSound(b)
  let t = track ? session.tracks.find((x) => x.id === track) : session.tracks.find((x) => x.id === selectedTrack && x.kind === 'audio')
  if (!t || t.kind !== 'audio') t = session.tracks.find((x) => x.kind === 'audio')
  if (!t) { addTrack('audio'); t = session.tracks[session.tracks.length - 1] }
  const clip: AudioClip = { id: sid(), kind: 'audio', track: t.id, name, start: at ?? position(), offset: 0, length: b.duration, gain: 0, fadeIn: 0, fadeOut: 0, source: src }
  change('Add sound', (s) => ({ ...s, clips: [...s.clips, clip] }))
  selectClip(clip.id)
  return clip
}
export async function importFile(f: File, track?: string, at?: number) {
  const c = await audioContext()
  const b = await c.decodeAudioData(await f.arrayBuffer())
  return placeSound(b, f.name.replace(/\.[^.]+$/, ''), track, at)
}
// After editing a clip in the waveform editor, its new sound replaces it.
export async function replaceClipSound(id: string, b: AudioBuffer) {
  const src = await addSound(b)
  updateClip(id, { source: src, offset: 0, length: b.duration, fadeIn: 0, fadeOut: 0 } as Partial<AudioClip>, 'Edit clip sound')
}
// The part of the sound a clip plays, as its own buffer (for the editor).
export async function clipBuffer(c: AudioClip): Promise<AudioBuffer | null> {
  const b = buffers.get(c.source)
  if (!b) return null
  const ctx = await audioContext()
  const a = Math.floor(c.offset * b.sampleRate), z = Math.min(b.length, a + Math.floor(c.length * b.sampleRate))
  const out = ctx.createBuffer(b.numberOfChannels, Math.max(1, z - a), b.sampleRate)
  for (let i = 0; i < b.numberOfChannels; i++) out.copyToChannel(b.getChannelData(i).slice(a, z), i)
  return out
}
export function forgetUnused() { void deleteSounds(new Set(session.clips.filter((x): x is AudioClip => x.kind === 'audio').map((x) => x.source))) }

// ---- the sound graph (works the same live and when mixing down) ----

interface FxNode { input: AudioNode; output: AudioNode; set: (p: Record<string, number>) => void; stop: () => void }
const irCache = new Map<string, AudioBuffer>()
function impulse(c: BaseAudioContext, size: number): AudioBuffer {
  const key = `${c.sampleRate}:${size.toFixed(2)}:${c instanceof OfflineAudioContext ? 'o' : 'l'}`
  const hit = irCache.get(key)
  if (hit && !(c instanceof OfflineAudioContext)) return hit
  const n = Math.max(1, Math.round(size * c.sampleRate))
  const b = c.createBuffer(2, n, c.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch)
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3)
  }
  if (!(c instanceof OfflineAudioContext)) irCache.set(key, b)
  return b
}
function driveCurve(amount: number) {
  const n = 2048, k = amount * 60 + 0.001
  const curve = new Float32Array(n)
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(k * x) / Math.tanh(k) }
  return curve
}

function buildFx(c: BaseAudioContext, f: TrackFx): FxNode {
  const input = c.createGain(), output = c.createGain()
  const stops: (() => void)[] = []
  let set: (p: Record<string, number>) => void = () => undefined
  const at = c.currentTime
  if (f.type === 'eq') {
    const hp = c.createBiquadFilter(); hp.type = 'highpass'
    const low = c.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = 120
    const mid = c.createBiquadFilter(); mid.type = 'peaking'
    const high = c.createBiquadFilter(); high.type = 'highshelf'; high.frequency.value = 6000
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'
    input.connect(hp); hp.connect(low); low.connect(mid); mid.connect(high); high.connect(lp); lp.connect(output)
    set = (p) => {
      hp.frequency.setValueAtTime(p.hp > 0 ? p.hp : 1, at); low.gain.setValueAtTime(p.low, at)
      mid.gain.setValueAtTime(p.mid, at); mid.frequency.setValueAtTime(p.midHz, at); mid.Q.setValueAtTime(Math.max(0.1, p.q), at)
      high.gain.setValueAtTime(p.high, at); lp.frequency.setValueAtTime(p.lp > 0 ? p.lp : 22000, at)
    }
  } else if (f.type === 'comp') {
    const comp = c.createDynamicsCompressor(), mk = c.createGain()
    input.connect(comp); comp.connect(mk); mk.connect(output)
    set = (p) => {
      comp.threshold.setValueAtTime(p.threshold, at); comp.ratio.setValueAtTime(Math.max(1, p.ratio), at); comp.knee.setValueAtTime(4, at)
      comp.attack.setValueAtTime(p.attack / 1000, at); comp.release.setValueAtTime(p.release / 1000, at)
      mk.gain.setValueAtTime(Math.pow(10, p.makeup / 20), at)
    }
  } else if (f.type === 'filter') {
    const fl = c.createBiquadFilter(), lfo = c.createOscillator(), depth = c.createGain()
    lfo.connect(depth); depth.connect(fl.detune); lfo.start()
    stops.push(() => lfo.stop())
    input.connect(fl); fl.connect(output)
    set = (p) => {
      fl.type = (['lowpass', 'highpass', 'bandpass'] as const)[Math.round(p.type)] ?? 'lowpass'
      fl.frequency.setValueAtTime(p.freq, at); fl.Q.setValueAtTime(p.q, at)
      lfo.frequency.setValueAtTime(Math.max(0.001, p.rate), at); depth.gain.setValueAtTime(p.depth * 1200, at)
    }
  } else if (f.type === 'delay') {
    const d = c.createDelay(4), fb = c.createGain(), tone = c.createBiquadFilter(), wet = c.createGain()
    tone.type = 'lowpass'
    input.connect(output)
    input.connect(d); d.connect(tone); tone.connect(fb); fb.connect(d); tone.connect(wet); wet.connect(output)
    set = (p) => {
      const t = p.beats > 0 ? p.beats * (60 / session.bpm) : p.time
      d.delayTime.setValueAtTime(Math.min(4, Math.max(0.001, t)), at); fb.gain.setValueAtTime(Math.min(0.95, p.feedback), at)
      tone.frequency.setValueAtTime(p.tone, at); wet.gain.setValueAtTime(p.mix, at)
    }
  } else if (f.type === 'reverb') {
    const pre = c.createDelay(1), conv = c.createConvolver(), tone = c.createBiquadFilter(), wet = c.createGain()
    tone.type = 'lowpass'
    input.connect(output)
    input.connect(pre); pre.connect(conv); conv.connect(tone); tone.connect(wet); wet.connect(output)
    let size = -1
    set = (p) => {
      if (Math.abs(p.size - size) > 0.01) { size = p.size; conv.buffer = impulse(c, p.size) }
      pre.delayTime.setValueAtTime(p.pre, at); tone.frequency.setValueAtTime(p.tone, at); wet.gain.setValueAtTime(p.mix, at)
    }
  } else if (f.type === 'drive') {
    const sh = c.createWaveShaper(), tone = c.createBiquadFilter(), wet = c.createGain(), dry = c.createGain()
    tone.type = 'lowpass'; sh.oversample = '4x'
    input.connect(dry); dry.connect(output)
    input.connect(sh); sh.connect(tone); tone.connect(wet); wet.connect(output)
    let amt = -1
    set = (p) => {
      if (p.amount !== amt) { amt = p.amount; sh.curve = driveCurve(p.amount) }
      tone.frequency.setValueAtTime(p.tone, at); wet.gain.setValueAtTime(p.mix, at); dry.gain.setValueAtTime(1 - p.mix, at)
    }
  } else {
    const d = c.createDelay(0.1), lfo = c.createOscillator(), depth = c.createGain(), wet = c.createGain()
    d.delayTime.value = 0.015
    lfo.connect(depth); depth.connect(d.delayTime); lfo.start()
    stops.push(() => lfo.stop())
    input.connect(output)
    input.connect(d); d.connect(wet); wet.connect(output)
    set = (p) => { lfo.frequency.setValueAtTime(p.rate, at); depth.gain.setValueAtTime(p.depth / 1000, at); wet.gain.setValueAtTime(p.mix, at) }
  }
  set(f.p)
  return { input, output, set, stop: () => stops.forEach((s) => s()) }
}

interface TrackNodes { input: GainNode; fx: FxNode[]; fxKey: string; pan: StereoPannerNode; vol: GainNode; meter: AnalyserNode }
interface Graph { c: BaseAudioContext; master: GainNode; meter: AnalyserNode; tracks: Map<string, TrackNodes> }

const fxKeyOf = (t: STrack) => t.fx.map((f) => `${f.id}:${f.type}:${f.on}`).join()
const trackGain = (s: Session, t: STrack) => (t.mute || (s.tracks.some((x) => x.solo) && !t.solo) ? 0 : Math.pow(10, t.vol / 20))

function makeTrack(g: Graph, t: STrack): TrackNodes {
  const c = g.c
  const input = c.createGain(), pan = c.createStereoPanner(), vol = c.createGain(), meter = c.createAnalyser()
  meter.fftSize = 1024
  pan.connect(vol); vol.connect(g.master); vol.connect(meter)
  const n: TrackNodes = { input, fx: [], fxKey: '', pan, vol, meter }
  wireFx(g, n, t)
  return n
}
function wireFx(g: Graph, n: TrackNodes, t: STrack) {
  n.input.disconnect()
  n.fx.forEach((f) => { f.stop(); f.output.disconnect() })
  n.fx = t.fx.filter((f) => f.on).map((f) => buildFx(g.c, f))
  let head: AudioNode = n.input
  for (const f of n.fx) { head.connect(f.input); head = f.output }
  head.connect(n.pan)
  n.fxKey = fxKeyOf(t)
}
function applyTrack(g: Graph, n: TrackNodes, t: STrack, s: Session) {
  if (n.fxKey !== fxKeyOf(t)) wireFx(g, n, t)
  else t.fx.filter((f) => f.on).forEach((f, i) => n.fx[i]?.set(f.p))
  const at = g.c.currentTime
  n.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, t.pan)), at, 0.01)
  n.vol.gain.setTargetAtTime(trackGain(s, t), at, 0.01)
}

function buildGraph(c: BaseAudioContext, s: Session, out: AudioNode): Graph {
  const master = c.createGain(), meter = c.createAnalyser()
  meter.fftSize = 2048
  master.gain.value = Math.pow(10, s.master / 20)
  master.connect(out); master.connect(meter)
  const g: Graph = { c, master, meter, tracks: new Map() }
  for (const t of s.tracks) { const n = makeTrack(g, t); applyTrack(g, n, t, s); g.tracks.set(t.id, n) }
  return g
}

let live: Graph | null = null
async function ensureGraph(): Promise<Graph> {
  if (live) return live
  const c = await audioContext()
  live = buildGraph(c, session, c.destination)
  // The audio lab can listen to the session ("Sound editor and generator").
  const lab = getLab()
  if (lab.running && lab.source === 'player') live.master.connect(await analyserInput())
  return live
}
export async function connectToLab() { const g = await ensureGraph(); try { g.master.connect(await analyserInput()) } catch { /* fine */ } }
function syncGraph() {
  const g = live
  if (!g) return
  for (const [id, n] of g.tracks) if (!session.tracks.some((t) => t.id === id)) { n.vol.disconnect(); g.tracks.delete(id) }
  for (const t of session.tracks) {
    let n = g.tracks.get(t.id)
    if (!n) { n = makeTrack(g, t); g.tracks.set(t.id, n) }
    applyTrack(g, n, t, session)
  }
  g.master.gain.setTargetAtTime(Math.pow(10, session.master / 20), g.c.currentTime, 0.01)
}

// Level of a track (or the master) right now, 0..1 peak, for the meters.
const meterBuf = new Float32Array(2048)
export function meterOf(track: string | 'master'): number {
  const g = live
  if (!g) return 0
  const a = track === 'master' ? g.meter : g.tracks.get(track)?.meter
  if (!a) return 0
  const buf = meterBuf.subarray(0, a.fftSize)
  a.getFloatTimeDomainData(buf)
  let p = 0
  for (let i = 0; i < buf.length; i++) p = Math.max(p, Math.abs(buf[i]))
  return p
}

// ---- playing ----

interface Pass { ctxAt: number; from: number; to: number; outs: GainNode[]; srcs: AudioScheduledSourceNode[] }
let play: { passes: Pass[]; timer: number; restart: number } | null = null
let idlePos = 0

function schedulePass(g: Graph, s: Session, from: number, to: number, at: number): Pass {
  const c = g.c
  const outs = new Map<string, GainNode>()
  const srcs: AudioScheduledSourceNode[] = []
  const outFor = (track: string) => {
    let o = outs.get(track)
    if (!o) { o = c.createGain(); o.connect(g.tracks.get(track)?.input ?? g.master); outs.set(track, o) }
    return o
  }
  for (const clip of s.clips) {
    const track = s.tracks.find((t) => t.id === clip.track)
    if (!track) continue
    const cs = clip.start, ce = clip.start + clip.length
    const s0 = Math.max(from, cs), s1 = Math.min(to, ce)
    if (s1 <= s0) continue
    if (clip.kind === 'audio') {
      const b = buffers.get(clip.source)
      if (!b) continue
      const src = c.createBufferSource()
      src.buffer = b
      const cg = c.createGain()
      const full = Math.pow(10, clip.gain / 20)
      const v = (t: number) => full * Math.max(0, Math.min(1, clip.fadeIn > 0 ? (t - cs) / clip.fadeIn : 1, clip.fadeOut > 0 ? (ce - t) / clip.fadeOut : 1))
      const when = at + (s0 - from)
      cg.gain.setValueAtTime(v(s0), when)
      for (const k of [cs + clip.fadeIn, ce - clip.fadeOut, ce].sort((a, z) => a - z)) if (k > s0 && k <= s1) cg.gain.linearRampToValueAtTime(v(k), at + (k - from))
      src.connect(cg); cg.connect(outFor(clip.track))
      src.start(when, clip.offset + (s0 - cs), s1 - s0)
      srcs.push(src)
    } else if (track.synth) {
      for (const n of clip.notes) {
        const T = cs + n.t
        if (T < from || T >= to || T >= ce) continue
        const d = Math.max(0.02, Math.min(n.d, ce - T))
        voice(c, { ...track.synth, length: d + track.synth.release }, outFor(clip.track), at + (T - from), midiHz(n.n), n.v)
      }
    }
  }
  // The metronome clicks on each beat while playing.
  if (s.metronome && c instanceof AudioContext) {
    const b = 60 / s.bpm
    for (let k = Math.ceil(from / b - 1e-6); k * b < to; k++) {
      const t = at + (k * b - from)
      const o = c.createOscillator(), gg = c.createGain()
      o.frequency.value = k % 4 === 0 ? 1600 : 1100
      gg.gain.setValueAtTime(0.25, t); gg.gain.exponentialRampToValueAtTime(0.001, t + 0.05)
      o.connect(gg); gg.connect(outFor('__click'))
      o.start(t); o.stop(t + 0.06)
      srcs.push(o)
    }
  }
  return { ctxAt: at, from, to, outs: [...outs.values()], srcs }
}

export function position(): number {
  if (!play || !live) return idlePos
  const now = live.c.currentTime
  for (let i = play.passes.length - 1; i >= 0; i--) {
    const p = play.passes[i]
    if (now >= p.ctxAt) return Math.min(p.to, p.from + (now - p.ctxAt))
  }
  return play.passes[0]?.from ?? idlePos
}

export async function startPlay(from = idlePos) {
  stopPlay(false)
  const g = await ensureGraph()
  await loadBuffers()
  const c = g.c as AudioContext
  const s = session
  const end = s.loop && s.loopB > s.loopA ? s.loopB : sessionEnd()
  const a = s.loop && (from < s.loopA || from >= s.loopB) ? s.loopA : from
  const first = schedulePass(g, s, a, end, c.currentTime + 0.05)
  play = { passes: [first], timer: 0, restart: 0 }
  const tick = () => {
    if (!play) return
    const last = play.passes[play.passes.length - 1]
    const endAt = last.ctxAt + (last.to - last.from)
    if (c.currentTime > endAt - 0.4) {
      if (session.loop && session.loopB > session.loopA) {
        play.passes.push(schedulePass(g, session, session.loopA, session.loopB, endAt))
        if (play.passes.length > 3) play.passes.shift()
      } else if (c.currentTime >= endAt && !rec) { idlePos = last.to; stopPlay(); return }
    }
    play.timer = window.setTimeout(tick, 60)
  }
  tick()
  emit()
}

export function stopPlay(notify = true) {
  if (play) {
    idlePos = position()
    window.clearTimeout(play.timer)
    window.clearTimeout(play.restart)
    for (const p of play.passes) {
      p.srcs.forEach((x) => { try { x.stop() } catch { /* done */ } })
      p.outs.forEach((o) => o.disconnect())
    }
    play = null
  }
  if (notify) emit()
}
export function seekTo(t: number) {
  const was = Boolean(play)
  if (was) stopPlay(false)
  idlePos = Math.max(0, t)
  if (was) void startPlay(idlePos)
  emit()
}
function restartSoon() {
  if (!play) return
  window.clearTimeout(play.restart)
  play.restart = window.setTimeout(() => { if (play && !rec) void startPlay(position()) }, 120)
}

// ---- live playing (computer keys and MIDI) ----

const held = new Map<string, { gain: GainNode; t: number; n: number; v: number; track: string }>()
let recNotes: { track: string; t: number; d: number; n: number; v: number }[] = []

function liveTracks(): STrack[] {
  const armed = session.tracks.filter((t) => t.kind === 'instrument' && t.arm)
  if (armed.length) return armed
  const sel = session.tracks.find((t) => t.id === selectedTrack && t.kind === 'instrument')
  return sel ? [sel] : session.tracks.filter((t) => t.kind === 'instrument').slice(0, 1)
}

export async function noteOn(n: number, v = 0.8) {
  const g = await ensureGraph()
  const c = g.c
  for (const t of liveTracks()) {
    if (!t.synth) continue
    const key = `${t.id}:${n}`
    if (held.has(key)) noteOff(n)
    const gain = c.createGain()
    gain.connect(g.tracks.get(t.id)?.input ?? g.master)
    voice(c, { ...t.synth, length: Math.max(t.synth.length, 8) }, gain, c.currentTime + 0.005, midiHz(n), v)
    held.set(key, { gain, t: position(), n, v, track: t.id })
  }
}
export function noteOff(n: number) {
  const c = live?.c
  for (const [key, h] of [...held]) {
    if (!key.endsWith(`:${n}`)) continue
    held.delete(key)
    const t = session.tracks.find((x) => x.id === h.track)
    const rel = Math.max(0.01, t?.synth?.release ?? 0.2)
    if (c) { h.gain.gain.setTargetAtTime(0, c.currentTime, rel / 3); window.setTimeout(() => h.gain.disconnect(), rel * 5000 + 200) }
    if (rec) recNotes.push({ track: h.track, t: h.t, d: Math.max(0.03, position() - h.t), n: h.n, v: h.v })
  }
}

// MIDI notes: from RICO (the app already opens your MIDI ports) or, in a
// browser, from Web MIDI.
let midiOn = false
export function listenMidi() {
  if (midiOn) return
  midiOn = true
  rico.onLive((l) => {
    for (const e of l.log) {
      if (e.type === 'Note On' && e.d2 > 0) void noteOn(e.d1, e.d2 / 127)
      else if (e.type === 'Note Off' || (e.type === 'Note On' && e.d2 === 0)) noteOff(e.d1)
    }
  })
  if (rico.get().status !== 'live' && 'requestMIDIAccess' in navigator) {
    navigator.requestMIDIAccess().then((m) => {
      const hook = () => m.inputs.forEach((i) => {
        i.onmidimessage = (ev) => {
          const d = ev.data
          if (!d || d.length < 3) return
          const kind = d[0] & 0xf0
          if (kind === 0x90 && d[2] > 0) void noteOn(d[1], d[2] / 127)
          else if (kind === 0x80 || (kind === 0x90 && d[2] === 0)) noteOff(d[1])
        }
      })
      hook()
      m.onstatechange = hook
    }).catch(() => undefined)
  }
}

// ---- recording ----

const REC_CODE = `
class Rec extends AudioWorkletProcessor {
  process(inputs) {
    const i = inputs[0]
    if (i && i.length) this.port.postMessage([i[0].slice(), (i[1] || i[0]).slice()])
    return true
  }
}
registerProcessor('rico-rec', Rec)`
let recReady: Promise<void> | null = null
let rec: { start: number; stream: MediaStream | null; node: AudioWorkletNode | null; src: MediaStreamAudioSourceNode | null; parts: [Float32Array, Float32Array][]; track: string | null; mon: GainNode | null } | null = null

export async function startRecord(device = '') {
  if (rec) return
  const g = await ensureGraph()
  const c = g.c as AudioContext
  const audioTrack = session.tracks.find((t) => t.kind === 'audio' && t.arm)
  const anyInstrument = session.tracks.some((t) => t.kind === 'instrument' && t.arm)
  if (!audioTrack && !anyInstrument) throw new Error('Arm a track first (the R button on the track).')
  recNotes = []
  rec = { start: idlePos, stream: null, node: null, src: null, parts: [], track: audioTrack?.id ?? null, mon: null }
  if (audioTrack) {
    if (!recReady) recReady = c.audioWorklet.addModule(URL.createObjectURL(new Blob([REC_CODE], { type: 'application/javascript' })))
    await recReady
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: device ? { exact: device } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 } })
    const src = c.createMediaStreamSource(stream)
    const node = new AudioWorkletNode(c, 'rico-rec', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2, channelCountMode: 'explicit' })
    node.port.onmessage = (e) => { if (rec) rec.parts.push(e.data as [Float32Array, Float32Array]) }
    src.connect(node)
    // Hear yourself through the track's effects while recording.
    if (audioTrack.monitor) { rec.mon = c.createGain(); src.connect(rec.mon); rec.mon.connect(g.tracks.get(audioTrack.id)?.input ?? g.master) }
    Object.assign(rec, { stream, node, src })
  }
  rec.start = idlePos
  await startPlay(idlePos)
  emit()
}

export async function stopRecord() {
  const r = rec
  if (!r) return
  const end = position()
  rec = null
  stopPlay(false)
  r.src?.disconnect(); r.mon?.disconnect(); r.node?.port.close(); r.stream?.getTracks().forEach((t) => t.stop())
  const added: SClip[] = []
  if (r.track && r.parts.length) {
    const c = await audioContext()
    const n = r.parts.reduce((a, p) => a + p[0].length, 0)
    const b = c.createBuffer(2, n, c.sampleRate)
    const L = b.getChannelData(0), R = b.getChannelData(1)
    let o = 0
    for (const [l, rr] of r.parts) { L.set(l, o); R.set(rr, o); o += l.length }
    const src = await addSound(b)
    const take = session.clips.filter((x) => x.track === r.track).length + 1
    added.push({ id: sid(), kind: 'audio', track: r.track, name: `Take ${take}`, start: r.start, offset: 0, length: b.duration, gain: 0, fadeIn: 0, fadeOut: 0, source: src })
  }
  // Notes still held when recording stops end here.
  for (const h of held.values()) recNotes.push({ track: h.track, t: h.t, d: Math.max(0.03, end - h.t), n: h.n, v: h.v })
  const byTrack = new Map<string, typeof recNotes>()
  for (const n of recNotes) byTrack.set(n.track, [...(byTrack.get(n.track) ?? []), n])
  for (const [track, list] of byTrack) {
    const a = r.start
    const len = Math.max(beat(), end - a)
    added.push({ id: sid(), kind: 'notes', track, name: 'Played', start: a, length: len, notes: list.map((x) => ({ t: Math.max(0, x.t - a), d: x.d, n: x.n, v: x.v })) })
  }
  recNotes = []
  idlePos = end
  if (added.length) change('Record', (s) => ({ ...s, clips: [...s.clips, ...added] }))
  else emit()
}

// ---- mixing down ----

export async function mixdown(range?: [number, number]): Promise<AudioBuffer> {
  await loadBuffers()
  const s = session
  const [a, z] = range ?? [0, sessionEnd()]
  const hasVerb = s.tracks.some((t) => t.fx.some((f) => f.on && (f.type === 'reverb' || f.type === 'delay')))
  const tail = hasVerb ? 3 : 0.3
  const rate = 48000
  const off = new OfflineAudioContext(2, Math.ceil((z - a + tail) * rate), rate)
  const g = buildGraph(off, { ...s, metronome: false }, off.destination)
  schedulePass(g, { ...s, metronome: false }, a, z, 0)
  return off.startRendering()
}
export async function saveMixdown(bits: 16 | 24 = 24, range?: [number, number]) {
  const b = await mixdown(range)
  return wav(b, bits)
}

// A note clip made by hand (draw notes in the piano roll).
export function addNoteClip(track: string, at: number, length = beat() * 4) {
  const c: NoteClip = { id: sid(), kind: 'notes', track, name: 'Notes', start: at, length, notes: [] }
  change('New note clip', (s) => ({ ...s, clips: [...s.clips, c] }))
  selectClip(c.id)
  return c
}
