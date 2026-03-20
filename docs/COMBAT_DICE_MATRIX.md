# Combat: dice × surprise state matrix

Rules from `lib/combatSystem.ts` + `LabyrinthGame` (power dice / second chance noted below).

## Surprise → defense modifier

| Surprise state | Modifier |
|----------------|----------|
| **idle**       | −1       |
| **hunt**       | 0        |
| **attack**     | +1       |
| **angry**      | +2       |

**Formula:** `effectiveDefense = max(0, baseDefense + surpriseModifier)`  
**Exception:**
- **Skeleton (K) with shield:** first successful hit uses **0** defense (shield break only, not a kill).

## Base defense by monster type

| Type | Monster        | Base DEF |
|------|----------------|----------|
| S    | Spider         | 3        |
| G    | Ghost          | 3        |
| Z    | Zombie         | 4        |
| K    | Skeleton       | 4        |
| L    | Lava Elemental | 6        |
| V    | Dracula        | 5        |

---

## Matrix A — Effective defense (d6 target to hit, **attack bonus = 0**, no power dice)

Minimum **d6** needed for **hit** = smallest `d` where `d >= effectiveDefense` (i.e. `effectiveDefense` is the number you must **meet or beat** on the die alone when bonus is 0).

### Spider (3) & Ghost (3) — same numbers (ghost also rolls 50% full miss separately)

| Surprise ↓ | Effective DEF | Hit on d6 (≥ DEF) | Miss on d6 |
|------------|---------------|-------------------|------------|
| idle       | 2             | 2–6               | 1          |
| hunt       | 3             | 3–6               | 1–2        |
| attack     | 4             | 4–6               | 1–3        |
| angry      | 5             | 5–6               | 1–4        |

### Zombie (4) & Skeleton **without shield** (4)

| Surprise ↓ | Effective DEF | Hit on d6 | Miss on d6 |
|------------|---------------|-----------|------------|
| idle       | 3             | 3–6       | 1–2        |
| hunt       | 4             | 4–6       | 1–3        |
| attack     | 5             | 5–6       | 1–4        |
| angry      | 6             | 6 only    | 1–5        |

### Dracula (5)

| Surprise ↓ | Effective DEF | Hit on d6 | Miss on d6 |
|------------|---------------|-----------|------------|
| idle       | 4             | 4–6       | 1–3        |
| hunt       | 5             | 5–6       | 1–4        |
| attack     | 6             | 6 only    | 1–5        |
| angry      | 7             | impossible on d6 alone* | 1–6 |

\*With **+1 attack bonus** (from gear), subtract 1 from the required roll (e.g. angry Dracula: need 6 on d6+1).

### Lava (6) — same surprise rules as other monsters

| Surprise ↓ | Effective DEF | Hit on d6 (bonus 0) | Miss on d6 |
|------------|---------------|---------------------|------------|
| idle       | 5             | 5–6                 | 1–4        |
| hunt       | 6             | 6 only              | 1–5        |
| attack     | 7             | impossible on d6 alone* | 1–6    |
| angry      | 8             | impossible on d6 alone* | 1–6    |

\*Use **+1 attack** (e.g. from Dracula) and/or **power dice** so `d6 + bonuses` can reach 7–8.

**Lava:** **no glancing** on a miss — raw d6 2–4 does **not** chip HP. Only `attackTotal ≥ effectiveDefense` deals **−1** monster HP.

### Skeleton **with shield** — first “hit”

Any roll that would be a hit vs **0** defense breaks shield (not using the table above). After shield is off, use Zombie/Skeleton table **without** shield.

---

## Matrix B — Glancing damage (on a **miss**, raw d6 only)

If the attack **misses** (`attackTotal < effectiveDefense`), **and** raw **d6 ∈ {2,3,4}**, monster still loses **1 HP** — **except Lava (L)**, which never takes glancing damage. Also no glance on ghost evade / skeleton shield break paths. **d6 = 1, 5, 6** on a miss → no glance chip.

| Raw d6 | On miss        |
|--------|----------------|
| 1      | No glance      |
| 2–4    | **−1 monster HP** (if rules allow) |
| 5–6    | No glance      |

---

## Matrix C — +1 attack bonus (e.g. Dracula reward)

`attackTotal = d6 + 1` (still use **raw d6** for glancing per code).

**Example — Dracula, angry (effective 7):** need `d6 + 1 ≥ 7` → d6 ≥ **6** (only 6 hits).

---

## Matrix D — Power dice (+1 to roll only, from `LabyrinthGame`)

`effectiveRoll = rawD6 + 1` for hit math; **glancing** still uses **raw** d6.

Example: Spider, hunt (DEF 3), raw 2, power used → attack total 3 → **hit**. Raw 2 is not a “miss” so no glance logic.

---

## Matrix E — Second chance (idle / hunt only, from `LabyrinthGame`)

If you **miss**, surprise is **idle or hunt**, and **raw d6 ≤ 3**: you get a **second roll** (no HP / glance applied on that roll). **Attack / angry** surprise: no second chance on that rule.

---

## Quick reference: random surprise is uniform

`rollCombatSurprise()` picks **idle / hunt / attack / angry** each with **25%** probability (see `LabyrinthGame.tsx`).

---

## Ghost special

Even with a “good” roll, **50%** of the time the ghost **evades** (`ghost_evade`): no hit, no glance, you still take ghost damage unless shield absorbs.
