import * as THREE from 'three'
import { CHROME_COLORS, LATE_KINDS, newLayer, type MatLayer, type NormalStyle, type Obj3D } from './world'

// Layered materials: a physical (PBR) material with your layers mixed into
// its color, glow, roughness and metal, on the graphics card. The same
// system makes the iridescent material, so its film colors are yours.

const MAX_LAYERS = 8

const HASH = `float rHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }`
const SCRAP = `// paper scraps for the collage: which scrap this is, how far to its edge,
// and the scrap next to it (3D cells cut by the surface give torn polygons)
vec4 rScrap(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  float d1 = 8.0, d2 = 8.0; vec3 p1 = vec3(0.0), p2 = vec3(1.0), c1 = i, c2 = i;
  for (int a = -1; a <= 1; a++) for (int b = -1; b <= 1; b++) for (int c = -1; c <= 1; c++) {
    vec3 g = vec3(float(a), float(b), float(c));
    vec3 r = g + vec3(rHash(i + g), rHash(i + g + 11.3), rHash(i + g + 27.1)) * 0.9 - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; p2 = p1; c2 = c1; d1 = d; p1 = r; c1 = i + g; }
    else if (d < d2) { d2 = d; p2 = r; c2 = i + g; }
  }
  return vec4(rHash(c1 + 3.1), dot(0.5 * (p1 + p2), normalize(p2 - p1 + vec3(1e-5))), rHash(c2 + 3.1), 0.0);
}
`
const NOISE = `
${HASH}
float rNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(rHash(i), rHash(i + vec3(1,0,0)), f.x), mix(rHash(i + vec3(0,1,0)), rHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(rHash(i + vec3(0,0,1)), rHash(i + vec3(1,0,1)), f.x), mix(rHash(i + vec3(0,1,1)), rHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float rFbm(vec3 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * rNoise(p); p *= 2.03; a *= 0.5; } return v; }
uniform vec3 uC[${MAX_LAYERS * 4}];
uniform vec4 uP[${MAX_LAYERS}];      // amount, scale, speed, color count
uniform vec4 uQ[${MAX_LAYERS}];      // more per layer (paper: lift, crumple, scrap size, color mode)
uniform float uTime;
uniform float uShift;
uniform float uDrive;
uniform float uBoil;
uniform sampler2D uPRough;
uniform sampler2D uPMetal;
uniform sampler2D uPGlow;
uniform sampler2D uPBump;
uniform sampler2D uPGlass;
uniform vec4 uPBox;     // the paint box: center and half size
uniform float uPMode;   // 1 = box paint (seamless), 0 = older wrapped paint
uniform float uTri;     // 1 = pictures are projected from the sides (modeled shapes)
varying vec3 vObjN;
uniform vec2 uBox;
uniform sampler2D uPaint;
uniform sampler2D uPaintMask;
uniform sampler2D uPic0;
uniform sampler2D uPic1;
varying vec3 vObjPos;
varying vec2 vUv2;
// Paint from six sides: each point takes the picture of the sides it faces,
// blended by how much it faces them. The same layout is used to paint
// (paint.ts): +X, +Y, +Z on the top row, -X, -Y, -Z below.
vec4 pSide(sampler2D s, vec2 uv, float col, float row) {
  uv = clamp(uv, 0.002, 0.998);
  return texture2D(s, vec2((col + uv.x) / 3.0, 1.0 - (row + 1.0 - uv.y) / 2.0));
}
vec4 pTex(sampler2D s) {
  if (uPMode < 0.5) return texture2D(s, vUv2);
  vec3 q = (vObjPos - uPBox.xyz) / uPBox.w * 0.5 + 0.5;
  vec3 n = normalize(vObjN);
  vec3 w = pow(abs(n), vec3(4.0));
  w /= max(1e-5, w.x + w.y + w.z);
  vec4 c = vec4(0.0);
  if (w.x > 0.001) c += w.x * pSide(s, q.zy, 0.0, n.x >= 0.0 ? 0.0 : 1.0);
  if (w.y > 0.001) c += w.y * pSide(s, q.xz, 1.0, n.y >= 0.0 ? 0.0 : 1.0);
  if (w.z > 0.001) c += w.z * pSide(s, q.xy, 2.0, n.z >= 0.0 ? 0.0 : 1.0);
  return c;
}
// A picture on a shape: wrapped by its own coordinates, or projected from
// the sides on modeled shapes (no seams there).
vec4 picTex(sampler2D s, float sc, vec2 off) {
  if (uTri < 0.5) return texture2D(s, vUv2 * sc + off);
  vec3 n = normalize(vObjN);
  vec3 w = pow(abs(n), vec3(4.0)); w /= max(1e-5, w.x + w.y + w.z);
  vec3 p = vObjPos * sc * 0.5;
  return w.x * texture2D(s, p.zy + off) + w.y * texture2D(s, p.xz + off) + w.z * texture2D(s, p.xy + off);
}
vec3 rRamp(int o, int n, float t) {
  t = clamp(t, 0.0, 1.0);
  if (n <= 1) return uC[o];
  float x = t * float(n - 1); int i = int(min(floor(x), float(n - 2)));
  return mix(uC[o + i], uC[o + i + 1], x - float(i));
}
vec3 rCycle(int o, int n, float t) {
  t = fract(t);
  float x = t * float(n); int i = int(floor(x)) % n; int j = (i + 1) % n;
  return mix(uC[o + i], uC[o + j], smoothstep(0.0, 1.0, x - floor(x)));
}
// Brush strokes on the surface: the nearest of many small elongated strokes,
// each with its own random tilt (for the normal) and its own random value
// (for the color). Changing the seed redraws them all, like a new painting.
vec4 rStroke(vec3 p, vec3 nrm, float size, float stretch, float ang, float seed) {
  vec3 q = p / max(0.005, size);
  vec3 c = floor(q);
  vec3 up = abs(nrm.y) > 0.92 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 t1 = normalize(cross(nrm, up));
  vec3 t2 = cross(nrm, t1);
  vec3 dir0 = t1 * cos(ang) + t2 * sin(ang);
  float best = 1e9;
  vec4 res = vec4(0.0);
  for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) {
    vec3 cell = c + vec3(float(x), float(y), float(z));
    vec3 h = vec3(rHash(cell + seed), rHash(cell + seed + 11.1), rHash(cell + seed + 23.7));
    vec3 d = q - (cell + h);
    float a = (h.x - 0.5) * 1.1;
    vec3 sd = normalize(dir0 * cos(a) + cross(nrm, dir0) * sin(a));
    float along = dot(d, sd);
    float dist = length(d - sd * along) + abs(along) / max(1.0, stretch);
    if (dist < best) { best = dist; res = vec4(h * 2.0 - 1.0, rHash(cell + seed + 5.3)); }
  }
  return res;
}
// ---- looks on the lit picture ----
float rH2(vec2 p) { return rHash(vec3(p, 0.37)); }
float rLum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
// a printed dot: big where it is dark
float rHalfT(float lum, float px, float ang, vec2 off, float th) {
  vec2 p = (gl_FragCoord.xy + off) / max(2.0, px);
  float c = cos(ang), s = sin(ang); p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  vec2 f = fract(p) - 0.5;
  float r = sqrt(clamp(1.0 - lum, 0.0, 1.0)) * 0.72 * th;
  return 1.0 - smoothstep(r - 0.08, r + 0.08, length(f));
}
float rHalf(float lum, float px, float ang, vec2 off) { return rHalfT(lum, px, ang, off, 1.0); }
${SCRAP}
// pencil hatching: more crossing lines where it is darker, a little shaky
float rHatch(float lum, float px, float seed, float th) {
  vec2 p = gl_FragCoord.xy;
  float w = (rFbm(vec3(p * 0.015, seed)) - 0.5) * px * 0.9;
  float l1 = abs(fract((p.x + p.y + w) / px) - 0.5) * 2.0;
  float l2 = abs(fract((p.x - p.y + w) / px) - 0.5) * 2.0;
  float l3 = abs(fract((p.y + w * 0.6) / (px * 0.75)) - 0.5) * 2.0;
  float a = min(0.08 * th, 0.6), b = min(0.32 * th, 0.95);
  float h = (1.0 - smoothstep(a, b, l1)) * smoothstep(0.82, 0.62, lum);
  h = max(h, (1.0 - smoothstep(a, b, l2)) * smoothstep(0.55, 0.35, lum));
  h = max(h, (1.0 - smoothstep(a * 1.5, b * 1.2, l3)) * smoothstep(0.28, 0.12, lum));
  return h * (0.75 + 0.25 * rH2(floor(p / 2.0) + seed));
}
vec3 rBlend(vec3 a, vec3 b, float m, int mode) {
  if (mode == 1) return a + b * m;
  if (mode == 2) return mix(a, a * b, m);
  if (mode == 3) return mix(a, 1.0 - (1.0 - a) * (1.0 - b), m);
  return mix(a, b, m);
}
`


