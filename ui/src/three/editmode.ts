import { useSyncExternalStore } from 'react'
import * as THREE from 'three'
import { toast } from '../components/Toasts'
import { canvas3d, getCamera, getScene, gizmo, objectOf, orbit, setGizmoLock } from './engine'
import { deleteSelected, extrude, flip, fromGeometry, neighbors, sculpt, smooth, subdivide, type SculptTool } from './modeling'
import { beginStroke, brush, brushRadius, dab, endStroke, ensureBox, fillPaint, isOldPaint, paintOf, restartPaint, savePaint } from './paint'
import { MATERIAL_PRESETS, changeWorld, getSelected3d, getWorld, select3d, uid, updateObject, type MeshData, type Obj3D } from './world'

// Modeling in the 3D view: Edit mode (points and faces),
// Sculpt mode (brushes, with pen pressure) and Paint mode (paint colors or a
// mask right on the object). Tab goes in and out of Edit mode.

export type EditMode = 'object' | 'edit' | 'sculpt' | 'paint'
interface State {
  mode: EditMode
  target: string | null
  sel: Set<number>
  selectMode: 'vertex' | 'face'
  tool: SculptTool
  radius: number
  strength: number
  sym: boolean
  invert: boolean
  xray: boolean
  lazy: number          // px: the stroke trails the pen by this much, for smooth lines
  spacing: number       // px between dabs
  pressSize: boolean    // pen pressure changes the size
  pressStrength: boolean
  moveObject: boolean   // Sculpt and Paint: move the whole object instead
}
const st: State = { mode: 'object', target: null, sel: new Set(), selectMode: 'vertex', tool: 'draw', radius: 0.3, strength: 0.5, sym: true, invert: false, xray: true, lazy: 10, spacing: 5, pressSize: true, pressStrength: true, moveObject: false }
let version = 0
const listeners = new Set<() => void>()
function emit() { version++; listeners.forEach((l) => l()) }
export function useEdit() {
  useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => version)
  return st
}
export const getEdit = () => st
export function setEdit(part: Partial<State>) { Object.assign(st, part); emit() }

const objData = () => getWorld().objects.find((o) => o.id === st.target)
const meshNow = () => { const m = st.target ? objectOf(st.target) as THREE.Mesh | undefined : undefined; return m?.isMesh ? m : undefined }

// going in and out

function makeEditable(o: Obj3D): boolean {
  if (o.kind === 'mesh' && o.mesh) return true
  const m = objectOf(o.id) as THREE.Mesh | undefined
  if (!m?.isMesh || !m.geometry.getAttribute('position')) { toast('This one cannot be modeled. Pick a shape (or add an editable one).'); return false }
  const data = fromGeometry(m.geometry)
  updateObject(o.id, { kind: 'mesh', mesh: data, meshRev: (o.meshRev ?? 0) + 1, name: o.name }, 'Make editable')
  toast(`${o.name} is now an editable mesh (${data.p.length / 3} points).`, true)
  return true
}

function ensurePaintable(o: Obj3D) {
  if (o.material === 'custom') {
    const m = getWorld().materials?.find((x) => x.id === o.matId)
    if (m?.layers.some((l) => l.kind === 'paint' || l.mask.startsWith('paint'))) return
    if (m) {
      changeWorld('Add a paint layer', (w) => ({ ...w, materials: (w.materials ?? []).map((x) => (x.id === m.id ? { ...x, layers: [...x.layers, MATERIAL_PRESETS[4].layers()[0]] } : x)) }))
      return
    }
  }
  const id = uid()
  changeWorld('Paint material', (w) => ({ ...w, materials: [...(w.materials ?? []), { id, name: `Painted ${o.name}`, layers: MATERIAL_PRESETS[4].layers() }] }))
  updateObject(o.id, { material: 'custom', matId: id }, 'Paint material')
  toast('It now has a material with a paint layer. Paint on it.', true)
}

export function enterMode(mode: EditMode) {
  if (mode === 'object') return exitMode()
  const id = getSelected3d()
  const o = getWorld().objects.find((x) => x.id === id)
  if (!o) { toast('Select an object first.'); return }
  if (o.kind === 'model' || o.kind === 'fog' || o.kind.endsWith('light') || o.kind === 'sun') { toast('Pick a shape. Models and lights cannot be edited here.'); return }
  if ((mode === 'edit' || mode === 'sculpt') && !makeEditable(o)) return
  if (mode === 'paint') ensurePaintable(o)
  st.mode = mode
  st.target = o.id
  st.sel = new Set()
  setGizmoLock(true)
  gizmo.detach()
  emit()
}

