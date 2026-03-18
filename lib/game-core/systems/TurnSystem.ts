/**
 * Turn system: round-robin player turns, dice → MP.
 * See docs/IMPLEMENTATION_PLAN.md §5.
 */

import type { EntityId } from "../types";

export function rollD6(): number {
  return Math.floor(Math.random() * 6) + 1;
}

/** Dice value = movement points. */
export function diceToMP(diceValue: number): number {
  return Math.max(0, diceValue);
}

export interface TurnState {
  currentPlayerIndex: number;
  round: number;
  numPlayers: number;
}

export function createTurnState(numPlayers: number): TurnState {
  return {
    currentPlayerIndex: 0,
    round: 1,
    numPlayers,
  };
}

export function nextTurn(state: TurnState): void {
  state.currentPlayerIndex = (state.currentPlayerIndex + 1) % state.numPlayers;
  if (state.currentPlayerIndex === 0) {
    state.round++;
  }
}

export function getCurrentPlayerId(
  state: TurnState,
  playerIds: EntityId[]
): EntityId | null {
  return playerIds[state.currentPlayerIndex] ?? null;
}
