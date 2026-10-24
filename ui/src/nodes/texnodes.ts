import { getRenderer } from '../create/store'
import { scene3dPicture } from '../create/renderer'
import { pictureWanted, putPicture, usePicture } from '../engine/shared'
import { average, freeNode, pass, toCanvas, upload, type TexRef } from './gpu'
import { n, type NodeParam, type NodeType, type Port } from './kit'

// Texture nodes: pictures made and changed on the graphics card. Every one shows a small live
// picture. "Picture out" hands the result to Create layers and 3D materials.

const SIZES: [string, number, number][] = [
  ['Same as input', 0, 0], ['256 square', 256, 256], ['512 square', 512, 512], ['1024 square', 1024, 1024],
  ['640 x 360', 640, 360], ['1280 x 720', 1280, 720], ['1920 x 1080', 1920, 1080],
]
const RES: NodeParam = { key: 'res', label: 'Size', kind: 'choice', default: 5, choices: SIZES.map((s) => s[0]) }
const TEX = (key = 'out', label = 'picture'): Port => ({ key, label, type: 'tex' })

function size(c: { p: Record<string, unknown>; in: Record<string, unknown> }, input?: TexRef | null) {
  const [, w, h] = SIZES[Number(c.p.res)] ?? SIZES[5]
  if (w) return [w, h]
  return input ? [input.w, input.h] : [1280, 720]
}

interface TopDef {
  type: string
  name: string
  about: string
  texIn?: string[]             // texture inputs, in order u_t0, u_t1
  exposed?: string[]           // number settings that are also inputs
  params: NodeParam[]
  glsl: string | ((p: Record<string, number | string | boolean>) => string)
  feedback?: boolean
  group?: NodeType['group']
}

// A texture node from a shader. Number settings arrive as u_p[0], u_p[1]...
// in the order they are listed.
function top(d: TopDef): NodeType {
  const numeric = d.params.filter((p) => p.kind === 'number' || p.kind === 'choice' || p.kind === 'bool')
  return {
    type: d.type, name: d.name, group: d.group ?? 'Texture', about: d.about, ui: 'thumb',
    inputs: [...(d.texIn ?? []).map((k) => TEX(k, k)), ...(d.exposed ?? []).map((k) => ({ key: k, label: d.params.find((p) => p.key === k)?.label.toLowerCase() ?? k }))],
    outputs: [TEX()],
    params: [RES, ...d.params],
    run: (c) => {
      const ins = (d.texIn ?? []).map((k) => (c.in[k] && (c.in[k] as TexRef).kind === 'tex' ? (c.in[k] as TexRef) : null))
      const [w, h] = size(c, ins[0])
      const values = numeric.map((p) => (d.exposed?.includes(p.key) ? Number(c.in[p.key]) : Number(c.p[p.key])))
      const body = typeof d.glsl === 'string' ? d.glsl : d.glsl(c.p)
      if (d.feedback) {
        // Feedback: read the last frame, draw the new one into the other buffer.
        const flip = c.state.flip ? 1 : 0
        c.state.flip = 1 - flip
        const prev = c.state.prev as TexRef | undefined
        const r = pass({ key: `${c.id}:${flip}`, w, h, t: c.t, params: values, inputs: [ins[0], prev ?? null], body })
        if (typeof r === 'string') { c.state.err = r; return { out: null } }
        c.state.err = ''
        c.state.prev = r
        return { out: r }
      }
      const r = pass({ key: c.id, w, h, t: c.t, params: values, inputs: ins, body })
      if (typeof r === 'string') { c.state.err = r; return { out: null } }
      c.state.err = ''
      return { out: r }
    },
    release: (_s, id) => freeNode(id),
  }
}

const textCanvas = document.createElement('canvas')

