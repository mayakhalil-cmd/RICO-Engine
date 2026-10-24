import { useState } from 'react'
import Icon from '../components/Icon'
import Scrub from '../components/Scrub'
import { toast } from '../components/Toasts'
import { useSignalList } from '../engine/signals'
import { downloadBlob, pickFile } from '../shell/ui'
import { RULE_PRESETS } from './automation'
import { getSettings, setSettings, updatePrinter, type Printer, type PrintChoice } from './printers'
import { deleteProfile, exportProfile, loadProfile, readProfile, saveProfile, useProfiles } from './profiles'
import { PRINT_DEFAULTS, type Rule, type Step, type StepKind, type SupportBox, type When } from './settings'
import { DEFS, TABS, type Def, type Tab } from './settingsDefs'

// The print settings, in tabs like most slicers have them, with a search
// box, a simple and an advanced view, a reset button on everything you
// changed, and named profiles you can save, share and read from files.

const remember = <T,>(key: string, v: T) => { try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* not kept */ } }
const recall = <T,>(key: string, v: T): T => { try { const r = localStorage.getItem(key); return r === null ? v : (JSON.parse(r) as T) } catch { return v } }

function valueOf(d: Def, s: PrintChoice, p: Printer): unknown {
  const raw = (d.printer ? (p as unknown as Record<string, unknown>) : (s as unknown as Record<string, unknown>))[d.key]
  if (raw !== undefined && raw !== null && !(d.fallback && raw === 0 && d.type === 'num' && d.key.endsWith('Width'))) return raw
  return d.fallback ? d.fallback(s, p) : (PRINT_DEFAULTS as unknown as Record<string, unknown>)[d.key]
}
function isChanged(d: Def, s: PrintChoice, _p?: Printer): boolean {
  if (d.printer) return false
  const raw = (s as unknown as Record<string, unknown>)[d.key]
  const def = (PRINT_DEFAULTS as unknown as Record<string, unknown>)[d.key]
  return raw !== undefined && JSON.stringify(raw) !== JSON.stringify(def)
}
function put(d: Def, p: Printer, v: unknown) {
  if (d.printer) updatePrinter(p.id, { [d.key]: v } as Partial<Printer>)
  else setSettings({ [d.key]: v } as Partial<PrintChoice>)
}

