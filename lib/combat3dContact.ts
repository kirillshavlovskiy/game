/**
 * Unified 3D face-off contact: each side is **strike tier × defender pose** only — six combos per direction.
 * `hurt` = standing flinch / post-hit; `knockdown` = downed defender. Pre-contact (hunt/idle vs incoming swing)
 * uses the **hurt** column — same spacing as “about to absorb a standing hit”.
 */
import type { MonsterType } from "@/lib/labyrinth";
import type { Monster3DSpriteState } from "@/lib/monsterModels3d";

export type Combat3dStrikeTier = "spell" | "skill" | "light";
export type Combat3dDefenderPose = "hurt" | "knockdown";

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
      defenderReactionLeadInSec: 0.52,
    },
    knockdown: {
      separationHalf: 0.42,
      attackerLeadInSec: 0.38,
      defenderReactionLeadInSec: 0.35,
    },
  },
  skill: {
    hurt: {
      separationHalf: 0.68,
      /** Small skip so non-jump strikes near contact; was 0 + 1.16 defender (player deep in hurt while monster at t≈0). */
      attackerLeadInSec: 0.22,
      defenderReactionLeadInSec: 0.42,
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
      defenderReactionLeadInSec: 0.18,
    },
    knockdown: {
      separationHalf: 0.42,
      attackerLeadInSec: 0,
      defenderReactionLeadInSec: 0.15,
    },
  },
};

