import { describe, expect, it } from 'vitest'
import { maskPointsAt, type Mask } from './scene'

describe('rotoscoping mask keys', () => {
  const m: Mask = {
    id: 'm', name: 'Roto', kind: 'path', mode: 0, x: 0, y: 0, w: 1, h: 1, feather: 0, expand: 0, opacity: 1,
    points: [[0, 0], [1, 0], [1, 1]],
    pathKeys: [{ t: 0, points: [[0, 0], [1, 0], [1, 1]] }, { t: 2, points: [[1, 0], [2, 0], [2, 1]] }],
  }
  it('holds before the first key and after the last', () => {
    expect(maskPointsAt(m, -1)[0]).toEqual([0, 0])
    expect(maskPointsAt(m, 5)[0]).toEqual([1, 0])
  })
  it('glides between keys', () => {
    expect(maskPointsAt(m, 1)[0][0]).toBeCloseTo(0.5, 5)
    const early = maskPointsAt(m, 0.2)[0][0]
    expect(early).toBeGreaterThan(0)
    expect(early).toBeLessThan(0.1)    // eased, so slow at the start
  })
  it('without keys the path stays still', () => {
    expect(maskPointsAt({ ...m, pathKeys: undefined }, 1)).toEqual(m.points)
  })
})
