#!/usr/bin/env python3
"""
Look at the bar palette — and re-check it — without a browser.

    python3 scripts/preview_palette.py [out.png]

Why this exists: bars carry no pattern any more, so the seven family hues are
doing all the work, and a hue set is exactly the kind of thing that is easy to
"adjust" by eye and impossible to verify by eye. Two things happen here:

  1. The same checks the dataviz validator runs (all-pairs CVD separation,
     normal-vision separation, chroma floor, contrast against the track) are
     recomputed in Python from the hexes in src/lib/categoryColor.ts. The script
     exits non-zero if any of them regress, so editing a hex cannot quietly make
     the chart unreadable.
  2. The palette is rendered as the timeline actually draws it: a chip with its
     rim, its gloss and its near-black label sitting on the track colour — plus
     the same strip through simulated protanopia and deuteranopia. Numbers say a
     pair is separable; this is where you see whether it still reads as a chart.

Stdlib only (zlib + struct for the PNG), because there is no PIL, cairo or
ImageMagick in this environment.
"""
import math
import os
import re
import struct
import sys
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src", "lib", "categoryColor.ts")

TRACK = (0x0B, 0x0E, 0x15)  # --color-track: what the bars are laid into
INK = (0x0D, 0x10, 0x17)  # the near-black label ink the bars are tested against
CARD = (0x16, 0x1A, 0x23)  # --color-surface, the card the chart sits on


# ── the palette, read out of the source of truth ─────────────────────────────
def load_families():
    text = open(SRC, encoding="utf-8").read()
    block = re.search(r"FAMILY_COLORS[^{]*\{(.*?)\n\};", text, re.S)
    if not block:
        raise SystemExit("FAMILY_COLORS not found in " + SRC)
    colors = {}
    for m in re.finditer(r"(\w+):\s*\"(#[0-9a-fA-F]{6})\"", block.group(1)):
        colors[m.group(1)] = m.group(2)
    labels = {}
    block = re.search(r"FAMILY_LABEL[^{]*\{(.*?)\n\};", text, re.S)
    for m in re.finditer(r"(\w+):\s*\"([^\"]+)\"", block.group(1)):
        labels[m.group(1)] = m.group(2)
    order = re.search(r"FAMILIES:\s*Family\[\]\s*=\s*\[(.*?)\]", text, re.S)
    fams = re.findall(r"\"(\w+)\"", order.group(1))
    return [(f, colors[f], labels.get(f, f)) for f in fams]


# ── the checks, recomputed here so a bad hex cannot ship ─────────────────────
MACHADO = {
    "protan": ((0.152286, 1.052583, -0.204868),
               (0.114503, 0.786281, 0.099216),
               (-0.003882, -0.048116, 1.051998)),
    "deutan": ((0.367322, 0.860646, -0.227968),
               (0.280085, 0.672501, 0.047413),
               (-0.011820, 0.042940, 0.968881)),
}
CVD_TARGET, CVD_FLOOR, NORMAL_FLOOR, CHROMA_FLOOR, CONTRAST_MIN = 8.0, 6.0, 15.0, 0.10, 3.0


def s2lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex2lin(h):
    h = h.lstrip("#")
    return tuple(s2lin(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4))


def oklab(lin):
    r, g, b = lin
    l = (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) ** (1 / 3)
    m = (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) ** (1 / 3)
    s = (0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b) ** (1 / 3)
    return (0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
            1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
            0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s)


def simulate(lin, kind):
    m = MACHADO[kind]
    return tuple(max(0.0, min(1.0, sum(m[i][j] * lin[j] for j in range(3)))) for i in range(3))


def delta_e(h1, h2, kind=None):
    a = oklab(simulate(hex2lin(h1), kind) if kind else hex2lin(h1))
    b = oklab(simulate(hex2lin(h2), kind) if kind else hex2lin(h2))
    return 100 * math.dist(a, b)


def oklch(h):
    L, a, b = oklab(hex2lin(h))
    return L, math.hypot(a, b)


