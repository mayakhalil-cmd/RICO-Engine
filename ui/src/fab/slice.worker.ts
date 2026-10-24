import { gcode, slice, type GcodeMachine, type PrintSettings } from './slicer'

// Slices in the background so RICO stays smooth.
self.onmessage = (e: MessageEvent<{ id: number; tris: Float32Array; shells: [number, number][]; settings: PrintSettings; machine: GcodeMachine }>) => {
  const { id, tris, shells, settings, machine } = e.data
  try {
    let last = 0
    const layers = slice(tris, settings, shells, (f) => {
      const now = performance.now()
      if (now - last > 120) { last = now; (self as unknown as Worker).postMessage({ id, progress: f }) }
    })
    const g = gcode(layers, settings, machine)
    ;(self as unknown as Worker).postMessage({ id, done: true, layers, gcode: g })
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ id, error: (err as Error).message || String(err) })
  }
}
