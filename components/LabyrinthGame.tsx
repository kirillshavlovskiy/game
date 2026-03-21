"use client";

/** Combat debug logging — filter console by [COMBAT] to trace flow */
const COMBAT_LOG = true;
const combatLog = (...args: unknown[]) => {
  if (COMBAT_LOG) console.log("[COMBAT]", ...args);
};

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import Dice3D, { Dice3DRef } from "@/components/Dice3D";
import { ArtifactIcon } from "@/components/ArtifactIcon";
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
  getMonsterDamageRange,
  getMonsterMaxHp,
  isArtifactCell,
  isTrapCell,
  isWalkable,
  TRAP_LOSE_TURN,
  TRAP_HARM,
  TRAP_TELEPORT,
  ARTIFACT_DICE,
  ARTIFACT_SHIELD,
  ARTIFACT_TELEPORT as ARTIFACT_TELEPORT_CELL,
  ARTIFACT_REVEAL,
  ARTIFACT_HEALING,
  DRACULA_CONFIG,
  STORED_ARTIFACT_ORDER,
  STORED_ARTIFACT_TITLE,
  STORED_ARTIFACT_LINE,
  STORED_ARTIFACT_TOOLTIP,
  storedArtifactKindFromCell,
  peekRevealBatchSize,
  isStoredArtifactMapOnly,
  type MonsterType,
  type StoredArtifactKind,
  DEFAULT_PLAYER_HP,
} from "@/lib/labyrinth";
import {
  resolveCombat,
  getMonsterHint,
  getMonsterBonusRewardChoices,
  getSurpriseDefenseModifier,
  getMonsterReward,
  type CombatResult,
  type MonsterSurpriseState,
  type MonsterReward,
  type MonsterBonusReward,
} from "@/lib/combatSystem";
import { drawEvent, applyEvent } from "@/lib/eventDeck";
import { applyDraculaTeleport, applyDraculaAttack } from "@/lib/draculaAI";

const CELL_SIZE = 44;
/** Viewport at or below this width: hide sidebar, bottom dock = mobile (select + Use). */
const MOBILE_BREAKPOINT_PX = 768;
/** Desktop: auto-hide move pad after no interaction (ms). */
const MOVE_PAD_AUTO_HIDE_MS = 5200;

type MobileDockAction = "bomb" | StoredArtifactKind;

/** Let catapult / teleport visuals finish before turn change or clearing flight overlay */
const SPECIAL_MOVE_SETTLE_MS = 2000;
/** Player + monster portraits in combat header */
const COMBAT_FACEOFF_SPRITE_PX = 200;
/** Player portrait in combat modal — matches monster column height */
const COMBAT_PLAYER_AVATAR_PX = 200;
/** Combat attack row: buttons row height */
const COMBAT_ROLL_BUTTON_H_PX = 84;
const COMBAT_ROLL_ROW_MIN_PX = 112;
const COMBAT_ROLL_ROW_PAD_Y = 18;
/** 3D dice viewport: full modal width; height range so WebGL canvas scales (avoid 120px fallback in Dice3D) */
const COMBAT_ROLL_DICE_VIEWPORT_MIN_H = 140;
const COMBAT_ROLL_DICE_VIEWPORT_MAX_H = 220;
/** Combat: lower strip is Roll / Run only — 3D dice mounts above (Skills slot) while rolling */
const COMBAT_RESULT_SLOT_COMBAT_ROLL_STRIP_PX = 240;
/** Fixed combat hint row — same height empty or full so roll buttons / Skills don’t jump */
const COMBAT_HINT_STRIP_PX = 56;
/** Skills & artifacts card — fixed height so the rolling dice swaps into the same column footprint */
const COMBAT_SKILLS_PANEL_PX = 85;
/** Matches parent `gap` between skills card and hint strip */
const COMBAT_SKILLS_HINT_GAP_PX = 3;
/** One block: skills card + gap + hint — dice replaces this whole stack while rolling */
const COMBAT_SKILLS_HINT_STACK_TOTAL_PX =
  COMBAT_SKILLS_PANEL_PX + COMBAT_SKILLS_HINT_GAP_PX + COMBAT_HINT_STRIP_PX;
/** Dice frame, hint strip, Roll / Run — one radius so combat roll UI aligns */
const COMBAT_ROLL_UI_RADIUS_PX = 10;

/** Auto-dismiss durations — single effect uses toast.seq so overlapping timers never clear a newer toast */
const COMBAT_TOAST_AUTO_DISMISS_MS: Record<"hint" | "secondAttempt" | "footer", number> = {
  hint: 3500,
  secondAttempt: 2500,
  footer: 4000,
};

/** Combat sprites never scale — prevents layout jumping. */
/** Combat modal max width on large screens; narrows with viewport on mobile */
const COMBAT_MODAL_WIDTH = 600;
/** Taller to fit bonus loot picker without clipping the fixed result/roll slot */
const COMBAT_MODAL_HEIGHT = 900;
/** Bonus loot carousel — native img size (artifact uses diamond asset) */
const COMBAT_BONUS_LOOT_ICON_PX = 88;
/** Bonus loot strip — room for larger reward icons */
const COMBAT_RESULT_SLOT_BONUS_LOOT_PX = 300;
const FOG_GRANULARITY = 1; // 1 = per-cell (performant); 8 = fine-grained but heavy DOM
const FOG_CLEARANCE_RADIUS = 2; // Cells within this distance of player/visited get fog cleared

/** Spider web: same asset as ArtifactIcon web variant */
const SPIDER_WEB_SPRITE = "/artifacts/spider web.PNG";

function storedArtifactCount(
  p:
    | {
        artifactDice?: number;
        artifactShield?: number;
        artifactTeleport?: number;
        artifactReveal?: number;
        artifactHealing?: number;
      }
    | undefined
    | null,
  kind: StoredArtifactKind
): number {
  if (!p) return 0;
  switch (kind) {
    case "dice":
      return p.artifactDice ?? 0;
    case "shield":
      return p.artifactShield ?? 0;
    case "teleport":
      return p.artifactTeleport ?? 0;
    case "reveal":
      return p.artifactReveal ?? 0;
    case "healing":
      return p.artifactHealing ?? 0;
  }
}

function storedArtifactIconVariant(kind: StoredArtifactKind): "dice" | "shield" | "magic" | "reveal" | "healing" {
  if (kind === "teleport") return "magic";
  return kind;
}

/** Bottom-panel button accent per stored artifact (consistent layout). */
const STORED_ARTIFACT_BUTTON_STYLE: Record<StoredArtifactKind, { background: string; color: string }> = {
  dice: { background: "#ffcc00", color: "#111" },
  shield: { background: "#44ff88", color: "#111" },
  teleport: { background: "#aa66ff", color: "#fff" },
  reveal: { background: "#6688ff", color: "#fff" },
  healing: { background: "#44aa88", color: "#fff" },
};

function SpiderWebCell() {
  const [imgFailed, setImgFailed] = useState(false);
  if (!imgFailed) {
    return (
      <img
        src={SPIDER_WEB_SPRITE}
        alt=""
        style={{ width: "100%", height: "100%", objectFit: "contain", opacity: 0.9 }}
        onError={() => setImgFailed(true)}
      />
    );
  }
  return (
    <svg viewBox="0 0 44 44" preserveAspectRatio="xMidYMid slice" style={{ width: "100%", height: "100%" }}>
      <defs>
        <linearGradient id="web-strand-fallback" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="rgba(240,245,255,0.7)" />
          <stop offset="100%" stopColor="rgba(200,210,230,0.5)" />
        </linearGradient>
      </defs>
      <g stroke="url(#web-strand-fallback)" strokeWidth="0.35" fill="none" strokeLinecap="round">
        {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
          const rad = (deg * Math.PI) / 180;
          const ex = 22 + 22 * Math.cos(rad);
          const ey = 22 + 22 * Math.sin(rad);
          return <line key={deg} x1={22} y1={22} x2={ex} y2={ey} />;
        })}
        <circle cx={22} cy={22} r={6} strokeWidth="0.3" opacity="0.9" />
        <circle cx={22} cy={22} r={12} strokeWidth="0.28" opacity="0.85" />
        <circle cx={22} cy={22} r={18} strokeWidth="0.25" opacity="0.8" />
        <circle cx={22} cy={22} r={24} strokeWidth="0.22" opacity="0.75" />
        <circle cx={22} cy={22} r={30} strokeWidth="0.2" opacity="0.7" />
        <circle cx={22} cy={22} r={1.2} fill="rgba(230,235,250,0.6)" stroke="none" />
      </g>
    </svg>
  );
}

/** Avatar options for player selection (emoji) */
const PLAYER_AVATARS = ["🧙", "🧛", "🧟", "🦸", "🧚", "🦊", "🐉", "🦉", "🐺", "🦋"] as const;
/** Emoji avatar buttons in start / settings modals */
const AVATAR_PICKER_BTN_PX = 40;
const AVATAR_PICKER_FONT = "1.28rem";
const AVATAR_PICKER_WRAP_MAX_W = 280;

/** Skip game hotkeys while focus is in a text field / select (Setup & in-game Settings name inputs, etc.) */
function isKeyboardEventFromEditableField(target: EventTarget | null): boolean {
  if (typeof document === "undefined" || !target || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const t = (target as HTMLInputElement).type;
    if (t === "button" || t === "submit" || t === "checkbox" || t === "radio" || t === "range" || t === "file") return false;
    return true;
  }
  return target.closest("input:not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio]), textarea, select, [contenteditable='true']") != null;
}

function formatMonsterBonusRewardLabel(r: MonsterBonusReward): string {
  switch (r.type) {
    case "artifact":
      return r.amount > 1
        ? `+${r.amount} stored artifacts (random type each)`
        : "+1 stored artifact (random type)";
    case "bonusMoves":
      return `+${r.amount} move${r.amount > 1 ? "s" : ""}`;
    case "shield":
      return "+1 shield";
    case "jump":
      return `+${r.amount} jump${r.amount > 1 ? "s" : ""}`;
    case "catapult":
      return "+1 catapult";
    case "diceBonus":
      return "+1 dice bonus";
    default:
      return "Bonus";
  }
}

function getBonusRewardIcon(r: MonsterBonusReward, size: number): React.ReactNode {
  switch (r.type) {
    case "artifact":
      return <ArtifactIcon variant="artifact" size={size} />;
    case "bonusMoves":
      return <ArtifactIcon variant="dice" size={size} />;
    case "shield":
      return <ArtifactIcon variant="shield" size={size} />;
    case "jump":
      return <ArtifactIcon variant="jump" size={size} />;
    case "catapult":
      return <ArtifactIcon variant="catapult" size={size} />;
    case "diceBonus":
      return <ArtifactIcon variant="dice" size={size} />;
    default:
      return <ArtifactIcon variant="magic" size={size} />;
  }
}

/** Combat skill slots — outer box must be ≥ icon + border or dice 🎲 is clipped */
const COMBAT_SKILL_SLOT_PX = 56;
const COMBAT_SKILL_IMG_PX = 48;
const COMBAT_SKILL_IMG_LOCKED_PX = 38;

/** Combat Skills row: one round slot per item — icon only; tooltips carry full meaning */
function CombatSkillItemIcon({
  title,
  variant,
  mode,
  selected,
  disabled,
  onClick,
  stackCount,
}: {
  title: string;
  variant: "shield" | "dice" | "magic" | "reveal" | "healing";
  mode: "toggle" | "consume" | "locked";
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  stackCount?: number;
}) {
  const accent = variant === "shield" ? "#44ff88" : variant === "dice" ? "#ffcc00" : "#8877bb";
  /** Dice emoji uses a square span; keep ≤ slot minus border so it sits inside the outline */
  const rawPx = mode === "locked" ? COMBAT_SKILL_IMG_LOCKED_PX : COMBAT_SKILL_IMG_PX;
  const borderAllowance = mode === "locked" ? 2 : 4;
  const imgPx = Math.min(rawPx, Math.max(28, COMBAT_SKILL_SLOT_PX - borderAllowance));
  const active =
    mode === "consume" || (mode === "toggle" && selected) || (mode === "locked" && false);
  const border =
    mode === "locked"
      ? "1px solid rgba(255,255,255,0.1)"
      : mode === "toggle" && !selected
        ? "2px solid rgba(100,100,110,0.5)"
        : `2px solid ${accent}`;
  const bg =
    mode === "locked"
      ? "rgba(25,20,35,0.5)"
      : mode === "toggle" && !selected
        ? "rgba(0,0,0,0.25)"
        : mode === "toggle" && selected
          ? variant === "shield"
            ? "rgba(68,255,136,0.12)"
            : "rgba(255,204,0,0.1)"
          : variant === "shield"
            ? "rgba(68,255,136,0.1)"
            : "rgba(255,204,0,0.1)";
  const opacity = mode === "locked" ? 0.55 : disabled ? 0.45 : mode === "toggle" && !selected ? 0.72 : 1;
  const inner = (
    <>
      <span
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          lineHeight: 0,
          pointerEvents: "none",
        }}
      >
        <ArtifactIcon variant={variant} size={imgPx} opacity={mode === "locked" ? 0.85 : 1} />
      </span>
      {stackCount != null && stackCount > 1 ? (
        <span
          style={{
            position: "absolute",
            top: -3,
            right: -3,
            minWidth: 15,
            height: 15,
            padding: "0 3px",
            borderRadius: 8,
            background: "#2a2a32",
            border: "1px solid rgba(255,255,255,0.2)",
            fontSize: "0.6rem",
            fontWeight: 800,
            color: "#ddd",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            lineHeight: 1,
          }}
        >
          {stackCount > 9 ? "9+" : stackCount}
        </span>
      ) : null}
    </>
  );
  if (mode === "locked") {
    return (
      <span
        title={title}
        style={{
          position: "relative",
          width: COMBAT_SKILL_SLOT_PX,
          height: COMBAT_SKILL_SLOT_PX,
          borderRadius: 10,
          border,
          background: bg,
          opacity,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          boxSizing: "border-box",
          overflow: "hidden",
          lineHeight: 0,
        }}
      >
        {inner}
      </span>
    );
  }
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={mode === "toggle" ? selected : undefined}
      title={title}
      onClick={onClick}
      style={{
        position: "relative",
        width: COMBAT_SKILL_SLOT_PX,
        height: COMBAT_SKILL_SLOT_PX,
        padding: 0,
        borderRadius: 10,
        border,
        background: bg,
        opacity,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        boxSizing: "border-box",
        overflow: "hidden",
        lineHeight: 0,
        cursor: disabled ? "default" : "pointer",
        boxShadow: active ? `0 0 10px ${variant === "shield" ? "rgba(68,255,136,0.25)" : variant === "dice" ? "rgba(255,204,0,0.2)" : "rgba(136,119,187,0.2)"}` : "none",
      }}
    >
      {inner}
    </button>
  );
}

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
  return type === "V" ? "🧛" : type === "Z" ? "🧟" : type === "G" ? "👻" : type === "K" ? "💀" : type === "L" ? "🔥" : "🕷";
}

/** Monster combat state: idle = player initiated (easiest), hunt = neutral, attack/angry = monster aggressive (worst) */
type MonsterCombatState = "idle" | "hunt" | "attack" | "angry";

type MonsterSpriteState = MonsterCombatState | "rolling" | "hurt" | "defeated" | "neutral" | "recover";

function rollCombatSurprise(): MonsterSurpriseState {
  const r = Math.floor(Math.random() * 4);
  return r === 0 ? "idle" : r === 1 ? "hunt" : r === 2 ? "attack" : "angry";
}

/** Lava Elemental sprite states from manifest */
function getLavaElementalSprite(type: MonsterType, state: "neutral" | "attacking" | "hurt" | "defeated" | "angry" | "enraged"): string | null {
  if (type !== "L") return null;
  return `/monsters/lava/${state}.png`;
}

/**
 * Sprite while the combat dice are rolling: more aggressive pose per stance so states feel distinct.
 * (Refs idle/hunt → attack; attack → rolling; angry → angry or enraged for lava.)
 */
function getMonsterSpriteWhileRolling(_type: MonsterType, stance: MonsterSurpriseState): MonsterSpriteState {
  if (stance === "idle" || stance === "hunt" || stance === "attack") return "rolling";
  return "angry";
}

/** Calm portrait between rolls (matches monster HP bar bands): idle above ⅓ max, recover in red band. */
function monsterCalmPortraitFromHp(curHp: number, maxHp: number): "idle" | "recover" {
  const mMax = Math.max(1, maxHp);
  const curClamped = Math.min(mMax, Math.max(0, curHp));
  return curClamped / mMax > 1 / 3 ? "idle" : "recover";
}

/** Unified monster sprite: returns image path for monsters with assets, null for emoji fallback. */
function getMonsterSprite(type: MonsterType, state: MonsterSpriteState): string | null {
  if (type === "L") {
    if (state === "neutral" || state === "idle" || state === "hunt") return "/monsters/lava/neutral.png";
    if (state === "attack" || state === "rolling") return "/monsters/lava/attacking.png";
    if (state === "angry") return "/monsters/lava/enraged.png";
    if (state === "hurt") return "/monsters/lava/hurt.png";
    if (state === "defeated") return "/monsters/lava/defeated.png";
    if (state === "recover") return "/monsters/lava/neutral.png";
    return "/monsters/lava/neutral.png";
  }
  if (type === "V") {
    if (state === "neutral" || state === "idle") return "/monsters/dracula/idle.png";
    if (state === "hunt") return "/monsters/dracula/hunt.png";
    if (state === "attack" || state === "rolling") return "/monsters/dracula/attack.png";
    if (state === "angry") return "/monsters/dracula/hunt.png";
    if (state === "hurt") return "/monsters/dracula/hurt.png";
    if (state === "recover") return "/monsters/dracula/recover.png";
    if (state === "defeated") return "/monsters/dracula/defeated.png";
    return "/monsters/dracula/idle.png";
  }
  if (type === "Z") {
    if (state === "neutral" || state === "idle") return "/monsters/zombie/idle.png";
    if (state === "hunt") return "/monsters/zombie/hunt.png";
    if (state === "attack" || state === "angry" || state === "rolling") return "/monsters/zombie/attack.png";
    if (state === "hurt") return "/monsters/zombie/hurt.png";
    if (state === "recover") return "/monsters/zombie/recover.png";
    if (state === "defeated") return "/monsters/zombie/defeated.png";
    return "/monsters/zombie/idle.png";
  }
  if (type === "G") {
    if (state === "neutral" || state === "idle") return "/monsters/ghost/idle.png";
    if (state === "hunt") return "/monsters/ghost/hunt.png";
    if (state === "attack" || state === "angry" || state === "rolling") return "/monsters/ghost/attack.png";
    if (state === "hurt") return "/monsters/ghost/hurt.png";
    if (state === "recover") return "/monsters/ghost/recover.png";
    if (state === "defeated") return "/monsters/ghost/defeated.png";
    return "/monsters/ghost/idle.png";
  }
  if (type === "K") {
    if (state === "neutral" || state === "idle") return "/monsters/skeleton/idle.png";
    if (state === "hunt") return "/monsters/skeleton/hunt.png";
    if (state === "attack" || state === "angry" || state === "rolling") return "/monsters/skeleton/attack.png";
    if (state === "hurt") return "/monsters/skeleton/hurt.png";
    if (state === "recover") return "/monsters/skeleton/recover.png";
    if (state === "defeated") return "/monsters/skeleton/defeated.png";
    return "/monsters/skeleton/idle.png";
  }
  if (type === "S") {
    if (state === "neutral" || state === "idle") return "/monsters/spider/idle.png";
    if (state === "hunt") return "/monsters/spider/hunt.png";
    if (state === "attack" || state === "angry" || state === "rolling") return "/monsters/spider/attack.png";
    if (state === "hurt") return "/monsters/spider/hurt.png";
    if (state === "recover") return "/monsters/spider/recover.png";
    if (state === "defeated") return "/monsters/spider/defeated.png";
    return "/monsters/spider/idle.png";
  }
  return null;
}

function getCombatResultMonsterSpriteState(
  r: {
    secondAttempt?: boolean;
    draculaWeakened?: boolean;
    monsterWeakened?: boolean;
    won?: boolean;
    shieldAbsorbed?: boolean;
  },
  victoryPhase: "hurt" | "defeated"
): MonsterSpriteState {
  if (r.secondAttempt) return "idle";
  if (r.draculaWeakened || r.monsterWeakened) return "recover";
  if (r.won) return victoryPhase === "defeated" ? "defeated" : "hurt";
  if (r.shieldAbsorbed) return "angry";
  return "hurt";
}

/** Idle sprite for monsters with all 6 states in assets. Use instead of emoji on grid etc. */
const MONSTER_IDLE_PATHS: Partial<Record<MonsterType, string>> = {
  L: "/monsters/lava/neutral.png",
  V: "/monsters/dracula/idle.png",
  Z: "/monsters/zombie/idle.png",
  G: "/monsters/ghost/idle.png",
  K: "/monsters/skeleton/idle.png",
  S: "/monsters/spider/idle.png",
};
function getMonsterIdleSprite(type: MonsterType): string | null {
  return MONSTER_IDLE_PATHS[type] ?? null;
}

