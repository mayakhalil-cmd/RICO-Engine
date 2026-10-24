import { useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { Meter, Panel, Switch } from '../components/Fields'
import { toast } from '../components/Toasts'
import { rico } from '../engine/connection'
import { useCommand, useRico } from '../engine/store'
import { forgetSeen, useSeenAddresses, useSeenControls, type SeenControl } from '../engine/seen'
import { SIGNAL_DRAG } from './Create'

// Views that look like the thing they show: knobs for knobs, a channel grid
// for DMX, an address tree for OSC. Anything that moves can be dragged onto
// a setting in Create to link it.

function dragSignal(e: React.DragEvent, signal: string) {
  e.dataTransfer.setData(SIGNAL_DRAG, signal)
  e.dataTransfer.setData('text/plain', signal)
  e.dataTransfer.effectAllowed = 'link'
}

// MIDI

function Knob({ value }: { value: number }) {
  const a0 = -225, a1 = 45
  const a = a0 + (a1 - a0) * value
  const arc = (from: number, to: number) => {
    const r = 18, cx = 24, cy = 24
    const p = (deg: number) => [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)]
    const [x0, y0] = p(from)
    const [x1, y1] = p(to)
    const large = to - from > 180 ? 1 : 0
    return `M${x0} ${y0} A${r} ${r} 0 ${large} 1 ${x1} ${y1}`
  }
  const [hx, hy] = [24 + 11 * Math.cos((a * Math.PI) / 180), 24 + 11 * Math.sin((a * Math.PI) / 180)]
  return (
    <svg viewBox="0 0 48 48" className="knob" aria-hidden="true">
      <path d={arc(a0, a1)} className="knob-track" />
      {value > 0.001 && <path d={arc(a0, a)} className="knob-value" />}
      <line x1="24" y1="24" x2={hx} y2={hy} className="knob-hand" />
    </svg>
  )
}

function ControlTile({ c, name, address }: { c: SeenControl; name?: string; address?: string }) {
  const fresh = performance.now() - c.at < 400
  const label = c.kind === 'note' ? `Note ${c.number}` : c.kind === 'cc' ? `CC ${c.number}` : c.kind === 'bend' ? 'Pitch bend' : c.kind === 'pressure' ? 'Pressure' : 'Program'
  return (
    <div
      className={`ctl ${c.kind}${fresh ? ' fresh' : ''}${c.on ? ' on' : ''}`}
      draggable
      onDragStart={(e) => dragSignal(e, `midi:${c.key}`)}
      title={`${name ?? label}${address ? `\n${address}` : ''}\nDrag onto a setting in Motion to link it.`}
    >
      {c.kind === 'cc' || c.kind === 'pressure' ? <Knob value={c.value} />
        : c.kind === 'note' ? <div className="pad-light" />
        : <div className="bend"><i style={{ height: `${c.value * 100}%` }} /></div>}
      <div className="ctl-name">{name ?? label}</div>
      <div className="ctl-val">{c.kind === 'note' ? (c.on ? 'on' : 'off') : Math.round(c.value * 127)}</div>
    </div>
  )
}

export function MidiControls() {
  const seen = useSeenControls()
  const mappings = useRico((s) => s.state?.mappings)
  const byKey = useMemo(() => new Map((mappings ?? []).map((m) => [m.key, m])), [mappings])
  const channels = useMemo(() => {
    const g = new Map<number, SeenControl[]>()
    for (const c of seen) g.set(c.channel, [...(g.get(c.channel) ?? []), c])
    return [...g.entries()]
  }, [seen])

  return (
    <Panel
      title="Controls"
      sub="Every knob, fader and pad RICO has heard, live. Drag one onto a setting in Motion to link it."
      actions={seen.length > 0 ? <button className="btn quiet small" onClick={forgetSeen}>Clear</button> : undefined}
    >
      {seen.length === 0 && <div className="empty"><b>Move something on your controller.</b> Each control shows up here the first time it moves.</div>}
      {channels.map(([ch, list]) => (
        <div key={ch} className="ctl-group">
          <div className="dim small">Channel {ch}</div>
          <div className="ctl-grid">
            {list.map((c) => <ControlTile key={c.key} c={c} name={byKey.get(c.key)?.name} address={byKey.get(c.key)?.address} />)}
          </div>
        </div>
      ))}
    </Panel>
  )
}

