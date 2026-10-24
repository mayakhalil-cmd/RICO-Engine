import { useEffect, useRef, useState } from 'react'
import Icon from '../components/Icon'
import Scrub from '../components/Scrub'
import { toast } from '../components/Toasts'
import { rico } from '../engine/connection'
import { addRule, applyRule, kindOf, removeRule, rulesSent, updateRule, useRules, type MsgType, type OutKind, type Rule } from '../engine/midiRules'
import { useTick } from '../engine/useTick'
import type { LogEntry } from '../engine/types'
import { downloadJson, pickFile } from '../shell/ui'

// MIDI in depth: a monitor with filters, rules that translate and fan out
// messages (MIDI, OSC, DMX, signals), a clock, and a test keyboard.

const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const noteOf = (n: number) => `${NOTE[n % 12]}${Math.floor(n / 12) - 1}`
const TYPES: { k: MsgType; label: string }[] = [
  { k: 'note', label: 'Notes' }, { k: 'cc', label: 'CC' }, { k: 'bend', label: 'Pitch bend' }, { k: 'program', label: 'Program' }, { k: 'aftertouch', label: 'Aftertouch' },
]
const OUT_LABEL: Record<OutKind, string> = { 'midi-note': 'MIDI note', 'midi-cc': 'MIDI CC', 'midi-program': 'MIDI program', osc: 'OSC', dmx: 'DMX', signal: 'Signal', block: 'Nothing (ignore it)' }

const history: (LogEntry & { at: number })[] = []
rico.onLive((live) => {
  for (const e of live.log) if (kindOf(e) || /MIDI/.test(e.type)) { history.push({ ...e, at: performance.now() }); if (history.length > 2000) history.shift() }
})

