import { useSyncExternalStore } from 'react'
import { baseUrl, http, multipart, streamSerial, type Stream } from './net'
import { END_GCODE, PRINT_DEFAULTS, START_GCODE, type Flavor, type PrintSettings } from './settings'

// Your 3D printers and how RICO reaches them. Kept on this computer only
// (keys and sign-in tokens too).

export type Link = 'klipper' | 'octoprint' | 'prusalink' | 'usb' | 'file'
export const LINKS: { id: Link; name: string; about: string }[] = [
  { id: 'klipper', name: 'Klipper (Fluidd, Mainsail)', about: 'The printer\'s address, like printer.local or 192.168.1.20. Port 7125 if the web page is on another port. Add a key or sign in if your printer asks for one.' },
  { id: 'octoprint', name: 'OctoPrint', about: 'The address and an API key (OctoPrint settings, Application keys or API).' },
  { id: 'prusalink', name: 'PrusaLink', about: 'The address and the API key from the printer\'s network settings.' },
  { id: 'usb', name: 'USB cable', about: 'The printer\'s COM port. Keep RICO open and the computer awake while it prints.' },
  { id: 'file', name: 'Save the file', about: 'Save the G-code and put it on the printer\'s SD card or USB stick.' },
]

export interface Printer {
  id: string
  name: string
  bed: [number, number, number]    // mm: width, depth, height
  center: boolean                  // 0,0 is the middle of the bed (round printers)
  nozzle: number
  filament: number
  start: string
  end: string
  link: Link
  host: string
  key: string                      // API key
  token: string                    // Klipper sign-in
  user: string
  port: string                     // COM port
  baud: number
  storage: string                  // PrusaLink: usb or local
  model?: string                   // the preset it started from
  accel?: number                   // mm/s2
  maxFlow?: number                 // mm3/s the hot end melts
  flavor?: Flavor                  // which firmware: changes how pauses, pins and pressure advance are written
  zOffset?: number
  beforeLayer?: string             // G-code before each layer change
  afterLayer?: string              // G-code after each layer change
  pauseG?: string
  changeG?: string
}

