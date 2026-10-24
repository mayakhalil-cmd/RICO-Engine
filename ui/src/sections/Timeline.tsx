import { animatables } from '../three/keyed'
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { toast } from '../components/Toasts'
import { BLEND_MODES, LAYER_TYPES, MASTER_PARAMS, layerType } from '../create/layers'
import { LABEL_COLORS, MATTES, newLayer, type Cue, type CueKind, type Ease, type Key, type Layer, type OutKind, type OutTrack, type Scene, type Track } from '../create/scene'
import { changeScene, closeComp, listComps, newComp, openComp, select, useCreate } from '../create/store'
import {
  CUE_LABEL, OUT_LABEL, addCue, addOutTrack, arm, formatTime, getPlay, keysOf, moveKeys, moveLayer, pasteKeys, playPause, removeCue, removeKeys,
  removeOutTrack, removeTrack, seek, setEase, setKey, setLayerTime, setScrubbing, setWorkArea, stepFrames, stop, timelineOf,
  trackFor, updateCue, updateOutTrack, usePlay, valueAt, workArea, formatUnits, rulerLabel, rulerStep, type CopiedKey, type TimeUnits,
} from '../create/timeline'
import { addPrecompLayer, baseValue, currentValue, insertLayer, newAdjustment, newNull, newShape, newSolid, newText, precompose, updateLayer } from '../create/ops'
import { onTimelineAction, timelineAction } from '../create/timelineBus'
import { keyLabel } from '../shell/shortcuts'
import Icon from '../components/Icon'
import PopMenu from '../components/PopMenu'
import { Hint } from '../components/Tips'
import { PropRow, propGroups, type PropDef } from './LayerProps'
import { KeyRow3d } from './KeyControls'
import Scrub from '../components/Scrub'
import { openLayerSettings } from './LayerSettings'
import { getCommands } from '../shell/commands'
import { LINKABLE, getWorld, isLight, type Obj3D } from '../three/world'
import { canEncodeMp4, defaultRange, renderMp4, renderWebm, saveBlob } from '../create/export'
import { pickFile } from '../shell/ui'
import { setTlView, useTlView } from '../create/tlView'

// The timeline: layers as bars you can trim and move,
// animated settings as rows of keyframes under their layer, a playhead you
// can drag. Set a key with the diamond next to any setting in the Inspector.

const EASE_LABEL: Record<Ease, string> = { smooth: 'Smooth', linear: 'Straight', in: 'Slow start', out: 'Slow end', hold: 'Jump' }

// "3d:abc.position.x" -> ["3d:abc", "position.x"]
const splitTarget = (target: string): [string, string] => {
  const i = target.indexOf('.')
  return i < 0 ? [target, ''] : [target.slice(0, i), target.slice(i + 1)]
}

function labelFor(scene: Scene, target: string) {
  const [owner, key] = splitTarget(target)
  if (owner.startsWith('3d:')) {
    const o = getWorld().objects.find((x) => x.id === owner.slice(3))
    const an = o ? animatables(o, getWorld()).find((x) => x.key === key) : undefined
    return { group: `3D ${o?.name ?? '?'}`, name: an ? (an.group === 'Object' ? an.label : `${an.group}: ${an.label}`) : LINKABLE.find((l) => l.key === key)?.label ?? key }
  }
  if (owner === 'master') return { group: 'Finish', name: MASTER_PARAMS.find((p) => p.key === key)?.label ?? key }
  const layer = scene.layers.find((l) => l.id === owner)
  if (!layer) return { group: '?', name: key }
  if (key === 'opacity') return { group: layer.name, name: 'Opacity' }
  return { group: layer.name, name: layerType(layer.type).params.find((p) => p.key === key)?.label ?? key }
}

function rangeOf(scene: Scene, target: string): [number, number] {
  const [owner, key] = splitTarget(target)
  if (owner.startsWith('3d:')) {
    const o = getWorld().objects.find((x) => x.id === owner.slice(3))
    const an = o ? animatables(o, getWorld()).find((x) => x.key === key) : undefined
    const l = LINKABLE.find((x) => x.key === key)
    return [an?.min ?? l?.min ?? 0, an?.max ?? l?.max ?? 1]
  }
  if (key === 'opacity') return [0, 1]
  const params = owner === 'master' ? MASTER_PARAMS : layerType(scene.layers.find((l) => l.id === owner)?.type ?? '').params
  const p = params.find((x) => x.key === key)
  return [p?.min ?? 0, p?.max ?? 1]
}

export async function importMedia(file: File, at: number) {
  if (file.type.startsWith('video/')) {
    const url = URL.createObjectURL(file)
    const length = await new Promise<number>((res) => {
      const v = document.createElement('video')
      v.preload = 'metadata'
      v.onloadedmetadata = () => res(v.duration || 5)
      v.onerror = () => res(5)
      v.src = url
    })
    const l = newLayer('video')
    l.name = file.name.replace(/\.[^.]+$/, '')
    l.video = url
    l.start = at
    l.end = at + length
    changeScene(`Import ${l.name}`, (s) => ({
      ...s,
      layers: [...s.layers, l],
      timeline: { ...timelineOf(s), duration: Math.max(timelineOf(s).duration, Math.ceil(at + length)) },
    }))
    select(l.id)
    toast('Video added. Video files are not saved inside the scene; keep the file to open it again.', true)
  } else if (file.type.startsWith('image/')) {
    const url = await new Promise<string>((res) => {
      const r = new FileReader()
      r.onload = () => res(String(r.result))
      r.readAsDataURL(file)
    })
    const l = newLayer('image')
    l.name = file.name.replace(/\.[^.]+$/, '')
    l.image = url
    changeScene(`Import ${l.name}`, (s) => ({ ...s, layers: [...s.layers, l] }))
    select(l.id)
  } else {
    toast('RICO can bring in videos and pictures here.')
  }
}

function RenderDialog({ onClose }: { onClose: () => void }) {
  const scene = useCreate((s) => s.scene)
  const def = defaultRange()
  const [format, setFormat] = useState<'mp4' | 'webm'>(canEncodeMp4() ? 'mp4' : 'webm')
  const [to, setTo] = useState(def.to)
  const [quality, setQuality] = useState(12)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const cancel = useRef({ cancelled: false })

  const go = async () => {
    cancel.current = { cancelled: false }
    setProgress({ done: 0, total: 1 })
    try {
      const opts = { from: 0, to, fps: def.fps, bitrate: quality * 1e6, signal: cancel.current, onProgress: (done: number, total: number) => setProgress({ done, total }) }
      const blob = format === 'mp4' ? await renderMp4(opts) : await renderWebm(opts)
      saveBlob(blob, `${scene.name.replace(/[^\w -]/g, '') || 'rico'}.${format}`)
      toast('Video saved to your Downloads folder.', true)
      onClose()
    } catch (e) {
      if ((e as Error).message !== 'cancelled') toast(`Rendering stopped: ${(e as Error).message}`)
      setProgress(null)
    }
  }

  return (
    <div className="tl-render" role="dialog" aria-label="Render video">
      <h3>Render video</h3>
      <div className="row wrap">
        <label className="field"><span>Format</span>
          <select className="select" value={format} onChange={(e) => setFormat(e.target.value as 'mp4' | 'webm')} disabled={Boolean(progress)}>
            <option value="mp4" disabled={!canEncodeMp4()}>MP4, every frame exact</option>
            <option value="webm">WebM, recorded in real time</option>
          </select>
        </label>
        <label className="field"><span>Length (s)</span>
          <input className="input num" type="number" min={0.5} step={0.5} value={to} disabled={Boolean(progress)} onChange={(e) => setTo(Math.max(0.5, Number(e.target.value)))} />
        </label>
        <label className="field"><span>Quality (Mbit/s)</span>
          <input className="input num" type="number" min={1} max={80} value={quality} disabled={Boolean(progress)} onChange={(e) => setQuality(Math.max(1, Math.min(80, Number(e.target.value))))} />
        </label>
      </div>
      <p className="dim small">{scene.width} x {scene.height} at {def.fps} fps, {Math.round(to * def.fps)} frames. Linked settings use their live value while rendering; animate them with keys for an exact result.</p>
      {progress && (
        <div className="tl-progress"><i style={{ width: `${(progress.done / progress.total) * 100}%` }} /><span>{progress.done} / {progress.total}</span></div>
      )}
      <div className="row end">
        {progress
          ? <button className="btn out" onClick={() => { cancel.current.cancelled = true }}>Cancel</button>
          : <><button className="btn quiet" onClick={onClose}>Close</button><button className="btn primary" onClick={go}>Render</button></>}
      </div>
    </div>
  )
}


// The value a 3D setting has now, for its first key.
function value3d(o: Obj3D, key: string): number {
  const axis = { x: 0, y: 1, z: 2 } as const
  const [k, a] = key.split('.') as [string, 'x' | 'y' | 'z' | undefined]
  if ((k === 'position' || k === 'rotation') && a) return o[k][axis[a]]
  if (k === 'scale' || k === 'deform' || k === 'lookSize' || k === 'lookThick') return 1
  if (k === 'morph') return o.morph?.amount ?? 0
  const v = (o as unknown as Record<string, unknown>)[k]
  return typeof v === 'number' ? v : 0
}

