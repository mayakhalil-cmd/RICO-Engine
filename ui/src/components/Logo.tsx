import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent } from 'react'

// The RICO wordmark, the same as on the website: a white outline layer sitting
// under the filled word, a blinking underscore, and a short "code" scramble
// when the pointer comes over it. The outline drifts a little away from the
// pointer for depth.
//
// The underscore is its own small two layer block (outline under fill) that
// blinks as one piece, and every logo on screen blinks on the same beat.
// While a letter scrambles, the real letter stays in place (hidden) so the
// word keeps its true spacing.

const CODE = '{}[]<>/\\=+*#;:01'
const BLINK = 1100

function reducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

function Letters({ word, shown }: { word: string; shown: string[] }) {
  return (
    <>
      {word.split('').map((ch, i) => (
        <span key={i} className={shown[i] === ch ? 'lch' : 'lch coding'} data-code={shown[i] === ch ? undefined : shown[i]}>{ch}</span>
      ))}
    </>
  )
}

export default function Logo({ size = 18, compact = false, stroke, cursor = true }: { size?: number | string; compact?: boolean; stroke?: number; cursor?: boolean }) {
  const WORD = compact ? 'R' : 'RICO'
  const [shown, setShown] = useState<string[]>(WORD.split(''))
  const [busy, setBusy] = useState(false)
  const raf = useRef(0)
  const box = useRef<HTMLSpanElement | null>(null)
  const phase = useRef(`${-Math.round(performance.now() % BLINK)}ms`)

  useEffect(() => () => cancelAnimationFrame(raf.current), [])
  useEffect(() => { setShown(WORD.split('')) }, [WORD])

  const play = () => {
    if (busy || reducedMotion()) return
    setBusy(true)
    const start = performance.now()
    const dur = 700
    let last = 0
    const tick = (now: number) => {
      const t = (now - start) / dur
      if (now - last > 45) {
        last = now
        setShown(WORD.split('').map((ch, i) => (t >= 0.35 + i * 0.16 ? ch : CODE[(Math.random() * CODE.length) | 0])))
      }
      if (t < 1) raf.current = requestAnimationFrame(tick)
      else { setShown(WORD.split('')); setBusy(false) }
    }
    raf.current = requestAnimationFrame(tick)
  }

  const onMove = (e: PointerEvent<HTMLSpanElement>) => {
    if (e.pointerType !== 'mouse' || !box.current || reducedMotion()) return
    const r = box.current.getBoundingClientRect()
    const dx = ((e.clientX - r.left) / r.width - 0.5) * -2
    const dy = ((e.clientY - r.top) / r.height - 0.5) * -2
    box.current.style.setProperty('--ox', `${0.07 + dx * 0.04}em`)
    box.current.style.setProperty('--oy', `${0.07 + dy * 0.04}em`)
  }
  const onLeave = () => {
    box.current?.style.removeProperty('--ox')
    box.current?.style.removeProperty('--oy')
  }

  const style = { fontSize: size, '--blink-phase': phase.current } as CSSProperties & Record<string, string | number>
  if (stroke) style['--stroke'] = `${stroke}px`

  return (
    <span ref={box} className={`logo${busy ? ' is-coding' : ''}`} style={style} role="img" aria-label="RICO"
      onPointerEnter={play} onPointerMove={onMove} onPointerLeave={onLeave}>
      <span className="logo-word" aria-hidden="true">
        <span className="logo-outline"><Letters word={WORD} shown={shown} /></span>
        <span className="logo-fill"><Letters word={WORD} shown={shown} /></span>
      </span>
      {cursor && (
        <span className="logo-cursor" aria-hidden="true">
          <span className="logo-outline">_</span>
          <span className="logo-fill">_</span>
        </span>
      )}
    </span>
  )
}
