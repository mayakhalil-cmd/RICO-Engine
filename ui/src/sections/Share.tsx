import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Panel, Switch } from '../components/Fields'
import { toast } from '../components/Toasts'
import { rico } from '../engine/connection'
import { useRico } from '../engine/store'
import { closeOutput, openOutput, useOutputs } from '../shell/outputs'
import { setLiveShare, useLiveShare } from '../shell/sync'

// Getting RICO onto other screens: output windows for projectors, other
// devices on the network, and live sharing between them.

export default function Share() {
  const app = useRico((s) => s.state?.app)
  const ip = useRico((s) => s.state?.osc.localIp)
  const status = useRico((s) => s.status)
  const outputs = useOutputs()
  const live = useLiveShare()
  const [qr, setQr] = useState('')
  const url = ip && app?.port ? `http://${ip}:${app.port}/` : ''

  useEffect(() => {
    if (!url || !app?.network) return setQr('')
    QRCode.toDataURL(url, { margin: 1, width: 180, color: { dark: '#000000', light: '#ffffff' } }).then(setQr).catch(() => setQr(''))
  }, [url, app?.network])

  return (
    <div className="dpanel share">
      <Panel title="Output windows" nested sub="The Motion picture in its own window. Drag it to a projector or second screen.">
        <div className="stack">
          <div className="row">
            <button className="btn primary" onClick={() => openOutput()}>Open an output window</button>
            <span className="dim small">{outputs.length ? `${outputs.length} open` : 'None open'}</span>
          </div>
          {outputs.length > 0 && (
            <ul className="list">
              {outputs.map((id) => (
                <li key={id}><span className="name">Output {id.replace('out', '')}</span><button className="btn small quiet" onClick={() => closeOutput(id)}>Close</button></li>
              ))}
            </ul>
          )}
          <p className="dim small">In the output window: double-click for full screen. Press C and drag the four corners onto your wall, box or screen. T shows a test grid. Soft left and right blend two projectors.</p>
        </div>
      </Panel>

      <Panel title="Other devices" nested sub="Open RICO on a tablet, phone or another computer on the same network, for a second screen or a remote control.">
        <div className="stack">
          <Switch checked={Boolean(app?.network)} onChange={async (on) => {
            const ack = await rico.send('app.network', { on })
            if (!ack.ok) toast(ack.error ?? 'Could not change that.')
            else toast(on ? 'Other devices can open RICO now.' : 'Only this computer can open RICO now.', true)
          }}>Let devices on this network open RICO</Switch>
          {status === 'demo' && <p className="dim small">Not in demo mode.</p>}
          {app?.network && url && (
            <div className="share-url">
              {qr && <img src={qr} alt={`QR code for ${url}`} width={150} height={150} />}
              <div>
                <p>Open this on the other device:</p>
                <code className="share-link">{url}</code>
                <p className="dim small">Windows may ask to allow RICO through the firewall the first time. Only turn this on in networks you trust.</p>
              </div>
            </div>
          )}
          <p className="small">{app?.screens ?? 1} screen{(app?.screens ?? 1) === 1 ? '' : 's'} connected.</p>
        </div>
      </Panel>

      <Panel title="Live share" nested sub="Every connected screen sees the same Motion scene, routes, node networks and 3D scene. Change something on one and the others follow.">
        <Switch checked={live} onChange={setLiveShare}>Share changes between screens</Switch>
      </Panel>
    </div>
  )
}
