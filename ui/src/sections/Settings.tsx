import { useState } from 'react'
import { Panel, Select, Switch } from '../components/Fields'
import { toast } from '../components/Toasts'
import { rico } from '../engine/connection'
import { useRico } from '../engine/store'
import { autoZoom, setPrefs, usePrefs, paletteOf, THEMES, type Palette } from '../prefs'
import { openOverlay } from '../shell/ui'

export default function Settings() {
  const prefs = usePrefs()
  const app = useRico((s) => s.state?.app)
  const status = useRico((s) => s.status)
  const [confirmClassic, setConfirmClassic] = useState(false)

  return (
    <div className="grid two">
      <Panel title="Colors" sub="Pick a look, or set your own five colors. Everything else follows from them.">
        <div className="stack">
          <div className="themes" role="radiogroup" aria-label="Color theme">
            {THEMES.map((t) => (
              <button key={t.id} role="radio" aria-checked={prefs.theme === t.id} className={`theme${prefs.theme === t.id ? ' on' : ''}`}
                onClick={() => setPrefs({ theme: t.id })} style={{ background: t.colors.bg, color: t.colors.text }}>
                <span className="theme-swatches">
                  <i style={{ background: t.colors.live }} /><i style={{ background: t.colors.out }} /><i style={{ background: t.colors.in }} />
                </span>
                <span>{t.name}</span>
              </button>
            ))}
            <button role="radio" aria-checked={prefs.theme === 'custom'} className={`theme${prefs.theme === 'custom' ? ' on' : ''}`}
              onClick={() => setPrefs({ theme: 'custom', custom: paletteOf(prefs) })} style={{ background: prefs.custom.bg, color: prefs.custom.text }}>
              <span className="theme-swatches">
                <i style={{ background: prefs.custom.live }} /><i style={{ background: prefs.custom.out }} /><i style={{ background: prefs.custom.in }} />
              </span>
              <span>Your own</span>
            </button>
          </div>
          {prefs.theme === 'custom' && (
            <div className="color-fields">
              {([['live', 'Live and buttons'], ['out', 'Going out'], ['in', 'Coming in'], ['bg', 'Background'], ['text', 'Text']] as [keyof Palette, string][]).map(([k, label]) => (
                <label key={k} className="color-field">
                  <input type="color" value={prefs.custom[k]} onChange={(e) => setPrefs({ custom: { ...prefs.custom, [k]: e.target.value } })} />
                  <span>{label}</span>
                  <code>{prefs.custom[k]}</code>
                </label>
              ))}
            </div>
          )}
        </div>
      </Panel>

      <Panel title="Look and feel">
        <div className="stack">
          <Select
            label="Text size"
            value={prefs.scale}
            options={[0.9, 1, 1.15, 1.3, 1.5].map((v) => ({ value: v, label: `${Math.round(v * 100)}%` }))}
            onChange={(v) => setPrefs({ scale: Number(v) })}
          />
          <Select
            label="Interface size"
            value={prefs.fit}
            options={[{ value: 'auto', label: `Fit my screen (now ${Math.round(autoZoom() * 100)}%)` }, { value: 'manual', label: 'My own size' }]}
            onChange={(v) => setPrefs({ fit: v as 'auto' | 'manual' })}
          />
          {prefs.fit === 'manual' && (
            <label className="row" style={{ gap: 10 }}>
              <span className="muted small">Size</span>
              <input className="range grow" type="range" min={50} max={200} step={5} value={Math.round((prefs.zoom || 1) * 100)} onChange={(e) => setPrefs({ zoom: Number(e.target.value) / 100 })} aria-label="Interface size" />
              <span className="small" style={{ minWidth: 44 }}>{Math.round((prefs.zoom || 1) * 100)}%</span>
            </label>
          )}
          <Switch checked={prefs.dyslexic} onChange={(dyslexic) => setPrefs({ dyslexic })}>Easier to read font (OpenDyslexic)</Switch>
          <Switch checked={prefs.calm} onChange={(calm) => setPrefs({ calm })}>Less motion</Switch>
          <Switch checked={prefs.scanlines} onChange={(scanlines) => setPrefs({ scanlines })}>Screen lines</Switch>
          <Switch checked={prefs.boot} onChange={(boot) => setPrefs({ boot })}>Start-up readout</Switch>
          <button className="btn quiet" style={{ justifySelf: 'start' }} onClick={() => openOverlay('shortcuts')}>Keyboard and control shortcuts</button>
        </div>
      </Panel>

      <Panel title="RICO" sub={app ? `Version ${app.version}` : undefined}>
        <div className="stack">
          {app && (
            <div className="row">
              <span className="muted small grow">Settings and scenes are saved in <code>{app.dataFolder}</code></span>
              <button className="btn quiet small" onClick={() => rico.send('app.openDataFolder')}>Open folder</button>
            </div>
          )}
          <p className="muted small" style={{ margin: 0 }}>
            The classic interface is the original RICO window. It has every tool, including LED strips, guitar to MIDI and After
            Effects export, and works on computers without WebView2.
          </p>
          {confirmClassic ? (
            <div className="row">
              <button className="btn out" onClick={async () => {
                const ack = await rico.send('app.classic')
                if (!ack.ok) toast(ack.error ?? 'Could not switch.')
                setConfirmClassic(false)
              }}>Restart in classic</button>
              <button className="btn quiet" onClick={() => setConfirmClassic(false)}>Stay here</button>
            </div>
          ) : (
            <button className="btn quiet" style={{ justifySelf: 'start' }} disabled={status === 'demo'} onClick={() => setConfirmClassic(true)}>Use the classic interface</button>
          )}
          <button className="btn quiet" style={{ justifySelf: 'start' }} onClick={() => rico.send('app.save').then(() => toast('Saved.', true))}>Save settings now</button>
        </div>
      </Panel>

      <Panel title="License">
        <p className="small">RICO is free to use, made by Maya Khalil. It is under the Business Source License 1.1, and becomes Apache 2.0 on 24 October 2030.</p>
        <p className="small muted">
          It is built on Dear ImGui, RtMidi, oscpack, Spout, miniaudio, PFFFT, Eclipse Paho, nlohmann/json and Open Media
          Transport. NDI support is an optional plugin that uses the NDI runtime you install yourself. NDI is a registered
          trademark of Vizrt NDI AB.
        </p>
        <button className="btn quiet small" onClick={() => rico.send('app.openUrl', { url: 'https://github.com/mayakhalil-cmd/RICO' })}>Source code</button>
      </Panel>
    </div>
  )
}
