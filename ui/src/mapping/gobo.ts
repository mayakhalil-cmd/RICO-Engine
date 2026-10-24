import { clipLayers, maskLayers, outline, surfacesInOrder, type Mask, type OutputMap, type P2 } from './model'

// Printable gobos (light shields) from a mapping. The light that should pass
// is every surface, minus the masks; everything else is blocked by a plate
// that sits in front of the projector lens, on a hood that slips over the
// lens barrel. That blocks the grey border and the light leaks of budget
// projectors around your surfaces.
//
// A plate near the lens can not cut a sharp line: each point of the picture
// leaves the whole lens, so the shadow edge is soft. The further the plate is
// from the lens, the sharper the edge (see softEdge()).

export interface GoboOptions {
  throwRatio: number      // distance / picture width (from the projector's manual)
  distance: number        // mm from the lens front to the plate
  lensDiameter: number    // mm, the outside of the lens barrel (the hood slips over it)
  aperture: number        // mm, the glass the light comes out of
  offset: number          // % lens shift: 0 picture centered on the lens, 100 picture bottom on the lens axis
  margin: number          // mm, openings grow by this much so the picture is not clipped
  thickness: number       // mm, plate and walls
  sleeve: number          // mm, how far the hood slides over the lens
  fit: number             // mm, extra room around the lens barrel
  border: number          // mm of plate around the openings
  aspect: number          // picture width / height
  // print settings
  style: GoboStyle        // flat plate, plate on legs, or a closed hood
  plateThickness: number  // mm
  corner: number          // mm, rounded plate corners
  holes: 0 | 2 | 4        // screw or tape holes in the border
  holeDia: number         // mm
  strut: number           // mm, legs (style "legs")
  layout: 'mapping' | 'pick'   // the whole mapping, or shapes you place on the plate
  picks: string[]         // surface and mask ids on the plate (layout "pick")
  offsets: Record<string, [number, number]>   // mm, where each picked shape sits on the plate
  mount?: string          // the lens preset it started from (MOUNTS)
  maskScale?: number      // % size of every opening on the plate (100: exactly as projected)
  feet?: number           // mm, square pads of the feet (older style "feet")
  round?: boolean         // a round plate (always for a gobo on the lens)
  body?: 'cone' | 'legs'  // between the sleeve and the plate: closed walls, or four legs
  ribs?: boolean          // small ribs in the sleeve that press on the lens, for a snug fit
  grow?: boolean          // grow the openings by the lens glass, so the picture is never clipped (softer shape)
}
// over: a sleeve over a lens that sticks out. into: a sleeve into a lens set
// into the case. flat: only the plate. (legs, hood, feet, plug: older parts.)
export type GoboStyle = 'flat' | 'over' | 'into' | 'legs' | 'hood' | 'feet' | 'plug'
export const GOBO_STYLES: { id: GoboStyle; name: string; about: string }[] = [
  { id: 'over', name: 'Over the lens', about: 'A round plate on a sleeve that slides over a lens that sticks out. Snug, no screws or glue.' },
  { id: 'into', name: 'Into the lens hole', about: 'A round plate on a sleeve that slides into the hole when the lens is set into the case.' },
  { id: 'flat', name: 'Plate only', about: 'Only the plate. Hold it in front of the lens with a stand, a clamp or tape.' },
]
const OLD_STYLE: Record<string, Partial<GoboOptions>> = { legs: { style: 'over', body: 'legs' }, hood: { style: 'over', body: 'cone' }, feet: { style: 'into', body: 'legs' }, plug: { style: 'into', body: 'legs' } }

