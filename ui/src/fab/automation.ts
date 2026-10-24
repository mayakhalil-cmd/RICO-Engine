import { useSyncExternalStore } from 'react'
import { rico } from '../engine/connection'
import { putSignal, readSignal, signalName } from '../engine/signals'
import type { PrintEvent } from './gcode'
import { printerCommand, printerStatus, startFile, type Printer } from './printers'
import type { Rule, Step } from './settings'
import type { Stream } from './net'

// Print automation: while a print runs, RICO watches it and does the RICO
// side of your steps. A "signal" step becomes a RICO signal (print:<name>)
// that routes, nodes and scripts can use, for example to tell a robot arm
// over OSC, MQTT or serial that it is its turn. A "wait for a signal" step
// holds the print until a signal you pick goes above half (a button, an OSC
// message from the arm, a script), then the print goes on.
//
// How RICO knows where the print is:
// - Klipper: the layer the printer reports (RICO writes it into the G-code),
//   and when it pauses.
// - USB: the lines as they are sent.
// - OctoPrint and PrusaLink: only the start, pauses and the end.

export interface JobState {
  on: boolean
  printer: string
  file: string
  state: string
  layer: number
  layers: number
  waiting: string             // what it waits for, '' when not waiting
  since: number
  repeatLeft: number
  log: string[]
}

let job: JobState = { on: false, printer: '', file: '', state: '', layer: 0, layers: 0, waiting: '', since: 0, repeatLeft: 0, log: [] }
let version = 0
const ls = new Set<() => void>()
const set = (part: Partial<JobState>) => { job = { ...job, ...part }; version++; ls.forEach((l) => l()) }
const note = (t: string) => set({ log: [...job.log.slice(-30), `${new Date().toLocaleTimeString()} ${t}`] })
export const useJob = () => { useSyncExternalStore((l) => { ls.add(l); return () => ls.delete(l) }, () => version); return job }
export const getJob = () => job

const slug = (t: string) => t.trim().toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'event'
function pulse(name: string) {
  const id = `print:${slug(name)}`
  putSignal(id, `Print: ${name}`, 1)
  window.setTimeout(() => putSignal(id, `Print: ${name}`, 0), 500)
}
function publish(state: string, layer: number, layers: number) {
  putSignal('print:layer', 'Print: layer (0 to 1)', layers ? Math.min(1, layer / layers) : 0)
  putSignal('print:paused', 'Print: paused', state === 'paused' ? 1 : 0)
  putSignal('print:printing', 'Print: printing', state === 'printing' ? 1 : 0)
}

// The RICO side of an event: signals out. Returns the wait step, if any.
function fire(e: PrintEvent): Step | null {
  let wait: Step | null = null
  for (const st of e.steps) {
    if (st.kind === 'signal') {
      pulse(st.signal || e.name)
      if (st.osc) void rico.send('osc.send', { address: st.osc, value: 1 })
    }
    if (st.kind === 'waitSignal') wait = st
  }
  note(e.name)
  return wait
}

// Waits until the signal goes above half, or the time runs out.
function waitFor(st: Step): Promise<'signal' | 'timeout' | 'stopped'> {
  const id = st.signal || ''
  set({ waiting: id ? signalName(id) : 'a signal', since: Date.now() })
  const was = readSignal(id) > 0.5
  return new Promise((done) => {
    let armed = !was               // a signal already high has to drop first
    const t = window.setInterval(() => {
      if (!job.on) { window.clearInterval(t); done('stopped'); return }
      const v = readSignal(id)
      if (!armed && v <= 0.5) armed = true
      if (armed && v > 0.5) { window.clearInterval(t); set({ waiting: '' }); done('signal'); return }
      if (st.seconds && Date.now() - job.since > st.seconds * 1000) { window.clearInterval(t); set({ waiting: '' }); done('timeout') }
    }, 100)
  })
}

export interface Watch {
  printer: Printer
  file: string
  events: PrintEvent[]
  layers: number
  repeat: number              // print again this many times
  repeatSignal: string        // and wait for this signal first (bed cleared)
  again?: () => Promise<Stream | null>   // USB: send the job again
}

let stopNow: (() => void) | null = null
export function stopWatching() { stopNow?.(); stopNow = null; set({ on: false, waiting: '' }) }

// USB: the stream calls this at each marker.
export function usbMarker(w: Watch, stream: () => Stream | null) {
  return (text: string): boolean => {
    const m = /^(EVENT|WAIT)\s+(\d+)/.exec(text)
    if (!m) return false
    const e = w.events[Number(m[2])]
    if (!e) return false
    const wait = fire(e)
    if (m[1] !== 'WAIT' || !wait) return false
    void waitFor(wait).then((r) => {
      if (r === 'timeout' && wait.onTimeout === 'cancel') { stream()?.stop(); note('Gave up waiting: the print was stopped.'); return }
      stream()?.pause(false)
    })
    return true
  }
}

