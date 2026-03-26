# Monster GLB assets (optional 3D combat portraits)

Combat UI can show **glTF** models instead of PNG sprites when **`NEXT_PUBLIC_MONSTER_3D=1`** is set at build time (e.g. in `.env.local`).

**Reference (clip names per combat state):**

- With dev server: [`/monster-3d-animations`](http://localhost:3000/monster-3d-animations) (data from `lib/monsterModels3d.ts`)
- Static copy: [`/monster-3d-animation-reference.html`](/monster-3d-animation-reference.html) (update if clip lists change)

## File names

Place one binary glTF per creature (`.glb`):

| File            | Monster        | `MonsterType` |
|-----------------|----------------|---------------|
| `dracula.glb`   | Dracula        | `V`           |
| `zombie.glb`    | Zombie         | `Z`           |
| `spider.glb`    | Spider         | `S`           |
| `ghost.glb`     | Ghost          | `G`           |
| `skeleton.glb`  | Skeleton       | `K`           |
| `lava.glb`      | Lava elemental | `L`           |

Paths are served as `/models/monsters/<name>.glb` (mapping lives in `lib/monsterModels3d.ts` in the repo root).

## Export conventions

- **Origin at the feet** on the ground plane; Y-up.
- **Full body** visible in a neutral bind pose (T-pose or slight A-pose).
- **Consistent scale** across monsters so framing in the combat header stays predictable (tune once in Blender, then export).
- **Animations (optional):** clip names are matched heuristically (`Idle`, `Attack`, `Hurt`, …). Rename clips in the DCC tool to match, or the first reasonable clip is played.

If a file is missing or fails to load, the UI **falls back to the existing 2D sprite** for that fight.

## Maze / grid (Phase 2)

The **labyrinth** still uses **2D sprites** (`public/monsters/...`). Putting a WebGL canvas in every cell is expensive. A practical follow-up is:

- **Billboards:** textured quads facing the camera, using current PNGs, or
- **One shared `<Canvas>`** with instancing / only nearby cells, if you need real geometry on the grid.

No maze 3D is wired until that phase is designed separately.
