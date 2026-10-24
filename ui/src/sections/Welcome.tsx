import { useEffect, useRef, useState } from 'react'
import Logo from '../components/Logo'
import { calm, Scramble, spotlight, useReveal, useScrollY } from '../components/Reveal'
import { openOverlay } from '../shell/ui'
import { startTour } from '../shell/Tour'
import { dockApi, goTo } from '../shell/workspaces'

// The first thing in the Overview: what RICO is, what people make with it,
// and where to start. Left aligned, one idea per block, lots of air. A pulse
// runs through In, RICO and Out and rolls their words one at a time, and the
// cards slide in as you scroll.

const open = (ws: string, panel?: string) => {
  goTo(ws)
  if (panel) window.setTimeout(() => { const api = dockApi(); if (api) void import('../shell/Workspace').then((m) => m.openPanel(api, panel)) }, 150)
}

const USES: { title: string; story: string; label: string; ws: string; panel?: string }[] = [
  { title: 'Visuals that dance', story: 'The audio lab finds the kick and the tempo. Your layers move with them.', label: 'Audio lab', ws: 'audio', panel: 'audio-lab' },
  { title: 'Light on real objects', story: 'Click an object in a photo, get a mask, warp your picture onto it.', label: 'Mapping', ws: 'mapping', panel: 'mapping' },
  { title: 'A light show', story: 'Fixtures, colors, chases in time, and cues you fire with GO.', label: 'Lighting desk', ws: 'light', panel: 'light-desk' },
  { title: 'Sound for a show', story: 'Tracks, live effects and instruments, with cues that fire other apps.', label: 'Sound editor', ws: 'audio', panel: 'sound-editor' },
  { title: 'A controller for anything', story: 'Any knob, your phone or a tablet, to OSC, MIDI, DMX or MQTT.', label: 'Phone controls', ws: 'devices', panel: 'phone' },
  { title: 'LEDs and your own hardware', story: 'Pixels and values to LED strips, a Raspberry Pi or a microcontroller.', label: 'LEDs and hardware', ws: 'output', panel: 'sends' },
]

// The signal reel: what comes in, what RICO does with it, what goes out.
// A pulse runs along the wire and back; as it reaches each station, that
// station's word rolls to the next one, like a split-flap board, and the
// station flashes. Words change one station at a time, never all at once.
const IN = ['Controllers', 'OSC', 'Audio', 'DMX', 'Your phone', 'MIDI', 'Sensors']
const MID = ['Routes', 'Nodes', 'Timeline', 'Analysis', 'Mapping', 'Scripts']
const OUT = ['Visuals', '3D', 'Light', 'Sound', 'Video', 'LEDs', 'Robots']
const PASS = 1700     // one trip of the pulse along the wire, in ms
const AT = [0.03, 0.5, 0.97]   // where the three stations sit on the wire

function Reel({ words, i, hot }: { words: string[]; i: number; hot: boolean }) {
  const n = words.length
  const at = ((i % n) + n) % n
  return (
    <span className={`rl-reel${hot ? ' hot' : ''}`} aria-live="polite" aria-label={words[at]}>
      <span className="rl-track" style={{ transform: `translateY(${-at * 1.25}em)` }}>
        {words.map((w, k) => <span key={w} className={`rl-word${k === at ? ' on' : ''}`}>{w}</span>)}
      </span>
    </span>
  )
}

