import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import * as THREE from 'three'
import { SideTabs, useSideTabs } from './SideTabs'
import { getCamera, getGizmoSpace, gizmoSpaceVersion, isOrtho, lensVersion, onGizmoSpace, onLens, orbit, setGizmoSpace, setOrtho, viewFrom } from './engine'

// The axis ball in the corner of the 3D view: which way X, Y and Z point
// right now. Click an axis to look along it. Below it, which way the handles
// point (World or Object); click to switch.

const AXES: { k: string; v: [number, number, number]; c: string }[] = [
  { k: 'X', v: [1, 0, 0], c: '#ff4d6d' }, { k: 'Y', v: [0, 1, 0], c: '#3bff03' }, { k: 'Z', v: [0, 0, 1], c: '#6f86ff' },
]

export default function ViewGizmo() {
  const [, tick] = useState(0)
  const last = useRef('')
  useSyncExternalStore(onGizmoSpace, gizmoSpaceVersion)
  useSyncExternalStore(onLens, lensVersion)
  const ortho = isOrtho()
  useEffect(() => {
    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const q = getCamera().quaternion
      const key = `${q.x.toFixed(3)},${q.y.toFixed(3)},${q.z.toFixed(3)},${q.w.toFixed(3)}`
      if (key !== last.current) { last.current = key; tick((n) => n + 1) }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])
  const inv = getCamera().quaternion.clone().invert()
  const R = 19
  const pts = AXES.flatMap((a) => [1, -1].map((s) => {
    const p = new THREE.Vector3(...a.v).multiplyScalar(s).applyQuaternion(inv)
    return { ...a, s, x: 26 + p.x * R, y: 26 - p.y * R, z: p.z, dir: a.v.map((n) => n * s) as [number, number, number] }
  })).sort((a, b) => a.z - b.z)
  const space = getGizmoSpace()
  const side = useSideTabs()
  return (
    <>
      <div className="view-gizmo">
        <svg viewBox="0 0 52 52" width={52} height={52} role="group" aria-label="View axes">
          <circle cx={26} cy={26} r={24} className="vg-back" />
          {pts.filter((p) => p.s > 0).map((p) => <line key={`l${p.k}`} x1={26} y1={26} x2={p.x} y2={p.y} stroke={p.c} strokeWidth={1.6} />)}
          {pts.map((p) => (
            <g key={`${p.k}${p.s}`} className="vg-axis" onClick={() => viewFrom(p.dir)} role="button" aria-label={`Look from ${p.s > 0 ? '' : 'minus '}${p.k}`}>
              <circle cx={p.x} cy={p.y} r={p.s > 0 ? 5.5 : 3.2} fill={p.s > 0 ? p.c : '#0b0d0c'} stroke={p.c} strokeWidth={1.2} />
              {p.s > 0 && <text x={p.x} y={p.y + 2.4} textAnchor="middle" fontSize={6.5} fontWeight={700} fill="#050805">{p.k}</text>}
            </g>
          ))}
        </svg>
        <button className={`vg-lens no-corner${ortho ? ' on' : ''}`} onClick={() => setOrtho(!ortho)} title={ortho ? 'Ortho: no depth, sizes stay the same. Click for perspective (5)' : 'Perspective. Click for ortho, with no depth (5)'}>{ortho ? 'Ortho' : 'Persp'}</button>
      </div>
      <SideTabs side={side} viewTab={(
        <div className="vg-panel">
          <span className="vg-title">Handles point along</span>
          <div className="seg" role="group">
            <button className={space === 'world' ? 'on' : ''} onClick={() => setGizmoSpace('world')}>World</button>
            <button className={space === 'local' ? 'on' : ''} onClick={() => setGizmoSpace('local')}>Object</button>
          </div>
          <span className="vg-title">Lens</span>
          <div className="seg" role="group" aria-label="Lens">
            <button className={!ortho ? 'on' : ''} onClick={() => setOrtho(false)}>Perspective</button>
            <button className={ortho ? 'on' : ''} onClick={() => setOrtho(true)}>Ortho</button>
          </div>
          <span className="vg-title">Look from</span>
          <div className="vg-views">
            <button className="btn small quiet" onClick={() => viewFrom([0, 0, 1])}>Front</button>
            <button className="btn small quiet" onClick={() => viewFrom([1, 0, 0])}>Side</button>
            <button className="btn small quiet" onClick={() => viewFrom([0, 1, 0])}>Top</button>
            <button className="btn small quiet" title="Front in ortho, like a drawing" onClick={() => { setOrtho(true); viewFrom([0, 0, 1]) }}>Front ortho</button>
            <button className="btn small quiet" onClick={() => { setOrtho(true); viewFrom([0, 1, 0]) }}>Top ortho</button>
            <button className="btn small quiet" onClick={() => { orbit.target.set(0, 1, 0); viewFrom([1, 0.6, 1.2]) }}>Home</button>
          </div>
        </div>
      )} />
    </>
  )
}
