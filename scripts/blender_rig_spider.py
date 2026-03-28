"""
Blender headless script: rig a static spider GLB with a skeleton,
auto-weight-paint, create combat animations, and export as a merged GLB.

Usage:
  blender --background --python scripts/blender_rig_spider.py -- <input.glb> [output.glb]
"""
import bpy
import sys
import os
import math
from mathutils import Vector, Euler

# ── CLI args ──────────────────────────────────────────────────────────
argv = sys.argv
try:
    idx = argv.index("--")
    script_args = argv[idx + 1:]
except ValueError:
    script_args = []

INPUT_GLB = script_args[0] if len(script_args) > 0 else None
OUTPUT_GLB = (
    script_args[1]
    if len(script_args) > 1
    else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "models", "monsters", "spider.glb")
)

if not INPUT_GLB or not os.path.exists(INPUT_GLB):
    print(f"Usage: blender --background --python {__file__} -- <input.glb> [output.glb]")
    sys.exit(1)


# ── Helpers ───────────────────────────────────────────────────────────
def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb(path):
    bpy.ops.import_scene.gltf(filepath=path)
    for obj in bpy.data.objects:
        if obj.type == "MESH":
            return obj
    raise RuntimeError("No mesh found in GLB")


def new_bone(arm_edit, name, head, tail, parent=None, use_connect=False):
    b = arm_edit.edit_bones.new(name)
    b.head = Vector(head)
    b.tail = Vector(tail)
    if parent:
        b.parent = arm_edit.edit_bones[parent]
        b.use_connect = use_connect
    return b


# ── Mesh analysis ────────────────────────────────────────────────────
# Spider mesh: X width ±0.875, Y depth -1.0..+1.0, Z height -0.6..+0.6
# Facing -Y (head at -Y), abdomen at +Y, top at +Z, feet at -Z ≈ -0.6

BODY_CENTER = (0, -0.1, 0.05)
HEAD_POS = (0, -0.65, 0.1)
HEAD_TIP = (0, -0.9, 0.0)
ABDOMEN_POS = (0, 0.35, 0.1)
ABDOMEN_TIP = (0, 0.75, 0.0)

# 4 pairs of legs; each: hip at body → knee mid-air → foot on ground
# Ordered front to back, right side (mirrored for left)
LEG_SPECS = [
    {  # Front right (Leg_R1)
        "y": -0.40,
        "hip":  (0.20, -0.40, 0.0),
        "knee": (0.55, -0.60, -0.25),
        "foot": (0.78, -0.75, -0.58),
    },
    {  # Front-mid right (Leg_R2)
        "y": -0.15,
        "hip":  (0.22, -0.15, 0.0),
        "knee": (0.60, -0.15, -0.25),
        "foot": (0.85, -0.10, -0.58),
    },
    {  # Back-mid right (Leg_R3)
        "y": 0.10,
        "hip":  (0.22, 0.10, 0.0),
        "knee": (0.58, 0.20, -0.25),
        "foot": (0.82, 0.35, -0.58),
    },
    {  # Back right (Leg_R4)
        "y": 0.30,
        "hip":  (0.18, 0.30, 0.0),
        "knee": (0.50, 0.55, -0.25),
        "foot": (0.72, 0.80, -0.58),
    },
]


# ── Build armature ───────────────────────────────────────────────────
def build_armature():
    bpy.ops.object.armature_add(enter_editmode=True, location=(0, 0, 0))
    arm_obj = bpy.context.active_object
    arm_obj.name = "Armature"
    arm = arm_obj.data
    arm.name = "SpiderRig"

    # Remove default bone
    for b in arm.edit_bones:
        arm.edit_bones.remove(b)

    # Root / body
    new_bone(arm, "Root", BODY_CENTER, (BODY_CENTER[0], BODY_CENTER[1], BODY_CENTER[2] + 0.15))
    new_bone(arm, "Body", BODY_CENTER, (BODY_CENTER[0], BODY_CENTER[1] + 0.25, BODY_CENTER[2]), parent="Root")

    # Head
    new_bone(arm, "Head", HEAD_POS, HEAD_TIP, parent="Body")

    # Abdomen
    new_bone(arm, "Abdomen", ABDOMEN_POS, ABDOMEN_TIP, parent="Body")

    # Legs — right side + left side (mirrored)
    for i, spec in enumerate(LEG_SPECS, 1):
        for side, sx in [("R", 1), ("L", -1)]:
            hip = (spec["hip"][0] * sx, spec["hip"][1], spec["hip"][2])
            knee = (spec["knee"][0] * sx, spec["knee"][1], spec["knee"][2])
            foot = (spec["foot"][0] * sx, spec["foot"][1], spec["foot"][2])

            hip_name = f"Leg_{side}{i}_Hip"
            knee_name = f"Leg_{side}{i}_Knee"
            foot_name = f"Leg_{side}{i}_Foot"

            new_bone(arm, hip_name, hip, knee, parent="Body")
            new_bone(arm, knee_name, knee, foot, parent=hip_name, use_connect=True)
            new_bone(arm, foot_name, foot, (foot[0] + 0.04 * sx, foot[1], foot[2] - 0.03), parent=knee_name, use_connect=True)

    bpy.ops.object.mode_set(mode="OBJECT")
    return arm_obj


