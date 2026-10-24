import { useEffect, useRef, useState } from 'react'
import Scrub from '../components/Scrub'
import SignalPicker from '../components/SignalPicker'
import { toast } from '../components/Toasts'
import { rico } from '../engine/connection'
import {
  CH_LABEL, PROFILES, changeDesk, clashes, clearProgrammer, computeLooks, footprint, getDesk, goCue, goNext, latestFrames, newEffect, newGroup, newLink, newProfile,
  nextAddress, patch, profileOf, recordCue, setLook, setTarget, startDesk, useDesk, type ChType, type Effect, type Fixture, type Link, type Look, type Profile,
} from '../engine/desk'
import { readSignal } from '../engine/signals'
import { useTick } from '../engine/useTick'
import { addObject, changeWorld, isLight, newObject, select3d, updateObject, useWorld, type Vec3 } from '../three/world'
import { goTo } from '../shell/workspaces'

// A lighting desk inside RICO: fixtures instead of raw channel numbers.

type Tab = 'control' | 'patch' | 'space' | 'effects' | 'cues' | 'links' | 'output'

function Visual({ sel, onPick }: { sel: string[]; onPick: (id: string, add: boolean) => void }) {
  useTick(60)
  const d = useDesk()
  const looks = computeLooks(performance.now() / 1000)
  const master = d.blackout ? 0 : d.master
  return (
    <div className="desk-vis">
      {d.fixtures.map((f) => {
        const L = looks[f.id] ?? {}
        const dim = (L.dim ?? 0) * master
        const strobe = (L.strobe ?? 0) > 0.05 && Math.floor(performance.now() / (60 + (1 - (L.strobe ?? 0)) * 200)) % 2 === 0
        return (
          <button key={f.id} className={`desk-fx${sel.includes(f.id) ? ' on' : ''}`} onClick={(e) => onPick(f.id, e.shiftKey || e.ctrlKey || e.metaKey)} title={`${f.name}: universe ${f.universe}, address ${f.address}`}>
            <i style={{ background: L.color ?? '#fff', opacity: strobe ? 0 : Math.max(0.06, dim) }} />
            <span>{f.name}</span>
          </button>
        )
      })}
      {!d.fixtures.length && <p className="dim small">No fixtures yet. Patch some in the Patch tab.</p>}
    </div>
  )
}

function XY({ x, y, onChange }: { x: number; y: number; onChange: (x: number, y: number) => void }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const set = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    onChange(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height)))
  }
  return (
    <div ref={ref} className="desk-xy" onPointerDown={(e) => { (e.target as Element).setPointerCapture(e.pointerId); set(e) }} onPointerMove={(e) => { if (e.buttons) set(e) }}>
      <i style={{ left: `${x * 100}%`, top: `${(1 - y) * 100}%` }} />
      <span className="dim small">Pan {Math.round(x * 100)}% Tilt {Math.round(y * 100)}%</span>
    </div>
  )
}

const SWATCHES = ['#ffffff', '#ff0000', '#ff8a00', '#ffd23f', '#3bff03', '#00ffd0', '#30e0ff', '#0040ff', '#7a3dff', '#f820a0', '#ffb3e6', '#ffe8c0']

