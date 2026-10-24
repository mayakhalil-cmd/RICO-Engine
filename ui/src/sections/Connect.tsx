import { useState } from 'react'
import Icon from '../components/Icon'
import { Panel, Select, Switch, TextField } from '../components/Fields'
import { toast } from '../components/Toasts'
import { useCommand, useRico } from '../engine/store'

export function MidiPanel() {
  const midi = useRico((s) => s.state?.midi)
  const { run, error } = useCommand()
  const [portName, setPortName] = useState('RICO Port')
  if (!midi) return null
  const wms = midi.windowsMidi

  return (
    <Panel
      title="MIDI"
      sub="Controllers, keyboards and other music software."
      live={midi.inOpen}
      actions={<button className="btn quiet small" onClick={() => run('midi.scan')}>Look again</button>}
    >
      <div className="stack">
        <Select
          label="Input, what RICO listens to"
          value={midi.inIndex}
          placeholder="Nothing"
          options={midi.inputs.map((n, i) => ({ value: i, label: n }))}
          onChange={(v) => (Number(v) < 0 ? run('midi.close') : run('midi.openIn', { index: Number(v) }))}
        />
        <Select
          label="Output, where RICO plays MIDI to"
          value={midi.outIndex}
          placeholder="Nothing"
          options={midi.outputs.map((n, i) => ({ value: i, label: n }))}
          onChange={(v) => Number(v) >= 0 && run('midi.openOut', { index: Number(v) })}
        />
        <div className="row">
          <Switch checked={midi.thru} onChange={(on) => run('midi.thru', { on })}>Pass input straight to the output and virtual ports</Switch>
        </div>
        <div className="row">
          <Switch checked={midi.autoConnect} onChange={(on) => run('midi.autoConnect', { on })}>Connect the first device when RICO starts</Switch>
        </div>
        <Select
          label="MIDI system"
          value={midi.backend}
          options={midi.backends.map((b, i) => ({ value: i, label: b, disabled: i === 1 && !wms.compiled }))}
          onChange={(v) => run('midi.backend', { index: Number(v) })}
        />
        {error && <div className="error">{error}</div>}

        <h3 style={{ marginTop: 8 }}>Virtual ports</h3>
        <p className="muted small" style={{ margin: 0 }}>
          A virtual port shows up in other apps like a real MIDI device. Use one to send RICO's MIDI into Houdini, Ableton
          or a game engine, or to send MIDI from those apps into RICO.
        </p>
        {!wms.compiled ? (
          <div className="note">This copy of RICO was built without Windows MIDI Services, so it can't make virtual ports.</div>
        ) : (
          <>
            {wms.status !== 'Ready' && wms.status !== 'Not started' && <div className="note">{wms.status}</div>}
            <ul className="list">
              {midi.virtualPorts.map((p) => (
                <li key={p} className="on">
                  <span className="name">{p}</span>
                  <button className="icon-btn danger" title={`Remove ${p}`} onClick={() => run('midi.virtual.remove', { name: p })}><Icon name="x" /></button>
                </li>
              ))}
            </ul>
            <form className="row" onSubmit={async (e) => {
              e.preventDefault()
              const ack = await run('midi.virtual.create', { name: portName.trim() })
              if (ack.ok) toast(`"${portName.trim()}" is ready in your other apps.`, true)
            }}>
              <input className="input grow" value={portName} onChange={(e) => setPortName(e.target.value)} aria-label="New port name" maxLength={60} />
              <button className="btn" disabled={!portName.trim()}>Make port</button>
            </form>
          </>
        )}
      </div>
    </Panel>
  )
}

