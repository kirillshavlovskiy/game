/**
 * Dracula AI: pure TypeScript state machine.
 * See docs/DRACULA_LOGIC_REFERENCE.md for stand-by, hunt, combat logic.
 */

import type {
  EntityId,
  Position,
  PlayerState,
  DraculaStateData,
  DraculaState,
  TileState,
} from "../types";
import { DRACULA_CONFIG } from "../constants";
import { manhattan, getNeighbors } from "../utils/grid";

export interface DraculaContext {
  map: TileState[][];
  width: number;
  height: number;
  players: PlayerState[];
  eliminatedPlayerIds: Set<EntityId>;
  holyTiles: Set<string>;
  monsterPositions: Set<string>;
}

export interface DraculaTickResult {
  /** Schedule attack resolution after delayMs */
  scheduleAttack?: { targetPlayerId: EntityId; delayMs: number };
  /** Schedule teleport resolution after delayMs */
  scheduleTeleport?: { delayMs: number };
  /** New telegraph state for renderer */
  telegraph?: { type: "attack" | "teleport"; x: number; y: number };
}

function posKey(x: number, y: number): string {
  return `${x},${y}`;
}

function isWalkable(ctx: DraculaContext, x: number, y: number): boolean {
  if (x < 0 || x >= ctx.width || y < 0 || y >= ctx.height) return false;
  const tile = ctx.map[y]?.[x];
  return tile != null && !tile.blocksMovement;
}

function isHoly(ctx: DraculaContext, x: number, y: number): boolean {
  return ctx.holyTiles.has(posKey(x, y));
}

/** Select target: most artifacts, then nearest, then lowest HP. */
export function selectTarget(
  dracula: DraculaStateData,
  ctx: DraculaContext
): EntityId | null {
  const visible = ctx.players.filter(
    (p) =>
      !ctx.eliminatedPlayerIds.has(p.id) &&
      manhattan(dracula.x, dracula.y, p.x, p.y) <= dracula.vision
  );
  if (visible.length === 0) return null;

  const sorted = [...visible].sort((a, b) => {
    if (a.artifacts !== b.artifacts) return b.artifacts - a.artifacts;
    const da = manhattan(dracula.x, dracula.y, a.x, a.y);
    const db = manhattan(dracula.x, dracula.y, b.x, b.y);
    if (da !== db) return da - db;
    return a.hp - b.hp;
  });
  return sorted[0].id;
}

/** Find best teleport landing tile: walkable, not holy, not player, not monster. */
function findBestTeleportTile(
  dracula: DraculaStateData,
  target: PlayerState,
  ctx: DraculaContext
): Position | null {
  const range = dracula.teleportRange;
  const candidates: { x: number; y: number; score: number }[] = [];

  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -range; dx <= range; dx++) {
      const x = target.x + dx;
      const y = target.y + dy;
      if (x < 0 || x >= ctx.width || y < 0 || y >= ctx.height) continue;
      if (x === target.x && y === target.y) continue;
      if (!isWalkable(ctx, x, y)) continue;
      if (isHoly(ctx, x, y)) continue;
      if (ctx.monsterPositions.has(posKey(x, y))) continue;
      if (ctx.players.some((p) => !ctx.eliminatedPlayerIds.has(p.id) && p.x === x && p.y === y))
        continue;

      const distFromTarget = manhattan(x, y, target.x, target.y);
      const distFromDracula = manhattan(x, y, dracula.x, dracula.y);
      if (distFromDracula > range) continue;

      let score = distFromTarget * 10;
      if (isHoly(ctx, x, y)) score += 1000;
      candidates.push({ x, y, score });
    }
  }

  candidates.sort((a, b) => a.score - b.score);
  const best = candidates[0];
  return best ? { x: best.x, y: best.y } : null;
}