// Mixed media paper, before the light: which scrap, its paper and colors,
// torn white edges, and crumpled folds in the normal so the light shows them.
function paperEarly(l: MatLayer, i: number): string {
  const o = i * 4, n = `int(uP[${i}].w)`
  return `{
  float pAmt = clamp(uP[${i}].x${l.react ? ' * uDrive' : ''}, 0.0, 1.0);
  float sz = max(0.0001, uBox.y - uBox.x);
  float st = floor(uTime * uP[${i}].z) + floor(uBoil * 8.0) * 3.7;
  vec3 q = vObjPos / sz * (2.2 / max(0.2, uQ[${i}].z)) + vec3(rHash(vec3(st, 4.0, 0.0)), rHash(vec3(st, 5.0, 0.0)), rHash(vec3(st, 6.0, 0.0))) * 0.05;
  vec4 S = rScrap(q);
  float id = S.x, kind = fract(id * 7.31), mode = uQ[${i}].w;
  vec3 base = diffuseColor.rgb;
  float bl = rLum(base);
  vec3 ink = uC[${o}];
  vec3 P = ${n} >= 2 ? uC[${o + 1}] : vec3(0.93, 0.9, 0.84);
  vec3 A1 = ${n} >= 3 ? uC[${o + 2}] : vec3(1.0, 0.84, 0.0);
  vec3 A2 = ${n} >= 4 ? uC[${o + 3}] : vec3(1.0, 0.42, 0.1);
  vec3 pc;
  if (mode < 0.5) {
    // one color: tints of it on paper, darker where the shape is darker
    vec3 t = mix(P, A1, 0.2 + 0.7 * fract(id * 5.3));
    pc = mix(t * 0.32, t, smoothstep(0.05, 0.85, bl));
  } else if (mode < 1.5) {
    // two colors: each scrap is one of them, in two tones
    vec3 cc = fract(id * 13.7) < 0.5 ? A1 : A2;
    pc = mix(mix(ink, cc, 0.45), cc, step(0.45, bl + (id - 0.5) * 0.35));
    if (kind > 0.82) pc = P;
  } else {
    // full color: its own colors and pictures printed on paper, old photos, colored paper and newspaper
    if (kind < 0.45) pc = base * vec3(1.02, 0.97, 0.88);
    else if (kind < 0.62) pc = vec3(bl) * vec3(1.0, 0.95, 0.84);
    else if (kind < 0.78) pc = fract(id * 13.7) < 0.5 ? A1 : A2;
    else pc = P;
  }
  vec3 fq = vObjPos / sz;
  pc *= 0.88 + 0.16 * rFbm(fq * 40.0 + id * 3.0);
  pc *= 0.94 + 0.08 * rFbm(vec3(fq.x * 160.0, fq.y * 9.0, fq.z * 160.0) + id);
  // torn edges: white paper on the scrap on top, a shadow on the one under it
  float e = S.y + (rFbm(fq * 30.0 + st * 1.7) - 0.5) * 0.08 + (rFbm(fq * 110.0 + st) - 0.5) * 0.035;
  float top = step(S.z, id);
  float tw = 0.07;
  float wE = top * (1.0 - smoothstep(tw * 0.5, tw, e));
  pc = mix(pc, vec3(0.97, 0.95, 0.9) * (0.92 + 0.08 * rHash(vec3(floor(gl_FragCoord.xy), st))), wE);
  pc *= 1.0 - (1.0 - top) * 0.5 * (1.0 - smoothstep(0.0, tw * 2.2, e));
  diffuseColor.rgb = mix(diffuseColor.rgb, pc, pAmt);
  roughnessFactor = mix(roughnessFactor, 0.88, pAmt);
  metalnessFactor = mix(metalnessFactor, 0.0, pAmt);
  // crumpled paper: flat facets with sharp folds between them, big and
  // small, like a sheet that was balled up and flattened again
  float crs = uQ[${i}].y * pAmt;
  vec4 F1 = rScrap(fq * 9.0 + id * 7.0 + st * 0.71);
  vec4 F2 = rScrap(fq * 23.0 + id * 3.0 + st * 1.13);
  vec3 f1 = vec3(rHash(vec3(F1.x * 97.0, 1.0, 0.0)), rHash(vec3(F1.x * 97.0, 2.0, 0.0)), rHash(vec3(F1.x * 97.0, 3.0, 0.0))) - 0.5;
  vec3 f2 = vec3(rHash(vec3(F2.x * 71.0, 4.0, 0.0)), rHash(vec3(F2.x * 71.0, 5.0, 0.0)), rHash(vec3(F2.x * 71.0, 6.0, 0.0))) - 0.5;
  vec3 tilt = vec3(rHash(vec3(id * 91.0, 1.0, st)), rHash(vec3(id * 91.0, 2.0, st)), 0.0) - 0.5;
  normal = normalize(normal + (f1 * 0.8 + f2 * 0.3 + tilt * 0.35) * crs);
  // the fold lines catch a little light or shadow
  diffuseColor.rgb *= 1.0 - 0.12 * crs * (1.0 - smoothstep(0.0, 0.03, F1.y));
}`
}

