import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { rigMesh } from './deform'
import type { Obj3D } from './world'

const bend = { id: 'b', kind: 'bend', axis: 'y', amount: 0.5, on: true }
const o = { id: 'c', kind: 'cylinder', deform: [bend] } as unknown as Obj3D
const ext = (g: THREE.BufferGeometry) => { g.computeBoundingBox(); return g.boundingBox! }

describe('deform from the pivot', () => {
  it('a tall can with its pivot at the bottom bends from the bottom', () => {
    const g = new THREE.CylinderGeometry(0.1, 0.1, 1.2, 16, 24).translate(0, 0.6, 0)   // pivot at the bottom
    const m = new THREE.Mesh(g)
    rigMesh(m, o, 0, 1, 0, () => undefined)
    const b = ext(m.geometry)
    expect(b.min.y).toBeGreaterThan(-0.05)          // the bottom stays where it is
    expect(b.max.z).toBeGreaterThan(0.6)            // the top swings over (a quarter circle)
  })
  it('with the pivot in the middle, both ends bend', () => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.2, 16, 24))
    rigMesh(m, o, 0, 1, 0, () => undefined)
    const b = ext(m.geometry)
    // each half bends a little, the middle stays put: less swing than from the bottom
    expect(b.max.z).toBeGreaterThan(0.12)
    expect(b.max.z).toBeLessThan(0.45)
    expect(b.max.y).toBeLessThan(0.65)
    expect(b.min.y).toBeGreaterThan(-0.62)
  })
})
