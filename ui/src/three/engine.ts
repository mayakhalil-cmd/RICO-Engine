import * as THREE from 'three'
import { setSymbioteFloors, symbioteMesh } from './symbiote'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { getSnap, onSnap, setSnap } from '../shell/snap'
import { buildContour, disposeContour, updateContour, type ContourBuilt } from './contour'
import { COMIC_DEFAULT, TEXT_DEFAULT, comicGeometry, textGeometry } from './textShape'
import { fontsVersion, onFonts } from '../shell/fonts'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { putSignal } from '../engine/signals'
import { loadModel, setAnimations, setBones, setParts, type PartInfo } from './importers'
import { rigObject } from './deform'
import { buildFluid, dropFluid, simHides, simOwns, stepSim } from './sim'
import { asStandard, installLayers } from './materials'
import { filmLayers, layeredMaterial, structureOf, toonGradient, updateLayers } from './materials'
import { toGeometry } from './modeling'
import { fogMaterial, updateFog } from './fog'
import { buildFloating, buildOutline, disposeFloating, disposeOutline, outlineKey, outlineOf, updateFloating, updateOutline, type Floating, type OutlineBuilt } from './outline'
import { hasPaint, paintOf } from './paint'
import { readSignal } from '../engine/signals'
import { driven, setScene3dSource } from '../create/renderer'
import { layersWithKeys, withKeys } from './keyed'
import { beamDir, getDesk, latestLooks, setWhere, startDesk } from '../engine/desk'
import { timelineOf, valueAt } from '../create/timeline'
import { getCreate } from '../create/store'
import { getShape, pictureWanted, putPicture, usePicture } from '../engine/shared'
import { glCamera, type V3 } from '../mapping/calib'
import { getMap, knownOutputs, projectorPicture } from '../mapping/model'
import { fromCode, implicit, parametric } from '../nodes/geo'
import {
  DEFAULT_SHADER, FOG_DEFAULT, changeWorld, getSelected3d, getWorld, isLight, onWorldChange, select3d, updateObject, useWorld, type MatLayer, type Obj3D, type World3D,
  envOf,
} from './world'

// The three.js side of the 3D playground. One renderer and one canvas: the
// viewport panel shows it, and a "3D scene" layer in Create uses it.

export const canvas3d = document.createElement('canvas')
canvas3d.className = 'three-canvas'

const renderer = new THREE.WebGLRenderer({ canvas: canvas3d, antialias: true, alpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' })
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.debug.onShaderError = (gl, _program, vs, fs) => {
  lastShaderError = (gl.getShaderInfoLog(fs) || gl.getShaderInfoLog(vs) || 'The shader did not compile').trim()
}

const scene = new THREE.Scene()
const pmrem = new THREE.PMREMGenerator(renderer)
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.05, 500)
const grid = new THREE.GridHelper(20, 40, 0xbdbdbd, 0x6a6a6a)
;(grid.material as THREE.Material).transparent = true
;(grid.material as THREE.Material).opacity = 0.5
scene.add(grid)

export const orbit = new OrbitControls(camera, canvas3d)
orbit.enableDamping = true

// Perspective (things far away look smaller) or ortho (no depth: sizes stay
// the same, for lining things up). Ortho swaps the camera's lens in place, so
// picking, the handles and orbiting keep working with the same camera.
type LensCam = THREE.PerspectiveCamera & { left: number; right: number; top: number; bottom: number; isOrthographicCamera?: boolean }
const lens = camera as LensCam
let ortho = false
let orthoSize = 4          // half the view height, in meters, at zoom 1
const perspective = camera.updateProjectionMatrix.bind(camera)
camera.updateProjectionMatrix = () => {
  if (!ortho) return perspective()
  const w = orthoSize * camera.aspect
  lens.left = -w; lens.right = w; lens.top = orthoSize; lens.bottom = -orthoSize
  const z = camera.zoom || 1
  // reaches behind the camera too, so nothing is cut off while you zoom
  camera.projectionMatrix.makeOrthographic(-w / z, w / z, orthoSize / z, -orthoSize / z, -camera.far, camera.far)
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert()
}
const lensL = new Set<() => void>()
let lensV = 0
const halfFov = () => Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
export function setOrtho(on: boolean) {
  if (on === ortho) return
  const d = camera.position.distanceTo(orbit.target) || 6
  if (on) {
    orthoSize = Math.max(0.05, d * halfFov())
    camera.zoom = 1
  } else {
    // back to perspective at the distance that shows the same size
    const want = orthoSize / (camera.zoom || 1) / halfFov()
    const dir = camera.position.clone().sub(orbit.target).normalize()
    camera.position.copy(orbit.target).addScaledVector(dir, want)
    camera.zoom = 1
  }
  ortho = on
  ;(lens as { isPerspectiveCamera: boolean }).isPerspectiveCamera = !on
  lens.isOrthographicCamera = on
  camera.updateProjectionMatrix()
  orbit.update()
  try { localStorage.setItem('rico.3d.ortho', on ? '1' : '0') } catch { /* not kept */ }
  lensV++; lensL.forEach((l) => l())
}
export const isOrtho = () => ortho
export const onLens = (l: () => void) => { lensL.add(l); return () => { lensL.delete(l) } }
export const lensVersion = () => lensV
export const gizmo = new TransformControls(camera, canvas3d)
gizmo.setSize(0.9)
const gizmoHelper = gizmo.getHelper()
scene.add(gizmoHelper)
gizmo.addEventListener('dragging-changed', (e) => { orbit.enabled = !(e as unknown as { value: boolean }).value })
// With "All" handles, two more gizmos (turn and size) sit on the same object.
const gizmoR = new TransformControls(camera, canvas3d)
const gizmoS = new TransformControls(camera, canvas3d)
gizmoR.setMode('rotate'); gizmoR.setSize(1.15)
gizmoS.setMode('scale'); gizmoS.setSize(0.55)
for (const g of [gizmoR, gizmoS]) {
  scene.add(g.getHelper())
  g.addEventListener('dragging-changed', (e) => { orbit.enabled = !(e as unknown as { value: boolean }).value })
}
export const allGizmos = [gizmo, gizmoR, gizmoS]
export const gizmoDragging = () => allGizmos.some((g) => g.dragging)
function applySnap() {
  const s = getSnap('3d')
  for (const g of allGizmos) {
    g.setTranslationSnap(s.move ? s.moveStep : null)
    g.setRotationSnap(s.rot ? (s.rotStep * Math.PI) / 180 : null)
    g.setScaleSnap(s.size ? s.sizeStep : null)
  }
  if (!gizmoLocked) gizmo.setMode(s.handles === 'rotate' ? 'rotate' : s.handles === 'scale' ? 'scale' : 'translate')
  syncExtras()
}
function syncExtras() {
  if (poseBone) return
  const all = getSnap('3d').handles === 'all' && !gizmoLocked && gizmo.object && gizmo.mode === 'translate'
  for (const g of [gizmoR, gizmoS]) {
    if (all && g.object !== gizmo.object) g.attach(gizmo.object!)
    if (!all && g.object) g.detach()
  }
}
onSnap(applySnap)

const objects = new Map<string, { obj: THREE.Object3D; sig: string }>()

// Glow that really glows: a bloom pass after the scene is drawn.
const composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(scene, camera))
const bokeh = new BokehPass(scene, camera, { focus: 6, aperture: 0.02, maxblur: 0.01 })
composer.addPass(bokeh)
const bloom = new UnrealBloomPass(new THREE.Vector2(1280, 720), 0.8, 0.4, 0.85)
composer.addPass(bloom)
composer.addPass(new OutputPass())
// The finish, after the light is in screen colors: lens and film looks.
const finish = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 }, uVig: { value: 0 }, uGrain: { value: 0 }, uAb: { value: 0 }, uSat: { value: 1 }, uCon: { value: 1 }, uWarm: { value: 0 }, uScan: { value: 0 }, uPix: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uTime, uVig, uGrain, uAb, uSat, uCon, uWarm, uScan, uPix; varying vec2 vUv;
  float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main() {
    vec2 uv = vUv;
    if (uPix > 0.0) { vec2 cell = vec2(max(1.0, uPix)) / uRes; uv = (floor(uv / cell) + 0.5) * cell; }
    vec2 d = (uv - 0.5) * uAb * 0.02;
    vec3 c = vec3(texture2D(tDiffuse, uv + d).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - d).b);
    c = (c - 0.5) * uCon + 0.5;
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(vec3(l), c, uSat);
    c *= vec3(1.0 + uWarm * 0.12, 1.0, 1.0 - uWarm * 0.12);
    c *= 1.0 - uVig * smoothstep(0.35, 0.85, length(vUv - 0.5) * 1.3);
    c += (h(vUv * uRes + fract(uTime) * 100.0) - 0.5) * uGrain * 0.25;
    c *= 1.0 - uScan * 0.25 * (0.5 + 0.5 * sin(vUv.y * uRes.y * 3.14159));
    gl_FragColor = vec4(c, 1.0);
  }`,
})
composer.addPass(finish)
const hemi = new THREE.HemisphereLight(0xb9c7ff, 0x201410, 0)
scene.add(hemi)
const envTextures: Record<string, THREE.Texture | null> = { studio: null, soft: null }
let skyKey = ''
let gridKey = ''
let gridNow = grid

// Things the modeling tools need.
export const objectOf = (id: string) => objects.get(id)?.obj
export const getCamera = () => camera
export const getScene = () => scene
let gizmoLocked = false
export function setGizmoLock(on: boolean) { gizmoLocked = on; syncExtras() }
export const renderSize = new THREE.Vector2(1280, 720)

// ---- building things ------------------------------------------------------------

function geometry(kind: Obj3D['kind']): THREE.BufferGeometry {
  switch (kind) {
    case 'box': return new THREE.BoxGeometry(1, 1, 1, 12, 12, 12)
    case 'sphere': return new THREE.SphereGeometry(0.6, 64, 32)
    case 'torus': return new THREE.TorusGeometry(0.55, 0.22, 48, 128)
    case 'knot': return new THREE.TorusKnotGeometry(0.55, 0.18, 220, 32)
    case 'cylinder': return new THREE.CylinderGeometry(0.5, 0.5, 1.2, 64, 32)
    case 'cone': return new THREE.ConeGeometry(0.6, 1.2, 64, 32)
    case 'plane': return new THREE.PlaneGeometry(1, 1, 32, 32).rotateX(-Math.PI / 2)
    case 'icosa': return new THREE.IcosahedronGeometry(0.7, 0)
    case 'ring': return new THREE.RingGeometry(0.4, 0.7, 64).rotateX(-Math.PI / 2)
    case 'capsule': return new THREE.CapsuleGeometry(0.35, 0.8, 16, 32)
    case 'shape': case 'math-surface': case 'math-solid': case 'code-shape':
      return new THREE.BufferGeometry()  // filled in every frame by liveShape()
    default: return new THREE.BoxGeometry(1, 1, 1)
  }
}

// ---- shapes made from math, code or nodes ----

const usesTime = (s?: string) => /\bt\b/.test(s ?? '')
let lastShaderError = ''
export const shaderError = () => lastShaderError

function mathShape(o: Obj3D, t: number, a: number, b: number): THREE.BufferGeometry | string | null {
  const res = Math.max(4, Math.min(o.kind === 'math-solid' ? 96 : 512, Math.round(o.res ?? 64)))
  if (o.kind === 'math-surface') return parametric(o.fx ?? '0', o.fy ?? '0', o.fz ?? '0', res, res, t, a, b)
  if (o.kind === 'math-solid') return implicit(o.solid ?? '1', res, 1.5, t, a, b)
  if (o.kind === 'code-shape') return fromCode(o.code ?? '', t, a, b, 0)
  return null
}

// Rebuilds a math or code shape when its formula or numbers change, and up
// to 30 times a second when it uses time.
function liveShape(o: Obj3D, mesh: THREE.Mesh, t: number) {
  if (o.kind === 'shape') {
    const s = o.shape ? getShape(o.shape) : undefined
    if (s && mesh.userData.shapeV !== `${o.shape}#${s.version}`) {
      mesh.userData.shapeV = `${o.shape}#${s.version}`
      if (!mesh.userData.shared) mesh.geometry.dispose()   // the node network owns its shapes
      mesh.userData.shared = true
      mesh.geometry = s.geometry as THREE.BufferGeometry
    }
    return
  }
  const a = linked(o, 'a', o.a ?? 0), b = linked(o, 'b', o.b ?? 0)
  const moving = usesTime(o.kind === 'math-surface' ? `${o.fx}${o.fy}${o.fz}` : o.kind === 'math-solid' ? o.solid : o.code)
  const key = JSON.stringify([o.fx, o.fy, o.fz, o.solid, o.code, o.res, a.toFixed(3), b.toFixed(3), moving ? Math.floor(t * 30) : 0])
  if (key === mesh.userData.shapeKey) return
  mesh.userData.shapeKey = key
  const made = mathShape(o, t, a, b)
  if (typeof made === 'string') {
    mesh.userData.err = made
    return
  }
  if (!made) return
  mesh.userData.err = ''
  mesh.geometry.dispose()
  mesh.geometry = made
}
export function shapeError(id: string): string {
  const m = objects.get(id)?.obj as THREE.Mesh | undefined
  return String(m?.userData.err ?? '')
}