function Row({ d, s, p }: { d: Def; s: PrintChoice; p: Printer }) {
  const v = valueOf(d, s, p)
  const changed = isChanged(d, s, p)
  let ctl: React.ReactNode = null
  if (d.type === 'num') {
    const scale = d.scale ?? 1
    const num = Number(v ?? 0)
    const shown = d.flip !== undefined ? d.flip - num : num * scale
    ctl = <Scrub value={shown} step={d.step ?? 0.1} digits={d.digits ?? 1} min={d.min !== undefined ? (d.flip !== undefined ? d.flip - (d.max ?? 90) : d.min * scale) : undefined} max={d.max !== undefined ? (d.flip !== undefined ? d.flip - (d.min ?? 0) : d.max * scale) : undefined} suffix={d.suffix ?? ''}
      onChange={(x) => put(d, p, d.flip !== undefined ? d.flip - x : (d.digits === 0 && !d.scale ? Math.round(x) : x / scale))} />
  } else if (d.type === 'bool') {
    ctl = <input type="checkbox" checked={Boolean(v)} onChange={(e) => put(d, p, e.target.checked)} />
  } else if (d.type === 'choice') {
    ctl = <select className="select" value={String(v ?? '')} onChange={(e) => put(d, p, e.target.value)}>{d.choices!.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
  } else if (d.type === 'text') {
    ctl = <input className="input" value={String(v ?? '')} onChange={(e) => put(d, p, e.target.value)} spellCheck={false} />
  }
  if (d.type === 'code') {
    return (
      <div className="pss-code">
        <span className="pss-label" title={d.hint}>{d.label}</span>
        {d.hint && <p className="dim small">{d.hint}</p>}
        <textarea className="input mono pr-code" value={String(v ?? '')} rows={d.key === 'start' ? 8 : 4} spellCheck={false} onChange={(e) => put(d, p, e.target.value)} />
      </div>
    )
  }
  return (
    <label className={`ps-row pss-row${changed ? ' changed' : ''}`} title={d.hint}>
      <span>{d.label}</span>
      <div className="pss-ctl">
        {ctl}
        {changed && <button type="button" className="icon-btn small" title="Back to the default" onClick={(e) => { e.preventDefault(); put(d, p, (PRINT_DEFAULTS as unknown as Record<string, unknown>)[d.key]) }}><Icon name="x" /></button>}
      </div>
    </label>
  )
}

function Groups({ defs, s, p, showTab }: { defs: Def[]; s: PrintChoice; p: Printer; showTab?: boolean }) {
  const groups: [string, Def[]][] = []
  for (const d of defs) {
    const name = showTab ? `${TABS.find((t) => t.id === d.tab)!.name}: ${d.group}` : d.group
    const g = groups.find((x) => x[0] === name)
    if (g) g[1].push(d); else groups.push([name, [d]])
  }
  return <>{groups.map(([name, list]) => (
    <div key={name} className="pss-group">
      <h5>{name}</h5>
      {list.map((d) => <Row key={d.key} d={d} s={s} p={p} />)}
    </div>
  ))}</>
}

function ProfileBar({ p }: { p: Printer }) {
  const profiles = useProfiles()
  const [name, setName] = useState(() => recall('rico.print.profile', ''))
  const [pick, setPick] = useState(name)
  const choose = (n: string) => { setPick(n); if (n) { loadProfile(n); setName(n); remember('rico.print.profile', n) } }
  const importFile = (f: File) => void f.text().then((t) => {
    const r = readProfile(t, f.name)
    if (typeof r === 'string') return toast(r)
    setSettings({ ...r.settings })
    const pr: Partial<Printer> = { ...r.printer }
    delete (pr as Record<string, unknown>).id
    if (Object.keys(pr).length) updatePrinter(p.id, pr)
    saveProfile(r.name)
    setName(r.name); setPick(r.name); remember('rico.print.profile', r.name)
    toast(`Read ${r.used.length} settings from ${f.name}.${r.skipped.length ? ` ${r.skipped.length} were not used (RICO has no setting for them).` : ''}`, true)
  })
  return (
    <div className="pss-profiles">
      <select className="select" value={pick} onChange={(e) => choose(e.target.value)} title="Your saved print profiles">
        <option value="">{profiles.length ? 'Pick a profile' : 'No profiles yet'}</option>
        {profiles.map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}
      </select>
      <input className="input" value={name} placeholder="Profile name" onChange={(e) => setName(e.target.value)} />
      <div className="row wrap">
        <button className="btn small" onClick={() => { saveProfile(name); setPick(name.trim() || 'My profile'); remember('rico.print.profile', name); toast('Profile saved.', true) }}>Save</button>
        <button className="btn small quiet" disabled={!pick} onClick={() => { deleteProfile(pick); setPick('') }}>Delete</button>
        <button className="btn small quiet" onClick={() => downloadBlob(`${(name || 'print-profile').replace(/[^\w\- ]+/g, '')}.json`, new Blob([exportProfile(pick || name, p)], { type: 'application/json' }))}>Export</button>
        <button className="btn small quiet" title="A RICO profile, or a .json or .ini profile from another slicer" onClick={() => pickFile('.json,.ini,.txt', importFile)}>Import</button>
      </div>
    </div>
  )
}

function SupportBoxes({ s, tool, setTool }: { s: PrintChoice; tool: 'enforce' | 'block' | null; setTool: (t: 'enforce' | 'block' | null) => void }) {
  const boxes = s.supportBoxes ?? []
  const up = (id: string, part: Partial<SupportBox>) => setSettings({ supportBoxes: boxes.map((b) => (b.id === id ? { ...b, ...part } : b)) })
  const N = ({ v, k, id, min = -1000 }: { v: number; k: keyof SupportBox; id: string; min?: number }) => <Scrub value={v} step={0.5} digits={1} min={min} max={1000} onChange={(x) => up(id, { [k]: x } as Partial<SupportBox>)} />
  return (
    <div className="pss-group">
      <h5>Your own supports</h5>
      <p className="dim small">Click a tool, then click the part on the bed where it hangs. Support boxes add support there, even where the settings would put none. Block boxes keep support out.</p>
      <div className="seg">
        <button className={tool === 'enforce' ? 'on' : ''} onClick={() => setTool(tool === 'enforce' ? null : 'enforce')}>Add support here</button>
        <button className={tool === 'block' ? 'on' : ''} onClick={() => setTool(tool === 'block' ? null : 'block')}>Block support here</button>
      </div>
      {(s.support ?? 'none') === 'none' && boxes.some((b) => b.kind === 'enforce') && <p className="warn-text small">Turn support on (above) for your boxes to print.</p>}
      <ul className="pss-boxes">
        {boxes.map((b) => (
          <li key={b.id} className={b.kind}>
            <b className="small">{b.kind === 'enforce' ? 'Support' : 'Block'}</b>
            <span className="small dim">X</span><N v={b.x} k="x" id={b.id} />
            <span className="small dim">Y</span><N v={b.y} k="y" id={b.id} />
            <span className="small dim">W</span><N v={b.w} k="w" id={b.id} min={0.5} />
            <span className="small dim">D</span><N v={b.d} k="d" id={b.id} min={0.5} />
            <span className="small dim">Z</span><N v={b.z0} k="z0" id={b.id} min={0} />
            <span className="small dim">to</span><N v={b.z1} k="z1" id={b.id} min={0} />
            <button className="icon-btn small danger" title="Take it away" onClick={() => setSettings({ supportBoxes: boxes.filter((x) => x.id !== b.id) })}><Icon name="x" /></button>
          </li>
        ))}
      </ul>
    </div>
  )
}

const STEP_NAMES: [StepKind, string][] = [
  ['signal', 'Send a RICO signal'], ['waitSignal', 'Wait for a RICO signal'], ['park', 'Move the head away'], ['cool', 'Wait for the bed to cool'],
  ['pin', 'Set a printer pin'], ['waitPin', 'Wait for a printer pin'], ['pause', 'Pause'], ['filament', 'Filament change'],
  ['dwell', 'Wait some seconds'], ['home', 'Home X and Y'], ['gcode', 'Your own G-code'],
]
const WHEN_NAMES: [When, string][] = [['start', 'At the start'], ['layer', 'Every layer'], ['every', 'Every few layers'], ['atLayer', 'At a layer'], ['atHeight', 'At a height'], ['end', 'At the end']]

function StepRow({ st, set, del, move, signals }: { st: Step; set: (s: Step) => void; del: () => void; move: (d: number) => void; signals: string[] }) {
  const n = (k: keyof Step, v: number | undefined, o: { min?: number; max?: number; step?: number; digits?: number; suffix?: string } = {}) => (
    <label className="gen-num"><span>{k === 'x' ? 'X' : k === 'y' ? 'Y' : k === 'lift' ? 'Lift' : k === 'temp' ? 'Bed' : k === 'seconds' ? (st.kind === 'waitSignal' ? 'Give up after' : 'Seconds') : 'Value'}</span>
      <Scrub value={v ?? 0} step={o.step ?? 1} digits={o.digits ?? 0} min={o.min ?? 0} max={o.max ?? 1000} suffix={o.suffix ?? ''} onChange={(x) => set({ ...st, [k]: x })} /></label>
  )
  return (
    <li className="au-step">
      <div className="row">
        <select className="select mini" value={st.kind} onChange={(e) => set({ kind: e.target.value as StepKind })}>{STEP_NAMES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <span className="grow" />
        <button className="icon-btn small" title="Up" onClick={() => move(-1)}>{'↑'}</button>
        <button className="icon-btn small" title="Down" onClick={() => move(1)}>{'↓'}</button>
        <button className="icon-btn small danger" title="Take it out" onClick={del}><Icon name="x" /></button>
      </div>
      <div className="row wrap au-params">
        {st.kind === 'park' && <>{n('x', st.x, { suffix: ' mm' })}{n('y', st.y, { suffix: ' mm' })}{n('lift', st.lift ?? 10, { step: 0.5, digits: 1, suffix: ' mm' })}<span className="dim small">It goes back after the other steps.</span></>}
        {st.kind === 'cool' && n('temp', st.temp ?? 35, { suffix: ' C', max: 120 })}
        {st.kind === 'dwell' && n('seconds', st.seconds ?? 1, { max: 3600, suffix: ' s' })}
        {(st.kind === 'pin' || st.kind === 'waitPin') && <>
          <input className="input mini" placeholder="Pin (Marlin: number, Klipper: output name)" value={st.pin ?? ''} onChange={(e) => set({ ...st, pin: e.target.value })} />
          {n('value', st.value ?? 1, { step: 0.05, digits: 2, max: 1 })}
        </>}
        {st.kind === 'pause' && <input className="input" placeholder="A note (shows in the G-code)" value={st.text ?? ''} onChange={(e) => set({ ...st, text: e.target.value })} />}
        {st.kind === 'gcode' && <textarea className="input mono pr-code" rows={3} value={st.text ?? ''} placeholder="G-code. {layer} and {z} work here" onChange={(e) => set({ ...st, text: e.target.value })} spellCheck={false} />}
        {st.kind === 'signal' && <>
          <input className="input mini" placeholder="Signal name" value={st.signal ?? ''} onChange={(e) => set({ ...st, signal: e.target.value })} />
          <input className="input mini" placeholder="Also OSC to (like /arm/go)" value={st.osc ?? ''} onChange={(e) => set({ ...st, osc: e.target.value })} />
          <span className="dim small">Becomes the signal "Print: {st.signal || 'name'}" for routes and nodes.</span>
        </>}
        {st.kind === 'waitSignal' && <>
          <input className="input" list="au-signals" placeholder="Signal to wait for, like osc:/arm/done" value={st.signal ?? ''} onChange={(e) => set({ ...st, signal: e.target.value })} />
          {n('seconds', st.seconds ?? 0, { max: 86400, suffix: ' s' })}
          {(st.seconds ?? 0) > 0 && <select className="select mini" value={st.onTimeout ?? 'resume'} onChange={(e) => set({ ...st, onTimeout: e.target.value as Step['onTimeout'] })}><option value="resume">then go on</option><option value="cancel">then stop the print</option></select>}
          <datalist id="au-signals">{signals.map((x) => <option key={x} value={x} />)}</datalist>
        </>}
      </div>
    </li>
  )
}

function Automation({ s }: { s: PrintChoice }) {
  const rules = s.automation ?? []
  const signals = useSignalList().map((x) => x.id)
  const setRules = (r: Rule[]) => setSettings({ automation: r })
  const up = (id: string, part: Partial<Rule>) => setRules(rules.map((r) => (r.id === id ? { ...r, ...part } : r)))
  return (
    <div className="pss-group au">
      <p className="dim small">Steps that run at moments of the print. Made for robots that work with the printer (an arm that takes the part off, puts in a magnet or a nut), cameras and color changes. RICO signals go out to your routes, so the arm can hear them over OSC, MQTT or serial, and "wait for a signal" holds the print until the arm says it is done.</p>
      <p className="dim small">Klipper: RICO sees each layer. USB: RICO sees each line. OctoPrint and PrusaLink: RICO sees the start, pauses and the end.</p>
      {rules.map((r) => (
        <div key={r.id} className={`au-rule${r.on ? '' : ' off'}`}>
          <div className="row">
            <input type="checkbox" checked={r.on} onChange={(e) => up(r.id, { on: e.target.checked })} title="On" />
            <input className="input" value={r.name} onChange={(e) => up(r.id, { name: e.target.value })} />
            <button className="icon-btn small danger" title="Remove the rule" onClick={() => setRules(rules.filter((x) => x.id !== r.id))}><Icon name="x" /></button>
          </div>
          <div className="row wrap">
            <select className="select" value={r.when} onChange={(e) => up(r.id, { when: e.target.value as When })}>{WHEN_NAMES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            {(r.when === 'every' || r.when === 'atLayer') && <label className="gen-num"><span>{r.when === 'every' ? 'Every' : 'Layer'}</span><Scrub value={r.n ?? (r.when === 'every' ? 10 : 1)} step={0.1} digits={0} min={1} max={20000} onChange={(x) => up(r.id, { n: Math.round(x) })} /></label>}
            {r.when === 'atHeight' && <label className="gen-num"><span>Height</span><Scrub value={r.z ?? 5} step={0.05} digits={2} min={0} max={2000} suffix=" mm" onChange={(x) => up(r.id, { z: x })} /></label>}
          </div>
          <ol className="au-steps">
            {r.steps.map((st, k) => (
              <StepRow key={k} st={st} signals={signals}
                set={(x) => up(r.id, { steps: r.steps.map((y, j) => (j === k ? x : y)) })}
                del={() => up(r.id, { steps: r.steps.filter((_, j) => j !== k) })}
                move={(d) => { const a = [...r.steps]; const j = k + d; if (j < 0 || j >= a.length) return; [a[k], a[j]] = [a[j], a[k]]; up(r.id, { steps: a }) }} />
            ))}
          </ol>
          <select className="select mini" value="" onChange={(e) => { if (e.target.value) up(r.id, { steps: [...r.steps, { kind: e.target.value as StepKind }] }) }}>
            <option value="">+ Add a step</option>
            {STEP_NAMES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
      ))}
      <select className="select" value="" onChange={(e) => { const pr = RULE_PRESETS.find((x) => x.id === e.target.value); if (pr) setRules([...rules, pr.rule()]) }}>
        <option value="">+ Add a rule</option>
        {RULE_PRESETS.map((x) => <option key={x.id} value={x.id} title={x.about}>{x.name}</option>)}
      </select>
      <h5>When the print is done</h5>
      <label className="ps-row"><span>Print it again</span><Scrub value={s.repeat ?? 0} step={0.05} digits={0} min={0} max={1000} suffix=" times" onChange={(x) => setSettings({ repeat: Math.round(x) })} /></label>
      {(s.repeat ?? 0) > 0 && <label className="ps-row" title="For example the arm saying the bed is clear"><span>After this signal</span><input className="input" list="au-signals2" value={s.repeatSignal ?? ''} placeholder="Empty: right away" onChange={(e) => setSettings({ repeatSignal: e.target.value })} /><datalist id="au-signals2">{signals.map((x) => <option key={x} value={x} />)}</datalist></label>}
    </div>
  )
}

export default function PrintSettingsBox({ p, boxTool, setBoxTool }: { p: Printer; boxTool: 'enforce' | 'block' | null; setBoxTool: (t: 'enforce' | 'block' | null) => void }) {
  const s = getSettings()
  const [tab, setTabRaw] = useState<Tab>(() => recall('rico.print.tab', 'quality' as Tab))
  const [adv, setAdvRaw] = useState(() => recall('rico.print.adv', false))
  const [q, setQ] = useState('')
  const setTab = (t: Tab) => { setTabRaw(t); remember('rico.print.tab', t) }
  const setAdv = (v: boolean) => { setAdvRaw(v); remember('rico.print.adv', v) }
  const visible = (d: Def) => (adv || !d.adv || isChanged(d, s, p)) && (!d.show || d.show(s, p))
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const found = words.length ? DEFS.filter((d) => words.every((w) => `${d.label} ${d.group} ${d.hint ?? ''} ${d.key}`.toLowerCase().includes(w))) : []
  const changedIn = (t: Tab) => DEFS.filter((d) => d.tab === t && isChanged(d, s, p)).length
  return (
    <fieldset className="ps-group pss"><legend>Print settings</legend>
      <ProfileBar p={p} />
      <div className="row pss-top">
        <input className="input grow" type="search" placeholder="Find a setting" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="seg" role="group" aria-label="How many settings">
          <button className={!adv ? 'on' : ''} onClick={() => setAdv(false)}>Simple</button>
          <button className={adv ? 'on' : ''} onClick={() => setAdv(true)}>Advanced</button>
        </div>
      </div>
      {words.length ? (
        found.length ? <Groups defs={found} s={s} p={p} showTab /> : <p className="dim small">No setting with that name.</p>
      ) : <>
        <div className="pss-tabs" role="tablist">
          {TABS.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.name}{changedIn(t.id) ? <i className="pss-dot" title={`${changedIn(t.id)} changed`} /> : null}</button>)}
        </div>
        <Groups defs={DEFS.filter((d) => d.tab === tab && visible(d))} s={s} p={p} />
        {tab === 'support' && <SupportBoxes s={s} tool={boxTool} setTool={setBoxTool} />}
        {tab === 'automation' && <Automation s={s} />}
        <button className="btn small quiet" onClick={() => { setSettings({ ...PRINT_DEFAULTS, material: s.material, nozzleTemp: s.nozzleTemp, bedTemp: s.bedTemp, fan: s.fan, automation: s.automation, supportBoxes: s.supportBoxes }); toast('Settings are back to the defaults (material and automation kept).') }}>Reset all to defaults</button>
      </>}
    </fieldset>
  )
}