// Mixed media paper in the vertex: scraps stand off the surface in layers,
// their top edges lift, and the paper is crumpled for real.
function paperVertex(l: MatLayer, i: number): string {
  return `{
  float sz = max(0.0001, uBox.y - uBox.x);
  float st = floor(uTime * uP[${i}].z) + floor(uBoil * 8.0) * 3.7;
  vec3 q = position / sz * (2.2 / max(0.2, uQ[${i}].z)) + vec3(rHash(vec3(st, 4.0, 0.0)), rHash(vec3(st, 5.0, 0.0)), rHash(vec3(st, 6.0, 0.0))) * 0.05;
  vec4 S = rScrap(q);
  float lift = 0.005 + 0.03 * S.x;
  lift += 0.014 * (1.0 - smoothstep(0.0, 0.14, S.y)) * step(S.z, S.x);
  float cr = (vNoise(position / sz * 9.0 + st * 1.37) - 0.5) * 0.03 * uQ[${i}].y;
  transformed += objectNormal * (lift * uQ[${i}].x + cr) * sz * clamp(uP[${i}].x${l.react ? ' * uDrive' : ''}, 0.0, 1.0);
}`
}

const BLEND = { mix: 0, add: 1, multiply: 2, screen: 3 }

function layerCode(l: MatLayer, i: number, pic: number): string {
  const o = i * 4, n = `int(uP[${i}].w)`, sc = `uP[${i}].y`, sp = `uP[${i}].z`
  let col = 'vec3(0.0)'
  let pre = ''
  let scalar = ''
  if (l.kind === 'strokes') {
    // speed = how many times a second the strokes are redrawn (stop motion)
    const len = Math.max(1, l.length ?? 3).toFixed(3), ang = (((l.angle ?? 0) * Math.PI) / 180).toFixed(4)
    pre = `vec4 S = rStroke(vObjPos, normalize(vObjN), ${sc}, ${len}, ${ang}, floor(uTime * ${sp}) * 7.13 + floor(uBoil * 8.0) * 3.7);`
    scalar = 'S.w'
  }
  switch (l.kind) {
    case 'strokes': col = l.target === 'normal' ? 'S.xyz' : `rRamp(${o}, ${n}, S.w)`; break
    case 'color': col = `uC[${o}]`; break
    case 'height': col = `rRamp(${o}, ${n}, (hgt - 0.5) * ${sc} + 0.5 + uTime * ${sp})`; break
    case 'fresnel': col = `rRamp(${o}, ${n}, pow(fres, max(0.1, 2.0 / max(0.05, ${sc}))))`; break
    case 'noise': col = `rRamp(${o}, ${n}, rFbm(vObjPos * ${sc} + vec3(0.0, uTime * ${sp}, 0.0)))`; break
    case 'stripes': col = `rRamp(${o}, ${n}, 0.5 + 0.5 * sin(vObjPos.y * ${sc} * 6.2831 + uTime * ${sp} * 6.2831))`; break
    case 'iridescent': col = `rCycle(${o}, ${n}, fres * ${sc} + rFbm(vObjPos * 2.0) * 0.35 + uTime * ${sp} + uShift)`; break
    case 'picture': col = `picTex(${pic === 0 ? 'uPic0' : 'uPic1'}, ${sc}, vec2(uTime * ${sp}, 0.0)).rgb`; break
    case 'paint': col = `pTex(uPaint).rgb`; break
  }
  let mask = '1.0'
  switch (l.mask) {
    case 'paint': mask = 'pTex(uPaintMask).r'; break
    case 'paint-inverse': mask = '(1.0 - pTex(uPaintMask).r)'; break
    case 'fresnel': mask = 'fres'; break
    case 'height': mask = 'hgt'; break
    case 'noise': mask = 'smoothstep(0.35, 0.65, rFbm(vObjPos * 3.0))'; break
  }
  if (l.kind === 'paint') mask = `${mask} * pTex(uPaint).a`
  const m = `uP[${i}].x * ${mask}${l.react ? ' * uDrive' : ''}`
  const mode = BLEND[l.blend] ?? 0
  if (!scalar) scalar = l.kind === 'noise' ? `rFbm(vObjPos * ${sc})` : `dot(${col}, vec3(0.333))`
  switch (l.target) {
    // Painterly: each stroke tilts the surface its own way, so light breaks
    // into flat dabs like paint on canvas.
    case 'normal': return `{ ${pre} vec3 L = ${col}; float m = ${m}; normal = normalize(normal + mat3(viewMatrix) * L * m * 0.9); }`
    // Ragged edges: near the silhouette, some strokes are cut away.
    case 'cutout': return `{ ${pre} float v = ${scalar}; float m = ${m}; if (pow(fres, 1.5) * m * 1.6 > v + 0.15) discard; }`
    case 'glow': return `{ ${pre} vec3 L = ${col}; float m = ${m}; totalEmissiveRadiance = rBlend(totalEmissiveRadiance, L, m, ${l.blend === 'mix' ? 1 : mode}); }`
    case 'rough': return `{ ${pre} vec3 L = ${col}; float m = ${m}; roughnessFactor = clamp(mix(roughnessFactor, dot(L, vec3(0.333)), m), 0.0, 1.0); }`
    case 'metal': return `{ ${pre} vec3 L = ${col}; float m = ${m}; metalnessFactor = clamp(mix(metalnessFactor, dot(L, vec3(0.333)), m), 0.0, 1.0); }`
    default: return `{ ${pre} vec3 L = ${col}; float m = ${m}; diffuseColor.rgb = rBlend(diffuseColor.rgb, L, m, ${mode}); }`
  }
}