// OSC

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return <svg className="spark" viewBox="0 0 60 16" aria-hidden="true" />
  const lo = Math.min(...values), hi = Math.max(...values)
  const span = hi - lo || 1
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 60},${15 - ((v - lo) / span) * 14}`).join(' ')
  return <svg className="spark" viewBox="0 0 60 16" aria-hidden="true"><polyline points={pts} /></svg>
}

export function OscAddresses() {
  const seen = useSeenAddresses()
  const [filter, setFilter] = useState('')
  const shown = seen.filter((a) => !filter || a.address.toLowerCase().includes(filter.toLowerCase()))

  // Group by the first part of the address, like folders.
  const groups = useMemo(() => {
    const g = new Map<string, typeof shown>()
    for (const a of shown) {
      const top = '/' + (a.address.split('/')[1] ?? '')
      g.set(top, [...(g.get(top) ?? []), a])
    }
    return [...g.entries()]
  }, [shown])

  return (
    <Panel
      title="Addresses"
      sub="Every OSC address coming in (blue) and going out (pink), with its latest value. Drag an incoming one onto a setting in Motion."
      actions={<input className="input" style={{ width: 180 }} placeholder="Find" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Find an address" />}
    >
      {seen.length === 0 && <div className="empty"><b>No OSC yet.</b> Move a mapped control, or send OSC to RICO from an app or phone.</div>}
      {groups.map(([top, list]) => (
        <div key={top} className="addr-group">
          <div className="addr-top">{top}</div>
          {list.map((a) => (
            <div
              key={a.address}
              className={`addr ${a.dir}${performance.now() - a.at < 400 ? ' fresh' : ''}`}
              draggable={a.dir === 'in'}
              onDragStart={(e) => dragSignal(e, `osc:${a.address}`)}
            >
              <span className="addr-path">{a.address.slice(top.length) || '/'}</span>
              <Spark values={a.history} />
              <span className="addr-val">{a.value.toFixed(3)}</span>
            </div>
          ))}
        </div>
      ))}
    </Panel>
  )
}

// audio

export function AudioMeters() {
  const audio = useRico((s) => s.live.audio)
  const lfos = useRico((s) => s.live.lfos)
  const capturing = useRico((s) => s.state?.audio.capturing)
  const { run, error } = useCommand()
  const bands: [string, string, number][] = audio
    ? [['level', 'Level', audio.level], ['low', 'Low', audio.low], ['mid', 'Mid', audio.mid], ['high', 'High', audio.high]]
    : []

  return (
    <Panel
      title="Audio"
      sub="What your computer is playing, turned into signals. Drag a band onto a setting in Motion."
      live={capturing}
      actions={capturing
        ? <button className="btn out small" onClick={() => run('audio.stop')}>Stop listening</button>
        : <button className="btn small" onClick={() => run('audio.start')}>Listen</button>}
    >
      {error && <div className="error">{error}</div>}
      {!audio && <div className="empty"><b>Not listening.</b> Press Listen and play some music.</div>}
      {audio && (
        <div className="bands">
          {bands.map(([id, label, v]) => (
            <div key={id} className="band" draggable onDragStart={(e) => dragSignal(e, `audio:${id}`)}>
              <div className="band-bar"><i style={{ height: `${Math.min(1, v) * 100}%` }} /></div>
              <span>{label}</span>
            </div>
          ))}
          {[['kick', 'Kick', audio.kick], ['snare', 'Snare', audio.snare]].map(([id, label, v]) => (
            <div key={id as string} className="band hit" draggable onDragStart={(e) => dragSignal(e, `audio:${id}`)}>
              <div className="hit-light" style={{ opacity: 0.15 + 0.85 * Number(v) }} />
              <span>{label}</span>
            </div>
          ))}
        </div>
      )}
      {lfos.length > 0 && (
        <>
          <h3 style={{ marginTop: 16 }}>LFOs</h3>
          <ul className="list">
            {lfos.map((l, i) => (
              <li key={i} draggable onDragStart={(e) => dragSignal(e, `lfo:${i}`)}>
                <span className="name">{l.name}</span>
                <div style={{ width: 160 }}><Meter value={l.value} kind="in" /></div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  )
}

// DMX

export function DmxGrid() {
  const dmx = useRico((s) => s.state?.dmx)
  const [local, setLocal] = useState<Record<number, number>>({})
  const [ip, setIp] = useState('')
  const [hover, setHover] = useState<number | null>(null)
  const drag = useRef<{ ch: number; startY: number; startV: number } | null>(null)
  const { run, error } = useCommand()
  if (!dmx) return null

  const value = (ch: number) => local[ch] ?? (dmx.channels[ch - 1] ?? 0) / 255
  const setCh = (ch: number, v: number) => {
    v = Math.max(0, Math.min(1, v))
    setLocal((l) => ({ ...l, [ch]: v }))
    rico.send('dmx.set', { channel: ch, value: v })
  }
  const down = (e: RPointerEvent, ch: number) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { ch, startY: e.clientY, startV: value(ch) }
  }
  const moveP = (e: RPointerEvent) => {
    const d = drag.current
    if (!d) return
    setCh(d.ch, d.startV + (d.startY - e.clientY) / 120)
  }
  const up = () => {
    drag.current = null
    window.setTimeout(() => setLocal({}), 600)
  }

  return (
    <Panel
      title="DMX"
      sub="512 channels of one universe. Drag a cell up or down to set it. Double-click to switch it fully on or off."
      live={dmx.running}
      actions={
        <div className="row">
          {!dmx.running && <input className="input" style={{ width: 160 }} placeholder={dmx.ip} value={ip} onChange={(e) => setIp(e.target.value)} aria-label="Art-Net address" />}
          {dmx.running
            ? <button className="btn out small" onClick={() => run('dmx.stop')}>Stop Art-Net</button>
            : <button className="btn small" onClick={() => run('dmx.start', ip ? { ip } : {})}>Start Art-Net</button>}
        </div>
      }
    >
      {error && <div className="error">{error}</div>}
      <div className="dmx-info small muted">
        {hover ? <>Channel <b className="ok">{hover}</b>: {Math.round(value(hover) * 255)} ({Math.round(value(hover) * 100)}%)</> : dmx.running ? `Sending universe ${dmx.universe} to ${dmx.ip}` : 'Art-Net is off. Values are kept and sent when you start it.'}
      </div>
      <div className="dmx-grid" onPointerMove={moveP} onPointerUp={up} onPointerCancel={up}>
        {Array.from({ length: 512 }, (_, i) => {
          const ch = i + 1
          const v = value(ch)
          return (
            <div
              key={ch}
              className="dmx-cell"
              style={{ ['--v' as string]: v }}
              onPointerDown={(e) => down(e, ch)}
              onPointerEnter={() => setHover(ch)}
              onDoubleClick={() => setCh(ch, v > 0.5 ? 0 : 1)}
              title={`Channel ${ch}`}
            >
              {ch % 16 === 1 && <span>{ch}</span>}
            </div>
          )
        })}
      </div>
    </Panel>
  )
}

// MQTT

export function MqttTopics() {
  const mqtt = useRico((s) => s.state?.mqtt)
  const { run, error } = useCommand()
  const [pub, setPub] = useState({ topic: 'rico/out', payload: '1' })
  const topics = useMemo(() => {
    const m = new Map<string, { payload: string; count: number }>()
    for (const msg of mqtt?.messages ?? []) {
      const t = m.get(msg.topic)
      if (t) t.count++
      else m.set(msg.topic, { payload: msg.payload, count: 1 })
    }
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
  }, [mqtt?.messages])
  if (!mqtt) return null

  return (
    <Panel title="Devices" sub={mqtt.connected ? `Connected to ${mqtt.broker}` : 'Small devices like ESP32 boards, Raspberry Pis and Twin Ctrl talk over MQTT.'} live={mqtt.connected}>
      {!mqtt.connected && <div className="note">{mqtt.status}. Connect to a broker under Connections.</div>}
      {topics.length === 0 && mqtt.connected && <div className="empty">Connected. Nothing has arrived yet.</div>}
      <ul className="list">
        {topics.map(([topic, t]) => (
          <li key={topic}>
            <span className="name" title={topic}>{topic}</span>
            <code>{t.payload}</code>
            <span className="dim small">{t.count}x</span>
          </li>
        ))}
      </ul>
      <h3 style={{ marginTop: 14 }}>Send a message</h3>
      <form className="row" onSubmit={async (e) => {
        e.preventDefault()
        const ack = await run('mqtt.publish', pub)
        if (ack.ok) toast(`Sent to ${pub.topic}.`, true)
      }}>
        <input className="input grow" value={pub.topic} onChange={(e) => setPub({ ...pub, topic: e.target.value })} aria-label="Topic" />
        <input className="input" style={{ width: 120 }} value={pub.payload} onChange={(e) => setPub({ ...pub, payload: e.target.value })} aria-label="Message" />
        <button className="btn" disabled={!mqtt.connected}>Send</button>
      </form>
      {error && <div className="error">{error}</div>}
    </Panel>
  )
}

export function AudioSwitch() {
  const capturing = useRico((s) => s.state?.audio.capturing)
  const { run } = useCommand()
  return <Switch checked={Boolean(capturing)} onChange={(on) => run(on ? 'audio.start' : 'audio.stop')}>Listen to audio</Switch>
}
