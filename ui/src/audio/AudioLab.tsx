import { useEffect, useRef, useState } from 'react'
import Icon from '../components/Icon'
import Scrub from '../components/Scrub'
import { SIGNAL_DRAG } from '../components/SignalPicker'
import { useCanvas } from '../components/useCanvas'
import { rico } from '../engine/connection'
import { useTick } from '../engine/useTick'
import { noteName } from './fft'
import { responseDb, shapeFilters } from './dsp'
import {
  PRESETS, SOURCE_LABEL, addBand, getFrame, inputDevices, removeBand, sceneOf, setMonitor, setSceneTune, setSettings, setShape, shapeOf, start, stop, updateBand, useLab, usePreset,
  type SourceKind,
} from './lab'
import { SPEC_POINTS, hzToSpec, specHz, type Band, type Shape } from './types'

// The audio lab: a real-time analyzer with bands you shape yourself.

const DB_LO = -96, DB_HI = 0
const GRID = [30, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]
const fmtHz = (f: number) => (f >= 1000 ? `${+(f / 1000).toFixed(f >= 10000 ? 0 : 1)}k` : `${Math.round(f)}`)
const xOf = (hz: number, w: number) => (hzToSpec(hz) / (SPEC_POINTS - 1)) * w
const hzOf = (x: number, w: number) => specHz((x / w) * (SPEC_POINTS - 1))

