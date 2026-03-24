# Maze textures

**Visual direction:** stylized dark dungeon, high contrast, limited palette, glow — **not** photorealistic PBR mixed with sprites. Full roadmap: [`docs/MAZE_VISUAL_PLAN.md`](../../docs/MAZE_VISUAL_PLAN.md).

---

## Horror pack (on disk)

Subfolders under this directory (256×256 PNGs) are the **stylized horror** library — use for **base slabs** and/or **decal overlays** (decals should stay a **separate render layer** when possible).

| Folder | Typical use |
|--------|-------------|
| `Floor/` | Path / floor diffuse candidates (pick several for variation). |
| `Wall/` | Wall diffuse candidates. |
| `Brick/` | Alternate wall / trim. |
| `Stone/` | Stone floor, cracks, heavy masonry. |
| `Metal/` | Accents, gates, industrial horror. |
| `Stains/` | **Overlays** — blood, grime (`blood_splatter_*`, `dark_stain` analogs). |
| `Misc/` | Runes, scratches, ritual-adjacent decals. |

**Promote to runtime defaults:** copy or composite chosen tiles to `floor_diffuse.png` / `wall_diffuse.png`, **or** point [`lib/mazeCellTheme.ts`](../../lib/mazeCellTheme.ts) at explicit `/textures/maze/Floor/...` URLs.

---

## Procedural fallbacks

| File | Role |
|------|------|
| `wall_diffuse.png` | Fallback wall tile (see [`scripts/generate-maze-textures.py`](../../scripts/generate-maze-textures.py)). |
| `floor_diffuse.png` | Fallback floor tile. |
| `noise_grain.png` | Grain / simplex fallback for CSS overlays. |

```bash
npm run textures:maze
# or: python3 scripts/generate-maze-textures.py
```

---

## Base tileset (planned): Kenney

- [Roguelike Dungeon](https://kenney.nl/assets/roguelike-dungeon) / [Tiny Dungeon](https://kenney.nl/assets/tiny-dungeon) — CC0 **base**.  
- **Required art pass:** darken, desaturate, blue/purple tint before they match in-game palette (see plan doc §2).  
- Do **not** ship raw Kenney colors if the rest of the game is horror-stylized.

---

## Overlays: OpenGameArt + custom

Use OGA (and packs like this `Stains/` / `Misc/` set) for **decals only** — cracks, blood, ritual marks — **not** as the sole definition of floor albedo. Naming target list lives in [`docs/MAZE_VISUAL_PLAN.md`](../../docs/MAZE_VISUAL_PLAN.md) §4.

---

## Wiring texture URLs (Next.js)

1. [`lib/mazeCellTheme.ts`](../../lib/mazeCellTheme.ts) — `MAZE_WALL_TEXTURE`, `MAZE_FLOOR_TEXTURE`, `MAZE_NOISE_TEXTURE` (React cell styles use explicit `url(...)`).  
2. [`app/globals.css`](../../app/globals.css) — `:root` `--maze-wall-tex`, `--maze-floor-tex`, `--maze-noise-tex` for stylesheet-only consumers.  
3. [`index.html`](../../index.html) — same `:root` block for the static demo.

---

## Attribution

- **Procedural script:** project-owned.  
- **Horror pack** (`Horror_*` folders): keep the vendor **license / readme** that came with your download next to this folder or in `docs/` if you redistribute.  
- **Kenney:** CC0 — still good practice to credit Kenney.nl.  
- **OpenGameArt:** follow each asset’s on-page notice.
