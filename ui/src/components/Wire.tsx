import { useEffect, useRef, useState } from 'react'
import { rico } from '../engine/connection'

// The strip along the bottom of the window. Every message RICO moves is a
// short tick: blue for messages coming in, pink for messages going out.
// It's the quickest way to see that something is happening, and what.

const OUT_TYPES = new Set(['OSC out', 'MIDI out'])

export default function Wire() {
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const [last, setLast] = useState('Waiting for signals')

  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let width = 0
    let height = 0
    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      width = c.clientWidth
      height = c.clientHeight
      c.width = Math.max(1, Math.floor(width * dpr))
      c.height = Math.max(1, Math.floor(height * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(c)

    type Tick = { x: number; out: boolean; h: number; system: boolean }
    let ticks: Tick[] = []
    let lastText = ''
    const off = rico.onLive((live) => {
      for (const e of live.log) {
        const out = OUT_TYPES.has(e.type)
        const system = e.type === 'RICO'
        ticks.push({ x: width + Math.random() * 6, out, h: system ? 1 : 0.35 + 0.65 * Math.min(1, Math.abs(e.value)), system })
        lastText = `${e.type}  ${e.address || e.text}`
      }
      if (ticks.length > 900) ticks = ticks.slice(-900)
    })

    let raf = 0
    let prev = performance.now()
    let shownText = ''
    let colors = { lime: '#3bff03', pink: '#f820a0', blue: '#6f86ff', limeRgb: '59,255,3' }
    let colorCheck = 0
    const draw = (now: number) => {
      if (now - colorCheck > 1000) {
        // follow the color theme
        colorCheck = now
        const cs = getComputedStyle(document.documentElement)
        colors = { lime: cs.getPropertyValue('--lime').trim() || colors.lime, pink: cs.getPropertyValue('--pink').trim() || colors.pink, blue: cs.getPropertyValue('--blue-read').trim() || colors.blue, limeRgb: cs.getPropertyValue('--lime-rgb').trim() || colors.limeRgb }
      }
      const dt = Math.min(0.05, (now - prev) / 1000)
      prev = now
      const speed = reduced ? 0 : 90
      ctx.clearRect(0, 0, width, height)
      const mid = height / 2
      ctx.fillStyle = `rgba(${colors.limeRgb},0.18)`
      ctx.fillRect(0, mid, width, 1)
      for (const t of ticks) {
        t.x -= speed * dt
        const h = Math.max(3, t.h * (height - 8))
        if (t.system) {
          ctx.fillStyle = colors.lime
          ctx.fillRect(Math.round(t.x), 4, 2, height - 8)
        } else if (t.out) {
          ctx.fillStyle = colors.pink
          ctx.fillRect(Math.round(t.x), Math.round(mid - h / 2), 3, Math.round(h / 2))
        } else {
          ctx.fillStyle = colors.blue
          ctx.fillRect(Math.round(t.x), Math.round(mid), 3, Math.round(h / 2))
        }
      }
      ticks = ticks.filter((t) => t.x > -4)
      if (reduced && ticks.length > 200) ticks = ticks.slice(-200).map((t, i) => ({ ...t, x: width - (200 - i) * 5 }))
      if (lastText !== shownText) {
        shownText = lastText
        setLast(lastText)
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      off()
    }
  }, [])

  return (
    <footer className="wire" aria-label="Signal activity">
      <div className="wire-label" title="Blue: coming in. Pink: going out.">wire</div>
      <canvas ref={canvas} aria-hidden="true" />
      <div className="wire-last" aria-live="off">{last}</div>
    </footer>
  )
}
