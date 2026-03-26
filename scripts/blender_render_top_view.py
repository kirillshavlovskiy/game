"""
Render a single orthographic top-down PNG from a GLB (camera looks along -world Z).

  blender --background --python scripts/blender_render_top_view.py -- \\
    --glb public/models/monsters/spider.glb \\
    --output public/monsters/spider/extended/sheet_views/top.png

This matches the 3D placeholder mesh, not hand-painted turnaround art. For a painted
top view, illustrate it to match front/side/back or render from a final sculpted model.
"""

from __future__ import annotations

import argparse
import math
import os
import sys

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


def _configure_eevee_speed(scene: bpy.types.Scene, taa: int) -> None:
    e = getattr(scene, "eevee", None)
    if e is None:
        return
    if hasattr(e, "taa_render_samples"):
        e.taa_render_samples = max(1, int(taa))
    if hasattr(e, "use_raytracing"):
        e.use_raytracing = False


def _all_visible_meshes() -> list[bpy.types.Object]:
    out = [o for o in bpy.context.scene.objects if o.type == "MESH" and o.visible_get()]
    if not out:
        raise SystemExit("no visible MESH objects in scene")
    return out


def _world_aabb(objects: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    mn = Vector((1e30, 1e30, 1e30))
    mx = Vector((-1e30, -1e30, -1e30))
    for ob in objects:
        for corner in ob.bound_box:
            w = ob.matrix_world @ Vector(corner)
            mn.x, mn.y, mn.z = min(mn.x, w.x), min(mn.y, w.y), min(mn.z, w.z)
            mx.x, mx.y, mx.z = max(mx.x, w.x), max(mx.y, w.y), max(mx.z, w.z)
    return mn, mx


def _ensure_camera(name: str) -> bpy.types.Object:
    cam_data = bpy.data.cameras.new(name + "_data")
    cam_ob = bpy.data.objects.new(name, cam_data)
    bpy.context.scene.collection.objects.link(cam_ob)
    cam_data.type = "ORTHO"
    return cam_ob


def _ensure_light(name: str = "TopViewSun") -> None:
    if bpy.data.objects.get(name):
        return
    sun_data = bpy.data.lights.new(name + "_data", type="SUN")
    sun_ob = bpy.data.objects.new(name, sun_data)
    bpy.context.scene.collection.objects.link(sun_ob)
    sun_ob.rotation_euler = (math.radians(45), math.radians(-30), math.radians(20))
    sun_data.energy = 2.2


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--glb", required=True)
    p.add_argument("--output", "-o", required=True)
    p.add_argument("--resolution", type=int, default=1024)
    p.add_argument("--padding", type=float, default=1.15)
    p.add_argument("--eevee-taa", type=int, default=1)
    args = p.parse_args(_argv_after_ddash())

    glb = args.glb if os.path.isabs(args.glb) else os.path.abspath(args.glb)
    out_png = args.output if os.path.isabs(args.output) else os.path.abspath(args.output)

    _clear_default_scene()
    _import_gltf(glb)

    meshes = _all_visible_meshes()
    mn, mx = _world_aabb(meshes)
    center = (mn + mx) / 2.0
    span = mx - mn
    ortho_scale = max(span.x, span.y) * args.padding

    scene = bpy.context.scene
    eng = _pick_render_engine(scene)
    print(f"engine={eng}", file=sys.stderr)
    if eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        _configure_eevee_speed(scene, args.eevee_taa)

    scene.render.resolution_x = args.resolution
    scene.render.resolution_y = args.resolution
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"

    _ensure_light()
    cam = _ensure_camera("TopOrthoCam")
    cam.data.ortho_scale = ortho_scale

    elev = max(span.x, span.y, span.z) * 2.5 + 0.5
    cam.location = (center.x, center.y, center.z + elev)
    aim = center - Vector(cam.location)
    if aim.length < 1e-9:
        aim = Vector((0.0, 0.0, -1.0))
    cam.rotation_euler = aim.to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam

    os.makedirs(os.path.dirname(out_png), exist_ok=True)
    scene.render.filepath = out_png
    bpy.ops.render.render(write_still=True)
    print(out_png, file=sys.stderr)


if __name__ == "__main__":
    main()
