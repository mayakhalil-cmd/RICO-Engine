import { useEffect, useState, lazy, Suspense } from 'react'
import 'dockview-react/dist/styles/dockview.css'
import Wire from './components/Wire'
import Toasts from './components/Toasts'
import Tips from './components/Tips'
import Boot from './components/Boot'
import { usePrefs } from './prefs'
import { stopLearn } from './engine/learn'
import './engine/midiRules'
import TopBar from './shell/TopBar'
import Workspace from './shell/Workspace'
import Overlays from './shell/Overlays'
import LayerSettingsDialog from './sections/LayerSettings'
import SelectMenus from './components/SelectMenus'
import MotionStrip from './sections/MotionStrip'
import TourOverlay, { startTour, toured } from './shell/Tour'
import { setActiveForCommands } from './shell/commands'
import { goTo, useWorkspaces, visibleWorkspaces } from './shell/workspaces'
import { startSendsHost } from './shell/sendsHost'
import { loadFonts } from './shell/fonts'
const ThreeStrip = lazy(() => import('./three/ThreeStrip'))

export default function App() {
  const prefs = usePrefs()
  const [booting, setBooting] = useState(prefs.boot)
  const { active } = useWorkspaces()

  useEffect(() => setActiveForCommands(active), [active])
  // LED and hardware outputs keep running whatever panel is open
  useEffect(() => { startSendsHost(); void loadFonts() }, [])

  // Most keys are in shell/shortcuts.ts, where you can change them.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') stopLearn()
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && /^[1-9]$/.test(e.key)) {
        e.preventDefault()
        const w = visibleWorkspaces()[Number(e.key) - 1]
        if (w) goTo(w.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      {booting && <Boot onDone={() => { setBooting(false); if (!toured()) { goTo('patch'); window.setTimeout(startTour, 600) } }} />}
      <div className="app">
        <TopBar />
        <main className="app-main" id="main">
          {active === 'create' && <MotionStrip />}
          {active === '3d' && <Suspense fallback={<div className="tool-strip" />}><ThreeStrip /></Suspense>}
          <div className="ws-host"><Workspace key={active} id={active} /></div>
        </main>
        <Wire />
      </div>
      <Overlays />
      <LayerSettingsDialog />
      <SelectMenus />
      <TourOverlay />
      <Toasts />
      <Tips />
    </>
  )
}
