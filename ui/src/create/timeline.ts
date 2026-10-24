import { useSyncExternalStore } from 'react'
import { changeScene, getCreate, getRenderer, onFrame } from './store'
import { driven } from './renderer'
import { emptyTimeline, type Cue, type CueKind, type Ease, type Key, type OutKind, type OutTrack, type Scene, type Timeline } from './scene'
import { rico } from '../engine/connection'
import { putSignal } from '../engine/signals'
import { valueAt } from './keys'
export { valueAt }

// The timeline: keyframes for any Create setting, layers that come in and
// out, play, loop and record. While it is stopped, Create runs live; while
// it plays (or you scrub), Create shows the timeline's time.

interface PlayState {
  playing: boolean
  time: number          // playhead, seconds
  scrubbing: boolean
  armed: boolean        // record: moving a setting while playing writes keys
}

let play: PlayState = { playing: false, time: 0, scrubbing: false, armed: false }
let version = 0
const listeners = new Set<() => void>()
function emit() {
  version++
  listeners.forEach((l) => l())
}
function setPlay(part: Partial<PlayState>) {
  play = { ...play, ...part }
  emit()
}

export function usePlay(): PlayState {
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => version,
  )
  return play
}
export const getPlay = () => play

export const timelineOf = (s: Scene): Timeline => s.timeline ?? emptyTimeline()

// ---- values ------------------------------------------------------------------

export const trackFor = (s: Scene, target: string) => timelineOf(s).tracks.find((t) => t.target === target)

// ---- editing (all undoable) --------------------------------------------------

function changeTimeline(label: string, fn: (t: Timeline) => Timeline, key?: string) {
  changeScene(label, (s) => ({ ...s, timeline: fn(timelineOf(s)) }), key)
}

export function setTimeline(part: Partial<Timeline>, label = 'Change timeline') {
  changeTimeline(label, (t) => ({ ...t, ...part }), `tl.${Object.keys(part).join()}`)
}

const sortKeys = (keys: Key[]) => [...keys].sort((a, b) => a.t - b.t)
const frame = (tl: Timeline) => 1 / Math.max(1, tl.fps)

// Keys live in two places: tracks that animate a setting ("<layer>.<key>",
// "master.<key>", "3d:<object>.<key>") and output tracks ("out:<id>").
function withKeys(tl: Timeline, target: string, fn: (keys: Key[]) => Key[]): Timeline {
  if (target.startsWith('out:')) {
    const id = target.slice(4)
    return { ...tl, outTracks: (tl.outTracks ?? []).map((o) => (o.id === id ? { ...o, keys: sortKeys(fn(o.keys)) } : o)) }
  }
  const track = tl.tracks.find((x) => x.target === target)
  const keys = sortKeys(fn(track?.keys ?? []))
  if (!track) return keys.length ? { ...tl, tracks: [...tl.tracks, { target, keys }] } : tl
  return { ...tl, tracks: tl.tracks.map((x) => (x === track ? { ...x, keys } : x)).filter((x) => x.keys.length > 0) }
}
export const keysOf = (tl: Timeline, target: string): Key[] =>
  target.startsWith('out:') ? (tl.outTracks ?? []).find((o) => o.id === target.slice(4))?.keys ?? [] : tl.tracks.find((x) => x.target === target)?.keys ?? []

// Puts a key at time t (replacing one within a frame of it).
export function setKey(target: string, t: number, v: number, label = 'Set key') {
  changeTimeline(label, (tl) => {
    const f = frame(tl)
    const time = Math.round(t / f) * f
    return withKeys(tl, target, (keys) => {
      const prev = keys.find((k) => Math.abs(k.t - time) <= f / 2)
      return [...keys.filter((k) => Math.abs(k.t - time) > f / 2), { t: time, v, ease: prev?.ease ?? 'smooth' }]
    })
  }, `key.${target}.${Math.round(t * 1000)}`)
}

export function removeKey(target: string, t: number) {
  removeKeys([{ target, t }])
}

