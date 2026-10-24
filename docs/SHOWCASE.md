# Showcase ideas

The point of these videos is that RICO is not only a VJ tool. It is a right
hand for anyone working across apps and hardware. Each idea below is one
short video (30 to 60 seconds) with one clear moment, plus what to set up.

Film the screen and your hands at the same time if you can. A phone on a
small tripod above the desk works. Keep the wire at the bottom of RICO in
frame, because it shows the signals moving.

## 1. Blender: "Sculpt the light with your hands"

**The moment:** you turn two knobs on Twin Ctrl and a sun lamp in Blender
swings across a product shot while the render preview updates.

- RICO: Home, Blender, Set up RICO.
- Mappings: knob 1 to `/blender/Sun/rotation_euler/2`, range 0 to 6.28.
  Knob 2 to `/blender/Sun/data/energy`, range 0 to 10.
- For anything that isn't an object setting, use any other address, like
  `/rig/warmth`. The add-on stores it on the scene, and a driver can read
  `scene["rico"]["rig/warmth"]`.
- Blender: Eevee or Cycles viewport in Rendered mode.
- Bonus shot: TextureSharing add-on sends the viewport to RICO as Spout, RICO
  sends it over OMT to a laptop that shows it full screen. "Client review from
  the next room."

## 2. Unreal Engine: "A lighting desk for a game level"

**The moment:** faders on a MIDI controller run the time of day, fog and a
spotlight in a running Unreal level, like a theatre lighting desk.

- RICO: Home, Unreal Engine, Set up RICO.
- Unreal: Level Blueprint with an OSC server on port 8000. Route
  `/game/sun/angle`, `/game/fog/density` and `/game/spot/intensity`.
- Pads (notes) trigger events: `/game/trigger/lightning` flashes a light.
- Bonus: audio analysis. Music plays, `audio:kick` drives the spotlight.
  Show the Motion wire and Unreal reacting together.

## 3. Maya: "Puppeteer a rig, keep the take"

**The moment:** with Auto Key on and the timeline playing, you play a
character's head and eyes with a joystick or two knobs, then scrub back and
the performance is keyframed.

- RICO: Home, Autodesk Maya, Set up RICO.
- Maya: `import rico_maya; rico_maya.start()`.
- Mappings: `/maya/head_ctrl/rotateY` (range -45 to 45),
  `/maya/head_ctrl/rotateX` (-20 to 20), `/maya/eye_ctrl/translateX`.
- Show the graph editor afterwards with the recorded curves.

## 4. Houdini: "A synth for geometry"

**The moment:** a keyboard plays a procedural sculpture. Each note adds a
pulse, the mod wheel twists it.

- RICO: Home, Houdini, Set up RICO. This makes the "RICO Houdini" virtual
  port.
- Houdini: a MIDI In CHOP on "RICO Houdini", channels exported to a Twist SOP
  and a Mountain SOP amplitude.
- Talk point: no driver to install. The virtual port comes from Windows
  MIDI Services through RICO.

## 5. TouchDesigner across two computers

**The moment:** a laptop runs Motion, the visuals appear in TouchDesigner on
a second PC through OMT, and TouchDesigner's own output comes back the other
way.

- PC 1: Motion, Send video, Video, Send with OMT.
- PC 2: RICO receives OMT and shares it as Spout, TouchDesigner reads it.
- Talk point: open source network video, no license, no extra install.

## 6. Twin Ctrl: "Hardware you made, everywhere at once"

**The moment:** one move on Twin Ctrl changes Blender, Unreal and the Motion
visuals at the same time.

- Connect, OSC, "Also send to": add Blender (9010) and keep Unreal as main.
- Same address names in both apps, for example `/rig/energy`.
- Close-up of the hardware first, then pull out to the three windows.

## Tips for the edit

- Start every video on the result, not on the setup.
- Show the RICO window for two seconds at most, then the other app. People
  remember the app they know reacting to the hardware.
- Caption the address once (`/maya/head_ctrl/rotateY`), so 3D artists see
  how simple it is.
- End on the RICO_ logo with the cursor blinking.
