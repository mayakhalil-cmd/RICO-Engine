// Every print setting in one place: what the slicer cuts with, and what the
// G-code is written with. Fields marked optional fall back to a simpler one
// (for example the outside wall width falls back to the line width), so old
// saved settings keep working.

export type SupportWhere = 'none' | 'bed' | 'everywhere'

// A box on the bed where you want support (enforce) or never want it (block).
// x, y: the middle of the box on the bed, w, d: its size, z0 to z1: heights. mm.
export interface SupportBox { id: string; kind: 'enforce' | 'block'; x: number; y: number; w: number; d: number; z0: number; z1: number }

export type InfillPattern = 'rectilinear' | 'aligned' | 'grid' | 'triangles' | 'cubic' | 'gyroid' | 'concentric'
export type SolidPattern = 'lines' | 'monotonic' | 'concentric'

export interface SliceSettings {
  layer: number          // layer height
  firstLayer: number     // first layer height
  lineWidth: number      // usually the nozzle size, a bit more
  perimeters: number     // walls
  infill: number         // 0..1 (1: solid)
  solidLayers: number    // solid layers at the top and the bottom (when top and bottom are not set apart)
  skirt: boolean         // loops around the part on the first layer, to start the flow
  support?: SupportWhere // holds up parts that hang in the air: only from the bed, or also on the part
  supportGap?: number    // mm between the support and the part, sideways
  supportSpacing?: number // mm between support lines
  supportAngle?: number  // degrees from straight up a wall can lean before it needs support
  res?: number           // mm per grid cell (chosen for you)

  // line widths for each kind of line (0 or unset: the line width)
  firstWidth?: number
  outerWidth?: number
  innerWidth?: number
  infillWidth?: number
  solidWidth?: number
  topWidth?: number
  supportWidth?: number

  // walls
  seam?: 'nearest' | 'aligned' | 'back' | 'random'
  wallOrder?: 'inner-outer' | 'outer-inner'
  xyComp?: number        // mm: grows (+) or shrinks (-) the outside of the part
  holeComp?: number      // mm: grows (+) or shrinks (-) holes
  elephantFoot?: number  // mm the first layer is pulled in, so it does not bulge
  fuzzy?: 'none' | 'outer' | 'all'
  fuzzyThick?: number    // mm
  fuzzyDist?: number     // mm between bumps
  vase?: boolean         // one wall, going up in a spiral, no top

  // top, bottom and infill
  topLayers?: number
  bottomLayers?: number
  infillPattern?: InfillPattern
  infillAngle?: number   // degrees
  infillOverlap?: number // 0..1 of a line width into the walls
  topPattern?: SolidPattern
  bottomPattern?: SolidPattern
  ironing?: 'none' | 'topmost' | 'top'
  ironSpacing?: number   // mm
  ironFlow?: number      // 0..1

  // first layer helpers
  skirtLoops?: number
  skirtDistance?: number // mm from the part
  skirtHeight?: number   // layers
  brim?: 'none' | 'outer' | 'all'
  brimWidth?: number     // mm
  brimGap?: number       // mm between the brim and the part
  raftLayers?: number    // 0: no raft
  raftExpand?: number    // mm past the part
  raftGap?: number       // mm of air between the raft and the part

  // support
  supportType?: 'normal' | 'tree'
  supportManual?: boolean      // only inside your own support boxes
  supportCritical?: boolean    // only where the print would fail without it
  criticalDist?: number        // mm a part can reach out over air before it counts as critical
  supportMinArea?: number      // mm2: smaller overhangs get no support
  supportTopZ?: number         // mm of air between the support and the part above it
  supportBottomZ?: number      // mm of air between the support and the part under it
  interfaceTop?: number        // layers of dense support right under the part
  interfaceBottom?: number     // layers of dense support on top of the part
  interfaceSpacing?: number    // mm between interface lines
  supportPattern?: 'lines' | 'grid'
  supportWalls?: number        // loops around each piece of support, so it stands firm
  supportBoxes?: SupportBox[]
  treeAngle?: number           // degrees a branch may lean
  treeBranchDist?: number      // mm between branch tips
  treeTip?: number             // mm across a branch tip
  treeMax?: number             // mm across the thickest trunk
  treeGrow?: number            // degrees a branch widens going down
}

