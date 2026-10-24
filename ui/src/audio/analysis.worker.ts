/// <reference lib="webworker" />
import { FFT, hann } from './fft'
import { rbj, type Biquad } from './dsp'
import { SCENE_DEFAULT, SHAPE_DEFAULT, SPEC_POINTS, specHz, type Band, type Features, type LabFrame, type LabSettings, type Shape } from './types'

// The audio analysis, on its own thread so the interface never waits for it.
// PCM comes in (from RICO's system-audio capture, a microphone, a file or
// the generator), and about 60 times a second the bands, the features and
// the spectrum go back out.

let settings: LabSettings = { fftSize: 4096, inputGain: 0, weighting: 'none', bands: [] }
let rate = 48000
let channels = 2
const HOP = 512

// buffers
const RING = 1 << 16
const ringL = new Float32Array(RING)
const ringR = new Float32Array(RING)
let write = 0
let sinceHop = 0
let samplePeak = 0
let clipHold = 0

let fft = new FFT(4096)
let win = hann(4096)
let prevMag = new Float64Array(2048)
let mag = new Float64Array(2048)

function resize(n: number) {
  fft = new FFT(n)
  win = hann(n)
  prevMag = new Float64Array(n / 2)
  mag = new Float64Array(n / 2)
}

// loudness (EBU R128 / BS.1770 K-weighting)
let kShelf: Biquad, kHigh: Biquad
const kState = [new Float64Array(4), new Float64Array(4)]       // per channel: two stages x2 memory
const kState2 = [new Float64Array(4), new Float64Array(4)]
function makeK() {
  let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196
  let K = Math.tan((Math.PI * f0) / rate)
  const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416)
  let a0 = 1 + K / Q + K * K
  kShelf = { b0: (Vh + (Vb * K) / Q + K * K) / a0, b1: (2 * (K * K - Vh)) / a0, b2: (Vh - (Vb * K) / Q + K * K) / a0, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 }
  f0 = 38.13547087602444; Q = 0.5003270373238773
  K = Math.tan((Math.PI * f0) / rate)
  a0 = 1 + K / Q + K * K
  kHigh = { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 }
}
makeK()
function biquad(f: Biquad, s: Float64Array, x: number) {
  // Direct form I: s = [x1, x2, y1, y2]
  const y = f.b0 * x + f.b1 * s[0] + f.b2 * s[1] - f.a1 * s[2] - f.a2 * s[3]
  s[1] = s[0]; s[0] = x; s[3] = s[2]; s[2] = y
  return y
}
// shaping (filters, gate, compressor) before the analysis
let shapeFilters: Biquad[] = []
let shapeState: Float64Array[][] = [[], []]
let shapeKey = ''
let dynEnv = 0, gateGain = 1, compRed = 0
function buildShape(sh: Shape) {
  const key = JSON.stringify([sh.hp, sh.lp, sh.low, sh.mid, sh.midHz, sh.midQ, sh.high, rate])
  if (key === shapeKey) return
  shapeKey = key
  shapeFilters = []
  if (sh.hp > 0) shapeFilters.push(rbj('hp', sh.hp, 0.707, 0, rate))
  if (sh.low) shapeFilters.push(rbj('low', 120, 0.707, sh.low, rate))
  if (sh.mid) shapeFilters.push(rbj('bell', sh.midHz, Math.max(0.1, sh.midQ), sh.mid, rate))
  if (sh.high) shapeFilters.push(rbj('high', 6000, 0.707, sh.high, rate))
  if (sh.lp > 0) shapeFilters.push(rbj('lp', sh.lp, 0.707, 0, rate))
  shapeState = [shapeFilters.map(() => new Float64Array(4)), shapeFilters.map(() => new Float64Array(4))]
}

let blockSum = 0, blockCount = 0
const blocks: number[] = []   // mean square of each 100 ms block, last 30

// per band memory
interface BandMem { env: number; slowMax: number; lastDb: number; fluxHist: number[]; lastHit: number; hit: number }
let mem: BandMem[] = []
const freshMem = (): BandMem => ({ env: 0, slowMax: -60, lastDb: -120, fluxHist: [], lastHit: -1, hit: 0 })