function Control({ sel, setSel }: { sel: string[]; setSel: (s: string[]) => void }) {
  const d = useDesk()
  const first = sel.length ? computeLooks(performance.now() / 1000)[sel[0]] ?? {} : {}
  const set = (part: Look) => { if (!sel.length) return toast('Select fixtures first (click them above, Shift adds).'); setLook(sel, part) }
  const can = (t: ChType) => sel.some((id) => { const f = d.fixtures.find((x) => x.id === id); return f && profileOf(f.profile).channels.some((c) => c.type === t) })
  return (
    <div className="desk-control">
      <div className="row wrap gap">
        <span className="param-label">Select</span>
        <button className="btn small quiet" onClick={() => setSel(d.fixtures.map((f) => f.id))}>All</button>
        <button className="btn small quiet" onClick={() => setSel([])}>None</button>
        {d.groups.map((g) => <button key={g.id} className="btn small quiet" onClick={() => setSel(g.fixtures)}>{g.name}</button>)}
        {sel.length > 1 && <button className="btn small quiet" onClick={() => { const name = `Group ${d.groups.length + 1}`; changeDesk((x) => ({ ...x, groups: [...x.groups, newGroup(name, sel)] })); toast(`${name} made.`, true) }}>Make a group</button>}
        <span className="grow" />
        <button className="btn small out" onClick={clearProgrammer} title="Forget what you set by hand (cues and effects stay)">Clear</button>
      </div>
      <div className="desk-ctl-grid">
        <fieldset><legend>Intensity</legend>
          <input className="range desk-fader" type="range" min={0} max={1} step={0.001} value={first.dim ?? 0} onChange={(e) => set({ dim: Number(e.target.value) })} />
          <div className="row gap">{[0, 0.25, 0.5, 0.75, 1].map((v) => <button key={v} className="btn small quiet" onClick={() => set({ dim: v })}>{v * 100}%</button>)}</div>
          {can('strobe') && <label className="mini">Strobe <input className="range" type="range" min={0} max={1} step={0.01} value={first.strobe ?? 0} onChange={(e) => set({ strobe: Number(e.target.value) })} /></label>}
        </fieldset>
        <fieldset><legend>Color</legend>
          <input type="color" className="swatch" value={first.color ?? '#ffffff'} onChange={(e) => set({ color: e.target.value })} />
          <div className="desk-swatches">{SWATCHES.map((c) => <button key={c} style={{ background: c }} title={c} onClick={() => set({ color: c })} />)}</div>
          {can('w') && <label className="mini">White <input className="range" type="range" min={0} max={1} step={0.01} value={first.white ?? 0} onChange={(e) => set({ white: Number(e.target.value) })} /></label>}
          {can('uv') && <label className="mini">UV <input className="range" type="range" min={0} max={1} step={0.01} value={first.uv ?? 0} onChange={(e) => set({ uv: Number(e.target.value) })} /></label>}
          {can('colorWheel') && <label className="mini">Color wheel <input className="range" type="range" min={0} max={1} step={0.004} value={first.colorWheel ?? 0} onChange={(e) => set({ colorWheel: Number(e.target.value) })} /></label>}
        </fieldset>
        {(can('pan') || can('tilt')) && (
          <fieldset><legend>Position</legend>
            <XY x={first.pan ?? 0.5} y={first.tilt ?? 0.5} onChange={(pan, tilt) => set({ pan, tilt })} />
            {can('speed') && <label className="mini">Move speed <input className="range" type="range" min={0} max={1} step={0.01} value={first.speed ?? 0} onChange={(e) => set({ speed: Number(e.target.value) })} /></label>}
          </fieldset>
        )}
        {(can('zoom') || can('gobo') || can('fog') || can('raw')) && (
          <fieldset><legend>Beam and more</legend>
            {can('zoom') && <label className="mini">Zoom <input className="range" type="range" min={0} max={1} step={0.004} value={first.zoom ?? 0.5} onChange={(e) => set({ zoom: Number(e.target.value) })} /></label>}
            {can('gobo') && <label className="mini">Gobo <input className="range" type="range" min={0} max={1} step={0.004} value={first.gobo ?? 0} onChange={(e) => set({ gobo: Number(e.target.value) })} /></label>}
            {can('fog') && <label className="mini">Fog <input className="range" type="range" min={0} max={1} step={0.01} value={first.fog ?? 0} onChange={(e) => set({ fog: Number(e.target.value) })} /></label>}
            {can('raw') && sel.length > 0 && (() => {
              const f = d.fixtures.find((x) => x.id === sel[0])!
              return profileOf(f.profile).channels.filter((c) => c.type === 'raw').map((c, i) => (
                <label key={i} className="mini">{c.name ?? `Other ${i + 1}`} <input className="range" type="range" min={0} max={1} step={1 / 255} value={first.raw?.[i] ?? 0} onChange={(e) => set({ raw: { ...(first.raw ?? {}), [i]: Number(e.target.value) } })} /></label>
              ))
            })()}
          </fieldset>
        )}
      </div>
    </div>
  )
}

