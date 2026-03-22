/**
 * Combat system for Labyrinth game.
 * Player strike: d6 + optional holy artifact bonus vs monster defense (callers pass attackBonus 0 in combat).
 */

import { type MonsterType, getMonsterMaxHp, type StoredArtifactKind } from "./labyrinth";

export type MonsterSurpriseState = "idle" | "hunt" | "attack" | "angry";

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
  return type === "V" ? 5 : type === "Z" || type === "K" ? 4 : type === "L" ? 6 : 3; // Lava: high base; surprise still shifts effective DEF
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
      return hasShield
        ? "💀 Skeleton: First hit breaks shield (no HP loss) — then clean hits only hurt the bones; you take 1 HP on a miss (+Attack/Angry) unless shield blocks. Glances can chip it too."
        : "💀 Skeleton: No shield — defense never below 2 (surprise still shifts it up). Clean hits hurt only the monster; on a miss you take 1 HP (+Attack/Angry) unless shield blocks.";
    case "Z": {
      const zm = getMonsterMaxHp("Z");
      const half = Math.max(1, Math.floor(zm / 2));
      return `🧟 Zombie: Dice 6 = instant win! Dice 5 = −4 HP. Dice 3–4 = half max HP (−${half}). Dice 1–2 = −1 HP. Miss: glancing by die; you take 2 HP (+Attack/Angry) unless shield blocks.`;
    }
    case "V":
      return "🧛 Dracula: High defense (5). Defeat: +1 on movement dice (map, max 6). Combat: d6 + holy sword/cross only. Miss: 1 HP (+Attack/Angry) unless shield blocks.";
    case "S":
      return "🕷 Spider: Def 3. Win for +1 jump. Miss: you take 1 HP (+Attack/Angry) unless shield blocks.";
    case "L":
      return "🔥 Lava Elemental: High defense (6). Dice 6 = instant win! Miss: glancing chip on it by die; you take 2 HP (+Attack/Angry) unless shield blocks.";
    default:
      return "Dice 6 = instant win! Miss: glancing chip on the monster (by die) AND you lose HP (1 for most beasts, 2 zombie/lava) unless shield blocks — Attack/Angry surprise adds +1 or +2 to that hit. Dice artifact: optional second strike after the first roll.";
  }
}

export function resolveCombat(
  playerRoll: number,
  attackBonus: number,
  monsterType: MonsterType,
  skeletonHasShield?: boolean,
  surpriseModifier = 0,
  rawD6?: number,
  surpriseState?: MonsterSurpriseState
): CombatResult {
  const monsterDefense = getMonsterDefense(monsterType);
  const monsterDamage = getMonsterDamage(monsterType);
  const physicalDie = rawD6 ?? playerRoll;

  // Dice 6 = ultimate win, no matter what (bypasses ghost evade, defense, etc.) — instant kill
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

  // Ghost: 50% chance attack misses
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

  // Skeleton: with shield, base defense 0 so any modest roll can break it; without shield, bones DEF 2 (not full 4) so hits are common.
  // Floor effective DEF at 2 when exposed: idle surprise (−1) would otherwise give 1 → every d6 ≥1 hits and the player never takes miss damage.
  const skeletonArmorDefense =
    monsterType === "K" ? (skeletonHasShield ? 0 : 2) : monsterDefense;
  const rawDefense = Math.max(0, skeletonArmorDefense + surpriseModifier);
  const effectiveDefense =
    monsterType === "K" && !skeletonHasShield ? Math.max(2, rawDefense) : rawDefense;
  const attackTotal = playerRoll + attackBonus;
  const hit = attackTotal >= effectiveDefense;

  if (monsterType === "K" && skeletonHasShield && hit) {
    return {
      won: false,
      damage: 0,
      playerRoll,
      monsterDefense: effectiveDefense,
      attackTotal,
      monsterEffect: "skeleton_shield",
      glancingDamage: 0,
    };
  }

  const won = hit;
  const dieForGlance = rawD6 !== undefined ? rawD6 : playerRoll;
  // On a miss: glancing damage = (die-1) to die HP. Dice 5 → 4–5, dice 4 → 3–4, etc.
  const glanceMin = Math.max(0, dieForGlance - 1);
  const glanceMax = dieForGlance;
  const glancingDamage = won ? 0 : (glanceMin >= 1 ? glanceMin + Math.floor(Math.random() * (glanceMax - glanceMin + 1)) : 0);

  // Zombie: 6 = instant win above; 5 = heavy; 3–4 = half max HP; 1–2 = 1 HP.
  let monsterHpLoss: number | undefined;
  if (won && monsterType === "Z" && physicalDie >= 1 && physicalDie <= 5) {
    const zMax = getMonsterMaxHp("Z");
    const halfLife = Math.max(1, Math.floor(zMax / 2));
    if (physicalDie === 5) monsterHpLoss = 4;
    else if (physicalDie >= 3 && physicalDie <= 4) monsterHpLoss = halfLife;
    else monsterHpLoss = 1;
  }

  // Attack/angry mode: monster counter-attacks, player takes extra damage on miss
  const isAggressive = surpriseState === "attack" || surpriseState === "angry";
  const counterBonus = !won && isAggressive ? (surpriseState === "angry" ? 2 : 1) : 0;
  const playerDamage = won ? 0 : monsterDamage + counterBonus;

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
