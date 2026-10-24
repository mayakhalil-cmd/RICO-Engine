import { useState } from 'react'
import ToolStrip, { ToolBtn, ToolGroup, type ToolItem } from '../components/ToolStrip'
import ToolEditor from '../components/ToolEditor'
import { chooseTool, SHAPES, SHAPE_ICON, setTools, useTools, type Tool } from '../create/tools'
import { importTools, putTool, removeTool, runActionTool, TOOL_TEMPLATE, useCustomTools, type CustomTool } from '../create/customTools'
import { timelineAction } from '../create/timelineBus'
import { MOVE_STEPS, ROT_STEPS, SIZE_STEPS, UNIT, setSnap, useSnap, type Handles } from '../shell/snap'
import { runCommand } from '../shell/commands'
import { openLayerSettings } from './LayerSettings'

// The green tool strip on top of the Motion workspace: the tools, the
// handles, snapping, your own tools, and the composition on the right.

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : String(Number(v.toFixed(3))))

export default function MotionStrip() {
  const t = useTools()
  const snap = useSnap('motion')
  const mine = useCustomTools()
  const [edit, setEdit] = useState<CustomTool | null>(null)
  const pick = (x: Tool) => () => chooseTool(x)
  const tools: ToolItem[] = [
    { id: 'v', icon: 'select', label: 'Select', key: 'V', on: t.tool === 'v', run: pick('v') },
    { id: 'h', icon: 'hand', label: 'Hand (drag the picture around)', key: 'H', on: t.tool === 'h', run: pick('h') },
    { id: 'z', icon: 'zoom', label: 'Zoom (click to zoom in, Alt-click out)', key: 'Z', on: t.tool === 'z', run: pick('z') },
  ]
  const draw: ToolItem[] = [
    { id: 'y', icon: 'anchor', label: 'Anchor point', key: 'Y', on: t.tool === 'y', run: pick('y') },
    {
      id: 'q', icon: SHAPE_ICON[t.shape], label: `Shape: ${SHAPES[t.shape]}`, key: 'Q', on: t.tool === 'q', run: () => setTools({ tool: 'q' }),
      more: SHAPES.map((name, i) => ({ id: name, icon: SHAPE_ICON[i], label: name, on: t.shape === i, run: () => setTools({ tool: 'q', shape: i }) })),
    },
    { id: 'g', icon: 'pen', label: 'Pen (masks)', key: 'G', on: t.tool === 'g', run: pick('g') },
    { id: 't', icon: 'text', label: 'Text (click where it goes)', key: 'Ctrl+T', on: t.tool === 't', run: pick('t') },
  ]
  const handles: [Handles, string, string, string][] = [['move', 'move', 'Move handles', 'W'], ['rotate', 'rotate', 'Turn handles', 'E'], ['scale', 'scale', 'Size handles', 'R'], ['all', 'all', 'All handles', 'Q']]
  const magnets: ToolItem[] = [
    { id: 'gm', icon: 'grid', label: `Snap moves: ${fmt(snap.moveStep)}${UNIT.motion} (${snap.move ? 'on' : 'off'})`, on: snap.move, run: () => setSnap('motion', { move: !snap.move }),
      more: MOVE_STEPS.motion.map((s) => ({ id: String(s), icon: 'grid', label: `${fmt(s)}${UNIT.motion}`, on: snap.moveStep === s, run: () => setSnap('motion', { moveStep: s, move: true }) })) },
    { id: 'ga', icon: 'angle', label: `Snap turns: ${fmt(snap.rotStep)} degrees (${snap.rot ? 'on' : 'off'})`, on: snap.rot, run: () => setSnap('motion', { rot: !snap.rot }),
      more: ROT_STEPS.map((s) => ({ id: String(s), icon: 'angle', label: `${fmt(s)} degrees`, on: snap.rotStep === s, run: () => setSnap('motion', { rotStep: s, rot: true }) })) },
    { id: 'gs', icon: 'size', label: `Snap sizes: ${fmt(snap.sizeStep)} (${snap.size ? 'on' : 'off'})`, on: snap.size, run: () => setSnap('motion', { size: !snap.size }),
      more: SIZE_STEPS.map((s) => ({ id: String(s), icon: 'size', label: fmt(s), on: snap.sizeStep === s, run: () => setSnap('motion', { sizeStep: s, size: true }) })) },
  ]
  return (
    <ToolStrip label="Motion tools">
      <ToolGroup tone="pink">{tools.map((x) => <ToolBtn key={x.id} t={x} />)}</ToolGroup>
      <i className="ts-sep" />
      <ToolGroup>{draw.map((x) => <ToolBtn key={x.id} t={x} />)}</ToolGroup>
      <i className="ts-sep" />
      <ToolGroup label="Handles" tone="pink">
        {handles.map(([h, icon, label, key]) => <ToolBtn key={h} t={{ id: h, icon, label, key, on: snap.handles === h, run: () => setSnap('motion', { handles: h }) }} />)}
      </ToolGroup>
      <i className="ts-sep" />
      <ToolGroup label="Snap" tone="pink">{magnets.map((x) => <ToolBtn key={x.id} t={x} />)}</ToolGroup>
      <i className="ts-sep" />
      <ToolGroup label={mine.length ? 'Your tools' : undefined}>
        {mine.map((m) => (
          <span key={m.id} onContextMenu={(e) => { e.preventDefault(); setEdit(m) }}>
            <ToolBtn t={{ id: m.id, icon: m.icon, label: `${m.name} (right-click to change)`, key: m.key, on: t.tool === `custom:${m.id}`, run: () => (m.kind === 'canvas' ? chooseTool(`custom:${m.id}`) : runActionTool(m.id)) }} />
          </span>
        ))}
        <ToolBtn t={{ id: 'new', icon: 'plus', quiet: true, label: 'Make your own tool', run: () => setEdit({ id: Math.random().toString(36).slice(2, 9), name: 'My tool', icon: 'spark', kind: 'canvas', code: TOOL_TEMPLATE.canvas }) }} />
      </ToolGroup>
      <span className="grow" />
      <ToolGroup>
        <ToolBtn t={{ id: 'comp', icon: 'settings', label: 'Composition settings', key: 'Ctrl+K', run: () => openLayerSettings('scene') }} />
        <ToolBtn t={{ id: 'out', icon: 'projector', label: 'Open an output window (projector or second screen)', run: () => runCommand('output.new') }} />
        <ToolBtn t={{ id: 'render', icon: 'render', label: 'Render video', key: 'Ctrl+M', run: () => { timelineAction('render') } }} />
      </ToolGroup>
      {edit && <ToolEditor tool={edit} onClose={() => setEdit(null)} put={putTool} remove={removeTool} importAll={importTools} templates={TOOL_TEMPLATE}
        kinds={{ canvas: 'Click on the picture', action: 'Runs once' }}
        hint="rico.layers(), rico.selected(), rico.add(type, values), rico.solid(color), rico.text(words), rico.shape(kind, w, h, x, y), rico.set(id, key, value), rico.move(id, x, y), rico.select(id), rico.signal(name), rico.time(), rico.toast(text). See Help > Scripts for more." />}
    </ToolStrip>
  )
}

