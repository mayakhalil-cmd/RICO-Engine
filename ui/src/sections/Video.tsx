import { useState } from 'react'
import { goTo } from '../shell/workspaces'
import { Panel, Select, Switch, TextField } from '../components/Fields'
import { toast } from '../components/Toasts'
import { rico } from '../engine/connection'
import { useCommand, useRico } from '../engine/store'

const SOURCES = [
  { value: 3, label: 'Motion canvas' },
  { value: 4, label: 'The Spout sender RICO is receiving' },
  { value: 1, label: 'A whole screen' },
  { value: 2, label: 'What RICO is receiving over the network' },
]

export function Transports() {
  const video = useRico((s) => s.state?.video)
  const { run } = useCommand()
  if (!video) return null
  return (
    <Panel title="How video travels" sub="Pick the network video format the other app understands. OMT is open source and always here.">
      <div className="transports">
        {video.transports.map((t, i) => (
          <div key={t.id} className={`transport${video.transport === i ? ' on' : ''}${t.available ? '' : ' off'}`}>
            <button
              className="transport-pick"
              disabled={!t.available}
              aria-pressed={video.transport === i}
              onClick={async () => {
                const ack = await run('video.transport', { index: i })
                if (!ack.ok) toast(ack.error ?? 'Could not switch.')
              }}
            >
              <span className="transport-name">{t.name}</span>
              <span className="dim small">{t.builtIn ? 'Built in' : 'Plugin'}</span>
            </button>
            <p className="small" style={{ margin: '8px 0 0' }}>{t.about}</p>
            {!t.available && (
              <>
                <p className="warn small" style={{ margin: '6px 0' }}>{t.status}</p>
                {t.homepage && <button className="btn small" onClick={() => rico.send('app.openUrl', { url: t.homepage })}>Get it</button>}
              </>
            )}
          </div>
        ))}
      </div>
      {video.pluginProblems.map((p) => <div key={p.file} className="note">{p.file} was skipped. {p.reason}</div>)}
      <div className="stack" style={{ marginTop: 12, gap: 8, justifyItems: 'start' }}>
        <span className="dim small">Plugins live in <code>{video.pluginFolder}</code></span>
        <button className="btn quiet small" onClick={() => run('video.rescanPlugins')}>Look for plugins again</button>
      </div>
    </Panel>
  )
}

export function Send() {
  const video = useRico((s) => s.state?.video)
  const { run, error } = useCommand()
  if (!video) return null
  const transport = video.transports[video.transport]
  return (
    <Panel title="Send" sub={`Other computers on your network see this as a ${transport?.name ?? ''} source.`} live={video.sending}>
      <div className="stack">
        <TextField label="Name other apps see" value={video.name} onCommit={(name) => run('video.name', { name })} />
        <Select label="What to send" value={video.source} options={SOURCES} onChange={(v) => run('video.source', { source: Number(v), monitor: video.monitor })} />
        {video.source === 1 && (
          <Select
            label="Screen"
            value={video.monitor}
            options={[0, 1, 2, 3].map((m) => ({ value: m, label: `Screen ${m + 1}` }))}
            onChange={(v) => run('video.source', { source: 1, monitor: Number(v) })}
          />
        )}
        {video.source === 3 && <p className="muted small" style={{ margin: 0 }}>Turn on "Send to video" in Motion to fill this with your visuals.</p>}
        {video.source === 4 && !video.spout.receiving && <p className="warn small" style={{ margin: 0 }}>Pick a Spout sender under "On this computer" first.</p>}
        <div className="row">
          {video.sending
            ? <button className="btn out" onClick={() => run('video.stop')}>Stop sending</button>
            : <button className="btn primary" onClick={() => run('video.start')}>Start sending</button>}
          {video.sending && video.width > 0 && <span className="muted small">{video.width} x {video.height}</span>}
        </div>
        {(error || video.error) && <div className="error">{error || video.error}</div>}
      </div>
    </Panel>
  )
}

