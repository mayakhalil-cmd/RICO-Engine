import type { Ease, Track } from './scene'

// Keyframe maths, kept free of the browser so it can be tested on its own.

export function ease(t: number, e: Ease) {
  switch (e) {
    case 'hold': return 0
    case 'in': return t * t * t
    case 'out': return 1 - Math.pow(1 - t, 3)
    case 'smooth': return t * t * (3 - 2 * t)
    default: return t
  }
}

export function valueAt(track: Track, t: number): number | undefined {
  const k = track.keys
  if (!k.length) return undefined
  if (t <= k[0].t) return k[0].v
  if (t >= k[k.length - 1].t) return k[k.length - 1].v
  for (let i = 0; i < k.length - 1; i++) {
    const a = k[i], b = k[i + 1]
    if (t >= a.t && t < b.t) {
      const u = (t - a.t) / (b.t - a.t || 1)
      return a.v + (b.v - a.v) * ease(u, a.ease)
    }
  }
  return k[k.length - 1].v
}