export type PathKind = 'outer' | 'inner' | 'infill' | 'solid' | 'top' | 'skirt' | 'brim' | 'raft' | 'support' | 'interface' | 'ironing'
// x, y pairs. w: line width (unset: the line width). flow: a share of the full line (ironing).
export interface Path { kind: PathKind; pts: number[]; closed: boolean; w?: number; flow?: number }
export interface Layer { z: number; h: number; paths: Path[]; vase?: boolean; raft?: boolean }

export const SLICE_DEFAULTS: SliceSettings = {
  layer: 0.2, firstLayer: 0.2, lineWidth: 0.45, perimeters: 2, infill: 0.2, solidLayers: 4, skirt: true,
  support: 'none', supportGap: 0.7, supportSpacing: 2.5, supportAngle: 55,
  seam: 'nearest', wallOrder: 'inner-outer', xyComp: 0, holeComp: 0, elephantFoot: 0, fuzzy: 'none', fuzzyThick: 0.3, fuzzyDist: 0.8, vase: false,
  infillPattern: 'rectilinear', infillAngle: 45, infillOverlap: 0.15, topPattern: 'lines', bottomPattern: 'lines',
  ironing: 'none', ironSpacing: 0.1, ironFlow: 0.1,
  skirtLoops: 1, skirtDistance: 3, skirtHeight: 1, brim: 'none', brimWidth: 5, brimGap: 0.1, raftLayers: 0, raftExpand: 1.5, raftGap: 0.15,
  supportType: 'normal', supportManual: false, supportCritical: false, criticalDist: 3, supportMinArea: 0,
  interfaceTop: 2, interfaceBottom: 0, interfaceSpacing: 0.5, supportPattern: 'lines', supportWalls: 1, supportBoxes: [],
  treeAngle: 40, treeBranchDist: 3, treeTip: 0.8, treeMax: 8, treeGrow: 5,
}

// ---- what the G-code is written with ----

export type Flavor = 'marlin' | 'klipper' | 'reprap'

// What happens at a moment of the print (see automation.ts).
export type StepKind = 'gcode' | 'pause' | 'filament' | 'park' | 'dwell' | 'pin' | 'waitPin' | 'cool' | 'home' | 'signal' | 'waitSignal'
export interface Step {
  kind: StepKind
  text?: string          // gcode: the lines; pause: a note
  x?: number; y?: number; lift?: number   // park
  seconds?: number       // dwell; waitSignal: give up after (0: wait for ever)
  pin?: string           // pin: a number (Marlin, RepRap) or an output name (Klipper)
  value?: number         // pin: 0..1; waitPin: the state to wait for
  temp?: number          // cool: wait until the bed is this cold
  signal?: string        // signal: the name it is sent as; waitSignal: the RICO signal to wait for
  osc?: string           // signal: also send this OSC address
  onTimeout?: 'resume' | 'cancel'
}
export type When = 'start' | 'layer' | 'every' | 'atLayer' | 'atHeight' | 'end'
export interface Rule { id: string; name: string; on: boolean; when: When; n?: number; z?: number; steps: Step[] }

export interface PrintSettings extends SliceSettings {
  nozzleTemp: number
  bedTemp: number
  speed: number          // sparse infill, mm/s
  wallSpeed: number      // inside walls, mm/s
  firstSpeed: number     // first layer, mm/s
  travel: number         // mm/s
  retract: number        // mm
  retractSpeed: number   // mm/s
  fan: number            // 0..1 the most the fan runs
  flow: number           // 1 = as computed
  prime?: boolean        // a purge line along the edge of the bed before the print

  // the purge line
  primeLength?: number   // mm
  primeWhere?: 'left' | 'front'
  primeAmount?: number   // how thick, 1 = normal

  // temperatures
  firstNozzleTemp?: number
  firstBedTemp?: number

