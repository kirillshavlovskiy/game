"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Dice3D, { Dice3DRef } from "@/components/Dice3D";
import {
  Labyrinth,
  DIFFICULTY,
  PLAYER_COLORS,
  PLAYER_COLORS_ACTIVE,
  isMultiplierCell,
  getMultiplierValue,
  isMagicCell,
  isJumpCell,
  isDiamondCell,
  getCollectibleOwner,
  getMonsterName,
  type MonsterType,
} from "@/lib/labyrinth";

const CELL_SIZE = 32;

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
  const [diceResult, setDiceResult] = useState<number | null>(null);
  const [winner, setWinner] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [difficulty, setDifficulty] = useState(21);
  const [numPlayers, setNumPlayers] = useState(3);
  const [rolling, setRolling] = useState(false);
  const [bonusAdded, setBonusAdded] = useState<number | null>(null);
  const [jumpAdded, setJumpAdded] = useState<number | null>(null);
  const [eliminatedByMonster, setEliminatedByMonster] = useState<{
    playerIndex: number;
    monsterType: MonsterType;
  } | null>(null);
  const [teleportAnimation, setTeleportAnimation] = useState<{
    from: [number, number];
    to: [number, number];
    playerIndex: number;
  } | null>(null);
  const [jumpAnimation, setJumpAnimation] = useState<{
    playerIndex: number;
    x: number;
    y: number;
  } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [playerNames, setPlayerNames] = useState<string[]>(() =>
    Array.from({ length: 3 }, (_, i) => `Player ${i + 1}`)
  );
  const diceRef = useRef<Dice3DRef>(null);
  const movesLeftRef = useRef(0);
  const winnerRef = useRef(winner);
  const currentPlayerRef = useRef(currentPlayer);

  useEffect(() => {
    movesLeftRef.current = movesLeft;
  }, [movesLeft]);
  useEffect(() => {
    winnerRef.current = winner;
    currentPlayerRef.current = currentPlayer;
  }, [winner, currentPlayer]);

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

  const getDimensions = useCallback(() => {
    return DIFFICULTY[difficulty] ?? 25;
  }, [difficulty]);

  const newGame = useCallback(() => {
    const n = Math.min(Math.max(1, numPlayers), 9);
    const size = getDimensions();
    const extraPaths = Math.max(4, n * 2);
    const l = new Labyrinth(size, size, extraPaths, n);
    l.generate();
    setLab(l);
    setCurrentPlayer(0);
    movesLeftRef.current = 0;
    setMovesLeft(0);
    setTotalMoves(0);
    setDiceResult(null);
    setWinner(null);
    setError("");
    setBonusAdded(null);
    setJumpAdded(null);
    setEliminatedByMonster(null);
    setTeleportAnimation(null);
    setJumpAnimation(null);
  }, [getDimensions, numPlayers]);

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
      const l = new Labyrinth(w, h, 0, n);
      if (l.loadGrid(data.grid)) {
        setLab(l);
        setCurrentPlayer(0);
        movesLeftRef.current = 0;
        setMovesLeft(0);
        setTotalMoves(0);
        setDiceResult(null);
        setWinner(null);
        setError("");
        setBonusAdded(null);
        setTeleportAnimation(null);
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
  }, [getDimensions, numPlayers, newGame]);

  const handleRollComplete = useCallback((value: number) => {
    setDiceResult(value);
    movesLeftRef.current = value;
    setMovesLeft(value);
    setRolling(false);
    setBonusAdded(null);
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

  const doMove = useCallback(
    (dx: number, dy: number, jumpOnly = false) => {
      if (winner !== null || !lab) return;
      if (movesLeftRef.current <= 0) return;
      movesLeftRef.current--;
      setBonusAdded(null);
      setJumpAdded(null);
      const next = new Labyrinth(lab.width, lab.height, 0, lab.numPlayers);
      next.grid = lab.grid.map((r) => [...r]);
      next.players = lab.players.map((p) => ({
        ...p,
        jumps: p.jumps ?? 0,
        diamonds: p.diamonds ?? 0,
      }));
      next.goalX = lab.goalX;
      next.goalY = lab.goalY;
      next.monsters = lab.monsters.map((m) => ({
        ...m,
        patrolArea: [...m.patrolArea],
      }));
      next.eliminatedPlayers = new Set(lab.eliminatedPlayers);
      if (next.movePlayer(dx, dy, currentPlayer, jumpOnly)) {
        const newMovesLeft = Math.max(0, movesLeftRef.current);
        setMovesLeft(newMovesLeft);
        setTotalMoves((t) => t + 1);
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
          if (cell && isMagicCell(cell) && newMovesLeft === 0) {
            const from: [number, number] = [p.x, p.y];
            const dest = next.getTeleportDestination(currentPlayer);
            if (dest && next.teleportToRandomMagicCell(currentPlayer)) {
              setTeleportAnimation({ from, to: dest, playerIndex: currentPlayer });
            }
          }
          const owner = cell ? getCollectibleOwner(cell) : null;
          if (owner === currentPlayer && cell && isDiamondCell(cell)) {
            p.diamonds = (p.diamonds ?? 0) + 1;
            next.grid[p.y][p.x] = " ";
          }
        }
        next.moveMonsters({ prevX, prevY, playerIndex: currentPlayer });
        const collision = next.checkMonsterCollision();
        if (collision) {
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

  useEffect(() => {
    newGame();
  }, []);

  const MONSTER_MOVE_INTERVAL_MS = 2200;

  useEffect(() => {
    if (!lab || winner !== null) return;
    const id = setInterval(() => {
      setLab((prev) => {
        if (!prev || winnerRef.current !== null) return prev;
        const next = new Labyrinth(prev.width, prev.height, 0, prev.numPlayers);
        next.grid = prev.grid.map((r) => [...r]);
        next.players = prev.players.map((p) => ({
          ...p,
          jumps: p.jumps ?? 0,
          diamonds: p.diamonds ?? 0,
        }));
        next.goalX = prev.goalX;
        next.goalY = prev.goalY;
        next.monsters = prev.monsters.map((m) => ({
          ...m,
          patrolArea: [...m.patrolArea],
        }));
        next.eliminatedPlayers = new Set(prev.eliminatedPlayers);
        next.moveMonsters();
        const collision = next.checkMonsterCollision();
        if (collision) {
          next.eliminatedPlayers.add(collision.playerIndex);
          setEliminatedByMonster({ playerIndex: collision.playerIndex, monsterType: collision.monsterType });
          if (next.eliminatedPlayers.size >= next.numPlayers) {
            setWinner(-1);
          } else if (collision.playerIndex === currentPlayerRef.current) {
            movesLeftRef.current = 0;
            setMovesLeft(0);
            setDiceResult(null);
            let nextP = (currentPlayerRef.current + 1) % prev.numPlayers;
            while (next.eliminatedPlayers.has(nextP) && nextP !== currentPlayerRef.current) {
              nextP = (nextP + 1) % prev.numPlayers;
            }
            setCurrentPlayer(nextP);
          }
        }
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
        const jumpOnly = e.shiftKey;
        doMove(d[0], d[1], jumpOnly);
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newGame, doMove]);

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

  const handleCellTap = useCallback(
    (cellX: number, cellY: number) => {
      if (moveDisabled || !cp || !lab) return;
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
    [moveDisabled, cp, jumpTargets, lab, currentPlayer, doMove]
  );

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

      {(bonusAdded !== null || jumpAdded !== null) && (
        <div style={effectToastStyle} className="effect-toast">
          {bonusAdded !== null && diceResult !== null && (
            <span style={{ color: "#ffcc00" }}>×{bonusAdded / diceResult} moves!</span>
          )}
          {jumpAdded !== null && (
            <span style={{ color: "#66aaff", marginLeft: bonusAdded ? 12 : 0 }}>
              {jumpAdded > 1 ? `×${jumpAdded} jumps!` : `+1 jump!`}
            </span>
          )}
        </div>
      )}

      {settingsOpen && (
        <div style={modalOverlayStyle} onClick={() => setSettingsOpen(false)}>
          <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
            <h2 style={modalTitleStyle}>Game Setup</h2>
            <div style={modalRowStyle}>
              <label>Difficulty:</label>
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(Number(e.target.value))}
                style={selectStyle}
              >
                <option value={7}>Easy (7×7)</option>
                <option value={11}>Medium (11×11)</option>
                <option value={15}>Hard (15×15)</option>
                <option value={21}>Expert (21×21)</option>
                <option value={25}>Large (25×25)</option>
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
        <div
          className="maze-wrap"
          style={{
            ...mazeWrapStyle,
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
          }}
        >
        <div
          className="maze"
          style={{
            ...mazeStyle,
            gridTemplateColumns: `repeat(${lab.width}, ${CELL_SIZE}px)`,
          }}
        >
          {Array.from({ length: lab.height }).map((_, y) =>
            Array.from({ length: lab.width }).map((_, x) => {
              const monster = lab.monsters.find((m) => m.x === x && m.y === y);
              const pi = playerCells[`${x},${y}`];
              let content: React.ReactNode = null;
              let cellClass = "cell";

              if (monster) {
                cellClass += " path monster";
                const icon = monster.type === "V" ? "🧛" : monster.type === "Z" ? "🧟" : "🕷";
                content = (
                  <span className="monster-icon" style={{ fontSize: "1.2rem", lineHeight: 1 }} title={getMonsterName(monster.type)}>
                    {icon}
                  </span>
                );
              }
              if (pi !== undefined && !lab.eliminatedPlayers.has(pi)) {
                cellClass += " path";
                const c =
                  pi === currentPlayer
                    ? PLAYER_COLORS_ACTIVE[pi] ?? "#888"
                    : PLAYER_COLORS[pi] ?? "#888";
                const isTeleportRise =
                  teleportAnimation?.to[0] === x &&
                  teleportAnimation?.to[1] === y &&
                  teleportAnimation?.playerIndex === pi;
                const isJumpLanding =
                  jumpAnimation?.x === x && jumpAnimation?.y === y && jumpAnimation?.playerIndex === pi;
                content = (
                  <div
                    className={`marker ${pi === currentPlayer ? "active" : ""} ${isTeleportRise ? "teleport-rise" : ""} ${isJumpLanding ? "jump-landing" : ""}`}
                    style={{
                      ...markerStyle,
                      background: c,
                      boxShadow: pi === currentPlayer ? `0 0 8px ${c}, 0 0 12px ${c}` : undefined,
                    }}
                  />
                );
              } else if (x === lab.goalX && y === lab.goalY) {
                content = "X";
                cellClass += " goal";
              } else if (x === 0 && y === 0 && !playerCells["0,0"]) {
                content = "S";
                cellClass += " start";
              } else if (isMultiplierCell(lab.grid[y][x])) {
                content = `×${lab.grid[y][x]}`;
                cellClass += " path multiplier mult-x" + lab.grid[y][x];
              } else if (showSecretCells && isMagicCell(lab.grid[y][x])) {
                content = (
                  <span className="hole-cell" style={{ fontSize: "1.1rem" }} title="Teleport hole">
                    ○
                  </span>
                );
                cellClass += " path magic hole";
              } else if (showSecretCells && isJumpCell(lab.grid[y][x])) {
                content = "J";
                cellClass += " path jump";
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
              }
              if (cellClass.includes("jump")) {
                cellBg.background = "#1e2e2e";
                cellBg.color = "#66aaff";
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
              }

              const isTeleportFrom =
                teleportAnimation?.from[0] === x && teleportAnimation?.from[1] === y;
              const fallColor =
                teleportAnimation && lab.players[teleportAnimation.playerIndex]
                  ? PLAYER_COLORS_ACTIVE[teleportAnimation.playerIndex] ?? "#888"
                  : "#888";
              const jumpTarget = jumpTargets.find((t) => t.x === x && t.y === y);

              const isTappable = !moveDisabled && (cellClass.includes("path") || !!jumpTarget);

              return (
                <div
                  key={`${x}-${y}`}
                  className={cellClass}
                  style={{
                    ...cellStyle,
                    ...cellBg,
                    position: "relative",
                    cursor: isTappable ? "pointer" : undefined,
                    touchAction: isTappable ? "manipulation" : undefined,
                  }}
                  onClick={() => isTappable && handleCellTap(x, y)}
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
                          width: 18,
                          height: 18,
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
          <div style={{ ...controlsSectionLabelStyle, color: "#66aaff" }}>Jump {(cp?.jumps ?? 0) > 0 && `×${cp?.jumps ?? 0}`}</div>
          <div className="jump-buttons" style={{ ...moveButtonsStyle, display: "grid", gridTemplateColumns: "repeat(3, 2.5rem)", gridTemplateRows: "repeat(3, 2.5rem)", gap: 2, alignSelf: "center", padding: 4, borderRadius: 8, border: "2px solid #66aaff" }}>
            <button onClick={() => doMove(0, -1, true)} disabled={!canJumpUp} style={{ ...moveButtonStyle, ...jumpButtonStyle, gridColumn: 2, gridRow: 1 }} title="Jump up">J↑</button>
            <button onClick={() => doMove(-1, 0, true)} disabled={!canJumpLeft} style={{ ...moveButtonStyle, ...jumpButtonStyle, gridColumn: 1, gridRow: 2 }} title="Jump left">J←</button>
            <button onClick={() => doMove(1, 0, true)} disabled={!canJumpRight} style={{ ...moveButtonStyle, ...jumpButtonStyle, gridColumn: 3, gridRow: 2 }} title="Jump right">J→</button>
            <button onClick={() => doMove(0, 1, true)} disabled={!canJumpDown} style={{ ...moveButtonStyle, ...jumpButtonStyle, gridColumn: 2, gridRow: 3 }} title="Jump down">J↓</button>
          </div>
        </div>

        {winner !== null && (
          <div className="won" style={wonStyle}>
            *** Player {winner + 1} WINS! ***
          </div>
        )}

        {error && <div className="error" style={errorStyle}>{error}</div>}
      </div>
    </div>
  );
}

const HEADER_HEIGHT = 64;

const gamePaneStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  background: "#0f0f14",
};

const headerStyle: React.CSSProperties = {
  minHeight: HEADER_HEIGHT,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0.5rem 1rem",
  background: "#1a1a24",
  borderBottom: "1px solid #333",
  flexShrink: 0,
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

const mazeAreaStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  position: "relative",
  overflow: "auto",
  paddingTop: 12,
};

const jumpActionButtonStyle: React.CSSProperties = {
  position: "absolute",
  right: 2,
  bottom: 2,
  width: 18,
  height: 18,
  padding: 0,
  fontSize: "0.65rem",
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
  fontSize: "1.25rem",
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
  width: 18,
  height: 18,
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
