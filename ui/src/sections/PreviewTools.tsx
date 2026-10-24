import { useEffect, useRef, useState } from 'react'
import SnapBar from '../components/SnapBar'
import { getSnap, snapTo, useSnap } from '../shell/snap'
import { toast } from '../components/Toasts'
import { baseValue, changeMasks, newMask, newShape, setProp, updateLayer, addMask, setMaskPoints } from '../create/ops'
import { invert3 } from '../create/renderer'
import { maskPointsAt, type Layer, type Scene } from '../create/scene'
import { getPlay } from '../create/timeline'
import { getCreate, getRenderer, select, useCreate } from '../create/store'
import { onTimelineAction } from '../create/timelineBus'
import { useTick } from '../engine/useTick'
import { chooseTool, setTools, useTools, type Tool } from '../create/tools'
import { runCanvasTool } from '../create/customTools'
import { newText } from '../create/ops'

// Tools on the Motion preview:
// V select, then move, turn and size with the handles (which ones show is
// picked in the snapping strip: Move, Turn, Size or All), Y move the anchor
// point, Q draw a shape layer (press Q again for the next shape), G pen:
// click points to draw a mask. The tool strip sits above the picture.

const TOOLS: { t: Tool; label: string; key: string; tip: string }[] = [
  { t: 'v', label: 'Select', key: 'V', tip: 'Select a layer, then move, turn or size it with its handles' },
  { t: 'y', label: 'Anchor', key: 'Y', tip: 'Move the point a layer turns and sizes around' },
  { t: 'q', label: 'Shape', key: 'Q', tip: 'Drag to draw a shape layer. Press Q again for the next shape' },
  { t: 'g', label: 'Pen', key: 'G', tip: 'Click points to draw a mask on the selected layer' },
]

// The older strip above the picture (the tools now live in the green strip
// on top of the workspace; this one is kept for other workspaces).
export function MotionToolbar() {
  const t = useTools()
  return (
    <div className="mt-bar" role="toolbar" aria-label="Tools">
      <div className="seg" role="group" aria-label="Tool">
        {TOOLS.map((x) => (
          <button key={x.t} className={t.tool === x.t ? 'on' : ''} title={`${x.tip} (${x.key})`} onClick={() => chooseTool(x.t)}>{x.label}<kbd>{x.key}</kbd></button>
        ))}
      </div>
      <SnapBar place="motion" />
    </div>
  )
}

type M = number[]
const apply = (m: M, x: number, y: number): [number, number] => [m[0] * x + m[1] * y + m[2], m[3] * x + m[4] * y + m[5]]
const applyLinear = (m: M, x: number, y: number): [number, number] => [m[0] * x + m[1] * y, m[3] * x + m[4] * y]

function matrixOf(l: Layer, s: Scene): M {
  return getRenderer()?.layerMatrix(l, s) ?? [1, 0, 0, 0, 1, 0, 0, 0, 1]
}
function parentMatrix(l: Layer, s: Scene): M {
  const p = l.parent ? s.layers.find((x) => x.id === l.parent) : undefined
  return p ? matrixOf(p, s) : [1, 0, 0, 0, 1, 0, 0, 0, 1]
}

// The corners of what a layer draws, in its own space.
function frameOf(l: Layer, s: Scene): [number, number][] {
  const ar = s.width / s.height
  if (l.type === 'vshape') {
    const w = baseValue(l, 'w') / 2, h = baseValue(l, 'h') / 2
    return [[-w, -h], [w, -h], [w, h], [-w, h]]
  }
  return [[-ar / 2, -0.5], [ar / 2, -0.5], [ar / 2, 0.5], [-ar / 2, 0.5]]
}