// onsets and tempo
const fluxHist: number[] = []
const onsetEnv: number[] = []        // ~8 s of onset strength, one value per hop
let onset = 0, lastOnsetT = -1, beat = 0, lastBeatT = -1
let bpm = 120, bpmConf = 0, lastTempo = 0
let pitchHz = 0, clarity = 0, lastPitch = 0
let time = 0

// harmonic and percussive parts (HPSS on the drawing spectrum)
const HPSS_T = 11
const specHist: Float32Array[] = []
let harmonicFrac = 0.5
// what is playing
const SCENE_SEC = 1.6
const speechEnv: number[] = []      // speech band level per hop, dB
const rmsHist: number[] = []        // linear power per hop
const voicedHist: number[] = []     // 1 when a voice-like pitch is there
const hfHist: number[] = []
const flatHist: number[] = []
let chromaAvg = new Array(12).fill(0)
let kinds: [number, number, number, number] = [1, 0, 0, 0]
let lastScene = 0
const median = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b[b.length >> 1] }
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const bell = (v: number, mid: number, width: number) => Math.exp(-0.5 * ((v - mid) / width) ** 2)
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)

function modulation(env: number[], fps: number): number {
  // Share of the envelope's movement that sits at 2.5 to 7 Hz: the rate of
  // syllables. Speech has a lot there, music and steady noise much less.
  const n = env.length
  if (n < fps) return 0
  const m = avg(env)
  const x = env.map((v) => v - m)
  let band = 0, all = 0
  for (let f = 0.5; f <= 16; f += 0.5) {
    let re = 0, im = 0
    for (let i = 0; i < n; i++) { const a = (2 * Math.PI * f * i) / fps; re += x[i] * Math.cos(a); im += x[i] * Math.sin(a) }
    const p = re * re + im * im
    all += p
    if (f >= 2.5 && f <= 7) band += p
  }
  return all > 0 ? band / all : 0
}

function scene(f: { lufsM: number; rms: number; centroid: number; flatness: number; chroma: number[] }, speechDb: number) {
  const tune = { ...SCENE_DEFAULT, ...(settings.scene ?? {}) }
  const fps = rate / HOP
  const keep = Math.round(SCENE_SEC * fps)
  speechEnv.push(speechDb); if (speechEnv.length > keep) speechEnv.shift()
  rmsHist.push(Math.pow(10, f.rms / 10)); if (rmsHist.length > keep) rmsHist.shift()
  voicedHist.push(pitchHz > 75 && pitchHz < 500 && clarity > 0.6 ? 1 : 0); if (voicedHist.length > keep) voicedHist.shift()
  hfHist.push(harmonicFrac); if (hfHist.length > keep) hfHist.shift()
  flatHist.push(f.flatness); if (flatHist.length > keep) flatHist.shift()
  chromaAvg = chromaAvg.map((c, i) => c * 0.97 + f.chroma[i] * 0.03)
  if (time - lastScene < 0.1) return
  const dt = time - lastScene
  lastScene = time

  const syll = modulation(speechEnv, fps)
  // Pauses: moments far under the loud parts (speech stops between words,
  // music rarely drops that far).
  const sortedDb = rmsHist.map((p) => 10 * Math.log10(p + 1e-12)).sort((x, y) => x - y)
  const loud = sortedDb[Math.floor(sortedDb.length * 0.9)] ?? -120
  const lowEnergy = sortedDb.filter((d) => d < loud - 24).length / Math.max(1, sortedDb.length)
  const voiced = avg(voicedHist)
  const hf = avg(hfHist)
  const flat = avg(flatHist)
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < 12; i++) { dot += chromaAvg[i] * f.chroma[i]; na += chromaAvg[i] ** 2; nb += f.chroma[i] ** 2 }
  const steadyNotes = na > 0 && nb > 0 ? (dot / Math.sqrt(na * nb)) * (1 - flat) : 0

  const beatN = clamp01((bpmConf - 0.3) / 0.5)     // a real, steady beat
  const sp = 0.3 * clamp01(syll * 2) + 0.25 * bell(lowEnergy, 0.3, 0.2) + 0.25 * bell(voiced, 0.5, 0.25) + 0.2 * (1 - beatN) - 0.25 * beatN + 0.3 * tune.speech
  const mu = 0.5 * beatN + 0.15 * clamp01(hf * 1.4 - 0.3) + 0.15 * (1 - clamp01(lowEnergy * 3)) + 0.2 * clamp01(steadyNotes * 1.2 - 0.1) + 0.3 * tune.music
  const fo = 0.3 * clamp01((1 - hf) * 1.6 - 0.3) + 0.2 * clamp01(flat * 4) + 0.25 * (1 - beatN) + 0.25 * (1 - clamp01(voiced * 2.5)) + 0.3 * tune.foley
  const T = 0.09
  const e = [Math.exp(sp / T), Math.exp(mu / T), Math.exp(fo / T)]
  const sum = e[0] + e[1] + e[2]
  // Silence over the last moment (not one quiet gap between two footsteps).
  const avgDb = 10 * Math.log10(avg(rmsHist) + 1e-12)
  const sil = clamp01((tune.silence + 4 - Math.max(f.lufsM, avgDb)) / 8)
  const target: [number, number, number, number] = [sil, (1 - sil) * e[0] / sum, (1 - sil) * e[1] / sum, (1 - sil) * e[2] / sum]
  const k = 1 - Math.exp(-dt / Math.max(0.05, tune.smooth))
  kinds = kinds.map((v, i) => v + (target[i] - v) * k) as typeof kinds
}