// Looks that change the lit picture (they run after the light is added).
function lateCode(l: MatLayer, i: number): string {
  const o = i * 4, n = `int(uP[${i}].w)`, sc = `uP[${i}].y`, sp = `uP[${i}].z`
  const m = `uP[${i}].x${l.react ? ' * uDrive' : ''}`
  const boil = `(floor(uTime * ${sp}) + floor(uBoil * 8.0) * 3.7)`
  const paper = `(${n} >= 2 ? uC[${o + 1}] : src)`
  let body = ''
  switch (l.kind) {
    case 'chrome': body = `
      vec3 N = normalize(normal);
      float inside = clamp(abs(dot(N, Vd)), 0.0, 1.0), edge = 1.0 - inside;
      float nz = rFbm(vObjPos * 2.0 + vec3(0.0, uTime * ${sp} * 0.3, 0.0));
      float x = inside * 1.5 + nz * 0.9 + edge * 0.9 + uTime * ${sp} + uShift;
      vec3 spec = rCycle(${o}, ${n}, x * 0.5);
      spec = mix(spec, vec3(0.72, 0.66, 1.0), 0.1);
      vec3 bands = pow(spec, vec3(1.6)) * (0.03 + 1.7 * pow(edge, 1.6)) * 1.5;
      float env = pow(0.5 + 0.5 * cos(6.28318 * (N.x * 0.9 + N.y * 0.6 + nz * 0.8)), 4.0);
      vec3 sheen = mix(vec3(0.62, 0.58, 1.0), vec3(1.0), env) * env * smoothstep(0.15, 0.7, inside) * 0.4;
      vec3 rimL = vec3(1.0) * exp(-inside * 26.0) * 0.9;
      float hl = pow(max(dot(N, normalize(vec3(-0.45, 0.55, 1.7))), 0.0), 90.0);
      vec3 R = vec3(0.015, 0.012, 0.03) + bands + sheen + rimL + vec3(1.0) * hl * 1.3;
      R *= 0.86 + 0.28 * rH2(gl_FragCoord.xy * 0.73 + floor(uTime * 12.0));
      R += step(0.985, rFbm(vec3(dot(gl_FragCoord.xy, vec2(0.8, 0.6)) * 0.02, dot(gl_FragCoord.xy, vec2(-0.6, 0.8)) * 1.4, 0.0))) * 0.12 * (0.3 + edge);`; break
    case 'halftone': body = `
      float px = 9.0 * ${sc};
      vec2 j = vec2(rH2(vec2(${boil}, 1.0)), rH2(vec2(${boil}, 2.0))) * px;
      float d = rHalfT(rLum(src), px, 0.785, j, uQ[${i}].x);
      vec3 R = mix(${paper}, uC[${o}], d);`; break
    case 'misprint': body = `
      // flat comic colors, CMY dots that do not quite line up, and ink hatching in the shadows
      float px = 7.0 * ${sc};
      vec3 flt = floor(src * 4.0 + 0.5) / 4.0;
      vec2 mis = vec2(sin(${boil} * 1.7), cos(${boil} * 2.3)) * 2.5 * ${sc};
      vec3 ink = 1.0 - flt;
      float c = rHalf(1.0 - ink.r, px, 0.26, mis), mg = rHalf(1.0 - ink.g, px, 1.31, -mis), y = rHalf(1.0 - ink.b, px, 0.0, mis.yx);
      vec3 printed = ${paper} * vec3(1.0 - c * 0.9, 1.0 - mg * 0.9, 1.0 - y * 0.9);
      vec3 R = mix(printed, flt, 0.45);
      float h = rHatch(rLum(src) * 1.4, px * 0.9, ${boil}, uQ[${i}].x);
      R = mix(R, uC[${o}], h * 0.85);`; break
    case 'hatch': body = `
      float lum = rLum(src);
      float h = rHatch(lum, 7.0 * ${sc}, ${boil}, uQ[${i}].x);
      vec3 P = ${n} >= 2 ? uC[${o + 1}] : vec3(0.95, 0.93, 0.88);
      P *= 0.93 + 0.07 * rH2(floor(gl_FragCoord.xy));
      float rimInk = smoothstep(0.75, 0.98, fres);
      vec3 R = mix(P, uC[${o}], max(h * 0.9, rimInk));`; break
    case 'watercolor': body = `
      vec3 P = uC[${o}];
      float wob = rFbm(vObjPos * 3.0 * ${sc} + vec3(uTime * ${sp}));
      vec3 pig = mix(src, floor(src * 4.0 + wob * 0.8) / 4.0, 0.55);
      float edgeD = smoothstep(0.55, 0.95, fres);
      pig *= 1.0 - edgeD * 0.35;
      float gran = rFbm(vec3(gl_FragCoord.xy * 0.45, 2.0));
      vec3 R = mix(P, pig, 0.7 + 0.3 * gran);
      R = mix(R, P, smoothstep(0.62, 0.9, rFbm(vObjPos * 1.5 * ${sc} + 7.0)) * 0.45);
      R *= 0.92 + 0.08 * rFbm(vec3(gl_FragCoord.xy * 0.12, 1.0));`; break
    case 'newsprint': body = `
      // mixed media paper, after the light: print dots on old photos,
      // newspaper text, and grain
      float sz = max(0.0001, uBox.y - uBox.x);
      float st = ${boil};
      vec3 q = vObjPos / sz * (2.2 / max(0.2, uQ[${i}].z)) + vec3(rHash(vec3(st, 4.0, 0.0)), rHash(vec3(st, 5.0, 0.0)), rHash(vec3(st, 6.0, 0.0))) * 0.05;
      vec4 S = rScrap(q);
      float id = S.x, kind = fract(id * 7.31), mode = uQ[${i}].w;
      float ang = (id - 0.5) * 0.9;
      vec2 sp = gl_FragCoord.xy + vec2(id * 37.0, id * 91.0);
      vec2 rp = vec2(cos(ang) * sp.x - sin(ang) * sp.y, sin(ang) * sp.x + cos(ang) * sp.y);
      float lum = rLum(src);
      vec3 ink = uC[${o}];
      vec3 R = src;
      float far = step(0.07, S.y);
      if (mode > 1.5 && kind >= 0.45 && kind < 0.62) R = mix(R, ink * lum * 0.6, rHalf(clamp(lum * 1.3, 0.0, 1.0), 3.4 * ${sc}, ang + 0.785, vec2(id * 13.0)) * 0.55 * far);
      if (mode > 0.5 && mode < 1.5 && kind > 0.55 && kind <= 0.82) R = mix(R, R * 0.55, rHalf(clamp(lum * 1.2, 0.0, 1.0), 5.0 * ${sc}, 0.4, vec2(0.0)) * 0.6 * far);
      if ((mode > 1.5 && kind >= 0.78) || (mode < 1.5 && kind > 0.9)) {
        vec2 tp = rp / (2.6 * ${sc} + 0.8);
        float row = floor(tp.y / 2.2);
        float txt = (1.0 - step(0.45, fract(tp.y / 2.2))) * step(0.2, rH2(vec2(floor(tp.x / (3.0 + fract(row * 0.37) * 4.0)), row))) * step(0.05, fract(tp.x / 46.0));
        R = mix(R, ink * (0.3 + 0.4 * lum), txt * 0.8 * far);
      }
      R *= 0.9 + 0.14 * rH2(floor(gl_FragCoord.xy) + st);`; break
  }
  return `{ vec3 src = outgoingLight; ${body} outgoingLight = mix(src, R, clamp(${m}, 0.0, 1.0)); }`
}

