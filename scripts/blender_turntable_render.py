"""
Turntable render for turnaround sprites (orthographic, transparent PNGs).

Either open a .blend with your character, or pass --glb to import a GLB into an empty startup scene.

  blender /path/to/character.blend --background --python \\
    scripts/blender_turntable_render.py -- \\
    --output /tmp/skeleton_turn --frames 8 --resolution 1024

  blender --background --python scripts/blender_turntable_render.py -- \\
    --glb public/models/monsters/skeleton.glb \\
    --output /tmp/skeleton_turn

Optional:
  --collection NAME   Only mesh objects in this collection (and children)
  --padding 1.15      World-space framing margin around combined bounds
  --elevation 0.12    Camera height offset (Blender Z) relative to bounds center

Then stitch frames into one sheet (requires Pillow):

  python3 scripts/stitch_turnaround_sheet.py /tmp/skeleton_turn --output sheet.png

Blender 4.x: prefers EEVEE Next; falls back to EEVEE or Cycles.
"""

from __future__ import annotations

import argparse
import math
import os
import sys
from typing import Iterable

import bpy
from mathutils import Vector


def _argv_after_ddash() -> list[str]:
    if "--" in sys.argv:
        return sys.argv[sys.argv.index("--") + 1 :]
    return []


def _clear_default_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def _import_gltf(abs_path: str) -> None:
    if not os.path.isfile(abs_path):
        raise SystemExit(f"GLB not found: {abs_path}")
    bpy.ops.import_scene.gltf(filepath=abs_path)


def _pick_render_engine(scene: bpy.types.Scene) -> str:
    try:
        eng_prop = bpy.types.RenderSettings.bl_rna.properties["engine"]
        ids = [e.identifier for e in eng_prop.enum_items]
    except Exception:
        ids = []
    for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES"):
        if eng in ids:
            scene.render.engine = eng
            return eng
    scene.render.engine = "CYCLES"
    return "CYCLES"


def _configure_eevee_speed(scene: bpy.types.Scene, taa_samples: int) -> None:
    """EEVEE Next defaults to 64 TAA render samples — far too slow for batch turntables."""
    e = getattr(scene, "eevee", None)
    if e is None:
        return
    if hasattr(e, "taa_render_samples"):
        e.taa_render_samples = max(1, int(taa_samples))
    if hasattr(e, "use_raytracing"):
        e.use_raytracing = False


def _meshes_from_collection(name: str) -> list[bpy.types.Object]:
    coll = bpy.data.collections.get(name)
    if coll is None:
        raise SystemExit(f"collection not found: {name!r}")
    out: list[bpy.types.Object] = []

    def walk(c: bpy.types.Collection) -> None:
        for o in c.objects:
            if o.type == "MESH" and o.visible_get():
                out.append(o)
        for ch in c.children:
            walk(ch)

    walk(coll)
    if not out:
        raise SystemExit(f"no visible MESH objects in collection {name!r}")
    return out


def _all_visible_meshes() -> list[bpy.types.Object]:
    out = [o for o in bpy.context.scene.objects if o.type == "MESH" and o.visible_get()]
    if not out:
        raise SystemExit("no visible MESH objects in scene")
    return out


def _world_aabb(objects: Iterable[bpy.types.Object]) -> tuple[Vector, Vector]:
    mn = Vector((1e30, 1e30, 1e30))
    mx = Vector((-1e30, -1e30, -1e30))
    for ob in objects:
        for corner in ob.bound_box:
            w = ob.matrix_world @ Vector(corner)
            mn.x, mn.y, mn.z = min(mn.x, w.x), min(mn.y, w.y), min(mn.z, w.z)
            mx.x, mx.y, mx.z = max(mx.x, w.x), max(mx.y, w.y), max(mx.z, w.z)
    return mn, mx


def _ensure_camera(name: str = "TurntableCam") -> bpy.types.Object:
    cam_data = bpy.data.cameras.new(name + "_data")
    cam_ob = bpy.data.objects.new(name, cam_data)
    bpy.context.scene.collection.objects.link(cam_ob)
    cam_data.type = "ORTHO"
    return cam_ob


def _ensure_light(name: str = "TurntableSun") -> None:
    if bpy.data.objects.get(name):
        return
    sun_data = bpy.data.lights.new(name + "_data", type="SUN")
    sun_ob = bpy.data.objects.new(name, sun_data)
    bpy.context.scene.collection.objects.link(sun_ob)
    sun_ob.rotation_euler = (math.radians(55), math.radians(-25), math.radians(20))
    sun_data.energy = 2.5


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Orthographic turntable PNG renders")
    p.add_argument("--output", required=True, help="Output directory for angle_XX.png")
    p.add_argument("--frames", type=int, default=8, help="Steps around full 360° (default 8)")
    p.add_argument("--resolution", type=int, default=1024, help="Square render size in pixels")
    p.add_argument("--collection", default="", help="Limit to mesh objects under this collection")
    p.add_argument("--padding", type=float, default=1.18, help="Ortho scale multiplier")
    p.add_argument("--elevation", type=float, default=0.12, help="Z offset added to camera target")
    p.add_argument("--format", default="PNG", choices=("PNG",), help="File format")
    p.add_argument(
        "--glb",
        default="",
        help="Import this GLB first (clears startup scene). Absolute or cwd path.",
    )
    p.add_argument(
        "--eevee-taa",
        type=int,
        default=1,
        help="EEVEE Next TAA render samples (default 1 = fast batch; use 16–64 for cleaner edges)",
    )
    return p.parse_args(_argv_after_ddash())


def main() -> None:
    args = parse_args()
    out_dir = os.path.abspath(args.output)
    os.makedirs(out_dir, exist_ok=True)

    if args.glb:
        glb_path = args.glb if os.path.isabs(args.glb) else os.path.abspath(args.glb)
        _clear_default_scene()
        _import_gltf(glb_path)

    meshes = _meshes_from_collection(args.collection) if args.collection else _all_visible_meshes()
    mn, mx = _world_aabb(meshes)
    center = (mn + mx) / 2.0
    center.z += args.elevation
    span = mx - mn
    # Horizontal sweep needs the XY diagonal; vertical needs Z (world up).
    ortho_base = max(math.hypot(span.x, span.y), span.z) * args.padding

    scene = bpy.context.scene
    eng = _pick_render_engine(scene)
    print(f"Using render engine: {eng}", file=sys.stderr)
    if eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        _configure_eevee_speed(scene, args.eevee_taa)

    scene.render.resolution_x = args.resolution
    scene.render.resolution_y = args.resolution
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = args.format
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"

    _ensure_light()
    cam_ob = _ensure_camera()
    cam_ob.data.ortho_scale = ortho_base
    scene.camera = cam_ob

    n = max(3, args.frames)
    radius = max(span.x, span.y) * 2.5 + 1.0

    for i in range(n):
        deg = 360.0 * i / n
        rad = math.radians(deg)
        pos = center + Vector((math.cos(rad) * radius, math.sin(rad) * radius, 0.0))
        cam_ob.location = pos
        aim = center - pos
        if aim.length < 1e-6:
            aim = Vector((0.0, -1.0, 0.0))
        cam_ob.rotation_euler = aim.to_track_quat("-Z", "Y").to_euler()

        fp = os.path.join(out_dir, f"angle_{i:02d}.png")
        scene.render.filepath = fp
        bpy.ops.render.render(write_still=True)
        print(fp, file=sys.stderr)

    print(f"Done. {n} frames → {out_dir}", file=sys.stderr)


if __name__ == "__main__":
    main()
