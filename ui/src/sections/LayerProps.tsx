import { useState } from 'react'
import CurveEditor from '../components/CurveEditor'
import Icon from '../components/Icon'
import RIcon from '../components/RIcons'
import Scrub from '../components/Scrub'
import { toast } from '../components/Toasts'
import { EFFECT_GROUPS, EFFECT_TYPES, effectType } from '../create/effects'
import { BLEND_MODES, MASTER_PARAMS, NULL_TYPES, layerType, type ParamDef } from '../create/layers'
import { cubeText, matchLut, parseCube, putLut, removeLut, useLuts } from '../create/luts'
import {
  addEffect, addMask, baseValue, changeEffects, changeMasks, newMask, setBinding, toggleMaskPathKey, clearMaskPathKeys, setProp, updateLayer,
} from '../create/ops'
import { LABEL_COLORS, MASK_MODES, MATTES, type Binding, type Effect, type Layer, type Mask, type Scene } from '../create/scene'
import { changeScene, getRenderer, useCreate } from '../create/store'
import { getPlay, removeTrack, seek, setKey, trackFor, usePlay, valueAt } from '../create/timeline'
import { downloadBlob, pickFile } from '../shell/ui'
import { LinkEditor, ParamControl } from './Create'
import { KeyNav } from './KeyControls'

// Layer properties: a stopwatch to animate, a
// value you drag (or click to type), and a link to follow a signal. Used by
// the Inspector and by the timeline when you twirl a layer open.

// one property row

export interface PropDef {
  key: string                  // the setting key on the layer (see ops.ts)
  label: string
  unit?: (v: number) => number // stored value -> shown value
  back?: (v: number) => number // shown value -> stored value
  suffix?: string
  step?: number
  digits?: number
  min?: number
  max?: number
}

function Stopwatch({ target, value }: { target: string; value: number }) {
  const scene = useCreate((s) => s.scene)
  const animated = Boolean(trackFor(scene, target))
  return (
    <button
      className={`sw${animated ? ' on' : ''}`}
      title={animated ? 'Stop animating (removes all its keys)' : 'Animate: add a key at the playhead (Alt+Shift with P, S, R, T, A)'}
      onClick={() => (animated ? removeTrack(target) : setKey(target, getPlay().time, value))}
    ><Icon name="stopwatch" /></button>
  )
}

export function PropRow({ owner, def, layer, binding, compact }: { owner: string; def: PropDef; layer?: Layer; binding?: Binding; compact?: boolean }) {
  const scene = useCreate((s) => s.scene)
  const play = usePlay()
  const [linking, setLinking] = useState(false)
  const target = `${owner}.${def.key}`
  const track = trackFor(scene, target)
  const base = layer ? baseValue(layer, def.key) : Number(scene.master.values[def.key] ?? 0)
  const v = track ? valueAt(track, play.time) ?? base : base
  const shown = def.unit ? def.unit(v) : v
  const set = (x: number) => setProp(owner, def.key, def.back ? def.back(x) : x, `Change ${def.label.toLowerCase()}`)
  const param: ParamDef = { key: def.key, label: def.label, kind: 'number', min: def.min, max: def.max, step: def.step, default: 0 }
  return (
    <div className={`prop${compact ? ' compact' : ''}${binding?.signal ? ' linked' : ''}`}>
      <Stopwatch target={target} value={v} />
      <span className="prop-label">{def.label}</span>
      {binding?.signal
        ? <button className="link-chip" onClick={() => setLinking(!linking)}>linked</button>
        : <Scrub value={shown} step={def.step ?? 1} digits={def.digits ?? 1} suffix={def.suffix} min={def.min} max={def.max} onChange={set} />}
      <KeyNav target={target} value={v} />
      <button className={`icon-btn small${binding?.signal ? ' on' : ''}`} title="Follow a signal (a knob, OSC, the audio)" onClick={() => setLinking(!linking)}><Icon name="link" /></button>
      {linking && (
        <div className="prop-link">
          <LinkEditor binding={binding} param={param} onChange={(b) => setBinding(owner, def.key, b)} onClose={() => setLinking(false)} />
        </div>
      )}
    </div>
  )
}

// property lists