// Ready fits for most projectors. Measure your lens with a ruler or a caliper
// and change the numbers after, if it is loose or too tight.
export interface Mount { id: string; name: string; about: string; part: Partial<GoboOptions> }
export const MOUNTS: Mount[] = [
  { id: 'out-s', name: 'Lens sticks out, small', about: 'Barrel about 40 mm. Small and pocket projectors.', part: { style: 'over', lensDiameter: 40, sleeve: 10, fit: 0.15 } },
  { id: 'out-m', name: 'Lens sticks out, medium', about: 'Barrel about 55 mm. Most home and office projectors.', part: { style: 'over', lensDiameter: 55, sleeve: 12, fit: 0.15 } },
  { id: 'out-l', name: 'Lens sticks out, large', about: 'Barrel about 70 mm. Bright installation projectors.', part: { style: 'over', lensDiameter: 70, sleeve: 14, fit: 0.2 } },
  { id: 'out-xl', name: 'Lens sticks out, venue', about: 'Barrel 90 mm and more.', part: { style: 'over', lensDiameter: 95, sleeve: 16, fit: 0.25 } },
  { id: 'in-s', name: 'Lens set in, small hole', about: 'The lens sits inside the case, in a hole about 45 mm across.', part: { style: 'into', lensDiameter: 45, sleeve: 6, fit: 0.15 } },
  { id: 'in-m', name: 'Lens set in, medium hole', about: 'A hole about 60 mm across. Many home projectors.', part: { style: 'into', lensDiameter: 60, sleeve: 7, fit: 0.15 } },
  { id: 'in-l', name: 'Lens set in, large hole', about: 'A hole about 80 mm across.', part: { style: 'into', lensDiameter: 80, sleeve: 8, fit: 0.2 } },
  { id: 'free', name: 'Plate only', about: 'Held by a stand, a clamp or tape. The least filament.', part: { style: 'flat' } },
]
export const FITS: { id: string; name: string; fit: number; about: string }[] = [
  { id: 'tight', name: 'Tight', fit: 0.05, about: 'Presses on. Best with the ribs off.' },
  { id: 'snug', name: 'Snug', fit: 0.15, about: 'Slides on with a little push and stays.' },
  { id: 'easy', name: 'Easy', fit: 0.35, about: 'Slides on easily. Turn the ribs on so it holds.' },
]

// How wide the picture is for the distance (the throw ratio), by kind of lens.
export const THROWS: { id: string; name: string; about: string; part: Partial<GoboOptions> }[] = [
  { id: 'standard', name: 'Standard throw', about: 'About 1.2 to 1.5. Most projectors.', part: { throwRatio: 1.35, aperture: 25 } },
  { id: 'short', name: 'Short throw', about: 'About 0.5 to 0.8. A big picture from close by.', part: { throwRatio: 0.6, aperture: 30 } },
  { id: 'long', name: 'Long throw', about: 'About 2 and more. Venue lenses.', part: { throwRatio: 2.2, aperture: 45 } },
]

export const GOBO_DEFAULTS: GoboOptions = {
  throwRatio: 1.2, distance: 120, lensDiameter: 60, aperture: 25, offset: 0, margin: 0.5, thickness: 1.6, sleeve: 12, fit: 0.15, border: 6, aspect: 16 / 9,
  style: 'flat', plateThickness: 1.2, corner: 3, holes: 2, holeDia: 3.4, strut: 4, layout: 'mapping', picks: [], offsets: {},
  mount: 'free', maskScale: 100, feet: 12, round: true, body: 'cone', ribs: true, grow: false,
}
export function goboOptions(part?: Partial<GoboOptions>): GoboOptions {
  const o = { ...GOBO_DEFAULTS, ...part, offsets: { ...(part?.offsets ?? {}) }, picks: [...(part?.picks ?? [])] }
  return { ...o, ...(OLD_STYLE[o.style] ?? {}) }
}
const onLens = (o: GoboOptions) => o.style === 'over' || o.style === 'into'
const isRound = (o: GoboOptions) => onLens(o) || o.round !== false

// How soft the shadow edge is, as a part of the picture width.
export function softEdge(o: GoboOptions) {
  const width = o.distance / o.throwRatio
  return Math.min(1, o.aperture / Math.max(1, width))
}

// ---- which parts of the picture get light ----

