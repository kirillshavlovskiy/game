/**
 * Global defaults for `BoneAttachedWeapon` (combat 3D, maze ISO, labs).
 * Edit these to retune grip hand and sword aim without hunting through components.
 */
import { PLAYER_ARMOUR_GLB_OPTIONS, PLAYER_OFFHAND_ARMOUR_GLB_OPTIONS } from "./playerArmourGlbs";
import { publicAssetPath } from "./publicAssetPath";

export type WeaponAttachHand = "left" | "right";

/** Which hand bone receives the weapon GLB */
export const WEAPON_ATTACH_HAND: WeaponAttachHand = "right";

/** Roster shield GLBs (`PLAYER_OFFHAND_ARMOUR_GLB_OPTIONS`) — always **left** hand bone; overrides ignored in 3D. */
const SHIELD_GLB_URL_SET: ReadonlySet<string> = new Set(
  PLAYER_OFFHAND_ARMOUR_GLB_OPTIONS.map((o) => o.path),
);

export function isRigidShieldGlbUrl(weaponGltfUrl: string | null | undefined): boolean {
  return !!weaponGltfUrl && SHIELD_GLB_URL_SET.has(weaponGltfUrl);
}

/** Uses optional `attachHand` on `PLAYER_ARMOUR_GLB_OPTIONS` (e.g. shields → left). */
export function resolveWeaponAttachHand(weaponGltfUrl: string | null | undefined): WeaponAttachHand {
  if (!weaponGltfUrl) return WEAPON_ATTACH_HAND;
  if (SHIELD_GLB_URL_SET.has(weaponGltfUrl)) return "left";
  for (const o of PLAYER_ARMOUR_GLB_OPTIONS) {
    if (o.path !== weaponGltfUrl) continue;
    if ("attachHand" in o && o.attachHand) return o.attachHand;
  }
  return WEAPON_ATTACH_HAND;
}

/**
 * Twist around the weapon mesh long axis (radians), hand-bone local — rigid attach.
 * **Default 0** = upfront blade; **π** with the alternate grip/Euler below flips a backward-reading hilt.
 */
export const WEAPON_ATTACH_BLADE_TWIST_RAD = 0;

/**
 * Euler (radians, order XYZ) after twist — tuned for **upfront** blade on merged player + Meshy swords.
 * (Backward preset: `[0, 0, 1.3089969389957472]` + `WEAPON_ATTACH_BLADE_TWIST_RAD = Math.PI` + grip below.)
 */
export const WEAPON_ATTACH_EXTRA_EULER_RAD: readonly [number, number, number] = [
  -Math.PI / 4,
  0,
  1.4835298641951802,
];

/**
 * Grip offset (meters along hand-bone axes, after world-scale compensation).
 * Tuned for **larger roster weapons** so the hilt sits in the palm volume; matches `WEAPON_ATTACH_ROSTER_TARGET_WORLD_LEN`.
 *
 * **Closed fist** is not driven here — it comes from the player GLB (e.g. `Combat_Stance` / idle fingers). Re-export the
 * drifter with a weapon-ready idle if the mesh still shows an open palm.
 */
export const WEAPON_ATTACH_GRIP_POSITION_LOCAL: readonly [number, number, number] = [0.484, 0.08, 0.042];

/**
 * Target world length (meters) for the weapon mesh’s **longest** bbox edge. Uniform scale is applied around the
 * grip pivot (handle stays aligned with the hand; blade grows along the long axis).
 */
export const WEAPON_ATTACH_TARGET_WORLD_LEN_DEFAULT = 0.45;

/**
 * Same longest-edge target as **Celestial Blade** tuning — applied to every entry in `PLAYER_ARMOUR_GLB_OPTIONS`
 * so all roster weapons share one visual scale class and the same bone-space grip + Euler (below).
 */
export const WEAPON_ATTACH_ROSTER_TARGET_WORLD_LEN = 0.64;

/** Fraction along the longest bbox axis from the chosen “handle” end toward the blade (0 = end, 1 = other end). */
export const WEAPON_ATTACH_GRIP_FRACTION_FROM_AXIS_END = 0.12;

