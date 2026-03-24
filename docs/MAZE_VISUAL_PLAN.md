# Maze & dungeon visual plan

**Goal:** stylized **dark dungeon** (not realistic), **strong contrast**, **limited palette**, **glow-forward** readability — tuned for iPad, fast iteration, and consistency with emoji/sprite combat.

**Anti-pattern:** mixing **photoreal PBR** materials with **flat sprites** (monsters, UI). Stay **stylized** end-to-end.

---

## 1. Art stack (approved combo)

| Layer | Source | Notes |
|--------|--------|--------|
| **Base tiles** | **Kenney** — [Roguelike Dungeon](https://kenney.nl/assets/roguelike-dungeon) and/or [Tiny Dungeon](https://kenney.nl/assets/tiny-dungeon) | CC0. Use as **geometry/layout** reference; **do not ship raw** — see §2. |
| **Horror pass (color)** | Custom — darken, desaturate, blue/purple tint | Applied in batch (script or image editor) so it reads **horror**, not cartoon. |
| **Atmosphere** | **OpenGameArt decals** + **horror pack already in repo** (`public/textures/maze/`) | **Separate layer** from base tiles — not baked into albedo. |
| **Gameplay reads** | Custom sprites (traps, web, artifact glow, exit, holy) | Brighter than floor, clear silhouette, subtle glow. |
| **Depth** | **Lighting + fog + telegraphs** | Primary “scary”; textures support, don’t carry the whole mood. |

---

## 2. Style modification (required for Kenney)

Before using Kenney tiles in-game:

- Darken globally (~20–40% depending on tile).
- Desaturate (~15–30%).
- Tint shadows toward **blue/purple** (`#1a1428`–`#2a2240` range), keep highlights controlled.

Output: tile PNGs that match the **locked palette** (§10), not stock Kenney saturation.

---

## 3. Core tileset (foundation)

**Needed variants (logical set, can be authored from Kenney + wall/floor horror sheets):**

- **Floor:** 4–6 variations (for `hash(x,y)` or zone-based pick).
- **Wall:** straight, corner, T, cross (autotile or manual neighbor rules later).
- **Door:** open / closed.
- **Void:** single dark tile (non-walkable “pit” / off-grid feel).

**Current repo shortcut:** `public/textures/maze/Floor/Horror_Floor_*` and `Wall/Horror_Wall_*` (and `Brick/`, `Stone/`) are **256×256 stylized slabs** — use as **interim base diffuse** until Kenney+post pipeline is ready; still apply **palette + CSS gradient** in `mazeCellTheme` so contrast stays gameplay-first.

---

## 4. Horror overlays (decals — separate layer)

**Do not merge into wall/floor PNGs.** Render as optional `::after`, absolutely positioned child, or future canvas layer with low opacity and `mix-blend-mode`.

| Spec name | Role | Map from current pack (starting point) |
|-----------|------|----------------------------------------|
| `blood_splatter_01.png` / `02.png` | Random / combat-adjacent | `Stains/Horror_Stain_*.png` (pick 2–4, rename in `overlays/blood/`) |
| `crack_floor.png` | Floor damage | `Stone/` or cracked-looking `Floor/` variants |
| `dark_stain.png` | Ambient grime | Darker `Stains/` |
| `ritual_circle.png` | Special zones | `Misc/` (circle / rune-like assets if present) |
| `scratch_marks.png` | Walls / dead ends | `Misc/` or `Wall/` detail tiles |

**Placement rules (design):**

- Random subset of path cells (seeded by coordinate for stability).
- Bias near **traps**, **dead ends**, **Dracula-adjacent** tiles (when those hooks exist in state).

---

## 5. Interactive tiles / objects (sprites, not albedo)

Separate PNGs, drawn **above** floor, below or above entities per sort rule:

- `web_tile.png`, `trap_tile.png`, `artifact_glow.png`, `exit_tile.png`, `holy_tile.png`

**Rules:** brighter than floor, readable silhouette, subtle outer glow (CSS `filter` or pre-multiplied PNG).

---

## 6. Monsters

Keep current sprite direction: **same outline thickness, light direction, shadow style, saturation band.**

Add: **`shadow_blob.png`** under every monster for grounding (single shared asset, scaled).

Optional **rim glow** by type (design table):

| Monster | Glow hint |
|---------|-----------|
| Dracula | red + purple |
| Ghost | blue |
| Zombie | green |
| Skeleton | pale white |
| Spider | red eyes |

---

## 7. Lighting & fog (horror read)

**A. Global darkness** — full-screen or maze-wrap overlay, **~60–75%** black (CSS `rgba` / canvas).

**B. Vision circle** — soft radial **cutout** or gradient around player (mask), not a hard circle.

**C. Monster glow** — as above; implement as CSS box-shadow / sprite outline / small canvas pass.

**D. Fog layer** — spec mentions **RenderTexture** (game-engine pattern). In **Next/React** today: approximate with **CSS mask + radial gradient**, optional **grain** (`noise_grain.png` / simplex). Document **Phaser/Canvas upgrade** if the maze moves off pure DOM.

---

## 8. Telegraphs (gameplay-critical)

Always **above** entities, semi-transparent, **pulsing** animation:

- `telegraph_attack.png` — red ring  
- `telegraph_teleport.png` — purple ring  
- `danger_pulse.png` — generic warning  

Rules: z-index above maze cells; `prefers-reduced-motion` lowers pulse amplitude.

---

## 9. Combat effects (expand)

- `hit_flash.png`, `slash_effect.png`, `smoke_puff.png`, `impact_ring.png`  

Integrate with existing combat UI / future sprite overlay.

---

## 10. Locked palette

Use as **authority** for tints and UI accents:

| Role | Hex |
|------|-----|
| Background | `#0b0b0f` |
| Floor base | `#1a1a22` |
| Wall base | `#2a2a35` |
| Accent red | `#ff0033` |
| Accent purple | `#aa00ff` |
| Accent blue | `#66ccff` |
| Accent green | `#66ff66` |

Gradients in `mazeCellTheme` / `globals.css` should **snap** toward these, not drift into brown photo-rock.

---

## 11. Folder structure (target vs this repo)

**Target (engine-agnostic):**

```text
assets/
  tiles/floor, walls, doors
  overlays/blood, cracks, ritual
  objects/traps, webs, artifacts, exit
  monsters/<type>/...
  effects/telegraph, combat, glow
  lighting/fog_mask.png, noise.png
```

**Next.js mapping:** serve under `public/`, e.g. `public/assets/...` → URL `/assets/...`.

**Current horror pack (already present):**

```text
public/textures/maze/
  Floor/   Horror_Floor_*-256x256.png
  Wall/    Horror_Wall_*-256x256.png
  Brick/   Horror_Brick_*-256x256.png
  Stone/   Horror_Stone_*-256x256.png
  Metal/   Horror_Metal_*-256x256.png
  Stains/  Horror_Stain_*-256x256.png
  Misc/    Horror_Misc_*-256x256.png
  wall_diffuse.png, floor_diffuse.png, noise_grain.png  ← procedural fallbacks / composites
```

**Migration path:** add `public/assets/` subtree per table; symlink or copy curated tiles; update `mazeCellTheme` + CSS vars to new paths. Keep `textures/maze` as **source library** until files are promoted.

---

## 12. Implementation phases (suggested)

1. **P0 — Readability** — Lock palette in theme; pick **one** `Floor` + **one** `Wall` horror slab as `floor_diffuse` / `wall_diffuse` (or per-cell hash from small set); no realistic texture docs as default.
2. **P1 — Decals** — Seeded overlay div per cell using `Stains/` / `Misc/` (blood, cracks); respect `prefers-reduced-motion`.
3. **P2 — Fog + telegraph** — Maze-wrap darkness + player vision mask; telegraph rings for Dracula / hazards using state hooks.
4. **P3 — Kenney pipeline** — Import Kenney, batch **§2** pass, autotile wall set + floor variants; doors + void tile.
5. **P4 — Combat polish** — Shared `shadow_blob`, monster glow table, combat VFX sprites.

---

## 13. Related code (today)

- [`lib/mazeCellTheme.ts`](../lib/mazeCellTheme.ts) — cell background stacks, texture URLs.  
- [`app/globals.css`](../app/globals.css) — `.maze-horror-render`, vignette, grain.  
- [`components/LabyrinthGame.tsx`](../components/LabyrinthGame.tsx) — maze grid, fog intensity hooks.  
- [`public/textures/maze/README.md`](../public/textures/maze/README.md) — operational notes + attribution.

---

## 14. If you only do three things

1. **Darken + palette-lock** base maze (Kenney or horror slabs).  
2. **Blood / crack decals** on a separate layer.  
3. **Fog mask + telegraph glow** around player and threats.  

That combination already beats most flat tile-only maze games.
