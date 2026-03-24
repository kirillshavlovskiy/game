#!/usr/bin/env python3
"""Remap Horror_Stone_02 to cool grey at the same brightness band as Horror_Wall_06; keeps crack detail."""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DEFAULT = ROOT / "public" / "textures" / "maze" / "Stone" / "Horror_Stone_02-256x256.png"

# Same ramp as `recolor-wall-06-maze-grey.py` (~#2c2c36 → #444454 → #5a5a6a).
LO = (44, 44, 54)
MID = (68, 68, 84)
HI = (90, 90, 106)


def luma01(r: int, g: int, b: int) -> float:
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255.0


def grey_from_t(t: float) -> tuple[int, int, int]:
    t = max(0.0, min(1.0, t))
    if t <= 0.5:
        u = t / 0.5
        return (
            int(LO[0] + (MID[0] - LO[0]) * u),
            int(LO[1] + (MID[1] - LO[1]) * u),
            int(LO[2] + (MID[2] - LO[2]) * u),
        )
    u = (t - 0.5) / 0.5
    return (
        int(MID[0] + (HI[0] - MID[0]) * u),
        int(MID[1] + (HI[1] - MID[1]) * u),
        int(MID[2] + (HI[2] - MID[2]) * u),
    )


def main() -> None:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    buf: list[tuple[int, int, int, int]] = []
    lums: list[float] = []
    for y in range(h):
        for x in range(w):
            r, g, b, a = im.getpixel((x, y))
            buf.append((r, g, b, a))
            if a >= 8:
                lums.append(luma01(r, g, b))
    if not lums:
        print("No opaque pixels", file=sys.stderr)
        sys.exit(1)
    lo = min(lums)
    hi = max(lums)
    span = max(hi - lo, 1e-4)

    out = im.copy()
    px = out.load()
    i = 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = buf[i]
            i += 1
            if a < 8:
                px[x, y] = (r, g, b, a)
                continue
            t = (luma01(r, g, b) - lo) / span
            t = max(0.0, min(1.0, t**0.92))
            nr, ng, nb = grey_from_t(t)
            px[x, y] = (nr, ng, nb, a)
    out.save(path, "PNG", optimize=True)
    print(f"Wrote {path} (luma span {lo:.3f}–{hi:.3f})")


if __name__ == "__main__":
    main()