// Ready profiles for common printers: bed, how they are reached, and speeds
// that suit them. A starting point: printers differ, check yours.
export interface Model { id: string; name: string; group: string; bed: [number, number, number]; center?: boolean; link: Link; speed: number; wall: number; first: number; travel: number; accel: number; maxFlow: number; retract: number }
export const MODELS: Model[] = [
  { id: 'ender3', group: 'Creality', name: 'Ender-3, Ender-3 Pro, Ender-3 V2', bed: [220, 220, 250], link: 'usb', speed: 60, wall: 40, first: 20, travel: 150, accel: 500, maxFlow: 10, retract: 5 },
  { id: 'ender3s1', group: 'Creality', name: 'Ender-3 S1, S1 Pro', bed: [220, 220, 270], link: 'usb', speed: 80, wall: 50, first: 25, travel: 180, accel: 1000, maxFlow: 12, retract: 0.8 },
  { id: 'ender3v3se', group: 'Creality', name: 'Ender-3 V3 SE', bed: [220, 220, 250], link: 'usb', speed: 180, wall: 120, first: 30, travel: 250, accel: 2500, maxFlow: 15, retract: 0.8 },
  { id: 'ender3v3ke', group: 'Creality', name: 'Ender-3 V3 KE', bed: [220, 220, 240], link: 'klipper', speed: 220, wall: 150, first: 40, travel: 400, accel: 5000, maxFlow: 20, retract: 0.8 },
  { id: 'k1', group: 'Creality', name: 'K1, K1C', bed: [220, 220, 250], link: 'klipper', speed: 300, wall: 200, first: 50, travel: 500, accel: 10000, maxFlow: 30, retract: 0.8 },
  { id: 'k1max', group: 'Creality', name: 'K1 Max', bed: [300, 300, 300], link: 'klipper', speed: 300, wall: 200, first: 50, travel: 500, accel: 10000, maxFlow: 30, retract: 0.8 },
  { id: 'mk4', group: 'Prusa', name: 'MK4, MK4S', bed: [250, 210, 220], link: 'prusalink', speed: 160, wall: 110, first: 30, travel: 250, accel: 2500, maxFlow: 15, retract: 0.7 },
  { id: 'coreone', group: 'Prusa', name: 'Core One', bed: [250, 220, 270], link: 'prusalink', speed: 200, wall: 140, first: 30, travel: 300, accel: 4000, maxFlow: 15, retract: 0.7 },
  { id: 'mk3', group: 'Prusa', name: 'MK3S+', bed: [250, 210, 210], link: 'usb', speed: 80, wall: 45, first: 20, travel: 180, accel: 1000, maxFlow: 11, retract: 0.8 },
  { id: 'mini', group: 'Prusa', name: 'MINI+', bed: [180, 180, 180], link: 'prusalink', speed: 80, wall: 45, first: 20, travel: 180, accel: 1250, maxFlow: 11, retract: 3.2 },
  { id: 'voron24', group: 'Voron', name: 'Voron 2.4 (350)', bed: [350, 350, 340], link: 'klipper', speed: 200, wall: 120, first: 50, travel: 400, accel: 5000, maxFlow: 24, retract: 0.5 },
  { id: 'voron24-300', group: 'Voron', name: 'Voron 2.4 (300)', bed: [300, 300, 280], link: 'klipper', speed: 200, wall: 120, first: 50, travel: 400, accel: 5000, maxFlow: 24, retract: 0.5 },
  { id: 'trident', group: 'Voron', name: 'Voron Trident (300)', bed: [300, 300, 250], link: 'klipper', speed: 200, wall: 120, first: 50, travel: 400, accel: 5000, maxFlow: 24, retract: 0.5 },
  { id: 'sv06', group: 'Sovol', name: 'SV06', bed: [220, 220, 250], link: 'usb', speed: 100, wall: 60, first: 25, travel: 200, accel: 1500, maxFlow: 15, retract: 0.8 },
  { id: 'sv07', group: 'Sovol', name: 'SV07', bed: [220, 220, 240], link: 'klipper', speed: 250, wall: 150, first: 40, travel: 400, accel: 8000, maxFlow: 20, retract: 0.6 },
  { id: 'sv08', group: 'Sovol', name: 'SV08', bed: [350, 350, 345], link: 'klipper', speed: 300, wall: 180, first: 50, travel: 500, accel: 10000, maxFlow: 24, retract: 0.6 },
  { id: 'neptune4', group: 'Elegoo', name: 'Neptune 4, 4 Pro', bed: [225, 225, 265], link: 'klipper', speed: 250, wall: 150, first: 40, travel: 400, accel: 5000, maxFlow: 20, retract: 0.6 },
  { id: 'neptune4max', group: 'Elegoo', name: 'Neptune 4 Max', bed: [420, 420, 480], link: 'klipper', speed: 200, wall: 120, first: 40, travel: 350, accel: 4000, maxFlow: 20, retract: 0.6 },
  { id: 'q1pro', group: 'Qidi', name: 'Q1 Pro', bed: [245, 245, 240], link: 'klipper', speed: 300, wall: 200, first: 50, travel: 500, accel: 10000, maxFlow: 25, retract: 0.6 },
  { id: 'xplus3', group: 'Qidi', name: 'X-Plus 3', bed: [280, 280, 270], link: 'klipper', speed: 300, wall: 200, first: 50, travel: 500, accel: 10000, maxFlow: 25, retract: 0.6 },
  { id: 'v400', group: 'FLSUN', name: 'V400 (round bed)', bed: [300, 300, 410], center: true, link: 'klipper', speed: 300, wall: 200, first: 50, travel: 500, accel: 10000, maxFlow: 25, retract: 0.6 },
  { id: 'sidewinder', group: 'Artillery', name: 'Sidewinder X2', bed: [300, 300, 400], link: 'usb', speed: 60, wall: 40, first: 20, travel: 150, accel: 1000, maxFlow: 12, retract: 0.8 },
  { id: 'generic-slow', group: 'Any printer', name: 'Most older printers', bed: [220, 220, 250], link: 'file', speed: 60, wall: 40, first: 20, travel: 150, accel: 500, maxFlow: 10, retract: 5 },
  { id: 'generic-fast', group: 'Any printer', name: 'Most Klipper printers', bed: [235, 235, 250], link: 'klipper', speed: 200, wall: 120, first: 40, travel: 350, accel: 5000, maxFlow: 20, retract: 0.6 },
]

