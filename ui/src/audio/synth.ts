// The sound generator: a small synthesizer that makes drums, basses, pads,
// risers and effects. Sounds are rendered exactly (offline), so what you
// hear is what goes into the editor.

export type Wave = 'sine' | 'square' | 'sawtooth' | 'triangle' | 'white' | 'pink'

export interface Synth {
  name: string
  length: number        // seconds
  wave: Wave
  pitch: number         // Hz
  wave2: Wave
  ratio2: number        // second oscillator pitch = pitch * ratio2
  mix2: number          // 0..1
  fm: number            // how much the second oscillator bends the first (0..1)
  detune: number        // cents, spreads left and right for width
  pitchStart: number    // pitch envelope: starts at pitch * this
  pitchTime: number     // seconds to reach the pitch
  attack: number
  decay: number
  sustain: number       // 0..1
  release: number
  filter: 'lowpass' | 'highpass' | 'bandpass' | 'none'
  cutoff: number        // Hz
  reso: number          // Q
  filterEnv: number     // octaves the filter opens at the start
  filterTime: number    // seconds to close
  lfoRate: number       // Hz
  lfoDepth: number      // 0..1
  lfoTarget: 'pitch' | 'filter' | 'volume'
  drive: number         // 0..1
  bursts: number        // the envelope fires this many times (a clap)
  space: number         // 0..1 reverb
  volume: number        // dB
}

const base: Synth = {
  name: 'Sound', length: 1, wave: 'sine', pitch: 110, wave2: 'sine', ratio2: 2, mix2: 0, fm: 0, detune: 0,
  pitchStart: 1, pitchTime: 0.05, attack: 0.005, decay: 0.3, sustain: 0.5, release: 0.3,
  filter: 'none', cutoff: 8000, reso: 0.7, filterEnv: 0, filterTime: 0.2, lfoRate: 4, lfoDepth: 0, lfoTarget: 'pitch',
  drive: 0, bursts: 1, space: 0, volume: -3,
}

