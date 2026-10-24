import { LAYER_TYPES, MASTER_PARAMS, TRANSFORM_PARAMS, layerType, type ParamDef } from './layers'

// A Create scene: the layer stack, what each setting is linked to, and the
// finishing pass. Scenes are plain JSON so they can be saved and shared.

export interface Binding {
  signal: string
  min: number
  max: number
  smooth: number   // 0 = instant, 0.95 = very slow
}

export interface Layer {
  id: string
  type: string
  name: string
  visible: boolean
  opacity: number
  blend: number
  values: Record<string, number | string>
  bindings: Record<string, Binding>
  image?: string   // data URL for image layers
  fontFamily?: string   // text layers: your own font (CSS family)
  video?: string   // a video file picked this session (not saved inside the scene)
  start?: number   // seconds on the timeline where the layer appears
  end?: number     // and where it goes away
  solo?: boolean   // when any layer is solo, only solo layers show
  locked?: boolean // cannot be moved or trimmed on the timeline
  // switches and extras
  label?: number   // label color (LABEL_COLORS)
  shy?: boolean    // hidden from the timeline when "hide shy layers" is on
  fxOff?: boolean  // effects switched off
  parent?: string  // follows another layer's transform (a null, usually)
  matte?: number   // track matte: see MATTES
  matteFrom?: string // the layer used as matte; empty = the layer above
  masks?: Mask[]
  effects?: Effect[]
}

// A mask cuts the layer to a shape, in the layer's own space (it moves with
// the layer). Several masks combine with their mode.
export interface Mask {
  id: string
  name: string
  kind: 'rect' | 'ellipse' | 'path'
  mode: number         // 0 add, 1 subtract, 2 intersect
  x: number            // center, in scene units (height = 1, 0 = middle)
  y: number
  w: number
  h: number
  points?: [number, number][]   // for paths, scene units
  // Rotoscoping: the path shape at moments in time (seconds). Between two
  // keys the points glide smoothly; with no keys the path stays still.
  pathKeys?: { t: number; points: [number, number][] }[]
  feather: number
  expand: number
  opacity: number
  invert?: boolean
  on?: boolean
}

// An effect on a layer, or on the whole picture (Finish).
export interface Effect {
  id: string
  type: string
  on: boolean
  values: Record<string, number | string>
  bindings?: Record<string, Binding>
}

export const MASK_MODES = ['Add', 'Subtract', 'Intersect']
// The path of a mask at a moment, for rotoscoping.
export function maskPointsAt(m: Mask, t: number): [number, number][] {
  const keys = m.pathKeys
  if (!keys?.length) return m.points ?? []
  if (t <= keys[0].t) return keys[0].points
  const last = keys[keys.length - 1]
  if (t >= last.t) return last.points
  let i = 0
  while (i < keys.length - 2 && keys[i + 1].t <= t) i++
  const a = keys[i], b = keys[i + 1]
  if (a.points.length !== b.points.length) return a.points
  let k = (t - a.t) / Math.max(1e-6, b.t - a.t)
  k = k * k * (3 - 2 * k)
  return a.points.map(([x, y], j) => [x + (b.points[j][0] - x) * k, y + (b.points[j][1] - y) * k])
}

export const MATTES = ['No matte', 'Alpha matte', 'Alpha inverted', 'Luma matte', 'Luma inverted']
export const LABEL_COLORS = ['#3bff03', '#f820a0', '#6f86ff', '#ffd23f', '#30e0ff', '#ff8a3d', '#b48cff', '#ffb3e6', '#ffffff', '#6c7a66']

// Keyframe animation: each track animates one setting.
export type Ease = 'linear' | 'smooth' | 'in' | 'out' | 'hold'
export interface Key { t: number; v: number; ease: Ease }
export interface Track { target: string; keys: Key[] }   // target: "<layer id>.<setting>" or "master.<setting>"

// Tracks that send to the outside world while the timeline plays: OSC, MIDI,
// DMX, or a signal anything in RICO can follow (routes, 3D links, nodes).
export type OutKind = 'osc' | 'midi-cc' | 'dmx' | 'signal'
export interface OutTrack {
  id: string
  name: string
  kind: OutKind
  host: string
  port: number
  address: string      // OSC address
  channel: number      // MIDI channel 1-16, or DMX channel 1-512
  number: number       // MIDI CC number
  min: number          // what 0 and 1 on the curve send (OSC)
  max: number
  muted?: boolean
  keys: Key[]          // values 0..1
}

// A cue: something that happens once when the playhead passes it.
export type CueKind = 'osc' | 'midi-note' | 'command' | 'signal'
export interface Cue {
  id: string
  t: number
  name: string
  kind: CueKind
  host: string
  port: number
  address: string
  value: number
  channel: number
  number: number
  command: string
}

export interface Timeline {
  duration: number
  fps: number
  loop: boolean
  bpm: number
  tracks: Track[]
  outTracks?: OutTrack[]
  cues?: Cue[]
  inPoint?: number     // work area: play and loop between these
  outPoint?: number
}

export const emptyTimeline = (): Timeline => ({ duration: 10, fps: 30, loop: true, bpm: 120, tracks: [] })

export interface Scene {
  version: 1
  name: string
  width: number
  height: number
  layers: Layer[]
  master: { values: Record<string, number | string>; bindings: Record<string, Binding>; effects?: Effect[] }
  timeline?: Timeline
  guides?: { id: string; axis: 'x' | 'y'; pos: number }[]   // ruler guides, scene pixels
  background?: string      // the color under every layer
  comps?: Record<string, Scene>   // precomps: other compositions used as layers (kept on the main one)
}

