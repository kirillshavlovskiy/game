/**
 * Unified 3D face-off contact: each side is **strike tier × defender pose** only — six combos per direction.
 * `hurt` = standing flinch / post-hit; `knockdown` = downed defender. Pre-contact (hunt/idle vs incoming swing)
 * uses the **hurt** column — same spacing as “about to absorb a standing hit”.
 */
import type { MonsterType } from "@/lib/labyrinth";
import type { Monster3DSpriteState } from "@/lib/monsterModels3d";

export type Combat3dStrikeTier = "spell" | "skill" | "light";
export type Combat3dDefenderPose = "hurt" | "knockdown";

/** Type `K` (skeleton): default face-off reads strikes landing early — add to every combat half-distance. */
export const SKELETON_FACE_OFF_EXTRA_SEPARATION_HALF = 0.14;

export function skeletonFaceOffExtraSeparationHalf(
  monsterType: MonsterType | null | undefined,
): number {
  return monsterType === "K" ? SKELETON_FACE_OFF_EXTRA_SEPARATION_HALF : 0;
}

export interface Combat3dContactRow {
  /** World X half-distance (|playerX| = |monsterX|) for this beat. */
  separationHalf: number;
  /** Seconds into attacker clip on play — skips wind-up toward contact frame. */
  attackerLeadInSec: number;
  /** Seconds into defender hurt/knockdown clip — aligns reaction with contact. */
  defenderReactionLeadInSec: number;
}

/**
 * Hunt → hurt crossfade while monster **spell** (Jumping_Punch) is playing: default 0.38s keeps hunt locomotion
 * visible through the punch; shorter fade locks the player to hurt pose in time with contact.
 */
/** Near-cut: hunt locomotion was still visible through Jumping_Punch contact. */
export const MONSTER_SPELL_PLAYER_HUNT_TO_HURT_CROSSFADE_SEC = 0.08;
/** Symmetric: player skill jump → monster standing hurt (same crossfade intent as monster spell → player hurt). */
export const PLAYER_SKILL_MONSTER_HUNT_TO_HURT_CROSSFADE_SEC = MONSTER_SPELL_PLAYER_HUNT_TO_HURT_CROSSFADE_SEC;

/**
 * Lethal spell (Jumping_Punch): skip into `Shot_and_Fall_*` so the **visible** collapse lines up with monster contact.
 * Without this, t=0 is mostly pre-hit / root-setup while the punch clip is already at impact (deep `attackerLeadInSec`).
 */
export const PLAYER_FATAL_JUMP_HURT_CLIP_LEAD_IN_SEC = 0.26;

/** Monster swings at player: tier × (player hurt | player knockdown). */
export const MONSTER_HITS_PLAYER: Record<Combat3dStrikeTier, Record<Combat3dDefenderPose, Combat3dContactRow>> = {
  spell: {
    hurt: {
      /** Jumping_Punch: tight X, deep skip into clip (near contact frame), player hurt synced to same beat. */
      separationHalf: 0.4,
      /** Deeper skip + merged monster root lock — impact lines up without root lunge landing past the player. */
      attackerLeadInSec: 0.66,
      /** Lower skip so standing flinch / fall reads on monster contact, not before (pairs with spell jump mult + adjust sync). */
      defenderReactionLeadInSec: 0.28,
    },
    knockdown: {
      separationHalf: 0.42,
      attackerLeadInSec: 0.38,
      defenderReactionLeadInSec: 0.35,
    },
  },
  skill: {
    hurt: {
      /** Was 0.68 — hunt/readout stopped short; closer X so the strike lands near the player. */
      separationHalf: 0.52,
      /** Small skip so non-jump strikes near contact; was 0 + 1.16 defender (player deep in hurt while monster at t≈0). */
      attackerLeadInSec: 0.22,
      defenderReactionLeadInSec: 0.22,
    },
    knockdown: {
      separationHalf: 0.42,
      attackerLeadInSec: 0,
      defenderReactionLeadInSec: 1.0,
    },
  },
  light: {
    hurt: {
      separationHalf: 0.56,
      attackerLeadInSec: 0,
      defenderReactionLeadInSec: 0.08,
    },
    knockdown: {
      separationHalf: 0.42,
      attackerLeadInSec: 0,
      defenderReactionLeadInSec: 0.15,
    },
  },
};