export const SYNTH_PRESETS: Synth[] = [
  { ...base, name: 'Kick', length: 0.6, pitch: 48, pitchStart: 4, pitchTime: 0.06, decay: 0.35, sustain: 0, release: 0.1, drive: 0.25 },
  { ...base, name: 'Snare', length: 0.4, wave: 'white', pitch: 190, wave2: 'triangle', ratio2: 1, mix2: 0.35, decay: 0.16, sustain: 0, release: 0.08, filter: 'bandpass', cutoff: 2500, reso: 0.6, space: 0.15 },
  { ...base, name: 'Closed hi-hat', length: 0.15, wave: 'white', decay: 0.045, sustain: 0, release: 0.03, filter: 'highpass', cutoff: 8000, reso: 0.8, volume: -8 },
  { ...base, name: 'Open hi-hat', length: 0.6, wave: 'white', decay: 0.35, sustain: 0, release: 0.2, filter: 'highpass', cutoff: 7000, reso: 0.8, volume: -9 },
  { ...base, name: 'Clap', length: 0.5, wave: 'white', decay: 0.12, sustain: 0, release: 0.1, filter: 'bandpass', cutoff: 1400, reso: 1.2, bursts: 4, space: 0.25 },
  { ...base, name: 'Bass pluck', length: 0.7, wave: 'sawtooth', pitch: 55, wave2: 'square', ratio2: 0.5, mix2: 0.4, decay: 0.25, sustain: 0.2, release: 0.15, filter: 'lowpass', cutoff: 300, reso: 4, filterEnv: 4, filterTime: 0.15 },
  { ...base, name: 'Sub bass', length: 1.2, pitch: 41.2, wave2: 'triangle', ratio2: 2, mix2: 0.15, attack: 0.01, decay: 0.4, sustain: 0.8, release: 0.3, drive: 0.15 },
  { ...base, name: 'Warm pad', length: 4, wave: 'sawtooth', pitch: 220, wave2: 'sawtooth', ratio2: 1.5, mix2: 0.5, detune: 14, attack: 1.2, decay: 1, sustain: 0.8, release: 1.5, filter: 'lowpass', cutoff: 1400, reso: 0.9, lfoRate: 0.3, lfoDepth: 0.35, lfoTarget: 'filter', space: 0.5, volume: -9 },
  { ...base, name: 'Riser', length: 4, wave: 'white', wave2: 'sawtooth', pitch: 110, ratio2: 1, mix2: 0.4, pitchStart: 0.25, pitchTime: 4, attack: 3.6, decay: 0.2, sustain: 1, release: 0.2, filter: 'bandpass', cutoff: 400, reso: 3, filterEnv: -3, filterTime: 4, space: 0.4, volume: -8 },
  { ...base, name: 'Impact', length: 3, wave: 'sine', pitch: 40, pitchStart: 3, pitchTime: 0.4, wave2: 'white', mix2: 0.4, decay: 2, sustain: 0, release: 0.5, filter: 'lowpass', cutoff: 2000, filterEnv: -2, filterTime: 1.5, drive: 0.5, space: 0.6 },
  { ...base, name: 'Laser zap', length: 0.5, wave: 'square', pitch: 300, pitchStart: 8, pitchTime: 0.25, decay: 0.3, sustain: 0, release: 0.1, filter: 'lowpass', cutoff: 3000, reso: 6, volume: -9 },
  { ...base, name: 'Bell', length: 3, pitch: 660, wave2: 'sine', ratio2: 3.5, mix2: 0, fm: 0.6, decay: 2.2, sustain: 0, release: 0.8, space: 0.35, volume: -8 },
  { ...base, name: 'Beep', length: 0.3, wave: 'square', pitch: 1000, decay: 0.2, sustain: 0.6, release: 0.05, filter: 'lowpass', cutoff: 4000, volume: -12 },
  { ...base, name: 'Wind', length: 5, wave: 'pink', attack: 1.5, decay: 1, sustain: 0.8, release: 1.5, filter: 'bandpass', cutoff: 700, reso: 2, lfoRate: 0.2, lfoDepth: 0.7, lfoTarget: 'filter', volume: -6 },
]

function noise(c: BaseAudioContext, kind: 'white' | 'pink', seconds: number): AudioBuffer {
  const n = Math.max(1, Math.round(seconds * c.sampleRate))
  const b = c.createBuffer(1, n, c.sampleRate)
  const d = b.getChannelData(0)
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1
    if (kind === 'white') { d[i] = w; continue }
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852
    b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898
    d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11
    b6 = w * 0.115926
  }
  return b
}

function source(c: BaseAudioContext, wave: Wave, hz: number, len: number, s: Synth, t0: number): { node: AudioScheduledSourceNode; freq?: AudioParam } {
  if (wave === 'white' || wave === 'pink') {
    const b = c.createBufferSource()
    b.buffer = noise(c, wave, len)
    return { node: b }
  }
  const o = c.createOscillator()
  o.type = wave
  o.frequency.setValueAtTime(Math.max(1, hz * s.pitchStart), t0)
  if (s.pitchStart !== 1) o.frequency.exponentialRampToValueAtTime(Math.max(1, hz), t0 + Math.max(0.001, s.pitchTime))
  return { node: o, freq: o.frequency }
}

