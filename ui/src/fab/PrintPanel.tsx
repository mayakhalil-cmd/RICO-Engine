import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import Icon from '../components/Icon'
import RIcon from '../components/RIcons'
import Scrub from '../components/Scrub'
import { toast } from '../components/Toasts'
import { ToolBtn } from '../components/ToolStrip'
import { downloadBlob, pickFile } from '../shell/ui'
import { clearWanted, useWanted } from './nav'
import { serialPorts, type Stream } from './net'
import { addStl, bedTriangles, onlyPart, placeAll, removeFile, updatePart, useBed, type Placed } from './parts'
import {
  addPrinter, applyModel, BEDS, currentPrinter, fileNameFor, MODELS, getSettings, klipperSignIn, LINKS, MATERIALS, newPrinter, printerCommand, printerStatus, QUALITY, removePrinter,
  sendToPrinter, setCurrent, setSettings, testPrinter, updatePrinter, usePrinters, type Printer, type PrinterStatus,
} from './printers'
import type { Gcode, Layer, PathKind, SupportBox } from './slicer'
import PrintSettingsBox from './PrintSettingsBox'
import { stopWatching, usbMarker, useJob, watch, type Watch } from './automation'
import { useGobos } from '../mapping/gobos'
import { useMapVersion } from '../mapping/model'

// The Print tab: a small slicer. Your gobos are on the bed already (and stay
// up to date with the gobo maker); open STL files too. Slice, look through
// the layers, then send it to your printer or save the G-code.

const COLORS: Record<PathKind, number> = { outer: 0x3bff03, inner: 0x1f9e00, solid: 0xffd23f, top: 0xff4d6d, infill: 0xff8a3d, skirt: 0x30e0ff, brim: 0x30e0ff, raft: 0x7a8a99, support: 0xb48cff, interface: 0xe0c8ff, ironing: 0xffffff }
const KIND_NAME: Record<PathKind, string> = { outer: 'Outer wall', inner: 'Inner walls', solid: 'Solid infill', top: 'Top surface', infill: 'Sparse infill', skirt: 'Skirt', brim: 'Brim', raft: 'Raft', support: 'Support', interface: 'Support interface', ironing: 'Ironing' }

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="ps-row" title={hint}><span>{label}</span><div>{children}</div></label>
}
function N({ value, set, min, max, step = 0.1, digits = 1, suffix = '' }: { value: number; set: (v: number) => void; min: number; max: number; step?: number; digits?: number; suffix?: string }) {
  return <Scrub value={value} step={step} digits={digits} min={min} max={max} suffix={suffix} onChange={set} />
}

