# Integrations

Small, single-file scripts for apps that don't read OSC by themselves.
Each one listens for OSC from RICO and sets values in the app. They have no
dependencies, so you can copy them anywhere.

| App | File | Default port | Address |
| --- | --- | --- | --- |
| Blender 3.6 and newer | `blender/rico_blender.py` | 9010 | `/blender/<Object>/<property>[/<index>]` |
| Autodesk Maya | `maya/rico_maya.py` | 9030 | `/maya/<node>/<attribute>` |
| Houdini | `houdini/rico_houdini.py` | 9020 | `/houdini/<node path>/<parm>` |

Unreal Engine, Unity and TouchDesigner read OSC themselves, so they don't
need a script. The steps for every app are in RICO under Home, "Use RICO with".

`osc_min.py` is the shared OSC reader the scripts copy, and
`test_osc_min.py` tests it: `python integrations/test_osc_min.py`.