// The turn knob: a little above the middle of the top edge (in view pixels).
function knobOf(pts: [number, number][]): [number, number] {
  const tx = (pts[0][0] + pts[1][0]) / 2, ty = (pts[0][1] + pts[1][1]) / 2
  const cx = (pts[0][0] + pts[2][0]) / 2, cy = (pts[0][1] + pts[2][1]) / 2
  const d = Math.hypot(tx - cx, ty - cy) || 1
  return [tx + ((tx - cx) / d) * 26, ty + ((ty - cy) / d) * 26]
}

const inside = (pts: [number, number][], x: number, y: number) => {
  let c = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}

export default function PreviewTools() {
  const scene = useCreate((s) => s.scene)
  const selected = useCreate((s) => s.selected)
  const tools = useTools()
  const tool = tools.tool
  const customDown = useRef(false)
  const shapeKind = tools.shape
  const snap = useSnap('motion')
  const [rubber, setRubber] = useState<{ a: [number, number]; b: [number, number] } | null>(null)
  const [pen, setPen] = useState<{ layer: string; mask: number; pts: [number, number][] } | null>(null)
  const host = useRef<HTMLDivElement | null>(null)
  useTick(66)

  useEffect(() => onTimelineAction((a) => {
    if (!a.startsWith('tool:')) return false
    chooseTool(a.slice(5) as Tool | 'w' | 'h')
    return true
  }), [])
  // the strip's Done button (or picking another tool) closes the pen
  useEffect(() => { setPen(null) }, [tools.finish])
  useEffect(() => { if (tools.pen !== Boolean(pen)) setTools({ pen: Boolean(pen) }) }, [pen, tools.pen])

  // Where the picture is inside the panel (it keeps its shape).
  const rect = () => {
    const el = host.current?.parentElement?.querySelector('.create-canvas')
    const r = (el ?? host.current!).getBoundingClientRect()
    const ar = scene.width / scene.height
    let w = r.width, h = r.width / ar
    if (h > r.height) { h = r.height; w = h * ar }
    const hr = host.current!.getBoundingClientRect()
    return { left: r.left + (r.width - w) / 2, top: r.top + (r.height - h) / 2, w, h, ox: r.left - hr.left + (r.width - w) / 2, oy: r.top - hr.top + (r.height - h) / 2 }
  }
  // Scene units (height 1, middle 0, y up) <-> pixels in the overlay.
  const toScene = (cx: number, cy: number): [number, number] => {
    const r = rect()
    return [((cx - r.left) / r.w - 0.5) * (scene.width / scene.height), 0.5 - (cy - r.top) / r.h]
  }
  const toView = (x: number, y: number): [number, number] => {
    const r = host.current ? rect() : { w: 0, h: 0, ox: 0, oy: 0 }
    return [r.ox + (x / (scene.width / scene.height) + 0.5) * r.w, r.oy + (0.5 - y) * r.h]
  }

  const layer = scene.layers.find((l) => l.id === selected)

  const pick = (x: number, y: number) => {
    const order = [...scene.layers].reverse()
    // Click again on the selected layer keeps it; otherwise the top layer under the pointer.
    for (const l of order) {
      if (!l.visible || l.locked || l.type === 'adjust') continue
      const m = matrixOf(l, scene)
      const pts = frameOf(l, scene).map(([a, b]) => apply(m, a, b))
      if (inside(pts, x, y) && (l.type === 'vshape' || l.type === 'null' || l.type === 'text' || !layer)) return l.id
    }
    return layer?.id ?? order.find((l) => l.visible && !l.locked)?.id ?? null
  }

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !host.current) return
    const [x, y] = toScene(e.clientX, e.clientY)
    ;(e.target as Element).setPointerCapture(e.pointerId)

    if (tool === 't') {
      const id = newText()
      updateLayer(id, 'Place text', (l) => ({ ...l, values: { ...l.values, tr_px: x, tr_py: y } }))
      setTools({ tool: 'v' })
      return
    }
    if (tool.startsWith('custom:')) { customDown.current = true; runCanvasTool(tool.slice(7), x, y, 'down'); return }
    if (tool === 'q') { setRubber({ a: [x, y], b: [x, y] }); return }

    // Drag a point of a mask path (V or G). With path keys on, this keys the
    // shape at the playhead: that is how you rotoscope a moving thing.
    if ((tool === 'v' || tool === 'g') && layer && !pen) {
      const m = matrixOf(layer, scene)
      const [vx, vy] = toView(x, y)
      const t = getPlay().time
      for (let mi = 0; mi < (layer.masks ?? []).length; mi++) {
        const mk = layer.masks![mi]
        if (mk.kind !== 'path') continue
        const pts = maskPointsAt(mk, t)
        const hit = pts.findIndex(([a, b]) => { const [px, py] = toView(...apply(m, a, b)); return Math.hypot(px - vx, py - vy) < 8 })
        if (hit < 0) continue
        const inv = invert3(m)
        const lid = layer.id
        const move = (ev: PointerEvent) => {
          const [nx, ny] = toScene(ev.clientX, ev.clientY)
          const [lx, ly] = apply(inv, nx, ny)
          const next = pts.map((p, j) => (j === hit ? [lx, ly] : p) as [number, number])
          // Alt drags the whole path.
          if (ev.altKey) {
            const [ox, oy] = apply(inv, x, y)
            setMaskPoints(lid, mi, pts.map(([a, b]) => [a + lx - ox, b + ly - oy]), `maskpt.${lid}.${mi}`)
          } else setMaskPoints(lid, mi, next, `maskpt.${lid}.${mi}`)
        }
        const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
        return
      }
    }

    if (tool === 'g') {
      const l = layer
      if (!l) return toast('Select a layer first, then click points to draw its mask.')
      const inv = invert3(matrixOf(l, scene))
      const [lx, ly] = apply(inv, x, y)
      if (pen && pen.layer === l.id) {
        const first = pen.pts[0]
        const [fx, fy] = toView(...apply(matrixOf(l, scene), first[0], first[1]))
        const [vx, vy] = toView(x, y)
        if (pen.pts.length >= 3 && Math.hypot(fx - vx, fy - vy) < 10) { setPen(null); toast('Mask closed.', true); return }
        if (pen.pts.length >= 16) { setPen(null); toast('A mask path can have 16 points.'); return }
        const pts: [number, number][] = [...pen.pts, [lx, ly]]
        setPen({ ...pen, pts })
        changeMasks(l.id, 'Draw mask', (list) => list.map((m, i) => (i === pen.mask ? { ...m, points: pts } : m)), `pen.${l.id}.${pen.mask}`)
        return
      }
      const count = l.masks?.length ?? 0
      if (count >= 4) return toast('A layer can have 4 masks.')
      addMask(l.id, newMask('path', { points: [[lx, ly]] }))
      setPen({ layer: l.id, mask: count, pts: [[lx, ly]] })
      return
    }

    // What the pointer grabbed: a corner (size), the knob above or just
    // outside a corner (turn), or the inside (move). Which of those answer
    // depends on the handles picked in the snapping strip.
    const h = getSnap('motion').handles
    const canMove = h === 'move' || h === 'all', canTurn = h === 'rotate' || h === 'all', canSize = h === 'scale' || h === 'all'
    let grab: 'move' | 'turn' | 'size' = canMove ? 'move' : canTurn ? 'turn' : 'size'
    let corner = -1
    if (tool === 'v' && layer) {
      const m = matrixOf(layer, scene)
      const pts = frameOf(layer, scene).map(([a, b]) => toView(...apply(m, a, b)))
      const [vx, vy] = toView(x, y)
      const knob = knobOf(pts)
      if (canTurn && Math.hypot(knob[0] - vx, knob[1] - vy) < 10) grab = 'turn'
      else {
        const near = pts.map((p) => Math.hypot(p[0] - vx, p[1] - vy))
        const i = near.indexOf(Math.min(...near))
        if (canSize && near[i] < 9) { grab = 'size'; corner = i }
        else if (canTurn && near[i] < 26 && !inside(pts, vx, vy)) grab = 'turn'
      }
    }
    const id = tool === 'v' ? (corner >= 0 || grab === 'turn' ? layer!.id : pick(x, y)) : layer?.id ?? null
    if (!id) return
    if (id !== selected) select(id)
    const l = getCreate().scene.layers.find((q) => q.id === id)!
    const pm = parentMatrix(l, scene)
    const pinv = invert3(pm)
    const start = { x, y, px: baseValue(l, 'tr_px'), py: baseValue(l, 'tr_py'), rot: baseValue(l, 'tr_rot'), ax: baseValue(l, 'tr_ax'), ay: baseValue(l, 'tr_ay'), sx: baseValue(l, 'tr_sx'), sy: baseValue(l, 'tr_sy') }
    const m0 = matrixOf(l, scene)
    const anchorWorld = apply(m0, start.ax, start.ay)
    const linv = invert3(m0)
    const [l0x, l0y] = apply(linv, x, y)
    const pxStep = () => getSnap('motion').moveStep / scene.height
    const move = (ev: PointerEvent) => {
      const sn = getSnap('motion')
      const [nx, ny] = toScene(ev.clientX, ev.clientY)
      if (tool === 'v' && grab === 'move') {
        let [dx, dy] = applyLinear(pinv, nx - start.x, ny - start.y)
        if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0 }
        const on = sn.move !== ev.ctrlKey
        setProp(id, 'tr_px', snapTo(start.px + dx, pxStep(), on), 'Move')
        setProp(id, 'tr_py', snapTo(start.py + dy, pxStep(), on), 'Move')
      } else if (tool === 'v' && grab === 'turn') {
        const a0 = Math.atan2(start.y - anchorWorld[1], start.x - anchorWorld[0])
        const a1 = Math.atan2(ny - anchorWorld[1], nx - anchorWorld[0])
        let deg = start.rot - ((a1 - a0) * 180) / Math.PI
        if (ev.shiftKey) deg = Math.round(deg / 45) * 45
        else deg = snapTo(deg, sn.rotStep, sn.rot !== ev.ctrlKey)
        setProp(id, 'tr_rot', deg, 'Rotate')
      } else if (tool === 'v' && grab === 'size') {
        // in the layer's own space, around its anchor point
        const [lx, ly] = apply(linv, nx, ny)
        const rx = Math.abs(l0x - start.ax) > 1e-4 ? (lx - start.ax) / (l0x - start.ax) : 1
        const ry = Math.abs(l0y - start.ay) > 1e-4 ? (ly - start.ay) / (l0y - start.ay) : 1
        let fx = corner >= 0 ? rx : Math.hypot(lx - start.ax, ly - start.ay) / Math.max(1e-4, Math.hypot(l0x - start.ax, l0y - start.ay))
        let fy = corner >= 0 ? ry : fx
        if (ev.shiftKey) { const f = Math.abs(fx) > Math.abs(fy) ? fx : fy; fx = fy = f }
        const on = sn.size !== ev.ctrlKey
        setProp(id, 'tr_sx', snapTo(start.sx * fx, sn.sizeStep, on), 'Scale')
        setProp(id, 'tr_sy', snapTo(start.sy * fy, sn.sizeStep, on), 'Scale')
      } else if (tool === 'y') {
        // Move the anchor without moving the picture (Pan Behind).
        const [lx, ly] = applyLinear(linv, nx - start.x, ny - start.y)
        const [dx, dy] = applyLinear(pinv, nx - start.x, ny - start.y)
        updateLayer(id, 'Move anchor point', (q) => ({ ...q, values: { ...q.values, tr_ax: start.ax + lx, tr_ay: start.ay + ly, tr_px: start.px + dx, tr_py: start.py + dy } }), `${id}.anchor`)
      }
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const onMove = (e: React.PointerEvent) => {
    if (customDown.current && tool.startsWith('custom:')) { const [x, y] = toScene(e.clientX, e.clientY); runCanvasTool(tool.slice(7), x, y, 'drag') }
    if (rubber) setRubber({ ...rubber, b: toScene(e.clientX, e.clientY) })
  }
  const onUp = (e: React.PointerEvent) => {
    if (customDown.current && tool.startsWith('custom:')) { customDown.current = false; const [x, y] = toScene(e.clientX, e.clientY); runCanvasTool(tool.slice(7), x, y, 'up') }
    if (!rubber) return
    let [x0, y0] = rubber.a, [x1, y1] = toScene(e.clientX, e.clientY)
    setRubber(null)
    let w = Math.abs(x1 - x0), h = Math.abs(y1 - y0)
    if (e.shiftKey) { w = h = Math.max(w, h); x1 = x0 + Math.sign(x1 - x0) * w; y1 = y0 + Math.sign(y1 - y0) * h }
    if (w < 0.01 || h < 0.01) { w = h = 0.4; x0 = x1 - 0.2; y0 = y1 - 0.2; x1 = x0 + 0.4; y1 = y0 + 0.4 }
    newShape(shapeKind, w, h, (x0 + x1) / 2, (y0 + y1) / 2)
  }

  // ---- drawing the handles ----
  let overlay: React.ReactNode = null
  if (layer && host.current && getRenderer()) {
    const m = matrixOf(layer, scene)
    const pts = frameOf(layer, scene).map(([a, b]) => toView(...apply(m, a, b)))
    const [ax, ay] = toView(...apply(m, baseValue(layer, 'tr_ax'), baseValue(layer, 'tr_ay')))
    overlay = (
      <g>
        <polygon points={pts.map((p) => p.join(',')).join(' ')} className="pt-box" />
        {(snap.handles === 'scale' || snap.handles === 'all') && pts.map((p, i) => <rect key={i} x={p[0] - 4} y={p[1] - 4} width={8} height={8} className="pt-handle" />)}
        {(snap.handles === 'rotate' || snap.handles === 'all') && (() => {
          const k = knobOf(pts), top: [number, number] = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2]
          return <g className="pt-knob"><line x1={top[0]} y1={top[1]} x2={k[0]} y2={k[1]} /><circle cx={k[0]} cy={k[1]} r={5} /></g>
        })()}
        <circle cx={ax} cy={ay} r={6} className="pt-anchor" />
        <path d={`M${ax - 9} ${ay}H${ax + 9}M${ax} ${ay - 9}V${ay + 9}`} className="pt-anchor" />
        {(layer.masks ?? []).map((mk) => {
          const now = maskPointsAt(mk, getPlay().time)
          if (mk.kind !== 'path' || !now.length) return null
          const mp = now.map(([a, b]) => toView(...apply(m, a, b)))
          return <g key={mk.id}>
            <polyline points={[...mp, ...(pen?.layer === layer.id ? [] : [mp[0]])].map((p) => p.join(',')).join(' ')} className="pt-mask" />
            {mp.map((p, i) => <rect key={i} x={p[0] - 3} y={p[1] - 3} width={6} height={6} className="pt-maskpt" />)}
          </g>
        })}
      </g>
    )
  }
  let band: React.ReactNode = null
  if (rubber) {
    const [x0, y0] = toView(...rubber.a), [x1, y1] = toView(...rubber.b)
    band = shapeKind === 1
      ? <ellipse cx={(x0 + x1) / 2} cy={(y0 + y1) / 2} rx={Math.abs(x1 - x0) / 2} ry={Math.abs(y1 - y0) / 2} className="pt-band" />
      : <rect x={Math.min(x0, x1)} y={Math.min(y0, y1)} width={Math.abs(x1 - x0)} height={Math.abs(y1 - y0)} className="pt-band" />
  }

  return (
    <>
      <div ref={host} className={`pt-layer tool-${tool}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
        onDoubleClick={() => setPen(null)}>
        <svg className="pt-svg">{overlay}{band}</svg>
      </div>
    </>
  )
}