// ---- pictures on objects ----

function pictureTexture(mesh: THREE.Mesh, o: Obj3D, t: number): THREE.Texture | null {
  const pic = usePicture(o.picture || 'Create')
  if (!pic || pic.canvas.width < 4) return null
  let tex = mesh.userData.tex as THREE.CanvasTexture | undefined
  const c = pic.canvas
  if (!tex || tex.image !== c || mesh.userData.texW !== c.width || mesh.userData.texH !== c.height) {
    tex?.dispose()
    tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    mesh.userData.tex = tex
    mesh.userData.texW = c.width
    mesh.userData.texH = c.height
  }
  if (mesh.userData.texV !== pic.version) {
    mesh.userData.texV = pic.version
    tex.needsUpdate = true
  }
  const rep = Math.max(0.01, o.uvScale ?? 1)
  tex.repeat.set(rep, rep)
  tex.offset.x = (t * linked(o, 'uvSpeed', o.uvSpeed ?? 0)) % 1
  return tex
}

const SHADER_VERT = `varying vec2 vUv; varying vec3 vNormal; varying vec3 vPos;
void main() { vUv = uv; vNormal = normalize(normalMatrix * normal); vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`

const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1)
blank.needsUpdate = true

// The layers of a custom (or iridescent) material, or null.
function layersOf(o: Obj3D, w: World3D = getWorld()): MatLayer[] | null {
  if (o.material === 'iridescent') return filmLayers(o)
  if (o.material === 'custom') return w.materials?.find((m) => m.id === o.matId)?.layers ?? []
  return null
}

function material(o: Obj3D): THREE.Material {
  const color = new THREE.Color(o.color)
  switch (o.material) {
    case 'custom':
      return layeredMaterial(layersOf(o) ?? [], { color, roughness: o.roughness, metalness: o.metalness, emissive: color, emissiveIntensity: o.glow, clearcoat: 0.3, side: THREE.DoubleSide })
    case 'picture':
      return new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: o.roughness, metalness: o.metalness, emissive: 0xffffff, emissiveIntensity: o.glow, side: THREE.DoubleSide })
    case 'shader':
      lastShaderError = ''
      return new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uA: { value: 0 }, uB: { value: 0 }, uPicture: { value: blank }, uColor: { value: color } },
        vertexShader: SHADER_VERT,
        fragmentShader: `uniform float uTime; uniform float uA; uniform float uB; uniform sampler2D uPicture; uniform vec3 uColor;
varying vec2 vUv; varying vec3 vNormal; varying vec3 vPos;
void main() { vec3 col = uColor; float alpha = 1.0;
${o.shader || DEFAULT_SHADER}
gl_FragColor = vec4(col, alpha); }`,
        transparent: true, side: THREE.DoubleSide,
      })
    case 'iridescent':
      return layeredMaterial(filmLayers(o), { color, roughness: o.roughness, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05, iridescence: 0.5, iridescenceIOR: 1.5, emissive: color, emissiveIntensity: o.glow })
    case 'glass':
      return new THREE.MeshPhysicalMaterial({ color, roughness: Math.min(0.2, o.roughness), metalness: 0, transmission: 1, thickness: 1.2, ior: 1.5, dispersion: 3, emissive: color, emissiveIntensity: o.glow * 0.3 })
    case 'chrome':
      return new THREE.MeshStandardMaterial({ color, roughness: 0.05, metalness: 1, emissive: color, emissiveIntensity: o.glow * 0.2 })
    case 'wire':
      return new THREE.MeshBasicMaterial({ color, wireframe: true })
    case 'glow':
      return new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: 1 + o.glow, toneMapped: false })
    case 'normal':
      return new THREE.MeshNormalMaterial()
    case 'toon':
      return new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(o.toonSteps ?? 3), emissive: color, emissiveIntensity: o.glow * 0.3 })
    default:
      return new THREE.MeshStandardMaterial({ color, roughness: o.roughness, metalness: o.metalness, emissive: color, emissiveIntensity: o.glow })
  }
}