/** Bar / accent color from current HP (max = DEFAULT_PLAYER_HP). */
function playerHpAccentColor(hp: number): string {
  if (hp <= 1) return "#ff4444";
  if (hp <= 2) return "#ff8800";
  if (hp <= 3) return "#ffaa00";
  return "#00ff88";
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
  const [catapultGained, setCatapultGained] = useState<boolean | null>(null);
  const [bonusMovesGained, setBonusMovesGained] = useState<number | null>(null);
  const [diceBonusApplied, setDiceBonusApplied] = useState<boolean | null>(null);
  const [healingGained, setHealingGained] = useState<boolean | null>(null);
  const [harmTaken, setHarmTaken] = useState<boolean | null>(null);
  const [bombGained, setBombGained] = useState<boolean | null>(null);
  const [artifactGained, setArtifactGained] = useState<string | null>(null);
  const [hiddenGemTeleport, setHiddenGemTeleport] = useState<boolean | null>(null);
  const [torchGained, setTorchGained] = useState<boolean | null>(null);
  const [cellsRevealed, setCellsRevealed] = useState<number | null>(null);
  const [webSlowed, setWebSlowed] = useState<boolean | null>(null);
  const [eliminatedByMonster, setEliminatedByMonster] = useState<{
    playerIndex: number;
    monsterType: MonsterType;
  } | null>(null);
  const [draculaAttacked, setDraculaAttacked] = useState<number | null>(null);
  const [teleportAnimation, setTeleportAnimation] = useState<{
    from: [number, number];
    to: [number, number];
    playerIndex: number;
  } | null>(null);
  const [teleportPicker, setTeleportPicker] = useState<{
    playerIndex: number;
    from: [number, number];
    options: [number, number][];
    sourceType: "magic" | "gem" | "artifact";
  } | null>(null);
  const [catapultMode, setCatapultMode] = useState(false);
  const [catapultPicker, setCatapultPicker] = useState<{ playerIndex: number; from: [number, number] } | null>(null);
  const [passThroughMagic, setPassThroughMagic] = useState(false);
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
  const [combatResult, setCombatResult] = useState<
    | (CombatResult & {
        monsterType?: MonsterType;
        playerIndex?: number;
        shieldAbsorbed?: boolean;
        draculaWeakened?: boolean;
        monsterWeakened?: boolean;
        monsterHp?: number;
        monsterMaxHp?: number;
        secondAttempt?: boolean;
        bonusReward?: MonsterBonusReward | null;
        /** When non-empty after a win, player must pick one bonus or skip before Continue */
        bonusRewardOptions?: MonsterBonusReward[];
        bonusRewardApplied?: boolean;
        /** True when player died in combat — show defeat screen with Close button */
        playerDefeated?: boolean;
        /** Snapshot after lethal hit — lab is respawned so bars must not read live player HP */
        playerHpAtEnd?: number;
      })
    | null
  >(null);
  /** Win + bonus picker: single panel only (no duplicate green WIN banner above) */
  const pendingCombatBonusPick =
    combatResult !== null &&
    combatResult.won &&
    (combatResult.bonusRewardOptions?.length ?? 0) > 0 &&
    combatResult.bonusRewardApplied !== true;
  const [combatVictoryPhase, setCombatVictoryPhase] = useState<"hurt" | "defeated">("hurt");
  const [bonusLootRevealed, setBonusLootRevealed] = useState(false);
  const [bonusLootSelectedIndex, setBonusLootSelectedIndex] = useState(0);
  /** Surprise stance for this combat roll (idle/hunt/attack/angry) — drives sprites + defense modifier; synced with combatSurpriseRef */
  const [combatMonsterStance, setCombatMonsterStance] = useState<MonsterSurpriseState>("hunt");
  /** Last attack math when combat continues (no full result screen) */
  const [combatFooterSnapshot, setCombatFooterSnapshot] = useState<{
    playerRoll: number;
    attackTotal: number;
    monsterDefense: number;
    summary: string;
  } | null>(null);
  /** Monster sprite phase after taking damage: hurt → recover → ready (before next roll) */
  const [combatRecoveryPhase, setCombatRecoveryPhase] = useState<"hurt" | "recover" | "ready">("ready");
  /** Temporary combat toast — `seq` invalidates older timeouts when a new toast is shown */
  const [combatToast, setCombatToast] = useState<{
    seq: number;
    message: string;
    style: "hint" | "secondAttempt" | "footer";
  } | null>(null);
  const combatToastSeqRef = useRef(0);
  const [defeatedMonsterOnCell, setDefeatedMonsterOnCell] = useState<{ x: number; y: number; monsterType: MonsterType } | null>(null);
  const [collisionEffect, setCollisionEffect] = useState<{ x: number; y: number } | null>(null);
  const [turnChangeEffect, setTurnChangeEffect] = useState<number | null>(null);
  const [combatUseShield, setCombatUseShield] = useState(true);
  const [combatUseDiceBonus, setCombatUseDiceBonus] = useState(true);
  const [mazeZoom, setMazeZoom] = useState(1);
  const [isMobile, setIsMobile] = useState(false);
  /** Result/roll strip height — combat: dice moves to Skills+hint slot while rolling; lower strip is buttons only (same all breakpoints). */
  const combatResultSlotHeightPx =
    combatState
      ? COMBAT_RESULT_SLOT_COMBAT_ROLL_STRIP_PX
      : pendingCombatBonusPick && bonusLootRevealed
        ? COMBAT_RESULT_SLOT_BONUS_LOOT_PX
        : 140;
  /** Mobile: turn / moves / round / diamonds in slide-down panel (☰). */
  const [mobileGameSummaryOpen, setMobileGameSummaryOpen] = useState(false);
  /** Desktop only: move arrow pad hidden until keyboard move / successful step / “Moves” button. */
  const [movePadOpenDesktop, setMovePadOpenDesktop] = useState(false);
  const movePadAutoHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Mobile: selected item in bottom dock before tapping Use. */
  const [mobileDockAction, setMobileDockAction] = useState<MobileDockAction | null>(null);
  /** Mobile: full Move & items vs compact artifacts-only strip. */
  const [mobileDockExpanded, setMobileDockExpanded] = useState(false);
  /** Measured height of fixed bottom dock — maze scroll padding so map can clear above it. */
  const mobileDockRef = useRef<HTMLDivElement>(null);
  const [mobileDockInsetPx, setMobileDockInsetPx] = useState(0);
  const [gameStarted, setGameStarted] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const headerMenuRef = useRef<HTMLDivElement>(null);
  const [showDiceModal, setShowDiceModal] = useState(false);
  const [playerNames, setPlayerNames] = useState<string[]>(() =>
    Array.from({ length: 3 }, (_, i) => `Player ${i + 1}`)
  );
  const [playerAvatars, setPlayerAvatars] = useState<string[]>(() =>
    Array.from({ length: 10 }, (_, i) => PLAYER_AVATARS[i % PLAYER_AVATARS.length])
  );
  const diceRef = useRef<Dice3DRef>(null);
  const combatDiceRef = useRef<Dice3DRef>(null);
  const movesLeftRef = useRef(0);
  const winnerRef = useRef(winner);
  const combatStateRef = useRef(combatState);
  const combatResultRef = useRef(combatResult);
  const combatSurpriseRef = useRef<MonsterSurpriseState>("hunt");
  const combatHasRolledRef = useRef(false);
  /** After setLab: true = still fighting same monster, show roll UI + snapshot instead of result/Continue */
  const combatContinuesAfterRollRef = useRef(false);
  /** True when player died in combat — skip setCombatState(null) so modal stays open with defeat result */
  const playerDefeatedInCombatRef = useRef(false);
  const combatUseShieldRef = useRef(true);
  const combatUseDiceBonusRef = useRef(true);
  const currentPlayerRef = useRef(currentPlayer);
  const labRef = useRef(lab);
  const teleportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hiddenGemTeleportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const teleportPickerRef = useRef(teleportPicker);
  const catapultPickerRef = useRef(catapultPicker);
  const passThroughMagicRef = useRef(false);
  const handleTeleportSelectRef = useRef<(destX: number, destY: number) => void>(() => {});
  const triggerRoundEndRef = useRef<() => void>(() => {});
  const currentPlayerCellRef = useRef<HTMLDivElement | null>(null);
  const openMovePadDesktopWithTimerRef = useRef<() => void>(() => {});

  const openMovePadDesktopWithTimer = useCallback(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`).matches) return;
    setMovePadOpenDesktop(true);
    if (movePadAutoHideTimerRef.current) clearTimeout(movePadAutoHideTimerRef.current);
    movePadAutoHideTimerRef.current = setTimeout(() => {
      setMovePadOpenDesktop(false);
      movePadAutoHideTimerRef.current = null;
    }, MOVE_PAD_AUTO_HIDE_MS);
  }, []);
  openMovePadDesktopWithTimerRef.current = openMovePadDesktopWithTimer;

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`);
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useLayoutEffect(() => {
    if (!isMobile) {
      setMobileDockInsetPx(0);
      return;
    }
    const el = mobileDockRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setMobileDockInsetPx(Math.ceil(el.getBoundingClientRect().height));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [isMobile]);

  useEffect(
    () => () => {
      if (movePadAutoHideTimerRef.current) clearTimeout(movePadAutoHideTimerRef.current);
    },
    []
  );

  useEffect(() => {
    if (combatState) setMovePadOpenDesktop(false);
  }, [combatState]);

  useEffect(() => {
    if (!isMobile) setMobileGameSummaryOpen(false);
  }, [isMobile]);

  useEffect(() => {
    if (settingsOpen) setMobileGameSummaryOpen(false);
  }, [settingsOpen]);

  /** Mobile dock: keep a valid selection when inventory changes. */
  useEffect(() => {
    if (!isMobile || !lab || winner !== null) {
      setMobileDockAction(null);
      return;
    }
    const p = lab.players[currentPlayer];
    if (!p || lab.eliminatedPlayers.has(currentPlayer)) {
      setMobileDockAction(null);
      return;
    }
    const actions: MobileDockAction[] = [];
    if ((p.bombs ?? 0) > 0) actions.push("bomb");
    for (const k of STORED_ARTIFACT_ORDER) {
      if (storedArtifactCount(p, k) > 0) actions.push(k);
    }
    if (actions.length === 0) {
      setMobileDockAction(null);
      return;
    }
    setMobileDockAction((prev) => {
      if (prev != null && actions.includes(prev)) return prev;
      /** Collapsed strip is artifact-only — do not auto-select bomb. */
      if (!mobileDockExpanded) {
        const nonBomb = actions.find((a) => a !== "bomb");
        return nonBomb ?? null;
      }
      return actions[0]!;
    });
  }, [isMobile, lab, currentPlayer, winner, mobileDockExpanded]);

  const fogIntensityMap = useMemo(() => {
    const map = new Map<string, number>();
    if (!lab || lab.players.some((p) => p.hasTorch)) return map;
    const clearedCoords = new Set<string>();
    lab.players.forEach((p, i) => { if (!lab!.eliminatedPlayers?.has(i)) clearedCoords.add(`${p.x},${p.y}`); });
    lab.visitedCells?.forEach((k) => clearedCoords.add(k));
    const manhattan = (ax: number, ay: number, bx: number, by: number) => Math.abs(ax - bx) + Math.abs(ay - by);
    const getClearance = (cx: number, cy: number): number => {
      let minDist = FOG_CLEARANCE_RADIUS + 1;
      clearedCoords.forEach((key) => {
        const [px, py] = key.split(",").map(Number);
        const d = manhattan(cx, cy, px, py);
        if (d < minDist) minDist = d;
      });
      return Math.max(0, 1 - minDist / (FOG_CLEARANCE_RADIUS + 0.5));
    };
    for (let cy = 0; cy < lab.height; cy++) {
      for (let cx = 0; cx < lab.width; cx++) {
        const fogIntensity = lab.fogZones?.get(`${cx},${cy}`) ?? 0;
        const clearance = getClearance(cx, cy);
        const isWallCell = lab.getCellAt(cx, cy) === "#";
        const hasAdjacentFog = [[0,-1],[1,0],[0,1],[-1,0]].some(([dx,dy]) => (lab.fogZones?.get(`${cx+dx},${cy+dy}`) ?? 0) > 0);
        const adjacentClearance = isWallCell ? Math.max(0, ...[[0,-1],[1,0],[0,1],[-1,0]].map(([dx,dy]) => {
          const nx = cx + dx, ny = cy + dy;
          return (nx >= 0 && nx < lab.width && ny >= 0 && ny < lab.height) ? getClearance(nx, ny) : 0;
        })) : clearance;
        const effectiveClearance = isWallCell ? adjacentClearance : clearance;
        const rawFog = isWallCell ? (hasAdjacentFog ? 1 : 0) : fogIntensity;
        const effectiveFog = rawFog * (1 - effectiveClearance);
        if (effectiveFog > 0) map.set(`${cx},${cy}`, effectiveFog);
      }
    }
    return map;
  }, [lab]);

  const scheduleDraculaAction = useCallback((mi: number, action: "teleport" | "attack", delayMs: number) => {
    setTimeout(() => {
      if (
        combatStateRef.current ||
        combatResultRef.current ||
        combatContinuesAfterRollRef.current
      ) {
        return;
      }
      setLab((prev2) => {
        if (!prev2 || winnerRef.current !== null) return prev2;
        const next2 = new Labyrinth(prev2.width, prev2.height, 0, prev2.numPlayers, prev2.monsterDensity);
        next2.grid = prev2.grid.map((r) => [...r]);
        next2.players = prev2.players.map((p) => ({ ...p }));
        next2.goalX = prev2.goalX;
        next2.goalY = prev2.goalY;
        next2.monsters = prev2.monsters.map((m) => ({
          ...m,
          patrolArea: [...m.patrolArea],
          hp: m.hp,
          draculaState: m.draculaState,
          draculaCooldowns: m.draculaCooldowns ? { ...m.draculaCooldowns } : undefined,
          targetPlayerIndex: m.targetPlayerIndex,
        }));
        next2.eliminatedPlayers = new Set(prev2.eliminatedPlayers);
        next2.hiddenCells = new Map(prev2.hiddenCells);
        next2.webPositions = [...(prev2.webPositions || [])];
        next2.fogZones = new Map(prev2.fogZones || new Map());
        next2.bombCollectedBy = new Map([...(prev2.bombCollectedBy || new Map()).entries()].map(([k, v]) => [k, new Set(v)]));
        next2.teleportUsedFrom = new Map([...(prev2.teleportUsedFrom || new Map()).entries()].map(([k, v]) => [k, new Set(v)]));
        next2.teleportUsedTo = new Map([...(prev2.teleportUsedTo || new Map()).entries()].map(([k, v]) => [k, new Set(v)]));
        next2.catapultUsedFrom = new Map([...(prev2.catapultUsedFrom || new Map()).entries()].map(([k, v]) => [k, new Set(v)]));
        next2.visitedCells = new Set(prev2.visitedCells || []);
        const d = next2.monsters[mi];
        if (d?.type === "V") {
          if (action === "teleport") {
            const needAttack = applyDraculaTeleport(d, next2.players, next2.grid, next2.width, next2.height);
            if (needAttack) {
              scheduleDraculaAction(mi, "attack", DRACULA_CONFIG.attackTelegraphMs);
            }
          } else if (action === "attack") {
            const targetIdx = applyDraculaAttack(d, next2.players, next2.eliminatedPlayers);
            if (targetIdx !== null && targetIdx === currentPlayerRef.current) {
              const p = next2.players[targetIdx];
              if (p) {
                p.hp = Math.max(0, (p.hp ?? DEFAULT_PLAYER_HP) - 1);
                if ((p.artifacts ?? 0) > 0) {
                  d.hp = Math.min(getMonsterMaxHp("V"), (d.hp ?? getMonsterMaxHp("V")) + 1);
                }
                setDraculaAttacked(targetIdx);
                if (p.hp <= 0) {
                  p.x = 0;
                  p.y = 0;
                  p.hp = DEFAULT_PLAYER_HP;
                  const hasStored = (p.artifactDice ?? 0) > 0 || (p.artifactShield ?? 0) > 0 || (p.artifactTeleport ?? 0) > 0 || (p.artifactReveal ?? 0) > 0 || (p.artifactHealing ?? 0) > 0;
                  if (hasStored) {
                    if ((p.artifactDice ?? 0) > 0) p.artifactDice!--;
                    else if ((p.artifactShield ?? 0) > 0) p.artifactShield!--;
                    else if ((p.artifactTeleport ?? 0) > 0) p.artifactTeleport!--;
                    else if ((p.artifactReveal ?? 0) > 0) p.artifactReveal!--;
                    else if ((p.artifactHealing ?? 0) > 0) p.artifactHealing!--;
                    p.artifacts = Math.max(0, (p.artifacts ?? 0) - 1);
                  } else if (p.artifacts > 0) {
                    p.artifacts--;
                    const ac = p.artifactsCollected ?? [];
                    if (ac.length > 0) p.artifactsCollected = ac.slice(0, -1);
                  }
                  setEliminatedByMonster({ playerIndex: targetIdx, monsterType: "V" });
                }
              }
            }
          }
        }
        return next2;
      });
    }, delayMs);
  }, []);

  useEffect(() => {
    teleportPickerRef.current = teleportPicker;
  }, [teleportPicker]);
  useEffect(() => {
    catapultPickerRef.current = catapultPicker;
  }, [catapultPicker]);

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
    labRef.current = lab;
  }, [lab]);
  useEffect(() => {
    combatStateRef.current = combatState;
    combatLog("combatStateRef sync", combatState ? `OPEN (player ${combatState.playerIndex} vs monster ${combatState.monsterIndex})` : "CLOSED");
  }, [combatState]);
  useEffect(() => {
    combatResultRef.current = combatResult;
  }, [combatResult]);
  useEffect(() => {
    if (!headerMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (headerMenuRef.current && !headerMenuRef.current.contains(e.target as Node)) {
        setHeaderMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setHeaderMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [headerMenuOpen]);
  useEffect(() => {
    combatUseShieldRef.current = combatUseShield;
  }, [combatUseShield]);
  useEffect(() => {
    combatUseDiceBonusRef.current = combatUseDiceBonus;
  }, [combatUseDiceBonus]);

  // Cancel combat only if monster was cleared externally (e.g. bomb) — never close while showing victory/defeat or "roll again"
  useEffect(() => {
    if (!combatState || !lab) return;
    if (combatResult) {
      combatLog("cancel-check: SKIP — combatResult present (victory/defeat)");
      return;
    }
    if (combatFooterSnapshot) {
      combatLog("cancel-check: SKIP — combatFooterSnapshot present (roll again)");
      return;
    }
    const collision = lab.checkMonsterCollision(combatState.playerIndex);
    combatLog("cancel-check", { hasCombatState: !!combatState, collision, playerPos: lab.players[combatState.playerIndex] ? [lab.players[combatState.playerIndex]!.x, lab.players[combatState.playerIndex]!.y] : null });
    if (!collision) {
      combatLog("cancel-check: CLOSING — no collision (monster gone or player moved). setCombatState(null)");
      setCombatState(null);
      setDefeatedMonsterOnCell(null);
      setCombatUseShield(true);
      setCombatUseDiceBonus(true);
    }
  }, [lab, combatState, combatResult, combatFooterSnapshot]);

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
    setRolling(false); // Ensure not stuck in "Rolling..." when combat opens
    combatHasRolledRef.current = false;
    const stance = rollCombatSurprise();
    combatSurpriseRef.current = stance;
    setCombatMonsterStance(stance);
    setCombatVictoryPhase("hurt");
    const p = lab.players[combatState.playerIndex];
    setCombatUseShield((p?.shield ?? 0) > 0);
    setCombatUseDiceBonus((p?.diceBonus ?? 0) > 0);
  }, [combatState, lab]);

  // Victory phase: hurt → defeated only after a win when NOT in an active fight (avoids stuck "defeated" during combat)
  useEffect(() => {
    if (combatState) {
      setCombatVictoryPhase("hurt");
      return;
    }
    if (!combatResult?.won) {
      setCombatVictoryPhase("hurt");
      return;
    }
    setCombatVictoryPhase("hurt");
    const t = setTimeout(() => setCombatVictoryPhase("defeated"), 1400);
    return () => clearTimeout(t);
  }, [combatState, combatResult?.won]);

  // Focus/scroll to current player marker when turn changes or after rolling (dice modal closes)
  useEffect(() => {
    if (winner !== null || !lab || lab.eliminatedPlayers.has(currentPlayer)) return;
    const el = currentPlayerCellRef.current;
    if (el) {
      const id = requestAnimationFrame(() => {
        el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      });
      return () => cancelAnimationFrame(id);
    }
  }, [currentPlayer, winner, showDiceModal]);

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



  useEffect(() => {
    if (!teleportAnimation) return;
    const t = setTimeout(() => setTeleportAnimation(null), SPECIAL_MOVE_SETTLE_MS);
    return () => clearTimeout(t);
  }, [teleportAnimation]);

  useEffect(() => {
    if (!catapultAnimation) return;
    const t = setTimeout(() => setCatapultAnimation(null), SPECIAL_MOVE_SETTLE_MS);
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
    if (draculaAttacked === null) return;
    const t = setTimeout(() => setDraculaAttacked(null), 2000);
    return () => clearTimeout(t);
  }, [draculaAttacked]);

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
    if (catapultGained === null) return;
    const t = setTimeout(() => setCatapultGained(null), 1500);
    return () => clearTimeout(t);
  }, [catapultGained]);
  useEffect(() => {
    if (bonusMovesGained === null) return;
    const t = setTimeout(() => setBonusMovesGained(null), 1500);
    return () => clearTimeout(t);
  }, [bonusMovesGained]);
  useEffect(() => {
    if (diceBonusApplied === null) return;
    const t = setTimeout(() => setDiceBonusApplied(null), 2500);
    return () => clearTimeout(t);
  }, [diceBonusApplied]);

  // Reveal bonus loot only after monster shows defeated/collapsed sprite (hurt→defeated is 1400ms)
  useEffect(() => {
    if (!pendingCombatBonusPick) {
      setBonusLootRevealed(false);
      return;
    }
    if (combatVictoryPhase !== "defeated") {
      setBonusLootRevealed(false);
      return;
    }
    const t = setTimeout(() => setBonusLootRevealed(true), 500);
    return () => clearTimeout(t);
  }, [pendingCombatBonusPick, combatVictoryPhase]);

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
    if (artifactGained === null) return;
    const t = setTimeout(() => setArtifactGained(null), 1500);
    return () => clearTimeout(t);
  }, [artifactGained]);

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
    setDiceBonusApplied(null);
    setJumpAdded(null);
    setBonusMovesGained(null);
    setShieldAbsorbed(null);
    setWebSlowed(null);
    setShieldGained(null);
    setCatapultGained(null);
    setHealingGained(null);
    setHarmTaken(null);
    setBombGained(null);
    setArtifactGained(null);
    setHiddenGemTeleport(null);
    setTorchGained(null);
    setCellsRevealed(null);
    setEliminatedByMonster(null);
    setDraculaAttacked(null);
    setTeleportAnimation(null);
    setJumpAnimation(null);
    setTeleportPicker(null);
    setCatapultPicker(null);
    setCatapultMode(false);
    setPassThroughMagic(false);
    setCatapultDragOffset(null);
    setCatapultAnimation(null);
    setBombExplosion(null);
    setCombatState(null);
    setCombatResult(null);
    setBonusLootRevealed(false);
    setDefeatedMonsterOnCell(null);
    setCollisionEffect(null);
    setTurnChangeEffect(0);
    combatHasRolledRef.current = false;
    setRolling(false);
    setShowDiceModal(true);
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
        setTurnChangeEffect(0);
        setShowDiceModal(true);
        setTotalMoves(0);
        setPlayerTurns(Array(n).fill(0));
        setPlayerMoves(Array(n).fill(0));
        setDiceResult(null);
        setWinner(null);
        setError("");
        setBonusAdded(null);
    setDiceBonusApplied(null);
        setJumpAdded(null);
        setBonusMovesGained(null);
        setShieldAbsorbed(null);
        setWebSlowed(null);
        setShieldGained(null);
        setCatapultGained(null);
        setHealingGained(null);
        setBombGained(null);
        setHiddenGemTeleport(null);
        setTorchGained(null);
        setCellsRevealed(null);
        setTeleportAnimation(null);
        setCatapultMode(false);
        setCatapultPicker(null);
        setPassThroughMagic(false);
        setCatapultDragOffset(null);
        setCatapultAnimation(null);
        setBombExplosion(null);
        setCombatState(null);
        setCombatResult(null);
        setBonusLootRevealed(false);
        setDefeatedMonsterOnCell(null);
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

  const handleCombatRollComplete = useCallback((value: number) => {
    const combat = combatStateRef.current;
    if (!combat) {
      combatLog("handleCombatRollComplete: no combat state, ignoring");
      return;
    }
    combatLog("--- ROLL COMPLETE ---", { dice: value, monsterType: combat.monsterType, monsterIdx: combat.monsterIndex });
    const p = lab?.players[combat.playerIndex];
    const attackBonus = Math.min(1, p?.attackBonus ?? 0);
    const diceBonus = p?.diceBonus ?? 0;
    const useDiceBonus = combatUseDiceBonusRef.current && diceBonus > 0;
    const effectiveRoll = value + (useDiceBonus ? 1 : 0);
    const monster = lab?.monsters[combat.monsterIndex];
    const skeletonHasShield = combat.monsterType === "K" && (monster?.hasShield ?? true);
    const surpriseState = combatSurpriseRef.current;
    const surpriseModifier = getSurpriseDefenseModifier(surpriseState);
    combatLog("pre-resolve", { effectiveRoll, attackBonus, skeletonHasShield, surpriseState, surpriseModifier, monsterHp: monster?.hp });
    const result = resolveCombat(effectiveRoll, attackBonus, combat.monsterType, skeletonHasShield, surpriseModifier, value, surpriseState);
    combatLog("resolveCombat result", { won: result.won, monsterEffect: result.monsterEffect, instantWin: result.instantWin, damage: result.damage, glancingDamage: result.glancingDamage });

      // Second attempt: idle/hunt + dice 1-3 on miss = retry, no damage. Attack/angry = HP damage.
      // Skeleton shield break uses won:false but is a successful hit — must not steal the reroll path or shield never breaks / HP never updates on low dice.
      const canSecondAttempt =
        !result.won &&
        result.monsterEffect !== "skeleton_shield" &&
        (surpriseState === "idle" || surpriseState === "hunt") &&
        value <= 3;
      if (canSecondAttempt) {
        combatSurpriseRef.current = rollCombatSurprise();
        setCombatResult({
          ...result,
          glancingDamage: 0,
          monsterType: combat.monsterType,
          secondAttempt: true,
          playerIndex: combat.playerIndex,
        });
    setRolling(false);
        return;
      }

      const maxHp = getMonsterMaxHp(combat.monsterType);
      const monsterHp = monster?.hp ?? maxHp;
      /** Do not setRolling(false) before flushSync(setLab) — one frame would show rolling=false with stale monster HP (idle at full) then recover after lab updates. */
      combatContinuesAfterRollRef.current = false;
      let shieldAbsorbedFlag = false;

      // Apply lab updates synchronously so combatContinuesAfterRollRef / shieldAbsorbedFlag are set
      // before POST-setLab reads them (otherwise React batches the updater and the modal closes mid-fight).
      flushSync(() => {
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
          hp: p.hp ?? DEFAULT_PLAYER_HP,
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
        next.monsters = prev.monsters.map((m) => ({
          ...m,
          patrolArea: [...m.patrolArea],
          hp: m.hp,
          draculaState: m.draculaState,
          draculaCooldowns: m.draculaCooldowns ? { ...m.draculaCooldowns } : undefined,
          targetPlayerIndex: m.targetPlayerIndex,
        }));
        next.eliminatedPlayers = new Set(prev.eliminatedPlayers);
        const pi = combat.playerIndex;
        const p = next.players[pi];
        const monsterIdx = combat.monsterIndex;
        const m = monsterIdx >= 0 && monsterIdx < next.monsters.length ? next.monsters[monsterIdx] : null;

        // Skeleton shield break: first hit removes shield, separate player and monster — keep combatState so other monsters stay frozen until this fight resolves
        if (result.monsterEffect === "skeleton_shield" && m) {
          combatLog("BRANCH: skeleton_shield — breaking shield, NO HP change. Monster stays at", m.hp, "| combat continues (same encounter)");
          m.hasShield = false;
          if (combat.prevX !== undefined && combat.prevY !== undefined && p) {
            p.x = combat.prevX;
            p.y = combat.prevY;
          } else if (p) {
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
          combatContinuesAfterRollRef.current = true;
          setCombatUseShield(true);
          setCombatUseDiceBonus(true);
          return next;
        }

        let glanceKilled = false;
        if (!result.won && (result.glancingDamage ?? 0) > 0 && m) {
          const maxHpG = getMonsterMaxHp(combat.monsterType);
          const curHp = m.hp ?? maxHpG;
          const nh = curHp - (result.glancingDamage ?? 0);
          m.hp = Math.max(0, nh);
          combatLog("BRANCH: glancing damage", { curHp, glancingDamage: result.glancingDamage, newHp: m.hp, glanceKilled: nh <= 0 });
          if (nh <= 0) glanceKilled = true;
          else combatContinuesAfterRollRef.current = true;
        }

        /** Clean hit: −monsterHpLoss HP (default 1), or instant kill when dice 6; zombie uses die-based loss from resolveCombat. */
        if (result.won && m && monsterIdx >= 0 && monsterIdx < next.monsters.length) {
          const maxHpStrike = getMonsterMaxHp(combat.monsterType);
          const curStrike = m.hp ?? maxHpStrike;
          const loss =
            result.instantWin ? curStrike : Math.max(1, result.monsterHpLoss ?? 1);
          m.hp = result.instantWin ? 0 : Math.max(0, curStrike - loss);
          combatLog("BRANCH: clean hit", { monsterType: combat.monsterType, curStrike, hpLost: loss, newHp: m.hp, instantWin: result.instantWin, combatContinues: m.hp > 0 });
          if (m.hp > 0) {
            combatContinuesAfterRollRef.current = true;
            return next;
          }
        }

        const monsterDefeated =
          (glanceKilled || (result.won && m && (m.hp ?? 0) <= 0)) &&
          monsterIdx >= 0 &&
          monsterIdx < next.monsters.length &&
          !!m;

        if (monsterDefeated && m) {
          const maxHp = getMonsterMaxHp(combat.monsterType);
          // Spider: web remains on tile when defeated
          if (combat.monsterType === "S") {
            if (!next.webPositions.some(([wx, wy]) => wx === m.x && wy === m.y)) {
              next.webPositions.push([m.x, m.y]);
            }
          }
          const defeatedX = m.x;
          const defeatedY = m.y;
          next.monsters.splice(monsterIdx, 1);
          setDefeatedMonsterOnCell({ x: defeatedX, y: defeatedY, monsterType: combat.monsterType });
          const rewardForDefeat = result.reward ?? (glanceKilled ? getMonsterReward(combat.monsterType) : undefined);
          // Always offer bonus loot on full defeat (3 random choices). Merge must not depend on `r`:
          // calling setCombatResult inside setLab can run before the prior setCombatResult flushes, so `r` may be null.
          const bonusRewardOptions = getMonsterBonusRewardChoices(3);
          setCombatResult((r) => {
            const base =
              r ??
              ({
                ...result,
                monsterType: combat.monsterType,
                monsterHp,
                monsterMaxHp: maxHp,
                playerIndex: combat.playerIndex,
              } as (typeof r) & object);
            return {
              ...base,
              won: true,
              monsterHp: 0,
              reward: rewardForDefeat ?? base.reward,
              bonusReward: null,
              bonusRewardOptions,
              bonusRewardApplied: bonusRewardOptions.length === 0,
              ...(glanceKilled ? { monsterEffect: "glancing_kill" as const } : {}),
            };
          });
          // Apply primary monster reward immediately; bonus is chosen in modal
          if (p && rewardForDefeat) {
            const r = rewardForDefeat;
            if (r.type === "jump") p.jumps = (p.jumps ?? 0) + r.amount;
            if (r.type === "movement") p.diceBonus = (p.diceBonus ?? 0) + r.amount; // +1 to next roll
            if (r.type === "hp") p.hp = Math.min(DEFAULT_PLAYER_HP, (p.hp ?? DEFAULT_PLAYER_HP) + r.amount);
            if (r.type === "shield") p.shield = (p.shield ?? 0) + r.amount;
            if (r.type === "attackBonus") p.attackBonus = Math.min(1, (p.attackBonus ?? 0) + r.amount);
          }
        } else if (!result.won && p && !glanceKilled) {
          const useShield = combatUseShieldRef.current;
          const usedShield = useShield ? next.tryConsumeShield(pi) : false;
          if (usedShield) {
            shieldAbsorbedFlag = true;
            setShieldAbsorbed(true);
            combatContinuesAfterRollRef.current = true;
          } else {
            p.hp = (p.hp ?? DEFAULT_PLAYER_HP) - result.damage;
            if (combat.monsterType === "Z") p.loseNextMove = true; // Zombie slow: lose next movement point
            if (p.hp <= 0) {
              const defeatMonsterMaxHp = getMonsterMaxHp(combat.monsterType);
              const defeatMonsterHp = m ? Math.min(defeatMonsterMaxHp, Math.max(0, m.hp ?? defeatMonsterMaxHp)) : defeatMonsterMaxHp;
              const defeatPlayerHp = p.hp;
              // Respawn at start, lose 1 artifact (instead of elimination)
              p.x = 0;
              p.y = 0;
              p.hp = DEFAULT_PLAYER_HP;
              const hasStored = (p.artifactDice ?? 0) > 0 || (p.artifactShield ?? 0) > 0 || (p.artifactTeleport ?? 0) > 0 || (p.artifactReveal ?? 0) > 0 || (p.artifactHealing ?? 0) > 0;
              if (hasStored) {
                if ((p.artifactDice ?? 0) > 0) p.artifactDice!--;
                else if ((p.artifactShield ?? 0) > 0) p.artifactShield!--;
                else if ((p.artifactTeleport ?? 0) > 0) p.artifactTeleport!--;
                else if ((p.artifactReveal ?? 0) > 0) p.artifactReveal!--;
                else if ((p.artifactHealing ?? 0) > 0) p.artifactHealing!--;
                p.artifacts = Math.max(0, (p.artifacts ?? 0) - 1);
              } else if (p.artifacts > 0) {
                p.artifacts--;
                const ac = p.artifactsCollected ?? [];
                if (ac.length > 0) p.artifactsCollected = ac.slice(0, -1);
              }
              playerDefeatedInCombatRef.current = true;
              setEliminatedByMonster({ playerIndex: pi, monsterType: combat.monsterType });
              setCombatResult({
                ...result,
                won: false,
                monsterType: combat.monsterType,
                playerIndex: pi,
                damage: result.damage,
                playerDefeated: true,
                monsterHp: defeatMonsterHp,
                monsterMaxHp: defeatMonsterMaxHp,
                playerHpAtEnd: defeatPlayerHp,
              });
              // Always pass turn after combat respawn — do not gate on currentPlayerRef (it can lag useEffect during flushSync and skip advance).
              movesLeftRef.current = 0;
              setMovesLeft(0);
              setDiceResult(null);
              let nextP = (pi + 1) % next.numPlayers;
              while (next.eliminatedPlayers.has(nextP) && nextP !== pi) {
                nextP = (nextP + 1) % next.numPlayers;
              }
              currentPlayerRef.current = nextP;
              setTurnChangeEffect(nextP);
              setCurrentPlayer(nextP);
              setShowDiceModal(true);
              setRolling(false);
              const living = [...Array(next.numPlayers).keys()].filter((i) => !next.eliminatedPlayers.has(i));
              const firstLiving = living.length > 0 ? Math.min(...living) : -1;
              const roundComplete = living.length <= 1 || nextP === firstLiving;
              if (roundComplete) setTimeout(() => triggerRoundEnd(), 0);
            } else {
              combatContinuesAfterRollRef.current = true;
            }
          }
        }
        return next;
      });
      });

      if (playerDefeatedInCombatRef.current) {
        combatLog("POST-setLab: player defeated — clear combatState so defeat UI + next player roll work");
        playerDefeatedInCombatRef.current = false;
        setCombatUseShield(true);
        setCombatUseDiceBonus(true);
        // Must end encounter here: defeat panel is `combatResult && !combatState`; leaving combatState set hid it and blocked dice auto-roll for next player.
        setCombatState(null);
        return;
      }
      if (combatContinuesAfterRollRef.current) {
        combatLog("POST-setLab: combat continues — setCombatFooterSnapshot, combatState STAYS");
        setCombatResult(null);
        const glancePart =
          (result.glancingDamage ?? 0) > 0 && !result.won
            ? `⚔️ Glancing hit — ${getMonsterName(combat.monsterType)} −${result.glancingDamage} HP! `
            : "";
        const summary = shieldAbsorbedFlag
          ? "🛡 Shield absorbed — monster still fighting!"
          : result.monsterEffect === "skeleton_shield"
            ? "🛡 Skeleton shield broken! Roll again!"
            : result.won
              ? `${getMonsterName(combat.monsterType)} hit — −${result.monsterHpLoss ?? 1} HP! Roll again!`
              : result.monsterEffect === "ghost_evade"
                ? "👻 Ghost evaded — you took damage. Roll again!"
                : `${glancePart}${result.damage > 0 ? `Took ${result.damage} damage. ` : ""}Roll again or run!`;
        setCombatFooterSnapshot({
          playerRoll: result.playerRoll,
          attackTotal: result.attackTotal,
          monsterDefense: result.monsterDefense,
          summary,
        });
        setCombatRecoveryPhase("hurt");
        combatHasRolledRef.current = false;
        const stance = rollCombatSurprise();
        combatSurpriseRef.current = stance;
        setCombatMonsterStance(stance);
      } else {
        combatLog("POST-setLab: else branch — combat ended (no continue, no defeat). setCombatState(null)");
        combatSurpriseRef.current = "hunt";
        setCombatState(null);
      }
      setCombatUseShield(true);
      setCombatUseDiceBonus(true);
      setRolling(false);
      return;
  }, []);

  const handleDismissCombatResult = useCallback((force?: boolean) => {
    const cr = combatResultRef.current;
    const bonusMustPick =
      cr?.won && (cr.bonusRewardOptions?.length ?? 0) > 0 && cr.bonusRewardApplied !== true;
    if (bonusMustPick && !force) return;
    const wasSecondAttempt = cr?.secondAttempt && combatStateRef.current;
    setCombatResult(null);
    setCombatFooterSnapshot(null);
    setCombatRecoveryPhase("ready");
    setDefeatedMonsterOnCell(null);
    setCombatVictoryPhase("hurt");
    setShieldAbsorbed(null);
    if (wasSecondAttempt) {
      setCombatMonsterStance(combatSurpriseRef.current);
      combatHasRolledRef.current = false;
    }
  }, []);

  /** Close defeat modal — clears combat state, result, and eliminated overlay */
  const handleCloseDefeatModal = useCallback(() => {
    const cr = combatResultRef.current;
    const stuckOnDefeatedTurn =
      cr?.playerDefeated === true &&
      cr.playerIndex !== undefined &&
      cr.playerIndex === currentPlayerRef.current;
    setCombatState(null);
    setCombatResult(null);
    setEliminatedByMonster(null);
    setCombatFooterSnapshot(null);
    setCombatRecoveryPhase("ready");
    setDefeatedMonsterOnCell(null);
    setCombatVictoryPhase("hurt");
    setShieldAbsorbed(null);
    if (stuckOnDefeatedTurn && lab) {
      const pi = cr!.playerIndex!;
      let nextP = (pi + 1) % lab.numPlayers;
      while (lab.eliminatedPlayers.has(nextP) && nextP !== pi) {
        nextP = (nextP + 1) % lab.numPlayers;
      }
      currentPlayerRef.current = nextP;
      setTurnChangeEffect(nextP);
      setCurrentPlayer(nextP);
      movesLeftRef.current = 0;
      setMovesLeft(0);
      setDiceResult(null);
      setShowDiceModal(true);
      setRolling(false);
      const living = [...Array(lab.numPlayers).keys()].filter((i) => !lab.eliminatedPlayers.has(i));
      const firstLiving = living.length > 0 ? Math.min(...living) : -1;
      const roundComplete = living.length <= 1 || nextP === firstLiving;
      if (roundComplete) setTimeout(() => triggerRoundEndRef.current(), 0);
    }
  }, [lab]);

  /** No Continue: auto-close second-chance banner */
  useEffect(() => {
    if (!combatResult?.secondAttempt) return;
    const t = setTimeout(() => handleDismissCombatResult(), 1600);
    return () => clearTimeout(t);
  }, [combatResult?.secondAttempt, combatResult?.playerRoll, handleDismissCombatResult]);

  /** Auto-close win screen when no bonus pick is required */
  useEffect(() => {
    if (!combatResult?.won) return;
    const pending =
      (combatResult.bonusRewardOptions?.length ?? 0) > 0 && combatResult.bonusRewardApplied !== true;
    if (pending) return;
    const t = setTimeout(() => handleDismissCombatResult(), 2200);
    return () => clearTimeout(t);
  }, [
    combatResult?.won,
    combatResult?.bonusRewardApplied,
    combatResult?.bonusRewardOptions,
    handleDismissCombatResult,
  ]);

  useEffect(() => {
    if (!combatFooterSnapshot) return;
    const t = setTimeout(() => setCombatFooterSnapshot(null), 5000);
    return () => clearTimeout(t);
  }, [combatFooterSnapshot]);

  useEffect(() => {
    if (!combatFooterSnapshot || combatRecoveryPhase === "ready") return;
    const ms = combatRecoveryPhase === "hurt" ? 450 : 550;
    const t = setTimeout(() => {
      setCombatRecoveryPhase((p) => (p === "hurt" ? "recover" : "ready"));
    }, ms);
    return () => clearTimeout(t);
  }, [combatFooterSnapshot, combatRecoveryPhase]);

  useEffect(() => {
    if (combatResult?.secondAttempt) {
      const seq = ++combatToastSeqRef.current;
      setCombatToast({
        seq,
        message: "🎲 Second attempt! Roll again — monster was caught off guard!",
        style: "secondAttempt",
      });
    } else {
      setCombatToast((prev) => (prev?.style === "secondAttempt" ? null : prev));
    }
  }, [!!combatResult?.secondAttempt]);

  useEffect(() => {
    if (!combatToast) return;
    const { seq, style } = combatToast;
    const ms = COMBAT_TOAST_AUTO_DISMISS_MS[style];
    const t = setTimeout(() => {
      setCombatToast((cur) => (cur?.seq === seq ? null : cur));
    }, ms);
    return () => clearTimeout(t);
  }, [combatToast]);

  useEffect(() => {
    setBonusLootSelectedIndex(0);
  }, [combatResult?.bonusRewardOptions]);

  const handlePickCombatBonusReward = useCallback(
    (pi: number, monsterType: MonsterType, chosen: MonsterBonusReward | "skip") => {
      if (chosen === "skip") {
        handleDismissCombatResult(true);
        return;
      }
      const br = chosen;
      const artifactTypePicked: StoredArtifactKind | null =
        br.type === "artifact"
          ? (["dice", "shield", "teleport", "reveal", "healing"] as StoredArtifactKind[])[Math.floor(Math.random() * 5)]!
          : null;
      /** Commit lab before dismiss so labRef / UI see new artifacts (avoids race with modal close + effects). */
      flushSync(() => {
      setLab((prev) => {
        if (!prev || winnerRef.current !== null) return prev;
        const next = new Labyrinth(prev.width, prev.height, 0, prev.numPlayers, prev.monsterDensity);
        next.grid = prev.grid.map((row) => [...row]);
        next.players = prev.players.map((pl) => ({
          ...pl,
          jumps: pl.jumps ?? 0,
          diamonds: pl.diamonds ?? 0,
          shield: pl.shield ?? 0,
          bombs: pl.bombs ?? 0,
          hp: pl.hp ?? DEFAULT_PLAYER_HP,
          artifacts: pl.artifacts ?? 0,
          artifactDice: pl.artifactDice ?? 0,
          artifactShield: pl.artifactShield ?? 0,
          artifactTeleport: pl.artifactTeleport ?? 0,
          artifactReveal: pl.artifactReveal ?? 0,
          artifactHealing: pl.artifactHealing ?? 0,
          artifactsCollected: pl.artifactsCollected ?? [],
          diceBonus: pl.diceBonus ?? 0,
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
        next.monsters = prev.monsters.map((m) => ({
          ...m,
          patrolArea: [...m.patrolArea],
          hp: m.hp,
          draculaState: m.draculaState,
          draculaCooldowns: m.draculaCooldowns ? { ...m.draculaCooldowns } : undefined,
          targetPlayerIndex: m.targetPlayerIndex,
        }));
        next.eliminatedPlayers = new Set(prev.eliminatedPlayers);
        const p = next.players[pi];
        if (!p) return next;
        if (br.type === "artifact" && artifactTypePicked) {
          p.artifacts = Math.min(3, (p.artifacts ?? 0) + br.amount);
          const ac = p.artifactsCollected ?? [];
          p.artifactsCollected = [...ac, STORED_ARTIFACT_LINE[artifactTypePicked]];
          if (artifactTypePicked === "dice") p.artifactDice = (p.artifactDice ?? 0) + br.amount;
          else if (artifactTypePicked === "shield") p.artifactShield = (p.artifactShield ?? 0) + br.amount;
          else if (artifactTypePicked === "teleport") p.artifactTeleport = (p.artifactTeleport ?? 0) + br.amount;
          else if (artifactTypePicked === "reveal") p.artifactReveal = (p.artifactReveal ?? 0) + br.amount;
          else p.artifactHealing = (p.artifactHealing ?? 0) + br.amount;
        }
        if (br.type === "shield") {
          p.shield = (p.shield ?? 0) + br.amount;
        }
        if (br.type === "jump") {
          p.jumps = (p.jumps ?? 0) + br.amount;
        }
        if (br.type === "catapult") {
          p.catapultCharges = (p.catapultCharges ?? 0) + br.amount;
        }
        if (br.type === "diceBonus") {
          p.diceBonus = (p.diceBonus ?? 0) + br.amount;
        }
        return next;
      });
      });
      if (br.type === "bonusMoves" && pi === currentPlayerRef.current) {
        movesLeftRef.current = (movesLeftRef.current ?? 0) + br.amount;
        setMovesLeft((m) => (m ?? 0) + br.amount);
        setBonusMovesGained(br.amount);
      }
      if (br.type === "shield") setShieldGained(true);
      if (br.type === "jump") setJumpAdded(br.amount);
      if (br.type === "catapult") setCatapultGained(true);
      if (br.type === "artifact" && artifactTypePicked) setArtifactGained(artifactTypePicked);
      handleDismissCombatResult(true);
    },
    [handleDismissCombatResult]
  );

  const handleMovementRollComplete = useCallback((value: number) => {
    if (combatStateRef.current) return;
    const labNow = labRef.current;
    const p = labNow?.players[currentPlayerRef.current];
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
    if (bonus > 0 && labNow) {
      setDiceBonusApplied(true);
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
          hp: pl.hp ?? DEFAULT_PLAYER_HP,
          artifacts: pl.artifacts ?? 0,
          artifactsCollected: pl.artifactsCollected ?? [],
          artifactDice: pl.artifactDice ?? 0,
          artifactShield: pl.artifactShield ?? 0,
          artifactTeleport: pl.artifactTeleport ?? 0,
          artifactReveal: pl.artifactReveal ?? 0,
          artifactHealing: pl.artifactHealing ?? 0,
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
    setShowDiceModal(false);
    setTurnChangeEffect(null);
    setBonusAdded(null);
    setPlayerTurns((prev) => {
      const next = [...prev];
      if (currentPlayerRef.current < next.length) next[currentPlayerRef.current] = (next[currentPlayerRef.current] ?? 0) + 1;
      return next;
    });
  }, []);

  const rollDice = useCallback(async () => {
    if (winner !== null || !lab) return;
    if (combatState) return;
    if (movesLeft > 0) return;
    setRolling(true);
    await diceRef.current?.roll();
  }, [lab, movesLeft, winner, combatState]);

  const handleCombatRollClick = useCallback(() => {
    if (rolling) return;
    setCombatFooterSnapshot(null);
    setCombatRecoveryPhase("ready");
    combatHasRolledRef.current = true; // Stance already chosen when combat opened (matches defense modifier)
    setRolling(true);
    const runRoll = () => {
      const rollResult = combatDiceRef.current?.roll();
      if (rollResult) {
        rollResult.catch(() => setRolling(false));
      } else {
        const v = Math.floor(Math.random() * 6) + 1;
        handleCombatRollComplete(v);
      }
    };
    /** Lower viewport is height 0 until rolling; dice mounts in upper slot — wait for layout so Dice3D / WebGL has a real box. */
    requestAnimationFrame(() => requestAnimationFrame(runRoll));
  }, [rolling, handleCombatRollComplete]);

  const handleRunAway = useCallback(() => {
    const combat = combatStateRef.current;
    if (!combat || rolling) return;
    if (movesLeftRef.current <= 0) return;
    movesLeftRef.current--;
    setMovesLeft(movesLeftRef.current);
    setCombatState(null);
    setDefeatedMonsterOnCell(null);
    setCombatUseShield(true);
    setCombatUseDiceBonus(true);
    setLab((prev) => {
      if (!prev || winnerRef.current !== null) return prev;
      const next = new Labyrinth(prev.width, prev.height, 0, prev.numPlayers, prev.monsterDensity);
      next.grid = prev.grid.map((r) => [...r]);
      next.players = prev.players.map((p) => ({ ...p }));
      next.monsters = prev.monsters.map((m) => ({ ...m, patrolArea: [...m.patrolArea] }));
      next.eliminatedPlayers = new Set(prev.eliminatedPlayers);
      next.hiddenCells = new Map(prev.hiddenCells);
      next.webPositions = [...(prev.webPositions || [])];
      next.fogZones = new Map(prev.fogZones || new Map());
      next.goalX = prev.goalX;
      next.goalY = prev.goalY;
      const pi = combat.playerIndex;
      const p = next.players[pi];
      if (!p) return prev;
      let retreatX: number;
      let retreatY: number;
      if (combat.prevX !== undefined && combat.prevY !== undefined) {
        retreatX = combat.prevX;
        retreatY = combat.prevY;
      } else {
        const dirs: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
        const retreat = dirs.find(([dx, dy]) => {
          const nx = p.x + dx;
          const ny = p.y + dy;
          return nx >= 0 && nx < next.width && ny >= 0 && ny < next.height && isWalkable(next.grid[ny][nx]) &&
            !next.monsters.some((mo) => mo.x === nx && mo.y === ny);
        });
        if (!retreat) return prev;
        retreatX = p.x + retreat[0];
        retreatY = p.y + retreat[1];
      }
      p.x = retreatX;
      p.y = retreatY;
      return next;
    });
  }, [rolling]);

  const triggerRoundEnd = useCallback(() => {
    setLab((prev) => {
      if (!prev || winnerRef.current !== null) return prev;
      const newRound = (prev.round ?? 0) + 1;
      if (newRound >= MAX_ROUNDS) {
        const winnerClosest = prev.getPlayerClosestToGoal();
        if (winnerClosest !== null) setTimeout(() => setWinner(winnerClosest), 0);
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
        const skipMonsterMove =
          combatStateRef.current != null ||
          combatResultRef.current != null ||
          combatContinuesAfterRollRef.current;
        applyEvent(next, ev, 0, { skipMonsterMove });
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

  useEffect(() => {
    triggerRoundEndRef.current = triggerRoundEnd;
  }, [triggerRoundEnd]);

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
    setDiceBonusApplied(null);
    setShowDiceModal(true);
    setRolling(false);
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

  const handleUseArtifact = useCallback(
    (type: StoredArtifactKind) => {
      if (!lab || winner !== null || lab.eliminatedPlayers.has(currentPlayer)) return;
      const cp = lab.players[currentPlayer];
      const inCombat = !!combatStateRef.current;
      if (!cp) return;
      const n = storedArtifactCount(cp, type);
      if (n <= 0) return;
      /** Map-phase items: teleport / reveal / healing are not spent during combat. */
      if (inCombat && isStoredArtifactMapOnly(type)) return;
      if (type === "healing" && (cp.hp ?? DEFAULT_PLAYER_HP) >= DEFAULT_PLAYER_HP) return;
      if (type === "reveal") {
        const totalDiamonds = lab.players.reduce((s, pl) => s + (pl.diamonds ?? 0), 0);
        if (peekRevealBatchSize(lab, totalDiamonds) <= 0) return;
      }
      const next = new Labyrinth(lab.width, lab.height, 0, lab.numPlayers, lab.monsterDensity);
      next.grid = lab.grid.map((r) => [...r]);
      next.players = lab.players.map((p) => ({
        ...p,
        jumps: p.jumps ?? 0,
        diamonds: p.diamonds ?? 0,
        shield: p.shield ?? 0,
        bombs: p.bombs ?? 0,
        artifactDice: p.artifactDice ?? 0,
        artifactShield: p.artifactShield ?? 0,
        artifactTeleport: p.artifactTeleport ?? 0,
        artifactReveal: p.artifactReveal ?? 0,
        artifactHealing: p.artifactHealing ?? 0,
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
      next.monsters = lab.monsters.map((m) => ({ ...m, patrolArea: [...m.patrolArea] }));
      next.eliminatedPlayers = new Set(lab.eliminatedPlayers);
      const p = next.players[currentPlayer]!;
      if (type === "dice") {
        p.artifactDice!--;
        p.artifacts = Math.max(0, (p.artifacts ?? 0) - 1);
        if (inCombat) {
          /** In combat: +1 to next attack roll (same as before). */
          p.diceBonus = (p.diceBonus ?? 0) + 1;
          setDiceBonusApplied(true);
          combatUseDiceBonusRef.current = true;
          setCombatUseDiceBonus(true);
        } else {
          /** On map: roll d6 and add that many moves to the current pool. */
          const roll = Math.floor(Math.random() * 6) + 1;
          movesLeftRef.current = (movesLeftRef.current ?? 0) + roll;
          setMovesLeft(movesLeftRef.current);
          setBonusMovesGained(roll);
        }
      } else if (type === "shield") {
        p.artifactShield!--;
        p.artifacts = Math.max(0, (p.artifacts ?? 0) - 1);
        p.shield = (p.shield ?? 0) + 1;
        setShieldGained(true);
        if (inCombat) {
          combatUseShieldRef.current = true;
          setCombatUseShield(true);
        }
      } else if (type === "teleport") {
        const options = next.getTeleportOptions(currentPlayer, 6);
        if (options.length > 0) {
          p.artifactTeleport!--;
          p.artifacts = Math.max(0, (p.artifacts ?? 0) - 1);
          setLab(next);
          setTeleportPicker({ playerIndex: currentPlayer, from: [cp.x, cp.y], options, sourceType: "artifact" });
        }
        return;
      } else if (type === "reveal") {
        const totalDiamonds = next.players.reduce((s, pl) => s + (pl.diamonds ?? 0), 0);
        const revealed = next.revealHiddenCells(totalDiamonds);
        if (revealed <= 0) return;
        p.artifactReveal!--;
        p.artifacts = Math.max(0, (p.artifacts ?? 0) - 1);
        setCellsRevealed(revealed);
      } else if (type === "healing") {
        p.artifactHealing!--;
        p.artifacts = Math.max(0, (p.artifacts ?? 0) - 1);
        p.hp = Math.min(DEFAULT_PLAYER_HP, (p.hp ?? DEFAULT_PLAYER_HP) + 1);
        setHealingGained(true);
      }
      setLab(next);
    },
    [lab, winner, currentPlayer, setCombatUseDiceBonus, setCombatUseShield]
  );

  const applyMobileDockSelection = useCallback(() => {
    if (mobileDockAction === null) return;
    if (mobileDockAction === "bomb") handleUseBomb();
    else handleUseArtifact(mobileDockAction);
  }, [mobileDockAction, handleUseBomb, handleUseArtifact]);

  const doMove = useCallback(
    (dx: number, dy: number, jumpOnly = false) => {
      if (winner !== null || !lab) return;
      if (combatStateRef.current) {
        combatLog("doMove BLOCKED: combatStateRef.current is set");
        return;
      }
      if (movesLeftRef.current <= 0) return;
      if (passThroughMagicRef.current) return;
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
      setPassThroughMagic(false);
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
    setDiceBonusApplied(null);
      setJumpAdded(null);
      if (isWebCell) setWebSlowed(true);
      const next = new Labyrinth(lab.width, lab.height, 0, lab.numPlayers, lab.monsterDensity);
      next.grid = lab.grid.map((r) => [...r]);
      next.players = lab.players.map((p) => ({
        ...p,
        hp: p.hp ?? DEFAULT_PLAYER_HP,
        jumps: p.jumps ?? 0,
        diamonds: p.diamonds ?? 0,
        shield: p.shield ?? 0,
        bombs: p.bombs ?? 0,
        artifacts: p.artifacts ?? 0,
        artifactsCollected: p.artifactsCollected ?? [],
        artifactDice: p.artifactDice ?? 0,
        artifactShield: p.artifactShield ?? 0,
        artifactTeleport: p.artifactTeleport ?? 0,
        artifactReveal: p.artifactReveal ?? 0,
        artifactHealing: p.artifactHealing ?? 0,
        diceBonus: p.diceBonus ?? 0,
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
      openMovePadDesktopWithTimerRef.current();
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
              setShowDiceModal(true);
              setRolling(false);
            } else if (cell === TRAP_HARM) {
              const usedShield = next.tryConsumeShield(currentPlayer);
              if (usedShield) setShieldAbsorbed(true);
              else {
                p.hp = (p.hp ?? DEFAULT_PLAYER_HP) - 1;
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
                  setShowDiceModal(true);
                  setRolling(false);
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
                let trapNextP = (currentPlayer + 1) % lab.numPlayers;
                while (next.eliminatedPlayers.has(trapNextP) && trapNextP !== currentPlayer) {
                  trapNextP = (trapNextP + 1) % lab.numPlayers;
                }
                const trapLiving = [...Array(next.numPlayers).keys()].filter((i) => !next.eliminatedPlayers.has(i));
                const trapFirstLiving = trapLiving.length > 0 ? Math.min(...trapLiving) : -1;
                const trapRoundComplete = trapLiving.length <= 1 || trapNextP === trapFirstLiving;
                setTimeout(() => {
                  setTurnChangeEffect(trapNextP);
                  setCurrentPlayer(trapNextP);
                  setShowDiceModal(true);
                  setRolling(false);
                  if (trapRoundComplete) triggerRoundEnd();
                }, SPECIAL_MOVE_SETTLE_MS);
              }
            }
          }
          if (cell && isArtifactCell(cell)) {
            const kind = storedArtifactKindFromCell(cell);
            if (kind) {
              p.artifacts = (p.artifacts ?? 0) + 1;
              const ac = p.artifactsCollected ?? [];
              if (kind === "dice") {
                p.artifactDice = (p.artifactDice ?? 0) + 1;
                setArtifactGained("dice");
              } else if (kind === "shield") {
                p.artifactShield = (p.artifactShield ?? 0) + 1;
                setArtifactGained("shield");
              } else if (kind === "teleport") {
                p.artifactTeleport = (p.artifactTeleport ?? 0) + 1;
                setArtifactGained("teleport");
              } else if (kind === "reveal") {
                p.artifactReveal = (p.artifactReveal ?? 0) + 1;
                setArtifactGained("reveal");
              } else {
                p.artifactHealing = (p.artifactHealing ?? 0) + 1;
                setArtifactGained("healing");
              }
              p.artifactsCollected = [...ac, STORED_ARTIFACT_LINE[kind]];
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
          // Magic teleport: only stop for destination picker when this step used your last move — otherwise walk through and use magic when you end a move here
          if (
            cell &&
            isMagicCell(cell) &&
            !next.hasUsedTeleportFrom(currentPlayer, p.x, p.y) &&
            movesLeftRef.current <= 0
          ) {
            const options = next.getTeleportOptions(currentPlayer, 6);
            if (options.length > 0) {
              setTeleportPicker({ playerIndex: currentPlayer, from: [p.x, p.y], options, sourceType: "magic" });
              teleportPickerSet = true;
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
                const fromX = p.x;
                const fromY = p.y;
                const options = next.getTeleportOptions(currentPlayer, 6);
                if (options.length > 0 && movesLeftRef.current <= 0) {
                  setHiddenGemTeleport(true);
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
          combatLog("COMBAT START: player moved onto monster", { monsterType: collision.monsterType, monsterIndex: collision.monsterIndex, playerIndex: collision.playerIndex });
          const p = next.players[collision.playerIndex];
          setCollisionEffect(p ? { x: p.x, y: p.y } : null);
          combatHasRolledRef.current = false;
          combatSurpriseRef.current = "hunt";
          setRolling(false);
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
        if (next.hasWon(currentPlayer)) {
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
              setShowDiceModal(true);
              setRolling(false);
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
      // Freeze all monster AI while any combat UI/encounter is active (including result modal or multi-roll fight)
      if (combatStateRef.current) return;
      if (combatResultRef.current) return;
      if (combatContinuesAfterRollRef.current) return;
      if (teleportPickerRef.current || catapultPickerRef.current || passThroughMagicRef.current) return;
      if (movesLeftRef.current <= 0) return; // No monster activity until player has rolled and has moves
      setLab((prev) => {
        if (!prev || winnerRef.current !== null || combatStateRef.current) return prev;
        if (combatResultRef.current) return prev;
        if (combatContinuesAfterRollRef.current) return prev;
        if (teleportPickerRef.current || catapultPickerRef.current || passThroughMagicRef.current) return prev;
        const next = new Labyrinth(prev.width, prev.height, 0, prev.numPlayers, prev.monsterDensity);
        next.grid = prev.grid.map((r) => [...r]);
        next.players = prev.players.map((p) => ({
          ...p,
          jumps: p.jumps ?? 0,
          diamonds: p.diamonds ?? 0,
          shield: p.shield ?? 0,
          bombs: p.bombs ?? 0,
          hp: p.hp ?? DEFAULT_PLAYER_HP,
          artifacts: p.artifacts ?? 0,
        }));
        next.goalX = prev.goalX;
        next.goalY = prev.goalY;
        next.round = prev.round;
        next.currentRound = prev.currentRound;
        next.monsters = prev.monsters.map((m) => ({
          ...m,
          patrolArea: [...m.patrolArea],
          hp: m.hp,
          draculaState: m.draculaState,
          draculaCooldowns: m.draculaCooldowns ? { ...m.draculaCooldowns } : undefined,
          targetPlayerIndex: m.targetPlayerIndex,
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
        next.moveMonsters(currentPlayerRef.current, scheduleDraculaAction);
        const collision = next.checkMonsterCollision(currentPlayerRef.current);
        if (collision && movesLeftRef.current > 0) {
          const p = next.players[collision.playerIndex];
          setCollisionEffect(p ? { x: p.x, y: p.y } : null);
          combatHasRolledRef.current = false;
          combatSurpriseRef.current = "hunt";
          setRolling(false);
          setCombatState({ playerIndex: collision.playerIndex, monsterType: collision.monsterType, monsterIndex: collision.monsterIndex });
        }
        return next;
      });
    }, MONSTER_MOVE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [lab?.width, lab?.height, lab?.numPlayers, winner, combatState]);

  useEffect(() => {
    if (!lab || winner !== null || combatState || movesLeft > 0 || rolling || catapultPicker || teleportPicker || passThroughMagic) return;
    if (lab.eliminatedPlayers.has(currentPlayer)) {
      let nextP = (currentPlayer + 1) % lab.numPlayers;
      while (lab.eliminatedPlayers.has(nextP) && nextP !== currentPlayer) {
        nextP = (nextP + 1) % lab.numPlayers;
      }
      setTurnChangeEffect(nextP);
      setCurrentPlayer(nextP);
      setShowDiceModal(true);
      setRolling(false);
    }
  }, [lab, winner, movesLeft, rolling, currentPlayer, catapultPicker, teleportPicker, passThroughMagic, combatState]);

  // Auto-roll when dice modal is shown (restores original behavior: next player gets moves without manual click)
  useEffect(() => {
    if (
      !showDiceModal ||
      combatState ||
      combatResult ||
      winner !== null ||
      !lab ||
      rolling ||
      movesLeft > 0 ||
      diceResult !== null
    )
      return;
    combatLog("dice auto-roll: triggering roll in 500ms", { showDiceModal, movesLeft });
    const t = setTimeout(() => {
      setRolling(true);
      diceRef.current?.roll();
    }, 500);
    return () => clearTimeout(t);
  }, [showDiceModal, combatState, combatResult, winner, lab, rolling, movesLeft, diceResult]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isKeyboardEventFromEditableField(e.target)) return;
      if (e.key === "r" || e.key === "R") {
        newGame();
        e.preventDefault();
        return;
      }
      if (combatStateRef.current) {
        combatLog("keydown BLOCKED: combatStateRef.current is set");
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
        openMovePadDesktopWithTimerRef.current();
        if (movesLeftRef.current <= 0 || winnerRef.current !== null || !lab || passThroughMagicRef.current) return;
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
  const moveDisabled = movesLeft <= 0 || gameOver || (lab?.eliminatedPlayers.has(currentPlayer) ?? false) || passThroughMagic || !!combatState;
  const rollDisabled = !!combatState || (!combatState && movesLeft > 0) || gameOver || rolling || !!catapultPicker || !!teleportPicker || passThroughMagic;
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
        if (next.hasWon(playerIndex)) setWinner(playerIndex);
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
        setLab(next);
        setTimeout(() => {
          setTurnChangeEffect(nextP);
          setCurrentPlayer(nextP);
          setShowDiceModal(true);
          setRolling(false);
          if (roundComplete) triggerRoundEnd();
        }, SPECIAL_MOVE_SETTLE_MS);
      }
    },
    [lab, teleportPicker, triggerRoundEnd]
  );

  useEffect(() => {
    handleTeleportSelectRef.current = handleTeleportSelect;
  }, [handleTeleportSelect]);

  const MAGIC_TELEPORT_TIMEOUT_MS = 2000;

  useEffect(() => {
    if (!teleportPicker || teleportPicker.options.length === 0) {
      if (teleportTimerRef.current) {
        clearTimeout(teleportTimerRef.current);
        teleportTimerRef.current = null;
      }
      return;
    }
    if (teleportTimerRef.current) clearTimeout(teleportTimerRef.current);
    teleportTimerRef.current = setTimeout(() => {
      teleportTimerRef.current = null;
      const picker = teleportPickerRef.current;
      if (!picker || picker.options.length === 0) return;
      const [destX, destY] = picker.options[Math.floor(Math.random() * picker.options.length)]!;
      handleTeleportSelectRef.current(destX, destY);
    }, MAGIC_TELEPORT_TIMEOUT_MS);
    return () => {
      if (teleportTimerRef.current) {
        clearTimeout(teleportTimerRef.current);
        teleportTimerRef.current = null;
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
  const startModalRowBase: React.CSSProperties = isMobile
    ? { ...modalRowStyle, flexDirection: "column", alignItems: "stretch", gap: 6, marginBottom: "0.85rem" }
    : modalRowStyle;
  return (
      <div
        style={{
          ...startModalOverlayStyle,
          ...(isMobile
            ? {
                alignItems: "flex-start",
                justifyContent: "center",
                paddingTop: "max(8px, env(safe-area-inset-top, 0px))",
              }
            : {}),
        }}
      >
        <div
          style={{
            ...startModalStyle,
            ...(isMobile
              ? {
                  padding: "1.15rem 1rem",
                  width: "100%",
                  maxWidth: "min(100%, 620px)",
                  borderRadius: 12,
                }
              : {}),
          }}
        >
          <h1
            style={{
              ...startModalTitleStyle,
              ...(isMobile ? { fontSize: "1.5rem", letterSpacing: 2, lineHeight: 1.2 } : {}),
            }}
          >
            LABYRINTH
          </h1>
          <p
            style={{
              ...startModalSubtitleStyle,
              ...(isMobile ? { fontSize: "0.88rem", marginBottom: "1.1rem", lineHeight: 1.35 } : {}),
            }}
          >
            Configure your game and start when ready
          </p>
          <div style={{ ...startModalFormStyle, ...(isMobile ? { marginBottom: "1.1rem" } : {}) }}>
            <div style={startModalRowBase}>
              <label style={isMobile ? startModalLabelStyleMobile : startModalLabelStyle}>Maze size</label>
              <select
                value={mazeSize}
                onChange={(e) => setMazeSize(Number(e.target.value))}
                style={{ ...startModalSelectStyle, ...(isMobile ? { width: "100%", minHeight: 44 } : {}) }}
              >
                {SIZE_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}×{s}</option>
                ))}
              </select>
            </div>
            <div style={startModalRowBase}>
              <label style={isMobile ? startModalLabelStyleMobile : startModalLabelStyle}>Difficulty</label>
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(Number(e.target.value))}
                style={{ ...startModalSelectStyle, ...(isMobile ? { width: "100%", minHeight: 44 } : {}) }}
              >
                {DIFFICULTY_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d === 1 ? "Easy" : d === 2 ? "Normal" : d === 3 ? "Hard" : "Extreme"}
                  </option>
                ))}
              </select>
            </div>
            <div style={startModalRowBase}>
              <label style={isMobile ? startModalLabelStyleMobile : startModalLabelStyle}>Number of players</label>
              <input
                type="number"
                min={1}
                max={10}
                value={numPlayers}
                onChange={(e) => setNumPlayers(Math.min(10, Math.max(1, Number(e.target.value) || 1)))}
                style={{ ...startModalInputStyle, ...(isMobile ? { width: "100%", maxWidth: 120, minHeight: 44 } : {}) }}
              />
            </div>
            <div
              style={{
                ...modalRowStyle,
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 8,
                marginBottom: 0,
              }}
            >
              <label style={isMobile ? startModalLabelStyleMobile : startModalLabelStyle}>Player names & avatars</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
                {Array.from({ length: numPlayers }).map((_, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      flexDirection: isMobile ? "column" : "row",
                      alignItems: isMobile ? "stretch" : "center",
                      gap: isMobile ? 8 : 10,
                      width: "100%",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 4,
                        flexShrink: 0,
                        maxWidth: isMobile ? "100%" : AVATAR_PICKER_WRAP_MAX_W,
                      }}
                    >
                      {PLAYER_AVATARS.map((av) => (
                        <button
                          key={av}
                          type="button"
                          onClick={() => {
                            setPlayerAvatars((prev) => {
                              const next = prev.length >= numPlayers ? [...prev] : [...prev, ...Array.from({ length: numPlayers - prev.length }, (_, j) => PLAYER_AVATARS[(prev.length + j) % PLAYER_AVATARS.length])];
                              next[i] = av;
                              return next;
                            });
                          }}
                          style={{
                            width: AVATAR_PICKER_BTN_PX,
                            height: AVATAR_PICKER_BTN_PX,
                            padding: 0,
                            fontSize: AVATAR_PICKER_FONT,
                            lineHeight: 1,
                            border: (playerAvatars[i] ?? PLAYER_AVATARS[i % PLAYER_AVATARS.length]) === av ? `2px solid ${PLAYER_COLORS[i] ?? "#00ff88"}` : "1px solid #444",
                            borderRadius: 6,
                            background: (playerAvatars[i] ?? PLAYER_AVATARS[i % PLAYER_AVATARS.length]) === av ? "rgba(0,255,136,0.2)" : "#1a1a24",
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {av}
                        </button>
                      ))}
                    </div>
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
                      style={{
                        ...startModalInputStyle,
                        flex: isMobile ? undefined : 1,
                        minWidth: 0,
                        width: isMobile ? "100%" : "auto",
                        maxWidth: "100%",
                        minHeight: isMobile ? 44 : undefined,
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div style={startModalButtonsStyle}>
            <button
              type="button"
              onClick={() => {
                newGame();
                setGameStarted(true);
              }}
              style={{
                ...startButtonStyle,
                ...(isMobile ? { width: "100%", minHeight: 48, padding: "0.85rem 1rem", fontSize: "1.02rem" } : {}),
              }}
            >
              Start Game
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

  const showMovePad = isMobile || movePadOpenDesktop;
  const showMoveGrid = showMovePad && movesLeft > 0 && !combatState && winner === null;
  const inCombatDock = !!combatState;
  const totalDiamondsDock = lab.players.reduce((s, pl) => s + (pl.diamonds ?? 0), 0);
  const bombUseDisabled = !cp || (cp?.bombs ?? 0) <= 0 || (moveDisabled && !combatState);
  const artifactUseDisabledDock = (kind: StoredArtifactKind) => {
    if (!cp) return true;
    if (inCombatDock && isStoredArtifactMapOnly(kind)) return true;
    if (kind === "healing" && (cp.hp ?? DEFAULT_PLAYER_HP) >= DEFAULT_PLAYER_HP) return true;
    if (kind === "reveal" && peekRevealBatchSize(lab, totalDiamondsDock) <= 0) return true;
    return false;
  };
  const mobileApplyDisabled =
    mobileDockAction == null
      ? true
      : mobileDockAction === "bomb"
        ? bombUseDisabled
        : artifactUseDisabledDock(mobileDockAction);
  const dockActions: { id: MobileDockAction; n: number }[] = [];
  if ((cp?.bombs ?? 0) > 0) dockActions.push({ id: "bomb", n: cp!.bombs ?? 0 });
  for (const k of STORED_ARTIFACT_ORDER) {
    const n = storedArtifactCount(cp, k);
    if (n > 0) dockActions.push({ id: k, n });
  }

  return (
    <div style={gamePaneStyle}>
      <header
        style={{
          ...headerStyle,
          ...(isMobile ? { gap: 6, padding: "0.35rem 0.5rem", flexWrap: "nowrap" as const } : {}),
        }}
      >
        <h1
          style={
            isMobile
              ? {
                  ...headerTitleStyle,
                  fontSize: "1.05rem",
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }
              : headerTitleStyle
          }
        >
          LABYRINTH
        </h1>
        {!isMobile ? (
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
                  {playerNames[i] ?? `P${i + 1}`}: <ArtifactIcon variant="diamond" size={16} style={{ marginLeft: 2, marginRight: 2, verticalAlign: "middle" }} />{p?.diamonds ?? 0}
                </span>
              ))}
            </span>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setMobileGameSummaryOpen((o) => !o)}
            aria-expanded={mobileGameSummaryOpen}
            aria-label="Game summary"
            title="Game summary"
            style={{
              flexShrink: 0,
              minWidth: 44,
              minHeight: 44,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              fontSize: "1.35rem",
              lineHeight: 1,
              color: "#ccc",
              background: mobileGameSummaryOpen ? "#2a2a38" : "#1a1a24",
              border: "1px solid #444",
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            ☰
          </button>
        )}
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
        <div ref={headerMenuRef} style={{ position: "relative", flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => setHeaderMenuOpen((o) => !o)}
            aria-expanded={headerMenuOpen}
            aria-haspopup="menu"
            style={{
              ...buttonStyle,
              ...headerButtonStyle,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            Menu
            <span aria-hidden style={{ fontSize: "0.65rem", opacity: 0.9, lineHeight: 1 }}>
              ▼
            </span>
          </button>
          {headerMenuOpen && (
            <div
              role="menu"
              style={{
                position: "absolute",
                top: "100%",
                right: 0,
                marginTop: 6,
                minWidth: isMobile ? "min(92vw, 300px)" : 272,
                maxWidth: "min(92vw, 340px)",
                padding: "12px 14px",
                background: "#1a1a24",
                border: "1px solid #444",
                borderRadius: 8,
                boxShadow: "0 12px 40px rgba(0,0,0,0.55)",
                zIndex: 200,
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: "0.65rem",
                    fontWeight: 700,
                    color: "#888",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    marginBottom: 8,
                  }}
                >
                  Current progress
                </div>
                <div style={{ fontSize: "0.8rem", color: "#c8c8d0", lineHeight: 1.45, display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ fontWeight: 700, color: winner !== null ? (winner >= 0 ? "#00ff88" : "#ff6666") : (PLAYER_COLORS_ACTIVE[currentPlayer] ?? "#00ff88") }}>
                    {winner !== null
                      ? winner >= 0
                        ? `${playerNames[winner] ?? `Player ${winner + 1}`} wins!`
                        : "Monsters win!"
                      : `${playerNames[currentPlayer] ?? `Player ${currentPlayer + 1}`}'s turn`}
                  </div>
                  <div>
                    <span style={{ color: "#888" }}>Maze: </span>
                    {lab.width}×{lab.height}
                  </div>
                  <div>
                    <span style={{ color: "#888" }}>Moves: </span>
                    {diceResult !== null ? `${Math.max(0, (bonusAdded ?? diceResult) - movesLeft)}/${bonusAdded ?? diceResult}` : "—/—"}
                  </div>
                  <div>
                    <span style={{ color: "#888" }}>Round: </span>
                    {(lab.round ?? 0) + 1}/{MAX_ROUNDS}
                  </div>
                  <div>
                    <span style={{ color: "#888" }}>Total moves: </span>
                    {totalMoves}
                  </div>
                  <div style={{ borderTop: "1px solid #333", paddingTop: 8 }}>
                    <div style={{ color: "#888", fontSize: "0.72rem", marginBottom: 6 }}>Diamonds</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {lab.players.map((p, i) => (
                        <div
                          key={i}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            color: lab.eliminatedPlayers.has(i) ? "#666" : (PLAYER_COLORS[i] ?? "#aaa"),
                            textDecoration: lab.eliminatedPlayers.has(i) ? "line-through" : undefined,
                          }}
                        >
                          <span style={{ fontWeight: 600 }}>{playerNames[i] ?? `P${i + 1}`}</span>
                          <ArtifactIcon variant="diamond" size={16} style={{ flexShrink: 0 }} />
                          <span>{p?.diamonds ?? 0}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setHeaderMenuOpen(false);
                    setSettingsOpen(true);
                  }}
                  style={{ ...buttonStyle, ...headerButtonStyle, width: "100%", justifyContent: "center" }}
                >
                  Game setup
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setHeaderMenuOpen(false);
                    setGameStarted(false);
                  }}
                  style={{ ...buttonStyle, ...secondaryButtonStyle, width: "100%", justifyContent: "center" }}
                >
                  New game
                </button>
              </div>
            </div>
          )}
        </div>
      </header>

      {isMobile && mobileGameSummaryOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 2000,
            background: "rgba(0,0,0,0.52)",
            paddingTop: HEADER_HEIGHT,
          }}
          onClick={() => setMobileGameSummaryOpen(false)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Game summary"
            onClick={(e) => e.stopPropagation()}
            style={{
              margin: "8px 12px 0",
              background: "#1a1a24",
              border: "1px solid #444",
              borderRadius: 10,
              padding: "12px 14px",
              maxHeight: "min(70vh, 480px)",
              overflowY: "auto",
              boxShadow: "0 12px 40px rgba(0,0,0,0.55)",
            }}
          >
            <div
              style={{
                fontSize: "0.72rem",
                fontWeight: 700,
                color: "#888",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginBottom: 10,
              }}
            >
              Game summary
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: "0.88rem", color: "#c0c0c8" }}>
              <div style={{ fontWeight: 700, color: winner !== null ? (winner >= 0 ? "#00ff88" : "#ff6666") : (PLAYER_COLORS_ACTIVE[currentPlayer] ?? "#00ff88") }}>
                {winner !== null
                  ? winner >= 0
                    ? `${playerNames[winner] ?? `Player ${winner + 1}`} wins!`
                    : "Monsters win!"
                  : `${playerNames[currentPlayer] ?? `Player ${currentPlayer + 1}`}'s turn`}
              </div>
              <div>
                <span style={{ color: "#888" }}>Moves: </span>
                {diceResult !== null ? `${Math.max(0, (bonusAdded ?? diceResult) - movesLeft)}/${bonusAdded ?? diceResult}` : "—/—"}
              </div>
              <div>
                <span style={{ color: "#888" }}>Round: </span>
                {(lab.round ?? 0) + 1}/{MAX_ROUNDS}
              </div>
              <div>
                <span style={{ color: "#888" }}>Total moves: </span>
                {totalMoves}
              </div>
              <div style={{ borderTop: "1px solid #333", paddingTop: 8 }}>
                <div style={{ color: "#888", fontSize: "0.75rem", marginBottom: 6 }}>Diamonds</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {lab.players.map((p, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        color: lab.eliminatedPlayers.has(i) ? "#666" : (PLAYER_COLORS[i] ?? "#aaa"),
                        textDecoration: lab.eliminatedPlayers.has(i) ? "line-through" : undefined,
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>{playerNames[i] ?? `P${i + 1}`}</span>
                      <ArtifactIcon variant="diamond" size={18} style={{ flexShrink: 0 }} />
                      <span>{p?.diamonds ?? 0}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
        {!isMobile && (
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
                HP: {p?.hp ?? DEFAULT_PLAYER_HP}/{DEFAULT_PLAYER_HP}
              </div>
              <div style={{ height: 6, background: "#333", borderRadius: 3, overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%",
                    width: `${Math.max(0, Math.min(100, ((p?.hp ?? DEFAULT_PLAYER_HP) / DEFAULT_PLAYER_HP) * 100))}%`,
                    background: (() => {
                      const hp = p?.hp ?? DEFAULT_PLAYER_HP;
                      const pct = DEFAULT_PLAYER_HP > 0 ? hp / DEFAULT_PLAYER_HP : 1;
                      return pct >= 0.66 ? "linear-gradient(90deg, #22cc44, #44ff66)" : pct >= 0.33 ? "linear-gradient(90deg, #ffaa00, #ffcc44)" : "linear-gradient(90deg, #ff4444, #ff6666)";
                    })(),
                    borderRadius: 3,
                    transition: "width 0.3s ease, background 0.3s ease",
                  }}
                />
              </div>
              <div style={{ fontSize: "0.75rem", color: "#aaa" }}>
                Artifacts: {p?.artifacts ?? 0}/3
              </div>
              {STORED_ARTIFACT_ORDER.some((k) => storedArtifactCount(p, k) > 0) &&
                STORED_ARTIFACT_ORDER.map((kind) => {
                  const n = storedArtifactCount(p, kind);
                  if (n <= 0) return null;
                  return (
                    <div
                      key={kind}
                      style={{ fontSize: "0.75rem", color: "#aa66ff", marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}
                      title={STORED_ARTIFACT_TOOLTIP[kind]}
                    >
                      <ArtifactIcon variant={storedArtifactIconVariant(kind)} size={14} />
                      <span>
                        {STORED_ARTIFACT_TITLE[kind]}: {n}
                      </span>
                    </div>
                  );
                })}
              <div style={{ fontSize: "0.75rem", color: "#aaa", display: "flex", alignItems: "center", gap: 4 }}>
                <ArtifactIcon variant="diamond" size={14} /> Diamonds: {p?.diamonds ?? 0}
              </div>
              <div style={{ fontSize: "0.75rem", color: "#aaa", display: "flex", alignItems: "center", gap: 4 }}>
                <ArtifactIcon variant="shield" size={14} /> Shield: {p?.shield ?? 0}
              </div>
              <div style={{ fontSize: "0.75rem", color: "#aaa", display: "flex", alignItems: "center", gap: 4 }}>
                <ArtifactIcon variant="bomb" size={14} /> Bombs: {p?.bombs ?? 0}
              </div>
              {p?.hasTorch && (
                <div style={{ fontSize: "0.75rem", color: "#ffcc66", display: "flex", alignItems: "center", gap: 4 }} title="Torch: fog cleared">
                  <ArtifactIcon variant="torch" size={14} />
                </div>
              )}
            </div>
          ))}
        </aside>
        )}

        <div style={mainContentStyle}>
      {/* Single overlay for hints - one at a time to avoid duplication */}
      {(teleportPicker || catapultPicker || (turnChangeEffect !== null && lab && !lab.eliminatedPlayers.has(turnChangeEffect))) && (
        <div style={{ ...eliminatedOverlayStyle, pointerEvents: "none", zIndex: turnChangeEffect !== null ? 1100 : 450 }}>
          <div
            className="turn-change-banner"
            style={{
              ...eliminatedBannerStyle,
              borderColor: turnChangeEffect !== null && lab && !lab.eliminatedPlayers.has(turnChangeEffect)
                ? (PLAYER_COLORS[turnChangeEffect] ?? "#00ff88")
                : teleportPicker
                  ? "#aa66ff"
                  : "#ffcc00",
              background: turnChangeEffect !== null ? "rgba(0,0,0,0.92)" : "rgba(0,0,0,0.9)",
              color: turnChangeEffect !== null && lab && !lab.eliminatedPlayers.has(turnChangeEffect)
                ? (PLAYER_COLORS[turnChangeEffect] ?? "#00ff88")
                : teleportPicker
                  ? "#aa66ff"
                  : "#ffcc00",
              boxShadow: turnChangeEffect !== null && lab && !lab.eliminatedPlayers.has(turnChangeEffect)
                ? `0 0 30px ${(PLAYER_COLORS[turnChangeEffect] ?? "#00ff88")}88`
                : undefined,
              fontSize: "1.2rem",
              fontWeight: "bold",
            }}
          >
            {turnChangeEffect !== null && lab && !lab.eliminatedPlayers.has(turnChangeEffect) ? (
              <>
                <span style={{ fontSize: "1.5rem" }}>●</span>
                <span>{playerNames[turnChangeEffect] ?? `Player ${turnChangeEffect + 1}`}&apos;s turn!</span>
              </>
            ) : teleportPicker ? (
              <span>🌀 Select destination to teleport (click a highlighted cell)</span>
            ) : (
              <span>Slingshot: drag back to aim, release to launch (parabolic arc)</span>
            )}
          </div>
        </div>
      )}

      {lab && (
        <div
          style={{
            ...combatModalOverlayStyle,
            visibility: (combatState || combatResult) && (!combatState || combatState.playerIndex === currentPlayer) ? "visible" : "hidden",
            pointerEvents: (combatState || combatResult) && (!combatState || combatState.playerIndex === currentPlayer) ? "auto" : "none",
          }}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div style={combatModalStyle} onClick={(e) => e.stopPropagation()}>
            {(() => {
              const headerPi = combatState?.playerIndex ?? combatResult?.playerIndex ?? 0;
              const headerMt = combatState?.monsterType ?? combatResult?.monsterType;
              const headerMonsterName = headerMt ? getMonsterName(headerMt) : "Monster";
              /** Live fight: use maze stances. Post-fight / loss banner only: hurt/defeated from result. Second-chance: idle until dice roll, then rolling poses. */
              const secondChanceBanner = !!combatResult?.secondAttempt;
              const headerSurpriseVisible =
                !!combatState && (!combatResult || secondChanceBanner) && combatHasRolledRef.current;
              const inActiveFight = !!combatState;
              /** Between rolls: calm idle (full HP) or recover (wounded). Surprise stance only drives rolling pose + combat math — not the static portrait between strikes. */
              const headerMonsterCombatState: MonsterSpriteState = (() => {
                if (inActiveFight && headerMt) {
                  if (secondChanceBanner && combatResult?.monsterType) {
                    if (rolling) {
                      return getMonsterSpriteWhileRolling(headerMt, combatMonsterStance);
                    }
                    /** Second-chance banner used to force idle via getCombatResultMonsterSpriteState — ignore wounded HP. Use live maze HP like between rolls. */
                    if (combatState && lab) {
                      const maxHp = getMonsterMaxHp(combatState.monsterType);
                      const m = lab.monsters[combatState.monsterIndex];
                      const cur = m ? (m.hp ?? maxHp) : maxHp;
                      return monsterCalmPortraitFromHp(cur, maxHp);
                    }
                    return getCombatResultMonsterSpriteState(combatResult, combatVictoryPhase);
                  }
                  if (combatFooterSnapshot && (combatRecoveryPhase === "hurt" || combatRecoveryPhase === "recover")) {
                    return combatRecoveryPhase;
                  }
                  if (rolling) {
                    return getMonsterSpriteWhileRolling(headerMt, combatMonsterStance);
                  }
                  if (combatState && lab) {
                    const maxHp = getMonsterMaxHp(combatState.monsterType);
                    const m = lab.monsters[combatState.monsterIndex];
                    const cur = m ? (m.hp ?? maxHp) : maxHp;
                    return monsterCalmPortraitFromHp(cur, maxHp);
                  }
                  return combatMonsterStance;
                }
                if (combatResult?.monsterType) {
                  return getCombatResultMonsterSpriteState(combatResult, combatVictoryPhase);
                }
                return "neutral";
              })();
              const headerMonsterSprite =
                headerMt &&
                (getMonsterSprite(headerMt, headerMonsterCombatState) ?? getMonsterIdleSprite(headerMt));

              let monsterMaxHp = 1;
              let monsterCurHp = 1;
              if (headerMt) {
                if (inActiveFight && lab && combatState && (!combatResult || secondChanceBanner)) {
                  monsterMaxHp = Math.max(1, getMonsterMaxHp(combatState.monsterType));
                  const monster = lab.monsters[combatState.monsterIndex];
                  monsterCurHp = Math.min(monsterMaxHp, Math.max(0, monster?.hp ?? monsterMaxHp));
                } else if (combatResult) {
                  monsterMaxHp = Math.max(1, combatResult.monsterMaxHp ?? getMonsterMaxHp(headerMt));
                  monsterCurHp = Math.min(monsterMaxHp, Math.max(0, combatResult.monsterHp ?? monsterMaxHp));
                }
              }
              const mPct = monsterMaxHp > 0 ? monsterCurHp / monsterMaxHp : 1;
              const mBarBg =
                mPct >= 0.66 ? "linear-gradient(90deg, #22cc44, #44ff66)" : mPct >= 0.33 ? "linear-gradient(90deg, #ffaa00, #ffcc44)" : "linear-gradient(90deg, #ff4444, #ff6666)";

              const pHp =
                combatResult?.playerDefeated && combatResult.playerIndex === headerPi
                  ? (combatResult.playerHpAtEnd ?? 0)
                  : lab && !lab.eliminatedPlayers.has(headerPi)
                    ? (lab.players[headerPi]?.hp ?? DEFAULT_PLAYER_HP)
                    : null;
              const pMax = DEFAULT_PLAYER_HP;
              const pPct = pHp != null ? pHp / pMax : 1;
              const pFill = pHp != null ? (pPct >= 0.66 ? "linear-gradient(90deg, #22cc44, #44ff66)" : pPct >= 0.33 ? "linear-gradient(90deg, #ffaa00, #ffcc44)" : "linear-gradient(90deg, #ff4444, #ff6666)") : "#666";
              const pGlow = pHp != null ? (pPct >= 0.66 ? "rgba(68,255,102,0.33)" : pPct >= 0.33 ? "rgba(255,170,0,0.33)" : "rgba(255,68,68,0.33)") : "rgba(102,102,102,0.33)";
              const monsterRollScaryGlow =
                !!combatState && rolling && !!headerMt && (!combatResult || secondChanceBanner) && (combatMonsterStance === "angry" || combatMonsterStance === "attack");
              const showCombatHintText =
                !!combatToast || (!rolling && !!(combatFooterSnapshot || lab));
              /** After combat loss (any monster): skull in the player slot instead of emoji avatar. */
              const showCombatDefeatSkull = !!combatResult?.playerDefeated && !combatState;
              /** Mobile column is narrow: bias framing left so wide sprites (e.g. Dracula) read centered in the modal. */
              const combatMonsterImgObjectPosition = isMobile ? "left center" : "center bottom";
              return (
                <div
                  style={{
                    width: "100%",
                    flexShrink: 0,
                    textAlign: "center",
                    paddingTop: 2,
                    overflow: "visible",
                  }}
                >
                  <h2 style={combatModalTitleStyle}>Combat</h2>
                  <div style={{ minHeight: 18, marginBottom: 0 }}>
                    {diceResult !== null && combatState?.playerIndex === currentPlayer && (
                      <span style={{ fontSize: "0.8rem", color: "#00ff88", fontWeight: "bold" }}>
                        Moves: {Math.max(0, (bonusAdded ?? diceResult) - movesLeft)}/{bonusAdded ?? diceResult}
                      </span>
                    )}
                  </div>
                  <div style={combatModalVersusGridStyle}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        minHeight: 26,
                        textAlign: "center",
                      }}
                    >
                      {pendingCombatBonusPick && !combatState ? (
                        <span
                          style={{
                            fontSize: "0.72rem",
                            fontWeight: 800,
                            color: "#b8ffd9",
                            letterSpacing: "0.12em",
                            textTransform: "uppercase",
                            lineHeight: 1.2,
                            padding: "5px 12px",
                            borderRadius: 8,
                            background: "linear-gradient(180deg, rgba(0,90,55,0.55) 0%, rgba(0,45,30,0.85) 100%)",
                            border: "1px solid rgba(0, 255, 160, 0.55)",
                            boxShadow: "0 0 14px rgba(0, 255, 136, 0.25), inset 0 1px 0 rgba(255,255,255,0.08)",
                          }}
                        >
                          🏆 Winner
                        </span>
                      ) : null}
                    </div>
                    <div />
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        minHeight: 26,
                        textAlign: "center",
                      }}
                    >
                      {pendingCombatBonusPick && !combatState ? (
                        <span
                          style={{
                            fontSize: "0.72rem",
                            fontWeight: 800,
                            color: "#ffe8e8",
                            letterSpacing: "0.14em",
                            textTransform: "uppercase",
                            lineHeight: 1.2,
                            padding: "5px 12px",
                            borderRadius: 8,
                            background: "linear-gradient(180deg, rgba(120,25,25,0.65) 0%, rgba(55,10,12,0.92) 100%)",
                            border: "1px solid rgba(255, 120, 120, 0.65)",
                            textShadow: "0 0 12px rgba(255, 80, 80, 0.55), 0 1px 2px rgba(0,0,0,0.8)",
                            boxShadow: "0 0 16px rgba(255, 60, 60, 0.35), inset 0 1px 0 rgba(255,255,255,0.06)",
                          }}
                        >
                          Defeated
                        </span>
                      ) : null}
                    </div>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        minHeight: 220,
                        width: "100%",
                      }}
                    >
                      <span
                        title={showCombatDefeatSkull ? "Defeated" : undefined}
                        style={{
                          fontSize: `clamp(5rem, 11vw, 6.75rem)`,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: COMBAT_PLAYER_AVATAR_PX,
                          height: COMBAT_PLAYER_AVATAR_PX,
                          transformOrigin: "50% 50%",
                          transition: "transform 0.35s cubic-bezier(0.34, 1.45, 0.64, 1)",
                        }}
                      >
                        {showCombatDefeatSkull ? "💀" : playerAvatars[headerPi] ?? PLAYER_AVATARS[headerPi % PLAYER_AVATARS.length]}
                      </span>
                    </div>
                    <div aria-hidden style={{ minWidth: 28 }} />
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        minHeight: 220,
                        overflow: "visible",
                        width: "100%",
                      }}
                    >
                      {headerMonsterSprite ? (
                        <img
                          key={headerMonsterSprite}
                          src={headerMonsterSprite}
                          alt=""
                          style={{
                            width: COMBAT_FACEOFF_SPRITE_PX,
                            height: COMBAT_FACEOFF_SPRITE_PX,
                            /* Wide 1536×1024 attack art: contain letterboxes → tiny; cover fills 200×200 like square sprites */
                            objectFit:
                              headerMt === "V" && headerMonsterSprite.includes("/dracula/attack")
                                ? "cover"
                                : "contain",
                            objectPosition: combatMonsterImgObjectPosition,
                            transformOrigin: "50% 50%",
                            transition: "transform 0.35s cubic-bezier(0.34, 1.55, 0.64, 1), filter 0.35s ease",
                            filter: monsterRollScaryGlow
                              ? "drop-shadow(0 0 18px rgba(255,60,40,0.95)) drop-shadow(0 6px 28px rgba(200,0,0,0.55)) drop-shadow(0 2px 8px rgba(0,0,0,0.6))"
                              : "drop-shadow(0 2px 8px rgba(0,0,0,0.5))",
                          }}
                        />
                      ) : (
                        <span
                          style={{
                            fontSize: "clamp(7rem, 14vw, 9rem)",
                            lineHeight: 1,
                            width: COMBAT_FACEOFF_SPRITE_PX,
                            height: COMBAT_FACEOFF_SPRITE_PX,
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            transformOrigin: "50% 50%",
                            transition: "transform 0.35s cubic-bezier(0.34, 1.55, 0.64, 1), filter 0.35s ease",
                            filter: monsterRollScaryGlow ? "drop-shadow(0 0 14px rgba(255,80,40,0.85))" : undefined,
                          }}
                        >
                          {headerMt ? getMonsterIcon(headerMt) : "👹"}
                        </span>
                      )}
                    </div>

                    <div
                      style={{
                        gridColumn: "1 / -1",
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: "4px 10px",
                        marginTop: 0,
                        marginBottom: 1,
                        width: "100%",
                        alignItems: "start",
                      }}
                    >
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, minWidth: 0 }}>
                        {pHp != null ? (
                          <>
                            <span style={{ fontSize: "0.68rem", color: "#c8c8d0", letterSpacing: "0.04em" }}>HP</span>
                            <div style={{ ...combatHpBarUnderlineTrack, width: "100%", maxWidth: "100%" }}>
                              <div
                                style={{
                                  width: `${Math.max(0, Math.min(100, pPct * 100))}%`,
                                  height: "100%",
                                  background: pFill,
                                  transition: "width 0.25s ease",
                                  boxShadow: `0 0 10px ${pGlow}`,
                                }}
                              />
                            </div>
                            <span style={{ fontSize: "0.72rem", color: "#9a9aaa", marginTop: -2 }}>
                              {pHp} / {pMax}
                            </span>
                          </>
                        ) : (
                          <span style={{ fontSize: "0.68rem", color: "#666" }}>—</span>
                        )}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, minWidth: 0 }}>
                        {headerMt ? (
                          <>
                            <span style={{ fontSize: "0.68rem", color: "#c8c8d0", letterSpacing: "0.04em" }}>HP</span>
                            <div style={{ ...combatHpBarUnderlineTrack, width: "100%", maxWidth: "100%" }}>
                              <div
                                style={{
                                  width: `${Math.max(0, Math.min(100, mPct * 100))}%`,
                                  height: "100%",
                                  background: mBarBg,
                                  transition: "width 0.3s ease, background 0.3s ease",
                                }}
                              />
                            </div>
                            <span style={{ fontSize: "0.72rem", color: "#9a9aaa", marginTop: -2 }}>
                              {monsterCurHp} / {monsterMaxHp}
                            </span>
                          </>
                        ) : (
                          <span style={{ fontSize: "0.68rem", color: "#666" }}>—</span>
                        )}
                      </div>
                    </div>

                    <span style={{ fontSize: "0.8rem", fontWeight: 700, color: PLAYER_COLORS[headerPi] ?? "#00ff88", textAlign: "center", lineHeight: 1.15, maxWidth: "100%", minWidth: 0 }}>
                      {playerNames[headerPi] ?? `Player ${headerPi + 1}`}
                    </span>
                    <div />
                    <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "#ff8888", textAlign: "center", lineHeight: 1.15, maxWidth: "100%", minWidth: 0 }}>{headerMonsterName}</span>

                    <div />
                    <div />
                    <div style={{ textAlign: "center", minHeight: 12 }}>
                      {combatState && (!combatResult || secondChanceBanner) && headerSurpriseVisible && !rolling ? (
                        <span
                          style={{
                            fontSize: "0.62rem",
                            fontWeight: "bold",
                            letterSpacing: "0.12em",
                            color: "#aaa",
                            textTransform: "uppercase",
                          }}
                        >
                          {combatMonsterStance === "idle" ? "Surprise: idle" : combatMonsterStance === "hunt" ? "Surprise: hunt" : combatMonsterStance === "attack" ? "Surprise: attack" : "Surprise: angry"}
                        </span>
                      ) : null}
                    </div>

                    <div
                      style={{
                        gridColumn: "1 / -1",
                        display: "flex",
                        justifyContent: "center",
                        alignItems: "center",
                        padding: "0 0 2px",
                      }}
                      aria-hidden
                    >
                      <span
                        style={{
                          fontSize: "1.25rem",
                          lineHeight: 1,
                          filter: "drop-shadow(0 0 8px rgba(255,200,100,0.35))",
                        }}
                      >
                        ⚔️
                      </span>
                    </div>
                  </div>
                  {combatState && (
                    <div
                      style={{
                        width: "100%",
                        padding: "2px 8px 0",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 3,
                        flexShrink: 0,
                        boxSizing: "border-box",
                      }}
                    >
                      {rolling && lab ? (
                        <div
                          className="combat-dice combat-dice-rolling-slot"
                          style={{
                            width: "100%",
                            maxWidth: 420,
                            minWidth: 0,
                            height: COMBAT_SKILLS_HINT_STACK_TOTAL_PX,
                            minHeight: COMBAT_SKILLS_HINT_STACK_TOTAL_PX,
                            maxHeight: COMBAT_SKILLS_HINT_STACK_TOTAL_PX,
                            flexShrink: 0,
                            boxSizing: "border-box",
                            background: "linear-gradient(145deg, #1a1a24 0%, #0d0d12 100%)",
                            borderRadius: COMBAT_ROLL_UI_RADIUS_PX,
                            overflow: "hidden",
                            display: "flex",
                            flexDirection: "column",
                            border: "2px solid #ffcc00",
                            boxShadow: "inset 0 0 24px rgba(255,204,0,0.12)",
                          }}
                        >
                          <div style={{ flex: 1, minHeight: 0, width: "100%", display: "flex", flexDirection: "column" }}>
                            <Dice3D
                              ref={combatDiceRef}
                              onRollComplete={handleCombatRollComplete}
                              disabled={rolling}
                              fitContainer
                              hideHint
                            />
                          </div>
                        </div>
                      ) : (
                        <>
                          {/* Skills & artifacts above the hint so they stay visible when the modal scrolls (tall face-off + maxHeight). */}
                          {lab &&
                            (() => {
                              const pi = combatState.playerIndex;
                              const cp = lab.players[pi] ?? lab.players[headerPi];
                              const hasShield = cp ? (cp.shield ?? 0) > 0 : false;
                              const hasDiceBonus = cp ? (cp.diceBonus ?? 0) > 0 : false;
                              const hasStored = cp
                                ? STORED_ARTIFACT_ORDER.some((k) => storedArtifactCount(cp, k) > 0)
                                : false;
                              const hasSkillRow = hasShield || hasDiceBonus || hasStored;
                              return (
                                <div
                                  style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    alignItems: "center",
                                    gap: 4,
                                    width: "100%",
                                    maxWidth: 420,
                                    height: COMBAT_SKILLS_PANEL_PX,
                                    minHeight: COMBAT_SKILLS_PANEL_PX,
                                    maxHeight: COMBAT_SKILLS_PANEL_PX,
                                    padding: "4px 8px 6px",
                                    background: "rgba(0,0,0,0.45)",
                                    borderRadius: COMBAT_ROLL_UI_RADIUS_PX,
                                    border: "1px solid rgba(170,102,255,0.45)",
                                    boxSizing: "border-box",
                                    overflow: "hidden",
                                    flexShrink: 0,
                                  }}
                                >
                                  <div style={{ color: "#b8a0e8", fontSize: "0.72rem", fontWeight: 700 }}>Skills &amp; Artifacts</div>
                                  <div
                                    style={{
                                      display: "flex",
                                      flexWrap: "wrap",
                                      justifyContent: "center",
                                      alignItems: "center",
                                      gap: 6,
                                      minHeight: 28,
                                      width: "100%",
                                    }}
                                  >
                                    {hasSkillRow ? (
                                      <>
                                        {hasShield && (
                                          <CombatSkillItemIcon
                                            mode="toggle"
                                            variant="shield"
                                            selected={combatUseShield}
                                            disabled={rolling}
                                            onClick={() => !rolling && setCombatUseShield((v) => !v)}
                                            title="Shield: tap to use / not use on this roll (blocks damage if you lose)"
                                          />
                                        )}
                                        {hasDiceBonus && (
                                          <CombatSkillItemIcon
                                            mode="toggle"
                                            variant="dice"
                                            selected={combatUseDiceBonus}
                                            disabled={rolling}
                                            onClick={() => !rolling && setCombatUseDiceBonus((v) => !v)}
                                            title="Power: tap to add +1 to this attack roll or skip"
                                          />
                                        )}
                                        {STORED_ARTIFACT_ORDER.map((kind) => {
                                          const n = storedArtifactCount(cp, kind);
                                          if (n <= 0) return null;
                                          if (kind === "dice") {
                                            return (
                                              <CombatSkillItemIcon
                                                key={kind}
                                                mode="consume"
                                                variant="dice"
                                                disabled={rolling}
                                                onClick={() => !rolling && handleUseArtifact("dice")}
                                                title={`${STORED_ARTIFACT_LINE.dice}. ${STORED_ARTIFACT_TOOLTIP.dice}`}
                                                stackCount={n}
                                              />
                                            );
                                          }
                                          if (kind === "shield") {
                                            return (
                                              <CombatSkillItemIcon
                                                key={kind}
                                                mode="consume"
                                                variant="shield"
                                                disabled={rolling}
                                                onClick={() => !rolling && handleUseArtifact("shield")}
                                                title={`${STORED_ARTIFACT_LINE.shield}. ${STORED_ARTIFACT_TOOLTIP.shield}`}
                                                stackCount={n}
                                              />
                                            );
                                          }
                                          const mapTitle = `${STORED_ARTIFACT_LINE[kind]} Locked during combat — use on the map after this fight.`;
                                          return (
                                            <CombatSkillItemIcon
                                              key={kind}
                                              mode="locked"
                                              variant={storedArtifactIconVariant(kind)}
                                              title={mapTitle}
                                              stackCount={n}
                                            />
                                          );
                                        })}
                                      </>
                                    ) : cp && (cp.artifacts ?? 0) > 0 ? (
                                      <span
                                        style={{
                                          fontSize: "0.68rem",
                                          color: "#9a9aaa",
                                          textAlign: "center",
                                          lineHeight: 1.35,
                                          padding: "0 4px",
                                        }}
                                      >
                                        Artifact inventory {(cp.artifacts ?? 0)}/3 — use on the map after this fight
                                      </span>
                                    ) : (
                                      <span
                                        style={{
                                          fontSize: "0.68rem",
                                          color: "#666",
                                          textAlign: "center",
                                          lineHeight: 1.35,
                                          padding: "0 4px",
                                        }}
                                      >
                                        {cp ? "No combat skills or stored artifacts" : "—"}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              );
                            })()}
                          <div
                            style={{
                              width: "100%",
                              maxWidth: 420,
                              height: COMBAT_HINT_STRIP_PX,
                              minHeight: COMBAT_HINT_STRIP_PX,
                              maxHeight: COMBAT_HINT_STRIP_PX,
                              flexShrink: 0,
                              boxSizing: "border-box",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <div
                              role={showCombatHintText ? "alert" : undefined}
                              aria-live={showCombatHintText ? "polite" : undefined}
                              aria-hidden={!showCombatHintText}
                              style={{
                                width: "100%",
                                height: "100%",
                                boxSizing: "border-box",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                padding: "4px 8px",
                                borderRadius: COMBAT_ROLL_UI_RADIUS_PX,
                                overflow: "hidden",
                                border:
                                  combatToast?.style === "secondAttempt"
                                    ? "2px solid rgba(255,204,0,0.75)"
                                    : showCombatHintText
                                      ? "2px solid rgba(255,204,0,0.38)"
                                      : "2px solid transparent",
                                background: showCombatHintText
                                  ? combatToast?.style === "secondAttempt"
                                    ? "rgba(255,204,0,0.15)"
                                    : "rgba(255,204,0,0.08)"
                                  : "rgba(255,204,0,0.04)",
                                color: combatToast?.style === "secondAttempt" ? "#ffcc00" : "#eeccaa",
                                fontSize: combatToast?.style === "secondAttempt" ? "0.86rem" : "0.76rem",
                                fontWeight: combatToast?.style === "secondAttempt" ? 700 : 500,
                                textAlign: "center",
                                lineHeight: 1.28,
                              }}
                            >
                              {showCombatHintText ? (
                                <span
                                  style={{
                                    display: "-webkit-box",
                                    WebkitLineClamp: 2,
                                    WebkitBoxOrient: "vertical" as const,
                                    overflow: "hidden",
                                    wordBreak: "break-word",
                                  }}
                                >
                                  {combatToast
                                    ? combatToast.message
                                    : combatFooterSnapshot
                                      ? combatFooterSnapshot.summary
                                      : lab
                                        ? `💡 ${getMonsterHint(combatState.monsterType, lab?.monsters[combatState.monsterIndex]?.hasShield)}`
                                        : null}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}
            <div style={{ height: combatState ? 8 : 32, flexShrink: 0, minHeight: combatState ? 8 : 32 }} />
            <div
              style={{
                ...combatResultSectionStyle,
                flex: "0 0 auto",
                justifyContent: "flex-start",
                gap: pendingCombatBonusPick && bonusLootRevealed ? 8 : 14,
                width: "100%",
                minHeight: combatResultSlotHeightPx,
                maxHeight: combatResultSlotHeightPx,
                overflow: pendingCombatBonusPick && bonusLootRevealed ? "auto" : "hidden",
                boxSizing: "border-box",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
              }}
            >
            {/* Fixed-height slot: result banner/bonus OR roll controls — never jumps */}
            {combatState ? (
              <div style={{ ...combatRollSectionStyle, flex: 0, width: "100%", justifyContent: "center" }}>
                {(() => {
                  /** Same on all breakpoints: lower dice viewport height 0 until roll; while rolling, Dice3D only in upper Skills/hint slot. */
                  const combatDiceInLowerSlot = !rolling;
                  const combatDiceViewportHidden = !rolling;
                  return (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 0,
                    width: "100%",
                    maxWidth: "100%",
                    minHeight: combatDiceViewportHidden ? 0 : COMBAT_ROLL_ROW_MIN_PX,
                    paddingTop: combatDiceViewportHidden ? 6 : COMBAT_ROLL_ROW_PAD_Y,
                    paddingBottom: combatDiceViewportHidden ? 6 : COMBAT_ROLL_ROW_PAD_Y,
                    paddingLeft: isMobile ? 6 : 8,
                    paddingRight: isMobile ? 6 : 8,
                    boxSizing: "border-box",
                    flexShrink: 0,
                  }}
                >
                  {combatDiceInLowerSlot ? (
                  <div
                    className="combat-dice"
                    onClick={combatDiceViewportHidden ? undefined : handleCombatRollClick}
                    style={{
                      cursor: combatDiceViewportHidden ? "default" : rolling ? "default" : "pointer",
                      width: "100%",
                      maxWidth: 420,
                      alignSelf: "center",
                      minWidth: 0,
                      height: combatDiceViewportHidden
                        ? 0
                        : `clamp(${COMBAT_ROLL_DICE_VIEWPORT_MIN_H}px, min(32vw, 28vh), ${COMBAT_ROLL_DICE_VIEWPORT_MAX_H}px)`,
                      minHeight: combatDiceViewportHidden ? 0 : COMBAT_ROLL_DICE_VIEWPORT_MIN_H,
                      maxHeight: combatDiceViewportHidden ? 0 : COMBAT_ROLL_DICE_VIEWPORT_MAX_H,
                      flexShrink: 0,
                      boxSizing: "border-box",
                      background: combatDiceViewportHidden ? "transparent" : "linear-gradient(145deg, #1a1a24 0%, #0d0d12 100%)",
                      borderRadius: COMBAT_ROLL_UI_RADIUS_PX,
                      overflow: "hidden",
                      display: "flex",
                      flexDirection: "column",
                      border: combatDiceViewportHidden ? "2px solid transparent" : "2px solid #ffcc00",
                      boxShadow: combatDiceViewportHidden ? "none" : "inset 0 0 24px rgba(255,204,0,0.12)",
                      pointerEvents: combatDiceViewportHidden ? "none" : "auto",
                    }}
                  >
                    <div style={{ flex: 1, minHeight: 0, width: "100%", display: "flex", flexDirection: "column" }}>
                      <Dice3D
                        ref={combatDiceRef}
                        onRollComplete={handleCombatRollComplete}
                        disabled={rolling}
                        fitContainer
                        hideHint
                      />
                    </div>
                  </div>
                  ) : (
                    <div style={{ height: 0, overflow: "hidden", flexShrink: 0 }} aria-hidden />
                  )}
                  <div
                    style={{
                      display: "flex",
                      flexDirection: isMobile ? "column" : "row",
                      alignItems: "stretch",
                      justifyContent: "space-between",
                      gap: isMobile ? 8 : 10,
                      width: "100%",
                      maxWidth: isMobile ? undefined : 420,
                      alignSelf: isMobile ? "stretch" : "center",
                      boxSizing: "border-box",
                    }}
                  >
                    <button
                      type="button"
                      onClick={handleCombatRollClick}
                      disabled={rolling}
                      style={{
                        ...buttonStyle,
                        flex: isMobile ? "none" : 1,
                        minWidth: 0,
                        width: isMobile ? "100%" : "auto",
                        boxSizing: "border-box",
                        minHeight: isMobile ? 48 : COMBAT_ROLL_BUTTON_H_PX,
                        padding: "0 clamp(8px, 2vw, 16px)",
                        fontSize: isMobile ? "0.8rem" : "0.85rem",
                        lineHeight: 1.2,
                        background: "#ffcc00",
                        color: "#111",
                        border: "2px solid #cc9900",
                        borderRadius: COMBAT_ROLL_UI_RADIUS_PX,
                        fontWeight: "bold",
                      }}
                    >
                      {rolling ? "Rolling…" : "Roll dice"}
                    </button>
                    <button
                      type="button"
                      onClick={handleRunAway}
                      disabled={rolling || movesLeft <= 0}
                      style={{
                        ...buttonStyle,
                        flex: isMobile ? "none" : 1,
                        minWidth: 0,
                        width: isMobile ? "100%" : "auto",
                        boxSizing: "border-box",
                        minHeight: isMobile ? 48 : COMBAT_ROLL_BUTTON_H_PX,
                        padding: "0 clamp(8px, 2vw, 16px)",
                        fontSize: isMobile ? "0.8rem" : "0.85rem",
                        lineHeight: 1.2,
                        background: movesLeft > 0 ? "#666" : "#444",
                        color: "#fff",
                        border: "1px solid #888",
                        borderRadius: COMBAT_ROLL_UI_RADIUS_PX,
                        opacity: movesLeft > 0 ? 1 : 0.6,
                      }}
                      title={movesLeft > 0 ? "Retreat to previous cell (costs 1 move)" : "No moves left"}
                    >
                      🏃 Run away
                    </button>
                  </div>
                </div>
                  );
                })()}
              </div>
            ) : combatResult ? (
              <>
                {!pendingCombatBonusPick && (
                <div
                  style={{
                    ...combatResultBannerStyle,
                    width: "100%",
                    maxWidth: 400,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 8,
                    borderColor: combatResult.secondAttempt ? "#ffcc00" : (combatResult.draculaWeakened || combatResult.monsterWeakened) ? "#ff6600" : combatResult.monsterEffect === "skeleton_shield" ? "#ffcc00" : combatResult.shieldAbsorbed ? "#44ff88" : combatResult.won ? "#00ff88" : "#ff4444",
                    background: combatResult.secondAttempt ? "rgba(255,204,0,0.2)" : (combatResult.draculaWeakened || combatResult.monsterWeakened) ? "rgba(255,102,0,0.2)" : combatResult.monsterEffect === "skeleton_shield" ? "rgba(255,204,0,0.15)" : combatResult.shieldAbsorbed ? "rgba(68,255,136,0.15)" : combatResult.won ? "rgba(0,255,136,0.22)" : "rgba(255,68,68,0.15)",
                  }}
                >
                  <span
                    style={{
                      color: combatResult.secondAttempt ? "#ffcc00" : (combatResult.draculaWeakened || combatResult.monsterWeakened) ? "#ff6600" : combatResult.monsterEffect === "skeleton_shield" ? "#ffcc00" : combatResult.shieldAbsorbed ? "#44ff88" : combatResult.won ? "#00ff88" : "#ff6666",
                      fontSize: "1rem",
                      fontWeight: "bold",
                      textAlign: "center",
                      lineHeight: 1.3,
                    }}
                  >
                    {combatResult.secondAttempt
                      ? "🎲 Second attempt! Roll again — monster was caught off guard!"
                      : combatResult.draculaWeakened || combatResult.monsterWeakened
                        ? `${getMonsterName(combatResult.monsterType!)} weakened! One more hit!`
                        : combatResult.monsterEffect === "skeleton_shield"
                          ? "💀 Shield broken! Try again next turn."
                          : combatResult.won
                            ? (() => {
                                const primaryParts = [
                                  combatResult.reward?.type === "jump" && "⬆️ +1 jump",
                                  combatResult.reward?.type === "hp" && "❤️ +1 HP",
                                  combatResult.reward?.type === "shield" && "🛡 +1 shield",
                                  combatResult.reward?.type === "attackBonus" && "⚔️ +1 attack",
                                  combatResult.reward?.type === "movement" && "🎯 +1 move",
                                ].filter(Boolean);
                                const bonusParts = [
                                  combatResult.bonusReward?.type === "artifact" &&
                                    `✨ ${formatMonsterBonusRewardLabel({ type: "artifact", amount: combatResult.bonusReward.amount })}`,
                                  combatResult.bonusReward &&
                                    combatResult.bonusReward.type === "bonusMoves" &&
                                    `🎯 +${combatResult.bonusReward.amount} move${combatResult.bonusReward.amount > 1 ? "s" : ""}`,
                                  combatResult.bonusReward?.type === "shield" && "🛡 +1 shield",
                                  combatResult.bonusReward?.type === "jump" && "⬆️ +1 jump",
                                  combatResult.bonusReward?.type === "catapult" && "🎯 +1 catapult",
                                  combatResult.bonusReward?.type === "diceBonus" && "🎲 +1 dice bonus",
                                ].filter(Boolean);
                                if (primaryParts.length || bonusParts.length) {
                                  return `WIN! ${[...primaryParts, ...bonusParts].join("  ") || "Monster defeated!"}`;
                                }
                                return "You are lucky! Monster defeated!";
                              })()
                            : combatResult.playerDefeated
                              ? `You lost! ${getMonsterName(combatResult.monsterType ?? "Z")} wins! Respawned at start (-1 artifact).`
                              : combatResult.shieldAbsorbed
                                ? "🛡 Shield absorbed!"
                                : combatResult.monsterEffect === "ghost_evade"
                                  ? "👻 Attack missed!"
                                  : `✗ -${combatResult.damage} HP`}
                  </span>
                  {combatResult.won && (combatResult.reward || combatResult.bonusReward) && (
                    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 8, marginTop: 4 }}>
                      {combatResult.reward?.type === "jump" && <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }} title="+1 jump"><ArtifactIcon variant="jump" size={40} /><span style={{ fontSize: "0.95rem", fontWeight: 600 }}>+1 jump</span></span>}
                      {combatResult.reward?.type === "hp" && <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }} title="+1 HP"><ArtifactIcon variant="healing" size={40} /><span style={{ fontSize: "0.95rem", fontWeight: 600 }}>+1 HP</span></span>}
                      {combatResult.reward?.type === "shield" && <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }} title="+1 shield"><ArtifactIcon variant="shield" size={40} /><span style={{ fontSize: "0.95rem", fontWeight: 600 }}>+1 shield</span></span>}
                      {combatResult.reward?.type === "attackBonus" && <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }} title="+1 attack"><ArtifactIcon variant="magic" size={40} /><span style={{ fontSize: "0.95rem", fontWeight: 600 }}>+1 attack</span></span>}
                      {combatResult.reward?.type === "movement" && <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }} title="+1 move"><ArtifactIcon variant="catapult" size={40} /><span style={{ fontSize: "0.95rem", fontWeight: 600 }}>+1 move</span></span>}
                      {combatResult.bonusReward?.type === "artifact" && (
                        <span
                          style={{ display: "inline-flex", alignItems: "center", gap: 6, filter: "drop-shadow(0 0 6px rgba(255, 200, 100, 0.8))" }}
                          title={formatMonsterBonusRewardLabel({ type: "artifact", amount: combatResult.bonusReward.amount })}
                        >
                          <ArtifactIcon variant="artifact" size={40} />
                          <span style={{ fontSize: "0.95rem", fontWeight: 600 }}>
                            {formatMonsterBonusRewardLabel({ type: "artifact", amount: combatResult.bonusReward.amount })}
                          </span>
                        </span>
                      )}
                      {combatResult.bonusReward?.type === "bonusMoves" && (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }} title={`+${combatResult.bonusReward.amount} moves`}>
                          <ArtifactIcon variant="dice" size={40} /><span style={{ fontSize: "0.95rem", fontWeight: 600 }}>+{combatResult.bonusReward.amount} move{combatResult.bonusReward.amount > 1 ? "s" : ""}</span>
                        </span>
                      )}
                      {combatResult.bonusReward?.type === "shield" && <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }} title="+1 shield"><ArtifactIcon variant="shield" size={40} /><span style={{ fontSize: "0.95rem", fontWeight: 600 }}>+1 shield</span></span>}
                      {combatResult.bonusReward?.type === "jump" && <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }} title="+1 jump"><ArtifactIcon variant="jump" size={40} /><span style={{ fontSize: "0.95rem", fontWeight: 600 }}>+1 jump</span></span>}
                      {combatResult.bonusReward?.type === "catapult" && <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }} title="+1 catapult charge"><ArtifactIcon variant="catapult" size={40} /><span style={{ fontSize: "0.95rem", fontWeight: 600 }}>+1 catapult</span></span>}
                      {combatResult.bonusReward?.type === "diceBonus" && <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }} title="+1 dice bonus"><ArtifactIcon variant="dice" size={40} /><span style={{ fontSize: "0.95rem", fontWeight: 600 }}>+1 dice bonus</span></span>}
                    </div>
                  )}
                  {combatResult.playerDefeated && (
                    <button
                      type="button"
                      onClick={handleCloseDefeatModal}
                      style={{
                        ...buttonStyle,
                        marginTop: 8,
                        padding: "8px 20px",
                        fontSize: "1rem",
                        fontWeight: "bold",
                        background: "#444",
                        color: "#fff",
                        border: "2px solid #666",
                        borderRadius: 8,
                      }}
                    >
                      Close
                    </button>
                  )}
                </div>
                )}
                {(() => {
                  const pi = combatResult.playerIndex ?? 0;
                  const mt = combatResult.monsterType ?? "Z";
                  const pendingBonus =
                    combatResult.won &&
                    (combatResult.bonusRewardOptions?.length ?? 0) > 0 &&
                    combatResult.bonusRewardApplied !== true;
                  if (!pendingBonus || !bonusLootRevealed) return null;
                  const opts = combatResult.bonusRewardOptions!;
                  const n = opts.length;
                  const idx = Math.max(0, Math.min(bonusLootSelectedIndex, n - 1));
                  const current = opts[idx];
                  return (
                    <div style={combatBonusLootPanelStyle}>
                      <div style={combatBonusLootTitleStyle}>Bonus loot — pick one</div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          width: "100%",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", justifyContent: "center" }}>
                          <button
                            type="button"
                            onClick={() => setBonusLootSelectedIndex((i) => (i - 1 + n) % n)}
                            style={{
                              ...buttonStyle,
                              width: 32,
                              height: 32,
                              padding: 0,
                              borderRadius: "50%",
                              background: "#2a2a2e",
                              color: "#00ffcc",
                              border: "1px solid #00ff8866",
                              fontSize: "1.1rem",
                              flexShrink: 0,
                            }}
                            aria-label="Previous"
                          >
                            ‹
                          </button>
                          <div
                            style={{
                              flex: 1,
                              minWidth: 0,
                              maxWidth: 240,
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "center",
                              gap: 4,
                              padding: "4px 2px",
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => handlePickCombatBonusReward(pi, mt, current)}
                              style={{
                                ...buttonStyle,
                                width: "100%",
                                minHeight: 118,
                                background: "#2a2a2e",
                                color: "#ddd",
                                border: "1px solid #555",
                                borderRadius: 8,
                                padding: "8px 10px",
                                fontWeight: "bold",
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: 5,
                                boxShadow: "0 0 6px rgba(0,0,0,0.3)",
                              }}
                            >
                              <span
                                style={{
                                  display: "inline-flex",
                                  filter: "drop-shadow(0 0 3px rgba(255,255,255,0.15))",
                                }}
                              >
                                {getBonusRewardIcon(current, COMBAT_BONUS_LOOT_ICON_PX)}
                              </span>
                              <span style={{ fontSize: "0.82rem", lineHeight: 1.2 }}>
                                {formatMonsterBonusRewardLabel(current)}
                              </span>
                            </button>
                            <span style={{ fontSize: "0.65rem", color: "#889988", fontWeight: 600 }}>
                              {idx + 1} / {n}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setBonusLootSelectedIndex((i) => (i + 1) % n)}
                            style={{
                              ...buttonStyle,
                              width: 32,
                              height: 32,
                              padding: 0,
                              borderRadius: "50%",
                              background: "#2a2a2e",
                              color: "#00ffcc",
                              border: "1px solid #00ff8866",
                              fontSize: "1.05rem",
                              flexShrink: 0,
                            }}
                            aria-label="Next"
                          >
                            ›
                          </button>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handlePickCombatBonusReward(pi, mt, "skip")}
                        style={{
                          ...buttonStyle,
                          marginTop: 0,
                          width: "100%",
                          background: "#2a2a2e",
                          color: "#888",
                          border: "1px solid #444",
                          borderRadius: 6,
                          fontSize: "0.72rem",
                          padding: "6px 8px",
                        }}
                      >
                        Skip
                      </button>
                    </div>
                  );
                })()}
                {!pendingCombatBonusPick && (
                  <div style={{ fontSize: "0.72rem", color: "#666", marginTop: 12, textAlign: "center" }}>
                    Closing…
                  </div>
                )}
              </>
            ) : null}
            </div>
            {combatState && lab && (() => {
              const [dMin, dMax] = getMonsterDamageRange(combatState.monsterType);
              const atk = lab.players[combatState.playerIndex]?.attackBonus ?? 0;
              return (
                <div style={combatModalFooterDiceStyle}>
                  <div style={combatModalFooterDiceRowStyle}>
                    <span style={combatModalFooterDiceItemStyle}>
                      Defense: {getMonsterDefense(combatState.monsterType)}
                    </span>
                    <span style={combatModalFooterDiceSepStyle}>·</span>
                    <span style={combatModalFooterDiceItemStyle}>
                      Damage: {dMin}–{dMax}
                    </span>
                    {atk > 0 ? (
                      <>
                        <span style={combatModalFooterDiceSepStyle}>·</span>
                        <span style={combatModalFooterDiceItemStyle}>Attack +{atk}</span>
                      </>
                    ) : null}
                    <span style={combatModalFooterDiceSepStyle}>·</span>
                    <span style={{ ...combatModalFooterDiceItemStyle, opacity: 0.9 }}>Roll dice to resolve</span>
                  </div>
                </div>
              );
            })()}
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

      {(bonusAdded !== null ||
        diceBonusApplied !== null ||
        bonusMovesGained !== null ||
        jumpAdded !== null ||
        shieldAbsorbed !== null ||
        shieldGained !== null ||
        healingGained !== null ||
        harmTaken !== null ||
        bombGained !== null ||
        artifactGained !== null ||
        hiddenGemTeleport !== null ||
        torchGained !== null ||
        cellsRevealed !== null ||
        webSlowed !== null ||
        draculaAttacked !== null) &&
        !combatState &&
        !combatResult && (
        <div style={effectToastStyle} className="effect-toast">
          {diceBonusApplied !== null && (
            <span style={{ color: "#ffcc00", display: "inline-flex", alignItems: "center", gap: 6 }}>
              <ArtifactIcon variant="dice" size={20} /> +1 dice bonus applied!
            </span>
          )}
          {bonusMovesGained !== null && (
            <span style={{ color: "#ffcc00", marginLeft: diceBonusApplied !== null ? 12 : 0, display: "inline-flex", alignItems: "center", gap: 6 }}>
              <ArtifactIcon variant="dice" size={20} /> Rolled {bonusMovesGained} — +{bonusMovesGained} moves!
            </span>
          )}
          {bonusAdded !== null && diceResult !== null && (
            <span style={{ color: "#ffcc00", marginLeft: diceBonusApplied ? 12 : 0 }}>×{bonusAdded / diceResult} moves!</span>
          )}
          {webSlowed !== null && (
            <span style={{ color: "#aaaacc", marginLeft: bonusAdded ? 12 : 0, display: "inline-flex", alignItems: "center", gap: 6 }}>
              <ArtifactIcon variant="web" size={20} /> Spider web: costs 2 moves
            </span>
          )}
          {jumpAdded !== null && (
            <span style={{ color: "#66aaff", marginLeft: bonusAdded ? 12 : 0 }}>
              {jumpAdded > 1 ? `×${jumpAdded} jumps!` : `+1 jump!`}
            </span>
          )}
          {shieldAbsorbed !== null && (
            <span style={{ color: "#44ff88", marginLeft: 12, display: "inline-flex", alignItems: "center", gap: 6 }}>
              <ArtifactIcon variant="shield" size={20} /> Shield absorbed attack!
            </span>
          )}
          {harmTaken !== null && (
            <span style={{ color: "#ff4444", fontWeight: "bold" }}>⚠ -1 HP (trap)</span>
          )}
          {shieldGained !== null && (
            <span style={{ color: "#44ff88", marginLeft: 12, display: "inline-flex", alignItems: "center", gap: 6 }}>
              <ArtifactIcon variant="shield" size={20} /> +1 Shield!
            </span>
          )}
          {healingGained !== null && (
            <span style={{ color: "#44ff88", marginLeft: 12, display: "inline-flex", alignItems: "center", gap: 6 }}><ArtifactIcon variant="healing" size={20} /> +1 HP!</span>
          )}
          {draculaAttacked !== null && (
            <span style={{ color: "#ff4444", marginLeft: 12 }}>🧛 Dracula bit you! -1 HP</span>
          )}
          {bombGained !== null && (
            <span style={{ color: "#ff8844", marginLeft: 12, display: "inline-flex", alignItems: "center", gap: 6 }}>
              <ArtifactIcon variant="bomb" size={20} /> +1 Bomb!
            </span>
          )}
          {artifactGained !== null && (
            <span style={{ color: "#aa66ff", marginLeft: 12, display: "inline-flex", alignItems: "center", gap: 6 }}>
              <ArtifactIcon variant={artifactGained === "dice" ? "dice" : artifactGained === "shield" ? "shield" : artifactGained === "teleport" ? "magic" : artifactGained === "reveal" ? "reveal" : "healing"} size={20} />
              +1 {artifactGained === "dice" ? "Dice" : artifactGained === "shield" ? "Shield" : artifactGained === "teleport" ? "Teleport" : artifactGained === "reveal" ? "Reveal" : "Healing"} (stored)!
            </span>
          )}
          {hiddenGemTeleport !== null && (
            <span style={{ color: "#aa66ff", marginLeft: 12, display: "inline-flex", alignItems: "center", gap: 6 }}><ArtifactIcon variant="magic" size={20} /> Hidden gem: Teleport!</span>
          )}
          {torchGained !== null && (
            <span style={{ color: "#ffcc66", marginLeft: 12, display: "inline-flex", alignItems: "center", gap: 6 }}>
              <ArtifactIcon variant="torch" size={20} /> Torch! Fog zones cleared
            </span>
          )}
          {cellsRevealed !== null && (
            <span style={{ color: "#aa66ff", marginLeft: 12, display: "inline-flex", alignItems: "center", gap: 6 }}><ArtifactIcon variant="reveal" size={20} /> {cellsRevealed} hidden cells revealed!</span>
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
              <label>Player names & avatars:</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, width: "100%" }}>
                {Array.from({ length: numPlayers }).map((_, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, flexShrink: 0, maxWidth: AVATAR_PICKER_WRAP_MAX_W }}>
                      {PLAYER_AVATARS.map((av) => (
                        <button
                          key={av}
                          type="button"
                          onClick={() => {
                            setPlayerAvatars((prev) => {
                              const next = prev.length >= numPlayers ? [...prev] : [...prev, ...Array.from({ length: numPlayers - prev.length }, (_, j) => PLAYER_AVATARS[(prev.length + j) % PLAYER_AVATARS.length])];
                              next[i] = av;
                              return next;
                            });
                          }}
                          style={{
                            width: AVATAR_PICKER_BTN_PX,
                            height: AVATAR_PICKER_BTN_PX,
                            padding: 0,
                            fontSize: AVATAR_PICKER_FONT,
                            lineHeight: 1,
                            border: (playerAvatars[i] ?? PLAYER_AVATARS[i % PLAYER_AVATARS.length]) === av ? `2px solid ${PLAYER_COLORS[i] ?? "#00ff88"}` : "1px solid #444",
                            borderRadius: 6,
                            background: (playerAvatars[i] ?? PLAYER_AVATARS[i % PLAYER_AVATARS.length]) === av ? "rgba(0,255,136,0.2)" : "#1a1a24",
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {av}
                        </button>
                      ))}
                    </div>
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

      <div
        style={{
          ...mazeAreaStyle,
          ...(isMobile
            ? {
                paddingBottom: `calc(${MAZE_MARGIN + mobileDockInsetPx + 10}px + env(safe-area-inset-bottom, 0px))`,
              }
            : {}),
        }}
      >
        <div
          style={{
            ...mazeZoomControlsStyle,
            ...(isMobile
              ? {
                  width: "100%",
                  boxSizing: "border-box",
                  justifyContent: "space-between",
                  gap: 8,
                }
              : {}),
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button onClick={() => setMazeZoom((z) => Math.max(0.5, z - 0.25))} style={mazeZoomButtonStyle} title="Zoom out">−</button>
            <span style={{ fontSize: "0.8rem", color: "#888", minWidth: 36, textAlign: "center" }}>{Math.round(mazeZoom * 100)}%</span>
            <button onClick={() => setMazeZoom((z) => Math.min(2, z + 0.25))} style={mazeZoomButtonStyle} title="Zoom in">+</button>
          </div>
          {isMobile && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                flexShrink: 0,
                fontSize: "0.72rem",
                color: "#c4c4d4",
                lineHeight: 1.2,
              }}
            >
              <span title="Moves remaining this turn">Moves {movesLeft}</span>
              <span title="Jump charges">Jumps {cp?.jumps ?? 0}</span>
            </div>
          )}
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

              const monsterIcon = monster ? (
                getMonsterIdleSprite(monster.type) ? (
                  <img
                    key="m"
                    src={getMonsterIdleSprite(monster.type)!}
                    alt={getMonsterName(monster.type)}
                    className="monster-icon"
                    style={{ width: 42, height: 42, objectFit: "contain" }}
                    title={getMonsterName(monster.type)}
                  />
                ) : (
                  <span key="m" className="monster-icon" style={{ fontSize: "2.1rem", lineHeight: 1 }} title={getMonsterName(monster.type)}>
                    {getMonsterIcon(monster.type)}
                  </span>
                )
              ) : null;
              if (monster) cellClass += " path monster";
              const draculaTelegraph = monster?.type === "V" && (monster.draculaState === "telegraphTeleport" || monster.draculaState === "telegraphAttack");
              if (draculaTelegraph) cellClass += " dracula-telegraph";
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
                const avatar = playerAvatars[pi] ?? PLAYER_AVATARS[pi % PLAYER_AVATARS.length];
                const isActive = pi === currentPlayer;
                const playerMarker = (
                  <div
                    className={`marker ${isActive ? "active" : ""} ${isTeleportRise ? "teleport-rise" : ""} ${isJumpLanding ? "jump-landing" : ""}`}
                    style={{
                      ...markerStyle,
                      ...markerStretchStyle,
                      background: "transparent",
                      fontSize: "1.55rem",
                      lineHeight: 1,
                      boxShadow: isActive ? `0 0 8px ${c}, 0 0 12px ${c}` : undefined,
                      border: isActive ? `2px solid ${c}` : "none",
                      ...(isTeleportRise ? { zIndex: 20, position: "relative" as const } : {}),
                    }}
                  >
                    {avatar}
                  </div>
                );
                const dirHintStyle: React.CSSProperties = {
                  position: "absolute",
                  fontSize: "0.7rem",
                  fontWeight: "bold",
                  color: "#00ff88",
                  textShadow: "0 0 4px rgba(0,0,0,1), 0 1px 2px rgba(0,0,0,1)",
                  padding: "2px 4px",
                  borderRadius: 3,
                  background: "rgba(0,0,0,0.85)",
                  border: "1px solid rgba(0,255,136,0.45)",
                  zIndex: 2,
                };
                const dirOffset = 10;
                const dirIndicators = pi === currentPlayer && cp && !moveDisabled && !catapultMode && movesLeft > 0 ? (
                  <span style={{ ...dirHintStyle, top: -dirOffset, left: "50%", transform: "translateX(-50%)" }}>
                    {movesLeft}
                  </span>
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
              const isHidden = lab.hiddenCells.has(`${x},${y}`);
              if (isMultiplierCell(cellType)) {
                const isRevealed = isMultiplierCell(lab.grid[y]?.[x]);
                if (isRevealed || (isHidden && showSecretCells)) {
                  content = `×${cellType}`;
                }
                cellClass += (isRevealed || (isHidden && showSecretCells)) ? " path multiplier mult-x" + cellType : " path";
              } else if (isArtifactCell(cellType)) {
                const isFogged = (fogIntensityMap.get(`${x},${y}`) ?? 0) > 0;
                const showArtifact = !isHidden && !isFogged;
                if (showArtifact) {
                  const kind = storedArtifactKindFromCell(cellType);
                  const title = kind ? `${STORED_ARTIFACT_LINE[kind]}. ${STORED_ARTIFACT_TOOLTIP[kind]}` : "Artifact";
                  content = (
                    <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }} title={title}>
                      {kind ? (
                        <ArtifactIcon variant={storedArtifactIconVariant(kind)} size={42} />
                      ) : (
                        <ArtifactIcon variant="artifact" size={42} />
                      )}
                    </span>
                  );
                }
                cellClass += " path artifact" + (isHidden || isFogged ? " artifact-hidden" : "");
              } else if (isTrapCell(cellType)) {
                {
                  const trap = cellType;
                  content = (
                    <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }} title={trap === TRAP_LOSE_TURN ? "Lose turn" : trap === TRAP_HARM ? "Harm: -1 HP (shield blocks)" : trap === TRAP_TELEPORT ? "Teleport" : "Slow"}>
                      <ArtifactIcon variant="trap" size={42} />
                    </span>
                  );
                }
                cellClass += " path trap";
              } else if (isBombCell(cellType)) {
                {
                  content = (
                    <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }} title="Bomb pickup">
                      <ArtifactIcon variant="bomb" size={36} />
                    </span>
                  );
                }
                cellClass += " path bomb";
              } else if ((showSecretCells || isTeleportOption) && isMagicCell(cellType)) {
                const magicUsed = lab.hasUsedTeleportFrom(currentPlayer, x, y);
                {
                  content = (
                    <span className="hole-cell" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", opacity: magicUsed ? 0.4 : 1 }} title={magicUsed ? "Teleport used" : "Teleport: pick destination"}>
                      <ArtifactIcon variant="magic" size={36} />
                    </span>
                  );
                }
                cellClass += " path magic hole" + (magicUsed ? " artifact-inactive" : "");
              } else if (showSecretCells && isCatapultCell(cellType)) {
                const catapultUsed = lab.hasUsedCatapultFrom(currentPlayer, x, y);
                {
                  content = (
                    <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", opacity: catapultUsed ? 0.4 : 1 }} title={catapultUsed ? "Catapult used" : "Slingshot"}>
                      <ArtifactIcon variant="catapult" size={36} />
                    </span>
                  );
                }
                cellClass += " path catapult" + (catapultUsed ? " artifact-inactive" : "");
              } else if (showSecretCells && isJumpCell(cellType)) {
                content = "J";
                cellClass += " path jump";
              } else if (showSecretCells && isShieldCell(cellType)) {
                content = (
                  <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                    <ArtifactIcon variant="shield" size={36} />
                  </span>
                );
                cellClass += " path shield";
              } else if (showSecretCells && isDiamondCell(cellType)) {
                const owner = getCollectibleOwner(cellType);
                content = (
                  <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                    <ArtifactIcon variant="diamond" size={36} />
                  </span>
                );
                cellClass += " path collectible";
                if (owner !== null) cellClass += " collectible-p" + owner;
                if (owner === currentPlayer) cellClass += " collectible-mine";
              } else {
                cellClass += cellType === "#" ? " wall" : " path";
                if (cellType === "#") content = null;
              }
              }

              if ((fogIntensityMap.get(`${x},${y}`) ?? 0) > 0) content = null;

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
                if (cellClass.includes("artifact-hidden")) {
                  cellBg.background = "#1a1e24";
                  cellBg.boxShadow = "inset 0 0 8px rgba(170,102,255,0.12)";
                } else {
                  cellBg.background = "#1e2e2e";
                  cellBg.color = "#aa66ff";
                  cellBg.fontWeight = "bold";
                }
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
              }
              if (cellClass.includes("dracula-telegraph")) {
                cellBg.boxShadow = "inset 0 0 16px rgba(255,80,80,0.6), 0 0 12px #ff4444";
                cellBg.border = "2px solid #ff4444";
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
              const cellFog = fogIntensityMap.get(`${x},${y}`) ?? 0;
              const cellOpacity = cellFog > 0 ? 1 - 0.75 * cellFog : 1;
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
                    opacity: cellOpacity,
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
                  {defeatedMonsterOnCell?.x === x && defeatedMonsterOnCell?.y === y && (() => {
                    const sprite = getMonsterSprite(defeatedMonsterOnCell.monsterType, "defeated");
                    return sprite ? (
                      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 0, pointerEvents: "none" }}>
                        <img src={sprite} alt={`Defeated ${getMonsterName(defeatedMonsterOnCell.monsterType)}`} style={{ width: 36, height: 36, objectFit: "contain", opacity: 0.9 }} />
                      </div>
                    ) : (
                      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 0, pointerEvents: "none", fontSize: "1.5rem", opacity: 0.8 }}>
                        {getMonsterIcon(defeatedMonsterOnCell.monsterType)}
                </div>
              );
                  })()}
                  {(lab.webPositions?.some(([wx, wy]) => wx === x && wy === y)) && (
                    <div className="spider-web" style={{ position: "absolute", inset: 0, zIndex: 0 }}>
                      <SpiderWebCell />
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
                    const effectiveFog = cellFog;
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
        {/* Fog overlay: per-cell (FOG_GRANULARITY=1) for performance; cleared at player/visited; gradient by player position */}
        {lab && !lab.players.some((p) => p.hasTorch) && (
          <div
            className="fog-overlay"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: lab.width * CELL_SIZE * mazeZoom,
              height: lab.height * CELL_SIZE * mazeZoom,
              display: "grid",
              gridTemplateColumns: `repeat(${lab.width * FOG_GRANULARITY}, 1fr)`,
              gridTemplateRows: `repeat(${lab.height * FOG_GRANULARITY}, 1fr)`,
              pointerEvents: "none",
              zIndex: 40,
            }}
          >
            {(() => {
              const clearedCoords = new Set<string>();
              lab.players.forEach((p, i) => { if (!lab.eliminatedPlayers?.has(i)) clearedCoords.add(`${p.x},${p.y}`); });
              lab.visitedCells?.forEach((k) => clearedCoords.add(k));
              const manhattan = (ax: number, ay: number, bx: number, by: number) => Math.abs(ax - bx) + Math.abs(ay - by);
              const getClearance = (cx: number, cy: number): number => {
                let minDist = FOG_CLEARANCE_RADIUS + 1;
                clearedCoords.forEach((key) => {
                  const [px, py] = key.split(",").map(Number);
                  const d = manhattan(cx, cy, px, py);
                  if (d < minDist) minDist = d;
                });
                return Math.max(0, 1 - minDist / (FOG_CLEARANCE_RADIUS + 0.5));
              };
              const cp = lab.players[currentPlayer];
              const px = cp?.x ?? lab.width / 2;
              const py = cp?.y ?? lab.height / 2;
              const playerOnLeft = px < lab.width / 2;
              const playerOnTop = py < lab.height / 2;
              const getCellFog = (cx: number, cy: number) => {
                if (lab.players.some((p) => p.hasTorch)) return 0;
                const fogIntensity = lab.fogZones?.get(`${cx},${cy}`) ?? 0;
                const clearance = getClearance(cx, cy);
                const isWallCell = lab.getCellAt(cx, cy) === "#";
                const hasAdjacentFog = [[0,-1],[1,0],[0,1],[-1,0]].some(([dx,dy]) => (lab.fogZones?.get(`${cx+dx},${cy+dy}`) ?? 0) > 0);
                const adjacentClearance = isWallCell ? Math.max(0, ...[[0,-1],[1,0],[0,1],[-1,0]].map(([dx,dy]) => {
                  const nx = cx + dx, ny = cy + dy;
                  return (nx >= 0 && nx < lab.width && ny >= 0 && ny < lab.height) ? getClearance(nx, ny) : 0;
                })) : clearance;
                const effectiveClearance = isWallCell ? adjacentClearance : clearance;
                const rawFog = isWallCell ? (hasAdjacentFog ? 1 : 0) : fogIntensity;
                return Math.max(0, rawFog * (1 - effectiveClearance));
              };
              const getGradientFactor = (cx: number, cy: number): number => {
                const hAway = playerOnLeft ? Math.max(0, cx - px) : Math.max(0, px - cx);
                const vAway = playerOnTop ? Math.max(0, cy - py) : Math.max(0, py - cy);
                return (hAway / lab.width + vAway / lab.height) / 2;
              };
              return Array.from({ length: lab.height * FOG_GRANULARITY }).map((_, gy) =>
                Array.from({ length: lab.width * FOG_GRANULARITY }).map((_, gx) => {
                  const mx = Math.floor(gx / FOG_GRANULARITY);
                  const my = Math.floor(gy / FOG_GRANULARITY);
                  const effectiveFog = FOG_GRANULARITY === 1
                    ? getCellFog(mx, my)
                    : (() => {
                        const fx = (gx % FOG_GRANULARITY) / FOG_GRANULARITY;
                        const fy = (gy % FOG_GRANULARITY) / FOG_GRANULARITY;
                        const f00 = getCellFog(mx, my);
                        const f10 = getCellFog(mx + 1, my);
                        const f01 = getCellFog(mx, my + 1);
                        const f11 = getCellFog(mx + 1, my + 1);
                        return f00 * (1 - fx) * (1 - fy) + f10 * fx * (1 - fy) + f01 * (1 - fx) * fy + f11 * fx * fy;
                      })();
                  if (effectiveFog <= 0) return <div key={`${gx}-${gy}`} />;
                  const baseOpacity = 0.15 + effectiveFog * 0.82;
                  const gradientFactor = getGradientFactor(mx, my);
                  const opacity = Math.max(0.12, Math.min(1, baseOpacity + 0.15 * gradientFactor));
                  return (
                    <div
                      key={`${gx}-${gy}`}
                      style={{
                        background: `linear-gradient(135deg, rgba(4,4,14,${opacity}), rgba(2,2,8,${opacity * 0.95}))`,
                        boxShadow: `inset 0 0 6px rgba(0,0,0,${opacity * 0.4})`,
                      }}
                    />
                  );
                })
              );
            })()}
        </div>
        )}
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
        ref={mobileDockRef}
        className="controls-panel unified-bottom-dock"
        style={{
          ...controlsPanelStyle,
          position: "fixed",
          left: "50%",
          transform: "translateX(-50%)",
          bottom: isMobile ? 10 : 16,
          zIndex: 99,
          width: isMobile ? "calc(100vw - 16px)" : "min(432px, calc(100vw - 24px))",
          maxWidth: 432,
          boxSizing: "border-box",
        }}
      >
        {!isMobile && !showMoveGrid && movesLeft > 0 && !combatState && winner === null && (
          <button
            type="button"
            onClick={openMovePadDesktopWithTimer}
            style={{
              ...buttonStyle,
              ...secondaryButtonStyle,
              width: "100%",
              marginBottom: 6,
              fontSize: "0.8rem",
              padding: "6px 10px",
            }}
            title="Show move pad (also opens with arrow keys or after you move)"
          >
            Moves ⌨
          </button>
        )}
        {isMobile ? (
          <div style={{ ...controlsSectionStyle, borderColor: "#554466", marginTop: 0 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                width: "100%",
                marginBottom: mobileDockExpanded ? 2 : 0,
              }}
            >
              <div style={{ ...controlsSectionLabelStyle, color: "#ccb8ff", flex: 1, textAlign: "left" }}>
                {mobileDockExpanded ? "Move & items" : "Artifacts"}
              </div>
              <button
                type="button"
                onClick={() => setMobileDockExpanded((e) => !e)}
                aria-expanded={mobileDockExpanded}
                title={mobileDockExpanded ? "Collapse to artifact strip" : "Expand for moves, bomb & Use"}
                style={{
                  flexShrink: 0,
                  minWidth: 40,
                  minHeight: 36,
                  padding: "4px 10px",
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  color: "#ccb8ff",
                  background: "#25252f",
                  border: "1px solid #554466",
                  borderRadius: 6,
                  cursor: "pointer",
                }}
              >
                {mobileDockExpanded ? "▲" : "▼"}
              </button>
            </div>
            {mobileDockExpanded ? (
              <>
                {showMoveGrid && (
                  <div
                    className="move-buttons"
                    style={{ ...moveButtonsStyle, display: "grid", gridTemplateColumns: "repeat(3, 2.5rem)", gridTemplateRows: "repeat(3, 2.5rem)", gap: 2, alignSelf: "center", margin: "4px auto 0" }}
                  >
                    <button onClick={() => doMove(0, -1, false)} disabled={!canMoveUp} style={{ ...moveButtonStyle, gridColumn: 2, gridRow: 1 }} title="Move up">
                      ↑
                    </button>
                    <button onClick={() => doMove(-1, 0, false)} disabled={!canMoveLeft} style={{ ...moveButtonStyle, gridColumn: 1, gridRow: 2 }} title="Move left">
                      ←
                    </button>
                    <button onClick={() => doMove(1, 0, false)} disabled={!canMoveRight} style={{ ...moveButtonStyle, gridColumn: 3, gridRow: 2 }} title="Move right">
                      →
                    </button>
                    <button onClick={() => doMove(0, 1, false)} disabled={!canMoveDown} style={{ ...moveButtonStyle, gridColumn: 2, gridRow: 3 }} title="Move down">
                      ↓
                    </button>
                  </div>
                )}
                {dockActions.length > 0 ? (
                  <>
                    <div style={{ fontSize: "0.65rem", color: "#777", marginTop: showMoveGrid ? 8 : 4, marginBottom: 6, textAlign: "center" }}>Tap to select · then Use</div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "row",
                        gap: 8,
                        overflowX: "auto",
                        paddingBottom: 4,
                        marginBottom: 8,
                        WebkitOverflowScrolling: "touch",
                      }}
                    >
                      {dockActions.map(({ id, n }) => {
                        const selected = mobileDockAction === id;
                        const bomb = id === "bomb";
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={() => setMobileDockAction(id)}
                            style={{
                              flex: "0 0 auto",
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "center",
                              gap: 4,
                              padding: "8px 12px",
                              borderRadius: 10,
                              border: selected ? "2px solid #00ff88" : "1px solid #444",
                              background: bomb ? "rgba(255,136,68,0.2)" : "rgba(42,42,53,0.95)",
                              color: "#ddd",
                              cursor: "pointer",
                              minWidth: 72,
                            }}
                            title={bomb ? "Bomb" : STORED_ARTIFACT_TOOLTIP[id]}
                          >
                            <ArtifactIcon variant={bomb ? "bomb" : storedArtifactIconVariant(id)} size={26} />
                            <span style={{ fontSize: "0.7rem", fontWeight: 700 }}>
                              {bomb ? "Bomb" : STORED_ARTIFACT_TITLE[id]} ×{n}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      onClick={applyMobileDockSelection}
                      disabled={mobileApplyDisabled}
                      style={{
                        ...buttonStyle,
                        width: "100%",
                        fontSize: "0.9rem",
                        padding: "10px 12px",
                        opacity: mobileApplyDisabled ? 0.45 : 1,
                      }}
                      title={
                        mobileDockAction === "bomb"
                          ? combatState
                            ? "Explode 3×3 (combat)"
                            : "Explode 3×3 (uses 1 move)"
                          : mobileDockAction != null
                            ? STORED_ARTIFACT_TOOLTIP[mobileDockAction]
                            : "Select an item"
                      }
                    >
                      Use{" "}
                      {mobileDockAction === "bomb"
                        ? "bomb"
                        : mobileDockAction != null
                          ? STORED_ARTIFACT_TITLE[mobileDockAction]
                          : "…"}
                    </button>
                  </>
                ) : (
                  <div style={{ color: "#666", fontSize: "0.75rem", textAlign: "center", padding: showMoveGrid ? "8px 0 4px" : "6px 0" }}>No bombs or artifacts</div>
                )}
              </>
            ) : (
              <>
                {(() => {
                  const artifactStripActions = dockActions.filter(
                    (a): a is { id: StoredArtifactKind; n: number } => a.id !== "bomb"
                  );
                  if (artifactStripActions.length > 0) {
                    return (
                      <>
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "row",
                            gap: 8,
                            overflowX: "auto",
                            paddingTop: 4,
                            paddingBottom: 6,
                            width: "100%",
                            WebkitOverflowScrolling: "touch",
                          }}
                        >
                          {artifactStripActions.map(({ id, n }) => {
                            const selected = mobileDockAction === id;
                            return (
                              <button
                                key={id}
                                type="button"
                                onClick={() => setMobileDockAction(id)}
                                style={{
                                  flex: "0 0 auto",
                                  display: "flex",
                                  flexDirection: "column",
                                  alignItems: "center",
                                  gap: 4,
                                  padding: "8px 12px",
                                  borderRadius: 10,
                                  border: selected ? "2px solid #00ff88" : "1px solid #444",
                                  background: "rgba(42,42,53,0.95)",
                                  color: "#ddd",
                                  cursor: "pointer",
                                  minWidth: 72,
                                }}
                                title={STORED_ARTIFACT_TOOLTIP[id]}
                              >
                                <ArtifactIcon variant={storedArtifactIconVariant(id)} size={26} />
                                <span style={{ fontSize: "0.7rem", fontWeight: 700 }}>
                                  {STORED_ARTIFACT_TITLE[id]} ×{n}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                        <button
                          type="button"
                          onClick={applyMobileDockSelection}
                          disabled={mobileApplyDisabled}
                          style={{
                            ...buttonStyle,
                            width: "100%",
                            fontSize: "0.85rem",
                            padding: "8px 12px",
                            opacity: mobileApplyDisabled ? 0.45 : 1,
                          }}
                          title={
                            mobileDockAction != null && mobileDockAction !== "bomb"
                              ? STORED_ARTIFACT_TOOLTIP[mobileDockAction]
                              : "Select an artifact"
                          }
                        >
                          Use{" "}
                          {mobileDockAction != null && mobileDockAction !== "bomb"
                            ? STORED_ARTIFACT_TITLE[mobileDockAction]
                            : "…"}
                        </button>
                      </>
                    );
                  }
                  return (
                    <div style={{ color: "#666", fontSize: "0.75rem", textAlign: "center", padding: "8px 4px 4px", lineHeight: 1.35 }}>
                      No artifacts here — tap ▼ to open moves, bomb &amp; full list.
                    </div>
                  );
                })()}
              </>
            )}
          </div>
        ) : (
          <>
            {showMoveGrid && (
              <div style={{ ...controlsSectionStyle, marginTop: 0 }}>
                <div style={controlsSectionLabelStyle}>Move</div>
                <div
                  className="move-buttons"
                  style={{ ...moveButtonsStyle, display: "grid", gridTemplateColumns: "repeat(3, 2.5rem)", gridTemplateRows: "repeat(3, 2.5rem)", gap: 2, alignSelf: "center", margin: "0 auto" }}
                >
                  <button onClick={() => doMove(0, -1, false)} disabled={!canMoveUp} style={{ ...moveButtonStyle, gridColumn: 2, gridRow: 1 }} title="Move up">
                    ↑
                  </button>
                  <button onClick={() => doMove(-1, 0, false)} disabled={!canMoveLeft} style={{ ...moveButtonStyle, gridColumn: 1, gridRow: 2 }} title="Move left">
                    ←
                  </button>
                  <button onClick={() => doMove(1, 0, false)} disabled={!canMoveRight} style={{ ...moveButtonStyle, gridColumn: 3, gridRow: 2 }} title="Move right">
                    →
                  </button>
                  <button onClick={() => doMove(0, 1, false)} disabled={!canMoveDown} style={{ ...moveButtonStyle, gridColumn: 2, gridRow: 3 }} title="Move down">
                    ↓
                  </button>
                </div>
              </div>
            )}

            <div style={{ ...controlsSectionStyle, borderColor: "#554466", marginTop: showMoveGrid ? 6 : 0 }}>
              <div style={{ ...controlsSectionLabelStyle, color: "#ccb8ff" }}>Bomb &amp; artifacts</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {(cp?.bombs ?? 0) > 0 && (
                <button
                  type="button"
                  onClick={handleUseBomb}
                  disabled={bombUseDisabled}
                  style={{
                    ...buttonStyle,
                    padding: "4px 8px",
                    fontSize: "0.8rem",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "flex-start",
                    gap: 6,
                    width: "100%",
                    background: "#ff8844",
                    color: "#fff",
                    opacity: bombUseDisabled ? 0.45 : 1,
                  }}
                  title={combatState ? "Explode 3×3 to clear monster (no move cost)" : "Explode 3×3 area (uses 1 move)"}
                >
                  <ArtifactIcon variant="bomb" size={14} />
                  <span style={{ flex: 1, textAlign: "left" }}>
                    Bomb: {cp?.bombs ?? 0}
                  </span>
                </button>
              )}
              {STORED_ARTIFACT_ORDER.map((kind) => {
                const n = storedArtifactCount(cp, kind);
                if (n <= 0) return null;
                const accent = STORED_ARTIFACT_BUTTON_STYLE[kind];
                const mapOnlyLocked = inCombatDock && isStoredArtifactMapOnly(kind);
                const healFull = kind === "healing" && (cp?.hp ?? DEFAULT_PLAYER_HP) >= DEFAULT_PLAYER_HP;
                const cantReveal = kind === "reveal" && peekRevealBatchSize(lab, totalDiamondsDock) <= 0;
                const disabled = !cp || mapOnlyLocked || healFull || cantReveal;
                return (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => handleUseArtifact(kind)}
                    disabled={disabled}
                    style={{
                      ...buttonStyle,
                      padding: "4px 8px",
                      fontSize: "0.8rem",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "flex-start",
                      gap: 6,
                      width: "100%",
                      background: accent.background,
                      color: accent.color,
                      opacity: disabled ? 0.45 : 1,
                    }}
                    title={
                      mapOnlyLocked
                        ? `${STORED_ARTIFACT_TOOLTIP[kind]} (not during combat)`
                        : healFull
                          ? "Already at full HP"
                          : cantReveal
                            ? "Nothing hidden to reveal right now"
                            : STORED_ARTIFACT_TOOLTIP[kind]
                    }
                  >
                    <ArtifactIcon variant={storedArtifactIconVariant(kind)} size={14} />
                    <span style={{ flex: 1, textAlign: "left" }}>
                      {STORED_ARTIFACT_TITLE[kind]}: {n}
                    </span>
                  </button>
                );
              })}
              {(cp?.bombs ?? 0) <= 0 && !STORED_ARTIFACT_ORDER.some((k) => storedArtifactCount(cp, k) > 0) && (
                <div style={{ color: "#666", fontSize: "0.75rem" }}>None</div>
              )}
              </div>
            </div>
          </>
        )}

        <button
          onClick={endTurn}
          className="secondary"
          disabled={winner !== null || !!catapultPicker || !!teleportPicker}
          style={{ ...buttonStyle, ...secondaryButtonStyle, marginTop: 8, width: "100%" }}
        >
          End turn
        </button>
        {error && <div className="error" style={errorStyle}>{error}</div>}
      </div>
        </div>
        </div>

      {/* Dice modal: root level so it isn’t clipped by mainContent overflow; shown until this turn’s roll completes */}
      {showDiceModal &&
        !combatState &&
        !combatResult &&
        winner === null &&
        lab &&
        movesLeft <= 0 &&
        diceResult === null && (
          <div style={{ ...modalOverlayStyle, zIndex: DICE_MODAL_Z }} onClick={(e) => e.stopPropagation()}>
            <div style={movementDiceModalPanelStyle} onClick={(e) => e.stopPropagation()}>
              <h3
                style={{
                  margin: "0 0 0.35rem 0",
                  color: "#00ff88",
                  fontSize: "clamp(1.2rem, 3.2vw, 1.75rem)",
                  fontWeight: 800,
                  textAlign: "center",
                  letterSpacing: "0.02em",
                }}
              >
                {playerNames[currentPlayer] ?? `Player ${currentPlayer + 1}`} — Roll for moves
              </h3>
              <p style={{ margin: "0 0 1.25rem 0", color: "#8a8a9a", fontSize: "0.92rem", textAlign: "center", lineHeight: 1.4 }}>
                Click the 3D dice area or use the button below
              </p>
              <div
                role="button"
                tabIndex={0}
                onClick={() => !rolling && diceRef.current?.roll()}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === " ") && !rolling) {
                    e.preventDefault();
                    diceRef.current?.roll();
                  }
                }}
                style={{
                  cursor: rolling ? "default" : "pointer",
                  width: "100%",
                  height: `clamp(${MOVEMENT_DICE_VIEWPORT_MIN_H}px, 38vh, ${MOVEMENT_DICE_VIEWPORT_MAX_H}px)`,
                  minHeight: MOVEMENT_DICE_VIEWPORT_MIN_H,
                  maxHeight: MOVEMENT_DICE_VIEWPORT_MAX_H,
                  borderRadius: 14,
                  overflow: "hidden",
                  border: "2px solid rgba(255, 204, 0, 0.35)",
                  boxSizing: "border-box",
                  background: "#0a0a0f",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
                  <Dice3D
                    ref={diceRef}
                    onRollComplete={handleMovementRollComplete}
                    disabled={rolling}
                    fitContainer
                    hideHint
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => !rolling && diceRef.current?.roll()}
                disabled={rolling}
                style={{
                  ...buttonStyle,
                  alignSelf: "center",
                  marginTop: 20,
                  padding: "14px 40px",
                  fontSize: "1.08rem",
                  fontWeight: 800,
                  minWidth: 220,
                  borderRadius: 10,
                  border: "2px solid #00cc66",
                  boxShadow: "0 0 24px rgba(0,255,136,0.35)",
                }}
              >
                {rolling ? "Rolling…" : "Roll dice"}
              </button>
            </div>
          </div>
        )}

      {winner !== null && (
        <div style={gameOverOverlayStyle} onClick={(e) => e.stopPropagation()}>
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
  padding:
    "max(12px, env(safe-area-inset-top, 0px)) max(12px, env(safe-area-inset-right, 0px)) max(12px, env(safe-area-inset-bottom, 0px)) max(12px, env(safe-area-inset-left, 0px))",
  boxSizing: "border-box",
  overflow: "auto",
};

const startModalStyle: React.CSSProperties = {
  background: "#1a1a24",
  padding: "2.5rem 2.75rem",
  borderRadius: 14,
  border: "1px solid #333",
  boxShadow: "0 0 40px rgba(0,255,136,0.15)",
  minWidth: 0,
  maxWidth: 620,
  width: "min(calc(100vw - 24px), 620px)",
  boxSizing: "border-box",
  margin: "0 auto",
};

const startModalTitleStyle: React.CSSProperties = {
  margin: "0 0 0.35rem 0",
  color: "#00ff88",
  fontSize: "2.1rem",
  fontWeight: "bold",
  textAlign: "center",
  letterSpacing: 4,
};

const startModalSubtitleStyle: React.CSSProperties = {
  margin: "0 0 1.75rem 0",
  color: "#888",
  fontSize: "1rem",
  textAlign: "center",
};

const startModalFormStyle: React.CSSProperties = {
  marginBottom: "1.5rem",
};

const startModalLabelStyle: React.CSSProperties = {
  color: "#aaa",
  fontSize: "0.92rem",
  minWidth: 140,
};

const startModalLabelStyleMobile: React.CSSProperties = {
  color: "#aaa",
  fontSize: "0.88rem",
  minWidth: 0,
  width: "100%",
};

const startModalSelectStyle: React.CSSProperties = {
  padding: "0.5rem 0.75rem",
  fontSize: "0.95rem",
  fontFamily: "inherit",
  background: "#2a2a35",
  border: "1px solid #444",
  color: "#c0c0c0",
  borderRadius: 6,
  flex: 1,
};

const startModalInputStyle: React.CSSProperties = {
  padding: "0.5rem 0.75rem",
  fontSize: "0.95rem",
  fontFamily: "inherit",
  background: "#2a2a35",
  border: "1px solid #444",
  color: "#c0c0c0",
  borderRadius: 6,
  width: "4.5rem",
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
  zIndex: 1220,
  paddingLeft: "max(8px, env(safe-area-inset-left, 0px))",
  paddingRight: "max(8px, env(safe-area-inset-right, 0px))",
  paddingTop: "max(8px, env(safe-area-inset-top, 0px))",
  paddingBottom: "max(8px, env(safe-area-inset-bottom, 0px))",
  boxSizing: "border-box",
};

/** Movement roll overlay — below combat, above maze/main content */
const DICE_MODAL_Z = 1180;
/** Large movement dice modal — wide panel + tall 3D viewport */
const MOVEMENT_DICE_MODAL_MIN_W = 520;
const MOVEMENT_DICE_MODAL_MAX_W = 720;
const MOVEMENT_DICE_VIEWPORT_MIN_H = 260;
const MOVEMENT_DICE_VIEWPORT_MAX_H = 420;

const movementDiceModalPanelStyle: React.CSSProperties = {
  background: "linear-gradient(180deg, #1e1e2a 0%, #14141c 100%)",
  padding: "2rem clamp(1.25rem, 4vw, 2.75rem)",
  borderRadius: 16,
  border: "2px solid rgba(0, 255, 136, 0.35)",
  boxShadow: "0 0 48px rgba(0,255,136,0.18), 0 20px 60px rgba(0,0,0,0.55)",
  display: "flex",
  flexDirection: "column",
  alignItems: "stretch",
  width: `min(96vw, ${MOVEMENT_DICE_MODAL_MAX_W}px)`,
  minWidth: `min(94vw, ${MOVEMENT_DICE_MODAL_MIN_W}px)`,
  maxWidth: MOVEMENT_DICE_MODAL_MAX_W,
  boxSizing: "border-box",
};

const combatModalStyle: React.CSSProperties = {
  background: "linear-gradient(180deg, #1e1e2a 0%, #16161e 100%)",
  padding: "0.5rem clamp(0.45rem, 2.5vw, 0.75rem) 0.4rem",
  borderRadius: 16,
  border: "3px solid #ffcc00",
  boxShadow: "0 0 60px rgba(255,204,0,0.4), inset 0 0 40px rgba(0,0,0,0.3)",
  width: `min(${COMBAT_MODAL_WIDTH}px, calc(100vw - 16px))`,
  minWidth: 0,
  maxWidth: "100%",
  height: COMBAT_MODAL_HEIGHT,
  maxHeight: "94vh",
  overflowX: "hidden",
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  boxSizing: "border-box",
};

const combatModalTitleStyle: React.CSSProperties = {
  margin: "0 0 0.1rem 0",
  color: "#ffcc00",
  fontSize: "1.05rem",
  fontWeight: "bold",
  textAlign: "center",
  flexShrink: 0,
  width: "100%",
};

/** Face-off grid — HP directly under portraits; smaller sprite row saves vertical space */
const combatModalVersusGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 28px minmax(0, 1fr)",
  gridTemplateRows: "minmax(24px, auto) 220px auto minmax(12px, auto) auto auto",
  alignItems: "stretch",
  alignContent: "start",
  columnGap: 6,
  rowGap: 0,
  marginTop: 0,
  width: "100%",
  maxWidth: 480,
  marginLeft: "auto",
  marginRight: "auto",
  padding: "0 4px",
  overflow: "visible",
};

