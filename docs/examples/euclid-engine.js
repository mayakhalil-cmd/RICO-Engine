// EUCLID ENGINE: a stress test for RICO scripts.
//
// Four Euclidean rhythm tracks drive everything at once:
//   - MIDI notes (one channel per track) with note offs
//   - OSC with several values per message, to any app
//   - a DMX chase over 16 channels that flashes and fades
//   - signals you can link in Create, 3D and Nodes ("Euclid: track 1"...)
//   - a picture called "Euclid" for Create (Node picture layer) and 3D (Picture material)
//   - remote control over UDP, OSC and MIDI, with a loopback self test
//   - a Flood slider that sends hundreds of extra OSC messages a second
//
// Click the rings to add or remove accents. Watch the numbers at the bottom:
// clock jitter, messages a second, and how long one frame of drawing takes.
//
// Remote control (UDP port 7400, plain text):
//   bpm 128          mute 2          rotate 1 3          hits 4 5
// OSC in: /euclid/bpm 140      MIDI in: CC 1 to 4 set the hits of tracks 1 to 4

const HOST = '127.0.0.1'
const OSC_PORT = 9000
const UDP_PORT = 7400
const DMX_START = 1

// ---- the tracks ----

const tracks = [
  { name: 'Kick',  steps: 16, hits: 4, rotate: 0, note: 36, ch: 10, color: '#3bff03', muted: false },
  { name: 'Snare', steps: 16, hits: 2, rotate: 4, note: 38, ch: 10, color: '#f820a0', muted: false },
  { name: 'Hat',   steps: 16, hits: 11, rotate: 0, note: 42, ch: 10, color: '#6f86ff', muted: false },
  { name: 'Bass',  steps: 13, hits: 5, rotate: 2, note: 33, ch: 2,  color: '#ffd23f', muted: false },
]
for (const t of tracks) { t.pattern = []; t.accents = new Set(); t.env = 0; t.pos = -1 }

// Spreads the hits over the steps as evenly as possible (the same rhythms
// as Bjorklund's method, found in a lot of world music).
function euclid(steps, hits, rotate) {
  hits = Math.max(0, Math.min(steps, hits))
  const out = []
  for (let i = 0; i < steps; i++) out.push((i * hits) % steps < hits ? 1 : 0)
  const r = ((rotate % steps) + steps) % steps
  return out.slice(steps - r).concat(out.slice(0, steps - r))
}
const rebuild = () => tracks.forEach((t) => { t.pattern = euclid(t.steps, t.hits, t.rotate) })
rebuild()

// ---- controls ----

ui.title('Euclid engine')
const bpm = ui.slider('Tempo (BPM)', { min: 40, max: 220, value: 124, step: 1 })
const swing = ui.slider('Swing', { min: 0, max: 0.5, value: 0.12 })
const flood = ui.slider('Flood (extra OSC a step)', { min: 0, max: 200, value: 0, step: 1 })
const target = ui.select('Send OSC to', ['127.0.0.1:9000', '127.0.0.1:7000', '127.0.0.1:8000'], `${HOST}:${OSC_PORT}`, () => {})
ui.row(() => {
  for (const t of tracks) {
    ui.toggle(t.name, true, (on) => { t.muted = !on })
  }
})
ui.row(() => {
  ui.button('Shuffle rhythms', () => {
    for (const t of tracks) { t.hits = 1 + Math.floor(Math.random() * (t.steps - 1)); t.rotate = Math.floor(Math.random() * t.steps) }
    rebuild()
  })
  ui.button('Loopback self test', () => {
    selfTest = { sent: performance.now(), got: 0 }
    rico.udp.send('127.0.0.1', UDP_PORT, 'ping ' + Math.round(selfTest.sent))
  })
  ui.button('All notes off', allOff)
})

// The rings. Click a step to add or remove an accent.
const view = ui.canvas(300, (p) => {
  if (p.type !== 'down') return
  const W = 600, H = 300
  const x = p.x * W, y = p.y * H
  tracks.forEach((t, i) => {
    const cx = 75 + i * 150, cy = 150
    const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy)
    if (d < 35 || d > 72) return
    let a = Math.atan2(dy, dx) + Math.PI / 2
    if (a < 0) a += Math.PI * 2
    const step = Math.floor((a / (Math.PI * 2)) * t.steps) % t.steps
    if (t.accents.has(step)) t.accents.delete(step)
    else t.accents.add(step)
  })
})
const stats = ui.label('Starting...')
const pic = rico.picture('Euclid', 960, 540)

// ---- sending ----

let sentCount = 0, sentLast = 0, rate = 0
let selfTest = null
const dmx = new Array(16).fill(0)
const dmxSent = new Array(16).fill(-1)

function oscOut(address, ...args) {
  const [host, port] = target.value.split(':')
  rico.osc.sendTo(host, Number(port), address, ...args)
  sentCount++
}

function hit(t, i, step) {
  const accent = t.accents.has(step)
  const vel = accent ? 127 : 80 + Math.floor(Math.random() * 30)
  t.env = accent ? 1 : 0.7
  rico.midi.note(t.ch, t.note, vel)
  rico.after(90, () => rico.midi.note(t.ch, t.note, 0))
  oscOut(`/euclid/track/${i + 1}`, step, vel / 127, t.name, accent ? 1 : 0)
  // The chase: each hit lights the next fixture of this track's group of 4.
  const fixture = i * 4 + (step % 4)
  dmx[fixture] = 1
  sentCount += 2
}

