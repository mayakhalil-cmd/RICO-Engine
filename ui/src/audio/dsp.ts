import type { Shape } from './types'

// Small filter helpers shared by the analysis thread and the drawings.

export interface Biquad { b0: number; b1: number; b2: number; a1: number; a2: number }

// Standard "Audio EQ Cookbook" filters (Robert Bristow-Johnson).
export function rbj(kind: 'hp' | 'lp' | 'low' | 'high' | 'bell', f: number, q: number, dbGain: number, rate: number): Biquad {
  const w = (2 * Math.PI * Math.min(f, rate * 0.45)) / rate
  const cw = Math.cos(w), sw = Math.sin(w)
  const A = Math.pow(10, dbGain / 40)
  const al = sw / (2 * q)
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number
  if (kind === 'hp') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al }
  else if (kind === 'lp') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al }
  else if (kind === 'bell') { b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A }
  else {
    const sa = 2 * Math.sqrt(A) * (sw / 2) * Math.SQRT2   // shelf slope 1
    if (kind === 'low') { b0 = A * (A + 1 - (A - 1) * cw + sa); b1 = 2 * A * (A - 1 - (A + 1) * cw); b2 = A * (A + 1 - (A - 1) * cw - sa); a0 = A + 1 + (A - 1) * cw + sa; a1 = -2 * (A - 1 + (A + 1) * cw); a2 = A + 1 + (A - 1) * cw - sa }
    else { b0 = A * (A + 1 + (A - 1) * cw + sa); b1 = -2 * A * (A - 1 + (A + 1) * cw); b2 = A * (A + 1 + (A - 1) * cw - sa); a0 = A + 1 - (A - 1) * cw + sa; a1 = 2 * (A - 1 - (A + 1) * cw); a2 = A + 1 - (A - 1) * cw - sa }
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 }
}

// How many dB a filter adds at a frequency.
export function responseDb(f: Biquad, hz: number, rate: number): number {
  const w = (2 * Math.PI * hz) / rate
  const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w)
  const nr = f.b0 + f.b1 * c1 + f.b2 * c2, ni = -(f.b1 * s1 + f.b2 * s2)
  const dr = 1 + f.a1 * c1 + f.a2 * c2, di = -(f.a1 * s1 + f.a2 * s2)
  return 10 * Math.log10((nr * nr + ni * ni) / Math.max(1e-30, dr * dr + di * di))
}

export function shapeFilters(sh: Shape, rate: number): Biquad[] {
  const out: Biquad[] = []
  if (sh.hp > 0) out.push(rbj('hp', sh.hp, 0.707, 0, rate))
  if (sh.low) out.push(rbj('low', 120, 0.707, sh.low, rate))
  if (sh.mid) out.push(rbj('bell', sh.midHz, Math.max(0.1, sh.midQ), sh.mid, rate))
  if (sh.high) out.push(rbj('high', 6000, 0.707, sh.high, rate))
  if (sh.lp > 0) out.push(rbj('lp', sh.lp, 0.707, 0, rate))
  return out
}
