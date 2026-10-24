import type { ParamDef } from './layers'

// Effects. Each one is a small
// fragment shader that reads the picture so far (u_src) and the picture the
// effect started from (u_orig). Some take several passes (blurs, glow).
// Colors are straight alpha, as everywhere in Create.

export type EffectGroup = 'Blur and sharpen' | 'Color' | 'Distort' | 'Stylize' | 'Keying' | 'Perspective'

export interface EffectType {
  id: string
  name: string
  group: EffectGroup
  about: string
  params: ParamDef[]
  passes?: number
  aux?: 'lut' | 'curve' | 'plate'
  glsl: string          // body of: vec4 fx(vec2 uv)
}

const num = (key: string, label: string, min: number, max: number, def: number, step = 0.01): ParamDef =>
  ({ key, label, kind: 'number', min, max, default: def, step })
const color = (key: string, label: string, def: string): ParamDef => ({ key, label, kind: 'color', default: def })

export const EFFECT_HEADER = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_src;
uniform sampler2D u_orig;
uniform sampler2D u_aux;
uniform float u_lutSize;
uniform float u_n[16];
uniform vec3 u_c[4];
uniform vec2 u_res;
uniform float u_time;
uniform int u_pass;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.02; a *= 0.5; } return v; }
vec3 hue(vec3 c, float h) { const vec3 k = vec3(0.57735); float a = h * 6.2831853;
  return c * cos(a) + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cos(a)); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec4 pm(vec4 c) { return vec4(c.rgb * c.a, c.a); }
