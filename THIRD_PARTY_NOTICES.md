# Third party notices

RICO is MIT licensed. It is built with the open source projects below. Their
licenses are kept next to their code in `third_party/`, or in the package
they come from.

## In this repository

| Project | Used for | License | Where |
| --- | --- | --- | --- |
| Dear ImGui 1.92 | Classic interface | MIT | `third_party/imgui/LICENSE.txt` |
| RtMidi | Classic Windows MIDI | MIT style (RtMidi license) | `third_party/rtmidi/LICENSE` |
| oscpack | OSC | MIT style (oscpack license) | `third_party/oscpack/LICENSE` |
| Spout 2 (SpoutDX) | Sharing video between apps | BSD 2-Clause | `third_party/spout2/LICENSE` |
| miniaudio | Audio capture | Public domain or MIT No Attribution | header of `third_party/miniaudio/miniaudio.h` |
| stb_image | Loading pictures | Public domain or MIT | end of `third_party/stb/stb_image.h` |
| PFFFT | Audio analysis (FFT) | FFTPACK license (BSD style) | header of `third_party/pffft/pffft.c` |
| libomt header | Open Media Transport | MIT | `third_party/libomt/LICENSE.txt` |
| NDI SDK headers | Building the optional NDI plugin | MIT, per file | top of each file in `plugins/ndi/ndi-sdk/` |
| OpenDyslexic | Easier to read font | SIL Open Font License 1.1 | `assets/fonts/OFL.txt` |

## Downloaded while building

| Project | Used for | License |
| --- | --- | --- |
| Eclipse Paho MQTT C and C++ | MQTT | Eclipse Public License 2.0 or Eclipse Distribution License 1.0 (BSD) |
| nlohmann/json | Settings and the interface bridge | MIT |
| Microsoft WebView2 SDK | Showing the interface | BSD 3-Clause (WebView2 SDK license) |
| Windows MIDI Services App SDK | Virtual MIDI ports | MIT |
| C++/WinRT | Windows MIDI Services headers | MIT |
| Open Media Transport (libomt, libvmx) | Network video | MIT |
| Courier Prime | Interface font | SIL Open Font License 1.1 |

The interface itself is built with open source web tools listed in
`ui/package.json`: React, dockview (panels), three.js (3D playground),
mp4-muxer (video files) and qrcode (sharing codes), among others. All of them
use the MIT license.

## Not included

- **NDI runtime.** RICO never ships NDI binaries. The NDI plugin loads the
  runtime that the user installs from ndi.video. NDI(R) is a registered
  trademark of Vizrt NDI AB.
- **Teletactile font** by heaven castro, for titles. Freeware for personal and
  commercial use (FontSpace: https://www.fontspace.com/teletactile-font-f44368).
  RICO ships it in `ui/public/fonts/Teletactile.ttf`.