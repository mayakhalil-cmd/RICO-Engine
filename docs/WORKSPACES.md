# Working in RICO

This is a tour of the interface: workspaces, routes, nodes, the timeline,
the 3D playground, output windows and projects. Everything here is live:
change something while it runs and you see it right away.

## First steps

**Overview > Welcome** says what RICO is and shows things people make with
it, with buttons that open the right panels. **Help > Take the tour** walks
through every part of RICO in about two minutes (it starts by itself the
first time). Arrow keys go forward and back, Esc stops it.

All text uses two fonts: Courier Prime, and Teletactile for titles and big
numbers.

## Workspaces

The tabs on top are workspaces. Each one is a set of panels.

- **Move panels.** Drag a panel's tab to split the screen, stack it with
  another panel, or float it.
- **Add panels.** Press the **+** at the end of any panel's tabs, or open
  **Window**. Click a group (MIDI, OSC, Motion...) to open it. RICO
  remembers which groups you keep open.
- **Combine workspaces.** Drag a workspace tab down into the panels. All its
  panels come in. This is how you put MIDI, OSC and audio side by side.
- **Close and reopen.** The **x** on a tab hides it. The **+** at the end of
  the tabs brings it back.
- **Make your own.** **+ > New workspace**. Pick panels, or start from a copy.
- **Share.** **File > Export this workspace** saves a `.ricospace` file. Its
  scripts and node networks go inside.
- **Delete all your own.** **Window > Workspace > Delete all my
  workspaces**. The built-in ones stay, and Undo brings yours back.
- **Resize anything.** Drag the line between two panels. Menus that are
  longer than the screen scroll, and open up or down, where there is room.

The built-in workspaces, in order: Overview, MIDI, OSC, Spout, DMX /
ArtNet, Devices, Audio, Motion, 3D, Monitor, Mapping and Output.

**Undo** (Ctrl+Z) undoes your work: adding, deleting, moving things and
changing numbers. Tabs, workspaces and panels are not undone, so Ctrl+Z
never just takes you back to a tab. **Window > Workspace > Reset this layout** puts a workspace's
panels back the way they started.

**Delete or Backspace** removes what is picked: a layer, a 3D object, a
mapping surface or mask (or one mask point), a phone control, an output.
It does nothing while you type in a box.

Every dropdown opens the same menu, like the menus next to the logo: long
lists fold into groups (the group of the current choice starts open), and
the arrow keys still work on a dropdown you clicked.

### The tool strip

Motion, 3D, Mapping and the phone pages have a black **tool strip** along
the top with RICO's own green icons. Hover an icon to read what it is and
its key. An icon with a small corner triangle has more choices: click the
triangle, right-click the icon or hold it. An icon with a small arrow is a
dropdown. The 3D stage (Modeling, Rigging and so on) is written as a word,
so you always see which one you are in. Handles and snapping are pink, the
picked one turns into a green box. The small grey **+** at the end adds
your own tools.

### Snapping and handles

The tool strips of 3D, Motion and Mapping have the handles and snapping:

- **Move / Turn / Size / All** picks which handles show (W, E, R, Q). All
  shows the three at once.
- **Grid**, **Angle** and **Size** are magnets, each with its step from a
  list (0.01 m to 10 m in 3D, 1 to 100 px on pictures, 1 to 90 degrees,
  0.01 to 1 for sizes). Click the magnet to switch it, or hold Ctrl while
  dragging to flip it for that drag.

## Routes

**Window > Routing > Routes.** A route sends one thing to many places.

1. Press **New route**, or drag a knob, an OSC address or an audio band onto
   the Routes panel.
2. **From**: pick the source, or press **Learn** and move the control.
3. **To**: pick OSC, MIDI, DMX or MQTT and where it goes. Press **Send it
   somewhere else too** for more places. Each place has its own range.

In Mappings, **+ More places** makes a route from that control.

## Nodes

Node networks run 60 times a second and keep running when their panel is
closed. Wires carry five kinds of things, each with its own color:

- **numbers** (green)
- **pictures** (cyan, square ports), made on the graphics card
- **shapes** (pink, diamond ports), 3D geometry
- **text** and **lists** (purple, dashed wires)

Numbers, text and lists turn into each other. Pictures only go into
pictures and shapes into shapes; RICO tells you when a wire does not fit.

The network is in **sections**, read left to right: **In** (signals,
timing), **Change** (shaping numbers, logic, data), **Pictures**, **Shapes**
and **Out**. Each family of nodes has its own color and a small tag on its
title. **Tidy** puts every node in its section. **+ Node** (or Tab, or a
double-click) opens the node picker: families on the left, the nodes on
the right, or type to find any node.

- **Double-click** or press **Tab** to add a node.
- Pull a wire from an output (right side) to an input (left side). Drag a
  plugged-in wire off an input to move it.
- Drag the background to move around, scroll to zoom, Shift-drag to select.
- **Del** removes, **Ctrl+D** duplicates, **Ctrl+C / Ctrl+V** copy, **F** frames
  everything.
- **Right-click** the background also opens the node picker, right where
  you clicked.
- **C** makes a note (a comment box). With nodes selected, the note goes
  around them. Type in it, drag its title to move it with the nodes inside,
  drag its corner to size it, and pick its color.
- **Your own sections**: double-click a section name on the canvas to
  rename it, or open **Edit sections** to change names and colors, put them
  in another order, remove one or add your own. **Reset** brings back the
  five sections.

What is in the list (press **Tab** and type to find one):

- **Sources**: Signal, Slider, Number, LFO, Clock, Wander, Time, OSC in,
  MIDI in, Audio.
- **Events**: Button (a bang), On start, Metro, Delay, Line, Random, Branch,
  Sequence, Gate, Select, Key, Print.
- **Shape and Logic**: Range, Smooth, Math, Mix, Flip, Curve, Expression,
  Threshold, Envelope, Toggle, Counter, Sample and hold, On change.
- **Data**: Pack, Unpack, Text, Table, JSON.
- **Pictures**: Noise, Gradient, Shape, Pattern, Shader (your own GLSL), Text,
  Motion picture, 3D picture, Picture in, Level, Color, Blur, Transform,
  Kaleidoscope, Pixelate, Color split, Edges, Threshold, Displace, Composite
  (8 blend modes), Crossfade, Feedback, Analyze, Picture out.
- **Geometry**: Primitive, Math surface, Math solid, Code shape, Displace,
  Twist, Wave, Move shape, Copies, Join shapes, Shape out.
- **Outputs**: OSC out, OSC message, MIDI out, DMX out, DMX fixture, MQTT out,
  UDP out, Serial out, Drive a setting (any Motion or 3D setting), Make a
  signal, Run command, Watch.

**Picture out** gives a picture a name. Use it in Motion with a **Node
picture** layer, or on a 3D object with the **Picture** material. **Shape
out** puts a shape in the 3D scene, where it gets a material, lights and
links.

### Networks as text

**As text** at the top of a network shows it as plain lines, one node a
line:

```
wobble = lfo(rate: 0.5)  @ 120, 80
glow = map(min: 0, max: 2) <- in: wobble.out  @ 320, 80
```

The name, the node type, the settings that differ from the default, where
each input comes from (input: node.output), and where it sits. Change the
lines and press **Apply**, or paste lines a code helper wrote. Anything
RICO cannot read is listed, line by line. **Copy node guide** copies every
node type with its exact inputs, outputs and settings, so a person or a
code helper writing the lines does not have to guess.

### Your own nodes

There are three ways:

1. **Script node.** Name its inputs and outputs (`a, b, pic:tex` makes a
   picture input), write JavaScript, return the outputs. `state` keeps
   values between steps, `t` and `dt` are the time.
2. **Save to My nodes.** Press it on a Script node and it becomes a node
   type of its own, in every network and in `.ricox` files. **Edit code**
   on any copy changes all of them.
3. **Container.** Select nodes and press **Make container** (Ctrl+G). They
   move inside one node; wires that crossed the edge become **Inlets** and
   **Outlets**, its ports. Double-click it to go inside. Containers can hold
   containers.

Developers can also add node types in the code: copy a node in
`ui/src/nodes/basic.ts` and add it to the list. A node is a name, its ports,
its settings and a `run` function.

**Export .ricox** saves the network (or just the selected nodes) as a file,
with the networks inside its containers and the saved nodes it uses.
**Import** drops a `.ricox` into the network you have open.

