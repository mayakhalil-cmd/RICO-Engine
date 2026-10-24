import { useSyncExternalStore } from 'react'
import { rico } from './connection'
import { putSignal } from './signals'
import type { LogEntry } from './types'

// MIDI rules, like a MIDI translator: when a message matches, change it and
// send it on, as MIDI, OSC, DMX or a signal. Many rules can match one
// message, so one key can fan out to many places.

export type MsgType = 'any' | 'note' | 'cc' | 'bend' | 'program' | 'aftertouch'
export type OutKind = 'midi-note' | 'midi-cc' | 'midi-program' | 'osc' | 'dmx' | 'signal' | 'block'

export interface Rule {
  id: string
  name: string
  on: boolean
  // when
  type: MsgType
  channel: number          // 0 = any
  lo: number               // number range (note or CC number)
  hi: number
  // value shaping (0..1 inside)
  inMin: number            // input range 0..127
  inMax: number
  invert: boolean
  curve: number            // 1 straight
  outMin: number           // output range (0..127 for MIDI, any for OSC)
  outMax: number
  // then
  out: OutKind
  outChannel: number       // 0 = same channel
  transpose: number        // added to the number
  fixedNumber: number      // -1 = keep (plus transpose)
  host: string
  port: number
  address: string          // OSC address; {n} = number, {c} = channel
  dmx: number              // DMX channel; {n} adds the number
  signal: string
  count: number            // fan out: this many messages, number +1 each (one MIDI to ten OSC)
}

const KEY = 'rico.midi.rules'
let rules: Rule[] = (() => { try { const v = JSON.parse(localStorage.getItem(KEY) ?? '[]'); return Array.isArray(v) ? v : [] } catch { return [] } })()
let version = 0
const listeners = new Set<() => void>()
const save = () => {
  try { localStorage.setItem(KEY, JSON.stringify(rules)) } catch { /* not remembered */ }
  version++
  listeners.forEach((l) => l())
}

export function useRules() {
  useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => version)
  return rules
}
export const getRules = () => rules
export function setRules(next: Rule[]) { rules = next; save() }
export function newRule(part: Partial<Rule> = {}): Rule {
  return {
    id: Math.random().toString(36).slice(2, 9), name: `Rule ${rules.length + 1}`, on: true,
    type: 'cc', channel: 0, lo: 0, hi: 127, inMin: 0, inMax: 127, invert: false, curve: 1, outMin: 0, outMax: 127,
    out: 'osc', outChannel: 0, transpose: 0, fixedNumber: -1, host: '127.0.0.1', port: 9000, address: '/midi/cc/{n}', dmx: 1, signal: 'MIDI rule', count: 1,
    ...part,
  }
}
export function addRule(part: Partial<Rule> = {}) { const r = newRule(part); setRules([...rules, r]); return r.id }
export function updateRule(id: string, part: Partial<Rule>) { setRules(rules.map((r) => (r.id === id ? { ...r, ...part } : r))) }
export function removeRule(id: string) { setRules(rules.filter((r) => r.id !== id)) }

// ---- matching ----

export function kindOf(e: LogEntry): MsgType | null {
  if (e.type === 'Note On' || e.type === 'Note Off') return 'note'
  if (e.type === 'CC') return 'cc'
  if (e.type === 'Pitch Bend') return 'bend'
  if (e.type === 'Program') return 'program'
  if (e.type === 'Aftertouch') return 'aftertouch'
  return null
}

export function applyRule(r: Rule, e: LogEntry): number | null {
  const k = kindOf(e)
  if (!k || !r.on) return null
  if (r.type !== 'any' && r.type !== k) return null
  if (r.channel && e.ch !== r.channel) return null
  if (k !== 'bend' && (e.d1 < r.lo || e.d1 > r.hi)) return null
  const raw = k === 'note' ? (e.type === 'Note Off' ? 0 : e.d2) : k === 'bend' ? e.value * 127 : k === 'program' ? e.d1 : e.d2
  let t = (raw - r.inMin) / Math.max(1, r.inMax - r.inMin)
  t = Math.max(0, Math.min(1, t))
  if (r.invert) t = 1 - t
  t = Math.pow(t, r.curve)
  return r.outMin + t * (r.outMax - r.outMin)
}

let sentCount = 0
export const rulesSent = () => sentCount

function run(e: LogEntry) {
  for (const r of rules) {
    const v = applyRule(r, e)
    if (v === null) continue
    const ch = r.outChannel || Math.max(1, e.ch)
    for (let i = 0; i < Math.max(1, r.count); i++) {
      const n = (r.fixedNumber >= 0 ? r.fixedNumber : e.d1 + r.transpose) + i
      const fill = (s: string) => s.replace(/\{n\}/g, String(n)).replace(/\{c\}/g, String(ch)).replace(/\{i\}/g, String(i + 1))
      sentCount++
      switch (r.out) {
        case 'midi-note': {
          const vel = Math.round(Math.max(0, Math.min(127, v)))
          void rico.send('midi.send', { bytes: [(vel > 0 ? 0x90 : 0x80) + ((ch - 1) & 15), n & 127, vel] })
          break
        }
        case 'midi-cc': void rico.send('midi.send', { bytes: [0xb0 + ((ch - 1) & 15), n & 127, Math.round(Math.max(0, Math.min(127, v)))] }); break
        case 'midi-program': void rico.send('midi.send', { bytes: [0xc0 + ((ch - 1) & 15), Math.round(Math.max(0, Math.min(127, v)))] }); break
        case 'osc': void rico.send('net.osc', { host: r.host, port: r.port, address: fill(r.address), args: [v] }); break
        case 'dmx': void rico.send('dmx.set', { channel: Math.max(1, Math.min(512, r.dmx + i)), value: Math.max(0, Math.min(1, v / Math.max(1, r.outMax))) }); break
        case 'signal': putSignal(`rule:${fill(r.signal)}`, fill(r.signal), Math.max(0, Math.min(1, (v - r.outMin) / Math.max(1e-9, r.outMax - r.outMin)))); break
        case 'block': break
      }
    }
  }
}

rico.onLive((live) => {
  if (!rules.length) return
  for (const e of live.log) if (kindOf(e)) run(e)
})
