#!/usr/bin/env python3
"""Remap Horror_Wall_06 to a lighter cool grey (readable on wall cells); preserves detail via luma."""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DEFAULT = ROOT / "public" / "textures" / "maze" / "Wall" / "Horror_Wall_06-256x256.png"

# Lifted ramp — mid lands ~#444455 / highlights ~#5a5a6a (readable; still cool B).
LO = (44, 44, 54)
MID = (68, 68, 84)
HI = (90, 90, 106)


def luma(r: int, g: int, b: int) -> float:
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


def lift_luma(l: float) -> float:
    """Brighten very dark plates so detail maps into the visible grey ramp."""
    return min(1.0, max(0.0, (l**0.78) * 1.48 + 0.1))


def main() -> None:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT
    im = Image.open(path).convert("RGBA")
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 8:
                continue
            t = lift_luma(luma(r, g, b))
            t = t**0.92
            nr, ng, nb = grey_from_t(t)
            px[x, y] = (nr, ng, nb, a)
    im.save(path, "PNG", optimize=True)
    print(f"Wrote {path}")


if __name__ == "__main__":
    main()
