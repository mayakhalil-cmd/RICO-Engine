import { useSyncExternalStore } from 'react'
import { analyserInput, audioContext, getLab } from './lab'

// The sound editor's data: one clip with undo, a selection, and playback.
// Every edit makes a new buffer, so undo is just going back to the old one.

export interface Clip { name: string; buffer: AudioBuffer }

let clip: Clip | null = null
let undoStack: Clip[] = []
let redoStack: Clip[] = []
let sel: [number, number] = [0, 0]       // seconds; equal = just a cursor
let clipboard: AudioBuffer | null = null
let playing: { node: AudioBufferSourceNode; startedAt: number; from: number; loop: boolean } | null = null
let version = 0
const listeners = new Set<() => void>()
const emit = () => { version++; listeners.forEach((l) => l()) }

export function useEditor() {
  useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => version)
  return { clip, sel, canUndo: undoStack.length > 0, canRedo: redoStack.length > 0, playing: Boolean(playing), hasClipboard: Boolean(clipboard) }
}
export const getClip = () => clip

export function setSelection(a: number, b: number) {
  const d = clip?.buffer.duration ?? 0
  sel = [Math.max(0, Math.min(d, Math.min(a, b))), Math.max(0, Math.min(d, Math.max(a, b)))]
  emit()
}

function commit(next: Clip) {
  if (clip) undoStack.push(clip)
  if (undoStack.length > 30) undoStack.shift()
  redoStack = []
  clip = next
  emit()
}
export function undoEdit() {
  const prev = undoStack.pop()
  if (!prev) return
  if (clip) redoStack.push(clip)
  clip = prev
  setSelection(sel[0], sel[1])
}
export function redoEdit() {
  const next = redoStack.pop()
  if (!next) return
  if (clip) undoStack.push(clip)
  clip = next
  setSelection(sel[0], sel[1])
}

export function setClip(buffer: AudioBuffer, name: string, replace = true) {
  if (replace) { commit({ name, buffer }); sel = [0, 0]; emit(); return }
  insertBuffer(buffer, `Add ${name}`)
}

// ---- buffers ----

async function makeBuffer(channels: Float32Array[], rate: number): Promise<AudioBuffer> {
  const c = await audioContext()
  const len = Math.max(1, channels[0]?.length ?? 1)
  const b = c.createBuffer(channels.length, len, rate)
  channels.forEach((d, i) => b.copyToChannel((d.length ? d : new Float32Array(len)) as Float32Array<ArrayBuffer>, i))
  return b
}
const chans = (b: AudioBuffer) => Array.from({ length: b.numberOfChannels }, (_, i) => b.getChannelData(i))
const range = (b: AudioBuffer): [number, number] => {
  const [a, z] = sel
  return z - a > 1e-4 ? [Math.round(a * b.sampleRate), Math.round(z * b.sampleRate)] : [0, b.length]
}

export async function loadFile(f: File) {
  const c = await audioContext()
  const buf = await c.decodeAudioData(await f.arrayBuffer())
  commit({ name: f.name.replace(/\.[^.]+$/, ''), buffer: buf })
  sel = [0, 0]
  emit()
}

export async function newSilence(seconds = 4) {
  const c = await audioContext()
  commit({ name: 'New sound', buffer: c.createBuffer(2, Math.round(seconds * c.sampleRate), c.sampleRate) })
}

// ---- cut, copy, paste ----

export async function copySel() {
  if (!clip) return
  const b = clip.buffer
  const [a, z] = range(b)
  clipboard = await makeBuffer(chans(b).map((d) => d.slice(a, z)), b.sampleRate)
  emit()
}
export async function deleteSel(label = 'Delete') {
  if (!clip || sel[1] - sel[0] < 1e-4) return
  const b = clip.buffer
  const [a, z] = range(b)
  commit({ name: clip.name, buffer: await makeBuffer(chans(b).map((d) => { const o = new Float32Array(d.length - (z - a)); o.set(d.subarray(0, a)); o.set(d.subarray(z), a); return o }), b.sampleRate) })
  sel = [sel[0], sel[0]]
  emit()
  void label
}
export async function cutSel() { await copySel(); await deleteSel('Cut') }

