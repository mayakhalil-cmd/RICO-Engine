import Logo from '../components/Logo'
import { useEffect, useRef, useState } from 'react'
import { calm, Scramble } from '../components/Reveal'
import { goTo } from '../shell/workspaces'
import { Meter, Panel } from '../components/Fields'
import { toast } from '../components/Toasts'
import { rico } from '../engine/connection'
import { useRico } from '../engine/store'
import { RECIPES, type Recipe } from '../data/recipes'

// Wires from every input to RICO and from RICO to every output, drawn behind
// the columns. Signals run along the ones that are on; the others wait dim.
function FlowWires({ box }: { box: React.RefObject<HTMLDivElement | null> }) {
  const canvas = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const c = canvas.current, b = box.current
    if (!c || !b) return
    const g = c.getContext('2d')!
    const still = calm()
    let raf = 0
    const css = getComputedStyle(document.documentElement)
    const col = (n: string, f: string) => css.getPropertyValue(n).trim() || f
    const lime = col('--lime', '#3bff03'), pink = col('--pink', '#f820a0'), blue = col('--blue-read', '#6f86ff'), line = col('--line', '#1a4a08')
    type Wire = { a: [number, number]; b: [number, number]; on: boolean; out: boolean; seed: number }
    let wires: Wire[] = []
    const measure = () => {
      const r = b.getBoundingClientRect()
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      c.width = Math.max(1, Math.round(r.width * dpr)); c.height = Math.max(1, Math.round(r.height * dpr))
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      const core = b.querySelector('[data-core]')?.getBoundingClientRect()
      if (!core) { wires = []; return }
      const cy = core.top + core.height / 2 - r.top
      const coreL = core.left - r.left - 10, coreR = core.left - r.left + (b.querySelector('.flow-core') as HTMLElement).clientWidth + 10
      wires = [...b.querySelectorAll<HTMLElement>('[data-port]')].map((el, i) => {
        const e = el.getBoundingClientRect()
        const y = e.top + e.height / 2 - r.top
        const out = el.dataset.port === 'out'
        return out
          ? { a: [coreR, cy] as [number, number], b: [e.left - r.left - 8, y] as [number, number], on: el.dataset.on === '1', out, seed: i * 0.37 }
          : { a: [e.right - r.left + 8, y] as [number, number], b: [coreL, cy] as [number, number], on: el.dataset.on === '1', out, seed: i * 0.37 }
      })
    }
    const at = (w: Wire, t: number): [number, number] => {
      const mx = (w.a[0] + w.b[0]) / 2
      const u = 1 - t
      const x = u * u * u * w.a[0] + 3 * u * u * t * mx + 3 * u * t * t * mx + t * t * t * w.b[0]
      const y = u * u * u * w.a[1] + 3 * u * u * t * w.a[1] + 3 * u * t * t * w.b[1] + t * t * t * w.b[1]
      return [x, y]
    }
    const draw = (now: number) => {
      g.clearRect(0, 0, c.width, c.height)
      for (const w of wires) {
        const mx = (w.a[0] + w.b[0]) / 2
        g.beginPath(); g.moveTo(w.a[0], w.a[1]); g.bezierCurveTo(mx, w.a[1], mx, w.b[1], w.b[0], w.b[1])
        g.setLineDash(w.on ? [] : [3, 5])
        g.strokeStyle = w.on ? (w.out ? 'rgba(248,32,160,0.45)' : 'rgba(111,134,255,0.45)') : line
        g.lineWidth = 1
        g.stroke()
        g.setLineDash([])
        if (!w.on || still) continue
        // three packets per wire, each with a short glowing tail
        for (let k = 0; k < 3; k++) {
          const t = ((now / 1800 + w.seed + k / 3) % 1)
          const color = w.out ? pink : blue
          for (let s = 0; s < 8; s++) {
            const [x, y] = at(w, Math.max(0, t - s * 0.012))
            g.globalAlpha = (1 - s / 8) * 0.9
            g.fillStyle = s === 0 ? '#fff' : color
            g.fillRect(x - 1.5, y - 1.5, 3, 3)
          }
          g.globalAlpha = 1
        }
      }
      // RICO in the middle pulses a little with every packet that arrives
      if (!still && wires.some((w) => w.on)) {
        const core = wires.find((w) => !w.out)?.b ?? wires[0]?.a
        if (core) { g.globalAlpha = 0.25 + 0.2 * Math.sin(now / 300); g.fillStyle = lime; g.fillRect(core[0] - 2, core[1] - 2, 4, 4); g.globalAlpha = 1 }
      }
      if (!still) raf = requestAnimationFrame(draw)
    }
    measure()
    const ro = new ResizeObserver(() => measure())
    ro.observe(b)
    const mo = new MutationObserver(() => measure())
    mo.observe(b, { subtree: true, attributes: true, attributeFilter: ['data-on'], childList: true })
    raf = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(raf); ro.disconnect(); mo.disconnect() }
  }, [box])
  return <canvas ref={canvas} className="flow-wires" aria-hidden="true" />
}

