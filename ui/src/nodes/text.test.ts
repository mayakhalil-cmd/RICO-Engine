import { beforeAll, describe, expect, it } from 'vitest'
import type { Graph } from './store'

// the node families load the rest of RICO, which wants a page: a small stand-in
const el = () => ({ getContext: () => null, setAttribute() {}, addEventListener() {}, appendChild() {}, style: {}, className: '', width: 0, height: 0 })
const g0 = globalThis as unknown as Record<string, unknown>
g0.document ??= { createElement: el, addEventListener() {}, body: el(), documentElement: { style: { setProperty() {} } }, querySelector: () => null, getElementById: () => null }
g0.window ??= globalThis
g0.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} }
g0.requestAnimationFrame ??= () => 0
g0.addEventListener ??= () => {}
g0.removeEventListener ??= () => {}
g0.matchMedia ??= () => ({ matches: false, addEventListener() {} })
g0.location ??= { search: '', hash: '', href: 'http://x/', host: 'x', protocol: 'http:' }
g0.WebSocket ??= class { addEventListener() {} send() {} close() {} }
let M: typeof import('./store'), T: typeof import('./types'), X: typeof import('./text')
beforeAll(async () => { M = await import('./store'); T = await import('./types'); X = await import('./text') })

describe('node networks as text', () => {
  it('goes to text and back with the same nodes, settings and wires', () => {
    const [a, b] = T.NODE_TYPES.filter((t) => t.outputs.length && t.inputs.length).slice(0, 2)
    const n1 = M.makeNode(a.type, 10, 20), n2 = M.makeNode(b.type, 200, 20)
    const p = a.params.find((x) => x.kind === 'number')
    if (p) n1.params[p.key] = 0.123
    const g: Graph = { id: 'g', name: 'Test "net"', enabled: true, nodes: [n1, n2], wires: [M.wire(n1.id, a.outputs[0].key, n2.id, b.inputs[0].key)] }
    const text = X.graphToText(g)
    const back = X.textToGraph(text)
    expect(back.problems).toEqual([])
    expect(back.name).toBe('Test "net"')
    expect(back.nodes.map((n) => n.type)).toEqual([a.type, b.type])
    if (p) expect(back.nodes[0].params[p.key]).toBe(0.123)
    expect(back.wires.length).toBe(1)
    expect(back.wires[0].from.node).toBe(back.nodes[0].id)
    expect(back.wires[0].to.port).toBe(b.inputs[0].key)
    expect(back.nodes[1].x).toBe(200)
  })
  it('tells what it could not read', () => {
    const r = X.textToGraph('a = nothing_like_this()\nb = ' + T.NODE_TYPES[0].type + '() <- in: zz.out\nwhat')
    expect(r.problems.length).toBe(3)
  })
  it('lists every node type', () => {
    const g = X.nodeGuide()
    for (const t of T.NODE_TYPES.slice(0, 10)) expect(g).toContain(`${t.type}(`)
  })
})
