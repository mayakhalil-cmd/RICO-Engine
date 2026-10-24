import { useState, useSyncExternalStore } from 'react'
import ToolEditor from '../components/ToolEditor'
import AttrBox, { openAttr } from './AttrBox'
import { import3dTools, pick3dTool, put3dTool, remove3dTool, run3dAction, TOOL3D_TEMPLATE, use3dTools, type Tool3D } from './tools3d'
import ToolStrip, { ToolBtn, ToolGroup, type ToolItem } from '../components/ToolStrip'
import { toast } from '../components/Toasts'
import { MOVE_STEPS, ROT_STEPS, SIZE_STEPS, UNIT, setSnap, useSnap } from '../shell/snap'
import { dockApi, goTo } from '../shell/workspaces'
import { openPanel } from '../shell/Workspace'
import { pickFile } from '../shell/ui'
import { changeScene, select } from '../create/store'
import { newLayer } from '../create/scene'
import { playPause, setKey, usePlay } from '../create/timeline'
import {
  editPivot, focusSelected, getGizmoSpace, onPivotEdit, pivotEditing, gizmoSpaceVersion, isOrtho, lensVersion, onGizmoSpace, onLens, saveCamera, setGizmoMode, setGizmoSpace, setOrtho,
} from './engine'
import { enterMode, exitMode, opExtrude, opSmooth, opSubdivide, setEdit, useEdit } from './editmode'
import {
  MATERIAL_PRESETS, PHYSICS_DEFAULT, SYMBIOTE_DEFAULT, addObject, changeWorld, getSelected3d, getWorld, newObject, select3d, updateObject, useWorld,
  type Deform, type ObjKind, type Obj3D,
} from './world'
import { newEditable } from './editmode'
import { applyLook, exportGlslFile, exportLookFile, exportShapesFile, importModel, snapshotPng } from './Panels'
import { pauseSim, playSim, resetSim, simPlaces, useSim } from './sim'

// The green tool strip on top of the 3D workspace. Five stages, like a 3D
// app's workspaces: Modeling, Texturing, Lighting, Animating and Rendering.
// Each shows its own tools; moving, turning, sizing, which way the handles
// point and snapping are always there.

export type Stage = 'model' | 'texture' | 'light' | 'animate' | 'render'
const STAGES: [Stage, string, string][] = [['model', 'Modeling', 'modeling'], ['texture', 'Texturing', 'texturing'], ['light', 'Lighting', 'lighting'], ['animate', 'Animating', 'animating'], ['render', 'Rendering', 'rendering']]
let stage: Stage = (() => { try { return (localStorage.getItem('rico.3d.stage') as Stage) || 'model' } catch { return 'model' } })()
let sv = 0
const sl = new Set<() => void>()
export function setStage(s: Stage) {
  stage = s
  try { localStorage.setItem('rico.3d.stage', s) } catch { /* not kept */ }
  sv++; sl.forEach((l) => l())
  const api = dockApi()
  if (!api) return
  // each stage brings the panel it needs to the front
  if (s === 'texture') openPanel(api, 'nodes-main')
  if (s === 'animate') openPanel(api, '3d-timeline')
}
const useStage = () => { useSyncExternalStore((l) => { sl.add(l); return () => sl.delete(l) }, () => sv); return stage }
const useSpace = () => { useSyncExternalStore(onGizmoSpace, gizmoSpaceVersion); return getGizmoSpace() }

const sel = (): Obj3D | undefined => getWorld().objects.find((o) => o.id === getSelected3d())
const needSel = (fn: (o: Obj3D) => void) => () => { const o = sel(); if (!o) return toast('Pick something in the 3D view first.'); fn(o) }
const add = (k: ObjKind, extra: Partial<Obj3D> = {}) => () => addObject(newObject(k, extra))
const addDeform = (kind: Deform['kind']) => needSel((o) => {
  const d: Deform = { id: Math.random().toString(36).slice(2, 8), kind, amount: kind === 'bend' ? 0.5 : kind === 'twist' ? 0.5 : kind === 'wave' ? 0.6 : 0.5, axis: 'y', on: true }
  updateObject(o.id, { deform: [...(o.deform ?? []), d] }, `Add ${kind}`)
  toast(`${kind[0].toUpperCase()}${kind.slice(1)} added. Change it in Object settings > Deform.`, true)
})