const GW = 800
export function lightGrid(map: OutputMap, aspect: number, pad = 0, shapes: P2[][] = []): { w: number; h: number; on: Uint8Array } {
  const iw = GW, ih = Math.max(8, Math.round(GW / aspect))
  const w = iw + pad * 2, h = ih + pad * 2
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const g = c.getContext('2d')!
  g.fillStyle = '#000'
  g.fillRect(0, 0, w, h)
  g.translate(pad, pad)
  const poly = (pts: P2[]) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x * iw, y * ih) : g.moveTo(x * iw, y * ih))); g.closePath() }
  // the same stack as the projection: a mask darkens what is under it
  const layers = maskLayers(map)
  const mask = (m: Mask) => {
    if (!m.on || m.points.length < 3) return
    g.fillStyle = '#000'
    if (m.invert) { g.beginPath(); g.rect(-w, -h, w * 3, h * 3); m.points.forEach(([x, y], i) => (i ? g.lineTo(x * iw, y * ih) : g.moveTo(x * iw, y * ih))); g.closePath(); g.fill('evenodd') }
    else { poly(m.points); g.fill() }
  }
  const clips = clipLayers(map)
  for (const s of surfacesInOrder(map)) {
    if (s.on) {
      const cl = (clips.get(s.id) ?? []).filter((m) => m.on && m.points.length >= 3)
      if (!cl.length) { g.fillStyle = '#fff'; poly(outline(s)); g.fill() }
      else {
        // clipped masks darken only this surface: draw it on its own first
        const one = document.createElement('canvas'); one.width = w; one.height = h
        const o2 = one.getContext('2d')!
        o2.translate(pad, pad)
        o2.fillStyle = '#fff'
        o2.beginPath(); outline(s).forEach(([x, y], i) => (i ? o2.lineTo(x * iw, y * ih) : o2.moveTo(x * iw, y * ih))); o2.closePath(); o2.fill()
        o2.globalCompositeOperation = 'destination-out'
        for (const m of cl) {
          o2.beginPath()
          if (m.invert) { o2.rect(-w, -h, w * 3, h * 3) }
          m.points.forEach(([x, y], i) => (i ? o2.lineTo(x * iw, y * ih) : o2.moveTo(x * iw, y * ih)))
          if (m.invert) { o2.closePath(); o2.fill('evenodd') } else { o2.closePath(); o2.fill() }
        }
        g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(one, 0, 0); g.restore()
      }
    }
    for (const m of layers.get(s.id) ?? []) mask(m)
  }
  // Extra light shapes (a stencil made from a picture).
  g.fillStyle = '#fff'
  for (const sh of shapes) if (sh.length >= 3) { poly(sh); g.fill() }
  const d = g.getImageData(0, 0, w, h).data
  const on = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) on[i] = d[i * 4] > 127 ? 1 : 0
  return { w, h, on }
}

// Grows the light area by r cells: a chamfer distance transform (two passes),
// fast even for big growths.
function dilate(on: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return on
  const INF = 1e9
  const d = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) d[i] = on[i] ? 0 : INF
  const a = 1, b = Math.SQRT2
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x
    let v = d[i]
    if (x > 0) v = Math.min(v, d[i - 1] + a)
    if (y > 0) {
      v = Math.min(v, d[i - w] + a)
      if (x > 0) v = Math.min(v, d[i - w - 1] + b)
      if (x < w - 1) v = Math.min(v, d[i - w + 1] + b)
    }
    d[i] = v
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x
    let v = d[i]
    if (x < w - 1) v = Math.min(v, d[i + 1] + a)
    if (y < h - 1) {
      v = Math.min(v, d[i + w] + a)
      if (x < w - 1) v = Math.min(v, d[i + w + 1] + b)
      if (x > 0) v = Math.min(v, d[i + w - 1] + b)
    }
    d[i] = v
  }
  const out = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) out[i] = d[i] <= r ? 1 : 0
  return out
}

// Outer outlines of every lit area (Moore neighbour tracing), simplified.
export function contours(on: Uint8Array, w: number, h: number): P2[][] {
  const seen = new Uint8Array(w * h)
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < w && y < h ? on[y * w + x] : 0)
  const out: P2[][] = []
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!on[y * w + x] || seen[y * w + x]) continue
    // Mark the whole area so it is traced once.
    const stack = [y * w + x]
    seen[y * w + x] = 1
    let count = 0
    while (stack.length) {
      const i = stack.pop()!
      count++
      const cx = i % w, cy = (i - cx) / w
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = cx + dx, Y = cy + dy
        if (X >= 0 && Y >= 0 && X < w && Y < h && on[Y * w + X] && !seen[Y * w + X]) { seen[Y * w + X] = 1; stack.push(Y * w + X) }
      }
    }
    if (count < 6) continue
    // (x, y) is the top-left cell of this area: trace its edge clockwise.
    const pts: P2[] = []
    let px = x, py = y, back = 4    // came from the left
    const sx = x, sy = y
    let guard = 0
    do {
      pts.push([px + 0.5, py + 0.5])
      let found = false
      for (let k = 1; k <= 8; k++) {
        const d = (back + k) % 8
        const nx = px + dirs[d][0], ny = py + dirs[d][1]
        if (at(nx, ny)) { back = (d + 4) % 8; px = nx; py = ny; found = true; break }
      }
      if (!found) break
    } while ((px !== sx || py !== sy) && ++guard < w * h * 4)
    out.push(simplify(pts, 0.8))
  }
  return out
}

