import { useSyncExternalStore } from 'react'
import type { TimeUnits } from './timeline'

// How the timeline is shown (not part of the scene): time units and snapping.

interface View { units: TimeUnits; snap: boolean }
const KEY = 'rico.tl.view'
let view: View = (() => {
  try { return { units: 'tc', snap: true, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') } as View } catch { return { units: 'tc', snap: true } }
})()
let version = 0
const ls = new Set<() => void>()
export function setTlView(part: Partial<View>) {
  view = { ...view, ...part }
  try { localStorage.setItem(KEY, JSON.stringify(view)) } catch { /* not kept */ }
  version++
  ls.forEach((l) => l())
}
export function useTlView(): View {
  useSyncExternalStore((l) => { ls.add(l); return () => ls.delete(l) }, () => version)
  return view
}