function Patch({ sel }: { sel: string[] }) {
  const d = useDesk()
  const [profile, setProfile] = useState('par8')
  const [count, setCount] = useState(4)
  const [universe, setUniverse] = useState(0)
  const [address, setAddress] = useState<number | ''>('')
  const [name, setName] = useState('Par')
  const [editProfile, setEditProfile] = useState<string | null>(null)
  const bad = new Set(clashes())
  const all = [...PROFILES, ...d.profiles]
  const upFix = (id: string, part: Partial<Fixture>) => changeDesk((x) => ({ ...x, fixtures: x.fixtures.map((f) => (f.id === id ? { ...f, ...part } : f)) }))
  const ep = d.profiles.find((p) => p.id === editProfile)
  const upProfile = (part: Partial<Profile>) => changeDesk((x) => ({ ...x, profiles: x.profiles.map((p) => (p.id === editProfile ? { ...p, ...part } : p)) }))
  return (
    <div className="desk-patch">
      <div className="row wrap gap">
        <select className="select" value={profile} onChange={(e) => setProfile(e.target.value)}>{all.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <label className="mini">How many <input className="input num" type="number" min={1} max={256} value={count} onChange={(e) => setCount(Math.max(1, Number(e.target.value)))} style={{ width: 56 }} /></label>
        <label className="mini">Universe <input className="input num" type="number" min={0} max={32767} value={universe} onChange={(e) => setUniverse(Math.max(0, Number(e.target.value)))} style={{ width: 64 }} /></label>
        <label className="mini">From address <input className="input num" type="number" min={1} max={512} placeholder={String(nextAddress(universe))} value={address} onChange={(e) => setAddress(e.target.value ? Number(e.target.value) : '')} style={{ width: 64 }} /></label>
        <label className="mini">Name <input className="input" value={name} onChange={(e) => setName(e.target.value)} style={{ width: 100 }} /></label>
        <button className="btn small primary" onClick={() => { const m = patch(profile, count, universe, address || nextAddress(universe), name); toast(`${m.length} patched, ${footprint(m[0])} channels each.`, true); setAddress('') }}>Patch</button>
        <button className="btn small quiet" onClick={() => { const p = newProfile(); changeDesk((x) => ({ ...x, profiles: [...x.profiles, p] })); setEditProfile(p.id); setProfile(p.id) }}>+ My own fixture type</button>
      </div>
      {ep && (
        <fieldset className="desk-profile"><legend>Fixture type</legend>
          <input className="input" value={ep.name} onChange={(e) => upProfile({ name: e.target.value })} />
          <p className="dim small">One row per DMX channel, in the order of the fixture's manual.</p>
          {ep.channels.map((c, i) => (
            <div key={i} className="row gap">
              <span className="dim small" style={{ width: 28 }}>{i + 1}</span>
              <select className="select mini" value={c.type} onChange={(e) => upProfile({ channels: ep.channels.map((x, j) => (j === i ? { ...x, type: e.target.value as ChType } : x)) })}>
                {Object.entries(CH_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              {c.type === 'raw' && <input className="input" placeholder="Name" value={c.name ?? ''} onChange={(e) => upProfile({ channels: ep.channels.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} style={{ width: 120 }} />}
              <button className="icon-btn small danger" onClick={() => upProfile({ channels: ep.channels.filter((_, j) => j !== i) })}>{'×'}</button>
            </div>
          ))}
          <div className="row gap"><button className="btn small quiet" onClick={() => upProfile({ channels: [...ep.channels, { type: 'raw' }] })}>+ Channel</button><button className="btn small" onClick={() => setEditProfile(null)}>Done</button></div>
        </fieldset>
      )}
      <table className="desk-table">
        <thead><tr><th>Name</th><th>Type</th><th>Universe</th><th>Address</th><th>Ch</th><th>Flip pan/tilt</th><th /></tr></thead>
        <tbody>
          {d.fixtures.map((f) => (
            <tr key={f.id} className={`${sel.includes(f.id) ? 'on' : ''}${bad.has(f.id) ? ' bad' : ''}`} title={bad.has(f.id) ? 'Uses the same channels as another fixture' : ''}>
              <td><input className="input" value={f.name} onChange={(e) => upFix(f.id, { name: e.target.value })} /></td>
              <td className="dim small">{profileOf(f.profile).name}{profileOf(f.profile).custom && <button className="icon-btn small" onClick={() => setEditProfile(f.profile)} title="Edit this type">{'✎'}</button>}</td>
              <td><input className="input num" type="number" min={0} value={f.universe} onChange={(e) => upFix(f.id, { universe: Math.max(0, Number(e.target.value)) })} style={{ width: 60 }} /></td>
              <td><input className="input num" type="number" min={1} max={512} value={f.address} onChange={(e) => upFix(f.id, { address: Math.max(1, Math.min(512, Number(e.target.value))) })} style={{ width: 60 }} /></td>
              <td className="dim small">{f.address}-{f.address + footprint(f) - 1}</td>
              <td><input type="checkbox" checked={Boolean(f.invertPan)} onChange={(e) => upFix(f.id, { invertPan: e.target.checked })} title="Flip pan" /> <input type="checkbox" checked={Boolean(f.invertTilt)} onChange={(e) => upFix(f.id, { invertTilt: e.target.checked })} title="Flip tilt" /></td>
              <td><button className="icon-btn small danger" onClick={() => changeDesk((x) => ({ ...x, fixtures: x.fixtures.filter((y) => y.id !== f.id), groups: x.groups.map((g) => ({ ...g, fixtures: g.fixtures.filter((y) => y !== f.id) })) }))}>{'×'}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {d.groups.length > 0 && (
        <div className="row wrap gap"><span className="param-label">Groups</span>
          {d.groups.map((g) => (
            <span key={g.id} className="desk-chip">
              <input className="input" value={g.name} onChange={(e) => changeDesk((x) => ({ ...x, groups: x.groups.map((y) => (y.id === g.id ? { ...y, name: e.target.value } : y)) }))} style={{ width: 100 }} />
              <span className="dim small">{g.fixtures.length}</span>
              <button className="icon-btn small danger" onClick={() => changeDesk((x) => ({ ...x, groups: x.groups.filter((y) => y.id !== g.id) }))}>{'×'}</button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function Effects({ sel }: { sel: string[] }) {
  const d = useDesk()
  const up = (id: string, part: Partial<Effect>) => changeDesk((x) => ({ ...x, effects: x.effects.map((e) => (e.id === id ? { ...e, ...part } : e)) }))
  const add = (attr: Effect['attr']) => { if (!sel.length) return toast('Select fixtures first.'); changeDesk((x) => ({ ...x, effects: [...x.effects, newEffect(sel, attr)] })) }
  return (
    <div className="desk-effects">
      <div className="row wrap gap">
        <span className="dim small">For the selected fixtures:</span>
        <button className="btn small" onClick={() => add('dim')}>+ Intensity wave</button>
        <button className="btn small" onClick={() => add('color')}>+ Color chase</button>
        <button className="btn small" onClick={() => add('circle')}>+ Circle (pan and tilt)</button>
        <button className="btn small quiet" onClick={() => add('pan')}>+ Pan wave</button>
        <button className="btn small quiet" onClick={() => add('tilt')}>+ Tilt wave</button>
        <span className="grow" />
        <label className="mini">BPM <Scrub value={d.bpm} step={0.5} digits={1} min={20} max={300} onChange={(bpm) => changeDesk((x) => ({ ...x, bpm }))} /></label>
        <button className="btn small quiet" title="Take the tempo from the audio lab" onClick={() => { const v = readSignal('audio:bpm'); if (v > 0) changeDesk((x) => ({ ...x, bpm: Math.round(60 + v * 140) })); else toast('Start the audio lab to follow its tempo.') }}>From audio</button>
      </div>
      {d.effects.map((e) => (
        <div key={e.id} className={`fx-card${e.on ? '' : ' off'}`}>
          <div className="fx-head">
            <button className={`fx-on${e.on ? ' on' : ''}`} onClick={() => up(e.id, { on: !e.on })}>{e.on ? 'on' : 'off'}</button>
            <input className="input mini-name" value={e.name} onChange={(x) => up(e.id, { name: x.target.value })} />
            <span className="dim small">{e.fixtures.length} fixtures</span>
            <span className="grow" />
            <button className="btn small quiet" disabled={!sel.length} onClick={() => up(e.id, { fixtures: sel })}>Use selection</button>
            <button className="icon-btn small danger" onClick={() => changeDesk((x) => ({ ...x, effects: x.effects.filter((y) => y.id !== e.id) }))}>{'×'}</button>
          </div>
          <div className="fx-body row wrap gap">
            <label className="mini">Shape <select className="select mini" value={e.shape} onChange={(x) => up(e.id, { shape: x.target.value as Effect['shape'] })}>
              {['sine', 'square', 'saw', 'ramp', 'random', 'chase'].map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
            <label className="mini-check"><input type="checkbox" checked={e.sync} onChange={(x) => up(e.id, { sync: x.target.checked })} />In time (beats)</label>
            <label className="mini">{e.sync ? 'Beats a cycle' : 'Cycles a second'} <Scrub value={e.rate} step={0.01} digits={2} min={0.01} max={32} onChange={(rate) => up(e.id, { rate })} /></label>
            <label className="mini">Size <Scrub value={e.size} step={0.01} digits={2} min={0} max={1} onChange={(size) => up(e.id, { size })} /></label>
            <label className="mini">Middle <Scrub value={e.base} step={0.01} digits={2} min={0} max={1} onChange={(base) => up(e.id, { base })} /></label>
            <label className="mini" title="How much each fixture is behind the one before: 0 all together, 1 spread over one cycle">Spread <Scrub value={e.spread} step={0.01} digits={2} min={0} max={4} onChange={(spread) => up(e.id, { spread })} /></label>
            {e.attr === 'color' && <span className="swatches">{e.colors.map((c, i) => <input key={i} type="color" className="swatch mini" value={c} onChange={(x) => up(e.id, { colors: e.colors.map((y, j) => (j === i ? x.target.value : y)) })} onContextMenu={(x) => { x.preventDefault(); if (e.colors.length > 1) up(e.id, { colors: e.colors.filter((_, j) => j !== i) }) }} />)}<button className="icon-btn small" onClick={() => up(e.id, { colors: [...e.colors, '#ffffff'] })}>+</button></span>}
          </div>
        </div>
      ))}
      {!d.effects.length && <p className="dim small">Effects move by themselves: waves, chases, circles. In time with the BPM, or at their own speed.</p>}
    </div>
  )
}

function Cues() {
  const d = useDesk()
  const up = (id: string, part: Partial<{ name: string; fade: number }>) => changeDesk((x) => ({ ...x, cues: x.cues.map((c) => (c.id === id ? { ...c, ...part } : c)) }))
  return (
    <div className="desk-cues">
      <div className="row wrap gap">
        <button className="btn primary desk-go" onClick={goNext} title="The next cue (or the first)">GO</button>
        <button className="btn small" onClick={() => { const c = recordCue(); toast(`${c.name} stored.`, true) }}>Store what you see as a cue</button>
        <span className="dim small">A cue keeps every fixture and which effects run. GO fades to the next one.</span>
      </div>
      <ol className="desk-cue-list">
        {d.cues.map((c) => (
          <li key={c.id} className={d.current === c.id ? 'on' : ''}>
            <button className="btn small" onClick={() => goCue(c.id)}>Go</button>
            <input className="input" value={c.name} onChange={(e) => up(c.id, { name: e.target.value })} />
            <label className="mini">Fade <Scrub value={c.fade} step={0.1} digits={1} suffix=" s" min={0} max={120} onChange={(fade) => up(c.id, { fade })} /></label>
            <span className="dim small">{c.effects.length ? `${c.effects.length} effect${c.effects.length > 1 ? 's' : ''}` : ''}</span>
            <span className="grow" />
            <button className="btn small quiet" title="Store what you see into this cue" onClick={() => { const live = computeLooks(performance.now() / 1000); changeDesk((x) => ({ ...x, cues: x.cues.map((y) => (y.id === c.id ? { ...y, looks: live, effects: x.effects.filter((e) => e.on).map((e) => e.id) } : y)), programmer: {} })) }}>Update</button>
            <button className="icon-btn small danger" onClick={() => changeDesk((x) => ({ ...x, cues: x.cues.filter((y) => y.id !== c.id) }))}>{'×'}</button>
          </li>
        ))}
      </ol>
    </div>
  )
}

function Links({ sel }: { sel: string[] }) {
  const d = useDesk()
  const up = (id: string, part: Partial<Link>) => changeDesk((x) => ({ ...x, links: x.links.map((l) => (l.id === id ? { ...l, ...part } : l)) }))
  return (
    <div className="desk-links">
      <div className="row gap"><button className="btn small primary" onClick={() => { if (!sel.length) return toast('Select fixtures first.'); changeDesk((x) => ({ ...x, links: [...x.links, newLink(sel)] })) }}>+ Link the selection to a signal</button>
        <span className="dim small">The audio, a MIDI knob, OSC, a phone control or the timeline drives the light.</span></div>
      {d.links.map((l) => (
        <div key={l.id} className="fx-card">
          <div className="fx-body row wrap gap">
            <select className="select mini" value={l.attr} onChange={(e) => up(l.id, { attr: e.target.value as Link['attr'] })}>
              <option value="dim">Intensity</option><option value="hue">Color (hue)</option><option value="pan">Pan</option><option value="tilt">Tilt</option><option value="strobe">Strobe</option><option value="zoom">Zoom</option>
            </select>
            <span className="dim small">of {l.fixtures.length} fixtures follows</span>
            <SignalPicker label={`desk.${l.id}`} value={l.signal} onChange={(signal) => up(l.id, { signal })} compact />
            <label className="mini">from <Scrub value={l.min} step={0.01} digits={2} min={0} max={1} onChange={(min) => up(l.id, { min })} /></label>
            <label className="mini">to <Scrub value={l.max} step={0.01} digits={2} min={0} max={1} onChange={(max) => up(l.id, { max })} /></label>
            <button className="btn small quiet" disabled={!sel.length} onClick={() => up(l.id, { fixtures: sel })}>Use selection</button>
            <button className="icon-btn small danger" onClick={() => changeDesk((x) => ({ ...x, links: x.links.filter((y) => y.id !== l.id) }))}>{'×'}</button>
          </div>
        </div>
      ))}
    </div>
  )
}

function Output() {
  const d = useDesk()
  useTick(100)
  const [nodes, setNodes] = useState<{ ip: string; name: string; long: string }[]>([])
  const live = rico.get().status === 'live'
  const universes = [...new Set(d.fixtures.map((f) => f.universe))].sort((a, b) => a - b)
  const [uni, setUni] = useState(universes[0] ?? 0)
  const frame = latestFrames().get(uni)
  const owner = new Map<number, Fixture>()
  for (const f of d.fixtures) if (f.universe === uni) for (let c = 0; c < footprint(f); c++) owner.set(f.address + c, f)
  return (
    <div className="desk-output">
      <div className="row wrap gap">
        <label className="switch"><input type="checkbox" role="switch" checked={d.output.on} onChange={(e) => changeDesk((x) => ({ ...x, output: { ...x.output, on: e.target.checked } }))} /><span>Send</span></label>
        <select className="select mini" value={d.output.protocol} onChange={(e) => changeDesk((x) => ({ ...x, output: { ...x.output, protocol: e.target.value as 'artnet' | 'sacn' } }))}>
          <option value="artnet">Art-Net</option><option value="sacn">sACN (E1.31)</option>
        </select>
        {d.output.protocol === 'artnet' && <label className="mini">To <input className="input" value={d.output.ip} onChange={(e) => setTarget(e.target.value)} style={{ width: 140 }} title="255.255.255.255 sends to every node on the network" /></label>}
        <label className="mini">Rate <Scrub value={d.output.rate} step={1} digits={0} suffix=" Hz" min={1} max={44} onChange={(rate) => changeDesk((x) => ({ ...x, output: { ...x.output, rate } }))} /></label>
        <button className="btn small quiet" disabled={!live} onClick={async () => {
          const a = await rico.send('dmx.poll')
          if (!a.ok) toast(a.error ?? 'Could not look for nodes.')
          window.setTimeout(async () => { const r = await rico.send('dmx.nodes'); setNodes((r.nodes as typeof nodes | undefined) ?? []) }, 1500)
        }}>Find Art-Net nodes</button>
        {!live && <span className="dim small">Sending works in the app (this is the demo).</span>}
      </div>
      {nodes.length > 0 && <ul className="list">{nodes.map((n) => <li key={n.ip}><span className="name">{n.name || n.long}</span><code>{n.ip}</code><button className="btn small quiet" onClick={() => setTarget(n.ip)}>Send only to it</button></li>)}</ul>}
      <div className="row gap wrap">
        <span className="param-label">Universe</span>
        {universes.map((u) => <button key={u} className={`btn small ${u === uni ? 'primary' : 'quiet'}`} onClick={() => setUni(u)}>{u}</button>)}
        <span className="dim small">{d.output.protocol === 'sacn' ? 'sACN universes start at 1.' : 'Art-Net universes start at 0.'}</span>
      </div>
      <div className="desk-monitor">
        {Array.from({ length: 512 }, (_, i) => {
          const v = frame?.[i] ?? 0
          const f = owner.get(i + 1)
          return <span key={i} className={f ? 'used' : ''} title={`${i + 1}${f ? `: ${f.name}` : ''} = ${v}`} style={{ background: `rgba(59,255,3,${v / 300})` }}>{v || ''}</span>
        })}
      </div>
    </div>
  )
}

// Fixtures in 3D, and in the room. Each fixture can have a twin in the 3D
// scene: a light with a beam that plays exactly what the desk sends, so you
// can build the show on screen. Put the twins where the real fixtures hang
// (in meters), and "Aims at" turns the real heads toward a 3D object: an
// animated path, or something that follows a sensor.
function Space({ sel }: { sel: string[] }) {
  const d = useDesk()
  const objects = useWorld((w) => w.objects)
  const upFix = (id: string, part: Partial<Fixture>) => changeDesk((x) => ({ ...x, fixtures: x.fixtures.map((f) => (f.id === id ? { ...f, ...part } : f)) }))
  const twin = (fid: string) => objects.find((o) => o.fixture === fid)
  const addTwin = (f: Fixture, i: number, n: number) => {
    if (twin(f.id)) return
    const x = (i - (n - 1) / 2) * 1.2
    addObject(newObject('spot-light', { name: f.name, fixture: f.id, position: [x, 4, 0], intensity: 40 }))
  }
  const targets = objects.filter((o) => !o.fixture && !isLight(o.kind))
  const list = sel.length ? d.fixtures.filter((f) => sel.includes(f.id)) : d.fixtures
  const setAt = (fid: string, k: number, v: number) => { const o = twin(fid); if (!o) return; const p = [...o.position] as Vec3; p[k] = v; updateObject(o.id, { position: p }, 'Move fixture', `${o.id}.fixpos`) }
  return (
    <div className="desk-patch">
      <p className="dim small">Every fixture can have a twin in the 3D scene that plays what the desk sends, beam and all. Put the twins where the real fixtures hang, in meters (0, 0, 0 is the middle of the floor), and pick something for them to aim at: the real moving heads turn to it too.</p>
      <div className="row wrap gap">
        <button className="btn small primary" disabled={!d.fixtures.length} onClick={() => { list.forEach((f, i) => addTwin(f, i, list.length)); toast(`${list.length} fixture${list.length > 1 ? 's are' : ' is'} in the 3D scene.`, true) }}>Put {sel.length ? 'the picked' : 'every'} fixture in 3D</button>
        <button className="btn small quiet" onClick={() => changeWorld('Take fixtures out of 3D', (w) => ({ ...w, objects: w.objects.filter((o) => !o.fixture || !list.some((f) => f.id === o.fixture)) }))}>Take them out</button>
        <button className="btn small quiet" onClick={() => goTo('3d')}>See them in 3D</button>
      </div>
      <table className="desk-table">
        <thead><tr><th>Fixture</th><th>In 3D</th><th>Where (x, y, z m)</th><th>Hangs</th><th>Pan / tilt range</th><th>Aims at</th></tr></thead>
        <tbody>
          {list.map((f, i) => {
            const t = twin(f.id)
            return (
              <tr key={f.id}>
                <td>{f.name}<span className="dim small"> {profileOf(f.profile).name}</span></td>
                <td><input type="checkbox" checked={Boolean(t)} onChange={(e) => (e.target.checked ? addTwin(f, i, list.length) : t && changeWorld('Take fixture out of 3D', (w) => ({ ...w, objects: w.objects.filter((o) => o.id !== t.id) })))} /></td>
                <td>{t ? <span className="row gap">{[0, 1, 2].map((k) => <Scrub key={k} value={t.position[k]} step={0.01} digits={2} min={-100} max={100} suffix=" m" onChange={(v) => setAt(f.id, k, v)} />)}<button className="icon-btn small" title="Pick it in 3D" onClick={() => { select3d(t.id); goTo('3d') }}>{'\u2192'}</button></span> : <span className="dim small">not in 3D</span>}</td>
                <td><select className="select mini" value={f.mount ?? 'down'} onChange={(e) => upFix(f.id, { mount: e.target.value as Fixture['mount'] })}><option value="down">Hung (beam down)</option><option value="up">Standing (beam up)</option></select></td>
                <td><span className="row gap"><Scrub value={f.panRange ?? 540} step={1} digits={0} min={90} max={720} suffix=" deg" onChange={(v) => upFix(f.id, { panRange: v })} /><Scrub value={f.tiltRange ?? 270} step={1} digits={0} min={60} max={360} suffix=" deg" onChange={(v) => upFix(f.id, { tiltRange: v })} /></span></td>
                <td>
                  <select className="select mini" value={f.follow ?? ''} onChange={(e) => upFix(f.id, { follow: e.target.value || undefined })} disabled={!t}>
                    <option value="">Nothing (the desk aims it)</option>
                    {targets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {!d.fixtures.length && <p className="dim small">Patch fixtures first.</p>}
      <p className="dim small">Aims at follows the object as it moves: animate it on the 3D timeline, link it to a signal (a phone's tilt, OSC from a tracker), or drag it. The desk's programmer still wins, so a hand-set pan or tilt overrides it. The 3D twin uses the fixture's color, intensity, zoom and strobe.</p>
    </div>
  )
}

export default function LightingDesk() {
  const d = useDesk()
  const [tab, setTab] = useState<Tab>(() => (getDesk().fixtures.length ? 'control' : 'patch'))
  const [sel, setSel] = useState<string[]>([])
  useEffect(() => { startDesk() }, [])
  const pick = (id: string, add: boolean) => setSel((s) => (add ? (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]) : [id]))
  return (
    <div className="dpanel desk">
      <div className="row wrap gap desk-top">
        <label className="mini">Master <input className="range" type="range" min={0} max={1} step={0.001} value={d.master} onChange={(e) => changeDesk((x) => ({ ...x, master: Number(e.target.value) }))} /></label>
        <button className={`btn small ${d.blackout ? 'out' : 'quiet'}`} onClick={() => changeDesk((x) => ({ ...x, blackout: !x.blackout }))}>{d.blackout ? 'Blackout ON' : 'Blackout'}</button>
        <button className="btn small primary" onClick={goNext}>GO</button>
        <span className={`small ${d.output.on ? 'lime' : 'dim'}`}>{d.output.on ? `Sending ${d.output.protocol === 'sacn' ? 'sACN' : 'Art-Net'}` : 'Not sending'}</span>
        <span className="grow" />
        <div className="seg">
          {([['control', 'Control'], ['patch', 'Patch'], ['space', '3D and room'], ['effects', 'Effects'], ['cues', 'Cues'], ['links', 'Links'], ['output', 'Output']] as [Tab, string][]).map(([k, l]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
      </div>
      <Visual sel={sel} onPick={pick} />
      {tab === 'control' && <Control sel={sel} setSel={setSel} />}
      {tab === 'patch' && <Patch sel={sel} />}
      {tab === 'space' && <Space sel={sel} />}
      {tab === 'effects' && <Effects sel={sel} />}
      {tab === 'cues' && <Cues />}
      {tab === 'links' && <Links sel={sel} />}
      {tab === 'output' && <Output />}
    </div>
  )
}