function build(o: Obj3D): THREE.Object3D {
  if (o.kind === 'point-light') {
    const l = new THREE.PointLight(o.color, o.intensity, 0, 2)
    l.castShadow = true
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 8), new THREE.MeshBasicMaterial({ color: o.color }))
    bulb.userData.helper = true
    l.add(bulb)
    return l
  }
  if (o.kind === 'spot-light') {
    const l = new THREE.SpotLight(o.color, o.intensity, 0, Math.PI / 6, 0.4, 2)
    l.castShadow = true
    l.target.position.set(0, 0, 0)
    if (o.fixture) {
      // a lighting desk fixture: a head you can click, and a beam you can see
      l.add(l.target)
      l.target.position.set(0, -1, 0)
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.28, 20), new THREE.MeshStandardMaterial({ color: 0x1a1d20, roughness: 0.6, metalness: 0.4 }))
      head.name = 'head'
      l.add(head)
      const beam = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 40, 1, true).translate(0, -0.5, 0), new THREE.MeshBasicMaterial({ color: o.color, transparent: true, opacity: 0.15, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }))
      beam.name = 'beam'
      beam.userData.helper = true
      l.add(beam)
    }
    return l
  }
  if (o.kind === 'sun') {
    const l = new THREE.DirectionalLight(o.color, o.intensity)
    l.castShadow = true
    l.shadow.mapSize.set(2048, 2048)
    l.shadow.camera.left = l.shadow.camera.bottom = -10
    l.shadow.camera.right = l.shadow.camera.top = 10
    return l
  }
  if (o.kind === 'model') {
    const group = new THREE.Group()
    if (o.model) {
      const own = o.ownMaterials ?? o.modelType !== 'obj'
      loadModel(o.model, o.modelType ?? 'glb').then(({ root, clips }) => {
        const mat = own ? null : material(o)
        // every mesh in the file is a part you can pick in the scene list
        const parts: PartInfo[] = []
        let n = 0
        root.traverse((c) => {
          const m = c as THREE.Mesh
          if (!m.isMesh) return
          m.castShadow = true; m.receiveShadow = true
          if (mat) m.material = mat
          let depth = 0
          for (let p = m.parent; p && p !== root; p = p.parent) depth++
          const key = `${n++}:${m.name || 'Part'}`
          m.userData.part = key
          m.userData.own = m.material
          const mm = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.Material
          parts.push({ key, name: m.name || `Part ${n}`, depth, material: mm?.name || '', tris: Math.round((m.geometry.index?.count ?? m.geometry.getAttribute('position')?.count ?? 0) / 3) })
        })
        setParts(o.id, parts)
        // bones from the file, for posing
        const bones = new Map<string, THREE.Bone>()
        root.traverse((c) => { const b = c as THREE.Bone; if (b.isBone) bones.set(b.name || `Bone ${bones.size + 1}`, b) })
        group.userData.bones = bones
        setBones(o.id, [...bones.keys()])
        group.add(root)
        if (clips.length) {
          group.userData.mixer = new THREE.AnimationMixer(root)
          group.userData.clips = clips
        }
        setAnimations(o.id, clips.map((c) => c.name || 'Animation'))
        group.userData.loaded = true
      }).catch(() => { group.userData.err = 'This model did not open.' })
    }
    return group
  }
  if (o.kind === 'fluid') return buildFluid(o, material(o))
  if (o.kind === 'fog') {
    const fog = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), fogMaterial())
    fog.userData.fog = true
    fog.renderOrder = 50
    fog.frustumCulled = false
    return fog
  }
  const mesh = new THREE.Mesh(o.kind === 'mesh' && o.mesh ? toGeometry(o.mesh) : o.kind === 'comic' ? comicGeometry({ ...COMIC_DEFAULT, ...o.comic }) : o.kind === 'text' ? new THREE.BufferGeometry() : geometry(o.kind), material(o))
  if (o.kind === 'text') {
    // the letters come from the font file, a moment later
    void textGeometry({ ...TEXT_DEFAULT, ...o.text3d }).then((g) => {
      if (typeof g === 'string') { mesh.userData.err = g; return }
      mesh.geometry.dispose()
      mesh.geometry = g
    })
  }
  if (o.kind === 'shape' || o.kind === 'math-surface' || o.kind === 'math-solid' || o.kind === 'code-shape') {
    ;(mesh.material as THREE.Material).side = THREE.DoubleSide
    liveShape(o, mesh, 0)
  }
  mesh.castShadow = o.kind !== 'plane'
  mesh.receiveShadow = true
  return mesh
}