## Motion: timeline and layers

Motion has a timeline and layers, and it stays
real time: play it live with knobs and audio, or render it out frame by
frame.

The workspace is laid out like a compositing app:

- **The tool strip** (on top): Select (V), Hand (H, drag the picture
  around), Zoom (Z, click to zoom in, Alt-click to zoom out),
  Anchor (Y), Shape (Q, the corner picks rectangle, ellipse, polygon or
  star), Pen (G), Text (Ctrl+T, click where it goes), the handles, the
  snapping magnets, **your own tools**, and on the right composition
  settings, output window and Render.
- **Project** (left): the composition, shown as a folder on its own tab
  (its size, length and frame rate; click it for the finishing effects),
  and its layers with their type. Along the
  bottom: import a picture or video, new solid, text, shape, null and
  adjustment layer, composition settings, duplicate and delete.
- **Composition** (middle): the picture, and under it the size, zoom, safe
  areas, grid, rulers, guides, **Send video**, **Output window**, the frame
  rate and full screen.
- **Effect Controls** (right): the picked layer's settings in groups with
  icons (Layer, Transform, Contents, Masks, Effects). Click a group to open
  or close it; RICO remembers.
- **Effects and Presets** (right, under Effect Controls): every effect by
  group, new layers and ready-made scenes. Type to find one, click to add
  it to the picked layer (or the whole composition).
- **Timeline** (bottom): play, the time, + Layer, + Track, + Cue, the work
  area, the composition settings and **Render**. Switches or modes and the
  zoom are at the bottom.

**Ctrl+K** (or the cog on the timeline) opens **Comp settings** in Motion:
name, size, length, frame rate (12 to 120 fps, 23.976 and 29.97 too),
tempo, how time is shown, snapping, loop and background. Everywhere else
Ctrl+K searches.

### The timeline

- At the smallest zoom the whole comp fits, from 0 to the very end. Zoom
  in down to single frames with the slider at the bottom, the - and +
  next to it, **=** and **-**, or **Alt + mouse wheel** (it zooms around
  the mouse). **;** fits everything again.
- The bar next to the zoom shows the part of the comp you see. Drag it to
  move along, drag its ends to zoom, click outside it to jump there.
- Grab the pink playhead anywhere along its line, not only on the ruler.
  It moves frame by frame.
- Click the time to switch between timecode (0:00:02:11), frames and
  seconds. The ruler follows.
- A folded layer, object or group shows its keys as dots. Open a group to
  see each setting with its keys as diamonds, and the curve between them.

### Precomps

A precomp is a composition used as one layer, like in other compositing
apps.

- **Pre-compose** (Ctrl+Shift+C, or + Layer > Compositions) moves the
  selected layer, with its keys, into a new composition and puts one layer
  showing it in its place.
- **New composition** (Ctrl+N) makes an empty one and opens it.
- Double-click a precomp layer on the timeline to open it. The path at the
  top of the timeline (Main > Precomp) takes you back. The Project panel
  lists every composition: click one to open it, double-click to add it as
  a layer.
- A precomp plays on its own time: it starts with its layer, at its own
  speed and from its own start (in its layer settings). Where nothing is
  drawn it is see-through.

### Editing like a video editor

- **Ripple delete** (Shift+Delete): takes the layer out and moves
  everything after it back, keys too.
- **Close gap** (Alt+Backspace): moves the layers after the playhead back
  to the end of the one before.
- Split at the playhead is Ctrl+Shift+D, and [ and ] move a layer's start
  or end to the playhead.
- Rotoscoping: draw a path mask with the pen, then change its points at
  other times. Each change is a key of the whole path, and the points
  glide between keys.

### Your own tools

Press **+** in the tool strip to make a tool:

1. Give it a name and pick an icon, or press the last icon to use your own
   picture (SVG or PNG).
2. **Click on the picture**: it runs when you click or drag on the
   composition, with `x`, `y` and `phase` ('down', 'drag', 'up').
   **Runs once**: it runs when you press it.
3. Write what it does in JavaScript. `rico.layers()`, `rico.selected()`,
   `rico.add(type, values)`, `rico.solid(color)`, `rico.text(words)`,
   `rico.shape(kind, w, h, x, y)`, `rico.set(id, key, value)`,
   `rico.move(id, x, y)`, `rico.select(id)`, `rico.signal(name)`,
   `rico.time()` and `rico.toast(text)`.
4. **Save**. It sits in the strip. Right-click it to change or delete it.
   **Save as file** makes a `.ricotool` to share; **Open a tool file**
   adds someone's.

### Layers

- **+ Layer** (or the keys): **Solid** (Ctrl+Y), **Text** (Ctrl+Alt+Shift+T),
  **Shape layer** (Ctrl+Alt+Shift+S, or draw one with **Q** on the
  preview), **Null object** (Ctrl+Alt+Shift+Y), **Adjustment layer**
  (Ctrl+Alt+Y), particles, every Motion generator, the 3D scene, a node
  picture, the camera, or a video or picture file.
- Every layer has a **transform**: anchor point, position, scale, rotation,
  opacity. **Parent** a layer to another (a null, usually) and it follows it.
- **Masks**: rectangles, ellipses and paths (draw them with the **Pen**,
  G, on the preview), each with feather, expansion, opacity, invert and
  add, subtract or intersect.
- **Track matte**: alpha or luma, normal or inverted, from the layer above
  or any layer you pick. The matte layer is hidden by itself. An **alpha**
  matte needs a matte with see-through parts (a shape, text, a masked
  layer). For full-frame pictures (a video, a gradient) use **luma**.
- **Layer settings**: **Ctrl+Shift+K**, or double-click the layer's bar in
  the timeline, opens a window with everything about the layer (color,
  size, shape, text, effects, masks...). **Ctrl+Alt+Shift+K** opens the
  scene settings: size, length, frames a second, tempo and background.
- **Shader layer**: **+ Layer > Shader (your GLSL)**. Write GLSL right in the
  layer. You get eight numbers (a to h) and three colors (c1 to c3): key
  them on the timeline, or link them to the audio or a knob so the shader
  reacts live.
- **Rotoscoping**:
  - On video files: draw a path mask (**G**), then press the diamond next to
    **Mask path over time**. Move the playhead, drag the points on the
    preview (Alt drags the whole shape), and each change makes a key. The
    shape glides between keys.
  - Live: the **Background remover (clean plate)** effect. Step out of the
    picture, press **Capture clean plate**, come back: everything that
    differs from the empty scene stays, the rest becomes see-through. It
    works on cameras and on video files. Keep the camera still and the light
    steady.
- **Effects** (34): blur, directional and radial blur, sharpen; color grade,
  curves, LUT, levels, hue and saturation, brightness and contrast, tint,
  black and white, fill, invert, threshold, posterize; wave, turbulent
  displace, twirl, bulge, polar, mirror, kaleidoscope, tile; glow, mosaic,
  RGB split, vignette, grain, find edges, scanlines, drop shadow; chroma key
  and luma key. An adjustment layer's effects
  change everything under it.
- **Blend modes**: Normal, Add, Screen, Multiply, Difference, Overlay, Soft
  light, Hard light, Lighten, Darken, Subtract, Color dodge, Color burn,
  Exclusion, Color, Luminosity.

### The layer row

From the left: show or hide, **solo**, **lock** (green
when locked), the label color (click to change), the layer number, the
twirl arrow, the name (double-click or Enter to rename), then the switches:
**shy**, **fx** (effects on or off), masks, blend mode. **Switches / Modes**
at the top shows track matte and parent instead. The shy button at the top
hides shy layers. Drag the line between the names and the bars to make the
names wider. Drag a row up or down to change the order.

Twirl a layer open to see its properties. Each has a **stopwatch** (click
to animate), a value you drag left and right or click to type, and a link
to make it follow a knob, OSC or the audio.

### The preview


