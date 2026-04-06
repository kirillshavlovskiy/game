/**
 * Pixel size of the landscape merged-mesh `CombatScene3D` in the live combat modal (desktop).
 *
 * `CombatScene3D` derives camera Z, FOV, ground lift, and `compactWideT` from **`width / height` props**
 * (`MonsterModel3D` `compactAspect`). The `/monster-3d-animations` contact lab must use the same numbers
 * (or the same formula) or models read at a different distance than in-game.
 *
 * **Sync** (`faceOffAnimationSyncKey`, `rollingApproachBlend`) is separate: the lab restarts clips from lab UI
 * state; live combat keys include `sessionId`, strike footer, dice phase, etc., so timing can diverge by design.
 *
 * Phone **landscape** combat uses `LabyrinthGame` `mobileLsFaceoffCanvas` (width from viewport, height `min(w/2, hMax)`),
 * not this helper — only desktop landscape matches the lab’s default sizing.
 */
export const COMBAT_FACEOFF_3D_CANVAS_WIDTH_PX = 920;

/** Same clamp as `LabyrinthGame` `desktopFaceoff3dH` for merged 3D. */
export function combatFaceoff3dCanvasHeightDesktopPx(innerHeight: number): number {
  return Math.max(280, Math.min(540, Math.round(innerHeight - 272)));
}

export function combatFaceoff3dCanvasSizeDesktopPx(innerHeight: number): {
  width: number;
  height: number;
} {
  return {
    width: COMBAT_FACEOFF_3D_CANVAS_WIDTH_PX,
    height: combatFaceoff3dCanvasHeightDesktopPx(innerHeight),
  };
}
