import { updateDracula as updateDraculaAI } from "./draculaAI";

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

/** Trap cell types (H is shield, so harm uses !) */
export const TRAP_LOSE_TURN = "T";
export const TRAP_HARM = "!";
export const TRAP_TELEPORT = "P";
export const TRAP_SLOW = "Q"; // Q for slow (S conflicts with Start display)

/** Artifact cell types (A1–A8) */
export const ARTIFACT_DICE = "A1";
export const ARTIFACT_SHIELD = "A2";
export const ARTIFACT_TELEPORT = "A3";
export const ARTIFACT_REVEAL = "A4";
export const ARTIFACT_HEALING = "A5";
export const ARTIFACT_TORCH = "A6";
export const ARTIFACT_HOLY_SWORD = "A7";
export const ARTIFACT_HOLY_CROSS = "A8";

export const MAX_ROUNDS = 15;
export const DEFAULT_PLAYER_HP = 5;

/** Clickable stored artifacts (inventory); order used in UI lists and “lose one” priority. */
export type StoredArtifactKind =
  | "dice"
  | "shield"
  | "teleport"
  | "reveal"
  | "healing"
  | "torch"
  | "holySword"
  | "holyCross";

export const STORED_ARTIFACT_ORDER: StoredArtifactKind[] = [
  "dice",
  "shield",
  "teleport",
  "reveal",
  "healing",
  "torch",
  "holySword",
  "holyCross",
];

/** Short name — matches Diamonds / Bombs sidebar rows (`Name: n`). */
export const STORED_ARTIFACT_TITLE: Record<StoredArtifactKind, string> = {
  dice: "Dice",
  shield: "Shield",
  teleport: "Teleport",
  reveal: "Reveal",
  healing: "Heal",
  torch: "Torch",
  holySword: "Holy sword",
  holyCross: "Holy cross",
};

/** One-line entry for `artifactsCollected` / logs (same wording everywhere). */
export const STORED_ARTIFACT_LINE: Record<StoredArtifactKind, string> = {
  dice: "Dice — roll d6 on map (+moves); in combat +1 attack roll",
  shield: "Shield — +1 block charge (combat)",
  teleport: "Teleport — map only (after combat)",
  reveal: "Reveal — hidden cells (map only)",
  healing: "Healing — +1 HP (map only)",
  torch: "Torch — clears fog (map only)",
  holySword: "Holy sword — same as dice: map roll for moves / combat +1 attack roll",
  holyCross: "Holy cross — same as shield: +1 shield charge",
};

export const STORED_ARTIFACT_TOOLTIP: Record<StoredArtifactKind, string> = {
  dice: "Spend on map: roll d6 and add that many moves to your current pool. In combat: +1 to your next attack roll.",
  shield: "Spend: +1 shield charge. In combat, toggle the shield slot to block a hit.",
  teleport: "Spend: open teleport picker. Only on the map, not during combat.",
  reveal: "Spend: reveal a batch of hidden cells. Only on the map, not during combat.",
  healing: "Spend: restore 1 HP if below max. Only on the map, not during combat.",
  torch: "Spend on map: light torch and clear fog zones. Not usable during combat.",
  holySword: "Spend: same as dice — map: roll d6 for bonus moves; combat: +1 to your next attack roll.",
  holyCross: "Spend: same as shield artifact — +1 shield charge (combat block).",
};

export function storedArtifactKindFromCell(cell: string): StoredArtifactKind | null {
  if (cell === ARTIFACT_DICE) return "dice";
  if (cell === ARTIFACT_SHIELD) return "shield";
  if (cell === ARTIFACT_TELEPORT) return "teleport";
  if (cell === ARTIFACT_REVEAL) return "reveal";
  if (cell === ARTIFACT_HEALING) return "healing";
  if (cell === ARTIFACT_TORCH) return "torch";
  if (cell === ARTIFACT_HOLY_SWORD) return "holySword";
  if (cell === ARTIFACT_HOLY_CROSS) return "holyCross";
  return null;
}

/** Upper bound on how many cells `revealHiddenCells` would reveal (same formula, no mutation). */
export function peekRevealBatchSize(lab: { hiddenCells: Map<unknown, unknown>; numPlayers: number }, totalDiamonds: number): number {
  const perTrigger = 2 * Math.max(1, lab.numPlayers);
  const totalAllowed = Math.max(0, totalDiamonds * 2);
  return Math.min(lab.hiddenCells.size, perTrigger, totalAllowed);
}

/** True if this kind is only meant for the maze phase, not inside the combat modal. */
export function isStoredArtifactMapOnly(kind: StoredArtifactKind): boolean {
  return kind === "teleport" || kind === "reveal" || kind === "healing" || kind === "torch";
}

/** One stored artifact per player at maze start — shows under combat "Skills & Artifacts" (cycles by seat). */
export function getDefaultStarterArtifacts(playerIndex: number): {
  artifacts: number;
  artifactsCollected: string[];
  artifactDice: number;
  artifactShield: number;
  artifactTeleport: number;
  artifactReveal: number;
  artifactHealing: number;
  artifactTorch: number;
  artifactHolySword: number;
  artifactHolyCross: number;
} {
  const base = {
    artifacts: 1,
    artifactsCollected: [] as string[],
    artifactDice: 0,
    artifactShield: 0,
    artifactTeleport: 0,
    artifactReveal: 0,
    artifactHealing: 0,
    artifactTorch: 0,
    artifactHolySword: 0,
    artifactHolyCross: 0,
  };
  switch (playerIndex % 8) {
    case 0:
      return {
        ...base,
        artifactDice: 1,
        artifactsCollected: [STORED_ARTIFACT_LINE.dice],
      };
    case 1:
      return {
        ...base,
        artifactShield: 1,
        artifactsCollected: [STORED_ARTIFACT_LINE.shield],
      };
    case 2:
      return {
        ...base,
        artifactHealing: 1,
        artifactsCollected: [STORED_ARTIFACT_LINE.healing],
      };
    case 3:
      return {
        ...base,
        artifactTeleport: 1,
        artifactsCollected: [STORED_ARTIFACT_LINE.teleport],
      };
    case 4:
      return {
        ...base,
        artifactReveal: 1,
        artifactsCollected: [STORED_ARTIFACT_LINE.reveal],
      };
    case 5:
      return {
        ...base,
        artifactTorch: 1,
        artifactsCollected: [STORED_ARTIFACT_LINE.torch],
      };
    case 6:
      return {
        ...base,
        artifactHolySword: 1,
        artifactsCollected: [STORED_ARTIFACT_LINE.holySword],
      };
    case 7:
      return {
        ...base,
        artifactHolyCross: 1,
        artifactsCollected: [STORED_ARTIFACT_LINE.holyCross],
      };
    default:
      return { ...base, artifactDice: 1, artifactsCollected: [STORED_ARTIFACT_LINE.dice] };
  }
}

