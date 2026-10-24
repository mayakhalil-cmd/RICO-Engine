import { useEffect, useMemo, useRef, useState } from 'react'
import Settings from '../sections/Settings'
import { useLearn, startLearn, stopLearn } from '../engine/learn'
import { getCommands, type Command } from './commands'
import PanelPicker, { resolvePick } from './PanelPicker'
import {
  comboOf, isCustom, resetTriggers, setRecording, setTriggers, triggerLabel, triggersFor, useShortcuts, type Trigger,
  prettyKeys,
} from './shortcuts'
import { openOverlay, useOverlay, useQuestion } from './ui'
import { allWorkspaces, newWorkspace } from './workspaces'
import { STARTER_PROJECTS } from './projects'
import { toast } from '../components/Toasts'

// command search

function score(label: string, q: string): number {
  const l = label.toLowerCase()
  if (!q) return 1
  if (l.startsWith(q)) return 100
  const i = l.indexOf(q)
  if (i >= 0) return 80 - i
  // letters in order, like "snv" for "Send network video"
  let pos = 0
  for (const ch of q) {
    pos = l.indexOf(ch, pos)
    if (pos < 0) return 0
    pos++
  }
  return 10
}

function Palette() {
  const [q, setQ] = useState('')
  const [index, setIndex] = useState(0)
  const commands = useMemo(getCommands, [])
  const results = useMemo(() => {
    const query = q.trim().toLowerCase()
    return commands
      .map((c) => ({ c, s: Math.max(score(c.label, query), score(`${c.group} ${c.label}`, query) - 5) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 12)
      .map((r) => r.c)
  }, [q, commands])

  const run = (c: Command | undefined) => {
    if (!c) return
    openOverlay(null)
    window.setTimeout(c.run, 0)
  }

  return (
    <div className="overlay" onPointerDown={(e) => e.target === e.currentTarget && openOverlay(null)}>
      <div className="palette" role="dialog" aria-label="Search commands">
        <input
          autoFocus
          className="palette-input"
          placeholder="What do you want to do? Try: virtual port, noise, send video, script"
          value={q}
          onChange={(e) => { setQ(e.target.value); setIndex(0) }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(results.length - 1, i + 1)) }
            if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)) }
            if (e.key === 'Enter') run(results[index])
            if (e.key === 'Escape') openOverlay(null)
          }}
        />
        <ul className="palette-list" role="listbox">
          {results.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === index}>
              <button className={i === index ? 'on' : ''} onPointerEnter={() => setIndex(i)} onClick={() => run(c)}>
                <span>{c.label}</span>
                <span className="dim small">{c.group}</span>
                {c.keys ? <kbd>{prettyKeys(c.keys)}</kbd> : <span />}
              </button>
            </li>
          ))}
          {results.length === 0 && <li className="dim small" style={{ padding: 12 }}>Nothing matches "{q}".</li>}
        </ul>
      </div>
    </div>
  )
}

// dialogs

function Dialog({ title, children, wide, onClose = () => openOverlay(null), foot }: {
  title: string
  children: React.ReactNode
  wide?: boolean
  onClose?: () => void
  foot?: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus()
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [])
  return (
    <div className="overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog${wide ? ' wide' : ''}`} role="dialog" aria-label={title} tabIndex={-1} ref={ref}>
        <div className="dialog-head">
          <h2>{title}</h2>
          <button className="btn quiet small" onClick={onClose}>Close</button>
        </div>
        <div className="dialog-body">{children}</div>
        {foot && <div className="dialog-foot">{foot}</div>}
      </div>
    </div>
  )
}