export function removeKeys(list: { target: string; t: number }[]) {
  if (!list.length) return
  changeTimeline(list.length === 1 ? 'Delete key' : `Delete ${list.length} keys`, (tl) => {
    let next = tl
    for (const { target, t } of list) next = withKeys(next, target, (keys) => keys.filter((k) => Math.abs(k.t - t) > 1e-6))
    return next
  })
}

export function moveKey(target: string, from: number, to: number) {
  moveKeys([{ target, t: from }], to - from, `move.${target}.${from}`)
}

// Moves several keys by the same amount (one undo step while dragging).
export function moveKeys(list: { target: string; t: number }[], dt: number, mergeKey?: string) {
  if (!list.length || !dt) return
  changeTimeline(list.length === 1 ? 'Move key' : `Move ${list.length} keys`, (tl) => {
    let next = tl
    const byTarget = new Map<string, number[]>()
    for (const k of list) byTarget.set(k.target, [...(byTarget.get(k.target) ?? []), k.t])
    for (const [target, times] of byTarget) {
      next = withKeys(next, target, (keys) => keys.map((k) => (times.some((t) => Math.abs(k.t - t) < 1e-6) ? { ...k, t: Math.max(0, k.t + dt) } : k)))
    }
    return next
  }, mergeKey ?? `move.${list.map((k) => k.target).join()}`)
}

export interface CopiedKey { target: string; t: number; v: number; ease: Ease }
// Puts copied keys back, the first one at time "at".
export function pasteKeys(clip: CopiedKey[], at: number) {
  if (!clip.length) return
  const t0 = Math.min(...clip.map((k) => k.t))
  changeTimeline(`Paste ${clip.length} key${clip.length === 1 ? '' : 's'}`, (tl) => {
    let next = tl
    for (const k of clip) {
      const t = at + k.t - t0
      next = withKeys(next, k.target, (keys) => [...keys.filter((x) => Math.abs(x.t - t) > 1e-6), { t, v: k.v, ease: k.ease }])
    }
    return next
  })
}

export function setEase(target: string, t: number, e: Ease) {
  changeTimeline('Change easing', (tl) => withKeys(tl, target, (keys) => keys.map((k) => (Math.abs(k.t - t) < 1e-6 ? { ...k, ease: e } : k))))
}

// ---- layers on the timeline ----

export function updateLayer(id: string, part: { solo?: boolean; locked?: boolean; visible?: boolean; blend?: number }, label: string) {
  changeScene(label, (s) => ({ ...s, layers: s.layers.map((l) => (l.id === id ? { ...l, ...part } : l)) }))
}

// Moves a layer to a new place in the stack (index from the bottom).
export function moveLayer(id: string, to: number) {
  changeScene('Reorder layers', (s) => {
    const from = s.layers.findIndex((l) => l.id === id)
    if (from < 0) return s
    const layers = [...s.layers]
    const [l] = layers.splice(from, 1)
    layers.splice(Math.max(0, Math.min(layers.length, to)), 0, l)
    return { ...s, layers }
  })
}

// ---- output tracks: OSC, MIDI, DMX and signals --------------------------------

const rid = () => Math.random().toString(36).slice(2, 9)
export const OUT_LABEL: Record<OutKind, string> = { osc: 'OSC', 'midi-cc': 'MIDI CC', dmx: 'DMX', signal: 'Signal' }

export function addOutTrack(kind: OutKind, part: Partial<OutTrack> = {}) {
  const n = (timelineOf(getCreate().scene).outTracks ?? []).filter((o) => o.kind === kind).length + 1
  const tr: OutTrack = {
    id: rid(), kind, name: `${OUT_LABEL[kind]} ${n}`, host: '127.0.0.1', port: 9000, address: `/rico/track${n}`,
    channel: 1, number: 20 + n, min: 0, max: 1,
    keys: [{ t: 0, v: 0, ease: 'smooth' }, { t: 2, v: 1, ease: 'smooth' }], ...part,
  }
  changeTimeline(`Add ${OUT_LABEL[kind]} track`, (tl) => ({ ...tl, outTracks: [...(tl.outTracks ?? []), tr] }))
  return tr.id
}
export function updateOutTrack(id: string, part: Partial<OutTrack>, label = 'Change track') {
  changeTimeline(label, (tl) => ({ ...tl, outTracks: (tl.outTracks ?? []).map((o) => (o.id === id ? { ...o, ...part } : o)) }), `out.${id}.${Object.keys(part).join()}`)
}
export function removeOutTrack(id: string) {
  sent.delete(id)
  changeTimeline('Delete track', (tl) => ({ ...tl, outTracks: (tl.outTracks ?? []).filter((o) => o.id !== id) }))
}