// Picks a profile: the printer gets its size and speeds; the address stays.
export function applyModel(p: Printer, id: string) {
  const m = MODELS.find((x) => x.id === id)
  if (!m) return
  updatePrinter(p.id, { model: m.id, name: p.name === 'My printer' || MODELS.some((x) => x.name === p.name) ? m.name : p.name, bed: [...m.bed], center: Boolean(m.center), accel: m.accel, maxFlow: m.maxFlow, link: p.link === 'file' || !p.host ? m.link : p.link, flavor: m.link === 'klipper' ? 'klipper' : 'marlin' })
  setSettings({ speed: m.speed, wallSpeed: m.wall, firstSpeed: m.first, travel: m.travel, retract: m.retract })
}

export interface Material { id: string; name: string; nozzle: number; bed: number; fan: number; about: string }
export const MATERIALS: Material[] = [
  { id: 'pla', name: 'PLA', nozzle: 210, bed: 60, fan: 1, about: 'Easy. Use black (matte if you have it) for gobos: it blocks the most light.' },
  { id: 'petg', name: 'PETG', nozzle: 240, bed: 80, fan: 0.5, about: 'Stands more heat than PLA. Good next to a warm projector.' },
  { id: 'abs', name: 'ABS or ASA', nozzle: 250, bed: 100, fan: 0, about: 'Takes the most heat. Needs an enclosure.' },
]

// Ready printer sizes; pick one that matches yours, then change what differs.
export const BEDS: { id: string; name: string; bed: [number, number, number]; center?: boolean }[] = [
  { id: '180', name: 'Small, 180 x 180', bed: [180, 180, 180] },
  { id: '220', name: 'Common, 220 x 220', bed: [220, 220, 250] },
  { id: '235', name: '235 x 235', bed: [235, 235, 250] },
  { id: '250', name: '250 x 210', bed: [250, 210, 220] },
  { id: '256', name: '256 x 256', bed: [256, 256, 256] },
  { id: '300', name: 'Large, 300 x 300', bed: [300, 300, 400] },
  { id: '350', name: 'Large, 350 x 350', bed: [350, 350, 350] },
  { id: 'round', name: 'Round bed, 200 across', bed: [200, 200, 300], center: true },
]

const rid = () => `p${Math.random().toString(36).slice(2, 8)}`
export function newPrinter(part: Partial<Printer> = {}): Printer {
  return {
    id: rid(), name: 'My printer', bed: [220, 220, 250], center: false, nozzle: 0.4, filament: 1.75, start: START_GCODE, end: END_GCODE,
    link: 'file', host: '', key: '', token: '', user: '', port: 'COM3', baud: 115200, storage: 'usb', ...part,
  }
}

const KEY = 'rico.printers'
const KEY_SET = 'rico.print.settings'
interface Store { printers: Printer[]; current: string }
let store: Store | null = null
let version = 0
const ls = new Set<() => void>()
function load(): Store {
  if (store) return store
  try { const s = JSON.parse(localStorage.getItem(KEY) ?? 'null'); if (s?.printers?.length) store = { printers: s.printers.map((p: Printer) => newPrinter(p)), current: s.current } } catch { /* new */ }
  if (!store) { const p = newPrinter(); store = { printers: [p], current: p.id } }
  return store
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(store)) } catch { /* not kept */ } version++; ls.forEach((l) => l()) }
export function usePrinters() { useSyncExternalStore((l) => { ls.add(l); return () => ls.delete(l) }, () => version); return load() }
export function currentPrinter(): Printer { const s = load(); return s.printers.find((p) => p.id === s.current) ?? s.printers[0] }
export function setCurrent(id: string) { load().current = id; save() }
export function updatePrinter(id: string, part: Partial<Printer>) { const s = load(); s.printers = s.printers.map((p) => (p.id === id ? { ...p, ...part } : p)); save() }
export function addPrinter(p: Printer) { const s = load(); s.printers = [...s.printers, p]; s.current = p.id; save() }
export function removePrinter(id: string) { const s = load(); if (s.printers.length < 2) return; s.printers = s.printers.filter((p) => p.id !== id); if (s.current === id) s.current = s.printers[0].id; save() }

