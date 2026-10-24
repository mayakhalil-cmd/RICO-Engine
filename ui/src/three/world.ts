import { useSyncExternalStore } from 'react'
import { record } from '../shell/history'
import type { Binding } from '../create/scene'

// The 3D playground's scene, as plain data: what is in it, where, and what
// each thing looks like. It is saved in this browser profile and inside
// project files. The three.js side (engine.ts) builds itself from this.

export type ObjKind =
  | 'box' | 'sphere' | 'torus' | 'knot' | 'cylinder' | 'cone' | 'plane' | 'icosa' | 'ring' | 'capsule'
  | 'model' | 'point-light' | 'spot-light' | 'sun'
  | 'shape' | 'math-surface' | 'math-solid' | 'code-shape' | 'mesh' | 'fog' | 'text' | 'comic' | 'fluid'

export type MaterialKind = 'standard' | 'iridescent' | 'glass' | 'chrome' | 'wire' | 'glow' | 'normal' | 'toon' | 'picture' | 'shader' | 'custom'

// Your own materials, built from layers: each layer makes a color (a gradient, noise, stripes, a
// thin film, a picture, your painting) and blends it into one part of the
// surface (color, glow, roughness or metal), through a mask.
export type LayerKind = 'color' | 'height' | 'fresnel' | 'noise' | 'stripes' | 'iridescent' | 'picture' | 'paint' | 'strokes'
  | 'chrome' | 'halftone' | 'misprint' | 'hatch' | 'watercolor' | 'newsprint'
// Looks that work on the lit picture (after the light): halftone, hatching, paper...
export const LATE_KINDS: LayerKind[] = ['chrome', 'halftone', 'misprint', 'hatch', 'watercolor', 'newsprint']
export type LayerMask = 'none' | 'paint' | 'paint-inverse' | 'fresnel' | 'height' | 'noise'
export type LayerBlend = 'mix' | 'add' | 'multiply' | 'screen'
export type LayerTarget = 'color' | 'glow' | 'rough' | 'metal' | 'normal' | 'cutout'
export interface MatLayer {
  id: string
  on: boolean
  kind: LayerKind
  colors: string[]      // 1 to 4 colors, the ramp
  amount: number
  scale: number
  speed: number
  blend: LayerBlend
  target: LayerTarget
  mask: LayerMask
  picture?: string
  react?: boolean       // follows the object's "Material drive" link (the audio, a knob...)
  length?: number       // strokes: how long each stroke is
  angle?: number        // strokes: which way they go (degrees)
  paper?: 'mono' | 'dual' | 'full'  // mixed media paper: one color, two colors or full color
  lift?: number         // mixed media paper: how far the scraps stand off the shape
  crumple?: number      // mixed media paper: how crumpled the paper is
  scrap?: number        // mixed media paper: how big the scraps are
  thick?: number        // pencil, ink and print looks: how thick the lines (or dots) are
}
export interface MatDef { id: string; name: string; layers: MatLayer[]; look?: string }

// Hand-drawn outlines, like a grease pencil: a line around the shape and on
// its sharp edges, that can wobble and "boil" like animation drawn by hand.
export interface Outline {
  on: boolean; color: string; width: number; creases: boolean; crease: number; lineWidth: number; wobble: number; boil: number; offset: number
  // Floating lines: loose strokes drawn around the shape, a little away from it
  floating?: boolean; hull?: boolean; gap?: number; strokes?: number; open?: number; floatWidth?: number; floatColor?: string; onTop?: boolean
  // contour: the real outline (into every fold); loose: a ring around the whole shape
  floatMode?: 'contour' | 'loose'
  overAll?: boolean       // strokes drawn over everything (off: things in front hide them)
  // what the strokes are drawn with
  drawWith?: 'lines' | 'dots' | 'letters' | 'lines+dots' | 'lines+letters'
  text?: string; font?: string; letterSize?: number; dotSize?: number; dotGap?: number; glyphColor?: string
}
export const OUTLINE_DEFAULT: Outline = { on: true, color: '#000000', width: 0.045, creases: true, crease: 35, lineWidth: 2.5, wobble: 0.35, boil: 8, offset: 0, floating: false, hull: true, gap: 0.12, strokes: 2, open: 0.15, floatWidth: 2, floatColor: '#ffe14a', onTop: false, floatMode: 'contour', drawWith: 'lines', text: 'RICO', letterSize: 18, dotSize: 6, dotGap: 1 }

