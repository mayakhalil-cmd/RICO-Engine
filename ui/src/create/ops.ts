import { toast } from '../components/Toasts'
import { effectType } from './effects'
import { TRANSFORM_PARAMS, layerType } from './layers'
import { defaults, maskPointsAt, newId, newLayer, type Binding, type Effect, type Layer, type Mask, type Scene } from './scene'
import { changeScene, getCreate, listComps, newComp, select } from './store'
import { captureValue, getPlay, timelineOf, trackFor, valueAt } from './timeline'

// Everything you can do to layers, in one place, so the timeline, the
// inspector, the preview tools and the keyboard shortcuts all agree.

// ---- reading and writing any setting by key ----
//   opacity, tr_px (transform), a layer setting, m0_feather (mask 0),
//   fx_<effect id>_<setting> (an effect)

export function baseValue(l: Layer, key: string): number {
  if (key === 'opacity') return l.opacity
  const m = /^m(\d+)_(\w+)$/.exec(key)
  if (m) return Number((l.masks?.[Number(m[1])] as unknown as Record<string, number> | undefined)?.[m[2]] ?? 0)
  const f = /^fx_([^_]+)_(.+)$/.exec(key)
  if (f) {
    const e = l.effects?.find((x) => x.id === f[1])
    const p = e && effectType(e.type)?.params.find((x) => x.key === f[2])
    return Number(e?.values[f[2]] ?? p?.default ?? 0)
  }
  const p = [...TRANSFORM_PARAMS, ...layerType(l.type).params].find((x) => x.key === key)
  return Number(l.values[key] ?? p?.default ?? 0)
}

export function withValue(l: Layer, key: string, v: number | string): Layer {
  if (key === 'opacity') return { ...l, opacity: Number(v) }
  const m = /^m(\d+)_(\w+)$/.exec(key)
  if (m) return { ...l, masks: (l.masks ?? []).map((x, i) => (i === Number(m[1]) ? { ...x, [m[2]]: Number(v) } : x)) }
  const f = /^fx_([^_]+)_(.+)$/.exec(key)
  if (f) return { ...l, effects: (l.effects ?? []).map((e) => (e.id === f[1] ? { ...e, values: { ...e.values, [f[2]]: v } } : e)) }
  return { ...l, values: { ...l.values, [key]: v } }
}

// The value right now: animated settings follow the timeline.
export function currentValue(scene: Scene, l: Layer, key: string): number {
  const tr = trackFor(scene, `${l.id}.${key}`)
  return tr ? valueAt(tr, getPlay().time) ?? baseValue(l, key) : baseValue(l, key)
}

export function updateLayer(id: string, label: string, fn: (l: Layer) => Layer, mergeKey?: string) {
  changeScene(label, (s) => ({ ...s, layers: s.layers.map((l) => (l.id === id ? fn(l) : l)) }), mergeKey)
}

// Sets a setting the way a slider does: animated settings get a key.
export function setProp(id: string, key: string, v: number, label = 'Change') {
  if (captureValue(`${id}.${key}`, v)) return
  updateLayer(id, label, (l) => withValue(l, key, v), `${id}.${key}`)
}

export function setBinding(id: string, key: string, b: Binding | undefined) {
  updateLayer(id, b ? 'Link' : 'Unlink', (l) => {
    const next = { ...l.bindings }
    if (b) next[key] = b
    else delete next[key]
    return { ...l, bindings: next }
  }, `${id}.link.${key}`)
}

// ---- units: the interface shows pixels, percent and degrees ----

export const toPxX = (s: Scene, u: number) => s.width / 2 + u * s.height
export const toPxY = (s: Scene, u: number) => s.height / 2 - u * s.height
export const fromPxX = (s: Scene, px: number) => (px - s.width / 2) / s.height
export const fromPxY = (s: Scene, px: number) => (s.height / 2 - px) / s.height

// ---- adding layers ----

const selectedLayer = () => {
  const { scene, selected } = getCreate()
  return scene.layers.find((l) => l.id === selected)
}

// New layers go right above the selected one (or on top), like in AE.
export function insertLayer(l: Layer, label = `Add ${l.name}`) {
  const sel = selectedLayer()
  const t = getPlay().time
  if (t > 0 && l.start === undefined) {
    l.start = t
    l.end = timelineOf(getCreate().scene).duration
  }
  changeScene(label, (s) => {
    const i = sel ? s.layers.findIndex((x) => x.id === sel.id) : -1
    const layers = [...s.layers]
    layers.splice(i >= 0 ? i + 1 : layers.length, 0, l)
    return { ...s, layers }
  })
  select(l.id)
  return l.id
}