async function insertBuffer(ins: AudioBuffer, _label: string) {
  if (!clip) { commit({ name: 'Sound', buffer: ins }); return }
  const b = clip.buffer
  const at = Math.round(sel[0] * b.sampleRate)
  const end = sel[1] - sel[0] > 1e-4 ? Math.round(sel[1] * b.sampleRate) : at
  const insCh = chans(ins)
  const out = chans(b).map((d, i) => {
    const src = insCh[Math.min(i, insCh.length - 1)]
    const o = new Float32Array(d.length - (end - at) + src.length)
    o.set(d.subarray(0, at)); o.set(src, at); o.set(d.subarray(end), at + src.length)
    return o
  })
  commit({ name: clip.name, buffer: await makeBuffer(out, b.sampleRate) })
  sel = [sel[0], sel[0] + ins.duration]
  emit()
}
export async function paste() { if (clipboard) await insertBuffer(clipboard, 'Paste') }
export async function insertSilence(seconds = 1) {
  const c = await audioContext()
  await insertBuffer(c.createBuffer(2, Math.round(seconds * c.sampleRate), c.sampleRate), 'Insert silence')
}
export async function crop() {
  if (!clip || sel[1] - sel[0] < 1e-4) return
  const b = clip.buffer
  const [a, z] = range(b)
  commit({ name: clip.name, buffer: await makeBuffer(chans(b).map((d) => d.slice(a, z)), b.sampleRate) })
  sel = [0, 0]
  emit()
}

// ---- sample processing on the selection (or everything) ----

async function processSamples(fn: (d: Float32Array, ch: number, rate: number) => Float32Array | void) {
  if (!clip) return
  const b = clip.buffer
  const [a, z] = range(b)
  const out = chans(b).map((d, ch) => {
    const o = d.slice()
    const part = o.subarray(a, z)
    const res = fn(part, ch, b.sampleRate)
    if (res && res.length === part.length) part.set(res)
    return o
  })
  commit({ name: clip.name, buffer: await makeBuffer(out, b.sampleRate) })
}

export const gain = (dB: number) => processSamples((d) => { const g = Math.pow(10, dB / 20); for (let i = 0; i < d.length; i++) d[i] *= g })
export async function normalize(toDb = -1) {
  if (!clip) return
  const [a, z] = range(clip.buffer)
  let peak = 0
  for (const d of chans(clip.buffer)) for (let i = a; i < z; i++) peak = Math.max(peak, Math.abs(d[i]))
  if (peak < 1e-6) return
  const g = Math.pow(10, toDb / 20) / peak
  await processSamples((d) => { for (let i = 0; i < d.length; i++) d[i] *= g })
}
export const fade = (dir: 'in' | 'out', shape: 'linear' | 'smooth' | 'exp' = 'smooth') => processSamples((d) => {
  const n = d.length
  for (let i = 0; i < n; i++) {
    let t = i / Math.max(1, n - 1)
    if (dir === 'out') t = 1 - t
    const g = shape === 'linear' ? t : shape === 'exp' ? t * t * t : 0.5 - 0.5 * Math.cos(Math.PI * t)
    d[i] *= g
  }
})
export const reverse = () => processSamples((d) => { d.reverse() })
export const invert = () => processSamples((d) => { for (let i = 0; i < d.length; i++) d[i] = -d[i] })
export const silence = () => processSamples((d) => { d.fill(0) })
export const bitcrush = (bits: number, every: number) => processSamples((d) => {
  const q = Math.pow(2, bits - 1)
  let hold = 0
  for (let i = 0; i < d.length; i++) { if (i % every === 0) hold = Math.round(d[i] * q) / q; d[i] = hold }
})
export const gate = (thresholdDb: number) => processSamples((d, _c, rate) => {
  const thr = Math.pow(10, thresholdDb / 20)
  let env = 0, g = 0
  const a = Math.exp(-1 / (0.002 * rate)), r = Math.exp(-1 / (0.08 * rate))
  for (let i = 0; i < d.length; i++) {
    const x = Math.abs(d[i])
    env = x > env ? x : env * 0.9995
    const target = env > thr ? 1 : 0
    g = target > g ? target + (g - target) * a : target + (g - target) * r
    d[i] *= g
  }
})

