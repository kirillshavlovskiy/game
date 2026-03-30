/**
 * Combat system for Labyrinth game.
 * Player strike: d6 + optional holy artifact bonus vs monster defense (callers pass attackBonus 0 in combat).
 */

import { type MonsterType, getMonsterMaxHp, type StoredArtifactKind } from "./labyrinth";

export type MonsterSurpriseState = "idle" | "hunt" | "attack" | "angry";

export type StrikeTarget = "head" | "body" | "legs";

export interface CombatResult {
  won: boolean;
  damage: number;
  playerRoll: number;
  monsterDefense: number;
  attackTotal: number;
  monsterEffect?: string;
  reward?: MonsterReward;
  /** On a miss: scratch damage to monster scales with die (dice 5 → 4–5 HP, etc.) */
  glancingDamage?: number;
  /** True when dice 6 = instant kill (bypasses normal −1 HP per strike) */
  instantWin?: boolean;
  /** On a clean hit (won, not instant): HP removed from monster; default 1 when omitted */
  monsterHpLoss?: number;
}

export type MonsterReward =
  | { type: "jump"; amount: number }
  | { type: "movement"; amount: number }
  | { type: "hp"; amount: number }
  | { type: "shield"; amount: number }
  | { type: "attackBonus"; amount: number };

/** Bonus reward types (50% chance on monster defeat) */
export type MonsterBonusReward =
  | { type: "artifact"; amount: number }
  | { type: "bonusMoves"; amount: number }
  | { type: "shield"; amount: number }
  | { type: "jump"; amount: number }
  | { type: "catapult"; amount: number }
  | { type: "diceBonus"; amount: number }
  | { type: "storedArtifact"; kind: StoredArtifactKind; amount: number }
  | { type: "torch"; amount: number }
  | { type: "bomb"; amount: number };

const BONUS_REWARDS: MonsterBonusReward[] = [
  { type: "storedArtifact", kind: "dice", amount: 1 },
  { type: "storedArtifact", kind: "shield", amount: 1 },
  { type: "storedArtifact", kind: "teleport", amount: 1 },
  { type: "storedArtifact", kind: "reveal", amount: 1 },
  { type: "storedArtifact", kind: "healing", amount: 1 },
  { type: "storedArtifact", kind: "torch", amount: 1 },
  { type: "storedArtifact", kind: "holySword", amount: 1 },
  { type: "storedArtifact", kind: "holyCross", amount: 1 },
  { type: "bomb", amount: 1 },
  { type: "shield", amount: 1 },
  { type: "jump", amount: 1 },
  { type: "catapult", amount: 1 },
];

/**
 * One key per player-facing “kind” of bonus so the pick list never offers two rewards that mean the same thing
 * (e.g. +1 dice bonus charge vs +1 Dice artifact, or shield chip vs +1 shield charge).
 */
function bonusRewardChoiceDedupeKey(r: MonsterBonusReward): string {
  if (r.type === "diceBonus") return "dice_economy";
  if (r.type === "storedArtifact" && r.kind === "dice") return "dice_economy";
  if (r.type === "shield") return "shield_economy";
  if (r.type === "storedArtifact" && r.kind === "shield") return "shield_economy";
  if (r.type === "storedArtifact") return `storedArtifact:${r.kind}`;
  return r.type;
}

/** 50% chance to return a random bonus reward on monster defeat */
export function getMonsterBonusReward(): MonsterBonusReward | null {
  if (Math.random() >= 0.5) return null;
  return BONUS_REWARDS[Math.floor(Math.random() * BONUS_REWARDS.length)]!;
}

/** Shuffled bonus options for post-combat player choice (up to `count`, unique by semantic kind). */
export function getMonsterBonusRewardChoices(count = 3): MonsterBonusReward[] {
  const shuffled = [...BONUS_REWARDS].sort(() => Math.random() - 0.5);
  const seen = new Set<string>();
  const out: MonsterBonusReward[] = [];
  for (const r of shuffled) {
    const key = bonusRewardChoiceDedupeKey(r);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
    if (out.length >= count) break;
  }
  return out;
}

/** Surprise state affects monster defense: idle=easier, angry=harder */
export function getSurpriseDefenseModifier(state: MonsterSurpriseState): number {
  switch (state) {
    case "idle": return -1;
    case "hunt": return 0;
    case "attack": return 1;
    case "angry": return 2;
    default: return 0;
  }
}

export function getMonsterDefense(type: MonsterType): number {
  return type === "V" || type === "K" ? 5 : type === "Z" || type === "S" ? 4 : type === "L" ? 6 : 3;
}

