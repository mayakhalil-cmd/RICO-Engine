import { useState } from 'react'
import { createPortal } from 'react-dom'
import CodeBox from './CodeBox'
import Icon from './Icon'
import RIcon, { ICON_NAMES } from './RIcons'
import { toast } from './Toasts'
import { pickFile } from '../shell/ui'

export interface EditableTool { id: string; name: string; icon: string; kind: 'action' | 'canvas'; key?: string; code: string }

// The editor for your own tools (Motion and 3D): name, icon, what it does.
export default function ToolEditor<T extends EditableTool>({ tool, onClose, put, remove, importAll, templates, kinds, hint }: {
  tool: T; onClose: () => void; put: (t: T) => void; remove: (id: string) => void; importAll: (list: T[]) => void
  templates: { action: string; canvas: string }; kinds: { canvas: string; action: string }; hint: string
}) {
  const [t, setT] = useState(tool)
  const set = (p: Partial<EditableTool>) => setT({ ...t, ...p } as T)
  const saveFile = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([JSON.stringify([t], null, 2)], { type: 'application/json' }))
    a.download = `${t.name.replace(/[^\w-]+/g, '-')}.ricotool`
    a.click()
  }
  return createPortal(
    <div className="modal-back" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal tool-editor" role="dialog" aria-label="Your own tool" data-keyscope="tool-editor">
        <div className="row gap"><h3>Your own tool</h3><span className="grow" /><button className="icon-btn" onClick={onClose} title="Close"><Icon name="x" /></button></div>
        <div className="row gap">
          <span className="te-preview"><RIcon name={t.icon} size={28} /></span>
          <label className="param grow"><span className="param-label">Name</span><input className="input" value={t.name} onChange={(e) => set({ name: e.target.value })} /></label>
        </div>
        <div className="seg" role="group" aria-label="Kind">
          <button className={t.kind === 'canvas' ? 'on' : ''} onClick={() => set({ kind: 'canvas', code: t.code === templates.action ? templates.canvas : t.code })}>{kinds.canvas}</button>
          <button className={t.kind === 'action' ? 'on' : ''} onClick={() => set({ kind: 'action', code: t.code === templates.canvas ? templates.action : t.code })}>{kinds.action}</button>
        </div>
        <span className="param-label">Icon</span>
        <div className="te-icons">
          {ICON_NAMES.map((n) => <button key={n} className={`no-corner${t.icon === n ? ' on' : ''}`} title={n} onClick={() => set({ icon: n })}><RIcon name={n} size={16} /></button>)}
          <button className="no-corner te-upload" title="Your own picture (SVG or PNG)" onClick={() => pickFile('image/svg+xml,image/png,image/webp', (f) => {
            if (f.size > 200_000) return toast('Pick a picture under 200 KB.')
            const r = new FileReader(); r.onload = () => set({ icon: String(r.result) }); r.readAsDataURL(f)
          })}><RIcon name="import" size={16} /></button>
        </div>
        <CodeBox label="What it does (JavaScript)" value={t.code} rows={12} onChange={(code) => set({ code })} />
        <p className="dim small">{hint}</p>
        <div className="row gap">
          <button className="btn primary" onClick={() => { put(t); toast(`${t.name} is in the tool strip.`, true); onClose() }}>Save</button>
          <button className="btn quiet" onClick={saveFile}>Save as file</button>
          <button className="btn quiet" onClick={() => pickFile('.ricotool,application/json', async (f) => { try { importAll(JSON.parse(await f.text())); toast('Tools added.', true); onClose() } catch { toast('That file has no tools in it.') } })}>Open a tool file</button>
          <span className="grow" />
          <button className="btn quiet out" onClick={() => { remove(t.id); onClose() }}>Delete</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