// A small menu that closes when you click elsewhere.
function Menu({ label, className = 'btn small quiet', children }: { label: string; className?: string; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement | null>(null)
  return (
    <div className="tl-menu">
      <button ref={ref} className={className} aria-expanded={open} onClick={() => setOpen(!open)}>{label} ▾</button>
      {open && <PopMenu anchor={ref} onClose={() => setOpen(false)} className="tl-menu-list">{children(() => setOpen(false))}</PopMenu>}
    </div>
  )
}

function AddLayerMenu() {
  const add = (type: string, close: () => void) => {
    close()
    insertLayer(newLayer(type))
  }
  const keyOf = (id: string) => keyLabel(id)
  const visual = LAYER_TYPES.filter((t) => !t.source && !['solid', 'null', 'adjust', 'vshape', 'text'].includes(t.id))
  return (
    <Menu label="+ Layer" className="btn small primary">
      {(close) => <>
        <div className="menu-head">New layer</div>
        <button role="menuitem" onClick={() => { close(); newSolid() }}><span>Solid</span><kbd>{keyOf('ae.solid')}</kbd></button>
        <button role="menuitem" onClick={() => { close(); newText() }}><span>Text</span><kbd>{keyOf('ae.text')}</kbd></button>
        <button role="menuitem" onClick={() => { close(); newShape() }}><span>Shape layer</span><kbd>{keyOf('ae.shape')}</kbd></button>
        <button role="menuitem" onClick={() => { close(); newNull() }}><span>Null object</span><kbd>{keyOf('ae.null')}</kbd></button>
        <button role="menuitem" onClick={() => { close(); newAdjustment() }}><span>Adjustment layer</span><kbd>{keyOf('ae.adjust')}</kbd></button>
        <button role="menuitem" onClick={() => add('particles', close)}><span>Particles</span></button>
        <hr />
        <div className="menu-head">Compositions</div>
        <button role="menuitem" onClick={() => { close(); precompose() }}><span>Pre-compose the selected layer</span><kbd>{keyOf('ae.precompose')}</kbd></button>
        <button role="menuitem" onClick={() => { close(); openComp(newComp()) }}><span>New composition</span><kbd>{keyOf('ae.newComp')}</kbd></button>
        {listComps().filter((c) => c.id).map((c) => <button key={c.id} role="menuitem" onClick={() => { close(); addPrecompLayer(c.id) }}><span>{c.name}</span><span className="dim small">as a layer</span></button>)}
        <hr />
        <div className="menu-head">From other parts of RICO</div>
        <button role="menuitem" onClick={() => add('scene3d', close)}><span>3D scene</span><span className="dim small">the 3D playground</span></button>
        <button role="menuitem" onClick={() => add('picture', close)}><span>Node picture</span><span className="dim small">a Picture out from nodes</span></button>
        <button role="menuitem" onClick={() => add('camera', close)}><span>Camera</span></button>
        <button role="menuitem" onClick={() => { close(); pickFile('video/*,image/*', (f) => importMedia(f, getPlay().time)) }}><span>Video or picture file...</span></button>
        <hr />
        <div className="menu-head">Generators</div>
        {visual.filter((t) => t.id !== 'particles').map((t) => <button key={t.id} role="menuitem" title={t.about} onClick={() => add(t.id, close)}><span>{t.name}</span></button>)}
        <p className="dim small menu-note">New layers go above the selected one. With the playhead moved, they start there.</p>
      </>}
    </Menu>
  )
}

function AddTrackMenu({ at, onAdded }: { at: number; onAdded: (target: string) => void }) {
  const [obj, setObj] = useState<string>('')
  const objects = getWorld().objects
  const o = objects.find((x) => x.id === obj)
  return (
    <Menu label="+ Track">
      {(close) => <>
        <div className="menu-head">Send while playing</div>
        {(['osc', 'midi-cc', 'dmx', 'signal'] as OutKind[]).map((k) => (
          <button key={k} role="menuitem" onClick={() => { close(); onAdded(`out:${addOutTrack(k)}`) }}>
            <span>{OUT_LABEL[k]}</span>
            <span className="dim small">{k === 'osc' ? 'to any app or device' : k === 'midi-cc' ? 'to a synth or DAW' : k === 'dmx' ? 'to a light' : 'any part of RICO can follow it'}</span>
          </button>
        ))}
        <hr />
        <div className="menu-head">Animate a 3D setting</div>
        <div className="menu-row">
          <select className="select" value={obj} onChange={(e) => setObj(e.target.value)} aria-label="3D object">
            <option value="">Pick an object...</option>
            {objects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </div>
        {o && LINKABLE.filter((l) => (isLight(o.kind) ? l.key.startsWith('position') || l.key === 'intensity' || l.key === 'hue' : l.key !== 'intensity')).map((l) => (
          <button key={l.key} role="menuitem" onClick={() => {
            close()
            const target = `3d:${o.id}.${l.key}`
            setKey(target, at, value3d(o, l.key), `Animate ${o.name} ${l.label}`)
            onAdded(target)
          }}><span>{l.label}</span></button>
        ))}
        {!objects.length && <p className="dim small menu-note">Add things in the 3D workspace first.</p>}
      </>}
    </Menu>
  )
}

function OutTrackEditor({ o, onClose }: { o: OutTrack; onClose: () => void }) {
  const up = (part: Partial<OutTrack>) => updateOutTrack(o.id, part)
  return (
    <div className="tl-edit">
      <b>{OUT_LABEL[o.kind]} track</b>
      <label className="mini">Name <input className="input" value={o.name} onChange={(e) => up({ name: e.target.value })} style={{ width: 120 }} /></label>
      {o.kind === 'osc' && <>
        <label className="mini">To <input className="input" value={o.host} onChange={(e) => up({ host: e.target.value })} style={{ width: 110 }} /></label>
        <label className="mini">Port <input className="input num" type="number" value={o.port} onChange={(e) => up({ port: Number(e.target.value) })} style={{ width: 70 }} /></label>
        <label className="mini">Address <input className="input" value={o.address} onChange={(e) => up({ address: e.target.value })} style={{ width: 150 }} /></label>
        <label className="mini">Sends <input className="input num" type="number" value={o.min} onChange={(e) => up({ min: Number(e.target.value) })} style={{ width: 60 }} /> to <input className="input num" type="number" value={o.max} onChange={(e) => up({ max: Number(e.target.value) })} style={{ width: 60 }} /></label>
      </>}
      {o.kind === 'midi-cc' && <>
        <label className="mini">Channel <input className="input num" type="number" min={1} max={16} value={o.channel} onChange={(e) => up({ channel: Math.max(1, Math.min(16, Number(e.target.value))) })} style={{ width: 56 }} /></label>
        <label className="mini">CC <input className="input num" type="number" min={0} max={127} value={o.number} onChange={(e) => up({ number: Math.max(0, Math.min(127, Number(e.target.value))) })} style={{ width: 60 }} /></label>
      </>}
      {o.kind === 'dmx' && <label className="mini">DMX channel <input className="input num" type="number" min={1} max={512} value={o.channel} onChange={(e) => up({ channel: Math.max(1, Math.min(512, Number(e.target.value))) })} style={{ width: 64 }} /></label>}
      {o.kind === 'signal' && <span className="dim small">Shows up as "Timeline: {o.name}" in every signal list.</span>}
      <span className="dim small">Double-click the lane to add a point. Drag points up and down.</span>
      <span className="grow" />
      <button className="icon-btn small" title="Close" onClick={onClose}>×</button>
    </div>
  )
}

function CueEditor({ c, onClose }: { c: Cue; onClose: () => void }) {
  const up = (part: Partial<Cue>) => updateCue(c.id, part)
  return (
    <div className="tl-edit">
      <b>Cue</b>
      <label className="mini">Name <input className="input" value={c.name} onChange={(e) => up({ name: e.target.value })} style={{ width: 110 }} /></label>
      <label className="mini">At <input className="input num" type="number" step={0.05} value={Number(c.t.toFixed(3))} onChange={(e) => up({ t: Math.max(0, Number(e.target.value)) })} style={{ width: 70 }} />s</label>
      <select className="select" value={c.kind} onChange={(e) => up({ kind: e.target.value as CueKind })}>
        {(Object.keys(CUE_LABEL) as CueKind[]).map((k) => <option key={k} value={k}>{CUE_LABEL[k]}</option>)}
      </select>
      {c.kind === 'osc' && <>
        <label className="mini">To <input className="input" value={c.host} onChange={(e) => up({ host: e.target.value })} style={{ width: 110 }} /></label>
        <label className="mini">Port <input className="input num" type="number" value={c.port} onChange={(e) => up({ port: Number(e.target.value) })} style={{ width: 70 }} /></label>
        <label className="mini">Address <input className="input" value={c.address} onChange={(e) => up({ address: e.target.value })} style={{ width: 150 }} /></label>
        <label className="mini">Value <input className="input num" type="number" value={c.value} onChange={(e) => up({ value: Number(e.target.value) })} style={{ width: 60 }} /></label>
      </>}
      {c.kind === 'midi-note' && <>
        <label className="mini">Channel <input className="input num" type="number" min={1} max={16} value={c.channel} onChange={(e) => up({ channel: Number(e.target.value) })} style={{ width: 56 }} /></label>
        <label className="mini">Note <input className="input num" type="number" min={0} max={127} value={c.number} onChange={(e) => up({ number: Number(e.target.value) })} style={{ width: 60 }} /></label>
      </>}
      {c.kind === 'command' && (
        <select className="select" value={c.command} onChange={(e) => up({ command: e.target.value })}>
          <option value="">Pick a command...</option>
          {getCommands().filter((x) => !x.id.startsWith('panel.')).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
      )}
      {c.kind === 'signal' && <span className="dim small">Hits "Cue: {c.name}", so a route, a node or a 3D link can react.</span>}
      <button className="btn small out" onClick={() => removeCue(c.id)}>Delete cue</button>
      <span className="grow" />
      <button className="icon-btn small" title="Close" onClick={onClose}>×</button>
    </div>
  )
}

interface SelKey { target: string; t: number }
let keyClipboard: CopiedKey[] = []

// What is twirled open on each layer: everything, only animated properties
// (U), or just some (P, S, R, T, A...).
type Reveal = { mode: 'all' } | { mode: 'animated'; changed?: boolean } | { mode: 'keys'; keys: string[] }
const REVEAL_KEYS: Record<string, string[]> = {
  p: ['tr_px', 'tr_py'], s: ['tr_sx', 'tr_sy'], r: ['tr_rot'], t: ['opacity'], a: ['tr_ax', 'tr_ay'],
}

const PROP_H = 24
const GROUP_H = 22

function LayerRow({ l, index, selected, mode, open, onTwirl, renaming, onRenamed, dragOk, onDragLayer }: {
  l: Layer; index: number; selected: boolean; mode: 'switches' | 'modes'; open: boolean; onTwirl: () => void
  renaming: boolean; onRenamed: () => void; dragOk: boolean; onDragLayer: (id: string | null) => void
}) {
  const scene = useCreate((s) => s.scene)
  const up = (label: string, part: Partial<Layer>) => updateLayer(l.id, label, (x) => ({ ...x, ...part }))
  const stackIndex = scene.layers.indexOf(l)
  const others = [...scene.layers].reverse().filter((x) => x.id !== l.id)
  return (
    <div
      className={`tl-name layer ae${selected ? ' on' : ''}${l.visible ? '' : ' hidden'}${dragOk ? ' drop-ok' : ''}`}
      draggable={!renaming}
      onDragStart={(e) => { onDragLayer(l.id); e.dataTransfer.setData('text/x-rico-layer', l.id); e.dataTransfer.effectAllowed = 'move' }}
      onDragEnd={() => onDragLayer(null)}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('text/x-rico-layer')) e.preventDefault() }}
      onDrop={(e) => {
        const id = e.dataTransfer.getData('text/x-rico-layer')
        if (id && id !== l.id) { e.preventDefault(); e.stopPropagation(); moveLayer(id, stackIndex) }
        onDragLayer(null)
      }}
      onClick={() => select(l.id)}
    >
      <span className="ae-av">
        <button className={`sw-btn${l.visible ? ' on' : ''}`} title="Video: show or hide" onClick={(e) => { e.stopPropagation(); up(l.visible ? 'Hide layer' : 'Show layer', { visible: !l.visible }) }}><Icon name="eye" /></button>
        <button className={`sw-btn solo${l.solo ? ' on' : ''}`} title="Solo" onClick={(e) => { e.stopPropagation(); up('Solo', { solo: !l.solo }) }}><Icon name="solo" /></button>
        <button className={`sw-btn lock${l.locked ? ' on' : ''}`} title={l.locked ? 'Unlock' : 'Lock'} onClick={(e) => { e.stopPropagation(); up(l.locked ? 'Unlock' : 'Lock', { locked: !l.locked }) }}><Icon name={l.locked ? 'lock' : 'unlock'} /></button>
      </span>
      <button className="ae-label" style={{ background: LABEL_COLORS[l.label ?? 0] }} title="Label color (click to change)"
        onClick={(e) => { e.stopPropagation(); up('Label', { label: ((l.label ?? 0) + 1) % LABEL_COLORS.length }) }} />
      <span className="ae-num">{index}</span>
      <button className={`twirl${open ? ' open' : ''}`} title="Show properties" onClick={(e) => { e.stopPropagation(); onTwirl() }}><Icon name="twirl" /></button>
      <span className="ae-type" title={layerType(l.type).name}><Icon name={l.type === 'null' ? 'null' : l.type === 'adjust' ? 'adjust' : l.type === 'text' ? 'text' : l.type === 'vshape' ? 'shape' : l.type === 'solid' ? 'stop' : 'create'} /></span>
      {renaming
        ? <input className="input ae-rename" autoFocus defaultValue={l.name} onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') onRenamed() }}
            onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== l.name) up('Rename layer', { name: v }); onRenamed() }} />
        : <span className="tl-lname" onDoubleClick={(e) => { e.stopPropagation(); timelineAction('rename') }} title={l.name}>{l.name}</span>}
      {scene.layers.some((x, i) => x.matte && (x.matteFrom ? x.matteFrom === l.id : scene.layers[i + 1]?.id === l.id)) && <span className="ae-badge" title="This layer is a track matte for another layer, so it is not shown itself">matte</span>}
      {(l.matte ?? 0) > 0 && <span className="ae-badge on" title={MATTES[l.matte ?? 0]}>{(l.matte ?? 0) >= 3 ? 'luma' : 'alpha'}</span>}
      {mode === 'switches' ? (
        <span className="ae-sw">
          <button className={`sw-btn${l.shy ? ' on' : ''}`} title="Shy: hide from the timeline when Hide shy layers is on" onClick={(e) => { e.stopPropagation(); up('Shy', { shy: !l.shy }) }}><Icon name="shy" /></button>
          <button className={`sw-btn fx${l.fxOff || !l.effects?.length ? '' : ' on'}`} title={l.effects?.length ? (l.fxOff ? 'Turn effects on' : 'Turn effects off') : 'No effects'} disabled={!l.effects?.length}
            onClick={(e) => { e.stopPropagation(); up('Effects on/off', { fxOff: !l.fxOff }) }}><Icon name="fx" /></button>
          <span className={`sw-btn static${l.masks?.length ? ' on' : ''}`} title={l.masks?.length ? `${l.masks.length} mask(s)` : 'No masks'}><Icon name="mask" /></span>
          <select className="tl-blend" value={l.blend} title="Blend mode" onClick={(e) => e.stopPropagation()} onChange={(e) => up('Blend mode', { blend: Number(e.target.value) })}>
            {BLEND_MODES.map((m, i) => <option key={m} value={i}>{m}</option>)}
          </select>
        </span>
      ) : (
        <span className="ae-sw">
          <select className="tl-blend" value={l.matte ?? 0} title="Track matte from the layer above" onClick={(e) => e.stopPropagation()} onChange={(e) => up('Track matte', { matte: Number(e.target.value) })}>
            {MATTES.map((m, i) => <option key={m} value={i}>{i === 0 ? 'No matte' : m}</option>)}
          </select>
          <span className="sw-btn static" title="Parent"><Icon name="parent" /></span>
          <select className="tl-blend" value={l.parent ?? ''} title="Parent: follow another layer's movement" onClick={(e) => e.stopPropagation()} onChange={(e) => up('Parent', { parent: e.target.value || undefined })}>
            <option value="">None</option>
            {others.map((x) => <option key={x.id} value={x.id}>{scene.layers.length - scene.layers.indexOf(x)}. {x.name}</option>)}
          </select>
        </span>
      )}
    </div>
  )
}