export function transformDefs(scene: Scene): PropDef[] {
  const H = scene.height
  return [
    { key: 'tr_ax', label: 'Anchor X', unit: (v) => v * H, back: (v) => v / H, suffix: ' px' },
    { key: 'tr_ay', label: 'Anchor Y', unit: (v) => -v * H, back: (v) => -v / H, suffix: ' px' },
    { key: 'tr_px', label: 'Position X', unit: (v) => scene.width / 2 + v * H, back: (v) => (v - scene.width / 2) / H, suffix: ' px' },
    { key: 'tr_py', label: 'Position Y', unit: (v) => H / 2 - v * H, back: (v) => (H / 2 - v) / H, suffix: ' px' },
    { key: 'tr_sx', label: 'Scale X', unit: (v) => v * 100, back: (v) => v / 100, suffix: '%', step: 0.5 },
    { key: 'tr_sy', label: 'Scale Y', unit: (v) => v * 100, back: (v) => v / 100, suffix: '%', step: 0.5 },
    { key: 'tr_rot', label: 'Rotation', suffix: '°', step: 0.5 },
    { key: 'opacity', label: 'Opacity', unit: (v) => v * 100, back: (v) => v / 100, suffix: '%', step: 0.5, min: 0, max: 100 },
  ]
}

// AE's single-key reveals: P position, S scale, R rotation, T opacity, A anchor.
export const REVEAL: Record<string, string[]> = {
  p: ['tr_px', 'tr_py'], s: ['tr_sx', 'tr_sy'], r: ['tr_rot'], t: ['opacity'], a: ['tr_ax', 'tr_ay'],
}

const contentDefs = (l: Layer): PropDef[] => layerType(l.type).params.filter((p) => p.kind === 'number').map((p) => ({
  key: p.key, label: p.label, step: p.step && p.step >= 1 ? p.step : ((p.max ?? 1) - (p.min ?? 0)) / 200, digits: p.step && p.step >= 1 ? 0 : 3, min: p.min, max: p.max,
}))

const maskDefs = (s: Scene, i: number): PropDef[] => [
  { key: `m${i}_x`, label: 'Center X', unit: (v) => v * s.height, back: (v) => v / s.height, suffix: ' px' },
  { key: `m${i}_y`, label: 'Center Y', unit: (v) => -v * s.height, back: (v) => -v / s.height, suffix: ' px' },
  { key: `m${i}_w`, label: 'Width', unit: (v) => v * s.height, back: (v) => v / s.height, suffix: ' px', min: 0 },
  { key: `m${i}_h`, label: 'Height', unit: (v) => v * s.height, back: (v) => v / s.height, suffix: ' px', min: 0 },
  { key: `m${i}_feather`, label: 'Feather', unit: (v) => v * s.height, back: (v) => v / s.height, suffix: ' px', min: 0 },
  { key: `m${i}_expand`, label: 'Expansion', unit: (v) => v * s.height, back: (v) => v / s.height, suffix: ' px' },
  { key: `m${i}_opacity`, label: 'Mask opacity', unit: (v) => v * 100, back: (v) => v / 100, suffix: '%', min: 0, max: 100 },
]

const fxDefs = (e: Effect): PropDef[] => (effectType(e.type)?.params ?? []).filter((p) => p.kind === 'number').map((p) => ({
  key: `fx_${e.id}_${p.key}`, label: p.label, step: p.step && p.step >= 1 ? p.step : ((p.max ?? 1) - (p.min ?? 0)) / 200, digits: p.step && p.step >= 1 ? 0 : 3, min: p.min, max: p.max,
}))

// Everything a layer has, in groups, for the timeline's twirl-down.
export function propGroups(scene: Scene, l: Layer): { name: string; defs: PropDef[] }[] {
  const out: { name: string; defs: PropDef[] }[] = []
  if (!NULL_TYPES.has(l.type) || l.type === 'null') out.push({ name: 'Transform', defs: transformDefs(scene) })
  else out.push({ name: 'Transform', defs: transformDefs(scene).filter((d) => d.key === 'opacity') })
  const c = contentDefs(l)
  if (c.length) out.push({ name: 'Contents', defs: c })
  ;(l.masks ?? []).forEach((m, i) => out.push({ name: m.name, defs: maskDefs(scene, i) }))
  for (const e of l.effects ?? []) {
    const d = fxDefs(e)
    if (d.length) out.push({ name: effectType(e.type)?.name ?? 'Effect', defs: d })
  }
  return out
}

// effects