/** Player swings at monster: tier × (monster hurt | monster knockdown). */
export const PLAYER_HITS_MONSTER: Record<Combat3dStrikeTier, Record<Combat3dDefenderPose, Combat3dContactRow>> = {
  spell: {
    hurt: {
      separationHalf: 0.68,
      /** Deeper skip so impact lines up with tight face-off X + monster hurt reaction (merged rigs). */
      attackerLeadInSec: 0.52,
      defenderReactionLeadInSec: 0.2,
    },
    knockdown: {
      separationHalf: 0.42,
      attackerLeadInSec: 0.36,
      defenderReactionLeadInSec: 0.08,
    },
  },
  skill: {
    hurt: {
      /**
       * Mirror **monster spell → player hurt** (Jumping_Punch vs flinch): tight X + deep skips on **both** clips so
       * jump apex / landing lines up with monster standing hurt (same “one beat” feel as M.spell / P.hurt).
       */
      separationHalf: 0.42,
      attackerLeadInSec: 0.6,
      defenderReactionLeadInSec: 0.48,
    },
    knockdown: {
      separationHalf: 0.42,
      attackerLeadInSec: 0.24,
      defenderReactionLeadInSec: 0.06,
    },
  },
  light: {
    hurt: {
      separationHalf: 0.7,
      attackerLeadInSec: 0.22,
      defenderReactionLeadInSec: 0.08,
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
  K: -0.04,
  Z: -0.06,
  S: -0.08,
  L: -0.02,
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
 * Spell / Jumping_Punch: wide approach (large half-distance) → start the clip nearer t=0 (lower skip).
 * Tight strike spacing (near `spell.hurt.separationHalf`) → full table `attackerLeadInSec` / defender hurt skip.
 */
export function monsterSpellJumpContactLeadMultiplier(rollingApproachBlend: number): number {
  const sep = approachPhaseSeparationHalf(rollingApproachBlend);
  const tight = MONSTER_HITS_PLAYER.spell.hurt.separationHalf;
  const wide = COMBAT_IDLE_SEPARATION_HALF;
  if (sep <= tight + 1e-4) return 1;
  if (sep >= wide - 1e-4) return 0;
  return 1 - (sep - tight) / (wide - tight);
}

export function coerceStrikeTier(v: Combat3dStrikeTier | undefined): Combat3dStrikeTier {
  return v === "spell" || v === "skill" || v === "light" ? v : "skill";
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
  const pose = defenderPoseFromVisual(playerVisualState);
  const row = MONSTER_HITS_PLAYER[coerceStrikeTier(monsterTier)][pose];
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
  } = args;

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
    return idle * (1 - t) + COMBAT_STRIKE_PICK_SEPARATION_HALF * t;
  }

  const pAtk = playerVisualState === "attack";
  const mAtk = monsterVisualState === "attack";
  const pKd = playerVisualState === "knockdown";
  const mKd = monsterVisualState === "knockdown";

  const attackVsKnockdown = (pKd && mAtk && !pAtk) || (mKd && pAtk && !mAtk);
  const mirroredHeavyKnockdown = monsterVisualState === "knockdown" && playerVisualState === "angry";

  if (attackVsKnockdown || mirroredHeavyKnockdown) {
    if (mAtk && !pAtk) {
      return rowMonsterHitsPlayer(draculaAttackVariant, playerVisualState).separationHalf;
    }
    if (pAtk && !mAtk) {
      return rowPlayerHitsMonster(playerAttackVariant, monsterVisualState).separationHalf;
    }
    if (mirroredHeavyKnockdown) {
      return rowPlayerHitsMonster(playerAttackVariant, "knockdown").separationHalf;
    }
    return COMBAT_STRIKE_PICK_SEPARATION_HALF;
  }

  if (pAtk && mAtk) {
    const pt = coerceStrikeTier(playerAttackVariant);
    const mt = coerceStrikeTier(draculaAttackVariant);
    const inner = Math.max(
      MUTUAL_ATTACK_INNER_HALF[pt],
      MUTUAL_ATTACK_INNER_HALF[mt],
      MUTUAL_ATTACK_HALF_FLOOR,
    );
    return inner;
  }

  if (mAtk && !pAtk) {
    return rowMonsterHitsPlayer(draculaAttackVariant, playerVisualState).separationHalf;
  }
  if (pAtk && !mAtk) {
    return rowPlayerHitsMonster(playerAttackVariant, monsterVisualState).separationHalf;
  }

  return COMBAT_STRIKE_PICK_SEPARATION_HALF;
}

export interface Combat3dResolvedLeads {
  meshyPlayerHurtLeadInSec: number;
  meshyPlayerAttackLeadInSec: number;
  meshyMonsterAttackLeadInSec: number;
  meshyMonsterHurtLeadInSec: number;
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
  };

  if (!isMergedMeshy) return zero;

  const mAtk = monsterVisualState === "attack";
  const pAtk = playerVisualState === "attack";
  const pHurt = playerVisualState === "hurt";
  const mHurt = monsterVisualState === "hurt";

  const spellJumpLeadMult =
    coerceStrikeTier(draculaAttackVariant) === "spell" &&
    mAtk &&
    !pAtk &&
    defenderPoseFromVisual(playerVisualState) === "hurt"
      ? monsterSpellJumpContactLeadMultiplier(rollingApproachBlend)
      : 1;

  let meshyPlayerHurtLeadInSec = 0;
  if (mAtk && pHurt && !playerFatalJumpKill) {
    /** Do not scale hurt skip with spell mult — monster attack skip is scaled separately; sync couples them in `CombatScene3D`. */
    meshyPlayerHurtLeadInSec = playerHurtClipLeadAfterMonsterHit(draculaAttackVariant, monsterType ?? null);
  }

  let meshyPlayerAttackLeadInSec = 0;
  if (pAtk && !mAtk) {
    meshyPlayerAttackLeadInSec = rowPlayerHitsMonster(playerAttackVariant, monsterVisualState).attackerLeadInSec;
  }

  let meshyMonsterAttackLeadInSec = 0;
  if (mAtk && !pAtk) {
    meshyMonsterAttackLeadInSec =
      rowMonsterHitsPlayer(draculaAttackVariant, playerVisualState).attackerLeadInSec * spellJumpLeadMult;
  }

  let meshyMonsterHurtLeadInSec = 0;
  if (pAtk && mHurt) {
    meshyMonsterHurtLeadInSec = rowPlayerHitsMonster(playerAttackVariant, monsterVisualState).defenderReactionLeadInSec;
  }

  return {
    meshyPlayerHurtLeadInSec,
    meshyPlayerAttackLeadInSec,
    meshyMonsterAttackLeadInSec,
    meshyMonsterHurtLeadInSec,
  };
}
