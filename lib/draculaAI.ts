import {
  isWalkable,
  DRACULA_CONFIG,
  type Monster,
  type DraculaState,
} from "./labyrinth";

function manhattan(x1: number, y1: number, x2: number, y2: number): number {
  return Math.abs(x1 - x2) + Math.abs(y1 - y2);
}

/** Find priority target: nearest player with most artifacts, else nearest visible. */
export function findPriorityTarget(
  dracula: Monster,
  players: Array<{ x: number; y: number; artifacts?: number }>,
  eliminated: Set<number>
): number | null {
  const vision = DRACULA_CONFIG.vision;
  let best: { index: number; dist: number; artifacts: number } | null = null;
  for (let i = 0; i < players.length; i++) {
    if (eliminated.has(i)) continue;
    const p = players[i];
    if (!p) continue;
    const d = manhattan(dracula.x, dracula.y, p.x, p.y);
    if (d > vision) continue;
    const artifacts = p.artifacts ?? 0;
    if (!best || artifacts > best.artifacts || (artifacts === best.artifacts && d < best.dist)) {
      best = { index: i, dist: d, artifacts };
    }
  }
  return best?.index ?? null;
}

/** Move 1 tile toward target. Simple: reduce X, else Y. */
function moveTowardTarget(
  dracula: Monster,
  targetX: number,
  targetY: number,
  grid: string[][],
  width: number,
  height: number
): [number, number] {
  const dx = Math.sign(targetX - dracula.x);
  const dy = Math.sign(targetY - dracula.y);
  const candidates: [number, number][] = [];
  if (dx !== 0) {
    const nx = dracula.x + dx;
    if (nx >= 0 && nx < width && isWalkable(grid[dracula.y]?.[nx])) {
      candidates.push([nx, dracula.y]);
    }
  }
  if (dy !== 0) {
    const ny = dracula.y + dy;
    if (ny >= 0 && ny < height && isWalkable(grid[ny]?.[dracula.x])) {
      candidates.push([dracula.x, ny]);
    }
  }
  if (candidates.length === 0) {
    for (const [ddx, ddy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nx = dracula.x + ddx;
      const ny = dracula.y + ddy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height && isWalkable(grid[ny]?.[nx])) {
        candidates.push([nx, ny]);
      }
    }
  }
  if (candidates.length === 0) return [dracula.x, dracula.y];
  let best = candidates[0];
  let bestD = manhattan(best[0], best[1], targetX, targetY);
  for (const c of candidates) {
    const d = manhattan(c[0], c[1], targetX, targetY);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/** Find best teleport tile: walkable, not player, ideally adjacent to target. */
export function findBestTeleportTile(
  dracula: Monster,
  targetX: number,
  targetY: number,
  grid: string[][],
  width: number,
  height: number
): [number, number] | null {
  const range = DRACULA_CONFIG.teleportRange;
  const candidates: { x: number; y: number; score: number }[] = [];
  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -range; dx <= range; dx++) {
      const x = targetX + dx;
      const y = targetY + dy;
      if (x < 0 || x >= width || y < 0 || y >= height) continue;
      const distFromTarget = manhattan(x, y, targetX, targetY);
      const distFromDracula = manhattan(x, y, dracula.x, dracula.y);
      if (distFromDracula > range) continue;
      if (!isWalkable(grid[y]?.[x])) continue;
      if (x === targetX && y === targetY) continue;
      candidates.push({ x, y, score: distFromTarget });
    }
  }
  candidates.sort((a, b) => a.score - b.score);
  return candidates[0] ? [candidates[0].x, candidates[0].y] : null;
}

function reduceCooldowns(dracula: Monster): void {
  const c = dracula.draculaCooldowns;
  if (!c) return;
  if (c.teleport > 0) c.teleport--;
  if (c.attack > 0) c.attack--;
}

export interface DraculaActionResult {
  /** If set, schedule this action after delayMs */
  scheduledAction?: { type: "teleport" | "attack"; delayMs: number };
}

