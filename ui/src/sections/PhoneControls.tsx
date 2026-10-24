import { ToolBtn, ToolGroup } from '../components/ToolStrip'
import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { toast } from '../components/Toasts'
import { rico } from '../engine/connection'
import { useRico } from '../engine/store'
import { pickFile } from '../shell/ui'
import SurfaceView from '../phone/SurfaceView'
import {
  deviceAspect, hasY, isDesign, KIND_GROUPS, KIND_NAME, newControl, newSend, newSurface, setSurfaces, shrinkImage, startPhoneHost, useSurfaces,
  type ControlKind, type Device, type PControl, type Send, type SendKind, type Surface,
} from '../phone/surfaces'

// Build a control surface for a phone or a tablet, then open it there with
// a QR code. Faders, knobs, pads, step sequencers, tilt and more send OSC,
// MIDI, DMX, or signals anything in RICO can follow ("phone:<name>").
// Titles, text, logos, pictures and a background design the page.

const SEND_LABEL: Record<SendKind, string> = { signal: 'RICO signal (anything can follow it)', osc: 'OSC (to your OSC outputs)', 'osc-to': 'OSC to an app or device', 'midi-cc': 'MIDI CC', 'midi-note': 'MIDI note', dmx: 'DMX channel (Art-Net, sACN)', mqtt: 'MQTT topic', udp: 'UDP text', http: 'Web address (HTTP)', go: 'Lighting desk GO' }
const Y_TITLE: Partial<Record<ControlKind, [string, string]>> = {
  xy: ['Left and right sends', 'Up and down sends'], range: ['Low end sends', 'High end sends'],
  color: ['Color (hue) sends', 'Strength (saturation) sends'], tilt: ['Tilt left and right sends', 'Tilt forward and back sends'],
}
const KIND_TIP: Partial<Record<ControlKind, string>> = {
  pads: 'Each pad sends to the next number (MIDI note or CC, DMX channel), or adds -2, -3... to the signal name and /2, /3... to the OSC address.',
  radio: 'Sends the first choice as the lowest value and the last as the highest.',
  steps: 'Each lit step sends a short press, in time. Play, tempo and steps work on the phone.',
  tap: 'Tap with the beat. Sends the tempo: 40 bpm is the lowest value, 240 the highest. Set From 40 and to 240 to send the bpm itself.',
  tilt: 'Uses the motion sensor of the phone or tablet. Some browsers only share it on secure (https) pages, and iPhones ask once.',
  encoder: 'Turns forever: after the highest value it starts again at the lowest.',
  cross: 'Double tap to put it back in the middle.',
}

