import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/courier-prime/400.css'
import '@fontsource/courier-prime/700.css'
import './styles.css'

const root = createRoot(document.getElementById('root')!)
const output = new URLSearchParams(location.search).get('output')
const surface = new URLSearchParams(location.search).get('surface')

if (surface !== null) {
  // A phone or tablet: just the control surface.
  import('./phone/PhoneApp').then(({ default: PhoneApp }) => {
    document.body.classList.add('phone-window')
    root.render(<PhoneApp id={surface.replace(/[^\w-]/g, '')} />)
  })
} else if (output) {
  // An output window for a projector or second screen: just the picture.
  import('./output/OutputApp').then(({ default: OutputApp }) => {
    document.body.classList.add('output-window')
    root.render(<OutputApp id={output.replace(/[^\w-]/g, '') || 'out1'} />)
  })
} else {
  Promise.all([
    import('./App'),
    import('./engine/connection'),
    import('./prefs'),
    import('./shell/favicon'),
    import('./shell/shortcuts'),
    import('./shell/sync'),
  ]).then(([{ default: App }, { rico }, { apply, initialPrefs }, { startFavicon }, { startShortcuts }, { startSync }]) => {
    apply(initialPrefs())
    startFavicon()
    rico.start()
    startShortcuts()
    startSync()
    // The lighting desk keeps running (cues, effects, links) without its panel open.
    import('./engine/desk').then((m) => { if (m.getDesk().fixtures.length) m.startDesk() })
    import('./phone/surfaces').then((m) => m.startPhoneHost())
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })
}
