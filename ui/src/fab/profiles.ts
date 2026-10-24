import { useSyncExternalStore } from 'react'
import { getSettings, setSettings, type PrintChoice, type Printer } from './printers'
import { PRINT_DEFAULTS } from './settings'

// Named print profiles: save the settings you like for each printer or
// filament, switch between them, and share them as files. Profiles from
// other slicers (.json or .ini files) can be read too: the settings RICO
// knows are taken over, the rest is listed.

const KEY = 'rico.print.profiles'
export interface Profile { name: string; settings: Partial<PrintChoice> }
let list: Profile[] | null = null
let version = 0
const ls = new Set<() => void>()
function load(): Profile[] {
  if (list) return list
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? '[]'); list = Array.isArray(v) ? v : [] } catch { list = [] }
  return list!
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(list)) } catch { /* not kept */ } version++; ls.forEach((l) => l()) }
export const useProfiles = () => { useSyncExternalStore((l) => { ls.add(l); return () => ls.delete(l) }, () => version); return load() }

export function saveProfile(name: string) {
  const n = name.trim() || 'My profile'
  const s = { ...getSettings() }
  list = [...load().filter((p) => p.name !== n), { name: n, settings: s }]
  save()
}
export function loadProfile(name: string) {
  const p = load().find((x) => x.name === name)
  if (p) setSettings({ ...PRINT_DEFAULTS, ...p.settings })
}
export function deleteProfile(name: string) { list = load().filter((p) => p.name !== name); save() }

export function exportProfile(name: string, printer?: Printer): string {
  const s = load().find((x) => x.name === name)?.settings ?? getSettings()
  const pr = printer ? { ...printer, key: '', token: '', user: '' } : undefined
  return JSON.stringify({ rico: 'print-profile', version: 1, name, settings: s, printer: pr }, null, 2)
}

// reading profiles

export interface Imported { name: string; settings: Partial<PrintChoice>; printer: Partial<Printer>; used: string[]; skipped: string[] }

type Conv = (v: string, all: Record<string, string>) => unknown
const num: Conv = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : undefined }
const pct: Conv = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? (v.includes('%') || n > 1 ? n / 100 : n) : undefined }
const int: Conv = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? Math.round(n) : undefined }
const bool: Conv = (v) => v === '1' || v.toLowerCase() === 'true'
// widths can be a share of the nozzle ("105%"), or 0 for "the default"
const width: Conv = (v, all) => {
  const n = parseFloat(v)
  if (!Number.isFinite(n) || n <= 0) return undefined
  if (v.includes('%')) return Math.round((n / 100) * (parseFloat(all.nozzle_diameter ?? '0.4') || 0.4) * 1000) / 1000
  return n
}
const pattern: Conv = (v) => ({ rectilinear: 'rectilinear', alignedrectilinear: 'aligned', line: 'aligned', grid: 'grid', triangles: 'triangles', cubic: 'cubic', adaptivecubic: 'cubic', supportcubic: 'cubic', gyroid: 'gyroid', concentric: 'concentric', honeycomb: 'grid', '3dhoneycomb': 'gyroid', lightning: 'rectilinear', stars: 'triangles', crosshatch: 'grid', tpmsd: 'gyroid' } as Record<string, string>)[v.toLowerCase().replace(/[\s_-]/g, '')]
const solidPat: Conv = (v) => { const k = v.toLowerCase(); return k.includes('monotonic') ? 'monotonic' : k.includes('concentric') ? 'concentric' : 'lines' }
const tmpl: Conv = (v) => v
  .replace(/\\n/g, '\n')
  .replace(/[[{](first_layer_bed_temperature|bed_temperature_initial_layer_single|bed_temperature_initial_layer|hot_plate_temp_initial_layer|bed_temperature)(\[\d+\])?[\]}]/g, '{bed}')
  .replace(/[[{](first_layer_temperature|nozzle_temperature_initial_layer|nozzle_temperature|temperature)(\[\d+\])?[\]}]/g, '{nozzle}')
  .replace(/[[{]layer_num[\]}]/g, '{layer_num}').replace(/[[{]layer_z[\]}]/g, '{z}').replace(/[[{](total_layer_count|total_layers)[\]}]/g, '{total}')

