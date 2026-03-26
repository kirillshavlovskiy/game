"""
Headless Blender: build simple rigged placeholder monsters and export GLB.

These are procedural low-poly meshes (real 3D geometry), not 2D textures on a plane.
Turnaround PNGs in public/monsters/... are for human modeling reference in Blender only.

Run from repo root:
  blender --background --python scripts/blender_generate_monster_glbs.py

Optional env:
  MONSTER_GLB_OUT=/absolute/path/to/public/models/monsters
"""

from __future__ import annotations

import math
import os
import sys
from typing import Callable

import bpy
from mathutils import Euler, Vector

def _script_dir() -> str:
    try:
        return os.path.dirname(os.path.abspath(__file__))
    except NameError:
        pass
    if "--python" in sys.argv:
        i = sys.argv.index("--python")
        if i + 1 < len(sys.argv):
            return os.path.dirname(os.path.abspath(sys.argv[i + 1]))
    return os.getcwd()


REPO_ROOT = os.path.abspath(os.path.join(_script_dir(), ".."))
DEFAULT_OUT = os.path.join(REPO_ROOT, "public", "models", "monsters")
OUT_DIR = os.environ.get("MONSTER_GLB_OUT", DEFAULT_OUT)

# (slug, rgba, emissive, mesh_builder)
MonsterSpec = tuple[str, tuple[float, float, float, float], float, Callable[[], list[bpy.types.Object]]]


def _deselect() -> None:
    bpy.ops.object.select_all(action="DESELECT")


def _cylinder_between(p0: tuple[float, float, float], p1: tuple[float, float, float], radius: float, verts: int = 8) -> bpy.types.Object:
    """Cylinder along segment p0→p1 (Blender Z-up)."""
    a = Vector(p0)
    b = Vector(p1)
    delta = b - a
    length = max(delta.length, 0.02)
    mid = (a + b) / 2.0
    _deselect()
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=length, location=mid)
    ob = bpy.context.active_object
    dn = delta.normalized()
    quat = dn.to_track_quat("Z", "Y")
    ob.rotation_euler = quat.to_euler()
    return ob


def _cleanup_mesh_object(ob: bpy.types.Object) -> None:
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=0.001)
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")


def _join_mesh_objects(parts: list[bpy.types.Object], result_name: str) -> bpy.types.Object:
    if not parts:
        raise ValueError("no mesh parts")
    if len(parts) == 1:
        ob = parts[0]
        ob.name = result_name
        _cleanup_mesh_object(ob)
        return ob
    _deselect()
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    ob = bpy.context.active_object
    ob.name = result_name
    _cleanup_mesh_object(ob)
    return ob


def _mesh_height_z(ob: bpy.types.Object) -> float:
    zs = []
    for corner in ob.bound_box:
        zs.append((ob.matrix_world @ Vector(corner)).z)
    return max(zs) - min(zs), max(zs)


def _build_dracula() -> list[bpy.types.Object]:
    out: list[bpy.types.Object] = []
    _deselect()
    bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=0.19, depth=0.72, location=(0.0, 0.0, 0.36))
    out.append(bpy.context.active_object)
    _deselect()
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.14, segments=18, ring_count=12, location=(0.0, 0.02, 0.84))
    out.append(bpy.context.active_object)
    _deselect()
    bpy.ops.mesh.primitive_cone_add(vertices=16, radius1=0.42, radius2=0.06, depth=0.88, location=(0.0, -0.18, 0.48))
    cape = bpy.context.active_object
    cape.rotation_euler = Euler((math.radians(18), 0.0, 0.0), "XYZ")
    out.append(cape)
    return out


def _build_zombie() -> list[bpy.types.Object]:
    out: list[bpy.types.Object] = []
    _deselect()
    bpy.ops.mesh.primitive_cylinder_add(vertices=18, radius=0.24, depth=0.58, location=(0.05, 0.0, 0.32))
    torso = bpy.context.active_object
    torso.rotation_euler = Euler((0.0, math.radians(8), math.radians(-6)), "XYZ")
    out.append(torso)
    _deselect()
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.15, segments=16, ring_count=10, location=(0.1, 0.04, 0.72))
    out.append(bpy.context.active_object)
    _deselect()
    bpy.ops.mesh.primitive_cube_add(size=0.28, location=(0.02, 0.0, 0.14))
    hips = bpy.context.active_object
    hips.scale = (1.15, 0.85, 0.35)
    out.append(hips)
    return out


