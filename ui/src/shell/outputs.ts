import { useSyncExternalStore } from 'react'
import { addViewer, getRenderer, onDrawn } from '../create/store'
import { scene3dPicture } from '../create/renderer'
import { usePicture } from '../engine/shared'
import { toast } from '../components/Toasts'

// Output windows: the Create picture in its own window, for a projector, an
// LED wall or a second screen. Each one can be warped to fit a surface
// (corner pin) and remembers its settings by name: Output 1, Output 2...

interface OutputWindow { id: string; win: Window }

const open = new Map<string, OutputWindow>()
let version = 0
const listeners = new Set<() => void>()
function emit() {
  version++
  listeners.forEach((l) => l())
}

export function useOutputs(): string[] {
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => version,
  )
  return [...open.keys()]
}

export function openOutput(want?: string) {
  let n = 1
  while (open.has(`out${n}`)) n++
  const id = want && !open.has(want) ? want : `out${n}`
  if (want && open.has(want)) { open.get(want)!.win.focus(); return }
  const url = `${location.pathname}?output=${id}`
  const win = window.open(url, `rico-${id}`, 'popup,width=960,height=540')
  if (!win) {
    toast('The window was blocked. Allow pop-ups for RICO and try again.')
    return
  }
  open.set(id, { id, win })
  if (open.size === 1) addViewer(true)
  emit()
}

export function closeOutput(id: string) {
  open.get(id)?.win.close()
}

interface OutputHooks { __ricoSources?: (s: Map<string, TexImageSource>) => void; __ricoWants?: () => string[] }

// The pictures surfaces can show, by name: Create, the 3D scene, and every
// shared picture (node networks, scripts, calibrated projectors).
let engine3d = false
export function collectSources(names: string[]): Map<string, TexImageSource> {
  const out = new Map<string, TexImageSource>()
  const r = getRenderer()
  for (const n of names) {
    if (n === 'Create') { if (r) out.set(n, r.outputCanvas) }
    else if (n === '3D') { const c = scene3dPicture(); if (c) out.set(n, c) }
    else if (n !== 'test' && n !== 'solid') {
      // A calibrated projector's view needs the 3D playground running.
      if (n.startsWith('3D from ') && !engine3d) { engine3d = true; void import('../three/engine') }
      const p = usePicture(n)
      if (p && p.canvas.width > 2) out.set(n, p.canvas)
    }
  }
  return out
}

// After every Create frame, hand each output window the pictures it shows
// while they are still fresh on the graphics card.
onDrawn(() => {
  if (!open.size) return
  for (const [id, o] of open) {
    if (o.win.closed) {
      open.delete(id)
      if (!open.size) addViewer(false)
      emit()
      continue
    }
    try {
      const hooks = o.win as unknown as OutputHooks
      hooks.__ricoSources?.(collectSources(hooks.__ricoWants?.() ?? ['Create']))
    } catch {
      /* the window is still loading */
    }
  }
})

window.addEventListener('beforeunload', () => open.forEach((o) => o.win.close()))