// Fog you can place: a box or ball of air that light shows up in.
export interface FogVol { shape: 'box' | 'ball'; density: number; noise: number; scale: number; speed: number; soft: number; height: number; glow: number; lights: number }
export const FOG_DEFAULT: FogVol = { shape: 'box', density: 1.2, noise: 0.6, scale: 1.5, speed: 0.15, soft: 0.25, height: 0.6, glow: 0.4, lights: 1 }

// A mesh you model yourself: points (x, y, z, x, y, z...) and triangles.
export interface MeshData { p: number[]; f: number[] }

export type Vec3 = [number, number, number]

// One part of an imported model (a mesh in the file). It keeps the look it
// came with, gets RICO layers added on top (like a post process on just this
// part), or takes a RICO material instead. It can have its own outline and
// strokes, and its own normals.
export interface PartSettings { hidden?: boolean; mode?: 'own' | 'add' | 'replace'; matId?: string; outline?: Outline; normals?: NormalStyle; color?: string; roughness?: number; metalness?: number; steps?: number }

// Rigging for any shape: deformers that bend, twist, taper or wave it along
// one of its axes. "amount" can be linked and animated (Deform amount).
export interface Deform { id: string; kind: 'bend' | 'twist' | 'taper' | 'wave' | 'squash'; amount: number; axis: 'x' | 'y' | 'z'; freq?: number; speed?: number; on?: boolean }
// 'sphere', 'cube', 'torus', 'cylinder', or another object's id. Fluid (the
// default) rebuilds the surface so it can flow, split and merge; points moves
// the shape's own points (quicker, but it cannot change shape as freely).
// A living goo that reaches for things near it, sticks to them and lets go
// when they move far enough away (see symbiote.ts).
export type { Symbiote } from './symbioteParams'
export { SYMBIOTE_DEFAULT } from './symbioteParams'
import type { Symbiote } from './symbioteParams'
export interface Morph { to: string; amount: number; style?: 'fluid' | 'points'; goo?: number; spread?: number; speed?: number; detail?: number }
// Simulation: light and quick, made for live shows, not engineering.
export interface Physics { on: boolean; still?: boolean; bounce: number; friction: number; mass: number; pieces?: number; blast?: number }
export interface FluidSet { count: number; size: number; thick: number; box: boolean }
export const PHYSICS_DEFAULT: Physics = { on: true, bounce: 0.35, friction: 0.4, mass: 1 }
export const FLUID_DEFAULT: FluidSet = { count: 900, size: 0.06, thick: 0.4, box: true }

// Your own normals, for stylized light: rounder, flat planes, or bent by noise.
export interface NormalStyle { round: number; facets: number; noise: number; noiseSize: number }

export interface Obj3D {
  id: string
  name: string
  kind: ObjKind
  visible: boolean
  position: Vec3
  rotation: Vec3          // degrees
  scale: Vec3
  color: string
  material: MaterialKind
  roughness: number
  metalness: number
  glow: number            // emissive strength
  intensity: number       // lights
  spin: number            // turns per minute around Y, for quick motion
  model?: string          // data URL of a .glb, for imported models
  shape?: string          // a shape made by a node network ("Shape out")
  fx?: string             // math surface: x, y, z as formulas of u, v, t, a, b
  fy?: string
  fz?: string
  solid?: string          // math solid: inside where this formula of x, y, z is below zero
  code?: string           // code shape
  res?: number            // detail for math shapes
  a?: number              // two numbers the formulas and shaders can use (linkable)
  b?: number
  picture?: string        // picture material: "Create" or a node network's Picture out
  uvScale?: number        // how many times the picture repeats
  uvSpeed?: number        // how fast it scrolls
  shader?: string         // shader material: GLSL that sets col
  mesh?: MeshData         // an editable mesh (kind "mesh")
  meshRev?: number        // goes up on each edit, so the 3D view rebuilds
  modelType?: 'glb' | 'obj' | 'fbx'
  ownMaterials?: boolean  // models: keep the materials from the file
  anim?: string           // models: which animation plays ('' none)
  animSpeed?: number
  animPos?: number        // 0..1: when linked, the animation follows it instead of playing
  colors?: string[]       // iridescent: the film colors
  filmScale?: number
  filmSpeed?: number
  toonSteps?: number
  // light steps on any layered material, like the cartoon bands (0 = smooth)
  lightSteps?: number
  outline?: Outline
  matId?: string          // custom material
  normals?: NormalStyle   // stylized normals (layered materials)
  parts?: Record<string, PartSettings>   // models: each part's look ('*' is every part)
  text3d?: import('./textShape').Text3D
  comic?: import('./textShape').Comic
  paint?: string          // painted colors (PNG data URL)
  paintMask?: string      // painted mask (PNG data URL)
  paintMaps?: Record<string, string>   // painted roughness, metal, glow, glass, bump (PNG data URLs)
  paintBox?: [number, number, number, number]   // the box the paint sits on (center and half size); older paint has none
  fog?: FogVol
  clickable?: boolean     // clicking it sends the signal 3d:click:<name>
  deform?: Deform[]       // bend, twist, taper, wave (a stack, first to last)
  morph?: Morph           // melt into a ball, a box or another object
  pivot?: Vec3            // where it turns, sizes and deforms from, in its own space (unset: its middle)
  symbiote?: Symbiote     // grows sticky arms toward things near it
  physics?: Physics       // gravity and bumping into things (and breaking)
  pose?: Record<string, Vec3>   // models with bones: each bone's turn (degrees)
  fluid?: FluidSet        // kind "fluid": a block of liquid
  fixture?: string        // a spot light that stands for a lighting desk fixture (it plays what the desk sends)
  bindings: Record<string, Binding>   // "position.y", "rotation.y", "scale", "glow", "intensity", "hue", "spin"
}

