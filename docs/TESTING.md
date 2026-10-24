# Testing RICO 3

Work through this top to bottom. Each step says what to do and what you
should see. If a step fails, write down the step number and what you saw,
plus anything in Monitor (or the MIDI tab's log in classic).

You need: your PC, a MIDI controller (Twin Ctrl is perfect), and for the
network video steps a second PC or laptop on the same Wi-Fi or cable.

## A. Build and first start

| # | Do | Expect |
| --- | --- | --- |
| A1 | Build with `cmake --preset windows` and `cmake --build --preset release` | `build\RICO\` has RICO.exe, libomt.dll, libvmx.dll, `ui\`, `plugins\rico-ndi.dll` |
| A2 | Start `build\RICO\RICO.exe` | Right away a black window with RICO, a green cursor and a running bar ("STARTING"). Then the interface. Never an empty black or white window. |
| A2b | Start RICO a second time | It opens faster than the first time (the interface files are kept). |
| A3 | Look next to RICO.exe | A new `data` folder with `rico_settings.txt` after you close RICO |
| A4 | Press keys 1 to 7 | Each section opens. The rail shows where you are. |
| A5 | Settings, "Use the classic interface", then "Restart in classic" | RICO restarts in the old ImGui window, with a "Network Video" tab instead of "NDI" |
| A6 | In classic: File, "Switch to the new interface" | RICO restarts in the new interface |

## B. MIDI and OSC

| # | Do | Expect |
| --- | --- | --- |
| B1 | Connect your controller. Connect, MIDI, pick it as Input | The pill at the top turns green with its name |
| B2 | Move a knob | The wire at the bottom shows blue and pink ticks. Mappings gets a new row. |
| B3 | In Mappings rename it and set the address to `/test/knob` | Monitor shows `OSC out /test/knob` with values |
| B4 | Install the free [Protokol](https://hexler.net/protokol) app, listen on port 8000 | It shows `/test/knob` moving. That's RICO's OSC reaching another app. |
| B5 | Monitor, Send OSC, drag the slider | Protokol shows `/rico/test` |
| B6 | From a phone app like TouchOSC, send to the address shown under Connect, OSC | Monitor shows `OSC in` rows. Motion can link to them. |

## C. Virtual MIDI ports (Windows MIDI Services)

Before this: install the Windows MIDI Services runtime and tools from
[aka.ms/midi](https://aka.ms/midi). In PowerShell, `Get-Service midisrv`
can say Stopped; it starts by itself when needed.

| # | Do | Expect |
| --- | --- | --- |
| C1 | Connect, Virtual ports, keep "RICO Port", press Make port | A toast says it is ready. It shows in the list. |
| C2 | Open the MIDI Settings app (from Windows MIDI Services) | "RICO Port" and "RICO Port (RICO)" are listed as loopback endpoints |
| C3 | Turn on "Pass input straight to the output and virtual ports", move your controller | Any app listening to "RICO Port" (Ableton, MIDI-OX, Houdini's MIDI In CHOP) gets the messages |
| C4 | Send MIDI from that app into "RICO Port" | RICO's Monitor shows it and Mappings gets rows |
| C5 | Close and open RICO | The port comes back by itself |
| C6 | If the port can't be made | The yellow note under Virtual ports says why. Copy that text for me. |

## D. Network video with OMT

| # | Do | Expect |
| --- | --- | --- |
| D1 | Motion, turn on "Send video" (under the picture) | The fps counter keeps going |
| D2 | Video, Send, "What to send" is Motion canvas, press Start sending | The pill "Sending RICO" appears |
| D3 | On the second PC, open RICO, Video, Receive, Find sources | Your first PC shows up, like `DESKTOP-XXXX (RICO)` |
| D4 | Connect | "Receiving ..., 1280 x 720" |
| D5 | Turn on "Share it on this computer as Spout", open TouchDesigner, add a Spout In TOP | TouchDesigner shows your Motion visuals from the other computer |
| D6 | One PC only: start RICO twice | The second copy can receive from the first. Good for a quick test. |
| D7 | Also try OBS: the OMT release has an OBS plugin (`omtplugin`) | OBS can show RICO as an OMT source |
| D8 | Rename `libomt.dll` and restart | Video says "libomt.dll was not found next to RICO.exe". Nothing else breaks. |

## E. NDI plugin

| # | Do | Expect |
| --- | --- | --- |
| E1 | Without NDI Tools installed, open Video | NDI is dashed, with "NDI runtime not found" and a "Get it" button. OMT still works. |
| E2 | Install [NDI Tools](https://ndi.video/tools/), restart RICO | NDI turns solid. Pick it. |
| E3 | Start sending, open NDI Studio Monitor | "RICO" is in its source list and shows your visuals |
| E4 | Receive, Find sources | NDI sources on the network are listed. Connect works. |
| E5 | Delete `plugins\rico-ndi.dll`, restart | NDI is gone from the list. No error. |

## F. Spout on one computer

| # | Do | Expect |
| --- | --- | --- |
| F1 | Video, On this computer, Start Spout | TouchDesigner's Spout In TOP (or OBS with the Spout plugin) can pick "RICO" |
| F2 | In TouchDesigner add a Spout Out TOP. In RICO, "Take video from an app", Look again, pick it | It's listed and can be picked |
| F3 | Video, Send, "What to send" is "The Spout sender RICO is receiving", Start sending | The other PC receives TouchDesigner's picture over OMT |

## G. Motion

| # | Do | Expect |
| --- | --- | --- |
| G1 | Open Motion | The starter scene moves: blue noise, green grid, pink rings, RICO_ |
| G2 | Connect, Sound, press Listen, and play music | The rings pulse with the kick and the grid speeds up |
| G3 | Click the link icon next to a setting, pick your knob | The setting follows your knob. The layer shows a pink link mark. |
| G4 | Add a Camera layer | Windows asks for the camera once. Then you see yourself. |
| G5 | Drag a picture onto the preview | A new Image layer |
| G6 | Save file, then Open file | The scene comes back the same |
| G7 | Press H, then F | Panels hide. F gives full screen preview. |
| G8 | Go to another section while "Send video" is on | Video keeps flowing (check on the receiving PC) |

## H. 3D apps

Use Home, "Use RICO with". Each card has a "Set up RICO" button and steps.

| # | App | Pass when |
| --- | --- | --- |
| H1 | Blender | With the add-on listening, `/blender/Cube/location/2` moves the cube up and down |
| H2 | Unreal | Your Blueprint prints the address and value from On OSC Message Received |
| H3 | Maya | `/maya/pCube1/translateY` moves the cube. With Auto Key on, keys are recorded. |
| H4 | Houdini | MIDI In CHOP shows channels from "RICO Houdini", or the OSC script moves `/obj/geo1` |

## I. Portable

| # | Do | Expect |
| --- | --- | --- |
| I1 | Copy `build\RICO\` to a USB stick and run it on another PC | Starts the same. Settings stay on the stick in `data\`. |
| I2 | Unplug the network and start RICO | Everything opens. Fonts look right. Nothing waits for the internet. |
| I3 | Put RICO in `C:\Program Files\RICO` | Settings go to `%APPDATA%\RICO` because Program Files can't be written to |

## J. New in this version

| # | Do | Expect |
| --- | --- | --- |
| J1 | Audio > Audio lab, source System audio, play music | The bands move. The numbers under the spectrum do not jump around. "What is playing" says Music. |
| J2 | Play a podcast or a film scene | It says Speech in dialog and Music or Foley in the other parts, after about a second |
| J3 | Sound editor > Multitrack, arm an audio track (R), press Rec, talk | A new clip "Take 1" with your voice. Turn on I to hear the track's effects while recording. |
| J4 | Arm the instrument track, press keys A S D F | You hear notes; with Rec on they become a note clip |
| J5 | DMX / ArtNet > Lighting desk, patch your fixtures, Output > Send | Your fixtures follow the desk. Find Art-Net nodes lists your node (if no other Art-Net program is open). |
| J6 | Phone controls, Allow phones, scan the QR code | The surface opens on the phone; moving a fader moves "phone:name" in RICO |
| J7 | 3D, Add > Editable cube, Tab, select the top points, E | The top is pulled out. Sculpt and Paint work with a pen. |
| J8 | Mapping > Mask from a picture, open a photo, click the object | A green outline around it; Make projection mask adds a mask; Mask and gobo adds the mask and a gobo with only that shape |
| J9 | 3D, Sculpt with your pen, Clay brush, Lazy at 10 | Smooth strokes; pressure changes size and strength; Shift smooths |
| J10 | 3D, a sphere with My material > Painterly, outline with floating strokes on | Brush-stroke look with ragged edges and loose lines around it that redraw |
| J11 | 3D, + Add > Fog volume, a point light inside | A glow in the fog around the light |
| J12 | 3D, Add > Editable sphere, paint across it in Paint mode, then Sculpt over the paint | No seams or broken lines in the paint, also where the sides meet; the paint stays put while you sculpt |
| J13 | Mapping, Mask from a picture with a tall phone photo, make a mask | The mask has the true shape of the object on the preview and on the projector (not squeezed) |
| J14 | Mapping, click a surface or mask, press W, E, R and drag the handle | It moves, turns and changes size; a round mask stays round while it turns |
| J15 | Phone controls, + Tablet page, add a pad grid, a step sequencer, a logo, open it on a tablet | The page looks the same as on the computer; pads send notes; the sequencer plays |
| J16 | Phone controls, add Tilt, open it on a phone, tap it and tilt the phone | The dot follows the tilt (if the browser allows the motion sensor) |
| J17 | Mapping > Gobos, On a stand or taped, STL, open it in another slicer | A thin flat plate with your openings and two holes; the grams shown are close to what the slicer says |
| J18 | Gobos, Each mask is an opening, X one mask, drag another on the plate | The X'd mask goes under Left out; the other moves; Exact puts it back |
| J19 | Move a mask point on the Mapping preview, switch tabs, press Ctrl+Z | The point goes back; the tab does not change |
| J20 | Click a mapping mask (or a phone control), press Delete | It is removed; Ctrl+Z brings it back (mapping) |
| J21 | 3D, turn on Grid 0.5 m and Angle 15, drag the arrows and rings | Steps of 0.5 m and 15 degrees; All shows arrows, rings and size boxes together |
| J22 | Output > LEDs and hardware, + Output > WLED, type its address, LED count, switch on | The strip shows the Motion picture where you placed it on the preview |
| J23 | + Output > Arduino or ESP over USB, upload the starter sketch, pick the COM port | The strip follows the picture over USB |
| J24 | + Output > Raspberry Pi (OSC), run the starter script, add a fader signal | The Pi prints the value and dims the LED on GPIO 17 |
| J25 | Nodes: right-click the background; select two nodes and press C | The node picker opens where you clicked; a note goes around both and moves them when dragged |
| J26 | Nodes > Edit sections: rename one, change its color, add one | The canvas lanes change and stay after a restart |
| J27 | 3D: import an `.obj` or `.glb` with 3 parts | The Scene list shows the model with 3 parts under it, each with an eye |
| J28 | Click a part, pick Own + layers, then Add a look > Pop art | The part keeps its own colors with halftone dots on top; the other parts do not change |
| J29 | Turn on Outline on a part, Draw with Dots, then Letters with a word | The dots or letters follow that part's outline, also inside folds |
| J30 | 3D > Export > The look (.glb), open it in Blender, Unreal and TouchDesigner | It looks like the RICO view (colors, strokes, outlines) without changing any settings |
| J31 | + Add > Text and comics > 3D text, Add a font... with your TTF | The 3D text uses your font; the font is also in Motion text layers |
| J32 | World > Sky > Gradient, then See-through; Camera and lens > Depth of field | The sky changes; out of focus things blur |
| J33 | Move a layer in Motion, switch workspaces and tabs, press Ctrl+Z | The layer goes back; the tab does not change |
| J34 | Motion: press Ctrl+K | Composition settings open |
| J35 | Motion tool strip > + (your own tool) > Save, then click the picture with it | Eight small shapes appear around the click |
| J36 | 3D: pick a cylinder, Modeling > Deform > Bend, change Amount | The cylinder bends; Ctrl+Z undoes it |
| J37 | 3D: Animating > Physics on a ball raised up, Breaks on another shape, add a Fluid, Play the simulation | The ball falls and rolls, the shape breaks apart, the liquid flows; Reset puts everything back |
| J38 | 3D: click an axis on the ball in the corner, then switch World / Object | The view looks along that axis; the handles turn with the object in Object |
| J39 | 3D: Rendering > Send to Motion > precomp, change its speed in Effect Controls | The 3D scene plays at its own speed in Motion |
| J40 | 3D: Material > Mixed media paper (full color) on an imported model with textures | Crumpled paper scraps with the model's own pictures on them, standing off the surface |
| J41 | Devices > Phone controls: a fader sending to MQTT, UDP and a web address | Each target receives the value |
| J42 | Motion: Hand tool, drag the picture; Zoom tool, click and Alt-click | The picture moves; it zooms in and out at the mouse |
| J43 | 3D: import a model, Material > Pencil sketch | Every part gets the pencil look on top of its own pictures; Its own look brings the file's back |
| J44 | 3D: Pencil sketch, raise Line thickness and Size, then animate Look line thickness on the 3D timeline | The lines get thicker and bigger, and move over time |
| J45 | Mapping: open Masks and Gobos, scroll down | The projection preview stays in view at the top |
| J46 | Two outputs, Gobos, One per projector, then One gobo per mask | A gobo for each projector; then one gobo per mask, each with one mask |
| J47 | Gobos, Lens sticks out, medium, measure your lens and set Lens barrel, Print it | The Print tab opens with that gobo on the bed, plate down, ring on top |
| J48 | Print: printer icon, Klipper, your printer's address, Test | "The printer answered." With a password: Sign in first |
| J49 | Print: Slice, move the layer slider, Send and print | The layers look right; the file shows up on the printer and it starts |
| J50 | Print: USB cable, the COM port, Print over USB | The printer heats and prints; Stop turns the heaters off |
| J51 | Print: Open an STL file, drag it on the bed, Slice, Save G-code | The file opens in another slicer's G-code viewer the same way |
| J52 | Laser: USB cable, the COM port, Frame, then Start cutting on black card | The head moves around the outline; the openings are cut before the edge |
| J54 | Mapping: two surfaces, a mask, Sits on the back surface | The mask darkens the back surface only; the front one stays whole, on the projector too |
| J55 | Pick a surface, the center tool and its corner (Fill, Fit, edges); drag a shape near an edge | It jumps into place; a pink guide shows when it snaps; Alt drags freely |
| J56 | Gobos: a mask like a fish, Exact shape | The opening on the round plate is the fish |
| J57 | Gobos: Over the lens, your lens measured, Snug, print it, slide it on | It goes on with a little push and stays; if too tight add 0.05 mm of room |
| J58 | Gobos: Into the hole, the hole measured, print it | It slides into the hole and stops on the flange |
| J59 | 3D: + in the tool strip, Click in the 3D view, Save, click the floor | A green box where you clicked |
| J60 | 3D: text, Morph into a ball, slide How far | The whole word becomes one round ball |
| J61 | 3D timeline: open an object with a deformer and physics, stopwatches on Bend amount and Bounce | Keys play the bend and change the bounce while the simulation runs |
| J62 | DMX / ArtNet > Lighting desk > 3D and room, Put every fixture in 3D, aim one at a 3D ball, move the ball | The 3D beam and the real moving head both follow the ball |
| J63 | Mapping > Layers: a mask between two surfaces, then on top, then Clip | Between: only the back surface is masked. On top: both. Clip: only the layer right under it |
| J64 | Motion or 3D timeline: stopwatch on a setting, move the playhead, type a new value, again | A key at each time; the arrows jump between them |
| J65 | Click a key, type a new time (frames) and value in the key box; right-click a key, Easy ease | The key moves and changes; the curve eases |
| J66 | Drag a box around keys, Graph, drag a key up | All keys in the box are picked; the value changes |
| J67 | Scroll down a long timeline | The ruler and the playhead stay at the top |
| J68 | 3D: add Physics or Morph from the strip | The property box opens at that part; its settings have keys |
| J69 | Print: Profile, your printer, Slice | The bed size and speeds change; the time is shorter on a fast printer |
| J70 | Print: an STL that hangs over (a T or a table), Support From the bed, Slice | Purple support under the overhang, a layer of air under the part; it snaps off |
| J71 | Print: Others tab, Purge line on, Slice, Send | The printer draws a line at the front left edge first |
| J72 | Print settings: type "retract" in Find a setting | Only the retraction settings show, with the tab name |
| J73 | Print settings: change Wall loops, Save as "Test", change it again, pick "Test" | The pink mark shows changes; the profile brings the saved value back |
| J74 | Print settings: Import a .json or .ini profile from your usual slicer | A message says how many settings were read; layer height, walls and temperatures match |
| J75 | Support: Tree, a table STL, Slice | Branches under the top that merge into trunks, dense layers right under the part |
| J76 | Support: Support critical regions only, a cone that widens slowly and a table | No support on the cone, support under the table top |
| J77 | Support: Add support here, click the part, Slice | A purple box on the bed and support inside it |
| J78 | Others: Brim, Raft; Quality: Ironing; Strength: Gyroid | Each shows in the layer view in its own color |
| J79 | Automation: Robot clears the bed at the end, wait signal osc:/arm/done, Send and print on Klipper | At the end the head moves away, the bed cools, the print pauses; send /arm/done from the Monitor and it goes on |
| J80 | Automation over USB: Wait for a RICO signal at a height | RICO stops sending at that height and goes on when the signal comes |
| J81 | Automation: Print it again 1 time after a signal | When it is done, the signal starts the same file again |
| J82 | Motion timeline: zoom all the way out, then Alt+wheel in | At the smallest zoom the comp reaches the right edge; zooming goes down to frames around the mouse |
| J83 | Motion timeline: grab the playhead in the middle of the lanes and drag; click the time | The playhead follows, frame by frame; the time switches between timecode, frames and seconds |
| J84 | Timeline cog: change the frame rate to 24, then 60 | The ruler and the keys follow; the comp plays at the new rate |
| J85 | Animate a 3D cylinder's morph, fold the object and its Morph group | Folded rows show the keys as dots; open again shows diamonds and the curve |
| J86 | Pick a text layer, Ctrl+Shift+C, double-click the new layer, then Back | The text moves into a precomp with its keys; the layers under it show through; Back returns to the main comp |
| J87 | 3D: a text with Morph into a box, Fluid, play 0 to 1 | It flows like a goo into a clean box, the outline follows the whole way |
| J88 | 3D: the side tab reads View options; + adds Scene as a side tab; switch to icons | Tabs open over the view; icons show instead of words |
| J89 | File > Settings, Interface size: Fit my screen, then My own size 80% | Inside RICO the whole interface shrinks or grows and every button stays on screen |
| J90 | Mapping: click the canvas size, pick 1920 x 1200 | The preview takes that shape and keeps it when the output window changes size |
| J91 | Print: a part with a 60 degree overhang, Support on build plate only | Support under the whole slope |
| J92 | Nodes: As text, change a setting, Apply; paste the node guide into a code helper and ask it for a network | The network changes; lines it writes come back as nodes and wires |
| J93 | Mapping: pick a surface, + Mask, then move the surface up in the list | The mask shows indented under the surface and moves with it |
| J94 | 3D: a tall cylinder, pivot Bottom, Deform bend 1 | It bends from the bottom; pivot Middle bends it from the middle |
| J95 | 3D: pick an object, press D, drag the pink handle, press D, turn the object | It turns around the new point and did not jump when the pivot moved |
| J96 | 3D: Symbiote on a can, move a box next to it, then drag the box away slowly | Tendrils grow only from the side that faces the box, grab on, sag and stretch into a web, snap one by one; drips fall and fade on the floor |
| J99 | 3D: Symbiote on two balls, move them together, then apart | Both reach for each other, the skins rise to meet; pulled apart they rip with drips |
| J100 | Symbiote tab: Veins under the skin on, pick green; Puddles stay | Green veins show through the skin and push it up, they throb; puddles stay on the floor |
| J101 | Symbiote tab: Latch speed 3, Size mix 1, Gravity 0 | Tendrils latch on in a blink, a few thick and many thin, and hang straight |
| J102 | Outline on with floating lines, then a symbiote that holds something | The tendrils get a clean outline, no loose scribbles |
| J97 | Motion, 3D and Mapping tool strips | Pink icons, the picked one is a green box, the 3D stage is a word, the + is small and grey |
| J98 | Print: a tall thin overhang with normal support | Each support piece has a wall loop around it |
| J53 | 3D view: View tab, Ortho, then press 5 | No depth (lines stay parallel), picking and the handles still work; 5 goes back to perspective |

## What I could not test for you

These parts were written for Windows and checked as far as possible
without a Windows PC, so they need your eyes first:

- The new interface inside the RICO window (WebView2): steps A2, A2b, A5, A6. The start screen is drawn by RICO itself until the interface is ready, so if A2 still shows a black window for more than a second, tell me.
- Windows MIDI Services virtual ports: all of C. This API is still changing
  in late 2026, so if C fails, use the `windows-basic` build and send me the
  error text.
- OMT and NDI with real video: D and E.
- The audio stream from RICO's capture into the audio lab, sound
  recording from a real mic, and MIDI notes from a real keyboard: J1 to J4.
- Art-Net and sACN to real fixtures, and finding nodes: J5. Port 6454 can
  only be used by one program at a time for listening; sending always works.
- The interface size inside RICO (WebView2 zoom): J89. In a browser it does nothing; there the browser zoom is used.
- The fluid morph on big imported models (FBX, GLB): J87 was checked with 3D text, a knot and boxes here. Very large models take a moment to start the morph (the shapes are measured once).
- Print settings and automation on a real printer and a real robot arm: J71 and J75 to J81. The G-code and the waits were checked by tests here; pins (`M42`, `M226`, `SET_PIN`), Klipper layer tracking and resuming were not run on machines. Try each rule with nothing on the bed first.
- Sending to a real printer (Klipper, OctoPrint, PrusaLink, USB) and a real laser (USB GRBL, FluidNC Wi-Fi): J48 to J52. The requests and the G-code were checked here, not on machines. Print a small test first.
- A real phone or tablet on your Wi-Fi: J6, J15 and J16 (tilt depends on the browser).
- Real LED controllers, microcontrollers and a Raspberry Pi: J22 to J24. The packets are checked by tests here, the hardware is not.
- The baked look in other apps: J30. It was opened again in a three.js viewer here, not in Blender, Unreal or TouchDesigner. Halftone and hatching are baked on the shape's UVs, so on models with stretched UVs the dots stretch too. Moving looks are saved as one frame.
- Your own models with many parts: J27 to J29 were tested with a small 3-part `.obj`.
- The symbiote on big models and with many things near it: J96, J99 and J100 were checked here with simple shapes in a software view, step by step. On a large model lower Detail or Tendrils first. Turning a symbiote on takes a moment the first time (the skin is built once).
- The pivot on imported models with many parts: J95 was checked with simple shapes.
- Bone posing (3D settings > Pose) needs a model with a skeleton; it was checked in code, not with a real rigged character.
- Simulation was checked here at a low frame rate; on a real graphics card it runs much faster. It is made to look right, not to be exact.

Everything else compiles, and the interface was tested in a browser with
the demo engine.