// A model's parts, every frame: shown or hidden, their own look, RICO layers
// added on top or a RICO material instead, and their outlines and strokes.
function modelParts(o: Obj3D, root: THREE.Object3D, w: World3D, t: number) {
  const ownFile = o.ownMaterials ?? o.modelType !== 'obj'
  // My material picked in the main Material list goes on every part too
  const all = o.parts?.['*']?.matId ? o.parts['*'] : o.material === 'custom' && o.matId ? { ...(o.parts?.['*'] ?? {}), mode: 'add' as const, matId: o.matId } : o.parts?.['*'] ?? {}
  // a RICO material that moves (iridescent) on every part, instead of the file's
  const sharedLayers = !ownFile && o.material === 'iridescent' ? filmLayers(o) : null
  root.traverse((c) => {
    const m = c as THREE.Mesh
    if (!m.isMesh || !m.userData.part) return
    const p = { ...all, ...(o.parts?.[m.userData.part as string] ?? {}) }
    m.visible = !p.hidden
    const def = p.matId ? w.materials?.find((x) => x.id === p.matId) : undefined
    const mode = def ? p.mode ?? 'add' : 'own'
    const own = m.userData.own as THREE.Material | THREE.Material[]
    const layers = def?.layers ?? []
    const key = `${mode}|${def?.id ?? ''}|${structureOf(layers)}|${p.color ?? ''}`
    if (m.userData.lookKey !== key) {
      const old = m.userData.look as THREE.Material | undefined
      if (old) old.dispose()
      m.userData.lookKey = key
      if (mode === 'own') { m.userData.look = undefined; m.material = own }
      else {
        const base = Array.isArray(own) ? own[0] : own
        const look = mode === 'add'
          ? installLayers(asStandard(base), layers)
          : layeredMaterial(layers, { color: new THREE.Color(p.color ?? o.color), roughness: o.roughness, metalness: o.metalness, side: THREE.DoubleSide })
        if (mode === 'add' && p.color) look.color.set(p.color)
        m.userData.look = look
        m.material = look
      }
    }
    const look = m.userData.look as THREE.Material | undefined
    if (!look && sharedLayers && (m.material as THREE.Material).userData?.layerUniforms) {
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox()
      const bb = m.geometry.boundingBox!
      updateLayers(m.material as THREE.Material, sharedLayers, t, linked(o, 'filmShift', 0), [bb.min.y, bb.max.y], { sizeMul: linked(o, 'lookSize', 1), thickMul: linked(o, 'lookThick', 1) }, linked(o, 'drive', 1), linked(o, 'boil', 0))
    }
    if (look) {
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox()
      const bb = m.geometry.boundingBox!
      updateLayers(look, layersWithKeys(o.id, layers), t, linked(o, 'filmShift', 0), [bb.min.y, bb.max.y], {
        normals: p.normals, center: [(bb.min.x + bb.max.x) / 2, (bb.min.y + bb.max.y) / 2, (bb.min.z + bb.max.z) / 2], steps: p.steps ?? o.lightSteps ?? 0, sizeMul: linked(o, 'lookSize', 1), thickMul: linked(o, 'lookThick', 1),
      }, linked(o, 'drive', 1), linked(o, 'boil', 0))
    }
    // roughness and metal for this part (also on the look it came with)
    for (const mt of (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[]) {
      if (p.roughness !== undefined && 'roughness' in mt) mt.roughness = p.roughness
      else if (look && mt === look) mt.roughness = o.roughness
      if (p.metalness !== undefined && 'metalness' in mt) mt.metalness = p.metalness
    }
    // the part's own outline and strokes (or the model's, for every part)
    outlines({ ...o, material: 'standard', outline: p.outline }, m, t)
  })
}

// Things that need a rebuild when they change, versus things set every frame.
const signature = (o: Obj3D, w: World3D) => {
  const layers = o.material === 'custom' ? layersOf(o, w) ?? [] : []
  return `${o.kind}|${o.material}|${o.model?.length ?? 0}|${o.model?.slice(-32) ?? ''}|${o.material === 'shader' ? o.shader ?? '' : ''}|${structureOf(layers)}|${o.toonSteps ?? 3}|${o.meshRev ?? 0}|${o.modelType ?? ''}|${o.ownMaterials ?? ''}|${o.kind === 'text' ? JSON.stringify(o.text3d) : o.kind === 'comic' ? JSON.stringify(o.comic) : ''}|${o.kind === 'text' ? fontsVersion() : 0}|${o.kind === 'model' && !(o.ownMaterials ?? o.modelType !== 'obj') ? o.material : ''}|${o.kind === 'fluid' ? JSON.stringify(o.fluid) : ''}`
}

function apply(o: Obj3D, obj: THREE.Object3D) {
  obj.visible = o.visible
  obj.userData.owner = o.id
  const mesh = obj as THREE.Mesh
  if (mesh.isMesh) {
    const m = mesh.material as THREE.MeshStandardMaterial & { color?: THREE.Color }
    if (m.color && o.material !== 'glow' && o.material !== 'normal' && o.material !== 'picture') m.color.set(o.color)
    if (m.emissive && o.material !== 'picture' && o.material !== 'normal') m.emissive.set(o.color)
    if ('roughness' in m && o.material !== 'chrome') m.roughness = o.material === 'glass' ? Math.min(0.2, o.roughness) : o.roughness
    if ('metalness' in m && o.material === 'standard') m.metalness = o.metalness
  }
  const l = obj as THREE.Light
  if (l.isLight) l.color.set(o.color)
}

function sync(w: World3D) {
  const live = new Set<string>()
  for (const o of w.objects) {
    live.add(o.id)
    let entry = objects.get(o.id)
    const sig = signature(o, w)
    if (!entry || entry.sig !== sig) {
      if (entry) dispose(entry.obj)
      const obj = build(o)
      scene.add(obj)
      entry = { obj, sig }
      objects.set(o.id, entry)
    }
    apply(o, entry.obj)
  }
  for (const [id, e] of objects) {
    if (!live.has(id)) {
      dispose(e.obj)
      objects.delete(id)
    }
  }
  applyEnv(w)
  const sel = getSelected3d()
  const target = sel ? objects.get(sel)?.obj : undefined
  if (pivotFor && sel !== pivotFor) editPivot(false)
  else if (pivotFor && !gizmo.dragging) {
    // the object moved some other way: the handle stays on its pivot
    const po = w.objects.find((x) => x.id === pivotFor)
    if (po) pivotHandle.position.set(po.position[0], po.position[1], po.position[2])
  }
  if (!gizmoLocked) {
    if (target && target !== gizmo.object) gizmo.attach(target)
    if (!target && gizmo.object) gizmo.detach()
  }
  syncExtras()
}

// The world's sky, light from around, fog, shadows, grid and camera range.
function applyEnv(w: World3D) {
  const e = envOf(w)
  const sk = `${e.sky}|${e.skyTop}|${e.skyBottom}|${w.background}`
  if (sk !== skyKey) {
    skyKey = sk
    const old = scene.background
    if (old && (old as THREE.Texture).isTexture) (old as THREE.Texture).dispose()
    if (e.sky === 'gradient') {
      const c = document.createElement('canvas')
      c.width = 2; c.height = 256
      const g = c.getContext('2d')!
      const gr = g.createLinearGradient(0, 0, 0, 256)
      gr.addColorStop(0, e.skyTop); gr.addColorStop(1, e.skyBottom)
      g.fillStyle = gr; g.fillRect(0, 0, 2, 256)
      const t = new THREE.CanvasTexture(c)
      t.colorSpace = THREE.SRGBColorSpace
      scene.background = t
    } else scene.background = e.sky === 'transparent' ? null : new THREE.Color(w.background)
  }
  const fogColor = e.fogColor || (e.sky === 'gradient' ? e.skyBottom : w.background)
  scene.fog = e.fogKind === 'linear'
    ? (w.fog > 0 ? new THREE.Fog(fogColor, e.fogNear, e.fogFar) : null)
    : (w.fog > 0 ? new THREE.FogExp2(fogColor, w.fog) : null)
  if (e.envLight === 'none') scene.environment = null
  else {
    if (!envTextures[e.envLight]) envTextures[e.envLight] = pmrem.fromScene(new RoomEnvironment(), e.envLight === 'soft' ? 0.35 : 0.04).texture
    scene.environment = envTextures[e.envLight]
  }
  scene.environmentIntensity = e.envIntensity
  scene.environmentRotation.set(0, (e.envTurn * Math.PI) / 180, 0)
  hemi.intensity = e.ambient
  hemi.color.set(e.ambientSky)
  hemi.groundColor.set(e.ambientGround)
  renderer.shadowMap.enabled = e.shadows
  const st = e.shadowSoft === 'hard' ? THREE.BasicShadowMap : e.shadowSoft === 'very-soft' ? THREE.VSMShadowMap : THREE.PCFSoftShadowMap
  if (renderer.shadowMap.type !== st) { renderer.shadowMap.type = st; renderer.shadowMap.needsUpdate = true }
  scene.traverse((o) => { const l = o as THREE.DirectionalLight; if (l.isLight && l.shadow && l.shadow.mapSize.x !== e.shadowSize) { l.shadow.mapSize.set(e.shadowSize, e.shadowSize); l.shadow.map?.dispose(); l.shadow.map = null as unknown as THREE.WebGLRenderTarget } })
  const gk = `${e.gridSize}|${e.gridColor}`
  if (gk !== gridKey) {
    gridKey = gk
    scene.remove(gridNow)
    gridNow.geometry.dispose()
    const col = new THREE.Color(e.gridColor)
    gridNow = new THREE.GridHelper(e.gridSize, Math.max(2, Math.round(e.gridSize * 2)), col.clone().lerp(new THREE.Color('#ffffff'), 0.35), col.clone().multiplyScalar(0.7))
    ;(gridNow.material as THREE.Material).transparent = true
    ;(gridNow.material as THREE.Material).opacity = 0.75
    scene.add(gridNow)
  }
  gridNow.visible = w.grid
  camera.near = e.near; camera.far = e.far
  orbit.autoRotate = e.autoTurn !== 0
  orbit.autoRotateSpeed = e.autoTurn
  orbit.dampingFactor = Math.max(0.01, e.damping)
}

function dispose(obj: THREE.Object3D) {
  for (const g of allGizmos) if (g.object === obj) g.detach()
  obj.traverse((c) => { if (c.userData.fluid) dropFluid(c.userData.fluid as string) })
  const ol = obj.userData.outline as OutlineBuilt | undefined
  if (ol) disposeOutline(ol)
  scene.remove(obj)
  obj.traverse((c) => {
    const m = c as THREE.Mesh
    if (!m.userData.shared) m.geometry?.dispose()
    ;(m.userData.tex as THREE.Texture | undefined)?.dispose()
    const mat = m.material as THREE.Material | THREE.Material[] | undefined
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
    else mat?.dispose()
  })
}

// ---- every frame ---------------------------------------------------------------

const DEG = Math.PI / 180
const smooth = new Map<string, number>()
function linked(o: Obj3D, key: string, base: number): number {
  const d = driven.get(`3d:${o.id}.${key}`)
  if (d !== undefined) return d
  const b = o.bindings[key]
  if (!b?.signal) return base
  const raw = Math.max(0, Math.min(1, readSignal(b.signal)))
  const id = `${o.id}.${key}`
  const prev = smooth.get(id) ?? raw
  const v = prev * b.smooth + raw * (1 - b.smooth)
  smooth.set(id, v)
  return b.min + v * (b.max - b.min)
}

// Picture textures for material layers, by picture name.
const layerPics = new Map<string, { tex: THREE.CanvasTexture; v: number; c: HTMLCanvasElement }>()
function picTex(name: string): THREE.Texture | null {
  const pic = usePicture(name || 'Create')
  if (!pic || pic.canvas.width < 4) return null
  let e = layerPics.get(name)
  if (!e || e.c !== pic.canvas) {
    e?.tex.dispose()
    const tex = new THREE.CanvasTexture(pic.canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    e = { tex, v: -1, c: pic.canvas }
    layerPics.set(name, e)
  }
  if (e.v !== pic.version) { e.v = pic.version; e.tex.needsUpdate = true }
  return e.tex
}

// Cartoon outlines (and outlines on any material when turned on).
function outlines(o: Obj3D, mesh: THREE.Mesh, t: number, cam: THREE.Camera = camera) {
  const want = o.outline ? o.outline.on : o.material === 'toon'
  const ol = outlineOf(o.outline)
  const has = Boolean(mesh.geometry.getAttribute('position')?.count)
  // A linked "boil" redraws the lines when the signal jumps (a beat, a pad).
  const tb = t + Math.floor(linked(o, 'boil', 0) * 8) * 37.3
  let b = mesh.userData.outline as OutlineBuilt | undefined
  if (!want || !has || ol.hull === false) {
    if (b) { mesh.remove(b.group); disposeOutline(b); mesh.userData.outline = undefined }
  } else {
    const key = outlineKey(mesh, ol)
    if (b && b.key !== key) { mesh.remove(b.group); disposeOutline(b); b = undefined }
    if (!b) { b = buildOutline(mesh, ol); b.key = key; mesh.add(b.group); mesh.userData.outline = b }
    updateOutline(b, ol, tb, renderSize)
  }
  let f = mesh.userData.floating as Floating | undefined
  let c = mesh.userData.contour as ContourBuilt | undefined
  const strokes = Math.max(1, Math.min(5, Math.round(ol.strokes ?? 2)))
  const contourOn = want && has && ol.floating && (ol.floatMode ?? 'contour') === 'contour'
  if (c && (!contourOn || c.key !== mesh.geometry.uuid)) { mesh.remove(c.group); disposeContour(c); mesh.userData.contour = c = undefined }
  if (contourOn) {
    if (!c) { c = buildContour(mesh); mesh.add(c.group); mesh.userData.contour = c }
    updateContour(c, mesh, ol, cam, tb, renderSize)
  }
  if (!want || !has || !ol.floating || contourOn) {
    if (f) { mesh.remove(f.group); disposeFloating(f); mesh.userData.floating = undefined }
    return
  }
  if (f && f.lines.length !== strokes) { mesh.remove(f.group); disposeFloating(f); f = undefined }
  if (!f) { f = buildFloating(strokes); mesh.add(f.group); mesh.userData.floating = f }
  updateFloating(f, mesh, ol, cam, tb, renderSize)
}


let lastAnim = performance.now()
let clock = 0
function animate(now: number) {
  // the world's own clock: Time speed slows it down, speeds it up or stops it
  const scale = envOf(getWorld()).timeScale
  const dt = Math.min(0.1, Math.max(0, (now - lastAnim) / 1000)) * scale
  lastAnim = now
  clock += dt
  const t = clock
  const w = getWorld()
  // floors for drips to land on
  const fl: THREE.Box3[] = []
  for (const x of w.objects) if (x.kind === 'plane' && x.visible !== false) { const fo = objects.get(x.id)?.obj; if (fo) fl.push(new THREE.Box3().setFromObject(fo)) }
  setSymbioteFloors(fl)
  for (const o0 of w.objects) {
    const e = objects.get(o0.id)
    if (!e) continue
    // with the timeline's keys on its deformers, physics, liquid and fog
    const o = withKeys(o0)
    const obj = e.obj
    if (gizmoDragging() && gizmo.object === obj) continue
    if (simHides(o.id)) obj.visible = false
    if (!simOwns(o.id)) obj.position.set(linked(o, 'position.x', o.position[0]), linked(o, 'position.y', o.position[1]), linked(o, 'position.z', o.position[2]))
    const spin = linked(o, 'spin', o.spin)
    if (!simOwns(o.id)) obj.rotation.set(linked(o, 'rotation.x', o.rotation[0]) * DEG, linked(o, 'rotation.y', o.rotation[1]) * DEG + t * spin * Math.PI / 30, linked(o, 'rotation.z', o.rotation[2]) * DEG)
    const s = linked(o, 'scale', 1)
    obj.scale.set(o.scale[0] * s, o.scale[1] * s, o.scale[2] * s)
    if (!isLight(o.kind)) applyPivot(o, obj)
    // Model animations: play, or follow a link (Animation position).
    const mixer = obj.userData.mixer as THREE.AnimationMixer | undefined
    if (mixer) {
      const clips = obj.userData.clips as THREE.AnimationClip[]
      const want = o.anim === undefined ? clips[0]?.name ?? '' : o.anim
      if (obj.userData.animName !== want) {
        mixer.stopAllAction()
        obj.userData.animName = want
        const clip = clips.find((c) => (c.name || 'Animation') === want)
        obj.userData.action = clip ? mixer.clipAction(clip).play() : null
      }
      const action = obj.userData.action as THREE.AnimationAction | null
      if (action) {
        if (o.bindings.animPos) { action.time = Math.max(0, Math.min(1, linked(o, 'animPos', o.animPos ?? 0))) * action.getClip().duration; mixer.update(0) }
        else if (dt > 0.0005) mixer.update(dt * linked(o, 'animSpeed', o.animSpeed ?? 1))
      }
    }
    // your pose, on top of the animation
    const bones = obj.userData.bones as Map<string, THREE.Bone> | undefined
    if (bones && o.pose) for (const [name, r] of Object.entries(o.pose)) { const b = bones.get(name); if (b && !(gizmoDragging() && allGizmos.some((g) => g.object === b))) b.rotation.set(r[0] * DEG, r[1] * DEG, r[2] * DEG) }
    if (o.kind === 'model' && obj.userData.loaded) modelParts(o, obj, w, t)
    rigObject(obj, o, t, linked(o, 'deform', 1), linked(o, 'morph', o.morph?.amount ?? 0), (id) => objects.get(id)?.obj, () => symbioteNeighbours(w, o.id))
    const mesh = obj as THREE.Mesh
    if (mesh.isMesh) {
      liveShape(o, mesh, t)
      const own = layersOf(o, w)
      const layers = own ? layersWithKeys(o.id, own) : null
      if (layers) {
        const needPaint = Boolean(o.paintMaps && Object.keys(o.paintMaps).length) || layers.some((l) => l.on && (l.kind === 'paint' || l.mask === 'paint' || l.mask === 'paint-inverse'))
        const paint = needPaint || hasPaint(o.id) ? paintOf(o) : null
        const pm = mesh.material as THREE.MeshPhysicalMaterial
        const glass = paint?.tex('glass') ?? null
        // Painted glass: the material lets light through, and the shader keeps it to where you painted.
        if ((pm.userData.glassOn ?? false) !== Boolean(glass)) { pm.userData.glassOn = Boolean(glass); pm.transmission = glass ? 1 : 0; pm.thickness = 0.4; pm.needsUpdate = true }
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
        const bb = mesh.geometry.boundingBox
        updateLayers(mesh.material as THREE.Material, layers, t, linked(o, 'filmShift', 0), [bb?.min.y ?? -1, bb?.max.y ?? 1], {
          paint: paint?.colorTex, mask: paint?.maskTex,
          pics: layers.filter((l) => l.on && l.kind === 'picture').map((l) => picTex(l.picture ?? 'Create')),
          rough: paint?.tex('rough'), metal: paint?.tex('metal'), glow: paint?.tex('glow'), bump: paint?.tex('bump'), glass,
          box: paint?.box ?? null, tri: o.kind === 'mesh', normals: o.normals, steps: o.lightSteps ?? 0, sizeMul: linked(o, 'lookSize', 1), thickMul: linked(o, 'lookThick', 1),
          center: bb ? [(bb.min.x + bb.max.x) / 2, (bb.min.y + bb.max.y) / 2, (bb.min.z + bb.max.z) / 2] : [0, 0, 0],
        }, linked(o, 'drive', 1), linked(o, 'boil', 0))
      }
      outlines(o, mesh, t)
      const arms = symbioteMesh(obj)
      // the tendrils get the solid outline only: loose strokes on thin tubes look like scribbles
      if (arms?.visible) outlines(o.outline ? { ...o, outline: { ...o.outline, floating: false } } : o, arms, t)
      if (o.material === 'picture') {
        const pm = mesh.material as THREE.MeshStandardMaterial
        const tex = pictureTexture(mesh, o, t)
        if (pm.map !== tex) { pm.map = tex; pm.emissiveMap = tex; pm.needsUpdate = true }
      }
      if (o.material === 'shader') {
        const u = (mesh.material as THREE.ShaderMaterial).uniforms
        u.uTime.value = t
        u.uA.value = linked(o, 'a', o.a ?? 0)
        u.uB.value = linked(o, 'b', o.b ?? 0)
        ;(u.uColor.value as THREE.Color).set(o.color).offsetHSL(linked(o, 'hue', 0), 0, 0)
        u.uPicture.value = /uPicture/.test(o.shader || DEFAULT_SHADER) ? pictureTexture(mesh, o, t) ?? blank : blank
      }
      const m = mesh.material as THREE.MeshStandardMaterial
      if (m.emissive && o.material !== 'glow') m.emissiveIntensity = linked(o, 'glow', o.glow) * (o.material === 'glass' ? 0.3 : 1)
      const hue = linked(o, 'hue', 0)
      if (hue && m.color && o.material !== 'normal') m.color.set(o.color).offsetHSL(hue, 0, 0)
    }
    const l = obj as THREE.Light
    if (l.isLight) l.intensity = linked(o, 'intensity', o.intensity)
    if (o.fixture) playFixture(obj as THREE.SpotLight, o, now)
  }
  stepSim(dt, w, objects, scene)
}

// A 3D twin of a desk fixture plays what the desk sends: color, intensity,
// zoom, strobe, and where pan and tilt point it.
const UP_Y = new THREE.Vector3(0, -1, 0)
function playFixture(l: THREE.SpotLight, o: Obj3D, now: number) {
  const f = getDesk().fixtures.find((x) => x.id === o.fixture)
  const beam = l.getObjectByName('beam') as THREE.Mesh | undefined
  const head = l.getObjectByName('head') as THREE.Mesh | undefined
  if (!f) { l.intensity = 0; if (beam) beam.visible = false; return }
  startDesk()
  const L = latestLooks()[f.id] ?? {}
  const d = getDesk()
  const master = d.blackout ? 0 : d.master
  const strobe = (L.strobe ?? 0) > 0.05 && Math.floor(now / (60 + (1 - (L.strobe ?? 0)) * 200)) % 2 === 0
  const dim = strobe ? 0 : (L.dim ?? 0) * master
  l.color.set(L.color ?? '#ffffff')
  l.intensity = o.intensity * dim
  l.angle = Math.PI / 24 + (L.zoom ?? 0.5) * (Math.PI / 5)
  const dir = new THREE.Vector3(...beamDir(f, L.pan ?? 0.5, L.tilt ?? 0.5)).normalize()
  l.target.position.copy(dir)
  if (beam) {
    const len = 9, r = Math.tan(l.angle) * len
    beam.visible = dim > 0.01
    beam.scale.set(r, len, r)
    beam.quaternion.setFromUnitVectors(UP_Y, dir)
    const bm = beam.material as THREE.MeshBasicMaterial
    bm.color.set(L.color ?? '#ffffff')
    bm.opacity = 0.05 + dim * 0.22
  }
  if (head) head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().negate())
}

// ---- size and drawing -------------------------------------------------------------

let width = 1280, height = 720
let viewers = 0
let layerUsers = false

export function setViewSize(w: number, h: number) {
  width = Math.max(64, Math.round(w))
  height = Math.max(64, Math.round(h))
}

function draw() {
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const w = Math.round(width * dpr), h = Math.round(height * dpr)
  if (canvas3d.width !== w || canvas3d.height !== h) renderer.setSize(w, h, false)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  orbit.update()
  renderSize.set(w, h)
  const world = getWorld()
  const e = envOf(world)
  renderer.toneMappingExposure = world.exposure ?? 1
  const tm = { aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping, neutral: THREE.NeutralToneMapping, reinhard: THREE.ReinhardToneMapping, cineon: THREE.CineonToneMapping, linear: THREE.LinearToneMapping }[e.toneMap] ?? THREE.ACESFilmicToneMapping
  if (renderer.toneMapping !== tm) renderer.toneMapping = tm
  if (e.renderScale !== 1) { const rw = Math.round(width * dpr * e.renderScale), rh = Math.round(height * dpr * e.renderScale); if (canvas3d.width !== rw) renderer.setSize(rw, rh, false); renderSize.set(rw, rh) }
  animate(performance.now())
  fogPass(world, renderSize.x, renderSize.y)
  const b = world.bloom
  const fin = e.vignette > 0 || e.grain > 0 || e.aberration > 0 || e.saturation !== 1 || e.contrast !== 1 || e.warmth !== 0 || e.scanlines > 0 || e.pixelate > 0
  if (b?.on || e.dof || fin) {
    composer.setPixelRatio(1)
    composer.setSize(renderSize.x, renderSize.y)
    bloom.enabled = Boolean(b?.on)
    if (b?.on) { bloom.strength = b.strength; bloom.radius = b.radius; bloom.threshold = b.threshold }
    bokeh.enabled = e.dof
    if (e.dof) { const u = (bokeh as unknown as { uniforms: Record<string, { value: number }> }).uniforms; u.focus.value = e.focus; u.aperture.value = e.aperture; u.maxblur.value = e.maxBlur }
    finish.enabled = fin
    const fu = finish.uniforms
    fu.uRes.value.set(renderSize.x, renderSize.y); fu.uTime.value = performance.now() / 1000
    fu.uVig.value = e.vignette; fu.uGrain.value = e.grain; fu.uAb.value = e.aberration; fu.uSat.value = e.saturation; fu.uCon.value = e.contrast; fu.uWarm.value = e.warmth; fu.uScan.value = e.scanlines; fu.uPix.value = e.pixelate
    composer.render()
  } else renderer.render(scene, camera)
}

// Fog volumes need to know how far away the things behind them are: draw
// the scene's depth first (without the fog), at half size.
let depthRT: THREE.WebGLRenderTarget | null = null
function fogPass(world: World3D, w: number, h: number) {
  const fogs: { o: Obj3D; mesh: THREE.Mesh }[] = []
  for (const o of world.objects) {
    if (o.kind !== 'fog' || !o.visible) continue
    const e = objects.get(o.id)
    if (e) fogs.push({ o, mesh: e.obj as THREE.Mesh })
  }
  if (!fogs.length) return
  const dw = Math.max(16, Math.round(w / 2)), dh = Math.max(16, Math.round(h / 2))
  if (!depthRT || depthRT.width !== dw || depthRT.height !== dh) {
    depthRT?.dispose()
    depthRT = new THREE.WebGLRenderTarget(dw, dh, { depthTexture: new THREE.DepthTexture(dw, dh) })
  }
  for (const f of fogs) f.mesh.visible = false
  const showGizmo = gizmoHelper.visible, showGrid = gridNow.visible
  gizmoHelper.visible = false
  gridNow.visible = false
  renderer.setRenderTarget(depthRT)
  renderer.render(scene, camera)
  renderer.setRenderTarget(null)
  gizmoHelper.visible = showGizmo
  gridNow.visible = showGrid
  for (const f of fogs) f.mesh.visible = true
  // The sun and the first lights, for the glow in the fog.
  const sun = world.objects.find((o) => o.kind === 'sun' && o.visible)
  const sunDir = new THREE.Vector3(...(sun?.position ?? [0, 1, 0])).normalize()
  const sunColor = new THREE.Color(sun ? sun.color : '#000000').multiplyScalar(sun ? sun.intensity * 0.3 : 0)
  const lights = world.objects.filter((o) => (o.kind === 'point-light' || o.kind === 'spot-light') && o.visible).slice(0, 4).map((o) => {
    const ob = objects.get(o.id)?.obj
    return { pos: ob ? ob.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(...o.position), color: new THREE.Color(o.color).multiplyScalar(linked(o, 'intensity', o.intensity) / 40) }
  })
  const t = clock
  for (const f of fogs) {
    const fv = { ...FOG_DEFAULT, ...(withKeys(f.o).fog ?? {}) }
    updateFog(f.mesh, fv, f.o.color, linked(f.o, 'fogDensity', fv.density), { depth: depthRT.depthTexture, res: new THREE.Vector2(w, h), camera, sunDir, sunColor, lights, t })
  }
}

let lastDraw = 0
// A "3D scene" layer in Create asks for the picture once per Create frame.
let lastT: number | null = null
setScene3dSource((t?: number | null) => {
  layerUsers = true
  const now = performance.now()
  const at = t ?? null
  if (now - lastDraw > 4 || at !== lastT) {
    lastT = at
    // a precomp: the 3D keys at its own time, just for this picture
    const saved: [string, number | undefined][] = []
    if (at !== null) {
      for (const tr of timelineOf(getCreate().scene).tracks) {
        if (!tr.target.startsWith('3d:')) continue
        const v = valueAt(tr, at)
        if (v === undefined) continue
        saved.push([tr.target, driven.get(tr.target)])
        driven.set(tr.target, v)
      }
    }
    // Hide helpers for the layer picture.
    const showGrid = gridNow.visible
    gridNow.visible = false
    gizmoHelper.visible = false
    draw()
    gridNow.visible = showGrid
    gizmoHelper.visible = true
    for (const [k, v] of saved) { if (v === undefined) driven.delete(k); else driven.set(k, v) }
    lastDraw = now
  }
  return canvas3d
})

function loop(now: number) {
  requestAnimationFrame(loop)
  if (viewers > 0 && now - lastDraw > 4) {
    draw()
    lastDraw = now
  }
  renderProjectors()
}

// ---- projection mapping: the scene seen from calibrated projectors ----------------
// A second renderer draws the same scene from each projector's real position
// and lens, into a picture an output surface can show ("3D from Output 1").
// Give objects the Picture material (Create, a node picture) to map content
// onto them.

let projRenderer: THREE.WebGLRenderer | null = null
const projCamera = new THREE.PerspectiveCamera()
projCamera.matrixAutoUpdate = false
let outputsCache: string[] = []
let outputsAt = 0
function renderProjectors() {
  const now = performance.now()
  if (now - outputsAt > 2000) { outputsCache = knownOutputs(); outputsAt = now }
  for (const id of outputsCache) {
    const name = projectorPicture(id)
    if (!pictureWanted(name)) continue
    const m = getMap(id)
    if (!m.solved) continue
    if (!projRenderer) {
      projRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true })
      projRenderer.toneMapping = THREE.ACESFilmicToneMapping
      projRenderer.shadowMap.enabled = true
      projRenderer.outputColorSpace = THREE.SRGBColorSpace
    }
    const [w, h] = m.res
    const cw = Math.min(3840, w), ch = Math.min(2160, h)
    const c = projRenderer.domElement
    if (c.width !== cw || c.height !== ch) projRenderer.setSize(cw, ch, false)
    const { view, proj } = glCamera(m.solved, w, h)
    projCamera.matrix.fromArray(view).invert()
    projCamera.matrixWorld.copy(projCamera.matrix)
    projCamera.matrixWorldInverse.fromArray(view)
    projCamera.projectionMatrix.fromArray(proj)
    projCamera.projectionMatrixInverse.copy(projCamera.projectionMatrix).invert()
    animate(now)
    const showGrid = gridNow.visible
    gridNow.visible = false
    gizmoHelper.visible = false
    projRenderer.toneMappingExposure = getWorld().exposure ?? 1
    // Fog volumes only draw in the main view (they need its depth picture).
    const fogs: THREE.Object3D[] = []
    for (const e of objects.values()) if (e.obj.userData.fog && e.obj.visible) { fogs.push(e.obj); e.obj.visible = false }
    projRenderer.render(scene, projCamera)
    for (const f of fogs) f.visible = true
    gridNow.visible = showGrid
    gizmoHelper.visible = true
    const pic = putPicture(name, `projector:${id}`)
    if (pic.canvas.width !== cw || pic.canvas.height !== ch) { pic.canvas.width = cw; pic.canvas.height = ch }
    pic.canvas.getContext('2d')?.drawImage(c, 0, 0)
    pic.version++
  }
}

