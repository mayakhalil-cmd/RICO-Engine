"""Builds the RICO app icons.

The letters are drawn from a pixel grid traced from the Teletactile
wordmark, so the icons stay sharp at every size. If assets/fonts/Teletactile.ttf
exists, pass --font to render the large sizes with the real font instead.

Usage:
    python tools/make_icons.py            # writes assets/icons/
Needs Pillow (pip install pillow).
"""
import argparse
import os
from PIL import Image, ImageDraw, ImageFont

GLYPHS = {
    'R': [
        "#########..",
        "##########.",
        "##.....####",
        "##.......##",
        "##.......##",
        "##......###",
        "##########.",
        "#########..",
        "##....###..",
        "##.....###.",
        "##......###",
        "##.......##",
    ],
    'I': [
        "######",
        "######",
        "..##..",
        "..##..",
        "..##..",
        "..##..",
        "..##..",
        "..##..",
        "..##..",
        "..##..",
        "######",
        "######",
    ],
    'C': [
        ".#########",
        "##########",
        "###.....##",
        "##.......#",
        "##........",
        "##........",
        "##........",
        "##........",
        "##.......#",
        "###.....##",
        "##########",
        ".#########",
    ],
    'O': [
        ".#########.",
        "###########",
        "###.....###",
        "##.......##",
        "##.......##",
        "##.......##",
        "##.......##",
        "##.......##",
        "##.......##",
        "###.....###",
        "###########",
        ".#########.",
    ],
    '_': [
        "..........",
        "..........",
        "..........",
        "..........",
        "..........",
        "..........",
        "..........",
        "..........",
        "..........",
        "..........",
        "##########",
        "##########",
    ],
}

BLACK = (0, 0, 0, 255)
LIME = (59, 255, 3, 255)
PINK = (248, 32, 160, 255)
BLUE = (0, 44, 248, 255)
WHITE = (255, 255, 255, 255)


def coarse(glyph):
    """Halves a glyph (2x2 cells become one) for the tiniest icon sizes."""
    out = []
    for r in range(0, len(glyph), 2):
        line = ""
        for c in range(0, len(glyph[0]), 2):
            block = [glyph[rr][cc] for rr in (r, r + 1) for cc in (c, c + 1)
                     if rr < len(glyph) and cc < len(glyph[0])]
            line += "#" if block.count("#") >= 2 else "."
        out.append(line)
    return out


def word_bitmap(word, gap=3, tiny=False):
    """Rows of a word, letters separated by gap cells."""
    glyphs = [coarse(GLYPHS[ch]) if tiny else GLYPHS[ch] for ch in word]
    rows = [""] * len(glyphs[0])
    for i, g in enumerate(glyphs):
        for r in range(len(g)):
            rows[r] += g[r] + ("." * gap if i < len(glyphs) - 1 else "")
    return rows


def draw_bitmap(img, rows, x0, y0, cell, color, cursor_color=None, cursor_from=None):
    d = ImageDraw.Draw(img)
    for r, line in enumerate(rows):
        for c, ch in enumerate(line):
            if ch != "#":
                continue
            col = cursor_color if cursor_from is not None and c >= cursor_from and cursor_color else color
            # Edges snap to whole pixels so neighbouring cells always touch.
            xa, xb = round(x0 + c * cell), round(x0 + (c + 1) * cell) - 1
            ya, yb = round(y0 + r * cell), round(y0 + (r + 1) * cell) - 1
            if xb >= xa and yb >= ya:
                d.rectangle([xa, ya, xb, yb], fill=col)


def tile(size, bg, radius_ratio=0.18):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = round(size * radius_ratio)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=bg)
    return img


def place(size, rows, fill_ratio):
    """Cell size and origin so the word fills fill_ratio of the tile, on whole pixels when small."""
    w, h = len(rows[0]), len(rows)
    cell = size * fill_ratio * 0.82 / w   # a little room on the sides
    if size <= 24:
        cell = max(1, round(cell))
    x0 = (size - cell * w) / 2
    y0 = (size - cell * h) / 2
    return cell, round(x0), round(y0)


def cursor_col(word, gap=3, tiny=False):
    """First column of the underscore in a word."""
    col = 0
    for ch in word:
        if ch == "_":
            return col
        col += len(coarse(GLYPHS[ch])[0] if tiny else GLYPHS[ch][0]) + gap
    return None


def make(style, size):
    small = size <= 48
    tiny = size <= 24
    word = "R_" if small else "RICO_"
    gap = 1 if tiny else (2 if small else 3)
    rows = word_bitmap(word, gap, tiny)
    cur = cursor_col(word, gap, tiny)

    if style == "terminal":
        img = tile(size, BLACK)
        cell, x0, y0 = place(size, rows, 0.84 if small else 0.72)
        draw_bitmap(img, rows, x0, y0, cell, WHITE, LIME, cur)
    elif style == "lime":
        img = tile(size, LIME)
        cell, x0, y0 = place(size, rows, 0.8 if small else 0.72)
        draw_bitmap(img, rows, x0, y0, cell, BLACK, None, None)
    elif style == "chroma":
        img = tile(size, BLACK)
        cell, x0, y0 = place(size, rows, 0.72 if small else 0.68)
        off = max(1, round(cell * (0.6 if small else 0.9)))
        draw_bitmap(img, rows, x0 - off, y0, cell, BLUE)
        draw_bitmap(img, rows, x0 + off, y0, cell, PINK)
        draw_bitmap(img, rows, x0, y0, cell, WHITE, LIME, cur)
    elif style == "outline":
        img = tile(size, BLACK)
        cell, x0, y0 = place(size, rows, 0.72 if small else 0.66)
        off = max(1, round(cell * 1.0))
        # outline layer: draw the word, then knock out its inside
        outline = Image.new("RGBA", img.size, (0, 0, 0, 0))
        draw_bitmap(outline, rows, x0 + off, y0 + off, cell, WHITE)
        stroke = max(1, round(cell * 0.35))
        from PIL import ImageFilter
        mask = outline.split()[3].filter(ImageFilter.MinFilter(stroke * 2 + 1))
        outline.paste((0, 0, 0, 0), mask=mask)
        img.alpha_composite(outline)
        draw_bitmap(img, rows, x0, y0, cell, LIME if small else WHITE, LIME, cur)
    else:
        raise ValueError(style)

    # faint scanlines on the large sizes, like the app
    if size >= 128 and style in ("terminal", "chroma", "outline"):
        lines = Image.new("RGBA", img.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(lines)
        step = max(3, size // 64)
        for y in range(0, size, step):
            d.line([(0, y), (size, y)], fill=(59, 255, 3, 10))
        mask = img.split()[3]
        img = Image.alpha_composite(img, Image.composite(lines, Image.new("RGBA", img.size, (0, 0, 0, 0)), mask))
    return img


SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
STYLES = ["terminal", "lime", "chroma", "outline"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "assets", "icons"))
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    for style in STYLES:
        frames = [make(style, s) for s in SIZES]
        frames[-1].save(os.path.join(args.out, f"rico-{style}.ico"), sizes=[(s, s) for s in SIZES], append_images=frames[:-1])
        make(style, 1024).save(os.path.join(args.out, f"rico-{style}-1024.png"))
        make(style, 512).save(os.path.join(args.out, f"rico-{style}-512.png"))
        make(style, 32).save(os.path.join(args.out, f"rico-{style}-32.png"))
        print("wrote", style)


if __name__ == "__main__":
    main()
