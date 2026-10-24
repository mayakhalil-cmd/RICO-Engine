import Dropdown from '../components/Dropdown'
import { useEffect, useRef, useState } from 'react'
import Icon from '../components/Icon'
import RIcon from '../components/RIcons'
import Scrub from '../components/Scrub'
import { toast } from '../components/Toasts'
import { downloadBlob } from '../shell/ui'
import { showTab } from '../fab/nav'
import { FITS, filament, goboGeometry, goboShapes, MOUNTS, sleeveRadii, stl, svg, THROWS, type GoboOptions, type GoboPlan } from './gobo'
import {
  addGobo, applyMount, goboFileName, goboPerMask, goboPerProjector, goboPlan, newGobo, removeGobo, setGoboOpts, updateGobo, useGobos, type Gobo,
} from './gobos'
import { knownOutputs, outputName, useMap } from './model'

// Gobos: plates that block the light of a projector everywhere except your
// shapes. Each projector gets its own gobo. A gobo copies the masks you see
// on its projector; leave out (X) the ones you do not want on it, size them,
// and move them on the plate. The Print tab slices it for your printer, the
// Laser tab cuts it.

export const SHAPE_COLORS = ['#3bff03', '#f820a0', '#30e0ff', '#ffd23f', '#b48cff', '#ff8a3d']

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="ps-row" title={hint}><span>{label}</span><div>{children}</div></label>
}
function Mm({ value, set, min, max, step = 0.1, digits = 1, suffix = ' mm' }: { value: number; set: (v: number) => void; min: number; max: number; step?: number; digits?: number; suffix?: string }) {
  return <Scrub value={value} step={step} digits={digits} min={min} max={max} suffix={suffix} onChange={set} />
}

// ---- the plate from the front, where you move the shapes ----
export function PlateView({ p, o, move, colorOf, offsets }: { p: GoboPlan; o: GoboOptions; move?: (id: string, d: [number, number]) => void; colorOf?: (id: string, i: number) => string; offsets?: Record<string, [number, number]> }) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const drag = useRef<{ id: string; x: number; y: number; base: [number, number] } | null>(null)
  const [x0, y0, x1, y1] = p.plate
  const toMm = (e: React.PointerEvent): [number, number] => {
    const m = svgRef.current!.getScreenCTM()!.inverse()
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m)
    return [pt.x, -pt.y]
  }
  const ring = o.style === 'over' || o.style === 'into'
  return (
    <svg ref={svgRef} className="ps-plate" viewBox={`${x0 - 4} ${-y1 - 4} ${x1 - x0 + 8} ${y1 - y0 + 8}`}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d || !move) return
        const [x, y] = toMm(e)
        move(d.id, [Math.round((d.base[0] + x - d.x) * 2) / 2, Math.round((d.base[1] + y - d.y) * 2) / 2])
      }}
      onPointerUp={() => { drag.current = null }}>
      {p.round ? <circle cx={0} cy={0} r={p.round} className="g-plate" /> : <rect x={x0} y={-y1} width={x1 - x0} height={y1 - y0} rx={o.corner} className="g-plate" />}
      {ring && <circle cx={0} cy={0} r={sleeveRadii(o).inn} className="g-lens" />}
      <circle cx={0} cy={0} r={0.8} className="g-axis" />
      {p.items.map((it, k) => (
        <g key={it.id} className={`ps-item${move ? ' movable' : ''}`} style={{ '--ic': colorOf ? colorOf(it.id, k) : SHAPE_COLORS[k % SHAPE_COLORS.length] } as React.CSSProperties}
          onPointerDown={(e) => {
            if (!move) return
            ;(e.currentTarget.ownerSVGElement as Element).setPointerCapture(e.pointerId)
            const [x, y] = toMm(e)
            drag.current = { id: it.id, x, y, base: offsets?.[it.id] ?? [0, 0] }
          }}>
          {it.openings.map((c, i) => <polygon key={i} points={c.map(([x, y]) => `${x},${-y}`).join(' ')} />)}
          <title>{it.name}</title>
        </g>
      ))}
      {p.holes.map(([x, y], i) => <circle key={i} cx={x} cy={-y} r={o.holeDia / 2} className="g-hole" />)}
    </svg>
  )
}

