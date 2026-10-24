// Shared pieces for node types: what a node, a port and a parameter are.
// Every family of nodes (numbers, events, textures, shapes, data, your own)
// is built from these.

export type ParamKind = 'number' | 'text' | 'code' | 'signal' | 'choice' | 'bool' | 'param' | 'command' | 'graph' | 'picture'

export interface NodeParam {
  key: string
  label: string
  kind: ParamKind
  default: number | string | boolean
  min?: number
  max?: number
  step?: number
  choices?: string[]
}

// What travels on a wire. Numbers are the default; triggers are numbers that
// jump to 1 for a moment.
export type PortType = 'num' | 'tex' | 'geo' | 'text' | 'list'
export interface Port { key: string; label: string; type?: PortType }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Value = any

export interface NodeState {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any
}

export interface NodeRef { id: string; type: string; params: Record<string, number | string | boolean> }

export interface EvalContext {
  id: string
  node: NodeRef
  in: Record<string, Value>              // input values (wired, or the matching setting)
  p: Record<string, number | string | boolean>
  dt: number                              // seconds since the last step
  t: number                               // seconds since start
  state: NodeState                        // this node's memory between steps
}

export type NodeGroup = 'Sources' | 'Shape' | 'Logic' | 'Events' | 'Data' | 'Texture' | 'Geometry' | 'Outputs' | 'Custom'

export interface NodeType {
  type: string
  name: string
  group: NodeGroup
  about: string
  inputs: Port[]
  outputs: Port[]
  params: NodeParam[]
  // For nodes whose ports depend on their settings (scripts, containers).
  ports?: (node: NodeRef) => { inputs: Port[]; outputs: Port[] }
  run: (c: EvalContext) => Record<string, Value> | void
  ui?: 'button' | 'thumb' | 'code' | 'table' | 'log'
  release?: (state: NodeState, id: string) => void
}

export const n = (key: string, label: string, def: number, min?: number, max?: number, step?: number): NodeParam =>
  ({ key, label, kind: 'number', default: def, min, max, step })
export const IN: Port[] = [{ key: 'in', label: 'in' }]
export const OUT: Port[] = [{ key: 'out', label: 'out' }]
export const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
export const rising = (c: EvalContext, key: string, v: number) => {
  const was = (c.state[`was_${key}`] as number | undefined) ?? 0
  c.state[`was_${key}`] = v
  return v > 0.5 && was <= 0.5
}

// The last value sent by an output node, so it only sends when it changes.
export function changed(c: EvalContext, v: number, eps = 0.0005) {
  const last = c.state.sent as number | undefined
  if (last !== undefined && Math.abs(last - v) < eps) return false
  c.state.sent = v
  return true
}

export const portsOf = (t: NodeType, node: NodeRef) => (t.ports ? t.ports(node) : { inputs: t.inputs, outputs: t.outputs })