const WEAPON_ATTACH_TARGET_WORLD_LEN_BY_URL: Readonly<Record<string, number>> = {
  ...(Object.fromEntries(
    PLAYER_ARMOUR_GLB_OPTIONS.map((o) => [o.path, WEAPON_ATTACH_ROSTER_TARGET_WORLD_LEN]),
  ) as Readonly<Record<string, number>>),
  /** Roman Gladius — short mesh at roster scale; bump longest-edge target vs `WEAPON_ATTACH_ROSTER_TARGET_WORLD_LEN`. */
  [publicAssetPath("models/armour/Meshy_AI_Decorative_Roman_Glad_0329003212_texture.glb")]: 0.8,
  /** Eternal Frostblade — reads small at roster scale; nudge longest-edge target up. */
  [publicAssetPath("models/armour/Meshy_AI_Eternal_Frostblade_0403174010_texture.glb")]: 0.78,
};

export function resolveWeaponAttachTargetWorldLen(weaponGltfUrl: string): number {
  return WEAPON_ATTACH_TARGET_WORLD_LEN_BY_URL[weaponGltfUrl] ?? WEAPON_ATTACH_TARGET_WORLD_LEN_DEFAULT;
}

/** Partial pose override for a specific armour GLB path (merged onto globals). */
export type WeaponAttachPosePartial = {
  gripPositionLocal?: readonly [number, number, number];
  extraEulerRad?: readonly [number, number, number];
  bladeTwistRad?: number;
};

/** Shared off-hand shield attach (tuned on Azure Dragon) — all roster shield GLBs until a mesh needs its own entry. */
const PLAYER_OFFHAND_SHIELD_ROSTER_POSE: WeaponAttachPosePartial = {
  gripPositionLocal: [0.336, 0.086, 0.042],
  extraEulerRad: [3.839724354387525, 0.2617993877991494, 1.4835298641951802],
  bladeTwistRad: 0,
};