# ── Skin mesh to armature ────────────────────────────────────────────
def parent_with_weights(mesh_obj, arm_obj):
    # Decimate to make auto-weights viable
    orig_verts = len(mesh_obj.data.vertices)
    if orig_verts > 60000:
        ratio = 60000 / orig_verts
        print(f"Decimating mesh: {orig_verts} -> ~60000 verts (ratio {ratio:.3f})")
        bpy.context.view_layer.objects.active = mesh_obj
        mod = mesh_obj.modifiers.new("Decimate", "DECIMATE")
        mod.ratio = ratio
        bpy.ops.object.modifier_apply(modifier=mod.name)
        print(f"After decimate: {len(mesh_obj.data.vertices)} verts")

    # Try auto-weights first
    bpy.ops.object.select_all(action="DESELECT")
    mesh_obj.select_set(True)
    arm_obj.select_set(True)
    bpy.context.view_layer.objects.active = arm_obj
    try:
        bpy.ops.object.parent_set(type="ARMATURE_AUTO")
        has_skin = mesh_obj.find_armature() is not None
        print(f"Auto-weights: vertex groups={len(mesh_obj.vertex_groups)}, has_skin={has_skin}")
    except Exception as e:
        print(f"Auto-weights failed: {e}, falling back to envelope")
        has_skin = False

    # If auto failed or no skin modifier, fall back to manual proximity weights
    has_armature_mod = any(m.type == "ARMATURE" for m in mesh_obj.modifiers)
    if not has_armature_mod:
        print("Adding Armature modifier manually")
        mod = mesh_obj.modifiers.new("Armature", "ARMATURE")
        mod.object = arm_obj
        mesh_obj.parent = arm_obj

    # Ensure vertex groups exist for every bone and have weights
    arm_bones_info = []
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode="POSE")
    for pb in arm_obj.pose.bones:
        head_world = arm_obj.matrix_world @ pb.head
        tail_world = arm_obj.matrix_world @ pb.tail
        arm_bones_info.append((pb.name, head_world, tail_world))
    bpy.ops.object.mode_set(mode="OBJECT")

    bpy.context.view_layer.objects.active = mesh_obj

    # Check if any vertex actually has non-zero weight
    total_weighted = 0
    for v in mesh_obj.data.vertices:
        if any(g.weight > 0.01 for g in v.groups):
            total_weighted += 1

    if total_weighted < len(mesh_obj.data.vertices) * 0.3:
        print(f"Only {total_weighted}/{len(mesh_obj.data.vertices)} verts weighted — doing proximity assignment")
        _assign_proximity_weights(mesh_obj, arm_bones_info)

    print(f"Skinning complete. Vertex groups: {len(mesh_obj.vertex_groups)}")


def _assign_proximity_weights(mesh_obj, bones_info):
    """Assign vertex weights based on distance to nearest bone segment."""
    import mathutils

    # Create/clear vertex groups
    for bname, _, _ in bones_info:
        vg = mesh_obj.vertex_groups.get(bname)
        if not vg:
            vg = mesh_obj.vertex_groups.new(name=bname)

    def point_to_segment_dist(p, a, b):
        ab = b - a
        ap = p - a
        t = max(0, min(1, ap.dot(ab) / max(ab.dot(ab), 1e-8)))
        closest = a + ab * t
        return (p - closest).length

    verts = mesh_obj.data.vertices
    mw = mesh_obj.matrix_world
    for v in verts:
        vpos = mw @ v.co
        dists = []
        for bname, head, tail in bones_info:
            d = point_to_segment_dist(vpos, head, tail)
            dists.append((d, bname))
        dists.sort(key=lambda x: x[0])

        # Weight nearest 3 bones, inversely proportional to distance
        top = dists[:3]
        min_d = max(top[0][0], 0.001)
        weights = []
        for d, bname in top:
            w = max(0, 1.0 - (d / (min_d * 5)))
            if w > 0.01:
                weights.append((bname, w))

        if not weights:
            weights = [(top[0][1], 1.0)]

        total_w = sum(w for _, w in weights)
        for bname, w in weights:
            vg = mesh_obj.vertex_groups[bname]
            vg.add([v.index], w / total_w, "REPLACE")


