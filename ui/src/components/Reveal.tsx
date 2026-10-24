import { useEffect, useRef, useState } from 'react'

// Small motion helpers shared by the Overview pages: text that decodes like
// code, things that slide in when they scroll into view, and smooth scrolling.
// All of them stay still when the system asks for less motion.

export const calm = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.body.classList.contains('calm') } catch { return false }
}

const CODE = '{}[]<>/\\=+*#;:01'

// Text that scrambles and settles letter by letter each time `play` changes.
export function Scramble({ text, play, className, dur = 520 }: { text: string; play: unknown; className?: string; dur?: number }) {
  const [shown, setShown] = useState(text)
  const raf = useRef(0)
  useEffect(() => {
    // -1 or null means "not now": show the word as it is, so only one plays at a time
    if (calm() || play === -1 || play === null) { cancelAnimationFrame(raf.current); setShown(text); return }
    const start = performance.now()
    let last = 0
    const tick = (now: number) => {
      const t = (now - start) / dur
      if (now - last > 40) {
        last = now
        setShown(text.split('').map((ch, i) => (ch === ' ' || t >= 0.25 + (i / Math.max(1, text.length)) * 0.75 ? ch : CODE[(Math.random() * CODE.length) | 0])).join(''))
      }
      if (t < 1) raf.current = requestAnimationFrame(tick)
      else setShown(text)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [text, play, dur])
  return <span className={className} aria-label={text}>{shown}</span>
}

// Adds "in" to the element the first time it scrolls into view.
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (calm() || typeof IntersectionObserver === 'undefined') { el.classList.add('in'); return }
    const io = new IntersectionObserver((list) => {
      for (const e of list) if (e.isIntersecting) { (e.target as HTMLElement).classList.add('in'); io.unobserve(e.target) }
    }, { threshold: 0.15 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return ref
}

// Scroll-linked motion for a page inside a panel: calls back with how far
// the panel has scrolled (the native scroll, no smoothing library).
export function useScrollY(content: React.RefObject<HTMLElement | null>, onScroll?: (y: number) => void) {
  const cb = useRef(onScroll)
  cb.current = onScroll
  useEffect(() => {
    const el = content.current
    if (!el || calm()) return
    // the box that scrolls (the panel around the page)
    let box: HTMLElement | null = el
    while (box && box !== document.body && !/(auto|scroll)/.test(getComputedStyle(box).overflowY)) box = box.parentElement
    const target = box && box !== document.body ? box : el
    let raf = 0
    const on = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => cb.current?.(target.scrollTop)) }
    target.addEventListener('scroll', on, { passive: true })
    return () => { target.removeEventListener('scroll', on); cancelAnimationFrame(raf) }
  }, [content])
}

// A soft light that follows the pointer inside an element (sets --mx and --my).
export function spotlight(e: React.PointerEvent<HTMLElement>) {
  const r = e.currentTarget.getBoundingClientRect()
  e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`)
  e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`)
}
