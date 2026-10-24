import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { gcode, PRINT_DEFAULTS, slice, START_GCODE, END_GCODE, type Layer } from './slicer'

function trisOf(g: THREE.BufferGeometry): Float32Array {
  const n = g.index ? g.toNonIndexed() : g
  n.computeBoundingBox()
  const bb = n.boundingBox!
  n.translate(-bb.min.x, -bb.min.y, -bb.min.z)
  return new Float32Array(n.getAttribute('position').array)
}
function plate(w: number, h: number, t: number, hole = 0) {
  const s = new THREE.Shape()
  s.moveTo(0, 0); s.lineTo(w, 0); s.lineTo(w, h); s.lineTo(0, h); s.closePath()
  if (hole) { const p = new THREE.Path(); p.absarc(w / 2, h / 2, hole, 0, Math.PI * 2, true); s.holes.push(p) }
  return new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 48 })
}
const len = (p: number[], closed: boolean) => { let L = 0; for (let i = 2; i < p.length; i += 2) L += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); if (closed) L += Math.hypot(p[0] - p[p.length - 2], p[1] - p[p.length - 1]); return L }
const machine = { filament: 1.75, bed: [220, 220, 250] as [number, number, number], center: false, start: START_GCODE, end: END_GCODE, name: 'test' }

describe('slicer', () => {
  it('cuts a flat plate into six layers with walls at the right size', () => {
    const layers = slice(trisOf(plate(40, 20, 1.2)), { ...PRINT_DEFAULTS, infill: 1, skirt: false })
    expect(layers.length).toBe(6)
    const outer = layers[2].paths.filter((p) => p.kind === 'outer')
    expect(outer.length).toBe(1)
    // the outside wall runs half a line inside the edge
    const want = 2 * (40 - 0.45) + 2 * (20 - 0.45)
    expect(Math.abs(len(outer[0].pts, true) - want)).toBeLessThan(0.6)
    expect(layers[2].paths.filter((p) => p.kind === 'inner').length).toBe(1)
    expect(layers[2].paths.some((p) => p.kind === 'solid')).toBe(true)
  })
  it('keeps holes open', () => {
    const layers = slice(trisOf(plate(40, 40, 0.6, 8)), { ...PRINT_DEFAULTS, infill: 1, skirt: false })
    const outer = layers[1].paths.filter((p) => p.kind === 'outer')
    expect(outer.length).toBe(2)       // the edge and the hole
    const hp = outer.find((p) => len(p.pts, true) < 60)!.pts
    let mr = 0
    for (let k = 0; k < hp.length; k += 2) mr += Math.hypot(hp[k] - 20, hp[k + 1] - 20)
    // the wall runs half a line from the hole's edge
    expect(Math.abs(mr / (hp.length / 2) - 8.225)).toBeLessThan(0.03)
  })
  it('uses as much filament as the part holds', () => {
    const s = { ...PRINT_DEFAULTS, infill: 1, skirt: false }
    const layers = slice(trisOf(plate(30, 30, 1.2, 6)), s)
    const g = gcode(layers, s, machine)
    const volume = g.filament * Math.PI * (1.75 / 2) ** 2
    const part = (30 * 30 - Math.PI * 36) * 1.2
    expect(volume / part).toBeGreaterThan(0.9)
    expect(volume / part).toBeLessThan(1.08)
    expect(g.text).toContain('M109 S210')
    expect(g.text).toContain(';LAYER:5')
  })
  it('sparse infill inside a tall box, solid at the top and the bottom', () => {
    const box = new THREE.BoxGeometry(20, 20, 10)
    const layers: Layer[] = slice(trisOf(box), { ...PRINT_DEFAULTS, infill: 0.2, solidLayers: 3 })
    expect(layers.length).toBe(50)
    const kinds = (i: number) => new Set(layers[i].paths.map((p) => p.kind))
    expect(kinds(0).has('skirt')).toBe(true)
    expect(kinds(1).has('solid')).toBe(true)
    expect(kinds(25).has('infill')).toBe(true)
    expect(kinds(25).has('solid')).toBe(false)
    expect(kinds(49).has('top')).toBe(true)
    expect(kinds(48).has('solid')).toBe(true)
  })
  it('two shells that overlap join instead of cancelling out', () => {
    const a = trisOf(plate(20, 10, 0.4)), b = new THREE.ExtrudeGeometry((() => { const s = new THREE.Shape(); s.moveTo(10, 0); s.lineTo(30, 0); s.lineTo(30, 10); s.lineTo(10, 10); s.closePath(); return s })(), { depth: 0.4, bevelEnabled: false })
    const bt = new Float32Array(b.toNonIndexed().getAttribute('position').array)
    const all = new Float32Array(a.length + bt.length)
    all.set(a); all.set(bt, a.length)
    const layers = slice(all, { ...PRINT_DEFAULTS, infill: 1, skirt: false }, [[0, a.length / 9], [a.length / 9, bt.length / 9]])
    const outer = layers[0].paths.filter((p) => p.kind === 'outer')
    expect(outer.length).toBe(1)
    expect(Math.abs(len(outer[0].pts, true) - (2 * 29.55 + 2 * 9.55))).toBeLessThan(0.6)
  })
})

