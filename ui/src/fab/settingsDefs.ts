import type { Printer, PrintChoice } from './printers'

// The list of every print setting the settings box shows: where it goes,
// what it is called, its range, and a short hint. The box draws itself from
// this list, so search, the simple and advanced views and the reset buttons
// work the same for all of them.

export type Tab = 'quality' | 'strength' | 'speed' | 'support' | 'others' | 'filament' | 'printer' | 'automation'
export const TABS: { id: Tab; name: string }[] = [
  { id: 'quality', name: 'Quality' }, { id: 'strength', name: 'Strength' }, { id: 'speed', name: 'Speed' }, { id: 'support', name: 'Support' },
  { id: 'others', name: 'Others' }, { id: 'filament', name: 'Filament' }, { id: 'printer', name: 'Printer' }, { id: 'automation', name: 'Automation' },
]

export interface Def {
  key: string
  tab: Tab
  group: string
  label: string
  hint?: string
  type: 'num' | 'bool' | 'choice' | 'text' | 'code'
  min?: number; max?: number; step?: number; digits?: number; suffix?: string
  scale?: number                         // shown as value x scale (100 for %)
  flip?: number                          // shown as flip - value (an angle from the other side)
  choices?: [string, string][]
  adv?: boolean                          // only in the advanced view
  printer?: boolean                      // kept with the printer, not the print settings
  fallback?: (s: PrintChoice, p: Printer) => number | string | boolean   // shown when not set
  show?: (s: PrintChoice, p: Printer) => boolean
}

const mm = { suffix: ' mm', digits: 2, step: 0.01 }
const mms = { suffix: ' mm/s', digits: 0, step: 1, min: 1, max: 1000 }
const acc = { suffix: ' mm/s2', digits: 0, step: 50, min: 0, max: 100000 }
const pc = { suffix: '%', digits: 0, step: 1, scale: 100 }
const lw = (s: PrintChoice) => s.lineWidth
const sup = (s: PrintChoice) => (s.support ?? 'none') !== 'none'
const tree = (s: PrintChoice) => sup(s) && s.supportType === 'tree'

