import { describe, expect, it } from 'vitest'
import { cutOrder, goboLoops, laserGcode, LASER_DEFAULTS } from './laser'

const square = (x: number, y: number, s: number) => [x, y, x + s, y, x + s, y + s, x, y + s]

describe('laser', () => {
  it('cuts the holes before the plate around them', () => {
    const plate = square(0, 0, 50), hole = square(10, 10, 5), hole2 = square(30, 30, 5)
    const order = cutOrder([plate, hole, hole2])
    expect(order[order.length - 1]).toBe(plate)
  })
  it('a gobo plate: openings, screw holes, then the edge', () => {
    const p = { openings: [[[-10, -5], [10, -5], [10, 5], [-10, 5]]] as [number, number][][], items: [], plate: [-20, -15, 20, 15] as [number, number, number, number], pictureW: 1, pictureH: 1, soft: 0, holes: [[-17, 0], [17, 0]] as [number, number][] }
    const loops = goboLoops(p, 3, 3.4)
    expect(loops.length).toBe(4)
    // from the bottom left corner of the plate
    expect(Math.min(...loops[3].filter((_, i) => i % 2 === 0))).toBeCloseTo(0, 5)
    expect(Math.max(...loops[3].filter((_, i) => i % 2 === 0))).toBeCloseTo(40, 5)
  })
  it('G-code: power from the settings, laser off at the end, every pass', () => {
    const g = laserGcode([{ loops: [square(0, 0, 10)], at: [5, 5] }], { ...LASER_DEFAULTS, power: 0.5, maxS: 1000, passes: 2, speed: 600 })
    expect(g.text).toContain('M4 S0')
    expect(g.text).toContain('S500 F600')
    expect(g.text.trim().split('\n').filter((l) => l.startsWith('G0 X5 Y5')).length).toBe(2)
    expect(g.text).toMatch(/M5 ; laser off/)
    expect(g.length).toBeCloseTo(80, 5)
    // 40 mm at 600 mm/min, twice: 8 s, plus a little
    expect(g.seconds).toBeGreaterThan(8)
  })
})