# ── Animation helpers ────────────────────────────────────────────────
def ensure_action(arm_obj, name, frame_start, frame_end):
    action = bpy.data.actions.new(name=name)
    action.frame_range = (frame_start, frame_end)
    arm_obj.animation_data_create()
    arm_obj.animation_data.action = action
    return action


def keyframe_bone_rot(arm_obj, bone_name, frame, euler_deg):
    pb = arm_obj.pose.bones.get(bone_name)
    if not pb:
        return
    pb.rotation_mode = "XYZ"
    pb.rotation_euler = Euler((math.radians(euler_deg[0]), math.radians(euler_deg[1]), math.radians(euler_deg[2])))
    pb.keyframe_insert(data_path="rotation_euler", frame=frame)


def keyframe_bone_loc(arm_obj, bone_name, frame, loc):
    pb = arm_obj.pose.bones.get(bone_name)
    if not pb:
        return
    pb.location = Vector(loc)
    pb.keyframe_insert(data_path="location", frame=frame)


def reset_pose(arm_obj):
    for pb in arm_obj.pose.bones:
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = Euler((0, 0, 0))
        pb.location = Vector((0, 0, 0))


ALL_LEG_BONES = []
for i in range(1, 5):
    for side in ["R", "L"]:
        ALL_LEG_BONES.extend([f"Leg_{side}{i}_Hip", f"Leg_{side}{i}_Knee", f"Leg_{side}{i}_Foot"])


def set_all_linear(action):
    for fc in action.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"


# ── Animations ───────────────────────────────────────────────────────
def anim_idle(arm_obj):
    """Subtle body bob + alternating leg twitch."""
    FPS = 24
    FRAMES = 72  # 3 seconds
    action = ensure_action(arm_obj, "Idle", 1, FRAMES)

    for f in [1, 19, 37, 55, 72]:
        reset_pose(arm_obj)
        phase = (f - 1) / FRAMES * 2 * math.pi
        bob = math.sin(phase) * 2
        keyframe_bone_rot(arm_obj, "Root", f, (bob, 0, 0))
        keyframe_bone_rot(arm_obj, "Head", f, (bob * 0.5, math.sin(phase * 2) * 3, 0))
        keyframe_bone_rot(arm_obj, "Abdomen", f, (-bob * 0.3, 0, 0))

        for i in range(1, 5):
            leg_phase = phase + (i - 1) * math.pi / 4
            amt = math.sin(leg_phase) * 5
            for side, flip in [("R", 1), ("L", -1)]:
                keyframe_bone_rot(arm_obj, f"Leg_{side}{i}_Hip", f, (amt * flip, 0, amt * 0.5))
                keyframe_bone_rot(arm_obj, f"Leg_{side}{i}_Knee", f, (amt * 0.3, 0, 0))

    set_all_linear(action)
    return action


def anim_walk(arm_obj, name="Walking", speed=1.0):
    """Walk cycle — alternating leg groups."""
    FRAMES = int(48 / speed)
    action = ensure_action(arm_obj, name, 1, FRAMES)

    for f_i in range(FRAMES + 1):
        f = f_i + 1
        reset_pose(arm_obj)
        phase = f_i / FRAMES * 2 * math.pi

        sway = math.sin(phase) * 3
        keyframe_bone_rot(arm_obj, "Root", f, (0, 0, sway))
        keyframe_bone_rot(arm_obj, "Head", f, (0, math.sin(phase * 2) * 4, 0))

        for i in range(1, 5):
            # Alternating gait: odd legs with even legs out of phase
            leg_offset = 0 if (i % 2 == 1) else math.pi
            lp = phase * 2 + leg_offset
            hip_swing = math.sin(lp) * 20 * speed
            knee_lift = max(0, math.sin(lp)) * 15 * speed

            for side, flip in [("R", 1), ("L", -1)]:
                side_offset = 0 if side == "R" else math.pi
                hip_s = math.sin(lp + side_offset) * 20 * speed
                knee_l = max(0, math.sin(lp + side_offset)) * 15 * speed
                keyframe_bone_rot(arm_obj, f"Leg_{side}{i}_Hip", f, (hip_s, 0, knee_l * flip * 0.3))
                keyframe_bone_rot(arm_obj, f"Leg_{side}{i}_Knee", f, (-knee_l, 0, 0))
                keyframe_bone_rot(arm_obj, f"Leg_{side}{i}_Foot", f, (knee_l * 0.5, 0, 0))

    set_all_linear(action)
    return action


