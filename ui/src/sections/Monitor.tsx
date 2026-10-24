import { useEffect, useMemo, useRef, useState } from 'react'
import { Panel, TextField } from '../components/Fields'
import { rico } from '../engine/connection'
import { useRico } from '../engine/store'
import type { LogEntry } from '../engine/types'

const FILTERS = [
  { id: 'all', label: 'Everything', test: () => true },
  { id: 'midi', label: 'MIDI', test: (e: LogEntry) => e.ch > 0 && e.type !== 'OSC out' },
  { id: 'oscin', label: 'OSC in', test: (e: LogEntry) => e.type === 'OSC in' },
  { id: 'oscout', label: 'OSC out', test: (e: LogEntry) => e.type === 'OSC out' || e.type === 'OSC' },
  { id: 'rico', label: 'RICO', test: (e: LogEntry) => e.type === 'RICO' },
]

function direction(e: LogEntry) {
  if (e.type === 'OSC out' || e.type === 'OSC' || e.type === 'MIDI out') return 'out'
  if (e.type === 'RICO') return 'ok'
  return 'in'
}

export function Log() {
  const log = useRico((s) => s.log)
  const [filter, setFilter] = useState('all')
  const [paused, setPaused] = useState<LogEntry[] | null>(null)
  const box = useRef<HTMLDivElement | null>(null)
  const stick = useRef(true)

  const rows = useMemo(() => {
    const f = FILTERS.find((x) => x.id === filter) ?? FILTERS[0]
    return (paused ?? log).filter(f.test).slice(-300)
  }, [log, paused, filter])

  useEffect(() => {
    if (stick.current && box.current) box.current.scrollTop = box.current.scrollHeight
  }, [rows])

  return (
    <Panel
      title="Messages"
      sub="Newest at the bottom. Blue came in, pink went out."
      actions={
        <div className="row">
          <button className="btn quiet small" onClick={() => setPaused(paused ? null : log)}>{paused ? 'Resume' : 'Pause'}</button>
          <button className="btn quiet small" onClick={() => { rico.clearLog(); setPaused(null) }}>Clear</button>
        </div>
      }
    >
      <div className="row" role="group" aria-label="Show" style={{ marginBottom: 10 }}>
        {FILTERS.map((f) => (
          <button key={f.id} className={`chip${filter === f.id ? ' on' : ''}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</button>
        ))}
      </div>
      <div
        className="log"
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 30
        }}
      >
        {rows.length === 0 && <div className="empty">Nothing yet. Move a control, or send a test message from the right.</div>}
        {rows.map((e) => (
          <div key={e.n} className={`log-row ${direction(e)}`}>
            <span className="dim">{e.time}</span>
            <span className="log-type">{e.type}</span>
            <span className="log-text">{e.address || e.text}</span>
            <span className="log-val">{e.address ? e.value.toFixed(3) : e.d2 >= 0 ? e.d2 : ''}</span>
          </div>
        ))}
      </div>
    </Panel>
  )
}

export function OscSender() {
  const osc = useRico((s) => s.state?.osc)
  const [address, setAddress] = useState('/rico/test')
  const [value, setValue] = useState(0.5)
  const send = (v = value) => rico.send('osc.send', { address, value: v })
  return (
    <Panel title="Send OSC" sub={osc ? `To ${osc.ip}:${osc.port} and every app under "Also send to".` : undefined}>
      <div className="stack">
        <TextField label="Address" value={address} onCommit={setAddress} />
        <label className="field">
          <span>Value {value.toFixed(3)}. Dragging sends as you go.</span>
          <input type="range" min={0} max={1} step={0.001} value={value} className="range"
            onChange={(e) => { const v = Number(e.target.value); setValue(v); send(v) }} />
        </label>
        <div className="row">
          <button className="btn" onClick={() => send()}>Send</button>
          <button className="btn quiet" onClick={() => send(1)}>Send 1</button>
          <button className="btn quiet" onClick={() => send(0)}>Send 0</button>
        </div>
      </div>
    </Panel>
  )
}

export function MidiPads() {
  const notes = useRico((s) => s.live.notes)
  const [channel, setChannel] = useState(1)
  const [cc, setCc] = useState({ number: 74, value: 64 })
  const status = (base: number) => base + Math.max(0, Math.min(15, channel - 1))
  const pads = [36, 37, 38, 39, 40, 41, 42, 43]
  return (
    <Panel title="Play MIDI" sub="Goes to the MIDI output and RICO's virtual ports, as if you played it.">
      <div className="stack">
        <div className="row">
          <TextField label="Channel" numeric value={channel} onCommit={(v) => setChannel(Math.max(1, Math.min(16, Number(v) || 1)))} />
        </div>
        <div className="pads">
          {pads.map((n) => (
            <button
              key={n}
              className={`pad${notes.includes(n) ? ' hit' : ''}`}
              onPointerDown={() => rico.send('midi.send', { bytes: [status(0x90), n, 110] })}
              onPointerUp={() => rico.send('midi.send', { bytes: [status(0x80), n, 0] })}
              onPointerLeave={(e) => e.buttons && rico.send('midi.send', { bytes: [status(0x80), n, 0] })}
            >
              {n}
            </button>
          ))}
        </div>
        <label className="field">
          <span>CC {cc.number}, value {cc.value}</span>
          <input type="range" className="range" min={0} max={127} value={cc.value}
            onChange={(e) => { const value = Number(e.target.value); setCc({ ...cc, value }); rico.send('midi.send', { bytes: [status(0xb0), cc.number, value] }) }} />
        </label>
        <TextField label="CC number" numeric value={cc.number} onCommit={(v) => setCc({ ...cc, number: Math.max(0, Math.min(127, Number(v) || 0)) })} />
      </div>
    </Panel>
  )
}