let busyMs = 0, busyAt = 0, busyAudio = 0

const db = (p: number) => 10 * Math.log10(Math.max(p, 1e-12))
const aWeight = (f: number) => {
  const f2 = f * f
  const ra = (12194 ** 2 * f2 * f2) / ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2))
  return ra * ra * 1.2589    // power, +2 dB at 1 kHz
}

function bandPower(lo: number, hi: number, n: number) {
  // Sums power over bins, counting the edge bins in part, so narrow bands stay accurate.
  const hz = rate / n
  const a = Math.max(0, lo / hz), b = Math.min(n / 2 - 1, hi / hz)
  if (b <= a) {
    const i = Math.min(n / 2 - 1, Math.round(a))
    return mag[i] * Math.max(0.02, b - a)
  }
  let p = 0
  const i0 = Math.floor(a), i1 = Math.floor(b)
  for (let i = i0; i <= i1; i++) {
    let w = 1
    if (i === i0) w -= a - i0
    if (i === i1) w -= 1 - (b - i1)
    p += mag[i] * Math.max(0, w)
  }
  return p
}

function yin(buf: Float32Array): [number, number] {
  const W = 1024
  const maxTau = Math.min(Math.floor(rate / 50), buf.length - W)
  const minTau = Math.floor(rate / 1200)
  const d = new Float64Array(maxTau + 1)
  for (let tau = 1; tau <= maxTau; tau++) {
    let s = 0
    for (let i = 0; i < W; i++) { const x = buf[i] - buf[i + tau]; s += x * x }
    d[tau] = s
  }
  let run = 0
  let best = -1
  for (let tau = 1; tau <= maxTau; tau++) {
    run += d[tau]
    const c = run > 0 ? (d[tau] * tau) / run : 1
    d[tau] = c
  }
  for (let tau = minTau; tau <= maxTau; tau++) {
    if (d[tau] < 0.15) {
      while (tau + 1 <= maxTau && d[tau + 1] < d[tau]) tau++
      best = tau
      break
    }
  }
  if (best < 0) return [0, 0]
  // Parabolic interpolation for a finer pitch.
  const a = d[best - 1] ?? d[best], b = d[best], c = d[best + 1] ?? d[best]
  const shift = (a - c) / (2 * (a - 2 * b + c) || 1)
  return [rate / (best + (Number.isFinite(shift) ? shift : 0)), Math.max(0, 1 - b)]
}

