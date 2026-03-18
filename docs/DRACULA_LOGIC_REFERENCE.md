# Dracula Logic Reference: Stand-by, Hunt & Combat

**Purpose:** Stand-by reference for implementing and debugging Dracula AI. Use this document when implementing, reviewing, or fixing Dracula behavior.

---

## 1. State Machine Overview

```
                    ┌─────────────────────────────────────────────────────────┐
                    │                                                         │
                    ▼                                                         │
┌─────────┐   target seen   ┌─────────┐   adjacent + attackCD=0   ┌────────────────────┐
│  idle   │ ─────────────► │  hunt   │ ─────────────────────────► │ telegraphAttack   │
└─────────┘                └────┬────┘                             └─────────┬──────────┘
     ▲                         │                                              │
     │                         │ dist 2–4 + teleportCD=0                      │ 600ms
     │                         │ + valid landing tile                         │
     │                         ▼                                              ▼
     │                ┌────────────────────┐                         ┌────────────┐
     │                │ telegraphTeleport  │                         │   attack   │
     │                └─────────┬──────────┘                         └─────┬──────┘
     │                          │ 800ms                                    │
     │                          ▼                                          │
     │                  ┌────────────┐                                     │
     │                  │  teleport  │                                     │
     │                  └─────┬──────┘                                     │
     │                        │                                            │
     │                        │ if adjacent after teleport                  │
     │                        │ + attackCD=0 → telegraphAttack             │
     │                        │ else                                        │
     │                        ▼                                            │
     │                  ┌──────────┐                                        │
     └──────────────────│ recover  │◄───────────────────────────────────────┘
        no target       └────┬─────┘
        or out of vision     │
                             │ target valid → hunt
                             │ else → idle
                             ▼
                    ┌────────────┐
                    │  banished  │  (after 2nd hit; N ticks)
                    └────────────┘
```

---

## 2. State Definitions

### 2.1 Idle

| Property | Value |
|----------|-------|
| **When** | No valid target in vision |
| **Behavior** | Stands or drifts slightly (optional: patrol local area) |
| **Transition** | Target seen → `hunt` |

**Implementation notes:**
- Optional patrol: move along `patrolArea` if defined
- Do not move toward any player
- `targetPlayerId = null`

---

### 2.2 Patrol (Optional)

| Property | Value |
|----------|-------|
| **When** | Variant of idle with defined patrol route |
| **Behavior** | Moves slowly in local area; guards central zone or artifact route |
| **Transition** | Target seen → `hunt` |

---

### 2.3 Hunt

| Property | Value |
|----------|-------|
| **When** | Valid target in vision |
| **Behavior** | Select target; move 1 tile toward target; decide attack vs teleport |
| **Transitions** | See table below |

| Condition | Next State |
|-----------|------------|
| No target or eliminated | `idle` |
| Target out of vision (dist > vision) | `idle` |
| Adjacent (dist=1) AND attack cooldown=0 | `telegraphAttack` |
| Dist 2–4 AND teleport cooldown=0 AND valid landing tile | `telegraphTeleport` |
| Else | Move 1 tile toward target; stay in `hunt` |

**Movement rule (greedy):**
1. Reduce x-distance if possible
2. Else reduce y-distance
3. Else use secondary axis
4. Else stay still

---

### 2.4 TelegraphTeleport

| Property | Value |
|----------|-------|
| **When** | Decided to teleport; warning phase |
| **Behavior** | Visual marker on predicted destination; lasts 700–1000 ms (recommend 800 ms) |
| **Transition** | Timer ends → `teleport` |

**Implementation:**
- Store `telegraphDestination: { x, y }`
- Do NOT move Dracula yet
- After 800 ms: execute teleport

---

### 2.5 Teleport

| Property | Value |
|----------|-------|
| **When** | Telegraph timer ended |
| **Behavior** | Relocate up to N tiles (recommend 3) |
| **Restrictions** | Cannot land in walls, on monster, or on player |
| **Preference** | Tiles adjacent to target |

**Landing score (lower = better):**
```
score = distanceToTarget * 10 + holyPenalty + occupancyPenalty
```

**Transitions:**
- If adjacent after teleport AND attack cooldown=0 → `telegraphAttack`
- Else → `recover`

**Cooldown:** Set `teleportCooldown = 3` ticks

---

### 2.6 TelegraphAttack

| Property | Value |
|----------|-------|
| **When** | Adjacent to target; attack cooldown=0 |
| **Behavior** | Red pulse on target tile; lasts 500–700 ms (recommend 600 ms) |
| **Transition** | Timer ends → `attack` if target still adjacent; else → `recover` |

**Implementation:**
- Store `telegraphTarget: { x, y }` (player position)
- After 600 ms: check if target still adjacent
- If yes → resolve attack
- If no (player moved) → attack fizzles, go to `recover`

---

### 2.7 Attack

| Property | Value |
|----------|-------|
| **When** | Telegraph ended; target still adjacent |
| **Behavior** | Deal 1 damage; optional lifesteal if target has artifact |
| **Transition** | Set attack cooldown; → `recover` |

