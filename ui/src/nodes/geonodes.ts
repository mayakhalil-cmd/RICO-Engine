import { dropShape, putShape } from '../engine/shared'
import { n, type EvalContext, type NodeType, type Port } from './kit'

// Geometry nodes: make a shape from a primitive, math or
// code, change it, and send it to the 3D playground with "Shape out".
// three.js loads the first time one of these runs.

type Geo = typeof import('./geo')
let lib: Geo | null = null
let loading = false
function geo(): Geo | null {
  if (!lib && !loading) {
    loading = true
    import('./geo').then((m) => { lib = m }).catch(() => { loading = false })
  }
  return lib
}

export interface GeoRef { kind: 'geo'; geo: unknown; v: number; points: number }
const GEO = (key = 'out', label = 'shape'): Port => ({ key, label, type: 'geo' })
let serial = 0

// Shapes are rebuilt only when something they depend on changes. Moving
// ones (that use time) rebuild up to 30 times a second.
function cached(c: EvalContext, deps: unknown[], animated: boolean, make: (g: Geo) => unknown): Record<string, unknown> {
  const g = geo()
  if (!g) return { out: c.state.ref ?? null }
  const key = JSON.stringify([deps, animated ? Math.floor(c.t * 30) : 0])
  if (key === c.state.key && c.state.ref) return { out: c.state.ref }
  c.state.key = key
  const made = make(g)
  if (typeof made === 'string') { c.state.err = made; return { out: c.state.ref ?? null } }
  c.state.err = ''
  // Free the shape from two builds ago (the last one may still be on screen).
  const trash = c.state.trash as GeoRef | undefined
  ;(trash?.geo as { dispose?: () => void } | undefined)?.dispose?.()
  c.state.trash = c.state.ref
  const ref: GeoRef = { kind: 'geo', geo: made, v: ++serial, points: g.vertexCount(made as never) }
  c.state.ref = ref
  return { out: ref }
}

const inGeo = (c: EvalContext, key = 'in') => {
  const v = c.in[key] as GeoRef | null
  return v && v.kind === 'geo' ? v : null
}

