import { Hint } from '../components/Tips'
import { dockApi } from '../shell/workspaces'
import { fontChoices } from '../shell/fonts'
import FontPicker from '../components/FontPicker'
import { COMIC_DEFAULT, TEXT_DEFAULT } from './textShape'
import { useParts } from './importers'
import { active3dTool, pick3dTool, run3dClick } from './tools3d'
import { DeformEditor, FluidEditor, PhysicsEditor, PoseEditor } from './RigPanels'
import ViewGizmo from './ViewGizmo'
import GroupPick from '../components/GroupPick'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import * as THREE from 'three'
import CodeBox from '../components/CodeBox'
import { NumberBox } from '../sections/Create'
import PopMenu from '../components/PopMenu'
import SignalPicker from '../components/SignalPicker'
import { onSharedChange, pictureLabel, pictureNames, shapeNames, sharedVersion } from '../engine/shared'
import { useTick } from '../engine/useTick'
import { toast } from '../components/Toasts'
import { goTo } from '../shell/workspaces'
import { downloadJson, pickFile } from '../shell/ui'
import {
  addViewer3d, allGizmos, editPivot, objectBox, onPivotEdit, pivotEditing, setPivot, canvas3d, exportGlb, focusSelected, isOrtho, setOrtho, getPointPicker, pick, pickFloor, pickPoint, setGizmoMode, setViewSize, shaderError, shapeError, type GizmoMode,
} from './engine'
import {
  CHROME_COLORS, DEFAULT_SHADER, LATE_KINDS, envOf, type WorldEnv, FOG_DEFAULT, KIND_LABEL, LAYER_LABEL, LINKABLE, MATERIAL_LABEL, MATERIAL_PRESETS, OUTLINE_DEFAULT, addObject, changeWorld, duplicateObject, getSelected3d, getWorld, isLight,
  newLayer, newObject, removeObject, replaceWorld, select3d, starterWorld, uid, updateObject, useWorld,
  type FogVol, type LayerKind, type MatDef, type MatLayer, type MaterialKind, type Obj3D, type ObjKind, type Outline, type NormalStyle, type PartSettings, type Vec3, type World3D,
} from './world'
import {
  enterMode, exitMode, fillObjectPaint, getEdit, growSelection, hasOldPaint, newEditable, restartObjectPaint, opDelete, opExtrude, opFlip, opSmooth, opSubdivide, selectAll, setEdit, useEdit,
} from './editmode'
import { animationsOf, modelTypeOf } from './importers'
import { BRUSH_MATS, brush, setBrushImage, type BrushTexture } from './paint'

// The 3D playground panels: the viewport, the list of things in the scene,
// and the settings of the selected thing. Keys:
// W move, E turn, R size, F focus, Delete, Ctrl+D duplicate.

const SHAPES: ObjKind[] = ['box', 'sphere', 'torus', 'knot', 'cylinder', 'cone', 'capsule', 'icosa', 'ring', 'plane']
const LIGHTS: ObjKind[] = ['point-light', 'spot-light', 'sun']
const MATH: ObjKind[] = ['math-surface', 'math-solid', 'code-shape']
const MATH_ABOUT: Partial<Record<ObjKind, string>> = {
  'math-surface': 'x, y, z from formulas',
  'math-solid': 'inside where a formula < 0',
  'code-shape': 'points and faces from code',
}

const useShared = () => useSyncExternalStore(onSharedChange, sharedVersion)

export async function importModel(file: File) {
  const type = modelTypeOf(file.name)
  if (!type) return toast('RICO opens .glb, .gltf (embedded), .fbx and .obj models.')
  const url = await new Promise<string>((res) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.readAsDataURL(file)
  })
  addObject(newObject('model', { name: file.name.replace(/\.[^.]+$/, ''), model: url, modelType: type, ownMaterials: type !== 'obj', material: 'standard', position: [0, 0, 0] }))
  toast(`${file.name} added.`, true)
}

// Export: the look baked so it opens the same in other apps, the plain
// scene, or the look as shader code.
const saveBlob = (blob: Blob, name: string) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click() }
export async function exportLookFile(size: 1024 | 2048 | 4096 = 2048) {
  toast('Baking the look...', true)
  try {
    const { exportLook } = await import('./bakeExport')
    saveBlob(await exportLook({ size, outlines: true, strokes: true, lit: false }), 'rico-look.glb')
    toast('Saved rico-look.glb. It opens in Blender, Unreal, Unity, TouchDesigner and Cinema 4D looking like this view.', true)
  } catch (e) { toast(`The export did not work: ${(e as Error).message}`) }
}
export async function exportShapesFile() { saveBlob(await exportGlb(), 'rico-scene.glb') }
export async function exportGlslFile() {
  const w = getWorld(), sel = w.objects.find((x) => x.id === getSelected3d())
  if (!sel || (sel.material !== 'custom' && sel.material !== 'iridescent')) return toast('Select a shape with My material (layers), a drawn look or Iridescent first.')
  const { lookGlsl, filmLayers } = await import('./materials')
  const layers = sel.material === 'iridescent' ? filmLayers(sel) : w.materials?.find((m) => m.id === sel.matId)?.layers ?? []
  const name = sel.material === 'iridescent' ? 'Iridescent chrome' : w.materials?.find((m) => m.id === sel.matId)?.name ?? 'My material'
  saveBlob(new Blob([lookGlsl(name, layers, sel.color)], { type: 'text/plain' }), `${name.replace(/[^\w -]/g, '')}.glsl`)
}
export function snapshotPng() { canvas3d.toBlob((b) => { if (b) saveBlob(b, 'rico-3d.png') }, 'image/png') }

export function AddMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement | null>(null)
  const add = (k: ObjKind) => { addObject(newObject(k)); setOpen(false) }
  return (
    <div className="three-add">
      <button ref={ref} className="btn small primary" onClick={() => setOpen(!open)} aria-expanded={open}>+ Add</button>
      {open && (
        <PopMenu anchor={ref} onClose={() => setOpen(false)} className="three-add-list">
          <div className="menu-head">Shapes</div>
          {SHAPES.map((k) => <button key={k} role="menuitem" onClick={() => add(k)}><span>{KIND_LABEL[k]}</span></button>)}
          <hr />
          <div className="menu-head">Text and comics</div>
          <button role="menuitem" onClick={() => add('text')}><span>3D text</span><span className="dim small">in any font, yours too</span></button>
          <button role="menuitem" onClick={() => add('comic')}><span>Comic page</span><span className="dim small">hollow panels to put things in</span></button>
          <hr />
          <div className="menu-head">Lights</div>
          {LIGHTS.map((k) => <button key={k} role="menuitem" onClick={() => add(k)}><span>{KIND_LABEL[k]}</span></button>)}
          <button role="menuitem" onClick={() => add('fog')}><span>Fog volume</span><span className="dim small">air the light shows in</span></button>
          <hr />
          <div className="menu-head">Math and code</div>
          {MATH.map((k) => <button key={k} role="menuitem" onClick={() => add(k)}><span>{KIND_LABEL[k]}</span><span className="dim small">{MATH_ABOUT[k]}</span></button>)}
          <button role="menuitem" onClick={() => {
            setOpen(false)
            const names = shapeNames()
            if (!names.length) return toast('No node shapes yet. In Nodes, add a Geometry network that ends in "Shape out".')
            addObject(newObject('shape', { name: names[0], shape: names[0] }))
          }}><span>Node shape</span><span className="dim small">from a node network</span></button>
          <hr />
          <div className="menu-head">Model it yourself</div>
          {(['cube', 'sphere', 'plane', 'cylinder'] as const).map((k) => (
            <button key={k} role="menuitem" onClick={() => {
              setOpen(false)
              const o = newObject('mesh', { name: `Editable ${k}`, mesh: newEditable(k), meshRev: 1, material: 'standard', color: '#b9a8ff', position: k === 'plane' ? [0, 0.01, 0] : [0, 1, 0] })
              addObject(o)
              window.setTimeout(() => enterMode('edit'), 50)
            }}><span>Editable {k}</span><span className="dim small">points and faces</span></button>
          ))}
          <hr />
          <button role="menuitem" onClick={() => { setOpen(false); pickFile('.glb,.gltf,.fbx,.obj', importModel) }}><span>Import a model...</span><span className="dim small">.glb .fbx .obj</span></button>
        </PopMenu>
      )}
    </div>
  )
}

const SCULPT_TIP: Record<string, string> = {
  draw: 'Pushes the surface out along the stroke', clay: 'Builds up flat layers, like adding clay', crease: 'Cuts a sharp line',
  inflate: 'Swells the surface', smooth: 'Smooths bumps (or hold Shift with any brush)', flatten: 'Makes it flat', pinch: 'Pulls points together',
  grab: 'Moves a part of the shape with the pen', snake: 'Pulls a tail out of the surface along your stroke',
}

