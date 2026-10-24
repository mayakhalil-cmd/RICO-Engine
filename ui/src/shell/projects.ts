import { toast } from '../components/Toasts'
import { getRootScene, applyRemoteScene } from '../create/store'
import { STARTERS, repair, type Scene } from '../create/scene'
import { addRoute, getRoutes, newTarget, setAllRoutes, type Route } from '../engine/routes'
import { getLibrary, importDefs, type CustomDef } from '../nodes/custom'
import { getGraphs, makeNode, setAllGraphs, wire, type Graph } from '../nodes/store'
import { record } from './history'
import { TEMPLATES, getScriptList, newScript, putScript, type Script } from './scripts'
import { askYesNo, downloadJson, pickFile } from './ui'
import { customWorkspaces, importWorkspace, newWorkspace, type Workspace } from './workspaces'

// A project is everything at once: the Create scene with its timeline, your
// routes, node networks, scripts, the 3D scene and your own workspaces. Save
// it as one .ricoproject file and open it on any computer with RICO.

export interface ProjectFile {
  rico: 'project'
  version: 1
  name: string
  scene: Scene
  routes: Route[]
  graphs: Graph[]
  scripts: Script[]
  world?: unknown
  workspaces: Workspace[]
  nodelib?: CustomDef[]   // your saved nodes
}

async function world3d() {
  try {
    const m = await import('../three/world')
    return m
  } catch {
    return null
  }
}

export async function buildProject(): Promise<ProjectFile> {
  const w = await world3d()
  return {
    rico: 'project', version: 1, name: getRootScene().name,
    scene: getRootScene(),
    routes: getRoutes(),
    graphs: getGraphs(),
    scripts: getScriptList(),
    world: w?.getWorld(),
    workspaces: customWorkspaces(),
    nodelib: getLibrary(),
  }
}

export async function saveProject() {
  const p = await buildProject()
  downloadJson(`${p.name.replace(/[^\w -]/g, '') || 'project'}.ricoproject`, p)
  toast('Project saved. Video files used in it are not inside; keep them next to it.', true)
}

// Opens a project. Scene, routes, node networks and the 3D scene are
// replaced (one undo step brings yours back); scripts and workspaces are added.
export async function applyProject(p: Partial<ProjectFile>) {
  const w = await world3d()
  const before = { scene: getRootScene(), routes: getRoutes(), graphs: getGraphs(), world: w?.getWorld() }
  const scene = p.scene ? repair(p.scene) : null
  const after = {
    scene: scene ?? before.scene,
    routes: Array.isArray(p.routes) ? p.routes : before.routes,
    graphs: Array.isArray(p.graphs) ? p.graphs : before.graphs,
    world: p.world && w ? (p.world as typeof before.world) : before.world,
  }
  const set = (x: typeof before) => {
    applyRemoteScene(x.scene)
    setAllRoutes(x.routes)
    setAllGraphs(x.graphs)
    if (w && x.world) w.replaceWorld(x.world)
  }
  set(after)
  record({ label: `Open ${p.name ?? 'project'}`, undo: () => set(before), redo: () => set(after) })
  if (Array.isArray(p.nodelib)) importDefs(p.nodelib)
  for (const s of p.scripts ?? []) if (s?.id && typeof s.code === 'string') putScript(s)
  let last: string | null = null
  for (const ws of p.workspaces ?? []) {
    if (!ws?.layout && !ws?.defaults?.length) continue
    if (ws.layout) last = importWorkspace({ rico: 'workspace', version: 1, name: ws.name, layout: ws.layout })
    else last = newWorkspace(ws.name, { panels: ws.defaults.map((d) => d.panel) })
  }
  void last
}

export function openProjectFile() {
  pickFile('.ricoproject,.json', (f) => {
    f.text().then(async (t) => {
      const data = JSON.parse(t)
      if (data?.rico !== 'project') return toast('That is not a RICO project.')
      if (await askYesNo(`Open ${data.name ?? 'this project'}?`, 'Your Motion scene, routes, node networks and 3D scene are swapped for the project\'s. Undo brings yours back.', 'Open')) {
        await applyProject(data)
        toast(`${data.name ?? 'Project'} is open.`, true)
      }
    }).catch(() => toast('That is not a RICO project.'))
  })
}

// ---- starter projects ---------------------------------------------------------------

export interface Starter {
  id: string
  name: string
  about: string
  sets: string[]          // what it sets up, in a few words each
  start: () => Promise<void>
}

const graph = (name: string, build: (g: Graph) => void): Graph => {
  const g: Graph = { id: Math.random().toString(36).slice(2, 9), name, enabled: true, nodes: [], wires: [] }
  build(g)
  return g
}