const sent = new Map<string, number>()
function sendOut(o: OutTrack, v: number) {
  const last = sent.get(o.id)
  if (last !== undefined && Math.abs(last - v) < 1 / 512) return
  sent.set(o.id, v)
  const c = Math.max(0, Math.min(1, v))
  if (o.kind === 'osc') rico.send('net.osc', { host: o.host, port: o.port, address: o.address, args: [o.min + c * (o.max - o.min)] })
  else if (o.kind === 'midi-cc') rico.send('midi.send', { bytes: [0xb0 + ((o.channel - 1) & 15), o.number & 127, Math.round(c * 127)] })
  else if (o.kind === 'dmx') rico.send('dmx.set', { channel: Math.max(1, Math.min(512, o.channel)), value: c })
  else putSignal(`tl:${o.name}`, `Timeline: ${o.name}`, c)
}

// ---- cues -------------------------------------------------------------------------

export const CUE_LABEL: Record<CueKind, string> = { osc: 'Send OSC', 'midi-note': 'Play a MIDI note', command: 'Run a command', signal: 'Hit a signal' }

export function addCue(t: number, kind: CueKind = 'osc') {
  const n = (timelineOf(getCreate().scene).cues ?? []).length + 1
  const cue: Cue = { id: rid(), t, name: `Cue ${n}`, kind, host: '127.0.0.1', port: 9000, address: `/rico/cue/${n}`, value: 1, channel: 1, number: 60, command: '' }
  changeTimeline('Add cue', (tl) => ({ ...tl, cues: [...(tl.cues ?? []), cue].sort((a, b) => a.t - b.t) }))
  return cue.id
}
export function updateCue(id: string, part: Partial<Cue>, label = 'Change cue') {
  changeTimeline(label, (tl) => ({ ...tl, cues: (tl.cues ?? []).map((c) => (c.id === id ? { ...c, ...part } : c)).sort((a, b) => a.t - b.t) }), `cue.${id}.${Object.keys(part).join()}`)
}
export function removeCue(id: string) {
  changeTimeline('Delete cue', (tl) => ({ ...tl, cues: (tl.cues ?? []).filter((c) => c.id !== id) }))
}

export function fireCue(c: Cue) {
  if (c.kind === 'osc') rico.send('net.osc', { host: c.host, port: c.port, address: c.address, args: [c.value] })
  else if (c.kind === 'midi-note') {
    const ch = (c.channel - 1) & 15
    rico.send('midi.send', { bytes: [0x90 + ch, c.number & 127, Math.round(Math.max(0, Math.min(1, c.value)) * 127) || 100] })
    window.setTimeout(() => rico.send('midi.send', { bytes: [0x80 + ch, c.number & 127, 0] }), 150)
  } else if (c.kind === 'command' && c.command) import('../shell/commands').then((m) => m.runCommand(c.command))
  else if (c.kind === 'signal') {
    putSignal(`cue:${c.name}`, `Cue: ${c.name}`, 1)
    window.setTimeout(() => putSignal(`cue:${c.name}`, `Cue: ${c.name}`, 0), 100)
  }
}

// ---- work area ----

export function setWorkArea(inPoint: number | undefined, outPoint: number | undefined) {
  changeTimeline('Work area', (tl) => ({ ...tl, inPoint, outPoint }), 'work')
}
export const workArea = (tl: Timeline): [number, number] => {
  const a = Math.max(0, Math.min(tl.duration, tl.inPoint ?? 0))
  const b = Math.max(a + 0.05, Math.min(tl.duration, tl.outPoint ?? tl.duration))
  return [a, b]
}

