import { useSyncExternalStore } from 'react'
import { readSignal, signalName } from '../engine/signals'
import { getCommands, runCommand } from './commands'
import { AE_KEYS } from './aeCommands'

// Shortcuts: any command can be run by a key combination or by a control
// (a pad on a MIDI controller, an OSC button, even the kick drum). You can
// change every one of them in Help > Keyboard and controls.

export type Trigger = { kind: 'key'; combo: string } | { kind: 'signal'; id: string }

export const DEFAULT_KEYS: Record<string, string[]> = {
  palette: ['Ctrl+K'],
  'app.settings': ['Ctrl+,'],
  undo: ['Ctrl+Z'],
  redo: ['Ctrl+Shift+Z', 'Ctrl+Y'],
  'create.save': ['Ctrl+S'],
  'create.open': ['Ctrl+O'],
  'view.bigger': ['Ctrl+='],
  'view.smaller': ['Ctrl+-'],
  'view.full': ['F11'],
  'app.keys': ['?'],
  'ws.close': ['Ctrl+W'],
  'ws.new': ['Ctrl+T'],
  ...AE_KEYS,
}

const KEY = 'rico.shortcuts'
let user: Record<string, Trigger[]> = (() => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}')
  } catch {
    return {}
  }
})()
let version = 0
const listeners = new Set<() => void>()
let recording = false

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(user))
  } catch {
    /* not remembered */
  }
  version++
  listeners.forEach((l) => l())
}

export function triggersFor(cmd: string): Trigger[] {
  if (user[cmd]) return user[cmd]
  return (DEFAULT_KEYS[cmd] ?? []).map((combo) => ({ kind: 'key', combo }))
}

export function setTriggers(cmd: string, list: Trigger[]) {
  user = { ...user, [cmd]: list }
  save()
}

export function resetTriggers(cmd?: string) {
  if (cmd) {
    const { [cmd]: _gone, ...rest } = user
    user = rest
  } else {
    user = {}
  }
  save()
}

export const isCustom = (cmd: string) => cmd in user

export function useShortcuts() {
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => version,
  )
}

// The first key the menus show next to a command.
export function keyLabel(cmd: string): string | undefined {
  return triggersFor(cmd).find((t) => t.kind === 'key')?.combo.replace('Ctrl+', isMac() ? 'Cmd+' : 'Ctrl+')
}

export function triggerLabel(t: Trigger): string {
  return t.kind === 'key' ? t.combo : signalName(t.id)
}

const isMac = () => /Mac/.test(navigator.platform)

const NAMES: Record<string, string> = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Escape: 'Esc', '+': '=' }

// "Ctrl+Shift+K" from a key press. Returns null for a lone modifier.
// Keys named by where they are, so Shift and Alt don't change them
// (Alt+[ is still "[" on every keyboard layout we can read).
const BY_CODE: Record<string, string> = {
  BracketLeft: '[', BracketRight: ']', Equal: '=', Minus: '-', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Backquote: '`', Backslash: '\\',
  NumpadAdd: 'Num+', NumpadSubtract: 'Num-', NumpadMultiply: 'Num*', NumpadDecimal: 'Num.', NumpadEnter: 'Enter',
}

export function comboOf(e: KeyboardEvent): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null
  if (e.code === 'Slash' && e.shiftKey && !e.ctrlKey && !e.altKey) return '?'
  const code = BY_CODE[e.code] ?? (/^Digit\d$/.test(e.code) ? e.code.slice(5) : /^Numpad\d$/.test(e.code) ? `Num${e.code.slice(6)}` : /^Key[A-Z]$/.test(e.code) ? e.code.slice(3) : null)
  if (code) {
    const parts: string[] = []
    if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
    if (e.altKey) parts.push('Alt')
    if (e.shiftKey) parts.push('Shift')
    parts.push(code)
    return parts.join('+')
  }
  let key = NAMES[e.key] ?? e.key
  if (key.length === 1) key = key.toUpperCase()
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  // Shift is part of characters like ? already
  if (e.shiftKey && (key.length > 1 || /[A-Z0-9]/.test(key))) parts.push('Shift')
  parts.push(key)
  return parts.join('+')
}

export function setRecording(on: boolean) {
  recording = on
}

// Where the keys go: the panel you last clicked in decides. Commands with a
// scope ("create") only run there, and win over the same key elsewhere, so
// Motion keys work in Motion without taking keys from other panels.
let lastScope: string | null = null
export const keyScope = () => {
  const el = document.activeElement as HTMLElement | null
  const s = el && el !== document.body ? el.closest<HTMLElement>('[data-keyscope]')?.dataset.keyscope ?? null : null
  if (s) return s
  // the last panel you clicked, if it is still on screen
  if (lastScope && document.querySelector(`[data-keyscope="${lastScope}"]`)) return lastScope
  // in the Motion workspace, Motion keys work even before you click
  return document.querySelector('.tool-strip[aria-label="Motion tools"]') ? 'create' : null
}

function typing(e: KeyboardEvent) {
  // Sliders, switches and color pickers don't take text, so shortcuts still work on them.
  return Boolean((e.target as HTMLElement).closest?.('textarea, select, [contenteditable], input:not([type=range]):not([type=checkbox]):not([type=color]):not([type=button])'))
}

let started = false
export function startShortcuts() {
  if (started) return
  started = true

  window.addEventListener('pointerdown', (e) => {
    lastScope = (e.target as HTMLElement).closest?.<HTMLElement>('[data-keyscope]')?.dataset.keyscope ?? null
  }, true)

  window.addEventListener('keydown', (e) => {
    if (recording || e.defaultPrevented) return
    const combo = comboOf(e)
    if (!combo) return
    // While typing, only combinations with Ctrl or function keys count.
    if (typing(e) && !combo.includes('Ctrl+') && !/^F\d+$/.test(combo)) return
    // Undo in a text box undoes the typing, not RICO.
    if (typing(e) && ['Ctrl+Z', 'Ctrl+Y', 'Ctrl+Shift+Z', 'Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+A', 'Ctrl+D'].includes(combo)) return
    const scope = keyScope()
    const hits = getCommands().filter((c) => (!c.scope || c.scope === scope) && triggersFor(c.id).some((t) => t.kind === 'key' && t.combo === combo))
    const c = hits.find((x) => x.scope) ?? hits[0]
    if (c && (!c.enabled || c.enabled())) {
      e.preventDefault()
      c.run()
    }
  })

  // Controls: a command runs when its control goes past halfway.
  const above = new Map<string, boolean>()
  window.setInterval(() => {
    for (const [cmd, list] of Object.entries(user)) {
      for (const t of list) {
        if (t.kind !== 'signal') continue
        const key = `${cmd}|${t.id}`
        const on = readSignal(t.id) > 0.5
        const was = above.get(key)
        above.set(key, on)
        if (on && was === false) runCommand(cmd)
      }
    }
  }, 16)
}

// Keys as they are printed on a keyboard ("?" is Shift and the / key).
export const prettyKeys = (k: string) => k.split(', ').map((x) => (x === '?' ? 'Shift+/' : x)).join(', ')
