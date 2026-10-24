import { useSyncExternalStore } from 'react'
import { record } from '../shell/history'
import { NODE_TYPES, nodeType, portsOf, releaseNode, type EvalContext, type NodeState, type Port, type Value } from './types'
import { setContainerRunner } from './custom'

// Node networks: saved in this browser profile (and inside workspace and
// project files), and always running while they are switched on, whether
// or not their panel is open.

export interface GNode {
  id: string
  type: string
  x: number
  y: number
  name?: string
  params: Record<string, number | string | boolean>
}

export interface Wire {
  id: string
  from: { node: string; port: string }
  to: { node: string; port: string }
}

export interface Graph {
  id: string
  name: string
  enabled: boolean
  inside?: boolean      // lives inside a Container node, which runs it
  nodes: GNode[]
  wires: Wire[]
  notes?: Note[]        // comments: boxes with text, made with C
}

// A comment on the network: a colored box with words, behind the nodes.
export interface Note { id: string; x: number; y: number; w: number; h: number; text: string; color: string }

// A .ricox file: some nodes and the wires between them.
export interface RicoxFile { rico: 'nodes'; version: 1; name: string; nodes: GNode[]; wires: Wire[]; graphs?: Graph[]; custom?: import('./custom').CustomDef[] }

const KEY = 'rico.graphs'
let graphs: Graph[] = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
})()
let version = 0
const listeners = new Set<() => void>()

function commit(next: Graph[]) {
  graphs = next
  saveSoon()
  version++
  listeners.forEach((l) => l())
}

let saveTimer = 0
function saveSoon() {
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(graphs))
    } catch {
      /* not remembered */
    }
  }, 300)
}

export function useGraphs(): Graph[] {
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => version,
  )
  return graphs
}

