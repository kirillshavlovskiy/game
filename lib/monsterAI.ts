import { isWalkable, type Monster, type MonsterType } from "./labyrinth";

const VISION_RADIUS = 3;
const MONSTER_DEFENSE: Record<MonsterType, number> = {
  V: 5,
  Z: 4,
  G: 3,
  K: 4,
  S: 3,
  L: 4,
  O: 4,
};

export function getMonsterVisionRadius(m: Monster): number {
  return m.visionRadius ?? VISION_RADIUS;
}

export function getMonsterDefenseValue(m: Monster): number {
  return m.defense ?? MONSTER_DEFENSE[m.type];
}

export function manhattanDist(x1: number, y1: number, x2: number, y2: number): number {
  return Math.abs(x1 - x2) + Math.abs(y1 - y2);
}

/** Find nearest player to monster. Returns [playerIndex, dist] or null. */
export function findNearestPlayer(
  monster: Monster,
  players: Array<{ x: number; y: number }>,
  eliminated: Set<number>
): { playerIndex: number; dist: number } | null {
  let nearest: { playerIndex: number; dist: number } | null = null;
  for (let i = 0; i < players.length; i++) {
    if (eliminated.has(i)) continue;
    const p = players[i];
    if (!p) continue;
    const d = manhattanDist(monster.x, monster.y, p.x, p.y);
    if (!nearest || d < nearest.dist) {
      nearest = { playerIndex: i, dist: d };
    }
  }
  return nearest;
}

/** BFS to find next step toward target. Returns [nx, ny] or null. */
export function pathfindToward(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  grid: string[][],
  width: number,
  height: number,
  canPhase: boolean
): [number, number] | null {
  const dist = (ax: number, ay: number) => manhattanDist(ax, ay, toX, toY);
  const neighbors: [number, number][] = [];
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
    const nx = fromX + dx;
    const ny = fromY + dy;
    if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
      if (canPhase || isWalkable(grid[ny][nx])) {
        neighbors.push([nx, ny]);
      }
    }
  }
  if (neighbors.length === 0) return null;
  // Pick neighbor that minimizes distance to target
  let best: [number, number] = neighbors[0];
  let bestD = dist(best[0], best[1]);
  for (const n of neighbors) {
    const d = dist(n[0], n[1]);
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best;
}

/** Get next position for monster based on AI. */
export function getMonsterNextPosition(
  monster: Monster,
  players: Array<{ x: number; y: number }>,
  eliminated: Set<number>,
  grid: string[][],
  width: number,
  height: number
): [number, number] {
  const canPhase = monster.type === "G";
  const vision = getMonsterVisionRadius(monster);
  const nearest = findNearestPlayer(monster, players, eliminated);

  if (nearest) {
    const { dist: d } = nearest;
    if (d <= 1) {
      // Attack: move onto player
      const p = players[nearest.playerIndex];

      if (p) return [p.x, p.y];
    }
    if (d <= vision) {
      // Chase
      const next = pathfindToward(
        monster.x,
        monster.y,
        players[nearest.playerIndex].x,
        players[nearest.playerIndex].y,
        grid,
        width,
        height,
        canPhase
      );
      if (next) return next;
    }
  }

  // Random move
  const adjacent: [number, number][] = [];
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
    const nx = monster.x + dx;
    const ny = monster.y + dy;
    if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
      if (canPhase || isWalkable(grid[ny][nx])) {
        adjacent.push([nx, ny]);
      }
    }
  }
  if (adjacent.length === 0) return [monster.x, monster.y];
  return adjacent[Math.floor(Math.random() * adjacent.length)];
}