describe('supports and the start', () => {
  // a table: a thin top held up by one leg in a corner
  const table = () => {
    const leg = new THREE.BoxGeometry(4, 4, 10).translate(2, 2, 5)
    const top = new THREE.BoxGeometry(30, 30, 2).translate(15, 15, 11)
    const a = new Float32Array(leg.toNonIndexed().getAttribute('position').array), b = new Float32Array(top.toNonIndexed().getAttribute('position').array)
    const all = new Float32Array(a.length + b.length); all.set(a); all.set(b, a.length)
    return { all, shells: [[0, a.length / 9], [a.length / 9, b.length / 9]] as [number, number][] }
  }
  it('holds up the part that hangs in the air, with a layer of air under it', () => {
    const { all, shells } = table()
    const none = slice(all, { ...PRINT_DEFAULTS, skirt: false }, shells)
    expect(none.some((L) => L.paths.some((p) => p.kind === 'support'))).toBe(false)
    const sup = slice(all, { ...PRINT_DEFAULTS, skirt: false, support: 'bed' }, shells)
    const has = (i: number) => sup[i].paths.some((p) => p.kind === 'support' || p.kind === 'interface')
    expect(has(2)).toBe(true)
    expect(has(40)).toBe(true)
    // the layer right under the top (z 9.8 to 10) is air
    // the first layer of the top is the one ending at 10.2; the one under it is air
    const under = sup.findIndex((L) => L.z > 10 + 1e-6) - 1
    expect(has(under)).toBe(false)
    expect(has(under - 1)).toBe(true)
  })
  it('a prime line, the acceleration, and a cap on speed for the hot end', () => {
    const tris = trisOf(plate(20, 20, 0.4))
    const s = { ...PRINT_DEFAULTS, speed: 500, prime: true, skirt: false }
    const g = gcode(slice(tris, s), s, { ...machine, accel: 5000, maxFlow: 10 })
    expect(g.text).toContain('; prime line')
    expect(g.text).toContain('M204 S5000')
    const feeds = [...g.text.matchAll(/G1 X[\d.]+ Y[\d.]+ E[\d.]+ F(\d+)/g)].map((m) => Number(m[1]))
    // 10 mm3/s through a 0.45 x 0.2 line is about 111 mm/s
    expect(Math.max(...feeds)).toBeLessThanOrEqual(Math.ceil((10 / (0.45 * 0.2)) * 60) + 1)
  })
})

