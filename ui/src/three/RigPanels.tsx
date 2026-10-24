import { MORPH_SHAPES } from './fluidMorph'
import { useSyncExternalStore } from 'react'
import RIcon from '../components/RIcons'
import { useBones } from './importers'
import { getPoseBone, setPoseBone } from './engine'
import { FLUID_DEFAULT, PHYSICS_DEFAULT, updateObject, useWorld, type Deform, type Obj3D } from './world'
import { useSim } from './sim'
import { KeyButton } from '../sections/Create'
import { captureValue, trackFor, usePlay, valueAt } from '../create/timeline'
import { useCreate } from '../create/store'
import { SymbioteQuick } from './SymbiotePanel'

// 3D settings for rigging and simulation: deformers, morph, bones, physics
// and fluid. Each is a group you open and close, like the other groups.

// A setting with a slider and, with a target, a key button like Motion's:
// once it has keys, moving it puts a key at the playhead.
export function Num({ label, value, min, max, step = 0.01, onChange, target }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; target?: string }) {
  const scene = useCreate((st) => st.scene)
  const play = usePlay()
  const track = target ? trackFor(scene, target) : undefined
  const v = track ? valueAt(track, play.time) ?? value : value
  const set = (x: number) => { if (target && captureValue(target, x)) return; onChange(x) }
  return (
    <div className="param">
      <span className="param-top"><span className="param-label">{label}</span><span className="dim small">{Number(v.toFixed(3))}</span>{target && <KeyButton target={target} value={v} />}</span>
      <input className="range" type="range" aria-label={label} min={min} max={max} step={step} value={v} onChange={(e) => set(Number(e.target.value))} />
    </div>
  )
}

export function Group({ icon, title, children, open = true, extra }: { icon: string; title: string; children: React.ReactNode; open?: boolean; extra?: React.ReactNode }) {
  return (
    <details className="r-group" open={open}>
      <summary><RIcon name={icon} size={14} /><span>{title}</span><span className="grow" />{extra}</summary>
      <div className="r-body">{children}</div>
    </details>
  )
}

const KIND_NAME: Record<Deform['kind'], string> = { bend: 'Bend', twist: 'Twist', taper: 'Taper', squash: 'Squash and stretch', wave: 'Wave' }

export function DeformEditor({ o }: { o: Obj3D }) {
  const list = o.deform ?? []
  if (!list.length && !o.morph && !o.symbiote) return null
  const set = (id: string, part: Partial<Deform>) => updateObject(o.id, { deform: list.map((d) => (d.id === id ? { ...d, ...part } : d)) }, 'Deform', `${o.id}.df.${id}.${Object.keys(part).join()}`)
  const remove = (id: string) => updateObject(o.id, { deform: list.filter((d) => d.id !== id) }, 'Remove deformer')
  return (
    <Group icon="bend" title="Deform">
      {list.map((d) => (
        <div key={d.id} className="r-card">
          <div className="row gap">
            <label className="mini-check"><input type="checkbox" checked={d.on !== false} onChange={(e) => set(d.id, { on: e.target.checked })} /></label>
            <b>{KIND_NAME[d.kind]}</b><span className="grow" />
            <div className="seg" role="group" aria-label="Along">{(['x', 'y', 'z'] as const).map((a) => <button key={a} className={d.axis === a ? 'on' : ''} onClick={() => set(d.id, { axis: a })}>{a.toUpperCase()}</button>)}</div>
            <button className="icon-btn danger" title="Remove" onClick={() => remove(d.id)}>×</button>
          </div>
          <Num label="Amount" value={d.amount} min={d.kind === 'squash' ? -1 : -2} max={d.kind === 'squash' ? 1 : 2} onChange={(amount) => set(d.id, { amount })} target={`3d:${o.id}.deform.${d.id}.amount`} />
          {d.kind === 'wave' && <>
            <Num label="Waves" value={d.freq ?? 2} min={0.2} max={10} onChange={(freq) => set(d.id, { freq })} target={`3d:${o.id}.deform.${d.id}.freq`} />
            <Num label="Speed" value={d.speed ?? 1} min={-4} max={4} onChange={(speed) => set(d.id, { speed })} target={`3d:${o.id}.deform.${d.id}.speed`} />
          </>}
        </div>
      ))}
      {o.morph && <MorphEditor o={o} />}
      {o.symbiote && <SymbioteQuick o={o} />}
      <p className="dim small">The diamond puts a key at the playhead; every setting here can be keyed (see the 3D timeline). "Deform amount" scales every deformer and can follow the music.</p>
    </Group>
  )
}