// the bed in 3D: parts to drag, or the paths after slicing
function BedView({ bed, placed, layers, upto, show, onMove, boxes, boxTool, onBox, onMoveBox }: {
  bed: [number, number, number]; placed: Placed[]; layers: Layer[] | null; upto: number; show: 'parts' | 'paths'; onMove: (id: string, at: [number, number]) => void
  boxes: SupportBox[]; boxTool: 'enforce' | 'block' | null; onBox: (at: [number, number, number]) => void; onMoveBox: (id: string, at: [number, number]) => void
}) {
  const host = useRef<HTMLDivElement | null>(null)
  const ctx = useRef<{ r: THREE.WebGLRenderer; scene: THREE.Scene; cam: THREE.PerspectiveCamera; ctl: OrbitControls; draw: () => void; parts: THREE.Group; bedG: THREE.Group; boxG: THREE.Group; paths: THREE.LineSegments; layerEnds: number[] } | null>(null)
  const moveRef = useRef(onMove)
  moveRef.current = onMove
  const boxRef = useRef({ tool: boxTool, onBox, onMoveBox })
  boxRef.current = { tool: boxTool, onBox, onMoveBox }
  useEffect(() => {
    const el = host.current
    if (!el) return
    let r: THREE.WebGLRenderer
    try { r = new THREE.WebGLRenderer({ antialias: true }) } catch { return }
    r.setPixelRatio(Math.min(2, devicePixelRatio))
    el.appendChild(r.domElement)
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#101214')
    const cam = new THREE.PerspectiveCamera(35, 1, 1, 8000)
    cam.up.set(0, 0, 1)
    scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.3))
    const sun = new THREE.DirectionalLight(0xffffff, 1.6)
    sun.position.set(100, -160, 260)
    scene.add(sun)
    const bedG = new THREE.Group(), parts = new THREE.Group(), boxG = new THREE.Group()
    scene.add(bedG, parts, boxG)
    const paths = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true }))
    scene.add(paths)
    const ctl = new OrbitControls(cam, r.domElement)
    const draw = () => r.render(scene, cam)
    ctl.addEventListener('change', draw)
    const size = () => { const w = el.clientWidth, h = el.clientHeight; r.setSize(w, h); cam.aspect = w / Math.max(1, h); cam.updateProjectionMatrix(); draw() }
    const ro = new ResizeObserver(size)
    ro.observe(el)
    // drag a part along the bed
    const ray = new THREE.Raycaster()
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)
    let drag: { id: string; off: THREE.Vector3; obj: THREE.Object3D; box?: boolean } | null = null
    const ndc = (e: PointerEvent) => { const b = r.domElement.getBoundingClientRect(); return new THREE.Vector2(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1) }
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return
      ray.setFromCamera(ndc(e), cam)
      // a support box tool: a box where you click on the part
      if (boxRef.current.tool) {
        const ph = ray.intersectObjects(parts.children, false)[0]
        if (ph) { boxRef.current.onBox([ph.point.x, ph.point.y, ph.point.z]); return }
      }
      const bh = ray.intersectObjects(boxG.children.filter((o) => o.userData.box), false)[0]
      if (paths.visible && !bh) return
      const hit = bh ?? ray.intersectObjects(parts.children, false)[0]
      if (!hit) return
      const p = new THREE.Vector3()
      ray.ray.intersectPlane(plane, p)
      drag = bh ? { id: bh.object.userData.box as string, off: bh.object.position.clone().sub(p).setZ(0), obj: bh.object, box: true } : { id: hit.object.userData.id as string, off: hit.object.position.clone().sub(p), obj: hit.object }
      ctl.enabled = false
      r.domElement.setPointerCapture(e.pointerId)
    }
    const move = (e: PointerEvent) => {
      if (!drag) return
      ray.setFromCamera(ndc(e), cam)
      const p = new THREE.Vector3()
      if (!ray.ray.intersectPlane(plane, p)) return
      drag.obj.position.set(p.x + drag.off.x, p.y + drag.off.y, drag.box ? drag.obj.position.z : 0)
      draw()
    }
    const up = () => {
      if (!drag) return
      const at: [number, number] = [Math.round(drag.obj.position.x * 2) / 2, Math.round(drag.obj.position.y * 2) / 2]
      if (drag.box) boxRef.current.onMoveBox(drag.id, at); else moveRef.current(drag.id, at)
      drag = null
      ctl.enabled = true
    }
    r.domElement.addEventListener('pointerdown', down)
    r.domElement.addEventListener('pointermove', move)
    r.domElement.addEventListener('pointerup', up)
    ctx.current = { r, scene, cam, ctl, draw, parts, bedG, boxG, paths, layerEnds: [] }
    size()
    return () => { ro.disconnect(); ctl.dispose(); r.dispose(); el.removeChild(r.domElement); ctx.current = null }
  }, [])
  // the bed
  const bedKey = bed.join()
  useEffect(() => {
    const c = ctx.current
    if (!c) return
    c.bedG.clear()
    const [w, d] = bed
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ color: 0x1b1f24, roughness: 0.9 }))
    plate.position.set(w / 2, d / 2, -0.05)
    c.bedG.add(plate)
    const pts: number[] = []
    for (let x = 0; x <= w + 0.01; x += 10) pts.push(x, 0, 0, x, d, 0)
    for (let y = 0; y <= d + 0.01; y += 10) pts.push(0, y, 0, w, y, 0)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    c.bedG.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x2c3239 })))
    const edge = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(w, 0, 0), new THREE.Vector3(w, d, 0), new THREE.Vector3(0, d, 0)]), new THREE.LineBasicMaterial({ color: 0x3bff03 }))
    c.bedG.add(edge)
    const far = Math.max(w, d) * 1.5
    c.cam.position.set(w / 2 + far * 0.15, -far * 0.75, far * 0.85)
    c.ctl.target.set(w / 2, d / 2, 0)
    c.ctl.update()
    c.draw()
  }, [bedKey])  // eslint-disable-line react-hooks/exhaustive-deps
  // the parts
  useEffect(() => {
    const c = ctx.current
    if (!c) return
    for (const o of c.parts.children) { const m = o as THREE.Mesh; m.geometry.dispose(); (m.material as THREE.Material).dispose() }
    c.parts.clear()
    for (const p of placed) {
      const g = p.geo.clone()
      g.computeVertexNormals()
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: p.fits ? 0x3bff03 : 0xf820a0, roughness: 0.6, transparent: show === 'paths', opacity: show === 'paths' ? 0.12 : 1, depthWrite: show !== 'paths' }))
      m.position.set(p.at[0], p.at[1], 0)
      m.userData.id = p.part.id
      c.parts.add(m)
    }
    c.draw()
  }, [placed, show])
  // your support boxes
  const boxKey = JSON.stringify(boxes)
  useEffect(() => {
    const c = ctx.current
    if (!c) return
    for (const o of c.boxG.children) { const m = o as THREE.Mesh; m.geometry.dispose(); (m.material as THREE.Material).dispose() }
    c.boxG.clear()
    for (const b of boxes) {
      const h = Math.max(0.2, b.z1 - b.z0)
      const col = b.kind === 'enforce' ? 0xb48cff : 0xf820a0
      const m = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.d, h), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.22, depthWrite: false }))
      m.position.set(b.x, b.y, b.z0 + h / 2)
      m.userData.box = b.id
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: col }))
      m.add(edges)
      c.boxG.add(m)
    }
    c.draw()
  }, [boxKey])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (host.current) host.current.style.cursor = boxTool ? 'crosshair' : '' }, [boxTool])
  // the paths
  useEffect(() => {
    const c = ctx.current
    if (!c) return
    c.paths.geometry.dispose()
    const g = new THREE.BufferGeometry()
    c.layerEnds = []
    if (layers) {
      let n = 0
      for (const L of layers) for (const p of L.paths) n += p.pts.length / 2 - (p.closed ? 0 : 1)
      const pos = new Float32Array(n * 6), col = new Float32Array(n * 6)
      let at = 0
      const tmp = new THREE.Color()
      for (const L of layers) {
        for (const p of L.paths) {
          tmp.setHex(COLORS[p.kind])
          const k = p.pts.length / 2
          for (let i = 0; i < (p.closed ? k : k - 1); i++) {
            const a = i * 2, b = ((i + 1) % k) * 2
            pos.set([p.pts[a], p.pts[a + 1], L.z, p.pts[b], p.pts[b + 1], L.z], at * 6)
            col.set([tmp.r, tmp.g, tmp.b, tmp.r, tmp.g, tmp.b], at * 6)
            at++
          }
        }
        c.layerEnds.push(at * 2)
      }
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    }
    c.paths.geometry = g
    c.draw()
  }, [layers])
  useEffect(() => {
    const c = ctx.current
    if (!c) return
    c.paths.visible = show === 'paths'
    c.paths.geometry.setDrawRange(0, c.layerEnds[Math.min(upto, c.layerEnds.length - 1)] ?? 0)
    c.draw()
  }, [upto, show, layers])
  return <div className="pr-view" ref={host} />
}

