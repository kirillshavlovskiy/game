import { getMonsterDefense, type MonsterType } from "./labyrinth";

export interface CombatResult {
  won: boolean;
  damage: number;
  playerRoll: number;
  monsterDefense: number;
  attackTotal: number;
}

/**
 * Resolve combat: player attack (d6 + bonus) vs monster defense.
 * @param playerRoll 1-6 from dice
 * @param attackBonus e.g. Math.floor(remainingMP / 2)
 * @param monsterType for defense lookup
 */
export function resolveCombat(
  playerRoll: number,
  attackBonus: number,
  monsterType: MonsterType
): CombatResult {
  const monsterDefense = getMonsterDefense(monsterType);
  const attackTotal = playerRoll + attackBonus;
  const won = attackTotal >= monsterDefense;
  return {
    won,
    damage: won ? 0 : 1,
    playerRoll,
    monsterDefense,
    attackTotal,
  };
}