function ShapeList({ g }: { g: Gobo }) {
  const map = useMap(g.out)
  const all = goboShapes(map, g.mode)
  const inList = all.filter((s) => !g.skip.includes(s.id))
  const out = all.filter((s) => g.skip.includes(s.id))
  const colorIdx = (id: string) => Math.max(0, all.findIndex((s) => s.id === id))
  if (!all.length) return <p className="dim small">{g.mode === 'masks' ? 'This projector has no masks yet. Draw some in Masks, or make them from a picture. Or switch to "Like the projection".' : 'This projector shows nothing yet.'}</p>
  return (
    <>
      <ul className="gb-shapes">
        {inList.map((s) => (
          <li key={s.id}>
            <i className="gb-dot" style={{ background: g.mode === 'masks' ? SHAPE_COLORS[colorIdx(s.id) % SHAPE_COLORS.length] : '#3bff03' }} />
            <span className="grow">{s.name}<span className="dim small"> {s.kind === 'surface' ? 'surface' : s.invert ? 'mask, light inside' : 'mask'}</span></span>
            {g.mode === 'masks' && <>
              <label className="mini" title="Size of this shape on the plate">Size <Scrub value={g.sizes[s.id] ?? 100} step={0.5} digits={0} min={10} max={400} suffix="%" onChange={(v) => updateGobo(g.id, { sizes: { ...g.sizes, [s.id]: v } })} /></label>
              {(g.offsets[s.id] || (g.sizes[s.id] ?? 100) !== 100) && <button className="btn small quiet" title="Where and how big the projector puts it" onClick={() => { const o2 = { ...g.offsets }; delete o2[s.id]; const s2 = { ...g.sizes }; delete s2[s.id]; updateGobo(g.id, { offsets: o2, sizes: s2 }) }}>Exact</button>}
            </>}
            <button className="icon-btn small danger" title="Leave it out of this gobo" onClick={() => updateGobo(g.id, { skip: [...g.skip, s.id] })}><Icon name="x" /></button>
          </li>
        ))}
      </ul>
      {out.length > 0 && (
        <div className="gb-left-out">
          <span className="dim small">Left out:</span>
          {out.map((s) => <button key={s.id} className="chip" title="Put it back on this gobo" onClick={() => updateGobo(g.id, { skip: g.skip.filter((x) => x !== s.id) })}>+ {s.name}</button>)}
          <button className="btn small quiet" onClick={() => updateGobo(g.id, { skip: [] })}>Put all back</button>
        </div>
      )}
    </>
  )
}

