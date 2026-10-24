import { describe, expect, it } from 'vitest'
import { project, solve, type Pair, type Solved, type V3 } from './calib'

describe('projector calibration', () => {
  const W = 1920, H = 1080
  // A projector 3 m away, a little to the left and above, looking at the origin.
  const a = 0.3, b = -0.2
  const Ry = [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)]
  const Rx = [1, 0, 0, 0, Math.cos(b), -Math.sin(b), 0, Math.sin(b), Math.cos(b)]
  const mul = (p: number[], q: number[]) => { const o = new Array(9).fill(0); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += p[r * 3 + k] * q[k * 3 + c]; return o }
  const truth: Solved = { K: [2200, 0, 960, 0, 2200, 1300, 0, 0, 1], R: mul(Rx, Ry), t: [0.2, -0.1, 3], error: 0 }
  const pts: V3[] = [[0, 0, 0], [0.5, 0, 0], [0, 0.5, 0], [0, 0, 0.5], [0.4, 0.3, 0.2], [-0.3, 0.2, 0.4], [0.2, -0.3, -0.2], [-0.4, -0.2, 0.1]]
  const pairs: Pair[] = pts.map((p) => { const [x, y] = project(truth, p); return { p, uv: [x / W, y / H] } })

  it('finds the projector from eight points', () => {
    const s = solve(pairs, W, H)!
    expect(s).not.toBeNull()
    expect(s.error).toBeLessThan(0.01)
    expect(Math.abs(s.K[0] - 2200)).toBeLessThan(1)
    expect(Math.abs(s.K[5] - 1300)).toBeLessThan(1)
    expect(Math.abs(s.t[2] - 3)).toBeLessThan(0.01)
  })

  it('stays close with a few pixels of clicking error', () => {
    const noisy = pairs.map((x, i) => ({ ...x, uv: [x.uv[0] + ((i % 3) - 1) * 2 / W, x.uv[1] + ((i % 2) * 2 - 1) * 2 / H] as [number, number] }))
    const s = solve(noisy, W, H)!
    expect(s.error).toBeLessThan(4)
  })

  it('needs six points', () => {
    expect(solve(pairs.slice(0, 5), W, H)).toBeNull()
  })
})
