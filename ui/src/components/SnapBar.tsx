import { MOVE_STEPS, ROT_STEPS, SIZE_STEPS, UNIT, setSnap, useSnap, type Handles, type Place } from '../shell/snap'

// The snapping strip on top of a view: which handles show (move, turn, size
// or all three), and a magnet with a step for each kind of change.

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : String(Number(v.toFixed(3))))

function Magnet({ on, label, title, toggle, value, steps, unit, pick }: {
  on: boolean; label: string; title: string; toggle: () => void; value: number; steps: number[]; unit: string; pick: (v: number) => void
}) {
  return (
    <span className={`snap-item${on ? ' on' : ''}`}>
      <button className="no-corner snap-toggle" aria-pressed={on} title={`${title} (${on ? 'on' : 'off'})`} onClick={toggle}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2v6a5 5 0 0 0 10 0V2h-3v6a2 2 0 0 1-4 0V2z" /></svg>{label}
      </button>
      <select className="snap-step" value={value} onChange={(e) => pick(Number(e.target.value))} aria-label={`${title} step`}>
        {steps.map((s) => <option key={s} value={s}>{fmt(s)}{unit}</option>)}
      </select>
    </span>
  )
}

export default function SnapBar({ place, handles = true }: { place: Place; handles?: boolean }) {
  const s = useSnap(place)
  const up = (p: Parameters<typeof setSnap>[1]) => setSnap(place, p)
  return (
    <div className="snap-bar" role="group" aria-label="Snapping">
      {handles && (
        <div className="seg" role="group" aria-label="Handles">
          {([['move', 'Move', 'W'], ['rotate', 'Turn', 'E'], ['scale', 'Size', 'R'], ['all', 'All', 'Q']] as [Handles, string, string][]).map(([h, label, key]) => (
            <button key={h} className={s.handles === h ? 'on' : ''} onClick={() => up({ handles: h })} title={`${label} handles (${key})`}>{label}</button>
          ))}
        </div>
      )}
      <Magnet on={s.move} label="Grid" title="Snap moves to a grid" toggle={() => up({ move: !s.move })} value={s.moveStep} steps={MOVE_STEPS[place]} unit={UNIT[place]} pick={(moveStep) => up({ moveStep, move: true })} />
      <Magnet on={s.rot} label="Angle" title="Snap turns to an angle" toggle={() => up({ rot: !s.rot })} value={s.rotStep} steps={ROT_STEPS} unit={'°'} pick={(rotStep) => up({ rotStep, rot: true })} />
      <Magnet on={s.size} label="Size" title="Snap sizes to a step" toggle={() => up({ size: !s.size })} value={s.sizeStep} steps={SIZE_STEPS} unit="" pick={(sizeStep) => up({ sizeStep, size: true })} />
    </div>
  )
}
