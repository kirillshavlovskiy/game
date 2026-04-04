import type { CSSProperties } from "react";
import { isWalkable, PLAYER_COLORS } from "./labyrinth";

/**
 * `public/` URLs as site-root paths (`/textures/...`). Matches `layout.tsx` CSS vars — avoids Next resolving
 * `./textures/...` relative to `/_next/static/css/` (broken). Subpath deploys: configure `basePath` or an env URL prefix.
 */
export function mazeAssetPath(relativeFromPublic: string): string {
  const p = relativeFromPublic.replace(/^\//, "");
  return `/${p}`;
}

/** Corridor fog sprite — same prefix rules as floor/wall (`MazeIsoView`). */
export const MAZE_CORRIDOR_FOG_TEXTURE_URL = mazeAssetPath("textures/maze/Effects/corridor_fog_tile.png");

const MAZE_ISO_STAIN_FILENAMES = [
  "Horror_Stain_01-256x256.png",
  "Horror_Stain_02-256x256.png",
  "Horror_Stain_03-256x256.png",
  "Horror_Stain_04-256x256.png",
  "Horror_Stain_05-256x256.png",
  "Horror_Stain_06-256x256.png",
  "Horror_Stain_08-256x256.png",
  "Horror_Stain_09-256x256.png",
  "Horror_Stain_10-256x256.png",
  "Horror_Stain_13-256x256.png",
  "Horror_Stain_14-256x256.png",
] as const;

/** ISO floor decals — filenames aligned with on-disk `public/textures/maze/Stains/`. */
export const MAZE_ISO_STAIN_TEXTURE_URLS: readonly string[] = MAZE_ISO_STAIN_FILENAMES.map((f) =>
  mazeAssetPath(`textures/maze/Stains/${f}`),
);

/** `true` only in Crazy Games lite production build (`CRAZYGAMES_LITE=1` → `next.config.js` inlines `NEXT_PUBLIC_CRAZYGAMES_LITE`). */
export const MAZE_LITE_TEXTURES = process.env.NEXT_PUBLIC_CRAZYGAMES_LITE === "1";

/** Primary walkable floor — mossy square/course stone (kept dark via veil + `floorDarkVeil`). */
export const MAZE_FLOOR_TEXTURE = mazeAssetPath("textures/maze/Brick/Horror_Brick_07-256x256.png");
/** Secondary layer: previous main slab stone (`08`) for depth, `darken`-blended over `07`. */
export const MAZE_FLOOR_MUD_TEXTURE = mazeAssetPath("textures/maze/Brick/Horror_Brick_08-256x256.png");
/** Fine grain overlay — procedural asset is `scripts/generate-maze-textures.py` → `noise_grain.png`. Until generated, reuse floor brick so CSS/preload avoid 404s. */
export const MAZE_NOISE_TEXTURE = mazeAssetPath("textures/maze/Brick/Horror_Brick_07-256x256.png");

/** Corridor floor decals (transparent / white-backed); picked per cell via `cellRng`. */
export const MAZE_STAIN_TEXTURE_PATHS = [
  "textures/maze/Stains/Horror_Stain_01-256x256.png",
  "textures/maze/Stains/Horror_Stain_04-256x256.png",
  "textures/maze/Stains/Horror_Stain_05-256x256.png",
  "textures/maze/Stains/Horror_Stain_09-256x256.png",
  "textures/maze/Stains/Horror_Stain_10-256x256.png",
  "textures/maze/Stains/Horror_Stain_13-256x256.png",
  "textures/maze/Stains/Horror_Stain_14-256x256.png",
] as const;

export const MAZE_STAIN_TEXTURES: readonly string[] = MAZE_STAIN_TEXTURE_PATHS.map((rel) =>
  mazeAssetPath(rel),
);

/** Wall diffuse — repeating `url()` on `.cell.wall` (no per-cell gradient stack). */
export const MAZE_WALL_TEXTURE = mazeAssetPath("textures/maze/Stone/Horror_Stone_02-256x256.png");
/** Isometric 2.5D view: left/right faces of wall blocks (`MazeIsoView`). */
export const MAZE_ISO_WALL_SIDE_TEXTURE = mazeAssetPath("textures/maze/Brick/Horror_Brick_04-256x256.png");

/** Minimal lab slice for corridor lighting (N/S vs E/W neighbors). */
export type MazeLightLabSlice = {
  width: number;
  height: number;
  grid: string[][];
};

function neighborWalkable(lab: MazeLightLabSlice, cx: number, cy: number): boolean {
  if (cx < 0 || cy < 0 || cx >= lab.width || cy >= lab.height) return false;
  return isWalkable(lab.grid[cy]?.[cx]);
}

/** Deterministic 32-bit mix for per-cell stain placement (stable across re-renders). */
function cellRng(x: number, y: number, salt: number): number {
  return (x * 374761393 + y * 668265263 + salt * 1440865359) >>> 0;
}

/** Avoid NaN/Infinity in CSS rgba() — invalid alpha drops the whole `background-image` in WebKit. */
function cssAlpha(a: number, fallback = 0): number {
  if (!Number.isFinite(a)) return fallback;
  return Math.max(0, Math.min(1, a));
}

/**
 * Key light angle: retained for call-site compatibility; floor styling no longer uses it.
 */
export function mazeCorridorLightAngleDeg(lab: MazeLightLabSlice, x: number, y: number): number {
  const verticalNeighbors =
    (neighborWalkable(lab, x, y - 1) ? 1 : 0) + (neighborWalkable(lab, x, y + 1) ? 1 : 0);
  const horizontalNeighbors =
    (neighborWalkable(lab, x + 1, y) ? 1 : 0) + (neighborWalkable(lab, x - 1, y) ? 1 : 0);
  return verticalNeighbors > horizontalNeighbors ? 90 : 180;
}

function floorTextureBgSizePx(cellPx: number): number {
  /** Slightly larger repeat so `07`’s small coursing reads clearly. */
  return Math.round(cellPx * 1.72);
}

/** Wall slab repeat size — larger than floor so 256² cracks/stone read clearly on small cells. */
function wallTextureBgSizePx(cellPx: number): number {
  return Math.round(cellPx * 2.25);
}

function floorUrl(): string {
  return `url(${JSON.stringify(MAZE_FLOOR_TEXTURE)})`;
}

function floorMudUrl(): string {
  return `url(${JSON.stringify(MAZE_FLOOR_MUD_TEXTURE)})`;
}

/** Uniform dark wash over bright baked highlights in `Horror_Brick_07`. */
function floorDarkVeil(): string {
  return "linear-gradient(rgba(3, 4, 8, 0.78), rgba(3, 4, 8, 0.78))";
}

type FloorTopLayer = {
  image: string;
  blend: string;
  size: string;
  repeat: string;
  position: string;
};

/** 0–2 stain PNGs over the brick stack; `darken` keeps white/neutral areas from washing the floor (WebKit-safe vs stacked `multiply`). */
function pathFloorPngStainLayers(cellPx: number, x: number, y: number): FloorTopLayer[] {
  if (cellRng(x, y, 50) % 6 === 0) return [];

  const n = MAZE_STAIN_TEXTURE_PATHS.length;
  const count = 1 + (cellRng(x, y, 1) % 2);
  const layers: FloorTopLayer[] = [];
  let idx = cellRng(x, y, 2) % n;

  for (let i = 0; i < count; i++) {
    const src = MAZE_STAIN_TEXTURES[(idx + i * 5) % n];
    const url = `url(${JSON.stringify(src)})`;
    const scale = 0.58 + (cellRng(x, y, 30 + i) % 50) / 100;
    const spx = Math.max(18, Math.round(cellPx * scale));
    const px = 6 + (cellRng(x, y, 40 + i) % 88);
    const py = 6 + (cellRng(x, y, 41 + i) % 88);
    layers.push({
      image: url,
      blend: "darken",
      size: `${spx}px ${spx}px`,
      repeat: "no-repeat",
      position: `${px}% ${py}%`,
    });
  }
  return layers;
}

/** Effective fog 0–1 on orthogonal **wall** neighbors; used to drop torches on sides of fogged/shadowed walls. */
export type AdjacentWallFog = {
  north: number;
  east: number;
  south: number;
  west: number;
};

/** Read fog intensity for wall cells adjacent to `(x,y)` from the same map used for maze cells. */
export function adjacentWallFogFromIntensityMap(
  lab: MazeLightLabSlice,
  x: number,
  y: number,
  fogMap: ReadonlyMap<string, number>,
): AdjacentWallFog {
  const wallFog = (cx: number, cy: number): number => {
    if (cx < 0 || cy < 0 || cx >= lab.width || cy >= lab.height) return 0;
    if (lab.grid[cy]?.[cx] !== "#") return 0;
    return fogMap.get(`${cx},${cy}`) ?? 0;
  };
  return {
    north: wallFog(x, y - 1),
    east: wallFog(x + 1, y),
    south: wallFog(x, y + 1),
    west: wallFog(x - 1, y),
  };
}

const WALL_FOG_SUPPRESS_TORCH_EPS = 0.02;

function wallTorchSuppressedForAnchor(at: string, adj: AdjacentWallFog): boolean {
  if (at === "92% 50%") return adj.east > WALL_FOG_SUPPRESS_TORCH_EPS;
  if (at === "8% 50%") return adj.west > WALL_FOG_SUPPRESS_TORCH_EPS;
  if (at === "50% 8%") return adj.north > WALL_FOG_SUPPRESS_TORCH_EPS;
  if (at === "50% 92%") return adj.south > WALL_FOG_SUPPRESS_TORCH_EPS;
  return false;
}

function pathFloorWallLightAnchorsFiltered(
  lab: MazeLightLabSlice,
  x: number,
  y: number,
  adjacentWallFog?: AdjacentWallFog,
): string[] {
  const raw = pathFloorWallLightAnchors(lab, x, y);
  if (!adjacentWallFog) return raw;
  return raw.filter((at) => !wallTorchSuppressedForAnchor(at, adjacentWallFog));
}

/** At most one face in a 1-wide tunnel — see `pathFloorWallLightAnchors`. */
export function pathFloorWallLightCount(
  lab: MazeLightLabSlice,
  x: number,
  y: number,
  adjacentWallFog?: AdjacentWallFog,
): number {
  return pathFloorWallLightAnchorsFiltered(lab, x, y, adjacentWallFog).length;
}

/**
 * Fog strength 0–1 for **body** shading / cell opacity: wall-adjacent cells get slightly less overlay fog
 * (layout cue). Wall-torch **highlights** are scaled separately via `pathFloorLightsFromWalls`.
 */
export function pathFogVisualIntensity(cellFog: number, wallLightCount: number): number {
  const n = Math.min(3, wallLightCount) / 3;
  return Math.max(0, Math.min(1, cellFog * (1 - 0.58 * n)));
}

/**
 * Sparse wall torches: along a **N–S** tunnel, only **even `y`** get a pool so neighbors along `y` are
 * never both lit; **E–W** uses **even `x`** the same way. With walls on both sides, **east/west** (or
 * **north/south**) alternate on successive lit tiles via `(coord >> 1) % 2`. Single-wall cells follow
 * that wall on lit steps only.
 */
function pathFloorWallLightAnchors(lab: MazeLightLabSlice, x: number, y: number): string[] {
  if (!neighborWalkable(lab, x, y)) return [];
  const wallOrOob = (cx: number, cy: number): boolean => {
    if (cx < 0 || cy < 0 || cx >= lab.width || cy >= lab.height) return true;
    return !isWalkable(lab.grid[cy]?.[cx]);
  };
  const vn =
    (neighborWalkable(lab, x, y - 1) ? 1 : 0) + (neighborWalkable(lab, x, y + 1) ? 1 : 0);
  const hn =
    (neighborWalkable(lab, x + 1, y) ? 1 : 0) + (neighborWalkable(lab, x - 1, y) ? 1 : 0);
  /** More open N/S than E/W → tunnel runs north–south → light E/W faces only. */
  const verticalCorridor = vn > hn;
  const at: string[] = [];

  if (verticalCorridor) {
    if ((y & 1) === 1) return [];
    const east = wallOrOob(x + 1, y);
    const west = wallOrOob(x - 1, y);
    if (east && west) {
      at.push((y >>> 1) % 2 === 0 ? "92% 50%" : "8% 50%");
    } else if (east) {
      at.push("92% 50%");
    } else if (west) {
      at.push("8% 50%");
    }
  } else {
    if ((x & 1) === 1) return [];
    const north = wallOrOob(x, y - 1);
    const south = wallOrOob(x, y + 1);
    if (north && south) {
      at.push((x >>> 1) % 2 === 0 ? "50% 8%" : "50% 92%");
    } else if (north) {
      at.push("50% 8%");
    } else if (south) {
      at.push("50% 92%");
    }
  }

  return at;
}

/**
 * Wall-side torch pools. Fog **dims** these (→ none at full fog) so fogged tiles read as obscured instead of
 * artificially brightened.
 */
function pathFloorLightsFromWalls(
  lab: MazeLightLabSlice,
  x: number,
  y: number,
  gameFog: number,
  adjacentWallFog?: AdjacentWallFog,
): string[] {
  const f = Math.max(0, Math.min(1, gameFog));
  const lightScale = 1 - f;
  if (lightScale < 0.02) return [];
  /** Softer than the original tight pool, but not as wide as the max-spread pass — balanced falloff. */
  const g0 = cssAlpha(0.19 * lightScale);
  const g1 = cssAlpha(0.09 * lightScale);
  const g2 = cssAlpha(0.038 * lightScale);
  return pathFloorWallLightAnchorsFiltered(lab, x, y, adjacentWallFog).map(
    (at) =>
      `radial-gradient(ellipse 86% 82% at ${at}, rgba(255, 244, 228, ${g0}) 0%, rgba(255, 226, 198, ${g1}) 40%, rgba(248, 210, 182, ${g2}) 66%, transparent 88%)`,
  );
}

type FloorBodyLayers = Pick<
  CSSProperties,
  "backgroundImage" | "backgroundSize" | "backgroundRepeat" | "backgroundPosition" | "backgroundBlendMode"
> & {
  /** Not in older `CSSProperties` typings; required for Safari stacking. */
  WebkitBackgroundBlendMode?: string;
};

/** Veil + optional mud texture (multiply) + base floor (no gameplay tint — tint is merged above stains when needed). */
function pathFloorBodyCore(
  cellPx: number,
  x: number,
  y: number,
  /** Relieved fog 0–1 (after wall-light lift); deepens cell center in foggy open tiles. */
  ambientFog: number = 0,
  wallLightCount: number = 0,
): FloorBodyLayers {
  const basePx = floorTextureBgSizePx(cellPx);
  const hG = cellRng(x, y, 8);
  const grimePx = Math.round(basePx * (0.86 + (hG % 9) * 0.028));
  const fsBase = `${basePx}px ${basePx}px`;
  const fsGrime = `${grimePx}px ${grimePx}px`;
  const gx = cellRng(x, y, 2) % 100;
  const gy = cellRng(x, y, 3) % 100;
  const bx = (cellRng(x, y, 4) % 28) - 6;
  const by = (cellRng(x, y, 5) % 28) - 6;
  const skipMudTex = cellRng(x, y, 99) % 9 === 0;

  const images: string[] = [];
  const blends: string[] = [];
  const sizes: string[] = [];
  const repeats: string[] = [];
  const positions: string[] = [];

  const af = Math.max(0, Math.min(1, ambientFog));
  const wn = Math.min(3, wallLightCount) / 3;
  if (af > 0.02) {
    const edge = cssAlpha(Math.min(0.72, af * 0.52 * (1 - 0.68 * wn)));
    const e1 = cssAlpha(edge * 0.85);
    images.push(
      `radial-gradient(ellipse 92% 92% at 50% 50%, rgba(0,0,0,0) 32%, rgba(4,4,10,${e1}) 72%, rgba(0,0,0,${edge}) 100%)`,
    );
    blends.push("normal");
    sizes.push("100% 100%");
    repeats.push("no-repeat");
    positions.push("0 0");
  }

  images.push(floorDarkVeil());
  blends.push("normal");
  sizes.push("auto");
  repeats.push("no-repeat");
  positions.push("0 0");

  if (!skipMudTex) {
    images.push(floorMudUrl());
    /** `multiply` + stacked `url()` layers fails on WebKit/Safari (whole background dropped). `darken` is close visually. */
    blends.push("darken");
    sizes.push(fsGrime);
    repeats.push("repeat");
    positions.push(`${gx}% ${gy}%`);
  }

  images.push(floorUrl());
  blends.push("normal");
  sizes.push(fsBase);
  repeats.push("repeat");
  positions.push(`${bx}% ${by}%`);

  const blendStr = blends.join(", ");
  return {
    backgroundImage: images.join(", "),
    backgroundBlendMode: blendStr,
    WebkitBackgroundBlendMode: blendStr,
    backgroundSize: sizes.join(", "),
    backgroundRepeat: repeats.join(", "),
    backgroundPosition: positions.join(", "),
  };
}

/** Quantized fog + local walk pattern — enough for correct wall-torch gradients and fog body. */
const BASE_PATH_STYLE_CACHE = new Map<string, CSSProperties>();
const BASE_PATH_STYLE_CACHE_MAX = 8000;

function floorWalkContextKey(lab: MazeLightLabSlice, x: number, y: number): string {
  const bit = (cx: number, cy: number): "0" | "1" => {
    if (cx < 0 || cy < 0 || cx >= lab.width || cy >= lab.height) return "0";
    const c = lab.grid[cy]?.[cx];
    return c && isWalkable(c) ? "1" : "0";
  };
  return `${bit(x, y)}${bit(x, y - 1)}${bit(x + 1, y)}${bit(x, y + 1)}${bit(x - 1, y)}`;
}

function adjacentWallFogCacheKey(adj?: AdjacentWallFog): string {
  if (!adj) return "----";
  const q = (v: number) => Math.min(9, Math.floor(Math.max(0, Math.min(1, v)) * 10 + 1e-9));
  return `${q(adj.north)}${q(adj.east)}${q(adj.south)}${q(adj.west)}`;
}

function buildBasePathStyle(
  cellPx: number,
  lab: MazeLightLabSlice | undefined,
  x: number | undefined,
  y: number | undefined,
  gameFog: number,
  adjacentWallFog?: AdjacentWallFog,
): CSSProperties {
  const cx = x ?? 0;
  const cy = y ?? 0;
  const wallN =
    lab !== undefined && x !== undefined && y !== undefined
      ? pathFloorWallLightCount(lab, x, y, adjacentWallFog)
      : 0;
  const ambientFog = pathFogVisualIntensity(Math.max(0, Math.min(1, gameFog)), wallN);
  const body = pathFloorBodyCore(cellPx, cx, cy, ambientFog, wallN);
  const lights =
    lab !== undefined && x !== undefined && y !== undefined
      ? pathFloorLightsFromWalls(lab, x, y, Math.max(0, Math.min(1, gameFog)), adjacentWallFog)
      : [];
  const lightLayers: FloorTopLayer[] = lights.map((g) => ({
    image: g,
    blend: "normal",
    size: "100% 100%",
    repeat: "no-repeat",
    position: "0 0",
  }));
  const stainLayers = pathFloorPngStainLayers(cellPx, cx, cy);
  const merged = mergeTopLayersOverBody([...lightLayers, ...stainLayers], body);
  return {
    backgroundColor: "#030308",
    ...merged,
    color: "#6a6478",
  };
}

function mergeTopLayersOverBody(layers: FloorTopLayer[], body: FloorBodyLayers): FloorBodyLayers {
  if (layers.length === 0) return body;
  const topBlendStr = layers.map((l) => l.blend).join(", ");
  const bodyImg = body.backgroundImage as string;
  const bodyBlend = body.backgroundBlendMode as string;
  const blendMerged = `${topBlendStr}, ${bodyBlend}`;
  return {
    backgroundImage: `${layers.map((l) => l.image).join(", ")}, ${bodyImg}`,
    backgroundBlendMode: blendMerged,
    WebkitBackgroundBlendMode: blendMerged,
    backgroundSize: `${layers.map((l) => l.size).join(", ")}, ${body.backgroundSize}`,
    backgroundRepeat: `${layers.map((l) => l.repeat).join(", ")}, ${body.backgroundRepeat}`,
    backgroundPosition: `${layers.map((l) => l.position).join(", ")}, ${body.backgroundPosition}`,
  };
}

/** Solid wall fallback (no texture) — legacy parity. */
export function baseWallStyle(_cellPx: number, _lightAngleDeg: number = 180): CSSProperties {
  return {
    backgroundColor: "#3a3a48",
    color: "#8a8898",
  };
}

/** Repeating wall slab only — no gradients or borders (maze-horror-render clears those in CSS). */
export function wallStyleWithOptionalSconce(
  cellPx: number,
  _x: number,
  _y: number,
  _lab: MazeLightLabSlice,
): CSSProperties {
  const tilePx = wallTextureBgSizePx(cellPx);
  return {
    backgroundColor: "#4a4a5c",
    backgroundImage: `url(${JSON.stringify(MAZE_WALL_TEXTURE)})`,
    backgroundSize: `${tilePx}px ${tilePx}px`,
    backgroundRepeat: "repeat",
    backgroundPosition: "0 0",
    color: "#9a96aa",
  };
}

/**
 * Walkable floor: mixed brick textures, procedural mud/blood, veil, wall lights.
 * Cached per (maze size, cell, zoom bucket, fog bucket, local walk pattern) to avoid rebuilding long
 * `background-*` strings on every React render.
 */
export function basePathStyle(
  cellPx: number,
  _lightAngleDeg: number = 180,
  lab?: MazeLightLabSlice,
  x?: number,
  y?: number,
  /** Raw fog zone strength 0–1 (before wall-light relief on overlays). */
  gameFog: number = 0,
  /** Drop wall torches on sides whose neighboring wall tile is fogged/shadowed. */
  adjacentWallFog?: AdjacentWallFog,
): CSSProperties {
  if (lab === undefined || x === undefined || y === undefined) {
    return buildBasePathStyle(cellPx, lab, x, y, gameFog, adjacentWallFog);
  }
  const fogQ = Math.min(64, Math.floor(Math.max(0, Math.min(1, gameFog)) * 64 + 1e-9));
  const cellPxR = Math.round(cellPx);
  const key = `${lab.width}x${lab.height}|${cellPxR}|${x}|${y}|${fogQ}|${floorWalkContextKey(lab, x, y)}|${adjacentWallFogCacheKey(adjacentWallFog)}`;
  const cached = BASE_PATH_STYLE_CACHE.get(key);
  if (cached) return cached;
  const built = buildBasePathStyle(cellPx, lab, x, y, gameFog, adjacentWallFog);
  if (BASE_PATH_STYLE_CACHE.size >= BASE_PATH_STYLE_CACHE_MAX) BASE_PATH_STYLE_CACHE.clear();
  BASE_PATH_STYLE_CACHE.set(key, built);
  return built;
}

/**
 * Path tile with a flat color wash (start, goal, traps, etc.).
 * Stack (top → bottom): wall lights, flat tint, stain PNGs, veil, `08` darken layer, `07` base.
 */
export function pathTintedStyle(
  cellPx: number,
  overlayRgba: string,
  _lightAngleDeg: number = 180,
  lab?: MazeLightLabSlice,
  x?: number,
  y?: number,
  gameFog: number = 0,
  adjacentWallFog?: AdjacentWallFog,
): CSSProperties {
  const cx = x ?? 0;
  const cy = y ?? 0;
  const wallN =
    lab !== undefined && x !== undefined && y !== undefined
      ? pathFloorWallLightCount(lab, x, y, adjacentWallFog)
      : 0;
  const ambientFog = pathFogVisualIntensity(Math.max(0, Math.min(1, gameFog)), wallN);
  const body = pathFloorBodyCore(cellPx, cx, cy, ambientFog, wallN);
  const lights =
    lab !== undefined && x !== undefined && y !== undefined
      ? pathFloorLightsFromWalls(lab, x, y, Math.max(0, Math.min(1, gameFog)), adjacentWallFog)
      : [];
  const lightLayers: FloorTopLayer[] = lights.map((g) => ({
    image: g,
    blend: "normal",
    size: "100% 100%",
    repeat: "no-repeat",
    position: "0 0",
  }));
  const tintLayer: FloorTopLayer = {
    image: `linear-gradient(${overlayRgba}, ${overlayRgba})`,
    blend: "normal",
    size: "auto",
    repeat: "no-repeat",
    position: "0 0",
  };
  const stainLayers = pathFloorPngStainLayers(cellPx, cx, cy);
  const merged = mergeTopLayersOverBody([...lightLayers, tintLayer, ...stainLayers], body);
  return {
    backgroundColor: "#030308",
    ...merged,
  };
}

/**
 * Solid tile fills from the pre–texture maze (`d670654^` / pre–`afab7a1` LabyrinthGame): walls, path, start/goal,
 * specials. Crazy Games lite build only (`NEXT_PUBLIC_CRAZYGAMES_LITE`).
 */
export function classicFlatMazeCellBackground(
  cellClass: string,
  opts: { isTeleportOption: boolean },
): CSSProperties {
  const cellBg: CSSProperties = {};
  if (cellClass.includes("wall")) {
    cellBg.background = "#2a2a35";
    cellBg.color = "#555";
  } else if (cellClass.includes("path")) {
    cellBg.background = "#1e1e28";
    cellBg.color = "#333";
  }
  if (cellClass.includes("start")) {
    cellBg.background = "#1e2e24";
    cellBg.color = "#00ff88";
  }
  if (cellClass.includes("goal")) {
    cellBg.background = "#2e1e1e";
    cellBg.color = "#ff4444";
  }
  if (cellClass.includes("multiplier")) {
    cellBg.color = "#ffcc00";
    cellBg.fontWeight = "bold";
    cellBg.fontSize = "0.85rem";
  }
  if (cellClass.includes("magic")) {
    cellBg.background = cellClass.includes("artifact-inactive") ? "#15151a" : "#1e1e2e";
    cellBg.color = cellClass.includes("artifact-inactive") ? "#555" : "#aa66ff";
    cellBg.fontWeight = "bold";
    if (opts.isTeleportOption && !cellClass.includes("artifact-inactive")) {
      cellBg.boxShadow = "inset 0 0 12px #aa66ff66, 0 0 8px #aa66ff";
      cellBg.border = "2px solid #aa66ff";
    }
  }
  if (cellClass.includes("catapult") && cellClass.includes("artifact-inactive")) {
    cellBg.background = "#15151a";
    cellBg.color = "#444";
  } else if (cellClass.includes("catapult")) {
    cellBg.background = "#2e2e1e";
    cellBg.color = "#ffcc00";
    cellBg.fontWeight = "bold";
  }
  if (cellClass.includes("jump")) {
    cellBg.background = "#1e2e2e";
    cellBg.color = "#66aaff";
    cellBg.fontWeight = "bold";
  }
  if (cellClass.includes("shield")) {
    cellBg.background = "#1e2e2e";
    cellBg.color = "#44ff88";
    cellBg.fontWeight = "bold";
  }
  if (cellClass.includes("artifact")) {
    if (cellClass.includes("artifact-hidden")) {
      cellBg.background = "#1a1e24";
      cellBg.boxShadow = "inset 0 0 8px rgba(170,102,255,0.12)";
    } else {
      cellBg.background = "#1e2e2e";
      cellBg.color = "#aa66ff";
      cellBg.fontWeight = "bold";
    }
  }
  if (cellClass.includes("trap")) {
    cellBg.background = "#2e2e1e";
    cellBg.color = "#ffaa00";
    cellBg.fontWeight = "bold";
  }
  if (cellClass.includes("bomb")) {
    cellBg.background = "#2e1e1e";
    cellBg.color = "#ff8844";
    cellBg.fontWeight = "bold";
  }
  if (cellClass.includes("collectible")) {
    const ownerMatch = cellClass.match(/collectible-p(\d+)/);
    const owner = ownerMatch ? parseInt(ownerMatch[1], 10) : null;
    const c = owner !== null && owner < PLAYER_COLORS.length ? PLAYER_COLORS[owner] : "#888";
    cellBg.color = c;
    cellBg.fontWeight = "bold";
    cellBg.fontSize = "1rem";
    if (owner !== null) {
      cellBg.background = `${c}22`;
      cellBg.boxShadow = `inset 0 0 8px ${c}44`;
    }
  }
  if (cellClass.includes("monster")) {
    cellBg.background = "#2e1e1e";
  }
  if (cellClass.includes("dracula-telegraph")) {
    cellBg.boxShadow = "inset 0 0 16px rgba(255,80,80,0.6), 0 0 12px #ff4444";
    cellBg.border = "2px solid #ff4444";
    cellBg.color = "#ff6666";
    cellBg.zIndex = 5;
  }
  return cellBg;
}

export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "").trim();
  if (h.length !== 6) return `rgba(136,136,136,${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
