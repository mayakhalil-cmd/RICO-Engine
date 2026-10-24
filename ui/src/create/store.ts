import { useSyncExternalStore } from 'react'
import { rico } from '../engine/connection'
import { record } from '../shell/history'
import { scene3dPicture, setCompFinder } from './renderer'
import { Renderer } from './renderer'
import { loadScene, saveScene, type Scene } from './scene'
import { pictureWanted, putPicture, usePicture } from '../engine/shared'

// The Create workspace lives here, outside any panel, so the visuals keep
// running and sending while you move panels around or look at other tabs.
// The preview panel just borrows the canvas.

// What "Send to video" sends: the Create picture or any named picture (a node
// network's Picture out, a script's picture, the 3D scene), how often, and
// how big. Spout and network video both take it from here.
export interface OutputOptions { source: string; fps: number; scale: number }
const OUT_KEY = 'rico.video.out'
let outputOptions: OutputOptions = (() => {
  try { return { source: 'Create', fps: 30, scale: 1, ...JSON.parse(localStorage.getItem(OUT_KEY) ?? '{}') } } catch { return { source: 'Create', fps: 30, scale: 1 } }
})()
export const getOutputOptions = () => outputOptions
export function setOutputOptions(part: Partial<OutputOptions>) {
  outputOptions = { ...outputOptions, ...part }
  try { localStorage.setItem(OUT_KEY, JSON.stringify(outputOptions)) } catch { /* not remembered */ }
  set({})
}
const pictureOut = document.createElement('canvas')
function sendPicture(name: string): boolean {
  const pic = name === '3D' ? null : usePicture(name)
  const src = name === '3D' ? scene3dPicture() : pic?.canvas
  if (!src || src.width < 4) return false
  const w = Math.max(16, Math.round((src.width * outputOptions.scale) / 2) * 2), h = Math.max(16, Math.round((src.height * outputOptions.scale) / 2) * 2)
  if (pictureOut.width !== w || pictureOut.height !== h) { pictureOut.width = w; pictureOut.height = h }
  const g = pictureOut.getContext('2d', { willReadFrequently: true })
  if (!g) return false
  g.drawImage(src, 0, 0, w, h)
  const px = g.getImageData(0, 0, w, h).data
  return rico.sendFrame(new Uint8Array(px.buffer), w, h)
}

interface CreateState {
  scene: Scene
  selected: string | null
  output: boolean
  fps: number
  problem: string | null
  previewVisible: number   // how many preview panels are on screen
  path: { id: string; name: string }[]   // the precomps you opened, from the main composition in
}

let state: CreateState = {
  scene: loadScene(),
  selected: null,
  output: false,
  fps: 0,
  problem: null,
  previewVisible: 0,
  path: [],
}
// The main composition. While a precomp is open, state.scene is that precomp
// and this keeps the rest (the precomp is written back into it on every change).
let root: Scene = state.scene
const openId = () => state.path[state.path.length - 1]?.id
setCompFinder((id) => (id === openId() ? state.scene : root.comps?.[id]))
/** The whole project's composition, with every precomp in it. */
export const getRootScene = (): Scene => (state.path.length ? root : state.scene)
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((l) => l())
}

function set(part: Partial<CreateState>) {
  state = { ...state, ...part }
  emit()
}

export function useCreate<T>(pick: (s: CreateState) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => pick(state),
  )
}

export const getCreate = () => state

// ---- scene changes (all go through here so they can be undone) -------------

let saveTimer = 0
function applyScene(scene: Scene, at: string | undefined = openId()) {
  // undo of a change made in another composition: go back there first
  if (at !== openId()) {
    if (at === undefined) { root = mergeOpen(); state = { ...state, path: [] } }
    else if (root.comps?.[at]) { root = mergeOpen(); state = { ...state, path: [{ id: at, name: root.comps![at].name }] } }
  }
  const id = openId()
  if (id) root = { ...root, comps: { ...(root.comps ?? {}), [id]: scene } }
  else root = scene
  set({ scene })
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => saveScene(root), 400)
  renderer?.forget(new Set(scene.layers.map((l) => l.id)))
}
// the main composition with the open precomp written into it
function mergeOpen(): Scene {
  const id = openId()
  return id ? { ...root, comps: { ...(root.comps ?? {}), [id]: state.scene } } : state.scene
}

export function changeScene(label: string, fn: (s: Scene) => Scene, mergeKey?: string) {
  const before = state.scene
  const after = fn(before)
  if (after === before) return
  const at = openId()
  applyScene(after, at)
  record({ label, key: mergeKey, undo: () => applyScene(before, at), redo: () => applyScene(after, at) })
}

// ---- precomps ----

