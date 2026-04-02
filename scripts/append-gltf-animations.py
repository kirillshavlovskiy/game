#!/usr/bin/env python3
"""
Append animation clips from Meshy (or other) GLBs into a base rig GLB without duplicating the mesh.

Requires identical node lists / sampler node indices (same skeleton export). Writes a new .glb with
combined BIN chunk and remapped accessors + bufferViews.
"""
from __future__ import annotations

import argparse
import copy
import json
import struct
import sys
from pathlib import Path


def read_glb(path: Path) -> tuple[dict, bytes]:
    data = path.read_bytes()
    if data[:4] != b"glTF":
        raise ValueError(f"Not a GLB: {path}")
    pos = 12
    json_obj = None
    bin_chunk = b""
    while pos < len(data):
        clen = struct.unpack_from("<I", data, pos)[0]
        ctype = data[pos + 4 : pos + 8]
        body = data[pos + 8 : pos + 8 + clen]
        pos += 8 + clen
        if ctype == b"JSON":
            json_obj = json.loads(body.decode())
        elif ctype == b"BIN\x00":
            bin_chunk = body
    if json_obj is None:
        raise ValueError(f"No JSON chunk: {path}")
    return json_obj, bin_chunk


def write_glb(json_obj: dict, bin_chunk: bytes, path: Path) -> None:
    jbytes = json.dumps(json_obj, separators=(",", ":")).encode("utf-8")
    jpad = (4 - (len(jbytes) % 4)) % 4
    jbytes += b" " * jpad
    bpad = (4 - (len(bin_chunk) % 4)) % 4
    bchunk = bin_chunk + b"\x00" * bpad
    total = 12 + 8 + len(jbytes) + 8 + len(bchunk)
    out = bytearray()
    out.extend(struct.pack("<4sII", b"glTF", 2, total))
    out.extend(struct.pack("<I", len(jbytes)))
    out.extend(b"JSON")
    out.extend(jbytes)
    out.extend(struct.pack("<I", len(bchunk)))
    out.extend(b"BIN\x00")
    out.extend(bchunk)
    path.write_bytes(out)


def collect_animation_accessor_indices(anim: dict) -> set[int]:
    acc: set[int] = set()
    for s in anim.get("samplers") or []:
        acc.add(s["input"])
        acc.add(s["output"])
    return acc


def append_animations_from_source(
    dst_json: dict,
    dst_bin: bytearray,
    src_json: dict,
    src_bin: bytes,
    *,
    rename: dict[str, str] | None = None,
) -> None:
    rename = rename or {}
    for anim in src_json.get("animations") or []:
        anim = copy.deepcopy(anim)
        old_name = anim.get("name") or ""
        if old_name in rename:
            anim["name"] = rename[old_name]

        acc_indices = sorted(collect_animation_accessor_indices(anim))
        old_to_new: dict[int, int] = {}
        for old_acc in acc_indices:
            acc = copy.deepcopy(src_json["accessors"][old_acc])
            bv_old = src_json["bufferViews"][acc["bufferView"]]
            start = bv_old["byteOffset"]
            end = start + bv_old["byteLength"]
            slice_data = src_bin[start:end]

            while len(dst_bin) % 4 != 0:
                dst_bin.append(0)
            new_off = len(dst_bin)
            dst_bin.extend(slice_data)

            new_bvi = len(dst_json["bufferViews"])
            dst_json["bufferViews"].append(
                {
                    "buffer": 0,
                    "byteOffset": new_off,
                    "byteLength": len(slice_data),
                }
            )
            acc["bufferView"] = new_bvi
            new_ai = len(dst_json["accessors"])
            dst_json["accessors"].append(acc)
            old_to_new[old_acc] = new_ai

        for s in anim["samplers"]:
            s["input"] = old_to_new[s["input"]]
            s["output"] = old_to_new[s["output"]]

        dst_json.setdefault("animations", []).append(anim)

    dst_json["buffers"][0]["byteLength"] = len(dst_bin)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("base", type=Path, help="Base GLB (mesh + skeleton + existing anims)")
    p.add_argument("output", type=Path, help="Output GLB path")
    p.add_argument(
        "sources",
        nargs="+",
        type=Path,
        help="Source GLBs whose animations are appended (same rig)",
    )
    args = p.parse_args()

    dst_json, dst_bin_raw = read_glb(args.base)
    dst_bin = bytearray(dst_bin_raw)

    for src_path in args.sources:
        src_json, src_bin = read_glb(src_path)
        # Canonical names for wasteland-drifter / three.js matching
        rename = {}
        for anim in src_json.get("animations") or []:
            n = anim.get("name") or ""
            if "Walk_Fight_Back" in n and "Cautious" not in n:
                rename[n] = "Walk_Fight_Back"
            elif "Cautious_Crouch_Walk_Backward" in n:
                rename[n] = "Cautious_Crouch_Walk_Backward"
        append_animations_from_source(dst_json, dst_bin, src_json, src_bin, rename=rename)

    write_glb(dst_json, bytes(dst_bin), args.output)
    print(f"Wrote {args.output} ({len(dst_json.get('animations') or [])} animations)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
