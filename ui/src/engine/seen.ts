import { useEffect, useState } from 'react'
import { rico } from './connection'

// Everything RICO has seen move since it started: each MIDI control and
// each OSC address, with its latest value and a short history. The MIDI and
// OSC tabs draw from this.

export interface SeenControl {
  key: string           // same key RICO uses for mappings: type:channel:number
  kind: 'cc' | 'note' | 'bend' | 'pressure' | 'program'
  channel: number
  number: number
  value: number         // 0..1
  on: boolean           // notes only
  at: number            // last time it moved (ms)
}

export interface SeenAddress {
  address: string
  dir: 'in' | 'out'
  value: number
  history: number[]
  at: number
}

const controls = new Map<string, SeenControl>()
const addresses = new Map<string, SeenAddress>()
let version = 0

const KIND: Record<string, { kind: SeenControl['kind']; type: number }> = {
  'CC': { kind: 'cc', type: 1 },
  'Note On': { kind: 'note', type: 0 },
  'Note Off': { kind: 'note', type: 0 },
  'Pitch Bend': { kind: 'bend', type: 2 },
  'Aftertouch': { kind: 'pressure', type: 4 },
  'Program': { kind: 'program', type: 3 },
}

rico.onLive((live) => {
  if (!live.log.length) return
  const now = performance.now()
  for (const e of live.log) {
    const k = KIND[e.type]
    if (k && e.ch > 0 && e.d1 >= 0) {
      const key = `${k.type}:${e.ch}:${e.d1}`
      const raw = k.kind === 'bend' ? ((e.d2 << 7) | e.d1) / 16383 : k.kind === 'program' ? e.d1 / 127 : e.d2 / 127
      controls.set(key, {
        key, kind: k.kind, channel: e.ch, number: e.d1,
        value: Math.max(0, Math.min(1, raw)),
        on: e.type === 'Note On' && e.d2 > 0,
        at: now,
      })
    }
    // MIDI rows carry the OSC address they were sent to, so they count as OSC out.
    if (e.address && (e.type === 'OSC in' || e.type === 'OSC out' || e.type === 'OSC' || k)) {
      const prev = addresses.get(e.address)
      const history = prev ? [...prev.history.slice(-59), e.value] : [e.value]
      addresses.set(e.address, { address: e.address, dir: e.type === 'OSC in' ? 'in' : 'out', value: e.value, history, at: now })
    }
  }
  version++
})

// Re-renders at most ~20 times a second while things move.
function useTicker(ms = 50) {
  const [, setV] = useState(0)
  useEffect(() => {
    let seen = version
    const id = window.setInterval(() => {
      if (version !== seen) {
        seen = version
        setV(version)
      }
    }, ms)
    return () => window.clearInterval(id)
  }, [ms])
}

export function useSeenControls(): SeenControl[] {
  useTicker()
  return [...controls.values()].sort((a, b) => a.channel - b.channel || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || a.number - b.number)
}

export function useSeenAddresses(): SeenAddress[] {
  useTicker()
  return [...addresses.values()].sort((a, b) => (a.address < b.address ? -1 : 1))
}

export function forgetSeen() {
  controls.clear()
  addresses.clear()
  version++
}