// Calibration helpers: a point on an object under the mouse, and markers.
export function pickPoint(clientX: number, clientY: number): V3 | null {
  const r = canvas3d.getBoundingClientRect()
  const p = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1)
  raycaster.setFromCamera(p, camera)
  const hits = raycaster.intersectObjects([...objects.values()].map((e) => e.obj), true).filter((h) => !h.object.userData.helper)
  const h = hits[0]
  return h ? [h.point.x, h.point.y, h.point.z] : null
}
// The spot on the floor (y = 0) under the mouse, for tools that place things.
export function pickFloor(clientX: number, clientY: number): V3 | null {
  const r = canvas3d.getBoundingClientRect()
  raycaster.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), camera)
  const hit = new THREE.Vector3()
  return raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit) ? [hit.x, hit.y, hit.z] : null
}
let pointPicker: ((p: V3) => void) | null = null
export const setPointPicker = (fn: ((p: V3) => void) | null) => { pointPicker = fn; canvas3d.style.cursor = fn ? 'crosshair' : '' }
export const getPointPicker = () => pointPicker
const markers = new THREE.Group()
scene.add(markers)
export function setMarkers(points: V3[]) {
  markers.children.slice().forEach((c) => { markers.remove(c); ((c as THREE.Mesh).geometry as THREE.BufferGeometry).dispose() })
  const mat = new THREE.MeshBasicMaterial({ color: 0xf820a0, depthTest: false })
  points.forEach((p) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), mat)
    m.position.set(...p)
    m.renderOrder = 10
    m.userData.helper = true
    markers.add(m)
  })
}
requestAnimationFrame(loop)
void layerUsers

