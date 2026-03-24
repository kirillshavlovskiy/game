# Comprehensive Implementation Plan: Play & Combat Controls

**Engine:** Pure TypeScript (no Phaser involvement)  
**Design Priority:** `clarity > speed > tension > fairness > complexity`

**Maze look & lighting (stylized horror, Kenney + decals, fog/telegraphs):** see [`MAZE_VISUAL_PLAN.md`](./MAZE_VISUAL_PLAN.md).

---

## 1. Architecture Overview

### 1.1 Separation of Concerns

| Layer | Responsibility | Location |
|-------|----------------|----------|
| **Game Core** | State, rules, combat, Dracula FSM, tile effects | `lib/game-core/` |
| **Systems** | MovementSystem, CombatSystem, DraculaSystem, TileEffectSystem | `lib/game-core/systems/` |
| **Types** | Interfaces, state shapes, result objects | `lib/game-core/types.ts` |
| **Rendering** | (Future) Phaser/Canvas/React – reads state, animates | External |

The TypeScript core decides **what happens**. Any renderer decides **how it looks**.

### 1.2 File Structure (Proposed)

```
lib/
  game-core/
    types.ts           # Core interfaces, TileType, Position, etc.
    constants.ts       # MVP balancing numbers
    index.ts           # Public API
    systems/
      MovementSystem.ts
      CombatSystem.ts
      DraculaSystem.ts
      TileEffectSystem.ts
      TurnSystem.ts
    utils/
      grid.ts          # Manhattan, walkability, pathfinding helpers
```

---

## 2. Core Types (types.ts)

### 2.1 Tile & Map

```ts
type TileType =
  | "floor"
  | "wall"
  | "trap"
  | "web"
  | "artifact"
  | "exit"
  | "holy"
  | "spawn";

interface TileState {
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
```

### 2.2 Position & Entity IDs

```ts
type EntityId = string;

interface Position {
  x: number;
  y: number;
}
```

### 2.3 Player State

```ts
type PlayerStatus =
  | { type: "slowed"; turns: number; mpPenalty: number }
  | { type: "markedByDracula"; turns: number }
  | { type: "shielded"; turns: number }
  | { type: "webbed"; turns: number; extraMoveCost: number };

interface PlayerState extends Position {
  id: EntityId;
  hp: number;
  attackBonus: number;
  artifacts: number;
  statuses: PlayerStatus[];
}
```

### 2.4 Monster State

```ts
interface MonsterCombatState {
  hp: number;
  defense: number;
  damage: number;
  specialOnHit?: MonsterHitEffect;
  specialOnDefeat?: MonsterDefeatEffect;
}

type MonsterStatus =
  | { type: "stunned"; ticks: number }
  | { type: "weakened"; ticks: number }
  | { type: "revealed"; ticks: number };
```

### 2.5 Dracula State

```ts
type DraculaState =
  | "idle"
  | "patrol"
  | "hunt"
  | "telegraphTeleport"
  | "teleport"
  | "telegraphAttack"
  | "attack"
  | "recover"
  | "banished";

interface DraculaStateData extends Position {
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
}
```

### 2.6 Game State

```ts
interface GameState {
  map: TileState[][];
  players: PlayerState[];
  dracula: DraculaStateData;
  monsters: MonsterState[];
  round: number;
  currentPlayerIndex: number;
  activeTelegraphs: TelegraphState[];
}
```

### 2.7 Result Objects

```ts
interface CombatResult {
  success: boolean;
  damageToPlayer: number;
  damageToMonster: number;
  monsterDefeated: boolean;
  playerDefeated: boolean;
  statusApplied?: PlayerStatus | MonsterStatus;
  log: string[];
}

interface MoveResult {
  allowed: boolean;
  spentMP: number;
  triggeredCombat: boolean;
  triggeredTileEffect: boolean;
  endTurn: boolean;
  log: string[];
}
```

---

## 3. Play Controls (Movement & Turn Loop)

