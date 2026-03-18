/**
 * MVP balancing numbers.
 * See docs/IMPLEMENTATION_PLAN.md and docs/DRACULA_LOGIC_REFERENCE.md.
 */

export const PLAYER_DEFAULT_HP = 3;
export const PLAYER_DEFAULT_ATTACK_BONUS = 0;

export const DRACULA_CONFIG = {
  hp: 2,
  defense: 5,
  damage: 1,
  vision: 4,
  teleportRange: 3,
  teleportCooldown: 3,
  attackCooldown: 1,
  attackTelegraphMs: 600,
  teleportTelegraphMs: 800,
} as const;

export const MONSTER_TICK_MS = 2500;

export const MONSTER_STATS = {
  spider: { defense: 3, damage: 1 },
  ghost: { defense: 3, damage: 1 },
  zombie: { defense: 4, damage: 2 },
  skeleton: { defense: 4, damage: 1 },
  dracula: { defense: 5, damage: 1 },
} as const;
