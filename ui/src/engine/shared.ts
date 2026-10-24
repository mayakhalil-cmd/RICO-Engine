// Pictures and shapes that one part of RICO makes and another uses:
// a node network's texture on a Create layer or a 3D object, the Create
// picture as a material, a node-built shape in the 3D scene.
//
// Pictures are plain 2D canvases (they can cross between graphics
// contexts). Shapes are three.js geometries, kept as "unknown" here so this
// file stays tiny and loads before three.js does.

export interface SharedPicture { canvas: HTMLCanvasElement; version: number; from: string }
export interface SharedShape { geometry: unknown; version: number; from: string }

const pictures = new Map<string, SharedPicture>()
const shapes = new Map<string, SharedShape>()
const wanted = new Map<string, number>()    // name -> last time someone used it
let listVersion = 0
const listeners = new Set<() => void>()

function changed() {
  listVersion++
  listeners.forEach((l) => l())
}

export function onSharedChange(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
export const sharedVersion = () => listVersion

// ---- pictures ----

export function putPicture(name: string, from: string): SharedPicture {
  let p = pictures.get(name)
  if (!p) {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 2
    p = { canvas, version: 0, from }
    pictures.set(name, p)
    changed()
  }
  p.from = from
  return p
}

export function dropPicture(name: string) {
  if (pictures.delete(name)) changed()
}

// Users call this every frame they draw a picture, so makers know to keep it fresh.
export function usePicture(name: string): SharedPicture | undefined {
  wanted.set(name, performance.now())
  return pictures.get(name)
}

export const pictureWanted = (name: string) => performance.now() - (wanted.get(name) ?? -1e9) < 1500
// The Motion picture keeps its old name inside saved files.
export const pictureLabel = (n: string) => (n === 'Create' ? 'Motion' : n)
export const pictureNames = () => ['Create', ...[...pictures.keys()].filter((n) => n !== 'Create')]

// ---- shapes ----

export function putShape(name: string, geometry: unknown, from: string) {
  const s = shapes.get(name)
  const isNew = !s
  shapes.set(name, { geometry, version: (s?.version ?? 0) + 1, from })
  if (isNew) changed()
}

export function dropShape(name: string) {
  if (shapes.delete(name)) changed()
}

export const getShape = (name: string) => shapes.get(name)
export const shapeNames = () => [...shapes.keys()]