/** Greedy move 1 tile toward target. */
function moveTowardTarget(
  dracula: DraculaStateData,
  target: PlayerState,
  ctx: DraculaContext
): Position {
  const candidates: Position[] = [];
  for (const [nx, ny] of getNeighbors(dracula.x, dracula.y, ctx.width, ctx.height)) {
    if (!isWalkable(ctx, nx, ny)) continue;
    if (ctx.monsterPositions.has(posKey(nx, ny))) continue;
    if (ctx.players.some((p) => p.x === nx && p.y === ny)) continue;
    candidates.push({ x: nx, y: ny });
  }

  if (candidates.length === 0) return { x: dracula.x, y: dracula.y };

  let best = candidates[0];
  let bestD = manhattan(best.x, best.y, target.x, target.y);
  for (const c of candidates) {
    const d = manhattan(c.x, c.y, target.x, target.y);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/** Reduce cooldowns by 1. */
function reduceCooldowns(dracula: DraculaStateData): void {
  if (dracula.cooldowns.teleport > 0) dracula.cooldowns.teleport--;
  if (dracula.cooldowns.attack > 0) dracula.cooldowns.attack--;
}

/**
 * Main tick: update Dracula state machine.
 * Call every monster tick (e.g. 2500ms).
 * Telegraph states are handled externally via scheduleAttack/scheduleTeleport.
 */
export function tick(
  dracula: DraculaStateData,
  ctx: DraculaContext,
  nowMs: number
): DraculaTickResult {
  const result: DraculaTickResult = {};

  // Banished: count down
  if (dracula.state === "banished") {
    const ticks = (dracula.banishTicks ?? 0) - 1;
    dracula.banishTicks = ticks;
    if (ticks <= 0) {
      dracula.state = "idle";
      dracula.targetPlayerId = null;
      // Respawn at spawn point (caller may set position)
    }
    return result;
  }

  // Telegraph states: skip (handled by timer callbacks)
  if (dracula.state === "telegraphTeleport" || dracula.state === "telegraphAttack") {
    return result;
  }

  reduceCooldowns(dracula);

  const targetId = dracula.targetPlayerId ?? selectTarget(dracula, ctx);
  const target = targetId ? ctx.players.find((p) => p.id === targetId) : null;

  switch (dracula.state) {
    case "idle": {
      if (target && !ctx.eliminatedPlayerIds.has(target.id)) {
        dracula.targetPlayerId = target.id;
        dracula.state = "hunt";
      } else {
        dracula.targetPlayerId = null;
        // Optional patrol
        const patrol = dracula.patrolArea;
        if (patrol && patrol.length >= 2) {
          const idx = patrol.findIndex(([px, py]) => px === dracula.x && py === dracula.y);
          const nextIdx = idx >= 0 ? (idx + 1) % patrol.length : 0;
          const [nx, ny] = patrol[nextIdx];
          if (isWalkable(ctx, nx, ny)) {
            dracula.x = nx;
            dracula.y = ny;
          }
        }
      }
      break;
    }

    case "hunt": {
      if (!target || ctx.eliminatedPlayerIds.has(target.id)) {
        dracula.targetPlayerId = null;
        dracula.state = "idle";
        break;
      }

      const dist = manhattan(dracula.x, dracula.y, target.x, target.y);
      if (dist > dracula.vision) {
        dracula.targetPlayerId = null;
        dracula.state = "idle";
        break;
      }

      // Check if target on holy tile (attack cancels)
      if (isHoly(ctx, target.x, target.y)) {
        dracula.state = "recover";
        break;
      }

      if (dist === 1 && dracula.cooldowns.attack === 0) {
        dracula.state = "telegraphAttack";
        result.telegraph = { type: "attack", x: target.x, y: target.y };
        result.scheduleAttack = {
          targetPlayerId: target.id,
          delayMs: DRACULA_CONFIG.attackTelegraphMs,
        };
        break;
      }

      if (dist >= 2 && dist <= 4 && dracula.cooldowns.teleport === 0) {
        const tile = findBestTeleportTile(dracula, target, ctx);
        if (tile) {
          dracula.state = "telegraphTeleport";
          result.telegraph = { type: "teleport", x: tile.x, y: tile.y };
          result.scheduleTeleport = { delayMs: DRACULA_CONFIG.teleportTelegraphMs };
          break;
        }
      }

      const next = moveTowardTarget(dracula, target, ctx);
      dracula.x = next.x;
      dracula.y = next.y;
      break;
    }

    case "recover": {
      if (target && !ctx.eliminatedPlayerIds.has(target.id) && !isHoly(ctx, target.x, target.y)) {
        dracula.state = "hunt";
      } else {
        dracula.targetPlayerId = null;
        dracula.state = "idle";
      }
      break;
    }

    default:
      dracula.state = "idle";
      dracula.targetPlayerId = null;
  }

  return result;
}

/**
 * Resolve teleport (call after telegraph delay).
 * Returns true if Dracula landed adjacent and should immediately telegraph attack.
 */
export function resolveTeleport(
  dracula: DraculaStateData,
  ctx: DraculaContext
): boolean {
  const target = dracula.targetPlayerId
    ? ctx.players.find((p) => p.id === dracula.targetPlayerId)
    : null;

  if (!target || ctx.eliminatedPlayerIds.has(target.id)) {
    dracula.state = "idle";
    dracula.targetPlayerId = null;
    return false;
  }

  const tile = findBestTeleportTile(dracula, target, ctx);
  if (tile) {
    dracula.x = tile.x;
    dracula.y = tile.y;
  }

  dracula.cooldowns.teleport = DRACULA_CONFIG.teleportCooldown;
  dracula.state = "teleport";

  const dist = manhattan(dracula.x, dracula.y, target.x, target.y);
  if (dist === 1 && dracula.cooldowns.attack === 0) {
    dracula.state = "telegraphAttack";
    return true;
  }
  dracula.state = "recover";
  return false;
}

/**
 * Resolve attack (call after telegraph delay).
 * Returns target player id if attack hit, null if missed (target moved).
 */
export function resolveAttack(
  dracula: DraculaStateData,
  ctx: DraculaContext
): EntityId | null {
  const target = dracula.targetPlayerId
    ? ctx.players.find((p) => p.id === dracula.targetPlayerId)
    : null;

  if (!target || ctx.eliminatedPlayerIds.has(target.id)) {
    dracula.state = "recover";
    dracula.targetPlayerId = null;
    return null;
  }

  const dist = manhattan(dracula.x, dracula.y, target.x, target.y);
  if (dist !== 1) {
    dracula.state = "recover";
    return null;
  }

  if (isHoly(ctx, target.x, target.y)) {
    dracula.state = "recover";
    return null;
  }

  dracula.cooldowns.attack = DRACULA_CONFIG.attackCooldown;
  dracula.state = "recover";

  return target.id;
}
