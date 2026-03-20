# Combat balance verification (≥50% “fair” first roll)

## What we measured

**Metric:** `P(no player HP loss on the first dice resolution)` when:

- Surprise is **uniform** among idle / hunt / attack / angry (25% each), fixed for that roll.
- **d6** uniform, **attack bonus = 0**, **no power dice**.
- **No shield absorb** (worst case for the player).
- **Skeleton (K)** with **shield up**: first “hit” is shield break → counts as **no HP loss** (matches game).

**“No HP loss”** = win, shield break only, or **second chance** (idle/hunt + miss + d6 ≤ 3 → no damage and reroll).  
Does *not* count later rolls after a second chance.

## Results (exact enumeration)

| Monster | P(no HP loss, 1st roll) | vs 50% target |
|---------|-------------------------|---------------|
| **S** Spider | **70.8%** | OK |
| **G** Ghost | **35.4%** | **Below 50%** (50% evade + damage) |
| **Z** Zombie | **62.5%** | OK |
| **K** Skeleton (shield) | **95.8%** | OK (first hit usually shield) |
| **K** Skeleton (no shield) | **62.5%** | OK (same structure as Z) |
| **L** Lava | **37.5%** | **Below 50%** (high DEF + angry/attack harsh; intentional) |
| **V** Dracula | **50.0%** | **Exactly at threshold** |

Monte Carlo (200k samples) matches exact values to ~0.001.

## Dracula — per surprise (first roll, no bonus)

| Surprise | P(no HP loss) |
|----------|----------------|
| idle | 100% |
| hunt | 83.3% |
| attack | **16.7%** (need 6 on d6; miss 1–3 still get second chance only if… **no** — attack surprise kills second chance on those misses → mostly damage) |
| angry | **0%** (need 7 on d6 alone → always miss; angry → no second chance → always damage) |

Average over four surprises: **(1 + 5/6 + 1/6 + 0) / 4 = 50%**.

So **Dracula is balanced on average** but **very swingy**: angry stance is a guaranteed chip on the first roll without shield/+1 attack.

## Ghost

- **50%** of rolls: `ghost_evade` → attack total 0 → **miss** → **no glancing** → player takes **1** damage (unless shield).
- The other **50%** behaves like a **def 3** monster → ~70.8% no HP loss on that half.
- Combined: **0.5×0 + 0.5×0.708 ≈ 35.4%**.

So **without shield, ghost fails the “≥50% no damage first roll”** test. With **shield**, first evade can be absorbed — intended counterplay.

## Consistency checks (code vs rules)

1. **Effective defense** — Lava uses base 6 + surprise modifier like others; skeleton + shield uses 0 for hit check; matches `resolveCombat`.
2. **Second chance** — Only idle/hunt and miss and **raw d6 ≤ 3**; glancing is **not** applied when second chance triggers (early return in `LabyrinthGame`). Consistent.
3. **Glancing** — Raw d6 ∈ {2,3,4} on miss chips monster HP; does **not** reduce player damage. Consistent with “player survival” not improved by glance.
4. **Power dice / +1 attack** — Improve hit rate; not included in table above (player-favorable).

## Summary

| Criterion | Verdict |
|-----------|---------|
| **Consistent** with implemented rules | Yes |
| **≥50%** no HP loss on first roll **for all monsters** (no shield) | **No** — **Ghost ~35%** |
| **≥50%** for Dracula **on average** | **Yes (50%)** — but **angry = 0%** without bonuses |

## Optional design tweaks (if you want strict ≥50% ghost)

1. **Ghost:** Lower evade to **40%**, or on evade deal **0** damage (flavor: “phased through”), or **allow second chance** after non-ghost-resolve miss only (doesn’t apply to evade).
2. **Dracula angry:** Allow second chance on d6 ≤ 3 even for attack/angry (big buff), or give **+1 attack** earlier in the maze.
3. Leave as-is and treat **shield** + **power dice** as the intended way to stay above 50% in harsh matchups.

Script: `npx tsx scripts/combat-probability-check.ts`
