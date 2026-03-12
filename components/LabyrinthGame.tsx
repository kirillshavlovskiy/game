"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Dice3D, { Dice3DRef } from "@/components/Dice3D";
import {
  Labyrinth,
  DIFFICULTY,
  PLAYER_COLORS,
  PLAYER_COLORS_ACTIVE,
} from "@/lib/labyrinth";

const CELL_SIZE = 32;

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
  const diceRef = useRef<Dice3DRef>(null);

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
  }, []);

  const rollDice = useCallback(async () => {
    if (winner !== null || !lab || movesLeft > 0) return;
    setRolling(true);
    await diceRef.current?.roll();
  }, [lab, movesLeft, winner]);

  const endTurn = useCallback(() => {
    if (winner !== null || !lab) return;
    setCurrentPlayer((p) => (p + 1) % lab.numPlayers);
    setMovesLeft(0);
    setDiceResult(null);
  }, [lab, winner]);

  const doMove = useCallback(
    (dx: number, dy: number) => {
      if (winner !== null || !lab || movesLeft <= 0) return;
      const next = new Labyrinth(lab.width, lab.height, 0, lab.numPlayers);
      next.grid = lab.grid.map((r) => [...r]);
      next.players = lab.players.map((p) => ({ ...p }));
      next.goalX = lab.goalX;
      next.goalY = lab.goalY;
      if (next.movePlayer(dx, dy, currentPlayer)) {
        setMovesLeft((m) => m - 1);
        setTotalMoves((t) => t + 1);
        if (next.isGoalReached(currentPlayer)) {
          setWinner(currentPlayer);
        }
        setLab(next);
        if (movesLeft === 1 && winner === null) {
          setCurrentPlayer((p) => (p + 1) % lab.numPlayers);
          setDiceResult(null);
        }
      }
    },
    [lab, currentPlayer, movesLeft, winner]
  );

  useEffect(() => {
    newGame();
  }, []);

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

  return (
    <div className="main" style={mainStyle}>
      <div className="maze-wrap" style={mazeWrapStyle}>
        <h1 style={h1Style}>LABYRINTH</h1>
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
                content = (
                  <div
                    className={`marker ${pi === currentPlayer ? "active" : ""}`}
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

              return (
                <div
                  key={`${x}-${y}`}
                  className={cellClass}
                  style={{ ...cellStyle, ...cellBg }}
                >
                  {content}
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="controls-panel" style={controlsPanelStyle}>
        <div className="info" style={infoStyle}>
          <span>
            {winner === null
              ? `Player ${currentPlayer + 1}`
              : `Player ${winner + 1} wins!`}
          </span>
          &nbsp;|&nbsp; Moves left: <span>{movesLeft}</span> &nbsp;|&nbsp; Moves:{" "}
          <span>{totalMoves}</span>
        </div>
        <div className="info" style={{ ...infoStyle, marginTop: 4 }}>
          S=Start &nbsp; X=Goal
        </div>
        <div className="player-legend" style={playerLegendStyle}>
          {lab.players.map((_, i) => {
            const c =
              i === currentPlayer
                ? PLAYER_COLORS_ACTIVE[i] ?? "#888"
                : PLAYER_COLORS[i] ?? "#888";
            return (
              <span
                key={i}
                className={i === currentPlayer ? "legend-item active" : "legend-item"}
                style={{ color: c, display: "flex", alignItems: "center", gap: 4 }}
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
              </span>
            );
          })}
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

        <div className="row" style={rowStyle}>
          <button
            onClick={rollDice}
            disabled={rollDisabled}
            style={buttonStyle}
          >
            Roll dice
          </button>
          <span
            className="dice"
            style={{ fontSize: "1.5rem", margin: "0 0.5rem" }}
            title="Dice result = moves you can make"
          >
            {diceResult ?? "—"}
          </span>
          <button
            onClick={endTurn}
            className="secondary"
            disabled={winner !== null}
            style={{ ...buttonStyle, ...secondaryButtonStyle }}
          >
            End turn
          </button>
        </div>

        <div
          className="move-buttons"
          style={{
            ...moveButtonsStyle,
            display: "grid",
            gridTemplateColumns: "repeat(3, 2.5rem)",
            gridTemplateRows: "repeat(3, 2.5rem)",
            gap: 2,
          }}
        >
          <button
            onClick={() => doMove(0, -1)}
            disabled={moveDisabled}
            style={{ ...moveButtonStyle, gridColumn: 2, gridRow: 1 }}
            title="Up"
          >
            ↑
          </button>
          <button
            onClick={() => doMove(-1, 0)}
            disabled={moveDisabled}
            style={{ ...moveButtonStyle, gridColumn: 1, gridRow: 2 }}
            title="Left"
          >
            ←
          </button>
          <button
            onClick={() => doMove(1, 0)}
            disabled={moveDisabled}
            style={{ ...moveButtonStyle, gridColumn: 3, gridRow: 2 }}
            title="Right"
          >
            →
          </button>
          <button
            onClick={() => doMove(0, 1)}
            disabled={moveDisabled}
            style={{ ...moveButtonStyle, gridColumn: 2, gridRow: 3 }}
            title="Down"
          >
            ↓
          </button>
        </div>

        <div className="controls" style={controlsStyle}>
          WASD or Arrow keys &nbsp;|&nbsp; R = New maze
        </div>

        <div className="row" style={rowStyle}>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            Difficulty:{" "}
            <select
              id="difficulty"
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
          </label>
        </div>

        <div className="row" style={rowStyle}>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            Players:{" "}
            <input
              type="number"
              id="numPaths"
              min={1}
              max={10}
              value={numPlayers}
              onChange={(e) => setNumPlayers(Number(e.target.value) || 1)}
              style={inputStyle}
            />
          </label>
        </div>

        <div className="row" style={rowStyle}>
          <button onClick={generateWithAI} style={buttonStyle}>
            Generate with AI
          </button>
          <button
            onClick={newGame}
            className="secondary"
            style={{ ...buttonStyle, ...secondaryButtonStyle }}
          >
            Random Maze
          </button>
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

const mainStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "2rem",
  alignItems: "flex-start",
  justifyContent: "flex-start",
  padding: "1.5rem",
};

const mazeWrapStyle: React.CSSProperties = {
  background: "#1a1a24",
  padding: "1.5rem",
  borderRadius: 8,
  border: "1px solid #333",
  boxShadow: "0 0 20px rgba(0,255,136,0.1)",
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
  width: 280,
  flexShrink: 0,
  marginLeft: "auto",
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
