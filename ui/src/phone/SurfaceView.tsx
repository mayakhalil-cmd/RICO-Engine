import { useEffect, useRef, useState } from 'react'
import { fire, offsetSend, type PControl, type Surface } from './surfaces'

// A control surface, live: the same on the phone, on a tablet and in the
// builder (where "preview" draws it without reacting to touch).

function useThrottle() {
  const last = useRef(0)
  const pending = useRef<number | null>(null)
  return (fn: () => void) => {
    const now = performance.now()
    if (now - last.current > 33) { last.current = now; fn() }
    else { if (pending.current) window.clearTimeout(pending.current); pending.current = window.setTimeout(() => { last.current = performance.now(); fn() }, 34) }
  }
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const relOf = (e: React.PointerEvent | PointerEvent, el: Element) => {
  const r = el.getBoundingClientRect()
  return [clamp01((e.clientX - r.left) / r.width), clamp01(1 - (e.clientY - r.top) / r.height)] as const
}
const capture = (e: React.PointerEvent) => (e.currentTarget as Element).setPointerCapture(e.pointerId)
const held = (e: React.PointerEvent) => (e.currentTarget as Element).hasPointerCapture(e.pointerId)

function Label({ c }: { c: PControl }) {
  return c.hideLabel ? null : <span className="sv-name">{c.label}</span>
}

function Steps({ c, send }: { c: PControl; send: (on: boolean) => void }) {
  const n = Math.max(2, Math.min(32, c.steps ?? 8))
  const [on, setOn] = useState<boolean[]>(() => Array.from({ length: n }, (_, i) => i % 4 === 0))
  const [play, setPlay] = useState(false)
  const [bpm, setBpm] = useState(c.bpm ?? 120)
  const [pos, setPos] = useState(-1)
  const ref = useRef({ on, pos: -1, send })
  ref.current.on = on
  ref.current.send = send
  useEffect(() => { setOn((o) => Array.from({ length: n }, (_, i) => o[i] ?? false)) }, [n])
  useEffect(() => {
    if (!play) { setPos(-1); ref.current.pos = -1; return }
    const t = window.setInterval(() => {
      const p = (ref.current.pos + 1) % n
      ref.current.pos = p
      setPos(p)
      if (ref.current.on[p]) { ref.current.send(true); window.setTimeout(() => ref.current.send(false), 60) }
    }, 60000 / Math.max(20, bpm) / 4)
    return () => window.clearInterval(t)
  }, [play, bpm, n])
  return (
    <>
      <div className="sv-steps-top">
        <button className={`sv-mini${play ? ' on' : ''}`} onClick={() => setPlay(!play)}>{play ? 'Stop' : 'Play'}</button>
        <button className="sv-mini" onClick={() => setBpm((b) => Math.max(20, b - 5))} aria-label="Slower">-</button>
        <em>{bpm} bpm</em>
        <button className="sv-mini" onClick={() => setBpm((b) => Math.min(300, b + 5))} aria-label="Faster">+</button>
        <Label c={c} />
      </div>
      <div className="sv-steps" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
        {on.map((x, i) => <button key={i} className={`${x ? 'on' : ''}${pos === i ? ' now' : ''}${i % 4 === 0 ? ' beat' : ''}`} onClick={() => setOn((o) => o.map((y, j) => (j === i ? !y : y)))} aria-label={`Step ${i + 1}`} />)}
      </div>
    </>
  )
}

function Tilt({ c, send }: { c: PControl; send: (x: number, y: number) => void }) {
  const [state, setState] = useState<'off' | 'on' | 'no'>('off')
  const [xy, setXY] = useState<[number, number]>([0.5, 0.5])
  const sendRef = useRef(send)
  sendRef.current = send
  useEffect(() => {
    if (state !== 'on') return
    let got = false
    const on = (e: DeviceOrientationEvent) => {
      if (e.gamma === null || e.beta === null) return
      got = true
      const x = clamp01((e.gamma + 90) / 180), y = clamp01(1 - (Math.max(-90, Math.min(90, e.beta)) + 90) / 180)
      setXY([x, y]); sendRef.current(x, y)
    }
    window.addEventListener('deviceorientation', on)
    const t = window.setTimeout(() => { if (!got) setState('no') }, 2500)
    return () => { window.removeEventListener('deviceorientation', on); window.clearTimeout(t) }
  }, [state])
  const start = async () => {
    const D = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> } | undefined
    if (!D) return setState('no')
    try { if (D.requestPermission && (await D.requestPermission()) !== 'granted') return setState('no') } catch { return setState('no') }
    setState('on')
  }
  return (
    <div className="sv-tilt" onClick={() => { if (state !== 'on') void start(); else setState('off') }}>
      <i style={{ left: `${xy[0] * 100}%`, top: `${(1 - xy[1]) * 100}%` }} />
      <Label c={c} />
      <em>{state === 'on' ? 'tilt the device (tap to stop)' : state === 'no' ? 'this browser does not share tilt here' : 'tap to start'}</em>
    </div>
  )
}

