import { clipLayers, homography, maskLayers, meshAt, applyH, surfacesInOrder, type Mask, type OutputMap, type Surface } from './model'

// Draws one output: every surface warped onto its points, back to front. A
// mask sits in that stack: it darkens what is drawn so far (its surface and
// everything behind it), and surfaces after it are drawn on top. Then soft
// edges and brightness. WebGL2, one draw per surface.

const VS = `#version 300 es
in vec2 a_pos; in vec2 a_uv; out vec2 v_uv; out vec2 v_suv; out vec2 v_pos;
uniform vec4 u_crop; uniform vec2 u_flip;
void main() {
  v_suv = a_uv;
  v_pos = a_pos;
  vec2 uv = vec2(u_flip.x > 0.5 ? 1.0 - a_uv.x : a_uv.x, u_flip.y > 0.5 ? 1.0 - a_uv.y : a_uv.y);
  v_uv = mix(u_crop.xy, u_crop.zw, uv);
  gl_Position = vec4(a_pos.x * 2.0 - 1.0, 1.0 - a_pos.y * 2.0, 0.0, 1.0);
}`

const FS = `#version 300 es
precision highp float;
in vec2 v_uv; in vec2 v_suv; in vec2 v_pos; out vec4 o;
uniform sampler2D u_tex; uniform int u_solid; uniform vec3 u_color;
uniform sampler2D u_clip; uniform int u_hasClip;
uniform float u_opacity, u_bright, u_contrast, u_gamma, u_hue, u_feather;
vec3 hue(vec3 c, float h) { const vec3 k = vec3(0.57735); float a = h * 6.2831853;
  return c * cos(a) + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cos(a)); }
void main() {
  vec3 c = u_solid == 1 ? u_color : texture(u_tex, vec2(v_uv.x, v_uv.y)).rgb;
  c = (c - 0.5) * u_contrast + 0.5;
  c = pow(max(c, 0.0), vec3(1.0 / max(u_gamma, 0.05))) * u_bright;
  if (u_hue != 0.0) c = hue(c, u_hue);
  float e = min(min(v_suv.x, 1.0 - v_suv.x), min(v_suv.y, 1.0 - v_suv.y));
  float a = u_feather > 0.0 ? smoothstep(0.0, u_feather, e) : 1.0;
  // masks clipped to this surface only
  if (u_hasClip == 1) a *= texture(u_clip, v_pos).r;
  o = vec4(clamp(c, 0.0, 1.0) * a * u_opacity, a * u_opacity);
}`

// Multiplies what is drawn so far by a mask (blend: zero, source color).
const MASK_FS = `#version 300 es
precision highp float;
in vec2 v; out vec4 o;
uniform sampler2D u_mask;
void main() { float m = texture(u_mask, vec2(v.x, 1.0 - v.y)).r; o = vec4(m, m, m, 1.0); }`

const FINAL_VS = `#version 300 es
in vec2 a_pos; out vec2 v; void main() { v = a_pos; gl_Position = vec4(a_pos * 2.0 - 1.0, 0.0, 1.0); }`
const FINAL_FS = `#version 300 es
precision highp float;
in vec2 v; out vec4 o;
uniform sampler2D u_img; uniform sampler2D u_mask; uniform float u_bright;
uniform vec4 u_soft; uniform float u_softGamma;
float ramp(float x, float w) { return w <= 0.0 ? 1.0 : pow(clamp(x / w, 0.0, 1.0), u_softGamma); }
void main() {
  vec3 c = texture(u_img, v).rgb;
  float m = texture(u_mask, vec2(v.x, 1.0 - v.y)).r;
  float s = ramp(v.x, u_soft.x) * ramp(1.0 - v.x, u_soft.y) * ramp(1.0 - v.y, u_soft.z) * ramp(v.y, u_soft.w);
  o = vec4(c * m * s * u_bright, 1.0);
}`

function testPattern(w: number, h: number, label: string): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const g = c.getContext('2d')!
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h)
  g.strokeStyle = '#3bff03'; g.lineWidth = 2
  const step = Math.round(Math.min(w, h) / 10)
  for (let x = 0; x <= w; x += step) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke() }
  for (let y = 0; y <= h; y += step) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke() }
  g.strokeStyle = '#f820a0'; g.lineWidth = 6
  g.strokeRect(3, 3, w - 6, h - 6)
  g.beginPath(); g.moveTo(0, 0); g.lineTo(w, h); g.moveTo(w, 0); g.lineTo(0, h); g.stroke()
  g.beginPath(); g.arc(w / 2, h / 2, Math.min(w, h) * 0.35, 0, Math.PI * 2); g.stroke()
  g.fillStyle = '#fff'; g.font = `${Math.round(h / 10)}px "Courier Prime", monospace`; g.textAlign = 'center'
  g.fillText(label, w / 2, h / 2 + h / 30)
  return c
}

