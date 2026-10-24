import { graphToText, nodeGuide, textToGraph } from './text'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as RPointerEvent } from 'react'
import CodeBox from '../components/CodeBox'
import PopMenu from '../components/PopMenu'
import SignalPicker from '../components/SignalPicker'
import { onSharedChange, pictureLabel, pictureNames, sharedVersion } from '../engine/shared'
import { dockApi } from '../shell/workspaces'
import { toast } from '../components/Toasts'
import { useCreate } from '../create/store'
import { layerType, MASTER_PARAMS } from '../create/layers'
import { useTick } from '../engine/useTick'
import { getCommands } from '../shell/commands'
import { askText, askYesNo, downloadJson, pickFile } from '../shell/ui'
import { getWorld, isLight, LINKABLE } from '../three/world'
import { NODE_TYPES, nodeType, type NodeGroup, type NodeParam, type NodeType, type Port, type PortType, type Value } from './types'
import { customType, getLibrary, importDefs, removeDef, saveDef, useLibrary, type CustomDef } from './custom'
import { toCanvas, type TexRef } from './gpu'
import {
  changeGraph, cloneInside, encapsulate, getGraph, getGraphs, graphTree, makeNode, nodePorts, nodeState, outputs, putGraph, uid, useGraphs, wire,
  type GNode, type Note, type Graph, type RicoxFile, type Wire,
} from './store'

// The node editor: drag nodes around, pull wires from an output (right) to
// an input (left). Double-click or press Tab for new nodes.

const W = 200            // node width (code and table nodes are wider)
const HEAD = 28          // node title height
const ROW = 22           // port row height

const portY = (i: number) => HEAD + 6 + i * ROW + ROW / 2
const GROUP_CLASS: Record<NodeGroup, string> = {
  Sources: 'src', Shape: 'shape', Logic: 'logic', Events: 'event', Data: 'data', Texture: 'tex', Geometry: 'geo', Outputs: 'out', Custom: 'custom',
}
const GROUP_ORDER: NodeGroup[] = ['Sources', 'Events', 'Shape', 'Logic', 'Data', 'Texture', 'Geometry', 'Outputs', 'Custom']
const GROUP_LABEL: Record<NodeGroup, string> = {
  Sources: 'Sources (signals in)', Events: 'Events (hits, timing)', Shape: 'Shape numbers', Logic: 'Logic', Data: 'Data (lists, text, tables)',
  Texture: 'Pictures (GPU)', Geometry: 'Geometry (3D shapes)', Outputs: 'Outputs', Custom: 'Build your own',
}
// Sections: the network reads left to right, from what comes in to what
// goes out. Each family of nodes has its own color and place. You can
// rename them, recolor them, add your own and take them away.
export interface Section { name: string; groups: NodeGroup[]; cls: string; color?: string }
const DEFAULT_SECTIONS: Section[] = [
  { name: 'In', groups: ['Sources', 'Events'], cls: 'src' },
  { name: 'Change', groups: ['Shape', 'Logic', 'Data', 'Custom'], cls: 'shape' },
  { name: 'Pictures', groups: ['Texture'], cls: 'tex' },
  { name: 'Shapes', groups: ['Geometry'], cls: 'geo' },
  { name: 'Out', groups: ['Outputs'], cls: 'out' },
]
const FAM_COLOR: Record<string, string> = { src: '#6f86ff', event: '#ff8a3d', shape: '#3bff03', logic: '#ffd23f', data: '#b48cff', tex: '#30e0ff', geo: '#ffb3e6', out: '#f820a0', custom: '#d8d8d8' }
const SKEY = 'rico.nodes.sections'
let sectionList: Section[] = (() => { try { const v = JSON.parse(localStorage.getItem(SKEY) ?? 'null'); return Array.isArray(v) && v.length ? v : DEFAULT_SECTIONS } catch { return DEFAULT_SECTIONS } })()
let sectionVersion = 0
const sectionListeners = new Set<() => void>()
function setSections(next: Section[]) {
  sectionList = next.length ? next : DEFAULT_SECTIONS
  sectionVersion++
  sectionListeners.forEach((l) => l())
  try { localStorage.setItem(SKEY, JSON.stringify(sectionList)) } catch { /* not remembered */ }
}
function useSections() { useSyncExternalStore((l) => { sectionListeners.add(l); return () => sectionListeners.delete(l) }, () => sectionVersion); return sectionList }
const LANE_W = 300
const sectionOf = (g?: NodeGroup) => Math.max(0, sectionList.findIndex((s) => g && s.groups.includes(g)))
const TAG: Record<NodeGroup, string> = { Sources: 'IN', Events: 'TIME', Shape: 'SHAPE', Logic: 'LOGIC', Data: 'DATA', Texture: 'PIC', Geometry: '3D', Outputs: 'OUT', Custom: 'MINE' }
const TYPE_NAME: Record<PortType, string> = { num: 'number', tex: 'picture', geo: 'shape', text: 'text', list: 'list' }
const widthOf = (t?: NodeType) => (t?.ui === 'code' || t?.ui === 'table' ? 300 : t?.ui === 'thumb' ? 220 : W)

// Numbers, text and lists turn into each other. Pictures and shapes only
// plug into pictures and shapes.
const fits = (from: PortType, to: PortType) => from === to || (from !== 'tex' && from !== 'geo' && to !== 'tex' && to !== 'geo')

// How a value shows in a node title.
function show(v: Value): string | null {
  if (v === undefined || v === null) return null
  if (typeof v === 'number') return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)
  if (typeof v === 'string') return v.length > 14 ? `"${v.slice(0, 13)}…"` : `"${v}"`
  if (typeof v === 'boolean') return v ? 'on' : 'off'
  if (Array.isArray(v)) return `[${v.length}]`
  if (v.kind === 'tex') return `${v.w}×${v.h}`
  if (v.kind === 'geo') return `${v.points} pts`
  return null
}

const useShared = () => useSyncExternalStore(onSharedChange, sharedVersion)

// A live preview of a picture node, about 10 times a second.
function Thumb({ id }: { id: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const iv = window.setInterval(() => {
      const out = outputs.get(id)
      if (!out || !ref.current) return
      const tex = Object.values(out).find((v) => v && (v as TexRef).kind === 'tex') as TexRef | undefined
      if (tex) toCanvas(tex, ref.current, 220)
    }, 100)
    return () => window.clearInterval(iv)
  }, [id])
  return <canvas className="ne-thumb" ref={ref} width={2} height={2} />
}

