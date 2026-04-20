/**
 * GLB paths for Meshy collectible weapon/shield artifacts (see `public/models/armour/`).
 * Used for 3D maze pickups and equipping when the artifact is spent.
 * Prefix must match `ARMOUR_GLB_PREFIX` in `playerArmourGlbs.ts` (avoid import cycle).
 */
import type { StoredArtifactKind } from "./labyrinth";
import { publicAssetPath } from "./publicAssetPath";

const P = publicAssetPath("models/armour/");
const MAZE_P = publicAssetPath("models/maze-collectibles/");

export const COLLECTIBLE_ARTIFACT_GLB_BY_KIND = {
  /** Holy sword — use the Celestial Blade; it is the reference tuning baseline in weaponAttachConfig.ts, so no per-GLB pose override is required. */
  holySword: `${P}Meshy_AI_Celestial_Blade_0329003028_texture.glb`,
  dragonFuryAxe: `${P}Meshy_AI_Dragon_Fury_Axe_0403170000_texture.glb`,
  eternalFrostblade: `${P}Meshy_AI_Eternal_Frostblade_0403174010_texture.glb`,
  zweihandhammer: `${P}Meshy_AI_Zweihandhammer_Doppe_0403170009_texture.glb`,
  azureDragonShield: `${P}Meshy_AI_Azure_Dragon_Shield_0403173852_texture.glb`,
  nordicShield: `${P}Meshy_AI_Nordic_Shield_Design__0403170042_texture.glb`,
  wardShield: `${P}Meshy_AI_shield_0403170046_texture.glb`,
} as const satisfies Record<string, string>;

/** Same mechanics as holy sword / holy cross; each maps to its display GLB when equipped. */
export const ARTIFACT_KIND_VISUAL_GLB: Partial<Record<StoredArtifactKind, string>> = {
  /** Base shield stack artifact — same visual as warden shield pickup (off-hand in 3D). */
  shield: COLLECTIBLE_ARTIFACT_GLB_BY_KIND.wardShield,
  holySword: COLLECTIBLE_ARTIFACT_GLB_BY_KIND.holySword,
  dragonFuryAxe: COLLECTIBLE_ARTIFACT_GLB_BY_KIND.dragonFuryAxe,
  eternalFrostblade: COLLECTIBLE_ARTIFACT_GLB_BY_KIND.eternalFrostblade,
  zweihandhammer: COLLECTIBLE_ARTIFACT_GLB_BY_KIND.zweihandhammer,
  azureDragonShield: COLLECTIBLE_ARTIFACT_GLB_BY_KIND.azureDragonShield,
  nordicShield: COLLECTIBLE_ARTIFACT_GLB_BY_KIND.nordicShield,
  wardShield: COLLECTIBLE_ARTIFACT_GLB_BY_KIND.wardShield,
  holyCross: `${MAZE_P}holy-cross.glb`,
  torch: `${MAZE_P}torch.glb`,
  teleport: `${MAZE_P}teleport-ring.glb`,
};

export const COLLECTIBLE_ARTIFACT_GLB_URLS: readonly string[] = Object.values(COLLECTIBLE_ARTIFACT_GLB_BY_KIND);
