import type { MonsterType } from "@/lib/labyrinth";

/** Mirrors combat portrait states used with `getMonsterSprite` in LabyrinthGame. */
export type Monster3DSpriteState =
  | "idle"
  | "hunt"
  | "attack"
  | "angry"
  | "rolling"
  | "hurt"
  | "knockdown"
  | "defeated"
  | "neutral"
  | "recover";

/** All values of `Monster3DSpriteState` (for docs / dev pages). */
export const MONSTER_3D_VISUAL_STATES: readonly Monster3DSpriteState[] = [
  "idle",
  "hunt",
  "attack",
  "angry",
  "rolling",
  "hurt",
  "knockdown",
  "defeated",
  "neutral",
  "recover",
];

/** Single merged rig (Meshy exports baked in Blender) — combat + preview swap clips only (smooth mixer cross-fades). */
const DRACULA_MERGED_GLB = "/models/monsters/dracula.glb";

/**
 * Exact `animations[].name` values in merged `dracula.glb` (verify with a GLB JSON dump if re-exporting):
 * Charged_Spell_Cast_2, Dead, Face_Punch_Reaction_2, Face_Punch_Reaction, Hit_Reaction_to_Waist, Idle_6,
 * Jumping_Punch, Mummy_Stagger, Running, Skill_01, Skill_03, Stand_Up1, Walking, Zombie_Scream, falling_down.
 * Prefer these strings first — older builds used Blender NLA names (`Armature|…|baselayer`) which are absent here.
 */

/** Calm between rolls / neutral stance — matches 2D idle. */
const DRACULA_IDLE_CLIPS = ["Idle_6", "Walking"] as const;

/**
 * Chase portrait — `Mummy_Stagger` first (hard surprise / stalk), then locomotion fallbacks.
 * 2D still uses `hunt.png`; 3D reads more aggressive than plain walk/run.
 */
const DRACULA_HUNT_PORTRAIT_CLIPS = ["Mummy_Stagger", "Running", "Walking", "Zombie_Scream", "Idle_6"] as const;

/**
 * Angry surprise stance — **`Skill_01`** primary; then strike-adjacent fallbacks (not hunt locomotion).
 */
const DRACULA_ANGRY_CLIPS = [
  "Skill_01",
  "Charged_Spell_Cast_2",
  "Skill_03",
  "Jumping_Punch",
  "Zombie_Scream",
  "Running",
] as const;

/** Spell-first strike order (primary segment in `draculaMergedAttackClipPriority("spell")`). */
const DRACULA_ATTACK_SPELL_PRIORITY = [
  "Jumping_Punch",
  "Charged_Spell_Cast_2",
  "Skill_03",
  "Skill_01",
] as const;

/** Skill-first strike order (primary segment in `draculaMergedAttackClipPriority("skill")`). */
const DRACULA_ATTACK_SKILL_PRIORITY = [
  "Jumping_Punch",
  "Skill_03",
  "Skill_01",
  "Charged_Spell_Cast_2",
] as const;

