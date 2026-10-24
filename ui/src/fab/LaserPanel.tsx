import { useEffect, useMemo, useState } from 'react'
import Icon from '../components/Icon'
import RIcon from '../components/RIcons'
import Scrub from '../components/Scrub'
import { toast } from '../components/Toasts'
import { ToolBtn } from '../components/ToolStrip'
import { goboPlan, useGobos } from '../mapping/gobos'
import { useMapVersion } from '../mapping/model'
import { downloadBlob, pickFile } from '../shell/ui'
import { clearWanted, useWanted } from './nav'
import { serialPorts, type Stream } from './net'
import { frameGcode, goboLoops, LASER_LINKS, LASER_MATERIALS, laserGcode, sendToLaser, setLaser, svgLoops, useLaser, type Loop } from './laser'

// The Laser tab: cut your gobo plates (or any SVG) on a laser. Inside shapes
// are cut first. Frame shows where it will cut before you start.

interface Job { id: string; name: string; loops: Loop[]; size: [number, number]; on: boolean; note?: string }

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="ps-row" title={hint}><span>{label}</span><div>{children}</div></label>
}

const files: Job[] = []
let picks: Record<string, boolean> = {}

function useGoboJobs(): Job[] {
  const gobos = useGobos()
  // re-read when any mapping changes
  useMapVersion()
  return gobos.map((g) => {
    const p = goboPlan(g)
    const [x0, y0, x1, y1] = p.plate
    return {
      id: g.id, name: g.name, loops: p.openings.length ? goboLoops(p, g.opts.corner, g.opts.holeDia) : [], size: [x1 - x0, y1 - y0] as [number, number],
      on: picks[g.id] ?? true, note: g.opts.style !== 'flat' ? 'Only the plate is cut; the legs or ring are for printing.' : undefined,
    }
  })
}

