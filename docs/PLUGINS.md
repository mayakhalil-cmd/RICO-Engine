# RICO plugins

A plugin is a DLL in the `plugins` folder next to RICO.exe. Its file name
starts with `rico-` (for example `rico-ndi.dll`). RICO loads every plugin it
finds when it starts, and again when you press "Look for plugins again" in
Video.

Right now plugins can add a **video transport**: a way to send and receive
video over the network. OMT is built in with the same interface, and NDI is a
plugin, so `plugins/ndi/rico_ndi.cpp` is a complete example.

## Why plain C

The API in `include/rico/plugin_api.h` is plain C with no RICO headers and no
C++ types crossing the DLL edge. You can build a plugin with any compiler,
even a different Visual Studio version than RICO's, and it keeps working.

## The two functions

```c
#include "rico/plugin_api.h"

RICO_PLUGIN_EXPORT const RicoPluginInfo* rico_plugin_info(void);
RICO_PLUGIN_EXPORT const RicoVideoTransportApi* rico_plugin_video_transport(void);
```

`rico_plugin_info` says who you are:

```c
static const RicoPluginInfo info = {
    RICO_PLUGIN_API_VERSION,
    "mytransport",               // id, lowercase, unique
    "My Transport",              // name shown in RICO
    "1.0.0",
    "One sentence about it.",
    "https://example.com"        // where people get what it needs, or NULL
};
```

`rico_plugin_video_transport` returns a table of functions. All of them are
called from RICO's main thread, one at a time.

| Function | Called when | Return |
| --- | --- | --- |
| `is_available()` | Often, to show the status | 1 if it can run on this PC |
| `status_text()` | With `is_available` | A short sentence a person can act on |
| `start()` / `stop()` | Picked / unpicked, or RICO closing | 1 on success |
| `sender_open(name)` | "Start sending" | 1 on success |
| `sender_send(frame)` | Every frame while sending | 1 on success |
| `sender_close()` | "Stop sending" | |
| `find_sources(buf, size)` | "Find sources" | Number of sources; names in `buf`, one per line |
| `receiver_open(name)` | "Connect" | 1 on success |
| `receiver_poll(cb, user)` | Every frame while receiving | 1 if a frame was handed to `cb` |
| `receiver_close()` | "Disconnect" | |

Frames are always 8-bit BGRA in normal memory, top row first. A received
frame only has to stay valid while your callback runs.

## Rules that keep RICO healthy

- **Never crash when your runtime is missing.** Load it with `LoadLibrary`
  inside `start()`, not by linking to it, and explain what to install in
  `status_text()`. This is how RICO stays installable without NDI.
- **Don't block.** `receiver_poll` should return right away if there is no
  new frame. `find_sources` may wait about a second at most.
- **Don't ship other people's binaries** in the plugin unless their license
  allows it.

## Building

Copy `plugins/ndi` to `plugins/yours`, rename things, and add
`add_subdirectory(plugins/yours)` to the main `CMakeLists.txt`. The output
goes to `build\RICO\plugins\` automatically.
