import { rico } from '../engine/connection'
import { toB64 } from '../engine/ledProtocols'
import type { NetEvent } from '../engine/types'

// Web requests to printers and lasers on your network. Inside RICO they go
// through the engine (printers do not answer pages from other addresses);
// in a plain browser they use fetch, which works when the printer allows it.

export interface HttpAnswer { status: number; ok: boolean; bytes: Uint8Array; text: string; json: <T = unknown>() => T | null; error?: string }

let n = 0
const enc = new TextEncoder()
const dec = new TextDecoder()

function answer(status: number, bytes: Uint8Array, error?: string): HttpAnswer {
  const text = dec.decode(bytes)
  return {
    status, ok: status >= 200 && status < 300, bytes, text, error,
    json: <T,>() => { try { return JSON.parse(text) as T } catch { return null } },
  }
}

export async function http(method: string, url: string, opts: { headers?: Record<string, string>; body?: Uint8Array | string; timeout?: number } = {}): Promise<HttpAnswer> {
  const body = typeof opts.body === 'string' ? enc.encode(opts.body) : opts.body
  const headers = opts.headers ?? {}
  if (rico.get().status === 'live') {
    const id = `http${++n}`
    return new Promise((resolve) => {
      let off = () => {}
      const timer = window.setTimeout(() => { off(); resolve(answer(0, new Uint8Array(), 'No answer in time.')) }, (opts.timeout ?? 15000) + 5000)
      off = rico.onNet((e: NetEvent) => {
        if (e.kind !== 'http' || e.id !== id) return
        off(); window.clearTimeout(timer)
        const status = Number(e.from) || 0
        const bytes = Uint8Array.from(e.bytes)
        resolve(status ? answer(status, bytes) : answer(0, new Uint8Array(), dec.decode(bytes) || 'Could not reach it.'))
      })
      void rico.send('net.http', {
        id, method, url, timeout: opts.timeout ?? 15000,
        headers: Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\r\n'),
        ...(body && body.length ? { b64: toB64(body) } : {}),
      }).then((a) => { if (!a.ok) { off(); window.clearTimeout(timer); resolve(answer(0, new Uint8Array(), a.error)) } })
    })
  }
  try {
    const ctl = new AbortController()
    const t = window.setTimeout(() => ctl.abort(), opts.timeout ?? 15000)
    const r = await fetch(url, { method, headers, body: body && body.length ? (body as BodyInit) : undefined, signal: ctl.signal })
    window.clearTimeout(t)
    return answer(r.status, new Uint8Array(await r.arrayBuffer()))
  } catch (e) {
    return answer(0, new Uint8Array(), `Could not reach ${url}. ${(e as Error).name === 'AbortError' ? 'It did not answer in time.' : 'In a browser the printer has to allow this page; inside RICO it always works.'}`)
  }
}

