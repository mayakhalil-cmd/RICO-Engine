import { useSyncExternalStore } from 'react'
import * as THREE from 'three'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js'

// Opening models: glTF / GLB (whole scenes, with their materials and
// animations), FBX (from Maya, Max, Mixamo: with animations) and OBJ.

export type ModelType = 'glb' | 'obj' | 'fbx'
export const modelTypeOf = (name: string): ModelType | null => (/\.(glb|gltf)$/i.test(name) ? 'glb' : /\.fbx$/i.test(name) ? 'fbx' : /\.obj$/i.test(name) ? 'obj' : null)

export interface Loaded { root: THREE.Object3D; clips: THREE.AnimationClip[] }

const gltf = new GLTFLoader()
const fbx = new FBXLoader()
const obj = new OBJLoader()

export function loadModel(url: string, type: ModelType = 'glb'): Promise<Loaded> {
  return new Promise((resolve, reject) => {
    if (type === 'fbx') {
      fbx.load(url, (g) => {
        // FBX files are often in centimeters: bring them near the size of the scene.
        const box = new THREE.Box3().setFromObject(g)
        const size = box.getSize(new THREE.Vector3()).length()
        if (size > 50) g.scale.multiplyScalar(3 / size)
        resolve({ root: g, clips: g.animations ?? [] })
      }, undefined, reject)
    } else if (type === 'obj') {
      fetch(url).then((r) => r.text()).then((text) => resolve({ root: obj.parse(text), clips: [] })).catch(reject)
    } else {
      gltf.load(url, (g) => resolve({ root: g.scene, clips: g.animations ?? [] }), undefined, reject)
    }
  })
}

// The names of the animations each model has, for the settings panel.
const clipNames = new Map<string, string[]>()
export const animationsOf = (id: string) => clipNames.get(id) ?? []
export const setAnimations = (id: string, names: string[]) => { clipNames.set(id, names) }

// The parts of each model (its meshes, as the file names them), for the scene list.
export interface PartInfo { key: string; name: string; depth: number; material: string; tris: number }
const partLists = new Map<string, PartInfo[]>()
let partsVersion = 0
const partListeners = new Set<() => void>()
export const partsOf = (id: string) => partLists.get(id) ?? []
export function setParts(id: string, list: PartInfo[]) { partLists.set(id, list); partsVersion++; partListeners.forEach((l) => l()) }
export function useParts(id: string): PartInfo[] {
  useSyncExternalStore((l) => { partListeners.add(l); return () => partListeners.delete(l) }, () => partsVersion)
  return partsOf(id)
}

// A model's bones (from the file), for posing.
const boneLists = new Map<string, string[]>()
let bonesVersion = 0
const boneListeners = new Set<() => void>()
export const bonesOf = (id: string) => boneLists.get(id) ?? []
export function setBones(id: string, list: string[]) { boneLists.set(id, list); bonesVersion++; boneListeners.forEach((l) => l()) }
export function useBones(id: string): string[] {
  useSyncExternalStore((l) => { boneListeners.add(l); return () => boneListeners.delete(l) }, () => bonesVersion)
  return bonesOf(id)
}