function getMonsterDamage(type: MonsterType): number {
  return type === "Z" || type === "L" ? 2 : 1;
}

export function getMonsterReward(monsterType: MonsterType): MonsterReward {
  switch (monsterType) {
    case "S": return { type: "jump", amount: 1 };
    case "G": return { type: "movement", amount: 1 };
    case "Z": return { type: "hp", amount: 1 };
    case "K": return { type: "shield", amount: 1 };
    case "V": return { type: "attackBonus", amount: 1 };
    case "L": return { type: "movement", amount: 1 };
    default: return { type: "jump", amount: 1 };
  }
}

/** Combat hints for each monster type */
export function getMonsterHint(type: MonsterType, hasShield?: boolean): string {
  switch (type) {
    case "G":
      return "👻 Ghost: Dice 6 = instant win! 50% evade on other rolls — if it evades you lose 1 HP (shield can block).";
    case "K":
      return hasShield === false
        ? "💀 Skeleton: Shield broken — one more hit to defeat!"
        : "💀 Skeleton: High defense (5). Dice 6 = instant win! Miss: glancing chip by die; you take 1 HP (+Attack/Angry) unless shield blocks.";
    case "Z": {
      const zm = getMonsterMaxHp("Z");
      const half = Math.max(1, Math.floor(zm / 2));
      return `🧟 Zombie: Dice 6 = instant win! Dice 5 = −4 HP. Dice 3–4 = half max HP (−${half}). Dice 1–2 = −1 HP. Miss: glancing by die; you take 2 HP (+Attack/Angry) unless shield blocks.`;
    }
    case "V":
      return "🧛 Dracula: High defense (5). Defeat: +1 on movement dice (map, max 6). When you start this fight, your HP is set to full (map bites don’t carry in). Combat: d6 + holy sword/cross only. Miss: 1 HP (+Attack/Angry; head strike +extra) unless shield blocks.";
    case "S":
      return "🕷 Spider: Defense (4). Dice 6 = instant win! Die 1–3 = spider attacks you (heavy/medium/light). Die 4 = spider takes a hit. Miss: you take 1 HP unless shield blocks.";
    case "L":
      return "🔥 Lava Elemental: High defense (6). Dice 6 = instant win! Miss: glancing chip on it by die; you take 2 HP (+Attack/Angry) unless shield blocks.";
    default:
      return "Dice 6 = instant win! Same roll: monster damage and your damage net out (e.g. −2 vs −2 = no HP change). Miss: glancing + counter — net applies. 3D: aim on the monster while the dice roll (or whiff for heavy damage). Dice artifact: optional second strike after the first roll.";
  }
}

/**
 * Strike-target modifiers.
 *   Head: high risk / high reward — harder to land, more damage when it does.
 *   Body: balanced — current behavior (no modifier).
 *   Legs: safe — easier to hit, less damage.
 */
function getStrikeTargetModifiers(target: StrikeTarget | undefined) {
  switch (target) {
    case "head":
      return { atkBonus: 2, defBonus: 2, hpMultiplier: 2, extraMissDmg: 1 };
    case "legs":
      return { atkBonus: 1, defBonus: -1, hpMultiplier: 1, extraMissDmg: -0.5 };
    case "body":
    default:
      return { atkBonus: 0, defBonus: 0, hpMultiplier: 1, extraMissDmg: 0 };
  }
}

/**
 * Raw HP amounts that would be dealt before cross-netting (same roll).
 * Caller applies shield to zero `rawPlayer` before computing net.
 */
export function computeCombatHpExchangeRaw(result: CombatResult, monsterHpBefore: number): {
  rawMonsterHp: number;
  rawPlayerHp: number;
} {
  let rawMonsterHp = 0;
  let rawPlayerHp = result.won ? 0 : Math.max(0, result.damage ?? 0);
  if (!result.won && (result.glancingDamage ?? 0) > 0) {
    rawMonsterHp += result.glancingDamage ?? 0;
  }
  if (result.won) {
    if (result.instantWin) rawMonsterHp += Math.max(0, monsterHpBefore);
    else rawMonsterHp += Math.max(1, result.monsterHpLoss ?? 1);
  }
  return { rawMonsterHp, rawPlayerHp };
}