// Stills grabbed from the picture, to match a look against (like a still in a gallery).
const stills: { name: string; px: Uint8Array }[] = []

function LutControl({ owner, effect }: { owner: string; effect: Effect }) {
  const luts = useLuts()
  const [busy, setBusy] = useState(false)
  const value = String(effect.values.lut ?? '')
  const set = (id: string) => changeEffects(owner, 'Choose LUT', (list) => list.map((x) => (x.id === effect.id ? { ...x, values: { ...x.values, lut: id } } : x)))
  const capture = (then: (px: Uint8Array) => void) => {
    const r = getRenderer()
    if (!r) return toast('Motion is not running.')
    setBusy(true)
    r.requestCapture(owner, effect.id, (px) => { setBusy(false); then(px) })
  }
  const matchTo = (ref: Uint8Array | Uint8ClampedArray, name: string) => capture((px) => {
    const lut = matchLut(px, ref, `Match ${name}`)
    putLut(lut)
    set(lut.id)
    toast(`Made a LUT that matches ${name}. It is in the list now and saves with projects.`, true)
  })
  const fromPicture = () => pickFile('image/*', (f) => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      const w = 256, h = Math.max(1, Math.round((256 * img.naturalHeight) / Math.max(1, img.naturalWidth)))
      c.width = w; c.height = h
      const g = c.getContext('2d')!
      g.drawImage(img, 0, 0, w, h)
      matchTo(g.getImageData(0, 0, w, h).data, f.name.replace(/\.[^.]+$/, ''))
      URL.revokeObjectURL(img.src)
    }
    img.src = URL.createObjectURL(f)
  })
  const lut = luts.find((l) => l.id === value)
  return (
    <div className="lut-ctl">
      <label className="param">
        <span className="param-label">LUT</span>
        <select className="select" value={value} onChange={(e) => set(e.target.value)}>
          <option value="">None</option>
          {luts.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.size}³)</option>)}
        </select>
      </label>
      <div className="row wrap">
        <button className="btn small quiet" onClick={() => pickFile('.cube', (f) => f.text().then((t) => {
          try { const l = parseCube(t, f.name.replace(/\.cube$/i, '')); putLut(l); set(l.id); toast(`${l.name} loaded.`, true) } catch (e) { toast(`That .cube did not load: ${(e as Error).message}`) }
        }))}>Load .cube</button>
        <button className="btn small quiet" disabled={!lut} onClick={() => lut && downloadBlob(`${lut.name}.cube`, new Blob([cubeText(lut)], { type: 'text/plain' }))}>Save .cube</button>
        <button className="btn small quiet" disabled={!lut} onClick={() => lut && removeLut(lut.id)}>Remove</button>
      </div>
      <div className="lut-match">
        <b>Match a look</b>
        <span className="dim small">Makes a LUT that turns this picture into the colors of a reference.</span>
        <div className="row wrap">
          <button className="btn small" disabled={busy} onClick={fromPicture}>Match to a picture...</button>
          <button className="btn small quiet" disabled={busy} onClick={() => capture((px) => { stills.push({ name: `Still ${stills.length + 1}`, px }); toast(`Grabbed Still ${stills.length}. Change the scene, then match to it.`, true) })}>Grab still</button>
          {stills.length > 0 && (
            <select className="select" value="" onChange={(e) => { const s = stills[Number(e.target.value)]; if (s) matchTo(s.px, s.name) }}>
              <option value="">Match to a still...</option>
              {stills.map((s, i) => <option key={s.name} value={i}>{s.name}</option>)}
            </select>
          )}
        </div>
      </div>
    </div>
  )
}

// The clean plate is a picture of the empty scene. Everything that looks
// different from it stays visible; the rest becomes see-through.
function PlateControl({ owner, effect }: { owner: string; effect: Effect }) {
  const [, redraw] = useState(0)
  const r = getRenderer()
  const has = r?.hasPlate(owner, effect.id) ?? false
  return (
    <div className="plate-row">
      <span className={`ae-badge${has ? ' on' : ''}`}>{has ? 'plate ready' : 'no plate yet'}</span>
      <button className="btn small" title="Clear the scene (step out of frame), then press this" onClick={() => { r?.requestPlate(owner, effect.id); setTimeout(() => redraw((n) => n + 1), 200) }}>
        {has ? 'Capture again' : 'Capture clean plate'}
      </button>
      {has && <button className="btn small" onClick={() => { r?.clearPlate(owner, effect.id); redraw((n) => n + 1) }}>Clear</button>}
      <p className="hint">Step out of the picture, press capture, then come back. Works on live cameras and on video files. Keep the camera still and the light steady.</p>
    </div>
  )
}