export const SIZES = [
  { w: 1280, h: 720, label: '1280 x 720' },
  { w: 1920, h: 1080, label: '1920 x 1080' },
  { w: 1080, h: 1080, label: '1080 x 1080, square' },
  { w: 1080, h: 1920, label: '1080 x 1920, vertical' },
  { w: 960, h: 540, label: '960 x 540, light' },
]

let counter = 0
const uid = () => `${Date.now().toString(36)}${(counter++).toString(36)}`

export function defaults(params: ParamDef[]): Record<string, number | string> {
  return Object.fromEntries(params.map((p) => [p.key, p.default]))
}

export function newLayer(type: string): Layer {
  const t = layerType(type)
  return {
    id: uid(), type: t.id, name: t.name, visible: true, opacity: 1, blend: t.id === 'tunnel' || t.id === 'pulse' ? 1 : 0,
    values: { ...defaults(TRANSFORM_PARAMS), ...defaults(t.params) }, bindings: {}, label: LABEL_FOR[t.id] ?? 0,
  }
}
const LABEL_FOR: Record<string, number> = { null: 8, adjust: 9, solid: 3, text: 1, vshape: 2, particles: 4, scene3d: 6, picture: 4, video: 5, image: 5, camera: 5 }
export const newId = () => uid()

function scene(name: string, layers: Layer[], master: Record<string, number> = {}): Scene {
  return { version: 1, name, width: 1280, height: 720, layers, master: { values: { ...defaults(MASTER_PARAMS), ...master }, bindings: {}, effects: [] }, timeline: emptyTimeline() }
}

function chroma() {
  const c = newLayer('chroma')
  c.bindings.kick = { signal: 'audio:kick', min: 0, max: 1, smooth: 0.4 }
  c.bindings.thick = { signal: 'audio:low', min: 0, max: 0.06, smooth: 0.6 }
  return c
}

function blobs() {
  const b = newLayer('blobs')
  b.bindings.swell = { signal: 'audio:low', min: 0, max: 1, smooth: 0.5 }
  return b
}

function retroGrid() {
  const noise = newLayer('noise')
  noise.values = { ...noise.values, a: '#000000', b: '#002cf8', warp: 1.4 }
  noise.bindings.warp = { signal: 'audio:low', min: 0.6, max: 2.6, smooth: 0.6 }
  const grid = newLayer('grid')
  grid.blend = 2
  grid.bindings.speed = { signal: 'audio:level', min: 0.4, max: 3, smooth: 0.7 }
  const pulse = newLayer('pulse')
  pulse.values = { ...pulse.values, color: '#f820a0' }
  pulse.bindings.size = { signal: 'audio:kick', min: 0.15, max: 0.75, smooth: 0.3 }
  const text = newLayer('text')
  text.values = { ...text.values, size: 0.22, glitch: 0.2 }
  return [noise, grid, pulse, text]
}

// Ready-made scenes to start from. They all follow the audio, so with
// Listen to audio on they move straight away.
export const STARTERS: { id: string; name: string; make: () => Scene }[] = [
  { id: 'glass-blobs', name: 'Glass and blobs', make: () => {
    const b = blobs()
    b.blend = 1
    b.opacity = 0.85
    b.values = { ...b.values, fill: '#000000', count: 5 }
    return scene('Glass and blobs', [chroma(), b], { chroma: 0.12 })
  } },
  { id: 'glass', name: 'Chroma glass', make: () => scene('Chroma glass', [chroma()], { chroma: 0.1 }) },
  { id: 'blobs', name: 'Blobs', make: () => scene('Blobs', [blobs()], { chroma: 0.15 }) },
  { id: 'grid', name: 'Retro grid', make: () => scene('Retro grid', retroGrid(), { trails: 0.35, chroma: 0.25 }) },
]

export function starterScene(): Scene {
  return STARTERS[0].make()
}

// Fills in anything a saved scene is missing, so old or hand-edited files
// still load.
export function repair(raw: unknown): Scene | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Partial<Scene>
  if (!Array.isArray(s.layers)) return null
  const known = new Set(LAYER_TYPES.map((t) => t.id))
  return {
    version: 1,
    name: typeof s.name === 'string' ? s.name : 'Scene',
    width: Number(s.width) || 1280,
    height: Number(s.height) || 720,
    layers: s.layers
      .filter((l) => l && known.has(l.type))
      .map(({ video: _video, ...l }) => ({
        ...newLayer(l.type),
        ...l,
        id: typeof l.id === 'string' ? l.id : uid(),
        values: { ...defaults(TRANSFORM_PARAMS), ...defaults(layerType(l.type).params), ...(l.values ?? {}) },
        bindings: l.bindings ?? {},
      })),
    master: {
      values: { ...defaults(MASTER_PARAMS), ...(s.master?.values ?? {}) },
      bindings: s.master?.bindings ?? {},
      effects: Array.isArray(s.master?.effects) ? s.master.effects : [],
    },
    timeline: s.timeline && Array.isArray(s.timeline.tracks) ? { ...emptyTimeline(), ...s.timeline } : emptyTimeline(),
    ...(Array.isArray(s.guides) && s.guides.length ? { guides: s.guides } : {}),
    ...(typeof s.background === 'string' ? { background: s.background } : {}),
  }
}

const KEY = 'rico.create.scene'

export function loadScene(): Scene {
  try {
    const s = repair(JSON.parse(localStorage.getItem(KEY) ?? 'null'))
    if (s) return s
  } catch {
    /* fall through to the starter scene */
  }
  return starterScene()
}

export function saveScene(s: Scene) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // Usually a very large image layer. Save without images instead.
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...s, layers: s.layers.map((l) => ({ ...l, image: undefined })) }))
    } catch {
      /* storage unavailable */
    }
  }
}