export const GEO_TYPES: NodeType[] = [
  {
    type: 'geo-shape', name: 'Primitive', group: 'Geometry', about: 'A sphere, cube, donut, knot and more', inputs: [], outputs: [GEO()],
    params: [{ key: 'kind', label: 'Shape', kind: 'choice', default: 0, choices: ['Sphere', 'Cube', 'Donut', 'Knot', 'Plane', 'Cylinder', 'Crystal', 'Cone'] }, n('detail', 'Detail', 4, 1, 16, 1)],
    run: (c) => cached(c, [c.p.kind, c.p.detail], false, (g) => g.primitive(Number(c.p.kind), Number(c.p.detail))),
  },
  {
    type: 'geo-param', name: 'Math surface', group: 'Geometry', about: 'A surface from formulas of u and v (0 to 1), t (time), a and b',
    inputs: [{ key: 'a', label: 'a' }, { key: 'b', label: 'b' }], outputs: [GEO()],
    params: [
      { key: 'x', label: 'x =', kind: 'text', default: 'sin(v*PI) * cos(u*TAU) * (1 + 0.2*sin(6*u*TAU + t))' },
      { key: 'y', label: 'y =', kind: 'text', default: 'cos(v*PI) * (1 + a)' },
      { key: 'z', label: 'z =', kind: 'text', default: 'sin(v*PI) * sin(u*TAU) * (1 + 0.2*sin(6*u*TAU + t))' },
      n('resU', 'Detail u', 96, 2, 512, 1), n('resV', 'Detail v', 64, 2, 512, 1), n('a', 'a', 0), n('b', 'b', 0),
    ],
    run: (c) => {
      const uses = /\bt\b/.test(`${c.p.x}${c.p.y}${c.p.z}`)
      return cached(c, [c.p.x, c.p.y, c.p.z, c.p.resU, c.p.resV, c.in.a, c.in.b], uses, (g) => g.parametric(String(c.p.x), String(c.p.y), String(c.p.z), Number(c.p.resU), Number(c.p.resV), c.t, Number(c.in.a), Number(c.in.b)))
    },
  },
  {
    type: 'geo-implicit', name: 'Math solid', group: 'Geometry', about: 'A closed shape where a formula of x, y, z is below zero (like a signed distance field)',
    inputs: [{ key: 'a', label: 'a' }, { key: 'b', label: 'b' }], outputs: [GEO()],
    params: [
      { key: 'f', label: 'Inside where', kind: 'text', default: 'sqrt(x*x+y*y+z*z) - 0.7 + 0.15*sin(x*8 + t)*sin(y*8)*sin(z*8 + a*4)' },
      n('res', 'Detail', 48, 16, 96, 1), n('size', 'Size', 1.2, 0.1, 10), n('a', 'a', 0), n('b', 'b', 0),
    ],
    run: (c) => cached(c, [c.p.f, c.p.res, c.p.size, c.in.a, c.in.b], /\bt\b/.test(String(c.p.f)), (g) => g.implicit(String(c.p.f), Number(c.p.res), Number(c.p.size), c.t, Number(c.in.a), Number(c.in.b))),
  },
  {
    type: 'geo-code', name: 'Code shape', group: 'Geometry', about: 'A shape from JavaScript: point(x, y, z) and tri(i, j, k), or return any three.js geometry',
    inputs: [{ key: 'a', label: 'a' }, { key: 'b', label: 'b' }, { key: 'c', label: 'c' }], outputs: [GEO()],
    params: [
      { key: 'code', label: 'Code', kind: 'code', default: '// A spiral ribbon\nconst n = 300\nfor (let i = 0; i <= n; i++) {\n  const k = i / n * TAU * 4, r = 0.4 + i / n * (0.6 + a)\n  point(cos(k) * r, i / n * 2 - 1, sin(k) * r)\n  point(cos(k) * r, i / n * 2 - 0.9, sin(k) * r)\n}\nfor (let i = 0; i < n; i++) quad(i*2, i*2+1, i*2+3, i*2+2)' },
      { key: 'moving', label: 'Uses time (t)', kind: 'bool', default: false }, n('a', 'a', 0), n('b', 'b', 0), n('c', 'c', 0),
    ],
    run: (c) => cached(c, [c.p.code, c.in.a, c.in.b, c.in.c], Boolean(c.p.moving), (g) => g.fromCode(String(c.p.code), c.t, Number(c.in.a), Number(c.in.b), Number(c.in.c))),
  },
  {
    type: 'geo-displace', name: 'Displace', group: 'Geometry', about: 'Pushes the surface in and out with noise, moving over time', inputs: [GEO('in', 'shape'), { key: 'amount', label: 'amount' }], outputs: [GEO()],
    params: [n('amount', 'Amount', 0.2, 0, 2), n('scale', 'Noise size', 2, 0.1, 20), n('speed', 'Speed', 1, 0, 10)],
    run: (c) => {
      const s = inGeo(c)
      if (!s) return { out: null }
      return cached(c, [s.v, c.in.amount, c.p.scale, c.p.speed], Number(c.p.speed) > 0, (g) => g.displace(s.geo as never, Number(c.in.amount), Number(c.p.scale), c.t * Number(c.p.speed)))
    },
  },
  {
    type: 'geo-twist', name: 'Twist', group: 'Geometry', about: 'Turns the shape more the further along an axis', inputs: [GEO('in', 'shape'), { key: 'amount', label: 'amount' }], outputs: [GEO()],
    params: [n('amount', 'Amount', 2, -20, 20), { key: 'axis', label: 'Axis', kind: 'choice', default: 1, choices: ['X', 'Y', 'Z'] }],
    run: (c) => {
      const s = inGeo(c)
      if (!s) return { out: null }
      return cached(c, [s.v, c.in.amount, c.p.axis], false, (g) => g.twist(s.geo as never, Number(c.in.amount), Number(c.p.axis)))
    },
  },
  {
    type: 'geo-wave', name: 'Wave', group: 'Geometry', about: 'Ripples moving through the shape', inputs: [GEO('in', 'shape'), { key: 'amp', label: 'height' }], outputs: [GEO()],
    params: [n('amp', 'Height', 0.1, 0, 2), n('freq', 'Waves', 6, 0, 40), n('speed', 'Speed', 2, 0, 20)],
    run: (c) => {
      const s = inGeo(c)
      if (!s) return { out: null }
      return cached(c, [s.v, c.in.amp, c.p.freq, c.p.speed], true, (g) => g.wave(s.geo as never, Number(c.in.amp), Number(c.p.freq), Number(c.p.speed), c.t))
    },
  },
  {
    type: 'geo-transform', name: 'Move shape', group: 'Geometry', about: 'Moves, turns and scales a shape', inputs: [GEO('in', 'shape'), { key: 'ry', label: 'turn y' }, { key: 's', label: 'scale' }], outputs: [GEO()],
    params: [n('tx', 'X', 0, -10, 10), n('ty', 'Y', 0, -10, 10), n('tz', 'Z', 0, -10, 10), n('rx', 'Turn X', 0, -360, 360), n('ry', 'Turn Y', 0, -360, 360), n('rz', 'Turn Z', 0, -360, 360), n('s', 'Scale', 1, 0.01, 20)],
    run: (c) => {
      const s = inGeo(c)
      if (!s) return { out: null }
      return cached(c, [s.v, c.p.tx, c.p.ty, c.p.tz, c.p.rx, c.in.ry, c.p.rz, c.in.s], false,
        (g) => g.transform(s.geo as never, Number(c.p.tx), Number(c.p.ty), Number(c.p.tz), Number(c.p.rx), Number(c.in.ry), Number(c.p.rz), Number(c.in.s)))
    },
  },
  {
    type: 'geo-array', name: 'Copies', group: 'Geometry', about: 'Copies of a shape in a row, a circle or a spiral (Array modifier)', inputs: [GEO('in', 'shape'), { key: 'count', label: 'count' }], outputs: [GEO()],
    params: [n('count', 'Count', 8, 1, 500, 1), { key: 'mode', label: 'Layout', kind: 'choice', default: 1, choices: ['Row', 'Circle', 'Spiral'] }, n('spacing', 'Spacing', 1.5, 0, 20), n('turn', 'Turn each', 0, -180, 180), n('grow', 'Grow each', 1, 0.5, 1.5, 0.001)],
    run: (c) => {
      const s = inGeo(c)
      if (!s) return { out: null }
      return cached(c, [s.v, c.in.count, c.p.mode, c.p.spacing, c.p.turn, c.p.grow], false,
        (g) => g.array(s.geo as never, Number(c.in.count), Number(c.p.mode), Number(c.p.spacing), Number(c.p.turn), Number(c.p.grow)))
    },
  },
  {
    type: 'geo-merge', name: 'Join shapes', group: 'Geometry', about: 'Puts shapes together into one', inputs: [GEO('a', 'a'), GEO('b', 'b'), GEO('c', 'c')], outputs: [GEO()], params: [],
    run: (c) => {
      const list = ['a', 'b', 'c'].map((k) => inGeo(c, k)).filter((x): x is GeoRef => Boolean(x))
      if (!list.length) return { out: null }
      return cached(c, list.map((x) => x.v), false, (g) => g.merge(list.map((x) => x.geo as never)))
    },
  },
  {
    type: 'geo-out', name: 'Shape out', group: 'Geometry', about: 'Puts the shape in the 3D playground, where you give it a material, lights and links',
    inputs: [GEO('in', 'shape')], outputs: [], params: [{ key: 'name', label: 'Name', kind: 'text', default: 'Node shape' }],
    run: (c) => {
      const s = inGeo(c)
      const name = String(c.p.name) || 'Node shape'
      if (c.state.name && c.state.name !== name) dropShape(String(c.state.name))
      c.state.name = name
      if (!s) return
      if (s.v !== c.state.v) {
        c.state.v = s.v
        putShape(name, s.geo, c.id)
      }
      if (!c.state.placed) {
        c.state.placed = 1
        // Make sure the 3D scene has an object showing this shape.
        import('../three/world').then((w) => {
          if (!w.getWorld().objects.some((o) => o.kind === 'shape' && o.shape === name)) {
            w.addObject(w.newObject('shape', { name, shape: name, position: [0, 1, 0] }))
          }
        })
      }
    },
    release: (s) => { if (s.name) dropShape(String(s.name)) },
  },
]
