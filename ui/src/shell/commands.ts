import { toast } from '../components/Toasts'
import { rico } from '../engine/connection'
import { LAYER_TYPES } from '../create/layers'
import { getCreate, setOutput } from '../create/store'
import { addLayer, exportScene, importScene } from '../sections/Create'
import { setPrefs, initialPrefs, THEMES } from '../prefs'
import { redo, undo } from './history'
import { PANELS } from './panels'
import { askText, askYesNo, downloadJson, openOverlay, pickFile } from './ui'
import { openPanel, buildDefaults, mergeWorkspace } from './Workspace'
import { keyLabel } from './shortcuts'
import { aeCommands } from './aeCommands'
import { openOutput } from './outputs'
import { openProjectFile, saveProject } from './projects'
import { TEMPLATES, getScriptList, newScript } from './scripts'
import { getGraphs, newGraph } from '../nodes/store'
import {
  allWorkspaces, closeWorkspace, customCount, deleteAllCustom, deleteWorkspace, dockApi, exportWorkspace, getWorkspace, goTo, importWorkspace,
  newWorkspace, renameWorkspace, resetLayout, useWorkspaces,
} from './workspaces'

// Everything you can do in RICO, by name. The menus and the command search
// (Ctrl+K) both read from here, so they always match.

export interface Command {
  id: string
  label: string
  group: string
  keys?: string
  run: () => void
  enabled?: () => boolean
  scope?: string    // only where this panel kind has the keys, like 'create'
}

let activeWorkspace = 'patch'
export function setActiveForCommands(id: string) {
  activeWorkspace = id
}

const state = () => rico.get().state

async function send(op: string, args: Record<string, unknown> = {}, ok?: string) {
  const ack = await rico.send(op, args)
  if (!ack.ok) toast(ack.error ?? 'That did not work.')
  else if (ok) toast(ok, true)
}

export function newWorkspaceAsk() {
  openOverlay('new-workspace')
}

export function duplicateWorkspace() {
  const ws = getWorkspace(activeWorkspace)
  if (!ws) return
  openOverlay(null)
  newWorkspace(`${ws.name} copy`, { from: ws })
}

export function exportCurrentWorkspace() {
  const f = exportWorkspace(activeWorkspace)
  if (!f) return toast('Arrange some panels first, then export.')
  downloadJson(`${f.name.replace(/[^\w -]/g, '') || 'workspace'}.ricospace`, f)
}

export function importWorkspaceAsk() {
  pickFile('.ricospace,.ricoscript,.json', (file) => {
    file.text().then((t) => {
      const data = JSON.parse(t)
      if (data?.rico === 'script' && typeof data.code === 'string') {
        const s = newScript(String(data.name ?? 'Script'), data.code)
        const api = dockApi()
        if (api) openPanel(api, `script-${s.id}`)
        return toast('Script added to this workspace.', true)
      }
      const id = importWorkspace(data)
      if (!id) toast('That file is not a RICO workspace.')
      else toast('Workspace added.', true)
    }).catch(() => toast('That file is not a RICO workspace.'))
  })
}

export function resetCurrentLayout() {
  const ws = getWorkspace(activeWorkspace)
  const api = dockApi()
  resetLayout(activeWorkspace)
  if (ws && api) buildDefaults(api, ws)
}