export function addViewer3d(on: boolean) {
  viewers = Math.max(0, viewers + (on ? 1 : -1))
}

// ---- tools --------------------------------------------------------------------------

// Which way the handles point: along the world, or along the object itself.
export type Space = 'world' | 'local'
let space: Space = (() => { try { return localStorage.getItem('rico.3d.space') === 'local' ? 'local' : 'world' } catch { return 'world' } })()
const spaceL = new Set<() => void>()
let spaceV = 0
for (const g of allGizmos) g.space = space
export function setGizmoSpace(s: Space) {
  space = s
  for (const g of allGizmos) g.space = s
  try { localStorage.setItem('rico.3d.space', s) } catch { /* not kept */ }
  spaceV++; spaceL.forEach((l) => l())
}
export const getGizmoSpace = () => space
export const onGizmoSpace = (l: () => void) => { spaceL.add(l); return () => { spaceL.delete(l) } }
export const gizmoSpaceVersion = () => spaceV

// Looks at the scene from one side (the axis ball in the corner of the view).
export function viewFrom(dir: [number, number, number]) {
  const d = camera.position.distanceTo(orbit.target) || 6
  const v = new THREE.Vector3(...dir).normalize()
  camera.position.copy(orbit.target).addScaledVector(v, d)
  camera.up.set(0, 1, 0)
  if (Math.abs(v.y) > 0.99) camera.position.x += 1e-3
  camera.lookAt(orbit.target)
  orbit.update()
}