def anim_attack(arm_obj, name="Attack", intensity=1.0):
    """Lunge forward with front legs striking."""
    FRAMES = 36
    action = ensure_action(arm_obj, name, 1, FRAMES)

    # Frame 1: rest
    reset_pose(arm_obj)
    keyframe_bone_rot(arm_obj, "Root", 1, (0, 0, 0))
    keyframe_bone_loc(arm_obj, "Root", 1, (0, 0, 0))
    keyframe_bone_rot(arm_obj, "Head", 1, (0, 0, 0))
    keyframe_bone_rot(arm_obj, "Abdomen", 1, (0, 0, 0))
    for bn in ALL_LEG_BONES:
        keyframe_bone_rot(arm_obj, bn, 1, (0, 0, 0))

    # Frame 8: rear up
    reset_pose(arm_obj)
    tilt = -15 * intensity
    keyframe_bone_rot(arm_obj, "Root", 8, (tilt, 0, 0))
    keyframe_bone_rot(arm_obj, "Head", 8, (tilt * 0.5, 0, 0))
    keyframe_bone_rot(arm_obj, "Abdomen", 8, (10, 0, 0))
    for side in ["R", "L"]:
        flip = 1 if side == "R" else -1
        keyframe_bone_rot(arm_obj, f"Leg_{side}1_Hip", 8, (-40 * intensity, 0, -20 * flip * intensity))
        keyframe_bone_rot(arm_obj, f"Leg_{side}1_Knee", 8, (-30 * intensity, 0, 0))
        keyframe_bone_rot(arm_obj, f"Leg_{side}2_Hip", 8, (-25 * intensity, 0, -10 * flip * intensity))
        keyframe_bone_rot(arm_obj, f"Leg_{side}2_Knee", 8, (-20 * intensity, 0, 0))
        keyframe_bone_rot(arm_obj, f"Leg_{side}3_Hip", 8, (10, 0, 0))
        keyframe_bone_rot(arm_obj, f"Leg_{side}4_Hip", 8, (15, 0, 0))

    # Frame 16: strike down
    reset_pose(arm_obj)
    keyframe_bone_rot(arm_obj, "Root", 16, (20 * intensity, 0, 0))
    keyframe_bone_loc(arm_obj, "Root", 16, (0, -0.05 * intensity, -0.02))
    keyframe_bone_rot(arm_obj, "Head", 16, (25 * intensity, 0, 0))
    keyframe_bone_rot(arm_obj, "Abdomen", 16, (-5, 0, 0))
    for side in ["R", "L"]:
        flip = 1 if side == "R" else -1
        keyframe_bone_rot(arm_obj, f"Leg_{side}1_Hip", 16, (35 * intensity, 0, 15 * flip * intensity))
        keyframe_bone_rot(arm_obj, f"Leg_{side}1_Knee", 16, (25 * intensity, 0, 0))
        keyframe_bone_rot(arm_obj, f"Leg_{side}2_Hip", 16, (20 * intensity, 0, 5 * flip))
        keyframe_bone_rot(arm_obj, f"Leg_{side}2_Knee", 16, (15, 0, 0))

    # Frame 26: recover
    reset_pose(arm_obj)
    keyframe_bone_rot(arm_obj, "Root", 26, (-5, 0, 0))
    keyframe_bone_loc(arm_obj, "Root", 26, (0, 0, 0))
    keyframe_bone_rot(arm_obj, "Head", 26, (-3, 0, 0))
    for bn in ALL_LEG_BONES:
        keyframe_bone_rot(arm_obj, bn, 26, (0, 0, 0))

    # Frame 36: rest
    reset_pose(arm_obj)
    keyframe_bone_rot(arm_obj, "Root", FRAMES, (0, 0, 0))
    keyframe_bone_loc(arm_obj, "Root", FRAMES, (0, 0, 0))
    keyframe_bone_rot(arm_obj, "Head", FRAMES, (0, 0, 0))
    for bn in ALL_LEG_BONES:
        keyframe_bone_rot(arm_obj, bn, FRAMES, (0, 0, 0))

    set_all_linear(action)
    return action


