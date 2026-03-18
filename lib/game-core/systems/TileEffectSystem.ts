/**
 * Tile effect system: resolve effects when player enters a tile.
 * See docs/IMPLEMENTATION_PLAN.md §6.
 */

import type {
  EntityId,
  Position,
  TileState,
  TileType,
  TileEffectResult,
  PlayerStatus,
} from "../types";

export interface TileEffectContext {
  getTileAt(x: number, y: number): TileState | undefined;
  isWebTile(x: number, y: number): boolean;
  isHolyTile(x: number, y: number): boolean;
}

export function resolveEnterTile(
  playerId: EntityId,
  pos: Position,
  tile: TileState,
  ctx: TileEffectContext
): TileEffectResult {
  const log: string[] = [];

  switch (tile.type) {
    case "trap": {
      const hazard = tile.hazard;
      if (hazard?.damage) {
        log.push(`Trap! Took ${hazard.damage} damage.`);
        return {
          damage: hazard.damage,
          stopMovement: hazard.stopMovement ?? false,
          slow: hazard.slow ?? false,
          log,
        };
      }
      if (hazard?.stopMovement) {
        log.push("Trap! Movement stopped.");
        return { stopMovement: true, log };
      }
      if (hazard?.slow) {
        log.push("Trap! Slowed.");
        return { slow: true, log };
      }
      break;
    }

    case "web": {
      log.push("Entered web. +1 movement cost.");
      return {
        slow: true,
        log,
      };
    }

    case "artifact": {
      log.push("Collected artifact!");
      return {
        collectedArtifact: true,
        log,
      };
    }

    case "holy": {
      log.push("Entered holy ground. Safe from Dracula.");
      return { log };
    }

    case "exit": {
      log.push("Reached the exit!");
      return { log };
    }

    default:
      break;
  }

  return { log };
}
