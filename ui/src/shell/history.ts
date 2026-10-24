import { useSyncExternalStore } from 'react'

// Undo and redo for everything you change in RICO.
//
// Each step knows how to undo and redo itself. Quick repeated changes to the
// same thing (dragging a slider) merge into one step, so one Ctrl+Z undoes
// the whole drag instead of one pixel of it.

export interface Step {
  label: string
  undo: () => void
  redo: () => void
  key?: string        // steps with the same key merge when they come quickly
}

const LIMIT = 200
const MERGE_MS = 600

let undoStack: (Step & { at: number })[] = []
let redoStack: Step[] = []
let version = 0
const listeners = new Set<() => void>()

function changed() {
  version++
  listeners.forEach((l) => l())
}

export function record(step: Step) {
  const last = undoStack[undoStack.length - 1]
  const now = performance.now()
  if (last && step.key && last.key === step.key && now - last.at < MERGE_MS) {
    // Keep the oldest undo and the newest redo.
    undoStack[undoStack.length - 1] = { ...last, redo: step.redo, at: now }
  } else {
    undoStack.push({ ...step, at: now })
    if (undoStack.length > LIMIT) undoStack.shift()
  }
  redoStack = []
  changed()
}

export function undo() {
  const step = undoStack.pop()
  if (!step) return
  step.undo()
  redoStack.push(step)
  changed()
}

export function redo() {
  const step = redoStack.pop()
  if (!step) return
  step.redo()
  undoStack.push({ ...step, at: 0 })
  changed()
}

export function useHistory() {
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => version,
  )
  return {
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    undoLabel: undoStack[undoStack.length - 1]?.label ?? '',
    redoLabel: redoStack[redoStack.length - 1]?.label ?? '',
  }
}
