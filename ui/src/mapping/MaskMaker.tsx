import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from '../components/Toasts'
import { pickFile } from '../shell/ui'
import { getWorld, isLight, useWorld } from '../three/world'
import { glCamera } from './calib'
import { addGobo, newGobo, getGobos } from './gobos'
import { newMask, setMap, useMap, type P2 } from './model'
import { boxSelect, combine, edges, grow, photoFrom, selectionToMasks, silhouette, smartSelect, smoothSel, wand, type Photo } from './photoMask'

// Masks and stencils from a picture: open a JPEG or PNG, click the object
// (smart select), or drag a box around it, and RICO traces its shape into a
// projection mask, and into a plate you can 3D print and put on the lens.

const QKEY = (out: string) => `rico.mapping.photoquad.${out}`
type Tool = 'smart' | 'box' | 'wand'
const TOOL_TIP: Record<Tool, string> = {
  smart: 'Click the object. It grows over similar colors and stops at edges.',
  box: 'Drag a box around the object. RICO learns the background from the box edge.',
  wand: 'Click a color. Everything close to it is picked.',
}

export default function MaskMaker({ out }: { out: string }) {
  const map = useMap(out)
  const [photo, setPhoto] = useState<{ p: Photo; url: string } | null>(null)
  const [sel, setSel] = useState<Uint8Array | null>(null)
  const [tool, setTool] = useState<Tool>('smart')
  const [sens, setSens] = useState(0.4)
  const [lightInside, setLightInside] = useState(true)
  const [align, setAlign] = useState(false)
  const [box, setBox] = useState<[number, number, number, number] | null>(null)
  const [saved, setQuad] = useState<P2[] | null>(() => { try { return JSON.parse(localStorage.getItem(QKEY(out)) ?? 'null') } catch { return null } })
  const [obj, setObj] = useState('')
  const overlay = useRef<HTMLCanvasElement | null>(null)
  const area = useRef<HTMLDivElement | null>(null)
  const drag = useRef<number | null>(null)
  const objects = useWorld((w) => w.objects.filter((o) => !isLight(o.kind) && o.kind !== 'fog' && o.visible))
  const edge = useMemo(() => (photo ? edges(photo.p) : null), [photo])

  const saveQuad = (q: P2[]) => { setQuad(q); try { localStorage.setItem(QKEY(out), JSON.stringify(q)) } catch { /* fine */ } }
  // Where the projector's picture sits in the photo. Not lined up: the photo
  // is placed in the middle of the output at its own shape (never squeezed
  // to the output's shape), so masks keep the true outline of the object.
  const fit = (): P2[] => {
    if (!photo) return [[0, 0], [1, 0], [1, 1], [0, 1]]
    const pa = photo.p.w / photo.p.h, oa = map.res[0] / map.res[1]
    if (pa <= oa) { const r = oa / pa; return [[0.5 - r / 2, 0], [0.5 + r / 2, 0], [0.5 + r / 2, 1], [0.5 - r / 2, 1]] }
    const r = pa / oa
    return [[0, 0.5 - r / 2], [1, 0.5 - r / 2], [1, 0.5 + r / 2], [0, 0.5 + r / 2]]
  }
  const quad: P2[] = align && saved ? saved : fit()

  useEffect(() => {
    const c = overlay.current
    if (!c || !photo) return
    c.width = photo.p.w; c.height = photo.p.h
    const g = c.getContext('2d')!
    const img = g.createImageData(photo.p.w, photo.p.h)
    if (sel) {
      const { w, h } = photo.p
      for (let i = 0; i < sel.length; i++) {
        if (!sel[i]) { img.data[i * 4 + 3] = 110; continue }        // dim what is not picked
        const x = i % w, y = (i - x) / w
        const border = (x > 0 && !sel[i - 1]) || (x < w - 1 && !sel[i + 1]) || (y > 0 && !sel[i - w]) || (y < h - 1 && !sel[i + w])
        if (border) { img.data[i * 4] = 59; img.data[i * 4 + 1] = 255; img.data[i * 4 + 2] = 3; img.data[i * 4 + 3] = 255 }
      }
    }
    g.putImageData(img, 0, 0)
  }, [sel, photo])

  const open = () => pickFile('image/png,image/jpeg,image/webp', (f) => {
    const url = URL.createObjectURL(f)
    const img = new Image()
    img.onload = () => { const r = photoFrom(img, img.naturalWidth, img.naturalHeight, 900); setPhoto({ p: r.photo, url }); setSel(null) }
    img.onerror = () => toast('That picture did not open.')
    img.src = url
  })

  const at = (e: React.PointerEvent): P2 => { const r = area.current!.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height] }
  const px = (u: number, v: number): [number, number] => [Math.max(0, Math.min(photo!.p.w - 1, Math.floor(u * photo!.p.w))), Math.max(0, Math.min(photo!.p.h - 1, Math.floor(v * photo!.p.h)))]

  const shapes = (): P2[][] => (photo && sel ? selectionToMasks(smoothSel(sel, photo.p.w, photo.p.h, 1), photo.p.w, photo.p.h, quad).filter((s) => s.length >= 3) : [])

  const addMasks = (list: P2[][], name: string, gobo = false) => {
    if (!list.length) { toast('Nothing picked yet. Click the object first.'); return }
    const made = list.map((points, i) => newMask({ name: `${name}${list.length > 1 ? ` ${i + 1}` : ''}`, points, invert: lightInside, feather: 2 }))
    setMap(out, (m) => ({ ...m, masks: [...m.masks, ...made] }))
    if (gobo) {
      // a gobo with only these new masks on it
      const others = map.masks.map((m) => m.id)
      const base = getGobos().find((g) => g.out === out)?.opts
      addGobo(newGobo(out, base, { name: `Gobo ${name}`, mode: 'masks', skip: others }))
      window.dispatchEvent(new CustomEvent('rico-mapsec', { detail: 'stencil' }))
      toast(`Mask${made.length > 1 ? 's' : ''} and a gobo made. The gobo is in "Gobos", ready for the Print and Laser tabs.`, true)
      return
    }
    toast(`${list.length} mask${list.length > 1 ? 's' : ''} made. See them in the Masks tab and on the projector.`, true)
  }

  const from3D = async () => {
    if (!map.solved) { toast('Calibrate this projector first (the "3D objects" tab).'); return }
    const o = getWorld().objects.find((x) => x.id === obj) ?? objects.find((x) => x.kind !== 'plane')
    if (!o) { toast('There is no 3D object to use.'); return }
    const eng = await import('../three/engine')
    const root = eng.objectOf(o.id)
    if (!root) return
    const THREE = eng.THREE
    root.updateMatrixWorld(true)
    const tris: number[] = []
    const v = new THREE.Vector3()
    root.traverse((c) => {
      const m = c as InstanceType<typeof THREE.Mesh>
      if (!m.isMesh || m.userData.helper) return
      const pos = m.geometry.getAttribute('position')
      if (!pos) return
      const idx = m.geometry.index
      const n = idx ? idx.count : pos.count
      for (let i = 0; i < n; i++) { v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(m.matrixWorld); tris.push(v.x, v.y, v.z) }
    })
    const [w, h] = map.res
    const { view, proj } = glCamera(map.solved, w, h)
    addMasks(silhouette(new Float32Array(tris), view, proj, 480, Math.round(480 * (h / w))), o.name)
  }

  const picked = sel ? sel.reduce((a, b) => a + b, 0) : 0
  return (
    <div className="mask-maker">
      <div className="mm-steps-row">
        <span className={`mm-step${photo ? ' done' : ''}`}><b>1</b> Open a picture</span>
        <span className={`mm-step${picked ? ' done' : ''}`}><b>2</b> Pick the object</span>
        <span className="mm-step"><b>3</b> Make a mask or a gobo</span>
      </div>
      <div className="row wrap gap">
        <button className="btn primary" onClick={open}>{photo ? 'Open another picture...' : 'Open a picture (JPEG or PNG)...'}</button>
        {photo && <>
          <div className="seg" role="group" aria-label="Selection tool">
            {(['smart', 'box', 'wand'] as Tool[]).map((t) => <button key={t} className={tool === t ? 'on' : ''} title={TOOL_TIP[t]} onClick={() => { setTool(t); setAlign(false) }}>{t === 'smart' ? 'Smart select' : t === 'box' ? 'Box around it' : 'Color wand'}</button>)}
          </div>
          <label className="mini" title="Higher picks more">Sensitivity <input className="range" type="range" min={0.02} max={1} step={0.01} value={sens} onChange={(e) => setSens(Number(e.target.value))} /></label>
          <button className="btn small quiet" disabled={!sel} onClick={() => sel && setSel(grow(sel, photo.p.w, photo.p.h, 2))}>Grow</button>
          <button className="btn small quiet" disabled={!sel} onClick={() => sel && setSel(grow(sel, photo.p.w, photo.p.h, -2))}>Shrink</button>
          <button className="btn small quiet" disabled={!sel} onClick={() => sel && setSel(smoothSel(sel, photo.p.w, photo.p.h, 2))}>Smooth</button>
          <button className="btn small quiet" disabled={!sel} onClick={() => setSel(null)}>Clear</button>
        </>}
      </div>
      {photo && <p className="dim small">{TOOL_TIP[tool]} Shift adds to what you have, Alt takes away.</p>}
      {photo && (
        <div className="mm-photo" ref={area} style={{ aspectRatio: `${photo.p.w} / ${photo.p.h}`, '--ar': (photo.p.w / photo.p.h).toFixed(4) } as React.CSSProperties}
          onPointerDown={(e) => {
            if (align || drag.current !== null) return
            const [u, v] = at(e)
            const [x, y] = px(u, v)
            const mode = e.altKey ? 'sub' : e.shiftKey ? 'add' : 'set'
            if (tool === 'box') { (e.currentTarget as Element).setPointerCapture(e.pointerId); setBox([u, v, u, v]); return }
            const picked = tool === 'smart' ? smartSelect(photo.p, x, y, sens, edge ?? undefined) : wand(photo.p, x, y, sens * 0.5, true)
            setSel((s) => combine(s ?? new Uint8Array(picked.length), picked, mode))
          }}
          onPointerMove={(e) => {
            const i = drag.current
            if (i !== null) { const q = [...quad]; q[i] = at(e); saveQuad(q); return }
            if (box && e.buttons) { const [u, v] = at(e); setBox([box[0], box[1], u, v]) }
          }}
          onPointerUp={(e) => {
            drag.current = null
            if (!box) return
            const [a, b] = px(box[0], box[1]), [c, d] = px(box[2], box[3])
            setBox(null)
            const picked = boxSelect(photo.p, a, b, c, d, sens)
            setSel((s) => combine(s ?? new Uint8Array(picked.length), picked, e.altKey ? 'sub' : e.shiftKey ? 'add' : 'set'))
          }}>
          <img src={photo.url} alt="Your picture" draggable={false} />
          <canvas ref={overlay} />
          {box && <i className="mm-box-sel" style={{ left: `${Math.min(box[0], box[2]) * 100}%`, top: `${Math.min(box[1], box[3]) * 100}%`, width: `${Math.abs(box[2] - box[0]) * 100}%`, height: `${Math.abs(box[3] - box[1]) * 100}%` }} />}
          {align && <>
            <svg viewBox="0 0 1 1" preserveAspectRatio="none"><polygon points={quad.map((p) => p.join(',')).join(' ')} vectorEffect="non-scaling-stroke" /></svg>
            {quad.map((p, i) => (
              <i key={i} className="mo-pt on" style={{ left: `${p[0] * 100}%`, top: `${p[1] * 100}%` }} title={['Top left', 'Top right', 'Bottom right', 'Bottom left'][i] + ' of the projected picture'}
                onPointerDown={(e) => { e.stopPropagation(); drag.current = i; (e.currentTarget.parentElement as HTMLElement).setPointerCapture(e.pointerId) }} />
            ))}
          </>}
        </div>
      )}
      {photo && (
        <div className="mm-actions">
          <label className="mini-check"><input type="checkbox" checked={lightInside} onChange={(e) => setLightInside(e.target.checked)} />Light only on the object (off: block it)</label>
          <button className="btn primary" disabled={!picked} onClick={() => addMasks(shapes(), 'From picture')}>Make projection mask</button>
          <button className="btn" disabled={!picked} onClick={() => addMasks(shapes(), 'From picture', true)} title="A mask, and a gobo with only this shape on it, to 3D print or laser cut">Mask and gobo</button>
          <label className="switch mini" title="Only if the photo was not taken from the projector: drag the corners onto the projected picture"><input type="checkbox" role="switch" checked={align} onChange={(e) => { if (e.target.checked && !saved) saveQuad([[0.05, 0.05], [0.95, 0.05], [0.95, 0.95], [0.05, 0.95]]); setAlign(e.target.checked) }} /><span>Line up with the projector</span></label>
        </div>
      )}
      {!photo && <p className="dim small">Best results: stand where the projector is, turn on the test pattern, and take the photo. A picture of the object on a plain background works great too.</p>}
      <details className="mm-3d">
        <summary>From a 3D object instead (calibrated projector)</summary>
        <div className="row wrap gap">
          <select className="select" value={obj} onChange={(e) => setObj(e.target.value)}>
            <option value="">The first object</option>
            {objects.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <button className="btn small primary" disabled={!map.solved} onClick={() => void from3D()}>Mask from its shape</button>
          {!map.solved && <span className="dim small">Calibrate in the "3D objects" tab first.</span>}
        </div>
      </details>
    </div>
  )
}