export function updateDracula(
  dracula: Monster,
  players: Array<{ x: number; y: number; artifacts?: number; hp?: number }>,
  eliminated: Set<number>,
  grid: string[][],
  width: number,
  height: number
): DraculaActionResult {
  const result: DraculaActionResult = {};
  reduceCooldowns(dracula);

  const targetIdx = dracula.targetPlayerIndex ?? findPriorityTarget(dracula, players, eliminated);
  const target = targetIdx !== null && players[targetIdx] ? players[targetIdx] : null;

  switch (dracula.draculaState ?? "idle") {
    case "idle": {
      if (target) {
        dracula.targetPlayerIndex = targetIdx;
        dracula.draculaState = "hunt";
      } else {
        dracula.targetPlayerIndex = null;
        const patrol = dracula.patrolArea;
        if (patrol.length >= 2) {
          const idx = patrol.findIndex(([px, py]) => px === dracula.x && py === dracula.y);
          const nextIdx = idx >= 0 ? (idx + 1) % patrol.length : 0;
          const [nx, ny] = patrol[nextIdx];
          if (isWalkable(grid[ny]?.[nx])) {
            dracula.x = nx;
            dracula.y = ny;
          }
        }
      }
      break;
    }
    case "hunt": {
      if (!target || eliminated.has(targetIdx!)) {
        dracula.targetPlayerIndex = null;
        dracula.draculaState = "idle";
        break;
      }
      const dist = manhattan(dracula.x, dracula.y, target.x, target.y);
      if (dist > DRACULA_CONFIG.vision) {
        dracula.targetPlayerIndex = null;
        dracula.draculaState = "idle";
        break;
      }
      const c = dracula.draculaCooldowns ?? { teleport: 0, attack: 0 };
      if (dist === 1 && c.attack === 0) {
        dracula.draculaState = "telegraphAttack";
        result.scheduledAction = { type: "attack", delayMs: DRACULA_CONFIG.attackTelegraphMs };
        break;
      }
      if (dist >= 2 && dist <= 4 && c.teleport === 0) {
        const tile = findBestTeleportTile(dracula, target.x, target.y, grid, width, height);
        if (tile) {
          dracula.draculaState = "telegraphTeleport";
          result.scheduledAction = { type: "teleport", delayMs: DRACULA_CONFIG.teleportTelegraphMs };
          break;
        }
      }
      const [nx, ny] = moveTowardTarget(dracula, target.x, target.y, grid, width, height);
      dracula.x = nx;
      dracula.y = ny;
      break;
    }
    case "telegraphTeleport":
    case "telegraphAttack":
      break;
    case "recover":
      dracula.draculaState = "hunt";
      break;
    default:
      dracula.draculaState = "idle";
  }
  return result;
}

/** Apply teleport. Returns true if Dracula landed adjacent and needs attack telegraph. */
export function applyDraculaTeleport(
  dracula: Monster,
  players: Array<{ x: number; y: number }>,
  grid: string[][],
  width: number,
  height: number
): boolean {
  const targetIdx = dracula.targetPlayerIndex;
  const target = targetIdx !== null && players[targetIdx] ? players[targetIdx] : null;
  if (!target) {
    dracula.draculaState = "idle";
    dracula.targetPlayerIndex = null;
    return false;
  }
  const tile = findBestTeleportTile(dracula, target.x, target.y, grid, width, height);
  if (tile) {
    dracula.x = tile[0];
    dracula.y = tile[1];
  }
  dracula.draculaCooldowns = dracula.draculaCooldowns ?? { teleport: 0, attack: 0 };
  dracula.draculaCooldowns.teleport = DRACULA_CONFIG.teleportCooldown;
  dracula.draculaState = "teleport";
  const dist = manhattan(dracula.x, dracula.y, target.x, target.y);
  if (dist === 1 && dracula.draculaCooldowns.attack === 0) {
    dracula.draculaState = "telegraphAttack";
    return true;
  }
  dracula.draculaState = "recover";
  return false;
}

export function applyDraculaAttack(
  dracula: Monster,
  players: Array<{ x: number; y: number; artifacts?: number; hp?: number }>,
  eliminated: Set<number>
): number | null {
  const targetIdx = dracula.targetPlayerIndex;
  if (targetIdx === null || eliminated.has(targetIdx)) return null;
  const target = players[targetIdx];
  if (!target) return null;
  const dist = manhattan(dracula.x, dracula.y, target.x, target.y);
  if (dist !== 1) return null;
  dracula.draculaCooldowns = dracula.draculaCooldowns ?? { teleport: 0, attack: 0 };
  dracula.draculaCooldowns.attack = DRACULA_CONFIG.attackCooldown;
  dracula.draculaState = "recover";
  return targetIdx;
}
