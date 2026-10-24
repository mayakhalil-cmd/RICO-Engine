import { toast } from './Toasts'
import { addFont, useFonts } from '../shell/fonts'
import { pickFile } from '../shell/ui'

// Pick a font, or add your own (TTF, OTF, WOFF). Used by Motion text,
// 3D text and letters drawn as strokes.
export default function FontPicker({ value, onChange, by = 'css' }: { value: string; onChange: (v: string) => void; by?: 'css' | 'name' }) {
  const fonts = useFonts()
  return (
    <div className="row gap font-picker">
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Font">
        {fonts.map((f) => <option key={f.name} value={by === 'css' ? f.css : f.name} style={{ fontFamily: f.css }}>{f.name}{f.builtIn ? '' : ' (yours)'}</option>)}
      </select>
      <button className="btn small quiet" onClick={() => pickFile('.ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2', (file) => {
        addFont(file).then((name) => { const f = fonts.find((x) => x.name === name); onChange(by === 'css' ? f?.css ?? `'${name}', sans-serif` : name); toast(`${name} is ready to use.`, true) }).catch(() => toast('That font did not open.'))
      })}>Add a font...</button>
    </div>
  )
}
