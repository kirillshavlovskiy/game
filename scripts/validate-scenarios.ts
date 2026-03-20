#!/usr/bin/env npx tsx
/**
 * Scenarios validation script for Labyrinth game.
 *
 * Validates that mazes are passable: players can reach the goal using
 * bombs (clear traps/walls), jumps (over traps/walls), or catapults (launch past obstacles).
 *
 * Run: npx tsx scripts/validate-scenarios.ts [--count N] [--size S]
 */

import {
  Labyrinth,
  WALL,
  isTrapCell,
  BOMB,
  JUMP,
  CATAPULT,
} from "../lib/labyrinth";

const DIRS: [number, number][] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

interface ValidationResult {
  ok: boolean;
  reachable: boolean;
  problematicCells: { x: number; y: number; type: string }[];
  helpersAvailable: { bombs: number; jumps: number; catapults: number };
  bypassStrategies: string[];
  errors: string[];
}

function bfsReachable(
  grid: string[][],
  width: number,
  height: number,
  startX: number,
  startY: number,
  goalX: number,
  goalY: number,
  options: { allowTraps?: boolean; allowWebs?: boolean } = {}
): boolean {
  const visited = new Set<string>();
  const queue: [number, number][] = [[startX, startY]];
  visited.add(`${startX},${startY}`);

  const isBlocked = (x: number, y: number): boolean => {
    const cell = grid[y]?.[x];
    if (!cell || cell === WALL) return true;
    if (options.allowTraps !== true && isTrapCell(cell)) return true;
    return false;
  };

  while (queue.length > 0) {
    const [x, y] = queue.shift()!;
    if (x === goalX && y === goalY) return true;

    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      const key = `${nx},${ny}`;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      if (visited.has(key)) continue;
      if (isBlocked(nx, ny)) continue;
      visited.add(key);
      queue.push([nx, ny]);
    }
  }
  return false;
}

function findProblematicCells(
  lab: Labyrinth
): { x: number; y: number; type: string }[] {
  const problematic: { x: number; y: number; type: string }[] = [];
  for (let y = 0; y < lab.height; y++) {
    for (let x = 0; x < lab.width; x++) {
      const cell = lab.grid[y][x];
      if (isTrapCell(cell)) {
        problematic.push({ x, y, type: cell });
      }
      if (lab.webPositions?.some(([wx, wy]) => wx === x && wy === y)) {
        problematic.push({ x, y, type: "web" });
      }
    }
  }
  return problematic;
}

function countHelpers(lab: Labyrinth): { bombs: number; jumps: number; catapults: number } {
  let bombs = 0;
  let jumps = 0;
  let catapults = 0;
  for (let y = 0; y < lab.height; y++) {
    for (let x = 0; x < lab.width; x++) {
      const cell = lab.grid[y][x];
      if (cell === BOMB) bombs++;
      if (cell === JUMP) jumps++;
      if (cell === CATAPULT) catapults++;
    }
  }
  return { bombs, jumps, catapults };
}

function validateScenario(lab: Labyrinth): ValidationResult {
  const errors: string[] = [];
  const bypassStrategies: string[] = [];
  const startX = 0;
  const startY = 0;
  const goalX = lab.goalX;
  const goalY = lab.goalY;

  const problematicCells = findProblematicCells(lab);
  const helpers = countHelpers(lab);

  const reachableDirect = bfsReachable(
    lab.grid,
    lab.width,
    lab.height,
    startX,
    startY,
    goalX,
    goalY,
    { allowTraps: false }
  );

  if (reachableDirect) {
    return {
      ok: true,
      reachable: true,
      problematicCells,
      helpersAvailable: helpers,
      bypassStrategies: ["Direct path exists (no traps blocking)"],
      errors: [],
    };
  }

  const reachableWithTraps = bfsReachable(
    lab.grid,
    lab.width,
    lab.height,
    startX,
    startY,
    goalX,
    goalY,
    { allowTraps: true }
  );

  if (!reachableWithTraps) {
    errors.push("Goal is unreachable even when ignoring traps");
    return {
      ok: false,
      reachable: false,
      problematicCells,
      helpersAvailable: helpers,
      bypassStrategies: [],
      errors,
    };
  }

  if (helpers.bombs > 0) {
    bypassStrategies.push(`Bombs (${helpers.bombs}): can clear traps and walls in 3x3 blast`);
  }
  if (helpers.jumps > 0) {
    bypassStrategies.push(`Jumps (${helpers.jumps}): can jump over traps and walls`);
  }
  if (helpers.catapults > 0) {
    bypassStrategies.push(`Catapults (${helpers.catapults}): can launch past obstacles`);
  }

  const hasBypass = helpers.bombs > 0 || helpers.jumps > 0 || helpers.catapults > 0;
  if (!hasBypass && problematicCells.length > 0) {
    errors.push(
      `Traps/webs block path but no bypass helpers (bombs/jumps/catapults) available`
    );
  }

  return {
    ok: hasBypass || problematicCells.length === 0,
    reachable: true,
    problematicCells,
    helpersAvailable: helpers,
    bypassStrategies,
    errors,
  };
}

function main() {
  const args = process.argv.slice(2);
  const countIdx = args.indexOf("--count");
  const sizeIdx = args.indexOf("--size");
  const count = countIdx >= 0 ? parseInt(args[countIdx + 1] || "5", 10) : 5;
  const size = sizeIdx >= 0 ? parseInt(args[sizeIdx + 1] || "25", 10) : 25;

  console.log("Labyrinth Scenarios Validation\n");
  console.log(`Validating ${count} mazes (size ${size}x${size})...\n`);

  let passed = 0;
  let failed = 0;

  for (let i = 0; i < count; i++) {
    const lab = new Labyrinth(size, size, Math.max(4, size), 1, 2);
    lab.generate();

    const result = validateScenario(lab);

    const status = result.ok ? "PASS" : "FAIL";
    if (result.ok) passed++;
    else failed++;

    console.log(`--- Maze ${i + 1}/${count} [${status}] ---`);
    console.log(`  Reachable: ${result.reachable}`);
    console.log(`  Problematic cells: ${result.problematicCells.length}`);
    if (result.problematicCells.length > 0 && result.problematicCells.length <= 8) {
      result.problematicCells.forEach((c) =>
        console.log(`    - (${c.x},${c.y}) ${c.type}`)
      );
    }
    console.log(`  Helpers: bombs=${result.helpersAvailable.bombs} jumps=${result.helpersAvailable.jumps} catapults=${result.helpersAvailable.catapults}`);
    result.bypassStrategies.forEach((s) => console.log(`  Strategy: ${s}`));
    if (result.errors.length > 0) {
      result.errors.forEach((e) => console.log(`  ERROR: ${e}`));
    }
    console.log("");
  }

  console.log("--- Summary ---");
  console.log(`Passed: ${passed}/${count}`);
  console.log(`Failed: ${failed}/${count}`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
