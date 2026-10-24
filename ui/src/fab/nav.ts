import { useSyncExternalStore } from 'react'
import { openPanel } from '../shell/Workspace'
import { activeWorkspace, dockApi, goTo } from '../shell/workspaces'

// Opens the Print or Laser tab with a gobo picked, from anywhere.

let want: { tab: string; gobo: string } | null = null
let v = 0
const ls = new Set<() => void>()

export function showTab(tab: 'print' | 'laser', gobo?: string) {
  if (gobo) { want = { tab, gobo }; v++; ls.forEach((l) => l()) }
  const open = () => { const api = dockApi(); if (api) openPanel(api, tab) }
  if (activeWorkspace() !== 'mapping') { goTo('mapping'); window.setTimeout(open, 120) } else open()
}

// The gobo the tab was asked to show (once).
export function useWanted(tab: string): string | null {
  useSyncExternalStore((l) => { ls.add(l); return () => ls.delete(l) }, () => v)
  return want?.tab === tab ? want.gobo : null
}
export const clearWanted = () => { want = null }