/** HP track with strong bottom edge (underline look) */
const combatHpBarUnderlineTrack: React.CSSProperties = {
  width: "100%",
  maxWidth: 200,
  height: 9,
  background: "rgba(20,20,28,0.95)",
  borderRadius: 2,
  borderBottom: "3px solid #5a5a6a",
  overflow: "hidden",
  boxSizing: "content-box",
  paddingBottom: 1,
};

const combatRollSectionStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  width: "100%",
  maxWidth: "100%",
  boxSizing: "border-box",
  padding: "0 2px",
  gap: 4,
};

const combatResultSectionStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  width: "100%",
  gap: 8,
};

const combatResultBannerStyle: React.CSSProperties = {
  padding: "0.5rem 1rem",
  borderRadius: 8,
  border: "2px solid",
  fontSize: "0.95rem",
};

/** Win-only bonus loot picker — compact carousel */
const combatBonusLootPanelStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 320,
  flexShrink: 0,
  marginTop: 2,
  marginBottom: 2,
  padding: "8px 10px 10px",
  borderRadius: 8,
  border: "1px solid #00ff8866",
  background: "linear-gradient(180deg, rgba(0,40,30,0.55) 0%, rgba(10,25,20,0.9) 100%)",
  boxShadow: "0 0 12px rgba(0,255,136,0.12), inset 0 1px 0 rgba(255,255,255,0.04)",
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
  justifyContent: "flex-start",
  gap: 6,
};

