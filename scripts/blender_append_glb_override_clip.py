"""
Append or replace a single animation clip inside an existing merged GLB.

Usage:
  blender --background --python scripts/blender_append_glb_override_clip.py -- \
    <base_glb> <override_glb> <output_glb> [--clip <clip_name>]

Typical use:
  blender --background --python scripts/blender_append_glb_override_clip.py -- \
    public/models/monsters/dracula.glb \
    "/Users/me/Downloads/Meshy_AI_Animation_Shot_and_Slow_Fall_Backward_withSkin.glb" \
    public/models/monsters/dracula.glb \
    --clip Shot_and_Slow_Fall_Backward
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import bpy

CLIP_RE = re.compile(r"Animation_(.+?)_withSkin\.glb$", re.IGNORECASE)
_DUP_RE = re.compile(r"^(.+)\.\d+$")


def _argv_after_dd() -> list[str]:
    if "--" in sys.argv:
        return sys.argv[sys.argv.index("--") + 1 :]
    return []


def clip_name_from_filename(path: str) -> str:
    m = CLIP_RE.search(path)
    if m:
        return m.group(1)
    return Path(path).stem


def sanitize_action_name(name: str) -> str:
    parts = name.split("|")
    if len(parts) >= 2:
        return parts[1]
    return name


def base_clip_name(name: str) -> str:
    m = _DUP_RE.match(name)
    return m.group(1) if m else name


def import_glb(path: Path) -> None:
    bpy.ops.import_scene.gltf(filepath=str(path), merge_vertices=False)


def find_armature(objects: list[bpy.types.Object]) -> bpy.types.Object | None:
    for o in objects:
        if o.type == "ARMATURE":
            return o
    for o in objects:
        if o.type == "MESH":
            for m in o.modifiers:
                if m.type == "ARMATURE" and m.object:
                    return m.object
    return None


def delete_objects(obs: list[bpy.types.Object]) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for o in obs:
        if o.name in bpy.data.objects:
            o.select_set(True)
    bpy.ops.object.delete(use_global=False)


def copy_action(src_action: bpy.types.Action, new_name: str) -> bpy.types.Action:
    dst = src_action.copy()
    dst.use_fake_user = True
    existing = bpy.data.actions.get(new_name)
    if existing is not None and existing != dst and existing.users == 0:
        bpy.data.actions.remove(existing)
    dst.name = new_name
    return dst


def harvest_actions_from_merged_glb(glb_path: Path) -> tuple[list[bpy.types.Object], bpy.types.Object, dict[str, bpy.types.Action]]:
    import_glb(glb_path)
    base_objs = list(bpy.context.selected_objects)
    base_arm = find_armature(base_objs)
    if not base_arm:
        raise RuntimeError(f"No armature in base GLB: {glb_path}")

    actions_by_clip: dict[str, bpy.types.Action] = {}
    if base_arm.animation_data:
        for track in base_arm.animation_data.nla_tracks:
            for strip in track.strips:
                if not strip.action:
                    continue
                clean = sanitize_action_name(strip.action.name)
                if clean not in actions_by_clip:
                    actions_by_clip[clean] = copy_action(strip.action, clean)
        if base_arm.animation_data.action:
            clean = sanitize_action_name(base_arm.animation_data.action.name)
            if clean not in actions_by_clip:
                actions_by_clip[clean] = copy_action(base_arm.animation_data.action, clean)

    return base_objs, base_arm, actions_by_clip


def extract_action_from_import(arm: bpy.types.Object, clip_name: str) -> bpy.types.Action | None:
    if arm.animation_data and arm.animation_data.action:
        return copy_action(arm.animation_data.action, clip_name)
    acts = [a for a in bpy.data.actions if a.users > 0]
    if acts:
        return copy_action(max(acts, key=lambda a: a.name), clip_name)
    return None


def build_nla(arm: bpy.types.Object, actions: list[bpy.types.Action]) -> None:
    if not arm.animation_data:
        arm.animation_data_create()
    arm.animation_data.action = None
    while arm.animation_data.nla_tracks:
        arm.animation_data.nla_tracks.remove(arm.animation_data.nla_tracks[0])

    t_cursor = 0.0
    for act in actions:
        track = arm.animation_data.nla_tracks.new()
        track.name = act.name
        fr0, fr1 = act.frame_range[0], act.frame_range[1]
        length = max(fr1 - fr0, 1.0)
        strip = track.strips.new(act.name, int(t_cursor), act)
        strip.action_frame_start = fr0
        strip.action_frame_end = fr1
        t_cursor += length + 5.0


def main() -> None:
    args = _argv_after_dd()
    clip_name: str | None = None
    if "--clip" in args:
        i = args.index("--clip")
        if i + 1 >= len(args):
            raise SystemExit("--clip requires a value")
        clip_name = args[i + 1]
        del args[i : i + 2]

    if len(args) != 3:
        raise SystemExit("Usage: <base_glb> <override_glb> <output_glb> [--clip name]")

    base_glb = Path(args[0]).expanduser().resolve()
    override_glb = Path(args[1]).expanduser().resolve()
    out_glb = Path(args[2]).expanduser().resolve()
    if not base_glb.is_file():
        raise SystemExit(f"Base GLB not found: {base_glb}")
    if not override_glb.is_file():
        raise SystemExit(f"Override GLB not found: {override_glb}")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    base_objs, base_arm, actions_by_clip = harvest_actions_from_merged_glb(base_glb)

    pre_actions = {a.name for a in bpy.data.actions}
    import_glb(override_glb)
    imp = list(bpy.context.selected_objects)
    imp_arm = find_armature(imp)
    if not imp_arm:
        delete_objects(imp)
        raise SystemExit(f"No armature in override GLB: {override_glb}")

    override_name = clip_name or clip_name_from_filename(override_glb.name)
    dup = extract_action_from_import(imp_arm, override_name)
    delete_objects(imp)
    if dup:
        for k in list(actions_by_clip.keys()):
            if base_clip_name(k) == override_name:
                old = actions_by_clip.pop(k, None)
                if old is not None:
                    old.use_fake_user = False
                    try:
                        bpy.data.actions.remove(old)
                    except Exception:
                        pass
        actions_by_clip[override_name] = dup

    for a in list(bpy.data.actions):
        if a.name in pre_actions:
            continue
        if a.users == 0 and a not in actions_by_clip.values():
            try:
                bpy.data.actions.remove(a)
            except Exception:
                pass

    unique_actions = sorted(actions_by_clip.values(), key=lambda x: x.name.lower())
    build_nla(base_arm, unique_actions)

    referenced: set[bpy.types.Action] = set()
    for track in base_arm.animation_data.nla_tracks:
        for strip in track.strips:
            if strip.action:
                referenced.add(strip.action)
    for act in list(bpy.data.actions):
        if act in referenced:
            continue
        act.use_fake_user = False
        try:
            bpy.data.actions.remove(act)
        except Exception:
            pass

    bpy.ops.object.select_all(action="DESELECT")
    for o in base_objs:
        if o.name in bpy.data.objects:
            o.select_set(True)
    bpy.context.view_layer.objects.active = base_arm

    out_glb.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(out_glb),
        export_format="GLB",
        use_selection=True,
        export_animations=True,
        export_nla_strips=True,
        export_yup=True,
        export_apply=False,
    )
    print(f"Wrote {out_glb} with override clip {override_name}")


if __name__ == "__main__":
    main()
