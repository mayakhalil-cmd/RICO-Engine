import { useEffect, useRef } from 'react'

// A canvas that is always sharp: its pixels follow its size on screen and
// the screen's pixel density. draw() gets a context already scaled so you
// draw in CSS pixels, plus the width and height, every animation frame.

export function useCanvas(draw: (g: CanvasRenderingContext2D, w: number, h: number, t: number) => void, deps: unknown[] = []) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const fn = useRef(draw)
  fn.current = draw
  useEffect(() => {
    const c = ref.current
    if (!c) return
    let raf = 0
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop)
      const dpr = Math.min(3, window.devicePixelRatio || 1)
      const w = c.clientWidth, h = c.clientHeight
      if (!w || !h) return
      const pw = Math.round(w * dpr), ph = Math.round(h * dpr)
      if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph }
      const g = c.getContext('2d')
      if (!g) return
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      fn.current(g, w, h, t)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return ref
}
