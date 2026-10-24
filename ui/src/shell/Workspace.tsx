import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  DockviewReact, type AddPanelOptions, type DockviewApi, type DockviewDidDropEvent, type DockviewGroupPanel,
  type DockviewReadyEvent, type DockviewTheme, type IDockviewHeaderActionsProps, type Position,
} from 'dockview-react'
import { toast } from '../components/Toasts'
import { dockComponents, panelById } from './panels'
import PanelPicker, { PANEL_DRAG, resolvePick } from './PanelPicker'
import { getScript } from './scripts'
import { getGraph } from '../nodes/store'
import {
  arrange, getWorkspace, panelsOf, saveLayout, setDockApi, type Placement, type Workspace as WorkspaceDef,
} from './workspaces'

export const WORKSPACE_DRAG = 'application/x-rico-workspace'

const theme: DockviewTheme = {
  name: 'rico',
  className: 'dockview-theme-rico',
  colorScheme: 'dark',
  gap: 0,
  dndOverlayMounting: 'absolute',
}

// What dockview needs to make a panel from its id.
function spec(id: string): { component: string; title: string; params?: Record<string, unknown> } | null {
  if (id.startsWith('nodes-')) {
    const g = getGraph(id.slice(6))
    return { component: 'nodes', title: g?.name ?? 'Nodes', params: { graph: id.slice(6) } }
  }
  if (id.startsWith('script-')) {
    const s = getScript(id.slice(7))
    return { component: 'script', title: s?.name ?? 'Script', params: { script: id.slice(7) } }
  }
  const def = panelById(id)
  return def ? { component: id, title: def.title } : null
}

function place(api: DockviewApi, p: Placement, fallback?: AddPanelOptions['position']) {
  const s = spec(p.panel)
  if (!s || api.getPanel(p.panel)) return
  const position: AddPanelOptions['position'] | undefined =
    p.ref && api.getPanel(p.ref) ? { referencePanel: p.ref, direction: p.dir ?? 'right' } : !p.ref && p.dir && p.dir !== 'within' ? { direction: p.dir } : fallback
  const panel = api.addPanel({ id: p.panel, ...s, ...(position ? { position } : {}) })
  if (p.size) {
    if (p.dir === 'left' || p.dir === 'right') panel.group.api.setSize({ width: p.size })
    else if (p.dir === 'below' || p.dir === 'above') panel.group.api.setSize({ height: p.size })
  }
}

export function buildDefaults(api: DockviewApi, ws: WorkspaceDef) {
  api.clear()
  for (const p of ws.defaults) place(api, p)
  // Show the first tab, not the last one added.
  const first = ws.defaults[0]?.panel
  // a tab that should be the one you see in its group
  for (const p of ws.defaults) if (p.active) api.getPanel(p.panel)?.api.setActive()
  if (first) api.getPanel(first)?.api.setActive()
}

// Moves a group of panels into its own window, to drag onto another screen.
// Closing that window brings the panels back.
export function popOut(api: DockviewApi, group: DockviewGroupPanel) {
  api.addPopoutGroup(group, {
    popoutUrl: './popout.html',
    onDidOpen: ({ window: w }) => {
      // Same colors, text size and fonts as the main window.
      w.document.documentElement.style.cssText = document.documentElement.style.cssText
      w.document.body.className = document.body.className
      w.document.title = `RICO: ${group.activePanel?.title ?? 'panel'}`
    },
  }).then((ok) => {
    if (!ok) toast('The window was blocked. Allow pop-ups for RICO and try again.')
  })
}

const DIR: Record<Position, 'left' | 'right' | 'above' | 'below' | 'within'> = {
  left: 'left', right: 'right', top: 'above', bottom: 'below', center: 'within',
}

// Adds a panel to the workspace on screen, or shows it if it's already there.
export function openPanel(api: DockviewApi, id: string, where?: { group?: DockviewGroupPanel; position?: Position }) {
  const existing = api.getPanel(id)
  if (existing) {
    existing.api.setActive()
    return
  }
  const active = api.activePanel
  const position: AddPanelOptions['position'] | undefined = where?.group
    ? { referenceGroup: where.group, direction: DIR[where.position ?? 'center'] }
    : active ? { referencePanel: active.id, direction: 'right' } : undefined
  place(api, { panel: id }, position)
}

// Brings every panel of another workspace into this one, keeping how they
// were arranged there. This is how you put MIDI, OSC and Audio side by side.
export function mergeWorkspace(api: DockviewApi, fromId: string, where?: { group?: DockviewGroupPanel; position?: Position }) {
  const from = getWorkspace(fromId)
  if (!from) return
  const panels = panelsOf(fromId)
  const fresh = panels.filter((p) => !api.getPanel(p))
  if (!fresh.length) return toast(`Everything from ${from.name} is already here.`)
  const plan = from.defaults.length && panels.every((p) => from.defaults.some((d) => d.panel === p)) ? from.defaults : arrange(panels)
  const first = plan.find((p) => !api.getPanel(p.panel))
  for (const p of plan) {
    if (api.getPanel(p.panel)) continue
    if (p === first) openPanel(api, p.panel, where)
    else place(api, p, first ? { referencePanel: first.panel, direction: 'within' } : undefined)
  }
  toast(`${from.name} added to this workspace.`, true)
}

