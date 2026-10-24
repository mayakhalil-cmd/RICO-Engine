# Building RICO

This guide goes from a fresh Windows PC to a RICO folder you can copy to a
USB stick.

## 1. Install the tools (once)

1. **Visual Studio 2022** (Community is free). In the installer, pick
   **Desktop development with C++**. Make sure "Windows 11 SDK" and "C++ CMake
   tools for Windows" are ticked on the right.
2. **Git.** In PowerShell:
   ```powershell
   winget install --id Git.Git -e
   ```
   Close and open PowerShell again after this.
3. **Node.js** (for the interface):
   ```powershell
   winget install --id OpenJS.NodeJS.LTS -e
   ```
4. **vcpkg** (gets the C++ libraries for you):
   ```powershell
   git clone https://github.com/microsoft/vcpkg C:\vcpkg
   C:\vcpkg\bootstrap-vcpkg.bat
   setx VCPKG_ROOT C:\vcpkg
   ```
   Close and open PowerShell again so `VCPKG_ROOT` is known.

## 2. Build

Open **Developer PowerShell for VS 2022** (from the Start menu) and run:

```powershell
cd path\to\RICO
cmake --preset windows
cmake --build --preset release
```

The first build takes a while. vcpkg compiles MQTT and the other libraries,
CMake downloads Open Media Transport and Windows MIDI Services, and the
interface is built. Later builds are fast.

When it finishes, everything is in `build\RICO\`:

```
build\RICO\
  RICO.exe
  libomt.dll, libvmx.dll      Open Media Transport
  ui\                         the interface
  plugins\rico-ndi.dll        the NDI plugin
  assets\                     fonts
  LICENSE.txt, THIRD_PARTY_NOTICES.md
```

Copy that folder anywhere. On first start RICO makes a `data` folder next to
`RICO.exe` for its settings.

### With Visual Studio instead of the command line

File, Open, Folder, and pick the RICO folder. Visual Studio reads
`CMakePresets.json` by itself. Pick the **windows** preset and the
**RICO.exe** target, then press F5.

## 3. Options

| Option | Default | What it does |
| --- | --- | --- |
| `RICO_WITH_WINDOWS_MIDI` | ON | Virtual MIDI ports. Turn off if that part fails to build. |
| `RICO_WITH_WEBVIEW` | ON | The new interface. Off means classic only. |
| `RICO_BUILD_NDI_PLUGIN` | ON | Builds `plugins\rico-ndi.dll`. It needs no NDI files to build. |
| `RICO_BUILD_UI` | ON | Builds the interface with npm. |
| `RICO_OMT_DIR` | empty | A folder with `libomt.dll` and `libvmx.dll`, for building offline. |

The **windows-basic** preset builds without Windows MIDI Services:

```powershell
cmake --preset windows-basic
cmake --build --preset basic
```

## 4. The title font

Titles use Teletactile, the font of the RICO logo (free for personal and
commercial use). It is already in `ui\public\fonts\Teletactile.ttf`. All
other text uses Courier Prime.

## 5. Starting RICO

| Command | Result |
| --- | --- |
| `RICO.exe` | New interface (or classic, if you picked classic last time) |
| `RICO.exe --classic` | Classic interface |
| `RICO.exe --web` | New interface, even if classic was picked last time |
| `RICO.exe --allow-network` | Lets a tablet or phone on your network open the interface at `http://<this PC>:47900` |

## 6. Working on the interface

The interface can run in a normal browser while you design it:

```powershell
cd ui
npm install
npm run dev
```

Open the address it prints. If RICO is running, the page connects to it. If
not, it shows a demo with moving data, so every screen can be tried.

## When something goes wrong

**vcpkg fails with "Operation REMOVE_DUPLICATES not recognized"**
Visual Studio's own copy of vcpkg is being used, and it is too old. RICO's
`cmake/vcpkg-toolchain.cmake` prefers `C:\vcpkg`, so clone vcpkg there (step
1.4). If yours is somewhere else, run `setx RICO_VCPKG_ROOT D:\path\to\vcpkg`
and restart Visual Studio.

**"Could not find a package configuration file provided by PahoMqttCpp"**
vcpkg isn't being used. Check that `VCPKG_ROOT` is set (`echo $env:VCPKG_ROOT`)
and delete the `build` folder before trying again.

**"Could not get the Windows MIDI Services SDK" (a warning)**
RICO tries a few versions of the package from NuGet, because Microsoft takes
older preview versions down now and then. When none of them can be
downloaded, the build still finishes, only without virtual MIDI ports. To add
them, copy a package folder you already have to
`packages\Microsoft.Windows.Devices.Midi2.<version>\` inside the RICO folder,
or set the version that is on NuGet now with `-DRICO_WINMIDI_VERSION=...`.

**The Windows MIDI Services step fails** (download or cppwinrt errors)
Use the `windows-basic` preset. RICO works the same, just without virtual
ports. Windows MIDI Services is still changing quickly, so its version is a
setting: `-DRICO_WINMIDI_VERSION=...`.

**"npm was not found"**
Install Node.js (step 1.3) and open a new PowerShell. Without npm, RICO only
has the classic interface.

**OMT download fails** (no internet)
Download `OpenMediaTransport.Binaries.Release.v1.0.0.19.zip` from
github.com/openmediatransport/libomtnet/releases on another computer, unzip
it, and pass `-DRICO_OMT_DIR=<that folder>\Libraries\Winx64`.

**The start screen stays, or says "The interface could not start"**
Run `npm run build` in the `ui` folder again, then build RICO again so the
new `ui` folder is copied next to RICO.exe. The message on screen says what
went wrong. `RICO.exe --classic` always opens the classic interface.

**The window opens with the classic interface**
The new interface needs the `ui` folder next to RICO.exe and the WebView2
runtime. The message log in the classic interface (MIDI tab) says which one
is missing. Get WebView2 from Microsoft if your PC doesn't have it.
