import { useMemo, useState } from 'react'
import Icon from '../components/Icon'
import { Meter, TextField } from '../components/Fields'
import { toast } from '../components/Toasts'
import { rico } from '../engine/connection'
import { useCommand, useRico } from '../engine/store'
import type { Mapping } from '../engine/types'
import { addRoute } from '../engine/routes'
import { dockApi } from '../shell/workspaces'
import { openPanel } from '../shell/Workspace'

const TYPE_LABEL: Record<Mapping['type'], string> = {
  note: 'Note',
  cc: 'Knob / fader',
  pitchbend: 'Pitch bend',
  program: 'Program',
  aftertouch: 'Pressure',
  other: 'Other',
}

const KINDS = [['1', 'Knob / fader (CC)'], ['0', 'Note (pad, key)'], ['2', 'Pitch bend'], ['3', 'Program'], ['4', 'Pressure']]

// Adds mappings by hand: one, or many in a row (CC 20 to 27...).
function AddMapping({ count, prefix }: { count: number; prefix: string }) {
  const [type, setType] = useState('1')
  const [channel, setChannel] = useState('1')
  const [number, setNumber] = useState('20')
  const [howMany, setHowMany] = useState('1')
  const [address, setAddress] = useState(`${prefix}/ctrl{n}`)
  const add = async () => {
    const n = Math.max(1, Math.min(128, Number(howMany) || 1))
    for (let i = 0; i < n; i++) {
      const num = Math.min(127, (Number(number) || 0) + i)
      const ack = await rico.send('mapping.add', {
        type: Number(type), channel: Number(channel) || 1, number: num,
        address: address.split('{n}').join(String(count + i + 1)),
        name: `${KINDS.find((k) => k[0] === type)?.[1].split(' ')[0]} ${num}`,
      })
      if (!ack.ok) return toast(ack.error ?? 'Could not add that.')
    }
    toast(n === 1 ? 'Mapping added. Move it with the slider, or with your controller.' : `${n} mappings added.`, true)
  }
  return (
    <div className="map-add">
      <b>Add by hand</b>
      <select className="select" value={type} onChange={(e) => setType(e.target.value)} aria-label="Kind">{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      <label className="mini">ch <input className="input num" style={{ width: 46 }} value={channel} onChange={(e) => setChannel(e.target.value)} /></label>
      <label className="mini">number <input className="input num" style={{ width: 52 }} value={number} onChange={(e) => setNumber(e.target.value)} /></label>
      <label className="mini">how many <input className="input num" style={{ width: 46 }} value={howMany} onChange={(e) => setHowMany(e.target.value)} /></label>
      <label className="mini">OSC address <input className="input" style={{ width: 170 }} value={address} onChange={(e) => setAddress(e.target.value)} title="{n} counts up" /></label>
      <button className="btn small primary" onClick={add}>Add</button>
    </div>
  )
}

function Row({ m, value }: { m: Mapping; value: number }) {
  const update = async (part: Record<string, unknown>) => {
    const ack = await rico.send('mapping.update', { key: m.key, ...part })
    if (!ack.ok) toast(ack.error ?? 'Could not change that mapping.')
  }
  return (
    <tr>
      <td>
        <div>{TYPE_LABEL[m.type]}</div>
        <div className="dim small">ch {m.channel} / {m.type === 'note' ? 'note' : 'number'} {m.number}</div>
      </td>
      <td><TextField value={m.name} onCommit={(name) => update({ name })} /></td>
      <td><TextField value={m.address} onCommit={(address) => {
        if (!address.startsWith('/')) return toast('OSC addresses start with a slash, like /light/1.')
        update({ address })
      }} /></td>
      <td>
        <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
          <TextField numeric width={70} value={m.min} onCommit={(v) => update({ min: Number(v) })} />
          <span className="dim">to</span>
          <TextField numeric width={70} value={m.max} onCommit={(v) => update({ max: Number(v) })} />
        </div>
      </td>
      <td style={{ width: 170 }}>
        {m.type === 'note' ? (
          <button className="btn small quiet" title="Play it without a controller" onPointerDown={() => rico.send('mapping.set', { key: m.key, value: 1 })} onPointerUp={() => rico.send('mapping.set', { key: m.key, value: 0 })}>Hit</button>
        ) : (
          <input type="range" className="range" min={0} max={1} step={1 / 127} value={value} aria-label={`Move ${m.name}`} title="Move it without a controller"
            onChange={(e) => rico.send('mapping.set', { key: m.key, value: Number(e.target.value) })} />
        )}
        <Meter value={value} kind="out" />
        <div className="dim small">{(m.min + value * (m.max - m.min)).toFixed(2)}</div>
      </td>
      <td>
        <button className="btn small quiet" title="Send this control to more places too" onClick={() => {
          addRoute(`midi:${m.key}`, m.name || `${TYPE_LABEL[m.type]} ${m.number}`)
          const api = dockApi()
          if (api) openPanel(api, 'routes')
          toast('Added a route. Add as many places as you like.', true)
        }}>+ More places</button>
      </td>
      <td>
        <button className="icon-btn danger" title="Remove mapping" onClick={() => rico.send('mapping.remove', { key: m.key })}><Icon name="x" /></button>
      </td>
    </tr>
  )
}

export default function Mappings() {
  const mappings = useRico((s) => s.state?.mappings)
  const values = useRico((s) => s.live.values)
  const osc = useRico((s) => s.state?.osc)
  const [filter, setFilter] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const { run } = useCommand()

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase()
    const list = mappings ?? []
    if (!f) return list
    return list.filter((m) => `${m.name} ${m.address} ${m.number}`.toLowerCase().includes(f))
  }, [mappings, filter])

  if (!mappings) return null

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row">
        <p className="muted grow" style={{ margin: 0, maxWidth: '72ch' }}>
          MIDI to OSC, the classic way. RICO adds a row the first time it hears a control, or add rows by hand. Rename it, give it the OSC address your app expects, and set the range. For more destinations and other protocols, use + More places or the Signals table.
        </p>
        <input className="input" style={{ width: 220 }} placeholder="Find a mapping" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Find a mapping" />
        {mappings.length > 0 && (confirmClear ? (
          <>
            <button className="btn out" onClick={() => { run('mapping.clear'); setConfirmClear(false) }}>Remove all {mappings.length}</button>
            <button className="btn quiet" onClick={() => setConfirmClear(false)}>Keep them</button>
          </>
        ) : (
          <button className="btn quiet" onClick={() => setConfirmClear(true)}>Remove all</button>
        ))}
      </div>

      <AddMapping count={mappings.length} prefix={osc?.address ?? '/rico'} />
      {mappings.length === 0 ? (
        <div className="empty"><b>No mappings yet.</b> Move a knob on a controller, or add one by hand above.</div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Control</th>
                <th>Name</th>
                <th>OSC address</th>
                <th>Sends</th>
                <th>Now</th>
                <th><span className="sr-only">More</span></th>
                <th><span className="sr-only">Remove</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => <Row key={m.key} m={m} value={values[m.key] ?? 0} />)}
            </tbody>
          </table>
          {shown.length === 0 && <div className="empty">Nothing matches "{filter}".</div>}
        </div>
      )}
    </div>
  )
}