// Mono, or swap left and right.
export async function channels(op: 'mono' | 'swap') {
  if (!clip) return
  const b = clip.buffer
  const c = chans(b)
  if (c.length < 2) return
  const [a, z] = range(b)
  const l = c[0].slice(), r = c[1].slice()
  for (let i = a; i < z; i++) {
    if (op === 'mono') { const m = (l[i] + r[i]) * 0.5; l[i] = m; r[i] = m } else { const t = l[i]; l[i] = r[i]; r[i] = t }
  }
  commit({ name: clip.name, buffer: await makeBuffer([l, r], b.sampleRate) })
}

// Speed: faster is higher and shorter, like a turntable.
export async function speed(ratio: number) {
  if (!clip || ratio <= 0) return
  const b = clip.buffer
  const [a, z] = range(b)
  const out = chans(b).map((d) => {
    const part = d.subarray(a, z)
    const n = Math.max(1, Math.round(part.length / ratio))
    const st = new Float32Array(n)
    for (let i = 0; i < n; i++) { const x = i * ratio, i0 = Math.floor(x), f = x - i0; st[i] = (part[i0] ?? 0) * (1 - f) + (part[i0 + 1] ?? part[i0] ?? 0) * f }
    const o = new Float32Array(d.length - part.length + n)
    o.set(d.subarray(0, a)); o.set(st, a); o.set(d.subarray(z), a + n)
    return o
  })
  commit({ name: clip.name, buffer: await makeBuffer(out, b.sampleRate) })
  if (sel[1] > sel[0]) { sel = [sel[0], sel[0] + (sel[1] - sel[0]) / ratio]; emit() }
}

// ---- effects that use the audio engine (rendered offline, exactly) ----

export type FxKind = 'lowcut' | 'highcut' | 'bell' | 'lowshelf' | 'highshelf' | 'compress' | 'reverb' | 'echo' | 'drive'
export interface FxParams { freq?: number; q?: number; db?: number; mix?: number; time?: number; feedback?: number; amount?: number; threshold?: number; ratio?: number; size?: number }

function impulse(c: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const n = Math.round(seconds * c.sampleRate)
  const b = c.createBuffer(2, n, c.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch)
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay)
  }
  return b
}

export async function effect(kind: FxKind, p: FxParams) {
  if (!clip) return
  const b = clip.buffer
  const [a, z] = range(b)
  const tail = kind === 'reverb' ? Math.round((p.size ?? 2) * b.sampleRate) : kind === 'echo' ? Math.round((p.time ?? 0.3) * 6 * b.sampleRate) : 0
  const len = z - a
  const off = new OfflineAudioContext(b.numberOfChannels, len + tail, b.sampleRate)
  const part = off.createBuffer(b.numberOfChannels, len, b.sampleRate)
  chans(b).forEach((d, i) => part.copyToChannel(d.slice(a, z), i))
  const src = off.createBufferSource()
  src.buffer = part
  const dry = off.createGain(), wet = off.createGain()
  const mix = p.mix ?? 1
  let node: AudioNode
  if (kind === 'compress') {
    const comp = off.createDynamicsCompressor()
    comp.threshold.value = p.threshold ?? -24
    comp.ratio.value = p.ratio ?? 4
    comp.attack.value = 0.005
    comp.release.value = 0.15
    const make = off.createGain()
    make.gain.value = Math.pow(10, (p.db ?? 0) / 20)
    comp.connect(make)
    node = comp
    src.connect(comp)
    make.connect(wet)
  } else if (kind === 'reverb') {
    const conv = off.createConvolver()
    conv.buffer = impulse(off, p.size ?? 2, 3)
    src.connect(conv); conv.connect(wet)
    node = conv
  } else if (kind === 'echo') {
    const delay = off.createDelay(5)
    delay.delayTime.value = p.time ?? 0.3
    const fb = off.createGain()
    fb.gain.value = p.feedback ?? 0.4
    src.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(wet)
    node = delay
  } else if (kind === 'drive') {
    const ws = off.createWaveShaper()
    const k = (p.amount ?? 0.5) * 100
    const curve = new Float32Array(1024)
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x)) }
    ws.curve = curve
    ws.oversample = '4x'
    src.connect(ws); ws.connect(wet)
    node = ws
  } else {
    const f = off.createBiquadFilter()
    f.type = ({ lowcut: 'highpass', highcut: 'lowpass', bell: 'peaking', lowshelf: 'lowshelf', highshelf: 'highshelf' } as const)[kind]
    f.frequency.value = p.freq ?? 1000
    f.Q.value = p.q ?? 0.707
    f.gain.value = p.db ?? 0
    src.connect(f); f.connect(wet)
    node = f
  }
  void node
  dry.gain.value = kind === 'reverb' || kind === 'echo' ? 1 : 1 - mix
  wet.gain.value = mix
  src.connect(dry)
  dry.connect(off.destination); wet.connect(off.destination)
  src.start()
  const rendered = await off.startRendering()
  const r = chans(rendered)
  // Put the result back; reverb and echo tails mix into what comes after.
  const out = chans(b).map((d, ch) => {
    const o = new Float32Array(Math.max(d.length, a + r[ch].length))
    o.set(d)
    for (let i = 0; i < r[ch].length; i++) {
      const j = a + i
      o[j] = i < len ? r[ch][i] : o[j] + r[ch][i]
    }
    return o
  })
  commit({ name: clip.name, buffer: await makeBuffer(out, b.sampleRate) })
}