// key in the file: [setting, how to read it, goes on the printer]
const MAP: Record<string, [string, Conv, boolean?]> = {
  layer_height: ['layer', num], initial_layer_print_height: ['firstLayer', num], first_layer_height: ['firstLayer', num],
  line_width: ['lineWidth', width], extrusion_width: ['lineWidth', width],
  initial_layer_line_width: ['firstWidth', width], first_layer_extrusion_width: ['firstWidth', width],
  outer_wall_line_width: ['outerWidth', width], external_perimeter_extrusion_width: ['outerWidth', width],
  inner_wall_line_width: ['innerWidth', width], perimeter_extrusion_width: ['innerWidth', width],
  sparse_infill_line_width: ['infillWidth', width], infill_extrusion_width: ['infillWidth', width],
  internal_solid_infill_line_width: ['solidWidth', width], solid_infill_extrusion_width: ['solidWidth', width],
  top_surface_line_width: ['topWidth', width], top_infill_extrusion_width: ['topWidth', width],
  support_line_width: ['supportWidth', width], support_material_extrusion_width: ['supportWidth', width],
  wall_loops: ['perimeters', int], perimeters: ['perimeters', int],
  top_shell_layers: ['topLayers', int], top_solid_layers: ['topLayers', int], bottom_shell_layers: ['bottomLayers', int], bottom_solid_layers: ['bottomLayers', int],
  sparse_infill_density: ['infill', pct], fill_density: ['infill', pct],
  sparse_infill_pattern: ['infillPattern', pattern], fill_pattern: ['infillPattern', pattern],
  infill_direction: ['infillAngle', num], fill_angle: ['infillAngle', num],
  infill_wall_overlap: ['infillOverlap', pct], infill_overlap: ['infillOverlap', pct],
  top_surface_pattern: ['topPattern', solidPat], top_fill_pattern: ['topPattern', solidPat],
  bottom_surface_pattern: ['bottomPattern', solidPat], bottom_fill_pattern: ['bottomPattern', solidPat],
  seam_position: ['seam', (v) => ({ nearest: 'nearest', aligned: 'aligned', back: 'back', rear: 'back', random: 'random' } as Record<string, string>)[v.toLowerCase()]],
  wall_sequence: ['wallOrder', (v) => (v.toLowerCase().startsWith('outer') ? 'outer-inner' : 'inner-outer')],
  external_perimeters_first: ['wallOrder', (v) => (bool(v, {}) ? 'outer-inner' : 'inner-outer')],
  xy_contour_compensation: ['xyComp', num], xy_size_compensation: ['xyComp', num], xy_hole_compensation: ['holeComp', num],
  elefant_foot_compensation: ['elephantFoot', num], elephant_foot_compensation: ['elephantFoot', num],
  ironing_type: ['ironing', (v) => { const k = v.toLowerCase(); return k.includes('topmost') ? 'topmost' : k.includes('top') || k.includes('solid') ? 'top' : 'none' }],
  ironing_flow: ['ironFlow', pct], ironing_spacing: ['ironSpacing', num], ironing_speed: ['ironSpeed', num],
  fuzzy_skin: ['fuzzy', (v) => { const k = v.toLowerCase(); return k === 'none' || k === 'disabled_fuzzy' ? 'none' : k.includes('all') ? 'all' : 'outer' }],
  fuzzy_skin_thickness: ['fuzzyThick', num], fuzzy_skin_point_distance: ['fuzzyDist', num], fuzzy_skin_point_dist: ['fuzzyDist', num],
  spiral_mode: ['vase', bool], spiral_vase: ['vase', bool],
  skirt_loops: ['skirtLoops', int], skirts: ['skirtLoops', int], skirt_distance: ['skirtDistance', num], skirt_height: ['skirtHeight', int],
  brim_type: ['brim', (v) => { const k = v.toLowerCase(); return k.includes('no') ? 'none' : k.includes('inner') ? 'all' : 'outer' }],
  brim_width: ['brimWidth', num], brim_object_gap: ['brimGap', num], brim_separation: ['brimGap', num],
  raft_layers: ['raftLayers', int], raft_contact_distance: ['raftGap', num], raft_expansion: ['raftExpand', num],
  support_critical_regions_only: ['supportCritical', bool],
  support_threshold_angle: ['supportAngle', (v) => { const n = parseFloat(v); return n > 0 ? 90 - n : undefined }],
  support_material_threshold: ['supportAngle', (v) => { const n = parseFloat(v); return n > 0 ? 90 - n : undefined }],
  support_top_z_distance: ['supportTopZ', num], support_material_contact_distance: ['supportTopZ', num],
  support_bottom_z_distance: ['supportBottomZ', num], support_material_bottom_contact_distance: ['supportBottomZ', num],
  support_object_xy_distance: ['supportGap', num], support_material_xy_spacing: ['supportGap', width],
  support_base_pattern_spacing: ['supportSpacing', num], support_material_spacing: ['supportSpacing', num],
  support_interface_top_layers: ['interfaceTop', int], support_material_interface_layers: ['interfaceTop', int],
  support_interface_bottom_layers: ['interfaceBottom', int], support_material_bottom_interface_layers: ['interfaceBottom', int],
  support_interface_spacing: ['interfaceSpacing', num], support_material_interface_spacing: ['interfaceSpacing', num],
  support_base_pattern: ['supportPattern', (v) => (v.toLowerCase().includes('grid') ? 'grid' : 'lines')],
  support_material_pattern: ['supportPattern', (v) => (v.toLowerCase().includes('grid') ? 'grid' : 'lines')],
  tree_support_branch_angle: ['treeAngle', num], tree_support_branch_distance: ['treeBranchDist', num], tree_support_tip_diameter: ['treeTip', num],
  tree_support_branch_diameter: ['treeMax', num], tree_support_branch_diameter_angle: ['treeGrow', num],
  initial_layer_speed: ['firstSpeed', num], first_layer_speed: ['firstSpeed', num],
  initial_layer_infill_speed: ['firstInfillSpeed', num], first_layer_infill_speed: ['firstInfillSpeed', num],
  outer_wall_speed: ['outerSpeed', num], external_perimeter_speed: ['outerSpeed', num],
  inner_wall_speed: ['wallSpeed', num], perimeter_speed: ['wallSpeed', num],
  sparse_infill_speed: ['speed', num], infill_speed: ['speed', num],
  internal_solid_infill_speed: ['solidSpeed', num], solid_infill_speed: ['solidSpeed', num],
  top_surface_speed: ['topSpeed', num], top_solid_infill_speed: ['topSpeed', num],
  support_speed: ['supportSpeed', num], support_material_speed: ['supportSpeed', num],
  support_interface_speed: ['interfaceSpeed', num], support_material_interface_speed: ['interfaceSpeed', num],
  travel_speed: ['travel', num], slow_down_layers: ['slowLayers', int], skirt_speed: ['skirtSpeed', num],
  outer_wall_acceleration: ['accelOuter', num], external_perimeter_acceleration: ['accelOuter', num],
  inner_wall_acceleration: ['accelInner', num], perimeter_acceleration: ['accelInner', num],
  sparse_infill_acceleration: ['accelInfill', num], infill_acceleration: ['accelInfill', num],
  top_surface_acceleration: ['accelTop', num], top_solid_infill_acceleration: ['accelTop', num],
  travel_acceleration: ['accelTravel', num], initial_layer_acceleration: ['accelFirst', num], first_layer_acceleration: ['accelFirst', num],
  default_acceleration: ['accel', num, true],
  nozzle_temperature: ['nozzleTemp', num], temperature: ['nozzleTemp', num],
  nozzle_temperature_initial_layer: ['firstNozzleTemp', num], first_layer_temperature: ['firstNozzleTemp', num],
  hot_plate_temp: ['bedTemp', num], bed_temperature: ['bedTemp', num], textured_plate_temp: ['bedTemp', num],
  hot_plate_temp_initial_layer: ['firstBedTemp', num], first_layer_bed_temperature: ['firstBedTemp', num], textured_plate_temp_initial_layer: ['firstBedTemp', num],
  filament_flow_ratio: ['flow', num], extrusion_multiplier: ['flow', num], pressure_advance: ['pressureAdvance', num],
  filament_max_volumetric_speed: ['filamentMaxFlow', num], filament_density: ['density', num], filament_cost: ['cost', num],
  fan_min_speed: ['fanMin', pct], min_fan_speed: ['fanMin', pct], fan_max_speed: ['fan', pct], max_fan_speed: ['fan', pct],
  close_fan_the_first_x_layers: ['fanOffLayers', int], disable_fan_first_layers: ['fanOffLayers', int], full_fan_speed_layer: ['fanFullLayer', int],
  fan_cooling_layer_time: ['fanBelowTime', num], fan_below_layer_time: ['fanBelowTime', num],
  slow_down_layer_time: ['minLayerTime', num], slowdown_below_layer_time: ['minLayerTime', num],
  slow_down_min_speed: ['minSpeed', num], min_print_speed: ['minSpeed', num],
  retraction_length: ['retract', num], retract_length: ['retract', num], retraction_speed: ['retractSpeed', num], retract_speed: ['retractSpeed', num],
  deretraction_speed: ['deretractSpeed', num], deretract_speed: ['deretractSpeed', num], retract_restart_extra: ['retractExtra', num],
  retraction_minimum_travel: ['retractMin', num], retract_before_travel: ['retractMin', num],
  retract_when_changing_layer: ['retractLayer', bool], retract_layer_change: ['retractLayer', bool],
  z_hop: ['zHop', num], retract_lift: ['zHop', num], wipe_distance: ['wipe', num],
  gcode_flavor: ['flavor', (v) => { const k = v.toLowerCase(); return k.includes('klipper') ? 'klipper' : k.includes('reprap') ? 'reprap' : 'marlin' }, true],
  z_offset: ['zOffset', num, true], nozzle_diameter: ['nozzle', num, true], filament_diameter: ['filament', num, true],
  machine_max_acceleration_extruding: ['accel', num, true], max_volumetric_speed: ['maxFlow', num, true],
  machine_start_gcode: ['start', tmpl, true], start_gcode: ['start', tmpl, true], machine_end_gcode: ['end', tmpl, true], end_gcode: ['end', tmpl, true],
  before_layer_change_gcode: ['beforeLayer', tmpl, true], before_layer_gcode: ['beforeLayer', tmpl, true],
  layer_change_gcode: ['afterLayer', tmpl, true], layer_gcode: ['afterLayer', tmpl, true],
  machine_pause_gcode: ['pauseG', tmpl, true], pause_print_gcode: ['pauseG', tmpl, true],
  change_filament_gcode: ['changeG', tmpl, true], color_change_gcode: ['changeG', tmpl, true],
}

