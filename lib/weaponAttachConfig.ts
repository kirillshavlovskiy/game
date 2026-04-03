/**
 * Global defaults for `BoneAttachedWeapon` (combat 3D, maze ISO, labs).
 * Edit these to retune grip hand and sword aim without hunting through components.
 */
export type WeaponAttachHand = "left" | "right";

/** Which hand bone receives the weapon GLB */
export const WEAPON_ATTACH_HAND: WeaponAttachHand = "right";

/**
 * Extra rotation around the auto-aligned blade axis (radians).
 * π matches most Meshy sword GLBs (guard/handle orientation).
 */
export const WEAPON_ATTACH_BLADE_TWIST_RAD = Math.PI;

/**
 * Additional Euler (radians, order XYZ) applied in **hand-bone local space** after auto alignment.
 * Tune pitch/yaw/roll of the weapon vs the palm.
 */
export const WEAPON_ATTACH_EXTRA_EULER_RAD: readonly [number, number, number] = [0, 0, 0];
