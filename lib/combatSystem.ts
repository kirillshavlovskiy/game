/**
 * Combat system for Labyrinth game.
 * Player attack (d6 + attack bonus) vs monster defense.
 */

import type { MonsterType } from "./labyrinth";

export type MonsterSurpriseState = "idle" | "hunt" | "attack" | "angry";

export interface CombatResult {
  won: boolean;
  damage: number;
  playerRoll: number;
  monsterDefense: number;
  attackTotal: number;
  monsterEffect?: string;
  reward?: MonsterReward;
  /**
   * Raw d6 in 2–4 on a miss: still scratch the monster for 1 HP (not on ghost evade or shield break).
   * Pass `rawD6` into resolveCombat so this uses the physical die, not effective roll with dice bonus.
   */
  glancingDamage?: number;
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
  | { type: "diceBonus"; amount: number };

const BONUS_REWARDS: MonsterBonusReward[] = [
  { type: "artifact", amount: 1 },
  { type: "bonusMoves", amount: 1 },
  { type: "shield", amount: 1 },
  { type: "jump", amount: 1 },
  { type: "catapult", amount: 1 },
  { type: "diceBonus", amount: 1 },
];

/** 50% chance to return a random bonus reward on monster defeat */
export function getMonsterBonusReward(): MonsterBonusReward | null {
  if (Math.random() >= 0.5) return null;
  return BONUS_REWARDS[Math.floor(Math.random() * BONUS_REWARDS.length)]!;
}

/** Shuffled bonus options for post-combat player choice (up to `count`, unique types). */
export function getMonsterBonusRewardChoices(count = 3): MonsterBonusReward[] {
  const shuffled = [...BONUS_REWARDS].sort(() => Math.random() - 0.5);
  const seen = new Set<string>();
  const out: MonsterBonusReward[] = [];
  for (const r of shuffled) {
    const key = r.type;
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
    case "G": return "👻 Ghost: 50% chance your attack misses! Holy cross adds +3 to your attack when it lands.";
    case "K": return hasShield ? "💀 Skeleton: First hit breaks shield, second hit wins. Holy sword +2 attack." : "💀 Skeleton: Shield broken — one more hit! Holy sword +2 attack.";
    case "Z": return "🧟 Zombie: Hits hard (2 dmg) if you lose. Holy sword +2 attack.";
    case "V": return "🧛 Dracula: High defense (5). Defeat for +1 attack. Holy cross adds +3 to your roll vs him.";
    case "S": return "🕷 Spider: Def 3. Win for +1 jump. Holy sword +2 attack.";
    case "L": return "🔥 Lava Elemental: High defense (stance changes it). Only clean hits −1 HP — no scratch damage on a miss. Holy sword adds +2 to your attack.";
    default: return "Each hit that meets defense −1 HP. Dice 2–4 on a miss still scratch 1 HP.";
  }
}

export function resolveCombat(
  playerRoll: number,
  attackBonus: number,
  monsterType: MonsterType,
  skeletonHasShield?: boolean,
  surpriseModifier = 0,
  rawD6?: number
): CombatResult {
  const monsterDefense = getMonsterDefense(monsterType);
  const monsterDamage = getMonsterDamage(monsterType);

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

  const effectiveDefense = Math.max(0,
    (monsterType === "K" && skeletonHasShield ? 0 : monsterDefense) + surpriseModifier
  );
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
  // Lava: no glancing chip — only clean hits (attack ≥ defense) deal damage.
  const glancingDamage =
    won || dieForGlance < 2 || dieForGlance > 4 || monsterType === "L" ? 0 : 1;

  return {
    won,
    damage: won ? 0 : monsterDamage,
    playerRoll,
    monsterDefense: effectiveDefense,
    attackTotal,
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
