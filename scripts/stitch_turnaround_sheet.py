#!/usr/bin/env python3
"""
Paste rendered turntable PNGs into one horizontal sheet (left → right = angle order).

  python3 scripts/stitch_turnaround_sheet.py /tmp/skeleton_turn --output public/monsters/skeleton/extended/turnaround-sheet.png

Requires Pillow (`pip install pillow`). On macOS Homebrew Python (PEP 668), use a venv:

  python3 -m venv .venv && .venv/bin/pip install pillow && .venv/bin/python scripts/stitch_turnaround_sheet.py ...
"""

from __future__ import annotations

import argparse
import os
import re
import sys


def main() -> None:
    try:
        from PIL import Image
    except ImportError:
        print("Install Pillow: pip install pillow", file=sys.stderr)
        sys.exit(1)

    p = argparse.ArgumentParser()
    p.add_argument("input_dir", help="Folder containing angle_XX.png from blender_turntable_render.py")
    p.add_argument("--output", "-o", required=True, help="Output PNG path")
    p.add_argument("--pad", type=int, default=4, help="Horizontal gap between frames (px)")
    args = p.parse_args()

    d = os.path.abspath(args.input_dir)
    if not os.path.isdir(d):
        print(f"not a directory: {d}", file=sys.stderr)
        sys.exit(1)

    pat = re.compile(r"angle_(\d+)\.png$", re.I)
    files: list[tuple[int, str]] = []
    for name in os.listdir(d):
        m = pat.match(name)
        if m:
            files.append((int(m.group(1)), os.path.join(d, name)))
    files.sort(key=lambda t: t[0])
    if not files:
        print(f"no angle_XX.png files in {d}", file=sys.stderr)
        sys.exit(1)

    images = [Image.open(path).convert("RGBA") for _, path in files]
    h = max(im.height for im in images)
    resized: list[Image.Image] = []
    for im in images:
        if im.height != h:
            nw = int(im.width * (h / im.height))
            resized.append(im.resize((nw, h), Image.Resampling.LANCZOS))
        else:
            resized.append(im)

    gap = max(0, args.pad)
    total_w = sum(im.width for im in resized) + gap * (len(resized) - 1)
    sheet = Image.new("RGBA", (total_w, h), (0, 0, 0, 0))
    x = 0
    for im in resized:
        sheet.paste(im, (x, 0), im)
        x += im.width + gap

    out = os.path.abspath(args.output)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    sheet.save(out)
    print(out)


if __name__ == "__main__":
    main()