function GoboEditor({ g }: { g: Gobo }) {
  const map = useMap(g.out)
  const o = g.opts
  const up = (part: Partial<GoboOptions>) => setGoboOpts(g.id, part)
  const p = goboPlan(g)
  const [x0, y0, x1, y1] = p.plate
  const outs = [...new Set([...knownOutputs(), g.out])].sort()
  const name = goboFileName(g)
  const all = goboShapes(map, g.mode)
  const onLens = o.style === 'over' || o.style === 'into'
  const tall = onLens ? o.distance + o.sleeve + o.plateThickness : o.plateThickness
  const sr = sleeveRadii(o)
  const [grams, setGrams] = useState<string>('')
  const key = JSON.stringify([p.openings, p.plate, o])
  useEffect(() => {
    let live = true
    const t = window.setTimeout(() => { void goboGeometry(p, o).then((geo) => { if (live) { const f = filament(geo); setGrams(`about ${f.grams.toFixed(1)} g, ${f.meters.toFixed(2)} m`) } }) }, 150)
    return () => { live = false; window.clearTimeout(t) }
  }, [key])  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="gb-edit">
      <div className="row wrap gap">
        <input className="input" value={g.name} onChange={(e) => updateGobo(g.id, { name: e.target.value })} aria-label="Gobo name" style={{ width: 190 }} />
        <label className="mini">On <select className="select mini" value={g.out} onChange={(e) => updateGobo(g.id, { out: e.target.value, skip: [], offsets: {}, sizes: {} })}>
          {outs.map((id) => <option key={id} value={id}>{outputName(id)}</option>)}
        </select></label>
        <span className="grow" />
        <button className="icon-btn small danger" title="Delete this gobo" onClick={() => removeGobo(g.id)}><RIcon name="trash" size={14} /></button>
      </div>

      <fieldset className="ps-group"><legend>What lets light through</legend>
        <div className="seg" role="group" aria-label="Openings">
          <button className={g.mode === 'masks' ? 'on' : ''} title="Every mask on this projector is an opening of its own, exactly where you see it" onClick={() => updateGobo(g.id, { mode: 'masks' })}>Each mask is an opening</button>
          <button className={g.mode === 'projection' ? 'on' : ''} title="Light only where the projection is lit: surfaces, minus the masks" onClick={() => updateGobo(g.id, { mode: 'projection' })}>Like the projection</button>
        </div>
        <ShapeList g={g} />
        <div className="seg" role="group" aria-label="Shape of the openings">
          <button className={!o.grow ? 'on' : ''} title="The openings are exactly your masks" onClick={() => up({ grow: false })}>Exact shape</button>
          <button className={o.grow ? 'on' : ''} title="Openings grow by half the lens glass, so the picture is never cut. The shape gets rounder." onClick={() => up({ grow: true })}>Never clip the picture</button>
        </div>
        <Row label="Mask size" hint="Every opening on the plate. 100% is exactly what the projector shows."><Mm value={o.maskScale ?? 100} set={(v) => up({ maskScale: v })} min={10} max={400} step={0.5} digits={0} suffix="%" /></Row>
        {g.mode === 'masks' && all.length > 1 && <button className="btn small quiet" onClick={() => { const n = goboPerMask(g.id); if (n) toast(`${n} gobos made, one for each mask. Put each on its own projector.`, true) }}>One gobo per mask</button>}
      </fieldset>

      <div className="gb-plate">
        <PlateView p={p} o={o} offsets={g.offsets} colorOf={(id, k) => (g.mode === 'masks' ? SHAPE_COLORS[Math.max(0, all.findIndex((s) => s.id === id)) % SHAPE_COLORS.length] : SHAPE_COLORS[k % SHAPE_COLORS.length])}
          move={(id, d) => updateGobo(g.id, { offsets: { ...g.offsets, [id]: d } })} />
        <dl className="ps-stats">
          <div><dt>Size</dt><dd>{(x1 - x0).toFixed(0)} x {(y1 - y0).toFixed(0)} x {tall.toFixed(tall < 10 ? 1 : 0)} mm</dd></div>
          <div><dt>Openings</dt><dd>{p.openings.length}</dd></div>
          <div><dt>Filament</dt><dd>{grams || '...'}</dd></div>
          <div><dt>Edge softness</dt><dd className={p.soft > 0.3 ? 'warn-text' : ''}>{(p.soft * 100).toFixed(0)}%</dd></div>
        </dl>
        {p.soft > 0.3 && <p className="warn-text small">Edges will be soft. A larger plate distance makes them sharper.</p>}
        <p className="dim small">Drag a shape to move it on the plate.</p>
      </div>

      <div className="row wrap">
        <button className="btn primary" disabled={!p.openings.length} onClick={() => showTab('print', g.id)}><RIcon name="printer" size={16} /> Print it</button>
        <button className="btn" disabled={!p.openings.length} onClick={() => showTab('laser', g.id)}><RIcon name="laser" size={16} /> Laser cut it</button>
        <button className="btn quiet" disabled={!p.openings.length} onClick={async () => downloadBlob(`${name}.stl`, await stl(p, o))}>STL</button>
        <button className="btn quiet" disabled={!p.openings.length} onClick={() => downloadBlob(`${name}.svg`, new Blob([svg(p)], { type: 'image/svg+xml' }))}>SVG</button>
      </div>

      <fieldset className="ps-group"><legend>How it fits your lens</legend>
        <Row label="Ready fit" hint="Common lenses. Rest the mouse on one to see what it is for">
          <Dropdown label="Lens fit" value={o.mount} placeholder="Your own sizes" onPick={(id) => applyMount(g.id, id)}
            choices={MOUNTS.map((m) => ({ id: m.id, name: m.name, about: m.about, group: m.part.style === 'over' ? 'The lens sticks out' : m.part.style === 'into' ? 'The lens is set in' : 'No sleeve' }))} />
        </Row>
        <div className="seg" role="group" aria-label="Kind">
          <button className={o.style === 'over' ? 'on' : ''} title="The lens sticks out: the sleeve slides over it" onClick={() => up({ style: 'over' })}>Over the lens</button>
          <button className={o.style === 'into' ? 'on' : ''} title="The lens is set into the case: the sleeve slides into the hole" onClick={() => up({ style: 'into' })}>Into the hole</button>
          <button className={o.style === 'flat' ? 'on' : ''} onClick={() => up({ style: 'flat' })}>Plate only</button>
        </div>
        {onLens && <>
          <p className="dim small">{o.style === 'over' ? 'Measure across the outside of the lens barrel with a caliper.' : 'Measure across the hole the lens sits in.'} It slides on and holds by itself: no screws, tape or glue.</p>
          <Row label={o.style === 'over' ? 'Lens barrel' : 'Hole'} hint="Across, in millimetres"><Mm value={o.lensDiameter} set={(v) => up({ lensDiameter: v, mount: undefined })} min={10} max={200} step={0.05} digits={2} /></Row>
          <Row label="Fit">
            <div className="seg" role="group" aria-label="Fit">
              {FITS.map((f) => <button key={f.id} title={f.about} className={Math.abs(o.fit - f.fit) < 0.001 ? 'on' : ''} onClick={() => up({ fit: f.fit })}>{f.name}</button>)}
            </div>
          </Row>
          <Row label="Room" hint="Space between the sleeve and the lens. Printers differ: if it is too tight, add 0.05"><Mm value={o.fit} set={(v) => up({ fit: v })} min={-0.3} max={1.5} step={0.01} digits={2} /></Row>
          <label className="mini-check" title="Small ribs press on the lens so it holds even with some room"><input type="checkbox" checked={o.ribs !== false} onChange={(e) => up({ ribs: e.target.checked })} />Grip ribs</label>
          <Row label="Sleeve length" hint="How far it goes over the lens (or into the hole)"><Mm value={o.sleeve} set={(v) => up({ sleeve: v })} min={3} max={60} step={0.5} digits={1} /></Row>
          <Row label="Length" hint="From the front of the lens to the plate. Longer: sharper edges and a bigger plate. Shorter: a smaller gobo."><Mm value={o.distance} set={(v) => up({ distance: v })} min={2} max={400} step={0.5} digits={1} /></Row>
          <Row label="Walls">
            <div className="seg" role="group" aria-label="Walls">
              <button className={o.body !== 'legs' ? 'on' : ''} title="Closed walls: no stray light at all" onClick={() => up({ body: 'cone' })}>Closed</button>
              <button className={o.body === 'legs' ? 'on' : ''} title="Four legs: less filament, prints faster" onClick={() => up({ body: 'legs' })}>Four legs</button>
            </div>
          </Row>
          <Row label="Wall"><Mm value={o.thickness} set={(v) => up({ thickness: v })} min={0.8} max={6} step={0.02} /></Row>
          {o.body === 'legs' && <Row label="Leg width"><Mm value={o.strut} set={(v) => up({ strut: v })} min={1.2} max={12} /></Row>}
          <p className="dim small">Sleeve {(sr.inn * 2).toFixed(2)} mm inside, {(sr.out * 2).toFixed(2)} mm outside.</p>
        </>}
      </fieldset>

      <fieldset className="ps-group"><legend>Projector</legend>
        <div className="seg" role="group" aria-label="Kind of lens">
          {THROWS.map((t) => <button key={t.id} title={t.about} className={Math.abs(o.throwRatio - (t.part.throwRatio ?? 0)) < 0.001 ? 'on' : ''} onClick={() => up(t.part)}>{t.name}</button>)}
        </div>
        <Row label="Throw ratio" hint="Distance divided by picture width, from the manual"><Mm value={o.throwRatio} set={(v) => up({ throwRatio: v })} min={0.2} max={5} step={0.005} digits={3} suffix="" /></Row>
        <Row label="Lens shift"><Mm value={o.offset} set={(v) => up({ offset: v })} min={-150} max={150} step={0.5} digits={0} suffix="%" /></Row>
        <Row label="Lens glass"><Mm value={o.aperture} set={(v) => up({ aperture: v })} min={2} max={150} /></Row>
        {!onLens && <Row label="Plate distance" hint="From the lens to the plate. Further away makes sharper edges and a bigger plate"><Mm value={o.distance} set={(v) => up({ distance: v })} min={2} max={500} step={0.5} digits={0} /></Row>}
        <p className="dim small">Ultra short throw projectors (with a mirror) can not take a gobo.</p>
      </fieldset>

      <fieldset className="ps-group"><legend>Plate</legend>
        <Row label="Thickness" hint="Six layers at 0.2 mm is plenty"><Mm value={o.plateThickness} set={(v) => up({ plateThickness: v })} min={0.4} max={6} step={0.02} /></Row>
        <Row label="Border" hint="Plate around the farthest opening"><Mm value={o.border} set={(v) => up({ border: v })} min={1} max={40} /></Row>
        {!onLens && <label className="mini-check"><input type="checkbox" checked={o.round !== false} onChange={(e) => up({ round: e.target.checked })} />Round plate</label>}
        {!onLens && o.round === false && <Row label="Round corners"><Mm value={o.corner} set={(v) => up({ corner: v })} min={0} max={30} /></Row>}
        {o.grow && <Row label="Extra room" hint="With Never clip the picture: openings grow by this much too"><Mm value={o.margin} set={(v) => up({ margin: v })} min={0} max={20} step={0.05} /></Row>}
        {!onLens && <><Row label="Holes">
          <div className="seg" role="group" aria-label="Holes">
            {([0, 2, 4] as const).map((n) => <button key={n} className={o.holes === n ? 'on' : ''} onClick={() => up({ holes: n })}>{n ? `${n}` : 'None'}</button>)}
          </div>
        </Row>
        {o.holes > 0 && <Row label="Hole size" hint="3.4 mm fits an M3 screw"><Mm value={o.holeDia} set={(v) => up({ holeDia: v })} min={1} max={10} step={0.02} /></Row>}</>}
      </fieldset>
    </div>
  )
}