function Spectrum({ selected, onSelect }: { selected: string | null; onSelect: (id: string | null) => void }) {
  const { settings } = useLab()
  const hold = useRef<Float32Array | null>(null)
  const drag = useRef<{ id: string; part: 'lo' | 'hi' | 'move'; x0: number; lo: number; hi: number } | null>(null)
  const ref = useCanvas((g, w, h) => {
    const f = getFrame()
    g.fillStyle = '#000'
    g.fillRect(0, 0, w, h)
    const yOf = (d: number) => h - ((Math.max(DB_LO, Math.min(DB_HI, d)) - DB_LO) / (DB_HI - DB_LO)) * h
    // grid
    g.strokeStyle = 'rgba(59,255,3,0.12)'
    g.fillStyle = 'rgba(185,194,180,0.7)'
    g.font = '10px "Courier Prime", monospace'
    g.lineWidth = 1
    for (const hz of GRID) { const x = Math.round(xOf(hz, w)) + 0.5; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); g.fillText(fmtHz(hz), x + 2, h - 3) }
    for (let d = -84; d < 0; d += 12) { const y = Math.round(yOf(d)) + 0.5; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); g.fillText(`${d}`, 2, y - 2) }
    // bands
    settings.bands.forEach((b, i) => {
      if (!b.on) return
      const x0 = xOf(b.lo, w), x1 = xOf(b.hi, w)
      const v = f?.bands[i] ?? 0
      const wide = b.hi / b.lo > 64
      g.globalAlpha = selected === b.id ? 0.28 : wide ? 0.03 : 0.12
      g.fillStyle = b.color
      g.fillRect(x0, 0, Math.max(1, x1 - x0), h)
      g.globalAlpha = 0.65
      g.fillRect(x0, h - v * h, Math.max(1, x1 - x0), 3)
      if (b.mode === 'hit' && (f?.bands[i] ?? 0) > 0.05) { g.globalAlpha = (f?.bands[i] ?? 0) * 0.5; g.fillRect(x0, 0, x1 - x0, h) }
      g.globalAlpha = 1
      if (selected === b.id) { g.strokeStyle = b.color; g.strokeRect(x0 + 0.5, 0.5, x1 - x0 - 1, h - 1) }
    })
    // Band names, on top, where there is room.
    g.font = '10px "Courier Prime", monospace'
    let lastRight = -1
    settings.bands.forEach((b) => {
      if (!b.on || b.hi / b.lo > 64) return
      const x0 = xOf(b.lo, w), x1 = xOf(b.hi, w)
      const tw = g.measureText(b.name).width
      const x = Math.max(x0 + 2, (x0 + x1) / 2 - tw / 2)
      if (x < lastRight + 4 || tw > Math.max(40, x1 - x0 + 30)) return
      g.fillStyle = b.color
      g.globalAlpha = selected === b.id ? 1 : 0.8
      g.fillText(b.name, x, 12)
      g.globalAlpha = 1
      lastRight = x + tw
    })
    // The shaping curve (its own scale: the middle line is 0 dB, +-24 dB).
    const sh = shapeOf(settings)
    if (sh.on) {
      const fl = shapeFilters(sh, 48000)
      const yDb = (d: number) => h / 2 - (Math.max(-24, Math.min(24, d)) / 24) * (h / 2 - 16)
      g.strokeStyle = 'rgba(255,210,63,0.35)'
      g.setLineDash([3, 4])
      g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke()
      g.setLineDash([])
      g.strokeStyle = '#ffd23f'
      g.lineWidth = 2
      g.beginPath()
      for (let x = 0; x <= w; x += 2) {
        const hz = hzOf(x, w)
        const d = fl.reduce((a, f) => a + responseDb(f, hz, 48000), 0)
        if (x) g.lineTo(x, yDb(d)); else g.moveTo(x, yDb(d))
      }
      g.stroke()
      g.lineWidth = 1
    }
    if (!f) {
      g.fillStyle = 'rgba(185,194,180,0.8)'
      g.font = '13px "Courier Prime", monospace'
      g.fillText('Start a source to see the sound.', 16, 24)
      return
    }
    // peak hold
    const s = f.spectrum
    if (!hold.current || hold.current.length !== s.length) hold.current = new Float32Array(s)
    const hd = hold.current
    for (let i = 0; i < s.length; i++) hd[i] = Math.max(s[i], hd[i] - 0.4)
    // spectrum fill
    const grad = g.createLinearGradient(0, 0, 0, h)
    grad.addColorStop(0, 'rgba(248,32,160,0.85)')
    grad.addColorStop(0.5, 'rgba(59,255,3,0.55)')
    grad.addColorStop(1, 'rgba(0,44,248,0.25)')
    g.beginPath()
    g.moveTo(0, h)
    for (let i = 0; i < s.length; i++) g.lineTo((i / (s.length - 1)) * w, yOf(s[i]))
    g.lineTo(w, h)
    g.fillStyle = grad
    g.fill()
    g.beginPath()
    for (let i = 0; i < hd.length; i++) { const x = (i / (hd.length - 1)) * w; if (i) g.lineTo(x, yOf(hd[i])); else g.moveTo(x, yOf(hd[i])) }
    g.strokeStyle = 'rgba(255,255,255,0.6)'
    g.stroke()
  }, [settings, selected])

  const at = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect()
    return { x: e.clientX - r.left, w: r.width }
  }
  return (
    <canvas ref={ref} className="lab-spectrum"
      title="Drag a band's edges to change its range, drag its middle to move it. Double-click to add a band there."
      onPointerDown={(e) => {
        const { x, w } = at(e)
        const hit = [...settings.bands].reverse().find((b) => b.on && x >= xOf(b.lo, w) - 5 && x <= xOf(b.hi, w) + 5 && (selected ? b.id === selected || !settings.bands.some((q) => q.id === selected && x >= xOf(q.lo, w) - 5 && x <= xOf(q.hi, w) + 5) : true))
        if (!hit) { onSelect(null); return }
        onSelect(hit.id)
        const x0 = xOf(hit.lo, w), x1 = xOf(hit.hi, w)
        const part = Math.abs(x - x0) < 7 ? 'lo' : Math.abs(x - x1) < 7 ? 'hi' : 'move'
        drag.current = { id: hit.id, part, x0: x, lo: hit.lo, hi: hit.hi }
        ;(e.target as Element).setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        const { x, w } = at(e)
        const k = (x - d.x0) / w * (SPEC_POINTS - 1)
        const shift = (hz: number) => Math.max(10, Math.min(22000, specHz(hzToSpec(hz) + k)))
        if (d.part === 'lo') updateBand(d.id, { lo: Math.min(shift(d.lo), d.hi * 0.97) })
        else if (d.part === 'hi') updateBand(d.id, { hi: Math.max(shift(d.hi), d.lo * 1.03) })
        else updateBand(d.id, { lo: shift(d.lo), hi: shift(d.hi) })
      }}
      onPointerUp={() => { drag.current = null }}
      onDoubleClick={(e) => {
        const { x, w } = at(e)
        const f = hzOf(x, w)
        onSelect(addBand({ lo: Math.round(f / Math.pow(2, 1 / 3)), hi: Math.round(f * Math.pow(2, 1 / 3)), name: `${fmtHz(f)} Hz` }))
      }}
    />
  )
}