export const DEFS: Def[] = [
  // quality
  { key: 'layer', tab: 'quality', group: 'Layer height', label: 'Layer height', type: 'num', min: 0.04, max: 1, ...mm },
  { key: 'firstLayer', tab: 'quality', group: 'Layer height', label: 'First layer height', hint: 'Thicker sticks better', type: 'num', min: 0.08, max: 1, ...mm },
  { key: 'lineWidth', tab: 'quality', group: 'Line width', label: 'Default', hint: 'Usually the nozzle size, a bit more', type: 'num', min: 0.1, max: 2, ...mm },
  { key: 'firstWidth', tab: 'quality', group: 'Line width', label: 'First layer', type: 'num', min: 0.1, max: 2, ...mm, fallback: lw, adv: true },
  { key: 'outerWidth', tab: 'quality', group: 'Line width', label: 'Outer wall', type: 'num', min: 0.1, max: 2, ...mm, fallback: lw, adv: true },
  { key: 'innerWidth', tab: 'quality', group: 'Line width', label: 'Inner wall', type: 'num', min: 0.1, max: 2, ...mm, fallback: lw, adv: true },
  { key: 'topWidth', tab: 'quality', group: 'Line width', label: 'Top surface', type: 'num', min: 0.1, max: 2, ...mm, fallback: (s) => s.solidWidth || s.lineWidth, adv: true },
  { key: 'infillWidth', tab: 'quality', group: 'Line width', label: 'Sparse infill', type: 'num', min: 0.1, max: 2, ...mm, fallback: lw, adv: true },
  { key: 'solidWidth', tab: 'quality', group: 'Line width', label: 'Internal solid infill', type: 'num', min: 0.1, max: 2, ...mm, fallback: lw, adv: true },
  { key: 'supportWidth', tab: 'quality', group: 'Line width', label: 'Support', type: 'num', min: 0.1, max: 2, ...mm, fallback: lw, adv: true },
  { key: 'seam', tab: 'quality', group: 'Seam', label: 'Seam position', hint: 'Where each wall starts and ends', type: 'choice', choices: [['nearest', 'Nearest'], ['aligned', 'Aligned'], ['back', 'Back'], ['random', 'Random']] },
  { key: 'xyComp', tab: 'quality', group: 'Precision', label: 'X-Y contour compensation', hint: 'Grows (+) or shrinks (-) the outside of the part. For parts that must fit', type: 'num', min: -2, max: 2, ...mm },
  { key: 'holeComp', tab: 'quality', group: 'Precision', label: 'X-Y hole compensation', hint: 'Grows (+) or shrinks (-) the holes. Holes often print small', type: 'num', min: -2, max: 2, ...mm },
  { key: 'elephantFoot', tab: 'quality', group: 'Precision', label: 'Elephant foot compensation', hint: 'Pulls the first layer in, so it does not bulge', type: 'num', min: 0, max: 1, ...mm },
  { key: 'res', tab: 'quality', group: 'Precision', label: 'Resolution', hint: 'Grid size the part is cut on. Smaller: more detail, slower', type: 'num', min: 0.01, max: 0.5, step: 0.005, digits: 3, suffix: ' mm', fallback: (s) => Math.round((s.lineWidth / 5) * 1000) / 1000, adv: true },
  { key: 'ironing', tab: 'quality', group: 'Ironing', label: 'Ironing type', hint: 'Goes over top surfaces again with almost no plastic, to make them smooth', type: 'choice', choices: [['none', 'No ironing'], ['topmost', 'Topmost surface'], ['top', 'All top surfaces']] },
  { key: 'ironFlow', tab: 'quality', group: 'Ironing', label: 'Ironing flow', type: 'num', min: 0, max: 0.5, ...pc, show: (s) => (s.ironing ?? 'none') !== 'none' },
  { key: 'ironSpacing', tab: 'quality', group: 'Ironing', label: 'Ironing line spacing', type: 'num', min: 0.03, max: 1, ...mm, show: (s) => (s.ironing ?? 'none') !== 'none' },
  { key: 'ironSpeed', tab: 'quality', group: 'Ironing', label: 'Ironing speed', type: 'num', ...mms, fallback: () => 20, show: (s) => (s.ironing ?? 'none') !== 'none' },
  { key: 'wallOrder', tab: 'quality', group: 'Walls', label: 'Wall order', hint: 'Inner first: cleaner outside. Outer first: more exact size', type: 'choice', choices: [['inner-outer', 'Inner, then outer'], ['outer-inner', 'Outer, then inner']], adv: true },
  { key: 'fuzzy', tab: 'quality', group: 'Fuzzy skin', label: 'Fuzzy skin', hint: 'A rough outside, like a texture', type: 'choice', choices: [['none', 'None'], ['outer', 'Outer wall'], ['all', 'All walls']], adv: true },
  { key: 'fuzzyThick', tab: 'quality', group: 'Fuzzy skin', label: 'Thickness', type: 'num', min: 0.05, max: 2, ...mm, adv: true, show: (s) => (s.fuzzy ?? 'none') !== 'none' },
  { key: 'fuzzyDist', tab: 'quality', group: 'Fuzzy skin', label: 'Point distance', type: 'num', min: 0.1, max: 5, ...mm, adv: true, show: (s) => (s.fuzzy ?? 'none') !== 'none' },

  // strength
  { key: 'perimeters', tab: 'strength', group: 'Walls', label: 'Wall loops', type: 'num', min: 0, max: 20, step: 0.05, digits: 0 },
  { key: 'topLayers', tab: 'strength', group: 'Top and bottom shells', label: 'Top shell layers', type: 'num', min: 0, max: 30, step: 0.05, digits: 0, fallback: (s) => s.solidLayers },
  { key: 'bottomLayers', tab: 'strength', group: 'Top and bottom shells', label: 'Bottom shell layers', type: 'num', min: 0, max: 30, step: 0.05, digits: 0, fallback: (s) => s.solidLayers },
  { key: 'topPattern', tab: 'strength', group: 'Top and bottom shells', label: 'Top surface pattern', type: 'choice', choices: [['lines', 'Lines'], ['monotonic', 'Monotonic'], ['concentric', 'Concentric']] },
  { key: 'bottomPattern', tab: 'strength', group: 'Top and bottom shells', label: 'Bottom surface pattern', type: 'choice', choices: [['lines', 'Lines'], ['monotonic', 'Monotonic'], ['concentric', 'Concentric']] },
  { key: 'infill', tab: 'strength', group: 'Sparse infill', label: 'Sparse infill density', hint: 'A gobo must be 100%, or light comes through', type: 'num', min: 0, max: 1, ...pc },
  { key: 'infillPattern', tab: 'strength', group: 'Sparse infill', label: 'Sparse infill pattern', type: 'choice', choices: [['rectilinear', 'Rectilinear'], ['aligned', 'Aligned rectilinear'], ['grid', 'Grid'], ['triangles', 'Triangles'], ['cubic', 'Cubic'], ['gyroid', 'Gyroid'], ['concentric', 'Concentric']] },
  { key: 'infillAngle', tab: 'strength', group: 'Sparse infill', label: 'Infill direction', type: 'num', min: 0, max: 180, step: 1, digits: 0, suffix: ' deg', adv: true },
  { key: 'infillOverlap', tab: 'strength', group: 'Sparse infill', label: 'Infill and wall overlap', hint: 'How far infill reaches into the walls, so they hold together', type: 'num', min: 0, max: 0.5, ...pc, adv: true },

  // speed
  { key: 'firstSpeed', tab: 'speed', group: 'First layer', label: 'First layer', type: 'num', ...mms },
  { key: 'firstInfillSpeed', tab: 'speed', group: 'First layer', label: 'First layer infill', type: 'num', ...mms, fallback: (s) => s.firstSpeed, adv: true },
  { key: 'slowLayers', tab: 'speed', group: 'First layer', label: 'Number of slow layers', hint: 'Layers that speed up bit by bit from the first layer speed', type: 'num', min: 0, max: 20, step: 0.05, digits: 0, adv: true },
  { key: 'outerSpeed', tab: 'speed', group: 'Other layers', label: 'Outer wall', type: 'num', ...mms, fallback: (s) => s.wallSpeed },
  { key: 'wallSpeed', tab: 'speed', group: 'Other layers', label: 'Inner wall', type: 'num', ...mms },
  { key: 'speed', tab: 'speed', group: 'Other layers', label: 'Sparse infill', type: 'num', ...mms },
  { key: 'solidSpeed', tab: 'speed', group: 'Other layers', label: 'Internal solid infill', type: 'num', ...mms, fallback: (s) => s.speed },
  { key: 'topSpeed', tab: 'speed', group: 'Other layers', label: 'Top surface', type: 'num', ...mms, fallback: (s) => s.solidSpeed || s.speed },
  { key: 'supportSpeed', tab: 'speed', group: 'Other layers', label: 'Support', type: 'num', ...mms, fallback: (s) => s.speed, adv: true },
  { key: 'interfaceSpeed', tab: 'speed', group: 'Other layers', label: 'Support interface', type: 'num', ...mms, fallback: (s) => s.supportSpeed || s.speed, adv: true },
  { key: 'skirtSpeed', tab: 'speed', group: 'Other layers', label: 'Skirt and brim', type: 'num', ...mms, fallback: (s) => s.firstSpeed, adv: true },
  { key: 'travel', tab: 'speed', group: 'Travel', label: 'Travel', type: 'num', ...mms },
  { key: 'accel', tab: 'speed', group: 'Acceleration', label: 'Normal printing', hint: 'From your printer settings', type: 'num', ...acc, printer: true, fallback: () => 1000 },
  { key: 'accelOuter', tab: 'speed', group: 'Acceleration', label: 'Outer wall', hint: '0: the normal one', type: 'num', ...acc, adv: true },
  { key: 'accelInner', tab: 'speed', group: 'Acceleration', label: 'Inner wall', type: 'num', ...acc, adv: true },
  { key: 'accelInfill', tab: 'speed', group: 'Acceleration', label: 'Infill and support', type: 'num', ...acc, adv: true },
  { key: 'accelTop', tab: 'speed', group: 'Acceleration', label: 'Top surface', type: 'num', ...acc, adv: true },
  { key: 'accelTravel', tab: 'speed', group: 'Acceleration', label: 'Travel', type: 'num', ...acc, adv: true },
  { key: 'accelFirst', tab: 'speed', group: 'Acceleration', label: 'First layer', type: 'num', ...acc, adv: true },
  { key: 'cornerSpeed', tab: 'speed', group: 'Acceleration', label: 'Square corner velocity / jerk', hint: '0: leave the printer as it is', type: 'num', min: 0, max: 50, step: 0.5, digits: 1, suffix: ' mm/s', adv: true },

  // support
  { key: 'support', tab: 'support', group: 'Support', label: 'Enable support', type: 'choice', choices: [['none', 'Off'], ['bed', 'On build plate only'], ['everywhere', 'Everywhere']] },
  { key: 'supportType', tab: 'support', group: 'Support', label: 'Type', hint: 'Tree: branches that go around the part, less plastic and easier to take off', type: 'choice', choices: [['normal', 'Normal'], ['tree', 'Tree']], show: sup },
  { key: 'supportManual', tab: 'support', group: 'Support', label: 'Only in my support boxes', hint: 'Manual: support only where you put a box (below)', type: 'bool', show: sup },
  { key: 'supportCritical', tab: 'support', group: 'Support', label: 'Support critical regions only', hint: 'Only where the print would fail without it: parts that start in mid air, and parts that reach out far over air', type: 'bool', show: sup },
  { key: 'criticalDist', tab: 'support', group: 'Support', label: 'Critical reach', hint: 'How far a part can reach out over air before it needs support', type: 'num', min: 0.5, max: 30, step: 0.1, digits: 1, suffix: ' mm', show: (s) => sup(s) && Boolean(s.supportCritical) },
  { key: 'supportAngle', tab: 'support', group: 'Support', label: 'Threshold angle', hint: 'Surfaces flatter than this (from the bed) get support', type: 'num', min: 5, max: 85, step: 0.5, digits: 0, suffix: ' deg', flip: 90, show: sup },
  { key: 'supportMinArea', tab: 'support', group: 'Support', label: 'Remove small overhangs', hint: 'Overhangs smaller than this get no support', type: 'num', min: 0, max: 500, step: 0.5, digits: 1, suffix: ' mm2', show: sup },
  { key: 'supportTopZ', tab: 'support', group: 'Gaps', label: 'Top Z distance', hint: 'Air between the support and the part on it, so it comes off', type: 'num', min: 0, max: 2, ...mm, fallback: (s) => s.layer, show: sup },
  { key: 'supportBottomZ', tab: 'support', group: 'Gaps', label: 'Bottom Z distance', type: 'num', min: 0, max: 2, ...mm, fallback: () => 0, show: sup, adv: true },
  { key: 'supportGap', tab: 'support', group: 'Gaps', label: 'Support/object XY distance', type: 'num', min: 0.1, max: 5, ...mm, show: sup },
  { key: 'supportPattern', tab: 'support', group: 'Base', label: 'Base pattern', type: 'choice', choices: [['lines', 'Rectilinear'], ['grid', 'Rectilinear grid']], show: (s) => sup(s) && !tree(s) },
  { key: 'supportWalls', tab: 'support', group: 'Base', label: 'Support wall loops', hint: 'Loops around each piece of support, so it stands firm', type: 'num', min: 0, max: 4, step: 0.05, digits: 0, show: (s) => sup(s) && !tree(s) },
  { key: 'supportSpacing', tab: 'support', group: 'Base', label: 'Base pattern spacing', type: 'num', min: 0.5, max: 10, step: 0.05, digits: 1, suffix: ' mm', show: (s) => sup(s) && !tree(s) },
  { key: 'interfaceTop', tab: 'support', group: 'Interface', label: 'Top interface layers', hint: 'Dense layers right under the part, for a clean surface', type: 'num', min: 0, max: 10, step: 0.05, digits: 0, show: sup },
  { key: 'interfaceBottom', tab: 'support', group: 'Interface', label: 'Bottom interface layers', type: 'num', min: 0, max: 10, step: 0.05, digits: 0, show: sup, adv: true },
  { key: 'interfaceSpacing', tab: 'support', group: 'Interface', label: 'Interface spacing', type: 'num', min: 0.1, max: 3, ...mm, show: sup },
  { key: 'treeAngle', tab: 'support', group: 'Tree', label: 'Branch angle', hint: 'How much a branch may lean', type: 'num', min: 5, max: 70, step: 0.5, digits: 0, suffix: ' deg', show: tree },
  { key: 'treeBranchDist', tab: 'support', group: 'Tree', label: 'Branch distance', hint: 'Between the tips under the part', type: 'num', min: 0.5, max: 20, step: 0.1, digits: 1, suffix: ' mm', show: tree },
  { key: 'treeTip', tab: 'support', group: 'Tree', label: 'Tip diameter', type: 'num', min: 0.2, max: 5, ...mm, show: tree },
  { key: 'treeMax', tab: 'support', group: 'Tree', label: 'Branch diameter', hint: 'The thickest a trunk gets', type: 'num', min: 1, max: 30, step: 0.1, digits: 1, suffix: ' mm', show: tree },
  { key: 'treeGrow', tab: 'support', group: 'Tree', label: 'Branch diameter angle', hint: 'How fast branches get thicker going down', type: 'num', min: 0, max: 15, step: 0.1, digits: 1, suffix: ' deg', show: tree, adv: true },

  // others
  { key: 'prime', tab: 'others', group: 'Purge line', label: 'Purge line before the print', hint: 'A thick line at the edge of the bed, to get the plastic flowing', type: 'bool' },
  { key: 'primeWhere', tab: 'others', group: 'Purge line', label: 'Where', type: 'choice', choices: [['left', 'Left edge'], ['front', 'Front edge']], show: (s) => Boolean(s.prime) },
  { key: 'primeLength', tab: 'others', group: 'Purge line', label: 'Length', type: 'num', min: 20, max: 300, step: 1, digits: 0, suffix: ' mm', show: (s) => Boolean(s.prime) },
  { key: 'primeAmount', tab: 'others', group: 'Purge line', label: 'Thickness', hint: '100% is a line twice the nozzle wide', type: 'num', min: 0.5, max: 2.5, ...pc, show: (s) => Boolean(s.prime) },
  { key: 'skirt', tab: 'others', group: 'Skirt', label: 'Skirt', hint: 'A loop around the part on the first layer, to start the flow', type: 'bool' },
  { key: 'skirtLoops', tab: 'others', group: 'Skirt', label: 'Skirt loops', type: 'num', min: 1, max: 20, step: 0.05, digits: 0, show: (s) => s.skirt },
  { key: 'skirtDistance', tab: 'others', group: 'Skirt', label: 'Skirt distance', type: 'num', min: 0, max: 50, step: 0.1, digits: 1, suffix: ' mm', show: (s) => s.skirt },
  { key: 'skirtHeight', tab: 'others', group: 'Skirt', label: 'Skirt height', hint: 'Layers. Higher makes a wall that keeps drafts off', type: 'num', min: 1, max: 100, step: 0.05, digits: 0, suffix: ' layers', show: (s) => s.skirt, adv: true },
  { key: 'brim', tab: 'others', group: 'Brim', label: 'Brim type', hint: 'Loops stuck to the part on the first layer, so corners do not lift', type: 'choice', choices: [['none', 'No brim'], ['outer', 'Outer brim only'], ['all', 'Outer and inner brim']] },
  { key: 'brimWidth', tab: 'others', group: 'Brim', label: 'Brim width', type: 'num', min: 0.5, max: 50, step: 0.1, digits: 1, suffix: ' mm', show: (s) => (s.brim ?? 'none') !== 'none' },
  { key: 'brimGap', tab: 'others', group: 'Brim', label: 'Brim-object gap', hint: 'A small gap makes the brim easier to take off', type: 'num', min: 0, max: 2, ...mm, show: (s) => (s.brim ?? 'none') !== 'none' },
  { key: 'raftLayers', tab: 'others', group: 'Raft', label: 'Raft layers', hint: 'A plate under the part. 0: no raft', type: 'num', min: 0, max: 10, step: 0.05, digits: 0 },
  { key: 'raftExpand', tab: 'others', group: 'Raft', label: 'Raft expansion', type: 'num', min: 0, max: 20, step: 0.1, digits: 1, suffix: ' mm', show: (s) => (s.raftLayers ?? 0) > 0 },
  { key: 'raftGap', tab: 'others', group: 'Raft', label: 'Raft contact Z distance', type: 'num', min: 0, max: 1, ...mm, show: (s) => (s.raftLayers ?? 0) > 0 },
  { key: 'vase', tab: 'others', group: 'Special mode', label: 'Spiral vase', hint: 'One wall going up in a spiral, no top and no infill', type: 'bool' },
  { key: 'pauseHeights', tab: 'others', group: 'Special mode', label: 'Filament change at heights', hint: 'mm, with commas, like 2.4, 5. The printer stops so you can change the color', type: 'text' },

  // filament
  { key: 'firstNozzleTemp', tab: 'filament', group: 'Temperature', label: 'Nozzle, first layer', type: 'num', min: 150, max: 450, step: 1, digits: 0, suffix: ' C', fallback: (s) => s.nozzleTemp },
  { key: 'nozzleTemp', tab: 'filament', group: 'Temperature', label: 'Nozzle, other layers', type: 'num', min: 150, max: 450, step: 1, digits: 0, suffix: ' C' },
  { key: 'firstBedTemp', tab: 'filament', group: 'Temperature', label: 'Bed, first layer', type: 'num', min: 0, max: 150, step: 1, digits: 0, suffix: ' C', fallback: (s) => s.bedTemp },
  { key: 'bedTemp', tab: 'filament', group: 'Temperature', label: 'Bed, other layers', type: 'num', min: 0, max: 150, step: 1, digits: 0, suffix: ' C' },
  { key: 'flow', tab: 'filament', group: 'Flow', label: 'Flow ratio', type: 'num', min: 0.5, max: 1.5, step: 0.005, digits: 1, suffix: '%', scale: 100 },
  { key: 'pressureAdvance', tab: 'filament', group: 'Flow', label: 'Pressure advance', hint: 'K factor. 0: leave the printer as it is', type: 'num', min: 0, max: 2, step: 0.001, digits: 3 },
  { key: 'filamentMaxFlow', tab: 'filament', group: 'Flow', label: 'Max volumetric speed', hint: 'For this filament. 0: only the hot end limit', type: 'num', min: 0, max: 80, step: 0.5, digits: 1, suffix: ' mm3/s' },
  { key: 'shrink', tab: 'filament', group: 'Flow', label: 'Shrinkage', hint: 'How much the part shrinks as it cools. It is printed that much bigger in X and Y', type: 'num', min: -5, max: 5, step: 0.05, digits: 2, suffix: '%', adv: true },
  { key: 'density', tab: 'filament', group: 'Cost', label: 'Density', type: 'num', min: 0.5, max: 3, step: 0.01, digits: 2, suffix: ' g/cm3', adv: true },
  { key: 'cost', tab: 'filament', group: 'Cost', label: 'Price', hint: 'For a kilo. Used for the cost of a print', type: 'num', min: 0, max: 500, step: 0.5, digits: 2, suffix: ' /kg', adv: true },
  { key: 'fanOffLayers', tab: 'filament', group: 'Cooling', label: 'No cooling for the first', type: 'num', min: 0, max: 20, step: 0.05, digits: 0, suffix: ' layers' },
  { key: 'fanFullLayer', tab: 'filament', group: 'Cooling', label: 'Full fan speed at layer', hint: '0: right away', type: 'num', min: 0, max: 50, step: 0.05, digits: 0, adv: true },
  { key: 'fanMin', tab: 'filament', group: 'Cooling', label: 'Fan speed, normal', type: 'num', min: 0, max: 1, ...pc, fallback: (s) => s.fan },
  { key: 'fan', tab: 'filament', group: 'Cooling', label: 'Fan speed, most', type: 'num', min: 0, max: 1, ...pc },
  { key: 'fanBelowTime', tab: 'filament', group: 'Cooling', label: 'Most fan when a layer takes less than', hint: '0: off', type: 'num', min: 0, max: 120, step: 0.5, digits: 0, suffix: ' s' },
  { key: 'minLayerTime', tab: 'filament', group: 'Cooling', label: 'Slow down when a layer takes less than', hint: 'Small layers get time to cool. 0: off', type: 'num', min: 0, max: 120, step: 0.5, digits: 0, suffix: ' s' },
  { key: 'minSpeed', tab: 'filament', group: 'Cooling', label: 'Min print speed', type: 'num', ...mms, show: (s) => (s.minLayerTime ?? 0) > 0 },

  // printer
  { key: 'flavor', tab: 'printer', group: 'Firmware', label: 'G-code flavor', hint: 'Changes how pauses, pins and pressure advance are written', type: 'choice', choices: [['marlin', 'Marlin'], ['klipper', 'Klipper'], ['reprap', 'RepRapFirmware']], printer: true, fallback: (_s, p) => (p.link === 'klipper' ? 'klipper' : 'marlin') },
  { key: 'zOffset', tab: 'printer', group: 'Firmware', label: 'Z offset', type: 'num', min: -2, max: 2, step: 0.005, digits: 3, suffix: ' mm', printer: true, fallback: () => 0 },
  { key: 'maxFlow', tab: 'printer', group: 'Firmware', label: 'Hot end flow', hint: 'How much plastic the hot end can melt each second', type: 'num', min: 2, max: 80, step: 0.5, digits: 1, suffix: ' mm3/s', printer: true, fallback: () => 12 },
  { key: 'retract', tab: 'printer', group: 'Retraction', label: 'Length', hint: 'Pulls the filament back before a move, stops strings', type: 'num', min: 0, max: 15, ...mm },
  { key: 'retractSpeed', tab: 'printer', group: 'Retraction', label: 'Retraction speed', type: 'num', ...mms, max: 200 },
  { key: 'deretractSpeed', tab: 'printer', group: 'Retraction', label: 'Deretraction speed', type: 'num', ...mms, max: 200, fallback: (s) => s.retractSpeed, adv: true },
  { key: 'retractExtra', tab: 'printer', group: 'Retraction', label: 'Extra length on restart', type: 'num', min: -2, max: 2, ...mm, adv: true },
  { key: 'retractMin', tab: 'printer', group: 'Retraction', label: 'Travel distance threshold', hint: 'Shorter moves do not pull back', type: 'num', min: 0, max: 20, step: 0.1, digits: 1, suffix: ' mm' },
  { key: 'retractLayer', tab: 'printer', group: 'Retraction', label: 'Retract on layer change', type: 'bool' },
  { key: 'zHop', tab: 'printer', group: 'Retraction', label: 'Z hop', hint: 'The nozzle lifts on a move, so it does not hit the part', type: 'num', min: 0, max: 5, ...mm },
  { key: 'wipe', tab: 'printer', group: 'Retraction', label: 'Wipe distance', hint: 'Wipes back along the line while it pulls back', type: 'num', min: 0, max: 10, step: 0.1, digits: 1, suffix: ' mm', adv: true },
  { key: 'start', tab: 'printer', group: 'G-code', label: 'Start G-code', hint: '{nozzle} and {bed} become the first layer temperatures, {width} and {depth} the bed size', type: 'code', printer: true },
  { key: 'end', tab: 'printer', group: 'G-code', label: 'End G-code', type: 'code', printer: true },
  { key: 'beforeLayer', tab: 'printer', group: 'G-code', label: 'Before layer change', hint: '{layer}, {layer_num} and {z} become the layer and its height', type: 'code', printer: true, adv: true },
  { key: 'afterLayer', tab: 'printer', group: 'G-code', label: 'After layer change', hint: 'A camera for time lapses often goes here', type: 'code', printer: true, adv: true },
  { key: 'pauseG', tab: 'printer', group: 'G-code', label: 'Pause G-code', hint: 'Empty: PAUSE on Klipper, M0 on Marlin, M226 on RepRapFirmware', type: 'code', printer: true, adv: true },
  { key: 'changeG', tab: 'printer', group: 'G-code', label: 'Filament change G-code', hint: 'Empty: PAUSE on Klipper, M600 on the others', type: 'code', printer: true, adv: true },
]
