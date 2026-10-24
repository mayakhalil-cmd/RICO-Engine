import { CHANGE_G, PAUSE_G, PRINT_DEFAULTS, type Flavor, type GcodeMachine, type Layer, type PathKind, type PrintSettings, type Rule, type Step } from './settings'

// Turns the sliced layers into G-code: speeds, accelerations and cooling for
// each kind of line, retraction, temperatures, the purge line, and your own
// G-code and automation steps at the moments you pick.

// A moment of the print where something happens (see automation.ts).
// layer: -1 is the start, the number of layers is the end.
export interface PrintEvent { index: number; layer: number; rule: string; name: string; steps: Step[] }

export interface Gcode { text: string; seconds: number; filament: number; grams: number; cost: number; lines: number; events: PrintEvent[]; layers: number }

const fmt = (v: number) => (Math.round(v * 1000) / 1000).toString()

// Which layers a rule happens at.
export function ruleLayers(r: Rule, layers: { z: number }[]): number[] {
  const n = layers.length
  switch (r.when) {
    case 'start': return [-1]
    case 'end': return [n]
    case 'layer': return layers.map((_, i) => i)
    case 'every': { const k = Math.max(1, Math.round(r.n ?? 10)); return layers.map((_, i) => i).filter((i) => i > 0 && i % k === 0) }
    case 'atLayer': { const k = Math.round(r.n ?? 1) - 1; return k >= 0 && k < n ? [k] : [] }
    case 'atHeight': { const k = layers.findIndex((L) => L.z >= (r.z ?? 0) - 1e-6); return k >= 0 ? [k] : [] }
  }
  return []
}

