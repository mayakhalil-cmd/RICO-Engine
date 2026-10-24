import { useEffect, useRef, useState } from 'react'
import MapOverlay, { type Pick } from '../mapping/MapOverlay'
import { MapRenderer } from '../mapping/render'
import { getMap, outputName, setMap, setMapQuiet, useMap } from '../mapping/model'

// An output window: one projector or screen. It draws the surfaces of its
// mapping (made in the main window's Projection mapping panel, or right here:
// press E to edit points on the projector itself).

type Hooks = { __ricoSources?: (s: Map<string, TexImageSource>) => void; __ricoWants?: () => string[] }

export default function OutputApp({ id }: { id: string }) {
  const name = outputName(id)
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const map = useMap(id)
  const [ui, setUi] = useState(true)
  const [edit, setEdit] = useState(false)
  const [pick, setPick] = useState<Pick | null>(null)
  const [linked, setLinked] = useState(Boolean(window.opener))
  const [problem, setProblem] = useState('')
  const renderer = useRef<MapRenderer | null>(null)
  const sources = useRef(new Map<string, TexImageSource>())

  useEffect(() => {
    document.title = `RICO ${name}`
    const c = canvas.current!
    try { renderer.current = new MapRenderer(c) } catch (e) { setProblem((e as Error).message) }
    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      c.width = Math.round(window.innerWidth * dpr)
      c.height = Math.round(window.innerHeight * dpr)
      // The projector's real size, for exact calibration and arrow-key moves.
      const res: [number, number] = [c.width, c.height]
      if (!getMap(id).resFixed && getMap(id).res.join() !== res.join()) setMapQuiet(id, (m) => ({ ...m, res }))
    }
    resize()
    window.addEventListener('resize', resize)
    let hide = 0
    const onMove = () => {
      setUi(true)
      window.clearTimeout(hide)
      hide = window.setTimeout(() => setUi(false), 2500)
    }
    window.addEventListener('pointermove', onMove)
    onMove()
    const hooks = window as unknown as Hooks
    // Which pictures this output needs, so the main window only sends those.
    hooks.__ricoWants = () => [...new Set(getMap(id).surfaces.filter((s) => s.on).map((s) => s.source))]
    // The main window hands over the pictures after each frame.
    hooks.__ricoSources = (s) => {
      sources.current = s
      try { renderer.current?.render(getMap(id), s, name) } catch { /* lost the context for a moment */ }
    }
    // Keep drawing (test patterns, solids) even when the main window is busy.
    const iv = window.setInterval(() => { try { renderer.current?.render(getMap(id), sources.current, name) } catch { /* ignore */ } }, 250)
    const check = window.setInterval(() => setLinked(Boolean(window.opener) && !window.opener.closed), 1000)
    return () => {
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', onMove)
      window.clearInterval(iv)
      window.clearInterval(check)
    }
  }, [id, name])

  const full = () => {
    if (document.fullscreenElement) document.exitFullscreen()
    else document.documentElement.requestFullscreen().catch(() => undefined)
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.startsWith('Arrow')) return
      const k = e.key.toLowerCase()
      if (k === 'f') full()
      else if (k === 'c' || (k === 'e' && !document.querySelector('.mo-gizmo'))) setEdit((x) => !x)   // with a shape picked, E turns it
      else if (k === 't') setMap(id, (m) => ({ ...m, test: !m.test }))
      else if (k === 'p') setMap(id, (m) => ({ ...m, showPoints: !m.showPoints }))
      else if (e.key === 'Escape') setPick(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [id])

  return (
    <div className="out-root" onDoubleClick={full}>
      <canvas ref={canvas} className="out-canvas" style={{ width: '100vw', height: '100vh' }} />
      {(edit || map.showPoints) && <MapOverlay out={id} pick={pick} onPick={setPick} big />}
      {problem && <div className="out-msg">{problem}</div>}
      {!linked && <div className="out-msg">This output window lost the main RICO window. Close it and open a new one.</div>}
      <div className={`out-ui${ui || edit ? ' show' : ''}`} onDoubleClick={(e) => e.stopPropagation()}>
        <b>{name}</b>
        <button onClick={full}>Full screen <kbd>F</kbd></button>
        <button className={edit ? 'on' : ''} onClick={() => setEdit(!edit)}>Edit points <kbd>E</kbd></button>
        <button className={map.test ? 'on' : ''} onClick={() => setMap(id, (m) => ({ ...m, test: !m.test }))}>Test pattern <kbd>T</kbd></button>
        <button className={map.showPoints ? 'on' : ''} onClick={() => setMap(id, (m) => ({ ...m, showPoints: !m.showPoints }))}>3D points <kbd>P</kbd></button>
        <span className="out-tip">Drag this window to the projector and double-click for full screen. Press E (or C) and drag points onto your surfaces; arrow keys move a point one pixel. Click a shape, then W moves, E turns and R sizes it. Everything else is in the main window, in the Mapping tab.</span>
      </div>
    </div>
  )
}