function EffectCard({ owner, effect, index, count, layer }: { owner: string; effect: Effect; index: number; count: number; layer?: Layer }) {
  const [open, setOpen] = useState(true)
  const type = effectType(effect.type)
  if (!type) return null
  const change = (label: string, fn: (e: Effect) => Effect, key?: string) => changeEffects(owner, label, (list) => list.map((x) => (x.id === effect.id ? fn(x) : x)), key)
  const move = (d: number) => changeEffects(owner, 'Reorder effects', (list) => {
    const next = [...list]
    const [e] = next.splice(index, 1)
    next.splice(Math.max(0, Math.min(next.length, index + d)), 0, e)
    return next
  })
  return (
    <div className={`fx-card${effect.on ? '' : ' off'}`}>
      <div className="fx-head">
        <button className={`twirl${open ? ' open' : ''}`} onClick={() => setOpen(!open)} aria-label="Show settings"><Icon name="twirl" /></button>
        <button className={`fx-on${effect.on ? ' on' : ''}`} title={effect.on ? 'Turn off' : 'Turn on'} onClick={() => change(effect.on ? 'Effect off' : 'Effect on', (e) => ({ ...e, on: !e.on }))}>fx</button>
        <b title={type.about}>{type.name}</b>
        <span className="grow" />
        <button className="icon-btn small" disabled={index === 0} title="Earlier" onClick={() => move(-1)}><Icon name="up" /></button>
        <button className="icon-btn small" disabled={index === count - 1} title="Later" onClick={() => move(1)}><Icon name="down" /></button>
        <button className="icon-btn small danger" title="Remove" onClick={() => changeEffects(owner, `Remove ${type.name}`, (list) => list.filter((x) => x.id !== effect.id))}><Icon name="x" /></button>
      </div>
      {open && (
        <div className="fx-body">
          {type.aux === 'plate' && <PlateControl owner={owner} effect={effect} />}
          {type.params.map((p) => {
            if (p.kind === 'lut') return <LutControl key={p.key} owner={owner} effect={effect} />
            if (p.kind === 'curve') return <CurveEditor key={p.key} value={String(effect.values[p.key] ?? '')} onChange={(v) => change('Change curves', (e) => ({ ...e, values: { ...e.values, [p.key]: v } }), `${effect.id}.curve`)} />
            if (p.kind === 'number' && layer) {
              return <PropRow key={p.key} owner={owner} layer={layer} binding={layer.bindings[`fx_${effect.id}_${p.key}`] ?? effect.bindings?.[p.key]} def={fxDefs(effect).find((d) => d.key === `fx_${effect.id}_${p.key}`)!} />
            }
            return (
              <ParamControl key={p.key} param={p} value={effect.values[p.key] ?? p.default} binding={effect.bindings?.[p.key]}
                target={p.kind === 'number' ? `${owner}.fx_${effect.id}_${p.key}` : undefined}
                onValue={(v) => change(`Change ${p.label.toLowerCase()}`, (e) => ({ ...e, values: { ...e.values, [p.key]: v } }), `${effect.id}.${p.key}`)}
                onBinding={(b) => change(b ? 'Link' : 'Unlink', (e) => {
                  const next = { ...(e.bindings ?? {}) }
                  if (b) next[p.key] = b
                  else delete next[p.key]
                  return { ...e, bindings: next }
                })} />
            )
          })}
        </div>
      )}
    </div>
  )
}