function tempo() {
  const fps = rate / HOP
  const env = onsetEnv
  if (env.length < fps * 4) return
  const mean = env.reduce((a, b) => a + b, 0) / env.length
  const x = env.map((v) => v - mean)
  let bestLag = 0, best = 0, total = 0, bestRaw = 0
  let r0 = 0
  for (const v of x) r0 += v * v
  const scores: [number, number][] = []
  for (let b = 60; b <= 200; b += 0.5) {
    const lag = (60 * fps) / b
    const l0 = Math.floor(lag), fr = lag - l0
    let s = 0
    for (let i = l0 + 1; i < x.length; i++) s += x[i] * (x[i - l0] * (1 - fr) + x[i - l0 - 1] * fr)
    // A gentle preference for 90 to 160 BPM, where most music sits.
    const w = Math.exp(-0.5 * Math.pow(Math.log2(b / 125) / 0.6, 2))
    const raw = s
    s *= 0.6 + 0.4 * w
    scores.push([b, s])
    total += Math.max(0, s)
    if (s > best) { best = s; bestLag = b; bestRaw = raw }
  }
  if (bestLag > 0) {
    // How much the onsets repeat at that tempo: 0 no pattern, 1 a steady beat.
    const conf = r0 > 0 ? (bestRaw / r0) * 2.2 : 0
    void total
    bpm = bpm * 0.6 + bestLag * 0.4
    if (Math.abs(bpm - bestLag) > 8) bpm = bestLag
    bpmConf = Math.max(0, Math.min(1, conf))
  }
}