**Special effect (choose one for MVP):**
- If `target.artifacts > 0` → Dracula heals 1 (up to max)

**Cooldown:** Set `attackCooldown = 1` tick

---

### 2.8 Recover

| Property | Value |
|----------|-------|
| **When** | After teleport or attack |
| **Behavior** | Cannot chain special immediately |
| **Transition** | Target still valid → `hunt`; else → `idle` |

---

### 2.9 Banished

| Property | Value |
|----------|-------|
| **When** | Defeated (2nd successful hit) |
| **Behavior** | Gone for N monster ticks |
| **Transition** | Timer ends → respawn at lair/dark tile; → `idle` |

---

## 3. Target Selection

**Priority order:**

1. Visible player with **most artifacts**
2. If tie: **nearest** visible player
3. If tie: **lowest HP** visible player
4. Else: nearest visible player

**Visible = Manhattan distance ≤ vision (4 tiles)**

```ts
function selectTarget(dracula, players, eliminated): EntityId | null {
  const visible = players
    .filter((p, i) => !eliminated.has(i))
    .filter(p => manhattan(dracula.x, dracula.y, p.x, p.y) <= dracula.vision);
  if (visible.length === 0) return null;
  return visible
    .sort((a, b) => {
      if (a.artifacts !== b.artifacts) return b.artifacts - a.artifacts;
      const da = manhattan(dracula.x, dracula.y, a.x, a.y);
      const db = manhattan(dracula.x, dracula.y, b.x, b.y);
      if (da !== db) return da - db;
      return a.hp - b.hp;
    })[0].id;
}
```

---

## 4. Movement Rules (Hunt)

### 4.1 Base Movement

- 1 tile per monster tick
- Greedy: reduce distance to target
- Walls block normal movement
- **Teleport ignores walls**

### 4.2 Pathfinding (MVP)

- Greedy tile choice (reduce Manhattan distance)
- Later: BFS or A* on walkable graph

---

## 5. Teleport Rules

### 5.1 When Allowed

- Target within vision
- Not already adjacent
- `teleportCooldown === 0`
- At least one valid landing tile exists

### 5.2 Restrictions

- No teleport with zero warning (must telegraph)
- No teleport onto player tile
- No teleport onto holy tile
- No teleport twice back-to-back (recover in between)

### 5.3 Landing Preference

- Prefer adjacent side tile
- Then 2-tile close
- Then best available by score

---

## 6. Attack Rules

### 6.1 Adjacency

- Attack only if **orthogonally adjacent** (Manhattan dist = 1)

### 6.2 Damage

- Bite = 1 HP

### 6.3 Special (MVP)

- If `target.artifacts > 0` → Dracula heals 1

---

## 7. Holy Tiles & Maze Interaction

| Terrain | Effect on Dracula |
|---------|-------------------|
| Walls | Block walk; teleport ignores |
| Holy tiles | Cannot teleport onto; cannot attack into; target on holy → attack cancels |
| Webs | Ignores (no slow) |
| Traps | Unaffected |

---

## 8. Edge Cases (Quick Reference)

| Case | Action |
|------|--------|
| Player moves during telegraph | Attack misses; Dracula → `recover` |
| Teleport dest blocked | Recompute; if none → `recover` |
| Target dies during hunt | Clear target; → `idle` |
| Target respawns | Retarget or → `idle` |
| Player enters holy during telegraph | Attack cancels; → `recover` |
| Two players tied | Use nearest |
| Dracula defeated | → `banished` for N ticks |

---

## 9. Combat: Player vs Dracula

When **player enters Dracula's tile** (Option A – recommended):

```
roll 1d6 + attackBonus vs Dracula defense (5)
  success → Dracula loses 1 HP (first hit weakens, second banishes)
  failure → player takes 1 damage
turn ends
```

**Dracula stats:**
- HP: 2
- Defense: 5
- Damage: 1

---

## 10. Constants Summary

```ts
const DRACULA_CONFIG = {
  hp: 2,
  defense: 5,
  damage: 1,
  vision: 4,
  teleportRange: 3,
  teleportCooldown: 3,
  attackCooldown: 1,
  attackTelegraphMs: 600,
  teleportTelegraphMs: 800,
};
```

---

## 11. Tick Flow (Monster Tick)

```
every 2500 ms:
  1. reduce cooldowns (teleport, attack)
  2. if state in [telegraphTeleport, telegraphAttack]: skip (wait for timer)
  3. switch (state):
       idle:     if target → hunt; else optional patrol
       hunt:     apply hunt logic (move / telegraph)
       recover:  if target valid → hunt; else idle
       banished: decrement banishTicks; if 0 → respawn, idle
       teleport: (handled by timer callback)
       attack:   (handled by timer callback)
```

---

*Last updated: Implementation plan v1. Use this document as the authoritative reference for Dracula stand-by, hunt, and combat logic.*
