import Icon from '../components/Icon'
import Scrub from '../components/Scrub'
import { useCreate } from '../create/store'
import { captureValue, getPlay, removeKey, removeTrack, seek, setKey, timelineOf, trackFor, usePlay, valueAt } from '../create/timeline'
import { setAnimValue, type Anim } from '../three/keyed'
import { changeWorld, updateObject, type Obj3D } from '../three/world'

// The keyframe controls of one setting, like After Effects: the stopwatch
// turns animation on and off, the arrows jump to the key before and after,
// the diamond adds or removes the key at the playhead, and the number is the
// value right now (drag it or type it: when the setting is animated, that
// puts a key at the playhead).

export function Stopwatch({ target, value }: { target: string; value: number }) {
  const scene = useCreate((s) => s.scene)
  const animated = Boolean(trackFor(scene, target))
  return (
    <button className={`sw${animated ? ' on' : ''}`} title={animated ? 'Stop animating (removes all its keys)' : 'Animate: add a key at the playhead'}
      onClick={() => (animated ? removeTrack(target) : setKey(target, getPlay().time, value))}><Icon name="stopwatch" /></button>
  )
}

export function KeyNav({ target, value }: { target: string; value: number }) {
  const scene = useCreate((s) => s.scene)
  const play = usePlay()
  const track = trackFor(scene, target)
  if (!track) return null
  const fps = timelineOf(scene).fps
  const here = track.keys.find((k) => Math.abs(k.t - play.time) < 0.5 / fps)
  const prev = [...track.keys].reverse().find((k) => k.t < play.time - 0.5 / fps)
  const next = track.keys.find((k) => k.t > play.time + 0.5 / fps)
  return (
    <span className="kf-nav" role="group" aria-label="Keys">
      <button className="kf-arrow" disabled={!prev} title="The key before (J)" onClick={() => prev && seek(prev.t)}>{'◀'}</button>
      <button className={`kf${here ? ' here' : ''}`} title={here ? 'Remove the key here' : 'Add a key here'} onClick={() => (here ? removeKey(target, here.t) : setKey(target, play.time, value))}>{here ? '◆' : '◇'}</button>
      <button className="kf-arrow" disabled={!next} title="The key after (K)" onClick={() => next && seek(next.t)}>{'▶'}</button>
    </span>
  )
}

// One animatable 3D setting, for the 3D timeline and the property boxes.
export function KeyRow3d({ o, an, compact }: { o: Obj3D; an: Anim; compact?: boolean }) {
  const scene = useCreate((s) => s.scene)
  const play = usePlay()
  const target = `3d:${o.id}.${an.key}`
  const track = trackFor(scene, target)
  const v = track ? valueAt(track, play.time) ?? an.value : an.value
  const set = (x: number) => {
    if (captureValue(target, x)) return
    const ok = setAnimValue(o, an.key, x, (id, part, label, merge) => updateObject(id, part, label, merge),
      (matId, lid, part) => changeWorld('Change look', (w) => ({ ...w, materials: (w.materials ?? []).map((m) => (m.id === matId ? { ...m, layers: m.layers.map((l) => (l.id === lid ? { ...l, ...part } : l)) } : m)) }), `${matId}.${lid}`))
    if (!ok) setKey(target, play.time, x)
  }
  const span = an.max - an.min
  const step = span > 50 ? 0.5 : span > 5 ? 0.05 : 0.005
  return (
    <div className={`prop${compact ? ' compact' : ''}`}>
      <Stopwatch target={target} value={v} />
      <span className="prop-label">{an.label}</span>
      <Scrub value={v} step={step} digits={span > 50 ? 1 : 3} onChange={set} />
      <KeyNav target={target} value={v} />
    </div>
  )
}