### 3.1 Turn Flow

```
start turn
  → roll dice (dice value = movement points)
  → player spends MP tile by tile
  → tile effects resolve immediately on entry
  → combat may occur (encounter = end of movement)
  → turn ends when: MP=0 | player stops | combat | trap stops movement
```

### 3.2 Dice → MP

- **Rule:** `dice value = movement points`
- Example: roll 4 → 4 MP

### 3.3 MP Spending

| Tile Type | Cost |
|-----------|------|
| floor | 1 MP |
| web | 2 MP |
| holy | 1 MP |
| trap | 1 MP + effect |

### 3.4 Walkability Check Order

1. Inside bounds?
2. Not wall?
3. Not blocked by hard object?
4. Movement cost affordable?
5. → Allowed

### 3.5 Occupancy Rules

- 0 or 1 player per tile
- 0 or 1 monster per tile
- Entering monster tile → triggers encounter
- Entering artifact tile → collect artifact
- Entering trap tile → resolve trap instantly

### 3.6 Stopping Early

- Player may stop before spending all MP
- Remaining MP are lost
- Creates tactical choice: push forward vs. stop safely

### 3.7 MovementSystem API

```ts
interface MovementSystem {
  canMoveTo(pos: Position, playerId: EntityId): boolean;
  movePlayer(playerId: EntityId, to: Position): MoveResult;
  getReachableTiles(playerId: EntityId, mp: number): Position[];
}
```

---

## 4. Combat Controls

### 4.1 Design Goal

- **One roll per encounter**
- `playerAttackRoll = d6 + playerAttackBonus + situationalModifiers`
- Compare vs `monsterDefense`
- Success → monster defeated/weakened/pushed
- Failure → player takes damage and/or status

### 4.2 Combat Flow

```
enter monster tile
  → roll 1d6 + bonus
  → compare vs defense
  → success: monster dies
  → failure: player loses HP or gets status
  → turn ends
```

### 4.3 CombatSystem API

```ts
interface CombatSystem {
  resolvePlayerVsMonster(playerId: EntityId, monsterId: EntityId): CombatResult;
  resolvePlayerVsDracula(playerId: EntityId): CombatResult;
}
```

### 4.4 Monster Combat Identities

| Monster | Defense | Damage | Special |
|---------|---------|--------|---------|
| Ghost | 3 | 1 | 50% miss/phase |
| Zombie | 4 | 2 | Slow on hit |
| Skeleton | 4 | 1 | First hit removes shield |
| Spider | 3 | 1 | Leaves web, webbed on hit |
| Dracula | 5 | 1 | 2 HP, lifesteal if artifact |

### 4.5 Dracula Boss Combat

- HP: 2
- First successful hit → weakens
- Second successful hit → banished for N ticks

---

## 5. Monster Timing Model

### 5.1 Asymmetric Loops

- **Players:** Turn-based movement turns
- **Monsters:** Asynchronous monster ticks (every 2500 ms)

### 5.2 Monster Tick

```ts
every 2500 ms → monster tick
  → reduce cooldowns
  → update monster states
  → move if allowed
  → resolve telegraphed actions if ready
  → apply attacks if valid
```

### 5.3 Telegraph Timing

| Action | Duration |
|--------|----------|
| Attack telegraph | 500–700 ms (recommend 600 ms) |
| Teleport telegraph | 700–1000 ms (recommend 800 ms) |

---

## 6. Tile Effect System

### 6.1 TileEffectSystem API

```ts
interface TileEffectSystem {
  resolveEnterTile(playerId: EntityId, pos: Position): TileEffectResult;
}
```

### 6.2 Tile Effects on Entry

- **Trap:** Resolve instantly (damage, stop, slow, teleport)
- **Artifact:** Collect
- **Web:** +1 MP cost, optional webbed status
- **Holy:** Safe zone (Dracula cannot teleport/attack)

---

## 7. Implementation Phases

### Phase 1: Map & Movement