// ---- playback ----

export async function play(loop = false) {
  stopPlay()
  if (!clip) return
  const c = await audioContext()
  const node = c.createBufferSource()
  node.buffer = clip.buffer
  node.connect(c.destination)
  const lab = getLab()
  if (lab.running && lab.source === 'player') node.connect(await analyserInput())
  const hasSel = sel[1] - sel[0] > 1e-3
  const from = sel[0]
  if (loop && hasSel) { node.loop = true; node.loopStart = sel[0]; node.loopEnd = sel[1] }
  node.start(0, from, loop ? undefined : hasSel ? sel[1] - sel[0] : undefined)
  node.onended = () => { if (playing?.node === node) { playing = null; emit() } }
  playing = { node, startedAt: c.currentTime, from, loop: node.loop }
  emit()
}
export function stopPlay() {
  if (!playing) return
  try { playing.node.stop() } catch { /* already stopped */ }
  playing = null
  emit()
}
export function playhead(): number | null {
  if (!playing) return null
  const c = playing.node.context
  const t = c.currentTime - playing.startedAt
  if (playing.loop && sel[1] > sel[0]) return sel[0] + (t % (sel[1] - sel[0]))
  return playing.from + t
}

// ---- WAV ----

export function wav(b: AudioBuffer, bits: 16 | 24 = 24, from = 0, to = b.length): Blob {
  const ch = b.numberOfChannels, n = to - from, bytes = bits / 8
  const buf = new ArrayBuffer(44 + n * ch * bytes)
  const v = new DataView(buf)
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); v.setUint32(4, 36 + n * ch * bytes, true); str(8, 'WAVE'); str(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, b.sampleRate, true)
  v.setUint32(28, b.sampleRate * ch * bytes, true); v.setUint16(32, ch * bytes, true); v.setUint16(34, bits, true)
  str(36, 'data'); v.setUint32(40, n * ch * bytes, true)
  const data = chans(b)
  let o = 44
  for (let i = from; i < to; i++) {
    for (let c = 0; c < ch; c++) {
      const x = Math.max(-1, Math.min(1, data[c][i]))
      if (bits === 16) { v.setInt16(o, Math.round(x * 32767), true); o += 2 } else {
        const s = Math.round(x * 8388607)
        v.setUint8(o, s & 255); v.setUint8(o + 1, (s >> 8) & 255); v.setUint8(o + 2, (s >> 16) & 255); o += 3
      }
    }
  }
  return new Blob([buf], { type: 'audio/wav' })
}

export function exportRange(): [number, number] {
  if (!clip) return [0, 0]
  return range(clip.buffer)
}

// ---- recording from a microphone ----

let recorder: MediaRecorder | null = null
export async function record(on: boolean) {
  if (!on) { recorder?.stop(); return }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
  const parts: Blob[] = []
  recorder = new MediaRecorder(stream)
  recorder.ondataavailable = (e) => parts.push(e.data)
  recorder.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop())
    recorder = null
    const c = await audioContext()
    try {
      const b = await c.decodeAudioData(await new Blob(parts).arrayBuffer())
      setClip(b, 'Recording', !clip)
    } catch { /* nothing recorded */ }
    emit()
  }
  recorder.start()
  emit()
}
export const isRecording = () => Boolean(recorder)
