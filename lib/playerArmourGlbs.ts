/**
 * Player weapon / armour GLB paths (`public/models/armour/*.glb`).
 * Single list for combat UI, maze 3D, and dev labs (`/monster-3d-animations`).
 */
export const ARMOUR_GLB_PREFIX = "/models/armour/";

export const PLAYER_ARMOUR_GLB_OPTIONS = [
  { path: `${ARMOUR_GLB_PREFIX}Meshy_AI_Celestial_Blade_0329003028_texture.glb`, label: "Celestial Blade", emoji: "🗡️" },
  { path: `${ARMOUR_GLB_PREFIX}Meshy_AI_Silver_Blade_0329003051_texture.glb`, label: "Silver Blade", emoji: "⚔️" },
  { path: `${ARMOUR_GLB_PREFIX}Meshy_AI_an_old_rusty_axe_0329003102_texture.glb`, label: "Old Rusty Axe", emoji: "🪓" },
  { path: `${ARMOUR_GLB_PREFIX}Meshy_AI_Frostblade_Dagger_0329003123_texture.glb`, label: "Frostblade Dagger", emoji: "🔪" },
  { path: `${ARMOUR_GLB_PREFIX}Meshy_AI_Decorative_Roman_Glad_0329003212_texture.glb`, label: "Roman Gladius", emoji: "⚔️" },
  { path: `${ARMOUR_GLB_PREFIX}Meshy_AI_Luminous_Elfic_Blade_0329003430_texture.glb`, label: "Elfic Blade", emoji: "✨" },
  { path: `${ARMOUR_GLB_PREFIX}Meshy_AI_Stormbreaker_Axe_0329003533_texture.glb`, label: "Stormbreaker Axe", emoji: "⛏️" },
  { path: `${ARMOUR_GLB_PREFIX}Meshy_AI__0329003550_texture.glb`, label: "Dark Relic", emoji: "🔮" },
  { path: `${ARMOUR_GLB_PREFIX}Meshy_AI_Reaper_s_Edge_0329003602_texture.glb`, label: "Reaper's Edge", emoji: "💀" },
  { path: `${ARMOUR_GLB_PREFIX}Meshy_AI_Dragon_Fury_Axe_0403170000_texture.glb`, label: "Dragon Fury Axe", emoji: "🪓" },
  { path: `${ARMOUR_GLB_PREFIX}Meshy_AI_Eternal_Frostblade_0403174010_texture.glb`, label: "Eternal Frostblade", emoji: "❄️" },
  { path: `${ARMOUR_GLB_PREFIX}Meshy_AI_Zweihandhammer_Doppe_0403170009_texture.glb`, label: "Zweihandhammer", emoji: "🔨" },
  { path: `${ARMOUR_GLB_PREFIX}Meshy_AI_Azure_Dragon_Shield_0403173852_texture.glb`, label: "Azure Dragon Shield", emoji: "🐉" },
  { path: `${ARMOUR_GLB_PREFIX}Meshy_AI_Nordic_Shield_Design__0403170042_texture.glb`, label: "Nordic Shield", emoji: "🛡️" },
  { path: `${ARMOUR_GLB_PREFIX}Meshy_AI_shield_0403170046_texture.glb`, label: "Warden Shield", emoji: "🛡️" },
] as const;

export type PlayerArmourGlbOption = (typeof PLAYER_ARMOUR_GLB_OPTIONS)[number];

/** Persisted / UI sentinel when no weapon GLB is equipped */
export const NO_PLAYER_ARMOUR_GLB = "" as const;

/** Default weapon for `/monster-3d-animations` face-off lab (first list entry). */
export const DEFAULT_LAB_PLAYER_WEAPON_GLB: string | null =
  PLAYER_ARMOUR_GLB_OPTIONS[0]?.path ?? null;