function QuestionDialog() {
  const q = useQuestion()
  const [value, setValue] = useState('')
  useEffect(() => setValue(q?.input?.value ?? ''), [q])
  if (!q) return null
  const ok = () => q.resolve(q.input ? value : 'yes')
  return (
    <div className="overlay top" onPointerDown={(e) => e.target === e.currentTarget && q.resolve(null)}>
      <form className="dialog small" role="alertdialog" aria-label={q.title} onSubmit={(e) => { e.preventDefault(); ok() }}
        onKeyDown={(e) => e.key === 'Escape' && q.resolve(null)}>
        <div className="dialog-head"><h2>{q.title}</h2></div>
        <div className="dialog-body stack">
          {q.body && <div className="muted">{q.body}</div>}
          {q.input && (
            <label className="field">
              <span>{q.input.label}</span>
              <input className="input" autoFocus value={value} onChange={(e) => setValue(e.target.value)} onFocus={(e) => e.target.select()} spellCheck={false} />
            </label>
          )}
        </div>
        <div className="dialog-foot">
          <button type="button" className="btn quiet" onClick={() => q.resolve(null)}>{q.cancel ?? 'Cancel'}</button>
          <button type="submit" className={`btn ${q.danger ? 'out' : 'primary'}`} autoFocus={!q.input}>{q.ok}</button>
        </div>
      </form>
    </div>
  )
}

// A new workspace: a name, then either a blank page, a copy of a workspace,
// or a hand-picked set of panels.
function NewWorkspace() {
  const [name, setName] = useState('My workspace')
  const [from, setFrom] = useState<string>('pick')
  const [picked, setPicked] = useState<string[]>([])
  const toggle = (pick: string) => setPicked((p) => (p.includes(pick) ? p.filter((x) => x !== pick) : [...p, pick]))
  const make = () => {
    const clean = name.trim() || 'My workspace'
    openOverlay(null)
    if (from === 'pick') newWorkspace(clean, { panels: picked.map(resolvePick) })
    else newWorkspace(clean, { from: allWorkspaces().find((w) => w.id === from) })
  }
  return (
    <Dialog
      title="New workspace"
      wide
      foot={<>
        <span className="dim small grow">{from === 'pick' ? (picked.length ? `${picked.length} panel${picked.length > 1 ? 's' : ''} picked` : 'Nothing picked: you get an empty workspace to build in.') : ''}</span>
        <button className="btn quiet" onClick={() => openOverlay(null)}>Cancel</button>
        <button className="btn primary" onClick={make}>Make workspace</button>
      </>}
    >
      <div className="stack">
        <div className="row wrap">
          <label className="field grow">
            <span>Name</span>
            <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.target.select()}
              onKeyDown={(e) => e.key === 'Enter' && make()} />
          </label>
          <label className="field">
            <span>Start from</span>
            <select className="select" value={from} onChange={(e) => setFrom(e.target.value)}>
              <option value="pick">Panels I pick</option>
              {allWorkspaces().map((w) => <option key={w.id} value={w.id}>A copy of {w.name}</option>)}
            </select>
          </label>
        </div>
        {from === 'pick' && <PanelPicker selected={picked} onPick={toggle} />}
        <p className="dim small">Later you can add panels with the + next to any panel's tabs, drag a workspace tab into it, or add a script for a protocol RICO does not have.</p>
      </div>
    </Dialog>
  )
}

// shortcuts

function ShortcutRow({ c }: { c: Command }) {
  const list = triggersFor(c.id)
  const learn = useLearn()
  const [recording, setRec] = useState(false)

  useEffect(() => {
    if (!recording) return
    setRecording(true)
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') { setRec(false); return }
      const combo = comboOf(e)
      if (!combo) return
      setTriggers(c.id, [...triggersFor(c.id).filter((t) => !(t.kind === 'key' && t.combo === combo)), { kind: 'key', combo }])
      setRec(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      setRecording(false)
    }
  }, [recording, c.id])

  const remove = (t: Trigger) => setTriggers(c.id, list.filter((x) => x !== t))
  const learning = learn.active && learn.label === c.label

  return (
    <li className="shortcut">
      <span className="shortcut-name">{c.label}<span className="dim small"> {c.group}</span></span>
      <span className="shortcut-keys">
        {list.map((t, i) => (
          <button key={i} className={`chip key ${t.kind}`} title="Remove" onClick={() => remove(t)}>
            {t.kind === 'signal' && <i className="dot" aria-hidden="true" />}{triggerLabel(t)} <span aria-hidden="true">×</span>
          </button>
        ))}
        <button className={`btn small quiet${recording ? ' primary' : ''}`} onClick={() => setRec(!recording)}>{recording ? 'Press keys...' : '+ Key'}</button>
        <button className={`btn small quiet${learning ? ' primary' : ''}`} title="Move a knob, hit a pad, send OSC or play a sound" onClick={() => {
          if (learning) return stopLearn()
          startLearn(c.label, (signal) => setTriggers(c.id, [...triggersFor(c.id), { kind: 'signal', id: signal }]))
        }}>{learning ? 'Move a control...' : '+ Control'}</button>
        {isCustom(c.id) && <button className="btn small quiet" onClick={() => resetTriggers(c.id)} title="Back to the default">Reset</button>}
      </span>
    </li>
  )
}