describe('advanced settings', () => {
  const kindsOf = (L: Layer[]) => new Set(L.flatMap((x) => x.paths.map((p) => p.kind)))
  const table = () => {
    const leg = new THREE.BoxGeometry(4, 4, 10).translate(2, 2, 5)
    const top = new THREE.BoxGeometry(30, 30, 2).translate(15, 15, 11)
    const a = new Float32Array(leg.toNonIndexed().getAttribute('position').array), b = new Float32Array(top.toNonIndexed().getAttribute('position').array)
    const all = new Float32Array(a.length + b.length); all.set(a); all.set(b, a.length)
    return { all, shells: [[0, a.length / 9], [a.length / 9, b.length / 9]] as [number, number][] }
  }
  it('tree supports grow branches under the top', () => {
    const { all, shells } = table()
    const L = slice(all, { ...PRINT_DEFAULTS, skirt: false, support: 'bed', supportType: 'tree' }, shells)
    const rings = L[5].paths.filter((p) => p.kind === 'support' && p.closed)
    expect(rings.length).toBeGreaterThan(0)
    expect(L.some((x) => x.paths.some((p) => p.kind === 'interface'))).toBe(true)
  })
  it('holds the whole roof of an arch and the low part of a ball, from the bed', () => {
    const sup = (L: Layer[]) => L.flatMap((x) => x.paths.filter((p) => p.kind === 'support' || p.kind === 'interface').flatMap((p) => { const o: [number, number, number][] = []; for (let k = 0; k < p.pts.length; k += 2) o.push([p.pts[k], p.pts[k + 1], x.z]); return o }))
    // two legs and a roof, 30 wide, roof from 8 to 10 high
    const parts = [new THREE.BoxGeometry(4, 10, 10).translate(2, 5, 5), new THREE.BoxGeometry(4, 10, 10).translate(28, 5, 5), new THREE.BoxGeometry(30, 10, 2).translate(15, 5, 9)]
    const all = new Float32Array(parts.reduce((n, g) => n + trisOf(g).length, 0))
    let o = 0
    for (const g of parts) { const n = g.toNonIndexed(); const a = n.getAttribute('position').array; all.set(a, o); o += a.length }
    const pts = sup(slice(all, { ...PRINT_DEFAULTS, skirt: false, support: 'bed' }))
    // under the roof, all the way across between the legs, and from low down
    const xs = pts.filter((q) => q[2] < 2).map((q) => q[0])
    expect(Math.min(...xs)).toBeLessThan(7)
    expect(Math.max(...xs)).toBeGreaterThan(23)
    expect(pts.some((q) => q[2] > 6 && Math.abs(q[0] - 15) < 3)).toBe(true)
    // a ball: support under the bottom, out to where the side gets steep
    const ball = trisOf(new THREE.SphereGeometry(10, 48, 32))
    const bp = sup(slice(ball, { ...PRINT_DEFAULTS, skirt: false, support: 'bed', supportAngle: 45 }))
    const far = Math.max(...bp.map((q) => Math.hypot(q[0] - 10, q[1] - 10)))
    expect(far).toBeGreaterThan(6)
  })
  it('critical only skips a gentle overhang but holds a part in the air', () => {
    // a cone that leans out steadily needs no support when only critical ones count
    const cone = new THREE.CylinderGeometry(15, 3, 4, 48).rotateX(Math.PI / 2)
    const t = trisOf(cone)
    const auto = slice(t, { ...PRINT_DEFAULTS, skirt: false, support: 'everywhere' })
    const crit = slice(t, { ...PRINT_DEFAULTS, skirt: false, support: 'everywhere', supportCritical: true })
    const any = (L: Layer[]) => L.some((x) => x.paths.some((p) => p.kind === 'support' || p.kind === 'interface'))
    expect(any(auto)).toBe(true)
    expect(any(crit)).toBe(false)
    const { all, shells } = table()
    expect(any(slice(all, { ...PRINT_DEFAULTS, skirt: false, support: 'bed', supportCritical: true }, shells))).toBe(true)
  })
  it('your own boxes: block takes support away, manual only supports inside a box', () => {
    const { all, shells } = table()
    const any = (L: Layer[]) => L.some((x) => x.paths.some((p) => p.kind === 'support' || p.kind === 'interface'))
    const blocked = slice(all, { ...PRINT_DEFAULTS, skirt: false, support: 'bed', supportBoxes: [{ id: 'b', kind: 'block', x: 15, y: 15, w: 40, d: 40, z0: 0, z1: 20 }] }, shells)
    expect(any(blocked)).toBe(false)
    const manual = slice(all, { ...PRINT_DEFAULTS, skirt: false, support: 'bed', supportManual: true, supportBoxes: [{ id: 'e', kind: 'enforce', x: 25, y: 25, w: 6, d: 6, z0: 0, z1: 20 }] }, shells)
    const pts = manual.flatMap((x) => x.paths.filter((p) => p.kind === 'support' || p.kind === 'interface').flatMap((p) => p.pts))
    expect(pts.length).toBeGreaterThan(0)
    for (let k = 0; k < pts.length; k += 2) expect(Math.abs(pts[k] - 25)).toBeLessThan(5)
  })
  it('brim, raft, ironing and other patterns', () => {
    const t = trisOf(plate(20, 20, 2))
    expect(kindsOf(slice(t, { ...PRINT_DEFAULTS, skirt: false, brim: 'outer', brimWidth: 3 })).has('brim')).toBe(true)
    const raft = slice(t, { ...PRINT_DEFAULTS, skirt: false, raftLayers: 3 })
    expect(raft[0].raft && raft[2].raft && !raft[3].raft).toBe(true)
    expect(raft[3].z).toBeGreaterThan(raft[2].z + 0.2)
    expect(kindsOf(slice(t, { ...PRINT_DEFAULTS, skirt: false, ironing: 'top' })).has('ironing')).toBe(true)
    const box = trisOf(new THREE.BoxGeometry(20, 20, 6))
    for (const pat of ['gyroid', 'grid', 'triangles', 'cubic', 'concentric'] as const) {
      const L = slice(box, { ...PRINT_DEFAULTS, skirt: false, infillPattern: pat })
      expect(L[15].paths.some((p) => p.kind === 'infill')).toBe(true)
    }
    const conc = slice(t, { ...PRINT_DEFAULTS, skirt: false, topPattern: 'concentric' })
    expect(conc[conc.length - 1].paths.some((p) => p.kind === 'top' && p.closed)).toBe(true)
  })
  it('contour compensation makes the part bigger', () => {
    const t = trisOf(plate(40, 20, 0.6))
    const L = slice(t, { ...PRINT_DEFAULTS, infill: 1, skirt: false, xyComp: 0.2 })
    const outer = L[1].paths.find((p) => p.kind === 'outer')!
    expect(len(outer.pts, true)).toBeGreaterThan(2 * (40 - 0.45) + 2 * (20 - 0.45) + 1)
  })
  it('vase mode: one wall rising in a spiral', () => {
    const cyl = trisOf(new THREE.CylinderGeometry(10, 10, 5, 48).rotateX(Math.PI / 2))
    const s = { ...PRINT_DEFAULTS, skirt: false, vase: true, solidLayers: 2 }
    const L = slice(cyl, s)
    expect(L[10].vase).toBe(true)
    expect(L[10].paths.length).toBe(1)
    expect(gcode(L, s, machine).text).toMatch(/G1 X[\d.]+ Y[\d.]+ Z[\d.]+ E/)
  })
})