function simplify(pts: P2[], tol: number): P2[] {
  if (pts.length < 4) return pts
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack: [number, number][] = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    const [ax, ay] = pts[a], [bx, by] = pts[b]
    const len = Math.hypot(bx - ax, by - ay) || 1
    let best = -1, far = 0
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / len
      if (d > far) { far = d; best = i }
    }
    if (far > tol && best > 0) { keep[best] = 1; stack.push([a, best], [best, b]) }
  }
  return pts.filter((_, i) => keep[i])
}

// ---- the plate, in millimetres ----

export interface GoboPlan {
  openings: P2[][]        // mm, x right, y up, 0 = lens axis
  plate: [number, number, number, number]   // x0, y0, x1, y1 mm
  pictureW: number        // picture width at the plate, mm
  pictureH: number
  soft: number            // soft edge as a part of the picture width
  items: GoboItem[]       // the openings by shape
  holes: P2[]             // centers of the mounting holes, mm
  round?: number          // a round plate: its radius, around the lens axis
  reach?: number          // the farthest opening from the lens axis, mm
}

export interface GoboItem { id: string; name: string; openings: P2[][] }

// The light that one shape lets through, as openings in mm (not yet moved).
function openingsOf(map: OutputMap, o: GoboOptions, shapes: P2[][]): P2[][] {
  const pictureW = o.distance / o.throwRatio
  const pictureH = pictureW / o.aspect
  // The light leaving the lens is as wide as the aperture: grow the openings
  // by half of it, plus the margin, so the picture itself is never cut.
  const mmPerCell = pictureW / GW
  // Exact: the openings are your shapes, nothing added (a hair, so a thin
  // line still prints). Grow: plus the extra room and half the lens glass, so
  // the picture is never cut (but the shape gets rounder).
  const r = (o.grow ? o.margin + o.aperture / 2 : 0.05) / mmPerCell
  const pad = Math.ceil(r) + 2
  const grid = lightGrid(map, o.aspect, pad, shapes)
  const iw = grid.w - pad * 2, ih = grid.h - pad * 2
  const grown = dilate(grid.on, grid.w, grid.h, r)
  const shift = (o.offset / 100) * (pictureH / 2)
  return contours(grown, grid.w, grid.h).map((c) => c.map(([x, y]) => [((x - pad) / iw - 0.5) * pictureW, (0.5 - (y - pad) / ih) * pictureH + shift] as P2))
}

// The shapes you can put on a plate one by one: surfaces and masks.
export function goboChoices(map: OutputMap): { id: string; name: string; kind: 'surface' | 'mask' }[] {
  return [...map.surfaces.map((s) => ({ id: s.id, name: s.name, kind: 'surface' as const })), ...map.masks.map((m) => ({ id: m.id, name: m.name, kind: 'mask' as const }))]
}

export function plan(map: OutputMap, o: GoboOptions, shapes: P2[][] = []): GoboPlan {
  const items: GoboItem[] = []
  if (o.layout === 'pick' && !shapes.length) {
    // Each picked shape is cut on its own, then moved where you put it.
    const empty = { ...map, surfaces: [], masks: [] }
    for (const id of o.picks) {
      const s = map.surfaces.find((x) => x.id === id), m = map.masks.find((x) => x.id === id)
      if (!s && !m) continue
      const own = s ? openingsOf({ ...empty, surfaces: [{ ...s, on: true }] }, o, []) : openingsOf(empty, o, [m!.points])
      const [dx, dy] = o.offsets[id] ?? [0, 0]
      items.push({ id, name: (s ?? m)!.name, openings: own.map((c) => c.map(([x, y]) => [x + dx, y + dy] as P2)) })
    }
  } else {
    items.push({ id: 'all', name: shapes.length ? 'From the picture' : 'Your mapping', openings: openingsOf(shapes.length ? { ...map, surfaces: [], masks: [] } : map, o, shapes) })
  }
  return plateFor(o, items)
}