const combatBonusLootTitleStyle: React.CSSProperties = {
  color: "#00ffcc",
  fontWeight: "bold",
  textAlign: "center",
  fontSize: "0.76rem",
  marginBottom: 0,
  letterSpacing: "0.04em",
};

/** Tiny dice breakdown pinned to bottom of combat modal */
const combatModalFooterDiceStyle: React.CSSProperties = {
  width: "100%",
  flexShrink: 0,
  paddingTop: 6,
  marginTop: 0,
  borderTop: "1px solid #333",
  fontSize: "0.72rem",
  color: "#888",
  lineHeight: 1.45,
  textAlign: "center",
};

const combatModalFooterDiceRowStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "row",
  flexWrap: "wrap",
  alignItems: "center",
  justifyContent: "center",
  gap: "4px 10px",
  width: "100%",
};

const combatModalFooterDiceItemStyle: React.CSSProperties = {
  whiteSpace: "nowrap",
  fontVariantNumeric: "tabular-nums",
};

const combatModalFooterDiceSepStyle: React.CSSProperties = {
  color: "#555",
  userSelect: "none",
  flexShrink: 0,
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
  /** Above per-cell fog (50), fog overlay (40), catapult preview (≤15), and bottom dock (99) while scrolling the maze. */
  zIndex: 200,
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
  width: 34,
  height: 34,
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
