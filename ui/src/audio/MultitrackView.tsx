import { useEffect, useRef, useState } from 'react'
import Scrub from '../components/Scrub'
import { toast } from '../components/Toasts'
import { useCanvas } from '../components/useCanvas'
import { useTick } from '../engine/useTick'
import { downloadBlob, pickFile } from '../shell/ui'
import {
  FX_INFO, addNoteClip, addTrack, beat, bufferOf, change, duplicateClip, importFile, listenMidi, meterOf, moveTrack, newFx, noteOff, noteOn,
  position, redo, removeClip, removeTrack, saveMixdown, seekTo, selectClip, selectTrack, sessionEnd, snapTime, splitClip, startPlay, startRecord,
  startSession, stopPlay, stopRecord, undo, updateClip, updateTrack, useSession,
  type AudioClip, type FxType, type NoteClip, type SClip, type STrack, type TrackFx,
} from './session'
import { SYNTH_PRESETS } from './synth'

// The multitrack view of the sound editor. Tracks on the left (record arm,
// input monitor, mute, solo, volume, pan, meter), clips on the timeline,
// and below: the selected track's live effects, or the selected clip.

const TRACK_H = 74
const fmtTime = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`
const fmtBars = (t: number) => { const b = beat(); const beats = t / b; return `${Math.floor(beats / 4) + 1}.${Math.floor(beats % 4) + 1}.${Math.floor((beats % 1) * 4) + 1}` }

// Waveform peaks per sound, worked out once.
const peaks = new Map<string, { per: number; mn: Float32Array; mx: Float32Array }>()
function peaksOf(source: string) {
  const hit = peaks.get(source)
  if (hit) return hit
  const b = bufferOf(source)
  if (!b) return null
  const per = Math.max(1, Math.floor(b.sampleRate / 400))
  const n = Math.ceil(b.length / per)
  const mn = new Float32Array(n), mx = new Float32Array(n)
  const chans = Array.from({ length: b.numberOfChannels }, (_, i) => b.getChannelData(i))
  for (let k = 0; k < n; k++) {
    let lo = 0, hi = 0
    for (let i = k * per; i < Math.min(b.length, (k + 1) * per); i++) for (const d of chans) { if (d[i] < lo) lo = d[i]; if (d[i] > hi) hi = d[i] }
    mn[k] = lo; mx[k] = hi
  }
  const p = { per, mn, mx }
  peaks.set(source, p)
  return p
}

function ClipView({ clip, track, pps, selected, onOpen }: { clip: SClip; track: STrack; pps: number; selected: boolean; onOpen: (c: SClip) => void }) {
  const w = Math.max(4, clip.length * pps)
  const ref = useCanvas((g, cw, ch) => {
    g.clearRect(0, 0, cw, ch)
    g.fillStyle = track.color
    if (clip.kind === 'audio') {
      const p = peaksOf(clip.source)
      const b = bufferOf(clip.source)
      if (!p || !b) { g.font = '10px "Courier Prime", monospace'; g.fillText('loading...', 4, ch / 2); return }
      const mid = ch / 2
      for (let x = 0; x < cw; x++) {
        const t = clip.offset + (x / cw) * clip.length
        const k = Math.floor((t * b.sampleRate) / p.per)
        if (k < 0 || k >= p.mn.length) continue
        g.fillRect(x, mid - p.mx[k] * mid * 0.95, 1, Math.max(1, (p.mx[k] - p.mn[k]) * mid * 0.95))
      }
      // fades
      g.strokeStyle = 'rgba(255,255,255,0.8)'
      g.beginPath()
      g.moveTo(0, ch); g.lineTo((clip.fadeIn / clip.length) * cw, 0); g.lineTo(cw - (clip.fadeOut / clip.length) * cw, 0); g.lineTo(cw, ch)
      g.stroke()
    } else {
      const ns = clip.notes
      if (!ns.length) return
      const lo = Math.min(...ns.map((n) => n.n)) - 1, hi = Math.max(...ns.map((n) => n.n)) + 1
      const rowH = ch / Math.max(6, hi - lo + 1)
      for (const n of ns) g.fillRect((n.t / clip.length) * cw, ch - (n.n - lo + 1) * rowH, Math.max(2, (n.d / clip.length) * cw), Math.max(2, rowH - 1))
    }
  }, [clip, track.color, pps])

  const drag = (e: React.PointerEvent, part: 'move' | 'left' | 'right' | 'fadeIn' | 'fadeOut') => {
    e.stopPropagation()
    if (e.button !== 0) return
    selectClip(clip.id)
    const x0 = e.clientX, y0 = e.clientY
    const start = { ...clip } as SClip
    const lane = (e.currentTarget as HTMLElement).closest('.ses-lanes') as HTMLElement | null
    const move = (ev: PointerEvent) => {
      const dt = (ev.clientX - x0) / pps
      const merge = `clip.${clip.id}.${part}`
      if (part === 'move') {
        let track = start.track
        if (lane) {
          const rows = [...lane.querySelectorAll<HTMLElement>('.ses-lane')]
          const r = rows.find((el) => { const b = el.getBoundingClientRect(); return ev.clientY >= b.top && ev.clientY < b.bottom })
          const want = r?.dataset.track
          const kindOk = (id: string | undefined) => id && (document.querySelector(`.ses-lane[data-track="${id}"]`) as HTMLElement | null)?.dataset.kind === (clip.kind === 'audio' ? 'audio' : 'instrument')
          if (Math.abs(ev.clientY - y0) > 10 && kindOk(want)) track = want!
        }
        updateClip(clip.id, { start: Math.max(0, snapTime(start.start + dt, !ev.altKey && undefined)), track }, 'Move clip', merge)
      } else if (part === 'left') {
        const nt = Math.max(0, Math.min(start.start + start.length - 0.02, snapTime(start.start + dt, !ev.altKey && undefined)))
        const d = nt - start.start
        if (start.kind === 'audio') {
          const off = start.offset + d
          if (off < 0) return
          updateClip(clip.id, { start: nt, offset: off, length: start.length - d } as Partial<AudioClip>, 'Trim clip', merge)
        } else {
          updateClip(clip.id, { start: nt, length: start.length - d, notes: start.notes.map((n) => ({ ...n, t: n.t - d })).filter((n) => n.t >= 0) } as Partial<NoteClip>, 'Trim clip', merge)
        }
      } else if (part === 'right') {
        let len = Math.max(0.02, snapTime(start.start + start.length + dt, !ev.altKey && undefined) - start.start)
        if (start.kind === 'audio') { const b = bufferOf(start.source); if (b) len = Math.min(len, b.duration - start.offset) }
        updateClip(clip.id, { length: len }, 'Trim clip', merge)
      } else if (part === 'fadeIn' && start.kind === 'audio') {
        updateClip(clip.id, { fadeIn: Math.max(0, Math.min(start.length - start.fadeOut, start.fadeIn + dt)) } as Partial<AudioClip>, 'Fade in', merge)
      } else if (part === 'fadeOut' && start.kind === 'audio') {
        updateClip(clip.id, { fadeOut: Math.max(0, Math.min(start.length - start.fadeIn, start.fadeOut - dt)) } as Partial<AudioClip>, 'Fade out', merge)
      }
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className={`ses-clip ${clip.kind}${selected ? ' on' : ''}`} style={{ left: clip.start * pps, width: w, borderColor: track.color, background: `color-mix(in srgb, ${track.color} 14%, #000)` }}
      onPointerDown={(e) => drag(e, 'move')} onDoubleClick={(e) => { e.stopPropagation(); onOpen(clip) }}
      title={`${clip.name}. Drag to move (Alt: no snap), drag the edges to trim, the top corners to fade. Double-click to edit. S splits at the playhead.`}>
      <span className="ses-clip-name">{clip.name}</span>
      <canvas ref={ref} className="ses-clip-wave" />
      <i className="ses-trim left" onPointerDown={(e) => drag(e, 'left')} />
      <i className="ses-trim right" onPointerDown={(e) => drag(e, 'right')} />
      {clip.kind === 'audio' && <><i className="ses-fade in" style={{ left: (clip.fadeIn / clip.length) * w }} onPointerDown={(e) => drag(e, 'fadeIn')} /><i className="ses-fade out" style={{ right: (clip.fadeOut / clip.length) * w }} onPointerDown={(e) => drag(e, 'fadeOut')} /></>}
    </div>
  )
}

