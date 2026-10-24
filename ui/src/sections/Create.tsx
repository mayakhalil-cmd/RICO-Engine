import { pictureNames } from '../engine/shared'
import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../components/Icon'
import RIcon from '../components/RIcons'
import { addPrecompLayer, duplicateLayer, newAdjustment, newNull, newShape, newSolid, newText } from '../create/ops'
import { importMedia } from './Timeline'
import { openLayerSettings } from './LayerSettings'
import CodeBox from '../components/CodeBox'
import { toast } from '../components/Toasts'
import { readSignal, signalName, useSignalList, type SignalInfo } from '../engine/signals'
import { startLearn, stopLearn, useLearn } from '../engine/learn'
import { useRico } from '../engine/store'
import { LAYER_TYPES, layerType, type ParamDef } from '../create/layers'
import { SIZES, STARTERS, newLayer, repair, type Binding, type Layer, type Scene } from '../create/scene'
import { captureValue, getPlay, removeKey, setKey, timelineOf, trackFor, usePlay, valueAt } from '../create/timeline'
import { pickFile } from '../shell/ui'
import { runCommand } from '../shell/commands'
import { changeScene, closeComp, getCreate, listComps, newComp, openComp, previewMounted, replaceScene, select, setOutput, useCreate } from '../create/store'

export { SIGNAL_DRAG } from '../components/SignalPicker'
import { SIGNAL_DRAG } from '../components/SignalPicker'
import { FinishInspector, LayerInspector } from './LayerProps'
import PreviewTools from './PreviewTools'
import FontPicker from '../components/FontPicker'
import Viewer from './Viewer'

// linking a setting to a signal