function analyse(): void {
  const n = settings.fftSize
  const start = performance.now()
  const dt = HOP / rate
  time += dt
  // Window the newest n samples (mono).
  const re = fft.re, im = fft.im
  for (let i = 0; i < n; i++) {
    const j = (write - n + i + RING) % RING
    re[i] = (ringL[j] + ringR[j]) * 0.5 * win[i]
    im[i] = 0
  }
  fft.run()
  // Power per bin, scaled so a full-scale sine is about 0 dB.
  const norm = 4 / (n * n * 0.25)
  const hz = rate / n
  const weighting = settings.weighting === 'a'
  let total = 0, centroidNum = 0, magSum = 0, logSum = 0, flux = 0
  for (let i = 0; i < n / 2; i++) {
    let p = (re[i] * re[i] + im[i] * im[i]) * norm
    if (weighting && i > 0) p *= aWeight(i * hz)
    mag[i] = p
    total += p
    const a = Math.sqrt(p)
    centroidNum += a * i * hz
    magSum += a
    logSum += Math.log(p + 1e-12)
    const m = Math.log(1 + 1000 * Math.sqrt(p)), pm = Math.log(1 + 1000 * Math.sqrt(prevMag[i]))
    if (m > pm) flux += m - pm
    prevMag[i] = p
  }
  const centroid = magSum > 0 ? centroidNum / magSum : 0
  let acc = 0, rolloff = 0
  for (let i = 0; i < n / 2; i++) { acc += mag[i]; if (acc >= total * 0.85) { rolloff = i * hz; break } }
  const flatness = total > 1e-10 ? Math.max(0, Math.min(1, Math.exp(logSum / (n / 2)) / (total / (n / 2)))) : 0

  // Onsets: spectral flux above its recent average.
  fluxHist.push(flux)
  if (fluxHist.length > 43) fluxHist.shift()
  const fm = fluxHist.reduce((a, b) => a + b, 0) / fluxHist.length
  const fs = Math.sqrt(fluxHist.reduce((a, b) => a + (b - fm) ** 2, 0) / fluxHist.length)
  onsetEnv.push(Math.max(0, flux - fm))
  if (onsetEnv.length > Math.round((8 * rate) / HOP)) onsetEnv.shift()
  onset = Math.max(0, onset - dt * 8)
  if (flux > fm + 1.6 * fs && flux > 1 && time - lastOnsetT > 0.09) {
    onset = 1
    lastOnsetT = time
    const period = 60 / bpm
    if (time - lastBeatT > period * 0.6) { beat = 1; lastBeatT = time }
  }
  // Keep the beat going between clear onsets when the tempo is known.
  if (bpmConf > 0.3 && lastBeatT > 0 && time - lastBeatT > 60 / bpm) { beat = 1; lastBeatT += 60 / bpm }
  beat = Math.max(0, beat - dt * 6)
  if (time - lastTempo > 0.5) { lastTempo = time; tempo() }

  // Bands.
  const bands = settings.bands
  if (mem.length !== bands.length) mem = bands.map((_, i) => mem[i] ?? freshMem())
  const out: number[] = [], hits: number[] = [], dbs: number[] = []
  bands.forEach((b: Band, i) => {
    const m = mem[i]
    if (!b.on) { out.push(0); hits.push(0); dbs.push(-120); return }
    const level = db(bandPower(b.lo, b.hi, n)) + b.gain + settings.inputGain
    dbs.push(level)
    // Hits: the band's level jumping up faster than usual.
    const rise = Math.max(0, level - m.lastDb)
    m.lastDb = level
    m.fluxHist.push(rise)
    if (m.fluxHist.length > 43) m.fluxHist.shift()
    const hm = m.fluxHist.reduce((a, x) => a + x, 0) / m.fluxHist.length
    const hs = Math.sqrt(m.fluxHist.reduce((a, x) => a + (x - hm) ** 2, 0) / m.fluxHist.length)
    m.hit = Math.max(0, m.hit - dt / Math.max(0.02, b.release / 1000))
    if (rise > hm + (3 - 2.5 * b.sens) * hs && rise > 1.5 && level > b.floor && time - m.lastHit > 0.07) { m.hit = 1; m.lastHit = time }
    // Level to 0..1.
    m.slowMax = Math.max(level, m.slowMax - dt * 4)      // falls 4 dB a second
    const range = Math.max(6, b.ceiling - b.floor)
    const top = b.auto ? Math.max(m.slowMax, b.floor + range * 0.5) : b.ceiling
    let v = (level - (top - range)) / range
    v = Math.max(0, Math.min(1, v))
    v = Math.pow(v, b.curve)
    if (b.gate > 0) v = v <= b.gate ? 0 : (v - b.gate) / (1 - b.gate)
    if (b.mode === 'hit') v = m.hit
    const target = v
    if (b.mode === 'peak') {
      m.env = target > m.env ? target : m.env + (target - m.env) * (1 - Math.exp(-dt / Math.max(0.005, b.release / 1000)))
    } else {
      const tau = (target > m.env ? b.attack : b.release) / 1000
      m.env += (target - m.env) * (1 - Math.exp(-dt / Math.max(0.001, tau)))
    }
    out.push(m.env)
    hits.push(m.hit)
  })

  // Pitch, about 20 times a second.
  if (time - lastPitch > 0.05) {
    lastPitch = time
    const buf = new Float32Array(2048 + 1100)
    for (let i = 0; i < buf.length; i++) { const j = (write - buf.length + i + RING) % RING; buf[i] = (ringL[j] + ringR[j]) * 0.5 }
    const [p, c] = yin(buf)
    pitchHz = c > 0.5 ? p : 0
    clarity = c
  }

  // Chroma (12 pitch classes) from 55 Hz to 5 kHz.
  const chroma = new Array(12).fill(0)
  for (let i = Math.ceil(55 / hz); i < Math.min(n / 2, 5000 / hz); i++) {
    const midi = 69 + 12 * Math.log2((i * hz) / 440)
    chroma[((Math.round(midi) % 12) + 12) % 12] += mag[i]
  }
  const cmax = Math.max(...chroma, 1e-12)

  // Stereo and level over the hop.
  let sl = 0, sr = 0, slr = 0, ss = 0
  for (let k = 0; k < HOP; k++) {
    const j = (write - HOP + k + RING) % RING
    const l = ringL[j], r = ringR[j]
    sl += l * l; sr += r * r; slr += l * r; ss += ((l + r) * 0.5) ** 2
  }
  const correlation = sl > 1e-12 && sr > 1e-12 ? slr / Math.sqrt(sl * sr) : 1
  const rms = db(ss / HOP) + settings.inputGain

  // Loudness: 100 ms blocks.
  const lufsOf = (k: number) => {
    const list = blocks.slice(-k)
    if (!list.length) return -70
    return -0.691 + 10 * Math.log10(Math.max(1e-12, list.reduce((a, b) => a + b, 0) / list.length))
  }

  // The spectrum for drawing: log-spaced points, in dB.
  const spectrum = new Float32Array(SPEC_POINTS)
  for (let i = 0; i < SPEC_POINTS; i++) {
    const f0 = specHz(i - 0.5), f1 = specHz(i + 0.5)
    spectrum[i] = db(bandPower(f0, f1, n) / Math.max(1, (f1 - f0) / hz)) + settings.inputGain
  }
  // Harmonic vs percussive: a sound that holds across time is harmonic, one
  // that spreads across frequency for a moment is percussive.
  const lin = new Float32Array(SPEC_POINTS)
  for (let i = 0; i < SPEC_POINTS; i++) lin[i] = Math.pow(10, spectrum[i] / 10)
  specHist.push(lin)
  if (specHist.length > HPSS_T) specHist.shift()
  let eh = 0, ep = 0
  const col: number[] = [], row: number[] = []
  for (let i = 0; i < SPEC_POINTS; i++) {
    col.length = 0
    for (const h of specHist) col.push(h[i])
    row.length = 0
    for (let j = Math.max(0, i - 4); j <= Math.min(SPEC_POINTS - 1, i + 4); j++) row.push(lin[j])
    const H = median(col), P = median(row)
    const m = (H * H) / (H * H + P * P + 1e-30)
    eh += lin[i] * m
    ep += lin[i] * (1 - m)
  }
  harmonicFrac = eh + ep > 0 ? eh / (eh + ep) : 0.5
  const level01 = clamp01((Math.max(rms, lufsOf(4)) + 60) / 54)
  const chromaN = chroma.map((c) => c / cmax)
  scene({ lufsM: lufsOf(4), rms, centroid, flatness, chroma: chromaN }, db(bandPower(300, 3400, n)) + settings.inputGain)
  const speechLvl = clamp01((db(bandPower(300, 3400, n)) + settings.inputGain + 60) / 54)

  const scope = new Float32Array(512)
  for (let i = 0; i < 512; i++) { const j = (write - 1024 + i * 2 + RING) % RING; scope[i] = (ringL[j] + ringR[j]) * 0.5 }

  busyMs += performance.now() - start
  busyAudio += dt
  if (busyAudio >= 1) { busyAt = busyMs / busyAudio; busyMs = 0; busyAudio = 0 }

  latest = {
    bands: out, hits, db: dbs, spectrum, scope, ms: busyAt,
    features: {
      rms, peak: db(samplePeak * samplePeak) + settings.inputGain, lufsM: lufsOf(4), lufsS: lufsOf(30),
      centroid, rolloff, flatness, bpm, bpmConfidence: bpmConf, beat, onset,
      beatPhase: lastBeatT > 0 ? ((time - lastBeatT) / (60 / bpm)) % 1 : 0,
      pitch: pitchHz, clarity, correlation, width: Math.max(0, Math.min(1, (1 - correlation) / 2 * 2)),
      chroma: chromaN, rate, clip: clipHold > 0,
      kinds: [...kinds] as Features['kinds'],
      kindLevels: [kinds[0], kinds[1] * speechLvl, kinds[2] * level01, kinds[3] * level01],
      harmonic: harmonicFrac * level01, percussive: (1 - harmonicFrac) * level01,
      gateOpen: gateGain > 0.5, reduction: compRed,
    } satisfies Features,
  }
  samplePeak *= 0.9
  clipHold = Math.max(0, clipHold - dt)
}