function mergeUniqueClipOrder(primary: readonly string[], secondary: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of [...primary, ...secondary]) {
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

/**
 * After a normal player hit (`hurt` portrait, not `knockdown` 1–2 HP): pick reaction intensity from HP left / max.
 * - **light** — still high HP: lighter flinch (`Face_Punch_Reaction`)
 * - **medium** — mid band: `Face_Punch_Reaction_2`
 * - **heavy** — low but ≥3 HP: `Hit_Reaction_to_Waist` (see `Meshy_AI_Meshy_Merged_Animations-3.glb`)
 */
export type DraculaHurtIntensity = "light" | "medium" | "heavy";

export function draculaHurtIntensityFromHp(hp: number, maxHp: number): DraculaHurtIntensity {
  const m = Math.max(1, maxHp);
  const h = Math.min(m, Math.max(0, hp));
  const r = h / m;
  /** Wider light / medium bands vs ⅔·⅓ so early–mid strikes read as flinch, not full stagger (balance vs attack clips). */
  if (r > 0.5) return "light";
  if (r > 0.25) return "medium";
  return "heavy";
}

const FACE_PUNCH_REACTION = ["Face_Punch_Reaction"] as const;
const FACE_PUNCH_REACTION_2 = ["Face_Punch_Reaction_2"] as const;
const HIT_REACTION_TO_WAIST = ["Hit_Reaction_to_Waist"] as const;

function flattenClipGroups(groups: readonly (readonly string[])[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const g of groups) {
    for (const n of g) {
      if (!seen.has(n)) {
        seen.add(n);
        out.push(n);
      }
    }
  }
  return out;
}

/** Ordered clip tries for merged `dracula.glb` hurt reactions (canonical Meshy names, then Blender-style aliases). */
export function draculaHurtClipPriority(intensity: DraculaHurtIntensity): string[] {
  let flat: string[];
  switch (intensity) {
    case "light":
      flat = flattenClipGroups([FACE_PUNCH_REACTION, FACE_PUNCH_REACTION_2, HIT_REACTION_TO_WAIST]);
      break;
    case "medium":
      flat = flattenClipGroups([FACE_PUNCH_REACTION_2, HIT_REACTION_TO_WAIST, FACE_PUNCH_REACTION]);
      break;
    case "heavy":
    default:
      flat = flattenClipGroups([HIT_REACTION_TO_WAIST, FACE_PUNCH_REACTION_2, FACE_PUNCH_REACTION]);
      break;
  }
  return expandDraculaClipTryList(flat);
}

/** Offense-only fallbacks — no `Running`/`Walking` (those read like hunt/calm, not “monster hit you”). */
const DRACULA_ATTACK_FALLBACK_TAIL = ["Zombie_Scream", "Charged_Spell_Cast_2", "Skill_03"] as const;

/** Clip try-order for **`attack` only** on merged `dracula.glb` (spell vs skill strike alternation in combat). */
export function draculaMergedAttackClipPriority(variant: "spell" | "skill" | "light" = "spell"): string[] {
  const ordered =
    variant === "spell"
      ? mergeUniqueClipOrder([...DRACULA_ATTACK_SPELL_PRIORITY], [...DRACULA_ATTACK_SKILL_PRIORITY])
      : mergeUniqueClipOrder([...DRACULA_ATTACK_SKILL_PRIORITY], [...DRACULA_ATTACK_SPELL_PRIORITY]);
  return expandDraculaClipTryList([...ordered, ...DRACULA_ATTACK_FALLBACK_TAIL]);
}

/** If re-export adds `Armature|Clip|baselayer` names, they still resolve after exact Meshy names. */
const DRACULA_CLIP_ALIASES_BY_CANONICAL: Record<string, readonly string[]> = {
  /** Do not map idle to `walking_man` — that is locomotion, not Idle_6. */
  Idle_6: ["Armature|Idle_6|baselayer"],
  Walking: ["Armature|walking_man|baselayer"],
  Running: ["Armature|running|baselayer"],
  Charged_Spell_Cast_2: ["Armature|Charged_Spell_Cast_2|baselayer", "Armature|Charged_Spell_Cast|baselayer"],
  Skill_03: ["Armature|Skill_03|baselayer"],
  Skill_01: ["Armature|Skill_01|baselayer"],
  Jumping_Punch: ["Armature|Jumping_Punch|baselayer"],
  Zombie_Scream: ["Armature|Zombie_Scream|baselayer"],
  Mummy_Stagger: ["Armature|Mummy_Stagger|baselayer"],
  falling_down: ["Armature|falling_down|baselayer"],
  Stand_Up1: ["Armature|Stand_Up1|baselayer", "Armature|Stand_Up5|baselayer"],
  Dead: ["Armature|Dead|baselayer", "Armature|Shot_and_Fall_Backward|baselayer", "Armature|Shot_and_Fall_Forward|baselayer"],
  Face_Punch_Reaction: ["Armature|Face_Punch_Reaction|baselayer"],
  Face_Punch_Reaction_2: ["Armature|Face_Punch_Reaction_2|baselayer"],
  Hit_Reaction_to_Waist: ["Armature|Hit_Reaction_to_Waist|baselayer"],
  Arise: ["Armature|Arise|baselayer"],
};

function expandDraculaClipTryList(shortNames: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of shortNames) {
    if (!seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
    const aliases = DRACULA_CLIP_ALIASES_BY_CANONICAL[n];
    if (aliases) {
      for (const a of aliases) {
        if (!seen.has(a)) {
          seen.add(a);
          out.push(a);
        }
      }
    }
  }
  return out;
}

/**
 * Merged `skeleton.glb` (Meshy blue-eyed biped): same idea as Dracula — short Blender action names plus
 * `Armature|Clip|baselayer` from raw Meshy / gltf-transform merges.
 */
const SKELETON_IDLE_CLIPS = ["Idle_11", "Walking"] as const;

const SKELETON_HUNT_PORTRAIT_CLIPS = [
  "Mummy_Stagger",
  "Running",
  "Walking",
  "Alert_Quick_Turn_Right",
  "Zombie_Scream",
  "Idle_11",
] as const;

const SKELETON_ANGRY_CLIPS = [
  "Skill_01",
  "Charged_Spell_Cast_2",
  "Skill_03",
  "Left_Slash",
  "Triple_Combo_Attack",
  "Zombie_Scream",
  "Alert",
  "Running",
] as const;

/** Spell-first — `Triple_Combo_Attack` / `Left_Slash` stand in for Dracula’s `Jumping_Punch` lunge. */
const SKELETON_ATTACK_SPELL_PRIORITY = [
  "Triple_Combo_Attack",
  "Charged_Spell_Cast_2",
  "Left_Slash",
  "Skill_03",
  "Skill_01",
  "Basic_Jump",
] as const;

const SKELETON_ATTACK_SKILL_PRIORITY = [
  "Left_Slash",
  "Skill_03",
  "Skill_01",
  "Triple_Combo_Attack",
  "Charged_Spell_Cast_2",
  "Basic_Jump",
] as const;

/** Die-3 light attack — ranged / spell-like moves first. */
const SKELETON_ATTACK_LIGHT_PRIORITY = [
  "Charged_Spell_Cast_2",
  "Skill_03",
  "Skill_01",
  "Left_Slash",
  "Triple_Combo_Attack",
  "Basic_Jump",
] as const;

const SKELETON_ATTACK_FALLBACK_TAIL = ["Zombie_Scream", "Charged_Spell_Cast_2", "Skill_03"] as const;

/** Per-canonical Meshy / Blender names — overlaps Dracula where clips share a title. */
const SKELETON_CLIP_ALIASES_BY_CANONICAL: Record<string, readonly string[]> = {
  Idle_11: ["Armature|Idle_11|baselayer"],
  Walking: ["Armature|walking_man|baselayer", "Walking"],
  Running: ["Armature|running|baselayer", "Running"],
  Charged_Spell_Cast_2: ["Armature|Charged_Spell_Cast_2|baselayer", "Armature|Charged_Spell_Cast|baselayer"],
  Skill_03: ["Armature|Skill_03|baselayer"],
  Skill_01: ["Armature|Skill_01|baselayer"],
  Left_Slash: ["Armature|Left_Slash|baselayer"],
  Triple_Combo_Attack: ["Armature|Triple_Combo_Attack|baselayer"],
  Basic_Jump: ["Armature|Basic_Jump|baselayer"],
  Zombie_Scream: ["Armature|Zombie_Scream|baselayer"],
  Mummy_Stagger: ["Armature|Mummy_Stagger|baselayer"],
  falling_down: ["Armature|falling_down|baselayer"],
  Stand_Up1: ["Armature|Stand_Up1|baselayer", "Armature|Stand_Up5|baselayer"],
  Dead: ["Armature|Dead|baselayer"],
  Face_Punch_Reaction_1: ["Armature|Face_Punch_Reaction_1|baselayer"],
  Face_Punch_Reaction_2: ["Armature|Face_Punch_Reaction_2|baselayer"],
  Face_Punch_Reaction: ["Armature|Face_Punch_Reaction|baselayer"],
  Hit_Reaction_to_Waist: ["Armature|Hit_Reaction_to_Waist|baselayer"],
  Alert: ["Armature|Alert|baselayer"],
  Alert_Quick_Turn_Right: ["Armature|Alert_Quick_Turn_Right|baselayer"],
  Arise: ["Armature|Arise|baselayer"],
};

function expandSkeletonClipTryList(shortNames: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of shortNames) {
    if (!seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
    const aliases = SKELETON_CLIP_ALIASES_BY_CANONICAL[n];
    if (aliases) {
      for (const a of aliases) {
        if (!seen.has(a)) {
          seen.add(a);
          out.push(a);
        }
      }
    }
  }
  return out;
}

const FACE_PUNCH_REACTION_1 = ["Face_Punch_Reaction_1"] as const;

/** Skeleton hurt clip tiers — light always prefers Hit_Reaction_to_Waist (die-4 miss). */
export function skeletonHurtClipPriority(intensity: DraculaHurtIntensity): string[] {
  let flat: string[];
  switch (intensity) {
    case "light":
      flat = flattenClipGroups([HIT_REACTION_TO_WAIST, FACE_PUNCH_REACTION_1, FACE_PUNCH_REACTION_2]);
      break;
    case "medium":
      flat = flattenClipGroups([FACE_PUNCH_REACTION_2, HIT_REACTION_TO_WAIST, FACE_PUNCH_REACTION_1]);
      break;
    case "heavy":
    default:
      flat = flattenClipGroups([FACE_PUNCH_REACTION_1, FACE_PUNCH_REACTION_2, HIT_REACTION_TO_WAIST]);
      break;
  }
  return expandSkeletonClipTryList(flat);
}

export function skeletonMergedAttackClipPriority(variant: "spell" | "skill" | "light" = "spell"): string[] {
  const ordered =
    variant === "spell"
      ? mergeUniqueClipOrder([...SKELETON_ATTACK_SPELL_PRIORITY], [...SKELETON_ATTACK_SKILL_PRIORITY])
      : variant === "skill"
        ? mergeUniqueClipOrder([...SKELETON_ATTACK_SKILL_PRIORITY], [...SKELETON_ATTACK_SPELL_PRIORITY])
        : mergeUniqueClipOrder([...SKELETON_ATTACK_LIGHT_PRIORITY], [...SKELETON_ATTACK_SPELL_PRIORITY]);
  return expandSkeletonClipTryList([...ordered, ...SKELETON_ATTACK_FALLBACK_TAIL]);
}

/* ────────────────────────────────────────────────────────────────────
 * SPIDER MERGED CONFIG  (Blender-rigged — 13 animations in spider.glb)
 * ──────────────────────────────────────────────────────────────────── */

const SPIDER_IDLE_CLIPS = ["Idle", "Walking"] as const;

const SPIDER_HUNT_PORTRAIT_CLIPS = [
  "Running",
  "Walking",
  "Idle",
] as const;

const SPIDER_ANGRY_CLIPS = [
  "Zombie_Scream",
  "Jumping_Punch",
  "Left_Slash",
  "Skill_01",
  "Running",
] as const;

const SPIDER_ATTACK_SPELL_PRIORITY = [
  "Jumping_Punch",
  "Left_Slash",
  "Skill_01",
] as const;

const SPIDER_ATTACK_SKILL_PRIORITY = [
  "Left_Slash",
  "Skill_01",
  "Jumping_Punch",
] as const;

const SPIDER_ATTACK_LIGHT_PRIORITY = [
  "Skill_01",
  "Left_Slash",
  "Jumping_Punch",
] as const;

const SPIDER_ATTACK_FALLBACK_TAIL = ["Zombie_Scream", "Alert"] as const;

const SPIDER_CLIP_ALIASES_BY_CANONICAL: Record<string, readonly string[]> = {};

function expandSpiderClipTryList(shortNames: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of shortNames) {
    if (!seen.has(n)) { seen.add(n); out.push(n); }
    const aliases = SPIDER_CLIP_ALIASES_BY_CANONICAL[n];
    if (aliases) {
      for (const a of aliases) {
        if (!seen.has(a)) { seen.add(a); out.push(a); }
      }
    }
  }
  return out;
}

