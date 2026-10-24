import { describe, expect, it } from 'vitest'
import { grow, selectionToMasks, wand } from './photoMask'

describe('photo masks', () => {
  // A 40 x 30 photo: dark, with a bright square from (10, 8) to (29, 21).
  const w = 40, h = 30
  const px = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const on = x >= 10 && x < 30 && y >= 8 && y < 22
    px.set(on ? [230, 220, 210, 255] : [20, 25, 30, 255], (y * w + x) * 4)
  }
  const photo = { w, h, px }

  it('the wand picks the square and nothing else', () => {
    const sel = wand(photo, 15, 12, 0.1)
    expect(sel.reduce((a, b) => a + b, 0)).toBe(20 * 14)
    expect(sel[0]).toBe(0)
  })

  it('grow adds a ring of pixels', () => {
    const sel = wand(photo, 15, 12, 0.1)
    expect(grow(sel, w, h, 1).reduce((a, b) => a + b, 0)).toBeGreaterThan(20 * 14)
  })

  it('the outline lands where the square is, in output units', () => {
    const sel = wand(photo, 15, 12, 0.1)
    const masks = selectionToMasks(sel, w, h, [[0, 0], [1, 0], [1, 1], [0, 1]])
    expect(masks.length).toBe(1)
    const xs = masks[0].map((p) => p[0]), ys = masks[0].map((p) => p[1])
    expect(Math.min(...xs)).toBeCloseTo(10.5 / w, 2)
    expect(Math.max(...xs)).toBeCloseTo(29.5 / w, 2)
    expect(Math.min(...ys)).toBeCloseTo(8.5 / h, 2)
  })

  it('a photo corner quad moves the mask into the projector picture', () => {
    // The projector picture fills only the middle half of the photo.
    const sel = wand(photo, 15, 12, 0.1)
    const masks = selectionToMasks(sel, w, h, [[0.25, 0.25], [0.75, 0.25], [0.75, 0.75], [0.25, 0.75]])
    const xs = masks[0].map((p) => p[0])
    expect(Math.min(...xs)).toBeCloseTo((10.5 / w - 0.25) / 0.5, 2)
  })
})

describe('smart selections', () => {
  // A 60 x 40 photo: a grey background with a slightly uneven red square.
  const w = 60, h = 40
  const px = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const on = x >= 20 && x < 40 && y >= 10 && y < 30
    const n = ((x * 7 + y * 13) % 9) - 4
    px.set(on ? [200 + n, 40 + n, 50, 255] : [120 + n, 120 + n, 125, 255], (y * w + x) * 4)
  }
  const photo = { w, h, px }
  const count = (s: Uint8Array) => s.reduce((a, b) => a + b, 0)
  it('smart select follows the square', async () => {
    const { smartSelect } = await import('./photoMask')
    const n = count(smartSelect(photo, 30, 20, 0.3))
    expect(n).toBeGreaterThan(20 * 20 * 0.9)
    expect(n).toBeLessThan(22 * 22 * 1.1)
  })
  it('a box around it finds the square', async () => {
    const { boxSelect } = await import('./photoMask')
    const n = count(boxSelect(photo, 12, 4, 48, 36))
    expect(n).toBeGreaterThan(20 * 20 * 0.85)
    expect(n).toBeLessThan(20 * 20 * 1.15)
  })
})
