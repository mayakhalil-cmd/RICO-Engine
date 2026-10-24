import { useEffect, useState } from 'react'
import { rico } from '../engine/connection'
import { getCreate, getRenderer } from '../create/store'
import { dockApi } from './workspaces'
import { runningScripts } from './scripts'

// Watches how hard RICO is working, so the fps counter can say what is
// eating the time: which Create layers, the picture size, sending video,
// busy panels, scripts, memory.

const frameTimes: number[] = []      // ms between screen frames, last ~2 s
let last = performance.now()
let longTasks: number[] = []        // times of tasks that blocked the screen
let messages: number[] = []         // arrival times of messages from RICO

function tick(now: number) {
  frameTimes.push(now - last)
  last = now
  if (frameTimes.length > 120) frameTimes.shift()
  requestAnimationFrame(tick)
}
requestAnimationFrame(tick)

try {
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) longTasks.push(e.startTime + e.duration)
  }).observe({ type: 'longtask', buffered: false })
} catch {
  /* not offered here */
}

rico.onLive((live) => {
  const now = performance.now()
  for (let i = 0; i < live.log.length; i++) messages.push(now)
})

export interface Cost { what: string; detail: string; weight: number; tip?: string }

export interface PerfReport {
  fps: number
  frameMs: number
  worstMs: number
  createFps: number
  creating: boolean
  costs: Cost[]
  memoryMb: number | null
  gpuMb: number
  measured: boolean
}

export function perfReport(): PerfReport {
  const now = performance.now()
  longTasks = longTasks.filter((t) => now - t < 10000)
  messages = messages.filter((t) => now - t < 1000)
  const recent = frameTimes.slice(-60)
  const avg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 16.7
  const worst = recent.length ? Math.max(...recent) : 16.7
  const create = getCreate()
  const r = getRenderer()
  const st = r?.stats
  const creating = Boolean(r) && (create.previewVisible > 0 || create.output)
  const costs: Cost[] = []

  if (creating && st) {
    const unit = st.measured ? 'ms on the graphics card' : 'of Motion'
    for (const l of st.layers.slice(0, 5)) {
      const detail = st.measured ? `${l.ms.toFixed(1)} ${unit}` : `about ${Math.round(l.share * 100)}% ${unit}`
      costs.push({
        what: `Layer: ${l.name}`, detail, weight: l.share * (create.fps < 55 ? 1 : 0.5),
        tip: l.share > 0.4 ? 'Hide it while you work on other things, or lower its detail settings.' : undefined,
      })
    }
    const mp = (st.width * st.height) / 1e6
    costs.push({
      what: `Picture size ${st.width} x ${st.height}`, detail: `${mp.toFixed(1)} million pixels per frame`,
      weight: Math.min(1, mp / 4) * (create.fps < 55 ? 1 : 0.3),
      tip: mp > 1.5 && create.fps < 55 ? 'Try 1280 x 720 or 960 x 540 while you build, then go back up to render.' : undefined,
    })
    if (create.output) {
      costs.push({
        what: 'Sending Motion as video', detail: `${st.readMs.toFixed(1)} ms per frame to read it back`,
        weight: Math.min(1, st.readMs / 8),
        tip: st.readMs > 6 ? 'A smaller picture size makes sending much cheaper.' : undefined,
      })
    }
  }

  const perSecond = messages.length
  if (perSecond > 0) {
    costs.push({
      what: 'Messages', detail: `${perSecond} per second coming through`,
      weight: Math.min(1, perSecond / 1500),
      tip: perSecond > 600 ? 'Pause the Messages panel, or close it, while you perform.' : undefined,
    })
  }

  const panels = dockApi()?.panels.length ?? 0
  if (panels) costs.push({ what: 'Open panels', detail: `${panels} in this workspace`, weight: Math.min(1, panels / 25), tip: panels > 12 ? 'Every live panel redraws. Close the ones you are not using.' : undefined })

  const scripts = runningScripts()
  if (scripts) costs.push({ what: 'Scripts', detail: `${scripts} running`, weight: Math.min(1, scripts / 8) })

  if (longTasks.length) {
    costs.push({
      what: 'Stutters', detail: `${longTasks.length} moments in the last 10 s where the screen froze for a bit`,
      weight: Math.min(1, longTasks.length / 10),
      tip: 'Usually a big file loading, a scene change or a script doing a lot at once.',
    })
  }

  costs.sort((a, b) => b.weight - a.weight)
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
  return {
    fps: Math.round(1000 / avg),
    frameMs: avg,
    worstMs: worst,
    createFps: create.fps,
    creating,
    costs,
    memoryMb: mem ? mem.usedJSHeapSize / 1048576 : null,
    gpuMb: st ? st.textureBytes / 1048576 : 0,
    measured: Boolean(st?.measured),
  }
}

export function usePerf(ms = 500, on = true): PerfReport {
  const [r, setR] = useState(perfReport)
  useEffect(() => {
    if (!on) return
    setR(perfReport())
    const id = window.setInterval(() => setR(perfReport()), ms)
    return () => window.clearInterval(id)
  }, [ms, on])
  return r
}
