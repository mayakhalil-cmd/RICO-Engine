import { useEffect, useState } from 'react'

// Re-renders a component every few milliseconds, for small live readouts
// (meters, values) that read signals outside React.
export function useTick(ms = 50, on = true) {
  const [, setN] = useState(0)
  useEffect(() => {
    if (!on) return
    let raf = 0
    let last = 0
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      if (now - last < ms) return
      last = now
      setN((n) => (n + 1) % 1e6)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [ms, on])
}