// The print settings (layer height, infill...), one set for all printers.
export interface PrintChoice extends PrintSettings { material: string }
let settings: PrintChoice | null = null
export function getSettings(): PrintChoice {
  if (settings) return settings
  try { const s = JSON.parse(localStorage.getItem(KEY_SET) ?? 'null'); if (s) settings = { ...PRINT_DEFAULTS, material: 'pla', ...s } } catch { /* defaults */ }
  // settings from before the top and the bottom were set apart
  if (settings && settings.topLayers === undefined) settings = { ...settings, topLayers: settings.solidLayers, bottomLayers: settings.solidLayers }
  return (settings ??= { ...PRINT_DEFAULTS, infill: 1, material: 'pla' })
}
export function setSettings(part: Partial<PrintChoice>) { settings = { ...getSettings(), ...part }; try { localStorage.setItem(KEY_SET, JSON.stringify(settings)) } catch { /* not kept */ } version++; ls.forEach((l) => l()) }

// Ready settings: a gobo must be solid (light goes through infill).
export const QUALITY: { id: string; name: string; about: string; part: Partial<PrintSettings> }[] = [
  { id: 'gobo', name: 'Gobo (solid)', about: 'Solid, so no light leaks through. 0.2 mm layers.', part: { layer: 0.2, firstLayer: 0.2, perimeters: 2, infill: 1, solidLayers: 4, topLayers: 4, bottomLayers: 4 } },
  { id: 'fine', name: 'Fine', about: '0.12 mm layers, slower, smoother sides.', part: { layer: 0.12, firstLayer: 0.2, perimeters: 3, infill: 0.2, solidLayers: 6, topLayers: 6, bottomLayers: 6 } },
  { id: 'normal', name: 'Normal', about: '0.2 mm layers, 20% infill.', part: { layer: 0.2, firstLayer: 0.2, perimeters: 2, infill: 0.2, solidLayers: 4, topLayers: 4, bottomLayers: 4 } },
  { id: 'draft', name: 'Fast', about: '0.28 mm layers, 15% infill.', part: { layer: 0.28, firstLayer: 0.28, perimeters: 2, infill: 0.15, solidLayers: 3, topLayers: 3, bottomLayers: 3 } },
]

// talking to the printer

export interface PrinterStatus { state: string; progress: number; file: string; nozzle?: [number, number]; bed?: [number, number]; error?: string; layer?: number; layers?: number }

const headersFor = (p: Printer): Record<string, string> => {
  const h: Record<string, string> = {}
  if (p.link === 'klipper') { if (p.token) h.Authorization = `Bearer ${p.token}`; else if (p.key) h['X-Api-Key'] = p.key }
  if ((p.link === 'octoprint' || p.link === 'prusalink') && p.key) h['X-Api-Key'] = p.key
  return h
}
const why = (status: number, text: string, fallback: string) => {
  if (status === 401 || status === 403) return 'The printer said no: check the key, or sign in again.'
  if (status === 0) return text || fallback
  return `${fallback} (${status})`
}

// Klipper sign-in: user name and password give a token; the password is not kept.
export async function klipperSignIn(p: Printer, user: string, password: string): Promise<string> {
  const a = await http('POST', `${baseUrl(p.host)}/access/login`, { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: user, password, source: 'moonraker' }) })
  const t = a.json<{ result?: { token?: string } }>()?.result?.token
  if (!a.ok || !t) return why(a.status, a.error ?? '', 'Could not sign in')
  updatePrinter(p.id, { token: t, user })
  return ''
}