export default function ThreeStrip() {
  const mine = use3dTools()
  const [toolEdit, setToolEdit] = useState<Tool3D | null>(null)
  const st = useStage()
  const space = useSpace()
  useSyncExternalStore(onLens, lensVersion)
  const ortho = isOrtho()
  const snap = useSnap('3d')
  const ed = useEdit()
  const sim = useSim()
  const play = usePlay()
  const world = useWorld((w) => w)
  const fmt = (v: number) => (Number.isInteger(v) ? String(v) : String(Number(v.toFixed(3))))
  const pivotOn = useSyncExternalStore(onPivotEdit, pivotEditing)
  const handles: ToolItem[] = [
    { id: 'select', icon: 'select', label: 'Select (whole objects)', on: ed.mode === 'object', run: () => exitMode() },
    { id: 'move', icon: 'move', label: 'Move', key: 'W', on: snap.handles === 'move', run: () => setGizmoMode('translate') },
    { id: 'rotate', icon: 'rotate', label: 'Turn', key: 'E', on: snap.handles === 'rotate', run: () => setGizmoMode('rotate') },
    { id: 'scale', icon: 'scale', label: 'Size', key: 'R', on: snap.handles === 'scale', run: () => setGizmoMode('scale') },
    { id: 'all', icon: 'all', label: 'All handles', key: 'Q', on: snap.handles === 'all', run: () => setGizmoMode('all') },
    { id: 'pivot', icon: 'anchor', label: 'Move the pivot: where it turns, sizes and bends from', key: 'D', on: Boolean(pivotOn), run: () => { if (!getSelected3d()) return toast('Pick something first.'); editPivot(!pivotEditing()) } },
  ]
  const spaceBtn: ToolItem = {
    id: 'space', icon: space === 'world' ? 'world' : 'object', label: `Handles point along: ${space === 'world' ? 'the world' : 'the object'}`, run: () => setGizmoSpace(space === 'world' ? 'local' : 'world'),
    more: [
      { id: 'world', icon: 'world', label: 'World (up is always up)', on: space === 'world', run: () => setGizmoSpace('world') },
      { id: 'local', icon: 'object', label: 'Object (along the object, as it is turned)', on: space === 'local', run: () => setGizmoSpace('local') },
    ],
  }
  const magnets: ToolItem[] = [
    { id: 'gm', icon: 'grid', label: `Snap moves: ${fmt(snap.moveStep)} ${UNIT['3d']} (${snap.move ? 'on' : 'off'})`, on: snap.move, run: () => setSnap('3d', { move: !snap.move }),
      more: MOVE_STEPS['3d'].map((s) => ({ id: String(s), icon: 'grid', label: `${fmt(s)} ${UNIT['3d']}`, on: snap.moveStep === s, run: () => setSnap('3d', { moveStep: s, move: true }) })) },
    { id: 'ga', icon: 'angle', label: `Snap turns: ${fmt(snap.rotStep)} degrees (${snap.rot ? 'on' : 'off'})`, on: snap.rot, run: () => setSnap('3d', { rot: !snap.rot }),
      more: ROT_STEPS.map((s) => ({ id: String(s), icon: 'angle', label: `${fmt(s)} degrees`, on: snap.rotStep === s, run: () => setSnap('3d', { rotStep: s, rot: true }) })) },
    { id: 'gs', icon: 'size', label: `Snap sizes: ${fmt(snap.sizeStep)} (${snap.size ? 'on' : 'off'})`, on: snap.size, run: () => setSnap('3d', { size: !snap.size }),
      more: SIZE_STEPS.map((s) => ({ id: String(s), icon: 'size', label: fmt(s), on: snap.sizeStep === s, run: () => setSnap('3d', { sizeStep: s, size: true }) })) },
  ]
  const view: ToolItem[] = [
    { id: 'focus', icon: 'view', label: 'Focus on the selected thing', key: 'F', run: focusSelected },
    { id: 'lens', icon: ortho ? 'ortho' : 'persp', label: ortho ? 'Ortho view (no depth). Click for perspective' : 'Perspective view. Click for ortho (no depth)', key: '5', on: ortho, run: () => setOrtho(!ortho),
      more: [{ id: 'p', icon: 'persp', label: 'Perspective', on: !ortho, run: () => setOrtho(false) }, { id: 'o', icon: 'ortho', label: 'Ortho', on: ortho, run: () => setOrtho(true) }] },
    { id: 'grid', icon: 'grid', label: 'Floor grid', key: 'G', on: world.grid, run: () => changeWorld('Grid', (w) => ({ ...w, grid: !w.grid })) },
  ]

  const shapes: [ObjKind, string, string][] = [['box', 'Cube', 'cube'], ['sphere', 'Sphere', 'sphere'], ['cylinder', 'Cylinder', 'cylinder'], ['cone', 'Cone', 'polygon'], ['torus', 'Donut', 'ellipse'], ['knot', 'Knot', 'twist'], ['capsule', 'Capsule', 'cylinder'], ['icosa', 'Crystal', 'polygon'], ['plane', 'Floor', 'rect'], ['ring', 'Ring', 'ellipse']]
  const stageTools: Record<Stage, ToolItem[]> = {
    model: [
      { id: 'add', icon: 'cube', label: 'Add a shape', run: add('box'), more: [
        ...shapes.map(([k, l, i]) => ({ id: k, icon: i, label: l, run: add(k) })),
        { id: 'text', icon: 'text', label: '3D text', run: add('text') },
        { id: 'comic', icon: 'page', label: 'Comic page', run: add('comic') },
        { id: 'msurf', icon: 'wave', label: 'Math surface', run: add('math-surface') },
        { id: 'msolid', icon: 'sphere', label: 'Math solid', run: add('math-solid') },
        { id: 'code', icon: 'nodes', label: 'Code shape', run: add('code-shape') },
      ] },
      { id: 'editable', icon: 'vertex', label: 'Model it yourself: an editable shape', run: () => { addObject(newObject('mesh', { name: 'Editable cube', mesh: newEditable('cube'), meshRev: 1, material: 'standard', color: '#b9a8ff' })); window.setTimeout(() => enterMode('edit'), 50) },
        more: (['cube', 'sphere', 'plane', 'cylinder'] as const).map((k) => ({ id: k, icon: k === 'plane' ? 'rect' : k === 'cube' ? 'cube' : k, label: `Editable ${k}`, run: () => { addObject(newObject('mesh', { name: `Editable ${k}`, mesh: newEditable(k), meshRev: 1, material: 'standard', color: '#b9a8ff', position: k === 'plane' ? [0, 0.01, 0] : [0, 1, 0] })); window.setTimeout(() => enterMode('edit'), 50) } })) },
      { id: 'import', icon: 'import', label: 'Import a model (.glb .fbx .obj)', run: () => pickFile('.glb,.gltf,.fbx,.obj', importModel) },
      { id: 'edit', icon: 'vertex', label: 'Edit points and faces', key: 'Tab', on: ed.mode === 'edit', run: () => (ed.mode === 'edit' ? exitMode() : enterMode('edit')),
        more: [
          { id: 'ext', icon: 'extrude', label: 'Extrude', key: 'E', run: opExtrude },
          { id: 'sub', icon: 'grid', label: 'Subdivide', run: opSubdivide },
          { id: 'smooth', icon: 'wave', label: 'Smooth', run: opSmooth },
        ] },
      { id: 'sculpt', icon: 'sculpt', label: 'Sculpt', on: ed.mode === 'sculpt', run: () => enterMode('sculpt'),
        more: ([['draw', 'Draw'], ['clay', 'Clay'], ['crease', 'Crease'], ['inflate', 'Inflate'], ['smooth', 'Smooth'], ['flatten', 'Flatten'], ['pinch', 'Pinch'], ['grab', 'Move'], ['snake', 'Snake']] as const).map(([t, l]) => ({ id: t, icon: 'sculpt', label: l, on: ed.mode === 'sculpt' && ed.tool === t, run: () => { enterMode('sculpt'); setEdit({ tool: t }) } })) },
      { id: 'deform', icon: 'bend', label: 'Deform: bend, twist, taper, squash, wave', run: addDeform('bend'), more: [
        { id: 'bend', icon: 'bend', label: 'Bend', run: addDeform('bend') },
        { id: 'twist', icon: 'twist', label: 'Twist', run: addDeform('twist') },
        { id: 'taper', icon: 'polygon', label: 'Taper', run: addDeform('taper') },
        { id: 'squash', icon: 'scale', label: 'Squash and stretch', run: addDeform('squash') },
        { id: 'wave', icon: 'wave', label: 'Wave', run: addDeform('wave') },
      ] },
      { id: 'morph', icon: 'morph', label: 'Morph into another shape', run: needSel((o) => updateObject(o.id, { morph: o.morph ?? { to: 'sphere', amount: 0.5 } }, 'Morph')), more: [
        { id: 'sphere', icon: 'sphere', label: 'Into a ball', run: needSel((o) => updateObject(o.id, { morph: { to: 'sphere', amount: o.morph?.amount ?? 0.5 } }, 'Morph')) },
        { id: 'cube', icon: 'cube', label: 'Into a box', run: needSel((o) => updateObject(o.id, { morph: { to: 'cube', amount: o.morph?.amount ?? 0.5 } }, 'Morph')) },
        ...world.objects.filter((o) => !['point-light', 'spot-light', 'sun', 'fog', 'fluid'].includes(o.kind)).map((t) => ({ id: t.id, icon: 'object', label: `Into ${t.name}`, run: needSel((o) => { if (o.id === t.id) return toast('Pick another object to morph into.'); updateObject(o.id, { morph: { to: t.id, amount: o.morph?.amount ?? 0.5 } }, 'Morph') }) })),
      ] },
      { id: 'symbiote', icon: 'fluid', label: 'Symbiote: a living goo that grows sticky arms toward things near it', run: needSel((o) => { updateObject(o.id, { symbiote: o.symbiote ? { ...o.symbiote, on: !o.symbiote.on } : { ...SYMBIOTE_DEFAULT } }, 'Symbiote'); toast('Move something near it. Change how it reaches in Object settings > Deform.', true) }) },
      { id: 'bones', icon: 'bones', label: 'Pose the bones of a model (Object settings > Pose)', run: needSel((o) => { if (o.kind !== 'model') return toast('Bones come with models from the file (.glb or .fbx with a skeleton). For other shapes, use Deform.'); toast('Pick a bone in Object settings > Pose, then turn it with the rings.', true) }) },
    ],
    texture: [
      { id: 'look', icon: 'texturing', label: 'Give it a look', run: needSel((o) => applyLook(o, MATERIAL_PRESETS[0].name)), more: MATERIAL_PRESETS.map((p) => ({ id: p.name, icon: 'texturing', label: p.name, run: needSel((o) => applyLook(o, p.name)) })) },
      { id: 'paint', icon: 'brush', label: 'Paint on it (colors, gloss, metal, neon, glass, bumps, masks)', on: ed.mode === 'paint', run: () => enterMode('paint') },
      { id: 'nodes', icon: 'nodes', label: 'Node space: make pictures and shapes with nodes, then use them in a Picture material', run: () => { const api = dockApi(); if (api) openPanel(api, 'nodes-main') } },
      { id: 'picture', icon: 'photo', label: 'Put Motion (or a node picture) on it', run: needSel((o) => updateObject(o.id, { material: 'picture', picture: o.picture ?? 'Create' }, 'Picture material')) },
    ],
    light: [
      { id: 'point', icon: 'light', label: 'Point light', run: add('point-light') },
      { id: 'spot', icon: 'projector', label: 'Spot light', run: add('spot-light') },
      { id: 'sun', icon: 'sun', label: 'Sun', run: add('sun') },
      { id: 'fog', icon: 'fluid', label: 'Fog volume', run: add('fog') },
      { id: 'world', icon: 'world', label: 'World settings (sky, light from around, color, shadows)', run: () => select3d(null) },
      { id: 'bloom', icon: 'spark', label: 'Bloom (glow spreads into the air)', on: Boolean(world.bloom?.on), run: () => changeWorld('Bloom', (w) => ({ ...w, bloom: { strength: 0.8, radius: 0.4, threshold: 0.8, ...(w.bloom ?? {}), on: !w.bloom?.on } })) },
    ],
    animate: [
      { id: 'timeline', icon: 'timeline', label: 'The 3D timeline', run: () => { const api = dockApi(); if (api) openPanel(api, '3d-timeline') } },
      { id: 'key', icon: 'key', label: 'Put keys here: where it is, how it is turned and its size', run: needSel((o) => {
        const t = play.time
        ;(['x', 'y', 'z'] as const).forEach((a, i) => { setKey(`3d:${o.id}.position.${a}`, t, o.position[i], 'Key'); setKey(`3d:${o.id}.rotation.${a}`, t, o.rotation[i], 'Key') })
        setKey(`3d:${o.id}.scale`, t, 1, 'Key')
        toast(`Keys for ${o.name} at ${t.toFixed(2)} s.`, true)
      }) },
      { id: 'play', icon: 'render', label: play.playing ? 'Pause the timeline' : 'Play the timeline', on: play.playing, run: playPause },
      { id: 'phys', icon: 'physics', label: 'Physics: falls, bounces and bumps into things', run: needSel((o) => updateObject(o.id, { physics: o.physics?.on ? { ...o.physics, on: false } : { ...PHYSICS_DEFAULT, ...(o.physics ?? {}), on: true } }, 'Physics')), more: [
        { id: 'fall', icon: 'physics', label: 'It falls and bounces', run: needSel((o) => updateObject(o.id, { physics: { ...PHYSICS_DEFAULT, ...(o.physics ?? {}), on: true, still: false, pieces: 0 } }, 'Physics')) },
        { id: 'still', icon: 'lock', label: 'It stays put, others bump into it', run: needSel((o) => updateObject(o.id, { physics: { ...PHYSICS_DEFAULT, ...(o.physics ?? {}), on: true, still: true } }, 'Physics')) },
        { id: 'shatter', icon: 'shatter', label: 'It breaks into pieces', run: needSel((o) => updateObject(o.id, { physics: { ...PHYSICS_DEFAULT, ...(o.physics ?? {}), on: true, still: false, pieces: 14, blast: 2 } }, 'Break')) },
      ] },
      { id: 'fluid', icon: 'fluid', label: 'Add a fluid', run: add('fluid') },
      { id: 'simplay', icon: sim.playing ? 'lock' : 'physics', label: sim.playing ? 'Pause the simulation' : 'Play the simulation', on: sim.playing, run: () => (sim.playing ? pauseSim() : playSim()), more: [
        { id: 'reset', icon: 'rotate', label: 'Reset (back to where you built it)', run: resetSim },
        { id: 'keep', icon: 'key', label: 'Keep where things ended up', run: () => { const list = simPlaces(); changeWorld('Keep simulation', (w) => ({ ...w, objects: w.objects.map((o) => { const p = list.find((x) => x.id === o.id); return p ? { ...o, position: p.position, rotation: p.rotation } : o }) })); resetSim() } },
      ] },
    ],
    render: [
      { id: 'saveview', icon: 'camera', label: 'Remember this view', run: saveCamera },
      { id: 'dof', icon: 'view', label: 'Depth of field (World settings > Camera and lens)', on: Boolean(world.env?.dof), run: () => changeWorld('Depth of field', (w) => ({ ...w, env: { ...(w.env ?? {}), dof: !w.env?.dof } })) },
      { id: 'export', icon: 'import', label: 'Export for other 3D apps', run: () => void exportLookFile(), more: [
        { id: 'look', icon: 'texturing', label: 'The look, baked (.glb)', run: () => void exportLookFile() },
        { id: 'shapes', icon: 'cube', label: 'Shapes only (.glb)', run: () => void exportShapesFile() },
        { id: 'glsl', icon: 'nodes', label: 'The look as shader code (.glsl)', run: () => void exportGlslFile() },
      ] },
      { id: 'png', icon: 'photo', label: 'Save a picture of the view (.png)', run: snapshotPng },
      { id: 'motion', icon: 'comp', label: 'Send to Motion', run: () => sendToMotion(false), more: [
        { id: 'match', icon: 'timeline', label: 'As a layer on the same timeline', run: () => sendToMotion(false) },
        { id: 'precomp', icon: 'comp', label: 'As a precomp with its own time', run: () => sendToMotion(true) },
      ] },
    ],
  }
  return (
    <ToolStrip label="3D tools">
      <ToolGroup>
        {(() => { const cur = STAGES.find((x) => x[0] === st)!; return <ToolBtn t={{ id: 'stage', icon: cur[2], text: cur[1], label: `Stage: ${cur[1]} (click to pick another)`, menu: true, run: () => {}, more: STAGES.map(([s2, label, icon]) => ({ id: s2, icon, label, on: st === s2, run: () => setStage(s2) })) }} /> })()}
      </ToolGroup>
      <i className="ts-sep" />
      <ToolGroup tone="pink">{handles.map((x) => <ToolBtn key={x.id} t={x} />)}<ToolBtn t={spaceBtn} /></ToolGroup>
      <i className="ts-sep" />
      <ToolGroup label="Snap" tone="pink">{magnets.map((x) => <ToolBtn key={x.id} t={x} />)}</ToolGroup>
      <i className="ts-sep" />
      <ToolGroup>{withAttr(stageTools[st]).map((x) => <ToolBtn key={x.id} t={x} />)}<ToolBtn t={{ id: 'attr', icon: 'settings', label: 'Properties of the picked thing, with keys (like an attribute editor)', key: 'Ctrl+A', run: () => openAttr() }} /></ToolGroup>
      <i className="ts-sep" />
      <ToolGroup label={mine.tools.length ? 'Your tools' : undefined}>
        {mine.tools.map((m) => (
          <span key={m.id} onContextMenu={(e) => { e.preventDefault(); setToolEdit(m) }}>
            <ToolBtn t={{ id: m.id, icon: m.icon, label: `${m.name}${m.kind === 'canvas' ? ': click in the 3D view (Esc stops)' : ''} (right-click to change)`, key: m.key, on: mine.active === m.id, run: () => (m.kind === 'canvas' ? pick3dTool(m.id) : run3dAction(m.id)) }} />
          </span>
        ))}
        <ToolBtn t={{ id: 'new3dtool', icon: 'plus', quiet: true, label: 'Make your own tool', run: () => setToolEdit({ id: Math.random().toString(36).slice(2, 9), name: 'My tool', icon: 'spark', kind: 'canvas', code: TOOL3D_TEMPLATE.canvas }) }} />
      </ToolGroup>
      <span className="grow" />
      <ToolGroup>{view.map((x) => <ToolBtn key={x.id} t={x} />)}</ToolGroup>
      <AttrBox />
      {toolEdit && <ToolEditor tool={toolEdit} onClose={() => setToolEdit(null)} put={put3dTool} remove={remove3dTool} importAll={import3dTools} templates={TOOL3D_TEMPLATE}
        kinds={{ canvas: 'Click in the 3D view', action: 'Runs once' }}
        hint="rico.objects(), rico.selected(), rico.add(kind, values), rico.set(id, key, value), rico.move(id, x, y, z), rico.turn(id, x, y, z), rico.size(id, s), rico.color(id, color), rico.copy(id), rico.remove(id), rico.select(id), rico.signal(name), rico.time(), rico.toast(text). Kinds: box, sphere, cylinder, cone, torus, knot, capsule, icosa, plane, ring, text, point-light, spot-light, sun." />}
    </ToolStrip>
  )
}