/** After optional shield on player damage: net HP lost each side (symmetric trade). */
export function computeNetHpLoss(rawMonsterHp: number, rawPlayerHp: number): {
  netMonsterHp: number;
  netPlayerHp: number;
} {
  const rm = Math.max(0, Math.round(rawMonsterHp));
  const rp = Math.max(0, Math.round(rawPlayerHp));
  return {
    netMonsterHp: Math.max(0, rm - rp),
    netPlayerHp: Math.max(0, rp - rm),
  };
}

export function resolveCombat(
  playerRoll: number,
  attackBonus: number,
  monsterType: MonsterType,
  _skeletonHasShield?: boolean,
  surpriseModifier = 0,
  rawD6?: number,
  surpriseState?: MonsterSurpriseState,
  strikeTarget?: StrikeTarget,
  /** Rolled but did not pick a strike zone in time (3D combat): forced miss, no glancing chip, harsh counter damage. */
  timingMiss?: boolean
): CombatResult {
  const monsterDefense = getMonsterDefense(monsterType);
  const monsterDamage = getMonsterDamage(monsterType);
  const physicalDie = rawD6 ?? playerRoll;

  if (physicalDie === 6) {
    return {
      won: true,
      damage: 0,
      playerRoll,
      monsterDefense,
      attackTotal: playerRoll + attackBonus,
      reward: getMonsterReward(monsterType),
      glancingDamage: 0,
      instantWin: true,
    };
  }

  if (monsterType === "G" && Math.random() < 0.5) {
    return {
      won: false,
      damage: monsterDamage,
      playerRoll,
      monsterDefense,
      attackTotal: 0,
      monsterEffect: "ghost_evade",
      glancingDamage: 0,
    };
  }

  if (timingMiss) {
    const effDef = monsterDefense + surpriseModifier;
    const isAggressive = surpriseState === "attack" || surpriseState === "angry";
    const counterBonus = isAggressive ? (surpriseState === "angry" ? 2 : 1) : 0;
    const whiffPenalty = 3;
    const maxMissDmg = monsterDamage + counterBonus + whiffPenalty;
    return {
      won: false,
      damage: maxMissDmg,
      playerRoll,
      monsterDefense: effDef,
      attackTotal: playerRoll + attackBonus,
      glancingDamage: 0,
      monsterEffect:
        monsterType === "Z"
          ? "zombie_slow"
          : monsterType === "V"
            ? "dracula_lifesteal"
            : monsterType === "L"
              ? "lava_burn"
              : undefined,
    };
  }

  const strikeMod = getStrikeTargetModifiers(strikeTarget);
  const effectiveDefense = Math.max(0, monsterDefense + surpriseModifier + strikeMod.defBonus);
  const attackTotal = playerRoll + attackBonus + strikeMod.atkBonus;
  const hit = attackTotal >= effectiveDefense;

  const won = hit;
  const dieForGlance = rawD6 !== undefined ? rawD6 : playerRoll;
  const glanceMin = Math.max(0, dieForGlance - 1);
  const glanceMax = dieForGlance;
  const glancingDamage = won ? 0 : (glanceMin >= 1 ? glanceMin + Math.floor(Math.random() * (glanceMax - glanceMin + 1)) : 0);

  let monsterHpLoss: number | undefined;
  if (won && monsterType === "Z" && physicalDie >= 1 && physicalDie <= 5) {
    const zMax = getMonsterMaxHp("Z");
    const halfLife = Math.max(1, Math.floor(zMax / 2));
    if (physicalDie === 5) monsterHpLoss = 4;
    else if (physicalDie >= 3 && physicalDie <= 4) monsterHpLoss = halfLife;
    else monsterHpLoss = 1;
  }
  if (won && monsterHpLoss == null && strikeMod.hpMultiplier > 1) {
    monsterHpLoss = strikeMod.hpMultiplier;
  }

  const isAggressive = surpriseState === "attack" || surpriseState === "angry";
  const counterBonus = !won && isAggressive ? (surpriseState === "angry" ? 2 : 1) : 0;
  const baseMissDmg = monsterDamage + counterBonus;
  const playerDamage = won ? 0 : Math.max(0, Math.round(baseMissDmg + strikeMod.extraMissDmg));

  return {
    won,
    damage: playerDamage,
    playerRoll,
    monsterDefense: effectiveDefense,
    attackTotal,
    monsterHpLoss,
    monsterEffect:
      !won && monsterType === "Z"
        ? "zombie_slow"
        : !won && monsterType === "V"
          ? "dracula_lifesteal"
          : !won && monsterType === "L"
            ? "lava_burn"
            : undefined,
    reward: won ? getMonsterReward(monsterType) : undefined,
    glancingDamage,
  };
}