export function EffectStack({ owner, effects, layer }: { owner: string; effects: Effect[]; layer?: Layer }) {
  return (
    <div className="fx-stack">
      {effects.map((e, i) => <EffectCard key={e.id} owner={owner} effect={e} index={i} count={effects.length} layer={layer} />)}
      <select className="select" value="" aria-label="Add an effect" onChange={(e) => e.target.value && addEffect(owner, e.target.value)}>
        <option value="">+ Add an effect...</option>
        {EFFECT_GROUPS.map((g) => (
          <optgroup key={g} label={g}>
            {EFFECT_TYPES.filter((t) => t.group === g).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </optgroup>
        ))}
      </select>
    </div>
  )
}

// masks

function MaskCard({ layer, mask, index }: { layer: Layer; mask: Mask; index: number }) {
  const scene = useCreate((s) => s.scene)
  const [open, setOpen] = useState(true)
  const change = (label: string, part: Partial<Mask>) => changeMasks(layer.id, label, (list) => list.map((m, i) => (i === index ? { ...m, ...part } : m)))
  return (
    <div className={`fx-card${mask.on === false ? ' off' : ''}`}>
      <div className="fx-head">
        <button className={`twirl${open ? ' open' : ''}`} onClick={() => setOpen(!open)} aria-label="Show settings"><Icon name="twirl" /></button>
        <button className={`fx-on${mask.on !== false ? ' on' : ''}`} title="On or off" onClick={() => change('Mask on/off', { on: mask.on === false })}><Icon name="mask" /></button>
        <input className="input mini-name" value={mask.name} onChange={(e) => change('Rename mask', { name: e.target.value })} />
        <select className="select mini" value={mask.mode} onChange={(e) => change('Mask mode', { mode: Number(e.target.value) })}>
          {MASK_MODES.map((m, i) => <option key={m} value={i}>{m}</option>)}
        </select>
        <label className="mini-check" title="Inverted"><input type="checkbox" checked={Boolean(mask.invert)} onChange={(e) => change('Invert mask', { invert: e.target.checked })} />Inv</label>
        <button className="icon-btn small danger" title="Delete mask" onClick={() => changeMasks(layer.id, 'Delete mask', (list) => list.filter((_, i) => i !== index))}><Icon name="x" /></button>
      </div>
      {open && (
        <div className="fx-body">
          <label className="param"><span className="param-label">Shape</span>
            <select className="select" value={mask.kind} onChange={(e) => change('Mask shape', { kind: e.target.value as Mask['kind'], points: e.target.value === 'path' ? mask.points ?? [[-0.3, -0.3], [0.3, -0.3], [0, 0.35]] : mask.points })}>
              <option value="rect">Rectangle</option><option value="ellipse">Ellipse</option><option value="path">Path (points)</option>
            </select></label>
          {mask.kind === 'path' && (
            <label className="param"><span className="param-label">Points (x,y in px from the middle)</span>
              <input className="input" value={(mask.points ?? []).map((p) => `${Math.round(p[0] * scene.height)},${Math.round(-p[1] * scene.height)}`).join('  ')}
                onChange={(e) => {
                  const pts = e.target.value.trim().split(/\s+/).map((s) => s.split(',').map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite)).map(([x, y]) => [x / scene.height, -y / scene.height] as [number, number])
                  if (pts.length >= 3 && pts.length <= 16) change('Mask points', { points: pts })
                }} />
              <span className="dim small">Or draw with the Pen tool (G) on the preview.</span>
            </label>
          )}
          {mask.kind === 'path' && <PathKeys layer={layer} mask={mask} index={index} />}
          {maskDefs(scene, index).filter((d) => mask.kind !== 'path' || !/_[wh]$/.test(d.key)).map((d) => <PropRow key={d.key} owner={layer.id} layer={layer} def={d} binding={layer.bindings[d.key]} />)}
        </div>
      )}
    </div>
  )
}

// Rotoscoping on video files: key the path shape over time like After
// Effects (the stopwatch next to "Mask Path"). Drag points on the preview at
// different times; the shape glides between keys.
function PathKeys({ layer, mask, index }: { layer: Layer; mask: Mask; index: number }) {
  const play = usePlay()
  const keys = mask.pathKeys ?? []
  const here = keys.some((k) => Math.abs(k.t - play.time) <= 1 / 120)
  const prev = [...keys].reverse().find((k) => k.t < play.time - 1 / 120)
  const next = keys.find((k) => k.t > play.time + 1 / 120)
  return (
    <div className="param path-keys">
      <span className="param-label">Mask path over time (rotoscoping)</span>
      <div className="row gap">
        <button className="icon-btn small" disabled={!prev} title="Previous key" onClick={() => prev && seek(prev.t)}>{'\u25C0'}</button>
        <button className={`key-btn${here ? ' here' : ''}${keys.length ? ' animated' : ''}`} title={keys.length ? (here ? 'Remove the key here' : 'Add a key here') : 'Start keying the shape (stopwatch)'}
          onClick={() => toggleMaskPathKey(layer.id, index)}>{'\u25C6'}</button>
        <button className="icon-btn small" disabled={!next} title="Next key" onClick={() => next && seek(next.t)}>{'\u25B6'}</button>
        <span className="dim small">{keys.length ? `${keys.length} key${keys.length > 1 ? 's' : ''}` : 'still shape'}</span>
        {keys.length > 0 && <button className="btn small" onClick={() => clearMaskPathKeys(layer.id, index)}>Stop keying</button>}
      </div>
      {keys.length > 0 && <span className="dim small">Move the playhead, drag points on the preview (Alt drags the whole shape). Each change makes a key.</span>}
    </div>
  )
}