  // speeds, mm/s (unset: a simpler one)
  outerSpeed?: number
  solidSpeed?: number
  topSpeed?: number
  supportSpeed?: number
  interfaceSpeed?: number
  ironSpeed?: number
  skirtSpeed?: number
  firstInfillSpeed?: number
  slowLayers?: number    // layers that go from the first layer speed up to full speed
  minLayerTime?: number  // s: a layer faster than this is slowed down, so it can cool
  minSpeed?: number      // mm/s it is never slowed below

  // accelerations, mm/s2 (0: the printer's)
  accelOuter?: number
  accelInner?: number
  accelInfill?: number
  accelTop?: number
  accelTravel?: number
  accelFirst?: number
  cornerSpeed?: number   // mm/s: square corner velocity (Klipper) or jerk (Marlin). 0: leave it

  // fan
  fanMin?: number        // 0..1
  fanOffLayers?: number  // no fan for the first layers
  fanFullLayer?: number  // full fan from this layer
  fanBelowTime?: number  // s: layers faster than this get the most fan

  // retraction
  deretractSpeed?: number
  retractExtra?: number  // mm pushed back in after a move, past what was pulled
  retractMin?: number    // mm: shorter moves do not pull back
  retractLayer?: boolean // pull back at every layer change
  zHop?: number          // mm the nozzle lifts on a move
  wipe?: number          // mm the nozzle wipes back along the line while it pulls back

  // filament
  density?: number       // g/cm3
  cost?: number          // per kg
  pressureAdvance?: number
  filamentMaxFlow?: number // mm3/s
  shrink?: number        // % the part shrinks as it cools (grown back in X and Y)

  // others
  pauseHeights?: string  // "5, 12.4": filament change at these heights (mm)
  automation?: Rule[]
  repeat?: number        // print the same file again this many times
  repeatSignal?: string  // and wait for this RICO signal before each one (the bed is clear)
}

export interface GcodeMachine {
  filament: number; bed: [number, number, number]; center: boolean; start: string; end: string; name: string
  accel?: number         // mm/s2 the printer speeds up with
  maxFlow?: number       // mm3/s the hot end can melt: faster lines are slowed down to this
  flavor?: Flavor
  zOffset?: number       // mm added to every height
  beforeLayer?: string   // G-code before each layer change
  afterLayer?: string    // G-code after each layer change
  pauseG?: string        // how this printer pauses
  changeG?: string       // how this printer changes filament
}

export const PRINT_DEFAULTS: PrintSettings = {
  ...SLICE_DEFAULTS, nozzleTemp: 210, bedTemp: 60, speed: 60, wallSpeed: 40, firstSpeed: 20, travel: 150, retract: 0.8, retractSpeed: 35, fan: 1, flow: 1,
  prime: false, primeLength: 100, primeWhere: 'left', primeAmount: 1,
  slowLayers: 0, minLayerTime: 0, minSpeed: 10, cornerSpeed: 0,
  fanMin: 1, fanOffLayers: 1, fanFullLayer: 0, fanBelowTime: 0,
  retractExtra: 0, retractMin: 1.5, retractLayer: false, zHop: 0, wipe: 0,
  density: 1.24, cost: 20, pressureAdvance: 0, filamentMaxFlow: 0, shrink: 0,
  pauseHeights: '', automation: [],
}

export const START_GCODE = `G90 ; absolute moves
M83 ; extruder moves are relative
M140 S{bed}
M104 S{nozzle}
G28 ; home
M190 S{bed}
M109 S{nozzle}
G92 E0
G1 Z2 F600`
export const END_GCODE = `G1 E-2 F2400
G91
G1 Z10 F600
G90
G1 X5 Y{depth} F6000
M104 S0
M140 S0
M107
M84`

export const PAUSE_G: Record<Flavor, string> = { klipper: 'PAUSE', marlin: 'M0', reprap: 'M226' }
export const CHANGE_G: Record<Flavor, string> = { klipper: 'PAUSE', marlin: 'M600', reprap: 'M600' }