export function getCommands(): Command[] {
  const s = state()
  const prefs = initialPrefs()
  const list: Command[] = []

  // Go places
  allWorkspaces().forEach((w, i) => list.push({
    id: `go.${w.id}`, label: `Go to ${w.name}`, group: 'Workspaces', keys: i < 9 ? `Ctrl+${i + 1}` : undefined, run: () => goTo(w.id),
  }))
  allWorkspaces().filter((w) => w.id !== activeWorkspace).forEach((w) => list.push({
    id: `merge.${w.id}`, label: `Bring ${w.name} into this workspace`, group: 'Workspace', run: () => { const api = dockApi(); if (api) mergeWorkspace(api, w.id) },
  }))
  for (const p of PANELS) {
    list.push({ id: `panel.${p.id}`, label: `Open panel: ${p.title}`, group: `Window: ${p.group}`, run: () => { const api = dockApi(); if (api) openPanel(api, p.id) } })
  }
  for (const t of TEMPLATES) {
    list.push({ id: `script.${t.id}`, label: `New script: ${t.name}`, group: 'Scripts', run: () => {
      const s = newScript(t.id === 'blank' ? 'My script' : t.name, t.code)
      const api = dockApi()
      if (api) openPanel(api, `script-${s.id}`)
    } })
  }
  for (const s of getScriptList()) {
    list.push({ id: `open-script.${s.id}`, label: `Open script: ${s.name}`, group: 'Scripts', run: () => { const api = dockApi(); if (api) openPanel(api, `script-${s.id}`) } })
  }
  list.push({ id: 'nodes.new', label: 'New node network', group: 'Nodes', run: () => { const g = newGraph('Node network'); const api = dockApi(); if (api) openPanel(api, `nodes-${g.id}`) } })
  for (const g of getGraphs().filter((x) => !x.inside)) {
    list.push({ id: `open-nodes.${g.id}`, label: `Open nodes: ${g.name}`, group: 'Nodes', run: () => { const api = dockApi(); if (api) openPanel(api, `nodes-${g.id}`) } })
  }
  list.push({ id: 'output.new', label: 'Open an output window (projector, second screen)', group: 'Output', run: () => openOutput() })
  list.push({ id: 'project.starters', label: 'Starter projects...', group: 'Project', run: () => openOverlay('starters') })
  list.push({ id: 'project.save', label: 'Save the whole project (.ricoproject)', group: 'Project', run: () => saveProject() })
  list.push({ id: 'project.open', label: 'Open a project...', group: 'Project', run: () => openProjectFile() })
  list.push({ id: 'palette', label: 'Search commands', group: 'RICO', run: () => openOverlay('palette') })

  // Edit
  list.push({ id: 'undo', label: 'Undo', group: 'Edit', keys: 'Ctrl+Z', run: undo })
  list.push({ id: 'redo', label: 'Redo', group: 'Edit', keys: 'Ctrl+Shift+Z', run: redo })

  // Workspaces
  list.push({ id: 'ws.new', label: 'New workspace', group: 'Workspace', run: newWorkspaceAsk })
  list.push({ id: 'ws.dup', label: 'Duplicate this workspace', group: 'Workspace', run: duplicateWorkspace })
  list.push({ id: 'ws.export', label: 'Export this workspace (.ricospace)', group: 'Workspace', run: exportCurrentWorkspace })
  list.push({ id: 'ws.import', label: 'Import a workspace', group: 'Workspace', run: importWorkspaceAsk })
  list.push({ id: 'ws.reset', label: 'Reset this layout', group: 'Workspace', run: resetCurrentLayout })
  if (customCount() > 0) list.push({ id: 'ws.clearCustom', label: 'Delete all my workspaces...', group: 'Workspace', run: async () => {
    const n = customCount()
    if (await askYesNo(`Delete all ${n} of your workspaces?`, 'The built-in ones stay. Scripts stay in the panel library. You can undo this.', 'Delete all', true)) deleteAllCustom()
  } })
  list.push({ id: 'ws.close', label: 'Close this workspace tab', group: 'Workspace', run: () => closeWorkspace(activeWorkspace) })
  const current = getWorkspace(activeWorkspace)
  if (current && !current.builtIn) {
    list.push({ id: 'ws.rename', label: 'Rename this workspace', group: 'Workspace', run: async () => {
      const name = await askText('Rename workspace', 'Name', current.name, 'Rename')
      if (name) renameWorkspace(current.id, name)
    } })
    list.push({ id: 'ws.delete', label: 'Delete this workspace', group: 'Workspace', run: async () => {
      if (await askYesNo(`Delete ${current.name}?`, 'Its layout is removed. Scripts in it stay in the panel library. You can undo this.', 'Delete', true)) deleteWorkspace(current.id)
    } })
  }

  // Create
  for (const t of LAYER_TYPES) list.push({ id: `layer.${t.id}`, label: `Add layer: ${t.name}`, group: 'Motion', run: () => { goTo('create'); addLayer(t.id) } })
  list.push({ id: 'create.output', label: getCreate().output ? 'Stop sending Motion to video' : 'Send Motion to video', group: 'Motion', run: () => setOutput(!getCreate().output) })
  list.push({ id: 'create.save', label: 'Save scene as a file', group: 'Motion', keys: 'Ctrl+S', run: () => exportScene(getCreate().scene) })
  list.push({ id: 'create.open', label: 'Open a scene file', group: 'Motion', keys: 'Ctrl+O', run: () => pickFile('.json', importScene) })

  list.push(...aeCommands())

  // Protocols
  if (s) {
    list.push({ id: 'midi.port', label: 'Make a virtual MIDI port', group: 'MIDI', run: async () => {
      const name = await askText('New virtual MIDI port', 'Port name', 'RICO Port', 'Make port')
      if (name) send('midi.virtual.create', { name }, `"${name}" is ready.`)
    } })
    list.push({ id: 'midi.scan', label: 'Look for MIDI devices again', group: 'MIDI', run: () => send('midi.scan') })
    list.push({ id: 'midi.thru', label: s.midi.thru ? 'Turn MIDI thru off' : 'Turn MIDI thru on', group: 'MIDI', run: () => send('midi.thru', { on: !s.midi.thru }) })
    list.push({ id: 'osc.toggle', label: s.osc.sendToOSC ? 'Stop sending OSC' : 'Start sending OSC', group: 'OSC', run: () => send('osc.enabled', { on: !s.osc.sendToOSC }) })
    list.push({ id: 'video.toggle', label: s.video.sending ? 'Stop sending network video' : 'Start sending network video', group: 'Video', run: () => send(s.video.sending ? 'video.stop' : 'video.start') })
    list.push({ id: 'video.scan', label: 'Find network video sources', group: 'Video', run: () => { goTo('video'); send('video.scan') } })
    list.push({ id: 'spout.toggle', label: s.video.spout.sending ? 'Stop Spout' : 'Start Spout', group: 'Video', run: () => send(s.video.spout.sending ? 'spout.stop' : 'spout.start', { name: s.video.spout.name || 'RICO' }) })
    list.push({ id: 'audio.toggle', label: s.audio.capturing ? 'Stop listening to audio' : 'Listen to audio', group: 'Audio', run: () => send(s.audio.capturing ? 'audio.stop' : 'audio.start') })
    list.push({ id: 'dmx.toggle', label: s.dmx.running ? 'Stop Art-Net' : 'Start Art-Net', group: 'Light', run: () => send(s.dmx.running ? 'dmx.stop' : 'dmx.start') })
  }

  // View
  list.push({ id: 'view.bigger', label: 'Bigger text', group: 'View', keys: 'Ctrl+=', run: () => setPrefs({ scale: Math.min(1.6, +(prefs.scale + 0.1).toFixed(2)) }) })
  list.push({ id: 'view.smaller', label: 'Smaller text', group: 'View', keys: 'Ctrl+-', run: () => setPrefs({ scale: Math.max(0.8, +(prefs.scale - 0.1).toFixed(2)) }) })
  list.push({ id: 'view.lines', label: prefs.scanlines ? 'Hide screen lines' : 'Show screen lines', group: 'View', run: () => setPrefs({ scanlines: !prefs.scanlines }) })
  list.push({ id: 'view.calm', label: prefs.calm ? 'Allow motion' : 'Less motion', group: 'View', run: () => setPrefs({ calm: !prefs.calm }) })
  for (const t of THEMES) list.push({ id: `theme.${t.id}`, label: `Colors: ${t.name}`, group: 'View', run: () => setPrefs({ theme: t.id }) })
  list.push({ id: 'theme.custom', label: 'Colors: your own', group: 'View', run: () => { setPrefs({ theme: 'custom' }); openOverlay('settings') } })
  list.push({ id: 'view.full', label: 'Full screen', group: 'View', keys: 'F11', run: () => {
    if (document.fullscreenElement) document.exitFullscreen()
    else document.documentElement.requestFullscreen().catch(() => toast('Full screen is not allowed here.'))
  } })

  // App
  list.push({ id: 'app.settings', label: 'Settings', group: 'RICO', keys: 'Ctrl+,', run: () => openOverlay('settings') })
  list.push({ id: 'app.keys', label: 'Keyboard and control shortcuts', group: 'RICO', run: () => openOverlay('shortcuts') })
  list.push({ id: 'help.tour', label: 'Take the tour', group: 'Help', run: () => { void import('./Tour').then((m) => m.startTour()) } })
  list.push({ id: 'help.welcome', label: 'Welcome: what RICO does', group: 'Help', run: () => { goTo('patch'); window.setTimeout(() => { const api = dockApi(); if (api) openPanel(api, 'welcome') }, 150) } })
  list.push({ id: 'help.testing', label: 'How to test RICO', group: 'Help', run: () => rico.send('app.openUrl', { url: 'https://github.com/mayakhalil-cmd/RICO/blob/main/docs/TESTING.md' }) })
  list.push({ id: 'help.scripts', label: 'Writing scripts', group: 'Help', run: () => rico.send('app.openUrl', { url: 'https://github.com/mayakhalil-cmd/RICO/blob/main/docs/SCRIPTS.md' }) })
  list.push({ id: 'help.source', label: 'Source code', group: 'Help', run: () => rico.send('app.openUrl', { url: 'https://github.com/mayakhalil-cmd/RICO' }) })
  list.push({ id: 'app.data', label: 'Open the data folder', group: 'RICO', run: () => send('app.openDataFolder') })
  list.push({ id: 'app.save', label: 'Save settings now', group: 'RICO', run: () => send('app.save', {}, 'Saved.') })
  list.push({ id: 'app.classic', label: 'Restart in the classic interface', group: 'RICO', run: async () => {
    if (await askYesNo('Restart in the classic interface?', 'RICO closes this window and opens the original one.', 'Restart')) send('app.classic')
  } })
  list.push({ id: 'app.about', label: 'About RICO', group: 'RICO', run: () => openOverlay('about') })
  // Shortcut keys come from the shortcut settings, so menus show your own.
  for (const c of list) c.keys = keyLabel(c.id) ?? (c.id.startsWith('go.') ? c.keys : undefined)
  return list
}

export function runCommand(id: string) {
  getCommands().find((c) => c.id === id)?.run()
}

export { useWorkspaces }
