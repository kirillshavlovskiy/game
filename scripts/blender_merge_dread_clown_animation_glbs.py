"""
Merge Meshy per-animation GLBs for Dread Clown biped into one clown.glb with all clips.

Expects filenames like:
  Meshy_AI_Dread_Clown_in_the_Co_biped_Animation_<ClipName>_withSkin.glb

Base mesh/bind pose: Big_Heart_Gesture (idle), then every other clip is copied onto that armature.

  blender --background --python scripts/blender_merge_dread_clown_animation_glbs.py -- \\
    "/path/to/Meshy_AI_Dread_Clown_in_the_Co_biped" \\
    --output "/path/to/clown-merged.glb"

Then retarget (often required after merge):

  node scripts/retarget-glb-animation-nodes.mjs clown-merged.glb public/models/monsters/clown.glb --ref Big_Heart_Gesture
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import bpy

CLIP_RE = re.compile(r"Animation_(.+?)_withSkin\.glb$", re.IGNORECASE)


def _argv_after_dd() -> list[str]:
    if "--" in sys.argv:
        return sys.argv[sys.argv.index("--") + 1 :]
    return []


def clip_name_from_filename(path: str) -> str:
    m = CLIP_RE.search(path)
    if m:
        return m.group(1)
    return Path(path).stem


def list_input_glbs(directory: Path) -> list[Path]:
    paths = sorted(directory.glob("Meshy_AI_Dread_Clown_in_the_Co_biped_Animation_*_withSkin.glb"))
    if not paths:
        paths = sorted(directory.glob("*_Animation_*_withSkin.glb"))
    if not paths:
        paths = sorted(directory.glob("*.glb"))
    return paths


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


def copy_action_from_import(arm: bpy.types.Object, clip_name: str) -> bpy.types.Action | None:
    if not arm.animation_data or not arm.animation_data.action:
        acts = [a for a in bpy.data.actions if a.users > 0]
        if not acts:
            return None
        src = max(acts, key=lambda a: a.name)
    else:
        src = arm.animation_data.action
    dst = src.copy()
    dst.use_fake_user = True
    existing = bpy.data.actions.get(clip_name)
    if existing is not None and existing != dst and existing.users == 0:
        bpy.data.actions.remove(existing)
    dst.name = clip_name
    return dst


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

    in_dirs: list[Path] = []
    out_glb: Path | None = None
    i = 0
    while i < len(args):
        if args[i] == "--output" and i + 1 < len(args):
            out_glb = Path(args[i + 1]).expanduser().resolve()
            i += 2
            continue
        in_dirs.append(Path(args[i]).expanduser().resolve())
        i += 1

    if out_glb is None and len(in_dirs) >= 2 and not in_dirs[-1].is_dir():
        out_glb = in_dirs.pop()

    if not in_dirs or out_glb is None:
        print(
            "Usage: blender --background --python scripts/blender_merge_dread_clown_animation_glbs.py -- "
            "<dir1> [dir2 ...] --output <output.glb>\n"
            "  or:  <dir> <output.glb>  (legacy 2-arg form)",
            file=sys.stderr,
        )
        sys.exit(1)

    for d in in_dirs:
        if not d.is_dir():
            print(f"Not a directory: {d}", file=sys.stderr)
            sys.exit(1)

    paths: list[Path] = []
    seen_clips: set[str] = set()
    for d in in_dirs:
        for p in list_input_glbs(d):
            cn = clip_name_from_filename(p.name)
            if cn not in seen_clips:
                seen_clips.add(cn)
                paths.append(p)
            else:
                print(f"  Skip duplicate clip '{cn}': {p.name}")

    if not paths:
        print(f"No GLBs found in {[str(d) for d in in_dirs]}", file=sys.stderr)
        sys.exit(1)

    print(f"Found {len(paths)} unique animation GLBs from {len(in_dirs)} director(ies)")

    idle = next((p for p in paths if "Big_Heart_Gesture" in p.name), paths[0])
    rest = [p for p in paths if p != idle]

    bpy.ops.wm.read_factory_settings(use_empty=True)

    import_glb(idle)
    base_objs = list(bpy.context.selected_objects)
    base_arm = find_armature(base_objs)
    if not base_arm:
        print("No armature in base GLB", file=sys.stderr)
        sys.exit(1)

    bpy.ops.object.select_all(action="DESELECT")
    for o in base_objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = base_arm

    actions_by_clip: dict[str, bpy.types.Action] = {}
    base_clip = clip_name_from_filename(idle.name)
    a0 = copy_action_from_import(base_arm, base_clip)
    if a0:
        actions_by_clip[base_clip] = a0

    for p in sorted(rest, key=lambda x: x.name.lower()):
        pre_actions = {a.name for a in bpy.data.actions}
        import_glb(p)
        imp = list(bpy.context.selected_objects)
        imp_arm = find_armature(imp)
        if not imp_arm:
            delete_objects(imp)
            print(f"Skip (no armature): {p.name}")
            continue
        cn = clip_name_from_filename(p.name)
        dup = copy_action_from_import(imp_arm, cn)
        delete_objects(imp)
        if dup:
            actions_by_clip[cn] = dup
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
    print(f"Wrote {out_glb} with {len(unique_actions)} actions: {[a.name for a in unique_actions]}")
    print(
        "Next: node scripts/retarget-glb-animation-nodes.mjs "
        f'"{out_glb}" public/models/monsters/clown.glb --ref Big_Heart_Gesture'
    )


if __name__ == "__main__":
    main()
