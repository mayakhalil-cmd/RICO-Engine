import { describe, expect, it } from 'vitest'
import { adalight, artnet, ddp, ledPoints, opc, sacn, shape, wledUdp } from './ledProtocols'

describe('LED packets', () => {
  it('reorders colors and splits off white', () => {
    expect([...shape(new Uint8Array([10, 20, 30]), 'GRB')]).toEqual([20, 10, 30])
    expect([...shape(new Uint8Array([50, 60, 70]), 'RGB', 1, 1, true)]).toEqual([0, 10, 20, 50])
  })
  it('DDP splits big frames and pushes on the last', () => {
    const p = ddp(new Uint8Array(3000), 1)
    expect(p.length).toBe(3)
    expect(p[0][0]).toBe(0x40)
    expect(p[2][0]).toBe(0x41)
    expect((p[1][6] << 8) | p[1][7]).toBe(1440)
  })
  it('Art-Net: 170 LEDs per universe, even length', () => {
    const p = artnet(new Uint8Array(600), 3, 9)
    expect(p.length).toBe(2)
    expect(String.fromCharCode(...p[0].subarray(0, 7))).toBe('Art-Net')
    expect(p[0][14]).toBe(3)
    expect(p[1][14]).toBe(4)
    expect((p[1][16] << 8) | p[1][17]).toBe(90)
  })
  it('sACN header lengths and universe', () => {
    const [p] = sacn(new Uint8Array(30), 7, 1)
    expect(p.length).toBe(156)
    expect((p[113] << 8) | p[114]).toBe(7)
    expect(((p[123] << 8) | p[124])).toBe(31)
    expect(((p[16] << 8) | p[17]) & 0x0fff).toBe(140)
  })
  it('WLED, OPC and Adalight headers', () => {
    expect(wledUdp(new Uint8Array(3 * 500)).length).toBe(2)
    expect([...opc(new Uint8Array(6)).subarray(0, 4)]).toEqual([0, 0, 0, 6])
    const a = adalight(new Uint8Array(3 * 60))
    expect([...a.subarray(0, 6)]).toEqual([65, 100, 97, 0, 59, 0 ^ 59 ^ 0x55])
  })
  it('a serpentine grid snakes back on every other row', () => {
    const pts = ledPoints({ shape: 'matrix', count: 0, cols: 3, rows: 2, serpentine: true, vertical: false, area: [0, 0, 1, 1] })
    expect(pts[3]).toEqual([1, 1])
    expect(pts[5]).toEqual([0, 1])
  })
})
