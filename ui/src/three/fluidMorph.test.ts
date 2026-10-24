import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { fluidMorph, stopFluid } from './fluidMorph'
import type { Obj3D } from './world'

const obj = (to: string, amount: number, extra = {}) => ({ id: 'a', kind: 'box', morph: { to, amount, ...extra } } as unknown as Obj3D)

describe('fluid morph', () => {
  it('melts a long box into a ball, then back to its own shape', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 0.4, 0.4), new THREE.MeshStandardMaterial())
    const rest = mesh.geometry
    const t0 = performance.now()
    expect(fluidMorph(mesh, obj('sphere', 1, { goo: 0 }), 1, 0, () => undefined)).toBe(true)
    const ms = performance.now() - t0
    const g = mesh.geometry
    expect(g).not.toBe(rest)
    expect(g.drawRange.count).toBeGreaterThan(300)
    const s = g.boundingBox!.getSize(new THREE.Vector3())
    // a ball: about as deep and tall as it is wide
    expect(s.y / s.x).toBeGreaterThan(0.85)
    expect(s.z / s.x).toBeGreaterThan(0.85)
    // halfway it is neither
    fluidMorph(mesh, obj('sphere', 0.5), 0.5, 0.3, () => undefined)
    const h = mesh.geometry.boundingBox!.getSize(new THREE.Vector3())
    expect(h.x).toBeGreaterThan(s.x * 1.05)
    // at 0 the box comes back
    fluidMorph(mesh, obj('sphere', 0), 0, 0, () => undefined)
    expect(mesh.geometry).toBe(rest)
    expect(ms).toBeLessThan(4000)
  })
  it('morphs into another object and into a ring', () => {
    const a = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 16), new THREE.MeshStandardMaterial())
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.3, 1.6), new THREE.MeshStandardMaterial())
    b.position.set(0, 0, 0)
    expect(fluidMorph(a, obj('other', 1, { goo: 0 }), 1, 0, () => b)).toBe(true)
    const s = a.geometry.boundingBox!.getSize(new THREE.Vector3())
    expect(s.x).toBeGreaterThan(1.3)
    expect(s.y).toBeLessThan(0.7)
    stopFluid(a)
    expect(fluidMorph(a, obj('torus', 1, { goo: 0 }), 1, 0, () => undefined)).toBe(true)
    expect(a.geometry.drawRange.count).toBeGreaterThan(300)
  })
})