export const structureOf = (layers: MatLayer[]) => layers.filter((l) => l.on).slice(0, MAX_LAYERS).map((l) => `${l.kind}.${l.blend}.${l.target}.${l.mask}.${l.react ? 'r' : ''}.v2.${l.kind === 'strokes' ? `${l.length}.${l.angle}` : ''}`).join('|')

const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1)
blank.needsUpdate = true

export interface LayerUniforms {
  uC: { value: THREE.Color[] }
  uP: { value: THREE.Vector4[] }
  uTime: { value: number }
  uShift: { value: number }
  uBox: { value: THREE.Vector2 }
  uPaint: { value: THREE.Texture }
  uPaintMask: { value: THREE.Texture }
  uPic0: { value: THREE.Texture }
  uPic1: { value: THREE.Texture }
  uDrive: { value: number }
  uBoil: { value: number }
  uPRough: { value: THREE.Texture }
  uPMetal: { value: THREE.Texture }
  uPGlow: { value: THREE.Texture }
  uPBump: { value: THREE.Texture }
  uPGlass: { value: THREE.Texture }
  uPBox: { value: THREE.Vector4 }
  uPMode: { value: number }
  uTri: { value: number }
  uNS: { value: THREE.Vector4 }
  uNC: { value: THREE.Vector3 }
  uSteps: { value: number }
  uQ: { value: THREE.Vector4[] }
}