// Builds the voice into "out" starting at t0, at a pitch (Hz).
export function voice(c: BaseAudioContext, s: Synth, out: AudioNode, t0: number, hz = s.pitch, velocity = 1) {
  const len = s.length
  const amp = c.createGain()
  amp.gain.value = 0
  const vol = Math.pow(10, s.volume / 20) * velocity
  // Envelope (fired several times for bursts, like a clap).
  for (let k = 0; k < Math.max(1, s.bursts); k++) {
    const t = t0 + k * 0.012
    const peak = vol * (k === s.bursts - 1 ? 1 : 0.7)
    amp.gain.setValueAtTime(0, t)
    amp.gain.linearRampToValueAtTime(peak, t + Math.max(0.001, s.attack))
    amp.gain.setTargetAtTime(peak * s.sustain, t + s.attack, Math.max(0.001, s.decay) / 3)
  }
  const relAt = t0 + Math.max(s.attack + s.decay, len - s.release)
  amp.gain.setTargetAtTime(0, relAt, Math.max(0.001, s.release) / 3)

  let head: AudioNode = amp
  let filter: BiquadFilterNode | null = null
  if (s.filter !== 'none') {
    filter = c.createBiquadFilter()
    filter.type = s.filter
    filter.Q.value = s.reso
    const start = Math.min(20000, Math.max(20, s.cutoff * Math.pow(2, s.filterEnv)))
    filter.frequency.setValueAtTime(start, t0)
    filter.frequency.exponentialRampToValueAtTime(Math.min(20000, Math.max(20, s.cutoff)), t0 + Math.max(0.01, s.filterTime))
    filter.connect(amp)
    head = filter
  }
  let shaper: WaveShaperNode | null = null
  if (s.drive > 0) {
    shaper = c.createWaveShaper()
    const k = s.drive * 60
    const curve = new Float32Array(1024)
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x)) }
    shaper.curve = curve
    shaper.connect(head)
    head = shaper
  }
  const pan = (side: number) => {
    const p = c.createStereoPanner()
    p.pan.value = side
    p.connect(head)
    return p
  }
  const nodes: AudioScheduledSourceNode[] = []
  const sides = s.detune > 0 ? [-0.7, 0.7] : [0]
  for (const side of sides) {
    const det = side * s.detune
    const dest = pan(side)
    const g1 = c.createGain(); g1.gain.value = (1 - s.mix2) / sides.length
    const g2 = c.createGain(); g2.gain.value = s.mix2 / sides.length
    g1.connect(dest); g2.connect(dest)
    const a = source(c, s.wave, hz, len, s, t0)
    const b = source(c, s.wave2, hz * s.ratio2, len, s, t0)
    if ('detune' in a.node) (a.node as OscillatorNode).detune.value = det
    a.node.connect(g1)
    b.node.connect(g2)
    // FM: the second oscillator bends the first one's pitch.
    if (s.fm > 0 && a.freq) {
      const fmGain = c.createGain()
      fmGain.gain.value = s.fm * hz * 4
      b.node.connect(fmGain)
      fmGain.connect(a.freq)
    }
    // LFO.
    if (s.lfoDepth > 0) {
      const lfo = c.createOscillator()
      lfo.frequency.value = s.lfoRate
      const depth = c.createGain()
      if (s.lfoTarget === 'pitch' && a.freq) { depth.gain.value = hz * 0.06 * s.lfoDepth; lfo.connect(depth); depth.connect(a.freq) }
      else if (s.lfoTarget === 'filter' && filter) { depth.gain.value = s.cutoff * 0.8 * s.lfoDepth; lfo.connect(depth); depth.connect(filter.frequency) }
      else { depth.gain.value = vol * 0.5 * s.lfoDepth; lfo.connect(depth); depth.connect(amp.gain) }
      lfo.start(t0); lfo.stop(t0 + len + 0.1)
    }
    nodes.push(a.node, b.node)
  }
  for (const n of nodes) { n.start(t0); n.stop(t0 + len + 0.05) }

  // Space: a short reverb.
  if (s.space > 0) {
    const conv = c.createConvolver()
    const n = Math.round(1.8 * c.sampleRate)
    const ir = c.createBuffer(2, n, c.sampleRate)
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3) }
    conv.buffer = ir
    const wet = c.createGain()
    wet.gain.value = s.space * 0.6
    amp.connect(conv); conv.connect(wet); wet.connect(out)
  }
  amp.connect(out)
}

export async function render(s: Synth, rate = 48000, hz = s.pitch): Promise<AudioBuffer> {
  const tail = s.space > 0 ? 1.8 : 0.05
  const off = new OfflineAudioContext(2, Math.round((s.length + tail) * rate), rate)
  voice(off, s, off.destination, 0, hz)
  return off.startRendering()
}

export const midiHz = (n: number) => 440 * Math.pow(2, (n - 69) / 12)
