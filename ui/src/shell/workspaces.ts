import { useSyncExternalStore } from 'react'
import type { DockviewApi, SerializedDockview } from 'dockview-react'
import { record } from './history'
import { getScript, putScript, type Script } from './scripts'
import { getLibrary, importDefs, type CustomDef } from '../nodes/custom'
import { graphTree, putGraph, type Graph } from '../nodes/store'

// Workspaces are the tabs along the top. Each one is a layout of panels you
// can rearrange, split and float. RICO comes with one per protocol, and you
// can make your own, close the ones you don't use, and share them as
// .ricospace files (scripts included).

export type Direction = 'right' | 'left' | 'below' | 'above' | 'within'
export interface Placement { panel: string; ref?: string; dir?: Direction; size?: number; active?: boolean }

export interface Workspace {
  id: string
  name: string
  builtIn: boolean
  defaults: Placement[]          // how the workspace looks before you change it
  layout?: SerializedDockview    // how you left it
  rev?: number                   // goes up when the built-in layout changes a lot, so the new one shows
}

// Built-in workspaces open with their panels as tabs, one at a time, so the
// screen stays calm. Drag a tab to split the screen, or pop it out to
// another monitor.
const tabbed = (id: string, name: string, panels: string[], rev?: number): Workspace => ({
  id, name, builtIn: true, rev,
  defaults: panels.map((panel, i) => (i === 0 ? { panel } : { panel, ref: panels[0], dir: 'within' as const })),
})

const BUILT_IN: Workspace[] = [
  tabbed('patch', 'Overview', ['welcome', 'signal-path', 'routes', 'recipes', 'messages']),
  tabbed('midi', 'MIDI', ['mappings', 'midi-studio', 'midi-controls', 'routes', 'midi-devices', 'play-midi'], 2),
  tabbed('osc', 'OSC', ['routes', 'osc-addresses', 'osc-setup', 'send-osc', 'mappings'], 2),
  tabbed('video', 'Spout', ['video-out', 'video-transports', 'video-send', 'video-receive', 'video-local']),
  tabbed('light', 'DMX / ArtNet', ['light-desk', 'dmx-grid', 'routes'], 2),
  tabbed('devices', 'Devices', ['phone', 'mqtt-topics', 'connections', 'routes'], 2),
  tabbed('audio', 'Audio', ['audio-lab', 'sound-editor', 'sound-gen', 'audio-meters', 'routes']),
  {
    id: 'create', name: 'Motion', builtIn: true, rev: 2,
    defaults: [
      { panel: 'create-preview' },
      { panel: 'create-layers', ref: 'create-preview', dir: 'left', size: 260 },
      { panel: 'create-inspector', ref: 'create-preview', dir: 'right', size: 320 },
      { panel: 'create-effects', ref: 'create-inspector', dir: 'below', size: 260 },
      // Nodes first, then the timeline in the same place, so the timeline is the tab you see.
      { panel: 'nodes-main', dir: 'below', size: 330 },
      { panel: 'timeline', ref: 'nodes-main', dir: 'within' },
    ],
  },
  {
    id: '3d', name: '3D', builtIn: true, rev: 4,
    // the view on the left, the scene and the object settings as tabs on the right
    defaults: [
      { panel: '3d-view' },
      { panel: '3d-outliner', ref: '3d-view', dir: 'right', size: 380, active: true },
      { panel: '3d-props', ref: '3d-outliner', dir: 'within' },
      { panel: '3d-symbiote', ref: '3d-outliner', dir: 'within' },
      { panel: '3d-timeline', ref: '3d-view', dir: 'below', size: 240 },
    ],
  },
  tabbed('monitor', 'Monitor', ['messages', 'send-osc', 'play-midi']),
  tabbed('mapping', 'Mapping', ['mapping', 'print', 'laser'], 2),
  tabbed('output', 'Output', ['sends', 'share', 'video-out', 'create-preview']),
]

// v2: built-in workspaces became tabbed; their old saved layouts are left behind.
const KEY_LAYOUTS = 'rico.layouts.v7'
const KEY_CUSTOM = 'rico.workspaces'
const KEY_ACTIVE = 'rico.workspace'
const KEY_HIDDEN = 'rico.workspaces.hidden'
const KEY_ORDER = 'rico.workspaces.order'

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage full or blocked; the layout just won't be remembered */
  }
}

const layouts: Record<string, SerializedDockview> = read(KEY_LAYOUTS, {})
// which version of each built-in layout was saved
const revs: Record<string, number> = read('rico.layouts.rev', {})
let custom: Workspace[] = read(KEY_CUSTOM, [])
let active: string = read(KEY_ACTIVE, 'patch')
let hidden: string[] = read(KEY_HIDDEN, [])
let order: string[] = read(KEY_ORDER, [])
let api: DockviewApi | null = null
let version = 0
const listeners = new Set<() => void>()

