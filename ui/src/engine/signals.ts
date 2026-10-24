import { useEffect, useState } from 'react'
import { rico } from './connection'

// Every moving value RICO knows about, in one place: MIDI controls, OSC
// coming in, audio bands and LFOs. The Create workspace reads these every
// frame to drive layer settings, so they live outside React.

export interface SignalInfo {
  id: string
  name: string
  group: 'MIDI' | 'OSC in' | 'Audio' | 'LFO' | 'Clock' | 'Script'
}

const values = new Map<string, number>()
const infos = new Map<string, SignalInfo>()
const start = performance.now()

function put(id: string, name: string, group: SignalInfo['group'], value: number) {
  values.set(id, value)
  if (!infos.has(id)) infos.set(id, { id, name, group })
}

put('clock:beat', 'Beat (120 BPM)', 'Clock', 0)
put('clock:bar', 'Bar (120 BPM)', 'Clock', 0)

rico.onLive((live) => {
  const state = rico.get().state
  for (const [key, v] of Object.entries(live.values)) {
    const m = state?.mappings.find((x) => x.key === key)
    put(`midi:${key}`, m?.name || key, 'MIDI', v)
  }
  for (const e of live.log) {
    if (e.type === 'OSC in' && e.address) put(`osc:${e.address}`, e.address, 'OSC in', e.value)
  }
  if (live.audio && audioOwner === 'engine') {
    put('audio:level', 'Level', 'Audio', live.audio.level)
    put('audio:low', 'Low', 'Audio', live.audio.low)
    put('audio:mid', 'Mid', 'Audio', live.audio.mid)
    put('audio:high', 'High', 'Audio', live.audio.high)
    put('audio:kick', 'Kick hit', 'Audio', live.audio.kick)
    put('audio:snare', 'Snare hit', 'Audio', live.audio.snare)
  }
  live.lfos.forEach((l, i) => put(`lfo:${i}`, l.name, 'LFO', l.value))
})

// The audio lab takes over the audio signals while it runs.
let audioOwner: 'engine' | 'lab' = 'engine'
export function setAudioOwner(o: 'engine' | 'lab') {
  audioOwner = o
}
export function putAudioSignal(id: string, name: string, value: number) {
  put(id, name, 'Audio', value)
}

// Script panels make their own signals (a slider, a value read from a
// device), which can then be linked like any knob.
export function putSignal(id: string, name: string, value: number) {
  put(id, name, 'Script', value)
}

export function readSignal(id: string): number {
  if (id === 'clock:beat') return (((performance.now() - start) / 500) % 1)
  if (id === 'clock:bar') return (((performance.now() - start) / 2000) % 1)
  return values.get(id) ?? 0
}

export function signalName(id: string): string {
  return infos.get(id)?.name ?? id
}

export function listSignals(): SignalInfo[] {
  return [...infos.values()]
}

// The list of signals for pickers. Refreshes twice a second, which is
// plenty for a menu and keeps React out of the 30 Hz stream.
export function useSignalList(): SignalInfo[] {
  const [list, setList] = useState(listSignals)
  useEffect(() => {
    const id = window.setInterval(() => {
      const next = listSignals()
      setList((prev) => (prev.length === next.length ? prev : next))
    }, 500)
    return () => window.clearInterval(id)
  }, [])
  return list
}