function Monitor() {
  useTick(120)
  const [show, setShow] = useState<Set<MsgType>>(new Set(['note', 'cc', 'bend', 'program', 'aftertouch']))
  const [ch, setCh] = useState(0)
  const [paused, setPaused] = useState<number | null>(null)
  const [hex, setHex] = useState(false)
  const now = performance.now()
  const list = history.filter((e) => (paused === null || e.at <= paused)).filter((e) => {
    const k = kindOf(e)
    return (!k || show.has(k)) && (!ch || e.ch === ch)
  }).slice(-200).reverse()
  const rate = history.filter((e) => now - e.at < 1000).length
  const f = (n: number) => (n < 0 ? '' : hex ? n.toString(16).toUpperCase().padStart(2, '0') : String(n))
  return (
    <div className="ms-monitor">
      <div className="row wrap">
        {TYPES.map((t) => (
          <label key={t.k} className="mini-check"><input type="checkbox" checked={show.has(t.k)} onChange={(e) => { const n = new Set(show); if (e.target.checked) n.add(t.k); else n.delete(t.k); setShow(n) }} />{t.label}</label>
        ))}
        <label className="mini">Channel <select className="select mini" value={ch} onChange={(e) => setCh(Number(e.target.value))}><option value={0}>All</option>{Array.from({ length: 16 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></label>
        <label className="mini-check"><input type="checkbox" checked={hex} onChange={(e) => setHex(e.target.checked)} />Hex</label>
        <button className="btn small quiet" onClick={() => setPaused(paused === null ? performance.now() : null)}>{paused === null ? 'Pause' : 'Go on'}</button>
        <button className="btn small quiet" onClick={() => { history.length = 0 }}>Clear</button>
        <span className="dim small">{rate} messages a second</span>
      </div>
      <div className="ms-table-wrap">
        <table className="ms-table">
          <thead><tr><th>Time</th><th>Type</th><th>Ch</th><th>Number</th><th>Value</th><th>What</th></tr></thead>
          <tbody>
            {list.map((e) => (
              <tr key={`${e.n}-${e.at}`}>
                <td className="dim">{e.time}</td>
                <td>{e.type}</td>
                <td>{e.ch > 0 ? e.ch : ''}</td>
                <td>{f(e.d1)}{e.type.startsWith('Note') && e.d1 >= 0 ? ` (${noteOf(e.d1)})` : ''}</td>
                <td>{e.d2 >= 0 ? f(e.d2) : e.value.toFixed(3)}</td>
                <td className="dim">{e.text}</td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={6} className="dim">Nothing yet. Play a key or move a knob.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function RuleCard({ r }: { r: Rule }) {
  const up = (p: Partial<Rule>) => updateRule(r.id, p)
  const [learning, setLearning] = useState(false)
  const lamp = useRef<HTMLElement | null>(null)
  useEffect(() => rico.onLive((live) => {
    for (const e of live.log) {
      if (learning && kindOf(e)) {
        const k = kindOf(e)!
        up({ type: k, channel: e.ch, lo: e.d1, hi: e.d1 })
        setLearning(false)
        toast(`Rule listens to ${e.type} ${e.d1} on channel ${e.ch}.`, true)
      }
      if (applyRule(r, e) !== null && lamp.current) {
        lamp.current.style.opacity = '1'
        window.setTimeout(() => { if (lamp.current) lamp.current.style.opacity = '0.15' }, 120)
      }
    }
  }), [learning, r])
  const midiOut = r.out.startsWith('midi')
  return (
    <div className={`ms-rule${r.on ? '' : ' off'}`}>
      <div className="ms-rule-head">
        <input type="checkbox" checked={r.on} onChange={(e) => up({ on: e.target.checked })} title="On" />
        <i ref={lamp} className="lab-lamp on" style={{ opacity: 0.15 }} />
        <input className="input mini-name" value={r.name} onChange={(e) => up({ name: e.target.value })} />
        <span className="grow" />
        <button className="icon-btn small danger" title="Delete rule" onClick={() => removeRule(r.id)}><Icon name="x" /></button>
      </div>
      <div className="ms-rule-body">
        <div className="ms-when">
          <b>When</b>
          <select className="select mini" value={r.type} onChange={(e) => up({ type: e.target.value as MsgType })}>
            <option value="any">Anything</option>{TYPES.map((t) => <option key={t.k} value={t.k}>{t.label}</option>)}
          </select>
          <label className="mini">ch <select className="select mini" value={r.channel} onChange={(e) => up({ channel: Number(e.target.value) })}><option value={0}>any</option>{Array.from({ length: 16 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></label>
          <label className="mini">number <Scrub value={r.lo} step={0.2} digits={0} min={0} max={127} onChange={(v) => up({ lo: Math.round(v) })} /> to <Scrub value={r.hi} step={0.2} digits={0} min={0} max={127} onChange={(v) => up({ hi: Math.round(v) })} /></label>
          <button className={`btn small ${learning ? 'out' : 'quiet'}`} onClick={() => setLearning(!learning)}>{learning ? 'Move a control...' : 'Learn'}</button>
        </div>
        <div className="ms-shape">
          <b>Value</b>
          <label className="mini">in <Scrub value={r.inMin} step={0.2} digits={0} min={0} max={127} onChange={(v) => up({ inMin: Math.round(v) })} />-<Scrub value={r.inMax} step={0.2} digits={0} min={0} max={127} onChange={(v) => up({ inMax: Math.round(v) })} /></label>
          <label className="mini">out <Scrub value={r.outMin} step={0.1} digits={2} onChange={(v) => up({ outMin: v })} />-<Scrub value={r.outMax} step={0.1} digits={2} onChange={(v) => up({ outMax: v })} /></label>
          <label className="mini">curve <Scrub value={r.curve} step={0.01} digits={2} min={0.1} max={5} onChange={(v) => up({ curve: v })} /></label>
          <label className="mini-check"><input type="checkbox" checked={r.invert} onChange={(e) => up({ invert: e.target.checked })} />Flip</label>
        </div>
        <div className="ms-then">
          <b>Then send</b>
          <select className="select mini" value={r.out} onChange={(e) => {
            const out = e.target.value as OutKind
            up({ out, ...(out.startsWith('midi') && r.outMax <= 1 ? { outMin: 0, outMax: 127 } : {}), ...(out === 'dmx' || out === 'signal' ? { outMin: 0, outMax: 1 } : {}) })
          }}>
            {(Object.keys(OUT_LABEL) as OutKind[]).map((k) => <option key={k} value={k}>{OUT_LABEL[k]}</option>)}
          </select>
          {midiOut && <>
            <label className="mini">ch <select className="select mini" value={r.outChannel} onChange={(e) => up({ outChannel: Number(e.target.value) })}><option value={0}>same</option>{Array.from({ length: 16 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></label>
            <label className="mini">number <select className="select mini" value={r.fixedNumber >= 0 ? 'fixed' : 'same'} onChange={(e) => up({ fixedNumber: e.target.value === 'fixed' ? 0 : -1 })}><option value="same">same</option><option value="fixed">fixed</option></select></label>
            {r.fixedNumber >= 0
              ? <Scrub value={r.fixedNumber} step={0.2} digits={0} min={0} max={127} onChange={(v) => up({ fixedNumber: Math.round(v) })} />
              : <label className="mini">transpose <Scrub value={r.transpose} step={0.2} digits={0} min={-127} max={127} onChange={(v) => up({ transpose: Math.round(v) })} /></label>}
          </>}
          {r.out === 'osc' && <>
            <input className="input" style={{ width: 110 }} value={r.host} onChange={(e) => up({ host: e.target.value })} title="Host" />
            <input className="input num" style={{ width: 70 }} type="number" value={r.port} onChange={(e) => up({ port: Number(e.target.value) })} title="Port" />
            <input className="input" style={{ width: 170 }} value={r.address} onChange={(e) => up({ address: e.target.value })} title="{n} = number, {c} = channel, {i} = copy number" />
          </>}
          {r.out === 'dmx' && <label className="mini">from DMX channel <Scrub value={r.dmx} step={0.3} digits={0} min={1} max={512} onChange={(v) => up({ dmx: Math.round(v) })} /></label>}
          {r.out === 'signal' && <input className="input" style={{ width: 160 }} value={r.signal} onChange={(e) => up({ signal: e.target.value })} title="Signal name; {n} = number" />}
          {r.out !== 'block' && <label className="mini" title="One message in, this many out: number +1 each (one MIDI to ten OSC)">copies <Scrub value={r.count} step={0.1} digits={0} min={1} max={64} onChange={(v) => up({ count: Math.round(v) })} /></label>}
        </div>
      </div>
    </div>
  )
}

function Rules() {
  const rules = useRules()
  useTick(500)
  return (
    <div className="ms-rules">
      <div className="row wrap">
        <button className="btn small primary" onClick={() => addRule()}>+ Rule</button>
        <button className="btn small quiet" onClick={() => addRule({ name: 'Notes to OSC', type: 'note', out: 'osc', address: '/note/{n}', outMax: 1 })}>Notes to OSC</button>
        <button className="btn small quiet" onClick={() => addRule({ name: 'One knob to ten OSC', type: 'cc', lo: 1, hi: 1, out: 'osc', address: '/light/{i}', outMax: 1, count: 10 })}>One knob to ten OSC</button>
        <button className="btn small quiet" onClick={() => addRule({ name: 'CC to DMX', type: 'cc', out: 'dmx', dmx: 1, outMax: 1 })}>CC to DMX</button>
        <button className="btn small quiet" onClick={() => addRule({ name: 'Channel 1 to 2', type: 'any', channel: 1, out: 'midi-cc', outChannel: 2 })}>Move to another channel</button>
        <button className="btn small quiet" onClick={() => addRule({ name: 'Octave up', type: 'note', out: 'midi-note', transpose: 12 })}>Transpose</button>
        <span className="grow" />
        <button className="btn small quiet" onClick={() => downloadJson('rico-midi-rules.json', { rico: 'midi-rules', rules })}>Export</button>
        <button className="btn small quiet" onClick={() => pickFile('.json', (f) => f.text().then((t) => {
          const d = JSON.parse(t)
          if (d?.rico !== 'midi-rules' || !Array.isArray(d.rules)) return toast('That is not a RICO MIDI rules file.')
          for (const r of d.rules) addRule({ ...r, id: undefined })
        }))}>Import</button>
        <span className="dim small">{rulesSent()} sent</span>
      </div>
      {rules.map((r) => <RuleCard key={r.id} r={r} />)}
      {!rules.length && <p className="dim small">A rule catches MIDI and sends something else: a note becomes an OSC message, one knob becomes ten OSC addresses, channel 1 moves to channel 2. They work next to your mappings.</p>}
    </div>
  )
}

function ClockAndTest() {
  const [bpm, setBpm] = useState(120)
  const [running, setRunning] = useState(false)
  const [ch, setCh] = useState(1)
  const [cc, setCc] = useState(74)
  const [ccv, setCcv] = useState(64)
  const [prog, setProg] = useState(0)
  const send = (bytes: number[]) => void rico.send('midi.send', { bytes })
  return (
    <div className="ms-clock">
      <div className="row wrap">
        <b>MIDI clock out</b>
        <label className="mini">BPM <Scrub value={bpm} step={0.1} digits={1} min={20} max={300} onChange={(v) => { setBpm(v); if (running) void rico.send('midi.clock', { on: true, bpm: v }) }} /></label>
        <button className={`btn small ${running ? 'out' : 'primary'}`} onClick={async () => { const a = await rico.send('midi.clock', { on: !running, bpm }); setRunning(Boolean(a.running)) }}>{running ? 'Stop clock' : 'Start clock'}</button>
        <span className="dim small">24 pulses a beat, with Start and Stop, to every MIDI output and virtual port. Timed by RICO itself, not the interface.</span>
      </div>
      <div className="row wrap">
        <b>Send by hand</b>
        <label className="mini">channel <Scrub value={ch} step={0.1} digits={0} min={1} max={16} onChange={(v) => setCh(Math.round(v))} /></label>
        <label className="mini">CC <Scrub value={cc} step={0.2} digits={0} min={0} max={127} onChange={(v) => setCc(Math.round(v))} /></label>
        <input className="range" type="range" min={0} max={127} value={ccv} onChange={(e) => { const v = Number(e.target.value); setCcv(v); send([0xb0 + ch - 1, cc, v]) }} style={{ width: 160 }} />
        <span>{ccv}</span>
        <label className="mini">program <Scrub value={prog} step={0.2} digits={0} min={0} max={127} onChange={(v) => setProg(Math.round(v))} /></label>
        <button className="btn small quiet" onClick={() => send([0xc0 + ch - 1, prog])}>Send program</button>
        <button className="btn small out" onClick={() => rico.send('midi.panic')}>Panic: all notes off</button>
      </div>
      <div className="gen-keys">
        {Array.from({ length: 25 }, (_, i) => 48 + i).map((n) => {
          const black = [1, 3, 6, 8, 10].includes(n % 12)
          return <button key={n} className={black ? 'black' : 'white'} title={noteOf(n)} onPointerDown={() => send([0x90 + ch - 1, n, 100])} onPointerUp={() => send([0x80 + ch - 1, n, 0])} onPointerLeave={(e) => { if (e.buttons) send([0x80 + ch - 1, n, 0]) }} />
        })}
      </div>
    </div>
  )
}

export default function MidiStudio() {
  const [tab, setTab] = useState<'monitor' | 'rules' | 'clock'>('rules')
  return (
    <div className="dpanel ms">
      <div className="seg">
        <button className={tab === 'rules' ? 'on' : ''} onClick={() => setTab('rules')}>Rules (translate)</button>
        <button className={tab === 'monitor' ? 'on' : ''} onClick={() => setTab('monitor')}>Monitor</button>
        <button className={tab === 'clock' ? 'on' : ''} onClick={() => setTab('clock')}>Clock and test</button>
      </div>
      {tab === 'monitor' && <Monitor />}
      {tab === 'rules' && <Rules />}
      {tab === 'clock' && <ClockAndTest />}
    </div>
  )
}