function emit() {
  version++
  listeners.forEach((l) => l())
}

// Every workspace in tab order, closed ones included.
export function allWorkspaces(): Workspace[] {
  const all = [...BUILT_IN.map((w) => ({ ...w, layout: (revs[w.id] ?? 1) >= (w.rev ?? 1) ? layouts[w.id] : undefined })), ...custom]
  const rank = (id: string) => {
    const i = order.indexOf(id)
    return i < 0 ? 1000 + all.findIndex((w) => w.id === id) : i
  }
  return all.sort((a, b) => rank(a.id) - rank(b.id))
}

export const visibleWorkspaces = () => allWorkspaces().filter((w) => !hidden.includes(w.id))

export function getWorkspace(id: string): Workspace | undefined {
  return allWorkspaces().find((w) => w.id === id)
}

export function useWorkspaces() {
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => version,
  )
  const list = visibleWorkspaces()
  const closed = allWorkspaces().filter((w) => hidden.includes(w.id))
  const current = list.some((w) => w.id === active) ? active : list[0]?.id ?? 'patch'
  return { list, closed, active: current }
}

export const activeWorkspace = () => active

export function goTo(id: string) {
  if (hidden.includes(id)) {
    hidden = hidden.filter((h) => h !== id)
    write(KEY_HIDDEN, hidden)
  }
  if (id === active) return emit()
  active = id
  write(KEY_ACTIVE, id)
  emit()
}

// Closing a tab only hides it. The + menu brings it back.
export function closeWorkspace(id: string, _remember = true) {
  const visible = visibleWorkspaces()
  if (visible.length <= 1) return
  const i = visible.findIndex((w) => w.id === id)
  hidden = [...hidden.filter((h) => h !== id), id]
  write(KEY_HIDDEN, hidden)
  if (active === id) {
    const next = visible[i + 1] ?? visible[i - 1]
    if (next) goTo(next.id)
  }
  emit()
  // closing a tab is not undone (open it again from +)
}

export function moveWorkspace(id: string, beforeId: string | null) {
  const ids = allWorkspaces().map((w) => w.id).filter((x) => x !== id)
  const at = beforeId ? ids.indexOf(beforeId) : ids.length
  ids.splice(at < 0 ? ids.length : at, 0, id)
  order = ids
  write(KEY_ORDER, order)
  emit()
}

export function saveLayout(id: string, layout: SerializedDockview) {
  const c = custom.find((w) => w.id === id)
  if (c) {
    c.layout = layout
    write(KEY_CUSTOM, custom)
  } else {
    layouts[id] = layout
    write(KEY_LAYOUTS, layouts)
    const def = BUILT_IN.find((w) => w.id === id)
    if (def?.rev && revs[id] !== def.rev) { revs[id] = def.rev; write('rico.layouts.rev', revs) }
  }
}

export function resetLayout(id: string) {
  const c = custom.find((w) => w.id === id)
  if (c) c.layout = undefined
  else delete layouts[id]
  write(KEY_LAYOUTS, layouts)
  write(KEY_CUSTOM, custom)
  emit()
}

// A tidy first layout for a list of panels: two columns, then stacked.
export function arrange(panels: string[]): Placement[] {
  return panels.map((panel, i) => {
    if (i === 0) return { panel }
    if (i === 1) return { panel, ref: panels[0], dir: 'right' }
    if (i === 2) return { panel, ref: panels[0], dir: 'below' }
    if (i === 3) return { panel, ref: panels[1], dir: 'below' }
    return { panel, ref: panels[i % 4], dir: 'within' }
  })
}

let counter = 0
const newId = () => `ws-${Date.now().toString(36)}${counter++}`

export function newWorkspace(name: string, opts: { from?: Workspace; panels?: string[] } = {}): string {
  const id = newId()
  const { from, panels } = opts
  const layout = from ? (api && from.id === active ? api.toJSON() : from.layout) : undefined
  custom.push({ id, name, builtIn: false, defaults: panels ? arrange(panels) : from?.defaults ?? [], layout })
  write(KEY_CUSTOM, custom)
  goTo(id)
  record({ label: `New workspace ${name}`, undo: () => deleteWorkspace(id, false), redo: () => { custom.push({ id, name, builtIn: false, defaults: panels ? arrange(panels) : from?.defaults ?? [], layout }); write(KEY_CUSTOM, custom); goTo(id) } })
  return id
}

export function renameWorkspace(id: string, name: string) {
  const c = custom.find((w) => w.id === id)
  if (!c) return
  const before = c.name
  c.name = name
  write(KEY_CUSTOM, custom)
  emit()
  record({ label: 'Rename workspace', undo: () => renameRaw(id, before), redo: () => renameRaw(id, name) })
}
function renameRaw(id: string, name: string) {
  const c = custom.find((w) => w.id === id)
  if (c) c.name = name
  write(KEY_CUSTOM, custom)
  emit()
}