// The tools of Edit, Sculpt and Paint mode, above the view.
function ModeBar() {
  const ed = useEdit()
  const o = useWorld((w) => w.objects.find((x) => x.id === ed.target))
  const [, redraw] = useState(0)
  const n = o?.mesh ? `${o.mesh.p.length / 3} points, ${o.mesh.f.length / 3} faces` : ''
  if (ed.mode === 'edit') return (
    <div className="three-bar mode-bar">
      <b className="lime">Edit</b>
      <div className="seg">{(['vertex', 'face'] as const).map((m) => <button key={m} className={ed.selectMode === m ? 'on' : ''} onClick={() => setEdit({ selectMode: m })}>{m === 'vertex' ? 'Points' : 'Faces'}</button>)}</div>
      <label className="switch mini" title="See and pick points behind the surface"><input type="checkbox" role="switch" checked={ed.xray} onChange={(e) => setEdit({ xray: e.target.checked })} /><span>See through</span></label>
      <button className="btn small" onClick={opExtrude} title="E">Extrude</button>
      <button className="btn small quiet" onClick={opDelete} title="X">Delete</button>
      <button className="btn small quiet" onClick={opSubdivide} title="Each face becomes four">Subdivide</button>
      <button className="btn small quiet" onClick={opSmooth} title="Smooth the selection (or all)">Smooth</button>
      <button className="btn small quiet" onClick={opFlip} title="Turn the faces inside out">Flip</button>
      <button className="btn small quiet" onClick={() => selectAll(true)} title="A">All</button>
      <button className="btn small quiet" onClick={growSelection}>Grow</button>
      <span className="dim small">{ed.sel.size} selected. {n}</span>
      <span className="grow" />
      <button className="btn small primary" onClick={exitMode}>Done (Tab)</button>
    </div>
  )
  if (ed.mode === 'sculpt') return (
    <div className="three-bar mode-bar">
      <b className="lime">Sculpt</b>
      <div className="seg">{([['draw', 'Draw'], ['clay', 'Clay'], ['crease', 'Crease'], ['inflate', 'Inflate'], ['smooth', 'Smooth'], ['flatten', 'Flatten'], ['pinch', 'Pinch'], ['grab', 'Move'], ['snake', 'Snake']] as const).map(([t, l]) => <button key={t} className={ed.tool === t ? 'on' : ''} onClick={() => setEdit({ tool: t })} title={SCULPT_TIP[t]}>{l}</button>)}</div>
      <label className="mini">Size <NumberBox value={ed.radius} digits={3} onChange={(v) => setEdit({ radius: Math.max(0.005, v) })} /></label>
      <label className="mini">Strength <input className="range" type="range" min={0.02} max={1} step={0.01} value={ed.strength} onChange={(e) => setEdit({ strength: Number(e.target.value) })} /></label>
      <label className="switch mini"><input type="checkbox" role="switch" checked={ed.sym} onChange={(e) => setEdit({ sym: e.target.checked })} /><span>Mirror X</span></label>
      <label className="switch mini" title="Or hold Alt (or Ctrl)"><input type="checkbox" role="switch" checked={ed.invert} onChange={(e) => setEdit({ invert: e.target.checked })} /><span>Push in</span></label>
      <label className="mini" title="The brush trails the pen by this many pixels, so lines come out smooth">Lazy <input className="range" type="range" min={0} max={60} step={1} value={ed.lazy} onChange={(e) => setEdit({ lazy: Number(e.target.value) })} /></label>
      <label className="mini" title="Pixels between dabs">Spacing <input className="range" type="range" min={1} max={30} step={1} value={ed.spacing} onChange={(e) => setEdit({ spacing: Number(e.target.value) })} /></label>
      <label className="mini-check" title="Pen pressure changes the size"><input type="checkbox" checked={ed.pressSize} onChange={(e) => setEdit({ pressSize: e.target.checked })} />Pressure: size</label>
      <label className="mini-check" title="Pen pressure changes the strength"><input type="checkbox" checked={ed.pressStrength} onChange={(e) => setEdit({ pressStrength: e.target.checked })} />strength</label>
      <label className="switch mini" title="Move, turn and size the whole object with the arrows"><input type="checkbox" role="switch" checked={ed.moveObject} onChange={(e) => setEdit({ moveObject: e.target.checked })} /><span>Move object</span></label>
      <button className="btn small quiet" onClick={opSubdivide} title="More points to sculpt with">More detail</button>
      <span className="dim small">{n}</span>
      <span className="grow" />
      <button className="btn small primary" onClick={exitMode}>Done</button>
    </div>
  )
  const up = () => redraw((x) => x + 1)
  return (
    <div className="three-bar mode-bar">
      <b className="lime">Paint</b>
      <label className="mini" title="What the brush paints: a color, or a material (gloss, metal, glowing neon, see-through glass, bumps), or a mask">Brush
        <select className="select mini" value={brush.target === 'mask' ? -1 : brush.mat} onChange={(e) => { const v = Number(e.target.value); if (v < 0) { brush.target = 'mask' } else { brush.target = 'color'; brush.mat = v } up() }}>
          {BRUSH_MATS.map((m, i) => <option key={m.name} value={m.mask ? -1 : i}>{m.name}</option>)}
        </select></label>
      <label className="mini" title="The texture of the brush">Texture
        <select className="select mini" value={brush.texture} onChange={(e) => { brush.texture = e.target.value as BrushTexture; up() }}>
          <option value="soft">Soft</option><option value="bristle">Bristles</option><option value="grain">Grain</option><option value="canvas">Canvas</option><option value="dots">Dots</option><option value="image">My picture</option>
        </select></label>
      <button className="btn small quiet" title="Use a picture as the brush texture (bright parts paint)" onClick={() => pickFile('image/*', (f) => { const img = new Image(); img.onload = () => { setBrushImage(img, img.naturalWidth, img.naturalHeight); up() }; img.src = URL.createObjectURL(f) })}>Brush picture...</button>
      {brush.target === 'color' && !BRUSH_MATS[brush.mat]?.tint && BRUSH_MATS[brush.mat]?.color !== undefined && <input type="color" className="swatch" value={brush.color} onChange={(e) => { brush.color = e.target.value; up() }} aria-label="Brush color" />}
      <label className="mini">Size <NumberBox value={brush.size} digits={0} onChange={(v) => { brush.size = Math.max(1, v); up() }} /></label>
      <label className="mini">Strength <input className="range" type="range" min={0.02} max={1} step={0.01} value={brush.opacity} onChange={(e) => { brush.opacity = Number(e.target.value); up() }} /></label>
      <label className="mini">Hard <input className="range" type="range" min={0} max={0.95} step={0.01} value={brush.hardness} onChange={(e) => { brush.hardness = Number(e.target.value); up() }} /></label>
      <label className="switch mini"><input type="checkbox" role="switch" checked={brush.erase} onChange={(e) => { brush.erase = e.target.checked; up() }} /><span>Eraser</span></label>
      <label className="switch mini" title="Move the whole object with the arrows"><input type="checkbox" role="switch" checked={ed.moveObject} onChange={(e) => setEdit({ moveObject: e.target.checked })} /><span>Move object</span></label>
      <button className="btn small quiet" onClick={() => { if (o) fillObjectPaint(false) }}>Fill</button>
      <button className="btn small quiet" onClick={() => { if (o) fillObjectPaint(true) }}>Clear</button>
      {o && hasOldPaint() && <button className="btn small out" title="This paint was made by an older version and wraps around the model, so it can show seams. Start over with the new paint that has no seams." onClick={restartObjectPaint}>Start over without seams</button>}
      <span className="grow" />
      <button className="btn small primary" onClick={exitMode}>Done</button>
    </div>
  )
}

export function Viewport3D() {
  const host = useRef<HTMLDivElement | null>(null)
  const down = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const el = host.current
    if (!el) return
    el.appendChild(canvas3d)
    addViewer3d(true)
    const ro = new ResizeObserver(() => setViewSize(el.clientWidth, el.clientHeight))
    ro.observe(el)
    return () => {
      ro.disconnect()
      addViewer3d(false)
      if (canvas3d.parentElement === el) el.removeChild(canvas3d)
    }
  }, [])

  const tool = (m: GizmoMode) => setGizmoMode(m)
  const edit = useEdit()

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as Element).closest('input, select, textarea')) return
    const sel = getSelected3d()
    const k = e.key.toLowerCase()
    if (e.key === 'Tab') { e.preventDefault(); if (getEdit().mode === 'edit') exitMode(); else enterMode('edit'); return }
    if (getEdit().mode === 'edit') {
      if (k === 'e') { opExtrude(); return }
      if (k === 'x' || e.key === 'Delete' || e.key === 'Backspace') { opDelete(); return }
      if (k === 'a') { selectAll(!e.altKey); return }
      if (e.key === 'Escape') { exitMode(); return }
    }
    if (getEdit().mode !== 'object' && e.key === 'Escape') { exitMode(); return }
    if (getEdit().mode === 'sculpt' || getEdit().mode === 'paint') {
      if (e.key === '[') { if (getEdit().mode === 'paint') { brush.size = Math.max(2, brush.size * 0.8); setEdit({}) } else setEdit({ radius: Math.max(0.01, getEdit().radius * 0.8) }); return }
      if (e.key === ']') { if (getEdit().mode === 'paint') { brush.size = Math.min(400, brush.size * 1.25); setEdit({}) } else setEdit({ radius: getEdit().radius * 1.25 }); return }
    }
    if (k === 'w') tool('translate')
    else if (k === 'e') tool('rotate')
    else if (k === 'r') tool('scale')
    else if (k === 'q') tool('all')
    else if (k === 'f') focusSelected()
    else if (k === '5') setOrtho(!isOrtho())
    else if ((e.ctrlKey || e.metaKey) && k === 'a' && getEdit().mode === 'object') { e.preventDefault(); void import('./AttrBox').then((m) => m.openAttr()) }
    else if (k === 'g') changeWorld('Grid', (w) => ({ ...w, grid: !w.grid }))
    else if (e.key === 'Escape') { if (active3dTool()) pick3dTool(null); else select3d(null) }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && sel) removeObject(sel)
    else if ((e.ctrlKey || e.metaKey) && k === 'd' && sel) { e.preventDefault(); duplicateObject(sel) }
    else if (k === 'd' && sel) editPivot(!pivotEditing())
  }

  return (
    <div className="three" tabIndex={0} onKeyDown={onKey}>
      {edit.mode !== 'object' && <ModeBar />}
      <ViewGizmo />
      <div
        className="three-view"
        ref={host}
        onPointerDown={(e) => { down.current = { x: e.clientX, y: e.clientY } }}
        onPointerUp={(e) => {
          const d = down.current
          down.current = null
          if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return   // that was an orbit drag
          if (getEdit().mode === 'edit') { if (!e.shiftKey) setEdit({ sel: new Set() }); return }
          if (getEdit().mode !== 'object') return
          if (allGizmos.some((g) => g.axis)) return            // that was a gizmo handle
          if (active3dTool()) { const hit = pick(e.clientX, e.clientY); if (run3dClick(pickPoint(e.clientX, e.clientY) ?? pickFloor(e.clientX, e.clientY), hit)) return }
          const picker = getPointPicker()
          if (picker) { const p = pickPoint(e.clientX, e.clientY); if (p) picker(p); else toast('Click on an object.'); return }
          const id = pick(e.clientX, e.clientY)
          if (id !== getSelected3d()) select3d(id)
        }}
        onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
        onDrop={(e) => { const f = e.dataTransfer.files?.[0]; if (f) { e.preventDefault(); importModel(f) } }}
      />
      <div className="three-hint"><Hint label={edit.mode === 'edit' ? 'Edit mode' : edit.mode === 'sculpt' ? 'Sculpt' : edit.mode === 'paint' ? 'Paint' : 'Mouse and keys'} docs="WORKSPACES.md#3d" text={edit.mode === 'edit' ? 'Click points (Shift adds), drag the arrows to move them. With nothing selected the arrows move the whole object. E extrude, X delete, A all, Alt+A none, Tab back.'
        : edit.mode === 'sculpt' ? 'Drag on the surface. Shift smooths, Alt pushes in, [ and ] change the size. A pen changes size and strength with pressure.'
        : edit.mode === 'paint' ? 'Paint on the object. [ and ] change the size. A pen changes size and strength with pressure.'
        : 'Drag to orbit, right-drag to pan, scroll to zoom. Click to select. W move, E turn, R size, F focus, Ctrl+D duplicate, Tab edit.'} /></div>
    </div>
  )
}