export function layeredMaterial(layers: MatLayer[], base: THREE.MeshPhysicalMaterialParameters): THREE.MeshPhysicalMaterial {
  return installLayers(new THREE.MeshPhysicalMaterial(base), layers)
}

// Any physical or standard material (one that came with a model, too) with
// RICO's layers added on top of it, like a post process on just this object.
// Its own maps and colors stay; the layers are mixed in after them.
export function installLayers<T extends THREE.MeshStandardMaterial>(mat: T, layers: MatLayer[]): T {
  const on = layers.filter((l) => l.on).slice(0, MAX_LAYERS)
  const u: LayerUniforms = {
    uC: { value: Array.from({ length: MAX_LAYERS * 4 }, () => new THREE.Color()) },
    uP: { value: Array.from({ length: MAX_LAYERS }, () => new THREE.Vector4()) },
    uTime: { value: 0 }, uShift: { value: 0 }, uBox: { value: new THREE.Vector2(-1, 1) },
    uPaint: { value: blank }, uPaintMask: { value: blank }, uPic0: { value: blank }, uPic1: { value: blank },
    uDrive: { value: 1 }, uBoil: { value: 0 }, uPRough: { value: blank }, uPMetal: { value: blank }, uPGlow: { value: blank }, uPBump: { value: blank },
    uPGlass: { value: blank }, uPBox: { value: new THREE.Vector4(0, 0, 0, 1) }, uPMode: { value: 1 }, uTri: { value: 0 },
    uNS: { value: new THREE.Vector4(0, 0, 0, 3) }, uNC: { value: new THREE.Vector3() }, uSteps: { value: 0 },
    uQ: { value: Array.from({ length: MAX_LAYERS }, () => new THREE.Vector4(1, 1, 1, 2)) },
  }
  mat.userData.layerUniforms = u
  let pic = 0
  const code = on.map((l, i) => (l.kind === 'newsprint' ? paperEarly(l, i) : LATE_KINDS.includes(l.kind) ? '' : layerCode(l, i, l.kind === 'picture' ? pic++ : 0))).join('\n')
  const vcode = on.map((l, i) => (l.kind === 'newsprint' ? paperVertex(l, i) : '')).join('\n')
  const late = on.map((l, i) => (LATE_KINDS.includes(l.kind) ? lateCode(l, i) : '')).join('\n')
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
varying vec3 vObjPos;
varying vec2 vUv2;
varying vec3 vObjN;
uniform vec4 uNS;   // normal style: round, facets, noise, noise size
uniform vec4 uP[${MAX_LAYERS}];
uniform vec4 uQ[${MAX_LAYERS}];
uniform vec2 uBox;
uniform float uTime;
uniform float uBoil;
${HASH}
${SCRAP}
uniform vec3 uNC;
float vHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vNoise(vec3 x) { vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(vHash(i), vHash(i + vec3(1,0,0)), f.x), mix(vHash(i + vec3(0,1,0)), vHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(vHash(i + vec3(0,0,1)), vHash(i + vec3(1,0,1)), f.x), mix(vHash(i + vec3(0,1,1)), vHash(i + vec3(1,1,1)), f.x), f.y), f.z); }`)
      // Your own normals: rounder, cut into flat planes, or bent by noise
      // (stylized shading, and stronger painterly strokes).
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
{
  vec3 sph = normalize(position - uNC + vec3(1e-5));
  objectNormal = normalize(mix(objectNormal, sph, uNS.x));
  if (uNS.y > 0.0) { float st = mix(6.0, 1.0, uNS.y); objectNormal = normalize(mix(objectNormal, normalize(floor(objectNormal * st + 0.5) + vec3(1e-4)), uNS.y)); }
  if (uNS.z > 0.0) { vec3 q = position * uNS.w; objectNormal = normalize(objectNormal + (vec3(vNoise(q), vNoise(q + 7.1), vNoise(q + 13.7)) - 0.5) * 2.0 * uNS.z); }
}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvObjPos = position;\nvUv2 = uv;\nvObjN = normal;\n${vcode}`)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uSteps;\n${NOISE}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  vec3 Vd = normalize(vViewPosition);
  float fres = 1.0 - abs(dot(normalize(normal), Vd));
  float hgt = clamp((vObjPos.y - uBox.x) / max(0.0001, uBox.y - uBox.x), 0.0, 1.0);
  // What you painted with material brushes: roughness, metal, glow, bumps.
  vec4 pr = pTex(uPRough); roughnessFactor = mix(roughnessFactor, pr.r, pr.a);
  vec4 pm = pTex(uPMetal); metalnessFactor = mix(metalnessFactor, pm.r, pm.a);
  vec4 pg = pTex(uPGlow); totalEmissiveRadiance += pg.rgb * pg.a * 4.0;
  vec4 pb = pTex(uPBump); float hb = pb.r * pb.a;
  normal = normalize(normal - vec3(dFdx(hb), dFdy(hb), 0.0) * 12.0);
  ${code}
}`)
      .replace('#include <opaque_fragment>', `{
  vec3 Vd = normalize(vViewPosition);
  float fres = 1.0 - abs(dot(normalize(normal), Vd));
  ${late}
  // light steps: the light falls into flat bands, like a cartoon
  if (uSteps > 1.5) { float sL = max(dot(outgoingLight, vec3(0.299, 0.587, 0.114)), 1e-4); float sq = (floor(min(sL, 0.999) * uSteps) + 0.6) / uSteps; outgoingLight *= max(sq, 0.0) / sL; }
}
#include <opaque_fragment>`)
      // painted glass: only where you painted it
      .replace('#include <transmission_fragment>', THREE.ShaderChunk.transmission_fragment.replace('material.transmission = transmission;', 'vec4 pgl = pTex(uPGlass); material.transmission = transmission * pgl.r * pgl.a;'))
  }
  mat.customProgramCacheKey = () => `rico-layers:${structureOf(layers)}`
  mat.needsUpdate = true
  return mat
}

