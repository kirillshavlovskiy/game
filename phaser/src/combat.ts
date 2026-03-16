/**
 * Combat system - ported from lib/combatSystem.ts
 * Player attack (d6 + attack bonus) vs monster defense.
 */

export type MonsterType = 'V' | 'Z' | 'S' | 'G' | 'K'; // Vampire, Zombie, Spider, Ghost, Skeleton

export interface CombatResult {
  won: boolean;
  damage: number;
  playerRoll: number;
  monsterDefense: number;
  attackTotal: number;
  monsterEffect?: string;
  reward?: MonsterReward;
}

export type MonsterReward =
  | { type: 'jump'; amount: number }
  | { type: 'movement'; amount: number }
  | { type: 'hp'; amount: number }
  | { type: 'shield'; amount: number }
  | { type: 'attackBonus'; amount: number };

export function getMonsterDefense(type: MonsterType): number {
  return type === 'V' ? 5 : type === 'Z' || type === 'K' ? 4 : 3;
}

function getMonsterDamage(type: MonsterType): number {
  return type === 'Z' ? 2 : 1;
}

export function getMonsterReward(monsterType: MonsterType): MonsterReward {
  switch (monsterType) {
    case 'S': return { type: 'jump', amount: 1 };
    case 'G': return { type: 'movement', amount: 1 };
    case 'Z': return { type: 'hp', amount: 1 };
    case 'K': return { type: 'shield', amount: 1 };
    case 'V': return { type: 'attackBonus', amount: 1 };
    default: return { type: 'jump', amount: 1 };
  }
}

export function getMonsterName(type: MonsterType): string {
  return type === 'V' ? 'Dracula' : type === 'Z' ? 'Zombie' : type === 'S' ? 'Spider' : type === 'G' ? 'Ghost' : 'Skeleton';
}

export function resolveCombat(
  playerRoll: number,
  attackBonus: number,
  monsterType: MonsterType,
  skeletonHasShield?: boolean
): CombatResult {
  const monsterDefense = getMonsterDefense(monsterType);
  const monsterDamage = getMonsterDamage(monsterType);

  // Ghost: 50% chance attack misses
  if (monsterType === 'G' && Math.random() < 0.5) {
    return {
      won: false,
      damage: monsterDamage,
      playerRoll,
      monsterDefense,
      attackTotal: 0,
      monsterEffect: 'ghost_evade',
    };
  }

  const effectiveDefense =
    monsterType === 'K' && skeletonHasShield ? 0 : monsterDefense;
  const attackTotal = playerRoll + attackBonus;
  const hit = attackTotal >= effectiveDefense;

  if (monsterType === 'K' && skeletonHasShield && hit) {
    return {
      won: false,
      damage: 0,
      playerRoll,
      monsterDefense: effectiveDefense,
      attackTotal,
      monsterEffect: 'skeleton_shield',
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
      !won && monsterType === 'Z'
        ? 'zombie_slow'
        : !won && monsterType === 'V'
          ? 'dracula_lifesteal'
          : undefined,
    reward: won ? getMonsterReward(monsterType) : undefined,
  };
}

export function rollD6(): number {
  return Math.floor(Math.random() * 6) + 1;
}
