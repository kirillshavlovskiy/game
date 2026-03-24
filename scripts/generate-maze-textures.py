#!/usr/bin/env python3
"""Regenerate procedural maze tile textures into public/textures/maze/."""
from __future__ import annotations

import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "textures" / "maze"
SIZE = 128


def noise_layer(base_rgb: tuple[int, int, int], grain: int = 18) -> Image.Image:
    px = Image.new("RGB", (SIZE, SIZE))
    pxd = px.load()
    for y in range(SIZE):
        for x in range(SIZE):
            n = random.randint(-grain, grain)
            r = max(0, min(255, base_rgb[0] + n))
            g = max(0, min(255, base_rgb[1] + n))
            b = max(0, min(255, base_rgb[2] + n))
            pxd[x, y] = (r, g, b)
    return px.filter(ImageFilter.GaussianBlur(radius=0.6))


def make_wall() -> Image.Image:
    random.seed(42)
    img = Image.new("RGB", (SIZE, SIZE), (32, 28, 42))
    d = ImageDraw.Draw(img)
    rows = 4
    row_h = SIZE // rows
    for r in range(rows):
        y0 = r * row_h
        y1 = (r + 1) * row_h - 2 if r < rows - 1 else SIZE
        offset = (r % 2) * (SIZE // 8)
        x = -offset
        while x < SIZE + SIZE // 4:
            w = SIZE // 4 + random.randint(-4, 6)
            shade = random.randint(-12, 12)
            fill = (
                max(18, min(52, 38 + shade)),
                max(16, min(48, 32 + shade)),
                max(24, min(58, 44 + shade)),
            )
            d.rectangle([x, y0, x + w, y1], fill=fill, outline=(20, 18, 28))
            x += w + 2
    random.seed(42)
    n = noise_layer((40, 36, 50), 22)
    return Image.blend(img, n, 0.35)


def make_floor() -> Image.Image:
    random.seed(43)
    base = noise_layer((28, 24, 34), 25)
    img = base.copy()
    d = ImageDraw.Draw(img)
    for _ in range(28):
        x1, y1 = random.randint(0, SIZE - 1), random.randint(0, SIZE - 1)
        x2, y2 = x1 + random.randint(-30, 30), y1 + random.randint(-30, 30)
        d.line([(x1, y1), (x2, y2)], fill=(18, 14, 22), width=1)
    d.rectangle([0, 0, SIZE - 1, SIZE - 1], outline=(22, 18, 30), width=1)
    return img.filter(ImageFilter.GaussianBlur(radius=0.35))


def make_noise_fine() -> Image.Image:
    random.seed(44)
    g = Image.new("L", (SIZE, SIZE))
    gd = g.load()
    for y in range(SIZE):
        for x in range(SIZE):
            gd[x, y] = max(0, min(255, 128 + random.randint(-48, 48)))
    return g.convert("RGB")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    make_wall().save(OUT / "wall_diffuse.png", "PNG", optimize=True)
    make_floor().save(OUT / "floor_diffuse.png", "PNG", optimize=True)
    make_noise_fine().save(OUT / "noise_grain.png", "PNG", optimize=True)
    print("Wrote", OUT)


if __name__ == "__main__":
    main()
