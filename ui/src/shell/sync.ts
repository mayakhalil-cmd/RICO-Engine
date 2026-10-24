import { useSyncExternalStore } from 'react'
import { rico } from '../engine/connection'
import { applyRemoteScene, getRootScene, subscribeCreate } from '../create/store'
import { getRoutes, onRoutesChange, setAllRoutes } from '../engine/routes'
import { getGraphs, onGraphsChange, setAllGraphs } from '../nodes/store'
import type { Scene } from '../create/scene'
import type { Route } from '../engine/routes'
import type { Graph } from '../nodes/store'

// Live sharing: every screen with RICO open (this window, a laptop, a tablet
// on the network) sees the same Create scene, routes and node networks.
// Change something on one, the others follow within a moment.

const KEY = 'rico.sync'
let enabled = (() => {
  try {
    return localStorage.getItem(KEY) !== '0'
  } catch {
    return true
  }
})()
let version = 0
const listeners = new Set<() => void>()

export function useLiveShare() {
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => version,
  )
  return enabled
}

export function setLiveShare(on: boolean) {
  enabled = on
  try {
    localStorage.setItem(KEY, on ? '1' : '0')
  } catch {
    /* not remembered */
  }
  version++
  listeners.forEach((l) => l())
  if (on) publishAll()
}

const others = () => (rico.get().state?.app.screens ?? 1) > 1

type Channel = 'scene' | 'routes' | 'graphs' | 'world'
let applying = false
const timers: Partial<Record<Channel, number>> = {}
const lastSent: Partial<Record<Channel, unknown>> = {}

function publish(channel: Channel, data: unknown) {
  if (!enabled || applying || !others() || rico.get().status !== 'live') return
  if (lastSent[channel] === data) return
  window.clearTimeout(timers[channel])
  timers[channel] = window.setTimeout(() => {
    lastSent[channel] = data
    rico.send('sync.publish', { channel, data })
  }, 120)
}

let worldGetter: (() => unknown) | null = null
let worldSetter: ((w: unknown) => void) | null = null

function publishAll() {
  publish('scene', getRootScene())
  publish('routes', getRoutes())
  publish('graphs', getGraphs())
  if (worldGetter) publish('world', worldGetter())
}

let started = false
export function startSync() {
  if (started) return
  started = true
  let lastScene = getRootScene()
  subscribeCreate(() => {
    const s = getRootScene()
    if (s !== lastScene) {
      lastScene = s
      publish('scene', s)
    }
  })
  onRoutesChange(() => publish('routes', getRoutes()))
  onGraphsChange(() => publish('graphs', getGraphs()))
  // The 3D world only loads with the 3D playground; hook it up when it does.
  import('../three/world').then((m) => {
    worldGetter = m.getWorld
    worldSetter = (w) => m.replaceWorld(w as ReturnType<typeof m.getWorld>)
    let last = m.getWorld()
    m.onWorldChange(() => {
      const w = m.getWorld()
      if (w !== last) {
        last = w
        publish('world', w)
      }
    })
  })

  rico.onSync((channel, data) => {
    if (!enabled) return
    if (channel === 'hello') return publishAll()       // a new screen asks for everything
    applying = true
    try {
      if (channel === 'scene' && data) applyRemoteScene(data as Scene)
      else if (channel === 'routes' && Array.isArray(data)) setAllRoutes(data as Route[])
      else if (channel === 'graphs' && Array.isArray(data)) setAllGraphs(data as Graph[])
      else if (channel === 'world' && data && worldSetter) worldSetter(data)
    } finally {
      applying = false
    }
  })

  // When this screen connects, ask the others for what they have.
  let said = false
  rico.subscribe(() => {
    const live = rico.get().status === 'live'
    if (live && !said && enabled && others()) {
      said = true
      rico.send('sync.publish', { channel: 'hello', data: null })
    }
    if (!live) said = false
  })
}
