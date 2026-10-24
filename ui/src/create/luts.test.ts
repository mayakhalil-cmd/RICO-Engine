import { describe, expect, it } from 'vitest'
import { bakeCurves, cubeText, curveAt, labToRgb, lutBytes, makeLut, matchLut, parseCube, rgbToLab } from './luts'

describe('luts', () => {
  it('reads back a .cube it wrote', () => {
    const l = makeLut('test', 9, (r, g, b) => [1 - r, g * g, b])
    const back = parseCube(cubeText(l), 'back')
    expect(back.size).toBe(9)
    const a = lutBytes(l), b = lutBytes(back)
    for (let i = 0; i < a.length; i++) expect(Math.abs(a[i] - b[i])).toBeLessThanOrEqual(1)
  })

  it('brings big LUTs down to 33 points', () => {
    const big = makeLut('big', 40, (r, g, b) => [r, g, b])
    expect(parseCube(cubeText(big), 'x').size).toBe(33)
  })

  it('goes to Lab and back', () => {
    for (const c of [[0.2, 0.5, 0.9], [1, 1, 1], [0, 0, 0], [0.9, 0.1, 0.3]] as [number, number, number][]) {
      const back = labToRgb(...rgbToLab(...c))
      back.forEach((v, i) => expect(Math.abs(v - c[i])).toBeLessThan(0.01))
    }
  })

  it('matching a frame to itself changes almost nothing', () => {
    const px = new Uint8Array(64 * 4)
    for (let i = 0; i < 64; i++) px.set([i * 4, 255 - i * 3, (i * 7) % 255, 255], i * 4)
    const l = matchLut(px, px, 'same')
    const bytes = lutBytes(l)
    // the middle gray point stays gray-ish
    const mid = (16 + 16 * 33 + 16 * 33 * 33) * 3
    expect(Math.abs(bytes[mid] - 128)).toBeLessThan(24)
  })

  it('curves are a straight line by default and never overshoot', () => {
    const flat = bakeCurves('')
    expect(flat[0]).toBe(0)
    expect(flat[255 * 4]).toBe(255)
    expect(flat[128 * 4]).toBe(128)
    const pts: [number, number][] = [[0, 0], [0.5, 0.9], [1, 1]]
    for (let x = 0; x <= 1; x += 0.05) expect(curveAt(pts, x)).toBeLessThanOrEqual(1.0001)
  })
})