// undo for layout changes

const live = { id: '', snapshot: '', applying: false }

let apiRef: DockviewApi | null = null

// The "+" at the end of each panel group's tabs.
function AddToGroup(props: IDockviewHeaderActionsProps) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  const button = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (!at) return
    const close = (e: PointerEvent) => {
      if (!(e.target as Element).closest?.('.picker-pop') && e.target !== button.current) setAt(null)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setAt(null)
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [at])
  const floating = props.location?.type === 'popout'
  return (
    <div className="group-actions">
      {!floating && (
        <button className="group-add" title="Open these panels in their own window, to put on another screen" aria-label="Pop out to a window"
          onClick={() => popOut(props.containerApi, props.group)}>⧉</button>
      )}
      {floating && (
        <button className="group-add" title="Back into the main window" aria-label="Back into the main window"
          onClick={(e) => e.currentTarget.ownerDocument.defaultView?.close()}>⇱</button>
      )}
      <button
        ref={button}
        className="group-add"
        title="Add a panel here"
        aria-label="Add a panel here"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setAt(at ? null : { x: Math.min(r.right - 10, window.innerWidth - 380), y: r.bottom + 4 })
        }}
      >+</button>
      {at && createPortal(
        <div className="picker-pop" style={{ left: Math.max(8, at.x), top: at.y }}>
          <PanelPicker compact autoFocus onPick={(pick) => {
            setAt(null)
            openPanel(props.containerApi, resolvePick(pick), { group: props.group, position: 'center' })
          }} />
        </div>,
        document.body,
      )}
    </div>
  )
}

function Empty() {
  return (
    <div className="dock-empty">
      <div className="dock-empty-head">
        <h2>Build this workspace</h2>
        <p className="muted">Click a panel to add it, or drag it where you want it. Drag a workspace tab from the top bar here to bring all of its panels in. Scripts add protocols RICO does not have yet.</p>
      </div>
      <PanelPicker onPick={(pick) => { if (apiRef) openPanel(apiRef, resolvePick(pick)) }} />
    </div>
  )
}

export default function Workspace({ id }: { id: string }) {
  const onReady = (e: DockviewReadyEvent) => {
    const ws = getWorkspace(id)
    if (!ws) return
    const api = e.api
    setDockApi(api)
    apiRef = api
    let restored = false
    if (ws.layout) {
      try {
        api.fromJSON(ws.layout)
        restored = true
      } catch {
        restored = false
      }
    }
    if (!restored) buildDefaults(api, ws)
    live.id = id
    live.snapshot = JSON.stringify(api.toJSON())

    let timer = 0
    api.onDidLayoutChange(() => {
      if (live.applying) return
      const now = api.toJSON()
      saveLayout(id, now)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        if (live.id !== id) return
        const next = JSON.stringify(api.toJSON())
        const prev = live.snapshot
        if (next === prev) return
        live.snapshot = next
        // Panels and tabs are not undone: Ctrl+Z is only for your work
        // (adding, deleting, moving things, changing numbers). The layout is
        // still saved, and Window > Reset puts a workspace back.
      }, 450)
    })

    // Things dragged in from outside the dock: panels from the library and
    // whole workspaces from the tabs.
    api.onUnhandledDragOver((ev) => {
      const types = ev.nativeEvent instanceof DragEvent ? ev.nativeEvent.dataTransfer?.types ?? [] : []
      if (types.includes(PANEL_DRAG) || types.includes(WORKSPACE_DRAG)) ev.accept()
    })
  }

  const onDidDrop = (e: DockviewDidDropEvent) => {
    const dt = e.nativeEvent instanceof DragEvent ? e.nativeEvent.dataTransfer : null
    if (!dt) return
    const ws = dt.getData(WORKSPACE_DRAG)
    const pick = dt.getData(PANEL_DRAG)
    const where = { group: e.group, position: e.position }
    if (ws && ws !== id) mergeWorkspace(e.api, ws, where)
    else if (pick) openPanel(e.api, resolvePick(pick), where)
  }

  useEffect(() => () => {
    if (live.id === id) live.id = ''
  }, [id])

  return (
    <div className="workspace">
      <DockviewReact
        key={id}
        className="dock"
        theme={theme}
        components={dockComponents}
        onReady={onReady}
        onDidDrop={onDidDrop}
        rightHeaderActionsComponent={AddToGroup}
        watermarkComponent={Empty}
      />
    </div>
  )
}

