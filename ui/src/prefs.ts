import { useEffect, useState } from 'react'
import { setFaviconStyle } from './shell/favicon'

// Interface preferences, kept in this browser profile. Inside RICO that
// profile lives in RICO's data folder, so it travels with a USB install.

export interface Palette {
  live: string    // connected, active, buttons (lime in the default look)
  out: string     // signals going out (pink)
  in: string      // signals coming in (blue)
  bg: string      // background
  text: string    // reading text
}

export interface Prefs {
  scanlines: boolean
  calm: boolean          // no decorative motion
  scale: number          // text size
  fit: 'auto' | 'manual' // interface size: fit the screen, or your own
  zoom: number           // interface size when manual (1 = 100%)
  dyslexic: boolean
  boot: boolean          // show the start-up sequence
  theme: string          // a name from THEMES, or 'custom'
  custom: Palette
}

export const THEMES: { id: string; name: string; colors: Palette }[] = [
  { id: 'terminal', name: 'Terminal', colors: { live: '#3bff03', out: '#f820a0', in: '#002cf8', bg: '#000000', text: '#ffffff' } },
  { id: 'chroma', name: 'Chroma', colors: { live: '#b9a8ff', out: '#ff4fd8', in: '#4ff3ff', bg: '#05040a', text: '#ffffff' } },
  { id: 'amber', name: 'Amber', colors: { live: '#ffb000', out: '#ff4f3a', in: '#3aa0ff', bg: '#050300', text: '#fff4e0' } },
  { id: 'ice', name: 'Ice', colors: { live: '#4ff3ff', out: '#ff4fd8', in: '#3d5cff', bg: '#01050a', text: '#eefcff' } },
  { id: 'rose', name: 'Rose', colors: { live: '#ff4fd8', out: '#ffb347', in: '#4f7bff', bg: '#07020a', text: '#fff0fb' } },
  { id: 'mono', name: 'Mono', colors: { live: '#f2f2f2', out: '#ff3b3b', in: '#7d8cff', bg: '#000000', text: '#ffffff' } },
]

const KEY = 'rico.prefs'
const DEFAULTS: Prefs = {
  scanlines: true, calm: false, scale: 1, fit: 'auto', zoom: 1, dyslexic: false, boot: true,
  theme: 'terminal', custom: THEMES[0].colors,
}

function load(): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return { ...DEFAULTS, ...saved, custom: { ...DEFAULTS.custom, ...(saved.custom ?? {}) } }
  } catch {
    return DEFAULTS
  }
}

let current = load()
const listeners = new Set<(p: Prefs) => void>()

export function setPrefs(part: Partial<Prefs>) {
  current = { ...current, ...part }
  try {
    localStorage.setItem(KEY, JSON.stringify(current))
  } catch {
    /* private window: keep the change for this session only */
  }
  apply(current)
  listeners.forEach((l) => l(current))
}

// colors

type RGB = [number, number, number]
const rgb = (hex: string): RGB => {
  const h = hex.replace('#', '')
  const v = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16) || 0
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}
const hex = (c: number[]) => '#' + c.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('')
const mix = (a: string, b: string, t: number) => {
  const A = rgb(a), B = rgb(b)
  return hex([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t])
}
const luminance = (c: string) => {
  const [r, g, b] = rgb(c).map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function paletteOf(p: Prefs): Palette {
  return p.theme === 'custom' ? p.custom : THEMES.find((t) => t.id === p.theme)?.colors ?? THEMES[0].colors
}

// Everything else is worked out from five colors, so any palette keeps the
// same structure: dim lines in the live color, readable blue, quiet panels.
export function themeVars(c: Palette): Record<string, string> {
  const inRead = luminance(c.in) < 0.18 ? mix(c.in, '#ffffff', 0.45) : c.in
  return {
    '--bg': c.bg,
    '--text': c.text,
    '--lime': c.live,
    '--lime-rgb': rgb(c.live).join(', '),
    '--pink': c.out,
    '--pink-rgb': rgb(c.out).join(', '),
    '--blue': c.in,
    '--blue-rgb': rgb(c.in).join(', '),
    '--blue-read': inRead,
    '--blue-deep': mix(c.bg, c.in, 0.12),
    '--line': mix(c.bg, c.live, 0.27),
    '--panel': mix(c.bg, c.live, 0.025),
    '--panel-0': mix(c.bg, c.live, 0.012),
    '--panel-2': mix(c.bg, c.live, 0.08),
    '--muted': mix(c.text, mix(c.bg, c.live, 0.5), 0.3),
    '--dim': mix(c.text, c.bg, 0.55),
    '--on-accent': luminance(c.live) > 0.3 ? '#000000' : '#ffffff',
  }
}

export function apply(p: Prefs) {
  const b = document.body.classList
  b.toggle('scanlines', p.scanlines)
  b.toggle('calm', p.calm)
  b.toggle('dyslexic', p.dyslexic)
  const root = document.documentElement.style
  root.setProperty('--ui-scale', String(p.scale))
  applyZoom(p)
  const palette = paletteOf(p)
  for (const [k, v] of Object.entries(themeVars(palette))) root.setProperty(k, v)
  setFaviconStyle(palette.live, p.calm)
}

export function usePrefs(): Prefs {
  const [p, setP] = useState(current)
  useEffect(() => {
    listeners.add(setP)
    return () => {
      listeners.delete(setP)
    }
  }, [])
  return p
}

export const initialPrefs = () => current

// The size of the whole interface. Auto fits RICO to the window it is in, so
// every panel and button stays on screen and readable; manual is yours.
// Inside RICO this is the window's own zoom (like Ctrl + and - in a browser),
// so every click and drag stays exact. In a plain browser, use its zoom.
let applied = 1
export function autoZoom(w = window.innerWidth * applied, h = window.innerHeight * applied): number {
  const z = Math.min(w / 1500, h / 880)
  return Math.round(Math.max(0.7, Math.min(1.35, z)) * 20) / 20
}
export function interfaceZoom(p: Prefs = current): number {
  return p.fit === 'manual' ? Math.max(0.5, Math.min(2, p.zoom || 1)) : autoZoom()
}
let resizeHooked = false
function applyZoom(p: Prefs) {
  const z = interfaceZoom(p)
  if (Math.abs(z - applied) > 0.01) {
    void import('./engine/connection').then(({ rico }) => {
      if (rico.get().status !== 'live') return
      void rico.send('app.zoom', { zoom: z }).then((a) => { if (a.ok) applied = Number((a as { zoom?: number }).zoom ?? z) || z })
    }).catch(() => { /* not inside RICO */ })
  }
  if (!resizeHooked) {
    resizeHooked = true
    let t = 0
    window.addEventListener('resize', () => { window.clearTimeout(t); t = window.setTimeout(() => applyZoom(current), 200) })
    // once RICO answers, set the size
    void import('./engine/connection').then(({ rico }) => { const off = rico.subscribe(() => { if (rico.get().status === 'live') { off(); applyZoom(current) } }) }).catch(() => {})
  }
}