let latest: LabFrame | null = null
let lastPost = 0

function take(data: Float32Array, ch: number) {
  const g = Math.pow(10, settings.inputGain / 20)
  const frames = Math.floor(data.length / ch)
  const sh = settings.shape && settings.shape.on ? { ...SHAPE_DEFAULT, ...settings.shape } : null
  if (sh) buildShape(sh)
  const atk = Math.exp(-1 / (0.005 * rate)), rel = Math.exp(-1 / (0.12 * rate))
  const gateK = Math.exp(-1 / (0.02 * rate))
  const makeup = sh ? Math.pow(10, sh.makeup / 20) : 1
  for (let f = 0; f < frames; f++) {
    let l = data[f * ch], r = ch > 1 ? data[f * ch + 1] : l
    if (sh) {
      l *= g; r *= g
      for (let k = 0; k < shapeFilters.length; k++) { l = biquad(shapeFilters[k], shapeState[0][k], l); r = biquad(shapeFilters[k], shapeState[1][k], r) }
      const a = Math.max(Math.abs(l), Math.abs(r))
      dynEnv = a > dynEnv ? a + (dynEnv - a) * atk : a + (dynEnv - a) * rel
      const lv = 20 * Math.log10(dynEnv + 1e-9)
      const gateT = sh.gate > -99 && lv < sh.gate ? 0 : 1
      gateGain = gateT + (gateGain - gateT) * gateK
      compRed = sh.comp < 0 && lv > sh.comp ? (lv - sh.comp) * (1 - 1 / Math.max(1, sh.ratio)) : 0
      const k = gateGain * Math.pow(10, -compRed / 20) * makeup / g
      l *= k; r *= k
    }
    ringL[write] = l
    ringR[write] = r
    const a = Math.max(Math.abs(l), Math.abs(r))
    if (a > samplePeak) samplePeak = a
    if (a * g >= 0.999) clipHold = 1.5
    // K-weighted loudness, per channel.
    const kl = biquad(kHigh, kState2[0], biquad(kShelf, kState[0], l * g))
    const kr = biquad(kHigh, kState2[1], biquad(kShelf, kState[1], r * g))
    blockSum += kl * kl + (ch > 1 ? kr * kr : 0)
    if (++blockCount >= rate / 10) {
      blocks.push(blockSum / blockCount)
      if (blocks.length > 30) blocks.shift()
      blockSum = 0; blockCount = 0
    }
    write = (write + 1) % RING
    if (++sinceHop >= HOP) { sinceHop = 0; analyse() }
  }
  const now = performance.now()
  if (latest && now - lastPost > 15) {
    lastPost = now
    ;(self as unknown as Worker).postMessage(latest, [latest.spectrum.buffer, latest.scope.buffer])
    latest = null
  }
}

