import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'

// The guided tour: it opens each
// part of RICO, points at it and says what it is for, one step at a time.

export interface Step {
  ws?: string                       // workspace to open
  panel?: string                    // panel to show in it
  target?: string                   // CSS selector to point at
  text?: string                     // ...or the element with this text (with target as the selector)
  title: string
  body: string
}

export const TOUR: Step[] = [
  { title: 'Welcome to RICO', body: 'RICO takes what comes in (knobs, music, OSC, a phone) and turns it into what goes out: visuals, light, sound, MIDI and OSC. This tour shows each part in about two minutes. You can stop any time with Esc.' },
  { target: '.ws-tablist', title: 'Workspaces', body: 'Each tab up here is a workspace with its own panels. Drag panels to split the screen, pop them out to another monitor, or make your own workspace with +.' },
  { target: '.search', title: 'Search anything', body: 'Ctrl+K finds every command, panel, setting and script. If you forget where something is, start here.' },
  { ws: 'patch', panel: 'signal-path', target: '.dpanel', title: 'Overview', body: 'The signal path shows what comes in, what RICO does with it and where it goes. Routes connect any input to any output.' },
  { ws: 'midi', panel: 'mappings', target: '.dpanel', title: 'MIDI', body: 'Turn a knob and RICO learns it. Send MIDI to other apps through virtual ports, run a MIDI clock, and write rules like "when this note comes in, send that".' },
  { ws: 'audio', panel: 'audio-lab', target: '.lab-spectrum', title: 'Audio lab', body: 'Listen to system audio, a mic or a file. Make bands and name them, shape the sound, and see if it is speech, music or effects. Every band is a signal anything can follow.' },
  { ws: 'audio', panel: 'sound-editor', target: '.sound-editor', title: 'Sound editor', body: 'A multitrack session: record, cut, fade, live effects on each track, and play instruments from your keyboard or a MIDI keyboard.' },
  { ws: 'create', panel: 'create-preview', target: '.viewer', title: 'Motion', body: 'Motion graphics that stay live. Layers, masks, track mattes, effects, your own GLSL shaders. Ctrl+Y makes a solid, Ctrl+Shift+K changes any layer.' },
  { ws: 'create', panel: 'timeline', target: '.tl', title: 'Timeline', body: 'Keyframes for any setting, cues that fire once (pink) and sends that stream OSC, MIDI or DMX (blue). Render a video, or play it live.' },
  { ws: '3d', target: '.three', title: '3D', body: 'Add shapes, model and sculpt them (Tab), paint on them with a pen, import FBX, OBJ and GLB, build your own materials, and link anything to the music.' },
  { ws: 'mapping', panel: 'mapping', target: '.mp', title: 'Projection mapping', body: 'Warp pictures onto real things. Make masks from a photo or from a 3D object, calibrate a projector in 3D, and 3D print a gobo that blocks stray light.' },
  { ws: 'light', panel: 'light-desk', target: '.desk', title: 'Lighting desk', body: 'Patch fixtures, set color and position, run effects in time with the music and store cues with fades. RICO sends Art-Net or sACN.' },
  { ws: 'devices', panel: 'phone', target: '.pc', title: 'Phone controls', body: 'Build faders, buttons and XY pads, then scan the QR code with your phone. They send OSC, MIDI, DMX, MQTT, UDP, web addresses or RICO signals.' },
  { title: 'That is RICO', body: 'Start from a starter project (File > Starter projects), or open the Overview tab any time for ideas. Help > Take the tour shows this again.' },
]

let step = -1
let version = 0
const listeners = new Set<() => void>()
const emit = () => { version++; listeners.forEach((l) => l()) }
export function startTour() { step = 0; emit() }
export function stopTour() { step = -1; emit(); try { localStorage.setItem('rico.toured', '1') } catch { /* fine */ } }
export const toured = () => { try { return localStorage.getItem('rico.toured') === '1' } catch { return true } }