export function removeTrack(target: string) {
  driven.delete(target)
  changeTimeline('Stop animating', (tl) => ({ ...tl, tracks: tl.tracks.filter((x) => x.target !== target) }))
}

export function setLayerTime(id: string, start: number | undefined, end: number | undefined) {
  changeScene('Trim layer', (s) => ({ ...s, layers: s.layers.map((l) => (l.id === id ? { ...l, start, end } : l)) }), `trim.${id}`)
}

// Called when you move a setting by hand. Returns true when the change went
// into the timeline instead of the setting itself.
export function captureValue(target: string, v: number): boolean {
  const s = getCreate().scene
  const track = trackFor(s, target)
  if (track || (play.armed && play.playing)) {
    setKey(target, play.time, v, play.armed && play.playing ? 'Record' : 'Set key')
    return true
  }
  return false
}

// ---- transport -----------------------------------------------------------------

export function playPause() {
  if (play.playing) flushRecording()
  else {
    sent.clear()
    // Start inside the work area.
    const [a, b] = workArea(timelineOf(getCreate().scene))
    if (play.time < a || play.time >= b - 1e-3) play = { ...play, time: a }
  }
  setPlay({ playing: !play.playing })
}
export function stop() {
  flushRecording()
  setPlay({ playing: false, time: 0 })
}
export function seek(t: number) {
  const tl = timelineOf(getCreate().scene)
  if (!play.playing) sent.clear()
  setPlay({ time: Math.max(0, Math.min(tl.duration, t)) })
}
export function setScrubbing(on: boolean) {
  setPlay({ scrubbing: on })
}
export function arm(on: boolean) {
  if (!on) flushRecording()
  setPlay({ armed: on })
}

// ---- recording linked settings -----------------------------------------------
// While Rec is on and the timeline plays, every setting linked to a knob,
// an OSC address or the audio is written down; the keys land in one undo step.

const recorded = new Map<string, Key[]>()
let lastSample = -1

function sampleLinked(t: number) {
  const s = getCreate().scene
  const tl = timelineOf(s)
  if (t - lastSample < 1 / Math.min(15, tl.fps) && t >= lastSample) return
  lastSample = t
  const r = getRenderer()
  if (!r) return
  const visit = (owner: string, values: Record<string, number | string>, bindings: Scene['master']['bindings']) => {
    for (const [key, b] of Object.entries(bindings)) {
      if (!b?.signal) continue
      const v = r.liveValue(owner, key, Number(values[key] ?? 0), b)
      const target = `${owner}.${key}`
      if (!recorded.has(target)) recorded.set(target, [])
      recorded.get(target)!.push({ t, v, ease: 'linear' })
    }
  }
  for (const l of s.layers) visit(l.id, { ...l.values, opacity: l.opacity }, l.bindings)
  visit('master', s.master.values, s.master.bindings)
}

function flushRecording() {
  if (!recorded.size) return
  const takes = new Map(recorded)
  recorded.clear()
  lastSample = -1
  changeTimeline('Record', (tl) => {
    const tracks = [...tl.tracks]
    for (const [target, keys] of takes) {
      if (keys.length < 2) continue
      const lo = keys[0].t, hi = keys[keys.length - 1].t
      const i = tracks.findIndex((x) => x.target === target)
      const kept = i >= 0 ? tracks[i].keys.filter((k) => k.t < lo || k.t > hi) : []
      const merged = { target, keys: sortKeys([...kept, ...keys]) }
      if (i >= 0) tracks[i] = merged
      else tracks.push(merged)
    }
    return { ...tl, tracks }
  })
}
export function stepFrames(n: number) {
  const tl = timelineOf(getCreate().scene)
  seek(play.time + n / tl.fps)
}