function MorphEditor({ o }: { o: Obj3D }) {
  const objects = useWorld((w) => w.objects)
  const m = o.morph!
  return (
    <div className="r-card">
      <div className="row gap"><b>Morph</b><span className="grow" /><button className="icon-btn danger" title="Remove" onClick={() => updateObject(o.id, { morph: undefined }, 'Remove morph')}>×</button></div>
      <label className="param"><span className="param-label">Into</span>
        <select className="select" value={m.to} onChange={(e) => updateObject(o.id, { morph: { ...m, to: e.target.value } }, 'Morph')}>
          {MORPH_SHAPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          {objects.filter((x) => x.id !== o.id && !['point-light', 'spot-light', 'sun', 'fog', 'fluid'].includes(x.kind)).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select></label>
      <Num label="How far" value={m.amount} min={0} max={1} onChange={(amount) => updateObject(o.id, { morph: { ...m, amount } }, 'Morph', `${o.id}.morph`)} target={`3d:${o.id}.morph`} />
      <label className="param"><span className="param-label">How it moves</span>
        <select className="select" value={m.style ?? 'fluid'} onChange={(e) => updateObject(o.id, { morph: { ...m, style: e.target.value as 'fluid' | 'points' } }, 'Morph')}>
          <option value="fluid">Fluid: flows, splits and joins like a living goo</option>
          <option value="points">Points: the shape's own points slide (quicker)</option>
        </select></label>
      {(m.style ?? 'fluid') === 'fluid' && <>
        <Num label="Goo" value={m.goo ?? 0.6} min={0} max={1} onChange={(goo) => updateObject(o.id, { morph: { ...m, goo } }, 'Morph', `${o.id}.morph.goo`)} target={`3d:${o.id}.morphx.goo`} />
        <Num label="Spread" value={m.spread ?? 0.6} min={0} max={1} onChange={(spread) => updateObject(o.id, { morph: { ...m, spread } }, 'Morph', `${o.id}.morph.spread`)} target={`3d:${o.id}.morphx.spread`} />
        <Num label="Flow speed" value={m.speed ?? 0.6} min={0} max={4} onChange={(speed) => updateObject(o.id, { morph: { ...m, speed } }, 'Morph', `${o.id}.morph.speed`)} target={`3d:${o.id}.morphx.speed`} />
        <Num label="Detail" value={m.detail ?? 56} min={24} max={96} onChange={(detail) => updateObject(o.id, { morph: { ...m, detail: Math.round(detail) } }, 'Morph', `${o.id}.morph.detail`)} />
        <p className="dim small">Goo: how much it reaches out on the way. Spread: how unevenly the change moves across it. More detail is smoother and slower.</p>
      </>}
    </div>
  )
}

let pv = 0
const pl = new Set<() => void>()
const pickBone = (p: { id: string; name: string } | null) => { setPoseBone(p); pv++; pl.forEach((l) => l()) }
export function PoseEditor({ o }: { o: Obj3D }) {
  const bones = useBones(o.id)
  useSyncExternalStore((l) => { pl.add(l); return () => pl.delete(l) }, () => pv)
  if (o.kind !== 'model' || !bones.length) return null
  const cur = getPoseBone()
  const on = cur?.id === o.id ? cur.name : ''
  return (
    <Group icon="bones" title={`Pose (${bones.length} bones)`} open={false}>
      <label className="param"><span className="param-label">Bone to turn</span>
        <select className="select" value={on} onChange={(e) => pickBone(e.target.value ? { id: o.id, name: e.target.value } : null)}>
          <option value="">None (move the whole model)</option>
          {bones.map((b) => <option key={b} value={b}>{b}{o.pose?.[b] ? ' (posed)' : ''}</option>)}
        </select></label>
      <p className="dim small">Pick a bone, then turn it with the rings in the 3D view. Your pose goes on top of the model's animation.</p>
      <div className="row gap">
        {on && <button className="btn small quiet" onClick={() => { const next = { ...(o.pose ?? {}) }; delete next[on]; updateObject(o.id, { pose: next }, 'Reset bone') }}>Reset this bone</button>}
        {o.pose && Object.keys(o.pose).length > 0 && <button className="btn small quiet" onClick={() => updateObject(o.id, { pose: undefined }, 'Reset pose')}>Reset the whole pose</button>}
        {on && <button className="btn small" onClick={() => pickBone(null)}>Done</button>}
      </div>
    </Group>
  )
}

export function PhysicsEditor({ o }: { o: Obj3D }) {
  const sim = useSim()
  if (!o.physics) return null
  const p = { ...PHYSICS_DEFAULT, ...o.physics }
  const set = (part: Partial<typeof p>, label = 'Physics') => updateObject(o.id, { physics: { ...p, ...part } }, label, `${o.id}.ph.${Object.keys(part).join()}`)
  return (
    <Group icon="physics" title="Physics" extra={<label className="mini-check" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={p.on} onChange={(e) => set({ on: e.target.checked })} />On</label>}>
      <div className="seg" role="group" aria-label="Kind">
        <button className={!p.still && !(p.pieces && p.pieces > 1) ? 'on' : ''} onClick={() => set({ still: false, pieces: 0 })}>Falls</button>
        <button className={p.still ? 'on' : ''} onClick={() => set({ still: true, pieces: 0 })}>Stays put</button>
        <button className={!p.still && (p.pieces ?? 0) > 1 ? 'on' : ''} onClick={() => set({ still: false, pieces: p.pieces && p.pieces > 1 ? p.pieces : 14 })}>Breaks</button>
      </div>
      <Num label="Bounce" value={p.bounce} min={0} max={1} onChange={(bounce) => set({ bounce })} target={`3d:${o.id}.physics.bounce`} />
      <Num label="Friction" value={p.friction} min={0} max={1} onChange={(friction) => set({ friction })} target={`3d:${o.id}.physics.friction`} />
      <Num label="Weight" value={p.mass} min={0.1} max={10} onChange={(mass) => set({ mass })} target={`3d:${o.id}.physics.mass`} />
      {(p.pieces ?? 0) > 1 && <>
        <Num label="Pieces" value={p.pieces ?? 14} min={2} max={60} step={1} onChange={(pieces) => set({ pieces })} />
        <Num label="Blast" value={p.blast ?? 2} min={0} max={10} onChange={(blast) => set({ blast })} target={`3d:${o.id}.physics.blast`} />
      </>}
      <p className="dim small">{sim.playing ? 'Playing. Reset in the strip (Animating > the play button corner) puts things back.' : 'Press Animating > Play the simulation in the strip.'}</p>
    </Group>
  )
}

export function FluidEditor({ o }: { o: Obj3D }) {
  if (o.kind !== 'fluid') return null
  const f = { ...FLUID_DEFAULT, ...(o.fluid ?? {}) }
  const set = (part: Partial<typeof f>) => updateObject(o.id, { fluid: { ...f, ...part } }, 'Fluid', `${o.id}.fl.${Object.keys(part).join()}`)
  return (
    <Group icon="fluid" title="Fluid">
      <Num label="Drops" value={f.count} min={100} max={4000} step={50} onChange={(count) => set({ count })} />
      <Num label="Drop size" value={f.size} min={0.02} max={0.2} step={0.005} onChange={(size) => set({ size })} />
      <Num label="Thick (honey) or thin (water)" value={f.thick} min={0} max={1} onChange={(thick) => set({ thick })} target={`3d:${o.id}.fluid.thick`} />
      <label className="switch mini"><input type="checkbox" role="switch" checked={f.box} onChange={(e) => set({ box: e.target.checked })} /><span>Held in its box (off: it spills onto the floor)</span></label>
      <p className="dim small">Size the object to size the block of liquid. It flows around things with physics. Glass or chrome looks best.</p>
    </Group>
  )
}
