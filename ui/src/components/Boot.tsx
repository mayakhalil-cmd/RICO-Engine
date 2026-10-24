import { useEffect, useRef, useState } from 'react'
import { rico } from '../engine/connection'
import { setPrefs } from '../prefs'

// A short start-up readout, in the voice of the app icon. It reports what
// is really happening (the engine answering, devices found), and any key or
// click skips it.

export default function Boot({ onDone }: { onDone: () => void }) {
  const [lines, setLines] = useState<string[]>(['> RICO'])
  const [done, setDone] = useState(false)
  const doneRef = useRef(onDone)
  doneRef.current = onDone

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let cancelled = false
    const finish = () => {
      if (cancelled) return
      setDone(true)
      window.setTimeout(() => doneRef.current(), reduced ? 0 : 220)
    }
    const add = (l: string) => !cancelled && setLines((x) => [...x, l])

    const run = async () => {
      const wait = (ms: number) => new Promise((r) => window.setTimeout(r, reduced ? 0 : ms))
      await wait(60)
      add('> starting engine')
      const t0 = performance.now()
      while (!rico.get().state && performance.now() - t0 < 1500) await wait(40)
      const s = rico.get()
      if (!s.state) {
        add('> engine not answering, opening anyway')
      } else {
        add(s.status === 'demo' ? '> demo mode, no devices are touched' : `> engine ${s.version}`)
        await wait(60)
        add(`> midi  ${s.state.midi.inputs.length} in / ${s.state.midi.outputs.length} out`)
        await wait(50)
        const t = s.state.video.transports.filter((x) => x.available).map((x) => x.name.toLowerCase())
        add(`> video ${['spout', ...t].join(' + ')}`)
      }
      await wait(90)
      add('> ready_')
      await wait(160)
      finish()
    }
    run()
    const skip = () => finish()
    window.addEventListener('keydown', skip, { once: true })
    window.addEventListener('pointerdown', skip, { once: true })
    return () => {
      cancelled = true
      window.removeEventListener('keydown', skip)
      window.removeEventListener('pointerdown', skip)
    }
  }, [])

  return (
    <div className={`boot${done ? ' done' : ''}`} aria-hidden="true">
      <div>
        <pre>{lines.join('\n')}</pre>
        <button className="btn quiet small" style={{ marginTop: 24 }} onClick={() => { setPrefs({ boot: false }); onDone() }}>
          Don't show this again
        </button>
      </div>
    </div>
  )
}