export function newSolid(color = '#f820a0') {
  const l = newLayer('solid')
  const n = getCreate().scene.layers.filter((x) => x.type === 'solid').length + 1
  l.name = `Solid ${n}`
  l.values = { ...l.values, color }
  return insertLayer(l)
}
export function newNull() {
  const l = newLayer('null')
  l.name = `Null ${getCreate().scene.layers.filter((x) => x.type === 'null').length + 1}`
  return insertLayer(l)
}
export function newAdjustment() {
  const l = newLayer('adjust')
  l.name = `Adjustment layer ${getCreate().scene.layers.filter((x) => x.type === 'adjust').length + 1}`
  l.effects = [newEffect('grade')]
  return insertLayer(l)
}
export function newText(text = 'Text') {
  const l = newLayer('text')
  l.values = { ...l.values, text, x: 0.5, y: 0.5 }
  l.name = text
  return insertLayer(l)
}
export function newShape(kind = 0, w = 0.5, h = 0.5, x = 0, y = 0) {
  const l = newLayer('vshape')
  l.name = `Shape layer ${getCreate().scene.layers.filter((x2) => x2.type === 'vshape').length + 1}`
  l.values = { ...l.values, kind, w, h, tr_px: x, tr_py: y }
  return insertLayer(l)
}

// ---- layer edits ----

const copyOf = (l: Layer): Layer => {
  const id = newId()
  return { ...JSON.parse(JSON.stringify(l)), id, name: /\d+$/.test(l.name) ? l.name.replace(/\d+$/, (n) => String(Number(n) + 1)) : `${l.name} 2` }
}

export function duplicateLayer(id = getCreate().selected) {
  const s = getCreate().scene
  const l = s.layers.find((x) => x.id === id)
  if (!l) return
  const c = copyOf(l)
  changeScene(`Duplicate ${l.name}`, (sc) => {
    const i = sc.layers.findIndex((x) => x.id === l.id)
    const layers = [...sc.layers]
    layers.splice(i + 1, 0, c)
    // Animated settings come along.
    const tl = timelineOf(sc)
    const tracks = tl.tracks.filter((t) => t.target.startsWith(`${l.id}.`)).map((t) => ({ ...t, target: `${c.id}.${t.target.slice(l.id.length + 1)}` }))
    return { ...sc, layers, timeline: { ...tl, tracks: [...tl.tracks, ...tracks] } }
  })
  select(c.id)
}

// Ctrl+Shift+D: cuts the layer at the playhead into two layers.
export function splitLayer(id = getCreate().selected) {
  const s = getCreate().scene
  const l = s.layers.find((x) => x.id === id)
  const t = getPlay().time
  if (!l) return
  const start = l.start ?? 0, end = l.end ?? timelineOf(s).duration
  if (t <= start + 1e-3 || t >= end - 1e-3) return toast('Move the playhead inside the layer to split it.')
  const second = copyOf(l)
  second.name = l.name
  second.start = t
  second.end = end
  changeScene(`Split ${l.name}`, (sc) => {
    const i = sc.layers.findIndex((x) => x.id === l.id)
    const layers = sc.layers.map((x) => (x.id === l.id ? { ...x, start, end: t } : x))
    layers.splice(i + 1, 0, second)
    const tl = timelineOf(sc)
    const tracks = tl.tracks.filter((tr) => tr.target.startsWith(`${l.id}.`)).map((tr) => ({ ...tr, target: `${second.id}.${tr.target.slice(l.id.length + 1)}` }))
    return { ...sc, layers, timeline: { ...tl, tracks: [...tl.tracks, ...tracks] } }
  })
  select(second.id)
}

export function deleteLayer(id = getCreate().selected) {
  const l = getCreate().scene.layers.find((x) => x.id === id)
  if (!l) return
  changeScene(`Delete ${l.name}`, (s) => {
    const tl = timelineOf(s)
    return {
      ...s,
      layers: s.layers.filter((x) => x.id !== id).map((x) => (x.parent === id ? { ...x, parent: undefined } : x)),
      timeline: { ...tl, tracks: tl.tracks.filter((t) => !t.target.startsWith(`${id}.`)) },
    }
  })
  select(null)
}

// AE order: Ctrl+] forward, Ctrl+[ backward, with Shift to the top or bottom.
export function restack(how: 'up' | 'down' | 'top' | 'bottom', id = getCreate().selected) {
  changeScene('Change layer order', (s) => {
    const i = s.layers.findIndex((x) => x.id === id)
    if (i < 0) return s
    const layers = [...s.layers]
    const [l] = layers.splice(i, 1)
    const to = how === 'up' ? i + 1 : how === 'down' ? i - 1 : how === 'top' ? layers.length : 0
    layers.splice(Math.max(0, Math.min(layers.length, to)), 0, l)
    return { ...s, layers }
  })
}

