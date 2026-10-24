import { useEffect, useState, useSyncExternalStore } from 'react'
import { rico } from '../engine/connection'
import Logo from '../components/Logo'
import SurfaceView from './SurfaceView'
import { startPhoneClient, useSurfaces } from './surfaces'

// The page a phone opens: RICO's control surfaces, full screen, for touch.

export default function PhoneApp({ id }: { id: string }) {
  const surfaces = useSurfaces()
  const status = useSyncExternalStore(rico.subscribe, () => rico.get().status)
  const [pick, setPick] = useState(id)
  useEffect(() => { rico.start(); startPhoneClient() }, [])
  const s = surfaces.find((x) => x.id === pick) ?? surfaces[0]
  return (
    <div className="phone-app">
      <div className="phone-top">
        <Logo size={18} />
        {surfaces.length > 1 && (
          <select className="select" value={s?.id ?? ''} onChange={(e) => setPick(e.target.value)}>{surfaces.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        )}
        <span className={`phone-dot ${status === 'live' ? 'on' : ''}`}>{status === 'live' ? 'connected' : 'connecting...'}</span>
      </div>
      {s ? <SurfaceView s={s} /> : <p className="phone-wait">{status === 'live' ? 'Waiting for the controls from RICO. Keep RICO open on the computer.' : 'Looking for RICO on this network...'}</p>}
    </div>
  )
}
