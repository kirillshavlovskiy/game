"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Dice3D, { Dice3DRef } from "@/components/Dice3D";
import {
  Labyrinth,
  PATH,
  MAX_ROUNDS,
  SIZE_OPTIONS,
  DIFFICULTY_OPTIONS,
  PLAYER_COLORS,
  PLAYER_COLORS_ACTIVE,
  isMultiplierCell,
  getMultiplierValue,
  isMagicCell,
  isCatapultCell,
  isJumpCell,
  isDiamondCell,
  isShieldCell,
  isBombCell,
  getCollectibleOwner,
  getMonsterName,
  getMonsterDefense,
  isArtifactCell,
  isTrapCell,
  TRAP_LOSE_TURN,
  TRAP_HARM,
  TRAP_TELEPORT,
  ARTIFACT_DICE,
  ARTIFACT_SHIELD,
  ARTIFACT_TELEPORT as ARTIFACT_TELEPORT_CELL,
  ARTIFACT_REVEAL,
  ARTIFACT_HEALING,
  type MonsterType,
  DEFAULT_PLAYER_HP,
} from "@/lib/labyrinth";
import { resolveCombat, type CombatResult } from "@/lib/combatSystem";
import { drawEvent, applyEvent } from "@/lib/eventDeck";

const CELL_SIZE = 44;

/**
 * MOVE POLICY — how moves are consumed/kept per action:
 *
 * NORMAL MOVE: Pay getTileMoveCost (1=path, 2=TRAP_SLOW, 3=web). Turn continues if moves left.
 * COMBAT (player lands on monster): Move cost paid. Combat resolves. Win → turn ends. Lose+shield → keep moves. Lose+no shield → turn ends if eliminated.
 * COMBAT (monster lands on player): No move cost. Same resolution.
 * BOMB (normal): Costs 1 move. Turn continues.
 * BOMB (in combat): Free (clears monster). Turn continues.
 * MAGIC CELL / TRAP TELEPORT: Turn ends (moves zeroed).
 * TELEPORT PICKER (gem/artifact): Turn ends when destination chosen.
 * TRAP_LOSE_TURN: Turn ends immediately.
 * TRAP_HARM: No move cost. Turn continues (unless killed).
 * CATAPULT: Landing costs 1 move. Launch refunds 1 (net: catapult use is free).
 */

function getMonsterIcon(type: MonsterType): string {
  return type === "V" ? "🧛" : type === "Z" ? "🧟" : type === "G" ? "👻" : type === "K" ? "💀" : "🕷";
}

function getParabolicArcPath(from: [number, number], to: [number, number], cellSize: number, steps = 16): string {
  const fx = (from[0] + 0.5) * cellSize;
  const fy = (from[1] + 0.5) * cellSize;
  const tx = (to[0] + 0.5) * cellSize;
  const ty = (to[1] + 0.5) * cellSize;
  const dx = tx - fx;
  const dy = ty - fy;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const ndx = dx / dist;
  const ndy = dy / dist;
  const perp1 = [-ndy, ndx];
  const perp2 = [ndy, -ndx];
  const [perpX, perpY] = perp1[1] < 0 ? perp1 : perp2;
  const arcHeight = dist * 0.12;
  const pts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = fx + dx * t + perpX * arcHeight * 4 * t * (1 - t);
    const y = fy + dy * t + perpY * arcHeight * 4 * t * (1 - t);
    pts.push(`${x} ${y}`);
  }
  return pts.map((p, i) => (i === 0 ? `M ${p}` : `L ${p}`)).join(" ");
}

function useDraggable(getInitial: () => { x: number; y: number }) {
  const [pos, setPos] = useState(() =>
    typeof window !== "undefined" ? getInitial() : { x: 0, y: 0 }
  );
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef({ startX: 0, startY: 0, startPosX: 0, startPosY: 0 });

  const startDrag = useCallback((clientX: number, clientY: number) => {
    setDragging(true);
    dragRef.current = {
      startX: clientX,
      startY: clientY,
      startPosX: pos.x,
      startPosY: pos.y,
    };
  }, [pos.x, pos.y]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    startDrag(e.clientX, e.clientY);
  }, [startDrag]);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    if (t) {
      e.preventDefault();
      startDrag(t.clientX, t.clientY);
    }
  }, [startDrag]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      setPos({
        x: dragRef.current.startPosX + e.clientX - dragRef.current.startX,
        y: dragRef.current.startPosY + e.clientY - dragRef.current.startY,
      });
    };
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) {
        setPos({
          x: dragRef.current.startPosX + t.clientX - dragRef.current.startX,
          y: dragRef.current.startPosY + t.clientY - dragRef.current.startY,
        });
      }
    };
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onUp);
    window.addEventListener("touchcancel", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onUp);
      window.removeEventListener("touchcancel", onUp);
    };
  }, [dragging]);

  return { pos, onMouseDown, onTouchStart, dragging };
}

