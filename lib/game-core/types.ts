/**
 * Core types for game logic (engine-agnostic, no Phaser).
 * See docs/IMPLEMENTATION_PLAN.md for full spec.
 */

export type EntityId = string;

export interface Position {
  x: number;
  y: number;
}

export type TileType =
  | "floor"
  | "wall"
  | "trap"
  | "web"
  | "artifact"
  | "exit"
  | "holy"
  | "spawn";

export interface TileState {
  x: number;
  y: number;
  type: TileType;
  blocksMovement: boolean;
  blocksLineOfSight: boolean;
  movementCost: number;
  hazard?: {
    id: string;
    damage?: number;
    stopMovement?: boolean;
    slow?: boolean;
  };
}

export type PlayerStatus =
  | { type: "slowed"; turns: number; mpPenalty: number }
  | { type: "markedByDracula"; turns: number }
  | { type: "shielded"; turns: number }
  | { type: "webbed"; turns: number; extraMoveCost: number };

export interface PlayerState extends Position {
  id: EntityId;
  hp: number;
  attackBonus: number;
  artifacts: number;
  statuses: PlayerStatus[];
}

export type MonsterStatus =
  | { type: "stunned"; ticks: number }
  | { type: "weakened"; ticks: number }
  | { type: "revealed"; ticks: number };

export interface MonsterCombatState {
  hp: number;
  defense: number;
  damage: number;
  specialOnHit?: string;
  specialOnDefeat?: string;
}

export type DraculaState =
  | "idle"
  | "patrol"
  | "hunt"
  | "telegraphTeleport"
  | "teleport"
  | "telegraphAttack"
  | "attack"
  | "recover"
  | "banished";

export interface DraculaStateData extends Position {
  id: EntityId;
  hp: number;
  defense: number;
  damage: number;
  vision: number;
  teleportRange: number;
  cooldowns: { teleport: number; attack: number };
  state: DraculaState;
  targetPlayerId: EntityId | null;
  maxHp: number;
  /** Optional patrol route for idle/patrol */
  patrolArea?: [number, number][];
  /** Banish timer (ticks remaining) */
  banishTicks?: number;
}

export interface TelegraphState {
  type: "attack" | "teleport";
  targetX: number;
  targetY: number;
  expiresAt: number;
}

export interface CombatResult {
  success: boolean;
  damageToPlayer: number;
  damageToMonster: number;
  monsterDefeated: boolean;
  playerDefeated: boolean;
  statusApplied?: PlayerStatus | MonsterStatus;
  log: string[];
}

export interface MoveResult {
  allowed: boolean;
  spentMP: number;
  triggeredCombat: boolean;
  triggeredTileEffect: boolean;
  endTurn: boolean;
  log: string[];
}

export interface TileEffectResult {
  damage?: number;
  stopMovement?: boolean;
  slow?: boolean;
  collectedArtifact?: boolean;
  log: string[];
}
