# RICO for Houdini
#
# Receives OSC from RICO and sets parameters:
#
#   /houdini/<node path>/<parm>    e.g. /houdini/obj/geo1/tx
#
# Run from Windows > Python Shell:
#   exec(open(r"C:\path\to\RICO\integrations\houdini\rico_houdini.py").read())
#   rico_start()          # port 9020, the one RICO's Houdini setup uses
#   rico_stop()
#
# For MIDI, you don't need this file: make a virtual port in RICO and pick it
# in a MIDI In CHOP.
#
# MIT License, part of RICO.

import socket
import struct
import threading

import hou
import hdefereval

_rico = {"sock": None, "thread": None, "running": False}


def _string(data, i):
    end = data.index(b"\0", i)
    return data[i:end].decode("utf-8", "replace"), (end + 4) & ~3


def rico_parse(data):
    out = []
    if data.startswith(b"#bundle\0"):
        i = 16
        while i + 4 <= len(data):
            (size,) = struct.unpack(">i", data[i:i + 4])
            out += rico_parse(data[i + 4:i + 4 + size])
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


def rico_target(address):
    """'/houdini/obj/geo1/tx' -> ('/obj/geo1', 'tx'), or None."""
    parts = [p for p in address.split("/") if p]
    if len(parts) < 3 or parts[0] != "houdini":
        return None
    return "/" + "/".join(parts[1:-1]), parts[-1]


def _apply(path, parm, value):
    node = hou.node(path)
    p = node.parm(parm) if node else None
    if p is not None:
        try:
            p.set(value)
        except hou.PermissionError:
            pass  # locked or driven by an expression


def _listen():
    sock = _rico["sock"]
    while _rico["running"]:
        try:
            data, _addr = sock.recvfrom(65535)
        except socket.timeout:
            continue
        except OSError:
            break
        latest = {}
        for address, values in rico_parse(data):
            target = rico_target(address)
            if target and values and isinstance(values[0], (int, float)):
                latest[target] = float(values[0])
        for (path, parm), value in latest.items():
            hdefereval.executeDeferred(lambda a=path, b=parm, v=value: _apply(a, b, v))


def rico_start(port=9020):
    if _rico["running"]:
        print("RICO is already listening.")
        return
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(("0.0.0.0", port))
    sock.settimeout(0.25)
    _rico.update(sock=sock, running=True)
    t = threading.Thread(target=_listen, name="rico-osc", daemon=True)
    _rico["thread"] = t
    t.start()
    print("RICO: listening for OSC on port %d" % port)


def rico_stop():
    _rico["running"] = False
    if _rico["thread"] is not None:
        _rico["thread"].join(1.0)
    if _rico["sock"] is not None:
        _rico["sock"].close()
    _rico.update(sock=None, thread=None)
    print("RICO: stopped")
