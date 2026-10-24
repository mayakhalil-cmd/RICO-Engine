import type { Command } from './commands'
import {
  deleteLayer, duplicateLayer, fitToComp, layerTimeAtPlayhead, newAdjustment, newNull, newShape, newSolid, newText, precompose, rippleDelete, closeGapAt, restack, splitLayer, updateLayer,
} from '../create/ops'
import { changeScene, getCreate, newComp, openComp, select } from '../create/store'
import { addCue, getPlay, playPause, seek, setWorkArea, stepFrames, timelineOf, workArea } from '../create/timeline'
import { timelineAction } from '../create/timelineBus'
import { openLayerSettings } from '../sections/LayerSettings'
import { dockApi } from './workspaces'

// Motion keys (the preview, layers, timeline and inspector).
// They only work after you click in one of those panels, so letters like P or
// S still type normally everywhere else. Change any of them in Edit > Keyboard
// and controls.

export const AE_KEYS: Record<string, string[]> = {
  // new layers (Layer > New)
  'ae.solid': ['Ctrl+Y'],
  'ae.null': ['Ctrl+Alt+Shift+Y'],
  'ae.adjust': ['Ctrl+Alt+Y'],
  'ae.text': ['Ctrl+Alt+Shift+T'],
  'ae.shape': ['Ctrl+Alt+Shift+S'],
  // layer edits
  'ae.duplicate': ['Ctrl+D'],
  'ae.split': ['Ctrl+Shift+D'],
  'ae.delete': ['Delete', 'Backspace'],
  'ae.inToPlayhead': ['['],
  'ae.outToPlayhead': [']'],
  'ae.trimIn': ['Alt+['],
  'ae.trimOut': ['Alt+]'],
  'ae.forward': ['Ctrl+]'],
  'ae.backward': ['Ctrl+['],
  'ae.top': ['Ctrl+Shift+]'],
  'ae.bottom': ['Ctrl+Shift+['],
  'ae.lock': ['Ctrl+L'],
  'ae.unlockAll': ['Ctrl+Shift+L'],
  'ae.solo': ['Alt+Shift+S'],
  'ae.shy': ['Alt+Shift+Y'],
  'ae.hide': ['Ctrl+Alt+Shift+V'],
  'ae.fit': ['Ctrl+Alt+F'],
  'ae.centerAnchor': ['Ctrl+Alt+Home'],
  'ae.selectAbove': ['Ctrl+Up'],
  'ae.selectBelow': ['Ctrl+Down'],
  'ae.deselect': ['Ctrl+Shift+A'],
  'ae.rename': ['Enter'],
  // time
  'ae.play': ['Space', 'Num0'],
  'ae.start': ['Home'],
  'ae.end': ['End'],
  'ae.nextFrame': ['PageDown', 'Ctrl+Right'],
  'ae.prevFrame': ['PageUp', 'Ctrl+Left'],
  'ae.next10': ['Shift+PageDown', 'Ctrl+Shift+Right'],
  'ae.prev10': ['Shift+PageUp', 'Ctrl+Shift+Left'],
  'ae.prevKey': ['J'],
  'ae.nextKey': ['K'],
  'ae.layerIn': ['I'],
  'ae.layerOut': ['O'],
  'ae.workIn': ['B'],
  'ae.workOut': ['N'],
  'ae.workClear': ['Ctrl+Alt+B'],
  'ae.marker': ['Num*', 'Shift+8'],
  'ae.render': ['Ctrl+M'],
  // keyframes
  'ae.easy': ['F9'],
  'ae.easeIn': ['Shift+F9'],
  'ae.easeOut': ['Ctrl+Shift+F9'],
  'ae.hold': ['Ctrl+Alt+H'],
  'ae.linear': ['Ctrl+Alt+K'],
  'ae.keysAll': ['Ctrl+A'],
  'ae.nudgeRight': ['Alt+Right'],
  'ae.nudgeLeft': ['Alt+Left'],
  'ae.nudgeRight10': ['Alt+Shift+Right'],
  'ae.nudgeLeft10': ['Alt+Shift+Left'],
  'ae.copy': ['Ctrl+C'],
  'ae.paste': ['Ctrl+V'],
  // reveal properties
  'ae.revealKeys': ['U'],
  'ae.revealP': ['P'],
  'ae.revealS': ['S'],
  'ae.revealR': ['R'],
  'ae.revealT': ['T'],
  'ae.revealA': ['A'],
  'ae.revealF': ['F'],
  'ae.revealE': ['E'],
  'ae.revealM': ['M'],
  'ae.addRevealP': ['Shift+P'],
  'ae.addRevealS': ['Shift+S'],
  'ae.addRevealR': ['Shift+R'],
  'ae.addRevealT': ['Shift+T'],
  'ae.addRevealA': ['Shift+A'],
  'ae.keyP': ['Alt+Shift+P'],
  'ae.keyR': ['Alt+Shift+R'],
  'ae.keyT': ['Alt+Shift+T'],
  'ae.keyA': ['Alt+Shift+A'],
  'ae.keyS': ['Alt+Shift+Z'],
  // view and tools
  'ae.zoomIn': ['='],
  'ae.zoomOut': ['-'],
  'ae.zoomFit': [';'],
  'ae.maximize': ['`'],
  'ae.toolV': ['V'],
  'ae.toolW': ['W'],
  'ae.toolY': ['Y'],
  'ae.toolQ': ['Q'],
  'ae.toolG': ['G'],
  'ae.toolH': ['H'],
  'ae.toolZ': ['Z'],
  'ae.toolT': ['Ctrl+T'],
  'ae.safe': ["'"],
  'ae.gridView': ["Ctrl+'"],
  'ae.rulers': ['Ctrl+R'],
  'ae.guides': ['Ctrl+;'],
  'ae.viewIn': ['.'],
  'ae.viewOut': [','],
  'ae.viewFit': ['Alt+/'],
  'ae.view100': ['/'],
  'ae.layerSettings': ['Ctrl+Shift+K', 'Ctrl+Shift+Y'],
  'ae.compSettings': ['Ctrl+K', 'Ctrl+Alt+Shift+K'],
  'ae.precompose': ['Ctrl+Shift+C'],
  'ae.rippleDelete': ['Shift+Delete'],
  'ae.closeGap': ['Alt+Backspace'],
  'ae.newComp': ['Ctrl+N'],
}