/**
 * Merged Meshy: hunt/roll → `attack` crossfade (sec). **Not** derived from clip duration — overlap only (how long hunt
 * weights blend out). Impact **timing** is `PLAYER_HITS_MONSTER.*.attackerLeadInSec` (where we seek the attack clip).
 */
export const PLAYER_HUNT_TO_ATTACK_CROSSFADE_SEC_BY_TIER: Record<Combat3dStrikeTier, number> = {
  spell: 0.22,
  /** Mirrored from `MONSTER_HUNT_TO_ATTACK_CROSSFADE_SEC_BY_TIER.spell` — player skill jump reads like monster spell strike. */
  skill: 0.34,
  light: 0.34,
};

/** Monster merged rig: hunt/roll → `attack` — per strike tier (defaults were a flat 0.38 in the mixer). */
export const MONSTER_HUNT_TO_ATTACK_CROSSFADE_SEC_BY_TIER: Record<Combat3dStrikeTier, number> = {
  spell: 0.34,
  skill: 0.32,
  light: 0.38,
};

/** Player swings at monster: tier × (monster hurt | monster knockdown). */
export const PLAYER_HITS_MONSTER: Record<Combat3dStrikeTier, Record<Combat3dDefenderPose, Combat3dContactRow>> = {
  spell: {
    hurt: {
      separationHalf: 0.68,
      /**
       * Player `attack` vs monster **standing hurt**. Keep moderate skip so **jump wind-up** (e.g. Jumping_Punch) stays on screen;
       * very large values hid the takeoff entirely.
       */
      attackerLeadInSec: 0.34,
      defenderReactionLeadInSec: 0.2,
    },
    knockdown: {
      separationHalf: 0.42,
      /** Fall clips: **smaller** defender skip than `spell.hurt` — large seeks break `Shot_and_Fall_*` intros. */
      attackerLeadInSec: 0.36,
      defenderReactionLeadInSec: 0.08,
    },
  },
  skill: {
    hurt: {
      /**
       * Player skill leads with `Jumping_Punch` (wasteland drifter). Mirroring `MONSTER_HITS_PLAYER.spell` (0.4 / 0.66)
       * skipped so deep into the clip that root motion read as starting **past** the defender on merged rigs.
       * Wider half + shallower skip match the intent of `playerSpell` / lab: visible approach, then contact.
       */
      separationHalf: 0.58,
      attackerLeadInSec: 0.28,
      defenderReactionLeadInSec: 0.16,
    },
    knockdown: {
      separationHalf: MONSTER_HITS_PLAYER.spell.knockdown.separationHalf,
      attackerLeadInSec: MONSTER_HITS_PLAYER.spell.knockdown.attackerLeadInSec,
      defenderReactionLeadInSec: MONSTER_HITS_PLAYER.spell.knockdown.defenderReactionLeadInSec,
    },
  },
  light: {
    hurt: {
      /** Closer jab read on merged rigs (was 0.7 + loose face-off half). */
      separationHalf: 0.5,
      /** Slightly deeper skip so impact lines up with defender; pairs with low `defenderReactionLeadInSec`. */
      attackerLeadInSec: 0.3,
      /** Keep near t=0 so standing hurt (e.g. zombie) does not flinch before the light strike lands. */
      defenderReactionLeadInSec: 0.02,
    },
    knockdown: {
      separationHalf: 0.42,
      attackerLeadInSec: 0.18,
      defenderReactionLeadInSec: 0.05,
    },
  },
};

/** Extra skip into player **hurt** clip — merged rig timing only (one number per type). */
export const PLAYER_HURT_REACTION_DELTA_BY_MONSTER: Partial<
  Record<import("@/lib/labyrinth").MonsterType, number>
> = {
  V: 0,
  K: 0,
  Z: 0,
  G: 0,
  S: 0,
  L: 0,
};

/** Inner half caps when **both** are in `attack` (simultaneous exchange — use both spell/skill/light vs hurt columns). */
export const MUTUAL_ATTACK_INNER_HALF: Record<Combat3dStrikeTier, number> = {
  spell: 0.06,
  skill: 0.28,
  light: 0.38,
};