function allOff() {
  for (const t of tracks) rico.midi.note(t.ch, t.note, 0)
  for (let c = 0; c < 16; c++) { dmx[c] = 0; dmxSent[c] = 0; rico.dmx.set(DMX_START + c, 0) }
}

// ---- remote control ----

rico.udp.listen(UDP_PORT, (text, bytes, from) => {
  const [cmd, a, b] = text.trim().split(/\s+/)
  if (cmd === 'ping' && selfTest) {
    selfTest.got = performance.now()
    rico.log(`Loopback: UDP came back in ${(selfTest.got - selfTest.sent).toFixed(1)} ms`)
  } else if (cmd === 'bpm') bpm.set(Number(a))
  else if (cmd === 'mute') { const t = tracks[Number(a) - 1]; if (t) t.muted = !t.muted }
  else if (cmd === 'rotate') { const t = tracks[Number(a) - 1]; if (t) { t.rotate = Number(b) || 0; rebuild() } }
  else if (cmd === 'hits') { const t = tracks[Number(a) - 1]; if (t) { t.hits = Number(b) || 0; rebuild() } }
  else rico.log(`From ${from}: ${text.trim()}`)
})
rico.osc.on('/euclid/bpm', (v) => bpm.set(v))
rico.midi.on((m) => {
  if (m.type === 'CC' && m.number >= 1 && m.number <= 4) {
    const t = tracks[m.number - 1]
    t.hits = Math.round((m.value / 127) * t.steps)
    rebuild()
  }
})

// ---- the clock ----
// Checked every 5 ms against the real time, so the timing does not drift.

let step = 0
let next = performance.now() + 100
let jitter = 0
rico.every(5, () => {
  const now = performance.now()
  if (now < next) return
  jitter = jitter * 0.9 + Math.abs(now - next) * 0.1
  const sixteenth = 60000 / bpm.value / 4
  const swingMs = (step % 2 === 0 ? 1 : -1) * swing.value * sixteenth
  next += sixteenth + swingMs
  if (now - next > 200) next = now + sixteenth   // came back from a pause
  tracks.forEach((t, i) => {
    const s = step % t.steps
    t.pos = s
    if (!t.muted && t.pattern[s]) hit(t, i, s)
  })
  for (let k = 0; k < flood.value; k++) oscOut('/euclid/flood', k, step, Math.random())
  step++
})

// ---- every frame: fades, signals, DMX, drawing ----

rico.frame((dt, time) => {
  const t0 = performance.now()
  for (const t of tracks) {
    t.env = Math.max(0, t.env - dt * 4)
    rico.signal(`track ${tracks.indexOf(t) + 1}`, t.env)
  }
  for (let c = 0; c < 16; c++) {
    dmx[c] = Math.max(0, dmx[c] - dt * 3)
    const level = Math.round(dmx[c] * 255)
    if (level !== dmxSent[c]) { dmxSent[c] = level; rico.dmx.set(DMX_START + c, level / 255); sentCount++ }
  }
  if (time - sentLast >= 1) { rate = sentCount / (time - sentLast); sentCount = 0; sentLast = time }

  // The rings in the panel.
  view.fillStyle = '#000'
  view.fillRect(0, 0, 600, 300)
  tracks.forEach((t, i) => drawRing(view, 75 + i * 150, 150, 55, t))

  // The shared picture: bigger rings that pulse, for Create and 3D.
  const g = pic.ctx
  g.fillStyle = 'rgba(0, 0, 0, 0.25)'
  g.fillRect(0, 0, pic.width, pic.height)
  tracks.forEach((t, i) => {
    const r = 70 + t.env * 60
    drawRing(g, 150 + i * 220, 270, r, t)
  })
  pic.show()

  const drawMs = performance.now() - t0
  stats.set(`${bpm.value.toFixed(0)} BPM   jitter ${jitter.toFixed(2)} ms   ${rate.toFixed(0)} messages/s   frame ${drawMs.toFixed(2)} ms`)
})

function drawRing(g, cx, cy, r, t) {
  g.save()
  g.lineWidth = 2
  for (let s = 0; s < t.steps; s++) {
    const a0 = (s / t.steps) * Math.PI * 2 - Math.PI / 2
    const a1 = ((s + 1) / t.steps) * Math.PI * 2 - Math.PI / 2 - 0.05
    g.beginPath()
    g.arc(cx, cy, r, a0, a1)
    const on = t.pattern[s], here = s === t.pos
    g.strokeStyle = here ? '#ffffff' : on ? t.color : '#1a4a08'
    g.lineWidth = on ? (t.accents.has(s) ? 12 : 7) : 2
    g.globalAlpha = t.muted ? 0.3 : 1
    g.stroke()
  }
  g.globalAlpha = 1
  g.fillStyle = t.color
  g.beginPath()
  g.arc(cx, cy, 6 + t.env * r * 0.4, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#fff'
  g.font = '14px "Courier Prime", monospace'
  g.textAlign = 'center'
  g.fillText(`${t.name} ${t.hits}/${t.steps}`, cx, cy + r + 24)
  g.restore()
}

// Stopping the script turns everything off.
return () => allOff()
