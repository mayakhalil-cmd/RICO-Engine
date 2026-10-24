import { useEffect, useRef, useState } from 'react'
import PopMenu from '../components/PopMenu'
import SignalPicker from '../components/SignalPicker'
import { toast } from '../components/Toasts'
import { HARDWARE_CODE } from '../data/hardwareCode'
import { rico } from '../engine/connection'
import { ledPoints } from '../engine/ledProtocols'
import { closeOutput, liveOf, newOutput, pictureOf, PRESETS, sendOnce, setOutputs, useSendOutputs, type Output, type PixelProto, type ValueProto } from '../engine/sends'
import { listSignals } from '../engine/signals'
import { pictureLabel, pictureNames } from '../engine/shared'
import { useTick } from '../engine/useTick'
import { downloadBlob } from '../shell/ui'

// Output > Outputs: send pixels to LED strips and walls, and values to a
// Raspberry Pi, a microcontroller, MQTT, a web address or a WebSocket. Each
// kind of hardware has a ready preset and starter code.

const PIXEL_PROTO: Record<PixelProto, string> = {
  ddp: 'DDP (WLED, ESPixelStick, xLights)', wled: 'WLED realtime UDP', artnet: 'Art-Net', sacn: 'sACN (E1.31)', opc: 'Open Pixel Control (TCP)',
  adalight: 'Adalight (USB serial)', 'udp-raw': 'Plain colors over UDP', 'serial-raw': 'Plain colors over USB serial',
}
const VALUE_PROTO: Record<ValueProto, string> = { osc: 'OSC', udp: 'UDP', tcp: 'TCP', serial: 'USB serial', mqtt: 'MQTT', http: 'Web address (HTTP)', websocket: 'WebSocket' }
const usesSerial = (o: Output) => (o.kind === 'pixels' ? o.pixelProto === 'adalight' || o.pixelProto === 'serial-raw' : o.valueProto === 'serial')
const usesHost = (o: Output) => !usesSerial(o) && !(o.kind === 'values' && (o.valueProto === 'mqtt' || o.valueProto === 'http'))

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <label className="ps-row" title={hint}><span>{label}</span><div>{children}</div></label>
}
const num = (v: string, min: number, max: number) => Math.max(min, Math.min(max, Number(v) || 0))

// The picture with the LEDs on it; drag across it to place the strip, grid or ring.
function LedMap({ o, up }: { o: Output; up: (p: Partial<Output>) => void }) {
  const c = useRef<HTMLCanvasElement | null>(null)
  const drag = useRef<[number, number] | null>(null)
  useTick(120)
  useEffect(() => {
    const cv = c.current
    if (!cv) return
    const g = cv.getContext('2d')!
    const w = cv.width = cv.clientWidth * Math.min(2, devicePixelRatio), h = cv.height = cv.clientHeight * Math.min(2, devicePixelRatio)
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h)
    const src = pictureOf(o.picture)
    if (src) try { g.globalAlpha = 0.85; g.drawImage(src, 0, 0, w, h); g.globalAlpha = 1 } catch { /* not ready */ }
    const pts = ledPoints(o.layout)
    const colors = liveOf(o.id)?.colors
    const gap = pts.length > 1 ? Math.hypot((pts[1][0] - pts[0][0]) * w, (pts[1][1] - pts[0][1]) * h) : 20
    const r = Math.max(1.5, Math.min(7, gap * 0.38))
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1
    g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x * w, y * h) : g.moveTo(x * w, y * h))); g.stroke()
    pts.forEach(([x, y], i) => {
      g.beginPath(); g.arc(x * w, y * h, r, 0, Math.PI * 2)
      g.fillStyle = colors ? `rgb(${colors[i * 3]},${colors[i * 3 + 1]},${colors[i * 3 + 2]})` : '#111'
      g.fill(); g.strokeStyle = i === 0 ? '#f820a0' : '#fff'; g.stroke()
    })
  })
  const at = (e: React.PointerEvent): [number, number] => { const b = c.current!.getBoundingClientRect(); return [Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)), Math.max(0, Math.min(1, (e.clientY - b.top) / b.height))] }
  return (
    <canvas ref={c} className="sd-map" title="Drag across the picture to place the LEDs (pink is the first LED)"
      onPointerDown={(e) => { (e.currentTarget as Element).setPointerCapture(e.pointerId); drag.current = at(e) }}
      onPointerMove={(e) => { const s = drag.current; if (!s) return; const [x, y] = at(e); up({ layout: { ...o.layout, area: [s[0], s[1], x, y] } }) }}
      onPointerUp={() => { drag.current = null }} />
  )
}