// The pulse goes out from In through RICO to Out, then an answer comes back
// from Out through RICO to In, again and again. Each station rolls to its
// next word only at the moment the pulse reaches it.
function FlowReel() {
  const [idx, setIdx] = useState([0, 0, 0])
  const [hot, setHot] = useState(-1)
  const [back, setBack] = useState(false)
  const pulse = useRef<HTMLElement | null>(null)
  const quiet = calm()
  useEffect(() => {
    if (quiet) return
    let raf = 0
    const start = performance.now()
    let lastPass = -1, lastHit = -1, curHot = -1
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const e = now - start
      const pass = Math.floor(e / PASS)
      const t = (e % PASS) / PASS
      const rev = pass % 2 === 1
      const x = rev ? 1 - t : t
      // at the ends the pulse turns around: that station rolls once, not twice
      if (pass !== lastPass) { lastPass = pass; setBack(rev) }
      if (pulse.current) {
        pulse.current.style.left = `${x * 100}%`
        pulse.current.style.opacity = String(Math.min(1, Math.min(t, 1 - t) * 14))
      }
      // the pulse reaches a station: that station rolls on and flashes
      const k = AT.findIndex((a) => Math.abs(x - a) < 0.02)
      if (k >= 0 && k !== lastHit) { lastHit = k; curHot = k; setHot(k); setIdx((v) => v.map((n, j) => (j === k ? n + 1 : n))) }
      else if (curHot !== -1 && AT.every((a) => Math.abs(x - a) > 0.07)) { curHot = -1; setHot(-1) }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [quiet])
  return (
    <div className={`rl${back ? ' back' : ''}`} aria-label="How RICO works">
      <div className="rl-wire" aria-hidden="true">
        <i className="rl-line" />
        {!quiet && <i ref={pulse} className="rl-pulse" />}
      </div>
      <div className={`rl-station in${hot === 0 ? ' hot' : ''}`}>
        <span className="rl-k">In</span>
        <Reel words={IN} i={idx[0]} hot={hot === 0} />
      </div>
      <div className={`rl-station core${hot === 1 ? ' hot' : ''}`}>
        <span className="rl-core" aria-hidden="true"><i /><i /><b>RICO</b></span>
        <Reel words={MID} i={idx[1]} hot={hot === 1} />
      </div>
      <div className={`rl-station out${hot === 2 ? ' hot' : ''}`}>
        <span className="rl-k">Out</span>
        <Reel words={OUT} i={idx[2]} hot={hot === 2} />
      </div>
    </div>
  )
}

function Use({ u, i, go }: { u: (typeof USES)[number]; i: number; go: () => void }) {
  const [over, setOver] = useState(0)
  return (
    <button className="wl-use" style={{ '--i': i } as React.CSSProperties} onClick={go}
      onPointerMove={spotlight} onPointerEnter={() => setOver((n) => n + 1)}>
      <h3><Scramble text={u.title} play={over || -1} dur={360} /></h3>
      <p>{u.story}</p>
      <span className="wl-go">{u.label}<i aria-hidden="true">{'→'}</i></span>
    </button>
  )
}

export default function Welcome() {
  const page = useRef<HTMLDivElement | null>(null)
  const hero = useRef<HTMLDivElement | null>(null)
  const make = useReveal<HTMLElement>()
  const tips = useReveal<HTMLElement>()
  useScrollY(page, (y) => {
    // the title drifts up a little slower than the page, and fades
    const h = hero.current
    if (!h) return
    h.style.transform = `translateY(${y * 0.25}px)`
    h.style.opacity = String(Math.max(0.15, 1 - y / 700))
  })
  return (
    <div className="dpanel welcome" ref={page}>
      <header className="wl-hero">
        <div className="wl-hero-main" ref={hero}>
          <h1><Logo size="1em" stroke={2} /></h1>
          <p className="wl-sub">Real-time Integration Control Operations</p>
          <p className="wl-lead"><span>Sound, knobs and messages come in.</span><span>Visuals, light, sound, MIDI and OSC go out.</span></p>
          <div className="wl-actions">
            <button className="btn primary" onClick={startTour}>Take the tour</button>
            <button className="btn quiet" onClick={() => openOverlay('starters')}>Start from a project</button>
          </div>
        </div>
        <FlowReel />
      </header>

      <section className="wl-make reveal" ref={make}>
        <div className="wl-head">
          <h2 className="wl-h2">What you can make</h2>
        </div>
        <div className="wl-uses">
          {USES.map((u, i) => <Use key={u.title} u={u} i={i} go={() => open(u.ws, u.panel)} />)}
        </div>
      </section>

      <section className="wl-tips reveal" ref={tips} aria-label="Good to know">
        <div><span className="wl-n">Find</span><p><kbd>Ctrl+K</kbd> finds anything.</p></div>
        <div><span className="wl-n">Link</span><p>Drag any signal onto any setting to link them.</p></div>
        <div><span className="wl-n">Private</span><p>Everything stays on this computer.</p></div>
      </section>
    </div>
  )
}
