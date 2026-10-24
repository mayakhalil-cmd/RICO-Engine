# Scripts

A script is a small JavaScript program that lives in a panel. Use one when
you need a protocol RICO does not have: a show controller on UDP, a
projector on TCP, a Pi Pico on a COM port, an app that wants OSC with five
values in one message.

Scripts run while their panel is open. When you export a workspace, its
scripts go inside the `.ricospace` file, so the person you send it to gets
the whole setup.

## Make one

- **Window > Scripts > New: ...** picks a starting point and opens it.
- Or press **Ctrl+K** and type `script`.
- Or press the **+** next to any panel's tabs and pick one under
  "New script".

Press **Code** to see the code, change it, then **Save and run** (or
**Ctrl+Enter**). Click the name to rename it. **Export** saves just the
script as a `.ricoscript` file. File > Open brings one back.

## What a script can do

Everything goes through two objects: `rico` and `ui`.

### Send and receive

```js
// OSC to the main app and every extra destination, like a mapping does
rico.osc.send('/light/intensity', 0.8)

// OSC to any app, with as many values as you like (numbers and text)
rico.osc.sendTo('127.0.0.1', 9000, '/color', 1, 0.2, 0.6)

// OSC coming in to RICO (port 9000 by default). '*' means every address,
// '/game/*' means every address that starts with /game/
rico.osc.on('/fader/1', (value, address) => rico.log(address, value))

// MIDI out, and MIDI coming in
rico.midi.cc(1, 74, 0.5)          // channel, number, value 0 to 1 (or 0 to 127)
rico.midi.note(10, 36, 100)       // channel, note, velocity (0 is note off)
rico.midi.send([0xB0, 74, 64])    // raw bytes
rico.midi.on((m) => rico.log(m.type, m.channel, m.number, m.value))

// UDP: listen on a port, send to any computer
rico.udp.listen(7000, (text, bytes, from) => rico.log(from, text))
rico.udp.send('192.168.1.20', 7000, 'PLAY 1')
rico.udp.send('192.168.1.20', 7000, [0x01, 0x02, 0xFF])

// TCP: connect to a device and talk to it
const pj = rico.tcp.connect('192.168.1.50', 4352, (text) => rico.log(text))
pj.send('%1POWR 1\r')

// Serial (USB boards like the Pi Pico or an Arduino)
const ports = await rico.serial.list()          // ['COM3', 'COM4']
const pico = rico.serial.open('COM3', 115200, (text) => rico.log(text))
pico.send('L128\n')

// Lights and devices
rico.dmx.set(1, 0.5)                 // channel 1 to 512, value 0 to 1
rico.mqtt.publish('room/light', 'on')
```

### Read and make signals

Signals are every moving value RICO knows: knobs, OSC addresses, the audio
bands, the clock.

```js
rico.audio().low                // also level, mid, high, kick, snare
rico.read('midi:1:1:74')        // a mapping, by its key
rico.read('osc:/my/address')    // the last value of an OSC address
rico.read('clock:beat')         // 0 to 1 every beat at 120 BPM

// Make your own signal. It shows up in Motion under "Script", in Learn,
// and in the shortcut settings, like any knob.
rico.signal('Bass wobble', 0.7)
```

Every slider and toggle a script makes is a signal too.

### Time

```js
rico.every(100, () => { ... })        // every 100 ms
rico.after(2000, () => { ... })       // once, after 2 seconds
rico.frame((dt, time) => { ... })     // every screen frame, dt in seconds
rico.log('anything', 1, { a: 2 })     // prints under the controls
```

### Controls

```js
ui.title('My device')
const status = ui.label('Waiting...')        // status.set('Connected')
const speed = ui.slider('Speed', { min: 0, max: 10, value: 2 }, (v) => { ... })
speed.value                                   // read it any time
ui.button('Go', () => { ... })
const on = ui.toggle('Enabled', true, (on) => { ... })
const host = ui.text('Host', '192.168.1.20', (v) => { ... })
const level = ui.meter('Level')              // level.set(0.5)
const ctx = ui.canvas(160)                    // a 2D canvas, 600 wide; sharp at any size
const pad = ui.canvas(200, (p) => { ... })    // p.x and p.y from 0 to 1, p.type is down, move or up
const mode = ui.select('Mode', ['A', 'B'], 'A', (v) => { ... })
ui.row(() => { ui.button('A', a); ui.button('B', b) })   // side by side
```

### Make a picture

A script can draw a picture that the rest of RICO uses: a **Node picture**
layer in Motion, the **Picture** material on a 3D object, or a **Picture in**
node.

```js
const pic = rico.picture('My picture', 1280, 720)
rico.frame((dt, t) => {
  pic.ctx.fillStyle = `hsl(${t * 40}, 80%, 50%)`
  pic.ctx.fillRect(0, 0, pic.width, pic.height)
  pic.show()                                  // tell RICO it changed
})
```

## Stress test

**+ > New script > Stress test: Euclid engine** (also in
`docs/examples/euclid-engine.js`) pushes a script hard. Four rhythm tracks
send MIDI notes, OSC with four values, a 16 channel DMX chase, signals and a
picture, all at once. It listens for UDP commands on port 7400, OSC on
`/euclid/bpm` and MIDI CC 1 to 4. **Loopback self test** sends UDP to itself
and prints how long it took. Turn up **Flood** to send hundreds of extra OSC
messages a second and watch the numbers at the bottom: clock jitter,
messages a second and drawing time.

## When the script stops

Closing the panel, pressing Stop or running it again stops the script. RICO
then closes the ports it opened and clears its timers, so you don't need to
clean up. If you start something RICO does not know about, return a function
and RICO calls it when the script stops:

```js
const id = setInterval(tick, 50)
return () => clearInterval(id)
```

## Good to know

- Errors show in yellow under the controls with the line that failed.
- Ports a script opens belong to that script. Two scripts can't listen on
  the same UDP port.
- Scripts run inside RICO's interface with the same rights as RICO. Only run
  scripts from people you trust, the same as any program.
- In demo mode (the interface without the app) UDP sent to 127.0.0.1 comes
  straight back to the script, so you can try a script without a device.