// Applies the timeline at time t: keyed settings, and the time shaders see.
const keyed = new Set<string>()
export function applyAt(t: number, takeTime: boolean) {
  const s = getCreate().scene
  const tl = timelineOf(s)
  const now = new Set<string>()
  for (const tr of tl.tracks) {
    const v = valueAt(tr, t)
    if (v === undefined) continue
    driven.set(tr.target, v)
    now.add(tr.target)
  }
  for (const k of keyed) if (!now.has(k)) driven.delete(k)
  keyed.clear()
  now.forEach((k) => keyed.add(k))
  const r = getRenderer()
  if (r) r.timeOverride = takeTime ? t : null
}

let last = performance.now()
let exporting = false
export const setExporting = (on: boolean) => { exporting = on }

onFrame((now) => {
  const dt = Math.min(0.1, (now - last) / 1000)
  last = now
  if (exporting) return
  const tl = timelineOf(getCreate().scene)
  if (play.playing) {
    const [a, b] = workArea(tl)
    const before = play.time
    let t = play.time + dt
    if (play.armed) sampleLinked(play.time)
    let wrapped = false
    if (t >= b) {
      if (play.armed) flushRecording()
      if (tl.loop && !play.armed) { t = a + ((t - a) % Math.max(0.001, b - a)); wrapped = true }
      else { t = b; play = { ...play, playing: false } }
    }
    // Cues the playhead went over in this frame.
    for (const c of tl.cues ?? []) {
      if (wrapped ? (c.t > before && c.t <= b) || (c.t >= a && c.t <= t) : c.t > before && c.t <= t) fireCue(c)
    }
    play = { ...play, time: t }
    emit()
  }
  if (play.playing || play.scrubbing) {
    for (const o of tl.outTracks ?? []) {
      if (o.muted || !o.keys.length) continue
      const v = valueAt({ target: o.id, keys: o.keys }, play.time)
      if (v !== undefined) sendOut(o, v)
    }
  }
  // Stopped at the very start means live: shaders run on their own clock.
  applyAt(play.time, play.playing || play.scrubbing || play.time > 0)
})

export function formatTime(t: number, fps: number) {
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  const f = Math.floor((t % 1) * fps)
  return `${m}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`
}

// ---- how time is shown: timecode, frames or seconds ----

export type TimeUnits = 'tc' | 'frames' | 'sec'
const pad2 = (n: number) => String(n).padStart(2, '0')
export function formatUnits(t: number, fps: number, u: TimeUnits): string {
  const fr = Math.round(t * fps)
  if (u === 'frames') return String(fr).padStart(5, '0')
  if (u === 'sec') return `${t.toFixed(2)}s`
  const f = fr % Math.round(fps), all = Math.floor(fr / Math.round(fps))
  return `${Math.floor(all / 3600)}:${pad2(Math.floor(all / 60) % 60)}:${pad2(all % 60)}:${pad2(f)}`
}
// A short label for the ruler.
export function rulerLabel(t: number, fps: number, u: TimeUnits, step: number): string {
  const fr = Math.round(t * fps)
  if (u === 'frames') return String(fr)
  if (u === 'sec') return step < 1 ? `${+t.toFixed(2)}s` : `${Math.round(t)}s`
  const all = Math.floor(fr / Math.round(fps)), f = fr % Math.round(fps)
  const base = `${Math.floor(all / 60)}:${pad2(all % 60)}`
  return step < 1 ? `${base}:${pad2(f)}` : `${base}s`
}
// Ruler steps that keep labels about `px` apart: frames first, then seconds.
export function rulerStep(pps: number, fps: number, u: TimeUnits, px = 80): { major: number; minor: number } {
  const steps = u === 'frames'
    ? [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000].map((f) => f / fps)
    : [1, 2, 5, 10].map((f) => f / fps).concat([0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200])
  const major = steps.find((s) => s * pps >= px) ?? steps[steps.length - 1]
  const div = [10, 5, 4, 2].find((d) => (major / d) * pps >= 8 && Math.abs(Math.round((major / d) * fps) - (major / d) * fps) < 1e-6) ?? 1
  return { major, minor: major / div }
}
