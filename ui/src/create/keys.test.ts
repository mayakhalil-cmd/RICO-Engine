import { describe, expect, it } from 'vitest'
import { ease, valueAt } from './keys'
import type { Track } from './scene'

const track: Track = {
  target: 'a.size',
  keys: [
    { t: 0, v: 0, ease: 'linear' },
    { t: 2, v: 10, ease: 'hold' },
    { t: 4, v: 20, ease: 'smooth' },
    { t: 6, v: 0, ease: 'linear' },
  ],
}

describe('keyframes', () => {
  it('holds the first and last value outside the keys', () => {
    expect(valueAt(track, -1)).toBe(0)
    expect(valueAt(track, 99)).toBe(0)
  })
  it('goes in a straight line between linear keys', () => {
    expect(valueAt(track, 1)).toBeCloseTo(5)
  })
  it('jumps at the next key after a hold key', () => {
    expect(valueAt(track, 3.9)).toBe(10)
    expect(valueAt(track, 4)).toBe(20)
  })
  it('eases smoothly and stays in range', () => {
    expect(valueAt(track, 5)).toBeCloseTo(10)
    expect(ease(0.5, 'in')).toBeLessThan(0.5)
    expect(ease(0.5, 'out')).toBeGreaterThan(0.5)
  })
  it('has nothing to say without keys', () => {
    expect(valueAt({ target: 'x', keys: [] }, 1)).toBeUndefined()
  })
})
