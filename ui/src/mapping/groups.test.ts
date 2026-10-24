import { describe, expect, it } from 'vitest'
import { attachMask, clipLayers, moveGroup, stackGroups, stepGroup, type OutputMap } from './model'

const map = (): OutputMap => ({
  surfaces: [{ id: 's1' }, { id: 's2' }], masks: [{ id: 'k1', clip: true }, { id: 'k2' }], order: ['s1', 'k1', 's2', 'k2'],
} as unknown as OutputMap)

describe('masks under the surface they mask', () => {
  it('groups a clipped mask with the surface under it', () => {
    const g = stackGroups(map())
    expect(g.map((x) => [x.head.id, x.clips])).toEqual([['s1', ['k1']], ['s2', []], ['k2', []]])
  })
  it('moves a surface with its masks', () => {
    const m = stepGroup(map(), 's1', 1)
    expect(m.order).toEqual(['s2', 's1', 'k1', 'k2'])
    expect(clipLayers(m).get('s1')?.map((k) => k.id)).toEqual(['k1'])
  })
  it('puts a mask under another surface, and takes it out again', () => {
    const m = attachMask(map(), 'k2', 's2')
    expect(clipLayers(m).get('s2')?.map((k) => k.id)).toEqual(['k2'])
    const n = moveGroup(m, 'k1', 's2', 'above')
    expect(n.masks.find((k) => k.id === 'k1')?.clip).toBe(false)
    expect(clipLayers(n).get('s1')).toBeUndefined()
  })
})