function LedBar({ o }: { o: Output }) {
  useTick(100)
  const colors = liveOf(o.id)?.colors
  const n = colors ? colors.length / 3 : 0
  if (!n) return null
  const step = Math.max(1, Math.ceil(n / 240))
  const cells = []
  for (let i = 0; i < n; i += step) cells.push(<i key={i} style={{ background: `rgb(${colors![i * 3]},${colors![i * 3 + 1]},${colors![i * 3 + 2]})` }} />)
  return <div className="sd-bar" aria-hidden="true">{cells}</div>
}

function Status({ o }: { o: Output }) {
  useTick(500)
  const l = liveOf(o.id)
  if (!o.on) return <span className="dim small">Off</span>
  if (l?.error) return <span className="warn-text small">{l.error}</span>
  return <span className="ok small">{l?.rate ?? 0} packets a second</span>
}

function Code({ id }: { id: string }) {
  const c = HARDWARE_CODE[id]
  const [open, setOpen] = useState(false)
  if (!c) return null
  return (
    <fieldset className="ps-group"><legend>Starter code: {c.title}</legend>
      <p className="small">{c.how}</p>
      <div className="row wrap">
        <button className="btn small" onClick={() => setOpen(!open)}>{open ? 'Hide the code' : 'Show the code'}</button>
        <button className="btn small quiet" onClick={() => { void navigator.clipboard?.writeText(c.code).then(() => toast('Copied.', true)) }}>Copy</button>
        <button className="btn small quiet" onClick={() => downloadBlob(c.file, new Blob([c.code], { type: 'text/plain' }))}>Save {c.file}</button>
      </div>
      {open && <pre className="sd-code">{c.code}</pre>}
    </fieldset>
  )
}

