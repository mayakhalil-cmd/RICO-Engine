import { Num } from './RigPanels'
import { updateObject, useWorld, type Obj3D } from './world'
import { SYM_GROUPS, SYM_NUMS, SYMBIOTE_DEFAULT, symOf, type Symbiote } from './symbioteParams'
import { dockApi } from '../shell/workspaces'

// The Symbiote tab: every part of how the symbiote looks and moves, in groups.

const NOT = ['point-light', 'spot-light', 'sun', 'fog', 'fluid', 'plane']

function useSym(o: Obj3D) {
  const sy = symOf(o.symbiote)
  const set = (part: Partial<Symbiote>, k: string) => updateObject(o.id, { symbiote: { ...(o.symbiote ?? SYMBIOTE_DEFAULT), ...part } as Symbiote }, 'Symbiote', `${o.id}.sy.${k}`)
  return { sy, set }
}

export function openSymbioteTab() {
  const api = dockApi()
  if (!api) return
  const have = api.getPanel('3d-symbiote')
  if (have) { have.api.setActive(); return }
  void import('../shell/Workspace').then((m) => m.openPanel(api, '3d-symbiote'))
}

function Colors({ o }: { o: Obj3D }) {
  const { sy, set } = useSym(o)
  return (
    <>
      <label className="param"><span className="param-label">Shader</span>
        <select className="select" value={sy.shader} onChange={(e) => set({ shader: e.target.value as Symbiote['shader'] }, 'shader')}>
          <option value="wet">Wet: glossy with a soft shine</option>
          <option value="oily">Oily: a rainbow film like oil</option>
          <option value="flesh">Flesh: softer and less shiny</option>
          <option value="own">The object's own material</option>
        </select></label>
      {sy.shader !== 'own' && (
        <div className="row gap wrap">
          <label className="param"><span className="param-label">Color</span><input type="color" className="swatch" value={sy.color} onChange={(e) => set({ color: e.target.value }, 'color')} /></label>
          <label className="param"><span className="param-label">Shine</span><input type="color" className="swatch" value={sy.shine} onChange={(e) => set({ shine: e.target.value }, 'shine')} /></label>
        </div>
      )}
    </>
  )
}

function GroupBody({ o, group }: { o: Obj3D; group: string }) {
  const { sy, set } = useSym(o)
  return (
    <>
      {group === 'Look' && <Colors o={o} />}
      {group === 'Veins' && (
        <>
          <label className="mini-check"><input type="checkbox" checked={sy.veinsOn} onChange={(e) => set({ veinsOn: e.target.checked }, 'veinsOn')} /> Veins under the skin</label>
          <div className="row gap wrap">
            <label className="param"><span className="param-label">Vein color</span><input type="color" className="swatch" value={sy.veins} onChange={(e) => set({ veins: e.target.value }, 'veins')} /></label>
            <label className="param"><span className="param-label">Second color</span><input type="color" className="swatch" value={sy.veins2} onChange={(e) => set({ veins2: e.target.value }, 'veins2')} /></label>
          </div>
        </>
      )}
      {group === 'Drips' && (
        <label className="param"><span className="param-label">On the floor</span>
          <select className="select" value={sy.puddle} onChange={(e) => set({ puddle: e.target.value as 'stay' | 'fade' }, 'puddle')}>
            <option value="fade">Puddles fade away after a while</option>
            <option value="stay">Puddles stay</option>
          </select></label>
      )}
      {SYM_NUMS.filter((p) => p.group === group && !(p.key === 'puddleTime' && sy.puddle === 'stay')).map((p) => (
        <Num key={p.key} label={p.label} value={Number(sy[p.key])} min={p.min} max={p.max} step={p.step ?? (p.max - p.min > 5 ? 0.05 : 0.01)}
          onChange={(v) => set({ [p.key]: p.step === 1 ? Math.round(v) : v } as Partial<Symbiote>, p.key)}
          target={p.keyable ? `3d:${o.id}.symbx.${p.key}` : undefined} />
      ))}
    </>
  )
}

