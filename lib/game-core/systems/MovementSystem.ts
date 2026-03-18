/**
 * Movement system: walkability, MP spending, tile-by-tile movement.
 * See docs/IMPLEMENTATION_PLAN.md §3.
 */

import type {
  EntityId,
  Position,
  TileState,
  PlayerState,
  MoveResult,
  TileEffectResult,
} from "../types";
import { manhattan } from "../utils/grid";

export interface MovementContext {
  map: TileState[][];
  width: number;
  height: number;
  players: PlayerState[];
  monsterPositions: Set<string>;
  holyTiles: Set<string>;
  webTiles: Set<string>;
}

export function canMoveTo(
  ctx: MovementContext,
  pos: Position,
  playerId: EntityId,
  mpRemaining: number
): boolean {
  const { map, width, height, players, monsterPositions, holyTiles, webTiles } = ctx;
  if (pos.x < 0 || pos.x >= width || pos.y < 0 || pos.y >= height) return false;

  const tile = map[pos.y]?.[pos.x];
  if (!tile || tile.blocksMovement) return false;

  const cost = getMovementCost(tile, pos, webTiles);
  if (cost > mpRemaining) return false;

  const key = `${pos.x},${pos.y}`;
  if (monsterPositions.has(key)) return true; // Entering monster triggers combat
  const otherPlayer = players.find((p) => p.id !== playerId && p.x === pos.x && p.y === pos.y);
  if (otherPlayer) return false;

  return true;
}

export function getMovementCost(
  tile: TileState,
  pos: Position,
  webTiles: Set<string>
): number {
  const key = `${pos.x},${pos.y}`;
  if (webTiles.has(key)) return 2;
  return tile.movementCost;
}

export function movePlayer(
  ctx: MovementContext,
  playerId: EntityId,
  from: Position,
  to: Position,
  mpRemaining: number,
  onTileEffect: (playerId: EntityId, pos: Position) => TileEffectResult
): MoveResult {
  const log: string[] = [];
  if (!canMoveTo(ctx, to, playerId, mpRemaining)) {
    return {
      allowed: false,
      spentMP: 0,
      triggeredCombat: false,
      triggeredTileEffect: false,
      endTurn: false,
      log: ["Move not allowed"],
    };
  }

  const tile = ctx.map[to.y]?.[to.x];
  const cost = tile ? getMovementCost(tile, to, ctx.webTiles) : 1;
  const key = `${to.x},${to.y}`;
  const triggeredCombat = ctx.monsterPositions.has(key);
  const tileEffect = onTileEffect(playerId, to);
  const triggeredTileEffect = tileEffect.log.length > 0;

  let endTurn = false;
  if (tileEffect.stopMovement) endTurn = true;
  if (triggeredCombat) endTurn = true;

  log.push(`Moved to (${to.x},${to.y}), spent ${cost} MP`);
  log.push(...tileEffect.log);

  return {
    allowed: true,
    spentMP: cost,
    triggeredCombat,
    triggeredTileEffect,
    endTurn,
    log,
  };
}

export function getReachableTiles(
  ctx: MovementContext,
  playerId: EntityId,
  start: Position,
  mp: number
): Position[] {
  const reachable: Position[] = [];
  const visited = new Set<string>();
  const queue: { pos: Position; mpLeft: number }[] = [{ pos: start, mpLeft: mp }];
  visited.add(`${start.x},${start.y}`);

  while (queue.length > 0) {
    const { pos, mpLeft } = queue.shift()!;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nx = pos.x + dx;
      const ny = pos.y + dy;
      const npos = { x: nx, y: ny };
      const key = `${nx},${ny}`;
      if (visited.has(key)) continue;
      if (!canMoveTo(ctx, npos, playerId, mpLeft)) continue;

      visited.add(key);
      const cost = getMovementCost(ctx.map[ny]?.[nx]!, npos, ctx.webTiles);
      reachable.push(npos);
      if (mpLeft - cost > 0) {
        queue.push({ pos: npos, mpLeft: mpLeft - cost });
      }
    }
  }
  return reachable;
}
