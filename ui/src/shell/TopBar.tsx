import { prettyKeys } from './shortcuts'
import { useEffect, useRef, useState } from 'react'
import Logo from '../components/Logo'
import { useRico } from '../engine/store'
import { useCreate } from '../create/store'
import { THEMES, usePrefs } from '../prefs'
import { redo, undo, useHistory } from './history'
import { getCommands, runCommand, type Command } from './commands'
import { PANELS } from './panels'
import { TEMPLATES, useScripts } from './scripts'
import { getGraphs, useGraphs } from '../nodes/store'
import { useShortcuts } from './shortcuts'
import { usePerf } from './perf'
import { openOverlay } from './ui'
import { WORKSPACE_DRAG } from './Workspace'
import { closeWorkspace, customCount, goTo, moveWorkspace, useWorkspaces } from './workspaces'

// The top of the window, in two rows. The thin first row is the app: menus,
// search, undo, status. The second row is your workspaces.

type Item =
  | { cmd: string; label?: string }
  | { sep: true }
  | { sub: string; items: () => Item[] }
  | { fold: string; items: () => Item[] }   // opens in place; RICO remembers which ones you keep open

const FOLD_KEY = 'rico.menu.open'
let openFolds: string[] = (() => {
  try {
    return JSON.parse(localStorage.getItem(FOLD_KEY) ?? '[]')
  } catch {
    return []
  }
})()
function toggleFold(name: string) {
  openFolds = openFolds.includes(name) ? openFolds.filter((f) => f !== name) : [...openFolds, name]
  try {
    localStorage.setItem(FOLD_KEY, JSON.stringify(openFolds))
  } catch {
    /* not remembered */
  }
}

const panelGroups = (): Item[] => {
  const groups: string[] = []
  for (const p of PANELS) if (!groups.includes(p.group)) groups.push(p.group)
  return groups.map((g) => ({
    fold: g,
    items: () => PANELS.filter((p) => p.group === g).map((p) => ({ cmd: `panel.${p.id}`, label: p.title })),
  }))
}

function useMenus(): { name: string; items: () => Item[] }[] {
  const { list, closed, active } = useWorkspaces()
  const scripts = useScripts()
  useGraphs()
  const others = list.filter((w) => w.id !== active)
  const workspaceMenu: Item = {
    fold: 'Workspace',
    items: () => [
      { cmd: 'ws.new', label: 'New workspace...' }, { cmd: 'ws.dup', label: 'Duplicate this one' },
      { cmd: 'ws.rename', label: 'Rename...' }, { cmd: 'ws.reset' }, { sep: true },
      { cmd: 'ws.export' }, { cmd: 'ws.import', label: 'Import a workspace or script...' }, { sep: true },
      { cmd: 'ws.close' }, { cmd: 'ws.delete' }, { cmd: 'ws.clearCustom' },
    ],
  }
  return [
    {
      name: 'File',
      items: () => [
        { cmd: 'project.starters' }, { cmd: 'project.open' }, { cmd: 'project.save' },
        { sep: true },
        { cmd: 'ws.new', label: 'New workspace...' }, { cmd: 'ws.import', label: 'Open a workspace or script...' }, { cmd: 'ws.export' },
        { sep: true },
        { cmd: 'create.open' }, { cmd: 'create.save' },
        { sep: true },
        { cmd: 'app.data' }, { cmd: 'app.save' }, { cmd: 'app.settings' },
      ],
    },
    {
      name: 'Edit',
      items: () => [{ cmd: 'undo' }, { cmd: 'redo' }, { sep: true }, { cmd: 'palette' }, { cmd: 'app.keys' }],
    },
    {
      name: 'View',
      items: () => [
        { cmd: 'view.bigger' }, { cmd: 'view.smaller' }, { sep: true },
        { sub: 'Colors', items: () => [...THEMES.map((t) => ({ cmd: `theme.${t.id}`, label: t.name })), { sep: true } as Item, { cmd: 'theme.custom', label: 'Your own...' }] },
        { cmd: 'view.lines' }, { cmd: 'view.calm' }, { cmd: 'view.full' }, { sep: true }, { cmd: 'output.new' },
      ],
    },
    {
      name: 'Window',
      items: () => [
        ...panelGroups(),
        {
          fold: 'Nodes',
          items: () => [
            ...getGraphs().filter((g) => !g.inside).map((g) => ({ cmd: `open-nodes.${g.id}`, label: g.name })),
            { cmd: 'nodes.new', label: 'New node network' },
          ],
        },
        {
          fold: 'Scripts',
          items: () => [
            ...scripts.map((s) => ({ cmd: `open-script.${s.id}`, label: s.name })),
            ...(scripts.length ? [{ sep: true } as Item] : []),
            ...TEMPLATES.map((t) => ({ cmd: `script.${t.id}`, label: `New: ${t.name}` })),
          ],
        },
        { sep: true },
        workspaceMenu,
        ...(others.length ? [{ fold: 'Bring in panels from', items: () => others.map((w) => ({ cmd: `merge.${w.id}`, label: w.name })) } as Item] : []),
        ...(closed.length ? [{ fold: 'Reopen', items: () => closed.map((w) => ({ cmd: `go.${w.id}`, label: w.name })) } as Item] : []),
      ],
    },
    {
      name: 'Help',
      items: () => [
        { cmd: 'help.tour' }, { cmd: 'help.welcome' }, { sep: true },
        { cmd: 'help.testing' }, { cmd: 'help.scripts' }, { cmd: 'app.keys' }, { cmd: 'help.source' },
        { sep: true }, { cmd: 'app.about' }, { cmd: 'app.classic' },
      ],
    },
  ]
}