export function exitMode() {
  st.mode = 'object'
  removeOverlay()
  setGizmoLock(false)
  gizmo.detach()
  const id = st.target
  st.target = null
  st.sel = new Set()
  emit()
  if (id) select3d(id)
}

// the overlay: points, wires, the brush ring and the move handle

let overlay: { mesh: THREE.Mesh; points: THREE.Points; wire: THREE.Mesh } | null = null
const pivot = new THREE.Object3D()
pivot.userData.helper = true
getScene().add(pivot)
const ring = new THREE.Mesh(new THREE.RingGeometry(0.96, 1, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.7, side: THREE.DoubleSide }))
ring.userData.helper = true
ring.renderOrder = 20
ring.visible = false
getScene().add(ring)

function removeOverlay() {
  if (!overlay) return
  overlay.mesh.remove(overlay.points)
  overlay.mesh.remove(overlay.wire)
  ;(overlay.points.material as THREE.Material).dispose()
  ;(overlay.wire.material as THREE.Material).dispose()
  overlay.points.geometry.dispose()
  overlay = null
}

function refreshOverlay() {
  const mesh = meshNow()
  if (st.mode !== 'edit' || !mesh) { removeOverlay(); placePivot(); return }
  if (!overlay || overlay.mesh !== mesh || overlay.points.geometry.getAttribute('position') !== mesh.geometry.getAttribute('position')) {
    removeOverlay()
    const g = new THREE.BufferGeometry()
    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute
    g.setAttribute('position', pos)
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3))
    const points = new THREE.Points(g, new THREE.PointsMaterial({ size: 7, sizeAttenuation: false, vertexColors: true, depthTest: !st.xray }))
    points.userData.helper = true
    points.renderOrder = 15
    const wire = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({ color: 0x3bff03, wireframe: true, transparent: true, opacity: 0.35, depthTest: !st.xray }))
    wire.userData.helper = true
    wire.renderOrder = 14
    mesh.add(points)
    mesh.add(wire)
    overlay = { mesh, points, wire }
  }
  const col = overlay.points.geometry.getAttribute('color') as THREE.BufferAttribute
  for (let i = 0; i < col.count; i++) {
    if (st.sel.has(i)) col.setXYZ(i, 1, 0.82, 0.25)
    else col.setXYZ(i, 0.1, 0.35, 0.1)
  }
  col.needsUpdate = true
  ;(overlay.points.material as THREE.PointsMaterial).depthTest = !st.xray
  ;(overlay.wire.material as THREE.MeshBasicMaterial).depthTest = !st.xray
  placePivot()
}

function placePivot() {
  const mesh = meshNow()
  if (dragging || !mesh) return
  // Nothing selected in Edit (or "Move object" in Sculpt and Paint): the
  // arrows move the whole object.
  const whole = (st.mode === 'edit' && !st.sel.size) || ((st.mode === 'sculpt' || st.mode === 'paint') && st.moveObject)
  if (whole) { if (gizmo.object !== mesh) gizmo.attach(mesh); return }
  if (st.mode !== 'edit' || !st.sel.size) { if (gizmo.object) gizmo.detach(); return }
  const pos = mesh.geometry.getAttribute('position')
  const c = new THREE.Vector3()
  for (const i of st.sel) c.add(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)))
  c.divideScalar(st.sel.size)
  mesh.updateMatrixWorld()
  pivot.position.copy(mesh.localToWorld(c))
  pivot.rotation.set(0, 0, 0)
  pivot.scale.set(1, 1, 1)
  pivot.updateMatrixWorld()
  if (gizmo.object !== pivot) gizmo.attach(pivot)
}

// Keep the overlay on the current mesh (it is rebuilt after each edit).
let lastSig = ''
function tick() {
  requestAnimationFrame(tick)
  if (st.mode === 'object') return
  const o = objData()
  if (!o) { exitMode(); return }
  const sig = `${st.mode}|${o.meshRev}|${version}|${meshNow()?.uuid}`
  if (sig !== lastSig) { lastSig = sig; refreshOverlay() }
}
requestAnimationFrame(tick)

