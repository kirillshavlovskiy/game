export const WALL = "#";
export const PATH = " ";
export const PLAYER = "@";
export const GOAL = "X";
export const START = "S";
export const MULT_X2 = "2";
export const MULT_X3 = "3";
export const MULT_X4 = "4";
export const MAGIC = "M";
export const JUMP = "J";

export type MonsterType = "V" | "Z" | "S"; // Vampire, Zombie, Spider

export interface Monster {
  x: number;
  y: number;
  type: MonsterType;
  patrolArea: [number, number][];
}

export function isMonsterType(type: string): type is MonsterType {
  return type === "V" || type === "Z" || type === "S";
}

export function getMonsterName(type: MonsterType): string {
  return type === "V" ? "Vampire" : type === "Z" ? "Zombie" : "Spider";
}

export function isMultiplierCell(cell: string): cell is "2" | "3" | "4" {
  return cell === MULT_X2 || cell === MULT_X3 || cell === MULT_X4;
}

export function getMultiplierValue(cell: string): number {
  return cell === MULT_X2 ? 2 : cell === MULT_X3 ? 3 : cell === MULT_X4 ? 4 : 1;
}

export function isMagicCell(cell: string): boolean {
  return cell === MAGIC;
}

export function isJumpCell(cell: string): boolean {
  return cell === JUMP;
}

export function isDiamondCell(cell: string): boolean {
  return /^D\d+$/.test(cell);
}

export function getCollectibleOwner(cell: string): number | null {
  const m = cell.match(/^D(\d+)$/);
  return m ? parseInt(m[1], 10) - 1 : null;
}

export function isWalkable(cell: string): boolean {
  return cell !== WALL;
}