// A model's own material made into one the layers can work with (keeps its
// color, pictures, roughness and metal).
export function asStandard(m: THREE.Material): THREE.MeshStandardMaterial {
  if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial) return (m as THREE.MeshStandardMaterial).clone()
  const src = m as THREE.MeshPhongMaterial
  const out = new THREE.MeshStandardMaterial({
    color: src.color ?? new THREE.Color(1, 1, 1), map: src.map ?? null, normalMap: src.normalMap ?? null, emissive: src.emissive ?? new THREE.Color(0, 0, 0),
    emissiveMap: src.emissiveMap ?? null, alphaMap: src.alphaMap ?? null, transparent: src.transparent, opacity: src.opacity, side: src.side,
    roughness: src.shininess !== undefined ? Math.max(0.05, 1 - Math.min(1, src.shininess / 100)) : 0.6, metalness: 0,
  })
  out.name = m.name
  return out
}

// Every frame: the numbers and colors (no rebuild needed for those).
export interface LayerTex { paint?: THREE.Texture | null; mask?: THREE.Texture | null; pics?: (THREE.Texture | null)[]; rough?: THREE.Texture | null; metal?: THREE.Texture | null; glow?: THREE.Texture | null; bump?: THREE.Texture | null; glass?: THREE.Texture | null; box?: [number, number, number, number] | null; tri?: boolean; normals?: NormalStyle; center?: [number, number, number]; steps?: number; sizeMul?: number; thickMul?: number }
export function updateLayers(mat: THREE.Material, layers: MatLayer[], t: number, shift: number, box: [number, number], tex: LayerTex, drive = 1, boil = 0) {
  const u = mat.userData.layerUniforms as LayerUniforms | undefined
  if (!u) return
  const on = layers.filter((l) => l.on).slice(0, MAX_LAYERS)
  on.forEach((l, i) => {
    const cs = l.colors.length ? l.colors.slice(0, 4) : ['#ffffff']
    for (let k = 0; k < 4; k++) u.uC.value[i * 4 + k].set(cs[Math.min(k, cs.length - 1)])
    const sm = tex.sizeMul ?? 1, tm = tex.thickMul ?? 1
    u.uP.value[i].set(l.amount, l.scale * sm, l.speed, cs.length)
    if (l.kind === 'newsprint') u.uQ.value[i].set((l.lift ?? 1) * tm, l.crumple ?? 1, (l.scrap ?? 1) * sm, l.paper === 'mono' ? 0 : l.paper === 'dual' ? 1 : 2)
    else u.uQ.value[i].set((l.thick ?? 1) * tm, 1, 1, 0)
  })
  u.uTime.value = t
  u.uShift.value = shift
  u.uBox.value.set(box[0], box[1])
  u.uPaint.value = tex.paint ?? blank
  u.uPaintMask.value = tex.mask ?? blank
  u.uPic0.value = tex.pics?.[0] ?? blank
  u.uPic1.value = tex.pics?.[1] ?? blank
  u.uDrive.value = drive
  u.uBoil.value = boil
  u.uPRough.value = tex.rough ?? blank
  u.uPMetal.value = tex.metal ?? blank
  u.uPGlow.value = tex.glow ?? blank
  u.uPBump.value = tex.bump ?? blank
  u.uPGlass.value = tex.glass ?? blank
  u.uPMode.value = tex.box ? 1 : (tex.paint ? 0 : 1)
  if (tex.box) u.uPBox.value.set(tex.box[0], tex.box[1], tex.box[2], tex.box[3])
  u.uTri.value = tex.tri ? 1 : 0
  const ns = tex.normals
  u.uNS.value.set(ns?.round ?? 0, ns?.facets ?? 0, ns?.noise ?? 0, ns?.noiseSize ?? 3)
  if (tex.center) u.uNC.value.set(...tex.center)
  u.uSteps.value = tex.steps ?? 0
}

// The iridescent material: the chromatic chrome from the website, animated,
// in the object's own colors.
export function filmLayers(o: Obj3D): MatLayer[] {
  const colors = o.colors?.length ? o.colors : CHROME_COLORS
  return [{ ...newLayer('chrome'), id: 'chrome', colors, scale: o.filmScale ?? 1, speed: o.filmSpeed ?? 0.08, amount: 1 }]
}

