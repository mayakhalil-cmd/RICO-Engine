import * as THREE from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { internals } from './engine'
import { getWorld, OUTLINE_DEFAULT, type Obj3D } from './world'
import type { ContourBuilt } from './contour'
import { contourWorldLines } from './contour'

// "Export the look": a .glb that opens in Blender, Unreal, Unity,
// TouchDesigner, Cinema 4D and the rest, and looks like RICO's window.
//
// Every shape's look (layers, painterly strokes, halftone, chrome, your
// paint, the light) is baked into a picture on its own UVs, by drawing the
// shape flat into its UV square with the camera's light and view. The
// pictures go on unlit materials (glTF "unlit"), so other apps show them as
// they are. Outlines become real geometry: the outline shell as an inside-out
// copy of the shape, and the strokes as thin ribbons facing the camera.
// Animated looks are baked as they are at this moment.

export interface LookOptions { size: 512 | 1024 | 2048 | 4096; outlines: boolean; strokes: boolean; lit: boolean }

// Draws a material flat into its UV square (the view and light stay as in the window).
function bakeable(mat: THREE.Material, exposure: number): () => void {
  const prev = mat.onBeforeCompile
  const prevKey = mat.customProgramCacheKey
  const prevSide = mat.side
  mat.onBeforeCompile = (sh, r) => {
    prev.call(mat, sh, r)
    const v = sh.vertexShader
    const end = v.lastIndexOf('}')
    sh.vertexShader = `${v.slice(0, end)}\n  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);\n}`
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', `vec3 rBakeAces(vec3 x) { x *= ${exposure.toFixed(4)} * 0.6; return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }\nvoid main() {`)
      .replace('#include <colorspace_fragment>', 'gl_FragColor.rgb = rBakeAces(gl_FragColor.rgb);\n#include <colorspace_fragment>')
  }
  mat.customProgramCacheKey = () => `${prevKey.call(mat)}|bake`
  mat.side = THREE.DoubleSide
  mat.needsUpdate = true
  return () => { mat.onBeforeCompile = prev; mat.customProgramCacheKey = prevKey; mat.side = prevSide; mat.needsUpdate = true }
}

// Pixels outside the UV islands take their neighbours' colors, so edges do not show a seam.
function bleed(c: HTMLCanvasElement, rounds = 8) {
  const g = c.getContext('2d')!
  const img = g.getImageData(0, 0, c.width, c.height)
  const d = img.data, w = c.width, h = c.height
  for (let r = 0; r < rounds; r++) {
    const src = new Uint8ClampedArray(d)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      if (src[i + 3] > 0) continue
      let n = 0, R = 0, G = 0, B = 0
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = x + dx, Y = y + dy
        if (X < 0 || Y < 0 || X >= w || Y >= h) continue
        const j = (Y * w + X) * 4
        if (src[j + 3] > 0) { R += src[j]; G += src[j + 1]; B += src[j + 2]; n++ }
      }
      if (n) { d[i] = R / n; d[i + 1] = G / n; d[i + 2] = B / n; d[i + 3] = 255 }
    }
  }
  g.putImageData(img, 0, 0)
}

function bakeMesh(mesh: THREE.Mesh, size: number, exposure: number): HTMLCanvasElement | null {
  const { renderer, scene, camera } = internals()
  if (!mesh.geometry.getAttribute('uv')) return null
  const rt = new THREE.WebGLRenderTarget(size, size, { samples: 4 })
  rt.texture.colorSpace = THREE.SRGBColorSpace
  // only this shape (and the lights) are drawn
  const hidden: THREE.Object3D[] = []
  scene.traverse((o) => {
    if (o === mesh || (o as THREE.Light).isLight || !o.visible) return
    if ((o as THREE.Mesh).isMesh || (o as THREE.Line).isLine || (o as THREE.Points).isPoints || (o as THREE.Sprite).isSprite) { hidden.push(o); o.visible = false }
  })
  const kids = mesh.children.filter((c) => c.visible)
  kids.forEach((c) => (c.visible = false))
  const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.Material[]
  const undo = mats.map((m) => bakeable(m, exposure))
  const bg = scene.background
  scene.background = null
  const prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha()
  renderer.setClearColor(0x000000, 0)
  const prevCull = mesh.frustumCulled
  mesh.frustumCulled = false
  try {
    renderer.setRenderTarget(rt)
    renderer.clear()
    renderer.render(scene, camera)
    const px = new Uint8Array(size * size * 4)
    renderer.readRenderTargetPixels(rt, 0, 0, size, size, px)
    const c = document.createElement('canvas')
    c.width = c.height = size
    const g = c.getContext('2d')!
    const img = g.createImageData(size, size)
    // the picture comes out upside down
    for (let y = 0; y < size; y++) img.data.set(px.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4)
    g.putImageData(img, 0, 0)
    bleed(c)
    return c
  } finally {
    renderer.setRenderTarget(null)
    renderer.setClearColor(prevClear, prevAlpha)
    scene.background = bg
    mesh.frustumCulled = prevCull
    undo.forEach((u) => u())
    hidden.forEach((o) => (o.visible = true))
    kids.forEach((c) => (c.visible = true))
    rt.dispose()
  }
}