export function spiderHurtClipPriority(intensity: DraculaHurtIntensity): string[] {
  let flat: string[];
  switch (intensity) {
    case "light":
      flat = ["Hit_Reaction_to_Waist", "Face_Punch_Reaction_2"];
      break;
    case "medium":
      flat = ["Face_Punch_Reaction_2", "Hit_Reaction_to_Waist"];
      break;
    case "heavy":
    default:
      flat = ["Face_Punch_Reaction_2", "Hit_Reaction_to_Waist"];
      break;
  }
  return expandSpiderClipTryList(flat);
}

export function spiderMergedAttackClipPriority(variant: "spell" | "skill" | "light" = "spell"): string[] {
  const ordered =
    variant === "spell"
      ? mergeUniqueClipOrder([...SPIDER_ATTACK_SPELL_PRIORITY], [...SPIDER_ATTACK_SKILL_PRIORITY])
      : variant === "skill"
        ? mergeUniqueClipOrder([...SPIDER_ATTACK_SKILL_PRIORITY], [...SPIDER_ATTACK_SPELL_PRIORITY])
        : mergeUniqueClipOrder([...SPIDER_ATTACK_LIGHT_PRIORITY], [...SPIDER_ATTACK_SPELL_PRIORITY]);
  return expandSpiderClipTryList([...ordered, ...SPIDER_ATTACK_FALLBACK_TAIL]);
}

/* ────────────────────────────────────────────────────────────────────
 * PLAYER 3D MODEL CONFIG  (Wasteland Drifter — 20 animations)
 *
 * Animations: Combat_Stance, Arise, Attack, Backflip_and_Hooks,
 * Cautious_Crouch_Walk_Forward_inplace, Cautious_Crouch_Walk_Left_inplace,
 * Cautious_Crouch_Walk_Right_inplace, Charged_Axe_Chop, Charged_Spell_Cast_2,
 * Charged_Upward_Slash, Dead, Double_Blade_Spin, Double_Combo_Attack,
 * Face_Punch_Reaction_1, Jumping_Punch, Reaping_Swing, running,
 * Triple_Combo_Attack, walking_man, falling_down
 * ──────────────────────────────────────────────────────────────────── */

export const PLAYER_3D_GLB = "/models/player/wasteland-drifter.glb";

const PLAYER_IDLE_CLIPS = ["Combat_Stance", "walking_man"] as const;

const PLAYER_HUNT_CLIPS = [
  "Cautious_Crouch_Walk_Forward_inplace",
  "walking_man",
  "running",
] as const;

const PLAYER_ANGRY_CLIPS = [
  "Double_Blade_Spin",
  "Charged_Axe_Chop",
  "Triple_Combo_Attack",
  "Reaping_Swing",
  "running",
] as const;

const PLAYER_ATTACK_HEAVY_PRIORITY = [
  "Triple_Combo_Attack",
  "Charged_Axe_Chop",
  "Double_Blade_Spin",
  "Reaping_Swing",
] as const;

const PLAYER_ATTACK_MEDIUM_PRIORITY = [
  "Double_Combo_Attack",
  "Charged_Upward_Slash",
  "Attack",
  "Jumping_Punch",
] as const;

const PLAYER_ATTACK_LIGHT_PRIORITY = [
  "Attack",
  "Charged_Spell_Cast_2",
  "Backflip_and_Hooks",
] as const;

const PLAYER_ATTACK_FALLBACK_TAIL = ["Attack", "Jumping_Punch"] as const;

const PLAYER_CLIP_PRIORITY: Partial<Record<Monster3DSpriteState, readonly string[]>> = {
  idle: [...PLAYER_IDLE_CLIPS],
  neutral: [...PLAYER_IDLE_CLIPS],
  hunt: [...PLAYER_HUNT_CLIPS],
  angry: [...PLAYER_ANGRY_CLIPS],
  attack: [
    ...PLAYER_ATTACK_HEAVY_PRIORITY,
    ...PLAYER_ATTACK_MEDIUM_PRIORITY,
    ...PLAYER_ATTACK_LIGHT_PRIORITY,
    ...PLAYER_ATTACK_FALLBACK_TAIL,
  ],
  rolling: [
    "Cautious_Crouch_Walk_Forward_inplace",
    "Cautious_Crouch_Walk_Left_inplace",
    "Cautious_Crouch_Walk_Right_inplace",
    "Combat_Stance",
  ],
  hurt: ["Face_Punch_Reaction_1"],
  knockdown: ["falling_down"],
  defeated: ["Dead"],
  recover: ["Arise", "walking_man"],
};

export function playerAttackClipPriority(variant: "spell" | "skill" | "light" = "spell"): string[] {
  const ordered =
    variant === "spell"
      ? mergeUniqueClipOrder([...PLAYER_ATTACK_HEAVY_PRIORITY], [...PLAYER_ATTACK_MEDIUM_PRIORITY])
      : variant === "skill"
        ? mergeUniqueClipOrder([...PLAYER_ATTACK_MEDIUM_PRIORITY], [...PLAYER_ATTACK_HEAVY_PRIORITY])
        : mergeUniqueClipOrder([...PLAYER_ATTACK_LIGHT_PRIORITY], [...PLAYER_ATTACK_MEDIUM_PRIORITY]);
  return [...ordered, ...PLAYER_ATTACK_FALLBACK_TAIL];
}

