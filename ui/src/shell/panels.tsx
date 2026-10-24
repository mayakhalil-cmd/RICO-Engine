import { lazy, Suspense, type FunctionComponent, type ReactNode } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import { InDock } from './dockContext'
import Welcome from '../sections/Welcome'

// Panels load their code the first time they open, so RICO starts fast.
const Sends = lazy(() => import('../sections/Sends'))
const MidiPanel = lazy(() => import('../sections/Connect').then((m) => ({ default: m.MidiPanel })))
const MorePanel = lazy(() => import('../sections/Connect').then((m) => ({ default: m.MorePanel })))
const OscPanel = lazy(() => import('../sections/Connect').then((m) => ({ default: m.OscPanel })))
const Mappings = lazy(() => import('../sections/Mappings'))
const Log = lazy(() => import('../sections/Monitor').then((m) => ({ default: m.Log })))
const MidiPads = lazy(() => import('../sections/Monitor').then((m) => ({ default: m.MidiPads })))
const OscSender = lazy(() => import('../sections/Monitor').then((m) => ({ default: m.OscSender })))
const Local = lazy(() => import('../sections/Video').then((m) => ({ default: m.Local })))
const Receive = lazy(() => import('../sections/Video').then((m) => ({ default: m.Receive })))
const Send = lazy(() => import('../sections/Video').then((m) => ({ default: m.Send })))
const Transports = lazy(() => import('../sections/Video').then((m) => ({ default: m.Transports })))
const Recipes = lazy(() => import('../sections/Home').then((m) => ({ default: m.Recipes })))
const SignalPath = lazy(() => import('../sections/Home').then((m) => ({ default: m.SignalPath })))
const CreateInspector = lazy(() => import('../sections/Create').then((m) => ({ default: m.CreateInspector })))
const CreateLayers = lazy(() => import('../sections/Create').then((m) => ({ default: m.CreateLayers })))
const CreatePreview = lazy(() => import('../sections/Create').then((m) => ({ default: m.CreatePreview })))
const AudioOverview = lazy(() => import('../audio/AudioOverview'))
const LightingDesk = lazy(() => import('../sections/LightingDesk'))
const PhoneControls = lazy(() => import('../sections/PhoneControls'))
const DmxGrid = lazy(() => import('../sections/Protocols').then((m) => ({ default: m.DmxGrid })))
const MidiControls = lazy(() => import('../sections/Protocols').then((m) => ({ default: m.MidiControls })))
const MqttTopics = lazy(() => import('../sections/Protocols').then((m) => ({ default: m.MqttTopics })))
const OscAddresses = lazy(() => import('../sections/Protocols').then((m) => ({ default: m.OscAddresses })))
const ScriptPanel = lazy(() => import('../sections/Script'))
const Routes = lazy(() => import('../sections/Routes'))
const NodeEditor = lazy(() => import('../nodes/NodeEditor'))
const TimelinePanel = lazy(() => import('../sections/Timeline'))
const EffectsPanel = lazy(() => import('../sections/EffectsPanel'))
const Share = lazy(() => import('../sections/Share'))
const MidiStudio = lazy(() => import('../sections/MidiStudio'))
const VideoOut = lazy(() => import('../sections/VideoOut'))
const AudioLab = lazy(() => import('../audio/AudioLab'))
const SoundEditor = lazy(() => import('../audio/SoundEditor'))
const Generator = lazy(() => import('../audio/Generator'))
const MappingPanel = lazy(() => import('../mapping/MappingPanel'))
const PrintPanel = lazy(() => import('../fab/PrintPanel'))
const LaserPanel = lazy(() => import('../fab/LaserPanel'))

// Every panel that can live in a workspace. Panels can be opened in any
// workspace from the Window menu, and dragged, split or floated.

export interface PanelDef {
  id: string
  title: string
  group: string
  about: string
  render: () => ReactNode
  flush?: boolean      // fills the panel edge to edge, no padding
}

// The 3D playground loads three.js only when you first open it.
const Viewport3D = lazy(() => import('../three/Panels').then((m) => ({ default: m.Viewport3D })))
const Outliner3D = lazy(() => import('../three/Panels').then((m) => ({ default: m.Outliner3D })))
const Props3D = lazy(() => import('../three/Panels').then((m) => ({ default: m.Props3D })))
const Symbiote3D = lazy(() => import('../three/SymbiotePanel').then((m) => ({ default: m.SymbiotePanel })))
const later = (node: ReactNode) => <Suspense fallback={<p className="dim small" style={{ padding: 14 }}>Loading the 3D playground...</p>}>{node}</Suspense>

