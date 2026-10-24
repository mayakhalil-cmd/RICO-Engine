# RICO for Maya
#
# Receives OSC from RICO and sets attributes:
#
#   /maya/<node>/<attribute>     e.g. /maya/pCube1/translateY
#
# Run in the Script Editor (Python tab):
#   import rico_maya
#   rico_maya.start()           # port 9030, the one RICO's Maya setup uses
#   rico_maya.stop()
#
# Values are applied on Maya's main thread, so undo and Auto Key work as usual.
#
# MIT License, part of RICO.

import socket
import struct
import threading

import maya.cmds as cmds
import maya.utils

_sock = None
_thread = None
_running = False


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


def plug_for(address):
    """'/maya/pCube1/translateY' -> 'pCube1.translateY', or None."""
    parts = [p for p in address.split("/") if p]
    if len(parts) < 3 or parts[0] != "maya":
        return None
    return parts[1] + "." + ".".join(parts[2:])


def _set(plug, value):
    try:
        if cmds.objExists(plug):
            cmds.setAttr(plug, value)
    except RuntimeError:
        pass  # locked or connected attribute


def _listen():
    while _running:
        try:
            data, _addr = _sock.recvfrom(65535)
        except socket.timeout:
            continue
        except OSError:
            break
        latest = {}
        for address, values in parse(data):
            plug = plug_for(address)
            if plug and values and isinstance(values[0], (int, float)):
                latest[plug] = float(values[0])
        for plug, value in latest.items():
            maya.utils.executeDeferred(_set, plug, value)


def start(port=9030):
    global _sock, _thread, _running
    if _running:
        print("RICO is already listening.")
        return
    _sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    _sock.bind(("0.0.0.0", port))
    _sock.settimeout(0.25)
    _running = True
    _thread = threading.Thread(target=_listen, name="rico-osc", daemon=True)
    _thread.start()
    print("RICO: listening for OSC on port %d" % port)


def stop():
    global _running, _sock
    _running = False
    if _thread is not None:
        _thread.join(1.0)
    if _sock is not None:
        _sock.close()
        _sock = None
    print("RICO: stopped")