// the inspector

// A group in Effect Controls: an icon, its name, and it opens and closes
// (it remembers how you left it).
const SEC_ICON: Record<string, string> = { Layer: 'layers', Transform: 'transform', Contents: 'contents', Masks: 'mask', Effects: 'fx', 'Grade and effects': 'fx', Look: 'texturing' }
function Section({ title, children, start = true, extra }: { title: string; children: React.ReactNode; start?: boolean; extra?: React.ReactNode }) {
  const base = title.replace(/ \(.*\)$/, '')
  const [open, setOpenRaw] = useState(() => { try { const v = localStorage.getItem(`rico.sec.${base}`); return v === null ? start : v === '1' } catch { return start } })
  const setOpen = (v: boolean) => { setOpenRaw(v); try { localStorage.setItem(`rico.sec.${base}`, v ? '1' : '0') } catch { /* not kept */ } }
  return (
    <section className={`insp-sec${open ? ' open' : ''}`}>
      <header>
        <button className={`twirl no-corner${open ? ' open' : ''}`} onClick={() => setOpen(!open)}><Icon name="twirl" /><RIcon name={SEC_ICON[base] ?? 'settings'} size={14} /> {title}</button>
        <span className="grow" />
        {extra}
      </header>
      {open && <div className="insp-body">{children}</div>}
    </section>
  )
}

const descendants = (layers: Layer[], id: string): Set<string> => {
  const out = new Set<string>([id])
  let grew = true
  while (grew) {
    grew = false
    for (const l of layers) if (l.parent && out.has(l.parent) && !out.has(l.id)) { out.add(l.id); grew = true }
  }
  return out
}

