import { useEffect, useState } from 'react'

// Short messages after an action, in the corner. Errors stay until
// clicked, good news fades by itself.

type Toast = { id: number; text: string; good: boolean }
let push: (t: Omit<Toast, 'id'>) => void = () => {}
let nextId = 1

export function toast(text: string, good = false) {
  push({ text, good })
}

export default function Toasts() {
  const [items, setItems] = useState<Toast[]>([])
  useEffect(() => {
    push = (t) => {
      const item = { ...t, id: nextId++ }
      setItems((list) => [...list.slice(-3), item])
      if (t.good) window.setTimeout(() => setItems((list) => list.filter((x) => x.id !== item.id)), 2600)
    }
  }, [])
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast${t.good ? ' good' : ''}`} onClick={() => setItems((l) => l.filter((x) => x.id !== t.id))}>
          {t.text}
        </div>
      ))}
    </div>
  )
}
