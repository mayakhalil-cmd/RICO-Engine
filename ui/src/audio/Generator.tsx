import { useEffect, useState } from 'react'
import Scrub from '../components/Scrub'
import { toast } from '../components/Toasts'
import { rico } from '../engine/connection'
import { setClip } from './editor'
import { getSession, placeSound, updateTrack, useSession } from './session'
import { analyserInput, audioContext, getLab } from './lab'
import { SYNTH_PRESETS, midiHz, render, voice, type Synth, type Wave } from './synth'

// The sound generator: start from a preset (kick, snare, pad, riser...),
// shape it, hear it, play it from a MIDI keyboard, and send it to the editor.

const WAVES: Wave[] = ['sine', 'triangle', 'square', 'sawtooth', 'white', 'pink']
const WAVE_LABEL: Record<Wave, string> = { sine: 'Sine', triangle: 'Triangle', square: 'Square', sawtooth: 'Saw', white: 'White noise', pink: 'Pink noise' }
const KEY = 'rico.audio.synth'

async function playNow(s: Synth, hz = s.pitch, velocity = 1) {
  const c = await audioContext()
  const out = c.createGain()
  out.connect(c.destination)
  const lab = getLab()
  if (lab.running && lab.source === 'player') out.connect(await analyserInput())
  voice(c, s, out, c.currentTime + 0.01, hz, velocity)
  window.setTimeout(() => out.disconnect(), (s.length + 2.5) * 1000)
}

function Num({ label, value, set, min, max, step, suffix, digits = 2 }: { label: string; value: number; set: (v: number) => void; min: number; max: number; step: number; suffix?: string; digits?: number }) {
  return <label className="gen-num"><span>{label}</span><Scrub value={value} step={step} digits={digits} suffix={suffix} min={min} max={max} onChange={set} /></label>
}

