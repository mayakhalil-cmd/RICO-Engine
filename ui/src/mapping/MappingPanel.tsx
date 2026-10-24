import { Hint } from '../components/Tips'
import { Suspense, lazy, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import MaskMaker from './MaskMaker'
import Icon from '../components/Icon'
import PopMenu from '../components/PopMenu'
import RIcon from '../components/RIcons'
import Scrub from '../components/Scrub'
import { toast } from '../components/Toasts'
import { onSharedChange, pictureLabel, pictureNames, sharedVersion } from '../engine/shared'
import { collectSources, openOutput, useOutputs } from '../shell/outputs'
import { solve, type V3 } from './calib'
import Stencil from './Stencil'
import { ToolBtn, ToolGroup } from '../components/ToolStrip'
import { MOVE_STEPS, setSnap, useSnap } from '../shell/snap'
import MapOverlay, { type Pick } from './MapOverlay'
import {
  alignPoints, knownOutputs, meshAt, meshPoints, moveInStack, newMask, stackOf, stackGroups, stepGroup, attachMask, moveGroup, type StackItem, newSurface, outputName, projectorPicture, quadPoints, setMap, updateMask, updateSurface, useMap,
  type OutputMap, type P2, type Surface,
} from './model'
import { MapRenderer } from './render'

// Projection mapping: surfaces warped onto what you project
// on, masks, soft edges, 3D objects mapped from a calibrated projector, and
// printable gobos made from the result.

const Viewport3D = lazy(() => import('../three/Panels').then((m) => ({ default: m.Viewport3D })))

function Preview({ out, pick, onPick }: { out: string; pick: Pick | null; onPick: (p: Pick | null) => void }) {
  const map = useMap(out)
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const [problem, setProblem] = useState('')
  useEffect(() => {
    const c = canvas.current!
    let r: MapRenderer | null = null
    try { r = new MapRenderer(c) } catch (e) { setProblem((e as Error).message) }
    let raf = 0
    let last = 0
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop)
      if (t - last < 33) return
      last = t
      const w = Math.round(c.clientWidth * Math.min(2, devicePixelRatio)), h = Math.round(c.clientHeight * Math.min(2, devicePixelRatio))
      if (w && h && (c.width !== w || c.height !== h)) { c.width = w; c.height = h }
      const m = mapRef.current
      const names = [...new Set(m.surfaces.filter((s) => s.on).map((s) => s.source))]
      try { r?.render(m, collectSources(names), outputName(out)) } catch { /* lost context */ }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [out])
  const mapRef = useRef<OutputMap>(map)
  mapRef.current = map
  return (
    <div className="mp-preview" style={{ aspectRatio: `${map.res[0]} / ${map.res[1]}`, width: `min(100%, calc(56vh * ${(map.res[0] / map.res[1]).toFixed(4)}))` }}>
      <canvas ref={canvas} />
      <MapOverlay out={out} pick={pick} onPick={onPick} />
      {problem && <div className="error">{problem}</div>}
    </div>
  )
}

// The size of the projector's picture: pick a common size, type your own,
// or let the output window set it.
const SIZES: [number, number, string][] = [[1920, 1080, 'Full HD'], [1280, 720, 'HD'], [3840, 2160, '4K'], [1920, 1200, 'WUXGA'], [1280, 800, 'WXGA'], [1024, 768, 'XGA, 4:3'], [1400, 1050, 'SXGA+, 4:3'], [2560, 1600, 'WQXGA']]
function CanvasSize({ map, setM }: { map: OutputMap; setM: (fn: (m: OutputMap) => OutputMap, label?: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement | null>(null)
  const setRes = (w: number, h: number) => setM((m) => ({ ...m, res: [Math.max(64, Math.round(w)), Math.max(64, Math.round(h))], resFixed: true }), 'Canvas size')
  return (
    <>
      <button ref={ref} className="ts-label mp-size" title="The size of the projector's picture. Click to change it" onClick={() => setOpen(!open)}>{map.res[0]} x {map.res[1]} px{map.resFixed ? '' : ' (window)'}</button>
      {open && (
        <PopMenu anchor={ref} onClose={() => setOpen(false)} className="mp-size-menu">
          <div className="menu-head">Canvas size</div>
          <div className="menu-row row">
            <label className="gen-num"><span>Width</span><Scrub value={map.res[0]} step={1} digits={0} min={64} max={16384} suffix=" px" onChange={(v) => setRes(v, map.res[1])} /></label>
            <label className="gen-num"><span>Height</span><Scrub value={map.res[1]} step={1} digits={0} min={64} max={16384} suffix=" px" onChange={(v) => setRes(map.res[0], v)} /></label>
          </div>
          {SIZES.map(([w, h, n]) => <button key={n} role="menuitem" className={map.res[0] === w && map.res[1] === h ? 'on' : ''} onClick={() => { setRes(w, h); setOpen(false) }}><span>{n}</span><span className="dim">{w} x {h}</span></button>)}
          <button role="menuitem" onClick={() => { setRes(map.res[1], map.res[0]); setOpen(false) }}><span>Turn it (portrait)</span></button>
          <hr />
          <button role="menuitemcheckbox" aria-checked={!map.resFixed} onClick={() => { setM((m) => ({ ...m, resFixed: !m.resFixed }), 'Canvas size'); setOpen(false) }}><span>Follow the output window</span><span className="dim">{map.resFixed ? 'off' : 'on'}</span></button>
          <p className="menu-note">Pick your projector's real size, so the picture here has the same shape as on the wall.</p>
        </PopMenu>
      )}
    </>
  )
}

function Num({ label, value, set, min, max, step, digits = 2, suffix }: { label: string; value: number; set: (v: number) => void; min?: number; max?: number; step: number; digits?: number; suffix?: string }) {
  return <label className="gen-num"><span>{label}</span><Scrub value={value} step={step} digits={digits} min={min} max={max} suffix={suffix} onChange={set} /></label>
}

function SurfaceEditor({ out, s, sources }: { out: string; s: Surface; sources: string[] }) {
  const up = (p: Partial<Surface>) => updateSurface(out, s.id, p)
  const regrid = (cols: number, rows: number) => {
    const pts: P2[] = []
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const u = c / (cols - 1), v = r / (rows - 1)
      pts.push(meshAt(s, u, v))
    }
    up({ cols, rows, points: pts })
  }
  return (
    <div className="mp-edit">
      <div className="row wrap">
        <input className="input" value={s.name} onChange={(e) => up({ name: e.target.value })} style={{ width: 140 }} />
        <select className="select" value={s.source} onChange={(e) => up({ source: e.target.value })}>
          {sources.map((n) => <option key={n} value={n}>{n === 'test' ? 'Test pattern' : n === 'solid' ? 'Solid color' : n === '3D' ? '3D playground camera' : pictureLabel(n)}</option>)}
        </select>
        {s.source === 'solid' && <input type="color" className="swatch" value={s.color} onChange={(e) => up({ color: e.target.value })} />}
        <select className="select mini" value={s.blend} onChange={(e) => up({ blend: e.target.value as Surface['blend'] })}><option value="normal">Normal</option><option value="add">Add (overlap glows)</option></select>
        <label className="mini-check"><input type="checkbox" checked={s.flipX} onChange={(e) => up({ flipX: e.target.checked })} />Flip X</label>
        <label className="mini-check"><input type="checkbox" checked={s.flipY} onChange={(e) => up({ flipY: e.target.checked })} />Flip Y</label>
      </div>
      <div className="mp-grid">
        <fieldset><legend>Warp</legend>
          <label className="gen-num"><span>Kind</span>
            <select className="select mini" value={s.kind} onChange={(e) => {
              if (e.target.value === 'mesh') up({ kind: 'mesh', cols: 4, rows: 4, points: meshPoints(4, 4, s.points) })
              else {
                const o = [s.points[0], s.points[s.cols - 1], s.points[s.points.length - 1], s.points[(s.rows - 1) * s.cols]]
                up({ kind: 'quad', points: o })
              }
            }}><option value="quad">4 corners</option><option value="mesh">Grid (curved surfaces)</option></select></label>
          {s.kind === 'mesh' && <>
            <Num label="Columns" value={s.cols} set={(v) => regrid(Math.max(2, Math.round(v)), s.rows)} min={2} max={16} step={0.05} digits={0} />
            <Num label="Rows" value={s.rows} set={(v) => regrid(s.cols, Math.max(2, Math.round(v)))} min={2} max={16} step={0.05} digits={0} />
          </>}
          <div className="row wrap">
            <button className="btn small quiet" onClick={() => up({ points: s.kind === 'quad' ? quadPoints(0, 0, 1, 1) : meshPoints(s.cols, s.rows, quadPoints(0, 0, 1, 1)) })}>Fill the output</button>
            <button className="btn small quiet" onClick={() => up({ points: alignPoints(s.points, 'center') })}>Center</button>
            <button className="btn small quiet" onClick={() => up({ points: alignPoints(s.points, 'fit') })}>Fit, same shape</button>
            <button className="btn small quiet" onClick={() => up({ points: s.kind === 'quad' ? quadPoints() : meshPoints(s.cols, s.rows) })}>Reset</button>
          </div>
        </fieldset>
        <fieldset><legend>Part of the picture</legend>
          <Num label="Left" value={s.crop[0]} set={(v) => up({ crop: [v, s.crop[1], s.crop[2], s.crop[3]] })} min={0} max={1} step={0.002} digits={3} />
          <Num label="Top" value={s.crop[1]} set={(v) => up({ crop: [s.crop[0], v, s.crop[2], s.crop[3]] })} min={0} max={1} step={0.002} digits={3} />
          <Num label="Right" value={s.crop[2]} set={(v) => up({ crop: [s.crop[0], s.crop[1], v, s.crop[3]] })} min={0} max={1} step={0.002} digits={3} />
          <Num label="Bottom" value={s.crop[3]} set={(v) => up({ crop: [s.crop[0], s.crop[1], s.crop[2], v] })} min={0} max={1} step={0.002} digits={3} />
        </fieldset>
        <fieldset><legend>Color</legend>
          <Num label="Opacity" value={s.opacity} set={(v) => up({ opacity: v })} min={0} max={1} step={0.005} />
          <Num label="Brightness" value={s.brightness} set={(v) => up({ brightness: v })} min={0} max={4} step={0.005} />
          <Num label="Contrast" value={s.contrast} set={(v) => up({ contrast: v })} min={0} max={3} step={0.005} />
          <Num label="Gamma" value={s.gamma} set={(v) => up({ gamma: v })} min={0.2} max={4} step={0.005} />
          <Num label="Hue" value={s.hue} set={(v) => up({ hue: v })} min={-0.5} max={0.5} step={0.002} digits={3} />
          <Num label="Soft edge" value={s.feather} set={(v) => up({ feather: v })} min={0} max={0.5} step={0.001} digits={3} />
        </fieldset>
      </div>
    </div>
  )
}

function Calibrate({ out }: { out: string }) {
  const map = useMap(out)
  const [picking, setPicking] = useState(false)
  const [engine, setEngine] = useState<typeof import('../three/engine') | null>(null)
  useEffect(() => { void import('../three/engine').then(setEngine) }, [])
  useEffect(() => {
    if (!engine) return
    engine.setMarkers(map.pairs.map((p) => p.p))
    return () => engine.setMarkers([])
  }, [engine, map.pairs])
  useEffect(() => {
    if (!engine) return
    if (!picking) { engine.setPointPicker(null); return }
    engine.setPointPicker((p: V3) => {
      setMap(out, (m) => {
        const pairs = [...m.pairs, { p, uv: [0.5 + (m.pairs.length % 5) * 0.04 - 0.08, 0.5 + Math.floor(m.pairs.length / 5) * 0.06 - 0.06] as [number, number] }]
        return { ...m, pairs, showPoints: true, solved: solve(pairs, m.res[0], m.res[1]) }
      })
      setPicking(false)
      toast('Now drag the new numbered cross (on the projector, or here) onto the same spot of the real object.', true)
    })
    return () => engine.setPointPicker(null)
  }, [engine, picking, out])
  // Solve again whenever a point moves.
  const key = JSON.stringify(map.pairs) + map.res.join()
  useEffect(() => {
    const solved = solve(map.pairs, map.res[0], map.res[1])
    if (JSON.stringify(solved) !== JSON.stringify(map.solved)) setMap(out, (m) => ({ ...m, solved }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return (
    <div className="mp-calib">
      <ol className="small muted">
        <li>Build or import the object in the 3D playground at its real size (a .glb from Blender, or boxes and shapes).</li>
        <li>Press <b>Add point</b>, then click a corner or clear spot of the object below.</li>
        <li>Drag the numbered cross on the projector (or on the preview) onto the same spot of the real object. Arrow keys move it one pixel.</li>
        <li>After six points spread around the object (not all on one flat side), RICO finds the projector. Use "3D from {outputName(out)}" as a surface's picture.</li>
      </ol>
      <div className="mp-calib-view"><Suspense fallback={<p className="dim">Loading 3D...</p>}><Viewport3D /></Suspense></div>
      <div className="row wrap">
        <button className={`btn small ${picking ? 'out' : 'primary'}`} onClick={() => setPicking(!picking)}>{picking ? 'Click the object...' : '+ Add point'}</button>
        <label className="mini-check"><input type="checkbox" checked={map.showPoints} onChange={(e) => setMap(out, (m) => ({ ...m, showPoints: e.target.checked }))} />Show crosses on the projector</label>
        <button className="btn small quiet" disabled={!map.pairs.length} onClick={() => setMap(out, (m) => ({ ...m, pairs: [], solved: null }))}>Clear points</button>
        <span className={`small ${map.solved ? (map.solved.error < 3 ? 'lime' : 'warn-text') : 'dim'}`}>
          {map.solved ? `Projector found. Points are off by ${map.solved.error.toFixed(1)} px on average${map.solved.error > 5 ? ': move them more carefully, or add more' : ''}.` : `${map.pairs.length} of 6 points`}
        </span>
      </div>
      {map.pairs.length > 0 && (
        <table className="ms-table">
          <thead><tr><th>#</th><th>On the object (x, y, z)</th><th>On the projector (px)</th><th /></tr></thead>
          <tbody>{map.pairs.map((p, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>{p.p.map((v) => v.toFixed(3)).join(', ')}</td>
              <td>{Math.round(p.uv[0] * map.res[0])}, {Math.round(p.uv[1] * map.res[1])}</td>
              <td><button className="icon-btn small danger" onClick={() => setMap(out, (m) => ({ ...m, pairs: m.pairs.filter((_, j) => j !== i) }))}><Icon name="x" /></button></td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  )
}

// A section of the page that opens and closes (and remembers it).
const openSec = (id: string) => window.dispatchEvent(new CustomEvent('rico-mapsec', { detail: id }))

function Sec({ id, title, sub, children, start = true }: { id: string; title: string; sub?: string; children: () => React.ReactNode; start?: boolean }) {
  const k = `rico.mapsec.${id}`
  const [open, setOpen] = useState(() => { try { const v = localStorage.getItem(k); return v === null ? start : v === '1' } catch { return start } })
  const ref = useRef<HTMLDetailsElement | null>(null)
  useEffect(() => {
    const on = (e: Event) => { if ((e as CustomEvent).detail === id) { setOpen(true); try { localStorage.setItem(k, '1') } catch { /* fine */ } window.setTimeout(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30) } }
    window.addEventListener('rico-mapsec', on)
    return () => window.removeEventListener('rico-mapsec', on)
  }, [id, k])
  return (
    <details ref={ref} className="mp-sec" open={open} onToggle={(e) => { const o = (e.currentTarget as HTMLDetailsElement).open; setOpen(o); try { localStorage.setItem(k, o ? '1' : '0') } catch { /* fine */ } }}>
      <summary><h3>{title}</h3>{sub && <span className="dim small">{sub}</span>}</summary>
      {open && <div className="mp-sec-body">{children()}</div>}
    </details>
  )
}

// the layer stack: surfaces and masks, top first, like Photoshop
function Layers({ out, map, pick, setPick, sources, setM }: {
  out: string; map: OutputMap; pick: Pick | null; setPick: (p: Pick | null) => void; sources: string[]
  setM: (fn: (m: OutputMap) => OutputMap, label?: string) => void
}) {
  const [photo, setPhoto] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const [over, setOver] = useState<{ id: string; place: 'above' | 'below' | 'into' } | null>(null)
  useEffect(() => { const on = () => setPhoto(true); window.addEventListener('rico-layers-picture', on); return () => window.removeEventListener('rico-layers-picture', on) }, [])
  // top first, each surface followed by the masks clipped to it (under it, like Photoshop)
  const groups = [...stackGroups(map)].reverse()
  const top: (StackItem & { child?: boolean; parent?: string })[] = groups.flatMap((g) => [g.head, ...[...g.clips].reverse().map((id) => ({ kind: 'mask' as const, id, child: true, parent: g.head.id }))])
  const clipOf = new Set(top.filter((x) => x.child).map((x) => x.id))
  const dragIsMask = Boolean(dragId && map.masks.some((k) => k.id === dragId))
  const pickedSurface = pick?.kind === 'surface' ? map.surfaces.find((x) => x.id === pick.id) : undefined
  const pickedMask = pick?.kind === 'mask' ? map.masks.find((x) => x.id === pick.id) : undefined
  // a new layer goes right above the picked one (or on top)
  const addAbove = (id: string, mm: OutputMap) => (pick ? moveInStack(mm, id, pick.id, 'above') : mm)
  const addSurface = (mesh: boolean) => {
    const s = mesh ? newSurface({ name: `Grid ${map.surfaces.length + 1}`, kind: 'mesh', cols: 4, rows: 4, points: meshPoints(4, 4) }) : newSurface({ name: `Surface ${map.surfaces.length + 1}` })
    setM((m) => addAbove(s.id, { ...m, order: stackOf(m).map((x) => x.id), surfaces: [...m.surfaces, s] }), 'Add surface')
    setPick({ kind: 'surface', id: s.id, point: -1 })
  }
  // a new mask goes under the picked surface (clipped to it), like a layer mask
  const addMask = () => {
    const k = newMask({ name: `Mask ${map.masks.length + 1}` })
    const target = pick?.kind === 'surface' ? pick.id : pick?.kind === 'mask' ? top.find((x) => x.id === pick.id)?.parent : undefined
    setM((m) => {
      const mm = { ...m, order: stackOf(m).map((x) => x.id), masks: [...m.masks, k] }
      return target ? attachMask(mm, k.id, target) : addAbove(k.id, mm)
    }, 'Add mask')
    setPick({ kind: 'mask', id: k.id, point: -1 })
  }
  const step = (id: string, d: 1 | -1) => setM((m) => stepGroup(m, id, d), 'Layer order')
  const remove = (it: StackItem) => setM((m) => (it.kind === 'surface' ? { ...m, surfaces: m.surfaces.filter((x) => x.id !== it.id) } : { ...m, masks: m.masks.filter((x) => x.id !== it.id) }), 'Delete layer')
  return (
    <>
      <div className="row wrap">
        <button className="btn small primary" onClick={() => addSurface(false)}>+ Surface</button>
        <button className="btn small quiet" onClick={() => addSurface(true)}>+ Grid surface</button>
        <button className="btn small primary" onClick={addMask}>+ Mask</button>
        <button className={`btn small ${photo ? 'primary' : 'quiet'}`} onClick={() => setPhoto(!photo)}>Mask from a picture</button>
      </div>
      <Hint label="How layers work" text="Top of the list is in front. A mask sits under the surface it masks, like a layer mask: drop a mask on a surface to put it there. A mask on its own (not under a surface) darkens every layer below it. Drag to change the order: a surface moves with its masks." />
      <ul className="ly-list" role="list">
        {top.map((it) => {
          const s = it.kind === 'surface' ? map.surfaces.find((x) => x.id === it.id)! : undefined
          const k = it.kind === 'mask' ? map.masks.find((x) => x.id === it.id)! : undefined
          const item = (s ?? k)!
          const on = pick?.id === it.id
          return (
            <li key={it.id} draggable
              className={`ly-row ${it.kind}${on ? ' on' : ''}${item.locked ? ' locked' : ''}${clipOf.has(it.id) ? ' clip' : ''}${over?.id === it.id ? ` drop-${over.place}` : ''}${dragId === it.id ? ' dragging' : ''}`}
              title={clipOf.has(it.id) ? `Masks ${map.surfaces.find((x) => x.id === it.parent)?.name ?? 'the surface above'}` : undefined}
              onClick={() => setPick({ kind: it.kind, id: it.id, point: -1 })}
              onDragStart={(e) => { setDragId(it.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', it.id) }}
              onDragEnd={() => { setDragId(null); setOver(null) }}
              onDragOver={(e) => { if (!dragId || dragId === it.id) return; e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); const y = (e.clientY - r.top) / r.height; setOver({ id: it.id, place: it.kind === 'surface' && dragIsMask && y > 0.3 && y < 0.7 ? 'into' : y < 0.5 ? 'above' : 'below' }) }}
              onDrop={(e) => {
                e.preventDefault()
                if (dragId && over) setM((m) => {
                  // a mask dropped on a surface goes under it; anything else moves above or below
                  if (over.place === 'into') return attachMask(m, dragId, over.id)
                  const target = top.find((x) => x.id === over.id)
                  if (target?.child && dragIsMask) return attachMask(m, dragId, target.parent!)
                  return moveGroup(m, dragId, target?.child ? target.parent! : over.id, over.place)
                }, 'Layer order')
                setDragId(null); setOver(null)
              }}>
              <input type="checkbox" checked={item.on} title="Show it" onClick={(e) => e.stopPropagation()}
                onChange={(e) => (s ? updateSurface(out, s.id, { on: e.target.checked }) : updateMask(out, k!.id, { on: e.target.checked }))} />
              {clipOf.has(it.id) && <span className="ly-clip" aria-hidden="true">{'\u21B3'}</span>}
              <RIcon name={s ? (s.kind === 'mesh' ? 'gridSurface' : 'surface') : 'mask'} size={14} />
              <input className="input mini-name ly-name" value={item.name} onClick={(e) => e.stopPropagation()}
                onChange={(e) => (s ? updateSurface(out, s.id, { name: e.target.value }) : updateMask(out, k!.id, { name: e.target.value }))} />
              <span className="dim small ly-kind">{s ? pictureLabel(s.source) : k!.invert ? 'light only inside' : 'blocks light'}</span>
              {k && <button className={`btn small ${clipOf.has(k.id) ? 'primary' : 'quiet'}`} title={clipOf.has(k.id) ? 'Masks only the surface it is under. Click to let it mask everything below it.' : 'Masks everything below it. Click to put it under the surface below, so it masks only that one.'}
                onClick={(e) => {
                  e.stopPropagation()
                  setM((m) => {
                    if (clipOf.has(k.id)) return moveGroup(m, k.id, it.parent!, 'above')
                    // under the nearest surface below it
                    const below = [...stackGroups(m)].reverse()
                    const me = below.findIndex((g) => g.head.id === k.id)
                    const s2 = below.slice(me + 1).find((g) => g.head.kind === 'surface')
                    return s2 ? attachMask(m, k.id, s2.head.id) : m
                  }, 'Mask')
                }}>Clip</button>}
              <LockBtn on={item.locked} set={(locked) => (s ? updateSurface(out, s.id, { locked }) : updateMask(out, k!.id, { locked }))} />
              <button className="icon-btn small" title="Down (further back)" onClick={(e) => { e.stopPropagation(); step(it.id, -1) }}><Icon name="down" /></button>
              <button className="icon-btn small" title="Up (further front)" onClick={(e) => { e.stopPropagation(); step(it.id, 1) }}><Icon name="up" /></button>
              <button className="icon-btn small danger" disabled={item.locked} title="Delete" onClick={(e) => { e.stopPropagation(); remove(it) }}><Icon name="x" /></button>
            </li>
          )
        })}
      </ul>
      {pickedSurface && <SurfaceEditor out={out} s={pickedSurface} sources={sources} />}
      {pickedMask && (
        <div className="mp-edit">
          <div className="row wrap gap">
            <label className="mini-check"><input type="checkbox" checked={pickedMask.invert} onChange={(e) => updateMask(out, pickedMask.id, { invert: e.target.checked })} />Light only inside (inverted)</label>
            <label className="mini-check"><input type="checkbox" checked={Boolean(pickedMask.clip)} onChange={(e) => updateMask(out, pickedMask.id, { clip: e.target.checked })} />Clip to the layer under it</label>
            <label className="mini">Feather <Scrub value={pickedMask.feather} step={0.2} digits={0} suffix=" px" min={0} max={200} onChange={(v) => updateMask(out, pickedMask.id, { feather: v })} /></label>
            <button className="btn small quiet" disabled={pickedMask.locked} onClick={() => {
              const at = pick && pick.point >= 0 ? pick.point : pickedMask.points.length - 1
              const a = pickedMask.points[at], b = pickedMask.points[(at + 1) % pickedMask.points.length]
              const pts = [...pickedMask.points]
              pts.splice(at + 1, 0, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])
              updateMask(out, pickedMask.id, { points: pts })
            }}>+ Point</button>
            <span className="dim small">Double-click a point to remove it.</span>
          </div>
        </div>
      )}
      {photo && <div className="ly-photo"><MaskMaker out={out} /></div>}
    </>
  )
}

function LockBtn({ on, set }: { on?: boolean; set: (v: boolean) => void }) {
  return <button className={`icon-btn small${on ? ' on' : ''}`} title={on ? 'Locked: it cannot be moved or deleted. Click to unlock.' : 'Lock it in place'} aria-pressed={Boolean(on)} onClick={(e) => { e.stopPropagation(); set(!on) }}><Icon name="lock" /></button>
}

export default function MappingPanel() {
  useSyncExternalStore(onSharedChange, sharedVersion)
  useOutputs()
  const [out, setOut] = useState(() => knownOutputs()[0] ?? 'out1')
  const map = useMap(out)
  const [pick, setPick] = useState<Pick | null>(null)
  const outs = [...new Set([...knownOutputs(), out])].sort()
  const sel = map.surfaces.find((s) => pick?.kind === 'surface' && s.id === pick.id) ?? map.surfaces[0]
  const sources = ['Create', '3D', ...pictureNames().filter((n) => n !== 'Create'), projectorPicture(out), 'test', 'solid'].filter((v, i, a) => a.indexOf(v) === i)
  const setM = (fn: (m: OutputMap) => OutputMap, label?: string) => setMap(out, fn, true, label)
  const snap = useSnap('mapping')
  const pickedItem = pick ? (pick.kind === 'surface' ? map.surfaces.find((x) => x.id === pick.id) : map.masks.find((x) => x.id === pick.id)) : undefined
  const pickedLocked = Boolean(pickedItem?.locked)
  const toggleLock = () => {
    if (!pick || !pickedItem) return toast('Click a surface or a mask first.')
    if (pick.kind === 'surface') updateSurface(out, pick.id, { locked: !pickedItem.locked }); else updateMask(out, pick.id, { locked: !pickedItem.locked })
  }
  // lines up what is picked with the output: centered, filling it, or against an edge
  const align = (how: Parameters<typeof alignPoints>[1]) => {
    if (!pick || !pickedItem) return toast('Click a surface or a mask first.')
    if (pickedItem.locked) return toast('It is locked. Unlock it first.')
    const pts = alignPoints(pickedItem.points, how)
    if (pick.kind === 'surface') setM((m) => ({ ...m, surfaces: m.surfaces.map((x) => (x.id === pick.id ? { ...x, points: pts } : x)) }), 'Line up')
    else setM((m) => ({ ...m, masks: m.masks.map((x) => (x.id === pick.id ? { ...x, points: pts } : x)) }), 'Line up')
  }
  const ALIGN: { id: Parameters<typeof alignPoints>[1]; icon: string; label: string }[] = [
    { id: 'center', icon: 'alignCenter', label: 'In the middle of the output' },
    { id: 'fill', icon: 'alignFill', label: 'Fill the whole output' },
    { id: 'fit', icon: 'alignFill', label: 'As big as it fits, same shape, in the middle' },
    { id: 'hcenter', icon: 'alignCenter', label: 'In the middle, left to right' },
    { id: 'vcenter', icon: 'alignCenter', label: 'In the middle, top to bottom' },
    { id: 'left', icon: 'alignLeft', label: 'Against the left edge' },
    { id: 'right', icon: 'alignRight', label: 'Against the right edge' },
    { id: 'top', icon: 'alignTop', label: 'Against the top edge' },
    { id: 'bottom', icon: 'alignBottom', label: 'Against the bottom edge' },
  ]
  const deletePicked = () => {
    if (!pick || !pickedItem) return toast('Click a surface or a mask first.')
    if (pickedItem.locked) return toast('It is locked. Unlock it first.')
    if (pick.kind === 'surface') setM((m) => ({ ...m, surfaces: m.surfaces.filter((x) => x.id !== pick.id) }), 'Delete surface')
    else setM((m) => ({ ...m, masks: m.masks.filter((x) => x.id !== pick.id) }), 'Delete mask')
    setPick(null)
  }

  return (
    <div className="dpanel mp">
      <div className="tool-strip mp-strip" role="toolbar" aria-label="Mapping tools">
        <select className="select mini mp-out" value={out} onChange={(e) => { setOut(e.target.value); setPick(null) }} title="Which output (one per projector)">
          {outs.map((id) => <option key={id} value={id}>{outputName(id)}</option>)}
        </select>
        <ToolBtn t={{ id: 'addout', icon: 'plus', label: 'Another output (for another projector)', run: () => { let n = 1; while (outs.includes(`out${n}`)) n++; setOut(`out${n}`); setMap(`out${n}`, (m) => ({ ...m })) } }} />
        <ToolBtn t={{ id: 'open', icon: 'projector', label: 'Open its window (drag it to the projector, double-click for full screen)', run: () => openOutput(out) }} />
        <ToolBtn t={{ id: 'test', icon: 'pattern', label: 'Test pattern', on: map.test, run: () => setM((m) => ({ ...m, test: !m.test }), 'Test pattern') }} />
        <i className="ts-sep" />
        <ToolBtn t={{ id: 'surf', icon: 'surface', label: 'New 4-corner surface', run: () => { const s2 = newSurface({ name: `Surface ${map.surfaces.length + 1}` }); setM((m) => ({ ...m, surfaces: [...m.surfaces, s2] }), 'Add surface'); setPick({ kind: 'surface', id: s2.id, point: -1 }) } }} />
        <ToolBtn t={{ id: 'grid', icon: 'gridSurface', label: 'New grid surface (for curved things)', run: () => { const s2 = newSurface({ name: `Grid ${map.surfaces.length + 1}`, kind: 'mesh', cols: 4, rows: 4, points: meshPoints(4, 4) }); setM((m) => ({ ...m, surfaces: [...m.surfaces, s2] }), 'Add surface'); setPick({ kind: 'surface', id: s2.id, point: -1 }) } }} />
        <ToolBtn t={{ id: 'mask', icon: 'mask', label: 'New mask', run: () => { const k = newMask({ name: `Mask ${map.masks.length + 1}` }); setM((m) => ({ ...m, masks: [...m.masks, k] }), 'Add mask'); setPick({ kind: 'mask', id: k.id, point: -1 }) } }} />
        <ToolBtn t={{ id: 'dup', icon: 'duplicate', label: 'Duplicate the picked surface', run: () => { if (!sel) return; const c = { ...JSON.parse(JSON.stringify(sel)), id: newSurface().id, name: `${sel.name} copy`, locked: false, points: sel.points.map(([x, y]) => [x + 0.03, y + 0.03]) }; setM((m) => ({ ...m, surfaces: [...m.surfaces, c] }), 'Duplicate surface'); setPick({ kind: 'surface', id: c.id, point: -1 }) } }} />
        <ToolBtn t={{ id: 'lock', icon: pickedLocked ? 'lock' : 'unlock', label: pickedLocked ? 'Unlock what is picked' : 'Lock what is picked', on: pickedLocked, run: toggleLock }} />
        <ToolBtn t={{ id: 'del', icon: 'trash', label: 'Delete what is picked', run: deletePicked }} />
        <i className="ts-sep" />
        <ToolGroup label="Handles" tone="pink">
          {([['move', 'move', 'Move', 'W'], ['rotate', 'rotate', 'Turn', 'E'], ['scale', 'scale', 'Size', 'R'], ['all', 'all', 'All', 'Q']] as const).map(([h, icon, label, key]) => <ToolBtn key={h} t={{ id: h, icon, label, key, on: snap.handles === h, run: () => setSnap('mapping', { handles: h }) }} />)}
        </ToolGroup>
        <ToolBtn t={{ id: 'align', icon: 'alignCenter', label: 'Center what is picked (more: fill, fit, edges)', run: () => align('center'), more: ALIGN.map((a) => ({ id: a.id, icon: a.icon, label: a.label, run: () => align(a.id) })) }} />
        <ToolBtn t={{ id: 'edges', icon: 'edges', label: `Snap to the edges, the middle and other shapes while you drag (${snap.edges !== false ? 'on' : 'off'}). Alt drags freely.`, on: snap.edges !== false, run: () => setSnap('mapping', { edges: snap.edges === false }) }} />
        <ToolBtn t={{ id: 'snap', icon: 'magnet', label: `Snap moves to ${snap.moveStep} px (${snap.move ? 'on' : 'off'})`, on: snap.move, run: () => setSnap('mapping', { move: !snap.move }), more: MOVE_STEPS.mapping.map((v) => ({ id: String(v), icon: 'grid', label: `${v} px`, on: snap.moveStep === v, run: () => setSnap('mapping', { moveStep: v, move: true }) })) }} />
        <i className="ts-sep" />
        <ToolBtn t={{ id: 'photo', icon: 'photo', label: 'Mask from a picture', run: () => (window.dispatchEvent(new CustomEvent('rico-mapsec', { detail: 'surfaces' })), window.dispatchEvent(new CustomEvent('rico-layers-picture'))) }} />
        <ToolBtn t={{ id: 'calib', icon: 'cube', label: '3D objects: calibrate the projector', run: () => openSec('calib') }} />
        <ToolBtn t={{ id: 'sten', icon: 'stencil', label: 'Gobos: plates for the lens, to print or laser cut', run: () => openSec('stencil') }} />
        <ToolBtn t={{ id: 'edges', icon: 'sun', label: 'Edges and brightness', run: () => openSec('edges') }} />
        <span className="grow" />
        <CanvasSize map={map} setM={setM} />
      </div>

      <div className="mp-cols">
        <div className="mp-stage">
          <Preview out={out} pick={pick} onPick={setPick} />
          <Hint label="How to map" docs="WORKSPACES.md#projection-mapping" text="Drag points on the preview, or on the projector (press E there). Click a surface or mask, then W moves, E turns, R sizes and Q shows all three. Arrow keys nudge one pixel (Shift: ten). Delete removes what is picked. Ctrl+Z undoes." />
        </div>
        <div className="mp-side">
          <Sec id="surfaces" title={`Layers (${map.surfaces.length + map.masks.length})`} sub="Surfaces and masks in one stack. Each mask sits under the surface it masks and moves with it">{() => (
            <Layers out={out} map={map} pick={pick} setPick={setPick} sources={sources} setM={setM} />
          )}</Sec>

          <Sec id="edges" title="Edges and brightness" sub="Blend two projectors, dim the whole output" start={false}>{() => (
            <div className="mp-grid">
              <fieldset><legend>Whole output</legend>
                <Num label="Brightness" value={map.brightness} set={(v) => setM((m) => ({ ...m, brightness: v }), 'Brightness')} min={0} max={2} step={0.005} />
              </fieldset>
              <fieldset><legend>Soft edges</legend>
                <Num label="Left" value={map.softLeft} set={(v) => setM((m) => ({ ...m, softLeft: v }), 'Soft edge')} min={0} max={0.5} step={0.001} digits={3} />
                <Num label="Right" value={map.softRight} set={(v) => setM((m) => ({ ...m, softRight: v }), 'Soft edge')} min={0} max={0.5} step={0.001} digits={3} />
                <Num label="Top" value={map.softTop} set={(v) => setM((m) => ({ ...m, softTop: v }), 'Soft edge')} min={0} max={0.5} step={0.001} digits={3} />
                <Num label="Bottom" value={map.softBottom} set={(v) => setM((m) => ({ ...m, softBottom: v }), 'Soft edge')} min={0} max={0.5} step={0.001} digits={3} />
                <Num label="Curve (gamma)" value={map.softGamma} set={(v) => setM((m) => ({ ...m, softGamma: v }), 'Soft edge')} min={0.5} max={4} step={0.01} />
              </fieldset>
            </div>
          )}</Sec>
          <Sec id="calib" title="3D objects" sub="Calibrate the projector on a real object, then map the 3D scene onto it" start={false}>{() => <Calibrate out={out} />}</Sec>
          <Sec id="stencil" title="Gobos" sub="Plates for the lens that block light outside your masks, one for each projector. Print or laser cut them" start={false}>{() => <Stencil out={out} />}</Sec>
        </div>
      </div>

    </div>
  )
}