const ICON: Partial<Record<ObjKind, string>> = { fog: '\u2601', 'point-light': '✦', 'spot-light': '◬', sun: '☀', model: '▣', plane: '▭', 'math-surface': 'ƒ', 'math-solid': 'ƒ', 'code-shape': '{}', shape: '⬡' }

// Formulas and code for shapes you build with math.
function ShapeEditor({ o }: { o: Obj3D }) {
  useTick(500)
  useShared()
  const set = (part: Partial<Obj3D>, key: string) => updateObject(o.id, part, 'Change shape', `${o.id}.${key}`)
  const err = shapeError(o.id)
  if (o.kind === 'shape') {
    const names = shapeNames()
    return (
      <div className="three-shape">
        <label className="param"><span className="param-label">Shape from nodes</span>
          <select className="select" value={o.shape ?? ''} onChange={(e) => updateObject(o.id, { shape: e.target.value }, 'Node shape')}>
            {!names.includes(o.shape ?? '') && <option value={o.shape ?? ''}>{o.shape || 'Pick one'} (not made yet)</option>}
            {names.map((n) => <option key={n} value={n}>{n}</option>)}
          </select></label>
        <p className="dim small">Change the shape in its node network. Here you give it a material, a place and links.</p>
      </div>
    )
  }
  return (
    <div className="three-shape">
      {o.kind === 'math-surface' && <>
        <p className="dim small">u and v go from 0 to 1 across the surface. You can use t (time), a, b, sin, cos, PI, TAU, noise(x, y, z) and more.</p>
        <CodeBox label="x =" rows={2} value={o.fx ?? ''} onChange={(fx) => set({ fx }, 'fx')} />
        <CodeBox label="y =" rows={2} value={o.fy ?? ''} onChange={(fy) => set({ fy }, 'fy')} />
        <CodeBox label="z =" rows={2} value={o.fz ?? ''} onChange={(fz) => set({ fz }, 'fz')} />
      </>}
      {o.kind === 'math-solid' && <>
        <p className="dim small">The shape is everywhere this formula of x, y, z is below zero, like a signed distance field. min() joins shapes, max() cuts them.</p>
        <CodeBox label="Inside where" rows={3} value={o.solid ?? ''} onChange={(solid) => set({ solid }, 'solid')} />
      </>}
      {o.kind === 'code-shape' && <>
        <p className="dim small">JavaScript. point(x, y, z) adds a point and gives its number. tri(i, j, k) and quad(i, j, k, l) make faces. You can also return any three.js geometry.</p>
        <CodeBox label="Code" rows={12} value={o.code ?? ''} onChange={(code) => set({ code }, 'code')} />
      </>}
      {err && <p className="codebox-err">{err}</p>}
      {o.kind !== 'code-shape' && <Slider label="Detail" value={o.res ?? 64} min={8} max={o.kind === 'math-solid' ? 96 : 400} step={1} onChange={(res) => set({ res }, 'res')} />}
      <Slider label="a" value={o.a ?? 0} min={0} max={1} onChange={(a) => set({ a }, 'a')} />
      <Slider label="b" value={o.b ?? 0} min={0} max={1} onChange={(b) => set({ b }, 'b')} />
    </div>
  )
}

// The picture and shader materials: Create (or a node network) as a skin.
function SurfaceEditor({ o }: { o: Obj3D }) {
  useTick(500)
  useShared()
  const set = (part: Partial<Obj3D>, key: string) => updateObject(o.id, part, 'Change material', `${o.id}.${key}`)
  const pics = pictureNames()
  const picSelect = (
    <label className="param"><span className="param-label">Picture</span>
      <select className="select" value={o.picture || 'Create'} onChange={(e) => updateObject(o.id, { picture: e.target.value }, 'Picture')}>
        {pics.map((n) => <option key={n} value={n}>{n === 'Create' ? 'Motion (what you see in Motion)' : n}</option>)}
      </select></label>
  )
  if (o.material === 'picture') {
    return (
      <div className="three-shape">
        {picSelect}
        <Slider label="Repeat" value={o.uvScale ?? 1} min={0.25} max={16} step={0.25} onChange={(uvScale) => set({ uvScale }, 'uv')} />
        <Slider label="Scroll speed" value={o.uvSpeed ?? 0} min={0} max={2} onChange={(uvSpeed) => set({ uvSpeed }, 'uvs')} />
        <button className="btn small quiet" onClick={() => goTo('create')}>Edit the picture in Motion</button>
      </div>
    )
  }
  if (o.material === 'shader') {
    return (
      <div className="three-shape">
        <p className="dim small">GLSL. Set col (and alpha). You have vUv, vNormal, vPos, uTime, uA, uB, uColor and uPicture (a picture below).</p>
        <CodeBox label="Shader" rows={10} value={o.shader || DEFAULT_SHADER} onChange={(shader) => set({ shader }, 'shader')} error={shaderError()} />
        {picSelect}
        <Slider label="Repeat" value={o.uvScale ?? 1} min={0.25} max={16} step={0.25} onChange={(uvScale) => set({ uvScale }, 'uv')} />
        <Slider label="a" value={o.a ?? 0} min={0} max={1} onChange={(a) => set({ a }, 'a')} />
        <Slider label="b" value={o.b ?? 0} min={0} max={1} onChange={(b) => set({ b }, 'b')} />
      </div>
    )
  }
  return null
}

// ---- materials you build from layers ----

function Swatches({ colors, onChange, max = 4 }: { colors: string[]; onChange: (c: string[]) => void; max?: number }) {
  return (
    <span className="swatches">
      {colors.map((c, i) => (
        <input key={i} type="color" className="swatch mini" value={c} onChange={(e) => { const n = [...colors]; n[i] = e.target.value; onChange(n) }}
          onContextMenu={(e) => { e.preventDefault(); if (colors.length > 1) onChange(colors.filter((_, k) => k !== i)) }} title="Right-click to remove" />
      ))}
      {colors.length < max && <button className="icon-btn small" title="Add a color" onClick={() => onChange([...colors, colors[colors.length - 1] ?? '#ffffff'])}>+</button>}
    </span>
  )
}