/** Opens a precomp in the viewer and the timeline (like double-clicking it). */
export function openComp(id: string) {
  root = mergeOpen()
  const c = root.comps?.[id]
  if (!c) return
  const at = state.path.findIndex((p) => p.id === id)
  const path = at >= 0 ? state.path.slice(0, at + 1) : [...state.path, { id, name: c.name }]
  set({ path, scene: c, selected: null })
}
/** Back out to a level of the path: 0 is the main composition. */
export function closeComp(level = state.path.length - 1) {
  root = mergeOpen()
  const path = state.path.slice(0, Math.max(0, level))
  const id = path[path.length - 1]?.id
  set({ path, scene: id ? root.comps![id] : root, selected: null })
}
/** Every composition in the project: the main one first. */
export function listComps(): { id: string; name: string; scene: Scene }[] {
  const r = mergeOpen()
  return [{ id: '', name: r.name, scene: r }, ...Object.entries(r.comps ?? {}).map(([id, sc]) => ({ id, name: sc.name, scene: sc }))]
}
let compN = 0
/** A new empty composition the size of this one. */
export function newComp(name?: string, layers: Scene['layers'] = [], tracks: NonNullable<Scene['timeline']>['tracks'] = []): string {
  const base = state.scene
  const id = `comp${Date.now().toString(36)}${(compN++).toString(36)}`
  const tl = base.timeline ?? { duration: 10, fps: 30, loop: true, bpm: 120, tracks: [] }
  const comp: Scene = { version: 1, name: name ?? `Precomp ${Object.keys(root.comps ?? {}).length + 1}`, width: base.width, height: base.height, layers, master: { values: {}, bindings: {} }, timeline: { ...tl, tracks, inPoint: undefined, outPoint: undefined, cues: [], outTracks: [] } as NonNullable<Scene['timeline']> }
  const r = mergeOpen()
  root = { ...r, comps: { ...(r.comps ?? {}), [id]: comp } }
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => saveScene(root), 400)
  // at the main composition, the scene you see is the main one: it carries the new comp
  if (!openId()) set({ scene: root })
  else set({})
  return id
}

// For live sharing: another screen changed the scene. Not an undo step here.
export function applyRemoteScene(scene: Scene) {
  if (state.path.length) state = { ...state, path: [] }
  applyScene(scene, undefined)
}

export function subscribeCreate(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function replaceScene(scene: Scene, label = 'Open scene') {
  if (state.path.length) { root = mergeOpen(); state = { ...state, path: [], scene: root } }
  changeScene(label, () => scene)
  set({ selected: null })
}

export function select(id: string | null) {
  set({ selected: id })
}

export function setOutput(on: boolean) {
  set({ output: on })
  if (on) {
    const video = rico.get().state?.video
    if (video && video.source !== 3) rico.send('video.source', { source: 3, monitor: 0 })
  }
}

// ---- the renderer, which owns its canvas -----------------------------------

let renderer: Renderer | null = null
export const getRenderer = () => renderer

// Things that change settings every frame (the timeline) run just before
// each frame is drawn.
const frameHooks = new Set<(now: number) => void>()
export function onFrame(fn: (now: number) => void) {
  frameHooks.add(fn)
  return () => {
    frameHooks.delete(fn)
  }
}

// Extra places the picture is shown (output windows) keep it rendering even
// when no preview panel is open.
let viewers = 0
let paused = false
// Rendering a video file draws frames itself; the live loop waits meanwhile.
export function pauseRendering(on: boolean) {
  paused = on
}
export function addViewer(on: boolean) {
  viewers = Math.max(0, viewers + (on ? 1 : -1))
}
export const canvas: HTMLCanvasElement = document.createElement('canvas')
canvas.className = 'create-canvas'
canvas.setAttribute('aria-label', 'Motion preview')

export function previewMounted(on: boolean) {
  set({ previewVisible: Math.max(0, state.previewVisible + (on ? 1 : -1)) })
}

function sharePicture(r: Renderer) {
  const cv = r.outputCanvas
  if (!cv.width) return
  const pic = putPicture('Create', 'create')
  const scale = Math.min(1, 1280 / cv.width)
  const w = Math.round(cv.width * scale), h = Math.round(cv.height * scale)
  if (pic.canvas.width !== w || pic.canvas.height !== h) { pic.canvas.width = w; pic.canvas.height = h }
  pic.canvas.getContext('2d')?.drawImage(cv, 0, 0, w, h)
  pic.version++
}

// Called after each frame is drawn (output windows copy it from here).
const frameListeners = new Set<() => void>()
export function onDrawn(fn: () => void) {
  frameListeners.add(fn)
  return () => {
    frameListeners.delete(fn)
  }
}

function start() {
  try {
    renderer = new Renderer(canvas)
  } catch (e) {
    set({ problem: String((e as Error).message ?? e) })
    return
  }
  let lastSend = 0
  let frames = 0
  let fpsTime = performance.now()
  const loop = (now: number) => {
    requestAnimationFrame(loop)
    frameHooks.forEach((f) => f(now))
    if (paused) return
    const shared = pictureWanted('Create')     // a 3D material or a node uses the Create picture
    if (!renderer || (state.previewVisible === 0 && !state.output && viewers === 0 && !shared)) return
    renderer.render(state.scene)
    if (shared) sharePicture(renderer)
    frameListeners.forEach((f) => f())
    if (renderer.failed !== state.problem) set({ problem: renderer.failed })
    if (state.output && now - lastSend >= 1000 / Math.max(1, outputOptions.fps) - 2) {
      if (outputOptions.source === 'Create') {
        const frame = renderer.readOutput()
        if (frame && rico.sendFrame(frame.pixels, frame.width, frame.height)) lastSend = now
      } else if (sendPicture(outputOptions.source)) lastSend = now
    }
    frames++
    if (now - fpsTime > 1000) {
      const fps = Math.round((frames * 1000) / (now - fpsTime))
      if (fps !== state.fps) set({ fps })
      frames = 0
      fpsTime = now
    }
  }
  requestAnimationFrame(loop)
}

start()