- **Zoom** with the mouse wheel (at the mouse), **.** and **,**,
  **/** for 100%, **Alt+/** to fit. Pan with the wheel, the middle button
  or Space and drag.
- **Rulers** (Ctrl+R): drag from a ruler to make a guide, drag a guide back
  onto the ruler to delete it. **Ctrl+;** shows or hides guides.
- **Title and action safe** (**'**): 10% and 5% margins and the center
  cross. **Ctrl+'** shows a grid. There are also thirds.

### Tools on the picture

**Select** (V): click a layer, then drag inside it to move it (Shift keeps
it straight), drag a corner to size it (Shift keeps its shape), and drag the
knob above it to turn it (Shift: 45 degree steps). The snapping strip next
to the tools picks which of those handles show and snaps them. **W** shows
only the turn handle. **Anchor** (Y) moves the anchor point without moving
the picture. **Shape** (Q) draws a shape layer (press Q again for the next
shape: rectangle, ellipse, polygon, star). **Pen** (G): click points to
draw a mask, click the first point (or Done) to close it.

### Sends and cues

The timeline has three kinds of things, and each looks different: **layers**
(green, with their keyframes), **sends** (blue curves that stream values the
whole time) and **cues** (pink diamonds that fire once). The **Layers /
Sends / Cues** buttons on top hide what you do not need right now; a hidden
cue still shows as a thin line, so you can time things against it.

- **+ Track** adds a curve that sends while the timeline plays: OSC (with
  its own address and range), MIDI CC, DMX or a signal anything in RICO can
  follow. It can also animate any 3D setting. Double-click a send lane to
  add a point, drag points up and down.
- **Cues** (* on the number pad, or + Cue) send OSC, play a MIDI note, run a
  command or hit a signal when the playhead passes them.

### Motion keys

They work after you click in the preview, layers, inspector or timeline, so
letters still type normally in other panels. Change any of them in **Edit >
Keyboard and controls**.

| Keys | What |
| --- | --- |
| Ctrl+D, Ctrl+Shift+D | duplicate layer, split layer at the playhead |
| [ and ], Alt+[ and Alt+] | move the layer to start or end at the playhead, trim it there |
| Ctrl+] / Ctrl+[ (Shift: to top / bottom) | layer order |
| Ctrl+Up / Ctrl+Down | select the layer above / below |
| Ctrl+L, Ctrl+Shift+L | lock, unlock all |
| Ctrl+Alt+F, Ctrl+Alt+Home | fit layer to the scene, center the anchor point |
| Space, Home, End | play, go to start, go to end |
| Page Down / Page Up (Shift: 10) | next / previous frame |
| J / K | previous / next keyframe |
| I / O | go to the layer start / end |
| B / N, Ctrl+Alt+B | work area start / end, clear it |
| P S R T A, Shift+P... | show position, scale, rotation, opacity, anchor (Shift adds) |
| U, U twice | show animated properties, show everything you changed |
| E, M, F | show effects, masks, mask feather |
| Alt+Shift+P / Z / R / T / A | key position / scale / rotation / opacity / anchor |
| F9, Shift+F9, Ctrl+Shift+F9 | easy ease, ease in, ease out |
| Ctrl+Alt+H, Ctrl+Alt+K | hold keys, straight keys |
| Alt+Left / Right (Shift: 10) | nudge selected keys a frame |
| Ctrl+A, Ctrl+Shift+A | select all keys, deselect |
| = / -, ; | zoom the timeline in / out, fit |
| Ctrl+M | render video |
| Ctrl+Shift+K (or double-click the bar), Ctrl+Alt+Shift+K | layer settings, scene settings |
| Ctrl+R, Ctrl+;, ', Ctrl+' | rulers, guides, safe areas, grid |
| . , / Alt+/ | zoom the preview in, out, 100%, fit |
| ` (back quote) | make this panel full size |

Ctrl+K stays the command search, because everything is there.

### Keys, recording and rendering

- **Record.** Turn on **● Rec** and press play. Moving sliders, and every
  setting linked to a knob, OSC or the audio, is written as keys.
- **Easing.** Double-click a key to switch between smooth, straight, slow
  start, slow end and jump.
- **Live or timeline.** Stopped at the very start, Motion runs live. Anywhere
  else, it shows the timeline's time. **■** goes back to live.
- **Render** (Ctrl+M). MP4 renders every frame exactly, even when the scene is
  too heavy to play in real time. WebM records in real time.

Video files are not saved inside scenes. Keep them, and pick them again in
Effect Controls when you open the scene.

## Color grading and LUTs

Add a **Color grade**, **Curves**, **Levels** or **LUT** effect to a layer,
an adjustment layer, or **Finish** (the whole picture).

- **Color grade**: exposure, contrast and pivot, lift, gamma and gain with
  their colors, temperature, tint, saturation, vibrance, shadows and
  highlights.
- **Curves**: master, red, green and blue. Click to add a point, drag it,
  double-click to remove it.
- **LUT**: **Load .cube** (17, 33 or 65 points), and **Save .cube** to use
  the look in your video editor, color tool or OBS.
- **Match a look**: press **Match to a
  picture** and pick a still with the look you want, or **Grab still** now
  and match to it later. RICO makes a LUT that moves the picture's
  brightness and colors to the reference. LUTs save inside projects.

## Audio lab, sound editor and generator

The **Audio** workspace.

How the audio lab looks, and why: the spectrum is the big picture, because
it is what you shape bands on. The numbers under it (level, loudness,
tempo, pitch, stereo, notes) keep a fixed width, so they do not jump while
the sound changes. The bottom part has three tabs, one job each:
**Bands** (what RICO listens for), **Shape the sound** (what RICO hears)
and **What is playing** (speech, music or effects).

- **Audio lab**: listens to the system audio (RICO captures it), a
  microphone or audio interface, a window's sound, the sound editor, or a
  demo beat. The analysis runs on its own thread with an FFT of 1024 to
  16384 points. You get a spectrum with peak hold, a spectrogram or the
  wave, peak and RMS in dBFS, loudness in LUFS (EBU R128, momentary and 3
  s), tempo with a beat, pitch with the note name, brightness, stereo
  correlation and the 12 notes being played.
- **Bands**: drag a band's edges on the spectrum, double-click to add one.
  Each band has its own gain, auto level or fixed floor and top, attack,
  release, curve (how reactive), gate, and **Hits** mode (a pulse on each
  attack). Every band is a signal: drag its name onto any setting. Sets of
  bands: RICO default, DJ, octaves, third octaves (31 bands), drum kit,
  voice. The old names (audio:low, audio:kick...) keep working.
- **Names**: click a band's name to rename it ("Kick", "Singer",
  "Crowd"). The name shows on the spectrum and in every signal list.
- **Shape the sound**: low cut, high cut, three tone controls, a gate for
  the noise floor and a compressor, before the analysis. A yellow line on
  the spectrum shows the shape. With **Listen** on you hear it too, with its
  own volume. Presets: room mic, voice, loud club, kick focus.
- **What is playing**: RICO tells silence, speech, music and foley or
  effects apart, all the time, and you can rename them. Each has a "how
  sure" signal (`audio:is:speech`...) and a level signal (`audio:speech`,
  `audio:music`, `audio:foley`): the level of the sound times how sure it
  is. There is also a real split of the sound into a **harmonic** part
  (held notes, voices, pads) and a **percussive** part (hits, steps,
  doors), as `audio:harmonic` and `audio:percussive`. Tune it with a bias
  for each kind, the silence level and how steady it is.
  It works offline and without an AI model, from how the sound moves:
  speech has syllables about four times a second and short pauses, music
  has a steady beat and held notes, effects are hits and noise without
  either. It says what is playing and how loud each kind is. It does not
  cut a mix into separate files; for that you need the stems.
- **Sound editor** has two views:
  - **Multitrack**: audio tracks and instrument tracks on one timeline in
    bars and beats. Each track has record arm (R), input monitor (I),
    mute, solo, volume, pan, a meter and its own **live effects** (EQ,
    compressor, auto filter, echo in time with the tempo, reverb, drive,
    chorus). Drag clips to move them (also to another track), drag their
    edges to trim, the dots at the top corners to fade. **S** or Ctrl+E
    splits at the playhead, Ctrl+D duplicates, Delete removes. Shift-drag
    on the ruler sets a loop. **Instrument tracks** play a sound from the
    generator: play them with the computer keys (A W S E D F T G Y H U J K,
    Z and X change the octave) or a MIDI keyboard, record what you play,
    and edit the notes in the piano roll. Record a mic onto an armed audio
    track, with its effects in your headphones. **Mixdown WAV** renders
    everything (or the loop).
  - **Waveform**: one sound in detail. Double-click a clip in the
    multitrack to edit it here, then **Put it back in the session**. Select
    with the mouse; cut, copy, paste, delete, keep only the selection,
    silence; gain, normalize, fades, noise gate; reverse, invert, mono,
    swap, speed, bitcrush; low and high cut, EQ bell and shelves,
    compressor, reverb, echo, drive. Undo, and save WAV (24-bit).
- **Audio** (the small panel): every band you made, the tempo, the
  loudness and what is playing, at a glance. Drag any of them onto a
  setting.
- **Sound generator**: kicks, snares, hats, claps, basses, pads, risers,
  impacts, bells and more, each with two oscillators, FM, pitch drop,
  envelope, filter sweep, wobble, drive and space. Play it from the
  keyboard on screen or a MIDI keyboard, and send it to the editor, to the
  session as a clip, or to an instrument track.

## 3D

The **3D** workspace is a small 3D studio. It opens with the 3D view on
the left, and **Scene** and **Object settings** as tabs on the right, the
3D timeline under the view. With nothing picked, that tab is **World
settings**. Drag tabs anywhere to change it.

**Side tabs** on the right edge of the 3D view: **View options** (which
way the handles point, perspective or ortho, look from the front, side or
top). The **+** under them adds any other 3D panel as a side tab (Scene,
Object settings, the 3D timeline), so it opens over the view without
changing the layout, and shows the tabs as words or icons.

**The tool strip** has five stages, like the workspaces of a 3D app. Pick
one from the dropdown at the start of the strip. Each shows its own tools; Select, Move, Turn, Size, All, which way the handles
point and snapping are always there.

- **Modeling**: add shapes (the corner lists them all, 3D text, comic page,
  math and code shapes), editable shapes, import a model, edit points and
  faces (extrude, subdivide, smooth), sculpt (pick the brush in the
  corner), **Deform** (bend, twist, taper, squash and stretch, wave),
  **Morph** (into a ball, a box or another object) and posing bones.
- **Texturing**: give it a look, paint on it, the node space (make
  pictures with nodes and put them on with a Picture material) and Motion
  as a texture.
- **Lighting**: point light, spot light, sun, fog, world settings, bloom.
- **Animating**: the **3D timeline**, put keys where it is now, play,
  physics, fluid, and play, reset or keep the simulation.
- **Rendering**: remember the view, depth of field, export (the baked look,
  shapes only, or shader code), save a picture, and **Send to Motion**.

**The axis ball** in the corner of the view shows which way X, Y and Z
point. Click an axis to look along it. The **View** tab on the right edge
opens the view tools: which way the handles point (**World**, up is always
up, or **Object**, along the object as it is turned), the lens
(**Perspective**, or **Ortho** with no depth, for lining things up), and look
from the front, side, top or **Home** (**Front ortho** and **Top ortho** look
like a drawing). The small **Persp** / **Ortho** button under the axis ball,
the lens button in the tool strip and the **5** key switch it too. Click the
tab again to fold it away.

### Property box

The settings button in the 3D tool strip (or Ctrl+A in the 3D view) opens a
box over the view with everything of the picked object you can change, like
an attribute editor: place, turn and size, deformers, morph, physics and
breaking, liquid, fog and its look. Every setting has a stopwatch and keys.
The deform, morph, physics, liquid, fog and look tools open it at their
part. Drag it by its top.

### Your own 3D tools

The **+** at the end of the 3D tool strip makes a tool of your own, like in
Motion: a name, an icon (or your own picture) and a little JavaScript.
**Runs once** tools run when you press them. **Click in the 3D view** tools
stay picked and run at every click, with the spot you clicked (x, y, z, on
an object or the floor) and the object under it. Esc stops. Right-click a
tool to change it; save it to a file to share it.

### Keyframes (Motion and 3D)

Both timelines key like After Effects. Each setting has a stopwatch (start
or stop animating), its value (drag it or click and type: when it is
animated, that puts a key at the playhead), and the key buttons: the arrows
jump to the key before and after, the diamond adds or removes the key at
the playhead. Click a key to pick it (Shift for more, or drag a box around
keys on an empty part of the lanes). The key box above the lanes shows the
picked key's time in frames and its value in the setting's own units
(pixels, %, degrees, meters), so you can type them, and its ease; with more
keys picked it moves them all. Right-click a key for Easy ease (F9), slow
start, slow end, straight or hold, copy and delete. **Graph** makes the
rows taller with the keys at their values: drag a key up or down to change
it. The ruler stays on top while you scroll down the rows.

### 3D timeline and Motion

The **3D timeline** lists every 3D object. Open one and click a stopwatch
to animate anything with a number, by group: where it is, how it is
turned, its size, spin, glow or light; each deformer (amount, waves,
speed); the morph; physics (bounce, friction, weight, blast); a liquid
(thick or thin); fog (density, clumps, drift, glow); and every layer of
its look (amount, size, speed, line thickness). The same settings in **3D
settings** have a diamond: it puts a key at the playhead, and once a
setting has keys, moving it writes a key. The keys are on the same time line as Motion, so both play
together. **Send to Motion** (Rendering) puts the 3D scene in Motion:

- **As a layer on the same timeline**: it plays exactly as in 3D.
- **As a precomp with its own time**: it starts when the layer starts,
  with its own speed and start point (in the layer's settings), so you can
  move it, stretch it and use it more than once.

### Rigging and deformers

- **Deform** works on any shape, models too: bend, twist, taper, squash and
  stretch, and wave (it moves on its own). Stack them, pick the axis (X, Y,
  Z) and the amount in 3D settings > Deform. Link or animate **Deform
  amount** to move them all with the music or the timeline. Deforms work
  from the object's **pivot**: a tall can with its pivot at the bottom
  bends from the bottom, like a plant, and with the pivot in the middle it
  bends from the middle.
- **Pivot**: the point an object turns, sizes and bends from. Set it in
  Object settings > Pivot (Bottom, Middle, Top, or type it), or press **D**
  (or the anchor in the tool strip) and drag the pink handle in the view.
  Press **D** again when you are done. Moving the pivot does not move the
  object.
- **Symbiote** (the drop in the tool strip, the **Symbiote** tab next to
  Object settings, or Object settings > Deform): the object turns into a
  living alien goo. The **Symbiote** tab has every setting, in groups:
  - **Look**: Wet, Oily (a rainbow film), Flesh (softer) or the object's own
    material; the color, the shine color, gloss, shine at the edges and the
    wet coat.
  - **Veins**: veins under the skin, in two colors you pick. How many, how
    wide, how much they push the skin out, how deep they sit (deep veins
    show softer and darker, like green veins under your skin), glow, how
    strong each beat is and how many beats each second. Thick tendrils carry
    veins too.
  - **Body**: Blob (0 keeps the shape), Alive (the skin crawls and swells),
    crawl speed, lumps and their size, how much it swells toward things near
    it, and breathing.
  - **Tendrils**: only toward things closer than **Reach**, from the side
    that faces them. They shoot out fast one after another: a few thick ones
    and many thin ones (**Size mix**). Set how many for each thing and at
    most, thickness, root size, **Goo** (how soft and uneven the roots melt
    into the skin), strands in each bundle, **Latch speed**, **Lunge** (how
    much they whip on the way) and **Grip** (how wide they spread where they
    hold).
  - **Holding**: **Gravity** (how much they droop) and how much they writhe.
  - **Stretching**: the web (strands pull apart), the thinning in the
    middle, and thin strings that appear.
  - **Snapping**: **Let go** and its mix (they snap one by one), recoil
    speed, curl (the loose end curls up), whip, the last thin strings that
    hold a moment longer and break into drips, and the piece left on the
    other thing.
  - **Drips**: how many, their size and gravity. On a floor they spread
    into puddles that stay, or fade away after a time you set.
  - **Two symbiotes** reach for each other: where one's tendrils land, the
    other's skin rises to meet them. Pull them apart to rip them.
  - **Quality**: the speed of everything, and Detail. Every number with a
    key button can be keyed or linked to the music. **Reset** puts every
    setting back.
- **Morph** melts a shape into a ball, a box, a ring, a can or another
  object (a model from a file too). Animate **Morph** from 0 to 1.
  **Fluid** (the start) rebuilds the surface every frame from both shapes,
  so it can flow, split, join and reach out like a living goo, and ends on
  the exact target shape. **Goo** is how much it reaches out on the way,
  **Spread** how unevenly the change moves across it, **Flow speed** how
  fast the goo moves, **Detail** how smooth it is (more is slower). All of
  them can be keyed. Outlines and looks are drawn on the moving surface, so
  they follow it. **Points** is the older, quicker way: the shape's own
  points slide to the target.
- **Pose**: models with a skeleton (.glb or .fbx) list their bones in 3D
  settings > Pose. Pick a bone and turn it with the rings. Your pose goes
  on top of the model's own animation. Reset one bone or the whole pose.

### Simulation

Light and quick, made for live work:

- **Physics** on a picked object: it falls and bounces, it stays put (others
  bump into it), or it breaks into pieces with a blast. Set bounce,
  friction, weight, pieces and blast in 3D settings > Physics.
- **Fluid**: a block of liquid the size of the object. It flows around
  things with physics. Set the number of drops, their size and how thick it
  is, and whether its box holds it or it spills onto the floor.
- **Play the simulation** (Animating). Everything falls from where you
  built it. The corner has **Reset** (back to the start) and **Keep** (the
  new places become the real ones).

- **+ Add** (in the view or in the Scene list) shapes, lights and fog, or import a model: `.glb` and `.gltf`
  (embedded) whole scenes with their materials, `.fbx` (Maya, Max,
  Mixamo) and `.obj`. Drag it in. Models play their **animations**: pick
  one, set the speed, or link **Animation position** to a knob, the
  timeline or the audio. Turn off "Keep the model's own materials" to give
  it a RICO material. Any object can be **clickable**: clicking it sends
  the signal `3d:click:name`.
- **Model it yourself**: **Tab** (or the Edit button) goes
  into Edit mode. Click points (Shift adds), or switch to Faces. Drag the
  arrows to move them, **E** extrudes the selected faces, **X** deletes,
  **A** selects all. **Subdivide**, **Smooth** and **Flip** are on the bar.
  **+ Add > Editable cube** (sphere, plane, cylinder) starts you off; any
  shape becomes editable when you press Edit. With nothing selected, the
  arrows move, turn and size the whole object.
- **Sculpt**, made for a pen: draw, clay (builds up flat layers), crease
  (cuts a sharp line), inflate, smooth, flatten, pinch, move and snake
  (pulls a tail out along your stroke), with mirror X. **Shift** smooths
  with any brush, **Alt** (or Ctrl) pushes in, [ and ] change the size.
  Pressure changes the size and the strength (each can be turned off).
  **Lazy** makes the brush trail the pen so lines come out smooth, and
  **Spacing** sets how often it dabs. **Move object** lets you place the
  whole object without leaving Sculpt. **More detail** subdivides.
- **Paint**: pick what the brush paints: paint, gloss or matte paint,
  metal, gold leaf, neon (it glows, and blooms with Bloom on), glass (you
  see through it, with refraction), raised bumps, or a **mask** that says
  where a material layer shows. Brushes can have a texture: soft,
  bristles (they turn with your stroke), grain, canvas, dots, or any picture
  you pick. A pen changes size and strength with pressure. Fill, clear and
  eraser are there.
- **Math and code shapes.** A **Math surface** is x, y and z as formulas of
  u and v. A **Math solid** is everywhere a formula of x, y, z is below
  zero (like a signed distance field: `min` joins shapes, `max` cuts them).
  A **Code shape** is JavaScript with `point`, `tri` and `quad`. They can
  move with `t` (time), and **a** and **b** can follow a knob. **Node shape**
  shows a shape from a node network.
- **W** move, **E** turn, **R** size, **F** focus, **Delete**, **Ctrl+D**
  duplicate, **G** grid.
- **Fog volume** (+ Add): a box or ball of fog you place, size and move.
  The sun shines through it and lamps glow inside it; things in it fade
  into it. Set density, clouds, drift, soft edges, thinner higher up, and
  link **Fog density** to the audio.
- **Lights**: type any strength, there is no top. Lights get weaker with
  distance, like real ones, so a far light needs hundreds. **Exposure** in
  the world settings makes everything brighter.
- **Bloom** (world settings) makes glow spread into the air, so the
  **Glow** material and the glow of any object really glow.
- Materials: plastic, iridescent (with your own film colors, bands and
  flow; link **Film color shift** to the music), glass, chrome, wireframe,
  glow, rainbow normals, cartoon (with light steps), and:
  - **My material (layers)**: build your own, like a node material without
    wires. Stack layers: a flat color, a gradient up the object, edges
    (fresnel), noise, stripes, a thin film, a picture, or your painting.
    Each goes into the color, the glow, the roughness or the metal, with a
    blend mode, and only where you want it: everywhere, your painted mask,
    the edges, higher up or noise spots. Start from soap film, hologram,
    lava rock, sunset gradient or painted. Every object with the material
    changes together.
  - **Painterly** (in My material: start from "Painterly" or "Oil paint,
    boiling"): **Painted strokes** layers turn the surface into brush
    strokes. Into **Bumps** they tilt the light stroke by stroke, so it
    breaks into flat dabs like paint on canvas; into **Color** they mix your
    colors per stroke; into **Ragged edge** they cut strokes away at the
    outline. Set the stroke size, length and direction, and how many times
    a second they are redrawn, for a stop-motion painting. Layers marked
    **Reacts** follow the object's **Material drive** link, so the paint can
    move with the music, and a linked **Stroke and outline boil** redraws
    everything on each beat.
  - **Drawn outline** (any shape, on by itself for cartoon): a line on the
    shape and on its sharp edges, and **floating strokes**: loose lines a
    little away from the shape, with a gap, like a sketch over a painting.
    They wobble and "boil" (redrawn a few times a second, like stop
    motion), in your color and width, over everything or behind things.
  - **Picture** puts Motion (or any node picture) on the object, with
    repeat and scroll. Motion becomes the texture and UV editor of your 3D
    objects.
  - **Shader** is your own GLSL. Set `col` from `vUv`, `vNormal`, `vPos`,
    `uTime`, `uA`, `uB` and `uPicture`. Mistakes show under the code.
- **Follows**: any position, rotation, size, glow, color or light strength can
  follow a knob, an OSC address or the audio.
- **Use in Motion** puts the 3D scene in Motion as a layer, so it can be sent
  as video or rendered on the timeline.
- **Export**:
  - **The look (.glb)** bakes what you see (layers, strokes, halftone,
    chrome, paint and the light) into pictures on each shape, and turns
    outlines and strokes into real shapes. It opens in Blender, Unreal,
    Unity, TouchDesigner and Cinema 4D looking like RICO's view, with no
    setup. Pick the picture size (1024, 2048 or 4096). Moving looks are
    saved as they are at that moment.
  - **Shapes only (.glb)**: the plain scene with simple materials.
  - **Shader code (.glsl)**: the look of the picked object's material as one
    GLSL function, to paste into a GLSL TOP or MAT in TouchDesigner or any
    app that takes GLSL.

### Imported models: parts, layers and strokes

A model comes in as a group with its parts, the way it was in its file
(the objects of an `.obj`, the meshes of a `.glb` or `.fbx`). In the
**Scene** list, a model opens like a tree: each part on its own line,
indented under its parent, with its own eye and its triangle count.

Click a part to give it its own settings (or pick it under **Parts** in the
settings). **Every part** sets all parts at once; a part with its own
settings keeps them.

- **Its own**: the look it came with in the file.
- **Own + layers**: its own look stays, and a RICO material is added on top
  of it, like a post process on that part. Add halftone, chrome, strokes,
  paper or watercolor over the colors and textures it came with.
- **Layers only**: only the RICO material.
- **Add a look** starts a new material from any of the looks. **Roughness**,
  **Metal**, **Light steps**, **Tint**,
  **Outline** (lines, dots, letters, floating strokes) and **Normals** work
  per part, and **Shown** hides a part.

### Strokes, dots and letters

The **Drawn outline** follows the real outline of the shape from where you
look, also inside it, so it goes into folds and knots and wraps around the
whole shape. Things in front cover the lines of things behind them (turn
on **Draw over everything** for the old look).

- **Real outline** or **Loose rings** (the older floating rings).
- **Draw with**: lines, **dots** (pop art, set dot size and gap) or
  **letters** (type a word, pick any font and letter size). Each can have its
  own color.

### More looks

The **Material** list opens like the menus next to the logo, in groups:
From the file (models), Simple, Drawn, printed and painted, and Your own.
Picking a look gives the object its own copy of the layers to change below
(**Save as mine** keeps it as one of your materials). On an imported model
the look goes on every part, on top of the pictures it came with; pick a
part in the Scene list to give it something else, or choose **Its own
look** to go back to the file's.

Every look has a **Size** (bigger lines, dots and scraps), and pencil, ink
and print looks have **Line thickness** (dots: **Dot size**). Link or
animate **Look size** and **Look line thickness** on the object (or in the
3D timeline) to move them with the music or over time.

- **Iridescent chrome (animated)**: moving iridescent chrome. Change its
  colors.
- **Pop art (halftone dots)**: comic dots that grow in the shadows.
- **Comic print (colors off register)**: comic printing with the colors a
  little off, and ink lines.
- **Pencil sketch (cross hatching)**: hand drawn lines, crossed more in the
  dark. **Comic book ink** is the same with bold ink.
- **Watercolor**: soft washes with darker edges and paper grain.
- **Mixed media paper** (full color, two colors or one color): the shape
  becomes crumpled paper glued together. The scraps really stand off the
  surface in layers, their top edges lift, the paper has folds the light
  catches, grain and fibers, and torn white edges with a shadow under
  them. Full color keeps the shape's own colors and pictures (a model's
  textures too) and mixes in old photos, newspaper text and your paper
  colors. Set the scrap size, how far they stand off and how crumpled.
  **Boil** re-crumples it a few times a second, like stop motion.

Each is a stack of layers, so mix them: pencil over watercolor, halftone
over chrome.

**Light steps** (on My material and iridescent) cut the light into flat
bands like the cartoon material, from 2 to 8 steps (0 is smooth).
**Roughness** and **Metal** work on every object.

**Normals** (in each object's settings) bend the light on the shape:
rounder, flat facets or a painted wobble. Push them for a painted,
animated comic look.

### 3D text and comic pages

- **+ Add > Text and comics > 3D text**: type it (more lines are fine), pick a
  font, set the size, depth, bevel, letter spacing and alignment.
- **Comic page**: a hollow page with panel windows, tilted gutters and
  depth. Put 3D things inside the panels.
- **Your fonts**: in any font list, **Add a font...** opens a TTF, OTF or
  WOFF. It is kept on this computer and shows in 3D text, Motion text
  layers and letter strokes.

### World settings

Click **World settings** at the top of the Scene list (or in 3D Settings,
or press Esc in the view). Under the main settings, more groups open when
you need them:

- **Sky**: a color, a gradient (top and bottom) or see-through (for
  layering in Motion or sending with alpha).
- **Light from around**: studio, soft or none, its strength and how
  it is turned, plus a fill light from above and below.
- **Color**: tone mapping (Film, Soft film, Neutral, Reinhard, Cineon or
  none), saturation, contrast and warm or cool.
- **Fog**: thicker far away or from near to far (starts at, full at), and
  its own color.
- **Shadows**: on or off, very soft to sharp.
- **Camera and lens**: field of view, nearest and farthest it sees,
  turn around by itself, smooth camera moves, and **depth of field** (focus
  distance, aperture and most blur).
- **Film and lens looks**: dark corners, film grain, color fringe,
  scanlines and big pixels.
- **Time, grid and quality**: time speed, grid size and color, render
  size (lower is faster). **Reset world** goes back to the start.

## Projection mapping

The **Mapping** workspace is one page. The green tool strip on top has the
output, + output, open its window, test pattern, new surface, grid
surface, mask, duplicate, lock, delete, the handles, snapping, and buttons
that open **Mask from a picture**, **3D objects**, **Gobos** and **Edges
and brightness**. Every section is in the column next to the preview, and
the preview stays in view while you scroll, so you always see your edits.
Next to the mapping are two more tabs: **Print** (a small slicer for your
3D printer) and **Laser**.

1. Pick an output (one per projector) and press **Open its window**. Drag the
   window to the projector and double-click it for full screen.
2. **Surfaces**: a **4-corner surface** for flat things, a **grid surface**
   (up to 16 x 16 points) for curved ones. Each takes a picture: Motion, the
   3D camera, any node or script picture, a calibrated projector's view, a
   test pattern or a solid color, with crop, flip, brightness, contrast,
   gamma, hue, soft edge and Add blending.
3. Drag the points on the preview, or press **E** (or **C**) on the
   projector and drag them right there. Arrow keys move the picked point one
   pixel (Shift: 10). Click a surface or a mask to pick it, and a handle
   shows in its middle, like in the 3D view: **W** moves it, **E** turns it
   (Shift snaps to 15 degrees) and **R** sizes it (Shift keeps its shape).
   Turning and sizing happen in output pixels, so a circle stays a circle.
   **Q** shows all three handles. The lock button on a surface or a mask
   keeps it from being moved or deleted by accident.
4. **Layers**: surfaces and masks are one stack, like Photoshop layers. The
   top of the list is in front. A new mask goes under the surface you have
   picked and is clipped to it: it sits indented under that surface, only
   masks that surface, and moves with it when you move the surface in the
   list. Drop a mask on the middle of a surface row to put it under that
   surface. **Clip** off makes it a free mask again, which darkens every
   layer under it (black out light, or inverted, only let it through). Drag a layer in the list to move it, or use
   the arrows. **Mask from a picture** opens right here, under the list.
   **Line up**: the center tool in the strip puts what is picked in the
   middle of the output; its corner has fill, fit (same shape), and against
   the left, right, top or bottom edge. While you drag, shapes and points
   snap to the edges, the middle and other shapes' corners, with a pink
   guide line (the snap button turns it off; Alt drags freely).
5. **Mask from a picture** (in Layers): open a JPEG or PNG of the object (best: taken
   from where the projector stands, with the test pattern on).
   - **Smart select**: click the object. The selection grows over similar
     colors and stops at edges, and fills holes.
   - **Box around it**: drag a box around the object. RICO learns the
     background from the box edge and keeps what is different.
   - **Color wand**: picks one color.
   Shift adds, Alt takes away; Sensitivity, Grow, Shrink and Smooth fine
   tune it. Then **Make projection mask**, or **Mask and gobo**: the mask,
   and a gobo with only this shape on it (see below). If the photo was
   not taken from the projector, **Line up with the projector** lets you
   drag four corners onto the projected picture first. A calibrated
   projector can also make a mask from a 3D object's shape.
6. **Edges and brightness**: soft edges on all four sides with a curve, for
   blending two projectors.


**Canvas size**: the size at the right end of the tool strip is the
projector's picture. Click it to pick a common size, type your own, turn it
to portrait, or let the output window set it. Set it to your projector's
real size, so the picture here has the same shape as on the wall.

### 3D objects

Map a real object from its 3D model.

1. Put the object in the 3D playground at its real size (a `.glb`, or boxes
   and shapes) and give it materials: the **Picture** material puts Motion
   or a node picture on it, by its UVs.
2. In **3D objects**, press **Add point** and click a spot on the model. A
   numbered cross appears on the projector. Drag it onto the same spot of the
   real object.
3. After six points spread around the object, RICO finds the projector's
   place and lens (the error shows in pixels). Pick **3D from Output 1** as a
   surface's picture: the object is now lit by its own content, and it
   moves with any link or animation.

### Gobos

A gobo is a plate in front of the projector lens that blocks the light
everywhere except your shapes, so the grey border and the light leaks of a
projector never reach the wall.

- **One per projector.** Each projector (output) gets its own gobo. **One
  per projector** makes the missing ones; **+ Gobo** adds another, and
  **On** moves a gobo to another projector.
- **What lets light through.** **Each mask is an opening** copies the masks
  you see on that projector, exactly where they are. **Like the projection**
  uses the lit picture (surfaces minus masks).
- **Leave masks out.** The X on a mask takes it off this gobo (it stays in
  the projection). Left out masks wait under the list; click one to put it
  back. **One gobo per mask** splits the gobo, one mask each: five
  projectors, five gobos, one mask on each.
- **Size and place.** **Mask size** sizes every opening; each mask also has
  its own size. Drag a shape on the plate to move it; **Exact** puts it
  back where the projector shows it.
- **Exact shape** (the default): the openings are your masks, plus a tiny
  margin. **Never clip the picture** grows them by half the lens glass, so
  nothing is cut, but the shape gets rounder.
- **How it fits your lens.** A round plate on a sleeve that holds by
  itself, no screws, tape or glue:
  - **Over the lens**, for a lens that sticks out: the sleeve slides over
    the barrel, and a small lip stops it at the front of the lens.
  - **Into the hole**, for a lens set into the case: the sleeve slides into
    the hole, and a flange stops it on the case.
  - **Plate only**, for a stand or tape.
  **Ready fit** is a short list of sizes for small, medium, large and venue
  lenses, and small, medium and large holes (rest the mouse on one to see
  what it is for). Measure across the barrel (or the hole) with a caliper
  and type it in. **Fit** is Tight, Snug or Easy (the room between the
  sleeve and the lens); **Grip ribs** press on the lens so it holds even
  when it is easy. If your printer prints a little fat, add 0.05 mm of
  room. **Length** is how far the plate is from the lens: longer gives
  sharper edges and a bigger plate, shorter a smaller gobo. **Walls** are
  closed (no stray light) or four legs (less filament).
- **Projector**: standard, short or long throw, or the exact throw ratio,
  lens shift and lens glass.
- **Plate**: thickness (1.2 mm by default) and the border around the
  farthest opening. A plate only can also be square, with holes.

Under the plate: the size, the openings, about how much filament it takes,
and how soft the shadow edges are. **Print it** opens the Print tab with
this gobo on the bed, **Laser cut it** the Laser tab. **STL** and **SVG**
save the files. Openings that touch become one.

### Print

A small slicer, in the tab next to Projection mapping. Your gobos are on the
bed already and change with the gobo maker; open STL files too.

1. The printer icon sets up the printer: its size (or pick a common one),
   nozzle and filament, and how RICO reaches it:
   - **Klipper** (the printers you open with Fluidd or Mainsail): its
     address, plus an API key or a sign-in if it has a password. The
     password is not kept, only the sign-in.
   - **OctoPrint** or **PrusaLink**: the address and the API key.
   - **USB cable**: the COM port. RICO sends the lines one by one and checks
     each one, so keep it open while it prints.
   - **Save the file** for the SD card.
   **Profile** has ready settings for many common printers (bed, speeds,
   acceleration, how it is reached).
2. **On the bed**: tick what to print, turn it, flip it (gobos print with
   the plate on the bed), size it, or drag it on the bed. Parts are placed
   for you until you drag them; **Place everything for me** starts again.
3. **Material** (PLA, PETG, ABS) and **Ready settings** (Gobo, Fine,
   Normal, Fast) are a quick start. **Gobo (solid)** is 100% infill: a gobo
   must be solid or light comes through.
4. **Print settings** has everything else, in tabs: Quality, Strength,
   Speed, Support, Others, Filament, Printer and Automation. **Find a
   setting** searches all of them. **Simple** shows the usual ones,
   **Advanced** shows all. A pink mark shows what you changed, and the X
   next to it puts it back. Every printer is different, so save what works
   as a **profile**, switch between them, and **Export** or **Import** them
   as files. Import also reads `.json` and `.ini` profiles from other
   slicers: the settings RICO has are taken over (start G-code
   temperatures too), and it tells you how many it could not use.
5. **Slice**. Look through the layers with the slider (each kind of line
   in its own color), then **Send and print**, **Send only** or **Save
   G-code**. The printer's state, progress and temperatures show under it,
   with pause, go on and cancel.

What the tabs hold:

- **Quality**: layer heights, a line width for each kind of line, seam
  position (nearest, aligned, back, random), X-Y contour and hole
  compensation (for parts that must fit, like a gobo on a lens), elephant
  foot compensation, resolution, ironing (topmost or all top surfaces, with
  flow, spacing and speed), wall order and fuzzy skin.
- **Strength**: wall loops, top and bottom shell layers, top and bottom
  surface patterns (lines, monotonic, concentric), infill density, pattern
  (rectilinear, aligned, grid, triangles, cubic, gyroid, concentric),
  direction and overlap with the walls.
- **Speed**: first layer, slow layers, each kind of line, travel, an
  acceleration for each kind of line, and square corner velocity or jerk.
- **Support**: off, on build plate only, or everywhere. **Normal** or
  **Tree**. Tree support puts a few dense layers under the overhang, then
  branches that lean together, merge into trunks and go around the part.
  **Support critical regions only** keeps just the support a print would
  fail without: parts that start in mid air, and parts that reach out over
  air further than the **Critical reach**. Also the threshold angle, remove
  small overhangs, top and bottom Z distance, XY distance, base pattern and
  spacing, interface layers and spacing, and the tree branch sizes.
  Overhangs are found from the faces of the part as well as from layer to
  layer, so gentle slopes that lean past the threshold get support too.
  **Support wall loops** draws a wall around each piece of normal support,
  so tall thin ones stand firm (0 turns it off).
  **Your own supports**: pick **Add support here** or **Block support
  here** and click the part on the bed. A box appears there: support boxes
  add support even where the settings would put none, block boxes keep it
  out. Drag a box on the bed, or type its size and heights. **Only in my
  support boxes** prints support nowhere else.
- **Others**: the purge line (left or front edge, length, thickness),
  skirt (loops, distance, height), brim (outer only, or also inside holes,
  width, gap), raft (layers, expansion, gap), spiral vase, and filament
  changes at heights.
- **Filament**: first layer and other layer temperatures, flow ratio,
  pressure advance, max volumetric speed, shrinkage, density and price (the
  cost shows after slicing), and cooling (no fan for the first layers, full
  fan at a layer, normal and most fan, slowing down small layers so they
  cool).
- **Printer**: G-code flavor (Marlin, Klipper, RepRapFirmware), Z offset,
  hot end flow (lines that need more plastic than the hot end melts are
  slowed down), retraction (length, speeds, extra on restart, travel
  threshold, on layer change, Z hop, wipe), and the start, end, layer
  change, pause and filament change G-code. In those, `{nozzle}`, `{bed}`,
  `{width}`, `{depth}`, `{layer}`, `{z}` and `{total}` are filled in.
- **Automation**: rules that run steps at moments of the print (the start,
  every layer, every few layers, a layer, a height, the end). Steps: send a
  RICO signal (and an OSC message), wait for a RICO signal, move the head
  away (it comes back after), wait for the bed to cool, set a printer pin,
  wait for a printer pin, pause, filament change, wait some seconds, home,
  or your own G-code. **Print it again** repeats the print, after a signal
  if you pick one.

#### Robots and automation

Made for a robot arm that works with the printer, like taking the part off
the bed when it is done or putting in a magnet halfway. **Add a rule** has
ready ones: **Robot clears the bed at the end**, **Robot puts something in
at a height**, **Robot on a printer pin**, **Photo every layer** and **Color
change at a layer**.

- A **signal** step becomes the RICO signal `Print: <name>`, which goes to
  0 then 1 then 0. Link it in a route to your arm (OSC, MQTT, serial or a
  script). Type an OSC address to also send it straight out.
- **Wait for a RICO signal** holds the print until the signal you pick goes
  above half: a button, a fader, or `osc:/arm/done` coming from the arm.
  Give up after a time if you like, then go on or stop the print.
- **Set a printer pin** and **Wait for a printer pin** are for a robot
  wired to the printer board. Marlin: `M42` and `M226` with the pin
  number. Klipper: `SET_PIN` with the name of an `[output_pin]` from your
  printer config; Klipper cannot wait for a pin, so the print pauses there
  and goes on when you (or a `[gcode_button]` that runs `RESUME`) resume it.
- How RICO follows the print: on Klipper it reads the layer (RICO writes
  `SET_PRINT_STATS_INFO` into the G-code) and sees pauses. Over USB it
  sees every line as it is sent, and holds the lines while it waits. On
  OctoPrint and PrusaLink it only sees the start, pauses and the end.
- The automation box under the print shows what it waits for and what it
  did. RICO must stay open for signal and wait steps. Steps that are only
  G-code (pins, cooling, moving the head) also work when you print from
  the SD card.

The purge line always comes after your start G-code, and RICO sets the
extruder to relative mode first, because some start macros leave it in
absolute mode and then the line does not print.

### Laser

Cut gobo plates (or any SVG) on a laser. The laser icon sets up how RICO
reaches it: **USB cable** for GRBL lasers, **Wi-Fi** for FluidNC boards, or
**Save the file**. Pick a material (a start; test on your laser), power,
speed and passes, and where the cut starts (the laser's 0,0 or where the
head is). Inside shapes are cut first, so the plate never drops out before
its openings are done. **Frame** moves around the outline with the laser
off, so you can see where it lands. Only the plate of a gobo is cut; the
legs and rings are for printing.

A plate near the lens can not cut a sharp line: every point of the picture
leaves the whole lens glass, so shadow edges are soft. RICO shows how soft,
and grows the openings so your picture is never clipped. The further the
plate is from the lens, the sharper the edge.

## LEDs and hardware

**Output > LEDs and hardware** sends to anything on your network or on USB.
Press **+ Output** and pick your hardware:

- **LED strips and walls** (pixels from Motion or any picture): WLED on an
  ESP32 or ESP8266 (DDP), Art-Net and sACN pixel controllers (more LEDs go
  on the next universes), an Arduino or ESP over USB (Adalight), a Raspberry
  Pi with a strip (plain colors over UDP), Fadecandy and Open Pixel Control.
  Pick a strip, a grid (with zigzag wiring, in rows or columns) or a ring,
  drag across the picture to place it, and set the color order, RGBW,
  brightness and gamma. The LEDs show live next to the picture.
- **Values to hardware and apps** (any RICO signal): a Raspberry Pi over
  OSC, a microcontroller over USB or Wi-Fi (lines like `fader1:0.42`), MQTT,
  web addresses (HTTP GET or POST), WebSockets and TCP. Send one line per
  value, JSON, CSV or bytes, scaled, only when something changes.

Each preset comes with starter code to copy or save: a FastLED sketch for
Arduino, Python for a Raspberry Pi LED strip, Python with OSC for LEDs,
servos and relays on a Pi, and sketches for microcontrollers on USB and
Wi-Fi. **Send once** tests an output while it is off.

## Video out

**Spout > Video out**: what to send (Motion, the 3D camera, or any node or
script picture), frames a second and size, then Spout (apps on this
computer) and network video (OMT, or NDI with its plugin).

## Lighting desk

**DMX / ArtNet > Lighting desk**: fixtures instead of channel numbers.

- **Patch**: pick a fixture type (dimmer, RGB, RGBW, LED pars of 6, 7 and 8
  channels, moving head spot and wash, pixel bar, strobe, fog), how many,
  the universe and the first address. RICO puts them one after the other
  and makes a group. Clashes show in pink. **+ My own fixture type** builds
  a type from the fixture's manual, one channel at a time.
- **Control**: click fixtures in the row on top (Shift adds) or a group,
  then set intensity, color (white, amber and UV are mixed for you), pan
  and tilt on a pad, strobe, zoom, gobo and more. **Clear** forgets what you
  set by hand.
- **Effects**: intensity waves, color chases, circles and pan or tilt
  waves, in time with the BPM (or **From audio**) or at their own speed,
  with a spread across the fixtures.
- **Cues**: **Store what you see as a cue**, give it a fade time, and press
  **GO**. A cue also remembers which effects run.
- **Links**: intensity, color, pan, tilt, strobe or zoom follow any signal
  (the audio, a knob, OSC, a phone control, the timeline).
- **Output**: Art-Net (to one node or to everyone) or sACN (E1.31), any
  number of universes, up to 44 times a second, and **Find Art-Net nodes**.
  The monitor shows the 512 channels of each universe. Master and
  **Blackout** are always on top.
- **3D and room**: every fixture can have a twin in the 3D scene, a light
  with a head and a visible beam that plays exactly what the desk sends
  (color, intensity, zoom, strobe, pan and tilt). Build and check the show
  on screen, with or without the real fixtures. Put the twins where the
  real fixtures hang, in meters, and say if they hang or stand and how far
  they pan and tilt. **Aims at** turns a fixture toward a 3D object, the
  real one too: animate the object, link it to a signal (a phone, OSC from
  a tracker) or drag it, and the heads follow it in the room.

## Phone and tablet controls

**Devices > Phone controls** (or **Window > Control > Phone controls**).
The green strip on top has the page, new phone and tablet pages, one icon
for each thing you can add, the phone or tablet shape, upright or
sideways, try it here, delete, the page name and its grid.

Each control can send to any protocol: a RICO signal (anything in RICO can
follow it), OSC to your outputs, **OSC to any app or device** (host, port,
address), MIDI CC or note, DMX (Art-Net or sACN), **MQTT**, **UDP text**
and **web addresses** (HTTP, for WLED and other devices), or the lighting
desk GO. In UDP and web addresses, `{value}` becomes the number and
`{name}` the control's name.
Make a **Phone page** or a **Tablet page** (Upright or Sideways), then
place things on its grid. Drag to move them, drag a corner to make them
bigger, click one to change it.

What you can add:

- **Move**: fader, slider (sideways fader), knob, endless knob (turns
  forever), XY pad, range (two handles, a low and a high value),
  crossfader (A and B, double tap goes back to the middle), color picker
  (sends the color and its strength).
- **Press**: button, toggle, pad grid (up to 8 x 8; each pad sends to the
  next note, CC, DMX channel, signal name or OSC address), choice (one of
  a few options).
- **Time and motion**: step sequencer (up to 32 steps with play and tempo
  on the device), tap tempo, tilt (the motion sensor of the phone or
  tablet: left and right, forward and back).
- **Design**: title, text, and image or logo (PNG, JPEG, WebP, SVG).

Every control has a color, a solid or outline look, a text color and
size, and can hide its name. Buttons and toggles can show an icon. The
**Page design** tab sets the background color or picture (fill or whole,
and how dark), the space between controls and how round the corners are.
Pictures are made small before they are sent, so the page stays fast.

Each control sends OSC, a MIDI CC or note, a DMX channel, the lighting
desk's GO, or a RICO signal (`phone:name`) that anything can follow.
**Try it here** tests it on the computer.

To use it on a device, press **Allow devices on this network** and scan
the QR code. The device opens RICO's own page: nothing to install, and
nothing leaves your network. The device and the computer must be on the
same Wi-Fi. Tilt needs the browser's permission, and some browsers only
share the motion sensor on secure (https) pages, so it may not work on
every device.

## MIDI rules, monitor and clock

**MIDI > MIDI rules and monitor**.

- **Rules** translate MIDI, like a MIDI translator: when a message matches
  (type, channel, number range, or **Learn**), shape its value (input and
  output range, curve, flip) and send it on as a MIDI note, CC or program
  (on another channel, transposed or fixed), OSC (`{n}` is the number, `{c}`
  the channel, `{i}` the copy), DMX or a signal. **Copies** sends one
  message as many: one knob to ten OSC addresses or ten lights.
- **Monitor**: every message with filters by type and channel, hex or
  decimal, pause, and messages a second.
- **Clock and test**: MIDI clock out at any BPM (timed by RICO itself), a CC
  slider, program change, a keyboard, and panic (all notes off).

## Other devices and live share

In **Output > Outputs and sharing**, turn on **Let devices on this network
open RICO**. Open the address (or scan the code) on a tablet, a phone or a
laptop. With **Live share** on, every screen sees the same Motion scene,
routes, node networks and 3D scene.

Only turn this on in networks you trust. Windows may ask to let RICO through
the firewall the first time.

## Projects

**File > Save the whole project** keeps everything in one `.ricoproject`
file: the scene and its timeline, routes, node networks, scripts, the 3D scene
and your workspaces. **File > Starter projects** has ready-made ones to learn
from.

## Shortcuts and colors

**Edit > Keyboard and controls** gives any command a key, or a control: a pad,
a knob, an OSC button, even the kick drum. **View > Colors** changes the
colors.

**Interface size** (File > Settings, Look and feel): **Fit my screen** sizes
all of RICO to the window it is in, so every panel and button fits and
stays readable. **My own size** sets it yourself, from 50% to 200%. In a
plain web browser, use the browser's own zoom (Ctrl + and -).

**Hover help**: rest the mouse on a button or a **?** to see what it does.
The longer explanations have a **Read more** link to these pages.

## Performance

Hover over the **fps** counter at the top right. It shows what is using the
most: which Motion layers, the picture size, sending video, busy panels,
scripts and memory, with a tip for each one.