def anim_hurt(arm_obj, name="Hit_Reaction"):
    """Flinch backward."""
    FRAMES = 30
    action = ensure_action(arm_obj, name, 1, FRAMES)

    reset_pose(arm_obj)
    keyframe_bone_rot(arm_obj, "Root", 1, (0, 0, 0))
    keyframe_bone_loc(arm_obj, "Root", 1, (0, 0, 0))
    for bn in ALL_LEG_BONES:
        keyframe_bone_rot(arm_obj, bn, 1, (0, 0, 0))

    # Frame 8: flinch
    reset_pose(arm_obj)
    keyframe_bone_rot(arm_obj, "Root", 8, (-12, 0, 5))
    keyframe_bone_loc(arm_obj, "Root", 8, (0, 0.03, 0.01))
    keyframe_bone_rot(arm_obj, "Head", 8, (-15, 8, 0))
    keyframe_bone_rot(arm_obj, "Abdomen", 8, (8, 0, -3))
    for side in ["R", "L"]:
        flip = 1 if side == "R" else -1
        for i in range(1, 5):
            keyframe_bone_rot(arm_obj, f"Leg_{side}{i}_Hip", 8, (-15, 0, -10 * flip))
            keyframe_bone_rot(arm_obj, f"Leg_{side}{i}_Knee", 8, (-10, 0, 0))

    # Frame 20: settle
    reset_pose(arm_obj)
    keyframe_bone_rot(arm_obj, "Root", 20, (-3, 0, 1))
    keyframe_bone_loc(arm_obj, "Root", 20, (0, 0.01, 0))
    for bn in ALL_LEG_BONES:
        keyframe_bone_rot(arm_obj, bn, 20, (0, 0, 0))

    reset_pose(arm_obj)
    keyframe_bone_rot(arm_obj, "Root", FRAMES, (0, 0, 0))
    keyframe_bone_loc(arm_obj, "Root", FRAMES, (0, 0, 0))
    for bn in ALL_LEG_BONES:
        keyframe_bone_rot(arm_obj, bn, FRAMES, (0, 0, 0))

    set_all_linear(action)
    return action


def anim_falling_down(arm_obj):
    """Collapse to ground — legs fold under."""
    FRAMES = 48
    action = ensure_action(arm_obj, "falling_down", 1, FRAMES)

    # Frame 1: standing
    reset_pose(arm_obj)
    keyframe_bone_rot(arm_obj, "Root", 1, (0, 0, 0))
    keyframe_bone_loc(arm_obj, "Root", 1, (0, 0, 0))
    keyframe_bone_rot(arm_obj, "Head", 1, (0, 0, 0))
    keyframe_bone_rot(arm_obj, "Abdomen", 1, (0, 0, 0))
    for bn in ALL_LEG_BONES:
        keyframe_bone_rot(arm_obj, bn, 1, (0, 0, 0))

    # Frame 12: stagger
    reset_pose(arm_obj)
    keyframe_bone_rot(arm_obj, "Root", 12, (-8, 0, 10))
    keyframe_bone_loc(arm_obj, "Root", 12, (0, 0, -0.05))
    keyframe_bone_rot(arm_obj, "Head", 12, (-10, 5, 0))

    # Frame 28: crumple — legs splay outward, body drops
    reset_pose(arm_obj)
    keyframe_bone_rot(arm_obj, "Root", 28, (25, 0, 8))
    keyframe_bone_loc(arm_obj, "Root", 28, (0, 0, -0.25))
    keyframe_bone_rot(arm_obj, "Head", 28, (30, 0, 0))
    keyframe_bone_rot(arm_obj, "Abdomen", 28, (-10, 0, 0))
    for side in ["R", "L"]:
        flip = 1 if side == "R" else -1
        for i in range(1, 5):
            keyframe_bone_rot(arm_obj, f"Leg_{side}{i}_Hip", 28, (20, 0, 30 * flip))
            keyframe_bone_rot(arm_obj, f"Leg_{side}{i}_Knee", 28, (35, 0, 0))
            keyframe_bone_rot(arm_obj, f"Leg_{side}{i}_Foot", 28, (20, 0, 0))

    # Frame 48: fully down
    reset_pose(arm_obj)
    keyframe_bone_rot(arm_obj, "Root", FRAMES, (35, 0, 5))
    keyframe_bone_loc(arm_obj, "Root", FRAMES, (0, 0, -0.35))
    keyframe_bone_rot(arm_obj, "Head", FRAMES, (40, 0, 0))
    keyframe_bone_rot(arm_obj, "Abdomen", FRAMES, (-15, 0, 0))
    for side in ["R", "L"]:
        flip = 1 if side == "R" else -1
        for i in range(1, 5):
            keyframe_bone_rot(arm_obj, f"Leg_{side}{i}_Hip", FRAMES, (25, 0, 40 * flip))
            keyframe_bone_rot(arm_obj, f"Leg_{side}{i}_Knee", FRAMES, (45, 0, 0))
            keyframe_bone_rot(arm_obj, f"Leg_{side}{i}_Foot", FRAMES, (25, 0, 0))

    set_all_linear(action)
    return action


