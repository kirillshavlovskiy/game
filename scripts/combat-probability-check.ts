/**
 * Monte Carlo + exact formulas: P(no HP loss on first dice resolution)
 * vs P(player takes damage), uniform surprise, d6 uniform.
 * Matches lib/combatSystem.ts (no power dice, attackBonus 0, shield not used).
 */

import {
  getMonsterDefense,
  getSurpriseDefenseModifier,
  type MonsterSurpriseState,
} from "../lib/combatSystem";
import type { MonsterType } from "../lib/labyrinth";

const SURPRISES: MonsterSurpriseState[] = ["idle", "hunt", "attack", "angry"];

/** Mirrors `resolveCombat` skeleton armor + surprise (K no-shield uses bones 2, min effective DEF 2). */
function effectiveDefense(
  type: MonsterType,
  surprise: MonsterSurpriseState,
  skeletonShield: boolean
): number {
  const mod = getSurpriseDefenseModifier(surprise);
  if (type === "K" && skeletonShield) return Math.max(0, 0 + mod);
  if (type === "K" && !skeletonShield) {
    const raw = Math.max(0, 2 + mod);
    return Math.max(2, raw);
  }
  return Math.max(0, getMonsterDefense(type) + mod);
}

/** First roll: win, or second-chance (no damage yet), or skeleton shield break (no HP dmg) */
function outcomeNoPlayerHpLoss(
  type: MonsterType,
  surprise: MonsterSurpriseState,
  d6: number,
  skeletonShield: boolean,
  ghostEvade: boolean
): boolean {
  if (type === "G" && ghostEvade) return false; // ghost hit for 1 HP unless shield (not modeled)

  const eff = effectiveDefense(type, surprise, skeletonShield);
  const attackTotal = d6; // no bonus
  const hit = attackTotal >= eff;

  if (type === "K" && skeletonShield && hit) return true; // shield break, 0 player dmg

  if (hit) return true; // win (1-HP) or chip on multi-HP — player takes 0 this roll

  // miss
  const canSecond =
    surprise === "idle" || surprise === "hunt" ? d6 <= 3 : false;
  if (canSecond) return true;

  return false; // took monster damage this resolution
}

function simulate(
  type: MonsterType,
  skeletonShield: boolean,
  ghostEvadeRate: number,
  n = 200_000
): number {
  let ok = 0;
  for (let i = 0; i < n; i++) {
    const surprise = SURPRISES[Math.floor(Math.random() * 4)]!;
    const d6 = 1 + Math.floor(Math.random() * 6);
    const ghostEvade = type === "G" && Math.random() < ghostEvadeRate;
    if (outcomeNoPlayerHpLoss(type, surprise, d6, skeletonShield, ghostEvade))
      ok++;
  }
  return ok / n;
}

function exactProb(
  type: MonsterType,
  skeletonShield: boolean,
  ghostEvadeRate: number
): number {
  let sum = 0;
  for (const s of SURPRISES) {
    for (let d6 = 1; d6 <= 6; d6++) {
      const pSurprise = 1 / 4;
      const pD6 = 1 / 6;
      const pEvade = type === "G" ? ghostEvadeRate : 0;
      const pNoEvade = type === "G" ? 1 - ghostEvadeRate : 1;

      const goodIfNotEvade = outcomeNoPlayerHpLoss(
        type,
        s,
        d6,
        skeletonShield,
        false
      );
      const goodIfEvade = outcomeNoPlayerHpLoss(
        type,
        s,
        d6,
        skeletonShield,
        true
      );

      sum +=
        pSurprise *
        pD6 *
        (pEvade * (goodIfEvade ? 1 : 0) + pNoEvade * (goodIfNotEvade ? 1 : 0));
    }
  }
  return sum;
}

const types: MonsterType[] = ["S", "G", "Z", "K", "L", "V"];

console.log(
  "P(no player HP loss on first roll) — uniform surprise, d6, attackBonus 0, no power dice, no shield absorb\n"
);
console.log(
  "Type | P(exact) | P(MC)   | Notes"
);
console.log("-".repeat(70));

for (const t of types) {
  const shield = t === "K";
  const ghostR = t === "G" ? 0.5 : 0;
  const ex = exactProb(t, shield, ghostR);
  const mc = simulate(t, shield, ghostR);
  let note = "";
  if (t === "G") note = "50% ghost evade hurts this hard";
  if (t === "V") note = "angry + impossible hit on d6 → many damage rolls";
  if (ex < 0.5) note += " **<50%**";
  console.log(
    `${t}    | ${ex.toFixed(3)}   | ${mc.toFixed(3)} | ${note}`
  );
}

console.log("\n--- K without shield (shield already broken) ---");
const exK2 = exactProb("K", false, 0);
console.log(`K no shield: P(no dmg first roll) = ${exK2.toFixed(3)}`);

console.log("\n--- Dracula per surprise (no ghost) ---");
for (const s of SURPRISES) {
  let sub = 0;
  for (let d = 1; d <= 6; d++) {
    if (outcomeNoPlayerHpLoss("V", s, d, false, false)) sub += 1 / 6;
  }
  console.log(`  ${s}: ${sub.toFixed(3)}`);
}
