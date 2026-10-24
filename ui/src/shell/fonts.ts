import { useSyncExternalStore } from 'react'

// Your own fonts, for 3D text, Motion text layers and letters drawn as
// strokes. A font file (TTF, OTF, WOFF) is kept in this browser profile's
// database (fonts can be large), made usable on the page, and its outlines
// are read for 3D text. Nothing leaves the computer.

export interface FontChoice { name: string; css: string; builtIn: boolean }
const BUILT_IN: FontChoice[] = [
  { name: 'Teletactile', css: "'Teletactile', monospace", builtIn: true },
  { name: 'Courier Prime', css: "'Courier Prime', 'Courier New', monospace", builtIn: true },
  { name: 'OpenDyslexic', css: "'OpenDyslexic', sans-serif", builtIn: true },
  { name: 'Sans', css: 'system-ui, sans-serif', builtIn: true },
  { name: 'Serif', css: 'Georgia, serif', builtIn: true },
  { name: 'Impact', css: 'Impact, Haettenschweiler, sans-serif', builtIn: true },
]
const BUILT_IN_FILES: Record<string, string> = { Teletactile: '/fonts/Teletactile.ttf', OpenDyslexic: '/fonts/OpenDyslexic-Regular.ttf' }

let custom: FontChoice[] = []
const buffers = new Map<string, ArrayBuffer>()
let version = 0
const listeners = new Set<() => void>()
const emit = () => { version++; listeners.forEach((l) => l()) }

export const fontsVersion = () => version
export function onFonts(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } }
export const fontChoices = (): FontChoice[] => [...BUILT_IN, ...custom]
export function useFonts() { useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => version); return fontChoices() }

// a tiny database
function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open('rico-fonts', 1)
    r.onupgradeneeded = () => r.result.createObjectStore('fonts')
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db()
  return new Promise((res, rej) => { const r = fn(d.transaction('fonts', mode).objectStore('fonts')); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
}

async function register(name: string, buf: ArrayBuffer) {
  buffers.set(name, buf)
  try { const f = new FontFace(name, buf.slice(0)); await f.load(); document.fonts.add(f) } catch { /* the browser could not read it; 3D text may still work */ }
  if (!custom.some((c) => c.name === name)) custom = [...custom, { name, css: `'${name}', sans-serif`, builtIn: false }]
  emit()
}

let loaded = false
export async function loadFonts() {
  if (loaded) return
  loaded = true
  try {
    const keys = await tx('readonly', (s) => s.getAllKeys())
    for (const k of keys) { const buf = await tx<ArrayBuffer>('readonly', (s) => s.get(k)); if (buf) await register(String(k), buf) }
  } catch { /* no database here (a private window): fonts last until the window closes */ }
}

export async function addFont(file: File): Promise<string> {
  const name = file.name.replace(/\.(ttf|otf|woff2?)$/i, '').replace(/[^\w -]/g, ' ').trim() || 'My font'
  const buf = await file.arrayBuffer()
  try { await tx('readwrite', (s) => s.put(buf, name)) } catch { /* kept for now only */ }
  await register(name, buf)
  return name
}

export async function removeFont(name: string) {
  custom = custom.filter((c) => c.name !== name)
  buffers.delete(name)
  try { await tx('readwrite', (s) => s.delete(name)) } catch { /* fine */ }
  emit()
}

// The font file itself, for 3D text (built-in fonts come from the app).
export async function fontFile(name: string): Promise<ArrayBuffer | null> {
  const hit = buffers.get(name)
  if (hit) return hit
  const url = BUILT_IN_FILES[name]
  if (!url) return null
  try { const b = await (await fetch(url)).arrayBuffer(); buffers.set(name, b); return b } catch { return null }
}
export const fontNameOf = (css: string) => fontChoices().find((f) => f.css === css)?.name ?? css.replace(/['"]/g, '').split(',')[0].trim()