function Waterfall() {
  const img = useRef<ImageData | null>(null)
  const ref = useCanvas((g, w, h) => {
    const f = getFrame()
    const W = Math.floor(w), H = Math.floor(h)
    if (!img.current || img.current.width !== W || img.current.height !== H) img.current = new ImageData(Math.max(1, W), Math.max(1, H))
    const d = img.current.data
    // Scroll up one row and draw the newest spectrum at the bottom.
    d.copyWithin(0, W * 4)
    const row = (H - 1) * W * 4
    for (let x = 0; x < W; x++) {
      const v = f ? Math.max(0, Math.min(1, (f.spectrum[Math.floor((x / W) * (SPEC_POINTS - 1))] - DB_LO) / (DB_HI - DB_LO))) : 0
      const t = Math.pow(v, 1.6)
      d[row + x * 4] = Math.min(255, t * 2 * 248)
      d[row + x * 4 + 1] = Math.max(0, (t - 0.5) * 2) * 255
      d[row + x * 4 + 2] = Math.min(255, (0.2 + t) * 248 * (1 - t * 0.6))
      d[row + x * 4 + 3] = 255
    }
    const dpr = g.getTransform().a
    g.setTransform(1, 0, 0, 1, 0, 0)
    const tmp = document.createElement('canvas')
    tmp.width = W; tmp.height = H
    tmp.getContext('2d')!.putImageData(img.current, 0, 0)
    g.imageSmoothingEnabled = false
    g.drawImage(tmp, 0, 0, W * dpr, H * dpr)
  })
  return <canvas ref={ref} className="lab-waterfall" title="Spectrogram: time goes up" />
}

function Scope() {
  const ref = useCanvas((g, w, h) => {
    const f = getFrame()
    g.fillStyle = '#000'
    g.fillRect(0, 0, w, h)
    g.strokeStyle = 'rgba(59,255,3,0.15)'
    g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke()
    if (!f) return
    g.strokeStyle = '#3bff03'
    g.beginPath()
    f.scope.forEach((v, i) => { const x = (i / (f.scope.length - 1)) * w, y = h / 2 - v * h * 0.48; if (i) g.lineTo(x, y); else g.moveTo(x, y) })
    g.stroke()
  })
  return <canvas ref={ref} className="lab-scope" />
}

function Meter({ label, value, min, max, unit, warn }: { label: string; value: number; min: number; max: number; unit: string; warn?: number }) {
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)))
  return (
    <div className="lab-meter">
      <span className="dim small">{label}</span>
      <div className="meter"><i style={{ width: `${t * 100}%`, background: warn !== undefined && value > warn ? 'var(--pink)' : undefined }} /></div>
      <b>{Number.isFinite(value) && value > -200 ? value.toFixed(1) : '-∞'} {unit}</b>
    </div>
  )
}

function Features() {
  useTick(80)
  const f = getFrame()?.features
  const ms = getFrame()?.ms ?? 0
  if (!f) return null
  const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  return (
    <div className="lab-features">
      <Meter label="Peak" value={f.peak} min={-60} max={0} unit="dBFS" warn={-1} />
      <Meter label="RMS" value={f.rms} min={-60} max={0} unit="dBFS" />
      <Meter label="Loudness now (LUFS M)" value={f.lufsM} min={-60} max={0} unit="LUFS" warn={-9} />
      <Meter label="Loudness 3 s (LUFS S)" value={f.lufsS} min={-60} max={0} unit="LUFS" warn={-9} />
      <div className="lab-feat">
        <span className="dim small">Tempo (sure {(f.bpmConfidence * 100).toFixed(0).padStart(3, '\u2007')}%)</span>
        <span className="row"><b>{Math.round(f.bpm).toString().padStart(3, '\u2007')} BPM</b><span className={`lab-lamp${f.beat > 0.5 ? ' on' : ''}`} title="Beat" /></span>
      </div>
      <div className="lab-feat"><span className="dim small">Pitch</span><b>{f.pitch > 0 ? noteName(f.pitch) : '-'}</b><span className="dim small">{f.pitch > 0 ? `${f.pitch.toFixed(1).padStart(6, '\u2007')} Hz` : '\u00a0'}</span></div>
      <div className="lab-feat"><span className="dim small">Brightness</span><b>{Math.round(f.centroid)} Hz</b></div>
      <div className="lab-feat"><span className="dim small">Stereo</span><b>{f.correlation >= 0 ? 'in phase' : 'out of phase!'} {(f.correlation).toFixed(2)}</b></div>
      <div className="lab-chroma" title="Which notes are playing">
        {f.chroma.map((c, i) => <span key={i}><i style={{ height: `${c * 100}%` }} /><em>{NOTES[i]}</em></span>)}
      </div>
      <div className="lab-feat">
        <span className="dim small">Clipping and load</span>
        <span className="row"><span className={`lab-clip${f.clip ? ' on' : ''}`}>CLIP</span><span className="dim small" title="How much of one CPU core the analysis uses">{(ms / 10).toFixed(1).padStart(4, '\u2007')}% CPU</span></span>
      </div>
    </div>
  )
}