// The outline shell: the shape pushed out along its normals, turned inside out.
function shellOf(mesh: THREE.Mesh, width: number, color: string): THREE.Mesh {
  const c = new THREE.BufferGeometry()
  c.setAttribute('position', mesh.geometry.getAttribute('position').clone())
  if (mesh.geometry.index) c.setIndex(mesh.geometry.index.clone())
  const g = mergeVertices(c, 1e-4)
  g.computeVertexNormals()
  const p = g.getAttribute('position'), n = g.getAttribute('normal')
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + n.getX(i) * width, p.getY(i) + n.getY(i) * width, p.getZ(i) + n.getZ(i) * width)
  const idx = g.index!
  for (let i = 0; i < idx.count; i += 3) { const a = idx.getX(i + 1); idx.setX(i + 1, idx.getX(i + 2)); idx.setX(i + 2, a) }
  g.deleteAttribute('normal')
  g.computeVertexNormals()
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color }))
  m.name = `${mesh.name || 'Shape'} outline`
  return m
}

// Strokes as flat ribbons that face the camera (other apps do not draw thick lines).
function ribbons(lines: Float32Array, width: number, color: string, camPos: THREE.Vector3, name: string): THREE.Mesh | null {
  if (lines.length < 6) return null
  const pos: number[] = []
  const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3(), v = new THREE.Vector3(), side = new THREE.Vector3()
  for (let i = 0; i + 5 < lines.length; i += 6) {
    a.set(lines[i], lines[i + 1], lines[i + 2]); b.set(lines[i + 3], lines[i + 4], lines[i + 5])
    d.subVectors(b, a)
    if (d.lengthSq() < 1e-12) continue
    v.subVectors(camPos, a).normalize()
    side.crossVectors(d, v).normalize().multiplyScalar(width / 2)
    const p0 = a.clone().add(side), p1 = a.clone().sub(side), p2 = b.clone().sub(side), p3 = b.clone().add(side)
    pos.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, p0.x, p0.y, p0.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.computeVertexNormals()
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }))
  m.name = name
  return m
}

// Outline shells and strokes live inside helper groups.
function isHelperChild(o: THREE.Object3D): boolean {
  for (let p = o.parent; p; p = p.parent) if (p.userData.helper) return true
  return false
}

export async function exportLook(opts: LookOptions): Promise<Blob> {
  const { camera, objects, renderer } = internals()
  const w = getWorld()
  const out = new THREE.Scene()
  out.name = 'RICO look'
  const camPos = camera.getWorldPosition(new THREE.Vector3())
  const exposure = renderer.toneMappingExposure
  const byId = new Map<string, Obj3D>(w.objects.map((o) => [o.id, o]))
  for (const [id, e] of objects) {
    const o = byId.get(id)
    if (!o || !o.visible || o.kind === 'fog' || o.kind === 'point-light' || o.kind === 'spot-light' || o.kind === 'sun') continue
    e.obj.updateMatrixWorld(true)
    const meshes: THREE.Mesh[] = []
    e.obj.traverse((c) => { const m = c as THREE.Mesh; if (m.isMesh && !m.userData.helper && !isHelperChild(m) && m.geometry.getAttribute('position')?.count) meshes.push(m) })
    for (const m of meshes) {
      const g = m.geometry.clone()
      g.applyMatrix4(m.matrixWorld)
      let mat: THREE.Material
      if (opts.lit) {
        mat = new THREE.MeshStandardMaterial({ color: o.color, roughness: o.roughness, metalness: o.metalness })
      } else {
        const pic = bakeMesh(m, opts.size, exposure)
        const tex = pic ? new THREE.CanvasTexture(pic) : null
        if (tex) tex.colorSpace = THREE.SRGBColorSpace
        mat = new THREE.MeshBasicMaterial({ map: tex, color: tex ? 0xffffff : o.color })
      }
      const copy = new THREE.Mesh(g, mat)
      copy.name = o.name
      out.add(copy)
      if (opts.outlines && (o.outline ? o.outline.on : o.material === 'toon')) {
        const ol = { ...OUTLINE_DEFAULT, ...(o.outline ?? {}) }
        if (ol.hull !== false && ol.width > 0) {
          const shell = shellOf(m, ol.width, ol.color)
          shell.geometry.applyMatrix4(m.matrixWorld)
          out.add(shell)
        }
        const ct = m.userData.contour as ContourBuilt | undefined
        if (opts.strokes && ct) {
          const dist = camPos.distanceTo(new THREE.Vector3().setFromMatrixPosition(m.matrixWorld))
          // the stroke's pixel width at this distance, in scene units
          const px = (ol.floatWidth ?? 2) * (2 * dist * Math.tan(((camera as THREE.PerspectiveCamera).fov * Math.PI) / 360)) / renderer.domElement.height
          const r = ribbons(contourWorldLines(ct, m), px, ol.floatColor ?? '#ffe14a', camPos, `${o.name} strokes`)
          if (r) out.add(r)
        }
      }
    }
  }
  // the camera, so you see it from the same place
  const cam = (camera as THREE.PerspectiveCamera).clone()
  cam.name = 'RICO camera'
  out.add(cam)
  const result = await new GLTFExporter().parseAsync(out, { binary: true })
  out.traverse((c) => { const m = c as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); const mt = m.material as THREE.MeshBasicMaterial; mt.map?.dispose(); mt.dispose() } })
  return new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' })
}