export async function testPrinter(p: Printer): Promise<string> {
  const u = baseUrl(p.host)
  if (p.link === 'usb') return ''
  if (!u) return 'Type the printer\'s address first.'
  const path = p.link === 'klipper' ? '/server/info' : p.link === 'octoprint' ? '/api/version' : '/api/version'
  const a = await http('GET', u + path, { headers: headersFor(p), timeout: 6000 })
  if (!a.ok) return why(a.status, a.error ?? '', 'The printer did not answer')
  return ''
}

export async function printerStatus(p: Printer): Promise<PrinterStatus> {
  const u = baseUrl(p.host)
  const h = headersFor(p)
  if (p.link === 'klipper') {
    const a = await http('GET', `${u}/printer/objects/query?print_stats&virtual_sdcard&extruder&heater_bed`, { headers: h, timeout: 5000 })
    const s = a.json<{ result?: { status?: { print_stats?: { state?: string; filename?: string; info?: { current_layer?: number | null; total_layer?: number | null } }; virtual_sdcard?: { progress?: number }; extruder?: { temperature?: number; target?: number }; heater_bed?: { temperature?: number; target?: number } } } }>()?.result?.status
    if (!a.ok || !s) return { state: 'offline', progress: 0, file: '', error: why(a.status, a.error ?? '', 'No answer') }
    return { state: s.print_stats?.state ?? 'ready', progress: s.virtual_sdcard?.progress ?? 0, file: s.print_stats?.filename ?? '', nozzle: [s.extruder?.temperature ?? 0, s.extruder?.target ?? 0], bed: [s.heater_bed?.temperature ?? 0, s.heater_bed?.target ?? 0], layer: s.print_stats?.info?.current_layer ?? undefined, layers: s.print_stats?.info?.total_layer ?? undefined }
  }
  if (p.link === 'octoprint') {
    const a = await http('GET', `${u}/api/job`, { headers: h, timeout: 5000 })
    const j = a.json<{ state?: string; progress?: { completion?: number }; job?: { file?: { name?: string } } }>()
    if (!a.ok || !j) return { state: 'offline', progress: 0, file: '', error: why(a.status, a.error ?? '', 'No answer') }
    const t = (await http('GET', `${u}/api/printer`, { headers: h, timeout: 5000 })).json<{ temperature?: { tool0?: { actual: number; target: number }; bed?: { actual: number; target: number } } }>()
    return { state: (j.state ?? 'ready').toLowerCase(), progress: (j.progress?.completion ?? 0) / 100, file: j.job?.file?.name ?? '', nozzle: t?.temperature?.tool0 ? [t.temperature.tool0.actual, t.temperature.tool0.target] : undefined, bed: t?.temperature?.bed ? [t.temperature.bed.actual, t.temperature.bed.target] : undefined }
  }
  if (p.link === 'prusalink') {
    const a = await http('GET', `${u}/api/v1/status`, { headers: h, timeout: 5000 })
    const j = a.json<{ printer?: { state?: string; temp_nozzle?: number; target_nozzle?: number; temp_bed?: number; target_bed?: number }; job?: { progress?: number } }>()
    if (!a.ok || !j) return { state: 'offline', progress: 0, file: '', error: why(a.status, a.error ?? '', 'No answer') }
    return { state: (j.printer?.state ?? 'idle').toLowerCase(), progress: (j.job?.progress ?? 0) / 100, file: '', nozzle: [j.printer?.temp_nozzle ?? 0, j.printer?.target_nozzle ?? 0], bed: [j.printer?.temp_bed ?? 0, j.printer?.target_bed ?? 0] }
  }
  return { state: 'ready', progress: 0, file: '' }
}