const COMBAT_IDLE_SEPARATION_HALF = 1.38;
const COMBAT_STRIKE_PICK_SEPARATION_HALF = 0.92;
const MUTUAL_ATTACK_HALF_FLOOR = 0.38;

/** Half-distance during idle→strike walk-in (same lerp as `!useStrikeContactSpacing` in `resolveCombat3dFaceOffSeparationHalf`). */
export function approachPhaseSeparationHalf(rollingApproachBlend: number): number {
  const t = Math.max(0, Math.min(1, rollingApproachBlend));
  return COMBAT_IDLE_SEPARATION_HALF * (1 - t) + COMBAT_STRIKE_PICK_SEPARATION_HALF * t;
}

/**
 * Wide approach (large half-distance) → start the attacker clip nearer t=0 (lower skip into jump strike).
 * Tight face-off half → full table `attackerLeadInSec` / defender reaction skip.
 */
export function contactJumpStrikeLeadMultiplier(
  rollingApproachBlend: number,
  tightFaceOffSeparationHalf: number,
): number {
  const sep = approachPhaseSeparationHalf(rollingApproachBlend);
  const wide = COMBAT_IDLE_SEPARATION_HALF;
  if (sep <= tightFaceOffSeparationHalf + 1e-4) return 1;
  if (sep >= wide - 1e-4) return 0;
  return 1 - (sep - tightFaceOffSeparationHalf) / (wide - tightFaceOffSeparationHalf);
}

/** Monster spell (Jumping_Punch) vs standing player — scales monster attack skip + player hurt sync from approach blend. */
export function monsterSpellJumpContactLeadMultiplier(rollingApproachBlend: number): number {
  return contactJumpStrikeLeadMultiplier(
    rollingApproachBlend,
    MONSTER_HITS_PLAYER.spell.hurt.separationHalf,
  );
}

/** Player skill jump vs standing monster — same geometry as `monsterSpellJumpContactLeadMultiplier` (shared tight half). */
export function playerSkillJumpContactLeadMultiplier(rollingApproachBlend: number): number {
  return contactJumpStrikeLeadMultiplier(
    rollingApproachBlend,
    PLAYER_HITS_MONSTER.skill.hurt.separationHalf,
  );
}

export function coerceStrikeTier(v: Combat3dStrikeTier | undefined): Combat3dStrikeTier {
  return v === "spell" || v === "skill" || v === "light" ? v : "skill";
}

/** Use for **clip lead-ins** only — never default an unknown tier to `skill` or spell/light timings bleed together. */
export function isKnownCombatStrikeTier(v: Combat3dStrikeTier | undefined): v is Combat3dStrikeTier {
  return v === "spell" || v === "skill" || v === "light";
}

/**
 * Map GLB portrait → defender column. Anything that is not knockdown uses **hurt** (incl. hunt/idle during wind-up).
 */
export function defenderPoseFromVisual(state: Monster3DSpriteState): Combat3dDefenderPose {
  return state === "knockdown" ? "knockdown" : "hurt";
}

export function rowMonsterHitsPlayer(
  tier: Combat3dStrikeTier | undefined,
  playerState: Monster3DSpriteState,
): Combat3dContactRow {
  const t = coerceStrikeTier(tier);
  return MONSTER_HITS_PLAYER[t][defenderPoseFromVisual(playerState)];
}

export function rowPlayerHitsMonster(
  tier: Combat3dStrikeTier | undefined,
  monsterState: Monster3DSpriteState,
): Combat3dContactRow {
  const t = coerceStrikeTier(tier);
  return PLAYER_HITS_MONSTER[t][defenderPoseFromVisual(monsterState)];
}

/**
 * When the monster uses a **shorter** attack skip than the table (e.g. spell jump mult), impact happens later in
 * wall-clock — pull player hurt skip back so the flinch lines up with that impact.
 */
export function adjustPlayerHurtLeadForMonsterAttackSync(
  monsterTier: Combat3dStrikeTier | undefined,
  monsterType: MonsterType | null | undefined,
  playerVisualState: Monster3DSpriteState,
  effectiveMonsterAttackLeadSec: number,
): number {
  const base = playerHurtClipLeadAfterMonsterHit(monsterTier, monsterType, playerVisualState);
  const t = coerceStrikeTier(monsterTier);
  const row = MONSTER_HITS_PLAYER[t][defenderPoseFromVisual(playerVisualState)];
  const drift = row.attackerLeadInSec - effectiveMonsterAttackLeadSec;
  if (!(drift > 0)) return base;
  return Math.max(0, base - drift);
}

