import { Meter, Panel } from '../components/Fields'
import { SIGNAL_DRAG } from '../components/SignalPicker'
import { useRico } from '../engine/store'
import { useTick } from '../engine/useTick'
import { getFrame, sceneOf, start, stop, useLab } from './lab'

// The small "Audio" panel: a quick look at every band you made in the audio
// lab, what kind of sound is playing, the beat, and the LFOs. Everything here
// can be dragged onto a setting.

const KIND_COLORS = ['#6c7a66', '#30e0ff', '#3bff03', '#ff8a3d']
const KIND_IDS = ['silence', 'speech', 'music', 'foley']

function drag(e: React.DragEvent, signal: string) {
  e.dataTransfer.setData(SIGNAL_DRAG, signal)
  e.dataTransfer.setData('text/plain', signal)
  e.dataTransfer.effectAllowed = 'link'
}

function openLab() {
  void Promise.all([import('../shell/workspaces'), import('../shell/Workspace')]).then(([w, ws]) => {
    const api = w.dockApi()
    if (api) ws.openPanel(api, 'audio-lab')
  })
}

export default function AudioOverview() {
  useTick(50)
  const lab = useLab()
  const engine = useRico((s) => s.live.audio)
  const lfos = useRico((s) => s.live.lfos)
  const f = getFrame()
  const x = f?.features
  const names = sceneOf(lab.settings).names
  const best = x?.kinds ? x.kinds.indexOf(Math.max(...x.kinds)) : -1

  return (
    <Panel
      title="Audio"
      sub="Every band from the audio lab, live. Drag one onto any setting to link it."
      live={lab.running}
      actions={<>
        <button className="btn small quiet" onClick={openLab}>Open the audio lab</button>
        {lab.running
          ? <button className="btn out small" onClick={() => stop()}>Stop</button>
          : <button className="btn small primary" onClick={() => void start()}>Listen</button>}
      </>}
    >
      {!lab.running && !engine && <div className="empty"><b>Not listening.</b> Press Listen. In the audio lab you pick the source (system audio, a mic, a file or a demo beat) and make your own bands.</div>}
      {lab.running && f && (
        <>
          <div className="ov-top">
            <div className="ov-stat"><span className="dim small">Tempo</span><b>{Math.round(x!.bpm)} BPM</b><span className={`lab-lamp${x!.beat > 0.5 ? ' on' : ''}`} draggable onDragStart={(e) => drag(e, 'audio:beat')} title="Beat (drag me)" /></div>
            <div className="ov-stat"><span className="dim small">Loudness</span><b>{x!.lufsM > -70 ? x!.lufsM.toFixed(1) : '-∞'} LUFS</b></div>
            <div className="ov-stat"><span className="dim small">Playing</span><b style={{ color: KIND_COLORS[best] }}>{best >= 0 ? names[best] : '-'}</b></div>
          </div>
          <div className="ov-bands">
            {lab.settings.bands.map((b, i) => (
              <div key={b.id} className={`ov-band${b.on ? '' : ' off'}`} draggable onDragStart={(e) => drag(e, `audio:${b.id}`)} title={`${b.name}: ${Math.round(b.lo)} to ${Math.round(b.hi)} Hz\naudio:${b.id}`}>
                <div className="ov-bar">
                  <i style={{ height: `${(f.bands[i] ?? 0) * 100}%`, background: b.color }} />
                  <em style={{ opacity: 0.1 + (f.hits[i] ?? 0) * 0.9, background: b.color }} />
                </div>
                <span>{b.name}</span>
              </div>
            ))}
          </div>
          <div className="ov-kinds">
            {names.map((n, i) => i > 0 && (
              <div key={i} className="ov-kind" draggable onDragStart={(e) => drag(e, `audio:${KIND_IDS[i]}`)} title={`audio:${KIND_IDS[i]}`}>
                <span style={{ color: KIND_COLORS[i] }}>{n}</span>
                <div className="meter"><i style={{ width: `${(x!.kindLevels?.[i] ?? 0) * 100}%`, background: KIND_COLORS[i] }} /></div>
              </div>
            ))}
          </div>
        </>
      )}
      {!lab.running && engine && (
        <div className="ov-bands">
          {([['level', 'Level', engine.level], ['low', 'Low', engine.low], ['mid', 'Mid', engine.mid], ['high', 'High', engine.high], ['kick', 'Kick', engine.kick], ['snare', 'Snare', engine.snare]] as const).map(([id, label, v]) => (
            <div key={id} className="ov-band" draggable onDragStart={(e) => drag(e, `audio:${id}`)}>
              <div className="ov-bar"><i style={{ height: `${Math.min(1, Number(v)) * 100}%` }} /></div>
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
              <li key={i} draggable onDragStart={(e) => drag(e, `lfo:${i}`)}>
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
