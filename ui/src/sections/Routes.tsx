import { useState } from 'react'
import Icon from '../components/Icon'
import SignalPicker, { SIGNAL_DRAG } from '../components/SignalPicker'
import { toast } from '../components/Toasts'
import { startLearn, stopLearn, useLearn } from '../engine/learn'
import { signalName } from '../engine/signals'
import {
  TARGET_KINDS, addMany, addManyTargets, addRoute, addTarget, duplicateRoute, removeRoute, removeTarget, routeValue, setManual,
  sourceValue, updateRoute, updateTarget, useRoutes, type Route, type Target, type TargetKind,
} from '../engine/routes'
import { useRico } from '../engine/store'
import { useTick } from '../engine/useTick'

// Signals: one table for every protocol. Each row takes one thing in (a MIDI
// knob, an OSC address, a fader you move with the mouse, a key, the audio)
// and sends it to as many places as you like, in any protocol. Add as many
// rows as you want, one at a time or many at once.

function Num({ value, onChange, width = 64, label, title }: { value: number; onChange: (v: number) => void; width?: number; label: string; title?: string }) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <input
      className="input num" aria-label={label} title={title ?? label} style={{ width }} inputMode="decimal"
      value={draft ?? String(value)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== null && draft.trim() !== '' && !Number.isNaN(Number(draft))) onChange(Number(draft))
        setDraft(null)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault()
          onChange(Number(((draft !== null ? Number(draft) : value) + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1)).toFixed(4)))
          setDraft(null)
        }
      }}
    />
  )
}

function Txt({ value, onChange, width, label, placeholder }: { value: string; onChange: (v: string) => void; width?: number; label: string; placeholder?: string }) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <input
      className="input" aria-label={label} title={label} style={width ? { width } : undefined} spellCheck={false} placeholder={placeholder}
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== null) onChange(draft.trim()); setDraft(null) }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}

// ---- where a row comes from ------------------------------------------------------

type SourceKind = 'manual' | 'midi-cc' | 'midi-note' | 'osc' | 'key' | 'audio' | 'other'
const SOURCE_LABEL: Record<SourceKind, string> = {
  manual: 'Fader (mouse, keys)', 'midi-cc': 'MIDI knob (CC)', 'midi-note': 'MIDI note', osc: 'OSC in', key: 'Keyboard key', audio: 'Audio', other: 'Any signal',
}
const AUDIO = ['level', 'low', 'mid', 'high', 'kick', 'snare']

function sourceKind(src: string): SourceKind {
  if (src === 'manual') return 'manual'
  if (src.startsWith('key:')) return 'key'
  if (src.startsWith('osc:')) return 'osc'
  if (src.startsWith('audio:')) return 'audio'
  if (/^midi:0:/.test(src)) return 'midi-note'
  if (src.startsWith('midi:')) return 'midi-cc'
  return src ? 'other' : 'manual'
}