/** Per-weapon grip + Euler + twist when a mesh needs different numbers than the global defaults. */
const WEAPON_ATTACH_POSE_BY_URL: Readonly<Record<string, WeaponAttachPosePartial>> = {
  /** Silver Blade — straight / upfront read vs Celestial-sized global defaults */
  [publicAssetPath("models/armour/Meshy_AI_Silver_Blade_0329003051_texture.glb")]: {
    gripPositionLocal: [0.433, 0.241, -0.004],
    extraEulerRad: [(-25 * Math.PI) / 180, (-5 * Math.PI) / 180, (200 * Math.PI) / 180],
    bladeTwistRad: 0,
  },
  /** Old Rusty Axe — tuned straight / grip read */
  [publicAssetPath("models/armour/Meshy_AI_an_old_rusty_axe_0329003102_texture.glb")]: {
    gripPositionLocal: [-0.086, -0.03, -0.06],
    extraEulerRad: [-2.1816615649929116, -0.2617993877991494, -0.5235987755982988],
    bladeTwistRad: 0,
  },
  /** Frostblade Dagger */
  [publicAssetPath("models/armour/Meshy_AI_Frostblade_Dagger_0329003123_texture.glb")]: {
    gripPositionLocal: [0.412, 0.085, -0.143],
    extraEulerRad: [-0.4363323129985824, 0.3665191429188092, -1.3962634015954636],
    bladeTwistRad: 0,
  },
  /** Eternal Frostblade — attach fix; 180° blade twist (π rad); scale in `WEAPON_ATTACH_TARGET_WORLD_LEN_BY_URL` */
  [publicAssetPath("models/armour/Meshy_AI_Eternal_Frostblade_0403174010_texture.glb")]: {
    gripPositionLocal: [-0.007, 0.075, 0.034],
    extraEulerRad: [0.08726646259971647, 0.4363323129985824, 1.3962634015954636],
    bladeTwistRad: Math.PI,
  },
  /** Roman Gladius (Decorative) */
  [publicAssetPath("models/armour/Meshy_AI_Decorative_Roman_Glad_0329003212_texture.glb")]: {
    gripPositionLocal: [0.5, -0.03, -0.212],
    extraEulerRad: [1.3089969389957472, -0.08726646259971647, 2.6179938779914944],
    bladeTwistRad: 0,
  },
  /** Elfic Blade (Luminous) — grip/Euler fix */
  [publicAssetPath("models/armour/Meshy_AI_Luminous_Elfic_Blade_0329003430_texture.glb")]: {
    gripPositionLocal: [-0.044, 0.06, 0.038],
    extraEulerRad: [0.4363323129985824, 0.3490658503988659, 1.5707963267948966],
    bladeTwistRad: 0,
  },
  /** Stormbreaker Axe — 180° blade twist (π rad) */
  [publicAssetPath("models/armour/Meshy_AI_Stormbreaker_Axe_0329003533_texture.glb")]: {
    gripPositionLocal: [0.302, 0.192, -0.25],
    extraEulerRad: [-0.4363323129985824, 0.7853981633974483, 1.5707963267948966],
    bladeTwistRad: Math.PI,
  },
  /** Reaper's Edge — 180° blade twist (π rad) */
  [publicAssetPath("models/armour/Meshy_AI_Reaper_s_Edge_0329003602_texture.glb")]: {
    gripPositionLocal: [0.274, 0.08, -0.266],
    extraEulerRad: [-0.4363323129985824, 0.7853981633974483, 1.5707963267948966],
    bladeTwistRad: Math.PI,
  },
  /** Dragon Fury Axe — 180° blade twist (π rad) */
  [publicAssetPath("models/armour/Meshy_AI_Dragon_Fury_Axe_0403170000_texture.glb")]: {
    gripPositionLocal: [0.419, 0.093, 0.044],
    extraEulerRad: [-0.7853981633974483, 0, 1.4835298641951802],
    bladeTwistRad: Math.PI,
  },
  /** Zweihandhammer — grip/Euler fix, 180° blade twist (π rad) */
  [publicAssetPath("models/armour/Meshy_AI_Zweihandhammer_Doppe_0403170009_texture.glb")]: {
    gripPositionLocal: [-0.073, 0.065, 0.035],
    extraEulerRad: [-0.17453292519943295, 0, 1.4835298641951802],
    bladeTwistRad: Math.PI,
  },
  /** Azure Dragon Shield — off-hand roster */
  [publicAssetPath("models/armour/Meshy_AI_Azure_Dragon_Shield_0403173852_texture.glb")]: { ...PLAYER_OFFHAND_SHIELD_ROSTER_POSE },
  /** Nordic Shield — per-mesh grip / Euler */
  [publicAssetPath("models/armour/Meshy_AI_Nordic_Shield_Design__0403170042_texture.glb")]: {
    gripPositionLocal: [0.002, 0.332, -0.01],
    extraEulerRad: [3.3161255787892263, 0.4363323129985824, 1.4835298641951802],
    bladeTwistRad: 0,
  },
  /** Warden Shield — per-mesh grip / Euler */
  [publicAssetPath("models/armour/Meshy_AI_shield_0403170046_texture.glb")]: {
    gripPositionLocal: [-0.208, 0.044, -0.14],
    extraEulerRad: [3.4033920413889422, 0.4363323129985824, 1.5707963267948966],
    bladeTwistRad: 0,
  },
};

export type WeaponAttachPoseResolved = {
  gripPositionLocal: readonly [number, number, number];
  extraEulerRad: readonly [number, number, number];
  bladeTwistRad: number;
};

/**
 * Final attach pose: explicit props (e.g. lab sliders) win; else per-URL map; else globals.
 */
export function resolveWeaponAttachPose(
  weaponGltfUrl: string,
  props: WeaponAttachPosePartial,
): WeaponAttachPoseResolved {
  const per = WEAPON_ATTACH_POSE_BY_URL[weaponGltfUrl];
  return {
    gripPositionLocal: props.gripPositionLocal ?? per?.gripPositionLocal ?? WEAPON_ATTACH_GRIP_POSITION_LOCAL,
    extraEulerRad: props.extraEulerRad ?? per?.extraEulerRad ?? WEAPON_ATTACH_EXTRA_EULER_RAD,
    bladeTwistRad: props.bladeTwistRad ?? per?.bladeTwistRad ?? WEAPON_ATTACH_BLADE_TWIST_RAD,
  };
}
