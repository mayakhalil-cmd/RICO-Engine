import { usePicture } from '../engine/shared'
import { BLEND_MODES, LAYER_HEADER, MASTER_PARAMS, NULL_TYPES, layerType, type ParamDef } from './layers'
import { maskPointsAt, type Binding, type Effect, type Layer, type Scene } from './scene'
import { EFFECT_HEADER, effectType } from './effects'
import { bakeCurves, getLut, lutBytes, lutVersion } from './luts'
import { readSignal } from '../engine/signals'
import { valueAt } from './keys'

// The 3D playground registers its canvas here so a "3D scene" layer can use it.
let scene3d: ((t?: number | null) => HTMLCanvasElement | null) | null = null
export function setScene3dSource(fn: ((t?: number | null) => HTMLCanvasElement | null) | null) {
  scene3d = fn
}
const scene3dCanvas = (t: number | null = null) => scene3d?.(t) ?? null
export const scene3dPicture = () => scene3dCanvas()
let loading3d = false

// Draws a Create scene with WebGL2.
//
// Each layer renders into its own texture, gets blended onto the stack, and
// the finishing pass (trails, color split, lines) runs last. The result is
// shown on screen and, when an output is on, read back without stalling the
// GPU and handed to RICO as raw pixels.

const VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() { v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`

const BLEND = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_base;
uniform sampler2D u_layer;
uniform float u_opacity;
uniform int u_mode;
void main() {
  vec3 b = texture(u_base, v_uv).rgb;
  vec4 l = texture(u_layer, v_uv);
  vec3 c = l.rgb;
  vec3 r;
  if (u_mode == 1) r = b + c * l.a;
  else if (u_mode == 2) r = 1.0 - (1.0 - b) * (1.0 - c * l.a);
  else if (u_mode == 3) r = mix(b, b * c, l.a);
  else if (u_mode == 4) r = mix(b, abs(b - c), l.a);
  else {
    vec3 x;
    if (u_mode == 5) x = mix(2.0 * b * c, 1.0 - 2.0 * (1.0 - b) * (1.0 - c), step(0.5, b));
    else if (u_mode == 6) x = mix(b - (1.0 - 2.0 * c) * b * (1.0 - b), b + (2.0 * c - 1.0) * (sqrt(b) - b), step(0.5, c));
    else if (u_mode == 7) x = mix(2.0 * b * c, 1.0 - 2.0 * (1.0 - b) * (1.0 - c), step(0.5, c));
    else if (u_mode == 8) x = max(b, c);
    else if (u_mode == 9) x = min(b, c);
    else if (u_mode == 10) x = max(b - c, 0.0);
    else if (u_mode == 11) x = min(b / max(1.0 - c, 0.001), 1.0);
    else if (u_mode == 12) x = 1.0 - min((1.0 - b) / max(c, 0.001), 1.0);
    else if (u_mode == 13) x = b + c - 2.0 * b * c;
    else if (u_mode == 14 || u_mode == 15) {
      float lb = dot(b, vec3(0.299, 0.587, 0.114)), lc = dot(c, vec3(0.299, 0.587, 0.114));
      x = u_mode == 14 ? clamp(c - lc + lb, 0.0, 1.0) : clamp(b - lb + lc, 0.0, 1.0);
    }
    else x = c;
    r = mix(b, x, l.a);
  }
  // the alpha builds up too, so a precomp is see-through where nothing is drawn
  float ba = texture(u_base, v_uv).a;
  o = vec4(mix(b, r, u_opacity), ba + l.a * u_opacity * (1.0 - ba));
}`

const MASTER = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_src;
uniform sampler2D u_prev;
uniform float u_n[6];
uniform vec2 u_res;
uniform float u_time;
uniform float u_keepAlpha;
vec3 hue(vec3 c, float h) {
  const vec3 k = vec3(0.57735);
  float a = h * 6.2831853;
  return c * cos(a) + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cos(a));
}
void main() {
  vec2 d = (v_uv - 0.5) * u_n[1] * 0.012;
  vec3 c = vec3(texture(u_src, v_uv + d).r, texture(u_src, v_uv).g, texture(u_src, v_uv - d).b);
  vec2 fz = (v_uv - 0.5) / u_n[5] + 0.5;
  vec3 prev = texture(u_prev, fz).rgb;
  c = max(c, prev * u_n[0]);
  c = hue(c, u_n[3]) * u_n[4];
  float line = 0.5 + 0.5 * sin(v_uv.y * u_res.y * 3.14159);
  c *= 1.0 - u_n[2] * 0.45 * line;
  float a = texture(u_src, v_uv).a;
  o = u_keepAlpha > 0.5 ? vec4(clamp(c / max(a, 0.0001), 0.0, 1.0), a) : vec4(clamp(c, 0.0, 1.0), 1.0);
}`

// Puts a layer in place: its transform (and parents), its masks, and the
// track matte from the layer above.
const PLACE = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_src;
uniform sampler2D u_matte;
uniform int u_matteMode;
uniform mat3 u_inv;
uniform int u_adjust;
uniform vec2 u_res;
uniform int u_maskCount;
uniform vec4 u_mRect[4];
uniform vec4 u_mOpt[4];
uniform vec2 u_mOpt2[4];
uniform vec2 u_pts[64];
uniform int u_ptStart[4];
uniform int u_ptCount[4];
float sdPoly(vec2 p, int s, int n) {
  float d = dot(p - u_pts[s], p - u_pts[s]); float sg = 1.0; int j = s + n - 1;
  for (int k = 0; k < 64; k++) {
    if (k >= n) break;
    int i = s + k;
    vec2 e = u_pts[j] - u_pts[i]; vec2 w = p - u_pts[i];
    vec2 b = w - e * clamp(dot(w, e) / max(dot(e, e), 1e-9), 0.0, 1.0);
    d = min(d, dot(b, b));
    bvec3 c = bvec3(p.y >= u_pts[i].y, p.y < u_pts[j].y, e.x * w.y > e.y * w.x);
    if (all(c) || all(not(c))) sg *= -1.0;
    j = i;
  }
  return sg * sqrt(d);
}
void main() {
  float ar = u_res.x / u_res.y;
  vec2 p = (v_uv - 0.5) * vec2(ar, 1.0);
  vec2 pl = (u_inv * vec3(p, 1.0)).xy;
  vec4 c;
  if (u_adjust == 1) c = texture(u_src, v_uv);
  else {
    vec2 t = pl / vec2(ar, 1.0) + 0.5;
    c = (t.x < 0.0 || t.x > 1.0 || t.y < 0.0 || t.y > 1.0) ? vec4(0.0) : texture(u_src, t);
  }
  float aa = 1.0 / u_res.y;
  if (u_maskCount > 0) {
    float m = u_mOpt[0].y > 0.5 ? 1.0 : 0.0;
    for (int i = 0; i < 4; i++) {
      if (i >= u_maskCount) break;
      vec4 r = u_mRect[i]; vec4 op = u_mOpt[i];
      vec2 q = pl - r.xy; float d;
      int kind = int(op.x + 0.5);
      if (kind == 0) { vec2 b = abs(q) - r.zw * 0.5; d = length(max(b, 0.0)) + min(max(b.x, b.y), 0.0); }
      else if (kind == 1) { vec2 hr = max(r.zw * 0.5, vec2(1e-4)); d = (length(q / hr) - 1.0) * min(hr.x, hr.y); }
      else d = u_ptCount[i] >= 3 ? sdPoly(pl, u_ptStart[i], u_ptCount[i]) : 1.0;
      float f = max(op.z, aa);
      float cov = 1.0 - smoothstep(-f, f, d - op.w);
      if (u_mOpt2[i].y > 0.5) cov = 1.0 - cov;
      cov *= u_mOpt2[i].x;
      int mode = int(op.y + 0.5);
      if (mode == 0) m = max(m, cov);
      else if (mode == 1) m = m * (1.0 - cov);
      else m = min(m, cov);
    }
    c.a *= m;
  }
  if (u_matteMode > 0) {
    vec4 mt = texture(u_matte, v_uv);
    float k = u_matteMode <= 2 ? mt.a : dot(mt.rgb, vec3(0.2126, 0.7152, 0.0722)) * mt.a;
    if (u_matteMode == 2 || u_matteMode == 4) k = 1.0 - k;
    c.a *= k;
  }
  o = c;
}`

