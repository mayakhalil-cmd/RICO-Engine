import { useSyncExternalStore } from 'react'
import { goboOptions, MOUNTS, planGobo, type GoboOptions, type GoboPick, type GoboPlan } from './gobo'
import { getMap, knownOutputs, outputName } from './model'

// Your gobos: plates that go in front of a projector. Each gobo belongs to one
// projector (an output) and takes the masks you see on that projector. You
// can leave masks out of a gobo, so five projectors can each get their own
// gobo with their own mask. The Print and Laser tabs read this list, so a
// gobo you change here is ready to print there right away.

export interface Gobo extends GoboPick {
  id: string
  name: string
  out: string             // the projector (output) it goes on
  opts: GoboOptions
}

const KEY = 'rico.gobos'
const OLD = 'rico.gobo'
let list: Gobo[] | null = null
let version = 0
const listeners = new Set<() => void>()
const rid = () => `g${Math.random().toString(36).slice(2, 8)}`

function load(): Gobo[] {
  if (list) return list
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Gobo[] | null
    if (Array.isArray(raw)) list = raw.map((g) => ({ ...newGobo(g.out ?? 'out1'), ...g, opts: goboOptions(g.opts) }))
  } catch { /* start fresh */ }
  if (!list) {
    // The settings of the stencil maker before there was a list.
    let opts: GoboOptions | undefined
    try { const o = JSON.parse(localStorage.getItem(OLD) ?? 'null'); if (o) opts = goboOptions(o) } catch { /* defaults */ }
    list = []
    for (const out of knownOutputs().length ? knownOutputs() : ['out1']) list.push(newGobo(out, opts))
  }
  return list
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(list)) } catch { /* not kept */ }
  version++
  listeners.forEach((l) => l())
}

export function newGobo(out: string, opts?: GoboOptions, part: Partial<Gobo> = {}): Gobo {
  const map = getMap(out)
  return {
    id: rid(), name: `Gobo for ${outputName(out)}`, out,
    mode: map.masks.some((m) => m.on) ? 'masks' : 'projection', skip: [], sizes: {}, offsets: {},
    opts: goboOptions({ ...(opts ?? {}), layout: 'mapping' }),
    ...part,
  }
}

export const getGobos = () => load()
export function useGobos(): Gobo[] {
  useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => version)
  return load()
}
export const onGobos = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

export function addGobo(g: Gobo) { list = [...load(), g]; save(); return g }
export function updateGobo(id: string, part: Partial<Gobo>) { list = load().map((g) => (g.id === id ? { ...g, ...part } : g)); save() }
export function setGoboOpts(id: string, part: Partial<GoboOptions>) {
  list = load().map((g) => (g.id === id ? { ...g, opts: { ...g.opts, ...part } } : g)); save()
}
export function removeGobo(id: string) { list = load().filter((g) => g.id !== id); save() }

// Every projector that has no gobo yet gets one.
export function goboPerProjector() {
  const have = new Set(load().map((g) => g.out))
  const base = load()[0]?.opts
  const add = knownOutputs().filter((o) => !have.has(o)).map((o) => newGobo(o, base))
  if (add.length) { list = [...load(), ...add]; save() }
  return add.length
}

// One gobo for each mask of this gobo's projector: each takes one mask only.
export function goboPerMask(id: string) {
  const g = load().find((x) => x.id === id)
  if (!g) return 0
  const masks = getMap(g.out).masks.filter((m) => m.on && m.points.length >= 3)
  if (!masks.length) return 0
  const made = masks.map((m) => newGobo(g.out, g.opts, { name: `Gobo ${m.name}`, mode: 'masks', skip: masks.filter((x) => x.id !== m.id).map((x) => x.id) }))
  list = [...load().filter((x) => x.id !== id), ...made]
  save()
  return made.length
}

export function applyMount(id: string, mountId: string) {
  const m = MOUNTS.find((x) => x.id === mountId)
  if (m) setGoboOpts(id, { ...m.part, mount: m.id })
}

// The plate of a gobo, in millimetres (see gobo.ts).
export function goboPlan(g: Gobo): GoboPlan {
  const map = getMap(g.out)
  return planGobo(map, { ...g.opts, aspect: map.res[0] / map.res[1] }, g)
}

// A short name for files.
export const goboFileName = (g: Gobo) => g.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'gobo'