def anim_dead(arm_obj):
    """Legs curl inward — classic dead spider pose."""
    FRAMES = 48
    action = ensure_action(arm_obj, "Dead", 1, FRAMES)

    # Frame 1: standing
    reset_pose(arm_obj)
    keyframe_bone_rot(arm_obj, "Root", 1, (0, 0, 0))
    keyframe_bone_loc(arm_obj, "Root", 1, (0, 0, 0))
    keyframe_bone_rot(arm_obj, "Head", 1, (0, 0, 0))
    keyframe_bone_rot(arm_obj, "Abdomen", 1, (0, 0, 0))
    for bn in ALL_LEG_BONES:
        keyframe_bone_rot(arm_obj, bn, 1, (0, 0, 0))

    # Frame 20: start curling
    reset_pose(arm_obj)
    keyframe_bone_rot(arm_obj, "Root", 20, (15, 0, 0))
    keyframe_bone_loc(arm_obj, "Root", 20, (0, 0, -0.15))
    keyframe_bone_rot(arm_obj, "Head", 20, (20, 0, 0))
    keyframe_bone_rot(arm_obj, "Abdomen", 20, (10, 0, 0))
    for side in ["R", "L"]:
        flip = 1 if side == "R" else -1
        for i in range(1, 5):
            keyframe_bone_rot(arm_obj, f"Leg_{side}{i}_Hip", 20, (-30, 0, -20 * flip))
            keyframe_bone_rot(arm_obj, f"Leg_{side}{i}_Knee", 20, (-50, 0, 0))
            keyframe_bone_rot(arm_obj, f"Leg_{side}{i}_Foot", 20, (-30, 0, 0))

    # Frame 48: fully dead — legs curled tight
    reset_pose(arm_obj)
    keyframe_bone_rot(arm_obj, "Root", FRAMES, (20, 5, 0))
    keyframe_bone_loc(arm_obj, "Root", FRAMES, (0, 0, -0.30))
    keyframe_bone_rot(arm_obj, "Head", FRAMES, (30, 0, 0))
    keyframe_bone_rot(arm_obj, "Abdomen", FRAMES, (15, 0, 0))
    for side in ["R", "L"]:
        flip = 1 if side == "R" else -1
        for i in range(1, 5):
            keyframe_bone_rot(arm_obj, f"Leg_{side}{i}_Hip", FRAMES, (-45, 0, -30 * flip))
            keyframe_bone_rot(arm_obj, f"Leg_{side}{i}_Knee", FRAMES, (-65, 0, 0))
            keyframe_bone_rot(arm_obj, f"Leg_{side}{i}_Foot", FRAMES, (-40, 0, 0))

    set_all_linear(action)
    return action