function SourceCell({ r }: { r: Route }) {
  const kind = sourceKind(r.source)
  const set = (source: string) => updateRoute(r.id, { source }, 'Change source', `${r.id}.source`)
  const learn = useLearn()
  const learning = learn.active && learn.label === `row ${r.id}`
  const [, ch = '1', num = '0'] = r.source.startsWith('midi:') ? r.source.slice(5).split(':') : []
  return (
    <div className="sig-src">
      <select className="select" value={kind} aria-label="Comes from" onChange={(e) => {
        const k = e.target.value as SourceKind
        set(k === 'manual' ? 'manual' : k === 'key' ? 'key:A' : k === 'osc' ? 'osc:/fader/1' : k === 'audio' ? 'audio:low'
          : k === 'midi-cc' ? 'midi:1:1:20' : k === 'midi-note' ? 'midi:0:1:36' : '')
      }}>
        {Object.entries(SOURCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      {(kind === 'midi-cc' || kind === 'midi-note') && <>
        <label className="mini">ch <Num label="MIDI channel" width={46} value={Number(ch)} onChange={(c) => set(`midi:${kind === 'midi-note' ? 0 : 1}:${Math.max(1, Math.min(16, Math.round(c)))}:${num}`)} /></label>
        <label className="mini">{kind === 'midi-note' ? 'note' : 'cc'} <Num label="Number" width={52} value={Number(num)} onChange={(n) => set(`midi:${kind === 'midi-note' ? 0 : 1}:${ch}:${Math.max(0, Math.min(127, Math.round(n)))}`)} /></label>
      </>}
      {kind === 'osc' && <Txt label="Incoming OSC address" value={r.source.slice(4)} placeholder="/fader/1" onChange={(a) => set(`osc:${a.startsWith('/') ? a : `/${a}`}`)} />}
      {kind === 'key' && <Txt label="Key (hold it to send 1)" width={60} value={r.source.slice(4)} onChange={(k) => set(`key:${(k || 'A').slice(0, 12).toUpperCase()}`)} />}
      {kind === 'audio' && (
        <select className="select" value={r.source.slice(6)} aria-label="Band" onChange={(e) => set(`audio:${e.target.value}`)}>
          {AUDIO.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      )}
      {kind === 'other' && <SignalPicker compact label={`src ${r.id}`} value={r.source} onChange={set} />}
      <button className={`btn small${learning ? ' primary' : ' quiet'}`} title="Move a knob, send OSC or play a sound to pick it"
        onClick={() => (learning ? stopLearn() : startLearn(`row ${r.id}`, (sig) => updateRoute(r.id, { source: sig, name: r.name.startsWith('Row') || r.name === 'New route' ? signalName(sig) : r.name }, 'Learn source')))}>
        {learning ? 'Move it...' : 'Learn'}
      </button>
    </div>
  )
}

function NowCell({ r }: { r: Route }) {
  const v = r.source === 'manual' ? r.manual ?? 0 : Math.max(0, Math.min(1, sourceValue(r)))
  if (r.source === 'manual') {
    return (
      <div className="sig-now">
        <input type="range" className="range sig-fader" min={0} max={1} step={0.001} value={v} aria-label={`${r.name} fader`}
          onChange={(e) => setManual(r.id, Number(e.target.value))} />
        <span>{v.toFixed(2)}</span>
        <button className="btn small quiet" title="Send 1, then 0 (a button press)" onPointerDown={() => setManual(r.id, 1)} onPointerUp={() => setManual(r.id, 0)} onPointerLeave={() => (r.manual ?? 0) === 1 && setManual(r.id, 0)}>Hit</button>
      </div>
    )
  }
  return (
    <div className="sig-now">
      <div className="route-meter"><i style={{ width: `${routeValue(r.id) * 100}%` }} /></div>
      <span>{r.source ? v.toFixed(2) : '...'}</span>
    </div>
  )
}

// ---- where it goes --------------------------------------------------------------

function TargetLine({ r, t }: { r: Route; t: Target }) {
  const set = (part: Partial<Target>) => updateTarget(r.id, t.id, part)
  const v = routeValue(r.id)
  return (
    <div className={`sig-dest kind-${t.kind}`}>
      <select className="select" value={t.kind} aria-label="Send as" onChange={(e) => set({ kind: e.target.value as TargetKind })} title={TARGET_KINDS.find((k) => k.id === t.kind)?.about}>
        {TARGET_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
      </select>
      {t.kind === 'osc' && <>
        <Txt label="Computer" width={108} value={t.host} onChange={(host) => set({ host: host || '127.0.0.1' })} />
        <Num label="Port" title="Port" width={62} value={t.port} onChange={(port) => set({ port: Math.max(1, Math.min(65535, Math.round(port))) })} />
        <Txt label="OSC address" value={t.address} placeholder="/light/1" onChange={(address) => set({ address: address.startsWith('/') ? address : `/${address}` })} />
      </>}
      {(t.kind === 'midi-cc' || t.kind === 'midi-note') && <>
        <label className="mini">ch <Num label="MIDI channel" width={46} value={t.channel} onChange={(c) => set({ channel: Math.max(1, Math.min(16, Math.round(c))) })} /></label>
        <label className="mini">{t.kind === 'midi-cc' ? 'cc' : 'note'} <Num label="Number" width={52} value={t.number} onChange={(n) => set({ number: Math.max(0, Math.min(127, Math.round(n))) })} /></label>
      </>}
      {t.kind === 'dmx' && <label className="mini">channel <Num label="DMX channel" width={60} value={t.channel} onChange={(c) => set({ channel: Math.max(1, Math.min(512, Math.round(c))) })} /></label>}
      {t.kind === 'mqtt' && <Txt label="Topic" value={t.topic} placeholder="room/light" onChange={(topic) => set({ topic })} />}
      <span className="sig-range" title="The range it sends">
        <Num label="Sends from" width={52} value={t.min} onChange={(min) => set({ min })} />
        <span className="dim">to</span>
        <Num label="Sends to" width={52} value={t.max} onChange={(max) => set({ max })} />
      </span>
      <span className="sig-out">{(t.min + v * (t.max - t.min)).toFixed(2)}</span>
      <button className="icon-btn danger" aria-label="Remove this destination" title="Remove" onClick={() => removeTarget(r.id, t.id)}><Icon name="x" /></button>
    </div>
  )
}

function ManyTargets({ r, onClose }: { r: Route; onClose: () => void }) {
  const [count, setCount] = useState(10)
  const [kind, setKind] = useState<TargetKind>('osc')
  const [address, setAddress] = useState('/light/{n}')
  const [first, setFirst] = useState(1)
  return (
    <div className="sig-many">
      <span>Add</span>
      <Num label="How many" width={52} value={count} onChange={(c) => setCount(Math.max(1, Math.min(512, Math.round(c))))} />
      <select className="select" value={kind} onChange={(e) => setKind(e.target.value as TargetKind)}>{TARGET_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</select>
      {(kind === 'osc' || kind === 'mqtt') && <Txt label="Address, {n} counts up" value={address} onChange={setAddress} />}
      {kind !== 'osc' && kind !== 'mqtt' && <label className="mini">from number <Num label="First number" width={52} value={first} onChange={setFirst} /></label>}
      <button className="btn small primary" onClick={() => { addManyTargets(r.id, count, kind, address, first); onClose() }}>Add {count}</button>
      <button className="btn small quiet" onClick={onClose}>Cancel</button>
    </div>
  )
}

function Row({ r, index }: { r: Route; index: number }) {
  const [many, setMany] = useState(false)
  return (
    <tr className={r.enabled ? '' : 'off'}>
      <td>
        <label className="switch" title={r.enabled ? 'On' : 'Off'}>
          <input type="checkbox" role="switch" checked={r.enabled} onChange={(e) => updateRoute(r.id, { enabled: e.target.checked }, e.target.checked ? 'Turn row on' : 'Turn row off')} />
          <span className="sr-only">On</span>
        </label>
      </td>
      <td className="dim">{index + 1}</td>
      <td><Txt label="Name" value={r.name} onChange={(name) => updateRoute(r.id, { name: name || `Row ${index + 1}` }, 'Rename row')} /></td>
      <td><SourceCell r={r} /></td>
      <td><NowCell r={r} /></td>
      <td className="sig-to">
        {r.targets.map((t) => <TargetLine key={t.id} r={r} t={t} />)}
        {many ? <ManyTargets r={r} onClose={() => setMany(false)} /> : (
          <div className="row sig-add">
            <button className="btn small quiet" onClick={() => addTarget(r.id)}>+ Destination</button>
            <button className="btn small quiet" onClick={() => setMany(true)} title="One knob to ten OSC addresses, a fader to eight DMX channels...">+ Many</button>
          </div>
        )}
      </td>
      <td className="sig-actions">
        <button className="icon-btn" title="Duplicate row" aria-label="Duplicate row" onClick={() => duplicateRoute(r.id)}>⧉</button>
        <button className="icon-btn danger" title="Delete row" aria-label="Delete row" onClick={() => removeRoute(r.id)}><Icon name="x" /></button>
      </td>
    </tr>
  )
}

function AddManyRows({ onClose }: { onClose: () => void }) {
  const osc = useRico((s) => s.state?.osc)
  const [o, setO] = useState({
    count: 8, name: 'Fader {n}', source: 'manual' as const as 'manual' | 'midi-cc' | 'midi-note' | 'osc', channel: 1, first: 20,
    inAddress: '/fader/{n}', target: 'osc' as TargetKind, outAddress: `${osc?.address ?? '/rico'}/fader/{n}`,
    host: osc?.ip ?? '127.0.0.1', port: osc?.port ?? 8000, outFirst: 1,
  })
  const set = (part: Partial<typeof o>) => setO((x) => ({ ...x, ...part }))
  return (
    <div className="sig-many-rows">
      <h4>Add many rows</h4>
      <div className="row wrap">
        <label className="mini">How many <Num label="How many" width={56} value={o.count} onChange={(count) => set({ count: Math.max(1, Math.min(512, Math.round(count))) })} /></label>
        <label className="mini">Names <Txt label="Names, {n} counts up" width={140} value={o.name} onChange={(name) => set({ name })} /></label>
        <label className="mini">From
          <select className="select" value={o.source} onChange={(e) => set({ source: e.target.value as typeof o.source })}>
            <option value="manual">Faders here</option><option value="midi-cc">MIDI knobs (CC)</option><option value="midi-note">MIDI notes</option><option value="osc">OSC in</option>
          </select>
        </label>
        {(o.source === 'midi-cc' || o.source === 'midi-note') && <>
          <label className="mini">ch <Num label="Channel" width={46} value={o.channel} onChange={(channel) => set({ channel })} /></label>
          <label className="mini">first number <Num label="First number" width={52} value={o.first} onChange={(first) => set({ first })} /></label>
        </>}
        {o.source === 'osc' && <label className="mini">address <Txt label="Incoming address" value={o.inAddress} onChange={(inAddress) => set({ inAddress })} /></label>}
      </div>
      <div className="row wrap">
        <label className="mini">To
          <select className="select" value={o.target} onChange={(e) => set({ target: e.target.value as TargetKind })}>{TARGET_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</select>
        </label>
        {o.target === 'osc' && <>
          <Txt label="Computer" width={110} value={o.host} onChange={(host) => set({ host })} />
          <Num label="Port" width={62} value={o.port} onChange={(port) => set({ port })} />
        </>}
        {(o.target === 'osc' || o.target === 'mqtt') && <Txt label="Address, {n} counts up" value={o.outAddress} onChange={(outAddress) => set({ outAddress })} />}
        {o.target !== 'osc' && o.target !== 'mqtt' && <label className="mini">first {o.target === 'dmx' ? 'channel' : 'number'} <Num label="First" width={52} value={o.outFirst} onChange={(outFirst) => set({ outFirst })} /></label>}
      </div>
      <div className="row end">
        <button className="btn quiet" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={() => { addMany(o); onClose(); toast(`${o.count} rows added.`, true) }}>Add {o.count} rows</button>
      </div>
    </div>
  )
}

export default function Routes() {
  const routes = useRoutes()
  const [over, setOver] = useState(false)
  const [many, setMany] = useState(false)
  const [filter, setFilter] = useState('')
  useTick(60, routes.length > 0)
  const shown = routes.filter((r) => !filter || `${r.name} ${r.source} ${r.targets.map((t) => `${t.kind} ${t.address} ${t.port} ${t.channel} ${t.topic}`).join(' ')}`.toLowerCase().includes(filter.toLowerCase()))
  return (
    <div
      className={`routes${over ? ' over' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(SIGNAL_DRAG)) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setOver(false) }}
      onDrop={(e) => {
        setOver(false)
        if ((e.target as Element).closest('.signal-picker')) return
        const s = e.dataTransfer.getData(SIGNAL_DRAG)
        if (s) {
          e.preventDefault()
          addRoute(s, signalName(s))
        }
      }}
    >
      <div className="routes-head">
        <p>Each row takes one thing in and sends it to as many places as you want, in any protocol: MIDI to OSC, OSC to DMX, a fader to ten apps. No controller? Use a fader row.</p>
        <div className="row">
          <input className="input" placeholder="Find a row" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 160 }} />
          <button className="btn quiet" onClick={() => setMany(!many)}>+ Many rows</button>
          <button className="btn quiet" onClick={() => startLearn('a new row', (sig) => addRoute(sig, signalName(sig)))} title="Move a control and a row for it appears">+ Learn a row</button>
          <button className="btn primary" onClick={() => addRoute('manual', `Row ${routes.length + 1}`)}>+ Add row</button>
        </div>
      </div>
      {many && <AddManyRows onClose={() => setMany(false)} />}
      <div className="sig-scroll">
        <table className="sig-table">
          <thead>
            <tr><th><span className="sr-only">On</span></th><th>#</th><th>Name</th><th>Comes from</th><th>Now</th><th>Goes to</th><th><span className="sr-only">Actions</span></th></tr>
          </thead>
          <tbody>
            {shown.map((r) => <Row key={r.id} r={r} index={routes.indexOf(r)} />)}
          </tbody>
        </table>
        {routes.length === 0 && (
          <ol className="routes-howto">
            <li><b>Press + Add row.</b> It starts as a fader you can move with the mouse, so you don't need a controller.</li>
            <li><b>Pick where it comes from:</b> a MIDI knob or note, an OSC address, a key, the audio. Or press Learn and move the control.</li>
            <li><b>Pick where it goes.</b> Change the port and address right in the table. Add as many destinations as you like, in any protocol.</li>
          </ol>
        )}
      </div>
    </div>
  )
}