export function getPlayerPreferredClipNames(
  state: Monster3DSpriteState,
  attackVariant?: "spell" | "skill" | "light",
): string[] {
  if (state === "attack") return playerAttackClipPriority(attackVariant ?? "spell");
  return [...(PLAYER_CLIP_PRIORITY[state] ?? [])];
}

export function resolvePlayerAnimationClipName(
  state: Monster3DSpriteState,
  animationNames: readonly string[],
  attackVariant?: "spell" | "skill" | "light",
): string | null {
  if (animationNames.length === 0) return null;

  if (state === "idle" || state === "neutral") {
    const cs = matchAnimationNameInsensitive(animationNames, "Combat_Stance");
    if (cs) return cs;
  }

  const preferred = getPlayerPreferredClipNames(state, attackVariant);
  for (const n of preferred) {
    const hit = matchAnimationNameInsensitive(animationNames, n);
    if (hit) return hit;
  }

  const idle = matchAnimationNameInsensitive(animationNames, "Combat_Stance");
  if (idle) return idle;
  return animationNames[0] ?? null;
}

/* ────────────────────────────────────────────────────────────────────
 * ZOMBIE MERGED CONFIG  (Meshy biped — 16 animations in zombie.glb)
 * ──────────────────────────────────────────────────────────────────── */

const ZOMBIE_IDLE_CLIPS = ["Elderly_Shaky_Walk_inplace", "Walking"] as const;

const ZOMBIE_HUNT_PORTRAIT_CLIPS = [
  "Unsteady_Walk",
  "Running",
  "Walking",
  "Elderly_Shaky_Walk_inplace",
] as const;

const ZOMBIE_ANGRY_CLIPS = [
  "Zombie_Scream",
  "Jumping_Punch",
  "Left_Slash",
  "Left_Hook_from_Guard",
  "Skill_01",
  "Running",
] as const;

/** Die-1 heavy attack — Jumping_Punch (most serious). */
const ZOMBIE_ATTACK_SPELL_PRIORITY = [
  "Jumping_Punch",
  "Left_Slash",
  "Left_Hook_from_Guard",
  "Skill_01",
] as const;

/** Die-2 medium attack — Left_Slash first. */
const ZOMBIE_ATTACK_SKILL_PRIORITY = [
  "Left_Slash",
  "Left_Hook_from_Guard",
  "Skill_01",
  "Jumping_Punch",
] as const;

/** Die-3 light attack — Left_Hook_from_Guard first. */
const ZOMBIE_ATTACK_LIGHT_PRIORITY = [
  "Left_Hook_from_Guard",
  "Skill_01",
  "Left_Slash",
  "Jumping_Punch",
] as const;

const ZOMBIE_ATTACK_FALLBACK_TAIL = ["Zombie_Scream", "Skill_01"] as const;

const ZOMBIE_CLIP_ALIASES_BY_CANONICAL: Record<string, readonly string[]> = {
  Elderly_Shaky_Walk_inplace: ["Armature|Elderly_Shaky_Walk_inplace|baselayer"],
  Walking: ["Armature|walking_man|baselayer", "walking_man"],
  Running: ["Armature|running|baselayer", "running"],
  Unsteady_Walk: ["Armature|Unsteady_Walk|baselayer"],
  Jumping_Punch: ["Armature|Jumping_Punch|baselayer"],
  Left_Slash: ["Armature|Left_Slash|baselayer"],
  Left_Hook_from_Guard: ["Armature|Left_Hook_from_Guard|baselayer"],
  Skill_01: ["Armature|Skill_01|baselayer"],
  Zombie_Scream: ["Armature|Zombie_Scream|baselayer"],
  Alert: ["Armature|Alert|baselayer"],
  Alert_Quick_Turn_Right: ["Armature|Alert_Quick_Turn_Right|baselayer"],
  falling_down: ["Armature|falling_down|baselayer"],
  Arise: ["Armature|Arise|baselayer"],
  Dead: ["Armature|Dead|baselayer"],
  Face_Punch_Reaction_2: ["Armature|Face_Punch_Reaction_2|baselayer"],
  Hit_Reaction_to_Waist: ["Armature|Hit_Reaction_to_Waist|baselayer"],
};

function expandZombieClipTryList(shortNames: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of shortNames) {
    if (!seen.has(n)) { seen.add(n); out.push(n); }
    const aliases = ZOMBIE_CLIP_ALIASES_BY_CANONICAL[n];
    if (aliases) {
      for (const a of aliases) {
        if (!seen.has(a)) { seen.add(a); out.push(a); }
      }
    }
  }
  return out;
}

/** Zombie hurt clip tiers — light always prefers Hit_Reaction_to_Waist (die-4 miss). */
export function zombieHurtClipPriority(intensity: DraculaHurtIntensity): string[] {
  let flat: string[];
  switch (intensity) {
    case "light":
      flat = flattenClipGroups([HIT_REACTION_TO_WAIST, FACE_PUNCH_REACTION_2]);
      break;
    case "medium":
      flat = flattenClipGroups([FACE_PUNCH_REACTION_2, HIT_REACTION_TO_WAIST]);
      break;
    case "heavy":
    default:
      flat = flattenClipGroups([FACE_PUNCH_REACTION_2, HIT_REACTION_TO_WAIST]);
      break;
  }
  return expandZombieClipTryList(flat);
}

export function zombieMergedAttackClipPriority(variant: "spell" | "skill" | "light" = "spell"): string[] {
  const ordered =
    variant === "spell"
      ? mergeUniqueClipOrder([...ZOMBIE_ATTACK_SPELL_PRIORITY], [...ZOMBIE_ATTACK_SKILL_PRIORITY])
      : variant === "skill"
        ? mergeUniqueClipOrder([...ZOMBIE_ATTACK_SKILL_PRIORITY], [...ZOMBIE_ATTACK_SPELL_PRIORITY])
        : mergeUniqueClipOrder([...ZOMBIE_ATTACK_LIGHT_PRIORITY], [...ZOMBIE_ATTACK_SPELL_PRIORITY]);
  return expandZombieClipTryList([...ordered, ...ZOMBIE_ATTACK_FALLBACK_TAIL]);
}

/** glTF / Three.js may differ only by case (`idle_6` vs `Idle_6`). */
function matchAnimationNameInsensitive(animationNames: readonly string[], target: string): string | null {
  const tl = target.toLowerCase();
  for (const n of animationNames) {
    if (n.toLowerCase() === tl) return n;
  }
  return null;
}

function firstPreferredMatchingInsensitive(preferred: readonly string[], animationNames: readonly string[]): string | null {
  for (const n of preferred) {
    const hit = matchAnimationNameInsensitive(animationNames, n);
    if (hit) return hit;
  }
  return null;
}

/**
 * If canonical names are missing (re-export), never use `animationNames[0]` for idle — file order can be
 * `falling_down` first and reads as a broken idle.
 */
