/**
 * 3D iso maze props for non–stored-artifact cells (catapult, bomb, traps).
 * Stored artifacts use `ARTIFACT_KIND_VISUAL_GLB` + `MazeArtifactPickups`.
 */
import { CATAPULT, isBombCell, isTrapCell } from "./labyrinth";

const MAZE_P = "/models/maze-collectibles/";

export const MAZE_WORLD_FEATURE_SIEGE_CAT_GLB = `${MAZE_P}siege-cat.glb`;
/** Used to hide the bomb prop after the active player picks it up (grid cell stays `B`). */
export const MAZE_WORLD_FEATURE_BOMB_GLB = `${MAZE_P}bomb.glb`;
export const MAZE_WORLD_FEATURE_SPIKED_TRAP_GLB = `${MAZE_P}spiked-trap.glb`;

/** 3D spider web props on `lab.webPositions` (iso maze). Source: Meshy AI `Meshy_AI_generate_3d_model_of__0404080446_texture.glb` → `spider-web-mesh.glb` in this folder. */
export const MAZE_SPIDER_WEB_MESH_GLB = `${MAZE_P}spider-web-mesh.glb`;

export const MAZE_WORLD_FEATURE_GLB_URLS = [
  MAZE_WORLD_FEATURE_SIEGE_CAT_GLB,
  MAZE_WORLD_FEATURE_BOMB_GLB,
  MAZE_WORLD_FEATURE_SPIKED_TRAP_GLB,
  MAZE_SPIDER_WEB_MESH_GLB,
] as const;

/** GLB URL for catapult, bomb, or trap cells; `null` otherwise. */
export function mazeWorldFeatureGlbUrl(cell: string): string | null {
  if (cell === CATAPULT) return MAZE_WORLD_FEATURE_SIEGE_CAT_GLB;
  if (isBombCell(cell)) return MAZE_WORLD_FEATURE_BOMB_GLB;
  if (isTrapCell(cell)) return MAZE_WORLD_FEATURE_SPIKED_TRAP_GLB;
  return null;
}