def _build_spider() -> list[bpy.types.Object]:
    out: list[bpy.types.Object] = []
    _deselect()
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.26, segments=20, ring_count=14, location=(0.0, 0.0, 0.22))
    out.append(bpy.context.active_object)
    _deselect()
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.14, segments=16, ring_count=10, location=(0.12, 0.1, 0.38))
    out.append(bpy.context.active_object)
    leg_angles = [
        (55, 35),
        (35, 55),
        (15, 65),
        (-15, 55),
        (-35, 45),
        (-55, 35),
        (80, 20),
        (-80, 20),
    ]
    for yaw_deg, side in leg_angles:
        rad = 0.035
        depth = 0.52
        yaw = math.radians(yaw_deg)
        x = math.cos(yaw) * 0.08
        y = math.sin(yaw) * 0.08
        z0 = 0.32
        _deselect()
        bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=rad, depth=depth, location=(x * 1.8, y * 1.8, z0))
        leg = bpy.context.active_object
        leg.rotation_euler = Euler((math.radians(side), math.radians(22), yaw), "XYZ")
        out.append(leg)
    return out


def _build_ghost() -> list[bpy.types.Object]:
    out: list[bpy.types.Object] = []
    _deselect()
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.38, segments=22, ring_count=16, location=(0.0, 0.0, 0.55))
    body = bpy.context.active_object
    body.scale = (0.95, 0.75, 1.15)
    out.append(body)
    _deselect()
    bpy.ops.mesh.primitive_cone_add(vertices=12, radius1=0.5, radius2=0.0, depth=0.62, location=(0.0, 0.0, 0.12))
    sheet = bpy.context.active_object
    sheet.rotation_euler = Euler((math.radians(180), 0.0, 0.0), "XYZ")
    out.append(sheet)
    return out


def _build_skeleton_3d() -> list[bpy.types.Object]:
    """Full jointed skeleton from primitives — volumetric mesh (not a textured card)."""
    out: list[bpy.types.Object] = []

    _deselect()
    bpy.ops.mesh.primitive_cube_add(size=0.2, location=(0.0, -0.04, 0.12))
    pelvis = bpy.context.active_object
    pelvis.scale = (1.25, 0.78, 0.42)
    out.append(pelvis)

    for z, r, dep, y_off in ((0.31, 0.066, 0.15, -0.02), (0.46, 0.058, 0.14, -0.03), (0.60, 0.052, 0.12, -0.04)):
        _deselect()
        bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=r, depth=dep, location=(0.0, y_off, z))
        out.append(bpy.context.active_object)

    _deselect()
    bpy.ops.mesh.primitive_torus_add(
        major_radius=0.19,
        minor_radius=0.032,
        major_segments=22,
        minor_segments=8,
        location=(0.0, 0.05, 0.57),
    )
    ribs = bpy.context.active_object
    ribs.rotation_euler = Euler((math.radians(88), math.radians(12), 0.0), "XYZ")
    ribs.scale = (1.0, 1.0, 0.5)
    out.append(ribs)

    _deselect()
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.105, segments=18, ring_count=12, location=(0.0, 0.07, 0.88))
    out.append(bpy.context.active_object)

    _deselect()
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.055, segments=10, ring_count=6, location=(0.0, 0.11, 0.82))
    jaw = bpy.context.active_object
    jaw.scale = (0.75, 1.05, 0.55)
    out.append(jaw)

    for sign in (-1.0, 1.0):
        sx = sign
        out.append(_cylinder_between((sx * 0.06, 0.02, 0.74), (sx * 0.22, 0.04, 0.66), 0.036, 10))
        out.append(_cylinder_between((sx * 0.22, 0.04, 0.66), (sx * 0.29, 0.09, 0.50), 0.03, 8))
        _deselect()
        bpy.ops.mesh.primitive_cube_add(size=0.07, location=(sx * 0.31, 0.12, 0.44))
        hand = bpy.context.active_object
        hand.scale = (0.55, 1.0, 1.15)
        out.append(hand)

        out.append(_cylinder_between((sx * 0.1, -0.05, 0.13), (sx * 0.12, 0.02, 0.44), 0.038, 10))
        out.append(_cylinder_between((sx * 0.12, 0.02, 0.44), (sx * 0.13, 0.04, 0.07), 0.03, 8))
        _deselect()
        bpy.ops.mesh.primitive_cube_add(size=0.09, location=(sx * 0.14, 0.05, 0.035))
        foot = bpy.context.active_object
        foot.scale = (1.1, 1.35, 0.45)
        out.append(foot)

    return out


def _build_skeleton() -> list[bpy.types.Object]:
    return _build_skeleton_3d()


def _build_lava() -> list[bpy.types.Object]:
    out: list[bpy.types.Object] = []
    _deselect()
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=0.34, location=(0.0, 0.0, 0.42))
    core = bpy.context.active_object
    core.scale = (1.05, 0.92, 1.18)
    out.append(core)
    _deselect()
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.2, location=(0.18, 0.1, 0.62))
    out.append(bpy.context.active_object)
    _deselect()
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.14, location=(-0.12, -0.14, 0.28))
    out.append(bpy.context.active_object)
    return out