function draculaIdleSafeLastResort(animationNames: readonly string[]): string | null {
  const block =
    /falling|fall_down|knock|death|\bdead\b|hurt|react|punch|spell|skill|mummy|scream|stand_up|charged|jumping|face_punch|waist|slap|zombie|shot|grip|throw|stagger|limp|injured|dying|collapse/i;
  for (const n of animationNames) {
    if (block.test(n)) continue;
    /** `\bidle\b` misses `Idle_6` because `_` is a word char in JS. */
    if (/idle/i.test(n) || /breath|rest|neutral|wait|relax/i.test(n)) return n;
  }
  const walk = animationNames.find((n) => /^walking$/i.test(n));
  if (walk && !block.test(walk)) return walk;
  return null;
}

function draculaAbsoluteLastResort(state: Monster3DSpriteState, animationNames: readonly string[]): string | null {
  if (state === "idle" || state === "neutral") {
    const safe = draculaIdleSafeLastResort(animationNames);
    if (safe) return safe;
  }
  return animationNames[0] ?? null;
}

/** glTF file basename under `public/models/monsters/<slug>.glb`. */
export const MONSTER_3D_GLB_SLUG_BY_TYPE: Record<MonsterType, string> = {
  V: "dracula",
  Z: "zombie",
  S: "spider",
  G: "ghost",
  K: "skeleton",
  L: "lava",
};

export function isMonster3DEnabled(): boolean {
  return process.env.NEXT_PUBLIC_MONSTER_3D === "1";
}

/**
 * Resolved URL (no `NEXT_PUBLIC_MONSTER_3D` gate).
 * Dracula always uses merged `dracula.glb`; portrait state only selects clips at runtime.
 */
function resolveMonsterGltfUrl(type: MonsterType): string {
  if (type === "V") return DRACULA_MERGED_GLB;
  const slug = MONSTER_3D_GLB_SLUG_BY_TYPE[type];
  return `/models/monsters/${slug}.glb`;
}

/**
 * Public URL to a GLB under `public/models/monsters/`, or `null` to keep 2D sprites.
 * `options.draculaAttackVariant` does not change the URL — pass it to `MonsterModel3D` for clip selection.
 */
export function getMonsterGltfPath(
  type: MonsterType,
  _state: Monster3DSpriteState,
  _options?: { draculaAttackVariant?: "spell" | "skill" | "light" },
): string | null {
  if (!isMonster3DEnabled()) return null;
  return resolveMonsterGltfUrl(type);
}

/** Same URLs as combat when 3D is on; always returns a path (for `/monster-3d-animations` without the env var). */
export function getMonsterGltfPathForReference(
  type: MonsterType,
  _state?: Monster3DSpriteState,
  _options?: { draculaAttackVariant?: "spell" | "skill" | "light" },
): string {
  return resolveMonsterGltfUrl(type);
}

