"""Checks the OSC reader against packets built the way oscpack builds them.

Run: python integrations/test_osc_min.py
"""
import struct
import unittest

from osc_min import parse


def pad(b):
    b += b"\0"
    return b + b"\0" * ((4 - len(b) % 4) % 4)


def message(address, *args):
    tags = ","
    body = b""
    for a in args:
        if isinstance(a, bool):
            tags += "T" if a else "F"
        elif isinstance(a, int):
            tags += "i"; body += struct.pack(">i", a)
        elif isinstance(a, float):
            tags += "f"; body += struct.pack(">f", a)
        elif isinstance(a, str):
            tags += "s"; body += pad(a.encode())
    return pad(address.encode()) + pad(tags.encode()) + body


class Tests(unittest.TestCase):
    def test_float(self):
        self.assertAlmostEqual(parse(message("/maya/pCube1/translateY", 0.25))[0][1][0], 0.25)

    def test_int_and_bool(self):
        addr, vals = parse(message("/game/trigger", 1, True))[0]
        self.assertEqual(addr, "/game/trigger")
        self.assertEqual(vals, [1, 1.0])

    def test_lengths_on_word_edges(self):
        for a in ["/a", "/abc", "/abcd", "/abcdefg"]:
            self.assertEqual(parse(message(a, 1.0))[0][0], a)

    def test_bundle(self):
        m1, m2 = message("/a", 1.0), message("/b", 2.0)
        bundle = pad(b"#bundle") + struct.pack(">q", 1) + struct.pack(">i", len(m1)) + m1 + struct.pack(">i", len(m2)) + m2
        self.assertEqual([a for a, _ in parse(bundle)], ["/a", "/b"])

    def test_string(self):
        self.assertEqual(parse(message("/t", "hi", 3))[0][1], ["hi", 3])


if __name__ == "__main__":
    unittest.main()