export default function LabyrinthGame() {
  const [lab, setLab] = useState<Labyrinth | null>(null);
  const [currentPlayer, setCurrentPlayer] = useState(0);
  const [movesLeft, setMovesLeft] = useState(0);
  const [totalMoves, setTotalMoves] = useState(0);
  const [playerTurns, setPlayerTurns] = useState<number[]>(() => [0, 0, 0]);
  const [playerMoves, setPlayerMoves] = useState<number[]>(() => [0, 0, 0]);
  const [diceResult, setDiceResult] = useState<number | null>(null);
  const [winner, setWinner] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [mazeSize, setMazeSize] = useState(25);
  const [difficulty, setDifficulty] = useState(2);
  const [numPlayers, setNumPlayers] = useState(3);
  const [rolling, setRolling] = useState(false);
  const [bonusAdded, setBonusAdded] = useState<number | null>(null);
  const [jumpAdded, setJumpAdded] = useState<number | null>(null);
  const [shieldAbsorbed, setShieldAbsorbed] = useState<boolean | null>(null);
  const [shieldGained, setShieldGained] = useState<boolean | null>(null);
  const [healingGained, setHealingGained] = useState<boolean | null>(null);
  const [harmTaken, setHarmTaken] = useState<boolean | null>(null);
  const [bombGained, setBombGained] = useState<boolean | null>(null);
  const [hiddenGemTeleport, setHiddenGemTeleport] = useState<boolean | null>(null);
  const [torchGained, setTorchGained] = useState<boolean | null>(null);
  const [cellsRevealed, setCellsRevealed] = useState<number | null>(null);
  const [webSlowed, setWebSlowed] = useState<boolean | null>(null);
  const [eliminatedByMonster, setEliminatedByMonster] = useState<{
    playerIndex: number;
    monsterType: MonsterType;
  } | null>(null);
  const [teleportAnimation, setTeleportAnimation] = useState<{
    from: [number, number];
    to: [number, number];
    playerIndex: number;
  } | null>(null);
  const [teleportPicker, setTeleportPicker] = useState<{
    playerIndex: number;
    from: [number, number];
    options: [number, number][];
    sourceType: "magic" | "gem";
  } | null>(null);
  const [catapultMode, setCatapultMode] = useState(false);
  const [catapultPicker, setCatapultPicker] = useState<{ playerIndex: number; from: [number, number] } | null>(null);
  const [catapultAnimation, setCatapultAnimation] = useState<{
    from: [number, number];
    to: [number, number];
    playerIndex: number;
  } | null>(null);
  const catapultDragRef = useRef<{ startX: number; startY: number; cellX: number; cellY: number } | null>(null);
  const [catapultDragOffset, setCatapultDragOffset] = useState<{ dx: number; dy: number } | null>(null);
  const [jumpAnimation, setJumpAnimation] = useState<{
    playerIndex: number;
    x: number;
    y: number;
  } | null>(null);
  const [bombExplosion, setBombExplosion] = useState<{ x: number; y: number } | null>(null);
  const [combatState, setCombatState] = useState<{
    playerIndex: number;
    monsterType: MonsterType;
    monsterIndex: number;
    prevX?: number;
    prevY?: number;
  } | null>(null);
  const [combatResult, setCombatResult] = useState<(CombatResult & { monsterType?: MonsterType; shieldAbsorbed?: boolean }) | null>(null);
  const [collisionEffect, setCollisionEffect] = useState<{ x: number; y: number } | null>(null);
  const [turnChangeEffect, setTurnChangeEffect] = useState<number | null>(null);
  const [combatUseShield, setCombatUseShield] = useState(true);
  const [combatUseDiceBonus, setCombatUseDiceBonus] = useState(true);
  const [mazeZoom, setMazeZoom] = useState(1);
  const [gameStarted, setGameStarted] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [playerNames, setPlayerNames] = useState<string[]>(() =>
    Array.from({ length: 3 }, (_, i) => `Player ${i + 1}`)
  );
  const diceRef = useRef<Dice3DRef>(null);
  const combatDiceRef = useRef<Dice3DRef>(null);
  const movesLeftRef = useRef(0);
  const winnerRef = useRef(winner);
  const combatStateRef = useRef(combatState);
  const combatUseShieldRef = useRef(true);
  const combatUseDiceBonusRef = useRef(true);
  const currentPlayerRef = useRef(currentPlayer);
  const teleportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hiddenGemTeleportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const teleportAutoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const teleportPickerRef = useRef(teleportPicker);
  const handleTeleportSelectRef = useRef<(destX: number, destY: number) => void>(() => {});
  const currentPlayerCellRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    teleportPickerRef.current = teleportPicker;
  }, [teleportPicker]);

  useEffect(() => {
    return () => {
      if (teleportTimerRef.current) {
        clearTimeout(teleportTimerRef.current);
        teleportTimerRef.current = null;
      }
      if (hiddenGemTeleportTimerRef.current) {
        clearTimeout(hiddenGemTeleportTimerRef.current);
        hiddenGemTeleportTimerRef.current = null;
      }
      if (teleportAutoTimerRef.current) {
        clearTimeout(teleportAutoTimerRef.current);
        teleportAutoTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    movesLeftRef.current = movesLeft;
  }, [movesLeft]);
  useEffect(() => {
    winnerRef.current = winner;
    currentPlayerRef.current = currentPlayer;
  }, [winner, currentPlayer]);
  useEffect(() => {
    combatStateRef.current = combatState;
  }, [combatState]);
  useEffect(() => {
    combatUseShieldRef.current = combatUseShield;
  }, [combatUseShield]);
  useEffect(() => {
    combatUseDiceBonusRef.current = combatUseDiceBonus;
  }, [combatUseDiceBonus]);

  // Cancel combat if monster was cleared (e.g. by bomb) before player rolled
  useEffect(() => {
    if (!combatState || !lab) return;
    const collision = lab.checkMonsterCollision(combatState.playerIndex);
    if (!collision) {
      setCombatState(null);
      setCombatUseShield(true);
      setCombatUseDiceBonus(true);
    }
  }, [lab, combatState]);

  // Init combat options when combat starts (default: use if available)
  const prevCombatKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!combatState || !lab) {
      prevCombatKeyRef.current = null;
      return;
    }
    const key = `${combatState.playerIndex}-${combatState.monsterIndex}`;
    if (prevCombatKeyRef.current === key) return;
    prevCombatKeyRef.current = key;
    const p = lab.players[combatState.playerIndex];
    setCombatUseShield((p?.shield ?? 0) > 0);
    setCombatUseDiceBonus((p?.diceBonus ?? 0) > 0);
  }, [combatState, lab]);

  // Focus/scroll to current player marker only when turn changes to another player (not on every move)
  useEffect(() => {
    if (winner !== null || !lab || lab.eliminatedPlayers.has(currentPlayer)) return;
    const el = currentPlayerCellRef.current;
    if (el) {
      const id = requestAnimationFrame(() => {
        el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      });
      return () => cancelAnimationFrame(id);
    }
  }, [currentPlayer, winner]);

  useEffect(() => {
    setPlayerNames((prev) => {
      const n = Math.min(Math.max(1, numPlayers), 10);
      if (prev.length === n) return prev;
      if (prev.length < n) {
        return [
          ...prev,
          ...Array.from({ length: n - prev.length }, (_, i) => `Player ${prev.length + i + 1}`),
        ];
      }
      return prev.slice(0, n);
    });
    const n = Math.min(Math.max(1, numPlayers), 10);
    setPlayerTurns((prev) => (prev.length === n ? prev : [...prev.slice(0, n), ...Array(Math.max(0, n - prev.length)).fill(0)]));
    setPlayerMoves((prev) => (prev.length === n ? prev : [...prev.slice(0, n), ...Array(Math.max(0, n - prev.length)).fill(0)]));
  }, [numPlayers]);


  const DICE_PANEL_WIDTH = 220;
  const DICE_PANEL_HEIGHT = 260;
  const diceDrag = useDraggable(() => ({
    x: window.innerWidth - DICE_PANEL_WIDTH - 20,
    y: 20,
  }));
  const controlsDrag = useDraggable(() => ({
    x: diceDrag.pos.x,
    y: diceDrag.pos.y + DICE_PANEL_HEIGHT,
  }));

  useEffect(() => {
    if (!teleportAnimation) return;
    const t = setTimeout(() => setTeleportAnimation(null), 600);
    return () => clearTimeout(t);
  }, [teleportAnimation]);

  useEffect(() => {
    if (!catapultAnimation) return;
    const t = setTimeout(() => setCatapultAnimation(null), 600);
    return () => clearTimeout(t);
  }, [catapultAnimation]);

  useEffect(() => {
    if (!jumpAnimation) return;
    const t = setTimeout(() => setJumpAnimation(null), 500);
    return () => clearTimeout(t);
  }, [jumpAnimation]);

  useEffect(() => {
    if (!eliminatedByMonster) return;
    const t = setTimeout(() => setEliminatedByMonster(null), 3000);
    return () => clearTimeout(t);
  }, [eliminatedByMonster]);

  useEffect(() => {
    if (jumpAdded === null) return;
    const t = setTimeout(() => setJumpAdded(null), 1500);
    return () => clearTimeout(t);
  }, [jumpAdded]);

  useEffect(() => {
    if (shieldAbsorbed === null) return;
    const t = setTimeout(() => setShieldAbsorbed(null), 1500);
    return () => clearTimeout(t);
  }, [shieldAbsorbed]);

  useEffect(() => {
    if (shieldGained === null) return;
    const t = setTimeout(() => setShieldGained(null), 1500);
    return () => clearTimeout(t);
  }, [shieldGained]);

  useEffect(() => {
    if (healingGained === null) return;
    const t = setTimeout(() => setHealingGained(null), 1500);
    return () => clearTimeout(t);
  }, [healingGained]);

  useEffect(() => {
    if (harmTaken === null) return;
    const t = setTimeout(() => setHarmTaken(null), 1500);
    return () => clearTimeout(t);
  }, [harmTaken]);

  useEffect(() => {
    if (bombGained === null) return;
    const t = setTimeout(() => setBombGained(null), 1500);
    return () => clearTimeout(t);
  }, [bombGained]);

  useEffect(() => {
    if (hiddenGemTeleport === null) return;
    const t = setTimeout(() => setHiddenGemTeleport(null), 1500);
    return () => clearTimeout(t);
  }, [hiddenGemTeleport]);

  useEffect(() => {
    if (cellsRevealed === null) return;
    const t = setTimeout(() => setCellsRevealed(null), 2000);
    return () => clearTimeout(t);
  }, [cellsRevealed]);

  useEffect(() => {
    if (webSlowed === null) return;
    const t = setTimeout(() => setWebSlowed(null), 1500);
    return () => clearTimeout(t);
  }, [webSlowed]);

  useEffect(() => {
    if (!collisionEffect) return;
    const t = setTimeout(() => setCollisionEffect(null), 600);
    return () => clearTimeout(t);
  }, [collisionEffect]);

  useEffect(() => {
    if (turnChangeEffect === null) return;
    const t = setTimeout(() => setTurnChangeEffect(null), 1800);
    return () => clearTimeout(t);
  }, [turnChangeEffect]);

  useEffect(() => {
    if (torchGained === null) return;
    const t = setTimeout(() => setTorchGained(null), 1500);
    return () => clearTimeout(t);
  }, [torchGained]);

  const getDimensions = useCallback(() => {
    return mazeSize;
  }, [mazeSize]);

  const newGame = useCallback(() => {
    const n = Math.min(Math.max(1, numPlayers), 9);
    const size = getDimensions();
    const extraPaths = Math.max(4, n * 2);
    const l = new Labyrinth(size, size, extraPaths, n, difficulty);
    l.generate();
    if (teleportTimerRef.current) {
      clearTimeout(teleportTimerRef.current);
      teleportTimerRef.current = null;
    }
    if (hiddenGemTeleportTimerRef.current) {
      clearTimeout(hiddenGemTeleportTimerRef.current);
      hiddenGemTeleportTimerRef.current = null;
    }
    setLab(l);
    setCurrentPlayer(0);
    movesLeftRef.current = 0;
    setMovesLeft(0);
    setTotalMoves(0);
    setPlayerTurns(Array(n).fill(0));
    setPlayerMoves(Array(n).fill(0));
    setDiceResult(null);
    setWinner(null);
    setError("");
    setBonusAdded(null);
    setJumpAdded(null);
    setShieldAbsorbed(null);
    setWebSlowed(null);
    setShieldGained(null);
    setHealingGained(null);
    setHarmTaken(null);
    setBombGained(null);
    setHiddenGemTeleport(null);
    setTorchGained(null);
    setCellsRevealed(null);
    setEliminatedByMonster(null);
    setTeleportAnimation(null);
    setJumpAnimation(null);
    setTeleportPicker(null);
    setCatapultPicker(null);
    setCatapultMode(false);
    setCatapultDragOffset(null);
    setCatapultAnimation(null);
    setBombExplosion(null);
    setCombatState(null);
    setCombatResult(null);
    setCollisionEffect(null);
    setTurnChangeEffect(null);
  }, [getDimensions, numPlayers, difficulty]);

  const generateWithAI = useCallback(async () => {
    const n = Math.min(Math.max(1, numPlayers), 9);
    const numPaths = n * 2;
    setError("Generating maze...");
    try {
      const res = await fetch("/api/generate-maze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          numPaths,
          width: getDimensions(),
          height: getDimensions(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "API error");
        return;
      }
      const size = getDimensions();
      const w = data.width ?? size;
      const h = data.height ?? size;
      const l = new Labyrinth(w, h, 0, n, difficulty);
      if (l.loadGrid(data.grid)) {
        if (teleportTimerRef.current) {
          clearTimeout(teleportTimerRef.current);
          teleportTimerRef.current = null;
        }
        if (hiddenGemTeleportTimerRef.current) {
          clearTimeout(hiddenGemTeleportTimerRef.current);
          hiddenGemTeleportTimerRef.current = null;
        }
        setLab(l);
        setCurrentPlayer(0);
        movesLeftRef.current = 0;
        setMovesLeft(0);
        setTotalMoves(0);
        setPlayerTurns(Array(n).fill(0));
        setPlayerMoves(Array(n).fill(0));
        setDiceResult(null);
        setWinner(null);
        setError("");
        setBonusAdded(null);
        setJumpAdded(null);
        setShieldAbsorbed(null);
        setWebSlowed(null);
        setShieldGained(null);
        setHealingGained(null);
        setBombGained(null);
        setHiddenGemTeleport(null);
        setTorchGained(null);
        setCellsRevealed(null);
        setTeleportAnimation(null);
        setCatapultMode(false);
        setCatapultPicker(null);
        setCatapultDragOffset(null);
        setCatapultAnimation(null);
        setBombExplosion(null);
        setCombatState(null);
        setCombatResult(null);
      } else {
        setError("Invalid maze from AI, using random maze.");
        newGame();
      }
    } catch (e) {
      setError(
        "Failed to reach API: " + (e instanceof Error ? e.message : "network error")
      );
      newGame();
    }
  }, [getDimensions, numPlayers, newGame, difficulty]);

  const handleRollComplete = useCallback((value: number) => {
    const combat = combatStateRef.current;
    if (combat) {
      // Combat roll: resolve and update state (dice always rolled before fight)
      const p = lab?.players[combat.playerIndex];
      const attackBonus = Math.min(1, p?.attackBonus ?? 0); // 0-1 from defeating Dracula
      const diceBonus = p?.diceBonus ?? 0;
      const useDiceBonus = combatUseDiceBonusRef.current && diceBonus > 0;
      const effectiveRoll = value + (useDiceBonus ? 1 : 0);
      const monster = lab?.monsters[combat.monsterIndex];
      const skeletonHasShield = combat.monsterType === "K" && (monster?.hasShield ?? true);
      const result = resolveCombat(effectiveRoll, attackBonus, combat.monsterType, skeletonHasShield);
      setCombatResult({ ...result, monsterType: combat.monsterType });
      setRolling(false);
      setLab((prev) => {
        if (!prev || winnerRef.current !== null) return prev;
        const next = new Labyrinth(prev.width, prev.height, 0, prev.numPlayers, prev.monsterDensity);
        next.grid = prev.grid.map((r) => [...r]);
        const useDiceBonusInCombat = combatUseDiceBonusRef.current && (prev.players[combat.playerIndex]?.diceBonus ?? 0) > 0;
        next.players = prev.players.map((p, i) => ({
          ...p,
          jumps: p.jumps ?? 0,
          diamonds: p.diamonds ?? 0,
          shield: p.shield ?? 0,
          bombs: p.bombs ?? 0,
          hp: p.hp ?? 3,
          artifacts: p.artifacts ?? 0,
          diceBonus: i === combat.playerIndex && useDiceBonusInCombat ? Math.max(0, (p.diceBonus ?? 0) - 1) : (p.diceBonus ?? 0),
        }));
        next.hiddenCells = new Map(prev.hiddenCells);
        next.webPositions = [...(prev.webPositions || [])];
        next.fogZones = new Map(prev.fogZones || new Map());
        next.bombCollectedBy = new Map([...(prev.bombCollectedBy || new Map()).entries()].map(([k, v]) => [k, new Set(v)]));
        next.teleportUsedFrom = new Map([...(prev.teleportUsedFrom || new Map()).entries()].map(([k, v]) => [k, new Set(v)]));
        next.teleportUsedTo = new Map([...(prev.teleportUsedTo || new Map()).entries()].map(([k, v]) => [k, new Set(v)]));
        next.catapultUsedFrom = new Map([...(prev.catapultUsedFrom || new Map()).entries()].map(([k, v]) => [k, new Set(v)]));
        next.visitedCells = new Set(prev.visitedCells || []);
        next.goalX = prev.goalX;
        next.goalY = prev.goalY;
        next.monsters = prev.monsters.map((m) => ({ ...m, patrolArea: [...m.patrolArea] }));
        next.eliminatedPlayers = new Set(prev.eliminatedPlayers);
        const pi = combat.playerIndex;
        const p = next.players[pi];
        const monsterIdx = combat.monsterIndex;
        const m = monsterIdx >= 0 && monsterIdx < next.monsters.length ? next.monsters[monsterIdx] : null;

        // Skeleton shield break: first hit removes shield, separate player and monster
        if (result.monsterEffect === "skeleton_shield" && m) {
          m.hasShield = false;
          if (combat.prevX !== undefined && combat.prevY !== undefined && p) {
            p.x = combat.prevX;
            p.y = combat.prevY;
          } else if (p) {
            // Monster-initiated combat: push skeleton to adjacent cell
            const dirs: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
            for (const [dx, dy] of dirs) {
              const nx = m.x + dx;
              const ny = m.y + dy;
              if (nx >= 0 && nx < next.width && ny >= 0 && ny < next.height && next.grid[ny]?.[nx] === " ") {
                m.x = nx;
                m.y = ny;
                break;
              }
            }
          }
          setCombatState(null);
          setCombatUseShield(true);
          setCombatUseDiceBonus(true);
          setTimeout(() => setCombatResult(null), 2000);
          return next;
        }

        if (result.won && monsterIdx >= 0 && monsterIdx < next.monsters.length && m) {
          // Spider: web remains on tile when defeated
          if (combat.monsterType === "S") {
            const webKey = `${m.x},${m.y}`;
            if (!next.webPositions.some(([wx, wy]) => wx === m.x && wy === m.y)) {
              next.webPositions.push([m.x, m.y]);
            }
          }
          next.monsters.splice(monsterIdx, 1);
          // Apply monster reward
          if (p && result.reward) {
            const r = result.reward;
            if (r.type === "jump") p.jumps = (p.jumps ?? 0) + r.amount;
            if (r.type === "movement") p.diceBonus = (p.diceBonus ?? 0) + r.amount; // +1 to next roll
            if (r.type === "hp") p.hp = Math.min(DEFAULT_PLAYER_HP, (p.hp ?? 3) + r.amount);
            if (r.type === "shield") p.shield = (p.shield ?? 0) + r.amount;
            if (r.type === "attackBonus") p.attackBonus = Math.min(1, (p.attackBonus ?? 0) + r.amount);
          }
          if (pi === currentPlayerRef.current) {
            movesLeftRef.current = 0;
            setMovesLeft(0);
            setDiceResult(null);
            let nextP = (pi + 1) % next.numPlayers;
            while (next.eliminatedPlayers.has(nextP) && nextP !== pi) {
              nextP = (nextP + 1) % next.numPlayers;
            }
            const living = [...Array(next.numPlayers).keys()].filter((i) => !next.eliminatedPlayers.has(i));
            const firstLiving = living.length > 0 ? Math.min(...living) : -1;
            const roundComplete = living.length <= 1 || nextP === firstLiving;
            setTurnChangeEffect(nextP);
            setCurrentPlayer(nextP);
            if (roundComplete) setTimeout(() => triggerRoundEnd(), 0);
          }
        } else if (!result.won && p) {
          const useShield = combatUseShieldRef.current;
          const usedShield = useShield ? next.tryConsumeShield(pi) : false;
          if (usedShield) {
            setShieldAbsorbed(true);
            setCombatResult((prev) => (prev ? { ...prev, shieldAbsorbed: true } : null));
          } else {
            p.hp = (p.hp ?? 3) - result.damage;
            if (combat.monsterType === "Z") p.loseNextMove = true; // Zombie slow: lose next movement point
            if (p.hp <= 0) {
              // Respawn at start, lose 1 artifact (instead of elimination)
              p.x = 0;
              p.y = 0;
              p.hp = DEFAULT_PLAYER_HP;
              if (p.artifacts > 0) {
                p.artifacts--;
                const ac = p.artifactsCollected ?? [];
                if (ac.length > 0) p.artifactsCollected = ac.slice(0, -1);
              }
              setEliminatedByMonster({ playerIndex: pi, monsterType: combat.monsterType }); // Shows "respawned" message
              if (pi === currentPlayerRef.current) {
                movesLeftRef.current = 0;
                setMovesLeft(0);
                setDiceResult(null);
                let nextP = (pi + 1) % next.numPlayers;
                while (next.eliminatedPlayers.has(nextP) && nextP !== pi) {
                  nextP = (nextP + 1) % next.numPlayers;
                }
                setTurnChangeEffect(nextP);
                setCurrentPlayer(nextP);
                const living = [...Array(next.numPlayers).keys()].filter((i) => !next.eliminatedPlayers.has(i));
                const firstLiving = living.length > 0 ? Math.min(...living) : -1;
                const roundComplete = living.length <= 1 || nextP === firstLiving;
                if (roundComplete) setTimeout(() => triggerRoundEnd(), 0);
              }
            }
          }
        }
        return next;
      });
      setCombatState(null);
      setCombatUseShield(true);
      setCombatUseDiceBonus(true);
      setTimeout(() => setCombatResult(null), 2000);
      return;
    }
    const p = lab?.players[currentPlayerRef.current];
    const bonus = p?.diceBonus ?? 0;
    let totalValue = Math.min(6, value + bonus);
    if (p?.loseNextMove) {
      totalValue = Math.max(1, totalValue - 1);
      setLab((prev) => {
        if (!prev) return prev;
        const next = new Labyrinth(prev.width, prev.height, 0, prev.numPlayers, prev.monsterDensity);
        next.grid = prev.grid.map((r) => [...r]);
        next.players = prev.players.map((pl, i) => ({
          ...pl,
          loseNextMove: i === currentPlayerRef.current ? false : pl.loseNextMove ?? false,
        }));
        next.goalX = prev.goalX;
        next.goalY = prev.goalY;
        next.monsters = prev.monsters.map((m) => ({ ...m, patrolArea: [...m.patrolArea] }));
        next.eliminatedPlayers = new Set(prev.eliminatedPlayers);
        next.hiddenCells = new Map(prev.hiddenCells);
        next.webPositions = [...(prev.webPositions || [])];
        next.fogZones = new Map(prev.fogZones || new Map());
        next.bombCollectedBy = new Map([...(prev.bombCollectedBy || new Map()).entries()].map(([k, v]) => [k, new Set(v)]));
        next.teleportUsedFrom = new Map([...(prev.teleportUsedFrom || new Map()).entries()].map(([k, v]) => [k, new Set(v)]));
        next.teleportUsedTo = new Map([...(prev.teleportUsedTo || new Map()).entries()].map(([k, v]) => [k, new Set(v)]));
        next.catapultUsedFrom = new Map([...(prev.catapultUsedFrom || new Map()).entries()].map(([k, v]) => [k, new Set(v)]));
        next.visitedCells = new Set(prev.visitedCells || []);
        return next;
      });
    }
    if (bonus > 0 && lab) {
      setLab((prev) => {
        if (!prev) return prev;
        const next = new Labyrinth(prev.width, prev.height, 0, prev.numPlayers, prev.monsterDensity);
        next.grid = prev.grid.map((r) => [...r]);
        next.players = prev.players.map((pl, i) => ({
          ...pl,
          jumps: pl.jumps ?? 0,
          diamonds: pl.diamonds ?? 0,
          shield: pl.shield ?? 0,
          bombs: pl.bombs ?? 0,
          hp: pl.hp ?? 3,
          artifacts: pl.artifacts ?? 0,
          diceBonus: i === currentPlayerRef.current ? 0 : pl.diceBonus ?? 0,
        }));
        next.goalX = prev.goalX;
        next.goalY = prev.goalY;
        next.monsters = prev.monsters.map((m) => ({ ...m, patrolArea: [...m.patrolArea] }));
        next.eliminatedPlayers = new Set(prev.eliminatedPlayers);
        next.hiddenCells = new Map(prev.hiddenCells);
        next.webPositions = [...(prev.webPositions || [])];
        next.fogZones = new Map(prev.fogZones || new Map());
        next.bombCollectedBy = new Map([...(prev.bombCollectedBy || new Map()).entries()].map(([k, v]) => [k, new Set(v)]));
        next.teleportUsedFrom = new Map([...(prev.teleportUsedFrom || new Map()).entries()].map(([k, v]) => [k, new Set(v)]));
        next.teleportUsedTo = new Map([...(prev.teleportUsedTo || new Map()).entries()].map(([k, v]) => [k, new Set(v)]));
        next.catapultUsedFrom = new Map([...(prev.catapultUsedFrom || new Map()).entries()].map(([k, v]) => [k, new Set(v)]));
        next.visitedCells = new Set(prev.visitedCells || []);
        return next;
      });
    }
    setDiceResult(totalValue);
    movesLeftRef.current = totalValue;
    setMovesLeft(totalValue);
    setRolling(false);
    setBonusAdded(null);
    setPlayerTurns((prev) => {
      const next = [...prev];
      if (currentPlayerRef.current < next.length) next[currentPlayerRef.current] = (next[currentPlayerRef.current] ?? 0) + 1;
      return next;
    });
  }, []);

  const rollDice = useCallback(async () => {
    if (winner !== null || !lab) return;
    if (!combatState && movesLeft > 0) return;
    setRolling(true);
    await diceRef.current?.roll();
  }, [lab, movesLeft, winner, combatState]);

  const triggerRoundEnd = useCallback(() => {
    setLab((prev) => {
      if (!prev || winnerRef.current !== null) return prev;
      const newRound = (prev.round ?? 0) + 1;
      if (newRound >= MAX_ROUNDS) {
        const winnerByArtifacts = prev.getPlayerWithMostArtifacts();
        if (winnerByArtifacts !== null) setTimeout(() => setWinner(winnerByArtifacts), 0);
      }
      if (Math.random() < 0.35) {
        const ev = drawEvent();
        const next = new Labyrinth(prev.width, prev.height, 0, prev.numPlayers, prev.monsterDensity);
        next.grid = prev.grid.map((r) => [...r]);
        next.players = prev.players.map((p) => ({ ...p }));
        next.monsters = prev.monsters.map((m) => ({ ...m, patrolArea: [...m.patrolArea] }));
        next.eliminatedPlayers = new Set(prev.eliminatedPlayers);
        next.hiddenCells = new Map(prev.hiddenCells);
        next.webPositions = [...(prev.webPositions || [])];
        next.fogZones = new Map(prev.fogZones || new Map());
        next.bombCollectedBy = new Map([...(prev.bombCollectedBy || new Map()).entries()].map(([k, v]) => [k, new Set(v)]));
        next.teleportUsedFrom = new Map([...(prev.teleportUsedFrom || new Map()).entries()].map(([k, v]) => [k, new Set(v)]));
        next.teleportUsedTo = new Map([...(prev.teleportUsedTo || new Map()).entries()].map(([k, v]) => [k, new Set(v)]));
        next.catapultUsedFrom = new Map([...(prev.catapultUsedFrom || new Map()).entries()].map(([k, v]) => [k, new Set(v)]));
        next.visitedCells = new Set(prev.visitedCells || []);
        next.goalX = prev.goalX;
        next.goalY = prev.goalY;
        next.round = newRound;
        applyEvent(next, ev);
        return next;
      }
      const next = new Labyrinth(prev.width, prev.height, 0, prev.numPlayers, prev.monsterDensity);
      next.grid = prev.grid.map((r) => [...r]);
      next.players = prev.players.map((p) => ({ ...p }));
      next.monsters = prev.monsters.map((m) => ({ ...m, patrolArea: [...m.patrolArea] }));
      next.eliminatedPlayers = new Set(prev.eliminatedPlayers);
      next.hiddenCells = new Map(prev.hiddenCells);
      next.webPositions = [...(prev.webPositions || [])];
      next.fogZones = new Map(prev.fogZones || new Map());
      next.bombCollectedBy = new Map([...(prev.bombCollectedBy || new Map()).entries()].map(([k, v]) => [k, new Set(v)]));
      next.teleportUsedFrom = new Map([...(prev.teleportUsedFrom || new Map()).entries()].map(([k, v]) => [k, new Set(v)]));
      next.teleportUsedTo = new Map([...(prev.teleportUsedTo || new Map()).entries()].map(([k, v]) => [k, new Set(v)]));
      next.catapultUsedFrom = new Map([...(prev.catapultUsedFrom || new Map()).entries()].map(([k, v]) => [k, new Set(v)]));
      next.visitedCells = new Set(prev.visitedCells || []);
      next.goalX = prev.goalX;
      next.goalY = prev.goalY;
      next.round = newRound;
      return next;
    });
  }, []);

  const endTurn = useCallback(() => {
    if (winner !== null || !lab) return;
    let nextP = (currentPlayer + 1) % lab.numPlayers;
    while (lab.eliminatedPlayers.has(nextP) && nextP !== currentPlayer) {
      nextP = (nextP + 1) % lab.numPlayers;
    }
    const living = [...Array(lab.numPlayers).keys()].filter((i) => !lab.eliminatedPlayers.has(i));
    const firstLiving = living.length > 0 ? Math.min(...living) : -1;
    const roundComplete = living.length <= 1 || nextP === firstLiving;
    setTurnChangeEffect(nextP);
    setCurrentPlayer(nextP);
    movesLeftRef.current = 0;
    setMovesLeft(0);
    setDiceResult(null);
    setBonusAdded(null);
    if (roundComplete) {
      triggerRoundEnd();
    }
  }, [lab, winner, currentPlayer, triggerRoundEnd]);

  const handleUseBomb = useCallback(() => {
    if (!lab || winner !== null || lab.eliminatedPlayers.has(currentPlayer)) return;
    const cp = lab.players[currentPlayer];
    const inCombat = !!combatStateRef.current;
    if (!cp || (cp.bombs ?? 0) <= 0) return;
    if (!inCombat && movesLeftRef.current <= 0) return;
    const next = new Labyrinth(lab.width, lab.height, 0, lab.numPlayers, lab.monsterDensity);
    next.grid = lab.grid.map((r) => [...r]);
    next.players = lab.players.map((p) => ({ ...p, jumps: p.jumps ?? 0, diamonds: p.diamonds ?? 0, shield: p.shield ?? 0, bombs: p.bombs ?? 0 }));
    next.hiddenCells = new Map(lab.hiddenCells);
    next.webPositions = [...(lab.webPositions || [])];
    next.fogZones = new Map(lab.fogZones || new Map());
    next.bombCollectedBy = new Map([...(lab.bombCollectedBy || new Map()).entries()].map(([k, v]) => [k, new Set(v)]));
    next.teleportUsedFrom = new Map([...(lab.teleportUsedFrom || new Map()).entries()].map(([k, v]) => [k, new Set(v)]));
    next.teleportUsedTo = new Map([...(lab.teleportUsedTo || new Map()).entries()].map(([k, v]) => [k, new Set(v)]));
    next.catapultUsedFrom = new Map([...(lab.catapultUsedFrom || new Map()).entries()].map(([k, v]) => [k, new Set(v)]));
    next.visitedCells = new Set(lab.visitedCells || []);
    next.goalX = lab.goalX;
    next.goalY = lab.goalY;
    next.monsters = lab.monsters.map((m) => ({ ...m, patrolArea: [...m.patrolArea] }));
    next.eliminatedPlayers = new Set(lab.eliminatedPlayers);
    const result = next.useBomb(currentPlayer);
    if (!result.used) return;
    setBombExplosion({ x: cp.x, y: cp.y });
    setLab(next);
    if (!inCombat) {
      movesLeftRef.current--;
      setMovesLeft((m) => Math.max(0, m - 1));
      setTotalMoves((t) => t + 1);
      setPlayerMoves((prev) => {
        const arr = [...prev];
        if (currentPlayer < arr.length) arr[currentPlayer] = (arr[currentPlayer] ?? 0) + 1;
        return arr;
      });
    }
    setTimeout(() => setBombExplosion(null), 600);
  }, [lab, winner, currentPlayer]);

  const doMove = useCallback(
    (dx: number, dy: number, jumpOnly = false) => {
      if (winner !== null || !lab) return;
      if (movesLeftRef.current <= 0) return;
      if (teleportTimerRef.current) {
        clearTimeout(teleportTimerRef.current);
        teleportTimerRef.current = null;
      }
      if (hiddenGemTeleportTimerRef.current) {
        clearTimeout(hiddenGemTeleportTimerRef.current);
        hiddenGemTeleportTimerRef.current = null;
      }
      setTeleportPicker(null);
      setCatapultPicker(null);
      setCatapultMode(false);
      setCatapultDragOffset(null);
      const p = lab.players[currentPlayer]!;
      const destX = jumpOnly ? p.x + 2 * dx : p.x + dx;
      const destY = jumpOnly ? p.y + 2 * dy : p.y + dy;
      const tileCost = lab.getTileMoveCost(destX, destY);
      const isWebCell = lab.webPositions?.some(([wx, wy]) => wx === destX && wy === destY);
      if (movesLeftRef.current < 1) return;
      const costToPay = Math.min(movesLeftRef.current, tileCost);
      movesLeftRef.current -= costToPay;
      setBonusAdded(null);
      setJumpAdded(null);
      if (isWebCell) setWebSlowed(true);
      const next = new Labyrinth(lab.width, lab.height, 0, lab.numPlayers, lab.monsterDensity);
      next.grid = lab.grid.map((r) => [...r]);
      next.players = lab.players.map((p) => ({
        ...p,
        jumps: p.jumps ?? 0,
        diamonds: p.diamonds ?? 0,
        shield: p.shield ?? 0,
        bombs: p.bombs ?? 0,
      }));
      next.hiddenCells = new Map(lab.hiddenCells);
      next.webPositions = [...(lab.webPositions || [])];
      next.fogZones = new Map(lab.fogZones || new Map());
      next.bombCollectedBy = new Map([...(lab.bombCollectedBy || new Map()).entries()].map(([k, v]) => [k, new Set(v)]));
      next.teleportUsedFrom = new Map([...(lab.teleportUsedFrom || new Map()).entries()].map(([k, v]) => [k, new Set(v)]));
      next.teleportUsedTo = new Map([...(lab.teleportUsedTo || new Map()).entries()].map(([k, v]) => [k, new Set(v)]));
      next.catapultUsedFrom = new Map([...(lab.catapultUsedFrom || new Map()).entries()].map(([k, v]) => [k, new Set(v)]));
      next.visitedCells = new Set(lab.visitedCells || []);
      next.goalX = lab.goalX;
      next.goalY = lab.goalY;
      next.monsters = lab.monsters.map((m) => ({
        ...m,
        patrolArea: [...m.patrolArea],
      }));
      next.eliminatedPlayers = new Set(lab.eliminatedPlayers);
      const moveSucceeded = next.movePlayer(dx, dy, currentPlayer, jumpOnly);
      if (!moveSucceeded) {
        movesLeftRef.current += costToPay;
        return;
      }
      {
        const newMovesLeft = Math.max(0, movesLeftRef.current);
        setMovesLeft(newMovesLeft);
        setTotalMoves((t) => t + 1);
        setPlayerMoves((prev) => {
          const next = [...prev];
          if (currentPlayer < next.length) next[currentPlayer] = (next[currentPlayer] ?? 0) + 1;
          return next;
        });
        const p = next.players[currentPlayer];
        const prevX = lab.players[currentPlayer]?.x ?? 0;
        const prevY = lab.players[currentPlayer]?.y ?? 0;
        let teleportedThisMove = false;
        let teleportPickerSet = false;
        if (jumpOnly && p) {
          setJumpAnimation({ playerIndex: currentPlayer, x: p.x, y: p.y });
        }
        if (p) {
          const cell = next.getCellAt(p.x, p.y);
          if (cell && next.hiddenCells.has(`${p.x},${p.y}`)) next.revealCellAt(p.x, p.y);
          if (cell && isTrapCell(cell)) {
            if (cell === TRAP_LOSE_TURN) {
              movesLeftRef.current = 0;
              setMovesLeft(0);
              setDiceResult(null);
              let nextP = (currentPlayer + 1) % lab.numPlayers;
              while (lab.eliminatedPlayers.has(nextP) && nextP !== currentPlayer) {
                nextP = (nextP + 1) % lab.numPlayers;
              }
              setTurnChangeEffect(nextP);
              setCurrentPlayer(nextP);
            } else if (cell === TRAP_HARM) {
              const usedShield = next.tryConsumeShield(currentPlayer);
              if (usedShield) setShieldAbsorbed(true);
              else {
                p.hp = (p.hp ?? 3) - 1;
                setHarmTaken(true);
                if (p.hp <= 0) {
                  next.eliminatedPlayers.add(currentPlayer);
                  setEliminatedByMonster({ playerIndex: currentPlayer, monsterType: "Z" });
                  if (next.eliminatedPlayers.size >= next.numPlayers) setWinner(-1);
                  movesLeftRef.current = 0;
                  setMovesLeft(0);
                  setDiceResult(null);
                  let nextP = (currentPlayer + 1) % lab.numPlayers;
                  while (next.eliminatedPlayers.has(nextP) && nextP !== currentPlayer) {
                    nextP = (nextP + 1) % lab.numPlayers;
                  }
                  setTurnChangeEffect(nextP);
                  setCurrentPlayer(nextP);
                }
              }
            } else if (cell === TRAP_TELEPORT) {
              const dest = next.getRandomPathCell();
              if (dest) {
                const [fromX, fromY] = [p.x, p.y];
                p.x = dest[0];
                p.y = dest[1];
                next.recordVisited(dest[0], dest[1]);
                setTeleportAnimation({ from: [fromX, fromY], to: dest, playerIndex: currentPlayer });
                movesLeftRef.current = 0;
                setMovesLeft(0);
                setDiceResult(null);
                teleportedThisMove = true;
                let nextP = (currentPlayer + 1) % lab.numPlayers;
                while (next.eliminatedPlayers.has(nextP) && nextP !== currentPlayer) {
                  nextP = (nextP + 1) % lab.numPlayers;
                }
                const living = [...Array(next.numPlayers).keys()].filter((i) => !next.eliminatedPlayers.has(i));
                const firstLiving = living.length > 0 ? Math.min(...living) : -1;
                const roundComplete = living.length <= 1 || nextP === firstLiving;
                setCurrentPlayer(nextP);
                if (roundComplete) setTimeout(() => triggerRoundEnd(), 0);
              }
            }
          }
          if (cell && isArtifactCell(cell)) {
            p.artifacts = (p.artifacts ?? 0) + 1;
            const ac = p.artifactsCollected ?? [];
            p.artifactsCollected = [...ac, cell];
            if (cell === ARTIFACT_DICE) p.diceBonus = (p.diceBonus ?? 0) + 1;
            if (cell === ARTIFACT_SHIELD) p.shield = (p.shield ?? 0) + 1;
            if (cell === ARTIFACT_TELEPORT_CELL) p.hasTeleportArtifact = true;
            if (cell === ARTIFACT_REVEAL) {
              const totalDiamonds = next.players.reduce((s, pl) => s + (pl.diamonds ?? 0), 0) + 1;
              const revealed = next.revealHiddenCells(totalDiamonds);
              if (revealed > 0) setCellsRevealed(revealed);
            }
            if (cell === ARTIFACT_HEALING) {
              p.hp = Math.min(DEFAULT_PLAYER_HP, (p.hp ?? 3) + 1);
              setHealingGained(true);
            }
            next.grid[p.y][p.x] = PATH;
          }
          if (cell && isJumpCell(cell)) {
            const mult = 1;
            p.jumps = (p.jumps ?? 0) + mult;
            setJumpAdded(mult);
          }
          if (cell && isShieldCell(cell)) {
            p.shield = (p.shield ?? 0) + 1;
            setShieldGained(true);
            next.grid[p.y][p.x] = PATH;
          }
          if (cell && isBombCell(cell) && !next.hasCollectedBombFrom(currentPlayer, p.x, p.y)) {
            p.bombs = (p.bombs ?? 0) + 1;
            next.recordBombCollected(currentPlayer, p.x, p.y);
            setBombGained(true);
          }
          if (cell && isMagicCell(cell) && !next.hasUsedTeleportFrom(currentPlayer, p.x, p.y)) {
            const dest = next.getRandomTeleportDestination(currentPlayer);
            if (dest) {
              const [fromX, fromY] = [p.x, p.y];
              p.x = dest[0];
              p.y = dest[1];
              next.recordVisited(dest[0], dest[1]);
              next.recordTeleportUsedFrom(currentPlayer, fromX, fromY);
              setTeleportAnimation({ from: [fromX, fromY], to: dest, playerIndex: currentPlayer });
              movesLeftRef.current = 0;
              setMovesLeft(0);
              setDiceResult(null);
              teleportedThisMove = true;
              let nextP = (currentPlayer + 1) % next.numPlayers;
              while (next.eliminatedPlayers.has(nextP) && nextP !== currentPlayer) {
                nextP = (nextP + 1) % next.numPlayers;
              }
              const living = [...Array(next.numPlayers).keys()].filter((i) => !next.eliminatedPlayers.has(i));
              const firstLiving = living.length > 0 ? Math.min(...living) : -1;
              const roundComplete = living.length <= 1 || nextP === firstLiving;
              setTurnChangeEffect(nextP);
              setCurrentPlayer(nextP);
              if (roundComplete) setTimeout(() => triggerRoundEnd(), 0);
            }
          }
          if (cell && isCatapultCell(cell) && !next.hasUsedCatapultFrom(currentPlayer, p.x, p.y)) {
            setCatapultPicker({ playerIndex: currentPlayer, from: [p.x, p.y] });
            setCatapultMode(true);
          }
          const owner = cell ? getCollectibleOwner(cell) : null;
          if (owner === currentPlayer && cell && isDiamondCell(cell)) {
            p.diamonds = (p.diamonds ?? 0) + 1;
            next.grid[p.y][p.x] = PATH;
            const totalDiamonds = next.players.reduce((s, pl) => s + (pl.diamonds ?? 0), 0);
            const revealed = next.revealHiddenCells(totalDiamonds);
            if (revealed > 0) setCellsRevealed(revealed);
            // Random hidden gem in some diamonds: shield, jump, teleport, or torch
            if (Math.random() < 0.45) {
              const gems = ["shield", "jump", "teleport", "torch"] as const;
              const gem = gems[Math.floor(Math.random() * gems.length)];
              if (gem === "shield") {
                p.shield = (p.shield ?? 0) + 1;
                setShieldGained(true);
              } else if (gem === "jump") {
                p.jumps = (p.jumps ?? 0) + 1;
                setJumpAdded(1);
              } else if (gem === "torch") {
                p.hasTorch = true;
                setTorchGained(true);
              } else {
                setHiddenGemTeleport(true);
                const fromX = p.x;
                const fromY = p.y;
                const options = next.getTeleportOptions(currentPlayer, 6);
                if (options.length > 0) {
                  setTeleportPicker({ playerIndex: currentPlayer, from: [fromX, fromY], options, sourceType: "gem" });
                  teleportPickerSet = true;
                }
              }
            }
          }
        }
        // Combat: when player lands on monster, enter combat mode (roll dice to resolve)
        const collision = next.checkMonsterCollision(currentPlayer);
        if (collision) {
          const p = next.players[collision.playerIndex];
          setCollisionEffect(p ? { x: p.x, y: p.y } : null);
          setCombatState({
            playerIndex: collision.playerIndex,
            monsterType: collision.monsterType,
            monsterIndex: collision.monsterIndex,
            prevX,
            prevY,
          });
          setLab(next);
          return;
        }
        if (next.hasWonByArtifactsAndExit(currentPlayer)) {
          setWinner(currentPlayer);
        }
        setLab(next);
        const hadCollision = !!collision;
        if (movesLeftRef.current <= 0 && winnerRef.current === null && !hadCollision && !teleportedThisMove && !teleportPickerSet) {
          const cp = next.players[currentPlayer];
          const cell = cp && next.getCellAt(cp.x, cp.y);
          if (cell && isMultiplierCell(cell) && diceResult !== null) {
            const mult = getMultiplierValue(cell);
            const bonus = diceResult * mult;
            movesLeftRef.current = bonus;
            setMovesLeft(bonus);
            setBonusAdded(bonus);
            if (cp && (cp.jumps ?? 0) > 0) {
              cp.jumps = (cp.jumps ?? 0) * mult;
              setJumpAdded(mult);
            }
          } else {
            movesLeftRef.current = 0;
            setMovesLeft(0);
            const onCatapult = cell && isCatapultCell(cell);
            if (!onCatapult) {
              let nextP = (currentPlayer + 1) % lab.numPlayers;
              while (next.eliminatedPlayers.has(nextP) && nextP !== currentPlayer) {
                nextP = (nextP + 1) % lab.numPlayers;
              }
              const living = [...Array(next.numPlayers).keys()].filter((i) => !next.eliminatedPlayers.has(i));
              const firstLiving = living.length > 0 ? Math.min(...living) : -1;
              const roundComplete = living.length <= 1 || nextP === firstLiving;
              setTurnChangeEffect(nextP);
              setCurrentPlayer(nextP);
              setDiceResult(null);
              if (roundComplete) setTimeout(() => triggerRoundEnd(), 0);
            }
          }
        }
      }
    },
    [lab, currentPlayer, movesLeft, winner, diceResult, triggerRoundEnd]
  );

  // Game starts only when user clicks Start in the start modal

  const MONSTER_MOVE_INTERVAL_MS = 2500;

  useEffect(() => {
    if (!lab || winner !== null) return;
    const id = setInterval(() => {
      setLab((prev) => {
        if (!prev || winnerRef.current !== null) return prev;
        const next = new Labyrinth(prev.width, prev.height, 0, prev.numPlayers, prev.monsterDensity);
        next.grid = prev.grid.map((r) => [...r]);
        next.players = prev.players.map((p) => ({
          ...p,
          jumps: p.jumps ?? 0,
          diamonds: p.diamonds ?? 0,
          shield: p.shield ?? 0,
          bombs: p.bombs ?? 0,
          hp: p.hp ?? 3,
          artifacts: p.artifacts ?? 0,
        }));
        next.goalX = prev.goalX;
        next.goalY = prev.goalY;
        next.round = prev.round;
        next.currentRound = prev.currentRound;
        next.monsters = prev.monsters.map((m) => ({
          ...m,
          patrolArea: [...m.patrolArea],
        }));
        next.eliminatedPlayers = new Set(prev.eliminatedPlayers);
        next.hiddenCells = new Map(prev.hiddenCells);
        next.webPositions = [...(prev.webPositions || [])];
        next.fogZones = new Map(prev.fogZones || new Map());
        next.bombCollectedBy = new Map([...(prev.bombCollectedBy || new Map()).entries()].map(([k, v]) => [k, new Set(v)]));
        next.teleportUsedFrom = new Map([...(prev.teleportUsedFrom || new Map()).entries()].map(([k, v]) => [k, new Set(v)]));
        next.teleportUsedTo = new Map([...(prev.teleportUsedTo || new Map()).entries()].map(([k, v]) => [k, new Set(v)]));
        next.catapultUsedFrom = new Map([...(prev.catapultUsedFrom || new Map()).entries()].map(([k, v]) => [k, new Set(v)]));
        next.visitedCells = new Set(prev.visitedCells || []);
        next.moveMonsters();
        const collision = next.checkMonsterCollision(currentPlayerRef.current);
        if (collision) {
          const p = next.players[collision.playerIndex];
          setCollisionEffect(p ? { x: p.x, y: p.y } : null);
          setCombatState({ playerIndex: collision.playerIndex, monsterType: collision.monsterType, monsterIndex: collision.monsterIndex });
        }
        return next;
      });
    }, MONSTER_MOVE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [lab?.width, lab?.height, lab?.numPlayers, winner]);

  useEffect(() => {
    if (!lab || winner !== null || combatState || movesLeft > 0 || rolling || catapultPicker || teleportPicker) return;
    if (lab.eliminatedPlayers.has(currentPlayer)) {
      let nextP = (currentPlayer + 1) % lab.numPlayers;
      while (lab.eliminatedPlayers.has(nextP) && nextP !== currentPlayer) {
        nextP = (nextP + 1) % lab.numPlayers;
      }
      setTurnChangeEffect(nextP);
      setCurrentPlayer(nextP);
      return;
    }
    const t = setTimeout(() => rollDice(), 400);
    return () => clearTimeout(t);
  }, [lab, winner, movesLeft, rolling, rollDice, currentPlayer, catapultPicker, teleportPicker]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "r" || e.key === "R") {
        newGame();
        e.preventDefault();
        return;
      }
      const map: Record<string, [number, number]> = {
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        w: [0, -1],
        W: [0, -1],
        s: [0, 1],
        S: [0, 1],
        a: [-1, 0],
        A: [-1, 0],
        d: [1, 0],
        D: [1, 0],
      };
      const d = map[e.key];
      if (d) {
        if (movesLeftRef.current <= 0 || winnerRef.current !== null || !lab) return;
        // Same keys for move and jump: prefer jump when possible in that direction
        const jumpPreferred = lab.canJumpInDirection(d[0], d[1], currentPlayer);
        doMove(d[0], d[1], jumpPreferred);
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newGame, doMove, lab, currentPlayer]);

  const playerCells: Record<string, number> = {};
  if (lab) {
    lab.players.forEach((p, i) => {
      playerCells[`${p.x},${p.y}`] = i;
    });
    const p = lab.players[currentPlayer];
    if (p) playerCells[`${p.x},${p.y}`] = currentPlayer;
  }
  const cp = lab?.players[currentPlayer];
  const gameOver = winner !== null;
  const moveDisabled = movesLeft <= 0 || gameOver || (lab?.eliminatedPlayers.has(currentPlayer) ?? false);
  const rollDisabled = (!combatState && movesLeft > 0) || gameOver || rolling || !!catapultPicker || !!teleportPicker;
  const showSecretCells = movesLeft > 0;
  const jumpTargets = lab && cp && (cp.jumps ?? 0) > 0 && !moveDisabled ? lab.getJumpTargets(currentPlayer) : [];
  const canMoveUp = !moveDisabled && lab?.canMoveOnly(0, -1, currentPlayer);
  const canMoveLeft = !moveDisabled && lab?.canMoveOnly(-1, 0, currentPlayer);
  const canMoveRight = !moveDisabled && lab?.canMoveOnly(1, 0, currentPlayer);
  const canMoveDown = !moveDisabled && lab?.canMoveOnly(0, 1, currentPlayer);
  const canJumpUp = !moveDisabled && lab?.canJumpInDirection(0, -1, currentPlayer);
  const canJumpLeft = !moveDisabled && lab?.canJumpInDirection(-1, 0, currentPlayer);
  const canJumpRight = !moveDisabled && lab?.canJumpInDirection(1, 0, currentPlayer);
  const canJumpDown = !moveDisabled && lab?.canJumpInDirection(0, 1, currentPlayer);

  const handleCatapultLaunch = useCallback(
    (dx: number, dy: number, strength: number) => {
      if (!lab || !catapultPicker || !catapultMode) return;
      const { playerIndex, from } = catapultPicker;
      const next = new Labyrinth(lab.width, lab.height, 0, lab.numPlayers, lab.monsterDensity);
      next.grid = lab.grid.map((r) => [...r]);
      next.players = lab.players.map((p) => ({ ...p, jumps: p.jumps ?? 0, diamonds: p.diamonds ?? 0, shield: p.shield ?? 0, bombs: p.bombs ?? 0 }));
      next.hiddenCells = new Map(lab.hiddenCells);
      next.webPositions = [...(lab.webPositions || [])];
      next.fogZones = new Map(lab.fogZones || new Map());
      next.bombCollectedBy = new Map([...(lab.bombCollectedBy || new Map()).entries()].map(([k, v]) => [k, new Set(v)]));
      next.teleportUsedFrom = new Map([...(lab.teleportUsedFrom || new Map()).entries()].map(([k, v]) => [k, new Set(v)]));
      next.teleportUsedTo = new Map([...(lab.teleportUsedTo || new Map()).entries()].map(([k, v]) => [k, new Set(v)]));
      next.catapultUsedFrom = new Map([...(lab.catapultUsedFrom || new Map()).entries()].map(([k, v]) => [k, new Set(v)]));
      next.visitedCells = new Set(lab.visitedCells || []);
      next.goalX = lab.goalX;
      next.goalY = lab.goalY;
      next.monsters = lab.monsters.map((m) => ({ ...m, patrolArea: [...m.patrolArea] }));
      next.eliminatedPlayers = new Set(lab.eliminatedPlayers);
      const result = next.catapultLaunch(playerIndex, dx, dy, strength);
      if (result) {
        next.recordCatapultUsedFrom(playerIndex, from[0], from[1]);
        setCatapultAnimation({ from, to: [result.destX, result.destY], playerIndex });
        setTeleportPicker(null);
        setCatapultPicker(null);
        setCatapultMode(false);
        movesLeftRef.current++;
        setMovesLeft((m) => m + 1);
        setTotalMoves((t) => t + 1);
        setPlayerMoves((prev) => {
          const arr = [...prev];
          if (playerIndex < arr.length) arr[playerIndex] = (arr[playerIndex] ?? 0) + 1;
          return arr;
        });
        // Monsters move only via timer
        const collision = next.checkMonsterCollision(playerIndex);
        if (collision) {
          const usedShield = next.tryConsumeShield(collision.playerIndex);
          if (usedShield) setShieldAbsorbed(true);
          else {
            next.eliminatedPlayers.add(collision.playerIndex);
            setEliminatedByMonster({ playerIndex: collision.playerIndex, monsterType: collision.monsterType });
          }
        }
        if (next.hasWonByArtifactsAndExit(playerIndex)) setWinner(playerIndex);
        setLab(next);
      }
    },
    [lab, catapultPicker, catapultMode]
  );

  useEffect(() => {
    if (!catapultMode || !catapultPicker) return;
    const onPointerUp = (e: PointerEvent) => {
      const d = catapultDragRef.current;
      catapultDragRef.current = null;
      setCatapultDragOffset(null);
      if (!d) return;
      const releaseX = e.clientX;
      const releaseY = e.clientY;
      const dx = releaseX - d.startX;
      const dy = releaseY - d.startY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 15) return; // too short a drag
      // Launch opposite to pull direction (slingshot: pull back → launch forward)
      handleCatapultLaunch(-dx, -dy, dist);
    };
    const onPointerCancel = () => {
      catapultDragRef.current = null;
      setCatapultDragOffset(null);
    };
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    return () => {
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
    };
  }, [catapultMode, catapultPicker, handleCatapultLaunch]);

  const handleTeleportSelect = useCallback(
    (destX: number, destY: number) => {
      if (!lab || !teleportPicker) return;
      const { playerIndex, from, sourceType } = teleportPicker;
      const isOption = teleportPicker.options.some(([ox, oy]) => ox === destX && oy === destY);
      if (!isOption) return;
      const next = new Labyrinth(lab.width, lab.height, 0, lab.numPlayers, lab.monsterDensity);
      next.grid = lab.grid.map((r) => [...r]);
      next.players = lab.players.map((pl) => ({ ...pl, jumps: pl.jumps ?? 0, diamonds: pl.diamonds ?? 0, shield: pl.shield ?? 0, bombs: pl.bombs ?? 0 }));
      next.hiddenCells = new Map(lab.hiddenCells);
      next.webPositions = [...(lab.webPositions || [])];
      next.fogZones = new Map(lab.fogZones || new Map());
      next.bombCollectedBy = new Map([...(lab.bombCollectedBy || new Map()).entries()].map(([k, v]) => [k, new Set(v)]));
      next.teleportUsedFrom = new Map([...(lab.teleportUsedFrom || new Map()).entries()].map(([k, v]) => [k, new Set(v)]));
      next.teleportUsedTo = new Map([...(lab.teleportUsedTo || new Map()).entries()].map(([k, v]) => [k, new Set(v)]));
      next.catapultUsedFrom = new Map([...(lab.catapultUsedFrom || new Map()).entries()].map(([k, v]) => [k, new Set(v)]));
      next.visitedCells = new Set(lab.visitedCells || []);
      next.goalX = lab.goalX;
      next.goalY = lab.goalY;
      next.monsters = lab.monsters.map((m) => ({ ...m, patrolArea: [...m.patrolArea] }));
      next.eliminatedPlayers = new Set(lab.eliminatedPlayers);
      if (next.teleportToCell(playerIndex, destX, destY)) {
        if (sourceType === "magic") next.recordTeleportUsedFrom(playerIndex, from[0], from[1]);
        setTeleportAnimation({ from, to: [destX, destY], playerIndex });
        setTeleportPicker(null);
        movesLeftRef.current = 0;
        setMovesLeft(0);
        setDiceResult(null);
        let nextP = (playerIndex + 1) % next.numPlayers;
        while (next.eliminatedPlayers.has(nextP) && nextP !== playerIndex) {
          nextP = (nextP + 1) % next.numPlayers;
        }
        const living = [...Array(next.numPlayers).keys()].filter((i) => !next.eliminatedPlayers.has(i));
        const firstLiving = living.length > 0 ? Math.min(...living) : -1;
        const roundComplete = living.length <= 1 || nextP === firstLiving;
        setTurnChangeEffect(nextP);
        setCurrentPlayer(nextP);
        if (roundComplete) setTimeout(() => triggerRoundEnd(), 0);
        setLab(next);
      }
    },
    [lab, teleportPicker, triggerRoundEnd]
  );

  useEffect(() => {
    handleTeleportSelectRef.current = handleTeleportSelect;
  }, [handleTeleportSelect]);

  useEffect(() => {
    if (!teleportPicker) return;
    if (teleportAutoTimerRef.current) {
      clearTimeout(teleportAutoTimerRef.current);
      teleportAutoTimerRef.current = null;
    }
    teleportAutoTimerRef.current = setTimeout(() => {
      teleportAutoTimerRef.current = null;
      const picker = teleportPickerRef.current;
      if (!picker || picker.options.length === 0) return;
      const [destX, destY] = picker.options[Math.floor(Math.random() * picker.options.length)];
      handleTeleportSelectRef.current(destX, destY);
    }, 2000);
    return () => {
      if (teleportAutoTimerRef.current) {
        clearTimeout(teleportAutoTimerRef.current);
        teleportAutoTimerRef.current = null;
      }
    };
  }, [teleportPicker]);

  const handleCellTap = useCallback(
    (cellX: number, cellY: number) => {
      if (!lab) return;
      if (teleportPicker) {
        handleTeleportSelect(cellX, cellY);
        return;
      }
      if (moveDisabled || !cp) return;
      const jumpTarget = jumpTargets.find((t) => t.x === cellX && t.y === cellY);
      if (jumpTarget) {
        doMove(jumpTarget.dx, jumpTarget.dy, true);
        return;
      }
      const dx = cellX - cp.x;
      const dy = cellY - cp.y;
      if (Math.abs(dx) + Math.abs(dy) === 1) {
        if (lab.canMoveOnly(dx, dy, currentPlayer)) {
          doMove(dx, dy, false);
        }
        return;
      }
      const stepX = Math.sign(dx);
      const stepY = Math.sign(dy);
      if (Math.abs(dx) >= Math.abs(dy) && stepX !== 0 && lab.canMoveOnly(stepX, 0, currentPlayer)) {
        doMove(stepX, 0, false);
      } else if (stepY !== 0 && lab.canMoveOnly(0, stepY, currentPlayer)) {
        doMove(0, stepY, false);
      } else if (stepX !== 0 && lab.canMoveOnly(stepX, 0, currentPlayer)) {
        doMove(stepX, 0, false);
      }
    },
    [moveDisabled, cp, jumpTargets, lab, currentPlayer, doMove, teleportPicker, handleTeleportSelect]
  );

  if (!gameStarted) {
    return (
      <div style={startModalOverlayStyle}>
        <div style={startModalStyle}>
          <h1 style={startModalTitleStyle}>LABYRINTH</h1>
          <p style={startModalSubtitleStyle}>Configure your game and start when ready</p>
          <div style={startModalFormStyle}>
            <div style={modalRowStyle}>
              <label style={startModalLabelStyle}>Maze size</label>
              <select
                value={mazeSize}
                onChange={(e) => setMazeSize(Number(e.target.value))}
                style={startModalSelectStyle}
              >
                {SIZE_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}×{s}</option>
                ))}
              </select>
            </div>
            <div style={modalRowStyle}>
              <label style={startModalLabelStyle}>Difficulty</label>
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(Number(e.target.value))}
                style={startModalSelectStyle}
              >
                {DIFFICULTY_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d === 1 ? "Easy" : d === 2 ? "Normal" : d === 3 ? "Hard" : "Extreme"}
                  </option>
                ))}
              </select>
            </div>
            <div style={modalRowStyle}>
              <label style={startModalLabelStyle}>Number of players</label>
              <input
                type="number"
                min={1}
                max={10}
                value={numPlayers}
                onChange={(e) => setNumPlayers(Math.min(10, Math.max(1, Number(e.target.value) || 1)))}
                style={startModalInputStyle}
              />
            </div>
            <div style={{ ...modalRowStyle, flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
              <label style={startModalLabelStyle}>Player names</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
                {Array.from({ length: numPlayers }).map((_, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%" }}>
                    <span style={{ color: PLAYER_COLORS[i] ?? "#888", fontWeight: "bold", fontSize: "1rem" }}>●</span>
                    <input
                      type="text"
                      value={(playerNames[i] ?? `Player ${i + 1}`).toString()}
                      onChange={(e) => {
                        const val = e.target.value;
                        setPlayerNames((prev) => {
                          const next = prev.length >= numPlayers ? [...prev] : [...prev, ...Array.from({ length: numPlayers - prev.length }, (_, j) => `Player ${prev.length + j + 1}`)];
                          next[i] = val || `Player ${i + 1}`;
                          return next;
                        });
                      }}
                      placeholder={`Player ${i + 1}`}
                      style={{ ...startModalInputStyle, flex: 1, minWidth: 0 }}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div style={startModalButtonsStyle}>
            <button
              onClick={() => {
                newGame();
                setGameStarted(true);
              }}
              style={startButtonStyle}
            >
              Start Game
            </button>
            <button
              onClick={async () => {
                await generateWithAI();
                setGameStarted(true);
              }}
              style={startSecondaryButtonStyle}
            >
              Generate with AI
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!lab) {
    return (
      <div style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#0f0f14", color: "#00ff88", fontFamily: "Courier New, monospace", fontSize: "1.2rem" }}>
        Generating maze…
      </div>
    );
  }

  return (
    <div style={gamePaneStyle}>
      <header style={headerStyle}>
        <h1 style={headerTitleStyle}>LABYRINTH</h1>
        <div style={headerStatsStyle}>
          <span style={{ ...headerStatItemStyle, color: winner !== null ? (winner >= 0 ? "#00ff88" : "#ff4444") : (PLAYER_COLORS_ACTIVE[currentPlayer] ?? "#00ff88"), fontWeight: "bold" }}>
            {winner !== null
              ? winner >= 0
                ? `${playerNames[winner] ?? `Player ${winner + 1}`} wins!`
                : "Monsters win!"
              : `${playerNames[currentPlayer] ?? `Player ${currentPlayer + 1}`}'s turn`}
          </span>
          <span style={headerStatDivider}>|</span>
          <span style={headerStatItemStyle}>
            Moves: {diceResult !== null ? `${Math.max(0, (bonusAdded ?? diceResult) - movesLeft)}/${bonusAdded ?? diceResult}` : "—/—"}
          </span>
          <span style={headerStatDivider}>|</span>
          <span style={headerStatItemStyle}>Round: {(lab.round ?? 0) + 1}/{MAX_ROUNDS}</span>
          <span style={headerStatDivider}>|</span>
          <span style={headerStatItemStyle}>Total: {totalMoves}</span>
          <span style={headerStatDivider}>|</span>
          <span style={headerStatItemStyle}>
            {lab.players.map((p, i) => (
              <span
                key={i}
                style={{
                  marginRight: 8,
                  color: lab.eliminatedPlayers.has(i) ? "#666" : (PLAYER_COLORS[i] ?? "#888"),
                  textDecoration: lab.eliminatedPlayers.has(i) ? "line-through" : undefined,
                }}
              >
                {playerNames[i] ?? `P${i + 1}`}:💎{p?.diamonds ?? 0}
              </span>
            ))}
          </span>
        </div>
        {teleportPicker && (
          <button
            onClick={() => setTeleportPicker(null)}
            style={{ ...buttonStyle, ...headerButtonStyle, background: "#664400", borderColor: "#aa66ff" }}
          >
            Cancel teleport
          </button>
        )}
        {catapultPicker && (
          <button
            onClick={() => { setCatapultMode(false); setCatapultPicker(null); setCatapultDragOffset(null); }}
            style={{ ...buttonStyle, ...headerButtonStyle, background: "#664400", borderColor: "#ffcc00" }}
          >
            Cancel slingshot
          </button>
        )}
        <button
          onClick={() => setSettingsOpen(true)}
          style={{ ...buttonStyle, ...headerButtonStyle }}
        >
          Setup
        </button>
      </header>

      <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
        <aside style={statsPanelStyle}>
          <div style={{ fontSize: "0.9rem", fontWeight: "bold", color: "#00ff88", marginBottom: 4 }}>Players</div>
          {lab.players.map((p, i) => (
            <div
              key={i}
              style={{
                padding: "0.5rem 0.75rem",
                background: i === currentPlayer ? "#1e2e24" : "#12121a",
                borderRadius: 6,
                border: `1px solid ${i === currentPlayer ? "#00ff8844" : "#333"}`,
              }}
            >
              <div style={{ color: lab.eliminatedPlayers.has(i) ? "#666" : (PLAYER_COLORS[i] ?? "#888"), fontWeight: "bold", marginBottom: 4 }}>
                {playerNames[i] ?? `Player ${i + 1}`}
                {lab.eliminatedPlayers.has(i) && " (out)"}
              </div>
              <div style={{ fontSize: "0.75rem", color: "#aaa" }}>
                Turns: {playerTurns[i] ?? 0}
              </div>
              <div style={{ fontSize: "0.75rem", color: "#aaa" }}>
                Moves: {playerMoves[i] ?? 0}
              </div>
              <div style={{ fontSize: "0.75rem", color: "#aaa", marginBottom: 2 }}>
                HP: {p?.hp ?? 3}/{DEFAULT_PLAYER_HP}
              </div>
              <div style={{ height: 6, background: "#333", borderRadius: 3, overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%",
                    width: `${Math.max(0, Math.min(100, ((p?.hp ?? 3) / DEFAULT_PLAYER_HP) * 100))}%`,
                    background: (p?.hp ?? 3) <= 1 ? "#ff4444" : (p?.hp ?? 3) <= 2 ? "#ffaa00" : "#00ff88",
                    borderRadius: 3,
                    transition: "width 0.3s ease",
                  }}
                />
              </div>
              <div style={{ fontSize: "0.75rem", color: "#aaa" }}>
                Artifacts: {p?.artifacts ?? 0}/3
              </div>
              {(p?.artifactsCollected?.length ?? 0) > 0 && (
                <div style={{ fontSize: "0.7rem", color: "#888", marginTop: 2, display: "flex", flexWrap: "wrap", gap: 2 }}>
                  {(p?.artifactsCollected ?? []).map((a, i) => (
                    <span key={i} title={a === ARTIFACT_DICE ? "+1 dice" : a === ARTIFACT_SHIELD ? "Shield" : a === ARTIFACT_TELEPORT_CELL ? "Teleport" : a === ARTIFACT_HEALING ? "+1 HP" : "Reveal"}>
                      {a === ARTIFACT_DICE ? "🎲" : a === ARTIFACT_SHIELD ? "🛡" : a === ARTIFACT_TELEPORT_CELL ? "🌀" : a === ARTIFACT_HEALING ? "❤️" : "👁"}
                    </span>
                  ))}
                </div>
              )}
              <div style={{ fontSize: "0.75rem", color: "#aaa" }}>
                Diamonds: {p?.diamonds ?? 0}
              </div>
              <div style={{ fontSize: "0.75rem", color: "#aaa" }}>
                Shield: {p?.shield ?? 0}
              </div>
              <div style={{ fontSize: "0.75rem", color: "#aaa" }}>
                Bombs: {p?.bombs ?? 0}
              </div>
            </div>
          ))}
        </aside>

        <div style={mainContentStyle}>
      {teleportPicker && (
        <div style={{ ...eliminatedOverlayStyle, pointerEvents: "none" }}>
          <div style={{ ...eliminatedBannerStyle, borderColor: "#aa66ff", background: "rgba(0,0,0,0.9)", pointerEvents: "none", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span style={{ color: "#aa66ff" }}>🌀 Select destination to teleport (click a highlighted cell)</span>
          </div>
        </div>
      )}
      {catapultPicker && (
        <div style={{ ...eliminatedOverlayStyle, pointerEvents: "none" }}>
          <div style={{ ...eliminatedBannerStyle, borderColor: "#ffcc00", background: "rgba(0,0,0,0.9)", pointerEvents: "none", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span style={{ color: "#ffcc00" }}>Slingshot: drag back to aim, release to launch (parabolic arc)</span>
          </div>
        </div>
      )}

      {turnChangeEffect !== null && lab && !lab.eliminatedPlayers.has(turnChangeEffect) && (
        <div style={{ ...eliminatedOverlayStyle, pointerEvents: "none", zIndex: 450 }}>
          <div
            className="turn-change-banner"
            style={{
              ...eliminatedBannerStyle,
              borderColor: PLAYER_COLORS[turnChangeEffect] ?? "#00ff88",
              background: "rgba(0,0,0,0.92)",
              color: PLAYER_COLORS[turnChangeEffect] ?? "#00ff88",
              boxShadow: `0 0 30px ${(PLAYER_COLORS[turnChangeEffect] ?? "#00ff88")}88`,
              fontSize: "1.2rem",
              fontWeight: "bold",
            }}
          >
            <span style={{ fontSize: "1.5rem" }}>●</span>
            <span>{playerNames[turnChangeEffect] ?? `Player ${turnChangeEffect + 1}`}&apos;s turn!</span>
          </div>
        </div>
      )}

      {(combatState || combatResult) && (
        <div style={combatModalOverlayStyle}>
          <div style={combatModalStyle} onClick={(e) => e.stopPropagation()}>
            <h2 style={combatModalTitleStyle}>
              <span style={{ marginRight: 8 }}>{combatState ? getMonsterIcon(combatState.monsterType) : combatResult?.monsterType ? getMonsterIcon(combatResult.monsterType) : "👹"}</span>
              ⚔️ Combat vs {combatState ? getMonsterName(combatState.monsterType) : combatResult?.monsterType ? getMonsterName(combatResult.monsterType) : "Monster"}
            </h2>
            {combatResult ? (
              <div style={combatResultSectionStyle}>
                <div style={{
                  ...combatResultBannerStyle,
                  borderColor: combatResult.monsterEffect === "skeleton_shield" ? "#ffcc00" : combatResult.shieldAbsorbed ? "#44ff88" : combatResult.won ? "#00ff88" : "#ff4444",
                  background: combatResult.monsterEffect === "skeleton_shield" ? "rgba(255,204,0,0.15)" : combatResult.shieldAbsorbed ? "rgba(68,255,136,0.15)" : combatResult.won ? "rgba(0,255,136,0.15)" : "rgba(255,68,68,0.15)",
                }}>
                  <span style={{
                    color: combatResult.monsterEffect === "skeleton_shield" ? "#ffcc00" : combatResult.shieldAbsorbed ? "#44ff88" : combatResult.won ? "#00ff88" : "#ff6666",
                    fontSize: "1.3rem",
                    fontWeight: "bold",
                  }}>
                    {combatResult.monsterEffect === "skeleton_shield"
                      ? "💀 Shield broken! Try again next turn."
                      : combatResult.won
                        ? (combatResult.reward ? `WIN! +${combatResult.reward.type === "jump" ? "1 jump" : combatResult.reward.type === "hp" ? "1 HP" : combatResult.reward.type === "shield" ? "1 shield" : combatResult.reward.type === "attackBonus" ? "1 attack" : "1 move"}` : "You are lucky! Monster defeated!")
                        : combatResult.shieldAbsorbed
                          ? "🛡 Shield absorbed!"
                          : combatResult.monsterEffect === "ghost_evade"
                            ? "👻 Attack missed!"
                            : `✗ -${combatResult.damage} HP`}
                  </span>
                </div>
                <div style={combatStatsStyle}>
                  <span>Dice: <strong>{combatResult.playerRoll}</strong></span>
                  <span>+ Attack bonus: <strong>{combatResult.attackTotal - combatResult.playerRoll}</strong></span>
                  <span>= Total: <strong>{combatResult.attackTotal}</strong></span>
                  <span>vs Defense: <strong>{combatResult.monsterDefense}</strong></span>
                </div>
              </div>
            ) : combatState ? (
              <div style={combatRollSectionStyle}>
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 12,
                  marginBottom: 12,
                  padding: "12px 20px",
                  background: "linear-gradient(135deg, rgba(80,20,20,0.6) 0%, rgba(40,10,10,0.8) 100%)",
                  borderRadius: 12,
                  border: "2px solid #ff6666",
                  boxShadow: "inset 0 0 20px rgba(255,80,80,0.2)",
                }}>
                  <span style={{ fontSize: "3.5rem", lineHeight: 1 }} title={getMonsterName(combatState.monsterType)}>
                    {getMonsterIcon(combatState.monsterType)}
                  </span>
                  <span style={{ color: "#ff9999", fontSize: "1rem" }}>vs</span>
                  <span style={{ color: "#ffcc00", fontSize: "1.1rem", fontWeight: "bold" }}>{getMonsterName(combatState.monsterType)}</span>
                </div>
                <div style={combatMonsterInfoStyle}>
                  Defense: <strong>{getMonsterDefense(combatState.monsterType)}</strong>
                  {lab?.players[combatState.playerIndex] && (lab.players[combatState.playerIndex]?.attackBonus ?? 0) > 0 && (
                    <span style={{ marginLeft: 12, color: "#ffcc00" }}>
                      (Attack +{lab.players[combatState.playerIndex]?.attackBonus ?? 0})
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%", marginBottom: 14, padding: "10px 12px", background: "rgba(0,0,0,0.4)", borderRadius: 8, border: "1px solid #333" }}>
                  <div style={{ color: "#ffcc00", fontSize: "0.85rem", fontWeight: "bold", marginBottom: 4 }}>Skills & Artifacts</div>
                  {lab && (lab.players[combatState.playerIndex]?.shield ?? 0) > 0 && (
                    <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", color: "#ccc", fontSize: "0.95rem" }}>
                      <input
                        type="checkbox"
                        checked={combatUseShield}
                        onChange={(e) => setCombatUseShield(e.target.checked)}
                        style={{ width: 20, height: 20, accentColor: "#44ff88" }}
                      />
                      <span>🛡 Shield — block damage if I lose</span>
                    </label>
                  )}
                  {lab && (lab.players[combatState.playerIndex]?.diceBonus ?? 0) > 0 && (
                    <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", color: "#ccc", fontSize: "0.95rem" }}>
                      <input
                        type="checkbox"
                        checked={combatUseDiceBonus}
                        onChange={(e) => setCombatUseDiceBonus(e.target.checked)}
                        style={{ width: 20, height: 20, accentColor: "#ffcc00" }}
                      />
                      <span>🎲 Power — +1 to attack roll</span>
                    </label>
                  )}
                  {lab && (lab.players[combatState.playerIndex]?.shield ?? 0) <= 0 && (lab.players[combatState.playerIndex]?.diceBonus ?? 0) <= 0 && (
                    <span style={{ color: "#666", fontSize: "0.85rem" }}>No artifacts available</span>
                  )}
                </div>
                <div style={{ color: "#888", fontSize: "0.85rem", marginBottom: 8 }}>Roll dice when ready (manual)</div>
                <div
                  className="combat-dice"
                  onClick={() => !rolling && (combatDiceRef.current?.roll() ?? (() => { const v = Math.floor(Math.random() * 6) + 1; handleRollComplete(v); })())}
                  style={{
                    cursor: rolling ? "default" : "pointer",
                    width: DICE_PANEL_WIDTH,
                    minWidth: DICE_PANEL_WIDTH,
                    height: 160,
                    background: "linear-gradient(145deg, #1a1a24 0%, #0d0d12 100%)",
                    borderRadius: 12,
                    overflow: "hidden",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: "2px solid #ffcc00",
                    boxShadow: "inset 0 0 30px rgba(255,204,0,0.1)",
                    position: "relative",
                  }}
                >
                  {/* Fallback hint (behind 3D dice - visible when canvas hasn't loaded) */}
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      pointerEvents: "none",
                      color: "#ffcc00",
                      opacity: 0.8,
                      zIndex: 0,
                    }}
                  >
                    <span style={{ fontSize: "2.5rem", marginBottom: 4 }}>🎲</span>
                    <span style={{ fontSize: "0.8rem", fontWeight: "bold" }}>Click to roll</span>
                  </div>
                  <div style={{ position: "relative", zIndex: 1, width: "100%", height: "100%", minHeight: 120 }}>
                    <Dice3D
                      ref={combatDiceRef}
                      onRollComplete={handleRollComplete}
                      disabled={rolling}
                    />
                  </div>
                </div>
                <div style={{ fontSize: "0.8rem", color: "#888", marginTop: 6 }}>Click dice area or button below to roll</div>
                <button
                  onClick={() => !rolling && combatDiceRef.current?.roll()}
                  disabled={rolling}
                  style={{ ...buttonStyle, marginTop: 8, background: "#ffcc00", color: "#111" }}
                >
                  {rolling ? "Rolling..." : "Roll to attack"}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      )}
      {eliminatedByMonster && (
        <div style={eliminatedOverlayStyle}>
          <div style={eliminatedBannerStyle}>
            <span style={{ color: "#ff4444", fontSize: "1.5rem" }}>💀</span>
            <span>
              {playerNames[eliminatedByMonster.playerIndex] ?? `Player ${eliminatedByMonster.playerIndex + 1}`} defeated by {getMonsterName(eliminatedByMonster.monsterType)}! Respawned at start (-1 artifact)
            </span>
          </div>
        </div>
      )}

      {(bonusAdded !== null || jumpAdded !== null || shieldAbsorbed !== null || shieldGained !== null || healingGained !== null || harmTaken !== null || bombGained !== null || hiddenGemTeleport !== null || torchGained !== null || cellsRevealed !== null || webSlowed !== null) && (
        <div style={effectToastStyle} className="effect-toast">
          {bonusAdded !== null && diceResult !== null && (
            <span style={{ color: "#ffcc00" }}>×{bonusAdded / diceResult} moves!</span>
          )}
          {webSlowed !== null && (
            <span style={{ color: "#aaaacc", marginLeft: bonusAdded ? 12 : 0 }}>🕸 Spider web: costs 2 moves</span>
          )}
          {jumpAdded !== null && (
            <span style={{ color: "#66aaff", marginLeft: bonusAdded ? 12 : 0 }}>
              {jumpAdded > 1 ? `×${jumpAdded} jumps!` : `+1 jump!`}
            </span>
          )}
          {shieldAbsorbed !== null && (
            <span style={{ color: "#44ff88", marginLeft: 12 }}>🛡 Shield absorbed attack!</span>
          )}
          {harmTaken !== null && (
            <span style={{ color: "#ff4444", fontWeight: "bold" }}>⚠ -1 HP (trap)</span>
          )}
          {shieldGained !== null && (
            <span style={{ color: "#44ff88", marginLeft: 12 }}>🛡 +1 Shield!</span>
          )}
          {healingGained !== null && (
            <span style={{ color: "#44ff88", marginLeft: 12 }}>❤️ +1 HP!</span>
          )}
          {bombGained !== null && (
            <span style={{ color: "#ff8844", marginLeft: 12 }}>💣 +1 Bomb!</span>
          )}
          {hiddenGemTeleport !== null && (
            <span style={{ color: "#aa66ff", marginLeft: 12 }}>✨ Hidden gem: Teleport!</span>
          )}
          {torchGained !== null && (
            <span style={{ color: "#ffcc66", marginLeft: 12 }}>🔦 Torch! Fog zones cleared</span>
          )}
          {cellsRevealed !== null && (
            <span style={{ color: "#aa66ff", marginLeft: 12 }}>✨ {cellsRevealed} hidden cells revealed!</span>
          )}
        </div>
      )}

      {settingsOpen && (
        <div style={modalOverlayStyle} onClick={() => setSettingsOpen(false)}>
          <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
            <h2 style={modalTitleStyle}>Game Setup</h2>
            <div style={modalRowStyle}>
              <label>Size:</label>
              <select
                value={mazeSize}
                onChange={(e) => setMazeSize(Number(e.target.value))}
                style={selectStyle}
              >
                {SIZE_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}×{s}</option>
                ))}
              </select>
            </div>
            <div style={modalRowStyle}>
              <label>Difficulty (monsters per 10×10):</label>
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(Number(e.target.value))}
                style={selectStyle}
              >
                {DIFFICULTY_OPTIONS.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
            <div style={modalRowStyle}>
              <label>Players:</label>
              <input
                type="number"
                min={1}
                max={10}
                value={numPlayers}
                onChange={(e) => setNumPlayers(Number(e.target.value) || 1)}
                style={inputStyle}
              />
            </div>
            <div style={{ ...modalRowStyle, flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
              <label>Player names:</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, width: "100%" }}>
                {Array.from({ length: numPlayers }).map((_, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
                    <span style={{ color: PLAYER_COLORS[i] ?? "#888", fontWeight: "bold", minWidth: 20, flexShrink: 0 }}>●</span>
                    <input
                      type="text"
                      value={(playerNames[i] ?? `Player ${i + 1}`).toString()}
                      onChange={(e) => {
                        const val = e.target.value;
                        setPlayerNames((prev) => {
                          const next = prev.length >= numPlayers ? [...prev] : [...prev, ...Array.from({ length: numPlayers - prev.length }, (_, j) => `Player ${prev.length + j + 1}`)];
                          next[i] = val || `Player ${i + 1}`;
                          return next;
                        });
                      }}
                      placeholder={`Player ${i + 1}`}
                      style={{ ...inputStyle, width: "100%", minWidth: 120, flex: 1 }}
                    />
                  </div>
                ))}
              </div>
            </div>
            <div style={modalRowStyle}>
              <button
                onClick={() => {
                  newGame();
                  setSettingsOpen(false);
                }}
                style={buttonStyle}
              >
                Random Maze
              </button>
            </div>
            <button
              onClick={() => setSettingsOpen(false)}
              style={{ ...buttonStyle, ...secondaryButtonStyle, marginTop: 8 }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      <div style={mazeAreaStyle}>
        <div style={mazeZoomControlsStyle}>
          <button onClick={() => setMazeZoom((z) => Math.max(0.5, z - 0.25))} style={mazeZoomButtonStyle} title="Zoom out">−</button>
          <span style={{ fontSize: "0.8rem", color: "#888", minWidth: 36, textAlign: "center" }}>{Math.round(mazeZoom * 100)}%</span>
          <button onClick={() => setMazeZoom((z) => Math.min(2, z + 0.25))} style={mazeZoomButtonStyle} title="Zoom in">+</button>
        </div>
        <div
          className="maze-wrap"
          style={{
            ...mazeWrapStyle,
            marginTop: MAZE_MARGIN,
            position: "relative",
          }}
        >
        <div style={{ position: "relative", display: "inline-block" }}>
        <div
          className="maze"
          style={{
            ...mazeStyle,
            gridTemplateColumns: `repeat(${lab.width}, ${CELL_SIZE * mazeZoom}px)`,
            gridTemplateRows: lab ? `repeat(${lab.height}, ${CELL_SIZE * mazeZoom}px)` : undefined,
          }}
        >
          {Array.from({ length: lab.height }).map((_, y) =>
            Array.from({ length: lab.width }).map((_, x) => {
              const monster = lab.monsters.find((m) => m.x === x && m.y === y);
              const pi = playerCells[`${x},${y}`];
              const isCatapultSourceCell = catapultMode && catapultPicker && catapultPicker.from[0] === x && catapultPicker.from[1] === y && pi === currentPlayer;
              const isTeleportOption = teleportPicker?.options.some(([ox, oy]) => ox === x && oy === y);
              let content: React.ReactNode = null;
              let cellClass = "cell";

              const fogIntensity = lab.fogZones?.get(`${x},${y}`);
              const hasTorch = lab.players.some((pl) => pl.hasTorch);
              const isVisited = lab.visitedCells?.has(`${x},${y}`);
              const isPlayerCell = lab.players.some((pl, i) => !lab.eliminatedPlayers?.has(i) && pl.x === x && pl.y === y);
              const isWallCell = lab.getCellAt(x, y) === "#";
              const adjacentFog = isWallCell && !hasTorch && !isVisited && !isPlayerCell && [[x-1,y],[x+1,y],[x,y-1],[x,y+1]].some(([nx,ny]) => (lab.fogZones?.get(`${nx},${ny}`) ?? 0) > 0 && !lab.visitedCells?.has(`${nx},${ny}`));
              const wouldHaveFog = !(hasTorch || isVisited || isPlayerCell) && (isWallCell ? adjacentFog : (fogIntensity ?? 0) > 0);

              const monsterIcon = monster && !wouldHaveFog ? (
                <span key="m" className="monster-icon" style={{ fontSize: "1.4rem", lineHeight: 1 }} title={getMonsterName(monster.type)}>
                  {monster.type === "V" ? "🧛" : monster.type === "Z" ? "🧟" : monster.type === "G" ? "👻" : monster.type === "K" ? "💀" : "🕷"}
                </span>
              ) : null;
              if (monster) cellClass += " path monster";
              if (pi !== undefined && !lab.eliminatedPlayers.has(pi)) {
                cellClass += " path";
                if (isTeleportOption) cellClass += " magic hole";
                const c =
                  pi === currentPlayer
                    ? PLAYER_COLORS_ACTIVE[pi] ?? "#888"
                    : PLAYER_COLORS[pi] ?? "#888";
                const isTeleportRise =
                  teleportAnimation?.to[0] === x && teleportAnimation?.to[1] === y && teleportAnimation?.playerIndex === pi;
                const isCatapultFlying = catapultAnimation?.to[0] === x && catapultAnimation?.to[1] === y && catapultAnimation?.playerIndex === pi;
                const isJumpLanding =
                  jumpAnimation?.x === x && jumpAnimation?.y === y && jumpAnimation?.playerIndex === pi;
                const isCatapultStretch = isCatapultSourceCell && catapultDragOffset && (catapultDragOffset.dx !== 0 || catapultDragOffset.dy !== 0);
                const stretchDist = isCatapultStretch
                  ? Math.sqrt(catapultDragOffset!.dx ** 2 + catapultDragOffset!.dy ** 2)
                  : 0;
                const stretchAmount = Math.min(stretchDist / 40, 0.7);
                const stretchX = stretchDist > 0 ? stretchAmount * Math.abs(catapultDragOffset!.dx) / stretchDist : 0;
                const stretchY = stretchDist > 0 ? stretchAmount * Math.abs(catapultDragOffset!.dy) / stretchDist : 0;
                const markerStretchStyle: React.CSSProperties = isCatapultStretch && catapultDragOffset
                  ? {
                      transform: `scale(${1 + stretchX}, ${1 + stretchY})`,
                      transformOrigin: `${catapultDragOffset.dx >= 0 ? "left" : "right"} ${catapultDragOffset.dy >= 0 ? "top" : "bottom"}`,
                    }
                  : {};
                const playerMarker = (
                  <div
                    className={`marker ${pi === currentPlayer ? "active" : ""} ${isTeleportRise ? "teleport-rise" : ""} ${isJumpLanding ? "jump-landing" : ""}`}
                    style={{
                      ...markerStyle,
                      ...markerStretchStyle,
                      background: c,
                      boxShadow: pi === currentPlayer ? `0 0 8px ${c}, 0 0 12px ${c}` : undefined,
                      ...(isTeleportRise ? { zIndex: 20, position: "relative" as const } : {}),
                    }}
                  />
                );
                const dirHintStyle: React.CSSProperties = {
                  position: "absolute",
                  fontSize: "0.7rem",
                  fontWeight: "bold",
                  textShadow: "0 0 4px rgba(0,0,0,1), 0 1px 2px rgba(0,0,0,1)",
                  padding: "2px 4px",
                  borderRadius: 3,
                  background: "rgba(0,0,0,0.85)",
                  border: "1px solid rgba(255,255,255,0.2)",
                  zIndex: 2,
                };
                const dirOffset = 10;
                const dirIndicators = pi === currentPlayer && cp && !moveDisabled && !catapultMode ? (
                  <>
                    <span style={{ ...dirHintStyle, top: -dirOffset, left: "50%", transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                      <span style={{ color: "#00ff88" }}>{movesLeft}</span>
                      {canJumpUp && <span style={{ color: "#66aaff", fontSize: "0.65rem" }}>J↑{cp.jumps ?? 0}</span>}
                    </span>
                    {canJumpDown && (
                      <span style={{ ...dirHintStyle, bottom: -dirOffset, left: "50%", transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                        <span style={{ color: "#66aaff", fontSize: "0.65rem" }}>J↓{cp.jumps ?? 0}</span>
                      </span>
                    )}
                    {canJumpLeft && (
                      <span style={{ ...dirHintStyle, left: -dirOffset, top: "50%", transform: "translateY(-50%)", display: "flex", flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <span style={{ color: "#66aaff", fontSize: "0.65rem" }}>J←{cp.jumps ?? 0}</span>
                      </span>
                    )}
                    {canJumpRight && (
                      <span style={{ ...dirHintStyle, right: -dirOffset, top: "50%", transform: "translateY(-50%)", display: "flex", flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <span style={{ color: "#66aaff", fontSize: "0.65rem" }}>J→{cp.jumps ?? 0}</span>
                      </span>
                    )}
                  </>
                ) : null;
                content = (
                  <div style={{ position: "relative", width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {monsterIcon && <span style={{ position: "absolute", left: 2, top: 2, fontSize: "1rem", lineHeight: 1 }}>{monsterIcon}</span>}
                    {!isCatapultFlying && playerMarker}
                    {dirIndicators}
                  </div>
                );
              } else if (monsterIcon) {
                content = monsterIcon;
              } else if (x === lab.goalX && y === lab.goalY) {
                content = "X";
                cellClass += " goal";
              } else if (x === 0 && y === 0 && !playerCells["0,0"]) {
                content = "S";
                cellClass += " start";
              } else {
              const cellType = lab.getCellAt(x, y);
              if (isMultiplierCell(cellType)) {
                const isRevealed = isMultiplierCell(lab.grid[y]?.[x]);
                const isHidden = lab.hiddenCells.has(`${x},${y}`);
                if ((isRevealed || (isHidden && showSecretCells)) && !wouldHaveFog) {
                  content = `×${cellType}`;
                }
                cellClass += (isRevealed || (isHidden && showSecretCells)) ? " path multiplier mult-x" + cellType : " path";
              } else if (isArtifactCell(cellType)) {
                if (!wouldHaveFog) {
                  const art = cellType;
                  content = (
                    <span style={{ fontSize: "1.1rem" }} title={art === ARTIFACT_DICE ? "+1 dice" : art === ARTIFACT_SHIELD ? "Shield" : art === ARTIFACT_TELEPORT_CELL ? "Teleport" : art === ARTIFACT_HEALING ? "+1 HP" : "Reveal"}>
                      {art === ARTIFACT_DICE ? "🎲" : art === ARTIFACT_SHIELD ? "🛡" : art === ARTIFACT_TELEPORT_CELL ? "🌀" : art === ARTIFACT_HEALING ? "❤️" : "👁"}
                    </span>
                  );
                }
                cellClass += " path artifact";
              } else if (isTrapCell(cellType)) {
                if (!wouldHaveFog) {
                  const trap = cellType;
                  content = (
                    <span style={{ fontSize: "1rem", display: "inline-flex", alignItems: "center", justifyContent: "center" }} title={trap === TRAP_LOSE_TURN ? "Lose turn" : trap === TRAP_HARM ? "Harm: -1 HP (shield blocks)" : trap === TRAP_TELEPORT ? "Teleport" : "Slow"}>
                      {trap === TRAP_LOSE_TURN ? "⏸" : trap === TRAP_HARM ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ff4444" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
                          <circle cx="12" cy="9" r="5" />
                          <path d="M7 14c-1.5 1.5-2 3.5-2 5h14c0-1.5-.5-3.5-2-5" />
                          <circle cx="9" cy="8" r="1" fill="#ff4444" />
                          <circle cx="15" cy="8" r="1" fill="#ff4444" />
                          <path d="M10 12h4" />
                        </svg>
                      ) : trap === TRAP_TELEPORT ? "🌀" : "⏱"}
                    </span>
                  );
                }
                cellClass += " path trap";
              } else if (isBombCell(cellType)) {
                if (!wouldHaveFog) {
                  content = (
                    <span style={{ fontSize: "1.1rem" }} title="Bomb pickup">
                      💣
                    </span>
                  );
                }
                cellClass += " path bomb";
              } else if ((showSecretCells || isTeleportOption) && isMagicCell(cellType)) {
                const magicUsed = lab.hasUsedTeleportFrom(currentPlayer, x, y);
                if (!wouldHaveFog) {
                  content = (
                    <span className="hole-cell" style={{ fontSize: "1.1rem", opacity: magicUsed ? 0.4 : 1 }} title={magicUsed ? "Teleport used" : "Teleport: pick destination"}>
                      🌀
                    </span>
                  );
                }
                cellClass += " path magic hole" + (magicUsed ? " artifact-inactive" : "");
              } else if (showSecretCells && isCatapultCell(cellType)) {
                const catapultUsed = lab.hasUsedCatapultFrom(currentPlayer, x, y);
                if (!wouldHaveFog) {
                  content = (
                    <span style={{ fontSize: "1.2rem", display: "inline-flex", alignItems: "center", justifyContent: "center", opacity: catapultUsed ? 0.4 : 1 }} title={catapultUsed ? "Catapult used" : "Slingshot"}>
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ffcc00" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 4v4a7 7 0 0 0 14 0V4" />
                        <path d="M5 8h14" />
                        <ellipse cx="12" cy="14" rx="3" ry="2" fill="#ffcc0044" stroke="#ffcc00" />
                      </svg>
                    </span>
                  );
                }
                cellClass += " path catapult" + (catapultUsed ? " artifact-inactive" : "");
              } else if (showSecretCells && isJumpCell(cellType)) {
                if (!wouldHaveFog) content = "J";
                cellClass += " path jump";
              } else if (showSecretCells && isShieldCell(cellType)) {
                if (!wouldHaveFog) content = "🛡";
                cellClass += " path shield";
              } else if (showSecretCells && isDiamondCell(cellType)) {
                const owner = getCollectibleOwner(cellType);
                if (!wouldHaveFog) content = "💎";
                cellClass += " path collectible";
                if (owner !== null) cellClass += " collectible-p" + owner;
                if (owner === currentPlayer) cellClass += " collectible-mine";
              } else {
                cellClass += cellType === "#" ? " wall" : " path";
                if (cellType === "#") content = null;
              }
              }

              const cellBg: React.CSSProperties = {};
              if (cellClass.includes("wall")) {
                cellBg.background = "#2a2a35";
                cellBg.color = "#555";
              } else if (cellClass.includes("path")) {
                cellBg.background = "#1e1e28";
                cellBg.color = "#333";
              }
              if (cellClass.includes("start")) {
                cellBg.background = "#1e2e24";
                cellBg.color = "#00ff88";
              }
              if (cellClass.includes("goal")) {
                cellBg.background = "#2e1e1e";
                cellBg.color = "#ff4444";
              }
              if (cellClass.includes("multiplier")) {
                cellBg.color = "#ffcc00";
                cellBg.fontWeight = "bold";
                cellBg.fontSize = "0.85rem";
              }
              if (cellClass.includes("magic")) {
                cellBg.background = cellClass.includes("artifact-inactive") ? "#15151a" : "#1e1e2e";
                cellBg.color = cellClass.includes("artifact-inactive") ? "#555" : "#aa66ff";
                cellBg.fontWeight = "bold";
                if (isTeleportOption && !cellClass.includes("artifact-inactive")) {
                  cellBg.boxShadow = "inset 0 0 12px #aa66ff66, 0 0 8px #aa66ff";
                  cellBg.border = "2px solid #aa66ff";
                }
              }
              if (cellClass.includes("catapult") && cellClass.includes("artifact-inactive")) {
                cellBg.background = "#15151a";
                cellBg.color = "#444";
              } else if (cellClass.includes("catapult")) {
                cellBg.background = "#2e2e1e";
                cellBg.color = "#ffcc00";
                cellBg.fontWeight = "bold";
              }
              if (cellClass.includes("jump")) {
                cellBg.background = "#1e2e2e";
                cellBg.color = "#66aaff";
                cellBg.fontWeight = "bold";
              }
              if (cellClass.includes("shield")) {
                cellBg.background = "#1e2e1e";
                cellBg.color = "#44ff88";
                cellBg.fontWeight = "bold";
              }
              if (cellClass.includes("artifact")) {
                cellBg.background = "#1e2e2e";
                cellBg.color = "#aa66ff";
                cellBg.fontWeight = "bold";
              }
              if (cellClass.includes("trap")) {
                cellBg.background = "#2e2e1e";
                cellBg.color = "#ffaa00";
                cellBg.fontWeight = "bold";
              }
              if (cellClass.includes("bomb")) {
                cellBg.background = "#2e1e1e";
                cellBg.color = "#ff8844";
                cellBg.fontWeight = "bold";
              }
              if (cellClass.includes("collectible")) {
                const ownerMatch = cellClass.match(/collectible-p(\d+)/);
                const owner = ownerMatch ? parseInt(ownerMatch[1], 10) : null;
                const c = owner !== null && owner < PLAYER_COLORS.length ? PLAYER_COLORS[owner] : "#888";
                cellBg.color = c;
                cellBg.fontWeight = "bold";
                cellBg.fontSize = "1rem";
                if (owner !== null) {
                  cellBg.background = `${c}22`;
                  cellBg.boxShadow = `inset 0 0 8px ${c}44`;
                }
              }
              if (cellClass.includes("monster")) {
                cellBg.background = "#2e1e1e";
                cellBg.color = "#ff6666";
                cellBg.zIndex = 5;
              }

              const isTeleportFrom = teleportAnimation?.from[0] === x && teleportAnimation?.from[1] === y;
              const fallAnim = teleportAnimation;
              const fallColor =
                fallAnim && lab.players[fallAnim.playerIndex]
                  ? PLAYER_COLORS_ACTIVE[fallAnim.playerIndex] ?? "#888"
                  : "#888";
              const jumpTarget = jumpTargets.find((t) => t.x === x && t.y === y);

              const isTappable = (!!teleportPicker && isTeleportOption) || (!moveDisabled && !catapultMode && (cellClass.includes("path") || !!jumpTarget));

              const effectiveCellSize = CELL_SIZE * mazeZoom;
              const isCurrentPlayerCell = cp && x === cp.x && y === cp.y;
              const isCollisionCell = collisionEffect && collisionEffect.x === x && collisionEffect.y === y;
              if (isCollisionCell) cellClass += " cell-collision";
              return (
                <div
                  key={`${x}-${y}`}
                  ref={isCurrentPlayerCell ? (el) => { currentPlayerCellRef.current = el; } : undefined}
                  className={cellClass}
                  title={lab.webPositions?.some(([wx, wy]) => wx === x && wy === y) ? "Spider web: costs 3 moves to cross" : undefined}
                  style={{
                    ...cellStyle,
                    ...cellBg,
                    width: effectiveCellSize,
                    height: effectiveCellSize,
                    minWidth: effectiveCellSize,
                    minHeight: effectiveCellSize,
                    position: "relative",
                    cursor: isTappable ? "pointer" : isCatapultSourceCell ? "grab" : undefined,
                    touchAction: isCatapultSourceCell ? "none" : isTappable ? "manipulation" : undefined,
                    userSelect: isCatapultSourceCell ? "none" : undefined,
                  }}
                  onClick={() => isTappable && handleCellTap(x, y)}
                  onPointerDown={isCatapultSourceCell ? (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const cellEl = e.currentTarget as HTMLElement;
                    const rect = cellEl.getBoundingClientRect();
                    catapultDragRef.current = {
                      startX: rect.left + rect.width / 2,
                      startY: rect.top + rect.height / 2,
                      cellX: x,
                      cellY: y,
                    };
                    setCatapultDragOffset({ dx: 0, dy: 0 });
                    cellEl.setPointerCapture?.(e.pointerId);
                  } : undefined}
                  onPointerMove={isCatapultSourceCell ? (e) => {
                    const d = catapultDragRef.current;
                    if (!d) return;
                    const dx = e.clientX - d.startX;
                    const dy = e.clientY - d.startY;
                    setCatapultDragOffset({ dx, dy });
                  } : undefined}
                >
                  {(lab.webPositions?.some(([wx, wy]) => wx === x && wy === y)) && !wouldHaveFog && (
                    <div className="spider-web" style={{ position: "absolute", inset: 0, zIndex: 0 }}>
                      <svg viewBox="0 0 44 44" preserveAspectRatio="xMidYMid slice">
                        <defs>
                          <linearGradient id={`web-strand-${x}-${y}`} x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor="rgba(240,245,255,0.7)" />
                            <stop offset="100%" stopColor="rgba(200,210,230,0.5)" />
                          </linearGradient>
                        </defs>
                        <g stroke={`url(#web-strand-${x}-${y})`} strokeWidth="0.35" fill="none" strokeLinecap="round">
                          {/* Radial threads (spokes) */}
                          {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
                            const rad = (deg * Math.PI) / 180;
                            const ex = 22 + 22 * Math.cos(rad);
                            const ey = 22 + 22 * Math.sin(rad);
                            return <line key={deg} x1={22} y1={22} x2={ex} y2={ey} />;
                          })}
                          {/* Concentric capture spiral (orb web style) */}
                          <circle cx={22} cy={22} r={6} strokeWidth="0.3" opacity="0.9" />
                          <circle cx={22} cy={22} r={12} strokeWidth="0.28" opacity="0.85" />
                          <circle cx={22} cy={22} r={18} strokeWidth="0.25" opacity="0.8" />
                          <circle cx={22} cy={22} r={24} strokeWidth="0.22" opacity="0.75" />
                          <circle cx={22} cy={22} r={30} strokeWidth="0.2" opacity="0.7" />
                          {/* Center hub */}
                          <circle cx={22} cy={22} r={1.2} fill="rgba(230,235,250,0.6)" stroke="none" />
                        </g>
                      </svg>
                    </div>
                  )}
                  <span style={{ position: "relative", zIndex: 1 }}>{content}</span>
                  {jumpTarget && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        doMove(jumpTarget.dx, jumpTarget.dy, true);
                      }}
                      style={jumpActionButtonStyle}
                      title={`Jump to (${jumpTarget.x},${jumpTarget.y})`}
                    >
                      J
                    </button>
                  )}
                  {bombExplosion && Math.abs(x - bombExplosion.x) <= 1 && Math.abs(y - bombExplosion.y) <= 1 && (
                    <div className="bomb-explosion" style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />
                  )}
                  {isTeleportFrom && (
                    <div
                      className="teleport-fall"
                      style={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        pointerEvents: "none",
                      }}
                    >
                      <div
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: "50%",
                          background: fallColor,
                          animation: "teleportFall 0.4s ease-in forwards",
                        }}
                      />
                    </div>
                  )}
                  {(() => {
                    const effectiveFog = wouldHaveFog ? (isWallCell ? (adjacentFog ? 1 : 0) : (fogIntensity ?? 0)) : 0;
                    if (effectiveFog <= 0) return null;
                    const baseOpacity = 0.08 + effectiveFog * 0.92;
                    return (
                      <div
                        className="cell-fog"
                        style={{
                          position: "absolute",
                          inset: 0,
                          zIndex: 50,
                          pointerEvents: "none",
                          background: `radial-gradient(ellipse 90% 90% at 50% 50%, rgba(6,6,14,${baseOpacity * 0.2}) 0%, rgba(4,4,10,${baseOpacity * 0.6}) 50%, rgba(2,2,8,${baseOpacity}) 100%)`,
                          boxShadow: `inset 0 0 ${8 + effectiveFog * 24}px rgba(0,0,0,${baseOpacity * 0.7})`,
                        }}
                      />
                    );
                  })()}
                </div>
              );
            })
          )}
        </div>
        {catapultPicker && catapultDragOffset && lab && (catapultDragOffset.dx !== 0 || catapultDragOffset.dy !== 0) && (() => {
          const dx = catapultDragOffset.dx;
          const dy = catapultDragOffset.dy;
          const strength = Math.sqrt(dx * dx + dy * dy);
          if (strength < 1) return null;
          const p = lab.players[catapultPicker.playerIndex];
          if (!p) return null;
          // Preview from current player position, launch direction opposite to pull, strength = drag distance
          const traj = lab.getCatapultTrajectory(p.x, p.y, -dx, -dy, strength, false);
          if (!traj) return null;
          const cs = CELL_SIZE * mazeZoom;
          const pathD = traj.arcPoints.map(([px, py], i) => `${i === 0 ? "M" : "L"} ${px * cs} ${py * cs}`).join(" ");
          const destX = (traj.destX + 0.5) * cs;
          const destY = (traj.destY + 0.5) * cs;
          return (
            <svg
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: lab.width * cs,
                height: lab.height * cs,
                pointerEvents: "none",
                zIndex: 10,
              }}
              viewBox={`0 0 ${lab.width * cs} ${lab.height * cs}`}
            >
              <path
                d={pathD}
                fill="none"
                stroke="#ffcc00"
                strokeWidth={3}
                strokeDasharray="8 6"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={0.9}
              />
              <circle cx={destX} cy={destY} r={8} fill="#ffcc00" opacity={0.6} stroke="#ffdd44" strokeWidth={2} />
            </svg>
          );
        })()}
        {catapultAnimation && lab && (() => {
          const { from, to, playerIndex } = catapultAnimation;
          const c = PLAYER_COLORS_ACTIVE[playerIndex] ?? PLAYER_COLORS[playerIndex] ?? "#888";
          const cs = CELL_SIZE * mazeZoom;
          const pathD = getParabolicArcPath(from, to, cs);
          return (
            <svg
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: lab.width * cs,
                height: lab.height * cs,
                pointerEvents: "none",
                zIndex: 15,
              }}
              viewBox={`0 0 ${lab.width * cs} ${lab.height * cs}`}
            >
              <circle r={12} fill={c} stroke="#fff" strokeWidth={2}>
                <animateMotion dur="0.6s" fill="freeze" calcMode="linear" path={pathD} />
              </circle>
            </svg>
          );
        })()}
        </div>
        </div>
      </div>

      <div
        className="dice-panel"
        style={{
          position: "fixed",
          left: diceDrag.pos.x,
          top: diceDrag.pos.y,
          width: DICE_PANEL_WIDTH,
          maxWidth: DICE_PANEL_WIDTH,
          overflow: "hidden",
          zIndex: 100,
          background: "#1a1a24",
          padding: "0.5rem",
          borderRadius: 8,
          border: "1px solid #333",
        }}
      >
        <div
          style={{ ...dragHandleStyle, marginBottom: 4, borderBottom: "none" }}
          onMouseDown={diceDrag.onMouseDown}
          onTouchStart={diceDrag.onTouchStart}
        >
          ⋮⋮
        </div>
        <div
          onClick={() => !rollDisabled && rollDice()}
          style={{ cursor: rollDisabled ? "default" : "pointer" }}
        >
          <Dice3D
            ref={diceRef}
            onRollComplete={handleRollComplete}
            disabled={rollDisabled}
          />
        </div>
        <div style={{ textAlign: "center", marginTop: 4, fontSize: "1.25rem", color: "#00ff88" }}>
          {diceResult ?? "—"}
        </div>
      </div>

      <div
        className="controls-panel"
        style={{
          ...controlsPanelStyle,
          width: DICE_PANEL_WIDTH,
          maxWidth: DICE_PANEL_WIDTH,
          overflow: "hidden",
          position: "fixed",
          left: controlsDrag.pos.x,
          top: controlsDrag.pos.y,
          zIndex: 99,
          cursor: controlsDrag.dragging ? "grabbing" : "grab",
        }}
      >
        <div
          style={dragHandleStyle}
          onMouseDown={controlsDrag.onMouseDown}
          onTouchStart={controlsDrag.onTouchStart}
        >
          ⋮⋮
        </div>
        <button
          onClick={endTurn}
          className="secondary"
          disabled={winner !== null || !!catapultPicker || !!teleportPicker}
          style={{ ...buttonStyle, ...secondaryButtonStyle, marginBottom: 6, width: "100%" }}
        >
          End turn
        </button>
        <div style={controlsSectionStyle}>
          <div style={controlsSectionLabelStyle}>Move</div>
          <div className="move-buttons" style={{ ...moveButtonsStyle, display: "grid", gridTemplateColumns: "repeat(3, 2.5rem)", gridTemplateRows: "repeat(3, 2.5rem)", gap: 2, alignSelf: "center" }}>
            <button onClick={() => doMove(0, -1, false)} disabled={!canMoveUp} style={{ ...moveButtonStyle, gridColumn: 2, gridRow: 1 }} title="Move up">↑</button>
            <button onClick={() => doMove(-1, 0, false)} disabled={!canMoveLeft} style={{ ...moveButtonStyle, gridColumn: 1, gridRow: 2 }} title="Move left">←</button>
            <button onClick={() => doMove(1, 0, false)} disabled={!canMoveRight} style={{ ...moveButtonStyle, gridColumn: 3, gridRow: 2 }} title="Move right">→</button>
            <button onClick={() => doMove(0, 1, false)} disabled={!canMoveDown} style={{ ...moveButtonStyle, gridColumn: 2, gridRow: 3 }} title="Move down">↓</button>
          </div>
        </div>
        <div style={{ ...controlsSectionStyle, borderColor: "#66aaff", background: (cp?.jumps ?? 0) > 0 ? "#1e2e3e22" : undefined }}>
          <div style={{ ...controlsSectionLabelStyle, color: "#66aaff" }}>Jump {(cp?.jumps ?? 0) > 0 && `×${cp?.jumps ?? 0}`} <span style={{ fontSize: "0.65rem", color: "#888", fontWeight: "normal" }}>(Arrow/WASD)</span></div>
          <div className="jump-buttons" style={{ ...moveButtonsStyle, display: "grid", gridTemplateColumns: "repeat(3, 2.5rem)", gridTemplateRows: "repeat(3, 2.5rem)", gap: 2, alignSelf: "center", padding: 4, borderRadius: 8, border: "2px solid #66aaff" }}>
            <button onClick={() => doMove(0, -1, true)} disabled={!canJumpUp} style={{ ...moveButtonStyle, ...jumpButtonStyle, gridColumn: 2, gridRow: 1 }} title="Jump up">J↑</button>
            <button onClick={() => doMove(-1, 0, true)} disabled={!canJumpLeft} style={{ ...moveButtonStyle, ...jumpButtonStyle, gridColumn: 1, gridRow: 2 }} title="Jump left">J←</button>
            <button onClick={() => doMove(1, 0, true)} disabled={!canJumpRight} style={{ ...moveButtonStyle, ...jumpButtonStyle, gridColumn: 3, gridRow: 2 }} title="Jump right">J→</button>
            <button onClick={() => doMove(0, 1, true)} disabled={!canJumpDown} style={{ ...moveButtonStyle, ...jumpButtonStyle, gridColumn: 2, gridRow: 3 }} title="Jump down">J↓</button>
          </div>
        </div>
        <div style={{ ...controlsSectionStyle, borderColor: "#ff8844", background: (cp?.bombs ?? 0) > 0 ? "#2e1e1e22" : undefined }}>
          <div style={{ ...controlsSectionLabelStyle, color: "#ff8844" }}>Bomb {(cp?.bombs ?? 0) > 0 && `×${cp?.bombs ?? 0}`}</div>
          <button
            onClick={handleUseBomb}
            disabled={!cp || (cp?.bombs ?? 0) <= 0 || (moveDisabled && !combatState)}
            style={{ ...buttonStyle, width: "100%", background: (cp?.bombs ?? 0) > 0 ? "#ff8844" : "#444", color: "#fff" }}
            title={combatState ? "Explode 3×3 to clear monster (no move cost)" : "Explode 3×3 area (uses 1 move)"}
          >
            💣 Use Bomb
          </button>
        </div>

        {error && <div className="error" style={errorStyle}>{error}</div>}
      </div>
        </div>
      </div>

      {winner !== null && (
        <div style={gameOverOverlayStyle} onClick={(e) => e.target === e.currentTarget && newGame()}>
          <div style={gameOverModalStyle} onClick={(e) => e.stopPropagation()}>
            <h2 style={gameOverTitleStyle}>
              {winner >= 0 ? "🏆 Victory!" : "💀 Game Over"}
            </h2>
            <p style={{ ...gameOverResultStyle, color: winner >= 0 ? "#00ff88" : "#ff6666" }}>
              {winner >= 0
                ? `${playerNames[winner] ?? `Player ${winner + 1}`} wins!`
                : "Monsters win!"}
            </p>
            <div style={gameOverStatsStyle}>
              {lab.players.map((p, i) => (
                <div key={i} style={{ ...gameOverStatRowStyle, color: lab.eliminatedPlayers.has(i) ? "#666" : (PLAYER_COLORS[i] ?? "#888") }}>
                  <span style={{ fontWeight: "bold" }}>{playerNames[i] ?? `Player ${i + 1}`}</span>
                  {lab.eliminatedPlayers.has(i) && <span style={{ marginLeft: 6, color: "#ff6666" }}>(out)</span>}
                  <span style={{ marginLeft: 8, color: "#aaa", fontSize: "0.9rem" }}>
                    Turns: {playerTurns[i] ?? 0} · Moves: {playerMoves[i] ?? 0} · 💎 {p?.diamonds ?? 0}
                  </span>
                </div>
              ))}
            </div>
            <button onClick={newGame} style={gameOverRestartButtonStyle}>
              Restart Game
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const HEADER_HEIGHT = 64;

const gameOverOverlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.8)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1100,
};

const gameOverModalStyle: React.CSSProperties = {
  background: "#1a1a24",
  padding: "2rem",
  borderRadius: 12,
  border: "1px solid #333",
  boxShadow: "0 0 40px rgba(0,255,136,0.2)",
  minWidth: 320,
  maxWidth: 400,
};

const gameOverTitleStyle: React.CSSProperties = {
  margin: "0 0 0.5rem 0",
  color: "#00ff88",
  fontSize: "1.5rem",
  fontWeight: "bold",
  textAlign: "center",
};

const gameOverResultStyle: React.CSSProperties = {
  margin: "0 0 1.5rem 0",
  fontSize: "1.2rem",
  textAlign: "center",
  color: "#c0c0c0",
};

const gameOverStatsStyle: React.CSSProperties = {
  marginBottom: "1.5rem",
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const gameOverStatRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
};

const gameOverRestartButtonStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.75rem 1.5rem",
  fontSize: "1rem",
  fontWeight: "bold",
  background: "#00ff88",
  color: "#0a0a0f",
  border: "none",
  borderRadius: 8,
  cursor: "pointer",
};

const gamePaneStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  background: "#0f0f14",
};

const STATS_PANEL_WIDTH = 180;

const statsPanelStyle: React.CSSProperties = {
  width: STATS_PANEL_WIDTH,
  flexShrink: 0,
  background: "#1a1a24",
  borderRight: "1px solid #333",
  padding: "1rem",
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
  gap: "0.75rem",
};

const mainContentStyle: React.CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  overflow: "hidden",
};

const headerStyle: React.CSSProperties = {
  height: HEADER_HEIGHT,
  minHeight: HEADER_HEIGHT,
  flexShrink: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0.5rem 1rem",
  background: "#1a1a24",
  borderBottom: "1px solid #333",
  position: "relative",
  zIndex: 10,
};

const headerTitleStyle: React.CSSProperties = {
  fontSize: "1.5rem",
  margin: 0,
  color: "#00ff88",
};

const headerButtonStyle: React.CSSProperties = {
  padding: "0.4rem 0.8rem",
  fontSize: "0.85rem",
};

const headerStatsStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 0,
  flex: 1,
  justifyContent: "center",
  flexWrap: "wrap",
  margin: "0 1rem",
  fontSize: "0.85rem",
};

const headerStatItemStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  color: "#aaa",
};

const headerStatDivider: React.CSSProperties = {
  margin: "0 0.5rem",
  color: "#555",
  fontSize: "0.8rem",
};

const eliminatedOverlayStyle: React.CSSProperties = {
  position: "fixed",
  top: HEADER_HEIGHT + 20,
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 500,
  pointerEvents: "none",
};

const eliminatedBannerStyle: React.CSSProperties = {
  background: "rgba(0,0,0,0.9)",
  border: "2px solid #ff4444",
  borderRadius: 8,
  padding: "0.75rem 1.5rem",
  color: "#ff6666",
  fontSize: "1.1rem",
  fontWeight: "bold",
  display: "flex",
  alignItems: "center",
  gap: 12,
  boxShadow: "0 0 20px rgba(255,68,68,0.5)",
  animation: "effectPop 0.8s ease-out",
};

const effectToastStyle: React.CSSProperties = {
  position: "fixed",
  top: HEADER_HEIGHT + 70,
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 500,
  pointerEvents: "none",
  background: "rgba(0,0,0,0.85)",
  border: "2px solid #00ff88",
  borderRadius: 8,
  padding: "0.5rem 1rem",
  fontSize: "1rem",
  fontWeight: "bold",
  display: "flex",
  alignItems: "center",
  gap: 12,
  boxShadow: "0 0 20px rgba(0,255,136,0.4)",
  animation: "effectPop 0.5s ease-out",
};

const startModalOverlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "linear-gradient(135deg, #0a0a12 0%, #151520 50%, #0f0f18 100%)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
};

