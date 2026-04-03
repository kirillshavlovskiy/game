/**
 * Global defaults for `BoneAttachedWeapon` (combat 3D, maze ISO, labs).
 * Edit these to retune grip hand and sword aim without hunting through components.
 */
import { PLAYER_ARMOUR_GLB_OPTIONS } from "./playerArmourGlbs";

export type WeaponAttachHand = "left" | "right";

/** Which hand bone receives the weapon GLB */
export const WEAPON_ATTACH_HAND: WeaponAttachHand = "right";

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

const WEAPON_ATTACH_TARGET_WORLD_LEN_BY_URL: Readonly<Record<string, number>> = Object.fromEntries(
  PLAYER_ARMOUR_GLB_OPTIONS.map((o) => [o.path, WEAPON_ATTACH_ROSTER_TARGET_WORLD_LEN]),
) as Readonly<Record<string, number>>;

export function resolveWeaponAttachTargetWorldLen(weaponGltfUrl: string): number {
  return WEAPON_ATTACH_TARGET_WORLD_LEN_BY_URL[weaponGltfUrl] ?? WEAPON_ATTACH_TARGET_WORLD_LEN_DEFAULT;
}

/** Partial pose override for a specific armour GLB path (merged onto globals). */
export type WeaponAttachPosePartial = {
  gripPositionLocal?: readonly [number, number, number];
  extraEulerRad?: readonly [number, number, number];
  bladeTwistRad?: number;
};

/** Per-weapon grip + Euler + twist when a mesh needs different numbers than the global defaults. */
const WEAPON_ATTACH_POSE_BY_URL: Readonly<Record<string, WeaponAttachPosePartial>> = {
  /** Silver Blade — straight / upfront read vs Celestial-sized global defaults */
  "/models/armour/Meshy_AI_Silver_Blade_0329003051_texture.glb": {
    gripPositionLocal: [0.433, 0.241, -0.004],
    extraEulerRad: [(-25 * Math.PI) / 180, (-5 * Math.PI) / 180, (200 * Math.PI) / 180],
    bladeTwistRad: 0,
  },
  /** Old Rusty Axe — tuned straight / grip read */
  "/models/armour/Meshy_AI_an_old_rusty_axe_0329003102_texture.glb": {
    gripPositionLocal: [-0.086, -0.03, -0.06],
    extraEulerRad: [-2.1816615649929116, -0.2617993877991494, -0.5235987755982988],
    bladeTwistRad: 0,
  },
  /** Frostblade Dagger */
  "/models/armour/Meshy_AI_Frostblade_Dagger_0329003123_texture.glb": {
    gripPositionLocal: [0.412, 0.085, -0.143],
    extraEulerRad: [-0.4363323129985824, 0.3665191429188092, -1.3962634015954636],
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