export function OscPanel() {
  const osc = useRico((s) => s.state?.osc)
  const { run, error } = useCommand()
  const [dest, setDest] = useState({ name: '', ip: '127.0.0.1', port: '9000' })
  if (!osc) return null

  return (
    <Panel title="OSC" sub="The language most creative apps use for live control." live={osc.sendToOSC}>
      <div className="stack">
        <Select
          label="Main app"
          value={osc.preset}
          options={osc.presets.map((p) => ({ value: p.index, label: `${p.name}  (port ${p.port})` }))}
          onChange={(v) => run('osc.preset', { index: Number(v) })}
        />
        <div className="row">
          <div className="grow"><TextField label="Computer" value={osc.ip} onCommit={(ip) => run('osc.target', { ip })} /></div>
          <TextField label="Port" numeric value={osc.port} onCommit={(p) => run('osc.target', { port: Number(p) })} />
          <div className="grow"><TextField label="Addresses start with" value={osc.address} onCommit={(address) => run('osc.target', { address })} /></div>
        </div>
        <Switch checked={osc.sendToOSC} onChange={(on) => run('osc.enabled', { on })}>Send OSC</Switch>
        <Switch checked={osc.oscToMidi} onChange={(on) => run('osc.toMidi', { on })}>Turn incoming OSC back into MIDI</Switch>
        <p className="muted small" style={{ margin: 0 }}>
          RICO listens for OSC on port <code>{osc.listenPort}</code>. From a phone or tablet on the same network, send to <code>{osc.localIp}:{osc.listenPort}</code>.
        </p>
        {error && <div className="error">{error}</div>}

        <h3 style={{ marginTop: 8 }}>Also send to</h3>
        {osc.destinations.length === 0 && <div className="empty">Add more apps here to send the same controls to all of them at once.</div>}
        <ul className="list">
          {osc.destinations.map((d, i) => (
            <li key={`${d.name}${i}`} className={d.enabled ? 'on' : ''}>
              <Switch checked={d.enabled} onChange={(on) => run('osc.dest.enable', { index: i, on })}>
                <span className="sr-only">Send to {d.name}</span>
              </Switch>
              <span className="name">{d.name}</span>
              <span className="muted small">{d.ip}:{d.port}</span>
              <button className="icon-btn danger" title={`Remove ${d.name}`} onClick={() => run('osc.dest.remove', { index: i })}><Icon name="x" /></button>
            </li>
          ))}
        </ul>
        <form className="row" onSubmit={(e) => {
          e.preventDefault()
          run('osc.dest.add', { name: dest.name || 'Destination', ip: dest.ip, port: Number(dest.port) })
          setDest({ ...dest, name: '' })
        }}>
          <input className="input grow" placeholder="Name" value={dest.name} onChange={(e) => setDest({ ...dest, name: e.target.value })} aria-label="Destination name" />
          <input className="input" style={{ width: 140 }} value={dest.ip} onChange={(e) => setDest({ ...dest, ip: e.target.value })} aria-label="Destination computer" />
          <input className="input num" value={dest.port} onChange={(e) => setDest({ ...dest, port: e.target.value.replace(/\D/g, '') })} aria-label="Destination port" />
          <button className="btn">Add</button>
        </form>
      </div>
    </Panel>
  )
}

export function MorePanel() {
  const state = useRico((s) => s.state)
  const { run, error } = useCommand()
  const [dmxIp, setDmxIp] = useState('')
  const [broker, setBroker] = useState('')
  if (!state) return null
  const { audio, dmx, mqtt } = state
  return (
    <Panel title="Sound, light and devices" sub="Audio analysis, DMX lighting and network devices.">
      <div className="stack">
        <div className="row">
          <div className="grow">
            <h3>Audio</h3>
            <p className="muted small" style={{ margin: 0 }}>Listens to what your computer is playing and turns it into low, mid, high and beat signals.</p>
          </div>
          {audio.capturing
            ? <button className="btn out" onClick={() => run('audio.stop')}>Stop listening</button>
            : <button className="btn" onClick={() => run('audio.start')}>Listen</button>}
        </div>

        <div className="row">
          <div className="grow">
            <h3>DMX over Art-Net</h3>
            <p className="muted small" style={{ margin: 0 }}>{dmx.running ? `Sending universe ${dmx.universe} to ${dmx.ip}` : 'For lights and fixtures on your network.'}</p>
          </div>
          {!dmx.running && <input className="input" style={{ width: 160 }} placeholder={dmx.ip} value={dmxIp} onChange={(e) => setDmxIp(e.target.value)} aria-label="Art-Net address" />}
          {dmx.running
            ? <button className="btn out" onClick={() => run('dmx.stop')}>Stop</button>
            : <button className="btn" onClick={() => run('dmx.start', dmxIp ? { ip: dmxIp } : {})}>Start</button>}
        </div>

        <div className="row">
          <div className="grow">
            <h3>MQTT</h3>
            <p className="muted small" style={{ margin: 0 }}>{mqtt.connected ? `Connected to ${mqtt.broker}` : 'For ESP32, Raspberry Pi and other small devices.'}</p>
          </div>
          {!mqtt.connected && <input className="input" style={{ width: 200 }} placeholder={mqtt.broker} value={broker} onChange={(e) => setBroker(e.target.value)} aria-label="Broker address" />}
          {mqtt.connected
            ? <button className="btn out" onClick={() => run('mqtt.disconnect')}>Disconnect</button>
            : <button className="btn" onClick={() => run('mqtt.connect', broker ? { broker } : {})}>Connect</button>}
        </div>
        {error && <div className="error">{error}</div>}
      </div>
    </Panel>
  )
}