const COPY = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_src;
uniform float u_flip;
void main() { o = texture(u_src, vec2(v_uv.x, mix(v_uv.y, 1.0 - v_uv.y, u_flip))); }`

interface Target { fb: WebGLFramebuffer; tex: WebGLTexture }

interface Source {
  tex: WebGLTexture
  w: number
  h: number
  key: string           // what was uploaded last (text + font, image url)
  video?: HTMLVideoElement
  stream?: MediaStream
}

export interface OutputFrame { pixels: Uint8Array; width: number; height: number }

// How heavy each part of a frame is, for the performance readout.
export interface RenderStats {
  measured: boolean                     // GPU timer available, so ms are real
  layers: { id: string; name: string; ms: number; share: number }[]
  finishMs: number
  readMs: number                        // reading the frame back to send it as video
  width: number
  height: number
  textureBytes: number
}

// Rough relative cost of each layer type per million pixels, used when the
// graphics driver does not offer timing.
const COST: Record<string, number> = {
  chroma: 9, blobs: 6, noise: 4, grid: 2, tunnel: 2, pulse: 1.5, shape: 1, bars: 1, text: 1,
  image: 1, camera: 1.5, video: 1.5, scene3d: 3, solid: 0.3, gradient: 0.5,
}

// A setting can be driven from outside the scene, by the timeline or a node
// network. Those values win over the layer's own value and its link.
export const driven = new Map<string, number>()

// Precomps: how a composition is found by its id (the store sets this).
let findComp: (id: string) => Scene | undefined = () => undefined
export function setCompFinder(f: (id: string) => Scene | undefined) { findComp = f }

export class Renderer {
  readonly gl: WebGL2RenderingContext
  private programs = new Map<string, WebGLProgram>()
  private uniforms = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>()
  private width = 0
  private height = 0
  private layerTarget!: Target
  private fx: Target[] = []
  private placed!: Target
  private matteT!: Target
  private aux = new Map<string, { tex: WebGLTexture; key: string; size: number }>()
  private capture: { owner: string; effect: string; done: (px: Uint8Array, w: number, h: number) => void } | null = null
  private stack: Target[] = []
  private master: Target[] = []
  private masterIndex = 0
  private out!: Target
  private sources = new Map<string, Source>()
  private smooth = new Map<string, number>()
  private pbos: WebGLBuffer[] = []
  private fences: (WebGLSync | null)[] = [null, null]
  private issued = [0, 0]
  private serial = 0
  private readBuffer: Uint8Array | null = null
  private t0 = performance.now()
  failed: string | null = null
  timeOverride: number | null = null      // the timeline sets this while it plays or renders
  private timer: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null = null
  private queries: { id: string; name: string; q: WebGLQuery }[] = []
  private measureEvery = 0
  private gpuMs = new Map<string, number>()
  private readMs = 0
  stats: RenderStats = { measured: false, layers: [], finishMs: 0, readMs: 0, width: 0, height: 0, textureBytes: 0 }

  private children = new Map<string, Renderer>()   // precomps, each drawn by its own renderer
  depth = 0
  get view(): HTMLCanvasElement { return this.canvas }

  // transparent: a precomp, see-through where nothing is drawn
  constructor(private canvas: HTMLCanvasElement, private transparent = false) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: transparent, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' })
    if (!gl) throw new Error('This computer does not support WebGL2, which Motion needs.')
    this.gl = gl
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    this.pbos = [gl.createBuffer()!, gl.createBuffer()!]
    this.timer = gl.getExtension('EXT_disjoint_timer_query_webgl2') as typeof this.timer
  }

  // timing

  private begin(id: string, name: string, measuring: boolean) {
    if (!measuring || !this.timer) return null
    const q = this.gl.createQuery()
    if (!q) return null
    this.gl.beginQuery(this.timer.TIME_ELAPSED_EXT, q)
    this.queries.push({ id, name, q })
    return q
  }

  private end(q: WebGLQuery | null) {
    if (q && this.timer) this.gl.endQuery(this.timer.TIME_ELAPSED_EXT)
  }

  private collect() {
    const gl = this.gl
    if (!this.timer || !this.queries.length) return
    const last = this.queries[this.queries.length - 1].q
    if (!gl.getQueryParameter(last, gl.QUERY_RESULT_AVAILABLE)) return
    const disjoint = gl.getParameter(this.timer.GPU_DISJOINT_EXT)
    for (const { id, q } of this.queries) {
      if (!disjoint) {
        const ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6
        this.gpuMs.set(id, (this.gpuMs.get(id) ?? ms) * 0.6 + ms * 0.4)
      }
      gl.deleteQuery(q)
    }
    this.queries = []
  }

  private updateStats(scene: Scene) {
    const mp = (this.width * this.height) / 1e6
    const visible = scene.layers.filter((l) => l.visible)
    const measured = Boolean(this.timer) && this.gpuMs.size > 0
    const ms = (id: string, type: string) => (measured ? this.gpuMs.get(id) ?? 0 : (COST[type] ?? 1) * mp)
    const layers = visible.map((l) => ({ id: l.id, name: l.name, ms: ms(l.id, l.type) + (measured ? this.gpuMs.get(`${l.id}:blend`) ?? 0 : 0.3 * mp), share: 0 }))
    const finishMs = measured ? this.gpuMs.get('finish') ?? 0 : 1.5 * mp
    const total = layers.reduce((a, l) => a + l.ms, 0) + finishMs || 1
    layers.forEach((l) => { l.share = l.ms / total })
    layers.sort((a, b) => b.ms - a.ms)
    const targets = 7 + this.sources.size
    this.stats = { measured, layers, finishMs, readMs: this.readMs, width: this.width, height: this.height, textureBytes: targets * this.width * this.height * 4 }
  }

  // setup

  private broken = new Map<string, string>()
  private compile(key: string, frag: string): WebGLProgram {
    const cached = this.programs.get(key)
    if (cached) return cached
    // Code that did not compile is not tried again every frame.
    const bad = this.broken.get(key)
    if (bad) throw new Error(bad)
    try {
      return this.compileNow(key, frag)
    } catch (e) {
      this.broken.set(key, (e as Error).message)
      throw e
    }
  }
  private compileNow(key: string, frag: string): WebGLProgram {
    const gl = this.gl
    const make = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`${key}: ${gl.getShaderInfoLog(s)}`)
      return s
    }
    const p = gl.createProgram()!
    gl.attachShader(p, make(gl.VERTEX_SHADER, VERT))
    gl.attachShader(p, make(gl.FRAGMENT_SHADER, frag))
    gl.bindAttribLocation(p, 0, 'a_pos')
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`${key}: ${gl.getProgramInfoLog(p)}`)
    this.programs.set(key, p)
    this.uniforms.set(p, new Map())
    return p
  }

  private loc(p: WebGLProgram, name: string) {
    const m = this.uniforms.get(p)!
    if (!m.has(name)) m.set(name, this.gl.getUniformLocation(p, name))
    return m.get(name)!
  }

  private target(w: number, h: number): Target {
    const gl = this.gl
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const fb = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    return { fb, tex }
  }

  private free(t?: Target) {
    if (!t) return
    this.gl.deleteFramebuffer(t.fb)
    this.gl.deleteTexture(t.tex)
  }

  private resize(w: number, h: number) {
    if (w === this.width && h === this.height) return
    this.width = w
    this.height = h
    this.canvas.width = w
    this.canvas.height = h
    ;[this.layerTarget, ...this.stack, ...this.master, this.out, ...this.fx, this.placed, this.matteT].forEach((t) => this.free(t))
    this.layerTarget = this.target(w, h)
    this.fx = [this.target(w, h), this.target(w, h), this.target(w, h)]
    this.placed = this.target(w, h)
    this.matteT = this.target(w, h)
    this.stack = [this.target(w, h), this.target(w, h)]
    this.master = [this.target(w, h), this.target(w, h)]
    this.out = this.target(w, h)
    const gl = this.gl
    for (const pbo of this.pbos) {
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo)
      gl.bufferData(gl.PIXEL_PACK_BUFFER, w * h * 4, gl.STREAM_READ)
    }
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
    this.fences.forEach((f) => f && gl.deleteSync(f))
    this.fences = [null, null]
    this.readBuffer = new Uint8Array(w * h * 4)
  }

  // layer sources (text, images, camera)

  private source(layer: Layer, time = 0): Source | null {
    const type = layerType(layer.type)
    if (!type.source) return null
    const gl = this.gl
    let s = this.sources.get(layer.id)
    if (!s) {
      const tex = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4))
      s = { tex, w: 1, h: 1, key: '' }
      this.sources.set(layer.id, s)
    }

    if (type.source === 'text') {
      const text = String(layer.values.text ?? '')
      const v = (k: string, d: number) => this.value(layer.id, k, Number(layer.values[k] ?? d), layer.bindings[k])
      const fontIdx = Math.round(Number(layer.values.font ?? 0))
      const title = getComputedStyle(document.documentElement).getPropertyValue('--font-title')
      const mono = getComputedStyle(document.documentElement).getPropertyValue('--font')
      const fam = layer.fontFamily || ([title, mono, 'Inter, "Segoe UI", Arial, sans-serif', 'Inter, "Segoe UI", Arial, sans-serif', 'Georgia, "Times New Roman", serif', 'Georgia, "Times New Roman", serif'][fontIdx] ?? title)
      const style = layer.fontFamily ? '' : fontIdx === 3 ? '800 ' : fontIdx === 5 ? 'italic ' : ''
      const tracking = v('tracking', 0), reveal = v('reveal', 1), wave = v('wave', 0), waveSpeed = v('waveSpeed', 3)
      const outline = Number(layer.values.outline ?? 0) > 0.5
      const t = wave > 0 ? Math.floor(time * 30) / 30 : 0
      const key = `${text}|${fam}|${style}|${document.fonts.status}|${tracking.toFixed(3)}|${reveal.toFixed(3)}|${wave.toFixed(3)}|${waveSpeed}|${t}|${outline}`
      if (key !== s.key) {
        s.key = key
        const c = document.createElement('canvas')
        const ctx = c.getContext('2d')!
        const px = 160
        const font = `${style}${px}px ${fam}`
        ctx.font = font
        const chars = [...text]
        const widths = chars.map((ch) => ctx.measureText(ch).width)
        const adv = px * tracking
        const w = Math.max(8, Math.ceil(widths.reduce((a, b) => a + b, 0) + adv * Math.max(0, chars.length - 1) + px * 0.2))
        const pad = wave > 0 ? px * 0.35 : 0
        c.width = w
        c.height = Math.ceil(px * 1.25 + pad * 2)
        ctx.font = font
        ctx.textBaseline = 'middle'
        ctx.fillStyle = '#fff'
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = px * 0.04
        let x = px * 0.1
        const shown = reveal * chars.length
        chars.forEach((ch, i) => {
          const a = Math.max(0, Math.min(1, shown - i))
          if (a > 0) {
            ctx.globalAlpha = a
            const y = c.height / 2 + (wave > 0 ? Math.sin(t * waveSpeed + i * 0.6) * wave * px * 0.3 : 0)
            if (outline) ctx.strokeText(ch, x, y)
            else ctx.fillText(ch, x, y)
          }
          x += widths[i] + adv
        })
        ctx.globalAlpha = 1
        this.upload(s, c, c.width, c.height)
      }
    } else if (type.source === 'image') {
      const url = layer.image ?? ''
      if (url !== s.key) {
        s.key = url
        if (url) {
          const img = new Image()
          img.onload = () => this.upload(s!, img, img.naturalWidth, img.naturalHeight)
          img.src = url
        }
      }
    } else if (type.source === 'video') {
      const url = layer.video ?? ''
      if (url !== s.key) {
        s.key = url
        s.video?.pause()
        s.video = undefined
        if (url) {
          const v = document.createElement('video')
          v.muted = true
          v.loop = true
          v.playsInline = true
          v.src = url
          v.play().catch(() => undefined)
          s.video = v
        }
      }
      const v = s.video
      if (v) {
        v.playbackRate = Math.max(0.0625, Number(layer.values.speed ?? 1)) || 1
        // On the timeline the clip follows the playhead.
        if (this.timeOverride !== null && v.duration) {
          const want = ((this.timeOverride - (layer.start ?? 0)) * v.playbackRate) % v.duration
          if (Math.abs(v.currentTime - want) > 0.25) v.currentTime = Math.max(0, want)
        }
        if (v.readyState >= 2 && v.videoWidth) this.upload(s, v, v.videoWidth, v.videoHeight)
      }
    } else if (type.source === 'scene3d') {
      if (!scene3d && !loading3d) {
        loading3d = true
        import('../three/engine').catch(() => { loading3d = false })
      }
      // a precomp has its own time: it starts with the layer, at its own speed
      const own = Number(layer.values.time ?? 0) > 0.5
      const lt = own ? Math.max(0, (time - (layer.start ?? 0)) * Number(layer.values.speed ?? 1) + Number(layer.values.offset ?? 0)) : null
      const c = scene3dCanvas(lt)
      if (c && c.width > 0) this.upload(s, c, c.width, c.height)
    } else if (type.source === 'precomp') {
      // another composition, drawn at its own time (it starts with the layer)
      const comp = findComp(String(layer.values.comp ?? ''))
      if (comp && this.depth < 4) {
        let ch = this.children.get(layer.id)
        if (!ch) {
          try { ch = new Renderer(document.createElement('canvas'), true); ch.depth = this.depth + 1; this.children.set(layer.id, ch) } catch { ch = undefined }
        }
        if (ch) {
          const tl = comp.timeline
          const dur = Math.max(0.01, tl?.duration ?? 10)
          let lt = Math.max(0, (time - (layer.start ?? 0)) * Number(layer.values.speed ?? 1) + Number(layer.values.offset ?? 0))
          lt = tl?.loop === false ? Math.min(lt, dur) : lt % dur
          for (const tr of tl?.tracks ?? []) { const v = valueAt(tr, lt); if (v !== undefined) driven.set(tr.target, v) }
          ch.timeOverride = lt
          ch.render(comp)
          this.upload(s, ch.view, ch.view.width, ch.view.height)
        }
      }
    } else if (type.source === 'picture') {
      const pic = usePicture(String(layer.values.picture ?? ''))
      if (pic && pic.canvas.width > 2 && s.key !== `${pic.version}`) {
        s.key = `${pic.version}`
        this.upload(s, pic.canvas, pic.canvas.width, pic.canvas.height)
      }
    } else if (type.source === 'camera') {
      if (!s.video && s.key !== 'asked') {
        s.key = 'asked'
        navigator.mediaDevices?.getUserMedia({ video: { width: 1280, height: 720 }, audio: false }).then((stream) => {
          const v = document.createElement('video')
          v.muted = true
          v.playsInline = true
          v.srcObject = stream
          v.play()
          s!.video = v
          s!.stream = stream
        }).catch(() => {
          s!.key = 'denied'
        })
      }
      const v = s.video
      if (v && v.readyState >= 2 && v.videoWidth) this.upload(s, v, v.videoWidth, v.videoHeight)
    }
    return s
  }

  private upload(s: Source, src: TexImageSource, w: number, h: number) {
    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D, s.tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src)
    s.w = w
    s.h = h
  }

  // Puts every video clip at the right frame for time t (used when rendering
  // a file, where each frame must be exact).
  async seekVideos(scene: Scene, t: number) {
    const waits: Promise<void>[] = []
    for (const l of scene.layers) {
      if (l.type !== 'video') continue
      const v = this.sources.get(l.id)?.video
      if (!v || !v.duration) continue
      v.pause()
      const want = ((t - (l.start ?? 0)) * Math.max(0.0625, Number(l.values.speed ?? 1))) % v.duration
      if (Math.abs(v.currentTime - want) < 1 / 120) continue
      waits.push(new Promise((res) => {
        const done = () => { v.removeEventListener('seeked', done); res() }
        v.addEventListener('seeked', done)
        window.setTimeout(done, 500)
        v.currentTime = Math.max(0, want)
      }))
    }
    await Promise.all(waits)
  }

  resumeVideos() {
    for (const s of this.sources.values()) s.video?.play().catch(() => undefined)
  }

  cameraDenied(layerId: string) {
    return this.sources.get(layerId)?.key === 'denied'
  }

  forget(liveIds: Set<string>) {
    for (const [id, ch] of this.children) if (!liveIds.has(id)) { ch.gl.getExtension('WEBGL_lose_context')?.loseContext(); this.children.delete(id) }
    for (const [id, s] of this.sources) {
      if (liveIds.has(id)) continue
      s.stream?.getTracks().forEach((t) => t.stop())
      s.video?.pause()
      this.gl.deleteTexture(s.tex)
      this.sources.delete(id)
    }
  }

  // values

  // The value a setting has right now: its own value, or the signal it is
  // linked to, mapped into the chosen range and smoothed.
  // A linked setting's value from its signal right now, for recording.
  liveValue(owner: string, key: string, base: number, b: Binding | undefined): number {
    if (!b?.signal) return base
    const v = this.smooth.get(`${owner}.${key}`) ?? Math.max(0, Math.min(1, readSignal(b.signal)))
    return b.min + v * (b.max - b.min)
  }

  value(owner: string, key: string, base: number, b: Binding | undefined): number {
    const d = driven.get(`${owner}.${key}`)
    if (d !== undefined) return d
    if (!b || !b.signal) return base
    const raw = Math.max(0, Math.min(1, readSignal(b.signal)))
    const id = `${owner}.${key}`
    const prev = this.smooth.get(id) ?? raw
    const k = Math.max(0, Math.min(0.99, b.smooth))
    const v = prev * k + raw * (1 - k)
    this.smooth.set(id, v)
    return b.min + v * (b.max - b.min)
  }

  private numbers(owner: string, params: ParamDef[], values: Record<string, number | string>, bindings: Record<string, Binding>) {
    const out: number[] = []
    for (const p of params) {
      if (p.kind === 'number' || p.kind === 'choice') out.push(this.value(owner, p.key, Number(values[p.key] ?? p.default), p.kind === 'number' ? bindings[p.key] : undefined))
    }
    while (out.length < 16) out.push(0)
    return out.slice(0, 16)
  }

  // transforms, effects, placing

  private v(layer: Layer, key: string, def: number) {
    return this.value(layer.id, key, Number(layer.values[key] ?? def), layer.bindings[key])
  }

  // For the preview tools: where a layer is right now (row-major 3x3).
  layerMatrix(layer: Layer, scene: Scene): number[] {
    return this.matrixOf(layer, scene)
  }

  // Layer space to scene space, with every parent. Row-major 3x3.
  private matrixOf(layer: Layer, scene: Scene, depth = 0): number[] {
    const ax = this.v(layer, 'tr_ax', 0), ay = this.v(layer, 'tr_ay', 0)
    const px = this.v(layer, 'tr_px', 0), py = this.v(layer, 'tr_py', 0)
    const sx = this.v(layer, 'tr_sx', 1), sy = this.v(layer, 'tr_sy', 1)
    const r = (this.v(layer, 'tr_rot', 0) * Math.PI) / 180
    // AE rotates clockwise for positive angles; y is up here, so negate.
    const c = Math.cos(-r), s = Math.sin(-r)
    const local = [
      c * sx, -s * sy, px - (c * sx * ax - s * sy * ay),
      s * sx, c * sy, py - (s * sx * ax + c * sy * ay),
      0, 0, 1,
    ]
    const parent = layer.parent ? scene.layers.find((l) => l.id === layer.parent) : undefined
    if (!parent || depth > 12) return local
    return mul3(this.matrixOf(parent, scene, depth + 1), local)
  }

  private auxTexture(key: string, kind: 'lut' | 'curve', value: string): { tex: WebGLTexture; size: number } | null {
    const gl = this.gl
    let a = this.aux.get(key)
    const want = kind === 'lut' ? `${value}#${lutVersion()}` : value
    if (a && a.key === want) return a
    if (!a) {
      const tex = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      a = { tex, key: '', size: 0 }
      this.aux.set(key, a)
    }
    a.key = want
    gl.bindTexture(gl.TEXTURE_2D, a.tex)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    if (kind === 'curve') {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, bakeCurves(value))
      a.size = 256
    } else {
      const lut = getLut(value)
      if (!lut) { a.size = 0; gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); return a }
      const n = lut.size
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, n * n, n, 0, gl.RGB, gl.UNSIGNED_BYTE, stripOf(lutBytes(lut), n))
      a.size = n
    }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
    return a
  }

  // Clean plates for the background remover: the empty scene, kept on the
  // graphics card (not saved; capture again after restarting).
  private plates = new Map<string, Target>()
  private plateWanted: string | null = null
  requestPlate(owner: string, effect: string) { this.plateWanted = `${owner}:${effect}` }
  clearPlate(owner: string, effect: string) { const k = `${owner}:${effect}`; this.free(this.plates.get(k)); this.plates.delete(k) }
  hasPlate(owner: string, effect: string) { return this.plates.has(`${owner}:${effect}`) }
  private keepPlate(key: string, tex: WebGLTexture) {
    const gl = this.gl
    this.free(this.plates.get(key))
    const t = this.target(this.width, this.height)
    const copy = this.compile('copy', COPY)
    gl.useProgram(copy)
    this.bindTex(0, tex)
    gl.uniform1i(this.loc(copy, 'u_src'), 0)
    gl.uniform1f(this.loc(copy, 'u_flip'), 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb)
    gl.viewport(0, 0, this.width, this.height)
    this.draw(t.fb)
    this.plates.set(key, t)
  }

  // Asks for the picture an effect starts from, once (for matching a look).
  requestCapture(owner: string, effect: string, done: (px: Uint8Array, w: number, h: number) => void) {
    this.capture = { owner, effect, done }
  }

  private grabTexture(tex: WebGLTexture): { px: Uint8Array; w: number; h: number } {
    const gl = this.gl
    const w = 256, h = Math.max(16, Math.round((256 * this.height) / Math.max(1, this.width)))
    const t = this.target(w, h)
    const copy = this.compile('copy', COPY)
    gl.useProgram(copy)
    this.bindTex(0, tex)
    gl.uniform1i(this.loc(copy, 'u_src'), 0)
    gl.uniform1f(this.loc(copy, 'u_flip'), 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb)
    gl.viewport(0, 0, w, h)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    const px = new Uint8Array(w * h * 4)
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px)
    this.free(t)
    return { px, w, h }
  }

  // Runs an effect stack. Returns the texture with the result.
  private runEffects(effects: Effect[] | undefined, input: WebGLTexture, owner: string, ownerValues: (key: string, def: number, b?: Binding) => number, time: number): WebGLTexture {
    const gl = this.gl
    let cur = input
    for (const e of effects ?? []) {
      if (!e.on) continue
      const type = effectType(e.type)
      if (!type) continue
      if (this.capture && this.capture.owner === owner && this.capture.effect === e.id) {
        const g = this.grabTexture(cur)
        this.capture.done(g.px, g.w, g.h)
        this.capture = null
      }
      let prog: WebGLProgram
      try {
        prog = this.compile(`fx:${type.id}`, `${EFFECT_HEADER}\nvec4 fx(vec2 uv) {${type.glsl}\n}\nvoid main() { o = fx(v_uv); }`)
      } catch (err) {
        this.failed = String(err)
        continue
      }
      const nums: number[] = []
      for (const p of type.params) if (p.kind === 'number' || p.kind === 'choice') nums.push(ownerValues(`fx_${e.id}_${p.key}`, Number(e.values[p.key] ?? p.default), p.kind === 'number' ? e.bindings?.[p.key] : undefined))
      while (nums.length < 16) nums.push(0)
      const colors = type.params.filter((p) => p.kind === 'color').map((p) => hexToRgb(String(e.values[p.key] ?? p.default)))
      while (colors.length < 4) colors.push([0, 0, 0])
      const orig = cur
      let aux: { tex: WebGLTexture; size: number } | null = null
      if (type.aux === 'lut') aux = this.auxTexture(`lut:${owner}:${e.id}`, 'lut', String(e.values.lut ?? ''))
      if (type.aux === 'curve') aux = this.auxTexture(`curve:${owner}:${e.id}`, 'curve', String(e.values.curve ?? ''))
      if (type.aux === 'plate') {
        const key = `${owner}:${e.id}`
        if (this.plateWanted === key) { this.keepPlate(key, cur); this.plateWanted = null }
        const plate = this.plates.get(key)
        aux = plate ? { tex: plate.tex, size: 1 } : null
      }
      for (let pass = 0; pass < (type.passes ?? 1); pass++) {
        const dst = this.fx.find((t) => t.tex !== cur && t.tex !== orig)!
        gl.useProgram(prog)
        this.bindTex(0, cur)
        this.bindTex(1, orig)
        this.bindTex(2, aux?.tex ?? cur)
        gl.uniform1i(this.loc(prog, 'u_src'), 0)
        gl.uniform1i(this.loc(prog, 'u_orig'), 1)
        gl.uniform1i(this.loc(prog, 'u_aux'), 2)
        gl.uniform1f(this.loc(prog, 'u_lutSize'), aux?.size ?? 0)
        gl.uniform1fv(this.loc(prog, 'u_n'), nums.slice(0, 16))
        gl.uniform3fv(this.loc(prog, 'u_c'), colors.slice(0, 4).flat())
        gl.uniform2f(this.loc(prog, 'u_res'), this.width, this.height)
        gl.uniform1f(this.loc(prog, 'u_time'), time)
        gl.uniform1i(this.loc(prog, 'u_pass'), pass)
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb)
        gl.clearColor(0, 0, 0, 0)
        gl.clear(gl.COLOR_BUFFER_BIT)
        this.draw(dst.fb)
        cur = dst.tex
      }
    }
    return cur
  }

  // Draws one layer (content, effects, masks, transform, matte) into "out".
  private produce(layer: Layer, scene: Scene, time: number, out: Target, measuring: boolean, matte?: { tex: WebGLTexture; mode: number }, stackTex?: WebGLTexture): boolean {
    const gl = this.gl
    const type = layerType(layer.type)
    let content: WebGLTexture
    if (layer.type === 'adjust') {
      if (!stackTex) return false
      content = stackTex
    } else {
      let prog: WebGLProgram
      try {
        // Your own GLSL: the numbers a..h and colors c1..c3 are ready to use.
        const body = layer.type === 'glsl'
          ? `float a = u_n[0], b = u_n[1], c = u_n[2], d = u_n[3], e = u_n[4], f = u_n[5], g = u_n[6], h = u_n[7];\nvec3 c1 = u_c[0], c2 = u_c[1], c3 = u_c[2];\n${String(layer.values.code ?? '')}`
          : type.shader
        prog = this.compile(layer.type === 'glsl' ? `layer:glsl:${body.length}:${hashText(body)}` : `layer:${type.id}`, `${LAYER_HEADER}
vec4 layer(vec2 uv, vec2 p) {${body}
}
void main() { vec2 p = (v_uv - 0.5) * vec2(u_res.x / u_res.y, 1.0); o = layer(v_uv, p); }`)
      } catch (e) {
        this.failed = String(e)
        return false
      }
      gl.useProgram(prog)
      gl.uniform1f(this.loc(prog, 'u_time'), time - (this.timeOverride !== null ? layer.start ?? 0 : 0))
      gl.uniform2f(this.loc(prog, 'u_res'), this.width, this.height)
      gl.uniform1fv(this.loc(prog, 'u_n'), this.numbers(layer.id, type.params, layer.values, layer.bindings))
      const colors = type.params.filter((p) => p.kind === 'color').map((p) => hexToRgb(String(layer.values[p.key] ?? p.default)))
      while (colors.length < 4) colors.push([0, 0, 0])
      gl.uniform3fv(this.loc(prog, 'u_c'), colors.slice(0, 4).flat())
      const src = this.source(layer, time)
      if (src) {
        this.bindTex(0, src.tex)
        gl.uniform1i(this.loc(prog, 'u_tex'), 0)
        gl.uniform2f(this.loc(prog, 'u_texSize'), src.w, src.h)
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.layerTarget.fb)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      const q = this.begin(layer.id, layer.name, measuring)
      this.draw(this.layerTarget.fb)
      this.end(q)
      content = this.layerTarget.tex
    }
    const fxTex = layer.fxOff ? content : this.runEffects(layer.effects, content, layer.id, (k, d, b) => this.value(layer.id, k, Number(layer.values[k] ?? d), b ?? layer.bindings[k]), time)

    // Place it.
    const place = this.compile('place', PLACE)
    gl.useProgram(place)
    this.bindTex(0, fxTex)
    this.bindTex(1, matte?.tex ?? fxTex)
    gl.uniform1i(this.loc(place, 'u_src'), 0)
    gl.uniform1i(this.loc(place, 'u_matte'), 1)
    gl.uniform1i(this.loc(place, 'u_matteMode'), matte?.mode ?? 0)
    gl.uniform1i(this.loc(place, 'u_adjust'), layer.type === 'adjust' ? 1 : 0)
    gl.uniform2f(this.loc(place, 'u_res'), this.width, this.height)
    const inv = invert3(this.matrixOf(layer, scene))
    gl.uniformMatrix3fv(this.loc(place, 'u_inv'), false, [inv[0], inv[3], inv[6], inv[1], inv[4], inv[7], inv[2], inv[5], inv[8]])
    const masks = (layer.masks ?? []).filter((m) => m.on !== false).slice(0, 4)
    const rect: number[] = [], opt: number[] = [], opt2: number[] = [], pts: number[] = [], start: number[] = [], count: number[] = []
    masks.forEach((m, i) => {
      const mv = (k: string, d: number) => this.value(layer.id, `m${i}_${k}`, d, undefined)
      rect.push(mv('x', m.x), mv('y', m.y), mv('w', m.w), mv('h', m.h))
      opt.push(m.kind === 'rect' ? 0 : m.kind === 'ellipse' ? 1 : 2, m.mode, mv('feather', m.feather), mv('expand', m.expand))
      opt2.push(mv('opacity', m.opacity), m.invert ? 1 : 0)
      start.push(pts.length / 2)
      const list = maskPointsAt(m, time).slice(0, Math.max(0, 64 - pts.length / 2))
      for (const [x, y] of list) pts.push(x, y)
      count.push(list.length)
    })
    while (rect.length < 16) rect.push(0)
    while (opt.length < 16) opt.push(0)
    while (opt2.length < 8) opt2.push(0)
    while (pts.length < 128) pts.push(0)
    while (start.length < 4) start.push(0)
    while (count.length < 4) count.push(0)
    gl.uniform1i(this.loc(place, 'u_maskCount'), masks.length)
    gl.uniform4fv(this.loc(place, 'u_mRect'), rect)
    gl.uniform4fv(this.loc(place, 'u_mOpt'), opt)
    gl.uniform2fv(this.loc(place, 'u_mOpt2'), opt2)
    gl.uniform2fv(this.loc(place, 'u_pts'), pts)
    gl.uniform1iv(this.loc(place, 'u_ptStart'), start)
    gl.uniform1iv(this.loc(place, 'u_ptCount'), count)
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fb)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    this.draw(out.fb)
    return true
  }

  private showing(layer: Layer, time: number) {
    if (layer.start !== undefined && layer.end !== undefined && this.timeOverride !== null && (time < layer.start || time >= layer.end)) return false
    return true
  }

  // drawing

  private draw(fb: WebGLFramebuffer | null) {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
    gl.viewport(0, 0, this.width, this.height)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  private bindTex(unit: number, tex: WebGLTexture) {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, tex)
  }

  render(scene: Scene) {
    this.failed = null
    const gl = this.gl
    this.resize(scene.width, scene.height)
    const time = this.timeOverride ?? (performance.now() - this.t0) / 1000
    this.collect()
    const measuring = Boolean(this.timer) && !this.queries.length && ++this.measureEvery % 15 === 0

    // Start the stack with the scene's background (black unless you pick one).
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.stack[0].fb)
    const bg = hexToRgb(scene.background ?? '#000000')
    gl.clearColor(bg[0], bg[1], bg[2], this.transparent && !scene.background ? 0 : 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    let read = 0

    const soloing = scene.layers.some((l) => l.solo && l.visible)
    const layers = scene.layers
    // A layer with a track matte uses another layer (the one above, or one
    // you pick), which is not shown itself.
    const matteOf = (l: Layer, i: number) => (l.matte ? (l.matteFrom ? layers.find((x) => x.id === l.matteFrom) : layers[i + 1]) : undefined)
    const usedAsMatte = new Set<string>()
    layers.forEach((l, i) => { const m = matteOf(l, i); if (m && m.id !== l.id) usedAsMatte.add(m.id) })
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i]
      if (NULL_TYPES.has(layer.type) && layer.type !== 'adjust') continue
      if (usedAsMatte.has(layer.id)) continue
      const matteLayer = matteOf(layer, i)
      if (!layer.visible || (soloing && !layer.solo)) continue
      if (!this.showing(layer, time)) continue
      const opacity = this.value(layer.id, 'opacity', layer.opacity, layer.bindings.opacity)
      if (opacity <= 0.001) continue
      let matte: { tex: WebGLTexture; mode: number } | undefined
      if (matteLayer && layer.matte) {
        const ok = this.showing(matteLayer, time) && this.produce(matteLayer, scene, time, this.matteT, false)
        if (!ok) { gl.bindFramebuffer(gl.FRAMEBUFFER, this.matteT.fb); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT) }
        matte = { tex: this.matteT.tex, mode: layer.matte }
      }
      if (!this.produce(layer, scene, time, this.placed, measuring, matte, this.stack[read].tex)) continue

      const blend = this.compile('blend', BLEND)
      gl.useProgram(blend)
      this.bindTex(0, this.stack[read].tex)
      this.bindTex(1, this.placed.tex)
      gl.uniform1i(this.loc(blend, 'u_base'), 0)
      gl.uniform1i(this.loc(blend, 'u_layer'), 1)
      gl.uniform1f(this.loc(blend, 'u_opacity'), Math.min(1, opacity))
      gl.uniform1i(this.loc(blend, 'u_mode'), layer.type === 'adjust' ? 0 : Math.max(0, Math.min(BLEND_MODES.length - 1, layer.blend)))
      const qb = this.begin(`${layer.id}:blend`, '', measuring)
      this.draw(this.stack[1 - read].fb)
      this.end(qb)
      read = 1 - read
    }

    // Effects on the whole picture (Finish > Effects): grading, LUTs...
    const graded = this.runEffects(scene.master.effects, this.stack[read].tex, 'master', (k, d, b) => this.value('master', k, Number(scene.master.values[k] ?? d), b ?? scene.master.bindings[k]), time)

    // Finishing pass, with the previous frame for trails.
    const master = this.compile('master', MASTER)
    const prev = this.master[this.masterIndex]
    const next = this.master[1 - this.masterIndex]
    gl.useProgram(master)
    this.bindTex(0, graded)
    this.bindTex(1, prev.tex)
    gl.uniform1i(this.loc(master, 'u_src'), 0)
    gl.uniform1i(this.loc(master, 'u_prev'), 1)
    gl.uniform1fv(this.loc(master, 'u_n'), this.numbers('master', MASTER_PARAMS, scene.master.values, scene.master.bindings).slice(0, 6))
    gl.uniform1f(this.loc(master, 'u_keepAlpha'), this.transparent && !scene.background ? 1 : 0)
    gl.uniform2f(this.loc(master, 'u_res'), this.width, this.height)
    gl.uniform1f(this.loc(master, 'u_time'), time)
    const qf = this.begin('finish', 'Finish', measuring)
    this.draw(next.fb)
    this.end(qf)
    this.masterIndex = 1 - this.masterIndex

    // To the screen.
    const copy = this.compile('copy', COPY)
    gl.useProgram(copy)
    this.bindTex(0, next.tex)
    gl.uniform1i(this.loc(copy, 'u_src'), 0)
    gl.uniform1f(this.loc(copy, 'u_flip'), 0)
    this.draw(null)
    if (this.measureEvery % 15 === 1 || !this.timer) this.updateStats(scene)
  }

  // The finished frame as a texture source (for output windows and export).
  get outputCanvas() {
    return this.canvas
  }

  // Starts reading the current frame back and returns the frame read two
  // calls ago, if it is ready. Rows come out top first, as video expects.
  readOutput(): OutputFrame | null {
    const started = performance.now()
    try {
      return this.readOutputInner()
    } finally {
      this.readMs = this.readMs * 0.9 + (performance.now() - started) * 0.1
    }
  }

  private readOutputInner(): OutputFrame | null {
    const gl = this.gl
    if (!this.readBuffer) return null
    const latest = this.master[this.masterIndex]
    const copy = this.compile('copy', COPY)
    gl.useProgram(copy)
    this.bindTex(0, latest.tex)
    gl.uniform1i(this.loc(copy, 'u_src'), 0)
    gl.uniform1f(this.loc(copy, 'u_flip'), 1)
    this.draw(this.out.fb)

    // Collect whichever earlier read has finished, newest first.
    let frame: OutputFrame | null = null
    let newest = -1
    for (let k = 0; k < this.pbos.length; k++) {
      const fence = this.fences[k]
      if (!fence || gl.clientWaitSync(fence, 0, 0) === gl.TIMEOUT_EXPIRED) continue
      gl.deleteSync(fence)
      this.fences[k] = null
      if (this.issued[k] > newest) {
        newest = this.issued[k]
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbos[k])
        gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.readBuffer)
        frame = { pixels: this.readBuffer, width: this.width, height: this.height }
      }
    }
    // Start a new read if a buffer is free.
    const free = this.fences.findIndex((f) => !f)
    if (free >= 0) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.out.fb)
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbos[free])
      gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, 0)
      this.fences[free] = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
      this.issued[free] = ++this.serial
    }
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
    return frame
  }

  dispose() {
    this.forget(new Set())
  }
}

function mul3(a: number[], b: number[]): number[] {
  const o = new Array(9).fill(0)
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c]
  return o
}

export function invert3(m: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g
  const det = a * A + b * B + c * C
  if (Math.abs(det) < 1e-12) return [1e6, 0, 0, 0, 1e6, 0, 0, 0, 1]
  const k = 1 / det
  return [A * k, -(b * i - c * h) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k, -(a * f - c * d) * k, C * k, -(a * h - b * g) * k, (a * e - b * d) * k]
}

// A 3D LUT as one strip: slices of blue side by side.
function stripOf(bytes: Uint8Array, n: number): Uint8Array {
  const out = new Uint8Array(n * n * n * 3)
  for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) {
    const src = (r + g * n + b * n * n) * 3
    const dst = (g * n * n + b * n + r) * 3
    out[dst] = bytes[src]; out[dst + 1] = bytes[src + 1]; out[dst + 2] = bytes[src + 2]
  }
  return out
}

// A short fingerprint of text, to cache compiled shaders by their code.
function hashText(t: string) {
  let h = 2166136261
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619) }
  return (h >>> 0).toString(36)
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return [1, 1, 1]
  const n = parseInt(m[1], 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}
