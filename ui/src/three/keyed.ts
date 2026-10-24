import { SYM_NUMS, symOf } from './symbioteParams'
import { driven } from '../create/renderer'
import { FLUID_DEFAULT, FOG_DEFAULT, LINKABLE, PHYSICS_DEFAULT, isLight, type MatLayer, type Obj3D, type World3D } from './world'

// Keys on the timeline for everything in 3D that has a number: each
// deformer, the morph, physics and breaking, the liquid, fog, and every layer
// of the object's look. The timeline writes the values ("3d:<id>.<path>"),
// this puts them on the object for that frame. Top level settings (move,
// turn, size, glow, morph...) are read where they are used, through links.

export interface Anim { key: string; label: string; min: number; max: number; value: number; group: string }

const NESTED = /^(deform|physics|fluid|fog|layer|morphx|symbx)\./

// The values the timeline drives for each object, nested ones only.
export function keysOf(id: string): [string, number][] {
  const out: [string, number][] = []
  const pre = `3d:${id}.`
  for (const [k, v] of driven) if (k.startsWith(pre)) { const path = k.slice(pre.length); if (NESTED.test(path)) out.push([path, v]) }
  return out
}

// The object as the timeline has it right now (the same object when nothing is keyed).
export function withKeys(o: Obj3D, keys = keysOf(o.id)): Obj3D {
  if (!keys.length) return o
  let n: Obj3D = { ...o }
  for (const [path, v] of keys) {
    const [head, a, b] = path.split('.')
    if (head === 'deform' && n.deform) n = { ...n, deform: n.deform.map((d) => (d.id === a ? { ...d, [b]: v } : d)) }
    else if (head === 'physics') n = { ...n, physics: { ...PHYSICS_DEFAULT, ...(n.physics ?? {}), [a]: v } }
    else if (head === 'fluid') n = { ...n, fluid: { ...FLUID_DEFAULT, ...(n.fluid ?? {}), [a]: v } }
    else if (head === 'fog') n = { ...n, fog: { ...FOG_DEFAULT, ...(n.fog ?? {}), [a]: v } }
    else if (head === 'morphx' && n.morph) n = { ...n, morph: { ...n.morph, [a]: v } }
    else if (head === 'symbx' && n.symbiote) n = { ...n, symbiote: { ...n.symbiote, [a]: v } }
  }
  return n
}

// A material's layers with this object's keys on them (each object keeps its own).
export function layersWithKeys(id: string, layers: MatLayer[]): MatLayer[] {
  const keys = keysOf(id).filter(([p]) => p.startsWith('layer.'))
  if (!keys.length) return layers
  return layers.map((l) => {
    let x = l
    for (const [p, v] of keys) { const [, lid, f] = p.split('.'); if (lid === l.id) x = { ...x, [f]: v } }
    return x
  })
}

const LAYER_FIELDS: [keyof MatLayer, string, number, number][] = [['amount', 'amount', 0, 2], ['scale', 'size', 0.1, 10], ['speed', 'speed', 0, 10], ['thick', 'line thickness', 0.1, 4], ['lift', 'lift', 0, 1], ['crumple', 'crumple', 0, 1]]
const KIND: Record<string, string> = { bend: 'Bend', twist: 'Twist', taper: 'Taper', squash: 'Squash', wave: 'Wave' }

