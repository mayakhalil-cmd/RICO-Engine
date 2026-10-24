// Shared between the audio lab (main thread) and its analysis worker.

export type BandMode = 'energy' | 'peak' | 'hit'

export interface Band {
  id: string            // signal id becomes "audio:<id>"
  name: string
  lo: number            // Hz
  hi: number            // Hz
  on: boolean
  mode: BandMode        // energy: how loud, smooth; peak: fastest; hit: a pulse on each attack
  gain: number          // dB added before scaling
  floor: number         // dB that becomes 0
  ceiling: number       // dB that becomes 1
  auto: boolean         // follow the music's level instead of fixed floor and ceiling
  attack: number        // ms to rise
  release: number       // ms to fall
  curve: number         // 1 straight, < 1 more reactive at the bottom, > 1 only the loud parts
  gate: number          // 0..1: below this the band stays at 0
  sens: number          // hit sensitivity 0..1
  color: string
}

// Shaping the sound before it is analysed (and, for sources played in the
// app, before you hear it): cut rumble, tame a boomy room, a gate for the
// noise floor and a compressor so quiet and loud parts both react.
export interface Shape {
  on: boolean
  hp: number            // Hz, low cut (0 = off)
  lp: number            // Hz, high cut (0 = off)
  low: number           // dB, low shelf at 120 Hz
  mid: number           // dB, bell at midHz
  midHz: number
  midQ: number
  high: number          // dB, high shelf at 6 kHz
  gate: number          // dB, below this it goes quiet (-100 = off)
  comp: number          // dB threshold (0 = off)
  ratio: number
  makeup: number        // dB after the compressor
  monitor: number       // dB, how loud you hear it (does not change the analysis)
}
export const SHAPE_DEFAULT: Shape = { on: false, hp: 0, lp: 0, low: 0, mid: 0, midHz: 1000, midQ: 1, high: 0, gate: -100, comp: 0, ratio: 3, makeup: 0, monitor: 0 }

// What kind of sound is playing. Each class has a bias (-1 less often,
// +1 more often), so you can tune it to your material.
export interface SceneTune {
  silence: number       // dB LUFS under which it counts as silence
  speech: number
  music: number
  foley: number
  smooth: number        // seconds
  names: [string, string, string, string]   // your names for silence, speech, music, effects
}
export const SCENE_DEFAULT: SceneTune = { silence: -50, speech: 0, music: 0, foley: 0, smooth: 0.8, names: ['Silence', 'Speech', 'Music', 'Foley and effects'] }

export interface LabSettings {
  fftSize: number       // 1024 .. 16384
  inputGain: number     // dB
  weighting: 'none' | 'a'
  bands: Band[]
  shape?: Shape
  scene?: SceneTune
}

export interface Features {
  rms: number           // dBFS
  peak: number          // dBFS, sample peak
  lufsM: number         // momentary loudness (400 ms)
  lufsS: number         // short-term loudness (3 s)
  centroid: number      // Hz, how bright
  rolloff: number       // Hz, 85% of the energy is below
  flatness: number      // 0 tone .. 1 noise
  bpm: number
  bpmConfidence: number // 0..1
  beat: number          // 1 on a beat, falls to 0
  beatPhase: number     // 0..1 through the beat
  onset: number         // any attack, 1 then falls
  pitch: number         // Hz, 0 when there is no clear pitch
  clarity: number       // 0..1
  correlation: number   // -1 out of phase .. 1 mono
  width: number         // 0 mono .. 1 wide
  chroma: number[]      // 12 pitch classes, C first
  rate: number
  clip: boolean
  // What is playing: confidence 0..1 for silence, speech, music, effects.
  kinds: [number, number, number, number]
  // How loud each kind is right now (0..1): the level times the confidence.
  kindLevels: [number, number, number, number]
  // Harmonic (held notes, voices, pads) and percussive (hits, steps, doors)
  // parts of the sound, split by median filtering (HPSS). 0..1 each.
  harmonic: number
  percussive: number
  gateOpen: boolean
  reduction: number     // dB the compressor is taking off
}

export interface LabFrame {
  bands: number[]       // value 0..1 per band (same order as settings.bands)
  hits: number[]        // hit pulse 0..1 per band
  db: number[]          // band level in dB (after gain)
  features: Features
  spectrum: Float32Array  // dB on a log frequency scale, SPEC_POINTS points from 20 Hz to 20 kHz
  scope: Float32Array     // the last samples, for the oscilloscope
  ms: number              // analysis time per second of audio, in ms (how busy the thread is)
}

export const SPEC_POINTS = 256
export const SPEC_LO = 20
export const SPEC_HI = 20000
export const specHz = (i: number) => SPEC_LO * Math.pow(SPEC_HI / SPEC_LO, i / (SPEC_POINTS - 1))
export const hzToSpec = (hz: number) => ((Math.log(hz / SPEC_LO) / Math.log(SPEC_HI / SPEC_LO)) * (SPEC_POINTS - 1))
