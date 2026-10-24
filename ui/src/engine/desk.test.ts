import { describe, expect, it } from 'vitest'
import { aimAt, beamDir } from './desk'

const f = { id: 'f', name: 'Head', profile: 'mh', universe: 0, address: 1 }
const norm = (v: number[]) => { const l = Math.hypot(...v); return v.map((x) => x / l) }

describe('fixtures in the room', () => {
  it('a hung head aims down at the middle of tilt', () => {
    const a = aimAt(f, [0, 4, 0], [0, 0, 0])
    expect(a.tilt).toBeCloseTo(0.5, 5)
  })
  it('the 3D beam goes where the real one aims', () => {
    for (const to of [[3, 0, 2], [-2, 1, -4], [0, 0, 5], [4, 3.9, 0]] as [number, number, number][]) {
      const from: [number, number, number] = [1, 4, -1]
      const a = aimAt(f, from, to)
      const d = beamDir(f, a.pan, a.tilt)
      const want = norm([to[0] - from[0], to[1] - from[1], to[2] - from[2]])
      d.forEach((v, i) => expect(v).toBeCloseTo(want[i], 4))
    }
  })
  it('standing on the floor, and with less pan', () => {
    const g = { ...f, mount: 'up' as const, panRange: 360 }
    const a = aimAt(g, [0, 0, 0], [0, 5, -3])
    const d = beamDir(g, a.pan, a.tilt)
    const want = norm([0, 5, -3])
    d.forEach((v, i) => expect(v).toBeCloseTo(want[i], 4))
  })
})
