// The graphics card side of texture nodes. Every texture node draws into its own texture with
// a small shader. Pictures leave through 2D canvases so Create and the 3D
// playground can use them.

export interface TexRef { kind: 'tex'; tex: WebGLTexture; w: number; h: number; v: number }

const canvas = document.createElement('canvas')
canvas.width = canvas.height = 2
const gl = canvas.getContext('webgl2', { alpha: true, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true })
export const gpuReady = Boolean(gl)

const VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() { v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`

export const FRAG_HEAD = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_t0;
uniform sampler2D u_t1;
uniform vec2 u_res;
uniform float u_time;
uniform float u_p[12];
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 6; i++) { v += a * noise(p); p *= 2.02; a *= 0.5; } return v; }
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
vec3 hue(vec3 c, float h) { const vec3 k = vec3(0.57735); float a = h * 6.2831853;
  return c * cos(a) + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cos(a)); }
vec3 hsv(float h, float s, float v) { vec3 c = clamp(abs(mod(h * 6.0 + vec3(0, 4, 2), 6.0) - 3.0) - 1.0, 0.0, 1.0); return v * mix(vec3(1.0), c, s); }
`

const programs = new Map<string, WebGLProgram | string>()
let quad: WebGLBuffer | null = null

function compile(key: string, body: string): WebGLProgram | string {
  const cached = programs.get(key)
  if (cached) return cached
  if (!gl) return 'This computer has no WebGL2.'
  const make = (type: number, src: string) => {
    const s = gl.createShader(type)!
    gl.shaderSource(s, src)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s) ?? 'error'
      gl.deleteShader(s)
      throw new Error(log)
    }
    return s
  }
  let result: WebGLProgram | string
  try {
    const p = gl.createProgram()!
    gl.attachShader(p, make(gl.VERTEX_SHADER, VERT))
    gl.attachShader(p, make(gl.FRAGMENT_SHADER, FRAG_HEAD + body))
    gl.bindAttribLocation(p, 0, 'a_pos')
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link')
    result = p
  } catch (e) {
    // Shader errors come back as text, with the line numbers of your code.
    const head = FRAG_HEAD.split('\n').length - 1
    result = String((e as Error).message).replace(/0:(\d+)/g, (_, n) => `line ${Number(n) - head}`)
  }
  programs.set(key, result)
  if (programs.size > 400) programs.delete(programs.keys().next().value!)
  return result
}

// render targets, one (or two, for feedback) per node

interface Target { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number }
const targets = new Map<string, Target>()
let version = 0

function target(key: string, w: number, h: number): Target {
  const old = targets.get(key)
  if (old && old.w === w && old.h === h) return old
  if (old) { gl!.deleteFramebuffer(old.fb); gl!.deleteTexture(old.tex) }
  const tex = gl!.createTexture()!
  gl!.bindTexture(gl!.TEXTURE_2D, tex)
  gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA8, w, h, 0, gl!.RGBA, gl!.UNSIGNED_BYTE, null)
  gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR)
  gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR)
  gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.REPEAT)
  gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.REPEAT)
  const fb = gl!.createFramebuffer()!
  gl!.bindFramebuffer(gl!.FRAMEBUFFER, fb)
  gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, gl!.TEXTURE_2D, tex, 0)
  gl!.clearColor(0, 0, 0, 1)
  gl!.clear(gl!.COLOR_BUFFER_BIT)
  const t = { fb, tex, w, h }
  targets.set(key, t)
  return t
}

export function freeNode(id: string) {
  if (!gl) return
  for (const [k, t] of targets) {
    if (k === id || k.startsWith(`${id}:`)) {
      gl.deleteFramebuffer(t.fb)
      gl.deleteTexture(t.tex)
      targets.delete(k)
    }
  }
}

let blank: WebGLTexture | null = null
function blankTex() {
  if (!blank && gl) {
    blank = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, blank)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]))
  }
  return blank!
}

function drawQuad() {
  if (!quad) {
    quad = gl!.createBuffer()
    gl!.bindBuffer(gl!.ARRAY_BUFFER, quad)
    gl!.bufferData(gl!.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl!.STATIC_DRAW)
  }
  gl!.bindBuffer(gl!.ARRAY_BUFFER, quad)
  gl!.enableVertexAttribArray(0)
  gl!.vertexAttribPointer(0, 2, gl!.FLOAT, false, 0, 0)
  gl!.drawArrays(gl!.TRIANGLES, 0, 3)
}