function MenuList({ items, commands, close, history }: {
  items: Item[]
  commands: Map<string, Command>
  close: () => void
  history: ReturnType<typeof useHistory>
}) {
  const [sub, setSub] = useState<number | null>(null)
  const [, setFolds] = useState(0)
  return (
    <div className="menu-list" role="menu">
      {items.map((it, i) => {
        if ('sep' in it) return <hr key={i} />
        if ('fold' in it) {
          const children = it.items()
          if (!children.length) return null
          const open = openFolds.includes(it.fold)
          return (
            <div key={i} className={`menu-fold${open ? ' open' : ''}`}>
              <button
                role="menuitem"
                aria-expanded={open}
                className="fold-head"
                onPointerEnter={() => setSub(null)}
                onClick={() => { toggleFold(it.fold); setFolds((n) => n + 1) }}
              >
                <span><i className="fold-arrow" aria-hidden="true">{open ? '▾' : '▸'}</i>{it.fold}</span>
                <span className="dim small">{children.filter((c) => 'cmd' in c).length}</span>
              </button>
              {open && (
                <div className="fold-items">
                  {children.map((c, j) => {
                    if (!('cmd' in c)) return 'sep' in c ? <hr key={j} /> : null
                    const cm = commands.get(c.cmd)
                    if (!cm) return null
                    return (
                      <button key={j} role="menuitem" onClick={() => { close(); cm.run() }}>
                        <span>{c.label ?? cm.label}</span>{cm.keys && <kbd>{prettyKeys(cm.keys)}</kbd>}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        }
        if ('sub' in it) {
          const children = it.items()
          if (!children.length) return null
          return (
            <div key={i} className="menu-sub" onPointerEnter={() => setSub(i)} onPointerLeave={() => setSub((s) => (s === i ? null : s))}>
              <button
                role="menuitem"
                aria-haspopup="true"
                aria-expanded={sub === i}
                className={sub === i ? 'open' : ''}
                onClick={() => setSub(sub === i ? null : i)}
                onKeyDown={(e) => e.key === 'ArrowRight' && setSub(i)}
              >
                <span>{it.sub}</span><span className="menu-arrow" aria-hidden="true">›</span>
              </button>
              {sub === i && <MenuList items={children} commands={commands} close={close} history={history} />}
            </div>
          )
        }
        const c = commands.get(it.cmd)
        if (!c) return null
        let label = it.label ?? c.label
        let disabled = false
        if (it.cmd === 'undo') { label = history.canUndo ? `Undo ${history.undoLabel.toLowerCase()}` : 'Undo'; disabled = !history.canUndo }
        if (it.cmd === 'redo') { label = history.canRedo ? `Redo ${history.redoLabel.toLowerCase()}` : 'Redo'; disabled = !history.canRedo }
        return (
          <button key={i} role="menuitem" disabled={disabled} onPointerEnter={() => setSub(null)} onClick={() => { close(); c.run() }}>
            <span>{label}</span>
            {c.keys && <kbd>{prettyKeys(c.keys)}</kbd>}
          </button>
        )
      })}
    </div>
  )
}

function Menus() {
  const [open, setOpen] = useState<string | null>(null)
  const bar = useRef<HTMLDivElement | null>(null)
  const history = useHistory()
  const menus = useMenus()
  useShortcuts()

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!bar.current?.contains(e.target as Node)) setOpen(null)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null)
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [open])

  const commands = open ? new Map<string, Command>(getCommands().map((c) => [c.id, c])) : new Map<string, Command>()

  return (
    <div className="menus" ref={bar} role="menubar">
      {menus.map((m) => (
        <div key={m.name} className="menu">
          <button
            role="menuitem"
            aria-haspopup="true"
            aria-expanded={open === m.name}
            className={open === m.name ? 'on' : ''}
            onClick={() => setOpen(open === m.name ? null : m.name)}
            onPointerEnter={() => open && setOpen(m.name)}
          >
            {m.name}
          </button>
          {open === m.name && <MenuList items={m.items()} commands={commands} close={() => setOpen(null)} history={history} />}
        </div>
      ))}
    </div>
  )
}

function PerfPanel({ onClose }: { onClose: () => void }) {
  const r = usePerf(400)
  const tone = (fps: number) => (fps >= 55 ? 'good' : fps >= 30 ? 'okay' : 'bad')
  return (
    <div className="perf-pop" role="dialog" aria-label="Performance" onPointerLeave={onClose}>
      <div className="perf-head">
        <div className={`perf-big ${tone(r.fps)}`}><b>{r.fps}</b><span>fps interface</span></div>
        {r.creating && <div className={`perf-big ${tone(r.createFps)}`}><b>{r.createFps}</b><span>fps Motion</span></div>}
        <div className="perf-big"><b>{r.frameMs.toFixed(1)}</b><span>ms a frame</span></div>
        <div className={`perf-big ${r.worstMs > 50 ? 'bad' : r.worstMs > 25 ? 'okay' : 'good'}`}><b>{r.worstMs.toFixed(0)}</b><span>ms slowest</span></div>
      </div>
      <h4>What is using the most</h4>
      {r.costs.length === 0 && <p className="dim small">Nothing heavy is running.</p>}
      <ul className="perf-list">
        {r.costs.slice(0, 7).map((c) => (
          <li key={c.what}>
            <div className="perf-row"><span>{c.what}</span><span className="dim small">{c.detail}</span></div>
            <div className="perf-bar"><i style={{ width: `${Math.max(3, c.weight * 100)}%` }} /></div>
            {c.tip && <p className="perf-tip">{c.tip}</p>}
          </li>
        ))}
      </ul>
      <p className="dim small perf-foot">
        {r.memoryMb !== null && <>Memory {r.memoryMb.toFixed(0)} MB. </>}
        {r.gpuMb > 0 && <>Motion uses about {r.gpuMb.toFixed(0)} MB of graphics memory. </>}
        {r.creating && (r.measured ? 'Layer times are measured on the graphics card.' : 'Layer costs are estimates; this graphics driver does not report timing.')}
      </p>
    </div>
  )
}

function Stats() {
  const status = useRico((s) => s.status)
  const output = useCreate((s) => s.output)
  const r = usePerf(1000)
  const [open, setOpen] = useState(false)
  const engine = status === 'live' ? 'Engine live' : status === 'demo' ? 'Demo' : status === 'lost' ? 'Reconnecting' : 'Starting'
  const fps = r.creating ? Math.min(r.fps, r.createFps || r.fps) : r.fps
  return (
    <div className="stats" aria-label="Status">
      <span className={`stat ${status}`} title={engine}><i /><span className="stat-text">{engine}</span></span>
      <div className="perf" onPointerEnter={() => setOpen(true)}>
        <button
          className={`stat perf-btn${fps < 30 ? ' bad' : fps < 55 ? ' low' : ''}`}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          title="What is using the most"
        >
          <span className="perf-spark" aria-hidden="true">{[0, 1, 2, 3].map((i) => <i key={i} style={{ height: `${30 + Math.min(70, (fps / 60) * 70) * ((i % 2) ? 0.8 : 1)}%` }} />)}</span>
          {fps} fps{r.creating ? <span className="stat-text"> Motion{output ? ' out' : ''}</span> : null}
        </button>
        {open && <PerfPanel onClose={() => setOpen(false)} />}
      </div>
    </div>
  )
}

function UndoRedo() {
  const h = useHistory()
  return (
    <div className="undo-redo">
      <button className="icon-btn" disabled={!h.canUndo} onClick={undo} title={h.canUndo ? `Undo ${h.undoLabel.toLowerCase()} (Ctrl+Z)` : 'Nothing to undo'} aria-label="Undo">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></svg>
      </button>
      <button className="icon-btn" disabled={!h.canRedo} onClick={redo} title={h.canRedo ? `Redo ${h.redoLabel.toLowerCase()} (Ctrl+Shift+Z)` : 'Nothing to redo'} aria-label="Redo">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m15 14 5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h3" /></svg>
      </button>
    </div>
  )
}

function AddMenu() {
  const { closed } = useWorkspaces()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])
  return (
    <div className="ws-add" ref={ref}>
      <button className="ws-tab add" title="New workspace, or reopen one you closed" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)}>+</button>
      {open && (
        <div className="menu-list ws-add-list" role="menu">
          <button role="menuitem" onClick={() => { setOpen(false); runCommand('ws.new') }}><span>New workspace...</span></button>
          <button role="menuitem" onClick={() => { setOpen(false); runCommand('ws.import') }}><span>Import a workspace...</span></button>
          <button role="menuitem" onClick={() => { setOpen(false); runCommand('project.starters') }}><span>Starter projects...</span></button>
          {customCount() > 0 && <button role="menuitem" onClick={() => { setOpen(false); runCommand('ws.clearCustom') }}><span>Delete all my workspaces...</span></button>}
          {closed.length > 0 && <hr />}
          {closed.length > 0 && <div className="menu-head">Reopen</div>}
          {closed.map((w) => (
            <button key={w.id} role="menuitem" onClick={() => { setOpen(false); goTo(w.id) }}><span>{w.name}</span></button>
          ))}
        </div>
      )}
    </div>
  )
}

