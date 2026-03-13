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
} from "@/lib/labyrinth";

const CELL_SIZE = 32;

function useDraggable(getInitial: () => { x: number; y: number }) {
  const [pos, setPos] = useState(() =>
    typeof window !== "undefined" ? getInitial() : { x: 0, y: 0 }
  );
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef({ startX: 0, startY: 0, startPosX: 0, startPosY: 0 });

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPosX: pos.x,
      startPosY: pos.y,
    };
  }, [pos.x, pos.y]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      setPos({
        x: dragRef.current.startPosX + e.clientX - dragRef.current.startX,
        y: dragRef.current.startPosY + e.clientY - dragRef.current.startY,
      });
    };
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  return { pos, onMouseDown, dragging };
}

export default function LabyrinthGame() {
  const [lab, setLab] = useState<Labyrinth | null>(null);
  const [currentPlayer, setCurrentPlayer] = useState(0);
  const [movesLeft, setMovesLeft] = useState(0);
  const [totalMoves, setTotalMoves] = useState(0);
  const [diceResult, setDiceResult] = useState<number | null>(null);
  const [winner, setWinner] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [difficulty, setDifficulty] = useState(25);
  const [numPlayers, setNumPlayers] = useState(3);
  const [rolling, setRolling] = useState(false);
  const [bonusAdded, setBonusAdded] = useState<number | null>(null);
  const [teleportAnimation, setTeleportAnimation] = useState<{
    from: [number, number];
    to: [number, number];
    playerIndex: number;
  } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const diceRef = useRef<Dice3DRef>(null);

  const diceDrag = useDraggable(() => ({
    x: window.innerWidth - 220,
    y: 20,
  }));
  const controlsDrag = useDraggable(() => ({
    x: Math.max(20, window.innerWidth / 2 - 180),
    y: window.innerHeight - 320,
  }));

  useEffect(() => {
    if (!teleportAnimation) return;
    const t = setTimeout(() => setTeleportAnimation(null), 600);
    return () => clearTimeout(t);
  }, [teleportAnimation]);

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
    setMovesLeft(0);
    setTotalMoves(0);
    setDiceResult(null);
    setWinner(null);
    setError("");
    setBonusAdded(null);
    setTeleportAnimation(null);
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
    setMovesLeft(value);
    setRolling(false);
    setBonusAdded(null);
  }, []);

  const rollDice = useCallback(async () => {
    if (winner !== null || !lab || movesLeft > 0) return;
    setRolling(true);
    await diceRef.current?.roll();
  }, [lab, movesLeft, winner]);

  const doMove = useCallback(
    (dx: number, dy: number) => {
      if (winner !== null || !lab || movesLeft <= 0) return;
      setBonusAdded(null);
      const next = new Labyrinth(lab.width, lab.height, 0, lab.numPlayers);
      next.grid = lab.grid.map((r) => [...r]);
      next.players = lab.players.map((p) => ({
        ...p,
        jumps: p.jumps ?? 0,
        diamonds: p.diamonds ?? 0,
      }));
      next.goalX = lab.goalX;
      next.goalY = lab.goalY;
      if (next.movePlayer(dx, dy, currentPlayer)) {
        const newMovesLeft = movesLeft - 1;
        setMovesLeft(newMovesLeft);
        setTotalMoves((t) => t + 1);
        const p = next.players[currentPlayer];
        if (p) {
          const cell = next.grid[p.y]?.[p.x];
          if (cell && isJumpCell(cell)) p.jumps = (p.jumps ?? 0) + 1;
          if (cell && isMagicCell(cell) && movesLeft === 1) {
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
        if (next.isGoalReached(currentPlayer)) {
          setWinner(currentPlayer);
        }
        setLab(next);
        if (movesLeft === 1 && winner === null) {
          const cp = next.players[currentPlayer];
          const cell = cp && next.grid[cp.y]?.[cp.x];
          if (cell && isMultiplierCell(cell) && diceResult !== null) {
            const mult = getMultiplierValue(cell);
            const bonus = diceResult * mult;
            setMovesLeft(bonus);
            setBonusAdded(bonus);
          } else {
            setCurrentPlayer((p) => (p + 1) % lab.numPlayers);
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

  useEffect(() => {
    if (!lab || winner !== null || movesLeft > 0 || rolling) return;
    const t = setTimeout(() => rollDice(), 400);
    return () => clearTimeout(t);
  }, [lab, winner, movesLeft, rolling, rollDice]);

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
        doMove(d[0], d[1]);
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newGame, doMove]);

  if (!lab) return null;

  const playerCells: Record<string, number> = {};
  lab.players.forEach((p, i) => {
    playerCells[`${p.x},${p.y}`] = i;
  });
  const cp = lab.players[currentPlayer];
  if (cp) playerCells[`${cp.x},${cp.y}`] = currentPlayer;

  const moveDisabled = movesLeft <= 0 || winner !== null;
  const rollDisabled = movesLeft > 0 || winner !== null || rolling;
  const showSecretCells = movesLeft > 0;
  const jumpTargets = cp && (cp.jumps ?? 0) > 0 && !moveDisabled ? lab.getJumpTargets(currentPlayer) : [];
  const canUp = !moveDisabled && lab.canMoveInDirection(0, -1, currentPlayer);
  const canLeft = !moveDisabled && lab.canMoveInDirection(-1, 0, currentPlayer);
  const canRight = !moveDisabled && lab.canMoveInDirection(1, 0, currentPlayer);
  const canDown = !moveDisabled && lab.canMoveInDirection(0, 1, currentPlayer);

  return (
    <div style={gamePaneStyle}>
      <header style={headerStyle}>
        <h1 style={headerTitleStyle}>LABYRINTH</h1>
        <button
          onClick={() => setSettingsOpen(true)}
          style={{ ...buttonStyle, ...headerButtonStyle }}
        >
          Setup
        </button>
      </header>

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
              const pi = playerCells[`${x},${y}`];
              let content: React.ReactNode = null;
              let cellClass = "cell";

              if (pi !== undefined) {
                cellClass += " path";
                const c =
                  pi === currentPlayer
                    ? PLAYER_COLORS_ACTIVE[pi] ?? "#888"
                    : PLAYER_COLORS[pi] ?? "#888";
                const isTeleportRise =
                  teleportAnimation?.to[0] === x &&
                  teleportAnimation?.to[1] === y &&
                  teleportAnimation?.playerIndex === pi;
                content = (
                  <div
                    className={`marker ${pi === currentPlayer ? "active" : ""} ${isTeleportRise ? "teleport-rise" : ""}`}
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

              const isTeleportFrom =
                teleportAnimation?.from[0] === x && teleportAnimation?.from[1] === y;
              const fallColor =
                teleportAnimation && lab.players[teleportAnimation.playerIndex]
                  ? PLAYER_COLORS_ACTIVE[teleportAnimation.playerIndex] ?? "#888"
                  : "#888";
              const jumpTarget = jumpTargets.find((t) => t.x === x && t.y === y);

              return (
                <div
                  key={`${x}-${y}`}
                  className={cellClass}
                  style={{ ...cellStyle, ...cellBg, position: "relative" }}
                >
                  {content}
                  {jumpTarget && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        doMove(jumpTarget.dx, jumpTarget.dy);
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
        style={{
          position: "fixed",
          left: diceDrag.pos.x,
          top: diceDrag.pos.y,
          zIndex: 100,
          background: "#1a1a24",
          padding: "0.5rem",
          borderRadius: 8,
          border: "1px solid #333",
          boxShadow: "0 0 20px rgba(0,255,136,0.1)",
          cursor: diceDrag.dragging ? "grabbing" : "grab",
        }}
        onMouseDown={diceDrag.onMouseDown}
      >
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
          position: "fixed",
          left: controlsDrag.pos.x,
          top: controlsDrag.pos.y,
          zIndex: 99,
          cursor: controlsDrag.dragging ? "grabbing" : "grab",
        }}
        onMouseDown={controlsDrag.onMouseDown}
      >
        <div className="info" style={infoStyle}>
          <span>
            {winner === null
              ? `Player ${currentPlayer + 1}`
              : `Player ${winner + 1} wins!`}
          </span>
          &nbsp;|&nbsp; Moves left:{" "}
          <span style={bonusAdded !== null ? bonusHighlightStyle : undefined}>
            {movesLeft}
            {bonusAdded !== null && (
              <span style={bonusBadgeStyle}> +{bonusAdded} bonus!</span>
            )}
          </span>
          &nbsp;|&nbsp; Moves: <span>{totalMoves}</span>
          {cp && (cp.jumps ?? 0) > 0 && (
            <>
              &nbsp;|&nbsp; Jumps: <span style={{ color: "#66aaff" }}>{cp.jumps}</span>
            </>
          )}
        </div>
        <div className="info" style={{ ...infoStyle, marginTop: 4 }}>
          S=Start &nbsp; X=Goal &nbsp; ×2/×3/×4=Bonus &nbsp; ○=Teleport hole &nbsp; J=Jump
          {showSecretCells && " &nbsp; 💎=Diamond (your color)"}
        </div>
        <div className="player-legend" style={playerLegendStyle}>
          {lab.players.map((_, i) => {
            const c =
              i === currentPlayer
                ? PLAYER_COLORS_ACTIVE[i] ?? "#888"
                : PLAYER_COLORS[i] ?? "#888";
            const p = lab.players[i];
            const diamonds = p?.diamonds ?? 0;
            return (
              <span
                key={i}
                className={i === currentPlayer ? "legend-item active" : "legend-item"}
                style={{ color: c, display: "flex", alignItems: "center", gap: 6 }}
              >
                <span
                  className="dot"
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    background: c,
                  }}
                />
                <span style={{ fontSize: "0.75rem" }}>
                  💎{diamonds}
                </span>
              </span>
            );
          })}
        </div>

        <div style={{ marginTop: "0.5rem" }}>
          {cp && (cp.jumps ?? 0) > 0 && (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 10px",
                background: "#1e2e3e",
                border: "2px solid #66aaff",
                borderRadius: 6,
                color: "#66aaff",
                fontWeight: "bold",
                fontSize: "0.9rem",
                marginBottom: 6,
                boxShadow: "0 0 10px rgba(102,170,255,0.3)",
              }}
              title="Arrows can jump over walls"
            >
              <span>J</span>
              <span>×{cp.jumps}</span>
              <span style={{ fontSize: "0.75rem", fontWeight: "normal", opacity: 0.9 }}>
                Jump active
              </span>
            </div>
          )}
        </div>
        <div
          className="move-buttons"
          style={{
            ...moveButtonsStyle,
            display: "grid",
            gridTemplateColumns: "repeat(3, 2.5rem)",
            gridTemplateRows: "repeat(3, 2.5rem)",
            gap: 2,
            ...(cp && (cp.jumps ?? 0) > 0
              ? {
                  padding: 4,
                  borderRadius: 8,
                  border: "2px solid #66aaff",
                  boxShadow: "0 0 12px rgba(102,170,255,0.4)",
                }
              : {}),
          }}
        >
          <button
            onClick={() => doMove(0, -1)}
            disabled={!canUp}
            style={{
              ...moveButtonStyle,
              gridColumn: 2,
              gridRow: 1,
              ...(canUp && cp && (cp.jumps ?? 0) > 0 ? jumpButtonStyle : {}),
            }}
            title={cp && (cp.jumps ?? 0) > 0 ? "Up (or jump over wall)" : "Up"}
          >
            {cp && (cp.jumps ?? 0) > 0 ? "J↑" : "↑"}
          </button>
          <button
            onClick={() => doMove(-1, 0)}
            disabled={!canLeft}
            style={{
              ...moveButtonStyle,
              gridColumn: 1,
              gridRow: 2,
              ...(canLeft && cp && (cp.jumps ?? 0) > 0 ? jumpButtonStyle : {}),
            }}
            title={cp && (cp.jumps ?? 0) > 0 ? "Left (or jump over wall)" : "Left"}
          >
            {cp && (cp.jumps ?? 0) > 0 ? "J←" : "←"}
          </button>
          <button
            onClick={() => doMove(1, 0)}
            disabled={!canRight}
            style={{
              ...moveButtonStyle,
              gridColumn: 3,
              gridRow: 2,
              ...(canRight && cp && (cp.jumps ?? 0) > 0 ? jumpButtonStyle : {}),
            }}
            title={cp && (cp.jumps ?? 0) > 0 ? "Right (or jump over wall)" : "Right"}
          >
            {cp && (cp.jumps ?? 0) > 0 ? "J→" : "→"}
          </button>
          <button
            onClick={() => doMove(0, 1)}
            disabled={!canDown}
            style={{
              ...moveButtonStyle,
              gridColumn: 2,
              gridRow: 3,
              ...(canDown && cp && (cp.jumps ?? 0) > 0 ? jumpButtonStyle : {}),
            }}
            title={cp && (cp.jumps ?? 0) > 0 ? "Down (or jump over wall)" : "Down"}
          >
            {cp && (cp.jumps ?? 0) > 0 ? "J↓" : "↓"}
          </button>
        </div>

        <div className="controls" style={controlsStyle}>
          WASD or Arrow keys &nbsp;|&nbsp; R = New maze &nbsp;|&nbsp; Dice auto-rolls
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

const HEADER_HEIGHT = 56;

const gamePaneStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  background: "#0f0f14",
};

const headerStyle: React.CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  height: HEADER_HEIGHT,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0 1rem",
  background: "#1a1a24",
  borderBottom: "1px solid #333",
  flexShrink: 0,
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
  marginTop: HEADER_HEIGHT,
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

const controlsPanelStyle: React.CSSProperties = {
  width: 360,
  flexShrink: 0,
  background: "#1a1a24",
  padding: "1.5rem",
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