export default function Generator() {
  const [s, setS] = useState<Synth>(() => { try { return { ...SYNTH_PRESETS[0], ...JSON.parse(localStorage.getItem(KEY) ?? '{}') } } catch { return SYNTH_PRESETS[0] } })
  const [midi, setMidi] = useState(false)
  const ses = useSession()
  const instrument = getSession().tracks.find((t) => t.id === ses.selectedTrack && t.kind === 'instrument') ?? getSession().tracks.find((t) => t.kind === 'instrument')
  const up = (part: Partial<Synth>) => {
    const next = { ...s, ...part }
    setS(next)
    try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* not remembered */ }
  }

  // Play from a MIDI keyboard: every Note On plays the sound at that note.
  useEffect(() => {
    if (!midi) return
    return rico.onLive((live) => {
      for (const e of live.log) if (e.type === 'Note On' && e.d2 > 0) void playNow(s, midiHz(e.d1), e.d2 / 127)
    })
  }, [midi, s])

  const keys = Array.from({ length: 25 }, (_, i) => 48 + i)
  return (
    <div className="dpanel gen">
      <div className="gen-bar">
        <select className="select" value="" onChange={(e) => { const p = SYNTH_PRESETS.find((x) => x.name === e.target.value); if (p) up(p) }}>
          <option value="">Start from...</option>
          {SYNTH_PRESETS.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
        </select>
        <input className="input" value={s.name} onChange={(e) => up({ name: e.target.value })} style={{ width: 140 }} aria-label="Name" />
        <button className="btn small primary" onClick={() => playNow(s)}>▶ Play</button>
        <button className="btn small" onClick={async () => { setClip(await render(s), s.name, true); toast(`${s.name} is in the sound editor.`, true) }}>Send to editor</button>
        <button className="btn small quiet" onClick={async () => { setClip(await render(s), s.name, false); toast(`${s.name} added at the editor cursor.`, true) }}>Add at editor cursor</button>
        <button className="btn small quiet" title="Put this sound on an audio track in the multitrack session, at the playhead" onClick={async () => { await placeSound(await render(s), s.name); toast(`${s.name} is in the session.`, true) }}>Add to session</button>
        <button className="btn small quiet" disabled={!instrument} title="Play this sound with notes on the selected instrument track" onClick={() => { if (instrument) { updateTrack(instrument.id, { synth: { ...s } }, 'Use sound on track'); toast(`${instrument.name} now plays ${s.name}.`, true) } }}>Use on instrument track</button>
        <label className="switch mini" title="Play this sound from a MIDI keyboard"><input type="checkbox" role="switch" checked={midi} onChange={(e) => setMidi(e.target.checked)} /><span>MIDI keyboard</span></label>
      </div>
      <div className="gen-grid">
        <fieldset>
          <legend>Sound</legend>
          <label className="gen-num"><span>Wave</span><select className="select mini" value={s.wave} onChange={(e) => up({ wave: e.target.value as Wave })}>{WAVES.map((w) => <option key={w} value={w}>{WAVE_LABEL[w]}</option>)}</select></label>
          <Num label="Pitch" value={s.pitch} set={(v) => up({ pitch: v })} min={10} max={8000} step={0.5} suffix=" Hz" digits={1} />
          <label className="gen-num"><span>Second wave</span><select className="select mini" value={s.wave2} onChange={(e) => up({ wave2: e.target.value as Wave })}>{WAVES.map((w) => <option key={w} value={w}>{WAVE_LABEL[w]}</option>)}</select></label>
          <Num label="Second pitch x" value={s.ratio2} set={(v) => up({ ratio2: v })} min={0.125} max={16} step={0.01} />
          <Num label="Second mix" value={s.mix2} set={(v) => up({ mix2: v })} min={0} max={1} step={0.01} />
          <Num label="FM" value={s.fm} set={(v) => up({ fm: v })} min={0} max={2} step={0.01} />
          <Num label="Width (detune)" value={s.detune} set={(v) => up({ detune: v })} min={0} max={50} step={0.5} suffix=" ct" digits={1} />
        </fieldset>
        <fieldset>
          <legend>Shape in time</legend>
          <Num label="Length" value={s.length} set={(v) => up({ length: v })} min={0.05} max={20} step={0.01} suffix=" s" />
          <Num label="Attack" value={s.attack} set={(v) => up({ attack: v })} min={0} max={10} step={0.002} suffix=" s" digits={3} />
          <Num label="Decay" value={s.decay} set={(v) => up({ decay: v })} min={0.005} max={10} step={0.005} suffix=" s" digits={3} />
          <Num label="Sustain" value={s.sustain} set={(v) => up({ sustain: v })} min={0} max={1} step={0.01} />
          <Num label="Release" value={s.release} set={(v) => up({ release: v })} min={0.005} max={10} step={0.005} suffix=" s" digits={3} />
          <Num label="Pitch drop from x" value={s.pitchStart} set={(v) => up({ pitchStart: v })} min={0.05} max={16} step={0.01} />
          <Num label="Pitch drop time" value={s.pitchTime} set={(v) => up({ pitchTime: v })} min={0.001} max={10} step={0.002} suffix=" s" digits={3} />
          <Num label="Bursts (clap)" value={s.bursts} set={(v) => up({ bursts: Math.round(v) })} min={1} max={6} step={0.05} digits={0} />
        </fieldset>
        <fieldset>
          <legend>Filter and movement</legend>
          <label className="gen-num"><span>Filter</span><select className="select mini" value={s.filter} onChange={(e) => up({ filter: e.target.value as Synth['filter'] })}>
            <option value="none">None</option><option value="lowpass">Low pass</option><option value="highpass">High pass</option><option value="bandpass">Band pass</option></select></label>
          <Num label="Cutoff" value={s.cutoff} set={(v) => up({ cutoff: v })} min={20} max={20000} step={5} suffix=" Hz" digits={0} />
          <Num label="Resonance" value={s.reso} set={(v) => up({ reso: v })} min={0.1} max={20} step={0.05} />
          <Num label="Filter sweep" value={s.filterEnv} set={(v) => up({ filterEnv: v })} min={-6} max={6} step={0.05} suffix=" oct" />
          <Num label="Sweep time" value={s.filterTime} set={(v) => up({ filterTime: v })} min={0.01} max={10} step={0.005} suffix=" s" digits={3} />
          <label className="gen-num"><span>Wobble</span><select className="select mini" value={s.lfoTarget} onChange={(e) => up({ lfoTarget: e.target.value as Synth['lfoTarget'] })}>
            <option value="pitch">Pitch</option><option value="filter">Filter</option><option value="volume">Volume</option></select></label>
          <Num label="Wobble speed" value={s.lfoRate} set={(v) => up({ lfoRate: v })} min={0.05} max={40} step={0.05} suffix=" Hz" />
          <Num label="Wobble depth" value={s.lfoDepth} set={(v) => up({ lfoDepth: v })} min={0} max={1} step={0.01} />
        </fieldset>
        <fieldset>
          <legend>Finish</legend>
          <Num label="Drive" value={s.drive} set={(v) => up({ drive: v })} min={0} max={1} step={0.01} />
          <Num label="Space (reverb)" value={s.space} set={(v) => up({ space: v })} min={0} max={1} step={0.01} />
          <Num label="Volume" value={s.volume} set={(v) => up({ volume: v })} min={-48} max={6} step={0.1} suffix=" dB" digits={1} />
        </fieldset>
      </div>
      <div className="gen-keys" aria-label="Keyboard">
        {keys.map((n) => {
          const black = [1, 3, 6, 8, 10].includes(n % 12)
          return <button key={n} className={black ? 'black' : 'white'} title={`Play at note ${n}`} onPointerDown={() => playNow(s, midiHz(n))} />
        })}
      </div>
    </div>
  )
}