async function startWith(name: string, scene: Scene | null, panels: string[], extra: {
  routes?: Route[]; graphs?: Graph[]; world?: 'starter'
} = {}) {
  const w = extra.world ? await world3d() : null
  await applyProject({
    name,
    scene: scene ?? getRootScene(),
    routes: extra.routes ? [...getRoutes(), ...extra.routes] : undefined,
    graphs: extra.graphs ? [...getGraphs(), ...extra.graphs] : undefined,
    world: w ? w.starterWorld() : undefined,
  })
  newWorkspace(name, { panels })
}

function route(name: string, source: string, targets: Partial<Route['targets'][number]>[]): Route {
  return {
    id: Math.random().toString(36).slice(2, 9), name, source, enabled: true, smooth: 0.2, invert: false,
    targets: targets.map((t) => ({ ...newTarget(t.kind ?? 'osc'), ...t })),
  }
}

export const STARTER_PROJECTS: Starter[] = [
  {
    id: 'visuals', name: 'Audio visuals', about: 'Iridescent glass and blobs that move with whatever your computer plays. Send them to OBS, Resolume or TouchDesigner.',
    sets: ['Glass and blobs scene', 'Kick flash nodes', 'Audio meters next to the preview'],
    start: async () => {
      const g = graph('Beat', (g) => {
        const a = makeNode('signal', 40, 40, { signal: 'audio:kick' }), b = makeNode('envelope', 300, 40, { release: 0.25 })
        const c = makeNode('create', 560, 40, { target: 'master.chroma' }), d = makeNode('map', 300, 220, { outMin: 0.1, outMax: 0.9 })
        g.nodes = [a, b, c, d]
        g.wires = [wire(a.id, 'out', b.id, 'in'), wire(b.id, 'out', d.id, 'in'), wire(d.id, 'out', c.id, 'in')]
      })
      await startWith('Audio visuals', STARTERS[0].make(), ['create-preview', 'audio-meters', `nodes-${g.id}`, 'create-inspector'], { graphs: [g] })
    },
  },
  {
    id: 'unreal', name: 'MIDI to a game engine', about: 'A controller drives lights, fog and the camera in Unreal or Unity over OSC, and a DMX light at the same time.',
    sets: ['3 routes to OSC port 8000', 'One knob also on DMX channel 1', 'Controls, routes and messages side by side'],
    start: async () => {
      const routes = [
        route('Mod wheel', 'midi:1:1:1', [{ kind: 'osc', address: '/game/fog/density' }, { kind: 'dmx', channel: 1 }]),
        route('Cutoff knob', 'midi:1:1:74', [{ kind: 'osc', address: '/game/light/intensity' }]),
        route('Resonance knob', 'midi:1:1:71', [{ kind: 'osc', address: '/game/camera/fov', min: 30, max: 110 }]),
      ]
      await startWith('Game engine', null, ['midi-controls', 'routes', 'messages', 'osc-setup'], { routes })
    },
  },
  {
    id: 'leds', name: 'LED strip from audio', about: 'A Pi Pico or Arduino on USB lights up with the bass. The script shows exactly what it sends.',
    sets: ['Serial LEDs script', 'Audio meters'],
    start: async () => {
      const t = TEMPLATES.find((x) => x.id === 'serial')!
      const s = newScript('Serial LEDs', t.code)
      await startWith('LED strip', null, ['audio-meters', `script-${s.id}`])
    },
  },
  {
    id: 'mapping', name: 'Projection mapping', about: 'Motion on a projector, warped onto a wall, a box or a sculpture with four corners.',
    sets: ['Retro grid scene', 'An output window to drag to the projector', 'Share panel'],
    start: async () => {
      await startWith('Projection', STARTERS.find((x) => x.id === 'grid')!.make(), ['create-preview', 'create-layers', 'share', 'create-inspector'])
      const { openOutput } = await import('./outputs')
      openOutput()
      toast('Drag the output window to the projector, double-click it, then press C to move the corners.', true)
    },
  },
  {
    id: 'sculpture', name: '3D audio sculpture', about: 'An iridescent knot and lights that breathe with the music, on top of chroma glass.',
    sets: ['3D scene with linked size and lights', 'Chroma glass with the 3D scene as a layer'],
    start: async () => {
      const scene = STARTERS.find((x) => x.id === 'glass')!.make()
      const { newLayer } = await import('../create/scene')
      const l = newLayer('scene3d')
      scene.layers = [...scene.layers, l]
      scene.name = '3D sculpture'
      await startWith('3D sculpture', scene, ['3d-view', 'create-preview', '3d-props', '3d-outliner'], { world: 'starter' })
    },
  },
  {
    id: 'show', name: 'Show control', about: 'A projector on TCP and a media server on UDP, run from pads, OSC or the timeline.',
    sets: ['Projector script (PJLink)', 'UDP device script', 'Routes'],
    start: async () => {
      const a = newScript('Projector', TEMPLATES.find((x) => x.id === 'tcp')!.code)
      const b = newScript('Media server', TEMPLATES.find((x) => x.id === 'udp')!.code)
      await startWith('Show control', null, [`script-${a.id}`, `script-${b.id}`, 'routes', 'messages'])
    },
  },
]

export { addRoute }