// committing

function commit(data: MeshData, label: string, sel?: Set<number>) {
  const o = objData()
  if (!o) return
  if (sel) st.sel = sel
  updateObject(o.id, { mesh: data, meshRev: (o.meshRev ?? 0) + 1 }, label, `edit.${o.id}.${label}.${Date.now()}`)
  emit()
}
const currentData = (): MeshData | null => objData()?.mesh ?? null

export function opExtrude() {
  const d = currentData()
  if (!d) return
  const r = extrude(d, st.sel)
  if (!r) { toast('Select whole faces to extrude (all three corners), or switch to Face select.'); return }
  commit(r.data, 'Extrude', r.sel)
  toast('Extruded. Drag the arrows to pull it further.', true)
}
export function opDelete() { const d = currentData(); if (d && st.sel.size) commit(deleteSelected(d, st.sel), 'Delete', new Set()) }
export function opSubdivide() { const d = currentData(); if (d) { if (d.f.length / 3 > 200000) return toast('That is already very detailed.'); commit(subdivide(d), 'Subdivide', new Set()) } }
export function opSmooth() { const d = currentData(); if (d) commit(smooth(d, st.sel.size ? st.sel : null, 2), 'Smooth') }
export function opFlip() { const d = currentData(); if (d) commit(flip(d), 'Flip faces') }
export function selectAll(on = true) {
  const d = currentData()
  st.sel = on && d ? new Set(Array.from({ length: d.p.length / 3 }, (_, i) => i)) : new Set()
  emit()
}
export function growSelection() {
  const d = currentData()
  if (!d) return
  const nb = neighbors(d)
  const next = new Set(st.sel)
  for (const v of st.sel) for (const u of nb[v]) next.add(u)
  st.sel = next
  emit()
}

// pointer work

const ray = new THREE.Raycaster()
const ndc = (e: PointerEvent) => { const r = canvas3d.getBoundingClientRect(); return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1) }
function hitMesh(e: PointerEvent) {
  const mesh = meshNow()
  if (!mesh) return null
  ray.setFromCamera(ndc(e), getCamera())
  const h = ray.intersectObject(mesh, false)[0]
  return h ? { mesh, h } : null
}
// Where the brush touches, in the object's own space (the paint does not
// use the model's cut lines, so there are no seams).
function paintHit(hit: { mesh: THREE.Mesh; h: THREE.Intersection }) {
  const local = hit.mesh.worldToLocal(hit.h.point.clone())
  // the smooth normal at that point (object space), so the paint does not jump between flat faces
  const normal = (hit.h.normal ?? hit.h.face?.normal ?? new THREE.Vector3(0, 1, 0)).clone()
  return { uv: hit.h.uv ?? null, local, normal }
}

function savePaintNow(label: string) {
  const o = objData()
  const saved = o ? savePaint(o.id) : null
  if (o && saved) updateObject(o.id, saved, label, `paint.${o.id}.${Date.now()}`)
}

// Fill or clear the whole object (saved right away).
export function fillObjectPaint(clear: boolean) {
  const o = objData(), mesh = meshNow()
  if (!o || !mesh) return
  paintOf(o)
  ensureBox(o.id, mesh.geometry)
  fillPaint(o.id, brush.target, clear)
  savePaintNow(clear ? 'Clear paint' : 'Fill paint')
}

// Paint from older versions wraps around the model and can show seams.
// This starts it over the new way.
export const hasOldPaint = () => { const o = objData(); return Boolean(o && (isOldPaint(o.id) || (o.paint && !o.paintBox))) }
export function restartObjectPaint() {
  const o = objData(), mesh = meshNow()
  if (!o || !mesh) return
  restartPaint(o.id)
  ensureBox(o.id, mesh.geometry)
  savePaintNow('Start paint over')
  emit()
}

const pressureOf = (e: PointerEvent) => (e.pointerType === 'pen' ? Math.max(0.05, e.pressure || 0.5) : 1)

