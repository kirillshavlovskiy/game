"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Dice3D, { Dice3DRef } from "@/components/Dice3D";
import {
  Labyrinth,
  PATH,
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
  type MonsterType,
} from "@/lib/labyrinth";

const CELL_SIZE = 44;

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
  const [bombGained, setBombGained] = useState<boolean | null>(null);
  const [hiddenGemTeleport, setHiddenGemTeleport] = useState<boolean | null>(null);
  const [cellsRevealed, setCellsRevealed] = useState<number | null>(null);
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
  const [mazeZoom, setMazeZoom] = useState(1);
  const [gameStarted, setGameStarted] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [playerNames, setPlayerNames] = useState<string[]>(() =>
    Array.from({ length: 3 }, (_, i) => `Player ${i + 1}`)
  );
  const diceRef = useRef<Dice3DRef>(null);
  const movesLeftRef = useRef(0);
  const winnerRef = useRef(winner);
  const currentPlayerRef = useRef(currentPlayer);
  const teleportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hiddenGemTeleportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentPlayerCellRef = useRef<HTMLDivElement | null>(null);

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
    if (winner !== null || !lab || lab.eliminatedPlayers.has(currentPlayer)) return;
    const el = currentPlayerCellRef.current;
    if (el) {
      const id = requestAnimationFrame(() => {
        el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      });
      return () => cancelAnimationFrame(id);
    }
  }, [currentPlayer, lab, winner]);

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
    setShieldGained(null);
    setBombGained(null);
    setHiddenGemTeleport(null);
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
        setShieldGained(null);
        setBombGained(null);
        setHiddenGemTeleport(null);
        setCellsRevealed(null);
        setTeleportAnimation(null);
        setCatapultMode(false);
        setCatapultPicker(null);
        setCatapultDragOffset(null);
        setCatapultAnimation(null);
        setBombExplosion(null);
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
    setDiceResult(value);
    movesLeftRef.current = value;
    setMovesLeft(value);
    setRolling(false);
    setBonusAdded(null);
    setPlayerTurns((prev) => {
      const next = [...prev];
      if (currentPlayerRef.current < next.length) next[currentPlayerRef.current] = (next[currentPlayerRef.current] ?? 0) + 1;
      return next;
    });
  }, []);

  const rollDice = useCallback(async () => {
    if (winner !== null || !lab || movesLeft > 0) return;
    setRolling(true);
    await diceRef.current?.roll();
  }, [lab, movesLeft, winner]);

  const endTurn = useCallback(() => {
    if (winner !== null || !lab) return;
    let nextP = (currentPlayer + 1) % lab.numPlayers;
    while (lab.eliminatedPlayers.has(nextP) && nextP !== currentPlayer) {
      nextP = (nextP + 1) % lab.numPlayers;
    }
    setCurrentPlayer(nextP);
    movesLeftRef.current = 0;
    setMovesLeft(0);
    setDiceResult(null);
    setBonusAdded(null);
  }, [lab, winner, currentPlayer]);

  const handleUseBomb = useCallback(() => {
    if (!lab || winner !== null || lab.eliminatedPlayers.has(currentPlayer)) return;
    const cp = lab.players[currentPlayer];
    if (!cp || (cp.bombs ?? 0) <= 0 || movesLeftRef.current <= 0) return;
    const next = new Labyrinth(lab.width, lab.height, 0, lab.numPlayers, lab.monsterDensity);
    next.grid = lab.grid.map((r) => [...r]);
    next.players = lab.players.map((p) => ({ ...p, jumps: p.jumps ?? 0, diamonds: p.diamonds ?? 0, shield: p.shield ?? 0, bombs: p.bombs ?? 0 }));
    next.hiddenCells = new Map(lab.hiddenCells);
    next.webPositions = [...(lab.webPositions || [])];
    next.goalX = lab.goalX;
    next.goalY = lab.goalY;
    next.monsters = lab.monsters.map((m) => ({ ...m, patrolArea: [...m.patrolArea] }));
    next.eliminatedPlayers = new Set(lab.eliminatedPlayers);
    const result = next.useBomb(currentPlayer);
    if (!result.used) return;
    setBombExplosion({ x: cp.x, y: cp.y });
    setLab(next);
    movesLeftRef.current--;
    setMovesLeft((m) => Math.max(0, m - 1));
    setTotalMoves((t) => t + 1);
    setPlayerMoves((prev) => {
      const arr = [...prev];
      if (currentPlayer < arr.length) arr[currentPlayer] = (arr[currentPlayer] ?? 0) + 1;
      return arr;
    });
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
      movesLeftRef.current--;
      setBonusAdded(null);
      setJumpAdded(null);
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
      next.goalX = lab.goalX;
      next.goalY = lab.goalY;
      next.monsters = lab.monsters.map((m) => ({
        ...m,
        patrolArea: [...m.patrolArea],
      }));
      next.eliminatedPlayers = new Set(lab.eliminatedPlayers);
      const moveSucceeded = next.movePlayer(dx, dy, currentPlayer, jumpOnly);
      if (!moveSucceeded) {
        movesLeftRef.current++;
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
        if (jumpOnly && p) {
          setJumpAnimation({ playerIndex: currentPlayer, x: p.x, y: p.y });
        }
        if (p) {
          const cell = next.grid[p.y]?.[p.x];
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
          if (cell && isBombCell(cell)) {
            p.bombs = (p.bombs ?? 0) + 1;
            setBombGained(true);
            // Bomb stays on cell so other players can collect it too
          }
          if (cell && isMagicCell(cell)) {
            const magicX = p.x;
            const magicY = p.y;
            const playerToTeleport = currentPlayer;
            teleportTimerRef.current = setTimeout(() => {
              teleportTimerRef.current = null;
              setLab((prev) => {
                if (!prev || winnerRef.current !== null) return prev;
                const cp = prev.players[playerToTeleport];
                if (!cp || cp.x !== magicX || cp.y !== magicY) return prev;
                const cellNow = prev.grid[cp.y]?.[cp.x];
                if (!cellNow || !isMagicCell(cellNow)) return prev;
                const options = prev.getTeleportOptions(playerToTeleport, 6);
                if (options.length > 0) {
                  setTeleportPicker({ playerIndex: playerToTeleport, from: [magicX, magicY], options });
                }
                return prev;
              });
            }, 1000);
          }
          if (cell && isCatapultCell(cell)) {
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
            // Random hidden gem in some diamonds: shield, jump, or teleport
            if (Math.random() < 0.4) {
              const gems = ["shield", "jump", "teleport"] as const;
              const gem = gems[Math.floor(Math.random() * gems.length)];
              if (gem === "shield") {
                p.shield = (p.shield ?? 0) + 1;
                setShieldGained(true);
              } else if (gem === "jump") {
                p.jumps = (p.jumps ?? 0) + 1;
                setJumpAdded(1);
              } else {
                setHiddenGemTeleport(true);
                const fromX = p.x;
                const fromY = p.y;
                const playerToTeleport = currentPlayer;
                if (teleportTimerRef.current) {
                  clearTimeout(teleportTimerRef.current);
                  teleportTimerRef.current = null;
                }
                if (hiddenGemTeleportTimerRef.current) {
                  clearTimeout(hiddenGemTeleportTimerRef.current);
                  hiddenGemTeleportTimerRef.current = null;
                }
                hiddenGemTeleportTimerRef.current = setTimeout(() => {
                  hiddenGemTeleportTimerRef.current = null;
                  setLab((prev) => {
                    if (!prev || winnerRef.current !== null) return prev;
                    const cp = prev.players[playerToTeleport];
                    if (!cp || cp.x !== fromX || cp.y !== fromY) return prev;
                    if (prev.eliminatedPlayers.has(playerToTeleport)) return prev;
                    const options = prev.getTeleportOptions(playerToTeleport, 6);
                    if (options.length > 0) {
                      setTeleportPicker({ playerIndex: playerToTeleport, from: [fromX, fromY], options });
                    }
                    return prev;
                  });
                }, 400);
              }
            }
          }
        }
        next.moveMonsters({ prevX, prevY, playerIndex: currentPlayer });
        const collision = next.checkMonsterCollision(currentPlayer);
        if (collision) {
          const usedShield = next.tryConsumeShield(collision.playerIndex);
          if (usedShield) {
            setShieldAbsorbed(true);
          } else {
            next.eliminatedPlayers.add(collision.playerIndex);
            setEliminatedByMonster({ playerIndex: collision.playerIndex, monsterType: collision.monsterType });
            if (next.eliminatedPlayers.size >= next.numPlayers) {
              setWinner(-1);
            } else if (collision.playerIndex === currentPlayer) {
              movesLeftRef.current = 0;
              setMovesLeft(0);
              setDiceResult(null);
              let nextP = (currentPlayer + 1) % lab.numPlayers;
              while (next.eliminatedPlayers.has(nextP) && nextP !== currentPlayer) {
                nextP = (nextP + 1) % lab.numPlayers;
              }
              setCurrentPlayer(nextP);
            }
          }
        }
        if (next.isGoalReached(currentPlayer)) {
          setWinner(currentPlayer);
        }
        setLab(next);
        const hadCollision = !!collision;
        if (movesLeft === 1 && winner === null && !hadCollision) {
          const cp = next.players[currentPlayer];
          const cell = cp && next.grid[cp.y]?.[cp.x];
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
            let nextP = (currentPlayer + 1) % lab.numPlayers;
            while (next.eliminatedPlayers.has(nextP) && nextP !== currentPlayer) {
              nextP = (nextP + 1) % lab.numPlayers;
            }
            setCurrentPlayer(nextP);
            setDiceResult(null);
          }
        }
      }
    },
    [lab, currentPlayer, movesLeft, winner, diceResult]
  );

  // Game starts only when user clicks Start in the start modal

  const MONSTER_MOVE_INTERVAL_MS = 2200;

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
        }));
        next.goalX = prev.goalX;
        next.goalY = prev.goalY;
        next.monsters = prev.monsters.map((m) => ({
          ...m,
          patrolArea: [...m.patrolArea],
        }));
        next.eliminatedPlayers = new Set(prev.eliminatedPlayers);
        next.hiddenCells = new Map(prev.hiddenCells);
        next.webPositions = [...(prev.webPositions || [])];
        next.moveMonsters();
        return next;
      });
    }, MONSTER_MOVE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [lab?.width, lab?.height, lab?.numPlayers, winner]);

  useEffect(() => {
    if (!lab || winner !== null || movesLeft > 0 || rolling) return;
    if (lab.eliminatedPlayers.has(currentPlayer)) {
      let nextP = (currentPlayer + 1) % lab.numPlayers;
      while (lab.eliminatedPlayers.has(nextP) && nextP !== currentPlayer) {
        nextP = (nextP + 1) % lab.numPlayers;
      }
      setCurrentPlayer(nextP);
      return;
    }
    const t = setTimeout(() => rollDice(), 400);
    return () => clearTimeout(t);
  }, [lab, winner, movesLeft, rolling, rollDice, currentPlayer]);

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
        const jumpOnly = e.shiftKey; // Shift+Arrow = jump
        doMove(d[0], d[1], jumpOnly);
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newGame, doMove, lab]);

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
  const rollDisabled = movesLeft > 0 || gameOver || rolling;
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
    (dx: number, dy: number) => {
      if (!lab || !catapultPicker || !catapultMode) return;
      const { playerIndex, from } = catapultPicker;
      const next = new Labyrinth(lab.width, lab.height, 0, lab.numPlayers, lab.monsterDensity);
      next.grid = lab.grid.map((r) => [...r]);
      next.players = lab.players.map((p) => ({ ...p, jumps: p.jumps ?? 0, diamonds: p.diamonds ?? 0, shield: p.shield ?? 0, bombs: p.bombs ?? 0 }));
      next.hiddenCells = new Map(lab.hiddenCells);
      next.webPositions = [...(lab.webPositions || [])];
      next.goalX = lab.goalX;
      next.goalY = lab.goalY;
      next.monsters = lab.monsters.map((m) => ({ ...m, patrolArea: [...m.patrolArea] }));
      next.eliminatedPlayers = new Set(lab.eliminatedPlayers);
      const result = next.catapultLaunch(playerIndex, dx, dy);
      if (result) {
        setCatapultAnimation({ from, to: [result.destX, result.destY], playerIndex });
        setTeleportPicker(null);
        setCatapultPicker(null);
        setCatapultMode(false);
        setTotalMoves((t) => t + 1);
        setPlayerMoves((prev) => {
          const arr = [...prev];
          if (playerIndex < arr.length) arr[playerIndex] = (arr[playerIndex] ?? 0) + 1;
          return arr;
        });
        next.moveMonsters({ prevX: from[0], prevY: from[1], playerIndex });
        const collision = next.checkMonsterCollision(playerIndex);
        if (collision) {
          const usedShield = next.tryConsumeShield(collision.playerIndex);
          if (usedShield) setShieldAbsorbed(true);
          else {
            next.eliminatedPlayers.add(collision.playerIndex);
            setEliminatedByMonster({ playerIndex: collision.playerIndex, monsterType: collision.monsterType });
          }
        }
        if (next.isGoalReached(playerIndex)) setWinner(playerIndex);
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
      const dx = d.startX - releaseX;
      const dy = d.startY - releaseY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 15) return; // too short a drag
      const launchDx = Math.abs(dx) >= Math.abs(dy) ? Math.sign(dx) : 0;
      const launchDy = Math.abs(dy) > Math.abs(dx) ? Math.sign(dy) : 0;
      if (launchDx !== 0 || launchDy !== 0) {
        handleCatapultLaunch(launchDx, launchDy);
      }
    };
    window.addEventListener("pointerup", onPointerUp);
    return () => window.removeEventListener("pointerup", onPointerUp);
  }, [catapultMode, catapultPicker, handleCatapultLaunch]);

  const handleTeleportSelect = useCallback(
    (destX: number, destY: number) => {
      if (!teleportPicker || !lab) return;
      const { playerIndex, from } = teleportPicker;
      const next = new Labyrinth(lab.width, lab.height, 0, lab.numPlayers, lab.monsterDensity);
      next.grid = lab.grid.map((r) => [...r]);
      next.players = lab.players.map((p) => ({ ...p, jumps: p.jumps ?? 0, diamonds: p.diamonds ?? 0, shield: p.shield ?? 0, bombs: p.bombs ?? 0 }));
      next.hiddenCells = new Map(lab.hiddenCells);
      next.webPositions = [...(lab.webPositions || [])];
      next.goalX = lab.goalX;
      next.goalY = lab.goalY;
      next.monsters = lab.monsters.map((m) => ({ ...m, patrolArea: [...m.patrolArea] }));
      next.eliminatedPlayers = new Set(lab.eliminatedPlayers);
      if (next.teleportToCell(playerIndex, destX, destY)) {
        setTeleportAnimation({ from, to: [destX, destY], playerIndex });
        setLab(next);
        setTeleportPicker(null);
      }
    },
    [teleportPicker, lab]
  );

  const handleCellTap = useCallback(
    (cellX: number, cellY: number) => {
      if (!lab) return;
      if (teleportPicker) {
        const isOption = teleportPicker.options.some(([ox, oy]) => ox === cellX && oy === cellY);
        if (isOption) handleTeleportSelect(cellX, cellY);
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
      {(teleportPicker || catapultPicker) && (
        <div style={{ ...eliminatedOverlayStyle, pointerEvents: "none" }}>
          <div style={{ ...eliminatedBannerStyle, borderColor: catapultPicker ? "#ffcc00" : "#aa66ff", background: "rgba(0,0,0,0.9)", pointerEvents: "auto", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            {catapultPicker ? (
              <>
                <span style={{ color: "#ffcc00" }}>Catapult: drag marker back, then release to launch</span>
                <button onClick={() => { setCatapultMode(false); setCatapultPicker(null); setCatapultDragOffset(null); }} style={{ ...buttonStyle, padding: "4px 12px", fontSize: "0.85rem" }}>Cancel</button>
              </>
            ) : (
              <>
                <span style={{ color: "#aa66ff" }}>Pick teleport destination (click ○ on map)</span>
                <button onClick={() => setTeleportPicker(null)} style={{ ...buttonStyle, padding: "4px 12px", fontSize: "0.85rem" }}>Cancel</button>
              </>
            )}
          </div>
        </div>
      )}

      {eliminatedByMonster && (
        <div style={eliminatedOverlayStyle}>
          <div style={eliminatedBannerStyle}>
            <span style={{ color: "#ff4444", fontSize: "1.5rem" }}>💀</span>
            <span>
              {playerNames[eliminatedByMonster.playerIndex] ?? `Player ${eliminatedByMonster.playerIndex + 1}`} lost to {getMonsterName(eliminatedByMonster.monsterType)}!
            </span>
          </div>
        </div>
      )}

      {(bonusAdded !== null || jumpAdded !== null || shieldAbsorbed !== null || shieldGained !== null || bombGained !== null || hiddenGemTeleport !== null || cellsRevealed !== null) && (
        <div style={effectToastStyle} className="effect-toast">
          {bonusAdded !== null && diceResult !== null && (
            <span style={{ color: "#ffcc00" }}>×{bonusAdded / diceResult} moves!</span>
          )}
          {jumpAdded !== null && (
            <span style={{ color: "#66aaff", marginLeft: bonusAdded ? 12 : 0 }}>
              {jumpAdded > 1 ? `×${jumpAdded} jumps!` : `+1 jump!`}
            </span>
          )}
          {shieldAbsorbed !== null && (
            <span style={{ color: "#44ff88", marginLeft: 12 }}>🛡 Shield absorbed attack!</span>
          )}
          {shieldGained !== null && (
            <span style={{ color: "#44ff88", marginLeft: 12 }}>🛡 +1 Shield!</span>
          )}
          {bombGained !== null && (
            <span style={{ color: "#ff8844", marginLeft: 12 }}>💣 +1 Bomb!</span>
          )}
          {hiddenGemTeleport !== null && (
            <span style={{ color: "#aa66ff", marginLeft: 12 }}>✨ Hidden gem: Teleport!</span>
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
          }}
        >
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

              const monsterIcon = monster ? (
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
                  (teleportAnimation?.to[0] === x && teleportAnimation?.to[1] === y && teleportAnimation?.playerIndex === pi) ||
                  (catapultAnimation?.to[0] === x && catapultAnimation?.to[1] === y && catapultAnimation?.playerIndex === pi);
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
                      transformOrigin: `${catapultDragOffset.dx >= 0 ? "right" : "left"} ${catapultDragOffset.dy >= 0 ? "bottom" : "top"}`,
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
                const dirIndicators = pi === currentPlayer && cp && !moveDisabled ? (
                  <>
                    {(canMoveUp || canJumpUp) && (
                      <span style={{ ...dirHintStyle, top: -dirOffset, left: "50%", transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                        {canMoveUp && <span style={{ color: "#00ff88" }}>↑{movesLeft}</span>}
                        {canJumpUp && <span style={{ color: "#66aaff", fontSize: "0.65rem" }}>J↑{cp.jumps ?? 0}</span>}
                      </span>
                    )}
                    {(canMoveDown || canJumpDown) && (
                      <span style={{ ...dirHintStyle, bottom: -dirOffset, left: "50%", transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                        {canMoveDown && <span style={{ color: "#00ff88" }}>↓{movesLeft}</span>}
                        {canJumpDown && <span style={{ color: "#66aaff", fontSize: "0.65rem" }}>J↓{cp.jumps ?? 0}</span>}
                      </span>
                    )}
                    {(canMoveLeft || canJumpLeft) && (
                      <span style={{ ...dirHintStyle, left: -dirOffset, top: "50%", transform: "translateY(-50%)", display: "flex", flexDirection: "row", alignItems: "center", gap: 4 }}>
                        {canMoveLeft && <span style={{ color: "#00ff88" }}>←{movesLeft}</span>}
                        {canJumpLeft && <span style={{ color: "#66aaff", fontSize: "0.65rem" }}>J←{cp.jumps ?? 0}</span>}
                      </span>
                    )}
                    {(canMoveRight || canJumpRight) && (
                      <span style={{ ...dirHintStyle, right: -dirOffset, top: "50%", transform: "translateY(-50%)", display: "flex", flexDirection: "row", alignItems: "center", gap: 4 }}>
                        {canMoveRight && <span style={{ color: "#00ff88" }}>→{movesLeft}</span>}
                        {canJumpRight && <span style={{ color: "#66aaff", fontSize: "0.65rem" }}>J→{cp.jumps ?? 0}</span>}
                      </span>
                    )}
                  </>
                ) : null;
                content = (
                  <div style={{ position: "relative", width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {monsterIcon && <span style={{ position: "absolute", left: 2, top: 2, fontSize: "1rem", lineHeight: 1 }}>{monsterIcon}</span>}
                    {playerMarker}
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
              } else if (isMultiplierCell(lab.grid[y][x])) {
                content = `×${lab.grid[y][x]}`;
                cellClass += " path multiplier mult-x" + lab.grid[y][x];
              } else if (isBombCell(lab.grid[y][x])) {
                content = (
                  <span style={{ fontSize: "1.1rem" }} title="Bomb pickup">
                    💣
                  </span>
                );
                cellClass += " path bomb";
              } else if ((showSecretCells || isTeleportOption) && isMagicCell(lab.grid[y][x])) {
                content = (
                  <span className="hole-cell" style={{ fontSize: "1.1rem" }} title="Teleport hole">
                    ○
                  </span>
                );
                cellClass += " path magic hole";
              } else if (showSecretCells && isCatapultCell(lab.grid[y][x])) {
                content = (
                  <span style={{ fontSize: "1.1rem" }} title="Catapult">
                    ⊢
                  </span>
                );
                cellClass += " path catapult";
              } else if (showSecretCells && isJumpCell(lab.grid[y][x])) {
                content = "J";
                cellClass += " path jump";
              } else if (showSecretCells && isShieldCell(lab.grid[y][x])) {
                content = "🛡";
                cellClass += " path shield";
              } else if (showSecretCells && isDiamondCell(lab.grid[y][x])) {
                const owner = getCollectibleOwner(lab.grid[y][x]);
                content = "💎";
                cellClass += " path collectible";
                if (owner !== null) cellClass += " collectible-p" + owner;
                if (owner === currentPlayer) cellClass += " collectible-mine";
              } else {
                cellClass += lab.grid[y][x] === "#" ? " wall" : " path";
                if (lab.grid[y][x] === "#") content = null;
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
                cellBg.background = "transparent";
                cellBg.color = "#ffcc00";
                cellBg.fontWeight = "bold";
                cellBg.fontSize = "0.85rem";
              }
              if (cellClass.includes("magic")) {
                cellBg.background = "#1e1e2e";
                cellBg.color = "#aa66ff";
                cellBg.fontWeight = "bold";
                if (isTeleportOption) {
                  cellBg.boxShadow = "inset 0 0 12px #aa66ff66, 0 0 8px #aa66ff";
                  cellBg.border = "2px solid #aa66ff";
                }
              }
              if (cellClass.includes("catapult")) {
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

              const isTeleportFrom =
                (teleportAnimation?.from[0] === x && teleportAnimation?.from[1] === y) ||
                (catapultAnimation?.from[0] === x && catapultAnimation?.from[1] === y);
              const fallAnim = teleportAnimation || catapultAnimation;
              const fallColor =
                fallAnim && lab.players[fallAnim.playerIndex]
                  ? PLAYER_COLORS_ACTIVE[fallAnim.playerIndex] ?? "#888"
                  : "#888";
              const jumpTarget = jumpTargets.find((t) => t.x === x && t.y === y);

              const isTappable = (teleportPicker && isTeleportOption && !catapultMode) || (!moveDisabled && !catapultMode && (cellClass.includes("path") || !!jumpTarget));

              const effectiveCellSize = CELL_SIZE * mazeZoom;
              const isCurrentPlayerCell = cp && x === cp.x && y === cp.y;
              return (
                <div
                  key={`${x}-${y}`}
                  ref={isCurrentPlayerCell ? (el) => { currentPlayerCellRef.current = el; } : undefined}
                  className={cellClass}
                  style={{
                    ...cellStyle,
                    ...cellBg,
                    width: effectiveCellSize,
                    height: effectiveCellSize,
                    minWidth: effectiveCellSize,
                    minHeight: effectiveCellSize,
                    position: "relative",
                    cursor: isTappable ? "pointer" : isCatapultSourceCell ? "grab" : undefined,
                    touchAction: isTappable || isCatapultSourceCell ? "manipulation" : undefined,
                  }}
                  onClick={() => isTappable && handleCellTap(x, y)}
                  onPointerDown={isCatapultSourceCell ? (e) => {
                    e.preventDefault();
                    const rect = (e.target as HTMLElement).getBoundingClientRect();
                    catapultDragRef.current = {
                      startX: rect.left + rect.width / 2,
                      startY: rect.top + rect.height / 2,
                      cellX: x,
                      cellY: y,
                    };
                    setCatapultDragOffset({ dx: 0, dy: 0 });
                    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                  } : undefined}
                  onPointerMove={isCatapultSourceCell ? (e) => {
                    const d = catapultDragRef.current;
                    if (!d) return;
                    const dx = d.startX - e.clientX;
                    const dy = d.startY - e.clientY;
                    setCatapultDragOffset({ dx, dy });
                  } : undefined}
                >
                  {content}
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
                  {(lab.webPositions?.some(([wx, wy]) => wx === x && wy === y)) && (
                    <div className="spider-web" style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />
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
                </div>
              );
            })
          )}
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
          boxShadow: "0 0 20px rgba(0,255,136,0.1)",
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
          disabled={winner !== null}
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
          <div style={{ ...controlsSectionLabelStyle, color: "#66aaff" }}>Jump {(cp?.jumps ?? 0) > 0 && `×${cp?.jumps ?? 0}`} <span style={{ fontSize: "0.65rem", color: "#888", fontWeight: "normal" }}>(Shift+Arrow)</span></div>
          <div className="jump-buttons" style={{ ...moveButtonsStyle, display: "grid", gridTemplateColumns: "repeat(3, 2.5rem)", gridTemplateRows: "repeat(3, 2.5rem)", gap: 2, alignSelf: "center", padding: 4, borderRadius: 8, border: "2px solid #66aaff" }}>
            <button onClick={() => doMove(0, -1, true)} disabled={!canJumpUp} style={{ ...moveButtonStyle, ...jumpButtonStyle, gridColumn: 2, gridRow: 1 }} title="Jump up (Shift+↑)">J↑</button>
            <button onClick={() => doMove(-1, 0, true)} disabled={!canJumpLeft} style={{ ...moveButtonStyle, ...jumpButtonStyle, gridColumn: 1, gridRow: 2 }} title="Jump left (Shift+←)">J←</button>
            <button onClick={() => doMove(1, 0, true)} disabled={!canJumpRight} style={{ ...moveButtonStyle, ...jumpButtonStyle, gridColumn: 3, gridRow: 2 }} title="Jump right (Shift+→)">J→</button>
            <button onClick={() => doMove(0, 1, true)} disabled={!canJumpDown} style={{ ...moveButtonStyle, ...jumpButtonStyle, gridColumn: 2, gridRow: 3 }} title="Jump down (Shift+↓)">J↓</button>
          </div>
        </div>
        <div style={{ ...controlsSectionStyle, borderColor: "#ff8844", background: (cp?.bombs ?? 0) > 0 ? "#2e1e1e22" : undefined }}>
          <div style={{ ...controlsSectionLabelStyle, color: "#ff8844" }}>Bomb {(cp?.bombs ?? 0) > 0 && `×${cp?.bombs ?? 0}`}</div>
          <button
            onClick={handleUseBomb}
            disabled={!cp || (cp?.bombs ?? 0) <= 0 || moveDisabled}
            style={{ ...buttonStyle, width: "100%", background: (cp?.bombs ?? 0) > 0 ? "#ff8844" : "#444", color: "#fff" }}
            title="Explode 3×3 area (uses 1 move)"
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