describe('G-code settings and automation', () => {
  const t = () => trisOf(plate(20, 20, 2))
  it('the prime line works after any start G-code', () => {
    const s = { ...PRINT_DEFAULTS, prime: true, skirt: false }
    const g = gcode(slice(t(), s), s, { ...machine, start: 'PRINT_START' }).text
    const a = g.indexOf('PRINT_START'), b = g.indexOf('M83'), c = g.indexOf('; prime line')
    expect(a).toBeGreaterThan(0)
    expect(b).toBeGreaterThan(a)
    expect(c).toBeGreaterThan(b)
  })
  it('pressure advance, layer tracking and a robot that clears the bed', () => {
    const s = {
      ...PRINT_DEFAULTS, skirt: false, pressureAdvance: 0.04,
      automation: [{ id: 'r1', name: 'Arm takes the part', on: true, when: 'end' as const, steps: [{ kind: 'cool' as const, temp: 30 }, { kind: 'pin' as const, pin: 'arm', value: 1 }, { kind: 'waitSignal' as const, signal: 'osc:/arm/done' }] }],
    }
    const g = gcode(slice(t(), s), s, { ...machine, flavor: 'klipper', link: 'klipper' })
    expect(g.text).toContain('SET_PRESSURE_ADVANCE ADVANCE=0.04')
    expect(g.text).toContain('SET_PRINT_STATS_INFO CURRENT_LAYER=1')
    expect(g.text).toContain('TEMPERATURE_WAIT SENSOR=heater_bed MAXIMUM=30')
    expect(g.text).toContain('SET_PIN PIN=arm VALUE=1')
    expect(g.text).toContain(';RICO:WAIT 0')
    expect(g.events[0].layer).toBe(g.layers)
    const marlin = gcode(slice(t(), s), s, { ...machine, link: 'usb' }).text
    expect(marlin).toContain('M42 P')
    expect(marlin).toContain('M190 R30')
    expect(marlin.split(';RICO:WAIT 0')[1].split('\n')[1]).not.toBe('M0')
  })
  it('filament change at a height, a slower small layer, a fan that waits', () => {
    const s = { ...PRINT_DEFAULTS, skirt: false, pauseHeights: '1.0', minLayerTime: 60, fanOffLayers: 3 }
    const L = slice(t(), s)
    const g = gcode(L, s, machine)
    expect(g.text).toContain('M600')
    expect(g.seconds).toBeGreaterThan(50 * L.length)
    const fanAt = g.text.indexOf('M106'), layer3 = g.text.indexOf(';LAYER:3')
    expect(fanAt).toBeGreaterThan(layer3)
  })
})