const startModalStyle: React.CSSProperties = {
  background: "#1a1a24",
  padding: "2rem",
  borderRadius: 12,
  border: "1px solid #333",
  boxShadow: "0 0 40px rgba(0,255,136,0.15)",
  minWidth: 320,
  maxWidth: 420,
};

const startModalTitleStyle: React.CSSProperties = {
  margin: "0 0 0.25rem 0",
  color: "#00ff88",
  fontSize: "1.8rem",
  fontWeight: "bold",
  textAlign: "center",
  letterSpacing: 4,
};

const startModalSubtitleStyle: React.CSSProperties = {
  margin: "0 0 1.5rem 0",
  color: "#888",
  fontSize: "0.9rem",
  textAlign: "center",
};

const startModalFormStyle: React.CSSProperties = {
  marginBottom: "1.5rem",
};

const startModalLabelStyle: React.CSSProperties = {
  color: "#aaa",
  fontSize: "0.85rem",
  minWidth: 120,
};

const startModalSelectStyle: React.CSSProperties = {
  padding: "0.4rem 0.6rem",
  fontFamily: "inherit",
  background: "#2a2a35",
  border: "1px solid #444",
  color: "#c0c0c0",
  borderRadius: 6,
  flex: 1,
};

const startModalInputStyle: React.CSSProperties = {
  padding: "0.4rem 0.6rem",
  fontFamily: "inherit",
  background: "#2a2a35",
  border: "1px solid #444",
  color: "#c0c0c0",
  borderRadius: 6,
  width: "4rem",
};

const startModalButtonsStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const startButtonStyle: React.CSSProperties = {
  padding: "0.75rem 1.5rem",
  fontSize: "1rem",
  fontWeight: "bold",
  background: "#00ff88",
  color: "#0a0a0f",
  border: "none",
  borderRadius: 8,
  cursor: "pointer",
  transition: "all 0.2s",
  boxShadow: "0 0 12px rgba(0,255,136,0.4)",
};

const startSecondaryButtonStyle: React.CSSProperties = {
  padding: "0.5rem 1rem",
  fontSize: "0.9rem",
  background: "transparent",
  color: "#66aaff",
  border: "1px solid #66aaff",
  borderRadius: 6,
  cursor: "pointer",
};

const modalOverlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.7)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
};

const combatModalOverlayStyle: React.CSSProperties = {
  ...modalOverlayStyle,
  background: "rgba(0,0,0,0.85)",
  zIndex: 1050,
};

const combatModalStyle: React.CSSProperties = {
  background: "#1a1a24",
  padding: "2rem",
  borderRadius: 12,
  border: "2px solid #ffcc00",
  boxShadow: "0 0 40px rgba(255,204,0,0.3)",
  minWidth: 320,
  maxWidth: 420,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
};

const combatModalTitleStyle: React.CSSProperties = {
  margin: "0 0 1.5rem 0",
  color: "#ffcc00",
  fontSize: "1.4rem",
  fontWeight: "bold",
  textAlign: "center",
};

const combatRollSectionStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  width: "100%",
};

const combatMonsterInfoStyle: React.CSSProperties = {
  marginBottom: 1,
  color: "#aaa",
  fontSize: "0.95rem",
};

const combatResultSectionStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  width: "100%",
  gap: 12,
};

const combatResultBannerStyle: React.CSSProperties = {
  padding: "1rem 1.5rem",
  borderRadius: 8,
  border: "2px solid",
  fontSize: "1.1rem",
};

const combatStatsStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  color: "#888",
  fontSize: "0.9rem",
};

const modalStyle: React.CSSProperties = {
  background: "#1a1a24",
  padding: "1.5rem",
  borderRadius: 8,
  border: "1px solid #333",
  minWidth: 280,
  maxHeight: "90vh",
  overflowY: "auto",
};

const modalTitleStyle: React.CSSProperties = {
  margin: "0 0 1rem 0",
  color: "#00ff88",
  fontSize: "1.2rem",
};

const modalRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  marginBottom: "0.75rem",
};

const MAZE_MARGIN = 16;

const mazeAreaStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  position: "relative",
  overflow: "auto",
  padding: MAZE_MARGIN,
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  justifyContent: "flex-start",
};

const mazeZoomControlsStyle: React.CSSProperties = {
  position: "sticky",
  top: 0,
  left: 0,
  zIndex: 5,
  display: "flex",
  alignItems: "center",
  gap: 4,
  marginBottom: 8,
  background: "#1a1a24",
  padding: "4px 8px",
  borderRadius: 6,
  border: "1px solid #333",
};

const mazeZoomButtonStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  padding: 0,
  fontSize: "1.2rem",
  lineHeight: 1,
  background: "#2a2a35",
  color: "#00ff88",
  border: "1px solid #444",
  borderRadius: 4,
  cursor: "pointer",
};

const jumpActionButtonStyle: React.CSSProperties = {
  position: "absolute",
  right: 4,
  bottom: 4,
  width: 22,
  height: 22,
  padding: 0,
  fontSize: "0.75rem",
  fontWeight: "bold",
  background: "#66aaff",
  color: "#0a0a0f",
  border: "none",
  borderRadius: 4,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxShadow: "0 0 6px rgba(102,170,255,0.6)",
};

const mainStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "nowrap",
  gap: "1.5rem",
  alignItems: "flex-start",
  justifyContent: "flex-start",
  padding: "1.5rem",
  overflowX: "auto",
  minHeight: "100vh",
};

const mazeWrapStyle: React.CSSProperties = {
  background: "#1a1a24",
  padding: "1.5rem",
  borderRadius: 8,
  border: "1px solid #333",
  boxShadow: "0 0 20px rgba(0,255,136,0.1)",
  flexShrink: 0,
};

const h1Style: React.CSSProperties = {
  fontSize: "1.5rem",
  margin: "0 0 1rem 0",
  color: "#00ff88",
};