const ABOUT: Record<string, string> = {
  Look: 'The color and the shine of the skin',
  Veins: 'Veins under the skin that push it out and throb',
  Body: 'How the body crawls, breathes and swells',
  Tendrils: 'How many, how thick, and how fast they latch on',
  Holding: 'How they hang and move once they hold',
  Stretching: 'What happens when you pull the two apart',
  Snapping: 'How they tear, spring back and curl',
  Drips: 'Drips that fall when they stretch and snap',
  Quality: 'The speed of everything, and how smooth it is',
}

export function SymbiotePanel() {
  const world = useWorld((w) => w)
  const sel = useWorld((_, s) => s)
  const o = world.objects.find((x) => x.id === sel)
  if (!o) return <div className="dpanel inspector"><h3>Symbiote</h3><p className="dim small">Pick an object in the view. Its symbiote settings show here.</p></div>
  if (NOT.includes(o.kind)) return <div className="dpanel inspector"><h3>Symbiote</h3><p className="dim small">Lights, fog, floors and fluids cannot be a symbiote. Pick a shape or a model.</p></div>
  if (!o.symbiote) {
    return (
      <div className="dpanel inspector">
        <h3>Symbiote</h3>
        <p className="dim small">Turn {o.name} into a living goo that reaches for things near it.</p>
        <button className="btn primary" onClick={() => updateObject(o.id, { symbiote: { ...SYMBIOTE_DEFAULT } }, 'Symbiote')}>Make it a symbiote</button>
      </div>
    )
  }
  const sy = symOf(o.symbiote)
  return (
    <div className="dpanel inspector sym-panel">
      <div className="row gap">
        <label className="mini-check"><input type="checkbox" checked={sy.on} onChange={(e) => updateObject(o.id, { symbiote: { ...o.symbiote!, on: e.target.checked } }, 'Symbiote')} /></label>
        <h3 className="grow">Symbiote: {o.name}</h3>
        <button className="btn" title="Every setting back to the start" onClick={() => updateObject(o.id, { symbiote: { ...SYMBIOTE_DEFAULT, on: sy.on } }, 'Reset symbiote')}>Reset</button>
        <button className="icon-btn danger" title="Remove the symbiote" onClick={() => updateObject(o.id, { symbiote: undefined }, 'Remove symbiote')}>×</button>
      </div>
      {SYM_GROUPS.map((g, i) => (
        <details key={g} className="r-group" open={i < 4}>
          <summary><span>{g}</span><span className="grow" /><span className="dim small">{ABOUT[g]}</span></summary>
          <div className="r-body"><GroupBody o={o} group={g} /></div>
        </details>
      ))}
    </div>
  )
}

/** The short version inside Object settings > Deform. */
export function SymbioteQuick({ o }: { o: Obj3D }) {
  const { sy, set } = useSym(o)
  return (
    <div className="r-card">
      <div className="row gap">
        <label className="mini-check"><input type="checkbox" checked={sy.on} onChange={(e) => set({ on: e.target.checked }, 'on')} /></label>
        <b>Symbiote</b><span className="grow" />
        <button className="icon-btn danger" title="Remove" onClick={() => updateObject(o.id, { symbiote: undefined }, 'Remove symbiote')}>×</button>
      </div>
      <Colors o={o} />
      {SYM_NUMS.filter((p) => ['reach', 'detach', 'thick', 'latch', 'gravity'].includes(p.key)).map((p) => (
        <Num key={p.key} label={p.label} value={Number(sy[p.key])} min={p.min} max={p.max} step={p.step ?? 0.01} onChange={(v) => set({ [p.key]: v } as Partial<Symbiote>, p.key)} target={p.keyable ? `3d:${o.id}.symbx.${p.key}` : undefined} />
      ))}
      <button className="btn" onClick={openSymbioteTab}>Every setting: open the Symbiote tab</button>
    </div>
  )
}