export type MonsterType = "V" | "Z" | "S" | "G" | "K" | "L"; // Vampire/Dracula, Zombie, Spider, Ghost, Skeleton, Lava Elemental

export type DraculaState =
  | "idle"
  | "hunt"
  | "telegraphTeleport"
  | "teleport"
  | "telegraphAttack"
  | "attack"
  | "recover";

export const DRACULA_CONFIG = {
  hp: 3,
  defense: 5,
  damage: 1,
  vision: 4,
  moveSpeed: 1,
  teleportRange: 3,
  teleportCooldown: 3,
  attackCooldown: 1,
  teleportTelegraphMs: 800,
  attackTelegraphMs: 600,
} as const;

export interface Monster {
  x: number;
  y: number;
  type: MonsterType;
  patrolArea: [number, number][];
  visionRadius?: number;
  attack?: number;
  defense?: number;
  spawnX?: number;
  spawnY?: number;
  /** Skeleton only: first hit removes shield, second kills */
  hasShield?: boolean;
  /** Current HP in combat (all monsters; max from getMonsterMaxHp) */
  hp?: number;
  /** Dracula only: state machine */
  draculaState?: DraculaState;
  /** Dracula only: cooldowns in ticks */
  draculaStateTimer?: number;
  draculaCooldowns?: { teleport: number; attack: number };
  targetPlayerIndex?: number | null;
}

export function isMonsterType(type: string): type is MonsterType {
  return type === "V" || type === "Z" || type === "S" || type === "G" || type === "K" || type === "L";
}

export function getMonsterName(type: MonsterType): string {
  return type === "V" ? "Dracula" : type === "Z" ? "Zombie" : type === "S" ? "Spider" : type === "G" ? "Ghost" : type === "L" ? "Lava Elemental" : "Skeleton";
}

export function getMonsterDefense(type: MonsterType): number {
  return type === "V" ? 5 : type === "Z" || type === "K" ? 4 : type === "L" ? 6 : 3; // Spider, Ghost = 3; Lava = 6 (+ surprise mod in combat)
}

export function getMonsterDamage(type: MonsterType): number {
  return type === "Z" || type === "L" ? 2 : 1; // Zombie, Lava = 2; Dracula, Ghost, Skeleton, Spider = 1
}

/** Max HP for every monster. Each hit that meets defense −1 HP. */
export const MONSTER_HP_MAX = 5;

export function getMonsterMaxHp(_type: MonsterType): number {
  return MONSTER_HP_MAX;
}

/** Min/max damage for variable monster attacks. Returns [min, max] inclusive. */
export function getMonsterDamageRange(type: MonsterType): [number, number] {
  const base = getMonsterDamage(type);
  return [base, base + 1]; // e.g. 1→1-2, 2→2-3
}

export function isTrapCell(cell: string): boolean {
  return cell === TRAP_LOSE_TURN || cell === TRAP_HARM || cell === TRAP_TELEPORT || cell === TRAP_SLOW;
}