// [ and ]: move the layer so it starts (or ends) at the playhead.
// Alt+[ and Alt+]: trim it there.
export function layerTimeAtPlayhead(edge: 'in' | 'out', trim: boolean, id = getCreate().selected) {
  const s = getCreate().scene
  const l = s.layers.find((x) => x.id === id)
  if (!l) return
  const t = getPlay().time
  const dur = timelineOf(s).duration
  const a = l.start ?? 0, b = l.end ?? dur
  let start = a, end = b
  if (trim) {
    if (edge === 'in') start = Math.min(t, b - 0.05)
    else end = Math.max(t, a + 0.05)
  } else if (edge === 'in') { start = t; end = t + (b - a) } else { end = t; start = t - (b - a) }
  updateLayer(l.id, trim ? 'Trim layer' : 'Move layer', (x) => ({ ...x, start: Math.max(0, start), end: Math.max(0.05, end) }))
}

export function fitToComp(id = getCreate().selected) {
  updateLayer(id ?? '', 'Fit to scene', (l) => ({ ...l, values: { ...l.values, ...defaults(TRANSFORM_PARAMS) } }))
}

// ---- effects and masks ----

export function newEffect(type: string): Effect {
  const t = effectType(type)
  return { id: newId(), type, on: true, values: Object.fromEntries((t?.params ?? []).map((p) => [p.key, p.default])) }
}

// owner: a layer id, or 'master' for the whole picture.
export function changeEffects(owner: string, label: string, fn: (list: Effect[]) => Effect[], mergeKey?: string) {
  if (owner === 'master') changeScene(label, (s) => ({ ...s, master: { ...s.master, effects: fn(s.master.effects ?? []) } }), mergeKey)
  else updateLayer(owner, label, (l) => ({ ...l, effects: fn(l.effects ?? []) }), mergeKey)
}

export function addEffect(owner: string, type: string) {
  const e = newEffect(type)
  changeEffects(owner, `Add ${effectType(type)?.name ?? 'effect'}`, (list) => [...list, e])
  return e.id
}

export function newMask(kind: Mask['kind'], part: Partial<Mask> = {}): Mask {
  return { id: newId(), name: 'Mask', kind, mode: 0, x: 0, y: 0, w: 0.6, h: 0.6, feather: 0, expand: 0, opacity: 1, on: true, ...part }
}

export function addMask(id: string, m: Mask) {
  updateLayer(id, 'Add mask', (l) => {
    const masks = l.masks ?? []
    if (masks.length >= 4) { toast('A layer can have 4 masks.'); return l }
    return { ...l, masks: [...masks, { ...m, name: `Mask ${masks.length + 1}` }] }
  })
}

// Moves a mask path. With rotoscoping keys, the change becomes a key at the
// playhead (made or updated), so the shape can follow something over time.
export function setMaskPoints(id: string, index: number, points: [number, number][], mergeKey?: string) {
  const t = getPlay().time
  changeMasks(id, 'Edit mask path', (list) => list.map((m, i) => {
    if (i !== index) return m
    if (!m.pathKeys?.length) return { ...m, points }
    const keys = m.pathKeys.filter((k) => Math.abs(k.t - t) > 1 / 120)
    keys.push({ t, points })
    keys.sort((a, b) => a.t - b.t)
    return { ...m, points, pathKeys: keys }
  }), mergeKey)
}

// The stopwatch on a mask path: first press starts keying (a key at the
// playhead), later presses add a key here or remove the one that is here.
export function toggleMaskPathKey(id: string, index: number) {
  const t = getPlay().time
  changeMasks(id, 'Mask path key', (list) => list.map((m, i) => {
    if (i !== index) return m
    const cur = maskPointsAt(m, t)
    const keys = m.pathKeys ?? []
    const here = keys.find((k) => Math.abs(k.t - t) <= 1 / 120)
    if (here) {
      const rest = keys.filter((k) => k !== here)
      return { ...m, points: cur, pathKeys: rest.length ? rest : undefined }
    }
    return { ...m, points: cur, pathKeys: [...keys, { t, points: cur.map((p) => [p[0], p[1]] as [number, number]) }].sort((a, b) => a.t - b.t) }
  }))
}

export function clearMaskPathKeys(id: string, index: number) {
  const t = getPlay().time
  changeMasks(id, 'Stop keying the mask path', (list) => list.map((m, i) => (i === index ? { ...m, points: maskPointsAt(m, t), pathKeys: undefined } : m)))
}