// The light of one gobo: either every mask on its own (each one an opening
// you can move and size), or the projection as you see it (surfaces minus
// masks). Shapes in "skip" are left out of this gobo.
export interface GoboPick { mode: 'masks' | 'projection'; skip: string[]; sizes: Record<string, number>; offsets: Record<string, [number, number]> }
export function goboShapes(map: OutputMap, mode: GoboPick['mode']): { id: string; name: string; kind: 'surface' | 'mask'; invert?: boolean }[] {
  const masks = map.masks.filter((m) => m.on && m.points.length >= 3).map((m) => ({ id: m.id, name: m.name, kind: 'mask' as const, invert: m.invert }))
  if (mode === 'masks') return masks
  return [...map.surfaces.filter((s) => s.on).map((s) => ({ id: s.id, name: s.name, kind: 'surface' as const })), ...masks]
}
export function planGobo(map: OutputMap, o: GoboOptions, g: GoboPick): GoboPlan {
  const items: GoboItem[] = []
  const empty = { ...map, surfaces: [], masks: [] }
  const keep = (id: string) => !g.skip.includes(id)
  const place = (id: string, list: P2[][]) => {
    const k = ((g.sizes[id] ?? 100) / 100) * ((o.maskScale ?? 100) / 100)
    const [dx, dy] = g.offsets[id] ?? [0, 0]
    // sizes grow from the middle of the shape, so it stays where it was
    let cx = 0, cy = 0, n = 0
    for (const c of list) for (const [x, y] of c) { cx += x; cy += y; n++ }
    if (n) { cx /= n; cy /= n }
    return list.map((c) => c.map(([x, y]) => [cx + (x - cx) * k + dx, cy + (y - cy) * k + dy] as P2))
  }
  if (g.mode === 'masks') {
    for (const m of map.masks) {
      if (!m.on || m.points.length < 3 || !keep(m.id)) continue
      items.push({ id: m.id, name: m.name, openings: place(m.id, openingsOf(empty, o, [m.points])) })
    }
  } else {
    const part = { ...map, surfaces: map.surfaces.filter((s) => keep(s.id)), masks: map.masks.filter((m) => keep(m.id)) }
    items.push({ id: 'all', name: 'The projection', openings: place('all', openingsOf(part, o, [])) })
  }
  return plateFor(o, items)
}

// Openings that overlap become one (a plate can not have two holes on top of
// each other). Done on a fine grid, only when two of them touch.
export function unionOpenings(list: P2[][]): P2[][] {
  const boxes = list.map((c) => { let a = Infinity, b = Infinity, x = -Infinity, y = -Infinity; for (const [px, py] of c) { a = Math.min(a, px); b = Math.min(b, py); x = Math.max(x, px); y = Math.max(y, py) } return [a, b, x, y] })
  let touch = false
  for (let i = 0; i < boxes.length && !touch; i++) for (let j = i + 1; j < boxes.length; j++) {
    const A = boxes[i], B = boxes[j]
    if (A[0] <= B[2] && B[0] <= A[2] && A[1] <= B[3] && B[1] <= A[3]) { touch = true; break }
  }
  if (!touch || typeof document === 'undefined') return list
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const b of boxes) { x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]) }
  const r = Math.max(0.05, Math.max(x1 - x0, y1 - y0) / 3000)
  const pad = 3
  const w = Math.ceil((x1 - x0) / r) + pad * 2, h = Math.ceil((y1 - y0) / r) + pad * 2
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const g = c.getContext('2d')!
  g.fillStyle = '#fff'
  for (const poly of list) {
    g.beginPath()
    poly.forEach(([x, y], i) => { const px = (x - x0) / r + pad, py = (y1 - y) / r + pad; if (i) g.lineTo(px, py); else g.moveTo(px, py) })
    g.closePath()
    g.fill()
  }
  const d = g.getImageData(0, 0, w, h).data
  const on = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) on[i] = d[i * 4] > 127 ? 1 : 0
  return contours(on, w, h).map((cn) => cn.map(([px, py]) => [x0 + (px - pad) * r, y1 - (py - pad) * r] as P2))
}

