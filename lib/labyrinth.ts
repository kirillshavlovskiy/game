export const WALL = "#";
export const PATH = " ";
export const PLAYER = "@";
export const GOAL = "X";
export const START = "S";

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
  players: Array<{ x: number; y: number }>;
  goalX: number;
  goalY: number;

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
    this.players = Array.from({ length: numPlayers }, () => ({ x: 0, y: 0 }));
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
    this._initGrid();
    this._carvePath(1, 1);
    this._ensureGoalReachable();
    this._addExtraPaths();
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
    }));
    return true;
  }

  canMove(x: number, y: number): boolean {
    return (
      x >= 0 &&
      x < this.width &&
      y >= 0 &&
      y < this.height &&
      this.grid[y][x] !== WALL
    );
  }

  movePlayer(dx: number, dy: number, playerIndex = 0): boolean {
    const p = this.players[playerIndex];
    if (!p) return false;
    const nx = p.x + dx, ny = p.y + dy;
    if (this.canMove(nx, ny)) {
      p.x = nx;
      p.y = ny;
      return true;
    }
    return false;
  }

  isGoalReached(playerIndex = 0): boolean {
    const p = this.players[playerIndex];
    return p && p.x === this.goalX && p.y === this.goalY;
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