function LayerCard({ m, l, i }: { m: MatDef; l: MatLayer; i: number }) {
  useShared()
  const set = (part: Partial<MatLayer>, label = 'Change layer') => changeWorld(label, (w) => ({ ...w, materials: (w.materials ?? []).map((x) => (x.id === m.id ? { ...x, layers: x.layers.map((y) => (y.id === l.id ? { ...y, ...part } : y)) } : x)) }), `mat.${l.id}.${Object.keys(part).join()}`)
  const move = (d: number) => changeWorld('Reorder layers', (w) => ({ ...w, materials: (w.materials ?? []).map((x) => {
    if (x.id !== m.id) return x
    const a = [...x.layers]; const j = i + d
    if (j < 0 || j >= a.length) return x
    ;[a[i], a[j]] = [a[j], a[i]]
    return { ...x, layers: a }
  }) }))
  return (
    <div className={`fx-card${l.on ? '' : ' off'}`}>
      <div className="fx-head">
        <button className={`fx-on${l.on ? ' on' : ''}`} onClick={() => set({ on: !l.on }, 'Layer on/off')}>{l.on ? 'on' : 'off'}</button>
        <select className="select mini" value={l.kind} onChange={(e) => set({ kind: e.target.value as LayerKind }, 'Layer kind')}>
          {Object.entries(LAYER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <span className="grow" />
        <button className="icon-btn small" disabled={i === 0} onClick={() => move(-1)} title="Earlier">{'\u25B2'}</button>
        <button className="icon-btn small" disabled={i === m.layers.length - 1} onClick={() => move(1)} title="Later">{'\u25BC'}</button>
        <button className="icon-btn small danger" title="Remove" onClick={() => changeWorld('Remove layer', (w) => ({ ...w, materials: (w.materials ?? []).map((x) => (x.id === m.id ? { ...x, layers: x.layers.filter((y) => y.id !== l.id) } : x)) }))}>{'\u00D7'}</button>
      </div>
      <div className="fx-body">
        {l.kind !== 'picture' && l.kind !== 'paint' && !(l.kind === 'strokes' && (l.target === 'normal' || l.target === 'cutout')) && <div className="row gap"><span className="param-label">Colors</span><Swatches colors={l.colors} max={l.kind === 'color' ? 1 : 4} onChange={(colors) => set({ colors })} /></div>}
        {l.kind === 'picture' && (
          <label className="param"><span className="param-label">Picture</span>
            <select className="select" value={l.picture || 'Create'} onChange={(e) => set({ picture: e.target.value })}>{pictureNames().map((n) => <option key={n} value={n}>{pictureLabel(n)}</option>)}</select></label>
        )}
        {l.kind === 'paint' && <p className="dim small">Paint mode puts your colors here.</p>}
        <Slider label="Amount" value={l.amount} min={0} max={l.target === 'glow' ? 5 : 1} onChange={(amount) => set({ amount })} />
        {!['color', 'paint'].includes(l.kind) && <Slider label={l.kind === 'fresnel' ? 'Edge width' : l.kind === 'iridescent' ? 'Film bands' : l.kind === 'strokes' ? 'Stroke size' : ['halftone', 'misprint', 'hatch', 'newsprint'].includes(l.kind) ? 'Size (bigger lines and dots)' : 'Scale'} value={l.scale} min={l.kind === 'strokes' ? 0.01 : 0.1} max={l.kind === 'stripes' ? 80 : l.kind === 'strokes' ? 1 : 20} step={l.kind === 'strokes' ? 0.005 : 0.01} onChange={(scale) => set({ scale })} />}
        {['height', 'noise', 'stripes', 'iridescent', 'picture', 'chrome', 'watercolor'].includes(l.kind) && <Slider label="Moves" value={l.speed} min={-2} max={2} onChange={(speed) => set({ speed })} />}
        {['halftone', 'misprint', 'hatch', 'newsprint'].includes(l.kind) && <Slider label="Redrawn a second (boil)" value={l.speed} min={0} max={24} step={1} onChange={(speed) => set({ speed })} />}
        {['halftone', 'misprint', 'hatch'].includes(l.kind) && <Slider label={l.kind === 'halftone' ? 'Dot size' : 'Line thickness'} value={l.thick ?? 1} min={0.2} max={3} onChange={(thick) => set({ thick })} />}
        {l.kind === 'newsprint' && <>
          <div className="seg" role="group" aria-label="Colors">
            {([['mono', 'One color'], ['dual', 'Two colors'], ['full', 'Full color']] as const).map(([k, lb]) => (
              <button key={k} className={(l.paper ?? 'full') === k ? 'on' : ''} onClick={() => set({ paper: k })}>{lb}</button>
            ))}
          </div>
          <Slider label="Scraps stand off the shape" value={l.lift ?? 1} min={0} max={4} onChange={(lift) => set({ lift })} />
          <Slider label="Crumpled" value={l.crumple ?? 1} min={0} max={3} onChange={(crumple) => set({ crumple })} />
          <Slider label="Scrap size" value={l.scrap ?? 1} min={0.3} max={4} onChange={(scrap) => set({ scrap })} />
        </>}
        {LATE_KINDS.includes(l.kind) && <p className="dim small">{LATE_TIP[l.kind]}</p>}
        {l.kind === 'strokes' && <>
          <Slider label="Stroke length" value={l.length ?? 3} min={1} max={12} step={0.1} onChange={(length) => set({ length })} />
          <Slider label="Stroke direction (degrees)" value={l.angle ?? 0} min={-180} max={180} step={1} onChange={(angle) => set({ angle })} />
          <Slider label="Redraw (times a second, 0 = still)" value={l.speed} min={0} max={24} step={1} onChange={(speed) => set({ speed })} />
          <p className="dim small">Into Bumps (normal) breaks the light into flat dabs like paint. Into Ragged edge cuts strokes away at the outline. Into Color mixes your colors per stroke.</p>
        </>}
        <label className="mini-check" title="This layer's amount follows the object's Material drive link"><input type="checkbox" checked={Boolean(l.react)} onChange={(e) => set({ react: e.target.checked })} />Reacts (Material drive)</label>
        <div className="row gap wrap">
          <label className="mini">Into <select className="select mini" value={l.target} onChange={(e) => set({ target: e.target.value as MatLayer['target'] })}>
            <option value="color">Color</option><option value="glow">Glow</option><option value="rough">Roughness</option><option value="metal">Metal</option><option value="normal">Bumps (normal)</option><option value="cutout">Ragged edge</option></select></label>
          <label className="mini">Blend <select className="select mini" value={l.blend} onChange={(e) => set({ blend: e.target.value as MatLayer['blend'] })}>
            <option value="mix">Normal</option><option value="add">Add</option><option value="multiply">Multiply</option><option value="screen">Screen</option></select></label>
          <label className="mini">Only where <select className="select mini" value={l.mask} onChange={(e) => set({ mask: e.target.value as MatLayer['mask'] })}>
            <option value="none">Everywhere</option><option value="paint">Your painted mask</option><option value="paint-inverse">Not your painted mask</option>
            <option value="fresnel">Edges</option><option value="height">Higher up</option><option value="noise">Noise spots</option></select></label>
        </div>
      </div>
    </div>
  )
}

function MaterialEditor({ o }: { o: Obj3D }) {
  const mats = useWorld((w) => w.materials ?? [])
  const id = o.kind === 'model' ? o.parts?.['*']?.matId ?? o.matId : o.matId
  const m = mats.find((x) => x.id === id)
  if (!m) return null
  return (
    <div className="three-shape">
      <div className="row gap">
        <span className="param-label grow">{m.look ? 'The layers of this look' : 'Your material'}</span>
        <button className="btn small quiet" title="Keep these layers as one of your own materials, to use on other things" onClick={() => {
          const nid = uid()
          changeWorld('Copy material', (w) => ({ ...w, materials: [...(w.materials ?? []), { id: nid, name: `${m.name.replace(/ \(.*\)$/, '')} (mine)`, layers: m.layers.map((l) => ({ ...l, id: uid() })) }], objects: w.objects.map((x) => (x.id === o.id ? { ...x, matId: nid, ...(x.kind === 'model' ? { parts: { ...(x.parts ?? {}), '*': { ...(x.parts?.['*'] ?? {}), mode: 'replace' as const, matId: nid } } } : {}) } : x)) }))
        }}>Save as mine</button>
      </div>
      {!m.look && <input className="input" value={m.name} aria-label="Material name" onChange={(e) => changeWorld('Rename material', (w) => ({ ...w, materials: (w.materials ?? []).map((x) => (x.id === m.id ? { ...x, name: e.target.value } : x)) }), `matname.${m.id}`)} />}
      <p className="dim small">Layers go on top of the color, roughness and metal below, first to last. Link or animate "Look size" and "Look line thickness" to move them.</p>
      {m.layers.map((l, i) => <LayerCard key={l.id} m={m} l={l} i={i} />)}
      <select className="select" value="" onChange={(e) => { const k = e.target.value as LayerKind; if (k) changeWorld('Add layer', (w) => ({ ...w, materials: (w.materials ?? []).map((x) => (x.id === m.id ? { ...x, layers: [...x.layers, newLayer(k)] } : x)) })) }}>
        <option value="">+ Add a layer...</option>
        {Object.entries(LAYER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <button className="btn small" onClick={() => enterMode('paint')}>Paint on it</button>
    </div>
  )
}

function FilmEditor({ o }: { o: Obj3D }) {
  const set = (part: Partial<Obj3D>, key: string) => updateObject(o.id, part, 'Change film', `${o.id}.${key}`)
  return (
    <div className="three-shape">
      <div className="row gap"><span className="param-label">Film colors</span><Swatches colors={o.colors?.length ? o.colors : CHROME_COLORS} onChange={(colors) => set({ colors }, 'colors')} /></div>
      <Slider label="Bands" value={o.filmScale ?? 1.4} min={0.1} max={8} onChange={(filmScale) => set({ filmScale }, 'fs')} />
      <Slider label="Flow" value={o.filmSpeed ?? 0.05} min={-1} max={1} onChange={(filmSpeed) => set({ filmSpeed }, 'fsp')} />
      <p className="dim small">Link "Film color shift" to the audio to make the colors move with the music.</p>
    </div>
  )
}

function TextEditor({ o }: { o: Obj3D }) {
  const t = { ...TEXT_DEFAULT, ...(o.text3d ?? {}) }
  const set = (part: Partial<typeof t>, key: string) => updateObject(o.id, { text3d: { ...t, ...part } }, 'Text', `${o.id}.t.${key}`)
  const err = shapeError(o.id)
  return (
    <div className="three-shape">
      <textarea className="input" rows={2} value={t.text} onChange={(e) => set({ text: e.target.value }, 'x')} aria-label="Text" />
      <FontPicker by="name" value={t.font} onChange={(font) => set({ font }, 'f')} />
      {err && <p className="warn-text small">{err}</p>}
      <Slider label="Size" value={t.size} min={0.05} max={3} step={0.01} onChange={(size) => set({ size }, 's')} />
      <Slider label="Depth" value={t.depth} min={0} max={1.5} step={0.005} onChange={(depth) => set({ depth }, 'd')} />
      <Slider label="Rounded edge" value={t.bevel} min={0} max={0.08} step={0.001} onChange={(bevel) => set({ bevel }, 'b')} />
      <Slider label="Letter spacing" value={t.spacing} min={-0.2} max={0.6} step={0.005} onChange={(spacing) => set({ spacing }, 'sp')} />
      <Slider label="Smooth curves" value={t.curve} min={1} max={24} step={1} onChange={(curve) => set({ curve }, 'c')} />
      <div className="seg" role="group" aria-label="Align">{(['left', 'center', 'right'] as const).map((a) => <button key={a} className={t.align === a ? 'on' : ''} onClick={() => set({ align: a }, 'a')}>{a === 'left' ? 'Left' : a === 'center' ? 'Middle' : 'Right'}</button>)}</div>
    </div>
  )
}

function ComicEditor({ o }: { o: Obj3D }) {
  const c = { ...COMIC_DEFAULT, ...(o.comic ?? {}) }
  const set = (part: Partial<typeof c>, key: string) => updateObject(o.id, { comic: { ...c, ...part } }, 'Comic page', `${o.id}.c.${key}`)
  return (
    <div className="three-shape">
      <Slider label="Rows" value={c.rows} min={1} max={6} step={1} onChange={(rows) => set({ rows }, 'r')} />
      <Slider label="Panels across" value={c.cols} min={1} max={5} step={1} onChange={(cols) => set({ cols }, 'c')} />
      <Slider label="Width" value={c.width} min={0.5} max={8} step={0.01} onChange={(width) => set({ width }, 'w')} />
      <Slider label="Height" value={c.height} min={0.5} max={10} step={0.01} onChange={(height) => set({ height }, 'h')} />
      <Slider label="Gutter" value={c.gutter} min={0.01} max={0.4} step={0.005} onChange={(gutter) => set({ gutter }, 'g')} />
      <Slider label="Border" value={c.border} min={0.02} max={0.6} step={0.005} onChange={(border) => set({ border }, 'b')} />
      <Slider label="Depth" value={c.depth} min={0.01} max={2} step={0.01} onChange={(depth) => set({ depth }, 'd')} />
      <Slider label="Tilted panels" value={c.tilt} min={0} max={1} onChange={(tilt) => set({ tilt }, 't')} />
      <div className="row gap">
        <button className="btn small quiet" onClick={() => set({ seed: c.seed + 1 }, 'seed')}>Shuffle the panels</button>
        <label className="mini-check"><input type="checkbox" checked={c.back} onChange={(e) => set({ back: e.target.checked }, 'back')} />Closed back</label>
      </div>
      <p className="dim small">The panels are open windows: put 3D things inside them, or behind them for depth. The Cartoon material with an outline makes it look printed.</p>
    </div>
  )
}

// Stylized normals: change how light falls on the shape without changing the shape.
function NormalEditor({ o, value, onSet }: { o: Obj3D; value?: NormalStyle; onSet?: (n: NormalStyle, key: string) => void }) {
  const n = { round: 0, facets: 0, noise: 0, noiseSize: 3, ...((onSet ? value : o.normals) ?? {}) }
  const set = (part: Partial<typeof n>, key: string) => (onSet ? onSet({ ...n, ...part }, key) : updateObject(o.id, { normals: { ...n, ...part } }, 'Normals', `${o.id}.n.${key}`))
  return (
    <details className="three-shape">
      <summary className="param-label">Normals (stylized light)</summary>
      <Slider label="Rounder (soft, like a ball)" value={n.round} min={0} max={1} onChange={(round) => set({ round }, 'r')} />
      <Slider label="Flat planes (cut like a gem)" value={n.facets} min={0} max={1} onChange={(facets) => set({ facets }, 'f')} />
      <Slider label="Bent by noise" value={n.noise} min={0} max={1.5} onChange={(noise) => set({ noise }, 'n')} />
      {n.noise > 0 && <Slider label="Noise size" value={n.noiseSize} min={0.2} max={20} step={0.1} onChange={(noiseSize) => set({ noiseSize }, 'ns')} />}
      <p className="dim small">These change only the light, not the shape. Together with painted strokes they make the painterly look stronger and more stylized.</p>
    </details>
  )
}

function OutlineEditor({ o, value, onSet }: { o: Obj3D; value?: Outline; onSet?: (ol: Outline, key: string) => void }) {
  const ol: Outline = onSet ? { ...OUTLINE_DEFAULT, ...(value ?? { on: false }) } : { ...OUTLINE_DEFAULT, ...(o.outline ?? { on: o.material === 'toon' }) }
  const set = (part: Partial<Outline>, key: string) => (onSet ? onSet({ ...ol, ...part }, key) : updateObject(o.id, { outline: { ...ol, ...part } }, 'Outline', `${o.id}.ol.${key}`))
  return (
    <div className="three-shape">
      <label className="switch"><input type="checkbox" role="switch" checked={ol.on} onChange={(e) => set({ on: e.target.checked }, 'on')} /><span>Drawn outline</span></label>
      {ol.on && <>
        <label className="param"><span className="param-label">Line color</span><input type="color" className="swatch" value={ol.color} onChange={(e) => set({ color: e.target.value }, 'c')} /></label>
        <Slider label="Outline thickness" value={ol.width} min={0} max={0.2} step={0.001} onChange={(width) => set({ width }, 'w')} />
        <label className="switch mini"><input type="checkbox" role="switch" checked={ol.creases} onChange={(e) => set({ creases: e.target.checked }, 'cr')} /><span>Lines on sharp edges too</span></label>
        {ol.creases && <>
          <Slider label="Sharp from (degrees)" value={ol.crease} min={1} max={120} step={1} onChange={(crease) => set({ crease }, 'ca')} />
          <Slider label="Edge line width (px)" value={ol.lineWidth} min={0.5} max={12} step={0.1} onChange={(lineWidth) => set({ lineWidth }, 'lw')} />
        </>}
        <Slider label="Wobble (hand-drawn)" value={ol.wobble} min={0} max={1.5} onChange={(wobble) => set({ wobble }, 'wb')} />
        <Slider label="Boil (new drawings a second)" value={ol.boil} min={0} max={24} step={1} onChange={(boil) => set({ boil }, 'b')} />
        <Slider label="Shift the line (misprint)" value={ol.offset} min={0} max={3} onChange={(offset) => set({ offset }, 'of')} />
        <label className="switch mini"><input type="checkbox" role="switch" checked={ol.hull !== false} onChange={(e) => set({ hull: e.target.checked }, 'hull')} /><span>Line on the shape</span></label>
        <label className="switch mini"><input type="checkbox" role="switch" checked={Boolean(ol.floating)} onChange={(e) => set({ floating: e.target.checked }, 'fl')} /><span>Floating strokes around it</span></label>
        {ol.floating && <>
          <label className="param"><span className="param-label">Stroke color</span><input type="color" className="swatch" value={ol.floatColor ?? '#ffe14a'} onChange={(e) => set({ floatColor: e.target.value }, 'fc')} /></label>
          <Slider label="Strokes" value={ol.strokes ?? 2} min={1} max={5} step={1} onChange={(strokes) => set({ strokes }, 'fs')} />
          <Slider label="Away from the shape" value={ol.gap ?? 0.12} min={0} max={1} onChange={(gap) => set({ gap }, 'fg')} />
          <Slider label="Gap in the stroke" value={ol.open ?? 0.15} min={0} max={0.8} onChange={(open) => set({ open }, 'fo')} />
          <Slider label="Stroke width (px)" value={ol.floatWidth ?? 2} min={0.5} max={12} step={0.1} onChange={(floatWidth) => set({ floatWidth }, 'fw')} />
          <div className="seg" role="group" aria-label="Kind of strokes">
            <button className={(ol.floatMode ?? 'contour') === 'contour' ? 'on' : ''} onClick={() => set({ floatMode: 'contour' }, 'fm')} title="Follows the real outline, into every fold and hole">Real outline</button>
            <button className={ol.floatMode === 'loose' ? 'on' : ''} onClick={() => set({ floatMode: 'loose' }, 'fm')} title="Loose rings around the whole shape">Loose rings</button>
          </div>
          {(ol.floatMode ?? 'contour') === 'contour' && <>
            <label className="param"><span className="param-label">Draw with</span>
              <select className="select mini" value={ol.drawWith ?? 'lines'} onChange={(e) => set({ drawWith: e.target.value as Outline['drawWith'] }, 'dw')}>
                <option value="lines">Lines</option><option value="dots">Dots (pop art)</option><option value="letters">Letters</option>
                <option value="lines+dots">Lines and dots</option><option value="lines+letters">Lines and letters</option>
              </select></label>
            {(ol.drawWith ?? 'lines').includes('letters') && <>
              <label className="param"><span className="param-label">Words</span><input className="input" value={ol.text ?? 'RICO'} onChange={(e) => set({ text: e.target.value }, 'tx')} /></label>
              <label className="param"><span className="param-label">Font</span>
                <select className="select mini" value={ol.font ?? "'Teletactile', monospace"} onChange={(e) => set({ font: e.target.value }, 'fn')}>
                  {fontChoices().map((f) => <option key={f.css} value={f.css}>{f.name}</option>)}
                </select></label>
              <Slider label="Letter size (px)" value={ol.letterSize ?? 18} min={6} max={80} step={1} onChange={(letterSize) => set({ letterSize }, 'ls')} />
            </>}
            {(ol.drawWith ?? 'lines').includes('dots') && <>
              <Slider label="Dot size (px)" value={ol.dotSize ?? 6} min={2} max={40} step={0.5} onChange={(dotSize) => set({ dotSize }, 'ds')} />
              <Slider label="Space between dots" value={ol.dotGap ?? 1} min={0} max={4} step={0.05} onChange={(dotGap) => set({ dotGap }, 'dg')} />
            </>}
            {(ol.drawWith ?? 'lines') !== 'lines' && <label className="param"><span className="param-label">Dot and letter color</span><input type="color" className="swatch" value={ol.glyphColor ?? ol.floatColor ?? '#ffe14a'} onChange={(e) => set({ glyphColor: e.target.value }, 'gc')} /></label>}
          </>}
          <label className="switch mini"><input type="checkbox" role="switch" checked={Boolean(ol.overAll)} onChange={(e) => set({ overAll: e.target.checked }, 'ot')} /><span>Draw over everything (off: things in front hide them)</span></label>
          <p className="dim small">Boil redraws them like stop motion. Link "Stroke and outline boil" to a beat to redraw on every hit.</p>
        </>}
      </>}
    </div>
  )
}

const LATE_TIP: Partial<Record<string, string>> = {
  chrome: 'Glossy black glass with rainbow bands on the edges, a silver sheen and a white rim. The colors are yours.',
  halftone: 'First color: the ink dots. Second: the paper (or leave one color to keep the shading).',
  misprint: 'Flat comic colors, printed dots that slip out of line, and ink hatching in the shadows. First color: the ink.',
  hatch: 'Pencil lines that cross more where it is darker. First color: the pencil, second: the paper.',
  watercolor: 'Soft pigment that pools at the edges, paper grain and pale blooms. The color is the paper.',
  newsprint: 'Crumpled paper scraps glued onto the shape, standing off it in layers, with torn white edges, grain and folds the light catches. One color, two colors or full color (its own colors and pictures, old photos, newspaper). Colors: ink, paper, then your paper colors. Boil re-crumples it like stop motion.',
}

function FogEditor({ o }: { o: Obj3D }) {
  const f: FogVol = { ...FOG_DEFAULT, ...(o.fog ?? {}) }
  const set = (part: Partial<FogVol>, key: string) => updateObject(o.id, { fog: { ...f, ...part } }, 'Fog', `${o.id}.fog.${key}`)
  return (
    <div className="three-shape">
      <label className="param"><span className="param-label">Shape</span>
        <select className="select" value={f.shape} onChange={(e) => set({ shape: e.target.value as FogVol['shape'] }, 'sh')}><option value="box">Box</option><option value="ball">Ball</option></select></label>
      <Slider label="Density" value={f.density} min={0} max={6} onChange={(density) => set({ density }, 'd')} />
      <Slider label="Clouds (noise)" value={f.noise} min={0} max={1} onChange={(noise) => set({ noise }, 'n')} />
      <Slider label="Cloud size" value={f.scale} min={0.1} max={6} onChange={(scale) => set({ scale }, 's')} />
      <Slider label="Drift" value={f.speed} min={0} max={2} onChange={(speed) => set({ speed }, 'sp')} />
      <Slider label="Soft edges" value={f.soft} min={0.01} max={1} onChange={(soft) => set({ soft }, 'so')} />
      <Slider label="Thinner higher up" value={f.height} min={0} max={3} onChange={(height) => set({ height }, 'h')} />
      <Slider label="Light glows toward you" value={f.glow} min={-0.9} max={0.95} onChange={(glow) => set({ glow }, 'g')} />
      <Slider label="Lamps in the fog" value={f.lights} min={0} max={5} onChange={(lights) => set({ lights }, 'l')} />
      <p className="dim small">Size and move it like any object. The sun and up to four lamps light it. Link "Fog density" to the audio for breathing fog.</p>
    </div>
  )
}

// The picked part of a model (like picking inside a group in the outliner).
let selPart: { id: string; key: string } | null = null
let partV = 0
const partL = new Set<() => void>()
export function pickPart(p: { id: string; key: string } | null) { selPart = p; partV++; partL.forEach((l) => l()) }
function usePickedPart() { useSyncExternalStore((l) => { partL.add(l); return () => partL.delete(l) }, () => partV); return selPart }

function PartEditor({ o, partKey, name }: { o: Obj3D; partKey: string; name: string }) {
  const materials = useWorld((w) => w.materials ?? [])
  const p: PartSettings = o.parts?.[partKey] ?? {}
  const set = (part: Partial<PartSettings>, label: string, key?: string) => updateObject(o.id, { parts: { ...(o.parts ?? {}), [partKey]: { ...p, ...part } } }, label, key ? `${o.id}.p.${partKey}.${key}` : undefined)
  const mode = p.matId ? p.mode ?? 'add' : 'own'
  const fromPreset = (i: number) => {
    const pre = MATERIAL_PRESETS[i]
    if (!pre) return
    const id = Math.random().toString(36).slice(2, 9)
    changeWorld('New material', (w) => ({ ...w, materials: [...(w.materials ?? []), { id, name: pre.name, layers: pre.layers() }] }))
    set({ matId: id, mode: p.mode ?? 'add' }, 'Part material')
  }
  return (
    <div className="three-shape part-editor">
      <div className="row gap"><b className="part-title">{name}</b><span className="grow" />
        <label className="mini-check"><input type="checkbox" checked={!p.hidden} onChange={(e) => set({ hidden: !e.target.checked }, e.target.checked ? 'Show part' : 'Hide part')} />Shown</label>
      </div>
      <span className="param-label">Look</span>
      <div className="seg" role="group" aria-label="Look">
        <button className={mode === 'own' ? 'on' : ''} onClick={() => set({ matId: undefined }, 'Own look')} title="The look it came with">Its own</button>
        <button className={mode === 'add' ? 'on' : ''} onClick={() => set({ mode: 'add', matId: p.matId ?? materials[0]?.id }, 'Add layers')} title="Its own look, with RICO layers added on top (like a post process on this part)">Own + layers</button>
        <button className={mode === 'replace' ? 'on' : ''} onClick={() => set({ mode: 'replace', matId: p.matId ?? materials[0]?.id }, 'RICO material')} title="Only the RICO material">Layers only</button>
      </div>
      {mode !== 'own' && (
        <label className="param"><span className="param-label">Material</span>
          <select className="select" value={p.matId ?? ''} onChange={(e) => set({ matId: e.target.value }, 'Part material')}>
            {materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select></label>
      )}
      <label className="param"><span className="param-label">{mode === 'own' ? 'Add a look' : 'New material from'}</span>
        <select className="select" value="" onChange={(e) => { if (e.target.value !== '') fromPreset(Number(e.target.value)) }}>
          <option value="">Pick a look...</option>
          {MATERIAL_PRESETS.map((m, i) => <option key={m.name} value={i}>{m.name}</option>)}
        </select></label>
      {mode !== 'own' && <label className="param"><span className="param-label">Tint</span><input type="color" className="swatch" value={p.color ?? o.color} onChange={(e) => set({ color: e.target.value }, 'Tint', 'tint')} /></label>}
      {mode !== 'own' && p.matId && <p className="dim small">Change the layers of this material by picking a shape that uses My material, or in the material list of any object. Every part with this material changes together.</p>}
      <Slider label="Roughness" value={p.roughness ?? o.roughness} min={0} max={1} onChange={(roughness) => set({ roughness }, 'Roughness', 'r')} />
      <Slider label="Metal" value={p.metalness ?? o.metalness} min={0} max={1} onChange={(metalness) => set({ metalness }, 'Metal', 'm')} />
      {mode !== 'own' && <Slider label="Light steps (cartoon bands, 0 = smooth)" value={p.steps ?? 0} min={0} max={8} step={1} onChange={(steps) => set({ steps }, 'Light steps', 's')} />}
      <OutlineEditor o={o} value={p.outline} onSet={(outline, key) => set({ outline }, 'Outline', `ol.${key}`)} />
      {mode !== 'own' && <NormalEditor o={o} value={p.normals} onSet={(normals, key) => set({ normals }, 'Normals', `n.${key}`)} />}
    </div>
  )
}

function ModelPartsPanel({ o }: { o: Obj3D }) {
  const parts = useParts(o.id)
  const picked = usePickedPart()
  const key = picked?.id === o.id ? picked.key : '*'
  const info = parts.find((x) => x.key === key)
  return (
    <div className="three-shape">
      <div className="row gap">
        <span className="param-label">Parts</span>
        <select className="select" value={key} onChange={(e) => pickPart(e.target.value === '*' ? null : { id: o.id, key: e.target.value })}>
          <option value="*">Every part ({parts.length})</option>
          {parts.map((x) => <option key={x.key} value={x.key}>{'\u00a0'.repeat(x.depth * 2)}{x.name}</option>)}
        </select>
      </div>
      <PartEditor o={o} partKey={key} name={key === '*' ? 'Every part' : info?.name ?? 'Part'} />
      {key === '*' && <p className="dim small">Settings here go to every part that has none of its own. Pick a part in the list (or in the scene list) to give it its own look, layers and strokes.</p>}
    </div>
  )
}

function ModelEditor({ o }: { o: Obj3D }) {
  useTick(800)
  const clips = animationsOf(o.id)
  return (
    <div className="three-shape">
      <label className="switch mini"><input type="checkbox" role="switch" checked={o.ownMaterials ?? o.modelType !== 'obj'} onChange={(e) => updateObject(o.id, { ownMaterials: e.target.checked }, 'Model materials')} /><span>Keep the model's own materials</span></label>
      {clips.length > 0 && <>
        <label className="param"><span className="param-label">Animation</span>
          <select className="select" value={o.anim ?? clips[0]} onChange={(e) => updateObject(o.id, { anim: e.target.value }, 'Animation')}>
            <option value="">None</option>
            {clips.map((c) => <option key={c} value={c}>{c}</option>)}
          </select></label>
        <Slider label="Animation speed" value={o.animSpeed ?? 1} min={0} max={3} onChange={(animSpeed) => updateObject(o.id, { animSpeed }, 'Animation speed', `${o.id}.as`)} />
        <p className="dim small">Link "Animation position" to scrub it with a knob, the timeline or the audio.</p>
      </>}
      {clips.length === 0 && <p className="dim small">No animations in this file.</p>}
    </div>
  )
}

// A model's parts in the scene list, indented like its file, each with its
// own eye. Click one to give it its own look.
function ModelTree({ o }: { o: Obj3D }) {
  const parts = useParts(o.id)
  const picked = usePickedPart()
  const [open, setOpen] = useState(true)
  if (!parts.length) return null
  return (
    <div className="outliner-tree">
      <button className="outliner-twist" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? '-' : '+'} {parts.length} parts</button>
      {open && parts.map((p) => {
        const s = o.parts?.[p.key]
        const on = picked?.id === o.id && picked.key === p.key
        return (
          <div key={p.key} className={`outliner-part${on ? ' on' : ''}${s?.hidden ? ' hidden' : ''}`} style={{ paddingLeft: 10 + p.depth * 12 }}>
            <button className="icon-btn" title={s?.hidden ? 'Show' : 'Hide'} onClick={() => updateObject(o.id, { parts: { ...(o.parts ?? {}), [p.key]: { ...(s ?? {}), hidden: !s?.hidden } } }, s?.hidden ? 'Show part' : 'Hide part')}>{s?.hidden ? '○' : '◉'}</button>
            <button className="outliner-name" onClick={() => { select3d(o.id); pickPart({ id: o.id, key: p.key }) }}>
              <i aria-hidden="true">▸</i>{p.name}{s?.matId && <span className="dim small"> + layers</span>}{s?.outline?.on && <span className="dim small"> strokes</span>}
            </button>
            <span className="dim small">{p.tris > 999 ? `${(p.tris / 1000).toFixed(1)}k` : p.tris}</span>
          </div>
        )
      })}
    </div>
  )
}

export function Outliner3D() {
  const objects = useWorld((w) => w.objects)
  const sel = useWorld((_, s) => s)
  return (
    <div className="dpanel outliner">
      <div className="row gap outliner-top"><AddMenu /><span className="dim small">{objects.length} things</span></div>
      <ul className="outliner-list">
        <li className={`outliner-world${sel ? '' : ' on'}`}>
          <button className="outliner-name" onClick={() => select3d(null)} title="Sky, light, color, fog, shadows, camera and lens, bloom, time and grid">
            <i aria-hidden="true">◎</i>World settings
          </button>
        </li>
        {objects.map((o) => (
          <li key={o.id} className={`${sel === o.id ? 'on' : ''}${o.visible ? '' : ' hidden'}`}>
            <button className="icon-btn" title={o.visible ? 'Hide' : 'Show'} onClick={() => updateObject(o.id, { visible: !o.visible }, o.visible ? 'Hide' : 'Show')}>{o.visible ? '◉' : '○'}</button>
            <button className="outliner-name" onClick={() => select3d(o.id)} onDoubleClick={() => { select3d(o.id); focusSelected() }}>
              <i aria-hidden="true">{ICON[o.kind] ?? '◆'}</i>{o.name}
              {Object.keys(o.bindings).length > 0 && <span className="dim small"> linked</span>}
            </button>
            <button className="icon-btn danger" title="Delete" onClick={() => removeObject(o.id)}>×</button>
            {o.kind === 'model' && <ModelTree o={o} />}
          </li>
        ))}
      </ul>
      <div className="row">
        <button className="btn small quiet" onClick={() => downloadJson('rico-3d.json', { rico: '3d', version: 1, world: getWorld() })}>Save scene</button>
        <button className="btn small quiet" onClick={() => pickFile('.json', (f) => f.text().then((t) => {
          const data = JSON.parse(t)
          if (data?.rico !== '3d' || !data.world?.objects) return toast('That is not a RICO 3D scene.')
          changeWorld('Open 3D scene', () => data.world as World3D)
        }).catch(() => toast('That is not a RICO 3D scene.')))}>Open</button>
        <button className="btn small quiet" onClick={() => changeWorld('Starter 3D scene', () => starterWorld())}>Starter scene</button>
      </div>
    </div>
  )
}

function Vec({ label, value, onChange, step = 0.1 }: { label: string; value: Vec3; onChange: (v: Vec3) => void; step?: number }) {
  return (
    <div className="vec">
      <span className="param-label">{label}</span>
      {(['X', 'Y', 'Z'] as const).map((axis, i) => (
        <label key={axis} className={`vec-${axis.toLowerCase()}`}>
          <span>{axis}</span>
          <input className="input" type="number" step={step} value={Number(value[i].toFixed(3))}
            onChange={(e) => { const n = [...value] as Vec3; n[i] = Number(e.target.value); onChange(n) }} />
        </label>
      ))}
    </div>
  )
}

function Slider({ label, value, min, max, step = 0.01, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void }) {
  return (
    <label className="param">
      <span className="param-top"><span className="param-label">{label}</span><NumberBox value={value} digits={3} onChange={onChange} /></span>
      <input className="range" type="range" min={Math.min(min, value)} max={Math.max(max, value)} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  )
}

function Links({ o }: { o: Obj3D }) {
  const [adding, setAdding] = useState('')
  const options = LINKABLE.filter((l) => (isLight(o.kind) ? l.key.startsWith('position') || l.key === 'intensity' || l.key === 'hue' : l.key !== 'intensity'))
  const set = (key: string, b: Obj3D['bindings'][string] | undefined) => {
    const next = { ...o.bindings }
    if (b) next[key] = b
    else delete next[key]
    updateObject(o.id, { bindings: next }, b ? 'Link' : 'Unlink', `${o.id}.link.${key}`)
  }
  return (
    <div className="three-links">
      <h4>Follows</h4>
      {Object.entries(o.bindings).map(([key, b]) => {
        const def = LINKABLE.find((l) => l.key === key)
        return (
          <div key={key} className="three-link">
            <div className="row"><b>{def?.label ?? key}</b><span className="grow" /><button className="icon-btn danger" title="Unlink" onClick={() => set(key, undefined)}>×</button></div>
            <SignalPicker label={`${o.id}.${key}`} value={b.signal} onChange={(signal) => set(key, { ...b, signal })} />
            <div className="row mini">from <input className="input num" type="number" value={b.min} onChange={(e) => set(key, { ...b, min: Number(e.target.value) })} />
              to <input className="input num" type="number" value={b.max} onChange={(e) => set(key, { ...b, max: Number(e.target.value) })} />
              smooth <input className="range" type="range" min={0} max={0.95} step={0.01} value={b.smooth} onChange={(e) => set(key, { ...b, smooth: Number(e.target.value) })} /></div>
          </div>
        )
      })}
      <select className="select" value={adding} onChange={(e) => {
        const def = LINKABLE.find((l) => l.key === e.target.value)
        if (def) set(def.key, { signal: '', min: def.min, max: def.max, smooth: 0.5 })
        setAdding('')
      }}>
        <option value="">Make a setting follow a knob, OSC or the audio...</option>
        {options.filter((l) => !o.bindings[l.key]).map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
      </select>
    </div>
  )
}

// More of the world, in groups you open: sky, light from around, color,
// fog, shadows, camera and lens, film looks, time and quality.
function WorldMore() {
  const world = useWorld((w) => w)
  const e = envOf(world)
  const set = (part: Partial<WorldEnv>, key: string) => changeWorld('World', (w) => ({ ...w, env: { ...(w.env ?? {}), ...part } }), `env.${key}`)
  const S = (label: string, k: keyof WorldEnv, min: number, max: number, step = 0.01) => <Slider label={label} value={e[k] as number} min={min} max={max} step={step} onChange={(v) => set({ [k]: v } as Partial<WorldEnv>, k)} />
  const C = (label: string, k: keyof WorldEnv) => <label className="param"><span className="param-label">{label}</span><input type="color" className="swatch" value={(e[k] as string) || world.background} onChange={(ev) => set({ [k]: ev.target.value } as Partial<WorldEnv>, k)} /></label>
  const Seg = <T extends string | number>(k: keyof WorldEnv, opts: [T, string][]) => (
    <div className="seg" role="group">{opts.map(([v, l]) => <button key={String(v)} className={e[k] === v ? 'on' : ''} onClick={() => set({ [k]: v } as Partial<WorldEnv>, String(k))}>{l}</button>)}</div>
  )
  return (
    <div className="world-more">
      <details open><summary>Sky</summary>
        {Seg('sky', [['color', 'Color'], ['gradient', 'Gradient'], ['transparent', 'See-through']])}
        {e.sky === 'gradient' && <>{C('Top', 'skyTop')}{C('Bottom', 'skyBottom')}</>}
        {e.sky === 'transparent' && <p className="dim small">Nothing behind the scene, for layering in Motion or sending to other apps with alpha.</p>}
      </details>
      <details><summary>Light from around</summary>
        {Seg('envLight', [['studio', 'Studio'], ['soft', 'Soft'], ['none', 'None']])}
        {S('Strength', 'envIntensity', 0, 4)}
        {S('Turn it (degrees)', 'envTurn', 0, 360, 1)}
        {S('Fill light', 'ambient', 0, 4)}
        {e.ambient > 0 && <>{C('Fill from above', 'ambientSky')}{C('Fill from below', 'ambientGround')}</>}
      </details>
      <details><summary>Color</summary>
        <label className="param"><span className="param-label">Tone mapping</span>
          <select className="select mini" value={e.toneMap} onChange={(ev) => set({ toneMap: ev.target.value as WorldEnv['toneMap'] }, 'tm')}>
            <option value="aces">Film (ACES)</option><option value="agx">Soft film (AgX)</option><option value="neutral">Neutral (true colors)</option>
            <option value="reinhard">Reinhard</option><option value="cineon">Cineon</option><option value="linear">Linear (none)</option>
          </select></label>
        {S('Saturation', 'saturation', 0, 2)}
        {S('Contrast', 'contrast', 0.5, 2)}
        {S('Warm or cool', 'warmth', -1, 1)}
      </details>
      <details><summary>Fog</summary>
        {Seg('fogKind', [['thick', 'Thicker far away'], ['linear', 'From near to far']])}
        {e.fogKind === 'linear' && <>{S('Starts at', 'fogNear', 0, 50, 0.1)}{S('Full at', 'fogFar', 1, 200, 0.5)}</>}
        {C('Fog color', 'fogColor')}
        <p className="dim small">The Fog slider above turns it on. For fog only in one place, add a Fog volume.</p>
      </details>
      <details><summary>Shadows</summary>
        <label className="switch mini"><input type="checkbox" role="switch" checked={e.shadows} onChange={(ev) => set({ shadows: ev.target.checked }, 'sh')} /><span>Shadows</span></label>
        {Seg('shadowSoft', [['hard', 'Hard'], ['soft', 'Soft'], ['very-soft', 'Very soft']])}
        {Seg('shadowSize', [[1024, 'Fast'], [2048, 'Good'], [4096, 'Sharp']])}
      </details>
      <details><summary>Camera and lens</summary>
        {S('Turn around by itself', 'autoTurn', -10, 10, 0.1)}
        {S('Smooth camera moves', 'damping', 0.01, 0.3)}
        {S('Nearest it sees', 'near', 0.01, 5, 0.01)}
        {S('Farthest it sees', 'far', 10, 5000, 10)}
        <label className="switch mini"><input type="checkbox" role="switch" checked={e.dof} onChange={(ev) => set({ dof: ev.target.checked }, 'dof')} /><span>Depth of field (blur out of focus)</span></label>
        {e.dof && <>{S('Focus distance', 'focus', 0.1, 50, 0.05)}{S('Aperture (how much blur)', 'aperture', 0, 0.2, 0.001)}{S('Most blur', 'maxBlur', 0, 0.05, 0.0005)}</>}
      </details>
      <details><summary>Film and lens looks</summary>
        {S('Dark corners (vignette)', 'vignette', 0, 1)}
        {S('Film grain', 'grain', 0, 1)}
        {S('Color fringe (chromatic)', 'aberration', 0, 1)}
        {S('Scanlines', 'scanlines', 0, 1)}
        {S('Big pixels', 'pixelate', 0, 24, 1)}
      </details>
      <details><summary>Time, grid and quality</summary>
        {S('Time speed (0 stops it)', 'timeScale', 0, 4)}
        {S('Grid size', 'gridSize', 2, 200, 1)}
        {C('Grid color', 'gridColor')}
        {S('Render size (lower is faster)', 'renderScale', 0.25, 1, 0.05)}
      </details>
      <button className="btn small quiet" onClick={() => changeWorld('Reset world', (w) => ({ ...w, env: {} }))}>Back to the start</button>
    </div>
  )
}

// One list for every material: the simple ones, the drawn and printed looks
// (each starts its own layers you can change below), and your own.
const BASIC: MaterialKind[] = ['standard', 'glass', 'chrome', 'glow', 'wire', 'normal']
const DRAWN: MaterialKind[] = ['toon', 'iridescent']
const OWN: MaterialKind[] = ['custom', 'picture', 'shader']
// Gives an object one of the drawn, printed or painted looks (its own copy of the layers).
export function applyLook(o: Obj3D, name: string) {
  const pre = MATERIAL_PRESETS.find((p) => p.name === name)
  if (!pre) return
  const id = Math.random().toString(36).slice(2, 9)
  changeWorld('Material', (w) => ({
    ...w,
    materials: [...(w.materials ?? []), { id, name: `${name.replace(/ \(.*\)$/, '')} (${o.name})`, look: name, layers: pre.layers() }],
    // a model: the look goes on every part, instead of the look it came with
    objects: w.objects.map((x) => (x.id === o.id ? { ...x, material: 'custom' as MaterialKind, matId: id, ...(x.kind === 'model' ? { parts: { ...(x.parts ?? {}), '*': { ...(x.parts?.['*'] ?? {}), mode: 'add' as const, matId: id } } } : {}) } : x)),
  }))
}
function MaterialPick({ o }: { o: Obj3D }) {
  const materials = useWorld((w) => w.materials ?? [])
  const model = o.kind === 'model'
  const own = o.ownMaterials ?? o.modelType !== 'obj'
  const all = o.parts?.['*']
  const defId = model && all?.matId ? all.matId : o.material === 'custom' ? o.matId : undefined
  const def = materials.find((m) => m.id === defId)
  const value = model && !all?.matId && own ? 'own' : def?.look ? `look:${def.look}` : def ? `mat:${def.id}` : o.material
  const mine = materials.filter((m) => !m.look)
  const pick = (v: string) => {
    if (v.startsWith('look:')) return applyLook(o, v.slice(5))
    const clearAll = model ? { parts: { ...(o.parts ?? {}), '*': { ...(all ?? {}), matId: undefined, mode: undefined } } } : {}
    if (v === 'own') return updateObject(o.id, { ownMaterials: true, ...clearAll }, 'Its own look')
    if (v.startsWith('mat:')) {
      const id = v.slice(4)
      return updateObject(o.id, { material: 'custom', matId: id, ...(model ? { parts: { ...(o.parts ?? {}), '*': { ...(all ?? {}), mode: 'add' as const, matId: id } } } : {}) }, 'Material')
    }
    if (v === 'custom') {
      const id = uid()
      changeWorld('New material', (w) => ({ ...w, materials: [...(w.materials ?? []), { id, name: `My material ${mine.length + 1}`, layers: [newLayer('noise')] }] }))
      return pick(`mat:${id}`)
    }
    updateObject(o.id, { material: v as MaterialKind, ...(model ? { ownMaterials: false, ...clearAll } : {}) }, 'Material')
  }
  return (
    <GroupPick label="Material" value={value} onPick={pick} groups={[
      ...(model ? [{ name: 'From the file', items: [{ value: 'own', label: 'Its own look (from the file)' }] }] : []),
      { name: 'Simple', items: BASIC.map((k) => ({ value: k, label: MATERIAL_LABEL[k] })) },
      { name: 'Drawn, printed and painted', items: [...DRAWN.map((k) => ({ value: k, label: MATERIAL_LABEL[k] })), ...MATERIAL_PRESETS.map((p) => ({ value: `look:${p.name}`, label: p.name }))] },
      { name: 'Your own', items: [
        ...mine.map((m) => ({ value: `mat:${m.id}`, label: m.name })),
        { value: 'custom', label: '+ New material (layers)' },
        ...OWN.filter((k) => k !== 'custom' && !model).map((k) => ({ value: k, label: MATERIAL_LABEL[k] })),
      ] },
    ]} />
  )
}

export function Props3D() {
  const world = useWorld((w) => w)
  const sel = useWorld((_, s) => s)
  const o = world.objects.find((x) => x.id === sel)
  // the tab says what it shows: the world, or the picked object
  useEffect(() => { dockApi()?.getPanel('3d-props')?.api.setTitle(o ? 'Object settings' : 'World settings') }, [Boolean(o)])  // eslint-disable-line react-hooks/exhaustive-deps
  if (!o) {
    return (
      <div className="dpanel inspector">
        <h3>World settings</h3>
        <Hint label="About" docs="WORKSPACES.md#world-settings" text="Click something in the viewport to change it. Everything here can follow a knob, an OSC address or the audio." />
        <label className="param"><span className="param-label">Background</span>
          <input type="color" className="swatch" value={world.background} onChange={(e) => changeWorld('Background', (w) => ({ ...w, background: e.target.value }), 'bg')} /></label>
        <Slider label="Fog" value={world.fog} min={0} max={0.2} step={0.001} onChange={(fog) => changeWorld('Fog', (w) => ({ ...w, fog }), 'fog')} />
        <Slider label="Lens (field of view)" value={world.camera.fov} min={15} max={100} step={1} onChange={(fov) => changeWorld('Lens', (w) => ({ ...w, camera: { ...w.camera, fov } }), 'fov')} />
        <Slider label="Exposure (brightness of everything)" value={world.exposure ?? 1} min={0.1} max={4} onChange={(exposure) => changeWorld('Exposure', (w) => ({ ...w, exposure }), 'exp')} />
        <label className="switch"><input type="checkbox" role="switch" checked={Boolean(world.bloom?.on)} onChange={(e) => changeWorld('Bloom', (w) => ({ ...w, bloom: { strength: 0.8, radius: 0.4, threshold: 0.8, ...(w.bloom ?? {}), on: e.target.checked } }))} /><span>Bloom (glow spreads into the air)</span></label>
        {world.bloom?.on && <>
          <Slider label="Bloom strength" value={world.bloom.strength} min={0} max={3} onChange={(strength) => changeWorld('Bloom', (w) => ({ ...w, bloom: { ...w.bloom!, strength } }), 'bs')} />
          <Slider label="Bloom size" value={world.bloom.radius} min={0} max={1} onChange={(radius) => changeWorld('Bloom', (w) => ({ ...w, bloom: { ...w.bloom!, radius } }), 'br')} />
          <Slider label="Glows from brightness" value={world.bloom.threshold} min={0} max={1.5} onChange={(threshold) => changeWorld('Bloom', (w) => ({ ...w, bloom: { ...w.bloom!, threshold } }), 'bt')} />
        </>}
        <WorldMore />
      </div>
    )
  }
  const up = (part: Partial<Obj3D>, label = 'Change object') => updateObject(o.id, part, label)
  const light = isLight(o.kind)
  return (
    <div className="dpanel inspector">
      <button className="btn small quiet world-back" onClick={() => select3d(null)} title="Sky, light, color, fog, camera and more (or press Esc)">World settings</button>
      <input className="input title-input" value={o.name} aria-label="Name" onChange={(e) => updateObject(o.id, { name: e.target.value }, 'Rename', `${o.id}.name`)} />
      <p className="dim small">{KIND_LABEL[o.kind]}</p>
      {(MATH.includes(o.kind) || o.kind === 'shape') && <ShapeEditor o={o} />}
      <Vec label="Position" value={o.position} onChange={(position) => up({ position }, 'Move')} />
      {!light && <Vec label="Rotation (degrees)" value={o.rotation} step={5} onChange={(rotation) => up({ rotation }, 'Turn')} />}
      {!light && <Vec label="Size" value={o.scale} onChange={(scale) => up({ scale }, 'Resize')} />}
      {!light && <PivotRow o={o} />}
      <label className="param"><span className="param-label">Color</span>
        <input type="color" className="swatch" value={o.color} onChange={(e) => updateObject(o.id, { color: e.target.value }, 'Color', `${o.id}.color`)} /></label>
      {o.kind === 'fog' ? <FogEditor o={o} /> : light
        ? <><Slider label="Strength (type any number)" value={o.intensity} min={0} max={o.kind === 'sun' ? 20 : 1000} step={0.1} onChange={(intensity) => up({ intensity })} />
          <p className="dim small">Lights get weaker with distance, like real ones. Far away lights need big numbers (hundreds). Exposure in the world settings makes everything brighter.</p></>
        : <>
          <label className="param"><span className="param-label">Material</span>
            <MaterialPick o={o} /></label>
          <SurfaceEditor o={o} />
          {(o.material === 'custom' || (o.kind === 'model' && o.parts?.['*']?.matId)) && <MaterialEditor o={o} />}
          {o.material === 'iridescent' && <FilmEditor o={o} />}
          {o.material === 'toon' && <Slider label="Light steps" value={o.toonSteps ?? 3} min={2} max={8} step={1} onChange={(toonSteps) => up({ toonSteps })} />}
          {(o.material === 'custom' || o.material === 'iridescent') && <Slider label="Light steps (cartoon bands, 0 = smooth)" value={o.lightSteps ?? 0} min={0} max={8} step={1} onChange={(lightSteps) => up({ lightSteps })} />}
          {o.kind === 'model' && <ModelEditor o={o} />}
          {o.kind === 'model' && <ModelPartsPanel o={o} />}
          {o.kind === 'text' && <TextEditor o={o} />}
          {o.kind === 'comic' && <ComicEditor o={o} />}
          {(o.material === 'custom' || o.material === 'iridescent') && <NormalEditor o={o} />}
          {o.kind !== 'model' && o.kind !== 'fluid' && <OutlineEditor o={o} />}
          <DeformEditor o={o} />
          <PoseEditor o={o} />
          <PhysicsEditor o={o} />
          <FluidEditor o={o} />
          {o.kind === 'mesh' && <div className="row gap"><span className="dim small">{(o.mesh?.p.length ?? 0) / 3} points</span><button className="btn small" onClick={() => enterMode('edit')}>Edit (Tab)</button><button className="btn small quiet" onClick={() => enterMode('sculpt')}>Sculpt</button></div>}
          <Slider label="Roughness" value={o.roughness} min={0} max={1} onChange={(roughness) => up({ roughness })} />
          {o.material === 'standard' && <Slider label="Metal" value={o.metalness} min={0} max={1} onChange={(metalness) => up({ metalness })} />}
          <Slider label="Glow" value={o.glow} min={0} max={4} onChange={(glow) => up({ glow })} />
          <Slider label="Spin (turns a minute)" value={o.spin} min={-60} max={60} step={0.5} onChange={(spin) => up({ spin })} />
        </>}
      <label className="switch mini" title="Clicking it in the view sends the signal 3d:click:name"><input type="checkbox" role="switch" checked={Boolean(o.clickable)} onChange={(e) => up({ clickable: e.target.checked }, 'Clickable')} /><span>Clickable (signal 3d:click:{o.name})</span></label>
      <Links o={o} />
      <div className="row">
        <button className="btn small quiet" onClick={() => duplicateObject(o.id)}>Duplicate</button>
        <button className="btn small out" onClick={() => removeObject(o.id)}>Delete</button>
      </div>
    </div>
  )
}

export { replaceWorld }

// Where the object turns, sizes and bends from.
function PivotRow({ o }: { o: Obj3D }) {
  const editing = useSyncExternalStore(onPivotEdit, pivotEditing)
  const to = (where: 'middle' | 'bottom' | 'top') => {
    const b = objectBox(o.id)
    if (!b) return
    const c = b.getCenter(new THREE.Vector3())
    const r = (v: number) => Math.round(v * 1000) / 1000
    setPivot(o.id, [r(c.x), r(where === 'bottom' ? b.min.y : where === 'top' ? b.max.y : c.y), r(c.z)], 'Pivot')
  }
  return (
    <div className="pivot-row">
      <Vec label="Pivot (where it turns and bends from)" value={o.pivot ?? [0, 0, 0]} step={0.05} onChange={(p) => setPivot(o.id, p)} />
      <div className="row wrap">
        <button className="btn small quiet" onClick={() => to('bottom')}>Bottom</button>
        <button className="btn small quiet" onClick={() => to('middle')}>Middle</button>
        <button className="btn small quiet" onClick={() => to('top')}>Top</button>
        <button className={`btn small ${editing === o.id ? 'primary' : 'quiet'}`} title="Drag the pink handle to put the pivot anywhere (D)" onClick={() => editPivot(editing !== o.id)}>{editing === o.id ? 'Done' : 'Move it in the view'}</button>
      </div>
    </div>
  )
}