def anim_arise(arm_obj):
    """Stand up from fallen position."""
    FRAMES = 48
    action = ensure_action(arm_obj, "Arise", 1, FRAMES)

    # Frame 1: down (matches falling_down end pose)
    reset_pose(arm_obj)
    keyframe_bone_rot(arm_obj, "Root", 1, (35, 0, 5))
    keyframe_bone_loc(arm_obj, "Root", 1, (0, 0, -0.35))
    keyframe_bone_rot(arm_obj, "Head", 1, (40, 0, 0))
    keyframe_bone_rot(arm_obj, "Abdomen", 1, (-15, 0, 0))
    for side in ["R", "L"]:
        flip = 1 if side == "R" else -1
        for i in range(1, 5):
            keyframe_bone_rot(arm_obj, f"Leg_{side}{i}_Hip", 1, (25, 0, 40 * flip))
            keyframe_bone_rot(arm_obj, f"Leg_{side}{i}_Knee", 1, (45, 0, 0))
            keyframe_bone_rot(arm_obj, f"Leg_{side}{i}_Foot", 1, (25, 0, 0))

    # Frame 20: halfway up
    reset_pose(arm_obj)
    keyframe_bone_rot(arm_obj, "Root", 20, (15, 0, 2))
    keyframe_bone_loc(arm_obj, "Root", 20, (0, 0, -0.15))
    keyframe_bone_rot(arm_obj, "Head", 20, (15, 0, 0))
    keyframe_bone_rot(arm_obj, "Abdomen", 20, (-5, 0, 0))
    for side in ["R", "L"]:
        flip = 1 if side == "R" else -1
        for i in range(1, 5):
            keyframe_bone_rot(arm_obj, f"Leg_{side}{i}_Hip", 20, (10, 0, 15 * flip))
            keyframe_bone_rot(arm_obj, f"Leg_{side}{i}_Knee", 20, (15, 0, 0))

    # Frame 48: standing
    reset_pose(arm_obj)
    keyframe_bone_rot(arm_obj, "Root", FRAMES, (0, 0, 0))
    keyframe_bone_loc(arm_obj, "Root", FRAMES, (0, 0, 0))
    keyframe_bone_rot(arm_obj, "Head", FRAMES, (0, 0, 0))
    keyframe_bone_rot(arm_obj, "Abdomen", FRAMES, (0, 0, 0))
    for bn in ALL_LEG_BONES:
        keyframe_bone_rot(arm_obj, bn, FRAMES, (0, 0, 0))

    set_all_linear(action)
    return action


def anim_scream(arm_obj):
    """Rear up aggressively — front legs wide, head up."""
    FRAMES = 48
    action = ensure_action(arm_obj, "Zombie_Scream", 1, FRAMES)

    reset_pose(arm_obj)
    keyframe_bone_rot(arm_obj, "Root", 1, (0, 0, 0))
    keyframe_bone_loc(arm_obj, "Root", 1, (0, 0, 0))
    for bn in ALL_LEG_BONES:
        keyframe_bone_rot(arm_obj, bn, 1, (0, 0, 0))

    # Frame 12: rear up
    reset_pose(arm_obj)
    keyframe_bone_rot(arm_obj, "Root", 12, (-20, 0, 0))
    keyframe_bone_loc(arm_obj, "Root", 12, (0, 0, 0.08))
    keyframe_bone_rot(arm_obj, "Head", 12, (-25, 0, 0))
    keyframe_bone_rot(arm_obj, "Abdomen", 12, (15, 0, 0))
    for side in ["R", "L"]:
        flip = 1 if side == "R" else -1
        keyframe_bone_rot(arm_obj, f"Leg_{side}1_Hip", 12, (-45, 0, -30 * flip))
        keyframe_bone_rot(arm_obj, f"Leg_{side}1_Knee", 12, (-20, 0, 0))
        keyframe_bone_rot(arm_obj, f"Leg_{side}2_Hip", 12, (-35, 0, -20 * flip))
        keyframe_bone_rot(arm_obj, f"Leg_{side}2_Knee", 12, (-15, 0, 0))
        keyframe_bone_rot(arm_obj, f"Leg_{side}3_Hip", 12, (5, 0, 5 * flip))
        keyframe_bone_rot(arm_obj, f"Leg_{side}4_Hip", 12, (10, 0, 10 * flip))

    # Frame 28: hold
    reset_pose(arm_obj)
    keyframe_bone_rot(arm_obj, "Root", 28, (-18, 0, 0))
    keyframe_bone_loc(arm_obj, "Root", 28, (0, 0, 0.06))
    keyframe_bone_rot(arm_obj, "Head", 28, (-22, 5, 0))
    keyframe_bone_rot(arm_obj, "Abdomen", 28, (12, 0, 0))
    for side in ["R", "L"]:
        flip = 1 if side == "R" else -1
        keyframe_bone_rot(arm_obj, f"Leg_{side}1_Hip", 28, (-40, 0, -35 * flip))
        keyframe_bone_rot(arm_obj, f"Leg_{side}1_Knee", 28, (-25, 0, 0))
        keyframe_bone_rot(arm_obj, f"Leg_{side}2_Hip", 28, (-30, 0, -25 * flip))

    # Frame 48: back to rest
    reset_pose(arm_obj)
    keyframe_bone_rot(arm_obj, "Root", FRAMES, (0, 0, 0))
    keyframe_bone_loc(arm_obj, "Root", FRAMES, (0, 0, 0))
    for bn in ALL_LEG_BONES:
        keyframe_bone_rot(arm_obj, bn, FRAMES, (0, 0, 0))

    set_all_linear(action)
    return action


