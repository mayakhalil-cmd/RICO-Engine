import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// Hover help everywhere: anything with a title shows it in a small card a
// moment after the mouse rests on it (instead of the plain browser tip).
// Things with data-docs also get a "Read more" link to the documentation.
// <Hint> is the little "?" that holds the longer explanations.

export const DOCS = 'https://github.com/mayakhalil-cmd/RICO/blob/main/docs/'
export const docsUrl = (page: string) => (page.startsWith('http') ? page : `${DOCS}${page}`)

interface Tip { text: string; docs?: string; x: number; y: number; below: boolean }

export default function Tips() {
  const [tip, setTip] = useState<Tip | null>(null)
  const timer = useRef(0)
  const cur = useRef<HTMLElement | null>(null)
  const overTip = useRef(false)
  useEffect(() => {
    const restore = () => {
      const el = cur.current
      if (el && el.dataset.tipTitle !== undefined) { el.setAttribute('title', el.dataset.tipTitle); delete el.dataset.tipTitle }
      cur.current = null
    }
    const hide = () => { window.clearTimeout(timer.current); if (!overTip.current) { restore(); setTip(null) } }
    const over = (e: MouseEvent) => {
      const t = e.target as Element | null
      if (!t || (t as HTMLElement).closest?.('.tip-card')) return
      const el = t.closest?.('[title], [data-tip-title]') as HTMLElement | null
      if (!el || el instanceof SVGElement || el === cur.current) return
      window.clearTimeout(timer.current)
      restore()
      setTip(null)
      const text = el.getAttribute('title')
      if (!text) return
      // take the title away so the browser does not show its own tip too
      el.dataset.tipTitle = text
      el.removeAttribute('title')
      cur.current = el
      timer.current = window.setTimeout(() => {
        if (cur.current !== el || !el.isConnected) return
        const r = el.getBoundingClientRect()
        const below = r.top < 140
        setTip({ text, docs: el.dataset.docs, x: Math.min(window.innerWidth - 16, Math.max(16, r.left + r.width / 2)), y: below ? r.bottom + 8 : r.top - 8, below })
      }, el.dataset.docs ? 250 : 450)
    }
    const out = (e: MouseEvent) => {
      const to = e.relatedTarget as Element | null
      if (cur.current && to && (cur.current.contains(to) || to.closest?.('.tip-card'))) return
      window.setTimeout(hide, 80)
    }
    const down = (e: MouseEvent) => { if (!(e.target as Element)?.closest?.('.tip-card')) { overTip.current = false; hide() } }
    document.addEventListener('mouseover', over)
    document.addEventListener('mouseout', out)
    document.addEventListener('mousedown', down, true)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('blur', hide)
    return () => {
      document.removeEventListener('mouseover', over)
      document.removeEventListener('mouseout', out)
      document.removeEventListener('mousedown', down, true)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('blur', hide)
      restore()
    }
  }, [])
  if (!tip) return null
  return createPortal(
    <div className={`tip-card${tip.below ? ' below' : ''}`} role="tooltip" style={{ left: tip.x, top: tip.y }}
      onMouseEnter={() => { overTip.current = true }}
      onMouseLeave={() => { overTip.current = false; setTip(null); const el = cur.current; if (el && el.dataset.tipTitle !== undefined) { el.setAttribute('title', el.dataset.tipTitle); delete el.dataset.tipTitle } cur.current = null }}>
      <span>{tip.text}</span>
      {tip.docs && <a href={docsUrl(tip.docs)} target="_blank" rel="noreferrer">Read more</a>}
    </div>,
    document.body,
  )
}

// A small "?" that explains something when you rest the mouse on it.
export function Hint({ text, docs, label }: { text: string; docs?: string; label?: string }) {
  return <span className={`hint${label ? ' with-label' : ''}`} title={text} data-docs={docs} tabIndex={0} aria-label={text}>{label ? <>{label} <i>?</i></> : <i>?</i>}</span>
}