// The plate around a set of openings: border, holes, and room for the sleeve.
export function plateFor(o: GoboOptions, items: GoboItem[]): GoboPlan {
  const pictureW = o.distance / o.throwRatio
  const pictureH = pictureW / o.aspect
  const shift = (o.offset / 100) * (pictureH / 2)
  const openings = unionOpenings(items.flatMap((i) => i.openings))
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, reach = 0
  for (const c of openings) for (const [x, y] of c) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); reach = Math.max(reach, Math.hypot(x, y)) }
  if (!openings.length) { x0 = -pictureW / 2; x1 = pictureW / 2; y0 = -pictureH / 2 + shift; y1 = pictureH / 2 + shift }
  if (isRound(o)) {
    // a disc around the lens axis, past the farthest opening and the sleeve
    const sleeve = onLens(o) ? sleeveRadii(o).out + (o.style === 'into' ? 3 : 0) + o.thickness : 0
    const coneTop = Math.max(reach + 0.5, onLens(o) ? sleeveRadii(o).inn : 0) + o.thickness
    const R = Math.max(reach + o.border, coneTop + 1, sleeve + 1, 8) + (o.holes && !onLens(o) ? o.holeDia + 2 : 0)
    const plate: [number, number, number, number] = [-R, -R, R, R]
    return { openings, items, plate, pictureW, pictureH, soft: softEdge(o), holes: onLens(o) ? [] : holesOf(plate, o, true), round: R, reach }
  }
  // Room for the holes in the border.
  const border = o.border + (o.holes ? o.holeDia + 2 : 0)
  x0 -= border; x1 += border; y0 -= border; y1 += border
  return { openings, items, plate: [x0, y0, x1, y1], pictureW, pictureH, soft: softEdge(o), holes: holesOf([x0, y0, x1, y1], o), reach }
}

// The sleeve: over the lens (inside = the barrel plus the fit room) or into
// the hole (outside = the hole minus the fit room).
export function sleeveRadii(o: GoboOptions): { inn: number; out: number } {
  const t = Math.max(0.8, o.thickness)
  if (o.style === 'into') { const out = Math.max(4, o.lensDiameter / 2 - o.fit); return { inn: out - t, out } }
  const inn = o.lensDiameter / 2 + o.fit
  return { inn, out: inn + t }
}

function holesOf([x0, y0, x1, y1]: [number, number, number, number], o: GoboOptions, round = false): P2[] {
  if (!o.holes) return []
  if (round) {
    const R = (x1 - x0) / 2 - o.holeDia / 2 - 2
    return Array.from({ length: o.holes }, (_, i) => { const a = (i / o.holes) * Math.PI * 2; return [Math.cos(a) * R, Math.sin(a) * R] as P2 })
  }
  const m = o.border / 2 + o.holeDia / 2 + 1
  const cy = (y0 + y1) / 2
  return o.holes === 2 ? [[x0 + m, cy], [x1 - m, cy]] : [[x0 + m, y0 + m], [x1 - m, y0 + m], [x1 - m, y1 - m], [x0 + m, y1 - m]]
}

// For laser cutters and to check the shape: the plate as an SVG in mm.
export function svg(p: GoboPlan): string {
  const [x0, y0, x1, y1] = p.plate
  const w = x1 - x0, h = y1 - y0
  const path = (c: P2[]) => `M${c.map(([x, y]) => `${(x - x0).toFixed(2)},${(y1 - y).toFixed(2)}`).join('L')}Z`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w.toFixed(1)}mm" height="${h.toFixed(1)}mm" viewBox="0 0 ${w.toFixed(2)} ${h.toFixed(2)}">