const sel = () => getCreate().selected
const selLayer = () => getCreate().scene.layers.find((l) => l.id === sel())

function selectNext(d: 1 | -1) {
  const layers = getCreate().scene.layers
  if (!layers.length) return
  const i = layers.findIndex((l) => l.id === sel())
  // The timeline shows the top layer first, so "above" is a higher index.
  const j = i < 0 ? (d > 0 ? 0 : layers.length - 1) : Math.max(0, Math.min(layers.length - 1, i + d))
  select(layers[j].id)
}

function maximize() {
  const api = dockApi()
  if (!api) return
  const a = api as unknown as { hasMaximizedGroup?: () => boolean; exitMaximizedGroup?: () => void; maximizeGroup?: (g: unknown) => void }
  if (a.hasMaximizedGroup?.()) a.exitMaximizedGroup?.()
  else if (api.activeGroup) a.maximizeGroup?.(api.activeGroup)
}

const C = (id: string, label: string, group: string, run: () => void, global = false): Command =>
  ({ id: `ae.${id}`, label, group, run, scope: global ? undefined : 'create' })
const tl = (a: string) => () => { timelineAction(a) }

export function aeCommands(): Command[] {
  return [
    C('solid', 'New solid', 'Layer', () => newSolid()),
    C('null', 'New null object', 'Layer', () => newNull()),
    C('adjust', 'New adjustment layer', 'Layer', () => newAdjustment()),
    C('text', 'New text layer', 'Layer', () => newText()),
    C('shape', 'New shape layer', 'Layer', () => newShape()),
    C('duplicate', 'Duplicate layer', 'Layer', () => { if (!timelineAction('duplicate')) duplicateLayer() }),
    C('split', 'Split layer at the playhead', 'Layer', () => splitLayer()),
    C('delete', 'Delete (keys, or the layer)', 'Layer', () => { if (!timelineAction('delete')) deleteLayer() }),
    C('inToPlayhead', 'Move layer to start at the playhead', 'Layer', () => layerTimeAtPlayhead('in', false)),
    C('outToPlayhead', 'Move layer to end at the playhead', 'Layer', () => layerTimeAtPlayhead('out', false)),
    C('trimIn', 'Trim layer start to the playhead', 'Layer', () => layerTimeAtPlayhead('in', true)),
    C('trimOut', 'Trim layer end to the playhead', 'Layer', () => layerTimeAtPlayhead('out', true)),
    C('forward', 'Bring layer forward', 'Layer', () => restack('up')),
    C('backward', 'Send layer backward', 'Layer', () => restack('down')),
    C('top', 'Bring layer to the top', 'Layer', () => restack('top')),
    C('bottom', 'Send layer to the bottom', 'Layer', () => restack('bottom')),
    C('lock', 'Lock or unlock layer', 'Layer', () => { const l = selLayer(); if (l) updateLayer(l.id, l.locked ? 'Unlock' : 'Lock', (x) => ({ ...x, locked: !x.locked })) }),
    C('unlockAll', 'Unlock all layers', 'Layer', () => changeScene('Unlock all', (s) => ({ ...s, layers: s.layers.map((l) => ({ ...l, locked: false })) }))),
    C('solo', 'Solo layer', 'Layer', () => { const l = selLayer(); if (l) updateLayer(l.id, 'Solo', (x) => ({ ...x, solo: !x.solo })) }),
    C('shy', 'Make layer shy', 'Layer', () => { const l = selLayer(); if (l) updateLayer(l.id, 'Shy', (x) => ({ ...x, shy: !x.shy })) }),
    C('hide', 'Show or hide layer', 'Layer', () => { const l = selLayer(); if (l) updateLayer(l.id, l.visible ? 'Hide layer' : 'Show layer', (x) => ({ ...x, visible: !x.visible })) }),
    C('fit', 'Fit layer to the scene', 'Layer', () => fitToComp()),
    C('centerAnchor', 'Center the anchor point', 'Layer', () => { const l = selLayer(); if (l) updateLayer(l.id, 'Center anchor', (x) => ({ ...x, values: { ...x.values, tr_ax: 0, tr_ay: 0 } })) }),
    C('selectAbove', 'Select the layer above', 'Layer', () => selectNext(1)),
    C('selectBelow', 'Select the layer below', 'Layer', () => selectNext(-1)),
    C('deselect', 'Deselect all', 'Layer', () => { if (!timelineAction('deselect')) select(null) }),
    C('rename', 'Rename layer', 'Layer', tl('rename')),

    C('play', 'Play or pause', 'Time', () => playPause()),
    C('start', 'Go to the start', 'Time', () => seek(workArea(timelineOf(getCreate().scene))[0])),
    C('end', 'Go to the end', 'Time', () => seek(workArea(timelineOf(getCreate().scene))[1])),
    C('nextFrame', 'Next frame', 'Time', () => stepFrames(1)),
    C('prevFrame', 'Previous frame', 'Time', () => stepFrames(-1)),
    C('next10', 'Ten frames forward', 'Time', () => stepFrames(10)),
    C('prev10', 'Ten frames back', 'Time', () => stepFrames(-10)),
    C('prevKey', 'Previous keyframe', 'Time', tl('prevKey')),
    C('nextKey', 'Next keyframe', 'Time', tl('nextKey')),
    C('layerIn', 'Go to the layer start', 'Time', () => { const l = selLayer(); if (l) seek(l.start ?? 0) }),
    C('layerOut', 'Go to the layer end', 'Time', () => { const l = selLayer(); if (l) seek(l.end ?? timelineOf(getCreate().scene).duration) }),
    C('workIn', 'Work area starts here', 'Time', () => { const t = timelineOf(getCreate().scene); setWorkArea(Math.min(getPlay().time, workArea(t)[1] - 0.05), t.outPoint) }),
    C('workOut', 'Work area ends here', 'Time', () => { const t = timelineOf(getCreate().scene); setWorkArea(t.inPoint, Math.max(getPlay().time, workArea(t)[0] + 0.05)) }),
    C('workClear', 'Clear the work area', 'Time', () => setWorkArea(undefined, undefined)),
    C('marker', 'Add a cue marker', 'Time', () => { addCue(getPlay().time); timelineAction('cueAdded') }),
    C('render', 'Render video...', 'Time', tl('render')),

    C('easy', 'Easy ease the selected keys', 'Keyframes', tl('ease:smooth')),
    C('easeIn', 'Ease in', 'Keyframes', tl('ease:in')),
    C('easeOut', 'Ease out', 'Keyframes', tl('ease:out')),
    C('hold', 'Hold keyframes (jump)', 'Keyframes', tl('ease:hold')),
    C('linear', 'Linear keyframes', 'Keyframes', tl('ease:linear')),
    C('keysAll', 'Select all keys', 'Keyframes', tl('selectAll')),
    C('nudgeRight', 'Nudge keys a frame later', 'Keyframes', tl('nudge:1')),
    C('nudgeLeft', 'Nudge keys a frame earlier', 'Keyframes', tl('nudge:-1')),
    C('nudgeRight10', 'Nudge keys ten frames later', 'Keyframes', tl('nudge:10')),
    C('nudgeLeft10', 'Nudge keys ten frames earlier', 'Keyframes', tl('nudge:-10')),
    C('copy', 'Copy keys', 'Keyframes', tl('copy')),
    C('paste', 'Paste keys at the playhead', 'Keyframes', tl('paste')),

    C('revealKeys', 'Show animated properties (UU: changed ones)', 'Properties', tl('reveal:u')),
    C('revealP', 'Show Position', 'Properties', tl('reveal:p')),
    C('revealS', 'Show Scale', 'Properties', tl('reveal:s')),
    C('revealR', 'Show Rotation', 'Properties', tl('reveal:r')),
    C('revealT', 'Show Opacity', 'Properties', tl('reveal:t')),
    C('revealA', 'Show Anchor point', 'Properties', tl('reveal:a')),
    C('revealF', 'Show Mask feather', 'Properties', tl('reveal:f')),
    C('revealE', 'Show Effects', 'Properties', tl('reveal:e')),
    C('revealM', 'Show Masks', 'Properties', tl('reveal:m')),
    C('addRevealP', 'Also show Position', 'Properties', tl('reveal+:p')),
    C('addRevealS', 'Also show Scale', 'Properties', tl('reveal+:s')),
    C('addRevealR', 'Also show Rotation', 'Properties', tl('reveal+:r')),
    C('addRevealT', 'Also show Opacity', 'Properties', tl('reveal+:t')),
    C('addRevealA', 'Also show Anchor point', 'Properties', tl('reveal+:a')),
    C('keyP', 'Key Position at the playhead', 'Properties', tl('key:p')),
    C('keyS', 'Key Scale at the playhead', 'Properties', tl('key:s')),
    C('keyR', 'Key Rotation at the playhead', 'Properties', tl('key:r')),
    C('keyT', 'Key Opacity at the playhead', 'Properties', tl('key:t')),
    C('keyA', 'Key Anchor point at the playhead', 'Properties', tl('key:a')),

    C('zoomIn', 'Zoom the timeline in', 'View', tl('zoom:in')),
    C('zoomOut', 'Zoom the timeline out', 'View', tl('zoom:out')),
    C('zoomFit', 'Fit the timeline', 'View', tl('zoom:fit')),
    C('maximize', 'Make this panel full size (again to go back)', 'View', maximize, true),
    C('toolV', 'Selection tool', 'Tools', tl('tool:v')),
    C('toolW', 'Rotate tool', 'Tools', tl('tool:w')),
    C('toolY', 'Anchor point tool', 'Tools', tl('tool:y')),
    C('toolQ', 'Shape tool', 'Tools', tl('tool:q')),
    C('toolG', 'Pen tool (masks)', 'Tools', tl('tool:g')),
    C('toolH', 'Hand tool', 'Tools', tl('tool:h')),
    C('toolZ', 'Zoom tool', 'Tools', tl('tool:z')),
    C('toolT', 'Text tool', 'Tools', tl('tool:t')),
    C('safe', 'Title and action safe', 'View', tl('view:safe')),
    C('gridView', 'Grid on the canvas', 'View', tl('view:grid')),
    C('rulers', 'Rulers', 'View', tl('view:rulers')),
    C('guides', 'Show guides', 'View', tl('view:guides')),
    C('viewIn', 'Zoom the canvas in', 'View', tl('view:in')),
    C('viewOut', 'Zoom the canvas out', 'View', tl('view:out')),
    C('viewFit', 'Fit the canvas', 'View', tl('view:fit')),
    C('view100', 'Canvas at 100%', 'View', tl('view:100')),
    C('layerSettings', 'Layer settings (colors, size, everything)', 'Layer', () => openLayerSettings()),
    C('compSettings', 'Comp settings (size, length, frame rate, background)', 'Composition', () => openLayerSettings('scene')),
    C('precompose', 'Pre-compose the selected layer', 'Composition', () => precompose()),
    C('rippleDelete', 'Ripple delete: take the layer out and close the gap', 'Layer', () => rippleDelete()),
    C('closeGap', 'Close the gap at the playhead', 'Layer', () => closeGapAt()),
    C('newComp', 'New composition', 'Composition', () => openComp(newComp())),
  ]
}
