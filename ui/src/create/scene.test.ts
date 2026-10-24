import { describe, expect, it } from 'vitest'
import { LAYER_TYPES } from './layers'
import { EFFECT_TYPES } from './effects'
import { newLayer, repair, starterScene } from './scene'

describe('scenes', () => {
  it('starter scene survives a save and load', () => {
    const s = starterScene()
    expect(repair(JSON.parse(JSON.stringify(s)))).toEqual(s)
  })

  it('fills in missing settings and drops unknown layers', () => {
    const s = repair({ name: 'old', layers: [{ type: 'noise', values: { scale: 5 } }, { type: 'nope' }] })!
    expect(s.layers).toHaveLength(1)
    expect(s.layers[0].values.scale).toBe(5)
    expect(s.layers[0].values.speed).toBeDefined()
    expect(s.master.values.trails).toBeDefined()
  })

  it('rejects files that are not scenes', () => {
    expect(repair(null)).toBeNull()
    expect(repair({ hello: 1 })).toBeNull()
  })

  it('every layer type has at most 16 numbers and 4 colors', () => {
    for (const t of LAYER_TYPES) {
      const numbers = t.params.filter((p) => p.kind === 'number' || p.kind === 'choice')
      const colors = t.params.filter((p) => p.kind === 'color')
      expect(numbers.length).toBeLessThanOrEqual(16)
      expect(colors.length).toBeLessThanOrEqual(4)
      expect(newLayer(t.id).type).toBe(t.id)
    }
  })

  it('every effect fits the shader slots', () => {
    for (const e of EFFECT_TYPES) {
      expect(e.params.filter((p) => p.kind === 'number' || p.kind === 'choice').length).toBeLessThanOrEqual(16)
      expect(e.params.filter((p) => p.kind === 'color').length).toBeLessThanOrEqual(4)
    }
  })
})
