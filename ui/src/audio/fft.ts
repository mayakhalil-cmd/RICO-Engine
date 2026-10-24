// A plain radix-2 FFT, fast enough for 16384 points many times a second.
// Used by the analysis worker and the sound editor's spectrum view.

export class FFT {
  readonly n: number
  private rev: Uint32Array
  private cos: Float64Array
  private sin: Float64Array
  readonly re: Float64Array
  readonly im: Float64Array

  constructor(n: number) {
    if (n & (n - 1)) throw new Error('FFT size must be a power of two')
    this.n = n
    this.re = new Float64Array(n)
    this.im = new Float64Array(n)
    this.rev = new Uint32Array(n)
    const bits = Math.log2(n)
    for (let i = 0; i < n; i++) {
      let r = 0
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b)
      this.rev[i] = r
    }
    this.cos = new Float64Array(n / 2)
    this.sin = new Float64Array(n / 2)
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n)
      this.sin[i] = -Math.sin((2 * Math.PI * i) / n)
    }
  }

  // Transforms re/im in place.
  run() {
    const { n, re, im, rev } = this
    for (let i = 0; i < n; i++) {
      const j = rev[i]
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t
        t = im[i]; im[i] = im[j]; im[j] = t
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1
      const step = n / size
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const wr = this.cos[k * step], wi = this.sin[k * step]
          const a = start + k, b = a + half
          const xr = re[b] * wr - im[b] * wi
          const xi = re[b] * wi + im[b] * wr
          re[b] = re[a] - xr; im[b] = im[a] - xi
          re[a] += xr; im[a] += xi
        }
      }
    }
  }
}

export function hann(n: number): Float64Array {
  const w = new Float64Array(n)
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))
  return w
}

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
export function noteName(hz: number): string {
  if (!(hz > 0)) return '-'
  const midi = 69 + 12 * Math.log2(hz / 440)
  const n = Math.round(midi)
  const cents = Math.round((midi - n) * 100)
  return `${NOTE_NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}${cents ? ` ${cents > 0 ? '+' : ''}${cents}c` : ''}`
}