export default function TimelinePanel({ only3d = false }: { only3d?: boolean } = {}) {
  const scene = useCreate((s) => s.scene)
  const selected = useCreate((s) => s.selected)
  const path = useCreate((s) => s.path)
  const play = usePlay()
  const tl = timelineOf(scene)
  // Zoom like a motion graphics timeline: 1 shows the whole comp from the
  // start to the very end, more zooms in down to single frames.
  const [zoom, setZoomRaw] = useState(1)
  const [viewW, setViewW] = useState(800)
  const [scrollX, setScrollX] = useState(0)
  const view = useTlView()
  const units = view.units
  const setUnits = (u: TimeUnits) => setTlView({ units: u })
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const snap = view.snap
  const [selKeys, setSelKeys] = useState<SelKey[]>([])
  const [selOut, setSelOut] = useState<string | null>(null)
  const [selCue, setSelCue] = useState<string | null>(null)
  const [rendering, setRendering] = useState(false)
  const [dropping, setDropping] = useState(false)
  const [dragLayer, setDragLayer] = useState<string | null>(null)
  const [reveal, setReveal] = useState<Record<string, Reveal>>({})
  const [hideShy, setHideShy] = useState(false)
  const [mode, setMode] = useState<'switches' | 'modes'>('switches')
  const [renaming, setRenaming] = useState<string | null>(null)
  // Three kinds of things live on the timeline. Each can be hidden so the
  // timeline is not overwhelming, but all of them stay on one time line.
  const [show, setShowRaw] = useState<{ layers: boolean; sends: boolean; cues: boolean }>(() => {
    try { return { layers: true, sends: true, cues: true, ...JSON.parse(localStorage.getItem('rico.tl.show') ?? '{}') } } catch { return { layers: true, sends: true, cues: true } }
  })
  const setShow = (part: Partial<typeof show>) => { const next = { ...show, ...part }; setShowRaw(next); try { localStorage.setItem('rico.tl.show', JSON.stringify(next)) } catch { /* private window */ } }
  const [leftW, setLeftW] = useState(() => { try { return Number(localStorage.getItem('rico.tl.left')) || 380 } catch { return 380 } })
  const lanes = useRef<HTMLDivElement | null>(null)
  const body = useRef<HTMLDivElement | null>(null)
  const lastU = useRef(0)
  // the graph view: taller rows, keys at their values (drag them up and down)
  const [graph, setGraph] = useState(false)
  const PH = graph ? 72 : PROP_H
  const [keyMenu, setKeyMenu] = useState<{ x: number; y: number; target: string; t: number } | null>(null)
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  useEffect(() => {
    if (!keyMenu) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setKeyMenu(null) }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [keyMenu])
  const fitPps = Math.max(1, (viewW - 24) / Math.max(0.1, tl.duration))
  const maxZoom = Math.max(1, (tl.fps * 60) / fitPps)    // 60 px a frame
  const pps = fitPps * Math.min(zoom, maxZoom)
  const width = Math.max(40, tl.duration * pps)
  const setZoom = (z: number, aroundT = getPlay().time) => {
    const el = body.current
    const nz = Math.max(1, Math.min(maxZoom, z))
    setZoomRaw(nz)
    // keep the time under the playhead (or the mouse) in the same place
    if (el) {
      const oldX = aroundT * pps - el.scrollLeft
      const np = fitPps * nz
      window.requestAnimationFrame(() => { el.scrollLeft = Math.max(0, aroundT * np - oldX) })
    }
  }
  const [wa, wb] = workArea(tl)
  const hasWork = tl.inPoint !== undefined || tl.outPoint !== undefined

  const snapT = (t: number) => {
    if (!snap) return Math.round(t * tl.fps) / tl.fps
    const beat = 60 / Math.max(1, tl.bpm) / 4      // sixteenth notes
    return Math.round(t / beat) * beat
  }
  const timeAt = (clientX: number) => {
    const r = lanes.current!.getBoundingClientRect()
    return Math.max(0, Math.min(tl.duration, (clientX - r.left) / pps))
  }
  const isSel = (target: string, t: number) => selKeys.some((k) => k.target === target && Math.abs(k.t - t) < 1e-6)

  // ---- which properties show under each layer ----
  const shownDefs = (l: Layer): { name: string; defs: PropDef[] }[] => {
    const r = reveal[l.id]
    if (!r) return []
    const groups = propGroups(scene, l)
    if (r.mode === 'all') return groups
    const keep = (d: PropDef) => {
      if (r.mode === 'keys') return r.keys.includes(d.key)
      const animated = Boolean(trackFor(scene, `${l.id}.${d.key}`))
      if (!r.changed) return animated
      const def = d.key === 'opacity' ? 1 : /^tr_s/.test(d.key) ? 1 : (layerType(l.type).params.find((p) => p.key === d.key)?.default ?? 0)
      return animated || Math.abs(baseValue(l, d.key) - Number(def)) > 1e-6
    }
    return groups.map((g) => ({ ...g, defs: g.defs.filter(keep) })).filter((g) => g.defs.length)
  }

  const targetLayers = () => {
    const l = scene.layers.find((x) => x.id === selected)
    return l ? [l] : scene.layers
  }

  const visibleTargets = (): string[] => {
    const out: string[] = []
    for (const l of scene.layers) for (const g of shownDefs(l)) for (const d of g.defs) out.push(`${l.id}.${d.key}`)
    return out
  }
  const allKeyTimes = (targets: string[]) => {
    const ts = new Set<number>()
    for (const t of targets) for (const k of keysOf(tl, t)) ts.add(k.t)
    return [...ts].sort((a, b) => a - b)
  }

  // ---- layer commands that need what is on screen ----
  useEffect(() => onTimelineAction((action) => {
    const [name, arg] = action.split(':')
    if (name === 'delete') {
      if (selKeys.length) { removeKeys(selKeys); setSelKeys([]); return true }
      if (selCue) { removeCue(selCue); setSelCue(null); return true }
      return false
    }
    if (name === 'deselect') { if (selKeys.length) { setSelKeys([]); return true } return false }
    if (name === 'duplicate') return false
    if (name === 'rename') { if (selected) setRenaming(selected); return true }
    if (name === 'render') { setRendering(true); return true }
    if (name === 'cueAdded') return true
    if (name === 'selectAll') {
      const targets = [...visibleTargets(), ...tl.tracks.map((x) => x.target), ...(tl.outTracks ?? []).map((o) => `out:${o.id}`)]
      setSelKeys([...new Set(targets)].flatMap((target) => keysOf(tl, target).map((k) => ({ target, t: k.t }))))
      return true
    }
    if (name === 'nudge' && selKeys.length) {
      const d = Number(arg) / tl.fps
      if (selKeys.every((x) => x.t + d >= 0)) {
        moveKeys(selKeys, d, 'nudge')
        setSelKeys(selKeys.map((x) => ({ ...x, t: x.t + d })))
      }
      return true
    }
    if (name === 'copy') {
      keyClipboard = selKeys.flatMap((s) => {
        const k = keysOf(tl, s.target).find((x) => Math.abs(x.t - s.t) < 1e-6)
        return k ? [{ target: s.target, t: k.t, v: k.v, ease: k.ease }] : []
      })
      if (keyClipboard.length) toast(`Copied ${keyClipboard.length} key${keyClipboard.length === 1 ? '' : 's'}.`, true)
      return true
    }
    if (name === 'paste') { if (keyClipboard.length) pasteKeys(keyClipboard, play.time); return true }
    if (name === 'ease') {
      if (!selKeys.length) { toast('Select some keys first (click a key, Shift-click for more).'); return true }
      for (const k of selKeys) setEase(k.target, k.t, arg as Ease)
      return true
    }
    if (name === 'prevKey' || name === 'nextKey') {
      const vis = visibleTargets()
      const times = allKeyTimes(vis.length ? vis : [...tl.tracks.map((x) => x.target), ...(tl.outTracks ?? []).map((o) => `out:${o.id}`)])
      const t = name === 'nextKey' ? times.find((x) => x > play.time + 1e-4) : [...times].reverse().find((x) => x < play.time - 1e-4)
      if (t !== undefined) seek(t)
      return true
    }
    if (name === 'reveal' || name === 'reveal+') {
      const next = { ...reveal }
      for (const l of targetLayers()) {
        if (arg === 'u') {
          const double = performance.now() - lastU.current < 450
          next[l.id] = { mode: 'animated', changed: double }
        } else if (arg === 'e' || arg === 'm' || arg === 'f') {
          const keys = propGroups(scene, l).flatMap((g) => g.defs.map((d) => d.key)).filter((k) => (arg === 'e' ? k.startsWith('fx_') : arg === 'f' ? /^m\d+_feather$/.test(k) : /^m\d+_/.test(k)))
          next[l.id] = { mode: 'keys', keys }
        } else {
          const keys = REVEAL_KEYS[arg] ?? []
          const cur = reveal[l.id]
          const was = name === 'reveal+' && cur?.mode === 'keys' ? cur.keys : []
          const same = name === 'reveal' && cur?.mode === 'keys' && cur.keys.join() === keys.join()
          if (same) delete next[l.id]
          else next[l.id] = { mode: 'keys', keys: [...new Set([...was, ...keys])] }
        }
      }
      if (arg === 'u') lastU.current = performance.now()
      setReveal(next)
      return true
    }
    if (name === 'key') {
      const l = scene.layers.find((x) => x.id === selected)
      if (!l) { toast('Select a layer first.'); return true }
      for (const k of REVEAL_KEYS[arg] ?? []) setKey(`${l.id}.${k}`, play.time, currentValue(scene, l, k), 'Add key')
      setReveal({ ...reveal, [l.id]: { mode: 'keys', keys: [...new Set([...(reveal[l.id]?.mode === 'keys' ? (reveal[l.id] as { keys: string[] }).keys : []), ...(REVEAL_KEYS[arg] ?? [])])] } })
      return true
    }
    if (name === 'zoom') {
      if (arg === 'fit') setZoom(1)
      else setZoom(arg === 'in' ? zoom * 1.4 : zoom / 1.4)
      return true
    }
    return false
  }), [selKeys, selCue, selected, reveal, scene, tl, play.time, zoom, pps])

  // the width of the time area, to fit the whole comp at zoom 1
  useEffect(() => {
    const el = body.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewW(Math.max(100, el.clientWidth - leftW)))
    ro.observe(el)
    setViewW(Math.max(100, el.clientWidth - leftW))
    return () => ro.disconnect()
  }, [leftW])
  // Alt + wheel zooms around the mouse
  useEffect(() => {
    const el = lanes.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      if (!e.altKey) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      setZoom(zoom * (e.deltaY < 0 ? 1.25 : 0.8), Math.max(0, (e.clientX - r.left) / pps))
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  })

  // ---- scrubbing the ruler ----
  const onRulerDown = (e: RPointerEvent) => {
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    setScrubbing(true)
    seek(Math.round(timeAt(e.clientX) * tl.fps) / tl.fps)
  }
  const onRulerMove = (e: RPointerEvent) => { if (e.buttons & 1) seek(Math.round(timeAt(e.clientX) * tl.fps) / tl.fps) }
  const onRulerUp = () => setScrubbing(false)
  // the playhead can be grabbed anywhere along its line
  const dragPlayhead = (e: RPointerEvent) => {
    e.stopPropagation(); e.preventDefault()
    setScrubbing(true)
    const move = (ev: PointerEvent) => seek(snap && ev.shiftKey ? snapT(timeAt(ev.clientX)) : Math.round(timeAt(ev.clientX) * tl.fps) / tl.fps)
    const up = () => { setScrubbing(false); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // ---- dragging keys (all selected keys move together) ----
  const dragKey = (e: RPointerEvent, target: string, t: number, value?: { lo: number; hi: number; height: number; v: number }) => {
    e.stopPropagation()
    let sel = selKeys
    if (e.shiftKey || e.ctrlKey) {
      sel = isSel(target, t) ? selKeys.filter((k) => !(k.target === target && Math.abs(k.t - t) < 1e-6)) : [...selKeys, { target, t }]
      setSelKeys(sel)
      return
    }
    if (!isSel(target, t)) sel = [{ target, t }]
    setSelKeys(sel)
    setSelCue(null)
    const startX = e.clientX, startY = e.clientY
    let moved = 0
    const merge = `drag.${Date.now()}`
    const move = (ev: PointerEvent) => {
      const want = snapT((ev.clientX - startX) / pps + t) - t
      if (want !== moved && sel.every((k) => k.t + want >= 0)) {
        moveKeys(sel.map((k) => ({ target: k.target, t: k.t + moved })), want - moved, merge)
        moved = want
        setSelKeys(sel.map((k) => ({ target: k.target, t: k.t + moved })))
      }
      if (value && sel.length === 1) {
        const v = Math.max(value.lo, Math.min(value.hi, value.v - ((ev.clientY - startY) / value.height) * (value.hi - value.lo)))
        setKey(target, t + moved, v, 'Change point')
      }
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const dragBar = (e: RPointerEvent, l: Layer, part: 'start' | 'end' | 'move') => {
    e.stopPropagation()
    select(l.id)
    if (l.locked) { toast(`${l.name} is locked. Click its lock to move it.`); return }
    const startX = e.clientX
    const s0 = l.start ?? 0, e0 = l.end ?? tl.duration
    const move = (ev: PointerEvent) => {
      const d = (ev.clientX - startX) / pps
      if (part === 'start') setLayerTime(l.id, Math.min(e0 - 0.1, snapT(Math.max(0, s0 + d))), e0)
      else if (part === 'end') setLayerTime(l.id, s0, Math.max(s0 + 0.1, snapT(e0 + d)))
      else {
        const ns = snapT(Math.max(0, s0 + d))
        setLayerTime(l.id, ns, ns + (e0 - s0))
      }
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const dragCue = (e: RPointerEvent, c: Cue) => {
    e.stopPropagation()
    setSelCue(c.id)
    setSelKeys([])
    setSelOut(null)
    const startX = e.clientX
    const move = (ev: PointerEvent) => {
      const t = snapT(Math.max(0, c.t + (ev.clientX - startX) / pps))
      if (Math.abs(t - c.t) > 1e-6) updateCue(c.id, { t }, 'Move cue')
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const dragDivider = (e: RPointerEvent) => {
    e.preventDefault()
    const x0 = e.clientX, w0 = leftW
    const move = (ev: PointerEvent) => setLeftW(Math.max(220, Math.min(720, w0 + ev.clientX - x0)))
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
      try { localStorage.setItem('rico.tl.left', String(leftW)) } catch { /* not remembered */ }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  useEffect(() => {
    // Keep the playhead in view while playing.
    const el = body.current
    if (!el || !play.playing) return
    const x = play.time * pps
    const viewW = el.clientWidth - leftW
    if (x < el.scrollLeft || x > el.scrollLeft + viewW - 40) el.scrollLeft = Math.max(0, x - 60)
  }, [play.time, play.playing, pps, leftW])

  const tracksByOwner = new Map<string, Track[]>()
  for (const tr of tl.tracks) {
    const owner = splitTarget(tr.target)[0]
    if (!tracksByOwner.has(owner)) tracksByOwner.set(owner, [])
    tracksByOwner.get(owner)!.push(tr)
  }

  const { major, minor } = rulerStep(pps, tl.fps, units)
  const ticks: { t: number; big: boolean }[] = []
  for (let k = 0; k * minor <= tl.duration + 1e-6 && k < 20000; k++) {
    const t = k * minor
    ticks.push({ t, big: Math.abs(t / major - Math.round(t / major)) < 1e-6 })
  }

  const keyButtons = (target: string, keys: Key[], value?: { lo: number; hi: number; height: number }) => keys.map((k) => (
    <button
      key={k.t}
      className={`tl-key ease-${k.ease}${isSel(target, k.t) ? ' on' : ''}`}
      style={{ left: k.t * pps, ...(value ? { top: 4 + (1 - (k.v - value.lo) / (value.hi - value.lo || 1)) * (value.height - 8) - 6 } : {}) }}
      title={`${formatTime(k.t, tl.fps)}  ${k.v.toFixed(3)}  ${EASE_LABEL[k.ease]}. F9 easy ease, Ctrl+Alt+H hold. Double-click to change, Delete removes, Shift-click picks more.`}
      data-target={target} data-t={k.t}
      onPointerDown={(e) => { if (e.button === 2) return; dragKey(e, target, k.t, value ? { ...value, v: k.v } : undefined) }}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); if (!isSel(target, k.t)) setSelKeys([{ target, t: k.t }]); setKeyMenu({ x: e.clientX, y: e.clientY, target, t: k.t }) }}
      onDoubleClick={(e) => { e.stopPropagation(); if (!isSel(target, k.t)) setSelKeys([{ target, t: k.t }]); window.setTimeout(() => (document.querySelector('.tl-kinsp .scrub-edit, .tl-kinsp .k-value') as HTMLElement | null)?.focus(), 30) }}
    />
  ))

  const curve = (keys: Key[], lo: number, hi: number, h: number) => {
    const pts: string[] = []
    const tr = { target: '', keys }
    for (let x = 0; x <= width; x += 6) {
      const v = valueAt(tr, x / pps) ?? lo
      pts.push(`${x},${h - 2 - ((v - lo) / (hi - lo || 1)) * (h - 4)}`)
    }
    return <svg className="tl-curve" width={width} height={h}><polyline points={pts.join(' ')} /></svg>
  }

  // in the graph, keys sit at their values: the range fits the keys
  const fitRange = (keys: Key[], lo: number, hi: number): [number, number] => {
    if (!keys.length) return [lo, hi]
    let a = Infinity, b = -Infinity
    for (const k of keys) { a = Math.min(a, k.v); b = Math.max(b, k.v) }
    const pad = Math.max((b - a) * 0.15, Math.abs(b) * 0.05, 1e-3)
    return [a - pad, b + pad]
  }
  const laneOf = (target: string, keys: Key[], lo: number, hi: number) => {
    const [a, b] = fitRange(keys, lo, hi)
    return <>{curve(keys, a, b, PH)}{keyButtons(target, keys, graph ? { lo: a, hi: b, height: PH } : undefined)}</>
  }

  // the setting's own units (pixels, %, degrees) for the key box
  const unitOf = (target: string): { show: (v: number) => number; back: (v: number) => number; suffix: string; step: number } => {
    const [owner, key] = splitTarget(target)
    const l = scene.layers.find((x) => x.id === owner)
    const d = l ? propGroups(scene, l).flatMap((g) => g.defs).find((x) => x.key === key) : undefined
    return { show: d?.unit ?? ((v) => v), back: d?.back ?? ((v) => v), suffix: d?.suffix ?? '', step: d?.step ?? 0.01 }
  }
  const keyAt = (target: string, t: number) => keysOf(tl, target).find((x) => Math.abs(x.t - t) < 1e-6)
  const easeSel = (e: Ease) => { for (const k of selKeys) setEase(k.target, k.t, e) }
  // dragging a box on empty lanes picks every key inside it
  const startMarquee = (e: RPointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.tl-key, .tl-bar, .tl-ruler, .tl-cue, button')) return
    const x0 = e.clientX, y0 = e.clientY
    const add = e.shiftKey || e.ctrlKey
    let box = { x0, y0, x1: x0, y1: y0 }
    const move = (ev: PointerEvent) => { box = { x0, y0, x1: ev.clientX, y1: ev.clientY }; setMarquee(box) }
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
      setMarquee(null)
      const [a, b] = [Math.min(box.x0, box.x1), Math.max(box.x0, box.x1)], [c, d] = [Math.min(box.y0, box.y1), Math.max(box.y0, box.y1)]
      if (b - a < 4 && d - c < 4) { if (!add) setSelKeys([]); return }
      const picked: SelKey[] = []
      document.querySelectorAll<HTMLElement>('.tl .tl-key[data-target]').forEach((el) => {
        const r = el.getBoundingClientRect()
        if (r.right >= a && r.left <= b && r.bottom >= c && r.top <= d) picked.push({ target: el.dataset.target!, t: Number(el.dataset.t) })
      })
      setSelKeys(add ? [...selKeys, ...picked] : picked)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const trackRow = (tr: Track) => {
    const { name } = labelFor(scene, tr.target)
    const [lo, hi] = rangeOf(scene, tr.target)
    return {
      left: (
        <div className="tl-name track" key={`n-${tr.target}`} style={{ height: PH }}>
          <span title={tr.target}>{name}</span>
          <button className="icon-btn small" title="Stop animating this setting" onClick={() => removeTrack(tr.target)}>×</button>
        </div>
      ),
      lane: (
        <div className="tl-lane track" key={`l-${tr.target}`} style={{ height: PH }}>
          {laneOf(tr.target, tr.keys, lo, hi)}
        </div>
      ),
    }
  }

  const rows: { left: React.ReactNode; lane: React.ReactNode }[] = []
  const ordered = [...scene.layers].reverse().filter((l) => !(hideShy && l.shy))
  ordered.forEach((l) => {
    const s0 = l.start ?? 0, e0 = l.end ?? tl.duration
    const timed = l.start !== undefined
    const index = scene.layers.length - scene.layers.indexOf(l)
    const open = Boolean(reveal[l.id])
    const own = tracksByOwner.get(l.id) ?? []
    tracksByOwner.delete(l.id)
    rows.push({
      left: (
        <LayerRow key={`n-${l.id}`} l={l} index={index} selected={selected === l.id} mode={mode} open={open}
          onTwirl={() => setReveal((r) => { const n = { ...r }; if (n[l.id]) delete n[l.id]; else n[l.id] = { mode: 'all' }; return n })}
          renaming={renaming === l.id} onRenamed={() => setRenaming(null)} dragOk={Boolean(dragLayer && dragLayer !== l.id)} onDragLayer={setDragLayer} />
      ),
      lane: (
        <div className="tl-lane layer" key={`l-${l.id}`}>
          <div className={`tl-bar${timed ? '' : ' always'}${selected === l.id ? ' on' : ''}${l.locked ? ' locked' : ''}`}
            style={{ left: s0 * pps, width: Math.max(4, (e0 - s0) * pps), borderColor: LABEL_COLORS[l.label ?? 0], background: `${LABEL_COLORS[l.label ?? 0]}33` }}
            onPointerDown={(e) => dragBar(e, l, 'move')}
            onDoubleClick={() => { select(l.id); if (l.type === 'precomp' && l.values.comp) openComp(String(l.values.comp)); else openLayerSettings('layer') }}
            title={`${timed ? `${formatTime(s0, tl.fps)} to ${formatTime(e0, tl.fps)}` : 'Shows the whole time'}. Double-click for its settings (Ctrl+Shift+K). Drag edges to trim, [ and ] move it to the playhead, Ctrl+Shift+D splits.`}>
            <i className="tl-handle start" onPointerDown={(e) => dragBar(e, l, 'start')} />
            <span>{l.name}</span>
            <i className="tl-handle end" onPointerDown={(e) => dragBar(e, l, 'end')} />
          </div>
          {!open && own.flatMap((tr) => tr.keys.map((k) => <i key={`${tr.target}${k.t}`} className="tl-summary" style={{ left: k.t * pps }} />))}
        </div>
      ),
    })
    if (open) {
      const all = reveal[l.id]?.mode === 'all'
      for (const g of shownDefs(l)) {
        const gk = `${l.id}/${g.name}`
        const gOpen = openGroups[gk] ?? !all
        const gKeys = gOpen ? [] : g.defs.flatMap((d) => (trackFor(scene, `${l.id}.${d.key}`)?.keys ?? []).map((k) => k.t))
        rows.push({
          left: (
            <div className="tl-name group sub" key={`g-${l.id}-${g.name}`} style={{ height: GROUP_H }} onClick={() => setOpenGroups((o) => ({ ...o, [gk]: !gOpen }))}>
              <button className={`twirl${gOpen ? ' open' : ''}`} title={gOpen ? 'Fold' : 'Show the settings'} onClick={(e) => { e.stopPropagation(); setOpenGroups((o) => ({ ...o, [gk]: !gOpen })) }}><Icon name="twirl" /></button>
              <span>{g.name}</span>
            </div>
          ),
          lane: <div className="tl-lane group sub" key={`gl-${l.id}-${g.name}`} style={{ height: GROUP_H }}>{[...new Set(gKeys)].map((t) => <i key={t} className="tl-summary" style={{ left: t * pps }} />)}</div>,
        })
        if (!gOpen) continue
        for (const d of g.defs) {
          const target = `${l.id}.${d.key}`
          const tr = trackFor(scene, target)
          rows.push({
            left: <div className="tl-prop" key={`p-${target}`} style={{ height: PH }}><PropRow owner={l.id} layer={l} def={d} binding={d.key === 'opacity' ? l.bindings.opacity : l.bindings[d.key]} compact /></div>,
            lane: (
              <div className="tl-lane track" key={`pl-${target}`} style={{ height: PH }}>
                {tr && laneOf(target, tr.keys, ...rangeOf(scene, target))}
              </div>
            ),
          })
        }
      }
    }
  })
  const masterTracks = tracksByOwner.get('master') ?? []
  tracksByOwner.delete('master')
  if (masterTracks.length) {
    rows.push({ left: <div className="tl-name group" key="n-master"><span>Finish</span></div>, lane: <div className="tl-lane group" key="l-master" /> })
    for (const tr of masterTracks) rows.push(trackRow(tr))
  }
  const threeTracks = [...tracksByOwner.entries()].filter(([owner]) => owner.startsWith('3d:'))
  if (threeTracks.length) {
    rows.push({ left: <div className="tl-name group" key="n-3d"><span>3D</span></div>, lane: <div className="tl-lane group" key="l-3d" /> })
    for (const [, list] of threeTracks) for (const tr of list) rows.push(trackRow(tr))
  }
  const outs = tl.outTracks ?? []
  const sendStart = rows.length
  if (outs.length) {
    rows.push({
      left: (
        <div className="tl-name group sec-sends" key="n-out" onClick={() => setShow({ sends: !show.sends })} title="Sends play all the time, following their curve. Click to fold.">
          <span className={`twirl-mini${show.sends ? ' open' : ''}`}>{'\u25B8'}</span>
          <span>Sends: continuous values out (OSC, MIDI, DMX, signals)</span><span className="dim">{outs.length}</span>
        </div>
      ),
      lane: <div className="tl-lane group sec-sends" key="l-out" />,
    })
    if (show.sends) for (const o of outs) {
      const target = `out:${o.id}`
      const H = 40
      rows.push({
        left: (
          <div className={`tl-name out${selOut === o.id ? ' on' : ''}${o.muted ? ' hidden' : ''}`} key={`n-${o.id}`} onClick={() => { setSelOut(o.id); setSelCue(null) }}>
            <span className={`tl-kind k-${o.kind}`}>{OUT_LABEL[o.kind]}</span>
            <span className="tl-lname" title={o.kind === 'osc' ? `${o.host}:${o.port} ${o.address}` : o.name}>{o.kind === 'osc' ? o.address : o.kind === 'midi-cc' ? `ch ${o.channel} CC ${o.number}` : o.kind === 'dmx' ? `ch ${o.channel}` : o.name}</span>
            <button className="icon-btn small" title="Add a point here, at the playhead" onClick={(e) => { e.stopPropagation(); setKey(target, play.time, valueAt({ target, keys: o.keys }, play.time) ?? 0.5, 'Add point') }}>◇</button>
            <button className={`tl-tog${o.muted ? '' : ' on'}`} title={o.muted ? 'Unmute' : 'Mute'} onClick={(e) => { e.stopPropagation(); updateOutTrack(o.id, { muted: !o.muted }, o.muted ? 'Unmute' : 'Mute') }}>{o.muted ? 'M' : '♪'}</button>
            <button className="icon-btn small danger" title="Delete this track" onClick={(e) => { e.stopPropagation(); removeOutTrack(o.id); if (selOut === o.id) setSelOut(null) }}>×</button>
          </div>
        ),
        lane: (
          <div className={`tl-lane out${selOut === o.id ? ' on' : ''}`} key={`l-${o.id}`} style={{ height: H }}
            onDoubleClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              const v = Math.max(0, Math.min(1, 1 - (e.clientY - r.top - 4) / (H - 8)))
              setKey(target, snapT(timeAt(e.clientX)), v, 'Add point')
              setSelOut(o.id)
            }}>
            {curve(o.keys, 0, 1, H)}
            {keyButtons(target, o.keys, { lo: 0, hi: 1, height: H })}
          </div>
        ),
      })
    }
  }

  const cues = tl.cues ?? []
  // The 3D timeline: every 3D object with the settings you can animate,
  // a stopwatch on each, keys on the same time line as Motion.
  const rows3d: { left: React.ReactNode; lane: React.ReactNode }[] = []
  if (only3d) {
    const w3 = getWorld()
    for (const o of w3.objects) {
      const id3 = `3d:${o.id}`
      const open3 = Boolean(reveal[id3])
      const toggle3 = () => { const next = { ...reveal }; if (next[id3]) delete next[id3]; else next[id3] = { mode: 'all' }; setReveal(next) }
      const objKeys = open3 ? [] : tl.tracks.filter((tr) => tr.target.startsWith(`${id3}.`)).flatMap((tr) => tr.keys.map((k) => k.t))
      rows3d.push({
        left: <div className="tl-name group" key={`n-${id3}`} onClick={toggle3}><button className={`twirl${open3 ? ' open' : ''}`} title={open3 ? 'Fold' : 'Show what you can animate'} onClick={(e) => { e.stopPropagation(); toggle3() }}><Icon name="twirl" /></button><span>{o.name}</span></div>,
        lane: <div className="tl-lane group" key={`l-${id3}`}>{[...new Set(objKeys)].map((t) => <i key={t} className="tl-summary" style={{ left: t * pps }} />)}</div>,
      })
      if (!open3) continue
      // everything with a number: the object, each deformer, morph, physics, liquid, fog, look layers.
      // Each group folds; a folded group shows its keys as dots.
      const list3 = animatables(o, w3)
      const groupsOf = [...new Set(list3.map((x) => x.group))]
      for (const gname of groupsOf) {
        const gk = `${id3}/${gname}`
        const gOpen = openGroups[gk] ?? gname === 'Object'
        const items = list3.filter((x) => x.group === gname)
        const gKeys = gOpen ? [] : items.flatMap((an) => (tl.tracks.find((x) => x.target === `${id3}.${an.key}`)?.keys ?? []).map((k) => k.t))
        rows3d.push({
          left: (
            <div className="tl-name group sub" key={`g-${id3}-${gname}`} style={{ height: GROUP_H }} onClick={() => setOpenGroups((g) => ({ ...g, [gk]: !gOpen }))}>
              <button className={`twirl${gOpen ? ' open' : ''}`} onClick={(e) => { e.stopPropagation(); setOpenGroups((g) => ({ ...g, [gk]: !gOpen })) }}><Icon name="twirl" /></button>
              <span>{gname === 'Object' ? 'Transform' : gname}</span>
            </div>
          ),
          lane: <div className="tl-lane group sub" key={`gl-${id3}-${gname}`} style={{ height: GROUP_H }}>{[...new Set(gKeys)].map((t) => <i key={t} className="tl-summary" style={{ left: t * pps }} />)}</div>,
        })
        if (!gOpen) continue
        for (const an of items) {
        const target = `${id3}.${an.key}`
        const tr = tl.tracks.find((x) => x.target === target)
        rows3d.push({
          left: <div className="tl-prop" key={`n-${target}`} style={{ height: PH }}><KeyRow3d o={o} an={an} compact /></div>,
          lane: <div className="tl-lane track" key={`l-${target}`} style={{ height: PH }}>{tr && laneOf(target, tr.keys, an.min, an.max)}</div>,
        })
        }
      }
    }
  }
  const shownRows = only3d ? rows3d : [...(show.layers ? rows.slice(0, sendStart) : []), ...rows.slice(sendStart)]
  const editOut = outs.find((o) => o.id === selOut)
  const editCue = cues.find((c) => c.id === selCue)
  const shyCount = scene.layers.filter((l) => l.shy).length

  return (
    <div
      className={`tl${dropping ? ' dropping' : ''}${only3d ? ' tl-3d' : ''}`}
      tabIndex={0}
      data-keyscope="create"
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDropping(true) } }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        setDropping(false)
        const f = e.dataTransfer.files?.[0]
        if (f) { e.preventDefault(); importMedia(f, play.time) }
      }}
    >
      {path.length > 0 && !only3d && (
        <div className="tl-crumbs" role="navigation" aria-label="Compositions">
          <button className="tl-crumb" onClick={() => closeComp(0)}>{listComps()[0]?.name ?? 'Main'}</button>
          {path.map((p, i) => <span key={p.id} className="tl-crumb-sep">›<button className={`tl-crumb${i === path.length - 1 ? ' on' : ''}`} onClick={() => closeComp(i + 1)}>{p.name}</button></span>)}
          <span className="grow" />
          <button className="btn small quiet" onClick={() => closeComp()}>Back</button>
        </div>
      )}
      <div className="tl-bar-top">
        <div className="tl-transport">
          <button className="icon-btn" title="To the start (Home)" onClick={() => seek(wa)}>⏮</button>
          <button className="icon-btn" title="One frame back (Page Up)" onClick={() => stepFrames(-1)}>‹</button>
          <button className={`tl-play${play.playing ? ' on' : ''}`} title="Play or pause (Space)" onClick={playPause}>{play.playing ? '❚❚' : '▶'}</button>
          <button className="icon-btn" title="One frame forward (Page Down)" onClick={() => stepFrames(1)}>›</button>
          <button className="icon-btn" title="Stop and go back to live" onClick={stop}>■</button>
          <button className={`tl-rec${play.armed ? ' on' : ''}`} title="Record: while playing, moving a setting writes keys" onClick={() => arm(!play.armed)}>● Rec</button>
        </div>
        <button className="tl-time" title="Click: timecode, frames or seconds" onClick={() => setUnits(units === 'tc' ? 'frames' : units === 'frames' ? 'sec' : 'tc')}>{formatUnits(play.time, tl.fps, units)}</button>
        <span className={`tl-mode${play.time > 0 || play.playing ? ' timeline' : ''}`}>{play.time > 0 || play.playing ? 'Timeline' : 'Live'}</span>
        {!only3d && <AddLayerMenu />}
        {!only3d && <AddTrackMenu at={play.time} onAdded={(t) => { if (t.startsWith('out:')) setSelOut(t.slice(4)) }} />}
        {only3d && <Hint label="3D keys" docs="WORKSPACES.md#3d-timeline-and-motion" text="3D keys, on the same time line as Motion. Open an object and click a stopwatch. A folded object or group shows its keys as dots." />}
        {!only3d && <button className="btn small quiet" title="A cue sends OSC, plays a note or runs a command when the playhead passes it (* on the number pad)" onClick={() => { setSelCue(addCue(play.time)); setSelOut(null) }}>+ Cue</button>}
        {!only3d && <span className="tl-show" role="group" aria-label="Show on the timeline">
          <button className={`sec-btn layers${show.layers ? ' on' : ''}`} title="Layers and their keyframes" onClick={() => setShow({ layers: !show.layers })}>Layers</button>
          <button className={`sec-btn sends${show.sends ? ' on' : ''}`} title="Sends: curves that send OSC, MIDI, DMX or signals the whole time" onClick={() => setShow({ sends: !show.sends })}>Sends</button>
          <button className={`sec-btn cues${show.cues ? ' on' : ''}`} title="Cues: events that fire once at a moment" onClick={() => setShow({ cues: !show.cues })}>Cues</button>
        </span>}
        <span className="grow" />
        <span className="tl-work-btns" title="Work area: play and loop only this part. B sets the start, N the end.">
          <button className="btn small quiet" onClick={() => setWorkArea(Math.min(play.time, wb - 0.05), tl.outPoint)}>[ B</button>
          <button className="btn small quiet" onClick={() => setWorkArea(tl.inPoint, Math.max(play.time, wa + 0.05))}>N ]</button>
          {hasWork && <button className="icon-btn small" title="Clear the work area" onClick={() => setWorkArea(undefined, undefined)}>×</button>}
        </span>
        <button className="icon-btn tl-cog" title={`Comp settings: ${scene.width} x ${scene.height}, ${tl.duration} s, ${tl.fps} fps (Ctrl+K)`} aria-label="Comp settings" onClick={() => openLayerSettings('scene')}><Icon name="settings" /></button>
        <button className={`btn small ${graph ? 'primary' : 'quiet'}`} title="Graph: taller rows with the keys at their values. Drag a key up or down to change it (Shift+F3)" onClick={() => setGraph(!graph)}>Graph</button>
        <button className="btn small primary" title="Render video (Ctrl+M)" onClick={() => setRendering(true)}>Render</button>
      </div>
      {selKeys.length > 0 && (() => {
        const first = selKeys[0]
        const k = keyAt(first.target, first.t)
        if (!k) return null
        const { group, name } = labelFor(scene, first.target)
        const u = unitOf(first.target)
        return (
          <div className="tl-kinsp" role="group" aria-label="Keyframe">
            <b>{selKeys.length === 1 ? `${group}: ${name}` : `${selKeys.length} keys`}</b>
            {selKeys.length === 1 && <>
              <label className="mini" title="When, in frames">Time <Scrub value={Math.round(k.t * tl.fps)} step={1} digits={0} min={0} max={Math.round(tl.duration * tl.fps)} suffix=" f" onChange={(f) => {
                const nt = Math.max(0, Math.min(tl.duration, Math.round(f) / tl.fps))
                if (Math.abs(nt - k.t) < 1e-6) return
                moveKeys([first], nt - k.t, `kinsp.${first.target}`)
                setSelKeys([{ target: first.target, t: nt }])
              }} /></label>
              <span className="dim small">{formatTime(k.t, tl.fps)}</span>
              <label className="mini" title="The value at this key">Value <Scrub value={u.show(k.v)} step={u.step} digits={3} suffix={u.suffix} onChange={(x) => setKey(first.target, k.t, u.back(x), 'Change key')} /></label>
            </>}
            <label className="mini">Ease
              <select className="select mini" value={k.ease} onChange={(e) => easeSel(e.target.value as Ease)}>
                {(['smooth', 'linear', 'in', 'out', 'hold'] as Ease[]).map((x) => <option key={x} value={x}>{EASE_LABEL[x]}</option>)}
              </select>
            </label>
            {selKeys.length > 1 && <label className="mini" title="Moves every picked key by this many frames">Move <Scrub value={0} step={1} digits={0} suffix=" f" onChange={(f) => { const d = Math.round(f) / tl.fps; if (d && selKeys.every((x) => x.t + d >= 0)) { moveKeys(selKeys, d, 'kinsp.many'); setSelKeys(selKeys.map((x) => ({ ...x, t: x.t + d }))) } }} /></label>}
            <span className="grow" />
            <button className="btn small quiet" onClick={() => seek(k.t)}>Go to it</button>
            <button className="btn small quiet danger" onClick={() => { removeKeys(selKeys); setSelKeys([]) }}>Delete</button>
            <button className="icon-btn small" title="Done" onClick={() => setSelKeys([])}>×</button>
          </div>
        )
      })()}
      {keyMenu && (
        <div className="tl-kmenu-back" onPointerDown={() => setKeyMenu(null)} onContextMenu={(e) => { e.preventDefault(); setKeyMenu(null) }}>
          <div className="menu-list pop-menu tl-kmenu" style={{ left: keyMenu.x, top: keyMenu.y }} onPointerDown={(e) => e.stopPropagation()} role="menu">
            {([['smooth', 'Easy ease (F9)'], ['out', 'Easy ease in: slow end'], ['in', 'Easy ease out: slow start'], ['linear', 'Straight'], ['hold', 'Hold: jump to the next']] as [Ease, string][]).map(([e, l]) => (
              <button key={e} role="menuitem" onClick={() => { easeSel(e); setKeyMenu(null) }}><span>{l}</span></button>
            ))}
            <button role="menuitem" onClick={() => { setKeyMenu(null); window.setTimeout(() => (document.querySelector('.tl-kinsp input, .tl-kinsp .scrub') as HTMLElement | null)?.focus(), 30) }}><span>Edit value...</span></button>
            <button role="menuitem" onClick={() => { timelineAction('copy'); setKeyMenu(null) }}><span>Copy</span><kbd>Ctrl+C</kbd></button>
            <button role="menuitem" onClick={() => { removeKeys(selKeys); setSelKeys([]); setKeyMenu(null) }}><span>Delete</span><kbd>Del</kbd></button>
          </div>
        </div>
      )}
      {marquee && <div className="tl-marquee" style={{ left: Math.min(marquee.x0, marquee.x1), top: Math.min(marquee.y0, marquee.y1), width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0) }} />}
      {editOut && <OutTrackEditor o={editOut} onClose={() => setSelOut(null)} />}
      {editCue && <CueEditor c={editCue} onClose={() => setSelCue(null)} />}
      <div className="tl-body" ref={body} style={{ gridTemplateColumns: `${leftW}px minmax(0, 1fr)` }} onScroll={(e) => setScrollX((e.target as HTMLElement).scrollLeft)}>
        <div className="tl-left">
          <div className="tl-name head ae-head">
            <span className="ae-av"><Icon name="eye" title="Video" /><Icon name="solo" title="Solo" /><Icon name="lock" title="Lock" /></span>
            <span className="ae-num">#</span>
            <span className="tl-lname">Layer name</span>
            <button className={`sw-btn${hideShy ? ' on' : ''}`} title={`Hide shy layers${shyCount ? ` (${shyCount})` : ''}`} onClick={() => setHideShy(!hideShy)}><Icon name="shy" /></button>
            <button className="btn small quiet ae-modes" title="Switches or modes (F4)" onClick={() => setMode(mode === 'switches' ? 'modes' : 'switches')}>{mode === 'switches' ? 'Switches' : 'Modes'}</button>
            <i className="tl-divider" onPointerDown={dragDivider} title="Drag to resize" />
          </div>
          {show.cues && !only3d && <div className="tl-name cues-head" title="Cues fire once when the playhead passes them. Double-click the lane to add one."><span className="sec-dot cue" />Cues: one-shot events<span className="dim">{cues.length}</span></div>}
          {!show.layers && !only3d && <div className="tl-name group sec-layers" onClick={() => setShow({ layers: true })}><span className="twirl-mini">{'\u25B8'}</span><span>Layers hidden ({scene.layers.length}), click to show</span></div>}
          {shownRows.map((r) => r.left)}
          {rows.length === 0 && <p className="dim small" style={{ padding: 10 }}>No layers yet. Use + Layer, or Ctrl+Y for a solid.</p>}
        </div>
        <div className="tl-lanes" ref={lanes} onPointerDown={startMarquee}>
          <div className="tl-inner" style={{ width: width + 40 }}>
            <div className="tl-ruler" onPointerDown={onRulerDown} onPointerMove={onRulerMove} onPointerUp={onRulerUp}>
              {hasWork && <div className="tl-work" style={{ left: wa * pps, width: (wb - wa) * pps }} />}
              {ticks.map(({ t, big }) => <span key={t} className={big ? 'big' : 'small'} style={{ left: t * pps }}>{big ? rulerLabel(t, tl.fps, units, major) : ''}</span>)}
              {snap && Array.from({ length: Math.floor(tl.duration / (60 / tl.bpm)) + 1 }, (_, i) => <i key={i} className="beat" style={{ left: i * (60 / tl.bpm) * pps }} />)}
            </div>
            {show.cues && !only3d && <div className="tl-lane cues" onDoubleClick={(e) => { setSelCue(addCue(snapT(timeAt(e.clientX)))); setSelOut(null) }}>
              {cues.map((c) => (
                <button key={c.id} className={`tl-cue${selCue === c.id ? ' on' : ''}`} style={{ left: c.t * pps }} title={`${c.name}: ${CUE_LABEL[c.kind]}`}
                  onPointerDown={(e) => dragCue(e, c)} onDoubleClick={(e) => e.stopPropagation()}>
                  <span>{c.name}</span>
                </button>
              ))}
            </div>}
            {!show.layers && !only3d && <div className="tl-lane group sec-layers" />}
            {shownRows.map((r) => r.lane)}
            {!show.cues && cues.map((c) => <i key={c.id} className="tl-cue-tick" style={{ left: c.t * pps }} title={c.name} />)}
            {hasWork && <><div className="tl-shade" style={{ left: 0, width: wa * pps }} /><div className="tl-shade" style={{ left: wb * pps, width: Math.max(0, width - wb * pps) }} /></>}
            <div className="tl-end" style={{ left: width }} />
            <div className="tl-playhead" style={{ left: play.time * pps }} onPointerDown={dragPlayhead} title="Drag to move in time"><i className="tl-cti" /></div>
          </div>
        </div>
      </div>
      <div className="tl-foot">
        <button className="btn small quiet ae-modes" title="Switches or modes (F4)" onClick={() => setMode(mode === 'switches' ? 'modes' : 'switches')}>Toggle {mode === 'switches' ? 'modes' : 'switches'}</button>
        {tl.tracks.length === 0 && outs.length === 0
          ? <Hint label="How to animate" docs="WORKSPACES.md#motion-keys" text="Twirl a layer open and click a stopwatch to animate. P, S, R, T, A show one property, U shows what is animated. Ctrl+Y solid, Ctrl+D duplicate, Ctrl+Shift+D split, [ and ] move to the playhead. Alt+wheel zooms. Click the time to see frames or seconds." />
          : <span className="grow" />}
        <div className="tl-nav" title="The part of the comp you see. Drag to move along, drag its ends to zoom."
          onPointerDown={(e) => {
            const bar = e.currentTarget.getBoundingClientRect()
            const total = tl.duration
            const vis = Math.min(total, viewW / pps)
            const t0 = scrollX / pps
            const at = ((e.clientX - bar.left) / bar.width) * total
            const edge = (e.target as HTMLElement).dataset.edge
            const startX = e.clientX
            // a click outside the window jumps there
            if (!edge && (at < t0 || at > t0 + vis) && body.current) body.current.scrollLeft = Math.max(0, (at - vis / 2) * pps)
            const s0 = body.current?.scrollLeft ?? 0
            const move = (ev: PointerEvent) => {
              const dt = ((ev.clientX - startX) / bar.width) * total
              if (edge) {
                const nv = Math.max(1 / tl.fps * 4, edge === 'r' ? vis + dt : vis - dt)
                const z = total / nv
                setZoom(z, edge === 'r' ? t0 : t0 + vis)
              } else if (body.current) body.current.scrollLeft = Math.max(0, s0 + dt * pps)
            }
            const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
            window.addEventListener('pointermove', move)
            window.addEventListener('pointerup', up)
          }}>
          <i className="tl-nav-win" style={{ left: `${Math.min(100, (scrollX / pps / tl.duration) * 100)}%`, width: `${Math.min(100, (viewW / pps / tl.duration) * 100)}%` }}>
            <b data-edge="l" /><b data-edge="r" />
          </i>
          <i className="tl-nav-ph" style={{ left: `${(play.time / tl.duration) * 100}%` }} />
        </div>
        <button className="icon-btn small" title="Zoom out (-)" onClick={() => setZoom(zoom / 1.4)}>-</button>
        <input className="range tl-zoom" type="range" min={0} max={1000} value={Math.round((Math.log(Math.min(zoom, maxZoom)) / Math.log(maxZoom || 2)) * 1000) || 0} aria-label="Zoom" title="Zoom: all the way left shows the whole comp, right goes down to frames (= and -, ; fits, Alt+wheel)" onChange={(e) => setZoom(Math.exp((Number(e.target.value) / 1000) * Math.log(maxZoom || 2)))} />
        <button className="icon-btn small" title="Zoom in (=)" onClick={() => setZoom(zoom * 1.4)}>+</button>
      </div>
      {rendering && <RenderDialog onClose={() => setRendering(false)} />}
    </div>
  )
}