function Control({ c, preview }: { c: PControl; preview?: boolean }) {
  const [v, setV] = useState(c.kind === 'cross' ? 0.5 : 0)
  const [v2, setV2] = useState(c.kind === 'range' ? 1 : 0.5)
  const [pressed, setPressed] = useState<Set<number>>(new Set())
  const [taps, setTaps] = useState<number[]>([])
  const throttle = useThrottle()
  const scale = (x: number) => c.min + x * (c.max - c.min)
  const send = (x: number, y?: number, press?: boolean) => throttle(() => { fire(c.send, scale(x), press); if (y !== undefined && c.sendY) fire(c.sendY, scale(y), press) })
  const start = useRef<{ y: number; v: number; thumb?: 0 | 1 } | null>(null)
  const style = {
    gridColumn: `${c.x + 1} / span ${c.w}`, gridRow: `${c.y + 1} / span ${c.h}`, '--c': c.color,
    ...(c.textColor ? { '--tc': c.textColor } : {}), ...(c.textSize ? { '--ts': c.textSize } : {}),
  } as React.CSSProperties
  const cls = `sv-ctl sv-${c.kind}${c.fill ? ' fill' : ''}${preview ? ' preview' : ''}`

  switch (c.kind) {
    case 'label': return <div className={cls} style={{ ...style, textAlign: c.align ?? 'center' }}><b>{c.label}</b></div>
    case 'text': return <div className={cls} style={{ ...style, textAlign: c.align ?? 'left' }}><p>{c.label}</p></div>
    case 'image': return (
      <div className={cls} style={style}>
        {c.image ? <img src={c.image} alt={c.label} style={{ objectFit: c.fit ?? 'contain' }} draggable={false} /> : <span className="sv-name">Add a picture</span>}
      </div>
    )
    case 'fader': case 'hfader': case 'cross': {
      const vert = c.kind === 'fader'
      const at = (e: React.PointerEvent) => { const [x, y] = relOf(e, e.currentTarget); return vert ? y : x }
      return (
        <div className={cls} style={style}
          onPointerDown={(e) => { capture(e); const n = at(e); setV(n); send(n) }}
          onPointerMove={(e) => { if (!held(e)) return; const n = at(e); setV(n); send(n) }}
          onDoubleClick={() => { if (c.kind === 'cross') { setV(0.5); send(0.5) } }}>
          <i className="sv-level" style={vert ? { height: `${v * 100}%` } : { width: `${v * 100}%` }} />
          {c.kind === 'cross' && <><i className="sv-mid" /><b className="sv-ab a">A</b><b className="sv-ab b">B</b></>}
          <Label c={c} /><em>{scale(v).toFixed(2)}</em>
        </div>
      )
    }
    case 'knob': case 'encoder': return (
      <div className={cls} style={style}
        onPointerDown={(e) => { capture(e); start.current = { y: e.clientY, v } }}
        onPointerMove={(e) => {
          const s = start.current
          if (!s) return
          const raw = s.v + (s.y - e.clientY) / 160
          const n = c.kind === 'encoder' ? raw - Math.floor(raw) : clamp01(raw)
          setV(n); send(n)
        }}
        onPointerUp={() => { start.current = null }}>
        <svg viewBox="0 0 40 40">
          {c.kind === 'knob'
            ? <><circle cx="20" cy="20" r="15" className="sv-knob-bg" /><circle cx="20" cy="20" r="15" className="sv-knob-v" pathLength={100} strokeDasharray={`${v * 75} 100`} transform="rotate(135 20 20)" /></>
            : <><circle cx="20" cy="20" r="15" className="sv-enc" /><circle cx={20 + 11 * Math.sin(v * Math.PI * 2)} cy={20 - 11 * Math.cos(v * Math.PI * 2)} r="3" className="sv-enc-dot" /></>}
        </svg>
        <Label c={c} /><em>{scale(v).toFixed(2)}</em>
      </div>
    )
    case 'button': return (
      <button className={`${cls}${v ? ' on' : ''}`} style={style}
        onPointerDown={(e) => { capture(e); setV(1); fire(c.send, scale(1), true) }}
        onPointerUp={() => { setV(0); fire(c.send, c.min, false) }} onPointerCancel={() => { setV(0); fire(c.send, c.min, false) }}>
        {c.image && <img src={c.image} alt="" className="sv-icon" draggable={false} />}<Label c={c} />
      </button>
    )
    case 'toggle': return (
      <button className={`${cls}${v ? ' on' : ''}`} style={style} onClick={() => { const n = v ? 0 : 1; setV(n); fire(c.send, scale(n), n > 0) }}>
        {c.image && <img src={c.image} alt="" className="sv-icon" draggable={false} />}<Label c={c} /><em>{v ? 'on' : 'off'}</em>
      </button>
    )
    case 'pads': {
      const cols = Math.max(1, Math.min(8, c.padCols ?? 4)), rows = Math.max(1, Math.min(8, c.padRows ?? 2))
      const hit = (i: number, down: boolean) => {
        setPressed((p) => { const n = new Set(p); if (down) n.add(i); else n.delete(i); return n })
        fire(offsetSend(c.send, i), down ? scale(1) : c.min, down)
      }
      return (
        <div className={cls} style={{ ...style, gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
          {Array.from({ length: cols * rows }, (_, k) => {
            const i = (rows - 1 - Math.floor(k / cols)) * cols + (k % cols)   // pad 1 at the bottom left, like most pad controllers
            return (
              <button key={i} className={pressed.has(i) ? 'on' : ''}
                onPointerDown={(e) => { capture(e); hit(i, true) }} onPointerUp={() => hit(i, false)} onPointerCancel={() => hit(i, false)}>{i + 1}</button>
            )
          })}
        </div>
      )
    }
    case 'radio': {
      const opts = c.options?.length ? c.options : ['One', 'Two']
      return (
        <div className={cls} style={style}>
          <Label c={c} />
          <div className="sv-radio">
            {opts.map((o, i) => <button key={i} className={Math.round(v * Math.max(1, opts.length - 1)) === i ? 'on' : ''} onClick={() => { const n = opts.length > 1 ? i / (opts.length - 1) : 0; setV(n); fire(c.send, scale(n)) }}>{o}</button>)}
          </div>
        </div>
      )
    }
    case 'xy': return (
      <div className={cls} style={style}
        onPointerDown={(e) => { capture(e); const [x, y] = relOf(e, e.currentTarget); setV(x); setV2(y); send(x, y) }}
        onPointerMove={(e) => { if (!held(e)) return; const [x, y] = relOf(e, e.currentTarget); setV(x); setV2(y); send(x, y) }}>
        <i className="sv-dot" style={{ left: `${v * 100}%`, top: `${(1 - v2) * 100}%` }} /><Label c={c} />
      </div>
    )
    case 'range': return (
      <div className={cls} style={style}
        onPointerDown={(e) => { capture(e); const [x] = relOf(e, e.currentTarget); const t = Math.abs(x - v) <= Math.abs(x - v2) ? 0 : 1; start.current = { y: 0, v: 0, thumb: t }; if (t === 0) { const n = Math.min(x, v2); setV(n); send(n, v2) } else { const n = Math.max(x, v); setV2(n); send(v, n) } }}
        onPointerMove={(e) => { const s = start.current; if (!s || !held(e)) return; const [x] = relOf(e, e.currentTarget); if (s.thumb === 0) { const n = Math.min(x, v2); setV(n); send(n, v2) } else { const n = Math.max(x, v); setV2(n); send(v, n) } }}
        onPointerUp={() => { start.current = null }}>
        <i className="sv-span" style={{ left: `${v * 100}%`, width: `${(v2 - v) * 100}%` }} />
        <i className="sv-thumb" style={{ left: `${v * 100}%` }} /><i className="sv-thumb" style={{ left: `${v2 * 100}%` }} />
        <Label c={c} /><em>{scale(v).toFixed(2)} to {scale(v2).toFixed(2)}</em>
      </div>
    )
    case 'color': return (
      <div className={cls} style={style}
        onPointerDown={(e) => { capture(e); const [x, y] = relOf(e, e.currentTarget); setV(x); setV2(y); send(x, y) }}
        onPointerMove={(e) => { if (!held(e)) return; const [x, y] = relOf(e, e.currentTarget); setV(x); setV2(y); send(x, y) }}>
        <i className="sv-dot" style={{ left: `${v * 100}%`, top: `${(1 - v2) * 100}%`, background: `hsl(${v * 360} ${v2 * 100}% 50%)` }} /><Label c={c} />
      </div>
    )
    case 'steps': return (
      <div className={cls} style={style}>
        <Steps c={c} send={(on) => fire(c.send, on ? scale(1) : c.min, on)} />
      </div>
    )
    case 'tap': {
      const bpm = taps.length > 1 ? 60000 / ((taps[taps.length - 1] - taps[0]) / (taps.length - 1)) : 0
      return (
        <button className={cls} style={style} onPointerDown={() => {
          const now = performance.now()
          const t = [...taps.filter((x) => now - x < 2500), now].slice(-5)
          setTaps(t)
          if (t.length > 1) { const b = 60000 / ((t[t.length - 1] - t[0]) / (t.length - 1)); fire(c.send, scale(clamp01((b - 40) / 200))) }
        }}>
          <Label c={c} /><em>{bpm ? `${Math.round(bpm)} bpm` : 'tap'}</em>
        </button>
      )
    }
    case 'tilt': return (
      <div className={cls} style={style}>
        <Tilt c={c} send={(x, y) => send(x, y)} />
      </div>
    )
  }
}

export default function SurfaceView({ s, preview }: { s: Surface; preview?: boolean }) {
  const style: React.CSSProperties & Record<string, string | number> = {
    gridTemplateColumns: `repeat(${s.cols}, 1fr)`, gridTemplateRows: `repeat(${s.rows}, 1fr)`,
    '--gap': `${s.gap ?? 8}px`, '--r': `${s.radius ?? 10}px`,
  }
  if (s.bg) style.backgroundColor = s.bg
  return (
    <div className={`sv${preview ? ' preview' : ''}`} style={style}>
      {s.bgImage && <img className="sv-bg" src={s.bgImage} alt="" style={{ objectFit: s.bgFit ?? 'cover', opacity: 1 - (s.bgDim ?? 0.3) }} draggable={false} />}
      {s.controls.map((c) => <Control key={c.id} c={c} preview={preview} />)}
    </div>
  )
}