function Shortcuts() {
  useShortcuts()
  const [q, setQ] = useState('')
  const commands = useMemo(() => {
    // The commands people bind most come first; opening panels comes last.
    const rank = (c: Command) => (c.group.startsWith('Window') ? 3 : c.group === 'Scripts' || c.group === 'Help' ? 2 : c.group === 'View' ? 1 : 0)
    return getCommands()
      .filter((c) => !c.id.startsWith('go.') && !c.id.startsWith('merge.'))
      .sort((a, b) => rank(a) - rank(b))
  }, [])
  const shown = commands.filter((c) => !q || `${c.label} ${c.group}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <Dialog title="Keyboard and controls" wide foot={<>
      <span className="dim small grow">Ctrl+1 to Ctrl+9 switch workspaces. Right-click any setting in Motion to link it to a control.</span>
      <button className="btn quiet" onClick={() => resetTriggers()}>Reset everything</button>
    </>}>
      <div className="stack">
        <p className="muted small">
          Any command can have keys, and any control: a pad or knob on a MIDI controller, an OSC button from a phone,
          a foot switch, even the kick drum. A control runs the command when it goes past halfway.
        </p>
        <input className="input" placeholder="Find a command" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <ul className="shortcut-list">
          {shown.map((c) => <ShortcutRow key={c.id} c={c} />)}
        </ul>
      </div>
    </Dialog>
  )
}

function Starters() {
  const [busy, setBusy] = useState('')
  return (
    <Dialog title="Starter projects" wide>
      <p className="muted">Each one sets up a working project with its own workspace. Your current scene, routes and node networks are swapped out, and Undo brings them back.</p>
      <div className="starters">
        {STARTER_PROJECTS.map((s) => (
          <article key={s.id} className="starter">
            <h3>{s.name}</h3>
            <p className="small">{s.about}</p>
            <ul>{s.sets.map((x) => <li key={x} className="dim small">{x}</li>)}</ul>
            <button className="btn primary" disabled={Boolean(busy)} onClick={async () => {
              setBusy(s.id)
              try {
                await s.start()
                openOverlay(null)
                toast(`${s.name} is ready.`, true)
              } catch (e) {
                toast(`Could not start that: ${(e as Error).message}`)
              } finally {
                setBusy('')
              }
            }}>{busy === s.id ? 'Setting up...' : 'Start'}</button>
          </article>
        ))}
      </div>
    </Dialog>
  )
}

export default function Overlays() {
  const overlay = useOverlay()
  const learn = useLearn()
  return (
    <>
      {learn.active && (
        <div className="learn-banner" role="status">
          <span><b>Learning {learn.label}.</b> Move a knob, send OSC or play a sound.</span>
          <button className="btn quiet small" onClick={stopLearn}>Cancel</button>
        </div>
      )}
      {overlay === 'palette' && <Palette />}
      {overlay === 'settings' && <Dialog title="Settings" wide><Settings /></Dialog>}
      {overlay === 'shortcuts' && <Shortcuts />}
      {overlay === 'new-workspace' && <NewWorkspace />}
      {overlay === 'starters' && <Starters />}
      {overlay === 'about' && (
        <Dialog title="RICO">
          <p>Real-time Integration Control Operations. A free hub for MIDI, OSC, DMX, MQTT, Spout and network video.</p>
          <p className="muted small">Made by Maya Khalil. Business Source License 1.1, Apache 2.0 from 2030. See THIRD_PARTY_NOTICES.md for the projects RICO is built on.</p>
        </Dialog>
      )}
      <QuestionDialog />
    </>
  )
}