export default function LaserPanel() {
  const s = useLaser()
  const goboJobs = useGoboJobs()
  const [, bump] = useState(0)
  const wanted = useWanted('laser')
  const [ports, setPorts] = useState<string[]>([])
  const [setup, setSetup] = useState(false)
  const [stream, setStream] = useState<Stream | null>(null)
  const [state, setState] = useState('')
  useEffect(() => { if (wanted) { picks = Object.fromEntries(goboJobs.map((j) => [j.id, j.id === wanted])); clearWanted(); bump((n) => n + 1) } }, [wanted])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (s.link === 'usb') void serialPorts().then(setPorts) }, [s.link])

  const jobs = [...goboJobs, ...files].filter((j) => j.loops.length)
  const on = jobs.filter((j) => (j.id.startsWith('svg') ? j.on : picks[j.id] ?? true))
  // in a row from the start point, a gap between each
  const placed = useMemo(() => {
    let x = s.at[0], y = s.at[1], rowH = 0
    return on.map((j) => {
      if (x + j.size[0] > s.area[0] && x > s.at[0]) { x = s.at[0]; y += rowH + 4; rowH = 0 }
      const at: [number, number] = [x, y]
      x += j.size[0] + 4
      rowH = Math.max(rowH, j.size[1])
      return { ...j, at, fits: at[0] + j.size[0] <= s.area[0] && at[1] + j.size[1] <= s.area[1] }
    })
  }, [on, s.at, s.area])
  const g = useMemo(() => laserGcode(placed, s), [placed, s])
  const name = placed.length === 1 ? placed[0].name : `RICO laser ${placed.length} parts`

  const start = async (text: string, label: string) => {
    if (s.link === 'file') { downloadBlob(`${name}.gcode`, new Blob([text], { type: 'text/plain' })); return }
    setState(`${label}...`)
    const r = await sendToLaser(s, name, text, {
      progress: (f) => setState(`${label}: ${(f * 100).toFixed(0)}%`),
      log: () => {},
      error: (e) => { toast(e); setState('') },
    })
    if (r.error) { toast(r.error); setState('') }
    if (r.stream) { setStream(r.stream); void r.stream.done.then(() => { setStream(null); setState((t) => (t ? `${label}: done` : t)) }) }
    else if (!r.error && s.link === 'wifi') setState(`${label}: sent, the laser is starting`)
  }
  const min = Math.round(g.seconds / 60)

  return (
    <div className="dpanel pr">
      <div className="tool-strip" role="toolbar" aria-label="Laser tools">
        <ToolBtn t={{ id: 'setup', icon: 'laser', label: 'Laser and connection', on: setup, run: () => setSetup(!setup) }} />
        <ToolBtn t={{ id: 'open', icon: 'import', label: 'Open an SVG file', run: () => pickFile('.svg,image/svg+xml', (f) => void f.text().then((t) => {
          const r = svgLoops(t)
          if (typeof r === 'string') return toast(r)
          files.push({ id: `svg${Date.now()}`, name: f.name.replace(/\.svg$/i, ''), loops: r.loops, size: r.size, on: true })
          bump((n) => n + 1)
        })) }} />
        <span className="grow" />
        <span className="ts-label">{s.area[0]} x {s.area[1]} mm</span>
      </div>
      <div className="pr-cols">
        <div className="pr-side">
          {setup && (
            <fieldset className="ps-group"><legend>Laser</legend>
              <select className="select" value={s.link} onChange={(e) => setLaser({ link: e.target.value as typeof s.link })}>
                {LASER_LINKS.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
              <p className="dim small">{LASER_LINKS.find((l) => l.id === s.link)?.about}</p>
              {s.link === 'usb' && <>
                <Field label="Port"><select className="select" value={s.port} onChange={(e) => setLaser({ port: e.target.value })}>{[...new Set([s.port, ...ports])].map((p) => <option key={p} value={p}>{p}</option>)}</select></Field>
                <Field label="Speed"><select className="select" value={s.baud} onChange={(e) => setLaser({ baud: Number(e.target.value) })}>{[115200, 250000, 57600].map((b) => <option key={b} value={b}>{b}</option>)}</select></Field>
                <button className="btn small quiet" onClick={() => void serialPorts().then(setPorts)}>Look for ports</button>
              </>}
              {s.link === 'wifi' && <Field label="Address"><input className="input" value={s.host} placeholder="fluidnc.local" onChange={(e) => setLaser({ host: e.target.value })} spellCheck={false} /></Field>}
              <div className="vec">
                <label className="gen-num"><span>Width</span><Scrub value={s.area[0]} step={1} digits={0} min={50} max={2000} suffix=" mm" onChange={(v) => setLaser({ area: [v, s.area[1]] })} /></label>
                <label className="gen-num"><span>Depth</span><Scrub value={s.area[1]} step={1} digits={0} min={50} max={2000} suffix=" mm" onChange={(v) => setLaser({ area: [s.area[0], v] })} /></label>
              </div>
              <Field label="Full power value" hint="The laser's $30 setting, often 1000 (some use 255)"><Scrub value={s.maxS} step={1} digits={0} min={1} max={100000} onChange={(v) => setLaser({ maxS: v })} /></Field>
              <label className="mini-check"><input type="checkbox" checked={s.air} onChange={(e) => setLaser({ air: e.target.checked })} />Air assist (M8)</label>
            </fieldset>
          )}
          <fieldset className="ps-group"><legend>What to cut</legend>
            {!jobs.length && <p className="dim small">No gobos yet. Make one in Projection mapping, or open an SVG file.</p>}
            <ul className="pr-parts">
              {jobs.map((j) => {
                const isOn = j.id.startsWith('svg') ? j.on : picks[j.id] ?? true
                return (
                  <li key={j.id} className={isOn ? '' : 'off'}>
                    <input type="checkbox" checked={isOn} onChange={(e) => { if (j.id.startsWith('svg')) j.on = e.target.checked; else picks = { ...picks, [j.id]: e.target.checked }; bump((n) => n + 1) }} />
                    <span className="grow">{j.name}<span className="dim small"> {j.size[0].toFixed(0)} x {j.size[1].toFixed(0)} mm</span>{j.note && <span className="dim small"><br />{j.note}</span>}</span>
                    {j.id.startsWith('svg') && <button className="icon-btn small danger" title="Take it off" onClick={() => { files.splice(files.indexOf(j), 1); bump((n) => n + 1) }}><Icon name="x" /></button>}
                  </li>
                )
              })}
            </ul>
          </fieldset>
          <fieldset className="ps-group"><legend>Material</legend>
            <div className="gb-mounts">
              {LASER_MATERIALS.map((m) => (
                <button key={m.id} className={`ps-style${s.material === m.id ? ' on' : ''}`} onClick={() => setLaser({ material: m.id, power: m.power, speed: m.speed, passes: m.passes })}><b>{m.name}</b><span>{m.about}</span></button>
              ))}
            </div>
            <p className="dim small">These are a start: every laser is different. Cut a small test first.</p>
            <Field label="Power"><Scrub value={s.power * 100} step={0.5} digits={0} min={0} max={100} suffix="%" onChange={(v) => setLaser({ power: v / 100 })} /></Field>
            <Field label="Speed"><Scrub value={s.speed} step={5} digits={0} min={10} max={20000} suffix=" mm/min" onChange={(v) => setLaser({ speed: v })} /></Field>
            <Field label="Passes"><Scrub value={s.passes} step={0.05} digits={0} min={1} max={20} onChange={(v) => setLaser({ passes: Math.round(v) })} /></Field>
          </fieldset>
          <fieldset className="ps-group"><legend>Where</legend>
            <div className="seg">
              <button className={s.origin === 'corner' ? 'on' : ''} onClick={() => setLaser({ origin: 'corner' })}>From the laser's 0,0</button>
              <button className={s.origin === 'here' ? 'on' : ''} onClick={() => setLaser({ origin: 'here' })}>From where the head is</button>
            </div>
            <div className="vec">
              <label className="gen-num"><span>X</span><Scrub value={s.at[0]} step={0.5} digits={1} min={0} max={2000} suffix=" mm" onChange={(v) => setLaser({ at: [v, s.at[1]] })} /></label>
              <label className="gen-num"><span>Y</span><Scrub value={s.at[1]} step={0.5} digits={1} min={0} max={2000} suffix=" mm" onChange={(v) => setLaser({ at: [s.at[0], v] })} /></label>
            </div>
          </fieldset>
        </div>
        <div className="pr-stage">
          <svg className="lz-view" viewBox={`-4 ${-s.area[1] - 4} ${s.area[0] + 8} ${s.area[1] + 8}`} role="img" aria-label="Where the laser cuts">
            <rect x={0} y={-s.area[1]} width={s.area[0]} height={s.area[1]} className="lz-area" />
            {Array.from({ length: Math.floor(s.area[0] / 50) + 1 }, (_, i) => <line key={`x${i}`} x1={i * 50} y1={0} x2={i * 50} y2={-s.area[1]} className="lz-grid" />)}
            {Array.from({ length: Math.floor(s.area[1] / 50) + 1 }, (_, i) => <line key={`y${i}`} x1={0} y1={-i * 50} x2={s.area[0]} y2={-i * 50} className="lz-grid" />)}
            {placed.map((j) => (
              <g key={j.id} className={j.fits ? 'lz-job' : 'lz-job bad'}>
                {j.loops.map((l, i) => <polygon key={i} points={l.reduce((acc, v, k) => acc + (k % 2 ? `${-(v + j.at[1])} ` : `${v + j.at[0]},`), '')} />)}
                <title>{j.name}</title>
              </g>
            ))}
            <circle cx={0} cy={0} r={3} className="lz-zero" />
          </svg>
          <dl className="ps-stats pr-stats">
            <div><dt>Time</dt><dd>{min < 1 ? 'under a minute' : `about ${min} min`}</dd></div>
            <div><dt>Cut length</dt><dd>{(g.length / 1000).toFixed(2)} m</dd></div>
            <div><dt>Shapes</dt><dd>{placed.reduce((n, j) => n + j.loops.length, 0)}</dd></div>
          </dl>
          {placed.some((j) => !j.fits) && <p className="warn-text small">Something does not fit in the laser's area.</p>}
          <div className="row wrap">
            {s.link !== 'file' && <>
              <button className="btn" disabled={!placed.length || !!stream} title="Moves around the outline with the laser off" onClick={() => void start(frameGcode(placed, s, false), 'Framing')}>Frame</button>
              <button className="btn primary" disabled={!placed.length || !!stream} onClick={() => void start(g.text, 'Cutting')}><RIcon name="laser" size={16} /> Start cutting</button>
            </>}
            <button className="btn quiet" disabled={!placed.length} onClick={() => downloadBlob(`${name}.gcode`, new Blob([g.text], { type: 'text/plain' }))}>Save G-code</button>
            {stream && <>
              <button className="btn small" onClick={() => stream.pause(true)}>Hold</button>
              <button className="btn small" onClick={() => stream.pause(false)}>Go on</button>
              <button className="btn small danger" onClick={() => { stream.stop(); setStream(null); setState('Stopped. The laser is off.') }}>Stop now</button>
            </>}
          </div>
          {state && <p className="small lime">{state}</p>}
          <p className="dim small">Wear the right glasses for your laser, and never leave it cutting alone.</p>
        </div>
      </div>
    </div>
  )
}