export function LinkEditor({ binding, param, onChange, onClose }: {
  binding: Binding | undefined
  param: ParamDef
  onChange: (b: Binding | undefined) => void
  onClose: () => void
}) {
  const signals = useSignalList()
  const groups = useMemo(() => {
    const g = new Map<string, SignalInfo[]>()
    for (const s of signals) g.set(s.group, [...(g.get(s.group) ?? []), s])
    return [...g.entries()]
  }, [signals])
  const b: Binding = binding ?? { signal: '', min: param.min ?? 0, max: param.max ?? 1, smooth: 0.5 }
  const meter = useRef<HTMLElement | null>(null)

  useEffect(() => {
    let raf = 0
    const tick = () => {
      if (meter.current) meter.current.style.width = `${Math.max(0, Math.min(1, readSignal(b.signal))) * 100}%`
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [b.signal])

  const set = (part: Partial<Binding>) => onChange({ ...b, ...part })
  return (
    <div className="link-editor" role="group" aria-label={`Link ${param.label}`}>
      <label className="field">
        <span>Follow</span>
        <select className="select" value={b.signal} onChange={(e) => (e.target.value ? set({ signal: e.target.value }) : onChange(undefined))}>
          <option value="">Nothing, use the slider</option>
          {groups.map(([group, list]) => (
            <optgroup key={group} label={group}>
              {list.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      {b.signal && (
        <>
          <div className="meter in"><i ref={meter} /></div>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <label className="field"><span>From</span><input className="input" type="number" step={param.step} value={b.min} onChange={(e) => set({ min: Number(e.target.value) })} /></label>
            <label className="field"><span>To</span><input className="input" type="number" step={param.step} value={b.max} onChange={(e) => set({ max: Number(e.target.value) })} /></label>
          </div>
          <label className="field">
            <span>Smoothing</span>
            <input className="range" type="range" min={0} max={0.97} step={0.01} value={b.smooth} onChange={(e) => set({ smooth: Number(e.target.value) })} />
          </label>
        </>
      )}
      <button className="btn quiet small" onClick={onClose}>Done</button>
    </div>
  )
}

export function KeyButton({ target, value }: { target: string; value: number }) {
  const scene = useCreate((s) => s.scene)
  const play = usePlay()
  const track = trackFor(scene, target)
  const here = track?.keys.find((k) => Math.abs(k.t - play.time) < 0.5 / timelineOf(scene).fps)
  return (
    <button
      className={`icon-btn key-btn${track ? ' animated' : ''}${here ? ' here' : ''}`}
      title={here ? 'Remove the key here' : track ? 'Add a key here (animated)' : 'Animate: add a key at the playhead'}
      aria-label="Keyframe"
      onClick={() => (here ? removeKey(target, here.t) : setKey(target, play.time, value))}
    >{here ? '◆' : '◇'}</button>
  )
}

// A number you can type: any value, also past the slider's range.
// The compile error of a Shader layer's code, shown under the code.
function problemFor(code: string): string | undefined {
  const p = getCreate().problem
  return p && p.includes('layer:glsl') && code ? p.replace(/^Error: layer:glsl:[^:]+:[^:]+: /, '') : undefined
}

export function NumberBox({ value, onChange, digits = 3 }: { value: number; onChange: (v: number) => void; digits?: number }) {
  const [text, setText] = useState<string | null>(null)
  return (
    <input className="input numbox" inputMode="decimal" aria-label="Value"
      value={text ?? String(Number(value.toFixed(digits)))}
      onFocus={(e) => { setText(String(Number(value.toFixed(digits)))); e.target.select() }}
      onChange={(e) => { setText(e.target.value); const v = Number(e.target.value); if (e.target.value.trim() !== '' && Number.isFinite(v)) onChange(v) }}
      onBlur={() => setText(null)}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
  )
}

export function ParamControl({ param, value, binding, onValue: setValue, onBinding, target }: {
  param: ParamDef
  value: number | string
  binding?: Binding
  onValue: (v: number | string) => void
  onBinding: (b: Binding | undefined) => void
  target?: string
}) {
  const scene = useCreate((s) => s.scene)
  const play = usePlay()
  const track = target ? trackFor(scene, target) : undefined
  if (track && param.kind === 'number') value = valueAt(track, play.time) ?? value
  // Animated settings (or any setting while recording) write keys instead.
  const onValue = (v: number | string) => {
    if (target && param.kind === 'number' && captureValue(target, Number(v))) return
    setValue(v)
  }
  const [linking, setLinking] = useState(false)
  const [dropping, setDropping] = useState(false)
  const learn = useLearn()
  const learningThis = learn.active && learn.label === param.label

  if (param.kind === 'color') {
    return (
      <label className="param">
        <span className="param-label">{param.label}</span>
        <input type="color" className="swatch" value={String(value)} onChange={(e) => onValue(e.target.value)} />
      </label>
    )
  }
  if (param.kind === 'picture') {
    const names = pictureNames().filter((n) => n !== 'Create')
    return (
      <label className="param">
        <span className="param-label">{param.label}</span>
        <select className="select" value={String(value)} onChange={(e) => onValue(e.target.value)}>
          {!names.includes(String(value)) && <option value={String(value)}>{String(value)} (not made yet)</option>}
          {names.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <span className="dim small">Make one in Nodes: any picture node into "Picture out".</span>
      </label>
    )
  }
  if (param.kind === 'code') {
    return <CodeBox label={param.label} rows={10} value={String(value)} onChange={(v) => onValue(v)} error={problemFor(String(value))} />
  }
  if (param.kind === 'text') {
    return (
      <label className="param">
        <span className="param-label">{param.label}</span>
        <input className="input" value={String(value)} maxLength={80} onChange={(e) => onValue(e.target.value)} />
      </label>
    )
  }
  if (param.kind === 'choice') {
    return (
      <label className="param">
        <span className="param-label">{param.label}</span>
        <select className="select" value={Number(value)} onChange={(e) => onValue(Number(e.target.value))}>
          {param.choices?.map((c, i) => <option key={c} value={i}>{c}</option>)}
        </select>
      </label>
    )
  }

  const linked = Boolean(binding?.signal)
  const link = (signal: string) => onBinding({ min: param.min ?? 0, max: param.max ?? 1, smooth: 0.5, ...(binding ?? {}), signal })
  const learnNow = () => {
    if (learningThis) return stopLearn()
    startLearn(param.label, (signal) => {
      link(signal)
      toast(`${param.label} follows ${signalName(signal)}.`, true)
    })
  }

  return (
    <div
      className={`param${linked ? ' linked' : ''}${dropping ? ' dropping' : ''}${learningThis ? ' learning' : ''}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes(SIGNAL_DRAG)) { e.preventDefault(); setDropping(true) } }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        setDropping(false)
        const s = e.dataTransfer.getData(SIGNAL_DRAG)
        if (s) { e.preventDefault(); link(s) }
      }}
      onContextMenu={(e) => { e.preventDefault(); learnNow() }}
    >
      <div className="param-top">
        <span className="param-label">{param.label}</span>
        {linked
          ? <button className="link-chip" onClick={() => setLinking(!linking)} title="Change link">{signalName(binding!.signal)}</button>
          : <NumberBox value={Number(value)} digits={param.step && param.step >= 1 ? 0 : 3} onChange={onValue} />}
        {target && <KeyButton target={target} value={Number(value)} />}
        <button className={`icon-btn${learningThis ? ' on' : ''}`} title="Learn: move a control to link it (or right-click)" onClick={learnNow}>L</button>
        <button className={`icon-btn${linked ? ' on' : ''}`} aria-pressed={linking} title={`Link ${param.label} to a signal`} onClick={() => setLinking(!linking)}><Icon name="link" /></button>
      </div>
      {!linked && (
        <input className="range" type="range" aria-label={param.label} min={Math.min(param.min ?? 0, Number(value))} max={Math.max(param.max ?? 1, Number(value))} step={param.step} value={Number(value)} onChange={(e) => onValue(Number(e.target.value))} />
      )}
      {linking && <LinkEditor binding={binding} param={param} onChange={onBinding} onClose={() => setLinking(false)} />}
    </div>
  )
}


function updateLayer(id: string, label: string, fn: (l: Layer) => Layer, mergeKey?: string) {
  changeScene(label, (s) => ({ ...s, layers: s.layers.map((l) => (l.id === id ? fn(l) : l)) }), mergeKey)
}

// pictures

function readImage(file: File, id?: string) {
  if (!file.type.startsWith('image/')) return toast('That file is not a picture.')
  const reader = new FileReader()
  reader.onload = () => {
    const url = String(reader.result)
    if (id) updateLayer(id, 'Change picture', (l) => ({ ...l, image: url }))
    else {
      const l = { ...newLayer('image'), name: file.name.replace(/\.[^.]+$/, ''), image: url }
      changeScene('Add picture', (s) => ({ ...s, layers: [...s.layers, l] }))
      select(l.id)
    }
  }
  reader.readAsDataURL(file)
}

function pickImage(id: string) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.onchange = () => input.files?.[0] && readImage(input.files[0], id)
  input.click()
}

export function exportScene(scene: Scene) {
  const blob = new Blob([JSON.stringify(scene, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${scene.name.replace(/[^\w -]/g, '') || 'scene'}.rico.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

export function importScene(file: File) {
  file.text().then((t) => {
    const s = repair(JSON.parse(t))
    if (!s) return toast('That file is not a RICO scene.')
    replaceScene(s)
    toast(`Opened ${s.name}.`, true)
  }).catch(() => toast('That file is not a RICO scene.'))
}

export function addLayer(type: string) {
  const l = newLayer(type)
  changeScene(`Add ${l.name}`, (s) => ({ ...s, layers: [...s.layers, l] }))
  select(l.id)
  if (type === 'image') pickImage(l.id)
}

// panels

export function CreateLayers() {
  const layers = useCreate((s) => s.scene.layers)
  const selected = useCreate((s) => s.selected)
  const ordered = [...layers].reverse()

  const move = (id: string, dir: 1 | -1) => changeScene('Move layer', (s) => {
    const i = s.layers.findIndex((l) => l.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= s.layers.length) return s
    const next = [...s.layers]
    ;[next[i], next[j]] = [next[j], next[i]]
    return { ...s, layers: next }
  })
  const remove = (id: string) => {
    changeScene('Delete layer', (s) => ({ ...s, layers: s.layers.filter((l) => l.id !== id) }))
    if (selected === id) select(null)
  }

  const scene = useCreate((s) => s.scene)
  const path = useCreate((s) => s.path)
  const comps = listComps()
  const tl = timelineOf(scene)
  return (
    <div className="dpanel create-layers project" data-keyscope="create">
      <div className="pj-top">
        <select className="select mini grow" value="" aria-label="New layer" onChange={(e) => e.target.value && addLayer(e.target.value)}>
          <option value="">+ New layer</option>
          {LAYER_TYPES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select className="select mini" value="" aria-label="Start from a ready-made scene" title="Start from a ready-made scene" onChange={(e) => {
          const st = STARTERS.find((x) => x.id === e.target.value)
          if (st) replaceScene(st.make(), `Starter: ${st.name}`)
        }}>
          <option value="">Starters</option>
          {STARTERS.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      <div className="pj-tabrow"><span className="pj-tab">Composition</span><span className="grow" /><button className="icon-btn small" title="New composition (Ctrl+N)" onClick={() => openComp(newComp())}><Icon name="plus" /></button></div>
      {comps.length > 1 && (
        <ul className="pj-comps" aria-label="Compositions">
          {comps.map((c) => (
            <li key={c.id || 'main'}>
              <button className={(c.id ? path[path.length - 1]?.id === c.id : !path.length) ? 'on' : ''} title={c.id ? 'Open this composition (drag it on the timeline as a layer with + Layer)' : 'The main composition'} onClick={() => (c.id ? openComp(c.id) : closeComp(0))} onDoubleClick={() => c.id && addPrecompLayer(c.id)}>
                <RIcon name="folder" size={14} /><span>{c.name}</span><span className="dim small">{c.scene.layers.length} layers</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button className={`pj-comp${selected === null ? ' on' : ''}`} onClick={() => select(null)} title="The whole composition: trails, color split, lines and other finishing">
        <span className="pj-comp-icon" aria-hidden="true"><RIcon name="folder" size={18} /></span>
        <span className="pj-name">{scene.name}</span>
        <span className="pj-meta">Composition: {scene.width} x {scene.height}, {tl.duration} s, {tl.fps} fps</span>
      </button>
      <div className="pj-head"><span>Name</span><span>Type</span></div>
      <ul className="layers pj-list">
        {ordered.map((l, i) => (
          <li key={l.id} className={`${selected === l.id ? 'on' : ''}${l.visible ? '' : ' hidden'}`}>
            <button className="icon-btn" aria-pressed={l.visible} title={l.visible ? 'Hide' : 'Show'} onClick={() => updateLayer(l.id, l.visible ? 'Hide layer' : 'Show layer', (x) => ({ ...x, visible: !x.visible }))}>
              <Icon name={l.visible ? 'eye' : 'eyeOff'} />
            </button>
            <button className="layer-name" onClick={() => select(l.id)}>
              <span className="pj-num">{i + 1}</span>{l.name}
              {Object.keys(l.bindings).length > 0 && <span className="layer-links" title="Has linked settings"><Icon name="link" /></span>}
            </button>
            <span className="pj-type">{layerType(l.type)?.name ?? l.type}</span>
            <span className="pj-acts">
              <button className="icon-btn" title="Move up" onClick={() => move(l.id, 1)}><Icon name="up" /></button>
              <button className="icon-btn" title="Move down" onClick={() => move(l.id, -1)}><Icon name="down" /></button>
              <button className="icon-btn danger" title="Delete layer" onClick={() => remove(l.id)}><Icon name="x" /></button>
            </span>
          </li>
        ))}
        {ordered.length === 0 && <li className="dim small">Empty. Add a layer to start.</li>}
      </ul>
      <div className="pj-foot" role="toolbar" aria-label="Make">
        <button className="icon-btn no-corner" title="Import a picture or video file" onClick={() => pickFile('video/*,image/*', (f) => void importMedia(f, getPlay().time))}><RIcon name="import" size={16} /></button>
        <button className="icon-btn no-corner" title="New solid (Ctrl+Y)" onClick={() => newSolid()}><RIcon name="solid" size={16} /></button>
        <button className="icon-btn no-corner" title="New text (Ctrl+Alt+Shift+T)" onClick={() => newText()}><RIcon name="text" size={16} /></button>
        <button className="icon-btn no-corner" title="New shape layer" onClick={() => newShape()}><RIcon name="star" size={16} /></button>
        <button className="icon-btn no-corner" title="New null object (to parent things to)" onClick={() => newNull()}><RIcon name="anchor" size={16} /></button>
        <button className="icon-btn no-corner" title="New adjustment layer" onClick={() => newAdjustment()}><RIcon name="fx" size={16} /></button>
        <button className="icon-btn no-corner" title="Composition settings (Ctrl+K)" onClick={() => openLayerSettings('scene')}><RIcon name="settings" size={16} /></button>
        <span className="grow" />
        <button className="icon-btn no-corner" title="Duplicate the picked layer (Ctrl+D)" disabled={!selected} onClick={() => duplicateLayer()}><RIcon name="duplicate" size={16} /></button>
        <button className="icon-btn no-corner danger" title="Delete the picked layer" disabled={!selected} onClick={() => selected && remove(selected)}><RIcon name="trash" size={16} /></button>
      </div>
    </div>
  )
}

export function CreatePreview() {
  const host = useRef<HTMLDivElement | null>(null)
  const scene = useCreate((s) => s.scene)
  const output = useCreate((s) => s.output)
  const fps = useCreate((s) => s.fps)
  const problem = useCreate((s) => s.problem)
  const video = useRico((s) => s.state?.video)

  useEffect(() => {
    previewMounted(true)
    return () => previewMounted(false)
  }, [])

  const fullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen()
    else host.current?.requestFullscreen().catch(() => toast('Full screen is not allowed here.'))
  }

  return (
    <div className="create-preview comp" data-keyscope="create" ref={host}>
      <Viewer onFullscreen={fullscreen} onDropFile={(f) => { if (f.name.endsWith('.json')) importScene(f); else readImage(f) }} bar={<>
        <select className="select mini comp-size" aria-label="Size" title="Composition size" value={`${scene.width}x${scene.height}`}
          onChange={(e) => { const [w, h] = e.target.value.split('x').map(Number); changeScene('Change size', (s) => ({ ...s, width: w, height: h })) }}>
          {SIZES.map((s) => <option key={s.label} value={`${s.w}x${s.h}`}>{s.label}</option>)}
        </select>
      </>} barEnd={<>
        <label className="switch mini" title={output ? `${video?.spout.sending ? `Spout "${video.spout.name}"` : 'Spout off'}, ${video?.sending && video.source === 3 ? `${video.transports[video.transport]?.name} "${video.name}"` : 'network off'}` : 'Send this picture as video to other apps'}>
          <input type="checkbox" role="switch" checked={output} onChange={(e) => setOutput(e.target.checked)} /><span>Send video</span></label>
        <button className="vb" title="Open a window for a projector or second screen" onClick={() => runCommand('output.new')}>Output window</button>
        <span className={`fps${fps < 50 ? ' low' : ''}`} title="Frames per second">{fps} fps</span>
        <button className="icon-btn" title="Full screen (F)" onClick={fullscreen}><Icon name="external" /></button>
      </>}>
        <PreviewTools />
        {problem && <div className="error create-problem">{problem}</div>}
      </Viewer>
    </div>
  )
}

export function CreateInspector() {
  const scene = useCreate((s) => s.scene)
  const selected = useCreate((s) => s.selected)
  const layer = scene.layers.find((l) => l.id === selected) ?? null
  if (!layer) return <FinishInspector />
  const type = layerType(layer.type)
  const id = layer.id
  return (
    <LayerInspector layer={layer} extraTop={<>
      {type.source === 'image' && (
        <button className="btn small" onClick={() => pickImage(id)}>{layer.image ? 'Change picture' : 'Pick a picture'}</button>
      )}
      {type.source === 'video' && (
        <button className="btn small" onClick={() => pickFile('video/*', (f) => {
          const url = URL.createObjectURL(f)
          updateLayer(id, 'Change video', (l) => ({ ...l, video: url, name: l.name === 'Video clip' ? f.name.replace(/\.[^.]+$/, '') : l.name }))
        })}>{layer.video ? 'Change video' : 'Pick a video file'}</button>
      )}
      {type.source === 'text' && (
        <label className="param"><span className="param-label">Your font (instead of the list below)</span>
          <FontPicker value={layer.fontFamily ?? ''} onChange={(fontFamily) => updateLayer(id, 'Font', (l) => ({ ...l, fontFamily }))} />
        </label>
      )}
      {type.source === 'scene3d' && <p className="small muted">Build it in the 3D workspace. Black becomes see-through so it sits on your other layers.</p>}
    </>} />
  )
}