/** Base skip into monster `hurt` / `knockdown` after a merged player hit (table `defenderReactionLeadInSec`). */
export function monsterHurtClipLeadAfterPlayerHit(
  playerTier: Combat3dStrikeTier | undefined,
  monsterVisualState: Monster3DSpriteState = "hurt",
): number {
  if (!isKnownCombatStrikeTier(playerTier)) return 0;
  const pose = defenderPoseFromVisual(monsterVisualState);
  return PLAYER_HITS_MONSTER[playerTier][pose].defenderReactionLeadInSec;
}

/**
 * When the player uses a **shorter** attack skip than the table (e.g. skill jump mult on wide approach), contact is later —
 * pull monster hurt skip back so the flinch lines up (mirror of `adjustPlayerHurtLeadForMonsterAttackSync`).
 */
export function adjustMonsterHurtLeadForPlayerAttackSync(
  playerTier: Combat3dStrikeTier | undefined,
  monsterVisualState: Monster3DSpriteState,
  effectivePlayerAttackLeadSec: number,
): number {
  const base = monsterHurtClipLeadAfterPlayerHit(playerTier, monsterVisualState);
  if (!isKnownCombatStrikeTier(playerTier)) return base;
  const pose = defenderPoseFromVisual(monsterVisualState);
  const row = PLAYER_HITS_MONSTER[playerTier][pose];
  const drift = row.attackerLeadInSec - effectivePlayerAttackLeadSec;
  if (!(drift > 0)) return base;
  return Math.max(0, base - drift);
}

/** When the player uses a **longer** per-clip attack skip than the table, impact is later — skip deeper into monster hurt. */
export function extraMonsterHurtLeadAfterPlayerAttackSync(
  playerTier: Combat3dStrikeTier | undefined,
  monsterVisualState: Monster3DSpriteState,
  effectivePlayerAttackLeadSec: number,
): number {
  const t = coerceStrikeTier(playerTier);
  const row = PLAYER_HITS_MONSTER[t][defenderPoseFromVisual(monsterVisualState)];
  const drift = effectivePlayerAttackLeadSec - row.attackerLeadInSec;
  if (!(drift > 0)) return 0;
  return drift;
}

/** Player `hurt` / `knockdown` reaction clip offset after merged monster hit. */
export function playerHurtClipLeadAfterMonsterHit(
  monsterTier: Combat3dStrikeTier | undefined,
  monsterType: MonsterType | null | undefined,
  playerVisualState: Monster3DSpriteState = "hurt",
): number {
  if (!isKnownCombatStrikeTier(monsterTier)) return 0;
  const pose = defenderPoseFromVisual(playerVisualState);
  const row = MONSTER_HITS_PLAYER[monsterTier][pose];
  const base = row.defenderReactionLeadInSec;
  const d =
    monsterType && monsterType in PLAYER_HURT_REACTION_DELTA_BY_MONSTER
      ? (PLAYER_HURT_REACTION_DELTA_BY_MONSTER[monsterType] ?? 0)
      : 0;
  return Math.max(0, base + d);
}

export interface Combat3dFaceOffArgs {
  isContactExchange: boolean;
  rollingApproachBlend: number;
  playerVisualState: Monster3DSpriteState;
  monsterVisualState: Monster3DSpriteState;
  playerAttackVariant?: Combat3dStrikeTier;
  draculaAttackVariant?: Combat3dStrikeTier;
  /** When `K` (skeleton), matches `combatFaceOffPositions` extra standoff. */
  monsterType?: MonsterType | null;
}

