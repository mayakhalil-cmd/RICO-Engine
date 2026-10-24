import { useTools } from '../create/tools'
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useCanvas } from '../components/useCanvas'
import { canvas, changeScene, useCreate } from '../create/store'
import { onTimelineAction } from '../create/timelineBus'

// The Motion canvas: zoom and pan,
// rulers you drag guides out of (drag a guide back onto a ruler to delete
// it), title and action safe areas, a grid and thirds.

export interface ViewPrefs { rulers: boolean; guides: boolean; lockGuides: boolean; safe: boolean; grid: boolean; thirds: boolean; zoom: number | 'fit' }
const KEY = 'rico.viewer'
let prefs: ViewPrefs = (() => {
  try { return { rulers: true, guides: true, lockGuides: false, safe: false, grid: false, thirds: false, zoom: 'fit', ...JSON.parse(localStorage.getItem(KEY) ?? '{}') } } catch {
    return { rulers: true, guides: true, lockGuides: false, safe: false, grid: false, thirds: false, zoom: 'fit' }
  }
})()
let version = 0
const listeners = new Set<() => void>()
export function setView(part: Partial<ViewPrefs>) {
  prefs = { ...prefs, ...part }
  try { localStorage.setItem(KEY, JSON.stringify(prefs)) } catch { /* not remembered */ }
  version++
  listeners.forEach((l) => l())
}
export function useView() {
  useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => version)
  return prefs
}

const R = 20   // ruler thickness

function useViewerTools() { return useTools() }