def anim_alert(arm_obj):
    """Quick side-to-side alert turn."""
    FRAMES = 36
    action = ensure_action(arm_obj, "Alert", 1, FRAMES)

    reset_pose(arm_obj)
    keyframe_bone_rot(arm_obj, "Root", 1, (0, 0, 0))
    keyframe_bone_rot(arm_obj, "Head", 1, (0, 0, 0))
    for bn in ALL_LEG_BONES:
        keyframe_bone_rot(arm_obj, bn, 1, (0, 0, 0))

    reset_pose(arm_obj)
    keyframe_bone_rot(arm_obj, "Root", 10, (0, -15, 0))
    keyframe_bone_rot(arm_obj, "Head", 10, (0, -20, -5))

    reset_pose(arm_obj)
    keyframe_bone_rot(arm_obj, "Root", 22, (0, 12, 0))
    keyframe_bone_rot(arm_obj, "Head", 22, (0, 18, 5))

    reset_pose(arm_obj)
    keyframe_bone_rot(arm_obj, "Root", FRAMES, (0, 0, 0))
    keyframe_bone_rot(arm_obj, "Head", FRAMES, (0, 0, 0))

    set_all_linear(action)
    return action


# ── Export ────────────────────────────────────────────────────────────
def push_all_actions_to_nla(arm_obj):
    """Push each action as an NLA track so all export in one GLB."""
    if not arm_obj.animation_data:
        arm_obj.animation_data_create()
    for action in bpy.data.actions:
        track = arm_obj.animation_data.nla_tracks.new()
        track.name = action.name
        strip = track.strips.new(action.name, int(action.frame_range[0]), action)
        strip.name = action.name
    arm_obj.animation_data.action = None


def export_glb(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_animations=True,
        export_nla_strips=True,
        export_nla_strips_merged_animation_name="",
        export_skins=True,
        export_apply=False,
        export_yup=True,
    )
    size_mb = os.path.getsize(path) / 1e6
    print(f"Exported: {path} ({size_mb:.1f} MB)")


# ── Main ─────────────────────────────────────────────────────────────
def main():
    print("=== Spider Rig + Animation Pipeline ===")
    print(f"Input:  {INPUT_GLB}")
    print(f"Output: {OUTPUT_GLB}")

    clear_scene()
    mesh_obj = import_glb(INPUT_GLB)
    print(f"Imported mesh: {mesh_obj.name} ({len(mesh_obj.data.vertices)} verts)")

    arm_obj = build_armature()
    print(f"Armature created: {len(arm_obj.data.bones)} bones")

    parent_with_weights(mesh_obj, arm_obj)

    # Create all animations
    actions = []
    actions.append(anim_idle(arm_obj))
    actions.append(anim_walk(arm_obj, "Walking", 0.7))
    actions.append(anim_walk(arm_obj, "Running", 1.5))
    actions.append(anim_attack(arm_obj, "Jumping_Punch", 1.2))  # Heavy attack (die 1)
    actions.append(anim_attack(arm_obj, "Left_Slash", 0.8))      # Medium attack (die 2)
    actions.append(anim_attack(arm_obj, "Skill_01", 0.5))        # Light attack (die 3)
    actions.append(anim_hurt(arm_obj, "Hit_Reaction_to_Waist"))
    actions.append(anim_hurt(arm_obj, "Face_Punch_Reaction_2"))
    actions.append(anim_falling_down(arm_obj))
    actions.append(anim_dead(arm_obj))
    actions.append(anim_arise(arm_obj))
    actions.append(anim_scream(arm_obj))
    actions.append(anim_alert(arm_obj))

    print(f"Created {len(actions)} animations: {', '.join(a.name for a in actions)}")

    push_all_actions_to_nla(arm_obj)
    export_glb(OUTPUT_GLB)
    print("Done!")


main()
