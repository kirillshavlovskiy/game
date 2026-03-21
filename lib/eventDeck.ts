import type { Labyrinth } from "./labyrinth";

export type EventType =
  | "cave_in"
  | "secret_door"
  | "fog"
  | "monsters_move"
  | "dracula_teleport"
  | "swap_players"
  | "bonus_weakest"
  | "move_artifact"
  | "cursed_artifact";

export interface GameEvent {
  type: EventType;
  description: string;
}

function shuffle<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function drawEvent(): GameEvent {
  const events: GameEvent[] = [
    { type: "cave_in", description: "Cave-in! A wall blocks a path." },
    { type: "secret_door", description: "A secret door opens!" },
    { type: "fog", description: "Fog rolls in..." },
    { type: "monsters_move", description: "All monsters move!" },
    { type: "dracula_teleport", description: "Dracula teleports!" },
    { type: "swap_players", description: "Two players swap positions!" },
    { type: "bonus_weakest", description: "Weakest player gets +1 HP!" },
    { type: "move_artifact", description: "An artifact moves!" },
    { type: "cursed_artifact", description: "An artifact is cursed!" },
  ];
  return events[Math.floor(Math.random() * events.length)];
}

export function applyEvent(
  lab: Labyrinth,
  event: GameEvent,
  activePlayerIndex = 0,
  opts?: { skipMonsterMove?: boolean }
): void {
  const pathCells: [number, number][] = [];
  for (let y = 1; y < lab.height - 1; y++)
    for (let x = 1; x < lab.width - 1; x++)
      if (lab.grid[y][x] === " ") pathCells.push([x, y]);

  const walls: [number, number][] = [];
  for (let y = 1; y < lab.height - 1; y++)
    for (let x = 1; x < lab.width - 1; x++)
      if (lab.grid[y][x] === "#") walls.push([x, y]);

  switch (event.type) {
    case "cave_in": {
      if (pathCells.length >= 3) {
        const pick = pathCells[Math.floor(Math.random() * pathCells.length)];
        if (pick) lab.grid[pick[1]][pick[0]] = "#";
      }
      break;
    }
    case "secret_door": {
      if (walls.length >= 1) {
        const w = shuffle(walls)[0];
        if (w) lab.grid[w[1]][w[0]] = " ";
      }
      break;
    }
    case "monsters_move": {
      if (opts?.skipMonsterMove) break;
      const firstLiving = [...Array(lab.numPlayers).keys()].find((i) => !lab.eliminatedPlayers.has(i));
      lab.moveMonsters(firstLiving ?? activePlayerIndex);
      break;
    }
    case "dracula_teleport": {
      const dracula = lab.monsters.find(m => m.type === "V");
      if (dracula && pathCells.length >= 1) {
        const dest = pathCells[Math.floor(Math.random() * pathCells.length)];
        if (dest) {
          dracula.x = dest[0];
          dracula.y = dest[1];
        }
      }
      break;
    }
    case "swap_players": {
      const alive = lab.players
        .map((_, i) => i)
        .filter(i => !lab.eliminatedPlayers.has(i));
      if (alive.length >= 2) {
        const [a, b] = shuffle(alive).slice(0, 2);
        const pa = lab.players[a];
        const pb = lab.players[b];
        if (pa && pb) {
          [pa.x, pa.y, pb.x, pb.y] = [pb.x, pb.y, pa.x, pa.y];
        }
      }
      break;
    }
    case "bonus_weakest": {
      let weakest = -1;
      let minHp = 999;
      for (let i = 0; i < lab.players.length; i++) {
        if (lab.eliminatedPlayers.has(i)) continue;
        const hp = lab.players[i]?.hp ?? 0;
        if (hp < minHp) {
          minHp = hp;
          weakest = i;
        }
      }
      if (weakest >= 0 && lab.players[weakest]) {
        lab.players[weakest].hp = (lab.players[weakest].hp ?? 0) + 1;
      }
      break;
    }
    case "move_artifact":
    case "cursed_artifact":
      // Simplified: just log for now
      break;
    default:
      break;
  }
}