export interface World3D {
  version: 1
  objects: Obj3D[]
  materials?: MatDef[]
  exposure?: number       // how bright everything is (tone mapping exposure)
  bloom?: { on: boolean; strength: number; radius: number; threshold: number }
  background: string
  greyStudio?: boolean
  fog: number
  grid: boolean
  camera: { position: Vec3; target: Vec3; fov: number }
  env?: Partial<WorldEnv>
}

// Everything about the world: sky, light from around, color, lens and time.
export interface WorldEnv {
  sky: 'color' | 'gradient' | 'transparent'; skyTop: string; skyBottom: string
  envLight: 'studio' | 'soft' | 'none'; envIntensity: number; envTurn: number
  ambient: number; ambientSky: string; ambientGround: string
  toneMap: 'aces' | 'agx' | 'neutral' | 'reinhard' | 'cineon' | 'linear'
  fogKind: 'thick' | 'linear'; fogColor: string; fogNear: number; fogFar: number
  shadows: boolean; shadowSoft: 'hard' | 'soft' | 'very-soft'; shadowSize: 1024 | 2048 | 4096
  near: number; far: number; autoTurn: number; damping: number
  dof: boolean; focus: number; aperture: number; maxBlur: number
  vignette: number; grain: number; aberration: number; saturation: number; contrast: number; warmth: number; scanlines: number; pixelate: number
  timeScale: number; renderScale: number
  gridSize: number; gridColor: string
}
export const ENV_DEFAULT: WorldEnv = {
  sky: 'color', skyTop: '#0b1030', skyBottom: '#000000',
  envLight: 'studio', envIntensity: 1, envTurn: 0,
  ambient: 0, ambientSky: '#b9c7ff', ambientGround: '#201410',
  toneMap: 'aces',
  fogKind: 'thick', fogColor: '', fogNear: 2, fogFar: 30,
  shadows: true, shadowSoft: 'soft', shadowSize: 2048,
  near: 0.05, far: 500, autoTurn: 0, damping: 0.05,
  dof: false, focus: 6, aperture: 0.02, maxBlur: 0.01,
  vignette: 0, grain: 0, aberration: 0, saturation: 1, contrast: 1, warmth: 0, scanlines: 0, pixelate: 0,
  timeScale: 1, renderScale: 1,
  gridSize: 20, gridColor: '#9a9a9a',
}
export const envOf = (w: World3D): WorldEnv => ({ ...ENV_DEFAULT, ...(w.env ?? {}) })

export const KIND_LABEL: Record<ObjKind, string> = {
  box: 'Cube', sphere: 'Sphere', torus: 'Donut', knot: 'Knot', cylinder: 'Cylinder', cone: 'Cone', plane: 'Floor',
  icosa: 'Crystal', ring: 'Ring', capsule: 'Capsule', model: 'Model', 'point-light': 'Point light', 'spot-light': 'Spot light', sun: 'Sun',
  shape: 'Node shape', 'math-surface': 'Math surface', 'math-solid': 'Math solid', 'code-shape': 'Code shape', mesh: 'Editable mesh', fog: 'Fog volume', text: '3D text', comic: 'Comic page', fluid: 'Fluid',
}