// A form with a file in it, the way printers take uploads.
export function multipart(fields: Record<string, string>, file: { field: string; name: string; type: string; data: Uint8Array }): { body: Uint8Array; type: string } {
  const b = `----rico${Math.random().toString(36).slice(2)}`
  const parts: Uint8Array[] = []
  for (const [k, v] of Object.entries(fields)) parts.push(enc.encode(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`))
  parts.push(enc.encode(`--${b}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`))
  parts.push(file.data)
  parts.push(enc.encode(`\r\n--${b}--\r\n`))
  const len = parts.reduce((s, p) => s + p.length, 0)
  const body = new Uint8Array(len)
  let at = 0
  for (const p of parts) { body.set(p, at); at += p.length }
  return { body, type: `multipart/form-data; boundary=${b}` }
}

// "printer.local" or "192.168.1.20:7125" becomes a full address.
export function baseUrl(host: string) {
  let h = host.trim().replace(/\/+$/, '')
  if (!h) return ''
  if (!/^https?:\/\//i.test(h)) h = `http://${h}`
  return h
}

// ---- serial: send G-code one line at a time and wait for the machine ----

export interface Stream {
  stop: () => void
  pause: (on: boolean) => void
  send: (line: string) => void        // a command right away (jog, home, status)
  done: Promise<void>
}

// Marlin and most USB printers: each line is numbered and checked, the
// printer says "ok" when it took it, or asks to send a line again.
// GRBL lasers: the machine has a 128 byte buffer, so lines go out while they
// fit (faster, and the laser does not stutter).
// Lines like ";RICO:EVENT 3" are not sent: marker() is told when the printer
// has taken every line before one, and returns true to hold the job there
// (go on with pause(false)).
export function streamSerial(port: string, baud: number, lines: string[], kind: 'marlin' | 'grbl', on: { progress: (done: number, total: number) => void; log: (t: string) => void; error: (t: string) => void; marker?: (text: string) => boolean | void }): Stream {
  const id = `fab-${port}`
  const body: string[] = []
  const marks = new Map<number, string[]>()
  for (const l of lines) {
    const mk = /^;RICO:(.*)$/.exec(l.trim())
    if (mk) { marks.set(body.length, [...(marks.get(body.length) ?? []), mk[1].trim()]); continue }
    const c = l.replace(/;.*$/, '').trim()
    if (c) body.push(c)
  }
  const fired = new Set<number>()
  let next = 0, acked = 0, paused = false, stopped = false
  let extraOk = 0                     // answers to lines that are not part of the job
  let buf = ''
  const inFlight: number[] = []       // grbl: bytes of each line not yet answered
  let resolveDone = () => {}
  const done = new Promise<void>((r) => { resolveDone = r })
  const raw = (t: string) => void rico.send('net.serial.send', { id, text: t })
  const checksum = (s: string) => { let c = 0; for (let i = 0; i < s.length; i++) c ^= s.charCodeAt(i); return c }
  const marlinLine = (i: number) => { const s = `N${i + 1} ${body[i]}`; return `${s}*${checksum(s)}\n` }
  const pump = () => {
    if (paused || stopped) return
    if (kind === 'marlin') {
      if (next === acked && marks.has(next) && !fired.has(next)) {
        fired.add(next)
        let hold = false
        for (const t of marks.get(next)!) if (on.marker?.(t)) hold = true
        if (hold) { paused = true; return }
      }
      if (next < body.length && next === acked) { raw(marlinLine(next)); next++ }
    } else {
      let used = inFlight.reduce((s, v) => s + v, 0)
      while (next < body.length) {
        const l = body[next] + '\n'
        if (used + l.length > 120) break
        raw(l); inFlight.push(l.length); used += l.length; next++
      }
    }
    if (acked >= body.length && !stopped) {
      if (kind === 'marlin' && marks.has(body.length) && !fired.has(body.length)) { fired.add(body.length); for (const t of marks.get(body.length)!) on.marker?.(t) }
      stopped = true; off(); on.progress(body.length, body.length); resolveDone()
    }
  }
  const off = rico.onNet((e) => {
    if (e.id !== id) return
    if (e.kind === 'closed') { if (!stopped) { stopped = true; on.error(`${port} was unplugged.`); resolveDone() } return }
    buf += dec.decode(Uint8Array.from(e.bytes))
    let k: number
    while ((k = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, k).trim()
      buf = buf.slice(k + 1)
      if (!line) continue
      if (/^ok\b/i.test(line)) {
        if (extraOk > 0) { extraOk--; continue }
        if (kind === 'grbl') inFlight.shift()
        acked++
        on.progress(acked, body.length)
      } else if (/^resend:?\s*(\d+)/i.test(line)) {
        const want = Number(/(\d+)/.exec(line)![1]) - 1
        next = acked = Math.max(0, want)
        extraOk++                       // the "ok" after a resend is for the bad line
      } else if (/^error/i.test(line)) {
        if (kind === 'grbl') { inFlight.shift(); acked++ }
        on.log(`${port}: ${line}`)
        if (kind === 'grbl' && /error:\s*(9|8)\b/.test(line)) on.error('The laser is locked. Home it or unlock it ($X) first.')
      } else if (!/^(echo:busy|busy:|wait)/i.test(line)) on.log(line)
    }
    pump()
  })
  void rico.send('net.serial.open', { id, port, baud }).then((a) => {
    if (!a.ok) { stopped = true; off(); on.error(a.error ?? `Could not open ${port}.`); resolveDone(); return }
    // Marlin restarts when the port opens; give it a moment, and start the line numbers from 0.
    window.setTimeout(() => { extraOk++; raw(kind === 'marlin' ? 'M110 N0\n' : '\n'); window.setTimeout(pump, 400) }, kind === 'marlin' ? 2200 : 600)
  })
  return {
    done,
    pause: (v) => { paused = v; if (kind === 'grbl') raw(v ? '!' : '~'); if (!v) pump() },
    // one byte commands (GRBL status, hold, go on) get no "ok"
    send: (l) => { if (l.length > 1) extraOk++; raw(l.endsWith('\n') || l.length === 1 ? l : `${l}\n`) },
    stop: () => {
      if (stopped) return
      stopped = true
      if (kind === 'grbl') raw('\x18')                // soft reset: the laser goes off now
      else raw('M104 S0\nM140 S0\nM107\nM84\n')       // heaters and motors off
      off()
      window.setTimeout(() => void rico.send('net.close', { id }), 300)
      resolveDone()
    },
  }
}

export async function serialPorts(): Promise<string[]> {
  const a = await rico.send('net.serial.list')
  return (a.ports as string[] | undefined) ?? []
}