// Everything of one object you can put keys on, by group.
export function animatables(o: Obj3D, w: World3D): Anim[] {
  const out: Anim[] = []
  const flat = (key: string, value: number) => { const l = LINKABLE.find((x) => x.key === key); if (l) out.push({ key, label: l.label, min: l.min, max: l.max, value, group: 'Object' }) }
  flat('position.x', o.position[0]); flat('position.y', o.position[1]); flat('position.z', o.position[2])
  flat('rotation.x', o.rotation[0]); flat('rotation.y', o.rotation[1]); flat('rotation.z', o.rotation[2])
  flat('scale', 1); flat('spin', o.spin)
  if (isLight(o.kind)) flat('intensity', o.intensity)
  else { flat('glow', o.glow); flat('hue', 0) }
  if (o.kind === 'model') { flat('animSpeed', o.animSpeed ?? 1); flat('animPos', o.animPos ?? 0) }
  if (o.material === 'shader' || o.kind === 'math-surface' || o.kind === 'math-solid' || o.kind === 'code-shape') { flat('a', o.a ?? 0); flat('b', o.b ?? 0) }
  if (o.material === 'picture') flat('uvSpeed', o.uvSpeed ?? 0)
  for (const d of o.deform ?? []) {
    out.push({ key: `deform.${d.id}.amount`, label: `${KIND[d.kind] ?? d.kind} amount`, min: -2, max: 2, value: d.amount, group: 'Deform' })
    if (d.kind === 'wave') {
      out.push({ key: `deform.${d.id}.freq`, label: 'Wave count', min: 0.2, max: 10, value: d.freq ?? 2, group: 'Deform' })
      out.push({ key: `deform.${d.id}.speed`, label: 'Wave speed', min: -4, max: 4, value: d.speed ?? 1, group: 'Deform' })
    }
  }
  if (o.deform?.length) out.push({ key: 'deform', label: 'All deformers', min: 0, max: 2, value: 1, group: 'Deform' })
  if (o.morph) {
    out.push({ key: 'morph', label: 'Morph', min: 0, max: 1, value: o.morph.amount, group: 'Morph' })
    if ((o.morph.style ?? 'fluid') === 'fluid') {
      out.push({ key: 'morphx.goo', label: 'Goo', min: 0, max: 1, value: o.morph.goo ?? 0.6, group: 'Morph' })
      out.push({ key: 'morphx.spread', label: 'Spread', min: 0, max: 1, value: o.morph.spread ?? 0.6, group: 'Morph' })
      out.push({ key: 'morphx.speed', label: 'Flow speed', min: 0, max: 4, value: o.morph.speed ?? 0.6, group: 'Morph' })
    }
  }
  if (o.symbiote) {
    const sy = symOf(o.symbiote)
    for (const p of SYM_NUMS) if (p.keyable) out.push({ key: `symbx.${p.key}`, label: p.label.replace(/ \(.*\)$/, ''), min: p.min, max: p.max, value: Number(sy[p.key] ?? 0), group: 'Symbiote' })
  }
  if (o.physics) {
    const p = { ...PHYSICS_DEFAULT, ...o.physics }
    out.push({ key: 'physics.bounce', label: 'Bounce', min: 0, max: 1, value: p.bounce, group: 'Physics' })
    out.push({ key: 'physics.friction', label: 'Friction', min: 0, max: 1, value: p.friction, group: 'Physics' })
    out.push({ key: 'physics.mass', label: 'Weight', min: 0.1, max: 10, value: p.mass, group: 'Physics' })
    if ((p.pieces ?? 0) > 1) out.push({ key: 'physics.blast', label: 'Blast', min: 0, max: 10, value: p.blast ?? 2, group: 'Physics' })
  }
  if (o.kind === 'fluid') out.push({ key: 'fluid.thick', label: 'Thick or thin', min: 0, max: 1, value: { ...FLUID_DEFAULT, ...(o.fluid ?? {}) }.thick, group: 'Liquid' })
  if (o.kind === 'fog') {
    const f = { ...FOG_DEFAULT, ...(o.fog ?? {}) }
    out.push({ key: 'fogDensity', label: 'Density', min: 0, max: 4, value: f.density, group: 'Fog' })
    for (const [k, l, lo, hi] of [['noise', 'Clumps', 0, 1], ['scale', 'Clump size', 0.2, 6], ['speed', 'Drift', 0, 1], ['glow', 'Glow', 0, 2], ['height', 'Height fade', 0, 1]] as const) out.push({ key: `fog.${k}`, label: l, min: lo, max: hi, value: f[k], group: 'Fog' })
  }
  const matId = o.material === 'custom' ? o.matId : o.parts?.['*']?.matId
  const layers = matId ? w.materials?.find((m) => m.id === matId)?.layers ?? [] : []
  if (layers.length) {
    flat('lookSize', 1); flat('lookThick', 1); flat('drive', 1); flat('boil', 0)
    layers.forEach((l, i) => {
      for (const [f, label, lo, hi] of LAYER_FIELDS) {
        if (l[f] === undefined && f !== 'amount' && f !== 'scale' && f !== 'speed') continue
        out.push({ key: `layer.${l.id}.${f}`, label: `${i + 1}. ${l.kind} ${label}`, min: lo, max: hi, value: Number(l[f] ?? 0), group: 'Look layers' })
      }
    })
  }
  return out
}

// Typing a number for a setting that is not animated changes the setting
// itself. Some settings only exist on the timeline (size, hue and the look
// multipliers): those start a key instead (returns false).
export function setAnimValue(o: Obj3D, key: string, v: number, update: (id: string, part: Partial<Obj3D>, label: string, merge: string) => void, setLayer: (matId: string, layerId: string, part: Partial<MatLayer>) => void): boolean {
  const [head, a, b] = key.split('.')
  const merge = `${o.id}.${key}`
  if (head === 'position' || head === 'rotation') {
    const arr = [...o[head]] as [number, number, number]
    arr['xyz'.indexOf(a)] = v
    update(o.id, { [head]: arr }, head === 'position' ? 'Move' : 'Turn', merge)
    return true
  }
  if (head === 'deform' && o.deform) { update(o.id, { deform: o.deform.map((d) => (d.id === a ? { ...d, [b]: v } : d)) }, 'Deform', merge); return true }
  if (head === 'morph' && o.morph) { update(o.id, { morph: { ...o.morph, amount: v } }, 'Morph', merge); return true }
  if (head === 'morphx' && o.morph) { update(o.id, { morph: { ...o.morph, [a]: v } }, 'Morph', merge); return true }
  if (head === 'symbx' && o.symbiote) { update(o.id, { symbiote: { ...o.symbiote, [a]: v } }, 'Symbiote', merge); return true }
  if (head === 'physics') { update(o.id, { physics: { ...PHYSICS_DEFAULT, ...(o.physics ?? {}), [a]: v } }, 'Physics', merge); return true }
  if (head === 'fluid') { update(o.id, { fluid: { ...FLUID_DEFAULT, ...(o.fluid ?? {}), [a]: v } }, 'Liquid', merge); return true }
  if (head === 'fog') { update(o.id, { fog: { ...FOG_DEFAULT, ...(o.fog ?? {}), [a]: v } }, 'Fog', merge); return true }
  if (head === 'fogDensity') { update(o.id, { fog: { ...FOG_DEFAULT, ...(o.fog ?? {}), density: v } }, 'Fog', merge); return true }
  if (head === 'layer') {
    const matId = o.material === 'custom' ? o.matId : o.parts?.['*']?.matId
    if (!matId) return false
    setLayer(matId, a, { [b]: v } as Partial<MatLayer>)
    return true
  }
  if (['spin', 'glow', 'intensity', 'a', 'b', 'uvSpeed', 'animSpeed', 'animPos'].includes(head)) { update(o.id, { [head]: v } as Partial<Obj3D>, 'Change', merge); return true }
  return false
}