// shaping

const SHAPE_PRESETS: { name: string; about: string; shape: Partial<Shape> }[] = [
  { name: 'Flat', about: 'No change', shape: { hp: 0, lp: 0, low: 0, mid: 0, high: 0, gate: -100, comp: 0, makeup: 0 } },
  { name: 'Room mic', about: 'Cuts rumble and hum, a gate for the noise floor', shape: { hp: 80, lp: 0, low: -3, mid: 0, high: 0, gate: -55, comp: 0, makeup: 0 } },
  { name: 'Voice', about: 'Clearer speech: low cut, a bit of presence, gentle compression', shape: { hp: 100, lp: 12000, low: -2, mid: 3, midHz: 3000, midQ: 0.9, high: 1, gate: -60, comp: -24, ratio: 3, makeup: 4 } },
  { name: 'Loud club', about: 'Very loud, squashed music: more compression so quiet parts still move things', shape: { hp: 30, lp: 0, low: 0, mid: 0, high: 0, gate: -100, comp: -18, ratio: 6, makeup: 6 } },
  { name: 'Kick focus', about: 'Lifts the low end and cuts the rest a bit, for kick-driven visuals', shape: { hp: 25, lp: 6000, low: 6, mid: -4, midHz: 800, midQ: 0.7, high: -6, gate: -100, comp: 0, makeup: 0 } },
]

function ShapePanel() {
  const lab = useLab()
  useTick(80)
  const sh = shapeOf(lab.settings)
  const f = getFrame()?.features
  const row = (label: string, about: string, el: React.ReactNode) => <label className="shape-ctl" title={about}><span className="dim small">{label}</span>{el}</label>
  return (
    <div className="shape-panel">
      <div className="row gap wrap">
        <label className="switch"><input type="checkbox" role="switch" checked={sh.on} onChange={(e) => setShape({ on: e.target.checked })} /><span>Shape the sound</span></label>
        <span className="dim small">Changes what the analysis hears, and what you hear with Listen on. The yellow line on the spectrum shows it.</span>
        <span className="grow" />
        <select className="select mini" value="" onChange={(e) => { const p = SHAPE_PRESETS[Number(e.target.value)]; if (p) setShape({ ...p.shape, on: true }) }}>
          <option value="">Start from...</option>
          {SHAPE_PRESETS.map((p, i) => <option key={p.name} value={i} title={p.about}>{p.name}</option>)}
        </select>
      </div>
      <div className={`shape-grid${sh.on ? '' : ' off'}`}>
        <fieldset><legend>Filters</legend>
          {row('Low cut', 'Removes everything under this (rumble, hum). 0 is off.', <Scrub value={sh.hp} step={1} digits={0} suffix=" Hz" min={0} max={1000} onChange={(v) => setShape({ hp: v })} />)}
          {row('High cut', 'Removes everything over this (hiss). 0 is off.', <Scrub value={sh.lp} step={20} digits={0} suffix=" Hz" min={0} max={20000} onChange={(v) => setShape({ lp: v })} />)}
          {row('Low (120 Hz)', 'Low shelf', <Scrub value={sh.low} step={0.2} digits={1} suffix=" dB" min={-24} max={24} onChange={(v) => setShape({ low: v })} />)}
          {row('Mid', 'A bell you can place anywhere', <Scrub value={sh.mid} step={0.2} digits={1} suffix=" dB" min={-24} max={24} onChange={(v) => setShape({ mid: v })} />)}
          {row('Mid at', 'Where the bell sits', <Scrub value={sh.midHz} step={sh.midHz / 50} digits={0} suffix=" Hz" min={40} max={16000} onChange={(v) => setShape({ midHz: v })} />)}
          {row('Mid width (Q)', 'Higher is narrower', <Scrub value={sh.midQ} step={0.02} digits={2} min={0.1} max={12} onChange={(v) => setShape({ midQ: v })} />)}
          {row('High (6 kHz)', 'High shelf', <Scrub value={sh.high} step={0.2} digits={1} suffix=" dB" min={-24} max={24} onChange={(v) => setShape({ high: v })} />)}
        </fieldset>
        <fieldset><legend>Dynamics</legend>
          {row('Gate', 'Under this level it goes quiet, so room noise does not move anything. -100 is off.', <Scrub value={sh.gate} step={0.5} digits={0} suffix=" dB" min={-100} max={0} onChange={(v) => setShape({ gate: v })} />)}
          <span className="row gap small"><span className={`lab-lamp${f?.gateOpen ? ' on' : ''}`} /> {f?.gateOpen ? 'gate open' : 'gate closed'}</span>
          {row('Compressor at', 'Over this level, loud parts are turned down. 0 is off.', <Scrub value={sh.comp} step={0.5} digits={0} suffix=" dB" min={-60} max={0} onChange={(v) => setShape({ comp: v })} />)}
          {row('Ratio', '4 means 4 dB over becomes 1 dB over', <Scrub value={sh.ratio} step={0.1} digits={1} suffix=":1" min={1} max={30} onChange={(v) => setShape({ ratio: v })} />)}
          {row('Make-up', 'Turns it back up after compressing', <Scrub value={sh.makeup} step={0.2} digits={1} suffix=" dB" min={-24} max={36} onChange={(v) => setShape({ makeup: v })} />)}
          <div className="lab-meter"><span className="dim small">Taking off</span><div className="meter"><i style={{ width: `${Math.min(100, ((f?.reduction ?? 0) / 24) * 100)}%`, background: 'var(--warn)' }} /></div><b>{(f?.reduction ?? 0).toFixed(1)} dB</b></div>
        </fieldset>
        <fieldset><legend>Listening</legend>
          {row('Listen volume', 'Only what you hear. The analysis does not change.', <Scrub value={sh.monitor} step={0.5} digits={1} suffix=" dB" min={-60} max={12} onChange={(v) => setShape({ monitor: v })} />)}
          <label className="switch mini"><input type="checkbox" role="switch" checked={lab.monitor} onChange={(e) => setMonitor(e.target.checked)} /><span>Listen</span></label>
          <p className="dim small">System audio from RICO is already playing on your speakers, so Listen is not needed for it. The shaping still changes its analysis.</p>
        </fieldset>
      </div>
    </div>
  )
}

