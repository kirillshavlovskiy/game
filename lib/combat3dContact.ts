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
 * Legacy tight crossfade (no longer used for merged player hunt→hurt — handoff now matches
 * `MONSTER_HUNT_TO_ATTACK_CROSSFADE_SEC_BY_TIER` so the player keeps moving during monster wind-up).
 */
export const MONSTER_SPELL_PLAYER_HUNT_TO_HURT_CROSSFADE_SEC = 0.08;
/** @deprecated Prefer matching monster hunt→attack duration; kept for reference / tooling. */
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
      /** Nearer spell (0.28) — pairs with short hunt→hurt handoff so the flinch reads on the strike beat. */
      defenderReactionLeadInSec: 0.28,
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
  /**
   * Shorter than spell: full-weight `Jumping_Punch` reaches the tuned contact seek sooner after hunt (`PLAYER_HITS_MONSTER.skill` + mixer compensation).
   */
  skill: 0.16,
  light: 0.34,
};

/** Monster merged rig: hunt/roll → `attack` — per strike tier (defaults were a flat 0.38 in the mixer). */
export const MONSTER_HUNT_TO_ATTACK_CROSSFADE_SEC_BY_TIER: Record<Combat3dStrikeTier, number> = {
  spell: 0.34,
  skill: 0.32,
  light: 0.38,
};

/**
 * Merged player `Double_Combo_Attack`: impact is late in the clip — add on top of table `attackerLeadInSec` when that
 * clip is selected; `MonsterModel3D` folds this into full seek **before** hunt→attack crossfade backoff.
 */
export const PLAYER_DOUBLE_COMBO_ATTACK_EXTRA_CLIP_LEAD_IN_SEC = 0.16;

