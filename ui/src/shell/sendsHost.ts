import { addViewer, getRenderer, onDrawn } from '../create/store'
import { getOutputs, setPictureSource, startSends } from '../engine/sends'
import { collectSources } from './outputs'

// Connects the outputs (LEDs and hardware) to RICO's pictures. The Motion
// picture lives on the graphics card and is only readable right after it is
// drawn, so a small copy is kept for the LEDs to sample.

const copy = document.createElement('canvas')
copy.width = 192; copy.height = 108
const cg = copy.getContext('2d')!
let viewing = false

export function startSendsHost() {
  startSends()
  onDrawn(() => {
    if (!getOutputs().some((o) => o.on && o.kind === 'pixels' && o.picture === 'Create')) return
    const r = getRenderer()
    if (r) try { cg.drawImage(r.outputCanvas, 0, 0, copy.width, copy.height) } catch { /* not ready */ }
  })
  setPictureSource((name) => (name === 'Create' ? copy : collectSources([name]).get(name) as CanvasImageSource | undefined ?? null))
  // keep Motion drawing while an LED output needs it
  window.setInterval(() => {
    const want = getOutputs().some((o) => o.on && o.kind === 'pixels' && o.picture === 'Create')
    if (want !== viewing) { viewing = want; addViewer(want) }
  }, 500)
}