export default function Viewer({ children, onDropFile, onFullscreen, bar, barEnd }: { children: ReactNode; onDropFile: (f: File) => void; onFullscreen: () => void; bar?: ReactNode; barEnd?: ReactNode }) {
  const tools = useViewerTools()
  const scene = useCreate((s) => s.scene)
  const v = useView()
  const stage = useRef<HTMLDivElement | null>(null)
  const wrap = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ w: 800, h: 450 })
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragGuide, setDragGuide] = useState<{ axis: 'x' | 'y'; pos: number; id?: string } | null>(null)
  const panning = useRef<{ x: number; y: number; px: number; py: number } | null>(null)
  const space = useRef(false)

  useEffect(() => {
    wrap.current?.appendChild(canvas)
    const el = stage.current!
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    const kd = (e: KeyboardEvent) => { if (e.code === 'Space' && !(e.target as Element).closest?.('input, textarea, select')) space.current = true }
    const ku = (e: KeyboardEvent) => { if (e.code === 'Space') space.current = false }
    window.addEventListener('keydown', kd)
    window.addEventListener('keyup', ku)
    return () => { ro.disconnect(); window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); canvas.remove() }
  }, [])

  useEffect(() => onTimelineAction((a) => {
    if (a === 'view:safe') { setView({ safe: !prefs.safe }); return true }
    if (a === 'view:grid') { setView({ grid: !prefs.grid }); return true }
    if (a === 'view:rulers') { setView({ rulers: !prefs.rulers }); return true }
    if (a === 'view:guides') { setView({ guides: !prefs.guides }); return true }
    if (a === 'view:fit') { setView({ zoom: 'fit' }); setPan({ x: 0, y: 0 }); return true }
    if (a === 'view:100') { setView({ zoom: 1 }); setPan({ x: 0, y: 0 }); return true }
    if (a === 'view:in' || a === 'view:out') { setView({ zoom: Math.max(0.05, Math.min(16, zoom * (a === 'view:in' ? 1.25 : 0.8))) }); return true }
    return false
  }))

  const r = v.rulers ? R : 0
  const vw = Math.max(10, size.w - r), vh = Math.max(10, size.h - r)
  const fit = Math.min(vw / scene.width, vh / scene.height) * 0.94
  const zoom = v.zoom === 'fit' ? fit : v.zoom
  const dw = scene.width * zoom, dh = scene.height * zoom
  const left = r + (vw - dw) / 2 + pan.x, top = r + (vh - dh) / 2 + pan.y
  const toScene = (cx: number, cy: number) => {
    const b = stage.current!.getBoundingClientRect()
    return { x: (cx - b.left - left) / zoom, y: (cy - b.top - top) / zoom }
  }
  const guides = scene.guides ?? []

  // Rulers in scene pixels.
  const step = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].find((s) => s * zoom >= 50) ?? 1000
  const drawRuler = (axis: 'x' | 'y') => (g: CanvasRenderingContext2D, w: number, h: number) => {
    g.fillStyle = '#050c03'
    g.fillRect(0, 0, w, h)
    g.fillStyle = 'rgba(185,194,180,0.85)'
    g.strokeStyle = 'rgba(59,255,3,0.5)'
    g.font = '9px "Courier Prime", monospace'
    const origin = axis === 'x' ? left - r : top - r
    const len = axis === 'x' ? w : h
    const first = Math.floor(-origin / zoom / step) * step
    for (let p = first; p * zoom + origin < len; p += step / 5) {
      const at = Math.round(p * zoom + origin) + 0.5
      const major = Math.abs(p % step) < 1e-6
      g.beginPath()
      if (axis === 'x') { g.moveTo(at, h); g.lineTo(at, major ? 4 : h - 5) } else { g.moveTo(w, at); g.lineTo(major ? 4 : w - 5, at) }
      g.stroke()
      if (major) {
        if (axis === 'x') g.fillText(String(p), at + 2, 9)
        else { g.save(); g.translate(9, at - 2); g.rotate(-Math.PI / 2); g.fillText(String(p), 0, 0); g.restore() }
      }
    }
    // Where the mouse is would be nice; the scene edges are enough to find your way.
    g.fillStyle = 'rgba(248,32,160,0.6)'
    if (axis === 'x') { g.fillRect(left - r, h - 2, dw, 2) } else { g.fillRect(w - 2, top - r, 2, dh) }
  }
  const rulerX = useCanvas(drawRuler('x'), [left, zoom, r, dw, step])
  const rulerY = useCanvas(drawRuler('y'), [top, zoom, r, dh, step])

  const startGuide = (axis: 'x' | 'y', id?: string) => (e: React.PointerEvent) => {
    if (prefs.lockGuides && id) return
    e.preventDefault()
    e.stopPropagation()
    const move = (ev: PointerEvent) => {
      const p = toScene(ev.clientX, ev.clientY)
      setDragGuide({ axis, id, pos: Math.round(axis === 'x' ? p.x : p.y) })
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDragGuide(null)
      const b = stage.current!.getBoundingClientRect()
      const onRuler = axis === 'x' ? ev.clientX - b.left < r || ev.clientX < b.left || ev.clientX > b.right : ev.clientY - b.top < r || ev.clientY < b.top || ev.clientY > b.bottom
      const p = toScene(ev.clientX, ev.clientY)
      const pos = Math.round(axis === 'x' ? p.x : p.y)
      changeScene(id ? (onRuler ? 'Delete guide' : 'Move guide') : 'Add guide', (s) => {
        const list = s.guides ?? []
        if (id) return { ...s, guides: onRuler ? list.filter((g) => g.id !== id) : list.map((g) => (g.id === id ? { ...g, pos } : g)) }
        if (onRuler) return s
        return { ...s, guides: [...list, { id: Math.random().toString(36).slice(2, 8), axis, pos }] }
      })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const showGuides = v.guides ? guides.filter((g) => g.id !== dragGuide?.id) : []
  return (
    <div className="viewer">
      <div
        ref={stage}
        className={`create-stage viewer-stage${v.rulers ? ' with-rulers' : ''}${tools.tool === 'h' ? ' tool-hand' : tools.tool === 'z' ? ' tool-zoom' : ''}`}
        tabIndex={0}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) onDropFile(f) }}
        onDoubleClick={(e) => { if (e.altKey) onFullscreen() }}
        onPointerDownCapture={(e) => {
          // the Zoom tool: click to zoom in at the mouse, Alt-click to zoom out
          if (e.button === 0 && tools.tool === 'z') {
            e.preventDefault(); e.stopPropagation()
            const b = stage.current!.getBoundingClientRect()
            const mx = e.clientX - b.left, my = e.clientY - b.top
            const nz = Math.max(0.05, Math.min(16, zoom * (e.altKey ? 1 / 1.6 : 1.6)))
            const sx = (mx - left) / zoom, sy = (my - top) / zoom
            const nl = mx - sx * nz, nt = my - sy * nz
            setPan({ x: nl - (r + (vw - scene.width * nz) / 2), y: nt - (r + (vh - scene.height * nz) / 2) })
            setView({ zoom: nz })
            return
          }
          // the Hand tool (or Space, or the middle button): drag the picture around
          if (e.button === 1 || (e.button === 0 && (space.current || tools.tool === 'h'))) {
            e.preventDefault(); e.stopPropagation()
            panning.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }
            ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
          }
        }}
        onPointerMove={(e) => { const p = panning.current; if (p) setPan({ x: p.px + e.clientX - p.x, y: p.py + e.clientY - p.y }) }}
        onPointerUp={() => { panning.current = null }}
        onWheel={(e) => {
          // The wheel zooms at the mouse. Shift+wheel (or a sideways scroll) pans.
          if (!e.shiftKey && Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
            const b = stage.current!.getBoundingClientRect()
            const mx = e.clientX - b.left, my = e.clientY - b.top
            const nz = Math.max(0.05, Math.min(16, zoom * Math.exp(-e.deltaY * 0.0015)))
            // Keep the point under the mouse still.
            const sx = (mx - left) / zoom, sy = (my - top) / zoom
            const nl = mx - sx * nz, nt = my - sy * nz
            setPan({ x: nl - (r + (vw - scene.width * nz) / 2), y: nt - (r + (vh - scene.height * nz) / 2) })
            setView({ zoom: nz })
          } else setPan({ x: pan.x - (e.shiftKey ? e.deltaY : e.deltaX), y: pan.y - (e.shiftKey ? 0 : e.deltaY) })
        }}
      >
        <div ref={wrap} className="viewer-canvas" style={{ left, top, width: dw, height: dh }}>
          {v.safe && <>
            <i className="safe action" title="Action safe (90%)" />
            <i className="safe title" title="Title safe (80%)" />
            <i className="safe cross" />
          </>}
          {v.grid && <i className="view-grid" style={{ backgroundSize: `${(dw / 16).toFixed(2)}px ${(dw / 16).toFixed(2)}px` }} />}
          {v.thirds && <i className="view-thirds" />}
        </div>
        {children}
        {showGuides.map((g) => (
          <i key={g.id} className={`guide ${g.axis}${prefs.lockGuides ? ' locked' : ''}`} title={`${g.pos} px. Drag to move, drag onto a ruler to delete.`}
            style={g.axis === 'x' ? { left: left + g.pos * zoom } : { top: top + g.pos * zoom }} onPointerDown={startGuide(g.axis, g.id)} />
        ))}
        {dragGuide && <i className={`guide ${dragGuide.axis} dragging`} style={dragGuide.axis === 'x' ? { left: left + dragGuide.pos * zoom } : { top: top + dragGuide.pos * zoom }}><span>{dragGuide.pos}</span></i>}
        {v.rulers && <>
          <canvas ref={rulerX} className="ruler x" onPointerDown={startGuide('y')} title="Drag down to make a guide" />
          <canvas ref={rulerY} className="ruler y" onPointerDown={startGuide('x')} title="Drag right to make a guide" />
          <i className="ruler-corner" onDoubleClick={() => setPan({ x: 0, y: 0 })} />
        </>}
      </div>
      <div className="viewer-bar">
        {bar}
        <select className="select mini" value={v.zoom === 'fit' ? 'fit' : String(v.zoom)} onChange={(e) => { setPan({ x: 0, y: 0 }); setView({ zoom: e.target.value === 'fit' ? 'fit' : Number(e.target.value) }) }} title="Zoom (mouse wheel; Space-drag, the middle button or Shift+wheel to pan)">
          <option value="fit">Fit ({Math.round(fit * 100)}%)</option>
          {[0.125, 0.25, 0.5, 1, 2, 4, 8].map((z) => <option key={z} value={z}>{z * 100}%</option>)}
          {v.zoom !== 'fit' && ![0.125, 0.25, 0.5, 1, 2, 4, 8].includes(v.zoom) && <option value={String(v.zoom)}>{Math.round(v.zoom * 100)}%</option>}
        </select>
        <button className={`vb${v.safe ? ' on' : ''}`} onClick={() => setView({ safe: !v.safe })} title="Title and action safe (')">Safe</button>
        <button className={`vb${v.grid ? ' on' : ''}`} onClick={() => setView({ grid: !v.grid })} title="Grid (Ctrl+')">Grid</button>
        <button className={`vb${v.thirds ? ' on' : ''}`} onClick={() => setView({ thirds: !v.thirds })} title="Rule of thirds">Thirds</button>
        <button className={`vb${v.rulers ? ' on' : ''}`} onClick={() => setView({ rulers: !v.rulers })} title="Rulers (Ctrl+R)">Rulers</button>
        <button className={`vb${v.guides ? ' on' : ''}`} onClick={() => setView({ guides: !v.guides })} title="Show guides (Ctrl+;)">Guides</button>
        <button className={`vb${v.lockGuides ? ' on' : ''}`} onClick={() => setView({ lockGuides: !v.lockGuides })} title="Lock guides">Lock</button>
        {guides.length > 0 && <button className="vb" onClick={() => changeScene('Clear guides', (s) => ({ ...s, guides: [] }))}>Clear guides</button>}
        <span className="grow" />
        {barEnd}
      </div>
    </div>
  )
}