export function changeMasks(id: string, label: string, fn: (list: Mask[]) => Mask[], mergeKey?: string) {
  updateLayer(id, label, (l) => ({ ...l, masks: fn(l.masks ?? []) }), mergeKey)
}

// ---- precomps ----

/** A layer that shows another composition. */
export function addPrecompLayer(compId: string) {
  const c = listComps().find((x) => x.id === compId)
  if (!c) return
  const l = newLayer('precomp')
  l.name = c.name
  l.values = { ...l.values, comp: compId }
  insertLayer(l, `Add ${c.name}`)
}

/**
 * Pre-compose: the picked layers (or the selected one) move into a new
 * composition, with their keys, and one layer showing it takes their place.
 */
export function precompose(ids?: string[]) {
  const scene = getCreate().scene
  const pick = ids?.length ? ids : getCreate().selected ? [getCreate().selected!] : []
  const layers = scene.layers.filter((l) => pick.includes(l.id))
  if (!layers.length) { toast('Select a layer to pre-compose.'); return }
  const tl = timelineOf(scene)
  const own = (target: string) => pick.some((id) => target.startsWith(`${id}.`))
  const name = layers.length === 1 ? `${layers[0].name} comp` : `Precomp ${(Object.keys(scene.comps ?? {}).length) + 1}`
  const compId = newComp(name, layers.map((l) => ({ ...l })), tl.tracks.filter((t) => own(t.target)))
  const l = newLayer('precomp')
  l.name = name
  l.values = { ...l.values, comp: compId }
  const at = Math.max(...layers.map((x) => scene.layers.indexOf(x)))
  changeScene('Pre-compose', (s) => {
    const rest = s.layers.filter((x) => !pick.includes(x.id))
    const before = s.layers.slice(0, at + 1).filter((x) => !pick.includes(x.id)).length
    rest.splice(before, 0, l)
    return { ...s, layers: rest, timeline: { ...timelineOf(s), tracks: timelineOf(s).tracks.filter((t) => !own(t.target)) } }
  })
  select(l.id)
  toast(`${name} made. Double-click it on the timeline to open it.`, true)
}

// ---- editing like a video editor ----

/** Ripple delete: takes the layer out and moves everything after it back to close the gap. */
export function rippleDelete(id = getCreate().selected) {
  const l = getCreate().scene.layers.find((x) => x.id === id)
  if (!l) return
  const s0 = l.start ?? 0
  const len = (l.end ?? timelineOf(getCreate().scene).duration) - s0
  if (l.start === undefined) { deleteLayer(id); return }
  changeScene(`Ripple delete ${l.name}`, (s) => {
    const tl = timelineOf(s)
    const shift = (t: number) => (t >= s0 + len - 1e-6 ? t - len : t)
    const moved = new Set(s.layers.filter((x) => x.id !== id && x.start !== undefined && x.start >= s0 + len - 1e-6).map((x) => x.id))
    return {
      ...s,
      layers: s.layers.filter((x) => x.id !== id).map((x) => (moved.has(x.id) ? { ...x, start: (x.start ?? 0) - len, end: x.end !== undefined ? x.end - len : x.end } : x.parent === id ? { ...x, parent: undefined } : x)),
      timeline: { ...tl, tracks: tl.tracks.filter((t) => !t.target.startsWith(`${id}.`)).map((t) => (moved.has(t.target.split('.')[0]) ? { ...t, keys: t.keys.map((k) => ({ ...k, t: shift(k.t) })) } : t)) },
    }
  })
  select(null)
}

/** Close gap: moves the layers that start after the playhead back to the end of the layer before them. */
export function closeGapAt(t = getPlay().time) {
  const scene = getCreate().scene
  const timed = scene.layers.filter((x) => x.start !== undefined)
  const before = timed.filter((x) => (x.end ?? 0) <= t + 1e-6).reduce((m, x) => Math.max(m, x.end ?? 0), 0)
  const after = timed.filter((x) => (x.start ?? 0) >= t - 1e-6)
  if (!after.length) return
  const first = Math.min(...after.map((x) => x.start ?? 0))
  const d = first - before
  if (d <= 1e-6) return
  const ids = new Set(after.map((x) => x.id))
  changeScene('Close gap', (s) => {
    const tl = timelineOf(s)
    return {
      ...s,
      layers: s.layers.map((x) => (ids.has(x.id) ? { ...x, start: (x.start ?? 0) - d, end: x.end !== undefined ? x.end - d : x.end } : x)),
      timeline: { ...tl, tracks: tl.tracks.map((tr) => (ids.has(tr.target.split('.')[0]) ? { ...tr, keys: tr.keys.map((k) => ({ ...k, t: k.t - d })) } : tr)) },
    }
  })
}