function PrinterSetup({ p }: { p: Printer }) {
  const up = (part: Partial<Printer>) => updatePrinter(p.id, part)
  const [ports, setPorts] = useState<string[]>([])
  const [msg, setMsg] = useState('')
  const [user, setUser] = useState(p.user)
  const [pass, setPass] = useState('')
  const link = LINKS.find((l) => l.id === p.link)!
  useEffect(() => { if (p.link === 'usb') void serialPorts().then(setPorts) }, [p.link])
  return (
    <>
      <fieldset className="ps-group"><legend>Printer</legend>
        <Field label="Profile" hint="Bed, speeds and how it is reached, for common printers. A starting point: check yours">
          <select className="select" value={p.model ?? ''} onChange={(e) => applyModel(p, e.target.value)}>
            <option value="">Pick your printer</option>
            {[...new Set(MODELS.map((m) => m.group))].map((g) => (
              <optgroup key={g} label={g}>{MODELS.filter((m) => m.group === g).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</optgroup>
            ))}
          </select>
        </Field>
        <Field label="Name"><input className="input" value={p.name} onChange={(e) => up({ name: e.target.value })} /></Field>
        <Field label="Size">
          <select className="select" value={BEDS.find((b) => b.bed.join() === p.bed.join() && Boolean(b.center) === p.center)?.id ?? ''} onChange={(e) => { const b = BEDS.find((x) => x.id === e.target.value); if (b) up({ bed: [...b.bed], center: Boolean(b.center) }) }}>
            <option value="">Your own size</option>
            {BEDS.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
        <div className="vec">
          <label className="gen-num"><span>Width</span><N value={p.bed[0]} set={(v) => up({ bed: [v, p.bed[1], p.bed[2]] })} min={50} max={1000} step={1} digits={0} suffix=" mm" /></label>
          <label className="gen-num"><span>Depth</span><N value={p.bed[1]} set={(v) => up({ bed: [p.bed[0], v, p.bed[2]] })} min={50} max={1000} step={1} digits={0} suffix=" mm" /></label>
          <label className="gen-num"><span>Height</span><N value={p.bed[2]} set={(v) => up({ bed: [p.bed[0], p.bed[1], v] })} min={50} max={1000} step={1} digits={0} suffix=" mm" /></label>
        </div>
        <Field label="Nozzle"><N value={p.nozzle} set={(v) => { up({ nozzle: v }); setSettings({ lineWidth: Math.round(v * 1.125 * 100) / 100 }) }} min={0.1} max={1.2} step={0.05} digits={2} suffix=" mm" /></Field>
        <Field label="Filament"><div className="seg">{[1.75, 2.85].map((d) => <button key={d} className={p.filament === d ? 'on' : ''} onClick={() => up({ filament: d })}>{d} mm</button>)}</div></Field>
        <label className="mini-check"><input type="checkbox" checked={p.center} onChange={(e) => up({ center: e.target.checked })} />0,0 is the middle of the bed (round printers)</label>
        <p className="dim small">Firmware, acceleration, retraction and the start and end G-code are in Print settings, in the Printer and Speed tabs.</p>
      </fieldset>
      <fieldset className="ps-group"><legend>How RICO reaches it</legend>
        <select className="select" value={p.link} onChange={(e) => up({ link: e.target.value as Printer['link'] })}>
          {LINKS.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <p className="dim small">{link.about}</p>
        {(p.link === 'klipper' || p.link === 'octoprint' || p.link === 'prusalink') && <>
          <Field label="Address"><input className="input" value={p.host} placeholder="printer.local" onChange={(e) => up({ host: e.target.value })} spellCheck={false} /></Field>
          <Field label="API key" hint="Only if your printer asks for one"><input className="input" type="password" value={p.key} onChange={(e) => up({ key: e.target.value })} autoComplete="off" /></Field>
          {p.link === 'prusalink' && <Field label="Storage"><div className="seg">{['usb', 'local'].map((s) => <button key={s} className={p.storage === s ? 'on' : ''} onClick={() => up({ storage: s })}>{s === 'usb' ? 'USB stick' : 'Inside'}</button>)}</div></Field>}
          {p.link === 'klipper' && (
            <details className="pr-signin">
              <summary>{p.token ? `Signed in${p.user ? ` as ${p.user}` : ''}` : 'Sign in (if your printer has a password)'}</summary>
              <div className="row wrap gap">
                <input className="input" placeholder="User name" value={user} onChange={(e) => setUser(e.target.value)} style={{ width: 130 }} />
                <input className="input" type="password" placeholder="Password" value={pass} onChange={(e) => setPass(e.target.value)} style={{ width: 130 }} />
                <button className="btn small primary" onClick={async () => { const e = await klipperSignIn(p, user, pass); setPass(''); setMsg(e || 'Signed in.') }}>Sign in</button>
                {p.token && <button className="btn small quiet" onClick={() => up({ token: '' })}>Sign out</button>}
              </div>
              <p className="dim small">The password is not kept, only the sign-in it gives back.</p>
            </details>
          )}
          <div className="row wrap">
            <button className="btn small" onClick={async () => { setMsg('Asking...'); const e = await testPrinter(p); setMsg(e || 'The printer answered.') }}>Test</button>
            {p.host && <button className="btn small quiet" onClick={() => window.open(p.host.startsWith('http') ? p.host : `http://${p.host}`, '_blank')}>Open its page</button>}
          </div>
        </>}
        {p.link === 'usb' && <>
          <Field label="Port">
            <select className="select" value={p.port} onChange={(e) => up({ port: e.target.value })}>
              {[...new Set([p.port, ...ports])].map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </Field>
          <Field label="Speed"><select className="select" value={p.baud} onChange={(e) => up({ baud: Number(e.target.value) })}>{[115200, 250000, 57600].map((b) => <option key={b} value={b}>{b}</option>)}</select></Field>
          <button className="btn small quiet" onClick={() => void serialPorts().then((l) => { setPorts(l); setMsg(l.length ? `${l.length} port${l.length > 1 ? 's' : ''} found.` : 'No ports found. Plug in the printer.') })}>Look for ports</button>
        </>}
        {msg && <p className="small lime">{msg}</p>}
      </fieldset>
    </>
  )
}

function JobBox() {
  const job = useJob()
  const [, tick] = useState(0)
  useEffect(() => { if (!job.waiting) return; const t = window.setInterval(() => tick((n) => n + 1), 1000); return () => window.clearInterval(t) }, [job.waiting])
  if (!job.on && !job.log.length) return null
  return (
    <div className="pr-status au-job">
      <b className={job.on ? 'lime' : 'dim'}>Automation {job.on ? `on: ${job.file}` : 'off'}</b>
      {job.on && <span className="small">{job.state}{job.layers ? `, layer ${job.layer} of ${job.layers}` : ''}{job.repeatLeft ? `, ${job.repeatLeft} more to print` : ''}</span>}
      {job.waiting && <span className="small warn-text">Waiting for {job.waiting} ({Math.round((Date.now() - job.since) / 1000)} s)</span>}
      {job.log.length > 0 && <ul className="au-log small dim">{job.log.slice(-5).map((l, i) => <li key={i}>{l}</li>)}</ul>}
      {job.on && <button className="btn small quiet" onClick={stopWatching}>Stop the automation</button>}
    </div>
  )
}

function StatusBox({ p, stream }: { p: Printer; stream: Stream | null }) {
  const [st, setSt] = useState<PrinterStatus | null>(null)
  useEffect(() => {
    if (p.link === 'file' || p.link === 'usb' || !p.host) { setSt(null); return }
    let live = true
    const tick = async () => { const s = await printerStatus(p); if (live) setSt(s) }
    void tick()
    const t = window.setInterval(() => void tick(), 4000)
    return () => { live = false; window.clearInterval(t) }
  }, [p])
  const cmd = async (w: 'pause' | 'resume' | 'cancel') => { const e = await printerCommand(p, w); if (e) toast(e) }
  if (p.link === 'usb') return stream ? (
    <div className="pr-status">
      <b>Printing over USB</b>
      <div className="row wrap"><button className="btn small" onClick={() => stream.pause(true)}>Pause</button><button className="btn small" onClick={() => stream.pause(false)}>Go on</button><button className="btn small danger" onClick={() => stream.stop()}>Stop</button></div>
    </div>
  ) : null
  if (!st) return null
  const t = (v?: [number, number]) => (v ? `${v[0].toFixed(0)} / ${v[1].toFixed(0)} C` : '')
  return (
    <div className="pr-status">
      <b className={st.error ? 'warn-text' : 'lime'}>{st.error ? st.error : st.state}</b>
      {!st.error && <>
        {st.file && <span className="dim small">{st.file}</span>}
        {st.progress > 0 && <div className="pr-bar"><i style={{ width: `${(st.progress * 100).toFixed(1)}%` }} /><span>{(st.progress * 100).toFixed(0)}%</span></div>}
        <span className="small">Nozzle {t(st.nozzle)} &nbsp; Bed {t(st.bed)}</span>
        <div className="row wrap">
          <button className="btn small" onClick={() => void cmd('pause')}>Pause</button>
          <button className="btn small" onClick={() => void cmd('resume')}>Go on</button>
          <button className="btn small danger" onClick={() => void cmd('cancel')}>Cancel the print</button>
        </div>
      </>}
    </div>
  )
}

let worker: Worker | null = null
let jobId = 0

export default function PrintPanel() {
  const store = usePrinters()
  const p = currentPrinter()
  const s = getSettings()
  const parts = useBed()
  const wanted = useWanted('print')
  const [placed, setPlaced] = useState<Placed[]>([])
  const [result, setResult] = useState<{ layers: Layer[]; gcode: Gcode; key: string } | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const [upto, setUpto] = useState(0)
  const [show, setShow] = useState<'parts' | 'paths'>('parts')
  const [sending, setSending] = useState('')
  const [stream, setStream] = useState<Stream | null>(null)
  const [setup, setSetup] = useState(false)
  const [boxTool, setBoxTool] = useState<'enforce' | 'block' | null>(null)

  // a gobo sent from the gobo maker: put only that one on the bed
  useEffect(() => { if (wanted) { onlyPart(wanted); clearWanted(); setShow('parts') } }, [wanted])

  // the gobos and their masks change the parts too
  const gobos = useGobos()
  const mapV = useMapVersion()
  const partsKey = JSON.stringify([parts, gobos, mapV, p.bed])
  useEffect(() => {
    let live = true
    const t = window.setTimeout(() => { void placeAll(p.bed).then((pl) => { if (live) setPlaced(pl) }) }, 150)
    return () => { live = false; window.clearTimeout(t) }
  }, [partsKey])  // eslint-disable-line react-hooks/exhaustive-deps
  const key = useMemo(() => JSON.stringify([placed.map((x) => [x.part.id, x.at, x.size, x.part.flip, x.part.turn, x.part.scale]), s, p.bed, p.center, p.filament, p.start, p.end, p.flavor, p.zOffset, p.beforeLayer, p.afterLayer, p.pauseG, p.changeG, p.accel, p.maxFlow, p.link]), [placed, s, p])
  const stale = result !== null && result.key !== key
  const bad = placed.filter((x) => !x.fits)

  const run = () => {
    if (!placed.length) return toast('Nothing on the bed. Turn on a gobo or open an STL file.')
    if (bad.length) toast(`${bad.map((b) => b.part.name).join(', ')} ${bad.length > 1 ? 'do' : 'does'} not fit on the bed.`)
    const { tris, shells } = bedTriangles(placed)
    worker ??= new Worker(new URL('./slice.worker.ts', import.meta.url), { type: 'module' })
    const id = ++jobId
    setBusy(0)
    const machine = {
      filament: p.filament, bed: p.bed, center: p.center, start: p.start, end: p.end, name: p.name, accel: p.accel, maxFlow: p.maxFlow,
      flavor: p.flavor ?? (p.link === 'klipper' ? 'klipper' : 'marlin'), zOffset: p.zOffset, beforeLayer: p.beforeLayer, afterLayer: p.afterLayer, pauseG: p.pauseG, changeG: p.changeG, link: p.link,
    }
    const k = key
    worker.onmessage = (e: MessageEvent<{ id: number; progress?: number; done?: boolean; layers?: Layer[]; gcode?: Gcode; error?: string }>) => {
      if (e.data.id !== jobId) return
      if (e.data.progress !== undefined) setBusy(e.data.progress)
      if (e.data.error) { setBusy(null); toast(`Slicing did not work: ${e.data.error}`) }
      if (e.data.done) { setBusy(null); setResult({ layers: e.data.layers!, gcode: e.data.gcode!, key: k }); setUpto(e.data.layers!.length - 1); setShow('paths') }
    }
    worker.postMessage({ id, tris, shells, settings: { ...s }, machine }, [tris.buffer])
  }
  const name = placed.length === 1 ? placed[0].part.name : `RICO ${placed.length} parts`
  const send = async (startNow: boolean) => {
    if (!result) return
    setSending('Sending...')
    const g = result.gcode
    // the automation watches the print when there is something for it to do
    const auto = startNow && (g.events.length > 0 || (s.repeat ?? 0) > 0)
    const w: Watch = { printer: p, file: fileNameFor(name), events: g.events, layers: g.layers, repeat: s.repeat ?? 0, repeatSignal: s.repeatSignal ?? '' }
    let cur: Stream | null = null
    const usbOn = { progress: (f: number) => setSending(`Printing over USB: ${(f * 100).toFixed(0)}%`), log: () => {}, marker: auto ? usbMarker(w, () => cur) : undefined }
    w.again = async () => { const r2 = await sendToPrinter(p, name, g.text, true, usbOn); cur = r2.stream ?? null; if (cur) setStream(cur); return cur }
    const r = await sendToPrinter(p, name, g.text, startNow, usbOn)
    cur = r.stream ?? null
    if (r.stream) setStream(r.stream)
    if (!r.error && auto) watch(w, cur)
    if (r.error) { setSending(''); toast(r.error) } else if (p.link !== 'usb') { setSending(''); toast(startNow ? 'Sent. The printer is starting.' : 'Sent to the printer.', true) }
  }
  const mat = MATERIALS.find((m) => m.id === s.material) ?? MATERIALS[0]
  const min = result ? Math.round(result.gcode.seconds / 60) : 0

  return (
    <div className="dpanel pr">
      <div className="tool-strip" role="toolbar" aria-label="Print tools">
        <select className="select mini mp-out" value={p.id} onChange={(e) => setCurrent(e.target.value)} title="Which printer">
          {store.printers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <ToolBtn t={{ id: 'setup', icon: 'printer', label: 'Printer and connection', on: setup, run: () => setSetup(!setup) }} />
        <ToolBtn t={{ id: 'add', icon: 'plus', label: 'Another printer', run: () => { addPrinter(newPrinter({ name: `Printer ${store.printers.length + 1}` })); setSetup(true) } }} />
        <i className="ts-sep" />
        <ToolBtn t={{ id: 'open', icon: 'import', label: 'Open an STL file', run: () => pickFile('.stl', (f) => void addStl(f).then((e) => e && toast(e))) }} />
        <ToolBtn t={{ id: 'arrange', icon: 'grid', label: 'Place everything for me', run: () => parts.forEach((x) => x.at && updatePart(x.id, { at: null })) }} />
        <i className="ts-sep" />
        <ToolBtn t={{ id: 'parts', icon: 'cube', label: 'Show the parts (drag them on the bed)', on: show === 'parts', run: () => setShow('parts') }} />
        <ToolBtn t={{ id: 'paths', icon: 'layers', label: 'Show the paths of the nozzle', on: show === 'paths', run: () => (result ? setShow('paths') : toast('Slice first.')) }} />
        <span className="grow" />
        <span className="ts-label">{p.bed[0]} x {p.bed[1]} x {p.bed[2]} mm</span>
      </div>

      <div className="pr-cols">
        <div className="pr-side">
          {setup && <>
            <PrinterSetup p={p} />
            {store.printers.length > 1 && <button className="btn small quiet danger" onClick={() => removePrinter(p.id)}>Remove this printer</button>}
          </>}
          <fieldset className="ps-group"><legend>On the bed</legend>
            {!parts.length && <p className="dim small">No gobos yet. Make one in Projection mapping, or open an STL file.</p>}
            <ul className="pr-parts">
              {parts.map((x) => {
                const pl = placed.find((q) => q.part.id === x.id)
                return (
                  <li key={x.id} className={x.on ? '' : 'off'}>
                    <input type="checkbox" checked={x.on} onChange={(e) => updatePart(x.id, { on: e.target.checked })} title="On the bed" />
                    <span className="grow">{x.name}<span className="dim small"> {x.kind === 'gobo' ? 'gobo' : 'file'}{pl ? `, ${pl.size[0].toFixed(0)} x ${pl.size[1].toFixed(0)} x ${pl.size[2].toFixed(0)} mm` : ''}</span>{pl && !pl.fits && <b className="warn-text small"> too big</b>}</span>
                    <button className="icon-btn small" title="Turn it 90 degrees" onClick={() => updatePart(x.id, { turn: (x.turn + 90) % 360, at: null })}><RIcon name="rotate" size={14} /></button>
                    <button className={`icon-btn small${x.flip ? ' on' : ''}`} title={x.flip ? 'Upside down (a gobo prints best with the plate on the bed)' : 'Upside down'} onClick={() => updatePart(x.id, { flip: !x.flip, at: null })}><RIcon name="flip" size={14} /></button>
                    <label className="mini" title="Size"><Scrub value={x.scale} step={0.5} digits={0} min={10} max={500} suffix="%" onChange={(v) => updatePart(x.id, { scale: v, at: null })} /></label>
                    {x.kind === 'file' && <button className="icon-btn small danger" title="Take it off" onClick={() => removeFile(x.id)}><Icon name="x" /></button>}
                  </li>
                )
              })}
            </ul>
            <p className="dim small">Drag parts on the bed to move them. A gobo prints face down, so from above it looks mirrored: it is right way round once you turn it over. Files are not kept when RICO closes; gobos always are.</p>
          </fieldset>

          <fieldset className="ps-group"><legend>Material</legend>
            <div className="seg">{MATERIALS.map((m) => <button key={m.id} title={m.about} className={s.material === m.id ? 'on' : ''} onClick={() => setSettings({ material: m.id, nozzleTemp: m.nozzle, bedTemp: m.bed, fan: m.fan })}>{m.name}</button>)}</div>
            <p className="dim small">{mat.about}</p>
            <Field label="Nozzle"><N value={s.nozzleTemp} set={(v) => setSettings({ nozzleTemp: v })} min={150} max={320} step={1} digits={0} suffix=" C" /></Field>
            <Field label="Bed"><N value={s.bedTemp} set={(v) => setSettings({ bedTemp: v })} min={0} max={130} step={1} digits={0} suffix=" C" /></Field>
          </fieldset>

          <fieldset className="ps-group"><legend>Ready settings</legend>
            <div className="seg wrap">{QUALITY.map((q) => <button key={q.id} title={q.about} className={Object.entries(q.part).every(([k, v]) => s[k as keyof typeof s] === v) ? 'on' : ''} onClick={() => setSettings(q.part)}>{q.name}</button>)}</div>
            <p className="dim small">A start. Everything else, and your own profiles, is below.</p>
          </fieldset>

          <PrintSettingsBox p={p} boxTool={boxTool} setBoxTool={setBoxTool} />
        </div>

        <div className="pr-stage">
          <BedView bed={p.bed} placed={placed} layers={result?.layers ?? null} upto={upto} show={show}
            onMove={(id, at) => { const pl = placed.find((x) => x.part.id === id); if (pl) updatePart(id, { at: [at[0], at[1]] }) }}
            boxes={s.supportBoxes ?? []} boxTool={boxTool}
            onBox={([x, y, z]) => {
              const b: SupportBox = { id: `b${Math.random().toString(36).slice(2, 7)}`, kind: boxTool!, x: Math.round(x * 2) / 2, y: Math.round(y * 2) / 2, w: 8, d: 8, z0: 0, z1: Math.round((z + 1) * 10) / 10 }
              setSettings({ supportBoxes: [...(s.supportBoxes ?? []), b], ...(boxTool === 'enforce' && (s.support ?? 'none') === 'none' ? { support: 'everywhere' as const } : {}) })
              setBoxTool(null)
            }}
            onMoveBox={(id, at) => setSettings({ supportBoxes: (s.supportBoxes ?? []).map((b) => (b.id === id ? { ...b, x: at[0], y: at[1] } : b)) })} />
          {boxTool && <p className="pr-hint small">Click the part where you want {boxTool === 'enforce' ? 'support' : 'no support'}. <button className="btn small quiet" onClick={() => setBoxTool(null)}>Cancel</button></p>}
          {show === 'paths' && result && (
            <div className="pr-layers">
              <span className="small">Layer {upto + 1} of {result.layers.length}, {result.layers[upto]?.z.toFixed(2)} mm</span>
              <input className="range" type="range" min={0} max={result.layers.length - 1} value={upto} onChange={(e) => setUpto(Number(e.target.value))} aria-label="Layer" />
              <span className="pr-legend">{(Object.keys(COLORS) as PathKind[]).map((k) => <span key={k}><i style={{ background: `#${COLORS[k].toString(16).padStart(6, '0')}` }} />{KIND_NAME[k]}</span>)}</span>
            </div>
          )}
          <div className="pr-go">
            <button className="btn primary" disabled={busy !== null} onClick={run}>{busy !== null ? `Slicing ${(busy * 100).toFixed(0)}%` : result && !stale ? 'Slice again' : 'Slice'}</button>
            {result && <>
              <dl className="ps-stats pr-stats">
                <div><dt>Time</dt><dd>{min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`}</dd></div>
                <div><dt>Filament</dt><dd>{(result.gcode.filament / 1000).toFixed(2)} m, {result.gcode.grams.toFixed(1)} g</dd></div>
                <div><dt>Layers</dt><dd>{result.layers.length}</dd></div>
                {result.gcode.cost > 0 && <div><dt>Cost</dt><dd>{result.gcode.cost.toFixed(2)}</dd></div>}
                {result.gcode.events.length > 0 && <div><dt>Automation</dt><dd>{result.gcode.events.length} step{result.gcode.events.length > 1 ? 's' : ''}</dd></div>}
              </dl>
              {stale && <p className="warn-text small">Something changed since you sliced. Slice again before you print.</p>}
              <div className="row wrap">
                {p.link !== 'file' && <button className="btn primary" disabled={stale || Boolean(sending) || !!stream} onClick={() => void send(true)}><RIcon name="printer" size={16} /> {p.link === 'usb' ? 'Print over USB' : 'Send and print'}</button>}
                {p.link !== 'file' && p.link !== 'usb' && <button className="btn" disabled={stale || Boolean(sending)} onClick={() => void send(false)}>Send only</button>}
                <button className="btn quiet" onClick={() => downloadBlob(`${name.replace(/[^\w\- ]+/g, '').trim() || 'print'}.gcode`, new Blob([result.gcode.text], { type: 'text/plain' }))}>Save G-code</button>
              </div>
              {sending && <p className="small lime">{sending}</p>}
            </>}
          </div>
          <StatusBox p={p} stream={stream} />
          <JobBox />
          {p.link === 'file' && <p className="dim small">To send prints from here, open the printer settings (the printer icon) and choose how RICO reaches it.</p>}
        </div>
      </div>
    </div>
  )
}
