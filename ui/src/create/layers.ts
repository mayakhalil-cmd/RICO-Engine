// The building blocks of the Create workspace. Each layer type is a small
// fragment shader plus the settings it exposes. Number settings can be
// linked to any signal (a knob, an OSC address, the kick drum).

export type ParamKind = 'number' | 'color' | 'choice' | 'text' | 'picture' | 'lut' | 'curve' | 'code'

export interface ParamDef {
  key: string
  label: string
  kind: ParamKind
  min?: number
  max?: number
  step?: number
  default: number | string
  choices?: string[]
}

export interface LayerType {
  id: string
  name: string
  about: string
  params: ParamDef[]
  source?: 'text' | 'image' | 'camera' | 'video' | 'scene3d' | 'picture' | 'precomp'   // layers that need a texture from the page
  shader: string                         // body of: vec4 layer(vec2 uv, vec2 p)
}

const num = (key: string, label: string, min: number, max: number, def: number, step = 0.01): ParamDef =>
  ({ key, label, kind: 'number', min, max, default: def, step })
const color = (key: string, label: string, def: string): ParamDef => ({ key, label, kind: 'color', default: def })

// Every layer has a transform. Units: the scene is 1
// tall, 0 is the middle; the interface shows pixels.
export const TRANSFORM_PARAMS: ParamDef[] = [
  num('tr_ax', 'Anchor X', -2, 2, 0, 0.001), num('tr_ay', 'Anchor Y', -2, 2, 0, 0.001),
  num('tr_px', 'Position X', -2, 2, 0, 0.001), num('tr_py', 'Position Y', -2, 2, 0, 0.001),
  num('tr_sx', 'Scale X', -4, 4, 1, 0.001), num('tr_sy', 'Scale Y', -4, 4, 1, 0.001),
  num('tr_rot', 'Rotation', -720, 720, 0, 0.1),
]
export const isTransformKey = (k: string) => k.startsWith('tr_')

// Types that draw nothing themselves.
export const NULL_TYPES = new Set(['null', 'adjust'])

export const BLEND_MODES = ['Normal', 'Add', 'Screen', 'Multiply', 'Difference', 'Overlay', 'Soft light', 'Hard light', 'Lighten', 'Darken', 'Subtract', 'Color dodge', 'Color burn', 'Exclusion', 'Color', 'Luminosity'] as const

