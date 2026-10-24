import { useSyncExternalStore, type ReactNode } from 'react'

// Which overlays are open: settings, the command search, shortcuts, and
// small questions (a name, a yes or no) asked inside RICO instead of with
// the browser's own pop-ups.

export type Overlay = null | 'settings' | 'palette' | 'shortcuts' | 'about' | 'new-workspace' | 'starters'

let overlay: Overlay = null
let question: Question | null = null
let version = 0
const listeners = new Set<() => void>()

export interface Question {
  title: string
  body?: ReactNode
  input?: { label: string; value: string }
  ok: string
  cancel?: string
  danger?: boolean
  resolve: (answer: string | null) => void
}

function changed() {
  version++
  listeners.forEach((l) => l())
}

export function openOverlay(o: Overlay) {
  overlay = o
  changed()
}

export function useOverlay(): Overlay {
  useSyncExternalStore(subscribe, () => version)
  return overlay
}

export function useQuestion(): Question | null {
  useSyncExternalStore(subscribe, () => version)
  return question
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

function ask(q: Omit<Question, 'resolve'>): Promise<string | null> {
  question?.resolve(null)
  return new Promise((resolve) => {
    question = {
      ...q,
      resolve: (a) => {
        question = null
        changed()
        resolve(a)
      },
    }
    changed()
  })
}

// Asks for a line of text. Resolves to null when cancelled.
export async function askText(title: string, label: string, value = '', ok = 'OK'): Promise<string | null> {
  const a = await ask({ title, input: { label, value }, ok })
  return a === null ? null : a.trim() || null
}

export async function askYesNo(title: string, body: ReactNode, ok = 'Yes', danger = false): Promise<boolean> {
  return (await ask({ title, body, ok, cancel: 'Cancel', danger })) !== null
}

export function downloadJson(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export function pickFile(accept: string, then: (f: File) => void) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = accept
  input.onchange = () => input.files?.[0] && then(input.files[0])
  input.click()
}

export function downloadBlob(name: string, blob: Blob) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export const downloadText = (name: string, text: string, type = 'text/plain') => downloadBlob(name, new Blob([text], { type }))

// A picture file as pixels, made small (for color statistics).
export function imagePixels(file: File, maxW = 256): Promise<Uint8ClampedArray> {
  return new Promise((res, rej) => {
    const img = new Image()
    img.onload = () => {
      const k = Math.min(1, maxW / img.naturalWidth)
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(img.naturalWidth * k))
      c.height = Math.max(1, Math.round(img.naturalHeight * k))
      const ctx = c.getContext('2d')!
      ctx.drawImage(img, 0, 0, c.width, c.height)
      res(ctx.getImageData(0, 0, c.width, c.height).data)
      URL.revokeObjectURL(img.src)
    }
    img.onerror = () => rej(new Error('That picture could not be read.'))
    img.src = URL.createObjectURL(file)
  })
}