function WorkspaceTabs() {
  const { list, active } = useWorkspaces()
  const [over, setOver] = useState<string | null>(null)
  return (
    <nav className="ws-tabs" aria-label="Workspaces">
      <div className="ws-tablist" role="tablist">
        {list.map((w, i) => (
          <div
            key={w.id}
            className={`ws-tab-wrap${w.id === active ? ' on' : ''}${over === w.id ? ' drop' : ''}`}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(WORKSPACE_DRAG, w.id)
              e.dataTransfer.effectAllowed = 'copyMove'
            }}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(WORKSPACE_DRAG)) return
              e.preventDefault()
              setOver(w.id)
            }}
            onDragLeave={() => setOver((o) => (o === w.id ? null : o))}
            onDrop={(e) => {
              const id = e.dataTransfer.getData(WORKSPACE_DRAG)
              setOver(null)
              if (id && id !== w.id) {
                e.preventDefault()
                moveWorkspace(id, w.id)
              }
            }}
          >
            <button
              role="tab"
              aria-selected={w.id === active}
              className={`ws-tab${w.id === active ? ' on' : ''}${w.builtIn ? '' : ' custom'}`}
              onClick={() => goTo(w.id)}
              onAuxClick={(e) => e.button === 1 && closeWorkspace(w.id)}
              title={`${w.name}${i < 9 ? ` (Ctrl+${i + 1})` : ''}. Drag to reorder, or drag into the panels below to bring this workspace in.`}
            >
              {w.name}
            </button>
            {list.length > 1 && (
              <button className="ws-close" aria-label={`Close ${w.name}`} title="Close tab (it stays under +)" onClick={() => closeWorkspace(w.id)}>
                <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 2l6 6M8 2 2 8" /></svg>
              </button>
            )}
          </div>
        ))}
      </div>
      <AddMenu />
    </nav>
  )
}

export default function TopBar() {
  usePrefs()
  return (
    <header className="topbar">
      <div className="topbar-row">
        <button className="topbar-logo" onClick={() => goTo('patch')} aria-label="RICO, go to Overview"><Logo size={17} /></button>
        <Menus />
        <button className="search" onClick={() => openOverlay('palette')} aria-label="Search commands (Ctrl+K)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
          <span className="search-text">Search anything</span><kbd>Ctrl+K</kbd>
        </button>
        <span className="grow" />
        <UndoRedo />
        <Stats />
        <button className="icon-btn" title="Settings (Ctrl+,)" aria-label="Settings" onClick={() => openOverlay('settings')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" /></svg>
        </button>
      </div>
      <WorkspaceTabs />
    </header>
  )
}