export function Receive() {
  const video = useRico((s) => s.state?.video)
  const { run, busy, error } = useCommand()
  const [manual, setManual] = useState('')
  if (!video) return null
  return (
    <Panel
      title="Receive"
      sub="Bring video from another computer into this one."
      live={video.receiving}
      actions={<button className="btn small" disabled={busy === 'video.scan'} onClick={() => run('video.scan')}>{busy === 'video.scan' ? 'Looking' : 'Find sources'}</button>}
    >
      <div className="stack">
        {video.sources.length === 0 ? (
          <div className="empty">Press Find sources. Anything sending on your network shows up here.</div>
        ) : (
          <ul className="list">
            {video.sources.map((s) => {
              const on = video.receiving && video.receivingFrom === s
              return (
                <li key={s} className={on ? 'on' : ''}>
                  <span className="name">{s}</span>
                  {on
                    ? <button className="btn out small" onClick={() => run('video.disconnect')}>Disconnect</button>
                    : <button className="btn small" onClick={() => run('video.connect', { name: s })}>Connect</button>}
                </li>
              )
            })}
          </ul>
        )}
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (manual.trim()) run('video.connect', { name: manual.trim() }) }}>
          <input className="input grow" placeholder="Or type a source name or address" value={manual} onChange={(e) => setManual(e.target.value)} aria-label="Source name" />
          <button className="btn quiet">Connect</button>
        </form>
        {video.receiving && (
          <p className="small" style={{ margin: 0 }}>
            {video.receivedWidth > 0 ? <span className="ok">Receiving {video.receivingFrom}, {video.receivedWidth} x {video.receivedHeight}</span> : <span className="warn">Connected, waiting for the first frame.</span>}
          </p>
        )}
        <Switch checked={video.bridgeToSpout} onChange={(on) => run('video.bridge', { on, name: video.bridgeName })}>
          Share it on this computer as Spout
        </Switch>
        {video.bridgeToSpout && <TextField label="Spout name" value={video.bridgeName} onCommit={(name) => run('video.bridge', { on: true, name })} />}
        <p className="muted small" style={{ margin: 0 }}>
          TouchDesigner, Resolume and OBS read Spout. This is how OMT video from another computer gets into them.
        </p>
        {error && <div className="error">{error}</div>}
      </div>
    </Panel>
  )
}

export function Local() {
  const spout = useRico((s) => s.state?.video.spout)
  const { run } = useCommand()
  const [name, setName] = useState('RICO')
  if (!spout) return null
  return (
    <Panel title="On this computer" sub="Spout shares video between apps on the same computer with no delay." live={spout.sending || spout.receiving}>
      <div className="stack">
        <h3>Take video from an app</h3>
        <div className="row">
          <div className="grow">
            <Select
              value={spout.receiving ? spout.receivingFrom : -1}
              placeholder="Nothing"
              options={spout.senders.map((s) => ({ value: s, label: s }))}
              onChange={(v) => (v === '-1' ? run('spout.disconnect') : run('spout.connect', { name: v }))}
            />
          </div>
          <button className="btn quiet small" onClick={() => run('spout.scan')}>Look again</button>
        </div>
        <p className="muted small" style={{ margin: 0 }}>Blender, Unreal and TouchDesigner can all send Spout. Once picked, you can send it to other computers with "What to send" above.</p>

        <h3 style={{ marginTop: 6 }}>Give Motion visuals to other apps</h3>
        <div className="row">
          <input className="input grow" value={spout.sending ? spout.name : name} disabled={spout.sending} onChange={(e) => setName(e.target.value)} aria-label="Spout name" />
          {spout.sending
            ? <button className="btn out" onClick={() => run('spout.stop')}>Stop Spout</button>
            : <button className="btn" onClick={() => run('spout.start', { name })}>Start Spout</button>}
        </div>
        <button className="btn quiet small" style={{ justifySelf: 'start' }} onClick={() => goTo('create')}>Open Motion</button>
      </div>
    </Panel>
  )
}

