import { useEffect, useRef, useState } from 'react'
import Scrub from '../components/Scrub'
import { toast } from '../components/Toasts'
import { useCanvas } from '../components/useCanvas'
import { downloadBlob, pickFile } from '../shell/ui'
import { audioContext } from './lab'
import SessionView from './MultitrackView'
import { placeSound, replaceClipSound, clipBuffer, type AudioClip } from './session'
import {
  bitcrush, channels, setClip, copySel, crop, cutSel, deleteSel, effect, exportRange, fade, gain, gate, getClip, insertSilence, invert, isRecording, loadFile,
  newSilence, normalize, paste, play, playhead, record, redoEdit, reverse, setSelection, silence, speed, stopPlay, undoEdit, useEditor, wav,
  type FxKind, type FxParams,
} from './editor'

// The sound editor: open or record a sound, select part of it, cut, paste,
// fade, normalize, EQ, compress, add reverb or echo, change speed, export WAV.

const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(3).padStart(6, '0')}`

function Wave({ view, setView }: { view: [number, number]; setView: (v: [number, number]) => void }) {
  const ed = useEditor()
  const drag = useRef<{ t0: number } | null>(null)
  const ref = useCanvas((g, w, h) => {
    g.fillStyle = '#000'
    g.fillRect(0, 0, w, h)
    const clip = getClip()
    if (!clip) {
      g.fillStyle = 'rgba(185,194,180,0.8)'
      g.font = '13px "Courier Prime", monospace'
      g.fillText('Open a sound (or drop one here), record, or make one in the generator.', 14, h / 2)
      return
    }
    const b = clip.buffer
    const [v0, v1] = view
    const tx = (t: number) => ((t - v0) / (v1 - v0)) * w
    // selection
    const [s0, s1] = ed.sel
    if (s1 - s0 > 1e-4) { g.fillStyle = 'rgba(59,255,3,0.16)'; g.fillRect(tx(s0), 0, tx(s1) - tx(s0), h) }
    const chs = b.numberOfChannels
    const laneH = h / chs
    for (let c = 0; c < chs; c++) {
      const d = b.getChannelData(c)
      const mid = laneH * c + laneH / 2
      g.strokeStyle = 'rgba(59,255,3,0.15)'
      g.beginPath(); g.moveTo(0, mid); g.lineTo(w, mid); g.stroke()
      g.fillStyle = c === 0 ? '#3bff03' : '#30e0ff'
      const spp = ((v1 - v0) * b.sampleRate) / w
      for (let x = 0; x < w; x++) {
        const i0 = Math.floor((v0 * b.sampleRate) + x * spp), i1 = Math.min(d.length, Math.floor(i0 + Math.max(1, spp)))
        let lo = 1, hi = -1
        for (let i = Math.max(0, i0); i < i1; i++) { const v = d[i]; if (v < lo) lo = v; if (v > hi) hi = v }
        if (hi < lo) continue
        g.fillRect(x, mid - hi * laneH * 0.48, 1, Math.max(1, (hi - lo) * laneH * 0.48))
      }
    }
    // cursor and playhead
    g.fillStyle = '#ffffff'
    g.fillRect(tx(s0), 0, 1, h)
    const ph = playhead()
    if (ph !== null) { g.fillStyle = '#f820a0'; g.fillRect(tx(ph), 0, 2, h) }
    // ruler
    g.fillStyle = 'rgba(185,194,180,0.8)'
    g.font = '10px "Courier Prime", monospace'
    const span = v1 - v0
    const step = [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10, 30, 60].find((s) => span / s < 12) ?? 60
    for (let t = Math.ceil(v0 / step) * step; t < v1; t += step) { g.fillRect(tx(t), 0, 1, 5); g.fillText(`${+t.toFixed(2)}s`, tx(t) + 2, 12) }
  }, [ed.clip, ed.sel, view])

  const tAt = (e: React.PointerEvent | React.WheelEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return view[0] + ((e.clientX - r.left) / r.width) * (view[1] - view[0])
  }
  return (
    <canvas ref={ref} className="ed-wave"
      onPointerDown={(e) => {
        const t = tAt(e)
        ;(e.target as Element).setPointerCapture(e.pointerId)
        if (e.shiftKey) { setSelection(Math.min(ed.sel[0], t), Math.max(ed.sel[1], t)); return }
        drag.current = { t0: t }
        setSelection(t, t)
      }}
      onPointerMove={(e) => { if (drag.current) setSelection(drag.current.t0, tAt(e)) }}
      onPointerUp={() => { drag.current = null }}
      onWheel={(e) => {
        const d = getClip()?.buffer.duration ?? 1
        const t = tAt(e)
        if (e.ctrlKey || e.altKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          const k = Math.exp(e.deltaY * 0.002)
          const a = Math.max(0, t - (t - view[0]) * k), z = Math.min(d, t + (view[1] - t) * k)
          if (z - a > 0.005) setView([a, z])
        } else {
          const shift = (e.deltaX / 600) * (view[1] - view[0])
          const a = Math.max(0, Math.min(d - (view[1] - view[0]), view[0] + shift))
          setView([a, a + view[1] - view[0]])
        }
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) loadFile(f).catch(() => toast('That file is not a sound RICO can open.')) }}
    />
  )
}

function Fx({ label, kind, fields }: { label: string; kind: FxKind; fields: { k: keyof FxParams; label: string; v: number; min: number; max: number; step: number; suffix?: string; digits?: number }[] }) {
  const [p, setP] = useState<FxParams>(() => Object.fromEntries(fields.map((f) => [f.k, f.v])))
  return (
    <div className="ed-fx">
      <b>{label}</b>
      {fields.map((f) => (
        <label key={f.k} className="mini">{f.label} <Scrub value={Number(p[f.k])} step={f.step} digits={f.digits ?? 1} suffix={f.suffix} min={f.min} max={f.max} onChange={(v) => setP({ ...p, [f.k]: v })} /></label>
      ))}
      <button className="btn small" onClick={() => effect(kind, p)}>Apply</button>
    </div>
  )
}

function WaveEditor({ fromClip, onBack }: { fromClip: AudioClip | null; onBack: () => void }) {
  const ed = useEditor()
  const [view, setView] = useState<[number, number]>([0, 1])
  const [g, setG] = useState(-3)
  const [sp, setSp] = useState(1)
  const [rec, setRec] = useState(false)
  const dur = ed.clip?.buffer.duration ?? 0
  const lastDur = useRef(0)
  useEffect(() => {
    // A new sound (or a new length): keep the zoom inside it, or show all of it.
    const prev = lastDur.current
    lastDur.current = dur
    if (view[1] > dur || view[1] - view[0] >= prev - 1e-6) setView([0, Math.max(0.01, dur)])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ed.clip])
  const hasSel = ed.sel[1] - ed.sel[0] > 1e-4
  const save = (bits: 16 | 24, part: boolean) => {
    const c = getClip()
    if (!c) return
    const [a, z] = part ? exportRange() : [0, c.buffer.length]
    downloadBlob(`${c.name}${part ? ' (part)' : ''}.wav`, wav(c.buffer, bits, a, z))
  }
  return (
    <div className="editor" data-keyscope="sound"
      onKeyDown={(e) => {
        if ((e.target as Element).closest('input, select, textarea')) return
        const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase()
        if (e.key === ' ') { e.preventDefault(); if (ed.playing) stopPlay(); else void play(e.shiftKey) }
        else if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redoEdit(); else undoEdit() }
        else if (mod && k === 'x') { e.preventDefault(); void cutSel() }
        else if (mod && k === 'c') { e.preventDefault(); void copySel() }
        else if (mod && k === 'v') { e.preventDefault(); void paste() }
        else if (mod && k === 'a') { e.preventDefault(); setSelection(0, dur) }
        else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); void deleteSel() }
      }} tabIndex={0}>
      {fromClip && (
        <div className="ed-from">
          <span>Editing the clip <b>{fromClip.name}</b> from the session.</span>
          <button className="btn small primary" disabled={!ed.clip} onClick={async () => { const c = getClip(); if (!c) return; await replaceClipSound(fromClip.id, c.buffer); toast('The clip in the session now has this sound.', true); onBack() }}>Put it back in the session</button>
          <button className="btn small quiet" onClick={onBack}>Back without changes</button>
        </div>
      )}
      <div className="ed-bar">
        <button className="btn small primary" onClick={() => pickFile('audio/*,.wav,.mp3,.ogg,.flac,.m4a', (f) => loadFile(f).catch(() => toast('That file is not a sound RICO can open.')))}>Open sound...</button>
        <button className="btn small quiet" onClick={() => newSilence(4)}>New (silence)</button>
        <button className={`btn small ${rec ? 'out' : 'quiet'}`} onClick={async () => { try { await record(!rec); setRec(!rec) } catch { toast('The microphone is not available.') } }}>{rec || isRecording() ? '■ Stop recording' : '● Record'}</button>
        <span className="ed-sep" />
        <button className="btn small" disabled={!ed.clip} onClick={() => (ed.playing ? stopPlay() : play(false))}>{ed.playing ? '■ Stop' : '▶ Play'}</button>
        <button className="btn small quiet" disabled={!hasSel} onClick={() => play(true)} title="Loop the selection (Shift+Space)">Loop</button>
        <span className="ed-sep" />
        <button className="btn small quiet" disabled={!ed.canUndo} onClick={undoEdit} title="Ctrl+Z">Undo</button>
        <button className="btn small quiet" disabled={!ed.canRedo} onClick={redoEdit} title="Ctrl+Shift+Z">Redo</button>
        <span className="grow" />
        <span className="small dim">{ed.clip ? `${ed.clip.name}: ${fmt(dur)}, ${ed.clip.buffer.numberOfChannels === 2 ? 'stereo' : 'mono'}, ${ed.clip.buffer.sampleRate} Hz` : ''}</span>
        <button className="btn small quiet" disabled={!ed.clip} onClick={() => save(24, false)}>Save WAV</button>
        <button className="btn small quiet" disabled={!hasSel} onClick={() => save(24, true)}>Save selection</button>
        <button className="btn small quiet" disabled={!ed.clip} title="Put this sound (or the selection) on a track in the session" onClick={async () => {
          const c = getClip(); if (!c) return
          const [a, z] = hasSel ? exportRange() : [0, c.buffer.length]
          const ctx = await audioContext()
          const part = ctx.createBuffer(c.buffer.numberOfChannels, Math.max(1, z - a), c.buffer.sampleRate)
          for (let i = 0; i < c.buffer.numberOfChannels; i++) part.copyToChannel(c.buffer.getChannelData(i).slice(a, z), i)
          await placeSound(part, c.name)
          toast('Added to the session at the playhead.', true)
        }}>Send to session</button>
      </div>
      <Wave view={view} setView={setView} />
      <div className="ed-sel small">
        {hasSel ? <>Selected {fmt(ed.sel[0])} to {fmt(ed.sel[1])} ({(ed.sel[1] - ed.sel[0]).toFixed(3)} s). Effects change only this part.</> : <>Cursor at {fmt(ed.sel[0])}. Drag to select, Shift-click to extend, scroll to zoom. Effects change everything when nothing is selected.</>}
        <button className="btn small quiet" onClick={() => setView([0, Math.max(0.01, dur)])}>Show all</button>
        {hasSel && <button className="btn small quiet" onClick={() => setView([ed.sel[0], ed.sel[1]])}>Zoom to selection</button>}
      </div>
      <div className="ed-tools">
        <div className="ed-group">
          <b>Edit</b>
          <button className="btn small quiet" disabled={!hasSel} onClick={() => cutSel()}>Cut</button>
          <button className="btn small quiet" disabled={!ed.clip} onClick={() => copySel()}>Copy</button>
          <button className="btn small quiet" disabled={!ed.hasClipboard} onClick={() => paste()}>Paste</button>
          <button className="btn small quiet" disabled={!hasSel} onClick={() => deleteSel()}>Delete</button>
          <button className="btn small quiet" disabled={!hasSel} onClick={() => crop()}>Keep only selection</button>
          <button className="btn small quiet" disabled={!ed.clip} onClick={() => silence()}>Silence</button>
          <button className="btn small quiet" disabled={!ed.clip} onClick={() => insertSilence(1)}>Insert 1 s silence</button>
        </div>
        <div className="ed-group">
          <b>Level</b>
          <label className="mini">Gain <Scrub value={g} step={0.1} digits={1} suffix=" dB" min={-48} max={48} onChange={setG} /></label>
          <button className="btn small" disabled={!ed.clip} onClick={() => gain(g)}>Apply</button>
          <button className="btn small quiet" disabled={!ed.clip} onClick={() => normalize(-1)}>Normalize (-1 dB)</button>
          <button className="btn small quiet" disabled={!ed.clip} onClick={() => fade('in')}>Fade in</button>
          <button className="btn small quiet" disabled={!ed.clip} onClick={() => fade('out')}>Fade out</button>
          <button className="btn small quiet" disabled={!ed.clip} onClick={() => gate(-45)}>Noise gate</button>
        </div>
        <div className="ed-group">
          <b>Change</b>
          <button className="btn small quiet" disabled={!ed.clip} onClick={() => reverse()}>Reverse</button>
          <button className="btn small quiet" disabled={!ed.clip} onClick={() => invert()}>Invert</button>
          <button className="btn small quiet" disabled={!ed.clip} onClick={() => channels('mono')}>Make mono</button>
          <button className="btn small quiet" disabled={!ed.clip} onClick={() => channels('swap')}>Swap left and right</button>
          <label className="mini">Speed <Scrub value={sp} step={0.01} digits={2} suffix="x" min={0.1} max={8} onChange={setSp} /></label>
          <button className="btn small" disabled={!ed.clip} onClick={() => speed(sp)}>Apply</button>
          <button className="btn small quiet" disabled={!ed.clip} onClick={() => bitcrush(8, 4)}>Bitcrush</button>
        </div>
        <Fx label="Low cut" kind="lowcut" fields={[{ k: 'freq', label: 'Below', v: 80, min: 20, max: 2000, step: 1, suffix: ' Hz', digits: 0 }, { k: 'mix', label: 'Mix', v: 1, min: 0, max: 1, step: 0.01, digits: 2 }]} />
        <Fx label="High cut" kind="highcut" fields={[{ k: 'freq', label: 'Above', v: 8000, min: 200, max: 20000, step: 10, suffix: ' Hz', digits: 0 }, { k: 'mix', label: 'Mix', v: 1, min: 0, max: 1, step: 0.01, digits: 2 }]} />
        <Fx label="EQ bell" kind="bell" fields={[{ k: 'freq', label: 'At', v: 1000, min: 20, max: 20000, step: 5, suffix: ' Hz', digits: 0 }, { k: 'db', label: 'Boost', v: 4, min: -24, max: 24, step: 0.1, suffix: ' dB' }, { k: 'q', label: 'Width (Q)', v: 1, min: 0.1, max: 18, step: 0.02, digits: 2 }]} />
        <Fx label="Low shelf" kind="lowshelf" fields={[{ k: 'freq', label: 'Below', v: 150, min: 20, max: 2000, step: 1, suffix: ' Hz', digits: 0 }, { k: 'db', label: 'Boost', v: 3, min: -24, max: 24, step: 0.1, suffix: ' dB' }]} />
        <Fx label="High shelf" kind="highshelf" fields={[{ k: 'freq', label: 'Above', v: 6000, min: 500, max: 20000, step: 10, suffix: ' Hz', digits: 0 }, { k: 'db', label: 'Boost', v: 3, min: -24, max: 24, step: 0.1, suffix: ' dB' }]} />
        <Fx label="Compressor" kind="compress" fields={[{ k: 'threshold', label: 'Threshold', v: -24, min: -60, max: 0, step: 0.2, suffix: ' dB' }, { k: 'ratio', label: 'Ratio', v: 4, min: 1, max: 20, step: 0.05 }, { k: 'db', label: 'Make-up', v: 6, min: 0, max: 24, step: 0.1, suffix: ' dB' }]} />
        <Fx label="Reverb" kind="reverb" fields={[{ k: 'size', label: 'Length', v: 2, min: 0.2, max: 8, step: 0.02, suffix: ' s' }, { k: 'mix', label: 'Wet', v: 0.35, min: 0, max: 1, step: 0.01, digits: 2 }]} />
        <Fx label="Echo" kind="echo" fields={[{ k: 'time', label: 'Delay', v: 0.3, min: 0.01, max: 2, step: 0.005, suffix: ' s', digits: 3 }, { k: 'feedback', label: 'Repeats', v: 0.4, min: 0, max: 0.95, step: 0.01, digits: 2 }, { k: 'mix', label: 'Wet', v: 0.4, min: 0, max: 1, step: 0.01, digits: 2 }]} />
        <Fx label="Drive" kind="drive" fields={[{ k: 'amount', label: 'Amount', v: 0.5, min: 0, max: 1, step: 0.01, digits: 2 }, { k: 'mix', label: 'Mix', v: 1, min: 0, max: 1, step: 0.01, digits: 2 }]} />
      </div>
    </div>
  )
}

// The sound editor has two views: the multitrack session and
// the waveform editor for one sound. Double-click a clip to edit its sound.
export default function SoundEditor() {
  const [view, setView] = useState<'session' | 'wave'>(() => { try { return (localStorage.getItem('rico.sound.view') as 'session' | 'wave') || 'session' } catch { return 'session' } })
  const [fromClip, setFromClip] = useState<AudioClip | null>(null)
  const go = (v: 'session' | 'wave') => { setView(v); try { localStorage.setItem('rico.sound.view', v) } catch { /* fine */ } }
  return (
    <div className="dpanel sound-editor">
      <div className="seg ses-tabs" role="tablist">
        <button role="tab" aria-selected={view === 'session'} className={view === 'session' ? 'on' : ''} onClick={() => go('session')}>Multitrack</button>
        <button role="tab" aria-selected={view === 'wave'} className={view === 'wave' ? 'on' : ''} onClick={() => go('wave')}>Waveform</button>
      </div>
      {view === 'session'
        ? <SessionView onOpenClip={async (c) => {
          const b = await clipBuffer(c)
          if (!b) { toast('That clip has no sound loaded yet.'); return }
          setClip(b, c.name, true)
          setFromClip(c)
          go('wave')
        }} />
        : <WaveEditor fromClip={fromClip} onBack={() => { setFromClip(null); go('session') }} />}
    </div>
  )
}