export const MATERIAL_LABEL: Record<MaterialKind, string> = {
  standard: 'Plastic', iridescent: 'Iridescent', glass: 'Glass', chrome: 'Chrome', wire: 'Wireframe', glow: 'Glow', normal: 'Rainbow normals', toon: 'Cartoon',
  picture: 'Picture (Motion or nodes)', shader: 'Shader (your GLSL)', custom: 'My material (layers)',
}
export const LAYER_LABEL: Record<LayerKind, string> = {
  color: 'Flat color', height: 'Gradient up the object', fresnel: 'Edges (fresnel)', noise: 'Noise (clouds, rock)', stripes: 'Stripes',
  iridescent: 'Thin film (iridescent)', picture: 'Picture (Motion or nodes)', paint: 'Your painting', strokes: 'Painted strokes',
  chrome: 'Iridescent chrome (moving)', halftone: 'Halftone dots (pop art)', misprint: 'Comic print (colors off register)', hatch: 'Pencil hatching',
  watercolor: 'Watercolor', newsprint: 'Mixed media paper',
}
export const CHROME_COLORS = ['#b9a8ff', '#ff4fd8', '#4ff3ff', '#ffb347']
export const FILM_COLORS = ['#ff3df2', '#3dfcff', '#fff23d', '#7a3dff']
export function newLayer(kind: LayerKind, part: Partial<MatLayer> = {}): MatLayer {
  return {
    id: uid(), on: true, kind, amount: 1, scale: kind === 'noise' ? 3 : kind === 'stripes' ? 8 : 1, speed: kind === 'chrome' ? 0.08 : kind === 'misprint' || kind === 'hatch' || kind === 'newsprint' ? 8 : 0, blend: 'mix', target: 'color', mask: 'none',
    ...(kind === 'strokes' ? { length: 3, angle: 0 } : {}),
    colors: kind === 'chrome' ? [...CHROME_COLORS] : kind === 'halftone' ? ['#101010', '#ffe14a'] : kind === 'misprint' ? ['#14061f', '#fff6e6'] : kind === 'hatch' ? ['#2a2a2a', '#f3efe6']
      : kind === 'watercolor' ? ['#fbf7ee'] : kind === 'newsprint' ? ['#151515', '#ece6da', '#ffd500', '#ff6a1a'] : kind === 'iridescent' ? [...FILM_COLORS] : kind === 'fresnel' ? ['#000000', '#30e0ff'] : kind === 'height' ? ['#2f55ff', '#f820a0'] : kind === 'color' ? ['#3bff03'] : ['#000000', '#ffffff'],
    ...part,
  }
}
export const MATERIAL_PRESETS: { name: string; layers: () => MatLayer[] }[] = [
  { name: 'Soap film', layers: () => [newLayer('iridescent', { amount: 0.9, scale: 1.5, speed: 0.1 }), newLayer('fresnel', { colors: ['#000000', '#ffffff'], blend: 'add', target: 'glow', amount: 0.4 })] },
  { name: 'Hologram', layers: () => [newLayer('stripes', { colors: ['#000000', '#30e0ff'], scale: 40, speed: 1, target: 'glow', blend: 'add' }), newLayer('fresnel', { colors: ['#000000', '#3bff03'], target: 'glow', blend: 'add', amount: 1.5 })] },
  { name: 'Lava rock', layers: () => [newLayer('noise', { colors: ['#110a08', '#2b1a14'], scale: 4 }), newLayer('noise', { colors: ['#000000', '#ff4a00', '#ffd23f'], scale: 2, speed: 0.15, target: 'glow', blend: 'add', amount: 2 })] },
  { name: 'Sunset gradient', layers: () => [newLayer('height', { colors: ['#2f0a5a', '#f820a0', '#ffb347'] })] },
  { name: 'Painted (draw your own)', layers: () => [newLayer('paint')] },
  { name: 'Painterly (brush strokes)', layers: () => [
    newLayer('strokes', { target: 'normal', amount: 0.8, scale: 0.18, length: 3, speed: 0, react: true }),
    newLayer('strokes', { target: 'color', blend: 'multiply', colors: ['#c9b8a8', '#ffffff', '#e8d2c0'], amount: 0.6, scale: 0.18, length: 3 }),
    newLayer('strokes', { target: 'cutout', amount: 0.9, scale: 0.12, length: 2.5 }),
  ] },
  { name: 'Iridescent chrome (animated)', layers: () => [newLayer('chrome', { speed: 0.08 })] },
  { name: 'Pop art (halftone dots)', layers: () => [newLayer('halftone', { scale: 1 })] },
  { name: 'Comic print (colors off register)', layers: () => [
    newLayer('strokes', { target: 'normal', amount: 0.5, scale: 0.2, length: 3, speed: 12 }),
    newLayer('misprint', { scale: 1, speed: 12 }),
  ] },
  { name: 'Pencil sketch (cross hatching)', layers: () => [newLayer('hatch', { scale: 1, speed: 8 })] },
  { name: 'Comic book ink', layers: () => [newLayer('hatch', { colors: ['#000000', '#ffffff'], scale: 0.8, speed: 8, amount: 0.8 }), newLayer('halftone', { colors: ['#000000', '#ff3d6e'], scale: 0.8, amount: 0.6 })] },
  { name: 'Mixed media paper (full color)', layers: () => [newLayer('newsprint', { scale: 1, speed: 4, paper: 'full' })] },
  { name: 'Mixed media paper (two colors)', layers: () => [newLayer('newsprint', { scale: 1, speed: 4, paper: 'dual', colors: ['#151515', '#ece6da', '#ff3d2e', '#1d6bff'] })] },
  { name: 'Mixed media paper (one color)', layers: () => [newLayer('newsprint', { scale: 1, speed: 4, paper: 'mono', colors: ['#151515', '#ece6da', '#2f8f6a'] })] },
  { name: 'Watercolor', layers: () => [newLayer('watercolor', { scale: 1, speed: 0.05 })] },
  { name: 'Oil paint, boiling', layers: () => [
    newLayer('strokes', { target: 'normal', amount: 1, scale: 0.14, length: 4, speed: 6, react: true }),
    newLayer('strokes', { target: 'color', blend: 'mix', colors: ['#ff5f7a', '#ffd23f', '#30e0ff', '#7a3dff'], amount: 0.35, scale: 0.14, length: 4, speed: 6 }),
    newLayer('strokes', { target: 'cutout', amount: 1, scale: 0.1, length: 3, speed: 6 }),
  ] },
]