function Flow() {
  const state = useRico((s) => s.state)
  const values = useRico((s) => s.live.values)
  if (!state) return <div className="empty">Waiting for RICO to answer.</div>
  const { midi, osc, video, audio, dmx, mappings } = state

  const ins: [string, boolean, string][] = [
    [midi.inIndex >= 0 ? midi.inputs[midi.inIndex] ?? 'MIDI input' : 'No MIDI input', midi.inOpen, 'MIDI'],
    [`Port ${osc.listenPort}`, osc.listening, 'OSC in'],
    [audio.capturing ? audio.device : 'Audio off', audio.capturing, 'Audio'],
    [video.receiving ? video.receivingFrom : video.spout.receiving ? video.spout.receivingFrom : 'Nothing', video.receiving || video.spout.receiving, 'Video in'],
  ]
  const enabledDests = osc.destinations.filter((d) => d.enabled).length
  const outs: [string, boolean, string][] = [
    [`${osc.ip}:${osc.port}${enabledDests ? ` +${enabledDests}` : ''}`, osc.sendToOSC, 'OSC out'],
    [midi.virtualPorts.length ? midi.virtualPorts.join(', ') : 'No virtual ports', midi.virtualPorts.length > 0, 'Virtual MIDI'],
    [video.sending ? `${video.name} (${video.transports[video.transport]?.name ?? ''})` : 'Not sending', video.sending, 'Network video'],
    [dmx.running ? `Art-Net ${dmx.ip}` : 'Off', dmx.running, 'DMX'],
  ]

  const box = useRef<HTMLDivElement | null>(null)
  const busiest = [...mappings].sort((a, b) => (values[b.key] ?? 0) - (values[a.key] ?? 0)).slice(0, 5)

  return (
    <div className="flow" ref={box}>
      <FlowWires box={box} />
      <div className="flow-col">
        <h3 className="in"><Scramble text="In" play={0} /></h3>
        <ul className="list">
          {ins.map(([v, on, label]) => (
            <li key={label} className={on ? 'on' : ''} data-port="in" data-on={on ? 1 : 0}>
              <span className="dim small" style={{ width: 92 }}>{label}</span>
              <span className="name">{v}</span>
            </li>
          ))}
        </ul>
        <button className="btn quiet small" onClick={() => goTo('midi')}>MIDI</button>
      </div>
      <div className="flow-col flow-core">
        <h3 data-core="1"><Logo size={20} /></h3>
        {busiest.length === 0 ? (
          <div className="empty">Move any control on a connected device. RICO makes a mapping for it the first time it hears it.</div>
        ) : (
          <ul className="list">
            {busiest.map((m) => (
              <li key={m.key}>
                <span className="name" title={m.address}>{m.name}</span>
                <div style={{ width: 120 }}><Meter value={values[m.key] ?? 0} kind="out" /></div>
              </li>
            ))}
          </ul>
        )}
        <button className="btn quiet small" onClick={() => goTo('midi')}>All {mappings.length} mappings</button>
      </div>
      <div className="flow-col">
        <h3 className="out"><Scramble text="Out" play={0} /></h3>
        <ul className="list">
          {outs.map(([v, on, label]) => (
            <li key={label} className={on ? 'on' : ''} data-port="out" data-on={on ? 1 : 0}>
              <span className="dim small" style={{ width: 92 }}>{label}</span>
              <span className="name">{v}</span>
            </li>
          ))}
        </ul>
        <button className="btn quiet small" onClick={() => goTo('output')}>Outputs</button>
      </div>
    </div>
  )
}

function RecipeView({ recipe, onClose }: { recipe: Recipe; onClose: () => void }) {
  const [running, setRunning] = useState(false)
  const apply = async () => {
    setRunning(true)
    for (const c of recipe.action.commands) {
      const ack = await rico.send(c.op, c.args ?? {})
      if (!ack.ok) {
        toast(ack.error ?? 'That did not work.')
        setRunning(false)
        return
      }
    }
    setRunning(false)
    toast(`RICO is set up for ${recipe.app}.`, true)
  }
  return (
    <Panel
      title={recipe.app}
      sub={recipe.idea}
      live
      nested
      actions={<button className="btn quiet small" onClick={onClose}>Close</button>}
    >
      <ol className="steps">
        {recipe.steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
      {recipe.video && <p className="muted small">{recipe.video}</p>}
      <div className="row">
        <button className="btn primary" disabled={running} onClick={apply}>{running ? 'Setting up' : recipe.action.label}</button>
        <span className="muted small">Example address <code>{recipe.addressExample}</code></span>
      </div>
    </Panel>
  )
}

export function SignalPath() {
  return (
    <Panel title="Signal path" sub="Left to right: what comes in, what RICO does with it, and where it goes.">
      <Flow />
    </Panel>
  )
}

export function Recipes() {
  const [open, setOpen] = useState<string | null>(null)
  const recipe = RECIPES.find((r) => r.id === open)
  return (
    <Panel title="Use RICO with" sub="Pick an app. RICO prepares its side, and the steps cover the rest.">
      <div className="stack">
        <div className="apps">
          {RECIPES.map((r) => (
            <button key={r.id} className={`app-card${open === r.id ? ' on' : ''}`} onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
              <span className="app-name">{r.app}</span>
              <span className="app-idea">{r.idea}</span>
              {r.port && <span className="app-port">OSC {r.port}</span>}
            </button>
          ))}
        </div>
        {recipe && <RecipeView recipe={recipe} onClose={() => setOpen(null)} />}
      </div>
    </Panel>
  )
}