export const PANELS: PanelDef[] = [
  { id: 'welcome', title: 'Welcome', group: 'Overview', about: 'What RICO is, what people make with it, and the tour', render: () => <Welcome /> },
  { id: 'signal-path', title: 'Signal path', group: 'Overview', about: 'What comes in, what RICO does, where it goes', render: () => <SignalPath /> },
  { id: 'recipes', title: 'Use RICO with', group: 'Overview', about: 'Setups for Blender, Unreal, Maya, Houdini and more', render: () => <Recipes /> },

  { id: 'routes', title: 'Signals', group: 'Routing', about: 'A table of everything in and out: add rows, translate between protocols', render: () => <Routes /> },

  { id: 'midi-studio', title: 'MIDI rules and monitor', group: 'MIDI', about: 'Translate MIDI to anything, monitor with filters, clock out', render: () => <MidiStudio /> },
  { id: 'midi-devices', title: 'MIDI devices', group: 'MIDI', about: 'Inputs, outputs and virtual ports', render: () => <MidiPanel /> },
  { id: 'midi-controls', title: 'Controls', group: 'MIDI', about: 'Live view of every knob, fader and pad', render: () => <MidiControls /> },
  { id: 'mappings', title: 'Mappings', group: 'MIDI', about: 'Which control sends which OSC address', render: () => <Mappings /> },
  { id: 'play-midi', title: 'Play MIDI', group: 'MIDI', about: 'Test pads and a CC slider', render: () => <MidiPads /> },

  { id: 'osc-setup', title: 'OSC', group: 'OSC', about: 'Main app, ports and extra destinations', render: () => <OscPanel /> },
  { id: 'osc-addresses', title: 'Addresses', group: 'OSC', about: 'Live tree of every OSC address', render: () => <OscAddresses /> },
  { id: 'send-osc', title: 'Send OSC', group: 'OSC', about: 'Send a test message', render: () => <OscSender /> },

  { id: 'video-out', title: 'Video out', group: 'Video', about: 'What to send, how big, how often; Spout and network video', render: () => <VideoOut /> },
  { id: 'video-transports', title: 'Network video', group: 'Video', about: 'OMT, NDI and plugins', render: () => <Transports /> },
  { id: 'video-send', title: 'Send video', group: 'Video', about: 'Share video with other computers', render: () => <Send /> },
  { id: 'video-receive', title: 'Receive video', group: 'Video', about: 'Bring video in from other computers', render: () => <Receive /> },
  { id: 'video-local', title: 'Spout', group: 'Video', about: 'Share video between apps on this computer', render: () => <Local /> },

  { id: 'phone', title: 'Phone controls', group: 'Control', about: 'Build faders, knobs and pads for your phone (OSC, MIDI, DMX, signals) and open them with a QR code', render: () => <PhoneControls /> },
  { id: 'light-desk', title: 'Lighting desk', group: 'Light', about: 'Fixtures, colors, moving heads, effects, cues, Art-Net and sACN', render: () => <LightingDesk /> },
  { id: 'dmx-grid', title: 'DMX', group: 'Light', about: 'All 512 channels of a universe', render: () => <DmxGrid /> },
  { id: 'mqtt-topics', title: 'Devices', group: 'Devices', about: 'MQTT topics and messages', render: () => <MqttTopics /> },
  { id: 'connections', title: 'Connections', group: 'Devices', about: 'Audio, Art-Net and MQTT broker', render: () => <MorePanel /> },
  { id: 'audio-lab', title: 'Audio lab', group: 'Audio', about: 'Analyzer: your own bands, smoothing, tempo, pitch, loudness', render: () => <Suspense fallback={null}><AudioLab /></Suspense> },
  { id: 'sound-editor', title: 'Sound editor', group: 'Audio', about: 'Cut, fade, EQ, compress, reverb, export WAV', render: () => <Suspense fallback={null}><SoundEditor /></Suspense> },
  { id: 'sound-gen', title: 'Sound generator', group: 'Audio', about: 'Make kicks, snares, basses, pads, risers', render: () => <Suspense fallback={null}><Generator /></Suspense> },
  { id: 'audio-meters', title: 'Audio', group: 'Audio', about: 'Bands, beats and LFOs', render: () => <AudioOverview /> },

  { id: 'create-preview', title: 'Composition', group: 'Motion', about: 'The Motion picture', render: () => <CreatePreview />, flush: true },
  { id: 'create-layers', title: 'Project', group: 'Motion', about: 'The composition and its layers', render: () => <CreateLayers />, flush: true },
  { id: 'timeline', title: 'Timeline', group: 'Motion', about: 'Keyframes, layer timing, record and render to video', render: () => <TimelinePanel />, flush: true },
  { id: 'create-effects', title: 'Effects and Presets', group: 'Motion', about: 'Every effect, new layers and ready-made scenes, to click or find', render: () => <EffectsPanel />, flush: true },
  { id: 'create-inspector', title: 'Effect Controls', group: 'Motion', about: 'Settings of the selected layer', render: () => <CreateInspector /> },

  { id: '3d-view', title: '3D view', group: '3D', about: 'The 3D playground: shapes, lights, models', render: () => later(<Viewport3D />), flush: true },
  { id: '3d-outliner', title: 'Scene', group: '3D', about: 'Everything in the 3D scene', render: () => later(<Outliner3D />) },
  { id: '3d-timeline', title: '3D timeline', group: '3D', about: 'Keys for every 3D object, on the same time line as Motion', render: () => <TimelinePanel only3d />, flush: true },
  { id: '3d-props', title: 'Object settings', group: '3D', about: 'Position, material and links of the selected thing', render: () => later(<Props3D />) },
  { id: '3d-symbiote', title: 'Symbiote', group: '3D', about: 'Every setting of the living goo on the selected object: look, veins, tendrils, stretch, snap, drips', render: () => later(<Symbiote3D />) },

  { id: 'mapping', title: 'Projection mapping', group: 'Output', about: 'Surfaces, grids, masks, soft edges, 3D objects, gobos', render: () => <Suspense fallback={null}><MappingPanel /></Suspense> },
  { id: 'print', title: 'Print', group: 'Output', about: 'Slice your gobos and STL files and send them to your 3D printer', render: () => <PrintPanel /> },
  { id: 'laser', title: 'Laser', group: 'Output', about: 'Cut your gobo plates and SVG files on a laser', render: () => <LaserPanel /> },
  { id: 'sends', title: 'LEDs and hardware', group: 'Output', about: 'Pixels to LED strips and walls, values to a Raspberry Pi, Arduino, ESP32, MQTT, web addresses and WebSockets', render: () => <Sends /> },
  { id: 'share', title: 'Outputs and sharing', group: 'Output', about: 'Projector windows, corner pin, other devices, live share', render: () => <Share /> },

  { id: 'messages', title: 'Messages', group: 'Monitor', about: 'Every message in and out', render: () => <Log /> },
]