// Tools that add a setting also open the property box at it.
const ATTR_PART: Record<string, 'Deform' | 'Morph' | 'Physics' | 'Liquid' | 'Fog' | 'Look layers'> = {
  deform: 'Deform', bend: 'Deform', twist: 'Deform', taper: 'Deform', squash: 'Deform', wave: 'Deform',
  morph: 'Morph', sphere: 'Morph', cube: 'Morph', phys: 'Physics', fall: 'Physics', still: 'Physics', shatter: 'Physics',
  fluid: 'Liquid', fog: 'Fog', look: 'Look layers',
}
function withAttr(items: ToolItem[]): ToolItem[] {
  return items.map((t) => {
    const part = ATTR_PART[t.id]
    if (!part) return t
    const after = (run: () => void) => () => { run(); window.setTimeout(() => openAttr(part), 30) }
    return { ...t, run: after(t.run), more: t.more?.map((m) => ({ ...m, run: after(m.run) })) }
  })
}

// The 3D scene as a Motion layer: on the same timeline, or as a precomp
// with its own time (start, speed) that you can move and stretch.
function sendToMotion(precomp: boolean) {
  const l = newLayer('scene3d')
  if (precomp) { l.name = '3D precomp'; l.values = { ...l.values, time: 1 } }
  changeScene(precomp ? 'Add 3D precomp' : 'Add 3D scene', (s) => ({ ...s, layers: [...s.layers, l] }))
  select(l.id)
  goTo('create')
  toast(precomp ? 'The 3D scene is a precomp in Motion, with its own time.' : 'The 3D scene is a layer in Motion, on the same timeline.', true)
}
