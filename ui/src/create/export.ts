import { ArrayBufferTarget, Muxer } from 'mp4-muxer'
import { getCreate, getRenderer, pauseRendering } from './store'
import { applyAt, setExporting, timelineOf } from './timeline'

// Renders the timeline to a video file, frame by frame, so every frame is
// exact even when the scene is too heavy to play in real time.
//
// MP4 (H.264) uses the WebCodecs encoder built into WebView2 and Chrome.
// Where that is missing, it falls back to WebM recorded in real time.

export interface ExportOptions {
  from: number
  to: number
  fps: number
  bitrate: number          // bits per second
  onProgress: (done: number, total: number) => void
  signal: { cancelled: boolean }
}

export const canEncodeMp4 = () => typeof window.VideoEncoder === 'function'

async function pickCodec(width: number, height: number, fps: number, bitrate: number): Promise<{ config: VideoEncoderConfig; mux: 'avc' | 'vp9' } | null> {
  // H.264 first (plays everywhere): high, main, then baseline profile; the
  // level is picked by size. Then VP9 in MP4 for systems without H.264.
  const level = width * height > 2_100_000 ? '33' : width * height > 920_000 ? '2a' : '1f'
  const tries: { codec: string; mux: 'avc' | 'vp9' }[] = [
    ...['6400', '4d00', '42e0'].map((p) => ({ codec: `avc1.${p}${level}`, mux: 'avc' as const })),
    { codec: 'vp09.00.40.08', mux: 'vp9' },
  ]
  for (const t of tries) {
    const config: VideoEncoderConfig = { codec: t.codec, width, height, bitrate, framerate: fps, ...(t.mux === 'avc' ? { avc: { format: 'avc' } } : {}) }
    try {
      const ok = await VideoEncoder.isConfigSupported(config)
      if (ok.supported) return { config, mux: t.mux }
    } catch {
      /* try the next */
    }
  }
  return null
}

export async function renderMp4(opts: ExportOptions): Promise<Blob> {
  const r = getRenderer()
  if (!r) throw new Error('Motion is not running on this computer.')
  const scene = getCreate().scene
  // H.264 needs even sizes.
  const width = scene.width & ~1, height = scene.height & ~1
  const picked = await pickCodec(width, height, opts.fps, opts.bitrate)
  if (!picked) throw new Error('This computer cannot encode MP4 video. Try WebM instead.')
  const config = picked.config

  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: picked.mux, width, height, frameRate: opts.fps }, fastStart: 'in-memory' })
  let failure: Error | null = null
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { failure = e },
  })
  encoder.configure(config)

  const total = Math.max(1, Math.round((opts.to - opts.from) * opts.fps))
  setExporting(true)
  pauseRendering(true)
  try {
    for (let i = 0; i < total; i++) {
      if (opts.signal.cancelled) throw new Error('cancelled')
      if (failure) throw failure
      const t = opts.from + i / opts.fps
      applyAt(t, true)
      await r.seekVideos(scene, t)
      r.render(getCreate().scene)
      const frame = new VideoFrame(r.outputCanvas, { timestamp: Math.round((i * 1e6) / opts.fps), duration: Math.round(1e6 / opts.fps) })
      encoder.encode(frame, { keyFrame: i % (opts.fps * 2) === 0 })
      frame.close()
      while (encoder.encodeQueueSize > 4) await new Promise((res) => setTimeout(res, 1))
      if (i % 3 === 0) {
        opts.onProgress(i + 1, total)
        await new Promise((res) => setTimeout(res, 0))   // let the window breathe
      }
    }
    await encoder.flush()
    muxer.finalize()
    opts.onProgress(total, total)
    return new Blob([muxer.target.buffer], { type: 'video/mp4' })
  } finally {
    if (encoder.state !== 'closed') encoder.close()
    setExporting(false)
    pauseRendering(false)
    r.resumeVideos()
  }
}

// Real-time fallback: records the preview canvas while the timeline plays.
export async function renderWebm(opts: ExportOptions): Promise<Blob> {
  const r = getRenderer()
  if (!r) throw new Error('Motion is not running on this computer.')
  const stream = r.outputCanvas.captureStream(opts.fps)
  const type = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm'
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: opts.bitrate })
  const parts: Blob[] = []
  rec.ondataavailable = (e) => e.data.size && parts.push(e.data)
  const done = new Promise<void>((res) => { rec.onstop = () => res() })
  setExporting(true)
  pauseRendering(true)
  rec.start(250)
  const start = performance.now()
  const length = opts.to - opts.from
  await new Promise<void>((res) => {
    const tick = () => {
      const t = (performance.now() - start) / 1000
      if (opts.signal.cancelled || t >= length) return res()
      applyAt(opts.from + t, true)
      r.render(getCreate().scene)
      opts.onProgress(Math.round(t * opts.fps), Math.round(length * opts.fps))
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  rec.stop()
  await done
  setExporting(false)
  pauseRendering(false)
  stream.getTracks().forEach((t) => t.stop())
  if (opts.signal.cancelled) throw new Error('cancelled')
  return new Blob(parts, { type: 'video/webm' })
}

export function defaultRange() {
  const tl = timelineOf(getCreate().scene)
  return { from: 0, to: tl.duration, fps: tl.fps }
}

export function saveBlob(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}