// Cartoon shading: a few hard steps of light instead of a smooth falloff.
const toonMaps = new Map<number, THREE.DataTexture>()
export function toonGradient(steps: number): THREE.DataTexture {
  const n = Math.max(2, Math.min(8, Math.round(steps)))
  const hit = toonMaps.get(n)
  if (hit) return hit
  const data = new Uint8Array(n * 4)
  for (let i = 0; i < n; i++) { const v = Math.round((i / (n - 1)) * 255); data.set([v, v, v, 255], i * 4) }
  const tex = new THREE.DataTexture(data, n, 1)
  tex.minFilter = tex.magFilter = THREE.NearestFilter
  tex.needsUpdate = true
  toonMaps.set(n, tex)
  return tex
}

// ---- the look as GLSL, for TouchDesigner and other apps that take shader code ----
// One function, ricoLook(), that takes your lit color and the surface, and
// gives back the look: the same layers as here. The colors and numbers are
// written in; uTime is yours to feed (seconds). Paint and picture layers
// are left out (they are in the baked .glb).
export function lookGlsl(name: string, layers: MatLayer[], base: string): string {
  const on = layers.filter((l) => l.on && l.kind !== 'paint' && l.kind !== 'picture').slice(0, MAX_LAYERS)
  const C: string[] = [], P: string[] = [], Q: string[] = []
  for (let i = 0; i < MAX_LAYERS; i++) {
    const l = on[i]
    const cs = l?.colors.length ? l.colors.slice(0, 4) : ['#ffffff']
    for (let k = 0; k < 4; k++) { const c = new THREE.Color(cs[Math.min(k, cs.length - 1)]); C.push(`vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`) }
    P.push(l ? `vec4(${l.amount.toFixed(4)}, ${l.scale.toFixed(4)}, ${l.speed.toFixed(4)}, ${cs.length.toFixed(1)})` : 'vec4(0.0)')
    Q.push(!l ? 'vec4(1.0)' : l.kind === 'newsprint' ? `vec4(${(l.lift ?? 1).toFixed(4)}, ${(l.crumple ?? 1).toFixed(4)}, ${(l.scrap ?? 1).toFixed(4)}, ${l.paper === 'mono' ? '0.0' : l.paper === 'dual' ? '1.0' : '2.0'})` : `vec4(${(l.thick ?? 1).toFixed(4)}, 1.0, 1.0, 0.0)`)
  }
  const helpers = NOISE.split('\n').filter((ln) => !/^\s*(uniform|varying)\b/.test(ln)).join('\n')
  const early = on.map((l, i) => (l.kind === 'newsprint' ? paperEarly(l, i) : LATE_KINDS.includes(l.kind) ? '' : layerCode(l, i, 0))).join('\n  ')
  const late = on.map((l, i) => (LATE_KINDS.includes(l.kind) ? lateCode(l, i) : '')).join('\n  ')
  const bc = new THREE.Color(base)
  return (`// RICO look: ${name}
// Made by RICO. Paste into a pixel (fragment) shader, for example a GLSL MAT
// in TouchDesigner, and call ricoLook() after your lighting:
//   vec3 col = ricoLook(litColor, normalViewSpace, viewDir, objectPos, objectNormal, uTime);
// litColor: the color with light on it. normalViewSpace: the normal seen from
// the camera. viewDir: from the surface to the camera (view space).
// objectPos and objectNormal: in the object's own space. uTime: seconds.
// For Blender, Unreal, Unity and Cinema 4D, use Export > The look (.glb):
// the look is baked into pictures there, ready to use.

const vec3 uC[${MAX_LAYERS * 4}] = vec3[${MAX_LAYERS * 4}](${C.join(', ')});
const vec4 uP[${MAX_LAYERS}] = vec4[${MAX_LAYERS}](${P.join(', ')});
const vec4 uQ[${MAX_LAYERS}] = vec4[${MAX_LAYERS}](${Q.join(', ')});
const float uShift = 0.0;
const float uDrive = 1.0;
const float uBoil = 0.0;
const vec2 uBox = vec2(-1.0, 1.0);
float uTime;
vec3 vObjPos;
vec3 vObjN;
vec2 vUv2;
uniform sampler2D uPaint;
uniform sampler2D uPaintMask;
uniform sampler2D uPic0;
uniform sampler2D uPic1;
uniform sampler2D uPRough;
uniform sampler2D uPMetal;
uniform sampler2D uPGlow;
uniform sampler2D uPBump;
uniform sampler2D uPGlass;
const vec4 uPBox = vec4(0.0, 0.0, 0.0, 1.0);
const float uPMode = 1.0;
const float uTri = 0.0;
const mat4 viewMatrix = mat4(1.0);
${helpers}

vec3 ricoLook(vec3 lit, vec3 normalViewSpace, vec3 viewDir, vec3 objectPos, vec3 objectNormal, float timeSeconds) {
  uTime = timeSeconds;
  vObjPos = objectPos;
  vObjN = objectNormal;
  vec3 normal = normalize(normalViewSpace);
  vec4 diffuseColor = vec4(${bc.r.toFixed(4)}, ${bc.g.toFixed(4)}, ${bc.b.toFixed(4)}, 1.0);
  vec3 totalEmissiveRadiance = vec3(0.0);
  float roughnessFactor = 0.5, metalnessFactor = 0.0;
  vec3 Vd = normalize(viewDir);
  float fres = 1.0 - abs(dot(normal, Vd));
  float hgt = clamp(objectPos.y * 0.5 + 0.5, 0.0, 1.0);
  ${early}
  vec3 outgoingLight = lit * diffuseColor.rgb + totalEmissiveRadiance;
  ${late}
  return outgoingLight;
}
`).replace(/texture2D\(/g, 'texture(')
}
