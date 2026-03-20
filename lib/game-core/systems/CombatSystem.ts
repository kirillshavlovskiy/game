/**
 * Combat system: one-roll resolution for player vs monster and player vs Dracula.
 * See docs/IMPLEMENTATION_PLAN.md §4, §7.
 */

import type {
  EntityId,
  PlayerState,
  DraculaStateData,
  MonsterCombatState,
  CombatResult,
  PlayerStatus,
} from "../types";
import { DRACULA_CONFIG } from "../constants";

export type MonsterType = "spider" | "ghost" | "zombie" | "skeleton" | "dracula";

const MONSTER_STATS: Record<MonsterType, { defense: number; damage: number }> = {
  spider: { defense: 3, damage: 1 },
  ghost: { defense: 3, damage: 1 },
  zombie: { defense: 4, damage: 2 },
  skeleton: { defense: 4, damage: 1 },
  dracula: { defense: 5, damage: 1 },
};

export function resolvePlayerVsMonster(
  player: PlayerState,
  monster: MonsterCombatState & { type: MonsterType },
  playerRoll: number
): CombatResult {
  const stats = MONSTER_STATS[monster.type];
  const attackTotal = playerRoll + (player.attackBonus ?? 0);
  const log: string[] = [];

  // Ghost: 50% miss
  if (monster.type === "ghost" && Math.random() < 0.5) {
    log.push("Ghost evaded the attack!");
    return {
      success: false,
      damageToPlayer: stats.damage,
      damageToMonster: 0,
      monsterDefeated: false,
      playerDefeated: false,
      log,
    };
  }

  // Skeleton: first hit removes shield (handled by caller via skeletonHasShield)
  const effectiveDefense =
    monster.type === "skeleton" && (monster as { hasShield?: boolean }).hasShield
      ? 0
      : stats.defense;

  const success = attackTotal >= effectiveDefense;

  if (monster.type === "skeleton" && (monster as { hasShield?: boolean }).hasShield && success) {
    log.push("Skeleton shield broken!");
    return {
      success: false,
      damageToPlayer: 0,
      damageToMonster: 0,
      monsterDefeated: false,
      playerDefeated: false,
      log,
    };
  }

  const statusApplied: PlayerStatus | undefined =
    !success && monster.type === "zombie"
      ? { type: "slowed", turns: 1, mpPenalty: 1 }
      : !success && monster.type === "spider"
        ? { type: "webbed", turns: 1, extraMoveCost: 1 }
        : undefined;

  log.push(
    success
      ? `Hit! (${attackTotal} >= ${effectiveDefense})`
      : `Miss! (${attackTotal} < ${effectiveDefense})`
  );

  return {
    success,
    damageToPlayer: success ? 0 : stats.damage,
    damageToMonster: success ? 1 : 0,
    monsterDefeated: success,
    playerDefeated: !success && (player.hp - stats.damage <= 0),
    statusApplied,
    log,
  };
}

export function resolvePlayerVsDracula(
  player: PlayerState,
  dracula: DraculaStateData,
  playerRoll: number
): CombatResult {
  const attackTotal = playerRoll + (player.attackBonus ?? 0);
  const success = attackTotal >= dracula.defense;
  const log: string[] = [];

  log.push(
    success
      ? `Hit Dracula! (${attackTotal} >= ${dracula.defense})`
      : `Miss! Dracula strikes back (${attackTotal} < ${dracula.defense})`
  );

  const damageToMonster = success ? 1 : 0;
  const newDraculaHp = Math.max(0, dracula.hp - damageToMonster);
  const monsterDefeated = newDraculaHp <= 0;

  if (monsterDefeated) {
    log.push("Dracula banished!");
  } else if (success) {
    log.push("Dracula weakened!");
  }

  return {
    success,
    damageToPlayer: success ? 0 : dracula.damage,
    damageToMonster,
    monsterDefeated,
    playerDefeated: !success && player.hp - dracula.damage <= 0,
    statusApplied:
      !success && player.artifacts > 0
        ? undefined // Dracula lifesteal - handled by caller
        : undefined,
    log,
  };
}