/** Basename of `…/<slug>.glb` from a path or absolute URL (query/hash stripped). */
export function glbSlugFromPathOrUrl(pathOrUrl: string): string | null {
  const base = pathOrUrl.trim().split(/[?#]/)[0] ?? pathOrUrl.trim();
  const m = base.match(/\/([^/]+)\.glb$/i) ?? base.match(/([^/\\]+)\.glb$/i);
  return m ? m[1] : null;
}

/**
 * Optional clip priority per GLB file slug. Merged Dracula uses `MESHY_MERGED_CLIP_PRIORITY.V` + attack variant helper.
 */
export const MONSTER_CLIP_PRIORITY_BY_GLB_SLUG: Record<
  string,
  Partial<Record<Monster3DSpriteState, readonly string[]>>
> = {
  "dracula-dead": {
    defeated: ["Armature|Dead|baselayer", "Dead", "dead", "Death", "death", "Dying", "dying"],
  },
};

const MESHY_MERGED_CLIP_PRIORITY: Partial<
  Record<MonsterType, Partial<Record<Monster3DSpriteState, readonly string[]>>>
> = {
  S: {
    idle: expandSpiderClipTryList(SPIDER_IDLE_CLIPS),
    neutral: expandSpiderClipTryList(SPIDER_IDLE_CLIPS),
    hunt: expandSpiderClipTryList(SPIDER_HUNT_PORTRAIT_CLIPS),
    angry: expandSpiderClipTryList(SPIDER_ANGRY_CLIPS),
    attack: expandSpiderClipTryList(
      mergeUniqueClipOrder([...SPIDER_ATTACK_SPELL_PRIORITY], [...SPIDER_ATTACK_SKILL_PRIORITY]),
    ),
    rolling: expandSpiderClipTryList([
      "Zombie_Scream",
      "Alert",
      "Jumping_Punch",
      "Left_Slash",
    ]),
    hurt: expandSpiderClipTryList([
      "Hit_Reaction_to_Waist",
      "Face_Punch_Reaction_2",
    ]),
    knockdown: expandSpiderClipTryList(["falling_down"]),
    defeated: expandSpiderClipTryList(["Dead"]),
    recover: expandSpiderClipTryList(["Arise", "Walking"]),
  },
  Z: {
    idle: expandZombieClipTryList(ZOMBIE_IDLE_CLIPS),
    neutral: expandZombieClipTryList(ZOMBIE_IDLE_CLIPS),
    hunt: expandZombieClipTryList(ZOMBIE_HUNT_PORTRAIT_CLIPS),
    angry: expandZombieClipTryList(ZOMBIE_ANGRY_CLIPS),
    attack: expandZombieClipTryList(
      mergeUniqueClipOrder([...ZOMBIE_ATTACK_SPELL_PRIORITY], [...ZOMBIE_ATTACK_SKILL_PRIORITY]),
    ),
    rolling: expandZombieClipTryList([
      "Zombie_Scream",
      "Alert",
      "Alert_Quick_Turn_Right",
      "Jumping_Punch",
      "Left_Slash",
    ]),
    hurt: expandZombieClipTryList([
      "Hit_Reaction_to_Waist",
      "Face_Punch_Reaction_2",
    ]),
    knockdown: expandZombieClipTryList(["falling_down"]),
    defeated: expandZombieClipTryList(["Dead"]),
    recover: expandZombieClipTryList(["Arise", "Walking"]),
  },
  /** Merged `dracula.glb` — names match `animations[].name` in the file; aliases appended via `expandDraculaClipTryList`. */
  V: {
    idle: expandDraculaClipTryList(DRACULA_IDLE_CLIPS),
    neutral: expandDraculaClipTryList(DRACULA_IDLE_CLIPS),
    hunt: expandDraculaClipTryList(DRACULA_HUNT_PORTRAIT_CLIPS),
    angry: expandDraculaClipTryList(DRACULA_ANGRY_CLIPS),
    attack: expandDraculaClipTryList(
      mergeUniqueClipOrder([...DRACULA_ATTACK_SPELL_PRIORITY], [...DRACULA_ATTACK_SKILL_PRIORITY]),
    ),
    rolling: expandDraculaClipTryList(["Mummy_Stagger", "Jumping_Punch", "Charged_Spell_Cast_2"]),
    /** Default hurt order when no HP tier: light flinch → harder reactions (contrast with `attack` strikes). */
    hurt: expandDraculaClipTryList(["Face_Punch_Reaction", "Face_Punch_Reaction_2", "Hit_Reaction_to_Waist"]),
    knockdown: expandDraculaClipTryList(["falling_down"]),
    defeated: expandDraculaClipTryList(["Dead"]),
    recover: expandDraculaClipTryList(["Arise", "Stand_Up1", "Walking"]),
  },
  /** Merged Meshy skeleton biped — clip titles aligned with Dracula where the animation name matches. */
  K: {
    idle: expandSkeletonClipTryList(SKELETON_IDLE_CLIPS),
    neutral: expandSkeletonClipTryList(SKELETON_IDLE_CLIPS),
    hunt: expandSkeletonClipTryList(SKELETON_HUNT_PORTRAIT_CLIPS),
    angry: expandSkeletonClipTryList(SKELETON_ANGRY_CLIPS),
    attack: expandSkeletonClipTryList(
      mergeUniqueClipOrder([...SKELETON_ATTACK_SPELL_PRIORITY], [...SKELETON_ATTACK_SKILL_PRIORITY]),
    ),
    rolling: expandSkeletonClipTryList([
      "Mummy_Stagger",
      "Left_Slash",
      "Alert_Quick_Turn_Right",
      "Triple_Combo_Attack",
      "Charged_Spell_Cast_2",
      "Basic_Jump",
    ]),
    hurt: expandSkeletonClipTryList([
      "Face_Punch_Reaction_1",
      "Face_Punch_Reaction_2",
      "Hit_Reaction_to_Waist",
    ]),
    knockdown: expandSkeletonClipTryList(["falling_down"]),
    defeated: expandSkeletonClipTryList(["Dead"]),
    recover: expandSkeletonClipTryList(["Arise", "Stand_Up1", "Walking"]),
  },
};

function baseClipNamesForState(state: Monster3DSpriteState): string[] {
  switch (state) {
    case "attack":
    case "rolling":
      return ["Attack", "attack", "Strike", "strike", "Slash", "slash"];
    case "hurt":
      return ["Hurt", "hurt", "Hit", "hit", "Damage", "damage"];
    case "knockdown":
      return ["Fall", "fall", "Down", "down", "Knockdown", "knockdown"];
    case "defeated":
      return ["Death", "death", "Defeated", "defeated", "Die", "die", "Down", "down"];
    case "recover":
      return ["Recover", "recover", "Weak", "weak", "Tired", "tired", "Idle", "idle"];
    case "hunt":
    case "angry":
      return ["Hunt", "hunt", "Walk", "walk", "Run", "run", "Aggro", "aggro", "Idle", "idle"];
    case "idle":
    case "neutral":
    default:
      return ["Idle", "idle", "Rest", "rest", "Neutral", "neutral"];
  }
}

/** Try these animation clip names first for each combat portrait state (glTF clip names vary by author). */
export function getPreferredClipNamesForState(
  state: Monster3DSpriteState,
  monsterType?: MonsterType | null,
  glbSlug?: string | null,
  draculaAttackVariant?: "spell" | "skill" | "light",
  draculaHurtHp?: { hp: number; maxHp: number } | null,
): string[] {
  const fromSlug = glbSlug ? MONSTER_CLIP_PRIORITY_BY_GLB_SLUG[glbSlug]?.[state] : undefined;
  const meshy = monsterType != null ? MESHY_MERGED_CLIP_PRIORITY[monsterType]?.[state] : undefined;
  const base = baseClipNamesForState(state);
  const merged: string[] = [];
  const seen = new Set<string>();
  const push = (arr?: readonly string[]) => {
    if (!arr?.length) return;
    for (const n of arr) {
      if (!seen.has(n)) {
        seen.add(n);
        merged.push(n);
      }
    }
  };
  const isDraculaMerged = monsterType === "V" && glbSlug === "dracula";
  const isSkeletonMerged = monsterType === "K" && glbSlug === "skeleton";
  const isZombieMerged = monsterType === "Z" && glbSlug === "zombie";
  const isSpiderMerged = monsterType === "S" && glbSlug === "spider";
  push(fromSlug);
  if (isDraculaMerged && state === "attack") {
    push(draculaMergedAttackClipPriority(draculaAttackVariant ?? "spell"));
  } else if (isDraculaMerged && state === "angry") {
    push(expandDraculaClipTryList(DRACULA_ANGRY_CLIPS));
  } else if (isDraculaMerged && state === "hurt" && draculaHurtHp && draculaHurtHp.maxHp >= 1) {
    push(draculaHurtClipPriority(draculaHurtIntensityFromHp(draculaHurtHp.hp, draculaHurtHp.maxHp)));
  } else if (isSkeletonMerged && state === "attack") {
    push(skeletonMergedAttackClipPriority(draculaAttackVariant ?? "spell"));
  } else if (isSkeletonMerged && state === "angry") {
    push(expandSkeletonClipTryList(SKELETON_ANGRY_CLIPS));
  } else if (isSkeletonMerged && state === "hurt" && draculaHurtHp && draculaHurtHp.maxHp >= 1) {
    push(skeletonHurtClipPriority(draculaHurtIntensityFromHp(draculaHurtHp.hp, draculaHurtHp.maxHp)));
  } else if (isZombieMerged && state === "attack") {
    push(zombieMergedAttackClipPriority(draculaAttackVariant ?? "spell"));
  } else if (isZombieMerged && state === "angry") {
    push(expandZombieClipTryList(ZOMBIE_ANGRY_CLIPS));
  } else if (isZombieMerged && state === "hurt" && draculaHurtHp && draculaHurtHp.maxHp >= 1) {
    push(zombieHurtClipPriority(draculaHurtIntensityFromHp(draculaHurtHp.hp, draculaHurtHp.maxHp)));
  } else if (isSpiderMerged && state === "attack") {
    push(spiderMergedAttackClipPriority(draculaAttackVariant ?? "spell"));
  } else if (isSpiderMerged && state === "angry") {
    push(expandSpiderClipTryList(SPIDER_ANGRY_CLIPS));
  } else if (isSpiderMerged && state === "hurt" && draculaHurtHp && draculaHurtHp.maxHp >= 1) {
    push(spiderHurtClipPriority(draculaHurtIntensityFromHp(draculaHurtHp.hp, draculaHurtHp.maxHp)));
  } else {
    push(meshy);
  }
  if (!isDraculaMerged && !isSkeletonMerged && !isZombieMerged && !isSpiderMerged) {
    push(base);
  }
  return merged;
}

function heuristicRegexesForState(state: Monster3DSpriteState): RegExp[] {
  switch (state) {
    case "attack":
    case "rolling":
      return [
        /attack|slash|punch|strike|stab|swing|charged|grab|wall|quad|leap|faith|react|shot|slap|skill|throw|grip|jumping|mummy|stagger/i,
        /\|running\||\bsprint\b|\bwalk\b|limp/i,
      ];
    case "hurt":
      return [/hurt|hit|damage|react|shot|slap|pain|stagger|punch|waist/i, /fall|injured/i];
    case "knockdown":
      return [/fall|down|knock|stagger|collapse|trip|stumble/i, /hurt|hit/i];
    case "defeated":
      return [/death|die|drown|collapse|defeat|knockdown|downed|fall\d|fall_|shot.*fall|hang|\bdead\b/i, /hurt|hit/i];
    case "recover":
      return [
        /stand_up|stand up|get_up|get up|crouch|wall_support|injured|weak|limp|recover|backward|support|step/i,
        /\|walking_man\||\bwalk\b|unsteady|swim/i,
      ];
    case "hunt":
    case "angry":
      return [
        /run|sprint|chase|patrol|stalk|leap|faith|aggr|angry|rage|charged|scream|zombie/i,
        /\|running\||\bwalk\b|limp|unsteady|swim/i,
      ];
    case "idle":
    case "neutral":
    default:
      return [/idle|rest|neutral|breath|stand|waiting|relax|swim_idle|inplace|limp|unsteady|elderly/i, /walk|swim|walking_man/i];
  }
}

/** Last resort for `dracula.glb` only — avoids regex heuristics that can pick the wrong clip. */
function draculaMergedCanonicalFallback(
  state: Monster3DSpriteState,
  animationNames: readonly string[],
): string | null {
  const tries: Partial<Record<Monster3DSpriteState, readonly string[]>> = {
    idle: [...DRACULA_IDLE_CLIPS],
    neutral: [...DRACULA_IDLE_CLIPS],
    hunt: [...DRACULA_HUNT_PORTRAIT_CLIPS],
    angry: [...DRACULA_ANGRY_CLIPS],
    attack: [
      ...mergeUniqueClipOrder([...DRACULA_ATTACK_SPELL_PRIORITY], [...DRACULA_ATTACK_SKILL_PRIORITY]),
      ...DRACULA_ATTACK_FALLBACK_TAIL,
    ],
    rolling: ["Mummy_Stagger", "Jumping_Punch", "Charged_Spell_Cast_2"],
    hurt: ["Face_Punch_Reaction", "Face_Punch_Reaction_2", "Hit_Reaction_to_Waist"],
    knockdown: ["falling_down"],
    defeated: ["Dead"],
    recover: ["Arise", "Stand_Up1", "Walking"],
  };
  const list = tries[state];
  if (!list) return null;
  for (const n of expandDraculaClipTryList(list)) {
    const hit = matchAnimationNameInsensitive(animationNames, n);
    if (hit) return hit;
  }
  return null;
}

function skeletonIdleSafeLastResort(animationNames: readonly string[]): string | null {
  const block =
    /falling|fall_down|knock|death|\bdead\b|hurt|react|punch|spell|skill|mummy|scream|stand_up|charged|jumping|face_punch|waist|slap|zombie|shot|grip|throw|stagger|limp|injured|dying|collapse|slash|combo|arise/i;
  for (const n of animationNames) {
    if (block.test(n)) continue;
    if (/idle/i.test(n) || /breath|rest|neutral|wait|relax/i.test(n)) return n;
  }
  const walk = animationNames.find((n) => /walking|walk/i.test(n) && !block.test(n));
  if (walk) return walk;
  return null;
}

function skeletonAbsoluteLastResort(state: Monster3DSpriteState, animationNames: readonly string[]): string | null {
  if (state === "idle" || state === "neutral") {
    const safe = skeletonIdleSafeLastResort(animationNames);
    if (safe) return safe;
  }
  return animationNames[0] ?? null;
}

/** Last resort for merged `skeleton.glb` — same role as `draculaMergedCanonicalFallback`. */
function skeletonMergedCanonicalFallback(
  state: Monster3DSpriteState,
  animationNames: readonly string[],
): string | null {
  const tries: Partial<Record<Monster3DSpriteState, readonly string[]>> = {
    idle: [...SKELETON_IDLE_CLIPS],
    neutral: [...SKELETON_IDLE_CLIPS],
    hunt: [...SKELETON_HUNT_PORTRAIT_CLIPS],
    angry: [...SKELETON_ANGRY_CLIPS],
    attack: [
      ...mergeUniqueClipOrder([...SKELETON_ATTACK_SPELL_PRIORITY], [...SKELETON_ATTACK_SKILL_PRIORITY]),
      ...SKELETON_ATTACK_FALLBACK_TAIL,
    ],
    rolling: ["Mummy_Stagger", "Left_Slash", "Alert_Quick_Turn_Right", "Triple_Combo_Attack", "Charged_Spell_Cast_2"],
    hurt: ["Hit_Reaction_to_Waist","Face_Punch_Reaction_1", "Face_Punch_Reaction_2"],
    knockdown: ["falling_down"],
    defeated: ["Dead"],
    recover: ["Arise", "Stand_Up1", "Walking"],
  };
  const list = tries[state];
  if (!list) return null;
  for (const n of expandSkeletonClipTryList(list)) {
    const hit = matchAnimationNameInsensitive(animationNames, n);
    if (hit) return hit;
  }
  return null;
}

/** Last resort for merged `zombie.glb` — same role as skeleton / dracula fallbacks. */
function zombieMergedCanonicalFallback(
  state: Monster3DSpriteState,
  animationNames: readonly string[],
): string | null {
  const tries: Partial<Record<Monster3DSpriteState, readonly string[]>> = {
    idle: [...ZOMBIE_IDLE_CLIPS],
    neutral: [...ZOMBIE_IDLE_CLIPS],
    hunt: [...ZOMBIE_HUNT_PORTRAIT_CLIPS],
    angry: [...ZOMBIE_ANGRY_CLIPS],
    attack: [
      ...mergeUniqueClipOrder([...ZOMBIE_ATTACK_SPELL_PRIORITY], [...ZOMBIE_ATTACK_SKILL_PRIORITY]),
      ...ZOMBIE_ATTACK_FALLBACK_TAIL,
    ],
    rolling: ["Zombie_Scream", "Alert", "Alert_Quick_Turn_Right", "Jumping_Punch"],
    hurt: ["Hit_Reaction_to_Waist", "Face_Punch_Reaction_2"],
    knockdown: ["falling_down"],
    defeated: ["Dead"],
    recover: ["Arise", "Walking"],
  };
  const list = tries[state];
  if (!list) return null;
  for (const n of expandZombieClipTryList(list)) {
    const hit = matchAnimationNameInsensitive(animationNames, n);
    if (hit) return hit;
  }
  return null;
}

function zombieIdleSafeLastResort(animationNames: readonly string[]): string | null {
  const block =
    /falling|fall_down|knock|death|\bdead\b|hurt|react|punch|spell|skill|scream|stand_up|charged|jumping|face_punch|waist|slap|shot|grip|throw|stagger|injured|dying|collapse|slash|hook|arise/i;
  for (const n of animationNames) {
    if (block.test(n)) continue;
    if (/idle|elderly|shaky/i.test(n) || /breath|rest|neutral|wait|relax/i.test(n)) return n;
  }
  const walk = animationNames.find((n) => /walking|walk|unsteady/i.test(n) && !block.test(n));
  if (walk) return walk;
  return null;
}

function zombieAbsoluteLastResort(state: Monster3DSpriteState, animationNames: readonly string[]): string | null {
  if (state === "idle" || state === "neutral") {
    const safe = zombieIdleSafeLastResort(animationNames);
    if (safe) return safe;
  }
  return animationNames[0] ?? null;
}

function spiderMergedCanonicalFallback(
  state: Monster3DSpriteState,
  animationNames: readonly string[],
): string | null {
  const tries: Partial<Record<Monster3DSpriteState, readonly string[]>> = {
    idle: [...SPIDER_IDLE_CLIPS],
    neutral: [...SPIDER_IDLE_CLIPS],
    hunt: [...SPIDER_HUNT_PORTRAIT_CLIPS],
    angry: [...SPIDER_ANGRY_CLIPS],
    attack: [
      ...mergeUniqueClipOrder([...SPIDER_ATTACK_SPELL_PRIORITY], [...SPIDER_ATTACK_SKILL_PRIORITY]),
      ...SPIDER_ATTACK_FALLBACK_TAIL,
    ],
    rolling: ["Zombie_Scream", "Alert", "Jumping_Punch", "Left_Slash"],
    hurt: ["Hit_Reaction_to_Waist", "Face_Punch_Reaction_2"],
    knockdown: ["falling_down"],
    defeated: ["Dead"],
    recover: ["Arise", "Walking"],
  };
  const list = tries[state];
  if (!list) return null;
  for (const n of expandSpiderClipTryList(list)) {
    const hit = matchAnimationNameInsensitive(animationNames, n);
    if (hit) return hit;
  }
  return null;
}

function spiderIdleSafeLastResort(animationNames: readonly string[]): string | null {
  const block =
    /falling|fall_down|knock|death|\bdead\b|hurt|react|punch|spell|skill|scream|stand_up|charged|jumping|face_punch|waist|slap|shot|grip|throw|stagger|injured|dying|collapse|slash|hook|arise/i;
  for (const n of animationNames) {
    if (block.test(n)) continue;
    if (/idle/i.test(n) || /breath|rest|neutral|wait|relax/i.test(n)) return n;
  }
  const walk = animationNames.find((n) => /walking|walk/i.test(n) && !block.test(n));
  if (walk) return walk;
  return null;
}

function spiderAbsoluteLastResort(state: Monster3DSpriteState, animationNames: readonly string[]): string | null {
  if (state === "idle" || state === "neutral") {
    const safe = spiderIdleSafeLastResort(animationNames);
    if (safe) return safe;
  }
  return animationNames[0] ?? null;
}

export function resolveMonsterAnimationClipName(
  state: Monster3DSpriteState,
  animationNames: readonly string[],
  options?: {
    monsterType?: MonsterType | null;
    glbSlug?: string | null;
    draculaAttackVariant?: "spell" | "skill" | "light";
    /** When set with Dracula + `hurt`, picks light / medium / heavy hit clips from HP / max. */
    draculaHurtHp?: { hp: number; maxHp: number } | null;
    /** Dracula player-loss banner: force **`Skill_01`** for `angry` (see `MonsterModel3D` `draculaLoopAngrySkill01`). */
    draculaAngryLockSkill01?: boolean;
  },
): string | null {
  if (animationNames.length === 0) return null;

  if (options?.glbSlug === "dracula" && state === "angry" && options?.draculaAngryLockSkill01) {
    const s1 = matchAnimationNameInsensitive(animationNames, "Skill_01");
    if (s1) return s1;
  }

  /**
   * Unconditional calm clips for merged Dracula — bypasses preferred-list / tier logic so `idle` can never
   * resolve to `falling_down` (or any other strike clip) from a bug or stale ordering.
   */
  if (options?.glbSlug === "dracula" && (state === "idle" || state === "neutral")) {
    const calm =
      matchAnimationNameInsensitive(animationNames, "Idle_6") ??
      matchAnimationNameInsensitive(animationNames, "Walking");
    if (calm) return calm;
  }

  if (options?.glbSlug === "skeleton" && (state === "idle" || state === "neutral")) {
    for (const probe of expandSkeletonClipTryList(SKELETON_IDLE_CLIPS)) {
      const calm = matchAnimationNameInsensitive(animationNames, probe);
      if (calm) return calm;
    }
  }

  if (options?.glbSlug === "zombie" && (state === "idle" || state === "neutral")) {
    for (const probe of expandZombieClipTryList(ZOMBIE_IDLE_CLIPS)) {
      const calm = matchAnimationNameInsensitive(animationNames, probe);
      if (calm) return calm;
    }
  }

  if (options?.glbSlug === "spider" && (state === "idle" || state === "neutral")) {
    for (const probe of expandSpiderClipTryList(SPIDER_IDLE_CLIPS)) {
      const calm = matchAnimationNameInsensitive(animationNames, probe);
      if (calm) return calm;
    }
  }

  const preferred = getPreferredClipNamesForState(
    state,
    options?.monsterType ?? null,
    options?.glbSlug ?? null,
    options?.draculaAttackVariant,
    options?.draculaHurtHp ?? null,
  );
  const available = new Set(animationNames);

  for (const n of preferred) {
    if (available.has(n)) return n;
  }

  if (options?.glbSlug === "dracula") {
    const ci = firstPreferredMatchingInsensitive(preferred, animationNames);
    if (ci) return ci;
    const fb = draculaMergedCanonicalFallback(state, animationNames);
    if (fb) return fb;
    return draculaAbsoluteLastResort(state, animationNames);
  }

  if (options?.glbSlug === "skeleton") {
    const ci = firstPreferredMatchingInsensitive(preferred, animationNames);
    if (ci) return ci;
    const fb = skeletonMergedCanonicalFallback(state, animationNames);
    if (fb) return fb;
    return skeletonAbsoluteLastResort(state, animationNames);
  }

  if (options?.glbSlug === "zombie") {
    const ci = firstPreferredMatchingInsensitive(preferred, animationNames);
    if (ci) return ci;
    const fb = zombieMergedCanonicalFallback(state, animationNames);
    if (fb) return fb;
    return zombieAbsoluteLastResort(state, animationNames);
  }

  if (options?.glbSlug === "spider") {
    const ci = firstPreferredMatchingInsensitive(preferred, animationNames);
    if (ci) return ci;
    const fb = spiderMergedCanonicalFallback(state, animationNames);
    if (fb) return fb;
    return spiderAbsoluteLastResort(state, animationNames);
  }

  const lowerPref = preferred.map((p) => p.toLowerCase());
  for (const nm of animationNames) {
    const nl = nm.toLowerCase();
    const fuzzyHit = lowerPref.some((p) => {
      if (p.length === 0) return false;
      if (!(nl.includes(p) || p.includes(nl))) return false;
      if (p === "walk" && nl.includes("walking")) return false;
      if (p === "run" && nl.includes("running")) return false;
      return true;
    });
    if (fuzzyHit) return nm;
  }

  for (const re of heuristicRegexesForState(state)) {
    const hit = animationNames.find((nm) => re.test(nm));
    if (hit) return hit;
  }

  if (state === "attack" || state === "rolling" || state === "angry" || state === "hunt" || state === "knockdown") {
    const move = animationNames.find((nm) => /\|running\||\bsprint\b|\bwalk\b|limp|leap/i.test(nm));
    if (move) return move;
  }

  const idleish = animationNames.find((n) => /idle|rest|neutral|swim_idle|inplace/i.test(n));
  if (idleish) return idleish;

  return animationNames[0] ?? null;
}