// what is playing

const KIND_COLORS = ['#6c7a66', '#30e0ff', '#3bff03', '#ff8a3d']
const KIND_IDS = ['silence', 'speech', 'music', 'foley']

function KindHistory() {
  const hist = useRef<number[][]>([])
  const ref = useCanvas((g, w, h) => {
    const f = getFrame()?.features
    if (f?.kinds) { hist.current.push([...f.kinds]); if (hist.current.length > 600) hist.current.shift() }
    g.fillStyle = '#000'
    g.fillRect(0, 0, w, h)
    const list = hist.current
    const step = w / 600
    list.forEach((k, i) => {
      let y = h
      k.forEach((v, j) => { const hh = v * h; g.fillStyle = KIND_COLORS[j]; g.fillRect(w - (list.length - i) * step, y - hh, Math.ceil(step) + 0.5, hh); y -= hh })
    })
  })
  return <canvas ref={ref} className="kind-history" title="The last 10 seconds: how sure it is about each kind, stacked" />
}

function ScenePanel() {
  const lab = useLab()
  useTick(80)
  const tune = sceneOf(lab.settings)
  const f = getFrame()?.features
  const best = f?.kinds ? f.kinds.indexOf(Math.max(...f.kinds)) : 0
  const rename = (i: number, v: string) => { const names = [...tune.names] as typeof tune.names; names[i] = v; setSceneTune({ names }) }
  return (
    <div className="scene-panel">
      <div className="row gap wrap">
        <b>What is playing</b>
        <span className="big-kind" style={{ color: KIND_COLORS[best] }}>{f ? tune.names[best] : '-'}</span>
        <span className="grow" />
        <span className="dim small">Rename the kinds for your show. Their signals keep working.</span>
      </div>
      <KindHistory />
      <div className="kind-grid">
        {tune.names.map((name, i) => (
          <div key={i} className={`kind-card${best === i ? ' on' : ''}`} style={{ borderColor: KIND_COLORS[i] }}>
            <input className="input kind-name" value={name} onChange={(e) => rename(i, e.target.value)} style={{ color: KIND_COLORS[i] }} aria-label="Name" />
            <div className="lab-meter"><span className="dim small">Sure</span><div className="meter"><i style={{ width: `${(f?.kinds?.[i] ?? 0) * 100}%`, background: KIND_COLORS[i] }} /></div><b>{Math.round((f?.kinds?.[i] ?? 0) * 100)}%</b></div>
            {i > 0 && <div className="lab-meter"><span className="dim small">Level</span><div className="meter"><i style={{ width: `${(f?.kindLevels?.[i] ?? 0) * 100}%`, background: KIND_COLORS[i] }} /></div><b>{Math.round((f?.kindLevels?.[i] ?? 0) * 100)}%</b></div>}
            {i === 0
              ? <label className="shape-ctl" title="Under this loudness it counts as silence"><span className="dim small">Silent under</span><Scrub value={tune.silence} step={0.5} digits={0} suffix=" LUFS" min={-80} max={-10} onChange={(v) => setSceneTune({ silence: v })} /></label>
              : <label className="shape-ctl" title="Move right if it misses this kind, left if it sees it too often"><span className="dim small">Bias</span><Scrub value={tune[KIND_IDS[i] as 'speech' | 'music' | 'foley']} step={0.01} digits={2} min={-1} max={1} onChange={(v) => setSceneTune({ [KIND_IDS[i]]: v })} /></label>}
            <span className="row gap">
              <span className="lab-sig" draggable title="Drag onto any setting: how sure it is" onDragStart={(e) => e.dataTransfer.setData(SIGNAL_DRAG, `audio:is:${KIND_IDS[i]}`)}>audio:is:{KIND_IDS[i]}</span>
              {i > 0 && <span className="lab-sig" draggable title="Drag onto any setting: how loud this kind is" onDragStart={(e) => e.dataTransfer.setData(SIGNAL_DRAG, `audio:${KIND_IDS[i]}`)}>audio:{KIND_IDS[i]}</span>}
            </span>
          </div>
        ))}
      </div>
      <div className="row gap wrap">
        <label className="shape-ctl" title="How fast it changes its mind"><span className="dim small">Steadiness</span><Scrub value={tune.smooth} step={0.02} digits={2} suffix=" s" min={0.05} max={5} onChange={(v) => setSceneTune({ smooth: v })} /></label>
        <div className="lab-meter"><span className="dim small">Harmonic part</span><div className="meter"><i style={{ width: `${(f?.harmonic ?? 0) * 100}%`, background: '#b48cff' }} /></div></div>
        <div className="lab-meter"><span className="dim small">Percussive part</span><div className="meter"><i style={{ width: `${(f?.percussive ?? 0) * 100}%`, background: '#f820a0' }} /></div></div>
        <span className="lab-sig" draggable onDragStart={(e) => e.dataTransfer.setData(SIGNAL_DRAG, 'audio:harmonic')}>audio:harmonic</span>
        <span className="lab-sig" draggable onDragStart={(e) => e.dataTransfer.setData(SIGNAL_DRAG, 'audio:percussive')}>audio:percussive</span>
      </div>
      <p className="dim small">How it decides: speech moves at the speed of syllables (about 4 times a second), has short pauses and a voice pitch that comes and goes. Music has a steady beat, held notes and few pauses. Foley and effects are hits and noise without a beat or a voice. It works on the mix as it plays, with no internet and no AI model, so it tells you what is playing and how loud each kind is. It does not cut the mix into separate files: for that you need stems from the source.</p>
    </div>
  )
}