function onData(msg: { type: string; [k: string]: unknown }) {
  if (msg.type === 'pcm') {
    const r = Number(msg.rate) || 48000
    if (r !== rate) { rate = r; makeK() }
    channels = Number(msg.channels) || 2
    take(msg.data as Float32Array, channels)
  } else if (msg.type === 'config') {
    const next = msg.settings as LabSettings
    if (next.fftSize !== settings.fftSize) resize(next.fftSize)
    if (next.bands.map((b) => b.id).join() !== settings.bands.map((b) => b.id).join()) {
      const old = new Map(settings.bands.map((b, i) => [b.id, mem[i]]))
      mem = next.bands.map((b) => old.get(b.id) ?? freshMem())
    }
    settings = next
  } else if (msg.type === 'port') {
    const port = msg.port as MessagePort
    port.onmessage = (e) => onData(e.data)
  } else if (msg.type === 'reset') {
    ringL.fill(0); ringR.fill(0)
    onsetEnv.length = 0; fluxHist.length = 0; blocks.length = 0
    mem = settings.bands.map(() => freshMem())
    speechEnv.length = 0; rmsHist.length = 0; voicedHist.length = 0; hfHist.length = 0; flatHist.length = 0; specHist.length = 0
    kinds = [1, 0, 0, 0]
  }
}

self.onmessage = (e: MessageEvent) => onData(e.data)