function PanelLoading() { return <div className="panel-loading" aria-label="Loading"><i /><i /><i /></div> }

export const panelById = (id: string) => PANELS.find((p) => p.id === id)

function wrap(def: PanelDef): FunctionComponent<IDockviewPanelProps> {
  const Component = () => (
    <InDock.Provider value={true}>
      <div className={`dock-body${def.flush ? ' flush' : ''}`}><Suspense fallback={<PanelLoading />}>{def.render()}</Suspense></div>
    </InDock.Provider>
  )
  Component.displayName = `Panel(${def.id})`
  return Component
}

function ScriptDock(props: IDockviewPanelProps<{ script?: string }>) {
  return (
    <InDock.Provider value={true}>
      <div className="dock-body flush">
        <Suspense fallback={<PanelLoading />}><ScriptPanel scriptId={props.params.script ?? ''} onRename={(name) => props.api.setTitle(name)} /></Suspense>
      </div>
    </InDock.Provider>
  )
}

function NodesDock(props: IDockviewPanelProps<{ graph?: string }>) {
  return (
    <InDock.Provider value={true}>
      <div className="dock-body flush">
        <Suspense fallback={<PanelLoading />}><NodeEditor graphId={props.params.graph ?? ''} onRename={(name) => props.api.setTitle(name)} /></Suspense>
      </div>
    </InDock.Provider>
  )
}

export const dockComponents: Record<string, FunctionComponent<IDockviewPanelProps>> = {
  ...Object.fromEntries(PANELS.map((p) => [p.id, wrap(p)])),
  script: ScriptDock as FunctionComponent<IDockviewPanelProps>,
  nodes: NodesDock as FunctionComponent<IDockviewPanelProps>,
}