export const DEFAULT_SHADER = `// Set col (and alpha). You have vUv, vNormal, vPos, uTime, uA, uB and uPicture.
float stripes = 0.5 + 0.5 * sin(vUv.x * 40.0 + uTime * 2.0 + uA * 10.0);
vec3 rainbow = 0.5 + 0.5 * cos(6.2831 * (vUv.y + vec3(0.0, 0.33, 0.67)) + uTime);
float rim = pow(1.0 - abs(vNormal.z), 2.0);
col = rainbow * stripes + rim * vec3(0.7, 0.6, 1.0) + texture2D(uPicture, vUv).rgb * uB;`

// Settings that can follow a signal, with the range they move in by default.
export const LINKABLE: { key: string; label: string; min: number; max: number }[] = [
  { key: 'position.x', label: 'Move X', min: -3, max: 3 },
  { key: 'position.y', label: 'Move Y', min: 0, max: 3 },
  { key: 'position.z', label: 'Move Z', min: -3, max: 3 },
  { key: 'rotation.x', label: 'Turn X', min: 0, max: 360 },
  { key: 'rotation.y', label: 'Turn Y', min: 0, max: 360 },
  { key: 'rotation.z', label: 'Turn Z', min: 0, max: 360 },
  { key: 'scale', label: 'Size', min: 0.5, max: 2 },
  { key: 'glow', label: 'Glow', min: 0, max: 3 },
  { key: 'hue', label: 'Hue shift', min: 0, max: 1 },
  { key: 'spin', label: 'Spin', min: 0, max: 60 },
  { key: 'intensity', label: 'Light strength', min: 0, max: 30 },
  { key: 'a', label: 'Formula / shader a', min: 0, max: 1 },
  { key: 'deform', label: 'Deform amount', min: 0, max: 2 },
  { key: 'lookSize', label: 'Look size', min: 0.25, max: 4 },
  { key: 'lookThick', label: 'Look line thickness', min: 0.25, max: 4 },
  { key: 'morph', label: 'Morph', min: 0, max: 1 },
  { key: 'b', label: 'Formula / shader b', min: 0, max: 1 },
  { key: 'uvSpeed', label: 'Picture scroll', min: 0, max: 2 },
  { key: 'animSpeed', label: 'Animation speed', min: 0, max: 2 },
  { key: 'animPos', label: 'Animation position', min: 0, max: 1 },
  { key: 'filmShift', label: 'Film color shift', min: 0, max: 1 },
  { key: 'drive', label: 'Material drive (painterly strokes, layers marked "reacts")', min: 0, max: 2 },
  { key: 'boil', label: 'Stroke and outline boil (redraw now)', min: 0, max: 1 },
  { key: 'fogDensity', label: 'Fog density', min: 0, max: 4 },
]