function BandRow({ b, i, selected, onSelect }: { b: Band; i: number; selected: boolean; onSelect: () => void }) {
  const meter = useRef<HTMLElement | null>(null)
  const lamp = useRef<HTMLElement | null>(null)
  useEffect(() => {
    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const f = getFrame()
      if (meter.current) meter.current.style.width = `${(f?.bands[i] ?? 0) * 100}%`
      if (lamp.current) lamp.current.style.opacity = String(0.15 + (f?.hits[i] ?? 0) * 0.85)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [i])
  const up = (part: Partial<Band>) => updateBand(b.id, part)
  return (
    <tr className={selected ? 'on' : ''} onClick={onSelect}>
      <td><input type="checkbox" checked={b.on} onChange={(e) => up({ on: e.target.checked })} title="On" /></td>
      <td><input type="color" className="swatch mini" value={b.color.startsWith('#') ? b.color : '#3bff03'} onChange={(e) => up({ color: e.target.value })} /></td>
      <td><input className="input lab-name" value={b.name} onChange={(e) => up({ name: e.target.value })} /></td>
      <td className="num"><Scrub value={b.lo} step={b.lo / 50} digits={0} suffix=" Hz" min={10} max={b.hi - 1} onChange={(v) => up({ lo: v })} /></td>
      <td className="num"><Scrub value={b.hi} step={b.hi / 50} digits={0} suffix=" Hz" min={b.lo + 1} max={22000} onChange={(v) => up({ hi: v })} /></td>
      <td>
        <select className="select mini" value={b.mode} onChange={(e) => up({ mode: e.target.value as Band['mode'] })}>
          <option value="energy">Level</option><option value="peak">Peak</option><option value="hit">Hits</option>
        </select>
      </td>
      <td className="num"><Scrub value={b.gain} step={0.2} digits={1} suffix=" dB" min={-36} max={36} onChange={(v) => up({ gain: v })} /></td>
      <td><label className="mini-check"><input type="checkbox" checked={b.auto} onChange={(e) => up({ auto: e.target.checked })} />Auto</label></td>
      <td className="num" title="dB that becomes 0">{b.auto ? <span className="dim">range</span> : <Scrub value={b.floor} step={0.5} digits={0} suffix=" dB" min={-120} max={b.ceiling - 3} onChange={(v) => up({ floor: v })} />}</td>
      <td className="num" title={b.auto ? 'How many dB under the loudest moment still count' : 'dB that becomes 1'}>
        {b.auto
          ? <Scrub value={b.ceiling - b.floor} step={0.5} digits={0} suffix=" dB" min={6} max={90} onChange={(v) => up({ floor: b.ceiling - v })} />
          : <Scrub value={b.ceiling} step={0.5} digits={0} suffix=" dB" min={b.floor + 3} max={12} onChange={(v) => up({ ceiling: v })} />}
      </td>
      <td className="num"><Scrub value={b.attack} step={1} digits={0} suffix=" ms" min={0} max={2000} onChange={(v) => up({ attack: v })} /></td>
      <td className="num"><Scrub value={b.release} step={2} digits={0} suffix=" ms" min={5} max={5000} onChange={(v) => up({ release: v })} /></td>
      <td className="num" title="Response curve: under 1 is more reactive at the bottom, over 1 only reacts to the loud parts"><Scrub value={b.curve} step={0.01} digits={2} min={0.2} max={4} onChange={(v) => up({ curve: v })} /></td>
      <td className="num" title="Gate: below this the band stays at 0"><Scrub value={b.gate * 100} step={0.5} digits={0} suffix="%" min={0} max={95} onChange={(v) => up({ gate: v / 100 })} /></td>
      <td className="num" title="Hit sensitivity"><Scrub value={b.sens * 100} step={0.5} digits={0} suffix="%" min={0} max={100} onChange={(v) => up({ sens: v / 100 })} /></td>
      <td className="lab-live"><div className="meter"><i ref={meter} style={{ background: b.color }} /></div><i ref={lamp} className="lab-lamp on" style={{ background: b.color }} /></td>
      <td>
        <span className="lab-sig" draggable title="Drag onto any setting to link it" onDragStart={(e) => e.dataTransfer.setData(SIGNAL_DRAG, `audio:${b.id}`)}>audio:{b.id}</span>
      </td>
      <td><button className="icon-btn small danger" title="Remove band" onClick={(e) => { e.stopPropagation(); removeBand(b.id) }}><Icon name="x" /></button></td>
    </tr>
  )
}

export default function AudioLab() {
  const lab = useLab()
  const [mics, setMics] = useState<MediaDeviceInfo[]>([])
  const [engineDevices, setEngineDevices] = useState<string[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [view, setView] = useState<'waterfall' | 'scope' | 'none'>('waterfall')
  const [tab, setTab] = useState<'bands' | 'shape' | 'scene'>('bands')
  const live = rico.get().status === 'live'
  const source: SourceKind = lab.source === 'rico' && !live ? 'demo' : lab.source

  useEffect(() => {
    if (source === 'mic') inputDevices().then(setMics)
    if (source === 'rico' && live) rico.send('audio.devices').then((a) => setEngineDevices((a.devices as string[] | undefined) ?? []))
  }, [source, live, lab.running])

  return (
    <div className="dpanel lab">
      <div className="lab-bar">
        <select className="select" value={source} onChange={(e) => void start(e.target.value as SourceKind, '')}>
          {(Object.keys(SOURCE_LABEL) as SourceKind[]).map((k) => <option key={k} value={k} disabled={k === 'rico' && !live}>{SOURCE_LABEL[k]}{k === 'rico' && !live ? ' (in the app)' : ''}</option>)}
        </select>
        {source === 'mic' && (
          <select className="select" value={lab.device} onChange={(e) => void start('mic', e.target.value)}>
            <option value="">Default input</option>
            {mics.map((m) => <option key={m.deviceId} value={m.deviceId}>{m.label || 'Input'}</option>)}
          </select>
        )}
        {source === 'rico' && engineDevices.length > 0 && (
          <select className="select" value={lab.device || '0'} onChange={(e) => void start('rico', e.target.value)}>
            {engineDevices.map((d, i) => <option key={d + i} value={String(i)}>{d}</option>)}
          </select>
        )}
        <button className={`btn small ${lab.running ? 'out' : 'primary'}`} onClick={() => (lab.running ? stop() : void start(source))}>{lab.running ? 'Stop' : 'Start'}</button>
        <label className="switch mini" title="Hear the input through your speakers"><input type="checkbox" role="switch" checked={lab.monitor} onChange={(e) => setMonitor(e.target.checked)} /><span>Listen</span></label>
        <span className={`small ${lab.running ? 'lime' : 'dim'}`}>{lab.status}</span>
        <span className="grow" />
        <label className="mini">Input <Scrub value={lab.settings.inputGain} step={0.2} digits={1} suffix=" dB" min={-30} max={30} onChange={(v) => setSettings((s) => ({ ...s, inputGain: v }))} /></label>
        <label className="mini" title="More points: finer low notes, a bit slower to react">Detail
          <select className="select mini" value={lab.settings.fftSize} onChange={(e) => setSettings((s) => ({ ...s, fftSize: Number(e.target.value) }))}>
            {[1024, 2048, 4096, 8192, 16384].map((n) => <option key={n} value={n}>{n} ({(48000 / n).toFixed(1)} Hz)</option>)}
          </select></label>
        <label className="mini" title="A-weighting hears like an ear: less low end">Weighting
          <select className="select mini" value={lab.settings.weighting} onChange={(e) => setSettings((s) => ({ ...s, weighting: e.target.value as 'none' | 'a' }))}>
            <option value="none">Flat</option><option value="a">A (like an ear)</option>
          </select></label>
      </div>
      <div className="lab-views">
        <Spectrum selected={selected} onSelect={setSelected} />
        <div className="lab-side">
          <div className="seg">
            {(['waterfall', 'scope', 'none'] as const).map((v) => <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>{v === 'waterfall' ? 'Spectrogram' : v === 'scope' ? 'Wave' : 'Hide'}</button>)}
          </div>
          {view === 'waterfall' && <Waterfall />}
          {view === 'scope' && <Scope />}
        </div>
      </div>
      <Features />
      <div className="seg lab-tabs" role="tablist">
        {([['bands', 'Bands'], ['shape', 'Shape the sound'], ['scene', 'What is playing']] as const).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      {tab === 'shape' && <ShapePanel />}
      {tab === 'scene' && <ScenePanel />}
      {tab === 'bands' && <>
      <div className="lab-bands-bar">
        <b>Bands</b>
        <span className="dim small">Every band is a signal you can link. Level follows how loud it is; Hits pulses on each attack.</span>
        <span className="grow" />
        <select className="select mini" value="" onChange={(e) => e.target.value && usePreset(e.target.value)}>
          <option value="">Load a set of bands...</option>
          {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button className="btn small primary" onClick={() => setSelected(addBand())}>+ Band</button>
      </div>
      <div className="lab-table-wrap">
        <table className="lab-table">
          <thead><tr><th /><th /><th>Name</th><th>From</th><th>To</th><th>Type</th><th>Gain</th><th /><th>Floor</th><th>Range / top</th><th>Attack</th><th>Release</th><th>Curve</th><th>Gate</th><th>Hit sens.</th><th>Now</th><th>Signal</th><th /></tr></thead>
          <tbody>{lab.settings.bands.map((b, i) => <BandRow key={b.id} b={b} i={i} selected={selected === b.id} onSelect={() => setSelected(b.id)} />)}</tbody>
        </table>
      </div>
      </>}
    </div>
  )
}
