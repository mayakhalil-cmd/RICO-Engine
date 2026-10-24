// Step by step setups for the apps people use RICO with most. Each one can
// prepare RICO's side by itself; the steps say what to do in the other app.

export interface RecipeAction {
  label: string
  commands: { op: string; args?: Record<string, unknown> }[]
}

export interface Recipe {
  id: string
  app: string
  idea: string
  port?: number
  steps: string[]
  video?: string
  action: RecipeAction
  addressExample: string
}

export const RECIPES: Recipe[] = [
  {
    id: 'blender',
    app: 'Blender',
    idea: 'Turn a knob, move an object, light or shader value in Blender while you work.',
    port: 9010,
    addressExample: '/blender/Cube/location/2',
    steps: [
      'Press "Set up RICO" below. RICO starts sending OSC to Blender on port 9010.',
      'In Blender open Edit, Preferences, Add-ons, Install from Disk, and pick integrations/blender/rico_blender.py from the RICO folder.',
      'In the 3D viewport press N, open the RICO tab and press Start listening.',
      'In Mappings, set an address like /blender/Cube/location/2 and move your control. The cube follows.',
      'Every value is also stored on the scene as a custom property, so drivers and Geometry Nodes can use it.',
    ],
    video: 'For video, the free TextureSharing add-on sends the Blender viewport as Spout. Pick it under Video, then send it to another computer with OMT.',
    action: { label: 'Set up RICO', commands: [{ op: 'osc.dest.add', args: { name: 'Blender', ip: '127.0.0.1', port: 9010 } }] },
  },
  {
    id: 'unreal',
    app: 'Unreal Engine',
    idea: 'Play lights, cameras and materials in a running level from a MIDI controller.',
    port: 8000,
    addressExample: '/game/light/intensity',
    steps: [
      'Press "Set up RICO" below. RICO sends OSC to Unreal on port 8000 with addresses that start with /game.',
      'In Unreal open Edit, Plugins, search for OSC and enable it. Restart the editor.',
      'In your Level Blueprint, on Begin Play call Create OSC Server with address 127.0.0.1 and port 8000, and store it in a variable.',
      'Bind an event to On OSC Message Received. Use Get OSC Message Address and Get OSC Message Float to drive what you like.',
      'Move a control. The address and value show up in Monitor, so you can copy the address into your Blueprint.',
    ],
    video: 'To get the Unreal viewport out, use a Spout plugin for Unreal (Off World Live has a free one). RICO can then forward it to other computers with OMT.',
    action: { label: 'Set up RICO', commands: [{ op: 'osc.preset', args: { index: 0 } }] },
  },
  {
    id: 'maya',
    app: 'Autodesk Maya',
    idea: 'Puppet rigs and attributes live with sliders and pads, and keep the takes.',
    port: 9030,
    addressExample: '/maya/pCube1/translateY',
    steps: [
      'Press "Set up RICO" below. RICO sends OSC to Maya on port 9030.',
      'Copy integrations/maya/rico_maya.py into your Maya scripts folder (Documents\\maya\\scripts).',
      'In the Script Editor, on a Python tab, run: import rico_maya; rico_maya.start()',
      'In Mappings, set an address like /maya/pCube1/translateY. Any attribute works: /maya/<node>/<attribute>.',
      'Turn on Auto Key in Maya to record what you play.',
    ],
    action: { label: 'Set up RICO', commands: [{ op: 'osc.dest.add', args: { name: 'Maya', ip: '127.0.0.1', port: 9030 } }] },
  },
  {
    id: 'houdini',
    app: 'Houdini',
    idea: 'Feed controls into CHOPs and parameters for procedural setups you can play.',
    port: 9020,
    addressExample: '/houdini/obj/geo1/tx',
    steps: [
      'Press "Set up RICO" below. RICO makes a virtual MIDI port called "RICO Houdini" and sends OSC on port 9020.',
      'MIDI way: in a CHOP network add a MIDI In CHOP and pick "RICO Houdini" as the device. Export the channels to any parameter.',
      'OSC way: open Windows, Python Shell and run: exec(open(r"<RICO folder>\\integrations\\houdini\\rico_houdini.py").read())',
      'Then use addresses like /houdini/obj/geo1/tx, the path of a node followed by the parameter name.',
    ],
    action: {
      label: 'Set up RICO',
      commands: [
        { op: 'midi.virtual.create', args: { name: 'RICO Houdini' } },
        { op: 'osc.dest.add', args: { name: 'Houdini', ip: '127.0.0.1', port: 9020 } },
      ],
    },
  },
  {
    id: 'touchdesigner',
    app: 'TouchDesigner',
    idea: 'Send controls in as CHOPs and get Motion visuals in as a TOP.',
    port: 9001,
    addressExample: '/td/comp1/opacity',
    steps: [
      'Press "Set up RICO" below. RICO sends OSC to TouchDesigner on port 9001.',
      'Add an OSC In CHOP and set its port to 9001. Your controls appear as channels.',
      'For visuals, start Spout in Motion and add a Spout In TOP in TouchDesigner. Pick "RICO".',
      'For another computer, send with OMT from RICO, and on that computer let RICO receive it and share it as Spout.',
    ],
    action: { label: 'Set up RICO', commands: [{ op: 'osc.preset', args: { index: 4 } }] },
  },
  {
    id: 'unity',
    app: 'Unity',
    idea: 'Drive game objects and shaders from hardware during play mode.',
    port: 8001,
    addressExample: '/unity/player/speed',
    steps: [
      'Press "Set up RICO" below. RICO sends OSC to Unity on port 8001.',
      'Install an OSC package such as extOSC or OSC Jack and add a receiver on port 8001.',
      'Map addresses that start with /unity to your scripts.',
    ],
    action: { label: 'Set up RICO', commands: [{ op: 'osc.preset', args: { index: 1 } }] },
  },
]
