import { useState } from 'react'
import { readSignal, signalName, useSignalList, type SignalInfo } from '../engine/signals'
import { startLearn, stopLearn, useLearn } from '../engine/learn'
import { useTick } from '../engine/useTick'

export const SIGNAL_DRAG = 'application/x-rico-signal'

// Pick where a value comes from: a list of everything that moves, a Learn
// button (move the control you mean), or drop a knob, an OSC address or an
// audio band on it.
export default function SignalPicker({ value, onChange, label, compact }: {
  value: string
  onChange: (signal: string) => void
  label: string
  compact?: boolean
}) {
  const list = useSignalList()
  const learn = useLearn()
  const [over, setOver] = useState(false)
  useTick(80)
  const learning = learn.active && learn.label === label
  const groups = new Map<SignalInfo['group'], SignalInfo[]>()
  for (const s of list) {
    if (!groups.has(s.group)) groups.set(s.group, [])
    groups.get(s.group)!.push(s)
  }
  const v = value ? Math.max(0, Math.min(1, readSignal(value))) : 0
  return (
    <div
      className={`signal-picker${over ? ' over' : ''}${learning ? ' learning' : ''}${compact ? ' compact' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(SIGNAL_DRAG)) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false)
        const s = e.dataTransfer.getData(SIGNAL_DRAG)
        if (s) {
          e.preventDefault()
          onChange(s)
        }
      }}
    >
      <select className="select" value={value} aria-label={`${label}: where the value comes from`} onChange={(e) => onChange(e.target.value)}>
        <option value="">{learning ? 'Move a control now...' : 'Pick a source...'}</option>
        {value && !list.some((s) => s.id === value) && <option value={value}>{signalName(value)}</option>}
        {[...groups].map(([g, items]) => (
          <optgroup key={g} label={g}>
            {items.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </optgroup>
        ))}
      </select>
      <button
        type="button"
        className={`btn small${learning ? ' primary' : ' quiet'}`}
        title="Move a knob, hit a pad, send OSC or play a sound, and RICO picks it"
        onClick={() => (learning ? stopLearn() : startLearn(label, onChange))}
      >
        {learning ? 'Listening...' : 'Learn'}
      </button>
      {!compact && <span className="signal-meter" aria-hidden="true"><i style={{ width: `${v * 100}%` }} /></span>}
    </div>
  )
}
