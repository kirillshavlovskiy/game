/**
 * Grid utilities for movement and pathfinding.
 */

import type { Position } from "../types";

export function manhattan(x1: number, y1: number, x2: number, y2: number): number {
  return Math.abs(x1 - x2) + Math.abs(y1 - y2);
}

export function posKey(pos: Position): string {
  return `${pos.x},${pos.y}`;
}

/** Orthogonal neighbors (N, E, S, W) */
export const ORTHOGONAL: [number, number][] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

export function getNeighbors(
  x: number,
  y: number,
  width: number,
  height: number
): [number, number][] {
  const out: [number, number][] = [];
  for (const [dx, dy] of ORTHOGONAL) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
      out.push([nx, ny]);
    }
  }
  return out;
}
