import type { SliceSettings, SupportBox } from './settings'

// Supports, worked out on a coarse grid from the top of the part down.
//
// 1. Overhangs: for every layer, the cells of the part that have nothing of
//    the layer below close enough under them (closer than the steepest wall
//    allows). Your own boxes add support (enforce) or take it away (block).
//    "Critical only" keeps just the overhangs a print would fail on: parts
//    that start in mid air, and places that reach out over air further than
//    a few millimetres.
// 2. Normal support: columns that go down from each overhang (with a gap of
//    air under the part) until they land on the bed, or on the part.
// 3. Tree support: a few dense layers right under the overhang (the roof),
//    then branches that start under the roof, lean together, merge into
//    trunks and grow wider on the way down, going around the part.

export interface Grid { x0: number; y0: number; r: number; w: number; h: number }

export interface SupportPlan {
  g: Grid
  base: (Uint8Array | null)[]       // normal support, per layer
  iface: (Uint8Array | null)[]      // the dense part of it, per layer
  trees: [number, number, number][][] // branches per layer: x, y, radius in mm
}

// Grows a mask by n cells (4 ways).
export function grow(m: Uint8Array, g: Grid, n: number): Uint8Array {
  if (n <= 0) return m
  let a = m
  const { w, h } = g
  for (let k = 0; k < n; k++) {
    const b = new Uint8Array(w * h)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x
      if (a[p] || (x > 0 && a[p - 1]) || (x < w - 1 && a[p + 1]) || (y > 0 && a[p - w]) || (y < h - 1 && a[p + w])) b[p] = 1
    }
    a = b
  }
  return a
}

// Joined groups of cells: a label for each cell (-1: not in the mask) and the size of each group.
export function groups(m: Uint8Array, w: number, h: number): { label: Int32Array; size: number[] } {
  const label = new Int32Array(w * h).fill(-1)
  const size: number[] = []
  const stack = new Int32Array(w * h)
  for (let s = 0; s < w * h; s++) {
    if (!m[s] || label[s] >= 0) continue
    const id = size.length
    let top = 0, n = 0
    stack[top++] = s; label[s] = id
    while (top) {
      const p = stack[--top]; n++
      const x = p % w, y = (p - x) / w
      if (x > 0 && m[p - 1] && label[p - 1] < 0) { label[p - 1] = id; stack[top++] = p - 1 }
      if (x < w - 1 && m[p + 1] && label[p + 1] < 0) { label[p + 1] = id; stack[top++] = p + 1 }
      if (y > 0 && m[p - w] && label[p - w] < 0) { label[p - w] = id; stack[top++] = p - w }
      if (y < h - 1 && m[p + w] && label[p + w] < 0) { label[p + w] = id; stack[top++] = p + w }
    }
    size.push(n)
  }
  return { label, size }
}

// Distance in cells from every cell to the nearest cell of the mask (a quick two pass chamfer).
function distTo(m: Uint8Array, w: number, h: number): Float32Array {
  const d = new Float32Array(w * h)
  for (let p = 0; p < w * h; p++) d[p] = m[p] ? 0 : 1e9
  const D = Math.SQRT2
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x
    let v = d[p]
    if (x > 0) v = Math.min(v, d[p - 1] + 1)
    if (y > 0) { v = Math.min(v, d[p - w] + 1); if (x > 0) v = Math.min(v, d[p - w - 1] + D); if (x < w - 1) v = Math.min(v, d[p - w + 1] + D) }
    d[p] = v
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const p = y * w + x
    let v = d[p]
    if (x < w - 1) v = Math.min(v, d[p + 1] + 1)
    if (y < h - 1) { v = Math.min(v, d[p + w] + 1); if (x < w - 1) v = Math.min(v, d[p + w + 1] + D); if (x > 0) v = Math.min(v, d[p + w - 1] + D) }
    d[p] = v
  }
  return d
}

const inBox = (b: SupportBox, x: number, y: number, z: number) => Math.abs(x - b.x) <= b.w / 2 && Math.abs(y - b.y) <= b.d / 2 && z >= b.z0 && z <= b.z1

/**
 * coarse: the part on the coarse grid, one mask per layer. tops: the top of
 * each layer in mm.
 */