interface View { x: number; y: number; z: number }
type Drag =
  | { kind: 'move'; start: { x: number; y: number }; origin: Map<string, { x: number; y: number }>; moved: boolean }
  | { kind: 'pan'; start: { x: number; y: number }; view: View }
  | { kind: 'wire'; from: { node: string; port: string }; to: { x: number; y: number } }
  | { kind: 'box'; a: { x: number; y: number }; b: { x: number; y: number } }

function ParamEditor({ node, p, graph, disabled }: { node: GNode; p: NodeParam; graph: Graph; disabled: boolean }) {
  const scene = useCreate((s) => s.scene)
  const value = node.params[p.key] ?? p.default
  const set = (v: number | string | boolean) =>
    changeGraph(graph.id, `Change ${p.label.toLowerCase()}`, (g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === node.id ? { ...n, params: { ...n.params, [p.key]: v } } : n)) }), `${node.id}.${p.key}`)
  const stop = { onPointerDown: (e: RPointerEvent) => e.stopPropagation(), onKeyDown: (e: React.KeyboardEvent) => e.stopPropagation() }

  if (p.kind === 'code') {
    return <div className="ne-param wide" {...stop} onWheel={(e) => e.stopPropagation()}><CodeBox label={p.label} rows={p.key === 'data' ? 4 : 7} value={String(value)} onChange={set} error={p.key === 'code' ? String(nodeState(node.id)?.err ?? '') : undefined} /></div>
  }
  if (p.kind === 'signal') return <div className="ne-param wide" {...stop}><SignalPicker compact label={`${node.id}.${p.key}`} value={String(value)} onChange={set} /></div>
  if (p.kind === 'bool') {
    return (
      <label className="ne-param check" {...stop}>
        <input type="checkbox" checked={Boolean(value)} onChange={(e) => set(e.target.checked)} /> <span>{p.label}</span>
      </label>
    )
  }
  let control: React.ReactNode
  if (p.kind === 'choice') {
    control = <select className="select" value={Number(value)} onChange={(e) => set(Number(e.target.value))}>{p.choices?.map((c, i) => <option key={c} value={i}>{c}</option>)}</select>
  } else if (p.kind === 'text') {
    control = <input className="input" value={String(value)} spellCheck={false} onChange={(e) => set(e.target.value)} />
  } else if (p.kind === 'param') {
    const opts: { id: string; label: string }[] = []
    for (const l of scene.layers) {
      opts.push({ id: `${l.id}.opacity`, label: `${l.name}: Opacity` })
      for (const lp of layerType(l.type).params) if (lp.kind === 'number') opts.push({ id: `${l.id}.${lp.key}`, label: `${l.name}: ${lp.label}` })
    }
    for (const mp of MASTER_PARAMS) opts.push({ id: `master.${mp.key}`, label: `Finish: ${mp.label}` })
    for (const o of getWorld().objects) {
      for (const l of LINKABLE) {
        if (isLight(o.kind) !== (l.key === 'intensity' || l.key.startsWith('position') || l.key === 'hue')) continue
        opts.push({ id: `3d:${o.id}.${l.key}`, label: `3D ${o.name}: ${l.label}` })
      }
    }
    control = (
      <select className="select" value={String(value)} onChange={(e) => set(e.target.value)}>
        <option value="">Pick a setting...</option>
        {opts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    )
  } else if (p.kind === 'graph') {
    control = (
      <select className="select" value={String(value)} onChange={(e) => set(e.target.value)}>
        <option value="">Pick a network...</option>
        {getGraphs().filter((g) => g.id !== graph.id).map((g) => <option key={g.id} value={g.id}>{g.name}{g.inside ? ' (inside)' : ''}</option>)}
      </select>
    )
  } else if (p.kind === 'picture') {
    control = (
      <select className="select" value={String(value)} onChange={(e) => set(e.target.value)}>
        {!pictureNames().includes(String(value)) && <option value={String(value)}>{String(value) || 'Pick a picture'}</option>}
        {pictureNames().map((n) => <option key={n} value={n}>{pictureLabel(n)}</option>)}
      </select>
    )
  } else if (p.kind === 'command') {
    control = (
      <select className="select" value={String(value)} onChange={(e) => set(e.target.value)}>
        <option value="">Pick a command...</option>
        {getCommands().filter((c) => !c.id.startsWith('panel.')).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
      </select>
    )
  } else {
    const num = Number(value)
    control = (
      <span className="ne-num">
        {p.min !== undefined && p.max !== undefined && (
          <input type="range" className="range" min={p.min} max={p.max} step={p.step ?? 'any'} value={num} disabled={disabled} onChange={(e) => set(Number(e.target.value))} />
        )}
        <input className="input" value={Number.isInteger(num) ? num : num.toFixed(3)} disabled={disabled} inputMode="decimal"
          onChange={(e) => { const v = Number(e.target.value); if (!Number.isNaN(v)) set(v) }} />
      </span>
    )
  }
  return (
    <label className={`ne-param${disabled ? ' wired' : ''}`} {...stop}>
      <span>{p.label}{disabled ? ' (wired)' : ''}</span>
      {control}
    </label>
  )
}

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return null
  const lo = Math.min(...values), hi = Math.max(...values)
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${30 - ((v - lo) / (hi - lo || 1)) * 28 - 1}`).join(' ')
  return <svg className="ne-spark" viewBox="0 0 100 30" preserveAspectRatio="none"><polyline points={pts} /></svg>
}

function openInside(graphId: string) {
  const api = dockApi()
  if (!api || !graphId) return
  import('../shell/Workspace').then((m) => m.openPanel(api, `nodes-${graphId}`))
}

// Saves a Script node to "My nodes", and turns this node into one of those.
async function saveToLibrary(graph: Graph, node: GNode) {
  const name = await askText('Save to My nodes', 'Name', node.name ?? 'My node', 'Save')
  if (!name) return
  const def = saveDef({ name, about: '', inputs: String(node.params.inputs ?? ''), outputs: String(node.params.outputs ?? 'out'), code: String(node.params.code ?? '') })
  const t = customType(def.id)
  const params = Object.fromEntries((t?.params ?? []).map((p) => [p.key, p.default]))
  changeGraph(graph.id, `Save ${name}`, (g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === node.id ? { ...n, type: `custom:${def.id}`, name: undefined, params } : n)) }))
  toast(`${name} is in My nodes now. Find it with Tab in any network.`, true)
}

function SavedNodeCode({ type }: { type: string }) {
  const lib = useLibrary()
  const def = lib.find((d) => `custom:${d.id}` === type)
  if (!def) return <p className="ne-err">This saved node is not on this computer.</p>
  return (
    <details className="ne-saved" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <summary>Edit code (changes every copy)</summary>
      <CodeBox rows={7} value={def.code} onChange={(code) => saveDef({ ...def, code })} />
    </details>
  )
}

function NodeBox({ node, graph, selected, pos, onHeadDown, onPortDown, onPortUp }: {
  node: GNode
  graph: Graph
  selected: boolean
  pos: { x: number; y: number }
  onHeadDown: (e: RPointerEvent, id: string) => void
  onPortDown: (e: RPointerEvent, node: string, port: string, side: 'in' | 'out') => void
  onPortUp: (e: RPointerEvent, node: string, port: string) => void
}) {
  const t = nodeType(node.type)
  if (!t) {
    return (
      <div className="ne-node g-custom" style={{ left: pos.x, top: pos.y, width: W }} data-node={node.id}>
        <div className="ne-head" onPointerDown={(e) => onHeadDown(e, node.id)}><span>Missing node</span></div>
        <p className="ne-err">"{node.type}" is not on this computer. Import the file it came with.</p>
      </div>
    )
  }
  const { inputs, outputs: outs } = nodePorts(node)
  const out = outputs.get(node.id) ?? {}
  const rows = Math.max(inputs.length, outs.length)
  const wiredIn = new Set(graph.wires.filter((w) => w.to.node === node.id).map((w) => w.to.port))
  const st = nodeState(node.id)
  const mainOut = show(outs[0] ? out[outs[0].key] : inputs[0] ? out.in : undefined)
  const err = st?.err ? String(st.err) : ''
  const stop = { onPointerDown: (e: RPointerEvent) => e.stopPropagation() }
  const portClass = (p: Port) => `t-${p.type ?? 'num'}`
  return (
    <div className={`ne-node g-${GROUP_CLASS[t.group]}${selected ? ' selected' : ''}${err ? ' has-err' : ''}`} style={{ left: pos.x, top: pos.y, width: widthOf(t) }} data-node={node.id}>
      <div className="ne-head" onPointerDown={(e) => onHeadDown(e, node.id)} title={t.about} data-tag={TAG[t.group]}
        onDoubleClick={() => node.type === 'container' && openInside(String(node.params.graph))}>
        <span>{node.name ?? t.name}</span>
        {mainOut !== null && <span className="ne-val">{mainOut}</span>}
      </div>
      {rows > 0 && (
        <div className="ne-ports" style={{ height: rows * ROW + 12 }}>
          {inputs.map((p, i) => (
            <div key={p.key} className={`ne-port in ${portClass(p)}${wiredIn.has(p.key) ? ' wired' : ''}`} style={{ top: portY(i) - HEAD - ROW / 2 }}
              data-port={p.key} data-node={node.id} title={`${p.label}: ${TYPE_NAME[p.type ?? 'num']}`}
              onPointerDown={(e) => onPortDown(e, node.id, p.key, 'in')}
              onPointerUp={(e) => onPortUp(e, node.id, p.key)}>
              <i /><span>{p.label}</span>
            </div>
          ))}
          {outs.map((p, i) => {
            const v = out[p.key]
            return (
              <div key={p.key} className={`ne-port out ${portClass(p)}`} style={{ top: portY(i) - HEAD - ROW / 2 }} title={`${p.label}: ${TYPE_NAME[p.type ?? 'num']}`}
                onPointerDown={(e) => onPortDown(e, node.id, p.key, 'out')}>
                <span>{p.label}</span><i />
                {typeof v === 'number' && <b className="ne-level" style={{ width: `${Math.max(0, Math.min(1, v)) * 100}%` }} />}
              </div>
            )
          })}
        </div>
      )}
      {t.ui === 'thumb' && <Thumb id={node.id} />}
      {t.ui === 'button' && (
        <div className="ne-params" {...stop}>
          <button className="btn primary ne-bang" onClick={() => { const s = nodeState(node.id); if (s) s.click = 1 }}>Hit</button>
        </div>
      )}
      {t.ui === 'log' && (
        <pre className="ne-log">{((st?.lines as string[] | undefined) ?? []).join('\n') || 'Nothing yet'}</pre>
      )}
      {t.ui === 'table' && Array.isArray(st?.rows) && (
        <table className="ne-table"><tbody>
          {(st!.rows as string[][]).slice(0, 8).map((r, i) => (
            <tr key={i} className={i === Math.floor(Number(node.params.row)) ? 'on' : ''}>{r.slice(0, 6).map((c, j) => <td key={j}>{c}</td>)}</tr>
          ))}
        </tbody></table>
      )}
      {err && <p className="ne-err" title={err}>{err}</p>}
      {(t.params.length > 0 || node.type === 'watch' || node.type.startsWith('custom:')) && (
        <div className="ne-params">
          {node.type === 'watch' && <Spark values={(st?.h as number[] | undefined) ?? []} />}
          {t.params.map((p) => <ParamEditor key={p.key} node={node} p={p} graph={graph} disabled={wiredIn.has(p.key)} />)}
          {node.type === 'script' && <button className="btn small quiet" {...stop} onClick={() => saveToLibrary(graph, node)}>Save to My nodes</button>}
          {node.type === 'container' && <button className="btn small quiet" {...stop} onClick={() => openInside(String(node.params.graph))}>Open inside</button>}
          {node.type.startsWith('custom:') && <SavedNodeCode type={node.type} />}
        </div>
      )}
    </div>
  )
}

function Palette({ at, onPick, onClose }: { at: { x: number; y: number; h?: number }; onPick: (type: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [fam, setFam] = useState<NodeGroup | 'mine'>('Sources')
  const lib = useLibrary()
  const match = (t: NodeType) => !q || `${t.name} ${t.group} ${t.about} ${t.type}`.toLowerCase().includes(q.toLowerCase())
  const list = NODE_TYPES.filter(match)
  const mine = lib.map((d) => customType(d.id)).filter((t): t is NodeType => Boolean(t) && match(t!))
  const shown = q ? list : fam === 'mine' ? [] : list.filter((t) => t.group === fam)
  const first = q ? (mine[0] ?? list[0]) : (fam === 'mine' ? mine[0] : shown[0])
  const top = Math.max(4, Math.min(at.y, (at.h ?? 600) - 300))
  return (
    <div className="ne-palette" style={{ left: Math.max(4, at.x), top, maxHeight: Math.max(260, (at.h ?? 600) - top - 8) }} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <input className="input" autoFocus placeholder="Find a node: lfo, noise, metro, shader, twist..." value={q} onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') onClose()
          if (e.key === 'Enter' && first) onPick(first.type)
        }} />
      <div className="ne-pal-body">
        {!q && (
          <nav className="ne-fams" aria-label="Families">
            {GROUP_ORDER.filter((g) => g !== 'Custom').map((g) => (
              <button key={g} className={`ne-fam g-${GROUP_CLASS[g]}${fam === g ? ' on' : ''}`} onClick={() => setFam(g)}>
                <i />{GROUP_LABEL[g].replace(/ \(.*\)$/, '')}<span>{NODE_TYPES.filter((t) => t.group === g).length}</span>
              </button>
            ))}
            <button className={`ne-fam g-custom${fam === 'mine' ? ' on' : ''}`} onClick={() => setFam('mine')}><i />My nodes<span>{lib.length}</span></button>
            {NODE_TYPES.some((t) => t.group === 'Custom') && <button className={`ne-fam g-custom${fam === 'Custom' ? ' on' : ''}`} onClick={() => setFam('Custom')}><i />Build your own<span>{NODE_TYPES.filter((t) => t.group === 'Custom').length}</span></button>}
          </nav>
        )}
        <div className="ne-palette-list">
          {(q || fam === 'mine') && mine.length > 0 && (
            <section>
              <h5 className="g-custom">My nodes</h5>
              {mine.map((t) => (
                <div key={t.type} className="ne-mine">
                  <button onClick={() => onPick(t.type)} title={t.about}><b>{t.name}</b><span>{t.about}</span></button>
                  <button className="icon-btn danger" title="Remove from My nodes" onClick={async () => {
                    if (await askYesNo(`Remove ${t.name} from My nodes?`, 'Nodes already placed stop working until you import it again.', 'Remove')) removeDef(t.type.slice(7))
                  }}>×</button>
                </div>
              ))}
            </section>
          )}
          {fam === 'mine' && !q && !mine.length && <p className="dim small" style={{ padding: 8 }}>Nodes you save (right-click a container, Save to My nodes) show up here.</p>}
          {GROUP_ORDER.map((g) => {
            const items = shown.filter((t) => t.group === g)
            if (!items.length) return null
            return (
              <section key={g} className={`g-${GROUP_CLASS[g]}`}>
                {q && <h5 className={`g-${GROUP_CLASS[g]}`}>{GROUP_LABEL[g]}</h5>}
                <div className="ne-tiles">
                  {items.map((t) => (
                    <button key={t.type} className="ne-tile" onClick={() => onPick(t.type)} title={t.about}><b>{t.name}</b><span>{t.about}</span></button>
                  ))}
                </div>
              </section>
            )
          })}
          {q && !list.length && !mine.length && <p className="dim small" style={{ padding: 8 }}>No node called that. A Script node can do almost anything.</p>}
        </div>
      </div>
    </div>
  )
}

function paste(graph: Graph, file: RicoxFile, at: { x: number; y: number }) {
  const ids = new Map<string, string>()
  const minX = Math.min(...file.nodes.map((n) => n.x)), minY = Math.min(...file.nodes.map((n) => n.y))
  if (file.custom?.length) importDefs(file.custom)
  const pool = [...getGraphs(), ...(file.graphs ?? []).filter((g) => !getGraph(g.id))]
  const nodes = file.nodes.filter((n) => nodeType(n.type) || n.type.startsWith('custom:')).map((n) => {
    const id = uid()
    ids.set(n.id, id)
    // A pasted container gets its own copy of the network inside.
    const params = n.type === 'container' && n.params.graph ? { ...n.params, graph: cloneInside(String(n.params.graph), pool) ?? '' } : n.params
    return { ...n, id, params, x: n.x - minX + at.x, y: n.y - minY + at.y }
  })
  const wires: Wire[] = file.wires
    .filter((w) => ids.has(w.from.node) && ids.has(w.to.node))
    .map((w) => ({ id: uid(), from: { node: ids.get(w.from.node)!, port: w.from.port }, to: { node: ids.get(w.to.node)!, port: w.to.port } }))
  changeGraph(graph.id, `Add ${nodes.length} node${nodes.length === 1 ? '' : 's'}`, (g) => ({ ...g, nodes: [...g.nodes, ...nodes], wires: [...g.wires, ...wires] }))
  return nodes.map((n) => n.id)
}

let clipboard: RicoxFile | null = null

export default function NodeEditor({ graphId, onRename }: { graphId: string; onRename?: (name: string) => void }) {
  useGraphs()
  useShared()
  const graph = getGraph(graphId)
  const box = useRef<HTMLDivElement | null>(null)
  const [view, setView] = useState<View>({ x: 40, y: 30, z: 1 })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [lanes, setLanesRaw] = useState(() => { try { return localStorage.getItem('rico.nodes.lanes') !== '0' } catch { return true } })
  const setLanes = (on: boolean) => { setLanesRaw(on); try { localStorage.setItem('rico.nodes.lanes', on ? '1' : '0') } catch { /* fine */ } }
  const [selWire, setSelWire] = useState<string | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [livePos, setLivePos] = useState<Map<string, { x: number; y: number }> | null>(null)
  const [palette, setPalette] = useState<{ x: number; y: number; wx: number; wy: number } | null>(null)
  const [selNote, setSelNote] = useState<string | null>(null)
  const [secMenu, setSecMenu] = useState(false)
  const [asText, setAsText] = useState(false)
  const [text, setText] = useState("")
  const [problems, setProblems] = useState<string[]>([])
  const secBtn = useRef<HTMLButtonElement | null>(null)
  const sections = useSections()
  const lastPtr = useRef<{ x: number; y: number } | null>(null)
  const noteDrag = useRef<{ id: string; mode: 'move' | 'size'; sx: number; sy: number; n: Note; inside: Map<string, { x: number; y: number }> } | null>(null)
  useTick(50, Boolean(graph?.enabled))

  const toWorld = (cx: number, cy: number) => {
    const r = box.current!.getBoundingClientRect()
    return { x: (cx - r.left - view.x) / view.z, y: (cy - r.top - view.y) / view.z }
  }
  const pos = (n: GNode) => livePos?.get(n.id) ?? { x: n.x, y: n.y }

  const frameAll = () => {
    if (!graph || !graph.nodes.length || !box.current) return
    const r = box.current.getBoundingClientRect()
    const xs = graph.nodes.map((n) => n.x), ys = graph.nodes.map((n) => n.y)
    const x0 = Math.min(...xs) - 40, y0 = Math.min(...ys) - 40, x1 = Math.max(...xs) + W + 40, y1 = Math.max(...ys) + 240
    const z = Math.max(0.6, Math.min(1.2, Math.min(r.width / (x1 - x0), r.height / (y1 - y0))))
    setView({ x: -x0 * z + (r.width - (x1 - x0) * z) / 2, y: -y0 * z + 10, z })
  }

  const framed = useRef('')
  useEffect(() => {
    // Frame the network the first time its panel is actually on screen.
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      if (framed.current === graphId || el.clientWidth < 50) return
      framed.current = graphId
      frameAll()
    })
    ro.observe(el)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphId])

  const nodesById = useMemo(() => new Map((graph?.nodes ?? []).map((n) => [n.id, n])), [graph])

  if (!graph) return <p className="muted" style={{ padding: 16 }}>This node network is not on this computer. Import the workspace or project it came with.</p>

  const exportFile = (only?: Set<string>): RicoxFile => {
    const nodes = graph.nodes.filter((n) => !only || only.has(n.id))
    const ids = new Set(nodes.map((n) => n.id))
    const inner = nodes.filter((n) => n.type === 'container' && n.params.graph).flatMap((n) => graphTree(String(n.params.graph)))
    const used = new Set([graph, ...inner].flatMap((g) => g.nodes).filter((n) => n.type.startsWith('custom:')).map((n) => n.type.slice(7)))
    const custom: CustomDef[] = getLibrary().filter((d) => used.has(d.id))
    return { rico: 'nodes', version: 1, name: graph.name, nodes, wires: graph.wires.filter((w) => ids.has(w.from.node) && ids.has(w.to.node)), graphs: inner, custom }
  }

  const addNode = (type: string, at: { x: number; y: number }) => {
    // Find a free spot near where you asked, so new nodes never cover others.
    let x = Math.round(at.x / 10) * 10, y = Math.round(at.y / 10) * 10
    for (let i = 0; i < 40 && graph.nodes.some((o) => Math.abs(o.x - x) < W + 10 && Math.abs(o.y - y) < 110); i++) y += 40
    const n = makeNode(type, x, y)
    changeGraph(graph.id, `Add ${nodeType(type)?.name ?? 'node'}`, (g) => ({ ...g, nodes: [...g.nodes, n] }))
    setSelected(new Set([n.id]))
    setPalette(null)
  }

  // ---- comments ----
  const setNote = (id: string, part: Partial<Note>, label: string, key?: string) =>
    changeGraph(graph.id, label, (g) => ({ ...g, notes: (g.notes ?? []).map((x) => (x.id === id ? { ...x, ...part } : x)) }), key ?? `note.${id}.${label}`)
  const addNote = () => {
    const sel = graph.nodes.filter((n) => selected.has(n.id))
    let x: number, y: number, w = 320, h = 160
    if (sel.length) {
      // around the selected nodes, like a frame
      const x0 = Math.min(...sel.map((n) => n.x)) - 30, y0 = Math.min(...sel.map((n) => n.y)) - 50
      const x1 = Math.max(...sel.map((n) => n.x + widthOf(nodeType(n.type)))) + 30, y1 = Math.max(...sel.map((n) => n.y)) + 170
      x = x0; y = y0; w = x1 - x0; h = y1 - y0
    } else {
      const r = box.current!.getBoundingClientRect()
      const at = lastPtr.current ?? toWorld(r.left + r.width / 2, r.top + r.height / 3)
      x = at.x - 20; y = at.y - 20
    }
    const n: Note = { id: Math.random().toString(36).slice(2, 9), x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), text: 'Comment', color: '#ffd23f' }
    changeGraph(graph.id, 'Add comment', (g) => ({ ...g, notes: [...(g.notes ?? []), n] }))
    setSelNote(n.id)
  }
  const startNote = (e: RPointerEvent, n: Note, mode: 'move' | 'size') => {
    e.stopPropagation()
    if (e.button !== 0) return
    setSelNote(n.id)
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
    // moving a comment takes the nodes on it along
    const inside = new Map<string, { x: number; y: number }>()
    if (mode === 'move') for (const g of graph.nodes) if (g.x >= n.x && g.y >= n.y && g.x < n.x + n.w && g.y < n.y + n.h) inside.set(g.id, { x: g.x, y: g.y })
    noteDrag.current = { id: n.id, mode, sx: e.clientX, sy: e.clientY, n, inside }
  }
  const moveNote = (e: RPointerEvent) => {
    const d = noteDrag.current
    if (!d) return false
    const dx = Math.round((e.clientX - d.sx) / view.z / 10) * 10, dy = Math.round((e.clientY - d.sy) / view.z / 10) * 10
    if (d.mode === 'size') { setNote(d.id, { w: Math.max(120, d.n.w + dx), h: Math.max(60, d.n.h + dy) }, 'Size comment', `note.${d.id}.size`); return true }
    changeGraph(graph.id, 'Move comment', (g) => ({
      ...g,
      notes: (g.notes ?? []).map((x) => (x.id === d.id ? { ...x, x: d.n.x + dx, y: d.n.y + dy } : x)),
      nodes: g.nodes.map((n) => { const o = d.inside.get(n.id); return o ? { ...n, x: o.x + dx, y: o.y + dy } : n }),
    }), `note.${d.id}.move`)
    return true
  }

  const deleteSelection = () => {
    if (selNote) {
      changeGraph(graph.id, 'Delete comment', (g) => ({ ...g, notes: (g.notes ?? []).filter((x) => x.id !== selNote) }))
      setSelNote(null)
      return
    }
    if (selWire) {
      changeGraph(graph.id, 'Delete wire', (g) => ({ ...g, wires: g.wires.filter((w) => w.id !== selWire) }))
      setSelWire(null)
      return
    }
    if (!selected.size) return
    changeGraph(graph.id, `Delete ${selected.size} node${selected.size === 1 ? '' : 's'}`, (g) => ({
      ...g,
      nodes: g.nodes.filter((n) => !selected.has(n.id)),
      wires: g.wires.filter((w) => !selected.has(w.from.node) && !selected.has(w.to.node)),
    }))
    setSelected(new Set())
  }

  // ---- pointer handling ----
  const onHeadDown = (e: RPointerEvent, id: string) => {
    if (e.button !== 0) return
    e.stopPropagation()
    box.current?.focus()
    const sel = e.shiftKey ? new Set([...selected, id]) : selected.has(id) ? selected : new Set([id])
    setSelected(sel)
    setSelWire(null)
    const origin = new Map<string, { x: number; y: number }>()
    for (const n of graph.nodes) if (sel.has(n.id)) origin.set(n.id, { x: n.x, y: n.y })
    setDrag({ kind: 'move', start: { x: e.clientX, y: e.clientY }, origin, moved: false })
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }

  const onPortDown = (e: RPointerEvent, node: string, port: string, side: 'in' | 'out') => {
    e.stopPropagation()
    if (e.button !== 0) return
    const w = toWorld(e.clientX, e.clientY)
    if (side === 'out') {
      setDrag({ kind: 'wire', from: { node, port }, to: w })
    } else {
      // Pick up the wire already plugged in here and move its end.
      const existing = graph.wires.find((x) => x.to.node === node && x.to.port === port)
      if (existing) {
        changeGraph(graph.id, 'Unplug wire', (g) => ({ ...g, wires: g.wires.filter((x) => x.id !== existing.id) }))
        setDrag({ kind: 'wire', from: existing.from, to: w })
      }
    }
  }

  const portType = (nodeId: string, port: string, side: 'in' | 'out'): PortType => {
    const n = nodesById.get(nodeId)
    if (!n) return 'num'
    const p = nodePorts(n)
    return (side === 'in' ? p.inputs : p.outputs).find((x) => x.key === port)?.type ?? 'num'
  }

  const connect = (toNode: string, toPort: string) => {
    if (drag?.kind !== 'wire' || drag.from.node === toNode) return
    const from = drag.from
    const a = portType(from.node, from.port, 'out'), b = portType(toNode, toPort, 'in')
    if (!fits(a, b)) {
      toast(`A ${TYPE_NAME[a]} cannot go into a ${TYPE_NAME[b]} input.`)
      return
    }
    changeGraph(graph.id, 'Connect', (g) => ({
      ...g,
      wires: [...g.wires.filter((w) => !(w.to.node === toNode && w.to.port === toPort)), wire(from.node, from.port, toNode, toPort)],
    }))
  }

  const onPortUp = (e: RPointerEvent, node: string, port: string) => {
    if (drag?.kind === 'wire') {
      e.stopPropagation()
      connect(node, port)
      setDrag(null)
    }
  }

  const onBgDown = (e: RPointerEvent) => {
    if ((e.target as Element).closest('.ne-node, .ne-palette, .ne-wire-hit')) return
    box.current?.focus()
    setPalette(null)
    setSelWire(null)
    setSelNote(null)
    if (e.button === 2) return              // the right button opens the node list (see onContextMenu)
    if (e.button === 0 && e.shiftKey) {
      const w = toWorld(e.clientX, e.clientY)
      setDrag({ kind: 'box', a: w, b: w })
    } else if (e.button === 0 || e.button === 1) {
      if (!e.shiftKey) setSelected(new Set())
      setDrag({ kind: 'pan', start: { x: e.clientX, y: e.clientY }, view })
    }
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
  }

  const onMove = (e: RPointerEvent) => {
    if (box.current) lastPtr.current = toWorld(e.clientX, e.clientY)
    if (moveNote(e)) return
    if (!drag) return
    if (drag.kind === 'pan') {
      setView({ ...drag.view, x: drag.view.x + e.clientX - drag.start.x, y: drag.view.y + e.clientY - drag.start.y })
    } else if (drag.kind === 'move') {
      const dx = (e.clientX - drag.start.x) / view.z, dy = (e.clientY - drag.start.y) / view.z
      const next = new Map<string, { x: number; y: number }>()
      drag.origin.forEach((o, id) => next.set(id, { x: Math.round((o.x + dx) / 10) * 10, y: Math.round((o.y + dy) / 10) * 10 }))
      setLivePos(next)
      if (!drag.moved && Math.hypot(dx, dy) > 2) setDrag({ ...drag, moved: true })
    } else if (drag.kind === 'wire') {
      setDrag({ ...drag, to: toWorld(e.clientX, e.clientY) })
    } else if (drag.kind === 'box') {
      setDrag({ ...drag, b: toWorld(e.clientX, e.clientY) })
    }
  }

  const onUp = (e: RPointerEvent) => {
    noteDrag.current = null
    if (drag?.kind === 'move' && livePos && drag.moved) {
      const moved = livePos
      changeGraph(graph.id, 'Move nodes', (g) => ({ ...g, nodes: g.nodes.map((n) => (moved.has(n.id) ? { ...n, ...moved.get(n.id)! } : n)) }))
    }
    if (drag?.kind === 'wire') {
      // Dropped on an input port: connect. Dropped on empty space: offer a node to plug into.
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('.ne-port.in') as HTMLElement | null
      if (el?.dataset.node && el.dataset.port) connect(el.dataset.node, el.dataset.port)
    }
    if (drag?.kind === 'box') {
      const x0 = Math.min(drag.a.x, drag.b.x), x1 = Math.max(drag.a.x, drag.b.x), y0 = Math.min(drag.a.y, drag.b.y), y1 = Math.max(drag.a.y, drag.b.y)
      setSelected(new Set(graph.nodes.filter((n) => n.x + W > x0 && n.x < x1 && n.y + 40 > y0 && n.y < y1).map((n) => n.id)))
    }
    setLivePos(null)
    setDrag(null)
  }

  const onWheel = (e: React.WheelEvent) => {
    if (!box.current) return
    const r = box.current.getBoundingClientRect()
    const mx = e.clientX - r.left, my = e.clientY - r.top
    const z = Math.max(0.25, Math.min(2.5, view.z * Math.exp(-e.deltaY * 0.0015)))
    setView({ z, x: mx - ((mx - view.x) / view.z) * z, y: my - ((my - view.y) / view.z) * z })
  }

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as Element).closest('input, select, textarea')) return
    const mod = e.ctrlKey || e.metaKey
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection() }
    else if (e.key === 'Tab') {
      e.preventDefault()
      const r = box.current!.getBoundingClientRect()
      const c = toWorld(r.left + r.width / 2, r.top + r.height / 3)
      setPalette({ x: r.width / 2 - 170, y: r.height / 3 - 20, wx: c.x, wy: c.y })
    } else if (e.key === 'f' || e.key === 'F') frameAll()
    else if (!mod && (e.key === 'c' || e.key === 'C')) { e.preventDefault(); addNote() }
    else if (mod && e.key.toLowerCase() === 'g' && selected.size) { e.preventDefault(); makeContainer() }
    else if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); setSelected(new Set(graph.nodes.map((n) => n.id))) }
    else if (mod && e.key.toLowerCase() === 'c' && selected.size) { e.preventDefault(); clipboard = exportFile(selected); toast(`Copied ${selected.size} node${selected.size === 1 ? '' : 's'}.`, true) }
    else if (mod && e.key.toLowerCase() === 'v' && clipboard) {
      e.preventDefault()
      const r = box.current!.getBoundingClientRect()
      setSelected(new Set(paste(graph, clipboard, toWorld(r.left + 80, r.top + 80))))
    } else if (mod && e.key.toLowerCase() === 'd' && selected.size) {
      e.preventDefault()
      const f = exportFile(selected)
      setSelected(new Set(paste(graph, f, { x: Math.min(...f.nodes.map((n) => n.x)) + 30, y: Math.min(...f.nodes.map((n) => n.y)) + 30 })))
    }
  }

  // ---- drawing ----
  const anchor = (nodeId: string, port: string, side: 'in' | 'out') => {
    const n = nodesById.get(nodeId)
    const t = n && nodeType(n.type)
    if (!n || !t) return null
    const p = pos(n)
    const ports = nodePorts(n)
    const list = side === 'in' ? ports.inputs : ports.outputs
    const i = Math.max(0, list.findIndex((x) => x.key === port))
    return { x: p.x + (side === 'out' ? widthOf(t) : 0), y: p.y + portY(i) }
  }
  const curve = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5)
    return `M${a.x} ${a.y} C${a.x + dx} ${a.y} ${b.x - dx} ${b.y} ${b.x} ${b.y}`
  }

  async function makeContainer() {
    if (!graph || !selected.size) return
    const name = await askText('Make a container', 'Name', 'Container', 'Make')
    if (!name) return
    const id = encapsulate(graph.id, selected, name)
    if (id) setSelected(new Set([id]))
  }

  const exportAll = () => downloadJson(`${graph.name.replace(/[^\w -]/g, '') || 'nodes'}.ricox`, exportFile(selected.size ? selected : undefined))
  // Tidy: every node goes to its section; inside a section, nodes keep
  // their order from top to bottom.
  const tidy = () => {
    setLanes(true)
    changeGraph(graph.id, 'Tidy into sections', (g) => {
      const cols = sectionList.map(() => 40)
      const order = [...g.nodes].sort((a, b) => a.y - b.y || a.x - b.x)
      const pos = new Map<string, { x: number; y: number }>()
      for (const n of order) {
        const t = nodeType(n.type)
        const i = sectionOf(t?.group ?? (n.type.startsWith('custom:') ? 'Custom' : undefined))
        pos.set(n.id, { x: i * LANE_W, y: cols[i] })
        cols[i] += (t?.ui === 'code' || t?.ui === 'table' ? 320 : t?.ui === 'thumb' ? 260 : 60 + ((t?.inputs.length ?? 1) + (t?.params?.length ?? 0)) * 34)
      }
      return { ...g, nodes: g.nodes.map((n) => ({ ...n, ...(pos.get(n.id) ?? {}) })) }
    })
    window.setTimeout(frameAll, 50)
  }

  const importFile = () => pickFile('.ricox,.json', (f) => {
    f.text().then((t) => {
      const data = JSON.parse(t) as RicoxFile
      if (data?.rico !== 'nodes' || !Array.isArray(data.nodes)) return toast('That is not a .ricox node file.')
      for (const g of data.graphs ?? []) if (g?.id && !getGraph(g.id)) putGraph({ ...g, inside: true })
      const r = box.current!.getBoundingClientRect()
      setSelected(new Set(paste(graph, data, toWorld(r.left + 60, r.top + 60))))
      toast(`Added ${data.nodes.length} nodes from ${data.name}.`, true)
    }).catch(() => toast('That is not a .ricox node file.'))
  })

  return (
    <div className="ne-wrap">
      <div className="ne-bar">
        <button className="script-name" title="Rename" onClick={async () => {
          const name = await askText('Rename node network', 'Name', graph.name, 'Rename')
          if (name) { changeGraph(graph.id, 'Rename network', (g) => ({ ...g, name })); onRename?.(name) }
        }}>{graph.name}</button>
        {graph.inside && <span className="pill">Inside a container</span>}
        {!graph.inside && <label className="switch" title="Run this network">
          <input type="checkbox" role="switch" checked={graph.enabled} onChange={(e) => changeGraph(graph.id, e.target.checked ? 'Run network' : 'Stop network', (g) => ({ ...g, enabled: e.target.checked }))} />
          <span>{graph.enabled ? 'Running' : 'Stopped'}</span>
        </label>}
        <span className="grow" />
        <button className="btn small primary" onClick={() => {
          const r = box.current!.getBoundingClientRect()
          const c = toWorld(r.left + 60, r.top + 60)
          setPalette({ x: 20, y: 10, wx: c.x, wy: c.y })
        }}>+ Node</button>
        {selected.size > 0 && (
          <button className="btn small quiet" title="Put the selected nodes inside one Container node (Ctrl+G)" onClick={makeContainer}>Make container</button>
        )}
        <button className="btn small quiet" onClick={frameAll} title="Show everything (F)">Frame</button>
        <label className="switch mini" title="Show the sections"><input type="checkbox" role="switch" checked={lanes} onChange={(e) => setLanes(e.target.checked)} /><span>Sections</span></label>
        <button ref={secBtn} className="btn small quiet" onClick={() => setSecMenu(!secMenu)} title="Rename, recolor, add or remove sections">Edit sections</button>
        {secMenu && (
          <PopMenu anchor={secBtn} onClose={() => setSecMenu(false)} width={340} className="ne-secmenu">
            <div className="menu-head">Sections, left to right</div>
            {sections.map((sec, i) => (
              <div key={i} className="ne-sec-row">
                <input type="color" className="swatch" value={sec.color ?? FAM_COLOR[sec.cls] ?? '#3bff03'} onChange={(e) => setSections(sections.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))} aria-label="Color" />
                <input className="input" value={sec.name} onChange={(e) => setSections(sections.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} aria-label="Name" />
                <button className="icon-btn small" disabled={i === 0} title="Further left" onClick={() => { const l = [...sections]; [l[i - 1], l[i]] = [l[i], l[i - 1]]; setSections(l) }}>&lt;</button>
                <button className="icon-btn small" disabled={i === sections.length - 1} title="Further right" onClick={() => { const l = [...sections]; [l[i + 1], l[i]] = [l[i], l[i + 1]]; setSections(l) }}>&gt;</button>
                <button className="icon-btn small danger" title="Remove" onClick={() => setSections(sections.filter((_, j) => j !== i))}>x</button>
              </div>
            ))}
            <div className="row gap" style={{ padding: 8 }}>
              <button className="btn small" onClick={() => setSections([...sections, { name: `Section ${sections.length + 1}`, groups: [], cls: 'custom', color: '#d8d8d8' }])}>+ Section</button>
              <button className="btn small quiet" onClick={() => setSections(DEFAULT_SECTIONS)}>Back to the start</button>
            </div>
          </PopMenu>
        )}
        <button className="btn small quiet" title="Put every node in its section, in the order the signal flows" onClick={tidy}>Tidy</button>
        <button className="btn small quiet" onClick={exportAll} title="Save as a .ricox file (just the selected nodes if any are selected)">Export .ricox</button>
        <button className="btn small quiet" onClick={importFile}>Import</button>
        <button className={`btn small ${asText ? 'primary' : 'quiet'}`} title="The network as text: read it, change it, or let a code helper write it" onClick={() => { setText(graphToText(graph)); setProblems([]); setAsText(!asText) }}>As text</button>
      </div>
      {asText && (
        <div className="ne-text">
          <div className="row gap">
            <b className="small">Network as text</b>
            <span className="dim small grow">One node a line: name = type(settings) &lt;- input: other.output @ x, y</span>
            <button className="btn small quiet" onClick={() => { void navigator.clipboard?.writeText(text); toast('Copied the network.', true) }}>Copy</button>
            <button className="btn small quiet" title="Every node type with its inputs, outputs and settings, for whoever writes the text" onClick={() => { void navigator.clipboard?.writeText(nodeGuide()); toast('Copied the list of node types.', true) }}>Copy node guide</button>
            <button className="btn small primary" onClick={() => {
              const r = textToGraph(text)
              setProblems(r.problems)
              if (!r.nodes.length && r.problems.length) return
              changeGraph(graph.id, 'Network from text', (g) => ({ ...g, name: r.name ?? g.name, nodes: r.nodes, wires: r.wires }))
              if (!r.problems.length) toast(`${r.nodes.length} nodes, ${r.wires.length} wires.`, true)
            }}>Apply</button>
            <button className="icon-btn small" title="Close" onClick={() => setAsText(false)}>×</button>
          </div>
          <textarea className="input mono" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} rows={10} />
          {problems.length > 0 && <ul className="warn-text small">{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>}
        </div>
      )}
      <div
        ref={box}
        className={`ne${drag?.kind === 'pan' ? ' panning' : ''}`}
        tabIndex={0}
        onPointerDown={onBgDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onWheel={onWheel}
        onKeyDown={onKey}
        onContextMenu={(e) => {
          // right-click anywhere (also on a node) to add a node there
          if ((e.target as Element).closest('input, textarea, select, .ne-palette')) return
          e.preventDefault()
          const r = box.current!.getBoundingClientRect()
          const w = toWorld(e.clientX, e.clientY)
          setPalette({ x: Math.min(e.clientX - r.left, r.width - 360), y: Math.min(e.clientY - r.top, r.height - 300), wx: w.x + 20, wy: w.y })
        }}
        onDoubleClick={(e) => {
          if ((e.target as Element).closest('.ne-node, .ne-palette')) return
          const r = box.current!.getBoundingClientRect()
          const w = toWorld(e.clientX, e.clientY)
          setPalette({ x: Math.min(e.clientX - r.left, r.width - 360), y: Math.min(e.clientY - r.top, r.height - 300), wx: w.x, wy: w.y })
        }}
        style={{ backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${20 * view.z}px ${20 * view.z}px` }}
      >
        <div className="ne-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
          {lanes && sections.map((sec, i) => (
            <div key={i} className={`ne-lane g-${sec.cls}`} style={{ left: i * LANE_W - 20, width: LANE_W - 10, ...(sec.color ? { '--fam': sec.color } : {}) } as React.CSSProperties}>
              <b onDoubleClick={async (e) => { e.stopPropagation(); const name = await askText('Rename section', 'Name', sec.name, 'Rename'); if (name) setSections(sections.map((x, j) => (j === i ? { ...x, name } : x))) }} title="Double-click to rename">{sec.name}</b>
            </div>
          ))}
          {(graph.notes ?? []).map((n) => (
            <div key={n.id} className={`ne-note${selNote === n.id ? ' on' : ''}`} style={{ left: n.x, top: n.y, width: n.w, height: n.h, '--note': n.color } as React.CSSProperties}
              onPointerDown={(e) => { e.stopPropagation(); setSelNote(n.id); setSelected(new Set()) }}>
              <div className="ne-note-head" onPointerDown={(e) => startNote(e, n, 'move')}>
                <input className="ne-note-color" type="color" value={n.color} onPointerDown={(e) => e.stopPropagation()} onChange={(e) => setNote(n.id, { color: e.target.value }, 'Comment color')} title="Color" />
              </div>
              <textarea value={n.text} onChange={(e) => setNote(n.id, { text: e.target.value }, 'Edit comment')} onKeyDown={(e) => e.stopPropagation()} aria-label="Comment" />
              <i className="ne-note-size" onPointerDown={(e) => startNote(e, n, 'size')} />
            </div>
          ))}
          <svg className="ne-wires" width="1" height="1">
            {graph.wires.map((w) => {
              const a = anchor(w.from.node, w.from.port, 'out'), b = anchor(w.to.node, w.to.port, 'in')
              if (!a || !b) return null
              const raw = outputs.get(w.from.node)?.[w.from.port]
              const v = typeof raw === 'number' ? raw : raw ? 1 : 0
              const wt = portType(w.from.node, w.from.port, 'out')
              const d = curve(a, b)
              return (
                <g key={w.id}>
                  <path className="ne-wire-hit" d={d} onPointerDown={(e) => { e.stopPropagation(); setSelWire(w.id); setSelected(new Set()); box.current?.focus() }} />
                  <path className={`ne-wire w-${wt}${selWire === w.id ? ' selected' : ''}`} d={d} style={{ strokeWidth: 1.5 + Math.min(1, Math.abs(v)) * 2.5, opacity: 0.45 + Math.min(1, Math.abs(v)) * 0.55 }} />
                </g>
              )
            })}
            {drag?.kind === 'wire' && (() => {
              const a = anchor(drag.from.node, drag.from.port, 'out')
              return a ? <path className="ne-wire pending" d={curve(a, drag.to)} /> : null
            })()}
          </svg>
          {graph.nodes.map((n) => (
            <NodeBox key={n.id} node={n} graph={graph} selected={selected.has(n.id)} pos={pos(n)} onHeadDown={onHeadDown} onPortDown={onPortDown} onPortUp={onPortUp} />
          ))}
          {drag?.kind === 'box' && (
            <div className="ne-box" style={{ left: Math.min(drag.a.x, drag.b.x), top: Math.min(drag.a.y, drag.b.y), width: Math.abs(drag.b.x - drag.a.x), height: Math.abs(drag.b.y - drag.a.y) }} />
          )}
        </div>
        {graph.nodes.length === 0 && !palette && (
          <div className="ne-empty">
            <p><b>Double-click</b> or press <kbd>Tab</kbd> to add a node.</p>
            <p className="dim small">Pull a wire from an output on the right of a node to an input on the left. Drag the background to move around, scroll to zoom, Shift-drag to select a group.</p>
          </div>
        )}
        {palette && <Palette at={{ ...palette, h: box.current?.clientHeight }} onClose={() => setPalette(null)} onPick={(t) => addNode(t, { x: palette.wx, y: palette.wy })} />}
        <div className="ne-hint dim small">Tab or right-click add &nbsp; C comment &nbsp; Del remove &nbsp; Ctrl+D duplicate &nbsp; Ctrl+C/V copy &nbsp; Ctrl+G container &nbsp; F frame &nbsp; Shift-drag select</div>
      </div>
    </div>
  )
}