describe('profiles from files', () => {
  it('reads a json profile from another slicer and an ini file', async () => {
    const { readProfile } = await import('./profiles')
    const j = readProfile(JSON.stringify({ name: 'My PLA 0.2', layer_height: '0.16', wall_loops: '3', sparse_infill_density: '15%', sparse_infill_pattern: 'gyroid', enable_support: '1', support_type: 'tree(auto)', support_on_build_plate_only: '1', support_threshold_angle: '30', nozzle_temperature: ['215'], machine_start_gcode: 'PRINT_START BED=[bed_temperature_initial_layer_single] EXTRUDER=[nozzle_temperature_initial_layer]', made_up_key: '3' }))
    if (typeof j === 'string') throw new Error(j)
    expect(j.name).toBe('My PLA 0.2')
    expect(j.settings).toMatchObject({ layer: 0.16, perimeters: 3, infill: 0.15, infillPattern: 'gyroid', support: 'bed', supportType: 'tree', supportAngle: 60, nozzleTemp: 215 })
    expect(j.printer.start).toBe('PRINT_START BED={bed} EXTRUDER={nozzle}')
    expect(j.skipped).toContain('made_up_key')
    const ini = readProfile('layer_height = 0.24\nperimeters = 4\nfill_density = 25%\nsupport_material = 0\nexternal_perimeters_first = 1\nretract_length = 0.6\ngcode_flavor = klipper\n', 'x.ini')
    if (typeof ini === 'string') throw new Error(ini)
    expect(ini.settings).toMatchObject({ layer: 0.24, perimeters: 4, infill: 0.25, support: 'none', wallOrder: 'outer-inner', retract: 0.6 })
    expect(ini.printer.flavor).toBe('klipper')
  })
})

describe('smarter overhangs', () => {
  it('finds a gentle slope that leans out past the threshold', () => {
    // a ramp that leans out 60 degrees from straight up, 20 mm wide
    const s = new THREE.Shape()
    const run = Math.tan((60 * Math.PI) / 180) * 8
    s.moveTo(0, 0); s.lineTo(6, 0); s.lineTo(6 + run, 8); s.lineTo(run, 8); s.closePath()
    const g = new THREE.ExtrudeGeometry(s, { depth: 20, bevelEnabled: false }).rotateX(Math.PI / 2)
    const t = trisOf(g)
    const L = slice(t, { ...PRINT_DEFAULTS, skirt: false, support: 'bed' })
    const n = L.filter((x) => x.paths.some((p) => p.kind === 'support' || p.kind === 'interface')).length
    expect(n).toBeGreaterThan(10)
    // and a 30 degree lean needs none
    const s2 = new THREE.Shape()
    const r2 = Math.tan((30 * Math.PI) / 180) * 8
    s2.moveTo(0, 0); s2.lineTo(6, 0); s2.lineTo(6 + r2, 8); s2.lineTo(r2, 8); s2.closePath()
    const L2 = slice(trisOf(new THREE.ExtrudeGeometry(s2, { depth: 20, bevelEnabled: false }).rotateX(Math.PI / 2)), { ...PRINT_DEFAULTS, skirt: false, support: 'bed' })
    expect(L2.some((x) => x.paths.some((p) => p.kind === 'support' || p.kind === 'interface'))).toBe(false)
  })
})
