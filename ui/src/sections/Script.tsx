import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '../components/Toasts'
import { getScript, putScript, runScript, useScripts, type Script } from '../shell/scripts'
import { askText, downloadJson } from '../shell/ui'

// A panel that runs a script. The controls the script makes show here, with
// the code one click away.

interface Line { text: string; kind: 'info' | 'error' | 'out'; at: string }

function CodeEditor({ value, onChange, onRun }: { value: string; onChange: (v: string) => void; onRun: () => void }) {
  const gutter = useRef<HTMLPreElement | null>(null)
  const lines = value.split('\n').length
  return (
    <div className="code">
      <pre className="code-gutter" ref={gutter} aria-hidden="true">
        {Array.from({ length: lines }, (_, i) => i + 1).join('\n')}
      </pre>
      <textarea
        className="code-text"
        value={value}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-label="Script code"
        onScroll={(e) => {
          if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop
        }}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault()
            onRun()
            return
          }
          if (e.key === 'Tab') {
            e.preventDefault()
            const t = e.currentTarget
            const { selectionStart: a, selectionEnd: b } = t
            const next = value.slice(0, a) + '  ' + value.slice(b)
            onChange(next)
            requestAnimationFrame(() => t.setSelectionRange(a + 2, a + 2))
          }
        }}
      />
    </div>
  )
}

export default function ScriptPanel({ scriptId, onRename }: { scriptId: string; onRename?: (name: string) => void }) {
  useScripts()
  const script = getScript(scriptId)
  const [draft, setDraft] = useState(script?.code ?? '')
  const [editing, setEditing] = useState(false)
  const [running, setRunning] = useState(true)
  const [lines, setLines] = useState<Line[]>([])
  const [runId, setRunId] = useState(0)
  const root = useRef<HTMLDivElement | null>(null)
  const dirty = script ? draft !== script.code : false

  const log = useCallback((text: string, kind: Line['kind'] = 'info') => {
    setLines((l) => [...l.slice(-80), { text, kind, at: new Date().toTimeString().slice(0, 8) }])
  }, [])

  // (Re)start the script whenever it is saved or Run is pressed.
  const code = script?.code
  useEffect(() => {
    if (!script || !running || !root.current) return
    const stop = runScript(script, { root: root.current, log })
    return stop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, running, runId, scriptId])

  if (!script) {
    return <p className="muted">This script is not on this computer. Import the workspace it came with to get it back.</p>
  }

  const run = () => {
    if (dirty) putScript({ ...script, code: draft })
    setLines([])
    setRunning(true)
    setRunId((n) => n + 1)
  }

  const rename = async () => {
    const name = await askText('Rename script', 'Name', script.name, 'Rename')
    if (!name) return
    putScript({ ...script, name })
    onRename?.(name)
  }

  return (
    <div className={`script${editing ? ' editing' : ''}`}>
      <div className="script-bar">
        <button className="script-name" onClick={rename} title="Rename">{script.name}</button>
        <span className={`stat${running ? ' live' : ''}`}><i />{running ? 'Running' : 'Stopped'}</span>
        <span className="grow" />
        <button className={`btn small${editing ? ' primary' : ' quiet'}`} onClick={() => setEditing(!editing)}>{editing ? 'Hide code' : 'Code'}</button>
        <button className="btn small quiet" title="Run (Ctrl+Enter)" onClick={run}>{dirty ? 'Save and run' : 'Run'}</button>
        {running && <button className="btn small quiet" onClick={() => setRunning(false)}>Stop</button>}
        <button className="btn small quiet" title="Save this script as a file" onClick={() => {
          downloadJson(`${script.name.replace(/[^\w -]/g, '') || 'script'}.ricoscript`, { rico: 'script', version: 1, name: script.name, code: script.code } satisfies Omit<Script, 'id'> & { rico: string; version: number })
          toast('Script saved as a file.', true)
        }}>Export</button>
      </div>
      <div className="script-body">
        {editing && <CodeEditor value={draft} onChange={setDraft} onRun={run} />}
        <div className="script-run">
          <div className="script-controls" ref={root} />
          {!running && <p className="dim small">Stopped. Press Run to start it again.</p>}
          {lines.length > 0 && (
            <div className="script-console" role="log">
              {lines.map((l, i) => (
                <div key={i} className={`script-line ${l.kind}`}><span className="dim">{l.at}</span> {l.text}</div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