function shuffle<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export class Labyrinth {
  width: number;
  height: number;
  extraPaths: number;
  numPlayers: number;
  grid: string[][];
  players: Array<{ x: number; y: number; jumps: number; diamonds: number }>;
  goalX: number;
  goalY: number;
  monsters: Monster[] = [];
  eliminatedPlayers: Set<number> = new Set();

  constructor(
    width: number,
    height: number,
    extraPaths = 4,
    numPlayers = 1
  ) {
    this.width = width;
    this.height = height;
    this.extraPaths = extraPaths;
    this.numPlayers = numPlayers;
    this.grid = [];
    this.players = Array.from({ length: numPlayers }, () => ({ x: 0, y: 0, jumps: 0, diamonds: 0 }));
    this.goalX = width - 1;
    this.goalY = height - 1;
  }

  get playerX(): number {
    return this.players[0]?.x ?? 0;
  }
  get playerY(): number {
    return this.players[0]?.y ?? 0;
  }

  private _initGrid(): void {
    this.grid = Array(this.height)
      .fill(null)
      .map(() => Array(this.width).fill(WALL));
  }

  private _carvePath(x: number, y: number): void {
    this.grid[y][x] = PATH;
    const dirs = shuffle([
      [0, -2],
      [2, 0],
      [0, 2],
      [-2, 0],
    ]);
    for (const [dx, dy] of dirs) {
      const nx = x + dx, ny = y + dy;
      if (
        nx >= 1 &&
        nx <= this.width - 2 &&
        ny >= 1 &&
        ny <= this.height - 2 &&
        this.grid[ny][nx] === WALL
      ) {
        this.grid[y + dy / 2][x + dx / 2] = PATH;
        this._carvePath(nx, ny);
      }
    }
  }

  private _ensureGoalReachable(): void {
    const gx = this.goalX, gy = this.goalY;
    if (this.grid[gy][gx] === PATH) return;
    const q: [number, number][] = [[gx, gy]];
    const seen = new Set<string>([`${gx},${gy}`]);
    const parent: Record<string, [number, number]> = {};
    let found: [number, number] | null = null;
    while (q.length) {
      const [x, y] = q.shift()!;
      for (const [dx, dy] of [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ]) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
          if (this.grid[ny][nx] === PATH) {
            found = [x, y];
            break;
          }
          const key = `${nx},${ny}`;
          if (!seen.has(key)) {
            seen.add(key);
            parent[key] = [x, y];
            q.push([nx, ny]);
          }
        }
      }
      if (found) break;
    }
    if (found) {
      let cur: [number, number] | undefined = found;
      while (cur) {
        this.grid[cur[1]][cur[0]] = PATH;
        if (cur[0] === gx && cur[1] === gy) break;
        cur = parent[`${cur[0]},${cur[1]}`];
      }
    }
  }

  private _countPathNeighbors(x: number, y: number): number {
    let count = 0;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height && this.grid[ny][nx] === PATH)
        count++;
    }
    return count;
  }

  private _pickSpread<T>(arr: T[], count: number): T[] {
    if (count >= arr.length) return [...arr];
    const step = Math.max(1, Math.floor(arr.length / (count + 1)));
    const out: T[] = [];
    for (let i = 0; i < count && i * step < arr.length; i++) {
      out.push(arr[i * step]);
    }
    return out;
  }

  private _addSpecialCells(): void {
    const pathCells: [number, number][] = [];
    for (let y = 1; y < this.height - 1; y++)
      for (let x = 1; x < this.width - 1; x++)
        if (this.grid[y][x] === PATH && (x !== this.goalX || y !== this.goalY))
          pathCells.push([x, y]);
    shuffle(pathCells);

    const mults: ("2" | "3" | "4")[] = ["2", "3", "4"];
    const multCount = Math.max(6, Math.min(15, Math.floor(pathCells.length * 0.12)));
    const magicCount = Math.max(4, Math.min(10, Math.floor(pathCells.length * 0.05)));
    const jumpCount = Math.max(3, Math.min(8, Math.floor(pathCells.length * 0.04)));
    const diamondCount = Math.max(this.numPlayers * 2, Math.min(this.numPlayers * 4, Math.floor(pathCells.length * 0.08)));

    const total = multCount + magicCount + jumpCount + diamondCount;
    if (total > pathCells.length) return;

    const multCells = this._pickSpread(pathCells, multCount);
    const rest = pathCells.filter((c) => !multCells.some((m) => m[0] === c[0] && m[1] === c[1]));
    const magicCells = this._pickSpread(rest, magicCount);
    const rest2 = rest.filter((c) => !magicCells.some((m) => m[0] === c[0] && m[1] === c[1]));
    const jumpCells = this._pickSpread(rest2, jumpCount);
    const rest3 = rest2.filter((c) => !jumpCells.some((j) => j[0] === c[0] && j[1] === c[1]));
    const diamondCells = this._pickSpread(rest3, diamondCount);

    for (let i = 0; i < multCells.length; i++) {
      const [x, y] = multCells[i];
      this.grid[y][x] = mults[i % 3];
    }
    for (const [x, y] of magicCells) this.grid[y][x] = MAGIC;
    for (const [x, y] of jumpCells) this.grid[y][x] = JUMP;
    for (let i = 0; i < diamondCells.length; i++) {
      const [x, y] = diamondCells[i];
      this.grid[y][x] = `D${(i % this.numPlayers) + 1}`;
    }
    this._addMonsters(rest3);
  }

  private _getPatrolArea(startX: number, startY: number, maxCells: number): [number, number][] {
    const area: [number, number][] = [];
    const seen = new Set<string>();
    const q: [number, number][] = [[startX, startY]];
    seen.add(`${startX},${startY}`);
    while (q.length > 0 && area.length < maxCells) {
      const [x, y] = q.shift()!;
      area.push([x, y]);
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height &&
            this.grid[ny][nx] === PATH && !seen.has(`${nx},${ny}`)) {
          seen.add(`${nx},${ny}`);
          q.push([nx, ny]);
        }
      }
    }
    return area;
  }

  private _addMonsters(excludeCells: [number, number][]): void {
    const types: MonsterType[] = ["V", "Z", "S"];
    const intersections: [number, number][] = [];
    for (let y = 1; y < this.height - 1; y++) {
      for (let x = 1; x < this.width - 1; x++) {
        if (this.grid[y][x] !== PATH) continue;
        const n = this._countPathNeighbors(x, y);
        if (n >= 3 && (x !== 0 || y !== 0) && (x !== this.goalX || y !== this.goalY) &&
            !excludeCells.some(([ex, ey]) => ex === x && ey === y)) {
          intersections.push([x, y]);
        }
      }
    }
    const monsterCount = Math.min(6, Math.max(2, Math.floor(intersections.length * 0.3)));
    const chosen = this._pickSpread(intersections, monsterCount);
    for (let i = 0; i < chosen.length; i++) {
      const [x, y] = chosen[i];
      const patrolArea = this._getPatrolArea(x, y, 8);
      if (patrolArea.length >= 2) {
        this.monsters.push({
          x, y,
          type: types[i % 3],
          patrolArea,
        });
      }
    }
  }

  moveMonsters(): void {
    for (const m of this.monsters) {
      if (m.patrolArea.length < 2) continue;
      const walkable = m.patrolArea.filter(([px, py]) =>
        (px !== m.x || py !== m.y) && this.grid[py]?.[px] === PATH
      );
      if (walkable.length === 0) continue;
      const next = walkable[Math.floor(Math.random() * walkable.length)];
      m.x = next[0];
      m.y = next[1];
    }
  }

  checkMonsterCollision(): { playerIndex: number; monsterType: MonsterType } | null {
    for (const m of this.monsters) {
      for (let i = 0; i < this.players.length; i++) {
        if (this.eliminatedPlayers.has(i)) continue;
        const p = this.players[i];
        if (p && p.x === m.x && p.y === m.y) {
          return { playerIndex: i, monsterType: m.type };
        }
      }
    }
    return null;
  }

  private _addExtraPaths(): void {
    // Prefer walls with 2+ path neighbors - these create loops (alternative routes)
    let walls: [number, number][] = [];
    for (let y = 1; y < this.height - 1; y++)
      for (let x = 1; x < this.width - 1; x++)
        if (this.grid[y][x] === WALL && this._countPathNeighbors(x, y) >= 2)
          walls.push([x, y]);
    if (walls.length < this.extraPaths) {
      const fallback: [number, number][] = [];
      for (let y = 1; y < this.height - 1; y++)
        for (let x = 1; x < this.width - 1; x++)
          if (this.grid[y][x] === WALL) fallback.push([x, y]);
      walls = walls.length > 0 ? walls : fallback;
    }
    const n = Math.min(this.extraPaths, walls.length);
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(Math.random() * walls.length);
      const [x, y] = walls.splice(idx, 1)[0];
      this.grid[y][x] = PATH;
    }
  }

  generate(): void {
    this.monsters = [];
    this.eliminatedPlayers = new Set();
    this._initGrid();
    this._carvePath(1, 1);
    this._ensureGoalReachable();
    this._addExtraPaths();
    this._addSpecialCells();
    this.grid[0][0] = PATH;
    this.grid[this.height - 1][this.width - 1] = PATH;
    if (this.height > 1) this.grid[1][0] = PATH;
    if (this.width > 1) this.grid[0][1] = PATH;
    if (this.height > 1) this.grid[this.height - 2][this.width - 1] = PATH;
    if (this.width > 1) this.grid[this.height - 1][this.width - 2] = PATH;
  }

  loadGrid(grid: string[][]): boolean {
    if (!grid || !Array.isArray(grid) || grid.length !== this.height)
      return false;
    this._initGrid();
    for (let y = 0; y < this.height; y++) {
      const row = grid[y];
      if (!Array.isArray(row) || row.length !== this.width) return false;
      for (let x = 0; x < this.width; x++) {
        this.grid[y][x] = row[x] === "#" ? WALL : PATH;
      }
    }
    this.grid[0][0] = PATH;
    this.grid[this.goalY][this.goalX] = PATH;
    if (this.height > 1) this.grid[1][0] = PATH;
    if (this.width > 1) this.grid[0][1] = PATH;
    if (this.height > 1) this.grid[this.height - 2][this.width - 1] = PATH;
    if (this.width > 1) this.grid[this.height - 1][this.width - 2] = PATH;
    this.players = Array.from({ length: this.numPlayers }, () => ({
      x: 0,
      y: 0,
      jumps: 0,
      diamonds: 0,
    }));
    this.monsters = [];
    this.eliminatedPlayers = new Set();
    this._addMonsters([]);
    return true;
  }

  canMove(x: number, y: number): boolean {
    return (
      x >= 0 &&
      x < this.width &&
      y >= 0 &&
      y < this.height &&
      isWalkable(this.grid[y][x])
    );
  }

  /** Returns true if the player can move in direction (dx, dy) - either normal move or jump. */
  canMoveInDirection(dx: number, dy: number, playerIndex = 0): boolean {
    return this.canMoveOnly(dx, dy, playerIndex) || this.canJumpInDirection(dx, dy, playerIndex);
  }

  /** Returns true if the player can walk normally (adjacent cell is path). */
  canMoveOnly(dx: number, dy: number, playerIndex = 0): boolean {
    const p = this.players[playerIndex];
    if (!p) return false;
    const nx = p.x + dx;
    const ny = p.y + dy;
    return this.canMove(nx, ny);
  }

  /** Returns true if the player can jump over wall in direction (dx, dy). */
  canJumpInDirection(dx: number, dy: number, playerIndex = 0): boolean {
    const p = this.players[playerIndex];
    if (!p || (p.jumps ?? 0) <= 0) return false;
    const nx = p.x + dx;
    const ny = p.y + dy;
    if (this.grid[ny]?.[nx] !== WALL) return false;
    const jx = nx + dx;
    const jy = ny + dy;
    return jx >= 0 && jx < this.width && jy >= 0 && jy < this.height && this.canMove(jx, jy);
  }

  movePlayer(dx: number, dy: number, playerIndex = 0, jumpOnly = false): boolean {
    const p = this.players[playerIndex];
    if (!p) return false;
    const nx = p.x + dx, ny = p.y + dy;

    // Normal move (skip if jumpOnly)
    if (!jumpOnly && this.canMove(nx, ny)) {
      p.x = nx;
      p.y = ny;
      return true;
    }

    // Jump over wall (only when jumpOnly - user explicitly chose jump)
    if (jumpOnly && (p.jumps ?? 0) > 0 && this.grid[ny]?.[nx] === WALL) {
      const jx = nx + dx, jy = ny + dy;
      if (jx >= 0 && jx < this.width && jy >= 0 && jy < this.height && this.canMove(jx, jy)) {
        p.x = jx;
        p.y = jy;
        p.jumps--;
        return true;
      }
    }
    return false;
  }

  getTeleportDestination(playerIndex = 0): [number, number] | null {
    const p = this.players[playerIndex];
    if (!p) return null;
    const magicCells: [number, number][] = [];
    for (let y = 0; y < this.height; y++)
      for (let x = 0; x < this.width; x++)
        if (this.grid[y][x] === MAGIC && (x !== p.x || y !== p.y))
          magicCells.push([x, y]);
    if (magicCells.length === 0) return null;
    return magicCells[Math.floor(Math.random() * magicCells.length)];
  }

  teleportToRandomMagicCell(playerIndex = 0): boolean {
    const dest = this.getTeleportDestination(playerIndex);
    if (!dest) return false;
    const p = this.players[playerIndex];
    if (!p) return false;
    p.x = dest[0];
    p.y = dest[1];
    return true;
  }

  getMagicCellPositions(): [number, number][] {
    const out: [number, number][] = [];
    for (let y = 0; y < this.height; y++)
      for (let x = 0; x < this.width; x++)
        if (this.grid[y][x] === MAGIC) out.push([x, y]);
    return out;
  }

  isGoalReached(playerIndex = 0): boolean {
    const p = this.players[playerIndex];
    return p && p.x === this.goalX && p.y === this.goalY;
  }

  getJumpTargets(playerIndex = 0): Array<{ x: number; y: number; dx: number; dy: number }> {
    const p = this.players[playerIndex];
    if (!p || (p.jumps ?? 0) <= 0) return [];
    const targets: Array<{ x: number; y: number; dx: number; dy: number }> = [];
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nx = p.x + dx, ny = p.y + dy;
      if (this.grid[ny]?.[nx] === WALL) {
        const jx = nx + dx, jy = ny + dy;
        if (jx >= 0 && jx < this.width && jy >= 0 && jy < this.height && this.canMove(jx, jy)) {
          targets.push({ x: jx, y: jy, dx, dy });
        }
      }
    }
    return targets;
  }
}

export const DIFFICULTY: Record<number, number> = {
  7: 7,
  11: 11,
  15: 15,
  21: 21,
  25: 25,
};

export const PLAYER_COLORS = [
  "#00ff88",
  "#4488ff",
  "#ff8844",
  "#ff44ff",
  "#44ff88",
  "#88aaff",
  "#ffaa44",
  "#aa44ff",
  "#44ffcc",
];

export const PLAYER_COLORS_ACTIVE = [
  "#66ffaa",
  "#77aaff",
  "#ffaa66",
  "#ff77ff",
  "#66ffaa",
  "#aaccff",
  "#ffcc66",
  "#cc77ff",
  "#66ffdd",
];