export interface PassOptions {
  key: string            // which target (node id, or node id + ":b")
  body: string           // GLSL: the inside of main(), or a whole function set with "void main"
  w: number
  h: number
  t: number
  params?: number[]
  inputs?: (TexRef | null | undefined)[]
}

// Runs one shader into a node's texture. Returns the texture, or the error text.
export function pass(o: PassOptions): TexRef | string {
  if (!gl) return 'This computer has no WebGL2.'
  const src = o.body.includes('void main') ? o.body : `void main() { vec2 uv = v_uv; ${o.body}\n}`
  const prog = compile(src, src)
  if (typeof prog === 'string') return prog
  const tg = target(o.key, Math.max(1, Math.round(o.w)), Math.max(1, Math.round(o.h)))
  gl.bindFramebuffer(gl.FRAMEBUFFER, tg.fb)
  gl.viewport(0, 0, tg.w, tg.h)
  gl.useProgram(prog)
  const ins = o.inputs ?? []
  for (let i = 0; i < 2; i++) {
    gl.activeTexture(gl.TEXTURE0 + i)
    gl.bindTexture(gl.TEXTURE_2D, ins[i]?.tex ?? blankTex())
    gl.uniform1i(gl.getUniformLocation(prog, `u_t${i}`), i)
  }
  gl.uniform2f(gl.getUniformLocation(prog, 'u_res'), tg.w, tg.h)
  gl.uniform1f(gl.getUniformLocation(prog, 'u_time'), o.t)
  const p = new Float32Array(12)
  ;(o.params ?? []).slice(0, 12).forEach((v, i) => { p[i] = Number(v) || 0 })
  gl.uniform1fv(gl.getUniformLocation(prog, 'u_p'), p)
  drawQuad()
  return { kind: 'tex', tex: tg.tex, w: tg.w, h: tg.h, v: ++version }
}

// Puts a picture from a canvas, video or image into a node's texture.
export function upload(key: string, src: TexImageSource, w: number, h: number): TexRef | null {
  if (!gl || !w || !h) return null
  const tg = target(key, w, h)
  gl.bindTexture(gl.TEXTURE_2D, tg.tex)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
  try {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src)
  } catch {
    /* the source is not ready yet */
  }
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
  return { kind: 'tex', tex: tg.tex, w, h, v: ++version }
}

// Copies a texture into a 2D canvas (to show it, or to hand it to Create and 3D).
export function toCanvas(t: TexRef, out: HTMLCanvasElement, maxW = 4096) {
  if (!gl) return
  const scale = Math.min(1, maxW / t.w)
  const w = Math.max(1, Math.round(t.w * scale)), h = Math.max(1, Math.round(t.h * scale))
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
  const prog = compile('copy', 'void main() { o = texture(u_t0, v_uv); }')
  if (typeof prog === 'string') return
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.viewport(0, 0, w, h)
  gl.useProgram(prog)
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, t.tex)
  gl.uniform1i(gl.getUniformLocation(prog, 'u_t0'), 0)
  drawQuad()
  if (out.width !== w || out.height !== h) { out.width = w; out.height = h }
  const ctx = out.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, w, h)
  ctx.drawImage(canvas, 0, 0)
}

// The average color of a texture, 0..1 per channel.
export function average(t: TexRef): [number, number, number, number] {
  if (!gl) return [0, 0, 0, 0]
  gl.bindTexture(gl.TEXTURE_2D, t.tex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
  gl.generateMipmap(gl.TEXTURE_2D)
  const lod = Math.max(0, Math.log2(Math.max(t.w, t.h)) - 3)
  const r = pass({ key: '__avg', w: 8, h: 8, t: 0, inputs: [t], params: [lod], body: 'o = textureLod(u_t0, uv, u_p[0]);' })
  gl.bindTexture(gl.TEXTURE_2D, t.tex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  if (typeof r === 'string') return [0, 0, 0, 0]
  const tg = targets.get('__avg')!
  gl.bindFramebuffer(gl.FRAMEBUFFER, tg.fb)
  const px = new Uint8Array(8 * 8 * 4)
  gl.readPixels(0, 0, 8, 8, gl.RGBA, gl.UNSIGNED_BYTE, px)
  const sum = [0, 0, 0, 0]
  for (let i = 0; i < px.length; i += 4) for (let c = 0; c < 4; c++) sum[c] += px[i + c]
  return sum.map((s) => s / 64 / 255) as [number, number, number, number]
}
