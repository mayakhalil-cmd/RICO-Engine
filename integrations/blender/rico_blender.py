# RICO for Blender
#
# Receives OSC from RICO and moves things in your scene.
#
#   /blender/<Object>/<property>          sets a value, e.g. /blender/Cube/scale
#   /blender/<Object>/<property>/<index>  sets one part, e.g. /blender/Cube/location/2
#   /blender/<Object>/data/<property>     reaches into the object's data,
#                                         e.g. /blender/Sun/data/energy
#   anything else                         is stored on the scene as a custom
#                                         property, ready for drivers
#
# Install: Edit > Preferences > Add-ons > Install from Disk, pick this file.
# Then in the 3D viewport press N, open the RICO tab and press Start.
#
# MIT License, part of RICO.

bl_info = {
    "name": "RICO",
    "author": "Maya Khalil",
    "version": (1, 0, 0),
    "blender": (3, 6, 0),
    "location": "View3D > Sidebar > RICO",
    "description": "Live control from RICO over OSC",
    "category": "System",
}

import socket
import struct

import bpy

_sock = None
_last = {}


# ---- OSC reading (same as integrations/osc_min.py) ------------------------

def _string(data, i):
    end = data.index(b"\0", i)
    return data[i:end].decode("utf-8", "replace"), (end + 4) & ~3


def parse(data):
    out = []
    if data.startswith(b"#bundle\0"):
        i = 16
        while i + 4 <= len(data):
            (size,) = struct.unpack(">i", data[i:i + 4])
            out += parse(data[i + 4:i + 4 + size])
            i += 4 + size
        return out
    address, i = _string(data, 0)
    if i >= len(data):
        return [(address, [])]
    tags, i = _string(data, i)
    values = []
    for t in tags[1:]:
        if t == "f":
            values.append(struct.unpack(">f", data[i:i + 4])[0]); i += 4
        elif t == "i":
            values.append(struct.unpack(">i", data[i:i + 4])[0]); i += 4
        elif t == "d":
            values.append(struct.unpack(">d", data[i:i + 8])[0]); i += 8
        elif t == "s":
            v, i = _string(data, i); values.append(v)
        elif t == "T":
            values.append(1.0)
        elif t == "F":
            values.append(0.0)
    out.append((address, values))
    return out


# ---- applying values -------------------------------------------------------

def apply(address, value):
    parts = [p for p in address.split("/") if p]
    scene = bpy.context.scene
    if len(parts) >= 3 and parts[0] == "blender":
        target = bpy.data.objects.get(parts[1])
        path = parts[2:]
        index = None
        if path and path[-1].isdigit():
            index = int(path.pop())
        try:
            # Walk nested properties, e.g. Sun/data/energy -> obj.data.energy
            for name in path[:-1]:
                target = getattr(target, name)
            prop = path[-1]
            if target is not None:
                current = getattr(target, prop)
                if index is not None:
                    current[index] = value
                elif hasattr(current, "__len__"):
                    for k in range(len(current)):
                        current[k] = value
                else:
                    setattr(target, prop, value)
                return
        except (AttributeError, TypeError, IndexError):
            pass
    # Anything else is kept on the scene for drivers:
    # scene["rico"]["game/light"]
    key = "/".join(parts)
    store = scene.get("rico")
    if store is None:
        scene["rico"] = {}
        store = scene["rico"]
    store[key] = float(value)


def _poll():
    if _sock is None:
        return None
    changed = False
    for _ in range(256):
        try:
            data, _addr = _sock.recvfrom(65535)
        except BlockingIOError:
            break
        except OSError:
            break
        for address, values in parse(data):
            if values and isinstance(values[0], (int, float)):
                _last[address] = float(values[0])
                apply(address, float(values[0]))
                changed = True
    if changed:
        for area in bpy.context.screen.areas if bpy.context.screen else []:
            if area.type == "VIEW_3D":
                area.tag_redraw()
    return 1 / 60


# ---- UI ---------------------------------------------------------------------

class RICO_OT_start(bpy.types.Operator):
    bl_idname = "rico.start"
    bl_label = "Start listening"

    def execute(self, context):
        global _sock
        if _sock is None:
            port = context.scene.rico_port
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            try:
                s.bind(("0.0.0.0", port))
            except OSError:
                self.report({"ERROR"}, f"Port {port} is in use. Pick another one in RICO and here.")
                return {"CANCELLED"}
            s.setblocking(False)
            _sock = s
            bpy.app.timers.register(_poll, persistent=True)
        return {"FINISHED"}


class RICO_OT_stop(bpy.types.Operator):
    bl_idname = "rico.stop"
    bl_label = "Stop"

    def execute(self, context):
        global _sock
        if _sock is not None:
            _sock.close()
            _sock = None
        return {"FINISHED"}


class RICO_PT_panel(bpy.types.Panel):
    bl_label = "RICO"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "RICO"

    def draw(self, context):
        col = self.layout.column()
        col.prop(context.scene, "rico_port")
        if _sock is None:
            col.operator("rico.start")
        else:
            col.operator("rico.stop")
            col.label(text=f"Listening on {context.scene.rico_port}")
            for address, value in list(_last.items())[-8:]:
                col.label(text=f"{address}  {value:.3f}")


classes = (RICO_OT_start, RICO_OT_stop, RICO_PT_panel)


def register():
    bpy.types.Scene.rico_port = bpy.props.IntProperty(name="Port", default=9010, min=1024, max=65535)
    for c in classes:
        bpy.utils.register_class(c)


def unregister():
    global _sock
    if _sock is not None:
        _sock.close()
        _sock = None
    for c in reversed(classes):
        bpy.utils.unregister_class(c)
    del bpy.types.Scene.rico_port