function Editor({ o, up, remove }: { o: Output; up: (p: Partial<Output>) => void; remove: () => void }) {
  const [ports, setPorts] = useState<string[]>([])
  useEffect(() => { if (usesSerial(o)) void rico.send('net.serial.list').then((a) => setPorts(((a as unknown as { ports?: string[] }).ports) ?? [])) }, [o.kind, o.pixelProto, o.valueProto])  // eslint-disable-line react-hooks/exhaustive-deps
  const L = o.layout
  const count = L.shape === 'matrix' ? L.cols * L.rows : L.count
  const signals = listSignals()
  return (
    <div className="sd-edit">
      <div className="sd-head">
        <input className="input" value={o.name} onChange={(e) => up({ name: e.target.value })} aria-label="Name" />
        <label className="switch"><input type="checkbox" role="switch" checked={o.on} onChange={(e) => up({ on: e.target.checked })} /><span>{o.on ? 'Sending' : 'Off'}</span></label>
        <button className="btn small quiet" onClick={() => sendOnce(o)} title="Send one frame now, even when it is off">Send once</button>
        <button className="btn small out" onClick={remove}>Remove</button>
      </div>
      <Status o={o} />
      <div className="sd-cols">
        <div className="sd-settings">
          <fieldset className="ps-group"><legend>Where to</legend>
            <Field label="Kind">
              <div className="seg" role="group">
                <button className={o.kind === 'pixels' ? 'on' : ''} onClick={() => up({ kind: 'pixels' })}>LED pixels</button>
                <button className={o.kind === 'values' ? 'on' : ''} onClick={() => up({ kind: 'values' })}>Values</button>
              </div>
            </Field>
            <Field label="Protocol">
              {o.kind === 'pixels'
                ? <select className="select" value={o.pixelProto} onChange={(e) => up({ pixelProto: e.target.value as PixelProto })}>{Object.entries(PIXEL_PROTO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                : <select className="select" value={o.valueProto} onChange={(e) => up({ valueProto: e.target.value as ValueProto })}>{Object.entries(VALUE_PROTO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}
            </Field>
            {usesHost(o) && <>
              <Field label="Address" hint="The IP address of the device, like 192.168.1.50"><input className="input" value={o.host} onChange={(e) => up({ host: e.target.value.trim() })} /></Field>
              <Field label="Port"><input className="input num" type="number" value={o.port} onChange={(e) => up({ port: num(e.target.value, 1, 65535) })} /></Field>
            </>}
            {usesSerial(o) && <>
              <Field label="USB port">
                <div className="row gap">
                  <select className="select" value={o.serial} onChange={(e) => up({ serial: e.target.value })}>
                    {[...new Set([o.serial, ...ports])].map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <button className="btn small quiet" onClick={() => void rico.send('net.serial.list').then((a) => setPorts(((a as unknown as { ports?: string[] }).ports) ?? []))}>Look again</button>
                </div>
              </Field>
              <Field label="Speed"><select className="select" value={o.baud} onChange={(e) => up({ baud: Number(e.target.value) })}>{[9600, 57600, 115200, 230400, 460800, 500000, 921600, 1000000, 2000000].map((b) => <option key={b} value={b}>{b}</option>)}</select></Field>
            </>}
            {o.kind === 'pixels' && (o.pixelProto === 'artnet' || o.pixelProto === 'sacn') && <Field label="First universe"><input className="input num" type="number" value={o.universe} onChange={(e) => up({ universe: num(e.target.value, 0, 32767) })} /></Field>}
            {o.kind === 'values' && o.valueProto === 'mqtt' && <Field label="Topic" hint="{name} is the signal's name"><input className="input" value={o.topic} onChange={(e) => up({ topic: e.target.value })} /></Field>}
            {o.kind === 'values' && o.valueProto === 'http' && <>
              <Field label="Address" hint="{name} and {value} are filled in"><input className="input" value={o.url} onChange={(e) => up({ url: e.target.value })} /></Field>
              <Field label="Method"><div className="seg" role="group">{(['GET', 'POST'] as const).map((m) => <button key={m} className={o.method === m ? 'on' : ''} onClick={() => up({ method: m })}>{m}</button>)}</div></Field>
            </>}
            <Field label="Times a second"><input className="input num" type="number" value={o.fps} onChange={(e) => up({ fps: num(e.target.value, 1, 120) })} /></Field>
          </fieldset>

          {o.kind === 'pixels' && (
            <fieldset className="ps-group"><legend>LEDs</legend>
              <Field label="From the picture"><select className="select" value={o.picture} onChange={(e) => up({ picture: e.target.value })}>{[...new Set([o.picture, ...pictureNames()])].map((n) => <option key={n} value={n}>{pictureLabel(n)}</option>)}</select></Field>
              <Field label="Shape">
                <div className="seg" role="group">{(['strip', 'matrix', 'ring'] as const).map((s) => <button key={s} className={L.shape === s ? 'on' : ''} onClick={() => up({ layout: { ...L, shape: s, area: s === 'strip' ? [0.05, 0.5, 0.95, 0.5] : [0.1, 0.1, 0.9, 0.9] } })}>{s === 'strip' ? 'Strip' : s === 'matrix' ? 'Grid (wall)' : 'Ring'}</button>)}</div>
              </Field>
              {L.shape === 'matrix' ? <>
                <Field label="Across"><input className="input num" type="number" value={L.cols} onChange={(e) => up({ layout: { ...L, cols: num(e.target.value, 1, 256) } })} /></Field>
                <Field label="Down"><input className="input num" type="number" value={L.rows} onChange={(e) => up({ layout: { ...L, rows: num(e.target.value, 1, 256) } })} /></Field>
                <Field label="Wiring">
                  <div className="row wrap gap">
                    <label className="mini-check"><input type="checkbox" checked={L.serpentine} onChange={(e) => up({ layout: { ...L, serpentine: e.target.checked } })} />Zigzag</label>
                    <label className="mini-check"><input type="checkbox" checked={L.vertical} onChange={(e) => up({ layout: { ...L, vertical: e.target.checked } })} />In columns</label>
                  </div>
                </Field>
              </> : <Field label="LEDs"><input className="input num" type="number" value={L.count} onChange={(e) => up({ layout: { ...L, count: num(e.target.value, 1, 4096) } })} /></Field>}
              <Field label="Color order" hint="WS2812B strips are usually GRB; WLED, Art-Net and sACN controllers want RGB"><select className="select" value={o.order} onChange={(e) => up({ order: e.target.value as Output['order'] })}>{['RGB', 'GRB', 'BRG', 'RBG', 'GBR', 'BGR'].map((x) => <option key={x} value={x}>{x}</option>)}</select></Field>
              <Field label="White LED"><label className="mini-check"><input type="checkbox" checked={o.white} onChange={(e) => up({ white: e.target.checked })} />RGBW strip</label></Field>
              <Field label="Brightness" hint="Keep it low on long strips: full white draws a lot of power"><input className="range" type="range" min={0} max={1} step={0.01} value={o.brightness} onChange={(e) => up({ brightness: Number(e.target.value) })} /></Field>
              <Field label="Gamma" hint="2.2 makes LED colors look like the screen"><input className="range" type="range" min={1} max={3} step={0.05} value={o.gamma} onChange={(e) => up({ gamma: Number(e.target.value) })} /></Field>
              <p className="dim small">{count} LEDs, {Math.ceil(count * (o.white ? 4 : 3) / 512)} universe{count * (o.white ? 4 : 3) > 512 ? 's' : ''} of data.</p>
            </fieldset>
          )}

          {o.kind === 'values' && (
            <fieldset className="ps-group"><legend>Values</legend>
              <ul className="sd-sigs">
                {o.signals.map((id) => (
                  <li key={id}><span>{signals.find((s) => s.id === id)?.name ?? id}</span><button className="icon-btn small danger" onClick={() => up({ signals: o.signals.filter((x) => x !== id) })} aria-label="Remove">x</button></li>
                ))}
              </ul>
              <SignalPicker value="" label="Add a signal" onChange={(id) => id && !o.signals.includes(id) && up({ signals: [...o.signals, id] })} />
              <Field label="Message">
                <select className="select" value={o.format} onChange={(e) => up({ format: e.target.value as Output['format'] })}>
                  <option value="line">One line per value</option><option value="json">JSON with all values</option><option value="csv">All values in one line (CSV)</option><option value="bytes">Bytes (255, then 0 to 254 each)</option>
                </select>
              </Field>
              {(o.format === 'line' || o.valueProto === 'osc') && <Field label={o.valueProto === 'osc' ? 'OSC address' : 'Line'} hint="{name}, {value} (0 to 1) and {byte} (0 to 255) are filled in"><input className="input" value={o.template} onChange={(e) => up({ template: e.target.value })} /></Field>}
              <Field label="Multiply by" hint="1 sends 0 to 1; 100 sends 0 to 100"><input className="input num" type="number" step={0.1} value={o.scale} onChange={(e) => up({ scale: Number(e.target.value) || 1 })} /></Field>
              <label className="mini-check"><input type="checkbox" checked={o.onlyChanges} onChange={(e) => up({ onlyChanges: e.target.checked })} />Only send when something changes</label>
            </fieldset>
          )}
          <Code id={PRESETS.find((p) => p.id === o.preset)?.code ?? ''} />
        </div>
        {o.kind === 'pixels' && (
          <div className="sd-preview">
            <LedMap o={o} up={up} />
            <LedBar o={o} />
            <p className="dim small">Drag across the picture to place the {L.shape === 'strip' ? 'strip from its first LED to its last' : L.shape === 'ring' ? 'ring' : 'grid'}. The pink dot is the first LED.</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default function Sends() {
  const list = useSendOutputs()
  const [cur, setCur] = useState<string | null>(list[0]?.id ?? null)
  const [menu, setMenu] = useState(false)
  const addBtn = useRef<HTMLButtonElement | null>(null)
  const o = list.find((x) => x.id === cur) ?? list[0]
  const up = (id: string, p: Partial<Output>) => setOutputs(list.map((x) => (x.id === id ? { ...x, ...p } : x)))
  const remove = (id: string) => { closeOutput(id); setOutputs(list.filter((x) => x.id !== id)); setCur(null) }
  const add = (presetId: string) => {
    const p = PRESETS.find((x) => x.id === presetId)
    const n = newOutput({ name: p?.name.split(' (')[0] ?? 'Output', preset: presetId, ...(p?.part ?? {}) })
    setOutputs([...list, n]); setCur(n.id); setMenu(false)
  }
  // Delete or Backspace removes the picked output (not while typing).
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!o || (e.key !== 'Delete' && e.key !== 'Backspace') || (e.target as Element)?.closest?.('input, textarea, select, [contenteditable]') || !document.querySelector('.sd')) return
      e.preventDefault(); remove(o.id)
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  })
  return (
    <div className="dpanel sd">
      <div className="dpanel-head"><p>Send to LED strips and walls, a Raspberry Pi, an Arduino, an ESP32, MQTT, a web address or a WebSocket. Pick your hardware for a ready setup and starter code.</p></div>
      <div className="sd-layout">
        <div className="sd-list">
          <button ref={addBtn} className="btn primary" onClick={() => setMenu(!menu)}>+ Output</button>
          {menu && (
            <PopMenu anchor={addBtn} onClose={() => setMenu(false)} width={380} className="sd-menu">
              {(['LEDs', 'Values'] as const).map((g) => (
                <div key={g}>
                  <div className="menu-head">{g === 'LEDs' ? 'LED strips and walls' : 'Values to hardware and apps'}</div>
                  {PRESETS.filter((p) => p.group === g).map((p) => (
                    <button key={p.id} className="sd-preset" onClick={() => add(p.id)}><b>{p.name}</b><span>{p.about}</span></button>
                  ))}
                </div>
              ))}
              <div className="menu-head">Anything else</div>
              <button className="sd-preset" onClick={() => add('custom')}><b>Empty output</b><span>Pick every setting yourself.</span></button>
            </PopMenu>
          )}
          <ul>
            {list.map((x) => (
              <li key={x.id} className={o?.id === x.id ? 'on' : ''} onClick={() => setCur(x.id)}>
                <i className={`sd-dot${x.on ? ' live' : ''}`} />
                <span className="grow">{x.name}</span>
                <span className="dim small">{x.kind === 'pixels' ? `${x.layout.shape === 'matrix' ? x.layout.cols * x.layout.rows : x.layout.count} LEDs` : `${x.signals.length} values`}</span>
              </li>
            ))}
          </ul>
          {!list.length && <p className="dim small">Nothing yet. Press + Output and pick your hardware.</p>}
        </div>
        {o && <Editor key={o.id} o={o} up={(p) => up(o.id, p)} remove={() => remove(o.id)} />}
      </div>
    </div>
  )
}