<path d="${p.round ? `M0,${(h / 2).toFixed(2)}a${(w / 2).toFixed(2)},${(h / 2).toFixed(2)} 0 1,0 ${w.toFixed(2)},0a${(w / 2).toFixed(2)},${(h / 2).toFixed(2)} 0 1,0 ${(-w).toFixed(2)},0Z` : `M0,0H${w.toFixed(2)}V${h.toFixed(2)}H0Z`} ${p.openings.map(path).join(' ')}" fill="#000" fill-rule="evenodd" stroke="#f00" stroke-width="0.1"/>
${p.holes.map(([x, y]) => `<circle cx="${(x - x0).toFixed(2)}" cy="${(y1 - y).toFixed(2)}" r="1.7" fill="#fff" stroke="#f00" stroke-width="0.1"/>`).join('')}
<circle cx="${(-x0).toFixed(2)}" cy="${y1.toFixed(2)}" r="1" fill="#f00"/>
</svg>`
}

// The printable part as one geometry (mm, z towards the picture, 0 at the
// front of the lens). Each piece is its own group, so the slicer joins them.
//  - the plate (round or square) with its openings, at the far end
//  - "over": a sleeve that slides over the lens, with a lip that stops at the
//    front of the barrel; "into": a sleeve that slides into the hole, with a
//    flange that stops on the case
//  - between them: closed walls (a cone, blocks every stray ray) or four legs
//  - small ribs inside (or outside) the sleeve press on the lens for a snug fit
export async function goboGeometry(p: GoboPlan, o: GoboOptions): Promise<import('three').BufferGeometry> {
  const THREE = await import('three')
  const { mergeGeometries } = await import('three/addons/utils/BufferGeometryUtils.js')
  const parts: import('three').BufferGeometry[] = []
  const clean = (g: import('three').BufferGeometry) => {
    const n = g.index ? g.toNonIndexed() : g
    for (const k of Object.keys(n.attributes)) if (k !== 'position') n.deleteAttribute(k)
    return n
  }
  const t = Math.max(0.8, o.thickness)
  const pt = Math.max(0.4, o.plateThickness)
  const lens = onLens(o)
  const lipH = Math.max(1.2, t)
  // where the plate sits: at the length, but never inside the lip
  const L = lens ? Math.max(o.distance, lipH) : 0
  const [x0, y0, x1, y1] = p.plate
  // The plate.
  const plate = new THREE.Shape()
  if (p.round) plate.absarc(0, 0, p.round, 0, Math.PI * 2, false)
  else {
    const rc = Math.max(0, Math.min(o.corner, (x1 - x0) / 2 - 0.1, (y1 - y0) / 2 - 0.1))
    plate.moveTo(x0 + rc, y0)
    plate.lineTo(x1 - rc, y0); if (rc) plate.absarc(x1 - rc, y0 + rc, rc, -Math.PI / 2, 0, false)
    plate.lineTo(x1, y1 - rc); if (rc) plate.absarc(x1 - rc, y1 - rc, rc, 0, Math.PI / 2, false)
    plate.lineTo(x0 + rc, y1); if (rc) plate.absarc(x0 + rc, y1 - rc, rc, Math.PI / 2, Math.PI, false)
    plate.lineTo(x0, y0 + rc); if (rc) plate.absarc(x0 + rc, y0 + rc, rc, Math.PI, Math.PI * 1.5, false)
    plate.closePath()
  }
  for (const c of p.openings) {
    if (c.length < 3) continue
    const hole = new THREE.Path()
    c.forEach(([x, y], i) => (i ? hole.lineTo(x, y) : hole.moveTo(x, y)))
    hole.closePath()
    plate.holes.push(hole)
  }
  for (const [hx, hy] of p.holes) { const h = new THREE.Path(); h.absarc(hx, hy, o.holeDia / 2, 0, Math.PI * 2, true); plate.holes.push(h) }
  const front = new THREE.ExtrudeGeometry(plate, { depth: pt, bevelEnabled: false, curveSegments: 64 })
  front.translate(0, 0, L)
  parts.push(clean(front))
  if (lens) {
    const { inn, out } = sleeveRadii(o)
    const C = Math.max(3, o.sleeve)
    // the walls, as a profile (radius, height) turned around the lens axis
    const prof: [number, number][] = []
    const coneIn = Math.max(inn, (p.reach ?? 0) + 0.5)
    const cone = o.body !== 'legs' && L - lipH > 0.5
    if (o.style === 'over') {
      const lip = Math.min(2, Math.max(0.8, inn * 0.06))
      prof.push([inn, -C], [out, -C])
      if (cone) prof.push([out, lipH], [coneIn + t, L + 0.01], [coneIn, L + 0.01], [inn, lipH])
      else prof.push([out, lipH], [inn, lipH])
      prof.push([inn - lip, lipH], [inn - lip, 0], [inn, 0])
    } else {
      const flange = 3
      prof.push([inn, -C], [out, -C], [out, 0], [out + flange, 0], [out + flange, lipH])
      if (cone) prof.push([Math.max(coneIn + t, out + flange - 0.01), L + 0.01], [coneIn, L + 0.01])
      prof.push([inn, lipH])
    }
    prof.push(prof[0])
    const lathe = new THREE.LatheGeometry(prof.map(([r, z]) => new THREE.Vector2(r, z)), 128)
    lathe.rotateX(Math.PI / 2)
    parts.push(clean(lathe))
    if (!cone && L - lipH > 0.5) {
      // four legs from the top of the sleeve to the plate
      const w = Math.max(1.6, o.strut)
      const rTop = Math.max(coneIn + w / 2, out - w / 2)
      for (let k = 0; k < 4; k++) {
        const a = Math.PI / 4 + (k * Math.PI) / 2
        const rb = (o.style === 'into' ? out + 1.5 : out - t / 2)
        parts.push(beam(THREE, [Math.cos(a) * rb, Math.sin(a) * rb, lipH / 2], [Math.cos(a) * rTop, Math.sin(a) * rTop, L + pt / 2], w))
      }
    }
    if (o.ribs !== false) {
      // ribs that press on the lens: inside the sleeve over a lens, outside it into a hole
      const n = Math.max(6, Math.round((inn * 2 * Math.PI) / 20))
      const rh = 0.35, rw = 1.4
      for (let k = 0; k < n; k++) {
        const g = new THREE.BoxGeometry(rh + t / 2, rw, Math.max(1, C - 2))
        const r = o.style === 'over' ? inn - rh / 2 + t / 4 : out + rh / 2 - t / 4
        g.translate(r, 0, -C / 2 - 0.5)
        g.rotateZ((k / n) * Math.PI * 2)
        parts.push(clean(g))
      }
    }
  }
  // one group per part, so the slicer joins parts that touch instead of cancelling them
  const merged = mergeGeometries(parts, true)!
  merged.computeVertexNormals()
  return merged
}

// A square leg between two points.
function beam(THREE: typeof import('three'), a: [number, number, number], b: [number, number, number], w: number) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b)
  const d = B.clone().sub(A).normalize()
  const up = Math.abs(d.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0)
  const u = new THREE.Vector3().crossVectors(d, up).normalize().multiplyScalar(w / 2)
  const v = new THREE.Vector3().crossVectors(d, u).normalize().multiplyScalar(w / 2)
  const c = [u.clone().add(v), u.clone().sub(v), u.clone().negate().sub(v), u.clone().negate().add(v)]
  const P = [...c.map((q) => A.clone().add(q)), ...c.map((q) => B.clone().add(q))]
  const quads = [[0, 1, 2, 3], [7, 6, 5, 4], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]]
  const pos: number[] = []
  for (const [p0, p1, p2, p3] of quads) for (const i of [p0, p1, p2, p0, p2, p3]) pos.push(P[i].x, P[i].y, P[i].z)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  return g
}

// How much it weighs and how much filament it takes (PLA, 1.75 mm), roughly.
export function filament(g: import('three').BufferGeometry): { cm3: number; grams: number; meters: number } {
  const pos = g.getAttribute('position')
  // each piece on its own: pieces can face either way
  const groups = g.groups.length ? g.groups : [{ start: 0, count: pos.count }]
  let total = 0
  for (const gr of groups) {
    let v = 0
    for (let i = gr.start; i < gr.start + gr.count; i += 3) {
      const ax = pos.getX(i), ay = pos.getY(i), az = pos.getZ(i)
      const bx = pos.getX(i + 1), by = pos.getY(i + 1), bz = pos.getZ(i + 1)
      const cx = pos.getX(i + 2), cy = pos.getY(i + 2), cz = pos.getZ(i + 2)
      v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6
    }
    total += Math.abs(v)
  }
  const cm3 = total / 1000
  return { cm3, grams: cm3 * 1.24, meters: (cm3 / (Math.PI * 0.0875 * 0.0875)) / 100 }
}

export async function stl(p: GoboPlan, o: GoboOptions): Promise<Blob> {
  const THREE = await import('three')
  const { STLExporter } = await import('three/addons/exporters/STLExporter.js')
  const mesh = new THREE.Mesh(await goboGeometry(p, o))
  const data = new STLExporter().parse(mesh, { binary: true }) as DataView
  return new Blob([data.buffer as ArrayBuffer], { type: 'model/stl' })
}