const mazeStyle: React.CSSProperties = {
  display: "grid",
  gap: 0,
  fontSize: "1.4rem",
  lineHeight: 1,
  letterSpacing: "0.02em",
};

const cellStyle: React.CSSProperties = {
  width: CELL_SIZE,
  height: CELL_SIZE,
  minWidth: CELL_SIZE,
  minHeight: CELL_SIZE,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const markerStyle: React.CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: "50%",
  margin: "auto",
  opacity: 1,
};

const dragHandleStyle: React.CSSProperties = {
  padding: "4px 0",
  fontSize: "0.75rem",
  color: "#666",
  textAlign: "center",
  cursor: "grab",
  touchAction: "none",
  userSelect: "none",
  borderBottom: "1px solid #333",
  marginBottom: 6,
};

const controlsPanelStyle: React.CSSProperties = {
  width: 120,
  flexShrink: 0,
  background: "#1a1a24",
  padding: "0.5rem",
  borderRadius: 8,
  border: "1px solid #333",
  boxShadow: "0 0 20px rgba(0,255,136,0.1)",
  display: "flex",
  flexDirection: "column",
  gap: 0,
};

const infoStyle: React.CSSProperties = {
  marginTop: "1rem",
  fontSize: "0.85rem",
  color: "#888",
};