export class MapRenderer {
  private gl: WebGL2RenderingContext
  private prog: WebGLProgram
  private finalProg: WebGLProgram
  private buf: WebGLBuffer
  private quad: WebGLBuffer
  private textures = new Map<string, WebGLTexture>()
  private tests = new Map<string, HTMLCanvasElement>()
  private fbo: WebGLFramebuffer
  private fboTex: WebGLTexture
  private maskProg: WebGLProgram
  private maskTex: WebGLTexture
  private maskTexs = new Map<string, { key: string; tex: WebGLTexture }>()
  private maskCanvas = document.createElement('canvas')
  private w = 0
  private h = 0

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, alpha: false, antialias: true })
    if (!gl) throw new Error('This computer has no WebGL2.')
    this.gl = gl
    const compile = (vs: string, fs: string) => {
      const p = gl.createProgram()!
      for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
        const s = gl.createShader(type)!
        gl.shaderSource(s, src)
        gl.compileShader(s)
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader')
        gl.attachShader(p, s)
      }
      gl.bindAttribLocation(p, 0, 'a_pos')
      gl.bindAttribLocation(p, 1, 'a_uv')
      gl.linkProgram(p)
      return p
    }
    this.prog = compile(VS, FS)
    this.finalProg = compile(FINAL_VS, FINAL_FS)
    this.maskProg = compile(FINAL_VS, MASK_FS)
    this.buf = gl.createBuffer()!
    this.quad = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW)
    this.fbo = gl.createFramebuffer()!
    this.fboTex = this.newTex()
    this.maskTex = this.newTex()
  }

  private newTex() {
    const gl = this.gl
    const t = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]))
    return t
  }

  private sourceTex(name: string, sources: Map<string, TexImageSource>, label: string): WebGLTexture | null {
    const gl = this.gl
    let src: TexImageSource | undefined = sources.get(name)
    if (name === 'test') {
      let c = this.tests.get(label)
      if (!c) { c = testPattern(1280, 720, label); this.tests.set(label, c) }
      src = c
    }
    if (!src) return null
    let t = this.textures.get(name === 'test' ? `test:${label}` : name)
    if (!t) { t = this.newTex(); this.textures.set(name === 'test' ? `test:${label}` : name, t) }
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src)
    return t
  }

  // Masks are drawn on a 2D canvas (soft edges with a blur), then used as a texture.
  private maskFor(slot: string, masks: Mask[]): WebGLTexture {
    const keyNow = JSON.stringify([masks, this.w, this.h])
    const have = this.maskTexs.get(slot)
    if (have && have.key === keyNow) return have.tex
    const tex = have?.tex ?? this.newTex()
    this.maskTexs.set(slot, { key: keyNow, tex })
    const c = this.maskCanvas
    const W = Math.max(2, Math.round(this.w / 2)), H = Math.max(2, Math.round(this.h / 2))
    c.width = W; c.height = H
    const g = c.getContext('2d')!
    g.fillStyle = '#fff'
    g.fillRect(0, 0, W, H)
    for (const m of masks) {
      if (!m.on || m.points.length < 3) continue
      const layer = document.createElement('canvas')
      layer.width = W; layer.height = H
      const lg = layer.getContext('2d')!
      lg.filter = m.feather > 0 ? `blur(${m.feather / 2}px)` : 'none'
      lg.fillStyle = '#000'
      if (m.invert) {
        // Only light inside: black everywhere but the shape.
        lg.beginPath(); lg.rect(-W, -H, W * 3, H * 3)
        m.points.forEach(([x, y], i) => (i ? lg.lineTo(x * W, y * H) : lg.moveTo(x * W, y * H)))
        lg.closePath()
        lg.fill('evenodd')
      } else {
        lg.beginPath()
        m.points.forEach(([x, y], i) => (i ? lg.lineTo(x * W, y * H) : lg.moveTo(x * W, y * H)))
        lg.closePath()
        lg.fill()
      }
      g.globalCompositeOperation = 'multiply'
      g.drawImage(layer, 0, 0)
      g.globalCompositeOperation = 'source-over'
    }
    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c)
    return tex
  }

  // Darkens what is drawn so far by these masks.
  private applyMasks(slot: string, masks: Mask[]) {
    const gl = this.gl
    const tex = this.maskFor(slot, masks)
    gl.useProgram(this.maskProg)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ZERO, gl.SRC_COLOR)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.uniform1i(gl.getUniformLocation(this.maskProg, 'u_mask'), 1)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.enableVertexAttribArray(0)
    gl.disableVertexAttribArray(1)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
    gl.useProgram(this.prog)
    gl.activeTexture(gl.TEXTURE0)
  }

  private mesh(s: Surface): Float32Array {
    const n = s.kind === 'quad' ? 24 : Math.max(8, (s.cols - 1) * 8)
    const m = s.kind === 'quad' ? 24 : Math.max(8, (s.rows - 1) * 8)
    const H = s.kind === 'quad' ? homography(s.points) : undefined
    const at = (u: number, v: number) => (H ? applyH(H, u, v) : meshAt(s, u, v))
    const data = new Float32Array(n * m * 6 * 4)
    let k = 0
    for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) {
      const u0 = i / n, u1 = (i + 1) / n, v0 = j / m, v1 = (j + 1) / m
      const corners: [number, number][] = [[u0, v0], [u1, v0], [u0, v1], [u0, v1], [u1, v0], [u1, v1]]
      for (const [u, v] of corners) { const [x, y] = at(u, v); data[k++] = x; data[k++] = y; data[k++] = u; data[k++] = v }
    }
    return data
  }

  render(map: OutputMap, sources: Map<string, TexImageSource>, label: string) {
    const gl = this.gl
    const c = this.canvas
    if (c.width !== this.w || c.height !== this.h) {
      this.w = c.width; this.h = c.height
      gl.bindTexture(gl.TEXTURE_2D, this.fboTex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.w, this.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboTex, 0)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo)
    gl.viewport(0, 0, this.w, this.h)
    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(this.prog)
    gl.enable(gl.BLEND)
    const loc = (n: string) => gl.getUniformLocation(this.prog, n)
    const layers = maskLayers(map)
    const clips = clipLayers(map)
    for (const s of surfacesInOrder(map)) {
      const on = layers.get(s.id)?.filter((k) => k.on && k.points.length >= 3)
      if (!s.on) { if (on?.length) this.applyMasks(s.id, on); continue }
      const solid = s.source === 'solid'
      const tex = solid ? null : this.sourceTex(map.test ? 'test' : s.source, sources, map.test ? `${label}: ${s.name}` : label)
      if (!solid && !tex) { if (on?.length) this.applyMasks(s.id, on); continue }
      if (s.blend === 'add') gl.blendFunc(gl.ONE, gl.ONE)
      else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      gl.activeTexture(gl.TEXTURE0)
      if (tex) gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.uniform1i(loc('u_tex'), 0)
      gl.uniform1i(loc('u_solid'), solid ? 1 : 0)
      const hex = /^#?([0-9a-f]{6})$/i.exec(s.color)?.[1] ?? 'ffffff'
      const n = parseInt(hex, 16)
      gl.uniform3f(loc('u_color'), ((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
      gl.uniform4f(loc('u_crop'), s.crop[0], s.crop[1], s.crop[2], s.crop[3])
      gl.uniform2f(loc('u_flip'), s.flipX ? 1 : 0, s.flipY ? 1 : 0)
      gl.uniform1f(loc('u_opacity'), s.opacity)
      gl.uniform1f(loc('u_bright'), s.brightness)
      gl.uniform1f(loc('u_contrast'), s.contrast)
      gl.uniform1f(loc('u_gamma'), s.gamma)
      gl.uniform1f(loc('u_hue'), s.hue)
      gl.uniform1f(loc('u_feather'), s.feather)
      const clip = clips.get(s.id)?.filter((k) => k.on && k.points.length >= 3)
      if (clip?.length) {
        const ct = this.maskFor(`clip:${s.id}`, clip)
        gl.useProgram(this.prog)
        gl.activeTexture(gl.TEXTURE2)
        gl.bindTexture(gl.TEXTURE_2D, ct)
        gl.uniform1i(loc('u_clip'), 2)
        gl.uniform1i(loc('u_hasClip'), 1)
        gl.activeTexture(gl.TEXTURE0)
        if (tex) gl.bindTexture(gl.TEXTURE_2D, tex)
      } else gl.uniform1i(loc('u_hasClip'), 0)
      const data = this.mesh(s)
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf)
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW)
      gl.enableVertexAttribArray(0)
      gl.enableVertexAttribArray(1)
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0)
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8)
      gl.drawArrays(gl.TRIANGLES, 0, data.length / 4)
      if (on?.length) this.applyMasks(s.id, on)
    }
    gl.disable(gl.BLEND)
    gl.disableVertexAttribArray(1)
    // Final: the masks on top of everything, soft edges, brightness.
    this.maskTex = this.maskFor('top', [])
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, this.w, this.h)
    gl.useProgram(this.finalProg)
    const fl = (n: string) => gl.getUniformLocation(this.finalProg, n)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.fboTex)
    gl.uniform1i(fl('u_img'), 0)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex)
    gl.uniform1i(fl('u_mask'), 1)
    gl.uniform1f(fl('u_bright'), map.brightness)
    gl.uniform4f(fl('u_soft'), map.softLeft, map.softRight, map.softTop, map.softBottom)
    gl.uniform1f(fl('u_softGamma'), map.softGamma)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }
}
