import * as THREE from 'three'
import type { FogVol } from './world'

// Fog volumes: a box or a ball of air you place in the scene. Light shows up
// in it: the sun scatters through it, and point and spot lights glow inside.
// It is ray marched (stepped through) on the graphics card, and it stops at
// whatever is behind or inside it, so objects in the fog fade into it.

const VERT = `
varying vec3 vWorld;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`

const FRAG = `
#include <packing>
uniform sampler2D uDepth;
uniform float uHasDepth;
uniform vec2 uRes;
uniform float uNear;
uniform float uFar;
uniform vec3 uCamFwd;
uniform mat4 uInvModel;
uniform vec3 uColor;
uniform float uDensity, uNoise, uScale, uSpeed, uSoft, uHeight, uGlow, uLights, uTime, uBall;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uLPos[4];
uniform vec3 uLCol[4];
uniform int uLN;
varying vec3 vWorld;
float fHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float fNoise(vec3 x) { vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(fHash(i), fHash(i + vec3(1,0,0)), f.x), mix(fHash(i + vec3(0,1,0)), fHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(fHash(i + vec3(0,0,1)), fHash(i + vec3(1,0,1)), f.x), mix(fHash(i + vec3(0,1,1)), fHash(i + vec3(1,1,1)), f.x), f.y), f.z); }
float fFbm(vec3 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * fNoise(p); p *= 2.02; a *= 0.5; } return v; }
float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / (12.566 * pow(max(1e-3, 1.0 + g2 - 2.0 * g * c), 1.5)); }
void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vWorld - ro);
  vec3 oro = (uInvModel * vec4(ro, 1.0)).xyz;
  vec3 ord = (uInvModel * vec4(rd, 0.0)).xyz;
  vec3 inv = 1.0 / ord;
  vec3 t0 = (-0.5 - oro) * inv, t1 = (0.5 - oro) * inv;
  vec3 tmin = min(t0, t1), tmax = max(t0, t1);
  float tn = max(max(max(tmin.x, tmin.y), tmin.z), 0.0);
  float tf = min(min(tmax.x, tmax.y), tmax.z);
  if (uHasDepth > 0.5) {
    float d = texture2D(uDepth, gl_FragCoord.xy / uRes).x;
    if (d < 1.0) {
      float viewZ = perspectiveDepthToViewZ(d, uNear, uFar);
      tf = min(tf, -viewZ / max(1e-4, dot(rd, uCamFwd)));
    }
  }
  if (tf <= tn) discard;
  const int STEPS = 40;
  float dt = (tf - tn) / float(STEPS);
  float j = fHash(vec3(gl_FragCoord.xy, fract(uTime)));
  float T = 1.0;
  vec3 acc = vec3(0.0);
  float sunPh = hg(dot(rd, uSunDir), uGlow);
  for (int i = 0; i < STEPS; i++) {
    float t = tn + (float(i) + j) * dt;
    vec3 p = oro + ord * t;
    vec3 e = 0.5 - abs(p);
    float edge = uBall > 0.5 ? smoothstep(0.0, uSoft, 0.5 - length(p)) : smoothstep(0.0, uSoft * 0.5, min(min(e.x, e.y), e.z));
    float hf = exp(-uHeight * (p.y + 0.5) * 3.0);
    float n = mix(1.0, smoothstep(0.2, 0.8, fFbm(p * uScale * 4.0 + vec3(uTime * uSpeed, uTime * uSpeed * 0.3, 0.0))) * 1.6, uNoise);
    float dens = uDensity * edge * hf * n;
    if (dens <= 0.0) continue;
    float a = 1.0 - exp(-dens * dt);
    vec3 wp = ro + rd * t;
    vec3 light = uColor * 0.25 + uSunColor * sunPh * 3.0;
    for (int k = 0; k < 4; k++) {
      if (k >= uLN) break;
      vec3 dl = uLPos[k] - wp;
      float dd = dot(dl, dl);
      light += uLCol[k] * hg(dot(rd, normalize(dl)), uGlow) * uLights * 4.0 / (1.0 + dd);
    }
    acc += T * a * light * uColor;
    T *= 1.0 - a;
    if (T < 0.01) break;
  }
  gl_FragColor = vec4(acc, 1.0 - T);
}`

export function fogMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: {
      uDepth: { value: null }, uHasDepth: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uNear: { value: 0.05 }, uFar: { value: 500 },
      uCamFwd: { value: new THREE.Vector3(0, 0, -1) }, uInvModel: { value: new THREE.Matrix4() }, uColor: { value: new THREE.Color() },
      uDensity: { value: 1 }, uNoise: { value: 0.5 }, uScale: { value: 1 }, uSpeed: { value: 0.1 }, uSoft: { value: 0.2 }, uHeight: { value: 0.5 },
      uGlow: { value: 0.4 }, uLights: { value: 1 }, uTime: { value: 0 }, uBall: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color(0, 0, 0) },
      uLPos: { value: [0, 1, 2, 3].map(() => new THREE.Vector3()) }, uLCol: { value: [0, 1, 2, 3].map(() => new THREE.Color()) }, uLN: { value: 0 },
    },
    side: THREE.BackSide, transparent: true, depthWrite: false, depthTest: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  })
}

export interface FogFrame { depth: THREE.Texture | null; res: THREE.Vector2; camera: THREE.PerspectiveCamera; sunDir: THREE.Vector3; sunColor: THREE.Color; lights: { pos: THREE.Vector3; color: THREE.Color }[]; t: number }

export function updateFog(mesh: THREE.Mesh, f: FogVol, color: string, density: number, fr: FogFrame) {
  const u = (mesh.material as THREE.ShaderMaterial).uniforms
  mesh.updateMatrixWorld()
  ;(u.uInvModel.value as THREE.Matrix4).copy(mesh.matrixWorld).invert()
  u.uDepth.value = fr.depth
  u.uHasDepth.value = fr.depth ? 1 : 0
  ;(u.uRes.value as THREE.Vector2).copy(fr.res)
  u.uNear.value = fr.camera.near
  u.uFar.value = fr.camera.far
  fr.camera.getWorldDirection(u.uCamFwd.value as THREE.Vector3)
  ;(u.uColor.value as THREE.Color).set(color)
  u.uDensity.value = density
  u.uNoise.value = f.noise
  u.uScale.value = f.scale
  u.uSpeed.value = f.speed
  u.uSoft.value = Math.max(0.01, f.soft)
  u.uHeight.value = f.height
  u.uGlow.value = Math.max(-0.9, Math.min(0.95, f.glow))
  u.uLights.value = f.lights
  u.uTime.value = fr.t
  u.uBall.value = f.shape === 'ball' ? 1 : 0
  ;(u.uSunDir.value as THREE.Vector3).copy(fr.sunDir)
  ;(u.uSunColor.value as THREE.Color).copy(fr.sunColor)
  const n = Math.min(4, fr.lights.length)
  for (let i = 0; i < n; i++) { (u.uLPos.value as THREE.Vector3[])[i].copy(fr.lights[i].pos); (u.uLCol.value as THREE.Color[])[i].copy(fr.lights[i].color) }
  u.uLN.value = n
}
