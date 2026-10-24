import { makeNode, uid, wire, type GNode, type Graph, type Wire } from './store'
import { NODE_TYPES, nodeType } from './types'

// Node networks as plain text, both ways. A network you drew becomes a few
// readable lines, and lines you (or a code helper) write become a network.
// Every node is one line: its name, its type, its settings, and where its
// inputs come from:
//
//   wobble = lfo(rate: 0.5, shape: "sine")                @ 120, 80
//   glow   = map(min: 0, max: 2) <- in: wobble.out         @ 320, 80
//   out    = signal-out(name: "Glow") <- in: glow.out      @ 520, 80
//
// "# ..." lines are comments. The "@ x, y" part is where the node sits and
// can be left out (new nodes are placed in a row). nodeGuide() lists every
// node type with its inputs, outputs and settings, so whoever writes the
// lines knows the exact names.

const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'n$1') || 'node'
const val = (v: number | string | boolean) => (typeof v === 'string' ? JSON.stringify(v) : String(v))

export function graphToText(g: Graph): string {
  const names = new Map<string, string>()
  const used = new Set<string>()
  for (const n of g.nodes) {
    const base = slug(n.name || n.type)
    let name = base, k = 2
    while (used.has(name)) name = `${base}${k++}`
    used.add(name)
    names.set(n.id, name)
  }
  const lines: string[] = [`# RICO node network`, `network ${JSON.stringify(g.name)}`]
  for (const n of g.nodes) {
    const t = nodeType(n.type)
    const defs = new Map((t?.params ?? []).map((p) => [p.key, p.default]))
    // settings that differ from the default, so the line stays short
    const set = Object.entries(n.params).filter(([k, v]) => !defs.has(k) || defs.get(k) !== v).map(([k, v]) => `${k}: ${val(v)}`)
    const ins = g.wires.filter((w) => w.to.node === n.id).map((w) => `${w.to.port}: ${names.get(w.from.node) ?? '?'}.${w.from.port}`)
    let line = `${names.get(n.id)} = ${n.type}(${set.join(', ')})`
    if (ins.length) line += ` <- ${ins.join(', ')}`
    line += `  @ ${Math.round(n.x)}, ${Math.round(n.y)}`
    if (n.name) line += `  # ${n.name.replace(/\n/g, ' ')}`
    lines.push(line)
  }
  return lines.join('\n') + '\n'
}

export interface Parsed { name?: string; nodes: GNode[]; wires: Wire[]; problems: string[] }

// Splits "a: 1, b: \"x, y\", c: true" at commas outside quotes.
function splitTop(s: string): string[] {
  const out: string[] = []
  let cur = '', q = false, esc = false, depth = 0
  for (const ch of s) {
    if (q) { cur += ch; if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') q = false; continue }
    if (ch === '"') { q = true; cur += ch; continue }
    if (ch === '(' || ch === '[') depth++
    if (ch === ')' || ch === ']') depth--
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue }
    cur += ch
  }
  if (cur.trim()) out.push(cur)
  return out.map((x) => x.trim()).filter(Boolean)
}
function parseValue(v: string): number | string | boolean {
  if (v.startsWith('"')) { try { return JSON.parse(v) as string } catch { return v.slice(1, -1) } }
  if (v === 'true' || v === 'false') return v === 'true'
  const n = Number(v)
  return Number.isFinite(n) ? n : v
}

export function textToGraph(text: string): Parsed {
  const nodes: GNode[] = []
  const pending: { line: number; to: string; port: string; from: string; fromPort: string }[] = []
  const byName = new Map<string, GNode>()
  const problems: string[] = []
  let name: string | undefined
  let auto = 0
  text.split(/\r?\n/).forEach((raw, i) => {
    // a comment at the end: keep it out of the parsing (but not inside quotes)
    let line = raw
    let inQ = false
    for (let k = 0; k < line.length; k++) { const c = line[k]; if (c === '"' && line[k - 1] !== '\\') inQ = !inQ; if (c === '#' && !inQ) { line = line.slice(0, k); break } }
    line = line.trim()
    if (!line) return
    const net = /^network\s+(.+)$/.exec(line)
    if (net) { name = String(parseValue(net[1].trim())); return }
    const m = /^([A-Za-z_][\w]*)\s*=\s*([\w:.-]+)\s*\((.*)\)\s*(?:<-\s*(.*?))?\s*(?:@\s*(-?[\d.]+)\s*,\s*(-?[\d.]+))?\s*$/.exec(line)
    if (!m) { problems.push(`Line ${i + 1}: I could not read "${raw.trim()}".`); return }
    const [, nm, type, args, inputs, x, y] = m
    if (!nodeType(type)) problems.push(`Line ${i + 1}: there is no node type "${type}".`)
    const params: Record<string, number | string | boolean> = {}
    for (const a of splitTop(args)) {
      const c = a.indexOf(':')
      if (c < 0) { problems.push(`Line ${i + 1}: "${a}" needs a name, like amount: 0.5.`); continue }
      params[a.slice(0, c).trim()] = parseValue(a.slice(c + 1).trim())
    }
    const px = x !== undefined ? Number(x) : 40 + (auto % 5) * 200
    const py = y !== undefined ? Number(y) : 40 + Math.floor(auto / 5) * 140
    auto++
    const node = makeNode(type, px, py, params)
    if (byName.has(nm)) problems.push(`Line ${i + 1}: the name "${nm}" is used twice.`)
    byName.set(nm, node)
    nodes.push(node)
    for (const inp of splitTop(inputs ?? '')) {
      const w = /^([\w-]+)\s*:\s*([A-Za-z_]\w*)\.([\w-]+)$/.exec(inp)
      if (!w) { problems.push(`Line ${i + 1}: "${inp}" should look like in: other.out.`); continue }
      pending.push({ line: i + 1, to: nm, port: w[1], from: w[2], fromPort: w[3] })
    }
  })
  const wires: Wire[] = []
  for (const p of pending) {
    const a = byName.get(p.from), b = byName.get(p.to)
    if (!a) { problems.push(`Line ${p.line}: there is no node called "${p.from}".`); continue }
    wires.push({ ...wire(a.id, p.fromPort, b!.id, p.port), id: uid() })
  }
  return { name, nodes, wires, problems }
}

// Every node type, written out for whoever writes networks as text.
export function nodeGuide(): string {
  const lines = ['# RICO node types', '# name(settings) inputs -> outputs', '']
  let group = ''
  for (const t of NODE_TYPES) {
    if (t.group !== group) { group = t.group; lines.push(`## ${group}`) }
    const ps = t.params.map((p) => `${p.key}: ${p.kind === 'choice' && p.choices ? p.choices.map((c) => JSON.stringify(c)).join(' | ') : p.kind}${p.default !== '' ? ` = ${val(p.default)}` : ''}`).join(', ')
    lines.push(`${t.type}(${ps})  in: ${t.inputs.map((x) => x.key).join(', ') || '-'}  out: ${t.outputs.map((x) => x.key).join(', ') || '-'}`)
    lines.push(`  # ${t.name}: ${t.about}`)
  }
  return lines.join('\n') + '\n'
}
