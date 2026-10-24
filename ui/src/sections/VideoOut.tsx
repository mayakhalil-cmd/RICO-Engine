import { useSyncExternalStore } from 'react'
import { Switch } from '../components/Fields'
import { toast } from '../components/Toasts'
import { getOutputOptions, setOutput, setOutputOptions, useCreate } from '../create/store'
import { SIZES } from '../create/scene'
import { changeScene } from '../create/store'
import { rico } from '../engine/connection'
import { onSharedChange, pictureNames, sharedVersion } from '../engine/shared'
import { useRico } from '../engine/store'

// Everything about what RICO sends as video, in one place: which picture,
// how big, how often, and where to (Spout on this computer, network video).

async function send(op: string, args: Record<string, unknown> = {}) {
  const a = await rico.send(op, args)
  if (!a.ok) toast(a.error ?? 'That did not work.')
  return a.ok
}

export default function VideoOut() {
  useSyncExternalStore(onSharedChange, sharedVersion)
  const output = useCreate((s) => s.output)
  const scene = useCreate((s) => s.scene)
  useCreate((s) => s.fps)
  const opts = getOutputOptions()
  const video = useRico((s) => s.state?.video)
  const sources = ['Create', '3D', ...pictureNames().filter((n) => n !== 'Create')]
  return (
    <div className="dpanel vout">
      <h3>Video out</h3>
      <Switch checked={output} onChange={setOutput}>Send video</Switch>
      <div className="insp-grid">
        <label className="param"><span className="param-label">What to send</span>
          <select className="select" value={opts.source} onChange={(e) => setOutputOptions({ source: e.target.value })}>
            {sources.map((s) => <option key={s} value={s}>{s === 'Create' ? 'Motion (the finished picture)' : s === '3D' ? '3D scene camera' : `Picture: ${s}`}</option>)}
          </select></label>
        <label className="param"><span className="param-label">Frames a second</span>
          <select className="select" value={opts.fps} onChange={(e) => setOutputOptions({ fps: Number(e.target.value) })}>
            {[10, 15, 24, 25, 30, 50, 60].map((f) => <option key={f} value={f}>{f}</option>)}
          </select></label>
        {opts.source === 'Create'
          ? <label className="param"><span className="param-label">Size (the Motion scene size)</span>
              <select className="select" value={`${scene.width}x${scene.height}`} onChange={(e) => { const [w, h] = e.target.value.split('x').map(Number); changeScene('Change size', (s) => ({ ...s, width: w, height: h })) }}>
                {SIZES.map((s) => <option key={s.label} value={`${s.w}x${s.h}`}>{s.label}</option>)}
              </select></label>
          : <label className="param"><span className="param-label">Size</span>
              <select className="select" value={opts.scale} onChange={(e) => setOutputOptions({ scale: Number(e.target.value) })}>
                {[1, 0.75, 0.5, 0.25].map((s) => <option key={s} value={s}>{s * 100}%</option>)}
              </select></label>}
      </div>
      <section className="vout-sec">
        <h4>Spout (apps on this computer)</h4>
        <div className="row wrap">
          <input className="input" style={{ width: 180 }} defaultValue={video?.spout.name || 'RICO'} id="vout-spout" aria-label="Spout sender name" />
          {video?.spout.sending
            ? <button className="btn small out" onClick={() => send('spout.stop')}>Stop Spout</button>
            : <button className="btn small primary" onClick={async () => { if (await send('spout.start', { name: (document.getElementById('vout-spout') as HTMLInputElement)?.value || 'RICO' })) setOutput(true) }}>Start Spout</button>}
          <span className="dim small">{video?.spout.sending ? `Sending as "${video.spout.name}"` : 'Off'}</span>
        </div>
        <p className="dim small">TouchDesigner (Spout In TOP), Resolume, OBS (Spout2 plugin), MadMapper, Unreal and Unity can take it by this name.</p>
      </section>
      <section className="vout-sec">
        <h4>Network video (other computers)</h4>
        <div className="row wrap">
          <select className="select" value={video?.transport ?? 0} onChange={(e) => send('video.transport', { index: Number(e.target.value) })}>
            {(video?.transports ?? []).map((t, i) => <option key={t.name} value={i} disabled={!t.available}>{t.name}{t.available ? '' : ' (not installed)'}</option>)}
          </select>
          <input className="input" style={{ width: 160 }} defaultValue={video?.name || 'RICO'} onBlur={(e) => send('video.name', { name: e.target.value || 'RICO' })} aria-label="Stream name" />
          {video?.sending
            ? <button className="btn small out" onClick={() => send('video.stop')}>Stop</button>
            : <button className="btn small primary" onClick={async () => { await send('video.source', { source: 3, monitor: 0 }); if (await send('video.start')) setOutput(true) }}>Start sending</button>}
          <span className="dim small">{video?.sending ? `${video.width} x ${video.height}` : 'Off'}{video?.error ? `: ${video.error}` : ''}</span>
        </div>
      </section>
    </div>
  )
}
