# Contributing

Thank you for wanting to help with RICO.

## Before you start

- For a bug, open an issue with what you did, what you expected, and what
  happened. A screenshot of Monitor helps a lot.
- For a bigger change, open an issue first so we can talk about it.

## Setting up

Follow [docs/BUILDING.md](docs/BUILDING.md). For interface work you only need
Node.js: `cd ui`, `npm install`, `npm run dev`. The demo engine lets you try
every screen without RICO running.

## How the code is laid out

- The engine (`app/`) owns all devices and protocols. It runs on one main
  thread, plus the threads that MIDI, OSC and audio libraries call back on.
- The interface (`ui/`) never talks to devices. It sends commands to the
  engine over a local WebSocket (`app/src/web/Bridge.cpp`) and draws the
  state the engine sends back. A new feature usually means a new command in
  `Bridge.cpp` and a screen in `ui/src/sections/`.
- Plugins use the plain C API in `include/rico/plugin_api.h`.

## Style

- C++20, four spaces, braces on the same line.
- Interface text is plain and short, in sentence case. Say what a button
  does ("Start sending"), and when something fails, say how to fix it.
- Keep it working offline. No fonts, scripts or images from the internet.

## License

RICO is under the GNU Affero General Public License, version 3 or later
(see [LICENSE](LICENSE)). By contributing you agree that:

- your work is released under that license, and you have the right to
  release it (it is your own, or under a license that allows it);
- Maya Khalil may also release your contribution under other open source
  licenses in the future, so the project can change license as a whole.

Add a line `Signed-off-by: Your Name <your email>` to each commit
(`git commit -s` does it) to say you agree.