export function readProfile(text: string, fileName = ''): Imported | string {
  const raw: Record<string, string> = {}
  let name = fileName.replace(/\.(json|ini|txt)$/i, '')
  const t = text.trim()
  if (t.startsWith('{')) {
    let j: Record<string, unknown>
    try { j = JSON.parse(t) } catch { return 'This file is not a profile RICO can read.' }
    if (j.rico === 'print-profile') {
      return { name: String(j.name ?? name), settings: (j.settings ?? {}) as Partial<PrintChoice>, printer: (j.printer ?? {}) as Partial<Printer>, used: Object.keys(j.settings ?? {}), skipped: [] }
    }
    if (typeof j.name === 'string') name = j.name
    for (const [k, v] of Object.entries(j)) {
      const first = Array.isArray(v) ? v[0] : v
      if (first === null || first === undefined || typeof first === 'object') continue
      raw[k] = String(first)
    }
  } else {
    for (const line of t.split(/\r?\n/)) {
      const m = /^\s*([\w-]+)\s*=\s*(.*)$/.exec(line)
      if (m) raw[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1')
    }
    if (!Object.keys(raw).length) return 'This file is not a profile RICO can read.'
  }
  const settings: Record<string, unknown> = {}, printer: Record<string, unknown> = {}
  const used: string[] = [], skipped: string[] = []
  // support on or off, and where
  const on = raw.enable_support ?? raw.support_material
  if (on !== undefined) {
    const plate = bool(raw.support_on_build_plate_only ?? raw.support_material_buildplate_only ?? '0', raw)
    settings.support = bool(on, raw) ? (plate ? 'bed' : 'everywhere') : 'none'
    used.push(raw.enable_support !== undefined ? 'enable_support' : 'support_material')
  }
  const type = (raw.support_type ?? raw.support_material_style ?? '').toLowerCase()
  if (type) {
    settings.supportType = type.includes('tree') || type.includes('organic') ? 'tree' : 'normal'
    settings.supportManual = type.includes('manual')
    used.push(raw.support_type ? 'support_type' : 'support_material_style')
  }
  if (raw.skirt_loops !== undefined || raw.skirts !== undefined) settings.skirt = (parseFloat(raw.skirt_loops ?? raw.skirts) || 0) > 0
  if (raw.wipe !== undefined && !bool(raw.wipe, raw)) settings.wipe = 0
  for (const [k, v] of Object.entries(raw)) {
    const m = MAP[k]
    if (!m) { if (!['enable_support', 'support_material', 'support_type', 'support_material_style', 'support_on_build_plate_only', 'support_material_buildplate_only', 'name', 'wipe'].includes(k)) skipped.push(k); continue }
    const val = m[1](v, raw)
    if (val === undefined || val === null || (typeof val === 'number' && !Number.isFinite(val))) { skipped.push(k); continue }
    if (m[0] === 'wipe' && raw.wipe !== undefined && !bool(raw.wipe, raw)) continue
    ;(m[2] ? printer : settings)[m[0]] = val
    used.push(k)
  }
  if (typeof settings.topLayers === 'number' && settings.solidLayers === undefined) settings.solidLayers = settings.topLayers
  return { name: name || 'Imported', settings: settings as Partial<PrintChoice>, printer: printer as Partial<Printer>, used, skipped }
}