// Shared GLSL. Every layer gets the time, the output size, its numbers in
// u_n[0..15] (in the order of its params, colors skipped), its colors in
// u_c[0..3] and an optional texture.
export const LAYER_HEADER = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform float u_time;
uniform vec2 u_res;
uniform float u_n[16];
uniform vec3 u_c[4];
uniform sampler2D u_tex;
uniform vec2 u_texSize;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.02; a *= 0.5; } return v; }
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
vec3 hue(vec3 c, float h) {
  const vec3 k = vec3(0.57735);
  float a = h * 6.2831853;
  return c * cos(a) + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cos(a));
}
vec2 fitTex(vec2 uv) {
  float ra = u_res.x / u_res.y, ta = u_texSize.x / max(u_texSize.y, 1.0);
  vec2 s = ra > ta ? vec2(ra / ta, 1.0) : vec2(1.0, ta / ra);
  return (uv - 0.5) * s + 0.5;
}
`

// The starting code for a Shader layer.
export const GLSL_DEFAULT = `// uv: 0..1 across the picture. p: centered, height 1.
// a..h: your numbers (keyframe or link them). c1, c2, c3: your colors.
// u_time: seconds. Return the color with its alpha.
float r = length(p);
float w = sin(r * (10.0 + a * 40.0) - u_time * (1.0 + b * 6.0));
float ring = smoothstep(0.0, 0.05 + c * 0.3, w);
vec3 col = mix(c1, c2, ring) + c3 * d * fbm(p * 4.0 + u_time * 0.2);
return vec4(col, 1.0);`

export const LAYER_TYPES: LayerType[] = [
  {
    id: 'gradient',
    name: 'Gradient',
    about: 'Two colors drifting into each other.',
    params: [num('angle', 'Angle', 0, 1, 0.12), num('speed', 'Speed', 0, 2, 0.2), num('bands', 'Bands', 0.5, 8, 1), color('a', 'Color A', '#002cf8'), color('b', 'Color B', '#f820a0')],
    shader: `
      vec2 q = (uv - 0.5) * rot(u_n[0] * 6.2831853);
      float t = 0.5 + 0.5 * sin((q.x + q.y * 0.3) * u_n[2] * 6.2831853 + u_time * u_n[1] * 2.0);
      return vec4(mix(u_c[0], u_c[1], t), 1.0);`,
  },
  {
    id: 'noise',
    name: 'Noise field',
    about: 'Flowing clouds. Link Warp to audio for a breathing look.',
    params: [num('scale', 'Scale', 0.5, 12, 3), num('speed', 'Speed', 0, 2, 0.25), num('warp', 'Warp', 0, 3, 1), num('contrast', 'Contrast', 0.2, 4, 1.4), color('a', 'Dark', '#000000'), color('b', 'Light', '#3bff03')],
    shader: `
      vec2 q = p * u_n[0];
      float t = u_time * u_n[1];
      vec2 w = vec2(fbm(q + t), fbm(q + vec2(5.2, 1.3) - t));
      float v = fbm(q + w * u_n[2] + t * 0.5);
      v = clamp(pow(v * 1.2, u_n[3]), 0.0, 1.0);
      return vec4(mix(u_c[0], u_c[1], v), 1.0);`,
  },
  {
    id: 'grid',
    name: 'Grid floor',
    about: 'A perspective grid running toward the horizon.',
    params: [num('speed', 'Speed', 0, 4, 1), num('horizon', 'Horizon', 0.1, 0.9, 0.55), num('lines', 'Lines', 4, 40, 14, 1), num('glow', 'Glow', 0, 2, 0.8), color('line', 'Line', '#3bff03'), color('sky', 'Sky', '#000000')],
    shader: `
      float h = u_n[1];
      float y = 1.0 - uv.y;
      if (y < 1.0 - h) {
        float sky = smoothstep(0.0, 1.0 - h, y);
        return vec4(u_c[1] + u_c[0] * pow(sky, 6.0) * 0.35 * u_n[3], 1.0);
      }
      float d = (y - (1.0 - h)) / h;
      float z = 1.0 / max(d, 0.001);
      vec2 g = vec2((uv.x - 0.5) * z, z + u_time * u_n[0]);
      g *= u_n[2] * 0.1;
      vec2 f = abs(fract(g) - 0.5) / fwidth(g);
      float line = 1.0 - min(min(f.x, f.y), 1.0);
      float fade = smoothstep(0.0, 0.25, d);
      return vec4(u_c[1] + u_c[0] * line * fade * (0.6 + u_n[3]), 1.0);`,
  },
  {
    id: 'tunnel',
    name: 'Tunnel',
    about: 'Rings rushing toward you.',
    params: [num('speed', 'Speed', 0, 4, 1), num('twist', 'Twist', -3, 3, 0.4), num('rings', 'Rings', 2, 30, 10, 1), num('thick', 'Thickness', 0.02, 0.5, 0.12), color('color', 'Color', '#f820a0')],
    shader: `
      float r = length(p);
      float a = atan(p.y, p.x);
      float z = 1.0 / max(r, 0.001) + u_time * u_n[0];
      float ring = abs(fract(z * u_n[2] * 0.1 + a * u_n[1] / 6.2831853) - 0.5);
      float v = smoothstep(u_n[3], u_n[3] * 0.4, ring) * smoothstep(0.0, 0.35, r);
      return vec4(u_c[0] * v, v);`,
  },
  {
    id: 'pulse',
    name: 'Pulse rings',
    about: 'Rings that grow with a value. Link Size to the kick.',
    params: [num('size', 'Size', 0, 1, 0.4), num('count', 'Count', 1, 12, 4, 1), num('width', 'Width', 0.002, 0.08, 0.012, 0.001), num('x', 'X', 0, 1, 0.5), num('y', 'Y', 0, 1, 0.5), color('color', 'Color', '#3bff03')],
    shader: `
      vec2 c = (vec2(u_n[3], u_n[4]) - 0.5) * vec2(u_res.x / u_res.y, 1.0);
      float r = length(p - c);
      float v = 0.0;
      for (int i = 0; i < 12; i++) {
        if (float(i) >= u_n[1]) break;
        float rr = u_n[0] * (1.0 - float(i) / u_n[1]) * 0.7;
        v += smoothstep(u_n[2], 0.0, abs(r - rr));
      }
      v = clamp(v, 0.0, 1.0);
      return vec4(u_c[0] * v, v);`,
  },
  {
    id: 'shape',
    name: 'Shape',
    about: 'A clean shape you can move, scale and spin.',
    params: [
      { key: 'shape', label: 'Shape', kind: 'choice', default: 0, choices: ['Circle', 'Square', 'Triangle', 'Ring', 'Cross'] },
      num('size', 'Size', 0, 1, 0.3), num('x', 'X', 0, 1, 0.5), num('y', 'Y', 0, 1, 0.5), num('spin', 'Rotation', 0, 1, 0), num('soft', 'Softness', 0, 0.2, 0.004, 0.001),
      color('color', 'Color', '#ffffff'),
    ],
    shader: `
      vec2 c = (vec2(u_n[2], u_n[3]) - 0.5) * vec2(u_res.x / u_res.y, 1.0);
      vec2 q = (p - c) * rot(u_n[4] * 6.2831853);
      float s = u_n[1] * 0.5;
      float d;
      int k = int(u_n[0] + 0.5);
      if (k == 0) d = length(q) - s;
      else if (k == 1) { vec2 b = abs(q) - vec2(s); d = length(max(b, 0.0)) + min(max(b.x, b.y), 0.0); }
      else if (k == 2) { q.y += s * 0.25; const float t = 1.7320508; q.x = abs(q.x) - s; q.y = q.y + s / t; if (q.x + t * q.y > 0.0) q = vec2(q.x - t * q.y, -t * q.x - q.y) / 2.0; q.x -= clamp(q.x, -2.0 * s, 0.0); d = -length(q) * sign(q.y); }
      else if (k == 3) d = abs(length(q) - s) - s * 0.12;
      else { vec2 a = abs(q); d = min(max(a.x - s, a.y - s * 0.2), max(a.y - s, a.x - s * 0.2)); }
      float v = 1.0 - smoothstep(-u_n[5], u_n[5] + 0.0015, d);
      return vec4(u_c[0], v);`,
  },
  {
    id: 'bars',
    name: 'Bars',
    about: 'A row of bars. Link Level to audio or a fader.',
    params: [num('count', 'Count', 2, 64, 24, 1), num('level', 'Level', 0, 1, 0.6), num('motion', 'Motion', 0, 1, 0.5), num('gap', 'Gap', 0, 0.9, 0.35), color('color', 'Color', '#3bff03'), color('top', 'Peak', '#f820a0')],
    shader: `
      float n = u_n[0];
      float i = floor(uv.x * n);
      float fx = fract(uv.x * n);
      float h = u_n[1] * (1.0 - u_n[2] + u_n[2] * noise(vec2(i * 1.7, u_time * 3.0)));
      float bar = step(u_n[3] * 0.5, fx) * step(fx, 1.0 - u_n[3] * 0.5) * step(1.0 - uv.y, h);
      vec3 col = mix(u_c[0], u_c[1], smoothstep(0.0, max(h, 0.01), 1.0 - uv.y));
      return vec4(col * bar, bar);`,
  },
  {
    id: 'chroma',
    name: 'Chroma glass',
    about: 'Liquid contour shapes with an iridescent, oil-on-glass finish, from the RICO website. Link Ripple to the kick and Bass to the low band.',
    params: [
      num('speed', 'Speed', 0, 4, 1), num('density', 'Lines', 2, 40, 9), num('thick', 'Thickness', 0, 0.3, 0.04, 0.005),
      num('ooze', 'Ooze', 0, 0.6, 0.16), num('hue', 'Hue', 0, 1, 0), num('irid', 'Iridescence', 0, 1, 1),
      num('kick', 'Ripple', 0, 1, 0), num('grain', 'Grain', 0, 1, 1),
      color('a', 'Flat color', '#ffffff'), color('b', 'Rim', '#3bff03'), color('c', 'Background lines', '#ffffff'),
    ],
    shader: `
      float t = u_time * u_n[0];
      float kick = u_n[6], irid = u_n[5];
      float asp = u_res.x / u_res.y;
      vec2 q0 = vec2(uv.x * asp, uv.y);
      vec2 P = q0 + (vec2(fbm(q0 * 2.3 + vec2(t * 0.05, 0.0)), fbm(q0 * 2.3 + vec2(3.1, -t * 0.05))) - 0.5) * u_n[3];
      vec2 Q = vec2(fbm(P * 1.7 + t * 0.06), fbm(P * 1.7 - t * 0.06 + 5.2));
      vec2 Qk = Q * (1.6 + kick * 1.2) + vec2(0.0, t * 0.06);
      float n = fbm(P * 1.3 + Qk);
      float s = n * u_n[1] - t * 0.15;
      float w = min(0.44, mix(0.05, 0.2, pow(hash(vec2(floor(s), 3.1)), 1.3)) + u_n[2] + 0.02 * kick + 0.08 * irid);
      float ca = 0.018 + 0.01 * kick;
      float dr = abs(fract(s + ca) - 0.5), dg = abs(fract(s) - 0.5), db = abs(fract(s - ca) - 0.5);
      vec3 lines = vec3(1.0 - smoothstep(w - 0.02, w, dr), 1.0 - smoothstep(w - 0.02, w, dg), 1.0 - smoothstep(w - 0.02, w, db));
      float L = lines.g;
      float e = 0.006;
      float nx = fbm((P + vec2(e, 0.0)) * 1.3 + Qk), ny = fbm((P + vec2(0.0, e)) * 1.3 + Qk);
      vec3 N = normalize(vec3((nx - n) / e * 0.55, (ny - n) / e * 0.55, 1.0));
      float inside = clamp((w - dg) / max(w, 1e-3), 0.0, 1.0), edge = 1.0 - inside;
      float x = inside * 1.5 + n * 0.9 + (1.0 - N.z) * 0.9 + u_n[4];
      vec3 spec = 0.5 + 0.5 * cos(6.28318 * (x + vec3(0.0, 0.27, 0.58)));
      spec.g *= 0.82;
      spec = mix(spec, vec3(0.72, 0.66, 1.0), 0.1);
      vec3 bands = pow(spec, vec3(1.6)) * (0.12 + 1.5 * pow(edge, 1.3)) * 1.5;
      float env = pow(0.5 + 0.5 * cos(6.28318 * (N.x * 0.9 + N.y * 0.6 + n * 0.8)), 4.0);
      vec3 sheen = mix(vec3(0.62, 0.58, 1.0), vec3(1.0), env) * env * smoothstep(0.15, 0.7, inside) * 0.75;
      vec3 rimLine = vec3(1.0) * exp(-inside * 26.0) * 0.9;
      vec3 Lt = normalize(vec3(-0.45, 0.55, 0.7));
      float hl = pow(max(dot(N, normalize(Lt + vec3(0.0, 0.0, 1.0))), 0.0), 90.0);
      vec3 oil = vec3(0.015, 0.012, 0.03) + bands + sheen + rimLine + vec3(1.0) * hl * 1.3;
      float grain = hash(gl_FragCoord.xy * 0.73 + floor(u_time * 12.0));
      oil *= 1.0 - u_n[7] * 0.14 + u_n[7] * 0.28 * grain;
      vec3 shape = mix(u_c[0], oil, irid);
      float rim = clamp(L * (1.0 - L) * 4.0, 0.0, 1.0);
      float hair = 1.0 - smoothstep(0.0, 0.045, abs(fract(n * 52.0 - t * 0.3) - 0.5));
      vec3 bg = u_c[2] * (hair * 0.1 + 0.035 * smoothstep(0.35, 0.9, n));
      bg += vec3(0.035, 0.03, 0.075) * irid * (0.6 + 0.4 * smoothstep(0.2, 0.8, n));
      vec3 col = bg * (1.0 - lines) + shape * lines * 1.05 + u_c[1] * rim * (1.0 - irid) * 0.9;
      return vec4(col, 1.0);`,
  },
  {
    id: 'blobs',
    name: 'Blobs',
    about: 'Drifting blobs that melt into each other, with distance lines around them and tracking brackets, from the RICO website. Link Swell to audio.',
    params: [
      num('count', 'Count', 1, 10, 7, 1), num('size', 'Size', 0.2, 3, 1), num('speed', 'Speed', 0, 4, 1),
      num('merge', 'Merge', 0, 0.4, 0.12), num('swell', 'Swell', 0, 1, 0), num('spacing', 'Line spacing', 0.01, 0.1, 0.03, 0.001),
      num('track', 'Tracking boxes', 0, 1, 1, 1), num('skin', 'Skin wobble', 0, 0.2, 0.05, 0.005),
      color('fill', 'Fill', '#ffffff'), color('edge', 'Outline', '#3bff03'), color('lines', 'Lines', '#ffffff'),
    ],
    shader: `
      float asp = u_res.x / u_res.y;
      vec2 q = vec2(uv.x * asp, uv.y);
      float t = u_time * u_n[2];
      float px = 1.0 / u_res.y;
      float k = max(u_n[3], 0.001);
      float d = 1e5;
      float track = 0.0;
      for (int i = 0; i < 10; i++) {
        if (float(i) >= u_n[0]) break;
        float fi = float(i);
        float fx = 0.05 + hash(vec2(fi, 1.3)) * 0.08, fy = 0.04 + hash(vec2(fi, 7.1)) * 0.07;
        float ph = hash(vec2(fi, 3.7)) * 6.28, py = hash(vec2(fi, 9.2)) * 6.28;
        vec2 c = vec2(asp * (0.5 + 0.44 * sin(t * fx * 4.0 + ph) * cos(t * fx * 1.5 + fi)),
                      0.5 + 0.38 * sin(t * fy * 4.0 + py) * cos(t * fy * 2.1 + fi * 2.1));
        float band = 0.6 + 0.4 * sin(fi * 2.3 + u_time * 3.0);
        float r = (0.05 + hash(vec2(fi, 5.5)) * 0.06) * u_n[1] * (1.0 + 0.6 * u_n[4] * band);
        float di = length(q - c) - r;
        float h = clamp(0.5 + 0.5 * (di - d) / k, 0.0, 1.0);
        d = mix(di, d, h) - k * h * (1.0 - h);
        // tracking brackets: the corners of a box around each blob, and its middle
        vec2 a = abs(q - c);
        float b = r * 1.25, arm = min(b * 0.4, 0.04);
        float onV = step(abs(a.x - b), px) * step(a.y, b + px) * step(b - arm, a.y);
        float onH = step(abs(a.y - b), px) * step(a.x, b + px) * step(b - arm, a.x);
        float mid = step(a.x, 2.0 * px) * step(a.y, 2.0 * px);
        track = max(track, max(max(onV, onH), mid));
      }
      d += (fbm(q * 3.0 + vec2(u_time * 0.07, -u_time * 0.05)) - 0.5) * u_n[7] * (1.0 + u_n[4]);
      vec3 col = vec3(0.0);
      float sp = u_n[5];
      float ql = d / sp + u_time * 0.25;
      float wpx = mix(0.6, 3.6, pow(hash(vec2(floor(ql + 0.5), 7.7)), 2.0));
      float hw = 0.5 * wpx * px / sp, aa = px / sp;
      float ring = 1.0 - smoothstep(hw, hw + aa, abs(fract(ql) - 0.5));
      col += u_c[2] * ring * exp(-max(d, 0.0) * 7.0) * 0.5 * step(0.0, d);
      float depth = clamp(-d / 0.12, 0.0, 1.0);
      float scan = step(0.5, fract(gl_FragCoord.y / (2.0 + 3.0 * (1.0 - depth))));
      col += u_c[0] * step(d, 0.0) * (0.08 + 0.32 * scan * depth);
      vec2 hp = fract(gl_FragCoord.xy / 6.0) - 0.5;
      col += u_c[0] * step(length(hp), 0.18 + 0.2 * depth) * step(d, -0.02) * 0.35;
      col = mix(col, mix(u_c[1], vec3(1.0), 0.45), 1.0 - smoothstep(0.0, 1.8 * px, abs(d)));
      col += u_c[1] * exp(-abs(d) / (10.0 * px)) * (0.9 + 0.8 * u_n[4]);
      col = mix(col, mix(u_c[1], vec3(1.0), 0.5), track * u_n[6]);
      col += (hash(gl_FragCoord.xy + fract(u_time) * 100.0) - 0.5) * 0.05;
      // see-through where there is nothing, so blobs sit on other layers
      return vec4(col, clamp(max(col.r, max(col.g, col.b)) * 1.5, 0.0, 1.0));`,
  },
  {
    id: 'text',
    name: 'Text',
    about: 'Words, with a font, tracking, a typewriter reveal and a wave. Ctrl+Alt+Shift+T makes one.',
    source: 'text',
    params: [
      { key: 'text', label: 'Text', kind: 'text', default: 'RICO_' },
      num('size', 'Size', 0.05, 1, 0.3), num('x', 'X', 0, 1, 0.5), num('y', 'Y', 0, 1, 0.5), num('glitch', 'Glitch', 0, 1, 0),
      { key: 'font', label: 'Font', kind: 'choice', default: 0, choices: ['RICO title', 'Mono', 'Sans', 'Bold sans', 'Serif', 'Italic serif'] },
      num('tracking', 'Tracking', -0.2, 1, 0), num('reveal', 'Typewriter', 0, 1, 1), num('wave', 'Wave', 0, 1, 0), num('waveSpeed', 'Wave speed', 0, 10, 3),
      num('outline', 'Outline only', 0, 1, 0, 1),
      color('color', 'Color', '#ffffff'),
    ],
    shader: `
      vec2 q = uv - vec2(u_n[1], u_n[2]);
      float ar = u_texSize.x / max(u_texSize.y, 1.0);
      vec2 size = vec2(u_n[0] * ar * u_res.y / u_res.x, u_n[0]) * 0.5;
      float g = u_n[3] * step(0.6, hash(vec2(floor(uv.y * 40.0), floor(u_time * 12.0)))) * (hash(vec2(floor(u_time * 12.0), 3.0)) - 0.5) * 0.15;
      vec2 t = (q + vec2(g, 0.0)) / (size * 2.0) + 0.5;
      if (t.x < 0.0 || t.x > 1.0 || t.y < 0.0 || t.y > 1.0) return vec4(0.0);
      float a = texture(u_tex, vec2(t.x, 1.0 - t.y)).a;
      float split = u_n[3] * 0.01;
      float ar2 = texture(u_tex, vec2(t.x + split, 1.0 - t.y)).a;
      float ab2 = texture(u_tex, vec2(t.x - split, 1.0 - t.y)).a;
      vec3 col = u_c[0] * a + vec3(0.97, 0.13, 0.63) * max(ar2 - a, 0.0) + vec3(0.0, 0.17, 0.97) * max(ab2 - a, 0.0);
      return vec4(col, max(a, max(ar2, ab2)));`,
  },
  {
    id: 'image',
    name: 'Image',
    about: 'A picture from your computer. Drop it on the preview or pick it.',
    source: 'image',
    params: [num('zoom', 'Zoom', 0.2, 4, 1), num('x', 'X', -1, 1, 0), num('y', 'Y', -1, 1, 0), num('hue', 'Hue shift', 0, 1, 0)],
    shader: `
      vec2 t = (fitTex(uv) - 0.5) / u_n[0] + 0.5 - vec2(u_n[1], u_n[2]) * 0.5;
      if (t.x < 0.0 || t.x > 1.0 || t.y < 0.0 || t.y > 1.0) return vec4(0.0);
      vec4 c = texture(u_tex, vec2(t.x, 1.0 - t.y));
      return vec4(hue(c.rgb, u_n[3]), c.a);`,
  },
  {
    id: 'precomp',
    name: 'Precomp',
    about: 'Another composition, as one layer. Double-click it on the timeline to open it.',
    source: 'precomp',
    params: [{ key: 'comp', label: 'Composition', kind: 'text', default: '' }, num('zoom', 'Zoom', 0.2, 4, 1), num('x', 'X', -1, 1, 0), num('y', 'Y', -1, 1, 0), num('speed', 'Speed', 0, 4, 1, 0.01), num('offset', 'Start at (s)', 0, 600, 0, 0.01)],
    shader: `
      vec2 t = (fitTex(uv) - 0.5) / u_n[0] + 0.5 - vec2(u_n[1], u_n[2]) * 0.5;
      if (t.x < 0.0 || t.x > 1.0 || t.y < 0.0 || t.y > 1.0) return vec4(0.0);
      return texture(u_tex, vec2(t.x, 1.0 - t.y));`,
  },
  {
    id: 'video',
    name: 'Video clip',
    about: 'A video file. On the timeline it plays where the layer starts.',
    source: 'video',
    params: [num('zoom', 'Zoom', 0.2, 4, 1), num('x', 'X', -1, 1, 0), num('y', 'Y', -1, 1, 0), num('speed', 'Speed', 0, 4, 1), num('hue', 'Hue shift', 0, 1, 0)],
    shader: `
      vec2 t = (fitTex(uv) - 0.5) / u_n[0] + 0.5 - vec2(u_n[1], u_n[2]) * 0.5;
      if (t.x < 0.0 || t.x > 1.0 || t.y < 0.0 || t.y > 1.0) return vec4(0.0);
      vec4 c = texture(u_tex, vec2(t.x, 1.0 - t.y));
      return vec4(hue(c.rgb, u_n[4]), 1.0);`,
  },
  {
    id: 'scene3d',
    name: '3D scene',
    about: 'The 3D playground, as a layer. Build the scene in the 3D workspace.',
    source: 'scene3d',
    params: [num('zoom', 'Zoom', 0.5, 4, 1), num('key', 'See-through black', 0, 1, 1, 1), { key: 'time', label: 'Time', kind: 'choice', default: 0, choices: ['Same timeline as Motion', 'Its own time (precomp)'] }, num('offset', 'Precomp: start at (s)', 0, 60, 0, 0.01), num('speed', 'Precomp: speed', 0, 4, 1, 0.01)],
    shader: `
      vec2 t = (uv - 0.5) / u_n[0] + 0.5;
      if (t.x < 0.0 || t.x > 1.0 || t.y < 0.0 || t.y > 1.0) return vec4(0.0);
      vec4 c = texture(u_tex, vec2(t.x, 1.0 - t.y));
      float a = u_n[1] > 0.5 ? clamp(max(c.r, max(c.g, c.b)) * 3.0, 0.0, 1.0) : 1.0;
      return vec4(c.rgb, a);`,
  },
  {
    id: 'picture',
    name: 'Node picture',
    about: 'A picture a node network sends out with "Picture out" (noise, shaders, feedback, text...).',
    source: 'picture',
    params: [
      { key: 'picture', label: 'Picture', kind: 'picture', default: 'My picture' },
      num('zoom', 'Zoom', 0.25, 8, 1), num('x', 'X', -1, 1, 0), num('y', 'Y', -1, 1, 0), num('tile', 'Repeat', 0, 1, 0, 1), num('key', 'See-through black', 0, 1, 0, 1),
    ],
    shader: `
      vec2 t = (fitTex(uv) - 0.5) / u_n[0] + 0.5 - vec2(u_n[1], u_n[2]) * 0.5;
      if (u_n[3] > 0.5) t = fract(t);
      else if (t.x < 0.0 || t.x > 1.0 || t.y < 0.0 || t.y > 1.0) return vec4(0.0);
      vec4 c = texture(u_tex, vec2(t.x, 1.0 - t.y));
      float a = u_n[4] > 0.5 ? clamp(max(c.r, max(c.g, c.b)) * 3.0, 0.0, 1.0) : 1.0;
      return vec4(c.rgb, a * c.a);`,
  },
  {
    id: 'camera',
    name: 'Camera',
    about: 'A webcam or capture card.',
    source: 'camera',
    params: [num('zoom', 'Zoom', 0.5, 4, 1), num('mirror', 'Mirror', 0, 1, 1, 1), num('threshold', 'Posterize', 0, 1, 0)],
    shader: `
      vec2 t = (fitTex(uv) - 0.5) / u_n[0] + 0.5;
      if (u_n[1] > 0.5) t.x = 1.0 - t.x;
      vec3 c = texture(u_tex, vec2(t.x, 1.0 - t.y)).rgb;
      if (u_n[2] > 0.0) c = floor(c * mix(32.0, 2.0, u_n[2])) / mix(32.0, 2.0, u_n[2]);
      return vec4(c, 1.0);`,
  },
  {
    id: 'vshape',
    name: 'Shape layer',
    about: 'Rectangle, ellipse, polygon, star or line with fill, stroke, trim paths and a repeater. Q draws one on the preview.',
    params: [
      { key: 'kind', label: 'Shape', kind: 'choice', default: 0, choices: ['Rectangle', 'Ellipse', 'Polygon', 'Star', 'Line'] },
      num('w', 'Width', 0, 3, 0.5, 0.001), num('h', 'Height', 0, 3, 0.5, 0.001), num('round', 'Roundness', 0, 1, 0),
      num('points', 'Points', 3, 24, 5, 1), num('inner', 'Inner radius', 0.05, 1, 0.45), num('fill', 'Fill', 0, 1, 1, 1),
      num('stroke', 'Stroke width', 0, 0.2, 0, 0.001), num('trimS', 'Trim start', 0, 1, 0), num('trimE', 'Trim end', 0, 1, 1), num('trimO', 'Trim offset', -1, 1, 0),
      num('count', 'Repeater copies', 1, 16, 1, 1), num('repX', 'Repeater offset X', -1, 1, 0.2, 0.001), num('repY', 'Repeater offset Y', -1, 1, 0, 0.001),
      num('repRot', 'Repeater rotation', -180, 180, 0, 0.1), num('repScale', 'Repeater scale', 0.5, 1.5, 1, 0.001),
      color('fillColor', 'Fill color', '#3bff03'), color('strokeColor', 'Stroke color', '#ffffff'),
    ],
    shader: `
      float aa = 1.5 / u_res.y;
      int kind = int(u_n[0] + 0.5);
      vec2 half_ = vec2(u_n[1], u_n[2]) * 0.5;
      float best = 0.0; vec3 col = vec3(0.0);
      int count = int(u_n[11] + 0.5);
      for (int i = 0; i < 16; i++) {
        if (i >= count) break;
        float fi = float(i);
        vec2 q = p - vec2(u_n[12], u_n[13]) * fi;
        q = q * rot(-u_n[14] * fi * 0.0174533);
        float sc = pow(u_n[15], fi);
        q /= sc;
        float d;
        if (kind == 0) { float r = u_n[3] * min(half_.x, half_.y); vec2 b = abs(q) - half_ + r; d = length(max(b, 0.0)) + min(max(b.x, b.y), 0.0) - r; }
        else if (kind == 1) { d = (length(q / max(half_, vec2(1e-4))) - 1.0) * min(half_.x, half_.y); }
        else if (kind == 2) { float n = floor(u_n[4]); float seg = 6.2831853 / n; float a = atan(q.x, q.y); d = cos(floor(0.5 + a / seg) * seg - a) * length(q) - half_.x * cos(seg * 0.5); }
        else if (kind == 3) {
          float n = floor(u_n[4]); float seg = 3.14159265 / n; float a = atan(q.x, q.y); float r = length(q);
          float k = mod(a + seg, 2.0 * seg) - seg; vec2 pq = r * vec2(cos(k), abs(sin(k)));
          vec2 A = vec2(half_.x, 0.0); vec2 B = half_.x * u_n[5] * vec2(cos(seg), sin(seg));
          vec2 e = B - A; vec2 w = pq - A; float h = clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
          d = length(w - e * h) * sign(e.x * w.y - e.y * w.x);
        }
        else { vec2 a2 = vec2(-half_.x, 0.0), b2 = vec2(half_.x, 0.0); vec2 pa = q - a2, ba = b2 - a2; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); d = length(pa - ba * h) + 1e-4; }
        d *= sc;
        float fillA = kind == 4 ? 0.0 : u_n[6] * (1.0 - smoothstep(-aa, aa, d));
        // Trim paths: where along the outline this point is, 0 to 1.
        float along = kind == 4 ? (q.x / max(half_.x * 2.0, 1e-4) + 0.5) : fract(atan(q.x, q.y) / 6.2831853 + 0.5);
        along = fract(along - u_n[10]);
        float ts = min(u_n[8], u_n[9]), te = max(u_n[8], u_n[9]);
        float inTrim = step(ts, along) * step(along, te);
        float strokeA = u_n[7] > 0.0 ? (1.0 - smoothstep(-aa, aa, abs(d) - u_n[7] * 0.5)) * inTrim : 0.0;
        vec3 c = mix(u_c[0], u_c[1], strokeA);
        float a = max(fillA, strokeA);
        col = mix(col, c, a);
        best = max(best, a);
      }
      return vec4(col, best);`,
  },
  {
    id: 'particles',
    name: 'Particles',
    about: 'A particle emitter: speed, spread, gravity, turbulence, life and colors. Link Rate or Speed to the kick.',
    params: [
      num('count', 'Particles', 1, 300, 120, 1), num('size', 'Size', 0.001, 0.08, 0.012, 0.001), num('speed', 'Speed', 0, 2, 0.4),
      num('dir', 'Direction', -180, 180, 90, 1), num('spread', 'Spread', 0, 360, 60, 1), num('gravity', 'Gravity', -2, 2, 0.3),
      num('life', 'Life (s)', 0.2, 10, 2.5), num('turb', 'Turbulence', 0, 1, 0.15), num('radius', 'Emitter size', 0, 1, 0.02),
      num('glow', 'Glow', 0, 1, 0.5),
      color('c1', 'Birth color', '#3bff03'), color('c2', 'Death color', '#f820a0'),
    ],
    shader: `
      vec3 col = vec3(0.0); float a = 0.0;
      int n = int(u_n[0] + 0.5);
      for (int i = 0; i < 300; i++) {
        if (i >= n) break;
        float fi = float(i);
        float seed = hash(vec2(fi, 1.7));
        float life = u_n[6] * (0.6 + 0.4 * hash(vec2(fi, 9.1)));
        float tt = u_time + seed * life;
        float cycle = floor(tt / life);
        float age = tt - cycle * life;
        float r1 = hash(vec2(fi, cycle + 0.3)), r2 = hash(vec2(fi * 1.3, cycle + 7.0)), r3 = hash(vec2(cycle, fi + 2.0));
        float ang = (u_n[3] + (r1 - 0.5) * u_n[4]) * 0.0174533;
        vec2 dir = vec2(cos(ang), sin(ang));
        vec2 start = (vec2(r2, r3) - 0.5) * 2.0 * u_n[8];
        vec2 pos = start + dir * u_n[2] * (0.5 + r2) * age - vec2(0.0, 0.5 * u_n[5] * age * age);
        pos += u_n[7] * 0.1 * vec2(noise(vec2(fi, u_time)) - 0.5, noise(vec2(u_time, fi)) - 0.5) * age;
        float k = age / life;
        float d = length(p - pos);
        float s = u_n[1] * (1.0 - 0.5 * k);
        float core = smoothstep(s, s * 0.3, d);
        float halo = u_n[9] * s * s * 0.6 / (d * d + s * s * 0.6) * 0.35;
        float v = (core + halo) * (1.0 - k);
        col += mix(u_c[0], u_c[1], k) * v;
        a += v;
      }
      return vec4(col / max(a, 1e-3), clamp(a, 0.0, 1.0));`,
  },
  {
    id: 'null',
    name: 'Null',
    about: 'An empty layer. It draws nothing; parent other layers to it to move them together. Ctrl+Alt+Shift+Y.',
    params: [],
    shader: `return vec4(0.0);`,
  },
  {
    id: 'adjust',
    name: 'Adjustment layer',
    about: 'Its effects change every layer under it. Masks and opacity limit where. Ctrl+Alt+Y.',
    params: [],
    shader: `return vec4(0.0);`,
  },
  {
    id: 'solid',
    name: 'Solid',
    about: 'One flat color. Useful for flashes: link Opacity to a pad.',
    params: [color('color', 'Color', '#ffffff')],
    shader: `return vec4(u_c[0], 1.0);`,
  },
  {
    id: 'glsl',
    name: 'Shader (your GLSL)',
    about: 'Write your own GLSL. a to h are numbers you can keyframe (stopwatch) or link to a knob, OSC or the audio, so the shader moves live.',
    params: [
      { key: 'code', label: 'GLSL (body of vec4 layer(vec2 uv, vec2 p))', kind: 'code', default: GLSL_DEFAULT },
      num('a', 'a', 0, 1, 0.5), num('b', 'b', 0, 1, 0.5), num('c', 'c', 0, 1, 0), num('d', 'd', 0, 1, 0),
      num('e', 'e', 0, 1, 0), num('f', 'f', 0, 1, 0), num('g', 'g', 0, 1, 0), num('h', 'h', 0, 1, 0),
      color('c1', 'Color 1', '#3bff03'), color('c2', 'Color 2', '#f820a0'), color('c3', 'Color 3', '#002cf8'),
    ],
    shader: ``,
  },
]

// The finishing pass on top of all layers.
export const MASTER_PARAMS: ParamDef[] = [
  num('trails', 'Trails', 0, 0.97, 0),
  num('chroma', 'Color split', 0, 1, 0.15),
  num('lines', 'Screen lines', 0, 1, 0),
  num('hue', 'Hue shift', 0, 1, 0),
  num('bright', 'Brightness', 0, 2, 1),
  num('zoom', 'Feedback zoom', 0.9, 1.1, 1, 0.001),
]

export function layerType(id: string): LayerType {
  return LAYER_TYPES.find((t) => t.id === id) ?? LAYER_TYPES[0]
}
