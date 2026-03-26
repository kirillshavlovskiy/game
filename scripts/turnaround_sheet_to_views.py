#!/usr/bin/env python3
"""
Split a horizontal turnaround sheet into separate view PNGs (and optional mirrors).

Default: 3 equal columns → front | side | back (left → right), matching
public/monsters/skeleton/extended/turnaround-sheet.png layout.

  python3 scripts/turnaround_sheet_to_views.py \\
    --input public/monsters/skeleton/extended/turnaround-sheet.png \\
    --output-dir public/monsters/skeleton/extended/sheet_views

  # Also write a mirror of the side panel (e.g. right profile → left profile):
  --mirror-side

Photogrammetry / multi-view 3D (read this):
  • Meshroom, COLMAP, Metashape, etc. expect *many* (often 20–80) *perspective*
    photos of the *same real object* with overlap and parallax.
  • Three *orthographic illustrations* on one sheet are *reference art*, not a
    substitute for that photo set. Feeding only 3–4 cuts rarely produces a good mesh.
  • Practical paths:
    – Model in Blender using these PNGs as background references (Image empty / planes).
    – Export many angles from your *3D* mesh with scripts/blender_turntable_render.py
      and use those as a *synthetic* photo set (still not classic photogrammetry, but
      sometimes usable in SfM tools with luck).
    – Use dedicated *multi-view reconstruction* or *image-to-3D* services that accept
      a few drawings (quality varies).

Requires: pip install pillow (use a venv on Homebrew Python — see PEP 668).
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys


def _require_pil():
    try:
        from PIL import Image
    except ImportError:
        print("Install Pillow: python3 -m venv .venv && .venv/bin/pip install pillow", file=sys.stderr)
        sys.exit(1)
    return Image


def split_sheet(
    Image,
    path: str,
    out_dir: str,
    columns: int,
    mirror_side: bool,
    trim_white: bool,
    white_threshold: int,
    sequence_dir: str | None,
) -> list[str]:
    os.makedirs(out_dir, exist_ok=True)
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    col_w = w // columns
    if col_w < 8:
        raise SystemExit(f"image too narrow for {columns} columns: {w}px")

    labels = ("front", "side", "back", "extra_3", "extra_4", "extra_5")
    written: list[str] = []

    def trim_box(box_im):
        if not trim_white:
            return box_im
        pixels = box_im.load()
        bw, bh = box_im.size
        min_x, min_y = bw, bh
        max_x, max_y = 0, 0
        for y in range(bh):
            for x in range(bw):
                r, g, b, a = pixels[x, y]
                if a < 12:
                    continue
                if r >= white_threshold and g >= white_threshold and b >= white_threshold:
                    continue
                min_x = min(min_x, x)
                min_y = min(min_y, y)
                max_x = max(max_x, x)
                max_y = max(max_y, y)
        if max_x < min_x:
            return box_im
        pad = 2
        min_x = max(0, min_x - pad)
        min_y = max(0, min_y - pad)
        max_x = min(bw - 1, max_x + pad)
        max_y = min(bh - 1, max_y + pad)
        return box_im.crop((min_x, min_y, max_x + 1, max_y + 1))

    for i in range(columns):
        x0 = i * col_w
        x1 = w if i == columns - 1 else (i + 1) * col_w
        panel = im.crop((x0, 0, x1, h))
        panel = trim_box(panel)
        name = labels[i] if i < len(labels) else f"col_{i}"
        fp = os.path.join(out_dir, f"{name}.png")
        panel.save(fp)
        written.append(fp)

    if mirror_side and columns >= 2:
        side_path = os.path.join(out_dir, "side.png")
        if os.path.isfile(side_path):
            side_im = Image.open(side_path).convert("RGBA")
            mirrored = side_im.transpose(Image.FLIP_LEFT_RIGHT)
            mp = os.path.join(out_dir, "side_mirrored.png")
            mirrored.save(mp)
            written.append(mp)

    if sequence_dir:
        os.makedirs(sequence_dir, exist_ok=True)
        seq_order = [os.path.join(out_dir, "front.png"), os.path.join(out_dir, "side.png"), os.path.join(out_dir, "back.png")]
        if mirror_side:
            seq_order.append(os.path.join(out_dir, "side_mirrored.png"))
        n = 1
        for sp in seq_order:
            if os.path.isfile(sp):
                dst = os.path.join(sequence_dir, f"IMG_{n:04d}.png")
                shutil.copy2(sp, dst)
                written.append(dst)
                n += 1

    return written


def main() -> None:
    Image = _require_pil()
    p = argparse.ArgumentParser(description="Split turnaround sheet into view PNGs")
    p.add_argument("--input", "-i", required=True)
    p.add_argument("--output-dir", "-o", required=True)
    p.add_argument("--columns", "-c", type=int, default=3, help="Number of horizontal panels")
    p.add_argument("--mirror-side", action="store_true", help="Write side_mirrored.png from side.png")
    p.add_argument("--trim-white", action="store_true", help="Crop each panel to non-white bbox")
    p.add_argument("--white-threshold", type=int, default=248, help="RGB min to count as background")
    p.add_argument(
        "--sequence-dir",
        default="",
        help="Also copy views as IMG_0001.png, … for SfM tools (front, side, back[, side_mirrored])",
    )
    args = p.parse_args()

    inp = os.path.abspath(args.input)
    if not os.path.isfile(inp):
        print(f"not found: {inp}", file=sys.stderr)
        sys.exit(1)
    out = os.path.abspath(args.output_dir)

    seq = os.path.abspath(args.sequence_dir) if args.sequence_dir else None

    paths = split_sheet(
        Image,
        inp,
        out,
        columns=args.columns,
        mirror_side=args.mirror_side,
        trim_white=args.trim_white,
        white_threshold=args.white_threshold,
        sequence_dir=seq,
    )
    for fp in paths:
        print(fp)


if __name__ == "__main__":
    main()
