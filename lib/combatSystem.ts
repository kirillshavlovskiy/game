import {
  getMonsterDefense,
  getMonsterDamage,
  getMonsterDamageRange,
  type MonsterType,
} from "./labyrinth";

export interface CombatResult {
  won: boolean;
  damage: number;
  playerRoll: number;
  monsterDefense: number;
  attackTotal: number;
  /** Monster-specific: e.g. zombie slow, spider web */
  monsterEffect?: string;
  /** Reward granted on victory */
  reward?: MonsterReward;
  /** Idle/hunt + low roll (1-3) miss: second attempt, no damage */
  secondAttempt?: boolean;
}

export type MonsterReward =
  | { type: "jump"; amount: number }
  | { type: "movement"; amount: number }
  | { type: "hp"; amount: number }
  | { type: "shield"; amount: number }
  | { type: "attackBonus"; amount: number };

/** Combat hints for each monster type */
export function getMonsterHint(monsterType: MonsterType, skeletonHasShield?: boolean): string {
  switch (monsterType) {
    case "G":
      return "👻 Ghost: 50% chance your attack misses! Hits for 1-2 dmg if you lose.";
    case "K":
      return skeletonHasShield
        ? "💀 Skeleton: First hit breaks shield, second hit wins. Hits for 1-2 dmg."
        : "💀 Skeleton: Shield broken — one more hit! Hits for 1-2 dmg.";
    case "Z":
      return "🧟 Zombie: Hits hard (2-3 dmg) if you lose.";
    case "V":
      return "🧛 Dracula: High defense (5), hits for 1-2 dmg. Defeat for +1 attack.";
    case "S":
      return "🕷 Spider: Def 3, hits for 1-2 dmg. Win for +1 jump.";
    case "L":
      return "🔥 Lava Elemental: Def 4, hits for 2-3 dmg. Win for +1 shield.";
    default:
      return "Roll dice + attack bonus ≥ defense to win.";
  }
}

/** Get reward for defeating this monster type */
export function getMonsterReward(monsterType: MonsterType): MonsterReward {
  switch (monsterType) {
    case "S":
      return { type: "jump", amount: 1 }; // Spider: web agility
    case "G":
      return { type: "movement", amount: 1 }; // Ghost: phantasmal speed
    case "Z":
      return { type: "hp", amount: 1 }; // Zombie: survive the tough
    case "K":
      return { type: "shield", amount: 1 }; // Skeleton: bone armor
    case "V":
      return { type: "attackBonus", amount: 1 }; // Dracula: vampire strength
    case "L":
      return { type: "shield", amount: 1 }; // Lava Elemental: molten armor
    default:
      return { type: "jump", amount: 1 };
  }
}

/** Monster surprise reaction when player rolls: affects effective defense */
export type MonsterSurpriseState = "idle" | "hunt" | "attack" | "angry";

/** Defense modifier from surprise: idle=-1 (easier), hunt=0, attack/angry=+1 (harder) */
export function getSurpriseDefenseModifier(surprise: MonsterSurpriseState): number {
  return surprise === "idle" ? -1 : surprise === "attack" || surprise === "angry" ? 1 : 0;
}

/**
 * Resolve combat: player attack (d6 + attack bonus) vs monster defense.
 * One roll only. Monster special abilities applied here.
 *
 * @param playerRoll 1-6 from dice (always rolled before combat)
 * @param attackBonus 0-1 from player (Warrior class or artifact)
 * @param monsterType for defense/damage/ability lookup
 * @param skeletonHasShield if skeleton, whether it still has shield (first hit removes it)
 * @param surpriseModifier monster's surprise reaction: -1 (idle), 0 (hunt), +1 (attack)
 */
export function resolveCombat(
  playerRoll: number,
  attackBonus: number,
  monsterType: MonsterType,
  skeletonHasShield?: boolean,
  surpriseModifier?: number
): CombatResult {
  const monsterDefense = getMonsterDefense(monsterType) + (surpriseModifier ?? 0);
  const [minDmg, maxDmg] = getMonsterDamageRange(monsterType);
  const monsterDamage = minDmg + Math.floor(Math.random() * (maxDmg - minDmg + 1));

  // Ghost: 50% chance attack misses
  if (monsterType === "G" && Math.random() < 0.5) {
    return {
      won: false,
      damage: monsterDamage,
      playerRoll,
      monsterDefense,
      attackTotal: 0,
      monsterEffect: "ghost_evade",
    };
  }

  // Skeleton: first hit removes shield, second hit kills
  const effectiveDefense =
    monsterType === "K" && skeletonHasShield ? 0 : Math.max(0, monsterDefense);
  const attackTotal = playerRoll + attackBonus;
  const hit = attackTotal >= effectiveDefense;

  if (monsterType === "K" && skeletonHasShield && hit) {
    // First hit: shield broken, skeleton survives
    return {
      won: false,
      damage: 0,
      playerRoll,
      monsterDefense: effectiveDefense,
      attackTotal,
      monsterEffect: "skeleton_shield",
    };
  }

  const won = hit;
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
  };
}
