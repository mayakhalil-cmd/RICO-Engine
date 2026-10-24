import { useRef, useState } from 'react'
import { curveAt, curvesText, parseCurves, type CurvePoints, type Curves } from '../create/luts'

// Curves like a grading app: master, red, green, blue. Click to add a point,
// drag to move it, double-click a point to remove it.

const CH: { k: keyof Curves; label: string; color: string }[] = [
  { k: 'm', label: 'Master', color: '#ffffff' },
  { k: 'r', label: 'Red', color: '#ff4a4a' },
  { k: 'g', label: 'Green', color: '#3bff03' },
  { k: 'b', label: 'Blue', color: '#6f86ff' },
]
const S = 200

export default function CurveEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const curves = parseCurves(value)
  const [ch, setCh] = useState<keyof Curves>('m')
  const svg = useRef<SVGSVGElement | null>(null)
  const drag = useRef<number | null>(null)
  const pts = curves[ch]

  const at = (e: React.PointerEvent): [number, number] => {
    const r = svg.current!.getBoundingClientRect()
    return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height))]
  }
  const write = (next: CurvePoints) => onChange(curvesText({ ...curves, [ch]: [...next].sort((a, b) => a[0] - b[0]) }))
  const path = (list: CurvePoints) => {
    const d: string[] = []
    for (let i = 0; i <= 64; i++) { const x = i / 64; d.push(`${i ? 'L' : 'M'}${x * S},${(1 - curveAt(list, x)) * S}`) }
    return d.join(' ')
  }

  return (
    <div className="curves" onPointerDown={(e) => e.stopPropagation()}>
      <div className="seg">
        {CH.map((c) => <button key={c.k} className={ch === c.k ? 'on' : ''} style={{ color: ch === c.k ? undefined : c.color }} onClick={() => setCh(c.k)}>{c.label}</button>)}
        <button title="Reset this curve" onClick={() => write([[0, 0], [1, 1]])}>Reset</button>
      </div>
      <svg ref={svg} viewBox={`0 0 ${S} ${S}`} className="curves-box"
        onPointerDown={(e) => {
          const [x, y] = at(e)
          const hit = pts.findIndex((p) => Math.hypot(p[0] - x, p[1] - y) < 0.05)
          ;(e.target as Element).setPointerCapture(e.pointerId)
          if (hit >= 0) { drag.current = hit; return }
          const next: CurvePoints = ([...pts, [x, y]] as CurvePoints).sort((a, b) => a[0] - b[0])
          drag.current = next.findIndex((p) => p[0] === x && p[1] === y)
          write(next)
        }}
        onPointerMove={(e) => {
          if (drag.current === null) return
          const [x, y] = at(e)
          const i = drag.current
          const next = pts.map((p) => [...p] as [number, number])
          const lo = i > 0 ? next[i - 1][0] + 0.01 : 0, hi = i < next.length - 1 ? next[i + 1][0] - 0.01 : 1
          next[i] = [i === 0 ? 0 : i === next.length - 1 ? 1 : Math.max(lo, Math.min(hi, x)), y]
          onChange(curvesText({ ...curves, [ch]: next }))
        }}
        onPointerUp={() => { drag.current = null }}
        onDoubleClick={(e) => {
          const [x, y] = at(e as unknown as React.PointerEvent)
          const hit = pts.findIndex((p, i) => i > 0 && i < pts.length - 1 && Math.hypot(p[0] - x, p[1] - y) < 0.05)
          if (hit >= 0) write(pts.filter((_, i) => i !== hit))
        }}
      >
        {[0.25, 0.5, 0.75].map((g) => <g key={g}><line x1={g * S} y1={0} x2={g * S} y2={S} className="curves-grid" /><line x1={0} y1={g * S} x2={S} y2={g * S} className="curves-grid" /></g>)}
        <line x1={0} y1={S} x2={S} y2={0} className="curves-grid" />
        {CH.filter((c) => c.k !== ch).map((c) => <path key={c.k} d={path(curves[c.k])} stroke={c.color} strokeOpacity={0.25} fill="none" />)}
        <path d={path(pts)} stroke={CH.find((c) => c.k === ch)!.color} strokeWidth={2} fill="none" />
        {pts.map((p, i) => <circle key={i} cx={p[0] * S} cy={(1 - p[1]) * S} r={5} className="curves-pt" />)}
      </svg>
    </div>
  )
}