/** Player swings at monster: tier × (monster hurt | monster knockdown). */
export const PLAYER_HITS_MONSTER: Record<Combat3dStrikeTier, Record<Combat3dDefenderPose, Combat3dContactRow>> = {
  spell: {
    hurt: {
      /**
       * Spell tier leads with **spin / combo** clips (`Double_Blade_Spin`, `Triple_Combo_Attack`, …) that barely translate.
       * `0.68` was tuned for `Jumping_Punch` lunges and left combos visibly short of the monster in the combat modal.
       */
      separationHalf: 0.54,
      /**
       * Slightly shallower than legacy `0.34` now that X is tighter — keeps first combo beats on-screen before contact.
       */
      attackerLeadInSec: 0.28,
      defenderReactionLeadInSec: 0.18,
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
       * Tier leads with **`Jumping_Punch`** — keep base seek **low** so skill strikes read soon after hunt crossfade.
       * **`Double_Combo_Attack`**: {@link PLAYER_DOUBLE_COMBO_ATTACK_EXTRA_CLIP_LEAD_IN_SEC} is folded into the seek in
       * `PositionedGltfSubject` (with hunt→attack fade backoff) so contact reads without a double-beat from wrong timing.
       */
      separationHalf: 0.54,
      attackerLeadInSec: 0.12,
      defenderReactionLeadInSec: 0.1,
    },
    knockdown: {
      /**
       * Player skill vs **monster** knockdown (merged spell/skill wins) — must **not** reuse `MONSTER_HITS_PLAYER` rows
       * (those tune monster→player). Match `skill.hurt` jump seek so `Jumping_Punch` wind-up matches standing hit; X
       * slightly tighter than `hurt` so the strike reads on a grounded rig; shallow fall skip like `spell.knockdown`.
       */
      separationHalf: 0.5,
      attackerLeadInSec: 0.18,
      defenderReactionLeadInSec: 0.08,
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
  O: 0,
};

/** Inner half caps when **both** are in `attack` (simultaneous exchange — use both spell/skill/light vs hurt columns). */
export const MUTUAL_ATTACK_INNER_HALF: Record<Combat3dStrikeTier, number> = {
  spell: 0.06,
  skill: 0.28,
  light: 0.38,
};

/** Wide half when approach blend = 0 — merged rigs read as across the room. */
export const COMBAT_IDLE_SEPARATION_HALF = 1.38;
/**
 * Staging half when approach blend = 1 (between rolls, after roll) — mirrors `Monster3dContactPairLab` “full approach”
 * row; tighter than legacy 0.92 so hunt/idle reads nearer the contact lab without using hit-exchange rows.
 */
export const COMBAT_STRIKE_PICK_SEPARATION_HALF = 0.72;
const MUTUAL_ATTACK_HALF_FLOOR = 0.38;

/** Hunt-phase walk-in duration for merged 3D — same timing/smoothstep as `Monster3dContactPairLab` connected sequence. */
export const COMBAT_FACEOFF_APPROACH_DURATION_MS = 2200;

/**
 * Idle → face lerp to `walkInEndHalf` (world X half **before** skeleton extra — same as contact table rows).
 */
export function lerpWalkInSeparationHalf(rollingApproachBlend: number, walkInEndHalf: number): number {
  const t = Math.max(0, Math.min(1, rollingApproachBlend));
  return COMBAT_IDLE_SEPARATION_HALF * (1 - t) + walkInEndHalf * t;
}

/** Half-distance during idle→strike walk-in using legacy 0.72 end (face-off prefers {@link combatWalkInEndSeparationHalf}). */
export function approachPhaseSeparationHalf(rollingApproachBlend: number): number {
  return lerpWalkInSeparationHalf(rollingApproachBlend, COMBAT_STRIKE_PICK_SEPARATION_HALF);
}

/**
 * Wide approach (large half-distance) → start the attacker clip nearer t=0 (lower skip into jump strike).
 * Tight face-off half → full table `attackerLeadInSec` / defender reaction skip.
 */
export function contactJumpStrikeLeadMultiplier(
  rollingApproachBlend: number,
  tightFaceOffSeparationHalf: number,
  walkInEndHalf: number = COMBAT_STRIKE_PICK_SEPARATION_HALF,
): number {
  const sep = lerpWalkInSeparationHalf(rollingApproachBlend, walkInEndHalf);
  const wide = COMBAT_IDLE_SEPARATION_HALF;
  if (sep <= tightFaceOffSeparationHalf + 1e-4) return 1;
  if (sep >= wide - 1e-4) return 0;
  return 1 - (sep - tightFaceOffSeparationHalf) / (wide - tightFaceOffSeparationHalf);
}

/** Monster spell (Jumping_Punch) vs standing player — scales monster attack skip + player hurt sync from approach blend. */
export function monsterSpellJumpContactLeadMultiplier(
  rollingApproachBlend: number,
  walkInEndHalf: number = COMBAT_STRIKE_PICK_SEPARATION_HALF,
): number {
  return contactJumpStrikeLeadMultiplier(
    rollingApproachBlend,
    MONSTER_HITS_PLAYER.spell.hurt.separationHalf,
    walkInEndHalf,
  );
}

/**
 * Player skill jump vs standing monster — use the **same** tight half as monster spell `Jumping_Punch` (0.4) so
 * approach blend scales lead-in like monster spell; player face-off X uses `PLAYER_HITS_MONSTER.skill.hurt.separationHalf` (wider in-table).
 */
export function playerSkillJumpContactLeadMultiplier(
  rollingApproachBlend: number,
  walkInEndHalf: number = COMBAT_STRIKE_PICK_SEPARATION_HALF,
): number {
  return contactJumpStrikeLeadMultiplier(
    rollingApproachBlend,
    MONSTER_HITS_PLAYER.spell.hurt.separationHalf,
    walkInEndHalf,
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
 * Map GLB portrait → defender column. **`defeated`** uses the same table as **knockdown** (fall/death clips), not
 * **hurt** (standing flinch) — otherwise lethal strikes keep wide `*.hurt` face-off halves and zero monster lead-in.
 */
export function defenderPoseFromVisual(state: Monster3DSpriteState): Combat3dDefenderPose {
  return state === "knockdown" || state === "defeated" ? "knockdown" : "hurt";
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
 * Walk-in lerp target at approach blend = 1: align with standing-contact table halves so flipping to `attack`/`hurt`
 * does not pop the rigs (legacy 0.72 vs ~0.4–0.56 read as a second lunge with root motion). Capped at
 * {@link COMBAT_STRIKE_PICK_SEPARATION_HALF}.
 */
export function combatWalkInEndSeparationHalf(args: {
  playerAttackVariant?: Combat3dStrikeTier;
  draculaAttackVariant?: Combat3dStrikeTier;
  playerVisualState: Monster3DSpriteState;
  monsterVisualState: Monster3DSpriteState;
}): number {
  const pt = coerceStrikeTier(args.playerAttackVariant);
  const mt = coerceStrikeTier(args.draculaAttackVariant);
  const p = rowPlayerHitsMonster(pt, args.monsterVisualState).separationHalf;
  const m = rowMonsterHitsPlayer(mt, args.playerVisualState).separationHalf;
  return Math.min(COMBAT_STRIKE_PICK_SEPARATION_HALF, Math.max(p, m));
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
    monsterVisualState === "knockdown" ||
    playerVisualState === "defeated" ||
    monsterVisualState === "defeated";

  const useStrikeContactSpacing =
    isContactExchange ||
    playerVisualState === "attack" ||
    monsterVisualState === "attack" ||
    inPostHitPose;

  if (!useStrikeContactSpacing) {
    const idle = COMBAT_IDLE_SEPARATION_HALF;
    const t = Math.max(0, Math.min(1, rollingApproachBlend));
    const walkEnd = combatWalkInEndSeparationHalf({
      playerAttackVariant,
      draculaAttackVariant,
      playerVisualState,
      monsterVisualState,
    });
    return idle * (1 - t) + walkEnd * t + sk;
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
  /**
   * Monster `attack` → player `hurt`/`knockdown`: hunt→hurt crossfade = same duration as monster hunt→`attack`
   * (`MONSTER_HUNT_TO_ATTACK_CROSSFADE_SEC_BY_TIER`) so the defender **keeps locomotion** while the strike winds up.
   */
  meshyPlayerHurtHandoffCrossfadeSec: number | undefined;
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
    meshyPlayerHurtHandoffCrossfadeSec: undefined,
    meshyPlayerHuntToAttackCrossfadeSec: undefined,
    meshyMonsterHuntToAttackCrossfadeSec: undefined,
  };

  if (!isMergedMeshy) return zero;

  const walkInEndHalf = combatWalkInEndSeparationHalf({
    playerAttackVariant,
    draculaAttackVariant,
    playerVisualState,
    monsterVisualState,
  });

  const mAtk = monsterVisualState === "attack";
  const pAtk = playerVisualState === "attack";
  const pHurt = playerVisualState === "hurt";
  const playerDefenderPose = defenderPoseFromVisual(playerVisualState);

  const spellJumpLeadMult =
    draculaAttackVariant === "spell" &&
    mAtk &&
    !pAtk &&
    playerDefenderPose === "hurt"
      ? monsterSpellJumpContactLeadMultiplier(rollingApproachBlend, walkInEndHalf)
      : 1;

  const monsterDefenderPose = defenderPoseFromVisual(monsterVisualState);
  const playerSkillJumpLeadMult =
    playerAttackVariant === "skill" &&
    pAtk &&
    !mAtk &&
    monsterDefenderPose === "hurt"
      ? playerSkillJumpContactLeadMultiplier(rollingApproachBlend, walkInEndHalf)
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
  if (pAtk && !mAtk && isKnownCombatStrikeTier(playerAttackVariant)) {
    meshyMonsterHurtLeadInSec = adjustMonsterHurtLeadForPlayerAttackSync(
      playerAttackVariant,
      monsterVisualState,
      meshyPlayerAttackLeadInSec,
    );
  }

  const meshyPlayerHuntToAttackCrossfadeSec =
    pAtk && !mAtk && isKnownCombatStrikeTier(playerAttackVariant)
      ? PLAYER_HUNT_TO_ATTACK_CROSSFADE_SEC_BY_TIER[playerAttackVariant]
      : undefined;

  const meshyMonsterHuntToAttackCrossfadeSec =
    mAtk && !pAtk && isKnownCombatStrikeTier(draculaAttackVariant)
      ? MONSTER_HUNT_TO_ATTACK_CROSSFADE_SEC_BY_TIER[draculaAttackVariant]
      : undefined;

  const meshyPlayerHurtHandoffCrossfadeSec =
    mAtk &&
    !pAtk &&
    (playerVisualState === "hurt" || playerVisualState === "knockdown") &&
    !playerFatalJumpKill &&
    isKnownCombatStrikeTier(draculaAttackVariant)
      ? MONSTER_HUNT_TO_ATTACK_CROSSFADE_SEC_BY_TIER[draculaAttackVariant]
      : undefined;

  return {
    meshyPlayerHurtLeadInSec,
    meshyPlayerAttackLeadInSec,
    meshyMonsterAttackLeadInSec,
    meshyMonsterHurtLeadInSec,
    meshyPlayerHurtHandoffCrossfadeSec,
    meshyPlayerHuntToAttackCrossfadeSec,
    meshyMonsterHuntToAttackCrossfadeSec,
  };
}
