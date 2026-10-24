// Packets for LED controllers and home-made hardware. Pure functions: pixels
// (r, g, b bytes, one LED after another) in, packets out.

export type Order = 'RGB' | 'GRB' | 'BRG' | 'RBG' | 'GBR' | 'BGR'

// Colors in the order the LED chips want, with brightness, gamma and an
// optional white channel (RGBW strips: white takes what all three share).
export function shape(rgb: Uint8Array, order: Order, brightness = 1, gamma = 1, white = false): Uint8Array {
  const n = Math.floor(rgb.length / 3)
  const per = white ? 4 : 3
  const out = new Uint8Array(n * per)
  const lut = new Uint8Array(256)
  for (let i = 0; i < 256; i++) lut[i] = Math.max(0, Math.min(255, Math.round(Math.pow(i / 255, gamma) * 255 * brightness)))
  const idx = { R: 0, G: 1, B: 2 }
  const map = order.split('').map((c) => idx[c as 'R' | 'G' | 'B'])
  for (let i = 0; i < n; i++) {
    let r = lut[rgb[i * 3]], g = lut[rgb[i * 3 + 1]], b = lut[rgb[i * 3 + 2]]
    let w = 0
    if (white) { w = Math.min(r, g, b); r -= w; g -= w; b -= w }
    const c = [r, g, b]
    out[i * per] = c[map[0]]; out[i * per + 1] = c[map[1]]; out[i * per + 2] = c[map[2]]
    if (white) out[i * per + 3] = w
  }
  return out
}

// DDP (WLED, ESPixelStick, xLights): 10 byte header, up to 1440 bytes each.
export function ddp(data: Uint8Array, seq: number): Uint8Array[] {
  const out: Uint8Array[] = []
  const MAX = 1440
  for (let off = 0; off < data.length || off === 0; off += MAX) {
    const chunk = data.subarray(off, Math.min(data.length, off + MAX))
    const last = off + MAX >= data.length
    const p = new Uint8Array(10 + chunk.length)
    p[0] = 0x40 | (last ? 0x01 : 0)        // version 1, push on the last packet
    p[1] = seq & 0x0f
    p[2] = 0x0b                              // RGB, 8 bits each
    p[3] = 0x01                              // the default output
    p[4] = (off >>> 24) & 255; p[5] = (off >>> 16) & 255; p[6] = (off >>> 8) & 255; p[7] = off & 255
    p[8] = (chunk.length >> 8) & 255; p[9] = chunk.length & 255
    p.set(chunk, 10)
    out.push(p)
    if (!data.length) break
  }
  return out
}

// WLED realtime UDP (DNRGB): up to 489 LEDs a packet, with a start index.
export function wledUdp(rgb: Uint8Array, timeout = 2): Uint8Array[] {
  const out: Uint8Array[] = []
  const n = Math.floor(rgb.length / 3)
  for (let start = 0; start < n || start === 0; start += 489) {
    const count = Math.min(489, n - start)
    const p = new Uint8Array(4 + count * 3)
    p[0] = 4; p[1] = timeout; p[2] = (start >> 8) & 255; p[3] = start & 255
    p.set(rgb.subarray(start * 3, (start + count) * 3), 4)
    out.push(p)
    if (!n) break
  }
  return out
}

// Art-Net ArtDmx: 512 channels a universe (170 RGB LEDs), universes in a row.
export function artnet(data: Uint8Array, universe: number, seq: number, perUniverse = 510): Uint8Array[] {
  const out: Uint8Array[] = []
  for (let u = 0, off = 0; off < data.length || u === 0; u++, off += perUniverse) {
    const chunk = data.subarray(off, Math.min(data.length, off + perUniverse))
    const len = chunk.length + (chunk.length & 1)
    const p = new Uint8Array(18 + Math.max(2, len))
    p.set([65, 114, 116, 45, 78, 101, 116, 0])  // "Art-Net\0"
    p[8] = 0x00; p[9] = 0x50                       // OpDmx, little end first
    p[10] = 0; p[11] = 14                          // protocol 14
    p[12] = seq & 255; p[13] = 0
    const uni = universe + u
    p[14] = uni & 255; p[15] = (uni >> 8) & 0x7f
    p[16] = (Math.max(2, len) >> 8) & 255; p[17] = Math.max(2, len) & 255
    p.set(chunk, 18)
    out.push(p)
    if (!data.length) break
  }
  return out
}