MONSTERS: list[MonsterSpec] = [
    ("dracula", (0.38, 0.09, 0.14, 1.0), 0.0, _build_dracula),
    ("zombie", (0.2, 0.45, 0.22, 1.0), 0.0, _build_zombie),
    ("spider", (0.12, 0.12, 0.12, 1.0), 0.0, _build_spider),
    ("ghost", (0.92, 0.94, 1.0, 0.55), 0.0, _build_ghost),
    ("skeleton", (0.92, 0.88, 0.78, 1.0), 0.0, _build_skeleton),
    ("lava", (1.0, 0.35, 0.05, 1.0), 2.2, _build_lava),
]


def _purge_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for block in list(bpy.data.meshes):
        bpy.data.meshes.remove(block)
    for block in list(bpy.data.armatures):
        bpy.data.armatures.remove(block)
    for block in list(bpy.data.materials):
        bpy.data.materials.remove(block)
    for block in list(bpy.data.actions):
        bpy.data.actions.remove(block)
    for block in list(bpy.data.images):
        bpy.data.images.remove(block)


def _ensure_principled(mat: bpy.types.Material) -> bpy.types.ShaderNodeBsdfPrincipled:
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (300, 0)
    principled = nt.nodes.new("ShaderNodeBsdfPrincipled")
    principled.location = (0, 0)
    nt.links.new(principled.outputs["BSDF"], out.inputs["Surface"])
    return principled


def _make_material(name: str, rgba: tuple[float, float, float, float], emissive: float) -> bpy.types.Material:
    mat = bpy.data.materials.new(name=name)
    p = _ensure_principled(mat)
    r, g, b, a = rgba
    p.inputs["Base Color"].default_value = (r, g, b, 1.0)
    p.inputs["Alpha"].default_value = a
    p.inputs["Roughness"].default_value = 0.55
    if emissive > 0:
        p.inputs["Emission Color"].default_value = (r, g, b, 1.0)
        p.inputs["Emission Strength"].default_value = emissive
    mat.blend_method = "BLEND" if a < 0.999 else "OPAQUE"
    return mat


def _build_armature(name: str, body_top_z: float) -> bpy.types.Object:
    arm_data = bpy.data.armatures.new(f"{name}_ArmData")
    arm_ob = bpy.data.objects.new(f"{name}_Arm", arm_data)
    bpy.context.scene.collection.objects.link(arm_ob)
    bpy.context.view_layer.objects.active = arm_ob
    bpy.ops.object.mode_set(mode="EDIT")
    ebs = arm_data.edit_bones
    root = ebs.new("Root")
    root.head = (0.0, 0.0, 0.0)
    root.tail = (0.0, 0.0, 0.05)
    body = ebs.new("Body")
    body.parent = root
    body.use_connect = False
    body.head = (0.0, 0.0, 0.0)
    tail_z = max(body_top_z * 0.96, 0.28)
    body.tail = (0.0, 0.0, tail_z)
    bpy.ops.object.mode_set(mode="OBJECT")
    return arm_ob