export default function Stencil({ out }: { out: string }) {
  const gobos = useGobos()
  const [pick, setPick] = useState<string | null>(null)
  const mine = gobos.filter((g) => g.out === out)
  const cur = gobos.find((g) => g.id === pick) ?? mine[0] ?? gobos[0]
  return (
    <div className="gb">
      <div className="gb-tabs" role="tablist" aria-label="Gobos">
        {gobos.map((g) => (
          <button key={g.id} role="tab" aria-selected={cur?.id === g.id} className={`gb-tab${cur?.id === g.id ? ' on' : ''}${g.out === out ? ' here' : ''}`} onClick={() => setPick(g.id)} title={`${g.name} (${outputName(g.out)})`}>
            <b>{g.name}</b><span>{outputName(g.out)}</span>
          </button>
        ))}
        <button className="btn small quiet" onClick={() => { const g = addGobo(newGobo(out, cur?.opts)); setPick(g.id) }}>+ Gobo</button>
        <button className="btn small quiet" title="Every projector that has no gobo yet gets one" onClick={() => { const n = goboPerProjector(); toast(n ? `${n} gobo${n > 1 ? 's' : ''} made.` : 'Every projector has a gobo already.', Boolean(n)) }}>One per projector</button>
      </div>
      {cur ? <GoboEditor key={cur.id} g={cur} /> : <p className="dim small">No gobos yet. Press "+ Gobo".</p>}
    </div>
  )
}