const playerLegendStyle: React.CSSProperties = {
  display: "flex",
  gap: "0.75rem",
  flexWrap: "wrap",
  marginTop: "0.5rem",
  fontSize: "0.8rem",
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  gap: "1rem",
  alignItems: "center",
  marginTop: "0.75rem",
  flexWrap: "wrap",
};

const buttonStyle: React.CSSProperties = {
  padding: "0.5rem 1rem",
  fontFamily: "inherit",
  fontSize: "0.9rem",
  background: "#00ff88",
  color: "#0a0a0f",
  border: "none",
  borderRadius: 4,
  cursor: "pointer",
};

const secondaryButtonStyle: React.CSSProperties = {
  background: "#444",
  color: "#c0c0c0",
};

const controlsSectionStyle: React.CSSProperties = {
  marginTop: 8,
  padding: 6,
  borderRadius: 6,
  border: "1px solid #444",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 4,
};

const controlsSectionLabelStyle: React.CSSProperties = {
  fontSize: "0.7rem",
  fontWeight: "bold",
  color: "#888",
  textTransform: "uppercase",
};

const moveButtonsStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, 2.5rem)",
  gridTemplateRows: "repeat(3, 2.5rem)",
  gap: 2,
  marginTop: "0.5rem",
};

const moveButtonStyle: React.CSSProperties = {
  width: "2.5rem",
  height: "2.5rem",
  padding: 0,
  fontSize: "1.2rem",
  background: "#00ff88",
  color: "#0a0a0f",
  border: "none",
  borderRadius: 4,
  cursor: "pointer",
};

const jumpButtonStyle: React.CSSProperties = {
  background: "#66aaff",
  color: "#0a0a0f",
  border: "2px solid #4488ff",
  boxShadow: "0 0 8px rgba(102,170,255,0.5)",
  fontSize: "0.9rem",
};

const controlsStyle: React.CSSProperties = {
  marginTop: "0.5rem",
  fontSize: "0.8rem",
};

const selectStyle: React.CSSProperties = {
  padding: "0.25rem 0.5rem",
  fontFamily: "inherit",
  background: "#2a2a35",
  border: "1px solid #444",
  color: "#c0c0c0",
  borderRadius: 4,
};

const inputStyle: React.CSSProperties = {
  width: "3rem",
  padding: "0.25rem",
  fontFamily: "inherit",
  background: "#2a2a35",
  border: "1px solid #444",
  color: "#c0c0c0",
  borderRadius: 4,
};

const wonStyle: React.CSSProperties = {
  marginTop: "1rem",
  color: "#00ff88",
  fontWeight: "bold",
};

const errorStyle: React.CSSProperties = {
  color: "#ff6666",
  fontSize: "0.85rem",
  marginTop: "0.5rem",
};

const bonusHighlightStyle: React.CSSProperties = {
  color: "#ffcc00",
  fontWeight: "bold",
};

const bonusBadgeStyle: React.CSSProperties = {
  color: "#00ff88",
  fontSize: "0.8rem",
  marginLeft: 4,
};