export function planSupports(coarse: Uint8Array[], g: Grid, tops: number[], s: SliceSettings, tris?: Float32Array): SupportPlan {
  const n = tops.length
  const NS = g.w * g.h
  const c = g.r
  const where = s.support ?? 'none'
  const plan: SupportPlan = { g, base: new Array(n).fill(null), iface: new Array(n).fill(null), trees: Array.from({ length: n }, () => []) }
  if (where === 'none' || n < 2) return plan
  const cx = (p: number) => g.x0 + ((p % g.w) + 0.5) * c
  const cy = (p: number) => g.y0 + (Math.floor(p / g.w) + 0.5) * c
  const boxes = s.supportBoxes ?? []
  const enforce = boxes.filter((b) => b.kind === 'enforce'), block = boxes.filter((b) => b.kind === 'block')
  const lean = Math.tan(((s.supportAngle ?? 55) * Math.PI) / 180) * s.layer
  const leanCells = Math.max(1, Math.round(lean / c))
  const gapCells = Math.max(1, Math.round((s.supportGap ?? 0.7) / c))
  const topGap = s.supportTopZ === undefined ? 1 : Math.max(0, Math.round(s.supportTopZ / s.layer))
  const botGap = s.supportBottomZ === undefined ? 0 : Math.max(0, Math.round(s.supportBottomZ / s.layer))
  const tree = s.supportType === 'tree'
  const ifTop = tree ? Math.max(1, s.interfaceTop ?? 2) : Math.max(0, s.interfaceTop ?? 0)
  const ifBot = Math.max(0, s.interfaceBottom ?? 0)
  const minCells = (s.supportMinArea ?? 0) / (c * c)

  // 1. overhangs
  // From the faces of the part: every face that looks down more steeply than
  // the threshold marks the cells under it, at its own height. This finds
  // gentle overhangs that a coarse look from layer to layer would miss.
  const facets: (Uint8Array | null)[] = new Array(n).fill(null)
  if (tris && !s.supportManual) {
    const lim = -Math.sin(((s.supportAngle ?? 55) * Math.PI) / 180)
    const cutAt = tops.map((t, i) => t - (i ? s.layer : tops[0]) / 2)
    const layerAt = (z: number) => { let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (cutAt[m] < z - 1e-6) lo = m + 1; else hi = m } return lo }
    for (let t = 0; t + 8 < tris.length; t += 9) {
      const ax = tris[t], ay = tris[t + 1], az = tris[t + 2], bx = tris[t + 3], by = tris[t + 4], bz = tris[t + 5], cx2 = tris[t + 6], cy2 = tris[t + 7], cz = tris[t + 8]
      const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx2 - ax, vy = cy2 - ay, vz = cz - az
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
      const len = Math.hypot(nx, ny, nz)
      if (len < 1e-12 || nz / len > lim) continue
      if (Math.max(az, bz, cz) < tops[0] + 1e-4) continue        // on the bed
      const det = (by - cy2) * (ax - cx2) + (cx2 - bx) * (ay - cy2)
      if (Math.abs(det) < 1e-12) continue
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx2) - g.x0) / c)), i1 = Math.min(g.w - 1, Math.floor((Math.max(ax, bx, cx2) - g.x0) / c))
      const j0 = Math.max(0, Math.floor((Math.min(ay, by, cy2) - g.y0) / c)), j1 = Math.min(g.h - 1, Math.floor((Math.max(ay, by, cy2) - g.y0) / c))
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const px = g.x0 + (i + 0.5) * c, py = g.y0 + (j + 0.5) * c
        let l1 = ((by - cy2) * (px - cx2) + (cx2 - bx) * (py - cy2)) / det
        let l2 = ((cy2 - ay) * (px - cx2) + (ax - cx2) * (py - cy2)) / det
        let l3 = 1 - l1 - l2
        // cells the face only touches count too, so thin faces are not missed
        const e = 0.35 * c / Math.max(1e-6, Math.sqrt(Math.abs(det)))
        if (l1 < -e || l2 < -e || l3 < -e) continue
        l1 = Math.max(0, l1); l2 = Math.max(0, l2); l3 = Math.max(0, l3)
        const sum = l1 + l2 + l3
        const z = (l1 * az + l2 * bz + l3 * cz) / sum
        const L = layerAt(z)
        if (L <= 0 || L >= n) continue
        ;(facets[L] ??= new Uint8Array(NS))[j * g.w + i] = 1
      }
    }
  }
  const hangs: (Uint8Array | null)[] = new Array(n).fill(null)
  for (let i = 1; i < n; i++) {
    const ins = coarse[i], below = coarse[i - 1]
    let hang: Uint8Array = new Uint8Array(NS)
    let any = false
    if (!s.supportManual) {
      const near = grow(below, g, leanCells)
      for (let p = 0; p < NS; p++) if (ins[p] && !near[p]) { hang[p] = 1; any = true }
      const fc = facets[i]
      if (fc) for (let p = 0; p < NS; p++) if (fc[p] && !below[p]) { hang[p] = 1; any = true }
      if (any && s.supportCritical) {
        // parts that start in mid air, and cells far from anything below
        const far = distTo(below, g.w, g.h)
        const lim = (s.criticalDist ?? 3) / c
        const { label, size } = groups(ins, g.w, g.h)
        const touches = new Uint8Array(size.length)
        for (let p = 0; p < NS; p++) if (ins[p] && below[p]) touches[label[p]] = 1
        const crit = new Uint8Array(NS)
        let anyC = false
        for (let p = 0; p < NS; p++) if (hang[p] && (far[p] > lim || (ins[p] && !touches[label[p]]))) { crit[p] = 1; anyC = true }
        hang = anyC ? grow(crit, g, 1) : crit
        for (let p = 0; p < NS; p++) if (!ins[p] || !hang[p]) hang[p] = 0
        any = anyC
      }
      if (any && minCells > 1) {
        const { label, size } = groups(hang, g.w, g.h)
        any = false
        for (let p = 0; p < NS; p++) if (hang[p]) { if (size[label[p]] < minCells) hang[p] = 0; else any = true }
      }
    }
    if (enforce.length) {
      for (let p = 0; p < NS; p++) if (ins[p] && !below[p] && enforce.some((b) => inBox(b, cx(p), cy(p), tops[i]))) { hang[p] = 1; any = true }
    }
    if (any && block.length) {
      any = false
      for (let p = 0; p < NS; p++) if (hang[p]) { if (block.some((b) => inBox(b, cx(p), cy(p), tops[i]))) hang[p] = 0; else any = true }
    }
    if (any) hangs[i] = hang
  }

  // 2. columns down (for trees: only the roof)
  const carry = new Uint8Array(NS)
  const age = new Uint16Array(NS)
  const spawn: (Uint8Array | null)[] = new Array(n).fill(null)
  for (let i = n - 1; i >= 0; i--) {
    const h = hangs[i + 1 + topGap]
    if (h) for (let p = 0; p < NS; p++) if (h[p]) { carry[p] = 1; age[p] = 0 }
    const ins = coarse[i]
    const gap = grow(ins, g, gapCells)
    let sup: Uint8Array | null = null, ifc: Uint8Array | null = null
    for (let p = 0; p < NS; p++) {
      if (!carry[p]) continue
      if (ins[p]) {
        // lands on the part: keep the air gap above it, and the dense layers on it
        carry[p] = 0
        for (let k = i + 1; k <= Math.min(n - 1, i + botGap); k++) { if (plan.base[k]) plan.base[k]![p] = 0; if (plan.iface[k]) plan.iface[k]![p] = 0 }
        for (let k = i + 1 + botGap; k <= Math.min(n - 1, i + botGap + ifBot); k++) if (plan.base[k]?.[p]) (plan.iface[k] ??= new Uint8Array(NS))[p] = 1
        continue
      }
      if (tree && age[p] >= ifTop) { carry[p] = 0; (spawn[i] ??= new Uint8Array(NS))[p] = 1; continue }
      if (!gap[p]) {
        (sup ??= new Uint8Array(NS))[p] = 1
        if (age[p] < ifTop) (ifc ??= new Uint8Array(NS))[p] = 1
      }
      age[p]++
    }
    plan.base[i] = sup
    plan.iface[i] = ifc
  }
  if (where === 'bed') {
    // only columns with nothing of the part under them
    const blocked = new Uint8Array(NS)
    for (let i = 0; i < n; i++) {
      const b = plan.base[i], f = plan.iface[i], sp = spawn[i]
      for (let p = 0; p < NS; p++) {
        if (coarse[i][p]) blocked[p] = 1
        if (blocked[p]) { if (b) b[p] = 0; if (f) f[p] = 0; if (sp) sp[p] = 0 }
      }
    }
  }
  if (!tree) return plan

  // 3. branches
  interface Node { x: number; y: number; r: number }
  const tipR = Math.max(0.2, (s.treeTip ?? 0.8) / 2)
  const maxR = Math.max(tipR, (s.treeMax ?? 8) / 2)
  const move = Math.tan(((s.treeAngle ?? 40) * Math.PI) / 180) * s.layer
  const widen = Math.tan(((s.treeGrow ?? 5) * Math.PI) / 180) * s.layer
  const step = Math.max(1, Math.round((s.treeBranchDist ?? 3) / c))
  let nodes: Node[] = []
  const cellAt = (m: Uint8Array, x: number, y: number) => {
    const i = Math.floor((x - g.x0) / c), j = Math.floor((y - g.y0) / c)
    return i >= 0 && j >= 0 && i < g.w && j < g.h ? m[j * g.w + i] : 0
  }
  const hits = (m: Uint8Array, x: number, y: number, r: number) => {
    if (cellAt(m, x, y)) return true
    for (let a = 0; a < 8; a++) if (cellAt(m, x + Math.cos((a * Math.PI) / 4) * r, y + Math.sin((a * Math.PI) / 4) * r)) return true
    return false
  }
  for (let i = n - 1; i >= 0; i--) {
    const sp = spawn[i]
    if (sp) {
      // tips under the roof, every few millimetres, and at least one for each patch
      const { label, size } = groups(sp, g.w, g.h)
      const got = new Uint8Array(size.length)
      const sum = size.map(() => [0, 0])
      for (let p = 0; p < NS; p++) {
        if (!sp[p]) continue
        const L = label[p], x = p % g.w, y = (p - x) / g.w
        sum[L][0] += cx(p); sum[L][1] += cy(p)
        if (x % step === 0 && y % step === 0) { nodes.push({ x: cx(p), y: cy(p), r: tipR }); got[L] = 1 }
      }
      for (let L = 0; L < size.length; L++) if (!got[L]) nodes.push({ x: sum[L][0] / size[L], y: sum[L][1] / size[L], r: tipR })
    }
    if (!nodes.length) continue
    const ins = coarse[i]
    const keep = grow(ins, g, gapCells)
    const next: Node[] = []
    for (const nd of nodes) {
      // lands on the part (support everywhere), keeping the gap of air
      let landed = false
      if (where === 'everywhere') for (let k = i; k >= Math.max(0, i - botGap); k--) if (cellAt(coarse[k], nd.x, nd.y)) { landed = true; break }
      if (landed) continue
      if (hits(keep, nd.x, nd.y, nd.r)) {
        // step around the part
        let best: [number, number] | null = null, bd = Infinity
        for (let k = 1; k <= 4 && !best; k++) for (let a = 0; a < 16; a++) {
          const x = nd.x + Math.cos((a * Math.PI) / 8) * move * k * 1.5, y = nd.y + Math.sin((a * Math.PI) / 8) * move * k * 1.5
          if (!hits(keep, x, y, nd.r)) { const d = Math.hypot(x - nd.x, y - nd.y); if (d < bd) { bd = d; best = [x, y] } }
        }
        if (!best && nd.r > tipR) { nd.r = tipR; if (!hits(keep, nd.x, nd.y, nd.r)) best = [nd.x, nd.y] }
        if (!best) continue      // no way down: this branch stops
        nd.x = best[0]; nd.y = best[1]
      }
      next.push(nd)
    }
    plan.trees[i] = next.map((nd) => [nd.x, nd.y, nd.r])
    // on the way to the layer below: lean together, merge, widen
    const used = new Uint8Array(next.length)
    const out: Node[] = []
    for (let a = 0; a < next.length; a++) {
      if (used[a]) continue
      const A = next[a]
      let bi = -1, bd = Infinity
      for (let b = 0; b < next.length; b++) {
        if (b === a || used[b]) continue
        const d = Math.hypot(next[b].x - A.x, next[b].y - A.y)
        if (d < bd) { bd = d; bi = b }
      }
      if (bi >= 0 && bd < (A.r + next[bi].r) * 0.5 + move) {
        const B = next[bi]
        used[bi] = 1
        const wa = A.r * A.r, wb = B.r * B.r
        out.push({ x: (A.x * wa + B.x * wb) / (wa + wb), y: (A.y * wa + B.y * wb) / (wa + wb), r: Math.min(maxR, Math.sqrt(wa + wb)) })
      } else if (bi >= 0 && bd < (s.treeBranchDist ?? 3) * 4) {
        const B = next[bi]
        const t = Math.min(1, move / bd)
        out.push({ x: A.x + (B.x - A.x) * t * 0.5, y: A.y + (B.y - A.y) * t * 0.5, r: Math.min(maxR, A.r + widen) })
      } else out.push({ ...A, r: Math.min(maxR, A.r + widen) })
      used[a] = 1
    }
    nodes = out
  }
  return plan
}