const isLight = (k: ObjKind) => k === 'point-light' || k === 'spot-light' || k === 'sun'
export { isLight }

const uid = () => Math.random().toString(36).slice(2, 9)

export function newObject(kind: ObjKind, extra: Partial<Obj3D> = {}): Obj3D {
  const light = isLight(kind)
  return {
    id: uid(), name: KIND_LABEL[kind], kind, visible: true,
    position: kind === 'plane' ? [0, 0, 0] : light ? [2, 3, 2] : [0, 1, 0],
    rotation: [0, 0, 0],
    scale: kind === 'plane' ? [10, 10, 10] : [1, 1, 1],
    color: light ? '#ffffff' : kind === 'plane' ? '#111111' : '#b9a8ff',
    material: kind === 'plane' ? 'standard' : 'iridescent',
    roughness: 0.25, metalness: 0.1, glow: 0, intensity: kind === 'sun' ? 3 : kind === 'spot-light' ? 120 : 60, spin: 0,
    bindings: {},
    ...(kind === 'math-surface' ? {
      name: 'Math surface', res: 96, a: 0, b: 0, material: 'iridescent' as MaterialKind,
      fx: 'sin(v*PI) * cos(u*TAU) * (1 + 0.25*sin(5*u*TAU + t) * sin(4*v*PI))',
      fy: 'cos(v*PI) * 1.2',
      fz: 'sin(v*PI) * sin(u*TAU) * (1 + 0.25*sin(5*u*TAU + t) * sin(4*v*PI))',
    } : {}),
    ...(kind === 'text' ? { name: '3D text', color: '#ffffff', material: 'toon' as MaterialKind, text3d: { text: 'RICO', font: 'Teletactile', size: 0.6, depth: 0.15, bevel: 0.01, curve: 8, spacing: 0, align: 'center' as const }, outline: { ...OUTLINE_DEFAULT } } : {}),
    ...(kind === 'comic' ? { name: 'Comic page', position: [0, 1.7, -1] as Vec3, color: '#f6f1e6', material: 'toon' as MaterialKind, comic: { width: 2.4, height: 3.2, rows: 3, cols: 2, gutter: 0.08, border: 0.12, depth: 0.25, tilt: 0.35, seed: 3, back: false }, outline: { ...OUTLINE_DEFAULT, width: 0.02 } } : {}),
    ...(kind === 'fluid' ? { name: 'Fluid', position: [0, 1.5, 0] as Vec3, scale: [1, 1, 1] as Vec3, color: '#2f8fff', material: 'glass' as MaterialKind, roughness: 0.05, fluid: { ...FLUID_DEFAULT } } : {}),
    ...(kind === 'fog' ? { name: 'Fog', position: [0, 1, 0] as Vec3, scale: [5, 2.5, 5] as Vec3, color: '#c8d4ff', fog: { ...FOG_DEFAULT } } : {}),
    ...(kind === 'math-solid' ? { name: 'Math solid', res: 48, a: 0, b: 0, solid: 'max(abs(x)+abs(y)+abs(z) - 1.1, -(sqrt(x*x+y*y+z*z) - 0.8 - 0.1*sin(t*2)))' } : {}),
    ...(kind === 'code-shape' ? { name: 'Code shape', a: 0, b: 0, code: `// point(x, y, z) returns its number. tri(i, j, k) and quad(i, j, k, l) make faces.
const n = 64
for (let i = 0; i < n; i++) {
  const k = i / n * TAU
  const r = 1 + 0.3 * sin(k * 5 + t)
  point(cos(k) * r, -0.3, sin(k) * r)
  point(cos(k) * r * 0.6, 0.6 + a, sin(k) * r * 0.6)
}
for (let i = 0; i < n; i++) { const j = (i + 1) % n; quad(i*2, j*2, j*2+1, i*2+1) }` } : {}),
    ...extra,
  }
}