export function gcode(layers: Layer[], s0: PrintSettings, m: GcodeMachine & { link?: string }): Gcode {
  const s: PrintSettings = { ...PRINT_DEFAULTS, ...s0 }
  const flavor: Flavor = m.flavor ?? 'marlin'
  const out: string[] = []
  const area = Math.PI * (m.filament / 2) ** 2
  const dx = m.center ? -m.bed[0] / 2 : 0, dy = m.center ? -m.bed[1] / 2 : 0
  const zOff = m.zOffset ?? 0
  // shrink: the part is made bigger in X and Y by as much as it shrinks
  let cx = 0, cy = 0
  const sc = 1 + (s.shrink ?? 0) / 100
  if (sc !== 1) {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity
    for (const L of layers) for (const p of L.paths) for (let k = 0; k < p.pts.length; k += 2) { a = Math.min(a, p.pts[k]); c = Math.max(c, p.pts[k]); b = Math.min(b, p.pts[k + 1]); d = Math.max(d, p.pts[k + 1]) }
    cx = (a + c) / 2; cy = (b + d) / 2
  }
  const X = (x: number) => fmt(cx + (x - cx) * sc + dx), Y = (y: number) => fmt(cy + (y - cy) * sc + dy)
  const Z = (z: number) => fmt(z + zOff)
  const firstNozzle = s.firstNozzleTemp || s.nozzleTemp, firstBed = s.firstBedTemp || s.bedTemp
  const fill = (t: string, extra: Record<string, string | number> = {}) => {
    let o = t.replace(/\{bed\}/g, String(firstBed)).replace(/\{nozzle\}/g, String(firstNozzle)).replace(/\{width\}/g, String(m.bed[0])).replace(/\{depth\}/g, String(m.bed[1])).replace(/\{total\}/g, String(layers.length))
    for (const [k, v] of Object.entries(extra)) o = o.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
    return o
  }
  const rs = `F${Math.round(s.retractSpeed * 60)}`, ds = `F${Math.round((s.deretractSpeed || s.retractSpeed) * 60)}`
  const st = { x: 0, y: 0, z: 0, retracted: false, accel: 0, dirx: 0, diry: 0, used: 0, fan: 0 }
  let seconds = 0
  let o: string[] = out          // where lines go right now

  const setAccel = (a: number | undefined) => {
    const v = Math.round(a || m.accel || 0)
    if (!v || v === st.accel) return
    st.accel = v
    o.push(flavor === 'reprap' ? `M204 P${v} T${v}` : `M204 S${v}`)
  }
  const retract = (t: { s: number }) => {
    if (st.retracted || s.retract <= 0) return
    const w = s.wipe ?? 0
    if (w > 0 && (st.dirx || st.diry)) {
      // wipe back along the line while pulling back
      const nx = st.x - st.dirx * w, ny = st.y - st.diry * w
      o.push(`G1 X${X(nx)} Y${Y(ny)} E-${fmt(s.retract)} F${Math.round(Math.min(s.travel, 100) * 60)}`)
      t.s += w / Math.min(s.travel, 100)
      st.x = nx; st.y = ny
    } else {
      o.push(`G1 E-${fmt(s.retract)} ${rs}`)
      t.s += s.retract / s.retractSpeed
    }
    st.retracted = true
  }
  const unretract = (t: { s: number }) => {
    if (!st.retracted) return
    const e = s.retract + (s.retractExtra ?? 0)
    o.push(`G1 E${fmt(e)} ${ds}`)
    st.used += s.retractExtra ?? 0
    t.s += e / (s.deretractSpeed || s.retractSpeed)
    st.retracted = false
  }
  const travel = (tx: number, ty: number, t: { s: number }) => {
    const d = Math.hypot(tx - st.x, ty - st.y)
    if (d < 0.01) return
    const far = d > (s.retractMin ?? 1.5) && s.retract > 0
    if (far) retract(t)
    const hop = far && (s.zHop ?? 0) > 0
    if (hop) o.push(`G1 Z${Z(st.z + s.zHop!)} F1200`)
    setAccel(s.accelTravel)
    o.push(`G0 X${X(tx)} Y${Y(ty)} F${Math.round(s.travel * 60)}`)
    if (hop) o.push(`G1 Z${Z(st.z)} F1200`)
    t.s += d / s.travel
    st.x = tx; st.y = ty
  }

  const speedOf = (kind: PathKind, li: number): number => {
    let v: number
    switch (kind) {
      case 'outer': v = s.outerSpeed || s.wallSpeed; break
      case 'inner': v = s.wallSpeed; break
      case 'solid': v = s.solidSpeed || s.speed; break
      case 'top': v = s.topSpeed || s.solidSpeed || s.speed; break
      case 'support': v = s.supportSpeed || s.speed; break
      case 'interface': v = s.interfaceSpeed || s.supportSpeed || s.speed; break
      case 'ironing': v = s.ironSpeed || 20; break
      case 'skirt': case 'brim': v = s.skirtSpeed || s.firstSpeed; break
      default: v = s.speed
    }
    if (li === 0) return kind === 'ironing' ? v : (kind === 'infill' || kind === 'solid' || kind === 'top' || kind === 'raft' ? s.firstInfillSpeed || s.firstSpeed : (kind === 'skirt' || kind === 'brim' ? s.skirtSpeed || s.firstSpeed : s.firstSpeed))
    const slow = s.slowLayers ?? 0
    if (li < slow) v = s.firstSpeed + ((v - s.firstSpeed) * li) / slow
    return v
  }
  const accelOf = (kind: PathKind, li: number) => {
    if (li === 0 && s.accelFirst) return s.accelFirst
    if (kind === 'outer') return s.accelOuter
    if (kind === 'inner') return s.accelInner
    if (kind === 'top' || kind === 'ironing') return s.accelTop
    if (kind === 'infill' || kind === 'solid' || kind === 'support' || kind === 'interface') return s.accelInfill
    return undefined
  }
  const maxFlow = Math.min(m.maxFlow || Infinity, s.filamentMaxFlow || Infinity)

  // One layer's lines. factor < 1 slows it down (so a small layer has time to cool).
  const emitLayer = (L: Layer, li: number, factor: number, prevZ: number): number => {
    const t = { s: 0 }
    const h = L.h
    for (const p of L.paths) {
      const w = p.w ?? s.lineWidth
      const perMm = (((w - h) * h + Math.PI * (h / 2) ** 2) / area) * s.flow * (p.flow ?? 1)
      let v = speedOf(p.kind, li) * factor
      if (factor < 1) v = Math.max(Math.min(s.minSpeed ?? 10, speedOf(p.kind, li)), v)
      // never faster than the hot end can melt the plastic
      if (maxFlow < Infinity && p.kind !== 'ironing') v = Math.min(v, maxFlow / Math.max(0.01, w * h))
      const f = `F${Math.round(v * 60)}`
      travel(p.pts[0], p.pts[1], t)
      setAccel(accelOf(p.kind, li))
      unretract(t)
      o.push(`;TYPE:${p.kind}`)
      let first = true
      const n = p.pts.length / 2
      const total = L.vase ? (() => { let s2 = 0; for (let k = 1; k <= n; k++) { const i = (k % n) * 2, j = ((k - 1) % n) * 2; s2 += Math.hypot(p.pts[i] - p.pts[j], p.pts[i + 1] - p.pts[j + 1]) } return s2 })() : 0
      let run = 0
      for (let k = 1; k <= (p.closed ? n : n - 1); k++) {
        const i = (k % n) * 2
        const nx = p.pts[i], ny = p.pts[i + 1]
        const d = Math.hypot(nx - st.x, ny - st.y)
        if (d < 1e-4) continue
        const e = d * perMm
        st.used += e
        t.s += d / v
        st.dirx = (nx - st.x) / d; st.diry = (ny - st.y) / d
        if (L.vase) {
          // one wall going up in a spiral: the height rises along the loop
          run += d
          const zz = prevZ + (L.z - prevZ) * Math.min(1, run / Math.max(1e-6, total))
          o.push(`G1 X${X(nx)} Y${Y(ny)} Z${Z(zz)} E${e.toFixed(5)}${first ? ` ${f}` : ''}`)
          st.z = zz
        } else o.push(`G1 X${X(nx)} Y${Y(ny)} E${e.toFixed(5)}${first ? ` ${f}` : ''}`)
        first = false
        st.x = nx; st.y = ny
      }
    }
    return t.s
  }

  // ---- automation and pauses ----
  const events: PrintEvent[] = []
  const at = new Map<number, PrintEvent[]>()
  const addEvent = (layer: number, rule: string, name: string, steps: Step[]) => {
    const e: PrintEvent = { index: events.length, layer, rule, name, steps }
    events.push(e)
    at.set(layer, [...(at.get(layer) ?? []), e])
  }
  for (const r of s.automation ?? []) if (r.on && r.steps.length) for (const li of ruleLayers(r, layers)) addEvent(li, r.id, r.name, r.steps)
  for (const hz of (s.pauseHeights ?? '').split(/[,; ]+/).map(Number).filter((v) => v > 0)) {
    const li = layers.findIndex((L) => L.z >= hz - 1e-6)
    if (li > 0) addEvent(li, 'pause-height', `Filament change at ${hz} mm`, [{ kind: 'filament' }])
  }
  const pauseG = m.pauseG || PAUSE_G[flavor], changeG = m.changeG || CHANGE_G[flavor]
  const stepLines = (e: PrintEvent, li: number) => {
    const t = { s: 0 }
    let parked: { x: number; y: number; z: number } | null = null
    o.push(`; ${e.name}`)
    for (const step of e.steps) {
      switch (step.kind) {
        case 'gcode': if (step.text) o.push(fill(step.text, { layer: li + 1, layer_num: li, z: fmt(layers[li]?.z ?? 0) })); break
        case 'pause': o.push('M400', ...(step.text ? [`; ${step.text}`] : []), pauseG); break
        case 'filament': o.push('M400', changeG); break
        case 'park':
          if (!parked) parked = { x: st.x, y: st.y, z: st.z }
          retract(t)
          o.push('G91', `G1 Z${fmt(step.lift ?? 10)} F600`, 'G90', `G0 X${X(step.x ?? 0)} Y${Y(step.y ?? m.bed[1])} F${Math.round(s.travel * 60)}`)
          st.z += step.lift ?? 10
          break
        case 'dwell': o.push('M400', `G4 S${Math.max(0, Math.round(step.seconds ?? 1))}`); break
        case 'home': o.push('G28 X Y'); break
        case 'pin': {
          const v = Math.max(0, Math.min(1, step.value ?? 1))
          o.push('M400', flavor === 'klipper' ? `SET_PIN PIN=${step.pin || 'robot'} VALUE=${fmt(v)}` : flavor === 'reprap' ? `M42 P${step.pin || '0'} S${fmt(v)}` : `M42 P${step.pin || '0'} S${Math.round(v * 255)}`)
          break
        }
        case 'waitPin':
          o.push('M400')
          if (flavor === 'marlin') o.push(`M226 P${step.pin || '0'} S${Math.round(step.value ?? 1)} ; wait for the pin`)
          else o.push(`; wait for ${step.pin || 'the robot'}: go on (resume) from the machine`, pauseG)
          break
        case 'cool': {
          const tc = Math.round(step.temp ?? 35)
          o.push('M400', 'M140 S0', flavor === 'klipper' ? `TEMPERATURE_WAIT SENSOR=heater_bed MAXIMUM=${tc}` : `M190 R${tc}`)
          break
        }
        case 'signal': o.push('M400', `;RICO:EVENT ${e.index}`); break
        case 'waitSignal': o.push('M400', `;RICO:WAIT ${e.index}`); if (m.link !== 'usb') o.push(pauseG); break
      }
    }
    if (parked) {
      // back to where it was
      o.push(`G0 X${X(parked.x)} Y${Y(parked.y)} F${Math.round(s.travel * 60)}`, `G1 Z${Z(parked.z)} F600`)
      st.x = parked.x; st.y = parked.y; st.z = parked.z
    }
    seconds += t.s
  }

  // ---- the start ----
  out.push('; made with RICO', `; printer: ${m.name}`, `; layer height: ${s.layer}`, `; nozzle temperature: ${s.nozzleTemp}`, `; bed temperature: ${s.bedTemp}`)
  const head = out.length
  out.push(fill(m.start))
  // some start macros leave the extruder counting from zero in absolute mode: make sure
  out.push('G90', 'M83 ; extruder moves are relative', 'G92 E0')
  if (flavor === 'klipper') out.push(`SET_PRINT_STATS_INFO TOTAL_LAYER=${layers.length}`)
  if (s.pressureAdvance) out.push(flavor === 'klipper' ? `SET_PRESSURE_ADVANCE ADVANCE=${fmt(s.pressureAdvance)}` : flavor === 'reprap' ? `M572 D0 S${fmt(s.pressureAdvance)}` : `M900 K${fmt(s.pressureAdvance)}`)
  if (s.cornerSpeed) out.push(flavor === 'klipper' ? `SET_VELOCITY_LIMIT SQUARE_CORNER_VELOCITY=${fmt(s.cornerSpeed)}` : flavor === 'reprap' ? `M566 X${Math.round(s.cornerSpeed * 60)} Y${Math.round(s.cornerSpeed * 60)}` : `M205 X${fmt(s.cornerSpeed)} Y${fmt(s.cornerSpeed)}`)
  if (m.accel) { st.accel = Math.round(m.accel); out.push(flavor === 'reprap' ? `M204 P${st.accel} T${st.accel}` : `M204 S${st.accel} ; acceleration`) }
  st.z = 2
  for (const e of at.get(-1) ?? []) stepLines(e, -1)

  if (s.prime) {
    // the purge line: a thick line along the edge of the bed, there and back,
    // a little more plastic at the start to fill the nozzle, then a wipe
    const [bw, bd] = m.bed
    let a: [number, number], dir: [number, number], side: [number, number], len = Math.max(20, s.primeLength ?? 100)
    if (m.center) {
      const R = Math.min(bw, bd) / 2, yy = bd * 0.14
      const half = Math.sqrt(Math.max(0, R * R - (R - yy) ** 2)) - 8
      len = Math.min(len, half * 2)
      a = [bw / 2 - len / 2, yy]; dir = [1, 0]; side = [0, 0.7]
    } else if (s.primeWhere === 'front') {
      len = Math.min(len, bw - 20)
      a = [10, 3]; dir = [1, 0]; side = [0, 0.7]
    } else {
      len = Math.min(len, bd - 20)
      a = [3, 10]; dir = [0, 1]; side = [0.7, 0]
    }
    const amt = Math.max(0.5, s.primeAmount ?? 1)
    const pw = 0.8 * amt, ph = 0.3
    const perMm = ((pw - ph) * ph + Math.PI * (ph / 2) ** 2) / area
    const pt = (d: number, sd = 0) => [a[0] + dir[0] * d + side[0] * sd, a[1] + dir[1] * d + side[1] * sd] as [number, number]
    const P = (q: [number, number]) => `X${X(q[0])} Y${Y(q[1])}`
    const e1 = 10 * perMm + 1.5, e2 = (len - 10) * perMm, e3 = len * perMm
    out.push('; prime line', `G0 Z${Z(5)} F600`, `G0 ${P(pt(0))} F6000`, `G1 Z${Z(ph)} F600`,
      `G1 ${P(pt(10))} E${e1.toFixed(4)} F900`, `G1 ${P(pt(len))} E${e2.toFixed(4)} F1500`, `G1 ${P(pt(len, 1))} F1500`, `G1 ${P(pt(0, 1))} E${(e3 * 0.8).toFixed(4)} F1500`,
      `G1 E-${fmt(s.retract)} ${rs}`, `G1 ${P(pt(-5, 1))} F3000 ; wipe`, `G0 Z${Z(1)} F600`)
    st.used += e1 + e2 + e3 * 0.8
    seconds += 10 / 15 + (len - 10) / 25 + len / 25
    const q = pt(-5, 1)
    st.x = q[0]; st.y = q[1]; st.z = 1; st.retracted = s.retract > 0
  }

  // ---- the layers ----
  const fanMax = s.fan, fanNormal = Math.min(s.fanMin ?? s.fan, s.fan)
  let prevZ = 0
  let tempsSet = false
  layers.forEach((L, li) => {
    out.push(`;LAYER:${li}`, `;Z:${fmt(L.z)}`)
    if (m.beforeLayer) out.push(fill(m.beforeLayer, { layer: li + 1, layer_num: li, z: fmt(L.z), layer_z: fmt(L.z) }))
    o = out
    const t0 = { s: 0 }
    if (s.retractLayer && li > 0) retract(t0)
    if (!L.vase) { out.push(`G1 Z${Z(L.z)} F600`); st.z = L.z }
    if (flavor === 'klipper') out.push(`SET_PRINT_STATS_INFO CURRENT_LAYER=${li + 1}`)
    if (m.afterLayer) out.push(fill(m.afterLayer, { layer: li + 1, layer_num: li, z: fmt(L.z), layer_z: fmt(L.z) }))
    if (li >= 1 && !tempsSet) {
      tempsSet = true
      if (s.nozzleTemp !== firstNozzle) out.push(`M104 S${s.nozzleTemp}`)
      if (s.bedTemp !== firstBed) out.push(`M140 S${s.bedTemp}`)
    }
    for (const e of at.get(li) ?? []) stepLines(e, li)
    // a dry run first, to see how long the layer takes
    const snap = { ...st }
    const tmp: string[] = []
    o = tmp
    let time = emitLayer(L, li, 1, prevZ)
    const minT = s.minLayerTime ?? 0
    if (minT > 0 && time > 0 && time < minT && li > 0) {
      Object.assign(st, snap)
      tmp.length = 0
      time = emitLayer(L, li, time / minT, prevZ)
    }
    o = out
    // the fan, for how long this layer takes
    let fan = li < (s.fanOffLayers ?? 1) ? 0 : (s.fanBelowTime && time < s.fanBelowTime ? fanMax : fanNormal)
    const fullAt = s.fanFullLayer ?? 0, offN = s.fanOffLayers ?? 1
    if (fan > 0 && fullAt > offN && li < fullAt) fan *= (li - offN + 1) / (fullAt - offN + 1)
    const fv = Math.round(fan * 255)
    if (fv !== st.fan) { out.push(fv > 0 ? `M106 S${fv}` : 'M107'); st.fan = fv }
    for (const line of tmp) out.push(line)
    seconds += time + t0.s
    prevZ = L.z
  })

  // ---- the end ----
  for (const e of at.get(layers.length) ?? []) stepLines(e, layers.length)
  out.push(fill(m.end))
  seconds *= 1.15   // speeding up and slowing down at corners
  const grams = (st.used * area * (s.density ?? 1.24)) / 1000
  const cost = (grams / 1000) * (s.cost ?? 0)
  out.splice(head, 0, `; estimated time: ${Math.round(seconds / 60)} min`, `; filament used: ${(st.used / 1000).toFixed(2)} m, ${grams.toFixed(1)} g`)
  const text = out.join('\n') + '\n'
  return { text, seconds, filament: st.used, grams, cost, lines: out.length, events, layers: layers.length }
}