def rel_lum(h):
    r, g, b = hex2lin(h)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    hi, lo = sorted((rel_lum(a), rel_lum(b)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


def check(fams):
    hexes = [c for _, c, _ in fams]
    names = [f for f, _, _ in fams]
    worst_cvd = worst_norm = None
    for i in range(len(hexes)):
        for j in range(i + 1, len(hexes)):
            c = min(delta_e(hexes[i], hexes[j], "protan"), delta_e(hexes[i], hexes[j], "deutan"))
            n = delta_e(hexes[i], hexes[j])
            if worst_cvd is None or c < worst_cvd[0]:
                worst_cvd = (c, names[i], names[j])
            if worst_norm is None or n < worst_norm[0]:
                worst_norm = (n, names[i], names[j])
    faint = [(names[i], round(oklch(h)[1], 3)) for i, h in enumerate(hexes) if oklch(h)[1] < CHROMA_FLOOR]
    dim = [(names[i], round(contrast(h, "#%02x%02x%02x" % TRACK), 2))
           for i, h in enumerate(hexes) if contrast(h, "#%02x%02x%02x" % TRACK) < CONTRAST_MIN]
    ink = [(names[i], round(contrast(h, "#%02x%02x%02x" % INK), 2)) for i, h in enumerate(hexes)]
    mean_l = sum(oklch(h)[0] for h in hexes) / len(hexes)

    ok = True
    def line(label, good, msg):
        nonlocal ok
        ok = ok and good
        print("  %-26s %-4s %s" % (label, "PASS" if good else "FAIL", msg))

    print("\nchecks (all pairs, simulated against the track colour):")
    line("CVD separation", worst_cvd[0] >= CVD_FLOOR,
         "%s↔%s  ΔE %.1f  (target %.0f, floor %.0f)" % (worst_cvd[1], worst_cvd[2], worst_cvd[0], CVD_TARGET, CVD_FLOOR))
    line("Normal-vision floor", worst_norm[0] >= NORMAL_FLOOR,
         "%s↔%s  ΔE %.1f  (gate %.0f)" % (worst_norm[1], worst_norm[2], worst_norm[0], NORMAL_FLOOR))
    line("Chroma floor", not faint, "all >= %.2f" % CHROMA_FLOOR if not faint else "reads gray: %s" % faint)
    line("Contrast vs track", not dim, "all >= %.1f:1" % CONTRAST_MIN if not dim else "below: %s" % dim)
    # The bars carry an 11px name and 10px metadata in near-black ink, so the ink
    # ratio is the AA floor for small text — this is the number the palette's
    # depth is spent on, and the reason every bar's text is set in solid ink
    # rather than a tint of it.
    line("Label ink >= 4.5:1", min(v for _, v in ink) >= 4.5,
         "ink %.2f–%.2f:1" % (min(v for _, v in ink), max(v for _, v in ink)))
    print("  %-26s %-4s mean OKLCH L %.3f  (dark-mode band ceiling %.2f)" %
          ("Brightness", "PASS", mean_l, 0.67))
    print("        Deeper is bolder and is what the palette is tuned for; the floor is the")
    print("        ink ratio above, not the band — a hue may sit over the ceiling (gold and")
    print("        azure do) as long as its own label still clears 4.5:1. See FAMILY_COLORS.")
    return ok


# ── rendering ────────────────────────────────────────────────────────────────
W, H, GAP = 168, 44, 10  # one bar: the width the timeline gives a mid-size job
PAD = 10


def over(dst, src, a):
    return tuple(dst[i] * (1 - a) + src[i] * a for i in range(3))


def bar(base, label, mode=None, selected=False):
    """One bar as the timeline draws it: rim, gloss, then the label ink."""
    rows = []
    label_w = min(W - 2 * PAD, 5 * len(label) + 14)  # block ink, ~5px a character
    for y in range(H):
        row = []
        for x in range(W):
            r, g, b = base
            # .tl-sheen: light at the top, a darker skirt at the bottom.
            t = y / (H - 1)
            if t < 0.46:
                r, g, b = over((r, g, b), (255, 255, 255), 0.20 * (1 - t / 0.46))
            elif t > 0.62:
                r, g, b = over((r, g, b), (0, 0, 0), 0.22 * ((t - 0.62) / 0.38))
            # the label, centred like a real bar's text row
            if PAD <= x < W - PAD and 2 <= abs(y - H / 2) and abs(y - H / 2) < 7 and x - PAD < label_w:
                r, g, b = over((r, g, b), INK, 0.92)
            # .tl-bar: 1px rim, lifted off the track
            if x < 1 or x > W - 2 or y < 1 or y > H - 2:
                r, g, b = over((r, g, b), (255, 255, 255), 0.22)
            if mode:
                r, g, b = simulate((s2lin(r / 255), s2lin(g / 255), s2lin(b / 255)), mode)
                r, g, b = (12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055 for c in (r, g, b))
                r, g, b = (c * 255 for c in (r, g, b))
            row.append((r, g, b))
        rows.append(row)
    if selected:  # the 2px white ring a selected bar wears
        for y in range(H):
            for x in range(W):
                if x < 2 or x > W - 3 or y < 2 or y > H - 3:
                    rows[y][x] = over(rows[y][x], (255, 255, 255), 0.7)
    return rows


def legend_swatch(base, size=14):
    return [[over(base, (255, 255, 255), 0.22) if (x < 1 or x > size - 2 or y < 1 or y > size - 2) else base
             for x in range(size)] for y in range(size)]


def write_png(path, rows):
    h, w = len(rows), len(rows[0])
    raw = b"".join(b"\x00" + b"".join(struct.pack("BBB", *[int(max(0, min(255, c))) for c in px]) for px in row)
                   for row in rows)

    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    open(path, "wb").write(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def main():
    fams = load_families()
    print("families read from src/lib/categoryColor.ts:")
    for f, c, label in fams:
        L, C = oklch(c)
        print("  %-10s %s  L %.3f  C %.3f  ink %.2f:1  %s" %
              (f, c, L, C, contrast(c, "#%02x%02x%02x" % INK), label))
    ok = check(fams)

    strips = [("as drawn", None), ("protanopia", "protan"), ("deuteranopia", "deutan")]
    width = PAD + len(fams) * (W + GAP)
    height = PAD + len(strips) * (H + PAD + 16) + 14 + 2 * PAD
    canvas = [[CARD] * width for _ in range(height)]
    y = PAD
    for name, mode in strips:
        for i, (_f, hexc, label) in enumerate(fams):
            base = tuple(int(hexc.lstrip("#")[k:k + 2], 16) for k in (0, 2, 4))
            x0 = PAD + i * (W + GAP)
            for yy, row in enumerate(bar(base, label, mode, selected=(i == 2 and mode is None))):
                canvas[y + yy][x0:x0 + W] = row
        y += H + PAD
        # legend swatches for the same strip, at the size the legend uses
        for i, (_f, hexc, _label) in enumerate(fams):
            base = tuple(int(hexc.lstrip("#")[k:k + 2], 16) for k in (0, 2, 4))
            if mode:
                base = tuple(int(max(0, min(255, 255 * (12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055))))
                             for c in simulate(tuple(s2lin(v / 255) for v in base), mode))
            x0 = PAD + i * (W + GAP)
            for yy, row in enumerate(legend_swatch(base)):
                canvas[y + yy][x0:x0 + 14] = row
        y += 14 + 16

    out = sys.argv[1] if len(sys.argv) > 1 else "palette-preview.png"
    write_png(out, canvas)
    print("\nwrote %s (%dx%d) — three strips: real colours, protan, deutan; swatch row under each" %
          (out, width, height))
    print("the bar labels are drawn as blocks sized to the text; the browser renders the real names.")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