// Posing a model: one of its bones gets the turn handles.
let poseBone: { id: string; name: string } | null = null
export const getPoseBone = () => poseBone
export function setPoseBone(p: { id: string; name: string } | null) {
  poseBone = p
  const bones = p ? (objects.get(p.id)?.obj.userData.bones as Map<string, THREE.Bone> | undefined) : undefined
  const b = p && bones ? bones.get(p.name) : undefined
  if (b) {
    gizmoLocked = true
    gizmo.detach(); gizmoS.detach()
    gizmoR.attach(b)
  } else {
    poseBone = null
    gizmoR.detach()
    gizmoLocked = false
    sync(getWorld())
  }
}
gizmoR.addEventListener('mouseUp', () => {
  if (!poseBone) return
  const b = gizmoR.object
  const o = getWorld().objects.find((x) => x.id === poseBone!.id)
  if (!b || !o) return
  updateObject(o.id, { pose: { ...(o.pose ?? {}), [poseBone.name]: [b.rotation.x / DEG, b.rotation.y / DEG, b.rotation.z / DEG] } }, 'Pose')
})

export type GizmoMode = 'translate' | 'rotate' | 'scale' | 'all'
export function setGizmoMode(m: GizmoMode) {
  setSnap('3d', { handles: m === 'translate' ? 'move' : m })
}
applySnap()

// What a symbiote can reach for: other solid things (not lights, fog or the floor).
function symbioteNeighbours(w: World3D, self: string): [string, THREE.Object3D][] {
  const out: [string, THREE.Object3D][] = []
  for (const x of w.objects) {
    if (x.id === self || isLight(x.kind) || x.kind === 'fog' || x.kind === 'plane' || x.visible === false) continue
    const e = objects.get(x.id)
    if (e) out.push([x.id, e.obj])
  }
  return out
}

// ---- the pivot: where an object turns, sizes and deforms from ----
// The shape is moved so the pivot is its own 0, and the object's position is
// where the pivot is. Shapes that are rebuilt (text, live shapes) get moved again.
function applyPivot(o: Obj3D, obj: THREE.Object3D) {
  const p = o.pivot ?? [0, 0, 0]
  const key = p.join()
  const m = obj as THREE.Mesh
  if (m.isMesh) {
    // a symbiote or a fluid shows its own surface: move the shape under it
    const g = (m.geometry?.userData.live && m.userData.fluidRest ? m.userData.fluidRest : m.geometry) as THREE.BufferGeometry
    if (!g || g.userData.live || !g.getAttribute('position')?.count) return
    const had = (g.userData.pivot as string | undefined) ?? '0,0,0'
    if (had === key) return
    const q = had.split(',').map(Number)
    // put the rest shape back first, so a bent shape is not moved bent
    const rig = g.userData.rig as { pos?: Float32Array } | undefined
    const arr = g.getAttribute('position').array as Float32Array
    if (rig?.pos && rig.pos.length === arr.length) arr.set(rig.pos)
    g.translate(q[0] - p[0], q[1] - p[1], q[2] - p[2])
    g.userData.pivot = key
    delete g.userData.rig
    return
  }
  // a model or a group: its parts move (also the ones that load later)
  for (const c of obj.children) {
    if (c.userData.helper || c.userData.outline || c.userData.symArm) continue
    const had = (c.userData.pivot as string | undefined) ?? '0,0,0'
    if (had === key) continue
    const q = had.split(',').map(Number)
    c.position.x += q[0] - p[0]; c.position.y += q[1] - p[1]; c.position.z += q[2] - p[2]
    c.userData.pivot = key
  }
}

