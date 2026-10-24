import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import Icon from '../components/Icon'
import { SIZES } from '../create/scene'
import { changeScene, useCreate } from '../create/store'
import { setTimeline, timelineOf, type TimeUnits } from '../create/timeline'
import { setTlView, useTlView } from '../create/tlView'
import { LayerInspector } from './LayerProps'
import { NumberBox } from './Create'

// A floating settings window for the selected layer (Ctrl+Shift+K, or
// double-click its bar on the timeline), or for the whole scene
// (Ctrl+Alt+Shift+K): every color, size and property in one place.

let open: 'layer' | 'scene' | null = null
let version = 0
const listeners = new Set<() => void>()
export function openLayerSettings(kind: 'layer' | 'scene' = 'layer') {
  open = open === kind ? null : kind
  version++
  listeners.forEach((l) => l())
}
const close = () => { open = null; version++; listeners.forEach((l) => l()) }

function SceneSettings() {
  const scene = useCreate((s) => s.scene)
  const tl = timelineOf(scene)
  const view = useTlView()
  const set = (part: Partial<typeof scene>, label: string) => changeScene(label, (s) => ({ ...s, ...part }), `scene.${Object.keys(part).join()}`)
  return (
    <div className="dpanel inspector">
      <label className="param"><span className="param-label">Name</span><input className="input" value={scene.name} onChange={(e) => set({ name: e.target.value }, 'Rename scene')} /></label>
      <label className="param"><span className="param-label">Preset</span>
        <select className="select" value={`${scene.width}x${scene.height}`} onChange={(e) => { const [w, h] = e.target.value.split('x').map(Number); if (w) set({ width: w, height: h }, 'Scene size') }}>
          <option value="">Custom</option>
          {SIZES.map((s) => <option key={s.label} value={`${s.w}x${s.h}`}>{s.label}</option>)}
          <option value="3840x2160">3840 x 2160, 4K</option>
          <option value="2560x1440">2560 x 1440</option>
          <option value="1920x1200">1920 x 1200, projector</option>
          <option value="1024x768">1024 x 768, 4:3 projector</option>
        </select></label>
      <div className="row">
        <label className="param"><span className="param-label">Width (px)</span><NumberBox value={scene.width} digits={0} onChange={(v) => v >= 16 && v <= 8192 && set({ width: Math.round(v) }, 'Scene size')} /></label>
        <label className="param"><span className="param-label">Height (px)</span><NumberBox value={scene.height} digits={0} onChange={(v) => v >= 16 && v <= 8192 && set({ height: Math.round(v) }, 'Scene size')} /></label>
      </div>
      <div className="row">
        <label className="param"><span className="param-label">Length (s)</span><NumberBox value={tl.duration} digits={2} onChange={(v) => v > 0 && setTimeline({ duration: v }, 'Change length')} /></label>
        <label className="param"><span className="param-label">Frame rate</span>
          <select className="select" value={String(tl.fps)} onChange={(e) => setTimeline({ fps: Number(e.target.value) }, 'Change fps')}>
            {[...new Set([12, 15, 23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120, tl.fps])].sort((x, y) => x - y).map((f) => <option key={f} value={f}>{f} fps</option>)}
          </select></label>
        <label className="param"><span className="param-label">BPM</span><NumberBox value={tl.bpm} digits={2} onChange={(v) => v > 0 && setTimeline({ bpm: v }, 'Change tempo')} /></label>
      </div>
      <div className="row">
        <label className="param"><span className="param-label">Show time as</span>
          <select className="select" value={view.units} onChange={(e) => setTlView({ units: e.target.value as TimeUnits })}>
            <option value="tc">Timecode 0:00:00:00</option><option value="frames">Frames</option><option value="sec">Seconds</option>
          </select></label>
        <label className="switch mini"><input type="checkbox" role="switch" checked={view.snap} onChange={(e) => setTlView({ snap: e.target.checked })} /><span>Snap to beats</span></label>
        <label className="switch mini"><input type="checkbox" role="switch" checked={tl.loop} onChange={(e) => setTimeline({ loop: e.target.checked }, 'Loop')} /><span>Loop</span></label>
      </div>
      <label className="param"><span className="param-label">Background color</span>
        <input type="color" className="swatch" value={scene.background ?? '#000000'} onChange={(e) => set({ background: e.target.value }, 'Background color')} /></label>
    </div>
  )
}

export default function LayerSettingsDialog() {
  useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => version)
  const scene = useCreate((s) => s.scene)
  const selected = useCreate((s) => s.selected)
  const [pos, setPos] = useState({ x: Math.max(20, window.innerWidth - 480), y: 80 })
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)
  // Esc closes it (unless you are typing in it), and so does leaving Create.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !(e.target as Element)?.closest?.('input, textarea, select')) close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  if (!open) return null
  const layer = scene.layers.find((l) => l.id === selected)
  const kind = open === 'layer' && layer ? 'layer' : 'scene'
  return createPortal(
    <div className="float-win" style={{ left: pos.x, top: pos.y }} role="dialog" aria-label="Settings" data-keyscope="create">
      <div className="float-head"
        onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y }; (e.target as Element).setPointerCapture(e.pointerId) }}
        onPointerMove={(e) => { const d = drag.current; if (d) setPos({ x: Math.max(0, d.px + e.clientX - d.x), y: Math.max(0, d.py + e.clientY - d.y) }) }}
        onPointerUp={() => { drag.current = null }}>
        <b>{kind === 'layer' ? `Layer settings: ${layer!.name}` : 'Comp settings'}</b>
        <span className="grow" />
        <button className="icon-btn small" onClick={close} title="Close (Esc)"><Icon name="x" /></button>
      </div>
      <div className="float-body" onKeyDown={(e) => { if (e.key === 'Escape') close() }}>
        {kind === 'layer' ? <LayerInspector layer={layer!} /> : <SceneSettings />}
      </div>
    </div>,
    document.body,
  )
}
