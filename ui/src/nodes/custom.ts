import { useSyncExternalStore } from 'react'
import { rico } from '../engine/connection'
import { putSignal, readSignal } from '../engine/signals'
import type { EvalContext, NodeRef, NodeState, NodeType, Port, PortType, Value } from './kit'

// Your own nodes, three ways:
//  - a Script node: write JavaScript right in the node, with the inputs and
//    outputs you name;
//  - a saved node: save a Script node to your library and it appears in the
//    node list like any other, in every network (and in .ricox files);
//  - a Container: a whole network inside one node, with Inlet and Outlet
//    nodes as its ports.
// Developers can also add node types to the code itself: see basic.ts.

const portsFrom = (list: string): Port[] =>
  list.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 12).map((s) => {
    // "name:tex" makes a texture port, "name:text" a text port, and so on
    const [key, type] = s.split(':').map((x) => x.trim())
    return { key, label: key, type: (['tex', 'geo', 'text', 'list'].includes(type) ? type : 'num') as PortType }
  })

const helpers = {
  osc: (host: string, port: number, address: string, ...args: (number | string)[]) => rico.send('net.osc', { host, port, address, args }),
  midiCC: (channel: number, number: number, value: number) => rico.send('midi.send', { bytes: [0xb0 + ((channel - 1) & 15), number & 127, Math.round(Math.max(0, Math.min(1, value)) * 127)] }),
  dmx: (channel: number, value: number) => rico.send('dmx.set', { channel, value }),
  read: (id: string) => readSignal(id),
  signal: (name: string, v: number) => putSignal(`node:${name}`, `Nodes: ${name}`, v),
}

type Compiled = (inputs: Record<string, Value>, state: NodeState, t: number, dt: number, rico: typeof helpers) => Record<string, Value> | void

const compiled = new Map<string, Compiled | string>()
function compile(code: string, inputs: Port[]): Compiled | string {
  const key = `${inputs.map((p) => p.key).join(',')}|${code}`
  const hit = compiled.get(key)
  if (hit) return hit
  let result: Compiled | string
  try {
    const names = inputs.map((p) => p.key).filter((k) => /^[a-zA-Z_$][\w$]*$/.test(k))
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    result = new Function('inputs', 'state', 't', 'dt', 'rico', `const {sin,cos,tan,abs,floor,ceil,round,min,max,pow,sqrt,exp,log,PI,random}=Math;\nconst {${names.join(',')}} = inputs;\n${code}`) as Compiled
  } catch (e) {
    result = (e as Error).message
  }
  compiled.set(key, result)
  if (compiled.size > 300) compiled.delete(compiled.keys().next().value!)
  return result
}

function runCode(c: EvalContext, code: string, outputs: Port[]): Record<string, Value> {
  const ins = portsFrom(String(c.p.inputs ?? ''))
  const fn = compile(code, ins)
  if (typeof fn === 'string') {
    c.state.err = fn
    return {}
  }
  try {
    const res = fn(c.in, (c.state.user ??= {}), c.t, c.dt, helpers) ?? {}
    c.state.err = ''
    // One output can be returned on its own: "return a * 2"
    if (typeof res !== 'object' || Array.isArray(res)) return { [outputs[0]?.key ?? 'out']: res }
    return res
  } catch (e) {
    c.state.err = (e as Error).message
    return {}
  }
}

// the library of saved nodes

export interface CustomDef {
  id: string
  name: string
  about: string
  inputs: string        // "a, b, picture:tex"
  outputs: string       // "out"
  code: string
}

const KEY = 'rico.nodelib'
let library: CustomDef[] = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
})()
let version = 0
const listeners = new Set<() => void>()
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(library))
  } catch {
    /* not remembered */
  }
  version++
  typeCache.clear()
  listeners.forEach((l) => l())
}

export function useLibrary(): CustomDef[] {
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => version,
  )
  return library
}
export const getLibrary = () => library

export function saveDef(def: Omit<CustomDef, 'id'> & { id?: string }): CustomDef {
  const d: CustomDef = { ...def, id: def.id ?? Math.random().toString(36).slice(2, 9) }
  library = library.some((x) => x.id === d.id) ? library.map((x) => (x.id === d.id ? d : x)) : [...library, d]
  save()
  return d
}

export function removeDef(id: string) {
  library = library.filter((d) => d.id !== id)
  save()
}

export function importDefs(defs: CustomDef[]) {
  for (const d of defs) if (d?.id && typeof d.code === 'string') saveDef(d)
}