/** The object's shape box in its own space, before the pivot moved it. */
export function objectBox(id: string): THREE.Box3 | null {
  const obj = objects.get(id)?.obj
  const o = getWorld().objects.find((x) => x.id === id)
  if (!obj || !o) return null
  obj.updateMatrixWorld(true)
  const inv = obj.matrixWorld.clone().invert()
  const box = new THREE.Box3()
  obj.traverse((c) => {
    const m = c as THREE.Mesh
    if (!m.isMesh || m.userData.helper) return
    for (let p = m.parent; p; p = p.parent) if (p.userData.helper) return
    const g = (m.userData.fluidRest as THREE.BufferGeometry | undefined) ?? m.geometry
    if (!g.boundingBox) g.computeBoundingBox()
    if (!g.boundingBox) return
    box.union(g.boundingBox.clone().applyMatrix4(inv.clone().multiply(m.matrixWorld)))
  })
  if (box.isEmpty()) return null
  const pv = o.pivot ?? [0, 0, 0]
  return box.translate(new THREE.Vector3(pv[0], pv[1], pv[2]))
}

/** Moves the pivot (in the object's own space) without moving the object. */
export function setPivot(id: string, pivot: [number, number, number], label = 'Pivot') {
  const o = getWorld().objects.find((x) => x.id === id)
  if (!o) return
  const old = o.pivot ?? [0, 0, 0]
  const d = new THREE.Vector3(pivot[0] - old[0], pivot[1] - old[1], pivot[2] - old[2])
  d.multiply(new THREE.Vector3(...o.scale)).applyEuler(new THREE.Euler(o.rotation[0] * DEG, o.rotation[1] * DEG, o.rotation[2] * DEG))
  updateObject(id, { pivot, position: [o.position[0] + d.x, o.position[1] + d.y, o.position[2] + d.z] }, label)
}

// Moving the pivot in the view (D): a small handle at the pivot.
const pivotHandle = new THREE.Group()
pivotHandle.userData.helper = true
pivotHandle.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.07), new THREE.MeshBasicMaterial({ color: 0xf820a0, depthTest: false })))
pivotHandle.add(new THREE.AxesHelper(0.35))
pivotHandle.renderOrder = 999
let pivotFor: string | null = null
const pivotLs = new Set<() => void>()
export const pivotEditing = () => pivotFor
export const onPivotEdit = (l: () => void) => { pivotLs.add(l); return () => { pivotLs.delete(l) } }
export function editPivot(on: boolean) {
  const id = getSelected3d()
  if (pivotFor && (!on || id !== pivotFor)) {
    gizmo.detach(); scene.remove(pivotHandle); pivotFor = null; gizmoLocked = false
    applySnap()
    sync(getWorld())
  }
  if (on && id && !pivotFor) {
    const obj = objects.get(id)?.obj
    const o = getWorld().objects.find((x) => x.id === id)
    if (obj && o && !isLight(o.kind)) {
      obj.updateMatrixWorld(true)
      pivotHandle.position.setFromMatrixPosition(obj.matrixWorld)
      pivotHandle.quaternion.setFromRotationMatrix(new THREE.Matrix4().extractRotation(obj.matrixWorld))
      scene.add(pivotHandle)
      pivotFor = id
      gizmoLocked = true
      gizmoR.detach(); gizmoS.detach()
      gizmo.setMode('translate')
      gizmo.attach(pivotHandle)
    }
  }
  pivotLs.forEach((l) => l())
}
gizmo.addEventListener('mouseUp', () => {
  if (!pivotFor || gizmo.object !== pivotHandle) return
  const obj = objects.get(pivotFor)?.obj
  const o = getWorld().objects.find((x) => x.id === pivotFor)
  if (!obj || !o) return
  obj.updateMatrixWorld(true)
  const local = obj.worldToLocal(pivotHandle.position.clone())
  const old = o.pivot ?? [0, 0, 0]
  const r = (v: number) => Math.round(v * 1000) / 1000
  updateObject(o.id, { pivot: [r(old[0] + local.x), r(old[1] + local.y), r(old[2] + local.z)], position: [r(pivotHandle.position.x), r(pivotHandle.position.y), r(pivotHandle.position.z)] }, 'Move pivot')
})

// When you let go of a gizmo, the new transform goes into the scene (undoable).
const saveTransform = (g: TransformControls) => () => {
  const obj = g.object
  const id = obj?.userData.owner as string | undefined
  if (!obj || !id) return
  const o = getWorld().objects.find((x) => x.id === id)
  if (!o) return
  // Take out what the links and spin add, so only your change is saved.
  const sc = linked(o, 'scale', 1) || 1
  const spinNow = clock * linked(o, 'spin', o.spin) * Math.PI / 30
  updateObject(id, {
    position: [obj.position.x, obj.position.y, obj.position.z],
    rotation: [obj.rotation.x / DEG, (obj.rotation.y - spinNow) / DEG, obj.rotation.z / DEG],
    scale: [obj.scale.x / sc, obj.scale.y / sc, obj.scale.z / sc],
  }, 'Move object')
}
gizmo.addEventListener('mouseUp', saveTransform(gizmo))
gizmoR.addEventListener('mouseUp', saveTransform(gizmoR))
gizmoS.addEventListener('mouseUp', saveTransform(gizmoS))

const raycaster = new THREE.Raycaster()
export function pick(clientX: number, clientY: number) {
  const r = canvas3d.getBoundingClientRect()
  const p = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1)
  raycaster.setFromCamera(p, camera)
  const hits = raycaster.intersectObjects([...objects.values()].map((e) => e.obj), true)
  for (const h of hits) {
    let o: THREE.Object3D | null = h.object
    while (o && !o.userData.owner) o = o.parent
    if (o?.userData.owner) {
      const id = o.userData.owner as string
      const data = getWorld().objects.find((x) => x.id === id)
      if (data?.clickable) clicked(data)
      return id
    }
  }
  return null
}

// Clicking a clickable object: the signal 3d:click:<name> jumps to 1 and falls back.
function clicked(o: Obj3D) {
  const sig = `3d:click:${o.name}`
  putSignal(sig, `Clicked ${o.name}`, 1)
  window.setTimeout(() => putSignal(sig, `Clicked ${o.name}`, 0), 160)
}

export function focusSelected() {
  const id = getSelected3d()
  const obj = id ? objects.get(id)?.obj : null
  if (!obj) return
  const box = new THREE.Box3().setFromObject(obj)
  const c = box.getCenter(new THREE.Vector3())
  const size = Math.max(0.5, box.getSize(new THREE.Vector3()).length())
  const dir = camera.position.clone().sub(orbit.target).normalize()
  orbit.target.copy(c)
  camera.position.copy(c.clone().add(dir.multiplyScalar(size * 1.8)))
}

export function saveCamera() {
  changeWorld('Save camera', (w) => ({
    ...w,
    camera: { ...w.camera, position: [camera.position.x, camera.position.y, camera.position.z], target: [orbit.target.x, orbit.target.y, orbit.target.z] },
  }))
}

export async function exportGlb(): Promise<Blob> {
  const exporter = new GLTFExporter()
  gizmoHelper.visible = false
  const prev = gridNow.visible
  gridNow.visible = false
  try {
    const result = await exporter.parseAsync(scene, { binary: true, onlyVisible: true })
    return new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' })
  } finally {
    gizmoHelper.visible = true
    gridNow.visible = prev
  }
}

// ---- keep three.js in step with the scene data ------------------------------------

// the desk aims real fixtures at where 3D things are right now
setWhere((id) => { const e = objects.get(id); if (!e) return getWorld().objects.find((o) => o.id === id)?.position ?? null; const v = e.obj.getWorldPosition(new THREE.Vector3()); return [v.x, v.y, v.z] })

const w0 = getWorld()
camera.position.set(...w0.camera.position)
camera.fov = w0.camera.fov
orbit.target.set(...w0.camera.target)
try { if (localStorage.getItem('rico.3d.ortho') === '1') setOrtho(true) } catch { /* perspective */ }
sync(w0)
let pending = false
onWorldChange(() => {
  if (pending) return
  pending = true
  queueMicrotask(() => {
    pending = false
    sync(getWorld())
  })
})

export { useWorld, select3d, isLight, THREE }
export const resetClock = () => { clock = 0 }
// For exporting: the renderer, the scene, the camera and the built objects.
export const internals = () => ({ renderer, scene, camera, objects, gizmoHelpers: [gizmoHelper, ...[gizmoR, gizmoS].map((g) => g.getHelper())], grid: gridNow })

// A font that finishes loading (or one you add) redraws 3D text that uses it.
onFonts(() => sync(getWorld()))