function SendEditor({ s, onChange, title }: { s: Send; onChange: (s: Send) => void; title: string }) {
  return (
    <fieldset className="pc-send"><legend>{title}</legend>
      <select className="select" value={s.kind} onChange={(e) => onChange({ ...s, kind: e.target.value as SendKind })}>
        {Object.entries(SEND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      {s.kind === 'signal' && <label className="mini">Name <input className="input" value={s.name} onChange={(e) => onChange({ ...s, name: e.target.value.replace(/\s+/g, '-') })} /></label>}
      {s.kind === 'osc' && <label className="mini">Address <input className="input" value={s.address} onChange={(e) => onChange({ ...s, address: e.target.value })} /></label>}
      {(s.kind === 'osc-to' || s.kind === 'udp') && <div className="row gap">
        <label className="mini">Host <input className="input" value={s.host ?? '127.0.0.1'} onChange={(e) => onChange({ ...s, host: e.target.value.trim() })} style={{ width: 120 }} /></label>
        <label className="mini">Port <input className="input num" type="number" min={1} max={65535} value={s.port ?? 9000} onChange={(e) => onChange({ ...s, port: Number(e.target.value) })} style={{ width: 72 }} /></label>
      </div>}
      {s.kind === 'osc-to' && <label className="mini">Address <input className="input" value={s.address} onChange={(e) => onChange({ ...s, address: e.target.value })} /></label>}
      {s.kind === 'udp' && <label className="mini">Text <input className="input" value={s.address || '{name}:{value}'} onChange={(e) => onChange({ ...s, address: e.target.value })} /></label>}
      {s.kind === 'mqtt' && <label className="mini">Topic <input className="input" value={s.address || `rico/${s.name}`} onChange={(e) => onChange({ ...s, address: e.target.value })} /></label>}
      {s.kind === 'http' && <label className="mini">Address <input className="input" placeholder="http://192.168.1.50/win&A={value}" value={s.url ?? ''} onChange={(e) => onChange({ ...s, url: e.target.value })} /></label>}
      {(s.kind === 'udp' || s.kind === 'http') && <span className="dim small">{'{value}'} becomes the number (0 to 1 times your range), {'{name}'} the control's name.</span>}
      {(s.kind === 'midi-cc' || s.kind === 'midi-note') && <div className="row gap">
        <label className="mini">Channel <input className="input num" type="number" min={1} max={16} value={s.channel} onChange={(e) => onChange({ ...s, channel: Number(e.target.value) })} style={{ width: 56 }} /></label>
        <label className="mini">{s.kind === 'midi-cc' ? 'CC' : 'Note'} <input className="input num" type="number" min={0} max={127} value={s.number} onChange={(e) => onChange({ ...s, number: Number(e.target.value) })} style={{ width: 56 }} /></label>
      </div>}
      {s.kind === 'dmx' && <label className="mini">Channel <input className="input num" type="number" min={1} max={512} value={s.number} onChange={(e) => onChange({ ...s, number: Number(e.target.value) })} style={{ width: 64 }} /></label>}
      {s.kind === 'signal' && <span className="dim small">Link any setting to "phone:{s.name}".</span>}
    </fieldset>
  )
}

// The page with handles on top: drag to move, drag the corner to size.
function GridEditor({ s, sel, onSel, onChange }: { s: Surface; sel: string | null; onSel: (id: string | null) => void; onChange: (c: PControl) => void }) {
  const box = useRef<HTMLDivElement | null>(null)
  const drag = useRef<{ id: string; mode: 'move' | 'size'; x0: number; y0: number; c: PControl } | null>(null)
  const cell = () => { const r = box.current!.getBoundingClientRect(); return [r.width / s.cols, r.height / s.rows] }
  const gap = `${s.gap ?? 8}px`
  return (
    <div className="pc-grid">
      <SurfaceView s={s} preview />
      <div className="pc-handles" ref={box}
        style={{ gridTemplateColumns: `repeat(${s.cols}, 1fr)`, gridTemplateRows: `repeat(${s.rows}, 1fr)`, gap, padding: gap, backgroundSize: `${100 / s.cols}% ${100 / s.rows}%` }}
        onPointerDown={(e) => { if (e.target === e.currentTarget) onSel(null) }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          const [cw, ch] = cell()
          const dx = Math.round((e.clientX - d.x0) / cw), dy = Math.round((e.clientY - d.y0) / ch)
          if (d.mode === 'move') onChange({ ...d.c, x: Math.max(0, Math.min(s.cols - d.c.w, d.c.x + dx)), y: Math.max(0, Math.min(s.rows - d.c.h, d.c.y + dy)) })
          else onChange({ ...d.c, w: Math.max(1, Math.min(s.cols - d.c.x, d.c.w + dx)), h: Math.max(1, Math.min(s.rows - d.c.y, d.c.h + dy)) })
        }}
        onPointerUp={() => { drag.current = null }}>
        {s.controls.map((c) => (
          <div key={c.id} className={`pc-item${sel === c.id ? ' on' : ''}`} title={`${KIND_NAME[c.kind]}: ${c.label}`}
            style={{ gridColumn: `${c.x + 1} / span ${c.w}`, gridRow: `${c.y + 1} / span ${c.h}` }}
            onPointerDown={(e) => { e.stopPropagation(); onSel(c.id); (box.current as Element).setPointerCapture(e.pointerId); drag.current = { id: c.id, mode: 'move', x0: e.clientX, y0: e.clientY, c } }}>
            <i className="pc-size" onPointerDown={(e) => { e.stopPropagation(); onSel(c.id); (box.current as Element).setPointerCapture(e.pointerId); drag.current = { id: c.id, mode: 'size', x0: e.clientX, y0: e.clientY, c } }} />
          </div>
        ))}
      </div>
    </div>
  )
}

const pickImage = (then: (url: string) => void, max?: number) => pickFile('image/png,image/jpeg,image/webp,image/svg+xml,image/gif', (f) => {
  shrinkImage(f, max).then(then).catch((e: Error) => toast(e.message))
})

function Props({ c, up, remove, dup }: { c: PControl; up: (c: PControl) => void; remove: () => void; dup: () => void }) {
  const design = isDesign(c.kind)
  return (
    <div className="pc-props">
      {c.kind === 'text'
        ? <textarea className="input" rows={3} value={c.label} onChange={(e) => up({ ...c, label: e.target.value })} aria-label="Text" />
        : <input className="input" value={c.label} onChange={(e) => up({ ...c, label: e.target.value })} aria-label="Label" />}
      <div className="row wrap gap">
        <select className="select mini" value={c.kind} onChange={(e) => { const k = e.target.value as ControlKind; up({ ...newControl(k, c.x, c.y, 1), ...c, kind: k, sendY: hasY(k) ? c.sendY ?? newSend('signal', 100) : c.sendY }) }}>
          {KIND_GROUPS.map((g) => <optgroup key={g.name} label={g.name}>{g.kinds.map((k) => <option key={k} value={k}>{KIND_NAME[k]}</option>)}</optgroup>)}
        </select>
        <button className="btn small quiet" onClick={dup}>Duplicate</button>
        <button className="btn small out" onClick={remove}>Remove</button>
      </div>
      {KIND_TIP[c.kind] && <p className="dim small">{KIND_TIP[c.kind]}</p>}

      <fieldset className="pc-send"><legend>Look</legend>
        <div className="row wrap gap">
          <label className="mini">Color <input type="color" className="swatch" value={c.color} onChange={(e) => up({ ...c, color: e.target.value })} /></label>
          <label className="mini">Text <input type="color" className="swatch" value={c.textColor ?? '#ffffff'} onChange={(e) => up({ ...c, textColor: e.target.value })} /></label>
          {!design && <label className="mini-check"><input type="checkbox" checked={Boolean(c.fill)} onChange={(e) => up({ ...c, fill: e.target.checked })} />Solid</label>}
          {!design && <label className="mini-check"><input type="checkbox" checked={Boolean(c.hideLabel)} onChange={(e) => up({ ...c, hideLabel: e.target.checked })} />Hide the name</label>}
        </div>
        <label className="mini">Text size <input className="range" type="range" min={0.6} max={4} step={0.1} value={c.textSize ?? 1} onChange={(e) => up({ ...c, textSize: Number(e.target.value) })} /></label>
        {(c.kind === 'label' || c.kind === 'text') && (
          <div className="seg" role="group" aria-label="Align">
            {(['left', 'center', 'right'] as const).map((a) => <button key={a} className={(c.align ?? (c.kind === 'label' ? 'center' : 'left')) === a ? 'on' : ''} onClick={() => up({ ...c, align: a })}>{a === 'left' ? 'Left' : a === 'center' ? 'Middle' : 'Right'}</button>)}
          </div>
        )}
        {(c.kind === 'image' || c.kind === 'button' || c.kind === 'toggle') && (
          <div className="row wrap gap">
            {c.image && <img className="pc-thumb" src={c.image} alt="" />}
            <button className="btn small" onClick={() => pickImage((image) => up({ ...c, image }), c.kind === 'image' ? 1000 : 300)}>{c.image ? 'Other picture...' : c.kind === 'image' ? 'Choose a picture or logo...' : 'Add an icon...'}</button>
            {c.image && <button className="btn small quiet" onClick={() => up({ ...c, image: undefined })}>No picture</button>}
            {c.kind === 'image' && (
              <div className="seg" role="group" aria-label="Fit">
                <button className={(c.fit ?? 'contain') === 'contain' ? 'on' : ''} onClick={() => up({ ...c, fit: 'contain' })}>Whole picture</button>
                <button className={c.fit === 'cover' ? 'on' : ''} onClick={() => up({ ...c, fit: 'cover' })}>Fill the box</button>
              </div>
            )}
          </div>
        )}
      </fieldset>

      {c.kind === 'radio' && <label className="mini">Choices <input className="input" value={(c.options ?? []).join(', ')} onChange={(e) => up({ ...c, options: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} /></label>}
      {c.kind === 'pads' && <div className="row gap">
        <label className="mini">Pads across <input className="input num" type="number" min={1} max={8} value={c.padCols ?? 4} onChange={(e) => up({ ...c, padCols: Math.max(1, Math.min(8, Number(e.target.value))) })} style={{ width: 52 }} /></label>
        <label className="mini">down <input className="input num" type="number" min={1} max={8} value={c.padRows ?? 2} onChange={(e) => up({ ...c, padRows: Math.max(1, Math.min(8, Number(e.target.value))) })} style={{ width: 52 }} /></label>
      </div>}
      {c.kind === 'steps' && <div className="row gap">
        <label className="mini">Steps <input className="input num" type="number" min={2} max={32} value={c.steps ?? 8} onChange={(e) => up({ ...c, steps: Math.max(2, Math.min(32, Number(e.target.value))) })} style={{ width: 52 }} /></label>
        <label className="mini">Tempo <input className="input num" type="number" min={20} max={300} value={c.bpm ?? 120} onChange={(e) => up({ ...c, bpm: Math.max(20, Math.min(300, Number(e.target.value))) })} style={{ width: 60 }} /></label>
      </div>}

      {!design && <SendEditor s={c.send} title={Y_TITLE[c.kind]?.[0] ?? (c.kind === 'pads' ? 'Pad 1 sends' : 'Sends')} onChange={(send) => up({ ...c, send })} />}
      {hasY(c.kind) && c.sendY && <SendEditor s={c.sendY} title={Y_TITLE[c.kind]?.[1] ?? 'Second value sends'} onChange={(sendY) => up({ ...c, sendY })} />}
      {!design && <div className="row gap">
        <label className="mini">From <input className="input num" type="number" step={0.01} value={c.min} onChange={(e) => up({ ...c, min: Number(e.target.value) })} style={{ width: 64 }} /></label>
        <label className="mini">to <input className="input num" type="number" step={0.01} value={c.max} onChange={(e) => up({ ...c, max: Number(e.target.value) })} style={{ width: 64 }} /></label>
      </div>}
    </div>
  )
}

function PageDesign({ s, up }: { s: Surface; up: (p: Partial<Surface>) => void }) {
  return (
    <div className="pc-props">
      <div className="row wrap gap">
        <label className="mini">Background <input type="color" className="swatch" value={s.bg ?? '#000000'} onChange={(e) => up({ bg: e.target.value })} /></label>
        <button className="btn small" onClick={() => pickImage((bgImage) => up({ bgImage }), 1600)}>{s.bgImage ? 'Other background picture...' : 'Background picture...'}</button>
        {s.bgImage && <button className="btn small quiet" onClick={() => up({ bgImage: undefined })}>No picture</button>}
      </div>
      {s.bgImage && <div className="row wrap gap">
        <img className="pc-thumb" src={s.bgImage} alt="" />
        <div className="seg" role="group" aria-label="Fit">
          <button className={(s.bgFit ?? 'cover') === 'cover' ? 'on' : ''} onClick={() => up({ bgFit: 'cover' })}>Fill</button>
          <button className={s.bgFit === 'contain' ? 'on' : ''} onClick={() => up({ bgFit: 'contain' })}>Whole picture</button>
        </div>
        <label className="mini">Darken <input className="range" type="range" min={0} max={0.95} step={0.05} value={s.bgDim ?? 0.3} onChange={(e) => up({ bgDim: Number(e.target.value) })} /></label>
      </div>}
      <label className="mini">Space between <input className="range" type="range" min={0} max={24} step={1} value={s.gap ?? 8} onChange={(e) => up({ gap: Number(e.target.value) })} /></label>
      <label className="mini">Round corners <input className="range" type="range" min={0} max={40} step={1} value={s.radius ?? 10} onChange={(e) => up({ radius: Number(e.target.value) })} /></label>
    </div>
  )
}

export default function PhoneControls() {
  const surfaces = useSurfaces()
  const app = useRico((x) => x.state?.app)
  const ip = useRico((x) => x.state?.osc.localIp)
  const [cur, setCur] = useState<string | null>(surfaces[0]?.id ?? null)
  const [sel, setSel] = useState<string | null>(null)
  const [tab, setTab] = useState<'add' | 'page'>('add')
  const [tryIt, setTryIt] = useState(false)
  const [qr, setQr] = useState('')
  useEffect(() => { startPhoneHost() }, [])
  const s = surfaces.find((x) => x.id === cur) ?? surfaces[0]
  const url = s && ip && app?.port ? `http://${ip}:${app.port}/?surface=${s.id}` : ''
  useEffect(() => {
    if (!url || !app?.network) return setQr('')
    QRCode.toDataURL(url, { margin: 1, width: 200 }).then(setQr).catch(() => setQr(''))
  }, [url, app?.network])

  const upS = (part: Partial<Surface>) => s && setSurfaces(surfaces.map((x) => (x.id === s.id ? { ...x, ...part } : x)))
  const upC = (c: PControl) => s && upS({ controls: s.controls.map((x) => (x.id === c.id ? c : x)) })
  const c = s?.controls.find((x) => x.id === sel)
  const place = (k: PControl) => {
    if (!s) return
    // The first free spot from the top.
    for (let y = 0; y <= s.rows - k.h; y++) for (let x = 0; x <= s.cols - k.w; x++) {
      const free = !s.controls.some((o) => x < o.x + o.w && x + k.w > o.x && y < o.y + o.h && y + k.h > o.y)
      if (free) { k.x = x; k.y = y; upS({ controls: [...s.controls, k] }); setSel(k.id); return }
    }
    toast('No room left. Make the grid bigger, or make some controls smaller.')
  }
  const add = (kind: ControlKind) => {
    if (!s) return
    const k = newControl(kind, 0, 0, s.controls.length + 1)
    k.w = Math.min(k.w, s.cols); k.h = Math.min(k.h, s.rows)
    if (kind === 'image') pickImage((image) => place({ ...k, image }), 1000)
    else place(k)
  }
  const setDevice = (device: Device) => {
    if (!s) return
    const phoneGrid = s.cols === 4 && s.rows === 8, tabletGrid = s.cols === 12 && s.rows === 8
    const grid = device === 'tablet' && phoneGrid ? { cols: 12, rows: 8, landscape: true } : device === 'phone' && tabletGrid ? { cols: 4, rows: 8, landscape: false } : {}
    upS({ device, ...grid })
  }
  const ar = s ? deviceAspect(s) : 9 / 19
  // Delete or Backspace removes the picked control (not while typing).
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!sel || !s || (e.key !== 'Delete' && e.key !== 'Backspace')) return
      if ((e.target as Element)?.closest?.('input, textarea, select, [contenteditable]')) return
      if (!document.querySelector('.pc')) return
      e.preventDefault()
      setSurfaces(surfaces.map((x) => (x.id === s.id ? { ...x, controls: x.controls.filter((c) => c.id !== sel) } : x)))
      setSel(null)
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  })

  return (
    <div className="dpanel pc">
      <div className="tool-strip pc-strip" role="toolbar" aria-label="Phone and tablet">
        <select className="select mini pc-page" value={s?.id ?? ''} onChange={(e) => { setCur(e.target.value); setSel(null) }} title="Which page">
          {!surfaces.length && <option value="">No pages yet</option>}
          {surfaces.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <ToolBtn t={{ id: 'np', icon: 'phone', label: 'New phone page', run: () => { const n = newSurface(`Phone ${surfaces.length + 1}`, 'phone'); setSurfaces([...surfaces, n]); setCur(n.id); setSel(null) } }} />
        <ToolBtn t={{ id: 'nt', icon: 'tablet', label: 'New tablet page', run: () => { const n = newSurface(`Tablet ${surfaces.length + 1}`, 'tablet'); setSurfaces([...surfaces, n]); setCur(n.id); setSel(null) } }} />
        {s && <>
          <i className="ts-sep" />
          <ToolGroup label="Add">
            {([['fader', 'fader', 'Fader'], ['knob', 'knob', 'Knob'], ['button', 'pad', 'Button'], ['toggle', 'unlock', 'Toggle'], ['pads', 'pad', 'Pads'], ['xy', 'move', 'XY pad'], ['steps', 'timeline', 'Step sequencer'], ['tilt', 'phone', 'Tilt'], ['label', 'text', 'Title'], ['image', 'photo', 'Picture or logo']] as [ControlKind, string, string][]).map(([k, icon, label]) => (
              <ToolBtn key={k} t={{ id: k, icon, label: `Add: ${label}`, run: () => add(k) }} />
            ))}
          </ToolGroup>
          <i className="ts-sep" />
          <ToolBtn t={{ id: 'dev', icon: s.device === 'tablet' ? 'tablet' : 'phone', label: `Shape: ${s.device === 'tablet' ? 'tablet' : 'phone'} (click to switch)`, run: () => setDevice(s.device === 'tablet' ? 'phone' : 'tablet') }} />
          <ToolBtn t={{ id: 'turn', icon: 'rotate', label: s.landscape ? 'Sideways (click for upright)' : 'Upright (click for sideways)', on: Boolean(s.landscape), run: () => upS({ landscape: !s.landscape }) }} />
          <ToolBtn t={{ id: 'try', icon: 'hand', label: 'Try it here (the controls move and send)', on: tryIt, run: () => setTryIt(!tryIt) }} />
          <ToolBtn t={{ id: 'del', icon: 'trash', label: 'Delete this page', run: () => { setSurfaces(surfaces.filter((x) => x.id !== s.id)); setCur(null); setSel(null) } }} />
          <span className="grow" />
          <input className="input pc-name" value={s.name} onChange={(e) => upS({ name: e.target.value })} aria-label="Page name" />
          <label className="ts-label">Grid <input className="input num" type="number" min={1} max={16} value={s.cols} onChange={(e) => upS({ cols: Math.max(1, Math.min(16, Number(e.target.value))) })} title="Columns" /> x <input className="input num" type="number" min={1} max={16} value={s.rows} onChange={(e) => upS({ rows: Math.max(1, Math.min(16, Number(e.target.value))) })} title="Rows" /></label>
        </>}
      </div>
      {s && (
        <div className={`pc-body${ar > 1 ? ' wide' : ''}`}>
          <div className={`pc-device ${s.device ?? 'phone'}`} style={{ aspectRatio: String(ar), width: ar > 1 ? `calc(60vh * ${ar.toFixed(3)})` : `calc(68vh * ${ar.toFixed(3)})` }}>
            {tryIt ? <SurfaceView s={s} /> : <GridEditor s={s} sel={sel} onSel={setSel} onChange={upC} />}
          </div>
          <div className="pc-side">
            {c ? (
              <>
                <div className="pc-side-head"><b>{KIND_NAME[c.kind]}</b><button className="btn small quiet" onClick={() => setSel(null)}>Done</button></div>
                <Props c={c} up={upC} remove={() => { upS({ controls: s.controls.filter((x) => x.id !== c.id) }); setSel(null) }}
                  dup={() => place({ ...c, id: Math.random().toString(36).slice(2, 8), label: `${c.label} copy` })} />
              </>
            ) : (
              <>
                <div className="seg" role="tablist">
                  <button className={tab === 'add' ? 'on' : ''} onClick={() => setTab('add')}>Add</button>
                  <button className={tab === 'page' ? 'on' : ''} onClick={() => setTab('page')}>Page design</button>
                </div>
                {tab === 'add' && KIND_GROUPS.map((g) => (
                  <div key={g.name} className="pc-group">
                    <h5>{g.name}</h5>
                    <div className="pc-adds">{g.kinds.map((k) => <button key={k} className="btn small quiet" onClick={() => add(k)}>+ {KIND_NAME[k]}</button>)}</div>
                  </div>
                ))}
                {tab === 'page' && <PageDesign s={s} up={upS} />}
                <p className="dim small">Click a control to change it. Drag to move it, drag its corner to make it bigger.</p>
              </>
            )}
            <fieldset className="pc-send"><legend>On your {s.device === 'tablet' ? 'tablet' : 'phone'}</legend>
              {!app?.network && <>
                <p className="small">Let devices on this network open RICO first.</p>
                <button className="btn small primary" onClick={async () => { const a = await rico.send('app.network', { on: true }); if (!a.ok) toast(a.error ?? 'Could not turn it on.') }}>Allow devices on this network</button>
              </>}
              {app?.network && url && <div className="pc-qr">{qr && <img src={qr} alt={`QR code for ${url}`} width={160} height={160} />}<div><p className="small">Scan it, or open:</p><code className="share-link">{url}</code></div></div>}
              {rico.get().status !== 'live' && <p className="dim small">The link works in the app (this is the demo). "Try it here" works now.</p>}
              <p className="dim small">The device and this computer must be on the same Wi-Fi. Windows may ask to let RICO through the firewall once.</p>
            </fieldset>
          </div>
        </div>
      )}
      {!s && <p className="dim small">Make a page for your phone or tablet: faders, knobs, pads, a step sequencer, tilt, plus titles, text, logos and pictures. Controls can send OSC, MIDI, DMX, MQTT, UDP and web addresses, or move anything in RICO.</p>}
    </div>
  )
}
