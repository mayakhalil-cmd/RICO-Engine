import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

// A menu that floats above every panel (so a small panel never cuts it off),
// opens below its button or above it when there is more room there, and
// scrolls when it is taller than the window.

export default function PopMenu({ anchor, onClose, children, className = '', width }: {
  anchor: RefObject<HTMLElement | null>
  onClose: () => void
  children: ReactNode
  className?: string
  width?: number
}) {
  const box = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; maxHeight: number }>({ left: -9999, top: 0, maxHeight: 400 })

  useLayoutEffect(() => {
    const place = () => {
      const a = anchor.current?.getBoundingClientRect()
      if (!a) return
      const vw = window.innerWidth, vh = window.innerHeight
      const below = vh - a.bottom - 8, above = a.top - 8
      const w = box.current?.offsetWidth ?? width ?? 260
      const left = Math.max(8, Math.min(a.left, vw - w - 8))
      if (below >= 240 || below >= above) setPos({ left, top: a.bottom + 3, maxHeight: below })
      else setPos({ left, bottom: vh - a.top + 3, maxHeight: above })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [anchor, width])

  useEffect(() => {
    const close = (e: PointerEvent) => {
      const t = e.target as Node
      if (!box.current?.contains(t) && !anchor.current?.contains(t)) onClose()
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', esc)
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', esc) }
  }, [anchor, onClose])

  return createPortal(
    <div ref={box} className={`menu-list pop-menu ${className}`} role="menu"
      style={{ position: 'fixed', left: pos.left, top: pos.top ?? 'auto', bottom: pos.bottom ?? 'auto', right: 'auto', maxHeight: pos.maxHeight, width }}>
      {children}
    </div>,
    document.body,
  )
}
