import { useEffect, useRef, useState } from 'react'
import { setSnap, snapTo, useSnap } from '../shell/snap'
import { outline, setMap, useMap, type P2 } from './model'

// Points you drag to map: surface corners or grid points, mask points and
// the 3D calibration crosshairs. Used on the projector itself (in the
// output window) and on the preview in the main window. Arrow keys move the
// picked point one pixel (Shift: ten).
//
// A picked surface or mask also gets a handle in its middle, like the 3D
// view: W moves it, E turns it, R sizes it. All of this happens in output
// pixels, so shapes keep their true proportions while you turn or size them.

export interface Pick { kind: 'surface' | 'mask' | 'pair'; id: string; point: number }
export type GizmoMode = 'move' | 'rotate' | 'scale' | 'all'
type Op = 'free' | 'x' | 'y' | 'rot' | 'sx' | 'sy' | 'sxy'

const inside = (pts: P2[], x: number, y: number) => {
  let c = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}

const center = (pts: P2[]): P2 => {
  if (!pts.length) return [0.5, 0.5]
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
  return [(x0 + x1) / 2, (y0 + y1) / 2]
}

// One choice for every overlay (the preview and the projector agree), kept
// with the snapping settings.
export function setGizmoMode(m: GizmoMode | 'all') { setSnap('mapping', { handles: m }) }