const typeCache = new Map<string, NodeType>()
export function customType(id: string): NodeType | undefined {
  const hit = typeCache.get(id)
  if (hit) return hit
  const def = library.find((d) => d.id === id)
  if (!def) return undefined
  const outputs = portsFrom(def.outputs)
  const t: NodeType = {
    type: `custom:${id}`, name: def.name, group: 'Custom', about: def.about || 'Your own node',
    inputs: portsFrom(def.inputs), outputs,
    params: portsFrom(def.inputs).filter((p) => (p.type ?? 'num') === 'num').map((p) => ({ key: p.key, label: p.key, kind: 'number' as const, default: 0 })),
    run: (c) => runCode({ ...c, p: { ...c.p, inputs: def.inputs } }, def.code, outputs),
  }
  typeCache.set(id, t)
  return t
}

// containers

// Set by the store, which knows how to run a whole network.
let runInside: ((graphId: string, inputs: Record<string, Value>, c: EvalContext) => Record<string, Value>) | null = null
let portsInside: ((graphId: string) => { inputs: Port[]; outputs: Port[] }) | null = null
export function setContainerRunner(
  run: (graphId: string, inputs: Record<string, Value>, c: EvalContext) => Record<string, Value>,
  ports: (graphId: string) => { inputs: Port[]; outputs: Port[] },
) {
  runInside = run
  portsInside = ports
}

const PORT_TYPES = ['Number', 'Picture', 'Shape', 'Text', 'List']
const typeOf = (i: number): PortType => (['num', 'tex', 'geo', 'text', 'list'] as PortType[])[i] ?? 'num'

export const CUSTOM_TYPES: NodeType[] = [
  {
    type: 'script', name: 'Script node', group: 'Custom', about: 'Write JavaScript right in the node. Name the inputs and outputs, return the outputs.', ui: 'code',
    inputs: [], outputs: [],
    params: [
      { key: 'inputs', label: 'Inputs (commas; name:tex for a picture)', kind: 'text', default: 'a, b' },
      { key: 'outputs', label: 'Outputs', kind: 'text', default: 'out' },
      { key: 'code', label: 'Code', kind: 'code', default: '// a and b are the inputs. state keeps values between steps.\nstate.phase = (state.phase || 0) + dt * (1 + b * 4)\nreturn { out: a * 0.5 + 0.5 * sin(state.phase) }' },
    ],
    ports: (node: NodeRef) => ({ inputs: portsFrom(String(node.params.inputs ?? '')), outputs: portsFrom(String(node.params.outputs ?? 'out')) }),
    run: (c) => runCode(c, String(c.p.code), portsFrom(String(c.p.outputs ?? 'out'))),
  },
  {
    type: 'container', name: 'Container', group: 'Custom', about: 'A whole network in one node. Double-click it to go inside. Inlets and Outlets inside become its ports.',
    inputs: [], outputs: [], params: [{ key: 'graph', label: 'Network inside', kind: 'graph', default: '' }],
    ports: (node: NodeRef) => (portsInside && node.params.graph ? portsInside(String(node.params.graph)) : { inputs: [], outputs: [] }),
    run: (c) => (runInside && c.p.graph ? runInside(String(c.p.graph), c.in, c) : {}),
  },
  {
    type: 'inlet', name: 'Inlet', group: 'Custom', about: 'Inside a container: a value coming in from outside', inputs: [], outputs: [{ key: 'out', label: 'in' }],
    params: [{ key: 'name', label: 'Name', kind: 'text', default: 'in1' }, { key: 'ptype', label: 'Carries', kind: 'choice', default: 0, choices: PORT_TYPES }],
    ports: (node) => ({ inputs: [], outputs: [{ key: 'out', label: String(node.params.name ?? 'in'), type: typeOf(Number(node.params.ptype)) }] }),
    run: (c) => ({ out: c.state.value ?? (Number(c.p.ptype) === 0 ? 0 : null) }),
  },
  {
    type: 'outlet', name: 'Outlet', group: 'Custom', about: 'Inside a container: a value going out', inputs: [{ key: 'in', label: 'out' }], outputs: [],
    params: [{ key: 'name', label: 'Name', kind: 'text', default: 'out1' }, { key: 'ptype', label: 'Carries', kind: 'choice', default: 0, choices: PORT_TYPES }],
    ports: (node) => ({ inputs: [{ key: 'in', label: String(node.params.name ?? 'out'), type: typeOf(Number(node.params.ptype)) }], outputs: [] }),
    run: (c) => { c.state.value = c.in.in },
  },
]