export const TEX_TYPES: NodeType[] = [
  // ---- make pictures ----
  top({
    type: 'tex-noise', name: 'Noise', about: 'Flowing clouds', exposed: ['speed', 'scale'],
    params: [n('scale', 'Scale', 4, 0.1, 40), n('speed', 'Speed', 0.2, 0, 4), n('contrast', 'Contrast', 1.4, 0.1, 5), n('hue', 'Hue', 0.35, 0, 1), n('sat', 'Color', 0.8, 0, 1), n('warp', 'Warp', 1, 0, 4)],
    glsl: `vec2 q = (uv - 0.5) * vec2(u_res.x / u_res.y, 1.0) * u_p[0]; float t = u_time * u_p[1];
      vec2 w = vec2(fbm(q + t), fbm(q + vec2(5.2, 1.3) - t));
      float v = clamp(pow(fbm(q + w * u_p[5] + t * 0.5) * 1.3, u_p[2]), 0.0, 1.0);
      o = vec4(hsv(u_p[3] + v * 0.15, u_p[4], v), 1.0);`,
  }),
  top({
    type: 'tex-ramp', name: 'Gradient', about: 'Two colors blending, straight or round',
    params: [{ key: 'mode', label: 'Kind', kind: 'choice', default: 0, choices: ['Straight', 'Round', 'Around'] }, n('angle', 'Angle', 0, 0, 1), n('hueA', 'Hue A', 0.62, 0, 1), n('hueB', 'Hue B', 0.9, 0, 1), n('speed', 'Speed', 0, -2, 2), n('repeat', 'Repeat', 1, 0.5, 20)],
    glsl: `vec2 p = (uv - 0.5) * vec2(u_res.x / u_res.y, 1.0); float t;
      if (u_p[0] < 0.5) t = (p * rot(u_p[1] * 6.2831853)).x + 0.5;
      else if (u_p[0] < 1.5) t = length(p) * 2.0;
      else t = atan(p.y, p.x) / 6.2831853 + 0.5;
      t = fract(t * u_p[5] + u_time * u_p[4]);
      o = vec4(mix(hsv(u_p[2], 0.9, 1.0), hsv(u_p[3], 0.9, 1.0), 0.5 - 0.5 * cos(t * 6.2831853)), 1.0);`,
  }),
  top({
    type: 'tex-shape', name: 'Shape', about: 'A circle, square, ring, triangle or star', exposed: ['size', 'x', 'y'],
    params: [{ key: 'shape', label: 'Shape', kind: 'choice', default: 0, choices: ['Circle', 'Square', 'Ring', 'Triangle', 'Star'] }, n('size', 'Size', 0.3, 0, 1), n('x', 'X', 0.5, 0, 1), n('y', 'Y', 0.5, 0, 1), n('soft', 'Softness', 0.005, 0, 0.3), n('hue', 'Hue', 0.3, 0, 1), n('sat', 'Color', 0, 0, 1), n('spin', 'Turn', 0, 0, 1)],
    glsl: `vec2 p = (uv - vec2(u_p[2], u_p[3])) * vec2(u_res.x / u_res.y, 1.0) * rot(u_p[7] * 6.2831853); float s = u_p[1] * 0.5; float d;
      int k = int(u_p[0] + 0.5);
      if (k == 0) d = length(p) - s;
      else if (k == 1) { vec2 b = abs(p) - vec2(s); d = length(max(b, 0.0)) + min(max(b.x, b.y), 0.0); }
      else if (k == 2) d = abs(length(p) - s) - s * 0.15;
      else if (k == 3) { p.y += s * 0.25; d = max(abs(p.x) * 0.866 + p.y * 0.5, -p.y) - s * 0.5; }
      else { float a = atan(p.y, p.x); float r = s * (0.6 + 0.4 * cos(a * 5.0)); d = length(p) - r; }
      float v = 1.0 - smoothstep(-u_p[4], u_p[4] + 0.002, d);
      o = vec4(hsv(u_p[5], u_p[6], 1.0) * v, v);`,
  }),
  top({
    type: 'tex-pattern', name: 'Pattern', about: 'Stripes, checks, dots or a grid', exposed: ['count'],
    params: [{ key: 'kind', label: 'Kind', kind: 'choice', default: 0, choices: ['Stripes', 'Checks', 'Dots', 'Grid', 'Rings'] }, n('count', 'Count', 10, 1, 100), n('speed', 'Speed', 0.2, -4, 4), n('angle', 'Angle', 0, 0, 1), n('width', 'Thickness', 0.5, 0.01, 0.99)],
    glsl: `vec2 p = (uv - 0.5) * vec2(u_res.x / u_res.y, 1.0) * rot(u_p[3] * 6.2831853) * u_p[1]; p.x += u_time * u_p[2]; float v; int k = int(u_p[0] + 0.5);
      if (k == 0) v = step(fract(p.x), u_p[4]);
      else if (k == 1) v = mod(floor(p.x) + floor(p.y), 2.0);
      else if (k == 2) v = 1.0 - step(u_p[4] * 0.5, length(fract(p) - 0.5));
      else if (k == 3) { vec2 f = abs(fract(p) - 0.5); v = step(0.5 - u_p[4] * 0.1, max(f.x, f.y)); }
      else v = step(fract(length(p) - u_time * u_p[2]), u_p[4]);
      o = vec4(vec3(v), 1.0);`,
  }),
  top({
    type: 'tex-shader', name: 'Shader', about: 'Your own GLSL. Use uv, u_time, u_res, a b c d (u_p[0..3]), and the pictures u_t0 and u_t1', texIn: ['in1', 'in2'], exposed: ['a', 'b', 'c', 'd'],
    params: [n('a', 'a', 0), n('b', 'b', 0), n('c', 'c', 0), n('d', 'd', 0),
      { key: 'code', label: 'GLSL (the inside of main, write to o)', kind: 'code', default: 'vec2 p = uv - 0.5;\nfloat r = length(p);\nfloat w = sin(r * 40.0 - u_time * 4.0 + u_p[0] * 10.0);\nvec3 col = 0.5 + 0.5 * cos(6.2831 * (r + vec3(0.0, 0.33, 0.67)) + u_time);\no = vec4(col * smoothstep(0.0, 0.1, w), 1.0);' }],
    glsl: (p) => String(p.code),
  }),

  // ---- bring pictures in ----
  {
    type: 'tex-text', name: 'Text', group: 'Texture', about: 'Words as a picture', ui: 'thumb',
    inputs: [{ key: 'text', label: 'text', type: 'text' }], outputs: [TEX()],
    params: [{ key: 'text', label: 'Text', kind: 'text', default: 'RICO_' }, n('size', 'Size', 160, 8, 600, 1), { key: 'color', label: 'Color', kind: 'text', default: '#ffffff' }, RES],
    run: (c) => {
      const text = c.in.text ? String(c.in.text) : String(c.p.text)
      const [w, h] = size(c, null)
      const key = `${text}|${c.p.size}|${c.p.color}|${w}x${h}`
      if (key !== c.state.key || !c.state.tex) {
        c.state.key = key
        textCanvas.width = w
        textCanvas.height = h
        const ctx = textCanvas.getContext('2d')!
        ctx.clearRect(0, 0, w, h)
        const font = getComputedStyle(document.documentElement).getPropertyValue('--font-title') || 'monospace'
        ctx.font = `${Number(c.p.size)}px ${font}`
        ctx.fillStyle = String(c.p.color)
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        text.split('\n').forEach((line, i, all) => ctx.fillText(line, w / 2, h / 2 + (i - (all.length - 1) / 2) * Number(c.p.size) * 1.1))
        c.state.tex = upload(c.id, textCanvas, w, h)
      }
      return { out: c.state.tex }
    },
    release: (_s, id) => freeNode(id),
  },
  {
    type: 'tex-create', name: 'Motion picture', group: 'Texture', about: 'What Motion is drawing right now', ui: 'thumb', inputs: [], outputs: [TEX()], params: [],
    run: (c) => {
      const r = getRenderer()
      const cv = r?.outputCanvas
      if (!cv || !cv.width) return { out: null }
      return { out: upload(c.id, cv, cv.width, cv.height) }
    },
    release: (_s, id) => freeNode(id),
  },
  {
    type: 'tex-3d', name: '3D picture', group: 'Texture', about: 'What the 3D playground camera sees', ui: 'thumb', inputs: [], outputs: [TEX()], params: [],
    run: (c) => {
      const cv = scene3dPicture()
      if (!cv) {
        if (!c.state.asked) { c.state.asked = 1; import('../three/engine').catch(() => undefined) }
        return { out: null }
      }
      return { out: upload(c.id, cv, cv.width, cv.height) }
    },
    release: (_s, id) => freeNode(id),
  },
  {
    type: 'tex-picture', name: 'Picture in', group: 'Texture', about: 'A picture another network sends out with Picture out', ui: 'thumb', inputs: [], outputs: [TEX()],
    params: [{ key: 'name', label: 'Picture', kind: 'picture', default: 'Create' }],
    run: (c) => {
      const p = usePicture(String(c.p.name))
      if (!p || p.canvas.width < 3) return { out: null }
      return { out: upload(c.id, p.canvas, p.canvas.width, p.canvas.height) }
    },
    release: (_s, id) => freeNode(id),
  },

  // ---- change pictures ----
  top({
    type: 'tex-level', name: 'Level', about: 'Brightness, contrast, gamma, invert', texIn: ['in'], exposed: ['bright'],
    params: [n('bright', 'Brightness', 1, 0, 4), n('contrast', 'Contrast', 1, 0, 4), n('gamma', 'Gamma', 1, 0.1, 4), n('invert', 'Invert', 0, 0, 1), n('opacity', 'Opacity', 1, 0, 1)],
    glsl: `vec4 c = texture(u_t0, uv); vec3 v = (c.rgb - 0.5) * u_p[1] + 0.5; v = pow(max(v, 0.0), vec3(1.0 / u_p[2])) * u_p[0];
      v = mix(v, 1.0 - v, u_p[3]); o = vec4(v, c.a * u_p[4]);`,
  }),
  top({
    type: 'tex-hsv', name: 'Color', about: 'Shift hue, saturation and value', texIn: ['in'], exposed: ['hue'],
    params: [n('hue', 'Hue', 0, 0, 1), n('sat', 'Saturation', 1, 0, 3), n('val', 'Value', 1, 0, 3), n('tint', 'Tint hue', 0, 0, 1), n('tintAmt', 'Tint', 0, 0, 1)],
    glsl: `vec4 c = texture(u_t0, uv); vec3 v = hue(c.rgb, u_p[0]); float g = dot(v, vec3(0.299, 0.587, 0.114)); v = mix(vec3(g), v, u_p[1]) * u_p[2];
      v = mix(v, hsv(u_p[3], 0.8, g * 1.4), u_p[4]); o = vec4(v, c.a);`,
  }),
  top({
    type: 'tex-blur', name: 'Blur', about: 'Soft focus', texIn: ['in'], exposed: ['radius'],
    params: [n('radius', 'Radius', 6, 0, 60)],
    glsl: `vec2 px = u_p[0] / u_res; vec4 s = vec4(0.0); float tw = 0.0;
      for (int x = -4; x <= 4; x++) for (int y = -4; y <= 4; y++) { float w = exp(-float(x * x + y * y) / 10.0); s += texture(u_t0, uv + vec2(x, y) * px * 0.5) * w; tw += w; }
      o = s / tw;`,
  }),
  top({
    type: 'tex-transform', name: 'Transform', about: 'Move, scale, turn and repeat', texIn: ['in'], exposed: ['x', 'y', 'scale', 'turn'],
    params: [n('x', 'X', 0, -1, 1), n('y', 'Y', 0, -1, 1), n('scale', 'Scale', 1, 0.05, 10), n('turn', 'Turn', 0, 0, 1), { key: 'tile', label: 'Repeat', kind: 'bool', default: false }],
    glsl: `vec2 a = vec2(u_res.x / u_res.y, 1.0); vec2 p = (uv - 0.5 - vec2(u_p[0], u_p[1])) * a; p = p * rot(-u_p[3] * 6.2831853) / u_p[2]; p = p / a + 0.5;
      if (u_p[4] > 0.5) p = fract(p); else if (p.x < 0.0 || p.y < 0.0 || p.x > 1.0 || p.y > 1.0) { o = vec4(0.0); return; }
      o = texture(u_t0, p);`,
  }),
  top({
    type: 'tex-kaleido', name: 'Kaleidoscope', about: 'Mirror slices around the middle', texIn: ['in'], exposed: ['turn'],
    params: [n('slices', 'Slices', 6, 2, 32, 1), n('turn', 'Turn', 0, 0, 1), n('zoom', 'Zoom', 1, 0.1, 4)],
    glsl: `vec2 p = (uv - 0.5) * vec2(u_res.x / u_res.y, 1.0); float r = length(p) / u_p[2]; float a = atan(p.y, p.x) + u_p[1] * 6.2831853;
      float seg = 6.2831853 / u_p[0]; a = abs(mod(a, seg) - seg * 0.5); o = texture(u_t0, vec2(cos(a), sin(a)) * r + 0.5);`,
  }),
  top({
    type: 'tex-pixel', name: 'Pixelate', about: 'Big square pixels', texIn: ['in'], exposed: ['size'],
    params: [n('size', 'Pixel size', 16, 1, 200, 1)],
    glsl: `vec2 cell = u_p[0] / u_res; o = texture(u_t0, (floor(uv / cell) + 0.5) * cell);`,
  }),
  top({
    type: 'tex-chroma', name: 'Color split', about: 'Red and blue drift apart (chromatic aberration)', texIn: ['in'], exposed: ['amount'],
    params: [n('amount', 'Amount', 0.01, 0, 0.1, 0.001), n('angle', 'Angle', 0, 0, 1)],
    glsl: `vec2 d = vec2(cos(u_p[1] * 6.2831853), sin(u_p[1] * 6.2831853)) * u_p[0];
      o = vec4(texture(u_t0, uv + d).r, texture(u_t0, uv).g, texture(u_t0, uv - d).b, texture(u_t0, uv).a);`,
  }),
  top({
    type: 'tex-edge', name: 'Edges', about: 'Outlines where the picture changes', texIn: ['in'],
    params: [n('strength', 'Strength', 3, 0, 20), n('hue', 'Hue', 0.3, 0, 1)],
    glsl: `vec2 px = 1.0 / u_res; float l = dot(texture(u_t0, uv - vec2(px.x, 0)).rgb, vec3(0.33)), r = dot(texture(u_t0, uv + vec2(px.x, 0)).rgb, vec3(0.33));
      float d = dot(texture(u_t0, uv - vec2(0, px.y)).rgb, vec3(0.33)), u = dot(texture(u_t0, uv + vec2(0, px.y)).rgb, vec3(0.33));
      float e = clamp(length(vec2(r - l, u - d)) * u_p[0], 0.0, 1.0); o = vec4(hsv(u_p[1], 0.7, 1.0) * e, 1.0);`,
  }),
  top({
    type: 'tex-threshold', name: 'Threshold', about: 'Black and white, cut at a level', texIn: ['in'], exposed: ['level'],
    params: [n('level', 'Level', 0.5, 0, 1), n('soft', 'Softness', 0.02, 0, 0.5)],
    glsl: `vec4 c = texture(u_t0, uv); float g = dot(c.rgb, vec3(0.299, 0.587, 0.114)); float v = smoothstep(u_p[0] - u_p[1], u_p[0] + u_p[1], g); o = vec4(vec3(v), c.a);`,
  }),
  top({
    type: 'tex-displace', name: 'Displace', about: 'Bends the first picture by the brightness of the second', texIn: ['in', 'by'], exposed: ['amount'],
    params: [n('amount', 'Amount', 0.05, 0, 0.5, 0.001)],
    glsl: `vec2 d = texture(u_t1, uv).rg - 0.5; o = texture(u_t0, uv + d * u_p[0]);`,
  }),
  top({
    type: 'tex-composite', name: 'Composite', about: 'Two pictures on top of each other, with a blend mode', texIn: ['bottom', 'top'], exposed: ['mix'],
    params: [{ key: 'mode', label: 'Blend', kind: 'choice', default: 0, choices: ['Normal', 'Add', 'Screen', 'Multiply', 'Difference', 'Lighten', 'Darken', 'Overlay'] }, n('mix', 'Mix', 1, 0, 1)],
    glsl: `vec4 b = texture(u_t0, uv), t = texture(u_t1, uv); vec3 r; int m = int(u_p[0] + 0.5);
      if (m == 1) r = b.rgb + t.rgb; else if (m == 2) r = 1.0 - (1.0 - b.rgb) * (1.0 - t.rgb); else if (m == 3) r = b.rgb * t.rgb;
      else if (m == 4) r = abs(b.rgb - t.rgb); else if (m == 5) r = max(b.rgb, t.rgb); else if (m == 6) r = min(b.rgb, t.rgb);
      else if (m == 7) r = mix(2.0 * b.rgb * t.rgb, 1.0 - 2.0 * (1.0 - b.rgb) * (1.0 - t.rgb), step(0.5, b.rgb)); else r = t.rgb;
      o = vec4(mix(b.rgb, r, t.a * u_p[1]), max(b.a, t.a));`,
  }),
  top({
    type: 'tex-mix', name: 'Crossfade', about: 'Fades from one picture to the other', texIn: ['a', 'b'], exposed: ['amount'],
    params: [n('amount', 'Amount', 0.5, 0, 1)],
    glsl: `o = mix(texture(u_t0, uv), texture(u_t1, uv), u_p[0]);`,
  }),
  top({
    type: 'tex-feedback', name: 'Feedback', about: 'The last frame drawn under the new one, for trails and tunnels', texIn: ['in'], exposed: ['decay'],
    params: [n('decay', 'Keep', 0.92, 0, 1), n('zoom', 'Zoom', 1.01, 0.9, 1.1, 0.001), n('turn', 'Turn', 0.002, -0.05, 0.05, 0.0005), n('hue', 'Hue drift', 0.002, 0, 0.05, 0.0005)],
    feedback: true,
    glsl: `vec2 p = (uv - 0.5) * rot(u_p[2]) / u_p[1] + 0.5; vec4 prev = texture(u_t1, p); prev.rgb = hue(prev.rgb, u_p[3]);
      vec4 now = texture(u_t0, uv); o = vec4(max(now.rgb, prev.rgb * u_p[0]), 1.0);`,
  }),

  // ---- send pictures out ----
  {
    type: 'tex-out', name: 'Picture out', group: 'Texture', about: 'Gives the picture a name, so Motion layers ("Node picture") and 3D materials can use it', ui: 'thumb',
    inputs: [TEX('in', 'picture')], outputs: [], params: [{ key: 'name', label: 'Name', kind: 'text', default: 'My picture' }, n('fps', 'Updates a second', 60, 1, 60, 1)],
    run: (c) => {
      const t = c.in.in as TexRef | null
      const name = String(c.p.name) || 'My picture'
      const pic = putPicture(name, c.id)
      if (!t || t.kind !== 'tex') return
      if (!pictureWanted(name) && c.state.copied) return
      if (c.t - (c.state.at ?? -1) < 1 / Number(c.p.fps)) return
      c.state.at = c.t
      c.state.copied = 1
      toCanvas(t, pic.canvas, 1920)
      pic.version++
    },
    release: (s) => { void s },
  },
  {
    type: 'tex-analyze', name: 'Analyze', group: 'Texture', about: 'The average color and brightness of a picture, as numbers', inputs: [TEX('in', 'picture')],
    outputs: [{ key: 'bright', label: 'brightness' }, { key: 'r', label: 'red' }, { key: 'g', label: 'green' }, { key: 'b', label: 'blue' }], params: [],
    run: (c) => {
      const t = c.in.in as TexRef | null
      if (!t || t.kind !== 'tex') return { bright: 0, r: 0, g: 0, b: 0 }
      if (c.t - (c.state.at ?? -1) > 1 / 20) {
        c.state.at = c.t
        c.state.avg = average(t)
      }
      const [r, g, b] = (c.state.avg as number[]) ?? [0, 0, 0]
      return { bright: 0.299 * r + 0.587 * g + 0.114 * b, r, g, b }
    },
  },
]

