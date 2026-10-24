"""Smallest useful OSC reader, shared by the RICO app integrations.

Each integration file has its own copy of these functions so it can be
installed as one file. This copy is the reference and is what the tests use.
"""
import struct


def _string(data, i):
    end = data.index(b"\0", i)
    s = data[i:end].decode("utf-8", "replace")
    return s, (end + 4) & ~3


def parse(data):
    """Returns a list of (address, [values]) from one UDP packet."""
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
        elif t == "h":
            values.append(struct.unpack(">q", data[i:i + 8])[0]); i += 8
        elif t == "s":
            v, i = _string(data, i); values.append(v)
        elif t == "T":
            values.append(1.0)
        elif t == "F":
            values.append(0.0)
    out.append((address, values))
    return out