let dragging = false
let stroke: { kind: 'sculpt' | 'paint' | 'grab' | 'snake'; nb?: number[][]; start?: Float32Array; weights?: Float32Array; plane?: THREE.Plane; startLocal?: THREE.Vector3; lazy?: [number, number]; last?: [number, number] } | null = null
let gizmoStart: { m: THREE.Matrix4; pts: Map<number, THREE.Vector3> } | null = null

gizmo.addEventListener('mouseDown', () => {
  if (gizmo.object !== pivot) return
  const mesh = meshNow()
  if (!mesh) return
  dragging = true
  pivot.updateMatrixWorld()
  const pos = mesh.geometry.getAttribute('position')
  const pts = new Map<number, THREE.Vector3>()
  for (const i of st.sel) pts.set(i, mesh.localToWorld(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i))))
  gizmoStart = { m: pivot.matrixWorld.clone().invert(), pts }
})
gizmo.addEventListener('objectChange', () => {
  if (gizmo.object !== pivot || !gizmoStart) return
  const mesh = meshNow()
  if (!mesh) return
  pivot.updateMatrixWorld()
  const M = pivot.matrixWorld.clone().multiply(gizmoStart.m)
  const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute
  for (const [i, w] of gizmoStart.pts) { const p = mesh.worldToLocal(w.clone().applyMatrix4(M)); pos.setXYZ(i, p.x, p.y, p.z) }
  pos.needsUpdate = true
  mesh.geometry.computeVertexNormals()
  mesh.geometry.computeBoundingSphere()
})
gizmo.addEventListener('mouseUp', () => {
  if (gizmo.object !== pivot || !gizmoStart) return
  dragging = false
  gizmoStart = null
  const mesh = meshNow(), d = currentData()
  if (!mesh || !d) return
  commit({ p: Array.from(mesh.geometry.getAttribute('position').array as ArrayLike<number>), f: d.f }, 'Move points')
})

function onDown(e: PointerEvent) {
  if (st.mode === 'object' || e.button !== 0) return
  if (gizmo.axis && gizmo.object) return     // the move handle takes it
  if ((st.mode === 'sculpt' || st.mode === 'paint') && st.moveObject) return
  const hit = hitMesh(e)
  if (st.mode === 'edit') {
    const mesh = meshNow()
    if (!mesh) return
    let picked: number[] = []
    if (st.selectMode === 'face') {
      if (hit?.h.face) picked = [hit.h.face.a, hit.h.face.b, hit.h.face.c]
    } else {
      const pos = mesh.geometry.getAttribute('position')
      const r = canvas3d.getBoundingClientRect()
      mesh.updateMatrixWorld()
      let best = -1, bestD = 14
      const v = new THREE.Vector3()
      for (let i = 0; i < pos.count; i++) {
        v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(mesh.matrixWorld).project(getCamera())
        if (v.z > 1) continue
        const sx = ((v.x + 1) / 2) * r.width + r.left, sy = ((1 - v.y) / 2) * r.height + r.top
        const dd = Math.hypot(sx - e.clientX, sy - e.clientY)
        if (dd < bestD) { bestD = dd; best = i }
      }
      if (best >= 0) picked = [best]
    }
    if (!picked.length) return            // empty: let the view orbit (a click clears, in the viewport)
    e.stopImmediatePropagation()
    const next = e.shiftKey ? new Set(st.sel) : new Set<number>()
    const all = picked.every((i) => next.has(i))
    for (const i of picked) { if (e.shiftKey && all) next.delete(i); else next.add(i) }
    st.sel = next
    emit()
    return
  }
  if (!hit) return
  e.stopImmediatePropagation()
  canvas3d.setPointerCapture(e.pointerId)
  orbit.enabled = false
  if (st.mode === 'paint') {
    const o = objData()
    if (!o) return
    paintOf(o)
    ensureBox(o.id, hit.mesh.geometry)
    beginStroke()
    stroke = { kind: 'paint' }
    dab(o.id, paintHit(hit), pressureOf(e))
    return
  }
  // sculpt
  const d = currentData()
  if (!d) return
  const g = hit.mesh.geometry
  if (st.tool === 'grab') {
    const local = hit.mesh.worldToLocal(hit.h.point.clone())
    const pos = g.getAttribute('position').array as Float32Array
    const r = st.radius / Math.max(1e-6, hit.mesh.scale.x)
    const weights = new Float32Array(pos.length / 3)
    for (let i = 0; i < weights.length; i++) {
      const dd = Math.hypot(pos[i * 3] - local.x, pos[i * 3 + 1] - local.y, pos[i * 3 + 2] - local.z)
      if (dd < r) { const t = 1 - dd / r; weights[i] = t * t * (3 - 2 * t) * st.strength * 2 }
    }
    const camDir = getCamera().getWorldDirection(new THREE.Vector3())
    stroke = { kind: 'grab', start: new Float32Array(pos), weights, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(camDir, hit.h.point), startLocal: local }
    return
  }
  if (st.tool === 'snake') {
    const camDir = getCamera().getWorldDirection(new THREE.Vector3())
    stroke = { kind: 'snake', plane: new THREE.Plane().setFromNormalAndCoplanarPoint(camDir, hit.h.point), startLocal: hit.mesh.worldToLocal(hit.h.point.clone()) }
    return
  }
  stroke = { kind: 'sculpt', nb: neighbors(d), lazy: [e.clientX, e.clientY], last: [e.clientX, e.clientY] }
  sculptAt(hit, e)
}