export function watch(w: Watch, usbStream?: Stream | null) {
  stopWatching()
  let live = true
  stopNow = () => { live = false }
  set({ on: true, printer: w.printer.name, file: w.file, state: 'starting', layer: 0, layers: w.layers, waiting: '', repeatLeft: w.repeat, log: [] })
  const done = new Set<number>()
  const fireOnce = (e: PrintEvent) => { if (done.has(e.index)) return null; done.add(e.index); return fire(e) }
  const isWait = (e: PrintEvent) => e.steps.some((s) => s.kind === 'waitSignal')

  const finished = async () => {
    for (const e of w.events) if (e.layer >= w.layers && !isWait(e)) fireOnce(e)
    pulse('done')
    if (job.repeatLeft > 0 && live) {
      if (w.repeatSignal) {
        note('Done. Waiting before printing again.')
        const r = await waitFor({ kind: 'waitSignal', signal: w.repeatSignal })
        if (r !== 'signal') return stopWatching()
      }
      set({ repeatLeft: job.repeatLeft - 1 })
      done.clear()
      note('Printing again.')
      if (w.printer.link === 'usb') { const s = await w.again?.(); if (s) void s.done.then(() => { if (live) void finished() }) }
      else { const e = await startFile(w.printer, w.file); if (e) { note(e); stopWatching() } }
      return
    }
    note('Finished.')
    stopWatching()
  }

  if (w.printer.link === 'usb') {
    for (const e of w.events) if (e.layer < 0 && !isWait(e)) fireOnce(e)
    void usbStream?.done.then(() => { if (live) void finished() })
    return
  }

  // network printers: ask every two seconds
  let seenPrinting = false
  let busy = false
  const tick = async () => {
    if (!live || busy) return
    busy = true
    try {
      const st = await printerStatus(w.printer)
      if (!live) return
      const state = st.error ? 'offline' : st.state
      const layer = st.layer ?? 0
      set({ state, layer })
      publish(state, layer, w.layers)
      if (state === 'printing' || state === 'paused') {
        if (!seenPrinting) { seenPrinting = true; for (const e of w.events) if (e.layer < 0 && !isWait(e)) fireOnce(e) }
        // layer events (Klipper reports the layer)
        if (st.layer !== undefined) for (const e of w.events) if (e.layer >= 0 && e.layer < w.layers && layer >= e.layer + 1 && !isWait(e)) fireOnce(e)
      }
      if (state === 'paused' && !job.waiting) {
        // the print paused at a wait step: the first one not done yet
        const e = w.events.find((x) => isWait(x) && !done.has(x.index) && (st.layer === undefined || x.layer >= w.layers || x.layer + 1 <= Math.max(layer, 1)))
        if (e) {
          const wait = fireOnce(e)!
          const r = await waitFor(wait)
          if (!live) return
          if (r === 'timeout' && wait.onTimeout === 'cancel') { await printerCommand(w.printer, 'cancel'); note('Gave up waiting: the print was cancelled.'); return stopWatching() }
          const err = await printerCommand(w.printer, 'resume')
          if (err) note(err)
        }
      }
      if (seenPrinting && (state === 'complete' || state === 'standby' || state === 'idle' || state === 'operational' || state === 'finished')) { seenPrinting = false; await finished() }
      if (state === 'cancelled' || state === 'error') { note(`The print ${state === 'error' ? 'stopped with an error' : 'was cancelled'}.`); stopWatching() }
    } finally { busy = false }
  }
  const t = window.setInterval(() => { if (!live) { window.clearInterval(t); return } void tick() }, 2000)
  void tick()
}

// ---- ready rules people start from ----

const rid = () => `r${Math.random().toString(36).slice(2, 8)}`
export const RULE_PRESETS: { id: string; name: string; about: string; rule: () => Rule }[] = [
  {
    id: 'arm-clear', name: 'Robot clears the bed at the end', about: 'Cools the bed, moves the head out of the way, tells your arm to take the part, and waits for it to say it is done.',
    rule: () => ({ id: rid(), name: 'Robot clears the bed', on: true, when: 'end', steps: [
      { kind: 'park', x: 0, y: 0, lift: 30 }, { kind: 'cool', temp: 30 }, { kind: 'signal', signal: 'take part', osc: '/rico/print/take' }, { kind: 'waitSignal', signal: '', seconds: 600, onTimeout: 'resume' },
    ] }),
  },
  {
    id: 'arm-insert', name: 'Robot puts something in at a height', about: 'Pauses at a height (a magnet, a nut), moves the head away, tells the arm, waits for it, then prints on.',
    rule: () => ({ id: rid(), name: 'Insert at height', on: true, when: 'atHeight', z: 5, steps: [
      { kind: 'park', x: 0, y: 0, lift: 20 }, { kind: 'signal', signal: 'insert', osc: '/rico/print/insert' }, { kind: 'waitSignal', signal: '', seconds: 0 },
    ] }),
  },
  {
    id: 'pin-handshake', name: 'Robot on a printer pin', about: 'For a robot wired to the printer board: sets a pin high, waits for a pin from the robot (Marlin), sets it low again.',
    rule: () => ({ id: rid(), name: 'Pin handshake', on: true, when: 'end', steps: [
      { kind: 'park', x: 0, y: 0, lift: 30 }, { kind: 'pin', pin: '', value: 1 }, { kind: 'waitPin', pin: '', value: 1 }, { kind: 'pin', pin: '', value: 0 },
    ] }),
  },
  {
    id: 'photo', name: 'Photo every layer', about: 'Moves the head aside each layer and sends a signal, so a camera route can take a picture.',
    rule: () => ({ id: rid(), name: 'Photo', on: true, when: 'layer', steps: [{ kind: 'park', x: 0, y: 0, lift: 0.4 }, { kind: 'dwell', seconds: 1 }, { kind: 'signal', signal: 'photo', osc: '/rico/print/photo' }] }),
  },
  {
    id: 'color', name: 'Color change at a layer', about: 'Pauses for a filament change.',
    rule: () => ({ id: rid(), name: 'Color change', on: true, when: 'atLayer', n: 10, steps: [{ kind: 'filament' }] }),
  },
  { id: 'empty', name: 'Empty rule', about: 'Start from nothing.', rule: () => ({ id: rid(), name: 'My rule', on: true, when: 'layer', steps: [] }) },
]
