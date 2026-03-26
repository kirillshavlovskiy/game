#!/usr/bin/env node
/**
 * Rewrites `DRACULA_ATTACK_SPELL_PRIORITY` and `DRACULA_ATTACK_SKILL_PRIORITY` in lib/monsterModels3d.ts.
 *
 * Edit the arrays below, then run from repo root:
 *   node scripts/reorder-dracula-attack-clips.mjs
 *
 * Combat alternates spell-first vs skill-first via `draculaMergedAttackClipPriority` — first clip in the
 * active primary list wins when present in the GLB (`Jumping_Punch` = Meshy …Animation_Jumping_Punch…).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TARGET = path.join(__dirname, "..", "lib", "monsterModels3d.ts");

/** Try order when this strike uses the “spell first” merge as primary. */
const DRACULA_ATTACK_SPELL_PRIORITY = [
  "Jumping_Punch",
  "Charged_Spell_Cast_2",
  "Skill_03",
  "Skill_01",
];

/** Try order when this strike uses the “skill first” merge as primary. */
const DRACULA_ATTACK_SKILL_PRIORITY = [
  "Jumping_Punch",
  "Skill_03",
  "Skill_01",
  "Charged_Spell_Cast_2",
];

function blockConst(name, comment, arr) {
  const lines = arr.map((s) => `  "${s}",`).join("\n");
  return `${comment}\nconst ${name} = [\n${lines}\n] as const;`;
}

const spellBlock = blockConst(
  "DRACULA_ATTACK_SPELL_PRIORITY",
  "/** Spell-first strike order (primary segment in `draculaMergedAttackClipPriority(\"spell\")`). */",
  DRACULA_ATTACK_SPELL_PRIORITY,
);
const skillBlock = blockConst(
  "DRACULA_ATTACK_SKILL_PRIORITY",
  "/** Skill-first strike order (primary segment in `draculaMergedAttackClipPriority(\"skill\")`). */",
  DRACULA_ATTACK_SKILL_PRIORITY,
);

let src = fs.readFileSync(TARGET, "utf8");

const spellRe =
  /\/\*\* Spell-first strike order[\s\S]*?\nconst DRACULA_ATTACK_SPELL_PRIORITY = \[[\s\S]*?\] as const;/;
const skillRe =
  /\/\*\* Skill-first strike order[\s\S]*?\nconst DRACULA_ATTACK_SKILL_PRIORITY = \[[\s\S]*?\] as const;/;

if (!spellRe.test(src) || !skillRe.test(src)) {
  console.error("Could not find DRACULA_ATTACK_* blocks in monsterModels3d.ts — file changed?");
  process.exit(1);
}

src = src.replace(spellRe, spellBlock).replace(skillRe, skillBlock);
fs.writeFileSync(TARGET, src);
console.log(`Updated ${TARGET}`);
console.log("Spell:", DRACULA_ATTACK_SPELL_PRIORITY.join(" → "));
console.log("Skill:", DRACULA_ATTACK_SKILL_PRIORITY.join(" → "));