// One dab at a point on the screen (the lazy stroke calls this along its path).
function dabAt(x: number, y: number, e: PointerEvent) {
  const mesh = meshNow()
  if (!mesh) return
  const r = canvas3d.getBoundingClientRect()
  ray.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), getCamera())
  const h = ray.intersectObject(mesh, false)[0]
  if (h) sculptAt({ mesh, h }, e)
}

function sculptAt(hit: { mesh: THREE.Mesh; h: THREE.Intersection }, e: PointerEvent) {
  const g = hit.mesh.geometry
  const pos = g.getAttribute('position') as THREE.BufferAttribute
  const local = hit.mesh.worldToLocal(hit.h.point.clone())
  const n = hit.h.face?.normal.clone() ?? new THREE.Vector3(0, 1, 0)
  const p = pressureOf(e)
  const r = (st.radius * (st.pressSize && e.pointerType === 'pen' ? 0.35 + 0.65 * p : 1)) / Math.max(1e-6, hit.mesh.scale.x)
  // Shift smooths, Alt or Ctrl pushes in, whatever the brush.
  const tool: SculptTool = e.shiftKey ? 'smooth' : st.tool
  sculpt(pos.array as Float32Array, g.getAttribute('normal') as THREE.BufferAttribute, stroke?.nb ?? [], tool, { point: local, normal: n }, r, st.strength * (st.pressStrength ? p : 1), undefined, st.sym, st.invert || e.ctrlKey || e.altKey)
  pos.needsUpdate = true
  g.computeVertexNormals()
  g.computeBoundingSphere()
}