// Sends the G-code to the printer and starts the print.
export async function sendToPrinter(p: Printer, name: string, text: string, startNow: boolean, on: { progress: (f: number) => void; log: (t: string) => void; marker?: (t: string) => boolean | void }): Promise<{ error: string; stream?: Stream }> {
  const file = fileNameFor(name)
  const data = new TextEncoder().encode(text)
  const u = baseUrl(p.host)
  const h = headersFor(p)
  if (p.link === 'klipper') {
    const m = multipart({ root: 'gcodes', print: startNow ? 'true' : 'false' }, { field: 'file', name: file, type: 'text/x-gcode', data })
    const a = await http('POST', `${u}/server/files/upload`, { headers: { ...h, 'Content-Type': m.type }, body: m.body, timeout: 120000 })
    return { error: a.ok ? '' : why(a.status, a.error ?? '', 'The upload did not work') }
  }
  if (p.link === 'octoprint') {
    const m = multipart({ select: startNow ? 'true' : 'false', print: startNow ? 'true' : 'false' }, { field: 'file', name: file, type: 'text/x-gcode', data })
    const a = await http('POST', `${u}/api/files/local`, { headers: { ...h, 'Content-Type': m.type }, body: m.body, timeout: 120000 })
    return { error: a.ok ? '' : why(a.status, a.error ?? '', 'The upload did not work') }
  }
  if (p.link === 'prusalink') {
    const a = await http('PUT', `${u}/api/v1/files/${p.storage || 'usb'}/${encodeURIComponent(file)}`, {
      headers: { ...h, 'Content-Type': 'text/x.gcode', 'Print-After-Upload': startNow ? '?1' : '?0', Overwrite: '?1' }, body: data, timeout: 120000,
    })
    return { error: a.ok ? '' : why(a.status, a.error ?? '', 'The upload did not work') }
  }
  if (p.link === 'usb') {
    let failed = ''
    const stream = streamSerial(p.port, p.baud, text.split('\n'), 'marlin', { progress: (d, t) => on.progress(t ? d / t : 0), log: on.log, error: (e) => { failed = e; on.log(e) }, marker: on.marker })
    await new Promise((r) => window.setTimeout(r, 300))
    return { error: failed, stream }
  }
  return { error: '' }
}

export async function printerCommand(p: Printer, what: 'pause' | 'resume' | 'cancel'): Promise<string> {
  const u = baseUrl(p.host)
  const h = headersFor(p)
  let a
  if (p.link === 'klipper') a = await http('POST', `${u}/printer/print/${what}`, { headers: h })
  else if (p.link === 'octoprint') a = await http('POST', `${u}/api/job`, { headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify(what === 'cancel' ? { command: 'cancel' } : { command: 'pause', action: what }) })
  else if (p.link === 'prusalink') {
    const st = (await http('GET', `${u}/api/v1/status`, { headers: h })).json<{ job?: { id?: number } }>()
    const id = st?.job?.id
    if (!id) return 'Nothing is printing.'
    a = what === 'cancel' ? await http('DELETE', `${u}/api/v1/job/${id}`, { headers: h }) : await http('PUT', `${u}/api/v1/job/${id}/${what}`, { headers: h })
  } else return ''
  return a.ok ? '' : why(a.status, a.error ?? '', 'The printer did not take it')
}

// Starts a file that is already on the printer (to print it again).
export async function startFile(p: Printer, file: string): Promise<string> {
  const u = baseUrl(p.host)
  const h = headersFor(p)
  let a
  if (p.link === 'klipper') a = await http('POST', `${u}/printer/print/start?filename=${encodeURIComponent(file)}`, { headers: h })
  else if (p.link === 'octoprint') a = await http('POST', `${u}/api/files/local/${encodeURIComponent(file)}`, { headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ command: 'select', print: true }) })
  else if (p.link === 'prusalink') a = await http('POST', `${u}/api/v1/files/${p.storage || 'usb'}/${encodeURIComponent(file)}`, { headers: h })
  else return ''
  return a.ok ? '' : why(a.status, a.error ?? '', 'The printer did not start it')
}

export const fileNameFor = (name: string) => `${name.replace(/[^\w\-.]+/g, '-')}.gcode`