vec4 unpm(vec4 c) { return c.a > 1e-5 ? vec4(c.rgb / c.a, c.a) : vec4(0.0); }
vec2 aspect() { return vec2(u_res.x / u_res.y, 1.0); }
vec4 src(vec2 uv) { return texture(u_src, uv); }
// 13 taps along a direction, weighted like a gaussian, premultiplied.
vec4 blur1(vec2 uv, vec2 dir) {
  vec4 acc = vec4(0.0); float wsum = 0.0;
  for (int i = -6; i <= 6; i++) { float w = exp(-float(i * i) / 18.0); acc += pm(texture(u_src, uv + dir * float(i) / 6.0)) * w; wsum += w; }
  return acc / wsum;
}
vec3 lut3(vec3 c) {
  float N = u_lutSize; c = clamp(c, 0.0, 1.0);
  float b = c.b * (N - 1.0); float b0 = floor(b); float b1 = min(b0 + 1.0, N - 1.0); float f = b - b0;
  vec2 uv0 = vec2((c.r * (N - 1.0) + 0.5 + b0 * N) / (N * N), (c.g * (N - 1.0) + 0.5) / N);
  vec2 uv1 = vec2((c.r * (N - 1.0) + 0.5 + b1 * N) / (N * N), uv0.y);
  return mix(texture(u_aux, uv0).rgb, texture(u_aux, uv1).rgb, f);
}
`

export const EFFECT_TYPES: EffectType[] = [
  // blur and sharpen
  {
    id: 'blur', name: 'Gaussian blur', group: 'Blur and sharpen', about: 'Soft blur', passes: 2,
    params: [num('radius', 'Blurriness', 0, 0.15, 0.01, 0.0005), { key: 'dims', label: 'Direction', kind: 'choice', default: 0, choices: ['Both', 'Across', 'Up and down'] }],
    glsl: `int dims = int(u_n[1] + 0.5);
      vec2 d = u_pass == 0 ? vec2(u_n[0] / aspect().x, 0.0) : vec2(0.0, u_n[0]);
      if ((u_pass == 0 && dims == 2) || (u_pass == 1 && dims == 1)) return src(uv);
      return unpm(blur1(uv, d));`,
  },
  {
    id: 'dirblur', name: 'Directional blur', group: 'Blur and sharpen', about: 'Motion smear in one direction',
    params: [num('angle', 'Direction', -180, 180, 0, 1), num('length', 'Length', 0, 0.3, 0.05, 0.001)],
    glsl: `float a = u_n[0] * 0.0174533; vec2 d = vec2(cos(a) / aspect().x, sin(a)) * u_n[1];
      vec4 acc = vec4(0.0); for (int i = -12; i <= 12; i++) acc += pm(src(uv + d * float(i) / 24.0)); return unpm(acc / 25.0);`,
  },
  {
    id: 'radialblur', name: 'Radial blur', group: 'Blur and sharpen', about: 'Zoom or spin blur around a point',
    params: [num('amount', 'Amount', 0, 1, 0.2), { key: 'kind', label: 'Type', kind: 'choice', default: 0, choices: ['Zoom', 'Spin'] }, num('cx', 'Center X', 0, 1, 0.5), num('cy', 'Center Y', 0, 1, 0.5)],
    glsl: `vec2 c = vec2(u_n[2], u_n[3]); vec4 acc = vec4(0.0);
      for (int i = 0; i < 24; i++) { float k = float(i) / 23.0 - 0.5;
        vec2 q;
        if (u_n[1] < 0.5) q = c + (uv - c) * (1.0 - k * u_n[0] * 0.5);
        else { vec2 v = (uv - c) * aspect(); float a = k * u_n[0] * 0.8; v = mat2(cos(a), -sin(a), sin(a), cos(a)) * v; q = c + v / aspect(); }
        acc += pm(src(q)); }
      return unpm(acc / 24.0);`,
  },
  {
    id: 'sharpen', name: 'Sharpen', group: 'Blur and sharpen', about: 'Crisper edges',
    params: [num('amount', 'Amount', 0, 3, 0.8)],
    glsl: `vec2 px = 1.0 / u_res; vec4 c = src(uv);
      vec4 b = (src(uv + vec2(px.x, 0.0)) + src(uv - vec2(px.x, 0.0)) + src(uv + vec2(0.0, px.y)) + src(uv - vec2(0.0, px.y))) * 0.25;
      return vec4(clamp(c.rgb + (c.rgb - b.rgb) * u_n[0], 0.0, 1.0), c.a);`,
  },

  // color
  {
    id: 'grade', name: 'Color grade', group: 'Color', about: 'Exposure, contrast, lift, gamma, gain, temperature, tint and saturation, like a grading panel',
    params: [
      num('exposure', 'Exposure', -4, 4, 0), num('contrast', 'Contrast', 0, 3, 1), num('pivot', 'Pivot', 0, 1, 0.435),
      num('lift', 'Lift', -0.5, 0.5, 0), num('gamma', 'Gamma', 0.2, 3, 1), num('gain', 'Gain', 0, 3, 1),
      num('temp', 'Temperature', -1, 1, 0), num('tint', 'Tint', -1, 1, 0), num('sat', 'Saturation', 0, 3, 1), num('vib', 'Vibrance', -1, 1, 0),
      num('shadows', 'Shadows', -1, 1, 0), num('highlights', 'Highlights', -1, 1, 0),
      color('liftC', 'Lift color', '#808080'), color('gammaC', 'Gamma color', '#808080'), color('gainC', 'Gain color', '#808080'),
    ],
    glsl: `vec4 s = src(uv); vec3 c = s.rgb;
      c *= exp2(u_n[0]);
      c *= vec3(1.0 + u_n[6] * 0.25, 1.0 + u_n[7] * 0.15, 1.0 - u_n[6] * 0.25) * vec3(1.0, 1.0 - u_n[7] * 0.15, 1.0);
      vec3 liftC = (u_c[0] - 0.5) * 0.5, gammaC = (u_c[1] - 0.5), gainC = (u_c[2] - 0.5);
      c = c * (u_n[5] + gainC) + (u_n[3] + liftC) * (1.0 - c);
      c = pow(max(c, 0.0), 1.0 / max(vec3(0.05), u_n[4] + gammaC));
      float L = luma(c);
      c += u_n[10] * 0.5 * (1.0 - smoothstep(0.0, 0.5, L)) * (1.0 - c) * 0.6 + u_n[11] * 0.5 * smoothstep(0.5, 1.0, L) * (u_n[11] > 0.0 ? 1.0 - c : c);
      c = (c - u_n[2]) * u_n[1] + u_n[2];
      L = luma(c);
      float satNow = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
      c = mix(vec3(L), c, u_n[8] * (1.0 + u_n[9] * (1.0 - satNow)));
      return vec4(clamp(c, 0.0, 1.0), s.a);`,
  },
  {
    id: 'curves', name: 'Curves', group: 'Color', about: 'Master, red, green and blue curves', aux: 'curve',
    params: [{ key: 'curve', label: 'Curves', kind: 'curve', default: '' }, num('mix', 'Amount', 0, 1, 1)],
    glsl: `vec4 s = src(uv); vec3 c = clamp(s.rgb, 0.0, 1.0);
      vec3 r = vec3(texture(u_aux, vec2((c.r * 255.0 + 0.5) / 256.0, 0.5)).r, texture(u_aux, vec2((c.g * 255.0 + 0.5) / 256.0, 0.5)).g, texture(u_aux, vec2((c.b * 255.0 + 0.5) / 256.0, 0.5)).b);
      return vec4(mix(s.rgb, r, u_n[0]), s.a);`,
  },
  {
    id: 'lut', name: 'LUT', group: 'Color', about: 'A .cube look-up table, or a look matched from a picture', aux: 'lut',
    params: [{ key: 'lut', label: 'LUT', kind: 'lut', default: '' }, num('mix', 'Amount', 0, 1, 1)],
    glsl: `vec4 s = src(uv); if (u_lutSize < 2.0) return s; return vec4(mix(s.rgb, lut3(s.rgb), u_n[0]), s.a);`,
  },
  {
    id: 'levels', name: 'Levels', group: 'Color', about: 'Input black and white, gamma, output black and white',
    params: [num('inB', 'Input black', 0, 1, 0), num('inW', 'Input white', 0, 1, 1), num('gamma', 'Gamma', 0.1, 4, 1), num('outB', 'Output black', 0, 1, 0), num('outW', 'Output white', 0, 1, 1)],
    glsl: `vec4 s = src(uv); vec3 c = clamp((s.rgb - u_n[0]) / max(u_n[1] - u_n[0], 1e-4), 0.0, 1.0);
      c = pow(c, vec3(1.0 / u_n[2])); return vec4(mix(vec3(u_n[3]), vec3(u_n[4]), c), s.a);`,
  },
  {
    id: 'huesat', name: 'Hue and saturation', group: 'Color', about: 'Turn the hues, more or less color, lighter or darker',
    params: [num('hue', 'Hue', -1, 1, 0), num('sat', 'Saturation', 0, 3, 1), num('light', 'Lightness', -1, 1, 0), num('colorize', 'Colorize', 0, 1, 0, 1), color('cz', 'Colorize color', '#f820a0')],
    glsl: `vec4 s = src(uv); vec3 c = hue(s.rgb, u_n[0]); float L = luma(c);
      c = mix(vec3(L), c, u_n[1]); c = u_n[2] > 0.0 ? mix(c, vec3(1.0), u_n[2]) : c * (1.0 + u_n[2]);
      if (u_n[3] > 0.5) c = u_c[0] * L * 2.0;
      return vec4(clamp(c, 0.0, 1.0), s.a);`,
  },
  {
    id: 'brightness', name: 'Brightness and contrast', group: 'Color', about: 'The simple way',
    params: [num('b', 'Brightness', -1, 1, 0), num('c', 'Contrast', 0, 3, 1)],
    glsl: `vec4 s = src(uv); return vec4(clamp((s.rgb - 0.5) * u_n[1] + 0.5 + u_n[0], 0.0, 1.0), s.a);`,
  },
  {
    id: 'tint', name: 'Tint', group: 'Color', about: 'Maps dark to one color and light to another (gradient map)',
    params: [num('amount', 'Amount', 0, 1, 1), color('black', 'Map black to', '#00051e'), color('white', 'Map white to', '#3bff03')],
    glsl: `vec4 s = src(uv); return vec4(mix(s.rgb, mix(u_c[0], u_c[1], luma(s.rgb)), u_n[0]), s.a);`,
  },
  {
    id: 'bw', name: 'Black and white', group: 'Color', about: 'Gray, with how much each color counts',
    params: [num('r', 'Reds', 0, 2, 0.3), num('g', 'Greens', 0, 2, 0.59), num('b', 'Blues', 0, 2, 0.11), num('amount', 'Amount', 0, 1, 1)],
    glsl: `vec4 s = src(uv); float L = dot(s.rgb, vec3(u_n[0], u_n[1], u_n[2])); return vec4(mix(s.rgb, vec3(L), u_n[3]), s.a);`,
  },
  {
    id: 'fill', name: 'Fill', group: 'Color', about: 'One color, keeping the shape',
    params: [num('amount', 'Amount', 0, 1, 1), color('color', 'Color', '#f820a0')],
    glsl: `vec4 s = src(uv); return vec4(mix(s.rgb, u_c[0], u_n[0]), s.a);`,
  },
  {
    id: 'invert', name: 'Invert', group: 'Color', about: 'Negative', params: [num('amount', 'Amount', 0, 1, 1)],
    glsl: `vec4 s = src(uv); return vec4(mix(s.rgb, 1.0 - s.rgb, u_n[0]), s.a);`,
  },
  {
    id: 'threshold', name: 'Threshold', group: 'Color', about: 'Black or white', params: [num('level', 'Level', 0, 1, 0.5), num('soft', 'Softness', 0, 0.5, 0.01)],
    glsl: `vec4 s = src(uv); float v = smoothstep(u_n[0] - u_n[1], u_n[0] + u_n[1], luma(s.rgb)); return vec4(vec3(v), s.a);`,
  },
  {
    id: 'posterize', name: 'Posterize', group: 'Color', about: 'Fewer colors', params: [num('levels', 'Levels', 2, 32, 6, 1)],
    glsl: `vec4 s = src(uv); return vec4(floor(s.rgb * u_n[0]) / (u_n[0] - 1.0), s.a);`,
  },

  // distort
  {
    id: 'wave', name: 'Wave warp', group: 'Distort', about: 'Waves through the picture',
    params: [num('amp', 'Height', 0, 0.2, 0.02, 0.001), num('len', 'Wavelength', 0.01, 1, 0.15, 0.001), num('speed', 'Speed', -10, 10, 1), num('angle', 'Direction', -180, 180, 0, 1)],
    glsl: `float a = u_n[3] * 0.0174533; vec2 dir = vec2(cos(a), sin(a)); vec2 pp = uv * aspect();
      float ph = dot(pp, dir) / u_n[1] * 6.2831853 - u_time * u_n[2];
      vec2 off = vec2(-dir.y, dir.x) * sin(ph) * u_n[0]; return src(uv + off / aspect());`,
  },
  {
    id: 'turbulent', name: 'Turbulent displace', group: 'Distort', about: 'Liquid wobble from noise',
    params: [num('amount', 'Amount', 0, 0.3, 0.04, 0.001), num('size', 'Size', 0.5, 30, 4), num('speed', 'Speed', 0, 4, 0.4), num('complex', 'Complexity', 0, 1, 0.5)],
    glsl: `vec2 q = uv * u_n[1] * aspect() + u_time * u_n[2];
      vec2 off = vec2(fbm(q) - 0.5, fbm(q + 7.3) - 0.5) * 2.0;
      off = mix(vec2(noise(q) - 0.5, noise(q + 3.1) - 0.5) * 2.0, off, u_n[3]);
      return src(uv + off * u_n[0] / aspect());`,
  },
  {
    id: 'twirl', name: 'Twirl', group: 'Distort', about: 'A whirlpool', params: [num('angle', 'Angle', -1440, 1440, 180, 1), num('radius', 'Radius', 0.01, 1, 0.35), num('cx', 'Center X', 0, 1, 0.5), num('cy', 'Center Y', 0, 1, 0.5)],
    glsl: `vec2 c = vec2(u_n[2], u_n[3]); vec2 v = (uv - c) * aspect(); float r = length(v);
      float k = max(0.0, 1.0 - r / u_n[1]); float a = u_n[0] * 0.0174533 * k * k;
      v = mat2(cos(a), -sin(a), sin(a), cos(a)) * v; return src(c + v / aspect());`,
  },
  {
    id: 'bulge', name: 'Bulge', group: 'Distort', about: 'Pushes the middle out (or in)', params: [num('amount', 'Amount', -1, 1, 0.5), num('radius', 'Radius', 0.01, 1, 0.3), num('cx', 'Center X', 0, 1, 0.5), num('cy', 'Center Y', 0, 1, 0.5)],
    glsl: `vec2 c = vec2(u_n[2], u_n[3]); vec2 v = (uv - c) * aspect(); float r = length(v) / u_n[1];
      if (r < 1.0) v *= mix(1.0, smoothstep(0.0, 1.0, r), u_n[0]); return src(c + v / aspect());`,
  },
  {
    id: 'polar', name: 'Polar coordinates', group: 'Distort', about: 'Rectangle to circle and back', params: [num('amount', 'Amount', 0, 1, 1), { key: 'kind', label: 'Type', kind: 'choice', default: 0, choices: ['Rect to polar', 'Polar to rect'] }],
    glsl: `vec2 q;
      if (u_n[1] < 0.5) { vec2 v = (uv - 0.5) * aspect(); q = vec2(atan(v.x, -v.y) / 6.2831853 + 0.5, 1.0 - length(v) * 2.0); }
      else { float a = (uv.x - 0.5) * 6.2831853; float r = (1.0 - uv.y) * 0.5; q = vec2(sin(a), -cos(a)) * r / aspect() + 0.5; }
      return src(mix(uv, q, u_n[0]));`,
  },
  {
    id: 'mirror', name: 'Mirror', group: 'Distort', about: 'Folds the picture along a line', params: [num('angle', 'Angle', -180, 180, 0, 1), num('cx', 'Center X', 0, 1, 0.5), num('cy', 'Center Y', 0, 1, 0.5)],
    glsl: `float a = u_n[0] * 0.0174533; vec2 n = vec2(cos(a), sin(a)); vec2 c = vec2(u_n[1], u_n[2]);
      vec2 v = (uv - c) * aspect(); float d = dot(v, n); if (d < 0.0) v -= 2.0 * d * n; return src(c + v / aspect());`,
  },
  {
    id: 'kaleido', name: 'Kaleidoscope', group: 'Distort', about: 'Mirror slices around a point', params: [num('slices', 'Slices', 2, 32, 6, 1), num('turn', 'Turn', 0, 1, 0), num('cx', 'Center X', 0, 1, 0.5), num('cy', 'Center Y', 0, 1, 0.5)],
    glsl: `vec2 c = vec2(u_n[2], u_n[3]); vec2 v = (uv - c) * aspect(); float r = length(v); float a = atan(v.y, v.x) + u_n[1] * 6.2831853;
      float seg = 6.2831853 / u_n[0]; a = abs(mod(a, seg) - seg * 0.5); return src(c + vec2(cos(a), sin(a)) * r / aspect());`,
  },
  {
    id: 'tile', name: 'Offset and tile', group: 'Distort', about: 'Slides the picture with wrap-around, or repeats it',
    params: [num('x', 'Offset X', -1, 1, 0, 0.001), num('y', 'Offset Y', -1, 1, 0, 0.001), num('tiles', 'Tiles', 1, 16, 1, 1), num('speed', 'Scroll speed', -2, 2, 0)],
    glsl: `return src(fract((uv - 0.5) * u_n[2] + 0.5 + vec2(u_n[0] + u_time * u_n[3], u_n[1])));`,
  },

  // stylize
  {
    id: 'glow', name: 'Glow', group: 'Stylize', about: 'Bright parts bloom', passes: 3,
    params: [num('threshold', 'Threshold', 0, 1, 0.6), num('radius', 'Radius', 0, 0.2, 0.03, 0.0005), num('intensity', 'Intensity', 0, 5, 1.2), color('tint', 'Color', '#ffffff')],
    glsl: `if (u_pass == 0) {
        vec4 acc = vec4(0.0); float wsum = 0.0;
        for (int i = -6; i <= 6; i++) { float w = exp(-float(i * i) / 18.0); vec4 s = texture(u_orig, uv + vec2(u_n[1] / aspect().x * float(i) / 6.0, 0.0));
          float k = smoothstep(u_n[0], u_n[0] + 0.1, luma(s.rgb)) * s.a; acc += vec4(s.rgb * k, k) * w; wsum += w; }
        return acc / wsum;
      }
      if (u_pass == 1) { vec4 acc = vec4(0.0); float wsum = 0.0;
        for (int i = -6; i <= 6; i++) { float w = exp(-float(i * i) / 18.0); acc += texture(u_src, uv + vec2(0.0, u_n[1] * float(i) / 6.0)) * w; wsum += w; }
        return acc / wsum; }
      vec4 o0 = texture(u_orig, uv); vec4 g = texture(u_src, uv);
      vec3 c = o0.rgb * o0.a + g.rgb * u_c[0] * u_n[2]; float a = clamp(o0.a + g.a * u_n[2], 0.0, 1.0);
      return vec4(c / max(a, 1e-4), a);`,
  },
  {
    id: 'mosaic', name: 'Mosaic', group: 'Stylize', about: 'Big pixels', params: [num('cells', 'Cells across', 2, 400, 40, 1), num('sharp', 'Sharp colors', 0, 1, 1, 1)],
    glsl: `vec2 n = vec2(u_n[0], u_n[0] / aspect().x); return src((floor(uv * n) + 0.5) / n);`,
  },
  {
    id: 'rgbsplit', name: 'Chromatic aberration', group: 'Stylize', about: 'Red and blue pulled apart, like a cheap lens',
    params: [num('amount', 'Amount', 0, 0.05, 0.006, 0.0005), num('angle', 'Angle', -180, 180, 0, 1), num('radial', 'From the middle', 0, 1, 1, 1)],
    glsl: `float a = u_n[1] * 0.0174533; vec2 d = u_n[2] > 0.5 ? (uv - 0.5) * u_n[0] * 4.0 : vec2(cos(a), sin(a)) * u_n[0];
      vec4 g = src(uv); return vec4(src(uv + d).r, g.g, src(uv - d).b, max(g.a, max(src(uv + d).a, src(uv - d).a)));`,
  },
  {
    id: 'vignette', name: 'Vignette', group: 'Stylize', about: 'Darker corners', params: [num('amount', 'Amount', 0, 1, 0.5), num('size', 'Size', 0, 1.5, 0.75), num('soft', 'Softness', 0.01, 1, 0.45), num('round', 'Roundness', 0, 1, 0.5)],
    glsl: `vec4 s = src(uv); vec2 v = (uv - 0.5) * mix(vec2(1.0), aspect(), u_n[3]) * 2.0;
      float k = smoothstep(u_n[1], u_n[1] - u_n[2], length(v)); return vec4(s.rgb * mix(1.0, k, u_n[0]), s.a);`,
  },
  {
    id: 'grain', name: 'Grain', group: 'Stylize', about: 'Film grain', params: [num('amount', 'Amount', 0, 0.5, 0.08), num('size', 'Size', 0.5, 4, 1), num('color', 'Color grain', 0, 1, 0)],
    glsl: `vec4 s = src(uv); vec2 q = floor(uv * u_res / u_n[1]); float t = floor(u_time * 24.0);
      vec3 n = vec3(hash(q + t), hash(q + t + 17.0), hash(q + t + 41.0)) - 0.5; n = mix(vec3(n.r), n, u_n[2]);
      return vec4(clamp(s.rgb + n * u_n[0], 0.0, 1.0), s.a);`,
  },
  {
    id: 'edges', name: 'Find edges', group: 'Stylize', about: 'Only the outlines', params: [num('amount', 'Amount', 0, 4, 1.5), num('invert', 'Dark lines on white', 0, 1, 0, 1)],
    glsl: `vec2 px = 1.0 / u_res; float l = luma(src(uv - vec2(px.x, 0.0)).rgb), r = luma(src(uv + vec2(px.x, 0.0)).rgb);
      float t = luma(src(uv + vec2(0.0, px.y)).rgb), b = luma(src(uv - vec2(0.0, px.y)).rgb);
      float e = clamp(length(vec2(r - l, t - b)) * u_n[0] * 4.0, 0.0, 1.0); vec4 s = src(uv);
      return vec4(vec3(u_n[1] > 0.5 ? 1.0 - e : e) * (u_n[1] > 0.5 ? 1.0 : 1.0) * mix(vec3(1.0), s.rgb, 0.0), s.a);`,
  },
  {
    id: 'scanlines', name: 'Scan lines', group: 'Stylize', about: 'Old screen lines that roll', params: [num('amount', 'Amount', 0, 1, 0.3), num('count', 'Lines', 20, 1200, 300, 1), num('speed', 'Roll', -4, 4, 0.3)],
    glsl: `vec4 s = src(uv); float l = 0.5 + 0.5 * sin((uv.y + u_time * u_n[2] * 0.05) * u_n[1] * 3.14159); return vec4(s.rgb * (1.0 - u_n[0] * l), s.a);`,
  },

  // perspective
  {
    id: 'shadow', name: 'Drop shadow', group: 'Perspective', about: 'A soft shadow behind the layer',
    params: [num('dist', 'Distance', 0, 0.2, 0.02, 0.0005), num('angle', 'Direction', -180, 180, -45, 1), num('soft', 'Softness', 0, 0.1, 0.01, 0.0005), num('opacity', 'Opacity', 0, 1, 0.6), color('color', 'Color', '#000000')],
    glsl: `float a = u_n[1] * 0.0174533; vec2 off = vec2(cos(a) / aspect().x, sin(a)) * u_n[0]; float sh = 0.0;
      for (int i = 0; i < 16; i++) { float k = float(i) * 2.399963; vec2 j = vec2(cos(k), sin(k)) * sqrt(float(i) / 16.0) * u_n[2]; sh += src(uv - off + j / aspect()).a; }
      sh = sh / 16.0 * u_n[3]; vec4 s = src(uv); float aOut = s.a + sh * (1.0 - s.a);
      return vec4((s.rgb * s.a + u_c[0] * sh * (1.0 - s.a)) / max(aOut, 1e-4), aOut);`,
  },

  // keying
  {
    id: 'diffkey', name: 'Background remover (clean plate)', group: 'Keying', about: 'Live rotoscoping without a green screen: capture the empty scene once, then everything that differs from it stays (a person, a hand, an object)', aux: 'plate',
    params: [num('tol', 'Threshold', 0, 1, 0.12), num('soft', 'Softness', 0, 0.5, 0.06), num('grow', 'Fill holes', 0, 1, 0.3), num('show', 'Show the matte', 0, 1, 0, 1)],
    glsl: `vec4 s = src(uv); if (u_lutSize < 0.5) return s;
      float d = 0.0; vec2 px = 1.0 / u_res;
      for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
        vec2 q = uv + vec2(float(x), float(y)) * px * (1.0 + u_n[2] * 6.0);
        vec3 a = src(q).rgb, b = texture(u_aux, q).rgb;
        d = max(d, distance(a, b) * (x == 0 && y == 0 ? 1.0 : u_n[2]));
      }
      float m = smoothstep(u_n[0], u_n[0] + u_n[1] + 0.001, d);
      if (u_n[3] > 0.5) return vec4(vec3(m), 1.0);
      return vec4(s.rgb, s.a * m);`,
  },
  {
    id: 'chromakey', name: 'Color key', group: 'Keying', about: 'Makes one color see-through (green screen), with spill removal',
    params: [num('tol', 'Tolerance', 0, 1, 0.25), num('soft', 'Softness', 0, 0.5, 0.08), num('spill', 'Spill removal', 0, 1, 0.5), color('key', 'Key color', '#00ff00')],
    glsl: `vec4 s = src(uv); vec3 k = u_c[0];
      vec2 cs = vec2(s.r - luma(s.rgb), s.b - luma(s.rgb)), ck = vec2(k.r - luma(k), k.b - luma(k));
      float d = distance(cs, ck) + 0.25 * abs(luma(s.rgb) - luma(k)) * 0.2;
      float a = smoothstep(u_n[0] * 0.5, u_n[0] * 0.5 + u_n[1], d);
      vec3 c = s.rgb; float m = max(c.r, c.b); if (k.g > k.r && k.g > k.b) c.g = mix(c.g, min(c.g, m), u_n[2]);
      return vec4(c, s.a * a);`,
  },
  {
    id: 'lumakey', name: 'Luma key', group: 'Keying', about: 'Dark (or bright) parts become see-through',
    params: [num('level', 'Level', 0, 1, 0.1), num('soft', 'Softness', 0, 0.5, 0.05), num('invert', 'Key out bright', 0, 1, 0, 1)],
    glsl: `vec4 s = src(uv); float v = smoothstep(u_n[0] - u_n[1], u_n[0] + u_n[1], luma(s.rgb)); if (u_n[2] > 0.5) v = 1.0 - v; return vec4(s.rgb, s.a * v);`,
  },
]

export const EFFECT_GROUPS: EffectGroup[] = ['Color', 'Blur and sharpen', 'Stylize', 'Distort', 'Perspective', 'Keying']

export function effectType(id: string): EffectType | undefined {
  return EFFECT_TYPES.find((e) => e.id === id)
}
