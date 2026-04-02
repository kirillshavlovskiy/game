#!/usr/bin/env python3
"""Generate simple translucent ghost billboard PNGs for 2D maze + combat fallback."""
from __future__ import annotations

import math
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "public" / "monsters" / "ghost"

STATES: dict[str, tuple[int, int, int, float]] = {
    "idle": (200, 220, 255, 0.42),
    "hunt": (180, 210, 255, 0.48),
    "attack": (255, 200, 220, 0.52),
    "hurt": (255, 160, 170, 0.55),
    "recover": (190, 230, 255, 0.45),
    "defeated": (140, 150, 180, 0.35),
}


def draw_ghost_rgba(size: int, rgb: tuple[int, int, int], alpha_scale: float) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    cx, cy = size // 2, int(size * 0.46)
    # Soft outer glow
    for r, a in ((size * 0.38, 0.12), (size * 0.30, 0.22), (size * 0.22, 0.38)):
        rr = int(r)
        base_a = int(255 * a * alpha_scale)
        fill = (*rgb, base_a)
        draw.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), fill=fill)
    # Wispy tail
    for i in range(8):
        t = i / 7.0
        ty = cy + int(size * 0.18) + int(size * 0.28 * t)
        tx = cx + int(math.sin(t * math.pi * 2.2) * size * 0.08)
        tr = max(3, int(size * (0.12 - t * 0.07)))
        a = int(90 * (1 - t * 0.5) * alpha_scale)
        draw.ellipse((tx - tr, ty - tr, tx + tr, ty + tr), fill=(*rgb, min(255, a)))
    return img.filter(ImageFilter.GaussianBlur(radius=size * 0.04))


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    size = 256
    for name, (r, g, b, asc) in STATES.items():
        im = draw_ghost_rgba(size, (r, g, b), asc)
        path = OUT_DIR / f"{name}.png"
        im.save(path, "PNG")
        print(f"Wrote {path}")
    # Neutral default for any missing mapping
    idle = OUT_DIR / "idle.png"
    neutral = OUT_DIR / "neutral.png"
    if not neutral.exists():
        neutral.write_bytes(idle.read_bytes())
        print(f"Copied {neutral} from idle.png")


if __name__ == "__main__":
    main()