def _parent_mesh_to_armature(mesh_ob: bpy.types.Object, arm_ob: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    mesh_ob.select_set(True)
    arm_ob.select_set(True)
    bpy.context.view_layer.objects.active = arm_ob
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")


def _bezier_ease_action(act: bpy.types.Action) -> None:
    for fc in act.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = "BEZIER"


def _keyframes_idle(arm_ob: bpy.types.Object, body_name: str = "Body") -> None:
    """Nearly still — avoids the “vibrating rectangle” look in the browser."""
    pb = arm_ob.pose.bones[body_name]
    pb.rotation_mode = "XYZ"
    scn = bpy.context.scene
    scn.frame_start = 1
    scn.frame_end = 96
    for f in (1, 48, 96):
        scn.frame_set(f)
        # Subtle breathing only on middle frame (~0.4°)
        rx = 0.008 if f == 48 else 0.0
        pb.rotation_euler = Euler((rx, 0.0, 0.0), "XYZ")
        pb.keyframe_insert(data_path="rotation_euler", frame=f)


def _keyframes_attack(arm_ob: bpy.types.Object, body_name: str = "Body") -> None:
    pb = arm_ob.pose.bones[body_name]
    pb.rotation_mode = "XYZ"
    scn = bpy.context.scene
    for f, rx, rz in (
        (1, 0.0, 0.0),
        (6, -0.35, 0.0),
        (14, 0.55, 0.25),
        (22, -0.1, 0.0),
        (32, 0.0, 0.0),
    ):
        scn.frame_set(f)
        pb.rotation_euler = Euler((rx, 0.0, rz), "XYZ")
        pb.keyframe_insert(data_path="rotation_euler", frame=f)


def _keyframes_hurt(arm_ob: bpy.types.Object, body_name: str = "Body") -> None:
    pb = arm_ob.pose.bones[body_name]
    pb.rotation_mode = "XYZ"
    scn = bpy.context.scene
    for f, rx, rz in ((1, 0.0, 0.0), (4, -0.5, -0.35), (14, 0.15, 0.1), (28, 0.0, 0.0)):
        scn.frame_set(f)
        pb.rotation_euler = Euler((rx, 0.0, rz), "XYZ")
        pb.keyframe_insert(data_path="rotation_euler", frame=f)


def _keyframes_death(arm_ob: bpy.types.Object, body_name: str = "Body") -> None:
    pb = arm_ob.pose.bones[body_name]
    pb.rotation_mode = "XYZ"
    scn = bpy.context.scene
    for f, rx in ((1, 0.0), (8, -0.2), (20, math.radians(-88))):
        scn.frame_set(f)
        pb.rotation_euler = Euler((rx, 0.0, 0.0), "XYZ")
        pb.keyframe_insert(data_path="rotation_euler", frame=f)


def _keyframes_walk(arm_ob: bpy.types.Object, body_name: str = "Body") -> None:
    pb = arm_ob.pose.bones[body_name]
    pb.rotation_mode = "XYZ"
    scn = bpy.context.scene
    for f, rx, rz in ((1, 0.06, 0.08), (12, -0.04, -0.08), (24, 0.06, 0.08)):
        scn.frame_set(f)
        pb.rotation_euler = Euler((rx, 0.0, rz), "XYZ")
        pb.keyframe_insert(data_path="rotation_euler", frame=f)


def _assign_new_action(arm_ob: bpy.types.Object, name: str) -> bpy.types.Action:
    if arm_ob.animation_data is None:
        arm_ob.animation_data_create()
    act = bpy.data.actions.new(name=name)
    arm_ob.animation_data.action = act
    return act


def _finalize_action(act: bpy.types.Action) -> None:
    _bezier_ease_action(act)
    act.use_fake_user = True


def _build_actions(arm_ob: bpy.types.Object) -> None:
    bpy.context.view_layer.objects.active = arm_ob
    bpy.ops.object.mode_set(mode="POSE")

    act = _assign_new_action(arm_ob, "Idle")
    _keyframes_idle(arm_ob)
    _finalize_action(act)

    act = _assign_new_action(arm_ob, "Attack")
    _keyframes_attack(arm_ob)
    _finalize_action(act)

    act = _assign_new_action(arm_ob, "Hurt")
    _keyframes_hurt(arm_ob)
    _finalize_action(act)

    act = _assign_new_action(arm_ob, "Death")
    _keyframes_death(arm_ob)
    _finalize_action(act)

    act = _assign_new_action(arm_ob, "Walk")
    _keyframes_walk(arm_ob)
    _finalize_action(act)

    arm_ob.animation_data.action = None
    bpy.ops.object.mode_set(mode="OBJECT")


def export_glb(path: str) -> None:
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_yup=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_frame_range=False,
        use_selection=False,
    )


def build_one(slug: str, rgba: tuple[float, float, float, float], emissive: float, builder: Callable[[], list[bpy.types.Object]]) -> None:
    _purge_scene()
    parts = builder()
    mesh_ob = _join_mesh_objects(parts, f"{slug}_Mesh")
    mesh_ob.location = (0.0, 0.0, 0.0)

    if not mesh_ob.data.materials:
        mat = _make_material(f"{slug}_Mat", rgba, emissive)
        mesh_ob.data.materials.append(mat)

    _height, top_z = _mesh_height_z(mesh_ob)
    arm_ob = _build_armature(slug, top_z)
    _parent_mesh_to_armature(mesh_ob, arm_ob)

    _build_actions(arm_ob)

    os.makedirs(OUT_DIR, exist_ok=True)
    out_path = os.path.join(OUT_DIR, f"{slug}.glb")
    export_glb(out_path)
    print(f"Wrote {out_path}", file=sys.stderr)


def main() -> None:
    if not os.path.isdir(os.path.dirname(OUT_DIR)):
        print(f"Output directory parent missing: {OUT_DIR}", file=sys.stderr)
        sys.exit(1)
    for slug, rgba, emi, builder in MONSTERS:
        build_one(slug, rgba, emi, builder)
    print("Done.", file=sys.stderr)


if __name__ == "__main__":
    main()
