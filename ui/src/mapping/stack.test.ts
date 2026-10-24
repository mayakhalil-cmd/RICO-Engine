import { describe, expect, it } from 'vitest'
import { clipLayers, maskLayers, moveInStack, newMask, newSurface, stackOf, surfacesInOrder, type OutputMap } from './model'

const base = (): OutputMap => ({
  id: 'o', surfaces: [newSurface({ id: 'a', name: 'A' }), newSurface({ id: 'b', name: 'B' })], masks: [newMask({ id: 'm', name: 'M' })],
  test: false, brightness: 1, softLeft: 0, softRight: 0, softTop: 0, softBottom: 0, softGamma: 2.2, showPoints: false, res: [1920, 1080], pairs: [], solved: null,
})

describe('layer stack', () => {
  it('a new mask goes on top and covers what is under it', () => {
    const m = base()
    expect(stackOf(m).map((x) => x.id)).toEqual(['a', 'b', 'm'])
    expect(maskLayers(m).get('b')?.map((x) => x.id)).toEqual(['m'])
  })
  it('a mask moved between two surfaces covers only the one under it', () => {
    const m = moveInStack(base(), 'm', 'a', 'above')
    expect(stackOf(m).map((x) => x.id)).toEqual(['a', 'm', 'b'])
    expect(maskLayers(m).get('a')?.length).toBe(1)
    expect(maskLayers(m).get('b')).toBeUndefined()
  })
  it('a clipped mask is only for the layer right under it', () => {
    const m = { ...base(), masks: [newMask({ id: 'm', clip: true })] }
    expect(maskLayers(m).size).toBe(0)
    expect(clipLayers(m).get('b')?.length).toBe(1)
  })
  it('surfaces are drawn in the stack order', () => {
    const m = moveInStack(base(), 'a', 'b', 'above')
    expect(surfacesInOrder(m).map((s) => s.id)).toEqual(['b', 'a'])
  })
  it('older files: a mask on a surface stays there', () => {
    const m = { ...base(), masks: [newMask({ id: 'm', over: 'a' })] }
    expect(stackOf(m).map((x) => x.id)).toEqual(['a', 'm', 'b'])
  })
})
