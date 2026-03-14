export const WALL = "#";
export const PATH = " ";
export const PLAYER = "@";
export const GOAL = "X";
export const START = "S";
export const MULT_X2 = "2";
export const MULT_X3 = "3";
export const MULT_X4 = "4";
export const MAGIC = "M";
export const CATAPULT = "C";
export const JUMP = "J";
export const SHIELD = "H";
export const BOMB = "B";

export type MonsterType = "V" | "Z" | "S" | "G"; // Vampire, Zombie, Spider, Ghost

export interface Monster {
  x: number;
  y: number;
  type: MonsterType;
  patrolArea: [number, number][];
}

export function isMonsterType(type: string): type is MonsterType {
  return type === "V" || type === "Z" || type === "S" || type === "G";
}

export function getMonsterName(type: MonsterType): string {
  return type === "V" ? "Vampire" : type === "Z" ? "Zombie" : type === "S" ? "Spider" : "Ghost";
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

export function isCatapultCell(cell: string): boolean {
  return cell === CATAPULT;
}

export function isJumpCell(cell: string): boolean {
  return cell === JUMP;
}

export function isShieldCell(cell: string): boolean {
  return cell === SHIELD;
}

export function isBombCell(cell: string): boolean {
  return cell === BOMB;
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
  monsterDensity: number;
  grid: string[][];
  players: Array<{ x: number; y: number; jumps: number; diamonds: number; shield: number; bombs: number }>;
  goalX: number;
  goalY: number;
  monsters: Monster[] = [];
  eliminatedPlayers: Set<number> = new Set();
  /** Hidden cells revealed when players collect diamonds. Key: "x,y", Value: cell type (M, J, 2, 3, 4, H) */
  hiddenCells: Map<string, string> = new Map();
  /** Spider web decoration positions [x,y] for visual effect */
  webPositions: [number, number][] = [];

  constructor(
    width: number,
    height: number,
    extraPaths = 4,
    numPlayers = 1,
    monsterDensity = 2
  ) {
    this.width = width;
    this.height = height;
    this.extraPaths = extraPaths;
    this.numPlayers = numPlayers;
    this.monsterDensity = Math.min(4, Math.max(1, monsterDensity));
    this.grid = [];
    this.players = Array.from({ length: numPlayers }, () => ({ x: 0, y: 0, jumps: 0, diamonds: 0, shield: 0, bombs: 0 }));
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

  /** Pick cells spread evenly, excluding main diagonal (x===y). For magic cells. */
  private _pickSpreadExcludingDiagonal(cells: [number, number][], count: number): [number, number][] {
    const offDiagonal = cells.filter(([x, y]) => x !== y);
    if (offDiagonal.length < count) return this._pickSpread(offDiagonal, count);
    // Sort by position for deterministic even spread (row-major with secondary sort)
    const sorted = [...offDiagonal].sort((a, b) => {
      const [ax, ay] = a;
      const [bx, by] = b;
      if (ay !== by) return ay - by;
      return ax - bx;
    });
    return this._pickSpread(sorted, count);
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
    const magicCount = Math.max(6, Math.min(25, Math.floor(pathCells.length * 0.07)));
    const catapultCount = Math.max(3, Math.min(8, Math.floor(pathCells.length * 0.04)));
    const jumpCount = Math.max(3, Math.min(8, Math.floor(pathCells.length * 0.04)));
    const diamondCount = Math.max(this.numPlayers * 2, Math.min(this.numPlayers * 4, Math.floor(pathCells.length * 0.08)));
    const blocks10x10 = (this.width / 10) * (this.height / 10);
    const bombCount = Math.max(1, Math.min(16, Math.floor(blocks10x10)));

    const total = multCount + magicCount + catapultCount + jumpCount + diamondCount + bombCount;
    if (total > pathCells.length) return;

    const multCells = this._pickSpread(pathCells, multCount);
    const rest = pathCells.filter((c) => !multCells.some((m) => m[0] === c[0] && m[1] === c[1]));
    const magicCells = this._pickSpreadExcludingDiagonal(rest, magicCount);
    const rest2 = rest.filter((c) => !magicCells.some((m) => m[0] === c[0] && m[1] === c[1]));
    const catapultCells = this._pickSpread(rest2, catapultCount);
    const rest2b = rest2.filter((c) => !catapultCells.some((c2) => c2[0] === c[0] && c2[1] === c[1]));
    const jumpCells = this._pickSpread(rest2b, jumpCount);
    const rest3 = rest2b.filter((c) => !jumpCells.some((j) => j[0] === c[0] && j[1] === c[1]));
    const diamondCells = this._pickSpread(rest3, diamondCount);
    const rest3b = rest3.filter((c) => !diamondCells.some((d) => d[0] === c[0] && d[1] === c[1]));
    const bombCells = this._pickSpread(rest3b, bombCount);

    for (let i = 0; i < multCells.length; i++) {
      const [x, y] = multCells[i];
      this.grid[y][x] = mults[i % 3];
    }
    for (const [x, y] of magicCells) this.grid[y][x] = MAGIC;
    for (const [x, y] of catapultCells) this.grid[y][x] = CATAPULT;
    for (const [x, y] of jumpCells) this.grid[y][x] = JUMP;
    for (let i = 0; i < diamondCells.length; i++) {
      const [x, y] = diamondCells[i];
      this.grid[y][x] = `D${(i % this.numPlayers) + 1}`;
    }
    for (const [x, y] of bombCells) this.grid[y][x] = BOMB;
    // Add hidden cells (revealed when diamonds collected): magic, jump, multipliers, shield
    const hiddenCount = Math.max(4, Math.min(12, Math.floor(pathCells.length * 0.06)));
    const rest4 = rest3b.filter((c) => !bombCells.some((b) => b[0] === c[0] && b[1] === c[1]));
    const hiddenCellCoords = this._pickSpread(rest4, hiddenCount);
    const hiddenTypes: string[] = [MAGIC, MAGIC, CATAPULT, CATAPULT, JUMP, JUMP, MULT_X2, MULT_X3, SHIELD, SHIELD];
    for (let i = 0; i < hiddenCellCoords.length; i++) {
      const [x, y] = hiddenCellCoords[i];
      this.hiddenCells.set(`${x},${y}`, hiddenTypes[i % hiddenTypes.length]);
      // Grid stays PATH until revealed
    }
    const excludeFromMonsters: [number, number][] = [
      ...multCells,
      ...magicCells,
      ...catapultCells,
      ...jumpCells,
      ...diamondCells,
      ...bombCells,
      ...hiddenCellCoords,
    ];
    this._addMonsters(excludeFromMonsters);
    this._addSpiderWebs(rest4.length > 0 ? rest4 : rest3b);
  }

  private _addSpiderWebs(pathCells: [number, number][]): void {
    const webCount = Math.max(3, Math.min(15, Math.floor(pathCells.length * 0.04)));
    const shuffled = shuffle([...pathCells]);
    for (let i = 0; i < webCount && i < shuffled.length; i++) {
      this.webPositions.push(shuffled[i]);
    }
  }

  /** Reveal hidden cells based on total diamonds collected by all players. Returns number revealed. */
  revealHiddenCells(totalDiamonds: number): number {
    const toReveal = Math.min(this.hiddenCells.size, Math.max(0, totalDiamonds * 2));
    if (toReveal <= 0) return 0;
    const entries = Array.from(this.hiddenCells.entries());
    const shuffled = shuffle(entries);
    let revealed = 0;
    for (let i = 0; i < Math.min(toReveal, shuffled.length); i++) {
      const [key, type] = shuffled[i];
      const [x, y] = key.split(",").map(Number);
      if (this.grid[y]?.[x] === PATH) {
        this.grid[y][x] = type;
        this.hiddenCells.delete(key);
        revealed++;
      }
    }
    return revealed;
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
            isWalkable(this.grid[ny][nx]) && !seen.has(`${nx},${ny}`)) {
          seen.add(`${nx},${ny}`);
          q.push([nx, ny]);
        }
      }
    }
    return area;
  }

  private _addMonsters(excludeCells: [number, number][]): void {
    const types: MonsterType[] = ["V", "Z", "S", "G"];
    const intersections: [number, number][] = [];
    const minNeighbors = this.width * this.height <= 400 ? 2 : 3;
    for (let y = 1; y < this.height - 1; y++) {
      for (let x = 1; x < this.width - 1; x++) {
        if (!isWalkable(this.grid[y][x])) continue;
        const n = this._countPathNeighbors(x, y);
        if (n >= minNeighbors && (x !== 0 || y !== 0) && (x !== this.goalX || y !== this.goalY) &&
            !excludeCells.some(([ex, ey]) => ex === x && ey === y)) {
          intersections.push([x, y]);
        }
      }
    }
    shuffle(intersections);
    const area = this.width * this.height;
    const blocks10x10 = (this.width / 10) * (this.height / 10);
    const fromArea = Math.floor((area / 80) * this.monsterDensity);
    const minPerDifficulty = this.monsterDensity * 2;
    const targetMonsters = Math.max(minPerDifficulty, Math.min(intersections.length, fromArea));
    const isSmallMap = this.width * this.height <= 400;
    const baseDist = this.monsterDensity >= 4 ? 2 : this.monsterDensity >= 3 ? 3 : 4;
    const MIN_MONSTER_DIST = isSmallMap ? Math.max(1, baseDist - 1) : baseDist;
    const chosen: [number, number][] = [];
    for (const [x, y] of intersections) {
      if (this.monsters.length >= targetMonsters) break;
      const farEnough = chosen.every(([cx, cy]) => Math.abs(x - cx) + Math.abs(y - cy) >= MIN_MONSTER_DIST);
      if (farEnough) {
        const patrolArea = this._getPatrolArea(x, y, 28);
        if (patrolArea.length >= 2) {
          chosen.push([x, y]);
          this.monsters.push({
            x, y,
            type: types[(this.monsters.length) % 4],
            patrolArea,
          });
        }
      }
    }
  }

  /** Optional swapHint: when a player just moved from (prevX, prevY) to the monster's cell, force monster to move to prev so they pass. */
  moveMonsters(swapHint?: { prevX: number; prevY: number; playerIndex: number }): void {
    for (const m of this.monsters) {
      // Consider all adjacent walkable cells - monsters can roam the entire labyrinth
      const adjacent: [number, number][] = [];
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const nx = m.x + dx;
        const ny = m.y + dy;
        if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height && isWalkable(this.grid[ny][nx])) {
          adjacent.push([nx, ny]);
        }
      }
      if (adjacent.length === 0) continue;
      let next: [number, number];
      if (swapHint && this.players[swapHint.playerIndex]) {
        const p = this.players[swapHint.playerIndex];
        if (p && p.x === m.x && p.y === m.y) {
          const prevCell = adjacent.find(([px, py]) => px === swapHint!.prevX && py === swapHint!.prevY);
          if (prevCell) {
            next = prevCell;
          } else {
            next = adjacent[Math.floor(Math.random() * adjacent.length)];
          }
        } else {
          next = adjacent[Math.floor(Math.random() * adjacent.length)];
        }
      } else {
        next = adjacent[Math.floor(Math.random() * adjacent.length)];
      }
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

  /** If player has shield, consume one and return true. Otherwise false. */
  tryConsumeShield(playerIndex: number): boolean {
    const p = this.players[playerIndex];
    if (!p || (p.shield ?? 0) <= 0) return false;
    p.shield = (p.shield ?? 0) - 1;
    return true;
  }

  /** Use bomb at player position: explode 3x3 area, kill monsters, destroy walls. Returns true if used. */
  useBomb(playerIndex: number): { used: boolean; monstersKilled: number; wallsDestroyed: number } {
    const p = this.players[playerIndex];
    if (!p || (p.bombs ?? 0) <= 0) return { used: false, monstersKilled: 0, wallsDestroyed: 0 };
    const cx = p.x;
    const cy = p.y;
    const inBlast = (mx: number, my: number) => Math.abs(mx - cx) <= 1 && Math.abs(my - cy) <= 1;
    const monstersKilled = this.monsters.filter((m) => inBlast(m.x, m.y)).length;
    this.monsters = this.monsters.filter((m) => !inBlast(m.x, m.y));
    let wallsDestroyed = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || nx >= this.width || ny < 0 || ny >= this.height) continue;
        if (this.grid[ny][nx] === WALL) {
          this.grid[ny][nx] = PATH;
          wallsDestroyed++;
        }
      }
    }
    p.bombs = (p.bombs ?? 0) - 1;
    return { used: true, monstersKilled, wallsDestroyed };
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
      shield: 0,
      bombs: 0,
    }));
    this.monsters = [];
    this.eliminatedPlayers = new Set();
    this.hiddenCells = new Map();
    this.webPositions = [];
    this._addMonsters([]);
    // Add hidden cells and spider webs from path cells for AI-loaded mazes
    const pathCells: [number, number][] = [];
    for (let y = 1; y < this.height - 1; y++)
      for (let x = 1; x < this.width - 1; x++)
        if (this.grid[y][x] === PATH && (x !== this.goalX || y !== this.goalY) &&
            !["M", "J", "2", "3", "4", "H", "B"].includes(this.grid[y][x]))
          pathCells.push([x, y]);
    const hiddenTypes = [MAGIC, MAGIC, CATAPULT, CATAPULT, JUMP, JUMP, "2", "3", SHIELD, SHIELD, BOMB];
    const n = Math.min(6, Math.floor(pathCells.length / 2));
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(Math.random() * pathCells.length);
      const [x, y] = pathCells.splice(idx, 1)[0];
      this.hiddenCells.set(`${x},${y}`, hiddenTypes[i % hiddenTypes.length]);
    }
    const webCount = Math.min(8, Math.floor(pathCells.length / 3));
    for (let i = 0; i < webCount && pathCells.length > 0; i++) {
      const idx = Math.floor(Math.random() * pathCells.length);
      this.webPositions.push(pathCells.splice(idx, 1)[0]);
    }
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

  getTeleportOptions(playerIndex = 0, maxOptions = 6, maxDistance?: number): [number, number][] {
    const p = this.players[playerIndex];
    if (!p) return [];
    const dist = (ax: number, ay: number) => Math.abs(ax - p.x) + Math.abs(ay - p.y);
    const mapSize = Math.min(this.width, this.height);
    const effectiveMaxDist = maxDistance ?? Math.max(10, Math.floor(mapSize * 0.5));
    const magicCells: [number, number][] = [];
    for (let y = 0; y < this.height; y++)
      for (let x = 0; x < this.width; x++)
        if (this.grid[y][x] === MAGIC && (x !== p.x || y !== p.y) && dist(x, y) <= effectiveMaxDist)
          magicCells.push([x, y]);
    if (magicCells.length === 0) return [];
    const sorted = [...magicCells].sort((a, b) => dist(a[0], a[1]) - dist(b[0], b[1]));
    return sorted.slice(0, maxOptions);
  }

  teleportToCell(playerIndex: number, destX: number, destY: number): boolean {
    const p = this.players[playerIndex];
    if (!p) return false;
    if (this.grid[destY]?.[destX] !== MAGIC) return false;
    if (destX === p.x && destY === p.y) return false;
    p.x = destX;
    p.y = destY;
    return true;
  }

  /** Catapult: launch player in direction (dx,dy) until hitting wall. Returns landing coords or null if invalid. */
  catapultLaunch(playerIndex: number, dx: number, dy: number): { destX: number; destY: number } | null {
    const p = this.players[playerIndex];
    if (!p) return null;
    const ndx = Math.sign(dx);
    const ndy = Math.sign(dy);
    if (ndx === 0 && ndy === 0) return null;
    let x = p.x;
    let y = p.y;
    let lastPath: { x: number; y: number } | null = null;
    while (true) {
      const nx = x + ndx;
      const ny = y + ndy;
      if (nx < 0 || nx >= this.width || ny < 0 || ny >= this.height) break;
      if (this.grid[ny][nx] === WALL) break;
      x = nx;
      y = ny;
      lastPath = { x, y };
    }
    if (!lastPath || (lastPath.x === p.x && lastPath.y === p.y)) return null;
    p.x = lastPath.x;
    p.y = lastPath.y;
    return { destX: lastPath.x, destY: lastPath.y };
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

export const SIZE_OPTIONS = [10, 25, 30, 40] as const;
export const DIFFICULTY_OPTIONS = [1, 2, 3, 4] as const;

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