export function LayerInspector({ layer, extraTop }: { layer: Layer; extraTop?: React.ReactNode }) {
  const scene = useCreate((s) => s.scene)
  const type = layerType(layer.type)
  const id = layer.id
  const skip = descendants(scene.layers, id)
  const above = scene.layers[scene.layers.findIndex((l) => l.id === id) + 1]
  const contentParams = type.params
  return (
    <div className="dpanel inspector" data-keyscope="create">
      <div className="insp-title">
        <span className="label-dot" style={{ background: LABEL_COLORS[layer.label ?? 0] }} />
        <input className="input title-input" value={layer.name} aria-label="Layer name"
          onChange={(e) => updateLayer(id, 'Rename layer', (l) => ({ ...l, name: e.target.value }), `${id}.name`)} />
      </div>
      <p className="dim small">{type.about}</p>
      {extraTop}
      <Section title="Layer">
        <div className="insp-grid">
          <label className="param"><span className="param-label">Blend mode</span>
            <select className="select" value={layer.blend} onChange={(e) => updateLayer(id, 'Blend mode', (l) => ({ ...l, blend: Number(e.target.value) }))}>
              {BLEND_MODES.map((m, i) => <option key={m} value={i}>{m}</option>)}
            </select></label>
          <label className="param"><span className="param-label">Parent</span>
            <select className="select" value={layer.parent ?? ''} onChange={(e) => updateLayer(id, 'Parent', (l) => ({ ...l, parent: e.target.value || undefined }))}>
              <option value="">None</option>
              {[...scene.layers].reverse().filter((l) => !skip.has(l.id)).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select></label>
          <label className="param"><span className="param-label">Track matte</span>
            <select className="select" value={layer.matte ?? 0} onChange={(e) => updateLayer(id, 'Track matte', (l) => ({ ...l, matte: Number(e.target.value) }))}>
              {MATTES.map((m, i) => <option key={m} value={i}>{m}</option>)}
            </select>
            {(layer.matte ?? 0) > 0 && (
              <select className="select" value={layer.matteFrom ?? ''} onChange={(e) => updateLayer(id, 'Matte layer', (l) => ({ ...l, matteFrom: e.target.value || undefined }))}>
                <option value="">{above ? `The layer above (${above.name})` : 'The layer above (none)'}</option>
                {[...scene.layers].reverse().filter((l) => l.id !== id).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            )}
            {(layer.matte ?? 0) > 0 && <span className="dim small">The matte layer is hidden and only shapes this one. Alpha mattes need a layer with see-through parts (text, shapes, masks); for full-frame layers use a luma matte.</span>}
          </label>
          <div className="param"><span className="param-label">Label</span>
            <div className="label-row">{LABEL_COLORS.map((c, i) => <button key={c} className={`label-sw${(layer.label ?? 0) === i ? ' on' : ''}`} style={{ background: c }} title="Label color" onClick={() => updateLayer(id, 'Label', (l) => ({ ...l, label: i }))} />)}</div>
          </div>
        </div>
      </Section>
      <Section title="Transform">
        {transformDefs(scene).filter((d) => layer.type !== 'adjust' || d.key === 'opacity').map((d) => <PropRow key={d.key} owner={id} layer={layer} def={d} binding={d.key === 'opacity' ? layer.bindings.opacity : layer.bindings[d.key]} />)}
      </Section>
      {contentParams.length > 0 && (
        <Section title="Contents">
          {contentParams.map((p) => (
            <ParamControl key={p.key} param={p} value={layer.values[p.key] ?? p.default} binding={layer.bindings[p.key]}
              target={p.kind === 'number' ? `${id}.${p.key}` : undefined}
              onValue={(v) => updateLayer(id, `Change ${p.label}`, (l) => ({ ...l, values: { ...l.values, [p.key]: v } }), `${id}.${p.key}`)}
              onBinding={(b) => setBinding(id, p.key, b)} />
          ))}
        </Section>
      )}
      <Section title={`Masks (${layer.masks?.length ?? 0})`} start={Boolean(layer.masks?.length)} extra={
        <span className="row">
          <button className="btn small quiet" onClick={() => addMask(id, newMask('rect'))}>+ Rectangle</button>
          <button className="btn small quiet" onClick={() => addMask(id, newMask('ellipse'))}>+ Ellipse</button>
          <button className="btn small quiet" onClick={() => addMask(id, newMask('path', { points: [[-0.3, -0.3], [0.3, -0.3], [0, 0.35]] }))}>+ Path</button>
        </span>}>
        {(layer.masks ?? []).map((m, i) => <MaskCard key={m.id} layer={layer} mask={m} index={i} />)}
        {!layer.masks?.length && <p className="dim small">Masks cut the layer to a shape. They move with the layer.</p>}
      </Section>
      <Section title={`Effects (${layer.effects?.length ?? 0})`} extra={
        <button className={`fx-on${layer.fxOff ? '' : ' on'}`} title="All effects on or off" onClick={() => updateLayer(id, 'Effects on/off', (l) => ({ ...l, fxOff: !l.fxOff }))}>fx</button>}>
        <EffectStack owner={id} effects={layer.effects ?? []} layer={layer} />
      </Section>
    </div>
  )
}

export function FinishInspector() {
  const scene = useCreate((s) => s.scene)
  return (
    <div className="dpanel inspector" data-keyscope="create">
      <h3>Finish</h3>
      <p className="dim small">Applied on top of every layer: grade the whole picture here (color, LUTs, curves), then trails, color split and lines.</p>
      <Section title="Grade and effects">
        <EffectStack owner="master" effects={scene.master.effects ?? []} />
      </Section>
      <Section title="Look">
        {MASTER_PARAMS.map((p) => (
          <ParamControl key={p.key} param={p} value={scene.master.values[p.key] ?? p.default} binding={scene.master.bindings[p.key]} target={`master.${p.key}`}
            onValue={(v) => changeScene(`Change ${p.label}`, (s) => ({ ...s, master: { ...s.master, values: { ...s.master.values, [p.key]: v } } }), `master.${p.key}`)}
            onBinding={(b) => changeScene(b ? 'Link' : 'Unlink', (s) => {
              const next = { ...s.master.bindings }
              if (b) next[p.key] = b
              else delete next[p.key]
              return { ...s, master: { ...s.master, bindings: next } }
            })} />
        ))}
      </Section>
    </div>
  )
}
