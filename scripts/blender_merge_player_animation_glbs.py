"""
Merge a new Meshy biped player character with ALL animations from wasteland-drifter.glb.

All Meshy AI biped models share the same skeleton (bone names / hierarchy), so actions
from one biped can be applied to any other biped's armature. This script:
  1. Imports the new character's Walking GLB as the base mesh + armature (bind pose).
  2. Imports wasteland-drifter.glb to harvest every animation action.
  3. Copies those actions onto the new character's armature.
  4. Also imports the new character's own Running GLB (unique running animation).
  5. Builds NLA tracks and exports a single merged GLB with all clips.

Expected directory structure (per character):
  Meshy_AI_<CharName>_biped_Animation_Running_withSkin.glb
  Meshy_AI_<CharName>_biped_Animation_Walking_withSkin.glb

Run from repo root:
  blender --background --python scripts/blender_merge_player_animation_glbs.py -- \\
    "/path/to/Meshy_AI_Hooded_Wraith_biped" \\
    "/path/to/wasteland-drifter.glb" \\
    "public/models/player/hooded-wraith.glb"

  blender --background --python scripts/blender_merge_player_animation_glbs.py -- \\
    "/path/to/Meshy_AI_Shadowbound_Sorcerer_biped" \\
    "/path/to/wasteland-drifter.glb" \\
    "public/models/player/shadowbound-sorcerer.glb"

Then retarget node indices (same as monsters):
  node scripts/retarget-glb-animation-nodes.mjs \\
    public/models/player/hooded-wraith.glb \\
    public/models/player/hooded-wraith.glb \\
    --ref Walking
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


def extract_action_from_import(arm: bpy.types.Object, clip_name: str) -> bpy.types.Action | None:
    if arm.animation_data and arm.animation_data.action:
        return copy_action(arm.animation_data.action, clip_name)
    acts = [a for a in bpy.data.actions if a.users > 0]
    if acts:
        return copy_action(max(acts, key=lambda a: a.name), clip_name)
    return None


def sanitize_action_name(name: str) -> str:
    """Strip Blender prefixes like 'Armature|...|baselayer' → keep just the clip name."""
    parts = name.split("|")
    if len(parts) == 3:
        return parts[1]
    if len(parts) == 2:
        return parts[1]
    return name


def harvest_actions_from_glb(glb_path: Path) -> list[tuple[str, bpy.types.Action]]:
    """Import a GLB that has multiple NLA-baked animations, copy each action, then delete imported objects."""
    pre_actions = {a.name for a in bpy.data.actions}
    import_glb(glb_path)
    imp = list(bpy.context.selected_objects)
    imp_arm = find_armature(imp)

    harvested: list[tuple[str, bpy.types.Action]] = []

    if imp_arm and imp_arm.animation_data:
        # Collect from NLA tracks
        if imp_arm.animation_data.nla_tracks:
            for track in imp_arm.animation_data.nla_tracks:
                for strip in track.strips:
                    if strip.action:
                        clean_name = sanitize_action_name(strip.action.name)
                        dup = copy_action(strip.action, clean_name)
                        harvested.append((clean_name, dup))

        # Also check active action (some GLBs use action directly)
        if not harvested and imp_arm.animation_data.action:
            act = imp_arm.animation_data.action
            clean_name = sanitize_action_name(act.name)
            dup = copy_action(act, clean_name)
            harvested.append((clean_name, dup))

    # Also check any new actions created during import (Blender sometimes names them differently)
    if not harvested:
        for a in bpy.data.actions:
            if a.name not in pre_actions and a.users > 0:
                clean_name = sanitize_action_name(a.name)
                dup = copy_action(a, clean_name)
                harvested.append((clean_name, dup))

    delete_objects(imp)

    # Clean up orphaned actions from the import
    for a in list(bpy.data.actions):
        if a.name in pre_actions:
            continue
        if a.users == 0 and a not in [h[1] for h in harvested]:
            try:
                bpy.data.actions.remove(a)
            except Exception:
                pass

    return harvested


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
    if len(args) < 3:
        print(
            "Usage: blender --background --python scripts/blender_merge_player_animation_glbs.py -- "
            '<new_char_dir> <donor_player.glb> <output.glb>\n\n'
            'Example:\n'
            '  blender --background --python scripts/blender_merge_player_animation_glbs.py -- \\\n'
            '    ~/Downloads/Meshy_AI_Hooded_Wraith_biped \\\n'
            '    public/models/player/wasteland-drifter.glb \\\n'
            '    public/models/player/hooded-wraith.glb',
            file=sys.stderr,
        )
        sys.exit(1)

    char_dir = Path(args[0]).expanduser().resolve()
    donor_glb = Path(args[1]).expanduser().resolve()
    out_glb = Path(args[2]).expanduser().resolve()

    if not char_dir.is_dir():
        print(f"Not a directory: {char_dir}", file=sys.stderr)
        sys.exit(1)
    if not donor_glb.is_file():
        print(f"Donor GLB not found: {donor_glb}", file=sys.stderr)
        sys.exit(1)

    # Find the new character's animation GLBs
    char_glbs = sorted(char_dir.glob("*.glb"))
    if not char_glbs:
        print(f"No GLBs found in {char_dir}", file=sys.stderr)
        sys.exit(1)

    # Prefer Walking as the base mesh (calm bind pose)
    walking = next((p for p in char_glbs if "Walking" in p.name), char_glbs[0])
    other_char_glbs = [p for p in char_glbs if p != walking]

    print(f"Base mesh: {walking.name}")
    print(f"Donor GLB: {donor_glb.name}")
    print(f"Other character GLBs: {[p.name for p in other_char_glbs]}")

    # ──── Step 1: Import new character base mesh ────
    bpy.ops.wm.read_factory_settings(use_empty=True)
    import_glb(walking)
    base_objs = list(bpy.context.selected_objects)
    base_arm = find_armature(base_objs)
    if not base_arm:
        print("No armature in base character GLB", file=sys.stderr)
        sys.exit(1)

    bpy.ops.object.select_all(action="DESELECT")
    for o in base_objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = base_arm

    # Grab the base Walking action from the new character
    actions_by_clip: dict[str, bpy.types.Action] = {}
    base_clip = clip_name_from_filename(walking.name)
    a0 = extract_action_from_import(base_arm, base_clip)
    if a0:
        actions_by_clip[base_clip] = a0

    # ──── Step 2: Import other character animations (Running, etc.) ────
    for p in other_char_glbs:
        pre_actions = {a.name for a in bpy.data.actions}
        import_glb(p)
        imp = list(bpy.context.selected_objects)
        imp_arm = find_armature(imp)
        if not imp_arm:
            delete_objects(imp)
            print(f"  Skip (no armature): {p.name}")
            continue
        cn = clip_name_from_filename(p.name)
        dup = extract_action_from_import(imp_arm, cn)
        delete_objects(imp)
        if dup:
            actions_by_clip[cn] = dup
            print(f"  + {cn} (from new character)")
        for a in list(bpy.data.actions):
            if a.name in pre_actions:
                continue
            if a.users == 0 and a not in actions_by_clip.values():
                try:
                    bpy.data.actions.remove(a)
                except Exception:
                    pass

    # ──── Step 3: Harvest ALL animations from donor (wasteland-drifter.glb) ────
    print(f"\nHarvesting animations from donor: {donor_glb.name} ...")
    harvested = harvest_actions_from_glb(donor_glb)
    for clip_name, act in harvested:
        if clip_name not in actions_by_clip:
            actions_by_clip[clip_name] = act
            print(f"  + {clip_name} (from donor)")
        else:
            print(f"  = {clip_name} (skipped, character's own version kept)")
            act.use_fake_user = False
            try:
                bpy.data.actions.remove(act)
            except Exception:
                pass

    # ──── Step 4: Build NLA and export ────
    unique_actions = sorted(actions_by_clip.values(), key=lambda x: x.name.lower())
    build_nla(base_arm, unique_actions)

    # Clean up unreferenced actions
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
    clip_names = [a.name for a in unique_actions]
    print(f"\nWrote {out_glb} with {len(unique_actions)} actions:")
    for cn in clip_names:
        print(f"  - {cn}")
    print(
        f'\nNext: node scripts/retarget-glb-animation-nodes.mjs "{out_glb}" "{out_glb}" --ref Walking'
    )


if __name__ == "__main__":
    main()