export function deleteWorkspace(id: string, remember = true) {
  const gone = custom.find((w) => w.id === id)
  if (!gone) return
  const index = custom.indexOf(gone)
  if (active === id && api) gone.layout = api.toJSON()
  custom = custom.filter((w) => w.id !== id)
  write(KEY_CUSTOM, custom)
  if (active === id) {
    const next = visibleWorkspaces()[0]
    goTo(next?.id ?? 'patch')
  }
  emit()
  if (remember) record({
    label: `Delete ${gone.name}`,
    undo: () => { custom.splice(index, 0, gone); write(KEY_CUSTOM, custom); goTo(id) },
    redo: () => deleteWorkspace(id, false),
  })
}

// Removes every workspace you made. Built-in ones stay. Can be undone.
export function deleteAllCustom() {
  if (!custom.length) return
  const gone = custom
  if (api && custom.some((w) => w.id === active)) {
    const c = custom.find((w) => w.id === active)
    if (c) c.layout = api.toJSON()
  }
  const wasActive = active
  custom = []
  write(KEY_CUSTOM, custom)
  if (gone.some((w) => w.id === wasActive)) goTo(visibleWorkspaces()[0]?.id ?? 'patch')
  emit()
  record({
    label: `Delete ${gone.length} workspace${gone.length > 1 ? 's' : ''}`,
    undo: () => { custom = [...gone]; write(KEY_CUSTOM, custom); emit() },
    redo: () => deleteAllCustom(),
  })
}

export const customCount = () => custom.length

// Your own workspaces, with the layout on screen right now, for project files.
export function customWorkspaces(): Workspace[] {
  return custom.map((w) => (w.id === active && api ? { ...w, layout: api.toJSON() } : w))
}

// ---- sharing ---------------------------------------------------------------

export interface WorkspaceFile {
  rico: 'workspace'
  version: 1
  name: string
  layout: SerializedDockview
  scripts?: Script[]
  graphs?: Graph[]
  nodelib?: CustomDef[]
}

function scriptsIn(layout: SerializedDockview): Script[] {
  const ids = new Set<string>()
  for (const p of Object.values(layout.panels ?? {})) {
    const s = (p as { params?: { script?: string } }).params?.script
    if (s) ids.add(s)
  }
  return [...ids].map(getScript).filter((s): s is Script => Boolean(s))
}

function graphsIn(layout: SerializedDockview): Graph[] {
  const ids = new Set<string>()
  for (const p of Object.values(layout.panels ?? {})) {
    const g = (p as { params?: { graph?: string } }).params?.graph
    if (g) ids.add(g)
  }
  return [...ids].flatMap((id) => graphTree(id))
}

// The saved nodes these networks use.
function defsIn(list: Graph[]): CustomDef[] {
  const used = new Set(list.flatMap((g) => g.nodes.filter((n) => n.type.startsWith('custom:')).map((n) => n.type.slice(7))))
  return getLibrary().filter((d) => used.has(d.id))
}

export function exportWorkspace(id: string): WorkspaceFile | null {
  const w = getWorkspace(id)
  if (!w) return null
  const layout = id === active && api ? api.toJSON() : w.layout
  if (!layout) return null
  const graphs = graphsIn(layout)
  return { rico: 'workspace', version: 1, name: w.name, layout, scripts: scriptsIn(layout), graphs, nodelib: defsIn(graphs) }
}

export function importWorkspace(file: unknown): string | null {
  const f = file as Partial<WorkspaceFile>
  if (!f || f.rico !== 'workspace' || !f.layout) return null
  if (Array.isArray(f.nodelib)) importDefs(f.nodelib)
  for (const g of f.graphs ?? []) if (g && g.id && Array.isArray(g.nodes)) putGraph(g)
  for (const s of f.scripts ?? []) if (s && s.id && typeof s.code === 'string') putScript({ id: s.id, name: String(s.name ?? 'Script'), code: s.code })
  const id = newId()
  custom.push({ id, name: String(f.name ?? 'Imported'), builtIn: false, defaults: [], layout: f.layout })
  write(KEY_CUSTOM, custom)
  goTo(id)
  return id
}

// ---- the live dock ---------------------------------------------------------

export function setDockApi(a: DockviewApi | null) {
  api = a
}

export function dockApi() {
  return api
}

// The panels a workspace holds, for bringing them into another one.
export function panelsOf(id: string): string[] {
  const w = getWorkspace(id)
  if (!w) return []
  const layout = id === active && api ? api.toJSON() : w.layout
  if (layout?.panels) return Object.keys(layout.panels)
  return w.defaults.map((d) => d.panel)
}