// sACN (E1.31), unicast: one 638 byte packet per universe.
const CID = Array.from({ length: 16 }, (_, i) => (i * 37 + 11) & 255)
export function sacn(data: Uint8Array, universe: number, seq: number, perUniverse = 510, name = 'RICO'): Uint8Array[] {
  const out: Uint8Array[] = []
  for (let u = 0, off = 0; off < data.length || u === 0; u++, off += perUniverse) {
    const chunk = data.subarray(off, Math.min(data.length, off + perUniverse))
    const slots = chunk.length + 1
    const p = new Uint8Array(126 + chunk.length)
    const dv = new DataView(p.buffer)
    // root layer
    dv.setUint16(0, 0x0010); dv.setUint16(2, 0)
    p.set([0x41, 0x53, 0x43, 0x2d, 0x45, 0x31, 0x2e, 0x31, 0x37, 0, 0, 0], 4)
    dv.setUint16(16, 0x7000 | (p.length - 16)); dv.setUint32(18, 0x00000004)
    p.set(CID, 22)
    // framing layer
    dv.setUint16(38, 0x7000 | (p.length - 38)); dv.setUint32(40, 0x00000002)
    for (let i = 0; i < Math.min(63, name.length); i++) p[44 + i] = name.charCodeAt(i) & 127
    p[108] = 100                                       // priority
    dv.setUint16(109, 0)                                // sync address
    p[111] = seq & 255; p[112] = 0
    dv.setUint16(113, Math.max(1, universe + u))
    // DMP layer
    dv.setUint16(115, 0x7000 | (p.length - 115)); p[117] = 0x02; p[118] = 0xa1
    dv.setUint16(119, 0); dv.setUint16(121, 1); dv.setUint16(123, slots)
    p[125] = 0                                          // start code
    p.set(chunk, 126)
    out.push(p)
    if (!data.length) break
  }
  return out
}

// Open Pixel Control (Fadecandy, many Raspberry Pi LED servers), over TCP.
export function opc(data: Uint8Array, channel = 0): Uint8Array {
  const p = new Uint8Array(4 + data.length)
  p[0] = channel; p[1] = 0; p[2] = (data.length >> 8) & 255; p[3] = data.length & 255
  p.set(data, 4)
  return p
}

// Adalight over USB serial (Arduino with FastLED, and many ESP sketches).
export function adalight(data: Uint8Array, per = 3): Uint8Array {
  const n = Math.max(1, Math.floor(data.length / per)) - 1
  const hi = (n >> 8) & 255, lo = n & 255
  const p = new Uint8Array(6 + data.length)
  p.set([65, 100, 97, hi, lo, hi ^ lo ^ 0x55])  // "Ada", count - 1, checksum
  p.set(data, 6)
  return p
}

export function toB64(u: Uint8Array): string {
  let s = ''
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000))
  return btoa(s)
}

// Where each LED sits on the picture (0..1), for a strip, a grid or a ring.
export interface Layout { shape: 'strip' | 'matrix' | 'ring'; count: number; cols: number; rows: number; serpentine: boolean; vertical: boolean; area: [number, number, number, number] }
export function ledPoints(l: Layout): [number, number][] {
  const [x0, y0, x1, y1] = l.area
  const pts: [number, number][] = []
  if (l.shape === 'strip') {
    const n = Math.max(1, l.count)
    for (let i = 0; i < n; i++) { const t = n === 1 ? 0.5 : i / (n - 1); pts.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]) }
  } else if (l.shape === 'ring') {
    const n = Math.max(1, l.count)
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = Math.abs(x1 - x0) / 2, ry = Math.abs(y1 - y0) / 2
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 - Math.PI / 2; pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]) }
  } else {
    const C = Math.max(1, l.cols), R = Math.max(1, l.rows)
    const at = (c: number, r: number): [number, number] => [x0 + (x1 - x0) * (C === 1 ? 0.5 : c / (C - 1)), y0 + (y1 - y0) * (R === 1 ? 0.5 : r / (R - 1))]
    if (l.vertical) {
      for (let c = 0; c < C; c++) for (let k = 0; k < R; k++) { const r = l.serpentine && c % 2 ? R - 1 - k : k; pts.push(at(c, r)) }
    } else {
      for (let r = 0; r < R; r++) for (let k = 0; k < C; k++) { const c = l.serpentine && r % 2 ? C - 1 - k : k; pts.push(at(c, r)) }
    }
  }
  return pts
}