export function isArtifactCell(cell: string): boolean {
  return (
    cell === ARTIFACT_DICE ||
    cell === ARTIFACT_SHIELD ||
    cell === ARTIFACT_TELEPORT ||
    cell === ARTIFACT_REVEAL ||
    cell === ARTIFACT_HEALING ||
    cell === ARTIFACT_TORCH ||
    cell === ARTIFACT_HOLY_SWORD ||
    cell === ARTIFACT_HOLY_CROSS
  );
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
  players: Array<{
    x: number;
    y: number;
    jumps: number;
    diamonds: number;
    shield: number;
    bombs: number;
    hp: number;
    artifacts: number;
    artifactsCollected?: string[];
    /** Stored artifacts (click to use, like bombs) */
    artifactDice?: number;
    artifactShield?: number;
    artifactTeleport?: number;
    artifactReveal?: number;
    artifactHealing?: number;
    artifactTorch?: number;
    artifactHolySword?: number;
    artifactHolyCross?: number;
    diceBonus?: number; // +1 to next roll from A1
    attackBonus?: number; // +1 attack from defeating Dracula
    catapultCharges?: number; // bonus from monster defeat - launch without standing on C cell
    hasTeleportArtifact?: boolean; // A3
    hasTorch?: boolean; // from hidden gem - clears fog zones
    loseNextMove?: boolean; // Zombie won: lose 1 movement next turn
  }>;
  goalX: number;
  goalY: number;
  monsters: Monster[] = [];
  eliminatedPlayers: Set<number> = new Set();
  round: number = 0;
  currentRound: number = 0;
  /** Hidden cells revealed when players collect diamonds. Key: "x,y", Value: cell type (M, J, 2, 3, 4, H) */
  hiddenCells: Map<string, string> = new Map();
  /** Spider web decoration positions [x,y] for visual effect */
  webPositions: [number, number][] = [];
  /** Fog/darkness zones: key "x,y" -> intensity 0-1 (1=center/darkest, 0=edge). Expanded areas around centers. */
  fogZones: Map<string, number> = new Map();
  /** Bomb cells collected by player: key "x,y" -> Set of player indices who collected from that cell */
  bombCollectedBy: Map<string, Set<number>> = new Map();
  /** Magic cells used for teleport by player: key "x,y" -> Set of player indices who teleported from that cell */
  teleportUsedFrom: Map<string, Set<number>> = new Map();
  /** Magic cells teleported TO by player, plus departure cells after a teleport: key "x,y" -> Set (blocks reusing that tile as destination; also blocks opening portal from that tile while standing on it) */
  teleportUsedTo: Map<string, Set<number>> = new Map();
  /** Catapult cells used by player: key "x,y" -> Set of player indices (one use per player per cell) */
  catapultUsedFrom: Map<string, Set<number>> = new Map();
  /** Cells any player has ever visited - fog clears in these areas */
  visitedCells: Set<string> = new Set();

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
    const spawns = this._getCornerSpawns();
    this.players = Array.from({ length: numPlayers }, (_, i) => ({
      x: spawns[i]?.[0] ?? 0,
      y: spawns[i]?.[1] ?? 0,
      jumps: 0,
      diamonds: 0,
      shield: 0,
      bombs: 0,
      hp: DEFAULT_PLAYER_HP,
      diceBonus: 0,
      catapultCharges: 0,
      hasTeleportArtifact: false,
      hasTorch: false,
      ...getDefaultStarterArtifacts(i),
    }));
    this.goalX = width - 1;
    this.goalY = height - 1;
  }

  /** Get spawn positions for players: all start at (0,0). */
  private _getCornerSpawns(): [number, number][] {
    return Array.from({ length: this.numPlayers }, () => [0, 0]);
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

    // Inverse difficulty: easy = more helpers, hard = fewer helpers. Traps/obstacles scale up with difficulty.
    const d = this.monsterDensity; // 1=easy, 4=extreme
    const helperMult = Math.max(0.2, 1.1 - 0.22 * d); // easy 0.88, normal 0.66, hard 0.44, extreme 0.2
    const trapMult = 0.6 + 0.25 * d;  // easy 0.85, normal 1.1, hard 1.35, extreme 1.6
    const obstacleMult = 0.7 + 0.2 * d; // webs, fog: more for harder

    const mults: ("2" | "3" | "4")[] = ["2", "3", "4"];
    const multCount = Math.round(Math.max(2, Math.min(12, Math.floor(pathCells.length * 0.08 * helperMult))));
    /** Teleport targets are “nearest magic” only — need enough M tiles that rings of options exist */
    const magicCount = Math.round(Math.max(3, Math.min(18, Math.floor(pathCells.length * 0.075 * helperMult))));
    const catapultCount = Math.round(Math.max(1, Math.min(10, Math.floor(pathCells.length * 0.04 * helperMult))));
    const jumpCount = Math.round(Math.max(1, Math.min(8, Math.floor(pathCells.length * 0.035 * helperMult))));
    const diamondCount = Math.round(Math.max(this.numPlayers * 2, Math.min(this.numPlayers * 6, Math.floor(pathCells.length * 0.1 * helperMult))));
    const blocks10x10 = (this.width / 10) * (this.height / 10);
    const bombCount = Math.round(Math.max(1, Math.min(14, Math.floor(blocks10x10 * 1.2 * helperMult))));
    const trapCount = Math.round(Math.max(1, Math.min(10, Math.floor(pathCells.length * 0.03 * trapMult))));
    const minArtifacts = this.numPlayers * 3; // each player needs 3 to win
    const artifactCount = Math.round(Math.max(minArtifacts, Math.min(minArtifacts + 6, Math.floor(12 * helperMult))));
    const hiddenCount = Math.round(Math.max(2, Math.min(12, Math.floor(pathCells.length * 0.05 * helperMult))));
    // Fog as % of path cells: easy 20%, extreme 100%
    const fogPercent = Math.min(1, 0.2 + (0.8 * (this.monsterDensity - 1)) / 3);
    const targetFogCells = Math.floor(pathCells.length * fogPercent);
    const cellsPerFogZone = 20; // approximate path cells per fog zone (radius 3)
    const fogCount = Math.max(2, Math.min(15, Math.ceil(targetFogCells / cellsPerFogZone)));

    const total = multCount + magicCount + catapultCount + jumpCount + diamondCount + bombCount
      + trapCount + artifactCount + hiddenCount + fogCount;
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
    const rest3c = rest3b.filter((c) => !bombCells.some((b) => b[0] === c[0] && b[1] === c[1]));
    const trapCells = this._pickSpread(rest3c, trapCount);
    const trapTypes = [TRAP_LOSE_TURN, TRAP_HARM, TRAP_TELEPORT, TRAP_SLOW];
    for (let i = 0; i < trapCells.length; i++) {
      const [x, y] = trapCells[i];
      this.grid[y][x] = trapTypes[i % 4];
    }
    const rest3d = rest3c.filter((c) => !trapCells.some((t) => t[0] === c[0] && t[1] === c[1]));
    const artifactCells = this._pickSpread(rest3d, Math.min(artifactCount, rest3d.length));
    const artifactTypes = [
      ARTIFACT_DICE,
      ARTIFACT_SHIELD,
      ARTIFACT_TELEPORT,
      ARTIFACT_REVEAL,
      ARTIFACT_HEALING,
      ARTIFACT_TORCH,
      ARTIFACT_HOLY_SWORD,
      ARTIFACT_HOLY_CROSS,
    ];
    for (let i = 0; i < artifactCells.length; i++) {
      const [x, y] = artifactCells[i];
      this.grid[y][x] = artifactTypes[i % artifactTypes.length];
    }

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
    const rest4 = rest3d.filter((c) => !artifactCells.some((a) => a[0] === c[0] && a[1] === c[1]));
    const hiddenCellCoords = this._pickSpread(rest4, hiddenCount);
    const hiddenTypes: string[] = [MAGIC, MAGIC, CATAPULT, CATAPULT, JUMP, JUMP, MULT_X2, MULT_X3, SHIELD, SHIELD];
    for (let i = 0; i < hiddenCellCoords.length; i++) {
      const [x, y] = hiddenCellCoords[i];
      this.hiddenCells.set(`${x},${y}`, hiddenTypes[i % hiddenTypes.length]);
      // Grid stays PATH until revealed
    }
    // Fog/darkness zones: expand areas around center cells, intensity falls off with distance (0=transparent, 1=opaque)
    const rest5 = rest4.filter((c) => !hiddenCellCoords.some((h) => h[0] === c[0] && h[1] === c[1]));
    const fogCells = this._pickSpread(rest5.length > 0 ? rest5 : rest4, fogCount);
    const FOG_RADIUS = 3; // cells from center; larger area per fog zone
    for (const [cx, cy] of fogCells) {
      for (let dy = -FOG_RADIUS; dy <= FOG_RADIUS; dy++) {
        for (let dx = -FOG_RADIUS; dx <= FOG_RADIUS; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || x >= this.width || y < 0 || y >= this.height) continue;
          if (!isWalkable(this.grid[y][x])) continue;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const intensity = Math.max(0, 1 - dist / (FOG_RADIUS + 0.5));
          const key = `${x},${y}`;
          const existing = this.fogZones.get(key) ?? 0;
          this.fogZones.set(key, Math.max(existing, intensity));
        }
      }
    }
    const spawnPositions = this._getCornerSpawns();
    const excludeFromMonsters: [number, number][] = [
      ...multCells,
      ...magicCells,
      ...catapultCells,
      ...jumpCells,
      ...diamondCells,
      ...bombCells,
      ...trapCells,
      ...artifactCells,
      ...hiddenCellCoords,
      ...spawnPositions,
    ];
    this._addMonsters(excludeFromMonsters);
    this._addSpiderWebs(rest4.length > 0 ? rest4 : rest3b);
  }

  private _addSpiderWebs(pathCells: [number, number][]): void {
    const obstacleMult = 0.7 + 0.2 * this.monsterDensity;
    const webCount = Math.round(Math.max(2, Math.min(18, Math.floor(pathCells.length * 0.04 * obstacleMult))));
    const shuffled = shuffle([...pathCells]);
    for (let i = 0; i < webCount && i < shuffled.length; i++) {
      this.webPositions.push(shuffled[i]);
    }
  }

  /** Reveal hidden cells progressively: each trigger reveals at most (2 * numPlayers) cells. Prevents revealing all cells on a single collection. totalDiamonds ensures we never reveal more than earned. Returns number revealed. */
  revealHiddenCells(totalDiamonds: number): number {
    const perTrigger = 2 * Math.max(1, this.numPlayers);
    const totalAllowed = Math.max(0, totalDiamonds * 2);
    const toReveal = Math.min(this.hiddenCells.size, perTrigger, totalAllowed);
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
    const types: MonsterType[] = ["V", "L", "Z", "S", "G", "K"]; // rotation for procedurally placed monsters (start neighbor is Skeleton at (1,0))
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
    const blocks10x10 = (this.width / 10) * (this.height / 10);
    const targetFromDifficulty = Math.round(blocks10x10 * this.monsterDensity);
    const targetMonsters = Math.min(intersections.length, Math.max(1, targetFromDifficulty));
    const isSmallMap = this.width * this.height <= 400;
    const baseDist = this.monsterDensity >= 4 ? 2 : this.monsterDensity >= 3 ? 3 : 4;
    const MIN_MONSTER_DIST = isSmallMap ? Math.max(1, baseDist - 1) : baseDist;
    const MONSTER_EXCLUDE_RADIUS = 3;
    const nearStart = (ax: number, ay: number) => Math.abs(ax) + Math.abs(ay) <= MONSTER_EXCLUDE_RADIUS;
    const nearGoal = (ax: number, ay: number) => Math.abs(ax - this.goalX) + Math.abs(ay - this.goalY) <= MONSTER_EXCLUDE_RADIUS;
    const magicCells = this.getMagicCellPositions();
    const nearMagic = (ax: number, ay: number) => magicCells.some(([mx, my]) => Math.abs(ax - mx) + Math.abs(ay - my) <= MONSTER_EXCLUDE_RADIUS);
    const chosen: [number, number][] = [];
    for (const [x, y] of intersections) {
      if (this.monsters.length >= targetMonsters) break;
      if (nearStart(x, y) || nearGoal(x, y) || nearMagic(x, y)) continue;
      const farEnough = chosen.every(([cx, cy]) => Math.abs(x - cx) + Math.abs(y - cy) >= MIN_MONSTER_DIST);
      if (farEnough) {
        const patrolArea = this._getPatrolArea(x, y, 28);
        if (patrolArea.length >= 2) {
          chosen.push([x, y]);
          const mType = types[(this.monsters.length) % 6];
          const m: Monster = {
            x, y,
            type: mType,
            patrolArea,
            visionRadius: mType === "V" ? DRACULA_CONFIG.vision : 3,
            spawnX: x,
            spawnY: y,
            hasShield: mType === "K",
            hp: getMonsterMaxHp(mType),
          };
          if (mType === "V") {
            m.draculaState = "idle";
            m.draculaCooldowns = { teleport: 0, attack: 0 };
            m.targetPlayerIndex = null;
          }
          this.monsters.push(m);
        }
      }
    }
  }

  /** Move monsters using vision/chase/attack AI. Only targets activePlayerIndex (whose turn it is). */
  moveMonsters(activePlayerIndex: number, scheduleDracula?: (monsterIndex: number, action: "teleport" | "attack", delayMs: number) => void): void {
    for (let mi = 0; mi < this.monsters.length; mi++) {
      const m = this.monsters[mi];
      if (m.type === "V") {
        if (m.draculaState === "telegraphTeleport" || m.draculaState === "telegraphAttack") {
          continue;
        }
        const result = updateDraculaAI(
          m,
          this.players,
          this.eliminatedPlayers,
          this.grid,
          this.width,
          this.height,
          activePlayerIndex
        );
        if (result.scheduledAction && scheduleDracula) {
          scheduleDracula(mi, result.scheduledAction.type, result.scheduledAction.delayMs);
        }
      } else {
        const [nx, ny] = this._getMonsterNextPosition(m, activePlayerIndex);
        m.x = nx;
        m.y = ny;
      }
    }
  }

  private _getMonsterNextPosition(m: Monster, activePlayerIndex: number): [number, number] {
    const canPhase = m.type === "G";
    const vision = m.visionRadius ?? 3;
    const nearest = this._findNearestPlayer(m, activePlayerIndex);
    if (nearest) {
      const { dist: d } = nearest;
      if (d <= 1) {
        const p = this.players[nearest.playerIndex];
        if (p) return [p.x, p.y];
      }
      if (d <= vision) {
        const next = this._pathfindToward(m.x, m.y, this.players[nearest.playerIndex].x, this.players[nearest.playerIndex].y, canPhase);
        if (next) return next;
      }
    }
    const adjacent: [number, number][] = [];
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nx = m.x + dx;
      const ny = m.y + dy;
      if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
        if (canPhase || isWalkable(this.grid[ny][nx])) adjacent.push([nx, ny]);
      }
    }
    if (adjacent.length === 0) return [m.x, m.y];
    return adjacent[Math.floor(Math.random() * adjacent.length)];
  }

  private _manhattanDist(x1: number, y1: number, x2: number, y2: number): number {
    return Math.abs(x1 - x2) + Math.abs(y1 - y2);
  }

  private _findNearestPlayer(m: Monster, activePlayerIndex: number): { playerIndex: number; dist: number } | null {
    if (this.eliminatedPlayers.has(activePlayerIndex)) return null;
    const p = this.players[activePlayerIndex];
    if (!p) return null;
    const d = this._manhattanDist(m.x, m.y, p.x, p.y);
    return { playerIndex: activePlayerIndex, dist: d };
  }

  private _pathfindToward(fromX: number, fromY: number, toX: number, toY: number, canPhase: boolean): [number, number] | null {
    const adjacent: [number, number][] = [];
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nx = fromX + dx;
      const ny = fromY + dy;
      if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
        if (canPhase || isWalkable(this.grid[ny][nx])) adjacent.push([nx, ny]);
      }
    }
    if (adjacent.length === 0) return null;
    let best = adjacent[0];
    let bestD = this._manhattanDist(best[0], best[1], toX, toY);
    for (const n of adjacent) {
      const d = this._manhattanDist(n[0], n[1], toX, toY);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }

  /** Check monster collision. Pass activePlayerIndex to only check the player whose turn it is (inactive players are protected). Returns monsterIndex for reliable removal after combat. */
  checkMonsterCollision(activePlayerIndex?: number): { playerIndex: number; monsterType: MonsterType; monsterIndex: number } | null {
    const indices = activePlayerIndex !== undefined ? [activePlayerIndex] : Array.from({ length: this.players.length }, (_, i) => i);
    for (let mi = 0; mi < this.monsters.length; mi++) {
      const m = this.monsters[mi];
      for (const i of indices) {
        if (this.eliminatedPlayers.has(i)) continue;
        const p = this.players[i];
        if (p && p.x === m.x && p.y === m.y) {
          return { playerIndex: i, monsterType: m.type, monsterIndex: mi };
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

  /** Use bomb at player position: explode 3x3 area, kill monsters (except Dracula & Ghost), destroy walls, clear traps. Returns true if used. */
  useBomb(playerIndex: number): { used: boolean; monstersKilled: number; wallsDestroyed: number; trapsCleared: number } {
    const p = this.players[playerIndex];
    if (!p || (p.bombs ?? 0) <= 0) return { used: false, monstersKilled: 0, wallsDestroyed: 0, trapsCleared: 0 };
    const cx = p.x;
    const cy = p.y;
    const inBlast = (mx: number, my: number) => Math.abs(mx - cx) <= 1 && Math.abs(my - cy) <= 1;
    const bombImmune = (m: Monster) => m.type === "V" || m.type === "G"; // Dracula & Ghost survive bombs
    const toKill = this.monsters.filter((m) => inBlast(m.x, m.y) && !bombImmune(m));
    const monstersKilled = toKill.length;
    this.monsters = this.monsters.filter((m) => !inBlast(m.x, m.y) || bombImmune(m));
    let wallsDestroyed = 0;
    let trapsCleared = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || nx >= this.width || ny < 0 || ny >= this.height) continue;
        const cell = this.grid[ny][nx];
        if (cell === WALL) {
          this.grid[ny][nx] = PATH;
          wallsDestroyed++;
        } else if (isTrapCell(cell)) {
          this.grid[ny][nx] = PATH;
          trapsCleared++;
        }
      }
    }
    // Remove spider webs in blast zone
    if (this.webPositions.length > 0) {
      this.webPositions = this.webPositions.filter(([wx, wy]) => !inBlast(wx, wy));
    }
    p.bombs = (p.bombs ?? 0) - 1;
    return { used: true, monstersKilled, wallsDestroyed, trapsCleared };
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
    this.round = 0;
    this.currentRound = 0;
    this._initGrid();
    this._carvePath(1, 1);
    this._ensureGoalReachable();
    this._addExtraPaths();
    this._addSpecialCells();
    // Ensure all corner/edge spawn cells are path
    this.grid[0][0] = PATH;
    this.grid[this.height - 1][this.width - 1] = PATH;
    if (this.height > 1) this.grid[1][0] = PATH;
    if (this.width > 1) this.grid[0][1] = PATH;
    if (this.height > 1) this.grid[this.height - 2][this.width - 1] = PATH;
    if (this.width > 1) this.grid[this.height - 1][this.width - 2] = PATH;
    if (this.width > 1) this.grid[0][this.width - 1] = PATH;
    if (this.height > 1) this.grid[this.height - 1][0] = PATH;
    // Reset player positions to spawns
    const spawns = this._getCornerSpawns();
    this.players = this.players.map((p, i) => ({
      ...p,
      x: spawns[i]?.[0] ?? p.x,
      y: spawns[i]?.[1] ?? p.y,
      hp: DEFAULT_PLAYER_HP,
      diceBonus: 0,
      catapultCharges: 0,
      hasTeleportArtifact: false,
      hasTorch: false,
      ...getDefaultStarterArtifacts(i),
    }));
    this.visitedCells = new Set();
    for (const [sx, sy] of spawns) this.recordVisited(sx ?? 0, sy ?? 0);

    // Skeleton at (1,0) adjacent to start — triggers combat as soon as player moves toward it
    if (this.width > 1 && isWalkable(this.grid[0][1])) {
      const patrolArea = this._getPatrolArea(1, 0, 28);
      if (patrolArea.length >= 2) {
        this.monsters.unshift({
          x: 1,
          y: 0,
          type: "K",
          patrolArea,
          visionRadius: 3,
          spawnX: 1,
          spawnY: 0,
          hp: getMonsterMaxHp("K"),
          hasShield: true,
        });
      }
    }
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
    if (this.width > 1) this.grid[0][this.width - 1] = PATH;
    if (this.height > 1) this.grid[this.height - 1][0] = PATH;
    const spawns = this._getCornerSpawns();
    this.players = Array.from({ length: this.numPlayers }, (_, i) => ({
      x: spawns[i]?.[0] ?? 0,
      y: spawns[i]?.[1] ?? 0,
      jumps: 0,
      diamonds: 0,
      shield: 0,
      bombs: 0,
      hp: DEFAULT_PLAYER_HP,
      diceBonus: 0,
      catapultCharges: 0,
      hasTeleportArtifact: false,
      hasTorch: false,
      ...getDefaultStarterArtifacts(i),
    }));
    this.monsters = [];
    this.eliminatedPlayers = new Set();
    this.hiddenCells = new Map();
    this.webPositions = [];
    this.fogZones = new Map();
    this.bombCollectedBy = new Map();
    this.teleportUsedFrom = new Map();
    this.teleportUsedTo = new Map();
    this.catapultUsedFrom = new Map();
    this.visitedCells = new Set();
    for (const [sx, sy] of spawns) this.recordVisited(sx ?? 0, sy ?? 0);
    this._addMonsters([]);
    // Skeleton at (1,0) adjacent to start — triggers combat as soon as player moves toward it
    if (this.width > 1 && isWalkable(this.grid[0][1])) {
      const patrolArea = this._getPatrolArea(1, 0, 28);
      if (patrolArea.length >= 2) {
        this.monsters.unshift({
          x: 1,
          y: 0,
          type: "K",
          patrolArea,
          visionRadius: 3,
          spawnX: 1,
          spawnY: 0,
          hp: getMonsterMaxHp("K"),
          hasShield: true,
        });
      }
    }
    // Add hidden cells and spider webs from path cells for AI-loaded mazes
    const pathCells: [number, number][] = [];
    for (let y = 1; y < this.height - 1; y++)
      for (let x = 1; x < this.width - 1; x++)
        if (this.grid[y][x] === PATH && (x !== this.goalX || y !== this.goalY) &&
            !["M", "J", "2", "3", "4", "H", "B"].includes(this.grid[y][x]))
          pathCells.push([x, y]);
    const totalPathCells = pathCells.length;
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
    // Fog as % of total path cells by difficulty (monsterDensity: 1–4): easy 20%, extreme 100%
    const fogPercent = Math.min(1, 0.2 + (0.8 * (this.monsterDensity - 1)) / 3);
    const targetFogCells = Math.floor(totalPathCells * fogPercent);
    const cellsPerFogZone = 20;
    const fogCount = Math.max(2, Math.min(15, Math.ceil(targetFogCells / cellsPerFogZone)));
    const FOG_RADIUS = 3;
    for (let i = 0; i < fogCount && pathCells.length > 0; i++) {
      const idx = Math.floor(Math.random() * pathCells.length);
      const [cx, cy] = pathCells.splice(idx, 1)[0];
      for (let dy = -FOG_RADIUS; dy <= FOG_RADIUS; dy++) {
        for (let dx = -FOG_RADIUS; dx <= FOG_RADIUS; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || x >= this.width || y < 0 || y >= this.height) continue;
          if (!isWalkable(this.grid[y][x])) continue;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const intensity = Math.max(0, 1 - dist / (FOG_RADIUS + 0.5));
          const key = `${x},${y}`;
          const existing = this.fogZones.get(key) ?? 0;
          this.fogZones.set(key, Math.max(existing, intensity));
        }
      }
    }
    const artifactTypes = [
      ARTIFACT_DICE,
      ARTIFACT_SHIELD,
      ARTIFACT_TELEPORT,
      ARTIFACT_REVEAL,
      ARTIFACT_HEALING,
      ARTIFACT_TORCH,
      ARTIFACT_HOLY_SWORD,
      ARTIFACT_HOLY_CROSS,
    ];
    const artifactCount = Math.min(8, pathCells.length);
    for (let i = 0; i < artifactCount && pathCells.length > 0; i++) {
      const idx = Math.floor(Math.random() * pathCells.length);
      const [x, y] = pathCells.splice(idx, 1)[0];
      this.grid[y][x] = artifactTypes[i % artifactTypes.length];
    }
    return true;
  }

  /** Get effective cell type at (x,y): hidden cell if present, else grid. */
  getCellAt(x: number, y: number): string {
    const key = `${x},${y}`;
    const hidden = this.hiddenCells.get(key);
    if (hidden) return hidden;
    return this.grid[y]?.[x] ?? WALL;
  }

  /** Reveal a hidden cell at (x,y) - move from hiddenCells to grid. Returns true if revealed. */
  revealCellAt(x: number, y: number): boolean {
    const key = `${x},${y}`;
    const type = this.hiddenCells.get(key);
    if (!type || this.grid[y]?.[x] !== PATH) return false;
    this.grid[y][x] = type;
    this.hiddenCells.delete(key);
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

  /** Returns true if the player can jump over wall or trap in direction (dx, dy). */
  canJumpInDirection(dx: number, dy: number, playerIndex = 0): boolean {
    const p = this.players[playerIndex];
    if (!p || (p.jumps ?? 0) <= 0) return false;
    const nx = p.x + dx;
    const ny = p.y + dy;
    const midCell = this.grid[ny]?.[nx];
    const canJumpOver = midCell === WALL || isTrapCell(midCell);
    if (!canJumpOver) return false;
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
      this.recordVisited(nx, ny);
      return true;
    }

    // Jump over wall or trap (only when jumpOnly - user explicitly chose jump)
    if (jumpOnly && (p.jumps ?? 0) > 0) {
      const midCell = this.grid[ny]?.[nx];
      const canJumpOver = midCell === WALL || isTrapCell(midCell);
      if (canJumpOver) {
        const jx = nx + dx, jy = ny + dy;
        if (jx >= 0 && jx < this.width && jy >= 0 && jy < this.height && this.canMove(jx, jy)) {
          p.x = jx;
          p.y = jy;
          p.jumps--;
          this.recordVisited(jx, jy);
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Valid teleport destinations: MAGIC cells only among the **closest** Manhattan distance
   * (shortest hop to any allowed magic tile). Tie-break: y then x for stable ordering.
   * @param maxOptions Cap how many destinations the UI lists (random pick uses the same set).
   */
  getTeleportOptions(playerIndex = 0, maxOptions = 6, _maxDistanceLegacy?: number): [number, number][] {
    const p = this.players[playerIndex];
    if (!p) return [];
    const dist = (ax: number, ay: number) => Math.abs(ax - p.x) + Math.abs(ay - p.y);
    const candidates: [number, number][] = [];
    for (let y = 0; y < this.height; y++)
      for (let x = 0; x < this.width; x++)
        if (
          this.getCellAt(x, y) === MAGIC &&
          (x !== p.x || y !== p.y) &&
          !this.hasUsedTeleportFrom(playerIndex, x, y) &&
          !this.hasTeleportedTo(playerIndex, x, y)
        )
          candidates.push([x, y]);
    if (candidates.length === 0) return [];
    const minDist = Math.min(...candidates.map(([cx, cy]) => dist(cx, cy)));
    const closestRing = candidates.filter(([cx, cy]) => dist(cx, cy) === minDist);
    closestRing.sort((a, b) => {
      const da = dist(a[0], a[1]);
      const db = dist(b[0], b[1]);
      if (da !== db) return da - db;
      if (a[1] !== b[1]) return a[1] - b[1];
      return a[0] - b[0];
    });
    return closestRing.slice(0, maxOptions);
  }

  getRandomTeleportDestination(playerIndex: number): [number, number] | null {
    const options = this.getTeleportOptions(playerIndex, 20);
    if (options.length === 0) return null;
    return options[Math.floor(Math.random() * options.length)];
  }

  /** Get a random path cell (for trap teleport). */
  getRandomPathCell(): [number, number] | null {
    const cells: [number, number][] = [];
    for (let y = 0; y < this.height; y++)
      for (let x = 0; x < this.width; x++)
        if (isWalkable(this.grid[y][x])) cells.push([x, y]);
    if (cells.length === 0) return null;
    return cells[Math.floor(Math.random() * cells.length)];
  }

  teleportToCell(playerIndex: number, destX: number, destY: number): boolean {
    const p = this.players[playerIndex];
    if (!p) return false;
    if (this.getCellAt(destX, destY) !== MAGIC) return false;
    if (destX === p.x && destY === p.y) return false;
    p.x = destX;
    p.y = destY;
    this.recordVisited(destX, destY);
    this.recordTeleportUsedTo(playerIndex, destX, destY);
    return true;
  }

  hasTeleportedTo(playerIndex: number, x: number, y: number): boolean {
    const key = `${x},${y}`;
    return this.teleportUsedTo.get(key)?.has(playerIndex) ?? false;
  }

  recordTeleportUsedTo(playerIndex: number, x: number, y: number): void {
    const key = `${x},${y}`;
    let set = this.teleportUsedTo.get(key);
    if (!set) {
      set = new Set();
      this.teleportUsedTo.set(key, set);
    }
    set.add(playerIndex);
  }

  hasUsedCatapultFrom(playerIndex: number, x: number, y: number): boolean {
    const key = `${x},${y}`;
    return this.catapultUsedFrom.get(key)?.has(playerIndex) ?? false;
  }

  recordCatapultUsedFrom(playerIndex: number, x: number, y: number): void {
    const key = `${x},${y}`;
    let set = this.catapultUsedFrom.get(key);
    if (!set) {
      set = new Set();
      this.catapultUsedFrom.set(key, set);
    }
    set.add(playerIndex);
  }

  hasCollectedBombFrom(playerIndex: number, x: number, y: number): boolean {
    const key = `${x},${y}`;
    return this.bombCollectedBy.get(key)?.has(playerIndex) ?? false;
  }

  recordBombCollected(playerIndex: number, x: number, y: number): void {
    const key = `${x},${y}`;
    let set = this.bombCollectedBy.get(key);
    if (!set) {
      set = new Set();
      this.bombCollectedBy.set(key, set);
    }
    set.add(playerIndex);
  }

  hasUsedTeleportFrom(playerIndex: number, x: number, y: number): boolean {
    const key = `${x},${y}`;
    return this.teleportUsedFrom.get(key)?.has(playerIndex) ?? false;
  }

  recordTeleportUsedFrom(playerIndex: number, x: number, y: number): void {
    const key = `${x},${y}`;
    let set = this.teleportUsedFrom.get(key);
    if (!set) {
      set = new Set();
      this.teleportUsedFrom.set(key, set);
    }
    set.add(playerIndex);
  }

  recordVisited(x: number, y: number): void {
    this.visitedCells.add(`${x},${y}`);
  }

  /**
   * Catapult trajectory: parabolic arc. strength = drag distance in pixels.
   * useRandom: when true (launch), add random landing; when false (preview), deterministic.
   */
  getCatapultTrajectory(
    fromX: number,
    fromY: number,
    dx: number,
    dy: number,
    strength: number,
    useRandom = false
  ): { arcPoints: [number, number][]; destX: number; destY: number } | null {
    const norm = Math.sqrt(dx * dx + dy * dy);
    if (norm < 0.01) return null;
    const scaleX = dx / norm;
    const scaleY = dy / norm;
    const ndx = Math.sign(dx) || 0;
    const ndy = Math.sign(dy) || 0;
    const maxDist = Math.max(this.width, this.height) * 0.4;
    const strengthScale = 0.12;
    const baseDist = Math.min(maxDist, Math.max(2, strength * strengthScale));
    const dist = useRandom ? baseDist * (0.9 + Math.random() * 0.15) : baseDist * 0.9;
    const destXClamped = Math.max(0, Math.min(this.width - 1, Math.round(fromX + scaleX * dist)));
    const destYClamped = Math.max(0, Math.min(this.height - 1, Math.round(fromY + scaleY * dist)));
    const perp1 = [-scaleY, scaleX];
    const perp2 = [scaleY, -scaleX];
    const perp = perp1[1] < 0 ? perp1 : perp2;
    const perpX = perp[0];
    const perpY = perp[1];
    const arcHeight = dist * 0.12;
    const arcPoints: [number, number][] = [];
    const steps = 16;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = fromX + scaleX * dist * t + perpX * arcHeight * 4 * t * (1 - t);
      const y = fromY + scaleY * dist * t + perpY * arcHeight * 4 * t * (1 - t);
      arcPoints.push([x, y]);
    }
    let landX = destXClamped;
    let landY = destYClamped;
    const candidates: [number, number][] = [];
    const r = useRandom ? 4 : 2;
    for (let oy = -r; oy <= r; oy++) {
      for (let ox = -r; ox <= r; ox++) {
        const cx = destXClamped + ox;
        const cy = destYClamped + oy;
        if (cx >= 0 && cx < this.width && cy >= 0 && cy < this.height && isWalkable(this.grid[cy][cx])) {
          candidates.push([cx, cy]);
        }
      }
    }
    if (candidates.length > 0) {
      const idx = useRandom
        ? Math.floor(Math.random() * candidates.length)
        : candidates.reduce((best, c, i) => {
            const d = Math.abs(c[0] - destXClamped) ** 2 + Math.abs(c[1] - destYClamped) ** 2;
            const bestD = Math.abs(candidates[best][0] - destXClamped) ** 2 + Math.abs(candidates[best][1] - destYClamped) ** 2;
            return d < bestD ? i : best;
          }, 0);
      [landX, landY] = candidates[idx];
    } else {
      let x = fromX;
      let y = fromY;
      let lastPath: { x: number; y: number } | null = null;
      const stepSize = Math.sqrt(ndx * ndx + ndy * ndy) || 1;
      const stepCount = Math.ceil(dist / stepSize) + 2;
      for (let i = 0; i < stepCount; i++) {
        const nx = x + ndx;
        const ny = y + ndy;
        if (nx < 0 || nx >= this.width || ny < 0 || ny >= this.height) break;
        x = nx;
        y = ny;
        if (isWalkable(this.grid[y][x])) lastPath = { x, y };
      }
      if (lastPath) {
        landX = lastPath.x;
        landY = lastPath.y;
      } else {
        return null;
      }
    }
    if (landX === fromX && landY === fromY) return null;
    return { arcPoints, destX: landX, destY: landY };
  }

  /** Catapult: launch player in direction (dx,dy) with strength. Parabolic arc, random landing. */
  catapultLaunch(playerIndex: number, dx: number, dy: number, strength: number): { destX: number; destY: number } | null {
    const p = this.players[playerIndex];
    if (!p) return null;
    const traj = this.getCatapultTrajectory(p.x, p.y, dx, dy, strength, true);
    if (!traj) return null;
    p.x = traj.destX;
    p.y = traj.destY;
    this.recordVisited(traj.destX, traj.destY);
    return { destX: traj.destX, destY: traj.destY };
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

  /** Movement cost for tile at (x,y). Web = 2, TRAP_SLOW = 2, normal = 1. */
  getTileMoveCost(x: number, y: number): number {
    const cell = this.grid[y]?.[x];
    if (this.webPositions.some(([wx, wy]) => wx === x && wy === y)) return 2;
    if (cell === TRAP_SLOW) return 2;
    return 1;
  }

  /** Win condition: first player to reach the goal wins. */
  hasWon(playerIndex: number): boolean {
    return this.isGoalReached(playerIndex);
  }

  /** Round-15 tiebreaker: player closest to goal (by Manhattan distance). */
  getPlayerClosestToGoal(): number | null {
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < this.players.length; i++) {
      if (this.eliminatedPlayers.has(i)) continue;
      const p = this.players[i];
      if (!p) continue;
      const dist = Math.abs(p.x - this.goalX) + Math.abs(p.y - this.goalY);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    return best >= 0 ? best : null;
  }

  getJumpTargets(playerIndex = 0): Array<{ x: number; y: number; dx: number; dy: number }> {
    const p = this.players[playerIndex];
    if (!p || (p.jumps ?? 0) <= 0) return [];
    const targets: Array<{ x: number; y: number; dx: number; dy: number }> = [];
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nx = p.x + dx, ny = p.y + dy;
      const midCell = this.grid[ny]?.[nx];
      const canJumpOver = midCell === WALL || isTrapCell(midCell);
      if (canJumpOver) {
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
