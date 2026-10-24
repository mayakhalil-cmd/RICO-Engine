import { describe, expect, it } from 'vitest'
import { contours, softEdge, GOBO_DEFAULTS } from './gobo'

const area = (p: [number, number][]) => Math.abs(p.reduce((s, [x, y], i) => { const [x2, y2] = p[(i + 1) % p.length]; return s + x * y2 - x2 * y }, 0) / 2)

describe('gobo outlines', () => {
  it('traces a rectangle and a second shape', () => {
    const w = 60, h = 40
    const on = new Uint8Array(w * h)
    for (let y = 5; y < 25; y++) for (let x = 5; x < 35; x++) on[y * w + x] = 1
    for (let y = 28; y < 38; y++) for (let x = 40; x < 55; x++) on[y * w + x] = 1
    const c = contours(on, w, h)
    expect(c.length).toBe(2)
    expect(Math.abs(area(c[0]) - 29 * 19)).toBeLessThan(3)
    expect(c[0].length).toBeLessThanOrEqual(6)
  })
  it('traces a triangle', () => {
    const w = 50, h = 50
    const on = new Uint8Array(w * h)
    for (let y = 0; y < 40; y++) for (let x = 5; x < 5 + y; x++) on[y * w + x] = 1
    const c = contours(on, w, h)
    expect(c.length).toBe(1)
    expect(area(c[0])).toBeGreaterThan(600)
  })
  it('a plate further from the lens has a sharper edge', () => {
    expect(softEdge({ ...GOBO_DEFAULTS, distance: 120 })).toBeLessThan(softEdge({ ...GOBO_DEFAULTS, distance: 40 }))
  })
})

describe('stencil parts', () => {
  const p = { openings: [[[-20, -10], [20, -10], [20, 10], [-20, 10]]] as [number, number][][], items: [], plate: [-40, -30, 40, 30] as [number, number, number, number], pictureW: 100, pictureH: 56, soft: 0.1, holes: [[-35, 0], [35, 0]] as [number, number][] }
  it('a flat stencil uses far less filament than a hood', async () => {
    const { goboGeometry, filament, goboOptions } = await import('./gobo')
    const flat = filament(await goboGeometry(p, goboOptions({ style: 'flat' })))
    const legs = filament(await goboGeometry(p, goboOptions({ style: 'legs' })))
    const hood = filament(await goboGeometry(p, goboOptions({ style: 'hood' })))
    // plate 80 x 60 x 1.2 minus a 40 x 20 opening and two holes: about 4.7 cm3
    expect(flat.cm3).toBeGreaterThan(4)
    expect(flat.cm3).toBeLessThan(5.2)
    expect(legs.cm3).toBeLessThan(hood.cm3)
    expect(flat.cm3 * 3).toBeLessThan(hood.cm3)
  })
})

describe('gobos on the lens', () => {
  const p = { openings: [[[-20, -10], [20, -10], [20, 10], [-20, 10]]] as [number, number][][], items: [], plate: [-40, -40, 40, 40] as [number, number, number, number], pictureW: 100, pictureH: 56, soft: 0.1, holes: [] as [number, number][], round: 40, reach: 22.4 }
  it('over the lens: the sleeve is the barrel plus the room, the plate at the length', async () => {
    const { goboGeometry, goboOptions, sleeveRadii } = await import('./gobo')
    const o = goboOptions({ style: 'over', lensDiameter: 55, fit: 0.15, sleeve: 12, distance: 60, ribs: false })
    expect(sleeveRadii(o).inn).toBeCloseTo(27.65, 5)
    const g = await goboGeometry(p, o)
    g.computeBoundingBox()
    expect(g.boundingBox!.min.z).toBeCloseTo(-12, 3)
    expect(g.boundingBox!.max.z).toBeCloseTo(60 + 1.2, 2)
  })
  it('into the hole: the sleeve is the hole minus the room', async () => {
    const { goboOptions, sleeveRadii } = await import('./gobo')
    expect(sleeveRadii(goboOptions({ style: 'into', lensDiameter: 60, fit: 0.15 })).out).toBeCloseTo(29.85, 5)
  })
  it('four legs use less filament than closed walls', async () => {
    const { goboGeometry, goboOptions, filament } = await import('./gobo')
    const closed = filament(await goboGeometry(p, goboOptions({ style: 'over', body: 'cone', distance: 80 })))
    const legs = filament(await goboGeometry(p, goboOptions({ style: 'over', body: 'legs', distance: 80 })))
    expect(legs.cm3).toBeLessThan(closed.cm3)
    expect(closed.cm3).toBeGreaterThan(5)
  })
  it('older gobos open as the new kinds', async () => {
    const { goboOptions } = await import('./gobo')
    expect(goboOptions({ style: 'legs' }).style).toBe('over')
    expect(goboOptions({ style: 'plug' }).style).toBe('into')
  })
})