- [ ] Map grid (11×11 MVP)
- [ ] Walkability logic
- [ ] Player turns
- [ ] Dice → MP
- [ ] Tile entry logic

### Phase 2: Combat

- [ ] Basic combat system
- [ ] Spider/Zombie/Ghost/Skeleton identities
- [ ] HP and respawn

### Phase 3: Dracula

- [ ] Dracula state machine
- [ ] Target selection
- [ ] Attack telegraph
- [ ] Teleport telegraph
- [ ] Recover state

### Phase 4: Polish

- [ ] Holy tiles
- [ ] Banish mechanic
- [ ] Artifact-aware targeting
- [ ] Corridor logic

### Phase 5: Advanced

- [ ] Pathfinding upgrade (BFS/A*)
- [ ] Fog/vision upgrade
- [ ] Balance tuning

---

## 8. MVP Balancing Numbers

### Players

| Stat | Value |
|------|-------|
| HP | 3 |
| Attack bonus | 0 |

### Dracula

| Stat | Value |
|------|-------|
| HP | 2 |
| Defense | 5 |
| Damage | 1 |
| Vision | 4 |
| Teleport range | 3 |
| Teleport cooldown | 3 ticks |
| Attack cooldown | 1 tick |
| Attack telegraph | 600 ms |
| Teleport telegraph | 800 ms |

### Other Monsters

| Monster | Defense | Damage |
|---------|---------|--------|
| Spider | 3 | 1 |
| Ghost | 3 | 1 |
| Zombie | 4 | 2 |
| Skeleton | 4 | 1 |

---

## 9. Edge Cases

| Case | Resolution |
|------|------------|
| Player moves during telegraph | Attack misses; Dracula → recover |
| Teleport destination invalid | Recompute; if none → recover |
| Target dies/respawns during hunt | Clear target; → idle |
| Two players tied for priority | Use nearest |
| Player enters holy during attack telegraph | Attack cancels; Dracula → recover |
| Dracula defeated | Banish for N ticks; respawn |

---

## 10. Short Spec Summary

**Combat:**

- Dice roll = movement points
- Players move tile by tile
- Tile effects resolve immediately on entry
- Entering monster tile triggers instant one-roll combat
- Success defeats regular monsters; failure deals damage/status
- Combat ends the player turn

**Dracula:**

- Roaming elite hunter with finite-state machine
- Targets visible players, preferring artifact carriers
- Moves 1 tile per monster tick through walkable paths
- If near target and cooldown allows: telegraph teleport → relocate up to 3 tiles
- If adjacent and cooldown allows: telegraph bite → attack for 1 damage
- Telegraphs create reaction window; if target escapes, action fizzles
- Recover after special actions; no unfair chaining
- 2 HP, defense 5; holy tiles and maze geometry counter him

---

## 11. Mapping to Existing Codebase

Your current codebase already has substantial logic. Use this mapping for incremental migration:

| Spec Concept | Current Location |
|--------------|------------------|
| Labyrinth / grid | `lib/labyrinth.ts` (Labyrinth class, grid, players) |
| Monster types | `lib/labyrinth.ts` (MonsterType, Monster) |
| Dracula AI | `lib/draculaAI.ts` (updateDracula, applyDraculaTeleport, applyDraculaAttack) |
| Combat | `lib/combatSystem.ts` (resolveCombat, getMonsterDefense) |
| Dracula config | `lib/labyrinth.ts` (DRACULA_CONFIG) |
| Phaser Dracula | `lib/phaser/DraculaSystem.ts` (timer-based; can be replaced by pure TS tick) |

**Migration path:** Extract pure TS logic from `lib/draculaAI.ts` and `lib/combatSystem.ts` into `lib/game-core/`; keep Phaser/React as render layer only.

---

For the **stand-by reference** for Dracula stand, hunt, and combat logic, see **[DRACULA_LOGIC_REFERENCE.md](./DRACULA_LOGIC_REFERENCE.md)**.