async function show(s: Step) {
  if (!s.ws) return
  const w = await import('./workspaces')
  w.goTo(s.ws)
  if (s.panel) {
    await new Promise((r) => setTimeout(r, 150))
    const api = w.dockApi()
    if (api) { const ws = await import('./Workspace'); ws.openPanel(api, s.panel) }
  }
}

function find(s: Step): Element | null {
  if (!s.target) return null
  const all = [...document.querySelectorAll(s.target)].filter((e) => (e as HTMLElement).offsetParent !== null)
  if (s.text) return all.find((e) => e.textContent?.includes(s.text!)) ?? null
  return all[0] ?? null
}

export default function TourOverlay() {
  useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => version)
  const [box, setBox] = useState<DOMRect | null>(null)
  const s = step >= 0 ? TOUR[step] : null

  useEffect(() => { if (s) void show(s) }, [s])
  useLayoutEffect(() => {
    if (!s) return
    let raf = 0
    const loop = () => { raf = requestAnimationFrame(loop); const el = find(s); const r = el?.getBoundingClientRect() ?? null; setBox((b) => (b && r && b.x === r.x && b.y === r.y && b.width === r.width && b.height === r.height ? b : r)) }
    loop()
    return () => cancelAnimationFrame(raf)
  }, [s])
  useEffect(() => {
    if (!s) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') stopTour()
      else if (e.key === 'ArrowRight' || e.key === 'Enter') { if (step < TOUR.length - 1) { step++; emit() } else stopTour() }
      else if (e.key === 'ArrowLeft' && step > 0) { step--; emit() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [s])
  if (!s) return null

  const pad = 6
  const vw = window.innerWidth, vh = window.innerHeight
  const hole = box ? { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), w: Math.min(vw, box.width + pad * 2), h: Math.min(vh, box.height + pad * 2) } : null
  // The bubble goes where there is room: below, above, or in the middle.
  let bx = vw / 2 - 190, by = vh / 2 - 110
  if (hole) {
    const below = vh - (hole.y + hole.h), above = hole.y
    bx = Math.max(12, Math.min(vw - 392, hole.x + hole.w / 2 - 190))
    if (below > 220) by = hole.y + hole.h + 12
    else if (above > 220) by = hole.y - 12 - 200
    else { by = Math.min(vh - 230, hole.y + 20); bx = Math.max(12, Math.min(vw - 392, hole.x + 20)) }
  }
  return createPortal(
    <div className="tour" role="dialog" aria-label={`Tour: ${s.title}`}>
      <svg className="tour-shade" width={vw} height={vh}>
        <defs><mask id="tour-hole"><rect width={vw} height={vh} fill="#fff" />{hole && <rect x={hole.x} y={hole.y} width={hole.w} height={hole.h} rx={6} fill="#000" />}</mask></defs>
        <rect width={vw} height={vh} fill="rgba(0,0,0,0.62)" mask="url(#tour-hole)" />
        {hole && <rect x={hole.x} y={hole.y} width={hole.w} height={hole.h} rx={6} className="tour-ring" />}
      </svg>
      <div className="tour-bubble" style={{ left: bx, top: by }}>
        <div className="tour-count">{step + 1} / {TOUR.length}</div>
        <h3>{s.title}</h3>
        <p>{s.body}</p>
        <div className="row gap">
          <button className="btn small quiet" onClick={stopTour}>Skip</button>
          <span className="grow" />
          {step > 0 && <button className="btn small quiet" onClick={() => { step--; emit() }}>Back</button>}
          <button className="btn small primary" autoFocus onClick={() => { if (step < TOUR.length - 1) { step++; emit() } else stopTour() }}>{step < TOUR.length - 1 ? 'Next' : 'Done'}</button>
        </div>
        <div className="tour-dots">{TOUR.map((_, i) => <i key={i} className={i === step ? 'on' : i < step ? 'done' : ''} />)}</div>
      </div>
    </div>,
    document.body,
  )
}