/** Same X positions as legacy `combatFaceOffPositions` — driven only by unified matrices + mutual inner half. */
export function resolveCombat3dFaceOffSeparationHalf(args: Combat3dFaceOffArgs): number {
  const {
    isContactExchange,
    rollingApproachBlend,
    playerVisualState,
    monsterVisualState,
    playerAttackVariant,
    draculaAttackVariant,
    monsterType,
  } = args;
  const sk = skeletonFaceOffExtraSeparationHalf(monsterType);

  const inPostHitPose =
    playerVisualState === "hurt" ||
    monsterVisualState === "hurt" ||
    playerVisualState === "recover" ||
    monsterVisualState === "recover" ||
    playerVisualState === "knockdown" ||
    monsterVisualState === "knockdown";

  const useStrikeContactSpacing =
    isContactExchange ||
    playerVisualState === "attack" ||
    monsterVisualState === "attack" ||
    inPostHitPose;

  if (!useStrikeContactSpacing) {
    const idle = COMBAT_IDLE_SEPARATION_HALF;
    const t = Math.max(0, Math.min(1, rollingApproachBlend));
    return idle * (1 - t) + COMBAT_STRIKE_PICK_SEPARATION_HALF * t + sk;
  }

  const pAtk = playerVisualState === "attack";
  const mAtk = monsterVisualState === "attack";
  const pKd = playerVisualState === "knockdown";
  const mKd = monsterVisualState === "knockdown";

  const attackVsKnockdown = (pKd && mAtk && !pAtk) || (mKd && pAtk && !mAtk);
  const mirroredHeavyKnockdown = monsterVisualState === "knockdown" && playerVisualState === "angry";

  if (attackVsKnockdown || mirroredHeavyKnockdown) {
    if (mAtk && !pAtk) {
      return rowMonsterHitsPlayer(draculaAttackVariant, playerVisualState).separationHalf + sk;
    }
    if (pAtk && !mAtk) {
      return rowPlayerHitsMonster(playerAttackVariant, monsterVisualState).separationHalf + sk;
    }
    if (mirroredHeavyKnockdown) {
      return rowPlayerHitsMonster(playerAttackVariant, "knockdown").separationHalf + sk;
    }
    return COMBAT_STRIKE_PICK_SEPARATION_HALF + sk;
  }

  if (pAtk && mAtk) {
    const pt = coerceStrikeTier(playerAttackVariant);
    const mt = coerceStrikeTier(draculaAttackVariant);
    const inner = Math.max(
      MUTUAL_ATTACK_INNER_HALF[pt],
      MUTUAL_ATTACK_INNER_HALF[mt],
      MUTUAL_ATTACK_HALF_FLOOR,
    );
    return inner + sk;
  }

  if (mAtk && !pAtk) {
    return rowMonsterHitsPlayer(draculaAttackVariant, playerVisualState).separationHalf + sk;
  }
  if (pAtk && !mAtk) {
    let h = rowPlayerHitsMonster(playerAttackVariant, monsterVisualState).separationHalf;
    /** Matches `combatFaceOffPositions` — recover looser than `skill`/`hurt` so clips do not stack on a rising body. */
    if (playerAttackVariant === "skill" && monsterVisualState === "recover") {
      h = PLAYER_HITS_MONSTER.spell.hurt.separationHalf;
    }
    return h + sk;
  }

  return COMBAT_STRIKE_PICK_SEPARATION_HALF + sk;
}

export interface Combat3dResolvedLeads {
  meshyPlayerHurtLeadInSec: number;
  meshyPlayerAttackLeadInSec: number;
  meshyMonsterAttackLeadInSec: number;
  meshyMonsterHurtLeadInSec: number;
  /** When player is in `attack` vs non-attacking monster — hunt→attack blend for merged player rig. */
  meshyPlayerHuntToAttackCrossfadeSec: number | undefined;
  /** When monster is in `attack` vs non-attacking player — hunt→attack blend for merged monster rig. */
  meshyMonsterHuntToAttackCrossfadeSec: number | undefined;
}