function onMove(e: PointerEvent) {
  if (st.mode === 'sculpt' || st.mode === 'paint') {
    const hit = hitMesh(e)
    if (hit) {
      const n = hit.h.face?.normal.clone().transformDirection(hit.mesh.matrixWorld) ?? new THREE.Vector3(0, 1, 0)
      ring.position.copy(hit.h.point).addScaledVector(n, 0.002)
      ring.lookAt(hit.h.point.clone().add(n))
      const od = objData()
      const rr = st.mode === 'paint' ? (od ? brushRadius(od.id) : 0.08) * Math.max(0.05, hit.mesh.scale.x) : st.radius
      ring.scale.setScalar(rr)
      ring.visible = true
    } else ring.visible = false
  } else ring.visible = false
  if (!stroke) return
  if (stroke.kind === 'paint') {
    const hit = hitMesh(e)
    const o = objData()
    if (hit && o) dab(o.id, paintHit(hit), pressureOf(e))
  } else if (stroke.kind === 'grab') {
    const mesh = meshNow()
    if (!mesh || !stroke.plane || !stroke.start || !stroke.weights || !stroke.startLocal) return
    ray.setFromCamera(ndc(e), getCamera())
    const p = ray.ray.intersectPlane(stroke.plane, new THREE.Vector3())
    if (!p) return
    const delta = mesh.worldToLocal(p).sub(stroke.startLocal)
    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute
    const arr = pos.array as Float32Array
    for (let i = 0; i < stroke.weights.length; i++) {
      const w = stroke.weights[i]
      if (!w) continue
      arr[i * 3] = stroke.start[i * 3] + delta.x * w; arr[i * 3 + 1] = stroke.start[i * 3 + 1] + delta.y * w; arr[i * 3 + 2] = stroke.start[i * 3 + 2] + delta.z * w
    }
    pos.needsUpdate = true
    mesh.geometry.computeVertexNormals()
    mesh.geometry.computeBoundingSphere()
  } else if (stroke.kind === 'snake') {
    // Pulls a tail out of the surface: the part under the brush follows the
    // pen, again and again, so the shape stretches along your stroke.
    const mesh = meshNow()
    if (!mesh || !stroke.plane || !stroke.startLocal) return
    ray.setFromCamera(ndc(e), getCamera())
    const p = ray.ray.intersectPlane(stroke.plane, new THREE.Vector3())
    if (!p) return
    const now = mesh.worldToLocal(p)
    const delta = now.clone().sub(stroke.startLocal)
    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute
    const arr = pos.array as Float32Array
    const r = st.radius / Math.max(1e-6, mesh.scale.x)
    const c = stroke.startLocal
    for (let i = 0; i < arr.length / 3; i++) {
      const dd = Math.hypot(arr[i * 3] - c.x, arr[i * 3 + 1] - c.y, arr[i * 3 + 2] - c.z)
      if (dd >= r) continue
      const t = 1 - dd / r, w = t * t * (3 - 2 * t) * Math.min(1, st.strength * 1.5)
      arr[i * 3] += delta.x * w; arr[i * 3 + 1] += delta.y * w; arr[i * 3 + 2] += delta.z * w
    }
    stroke.startLocal = now
    stroke.plane.setFromNormalAndCoplanarPoint(getCamera().getWorldDirection(new THREE.Vector3()), p)
    pos.needsUpdate = true
    mesh.geometry.computeVertexNormals()
    mesh.geometry.computeBoundingSphere()
  } else if (stroke.lazy && stroke.last) {
    // Lazy stroke: the brush trails the pen, which takes out the shake, then
    // dabs evenly along the way.
    const [lx, ly] = stroke.lazy
    const dx = e.clientX - lx, dy = e.clientY - ly, d = Math.hypot(dx, dy)
    if (d <= st.lazy) return
    const k = (d - st.lazy) / d
    stroke.lazy = [lx + dx * k, ly + dy * k]
    const [ax, ay] = stroke.last, [bx, by] = stroke.lazy
    const len = Math.hypot(bx - ax, by - ay), step = Math.max(1, st.spacing)
    if (len < step) return
    const n = Math.floor(len / step)
    for (let i = 1; i <= n; i++) dabAt(ax + ((bx - ax) * i * step) / len, ay + ((by - ay) * i * step) / len, e)
    stroke.last = [ax + ((bx - ax) * n * step) / len, ay + ((by - ay) * n * step) / len]
  }
}

function onUp() {
  if (!stroke) return
  const kind = stroke.kind
  stroke = null
  orbit.enabled = true
  if (kind === 'paint') {
    endStroke()
    savePaintNow('Paint')
    return
  }
  const mesh = meshNow(), d = currentData()
  if (mesh && d) commit({ p: Array.from(mesh.geometry.getAttribute('position').array as ArrayLike<number>), f: d.f }, kind === 'grab' ? 'Grab' : kind === 'snake' ? 'Snake' : 'Sculpt')
}

canvas3d.addEventListener('pointerdown', onDown, { capture: true })
canvas3d.addEventListener('pointermove', onMove)
window.addEventListener('pointerup', onUp)
canvas3d.addEventListener('pointerleave', () => { ring.visible = false })

// An editable mesh to start from, made right away.
export function newEditable(kind: 'cube' | 'sphere' | 'plane' | 'cylinder'): MeshData {
  const g = kind === 'sphere' ? new THREE.IcosahedronGeometry(0.7, 4)
    : kind === 'plane' ? new THREE.PlaneGeometry(2, 2, 16, 16).rotateX(-Math.PI / 2)
    : kind === 'cylinder' ? new THREE.CylinderGeometry(0.5, 0.5, 1.2, 24, 4)
    : new THREE.BoxGeometry(1, 1, 1, 2, 2, 2)
  const d = fromGeometry(g)
  g.dispose()
  return d
}