export const getGraphs = () => graphs
export function onGraphsChange(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
export const getGraph = (id: string) => graphs.find((g) => g.id === id)
export const uid = () => Math.random().toString(36).slice(2, 9)

export function changeGraph(id: string, label: string, fn: (g: Graph) => Graph, key?: string) {
  const before = graphs
  const after = graphs.map((g) => (g.id === id ? fn(g) : g))
  commit(after)
  record({ label, key, undo: () => commit(before), redo: () => commit(after) })
}

export function putGraph(g: Graph) {
  commit(graphs.some((x) => x.id === g.id) ? graphs.map((x) => (x.id === g.id ? g : x)) : [...graphs, g])
}

export function setAllGraphs(list: Graph[]) {
  commit(list)
}

export function newGraph(name = 'Network', withExample = true): Graph {
  const g: Graph = { id: uid(), name, enabled: true, nodes: [], wires: [] }
  if (withExample) {
    // A small working example: the low end of the audio, smoothed, as a signal.
    const a = makeNode('signal', 40, 60, { signal: 'audio:low' })
    const b = makeNode('smooth', 300, 60)
    const c = makeNode('signal-out', 560, 40, { name: 'Smooth bass' })
    const d = makeNode('watch', 560, 200)
    g.nodes = [a, b, c, d]
    g.wires = [wire(a.id, 'out', b.id, 'in'), wire(b.id, 'out', c.id, 'in'), wire(b.id, 'out', d.id, 'in')]
  }
  const before = graphs
  commit([...graphs, g])
  record({ label: 'New node network', undo: () => commit(before), redo: () => commit([...before, g]) })
  return g
}

export function removeGraph(id: string) {
  const before = graphs
  stopGraph(id)
  commit(graphs.filter((g) => g.id !== id))
  record({ label: 'Delete node network', undo: () => commit(before), redo: () => commit(before.filter((g) => g.id !== id)) })
}

export function makeNode(type: string, x: number, y: number, params: Record<string, number | string | boolean> = {}): GNode {
  const t = nodeType(type)
  const defaults = Object.fromEntries((t?.params ?? []).map((p) => [p.key, p.default]))
  return { id: uid(), type, x, y, params: { ...defaults, ...params } }
}

export const wire = (fromNode: string, fromPort: string, toNode: string, toPort: string): Wire =>
  ({ id: uid(), from: { node: fromNode, port: fromPort }, to: { node: toNode, port: toPort } })

// There is always one network called Main, so the Create workspace has
// somewhere to start.
if (!graphs.some((g) => g.id === 'main')) {
  const a = makeNode('signal', 40, 40, { signal: 'audio:kick' })
  const b = makeNode('envelope', 300, 40)
  const c = makeNode('signal-out', 570, 30, { name: 'Kick flash' })
  const d = makeNode('watch', 570, 200)
  graphs = [{ id: 'main', name: 'Main', enabled: true, nodes: [a, b, c, d], wires: [wire(a.id, 'out', b.id, 'in'), wire(b.id, 'out', c.id, 'in'), wire(b.id, 'out', d.id, 'in')] }, ...graphs]
}

// running

const states = new Map<string, NodeState>()                 // node id -> memory
export const outputs = new Map<string, Record<string, Value>>()  // node id -> last outputs
const t0 = performance.now()
let last = performance.now()

function stopGraph(id: string) {
  const g = getGraph(id)
  g?.nodes.forEach((n) => {
    const st = states.get(n.id)
    if (st) releaseNode(n.type, st, n.id)
  })
}

// Order nodes so every node runs after the nodes feeding it. Loops are cut
// where they close (that wire reads last step's value, like a feedback loop).
function order(g: Graph): GNode[] {
  const byId = new Map(g.nodes.map((n) => [n.id, n]))
  const seen = new Set<string>()
  const busy = new Set<string>()
  const out: GNode[] = []
  const visit = (n: GNode) => {
    if (seen.has(n.id) || busy.has(n.id)) return
    busy.add(n.id)
    for (const w of g.wires) if (w.to.node === n.id) { const src = byId.get(w.from.node); if (src) visit(src) }
    busy.delete(n.id)
    seen.add(n.id)
    out.push(n)
  }
  g.nodes.forEach(visit)
  return out
}

const orderCache = new WeakMap<Graph, GNode[]>()
export const nodePorts = (n: GNode) => {
  const t = nodeType(n.type)
  return t ? portsOf(t, n) : { inputs: [] as Port[], outputs: [] as Port[] }
}

// Settings with their defaults filled in, so networks saved before a node
// gained a setting (or written by hand) still run.
const defaultsCache = new Map<string, Record<string, number | string | boolean>>()
function paramsOf(node: GNode, type: NonNullable<ReturnType<typeof nodeType>>) {
  let d = defaultsCache.get(type.type)
  if (!d) { d = Object.fromEntries(type.params.map((p) => [p.key, p.default])); defaultsCache.set(type.type, d) }
  for (const k in d) if (!(k in node.params)) return { ...d, ...node.params }
  return node.params
}

// The value an unplugged input gets: its matching setting, if it has one.
function fallback(params: GNode['params'], port: Port): Value {
  const type = port.type ?? 'num'
  const p = params[port.key]
  if (type === 'num') return Number(p ?? 0)
  if (type === 'text') return p === undefined ? '' : String(p)
  if (type === 'list') return []
  return null
}

const live = new Set<string>()
let depth = 0

// Runs one network once. Inside a container, inlets get the container's
// inputs and the outlets' values come back.
function evalGraph(g: Graph, dt: number, t: number, inlets?: Record<string, Value>): Record<string, Value> {
  let list = orderCache.get(g)
  if (!list) { list = order(g); orderCache.set(g, list) }
  const result: Record<string, Value> = {}
  for (const node of list) {
    live.add(node.id)
    const type = nodeType(node.type)
    if (!type) continue
    let st = states.get(node.id)
    if (!st) { st = { __type: node.type }; states.set(node.id, st) }
    if (inlets && node.type === 'inlet') st.value = inlets[String(node.params.name)]
    const params = paramsOf(node, type)
    const { inputs: ports } = portsOf(type, node)
    const inputs: Record<string, Value> = {}
    for (const port of ports) {
      const w = g.wires.find((x) => x.to.node === node.id && x.to.port === port.key)
      const v = w ? outputs.get(w.from.node)?.[w.from.port] : undefined
      inputs[port.key] = v ?? fallback(params, port)
    }
    const ctx: EvalContext = { id: node.id, node: params === node.params ? node : { ...node, params }, in: inputs, p: params, dt, t, state: st }
    try {
      const res = type.run(ctx)
      outputs.set(node.id, res ?? { in: inputs.in ?? 0 })
    } catch (e) {
      st.err = (e as Error).message
      outputs.set(node.id, {})
    }
    if (node.type === 'outlet') result[String(node.params.name)] = st.value
  }
  return result
}

setContainerRunner(
  (graphId, inputs) => {
    const g = getGraph(graphId)
    if (!g || depth > 8) return {}
    depth++
    try {
      const now = performance.now()
      return evalGraph(g, 1 / 60, (now - t0) / 1000, inputs)
    } finally {
      depth--
    }
  },
  (graphId) => {
    const g = getGraph(graphId)
    if (!g) return { inputs: [], outputs: [] }
    const sorted = [...g.nodes].sort((a, b) => a.y - b.y || a.x - b.x)
    const io = (type: string) => sorted.filter((n) => n.type === type).map((n) => {
      const p = nodePorts(n)
      const port = type === 'inlet' ? p.outputs[0] : p.inputs[0]
      return { key: String(n.params.name), label: String(n.params.name), type: port?.type }
    })
    return { inputs: io('inlet'), outputs: io('outlet') }
  },
)

function step() {
  const now = performance.now()
  const dt = Math.min(0.1, (now - last) / 1000)
  last = now
  const t = (now - t0) / 1000
  live.clear()
  for (const g of graphs) {
    if (g.inside) continue
    if (!g.enabled) {
      g.nodes.forEach((n) => { const st = states.get(n.id); if (st && !st.stopped) { st.stopped = 1; releaseNode(n.type, st, n.id) } })
      continue
    }
    evalGraph(g, dt, t)
  }
  // Forget nodes that were deleted.
  for (const id of [...states.keys()]) {
    if (!live.has(id) && !graphs.some((g) => g.nodes.some((n) => n.id === id))) {
      const st = states.get(id)
      if (st) releaseNode(String(st.__type), st, id)
      states.delete(id)
      outputs.delete(id)
    }
  }
}

window.setInterval(step, 1000 / 60)

export const nodeState = (id: string) => states.get(id)
export const NODE_COUNT = NODE_TYPES.length

// containers

// A network and every network inside its containers (for saving and sharing).
export function graphTree(id: string, from: Graph[] = graphs, seen = new Set<string>()): Graph[] {
  const g = from.find((x) => x.id === id)
  if (!g || seen.has(id)) return []
  seen.add(id)
  const out = [g]
  for (const n of g.nodes) if (n.type === 'container' && n.params.graph) out.push(...graphTree(String(n.params.graph), from, seen))
  return out
}

// A fresh copy of a container's inside (new ids all the way down), so two
// copies of a container do not share their memory.
export function cloneInside(id: string, from: Graph[] = graphs): string | null {
  const g = from.find((x) => x.id === id)
  if (!g) return null
  const ids = new Map<string, string>()
  const nodes = g.nodes.map((n) => {
    const nid = uid()
    ids.set(n.id, nid)
    const params = n.type === 'container' && n.params.graph ? { ...n.params, graph: cloneInside(String(n.params.graph), from) ?? '' } : n.params
    return { ...n, id: nid, params }
  })
  const wires = g.wires.filter((w) => ids.has(w.from.node) && ids.has(w.to.node))
    .map((w) => ({ id: uid(), from: { node: ids.get(w.from.node)!, port: w.from.port }, to: { node: ids.get(w.to.node)!, port: w.to.port } }))
  const copy: Graph = { ...g, id: uid(), inside: true, nodes, wires }
  commit([...graphs, copy])
  return copy.id
}

// Moves the selected nodes into a new network inside a Container node.
// Wires that crossed the edge become Inlets and Outlets.
export function encapsulate(graphId: string, ids: Set<string>, name = 'Container'): string | null {
  const g = getGraph(graphId)
  if (!g || !ids.size) return null
  const inner: Graph = { id: uid(), name, enabled: true, inside: true, nodes: [], wires: [] }
  const picked = g.nodes.filter((n) => ids.has(n.id))
  const minX = Math.min(...picked.map((n) => n.x)), minY = Math.min(...picked.map((n) => n.y))
  inner.nodes = picked.map((n) => ({ ...n, x: n.x - minX + 260, y: n.y - minY + 40 }))
  inner.wires = g.wires.filter((w) => ids.has(w.from.node) && ids.has(w.to.node))
  const box = makeNode('container', Math.round(picked.reduce((s, n) => s + n.x, 0) / picked.length), Math.round(picked.reduce((s, n) => s + n.y, 0) / picked.length), { graph: inner.id })
  box.name = name
  const outerWires: Wire[] = g.wires.filter((w) => !ids.has(w.from.node) && !ids.has(w.to.node))
  let ins = 0, outs = 0
  const inletFor = new Map<string, string>()   // "node.port" outside -> inlet name
  for (const w of g.wires) {
    const fromIn = ids.has(w.from.node), toIn = ids.has(w.to.node)
    if (!fromIn && toIn) {
      const key = `${w.from.node}.${w.from.port}`
      let nameIn = inletFor.get(key)
      if (!nameIn) {
        nameIn = `in${++ins}`
        inletFor.set(key, nameIn)
        const srcType = nodePorts(g.nodes.find((n) => n.id === w.from.node)!).outputs.find((p) => p.key === w.from.port)?.type ?? 'num'
        const inlet = makeNode('inlet', 20, 40 + (ins - 1) * 110, { name: nameIn, ptype: ['num', 'tex', 'geo', 'text', 'list'].indexOf(srcType) })
        inner.nodes.push(inlet)
        outerWires.push(wire(w.from.node, w.from.port, box.id, nameIn))
        inner.wires.push(wire(inlet.id, 'out', w.to.node, w.to.port))
      } else {
        const inlet = inner.nodes.find((n) => n.type === 'inlet' && n.params.name === nameIn)!
        inner.wires.push(wire(inlet.id, 'out', w.to.node, w.to.port))
      }
    } else if (fromIn && !toIn) {
      const nameOut = `out${++outs}`
      const srcType = nodePorts(g.nodes.find((n) => n.id === w.from.node)!).outputs.find((p) => p.key === w.from.port)?.type ?? 'num'
      const outlet = makeNode('outlet', Math.max(...inner.nodes.map((n) => n.x)) + 260, 40 + (outs - 1) * 110, { name: nameOut, ptype: ['num', 'tex', 'geo', 'text', 'list'].indexOf(srcType) })
      inner.nodes.push(outlet)
      inner.wires.push(wire(w.from.node, w.from.port, outlet.id, 'in'))
      outerWires.push(wire(box.id, nameOut, w.to.node, w.to.port))
    }
  }
  const outer: Graph = { ...g, nodes: [...g.nodes.filter((n) => !ids.has(n.id)), box], wires: outerWires }
  const before = graphs
  const after = [...graphs.map((x) => (x.id === g.id ? outer : x)), inner]
  commit(after)
  record({ label: `Make ${name}`, undo: () => commit(before), redo: () => commit(after) })
  return box.id
}