function TrackMeter({ id }: { id: string }) {
  const bar = useRef<HTMLElement | null>(null)
  useEffect(() => {
    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const p = meterOf(id)
      const db = 20 * Math.log10(p + 1e-9)
      if (bar.current) { bar.current.style.width = `${Math.max(0, Math.min(1, (db + 60) / 60)) * 100}%`; bar.current.style.background = p >= 0.99 ? 'var(--pink)' : '' }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [id])
  return <div className="meter ses-meter"><i ref={bar} /></div>
}

function TrackHead({ t, selected }: { t: STrack; selected: boolean }) {
  const up = (part: Partial<STrack>, label?: string) => updateTrack(t.id, part, label)
  return (
    <div className={`ses-head${selected ? ' on' : ''}`} style={{ height: TRACK_H, borderLeftColor: t.color }} onPointerDown={() => selectTrack(t.id)}>
      <div className="row gap">
        <input type="color" className="swatch mini" value={t.color} onChange={(e) => up({ color: e.target.value }, 'Track color')} title="Color" />
        <input className="input ses-name" value={t.name} onChange={(e) => up({ name: e.target.value }, 'Rename track')} />
        <span className={`ses-kind ${t.kind}`}>{t.kind === 'audio' ? 'audio' : 'instr'}</span>
      </div>
      <div className="row gap ses-btns">
        <button className={`ses-btn arm${t.arm ? ' on' : ''}`} title="Record arm: this track records" onClick={() => up({ arm: !t.arm }, 'Arm track')}>R</button>
        {t.kind === 'audio' && <button className={`ses-btn mon${t.monitor ? ' on' : ''}`} title="Input monitor: hear the mic through this track's effects while recording" onClick={() => up({ monitor: !t.monitor }, 'Input monitor')}>I</button>}
        <button className={`ses-btn mute${t.mute ? ' on' : ''}`} title="Mute" onClick={() => up({ mute: !t.mute }, 'Mute')}>M</button>
        <button className={`ses-btn solo${t.solo ? ' on' : ''}`} title="Solo" onClick={() => up({ solo: !t.solo }, 'Solo')}>S</button>
        <Scrub value={t.vol} step={0.2} digits={1} suffix=" dB" min={-60} max={12} onChange={(v) => up({ vol: v }, 'Volume')} />
        <Scrub value={t.pan * 100} step={1} digits={0} suffix={t.pan < 0 ? ' L' : t.pan > 0 ? ' R' : ' C'} min={-100} max={100} onChange={(v) => up({ pan: v / 100 }, 'Pan')} />
      </div>
      <div className="row gap">
        <TrackMeter id={t.id} />
        <span className="dim small" title="Effects on this track">{t.fx.length ? `fx ${t.fx.filter((f) => f.on).length}` : ''}</span>
      </div>
    </div>
  )
}

function FxCard({ t, f, i }: { t: STrack; f: TrackFx; i: number }) {
  const info = FX_INFO[f.type]
  const set = (fx: TrackFx[], label: string, merge?: string) => updateTrack(t.id, { fx }, label, merge)
  return (
    <div className={`fx-card${f.on ? '' : ' off'}`}>
      <div className="fx-head">
        <button className={`fx-on${f.on ? ' on' : ''}`} onClick={() => set(t.fx.map((x) => (x.id === f.id ? { ...x, on: !x.on } : x)), 'Effect on/off')}>fx</button>
        <b title={info.about}>{info.name}</b>
        <span className="grow" />
        <button className="icon-btn small" disabled={i === 0} title="Earlier" onClick={() => { const a = [...t.fx]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; set(a, 'Reorder effects') }}>{'▲'}</button>
        <button className="icon-btn small" disabled={i === t.fx.length - 1} title="Later" onClick={() => { const a = [...t.fx]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; set(a, 'Reorder effects') }}>{'▼'}</button>
        <button className="icon-btn small danger" title="Remove" onClick={() => set(t.fx.filter((x) => x.id !== f.id), 'Remove effect')}>{'×'}</button>
      </div>
      <div className="fx-body ses-fx-body">
        {info.params.map((p) => (
          <label key={p.k} className="shape-ctl"><span className="dim small">{p.label}</span>
            {p.choices
              ? <select className="select mini" value={Math.round(f.p[p.k] ?? p.def)} onChange={(e) => set(t.fx.map((x) => (x.id === f.id ? { ...x, p: { ...x.p, [p.k]: Number(e.target.value) } } : x)), 'Change effect')}>{p.choices.map((c, k) => <option key={c} value={k}>{c}</option>)}</select>
              : <Scrub value={f.p[p.k] ?? p.def} step={p.step} digits={p.digits ?? 1} suffix={p.suffix} min={p.min} max={p.max}
                onChange={(v) => set(t.fx.map((x) => (x.id === f.id ? { ...x, p: { ...x.p, [p.k]: v } } : x)), 'Change effect', `fx.${f.id}.${p.k}`)} />}
          </label>
        ))}
      </div>
    </div>
  )
}

function TrackInspector({ t }: { t: STrack }) {
  return (
    <div className="ses-insp">
      <div className="row gap wrap">
        <b style={{ color: t.color }}>{t.name}</b>
        <span className="dim small">Live effects, in order. You hear changes right away, while playing or recording.</span>
        <span className="grow" />
        <select className="select mini" value="" onChange={(e) => { const ty = e.target.value as FxType; if (ty) updateTrack(t.id, { fx: [...t.fx, newFx(ty)] }, 'Add effect') }}>
          <option value="">+ Add an effect...</option>
          {(Object.keys(FX_INFO) as FxType[]).map((k) => <option key={k} value={k}>{FX_INFO[k].name}: {FX_INFO[k].about}</option>)}
        </select>
        <button className="btn small quiet" onClick={() => moveTrack(t.id, -1)}>Move up</button>
        <button className="btn small quiet" onClick={() => moveTrack(t.id, 1)}>Move down</button>
        <button className="btn small out" onClick={() => removeTrack(t.id)}>Delete track</button>
      </div>
      {t.kind === 'instrument' && t.synth && (
        <div className="row gap wrap ses-synth">
          <label className="mini">Sound
            <select className="select mini" value={t.synth.name} onChange={(e) => { const p = SYNTH_PRESETS.find((x) => x.name === e.target.value); if (p) updateTrack(t.id, { synth: { ...p } }, 'Change instrument') }}>
              {!SYNTH_PRESETS.some((p) => p.name === t.synth!.name) && <option value={t.synth.name}>{t.synth.name}</option>}
              {SYNTH_PRESETS.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
            </select></label>
          <label className="mini">Attack <Scrub value={t.synth.attack} step={0.002} digits={3} suffix=" s" min={0} max={10} onChange={(v) => updateTrack(t.id, { synth: { ...t.synth!, attack: v } })} /></label>
          <label className="mini">Release <Scrub value={t.synth.release} step={0.005} digits={3} suffix=" s" min={0.005} max={10} onChange={(v) => updateTrack(t.id, { synth: { ...t.synth!, release: v } })} /></label>
          <label className="mini">Cutoff <Scrub value={t.synth.cutoff} step={10} digits={0} suffix=" Hz" min={20} max={20000} onChange={(v) => updateTrack(t.id, { synth: { ...t.synth!, cutoff: v, filter: t.synth!.filter === 'none' ? 'lowpass' : t.synth!.filter } })} /></label>
          <label className="mini">Volume <Scrub value={t.synth.volume} step={0.2} digits={1} suffix=" dB" min={-48} max={6} onChange={(v) => updateTrack(t.id, { synth: { ...t.synth!, volume: v } })} /></label>
          <span className="dim small">Make your own sound in the generator and press "Use on instrument track".</span>
        </div>
      )}
      <div className="ses-fx-list">
        {t.fx.length === 0 && <p className="dim small">No effects yet. A usual chain: EQ, Compressor, then Echo or Reverb.</p>}
        {t.fx.map((f, i) => <FxCard key={f.id} t={t} f={f} i={i} />)}
      </div>
    </div>
  )
}

// A small piano roll for a note clip: click to add a note, drag to move,
// drag the right end to make it longer, right-click to delete.
function PianoRoll({ clip, track }: { clip: NoteClip; track: STrack }) {
  const LO = 36, HI = 84
  const ROW = 9
  const pps = 120
  const H = (HI - LO + 1) * ROW
  const W = Math.max(400, clip.length * pps)
  const ref = useCanvas((g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h)
    for (let n = LO; n <= HI; n++) {
      const y = (HI - n) * ROW
      if ([1, 3, 6, 8, 10].includes(n % 12)) { g.fillStyle = 'rgba(255,255,255,0.04)'; g.fillRect(0, y, w, ROW) }
      if (n % 12 === 0) { g.fillStyle = 'rgba(185,194,180,0.6)'; g.font = '9px "Courier Prime", monospace'; g.fillText(`C${n / 12 - 1}`, 2, y + ROW - 1) }
    }
    const b = beat()
    for (let k = 0; k * b / 4 < clip.length; k++) { g.fillStyle = k % 16 === 0 ? 'rgba(59,255,3,0.35)' : k % 4 === 0 ? 'rgba(59,255,3,0.15)' : 'rgba(59,255,3,0.05)'; g.fillRect((k * b / 4) * pps, 0, 1, h) }
    g.fillStyle = track.color
    for (const n of clip.notes) { g.globalAlpha = 0.4 + n.v * 0.6; g.fillRect(n.t * pps, (HI - n.n) * ROW + 1, Math.max(3, n.d * pps - 1), ROW - 2) }
    g.globalAlpha = 1
    const ph = position() - clip.start
    if (ph >= 0 && ph <= clip.length) { g.fillStyle = '#f820a0'; g.fillRect(ph * pps, 0, 2, h) }
  }, [clip, track.color])
  const at = (e: React.PointerEvent | React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return { t: (e.clientX - r.left) / pps, n: HI - Math.floor((e.clientY - r.top) / ROW) }
  }
  const setNotes = (notes: NoteClip['notes'], label: string, merge?: string) => updateClip(clip.id, { notes } as Partial<NoteClip>, label, merge)
  return (
    <div className="ses-roll-wrap">
      <canvas ref={ref} className="ses-roll" style={{ width: W, height: H }}
        onContextMenu={(e) => {
          e.preventDefault()
          const p = at(e)
          setNotes(clip.notes.filter((n) => !(n.n === p.n && p.t >= n.t && p.t <= n.t + n.d)), 'Delete note')
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          const p = at(e)
          const step = beat() / 4
          let idx = clip.notes.findIndex((n) => n.n === p.n && p.t >= n.t && p.t <= n.t + n.d)
          let notes = clip.notes
          if (idx < 0) {
            notes = [...clip.notes, { t: Math.max(0, Math.floor(p.t / step) * step), d: step, n: p.n, v: 0.8 }]
            idx = notes.length - 1
            setNotes(notes, 'Add note')
            void noteOn(p.n, 0.8); window.setTimeout(() => noteOff(p.n), 150)
          }
          const n0 = notes[idx]
          const resize = p.t > n0.t + n0.d - Math.min(0.06, n0.d / 3)
          const x0 = e.clientX, y0 = e.clientY
          ;(e.target as Element).setPointerCapture(e.pointerId)
          const move = (ev: PointerEvent) => {
            const dt = (ev.clientX - x0) / pps, dn = -Math.round((ev.clientY - y0) / ROW)
            const snapT = (t: number) => (ev.altKey ? t : Math.round(t / step) * step)
            const next = notes.map((n, i) => (i !== idx ? n : resize ? { ...n, d: Math.max(step / 4, snapT(n0.d + dt)) } : { ...n, t: Math.max(0, snapT(n0.t + dt)), n: Math.max(LO, Math.min(HI, n0.n + dn)) }))
            setNotes(next, resize ? 'Note length' : 'Move note', `roll.${clip.id}`)
          }
          const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
          window.addEventListener('pointermove', move)
          window.addEventListener('pointerup', up)
        }} />
    </div>
  )
}

function ClipInspector({ clip, track, onOpen }: { clip: SClip; track: STrack; onOpen: (c: SClip) => void }) {
  return (
    <div className="ses-insp">
      <div className="row gap wrap">
        <input className="input" value={clip.name} onChange={(e) => updateClip(clip.id, { name: e.target.value }, 'Rename clip', `name.${clip.id}`)} style={{ width: 160 }} />
        <span className="dim small">on {track.name}, {fmtTime(clip.start)} for {clip.length.toFixed(2)} s</span>
        {clip.kind === 'audio' && <>
          <label className="mini">Gain <Scrub value={clip.gain} step={0.2} digits={1} suffix=" dB" min={-60} max={24} onChange={(v) => updateClip(clip.id, { gain: v } as Partial<AudioClip>, 'Clip gain', `gain.${clip.id}`)} /></label>
          <label className="mini">Fade in <Scrub value={clip.fadeIn} step={0.01} digits={2} suffix=" s" min={0} max={clip.length} onChange={(v) => updateClip(clip.id, { fadeIn: v } as Partial<AudioClip>, 'Fade in', `fi.${clip.id}`)} /></label>
          <label className="mini">Fade out <Scrub value={clip.fadeOut} step={0.01} digits={2} suffix=" s" min={0} max={clip.length} onChange={(v) => updateClip(clip.id, { fadeOut: v } as Partial<AudioClip>, 'Fade out', `fo.${clip.id}`)} /></label>
          <button className="btn small primary" onClick={() => onOpen(clip)}>Edit the sound (waveform)</button>
        </>}
        {clip.kind === 'notes' && <>
          <button className="btn small quiet" onClick={() => { const st = beat() / 4; updateClip(clip.id, { notes: clip.notes.map((n) => ({ ...n, t: Math.round(n.t / st) * st })) } as Partial<NoteClip>, 'Quantize') }}>Quantize to 1/16</button>
          <span className="dim small">Click to add a note, drag to move, drag its end to lengthen, right-click to delete.</span>
        </>}
        <span className="grow" />
        <button className="btn small quiet" onClick={() => splitClip(clip.id, position())}>Split at playhead (S)</button>
        <button className="btn small quiet" onClick={() => duplicateClip(clip.id)}>Duplicate (Ctrl+D)</button>
        <button className="btn small out" onClick={() => removeClip(clip.id)}>Delete</button>
      </div>
      {clip.kind === 'notes' && <PianoRoll clip={clip} track={track} />}
    </div>
  )
}

const KEYS = 'awsedftgyhujkolp;'
export default function SessionView({ onOpenClip }: { onOpenClip: (c: AudioClip) => void }) {
  const ses = useSession()
  const s = ses.session
  const [pps, setPps] = useState(60)
  const [octave, setOctave] = useState(4)
  const [keysOn, setKeysOn] = useState(true)
  const [busy, setBusy] = useState(false)
  const lanes = useRef<HTMLDivElement | null>(null)
  const down = useRef(new Set<string>())
  useTick(ses.playing ? 33 : 250)
  useEffect(() => { void startSession(); listenMidi() }, [])

  const end = Math.max(sessionEnd() + 8, 30)
  const width = end * pps
  const pos = position()
  const selClip = s.clips.find((c) => c.id === ses.selectedClip)
  const selTrack = s.tracks.find((t) => t.id === ses.selectedTrack)

  // Keep the playhead in view while playing.
  useEffect(() => {
    const el = lanes.current
    if (!el || !ses.playing) return
    const x = pos * pps
    if (x > el.scrollLeft + el.clientWidth - 40 || x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 80)
  })

  const open = (c: SClip) => { if (c.kind === 'audio') onOpenClip(c); else selectClip(c.id) }
  const timeAt = (clientX: number) => { const el = lanes.current!; const r = el.getBoundingClientRect(); return Math.max(0, (clientX - r.left + el.scrollLeft) / pps) }

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as Element).closest('input, select, textarea')) return
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase()
    if (e.key === ' ') { e.preventDefault(); if (ses.recording) void stopRecord(); else if (ses.playing) stopPlay(); else void startPlay() }
    else if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo() }
    else if (mod && k === 'd' && selClip) { e.preventDefault(); duplicateClip(selClip.id) }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && selClip) { e.preventDefault(); removeClip(selClip.id) }
    else if (k === 's' && !mod && selClip && !keysOn) { e.preventDefault(); splitClip(selClip.id, pos) }
    else if (mod && k === 'e' && selClip) { e.preventDefault(); splitClip(selClip.id, pos) }
    else if (e.key === 'Home' || e.key === 'Enter') { e.preventDefault(); seekTo(0) }
    else if (k === 'z' && keysOn && !mod) setOctave((o) => Math.max(1, o - 1))
    else if (k === 'x' && keysOn && !mod) setOctave((o) => Math.min(7, o + 1))
    else if (keysOn && !mod && KEYS.includes(k) && !e.repeat) {
      e.preventDefault()
      if (down.current.has(k)) return
      down.current.add(k)
      void noteOn(12 * (octave + 1) + KEYS.indexOf(k), 0.8)
    }
  }
  const onKeyUp = (e: React.KeyboardEvent) => {
    const k = e.key.toLowerCase()
    if (down.current.has(k)) { down.current.delete(k); noteOff(12 * (octave + 1) + KEYS.indexOf(k)) }
  }

  const ticks: number[] = []
  const b = beat()
  const barPx = 4 * b * pps
  const every = barPx < 40 ? 4 : barPx < 80 ? 2 : 1
  for (let bar = 0; bar * 4 * b < end; bar += every) ticks.push(bar)

  return (
    <div className="ses" tabIndex={0} onKeyDown={onKey} onKeyUp={onKeyUp} data-keyscope="sound">
      <div className="ses-bar">
        <button className="icon-btn" title="To the start (Home)" onClick={() => seekTo(0)}>{'⏮'}</button>
        <button className={`tl-play${ses.playing && !ses.recording ? ' on' : ''}`} title="Play or stop (Space)" onClick={() => (ses.playing ? (ses.recording ? void stopRecord() : stopPlay()) : void startPlay())}>{ses.playing ? '■' : '▶'}</button>
        <button className={`tl-rec${ses.recording ? ' on' : ''}`} title="Record on the armed tracks (R on a track)" onClick={async () => {
          if (ses.recording) { await stopRecord(); return }
          try { await startRecord() } catch (err) { toast((err as Error).message || 'The microphone is not available.') }
        }}>{ses.recording ? '■ Stop' : '● Rec'}</button>
        <span className="ses-time" title="Bars.beats.sixteenths and minutes:seconds"><b>{fmtBars(pos)}</b> <span className="dim">{fmtTime(pos)}</span></span>
        <label className="switch mini" title="Loop between the loop markers (drag on the ruler with Shift)"><input type="checkbox" role="switch" checked={s.loop} onChange={(e) => change('Loop', (x) => ({ ...x, loop: e.target.checked }))} /><span>Loop</span></label>
        <label className="switch mini" title="Click on every beat"><input type="checkbox" role="switch" checked={s.metronome} onChange={(e) => change('Metronome', (x) => ({ ...x, metronome: e.target.checked }))} /><span>Click</span></label>
        <label className="mini">BPM <Scrub value={s.bpm} step={0.5} digits={1} min={20} max={300} onChange={(v) => change('Tempo', (x) => ({ ...x, bpm: v }), 'bpm')} /></label>
        <label className="switch mini" title="Snap to 1/16 notes (hold Alt while dragging to not snap)"><input type="checkbox" role="switch" checked={s.snap} onChange={(e) => change('Snap', (x) => ({ ...x, snap: e.target.checked }))} /><span>Snap</span></label>
        <span className="ed-sep" />
        <button className="btn small quiet" onClick={() => addTrack('audio')}>+ Audio track</button>
        <button className="btn small quiet" onClick={() => addTrack('instrument')}>+ Instrument track</button>
        <button className="btn small" onClick={() => pickFile('audio/*,.wav,.mp3,.ogg,.flac,.m4a', (f) => importFile(f).catch(() => toast('That file is not a sound RICO can open.')))}>Import sound...</button>
        <button className="btn small quiet" disabled={!selTrack || selTrack.kind !== 'instrument'} title="An empty note clip at the playhead on the selected instrument track" onClick={() => selTrack && addNoteClip(selTrack.id, snapTime(pos))}>+ Note clip</button>
        <span className="grow" />
        <label className="switch mini" title="Play the selected instrument track with your computer keys: A W S E D F T G Y H U J K. Z and X change the octave."><input type="checkbox" role="switch" checked={keysOn} onChange={(e) => setKeysOn(e.target.checked)} /><span>Keys (oct {octave})</span></label>
        <button className="btn small quiet" disabled={!ses.canUndo} onClick={undo} title="Ctrl+Z">Undo</button>
        <button className="btn small quiet" disabled={!ses.canRedo} onClick={redo} title="Ctrl+Shift+Z">Redo</button>
        <input className="range" type="range" min={8} max={400} value={pps} onChange={(e) => setPps(Number(e.target.value))} title="Zoom" aria-label="Zoom" style={{ width: 90 }} />
        <label className="mini">Master <Scrub value={s.master} step={0.2} digits={1} suffix=" dB" min={-60} max={12} onChange={(v) => change('Master', (x) => ({ ...x, master: v }), 'master')} /></label>
        <TrackMeter id="master" />
        <button className="btn small primary" disabled={busy} onClick={async () => {
          setBusy(true)
          try { downloadBlob('Mixdown.wav', await saveMixdown(24, s.loop && s.loopB > s.loopA ? [s.loopA, s.loopB] : undefined)) } catch { toast('The mixdown did not work.') }
          setBusy(false)
        }} title="Renders every track with its effects to one WAV (the loop range when Loop is on)">{busy ? 'Mixing...' : 'Mixdown WAV'}</button>
      </div>
      <div className="ses-body">
        <div className="ses-heads">
          <div className="ses-head-ruler" />
          {s.tracks.map((t) => <TrackHead key={t.id} t={t} selected={ses.selectedTrack === t.id} />)}
        </div>
        <div className="ses-lanes" ref={lanes}
          onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault() }}
          onDrop={(e) => {
            const f = e.dataTransfer.files?.[0]
            if (!f) return
            e.preventDefault()
            const row = (e.target as HTMLElement).closest<HTMLElement>('.ses-lane')
            const track = row?.dataset.kind === 'audio' ? row.dataset.track : undefined
            importFile(f, track, snapTime(timeAt(e.clientX))).catch(() => toast('That file is not a sound RICO can open.'))
          }}>
          <div className="ses-inner" style={{ width }}>
            <div className="ses-ruler"
              onPointerDown={(e) => {
                const t0 = snapTime(timeAt(e.clientX))
                ;(e.target as Element).setPointerCapture(e.pointerId)
                if (e.shiftKey) {
                  change('Loop range', (x) => ({ ...x, loop: true, loopA: t0, loopB: t0 + beat() * 4 }))
                  const mv = (ev: PointerEvent) => { const t1 = snapTime(timeAt(ev.clientX)); change('Loop range', (x) => ({ ...x, loopA: Math.min(t0, t1), loopB: Math.max(t0 + 0.05, Math.max(t0, t1)) }), 'loop') }
                  const upf = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', upf) }
                  window.addEventListener('pointermove', mv); window.addEventListener('pointerup', upf)
                } else seekTo(t0)
              }}
              title="Click to move the playhead. Shift-drag to set the loop.">
              {ticks.map((bar) => <span key={bar} style={{ left: bar * 4 * b * pps }}>{bar + 1}</span>)}
              {s.loop && <div className="ses-loop" style={{ left: s.loopA * pps, width: (s.loopB - s.loopA) * pps }} />}
            </div>
            {s.tracks.map((t) => (
              <div key={t.id} className={`ses-lane${ses.selectedTrack === t.id ? ' on' : ''}`} data-track={t.id} data-kind={t.kind} style={{ height: TRACK_H }}
                onPointerDown={(e) => { if (e.target === e.currentTarget) { selectTrack(t.id); selectClip(null); seekTo(snapTime(timeAt(e.clientX))) } }}
                onDoubleClick={(e) => { if (e.target === e.currentTarget && t.kind === 'instrument') addNoteClip(t.id, snapTime(timeAt(e.clientX))) }}>
                {s.clips.filter((c) => c.track === t.id).map((c) => <ClipView key={c.id} clip={c} track={t} pps={pps} selected={ses.selectedClip === c.id} onOpen={open} />)}
              </div>
            ))}
            {Array.from({ length: Math.ceil(end / b) }, (_, k) => k % 4 === 0 && <i key={k} className="ses-grid" style={{ left: k * b * pps }} />)}
            <div className={`tl-playhead${ses.recording ? ' rec' : ''}`} style={{ left: pos * pps }} />
          </div>
        </div>
      </div>
      <div className="ses-bottom">
        {selClip && s.tracks.find((t) => t.id === selClip.track)
          ? <ClipInspector clip={selClip} track={s.tracks.find((t) => t.id === selClip.track)!} onOpen={open} />
          : selTrack ? <TrackInspector t={selTrack} /> : <p className="dim small">Select a track or a clip.</p>}
      </div>
    </div>
  )
}

