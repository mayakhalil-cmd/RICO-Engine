import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { armsOf, dripsOf, setSymbioteFloors, symbiote, symbioteMesh, tendrilsOf } from './symbiote'
import type { Obj3D } from './world'

const make = (id: string, extra = {}) => ({ id, kind: 'sphere', symbiote: { on: true, reach: 1.2, detach: 2.6, arms: 3, thick: 0.06, speed: 2, goo: 0.6, self: 0.5, blob: 0.5, bumps: 0.4, detail: 32, drips: 1, puddle: 'fade', puddleTime: 0.5, ...extra } }) as unknown as Obj3D

describe('symbiote', () => {
  it('reaches only for a thing nearby, holds on, stretches, snaps with drips, and lets go', () => {
    const goo = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.2, 24), new THREE.MeshStandardMaterial())
    const own = goo.material
    const rest = goo.geometry
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshStandardMaterial())
    box.position.set(5, 0, 0)
    const o = make('g')
    const others = () => [['b', box] as [string, THREE.Object3D]]
    setSymbioteFloors([new THREE.Box3(new THREE.Vector3(-20, -1.2, -20), new THREE.Vector3(20, -1, 20))])
    let t = 0
    const run = (k: number) => { for (let i = 0; i < k; i++) { t += 0.05; box.updateMatrixWorld(true); symbiote(goo, o, t, others) } }
    // far away: alive, but no tendrils at all
    run(20)
    expect(goo.geometry).not.toBe(rest)
    expect(symbioteMesh(goo)!.visible).toBe(false)
    // the skin is one closed piece: no loose edges where the cap meets the side
    const idx = goo.geometry.getIndex()!.array
    const edges = new Map<string, number>()
    for (let i = 0; i < idx.length; i += 3) for (const [a, b] of [[idx[i], idx[i + 1]], [idx[i + 1], idx[i + 2]], [idx[i + 2], idx[i]]]) { const k = a < b ? `${a},${b}` : `${b},${a}`; edges.set(k, (edges.get(k) ?? 0) + 1) }
    expect([...edges.values()].filter((n) => n !== 2).length).toBe(0)
    // near: they grow toward it and hold
    box.position.set(1.2, 0, 0)
    run(80)
    expect(armsOf(goo)).toBeGreaterThan(0)
    const tube = symbioteMesh(goo)!
    tube.geometry.computeBoundingBox()
    expect(tube.geometry.boundingBox!.max.x).toBeGreaterThan(0.9)
    expect(tube.geometry.boundingBox!.min.x).toBeGreaterThan(-0.2)   // only on the side that faces it
    // far: they snap, drips fall to the floor, the puddles fade, all is pulled back in
    box.position.set(8, 0, 0)
    run(4)
    expect(dripsOf(goo).length).toBeGreaterThan(0)
    run(30)
    expect(armsOf(goo)).toBe(0)
    expect(dripsOf(goo).some((d) => d.floor !== null)).toBe(true)
    run(80)
    expect(dripsOf(goo).length).toBe(0)
    expect(symbioteMesh(goo)!.visible).toBe(false)
    // off: its own shape and material come back
    symbiote(goo, { ...o, symbiote: { ...o.symbiote!, on: false } } as Obj3D, t, others)
    expect(goo.geometry).toBe(rest)
    expect(goo.material).toBe(own)
    expect(goo.children.length).toBe(0)
    setSymbioteFloors([])
  })
  it('two symbiotes reach for each other', () => {
    const a = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 16), new THREE.MeshStandardMaterial())
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 16), new THREE.MeshStandardMaterial())
    b.position.set(1.6, 0, 0)
    const oa = make('a'), ob = make('b')
    let t = 0
    for (let i = 0; i < 80; i++) {
      t += 0.05
      a.updateMatrixWorld(true); b.updateMatrixWorld(true)
      symbiote(a, oa, t, () => [['b', b]])
      symbiote(b, ob, t, () => [['a', a]])
    }
    expect(armsOf(a)).toBeGreaterThan(0)
    expect(armsOf(b)).toBeGreaterThan(0)
    // the skins swell toward each other
    a.geometry.computeBoundingBox(); b.geometry.computeBoundingBox()
    expect(a.geometry.boundingBox!.max.x).toBeGreaterThan(0.52)
    expect(b.geometry.boundingBox!.min.x).toBeLessThan(-0.52)
  })
  it('latches on fast, with thick and thin tendrils, and veins that throb', () => {
    const goo = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 16), new THREE.MeshStandardMaterial())
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), new THREE.MeshStandardMaterial())
    box.position.set(1.2, 0, 0); box.updateMatrixWorld(true)
    const o = make('v', { speed: 1, arms: 10, veinsOn: true, throb: 1 })
    let t = 0
    const beats: number[] = []
    for (let i = 0; i < 24; i++) { t += 1 / 30; symbiote(goo, o, t, () => [['b', box]]); beats.push((goo.material as THREE.Material).userData.veinU.uTime.value) }
    // in under a second some already hold on
    expect(armsOf(goo)).toBeGreaterThan(0)
    const sizes = tendrilsOf(goo).map((a) => a.size)
    expect(Math.max(...sizes) / Math.min(...sizes)).toBeGreaterThan(1.3)
    // the veins are on, push the skin up, and keep time for the beat; the thick tendrils carry veins too
    const u = (goo.material as THREE.Material).userData.veinU
    expect(u.uVeinOn.value).toBe(1)
    expect(u.uBump.value).toBeGreaterThan(0)
    expect(beats[23]).toBeGreaterThan(beats[0])
    expect(goo.geometry.getAttribute('rest').count).toBe(goo.geometry.getAttribute('position').count)
  })
})
