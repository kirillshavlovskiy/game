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
export function draculaMergedAttackClipPriority(variant: "spell" | "skill" = "spell"): string[] {
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
  _options?: { draculaAttackVariant?: "spell" | "skill" },
): string | null {
  if (!isMonster3DEnabled()) return null;
  return resolveMonsterGltfUrl(type);
}

/** Same URLs as combat when 3D is on; always returns a path (for `/monster-3d-animations` without the env var). */
export function getMonsterGltfPathForReference(
  type: MonsterType,
  _state?: Monster3DSpriteState,
  _options?: { draculaAttackVariant?: "spell" | "skill" },
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
  Z: {
    idle: ["Walking", "Unsteady_Walk", "Limping_Walk_3_inplace", "Elderly_Shaky_Walk_inplace", "Limping_Walk_3"],
    neutral: ["Walking", "Unsteady_Walk", "Limping_Walk_3_inplace", "Elderly_Shaky_Walk_inplace", "Limping_Walk_3"],
    hunt: ["Running", "Walking", "Unsteady_Walk", "Limping_Walk_3_inplace"],
    angry: ["Running", "Walking", "Unsteady_Walk"],
    attack: ["Face_Punch_Reaction", "Face_Punch_Reaction_2", "Slap_Reaction", "Running"],
    rolling: ["Face_Punch_Reaction", "Face_Punch_Reaction_2", "Slap_Reaction", "Running"],
    hurt: ["Hit_Reaction", "Slap_Reaction", "Face_Punch_Reaction"],
    defeated: ["Hit_Reaction", "Face_Punch_Reaction_2", "Injured_Walk_Backward_inplace"],
    recover: ["Injured_Walk_Backward_inplace", "Unsteady_Walk", "Walking", "Limping_Walk_3_inplace"],
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
    recover: expandDraculaClipTryList(["Stand_Up1", "Walking"]),
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
  draculaAttackVariant?: "spell" | "skill",
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
  push(fromSlug);
  if (isDraculaMerged && state === "attack") {
    push(draculaMergedAttackClipPriority(draculaAttackVariant ?? "spell"));
  } else if (isDraculaMerged && state === "angry") {
    /** Hard surprise stance — `Skill_01` first (see `DRACULA_ANGRY_CLIPS`). */
    push(expandDraculaClipTryList(DRACULA_ANGRY_CLIPS));
  } else if (isDraculaMerged && state === "hurt" && draculaHurtHp && draculaHurtHp.maxHp >= 1) {
    push(draculaHurtClipPriority(draculaHurtIntensityFromHp(draculaHurtHp.hp, draculaHurtHp.maxHp)));
  } else {
    push(meshy);
  }
  if (!isDraculaMerged) {
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
    recover: ["Stand_Up1", "Walking"],
  };
  const list = tries[state];
  if (!list) return null;
  for (const n of expandDraculaClipTryList(list)) {
    const hit = matchAnimationNameInsensitive(animationNames, n);
    if (hit) return hit;
  }
  return null;
}

export function resolveMonsterAnimationClipName(
  state: Monster3DSpriteState,
  animationNames: readonly string[],
  options?: {
    monsterType?: MonsterType | null;
    glbSlug?: string | null;
    draculaAttackVariant?: "spell" | "skill";
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