export default function MapOverlay({ out, pick, onPick, big }: { out: string; pick: Pick | null; onPick: (p: Pick | null) => void; big?: boolean }) {
  const map = useMap(out)
  const snap = useSnap('mapping')
  const mode = snap.handles
  const box = useRef<HTMLDivElement | null>(null)
  const drag = useRef<{ pick: Pick; start: P2; orig: P2[]; op?: Op; c?: P2 } | null>(null)
  const [W, H] = map.res
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({})

  const at = (e: { clientX: number; clientY: number }): P2 => {
    const r = box.current!.getBoundingClientRect()
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]
  }
  const pointsOf = (p: Pick): P2[] => {
    if (p.kind === 'surface') return map.surfaces.find((s) => s.id === p.id)?.points ?? []
    if (p.kind === 'mask') return map.masks.find((s) => s.id === p.id)?.points ?? []
    return map.pairs.map((x) => x.uv)
  }
  const write = (p: Pick, pts: P2[]) => setMap(out, (m) => {
    if (p.kind === 'surface') return { ...m, surfaces: m.surfaces.map((s) => (s.id === p.id ? { ...s, points: pts } : s)) }
    if (p.kind === 'mask') return { ...m, masks: m.masks.map((s) => (s.id === p.id ? { ...s, points: pts } : s)) }
    return { ...m, pairs: m.pairs.map((x, i) => ({ ...x, uv: pts[i] })) }
  })

  const lockedOf = (p: Pick | null) => Boolean(p && (p.kind === 'surface' ? map.surfaces.find((x) => x.id === p.id)?.locked : p.kind === 'mask' ? map.masks.find((x) => x.id === p.id)?.locked : false))
  const shapePicked = pick && pick.kind !== 'pair' && pointsOf(pick).length > 0 && !lockedOf(pick)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!pick || (e.target as Element)?.closest?.('input, select, textarea, [contenteditable]')) return
      if (!e.ctrlKey && !e.metaKey && !e.altKey && pick.kind !== 'pair') {
        const k = e.key.toLowerCase()
        const m = k === 'w' ? 'move' : k === 'e' ? 'rotate' : k === 'r' ? 'scale' : k === 'q' ? 'all' : null
        if (m) { e.preventDefault(); setGizmoMode(m); if (pick.point >= 0) onPick({ ...pick, point: -1 }); return }
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && pick.kind !== 'pair') {
        e.preventDefault()
        // a picked mask point goes (a mask keeps at least three); otherwise the whole surface or mask
        if (pick.kind === 'mask' && pick.point >= 0) {
          setMap(out, (m) => ({ ...m, masks: m.masks.map((x) => (x.id === pick.id && x.points.length > 3 ? { ...x, points: x.points.filter((_, j) => j !== pick.point) } : x)) }), true, 'Delete point')
          onPick({ ...pick, point: -1 })
        } else if (!lockedOf(pick)) {
          setMap(out, (m) => (pick.kind === 'mask' ? { ...m, masks: m.masks.filter((x) => x.id !== pick.id) } : { ...m, surfaces: m.surfaces.filter((x) => x.id !== pick.id) }), true, pick.kind === 'mask' ? 'Delete mask' : 'Delete surface')
          onPick(null)
        }
        return
      }
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]
      if (!d || lockedOf(pick)) return
      e.preventDefault()
      const k = e.shiftKey ? 10 : 1
      const pts = pointsOf(pick).map((p) => [...p] as P2)
      // a picked point moves alone, a picked shape moves whole
      for (let i = 0; i < pts.length; i++) {
        if (pick.point >= 0 && i !== pick.point) continue
        pts[i] = [pts[i][0] + (d[0] * k) / W, pts[i][1] + (d[1] * k) / H]
      }
      write(pick, pts)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const startDrag = (p: Pick, e: React.PointerEvent, op?: Op) => {
    e.stopPropagation()
    onPick(p)
    if (lockedOf(p)) return            // locked: it can be picked, not moved
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
    const orig = pointsOf(p).map((q) => [...q] as P2)
    drag.current = { pick: p, start: at(e), orig, op, c: center(orig) }
  }

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const [x, y] = at(e)
    const op = d.op ?? 'free'
    let fn: (q: P2) => P2
    if (op === 'rot' && d.c) {
      // in output pixels, so a circle stays a circle while it turns
      const c = d.c
      const a0 = Math.atan2((d.start[1] - c[1]) * H, (d.start[0] - c[0]) * W)
      let a = Math.atan2((y - c[1]) * H, (x - c[0]) * W) - a0
      const step = e.shiftKey ? 15 : snap.rotStep
      if (e.shiftKey || snap.rot !== e.ctrlKey) a = (snapTo((a * 180) / Math.PI, step, true) * Math.PI) / 180
      const cs = Math.cos(a), sn = Math.sin(a)
      fn = (q) => { const px = (q[0] - c[0]) * W, py = (q[1] - c[1]) * H; return [c[0] + (px * cs - py * sn) / W, c[1] + (px * sn + py * cs) / H] }
    } else if ((op === 'sx' || op === 'sy' || op === 'sxy') && d.c) {
      const c = d.c
      const sx0 = (d.start[0] - c[0]) * W, sy0 = (d.start[1] - c[1]) * H
      const nx = (x - c[0]) * W, ny = (y - c[1]) * H
      let fx = 1, fy = 1
      if (op === 'sxy') { const f = Math.hypot(nx, ny) / Math.max(1, Math.hypot(sx0, sy0)); fx = fy = f }
      if (op === 'sx') fx = Math.abs(sx0) > 1 ? nx / sx0 : 1
      if (op === 'sy') fy = Math.abs(sy0) > 1 ? ny / sy0 : 1
      if (e.shiftKey && op !== 'sxy') { const f = op === 'sx' ? fx : fy; fx = fy = f }
      const sOn = snap.size !== e.ctrlKey
      fx = snapTo(fx, snap.sizeStep, sOn) || snap.sizeStep; fy = snapTo(fy, snap.sizeStep, sOn) || snap.sizeStep
      fn = (q) => [c[0] + (q[0] - c[0]) * fx, c[1] + (q[1] - c[1]) * fy]
    } else {
      let dx = x - d.start[0], dy = y - d.start[1]
      if (op === 'x') dy = 0
      if (op === 'y') dx = 0
      const mOn = snap.move !== e.ctrlKey
      if (mOn && d.pick.point >= 0) {
        // one point: onto the grid itself
        const q0 = d.orig[d.pick.point]
        dx = snapTo((q0[0] + dx) * W, snap.moveStep, true) / W - q0[0]
        dy = snapTo((q0[1] + dy) * H, snap.moveStep, true) / H - q0[1]
        if (op === 'y') dx = 0
        if (op === 'x') dy = 0
      } else {
        dx = snapTo(dx * W, snap.moveStep, mOn) / W
        dy = snapTo(dy * H, snap.moveStep, mOn) / H
      }
      // pull to the output's edges and middle, and to other shapes' corners (Alt: free)
      if (snap.edges !== false && !e.altKey) {
        const r = box.current!.getBoundingClientRect()
        const tx = 8 / Math.max(1, r.width), ty = 8 / Math.max(1, r.height)
        const xs = [0, 0.5, 1], ys = [0, 0.5, 1]
        const others = [...map.surfaces.filter((x) => x.on && !(d.pick.kind === 'surface' && x.id === d.pick.id)).map(outline), ...map.masks.filter((x) => x.on && !(d.pick.kind === 'mask' && x.id === d.pick.id)).map((x) => x.points)]
        for (const o of others) { for (const [px, py] of o) { xs.push(px); ys.push(py) } const c = center(o); xs.push(c[0]); ys.push(c[1]) }
        let mine: { xs: number[]; ys: number[] }
        if (d.pick.point >= 0) { const q = d.orig[d.pick.point]; mine = { xs: [q[0]], ys: [q[1]] } }
        else {
          let a = Infinity, b = Infinity, c = -Infinity, dd = -Infinity
          for (const [px, py] of d.orig) { a = Math.min(a, px); c = Math.max(c, px); b = Math.min(b, py); dd = Math.max(dd, py) }
          mine = { xs: [a, (a + c) / 2, c], ys: [b, (b + dd) / 2, dd] }
        }
        let bx = 0, bxd = tx, gx: number | undefined
        if (op !== 'y') for (const m of mine.xs) for (const t of xs) { const diff = t - (m + dx); if (Math.abs(diff) < bxd) { bxd = Math.abs(diff); bx = diff; gx = t } }
        let by = 0, byd = ty, gy: number | undefined
        if (op !== 'x') for (const m of mine.ys) for (const t of ys) { const diff = t - (m + dy); if (Math.abs(diff) < byd) { byd = Math.abs(diff); by = diff; gy = t } }
        dx += bx; dy += by
        if (gx !== guides.x || gy !== guides.y) setGuides({ x: gx, y: gy })
      }
      fn = (q) => [q[0] + dx, q[1] + dy]
    }
    // A point moves alone; grabbing inside a shape (or its handle) changes all of it.
    const pts = d.orig.map((q, i) => (d.pick.point < 0 || i === d.pick.point ? fn(q) : q))
    write(d.pick, pts)
  }

  const sel = (k: Pick['kind'], id: string) => pick?.kind === k && pick.id === id
  const gc = shapePicked ? center(pointsOf(pick!)) : null
  const g = (op: Op) => (e: React.PointerEvent) => { if (pick) startDrag({ ...pick, point: -1 }, e, op) }

  return (
    <div ref={box} className={`map-overlay${big ? ' big' : ''}`}
      onPointerMove={onMove} onPointerUp={() => { drag.current = null; if (guides.x !== undefined || guides.y !== undefined) setGuides({}) }}
      onPointerDown={(e) => {
        const [x, y] = at(e)
        const hitMask = [...map.masks].reverse().find((m) => m.on && inside(m.points, x, y))
        const hit = [...map.surfaces].reverse().find((s) => s.on && inside(outline(s), x, y))
        if (hitMask && (pick?.kind === 'mask' || !hit)) startDrag({ kind: 'mask', id: hitMask.id, point: -1 }, e)
        else if (hit) startDrag({ kind: 'surface', id: hit.id, point: -1 }, e)
        else onPick(null)
      }}>
      <svg viewBox="0 0 1 1" preserveAspectRatio="none">
        {map.surfaces.filter((s) => s.on).map((s) => (
          <g key={s.id} className={`mo-surface${sel('surface', s.id) ? ' on' : ''}`}>
            <polygon points={outline(s).map((p) => p.join(',')).join(' ')} vectorEffect="non-scaling-stroke" />
            {s.kind === 'mesh' && sel('surface', s.id) && Array.from({ length: s.rows }, (_, row) => (
              <polyline key={`r${row}`} className="mo-grid" vectorEffect="non-scaling-stroke" points={Array.from({ length: s.cols }, (_, c) => s.points[row * s.cols + c].join(',')).join(' ')} />
            ))}
            {s.kind === 'mesh' && sel('surface', s.id) && Array.from({ length: s.cols }, (_, c) => (
              <polyline key={`c${c}`} className="mo-grid" vectorEffect="non-scaling-stroke" points={Array.from({ length: s.rows }, (_, row) => s.points[row * s.cols + c].join(',')).join(' ')} />
            ))}
          </g>
        ))}
        {map.masks.filter((m) => m.on).map((m) => (
          <polygon key={m.id} className={`mo-mask${sel('mask', m.id) ? ' on' : ''}`} vectorEffect="non-scaling-stroke" points={m.points.map((p) => p.join(',')).join(' ')} />
        ))}
        {guides.x !== undefined && <line className="mo-guide" x1={guides.x} y1={0} x2={guides.x} y2={1} vectorEffect="non-scaling-stroke" />}
        {guides.y !== undefined && <line className="mo-guide" x1={0} y1={guides.y} x2={1} y2={guides.y} vectorEffect="non-scaling-stroke" />}
      </svg>
      {/* handles in pixels so they stay round */}
      {map.surfaces.filter((s) => s.on && (sel('surface', s.id) || s.kind === 'quad')).map((s) => s.points.map((p, i) => (
        <i key={`${s.id}${i}`} className={`mo-pt${sel('surface', s.id) ? ' on' : ''}${pick?.id === s.id && pick.point === i ? ' picked' : ''}`}
          style={{ left: `${p[0] * 100}%`, top: `${p[1] * 100}%` }} onPointerDown={(e) => startDrag({ kind: 'surface', id: s.id, point: i }, e)} />
      )))}
      {map.masks.filter((m) => m.on && sel('mask', m.id)).map((m) => m.points.map((p, i) => (
        <i key={`${m.id}${i}`} className={`mo-pt mask${pick?.id === m.id && pick.point === i ? ' picked' : ''}`}
          style={{ left: `${p[0] * 100}%`, top: `${p[1] * 100}%` }} onPointerDown={(e) => startDrag({ kind: 'mask', id: m.id, point: i }, e)}
          onDoubleClick={(e) => { e.stopPropagation(); if (m.points.length > 3) setMap(out, (mm) => ({ ...mm, masks: mm.masks.map((x) => (x.id === m.id ? { ...x, points: x.points.filter((_, j) => j !== i) } : x)) })) }} />
      )))}
      {gc && (
        <div className={`mo-gizmo ${mode}`} style={{ left: `${gc[0] * 100}%`, top: `${gc[1] * 100}%` }}>
          <svg viewBox="-60 -60 120 120" aria-hidden="true">
            {(mode === 'rotate' || mode === 'all') && <circle className="gz-ring" r={mode === 'all' ? 52 : 44} onPointerDown={g('rot')} />}
            {(mode === 'move' || mode === 'all') && <>
              <g className="gz-x" onPointerDown={g('x')}><line x1="8" y1="0" x2="40" y2="0" /><path d="M40 -6 L52 0 L40 6 Z" /></g>
              <g className="gz-y" onPointerDown={g('y')}><line x1="0" y1="-8" x2="0" y2="-40" /><path d="M-6 -40 L0 -52 L6 -40 Z" /></g>
              <rect className="gz-c" x="-7" y="-7" width="14" height="14" onPointerDown={g('free')} />
            </>}
            {mode === 'scale' && <>
              <g className="gz-x" onPointerDown={g('sx')}><line x1="8" y1="0" x2="44" y2="0" /><rect x="42" y="-6" width="12" height="12" /></g>
              <g className="gz-y" onPointerDown={g('sy')}><line x1="0" y1="-8" x2="0" y2="-44" /><rect x="-6" y="-54" width="12" height="12" /></g>
              <rect className="gz-c" x="-8" y="-8" width="16" height="16" onPointerDown={g('sxy')} />
            </>}
            {mode === 'all' && <g className="gz-s" onPointerDown={g('sxy')}><line x1="6" y1="6" x2="28" y2="28" /><rect x="26" y="26" width="11" height="11" /></g>}
          </svg>
        </div>
      )}
      {shapePicked && (
        <div className="mo-modes" onPointerDown={(e) => e.stopPropagation()}>
          {(['move', 'rotate', 'scale', 'all'] as GizmoMode[]).map((m) => (
            <button key={m} className={`no-corner${mode === m ? ' on' : ''}`} onClick={() => setGizmoMode(m)} title={m === 'move' ? 'Move (W)' : m === 'rotate' ? 'Turn (E). Shift snaps to 15 degrees.' : m === 'scale' ? 'Size (R). Shift keeps the shape.' : 'All three (Q)'}>
              {m === 'move' ? 'Move' : m === 'rotate' ? 'Turn' : m === 'scale' ? 'Size' : 'All'}<kbd>{m === 'move' ? 'W' : m === 'rotate' ? 'E' : m === 'scale' ? 'R' : 'Q'}</kbd>
            </button>
          ))}
        </div>
      )}
      {map.showPoints && map.pairs.map((pair, i) => (
        <b key={i} className={`mo-cross${pick?.kind === 'pair' && pick.point === i ? ' picked' : ''}`} style={{ left: `${pair.uv[0] * 100}%`, top: `${pair.uv[1] * 100}%` }}
          onPointerDown={(e) => startDrag({ kind: 'pair', id: 'pairs', point: i }, e)} title={`Point ${i + 1}: drag it onto the same spot of the real object`}>
          <span>{i + 1}</span>
        </b>
      ))}
    </div>
  )
}
