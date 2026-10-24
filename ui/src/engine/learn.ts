import { useSyncExternalStore } from 'react'
import { rico } from './connection'
import { listSignals, readSignal } from './signals'

// Learn: press Learn on any setting, then move a knob, send OSC or make a
// sound. The first signal that clearly moves gets linked.

interface LearnState {
  active: boolean
  label: string
}

let state: LearnState = { active: false, label: '' }
let onPick: ((signal: string) => void) | null = null
let baseline = new Map<string, number>()
let off: (() => void) | null = null
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((l) => l())
}

const THRESHOLD = 0.08

export function startLearn(label: string, pick: (signal: string) => void) {
  stopLearn()
  baseline = new Map(listSignals().map((s) => [s.id, readSignal(s.id)]))
  onPick = pick
  state = { active: true, label }
  emit()
  off = rico.onLive(() => {
    // Give the new values a moment to land in the signal list.
    window.setTimeout(check, 0)
  })
}

function check() {
  if (!state.active) return
  for (const s of listSignals()) {
    if (s.group === 'Clock' || s.group === 'LFO') continue
    const now = readSignal(s.id)
    const was = baseline.get(s.id)
    const moved = was === undefined ? now > THRESHOLD : Math.abs(now - was) > THRESHOLD
    if (moved) {
      const pick = onPick
      stopLearn()
      pick?.(s.id)
      return
    }
  }
}

export function stopLearn() {
  off?.()
  off = null
  onPick = null
  if (state.active) {
    state = { active: false, label: '' }
    emit()
  }
}

export function useLearn() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}