export function resolveCombat3dClipLeads(args: {
  isMergedMeshy: boolean;
  monsterType: MonsterType | null | undefined;
  playerVisualState: Monster3DSpriteState;
  monsterVisualState: Monster3DSpriteState;
  draculaAttackVariant?: Combat3dStrikeTier;
  playerAttackVariant?: Combat3dStrikeTier;
  playerFatalJumpKill: boolean;
  /** 0 = max walk-in spacing, 1 = strike-pick spacing — scales spell jump skip + player hurt skip (default 1). */
  rollingApproachBlend?: number;
}): Combat3dResolvedLeads {
  const {
    isMergedMeshy,
    monsterType,
    playerVisualState,
    monsterVisualState,
    draculaAttackVariant,
    playerAttackVariant,
    playerFatalJumpKill,
    rollingApproachBlend = 1,
  } = args;

  const zero: Combat3dResolvedLeads = {
    meshyPlayerHurtLeadInSec: 0,
    meshyPlayerAttackLeadInSec: 0,
    meshyMonsterAttackLeadInSec: 0,
    meshyMonsterHurtLeadInSec: 0,
    meshyPlayerHuntToAttackCrossfadeSec: undefined,
    meshyMonsterHuntToAttackCrossfadeSec: undefined,
  };

  if (!isMergedMeshy) return zero;

  const mAtk = monsterVisualState === "attack";
  const pAtk = playerVisualState === "attack";
  const pHurt = playerVisualState === "hurt";
  const mHurt = monsterVisualState === "hurt";
  const mKd = monsterVisualState === "knockdown";
  const playerDefenderPose = defenderPoseFromVisual(playerVisualState);

  const spellJumpLeadMult =
    draculaAttackVariant === "spell" &&
    mAtk &&
    !pAtk &&
    playerDefenderPose === "hurt"
      ? monsterSpellJumpContactLeadMultiplier(rollingApproachBlend)
      : 1;

  const monsterDefenderPose = defenderPoseFromVisual(monsterVisualState);
  const playerSkillJumpLeadMult =
    playerAttackVariant === "skill" &&
    pAtk &&
    !mAtk &&
    monsterDefenderPose === "hurt"
      ? playerSkillJumpContactLeadMultiplier(rollingApproachBlend)
      : 1;

  let meshyMonsterAttackLeadInSec = 0;
  if (mAtk && !pAtk && isKnownCombatStrikeTier(draculaAttackVariant)) {
    meshyMonsterAttackLeadInSec =
      MONSTER_HITS_PLAYER[draculaAttackVariant][playerDefenderPose].attackerLeadInSec * spellJumpLeadMult;
  }

  let meshyPlayerHurtLeadInSec = 0;
  if (mAtk && pHurt && !playerFatalJumpKill && isKnownCombatStrikeTier(draculaAttackVariant)) {
    meshyPlayerHurtLeadInSec = adjustPlayerHurtLeadForMonsterAttackSync(
      draculaAttackVariant,
      monsterType ?? null,
      playerVisualState,
      meshyMonsterAttackLeadInSec,
    );
  }

  let meshyPlayerAttackLeadInSec = 0;
  if (pAtk && !mAtk && isKnownCombatStrikeTier(playerAttackVariant)) {
    meshyPlayerAttackLeadInSec =
      PLAYER_HITS_MONSTER[playerAttackVariant][monsterDefenderPose].attackerLeadInSec *
      playerSkillJumpLeadMult;
  }

  let meshyMonsterHurtLeadInSec = 0;
  if (pAtk && mHurt && isKnownCombatStrikeTier(playerAttackVariant)) {
    meshyMonsterHurtLeadInSec = adjustMonsterHurtLeadForPlayerAttackSync(
      playerAttackVariant,
      monsterVisualState,
      meshyPlayerAttackLeadInSec,
    );
  } else if (pAtk && !mAtk && mKd && isKnownCombatStrikeTier(playerAttackVariant)) {
    meshyMonsterHurtLeadInSec = PLAYER_HITS_MONSTER[playerAttackVariant].knockdown.defenderReactionLeadInSec;
  }

  const meshyPlayerHuntToAttackCrossfadeSec =
    pAtk && !mAtk && isKnownCombatStrikeTier(playerAttackVariant)
      ? PLAYER_HUNT_TO_ATTACK_CROSSFADE_SEC_BY_TIER[playerAttackVariant]
      : undefined;

  const meshyMonsterHuntToAttackCrossfadeSec =
    mAtk && !pAtk && isKnownCombatStrikeTier(draculaAttackVariant)
      ? MONSTER_HUNT_TO_ATTACK_CROSSFADE_SEC_BY_TIER[draculaAttackVariant]
      : undefined;

  return {
    meshyPlayerHurtLeadInSec,
    meshyPlayerAttackLeadInSec,
    meshyMonsterAttackLeadInSec,
    meshyMonsterHurtLeadInSec,
    meshyPlayerHuntToAttackCrossfadeSec,
    meshyMonsterHuntToAttackCrossfadeSec,
  };
}