export function starterWorld(): World3D {
  const floor = newObject('plane', { name: 'Floor', roughness: 0.6 })
  const knot = newObject('knot', { name: 'Knot', position: [0, 1.3, 0], spin: 6 })
  knot.bindings.scale = { signal: 'audio:low', min: 0.8, max: 1.4, smooth: 0.6 }
  const ball = newObject('sphere', { name: 'Ball', position: [-2.2, 0.7, 0.6], scale: [0.7, 0.7, 0.7], material: 'chrome', color: '#ffffff' })
  const crystal = newObject('icosa', { name: 'Crystal', position: [2.2, 0.9, -0.4], material: 'glass', color: '#ffffff', spin: 10 })
  const key = newObject('point-light', { name: 'Pink light', position: [-3, 3, 2], color: '#f820a0', intensity: 30 })
  key.bindings.intensity = { signal: 'audio:kick', min: 10, max: 60, smooth: 0.3 }
  const fill = newObject('point-light', { name: 'Blue light', position: [3, 2.5, -2], color: '#2f55ff', intensity: 25 })
  const sun = newObject('sun', { name: 'Sun', position: [4, 8, 5], intensity: 1.2 })
  return {
    version: 1,
    objects: [floor, knot, ball, crystal, key, fill, sun],
    background: '#2a2a2a', fog: 0.04, grid: true,
    camera: { position: [5, 3.5, 6], target: [0, 1, 0], fov: 45 },
  }
}

const KEY = 'rico.3d'
let world: World3D = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (v && Array.isArray(v.objects)) {
      // the studio grey (once): scenes still on the old black and green get it
      if (!v.greyStudio) { v.greyStudio = true; if (v.background === '#000000') v.background = '#2a2a2a'; if (v.env?.gridColor === '#3bff03') delete v.env.gridColor }
      return { ...starterWorld(), ...v }
    }
  } catch {
    /* fall through */
  }
  return starterWorld()
})()
let selected: string | null = null
let version = 0
const listeners = new Set<() => void>()

function emit() {
  version++
  listeners.forEach((l) => l())
}

let saveTimer = 0
function commit(next: World3D) {
  world = next
  emit()
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(world))
    } catch {
      // A big imported model: keep everything but the model files.
      try {
        localStorage.setItem(KEY, JSON.stringify({ ...world, objects: world.objects.map((o) => ({ ...o, model: undefined })) }))
      } catch {
        /* not remembered */
      }
    }
  }, 400)
}

export function useWorld<T>(pick: (w: World3D, sel: string | null) => T): T {
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => version,
  )
  return pick(world, selected)
}

export const getWorld = () => world
export function onWorldChange(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
export const getSelected3d = () => selected
export function select3d(id: string | null) {
  selected = id
  emit()
}

export function changeWorld(label: string, fn: (w: World3D) => World3D, key?: string) {
  const before = world
  const after = fn(world)
  commit(after)
  record({ label, key, undo: () => commit(before), redo: () => commit(after) })
}

export function replaceWorld(w: World3D) {
  commit(w)
}

export function updateObject(id: string, part: Partial<Obj3D>, label = 'Change object', key?: string) {
  changeWorld(label, (w) => ({ ...w, objects: w.objects.map((o) => (o.id === id ? { ...o, ...part } : o)) }), key ?? `${id}.${Object.keys(part).join()}`)
}

export function addObject(o: Obj3D) {
  changeWorld(`Add ${o.name}`, (w) => ({ ...w, objects: [...w.objects, o] }))
  select3d(o.id)
}

export function removeObject(id: string) {
  changeWorld('Delete object', (w) => ({ ...w, objects: w.objects.filter((o) => o.id !== id) }))
  if (selected === id) select3d(null)
}

export function duplicateObject(id: string) {
  const o = world.objects.find((x) => x.id === id)
  if (!o) return
  const copy = { ...o, id: uid(), name: `${o.name} copy`, position: [o.position[0] + 0.5, o.position[1], o.position[2] + 0.5] as Vec3 }
  addObject(copy)
}
export { uid }
