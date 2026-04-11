"use client";

/** Combat debug logging — traces full encounter flow in the browser console ([COMBAT] prefix). */
const COMBAT_LOG = true;
const combatLog = (message: string, ...args: unknown[]) => {
  if (!COMBAT_LOG) return;
  if (args.length === 0) {
    console.log("[COMBAT]", message);
    return;
  }
  console.log("[COMBAT]", message, ...args);
};

/**
 * When `true`, movement pool stays unlimited — no movement dice modal after each step.
 * Use this so single-player does not re-open the movement dice after every 1-move roll.
 * Set to `false` for classic finite moves (roll once, then spend until empty).
 */
const TEMP_INFINITE_MOVES = true;
const INFINITE_MOVES_POOL = 999_999;

const ISO_MINIMAP_ZOOM_BASELINE = 1;
/** Default zoom so the dock minimap starts readable on desktop (still adjustable with − / +, pinch, or wheel). */
const ISO_MINIMAP_ZOOM_INITIAL = 1.42;
const ISO_MINIMAP_ZOOM_MIN = 0.65;
const ISO_MINIMAP_ZOOM_MAX = 2.75;
/** Slightly larger steps so scroll-wheel zoom feels responsive (non-passive listener below). */
const ISO_MINIMAP_ZOOM_STEP = 0.18;

type MovementDiceTransition = {
  movesLeftRef: { current: number };
  setMovesLeft: (v: number | ((p: number) => number)) => void;
  setDiceResult: (v: number | null) => void;
  setShowDiceModal: (v: boolean) => void;
  setRolling: (v: boolean) => void;
};

function grantInfiniteMovesIfTemp(t: MovementDiceTransition): boolean {
  if (!TEMP_INFINITE_MOVES) return false;
  t.movesLeftRef.current = INFINITE_MOVES_POOL;
  t.setMovesLeft(INFINITE_MOVES_POOL);
  t.setDiceResult(INFINITE_MOVES_POOL);
  t.setShowDiceModal(false);
  t.setRolling(false);
  return true;
}

/** After the active player index is set: infinite pool or open roll modal. */
function showMovementDiceOrInfinite(t: MovementDiceTransition): void {
  if (grantInfiniteMovesIfTemp(t)) return;
  t.movesLeftRef.current = 0;
  t.setMovesLeft(0);
  t.setDiceResult(null);
  t.setShowDiceModal(true);
  t.setRolling(false);
}

/** Start menu + loading screen art (`public/menu/`) */
const START_MENU_COVER_BG = "./menu/dracula-cover-bg.png";
/** Transparent PNG title label (used in start menu, header, and preloaded with cover). */
const GAME_TITLE_LABEL_SRC = "./menu/dice-of-the-damned-label.png";
/** Title / logo reds (gradient ~#ff9867 → #8e2215) — menu chrome + selection */
const START_MENU_ACCENT_BRIGHT = "#ff9867";
const START_MENU_BORDER = "rgba(221, 95, 54, 0.55)";
const START_MENU_BORDER_MUTE = "rgba(160, 65, 48, 0.45)";
const START_MENU_SELECTED_FILL = "rgba(221, 95, 54, 0.2)";
const START_MENU_CTRL_BG = "#1a1214";
/** In-game header + metadata-aligned display name */
const GAME_DISPLAY_TITLE = "Dice Of The Damned";
/** 1×1 transparent GIF — 2D combat fallback when GLB fails and no sprite path exists (3D still mounts). */
const COMBAT_3D_FALLBACK_TRANSPARENT_PX =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type Ref,
  type RefObject,
  type SetStateAction,
} from "react";
import { flushSync, createPortal } from "react-dom";
import dynamic from "next/dynamic";
import {
  getMonsterGltfPath,
  isMonster3DEnabled,
  PLAYER_3D_GLB,
  getPlayer3DGlb,
  mapIsoCombatPlayerAnimCue,
  playerStrikeVariantFromDice,
} from "@/lib/monsterModels3d";
import {
  NO_PLAYER_ARMOUR_GLB as NO_ARMOUR_SENTINEL,
  PLAYER_OFFHAND_ARMOUR_GLB_OPTIONS as OFFHAND_ARMOUR_OPTIONS,
  PLAYER_WEAPON_GLB_OPTIONS as WEAPON_OPTIONS,
} from "@/lib/playerArmourGlbs";
import {
  COMBAT_FACEOFF_APPROACH_DURATION_MS,
  resolveCombat3dClipLeads,
} from "@/lib/combat3dContact";
import { combatFaceoff3dCanvasHeightDesktopPx } from "@/lib/combat3dFaceoffViewport";
import Dice3D, { Dice3DRef } from "@/components/Dice3D";
import MazeIsoView, {
  type CatapultTrajectoryPreviewFn,
  type MazeIsoViewImperativeHandle,
} from "@/components/MazeIsoView";

const CombatScene3D = dynamic(
  () => import("@/components/MonsterModel3D").then((m) => m.CombatScene3D),
  { ssr: false }
);
import {
  ArtifactIcon,
  artifactCombatSkillAccent,
  type ArtifactIconVariant,
} from "@/components/ArtifactIcon";
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
  getMonsterDamage,
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
  isStoredArtifactMazePhaseOnly,
  isStoredArtifactCombatPhaseOnly,
  isWeaponStrikeArtifactKind,
  isDefenderStrikeArtifactKind,
  type MonsterType,
  type StoredArtifactKind,
  DEFAULT_PLAYER_HP,
  canShareGridForDoMoveStep,
  cloneLabyrinthForDoMove,
  playerStepWouldSucceed,
} from "@/lib/labyrinth";
import { MULTIPLAYER_ENABLED } from "@/lib/gameEnv";
import { ARTIFACT_KIND_VISUAL_GLB } from "@/lib/storedArtifactGlbs";
import { MAZE_WORLD_FEATURE_BOMB_GLB, mazeWorldFeatureGlbUrl } from "@/lib/mazeIsoWorldPickups";
import {
  adjacentWallFogFromIntensityMap,
  basePathStyle,
  classicFlatMazeCellBackground,
  MAZE_FLOOR_MUD_TEXTURE,
  MAZE_FLOOR_TEXTURE,
  MAZE_LITE_TEXTURES,
  MAZE_NOISE_TEXTURE,
  MAZE_STAIN_TEXTURES,
  MAZE_WALL_TEXTURE,
  mazeCorridorLightAngleDeg,
  pathFloorWallLightCount,
  pathFogVisualIntensity,
  wallStyleWithOptionalSconce,
} from "@/lib/mazeCellTheme";
import { publicAssetPath } from "@/lib/publicAssetPath";
import { applyMazeSimplexNoiseToElement } from "@/lib/mazeProceduralNoise";
import {
  resolveCombat,
  computeCombatHpExchangeRaw,
  computeNetHpLoss,
  getMonsterHint,
  getMonsterBonusRewardChoices,
  getSurpriseDefenseModifier,
  getMonsterReward,
  type CombatResult,
  type MonsterSurpriseState,
  type MonsterReward,
  type MonsterBonusReward,
  type StrikeTarget,
} from "@/lib/combatSystem";
import { drawEvent, applyEvent } from "@/lib/eventDeck";
import { applyDraculaTeleport, applyDraculaAttack } from "@/lib/draculaAI";

/** Log each fresh maze session — grep console for `[NEW_GAME]`. Set `false` to silence. */
const NEW_GAME_LOG = true;

function newGameLog(event: string, details: Record<string, unknown>): void {
  if (!NEW_GAME_LOG) return;
  console.log("[NEW_GAME]", event, details);
}

/** Cheap fingerprint so two reports can tell if the same grid was loaded (not cryptographically strong). */
function mazeGridFingerprint(lab: Labyrinth): string {
  let h = 0;
  const ym = Math.min(lab.height, 48);
  const xm = Math.min(lab.width, 48);
  for (let y = 0; y < ym; y++) {
    const row = lab.grid[y];
    if (!row) continue;
    for (let x = 0; x < xm; x++) {
      const c = row[x]?.charCodeAt(0) ?? 0;
      h = (Math.imul(31, h) + c) | 0;
    }
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Serializable snapshot of a `Labyrinth` right after generate/load — for bug traces. */
function buildMazeSessionLogPayload(lab: Labyrinth, extra: Record<string, unknown> = {}): Record<string, unknown> {
  let wallCells = 0;
  for (let y = 0; y < lab.height; y++) {
    const row = lab.grid[y];
    if (!row) continue;
    for (let x = 0; x < lab.width; x++) {
      if (row[x] === "#") wallCells++;
    }
  }
  const pathishCells = lab.width * lab.height - wallCells;
  return {
    ts: new Date().toISOString(),
    env:
      typeof process !== "undefined" && process.env?.NODE_ENV === "production" ? "production" : "development",
    multiplayerUiEnabled: MULTIPLAYER_ENABLED,
    gridFingerprint: mazeGridFingerprint(lab),
    maze: {
      width: lab.width,
      height: lab.height,
      goal: { x: lab.goalX, y: lab.goalY },
      wallCells,
      pathishCells,
      round: lab.round,
      currentRound: lab.currentRound,
      numPlayers: lab.numPlayers,
      monsterDensity: lab.monsterDensity,
      firstMonsterType: lab.firstMonsterType,
      extraPaths: lab.extraPaths,
    },
    monsters: lab.monsters.map((m, i) => ({
      i,
      type: m.type,
      pos: { x: m.x, y: m.y },
      hp: m.hp,
      patrolWaypointCount: m.patrolArea?.length ?? 0,
      ...(m.type === "V"
        ? {
            draculaState: m.draculaState,
            targetPlayerIndex: m.targetPlayerIndex,
          }
        : {}),
    })),
    players: lab.players.map((p, i) => ({
      i,
      pos: { x: p.x, y: p.y },
      hp: p.hp,
      shield: p.shield,
      jumps: p.jumps,
      artifacts: p.artifacts,
    })),
    eliminatedSeatIndexes: [...lab.eliminatedPlayers],
    webCells: lab.webPositions?.length ?? 0,
    hiddenCells: lab.hiddenCells?.size ?? 0,
    fogZoneCells: lab.fogZones?.size ?? 0,
    visitedCellCount: lab.visitedCells?.size ?? 0,
    ...extra,
  };
}

/** Deep-enough clone for Dracula scheduled actions — keeps round/counters in sync with other lab updates. */
function cloneLabSnapshotForDracula(prev: Labyrinth): Labyrinth {
  const next = new Labyrinth(prev.width, prev.height, 0, prev.numPlayers, prev.monsterDensity, prev.firstMonsterType);
  next.grid = prev.grid.map((r) => [...r]);
  next.players = prev.players.map((p) => ({ ...p }));
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
  return next;
}

/** Match `resolveCombat` effective defence for UI (landscape info panel). */
function getEffectiveDefenseToHit(
  monsterType: MonsterType,
  skeletonHasShield: boolean | undefined,
  surpriseModifier: number
): number {
  const monsterDefense = getMonsterDefense(monsterType);
  const skeletonArmorDefense =
    monsterType === "K" ? (skeletonHasShield ? 0 : 2) : monsterDefense;
  const rawDefense = Math.max(0, skeletonArmorDefense + surpriseModifier);
  return monsterType === "K" && !skeletonHasShield ? Math.max(2, rawDefense) : rawDefense;
}

function getLandscapeCombatInfoRows(args: {
  monsterType: MonsterType;
  skeletonHasShield: boolean | undefined;
  surpriseState: MonsterSurpriseState;
}): { label: string; value: string }[] {
  const { monsterType, skeletonHasShield, surpriseState } = args;
  const baseDef = getMonsterDefense(monsterType);
  const surpriseMod = getSurpriseDefenseModifier(surpriseState);
  const eff = getEffectiveDefenseToHit(monsterType, skeletonHasShield, surpriseMod);
  const md = getMonsterDamage(monsterType);
  const isAggressive = surpriseState === "attack" || surpriseState === "angry";
  const counterBonus = isAggressive ? (surpriseState === "angry" ? 2 : 1) : 0;
  const missHp = md + counterBonus;
  const hp = getMonsterMaxHp(monsterType);
  const stanceLabel =
    surpriseState === "idle"
      ? "Idle"
      : surpriseState === "hunt"
        ? "Hunt"
        : surpriseState === "attack"
          ? "Attack"
          : "Angry";
  const rows: { label: string; value: string }[] = [
    { label: "Defence (table)", value: String(baseDef) },
    { label: "Surprise", value: `${stanceLabel} (${surpriseMod >= 0 ? "+" : ""}${surpriseMod})` },
    { label: "To hit (attack ≥)", value: String(eff) },
    { label: "Monster HP", value: String(hp) },
    {
      label: "Hit on you (miss)",
      value: `${missHp} HP (${md} base${counterBonus ? ` +${counterBonus} Attack/Angry` : ""})`,
    },
  ];
  if (monsterType === "K") {
    rows.splice(1, 0, {
      label: "Shield",
      value: skeletonHasShield ? "Yes — first clean hit breaks it (no HP)" : "No — bones use defence row",
    });
  }
  return rows;
}

function releaseDraculaTelegraphIfPending(lab: Labyrinth, mi: number): void {
  const d = lab.monsters[mi];
  if (d?.type === "V" && (d.draculaState === "telegraphTeleport" || d.draculaState === "telegraphAttack")) {
    d.draculaState = "hunt";
  }
}

/**
 * Snap continuous iso camera bearing (`atan2(z,x)` in degrees + 90, see `MazeIsoView`) to a grid step N/E/S/W.
 * Used so joystick ↑/→ match “into the view” / “right on screen” instead of a stale `playerFacing` basis.
 */
function cardinalGridFromIsoBearingDeg(bearingDeg: number): { dx: number; dy: number } {
  const θ = ((bearingDeg - 90) * Math.PI) / 180;
  const wx = Math.cos(θ);
  const wz = Math.sin(θ);
  if (Math.abs(wx) >= Math.abs(wz)) {
    return { dx: wx >= 0 ? 1 : -1, dy: 0 };
  }
  return { dx: 0, dy: wz >= 0 ? 1 : -1 };
}

/**
 * ↑/↓/←/→ and WASD / joystick: forward/back/left/right from the walk basis (`playerFacing`).
 * On 3D iso, walk basis follows live camera bearing when available (see `walkFacingMap` below).
 * Strafe moves no longer overwrite facing (see `doMove` `updateFacing`).
 */
function getRelativeDirectionsFromFacing(
  playerIndex: number,
  facingMap: Record<number, { dx: number; dy: number }>
): {
  forward: { dx: number; dy: number };
  backward: { dx: number; dy: number };
  left: { dx: number; dy: number };
  right: { dx: number; dy: number };
} {
  const activeFacing = facingMap[playerIndex] ?? { dx: 0, dy: 1 };
  const sdx = Math.sign(activeFacing.dx || 0);
  const sdy = Math.sign(activeFacing.dy || 0);
  const facing =
    sdx === 0 && sdy === 0
      ? { dx: 0, dy: 1 }
      : Math.abs(sdx) >= Math.abs(sdy)
        ? { dx: sdx, dy: 0 }
        : { dx: 0, dy: sdy };
  const forward = { dx: facing.dx, dy: facing.dy };
  const backward = { dx: -facing.dx, dy: -facing.dy };
  const left = { dx: facing.dy, dy: -facing.dx };
  const right = { dx: -facing.dy, dy: facing.dx };
  return { forward, backward, left, right };
}

const CELL_SIZE = 44;
/** Viewport at or below this width: hide sidebar, bottom dock = mobile (select + Use). */
const MOBILE_BREAKPOINT_PX = 768;
/** Phone landscape often exceeds MOBILE_BREAKPOINT width — same mobile chrome as portrait when height is short. */
const MOBILE_LANDSCAPE_MAX_HEIGHT_PX = 520;

function matchesMobileLayout(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`).matches ||
    window.matchMedia(
      `(orientation: landscape) and (max-height: ${MOBILE_LANDSCAPE_MAX_HEIGHT_PX}px)`
    ).matches
  );
}

/** 3D iso immersive layer — above header chrome; below movement dice / modals that use higher z-index. */
const ISO_IMMERSIVE_Z = 10000;
const ISO_IMMERSIVE_HUD_Z = 10050;
/** Victory / game-over — above immersive 3D, movement dice, combat, and settings so it is never hidden. */
const GAME_OVER_OVERLAY_Z = 10200;
/** Full-screen 3D HUD: same outer size for minimap+orbit and move ring (touch targets, all viewports). */
const ISO_HUD_MOVE_RING_PX = 168;
/** Desktop windowed 3D: shared `bottom` for minimap, move ring, and center dock so all HUD bottoms line up on the WebGL host. */
const DESKTOP_ISO_WINDOWED_HUD_BOTTOM = "max(10px, env(safe-area-inset-bottom, 0px))";
const ISO_HUD_JOYSTICK_PAD_PX = Math.round(112 * (ISO_HUD_MOVE_RING_PX / 196));
const ISO_HUD_KNOB_MAX_PX = Math.round(36 * (ISO_HUD_MOVE_RING_PX / 196));
const ISO_HUD_KNOB_HANDLE_PX = Math.round(44 * (ISO_HUD_MOVE_RING_PX / 196));
const ISO_HUD_KNOB_ICON_PX = Math.round(22 * (ISO_HUD_MOVE_RING_PX / 196));
/** Joystick: no move below this radius (px). */
const MOVE_KNOB_DEAD_PX = Math.max(6, Math.round(10 / 1.5));
/** Legacy inner ring radius when `onJoystickLookGrid` is passed (unused in move+map HUD). */
const MOVE_KNOB_LOOK_RING_OUTER_PX = Math.max(12, Math.round(26 / 1.5));
/** Full deflection → fastest step repeat (75% slower max rate than legacy 88ms ≈ 4× interval). */
const MOVE_KNOB_REPEAT_MS_FAST = 352;
/** Just past dead zone → slowest repeat. */
const MOVE_KNOB_REPEAT_MS_SLOW = 400;
/** After first step, wait this long before auto-repeat starts (hold = “delayed” repeat from center). */
const MOVE_KNOB_HOLD_DELAY_MS = 160;
/** Drag band between mini map disc and compass (tuned so inner map stays large vs joystick for same outer diameter). */
const MINIMAP_ORBIT_RING_PX = 15;
/** Space outside orbit for N/E/S/W labels and ticks (fixed = global map north). */
const MINIMAP_COMPASS_PAD_PX = 9;
/** Extra orbit sensitivity when dragging the mini-map ring (vs canvas drag). */
const MINIMAP_ORBIT_POINTER_SENS = 5.6;
/** Yaw on the ring uses tangential Δangle × radius; boost so small arcs still spin the view quickly. */
const MINIMAP_ORBIT_TANGENTIAL_BOOST = 1.8;
/** Minimum inner map disc when outer is locked to joystick diameter. */
const MINIMAP_INNER_DISC_MIN_PX = 46;
/** Phone landscape 3D: larger outer touch ring; inner mini-map stays same size as at `ISO_HUD_MOVE_RING_PX`. */
const MOBILE_LANDSCAPE_ISO_HUD_OUTER_PX = 206;
/** Inner map disc for that baseline (168 − 2×orbit − 2×compass pad). */
const MOBILE_LANDSCAPE_MINIMAP_INNER_DISC_PX =
  ISO_HUD_MOVE_RING_PX - 2 * MINIMAP_ORBIT_RING_PX - 2 * MINIMAP_COMPASS_PAD_PX;
/** Thicker green orbit band on phone landscape (easier to drag). */
const MINIMAP_ORBIT_RING_PX_MOBILE_LANDSCAPE = 26;

/** Mobile 3D (non-immersive): fixed WebGL layer; header / zoom strip / docks use higher z-index. */
const MOBILE_ISO_CANVAS_Z = 90;

/** Full-screen play: fixed top-left “island” — same z stack family as other immersive HUD. */
const PLAY_FULLSCREEN_ISLAND_Z = ISO_IMMERSIVE_HUD_Z + 25;

function getFullscreenElement(): Element | null {
  if (typeof document === "undefined") return null;
  const d = document as Document & {
    webkitFullscreenElement?: Element | null;
    mozFullScreenElement?: Element | null;
    msFullscreenElement?: Element | null;
  };
  return (
    document.fullscreenElement ??
    d.webkitFullscreenElement ??
    d.mozFullScreenElement ??
    d.msFullscreenElement ??
    null
  );
}

async function requestFullscreenOnElement(el: HTMLElement): Promise<void> {
  const anyEl = el as HTMLElement & {
    requestFullscreen?: () => Promise<void>;
    webkitRequestFullscreen?: () => void;
    webkitRequestFullScreen?: () => void;
    mozRequestFullScreen?: () => void;
    msRequestFullscreen?: () => void;
  };
  if (anyEl.requestFullscreen) {
    await anyEl.requestFullscreen();
    return;
  }
  if (anyEl.webkitRequestFullscreen) {
    anyEl.webkitRequestFullscreen();
    return;
  }
  if (anyEl.webkitRequestFullScreen) {
    anyEl.webkitRequestFullScreen();
    return;
  }
  if (anyEl.mozRequestFullScreen) {
    anyEl.mozRequestFullScreen();
    return;
  }
  if (anyEl.msRequestFullscreen) {
    anyEl.msRequestFullscreen();
    return;
  }
  throw new Error("fullscreen unsupported");
}

/**
 * iOS / iPadOS (all WebKit-based browsers there): programmatic element fullscreen is missing or unreliable,
 * and `fullscreenElement` often stays null. Use the fixed “immersive” shell instead of the Fullscreen API.
 */
function isIosLikeFullscreenHost(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  if (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) return true;
  return false;
}

async function exitDocumentFullscreen(): Promise<void> {
  if (typeof document === "undefined") return;
  if (!getFullscreenElement()) return;
  const d = document as Document & {
    webkitExitFullscreen?: () => void;
    webkitCancelFullScreen?: () => void;
    mozCancelFullScreen?: () => void;
    msExitFullscreen?: () => void;
  };
  /** Browsers reject when the document is not active (tab unfocused, embedded, etc.). */
  const safe = async (run: () => void | Promise<void>) => {
    try {
      await run();
    } catch {
      /* ignore */
    }
  };
  if (document.exitFullscreen) {
    await safe(() => document.exitFullscreen!());
    return;
  }
  if (d.webkitExitFullscreen) {
    await safe(() => d.webkitExitFullscreen!());
    return;
  }
  if (d.webkitCancelFullScreen) {
    await safe(() => d.webkitCancelFullScreen!());
    return;
  }
  if (d.mozCancelFullScreen) {
    await safe(() => d.mozCancelFullScreen!());
    return;
  }
  if (d.msExitFullscreen) {
    await safe(() => d.msExitFullscreen!());
  }
}

/**
 * Portal wrapper: when native fullscreen is active on a specific element,
 * render children inside that element so they remain visible in the
 * browser's fullscreen viewport.  Falls back to inline rendering.
 */
function FullscreenPortal({
  children,
  target,
}: {
  children: React.ReactNode;
  target: HTMLElement | null;
}) {
  return target ? createPortal(children, target) : <>{children}</>;
}

/** Mobile dock collapsed: thin strip height (swipe up to expand). */
const MOBILE_DOCK_COLLAPSED_H = 40;
/** Swipe threshold (px) to trigger expand/collapse. */
const MOBILE_DOCK_SWIPE_THRESHOLD = 48;
/** Compact move pad cell size (floating overlay). */
const MOBILE_MOVE_PAD_CELL_PX = 36;
/** Reserve space when scrolling the maze so the pawn isn’t left under the fixed ↑←→↓ pad (3×3 grid + gaps + padding + border). */
const MOBILE_MOVE_PAD_SCROLL_PADDING_RIGHT_PX = MOBILE_MOVE_PAD_CELL_PX * 3 + 2 * 2 + 8 * 2 + 12;
/** Compact artifact chip min width. */
const MOBILE_ARTIFACT_CHIP_W = 56;
type MobileDockAction = "bomb" | "catapultCharge" | StoredArtifactKind;

/** Let catapult / teleport visuals finish before turn change or clearing flight overlay */
const SPECIAL_MOVE_SETTLE_MS = 2000;
/** Pause before switching to the next player so the final pawn position on the maze is visible */
const TURN_CHANGE_PAUSE_MS = 1000;
/** Player + monster portraits in combat header */
const COMBAT_FACEOFF_SPRITE_PX = 180;
/** Merged Meshy 3D combat canvas (Dracula + skeleton) — wider + taller viewport for root-motion clips. */
const COMBAT_DRACULA_3D_VIEWPORT_W = 400;
const COMBAT_DRACULA_3D_VIEWPORT_H = 460;
/** Player portrait in combat modal — matches monster column height */
const COMBAT_PLAYER_AVATAR_PX = 180;
/** Combat attack row: buttons row height — compact to leave room for 3D animation. */
const COMBAT_ROLL_BUTTON_H_PX = 38;
/** Lower strip never shows a tall dice viewport (dice is 0px idle or upper slot while rolling) — keep 0 to avoid a blank 112px gap while rolling. */
const COMBAT_ROLL_ROW_MIN_PX = 0;
const COMBAT_ROLL_ROW_PAD_Y = 3;
/** 3D dice viewport: full modal width; height range so WebGL canvas scales (avoid 120px fallback in Dice3D) */
const COMBAT_ROLL_DICE_VIEWPORT_MIN_H = 140;
const COMBAT_ROLL_DICE_VIEWPORT_MAX_H = 220;
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
/** Unicode d6 faces for “last strike roll” hint (index = value − 1) */
const COMBAT_STRIKE_DICE_FACE_CHARS = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"] as const;

/** Footer / toast line when the player took HP damage on a failed strike (Dracula: bite). */
function formatMonsterCounterattackDamageLine(
  monsterType: MonsterType,
  missDmg: number,
  afterGlancing: boolean
): string {
  if (missDmg <= 0) return "";
  if (monsterType === "V") {
    return `🦇 Dracula bit you — ${missDmg} HP lost! `;
  }
  return `You took ${missDmg} HP (monster hit on miss${afterGlancing ? ", after glancing" : ""}). `;
}

/**
 * Staggered 3D lab commit shows pre-strike HP in bars first; without this, `draculaHurtHp` flips after flush and
 * `MonsterModel3D` restarts the same hurt clip (double animation). Used for merged Meshy rigs (Dracula + skeleton).
 */
function draculaPlayerHitHurt3dFooterExtra(
  monsterType: MonsterType,
  strikePortrait: CombatStrikePortrait,
  hpAfterStrike: number,
  maxHp: number
): { draculaHurt3dHp?: { hp: number; maxHp: number } } {
  if (
    (monsterType !== "V" &&
      monsterType !== "K" &&
      monsterType !== "Z" &&
      monsterType !== "G" &&
      monsterType !== "S" &&
      monsterType !== "L") ||
    (strikePortrait !== "playerHit" && strikePortrait !== "playerHitHeavy")
  ) {
    return {};
  }
  return { draculaHurt3dHp: { hp: hpAfterStrike, maxHp: maxHp } };
}

/** Auto-dismiss durations — single effect uses toast.seq so overlapping timers never clear a newer toast */
const COMBAT_TOAST_AUTO_DISMISS_MS: Record<"hint" | "footer", number> = {
  hint: 3500,
  footer: 4000,
};

/**
 * When 3D combat portraits are on: defer `setLab` (HP / shields / defeat) until after strike pose plays,
 * so bars and maze state match the animation.
 */
const COMBAT_STRIKE_LAB_COMMIT_DELAY_MS = 1180;
const COMBAT_STRIKE_LAB_COMMIT_DELAY_MS_MERGED_MESHY_3D = 3200;

/** 2D combat portraits only need short pose beats between rolls (`MonsterModel3D` uses mixer `finished` when 3D is on). */
const COMBAT_RECOVERY_HURT_MS_2D = 450;
const COMBAT_RECOVERY_RECOVER_MS_2D = 550;
/** Post-win banner: 2D short beat before "defeated" pose. */
const COMBAT_VICTORY_HURT_TO_DEFEATED_MS_2D = 1400;
/** Drop duplicate Three.js `finished` / restart bursts so we do not skip the recover phase in one frame. */
const COMBAT_3D_CLIP_FINISH_DEBOUNCE_MS = 120;

/** Combat sprites never scale — prevents layout jumping. */
/** Combat modal max width on large screens; narrows with viewport on mobile */
const COMBAT_MODAL_WIDTH = 840;
/** Wider combat panel in phone landscape so dice + portraits fit in one row. */
const COMBAT_MODAL_WIDTH_LANDSCAPE_PX = 920;
/** Landscape face-off: portrait size in the versus row (player + monster); center column is dice/skills. */
const COMBAT_LANDSCAPE_SPRITE_PX = 172;
/** Landscape center column: dice viewport + skills panel share this min height budget */
const COMBAT_LANDSCAPE_CENTER_DICE_MAX_H = 128;
/** Wider clamp so dice/skills use horizontal space between portraits (vw-heavy: short landscape height no longer caps width as aggressively as min(32vw,40vh)) */
const COMBAT_LANDSCAPE_CENTER_COL_WIDTH = "clamp(160px, min(44vw, 56vh), 340px)";
/** No `vh` in the middle term — short landscape height must not narrow the dice reroll dialog. */
const COMBAT_LANDSCAPE_CENTER_COL_WIDTH_REROLL = "clamp(160px, 44vw, 340px)";
const COMBAT_LANDSCAPE_CENTER_COL_MAX_W = "min(64vw, 400px)";
/** Combat modal uses maxHeight only so it fits viewport; no fixed height. */
/** Bonus loot carousel — icon fits inside a fixed slot so the pick button does not resize per asset */
const COMBAT_BONUS_LOOT_ICON_PX = 96;
/** Icon slot + padding + ~2 lines of label — stable height when swiping options */
const COMBAT_BONUS_LOOT_PICK_MIN_HEIGHT_PX = COMBAT_BONUS_LOOT_ICON_PX + 36;
/** Bottom panel: roll/run, defeat banner, win summary, or bonus loot. */
const COMBAT_MODAL_RESULT_SLOT_PX = 0;
const FOG_GRANULARITY = 1; // 1 = per-cell (performant); 8 = fine-grained but heavy DOM
const FOG_CLEARANCE_RADIUS = 4; // Manhattan cells: larger halo so iso fog/torches read ahead of the tile you stand on
/** Fixed layout slot for bomb/artifact icons — chip/button size stays tied to this, not to visual scale */
const BOTTOM_DOCK_INVENTORY_ICON_SLOT_PX = 42;
/** Larger drawn art inside the slot (CSS transform; does not expand the chip container) */
const BOTTOM_DOCK_INVENTORY_ICON_VISUAL_SCALE = 1.32;
const BOTTOM_DOCK_INVENTORY_CHIP_MIN_WIDTH = 84;
/** Magic / gem teleport picker — enough candidates; must match open-portal button. */
const MAGIC_TELEPORT_PICKER_OPTIONS = 20;
/** If the destination picker stays open this long without a tap — only when you still have moves left (not last move). Last move: no auto-pick. */
const MAGIC_TELEPORT_PICK_IDLE_MS = 5000;

/** Spider web: 2D grid / artifact icon — same asset as `ArtifactIcon` web variant */
const SPIDER_WEB_SPRITE = "artifacts/spider web.PNG";

function storedArtifactCount(
  p:
    | {
        artifactDice?: number;
        artifactShield?: number;
        artifactTeleport?: number;
        artifactReveal?: number;
        artifactHealing?: number;
        artifactTorch?: number;
        artifactHolySword?: number;
        artifactHolyCross?: number;
        artifactDragonFuryAxe?: number;
        artifactEternalFrostblade?: number;
        artifactZweihandhammer?: number;
        artifactAzureDragonShield?: number;
        artifactNordicShield?: number;
        artifactWardShield?: number;
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
    case "torch":
      return p.artifactTorch ?? 0;
    case "holySword":
      return p.artifactHolySword ?? 0;
    case "holyCross":
      return p.artifactHolyCross ?? 0;
    case "dragonFuryAxe":
      return p.artifactDragonFuryAxe ?? 0;
    case "eternalFrostblade":
      return p.artifactEternalFrostblade ?? 0;
    case "zweihandhammer":
      return p.artifactZweihandhammer ?? 0;
    case "azureDragonShield":
      return p.artifactAzureDragonShield ?? 0;
    case "nordicShield":
      return p.artifactNordicShield ?? 0;
    case "wardShield":
      return p.artifactWardShield ?? 0;
  }
}

/** Stored stacks the combat Skills row may offer (excludes maze-phase-only kinds). */
function hasCombatVisibleStoredArtifacts(
  p: Parameters<typeof storedArtifactCount>[0]
): boolean {
  if (!p) return false;
  return STORED_ARTIFACT_ORDER.some(
    (k) => !isStoredArtifactMazePhaseOnly(k) && storedArtifactCount(p, k) > 0
  );
}

/** Off-hand shield GLB: explicit picker slot, else unspent shield artifacts (starter shield visible on player). */
function playerOffhandArmourGltfEffective(
  player: Parameters<typeof storedArtifactCount>[0],
  pickedSlot: string | undefined
): string | null {
  if (pickedSlot && pickedSlot !== NO_ARMOUR_SENTINEL) return pickedSlot;
  if (player && storedArtifactCount(player, "shield") > 0) {
    return ARTIFACT_KIND_VISUAL_GLB.shield ?? null;
  }
  return null;
}

function dockActionIconVariant(id: MobileDockAction): ArtifactIconVariant {
  if (id === "bomb") return "bomb";
  if (id === "catapultCharge") return "catapult";
  return storedArtifactIconVariant(id);
}

function storedArtifactIconVariant(kind: StoredArtifactKind): ArtifactIconVariant {
  if (kind === "teleport") return "magic";
  if (kind === "torch") return "torch";
  if (kind === "holySword") return "holySword";
  if (kind === "holyCross") return "holyCross";
  if (kind === "dragonFuryAxe") return "dragonFuryAxe";
  if (kind === "eternalFrostblade") return "eternalFrostblade";
  if (kind === "zweihandhammer") return "zweihandhammer";
  if (kind === "azureDragonShield") return "azureDragonShield";
  if (kind === "nordicShield") return "nordicShield";
  if (kind === "wardShield") return "wardShield";
  return kind as ArtifactIconVariant;
}

/** Lose one stored artifact on defeat (priority = STORED_ARTIFACT_ORDER). */
function decrementOneStoredArtifactSlot(p: {
  artifacts?: number;
  artifactsCollected?: string[];
  artifactDice?: number;
  artifactShield?: number;
  artifactTeleport?: number;
  artifactReveal?: number;
  artifactHealing?: number;
  artifactTorch?: number;
  artifactHolySword?: number;
  artifactHolyCross?: number;
  artifactDragonFuryAxe?: number;
  artifactEternalFrostblade?: number;
  artifactZweihandhammer?: number;
  artifactAzureDragonShield?: number;
  artifactNordicShield?: number;
  artifactWardShield?: number;
}): void {
  for (const k of STORED_ARTIFACT_ORDER) {
    if (storedArtifactCount(p, k) <= 0) continue;
    switch (k) {
      case "dice":
        p.artifactDice = Math.max(0, (p.artifactDice ?? 0) - 1);
        break;
      case "shield":
        p.artifactShield = Math.max(0, (p.artifactShield ?? 0) - 1);
        break;
      case "teleport":
        p.artifactTeleport = Math.max(0, (p.artifactTeleport ?? 0) - 1);
        break;
      case "reveal":
        p.artifactReveal = Math.max(0, (p.artifactReveal ?? 0) - 1);
        break;
      case "healing":
        p.artifactHealing = Math.max(0, (p.artifactHealing ?? 0) - 1);
        break;
      case "torch":
        p.artifactTorch = Math.max(0, (p.artifactTorch ?? 0) - 1);
        break;
      case "holySword":
        p.artifactHolySword = Math.max(0, (p.artifactHolySword ?? 0) - 1);
        break;
      case "holyCross":
        p.artifactHolyCross = Math.max(0, (p.artifactHolyCross ?? 0) - 1);
        break;
      case "dragonFuryAxe":
        p.artifactDragonFuryAxe = Math.max(0, (p.artifactDragonFuryAxe ?? 0) - 1);
        break;
      case "eternalFrostblade":
        p.artifactEternalFrostblade = Math.max(0, (p.artifactEternalFrostblade ?? 0) - 1);
        break;
      case "zweihandhammer":
        p.artifactZweihandhammer = Math.max(0, (p.artifactZweihandhammer ?? 0) - 1);
        break;
      case "azureDragonShield":
        p.artifactAzureDragonShield = Math.max(0, (p.artifactAzureDragonShield ?? 0) - 1);
        break;
      case "nordicShield":
        p.artifactNordicShield = Math.max(0, (p.artifactNordicShield ?? 0) - 1);
        break;
      case "wardShield":
        p.artifactWardShield = Math.max(0, (p.artifactWardShield ?? 0) - 1);
        break;
    }
    p.artifacts = Math.max(0, (p.artifacts ?? 0) - 1);
    break;
  }
}

/** Icon art scaled up inside a fixed slot so Bomb & artifacts chip min width/height stay unchanged */
function BottomDockInventoryIcon({ variant }: { variant: ArtifactIconVariant }) {
  const slot = BOTTOM_DOCK_INVENTORY_ICON_SLOT_PX;
  return (
    <div
      style={{
        width: slot,
        height: slot,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          transform: `scale(${BOTTOM_DOCK_INVENTORY_ICON_VISUAL_SCALE})`,
          transformOrigin: "center center",
        }}
      >
        <ArtifactIcon variant={variant} size={slot} />
      </div>
    </div>
  );
}

/**
 * Rotation (deg) shared by player-centered minimap (CSS applies the negated angle) and compass ticks so N/S/E/W
 * stay aligned with maze north while the ▲ stays upright.
 */
function isoMinimapMapRotationDeg(
  bearingAngleDeg: number | null,
  playerFacing: Record<number, { dx: number; dy: number }>,
  currentPlayer: number,
): number {
  const activeFacing = playerFacing[currentPlayer] ?? { dx: 0, dy: 1 };
  const len = Math.hypot(activeFacing.dx, activeFacing.dy) || 1;
  const activeFacingAngleDeg =
    (Math.atan2(activeFacing.dy / len, activeFacing.dx / len) * 180) / Math.PI + 90;
  return bearingAngleDeg != null ? bearingAngleDeg : activeFacingAngleDeg;
}

/** Same 2D grid mini map as the iso bottom dock (− / % / +, wheel & pinch zoom, fog, ▲ facing). */
function IsoDockGridMiniMap({
  lab,
  currentPlayer,
  playerFacing,
  fogIntensityMap,
  playerCells,
  isoMiniMapZoom,
  setIsoMiniMapZoom,
  isoMiniMapPinchStartRef,
  onOpenGrid,
  clipDiameter,
  /** Move-HUD disc: player stays centered; map rotates so facing points up (no separate ▲ rotation). */
  playerCenteredRotate = false,
  /** Touch 3D: when set, map rotation follows camera “into view” bearing (smooth orbit); else player facing only. */
  bearingAngleDeg,
  /** Landscape orbit HUD: hide − / % / + and block wheel/pinch zoom on this instance only. */
  hideZoomChrome = false,
}: {
  lab: Labyrinth;
  currentPlayer: number;
  playerFacing: Record<number, { dx: number; dy: number }>;
  fogIntensityMap: Map<string, number>;
  playerCells: Record<string, number>;
  isoMiniMapZoom: number;
  setIsoMiniMapZoom: Dispatch<SetStateAction<number>>;
  isoMiniMapPinchStartRef: MutableRefObject<{ distance: number; zoom: number } | null>;
  onOpenGrid: () => void;
  /** Square size; circular clip applied by parent. Overrides default 140px height. */
  clipDiameter?: number;
  playerCenteredRotate?: boolean;
  bearingAngleDeg?: number | null;
  hideZoomChrome?: boolean;
}) {
  const miniMapWheelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (hideZoomChrome) return;
    const el = miniMapWheelRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const direction = -Math.sign(e.deltaY);
      if (direction === 0) return;
      setIsoMiniMapZoom((z) =>
        Math.max(ISO_MINIMAP_ZOOM_MIN, Math.min(ISO_MINIMAP_ZOOM_MAX, z + direction * ISO_MINIMAP_ZOOM_STEP)),
      );
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [hideZoomChrome, setIsoMiniMapZoom]);

  const boxInner = clipDiameter != null ? clipDiameter - 14 : null;
  const miniCellBase =
    boxInner != null
      ? Math.max(2, Math.min(12, Math.floor(Math.min(boxInner / lab.width, boxInner / lab.height))))
      : Math.max(3, Math.min(12, Math.floor(Math.min(200 / lab.width, 140 / lab.height))));
  const miniCell = Math.max(clipDiameter != null ? 2 : 3, Math.min(26, Math.round(miniCellBase * isoMiniMapZoom)));
  const activeFacing = playerFacing[currentPlayer] ?? { dx: 0, dy: 1 };
  const activeFacingLen = Math.hypot(activeFacing.dx, activeFacing.dy) || 1;
  const activeFacingAngleDeg =
    (Math.atan2(activeFacing.dy / activeFacingLen, activeFacing.dx / activeFacingLen) * 180) / Math.PI + 90;
  const mapRotationDeg = isoMinimapMapRotationDeg(bearingAngleDeg ?? null, playerFacing, currentPlayer);
  const curPl = lab.players[currentPlayer];
  const playerGX = curPl?.x ?? 0;
  const playerGY = curPl?.y ?? 0;
  const gridW = lab.width * miniCell;
  const gridH = lab.height * miniCell;
  const playerCenterPx = (playerGX + 0.5) * miniCell;
  const playerCenterPy = (playerGY + 0.5) * miniCell;

  const renderMiniMapGrid = () => (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${lab.width}, ${miniCell}px)`,
        gridTemplateRows: `repeat(${lab.height}, ${miniCell}px)`,
        position: "relative",
        boxShadow: "0 0 0 1px rgba(255,255,255,0.08)",
      }}
    >
      {Array.from({ length: lab.height }).map((_, y) =>
        Array.from({ length: lab.width }).map((_, x) => {
          const cellType = lab.grid[y]?.[x] ?? "#";
          const isWallCell = cellType === "#";
          const rawCellFog = fogIntensityMap.get(`${x},${y}`) ?? 0;
          const walkableForFloor = isWalkable(cellType);
          const adjacentWallFog = walkableForFloor
            ? adjacentWallFogFromIntensityMap(lab, x, y, fogIntensityMap)
            : undefined;
          const wallLightCount = walkableForFloor ? pathFloorWallLightCount(lab, x, y, adjacentWallFog) : 0;
          const cellFogVisual = walkableForFloor ? pathFogVisualIntensity(rawCellFog, wallLightCount) : rawCellFog;
          const corridorLightDeg = mazeCorridorLightAngleDeg(lab, x, y);
          const bg: React.CSSProperties = MAZE_LITE_TEXTURES
            ? classicFlatMazeCellBackground(isWallCell ? "cell wall" : "cell path", { isTeleportOption: false })
            : isWallCell
              ? wallStyleWithOptionalSconce(miniCell, x, y, lab)
              : basePathStyle(miniCell, corridorLightDeg, lab, x, y, rawCellFog, adjacentWallFog);
          const monster = lab.monsters.find((m) => m.x === x && m.y === y);
          const pi = playerCells[`${x},${y}`];
          const showPlayer = pi !== undefined && !lab.eliminatedPlayers.has(pi);
          const isHiddenCell = lab.hiddenCells.has(`${x},${y}`);
          const showArtifactDot =
            !isWallCell &&
            !isHiddenCell &&
            rawCellFog <= 0 &&
            isArtifactCell(cellType) &&
            !monster &&
            !showPlayer;
          return (
            <div
              key={`mini-${x}-${y}`}
              style={{
                width: miniCell,
                height: miniCell,
                position: "relative",
                ...bg,
              }}
            >
              {monster && (
                <span
                  style={{
                    position: "absolute",
                    left: "50%",
                    top: "50%",
                    transform: "translate(-50%, -50%)",
                    width: Math.max(3, miniCell * 0.46),
                    height: Math.max(3, miniCell * 0.46),
                    borderRadius: "50%",
                    background: "#ff4f4f",
                    border: "1px solid rgba(40,0,0,0.45)",
                    boxShadow: "0 0 6px rgba(255,80,80,0.85)",
                    zIndex: 3,
                  }}
                />
              )}
              {showPlayer && (
                <span
                  style={{
                    position: "absolute",
                    left: "50%",
                    top: "50%",
                    transform: "translate(-50%, -50%)",
                    width: Math.max(4, miniCell * 0.68),
                    height: Math.max(4, miniCell * 0.68),
                    borderRadius: "50%",
                    background: pi === currentPlayer ? "#00ff88" : "#6fb8ff",
                    border:
                      pi === currentPlayer ? "2px solid rgba(6,40,24,0.85)" : "1px solid rgba(12,28,48,0.75)",
                    boxShadow:
                      pi === currentPlayer
                        ? "0 0 8px rgba(0,255,136,0.95), 0 0 2px rgba(0,0,0,0.6)"
                        : "0 0 6px rgba(100,180,255,0.7)",
                    zIndex: 4,
                  }}
                />
              )}
              {showPlayer && pi === currentPlayer && (
                <span
                  style={{
                    position: "absolute",
                    left: "50%",
                    top: "50%",
                    transform: playerCenteredRotate
                      ? "translate(-50%, -50%)"
                      : `translate(-50%, -50%) rotate(${activeFacingAngleDeg}deg)`,
                    color: "#062214",
                    fontSize: `${Math.max(9, miniCell * 1.12)}px`,
                    fontWeight: 900,
                    lineHeight: 1,
                    textShadow: "0 0 3px rgba(0,255,136,1), 0 1px 0 rgba(0,0,0,0.5)",
                    pointerEvents: "none",
                    zIndex: 5,
                  }}
                  title="Active player facing direction"
                >
                  ▲
                </span>
              )}
              {showArtifactDot && (
                <span
                  style={{
                    position: "absolute",
                    left: "50%",
                    top: "50%",
                    transform: "translate(-50%, -50%)",
                    width: Math.max(2, miniCell * 0.3),
                    height: Math.max(2, miniCell * 0.3),
                    borderRadius: "50%",
                    background: "#ffd166",
                    boxShadow: "0 0 4px rgba(255,209,102,0.8)",
                    zIndex: 2,
                  }}
                />
              )}
              {cellFogVisual > 0 && (
                <span
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: `rgba(3, 3, 8, ${Math.min(0.95, 0.1 + cellFogVisual * 0.85)})`,
                    pointerEvents: "none",
                    zIndex: 1,
                  }}
                />
              )}
            </div>
          );
        })
      )}
    </div>
  );

  return (
    <div
      ref={miniMapWheelRef}
      role="button"
      tabIndex={0}
      onClick={onOpenGrid}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenGrid();
        }
      }}
      title="Switch to full 2D grid map — scroll wheel to zoom"
      onTouchStart={(e) => {
        if (hideZoomChrome || e.touches.length !== 2) return;
        const [a, b] = [e.touches[0], e.touches[1]];
        if (!a || !b) return;
        isoMiniMapPinchStartRef.current = {
          distance: Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY),
          zoom: isoMiniMapZoom,
        };
      }}
      onTouchMove={(e) => {
        if (hideZoomChrome || e.touches.length !== 2 || !isoMiniMapPinchStartRef.current) return;
        e.preventDefault();
        e.stopPropagation();
        const [a, b] = [e.touches[0], e.touches[1]];
        if (!a || !b) return;
        const distance = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
        const start = isoMiniMapPinchStartRef.current;
        const scale = distance / Math.max(1, start.distance);
        const nextZoom = start.zoom * scale;
        setIsoMiniMapZoom(Math.max(ISO_MINIMAP_ZOOM_MIN, Math.min(ISO_MINIMAP_ZOOM_MAX, nextZoom)));
      }}
      onTouchEnd={(e) => {
        if (hideZoomChrome) return;
        if (e.touches.length < 2) isoMiniMapPinchStartRef.current = null;
      }}
      onTouchCancel={() => {
        if (!hideZoomChrome) isoMiniMapPinchStartRef.current = null;
      }}
      style={{
        width: clipDiameter != null ? clipDiameter : "100%",
        height: clipDiameter != null ? clipDiameter : 140,
        borderRadius: clipDiameter != null ? "50%" : 6,
        border: "1px solid #3a3a46",
        background: "#0f0f16",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        position: "relative",
        touchAction: "none",
      }}
    >
      {!hideZoomChrome ? (
        <div
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            zIndex: 3,
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "2px 4px",
            borderRadius: 4,
            border: "1px solid rgba(98,98,120,0.65)",
            background: "rgba(8,8,12,0.72)",
            fontFamily: "monospace",
          }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsoMiniMapZoom((z) =>
                Math.max(ISO_MINIMAP_ZOOM_MIN, Math.min(ISO_MINIMAP_ZOOM_MAX, z - ISO_MINIMAP_ZOOM_STEP))
              );
            }}
            title="Zoom out mini map"
            style={{
              width: 18,
              height: 18,
              borderRadius: 4,
              border: "1px solid #4d4d63",
              background: "rgba(18,18,28,0.95)",
              color: "#d2d8e4",
              fontSize: "0.82rem",
              lineHeight: 1,
              cursor: "pointer",
            }}
          >
            -
          </button>
          <span
            style={{
              minWidth: 36,
              textAlign: "center",
              color: "#b9c4d6",
              fontSize: "0.64rem",
            }}
          >
            {Math.round((isoMiniMapZoom / ISO_MINIMAP_ZOOM_BASELINE) * 100)}%
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsoMiniMapZoom((z) =>
                Math.max(ISO_MINIMAP_ZOOM_MIN, Math.min(ISO_MINIMAP_ZOOM_MAX, z + ISO_MINIMAP_ZOOM_STEP))
              );
            }}
            title="Zoom in mini map"
            style={{
              width: 18,
              height: 18,
              borderRadius: 4,
              border: "1px solid #4d4d63",
              background: "rgba(18,18,28,0.95)",
              color: "#d2d8e4",
              fontSize: "0.82rem",
              lineHeight: 1,
              cursor: "pointer",
            }}
          >
            +
          </button>
        </div>
      ) : null}
      {playerCenteredRotate ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: `calc(50% - ${playerCenterPx}px)`,
              top: `calc(50% - ${playerCenterPy}px)`,
              width: gridW,
              height: gridH,
              transform: `rotate(${-mapRotationDeg}deg)`,
              transformOrigin: `${playerCenterPx}px ${playerCenterPy}px`,
            }}
          >
            {renderMiniMapGrid()}
          </div>
        </div>
      ) : (
        renderMiniMapGrid()
      )}
    </div>
  );
}

/** Circular 2D minimap (tap → full grid). */
function IsoHudMinimapCircle({
  lab,
  currentPlayer,
  playerFacing,
  fogIntensityMap,
  playerCells,
  isoMiniMapZoom,
  setIsoMiniMapZoom,
  isoMiniMapPinchStartRef,
  onOpenGrid,
  diameter,
  playerCenteredRotate = false,
  bearingAngleDeg,
  /** Parent already clips a circle (orbit HUD); use full diameter and no outer ring shrink. */
  embedFlush = false,
  hideZoomChrome = false,
}: {
  lab: Labyrinth;
  currentPlayer: number;
  playerFacing: Record<number, { dx: number; dy: number }>;
  fogIntensityMap: Map<string, number>;
  playerCells: Record<string, number>;
  isoMiniMapZoom: number;
  setIsoMiniMapZoom: Dispatch<SetStateAction<number>>;
  isoMiniMapPinchStartRef: MutableRefObject<{ distance: number; zoom: number } | null>;
  onOpenGrid: () => void;
  diameter: number;
  /** Player dot fixed in center; map rotates so walk-forward is up (matches 3D camera basis). */
  playerCenteredRotate?: boolean;
  bearingAngleDeg?: number | null;
  embedFlush?: boolean;
  hideZoomChrome?: boolean;
}) {
  const mapDiscPx = embedFlush ? diameter : Math.min(diameter, Math.round(diameter * 0.98));
  return (
    <div
      title="2D mini map — tap for full grid"
      style={{
        width: mapDiscPx,
        height: mapDiscPx,
        flexShrink: 0,
        borderRadius: "50%",
        overflow: "hidden",
        boxSizing: "border-box",
        border: embedFlush ? "none" : "2px solid rgba(0,255,136,0.28)",
        boxShadow: embedFlush ? "none" : "0 6px 22px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)",
      }}
    >
      <IsoDockGridMiniMap
        lab={lab}
        currentPlayer={currentPlayer}
        playerFacing={playerFacing}
        fogIntensityMap={fogIntensityMap}
        playerCells={playerCells}
        isoMiniMapZoom={isoMiniMapZoom}
        setIsoMiniMapZoom={setIsoMiniMapZoom}
        isoMiniMapPinchStartRef={isoMiniMapPinchStartRef}
        onOpenGrid={onOpenGrid}
        clipDiameter={mapDiscPx}
        playerCenteredRotate={playerCenteredRotate}
        bearingAngleDeg={bearingAngleDeg ?? null}
        hideZoomChrome={hideZoomChrome}
      />
    </div>
  );
}

/** SVG even-odd donut: annulus rInner..rOuter for reliable touch (not pointer-events:stroke). */
function minimapOrbitDonutPath(cx: number, cy: number, rInner: number, rOuter: number): string {
  return [
    `M ${cx + rOuter} ${cy}`,
    `A ${rOuter} ${rOuter} 0 1 1 ${cx - rOuter} ${cy}`,
    `A ${rOuter} ${rOuter} 0 1 1 ${cx + rOuter} ${cy}`,
    `M ${cx + rInner} ${cy}`,
    `A ${rInner} ${rInner} 0 1 0 ${cx - rInner} ${cy}`,
    `A ${rInner} ${rInner} 0 1 0 ${cx + rInner} ${cy}`,
    "Z",
  ].join(" ");
}

/**
 * Shared landscape + portrait mini-map green ring: same drag/tap-90° behavior, `setOrbitRingPointerHeld` so camera
 * auto-follow does not run for one frame before `rotateMode` commits on touch, and skip one orbit apply to avoid
 * bogus first touch deltas (~90° yaw).
 */
function useMinimapOrbitRingPointerHandlers({
  mazeIsoViewRef,
  wrap,
  cx,
  cy,
  rDonutInner,
  rDonutOuter,
}: {
  mazeIsoViewRef: RefObject<MazeIsoViewImperativeHandle | null>;
  wrap: number;
  cx: number;
  cy: number;
  rDonutInner: number;
  rDonutOuter: number;
}) {
  const ringDragRef = useRef<{ x: number; y: number; angle: number } | null>(null);
  const ringDragMovedRef = useRef(false);
  const ringTapAngleRef = useRef(0);
  const skipNextOrbitApplyRef = useRef(false);
  const tapAnimCancelRef = useRef(0);

  const onRingPointerDown = useCallback(
    (e: ReactPointerEvent<SVGPathElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const m = mazeIsoViewRef.current;
      m?.setOrbitRingPointerHeld(true);
      m?.activateRotate();
      skipNextOrbitApplyRef.current = true;
      ringDragMovedRef.current = false;
      const svg = e.currentTarget.ownerSVGElement as SVGSVGElement | null;
      if (svg) {
        const rect = svg.getBoundingClientRect();
        const sx = rect.width / wrap;
        const sy = rect.height / wrap;
        const cxC = rect.left + cx * sx;
        const cyC = rect.top + cy * sy;
        const angle = Math.atan2(e.clientY - cyC, e.clientX - cxC);
        ringDragRef.current = { x: e.clientX, y: e.clientY, angle };
        ringTapAngleRef.current = angle;
      } else {
        ringDragRef.current = { x: e.clientX, y: e.clientY, angle: 0 };
        ringTapAngleRef.current = 0;
      }
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [mazeIsoViewRef, wrap, cx, cy],
  );

  const onRingPointerMove = useCallback(
    (e: ReactPointerEvent<SVGPathElement>) => {
      if (ringDragRef.current == null) return;
      e.preventDefault();
      const prev = ringDragRef.current;
      if (!ringDragMovedRef.current && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) > 3) {
        ringDragMovedRef.current = true;
      }
      const svg = e.currentTarget.ownerSVGElement as SVGSVGElement | null;
      if (!svg) {
        ringDragRef.current = { x: e.clientX, y: e.clientY, angle: prev.angle };
        return;
      }
      const rect = svg.getBoundingClientRect();
      const sx = rect.width / wrap;
      const sy = rect.height / wrap;
      const cxC = rect.left + cx * sx;
      const cyC = rect.top + cy * sy;
      const vx = e.clientX - cxC;
      const vy = e.clientY - cyC;
      const len = Math.hypot(vx, vy);
      if (len < 6) {
        ringDragRef.current = {
          x: e.clientX,
          y: e.clientY,
          angle: Math.atan2(vy, vx),
        };
        return;
      }
      const nx = vx / len;
      const ny = vy / len;
      const newAng = Math.atan2(vy, vx);
      let dA = newAng - prev.angle;
      if (dA > Math.PI) dA -= 2 * Math.PI;
      if (dA < -Math.PI) dA += 2 * Math.PI;
      const ddx = e.clientX - prev.x;
      const ddy = e.clientY - prev.y;
      const rad = ddx * nx + ddy * ny;
      const rMidPx = ((rDonutInner + rDonutOuter) / 2) * sx;
      const tangPx = dA * rMidPx * MINIMAP_ORBIT_TANGENTIAL_BOOST;
      const sens = MINIMAP_ORBIT_POINTER_SENS;
      if (tangPx !== 0 || rad !== 0) {
        if (skipNextOrbitApplyRef.current) {
          skipNextOrbitApplyRef.current = false;
          ringDragRef.current = { x: e.clientX, y: e.clientY, angle: newAng };
          return;
        }
        mazeIsoViewRef.current?.orbitLookByPixelDelta(tangPx * sens, rad * sens);
        mazeIsoViewRef.current?.bumpRotateSession();
      }
      ringDragRef.current = { x: e.clientX, y: e.clientY, angle: newAng };
    },
    [mazeIsoViewRef, wrap, cx, cy, rDonutInner, rDonutOuter],
  );

  const onRingPointerEnd = useCallback(
    (e: ReactPointerEvent<SVGPathElement>) => {
      skipNextOrbitApplyRef.current = false;
      const wasTap = ringDragRef.current != null && !ringDragMovedRef.current;
      ringDragRef.current = null;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (wasTap) {
        tapAnimCancelRef.current++;
        const gen = tapAnimCancelRef.current;
        const tapAng = ringTapAngleRef.current;
        const rightHalf = tapAng > -Math.PI / 2 && tapAng < Math.PI / 2;
        const totalPx = (Math.PI / 2) / 0.005;
        const dir = rightHalf ? 1 : -1;
        const frames = 20;
        const step = (totalPx * dir) / frames;
        const m = mazeIsoViewRef.current;
        m?.activateRotate();
        m?.setOrbitRingPointerHeld(true);
        let i = 0;
        const animate = () => {
          if (gen !== tapAnimCancelRef.current) return;
          if (i >= frames || !mazeIsoViewRef.current) {
            mazeIsoViewRef.current?.setOrbitRingPointerHeld(false);
            return;
          }
          mazeIsoViewRef.current.orbitLookByPixelDelta(step, 0);
          mazeIsoViewRef.current.bumpRotateSession();
          i++;
          requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
      } else {
        mazeIsoViewRef.current?.setOrbitRingPointerHeld(false);
      }
    },
    [mazeIsoViewRef],
  );

  return { onRingPointerDown, onRingPointerMove, onRingPointerEnd };
}

/** N/E/S/W compass + green orbit band; centered mini-map (player in the middle). Desktop + mobile landscape. */
function MobileLandscapeMinimapOrbitWrap({
  mazeIsoViewRef,
  diameter,
  outerWrapPx,
  innerMapDiscPx,
  orbitRingRadialPx,
  lab,
  currentPlayer,
  playerFacing,
  fogIntensityMap,
  playerCells,
  isoMiniMapZoom,
  setIsoMiniMapZoom,
  isoMiniMapPinchStartRef,
  onOpenGrid,
  bearingAngleDeg,
}: {
  mazeIsoViewRef: RefObject<MazeIsoViewImperativeHandle | null>;
  diameter: number;
  /** When set, outer wrapper is larger than `diameter` while map stays sized by `innerMapDiscPx` / default rim math. */
  outerWrapPx?: number;
  /** Fixed mini-map disc (px); use with `outerWrapPx` for a wider orbit band. */
  innerMapDiscPx?: number;
  /** Green orbit donut thickness (px); defaults to `MINIMAP_ORBIT_RING_PX`. */
  orbitRingRadialPx?: number;
  lab: Labyrinth;
  currentPlayer: number;
  playerFacing: Record<number, { dx: number; dy: number }>;
  fogIntensityMap: Map<string, number>;
  playerCells: Record<string, number>;
  isoMiniMapZoom: number;
  setIsoMiniMapZoom: Dispatch<SetStateAction<number>>;
  isoMiniMapPinchStartRef: MutableRefObject<{ distance: number; zoom: number } | null>;
  onOpenGrid: () => void;
  bearingAngleDeg?: number | null;
}) {
  const orbitR = orbitRingRadialPx ?? MINIMAP_ORBIT_RING_PX;
  const wrap = outerWrapPx ?? diameter;
  const rimTotalDefault = 2 * MINIMAP_ORBIT_RING_PX + 2 * MINIMAP_COMPASS_PAD_PX;
  const mapDiscPx =
    innerMapDiscPx != null
      ? Math.max(MINIMAP_INNER_DISC_MIN_PX, innerMapDiscPx)
      : Math.max(MINIMAP_INNER_DISC_MIN_PX, Math.floor(wrap - rimTotalDefault));
  const inset = (wrap - mapDiscPx) / 2;
  const cx = wrap / 2;
  const cy = wrap / 2;
  const rMap = mapDiscPx / 2;
  const rDonutInner = rMap + 1.5;
  const rDonutOuter = rMap + orbitR;
  const thickOrbit = orbitR > MINIMAP_ORBIT_RING_PX + 0.5;
  const rEdge = wrap / 2 - 2;
  const tickOuter = rEdge;
  const tickLen = 6;
  const labelR = rEdge - 9;

  const cardinals = [
    { label: "N", ang: -Math.PI / 2 },
    { label: "E", ang: 0 },
    { label: "S", ang: Math.PI / 2 },
    { label: "W", ang: Math.PI },
  ] as const;

  const mapRotationDeg = isoMinimapMapRotationDeg(bearingAngleDeg ?? null, playerFacing, currentPlayer);

  const { onRingPointerDown, onRingPointerMove, onRingPointerEnd } = useMinimapOrbitRingPointerHandlers({
    mazeIsoViewRef,
    wrap,
    cx,
    cy,
    rDonutInner,
    rDonutOuter,
  });

  const donutD = minimapOrbitDonutPath(cx, cy, rDonutInner, rDonutOuter);

  return (
    <div
      style={{
        position: "relative",
        width: wrap,
        height: wrap,
        flexShrink: 0,
        touchAction: "none",
      }}
      title="Green band: drag to orbit the 3D view; tap band for 90° step · mini-map stays centered on you"
    >
      <div
        style={{
          position: "absolute",
          left: inset,
          top: inset,
          width: mapDiscPx,
          height: mapDiscPx,
          borderRadius: "50%",
          overflow: "hidden",
          zIndex: 1,
        }}
      >
        <IsoHudMinimapCircle
          diameter={mapDiscPx}
          lab={lab}
          currentPlayer={currentPlayer}
          playerFacing={playerFacing}
          fogIntensityMap={fogIntensityMap}
          playerCells={playerCells}
          isoMiniMapZoom={isoMiniMapZoom}
          setIsoMiniMapZoom={setIsoMiniMapZoom}
          isoMiniMapPinchStartRef={isoMiniMapPinchStartRef}
          onOpenGrid={onOpenGrid}
          playerCenteredRotate
          bearingAngleDeg={bearingAngleDeg ?? null}
          embedFlush
          hideZoomChrome
        />
      </div>
      <svg
        width={wrap}
        height={wrap}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          zIndex: 2,
          overflow: "visible",
          /** Let the center disc receive taps/wheel/pinch on `IsoDockGridMiniMap`; only the green donut path captures orbit drags. */
          pointerEvents: "none",
          touchAction: "none",
        }}
        aria-hidden
      >
        <g style={{ pointerEvents: "none" }}>
          <circle
            cx={cx}
            cy={cy}
            r={rMap}
            fill="none"
            stroke="rgba(140,150,170,0.45)"
            strokeWidth={1.25}
          />
          <circle
            cx={cx}
            cy={cy}
            r={rDonutOuter + 0.5}
            fill="none"
            stroke="rgba(100,110,130,0.35)"
            strokeWidth={1}
          />
          <g transform={`rotate(${mapRotationDeg}, ${cx}, ${cy})`}>
            {cardinals.map(({ label, ang }) => {
              const x1 = cx + Math.cos(ang) * tickOuter;
              const y1 = cy + Math.sin(ang) * tickOuter;
              const x2 = cx + Math.cos(ang) * (tickOuter - tickLen);
              const y2 = cy + Math.sin(ang) * (tickOuter - tickLen);
              const lx = cx + Math.cos(ang) * labelR;
              const ly = cy + Math.sin(ang) * labelR;
              return (
                <Fragment key={label}>
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(180,190,210,0.75)" strokeWidth={1.5} strokeLinecap="round" />
                  <text
                    x={lx}
                    y={ly}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="rgba(200,210,230,0.9)"
                    style={{ fontSize: 10, fontWeight: 700, fontFamily: "monospace" }}
                  >
                    {label}
                  </text>
                </Fragment>
              );
            })}
          </g>
        </g>
        <path
          d={donutD}
          fill={thickOrbit ? "rgba(0,255,136,0.22)" : "rgba(0,255,136,0.16)"}
          fillRule="evenodd"
          stroke="rgba(0,255,136,0.55)"
          strokeWidth={thickOrbit ? 1.75 : 1}
          style={{
            pointerEvents: "auto",
            touchAction: "none",
            cursor: "grab",
            filter: thickOrbit
              ? "drop-shadow(0 0 5px rgba(0,255,136,0.45))"
              : "drop-shadow(0 0 3px rgba(0,255,136,0.35))",
          }}
          onPointerDown={onRingPointerDown}
          onPointerMove={onRingPointerMove}
          onPointerUp={onRingPointerEnd}
          onPointerCancel={onRingPointerEnd}
        />
      </svg>
    </div>
  );
}

/**
 * Green orbit band on the **outer** annulus of the combined mini-map + move disc (portrait / non-split HUD).
 * Matches `MobileLandscapeMinimapOrbitWrap` drag + tap-90° behavior; sits between map (z 0) and joystick (z 2).
 */
function IsoMinimapOrbitRingOverlay({
  diameter,
  joystickPadPx,
  mazeIsoViewRef,
}: {
  diameter: number;
  joystickPadPx: number;
  mazeIsoViewRef: RefObject<MazeIsoViewImperativeHandle | null>;
}) {
  const wrap = diameter;
  const cx = wrap / 2;
  const cy = wrap / 2;
  const rDonutInner = joystickPadPx / 2 + 5;
  const rDonutOuter = wrap / 2 - 2;
  const ringGeometryOk = rDonutOuter - rDonutInner >= 7;

  const { onRingPointerDown, onRingPointerMove, onRingPointerEnd } = useMinimapOrbitRingPointerHandlers({
    mazeIsoViewRef,
    wrap,
    cx,
    cy,
    rDonutInner,
    rDonutOuter,
  });

  if (!ringGeometryOk) return null;

  const donutD = minimapOrbitDonutPath(cx, cy, rDonutInner, rDonutOuter);

  return (
    <svg
      width={wrap}
      height={wrap}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        zIndex: 3,
        overflow: "visible",
        pointerEvents: "none",
        touchAction: "none",
      }}
      aria-hidden
    >
      <path
        d={donutD}
        fill="rgba(0,255,136,0.14)"
        fillRule="evenodd"
        stroke="rgba(0,255,136,0.5)"
        strokeWidth={1}
        style={{
          pointerEvents: "auto",
          touchAction: "none",
          cursor: "grab",
          filter: "drop-shadow(0 0 3px rgba(0,255,136,0.3))",
        }}
        onPointerDown={onRingPointerDown}
        onPointerMove={onRingPointerMove}
        onPointerUp={onRingPointerEnd}
        onPointerCancel={onRingPointerEnd}
      />
    </svg>
  );
}

/** Map joystick offset (+y down) to a cardinal grid step using current screen-relative axes. */
function knobOffsetToRelativeCardinal(
  ox: number,
  oy: number,
  relativeForward: { dx: number; dy: number },
  relativeBackward: { dx: number; dy: number },
  relativeLeft: { dx: number; dy: number },
  relativeRight: { dx: number; dy: number },
): { dx: number; dy: number } {
  if (Math.abs(ox) >= Math.abs(oy)) {
    return ox > 0
      ? { dx: relativeRight.dx, dy: relativeRight.dy }
      : { dx: relativeLeft.dx, dy: relativeLeft.dy };
  }
  return oy < 0
    ? { dx: relativeForward.dx, dy: relativeForward.dy }
    : { dx: relativeBackward.dx, dy: relativeBackward.dy };
}

/** Stable cardinal bucket for move repeat (one step per direction change; hold uses delayed repeat). */
function moveCardinalKeyFromKnobOffset(ox: number, oy: number): string | null {
  if (Math.hypot(ox, oy) < MOVE_KNOB_DEAD_PX) return null;
  if (Math.abs(ox) >= Math.abs(oy)) return ox > 0 ? "R" : "L";
  return oy < 0 ? "F" : "B";
}

/** Joystick ring: `standalone` for corner HUD; `overlay` on top of minimap in one disc. */
function IsoHudJoystickMoveRing({
  diameter,
  dimPadOverMinimap,
  placement,
  outerRef,
  joystickBasisDiameterPx,
  fullCircleTouchTarget,
  canMoveUp,
  canMoveDown,
  canMoveLeft,
  canMoveRight,
  relativeForward,
  relativeBackward,
  relativeLeft,
  relativeRight,
  doMove,
  scrollToCurrentPlayerOnMap,
  focusDisabled,
  onJoystickLookGrid,
}: {
  diameter: number;
  dimPadOverMinimap: boolean;
  placement: "standalone" | "overlay";
  outerRef?: Ref<HTMLDivElement>;
  /** When outer `diameter` is enlarged, keep pad/knob travel sized like this baseline (e.g. `ISO_HUD_MOVE_RING_PX`). */
  joystickBasisDiameterPx?: number;
  /** Drags anywhere on the outer disc count (phone landscape); inner pad stays visual-only. */
  fullCircleTouchTarget?: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  relativeForward: { dx: number; dy: number };
  relativeBackward: { dx: number; dy: number };
  relativeLeft: { dx: number; dy: number };
  relativeRight: { dx: number; dy: number };
  doMove: (dx: number, dy: number, jump: boolean) => void;
  scrollToCurrentPlayerOnMap: () => void;
  focusDisabled: boolean;
  /** Mobile: inner ring orbits facing without stepping; outer ring moves (faster repeat when further out). */
  onJoystickLookGrid?: (dx: number, dy: number) => void;
}) {
  const basis = joystickBasisDiameterPx ?? diameter;
  const padPx = Math.min(ISO_HUD_JOYSTICK_PAD_PX, Math.round(basis * 0.58));
  const knobMax = Math.min(ISO_HUD_KNOB_MAX_PX, Math.round(padPx * 0.4));
  const lookRingOuterPx = useMemo(() => {
    if (knobMax < MOVE_KNOB_DEAD_PX + 5) return MOVE_KNOB_DEAD_PX;
    return Math.min(
      MOVE_KNOB_LOOK_RING_OUTER_PX,
      Math.max(MOVE_KNOB_DEAD_PX + 2, Math.round(knobMax * 0.68)),
      knobMax - 3,
    );
  }, [knobMax]);
  const joystickLookRingActive =
    !!onJoystickLookGrid && lookRingOuterPx > MOVE_KNOB_DEAD_PX + 0.5;
  const knobRef = useRef({ x: 0, y: 0 });
  const knobVisualRef = useRef<HTMLDivElement | null>(null);
  const dragActive = useRef(false);
  const ptrStartRef = useRef<{ x: number; y: number } | null>(null);
  const repeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const holdDelayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeMoveCardinalRef = useRef<string | null>(null);
  const lastLookEmittedRef = useRef<{ dx: number; dy: number } | null>(null);

  const clearRepeat = useCallback(() => {
    if (repeatRef.current != null) {
      clearInterval(repeatRef.current);
      repeatRef.current = null;
    }
    if (holdDelayTimeoutRef.current != null) {
      clearTimeout(holdDelayTimeoutRef.current);
      holdDelayTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => () => clearRepeat(), [clearRepeat]);

  const tryMoveFromKnob = useCallback(
    (ox: number, oy: number) => {
      if (Math.hypot(ox, oy) < MOVE_KNOB_DEAD_PX) return;
      let dx: number;
      let dy: number;
      let ok: boolean;
      if (Math.abs(ox) >= Math.abs(oy)) {
        dx = ox > 0 ? relativeRight.dx : relativeLeft.dx;
        dy = ox > 0 ? relativeRight.dy : relativeLeft.dy;
        ok = ox > 0 ? canMoveRight : canMoveLeft;
      } else {
        dx = oy < 0 ? relativeForward.dx : relativeBackward.dx;
        dy = oy < 0 ? relativeForward.dy : relativeBackward.dy;
        ok = oy < 0 ? canMoveUp : canMoveDown;
      }
      if (ok) doMove(dx, dy, false);
    },
    [
      canMoveUp,
      canMoveDown,
      canMoveLeft,
      canMoveRight,
      relativeForward,
      relativeBackward,
      relativeLeft,
      relativeRight,
      doMove,
    ],
  );

  const emitLookFromKnob = useCallback(
    (ox: number, oy: number) => {
      if (!onJoystickLookGrid) return;
      const { dx, dy } = knobOffsetToRelativeCardinal(
        ox,
        oy,
        relativeForward,
        relativeBackward,
        relativeLeft,
        relativeRight,
      );
      const prev = lastLookEmittedRef.current;
      if (prev != null && prev.dx === dx && prev.dy === dy) return;
      lastLookEmittedRef.current = { dx, dy };
      onJoystickLookGrid(dx, dy);
    },
    [
      onJoystickLookGrid,
      relativeForward,
      relativeBackward,
      relativeLeft,
      relativeRight,
    ],
  );

  /** Hold past dead zone: wait, then repeat; interval speeds up slightly for 2–3 quick steps. */
  const armAcceleratedRepeat = useCallback(
    (_ox: number, _oy: number) => {
      clearRepeat();
      const r = Math.hypot(knobRef.current.x, knobRef.current.y);
      const moveSpanStart = joystickLookRingActive ? lookRingOuterPx : MOVE_KNOB_DEAD_PX;
      if (r <= moveSpanStart) return;

      holdDelayTimeoutRef.current = setTimeout(() => {
        holdDelayTimeoutRef.current = null;
        let periodMs = MOVE_KNOB_REPEAT_MS_SLOW;
        let ticks = 0;
        const armInterval = () => {
          if (repeatRef.current != null) {
            clearInterval(repeatRef.current);
            repeatRef.current = null;
          }
          repeatRef.current = setInterval(() => {
            tryMoveFromKnob(knobRef.current.x, knobRef.current.y);
            ticks++;
            if (ticks % 2 === 0 && periodMs > MOVE_KNOB_REPEAT_MS_FAST) {
              periodMs = Math.max(MOVE_KNOB_REPEAT_MS_FAST, periodMs - 52);
              armInterval();
            }
          }, periodMs);
        };
        tryMoveFromKnob(knobRef.current.x, knobRef.current.y);
        armInterval();
      }, MOVE_KNOB_HOLD_DELAY_MS);
    },
    [clearRepeat, joystickLookRingActive, lookRingOuterPx, tryMoveFromKnob],
  );

  /** Apply knob offset from client coords; used on pointerdown (touch often skips move until finger slides) and pointermove. */
  const applyJoystickClient = useCallback(
    (el: HTMLElement, clientX: number, clientY: number) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      let ox = clientX - cx;
      let oy = clientY - cy;
      const m = Math.hypot(ox, oy);
      if (m > knobMax) {
        ox = (ox / m) * knobMax;
        oy = (oy / m) * knobMax;
      }
      const mClamped = Math.hypot(ox, oy);
      knobRef.current = { x: ox, y: oy };
      const kv = knobVisualRef.current;
      if (kv) {
        kv.style.transform = `translate(calc(-50% + ${ox}px), calc(-50% + ${oy}px))`;
      }

      if (!joystickLookRingActive) {
        const key = moveCardinalKeyFromKnobOffset(ox, oy);
        if (key == null) {
          clearRepeat();
          activeMoveCardinalRef.current = null;
          return;
        }
        if (key !== activeMoveCardinalRef.current) {
          activeMoveCardinalRef.current = key;
          tryMoveFromKnob(ox, oy);
          armAcceleratedRepeat(ox, oy);
        }
        return;
      }
      if (mClamped < MOVE_KNOB_DEAD_PX) {
        clearRepeat();
        activeMoveCardinalRef.current = null;
        return;
      }
      if (mClamped <= lookRingOuterPx) {
        clearRepeat();
        activeMoveCardinalRef.current = null;
        emitLookFromKnob(ox, oy);
        return;
      }
      const key = moveCardinalKeyFromKnobOffset(ox, oy);
      if (key == null) return;
      if (key !== activeMoveCardinalRef.current) {
        activeMoveCardinalRef.current = key;
        tryMoveFromKnob(ox, oy);
        armAcceleratedRepeat(ox, oy);
      }
    },
    [
      knobMax,
      joystickLookRingActive,
      lookRingOuterPx,
      clearRepeat,
      tryMoveFromKnob,
      armAcceleratedRepeat,
      emitLookFromKnob,
    ],
  );

  const onJoystickPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (focusDisabled) return;
    e.preventDefault();
    e.stopPropagation();
    dragActive.current = true;
    ptrStartRef.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    clearRepeat();
    activeMoveCardinalRef.current = null;
    lastLookEmittedRef.current = null;
    applyJoystickClient(e.currentTarget as HTMLElement, e.clientX, e.clientY);
  };

  const onJoystickPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragActive.current || focusDisabled) return;
    e.preventDefault();
    applyJoystickClient(e.currentTarget as HTMLElement, e.clientX, e.clientY);
  };

  const endJoystickPointer = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = ptrStartRef.current;
    const isShortDrag =
      start != null && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 14;
    const knobNearCenter = Math.hypot(knobRef.current.x, knobRef.current.y) < 12;
    if (isShortDrag && knobNearCenter && !focusDisabled) {
      scrollToCurrentPlayerOnMap();
    }
    dragActive.current = false;
    ptrStartRef.current = null;
    clearRepeat();
    activeMoveCardinalRef.current = null;
    lastLookEmittedRef.current = null;
    knobRef.current = { x: 0, y: 0 };
    const kv = knobVisualRef.current;
    if (kv) kv.style.transform = "translate(-50%, -50%)";
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const moveRingBackdrop = (
    <div
      style={{
        position: "absolute",
        inset: 0,
        borderRadius: "50%",
        zIndex: 0,
        background:
          "radial-gradient(circle at 50% 42%, rgba(48,56,68,0.95) 0%, rgba(18,20,30,0.98) 55%, rgba(8,9,14,1) 100%)",
        border: "2px solid rgba(0,255,136,0.3)",
        boxShadow: "0 6px 26px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.07)",
        pointerEvents: "none",
      }}
    />
  );

  const padPointerHandlers = fullCircleTouchTarget
    ? {}
    : {
        onPointerDown: onJoystickPointerDown,
        onPointerMove: onJoystickPointerMove,
        onPointerUp: endJoystickPointer,
        onPointerCancel: endJoystickPointer,
      };
  const outerPointerHandlers =
    fullCircleTouchTarget && placement === "standalone"
      ? {
          onPointerDown: onJoystickPointerDown,
          onPointerMove: onJoystickPointerMove,
          onPointerUp: endJoystickPointer,
          onPointerCancel: endJoystickPointer,
        }
      : {};

  const joystickPad = (
    <div
      role="presentation"
      {...padPointerHandlers}
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        width: padPx,
        height: padPx,
        marginLeft: -padPx / 2,
        marginTop: -padPx / 2,
        borderRadius: "50%",
        zIndex: 2,
        touchAction: "none",
        pointerEvents: fullCircleTouchTarget ? "none" : "auto",
        background: dimPadOverMinimap
          ? "radial-gradient(circle, rgba(10,12,20,0.88) 0%, rgba(10,12,20,0.35) 72%, transparent 100%)"
          : "rgba(10,12,20,0.2)",
        border: "1px solid rgba(0,255,136,0.22)",
        boxSizing: "border-box",
      }}
    >
      {joystickLookRingActive ? (
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            width: lookRingOuterPx * 2,
            height: lookRingOuterPx * 2,
            borderRadius: "50%",
            border: "1px solid rgba(0,255,136,0.3)",
            boxShadow: "inset 0 0 0 1px rgba(0,255,136,0.07)",
            pointerEvents: "none",
            zIndex: 1,
          }}
        />
      ) : null}
      <div
        ref={knobVisualRef}
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          width: ISO_HUD_KNOB_HANDLE_PX,
          height: ISO_HUD_KNOB_HANDLE_PX,
          borderRadius: "50%",
          background: "#1a2e22",
          border: "2px solid #00ff88",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
          boxShadow: "0 0 12px rgba(0,255,136,0.22)",
          zIndex: 2,
        }}
      >
        <MovePadFocusTargetIcon size={ISO_HUD_KNOB_ICON_PX} />
      </div>
    </div>
  );

  const wrapStyle: React.CSSProperties =
    placement === "overlay"
      ? {
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          borderRadius: "50%",
        }
      : {
          position: "relative",
          width: diameter,
          height: diameter,
          flexShrink: 0,
          pointerEvents: "auto",
        };

  return (
    <div ref={outerRef} style={wrapStyle} {...outerPointerHandlers}>
      {moveRingBackdrop}
      {joystickPad}
    </div>
  );
}

/** Single disc: circular minimap under joystick, or move-only ring when `showMinimap` is false. */
function CircularIsoMinimapMoveHud({
  diameter,
  showMinimap,
  lab,
  currentPlayer,
  playerFacing,
  fogIntensityMap,
  playerCells,
  isoMiniMapZoom,
  setIsoMiniMapZoom,
  isoMiniMapPinchStartRef,
  onOpenGrid,
  canMoveUp,
  canMoveDown,
  canMoveLeft,
  canMoveRight,
  relativeForward,
  relativeBackward,
  relativeLeft,
  relativeRight,
  doMove,
  scrollToCurrentPlayerOnMap,
  focusDisabled,
  outerRef,
  bearingAngleDeg,
  mazeIsoViewRef,
}: {
  diameter: number;
  showMinimap: boolean;
  lab: Labyrinth;
  currentPlayer: number;
  playerFacing: Record<number, { dx: number; dy: number }>;
  fogIntensityMap: Map<string, number>;
  playerCells: Record<string, number>;
  isoMiniMapZoom: number;
  setIsoMiniMapZoom: Dispatch<SetStateAction<number>>;
  isoMiniMapPinchStartRef: MutableRefObject<{ distance: number; zoom: number } | null>;
  onOpenGrid: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  relativeForward: { dx: number; dy: number };
  relativeBackward: { dx: number; dy: number };
  relativeLeft: { dx: number; dy: number };
  relativeRight: { dx: number; dy: number };
  doMove: (dx: number, dy: number, jump: boolean) => void;
  scrollToCurrentPlayerOnMap: () => void;
  focusDisabled: boolean;
  outerRef?: Ref<HTMLDivElement>;
  bearingAngleDeg?: number | null;
  /** When set with `showMinimap`, outer green band orbits the 3D camera (same as desktop / landscape mini-map). */
  mazeIsoViewRef?: RefObject<MazeIsoViewImperativeHandle | null>;
}) {
  const joystickPadPxForOrbit = Math.min(ISO_HUD_JOYSTICK_PAD_PX, Math.round(diameter * 0.58));
  return (
    <div
      ref={outerRef}
      title={
        showMinimap && mazeIsoViewRef
          ? "Green ring: drag to orbit 3D (map turns with view); center = move. Tap ring for 90° step."
          : undefined
      }
      style={{
        position: "relative",
        width: diameter,
        height: diameter,
        flexShrink: 0,
      }}
    >
      {showMinimap ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            overflow: "hidden",
            zIndex: 0,
            pointerEvents: "auto",
          }}
        >
          <IsoDockGridMiniMap
            lab={lab}
            currentPlayer={currentPlayer}
            playerFacing={playerFacing}
            fogIntensityMap={fogIntensityMap}
            playerCells={playerCells}
            isoMiniMapZoom={isoMiniMapZoom}
            setIsoMiniMapZoom={setIsoMiniMapZoom}
            isoMiniMapPinchStartRef={isoMiniMapPinchStartRef}
            onOpenGrid={onOpenGrid}
            clipDiameter={diameter}
            playerCenteredRotate
            bearingAngleDeg={bearingAngleDeg ?? null}
          />
        </div>
      ) : null}
      {showMinimap && mazeIsoViewRef ? (
        <IsoMinimapOrbitRingOverlay
          diameter={diameter}
          joystickPadPx={joystickPadPxForOrbit}
          mazeIsoViewRef={mazeIsoViewRef}
        />
      ) : null}
      <IsoHudJoystickMoveRing
        diameter={diameter}
        dimPadOverMinimap={showMinimap}
        placement="overlay"
        canMoveUp={canMoveUp}
        canMoveDown={canMoveDown}
        canMoveLeft={canMoveLeft}
        canMoveRight={canMoveRight}
        relativeForward={relativeForward}
        relativeBackward={relativeBackward}
        relativeLeft={relativeLeft}
        relativeRight={relativeRight}
        doMove={doMove}
        scrollToCurrentPlayerOnMap={scrollToCurrentPlayerOnMap}
        focusDisabled={focusDisabled}
      />
    </div>
  );
}

/** One step past the monster along the entry vector (same direction as the move that started combat). */
function findPassThroughFleeCell(
  lab: Labyrinth,
  prevX: number,
  prevY: number,
  curX: number,
  curY: number
): { x: number; y: number } | null {
  const stepX = curX - prevX;
  const stepY = curY - prevY;
  if (stepX === 0 && stepY === 0) return null;
  const tx = curX + stepX;
  const ty = curY + stepY;
  if (tx < 0 || tx >= lab.width || ty < 0 || ty >= lab.height) return null;
  if (!isWalkable(lab.grid[ty][tx])) return null;
  if (lab.monsters.some((m) => m.x === tx && m.y === ty)) return null;
  return { x: tx, y: ty };
}

/** Nearest walkable cell with no monster (BFS). Used when no orthogonal escape exists (corners / surrounded). */
function findCombatFleeCell(
  lab: Labyrinth,
  fromX: number,
  fromY: number,
  excludeKeys?: Set<string>
): { x: number; y: number } | null {
  const monsterAt = (x: number, y: number) => lab.monsters.some((m) => m.x === x && m.y === y);
  const dirs: [number, number][] = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ];
  for (const [dx, dy] of dirs) {
    const nx = fromX + dx;
    const ny = fromY + dy;
    const k = `${nx},${ny}`;
    if (excludeKeys?.has(k)) continue;
    if (nx < 0 || nx >= lab.width || ny < 0 || ny >= lab.height) continue;
    if (!isWalkable(lab.grid[ny][nx])) continue;
    if (monsterAt(nx, ny)) continue;
    return { x: nx, y: ny };
  }
  const visited = new Set<string>([`${fromX},${fromY}`]);
  const q: [number, number][] = [[fromX, fromY]];
  let qi = 0;
  while (qi < q.length) {
    const [cx, cy] = q[qi++]!;
    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      const k = `${nx},${ny}`;
      if (nx < 0 || nx >= lab.width || ny < 0 || ny >= lab.height || visited.has(k)) continue;
      if (excludeKeys?.has(k)) continue;
      if (!isWalkable(lab.grid[ny][nx])) continue;
      if (monsterAt(nx, ny)) continue;
      visited.add(k);
      if (nx !== fromX || ny !== fromY) return { x: nx, y: ny };
      q.push([nx, ny]);
    }
  }
  return null;
}

/** Bottom-panel button accent per stored artifact (consistent layout). */
const STORED_ARTIFACT_BUTTON_STYLE: Record<StoredArtifactKind, { background: string; color: string }> = {
  dice: { background: "#ffcc00", color: "#111" },
  shield: { background: "#44ff88", color: "#111" },
  teleport: { background: "#aa66ff", color: "#fff" },
  reveal: { background: "#6688ff", color: "#fff" },
  healing: { background: "#44aa88", color: "#fff" },
  torch: { background: "#ff9944", color: "#111" },
  holySword: { background: "#ddeeff", color: "#111" },
  holyCross: { background: "#ffeedd", color: "#111" },
  dragonFuryAxe: { background: "#dde8f8", color: "#111" },
  eternalFrostblade: { background: "#d8f0ff", color: "#111" },
  zweihandhammer: { background: "#e8e0d8", color: "#111" },
  azureDragonShield: { background: "#e6f5ee", color: "#111" },
  nordicShield: { background: "#eef2e8", color: "#111" },
  wardShield: { background: "#eae8f0", color: "#111" },
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
/** Horror-maze hunter portraits (`public/heroes/*.png`) — wear-only variants, no weapons or ammo */
const HERO_PORTRAIT_PREFIX = publicAssetPath("heroes/");
const HORROR_HERO_PORTRAITS = [
  { path: `${HERO_PORTRAIT_PREFIX}hero-wear-1.png`, title: "Horror hero — leather & belts (no weapons)" },
  { path: `${HERO_PORTRAIT_PREFIX}hero-wear-2.png`, title: "Horror hero — hooded rags (no weapons)" },
  { path: `${HERO_PORTRAIT_PREFIX}hero-wear-3.png`, title: "Horror hero — ritual robes (no weapons)" },
  { path: `${HERO_PORTRAIT_PREFIX}hero-wear-4.png`, title: "Horror hero — gambeson & pauldron (no weapons)" },
] as const;

/** Player 1 (index 0): only this portrait at start — no hero/emoji picker in start menu / settings. */
const PLAYER_1_FIXED_AVATAR_PATH = HORROR_HERO_PORTRAITS[0]!.path;

function isHeroPortraitPath(value: string): boolean {
  return (
    value.startsWith(HERO_PORTRAIT_PREFIX) ||
    value.startsWith("/heroes/") ||
    value.startsWith("./heroes/")
  );
}

/** Normalize stored portrait URLs so itch subpath builds still resolve (e.g. legacy `/heroes/…`). */
function heroPortraitImgSrc(value: string): string {
  if (!isHeroPortraitPath(value)) return value;
  const i = value.indexOf("heroes/");
  const file = i >= 0 ? value.slice(i + "heroes/".length) : value;
  return publicAssetPath(`heroes/${file}`);
}

function PlayerAvatarFace(props: {
  value: string;
  sizePx: number;
  radiusPx?: number;
  emojiFont?: string | number;
}): React.ReactNode {
  const { value, sizePx, radiusPx, emojiFont } = props;
  if (isHeroPortraitPath(value)) {
    return (
      <img
        src={heroPortraitImgSrc(value)}
        alt=""
        draggable={false}
        style={{
          width: sizePx,
          height: sizePx,
          objectFit: "cover",
          objectPosition: "center 12%",
          borderRadius: radiusPx ?? Math.floor(sizePx / 2),
          display: "block",
        }}
      />
    );
  }
  return (
    <span
      style={{
        fontSize: emojiFont ?? sizePx * 0.85,
        lineHeight: 1,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {value}
    </span>
  );
}

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
    case "storedArtifact":
      return `+${r.amount} ${STORED_ARTIFACT_TITLE[r.kind]} artifact${r.amount > 1 ? "s" : ""}`;
    case "torch":
      return "+1 torch (clears fog)";
    case "bomb":
      return `+${r.amount} bomb${r.amount > 1 ? "s" : ""}`;
    case "bonusMoves":
      return `+${r.amount} move${r.amount > 1 ? "s" : ""}`;
    case "shield":
      return "+1 shield charge";
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
    case "storedArtifact":
      return <ArtifactIcon variant={storedArtifactIconVariant(r.kind)} size={size} />;
    case "torch":
      return <ArtifactIcon variant="torch" size={size} />;
    case "bomb":
      return <ArtifactIcon variant="bomb" size={size} />;
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
const COMBAT_SKILL_SLOT_PX = 34;
const COMBAT_SKILL_IMG_PX = 28;
const COMBAT_SKILL_IMG_LOCKED_PX = 24;

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
  variant: ArtifactIconVariant;
  mode: "toggle" | "consume" | "locked";
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  stackCount?: number;
}) {
  const accentTone = artifactCombatSkillAccent(variant);
  const accent =
    accentTone === "green" ? "#44ff88" : accentTone === "gold" ? "#ffcc00" : "#8877bb";
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
          ? accentTone === "green"
            ? "rgba(68,255,136,0.12)"
            : accentTone === "gold"
              ? "rgba(255,204,0,0.1)"
              : "rgba(136,119,187,0.12)"
          : accentTone === "green"
            ? "rgba(68,255,136,0.1)"
            : accentTone === "gold"
              ? "rgba(255,204,0,0.1)"
              : "rgba(136,119,187,0.1)";
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
            top: -2,
            right: -2,
            minWidth: 13,
            height: 13,
            padding: "0 2px",
            borderRadius: 7,
            background: "#2a2a32",
            border: "1px solid rgba(255,255,255,0.2)",
            fontSize: "0.52rem",
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
        boxShadow: active
          ? `0 0 10px ${
              accentTone === "green"
                ? "rgba(68,255,136,0.25)"
                : accentTone === "gold"
                  ? "rgba(255,204,0,0.2)"
                  : "rgba(136,119,187,0.2)"
            }`
          : "none",
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

/** Shown before combat UI — player accepts fight or declines (step back / monster slips to adjacent cell). */
type PendingCombatOffer = {
  source: "player" | "monster";
  playerIndex: number;
  monsterIndex: number;
  monsterType: MonsterType;
  prevX?: number;
  prevY?: number;
  /** Monster tile before it stepped onto the player (tick AI). Used for run-away geometry like player prevX/Y. */
  monsterPrevX?: number;
  monsterPrevY?: number;
  /** Paid entering the monster’s tile; refunded if the player steps back. */
  moveCostPaid?: number;
};

function monsterHasAdjacentEscapeCell(lab: Labyrinth, monsterIndex: number): boolean {
  const m = lab.monsters[monsterIndex];
  if (!m) return false;
  const dirs: [number, number][] = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ];
  for (const [dx, dy] of dirs) {
    const nx = m.x + dx;
    const ny = m.y + dy;
    if (nx < 0 || ny < 0 || nx >= lab.width || ny >= lab.height) continue;
    if (lab.grid[ny]?.[nx] !== PATH) continue;
    if (lab.players.some((pl) => pl.x === nx && pl.y === ny)) continue;
    if (lab.monsters.some((om, i) => i !== monsterIndex && om.x === nx && om.y === ny)) continue;
    return true;
  }
  return false;
}

function getMonsterIcon(type: MonsterType): string {
  return type === "V"
    ? "🧛"
    : type === "Z"
      ? "🧟"
      : type === "G"
        ? "👻"
        : type === "K"
          ? "💀"
          : type === "L"
            ? "🔥"
            : type === "O"
              ? "🤡"
              : "🕷";
}

/** Monster combat state: idle = player initiated (easiest), hunt = neutral, attack/angry = monster aggressive (worst) */
type MonsterCombatState = "idle" | "hunt" | "attack" | "angry";

type MonsterSpriteState = MonsterCombatState | "rolling" | "hurt" | "defeated" | "neutral" | "recover" | "knockdown";

/** Drives post-strike portrait (2D + 3D) during combatRecoveryPhase hurt/recover windows. */
type CombatStrikePortrait =
  | "playerHit"
  | "playerHitHeavy"
  | "monsterHit"
  | "shield"
  | "defeated"
  | "other";

function rollCombatSurprise(): MonsterSurpriseState {
  const r = Math.floor(Math.random() * 4);
  return r === 0 ? "idle" : r === 1 ? "hunt" : r === 2 ? "attack" : "angry";
}

/** Lava Elemental sprite states from manifest */
function getLavaElementalSprite(type: MonsterType, state: "neutral" | "attacking" | "hurt" | "defeated" | "angry" | "enraged"): string | null {
  if (type !== "L") return null;
  return `monsters/lava/${state}.png`;
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
    if (state === "neutral" || state === "idle" || state === "hunt") return "monsters/lava/neutral.png";
    if (state === "attack" || state === "rolling") return "monsters/lava/attacking.png";
    if (state === "angry") return "monsters/lava/enraged.png";
    if (state === "hurt" || state === "knockdown") return "monsters/lava/hurt.png";
    if (state === "defeated") return "monsters/lava/defeated.png";
    if (state === "recover") return "monsters/lava/neutral.png";
    return "monsters/lava/neutral.png";
  }
  if (type === "V") {
    if (state === "neutral" || state === "idle") return "monsters/dracula/idle.png";
    if (state === "hunt") return "monsters/dracula/hunt.png";
    if (state === "attack" || state === "rolling") return "monsters/dracula/attack.png";
    if (state === "angry") return "monsters/dracula/hunt.png";
    if (state === "hurt" || state === "knockdown") return "monsters/dracula/hurt.png";
    if (state === "recover") return "monsters/dracula/recover.png";
    if (state === "defeated") return "monsters/dracula/defeated.png";
    return "monsters/dracula/idle.png";
  }
  if (type === "Z") {
    if (state === "neutral" || state === "idle") return "monsters/zombie/idle.png";
    if (state === "hunt") return "monsters/zombie/hunt.png";
    if (state === "attack" || state === "angry" || state === "rolling") return "monsters/zombie/attack.png";
    if (state === "hurt" || state === "knockdown") return "monsters/zombie/hurt.png";
    if (state === "recover") return "monsters/zombie/recover.png";
    if (state === "defeated") return "monsters/zombie/defeated.png";
    return "monsters/zombie/idle.png";
  }
  if (type === "G") {
    if (state === "neutral" || state === "idle") return "monsters/ghost/idle.png";
    if (state === "hunt") return "monsters/ghost/hunt.png";
    if (state === "attack" || state === "angry" || state === "rolling") return "monsters/ghost/attack.png";
    if (state === "hurt" || state === "knockdown") return "monsters/ghost/hurt.png";
    if (state === "recover") return "monsters/ghost/recover.png";
    if (state === "defeated") return "monsters/ghost/defeated.png";
    return "monsters/ghost/idle.png";
  }
  if (type === "K") {
    if (state === "neutral" || state === "idle") return "monsters/skeleton/idle.png";
    if (state === "hunt") return "monsters/skeleton/hunt.png";
    if (state === "attack" || state === "angry" || state === "rolling") return "monsters/skeleton/attack.png";
    if (state === "hurt" || state === "knockdown") return "monsters/skeleton/hurt.png";
    if (state === "recover") return "monsters/skeleton/recover.png";
    if (state === "defeated") return "monsters/skeleton/defeated.png";
    return "monsters/skeleton/idle.png";
  }
  if (type === "S") {
    if (state === "neutral" || state === "idle") return "monsters/spider/idle.png";
    if (state === "hunt") return "monsters/spider/hunt.png";
    if (state === "attack" || state === "angry" || state === "rolling") return "monsters/spider/attack.png";
    if (state === "hurt" || state === "knockdown") return "monsters/spider/hurt.png";
    if (state === "recover") return "monsters/spider/recover.png";
    if (state === "defeated") return "monsters/spider/defeated.png";
    return "monsters/spider/idle.png";
  }
  if (type === "O") {
    if (state === "neutral" || state === "idle") return "monsters/clown/idle.png";
    if (state === "hunt") return "monsters/clown/hunt.png";
    if (state === "attack" || state === "angry" || state === "rolling") return "monsters/clown/attack.png";
    if (state === "hurt" || state === "knockdown") return "monsters/clown/hurt.png";
    if (state === "recover") return "monsters/clown/recover.png";
    if (state === "defeated") return "monsters/clown/defeated.png";
    return "monsters/clown/idle.png";
  }
  return null;
}

function getCombatResultMonsterSpriteState(
  r: {
    draculaWeakened?: boolean;
    monsterWeakened?: boolean;
    won?: boolean;
    shieldAbsorbed?: boolean;
  },
  victoryPhase: "hurt" | "defeated",
  monsterType?: MonsterType | null,
): MonsterSpriteState {
  if (r.draculaWeakened || r.monsterWeakened) return "recover";
  if (r.won) return victoryPhase === "defeated" ? "defeated" : "hurt";
  if (r.shieldAbsorbed) return "angry";
  if (monsterType === "V") return "angry";
  return "hurt";
}

/** Idle sprite for monsters with all 6 states in assets. Use instead of emoji on grid etc. */
const MONSTER_IDLE_PATHS: Partial<Record<MonsterType, string>> = {
  L: "monsters/lava/neutral.png",
  V: "monsters/dracula/idle.png",
  Z: "monsters/zombie/idle.png",
  G: "monsters/ghost/idle.png",
  K: "monsters/skeleton/idle.png",
  S: "monsters/spider/idle.png",
  O: "monsters/clown/idle.png",
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

/** Crosshair for “focus pawn on maze” in the center of the move pad (↑←→↓). */
function MovePadFocusTargetIcon({ size }: { size: number }) {
  const stroke = "#00ff88";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden style={{ display: "block" }}>
      <circle cx="12" cy="12" r="5" stroke={stroke} strokeWidth="1.75" />
      <line x1="12" y1="2" x2="12" y2="6" stroke={stroke} strokeWidth="1.75" strokeLinecap="round" />
      <line x1="12" y1="18" x2="12" y2="22" stroke={stroke} strokeWidth="1.75" strokeLinecap="round" />
      <line x1="2" y1="12" x2="6" y2="12" stroke={stroke} strokeWidth="1.75" strokeLinecap="round" />
      <line x1="18" y1="12" x2="22" y2="12" stroke={stroke} strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

/** Desktop: open fullscreen (Material-style expand corners). */
function FullscreenEnterIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden style={{ display: "block" }}>
      <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
    </svg>
  );
}

/** Desktop: close fullscreen (Material-style contract corners). */
function FullscreenExitIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden style={{ display: "block" }}>
      <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11v-3h3v-2h-5v5h2zm3-6V5h-2v5h5V8h-3z" />
    </svg>
  );
}

export default function LabyrinthGame() {
  const [lab, setLab] = useState<Labyrinth | null>(null);
  const [currentPlayer, setCurrentPlayer] = useState(0);
  const [movesLeft, setMovesLeft] = useState(0);
  const [totalMoves, setTotalMoves] = useState(0);
  const [playerTurns, setPlayerTurns] = useState<number[]>(() => [0]);
  const [playerMoves, setPlayerMoves] = useState<number[]>(() => [0]);
  const [diceResult, setDiceResult] = useState<number | null>(null);
  const [winner, setWinner] = useState<number | null>(null);
  /** When `winner === -1`, drives the loss line in the game-over modal (Dracula vs generic). */
  const [gameOverReason, setGameOverReason] = useState<"monsters" | "dracula">("monsters");
  const [error, setError] = useState("");
  const [mazeSize, setMazeSize] = useState(25);
  const [difficulty, setDifficulty] = useState(2);
  const [firstMonsterType, setFirstMonsterType] = useState<import("@/lib/labyrinth").MonsterType>("V");
  const [numPlayers, setNumPlayers] = useState(1);
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
  /** One-shot red border flash on the hurt player’s maze avatar (seq bumps restart CSS animation). */
  const [playerAvatarHitFlash, setPlayerAvatarHitFlash] = useState<{ playerIndex: number; seq: number } | null>(null);
  const [bombGained, setBombGained] = useState<boolean | null>(null);
  const [artifactGained, setArtifactGained] = useState<string | null>(null);
  const [hiddenGemTeleport, setHiddenGemTeleport] = useState<boolean | null>(null);
  const [torchGained, setTorchGained] = useState<boolean | null>(null);
  const [cellsRevealed, setCellsRevealed] = useState<number | null>(null);
  const [webSlowed, setWebSlowed] = useState<boolean | null>(null);
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
  /** After resolving a teleport, block opening magic portal again until the player moves (avoids chain-teleport + idle timer abuse). */
  const [suppressMagicPortalUntilMove, setSuppressMagicPortalUntilMove] = useState(false);
  const [catapultMode, setCatapultMode] = useState(false);
  const [catapultPicker, setCatapultPicker] = useState<{
    playerIndex: number;
    from: [number, number];
    /** Launch using a stored charge (any tile); otherwise one-time use from catapult cell. */
    viaCharge?: boolean;
  } | null>(null);
  const [passThroughMagic, setPassThroughMagic] = useState(false);
  const [catapultAnimation, setCatapultAnimation] = useState<{
    from: [number, number];
    to: [number, number];
    playerIndex: number;
  } | null>(null);
  const catapultDragRef = useRef<{ startX: number; startY: number; cellX: number; cellY: number } | null>(null);
  const [catapultDragOffset, setCatapultDragOffset] = useState<{ dx: number; dy: number } | null>(null);
  /** 3D slingshot: latest pointer for floor raycast + in-scene arc (client coordinates). */
  const [catapultAimClient, setCatapultAimClient] = useState<{ x: number; y: number } | null>(null);
  /** 3D only: orbit to frame the maze first, then enter pull-to-aim (fixes inverted aim vs camera). */
  const [catapultIsoPhase, setCatapultIsoPhase] = useState<"orient" | "pull">("orient");
  const [jumpAnimation, setJumpAnimation] = useState<{
    playerIndex: number;
    x: number;
    y: number;
  } | null>(null);
  /** Iso 3D: monotonic bump so `PlayerAvatar3D` plays merged `Run_and_Jump` on maze jump moves. */
  const [isoPlayerJumpPulse, setIsoPlayerJumpPulse] = useState(0);
  const [bombExplosion, setBombExplosion] = useState<{ x: number; y: number } | null>(null);
  const [combatState, setCombatState] = useState<{
    playerIndex: number;
    monsterType: MonsterType;
    monsterIndex: number;
    /** Monotonic per encounter — same playerIndex/monsterIndex after a kill can repeat; init + 3D key use this. */
    sessionId: number;
    prevX?: number;
    prevY?: number;
    /** Monster cell before ambush — same math as prevX/Y for pass-through flee, without breaking skeleton shield (player prev). */
    approachX?: number;
    approachY?: number;
  } | null>(null);
  const combatEncounterSerialRef = useRef(0);
  const [pendingCombatOffer, setPendingCombatOffer] = useState<PendingCombatOffer | null>(null);
  const pendingCombatOfferRef = useRef<PendingCombatOffer | null>(null);
  const [combatResult, setCombatResult] = useState<
    | (CombatResult & {
        monsterType?: MonsterType;
        playerIndex?: number;
        shieldAbsorbed?: boolean;
        draculaWeakened?: boolean;
        monsterWeakened?: boolean;
        monsterHp?: number;
        monsterMaxHp?: number;
        bonusReward?: MonsterBonusReward | null;
        /** When non-empty after a win, player must pick one bonus or skip before Continue */
        bonusRewardOptions?: MonsterBonusReward[];
        bonusRewardApplied?: boolean;
        /** True when player died in combat — show defeat screen with Close button */
        playerDefeated?: boolean;
        /** Snapshot after lethal hit — lab is respawned so bars must not read live player HP */
        playerHpAtEnd?: number;
        /** Last strike tier on the killing blow — 3D death fall direction after footer snapshot clears */
        finishingStrikeSegment?: "spell" | "skill" | "light";
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
  /** Win: false until monster death clip (3D) or defeated phase beat (2D) finishes — bonus loot waits on this. Loss: treated ready immediately. */
  const [combatVictoryDeathAnimReady, setCombatVictoryDeathAnimReady] = useState(false);
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
    /** After glancing hit: monster HP so modal shows correct value (avoids labRef timing) */
    monsterHp?: number;
    monsterMaxHp?: number;
    /** Last continue strike — drives ~450ms hurt / ~550ms recover portrait (3D Dracula segment GLBs). */
    strikePortrait?: CombatStrikePortrait;
    /** Which Dracula attack GLB matched this monsterHit (spell vs skill). */
    draculaAttackSegment?: "spell" | "skill" | "light";
    /** Post-strike HP for Dracula light-hit tier clips — stable across stagger flush so hurt anim does not restart. */
    draculaHurt3dHp?: { hp: number; maxHp: number };
    /** True when this monster hit is lethal and used the **spell** clip (e.g. Jumping_Punch) — player 3D uses `Shot_and_Fall_Backward`. */
    playerFatalJumpKill?: boolean;
    /** Aim committed during the strike roll — merged monster `hurt` + player `hurt` clip selection in `CombatScene3D`. */
    strikeTargetPick?: StrikeTarget;
    /** HP the player lost on this strike (monster hit) — player merged hurt tier. */
    playerHpLost?: number;
  } | null>(null);
  /** Landscape skills panel: raw d6 (1–6) from the last resolved strike roll this fight */
  const [lastCombatStrikeDiceFace, setLastCombatStrikeDiceFace] = useState<number | null>(null);
  /** ISO-only in-scene combat feedback (click-to-roll + animation pulses). */
  const [isoCombatRollFace, setIsoCombatRollFace] = useState<number | null>(null);
  const [isoCombatPulseVersion, setIsoCombatPulseVersion] = useState(0);
  const [isoCombatPlayerCue, setIsoCombatPlayerCue] = useState<{
    moment: "strike" | "hurt" | "shield";
    variant: "spell" | "skill" | "light";
    fatalJump: boolean;
  } | null>(null);
  const isoCombatPulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Monster sprite phase after taking damage: hurt → recover → ready (before next roll) */
  const [combatRecoveryPhase, setCombatRecoveryPhase] = useState<"hurt" | "recover" | "ready">("ready");
  const combatRecoveryPhaseRef = useRef(combatRecoveryPhase);
  const lastCombatRecoveryClipFinishMs = useRef(0);
  /** Temporary combat toast — `seq` invalidates older timeouts when a new toast is shown */
  const [combatToast, setCombatToast] = useState<{
    seq: number;
    message: string;
    style: "hint" | "footer";
  } | null>(null);
  const combatToastSeqRef = useRef(0);
  /** Alternates Charged_Spell vs Skill_03 GLB on each monster-hit strike (Dracula 3D). */
  const draculaStrikeAttackVariantRef = useRef<"spell" | "skill" | "light">("spell");
  /** While set, HP bars show pre-strike values; lab commit runs after stagger delay (3D: longer for merged Meshy V/K). */
  const [combatStrikeHpHold, setCombatStrikeHpHold] = useState<{
    monsterHp: number;
    monsterMaxHp: number;
    playerHp: number;
    playerIndex: number;
  } | null>(null);
  const strikeLabCommitTimerRef = useRef<number | null>(null);
  const combatStrikeLabPending = combatStrikeHpHold != null;
  /** `applyPost` lab flush ran after staggered strike preview — skip re-starting recovery/stance. */
  const combatPostLabFromStaggerRef = useRef(false);
  const combatFooterSnapshotRef = useRef(combatFooterSnapshot);
  /** Monster info popover (stats + hint); opened via ℹ Info on all breakpoints. Resets when this fight’s monster changes. */
  const [combatMonsterHintOpen, setCombatMonsterHintOpen] = useState(false);
  const [combatAutoHintVisible, setCombatAutoHintVisible] = useState(false);
  const [defeatedMonsterOnCell, setDefeatedMonsterOnCell] = useState<{ x: number; y: number; monsterType: MonsterType } | null>(null);
  const [collisionEffect, setCollisionEffect] = useState<{ x: number; y: number } | null>(null);
  const [combatUseShield, setCombatUseShield] = useState(true);
  const [combatUseDiceBonus, setCombatUseDiceBonus] = useState(true);
  const MAZE_ZOOM_BASELINE = 2;
  const MAZE_ZOOM_MIN = 1;
  const MAZE_ZOOM_MAX = 4;
  const MAZE_ZOOM_STEP = 0.25;
  const [mazeZoom, setMazeZoom] = useState(MAZE_ZOOM_BASELINE);
  const [isoMiniMapZoom, setIsoMiniMapZoom] = useState(ISO_MINIMAP_ZOOM_INITIAL);
  /** `grid` = playable CSS map; `iso` = 3D isometric view. Magic teleport can switch to iso; slingshot stays in current view. */
  const [mazeMapView, setMazeMapView] = useState<"grid" | "iso">("iso");
  const mazeMapViewRef = useRef(mazeMapView);
  useEffect(() => {
    mazeMapViewRef.current = mazeMapView;
  }, [mazeMapView]);
  const [playerFacing, setPlayerFacing] = useState<Record<number, { dx: number; dy: number }>>({});
  /** Iso: last camera-walk cardinal written to `playerFacing` (avoid setState on every bearing frame). */
  const prevIsoWalkCardinalKeyRef = useRef<string | null>(null);
  /** Latest 3D camera bearing (deg); updated before `setIsoCameraBearingDeg` so walk/joystick can read it above that state hook. */
  const isoCameraBearingDegRef = useRef<number | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  /** Landscape + short viewport: tighter combat face-off (sprites/grid); full mobile UI comes from `isMobile` (includes this case). */
  const [isLandscapeCompact, setIsLandscapeCompact] = useState(false);
  /** Same fixed slot for combat controls and all post-combat UI (defeat / win / bonus loot). */
  const combatResultSlotHeightPx = COMBAT_MODAL_RESULT_SLOT_PX;
  /** Desktop only: collapse controls panel (bomb, artifacts) to a thin strip. */
  const [desktopControlsCollapsed, setDesktopControlsCollapsed] = useState(false);
  /** Mobile: selected item in bottom dock before tapping Use. */
  const [mobileDockAction, setMobileDockAction] = useState<MobileDockAction | null>(null);
  /** Full-screen 3D HUD: selected bomb/artifact in center strip (shows advice sheet below). */
  const [immersiveInventoryPick, setImmersiveInventoryPick] = useState<MobileDockAction | null>(null);
  /** Mobile: full Move & items vs compact artifacts-only strip. */
  /** Mobile: ▼/▲ toggles move pad + inventory together (starts open). */
  const [mobileDockExpanded, setMobileDockExpanded] = useState(true);
  const mobileDockExpandedRef = useRef(mobileDockExpanded);
  /** Measured height of fixed bottom dock — maze scroll padding so map can clear above it. */
  const mobileDockRef = useRef<HTMLDivElement>(null);
  /** Expanded mobile dock: fixed overlays sit outside `mobileDockRef` (height 0) — measure these for inset. */
  const mobileDockExpandedHandleRef = useRef<HTMLDivElement>(null);
  const mobileDockExpandedLeftRef = useRef<HTMLDivElement>(null);
  const mobileDockExpandedMovePadRef = useRef<HTMLDivElement>(null);
  const [mobileDockInsetPx, setMobileDockInsetPx] = useState(0);
  const mobileDockTouchStartY = useRef<number>(0);
  const [gameStarted, setGameStarted] = useState(false);
  /** Preload Dracula + logo, then reveal start menu (skipped on return-to-menu after first load). */
  const [startMenuReady, setStartMenuReady] = useState(false);
  const startMenuPreloadedRef = useRef(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  /** While header menu or settings modal is open — freeze map gameplay (monsters, moves, timers). */
  const gamePaused = headerMenuOpen || settingsOpen;
  const gamePausedRef = useRef(false);
  const headerMenuRef = useRef<HTMLDivElement>(null);
  const [showDiceModal, setShowDiceModal] = useState(false);
  const [playerNames, setPlayerNames] = useState<string[]>(() =>
    Array.from({ length: 1 }, (_, i) => `Player ${i + 1}`)
  );
  const [playerAvatars, setPlayerAvatars] = useState<string[]>(() =>
    Array.from({ length: 10 }, (_, i) =>
      i < HORROR_HERO_PORTRAITS.length
        ? HORROR_HERO_PORTRAITS[i]!.path
        : PLAYER_AVATARS[i % PLAYER_AVATARS.length]
    )
  );
  /** Player 1 portrait is not selectable — keep state aligned with `PLAYER_1_FIXED_AVATAR_PATH`. */
  useEffect(() => {
    setPlayerAvatars((prev) => {
      if (prev[0] === PLAYER_1_FIXED_AVATAR_PATH) return prev;
      const next = [...prev];
      next[0] = PLAYER_1_FIXED_AVATAR_PATH;
      return next;
    });
  }, [numPlayers]);
  const [playerWeaponGlb, setPlayerWeaponGlb] = useState<string[]>(() =>
    Array.from({ length: 10 }, (_, i) => WEAPON_OPTIONS[i % WEAPON_OPTIONS.length]!.path),
  );
  const [playerOffhandArmourGlb, setPlayerOffhandArmourGlb] = useState<string[]>(() =>
    Array.from({ length: 10 }, () => NO_ARMOUR_SENTINEL),
  );
  const diceRef = useRef<Dice3DRef>(null);
  const combatDiceRef = useRef<Dice3DRef>(null);
  const movesLeftRef = useRef(0);
  const diceResultRef = useRef<number | null>(null);
  /** Delayed next-player transition (doMove / teleport / advance effect) — cleared on new game and new move */
  const turnChangePauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const winnerRef = useRef(winner);
  /** After Dracula’s attack resolves in `setLab`, effect applies `setWinner` / turn pass (avoid side effects inside updater). */
  const pendingDraculaEliminationRef = useRef<{ allDead: boolean; nextP?: number } | null>(null);
  /** Map-phase Dracula bite: flushed on `lab` commit → toast + HP readout (avoid `setState` inside `setLab` updater). */
  const pendingMazeDraculaBiteRef = useRef<{ hpAfter: number; lethal: boolean } | null>(null);
  const [mazeDraculaBiteBanner, setMazeDraculaBiteBanner] = useState<{
    seq: number;
    hpAfter: number;
    lethal: boolean;
  } | null>(null);
  const combatStateRef = useRef(combatState);
  const combatResultRef = useRef(combatResult);
  const combatSurpriseRef = useRef<MonsterSurpriseState>("hunt");
  const combatRollResolveInProgressRef = useRef(false);
  const combatHasRolledRef = useRef(false);
  /** After setLab: true = still fighting same monster, show roll UI + snapshot instead of result/Continue */
  const combatContinuesAfterRollRef = useRef(false);
  /** True when player died in combat — skip setCombatState(null) so modal stays open with defeat result */
  const playerDefeatedInCombatRef = useRef(false);
  /** Set inside flushSync(setLab) when combat applies HP damage — player index for avatar border flash after sync. */
  const pendingPlayerDamageHighlightIndexRef = useRef<number | null>(null);
  const combatUseShieldRef = useRef(true);
  const combatUseDiceBonusRef = useRef(true);
  /** Combat: +1 per holy sword/cross spent before this strike — only these add to the strike die (not Dracula attack or Power dice bonus). */
  const combatHolyStrikeBonusRef = useRef(0);
  /** Combat: player toggled Dice artifact before rolling — after the roll, offer a second d6 (consumes artifact only if accepted). */
  const combatDiceRerollReservedRef = useRef(false);
  const [combatDiceRerollReserved, setCombatDiceRerollReserved] = useState(false);
  /** True while resolving the second strike roll (no artifact reroll prompt on that roll). */
  const combatStrikeIsRerollRef = useRef(false);
  const combatDicePhysicsInFlightRef = useRef(false);
  const pendingArtifactRerollRef = useRef<{ result: CombatResult } | null>(null);
  const [combatArtifactRerollPrompt, setCombatArtifactRerollPrompt] = useState(false);
  const combatStrikeTargetDuringRollRef = useRef<StrikeTarget | null>(null);
  /** Set true the instant the strike d6 value is applied — before UI reveal — so aim cannot be changed after the roll is locked in. */
  const combatStrikeDiceOutcomeKnownRef = useRef(false);
  const rollingRef = useRef(false);
  /** While dice roll: 0–1 advance fighters toward each other in 3D. */
  const combatMonsterStrike3d =
    combatState != null && getMonsterGltfPath(combatState.monsterType, "idle") != null;
  const combatStrikePick3dDuringRoll =
    combatMonsterStrike3d && rolling && !combatArtifactRerollPrompt;
  /**
   * Merged 3D face-off approach blend (same semantics as `Monster3dContactPairLab` `approach`):
   * - Between strike rolls (and other non-roll UI that still leaves the fight open): 1 → strike-pick staging half.
   * - While the strike die rolls: 0 → 1 smoothstep over `COMBAT_FACEOFF_APPROACH_DURATION_MS` (walk-in).
   * - Fight over or no merged 3D / no `combatState`: 0 → wide idle half. Passed to `resolveCombat3dClipLeads`.
   */
  const combat3dApproachEligible =
    combatMonsterStrike3d && combatState != null && combatResult == null && !combatArtifactRerollPrompt;
  const [combat3dApproachBlend, setCombat3dApproachBlend] = useState(1);
  const combat3dApproachSessionRef = useRef(0);
  const combat3dApproachRafRef = useRef(0);

  useEffect(() => {
    combat3dApproachSessionRef.current += 1;
    const session = combat3dApproachSessionRef.current;
    cancelAnimationFrame(combat3dApproachRafRef.current);

    if (!combat3dApproachEligible) {
      /**
       * `combat3dApproachEligible` is false during e.g. dice-artifact reroll (`combatArtifactRerollPrompt`).
       * Snapping blend to 0 used wide `COMBAT_IDLE_SEPARATION_HALF` while `/monster-3d-animations` stays at default
       * approach **1** (`COMBAT_STRIKE_PICK_SEPARATION_HALF`) for the same idle row — keep staging distance for any
       * on-screen merged fight until the encounter resolves.
       */
      const keepStrikePickStaging =
        combatMonsterStrike3d && combatState != null && combatResult == null;
      setCombat3dApproachBlend(keepStrikePickStaging ? 1 : 0);
      return;
    }
    if (!rolling) {
      setCombat3dApproachBlend(1);
      return;
    }

    setCombat3dApproachBlend(0);
    const t0 = performance.now();
    const durationMs = COMBAT_FACEOFF_APPROACH_DURATION_MS;
    const tick = (now: number) => {
      if (combat3dApproachSessionRef.current !== session) return;
      const linear = Math.min(1, (now - t0) / durationMs);
      const u = linear * linear * (3 - 2 * linear);
      setCombat3dApproachBlend(u);
      if (u < 1) {
        combat3dApproachRafRef.current = requestAnimationFrame(tick);
      }
    };
    combat3dApproachRafRef.current = requestAnimationFrame(tick);

    return () => {
      combat3dApproachSessionRef.current += 1;
      cancelAnimationFrame(combat3dApproachRafRef.current);
    };
  }, [combat3dApproachEligible, rolling]);
  /** Head-body-legs row only when not using 3D tap-to-aim (no duplicate controls). */
  const combatStrikePickButtonsDuringRoll =
    combatState != null &&
    rolling &&
    !combatArtifactRerollPrompt &&
    !combatStrikePick3dDuringRoll;
  const applyCombatPostResolveRef = useRef<(result: CombatResult) => void>(() => {});
  const currentPlayerRef = useRef(currentPlayer);
  const playerFacingRef = useRef<Record<number, { dx: number; dy: number }>>({});
  const labRef = useRef(lab);
  const teleportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Absolute deadline (ms) for idle auto-pick; survives effect re-runs / gamePaused toggles so the full MAGIC_TELEPORT_PICK_IDLE_MS is preserved. */
  const teleportIdleDeadlineRef = useRef<number | null>(null);
  const hiddenGemTeleportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const teleportPickerRef = useRef(teleportPicker);
  const catapultPickerRef = useRef(catapultPicker);
  const openSlingshotFromDockRef = useRef<(() => void) | null>(null);
  /** Sync true while a manual teleport picker is required (last-move magic/gem/artifact); blocks stale-dice turn advance until pick/cancel. */
  const manualTeleportPendingRef = useRef(false);
  const passThroughMagicRef = useRef(false);
  const handleTeleportSelectRef = useRef<(destX: number, destY: number) => void>(() => {});
  const triggerRoundEndRef = useRef<() => void>(() => {});
  const currentPlayerCellRef = useRef<HTMLDivElement | null>(null);
  const expandDesktopControlsRef = useRef<() => void>(() => {});
  const mazeWrapRef = useRef<HTMLDivElement>(null);
  /** Grid play fullscreen includes zoom row + maze + bottom dock (sibling of wrap). */
  const mazeAreaRef = useRef<HTMLDivElement>(null);
  const isoPlayRootRef = useRef<HTMLDivElement>(null);
  const mazeIsoViewRef = useRef<MazeIsoViewImperativeHandle>(null);
  const [isoNativeFsActive, setIsoNativeFsActive] = useState(false);
  const [isoImmersiveFallback, setIsoImmersiveFallback] = useState(false);
  const isoImmersiveUi = isoNativeFsActive || isoImmersiveFallback;
  const pinchStartRef = useRef<{ distance: number; zoom: number } | null>(null);
  const isoMiniMapPinchStartRef = useRef<{ distance: number; zoom: number } | null>(null);
  const mazeZoomRef = useRef(mazeZoom);
  mazeZoomRef.current = mazeZoom;

  const expandDesktopControls = useCallback(() => {
    if (typeof window === "undefined") return;
    if (matchesMobileLayout()) return;
    setDesktopControlsCollapsed(false);
  }, []);
  expandDesktopControlsRef.current = expandDesktopControls;

  useEffect(() => {
    const mqNarrow = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`);
    const mqLandscapeShort = window.matchMedia(
      `(orientation: landscape) and (max-height: ${MOBILE_LANDSCAPE_MAX_HEIGHT_PX}px)`
    );
    const sync = () => {
      setIsMobile(mqNarrow.matches || mqLandscapeShort.matches);
      setIsLandscapeCompact(mqLandscapeShort.matches);
    };
    sync();
    mqNarrow.addEventListener("change", sync);
    mqLandscapeShort.addEventListener("change", sync);
    return () => {
      mqNarrow.removeEventListener("change", sync);
      mqLandscapeShort.removeEventListener("change", sync);
    };
  }, []);

  useEffect(() => {
    if (gameStarted) return;
    if (startMenuPreloadedRef.current) {
      setStartMenuReady(true);
      return;
    }
    let cancelled = false;
    let timeoutId: number | undefined;
    const t0 = Date.now();
    const loadImage = (src: string) =>
      new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = () => resolve();
        img.src = src;
      });
    Promise.all([loadImage(START_MENU_COVER_BG), loadImage(GAME_TITLE_LABEL_SRC)]).then(() => {
      if (cancelled) return;
      const minMs = 700;
      const wait = Math.max(0, minMs - (Date.now() - t0));
      timeoutId = window.setTimeout(() => {
        if (cancelled) return;
        startMenuPreloadedRef.current = true;
        setStartMenuReady(true);
      }, wait);
    });
    return () => {
      cancelled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [gameStarted]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "w" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
      }
    };
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (lab) {
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [lab]);

  /** Pinch-to-zoom on map (iOS-style gestures); wheel+ctrl for trackpad pinch. Same behavior portrait/landscape — not tied to `isLandscapeCompact`. Re-binds when a maze exists (ref is absent on first mount before Start / while generating). */
  useEffect(() => {
    if (lab == null) return;
    const el = mazeWrapRef.current;
    if (!el) return;
    const touchDistance = (touches: TouchList) =>
      Math.hypot(touches[1].clientX - touches[0].clientX, touches[1].clientY - touches[0].clientY);

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        pinchStartRef.current = { distance: touchDistance(e.touches), zoom: mazeZoomRef.current };
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinchStartRef.current) {
        e.preventDefault();
        const start = pinchStartRef.current;
        const scale = touchDistance(e.touches) / start.distance;
        const next = Math.max(MAZE_ZOOM_MIN, Math.min(MAZE_ZOOM_MAX, start.zoom * scale));
        setMazeZoom(next);
      }
    };
    const onTouchEndOrCancel = (e: TouchEvent) => {
      if (e.touches.length < 2) pinchStartRef.current = null;
    };

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = -Math.sign(e.deltaY) * 0.15;
        setMazeZoom((z) => Math.max(MAZE_ZOOM_MIN, Math.min(MAZE_ZOOM_MAX, z + delta)));
      }
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEndOrCancel, { passive: true });
    el.addEventListener("touchcancel", onTouchEndOrCancel, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEndOrCancel);
      el.removeEventListener("touchcancel", onTouchEndOrCancel);
      el.removeEventListener("wheel", onWheel);
    };
  }, [lab?.width, lab?.height, lab?.numPlayers, MAZE_ZOOM_MAX, MAZE_ZOOM_MIN]);

  const mazeSimplexNoiseAppliedRef = useRef(false);
  useEffect(() => {
    if (lab == null || MAZE_LITE_TEXTURES || mazeSimplexNoiseAppliedRef.current) return;
    const run = () => {
      const wrap = mazeWrapRef.current;
      if (!wrap || mazeSimplexNoiseAppliedRef.current) return;
      applyMazeSimplexNoiseToElement(wrap);
      mazeSimplexNoiseAppliedRef.current = true;
    };
    requestAnimationFrame(() => requestAnimationFrame(run));
  }, [lab?.width, lab?.height]);

  /** Warm decode for maze tile PNGs so first paint shows textures, not flat fallback colors. */
  useEffect(() => {
    if (lab == null || MAZE_LITE_TEXTURES) return;
    for (const src of [MAZE_FLOOR_TEXTURE, MAZE_FLOOR_MUD_TEXTURE, MAZE_NOISE_TEXTURE, MAZE_WALL_TEXTURE, ...MAZE_STAIN_TEXTURES]) {
      const img = new Image();
      img.src = src;
    }
  }, [lab?.width, lab?.height]);

  useLayoutEffect(() => {
    if (typeof document === "undefined") return;
    const fs = getFullscreenElement();
    if (fs == null) return;
    const isoEl = isoPlayRootRef.current;
    const wrapEl = mazeWrapRef.current;
    const areaEl = mazeAreaRef.current;

    if (mazeMapView === "iso") {
      if (wrapEl != null && fs === wrapEl && areaEl != null && fs !== areaEl) {
        setIsoImmersiveFallback(false);
        void exitDocumentFullscreen();
      }
      return;
    }

    if (isoEl != null && fs === isoEl) {
      setIsoImmersiveFallback(false);
      void exitDocumentFullscreen();
    }
  }, [mazeMapView]);

  useEffect(() => {
    const sync = () => {
      const fs = getFullscreenElement();
      setIsoNativeFsActive(
        fs != null &&
          (fs === isoPlayRootRef.current ||
            fs === mazeWrapRef.current ||
            fs === mazeAreaRef.current),
      );
    };
    if (typeof document === "undefined") return undefined;
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    sync();
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, [mazeMapView]);

  useEffect(() => {
    if (teleportPicker?.sourceType === "magic") {
      setMazeMapView("iso");
    }
  }, [teleportPicker?.sourceType]);

  useLayoutEffect(() => {
    if (!isMobile) {
      setMobileDockInsetPx(0);
      return;
    }
    if (mazeMapView !== "grid") {
      setMobileDockInsetPx(0);
      return;
    }
    const windowedDockLockedOpen = !isoImmersiveUi && !!lab;
    const effectiveMobileExpanded = windowedDockLockedOpen || mobileDockExpanded;
    if (!effectiveMobileExpanded) {
      const el = mobileDockRef.current;
      if (!el) {
        setMobileDockInsetPx(MOBILE_DOCK_COLLAPSED_H);
        return;
      }
      const apply = () => setMobileDockInsetPx(Math.ceil(el.getBoundingClientRect().height));
      apply();
      if (typeof ResizeObserver === "undefined") {
        window.addEventListener("resize", apply);
        return () => window.removeEventListener("resize", apply);
      }
      const ro = new ResizeObserver(apply);
      ro.observe(el);
      window.addEventListener("resize", apply);
      return () => {
        ro.disconnect();
        window.removeEventListener("resize", apply);
      };
    }
    if (!lab) {
      setMobileDockInsetPx(0);
      return;
    }
    const measureExpanded = () => {
      const nodes = [
        mobileDockExpandedHandleRef.current,
        mobileDockExpandedLeftRef.current,
        mobileDockExpandedMovePadRef.current,
      ].filter((n): n is HTMLDivElement => n != null);
      if (nodes.length === 0) {
        setMobileDockInsetPx(MOBILE_DOCK_COLLAPSED_H);
        return;
      }
      const innerH = window.innerHeight;
      let maxFromBottom = 0;
      for (const node of nodes) {
        maxFromBottom = Math.max(maxFromBottom, innerH - node.getBoundingClientRect().top);
      }
      setMobileDockInsetPx(Math.max(MOBILE_DOCK_COLLAPSED_H, Math.ceil(maxFromBottom)));
    };
    measureExpanded();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measureExpanded);
      return () => window.removeEventListener("resize", measureExpanded);
    }
    const ro = new ResizeObserver(measureExpanded);
    for (const node of [
      mobileDockExpandedHandleRef.current,
      mobileDockExpandedLeftRef.current,
      mobileDockExpandedMovePadRef.current,
    ]) {
      if (node) ro.observe(node);
    }
    window.addEventListener("resize", measureExpanded);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measureExpanded);
    };
  }, [isMobile, mazeMapView, mobileDockExpanded, lab, movesLeft, combatState, winner, isoImmersiveUi]);

  useLayoutEffect(() => {
    gamePausedRef.current = gamePaused;
  }, [gamePaused]);

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
    if ((p.catapultCharges ?? 0) > 0) actions.push("catapultCharge");
    const inCombatArtifacts = !!combatState;
    for (const k of STORED_ARTIFACT_ORDER) {
      if (storedArtifactCount(p, k) <= 0) continue;
      if (isStoredArtifactCombatPhaseOnly(k) && !inCombatArtifacts) continue;
      actions.push(k);
    }
    if (actions.length === 0) {
      setMobileDockAction(null);
      return;
    }
    const dockVisuallyExpanded = (!isoImmersiveUi && !!lab) || mobileDockExpanded;
    setMobileDockAction((prev) => {
      if (prev != null && actions.includes(prev)) return prev;
      /** Collapsed strip is artifact-only — do not auto-select bomb. */
      if (!dockVisuallyExpanded) {
        const nonBomb = actions.find((a) => a !== "bomb");
        return nonBomb ?? null;
      }
      return actions[0]!;
    });
  }, [isMobile, lab, currentPlayer, winner, mobileDockExpanded, isoImmersiveUi, combatState]);

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

  const mazeIsoArtifactPickups = useMemo(() => {
    if (!lab) return [];
    const out: { x: number; y: number; kind: StoredArtifactKind }[] = [];
    for (let y = 0; y < lab.height; y++) {
      for (let x = 0; x < lab.width; x++) {
        if (lab.hiddenCells.has(`${x},${y}`)) continue;
        const cell = lab.grid[y]?.[x] ?? "";
        if (!isArtifactCell(cell)) continue;
        const fog = fogIntensityMap.get(`${x},${y}`) ?? 0;
        if (fog > 0.1) continue;
        const kind = storedArtifactKindFromCell(cell);
        if (kind) out.push({ x, y, kind });
      }
    }
    return out;
  }, [lab, fogIntensityMap]);

  const mazeIsoWorldFeaturePickups = useMemo(() => {
    if (!lab) return [];
    const out: { x: number; y: number; url: string }[] = [];
    for (let y = 0; y < lab.height; y++) {
      for (let x = 0; x < lab.width; x++) {
        if (lab.hiddenCells.has(`${x},${y}`)) continue;
        const cell = lab.grid[y]?.[x] ?? "";
        const url = mazeWorldFeatureGlbUrl(cell);
        if (!url) continue;
        const fog = fogIntensityMap.get(`${x},${y}`) ?? 0;
        if (fog > 0.1) continue;
        if (url === MAZE_WORLD_FEATURE_BOMB_GLB && lab.hasCollectedBombFrom(currentPlayer, x, y)) continue;
        out.push({ x, y, url });
      }
    }
    return out;
  }, [lab, fogIntensityMap, currentPlayer]);

  const scheduleDraculaAction = useCallback((mi: number, action: "teleport" | "attack", delayMs: number) => {
    setTimeout(() => {
      // Active fight / mid-roll / pause only — omit combatResult so reward UI does not block map resolution.
      const shouldSkipResolve =
        gamePausedRef.current ||
        combatStateRef.current ||
        pendingCombatOfferRef.current ||
        combatContinuesAfterRollRef.current;

      if (shouldSkipResolve) {
        setLab((prev2) => {
          if (!prev2 || winnerRef.current !== null) return prev2;
          const next2 = cloneLabSnapshotForDracula(prev2);
          releaseDraculaTelegraphIfPending(next2, mi);
          return next2;
        });
        return;
      }
      setLab((prev2) => {
        if (!prev2 || winnerRef.current !== null) return prev2;
        const next2 = cloneLabSnapshotForDracula(prev2);
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
                pendingMazeDraculaBiteRef.current = { hpAfter: p.hp, lethal: p.hp <= 0 };
                if (p.hp <= 0) {
                  // Lethal: eliminate (no silent respawn). Solo → game over overlay; MP → pass turn if anyone left.
                  next2.eliminatedPlayers.add(targetIdx);
                  if (next2.eliminatedPlayers.size >= next2.numPlayers) {
                    pendingDraculaEliminationRef.current = { allDead: true };
                  } else {
                    let nextP = (targetIdx + 1) % next2.numPlayers;
                    while (next2.eliminatedPlayers.has(nextP) && nextP !== targetIdx) {
                      nextP = (nextP + 1) % next2.numPlayers;
                    }
                    pendingDraculaEliminationRef.current = { allDead: false, nextP };
                  }
                }
              }
            }
            // Keep `attack` state briefly for renderer this tick, then continue AI flow.
            if (d.draculaState === "attack") {
              d.draculaState = "recover";
            }
          }
        }
        return next2;
      });
    }, delayMs);
  }, []);

  /** Before useEffects (idle auto-pick timer): ref must match state so async callbacks see the open picker. */
  useLayoutEffect(() => {
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

  /** Logging only — refs for combat/lab/moves are synced during render (after `lab` exists) so monster AI intervals never see stale combatStateRef=null while combat is open. */
  useEffect(() => {
    combatLog("combatStateRef sync", combatState ? `OPEN (player ${combatState.playerIndex} vs monster ${combatState.monsterIndex})` : "CLOSED");
  }, [combatState]);
  useEffect(() => {
    if (combatState || combatResult) return;
    setIsoCombatRollFace(null);
    setIsoCombatPlayerCue(null);
  }, [combatState, combatResult]);
  useEffect(() => () => {
    if (isoCombatPulseTimerRef.current) clearTimeout(isoCombatPulseTimerRef.current);
  }, []);
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
  useLayoutEffect(() => {
    if (!combatState || !lab) return;
    if (combatResult) {
      combatLog("cancel-check: SKIP — combatResult present (victory/defeat)");
      return;
    }
    if (combatFooterSnapshot) {
      combatLog("cancel-check: SKIP — combatFooterSnapshot present (roll again)");
      return;
    }
    // Set in setLab before commit (e.g. skeleton shield break) — layout effects run after lab commit but before POST-setLab sets footer; without this we closed combat mid-flushSync.
    if (combatContinuesAfterRollRef.current) {
      combatLog("cancel-check: SKIP — combatContinuesAfterRollRef (roll resolution still finishing)");
      return;
    }
    const pi = combatState.playerIndex;
    const mi = combatState.monsterIndex;
    const p = lab.players[pi];
    const m = mi >= 0 && mi < lab.monsters.length ? lab.monsters[mi] : undefined;
    if (p && m && p.x === m.x && p.y === m.y) {
      combatLog("cancel-check: SKIP — indexed monster still on player (fight active)");
      return;
    }
    /** Skeleton shield break moves player and monster to different tiles — no same-cell collision while the fight is still valid. */
    if (
      m &&
      m.type === combatState.monsterType &&
      (m.hp ?? getMonsterMaxHp(combatState.monsterType)) > 0
    ) {
      combatLog("cancel-check: SKIP — indexed monster still alive (off-tile encounter, e.g. after skeleton shield)");
      return;
    }
    const collision = lab.checkMonsterCollision(pi);
    combatLog("cancel-check", {
      hasCombatState: !!combatState,
      collision,
      playerPos: p ? [p.x, p.y] : null,
      indexedMonsterPos: m ? [m.x, m.y] : null,
    });
    if (!collision) {
      combatLog("cancel-check: CLOSING — no collision (monster gone or player moved). setCombatState(null)");
      setCombatState(null);
      setDefeatedMonsterOnCell(null);
      setCombatUseShield(true);
      setCombatUseDiceBonus(true);
    }
  }, [lab, combatState, combatResult, combatFooterSnapshot]);

  /** If turn advances without clearing combat (e.g. End turn during fight), combatState can reference the wrong player — modal hides but refs still block input. */
  useEffect(() => {
    if (!combatState || combatState.playerIndex === currentPlayer) return;
    combatLog("stale combatState vs currentPlayer — clearing", { combatPi: combatState.playerIndex, currentPlayer });
    setCombatState(null);
    setCombatFooterSnapshot(null);
    setRolling(false);
  }, [combatState, currentPlayer]);

  // Init combat options when combat starts (default: use if available)
  const prevCombatKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!combatState || !lab) {
      prevCombatKeyRef.current = null;
      return;
    }
    const key = `${combatState.playerIndex}-${combatState.monsterIndex}-${combatState.monsterType}-${combatState.sessionId}`;
    if (prevCombatKeyRef.current === key) return;
    prevCombatKeyRef.current = key;
    if (strikeLabCommitTimerRef.current != null) {
      clearTimeout(strikeLabCommitTimerRef.current);
      strikeLabCommitTimerRef.current = null;
    }
    setCombatStrikeHpHold(null);
    setRolling(false); // Ensure not stuck in "Rolling..." when combat opens
    combatDiceRerollReservedRef.current = false;
    setCombatDiceRerollReserved(false);
    combatStrikeIsRerollRef.current = false;
    pendingArtifactRerollRef.current = null;
    setCombatArtifactRerollPrompt(false);
    combatHasRolledRef.current = false;
    combatStrikeTargetDuringRollRef.current = null;
    combatStrikeDiceOutcomeKnownRef.current = false;
    lastCombatRecoveryClipFinishMs.current = 0;
    setCombatFooterSnapshot(null);
    setCombatRecoveryPhase("ready");
    setIsoCombatRollFace(null);
    setIsoCombatPlayerCue(null);
    const stance = rollCombatSurprise();
    combatSurpriseRef.current = stance;
    setCombatMonsterStance(stance);
    setCombatVictoryPhase("hurt");
    const p = lab.players[combatState.playerIndex];
    setCombatUseShield((p?.shield ?? 0) > 0);
    setCombatUseDiceBonus(false);
    combatHolyStrikeBonusRef.current = 0;
  }, [combatState, lab]);

  useEffect(() => {
    if (combatState) return;
    if (strikeLabCommitTimerRef.current != null) {
      clearTimeout(strikeLabCommitTimerRef.current);
      strikeLabCommitTimerRef.current = null;
    }
    setCombatStrikeHpHold(null);
  }, [combatState]);

  useEffect(() => {
    rollingRef.current = rolling;
  }, [rolling]);

  // Victory phase: 2D uses a short hurt beat then defeated sprite. 3D merged monsters already played kill + fall on the last strike — stay on `defeated` only (no second hurt→fall sequence on the result screen).
  useEffect(() => {
    if (combatState) {
      setCombatVictoryPhase("hurt");
      return;
    }
    if (!combatResult?.won) {
      setCombatVictoryPhase("hurt");
      return;
    }
    const use3dVictory =
      isMonster3DEnabled() &&
      combatResult.monsterType != null &&
      getMonsterGltfPath(combatResult.monsterType, "idle") != null;
    if (use3dVictory) {
      setCombatVictoryPhase("defeated");
      return;
    }
    setCombatVictoryPhase("hurt");
    const t = setTimeout(() => setCombatVictoryPhase("defeated"), COMBAT_VICTORY_HURT_TO_DEFEATED_MS_2D);
    return () => clearTimeout(t);
  }, [combatState, combatResult?.won, combatResult?.monsterType]);

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
    const maxP = MULTIPLAYER_ENABLED ? 10 : 1;
    const n = Math.min(Math.max(1, numPlayers), maxP);
    if (n !== numPlayers) {
      setNumPlayers(n);
      return;
    }
    setPlayerNames((prev) => {
      if (prev.length === n) return prev;
      if (prev.length < n) {
        return [
          ...prev,
          ...Array.from({ length: n - prev.length }, (_, i) => `Player ${prev.length + i + 1}`),
        ];
      }
      return prev.slice(0, n);
    });
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

  /** After teleport or slingshot, center the map on the current player (ref updates once lab re-renders). */
  useEffect(() => {
    if (!teleportAnimation && !catapultAnimation) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        currentPlayerCellRef.current?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [teleportAnimation, catapultAnimation]);

  useEffect(() => {
    if (!jumpAnimation) return;
    const t = setTimeout(() => setJumpAnimation(null), 500);
    return () => clearTimeout(t);
  }, [jumpAnimation]);

  useEffect(() => {
    if (playerAvatarHitFlash === null) return;
    const t = setTimeout(() => setPlayerAvatarHitFlash(null), 650);
    return () => clearTimeout(t);
  }, [playerAvatarHitFlash]);

  useEffect(() => {
    if (draculaAttacked === null) return;
    setPlayerAvatarHitFlash({ playerIndex: draculaAttacked, seq: Date.now() });
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

  /** Win: gate on death anim; then reveal bonus picker (still no UI until `bonusLootRevealed`). */
  useEffect(() => {
    if (!pendingCombatBonusPick) {
      setBonusLootRevealed(false);
      return;
    }
    if (!combatVictoryDeathAnimReady) {
      setBonusLootRevealed(false);
      return;
    }
    const t = setTimeout(() => setBonusLootRevealed(true), 220);
    return () => clearTimeout(t);
  }, [pendingCombatBonusPick, combatVictoryDeathAnimReady]);

  useEffect(() => {
    if (combatResult == null) {
      setCombatVictoryDeathAnimReady(false);
      return;
    }
    if (!combatResult.won) {
      setCombatVictoryDeathAnimReady(true);
      return;
    }
    const use3dWin =
      isMonster3DEnabled() &&
      combatResult.monsterType != null &&
      getMonsterGltfPath(combatResult.monsterType, "idle") != null;
    setCombatVictoryDeathAnimReady(use3dWin);
  }, [
    combatResult == null,
    combatResult?.won,
    combatResult?.monsterType,
    combatResult?.playerIndex,
    combatResult?.playerDefeated,
  ]);

  useEffect(() => {
    if (!combatResult?.won) return;
    const is3d =
      isMonster3DEnabled() &&
      combatResult.monsterType != null &&
      getMonsterGltfPath(combatResult.monsterType, "idle") != null;
    if (is3d) return;
    if (combatVictoryPhase !== "defeated") return;
    const t = setTimeout(() => setCombatVictoryDeathAnimReady(true), 480);
    return () => clearTimeout(t);
  }, [combatResult?.won, combatResult?.monsterType, combatVictoryPhase]);

  useEffect(() => {
    if (healingGained === null) return;
    const t = setTimeout(() => setHealingGained(null), 1500);
    return () => clearTimeout(t);
  }, [healingGained]);

  useEffect(() => {
    if (harmTaken === null) return;
    if (harmTaken === true) setPlayerAvatarHitFlash({ playerIndex: currentPlayerRef.current, seq: Date.now() });
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
    if (torchGained === null) return;
    const t = setTimeout(() => setTorchGained(null), 1500);
    return () => clearTimeout(t);
  }, [torchGained]);

  const getDimensions = useCallback(() => {
    return mazeSize;
  }, [mazeSize]);

  const newGame = useCallback((opts?: { initSource?: string }) => {
    const initSource = opts?.initSource ?? "procedural";
    const n = MULTIPLAYER_ENABLED ? Math.min(Math.max(1, numPlayers), 9) : 1;
    const size = getDimensions();
    const extraPaths = Math.max(4, n * 2);
    const l = new Labyrinth(size, size, extraPaths, n, difficulty, firstMonsterType);
    l.generate();
    newGameLog("session_start", buildMazeSessionLogPayload(l, {
      initSource,
      generator: "procedural",
      requestedMazeSize: size,
      configuredExtraPaths: extraPaths,
      configuredNumPlayers: n,
      configuredDifficulty: difficulty,
      configuredFirstMonsterType: firstMonsterType,
    }));
    if (teleportTimerRef.current) {
      clearTimeout(teleportTimerRef.current);
      teleportTimerRef.current = null;
    }
    if (hiddenGemTeleportTimerRef.current) {
      clearTimeout(hiddenGemTeleportTimerRef.current);
      hiddenGemTeleportTimerRef.current = null;
    }
    if (turnChangePauseTimerRef.current) {
      clearTimeout(turnChangePauseTimerRef.current);
      turnChangePauseTimerRef.current = null;
    }
    setLab(l);
    setCurrentPlayer(0);
    setMazeMapView("iso");
    setPlayerFacing({});
    movesLeftRef.current = 0;
    setMovesLeft(0);
    setTotalMoves(0);
    setPlayerTurns(Array(n).fill(0));
    setPlayerMoves(Array(n).fill(0));
    setDiceResult(null);
    setWinner(null);
    setGameOverReason("monsters");
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
    setDraculaAttacked(null);
    setMazeDraculaBiteBanner(null);
    pendingMazeDraculaBiteRef.current = null;
    setTeleportAnimation(null);
    setJumpAnimation(null);
    setTeleportPicker(null);
    manualTeleportPendingRef.current = false;
    setSuppressMagicPortalUntilMove(false);
    setCatapultPicker(null);
    setCatapultMode(false);
    setPassThroughMagic(false);
    setCatapultDragOffset(null);
    setCatapultAnimation(null);
    setBombExplosion(null);
    setCombatState(null);
    pendingCombatOfferRef.current = null;
    setPendingCombatOffer(null);
    setCombatResult(null);
    setBonusLootRevealed(false);
    setDefeatedMonsterOnCell(null);
    setCollisionEffect(null);
    combatHasRolledRef.current = false;
    setLastCombatStrikeDiceFace(null);
    setRolling(false);
    if (
      !grantInfiniteMovesIfTemp({
        movesLeftRef,
        setMovesLeft,
        setDiceResult,
        setShowDiceModal,
        setRolling,
      })
    ) {
    setShowDiceModal(true);
    }
  }, [getDimensions, numPlayers, difficulty, firstMonsterType]);

  const generateWithAI = useCallback(async () => {
    const n = MULTIPLAYER_ENABLED ? Math.min(Math.max(1, numPlayers), 9) : 1;
    const numPaths = n * 2;
    setError("Generating maze...");
    try {
      const res = await fetch("api/generate-maze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          numPaths,
          width: getDimensions(),
          height: getDimensions(),
        }),
      });
      let data: {
        error?: string;
        grid?: string[][];
        width?: number;
        height?: number;
      } = {};
      try {
        data = await res.json();
      } catch {
        if (!res.ok) {
          setError(
            "AI maze needs a server (not included in the itch.io build). Using random maze."
          );
          newGame({ initSource: "ai_fallback_no_json_response" });
          return;
        }
        throw new Error("Invalid response");
      }
      if (!res.ok) {
        setError(data.error || "API error");
        return;
      }
      const size = getDimensions();
      const w = data.width ?? size;
      const h = data.height ?? size;
      const l = new Labyrinth(w, h, 0, n, difficulty, firstMonsterType);
      if (data.grid && l.loadGrid(data.grid)) {
        newGameLog("session_start", buildMazeSessionLogPayload(l, {
          initSource: "ai_api_grid",
          generator: "api_generate_maze",
          requestedMazeSize: size,
          apiGridWidth: w,
          apiGridHeight: h,
          apiGridRowCount: data.grid.length,
          requestedNumPaths: numPaths,
        }));
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
        setMazeMapView("iso");
        setPlayerFacing({});
        showMovementDiceOrInfinite({
          movesLeftRef,
          setMovesLeft,
          setDiceResult,
          setShowDiceModal,
          setRolling,
        });
        setTotalMoves(0);
        setPlayerTurns(Array(n).fill(0));
        setPlayerMoves(Array(n).fill(0));
        setWinner(null);
        setGameOverReason("monsters");
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
        setMazeDraculaBiteBanner(null);
        pendingMazeDraculaBiteRef.current = null;
        setTeleportAnimation(null);
        setCatapultMode(false);
        setCatapultPicker(null);
        setPassThroughMagic(false);
        setCatapultDragOffset(null);
        setCatapultAnimation(null);
        setBombExplosion(null);
        setCombatState(null);
        pendingCombatOfferRef.current = null;
        setPendingCombatOffer(null);
        setCombatResult(null);
        setBonusLootRevealed(false);
        setDefeatedMonsterOnCell(null);
      } else {
        setError("Invalid maze from AI, using random maze.");
        newGame({ initSource: "ai_fallback_invalid_grid" });
      }
    } catch (e) {
      setError(
        "Failed to reach API: " + (e instanceof Error ? e.message : "network error")
      );
      newGame({ initSource: "ai_fallback_fetch_error" });
    }
  }, [getDimensions, numPlayers, newGame, difficulty, firstMonsterType]);

  const handleCombatRollComplete = useCallback((value: number) => {
    combatDicePhysicsInFlightRef.current = false;
    const combat = combatStateRef.current;
    if (!combat) {
      combatLog("handleCombatRollComplete: no combat state, ignoring");
      setRolling(false);
      return;
    }
    combatLog("--- ROLL COMPLETE ---", { dice: value, monsterType: combat.monsterType, monsterIdx: combat.monsterIndex });
    const labNow = labRef.current;
    if (!labNow) {
      combatLog("handleCombatRollComplete: no lab ref, ignoring");
      setRolling(false);
      return;
    }
    if (combatRollResolveInProgressRef.current) {
      combatLog("handleCombatRollComplete: duplicate onRollComplete ignored");
      return;
    }
    combatRollResolveInProgressRef.current = true;
    try {
    const p = labNow.players[combat.playerIndex];
    const holyStrike = combatHolyStrikeBonusRef.current;
    combatHolyStrikeBonusRef.current = 0;
    const effectiveRoll = value + holyStrike;
    const monster = labNow.monsters[combat.monsterIndex];
    const skeletonHasShield = combat.monsterType === "K" && (monster?.hasShield ?? true);
    const surpriseState = combatSurpriseRef.current;
    const surpriseModifier = getSurpriseDefenseModifier(surpriseState);

    const revealStrikeDiceToPlayer = (v: number) => {
      setLastCombatStrikeDiceFace(v);
      setIsoCombatRollFace(v);
    };

    if (value === 6) {
      combatStrikeDiceOutcomeKnownRef.current = true;
      revealStrikeDiceToPlayer(value);
      combatLog("dice 6 → instant kill, bypassing strike selection");
      combatStrikeTargetDuringRollRef.current = null;
      const result = resolveCombat(effectiveRoll, 0, combat.monsterType, false, surpriseModifier, value, surpriseState, undefined, false);
      combatLog("resolveCombat result", { won: result.won, instantWin: result.instantWin });
      try {
        resolveAfterDice(result, p, value);
      } catch (err) {
        console.error("[COMBAT] resolveAfterDice threw (dice 6):", err);
        setRolling(false);
      }
      return;
    }

    combatLog("dice 1-5 → strike resolve", { value, effectiveRoll });
    const pickedDuringRoll = combatStrikeTargetDuringRollRef.current;
    combatStrikeTargetDuringRollRef.current = null;
    combatStrikeDiceOutcomeKnownRef.current = true;

    revealStrikeDiceToPlayer(value);

    if (pickedDuringRoll != null) {
      const result = resolveCombat(
        effectiveRoll,
        0,
        combat.monsterType,
        false,
        surpriseModifier,
        value,
        surpriseState,
        pickedDuringRoll,
        false
      );
      try {
        resolveAfterDice(result, p, value, pickedDuringRoll);
      } catch (err) {
        console.error("[COMBAT] resolveAfterDice threw (strike during roll):", err);
        setRolling(false);
      }
      setRolling(false);
      return;
    }

    const result = resolveCombat(
      effectiveRoll,
      0,
      combat.monsterType,
      false,
      surpriseModifier,
      value,
      surpriseState,
      undefined,
      true
    );
    try {
      resolveAfterDice(result, p, value);
    } catch (err) {
      console.error("[COMBAT] resolveAfterDice threw (timing miss, no strike during roll):", err);
      setRolling(false);
    }
    setRolling(false);
    } catch (err) {
      console.error("[COMBAT] handleCombatRollComplete threw:", err);
      setRolling(false);
    } finally {
      combatRollResolveInProgressRef.current = false;
    }
  }, []);

  const handleStrikeTargetPick = useCallback((target: StrikeTarget) => {
    if (!rollingRef.current) return;
    if (combatStrikeDiceOutcomeKnownRef.current) return;
    combatStrikeTargetDuringRollRef.current = target;
  }, []);

  function resolveAfterDice(result: CombatResult, p: Parameters<typeof storedArtifactCount>[0] | undefined, value: number, strikeTarget?: StrikeTarget) {

    function applyPost(resolveResult: CombatResult) {
      combatStrikeIsRerollRef.current = false;
      const c = combatStateRef.current;
      if (!c) return;
      const labSnap = labRef.current;
      if (!labSnap) return;
      const mon = labSnap.monsters[c.monsterIndex];
      const maxHpM = getMonsterMaxHp(c.monsterType);
      const monsterHp = mon?.hp ?? maxHpM;
      const pl = labSnap.players[c.playerIndex];
      const result = resolveResult;
      const combat = c;
      const p = pl;
      /** Stale staggered `flushCombatLab` after combat end / new encounter / HMR must not mutate `lab` or call `runAfterLabCommit`. */
      const encounterFlushGuard = {
        sessionId: combat.sessionId,
        playerIndex: combat.playerIndex,
        monsterIndex: combat.monsterIndex,
      } as const;
      /** Do not setRolling(false) before flushSync(setLab) — one frame would show rolling=false with stale monster HP (idle at full) then recover after lab updates. */
      combatContinuesAfterRollRef.current = false;
      let shieldAbsorbedFlag = false;

      const gdam = result.glancingDamage ?? 0;
      const playerHpBeforeRoll = p?.hp ?? DEFAULT_PLAYER_HP;
      const { rawMonsterHp, rawPlayerHp } = computeCombatHpExchangeRaw(result, monsterHp);
      const shieldWouldAbsorb =
        !result.won &&
        combatUseShieldRef.current &&
        (p?.shield ?? 0) > 0 &&
        rawPlayerHp > 0;
      const rawPlayerEffective = shieldWouldAbsorb ? 0 : rawPlayerHp;
      const { netMonsterHp, netPlayerHp } = computeNetHpLoss(rawMonsterHp, rawPlayerEffective);
      const monsterHpAfterStrike = Math.max(0, monsterHp - netMonsterHp);
      /** Monster eliminated by this roll’s net exchange with no player HP loss (e.g. pure glancing kill). */
      const fatalGlancingKill =
        !result.won &&
        gdam > 0 &&
        monsterHp > 0 &&
        monsterHpAfterStrike <= 0 &&
        netPlayerHp === 0;
      const glancingMonsterSurvives = !result.won && gdam > 0 && monsterHpAfterStrike > 0;
      const wonMonsterSurvivesPartial =
        result.won &&
        !result.instantWin &&
        monsterHp > Math.max(1, result.monsterHpLoss ?? 1);
      const ghostContinues = !result.won && result.monsterEffect === "ghost_evade";
      const playerHitSurvives =
        !result.won &&
        !fatalGlancingKill &&
        netPlayerHp > 0 &&
        !shieldWouldAbsorb &&
        playerHpBeforeRoll - netPlayerHp > 0;
      const missDmgPre = shieldWouldAbsorb ? 0 : netPlayerHp;
      const monsterSlainThisRoll =
        monsterHp > 0 && monsterHpAfterStrike <= 0 && (result.won || netMonsterHp > 0);
      const resolveSaysEncounterContinues =
        !monsterSlainThisRoll &&
        (result.monsterEffect === "skeleton_shield" ||
        glancingMonsterSurvives ||
        wonMonsterSurvivesPartial ||
        ghostContinues ||
        shieldWouldAbsorb ||
          playerHitSurvives);

      combatLog("applyPost branch flags", {
        skeletonShield: result.monsterEffect === "skeleton_shield",
        fatalGlancingKill,
        glancingMonsterSurvives,
        wonMonsterSurvivesPartial,
        ghostContinues,
        shieldWouldAbsorb,
        playerHitSurvives,
        resolveSaysEncounterContinues,
      });

      let strikePortrait: CombatStrikePortrait = "other";
      let draculaAttackSegment: "spell" | "skill" | "light" | undefined;

      const strikeToSegment: Record<string, "spell" | "skill" | "light"> = {
        head: "spell",
        body: "skill",
        legs: "light",
      };

      if (shieldWouldAbsorb) {
        strikePortrait = "shield";
      } else if (monsterSlainThisRoll) {
        strikePortrait = "defeated";
      } else if ((combat.monsterType === "K" || combat.monsterType === "Z" || combat.monsterType === "S") && !result.won && !result.instantWin) {
        if (value <= 3) {
          strikePortrait = "monsterHit";
          draculaAttackSegment = value === 1 ? "spell" : value === 2 ? "skill" : "light";
      } else {
          strikePortrait = "playerHit";
        }
      } else {
        let monsterHpDealtThisRoll = 0;
        if (result.won) {
          if (result.instantWin) monsterHpDealtThisRoll = monsterHp;
          else if (result.monsterHpLoss != null) monsterHpDealtThisRoll = Math.max(0, result.monsterHpLoss);
          else monsterHpDealtThisRoll = 1;
        } else {
          monsterHpDealtThisRoll = gdam;
        }
        const playerDmgThisRoll = missDmgPre;
        const monsterLostMoreHpThanPlayer = monsterHpDealtThisRoll > playerDmgThisRoll;
        if (monsterLostMoreHpThanPlayer && monsterHpDealtThisRoll > 0) {
          if (result.won) {
            const loss = result.instantWin ? monsterHp : Math.max(1, result.monsterHpLoss ?? 1);
            const nh = result.instantWin ? 0 : Math.max(0, monsterHp - loss);
            strikePortrait =
              nh >= 1 && nh <= 2 ? "playerHitHeavy" : "playerHit";
          } else if (gdam > 0) {
            const nh = Math.max(0, monsterHp - gdam);
            strikePortrait =
              nh >= 1 && nh <= 2 ? "playerHitHeavy" : "playerHit";
          } else {
            strikePortrait = "other";
          }
        } else if (playerDmgThisRoll > 0) {
          strikePortrait = "monsterHit";
          if (
            combat.monsterType === "V" ||
            combat.monsterType === "K" ||
            combat.monsterType === "Z" ||
            combat.monsterType === "G" ||
            combat.monsterType === "S" ||
            combat.monsterType === "L"
          ) {
            draculaAttackSegment = draculaStrikeAttackVariantRef.current;
            {
              const cur = draculaStrikeAttackVariantRef.current;
              draculaStrikeAttackVariantRef.current =
                cur === "spell" ? "skill" : cur === "skill" ? "light" : "spell";
            }
          }
        } else {
          strikePortrait = "other";
        }
      }
      if (strikeTarget && strikeToSegment[strikeTarget]) {
        draculaAttackSegment = strikeToSegment[strikeTarget];
      }

      const merged3dSpellSegmentMonster =
        combat.monsterType === "V" ||
        combat.monsterType === "K" ||
        combat.monsterType === "Z" ||
        combat.monsterType === "G" ||
        combat.monsterType === "S" ||
        combat.monsterType === "L";
      /**
       * Lethal strike on the monster only set `strikePortrait === "defeated"` — `draculaAttackSegment`
       * stayed unset (e.g. dice-6 instant kill skips strike target). Player 3D maps monster defeated →
       * `angry`; without a segment, `playerAttackVariant` fell through to **light**, so Jumping_Punch
       * sat last in `PLAYER_ANGRY_LIGHT` and rarely played. Default **spell** for the finisher jump tier.
       */
      if (monsterSlainThisRoll && merged3dSpellSegmentMonster && draculaAttackSegment == null) {
        draculaAttackSegment = "spell";
      }
      const playerFatalJumpKill =
        merged3dSpellSegmentMonster &&
        strikePortrait === "monsterHit" &&
        draculaAttackSegment === "spell" &&
        !result.won &&
        !fatalGlancingKill &&
        !shieldWouldAbsorb &&
        missDmgPre > 0 &&
        playerHpBeforeRoll - missDmgPre <= 0;

      if (typeof window !== "undefined" && mazeMapViewRef.current === "iso") {
        const cue = mapIsoCombatPlayerAnimCue({
          dice: value,
          strikePortrait,
          draculaAttackSegment,
          shieldWouldAbsorb,
          playerFatalJumpKill,
        });
        setIsoCombatPlayerCue(cue);
        if (isoCombatPulseTimerRef.current) {
          clearTimeout(isoCombatPulseTimerRef.current);
          isoCombatPulseTimerRef.current = null;
        }
        // Same frame as cue so maze avatar strikes with the combat beat (no 120ms idle lag).
        setIsoCombatPulseVersion((x) => x + 1);
      } else {
        if (isoCombatPulseTimerRef.current) {
          clearTimeout(isoCombatPulseTimerRef.current);
          isoCombatPulseTimerRef.current = null;
        }
        setIsoCombatPlayerCue(null);
      }

      const staggerLabCommitMs =
        isMonster3DEnabled() &&
        (combat.monsterType === "V" ||
          combat.monsterType === "K" ||
          combat.monsterType === "Z" ||
          combat.monsterType === "G" ||
          combat.monsterType === "S" ||
          combat.monsterType === "L")
          ? COMBAT_STRIKE_LAB_COMMIT_DELAY_MS_MERGED_MESHY_3D
          : isMonster3DEnabled()
            ? COMBAT_STRIKE_LAB_COMMIT_DELAY_MS
            : 0;
      const monsterHpLostNet = Math.max(0, monsterHp - monsterHpAfterStrike);
      const summaryStrikePreview =
        shieldWouldAbsorb
          ? `🛡 Shield blocked ${Math.max(0, result.damage ?? 0)} damage — no HP lost. Monster still fighting!`
            : result.won
              ? `${getMonsterName(combat.monsterType)} hit — −${result.monsterHpLoss ?? 1} HP! Roll again!`
              : result.monsterEffect === "ghost_evade"
                ? "👻 Ghost evaded — you took damage. Roll again!"
                : `${monsterHpLostNet > 0 && !result.won ? `⚔️ ${getMonsterName(combat.monsterType)} −${monsterHpLostNet} HP (net). ` : ""}${formatMonsterCounterattackDamageLine(combat.monsterType, missDmgPre, monsterHpLostNet > 0)}Roll again or run!`;

      const runAfterLabCommit = () => {
        if (pendingPlayerDamageHighlightIndexRef.current !== null) {
          const hi = pendingPlayerDamageHighlightIndexRef.current;
          pendingPlayerDamageHighlightIndexRef.current = null;
          setPlayerAvatarHitFlash({ playerIndex: hi, seq: Date.now() });
        }

        if (playerDefeatedInCombatRef.current) {
          combatLog("POST-setLab: player defeated — clear combatState so defeat UI + next player roll work");
          playerDefeatedInCombatRef.current = false;
          setCombatUseShield(true);
          setCombatUseDiceBonus(true);
          setCombatFooterSnapshot(null);
          setCombatState(null);
          setRolling(false);
          return;
        }

        const fromStagger = combatPostLabFromStaggerRef.current;
        combatPostLabFromStaggerRef.current = false;

        if (combatContinuesAfterRollRef.current || resolveSaysEncounterContinues) {
          if (resolveSaysEncounterContinues && !combatContinuesAfterRollRef.current) {
            combatLog("POST-setLab: forcing continue path from resolve snapshot (ref not set yet or glancing/ghost/partial)");
          }
          combatLog("POST-setLab: combat continues — setCombatFooterSnapshot, combatState STAYS", {
            combatContinuesRef: combatContinuesAfterRollRef.current,
            resolveSaysEncounterContinues,
          });
          setCombatResult(null);
          const monsterLostFooter = Math.max(0, monsterHp - monsterHpAfterStrike);
          const glancePart =
            monsterLostFooter > 0 && !result.won
              ? `⚔️ ${getMonsterName(combat.monsterType)} −${monsterLostFooter} HP (net). `
              : "";
          const missDmg = Math.max(0, result.damage ?? 0);
          const summary = shieldAbsorbedFlag
            ? `🛡 Shield blocked ${Math.max(0, result.damage ?? 0)} damage — no HP lost. Monster still fighting!`
              : result.won
                ? `${getMonsterName(combat.monsterType)} hit — −${result.monsterHpLoss ?? 1} HP! Roll again!`
                : result.monsterEffect === "ghost_evade"
                  ? "👻 Ghost evaded — you took damage. Roll again!"
                  : `${glancePart}${formatMonsterCounterattackDamageLine(combat.monsterType, missDmg, monsterLostFooter > 0)}Roll again or run!`;
          const glancingHp =
            !result.won && monsterHpAfterStrike < monsterHp
              ? { monsterHp: monsterHpAfterStrike, monsterMaxHp: maxHpM }
              : {};
          const meshyStrikeFooterExtras = {
            ...(strikeTarget ? { strikeTargetPick: strikeTarget } : {}),
            ...(strikePortrait === "monsterHit" && missDmgPre > 0 ? { playerHpLost: missDmgPre } : {}),
          };
          if (fromStagger) {
            setCombatFooterSnapshot({
              playerRoll: result.playerRoll,
              attackTotal: result.attackTotal,
              monsterDefense: result.monsterDefense,
              summary,
              strikePortrait,
              ...(draculaAttackSegment ? { draculaAttackSegment } : {}),
              ...(playerFatalJumpKill ? { playerFatalJumpKill: true } : {}),
              ...draculaPlayerHitHurt3dFooterExtra(combat.monsterType, strikePortrait, monsterHpAfterStrike, maxHpM),
              ...glancingHp,
              ...meshyStrikeFooterExtras,
            });
          } else {
            setCombatFooterSnapshot({
              playerRoll: result.playerRoll,
              attackTotal: result.attackTotal,
              monsterDefense: result.monsterDefense,
              summary,
              strikePortrait,
              ...(draculaAttackSegment ? { draculaAttackSegment } : {}),
              ...(playerFatalJumpKill ? { playerFatalJumpKill: true } : {}),
              ...draculaPlayerHitHurt3dFooterExtra(combat.monsterType, strikePortrait, monsterHpAfterStrike, maxHpM),
              ...glancingHp,
              ...meshyStrikeFooterExtras,
            });
            setCombatRecoveryPhase("hurt");
            lastCombatRecoveryClipFinishMs.current = 0;
            combatHasRolledRef.current = false;
            const stance = rollCombatSurprise();
            combatSurpriseRef.current = stance;
            setCombatMonsterStance(stance);
          }
        } else {
          combatLog("POST-setLab: encounter ended — clear footer + combatState (victory/defeat handled via combatResult / player defeat)", {
            combatContinuesRef: combatContinuesAfterRollRef.current,
            resolveSaysEncounterContinues,
            hasCombatResult: combatResultRef.current != null,
          });
          setCombatFooterSnapshot(null);
          combatSurpriseRef.current = "hunt";
          setCombatState(null);
        }
        setCombatUseShield(true);
        setCombatUseDiceBonus(true);
        if (staggerLabCommitMs === 0) setRolling(false);
      };

      const flushCombatLab = () => {
        const liveCombat = combatStateRef.current;
        if (
          !liveCombat ||
          liveCombat.sessionId !== encounterFlushGuard.sessionId ||
          liveCombat.playerIndex !== encounterFlushGuard.playerIndex ||
          liveCombat.monsterIndex !== encounterFlushGuard.monsterIndex
        ) {
          combatLog("flushCombatLab: ABORT — encounter mismatch or combat closed (stale stagger/HMR)", {
            expected: encounterFlushGuard,
            live: liveCombat
              ? {
                  sessionId: liveCombat.sessionId,
                  playerIndex: liveCombat.playerIndex,
                  monsterIndex: liveCombat.monsterIndex,
                }
              : null,
          });
          if (strikeLabCommitTimerRef.current != null) {
            clearTimeout(strikeLabCommitTimerRef.current);
            strikeLabCommitTimerRef.current = null;
          }
          setCombatStrikeHpHold(null);
          setRolling(false);
          return;
        }
      flushSync(() => {
        pendingPlayerDamageHighlightIndexRef.current = null;
      setLab((prev) => {
        if (!prev || winnerRef.current !== null) return prev;
        const next = new Labyrinth(prev.width, prev.height, 0, prev.numPlayers, prev.monsterDensity, prev.firstMonsterType);
        next.grid = prev.grid.map((r) => [...r]);
        next.players = prev.players.map((p) => ({
          ...p,
          jumps: p.jumps ?? 0,
          diamonds: p.diamonds ?? 0,
          shield: p.shield ?? 0,
          bombs: p.bombs ?? 0,
          hp: p.hp ?? DEFAULT_PLAYER_HP,
          artifacts: p.artifacts ?? 0,
          diceBonus: p.diceBonus ?? 0,
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
        let usedShieldForNet = false;
        const maxHpCombat = getMonsterMaxHp(combat.monsterType);
        const curMonsterHpBeforeNet = m ? (m.hp ?? maxHpCombat) : 0;
        const { rawMonsterHp, rawPlayerHp } = computeCombatHpExchangeRaw(result, curMonsterHpBeforeNet);

        if (!result.won && rawPlayerHp > 0 && combatUseShieldRef.current) {
          usedShieldForNet = next.tryConsumeShield(pi);
        }
        const rawPlayerEff = usedShieldForNet ? 0 : rawPlayerHp;
        const { netMonsterHp, netPlayerHp } = computeNetHpLoss(rawMonsterHp, rawPlayerEff);

        if (usedShieldForNet) {
          shieldAbsorbedFlag = true;
          setShieldAbsorbed(true);
          combatLog("BRANCH: shield absorbed (net exchange)", { blocked: rawPlayerHp, shieldsLeft: next.players[pi]?.shield ?? 0 });
        }

        if (m && monsterIdx >= 0 && monsterIdx < next.monsters.length && netMonsterHp > 0) {
          const cur = m.hp ?? maxHpCombat;
          const nh = Math.max(0, Math.round(cur - netMonsterHp));
          m.hp = nh;
          combatLog("BRANCH: net monster HP", {
            rawMonsterHp,
            rawPlayerHp,
            netMonsterHp,
            netPlayerHp,
            cur,
            nh,
          });
          if (!result.won && (result.glancingDamage ?? 0) > 0 && cur > 0 && nh <= 0) glanceKilled = true;
          if (!result.won && nh > 0) combatContinuesAfterRollRef.current = true;
        }

        if (result.won && m && monsterIdx >= 0 && monsterIdx < next.monsters.length && (m.hp ?? 0) > 0) {
            combatContinuesAfterRollRef.current = true;
            return next;
        }

        const hpForDefeat =
          m && typeof m.hp === "number" && Number.isFinite(m.hp) ? Math.max(0, m.hp) : null;
        const monsterDefeated =
          monsterIdx >= 0 &&
          monsterIdx < next.monsters.length &&
          !!m &&
          hpForDefeat !== null &&
          hpForDefeat <= 0 &&
          (glanceKilled || result.won);

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
          combatLog("monster defeated", {
            monsterType: combat.monsterType,
            monsterIndex: monsterIdx,
            glanceKilled,
            cell: { x: defeatedX, y: defeatedY },
            primaryReward: result.reward ?? (glanceKilled ? getMonsterReward(combat.monsterType) : undefined),
          });
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
              ...(draculaAttackSegment ? { finishingStrikeSegment: draculaAttackSegment } : {}),
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
        } else if (!result.won && p && netPlayerHp > 0 && !usedShieldForNet) {
          pendingPlayerDamageHighlightIndexRef.current = pi;
            const hpBefore = p.hp ?? DEFAULT_PLAYER_HP;
          p.hp = Math.max(0, hpBefore - netPlayerHp);
          combatLog("BRANCH: player takes hit (net)", { damage: netPlayerHp, hpBefore, hpAfter: p.hp });
            if (combat.monsterType === "Z") p.loseNextMove = true; // Zombie slow: lose next movement point
            if (p.hp <= 0) {
              const defeatMonsterMaxHp = getMonsterMaxHp(combat.monsterType);
              const defeatMonsterHp = m ? Math.min(defeatMonsterMaxHp, Math.max(0, m.hp ?? defeatMonsterMaxHp)) : defeatMonsterMaxHp;
              const defeatPlayerHp = p.hp;
              // Respawn at maze start for this seat, lose 1 artifact (instead of elimination)
              const [sx, sy] = next.getSpawnForPlayer(pi);
              p.x = sx;
              p.y = sy;
              p.hp = DEFAULT_PLAYER_HP;
              const hasStored = STORED_ARTIFACT_ORDER.some((k) => storedArtifactCount(p, k) > 0);
              if (hasStored) {
                decrementOneStoredArtifactSlot(p);
              } else if (p.artifacts > 0) {
                p.artifacts--;
                const ac = p.artifactsCollected ?? [];
                if (ac.length > 0) p.artifactsCollected = ac.slice(0, -1);
              }
              playerDefeatedInCombatRef.current = true;
              setCombatResult({
                ...result,
                won: false,
                monsterType: combat.monsterType,
                playerIndex: pi,
              damage: netPlayerHp,
                playerDefeated: true,
                monsterHp: defeatMonsterHp,
                monsterMaxHp: defeatMonsterMaxHp,
                playerHpAtEnd: defeatPlayerHp,
              });
              // Always pass turn after combat respawn — do not gate on currentPlayerRef (it can lag useEffect during flushSync and skip advance).
              let nextP = (pi + 1) % next.numPlayers;
              while (next.eliminatedPlayers.has(nextP) && nextP !== pi) {
                nextP = (nextP + 1) % next.numPlayers;
              }
              currentPlayerRef.current = nextP;
              setCurrentPlayer(nextP);
            showMovementDiceOrInfinite({
              movesLeftRef,
              setMovesLeft,
              setDiceResult,
              setShowDiceModal,
              setRolling,
            });
              const living = [...Array(next.numPlayers).keys()].filter((i) => !next.eliminatedPlayers.has(i));
              const firstLiving = living.length > 0 ? Math.min(...living) : -1;
              const roundComplete = living.length <= 1 || nextP === firstLiving;
              if (roundComplete) setTimeout(() => triggerRoundEndRef.current(), 0);
            } else {
              combatContinuesAfterRollRef.current = true;
          }
        }
        return next;
      });
      });
        setCombatStrikeHpHold(null);
        runAfterLabCommit();
      };

      if (staggerLabCommitMs > 0) {
        combatPostLabFromStaggerRef.current = true;
        setCombatStrikeHpHold({
          monsterHp: Math.min(maxHpM, Math.max(0, mon?.hp ?? maxHpM)),
          monsterMaxHp: maxHpM,
          playerHp: playerHpBeforeRoll,
          playerIndex: combat.playerIndex,
        });
        setRolling(false);
        setCombatFooterSnapshot({
          playerRoll: result.playerRoll,
          attackTotal: result.attackTotal,
          monsterDefense: result.monsterDefense,
          summary: summaryStrikePreview,
          strikePortrait,
          ...(draculaAttackSegment ? { draculaAttackSegment } : {}),
          ...(playerFatalJumpKill ? { playerFatalJumpKill: true } : {}),
          ...draculaPlayerHitHurt3dFooterExtra(combat.monsterType, strikePortrait, monsterHpAfterStrike, maxHpM),
          ...(strikeTarget ? { strikeTargetPick: strikeTarget } : {}),
          ...(strikePortrait === "monsterHit" && missDmgPre > 0 ? { playerHpLost: missDmgPre } : {}),
        });
        setCombatRecoveryPhase("hurt");
        lastCombatRecoveryClipFinishMs.current = 0;
        combatHasRolledRef.current = false;
        const stancePre = rollCombatSurprise();
        combatSurpriseRef.current = stancePre;
        setCombatMonsterStance(stancePre);
        if (strikeLabCommitTimerRef.current != null) clearTimeout(strikeLabCommitTimerRef.current);
        strikeLabCommitTimerRef.current = window.setTimeout(() => {
          strikeLabCommitTimerRef.current = null;
          flushCombatLab();
        }, staggerLabCommitMs);
        return;
      }

      flushCombatLab();
    }

    applyCombatPostResolveRef.current = applyPost;

    const strikeIsReroll = combatStrikeIsRerollRef.current;
    const offerArtifactReroll =
      !strikeIsReroll &&
      combatDiceRerollReservedRef.current &&
      storedArtifactCount(p, "dice") > 0;

    if (offerArtifactReroll) {
      combatLog("artifact reroll prompt offered", {
        dice: value,
        won: result.won,
        monsterType: combatStateRef.current?.monsterType,
      });
      pendingArtifactRerollRef.current = { result };
      setCombatArtifactRerollPrompt(true);
      setRolling(false);
      return;
    }

    applyPost(result);
    }

  const handleCombatArtifactRerollDecline = useCallback(() => {
    const pending = pendingArtifactRerollRef.current;
    combatLog("artifact reroll declined", { hadPending: !!pending });
    pendingArtifactRerollRef.current = null;
    setCombatArtifactRerollPrompt(false);
    combatDiceRerollReservedRef.current = false;
    setCombatDiceRerollReserved(false);
    if (pending) applyCombatPostResolveRef.current(pending.result);
  }, []);

  const handleCombatArtifactRerollAccept = useCallback(() => {
    if (!pendingArtifactRerollRef.current) return;
    combatLog("artifact reroll accepted — consuming dice artifact, re-rolling strike");
    pendingArtifactRerollRef.current = null;
    setCombatArtifactRerollPrompt(false);
    combatDiceRerollReservedRef.current = false;
    setCombatDiceRerollReserved(false);
    combatStrikeIsRerollRef.current = true;
    combatStrikeTargetDuringRollRef.current = null;
    combatStrikeDiceOutcomeKnownRef.current = false;
    const combat = combatStateRef.current;
    if (!combat) return;
    setLab((prev) => {
      if (!prev || winnerRef.current !== null) return prev;
      const pi = combat.playerIndex;
      const next = new Labyrinth(prev.width, prev.height, 0, prev.numPlayers, prev.monsterDensity, prev.firstMonsterType);
      next.grid = prev.grid.map((r) => [...r]);
      next.players = prev.players.map((pl) => ({
        ...pl,
        jumps: pl.jumps ?? 0,
        diamonds: pl.diamonds ?? 0,
        shield: pl.shield ?? 0,
        bombs: pl.bombs ?? 0,
        hp: pl.hp ?? DEFAULT_PLAYER_HP,
        artifacts: pl.artifacts ?? 0,
        diceBonus: pl.diceBonus ?? 0,
        artifactDice: pl.artifactDice ?? 0,
        artifactShield: pl.artifactShield ?? 0,
        artifactTeleport: pl.artifactTeleport ?? 0,
        artifactReveal: pl.artifactReveal ?? 0,
        artifactHealing: pl.artifactHealing ?? 0,
        artifactTorch: pl.artifactTorch ?? 0,
        artifactHolySword: pl.artifactHolySword ?? 0,
        artifactHolyCross: pl.artifactHolyCross ?? 0,
        artifactDragonFuryAxe: pl.artifactDragonFuryAxe ?? 0,
        artifactEternalFrostblade: pl.artifactEternalFrostblade ?? 0,
        artifactZweihandhammer: pl.artifactZweihandhammer ?? 0,
        artifactAzureDragonShield: pl.artifactAzureDragonShield ?? 0,
        artifactNordicShield: pl.artifactNordicShield ?? 0,
        artifactWardShield: pl.artifactWardShield ?? 0,
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
      if (!p || (p.artifactDice ?? 0) <= 0) return prev;
      p.artifactDice!--;
      p.artifacts = Math.max(0, (p.artifacts ?? 0) - 1);
      return next;
    });
    setRolling(true);
    requestAnimationFrame(() => {
      combatDiceRef.current?.roll().catch(() => {
        combatStrikeIsRerollRef.current = false;
        setRolling(false);
      });
    });
  }, [setLab]);

  const handleCombatDiceArtifactRerollToggle = useCallback(() => {
    if (gamePausedRef.current) return;
    if (!combatStateRef.current) return;
    if (rolling) return;
    const labNow = labRef.current;
    if (!labNow) return;
    const pi = combatStateRef.current.playerIndex;
    const pl = labNow.players[pi];
    if (!pl || storedArtifactCount(pl, "dice") <= 0) return;
    combatDiceRerollReservedRef.current = !combatDiceRerollReservedRef.current;
    setCombatDiceRerollReserved(combatDiceRerollReservedRef.current);
  }, [rolling]);

  const handleDismissCombatResult = useCallback((force?: boolean) => {
    const cr = combatResultRef.current;
    const bonusMustPick =
      cr?.won && (cr.bonusRewardOptions?.length ?? 0) > 0 && cr.bonusRewardApplied !== true;
    if (bonusMustPick && !force) return;
    combatLog("dismiss combat result", { won: cr?.won, force: !!force, hadBonusPick: bonusMustPick });
    setCombatResult(null);
    setCombatFooterSnapshot(null);
    setCombatRecoveryPhase("ready");
    setDefeatedMonsterOnCell(null);
    setCombatVictoryPhase("hurt");
    setShieldAbsorbed(null);
  }, []);

  /** Close defeat modal — clears combat state and result */
  const handleCloseDefeatModal = useCallback(() => {
    const cr = combatResultRef.current;
    combatLog("close defeat modal", {
      playerDefeated: cr?.playerDefeated,
      playerIndex: cr?.playerIndex,
      monsterType: cr && "monsterType" in cr ? cr.monsterType : undefined,
    });
    const stuckOnDefeatedTurn =
      cr?.playerDefeated === true &&
      cr.playerIndex !== undefined &&
      cr.playerIndex === currentPlayerRef.current;
    setCombatState(null);
    setCombatResult(null);
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
      setCurrentPlayer(nextP);
      showMovementDiceOrInfinite({
        movesLeftRef,
        setMovesLeft,
        setDiceResult,
        setShowDiceModal,
        setRolling,
      });
      const living = [...Array(lab.numPlayers).keys()].filter((i) => !lab.eliminatedPlayers.has(i));
      const firstLiving = living.length > 0 ? Math.min(...living) : -1;
      const roundComplete = living.length <= 1 || nextP === firstLiving;
      if (roundComplete) setTimeout(() => triggerRoundEndRef.current(), 0);
    }
  }, [lab]);

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
    /** While combat is open, keep the "roll again" line until the next roll — clearing it let cancel-check close shield-separated fights. */
    if (combatState) return;
    const t = setTimeout(() => setCombatFooterSnapshot(null), 5000);
    return () => clearTimeout(t);
  }, [combatFooterSnapshot, combatState]);

  useEffect(() => {
    if (!combatFooterSnapshot || combatRecoveryPhase === "ready") return;
    const use3dRecovery =
      isMonster3DEnabled() &&
      combatState != null &&
      getMonsterGltfPath(combatState.monsterType, "idle") != null;
    if (use3dRecovery) return;
    const ms = combatRecoveryPhase === "hurt" ? COMBAT_RECOVERY_HURT_MS_2D : COMBAT_RECOVERY_RECOVER_MS_2D;
    const t = setTimeout(() => {
      setCombatRecoveryPhase((p) => {
        if (p === "hurt") {
          return combatFooterSnapshot.strikePortrait === "playerHitHeavy" ? "recover" : "ready";
        }
        if (p === "recover") return "ready";
        return p;
      });
    }, ms);
    return () => clearTimeout(t);
  }, [combatFooterSnapshot, combatRecoveryPhase, combatState]);

  useEffect(() => {
    if (!combatToast) return;
    const { seq, style } = combatToast;
    const ms = COMBAT_TOAST_AUTO_DISMISS_MS[style];
    const t = setTimeout(() => {
      setCombatToast((cur) => (cur?.seq === seq ? null : cur));
    }, ms);
    return () => clearTimeout(t);
  }, [combatToast]);

  const combatMonsterHintEffectKey = combatState
    ? `${combatState.monsterIndex}-${combatState.monsterType}`
    : "";
  useEffect(() => {
    if (!combatMonsterHintEffectKey) return;
    setCombatMonsterHintOpen(false);
    setCombatAutoHintVisible(true);
  }, [combatMonsterHintEffectKey]);

  /** New encounter or combat closed — reset last strike d6 (same fight keeps value across rolls). Single dep avoids Fast Refresh "dependency array changed size" warnings. */
  const lastStrikeDiceEncounterKey = combatState
    ? `${combatState.sessionId}:${combatState.playerIndex}:${combatState.monsterIndex}:${combatState.monsterType}`
    : "";
  useEffect(() => {
    setLastCombatStrikeDiceFace(null);
  }, [lastStrikeDiceEncounterKey]);

  const bonusLootOptionsFingerprint =
    combatResult?.bonusRewardOptions != null && combatResult.bonusRewardOptions.length > 0
      ? JSON.stringify(combatResult.bonusRewardOptions)
      : "";
  useEffect(() => {
    setBonusLootSelectedIndex(0);
  }, [bonusLootOptionsFingerprint]);

  const handlePickCombatBonusReward = useCallback(
    (pi: number, monsterType: MonsterType, chosen: MonsterBonusReward | "skip") => {
      if (chosen === "skip") {
        handleDismissCombatResult(true);
        return;
      }
      const br = chosen;
      const artifactTypePicked: StoredArtifactKind | null =
        br.type === "storedArtifact"
          ? br.kind
          : br.type === "artifact"
            ? STORED_ARTIFACT_ORDER[Math.floor(Math.random() * STORED_ARTIFACT_ORDER.length)]!
          : null;
      /** Commit lab before dismiss so labRef / UI see new artifacts (avoids race with modal close + effects). */
      flushSync(() => {
      setLab((prev) => {
        if (!prev || winnerRef.current !== null) return prev;
        const next = new Labyrinth(prev.width, prev.height, 0, prev.numPlayers, prev.monsterDensity, prev.firstMonsterType);
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
          artifactTorch: pl.artifactTorch ?? 0,
          artifactHolySword: pl.artifactHolySword ?? 0,
          artifactHolyCross: pl.artifactHolyCross ?? 0,
          artifactDragonFuryAxe: pl.artifactDragonFuryAxe ?? 0,
          artifactEternalFrostblade: pl.artifactEternalFrostblade ?? 0,
          artifactZweihandhammer: pl.artifactZweihandhammer ?? 0,
          artifactAzureDragonShield: pl.artifactAzureDragonShield ?? 0,
          artifactNordicShield: pl.artifactNordicShield ?? 0,
          artifactWardShield: pl.artifactWardShield ?? 0,
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
        if (artifactTypePicked && (br.type === "artifact" || br.type === "storedArtifact")) {
          p.artifacts = Math.min(3, (p.artifacts ?? 0) + br.amount);
          const ac = p.artifactsCollected ?? [];
          p.artifactsCollected = [...ac, STORED_ARTIFACT_LINE[artifactTypePicked]];
          if (artifactTypePicked === "dice") p.artifactDice = (p.artifactDice ?? 0) + br.amount;
          else if (artifactTypePicked === "shield") p.artifactShield = (p.artifactShield ?? 0) + br.amount;
          else if (artifactTypePicked === "teleport") p.artifactTeleport = (p.artifactTeleport ?? 0) + br.amount;
          else if (artifactTypePicked === "reveal") p.artifactReveal = (p.artifactReveal ?? 0) + br.amount;
          else if (artifactTypePicked === "healing") p.artifactHealing = (p.artifactHealing ?? 0) + br.amount;
          else if (artifactTypePicked === "torch") p.artifactTorch = (p.artifactTorch ?? 0) + br.amount;
          else if (artifactTypePicked === "holySword") p.artifactHolySword = (p.artifactHolySword ?? 0) + br.amount;
          else if (artifactTypePicked === "holyCross") p.artifactHolyCross = (p.artifactHolyCross ?? 0) + br.amount;
          else if (artifactTypePicked === "dragonFuryAxe")
            p.artifactDragonFuryAxe = (p.artifactDragonFuryAxe ?? 0) + br.amount;
          else if (artifactTypePicked === "eternalFrostblade")
            p.artifactEternalFrostblade = (p.artifactEternalFrostblade ?? 0) + br.amount;
          else if (artifactTypePicked === "zweihandhammer")
            p.artifactZweihandhammer = (p.artifactZweihandhammer ?? 0) + br.amount;
          else if (artifactTypePicked === "azureDragonShield")
            p.artifactAzureDragonShield = (p.artifactAzureDragonShield ?? 0) + br.amount;
          else if (artifactTypePicked === "nordicShield")
            p.artifactNordicShield = (p.artifactNordicShield ?? 0) + br.amount;
          else if (artifactTypePicked === "wardShield")
            p.artifactWardShield = (p.artifactWardShield ?? 0) + br.amount;
        }
        if (br.type === "bomb") {
          p.bombs = (p.bombs ?? 0) + br.amount;
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
      if (artifactTypePicked && (br.type === "artifact" || br.type === "storedArtifact")) setArtifactGained(artifactTypePicked);
      if (br.type === "bomb") setBombGained(true);
      handleDismissCombatResult(true);
    },
    [handleDismissCombatResult]
  );

  const handleMovementRollComplete = useCallback((value: number) => {
    if (TEMP_INFINITE_MOVES) return;
    if (combatStateRef.current) return;
    const labNow = labRef.current;
    const p = labNow?.players[currentPlayerRef.current];
    const bonus = p?.diceBonus ?? 0;
    const atkMap = Math.min(1, p?.attackBonus ?? 0);
    let totalValue = Math.min(6, value + bonus + atkMap);
    if (p?.loseNextMove) {
      totalValue = Math.max(1, totalValue - 1);
      setLab((prev) => {
        if (!prev) return prev;
        const next = new Labyrinth(prev.width, prev.height, 0, prev.numPlayers, prev.monsterDensity, prev.firstMonsterType);
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
        const next = new Labyrinth(prev.width, prev.height, 0, prev.numPlayers, prev.monsterDensity, prev.firstMonsterType);
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
    setBonusAdded(null);
    setPlayerTurns((prev) => {
      const next = [...prev];
      if (currentPlayerRef.current < next.length) next[currentPlayerRef.current] = (next[currentPlayerRef.current] ?? 0) + 1;
      return next;
    });
  }, []);

  const rollDice = useCallback(async () => {
    if (TEMP_INFINITE_MOVES) return;
    if (winner !== null || !lab) return;
    if (combatState) return;
    if (movesLeft > 0) return;
    setRolling(true);
    await diceRef.current?.roll();
  }, [lab, movesLeft, winner, combatState]);

  /** Single-player only: drop footer / toast / "roll again" shell so a new fight never stacks on the previous monster’s encounter. Preserves bonus-loot picker state. */
  const releaseSinglePlayerEncounterShell = useCallback((numPlayers: number) => {
    if (numPlayers !== 1) return;
    combatContinuesAfterRollRef.current = false;
    setCombatFooterSnapshot(null);
    setCombatToast(null);
    setCombatRecoveryPhase("ready");
    setCombatVictoryPhase("hurt");
    setCombatResult((prev) => {
      if (!prev) return null;
      if (prev.won && (prev.bonusRewardOptions?.length ?? 0) > 0 && prev.bonusRewardApplied !== true) return prev;
      return null;
    });
  }, []);

  const handleCombatRollClick = useCallback(() => {
    if (rolling || combatStrikeHpHold != null) return;
    if (combatDicePhysicsInFlightRef.current) return;
    combatStrikeTargetDuringRollRef.current = null;
    combatStrikeDiceOutcomeKnownRef.current = false;
    combatDicePhysicsInFlightRef.current = true;
    const c = combatStateRef.current;
    if (c) {
      const m = labRef.current?.monsters[c.monsterIndex];
      combatLog("strike roll requested", {
        playerIndex: c.playerIndex,
        monsterIndex: c.monsterIndex,
        monsterType: c.monsterType,
        monsterHp: m?.hp,
        draculaState: m?.type === "V" ? m?.draculaState : undefined,
      });
    }
    setCombatFooterSnapshot(null);
    setCombatRecoveryPhase("ready");
    combatHasRolledRef.current = true;
    setCombatAutoHintVisible(false);
    setRolling(true);
    combatDicePhysicsInFlightRef.current = true;
    const runRoll = () => {
    const rollResult = combatDiceRef.current?.roll();
    if (rollResult) {
        rollResult
          .catch(() => setRolling(false))
          .finally(() => {
            combatDicePhysicsInFlightRef.current = false;
          });
    } else {
        combatDicePhysicsInFlightRef.current = false;
      const v = Math.floor(Math.random() * 6) + 1;
      handleCombatRollComplete(v);
    }
    };
    requestAnimationFrame(() => requestAnimationFrame(runRoll));
  }, [rolling, combatStrikeHpHold, handleCombatRollComplete]);

  const handleRunAway = useCallback(() => {
    if (gamePausedRef.current) return;
    const combat = combatStateRef.current;
    if (!combat || rolling || combatStrikeHpHold != null) return;
    const labNow = labRef.current;
    if (!labNow || winnerRef.current !== null) return;
    const pi = combat.playerIndex;
    const p0 = labNow.players[pi];
    if (!p0) return;

    let retreatX: number | undefined;
    let retreatY: number | undefined;

    const passFromX =
      combat.prevX !== undefined && combat.prevY !== undefined
        ? combat.prevX
        : combat.approachX !== undefined && combat.approachY !== undefined
          ? combat.approachX
          : undefined;
    const passFromY =
      combat.prevX !== undefined && combat.prevY !== undefined
        ? combat.prevY
        : combat.approachX !== undefined && combat.approachY !== undefined
          ? combat.approachY
          : undefined;

    if (passFromX !== undefined && passFromY !== undefined) {
      const pass = findPassThroughFleeCell(labNow, passFromX, passFromY, p0.x, p0.y);
      if (pass) {
        retreatX = pass.x;
        retreatY = pass.y;
      }
    }

    if (retreatX === undefined) {
      const excludePrev =
        combat.prevX !== undefined && combat.prevY !== undefined
          ? new Set<string>([`${combat.prevX},${combat.prevY}`])
          : undefined;
      const flee = findCombatFleeCell(labNow, p0.x, p0.y, excludePrev);
      if (flee) {
        retreatX = flee.x;
        retreatY = flee.y;
      }
    }

    if (retreatX === undefined && combat.prevX !== undefined && combat.prevY !== undefined) {
      const px = combat.prevX;
      const py = combat.prevY;
      const prevOk =
        px >= 0 &&
        px < labNow.width &&
        py >= 0 &&
        py < labNow.height &&
        isWalkable(labNow.grid[py][px]) &&
        !labNow.monsters.some((mo) => mo.x === px && mo.y === py);
      if (prevOk) {
        retreatX = px;
        retreatY = py;
      }
    }

    if (retreatX === undefined && combat.approachX !== undefined && combat.approachY !== undefined) {
      const ax = combat.approachX;
      const ay = combat.approachY;
      const approachOk =
        ax >= 0 &&
        ax < labNow.width &&
        ay >= 0 &&
        ay < labNow.height &&
        isWalkable(labNow.grid[ay][ax]) &&
        !labNow.monsters.some((mo) => mo.x === ax && mo.y === ay);
      if (approachOk) {
        retreatX = ax;
        retreatY = ay;
      }
    }

    if (retreatX === undefined) return;

    combatLog("run away", {
      playerIndex: pi,
      monsterType: combat.monsterType,
      monsterIndex: combat.monsterIndex,
      retreatTo: { x: retreatX, y: retreatY },
      movesLeftBefore: movesLeftRef.current,
    });

    if (!TEMP_INFINITE_MOVES && movesLeftRef.current > 0) {
    movesLeftRef.current--;
    setMovesLeft(movesLeftRef.current);
    }

    setCombatState(null);
    setDefeatedMonsterOnCell(null);
    setCombatUseShield(true);
    setCombatUseDiceBonus(true);
    releaseSinglePlayerEncounterShell(labNow.numPlayers);

    flushSync(() => {
    setLab((prev) => {
      if (!prev || winnerRef.current !== null) return prev;
        const next = cloneLabSnapshotForDracula(prev);
      const p = next.players[pi];
      if (!p) return prev;
        if (retreatX !== undefined && retreatY !== undefined) {
      p.x = retreatX;
      p.y = retreatY;
        }
      return next;
    });
    });

    const labAfter = labRef.current;
    if (movesLeftRef.current <= 0 && winnerRef.current === null && labAfter) {
      const cp = labAfter.players[pi];
      const cell = cp && labAfter.getCellAt(cp.x, cp.y);
      movesLeftRef.current = 0;
      setMovesLeft(0);
      const onCatapult = cell && isCatapultCell(cell);
      const magicTpOpts =
        cell &&
        isMagicCell(cell) &&
        cp &&
        !labAfter.hasUsedTeleportFrom(pi, cp.x, cp.y) &&
        !labAfter.hasTeleportedTo(pi, cp.x, cp.y)
          ? labAfter.getTeleportOptions(pi, MAGIC_TELEPORT_PICKER_OPTIONS)
          : [];
      /** Magic teleport is only started from the Magic portal button (picker + idle timer), not when landing on the cell. */
      if (magicTpOpts.length > 0) return;
      if (!onCatapult) {
        let nextP = (pi + 1) % labAfter.numPlayers;
        while (labAfter.eliminatedPlayers.has(nextP) && nextP !== pi) {
          nextP = (nextP + 1) % labAfter.numPlayers;
        }
        const living = [...Array(labAfter.numPlayers).keys()].filter((i) => !labAfter.eliminatedPlayers.has(i));
        const firstLiving = living.length > 0 ? Math.min(...living) : -1;
        const roundComplete = living.length <= 1 || nextP === firstLiving;
        setCurrentPlayer(nextP);
        showMovementDiceOrInfinite({
          movesLeftRef,
          setMovesLeft,
          setDiceResult,
          setShowDiceModal,
          setRolling,
        });
        if (roundComplete) setTimeout(() => triggerRoundEndRef.current(), 0);
      }
    }
  }, [rolling, combatStrikeHpHold, releaseSinglePlayerEncounterShell]);

  const handleCombatRecoveryClipFinished = useCallback(() => {
    if (!isMonster3DEnabled()) return;
    if (combatFooterSnapshotRef.current == null || combatStateRef.current == null) return;
    if (combatRecoveryPhaseRef.current === "ready") return;
    if (getMonsterGltfPath(combatStateRef.current.monsterType, "idle") == null) return;
    const now = performance.now();
    if (now - lastCombatRecoveryClipFinishMs.current < COMBAT_3D_CLIP_FINISH_DEBOUNCE_MS) return;
    lastCombatRecoveryClipFinishMs.current = now;
    setCombatRecoveryPhase((p) => {
      const sp = combatFooterSnapshotRef.current?.strikePortrait;
      if (sp === "defeated") return "ready";
      if (p === "hurt") return sp === "playerHitHeavy" ? "recover" : "ready";
      if (p === "recover") return "ready";
      return p;
    });
  }, []);

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
        const next = new Labyrinth(prev.width, prev.height, 0, prev.numPlayers, prev.monsterDensity, prev.firstMonsterType);
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
          pendingCombatOfferRef.current != null ||
          combatResultRef.current != null ||
          combatContinuesAfterRollRef.current;
        applyEvent(next, ev, 0, { skipMonsterMove });
        return next;
      }
      const next = new Labyrinth(prev.width, prev.height, 0, prev.numPlayers, prev.monsterDensity, prev.firstMonsterType);
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

  useEffect(() => {
    const bite = pendingMazeDraculaBiteRef.current;
    if (bite && lab) {
      pendingMazeDraculaBiteRef.current = null;
      setMazeDraculaBiteBanner({ seq: Date.now(), hpAfter: bite.hpAfter, lethal: bite.lethal });
    }
  }, [lab]);

  useEffect(() => {
    if (!mazeDraculaBiteBanner) return;
    const t = setTimeout(() => setMazeDraculaBiteBanner(null), 3200);
    return () => clearTimeout(t);
  }, [mazeDraculaBiteBanner]);

  useEffect(() => {
    const pending = pendingDraculaEliminationRef.current;
    if (!pending || !lab) return;
    if (winnerRef.current !== null) {
      pendingDraculaEliminationRef.current = null;
      return;
    }
    pendingDraculaEliminationRef.current = null;
    if (pending.allDead) {
      setGameOverReason("dracula");
      setWinner(-1);
      return;
    }
    if (pending.nextP !== undefined) {
      currentPlayerRef.current = pending.nextP;
      setCurrentPlayer(pending.nextP);
      showMovementDiceOrInfinite({
        movesLeftRef,
        setMovesLeft,
        setDiceResult,
        setShowDiceModal,
        setRolling,
      });
      const living = [...Array(lab.numPlayers).keys()].filter((i) => !lab.eliminatedPlayers.has(i));
      const firstLiving = living.length > 0 ? Math.min(...living) : -1;
      const roundComplete = living.length <= 1 || pending.nextP === firstLiving;
      if (roundComplete) setTimeout(() => triggerRoundEndRef.current(), 0);
    }
  }, [lab, setCurrentPlayer, setMovesLeft, setDiceResult, setShowDiceModal, setRolling]);

  const endTurn = useCallback(() => {
    if (winner !== null || !lab) return;
    if (combatStateRef.current) return;
    if (pendingCombatOfferRef.current) return;
    let nextP = (currentPlayer + 1) % lab.numPlayers;
    while (lab.eliminatedPlayers.has(nextP) && nextP !== currentPlayer) {
      nextP = (nextP + 1) % lab.numPlayers;
    }
    const living = [...Array(lab.numPlayers).keys()].filter((i) => !lab.eliminatedPlayers.has(i));
    const firstLiving = living.length > 0 ? Math.min(...living) : -1;
    const roundComplete = living.length <= 1 || nextP === firstLiving;
    setCurrentPlayer(nextP);
    setBonusAdded(null);
    setDiceBonusApplied(null);
    showMovementDiceOrInfinite({
      movesLeftRef,
      setMovesLeft,
      setDiceResult,
      setShowDiceModal,
      setRolling,
    });
    if (roundComplete) {
      triggerRoundEnd();
    }
  }, [lab, winner, currentPlayer, triggerRoundEnd]);

  const handleUseBomb = useCallback(() => {
    if (gamePausedRef.current) return;
    if (pendingCombatOfferRef.current) return;
    if (!lab || winner !== null || lab.eliminatedPlayers.has(currentPlayer)) return;
    const cp = lab.players[currentPlayer];
    const inCombat = !!combatStateRef.current;
    if (!cp || (cp.bombs ?? 0) <= 0) return;
    if (!inCombat && movesLeftRef.current <= 0) return;
    const next = new Labyrinth(lab.width, lab.height, 0, lab.numPlayers, lab.monsterDensity, lab.firstMonsterType);
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
    if (!inCombat && !TEMP_INFINITE_MOVES) {
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
      if (gamePausedRef.current) return;
      if (pendingCombatOfferRef.current) return;
      if (!lab || winner !== null || lab.eliminatedPlayers.has(currentPlayer)) return;
      const cp = lab.players[currentPlayer];
      const inCombat = !!combatStateRef.current;
      if (!cp) return;
      const n = storedArtifactCount(cp, type);
      if (n <= 0) return;
      if (inCombat && isStoredArtifactMazePhaseOnly(type)) return;
      if (!inCombat && isStoredArtifactCombatPhaseOnly(type)) return;
      if (type === "healing" && (cp.hp ?? DEFAULT_PLAYER_HP) >= DEFAULT_PLAYER_HP) return;
      if (type === "reveal") {
        const totalDiamonds = lab.players.reduce((s, pl) => s + (pl.diamonds ?? 0), 0);
        if (peekRevealBatchSize(lab, totalDiamonds) <= 0) return;
      }
      const next = new Labyrinth(lab.width, lab.height, 0, lab.numPlayers, lab.monsterDensity, lab.firstMonsterType);
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
        artifactTorch: p.artifactTorch ?? 0,
        artifactHolySword: p.artifactHolySword ?? 0,
        artifactHolyCross: p.artifactHolyCross ?? 0,
        artifactDragonFuryAxe: p.artifactDragonFuryAxe ?? 0,
        artifactEternalFrostblade: p.artifactEternalFrostblade ?? 0,
        artifactZweihandhammer: p.artifactZweihandhammer ?? 0,
        artifactAzureDragonShield: p.artifactAzureDragonShield ?? 0,
        artifactNordicShield: p.artifactNordicShield ?? 0,
        artifactWardShield: p.artifactWardShield ?? 0,
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
        if (inCombat) {
          /** In combat: dice artifact only reserves an optional second strike (see Skills row toggle). */
          return;
        }
        p.artifactDice!--;
        p.artifacts = Math.max(0, (p.artifacts ?? 0) - 1);
        /** On map: roll d6 and add that many moves to the current pool. */
        const roll = Math.floor(Math.random() * 6) + 1;
        movesLeftRef.current = (movesLeftRef.current ?? 0) + roll;
        setMovesLeft(movesLeftRef.current);
        setBonusMovesGained(roll);
      } else if (type === "shield") {
        p.artifactShield!--;
        p.artifacts = Math.max(0, (p.artifacts ?? 0) - 1);
        p.shield = (p.shield ?? 0) + 1;
        setShieldGained(true);
        const equipShieldUrl = ARTIFACT_KIND_VISUAL_GLB.shield;
        if (equipShieldUrl) {
          setPlayerOffhandArmourGlb((prev) => {
            const arr = [...prev];
            if (currentPlayer >= 0 && currentPlayer < arr.length) arr[currentPlayer] = equipShieldUrl;
            return arr;
          });
        }
        if (inCombat) {
          combatUseShieldRef.current = true;
          setCombatUseShield(true);
        }
      } else if (type === "teleport") {
        const options = next.getTeleportOptions(currentPlayer, MAGIC_TELEPORT_PICKER_OPTIONS);
        if (options.length > 0) {
          p.artifactTeleport!--;
          p.artifacts = Math.max(0, (p.artifacts ?? 0) - 1);
          setLab(next);
          manualTeleportPendingRef.current = true;
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
      } else if (type === "torch") {
        p.artifactTorch!--;
        p.artifacts = Math.max(0, (p.artifacts ?? 0) - 1);
        p.hasTorch = true;
        setTorchGained(true);
      } else if (isWeaponStrikeArtifactKind(type)) {
        switch (type) {
          case "holySword":
            p.artifactHolySword!--;
            break;
          case "dragonFuryAxe":
            p.artifactDragonFuryAxe!--;
            break;
          case "eternalFrostblade":
            p.artifactEternalFrostblade!--;
            break;
          case "zweihandhammer":
            p.artifactZweihandhammer!--;
            break;
          default:
            break;
        }
        p.artifacts = Math.max(0, (p.artifacts ?? 0) - 1);
        const equipUrl = ARTIFACT_KIND_VISUAL_GLB[type];
        if (equipUrl) {
          setPlayerWeaponGlb((prev) => {
            const arr = [...prev];
            if (currentPlayer >= 0 && currentPlayer < arr.length) arr[currentPlayer] = equipUrl;
            return arr;
          });
        }
        if (inCombat) {
          combatHolyStrikeBonusRef.current += 1;
        } else {
          const roll = Math.floor(Math.random() * 6) + 1;
          movesLeftRef.current = (movesLeftRef.current ?? 0) + roll;
          setMovesLeft(movesLeftRef.current);
          setBonusMovesGained(roll);
        }
      } else if (isDefenderStrikeArtifactKind(type)) {
        switch (type) {
          case "holyCross":
            p.artifactHolyCross!--;
            break;
          case "azureDragonShield":
            p.artifactAzureDragonShield!--;
            break;
          case "nordicShield":
            p.artifactNordicShield!--;
            break;
          case "wardShield":
            p.artifactWardShield!--;
            break;
          default:
            break;
        }
        p.artifacts = Math.max(0, (p.artifacts ?? 0) - 1);
        const equipDefUrl = ARTIFACT_KIND_VISUAL_GLB[type];
        if (equipDefUrl) {
          setPlayerOffhandArmourGlb((prev) => {
            const arr = [...prev];
            if (currentPlayer >= 0 && currentPlayer < arr.length) arr[currentPlayer] = equipDefUrl;
            return arr;
          });
        }
        if (inCombat) {
          combatHolyStrikeBonusRef.current += 1;
        } else {
          p.shield = (p.shield ?? 0) + 1;
          setShieldGained(true);
        }
      }
      setLab(next);
    },
    [lab, winner, currentPlayer, setCombatUseDiceBonus, setCombatUseShield, setPlayerWeaponGlb, setPlayerOffhandArmourGlb]
  );

  const applyMobileDockSelection = useCallback(() => {
    if (mobileDockAction === null) return;
    if (gamePausedRef.current) return;
    if (mobileDockAction === "bomb") handleUseBomb();
    else if (mobileDockAction === "catapultCharge") openSlingshotFromDockRef.current?.();
    else if (mobileDockAction === "dice" && combatStateRef.current) handleCombatDiceArtifactRerollToggle();
    else handleUseArtifact(mobileDockAction);
  }, [mobileDockAction, handleUseBomb, handleUseArtifact, handleCombatDiceArtifactRerollToggle]);

  const applyImmersiveInventoryPick = useCallback(() => {
    if (immersiveInventoryPick === null) return;
    if (gamePausedRef.current) return;
    if (immersiveInventoryPick === "bomb") handleUseBomb();
    else if (immersiveInventoryPick === "catapultCharge") openSlingshotFromDockRef.current?.();
    else handleUseArtifact(immersiveInventoryPick);
    setImmersiveInventoryPick(null);
  }, [immersiveInventoryPick, handleUseBomb, handleUseArtifact]);

  const handleMobileDockTouchStart = useCallback((e: React.TouchEvent) => {
    mobileDockTouchStartY.current = e.touches[0]!.clientY;
  }, []);

  const handleMobileDockTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!e.changedTouches[0]) return;
      const endY = e.changedTouches[0].clientY;
      const deltaY = endY - mobileDockTouchStartY.current;
      if (deltaY > MOBILE_DOCK_SWIPE_THRESHOLD) {
        setMobileDockExpanded(false);
      } else if (deltaY < -MOBILE_DOCK_SWIPE_THRESHOLD) {
        setMobileDockExpanded(true);
      }
    },
    []
  );

  /** After `setLab` commits, keep the current player cell in view (keyboard / floating move pad). Uses `nearest` + scroll-padding on the maze area. */
  const scheduleScrollCurrentPlayerCellAfterMove = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        currentPlayerCellRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
          inline: "nearest",
        });
      });
    });
  }, []);

  const doMove = useCallback(
    (dx: number, dy: number, jumpOnly = false, opts?: { updateFacing?: boolean }) => {
      const updateFacing = opts?.updateFacing !== false;
      if (winner !== null || !lab) return;
      if (combatStateRef.current) {
        combatLog("doMove BLOCKED: combatStateRef.current is set");
        return;
      }
      if (pendingCombatOfferRef.current) {
        combatLog("doMove BLOCKED: pending combat offer");
        return;
      }
      if (gamePausedRef.current) return;
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
      if (turnChangePauseTimerRef.current) {
        clearTimeout(turnChangePauseTimerRef.current);
        turnChangePauseTimerRef.current = null;
      }
      setTeleportPicker(null);
      manualTeleportPendingRef.current = false;
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
      if (!TEMP_INFINITE_MOVES) {
      movesLeftRef.current -= costToPay;
      }
      setBonusAdded(null);
    setDiceBonusApplied(null);
      setJumpAdded(null);
      if (isWebCell) setWebSlowed(true);
      if (!playerStepWouldSucceed(lab, currentPlayer, dx, dy, jumpOnly)) {
        if (!TEMP_INFINITE_MOVES) {
          movesLeftRef.current += costToPay;
        }
        return;
      }
      const shareGrid = canShareGridForDoMoveStep(lab, currentPlayer, destX, destY);
      const next = cloneLabyrinthForDoMove(lab, shareGrid);
      const moveSucceeded = next.movePlayer(dx, dy, currentPlayer, jumpOnly);
      if (!moveSucceeded) {
        if (!TEMP_INFINITE_MOVES) {
        movesLeftRef.current += costToPay;
        }
        return;
      }
      if (updateFacing && (dx !== 0 || dy !== 0)) {
        setPlayerFacing((prev) => {
          const next = { ...prev, [currentPlayer]: { dx, dy } };
          playerFacingRef.current = next;
          return next;
        });
      }
      setSuppressMagicPortalUntilMove(false);
      expandDesktopControlsRef.current();
      {
        const newMovesLeft = Math.max(0, movesLeftRef.current);
        setMovesLeft(newMovesLeft);
        setTotalMoves((t) => t + 1);
        setPlayerMoves((prev) => {
          const next = [...prev];
          if (currentPlayer < next.length) next[currentPlayer] = (next[currentPlayer] ?? 0) + 1;
          return next;
        });
        let p = next.players[currentPlayer];
        const prevX = lab.players[currentPlayer]?.x ?? 0;
        const prevY = lab.players[currentPlayer]?.y ?? 0;
        let teleportedThisMove = false;
        let teleportPickerSet = false;
        if (jumpOnly && p) {
          setJumpAnimation({ playerIndex: currentPlayer, x: p.x, y: p.y });
          setIsoPlayerJumpPulse((n) => n + 1);
        }
        if (p) {
          let cell = next.getCellAt(p.x, p.y);
          if (cell && next.hiddenCells.has(`${p.x},${p.y}`)) next.revealCellAt(p.x, p.y);
          if (cell && isTrapCell(cell)) {
            if (cell === TRAP_LOSE_TURN) {
              let nextP = (currentPlayer + 1) % lab.numPlayers;
              while (lab.eliminatedPlayers.has(nextP) && nextP !== currentPlayer) {
                nextP = (nextP + 1) % lab.numPlayers;
              }
              setCurrentPlayer(nextP);
              showMovementDiceOrInfinite({
                movesLeftRef,
                setMovesLeft,
                setDiceResult,
                setShowDiceModal,
                setRolling,
              });
            } else if (cell === TRAP_HARM) {
              const usedShield = next.tryConsumeShield(currentPlayer);
              if (usedShield) setShieldAbsorbed(true);
              else {
                p.hp = (p.hp ?? DEFAULT_PLAYER_HP) - 1;
                setHarmTaken(true);
                if (p.hp <= 0) {
                  next.eliminatedPlayers.add(currentPlayer);
                  if (next.eliminatedPlayers.size >= next.numPlayers) {
                    setGameOverReason("monsters");
                    setWinner(-1);
                  }
                  let nextP = (currentPlayer + 1) % lab.numPlayers;
                  while (next.eliminatedPlayers.has(nextP) && nextP !== currentPlayer) {
                    nextP = (nextP + 1) % lab.numPlayers;
                  }
                  setCurrentPlayer(nextP);
                  showMovementDiceOrInfinite({
                    movesLeftRef,
                    setMovesLeft,
                    setDiceResult,
                    setShowDiceModal,
                    setRolling,
                  });
                }
              }
            } else if (cell === TRAP_TELEPORT) {
              const fromX = p.x;
              const fromY = p.y;
              const dest = next.getRandomTrapTeleportDestination(fromX, fromY);
              if (dest) {
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
                  setCurrentPlayer(trapNextP);
                  showMovementDiceOrInfinite({
                    movesLeftRef,
                    setMovesLeft,
                    setDiceResult,
                    setShowDiceModal,
                    setRolling,
                  });
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
              } else if (kind === "shield") {
                p.artifactShield = (p.artifactShield ?? 0) + 1;
              } else if (kind === "teleport") {
                p.artifactTeleport = (p.artifactTeleport ?? 0) + 1;
              } else if (kind === "reveal") {
                p.artifactReveal = (p.artifactReveal ?? 0) + 1;
              } else if (kind === "healing") {
                p.artifactHealing = (p.artifactHealing ?? 0) + 1;
              } else if (kind === "torch") {
                p.artifactTorch = (p.artifactTorch ?? 0) + 1;
              } else if (kind === "holySword") {
                p.artifactHolySword = (p.artifactHolySword ?? 0) + 1;
              } else if (kind === "holyCross") {
                p.artifactHolyCross = (p.artifactHolyCross ?? 0) + 1;
              } else if (kind === "dragonFuryAxe") {
                p.artifactDragonFuryAxe = (p.artifactDragonFuryAxe ?? 0) + 1;
              } else if (kind === "eternalFrostblade") {
                p.artifactEternalFrostblade = (p.artifactEternalFrostblade ?? 0) + 1;
              } else if (kind === "zweihandhammer") {
                p.artifactZweihandhammer = (p.artifactZweihandhammer ?? 0) + 1;
              } else if (kind === "azureDragonShield") {
                p.artifactAzureDragonShield = (p.artifactAzureDragonShield ?? 0) + 1;
              } else if (kind === "nordicShield") {
                p.artifactNordicShield = (p.artifactNordicShield ?? 0) + 1;
              } else if (kind === "wardShield") {
                p.artifactWardShield = (p.artifactWardShield ?? 0) + 1;
              }
              setArtifactGained(kind);
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
          // Slingshot: no auto-open — use "Use slingshot" in the dock (or catapult charge item) when ready.
          const owner = cell ? getCollectibleOwner(cell) : null;
          if (owner === currentPlayer && cell && isDiamondCell(cell)) {
            p.diamonds = (p.diamonds ?? 0) + 1;
            next.grid[p.y][p.x] = PATH;
            const totalDiamonds = next.players.reduce((s, pl) => s + (pl.diamonds ?? 0), 0);
            const revealed = next.revealHiddenCells(totalDiamonds);
            if (revealed > 0) setCellsRevealed(revealed);
            // Random hidden gem in some diamonds: shield, jump, torch, stored healing artifact, or (last) teleport picker
            if (Math.random() < 0.45) {
              const gems = [
                "shield",
                "jump",
                "teleport",
                "torch",
                "healing",
                "holySword",
                "holyCross",
                "dragonFuryAxe",
                "eternalFrostblade",
                "zweihandhammer",
                "azureDragonShield",
                "nordicShield",
                "wardShield",
              ] as const;
              const gem = gems[Math.floor(Math.random() * gems.length)];
              if (gem === "shield") {
                p.shield = (p.shield ?? 0) + 1;
                setShieldGained(true);
              } else if (gem === "jump") {
                p.jumps = (p.jumps ?? 0) + 1;
                setJumpAdded(1);
              } else if (gem === "torch") {
                p.artifacts = (p.artifacts ?? 0) + 1;
                p.artifactTorch = (p.artifactTorch ?? 0) + 1;
                const ac = p.artifactsCollected ?? [];
                p.artifactsCollected = [...ac, STORED_ARTIFACT_LINE.torch];
                setArtifactGained("torch");
              } else if (gem === "healing") {
                p.artifacts = (p.artifacts ?? 0) + 1;
                p.artifactHealing = (p.artifactHealing ?? 0) + 1;
                const ac = p.artifactsCollected ?? [];
                p.artifactsCollected = [...ac, STORED_ARTIFACT_LINE.healing];
                setArtifactGained("healing");
              } else if (gem === "holySword") {
                p.artifacts = (p.artifacts ?? 0) + 1;
                p.artifactHolySword = (p.artifactHolySword ?? 0) + 1;
                const ac = p.artifactsCollected ?? [];
                p.artifactsCollected = [...ac, STORED_ARTIFACT_LINE.holySword];
                setArtifactGained("holySword");
              } else if (gem === "holyCross") {
                p.artifacts = (p.artifacts ?? 0) + 1;
                p.artifactHolyCross = (p.artifactHolyCross ?? 0) + 1;
                const ac = p.artifactsCollected ?? [];
                p.artifactsCollected = [...ac, STORED_ARTIFACT_LINE.holyCross];
                setArtifactGained("holyCross");
              } else if (gem === "dragonFuryAxe") {
                p.artifacts = (p.artifacts ?? 0) + 1;
                p.artifactDragonFuryAxe = (p.artifactDragonFuryAxe ?? 0) + 1;
                const ac = p.artifactsCollected ?? [];
                p.artifactsCollected = [...ac, STORED_ARTIFACT_LINE.dragonFuryAxe];
                setArtifactGained("dragonFuryAxe");
              } else if (gem === "eternalFrostblade") {
                p.artifacts = (p.artifacts ?? 0) + 1;
                p.artifactEternalFrostblade = (p.artifactEternalFrostblade ?? 0) + 1;
                const ac = p.artifactsCollected ?? [];
                p.artifactsCollected = [...ac, STORED_ARTIFACT_LINE.eternalFrostblade];
                setArtifactGained("eternalFrostblade");
              } else if (gem === "zweihandhammer") {
                p.artifacts = (p.artifacts ?? 0) + 1;
                p.artifactZweihandhammer = (p.artifactZweihandhammer ?? 0) + 1;
                const ac = p.artifactsCollected ?? [];
                p.artifactsCollected = [...ac, STORED_ARTIFACT_LINE.zweihandhammer];
                setArtifactGained("zweihandhammer");
              } else if (gem === "azureDragonShield") {
                p.artifacts = (p.artifacts ?? 0) + 1;
                p.artifactAzureDragonShield = (p.artifactAzureDragonShield ?? 0) + 1;
                const ac = p.artifactsCollected ?? [];
                p.artifactsCollected = [...ac, STORED_ARTIFACT_LINE.azureDragonShield];
                setArtifactGained("azureDragonShield");
              } else if (gem === "nordicShield") {
                p.artifacts = (p.artifacts ?? 0) + 1;
                p.artifactNordicShield = (p.artifactNordicShield ?? 0) + 1;
                const ac = p.artifactsCollected ?? [];
                p.artifactsCollected = [...ac, STORED_ARTIFACT_LINE.nordicShield];
                setArtifactGained("nordicShield");
              } else if (gem === "wardShield") {
                p.artifacts = (p.artifacts ?? 0) + 1;
                p.artifactWardShield = (p.artifactWardShield ?? 0) + 1;
                const ac = p.artifactsCollected ?? [];
                p.artifactsCollected = [...ac, STORED_ARTIFACT_LINE.wardShield];
                setArtifactGained("wardShield");
              } else {
                const fromX = p.x;
                const fromY = p.y;
                const options = next.getTeleportOptions(currentPlayer, MAGIC_TELEPORT_PICKER_OPTIONS);
                if (options.length > 0 && movesLeftRef.current <= 0) {
                  setHiddenGemTeleport(true);
                  manualTeleportPendingRef.current = true;
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
          combatLog("COMBAT OFFER: player moved onto monster (await accept)", {
            monsterType: collision.monsterType,
            monsterIndex: collision.monsterIndex,
            playerIndex: collision.playerIndex,
          });
          const p = next.players[collision.playerIndex];
          setCollisionEffect(p ? { x: p.x, y: p.y } : null);
          combatHasRolledRef.current = false;
          combatSurpriseRef.current = "hunt";
          setRolling(false);
          const offer: PendingCombatOffer = {
            source: "player",
            playerIndex: collision.playerIndex,
            monsterType: collision.monsterType,
            monsterIndex: collision.monsterIndex,
            prevX,
            prevY,
            moveCostPaid: TEMP_INFINITE_MOVES ? 0 : costToPay,
          };
          pendingCombatOfferRef.current = offer;
          setPendingCombatOffer(offer);
          setLab(next);
          scheduleScrollCurrentPlayerCellAfterMove();
          return;
        }
        if (next.hasWon(currentPlayer)) {
          setWinner(currentPlayer);
        }
        setLab(next);
        scheduleScrollCurrentPlayerCellAfterMove();
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
            const onMagicPending =
              cell &&
              isMagicCell(cell) &&
              cp &&
              !next.hasUsedTeleportFrom(currentPlayer, cp.x, cp.y) &&
              !next.hasTeleportedTo(currentPlayer, cp.x, cp.y) &&
              next.getTeleportOptions(currentPlayer, MAGIC_TELEPORT_PICKER_OPTIONS).length > 0;
            if (!onCatapult && !onMagicPending) {
              let nextP = (currentPlayer + 1) % lab.numPlayers;
              while (next.eliminatedPlayers.has(nextP) && nextP !== currentPlayer) {
                nextP = (nextP + 1) % lab.numPlayers;
              }
              const living = [...Array(next.numPlayers).keys()].filter((i) => !next.eliminatedPlayers.has(i));
              const firstLiving = living.length > 0 ? Math.min(...living) : -1;
              const roundComplete = living.length <= 1 || nextP === firstLiving;
              const fromPlayer = currentPlayer;
              if (turnChangePauseTimerRef.current) {
                clearTimeout(turnChangePauseTimerRef.current);
                turnChangePauseTimerRef.current = null;
              }
              turnChangePauseTimerRef.current = setTimeout(() => {
                const l = labRef.current;
                if (!l || winnerRef.current !== null) return;
                if (currentPlayerRef.current !== fromPlayer) return;
                let np = (fromPlayer + 1) % l.numPlayers;
                while (l.eliminatedPlayers.has(np) && np !== fromPlayer) {
                  np = (np + 1) % l.numPlayers;
                }
                const liv = [...Array(l.numPlayers).keys()].filter((i) => !l.eliminatedPlayers.has(i));
                const firstLiv = liv.length > 0 ? Math.min(...liv) : -1;
                const rc = liv.length <= 1 || np === firstLiv;
                currentPlayerRef.current = np;
                setCurrentPlayer(np);
                showMovementDiceOrInfinite({
                  movesLeftRef,
                  setMovesLeft,
                  setDiceResult,
                  setShowDiceModal,
                  setRolling,
                });
                turnChangePauseTimerRef.current = null;
                if (rc) setTimeout(() => triggerRoundEndRef.current(), 0);
              }, TURN_CHANGE_PAUSE_MS);
            }
          }
        }
      }
    },
    [
      lab,
      currentPlayer,
      movesLeft,
      winner,
      diceResult,
      triggerRoundEnd,
      releaseSinglePlayerEncounterShell,
      scheduleScrollCurrentPlayerCellAfterMove,
    ]
  );

  /** Keyboard / on-screen joystick: grid steps without rotating the walk basis or 3D marker facing. */
  const doMoveStrafe = useCallback(
    (dx: number, dy: number, jumpOnly: boolean) => doMove(dx, dy, jumpOnly, { updateFacing: false }),
    [doMove]
  );

  // Game starts only when user clicks Start in the start modal

  const MONSTER_MOVE_INTERVAL_MS = 2500;

  useEffect(() => {
    if (!lab || winner !== null) return;
    const id = setInterval(() => {
      // Freeze all monster AI while any combat UI/encounter is active (including result modal or multi-roll fight)
      if (combatStateRef.current) return;
      if (pendingCombatOfferRef.current) return;
      if (combatResultRef.current) return;
      if (combatContinuesAfterRollRef.current) return;
      if (teleportPickerRef.current || catapultPickerRef.current || passThroughMagicRef.current) return;
      if (gamePausedRef.current) return;
      if (movesLeftRef.current <= 0) return; // No monster activity until player has rolled and has moves
      setLab((prev) => {
        if (!prev || winnerRef.current !== null || combatStateRef.current) return prev;
        if (pendingCombatOfferRef.current) return prev;
        if (combatResultRef.current) return prev;
        if (combatContinuesAfterRollRef.current) return prev;
        if (teleportPickerRef.current || catapultPickerRef.current || passThroughMagicRef.current) return prev;
        const next = new Labyrinth(prev.width, prev.height, 0, prev.numPlayers, prev.monsterDensity, prev.firstMonsterType);
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
        const monsterPosBefore = next.monsters.map((m) => ({ x: m.x, y: m.y }));
        next.moveMonsters(currentPlayerRef.current, scheduleDraculaAction);
        const collision = next.checkMonsterCollision(currentPlayerRef.current);
        if (collision && movesLeftRef.current > 0) {
          const p = next.players[collision.playerIndex];
          const before = monsterPosBefore[collision.monsterIndex];
          combatLog("COMBAT OFFER: monster moved onto player (tick, await accept)", {
            monsterType: collision.monsterType,
            monsterIndex: collision.monsterIndex,
            playerIndex: collision.playerIndex,
            cell: p ? { x: p.x, y: p.y } : null,
            monsterFrom: before ? { x: before.x, y: before.y } : null,
            movesLeft: movesLeftRef.current,
          });
          setCollisionEffect(p ? { x: p.x, y: p.y } : null);
          combatHasRolledRef.current = false;
          combatSurpriseRef.current = "hunt";
          setRolling(false);
          const offer: PendingCombatOffer = {
            source: "monster",
            playerIndex: collision.playerIndex,
            monsterType: collision.monsterType,
            monsterIndex: collision.monsterIndex,
            ...(before ? { monsterPrevX: before.x, monsterPrevY: before.y } : {}),
          };
          pendingCombatOfferRef.current = offer;
          setPendingCombatOffer(offer);
        }
        return next;
      });
    }, MONSTER_MOVE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [lab?.width, lab?.height, lab?.numPlayers, winner, combatState, releaseSinglePlayerEncounterShell]);

  /** Stable across monster moves so the turn-advance delay timer is not reset every lab tick */
  const eliminatedPlayersKey = useMemo(() => {
    if (!lab) return "";
    return [...lab.eliminatedPlayers].sort((a, b) => a - b).join(",");
  }, [lab]);

  const magicPortalReady = useMemo(() => {
    if (!lab || combatState || pendingCombatOffer || winner !== null || teleportPicker || catapultPicker || gamePaused)
      return false;
    if (suppressMagicPortalUntilMove) return false;
    const cp = lab.players[currentPlayer];
    if (!cp) return false;
    const cell = lab.getCellAt(cp.x, cp.y);
    if (!cell || !isMagicCell(cell) || lab.hasUsedTeleportFrom(currentPlayer, cp.x, cp.y)) return false;
    if (lab.hasTeleportedTo(currentPlayer, cp.x, cp.y)) return false;
    return lab.getTeleportOptions(currentPlayer, MAGIC_TELEPORT_PICKER_OPTIONS).length > 0;
  }, [
    lab,
    currentPlayer,
    combatState,
    pendingCombatOffer,
    winner,
    teleportPicker,
    catapultPicker,
    gamePaused,
    suppressMagicPortalUntilMove,
  ]);

  const slingshotCellAvailable = useMemo(() => {
    if (!lab || combatState || pendingCombatOffer || winner !== null || teleportPicker || catapultPicker || gamePaused)
      return false;
    const p = lab.players[currentPlayer];
    if (!p) return false;
    const cell = lab.getCellAt(p.x, p.y);
    return !!(cell && isCatapultCell(cell) && !lab.hasUsedCatapultFrom(currentPlayer, p.x, p.y));
  }, [
    lab,
    currentPlayer,
    combatState,
    pendingCombatOffer,
    winner,
    teleportPicker,
    catapultPicker,
    gamePaused,
  ]);

  const canOfferSlingshotDock = useMemo(() => {
    if (!lab || combatState || pendingCombatOffer || winner !== null || teleportPicker || catapultPicker || gamePaused)
      return false;
    const p = lab.players[currentPlayer];
    if (!p) return false;
    const charges = (p.catapultCharges ?? 0) > 0;
    return slingshotCellAvailable || charges;
  }, [
    lab,
    currentPlayer,
    combatState,
    pendingCombatOffer,
    winner,
    teleportPicker,
    catapultPicker,
    gamePaused,
    slingshotCellAvailable,
  ]);

  const landscapeCombatInfoRows = useMemo(() => {
    if (!lab || !combatState || combatResult) return null;
    return getLandscapeCombatInfoRows({
      monsterType: combatState.monsterType,
      skeletonHasShield: lab.monsters[combatState.monsterIndex]?.hasShield,
      surpriseState: combatMonsterStance,
    });
  }, [lab, combatState, combatResult, combatMonsterStance]);

  /** When turn should end with no moves: advance to next player + open roll. Eliminated-current case; also last-move combat (doMove returns before clearing diceResult). */
  useEffect(() => {
    if (
      !lab ||
      winner !== null ||
      combatState ||
      pendingCombatOffer ||
      rolling ||
      catapultPicker ||
      teleportPicker ||
      teleportPickerRef.current ||
      passThroughMagic ||
      gamePaused
    )
      return;
    if (combatResult || combatFooterSnapshot) return;
    if (manualTeleportPendingRef.current) return;

    if (lab.eliminatedPlayers.has(currentPlayer)) {
      let nextP = (currentPlayer + 1) % lab.numPlayers;
      while (lab.eliminatedPlayers.has(nextP) && nextP !== currentPlayer) {
        nextP = (nextP + 1) % lab.numPlayers;
      }
      setCurrentPlayer(nextP);
      showMovementDiceOrInfinite({
        movesLeftRef,
        setMovesLeft,
        setDiceResult,
        setShowDiceModal,
        setRolling,
      });
      return;
    }

    if (TEMP_INFINITE_MOVES) return;

    if (movesLeft > 0) return;
    const cpStale = lab.players[currentPlayer];
    if (cpStale && movesLeft <= 0) {
      const cellAt = lab.getCellAt(cpStale.x, cpStale.y);
      if (
        cellAt &&
        isMagicCell(cellAt) &&
        !lab.hasUsedTeleportFrom(currentPlayer, cpStale.x, cpStale.y) &&
        !lab.hasTeleportedTo(currentPlayer, cpStale.x, cpStale.y)
      ) {
        const optN = lab.getTeleportOptions(currentPlayer, MAGIC_TELEPORT_PICKER_OPTIONS).length;
        if (optN > 0) return;
      }
    }

    if (diceResult === null) return;

    const fromPlayer = currentPlayer;
    if (turnChangePauseTimerRef.current) {
      clearTimeout(turnChangePauseTimerRef.current);
      turnChangePauseTimerRef.current = null;
    }
    const tid = setTimeout(() => {
      const l = labRef.current;
      if (!l || winnerRef.current !== null) return;
      if (currentPlayerRef.current !== fromPlayer) return;
      if (diceResultRef.current === null) return;
      if (manualTeleportPendingRef.current) return;
      if (teleportPickerRef.current) return;
      let nextP = (fromPlayer + 1) % l.numPlayers;
      while (l.eliminatedPlayers.has(nextP) && nextP !== fromPlayer) {
        nextP = (nextP + 1) % l.numPlayers;
      }
      const living = [...Array(l.numPlayers).keys()].filter((i) => !l.eliminatedPlayers.has(i));
      const firstLiving = living.length > 0 ? Math.min(...living) : -1;
      const roundComplete = living.length <= 1 || nextP === firstLiving;
      currentPlayerRef.current = nextP;
      setCurrentPlayer(nextP);
      setBonusAdded(null);
      setDiceBonusApplied(null);
      showMovementDiceOrInfinite({
        movesLeftRef,
        setMovesLeft,
        setDiceResult,
        setShowDiceModal,
        setRolling,
      });
      turnChangePauseTimerRef.current = null;
      if (roundComplete) setTimeout(() => triggerRoundEnd(), 0);
    }, TURN_CHANGE_PAUSE_MS);
    turnChangePauseTimerRef.current = tid;
    return () => {
      clearTimeout(tid);
      if (turnChangePauseTimerRef.current === tid) turnChangePauseTimerRef.current = null;
    };
  }, [
    eliminatedPlayersKey,
    winner,
    combatState,
    pendingCombatOffer,
    combatResult,
    combatFooterSnapshot,
    movesLeft,
    rolling,
    currentPlayer,
    catapultPicker,
    teleportPicker,
    passThroughMagic,
    gamePaused,
    diceResult,
    triggerRoundEnd,
  ]);

  // Auto-roll when dice modal is shown (restores original behavior: next player gets moves without manual click)
  useEffect(() => {
    if (TEMP_INFINITE_MOVES) return;
    if (
      !showDiceModal ||
      combatState ||
      pendingCombatOffer ||
      combatResult ||
      winner !== null ||
      !lab ||
      rolling ||
      movesLeft > 0 ||
      diceResult !== null ||
      gamePaused
    )
      return;
    combatLog("dice auto-roll: triggering roll in 500ms", { showDiceModal, movesLeft });
    const t = setTimeout(() => {
      setRolling(true);
      diceRef.current?.roll();
    }, 500);
    return () => clearTimeout(t);
  }, [
    showDiceModal,
    combatState,
    pendingCombatOffer,
    combatResult,
    winner,
    lab,
    rolling,
    movesLeft,
    diceResult,
    gamePaused,
  ]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isKeyboardEventFromEditableField(e.target)) return;
      if (gamePausedRef.current) return;
      if (e.key === "r" || e.key === "R") {
        newGame({ initSource: "keyboard_R" });
        e.preventDefault();
        return;
      }
      if (combatStateRef.current) {
        if (rollingRef.current) {
          const k = e.key.toLowerCase();
          if (k === "1" || k === "h") { handleStrikeTargetPick("head"); e.preventDefault(); }
          else if (k === "2" || k === "b") { handleStrikeTargetPick("body"); e.preventDefault(); }
          else if (k === "3" || k === "l") { handleStrikeTargetPick("legs"); e.preventDefault(); }
        } else if (e.key === " " || e.key === "Enter") {
          handleCombatRollClick();
          e.preventDefault();
        }
        return;
      }
      if (pendingCombatOfferRef.current) return;
      /** Mobile: ArrowUp = expand move & inventory dock; ArrowDown = collapse (when expanded). */
      if (typeof window !== "undefined" && matchesMobileLayout()) {
        if (e.key === "ArrowUp" && !mobileDockExpandedRef.current) {
          setMobileDockExpanded(true);
          e.preventDefault();
          return;
        }
        if (e.key === "ArrowDown" && mobileDockExpandedRef.current) {
          setMobileDockExpanded(false);
          e.preventDefault();
          return;
        }
      }
      const cp = currentPlayerRef.current;
      const bearingDeg = isoCameraBearingDegRef.current;
      const camCardinal =
        mazeMapViewRef.current === "iso" && bearingDeg != null
          ? cardinalGridFromIsoBearingDeg(bearingDeg)
          : null;
      const facingMapForKeys =
        camCardinal != null ? { ...playerFacingRef.current, [cp]: camCardinal } : playerFacingRef.current;
      const rel = getRelativeDirectionsFromFacing(cp, facingMapForKeys);
      const keyToVec: Record<string, [number, number]> = {
        ArrowUp: [rel.forward.dx, rel.forward.dy],
        ArrowDown: [rel.backward.dx, rel.backward.dy],
        ArrowLeft: [rel.left.dx, rel.left.dy],
        ArrowRight: [rel.right.dx, rel.right.dy],
        w: [rel.forward.dx, rel.forward.dy],
        W: [rel.forward.dx, rel.forward.dy],
        s: [rel.backward.dx, rel.backward.dy],
        S: [rel.backward.dx, rel.backward.dy],
        a: [rel.left.dx, rel.left.dy],
        A: [rel.left.dx, rel.left.dy],
        d: [rel.right.dx, rel.right.dy],
        D: [rel.right.dx, rel.right.dy],
      };
      const d = keyToVec[e.key];
      if (d) {
        expandDesktopControlsRef.current();
        const l = labRef.current;
        if (movesLeftRef.current <= 0 || winnerRef.current !== null || !l || passThroughMagicRef.current) return;
        // Same keys for move and jump: prefer jump when possible in that direction
        const jumpPreferred = l.canJumpInDirection(d[0], d[1], currentPlayerRef.current);
        doMove(d[0], d[1], jumpPreferred, { updateFacing: false });
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newGame, doMove, setMobileDockExpanded, handleStrikeTargetPick]);

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
  const bearingDegLive = mazeMapView === "iso" ? isoCameraBearingDegRef.current : null;
  const cameraWalkCardinal =
    bearingDegLive != null ? cardinalGridFromIsoBearingDeg(bearingDegLive) : null;
  const walkFacingMap =
    cameraWalkCardinal != null
      ? { ...playerFacing, [currentPlayer]: cameraWalkCardinal }
      : playerFacing;
  const {
    forward: relativeForward,
    backward: relativeBackward,
    left: relativeLeft,
    right: relativeRight,
  } = getRelativeDirectionsFromFacing(currentPlayer, walkFacingMap);
  const moveDisabled =
    movesLeft <= 0 ||
    gameOver ||
    (lab?.eliminatedPlayers.has(currentPlayer) ?? false) ||
    passThroughMagic ||
    !!combatState ||
    !!pendingCombatOffer ||
    gamePaused;
  const rollDisabled =
    TEMP_INFINITE_MOVES ||
    !!combatState ||
    !!pendingCombatOffer ||
    (!combatState && movesLeft > 0) ||
    gameOver ||
    rolling ||
    !!catapultPicker ||
    !!teleportPicker ||
    passThroughMagic ||
    gamePaused;
  const showSecretCells = movesLeft > 0;
  const jumpTargets = useMemo(
    () =>
      lab && cp && (cp.jumps ?? 0) > 0 && !moveDisabled ? lab.getJumpTargets(currentPlayer) : [],
    [lab, cp, currentPlayer, moveDisabled],
  );
  const jumpTargetByCoord = useMemo(() => {
    const m = new Map<string, (typeof jumpTargets)[number]>();
    for (const t of jumpTargets) m.set(`${t.x},${t.y}`, t);
    return m;
  }, [jumpTargets]);
  const webCellKeySet = useMemo(() => {
    const s = new Set<string>();
    const wp = lab?.webPositions;
    if (wp) for (const [wx, wy] of wp) s.add(`${wx},${wy}`);
    return s;
  }, [lab?.webPositions]);
  const canMoveUp = Boolean(
    !moveDisabled && lab?.canMoveOnly(relativeForward.dx, relativeForward.dy, currentPlayer),
  );
  const canMoveLeft = Boolean(
    !moveDisabled && lab?.canMoveOnly(relativeLeft.dx, relativeLeft.dy, currentPlayer),
  );
  const canMoveRight = Boolean(
    !moveDisabled && lab?.canMoveOnly(relativeRight.dx, relativeRight.dy, currentPlayer),
  );
  const canMoveDown = Boolean(
    !moveDisabled && lab?.canMoveOnly(relativeBackward.dx, relativeBackward.dy, currentPlayer),
  );
  const canJumpUp = !moveDisabled && lab?.canJumpInDirection(relativeForward.dx, relativeForward.dy, currentPlayer);
  const canJumpLeft = !moveDisabled && lab?.canJumpInDirection(relativeLeft.dx, relativeLeft.dy, currentPlayer);
  const canJumpRight = !moveDisabled && lab?.canJumpInDirection(relativeRight.dx, relativeRight.dy, currentPlayer);
  const canJumpDown = !moveDisabled && lab?.canJumpInDirection(relativeBackward.dx, relativeBackward.dy, currentPlayer);

  const handleCatapultLaunch = useCallback(
    (dx: number, dy: number, strength: number) => {
      if (gamePausedRef.current) return;
      if (!lab || !catapultPicker || !catapultMode) return;
      const { playerIndex, from } = catapultPicker;
      const next = new Labyrinth(lab.width, lab.height, 0, lab.numPlayers, lab.monsterDensity, lab.firstMonsterType);
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
        const pl = next.players[playerIndex];
        if (catapultPicker.viaCharge) {
          if (pl) pl.catapultCharges = Math.max(0, (pl.catapultCharges ?? 0) - 1);
        } else {
        next.recordCatapultUsedFrom(playerIndex, from[0], from[1]);
        }
        setCatapultAnimation({ from, to: [result.destX, result.destY], playerIndex });
        setTeleportPicker(null);
        manualTeleportPendingRef.current = false;
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
          }
        }
        if (next.hasWon(playerIndex)) setWinner(playerIndex);
        setLab(next);
      }
    },
    [lab, catapultPicker, catapultMode]
  );

  /** Purple destination beacons in 3D while magic portal is available (matches 2D hole styling). */
  /** Purple beacons only after the player opens the magic picker (consent), not just standing on the cell. */
  const isoMagicPortalPreviewOptions = useMemo(() => {
    if (!lab || mazeMapView !== "iso") return null;
    if (teleportPicker?.sourceType !== "magic") return null;
    return lab.getTeleportOptions(currentPlayer, MAGIC_TELEPORT_PICKER_OPTIONS);
  }, [lab, mazeMapView, teleportPicker, currentPlayer]);

  const catapultTrajectoryPreview = useMemo<CatapultTrajectoryPreviewFn | undefined>(() => {
    if (!lab) return undefined;
    return (fx, fy, dx, dy, s) => lab.getCatapultTrajectory(fx, fy, dx, dy, s, false);
  }, [lab]);

  useEffect(() => {
    if (!catapultPicker) {
      setCatapultAimClient(null);
      setCatapultIsoPhase("orient");
      return;
    }
    setCatapultIsoPhase(mazeMapView === "iso" ? "orient" : "pull");
  }, [catapultPicker, mazeMapView]);

  useEffect(() => {
    if (!catapultMode || !catapultPicker) return;
    const from = catapultPicker.from;
    const onPointerUp = (e: globalThis.PointerEvent) => {
      if (gamePausedRef.current) return;
      const d = catapultDragRef.current;
      catapultDragRef.current = null;
      setCatapultDragOffset(null);
      setCatapultAimClient(null);
      if (!d) return;
      const releaseX = e.clientX;
      const releaseY = e.clientY;
      const dx = releaseX - d.startX;
      const dy = releaseY - d.startY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 15) return; // too short a drag
      if (mazeMapView === "iso") {
        if (catapultIsoPhase !== "pull") return;
        const resolved = mazeIsoViewRef.current?.resolveCatapultLaunchAtClient(from, releaseX, releaseY);
        if (resolved) {
          handleCatapultLaunch(resolved.dx, resolved.dy, resolved.strength);
          return;
        }
      }
      // 2D grid: screen pull from cell center; 3D fallback if raycast missed
      handleCatapultLaunch(-dx, -dy, dist);
    };
    const onPointerCancel = () => {
      catapultDragRef.current = null;
      setCatapultDragOffset(null);
      setCatapultAimClient(null);
    };
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    return () => {
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
    };
  }, [catapultMode, catapultPicker, handleCatapultLaunch, mazeMapView, catapultIsoPhase]);

  const handleTeleportSelect = useCallback(
    (destX: number, destY: number) => {
      if (gamePausedRef.current) return;
      const picker = teleportPickerRef.current ?? teleportPicker;
      if (!lab || !picker) return;
      const { playerIndex, from, sourceType } = picker;
      const isOption = picker.options.some(([ox, oy]) => ox === destX && oy === destY);
      if (!isOption) return;
      const next = new Labyrinth(lab.width, lab.height, 0, lab.numPlayers, lab.monsterDensity, lab.firstMonsterType);
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
        /** Block teleporting back onto the cell we left (same data as "already used as destination"). */
        next.recordTeleportUsedTo(playerIndex, from[0], from[1]);
        setTeleportAnimation({ from, to: [destX, destY], playerIndex });
        setTeleportPicker(null);
        manualTeleportPendingRef.current = false;
        setHiddenGemTeleport(null);
        setSuppressMagicPortalUntilMove(true);
        const won = next.hasWon(playerIndex);
        if (won) setWinner(playerIndex);
        setLab(next);
        /** doMove skips end-turn while the picker was open; once teleport resolves with 0 moves, advance like the normal end-of-move path (artifact teleport with moves left does not advance). */
        if (!won && movesLeftRef.current <= 0) {
        movesLeftRef.current = 0;
        setMovesLeft(0);
        setDiceResult(null);
          const fromPi = playerIndex;
        let nextP = (playerIndex + 1) % next.numPlayers;
        while (next.eliminatedPlayers.has(nextP) && nextP !== playerIndex) {
          nextP = (nextP + 1) % next.numPlayers;
        }
        const living = [...Array(next.numPlayers).keys()].filter((i) => !next.eliminatedPlayers.has(i));
        const firstLiving = living.length > 0 ? Math.min(...living) : -1;
        const roundComplete = living.length <= 1 || nextP === firstLiving;
          if (turnChangePauseTimerRef.current) {
            clearTimeout(turnChangePauseTimerRef.current);
            turnChangePauseTimerRef.current = null;
          }
          turnChangePauseTimerRef.current = setTimeout(() => {
            const l = labRef.current;
            if (!l || winnerRef.current !== null) return;
            if (currentPlayerRef.current !== fromPi) return;
            let np = (fromPi + 1) % l.numPlayers;
            while (l.eliminatedPlayers.has(np) && np !== fromPi) {
              np = (np + 1) % l.numPlayers;
            }
            const liv = [...Array(l.numPlayers).keys()].filter((i) => !l.eliminatedPlayers.has(i));
            const firstLiv = liv.length > 0 ? Math.min(...liv) : -1;
            const rc = liv.length <= 1 || np === firstLiv;
            currentPlayerRef.current = np;
            setCurrentPlayer(np);
            showMovementDiceOrInfinite({
              movesLeftRef,
              setMovesLeft,
              setDiceResult,
              setShowDiceModal,
              setRolling,
            });
            turnChangePauseTimerRef.current = null;
            if (rc) setTimeout(() => triggerRoundEndRef.current(), 0);
          }, TURN_CHANGE_PAUSE_MS);
        }
        setTimeout(() => {
          setRolling(false);
        }, SPECIAL_MOVE_SETTLE_MS);
      }
    },
    [lab, teleportPicker, triggerRoundEnd]
  );

  useEffect(() => {
    handleTeleportSelectRef.current = handleTeleportSelect;
  }, [handleTeleportSelect]);

  useEffect(() => {
    if (!teleportPicker || teleportPicker.options.length === 0 || gamePaused) {
      if (teleportTimerRef.current) {
        clearTimeout(teleportTimerRef.current);
        teleportTimerRef.current = null;
      }
      if (!teleportPicker) teleportIdleDeadlineRef.current = null;
      return;
    }
    /** Last move: never auto-resolve teleport — user must tap a cell or Random (turn stays blocked until then). */
    if (movesLeft <= 0) {
      if (teleportTimerRef.current) {
        clearTimeout(teleportTimerRef.current);
      teleportTimerRef.current = null;
      }
      teleportIdleDeadlineRef.current = null;
      return;
    }
    if (teleportIdleDeadlineRef.current === null) {
      teleportIdleDeadlineRef.current = Date.now() + MAGIC_TELEPORT_PICK_IDLE_MS;
    }
    const snapshot = teleportPicker;
    const schedule = () => {
      if (teleportTimerRef.current) {
        clearTimeout(teleportTimerRef.current);
        teleportTimerRef.current = null;
      }
      const deadline = teleportIdleDeadlineRef.current;
      if (deadline == null) return;
      if (gamePausedRef.current) {
        teleportTimerRef.current = setTimeout(schedule, 120);
        return;
      }
      const remaining = deadline - Date.now();
      if (remaining > 0) {
        teleportTimerRef.current = setTimeout(schedule, remaining);
        return;
      }
      const picker = teleportPickerRef.current ?? snapshot;
      if (!picker.options.length) return;
      const pick = picker.options[Math.floor(Math.random() * picker.options.length)]!;
      handleTeleportSelectRef.current(pick[0], pick[1]);
    };
    schedule();
    return () => {
      if (teleportTimerRef.current) {
        clearTimeout(teleportTimerRef.current);
        teleportTimerRef.current = null;
      }
    };
  }, [teleportPicker, gamePaused, movesLeft]);

  const [teleportPickUiTick, setTeleportPickUiTick] = useState(0);
  useEffect(() => {
    if (!teleportPicker || teleportPicker.options.length === 0 || gamePaused) return;
    const id = window.setInterval(() => setTeleportPickUiTick((n) => n + 1), 200);
    return () => window.clearInterval(id);
  }, [teleportPicker, gamePaused]);

  const teleportPickTimerModel = useMemo((): { kind: "manual" } | { kind: "pending" } | { kind: "countdown"; seconds: number } | null => {
    if (!teleportPicker || teleportPicker.options.length === 0) return null;
    if (movesLeft <= 0) return { kind: "manual" };
    const d = teleportIdleDeadlineRef.current;
    if (d == null) return { kind: "pending" };
    return { kind: "countdown", seconds: Math.max(0, Math.ceil((d - Date.now()) / 1000)) };
  }, [teleportPicker, movesLeft, gamePaused, teleportPickUiTick]);

  const handleCellTap = useCallback(
    (cellX: number, cellY: number) => {
      if (!lab) return;
      if (gamePausedRef.current) return;
      if (teleportPicker) {
        handleTeleportSelect(cellX, cellY);
        return;
      }
      if (moveDisabled || !cp) return;
      const jumpTarget = jumpTargetByCoord.get(`${cellX},${cellY}`);
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
    [moveDisabled, cp, jumpTargetByCoord, lab, currentPlayer, doMove, teleportPicker, handleTeleportSelect]
  );

  const handleMagicPortalOpen = useCallback(() => {
    if (gamePausedRef.current) return;
    if (!lab || !cp) return;
    if (combatState || pendingCombatOffer || winner !== null) return;
    if (teleportPicker || catapultPicker) return;
    const cell = lab.getCellAt(cp.x, cp.y);
    if (!cell || !isMagicCell(cell) || lab.hasUsedTeleportFrom(currentPlayer, cp.x, cp.y)) return;
    if (lab.hasTeleportedTo(currentPlayer, cp.x, cp.y)) return;
    const options = lab.getTeleportOptions(currentPlayer, MAGIC_TELEPORT_PICKER_OPTIONS);
    if (options.length === 0) return;
    manualTeleportPendingRef.current = true;
    setTeleportPicker({ playerIndex: currentPlayer, from: [cp.x, cp.y], options, sourceType: "magic" });
  }, [lab, cp, currentPlayer, combatState, pendingCombatOffer, winner, teleportPicker, catapultPicker]);

  const openSlingshotFromDock = useCallback(() => {
    if (gamePausedRef.current) return;
    if (!lab || !cp || combatState || pendingCombatOffer || winner !== null) return;
    if (teleportPicker || catapultPicker) return;
    const cell = lab.getCellAt(cp.x, cp.y);
    const onCatapult = !!(
      cell &&
      isCatapultCell(cell) &&
      !lab.hasUsedCatapultFrom(currentPlayer, cp.x, cp.y)
    );
    if (onCatapult) {
      setCatapultPicker({ playerIndex: currentPlayer, from: [cp.x, cp.y], viaCharge: false });
      setCatapultMode(true);
      return;
    }
    if ((cp.catapultCharges ?? 0) > 0) {
      setCatapultPicker({ playerIndex: currentPlayer, from: [cp.x, cp.y], viaCharge: true });
      setCatapultMode(true);
    }
  }, [
    lab,
    cp,
    currentPlayer,
    combatState,
    pendingCombatOffer,
    winner,
    teleportPicker,
    catapultPicker,
  ]);

  useEffect(() => {
    openSlingshotFromDockRef.current = openSlingshotFromDock;
  }, [openSlingshotFromDock]);

  const acceptPendingCombat = useCallback(() => {
    const o = pendingCombatOfferRef.current;
    const l = labRef.current;
    if (!o || !l) return;
    combatLog("COMBAT START (accepted)", o);
    const pi = o.playerIndex;
    const p = l.players[pi];
    setCollisionEffect(p ? { x: p.x, y: p.y } : null);
    combatHasRolledRef.current = false;
    combatSurpriseRef.current = "hunt";
    setRolling(false);
    releaseSinglePlayerEncounterShell(l.numPlayers);
    pendingCombatOfferRef.current = null;
    setPendingCombatOffer(null);
    /**
     * Dracula’s map “bite” (telegraphed adjacent attack) runs before the modal and was reducing HP.
     * That stacked with strike resolution — first miss could read as an unfair instant loss. Formal
     * combat vs V starts at full HP; damage only applies from rolls inside the fight.
     */
    if (o.monsterType === "V") {
      flushSync(() => {
        setLab((prev) => {
          if (!prev || winnerRef.current !== null) return prev;
          const next = cloneLabSnapshotForDracula(prev);
          const pl = next.players[pi];
          if (pl) pl.hp = DEFAULT_PLAYER_HP;
          return next;
        });
      });
    }
    combatEncounterSerialRef.current += 1;
    const sessionId = combatEncounterSerialRef.current;
    setCombatState({
      playerIndex: o.playerIndex,
      monsterType: o.monsterType,
      monsterIndex: o.monsterIndex,
      sessionId,
      ...(o.source === "player" && o.prevX !== undefined && o.prevY !== undefined
        ? { prevX: o.prevX, prevY: o.prevY }
        : {}),
      ...(o.source === "monster" &&
      o.monsterPrevX !== undefined &&
      o.monsterPrevY !== undefined
        ? { approachX: o.monsterPrevX, approachY: o.monsterPrevY }
        : {}),
    });
  }, [releaseSinglePlayerEncounterShell]);

  const declinePendingCombat = useCallback(() => {
    const o = pendingCombatOfferRef.current;
    if (!o) return;
    const l = labRef.current;
    if (!l) return;
    if (o.source === "monster" && !monsterHasAdjacentEscapeCell(l, o.monsterIndex)) {
      combatToastSeqRef.current += 1;
      const seq = combatToastSeqRef.current;
      setCombatToast({
        seq,
        message: "No free cell — you must fight or move away.",
        style: "hint",
      });
      setTimeout(() => {
        setCombatToast((t) => (t?.seq === seq ? null : t));
      }, 3200);
      return;
    }
    pendingCombatOfferRef.current = null;
    setPendingCombatOffer(null);
    setCollisionEffect(null);
    if (o.source === "player" && o.prevX !== undefined && o.prevY !== undefined) {
      const refund = !TEMP_INFINITE_MOVES && (o.moveCostPaid ?? 0) > 0 ? o.moveCostPaid! : 0;
      if (refund > 0) {
        movesLeftRef.current += refund;
        setMovesLeft(movesLeftRef.current);
      }
    }
    setLab((prev) => {
      if (!prev || winnerRef.current !== null) return prev;
      const next = new Labyrinth(prev.width, prev.height, 0, prev.numPlayers, prev.monsterDensity, prev.firstMonsterType);
      next.grid = prev.grid.map((r) => [...r]);
      next.players = prev.players.map((p) => ({ ...p }));
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
      next.bombCollectedBy = new Map(
        [...(prev.bombCollectedBy || new Map()).entries()].map(([k, v]) => [k, new Set(v)])
      );
      next.teleportUsedFrom = new Map(
        [...(prev.teleportUsedFrom || new Map()).entries()].map(([k, v]) => [k, new Set(v)])
      );
      next.teleportUsedTo = new Map(
        [...(prev.teleportUsedTo || new Map()).entries()].map(([k, v]) => [k, new Set(v)])
      );
      next.catapultUsedFrom = new Map(
        [...(prev.catapultUsedFrom || new Map()).entries()].map(([k, v]) => [k, new Set(v)])
      );
      next.visitedCells = new Set(prev.visitedCells || []);
      if (o.source === "player") {
        const pl = next.players[o.playerIndex];
        if (pl && o.prevX !== undefined && o.prevY !== undefined) {
          pl.x = o.prevX;
          pl.y = o.prevY;
        }
      } else {
        const m = next.monsters[o.monsterIndex];
        if (m) {
          const dirs: [number, number][] = [
            [0, -1],
            [1, 0],
            [0, 1],
            [-1, 0],
          ];
          for (const [dx, dy] of dirs) {
            const nx = m.x + dx;
            const ny = m.y + dy;
            if (nx < 0 || ny < 0 || nx >= next.width || ny >= next.height) continue;
            if (next.grid[ny]?.[nx] !== PATH) continue;
            if (next.players.some((pl) => pl.x === nx && pl.y === ny)) continue;
            if (next.monsters.some((om, i) => i !== o.monsterIndex && om.x === nx && om.y === ny)) continue;
            m.x = nx;
            m.y = ny;
            break;
          }
        }
      }
      return next;
    });
  }, []);

  const scrollToCurrentPlayerOnMap = useCallback(() => {
    const el = currentPlayerCellRef.current;
    if (el) {
      requestAnimationFrame(() => {
        el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      });
    }
  }, []);

  const switchToGridAndFocusCurrentPlayer = useCallback(() => {
    setMazeMapView("grid");
    // Wait for grid view to mount and current-player cell ref to become available.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollToCurrentPlayerOnMap();
      });
    });
  }, [scrollToCurrentPlayerOnMap]);

  /** Touch 3D: joystick “forward” tracks camera aim (cardinal snap in parent state + ref for same-frame reads). */
  const onTouchCameraForwardGrid = useCallback((dx: number, dy: number) => {
    const pi = currentPlayerRef.current;
    setPlayerFacing((prev) => {
      const next = { ...prev, [pi]: { dx, dy } };
      playerFacingRef.current = next;
      return next;
    });
  }, []);
  const [isoCamRotateActive, setIsoCamRotateActive] = useState(false);
  /** Continuous camera “into view” bearing for player-centered mini-maps (touch orbit vs cardinal-facing only). */
  const [isoCameraBearingDeg, setIsoCameraBearingDeg] = useState<number | null>(null);
  const onIsoCameraBearingDeg = useCallback((deg: number) => {
    isoCameraBearingDegRef.current = deg;
    setIsoCameraBearingDeg(deg);
  }, []);
  useEffect(() => {
    if (mazeMapView !== "iso") setIsoCamRotateActive(false);
  }, [mazeMapView]);
  useEffect(() => {
    if (mazeMapView !== "iso") {
      isoCameraBearingDegRef.current = null;
      setIsoCameraBearingDeg(null);
    }
  }, [mazeMapView]);

  /** Keep walk basis + 3D pawn yaw aligned with current orbit (same snap as minimap / `onTouchCameraForwardGrid`). */
  useEffect(() => {
    if (mazeMapView !== "iso" || isoCameraBearingDeg == null) {
      prevIsoWalkCardinalKeyRef.current = null;
      return;
    }
    const g = cardinalGridFromIsoBearingDeg(isoCameraBearingDeg);
    const key = `${g.dx},${g.dy}`;
    if (prevIsoWalkCardinalKeyRef.current === key) return;
    prevIsoWalkCardinalKeyRef.current = key;
    setPlayerFacing((prev) => {
      const cur = prev[currentPlayer];
      if (cur?.dx === g.dx && cur?.dy === g.dy) return prev;
      const next = { ...prev, [currentPlayer]: { dx: g.dx, dy: g.dy } };
      playerFacingRef.current = next;
      return next;
    });
  }, [mazeMapView, isoCameraBearingDeg, currentPlayer]);

  const leaveIsoImmersiveOnly = useCallback(async () => {
    setIsoImmersiveFallback(false);
    if (typeof document === "undefined") return;
    const fs = getFullscreenElement();
    if (
      fs != null &&
      (fs === isoPlayRootRef.current ||
        fs === mazeWrapRef.current ||
        fs === mazeAreaRef.current)
    ) {
      await exitDocumentFullscreen();
    }
  }, []);

  /** Always use the shared play shell so 2D ↔ 3D toggles do not drop native fullscreen. */
  const enterPlayFullscreen = useCallback(async () => {
    if (typeof document === "undefined") return;
    const el = mazeAreaRef.current ?? mazeWrapRef.current;
    if (!el) return;
    if (isIosLikeFullscreenHost()) {
      setIsoImmersiveFallback(true);
      return;
    }
    try {
      await requestFullscreenOnElement(el);
    } catch {
      setIsoImmersiveFallback(true);
      return;
    }
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    if (!getFullscreenElement()) {
      setIsoImmersiveFallback(true);
    }
  }, []);

  const onIsoViewButtonClick = useCallback(() => {
    setMazeMapView("iso");
  }, []);

  /** When native fullscreen is on mazeAreaRef, modals must be portaled inside it to stay visible. */
  const fsPortalTarget = isoNativeFsActive ? (mazeAreaRef.current ?? null) : null;

  /** Mobile: always use the immersive play shell while a game is active (transparent top island, no exit). */
  useEffect(() => {
    if (!isMobile || typeof document === "undefined") return;
    if (lab) {
      const id = requestAnimationFrame(() => {
        void enterPlayFullscreen();
      });
      return () => cancelAnimationFrame(id);
    }
    void leaveIsoImmersiveOnly();
    return undefined;
  }, [isMobile, lab, enterPlayFullscreen, leaveIsoImmersiveOnly]);

  useEffect(() => {
    if (!isoImmersiveUi || isMobile) return;
    if (
      showDiceModal &&
      winner === null &&
      lab &&
      movesLeft <= 0 &&
      diceResult === null &&
      !combatState &&
      !combatResult
    ) {
      void leaveIsoImmersiveOnly();
    }
  }, [
    isoImmersiveUi,
    isMobile,
    combatState,
    combatResult,
    showDiceModal,
    winner,
    lab,
    movesLeft,
    diceResult,
    leaveIsoImmersiveOnly,
  ]);

  useEffect(() => {
    if (!isoNativeFsActive && !isoImmersiveFallback) {
      setImmersiveInventoryPick(null);
    }
  }, [isoNativeFsActive, isoImmersiveFallback]);

  useEffect(() => {
    if (catapultPicker || teleportPicker || pendingCombatOffer) {
      setImmersiveInventoryPick(null);
    }
  }, [catapultPicker, teleportPicker, pendingCombatOffer]);

  if (!gameStarted) {
    if (!startMenuReady) {
      return (
        <div
          style={{
            ...startModalOverlayStyle,
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <div role="status" aria-live="polite" style={startMenuLoadingInnerStyle}>
            <div className="start-menu-loading-spinner" aria-hidden />
            <p style={startMenuLoadingTextStyle}>Loading</p>
          </div>
        </div>
      );
    }
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
            : {
                justifyContent: "flex-start",
                alignItems: "center",
                paddingLeft: "clamp(16px, 4vw, 56px)",
                paddingRight: "clamp(12px, 2vw, 28px)",
              }),
        }}
      >
        <div
          className="start-menu-panel-enter"
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
          <h1 style={startModalTitleWrapStyle}>
            <img
              src={GAME_TITLE_LABEL_SRC}
              alt={GAME_DISPLAY_TITLE}
              width={1024}
              height={419}
              style={{
                width: "min(100%, min(92vw, 520px))",
                height: "auto",
                display: "block",
                margin: "0 auto",
                filter: "drop-shadow(0 4px 22px rgba(0,0,0,0.9))",
              }}
            />
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
              <label style={isMobile ? startModalLabelStyleMobile : startModalLabelStyle}>First monster</label>
              <select
                value={firstMonsterType}
                onChange={(e) => setFirstMonsterType(e.target.value as import("@/lib/labyrinth").MonsterType)}
                style={{ ...startModalSelectStyle, ...(isMobile ? { width: "100%", minHeight: 44 } : {}) }}
              >
                {(["V", "K", "Z", "S", "G", "L", "O"] as const).map((t) => (
                  <option key={t} value={t}>
                    {t === "V"
                      ? "🧛 Dracula"
                      : t === "K"
                        ? "💀 Skeleton"
                        : t === "Z"
                          ? "🧟 Zombie"
                          : t === "S"
                            ? "🕷 Spider"
                            : t === "G"
                              ? "👻 Ghost"
                              : t === "O"
                                ? "🤡 Dread Clown"
                                : "🔥 Lava Elemental"}
                  </option>
                ))}
              </select>
            </div>
            {MULTIPLAYER_ENABLED ? (
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
            ) : null}
            <div
              style={{
                ...modalRowStyle,
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 8,
                marginBottom: 0,
              }}
            >
              <label style={isMobile ? startModalLabelStyleMobile : startModalLabelStyle}>
                Player names & avatars <span style={{ opacity: 0.75, fontWeight: 500 }}>(horror hunters + emoji)</span>
              </label>
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
                        alignItems: "center",
                      }}
                    >
                      {i === 0 ? (
                        <div
                          title={HORROR_HERO_PORTRAITS[0]!.title}
                          style={{
                            width: AVATAR_PICKER_BTN_PX,
                            height: AVATAR_PICKER_BTN_PX,
                            border: `2px solid ${START_MENU_ACCENT_BRIGHT}`,
                            borderRadius: 6,
                            background: START_MENU_SELECTED_FILL,
                            overflow: "hidden",
                            flexShrink: 0,
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <img
                            src={heroPortraitImgSrc(PLAYER_1_FIXED_AVATAR_PATH)}
                            alt=""
                            draggable={false}
                            style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center top" }}
                          />
                        </div>
                      ) : (
                        <>
                          {HORROR_HERO_PORTRAITS.map((h) => (
                            <button
                              key={h.path}
                              type="button"
                              title={h.title}
                              className="start-menu-avatar-btn"
                              onClick={() => {
                                setPlayerAvatars((prev) => {
                                  const next =
                                    prev.length >= numPlayers
                                      ? [...prev]
                                      : [
                                          ...prev,
                                          ...Array.from({ length: numPlayers - prev.length }, (_, j) =>
                                            PLAYER_AVATARS[(prev.length + j) % PLAYER_AVATARS.length]
                                          ),
                                        ];
                                  next[i] = h.path;
                                  return next;
                                });
                              }}
                              style={{
                                width: AVATAR_PICKER_BTN_PX,
                                height: AVATAR_PICKER_BTN_PX,
                                padding: 0,
                                lineHeight: 1,
                                border:
                                  (playerAvatars[i] ?? PLAYER_AVATARS[i % PLAYER_AVATARS.length]) === h.path
                                    ? `2px solid ${START_MENU_ACCENT_BRIGHT}`
                                    : `1px solid ${START_MENU_BORDER_MUTE}`,
                                borderRadius: 6,
                                background:
                                  (playerAvatars[i] ?? PLAYER_AVATARS[i % PLAYER_AVATARS.length]) === h.path
                                    ? START_MENU_SELECTED_FILL
                                    : START_MENU_CTRL_BG,
                                cursor: "pointer",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                overflow: "hidden",
                              }}
                            >
                              <img
                                src={h.path}
                                alt=""
                                draggable={false}
                                style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center top" }}
                              />
                            </button>
                          ))}
                          {PLAYER_AVATARS.map((av) => (
                            <button
                              key={av}
                              type="button"
                              className="start-menu-avatar-btn"
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
                                border:
                                  (playerAvatars[i] ?? PLAYER_AVATARS[i % PLAYER_AVATARS.length]) === av
                                    ? `2px solid ${START_MENU_ACCENT_BRIGHT}`
                                    : `1px solid ${START_MENU_BORDER_MUTE}`,
                                borderRadius: 6,
                                background:
                                  (playerAvatars[i] ?? PLAYER_AVATARS[i % PLAYER_AVATARS.length]) === av
                                    ? START_MENU_SELECTED_FILL
                                    : START_MENU_CTRL_BG,
                                cursor: "pointer",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              {av}
                            </button>
                          ))}
                        </>
                      )}
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
            <div
              style={{
                ...modalRowStyle,
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 8,
                marginBottom: 0,
                marginTop: 10,
              }}
            >
              <label style={isMobile ? startModalLabelStyleMobile : startModalLabelStyle}>
                {"Weapon & armour "}
                <span style={{ opacity: 0.75, fontWeight: 500 }}>(per player — combine freely)</span>
              </label>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%" }}>
                {Array.from({ length: numPlayers }).map((_, i) => (
                  <div
                    key={`equip-${i}`}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      width: "100%",
                      padding: "6px 0",
                      borderBottom: i < numPlayers - 1 ? "1px solid rgba(255,255,255,0.06)" : undefined,
                    }}
                  >
                    <span
                      style={{
                        color: PLAYER_COLORS[i] ?? "#ecc0b0",
                        fontSize: "0.82rem",
                        fontWeight: 600,
                      }}
                    >
                      {(playerNames[i] ?? `P${i + 1}`).slice(0, 10)}
                    </span>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: isMobile ? "column" : "row",
                        alignItems: isMobile ? "stretch" : "flex-start",
                        gap: isMobile ? 4 : 8,
                        width: "100%",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "0.7rem",
                          color: "#8a7a72",
                          minWidth: isMobile ? undefined : 52,
                          paddingTop: isMobile ? 0 : 6,
                          flexShrink: 0,
                        }}
                      >
                        Weapon
                      </span>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, flex: 1 }}>
                        <button
                          type="button"
                          className="start-menu-avatar-btn"
                          onClick={() => {
                            setPlayerWeaponGlb((prev) => {
                              const next =
                                prev.length >= numPlayers
                                  ? [...prev]
                                  : [
                                      ...prev,
                                      ...Array.from(
                                        { length: numPlayers - prev.length },
                                        (_, j) => WEAPON_OPTIONS[j % WEAPON_OPTIONS.length]!.path,
                                      ),
                                    ];
                              next[i] = NO_ARMOUR_SENTINEL;
                              return next;
                            });
                          }}
                          style={{
                            height: 32,
                            padding: "0 8px",
                            lineHeight: 1,
                            border:
                              (playerWeaponGlb[i] ?? WEAPON_OPTIONS[0]!.path) === NO_ARMOUR_SENTINEL
                                ? `2px solid ${START_MENU_ACCENT_BRIGHT}`
                                : `1px solid ${START_MENU_BORDER_MUTE}`,
                            borderRadius: 6,
                            background:
                              (playerWeaponGlb[i] ?? WEAPON_OPTIONS[0]!.path) === NO_ARMOUR_SENTINEL
                                ? START_MENU_SELECTED_FILL
                                : START_MENU_CTRL_BG,
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "0.72rem",
                            color: "#c9a090",
                            whiteSpace: "nowrap",
                          }}
                        >
                          None
                        </button>
                        {WEAPON_OPTIONS.map((a) => (
                          <button
                            key={a.path}
                            type="button"
                            title={a.label}
                            className="start-menu-avatar-btn"
                            onClick={() => {
                              setPlayerWeaponGlb((prev) => {
                                const next =
                                  prev.length >= numPlayers
                                    ? [...prev]
                                    : [
                                        ...prev,
                                        ...Array.from(
                                          { length: numPlayers - prev.length },
                                          (_, j) => WEAPON_OPTIONS[j % WEAPON_OPTIONS.length]!.path,
                                        ),
                                      ];
                                next[i] = a.path;
                                return next;
                              });
                            }}
                            style={{
                              height: 32,
                              padding: "0 8px",
                              lineHeight: 1,
                              border:
                                (playerWeaponGlb[i] ?? WEAPON_OPTIONS[0]!.path) === a.path
                                  ? `2px solid ${START_MENU_ACCENT_BRIGHT}`
                                  : `1px solid ${START_MENU_BORDER_MUTE}`,
                              borderRadius: 6,
                              background:
                                (playerWeaponGlb[i] ?? WEAPON_OPTIONS[0]!.path) === a.path
                                  ? START_MENU_SELECTED_FILL
                                  : START_MENU_CTRL_BG,
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                              fontSize: "0.72rem",
                              color: "#ecc0b0",
                              whiteSpace: "nowrap",
                            }}
                          >
                            <span>{a.emoji}</span>
                            <span>{a.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: isMobile ? "column" : "row",
                        alignItems: isMobile ? "stretch" : "flex-start",
                        gap: isMobile ? 4 : 8,
                        width: "100%",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "0.7rem",
                          color: "#8a7a72",
                          minWidth: isMobile ? undefined : 52,
                          paddingTop: isMobile ? 0 : 6,
                          flexShrink: 0,
                        }}
                      >
                        Armour
                      </span>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, flex: 1 }}>
                        <button
                          type="button"
                          className="start-menu-avatar-btn"
                          onClick={() => {
                            setPlayerOffhandArmourGlb((prev) => {
                              const next =
                                prev.length >= numPlayers
                                  ? [...prev]
                                  : [...prev, ...Array.from({ length: numPlayers - prev.length }, () => NO_ARMOUR_SENTINEL)];
                              next[i] = NO_ARMOUR_SENTINEL;
                              return next;
                            });
                          }}
                          style={{
                            height: 32,
                            padding: "0 8px",
                            lineHeight: 1,
                            border:
                              (playerOffhandArmourGlb[i] ?? NO_ARMOUR_SENTINEL) === NO_ARMOUR_SENTINEL
                                ? `2px solid ${START_MENU_ACCENT_BRIGHT}`
                                : `1px solid ${START_MENU_BORDER_MUTE}`,
                            borderRadius: 6,
                            background:
                              (playerOffhandArmourGlb[i] ?? NO_ARMOUR_SENTINEL) === NO_ARMOUR_SENTINEL
                                ? START_MENU_SELECTED_FILL
                                : START_MENU_CTRL_BG,
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "0.72rem",
                            color: "#c9a090",
                            whiteSpace: "nowrap",
                          }}
                        >
                          None
                        </button>
                        {OFFHAND_ARMOUR_OPTIONS.map((a) => (
                          <button
                            key={a.path}
                            type="button"
                            title={a.label}
                            className="start-menu-avatar-btn"
                            onClick={() => {
                              setPlayerOffhandArmourGlb((prev) => {
                                const next =
                                  prev.length >= numPlayers
                                    ? [...prev]
                                    : [...prev, ...Array.from({ length: numPlayers - prev.length }, () => NO_ARMOUR_SENTINEL)];
                                next[i] = a.path;
                                return next;
                              });
                            }}
                            style={{
                              height: 32,
                              padding: "0 8px",
                              lineHeight: 1,
                              border:
                                (playerOffhandArmourGlb[i] ?? NO_ARMOUR_SENTINEL) === a.path
                                  ? `2px solid ${START_MENU_ACCENT_BRIGHT}`
                                  : `1px solid ${START_MENU_BORDER_MUTE}`,
                              borderRadius: 6,
                              background:
                                (playerOffhandArmourGlb[i] ?? NO_ARMOUR_SENTINEL) === a.path
                                  ? START_MENU_SELECTED_FILL
                                  : START_MENU_CTRL_BG,
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                              fontSize: "0.72rem",
                              color: "#ecc0b0",
                              whiteSpace: "nowrap",
                            }}
                          >
                            <span>{a.emoji}</span>
                            <span>{a.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div style={startModalButtonsStyle}>
            <button
              type="button"
              className="start-menu-cta"
              onClick={() => {
                newGame({ initSource: "start_menu_play" });
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
    labRef.current = null;
    return (
      <div style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#0f0f14", color: "#00ff88", fontFamily: "Courier New, monospace", fontSize: "1.2rem" }}>
        Generating maze…
      </div>
    );
  }

  /** Same-tick as this render — before useEffect / setInterval callbacks that read these refs (monster AI must see combat open). */
  labRef.current = lab;
  combatStateRef.current = combatState;
  pendingCombatOfferRef.current = pendingCombatOffer;
  combatResultRef.current = combatResult;
  currentPlayerRef.current = currentPlayer;
  playerFacingRef.current = playerFacing;
  winnerRef.current = winner;
  combatFooterSnapshotRef.current = combatFooterSnapshot;
  combatRecoveryPhaseRef.current = combatRecoveryPhase;
  movesLeftRef.current = movesLeft;
  diceResultRef.current = diceResult;

  /** While a lab is active and not in iso-immersive chrome, keep the bottom dock expanded (no collapse row). Desktop 3D dock is omitted from the DOM; this avoids stale collapsed state. */
  const windowedBottomDockLocked = !isoImmersiveUi && !!lab;
  const effectiveDesktopControlsCollapsed = windowedBottomDockLocked ? false : desktopControlsCollapsed;
  const effectiveMobileDockExpanded = windowedBottomDockLocked || mobileDockExpanded;
  mobileDockExpandedRef.current = effectiveMobileDockExpanded;

  const showMoveGrid =
    movesLeft > 0 &&
    !combatState &&
    !pendingCombatOffer &&
    winner === null &&
    (isMobile ? effectiveMobileDockExpanded : !effectiveDesktopControlsCollapsed);
  /** Phone landscape: used with desktop-style split HUD; windowed mobile 3D always uses the three-column strip (map | items | move). */
  const splitIsoHudMapAndMove = isMobile && isLandscapeCompact;
  /** Map pinned one side of the bar / screen, joystick the other (landscape phone or desktop iso + moves). */
  const splitIsoHudOppositeScreen =
    splitIsoHudMapAndMove || (!isMobile && !!lab && mazeMapView === "iso" && showMoveGrid);
  /** Mobile iso uses edge / immersive HUD; windowed desktop 3D needs the bottom dock (fullscreen uses the immersive bar instead). */
  const showUnifiedDockInDesktopIso =
    !isMobile && mazeMapView === "iso" && !!lab && !isoImmersiveUi;
  /** Windowed desktop 3D: mini-map left, artifacts + turn center, move ring right (not immersive). */
  const desktopWindowedIsoThreeColumnDock =
    showUnifiedDockInDesktopIso && splitIsoHudOppositeScreen && !pendingCombatOffer;
  /** Desktop grid with moves: same three-zone strip (map left, center, move right). */
  const desktopGridThreeColumnDock =
    !isMobile && !pendingCombatOffer && mazeMapView === "grid" && !!lab && showMoveGrid;
  const desktopDockThreeColumn = desktopWindowedIsoThreeColumnDock || desktopGridThreeColumnDock;
  /** Full-width collapsible bar; narrowed + centered while monster ambush / fight-offer is open. */
  const desktopDockFullWidthBar = !isMobile && !pendingCombatOffer && !!lab;
  /** Collapsed desktop dock: grid only — map/move stay in dock for grid view. */
  const desktopDockCollapsedGridMapMoveStrip =
    !isMobile &&
    effectiveDesktopControlsCollapsed &&
    !!lab &&
    !pendingCombatOffer &&
    mazeMapView === "grid";
  /** Desktop windowed 3D: mini-map, move, zoom, items, and turn on the WebGL layer (no strip under the map). */
  const desktopWindowedIsoAllHudOnCanvas =
    !isMobile && !!lab && showUnifiedDockInDesktopIso;
  /** Any desktop 3D session: keep the unified dock out of document flow (HUD is on the WebGL stack). */
  const hideUnifiedBottomDockInDesktop3d = !isMobile && mazeMapView === "iso" && !!lab;
  const inCombatDock = !!combatState;
  const totalDiamondsDock = lab.players.reduce((s, pl) => s + (pl.diamonds ?? 0), 0);
  const bombUseDisabled = !cp || (cp?.bombs ?? 0) <= 0 || (moveDisabled && !combatState);
  const artifactUseDisabledDock = (kind: StoredArtifactKind) => {
    if (!cp) return true;
    if (inCombatDock && isStoredArtifactMazePhaseOnly(kind)) return true;
    if (!inCombatDock && isStoredArtifactCombatPhaseOnly(kind)) return true;
    if (kind === "healing" && (cp.hp ?? DEFAULT_PLAYER_HP) >= DEFAULT_PLAYER_HP) return true;
    if (kind === "reveal" && peekRevealBatchSize(lab, totalDiamondsDock) <= 0) return true;
    return false;
  };
  const mobileApplyDisabled =
    mobileDockAction == null
      ? true
      : mobileDockAction === "bomb"
        ? bombUseDisabled
        : mobileDockAction === "catapultCharge"
          ? !canOfferSlingshotDock
        : artifactUseDisabledDock(mobileDockAction);
  const immersiveApplyDisabled =
    immersiveInventoryPick == null
      ? true
      : immersiveInventoryPick === "bomb"
        ? bombUseDisabled
        : immersiveInventoryPick === "catapultCharge"
          ? !canOfferSlingshotDock
          : artifactUseDisabledDock(immersiveInventoryPick);
  const dockActions: { id: MobileDockAction; n: number }[] = [];
  if ((cp?.bombs ?? 0) > 0) dockActions.push({ id: "bomb", n: cp!.bombs ?? 0 });
  if ((cp?.catapultCharges ?? 0) > 0) dockActions.push({ id: "catapultCharge", n: cp!.catapultCharges ?? 0 });
  for (const k of STORED_ARTIFACT_ORDER) {
    const n = storedArtifactCount(cp, k);
    if (n <= 0) continue;
    if (isStoredArtifactCombatPhaseOnly(k) && !inCombatDock) continue;
    dockActions.push({ id: k, n });
  }

  /** While true, bottom “Items” / bomb row is replaced by slingshot · magic · teleport · immersive item prompts. */
  const bottomDockContextActive =
    (canOfferSlingshotDock && !catapultPicker) ||
    !!catapultPicker ||
    !!teleportPicker ||
    (magicPortalReady && !teleportPicker) ||
    (immersiveInventoryPick !== null && showMoveGrid);

  const combatOverlayVisible =
    !!(combatState || combatResult) && (!combatState || combatState.playerIndex === currentPlayer);

  /** Mobile flat 3D: viewport-sized canvas behind UI (immersive full-screen uses its own layer). */
  const mobileIsoEdgeToEdge =
    isMobile && mazeMapView === "iso" && lab && !isoImmersiveUi && !combatOverlayVisible;

  /** Phone landscape 2D: zoom + moves live in the fixed top HUD so they are not duplicated under a lower z-index sticky row. */
  const mobileLandscapeGridChromeInFixedHud =
    isMobile && isLandscapeCompact && mazeMapView === "grid" && !isoImmersiveUi && !!lab;

  /** 3D: drop padded `maze-wrap` / inner card chrome; WebGL fills the play shell (mobile edge, immersive, desktop windowed). */
  const mazeIsoFillViewport =
    mazeMapView === "iso" &&
    (mobileIsoEdgeToEdge || isoImmersiveUi || (!isMobile && !isoImmersiveUi && !!lab));
  /** Mobile 3D: fixed viewport-sized layer so canvas is not inset by `maze-wrap` / mazeArea padding. */
  const isoPlayRootViewportFill =
    mazeMapView === "iso" && (mobileIsoEdgeToEdge || (isoImmersiveUi && isMobile));

  /** Unified combat scene: dice + roll/run live in the face-off row; hide duplicate lower dice strip. */
  const useCombatLandscapeFaceoff =
    combatState !== null && combatResult === null;
  /** Unified combat scene after combat: keep versus row; center outcome + bonus over sprites (no portrait stack / scroll). */
  const combatLandscapePostFight = combatResult !== null;
  const showCombatLandscapeVersus =
    combatState !== null || combatResult !== null;
  /** After death clip (or loss): show outcome + bonus in a centered modal layer, not the bottom strip. */
  const showCombatOutcomeCenterOverlay =
    combatResult !== null &&
    combatVictoryDeathAnimReady &&
    (!pendingCombatBonusPick || bonusLootRevealed);
  /** Mobile live fight — extra chrome (dice strip height, title) only on small screens. */
  const mobileCompactActiveCombat =
    isMobile && combatState !== null && combatResult === null;
  /** Live fight: modal + face-off use viewport height and collapsed lower slot (desktop + mobile). */
  const combatActiveFitViewport = useCombatLandscapeFaceoff;
  /** Full monster hint for dismissible ℹ popover (all layouts). */
  const combatMonsterHintFullText =
    lab && combatState && !combatResult
      ? `💡 ${getMonsterHint(combatState.monsterType, lab.monsters[combatState.monsterIndex]?.hasShield)}`
      : null;

  const renderCombatBonusLootPicker = () => {
    if (!combatResult) return null;
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
    const current = opts[idx]!;
    return (
      <div className="combat-bonus-loot-panel" style={combatBonusLootPanelStyle}>
        <div className="combat-bonus-loot-title" style={combatBonusLootTitleStyle}>
          Bonus loot — pick one
        </div>
        <div className="combat-bonus-loot-carousel" style={{ display: "flex", alignItems: "center", width: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", justifyContent: "center" }}>
            <button
              type="button"
              onClick={() => setBonusLootSelectedIndex((i) => (i - 1 + n) % n)}
              style={{
                ...buttonStyle,
                width: 28,
                height: 28,
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
                maxWidth: 280,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 2,
                padding: "0 2px",
              }}
            >
              <button
                type="button"
                onClick={() => handlePickCombatBonusReward(pi, mt, current)}
                style={{
                  ...buttonStyle,
                  width: "100%",
                  minHeight: COMBAT_BONUS_LOOT_PICK_MIN_HEIGHT_PX,
                  boxSizing: "border-box",
                  background: "#2a2a2e",
                  color: "#ddd",
                  border: "1px solid #555",
                  borderRadius: 8,
                  padding: "2px 6px 4px",
                  fontWeight: "bold",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 3,
                  boxShadow: "0 0 6px rgba(0,0,0,0.3)",
                }}
              >
                <div
                  style={{
                    width: COMBAT_BONUS_LOOT_ICON_PX,
                    height: COMBAT_BONUS_LOOT_ICON_PX,
                    flex: "0 0 auto",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: "hidden",
                    lineHeight: 0,
                    filter: "drop-shadow(0 0 3px rgba(255,255,255,0.15))",
                  }}
                >
                  {getBonusRewardIcon(current, COMBAT_BONUS_LOOT_ICON_PX)}
                </div>
                <span
                  style={{
                    fontSize: "0.78rem",
                    lineHeight: 1.15,
                    minHeight: "2.2em",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    textAlign: "center",
                    width: "100%",
                  }}
                >
                  {formatMonsterBonusRewardLabel(current)}
                </span>
              </button>
              <span style={{ fontSize: "0.6rem", color: "#889988", fontWeight: 600, lineHeight: 1 }}>
                {idx + 1} / {n}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setBonusLootSelectedIndex((i) => (i + 1) % n)}
              style={{
                ...buttonStyle,
                width: 28,
                height: 28,
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
          className="combat-bonus-loot-skip"
          onClick={() => handlePickCombatBonusReward(pi, mt, "skip")}
          style={{
            ...buttonStyle,
            marginTop: 0,
            width: "100%",
            background: "#2a2a2e",
            color: "#888",
            border: "1px solid #444",
            borderRadius: 6,
            fontSize: "0.7rem",
            padding: "4px 8px",
          }}
        >
          Skip
        </button>
      </div>
    );
  };

  const renderCombatOutcome = (omitBonusLootForLandscape?: boolean) => {
    if (!combatResult) return null;
    const bonusLootPickerEl = omitBonusLootForLandscape ? null : renderCombatBonusLootPicker();
    const suppressBannerForBonusLoot = pendingCombatBonusPick && bonusLootRevealed;
    const showClosingHint = !pendingCombatBonusPick && !combatResult.playerDefeated;
    if (suppressBannerForBonusLoot && !bonusLootPickerEl && !showClosingHint) return null;
    return (
      <div
        role="region"
        aria-label="Combat outcome"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          width: "100%",
          gap: 8,
          boxSizing: "border-box",
        }}
      >
        {!suppressBannerForBonusLoot && (
        <div
            style={{
              ...combatResultBannerStyle,
              width: "min(100%, 400px)",
              maxWidth: "100%",
              alignSelf: "center",
              boxSizing: "border-box",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
              border: `2px solid ${
                (combatResult.draculaWeakened || combatResult.monsterWeakened)
                  ? "#ff6600"
                  : combatResult.monsterEffect === "skeleton_shield" || combatResult.monsterEffect === "ghost_evade"
                    ? "#ffcc00"
                    : combatResult.shieldAbsorbed
                      ? "#44ff88"
                      : combatResult.won
                        ? "#00ff88"
                        : "#ff4444"
              }`,
              background: (combatResult.draculaWeakened || combatResult.monsterWeakened)
                ? "rgba(255,102,0,0.2)"
                : combatResult.monsterEffect === "skeleton_shield" || combatResult.monsterEffect === "ghost_evade"
                  ? "rgba(255,204,0,0.15)"
                  : combatResult.shieldAbsorbed
                    ? "rgba(68,255,136,0.15)"
                    : combatResult.won
                      ? "rgba(0,255,136,0.22)"
                      : "rgba(255,68,68,0.15)",
            }}
          >
            <span
              style={{
                color: (combatResult.draculaWeakened || combatResult.monsterWeakened)
                  ? "#ff6600"
                  : combatResult.monsterEffect === "skeleton_shield" || combatResult.monsterEffect === "ghost_evade"
                    ? "#ffcc00"
                    : combatResult.shieldAbsorbed
                      ? "#44ff88"
                      : combatResult.won
                        ? "#00ff88"
                        : "#ff6666",
                fontSize: "1rem",
                fontWeight: "bold",
                textAlign: "center",
                lineHeight: 1.3,
              }}
            >
              {combatResult.draculaWeakened || combatResult.monsterWeakened
                ? `${getMonsterName(combatResult.monsterType!)} weakened! One more hit!`
                : combatResult.monsterEffect === "skeleton_shield"
                  ? "💀 Shield broken! Try again next turn."
                  : combatResult.won
                    ? (() => {
                        const primaryParts = [
                          combatResult.reward?.type === "jump" && "⬆️ +1 jump",
                          combatResult.reward?.type === "hp" && "❤️ +1 HP",
                          combatResult.reward?.type === "shield" && "🛡 +1 shield",
                          combatResult.reward?.type === "attackBonus" && "⚔️ +1 movement dice",
                          combatResult.reward?.type === "movement" && "🎯 +1 move",
                        ].filter(Boolean);
                        const bonusParts = [
                          combatResult.bonusReward?.type === "artifact" &&
                            `✨ ${formatMonsterBonusRewardLabel({ type: "artifact", amount: combatResult.bonusReward.amount })}`,
                          combatResult.bonusReward?.type === "storedArtifact" &&
                            `✨ ${formatMonsterBonusRewardLabel(combatResult.bonusReward)}`,
                          combatResult.bonusReward?.type === "torch" &&
                            `🔥 ${formatMonsterBonusRewardLabel(combatResult.bonusReward)}`,
                          combatResult.bonusReward?.type === "bomb" &&
                            `💣 ${formatMonsterBonusRewardLabel(combatResult.bonusReward)}`,
                          combatResult.bonusReward &&
                            combatResult.bonusReward.type === "bonusMoves" &&
                            `🎯 +${combatResult.bonusReward.amount} move${combatResult.bonusReward.amount > 1 ? "s" : ""}`,
                          combatResult.bonusReward?.type === "shield" && "🛡 +1 shield charge",
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
                {combatResult.reward?.type === "jump" && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }} title="+1 jump">
                    <ArtifactIcon variant="jump" size={40} />
                    <span style={{ fontSize: "0.95rem", fontWeight: 600 }}>+1 jump</span>
                  </span>
                )}
                {combatResult.reward?.type === "hp" && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }} title="+1 HP">
                    <ArtifactIcon variant="healing" size={40} />
                    <span style={{ fontSize: "0.95rem", fontWeight: 600 }}>+1 HP</span>
                  </span>
                )}
                {combatResult.reward?.type === "shield" && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }} title="+1 shield">
                    <ArtifactIcon variant="shield" size={40} />
                    <span style={{ fontSize: "0.95rem", fontWeight: 600 }}>+1 shield</span>
                  </span>
                )}
                {combatResult.reward?.type === "attackBonus" && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }} title="+1 on movement roll (max 6)">
                    <ArtifactIcon variant="magic" size={40} />
                    <span style={{ fontSize: "0.95rem", fontWeight: 600 }}>+1 movement</span>
                  </span>
                )}
                {combatResult.reward?.type === "movement" && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }} title="+1 move">
                    <ArtifactIcon variant="catapult" size={40} />
                    <span style={{ fontSize: "0.95rem", fontWeight: 600 }}>+1 move</span>
                  </span>
                )}
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
                    <ArtifactIcon variant="dice" size={40} />
                    <span style={{ fontSize: "0.95rem", fontWeight: 600 }}>
                      +{combatResult.bonusReward.amount} move{combatResult.bonusReward.amount > 1 ? "s" : ""}
                    </span>
                  </span>
                )}
                {combatResult.bonusReward?.type === "shield" && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }} title="+1 shield">
                    <ArtifactIcon variant="shield" size={40} />
                    <span style={{ fontSize: "0.95rem", fontWeight: 600 }}>+1 shield</span>
                  </span>
                )}
                {combatResult.bonusReward?.type === "jump" && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }} title="+1 jump">
                    <ArtifactIcon variant="jump" size={40} />
                    <span style={{ fontSize: "0.95rem", fontWeight: 600 }}>+1 jump</span>
                  </span>
                )}
                {combatResult.bonusReward?.type === "catapult" && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }} title="+1 catapult charge">
                    <ArtifactIcon variant="catapult" size={40} />
                    <span style={{ fontSize: "0.95rem", fontWeight: 600 }}>+1 catapult</span>
                  </span>
                )}
                {combatResult.bonusReward?.type === "diceBonus" && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }} title="+1 dice bonus">
                    <ArtifactIcon variant="dice" size={40} />
                    <span style={{ fontSize: "0.95rem", fontWeight: 600 }}>+1 dice bonus</span>
                  </span>
                )}
                {combatResult.bonusReward?.type === "storedArtifact" && (
                  <span
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, filter: "drop-shadow(0 0 6px rgba(255, 200, 100, 0.8))" }}
                    title={formatMonsterBonusRewardLabel(combatResult.bonusReward)}
                  >
                    <ArtifactIcon variant={storedArtifactIconVariant(combatResult.bonusReward.kind)} size={40} />
                    <span style={{ fontSize: "0.95rem", fontWeight: 600 }}>{formatMonsterBonusRewardLabel(combatResult.bonusReward)}</span>
                  </span>
                )}
                {combatResult.bonusReward?.type === "torch" && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }} title={formatMonsterBonusRewardLabel(combatResult.bonusReward)}>
                    <ArtifactIcon variant="torch" size={40} />
                    <span style={{ fontSize: "0.95rem", fontWeight: 600 }}>{formatMonsterBonusRewardLabel(combatResult.bonusReward)}</span>
                  </span>
                )}
                {combatResult.bonusReward?.type === "bomb" && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }} title={formatMonsterBonusRewardLabel(combatResult.bonusReward)}>
                    <ArtifactIcon variant="bomb" size={40} />
                    <span style={{ fontSize: "0.95rem", fontWeight: 600 }}>{formatMonsterBonusRewardLabel(combatResult.bonusReward)}</span>
                  </span>
                )}
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
        {bonusLootPickerEl}
        {showClosingHint && (
          <div style={{ fontSize: "0.72rem", color: "#666", marginTop: 4, textAlign: "center", width: "100%" }}>
            Closing…
          </div>
        )}
      </div>
    );
  };

  const landscapeCompactPlayHud = isLandscapeCompact && lab;
  /** Fixed menu panel position — must clear immersive HUD rows or the main header. */
  const headerMenuFixedDropdownTop =
    !isMobile && isoImmersiveUi
      ? "calc(max(8px, env(safe-area-inset-top, 0px)) + 58px)"
      : isMobile && landscapeCompactPlayHud && isoImmersiveUi
        ? "calc(max(6px, env(safe-area-inset-top, 0px)) + 56px)"
        : isMobile && landscapeCompactPlayHud
          ? "calc(max(6px, env(safe-area-inset-top, 0px)) + 52px)"
          : isoImmersiveUi
            ? "calc(max(8px, env(safe-area-inset-top, 0px)) + 118px)"
            : `${HEADER_HEIGHT + 8}px`;
  const headerMenuUseFixedLayer = isMobile || isoImmersiveUi;

  const renderHeaderMenuBlock = () => (
        <div ref={headerMenuRef} style={{ position: "relative", flexShrink: 0 }}>
        <button
            type="button"
            className="header-menu-trigger"
            onClick={() => setHeaderMenuOpen((o) => !o)}
            aria-expanded={headerMenuOpen}
            aria-haspopup="menu"
            aria-label="Menu"
            title="Menu"
            style={{
              ...buttonStyle,
              ...headerButtonStyle,
              ...headerMenuTriggerStyle,
              background: headerMenuOpen ? "rgba(42, 20, 18, 0.98)" : START_MENU_CTRL_BG,
              border: `1px solid ${headerMenuOpen ? START_MENU_BORDER : START_MENU_BORDER_MUTE}`,
              color: headerMenuOpen ? "#ffd4c4" : "#ecc0b0",
              ...(isMobile
                ? {
                    minWidth: 44,
                    minHeight: 44,
                    padding: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "1.35rem",
                    lineHeight: 1,
                  }
                : {
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                  }),
            }}
          >
            {isMobile ? "☰" : (
              <>
                Menu
                <span aria-hidden style={{ fontSize: "0.65rem", opacity: 0.9, lineHeight: 1 }}>
                  ▼
                </span>
              </>
            )}
        </button>
          {headerMenuOpen && (
            <div
              role="menu"
              className="header-menu-dropdown"
              style={{
                ...headerDropdownPanelStyle,
            ...(headerMenuUseFixedLayer
                  ? {
                      position: "fixed",
                      left: 12,
                      right: 12,
                  top: headerMenuFixedDropdownTop,
                      marginTop: 0,
                      maxHeight: "min(72vh, 520px)",
                      overflowY: "auto",
                  zIndex: isoImmersiveUi ? ISO_IMMERSIVE_HUD_Z + 70 : HEADER_Z_INDEX + 2,
                    }
                  : {
                      position: "absolute",
                      top: "100%",
                      right: 0,
                      marginTop: 6,
                      minWidth: 272,
                      maxWidth: "min(92vw, 340px)",
                    }),
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: "0.65rem",
                    fontWeight: 700,
                    color: "#c9a090",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    marginBottom: 8,
                  }}
                >
                  Current progress
                </div>
                <div style={headerDropdownBodyStyle}>
                  <div
                    style={{
                      fontWeight: 700,
                      color:
                        winner !== null
                          ? winner >= 0
                            ? START_MENU_ACCENT_BRIGHT
                            : "#ff6666"
                          : START_MENU_ACCENT_BRIGHT,
                    }}
                  >
                    {winner !== null
                      ? winner >= 0
                        ? `${playerNames[winner] ?? `Player ${winner + 1}`} wins!`
                        : "Monsters win!"
                      : `${playerNames[currentPlayer] ?? `Player ${currentPlayer + 1}`}'s turn`}
                  </div>
                  <div>
                    <span style={headerDropdownMutedStyle}>Maze: </span>
                    {lab.width}×{lab.height}
                  </div>
                  <div>
                    <span style={headerDropdownMutedStyle}>Moves: </span>
                    {diceResult !== null ? `${Math.max(0, (bonusAdded ?? diceResult) - movesLeft)}/${bonusAdded ?? diceResult}` : "—/—"}
                  </div>
                  <div>
                    <span style={headerDropdownMutedStyle}>Round: </span>
                    {(lab.round ?? 0) + 1}/{MAX_ROUNDS}
                  </div>
                  <div>
                    <span style={headerDropdownMutedStyle}>Total moves: </span>
                    {totalMoves}
                  </div>
                  <div style={{ borderTop: `1px solid ${START_MENU_BORDER_MUTE}`, paddingTop: 8 }}>
                    <div style={{ ...headerDropdownMutedStyle, fontSize: "0.72rem", marginBottom: 6 }}>HP</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {lab.players.map((p, i) => (
                        <div
                          key={`hp-${i}`}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            color: lab.eliminatedPlayers.has(i) ? "#666" : (PLAYER_COLORS[i] ?? "#aaa"),
                            textDecoration: lab.eliminatedPlayers.has(i) ? "line-through" : undefined,
                          }}
                        >
                          <span style={{ fontWeight: 600 }}>{playerNames[i] ?? `P${i + 1}`}</span>
                          <span style={{ color: playerHpAccentColor(p?.hp ?? DEFAULT_PLAYER_HP), fontWeight: 700 }}>
                            {p?.hp ?? DEFAULT_PLAYER_HP}/{DEFAULT_PLAYER_HP}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div style={{ borderTop: `1px solid ${START_MENU_BORDER_MUTE}`, paddingTop: 8 }}>
                    <div style={{ ...headerDropdownMutedStyle, fontSize: "0.72rem", marginBottom: 6 }}>Diamonds</div>
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
                  className="start-menu-cta"
                  onClick={() => {
                    setHeaderMenuOpen(false);
                    setSettingsOpen(true);
                  }}
                  style={{ ...startButtonStyle, ...headerButtonStyle, width: "100%", justifyContent: "center", display: "flex" }}
                >
                  Game setup
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="header-menu-dropdown-secondary"
                  onClick={() => {
                    setHeaderMenuOpen(false);
                    setGameStarted(false);
                  }}
                  style={headerDropdownSecondaryBtnStyle}
                >
                  New game
                </button>
              </div>
            </div>
          )}
        </div>
  );

  /** Immersive chrome: full-width top bar (desktop + mobile landscape) or stacked island (mobile portrait). */
  const renderPlayFullscreenChrome = () => {
    const landscapeFsBar = isLandscapeCompact && isMobile;
    const desktopFsBar = !isMobile;
    const useFsTopBarRow = desktopFsBar || landscapeFsBar;
    const showLandscapeIsoCamChrome = landscapeFsBar && mazeMapView === "iso" && isoImmersiveUi;
    const zoomViewCluster = (
      <>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button
              type="button"
              onClick={() => setMazeZoom((z) => Math.max(MAZE_ZOOM_MIN, z - MAZE_ZOOM_STEP))}
              style={mazeZoomButtonStyle}
              title="Zoom out"
            >
              −
            </button>
            <span style={{ fontSize: "0.72rem", color: "#888", minWidth: 34, textAlign: "center" }}>
              {Math.round((mazeZoom / MAZE_ZOOM_BASELINE) * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setMazeZoom((z) => Math.min(MAZE_ZOOM_MAX, z + MAZE_ZOOM_STEP))}
              style={mazeZoomButtonStyle}
              title="Zoom in"
            >
              +
            </button>
          </div>
          {showLandscapeIsoCamChrome ? (
            <>
              <button
                type="button"
                onClick={() => mazeIsoViewRef.current?.resetCameraView()}
                style={{
                  ...mazeViewToggleButtonStyle(false),
                  minWidth: 52,
                  padding: "0 8px",
                  fontSize: "0.68rem",
                }}
                title="Reset camera to default view behind the player"
              >
                Reset
              </button>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  mazeIsoViewRef.current?.activateRotate();
                }}
                onTouchStart={(e) => {
                  e.preventDefault();
                  mazeIsoViewRef.current?.activateRotate();
                }}
                style={{
                  ...mazeViewToggleButtonStyle(isoCamRotateActive),
                  minWidth: 56,
                  padding: "0 8px",
                  fontSize: "0.68rem",
                }}
                title="Tilt device or drag on 3D to aim camera"
              >
                {isoCamRotateActive ? "Rotating" : "Rotate"}
              </button>
            </>
          ) : null}
        </div>
        <span style={{ fontSize: "0.65rem", color: "#888" }}>View</span>
        <button
          type="button"
          onClick={() => setMazeMapView("grid")}
          style={mazeViewToggleButtonStyle(mazeMapView === "grid")}
          title="Top-down 2D map (stays full-screen)"
          aria-pressed={mazeMapView === "grid"}
        >
          2D
        </button>
        <button
          type="button"
          onClick={onIsoViewButtonClick}
          style={mazeViewToggleButtonStyle(mazeMapView === "iso")}
          title="3D view (stays full-screen)"
          aria-pressed={mazeMapView === "iso"}
        >
          3D
        </button>
        {!isMobile ? (
          <button
            type="button"
            onClick={() => void leaveIsoImmersiveOnly()}
            style={{
              ...buttonStyle,
              ...headerButtonStyle,
              background: "#2a2a38",
              color: "#c8c8d8",
              border: "1px solid #555",
              fontWeight: 700,
              minWidth: 40,
              padding: "4px 10px",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            title="Exit full-screen"
            aria-label="Exit full-screen"
          >
            <FullscreenExitIcon />
          </button>
        ) : null}
      </>
    );

    const statsCluster = (
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 4,
          fontSize: "0.65rem",
          lineHeight: 1.35,
        }}
      >
        <span
          style={{
            ...headerStatItemStyle,
            color:
              winner !== null
                ? winner >= 0
                  ? "#00ff88"
                  : "#ff4444"
                : (PLAYER_COLORS_ACTIVE[currentPlayer] ?? "#00ff88"),
            fontWeight: "bold",
          }}
        >
          {winner !== null
            ? winner >= 0
              ? `${playerNames[winner] ?? `Player ${winner + 1}`} wins!`
              : "Monsters win!"
            : `${playerNames[currentPlayer] ?? `Player ${currentPlayer + 1}`}'s turn`}
        </span>
        <span style={headerStatDivider}>|</span>
        <span style={headerStatItemStyle}>
          Moves{" "}
          {diceResult !== null
            ? `${Math.max(0, (bonusAdded ?? diceResult) - movesLeft)}/${bonusAdded ?? diceResult}`
            : "—/—"}
        </span>
        <span style={headerStatDivider}>|</span>
        <span style={headerStatItemStyle}>
          R{(lab.round ?? 0) + 1}/{MAX_ROUNDS}
        </span>
        <span style={headerStatDivider}>|</span>
        <span style={headerStatItemStyle}>Tot {totalMoves}</span>
        {cp && !lab.eliminatedPlayers.has(currentPlayer) ? (
          <>
            <span style={headerStatDivider}>|</span>
            <span
              style={{
                ...headerStatItemStyle,
                color: playerHpAccentColor(cp.hp ?? DEFAULT_PLAYER_HP),
                fontWeight: 700,
              }}
              title="Health — Dracula and traps can reduce HP"
            >
              HP {cp.hp ?? DEFAULT_PLAYER_HP}/{DEFAULT_PLAYER_HP}
            </span>
          </>
        ) : null}
        <span style={headerStatDivider}>|</span>
        <span style={headerStatItemStyle}>
          {lab.players.map((p, i) => (
            <span
              key={i}
              style={{
                marginRight: 6,
                color: lab.eliminatedPlayers.has(i) ? "#666" : (PLAYER_COLORS[i] ?? "#888"),
                textDecoration: lab.eliminatedPlayers.has(i) ? "line-through" : undefined,
              }}
            >
              {playerNames[i] ?? `P${i + 1}`}
              <ArtifactIcon variant="diamond" size={12} style={{ marginLeft: 2, marginRight: 2, verticalAlign: "middle" }} />
              {p?.diamonds ?? 0}
            </span>
          ))}
        </span>
      </div>
    );

    return (
      <div
        style={{
          position: "fixed" as const,
          top: "max(8px, env(safe-area-inset-top, 0px))",
          left: useFsTopBarRow ? "max(12px, env(safe-area-inset-left, 0px))" : "max(10px, env(safe-area-inset-left, 0px))",
          right: useFsTopBarRow ? "max(12px, env(safe-area-inset-right, 0px))" : undefined,
          zIndex: PLAY_FULLSCREEN_ISLAND_Z,
          maxWidth: useFsTopBarRow
            ? undefined
            : "min(440px, calc(100vw - max(20px, env(safe-area-inset-left, 0px) + env(safe-area-inset-right, 0px))))",
          width: useFsTopBarRow ? "auto" : undefined,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            pointerEvents: "auto",
            display: "flex",
            flexDirection: useFsTopBarRow ? "row" : "column",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: useFsTopBarRow ? "space-between" : undefined,
            gap: 8,
            rowGap: 8,
            width: "100%",
            boxSizing: "border-box",
            padding: useFsTopBarRow ? "8px 12px" : "8px 10px",
            background: useFsTopBarRow
              ? isMobile
                ? "rgba(22, 22, 32, 0.72)"
                : "rgba(26, 26, 36, 0.92)"
              : isMobile
                ? "rgba(14,16,24,0.78)"
                : "rgba(14,16,24,0.94)",
            border: "1px solid rgba(80, 80, 96, 0.65)",
            borderRadius: useFsTopBarRow ? 8 : 10,
            boxShadow: "0 8px 28px rgba(0,0,0,0.45)",
          }}
        >
          {useFsTopBarRow ? (
            <>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: 10,
                  flex: 1,
                  minWidth: 0,
                }}
              >
                {desktopFsBar ? statsCluster : null}
                {desktopFsBar ? (
                  <span
                    style={{
                      width: 1,
                      height: 22,
                      background: "rgba(100,100,120,0.45)",
                      flexShrink: 0,
                      alignSelf: "center",
                    }}
                    aria-hidden
                  />
                ) : null}
                {zoomViewCluster}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, flexShrink: 0 }}>
                {landscapeFsBar && cp ? (
                  <span style={{ fontSize: "0.72rem", color: "#c4c4d4", whiteSpace: "nowrap" }}>
                    <span style={{ color: playerHpAccentColor(cp.hp ?? DEFAULT_PLAYER_HP), fontWeight: 700 }}>
                      HP {cp.hp ?? DEFAULT_PLAYER_HP}/{DEFAULT_PLAYER_HP}
                    </span>
                    <span style={{ margin: "0 6px", color: "#555" }}>·</span>
                    Moves {movesLeft}
                    <span style={{ margin: "0 6px", color: "#555" }}>·</span>
                    Jumps {cp.jumps ?? 0}
                  </span>
                ) : null}
                {renderHeaderMenuBlock()}
              </div>
            </>
          ) : (
            <>
              {statsCluster}
              {isMobile && cp && (
                <div style={{ fontSize: "0.62rem", color: "#9aa0b0", marginTop: -4 }}>
                  <span style={{ color: playerHpAccentColor(cp.hp ?? DEFAULT_PLAYER_HP), fontWeight: 700 }}>
                    HP {cp.hp ?? DEFAULT_PLAYER_HP}/{DEFAULT_PLAYER_HP}
                  </span>
                  {" · "}
                  Moves left {movesLeft} · Jumps {cp?.jumps ?? 0}
                </div>
              )}
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                {zoomViewCluster}
                {renderHeaderMenuBlock()}
              </div>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      className="labyrinth-game-pane"
      style={{
        ...gamePaneStyle,
        /* Fixed combat UI must not be clipped by overflow:hidden — otherwise taps miss (esp. landscape + fixed maze shell). */
        ...(combatOverlayVisible ? { overflow: "visible" as const } : {}),
      }}
    >
      {lab && mazeDraculaBiteBanner && !combatOverlayVisible && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            left: "50%",
            transform: "translateX(-50%)",
            top: "max(68px, calc(env(safe-area-inset-top, 0px) + 52px))",
            zIndex: 10075,
            maxWidth: "min(92vw, 420px)",
            pointerEvents: "none",
            padding: "10px 16px",
            borderRadius: 10,
            border: "1px solid rgba(255, 80, 80, 0.55)",
            background: "linear-gradient(165deg, rgba(38, 14, 18, 0.97) 0%, rgba(14, 8, 12, 0.98) 100%)",
            boxShadow: "0 12px 40px rgba(0,0,0,0.55), 0 0 24px rgba(180, 30, 40, 0.25)",
            color: "#f0d8dc",
            fontSize: "0.92rem",
            fontWeight: 700,
            textAlign: "center",
            lineHeight: 1.45,
          }}
        >
          {mazeDraculaBiteBanner.lethal ? (
            <>
              <span aria-hidden style={{ marginRight: 6 }}>
                🧛
              </span>
              Dracula struck you down — <span style={{ color: "#ff6666" }}>0</span>/{DEFAULT_PLAYER_HP} HP
            </>
          ) : (
            <>
              <span aria-hidden style={{ marginRight: 6 }}>
                🧛
              </span>
              Dracula bit you — <span style={{ color: "#ff8888" }}>−1 HP</span>
              <span style={{ display: "block", marginTop: 6, fontSize: "0.82rem", fontWeight: 600, color: "#c8b8bc" }}>
                Now at {mazeDraculaBiteBanner.hpAfter}/{DEFAULT_PLAYER_HP} HP
              </span>
            </>
          )}
        </div>
      )}
      {!landscapeCompactPlayHud &&
        !(isoImmersiveUi && isMobile) &&
        !(isoImmersiveUi && !isMobile && lab && !combatState && !teleportPicker && !pendingCombatOffer) && (
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
                  ...headerTitleWrapStyle,
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                }
              : headerTitleWrapStyle
          }
        >
          <img
            src={GAME_TITLE_LABEL_SRC}
            alt={GAME_DISPLAY_TITLE}
            width={1024}
            height={419}
            draggable={false}
            style={
              isMobile
                ? {
                    ...headerLogoImgStyle,
                    maxHeight: 36,
                    maxWidth: "min(100%, 220px)",
                  }
                : {
                    ...headerLogoImgStyle,
                    maxHeight: 44,
                    maxWidth: "min(100%, 280px)",
                  }
            }
          />
        </h1>
        {!isMobile && !isoImmersiveUi ? (
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
          {cp && !lab.eliminatedPlayers.has(currentPlayer) ? (
            <>
              <span style={headerStatDivider}>|</span>
              <span
                style={{
                  ...headerStatItemStyle,
                  color: playerHpAccentColor(cp.hp ?? DEFAULT_PLAYER_HP),
                  fontWeight: 700,
                }}
                title="Health — Dracula and traps can reduce HP"
              >
                HP {cp.hp ?? DEFAULT_PLAYER_HP}/{DEFAULT_PLAYER_HP}
              </span>
            </>
          ) : null}
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
        ) : null}
        {teleportPicker && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            <TeleportPickTimerBadge model={teleportPickTimerModel} />
          <button
              type="button"
              onClick={() => {
                manualTeleportPendingRef.current = false;
                setTeleportPicker(null);
              }}
            style={{ ...buttonStyle, ...headerButtonStyle, background: "#664400", border: "1px solid #aa66ff" }}
          >
            Cancel teleport
          </button>
          <button
              type="button"
              onClick={() => {
                const opts = teleportPicker.options;
                if (opts.length === 0) return;
                const pick = opts[Math.floor(Math.random() * opts.length)]!;
                handleTeleportSelect(pick[0], pick[1]);
              }}
              style={{ ...buttonStyle, ...headerButtonStyle, background: "#2a2048", border: "1px solid #8866cc", color: "#e8ddff" }}
              title={
                movesLeft <= 0
                  ? "Last move: tap a highlighted cell or pick random — no automatic teleport."
                  : `Pick a random valid destination now, or wait ${MAGIC_TELEPORT_PICK_IDLE_MS / 1000}s for an auto-pick among highlighted magic cells`
              }
            >
              Random destination
          </button>
          </div>
        )}
        {pendingCombatOffer &&
          lab &&
          !teleportPicker &&
          mazeMapView !== "grid" &&
          !showUnifiedDockInDesktopIso && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              alignItems: "center",
              padding: "6px 10px",
              borderRadius: 8,
              background: "linear-gradient(180deg, rgba(48,22,18,0.95) 0%, rgba(24,12,14,0.98) 100%)",
              border: "1px solid rgba(255,102,68,0.45)",
              boxShadow: "0 4px 18px rgba(0,0,0,0.35)",
            }}
          >
            <span style={{ fontSize: "0.78rem", color: "#e8d8d4", maxWidth: 280, lineHeight: 1.35 }}>
              {pendingCombatOffer.source === "player" ? (
                <>
                  You entered <strong style={{ color: "#ffaa88" }}>{getMonsterName(pendingCombatOffer.monsterType)}</strong>’s tile.
                </>
              ) : (
                <>
                  <strong style={{ color: "#ffaa88" }}>{getMonsterName(pendingCombatOffer.monsterType)}</strong> caught you.
                </>
              )}{" "}
              Start combat?
            </span>
            <button type="button" onClick={acceptPendingCombat} style={{ ...buttonStyle, ...headerButtonStyle, background: "#6b1010", border: "1px solid #ff4444" }}>
              Fight
            </button>
            {(pendingCombatOffer.source === "player" ||
              monsterHasAdjacentEscapeCell(lab, pendingCombatOffer.monsterIndex)) && (
              <button
                type="button"
                onClick={declinePendingCombat}
                style={{ ...buttonStyle, ...headerButtonStyle, background: "#2a2830", border: "1px solid #666", color: "#ccc" }}
              >
                {pendingCombatOffer.source === "player" ? "Step back" : "It slips away"}
              </button>
            )}
          </div>
        )}
        {renderHeaderMenuBlock()}
      </header>
      )}

      {landscapeCompactPlayHud &&
        ((!isoImmersiveUi && !(mobileIsoEdgeToEdge && isLandscapeCompact)) ||
          teleportPicker ||
          (pendingCombatOffer && lab)) && (
        <div
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            top: 0,
            paddingTop: "max(4px, env(safe-area-inset-top, 0px))",
            paddingLeft: "max(8px, env(safe-area-inset-left, 0px))",
            paddingRight: "max(8px, env(safe-area-inset-right, 0px))",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "flex-start",
            justifyContent: "flex-end",
            gap: 8,
            pointerEvents: "none",
            zIndex: isoImmersiveUi ? ISO_IMMERSIVE_HUD_Z + 60 : HEADER_Z_INDEX + 25,
          }}
        >
          {teleportPicker && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                alignItems: "center",
                pointerEvents: "auto",
                marginRight: "auto",
              }}
            >
              <TeleportPickTimerBadge model={teleportPickTimerModel} compact />
              <button
                type="button"
                onClick={() => {
                  manualTeleportPendingRef.current = false;
                  setTeleportPicker(null);
                }}
                style={{ ...buttonStyle, ...headerButtonStyle, background: "#664400", border: "1px solid #aa66ff" }}
              >
                Cancel teleport
              </button>
              <button
                type="button"
                onClick={() => {
                  const opts = teleportPicker.options;
                  if (opts.length === 0) return;
                  const pick = opts[Math.floor(Math.random() * opts.length)]!;
                  handleTeleportSelect(pick[0], pick[1]);
                }}
                style={{ ...buttonStyle, ...headerButtonStyle, background: "#2a2048", border: "1px solid #8866cc", color: "#e8ddff" }}
                title={
                  movesLeft <= 0
                    ? "Last move: tap a highlighted cell or pick random — no automatic teleport."
                    : `Pick a random valid destination now, or wait ${MAGIC_TELEPORT_PICK_IDLE_MS / 1000}s for an auto-pick among highlighted magic cells`
                }
              >
                Random destination
              </button>
            </div>
          )}
          {pendingCombatOffer &&
            lab &&
            !teleportPicker &&
            !isoImmersiveUi && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                alignItems: "center",
                pointerEvents: "auto",
                marginRight: "auto",
                padding: "6px 10px",
                borderRadius: 8,
                background: "linear-gradient(180deg, rgba(48,22,18,0.95) 0%, rgba(24,12,14,0.98) 100%)",
                border: "1px solid rgba(255,102,68,0.45)",
                maxWidth: "min(100%, 360px)",
              }}
            >
              <span style={{ fontSize: "0.72rem", color: "#e8d8d4", lineHeight: 1.35 }}>
                {pendingCombatOffer.source === "player" ? "Monster tile — " : "Ambush — "}
                <strong style={{ color: "#ffaa88" }}>{getMonsterName(pendingCombatOffer.monsterType)}</strong>
                . Fight?
              </span>
              <button type="button" onClick={acceptPendingCombat} style={{ ...buttonStyle, fontSize: "0.72rem", padding: "6px 10px", background: "#6b1010", border: "1px solid #ff4444" }}>
                Fight
              </button>
              {(pendingCombatOffer.source === "player" ||
                monsterHasAdjacentEscapeCell(lab, pendingCombatOffer.monsterIndex)) && (
                <button
                  type="button"
                  onClick={declinePendingCombat}
                  style={{ ...buttonStyle, fontSize: "0.72rem", padding: "6px 10px", background: "#2a2830", border: "1px solid #666", color: "#ccc" }}
                >
                  {pendingCombatOffer.source === "player" ? "Step back" : "It slips away"}
                </button>
              )}
            </div>
          )}
          {!isoImmersiveUi && !(mobileIsoEdgeToEdge && isLandscapeCompact) ? (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 8,
                pointerEvents: "auto",
                width: "100%",
                justifyContent:
                  mobileLandscapeGridChromeInFixedHud || !isMobile ? "space-between" : "flex-end",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                {mobileLandscapeGridChromeInFixedHud ? (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <button
                        type="button"
                        onClick={() => setMazeZoom((z) => Math.max(MAZE_ZOOM_MIN, z - MAZE_ZOOM_STEP))}
                        style={mazeZoomButtonStyle}
                        title="Zoom out"
                      >
                        −
                      </button>
                      <span
                        style={{ fontSize: "0.8rem", color: "#888", minWidth: 36, textAlign: "center" }}
                      >
                        {Math.round((mazeZoom / MAZE_ZOOM_BASELINE) * 100)}%
                      </span>
                      <button
                        type="button"
                        onClick={() => setMazeZoom((z) => Math.min(MAZE_ZOOM_MAX, z + MAZE_ZOOM_STEP))}
                        style={mazeZoomButtonStyle}
                        title="Zoom in"
                      >
                        +
                      </button>
                    </div>
                    {cp ? (
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
                    ) : null}
                  </>
                ) : null}
                {!isMobile ? (
                  <button
                    type="button"
                    onClick={() => void enterPlayFullscreen()}
                    style={{
                      ...mazeViewToggleButtonStyle(false),
                      minWidth: 40,
                      padding: "0 8px",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                    title="Enter full-screen play"
                    aria-label="Enter full-screen play"
                  >
                    <FullscreenEnterIcon />
                  </button>
                ) : null}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => setMazeMapView("grid")}
                  style={mazeViewToggleButtonStyle(mazeMapView === "grid")}
                  title="Top-down 2D map"
                  aria-pressed={mazeMapView === "grid"}
                >
                  2D
                </button>
                <button
                  type="button"
                  onClick={onIsoViewButtonClick}
                  style={mazeViewToggleButtonStyle(mazeMapView === "iso")}
                  title="3D — full screen where supported"
                  aria-pressed={mazeMapView === "iso"}
                >
                  3D
                </button>
                {renderHeaderMenuBlock()}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {(isMobile || isoImmersiveUi) && headerMenuOpen && (
        <div
          role="presentation"
          aria-hidden
          onClick={() => setHeaderMenuOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: isoImmersiveUi ? ISO_IMMERSIVE_HUD_Z + 58 : HEADER_Z_INDEX - 1,
            background: "rgba(0,0,0,0.45)",
          }}
        />
      )}

      <div
        style={{
          flex: 1,
          display: "flex",
          minHeight: 0,
          overflow: combatOverlayVisible ? "visible" : "hidden",
        }}
      >
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

        <div
          style={{
            ...mainContentStyle,
            ...(combatOverlayVisible ? { overflow: "visible" as const } : {}),
          }}
        >
      {lab && combatOverlayVisible && (
        <FullscreenPortal target={fsPortalTarget}>
        <div
            style={{
            ...combatModalOverlayStyle,
            ...(combatActiveFitViewport
              ? {
                  alignItems: "stretch" as const,
                  justifyContent: isMobile && !isLandscapeCompact ? ("flex-start" as const) : ("center" as const),
                  overflowY: "hidden",
                  WebkitOverflowScrolling: "touch" as const,
                }
              : isLandscapeCompact && !isMobile
              ? { alignItems: "stretch", justifyContent: "center" as const }
                : isMobile
                  ? {
                      alignItems: "stretch" as const,
                      justifyContent: isLandscapeCompact ? ("center" as const) : ("flex-start" as const),
                      overflowY: "auto",
                      WebkitOverflowScrolling: "touch" as const,
                    }
              : {}),
            ...(isMobile
              ? { paddingTop: "max(12px, env(safe-area-inset-top, 0px))" }
              : { paddingTop: "max(8px, env(safe-area-inset-top, 0px))" }),
          }}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
        <div
          style={{
              ...combatModalStyle,
              position: "relative",
              alignSelf:
                isLandscapeCompact || isMobile
                  ? "stretch"
                  : combatActiveFitViewport
                    ? "center"
                    : undefined,
              maxHeight: combatActiveFitViewport && !isLandscapeCompact
                ? isMobile
                  ? "calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 24px)"
                  : "calc(100dvh - 24px)"
                : isLandscapeCompact
                ? "calc(100dvh - max(16px, env(safe-area-inset-top, 0px) + env(safe-area-inset-bottom, 0px)))"
                  : isMobile
                    ? "calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 24px)"
                : "calc(100dvh - 16px)",
              height: combatActiveFitViewport && !isLandscapeCompact
                ? isMobile
                  ? "calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 24px)"
                  : "calc(100dvh - 24px)"
                : isLandscapeCompact
                ? "calc(100dvh - max(16px, env(safe-area-inset-top, 0px) + env(safe-area-inset-bottom, 0px)))"
                  : isMobile
                    ? "calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 24px)"
                : undefined,
              minHeight: 0,
              overflowY: combatActiveFitViewport ? "hidden" : "auto",
              WebkitOverflowScrolling: "touch",
              ...(isMobile && !isLandscapeCompact
                ? {
                    width: "100%",
                    maxWidth: "min(100vw - 8px, calc(100dvw - 8px))",
                    padding: "0.28rem 0.35rem 0.3rem",
                    boxSizing: "border-box" as const,
                  }
                : {}),
              ...(isLandscapeCompact
                ? {
                    width: `min(${COMBAT_MODAL_WIDTH_LANDSCAPE_PX}px, calc(100vw - 16px))`,
                    minHeight: 0,
                    ...(isMobile
                      ? {
                          paddingBottom: "max(14px, calc(0.35rem + env(safe-area-inset-bottom, 0px)))",
                          boxSizing: "border-box" as const,
                        }
                      : {}),
                  }
                : {}),
              ...(combatActiveFitViewport && !isMobile && !isLandscapeCompact
                ? {
                    width: "min(960px, calc(100vw - 24px))",
                    maxWidth: "min(960px, calc(100vw - 24px))",
                    boxSizing: "border-box" as const,
                  }
                : {}),
          }}
          onClick={(e) => e.stopPropagation()}
        >
            {isLandscapeCompact && combatToast ? (
              <div
                className="combat-toast-popover"
                role="alert"
                aria-live="polite"
                style={{
                  position: "absolute",
                  top: "max(4px, env(safe-area-inset-top, 0px))",
                  left: "50%",
                  transform: "translateX(-50%)",
                  zIndex: 150,
                  width: "min(560px, calc(100% - 20px))",
                  maxWidth: "94%",
                  boxSizing: "border-box",
                  padding: "8px 12px",
                  borderRadius: 12,
                  border: "2px solid rgba(255, 200, 80, 0.55)",
                  background: "linear-gradient(180deg, rgba(48, 44, 32, 0.98) 0%, rgba(18, 16, 14, 0.99) 100%)",
                  boxShadow:
                    "0 10px 32px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.08)",
                  color: "#f5e8cc",
                  fontSize: "0.72rem",
                  fontWeight: 600,
                  textAlign: "center",
                  lineHeight: 1.35,
                  pointerEvents: "none",
                }}
              >
                {combatToast.message}
              </div>
            ) : null}
            {isLandscapeCompact && combatFooterSnapshot && !rolling && !combatToast ? (
              <div
                className="combat-toast-popover"
                role="alert"
                aria-live="polite"
                style={{
                  position: "absolute",
                  top: "max(4px, env(safe-area-inset-top, 0px))",
                  left: "50%",
                  transform: "translateX(-50%)",
                  zIndex: 149,
                  width: "min(560px, calc(100% - 20px))",
                  maxWidth: "94%",
                  maxHeight: "min(36dvh, 220px)",
                  overflowY: "auto",
                  WebkitOverflowScrolling: "touch",
                  boxSizing: "border-box",
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "2px solid rgba(255, 200, 80, 0.55)",
                  background: "linear-gradient(180deg, rgba(48, 44, 32, 0.98) 0%, rgba(18, 16, 14, 0.99) 100%)",
                  boxShadow:
                    "0 10px 32px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.08)",
                  color: "#f5e8cc",
                  fontSize: "0.72rem",
                  fontWeight: 600,
                  textAlign: "center",
                  lineHeight: 1.4,
                  pointerEvents: "none",
                }}
              >
                {combatFooterSnapshot.summary}
              </div>
            ) : null}
            {combatMonsterHintFullText &&
            !combatToast &&
            combatMonsterHintOpen ? (
              <div
                className="combat-toast-popover"
                role="dialog"
                aria-modal="true"
                aria-labelledby="combat-monster-hint-title"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                style={{
                  position: "absolute",
                  top: "max(6px, env(safe-area-inset-top, 0px))",
                  left: "50%",
                  transform: "translateX(-50%)",
                  zIndex: 148,
                  width: "min(560px, calc(100% - 20px))",
                  maxWidth: "94%",
                  maxHeight: "min(72dvh, 440px)",
                  boxSizing: "border-box",
                  display: "flex",
                  flexDirection: "column",
                  padding: 0,
                  borderRadius: 12,
                  border: "2px solid rgba(255, 200, 80, 0.55)",
                  background: "linear-gradient(180deg, rgba(36, 34, 28, 0.99) 0%, rgba(14, 13, 12, 0.99) 100%)",
                  boxShadow:
                    "0 12px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.06)",
                  overflow: "hidden",
                  pointerEvents: "auto",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    padding: "8px 10px 6px",
                    borderBottom: "1px solid rgba(255, 200, 80, 0.22)",
                    flexShrink: 0,
                  }}
                >
                  <span
                    id="combat-monster-hint-title"
                    style={{
                      fontSize: "0.75rem",
                      fontWeight: 800,
                      color: "#ffe8aa",
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                    }}
                  >
                    {combatState ? getMonsterName(combatState.monsterType) : "Combat"} · Info
                  </span>
                  <button
                    type="button"
                    aria-label="Close combat info"
                    onClick={() => setCombatMonsterHintOpen(false)}
                    style={{
                      ...buttonStyle,
                      flexShrink: 0,
                      width: 32,
                      height: 32,
                      padding: 0,
                      fontSize: "1.1rem",
                      lineHeight: 1,
                      borderRadius: 8,
                      background: "rgba(255,255,255,0.08)",
                      border: "1px solid rgba(255,200,100,0.35)",
                      color: "#eeccaa",
                    }}
                  >
                    ×
                  </button>
                </div>
                <div
                  style={{
                    padding: "10px 12px 8px",
                    overflowY: "auto",
                    WebkitOverflowScrolling: "touch",
                    flex: 1,
                    minHeight: 0,
                    color: "#f5e8cc",
                    fontSize: "0.72rem",
                    fontWeight: 500,
                    lineHeight: 1.45,
                    textAlign: "left",
                  }}
                >
                  {landscapeCombatInfoRows && landscapeCombatInfoRows.length > 0 ? (
                    <dl
                      style={{
                        margin: "0 0 12px 0",
                        display: "grid",
                        gridTemplateColumns: "auto 1fr",
                        gap: "6px 12px",
                        alignItems: "baseline",
                        fontSize: "0.68rem",
                      }}
                    >
                      {landscapeCombatInfoRows.map((row) => (
                        <Fragment key={row.label}>
                          <dt style={{ color: "#c4b8a0", fontWeight: 700, margin: 0 }}>{row.label}</dt>
                          <dd style={{ margin: 0, color: "#f0e6d8", fontWeight: 600 }}>{row.value}</dd>
                        </Fragment>
                      ))}
                    </dl>
                  ) : null}
                  <div
                    style={{
                      paddingTop: landscapeCombatInfoRows?.length ? 8 : 0,
                      borderTop: landscapeCombatInfoRows?.length ? "1px solid rgba(255, 200, 80, 0.15)" : undefined,
                      fontSize: "0.7rem",
                      lineHeight: 1.45,
                    }}
                  >
                    {combatMonsterHintFullText}
                  </div>
                </div>
                <div style={{ padding: "8px 10px 10px", flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={() => setCombatMonsterHintOpen(false)}
                    style={{
                      ...buttonStyle,
                      width: "100%",
                      padding: "8px 10px",
                      fontSize: "0.72rem",
                      fontWeight: 700,
                      borderRadius: COMBAT_ROLL_UI_RADIUS_PX,
                      background: "linear-gradient(180deg, rgba(80, 70, 40, 0.95) 0%, rgba(40, 36, 24, 0.98) 100%)",
                      border: "2px solid rgba(255, 200, 80, 0.45)",
                      color: "#ffe8bb",
                    }}
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : null}
            {(() => {
              /** Prefer lab (React state) for monster HP — ensures post-roll updates (e.g. glancing damage) show correctly in the same render. */
              const labForCombatFaceoff = lab ?? labRef.current;
              const headerPi = combatState?.playerIndex ?? combatResult?.playerIndex ?? 0;
              const headerMt = combatState?.monsterType ?? combatResult?.monsterType;
              const headerMonsterName = headerMt ? getMonsterName(headerMt) : "Monster";
              /**
               * Strike tier for merged 3D: footer segment when present; else same dice→tier fallback as
               * `playerAttackVariant` when the portrait is a player win (footer often omits `draculaAttackSegment`
               * there — monster clips defaulted to “skill” while the player used spell/light from the die).
               */
              const combatDraculaStrikeSegment =
                combatFooterSnapshot?.draculaAttackSegment ??
                (() => {
                  const sp = combatFooterSnapshot?.strikePortrait;
                  const pr = combatFooterSnapshot?.playerRoll;
                  if ((sp === "playerHit" || sp === "playerHitHeavy") && pr != null) {
                    return playerStrikeVariantFromDice(pr);
                  }
                  return undefined;
                })() ??
                combatResult?.finishingStrikeSegment;
              /** Live fight: use maze stances. Post-fight / loss banner only: hurt/defeated from result. */
              const headerSurpriseVisible =
                !!combatState && !combatResult && combatHasRolledRef.current;
              const inActiveFight = !!combatState;
              /** Between rolls: calm idle (full HP) or recover (wounded). Surprise stance only drives rolling pose + combat math — not the static portrait between strikes. */
              const headerMonsterCombatState: MonsterSpriteState = (() => {
                if (inActiveFight && headerMt) {
                  if (rolling) {
                    if (
                      (headerMt === "V" ||
                        headerMt === "K" ||
                        headerMt === "Z" ||
                        headerMt === "G" ||
                        headerMt === "S" ||
                        headerMt === "L" ||
                        headerMt === "O") &&
                      isMonster3DEnabled()
                    ) {
                      return "rolling";
                    }
                    return getMonsterSpriteWhileRolling(headerMt, combatMonsterStance);
                  }
                  const sp = combatFooterSnapshot?.strikePortrait;
                  if (!combatResult && combatRecoveryPhase !== "ready" && sp && sp !== "other") {
                    if (combatRecoveryPhase === "hurt") {
                      if (sp === "defeated") return "defeated";
                      if (sp === "playerHitHeavy") return "knockdown";
                      /** Merged Meshy: spell/skill player wins use full crumple (`knockdown`), not only standing `hurt` — matches heavy tier + M-row spell feel (Jumping Punch is `skill` in dice but should fall like spell). */
                      if (
                        sp === "playerHit" &&
                        (headerMt === "V" ||
                          headerMt === "K" ||
                          headerMt === "Z" ||
                          headerMt === "G" ||
                          headerMt === "S" ||
                          headerMt === "L" ||
                          headerMt === "O") &&
                        isMonster3DEnabled() &&
                        (combatDraculaStrikeSegment === "spell" || combatDraculaStrikeSegment === "skill")
                      ) {
                        return "knockdown";
                      }
                      if (sp === "playerHit") return "hurt";
                      if (sp === "monsterHit") return "attack";
                      if (sp === "shield") return "angry";
                    }
                    if (combatRecoveryPhase === "recover") {
                      if (sp === "defeated") return "defeated";
                      if (sp === "playerHitHeavy") return "recover";
                      if (sp === "playerHit") return "recover";
                      if (sp === "monsterHit") return "idle";
                      if (sp === "shield") return "idle";
                    }
                  }
                  if (combatState && labForCombatFaceoff) {
                    const maxHp = getMonsterMaxHp(combatState.monsterType);
                    const cur = combatStrikeLabPending
                      ? combatStrikeHpHold!.monsterHp
                      : combatFooterSnapshot?.monsterHp != null && combatFooterSnapshot?.monsterMaxHp != null
                        ? combatFooterSnapshot.monsterHp
                        : (() => {
                            const m = labForCombatFaceoff.monsters[combatState.monsterIndex];
                            return m ? (m.hp ?? maxHp) : maxHp;
                          })();
                    const calmMax = combatStrikeLabPending
                      ? combatStrikeHpHold!.monsterMaxHp
                      : (combatFooterSnapshot?.monsterMaxHp ?? maxHp);
                    if (combatFooterSnapshot?.strikePortrait === "defeated" || cur <= 0) return "defeated";
                    return monsterCalmPortraitFromHp(cur, calmMax);
                  }
                  return combatMonsterStance;
                }
                if (combatResult?.monsterType) {
                  return getCombatResultMonsterSpriteState(combatResult, combatVictoryPhase, combatResult.monsterType);
                }
                return "neutral";
              })();
              const headerMonsterSprite =
                headerMt &&
                (getMonsterSprite(headerMt, headerMonsterCombatState) ?? getMonsterIdleSprite(headerMt));
              const combat3dFallbackImgSrc =
                headerMt != null
                  ? getMonsterSprite(headerMt, headerMonsterCombatState) ??
                    getMonsterIdleSprite(headerMt) ??
                    COMBAT_3D_FALLBACK_TRANSPARENT_PX
                  : COMBAT_3D_FALLBACK_TRANSPARENT_PX;

              /**
               * Merged 3D must follow `headerMonsterCombatState` between rolls (usually `hunt` from surprise stance).
               * Forcing `idle` here made the player/monster snap from static idle into hurt/attack with no hunt→strike
               * crossfade — reads as “frozen until hit”. 2D header sprites still use the same `headerMonsterCombatState`.
               */
              const gltfVisualStateBase: MonsterSpriteState = headerMonsterCombatState;
              const gltfVisualState: MonsterSpriteState =
                inActiveFight &&
                isMonster3DEnabled() &&
                (headerMt === "G" || headerMt === "L" || headerMt === "O") &&
                (gltfVisualStateBase === "hunt" || gltfVisualStateBase === "neutral")
                  ? "idle"
                  : gltfVisualStateBase;
              const monsterGltfPath =
                headerMt && isMonster3DEnabled()
                  ? getMonsterGltfPath(headerMt, gltfVisualState, {
                      draculaAttackVariant: combatDraculaStrikeSegment,
                    })
                  : null;
              /** Same player index as `combatPlayerGlb` / portraits — must stay defined after `setCombatState(null)` while `combatResult` (e.g. bonus loot) keeps the modal open. */
              const combatWeaponPath = (() => {
                const a = playerWeaponGlb[headerPi];
                return a && a !== NO_ARMOUR_SENTINEL ? a : null;
              })();
                const combatOffhandArmourPath = playerOffhandArmourGltfEffective(
                labForCombatFaceoff?.players[headerPi],
                playerOffhandArmourGlb[headerPi]
              );
              const combatPlayerGlb = getPlayer3DGlb(playerAvatars[headerPi]);

              const playerGltfVisualState: MonsterSpriteState = (() => {
                if (combatResult?.playerDefeated && !combatState) return "defeated";
                switch (gltfVisualState) {
                  case "attack": return "hurt";
                  case "angry": return "knockdown";
                  case "hurt": return "attack";
                  /**
                   * Heavy (`playerHitHeavy`): monster down + player `angry` reads as dominance. Net spell/skill wins
                   * use merged `knockdown` on the monster but must keep player `attack` so Jumping_Punch / spell contact
                   * still reads against the falling rig — not `angry` (wrong pose + mirrored-heavy spacing).
                   */
                  case "knockdown": {
                    const merge3dKnockdownPlayerAttack =
                      (headerMt === "V" ||
                        headerMt === "K" ||
                        headerMt === "Z" ||
                        headerMt === "G" ||
                        headerMt === "S" ||
                        headerMt === "L" ||
                        headerMt === "O") &&
                      isMonster3DEnabled() &&
                      inActiveFight &&
                      combatRecoveryPhase === "hurt" &&
                      combatFooterSnapshot?.strikePortrait === "playerHit" &&
                      (combatDraculaStrikeSegment === "spell" || combatDraculaStrikeSegment === "skill");
                    return merge3dKnockdownPlayerAttack ? "attack" : "angry";
                  }
                  /** Monster hunt between rolls — player uses hunt locomotion too so the strike can cross-fade from crouch/walk, not from a hard idle cut. */
                  case "hunt": return "hunt";
                  /**
                   * Lethal strike: monster plays defeat / fall during `combatRecoveryPhase === "hurt"`.
                   * Player must show the finisher (attack) in that same beat — not idle “watching” the fall.
                   * After the clip finishes we jump to `ready` (see `handleCombatRecoveryClipFinished`); then idle is correct.
                   */
                  case "defeated":
                    return combatRecoveryPhase === "hurt" ? "attack" : "idle";
                  case "recover": return "idle";
                  case "rolling": return "rolling";
                  default: return "idle";
                }
              })();
              const playerAttackVariant: "spell" | "skill" | "light" | undefined = (() => {
                const st = playerGltfVisualState as string;
                if (
                  st === "idle" ||
                  st === "hunt" ||
                  st === "rolling" ||
                  st === "recover" ||
                  st === "neutral" ||
                  st === "defeated"
                ) {
                  return undefined;
                }
                const seg = combatFooterSnapshot?.draculaAttackSegment;
                if (seg === "spell") return "spell";
                if (seg === "skill") return "skill";
                if (seg === "light") return "light";
                const sp = combatFooterSnapshot?.strikePortrait;
                const pr = combatFooterSnapshot?.playerRoll;
                if ((sp === "playerHit" || sp === "playerHitHeavy") && pr != null) {
                  return playerStrikeVariantFromDice(pr);
                }
                return "light";
              })();
              /**
               * `meshyPlayerAttackLeadInSec` must use the same resolved tier as `combatDraculaStrikeSegment`
               * (footer + dice merge). `playerAttackVariant` alone can disagree for a frame or omit segment,
               * which zeroed or light-tier lead-in while the clip was spell/skill.
               */
              const playerAttackVariantForClipLeads: "spell" | "skill" | "light" | undefined =
                playerGltfVisualState === "attack" &&
                (combatDraculaStrikeSegment === "spell" ||
                  combatDraculaStrikeSegment === "skill" ||
                  combatDraculaStrikeSegment === "light")
                  ? combatDraculaStrikeSegment
                  : playerAttackVariant;
              const playerFatalJumpKill3d =
                !!combatFooterSnapshot?.playerFatalJumpKill && playerGltfVisualState === "hurt";
              const isDracula3dCombatPortrait =
                !!monsterGltfPath &&
                (headerMt === "V" ||
                  headerMt === "K" ||
                  headerMt === "Z" ||
                  headerMt === "G" ||
                  headerMt === "S" ||
                  headerMt === "L" ||
                  headerMt === "O");
              /** Player `skill` win uses `knockdown` pose but clip priority would prefer forward fall; treat as `spell` so backward shot-fall matches M spell strike. */
              const monsterDraculaVariantForCombat3d =
                isDracula3dCombatPortrait &&
                isMonster3DEnabled() &&
                gltfVisualState === "knockdown" &&
                inActiveFight &&
                combatRecoveryPhase === "hurt" &&
                combatFooterSnapshot?.strikePortrait === "playerHit" &&
                combatDraculaStrikeSegment === "skill"
                  ? ("spell" as const)
                  : combatDraculaStrikeSegment;
              const combat3dClipLeads = resolveCombat3dClipLeads({
                isMergedMeshy: isDracula3dCombatPortrait,
                monsterType: headerMt,
                playerVisualState: playerGltfVisualState,
                monsterVisualState: gltfVisualState,
                draculaAttackVariant: monsterDraculaVariantForCombat3d,
                playerAttackVariant: playerAttackVariantForClipLeads,
                playerFatalJumpKill: playerFatalJumpKill3d,
                rollingApproachBlend: combat3dApproachBlend,
              });
              const playerAttackClipLeadInSecFor3d = combat3dClipLeads.meshyPlayerAttackLeadInSec;
              /** Per-tier hunt→attack overlap — `PLAYER_HUNT_TO_ATTACK_CROSSFADE_SEC_BY_TIER` via `resolveCombat3dClipLeads`. */
              const playerLocomotionToAttackCrossfadeSecFor3d =
                isDracula3dCombatPortrait ? combat3dClipLeads.meshyPlayerHuntToAttackCrossfadeSec : undefined;
              const monsterLocomotionToAttackCrossfadeSecFor3d =
                isDracula3dCombatPortrait ? combat3dClipLeads.meshyMonsterHuntToAttackCrossfadeSec : undefined;
              const monsterHurtClipStartTimeSecFor3d = combat3dClipLeads.meshyMonsterHurtLeadInSec;
              const playerHurtClipStartTimeSecFor3d = combat3dClipLeads.meshyPlayerHurtLeadInSec;
              const playerHurtHandoffCrossfadeSecFor3d = combat3dClipLeads.meshyPlayerHurtHandoffCrossfadeSec;
              const draculaHurtStrikeZoneFor3d: StrikeTarget | undefined =
                isDracula3dCombatPortrait &&
                (gltfVisualState === "hurt" || gltfVisualState === "recover") &&
                (combatFooterSnapshot?.strikePortrait === "playerHit" ||
                  combatFooterSnapshot?.strikePortrait === "playerHitHeavy") &&
                combatFooterSnapshot?.strikeTargetPick != null
                  ? combatFooterSnapshot.strikeTargetPick
                  : undefined;
              const playerHurtAnimContextFor3d: { hpLost: number; strikeZone?: StrikeTarget } | undefined =
                isDracula3dCombatPortrait &&
                playerGltfVisualState === "hurt" &&
                combatFooterSnapshot?.playerHpLost != null &&
                combatFooterSnapshot.playerHpLost > 0
                  ? {
                      hpLost: combatFooterSnapshot.playerHpLost,
                      ...(combatFooterSnapshot.strikeTargetPick != null
                        ? { strikeZone: combatFooterSnapshot.strikeTargetPick }
                        : {}),
                    }
                  : undefined;
              /** Same dice face as `resolveCombat3dClipLeads` / lab — varies merged player `attack` clip try-order. */
              const playerAttackClipCycleIndexFor3d =
                combatFooterSnapshot?.playerRoll ?? lastCombatStrikeDiceFace ?? 0;
              const draculaAttackLikePortrait =
                !isDracula3dCombatPortrait &&
                headerMt === "V" &&
                (headerMonsterCombatState === "attack" ||
                  headerMonsterCombatState === "rolling" ||
                  headerMonsterCombatState === "knockdown");
              const draculaLossMenaceLoop3d =
                headerMt === "V" &&
                isMonster3DEnabled() &&
                !!combatResult &&
                combatResult.won === false &&
                !combatState &&
                !combatResult.shieldAbsorbed &&
                !combatResult.draculaWeakened &&
                !combatResult.monsterWeakened;
              const combat3dOneShotFinished =
                isMonster3DEnabled() &&
                !!monsterGltfPath &&
                !!headerMt &&
                !!combatFooterSnapshot &&
                !!combatState &&
                combatRecoveryPhase !== "ready" &&
                getMonsterGltfPath(combatState.monsterType, "idle") != null
                  ? handleCombatRecoveryClipFinished
                  : undefined;
              const combat3dInstanceKey =
                combatState != null && headerMt != null
                  ? `c3d-${combatState.sessionId}-${combatState.monsterIndex}-${headerMt}-${headerPi}`
                  : headerMt != null
                    ? `c3d-post-${headerPi}-${headerMt}`
                    : "c3d";
              let monsterMaxHp = 1;
              let monsterCurHp = 1;
              if (headerMt) {
                if (inActiveFight && labForCombatFaceoff && combatState && !combatResult) {
                  if (combatFooterSnapshot?.monsterHp != null && combatFooterSnapshot?.monsterMaxHp != null) {
                    monsterCurHp = combatFooterSnapshot.monsterHp;
                    monsterMaxHp = combatFooterSnapshot.monsterMaxHp;
                  } else {
                    monsterMaxHp = Math.max(1, getMonsterMaxHp(combatState.monsterType));
                    const monster = labForCombatFaceoff.monsters[combatState.monsterIndex];
                    monsterCurHp = Math.min(monsterMaxHp, Math.max(0, monster?.hp ?? monsterMaxHp));
                  }
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
                  : labForCombatFaceoff && !labForCombatFaceoff.eliminatedPlayers.has(headerPi)
                    ? (labForCombatFaceoff.players[headerPi]?.hp ?? DEFAULT_PLAYER_HP)
                    : null;
              const pMax = DEFAULT_PLAYER_HP;
              const pPct = pHp != null ? pHp / pMax : 1;
              const pFill = pHp != null ? (pPct >= 0.66 ? "linear-gradient(90deg, #22cc44, #44ff66)" : pPct >= 0.33 ? "linear-gradient(90deg, #ffaa00, #ffcc44)" : "linear-gradient(90deg, #ff4444, #ff6666)") : "#666";
              const pGlow = pHp != null ? (pPct >= 0.66 ? "rgba(68,255,102,0.33)" : pPct >= 0.33 ? "rgba(255,170,0,0.33)" : "rgba(255,68,68,0.33)") : "rgba(102,102,102,0.33)";
              const monsterRollScaryGlow =
                !!combatState && rolling && !!headerMt && !combatResult && (combatMonsterStance === "angry" || combatMonsterStance === "attack");
              const showCombatHintText =
                !!combatToast || (!rolling && !!(combatFooterSnapshot || lab));
              /** Inline ℹ between HP bars (not absolutely positioned). */
              const combatInfoTriggerEl =
                combatMonsterHintFullText &&
                !combatMonsterHintOpen &&
                combatState &&
                !combatResult &&
                !combatToast ? (
                  <button
                    type="button"
                    aria-label="Open combat info"
                    title="Combat info"
                    onClick={(e) => {
                      e.stopPropagation();
                      setCombatMonsterHintOpen(true);
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    style={{
                      width: 36,
                      height: 36,
                      padding: 0,
                      margin: 0,
                      borderRadius: "50%",
                      border: "2px solid rgba(255, 204, 0, 0.5)",
                      background: "linear-gradient(160deg, rgba(48, 44, 36, 0.98) 0%, rgba(22, 20, 18, 0.99) 100%)",
                      color: "#f0e6d0",
                      boxShadow: "0 4px 14px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.08)",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      lineHeight: 1,
                      flexShrink: 0,
                      boxSizing: "border-box",
                    }}
                  >
                    <span aria-hidden style={{ fontSize: "0.98rem", fontWeight: 700, lineHeight: 1 }}>
                      ℹ
                    </span>
                  </button>
                ) : null;
              /** After combat loss (any monster): skull in the player slot instead of emoji avatar. */
              const showCombatDefeatSkull = !!combatResult?.playerDefeated && !combatState;
              /** Mobile column is narrow: bias framing left so wide sprites (e.g. Dracula) read centered in the modal. */
              const combatMonsterImgObjectPosition = isMobile ? "left center" : "center bottom";
              const versusRowSpritePx = isLandscapeCompact ? COMBAT_LANDSCAPE_SPRITE_PX : COMBAT_FACEOFF_SPRITE_PX;
              const mobilePortraitCombat = isMobile && !isLandscapeCompact;
              const landscapeFaceoffDiceViewportH = mobileCompactActiveCombat
                ? isLandscapeCompact
                  ? 92
                  : 104
                : COMBAT_LANDSCAPE_CENTER_DICE_MAX_H;
              const combatPortraitCellMinH = showCombatLandscapeVersus
                ? isDracula3dCombatPortrait
                  ? Math.max(versusRowSpritePx + 80, 280)
                  : versusRowSpritePx
                : isDracula3dCombatPortrait
                  ? mobilePortraitCombat
                    ? Math.min(248, 240)
                    : Math.max(360, 340)
                  : 220;
              const hide3dPlayerColumn = !!monsterGltfPath;
              const combatVersusGridStyleEffective: React.CSSProperties = {
                ...combatModalVersusGridStyle,
                ...(hide3dPlayerColumn
                  ? { gridTemplateColumns: "0px 0px minmax(0, 1fr)", columnGap: 0 }
                  : {}),
                ...(mobilePortraitCombat
                  ? {
                      maxWidth: "100%",
                      padding: "0 2px",
                      gridTemplateRows: isDracula3dCombatPortrait
                        ? "minmax(12px, auto) minmax(10px, auto) minmax(min(220px, 36dvh), auto) auto minmax(4px, auto)"
                        : "minmax(14px, auto) minmax(12px, auto) minmax(min(140px, 26dvh), auto) auto minmax(6px, auto)",
                      rowGap: 5,
                    }
                  : {}),
                ...(isLandscapeCompact
                  ? {
                      gridTemplateRows: isDracula3dCombatPortrait
                        ? "minmax(10px, auto) minmax(0, auto) minmax(min(240px, 52dvh), min(440px, 68dvh)) auto minmax(6px, auto)"
                        : "minmax(10px, auto) minmax(0, auto) minmax(156px, 200px) auto minmax(6px, auto)",
                      rowGap: 6,
                    }
                  : {}),
              };
              const combatSpritePx = isLandscapeCompact ? COMBAT_LANDSCAPE_SPRITE_PX : COMBAT_FACEOFF_SPRITE_PX;
              const combatPlayerAvatarPx = isLandscapeCompact ? COMBAT_LANDSCAPE_SPRITE_PX : COMBAT_PLAYER_AVATAR_PX;
              const lsSpritePx = showCombatLandscapeVersus ? COMBAT_LANDSCAPE_SPRITE_PX : combatSpritePx;
              const lsPlayerAvatarPx = showCombatLandscapeVersus ? COMBAT_LANDSCAPE_SPRITE_PX : combatPlayerAvatarPx;
              const combatMonster3dWidth = isDracula3dCombatPortrait
                ? showCombatLandscapeVersus
                  ? Math.min(COMBAT_DRACULA_3D_VIEWPORT_W, Math.max(lsSpritePx + 140, 320))
                  : mobilePortraitCombat
                    ? Math.min(COMBAT_DRACULA_3D_VIEWPORT_W - 20, Math.max(280, Math.round(lsSpritePx + 100)))
                    : COMBAT_DRACULA_3D_VIEWPORT_W
                : lsSpritePx;
              const combatMonster3dHeight = isDracula3dCombatPortrait
                ? showCombatLandscapeVersus
                  ? Math.min(COMBAT_DRACULA_3D_VIEWPORT_H, Math.max(lsSpritePx + 150, 330))
                  : mobilePortraitCombat
                    ? Math.min(288, Math.max(220, Math.round(lsSpritePx + 100)))
                    : COMBAT_DRACULA_3D_VIEWPORT_H
                : lsSpritePx;
              /** Fit 3D from short viewport edge — portrait uses tall chrome reserve; landscape uses small height − tight chrome. */
              /** Same 3D height while the die rolls as after — shrinking during `rolling` made the fight look zoomed-out and shoved upward. */
              const combatFaceoffInnerH =
                typeof window !== "undefined" ? window.innerHeight : 400;
              const combatFaceoffInnerW =
                typeof window !== "undefined" ? window.innerWidth : 900;
              /**
               * Mobile landscape: width from viewport, height min(w/2, chrome cap).
               * Desktop combat + `/monster-3d-animations` lab share `lib/combat3dFaceoffViewport` (920 x clamp(innerH-272)).
               */
              const mobileLsFaceoffCanvas =
                isMobile &&
                showCombatLandscapeVersus &&
                monsterGltfPath &&
                isLandscapeCompact
                  ? (() => {
                      const chromeH = 108;
                      const w = Math.min(
                        COMBAT_MODAL_WIDTH_LANDSCAPE_PX,
                        Math.max(300, Math.round(combatFaceoffInnerW - 20))
                      );
                      const hLabAspect = Math.round(w / 2);
                      const hMax = Math.max(
                        200,
                        Math.min(380, Math.round(combatFaceoffInnerH - chromeH))
                      );
                      return { width: w, height: Math.min(hLabAspect, hMax) };
                    })()
                  : null;
              const mobileFaceoff3dH =
                isMobile &&
                showCombatLandscapeVersus &&
                monsterGltfPath
                  ? isLandscapeCompact
                    ? mobileLsFaceoffCanvas?.height ??
                      Math.max(
                        118,
                        Math.min(
                          198,
                          Math.round(combatFaceoffInnerH - 198)
                        )
                      )
                    : Math.max(
                        210,
                        Math.min(
                          448,
                          Math.round(
                            (typeof window !== "undefined" ? window.innerHeight : 812) - 278
                          )
                        )
                      )
                  : null;
              const desktopFaceoff3dH =
                !isMobile &&
                showCombatLandscapeVersus &&
                monsterGltfPath
                  ? combatFaceoff3dCanvasHeightDesktopPx(
                      typeof window !== "undefined" ? window.innerHeight : 900
                    )
                  : null;
              const combatScene3dHeightFaceoff =
                mobileFaceoff3dH ?? desktopFaceoff3dH ?? combatMonster3dHeight;
              const combatScene3dWidthFaceoff =
                mobileLsFaceoffCanvas?.width ?? COMBAT_MODAL_WIDTH_LANDSCAPE_PX;
              const draculaHurt3dLocked = combatFooterSnapshot?.draculaHurt3dHp;
              const draculaHurtHpFor3d = (() => {
                const merged3dHurt =
                  headerMt === "V" ||
                  headerMt === "K" ||
                  headerMt === "Z" ||
                  headerMt === "G" ||
                  headerMt === "S" ||
                  headerMt === "L" ||
                  headerMt === "O";
                if (!merged3dHurt || gltfVisualState !== "hurt") return undefined;
                if (draculaHurt3dLocked != null && draculaHurt3dLocked.maxHp >= 1) {
                  return {
                    hp: Math.max(1, Math.min(draculaHurt3dLocked.hp, draculaHurt3dLocked.maxHp)),
                      maxHp: draculaHurt3dLocked.maxHp,
                  };
                }
                if (monsterMaxHp >= 1 && monsterCurHp >= 1) {
                  return { hp: monsterCurHp, maxHp: monsterMaxHp };
                }
                return undefined;
              })();
              /**
               * Same paired-mixer gate as `Monster3dContactPairLab` (`faceOffAnimationSyncKey`): without it, player/monster
               * GLBs that load at different times start clips one frame apart and contact timing diverges from the lab.
               * Omit `rollingApproachBlend` — it lerps every frame; world X still updates via `combatFaceOffPositions`.
               * Omit `gltfVisualState` / `playerGltfVisualState` — including them bumps the key on every beat and disables
               * hunt→strike crossfades in `PositionedGltfSubject` (`syncKeyBump` blocks `locomotionHandoffToStrike`).
               */
              const combat3dFaceOffSyncKey =
                isMonster3DEnabled() && monsterGltfPath && headerMt
                  ? [
                      combatState != null
                        ? `live-${combatState.sessionId}-${combatState.monsterIndex}`
                        : `post-${String(combatResult?.monsterType ?? "?")}-${headerPi}`,
                      headerMt,
                      String(headerPi),
                      monsterDraculaVariantForCombat3d ?? "na",
                      playerAttackVariantForClipLeads ?? "na",
                      combatStrikePick3dDuringRoll ? "sp1" : "sp0",
                      draculaHurtHpFor3d
                        ? `${draculaHurtHpFor3d.hp}/${draculaHurtHpFor3d.maxHp}`
                        : "hurtHpX",
                      playerFatalJumpKill3d ? "fj1" : "fj0",
                      combatFooterSnapshot?.strikePortrait ?? "noFooter",
                      combatFooterSnapshot?.playerRoll != null ? String(combatFooterSnapshot.playerRoll) : "",
                      combatFooterSnapshot?.strikeTargetPick ?? "",
                      String(playerAttackClipCycleIndexFor3d),
                      combatWeaponPath ?? "",
                      combatOffhandArmourPath ?? "",
                    ].join("|")
                  : undefined;
              /** Landscape: skills/artifacts in the center column; roll + retreat under HP bars (pre–e26e59e4 layout). */
              const renderLandscapeFaceoffSkillsPanel = (): React.ReactNode => {
                if (!lab || !combatState) return null;
                const pi = combatState.playerIndex;
                const cp = lab.players[pi] ?? lab.players[headerPi];
                if (combatArtifactRerollPrompt) return null;
                const hasShieldCombatSkill = cp
                  ? (cp.shield ?? 0) > 0 || (cp.artifactShield ?? 0) > 0
                  : false;
                const hasStored = hasCombatVisibleStoredArtifacts(cp);
                const hasSkillRow = hasShieldCombatSkill || hasStored;
                return (
                  <div
                    style={{
                      position: "relative",
                      zIndex: 1,
                      display: "flex",
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 4,
                      flex: "1 1 0%",
                      minWidth: 0,
                      minHeight: 34,
                      height: "auto",
                      padding: "4px 8px",
                      background: "rgba(0,0,0,0.45)",
                      borderRadius: COMBAT_ROLL_UI_RADIUS_PX,
                      border: "1px solid rgba(170,102,255,0.45)",
                      boxSizing: "border-box",
                      flexShrink: 1,
                      overflow: "hidden",
                    }}
                  >
                    <div style={{ color: "#b8a0e8", fontSize: "0.6rem", fontWeight: 700, lineHeight: 1, flexShrink: 0 }}>Skills</div>
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        justifyContent: "flex-start",
                        alignItems: "center",
                        gap: "4px 6px",
                        minHeight: 24,
                        flex: "1 1 0%",
                        minWidth: 0,
                      }}
                    >
                      {hasSkillRow ? (
                        <>
                          {hasShieldCombatSkill && (
                            <CombatSkillItemIcon
                              mode={(cp.shield ?? 0) > 0 ? "toggle" : "consume"}
                              variant="shield"
                              selected={combatUseShield}
                              disabled={rolling || combatArtifactRerollPrompt || combatStrikeLabPending}
                              onClick={() => {
                                if (rolling || combatArtifactRerollPrompt || combatStrikeLabPending) return;
                                if ((cp.shield ?? 0) > 0) {
                                  setCombatUseShield((v) => !v);
                                } else {
                                  handleUseArtifact("shield");
                                }
                              }}
                              title={
                                (cp.shield ?? 0) > 0
                                  ? "Shield: tap to use / not use on this roll (blocks damage if you lose)"
                                  : "Spend shield artifact: +1 block charge, then you can toggle shield on/off each roll"
                              }
                            />
                          )}
                          {STORED_ARTIFACT_ORDER.map((kind) => {
                            const n = storedArtifactCount(cp, kind);
                            if (n <= 0) return null;
                            if (isStoredArtifactMazePhaseOnly(kind)) return null;
                            if (kind === "shield") return null;
                            if (kind === "dice") {
                              return (
                                <CombatSkillItemIcon
                                  key={kind}
                                  mode="toggle"
                                  variant="dice"
                                  selected={combatDiceRerollReserved}
                                  disabled={rolling || combatArtifactRerollPrompt || combatStrikeLabPending}
                                  onClick={() => !rolling && !combatArtifactRerollPrompt && handleCombatDiceArtifactRerollToggle()}
                                  title={`${STORED_ARTIFACT_LINE.dice} — before you roll: tap to mark a reroll. After the roll, choose whether to spend 1 dice artifact for a second strike roll (only that reroll).`}
                                  stackCount={n}
                                />
                              );
                            }
                            if (isWeaponStrikeArtifactKind(kind)) {
                              const iv = storedArtifactIconVariant(kind);
                              return (
                                <CombatSkillItemIcon
                                  key={kind}
                                  mode="consume"
                                  variant={iv}
                                  disabled={rolling}
                                  onClick={() => !rolling && handleUseArtifact(kind)}
                                  title={`${STORED_ARTIFACT_LINE[kind]}. ${STORED_ARTIFACT_TOOLTIP[kind]}`}
                                  stackCount={n}
                                />
                              );
                            }
                            if (isDefenderStrikeArtifactKind(kind)) {
                              const iv = storedArtifactIconVariant(kind);
                              return (
                                <CombatSkillItemIcon
                                  key={kind}
                                  mode="consume"
                                  variant={iv}
                                  disabled={rolling}
                                  onClick={() => !rolling && handleUseArtifact(kind)}
                                  title={`${STORED_ARTIFACT_LINE[kind]}. ${STORED_ARTIFACT_TOOLTIP[kind]}`}
                                  stackCount={n}
                                />
                              );
                            }
                            return null;
                          })}
                        </>
                      ) : cp && (cp.artifacts ?? 0) > 0 ? (
                        <span
                          style={{
                            fontSize: "0.58rem",
                            color: "#9a9aaa",
                            textAlign: "center",
                            lineHeight: 1.2,
                            padding: "0 2px",
                          }}
                        >
                          Artifacts {(cp.artifacts ?? 0)}/3 — maze-phase only (use on map)
                        </span>
                      ) : (
                        <span
                          style={{
                            fontSize: "0.58rem",
                            color: "#666",
                            textAlign: "center",
                            lineHeight: 1.2,
                            padding: "0 2px",
                          }}
                        >
                          {cp ? "No combat skills" : "—"}
                        </span>
                      )}
                    </div>
                  </div>
                );
              };
              return (
                <div
                  style={{
                    width: "100%",
                    ...(isLandscapeCompact || combatActiveFitViewport
                      ? { flex: "1 1 0%", minHeight: 0 }
                      : { flexShrink: 0 }),
                    textAlign: "center",
                    paddingTop: isLandscapeCompact ? 0 : mobileCompactActiveCombat ? 0 : 2,
                    overflow: combatActiveFitViewport ? "hidden" : "visible",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "stretch",
                  }}
                >
                  <h2
                    style={{
                      ...combatModalTitleStyle,
                      ...(isLandscapeCompact ? { marginBottom: 0, marginTop: 0 } : {}),
                      ...(mobileCompactActiveCombat
                        ? {
                            marginBottom: isLandscapeCompact ? 0 : 2,
                            marginTop: 0,
                            fontSize: isLandscapeCompact ? "0.92rem" : "0.98rem",
                          }
                        : {}),
                    }}
                  >
                    Combat
                  </h2>
                  <div
                    style={{
                      minHeight: isLandscapeCompact ? 0 : mobileCompactActiveCombat ? 0 : 18,
                      marginBottom: 0,
                    }}
                  >
                    {diceResult !== null && combatState?.playerIndex === currentPlayer && (
                      <span
                        style={{
                          fontSize: isLandscapeCompact && isMobile ? "0.72rem" : "0.8rem",
                          color: "#00ff88",
                          fontWeight: "bold",
                          lineHeight: isLandscapeCompact && isMobile ? 1.15 : undefined,
                          display: "block",
                        }}
                      >
                        Moves: {Math.max(0, (bonusAdded ?? diceResult) - movesLeft)}/{bonusAdded ?? diceResult}
                      </span>
                    )}
                  </div>
                  {showCombatLandscapeVersus ? (
                  <div
                    style={{
                      ...combatLandscapeFaceoffWrapStyle,
                      position: "relative",
                      ...(useCombatLandscapeFaceoff
                        ? { flex: 1, minHeight: 0, overflow: "hidden", gap: isMobile ? 6 : 10 }
                        : {}),
                      ...(combatLandscapePostFight
                        ? {
                            flex: "0 1 auto",
                            minHeight: "auto",
                            overflow: "visible",
                          }
                        : {}),
                    }}
                  >
                    <div
                      style={{
                        position: "relative",
                        width: "100%",
                        ...(useCombatLandscapeFaceoff
                          ? {
                              flex: 1,
                              minHeight: 0,
                              display: "flex",
                              flexDirection: "column",
                              justifyContent: "center",
                              alignItems: "center",
                            }
                          : {}),
                        }}
                      >
                    {combatAutoHintVisible && combatMonsterHintFullText && !combatResult && (
                        <div
                          style={{
                          position: "absolute",
                          top: 6,
                          left: "50%",
                          transform: "translateX(-50%)",
                          zIndex: 120,
                          width: "min(560px, calc(100% - 24px))",
                          boxSizing: "border-box",
                            display: "flex",
                          alignItems: "flex-start",
                        gap: 8,
                          padding: "8px 10px",
                          borderRadius: 10,
                          border: "2px solid rgba(255, 200, 80, 0.5)",
                          background: "linear-gradient(180deg, rgba(36,34,28,0.95) 0%, rgba(14,13,12,0.92) 100%)",
                          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
                          pointerEvents: "auto",
                        }}
                      >
                            <span
                              style={{
                            flex: 1,
                            minWidth: 0,
                            color: "#f0e6cc",
                            fontSize: "0.7rem",
                            fontWeight: 500,
                            lineHeight: 1.35,
                            textAlign: "left",
                          }}
                        >
                          {combatMonsterHintFullText}
                            </span>
                        <button
                          type="button"
                          aria-label="Close hint"
                          onClick={() => setCombatAutoHintVisible(false)}
                              style={{
                            ...buttonStyle,
                            flexShrink: 0,
                            width: 26,
                            height: 26,
                            padding: 0,
                            fontSize: "1rem",
                            lineHeight: 1,
                            borderRadius: 6,
                            background: "rgba(255,255,255,0.08)",
                            border: "1px solid rgba(255,200,100,0.35)",
                            color: "#eeccaa",
                          }}
                        >
                          ×
                        </button>
                        </div>
                    )}
                    {monsterGltfPath && headerMt ? (
                      <div
                        style={{
                          position: "relative",
                          zIndex: 0,
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "center",
                          width: "100%",
                          overflow: "hidden",
                          marginBottom:
                            monsterGltfPath && headerMt
                              ? isMobile
                                ? 14
                                : 18
                              : isMobile && isLandscapeCompact && useCombatLandscapeFaceoff
                                ? 8
                                : combatActiveFitViewport
                                  ? 2
                                  : 4,
                          ...(useCombatLandscapeFaceoff
                            ? { flex: "0 0 auto", minHeight: 0 }
                            : {}),
                        }}
                      >
                        <CombatScene3D
                          key={combat3dInstanceKey}
                          monsterGltfPath={monsterGltfPath}
                          playerGltfPath={combatPlayerGlb}
                          armourGltfPath={combatWeaponPath}
                          armourOffhandGltfPath={combatOffhandArmourPath}
                          monsterVisualState={gltfVisualState}
                          playerVisualState={playerGltfVisualState}
                          monsterType={headerMt}
                          draculaAttackVariant={monsterDraculaVariantForCombat3d}
                          playerAttackVariant={playerAttackVariantForClipLeads}
                          playerFatalJumpKill={playerFatalJumpKill3d}
                          playerHurtAnimContext={playerHurtAnimContextFor3d}
                          playerHurtClipStartTimeSec={playerHurtClipStartTimeSecFor3d}
                          playerHurtHandoffCrossfadeSec={playerHurtHandoffCrossfadeSecFor3d}
                          playerAttackClipLeadInSec={playerAttackClipLeadInSecFor3d}
                          playerAttackClipCycleIndex={playerAttackClipCycleIndexFor3d}
                          playerLocomotionToAttackCrossfadeSec={playerLocomotionToAttackCrossfadeSecFor3d}
                          monsterLocomotionToAttackCrossfadeSec={monsterLocomotionToAttackCrossfadeSecFor3d}
                          monsterHurtClipStartTimeSec={monsterHurtClipStartTimeSecFor3d}
                          draculaHurtHp={draculaHurtHpFor3d}
                          draculaHurtStrikeZone={draculaHurtStrikeZoneFor3d}
                          draculaLoopAngrySkill01={draculaLossMenaceLoop3d}
                          compactCombatViewport
                          compactCombatShortWide={isMobile && isLandscapeCompact}
                          strikePickActive={combatStrikePick3dDuringRoll}
                          onStrikeTargetPick={handleStrikeTargetPick}
                          onOneShotAnimationFinished={combat3dOneShotFinished}
                          rollingApproachBlend={combat3dApproachBlend}
                          faceOffAnimationSyncKey={combat3dFaceOffSyncKey}
                          combatSceneSessionKey={combat3dInstanceKey}
                          orbitMinDistance={0.48}
                          orbitMaxDistance={11}
                          width={combatScene3dWidthFaceoff}
                          height={combatScene3dHeightFaceoff}
                          fallback={
                            <img
                              key={combat3dFallbackImgSrc}
                              src={combat3dFallbackImgSrc}
                              alt=""
                          style={{
                                width: combatScene3dWidthFaceoff,
                                height: combatScene3dHeightFaceoff,
                                objectFit: "contain",
                              }}
                            />
                          }
                        />
                        {rolling && !combatArtifactRerollPrompt ? (
                          <div
                            style={{
                              position: "absolute",
                              top: 0,
                              left: "50%",
                              transform: "translateX(-50%)",
                              zIndex: 105,
                              width: "min(520px, calc(100% - 12px))",
                              textAlign: "center",
                              padding: "4px 8px",
                              boxSizing: "border-box",
                              fontSize: "0.68rem",
                              color: "#e8d4b0",
                              lineHeight: 1.35,
                              borderRadius: 8,
                              background: "rgba(28,22,16,0.82)",
                              border: "1px solid rgba(255,180,80,0.45)",
                              boxShadow: "0 4px 16px rgba(0,0,0,0.45)",
                              pointerEvents: "none",
                            }}
                            role="status"
                            aria-live="polite"
                          >
                            Commit your aim <strong>while the die is still rolling</strong> — <strong>tap the monster</strong> (high / middle / low) or press{" "}
                            <strong>1</strong> / <strong>2</strong> / <strong>3</strong>. After the strike die locks in, further taps and keys do not count — no
                            valid aim = whiff, <strong>heavy</strong> damage.
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "center",
                        width: "100%",
                        flexShrink: 0,
                        paddingLeft: 4,
                        paddingRight: 4,
                        paddingTop: mobileCompactActiveCombat && isLandscapeCompact ? 0 : undefined,
                        paddingBottom: mobileCompactActiveCombat && isLandscapeCompact ? 0 : undefined,
                        boxSizing: "border-box",
                      }}
                    >
                      <div
                        style={{
                          width: "100%",
                          maxWidth: COMBAT_LANDSCAPE_CENTER_COL_MAX_W,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          minHeight: 0,
                        }}
                      >
                        {combatLandscapePostFight ? (
                          <div
                            style={{
                              width: "100%",
                              minWidth: 0,
                              minHeight: 0,
                              flexShrink: 0,
                            }}
                            aria-hidden
                          />
                        ) : combatArtifactRerollPrompt ? (
                          <div
                            role="dialog"
                            aria-label="Dice artifact reroll"
                            aria-live="polite"
                            style={{
                              position: "relative",
                              zIndex: 100,
                              width: "100%",
                              padding: "8px 10px",
                              boxSizing: "border-box",
                              borderRadius: COMBAT_ROLL_UI_RADIUS_PX,
                              border: "2px solid #aa66ff",
                              background: "linear-gradient(180deg, rgba(58,32,96,0.55) 0%, rgba(20,12,32,0.95) 100%)",
                              display: "flex",
                              flexDirection: "column",
                              gap: 6,
                              flexShrink: 0,
                              maxHeight: 280,
                              overflowY: "auto",
                            }}
                          >
                            <span
                              style={{
                                fontSize: "0.72rem",
                                color: "#e8ddff",
                                lineHeight: 1.3,
                                textAlign: "center",
                              }}
                            >
                              🎲 <strong>Roll again?</strong> Spend <strong>1 Dice</strong> — one reroll only; the new strike
                              replaces the first, then HP updates.
                            </span>
                            {lastCombatStrikeDiceFace != null &&
                            lastCombatStrikeDiceFace >= 1 &&
                            lastCombatStrikeDiceFace <= 6 ? (
                              <span
                                style={{
                                  fontSize: "0.72rem",
                                  fontWeight: 800,
                                  color: "#00ff88",
                                  letterSpacing: "0.04em",
                                  lineHeight: 1.2,
                                  textAlign: "center",
                                  textShadow: "0 0 12px rgba(0, 255, 136, 0.35)",
                                }}
                                aria-label={`Last strike roll ${lastCombatStrikeDiceFace}`}
                              >
                                Last roll: {COMBAT_STRIKE_DICE_FACE_CHARS[lastCombatStrikeDiceFace - 1]}{" "}
                                <span style={{ fontWeight: 700, opacity: 0.95 }}>({lastCombatStrikeDiceFace})</span>
                              </span>
                            ) : null}
                            <div
                              style={{
                                display: "flex",
                                flexDirection: isMobile ? "column" : "row",
                                gap: 6,
                                width: "100%",
                              }}
                            >
                              <button
                                type="button"
                                onClick={handleCombatArtifactRerollDecline}
                                style={{
                                  ...buttonStyle,
                                  flex: 1,
                                  fontSize: "0.72rem",
                                  padding: "6px 8px",
                                  background: "#2a2a32",
                                  color: "#ddd",
                                  border: "1px solid #555",
                                  borderRadius: COMBAT_ROLL_UI_RADIUS_PX,
                                  fontWeight: 700,
                                }}
                              >
                                No — keep first roll
                              </button>
                              <button
                                type="button"
                                onClick={handleCombatArtifactRerollAccept}
                                style={{
                                  ...buttonStyle,
                                  flex: 1,
                                  fontSize: "0.72rem",
                                  padding: "6px 8px",
                                  background: "#3a2060",
                                  color: "#e8ddff",
                                  border: "2px solid #aa66ff",
                                  borderRadius: COMBAT_ROLL_UI_RADIUS_PX,
                                  fontWeight: 700,
                                }}
                              >
                                Yes — roll again
                              </button>
                            </div>
                          </div>
                        ) : rolling ? (
                          <div
                            className="combat-dice"
                            style={{
                              width: "100%",
                              minWidth: 0,
                              minHeight: landscapeFaceoffDiceViewportH,
                              height: combatStrikePickButtonsDuringRoll ? "auto" : landscapeFaceoffDiceViewportH,
                              maxHeight: combatStrikePickButtonsDuringRoll ? "none" : landscapeFaceoffDiceViewportH,
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
                            <div
                              style={{
                                flex: combatStrikePickButtonsDuringRoll ? "1 1 auto" : 1,
                                minHeight: combatStrikePickButtonsDuringRoll ? Math.max(72, landscapeFaceoffDiceViewportH - 108) : 0,
                                width: "100%",
                                display: "flex",
                                flexDirection: "column",
                              }}
                            >
                              <Dice3D
                                ref={combatDiceRef}
                                onRollComplete={handleCombatRollComplete}
                                disabled={rolling}
                                fitContainer
                                hideHint
                              />
                            </div>
                            {combatStrikePickButtonsDuringRoll ? (
                              <div
                                style={{
                                  flexShrink: 0,
                                  width: "100%",
                                  padding: "6px 4px 8px",
                                  boxSizing: "border-box",
                                  borderTop: "1px solid rgba(255,204,0,0.28)",
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: 6,
                                  alignItems: "center",
                                }}
                              >
                                <span
                                  style={{
                                    fontSize: "0.68rem",
                                    color: "#c8c8d0",
                                    textAlign: "center",
                                    lineHeight: 1.35,
                                  }}
                                  aria-live="polite"
                                >
                                  Pick head, body, or legs (or <strong>1</strong> / <strong>2</strong> / <strong>3</strong>) <strong>before the strike die
                                  locks in</strong>. Aiming after the roll has finished does not count — whiff = <strong>heavy</strong> damage.
                                </span>
                                <div style={{ display: "flex", flexDirection: "row", gap: 6, width: "100%", maxWidth: 480 }}>
                                  <button
                                    type="button"
                                    onClick={() => handleStrikeTargetPick("head")}
                                    style={{
                                      ...buttonStyle,
                                      flex: 1,
                                      fontSize: "0.72rem",
                                      padding: "8px 4px",
                                      background: "linear-gradient(180deg, rgba(180,40,40,0.5) 0%, rgba(90,15,15,0.85) 100%)",
                                      color: "#ffcccc",
                                      border: "2px solid rgba(255,100,100,0.6)",
                                      borderRadius: COMBAT_ROLL_UI_RADIUS_PX,
                                      fontWeight: 700,
                                      display: "flex",
                                      flexDirection: "column",
                                      alignItems: "center",
                                      gap: 2,
                                      lineHeight: 1.2,
                                    }}
                                  >
                                    <span style={{ fontSize: "1.1rem" }}>💀</span>
                                    <span>Head</span>
                                    <span style={{ fontSize: "0.6rem", opacity: 0.75, fontWeight: 500 }}>ATK+2 / DEF+2</span>
                                    <span style={{ fontSize: "0.58rem", opacity: 0.6, fontWeight: 400 }}>High Risk [1]</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleStrikeTargetPick("body")}
                                    style={{
                                      ...buttonStyle,
                                      flex: 1,
                                      fontSize: "0.72rem",
                                      padding: "8px 4px",
                                      background: "linear-gradient(180deg, rgba(180,140,20,0.45) 0%, rgba(80,60,10,0.85) 100%)",
                                      color: "#ffeeaa",
                                      border: "2px solid rgba(255,204,0,0.55)",
                                      borderRadius: COMBAT_ROLL_UI_RADIUS_PX,
                                      fontWeight: 700,
                                      display: "flex",
                                      flexDirection: "column",
                                      alignItems: "center",
                                      gap: 2,
                                      lineHeight: 1.2,
                                    }}
                                  >
                                    <span style={{ fontSize: "1.1rem" }}>🛡️</span>
                                    <span>Body</span>
                                    <span style={{ fontSize: "0.6rem", opacity: 0.75, fontWeight: 500 }}>Balanced</span>
                                    <span style={{ fontSize: "0.58rem", opacity: 0.6, fontWeight: 400 }}>Standard [2]</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleStrikeTargetPick("legs")}
                                    style={{
                                      ...buttonStyle,
                                      flex: 1,
                                      fontSize: "0.72rem",
                                      padding: "8px 4px",
                                      background: "linear-gradient(180deg, rgba(30,140,60,0.45) 0%, rgba(10,70,25,0.85) 100%)",
                                      color: "#bbffcc",
                                      border: "2px solid rgba(80,200,100,0.55)",
                                      borderRadius: COMBAT_ROLL_UI_RADIUS_PX,
                                      fontWeight: 700,
                                      display: "flex",
                                      flexDirection: "column",
                                      alignItems: "center",
                                      gap: 2,
                                      lineHeight: 1.2,
                                    }}
                                  >
                                    <span style={{ fontSize: "1.1rem" }}>🦵</span>
                                    <span>Legs</span>
                                    <span style={{ fontSize: "0.6rem", opacity: 0.75, fontWeight: 500 }}>ATK+1 / DEF-1</span>
                                    <span style={{ fontSize: "0.58rem", opacity: 0.6, fontWeight: 400 }}>Safe [3]</span>
                                  </button>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        ) : combatState ? (
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "center",
                              width: "100%",
                              gap: 5,
                              minWidth: 0,
                            }}
                          >
                            {lastCombatStrikeDiceFace != null &&
                            lastCombatStrikeDiceFace >= 1 &&
                            lastCombatStrikeDiceFace <= 6 ? (
                              <span
                                style={{
                                  fontSize: "0.72rem",
                                  fontWeight: 800,
                                  color: "#00ff88",
                                  letterSpacing: "0.04em",
                                  lineHeight: 1.2,
                                  textAlign: "center",
                                  textShadow: "0 0 12px rgba(0, 255, 136, 0.35)",
                                }}
                                aria-label={`Last strike roll ${lastCombatStrikeDiceFace}`}
                              >
                                Last roll: {COMBAT_STRIKE_DICE_FACE_CHARS[lastCombatStrikeDiceFace - 1]}{" "}
                                <span style={{ fontWeight: 700, opacity: 0.95 }}>({lastCombatStrikeDiceFace})</span>
                              </span>
                            ) : null}
                            {/** Combat toast (resolve summary) shown inline when available. */}
                            {!rolling && combatToast ? (
                          <div
                            style={{
                              width: "100%",
                                  maxWidth: "min(100%, 420px)",
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
                                  role="alert"
                                  aria-live="polite"
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
                                    border: "2px solid rgba(255,204,0,0.38)",
                                    background: "rgba(255,204,0,0.08)",
                                    color: "#eeccaa",
                                fontSize: "0.72rem",
                                    fontWeight: 500,
                                textAlign: "center",
                                    lineHeight: 1.28,
                              }}
                            >
                                  <span style={{ display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" as const, overflow: "hidden", wordBreak: "break-word" }}>
                                    {combatToast.message}
                            </span>
                                </div>
                              </div>
                          ) : null}
                        </div>
                        ) : (
                          <div
                          style={{
                            width: "100%",
                              minHeight: landscapeFaceoffDiceViewportH,
                              flexShrink: 0,
                            }}
                            aria-hidden
                          />
                        )}
                      </div>
                    </div>
                    </div>
                    <div
                      style={{
                        position: "relative",
                        zIndex: 2,
                        display: "grid",
                        gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)",
                        gap: "4px 8px",
                        marginTop: monsterGltfPath && headerMt ? (isMobile ? 22 : 26) : 0,
                        marginBottom: 2,
                        width: "100%",
                        alignItems: "center",
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
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          alignSelf: "center",
                          padding: "0 2px",
                        }}
                      >
                        {combatInfoTriggerEl}
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
                    {combatState && !combatLandscapePostFight ? (
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "row",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: isLandscapeCompact && isMobile ? 4 : 6,
                          width: "100%",
                          maxWidth: "min(100%, 780px)",
                          marginLeft: "auto",
                          marginRight: "auto",
                          padding:
                            isLandscapeCompact && isMobile
                              ? "4px 2px max(6px, env(safe-area-inset-bottom, 0px))"
                              : "6px 2px 4px",
                          boxSizing: "border-box",
                          flexShrink: 0,
                          flexWrap: "nowrap",
                        }}
                      >
                        <button
                          type="button"
                          onClick={handleCombatRollClick}
                          disabled={rolling || combatArtifactRerollPrompt || combatStrikeLabPending}
                          style={{
                            ...buttonStyle,
                            flex: "0 0 auto",
                            minWidth: "clamp(70px, 12vw, 100px)",
                            minHeight: 34,
                            padding: "0 clamp(6px, 1.2vw, 14px)",
                            fontSize: "clamp(0.62rem, 1.1vw, 0.72rem)",
                            lineHeight: 1.1,
                            background: "#ffcc00",
                            color: "#111",
                            border: "2px solid #cc9900",
                            borderRadius: COMBAT_ROLL_UI_RADIUS_PX,
                            fontWeight: "bold",
                          }}
                        >
                          Roll dice
                        </button>
                        {renderLandscapeFaceoffSkillsPanel()}
                        <button
                          type="button"
                          onClick={handleRunAway}
                          disabled={rolling || combatArtifactRerollPrompt || combatStrikeLabPending}
                          style={{
                            ...buttonStyle,
                            flex: "0 0 auto",
                            minWidth: "clamp(70px, 12vw, 100px)",
                            minHeight: 34,
                            padding: "0 clamp(6px, 1.2vw, 14px)",
                            fontSize: "clamp(0.62rem, 1.1vw, 0.72rem)",
                            lineHeight: 1.1,
                            background: "#666",
                            color: "#fff",
                            border: "1px solid #888",
                            borderRadius: COMBAT_ROLL_UI_RADIUS_PX,
                          }}
                          title={
                            movesLeft > 0
                              ? "Retreat to a safe adjacent cell (costs 1 move)"
                              : "Retreat — ends combat even with 0 moves (you used your last move to enter the fight)"
                          }
                        >
                          🏃 Run away
                        </button>
                      </div>
                    ) : null}
                    <div style={{ textAlign: "center", minHeight: 8 }}>
                      {combatState && !combatResult && headerSurpriseVisible && !rolling ? (
                        <span
                          style={{
                            fontSize: "0.58rem",
                            fontWeight: "bold",
                            letterSpacing: "0.1em",
                            color: "#aaa",
                            textTransform: "uppercase",
                          }}
                        >
                          {combatMonsterStance === "idle"
                            ? "Surprise: idle"
                            : combatMonsterStance === "hunt"
                              ? "Surprise: hunt"
                              : combatMonsterStance === "attack"
                                ? "Surprise: attack"
                                : "Surprise: angry"}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  ) : (
                  <div style={combatVersusGridStyleEffective}>
                    <div
                      style={{
                        display: hide3dPlayerColumn ? "none" : "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        minHeight: 26,
                        textAlign: "center",
                      }}
                    >
                      {!combatState && (combatResult as { won?: boolean } | null)?.won ? (
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
                      ) : !combatState && (combatResult as { playerDefeated?: boolean } | null)?.playerDefeated ? (
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
                    <div style={hide3dPlayerColumn ? { display: "none" } : undefined} />
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        minHeight: 26,
                        textAlign: "center",
                      }}
                    >
                      {!combatState && (combatResult as { won?: boolean } | null)?.won ? (
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
                      ) : !combatState && (combatResult as { playerDefeated?: boolean } | null)?.playerDefeated ? (
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

                    <span
                      style={{
                        fontSize: "0.8rem",
                        fontWeight: 700,
                        color: PLAYER_COLORS[headerPi] ?? "#00ff88",
                        textAlign: "center",
                        lineHeight: 1.15,
                        maxWidth: "100%",
                        minWidth: 0,
                        alignSelf: "center",
                        paddingBottom: 4,
                        display: hide3dPlayerColumn ? "none" : undefined,
                      }}
                    >
                      {playerNames[headerPi] ?? `Player ${headerPi + 1}`}
                    </span>
                    <div aria-hidden style={{ minWidth: 28, display: hide3dPlayerColumn ? "none" : undefined }} />
                    <span
                      style={{
                        fontSize: "0.8rem",
                        fontWeight: 700,
                        color: "#ff8888",
                        textAlign: "center",
                        lineHeight: 1.15,
                        maxWidth: "100%",
                        minWidth: 0,
                        alignSelf: "center",
                        paddingBottom: 4,
                      }}
                    >
                      {headerMonsterName}
                    </span>

                    <div
                      style={{
                        display: hide3dPlayerColumn ? "none" : "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        minHeight: combatPortraitCellMinH,
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
                          width: combatPlayerAvatarPx,
                          height: combatPlayerAvatarPx,
                          transformOrigin: "50% 50%",
                          transition: "transform 0.35s cubic-bezier(0.34, 1.45, 0.64, 1)",
                        }}
                      >
                        {showCombatDefeatSkull ? "💀" : (
                          <PlayerAvatarFace
                            value={playerAvatars[headerPi] ?? PLAYER_AVATARS[headerPi % PLAYER_AVATARS.length]}
                            sizePx={combatPlayerAvatarPx}
                            radiusPx={10}
                            emojiFont="clamp(5rem, 11vw, 6.75rem)"
                          />
                        )}
                      </span>
                    </div>
                    <div aria-hidden style={{ minWidth: 28, display: hide3dPlayerColumn ? "none" : undefined }} />
                    <div
                      style={{
                        position: "relative",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "flex-start",
                        minHeight: combatPortraitCellMinH,
                        overflow: "visible",
                        width: "100%",
                      }}
                    >
                      {combatAutoHintVisible && combatMonsterHintFullText && !combatResult && (
                        <div
                          style={{
                            position: "absolute",
                            top: 6,
                            left: "50%",
                            transform: "translateX(-50%)",
                            zIndex: 120,
                            width: "min(560px, calc(100vw - 48px))",
                            maxWidth: "calc(100% - 8px)",
                            boxSizing: "border-box",
                            display: "flex",
                            alignItems: "flex-start",
                            gap: 8,
                            padding: "8px 10px",
                            borderRadius: 10,
                            border: "2px solid rgba(255, 200, 80, 0.5)",
                            background: "linear-gradient(180deg, rgba(36,34,28,0.95) 0%, rgba(14,13,12,0.92) 100%)",
                            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
                            pointerEvents: "auto",
                          }}
                        >
                          <span
                            style={{
                              flex: 1,
                              minWidth: 0,
                              color: "#f0e6cc",
                              fontSize: "0.68rem",
                              fontWeight: 500,
                              lineHeight: 1.35,
                              textAlign: "left",
                            }}
                          >
                            {combatMonsterHintFullText}
                          </span>
                          <button
                            type="button"
                            aria-label="Close hint"
                            onClick={() => setCombatAutoHintVisible(false)}
                            style={{ ...buttonStyle, flexShrink: 0, width: 26, height: 26, padding: 0, fontSize: "1rem", lineHeight: 1, borderRadius: 6, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,200,100,0.35)", color: "#eeccaa" }}
                          >
                            ×
                          </button>
                        </div>
                      )}
                      {monsterGltfPath && headerMt ? (
                        <div
                          style={{
                            position: "relative",
                            zIndex: 0,
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "center",
                            width: "100%",
                            flex: "1 1 auto",
                            minHeight: 0,
                            overflow: "hidden",
                            marginBottom: isMobile ? 14 : 18,
                          }}
                        >
                          <CombatScene3D
                            key={combat3dInstanceKey}
                            monsterGltfPath={monsterGltfPath}
                            playerGltfPath={combatPlayerGlb}
                            armourGltfPath={combatWeaponPath}
                            armourOffhandGltfPath={combatOffhandArmourPath}
                            monsterVisualState={gltfVisualState}
                            playerVisualState={playerGltfVisualState}
                            monsterType={headerMt}
                            draculaAttackVariant={monsterDraculaVariantForCombat3d}
                            playerAttackVariant={playerAttackVariantForClipLeads}
                            playerFatalJumpKill={playerFatalJumpKill3d}
                            playerHurtAnimContext={playerHurtAnimContextFor3d}
                            playerHurtClipStartTimeSec={playerHurtClipStartTimeSecFor3d}
                            playerHurtHandoffCrossfadeSec={playerHurtHandoffCrossfadeSecFor3d}
                            playerAttackClipLeadInSec={playerAttackClipLeadInSecFor3d}
                            playerAttackClipCycleIndex={playerAttackClipCycleIndexFor3d}
                            playerLocomotionToAttackCrossfadeSec={playerLocomotionToAttackCrossfadeSecFor3d}
                            monsterLocomotionToAttackCrossfadeSec={monsterLocomotionToAttackCrossfadeSecFor3d}
                            monsterHurtClipStartTimeSec={monsterHurtClipStartTimeSecFor3d}
                            draculaHurtHp={draculaHurtHpFor3d}
                            draculaHurtStrikeZone={draculaHurtStrikeZoneFor3d}
                            draculaLoopAngrySkill01={draculaLossMenaceLoop3d}
                            compactCombatViewport
                            strikePickActive={combatStrikePick3dDuringRoll}
                            onStrikeTargetPick={handleStrikeTargetPick}
                            onOneShotAnimationFinished={combat3dOneShotFinished}
                            rollingApproachBlend={combat3dApproachBlend}
                            faceOffAnimationSyncKey={combat3dFaceOffSyncKey}
                            combatSceneSessionKey={combat3dInstanceKey}
                            orbitMinDistance={0.48}
                            orbitMaxDistance={11}
                            width={COMBAT_MODAL_WIDTH}
                            height={combatMonster3dHeight}
                            fallback={
                              <img
                                key={combat3dFallbackImgSrc}
                                src={combat3dFallbackImgSrc}
                                alt=""
                                style={{
                                  width: combatMonster3dWidth,
                                  height: combatMonster3dHeight,
                                  objectFit: draculaAttackLikePortrait ? "cover" : "contain",
                                  objectPosition: combatMonsterImgObjectPosition,
                                  transformOrigin: "50% 50%",
                                  transition: "transform 0.35s cubic-bezier(0.34, 1.55, 0.64, 1), filter 0.35s ease",
                                  filter: monsterRollScaryGlow
                                    ? "drop-shadow(0 0 18px rgba(255,60,40,0.95)) drop-shadow(0 6px 28px rgba(200,0,0,0.55)) drop-shadow(0 2px 8px rgba(0,0,0,0.6))"
                                    : "drop-shadow(0 2px 8px rgba(0,0,0,0.5))",
                                }}
                              />
                            }
                          />
                          {rolling && !combatArtifactRerollPrompt ? (
                            <div
                              style={{
                                position: "absolute",
                                top: 0,
                                left: "50%",
                                transform: "translateX(-50%)",
                                zIndex: 105,
                                width: "min(520px, calc(100vw - 40px))",
                                maxWidth: "calc(100% - 8px)",
                                textAlign: "center",
                                padding: "5px 8px",
                                boxSizing: "border-box",
                                fontSize: "0.66rem",
                                color: "#e8d4b0",
                                lineHeight: 1.35,
                                borderRadius: 8,
                                background: "rgba(28,22,16,0.82)",
                                border: "1px solid rgba(255,180,80,0.45)",
                                boxShadow: "0 4px 16px rgba(0,0,0,0.45)",
                                pointerEvents: "none",
                              }}
                              role="status"
                              aria-live="polite"
                            >
                              While they close in, <strong>tap the monster</strong> (high / mid / low) or <strong>1–3</strong> to aim.
                              No pick = whiff — <strong>heavy</strong> damage.
                            </div>
                          ) : null}
                        </div>
                      ) : headerMonsterSprite ? (
                        <img
                          key={headerMonsterSprite}
                          src={headerMonsterSprite}
                          alt=""
                          style={{
                            width: combatSpritePx,
                            height: combatSpritePx,
                            objectFit: draculaAttackLikePortrait ? "cover" : "contain",
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
                            width: combatSpritePx,
                            height: combatSpritePx,
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
                        position: "relative",
                        zIndex: 2,
                        gridColumn: "1 / -1",
                        display: "grid",
                        gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)",
                        gap: "4px 8px",
                        marginTop: monsterGltfPath && headerMt ? (isMobile ? 22 : 26) : 0,
                        marginBottom: 1,
                        width: "100%",
                        alignItems: "center",
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
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          alignSelf: "center",
                          padding: "0 2px",
                        }}
                      >
                        {combatInfoTriggerEl}
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

                    <div />
                    <div />
                    <div style={{ textAlign: "center", minHeight: 12 }}>
                      {combatState && !combatResult && headerSurpriseVisible && !rolling ? (
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
                    </div>
                  )}
                        </div>
                              );
                            })()}
            <div style={{ height: 2, flexShrink: 0, minHeight: 2 }} />
            <div
              style={{
                ...combatResultSectionStyle,
                flex: "0 0 auto",
                justifyContent: "flex-start",
                gap: 2,
                width: "100%",
                minHeight: 0,
                maxHeight: combatLandscapePostFight
                  ? "none"
                  : combatState
                    ? combatActiveFitViewport
                      ? "none"
                      : `min(320px, calc(100dvh - 200px))`
                    : "none",
                overflowY:
                  combatLandscapePostFight || combatActiveFitViewport ? "visible" : "auto",
                WebkitOverflowScrolling: "touch",
                boxSizing: "border-box",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                pointerEvents: useCombatLandscapeFaceoff ? ("none" as const) : "auto",
              }}
            >
            {/* Outcome + bonus loot render in centered overlay (`showCombatOutcomeCenterOverlay`), not here. */}
            {combatState || combatResult ? (
                <div
                  style={{
                    width: "100%",
                  minHeight: showCombatOutcomeCenterOverlay ? 0 : 8,
                    flexShrink: 0,
                  }}
                aria-hidden
              />
            ) : null}
                  </div>
            {showCombatOutcomeCenterOverlay ? (
                  <div
                role="presentation"
                    style={{
                  position: "absolute",
                  inset: 0,
                  zIndex: 220,
                      display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding:
                    "max(10px, env(safe-area-inset-top, 0px)) max(12px, env(safe-area-inset-right, 0px)) max(12px, env(safe-area-inset-bottom, 0px)) max(12px, env(safe-area-inset-left, 0px))",
                      boxSizing: "border-box",
                  pointerEvents: "auto",
                  background: "rgba(5, 5, 10, 0.55)",
                  backdropFilter: "blur(3px)",
                }}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <div
                  key={`co-${combatResult.playerIndex ?? 0}-${combatResult.monsterType ?? "?"}-${combatResult.won ? "w" : "l"}-${pendingCombatBonusPick ? (bonusLootRevealed ? "br1" : "br0") : "nb"}`}
                  className="combat-outcome-center-card"
                  role="dialog"
                  aria-modal="true"
                  aria-label="Combat result"
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                      style={{
                    width: "min(100%, 440px)",
                    maxWidth: "100%",
                    maxHeight: "min(82dvh, calc(100% - 20px))",
                    overflowY: "auto",
                    WebkitOverflowScrolling: "touch",
                        boxSizing: "border-box",
                    padding: "14px 16px 16px",
                    borderRadius: 14,
                    background: "linear-gradient(180deg, rgba(26, 24, 32, 0.98) 0%, rgba(10, 10, 14, 0.99) 100%)",
                    border: "2px solid rgba(255, 200, 80, 0.38)",
                    boxShadow:
                      "0 28px 64px rgba(0,0,0,0.58), 0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.07)",
                  }}
                >
                  {renderCombatOutcome(false)}
                </div>
              </div>
            ) : null}
            {combatState &&
            lab &&
            useCombatLandscapeFaceoff &&
            !(isMobile && isLandscapeCompact) &&
            (() => {
              const [dMin, dMax] = getMonsterDamageRange(combatState.monsterType);
              return (
                <div style={combatModalFooterDiceStyle}>
                  <div style={combatModalFooterDiceRowStyle}>
                    <span style={combatModalFooterDiceItemStyle}>
                      Defense: {getMonsterDefense(combatState.monsterType)}
                    </span>
                    <span style={combatModalFooterDiceSepStyle}>·</span>
                    <span style={combatModalFooterDiceItemStyle}>
                      Hit: d6 + holy sword/cross (spent before roll)
                    </span>
                        <span style={combatModalFooterDiceSepStyle}>·</span>
                    <span style={combatModalFooterDiceItemStyle}>
                      If you miss: {dMin}–{dMax} HP (shield can block)
                    </span>
                    <span style={combatModalFooterDiceSepStyle}>·</span>
                    <span style={{ ...combatModalFooterDiceItemStyle, opacity: 0.9 }}>Roll dice to resolve</span>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
        </FullscreenPortal>
      )}
      {settingsOpen && (
        <FullscreenPortal target={fsPortalTarget}>
        <div style={{ ...modalOverlayStyle, zIndex: SETTINGS_MODAL_Z }} onClick={() => setSettingsOpen(false)}>
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
              <label>First monster:</label>
              <select
                value={firstMonsterType}
                onChange={(e) => setFirstMonsterType(e.target.value as import("@/lib/labyrinth").MonsterType)}
                style={selectStyle}
              >
                {(["V", "K", "Z", "S", "G", "L", "O"] as const).map((t) => (
                  <option key={t} value={t}>
                    {t === "V"
                      ? "🧛 Dracula"
                      : t === "K"
                        ? "💀 Skeleton"
                        : t === "Z"
                          ? "🧟 Zombie"
                          : t === "S"
                            ? "🕷 Spider"
                            : t === "G"
                              ? "👻 Ghost"
                              : t === "O"
                                ? "🤡 Dread Clown"
                                : "🔥 Lava Elemental"}
                  </option>
                ))}
              </select>
            </div>
            {MULTIPLAYER_ENABLED ? (
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
            ) : null}
            <div style={{ ...modalRowStyle, flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
              <label>Player names & avatars (horror hunters + emoji):</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, width: "100%" }}>
                {Array.from({ length: numPlayers }).map((_, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 4,
                        flexShrink: 0,
                        maxWidth: AVATAR_PICKER_WRAP_MAX_W,
                        alignItems: "center",
                      }}
                    >
                      {i === 0 ? (
                        <div
                          title={HORROR_HERO_PORTRAITS[0]!.title}
                          style={{
                            width: AVATAR_PICKER_BTN_PX,
                            height: AVATAR_PICKER_BTN_PX,
                            border: `2px solid ${PLAYER_COLORS[0] ?? "#00ff88"}`,
                            borderRadius: 6,
                            background: "rgba(0,255,136,0.2)",
                            overflow: "hidden",
                            flexShrink: 0,
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <img
                            src={heroPortraitImgSrc(PLAYER_1_FIXED_AVATAR_PATH)}
                            alt=""
                            draggable={false}
                            style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center top" }}
                          />
                        </div>
                      ) : (
                        <>
                          {HORROR_HERO_PORTRAITS.map((h) => (
                            <button
                              key={h.path}
                              type="button"
                              title={h.title}
                              onClick={() => {
                                setPlayerAvatars((prev) => {
                                  const next =
                                    prev.length >= numPlayers
                                      ? [...prev]
                                      : [
                                          ...prev,
                                          ...Array.from({ length: numPlayers - prev.length }, (_, j) =>
                                            PLAYER_AVATARS[(prev.length + j) % PLAYER_AVATARS.length]
                                          ),
                                        ];
                                  next[i] = h.path;
                                  return next;
                                });
                              }}
                              style={{
                                width: AVATAR_PICKER_BTN_PX,
                                height: AVATAR_PICKER_BTN_PX,
                                padding: 0,
                                lineHeight: 1,
                                border:
                                  (playerAvatars[i] ?? PLAYER_AVATARS[i % PLAYER_AVATARS.length]) === h.path
                                    ? `2px solid ${PLAYER_COLORS[i] ?? "#00ff88"}`
                                    : "1px solid #444",
                                borderRadius: 6,
                                background:
                                  (playerAvatars[i] ?? PLAYER_AVATARS[i % PLAYER_AVATARS.length]) === h.path
                                    ? "rgba(0,255,136,0.2)"
                                    : "#1a1a24",
                                cursor: "pointer",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                overflow: "hidden",
                              }}
                            >
                              <img
                                src={h.path}
                                alt=""
                                draggable={false}
                                style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center top" }}
                              />
                            </button>
                          ))}
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
                        </>
                      )}
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
                  newGame({ initSource: "settings_random_maze" });
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
        </FullscreenPortal>
      )}

      <div
        ref={mazeAreaRef}
        className={isoImmersiveFallback ? "labyrinth-immersive-maze-area" : undefined}
        style={{
          ...mazeAreaStyle,
          ...((mazeMapView === "iso" ||
            (mazeMapView === "grid" && isoImmersiveUi))
            ? {
                overflow:
                  isoNativeFsActive && (combatOverlayVisible || showDiceModal || winner !== null || settingsOpen)
                    ? ("visible" as const)
                    : ("hidden" as const),
              }
            : {}),
          /** Desktop 3D: flush to main column — drop mazeArea inset so WebGL lines up with sidebar edge + header (no 16px float). */
          ...(mazeMapView === "iso" && lab && !isMobile && !isoImmersiveUi && !isoImmersiveFallback
            ? {
                padding: 0,
                alignItems: "stretch" as const,
              }
            : {}),
          ...(isoImmersiveFallback
            ? {
                position: "fixed" as const,
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                width: "100%",
                maxWidth: "100%",
                height: "100dvh",
                minHeight: "100vh",
                zIndex: ISO_IMMERSIVE_Z,
              }
            : {}),
          ...(isoImmersiveUi
            ? isoPlayRootViewportFill
              ? {
                  paddingTop: "env(safe-area-inset-top, 0px)",
                  paddingRight: "env(safe-area-inset-right, 0px)",
                  paddingLeft: "env(safe-area-inset-left, 0px)",
                  paddingBottom: "env(safe-area-inset-bottom, 0px)",
                  alignItems: "stretch" as const,
                  alignSelf: "stretch",
                  width: "100%",
                  boxSizing: "border-box",
                }
              : {
                  paddingTop: "max(8px, env(safe-area-inset-top, 0px))",
                  paddingRight: "max(12px, env(safe-area-inset-right, 0px))",
                  paddingLeft: "max(12px, env(safe-area-inset-left, 0px))",
                  paddingBottom: "max(10px, env(safe-area-inset-bottom, 0px))",
                  alignItems: "stretch" as const,
                  alignSelf: "stretch",
                  width: "100%",
                  boxSizing: "border-box",
                }
            : {}),
          ...(isLandscapeCompact && lab && !isoImmersiveUi && !mobileIsoEdgeToEdge
            ? {
                paddingTop: mobileLandscapeGridChromeInFixedHud
                  ? "calc(max(4px, env(safe-area-inset-top, 0px)) + 56px)"
                  : "calc(max(4px, env(safe-area-inset-top, 0px)) + 48px)",
              }
            : {}),
          ...(isMobile &&
            !mobileIsoEdgeToEdge &&
            !(isoImmersiveUi && mazeMapView === "iso")
            ? {
                paddingBottom: isoImmersiveUi
                  ? `calc(max(10px, env(safe-area-inset-bottom, 0px)) + ${MAZE_MARGIN + mobileDockInsetPx + 10}px)`
                  : `calc(${MAZE_MARGIN + mobileDockInsetPx + 10}px + env(safe-area-inset-bottom, 0px))`,
              }
            : {}),
          ...(isMobile && showMoveGrid
            ? {
                scrollPaddingBottom: `calc(${mobileDockInsetPx}px + env(safe-area-inset-bottom, 0px))`,
                scrollPaddingRight: `calc(${MOBILE_MOVE_PAD_SCROLL_PADDING_RIGHT_PX}px + env(safe-area-inset-right, 0px))`,
              }
            : {}),
        }}
      >
        {lab && isoImmersiveUi && !combatState && renderPlayFullscreenChrome()}
        {teleportPicker && mazeMapView === "grid" && lab && (
          <div
            style={{
              position: "fixed",
              left: "50%",
              transform: "translateX(-50%)",
              top: "max(52px, calc(8px + env(safe-area-inset-top, 0px)))",
              zIndex: 130,
              pointerEvents: "none",
              maxWidth: "min(calc(100vw - 24px), 480px)",
            }}
          >
            <div style={{ pointerEvents: "auto", display: "flex", justifyContent: "center" }}>
              <TeleportPickTimerBadge model={teleportPickTimerModel} />
            </div>
          </div>
        )}
        {(!isLandscapeCompact || lab) &&
          !isoImmersiveUi &&
          !(showUnifiedDockInDesktopIso && !isMobile) &&
          !mobileLandscapeGridChromeInFixedHud && (
        <div
          style={{
            ...mazeZoomControlsStyle,
            ...(!isMobile && lab && !isoImmersiveUi
              ? {
                  width: "100%",
                  maxWidth: "100%",
                  boxSizing: "border-box",
                  alignSelf: "stretch",
                }
              : {}),
            ...(isMobile
              ? {
                  width: "100%",
                  boxSizing: "border-box",
                  justifyContent: "space-between",
                  gap: 8,
                }
              : {}),
            ...(mobileIsoEdgeToEdge
              ? {
                  position: "fixed" as const,
                  left: "max(8px, env(safe-area-inset-left, 0px))",
                  right: "max(8px, env(safe-area-inset-right, 0px))",
                  top:
                    isLandscapeCompact && lab
                      ? teleportPicker
                        ? "calc(max(8px, env(safe-area-inset-top, 0px)) + 48px)"
                        : "max(8px, env(safe-area-inset-top, 0px))"
                      : `${HEADER_HEIGHT + 6}px`,
                  zIndex: MOBILE_ISO_CANVAS_Z + 150,
                  margin: 0,
                  marginBottom: 0,
                  padding: "6px 10px",
                  background: "rgba(10,10,16,0.94)",
                  borderRadius: 10,
                  border: "1px solid #333",
                  boxShadow: "0 4px 20px rgba(0,0,0,0.45)",
                }
              : {}),
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button
            onClick={() => setMazeZoom((z) => Math.max(MAZE_ZOOM_MIN, z - MAZE_ZOOM_STEP))}
            style={mazeZoomButtonStyle}
            title="Zoom out"
          >
            −
          </button>
          <span style={{ fontSize: "0.8rem", color: "#888", minWidth: 36, textAlign: "center" }}>
            {Math.round((mazeZoom / MAZE_ZOOM_BASELINE) * 100)}%
          </span>
          <button
            onClick={() => setMazeZoom((z) => Math.min(MAZE_ZOOM_MAX, z + MAZE_ZOOM_STEP))}
            style={mazeZoomButtonStyle}
            title="Zoom in"
          >
            +
          </button>
          </div>
          </div>
          {lab && !combatState && !isoImmersiveUi && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span style={{ fontSize: "0.7rem", color: "#888" }}>View</span>
              <button
                type="button"
                onClick={() => setMazeMapView("grid")}
                style={mazeViewToggleButtonStyle(mazeMapView === "grid")}
                title="Top-down 2D map (play here)"
                aria-pressed={mazeMapView === "grid"}
              >
                2D
              </button>
              <button
                type="button"
                onClick={onIsoViewButtonClick}
                style={mazeViewToggleButtonStyle(mazeMapView === "iso")}
                title="3D view — full screen on supported devices"
                aria-pressed={mazeMapView === "iso"}
              >
                3D
              </button>
              {!isMobile ? (
                <button
                  type="button"
                  onClick={() => void enterPlayFullscreen()}
                  style={{
                    ...mazeViewToggleButtonStyle(false),
                    minWidth: 40,
                    padding: "0 8px",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                  title="Enter full-screen play"
                  aria-label="Enter full-screen play"
                >
                  <FullscreenEnterIcon />
                </button>
              ) : null}
            </div>
          )}
          {isMobile && cp && (
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
          {mobileIsoEdgeToEdge && isLandscapeCompact ? (
            <div style={{ display: "flex", alignItems: "center", flexShrink: 0, pointerEvents: "auto" }}>
              {renderHeaderMenuBlock()}
        </div>
          ) : null}
          </div>
        )}
        <div
          ref={mazeWrapRef}
          className={MAZE_LITE_TEXTURES ? "maze-wrap" : "maze-wrap maze-horror-render"}
          style={{
            ...mazeWrapStyle,
            marginTop:
              mobileIsoEdgeToEdge || isLandscapeCompact || isoImmersiveUi || (mazeMapView === "iso" && !isMobile)
                ? 0
                : MAZE_MARGIN,
            position: "relative",
            ...(mazeIsoFillViewport
              ? {
                  padding: 0,
                  border: "none",
                  boxShadow: "none",
                  borderRadius: 0,
                  background: "transparent",
                  alignSelf: "stretch",
                }
              : {}),
            ...((mazeMapView === "iso" ||
              (mazeMapView === "grid" && isoImmersiveUi))
              ? {
              display: "flex",
              flexDirection: "column",
                  flex:
                    mazeMapView === "iso" && isoPlayRootViewportFill
                      ? 0
                      : 1,
              minHeight: 0,
              width: "100%",
                }
              : {}),
          }}
        >
        <div className="maze-stack" style={{
          position: "relative",
          display: mazeMapView === "iso" || (mazeMapView === "grid" && isoImmersiveUi) ? "flex" : "inline-block",
          flexDirection: "column",
          width: mazeMapView === "iso" || (mazeMapView === "grid" && isoImmersiveUi) ? "100%" : undefined,
          flex: mazeMapView === "iso" || (mazeMapView === "grid" && isoImmersiveUi) ? 1 : undefined,
          minHeight: mazeMapView === "iso" || (mazeMapView === "grid" && isoImmersiveUi) ? 0 : undefined,
        }}>
        {lab && cp && !combatState && !lab.eliminatedPlayers.has(currentPlayer) && mazeMapView === "iso" && (
          <div
            ref={isoPlayRootRef}
            className={isoPlayRootViewportFill ? "labyrinth-iso-edge-canvas-host" : undefined}
            style={{
              flex: isoPlayRootViewportFill ? undefined : 1,
              minHeight: isoPlayRootViewportFill ? undefined : 0,
              width: "100%",
              display: "flex",
              flexDirection: "column",
              position: isoPlayRootViewportFill ? ("fixed" as const) : "relative",
              ...(isoPlayRootViewportFill
                ? {
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    zIndex: MOBILE_ISO_CANVAS_Z,
                    height: "100dvh",
                    minHeight: "100vh",
                    maxHeight: "100dvh",
                  }
                : {}),
              background: "#06060a",
            }}
          >
            <div
              style={{
                flex: 1,
                minHeight: 0,
                height: isoPlayRootViewportFill ? "100%" : undefined,
                position: "relative",
                display: "flex",
                flexDirection: "column",
                minWidth: 0,
              }}
            >
          <MazeIsoView
                ref={mazeIsoViewRef}
            grid={lab.grid}
            mapWidth={lab.width}
            mapHeight={lab.height}
            playerX={cp.x}
            playerY={cp.y}
            facingDx={walkFacingMap[currentPlayer]?.dx ?? 0}
            facingDy={walkFacingMap[currentPlayer]?.dy ?? 1}
            playerFacingBearingDeg={isoCameraBearingDeg}
            zoom={mazeZoom}
            visible
            onCellClick={handleCellTap}
                touchUi={isMobile}
                onRotateModeChange={setIsoCamRotateActive}
            teleportOptions={teleportPicker?.options ?? []}
            teleportMode={!!teleportPicker}
                catapultMode={!!catapultPicker}
                catapultFrom={catapultPicker?.from ?? null}
                catapultAimClient={
                  mazeMapView === "iso" && catapultIsoPhase === "pull" ? catapultAimClient : null
                }
                catapultTrajectoryPreview={catapultTrajectoryPreview}
                catapultLockCameraForPull={mazeMapView !== "iso" || catapultIsoPhase === "pull"}
                magicPortalPreviewOptions={isoMagicPortalPreviewOptions}
                teleportSourceType={teleportPicker?.sourceType ?? null}
                focusVersion={currentPlayer}
                miniMonsters={lab.monsters.map((m) => ({ x: m.x, y: m.y, type: m.type, draculaState: m.draculaState }))}
            fogIntensityMap={fogIntensityMap}
                spiderWebCells={lab.webPositions ?? []}
                artifactPickups={mazeIsoArtifactPickups}
                worldFeaturePickups={mazeIsoWorldFeaturePickups}
                combatActive={mazeMapView === "iso" && !!combatState}
                combatRolling={rolling}
                combatRollFace={isoCombatRollFace}
                combatPulseVersion={isoCombatPulseVersion}
                combatMonster={(() => {
                  const cs = combatState as { monsterIndex: number; monsterType: string } | null;
                  if (!cs) return null;
                  const m = lab.monsters[cs.monsterIndex];
                  return m ? { x: m.x, y: m.y, type: m.type } : null;
                })()}
                onCombatRollRequest={
                  mazeMapView === "iso" && !!combatState
                    ? handleCombatRollClick
                    : undefined
                }
                onCombatRun={
                  mazeMapView === "iso" && !!combatState
                    ? handleRunAway
                    : undefined
                }
                onCombatShieldToggle={
                  mazeMapView === "iso" && !!combatState
                    ? () => setCombatUseShield((v) => !v)
                    : undefined
                }
                combatShieldOn={combatUseShield}
                combatShieldAvailable={!!combatState && (cp?.shield ?? 0) > 0}
                combatRunDisabled={rolling}
                isoCombatPlayerCue={isoCombatPlayerCue}
                playerJumpPulseVersion={isoPlayerJumpPulse}
                playerGlbPath={getPlayer3DGlb(playerAvatars[currentPlayer])}
                playerWeaponGltfPath={(() => {
                  const a = playerWeaponGlb[currentPlayer];
                  return a && a !== NO_ARMOUR_SENTINEL ? a : null;
                })()}
                playerOffhandArmourGltfPath={playerOffhandArmourGltfEffective(
                  cp,
                  playerOffhandArmourGlb[currentPlayer]
                )}
                fillViewport={mazeIsoFillViewport}
                onTouchCameraForwardGrid={mazeMapView === "iso" ? onTouchCameraForwardGrid : undefined}
                onIsoCameraBearingDeg={mazeMapView === "iso" ? onIsoCameraBearingDeg : undefined}
                teleportPickTimerOverlay={
                  teleportPicker ? <TeleportPickTimerBadge model={teleportPickTimerModel} compact /> : null
                }
              />
              {desktopWindowedIsoAllHudOnCanvas ? (
                <>
                  <div
                    style={{
                      position: "absolute",
                      left: "50%",
                      top: "max(10px, env(safe-area-inset-top, 0px))",
                      transform: "translateX(-50%)",
                      zIndex: 28,
                      pointerEvents: "auto",
                      maxWidth: "min(92vw, 520px)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        flexWrap: "wrap",
                        justifyContent: "center",
                        padding: "6px 10px",
                        background: "rgba(14,16,26,0.92)",
                        borderRadius: 10,
                        border: "1px solid #554466",
                        boxShadow: "0 8px 28px rgba(0,0,0,0.45)",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <button
                          type="button"
                          onClick={() => setMazeZoom((z) => Math.max(MAZE_ZOOM_MIN, z - MAZE_ZOOM_STEP))}
                          style={mazeZoomButtonStyle}
                          title="Zoom out"
                        >
                          −
                        </button>
                        <span
                          style={{ fontSize: "0.8rem", color: "#888", minWidth: 36, textAlign: "center" }}
                        >
                          {Math.round((mazeZoom / MAZE_ZOOM_BASELINE) * 100)}%
                        </span>
                        <button
                          type="button"
                          onClick={() => setMazeZoom((z) => Math.min(MAZE_ZOOM_MAX, z + MAZE_ZOOM_STEP))}
                          style={mazeZoomButtonStyle}
                          title="Zoom in"
                        >
                          +
                        </button>
                      </div>
                      {lab && !combatState && (
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <span style={{ fontSize: "0.7rem", color: "#888" }}>View</span>
                          <button
                            type="button"
                            onClick={() => setMazeMapView("grid")}
                            style={mazeViewToggleButtonStyle(false)}
                            title="Top-down 2D map (play here)"
                            aria-pressed={false}
                          >
                            2D
                          </button>
                          <button
                            type="button"
                            onClick={onIsoViewButtonClick}
                            style={mazeViewToggleButtonStyle(true)}
                            title="3D view — full screen on supported devices"
                            aria-pressed
                          >
                            3D
                          </button>
                          <button
                            type="button"
                            onClick={() => void enterPlayFullscreen()}
                            style={{
                              ...mazeViewToggleButtonStyle(false),
                              minWidth: 40,
                              padding: "0 8px",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                            title="Enter full-screen play"
                            aria-label="Enter full-screen play"
                          >
                            <FullscreenEnterIcon />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  <div
                    style={{
                      position: "absolute",
                      left: "max(10px, env(safe-area-inset-left, 0px))",
                      bottom: DESKTOP_ISO_WINDOWED_HUD_BOTTOM,
                      zIndex: 25,
                      pointerEvents: "auto",
                    }}
                  >
                    <div
                      style={{
                        ...controlsSectionStyle,
                        border: "1px solid #554466",
                        marginTop: 0,
                        padding: 6,
                        boxSizing: "border-box",
                        background: "rgba(14,16,26,0.92)",
                        borderRadius: 10,
                        boxShadow: "0 8px 28px rgba(0,0,0,0.45)",
                      }}
                    >
                      <div style={{ ...controlsSectionLabelStyle, color: "#ccb8ff" }}>2D mini map</div>
                      <MobileLandscapeMinimapOrbitWrap
                        mazeIsoViewRef={mazeIsoViewRef}
                        diameter={ISO_HUD_MOVE_RING_PX}
                        lab={lab}
                        currentPlayer={currentPlayer}
                        playerFacing={playerFacing}
                        fogIntensityMap={fogIntensityMap}
                        playerCells={playerCells}
                        isoMiniMapZoom={isoMiniMapZoom}
                        setIsoMiniMapZoom={setIsoMiniMapZoom}
                        isoMiniMapPinchStartRef={isoMiniMapPinchStartRef}
                        onOpenGrid={switchToGridAndFocusCurrentPlayer}
                        bearingAngleDeg={isoCameraBearingDeg}
                      />
                    </div>
                  </div>
                  <div
                    style={{
                      position: "absolute",
                      right: "max(10px, env(safe-area-inset-right, 0px))",
                      bottom: DESKTOP_ISO_WINDOWED_HUD_BOTTOM,
                      zIndex: 25,
                      pointerEvents: "auto",
                    }}
                  >
                    <div
                      style={{
                        ...controlsSectionStyle,
                        border: "1px solid #554466",
                        marginTop: 0,
                        padding: 6,
                        boxSizing: "border-box",
                        background: "rgba(14,16,26,0.92)",
                        borderRadius: 10,
                        boxShadow: "0 8px 28px rgba(0,0,0,0.45)",
                      }}
                    >
                      <div style={{ ...controlsSectionLabelStyle, color: "#ccb8ff" }}>Move</div>
                      <IsoHudJoystickMoveRing
                        diameter={ISO_HUD_MOVE_RING_PX}
                        dimPadOverMinimap={false}
                        placement="standalone"
                        canMoveUp={canMoveUp}
                        canMoveDown={canMoveDown}
                        canMoveLeft={canMoveLeft}
                        canMoveRight={canMoveRight}
                        relativeForward={relativeForward}
                        relativeBackward={relativeBackward}
                        relativeLeft={relativeLeft}
                        relativeRight={relativeRight}
                        doMove={doMoveStrafe}
                        scrollToCurrentPlayerOnMap={scrollToCurrentPlayerOnMap}
                        focusDisabled={
                          winner !== null || !lab || (lab.eliminatedPlayers?.has(currentPlayer) ?? false)
                        }
                      />
                    </div>
                  </div>
                  <div
                    style={{
                      position: "absolute",
                      left: "max(10px, env(safe-area-inset-left, 0px))",
                      right: "max(10px, env(safe-area-inset-right, 0px))",
                      bottom: DESKTOP_ISO_WINDOWED_HUD_BOTTOM,
                      zIndex: 26,
                      pointerEvents: "none",
                      display: "flex",
                      flexDirection: "row",
                      justifyContent: "center",
                      alignItems: "flex-end",
                    }}
                  >
                    <div
                      style={{
                        pointerEvents: "auto",
                        width: "100%",
                        maxWidth: "min(560px, calc(100vw - 24px))",
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                        alignItems: "stretch",
                      }}
                    >
                      {pendingCombatOffer && !teleportPicker ? (
                        <div
                          style={{
                            width: "100%",
                            boxSizing: "border-box",
                            padding: "12px 14px",
                            borderRadius: 10,
                            background:
                              "linear-gradient(180deg, rgba(48,22,18,0.96) 0%, rgba(20,10,12,0.99) 100%)",
                            border: "1px solid rgba(255,102,68,0.5)",
                            display: "flex",
                            flexWrap: "wrap",
                            alignItems: "center",
                            gap: 10,
                          }}
                          role="dialog"
                          aria-label="Combat encounter"
                        >
                          <span
                            style={{
                              fontSize: "0.88rem",
                              color: "#e8d8d4",
                              flex: "1 1 240px",
                              lineHeight: 1.45,
                              minWidth: 0,
                            }}
                          >
                            {pendingCombatOffer.source === "player" ? (
                              <>
                                You entered{" "}
                                <strong style={{ color: "#ffaa88" }}>
                                  {getMonsterName(pendingCombatOffer.monsterType)}
                                </strong>
                                &rsquo;s tile.
                              </>
                            ) : (
                              <>
                                <strong style={{ color: "#ffaa88" }}>
                                  {getMonsterName(pendingCombatOffer.monsterType)}
                                </strong>{" "}
                                reached you.
                              </>
                            )}{" "}
                            Start combat?
                          </span>
                          <button
                            type="button"
                            onClick={acceptPendingCombat}
                            style={{
                              ...buttonStyle,
                              background: "#6b1010",
                              border: "1px solid #ff4444",
                              fontSize: "0.85rem",
                              padding: "8px 16px",
                            }}
                          >
                            Fight
                          </button>
                          {(pendingCombatOffer.source === "player" ||
                            monsterHasAdjacentEscapeCell(lab, pendingCombatOffer.monsterIndex)) && (
                            <button
                              type="button"
                              onClick={declinePendingCombat}
                              style={{
                                ...buttonStyle,
                                background: "#2a2830",
                                border: "1px solid #666",
                                color: "#ccc",
                                fontSize: "0.85rem",
                                padding: "8px 16px",
                              }}
                            >
                              {pendingCombatOffer.source === "player" ? "Step back" : "It slips away"}
                            </button>
                          )}
                        </div>
                      ) : (
                        <>
                          {bottomDockContextActive ? (
                            <div
                              style={{
                                ...controlsSectionStyle,
                                border: "1px solid #554466",
                                marginTop: 0,
                                alignItems: "stretch",
                                alignSelf: "stretch",
                                width: "100%",
                                maxHeight: "min(38vh, 280px)",
                                overflowY: "auto",
                                WebkitOverflowScrolling: "touch",
                                background: "rgba(14,16,26,0.92)",
                                borderRadius: 10,
                                boxShadow: "0 8px 28px rgba(0,0,0,0.45)",
                              }}
                            >
                              <div style={{ ...controlsSectionLabelStyle, color: "#ccb8ff" }}>Action</div>
                              <IsoBottomContextPanels
                                teleportPickTimerModel={teleportPickTimerModel}
                                canOfferSlingshotDock={canOfferSlingshotDock}
                                catapultPicker={catapultPicker}
                                teleportPicker={teleportPicker}
                                magicPortalReady={magicPortalReady}
                                immersiveInventoryPick={immersiveInventoryPick}
                                showMoveGrid={showMoveGrid}
                                mazeMapView={mazeMapView}
                                catapultIsoPhase={catapultIsoPhase}
                                slingshotCellAvailable={slingshotCellAvailable}
                                cp={cp}
                                openSlingshotFromDock={openSlingshotFromDock}
                                catapultDragRef={catapultDragRef}
                                setCatapultMode={setCatapultMode}
                                setCatapultPicker={setCatapultPicker}
                                setCatapultDragOffset={setCatapultDragOffset}
                                setCatapultAimClient={setCatapultAimClient}
                                setCatapultIsoPhase={setCatapultIsoPhase}
                                manualTeleportPendingRef={manualTeleportPendingRef}
                                setTeleportPicker={setTeleportPicker}
                                handleTeleportSelect={handleTeleportSelect}
                                handleMagicPortalOpen={handleMagicPortalOpen}
                                setImmersiveInventoryPick={setImmersiveInventoryPick}
                                applyImmersiveInventoryPick={applyImmersiveInventoryPick}
                                immersiveApplyDisabled={immersiveApplyDisabled}
                              />
                            </div>
                          ) : (
                            <div
                              style={{
                                ...controlsSectionStyle,
                                border: "1px solid #554466",
                                marginTop: 0,
                                background: "rgba(14,16,26,0.92)",
                                borderRadius: 10,
                                boxShadow: "0 8px 28px rgba(0,0,0,0.45)",
                              }}
                            >
                              <div style={{ ...controlsSectionLabelStyle, color: "#ccb8ff" }}>
                                Bomb &amp; artifacts
                              </div>
                              <div
                                style={{
                                  display: "flex",
                                  flexDirection: "row",
                                  gap: 8,
                                  overflowX: "auto",
                                  paddingBottom: 4,
                                  width: "100%",
                                  WebkitOverflowScrolling: "touch",
                                }}
                              >
                                {(cp?.bombs ?? 0) > 0 && (
                                  <button
                                    type="button"
                                    onClick={handleUseBomb}
                                    disabled={bombUseDisabled}
                                    style={{
                                      ...buttonStyle,
                                      flex: "0 0 auto",
                                      display: "flex",
                                      flexDirection: "column",
                                      alignItems: "center",
                                      gap: 4,
                                      padding: "8px 12px",
                                      borderRadius: 10,
                                      border: "1px solid #444",
                                      background: "rgba(255,136,68,0.2)",
                                      color: "#ddd",
                                      cursor: "pointer",
                                      minWidth: BOTTOM_DOCK_INVENTORY_CHIP_MIN_WIDTH,
                                      opacity: bombUseDisabled ? 0.45 : 1,
                                    }}
                                    title={
                                      combatState
                                        ? "Explode 3×3 to clear monster (no move cost)"
                                        : "Explode 3×3 area (uses 1 move)"
                                    }
                                  >
                                    <BottomDockInventoryIcon variant="bomb" />
                                    <span style={{ fontSize: "0.7rem", fontWeight: 700 }}>
                                      Bomb ×{cp?.bombs ?? 0}
                                    </span>
                                  </button>
                                )}
                                {STORED_ARTIFACT_ORDER.map((kind) => {
                                  const n = storedArtifactCount(cp, kind);
                                  if (n <= 0) return null;
                                  const mazeOnlyLocked = inCombatDock && isStoredArtifactMazePhaseOnly(kind);
                                  const combatOnlyLocked = !inCombatDock && isStoredArtifactCombatPhaseOnly(kind);
                                  const healFull =
                                    kind === "healing" && (cp?.hp ?? DEFAULT_PLAYER_HP) >= DEFAULT_PLAYER_HP;
                                  const cantReveal =
                                    kind === "reveal" && peekRevealBatchSize(lab, totalDiamondsDock) <= 0;
                                  const disabled = !cp || mazeOnlyLocked || combatOnlyLocked || healFull || cantReveal;
                                  return (
                                    <button
                                      key={kind}
                                      type="button"
                                      onClick={() => handleUseArtifact(kind)}
                                      disabled={disabled}
                                      style={{
                                        ...buttonStyle,
                                        flex: "0 0 auto",
                                        display: "flex",
                                        flexDirection: "column",
                                        alignItems: "center",
                                        gap: 4,
                                        padding: "8px 12px",
                                        borderRadius: 10,
                                        border: "1px solid #444",
                                        background: "rgba(42,42,53,0.95)",
                                        color: "#ddd",
                                        cursor: "pointer",
                                        minWidth: BOTTOM_DOCK_INVENTORY_CHIP_MIN_WIDTH,
                                        opacity: disabled ? 0.45 : 1,
                                      }}
                                      title={
                                        `${STORED_ARTIFACT_TITLE[kind]} ×${n} — ` +
                                        (mazeOnlyLocked
                                          ? `${STORED_ARTIFACT_TOOLTIP[kind]} (not during combat)`
                                          : combatOnlyLocked
                                            ? `${STORED_ARTIFACT_TOOLTIP[kind]} (use during combat)`
                                            : healFull
                                              ? "Already at full HP"
                                              : cantReveal
                                                ? "Nothing hidden to reveal right now"
                                                : STORED_ARTIFACT_TOOLTIP[kind])
                                      }
                                    >
                                      <BottomDockInventoryIcon variant={storedArtifactIconVariant(kind)} />
                                      <span style={{ fontSize: "0.7rem", fontWeight: 700 }}>
                                        {STORED_ARTIFACT_TITLE[kind]} ×{n}
                                      </span>
                                    </button>
                                  );
                                })}
                                {(cp?.bombs ?? 0) <= 0 &&
                                  !STORED_ARTIFACT_ORDER.some((k) => storedArtifactCount(cp, k) > 0) && (
                                    <div
                                      style={{
                                        color: "#666",
                                        fontSize: "0.75rem",
                                        width: "100%",
                                        textAlign: "center",
                                        alignSelf: "center",
                                      }}
                                    >
                                      None
                                    </div>
                                  )}
                              </div>
                            </div>
                          )}
                          <div
                            style={{
                              ...controlsSectionStyle,
                              border: "1px solid #3a3d52",
                              marginTop: 0,
                              padding: "8px 10px",
                              background: "rgba(14,16,26,0.92)",
                              borderRadius: 10,
                              boxShadow: "0 8px 28px rgba(0,0,0,0.45)",
                            }}
                          >
                            <div style={{ ...controlsSectionLabelStyle, color: "#9aa4b8", fontSize: "0.68rem" }}>
                              Turn
                            </div>
                            <div style={{ display: "flex", gap: 8, width: "100%", marginTop: 6 }}>
                              <button
                                type="button"
                                onClick={scrollToCurrentPlayerOnMap}
                                disabled={
                                  winner !== null ||
                                  !lab ||
                                  (lab.eliminatedPlayers?.has(currentPlayer) ?? false)
                                }
                                style={{
                                  ...buttonStyle,
                                  ...secondaryButtonStyle,
                                  flex: 1,
                                  minWidth: 0,
                                  fontSize: "0.85rem",
                                  padding: "8px 12px",
                                }}
                                title="Scroll the maze so the active player’s cell is centered"
                              >
                                Locate player
                              </button>
                              <button
                                type="button"
                                onClick={endTurn}
                                className="secondary"
                                disabled={
                                  winner !== null ||
                                  !!catapultPicker ||
                                  !!teleportPicker ||
                                  !!combatState ||
                                  !!pendingCombatOffer
                                }
                                style={{
                                  ...buttonStyle,
                                  ...secondaryButtonStyle,
                                  flex: 1,
                                  minWidth: 0,
                                  fontSize: "0.85rem",
                                  padding: "8px 12px",
                                }}
                                title={
                                  combatState
                                    ? "Cannot end turn during combat — fight or run first"
                                    : undefined
                                }
                              >
                                End turn
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </>
              ) : null}
              {catapultPicker && (mazeMapView !== "iso" || catapultIsoPhase === "pull") && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    zIndex: 8,
                    touchAction: "none",
                    cursor: "grab",
                    userSelect: "none",
                  }}
                  onPointerDown={(e) => {
                    if (gamePausedRef.current) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const el = e.currentTarget;
                    catapultDragRef.current = {
                      startX: e.clientX,
                      startY: e.clientY,
                      cellX: cp.x,
                      cellY: cp.y,
                    };
                    setCatapultDragOffset({ dx: 0, dy: 0 });
                    if (mazeMapView === "iso") {
                      setCatapultAimClient({ x: e.clientX, y: e.clientY });
                    }
                    el.setPointerCapture(e.pointerId);
                  }}
                  onPointerMove={(e) => {
                    if (gamePausedRef.current) return;
                    const d = catapultDragRef.current;
                    if (!d) return;
                    setCatapultDragOffset({
                      dx: e.clientX - d.startX,
                      dy: e.clientY - d.startY,
                    });
                    if (mazeMapView === "iso") {
                      setCatapultAimClient({ x: e.clientX, y: e.clientY });
                    }
                  }}
                  onPointerCancel={() => {
                    catapultDragRef.current = null;
                    setCatapultDragOffset(null);
                    setCatapultAimClient(null);
                  }}
                  aria-hidden
                />
              )}
              {isoImmersiveUi && (
                <>
                    <div
                      style={{
                        position: "absolute",
                      left: 0,
                      right: 0,
                      bottom: 0,
                      paddingLeft: "max(8px, env(safe-area-inset-left, 0px))",
                      paddingRight: "max(8px, env(safe-area-inset-right, 0px))",
                      paddingBottom: "max(10px, env(safe-area-inset-bottom, 0px))",
                      paddingTop: 10,
                      zIndex: ISO_IMMERSIVE_HUD_Z,
                      pointerEvents: "none",
                      background: "linear-gradient(0deg, rgba(5,6,12,0.94) 0%, rgba(5,6,12,0.65) 45%, transparent 100%)",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "flex-end",
                      gap: 8,
                    }}
                  >
                    {!!pendingCombatOffer && lab && !teleportPicker ? (
                      <div
                        style={{
                          width: "100%",
                          maxWidth: "min(560px, calc(100vw - 24px))",
                          alignSelf: "center",
                          flexShrink: 0,
                        pointerEvents: "auto",
                          position: "relative",
                          zIndex: 6,
                          maxHeight: "min(32vh, 220px)",
                        overflowY: "auto",
                        WebkitOverflowScrolling: "touch",
                        borderRadius: 16,
                        padding: "12px 14px",
                          boxSizing: "border-box",
                        background: "linear-gradient(180deg, rgba(22,24,36,0.97) 0%, rgba(12,13,22,0.99) 100%)",
                        border: "1px solid rgba(255,102,68,0.35)",
                        boxShadow: "0 12px 40px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.05)",
                      }}
                        role="dialog"
                        aria-label="Combat encounter"
                    >
                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                          <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#9aa0b8", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                            Combat
                          </div>
                          <p style={{ margin: 0, fontSize: "0.82rem", color: "#c8cdd8", lineHeight: 1.45 }}>
                            {pendingCombatOffer.source === "player" ? (
                              <>
                                You are on <strong style={{ color: "#ffaa88" }}>{getMonsterName(pendingCombatOffer.monsterType)}</strong>’s tile.
                              </>
                            ) : (
                              <>
                                <strong style={{ color: "#ffaa88" }}>{getMonsterName(pendingCombatOffer.monsterType)}</strong> is on you.
                              </>
                            )}{" "}
                            Start the fight?
                          </p>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                            <button type="button" onClick={acceptPendingCombat} style={{ ...buttonStyle, background: "#6b1010", border: "1px solid #ff4444", fontSize: "0.78rem", padding: "6px 12px" }}>
                              Fight
                            </button>
                            {(pendingCombatOffer.source === "player" ||
                              monsterHasAdjacentEscapeCell(lab, pendingCombatOffer.monsterIndex)) && (
                              <button
                                type="button"
                                onClick={declinePendingCombat}
                                style={{ ...buttonStyle, background: "#2a2830", border: "1px solid #666", color: "#ccc", fontSize: "0.78rem", padding: "6px 12px" }}
                              >
                                {pendingCombatOffer.source === "player" ? "Step back" : "It slips away"}
                              </button>
                            )}
                          </div>
                        </div>
                    </div>
                    ) : null}
                    <div
                      style={{
                        position: "relative",
                        display: "flex",
                        flexDirection: "row",
                        alignItems: "flex-end",
                        justifyContent: "space-between",
                        gap: 10,
                        width: "100%",
                        pointerEvents: "none",
                        flexShrink: 0,
                        minHeight:
                          splitIsoHudOppositeScreen && showMoveGrid && lab
                            ? (splitIsoHudMapAndMove ? MOBILE_LANDSCAPE_ISO_HUD_OUTER_PX : ISO_HUD_MOVE_RING_PX) + 4
                            : undefined,
                      }}
                    >
                      <div
                        style={{
                          pointerEvents: "auto",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "flex-start",
                          gap: 6,
                          flexShrink: 0,
                          maxWidth: "min(210px, 40vw)",
                        }}
                      >
                        {!(lab && isoImmersiveUi && !combatState) && (
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 4,
                              flexWrap: "wrap",
                              background: "rgba(16,18,28,0.88)",
                              border: "1px solid #3a3a4a",
                              borderRadius: 12,
                              padding: "4px 6px",
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => setMazeZoom((z) => Math.max(MAZE_ZOOM_MIN, z - MAZE_ZOOM_STEP))}
                              style={mazeZoomButtonStyle}
                              title="Zoom out 3D"
                            >
                              −
                            </button>
                            <span style={{ fontSize: "0.65rem", color: "#888", minWidth: 30, textAlign: "center" }}>
                              {Math.round((mazeZoom / MAZE_ZOOM_BASELINE) * 100)}%
                            </span>
                            <button
                              type="button"
                              onClick={() => setMazeZoom((z) => Math.min(MAZE_ZOOM_MAX, z + MAZE_ZOOM_STEP))}
                              style={mazeZoomButtonStyle}
                              title="Zoom in 3D"
                            >
                              +
                            </button>
                          </div>
                        )}
                        {splitIsoHudOppositeScreen && showMoveGrid && lab && mazeMapView === "iso" ? (
                          <MobileLandscapeMinimapOrbitWrap
                            mazeIsoViewRef={mazeIsoViewRef}
                            diameter={ISO_HUD_MOVE_RING_PX}
                            {...(splitIsoHudMapAndMove
                              ? {
                                  outerWrapPx: MOBILE_LANDSCAPE_ISO_HUD_OUTER_PX,
                                  innerMapDiscPx: MOBILE_LANDSCAPE_MINIMAP_INNER_DISC_PX,
                                  orbitRingRadialPx: MINIMAP_ORBIT_RING_PX_MOBILE_LANDSCAPE,
                                }
                              : {})}
                            lab={lab}
                            currentPlayer={currentPlayer}
                            playerFacing={playerFacing}
                            fogIntensityMap={fogIntensityMap}
                            playerCells={playerCells}
                            isoMiniMapZoom={isoMiniMapZoom}
                            setIsoMiniMapZoom={setIsoMiniMapZoom}
                            isoMiniMapPinchStartRef={isoMiniMapPinchStartRef}
                            onOpenGrid={() => {
                              if (!isMobile) void leaveIsoImmersiveOnly();
                              switchToGridAndFocusCurrentPlayer();
                            }}
                            bearingAngleDeg={isoCameraBearingDeg}
                          />
                        ) : null}
                      </div>
                      <div
                        style={{
                          pointerEvents: "auto",
                          ...(splitIsoHudOppositeScreen && showMoveGrid && lab
                            ? {
                                position: "absolute",
                                left: "50%",
                                transform: "translateX(-50%)",
                                bottom: 0,
                                zIndex: 1,
                                flex: "none",
                                minWidth: 0,
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                justifyContent: "flex-end",
                                gap: 8,
                                maxWidth: "min(360px, 50vw)",
                              }
                            : {
                                flex: 1,
                                minWidth: 0,
                                display: "flex",
                                flexDirection: "column",
                                justifyContent: "center",
                                alignItems: "center",
                                paddingBottom: 4,
                                gap: 8,
                              }),
                        }}
                      >
                        {bottomDockContextActive ? (
                          <div
                            style={{
                              width: "100%",
                              maxHeight: "min(34vh, 260px)",
                              overflowY: "auto",
                              WebkitOverflowScrolling: "touch",
                              display: "flex",
                              flexDirection: "column",
                              gap: 8,
                              alignItems: "stretch",
                            }}
                          >
                            <IsoBottomContextPanels
                              teleportPickTimerModel={teleportPickTimerModel}
                              canOfferSlingshotDock={canOfferSlingshotDock}
                              catapultPicker={catapultPicker}
                              teleportPicker={teleportPicker}
                              magicPortalReady={magicPortalReady}
                              immersiveInventoryPick={immersiveInventoryPick}
                              showMoveGrid={showMoveGrid}
                              mazeMapView={mazeMapView}
                              catapultIsoPhase={catapultIsoPhase}
                              slingshotCellAvailable={slingshotCellAvailable}
                              cp={cp}
                              openSlingshotFromDock={openSlingshotFromDock}
                              onDismissContextPrompt={
                                isMobile ? () => setMobileDockExpanded(false) : undefined
                              }
                              catapultDragRef={catapultDragRef}
                              setCatapultMode={setCatapultMode}
                              setCatapultPicker={setCatapultPicker}
                              setCatapultDragOffset={setCatapultDragOffset}
                              setCatapultAimClient={setCatapultAimClient}
                              setCatapultIsoPhase={setCatapultIsoPhase}
                              manualTeleportPendingRef={manualTeleportPendingRef}
                              setTeleportPicker={setTeleportPicker}
                              handleTeleportSelect={handleTeleportSelect}
                              handleMagicPortalOpen={handleMagicPortalOpen}
                              setImmersiveInventoryPick={setImmersiveInventoryPick}
                              applyImmersiveInventoryPick={applyImmersiveInventoryPick}
                              immersiveApplyDisabled={immersiveApplyDisabled}
                            />
                          </div>
                        ) : (
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: 6,
                            maxWidth: "min(420px, 52vw)",
                          }}
                        >
                          <div
                            style={{
                              fontSize: "0.58rem",
                              fontWeight: 700,
                              color: "#6a7080",
                              textTransform: "uppercase",
                              letterSpacing: "0.1em",
                            }}
                          >
                            Items
                          </div>
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "row",
                              flexWrap: "nowrap",
                              gap: 6,
                              alignItems: "center",
                              padding: "8px 14px",
                              borderRadius: 999,
                              background: "rgba(14,16,26,0.92)",
                              border: "1px solid rgba(0,255,136,0.22)",
                              boxShadow: "0 4px 20px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)",
                              overflowX: "auto",
                              maxWidth: "100%",
                              WebkitOverflowScrolling: "touch",
                            }}
                          >
                            {dockActions.length === 0 ? (
                              <span style={{ fontSize: "0.72rem", color: "#555", padding: "2px 4px" }}>No items</span>
                            ) : (
                              dockActions.map(({ id, n }) => {
                                const selected = immersiveInventoryPick === id;
                                const bomb = id === "bomb";
                                return (
                                  <button
                                    key={id}
                                    type="button"
                                    onClick={() => setImmersiveInventoryPick((p) => (p === id ? null : id))}
                                    style={{
                                      display: "flex",
                                      flexDirection: "column",
                                      alignItems: "center",
                                      gap: 2,
                                      padding: "6px 10px",
                                      borderRadius: 12,
                                      border: selected ? "2px solid #00ff88" : "1px solid #3a3d4c",
                                      background: bomb ? "rgba(255,136,68,0.12)" : "rgba(36,38,52,0.95)",
                                      color: "#ddd",
                                      cursor: "pointer",
                                      flex: "0 0 auto",
                                      minWidth: 52,
                                    }}
                                    title={
                                      bomb
                                        ? "Bomb"
                                        : id === "catapultCharge"
                                          ? "Slingshot charge — use from any tile (consumes 1 charge)."
                                          : STORED_ARTIFACT_TOOLTIP[id]
                                    }
                                  >
                                    <BottomDockInventoryIcon variant={dockActionIconVariant(id)} />
                                    <span style={{ fontSize: "0.62rem", fontWeight: 700 }}>×{n}</span>
                                  </button>
                                );
                              })
                            )}
                          </div>
                        </div>
                        )}
                      </div>
                      <div
                        style={{
                          pointerEvents: "auto",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          gap: 8,
                          flexShrink: 0,
                        }}
                      >
                        {showMoveGrid && lab ? (
                          splitIsoHudOppositeScreen ? (
                            <IsoHudJoystickMoveRing
                              diameter={
                                splitIsoHudMapAndMove ? MOBILE_LANDSCAPE_ISO_HUD_OUTER_PX : ISO_HUD_MOVE_RING_PX
                              }
                              dimPadOverMinimap={false}
                              placement="standalone"
                              joystickBasisDiameterPx={
                                splitIsoHudMapAndMove ? ISO_HUD_MOVE_RING_PX : undefined
                              }
                              fullCircleTouchTarget={splitIsoHudMapAndMove}
                              canMoveUp={canMoveUp}
                              canMoveDown={canMoveDown}
                              canMoveLeft={canMoveLeft}
                              canMoveRight={canMoveRight}
                              relativeForward={relativeForward}
                              relativeBackward={relativeBackward}
                              relativeLeft={relativeLeft}
                              relativeRight={relativeRight}
                              doMove={doMoveStrafe}
                              scrollToCurrentPlayerOnMap={scrollToCurrentPlayerOnMap}
                              focusDisabled={
                                winner !== null || !lab || (lab.eliminatedPlayers.has(currentPlayer) ?? false)
                              }
                            />
                          ) : (
                            <CircularIsoMinimapMoveHud
                              diameter={ISO_HUD_MOVE_RING_PX}
                              showMinimap={mazeMapView === "iso"}
                              lab={lab}
                              currentPlayer={currentPlayer}
                              playerFacing={playerFacing}
                              fogIntensityMap={fogIntensityMap}
                              playerCells={playerCells}
                              isoMiniMapZoom={isoMiniMapZoom}
                              setIsoMiniMapZoom={setIsoMiniMapZoom}
                              isoMiniMapPinchStartRef={isoMiniMapPinchStartRef}
                              onOpenGrid={() => {
                                if (!isMobile) void leaveIsoImmersiveOnly();
                                switchToGridAndFocusCurrentPlayer();
                              }}
                              canMoveUp={canMoveUp}
                              canMoveDown={canMoveDown}
                              canMoveLeft={canMoveLeft}
                              canMoveRight={canMoveRight}
                              relativeForward={relativeForward}
                              relativeBackward={relativeBackward}
                              relativeLeft={relativeLeft}
                              relativeRight={relativeRight}
                              doMove={doMoveStrafe}
                              scrollToCurrentPlayerOnMap={scrollToCurrentPlayerOnMap}
                              focusDisabled={
                                winner !== null || !lab || (lab.eliminatedPlayers.has(currentPlayer) ?? false)
                              }
                              bearingAngleDeg={isoCameraBearingDeg}
                              mazeIsoViewRef={mazeIsoViewRef}
                            />
                          )
                        ) : null}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
        <div
          className="maze"
          style={{
            ...mazeStyle,
            ...(mazeMapView === "iso" ? { display: "none" } : {}),
            ...({
              "--maze-cell-px": `${CELL_SIZE * mazeZoom}px`,
            } as React.CSSProperties),
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
                const hitFlashSeq =
                  playerAvatarHitFlash?.playerIndex === pi ? playerAvatarHitFlash.seq : 0;
                const showPlayerHitFlash = hitFlashSeq > 0;
                const playerMarker = (
                  <div
                    key={`m-${pi}-${hitFlashSeq}`}
                    className={`marker ${isActive ? "active" : ""} ${isTeleportRise ? "teleport-rise" : ""} ${isJumpLanding ? "jump-landing" : ""} ${showPlayerHitFlash ? "player-avatar-hit-flash" : ""}`}
                    style={{
                      ...markerStyle,
                      ...markerStretchStyle,
                      background: "transparent",
                      fontSize: "1.95rem",
                      lineHeight: 1,
                      boxShadow:
                        isActive && !showPlayerHitFlash ? `0 0 8px ${c}, 0 0 12px ${c}` : undefined,
                      border: isActive ? `2px solid ${c}` : "none",
                      ...(isTeleportRise ? { zIndex: 20, position: "relative" as const } : {}),
                    }}
                  >
                    <PlayerAvatarFace value={avatar} sizePx={40} emojiFont="1.95rem" />
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
                const dirIndicators = pi === currentPlayer && cp && !moveDisabled && movesLeft > 0 ? (
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
                    <span
                      className="artifact-spin-wrap"
                      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                      title={title}
                    >
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
                const magicUsed =
                  lab.hasUsedTeleportFrom(currentPlayer, x, y) || lab.hasTeleportedTo(currentPlayer, x, y);
                {
                  content = (
                    <span className="hole-cell" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", opacity: magicUsed ? 0.4 : 1 }} title={magicUsed ? "Teleport used (from or to this tile)" : "Teleport: pick destination"}>
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

              const effectiveCellSize = CELL_SIZE * mazeZoom;
              const corridorLightDeg = mazeCorridorLightAngleDeg(lab, x, y);
              const rawCellFog = fogIntensityMap.get(`${x},${y}`) ?? 0;
              const chFog = lab.grid[y]?.[x];
              const walkableForFog = chFog ? isWalkable(chFog) : false;
              const walkableForFloor = chFog ? isWalkable(chFog) : false;
              const adjacentWallFog = walkableForFloor
                ? adjacentWallFogFromIntensityMap(lab, x, y, fogIntensityMap)
                : undefined;
              const wallLightCount = walkableForFog
                ? pathFloorWallLightCount(lab, x, y, adjacentWallFog)
                : 0;
              const cellFogVisual = walkableForFog
                ? pathFogVisualIntensity(rawCellFog, wallLightCount)
                : rawCellFog;
              const cellBg: React.CSSProperties = {};
              if (MAZE_LITE_TEXTURES) {
                Object.assign(cellBg, classicFlatMazeCellBackground(cellClass, { isTeleportOption: !!isTeleportOption }));
              } else {
                if (cellClass.includes("wall")) {
                  Object.assign(cellBg, wallStyleWithOptionalSconce(effectiveCellSize, x, y, lab));
                } else if (walkableForFloor) {
                  Object.assign(
                    cellBg,
                    basePathStyle(
                      effectiveCellSize,
                      corridorLightDeg,
                      lab,
                      x,
                      y,
                      rawCellFog,
                      adjacentWallFog,
                    ),
                  );
                }
                if (cellClass.includes("start")) {
                  cellBg.color = "#00ff88";
                }
                if (cellClass.includes("goal")) {
                  cellBg.color = "#ff4444";
                }
                if (cellClass.includes("multiplier")) {
                  cellBg.color = "#ffcc00";
                  cellBg.fontWeight = "bold";
                  cellBg.fontSize = "0.85rem";
                }
              }

              const isTeleportFrom = teleportAnimation?.from[0] === x && teleportAnimation?.from[1] === y;
              const fallAnim = teleportAnimation;
              const fallColor =
                fallAnim && lab.players[fallAnim.playerIndex]
                  ? PLAYER_COLORS_ACTIVE[fallAnim.playerIndex] ?? "#888"
                  : "#888";
              const jumpTarget = jumpTargetByCoord.get(`${x},${y}`);

              /** Slingshot mode blocks taps only when you have no moves left — then you must launch or Cancel. If you still have moves, you can tap to walk off the catapult cell (doMove clears catapult state). */
              const isTappable =
                !gamePaused &&
                ((!!teleportPicker && isTeleportOption) ||
                  (!moveDisabled && (!catapultMode || movesLeft > 0) && (cellClass.includes("path") || !!jumpTarget)));

              const isCurrentPlayerCell = cp && x === cp.x && y === cp.y;
              const isCollisionCell = collisionEffect && collisionEffect.x === x && collisionEffect.y === y;
              if (isCollisionCell) cellClass += " cell-collision";
              const cellOpacity = rawCellFog > 0 ? 1 - 0.75 * cellFogVisual : 1;
              return (
                <div
                  key={`${x}-${y}`}
                  ref={isCurrentPlayerCell ? (el) => { currentPlayerCellRef.current = el; } : undefined}
                  className={cellClass}
                  title={webCellKeySet.has(`${x},${y}`) ? "Spider web: costs 3 moves to cross" : undefined}
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
                    if (gamePausedRef.current) return;
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
                    if (gamePausedRef.current) return;
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
                  {webCellKeySet.has(`${x},${y}`) && (
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
                    const effectiveFog = cellFogVisual;
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
        {lab && playerAvatarHitFlash !== null && mazeMapView === "grid" && (
          <div
            key={playerAvatarHitFlash.seq}
            className="maze-hit-flash-overlay"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: lab.width * CELL_SIZE * mazeZoom,
              height: lab.height * CELL_SIZE * mazeZoom,
              pointerEvents: "none",
              zIndex: 48,
              borderRadius: 2,
            }}
            aria-hidden
          />
        )}
        {/* Fog overlay: per-cell (FOG_GRANULARITY=1) for performance; cleared at player/visited; gradient by player position */}
        {lab && mazeMapView === "grid" && !lab.players.some((p) => p.hasTorch) && (
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
                const raw = Math.max(0, rawFog * (1 - effectiveClearance));
                const tile = lab.grid[cy]?.[cx];
                if (tile && isWalkable(tile)) {
                  const adj = adjacentWallFogFromIntensityMap(lab, cx, cy, fogIntensityMap);
                  return pathFogVisualIntensity(raw, pathFloorWallLightCount(lab, cx, cy, adj));
                }
                return raw;
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
        {mazeMapView === "grid" &&
        catapultPicker &&
        catapultDragOffset &&
        lab &&
        (catapultDragOffset.dx !== 0 || catapultDragOffset.dy !== 0) &&
        (() => {
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
          const pts = traj.arcPoints;
          if (pts.length < 2) return null;
          const pathD = pts.map(([px, py], i) => `${i === 0 ? "M" : "L"} ${px * cs} ${py * cs}`).join(" ");
          const [sx, sy] = pts[0]!;
          const [ex, ey] = pts[pts.length - 1]!;
          const x1 = sx * cs;
          const y1 = sy * cs;
          const x2 = ex * cs;
          const y2 = ey * cs;
          return (
            <svg
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: lab.width * cs,
                height: lab.height * cs,
                pointerEvents: "none",
                zIndex: 55,
              }}
              viewBox={`0 0 ${lab.width * cs} ${lab.height * cs}`}
              aria-hidden
            >
              <defs>
                <linearGradient
                  id="catapult-aim-traj-fade"
                  gradientUnits="userSpaceOnUse"
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                >
                  <stop offset="0%" stopColor="#ffcc66" stopOpacity={0.95} />
                  <stop offset="38%" stopColor="#ffcc00" stopOpacity={0.55} />
                  <stop offset="72%" stopColor="#ffaa33" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="#ffcc00" stopOpacity={0} />
                </linearGradient>
              </defs>
              <path
                d={pathD}
                fill="none"
                stroke="url(#catapult-aim-traj-fade)"
                strokeWidth={3}
                strokeDasharray="7 5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
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
                zIndex: 60,
              }}
              viewBox={`0 0 ${lab.width * cs} ${lab.height * cs}`}
              aria-hidden
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

      {mazeMapView === "grid" &&
        isMobile &&
        effectiveMobileDockExpanded &&
        !windowedBottomDockLocked &&
        lab &&
        !pendingCombatOffer &&
        !combatOverlayVisible && (
        <>
          <div
            ref={mobileDockExpandedHandleRef}
            role="button"
            tabIndex={0}
            onClick={() => setMobileDockExpanded(false)}
            onTouchStart={handleMobileDockTouchStart}
            onTouchEnd={handleMobileDockTouchEnd}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setMobileDockExpanded(false);
              }
            }}
            aria-label="Swipe down to hide controls"
            title="Swipe down to hide"
        style={{
          position: "fixed",
          left: "50%",
          transform: "translateX(-50%)",
              bottom: "max(8px, env(safe-area-inset-bottom, 0px))",
              zIndex: 115,
              width: 72,
              height: 20,
              borderRadius: "10px 10px 0 0",
              background: "rgba(26,26,36,0.92)",
              border: "1px solid #444",
              borderBottom: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "0.6rem",
              color: "#666",
              cursor: "grab",
              touchAction: "none",
              userSelect: "none",
              pointerEvents: "auto",
            }}
          >
            —
          </div>
          <div
            ref={mobileDockExpandedLeftRef}
            style={{
              position: "fixed",
              left: "max(8px, env(safe-area-inset-left, 0px))",
              bottom: "max(36px, calc(20px + env(safe-area-inset-bottom, 0px)))",
              zIndex: 114,
              display: "flex",
              flexDirection: "column",
              gap: 6,
              padding: "8px 10px",
              borderRadius: 10,
              background: "rgba(26,26,36,0.92)",
              border: "1px solid #444",
              boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
              pointerEvents: "auto",
              maxHeight: "50vh",
              overflowY: "auto",
            }}
          >
            {bottomDockContextActive ? (
              <IsoBottomContextPanels
                dense
                teleportPickTimerModel={teleportPickTimerModel}
                canOfferSlingshotDock={canOfferSlingshotDock}
                catapultPicker={catapultPicker}
                teleportPicker={teleportPicker}
                magicPortalReady={magicPortalReady}
                immersiveInventoryPick={immersiveInventoryPick}
                showMoveGrid={showMoveGrid}
                mazeMapView={mazeMapView}
                catapultIsoPhase={catapultIsoPhase}
                slingshotCellAvailable={slingshotCellAvailable}
                cp={cp}
                openSlingshotFromDock={openSlingshotFromDock}
                onDismissContextPrompt={() => setMobileDockExpanded(false)}
                catapultDragRef={catapultDragRef}
                setCatapultMode={setCatapultMode}
                setCatapultPicker={setCatapultPicker}
                setCatapultDragOffset={setCatapultDragOffset}
                setCatapultAimClient={setCatapultAimClient}
                setCatapultIsoPhase={setCatapultIsoPhase}
                manualTeleportPendingRef={manualTeleportPendingRef}
                setTeleportPicker={setTeleportPicker}
                handleTeleportSelect={handleTeleportSelect}
                handleMagicPortalOpen={handleMagicPortalOpen}
                setImmersiveInventoryPick={setImmersiveInventoryPick}
                applyImmersiveInventoryPick={applyImmersiveInventoryPick}
                immersiveApplyDisabled={immersiveApplyDisabled}
              />
            ) : null}
            {!bottomDockContextActive && dockActions.length > 0 ? (
              <>
                <div style={{ fontSize: "0.58rem", color: "#666", textAlign: "center" }}>Tap · Use</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {dockActions.map(({ id, n }) => {
                  const selected = mobileDockAction === id;
                  const bomb = id === "bomb";
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setMobileDockAction(id)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                          gap: 6,
                          padding: "6px 10px",
                          borderRadius: 8,
                        border: selected ? "2px solid #00ff88" : "1px solid #444",
                        background: bomb ? "rgba(255,136,68,0.2)" : "rgba(42,42,53,0.95)",
                        color: "#ddd",
                        cursor: "pointer",
                          minWidth: MOBILE_ARTIFACT_CHIP_W,
                          fontSize: "0.7rem",
                      }}
                      title={
                        bomb
                          ? "Bomb"
                          : id === "catapultCharge"
                            ? "Slingshot charge — use from any tile."
                            : STORED_ARTIFACT_TOOLTIP[id]
                      }
                    >
                        <ArtifactIcon variant={dockActionIconVariant(id)} size={24} />
                        <span style={{ fontWeight: 700 }}>
                          {bomb ? "Bomb" : id === "catapultCharge" ? "Slingshot" : STORED_ARTIFACT_TITLE[id]} ×{n}
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
                    fontSize: "0.75rem",
                    padding: "6px 10px",
                  opacity: mobileApplyDisabled ? 0.45 : 1,
                  }}
                >
                  Use{" "}
                  {mobileDockAction === "bomb"
                    ? "bomb"
                    : mobileDockAction === "catapultCharge"
                      ? "slingshot"
                      : mobileDockAction != null
                        ? STORED_ARTIFACT_TITLE[mobileDockAction]
                        : "…"}
                </button>
              </>
            ) : !bottomDockContextActive ? (
              <div style={{ color: "#666", fontSize: "0.65rem", padding: "4px 0" }}>No items</div>
            ) : null}
          </div>
        </>
      )}

      {isMobile &&
        showMoveGrid &&
        lab &&
        mazeMapView === "iso" &&
        !isoImmersiveUi ? (
            <div
              style={{
                position: "fixed",
            left: "max(8px, env(safe-area-inset-left, 0px))",
                right: "max(8px, env(safe-area-inset-right, 0px))",
                bottom: "max(36px, calc(20px + env(safe-area-inset-bottom, 0px)))",
                zIndex: 114,
            display: "flex",
            flexDirection: "row",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: 8,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              pointerEvents: "auto",
              flexShrink: 0,
                padding: "8px 10px",
                borderRadius: 10,
                background: "rgba(26,26,36,0.92)",
                border: "1px solid #444",
                boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
            }}
          >
            {mazeMapView === "iso" ? (
              <MobileLandscapeMinimapOrbitWrap
                mazeIsoViewRef={mazeIsoViewRef}
                diameter={ISO_HUD_MOVE_RING_PX}
                {...(isLandscapeCompact
                  ? {
                      outerWrapPx: MOBILE_LANDSCAPE_ISO_HUD_OUTER_PX,
                      innerMapDiscPx: MOBILE_LANDSCAPE_MINIMAP_INNER_DISC_PX,
                      orbitRingRadialPx: MINIMAP_ORBIT_RING_PX_MOBILE_LANDSCAPE,
                    }
                  : {})}
                lab={lab}
                currentPlayer={currentPlayer}
                playerFacing={playerFacing}
                fogIntensityMap={fogIntensityMap}
                playerCells={playerCells}
                isoMiniMapZoom={isoMiniMapZoom}
                setIsoMiniMapZoom={setIsoMiniMapZoom}
                isoMiniMapPinchStartRef={isoMiniMapPinchStartRef}
                onOpenGrid={switchToGridAndFocusCurrentPlayer}
                bearingAngleDeg={isoCameraBearingDeg}
              />
            ) : null}
          </div>
          {bottomDockContextActive ? (
            <div
              style={{
                pointerEvents: "auto",
                flex: 1,
                minWidth: 0,
                maxHeight: "min(40vh, 280px)",
                overflowY: "auto",
                WebkitOverflowScrolling: "touch",
                padding: "6px 8px",
                borderRadius: 10,
                background: "rgba(26,26,36,0.92)",
                border: "1px solid #444",
                boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
              }}
            >
              <IsoBottomContextPanels
                dense
                teleportPickTimerModel={teleportPickTimerModel}
                canOfferSlingshotDock={canOfferSlingshotDock}
                catapultPicker={catapultPicker}
                teleportPicker={teleportPicker}
                magicPortalReady={magicPortalReady}
                immersiveInventoryPick={immersiveInventoryPick}
                showMoveGrid={showMoveGrid}
                mazeMapView={mazeMapView}
                catapultIsoPhase={catapultIsoPhase}
                slingshotCellAvailable={slingshotCellAvailable}
                cp={cp}
                openSlingshotFromDock={openSlingshotFromDock}
                onDismissContextPrompt={() => setMobileDockExpanded(false)}
                catapultDragRef={catapultDragRef}
                setCatapultMode={setCatapultMode}
                setCatapultPicker={setCatapultPicker}
                setCatapultDragOffset={setCatapultDragOffset}
                setCatapultAimClient={setCatapultAimClient}
                setCatapultIsoPhase={setCatapultIsoPhase}
                manualTeleportPendingRef={manualTeleportPendingRef}
                setTeleportPicker={setTeleportPicker}
                handleTeleportSelect={handleTeleportSelect}
                handleMagicPortalOpen={handleMagicPortalOpen}
                setImmersiveInventoryPick={setImmersiveInventoryPick}
                applyImmersiveInventoryPick={applyImmersiveInventoryPick}
                immersiveApplyDisabled={immersiveApplyDisabled}
              />
            </div>
          ) : (
            <div style={{ flex: 1, minWidth: 0, minHeight: 0 }} aria-hidden />
          )}
          <div
                style={{
              pointerEvents: "auto",
              flexShrink: 0,
              padding: "8px 10px",
              borderRadius: 10,
              background: "rgba(26,26,36,0.92)",
              border: "1px solid #444",
              boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
            }}
          >
            <IsoHudJoystickMoveRing
              outerRef={mobileDockExpandedMovePadRef}
              diameter={
                isLandscapeCompact ? MOBILE_LANDSCAPE_ISO_HUD_OUTER_PX : ISO_HUD_MOVE_RING_PX
              }
              dimPadOverMinimap={false}
              placement="standalone"
              joystickBasisDiameterPx={isLandscapeCompact ? ISO_HUD_MOVE_RING_PX : undefined}
              fullCircleTouchTarget={isLandscapeCompact}
              canMoveUp={canMoveUp}
              canMoveDown={canMoveDown}
              canMoveLeft={canMoveLeft}
              canMoveRight={canMoveRight}
              relativeForward={relativeForward}
              relativeBackward={relativeBackward}
              relativeLeft={relativeLeft}
              relativeRight={relativeRight}
              doMove={doMoveStrafe}
              scrollToCurrentPlayerOnMap={scrollToCurrentPlayerOnMap}
              focusDisabled={
                winner !== null || !lab || (lab.eliminatedPlayers?.has(currentPlayer) ?? false)
              }
            />
          </div>
        </div>
      ) : null}

      {isMobile &&
        pendingCombatOffer &&
        lab &&
        !isoImmersiveUi &&
        mazeMapView === "grid" &&
        !landscapeCompactPlayHud && (
        <div
          role="dialog"
          aria-label="Combat encounter"
          style={{
            position: "fixed",
            left: "max(8px, env(safe-area-inset-left, 0px))",
            right: "max(8px, env(safe-area-inset-right, 0px))",
            bottom: "max(10px, env(safe-area-inset-bottom, 0px))",
            zIndex: 118,
            padding: "10px 12px",
            borderRadius: 12,
            boxSizing: "border-box",
            background: "linear-gradient(180deg, rgba(48,22,18,0.98) 0%, rgba(18,8,10,0.99) 100%)",
            border: "1px solid rgba(255,102,68,0.55)",
            boxShadow: "0 8px 28px rgba(0,0,0,0.55)",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={{ fontSize: "0.78rem", color: "#e8d8d4", flex: "1 1 200px", lineHeight: 1.35 }}>
            {pendingCombatOffer.source === "player" ? (
              <>
                <strong style={{ color: "#ffaa88" }}>{getMonsterName(pendingCombatOffer.monsterType)}</strong> — fight?
              </>
            ) : (
              <>
                <strong style={{ color: "#ffaa88" }}>{getMonsterName(pendingCombatOffer.monsterType)}</strong> ambush — fight?
              </>
            )}
          </span>
          <button type="button" onClick={acceptPendingCombat} style={{ ...buttonStyle, background: "#6b1010", border: "1px solid #ff4444", fontSize: "0.78rem", padding: "8px 12px" }}>
            Fight
          </button>
          {(pendingCombatOffer.source === "player" ||
            monsterHasAdjacentEscapeCell(lab, pendingCombatOffer.monsterIndex)) && (
            <button
              type="button"
              onClick={declinePendingCombat}
              style={{ ...buttonStyle, background: "#2a2830", border: "1px solid #666", color: "#ccc", fontSize: "0.78rem", padding: "8px 12px" }}
            >
              {pendingCombatOffer.source === "player" ? "Step back" : "It slips away"}
            </button>
          )}
        </div>
      )}

      {!hideUnifiedBottomDockInDesktop3d ? (
      <div
        ref={mobileDockRef}
        className="controls-panel unified-bottom-dock"
        style={{
          ...controlsPanelStyle,
          ...(isMobile &&
          (pendingCombatOffer || combatOverlayVisible) &&
          mazeMapView === "grid"
            ? { opacity: pendingCombatOffer ? 0.25 : 1, pointerEvents: "none" as const }
            : {}),
          ...(isMobile
            ? {
                position: "fixed",
                ...(effectiveMobileDockExpanded
                  ? {
                      pointerEvents: "none",
                      left: 0,
                      right: 0,
                      bottom: 0,
                      zIndex: 110,
                      width: "100%",
                      height: 0,
                    }
                  : {
                      left: "50%",
                      transform: "translateX(-50%)",
                      bottom: "max(10px, env(safe-area-inset-bottom, 0px))",
                      zIndex: 110,
                      width: "calc(100vw - 16px)",
                      maxWidth: 432,
                      boxSizing: "border-box",
                      minHeight: MOBILE_DOCK_COLLAPSED_H,
                      height: "auto",
                      overflow: "visible",
                      flexDirection: "column-reverse" as const,
                    }),
                transition: "height 0.2s ease, min-height 0.2s ease",
              }
            : {
                /** In document flow so the maze scroll area shrinks and controls sit below the map (no viewport overlap). */
                position: "relative",
                alignSelf: desktopDockFullWidthBar ? ("stretch" as const) : "center",
                marginTop: 12,
                marginBottom: 4,
                width: desktopDockFullWidthBar ? "100%" : "min(760px, 100%)",
                maxWidth: desktopDockFullWidthBar ? "none" : 760,
                paddingLeft: desktopDockFullWidthBar ? "max(12px, env(safe-area-inset-left, 0px))" : undefined,
                paddingRight: desktopDockFullWidthBar ? "max(12px, env(safe-area-inset-right, 0px))" : undefined,
                boxSizing: "border-box",
                zIndex: 1,
              }),
          ...(mazeMapView !== "grid" && !showUnifiedDockInDesktopIso
            ? {
                display: "none",
                height: 0,
                minHeight: 0,
                margin: 0,
                padding: 0,
                border: "none",
                overflow: "hidden",
                pointerEvents: "none",
              }
            : {}),
        }}
      >
        {isMobile ? (
          !effectiveMobileDockExpanded ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column-reverse",
                gap: 6,
                width: "100%",
                flexShrink: 0,
              }}
            >
              <div
                role="button"
                tabIndex={0}
                onClick={() => setMobileDockExpanded(true)}
                onTouchStart={handleMobileDockTouchStart}
                onTouchEnd={handleMobileDockTouchEnd}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setMobileDockExpanded(true);
                  }
                }}
                aria-expanded={false}
                aria-label="Swipe up to show controls"
                title="Swipe up to show controls"
                style={{
                  ...controlsSectionStyle,
                  border: "1px solid #554466",
                  marginTop: 0,
                  cursor: "grab",
                  touchAction: "none",
                  userSelect: "none",
                  WebkitTapHighlightColor: "transparent",
                  flexShrink: 0,
                  borderTopLeftRadius: 12,
                  borderTopRightRadius: 12,
                  paddingTop: 8,
                  paddingBottom: 8,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, width: "100%" }}>
                  <div style={{ ...controlsSectionLabelStyle, color: "#ccb8ff", flex: 1, textAlign: "left" }}>Controls</div>
                  <span style={{ flexShrink: 0, fontSize: "0.9rem", color: "#666" }}>▲ Swipe up</span>
                </div>
              </div>
              {bottomDockContextActive ? (
                <div
                  style={{
                    width: "100%",
                    flexShrink: 0,
                    maxHeight: "min(38vh, 240px)",
                    overflowY: "auto",
                    WebkitOverflowScrolling: "touch",
                    padding: "6px 8px",
                    borderRadius: 10,
                    background: "rgba(14,16,26,0.95)",
                    border: "1px solid #444",
                    boxSizing: "border-box",
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <IsoBottomContextPanels
                    dense
                    teleportPickTimerModel={teleportPickTimerModel}
                    canOfferSlingshotDock={canOfferSlingshotDock}
                    catapultPicker={catapultPicker}
                    teleportPicker={teleportPicker}
                    magicPortalReady={magicPortalReady}
                    immersiveInventoryPick={immersiveInventoryPick}
                    showMoveGrid={showMoveGrid}
                    mazeMapView={mazeMapView}
                    catapultIsoPhase={catapultIsoPhase}
                    slingshotCellAvailable={slingshotCellAvailable}
                    cp={cp}
                    openSlingshotFromDock={openSlingshotFromDock}
                    onDismissContextPrompt={() => setMobileDockExpanded(false)}
                    catapultDragRef={catapultDragRef}
                    setCatapultMode={setCatapultMode}
                    setCatapultPicker={setCatapultPicker}
                    setCatapultDragOffset={setCatapultDragOffset}
                    setCatapultAimClient={setCatapultAimClient}
                    setCatapultIsoPhase={setCatapultIsoPhase}
                    manualTeleportPendingRef={manualTeleportPendingRef}
                    setTeleportPicker={setTeleportPicker}
                    handleTeleportSelect={handleTeleportSelect}
                    handleMagicPortalOpen={handleMagicPortalOpen}
                    setImmersiveInventoryPick={setImmersiveInventoryPick}
                    applyImmersiveInventoryPick={applyImmersiveInventoryPick}
                    immersiveApplyDisabled={immersiveApplyDisabled}
                  />
                </div>
              ) : null}
            </div>
          ) : null
        ) : desktopWindowedIsoAllHudOnCanvas ? null : pendingCombatOffer && lab && !teleportPicker ? (
          <div
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "12px 14px",
              borderRadius: 10,
              background: "linear-gradient(180deg, rgba(48,22,18,0.96) 0%, rgba(20,10,12,0.99) 100%)",
              border: "1px solid rgba(255,102,68,0.5)",
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 10,
            }}
            role="dialog"
            aria-label="Combat encounter"
          >
            <span style={{ fontSize: "0.88rem", color: "#e8d8d4", flex: "1 1 240px", lineHeight: 1.45, minWidth: 0 }}>
              {pendingCombatOffer.source === "player" ? (
                <>
                  You entered <strong style={{ color: "#ffaa88" }}>{getMonsterName(pendingCombatOffer.monsterType)}</strong>
                  &rsquo;s tile.
                </>
              ) : (
                <>
                  <strong style={{ color: "#ffaa88" }}>{getMonsterName(pendingCombatOffer.monsterType)}</strong> reached you.
                </>
              )}{" "}
              Start combat?
            </span>
          <button
            type="button"
              onClick={acceptPendingCombat}
            style={{
              ...buttonStyle,
                background: "#6b1010",
                border: "1px solid #ff4444",
              fontSize: "0.85rem",
                padding: "8px 16px",
              }}
            >
              Fight
          </button>
            {(pendingCombatOffer.source === "player" ||
              monsterHasAdjacentEscapeCell(lab, pendingCombatOffer.monsterIndex)) && (
              <button
                type="button"
                onClick={declinePendingCombat}
                style={{
                  ...buttonStyle,
                  background: "#2a2830",
                  border: "1px solid #666",
                  color: "#ccc",
                  fontSize: "0.85rem",
                  padding: "8px 16px",
                }}
              >
                {pendingCombatOffer.source === "player" ? "Step back" : "It slips away"}
              </button>
            )}
          </div>
        ) : (
          <>
            {!windowedBottomDockLocked &&
              (effectiveDesktopControlsCollapsed && lab ? (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "row",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: 8,
                    width: "100%",
                    marginTop: 0,
                    padding: "6px 10px",
                    boxSizing: "border-box",
                    borderRadius: 8,
                    border: "1px solid #554466",
                    background: "rgba(14,16,26,0.82)",
                    flexShrink: 0,
                  }}
                >
                  {bottomDockContextActive ? (
                    <div
                      style={{
                        flex: "1 1 200px",
                        minWidth: 0,
                        maxHeight: "min(36vh, 260px)",
                        overflowY: "auto",
                        WebkitOverflowScrolling: "touch",
                      }}
                    >
                      <IsoBottomContextPanels
                        dense
                        teleportPickTimerModel={teleportPickTimerModel}
                        canOfferSlingshotDock={canOfferSlingshotDock}
                        catapultPicker={catapultPicker}
                        teleportPicker={teleportPicker}
                        magicPortalReady={magicPortalReady}
                        immersiveInventoryPick={immersiveInventoryPick}
                        showMoveGrid={showMoveGrid}
                        mazeMapView={mazeMapView}
                        catapultIsoPhase={catapultIsoPhase}
                        slingshotCellAvailable={slingshotCellAvailable}
                        cp={cp}
                        openSlingshotFromDock={openSlingshotFromDock}
                        onDismissContextPrompt={() => setDesktopControlsCollapsed(false)}
                        catapultDragRef={catapultDragRef}
                        setCatapultMode={setCatapultMode}
                        setCatapultPicker={setCatapultPicker}
                        setCatapultDragOffset={setCatapultDragOffset}
                        setCatapultAimClient={setCatapultAimClient}
                        setCatapultIsoPhase={setCatapultIsoPhase}
                        manualTeleportPendingRef={manualTeleportPendingRef}
                        setTeleportPicker={setTeleportPicker}
                        handleTeleportSelect={handleTeleportSelect}
                        handleMagicPortalOpen={handleMagicPortalOpen}
                        setImmersiveInventoryPick={setImmersiveInventoryPick}
                        applyImmersiveInventoryPick={applyImmersiveInventoryPick}
                        immersiveApplyDisabled={immersiveApplyDisabled}
                      />
                    </div>
                  ) : (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "row",
                      gap: 6,
                      overflowX: "auto",
                      flex: "1 1 200px",
                      minWidth: 0,
                      alignItems: "center",
                      WebkitOverflowScrolling: "touch",
                    }}
                  >
                    {(cp?.bombs ?? 0) > 0 && (
              <button
                type="button"
                        onClick={handleUseBomb}
                        disabled={bombUseDisabled}
                style={{
                  ...buttonStyle,
                          flex: "0 0 auto",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          gap: 2,
                          padding: "4px 8px",
                  borderRadius: 8,
                          border: "1px solid #444",
                          background: "rgba(255,136,68,0.2)",
                          color: "#ddd",
                          minWidth: 56,
                          fontSize: "0.62rem",
                          fontWeight: 700,
                          opacity: bombUseDisabled ? 0.45 : 1,
                        }}
                        title={combatState ? "Explode 3×3 to clear monster (no move cost)" : "Explode 3×3 area (uses 1 move)"}
                      >
                        <BottomDockInventoryIcon variant="bomb" />
                        ×{cp?.bombs ?? 0}
              </button>
                    )}
                    {canOfferSlingshotDock && !catapultPicker && (cp?.catapultCharges ?? 0) > 0 && (
          <button
            type="button"
                        onClick={openSlingshotFromDock}
            style={{
              ...buttonStyle,
                          flex: "0 0 auto",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          gap: 2,
                          padding: "4px 8px",
              borderRadius: 8,
                          border: "1px solid #00ff8866",
                          background: "rgba(26,61,42,0.5)",
                          color: "#b8ffcc",
                          minWidth: 56,
                          fontSize: "0.62rem",
                          fontWeight: 700,
                        }}
                        title="Slingshot"
                      >
                        <BottomDockInventoryIcon variant="catapult" />
                        ×{cp?.catapultCharges ?? 0}
          </button>
                    )}
                    {STORED_ARTIFACT_ORDER.map((kind) => {
                      const n = storedArtifactCount(cp, kind);
                      if (n <= 0) return null;
                      const mazeOnlyLocked = inCombatDock && isStoredArtifactMazePhaseOnly(kind);
                      const combatOnlyLocked = !inCombatDock && isStoredArtifactCombatPhaseOnly(kind);
                      const healFull = kind === "healing" && (cp?.hp ?? DEFAULT_PLAYER_HP) >= DEFAULT_PLAYER_HP;
                      const cantReveal = kind === "reveal" && peekRevealBatchSize(lab, totalDiamondsDock) <= 0;
                      const disabled = !cp || mazeOnlyLocked || combatOnlyLocked || healFull || cantReveal;
                      return (
          <button
                          key={kind}
            type="button"
                          onClick={() => handleUseArtifact(kind)}
                          disabled={disabled}
            style={{
              ...buttonStyle,
                            flex: "0 0 auto",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: 2,
                            padding: "4px 8px",
              borderRadius: 8,
                            border: "1px solid #444",
                            background: "rgba(42,42,53,0.95)",
                            color: "#ddd",
                            minWidth: 56,
                            fontSize: "0.62rem",
                            fontWeight: 700,
                            opacity: disabled ? 0.45 : 1,
                }}
                title={
                            mazeOnlyLocked
                              ? `${STORED_ARTIFACT_TOOLTIP[kind]} (not during combat)`
                              : combatOnlyLocked
                                ? `${STORED_ARTIFACT_TOOLTIP[kind]} (use during combat)`
                                : STORED_ARTIFACT_TOOLTIP[kind]
                          }
                        >
                          <BottomDockInventoryIcon variant={storedArtifactIconVariant(kind)} />
                          ×{n}
              </button>
                      );
                    })}
                    {(cp?.bombs ?? 0) <= 0 &&
                      (cp?.catapultCharges ?? 0) <= 0 &&
                      !STORED_ARTIFACT_ORDER.some((k) => storedArtifactCount(cp, k) > 0) && (
                        <span style={{ color: "#666", fontSize: "0.72rem", padding: "2px 4px" }}>No items</span>
                      )}
                  </div>
                  )}
            <div
              style={{
                display: "flex",
                      flexDirection: "row",
                      flexWrap: "wrap",
                gap: 6,
                flexShrink: 0,
                      alignItems: "center",
                    }}
                  >
                    <button
                      type="button"
                      onClick={scrollToCurrentPlayerOnMap}
                      disabled={
                        winner !== null || !lab || (lab.eliminatedPlayers?.has(currentPlayer) ?? false)
                      }
                style={{
                        ...buttonStyle,
                        ...secondaryButtonStyle,
                        fontSize: "0.72rem",
                        padding: "6px 10px",
                        opacity:
                          winner !== null || !lab || (lab.eliminatedPlayers?.has(currentPlayer) ?? false)
                            ? 0.45
                            : 1,
                      }}
                      title="Scroll the maze so the active player’s cell is centered"
                    >
                      Locate
                    </button>
                    {mazeMapView === "iso" ? (
                <button
                  type="button"
                        onClick={() => mazeIsoViewRef.current?.resetCameraView()}
                  style={{
                    ...buttonStyle,
                          ...secondaryButtonStyle,
                          fontSize: "0.72rem",
                          padding: "6px 10px",
                        }}
                        title="Reset 3D camera to default view behind the player"
                      >
                        Reset view
                </button>
                    ) : null}
                <button
                  type="button"
                      onClick={() => setDesktopControlsCollapsed(false)}
                  style={{
                    ...buttonStyle,
                        fontSize: "0.72rem",
                        padding: "6px 10px",
                        fontWeight: 700,
                        background: "#2a2048",
                    color: "#e8ddff",
                        border: "1px solid #8866cc",
                      }}
                      title="Show full controls (map, move pad, end turn)"
                    >
                      Full controls ▲
                </button>
            </div>
                </div>
              ) : !effectiveDesktopControlsCollapsed ? (
            <div
              role="button"
              tabIndex={0}
              onClick={() => setDesktopControlsCollapsed((c) => !c)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setDesktopControlsCollapsed((c) => !c);
                }
              }}
                  aria-expanded
                  aria-label="Collapse controls"
                  title="Collapse controls"
              style={{
                ...controlsSectionStyle,
                border: "1px solid #554466",
                marginTop: 0,
                cursor: "pointer",
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "6px 10px",
                flexShrink: 0,
              }}
            >
              <div style={{ ...controlsSectionLabelStyle, color: "#ccb8ff" }}>Controls</div>
                  <span style={{ fontSize: "0.75rem", color: "#666" }}>▼ Collapse</span>
            </div>
              ) : null)}

            {desktopDockCollapsedGridMapMoveStrip ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "flex-end",
                  justifyContent: "space-between",
                  gap: 16,
                  width: "100%",
                  marginTop: 8,
                  boxSizing: "border-box",
                }}
              >
                <div style={{ flexShrink: 0 }}>
                  <div
                    style={{
                      ...controlsSectionStyle,
                      border: "1px solid #554466",
                      marginTop: 0,
                      padding: 6,
                      boxSizing: "border-box",
                    }}
                  >
                    <div style={{ ...controlsSectionLabelStyle, color: "#ccb8ff" }}>2D mini map</div>
                    <IsoHudMinimapCircle
                      diameter={ISO_HUD_MOVE_RING_PX}
                      lab={lab}
                      currentPlayer={currentPlayer}
                      playerFacing={playerFacing}
                      fogIntensityMap={fogIntensityMap}
                      playerCells={playerCells}
                      isoMiniMapZoom={isoMiniMapZoom}
                      setIsoMiniMapZoom={setIsoMiniMapZoom}
                      isoMiniMapPinchStartRef={isoMiniMapPinchStartRef}
                      onOpenGrid={switchToGridAndFocusCurrentPlayer}
                      playerCenteredRotate
                      bearingAngleDeg={isoCameraBearingDeg}
                    />
                  </div>
                </div>
                <div style={{ flexShrink: 0 }}>
                  <div
                    style={{
                      ...controlsSectionStyle,
                      border: "1px solid #554466",
                      marginTop: 0,
                      padding: 6,
                      boxSizing: "border-box",
                    }}
                  >
                    <div style={{ ...controlsSectionLabelStyle, color: "#ccb8ff" }}>Move</div>
                    <IsoHudJoystickMoveRing
                      diameter={ISO_HUD_MOVE_RING_PX}
                      dimPadOverMinimap={false}
                      placement="standalone"
                      canMoveUp={canMoveUp}
                      canMoveDown={canMoveDown}
                      canMoveLeft={canMoveLeft}
                      canMoveRight={canMoveRight}
                      relativeForward={relativeForward}
                      relativeBackward={relativeBackward}
                      relativeLeft={relativeLeft}
                      relativeRight={relativeRight}
                      doMove={doMoveStrafe}
                      scrollToCurrentPlayerOnMap={scrollToCurrentPlayerOnMap}
                      focusDisabled={
                        winner !== null || !lab || (lab.eliminatedPlayers?.has(currentPlayer) ?? false)
                      }
                    />
                  </div>
                </div>
              </div>
            ) : null}

            {!effectiveDesktopControlsCollapsed && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: desktopDockThreeColumn && lab ? ("flex-end" as const) : "flex-start",
                  gap: desktopDockThreeColumn && lab ? 16 : 12,
                  width: "100%",
                  marginTop: 6,
                  boxSizing: "border-box",
                  ...(desktopDockThreeColumn && lab ? { justifyContent: "space-between" } : {}),
                }}
              >
                {desktopDockThreeColumn && lab && !desktopWindowedIsoAllHudOnCanvas ? (
                  <div style={{ flexShrink: 0 }}>
                    <div
                      style={{
                        ...controlsSectionStyle,
                        border: "1px solid #554466",
                        marginTop: 0,
                        padding: 6,
                        boxSizing: "border-box",
                      }}
                    >
                      <div style={{ ...controlsSectionLabelStyle, color: "#ccb8ff" }}>2D mini map</div>
                      {mazeMapView === "iso" ? (
                        <MobileLandscapeMinimapOrbitWrap
                          mazeIsoViewRef={mazeIsoViewRef}
                          diameter={ISO_HUD_MOVE_RING_PX}
                          lab={lab}
                          currentPlayer={currentPlayer}
                          playerFacing={playerFacing}
                          fogIntensityMap={fogIntensityMap}
                          playerCells={playerCells}
                          isoMiniMapZoom={isoMiniMapZoom}
                          setIsoMiniMapZoom={setIsoMiniMapZoom}
                          isoMiniMapPinchStartRef={isoMiniMapPinchStartRef}
                          onOpenGrid={switchToGridAndFocusCurrentPlayer}
                          bearingAngleDeg={isoCameraBearingDeg}
                        />
                      ) : (
                        <IsoHudMinimapCircle
                          diameter={ISO_HUD_MOVE_RING_PX}
                          lab={lab}
                          currentPlayer={currentPlayer}
                          playerFacing={playerFacing}
                          fogIntensityMap={fogIntensityMap}
                          playerCells={playerCells}
                          isoMiniMapZoom={isoMiniMapZoom}
                          setIsoMiniMapZoom={setIsoMiniMapZoom}
                          isoMiniMapPinchStartRef={isoMiniMapPinchStartRef}
                          onOpenGrid={switchToGridAndFocusCurrentPlayer}
                          playerCenteredRotate
                          bearingAngleDeg={isoCameraBearingDeg}
                        />
                      )}
                    </div>
                  </div>
                ) : null}
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    ...(desktopDockThreeColumn && lab
                      ? { flex: "1 1 0", minWidth: 200, maxWidth: 560, alignSelf: "stretch" }
                      : {}),
                  }}
                >
                  {bottomDockContextActive && !isMobile ? (
                    <div
                      style={{
                        ...controlsSectionStyle,
                        border: "1px solid #554466",
                        marginTop: 0,
                        alignItems: "stretch",
                        alignSelf: "stretch",
                        width: "100%",
                        maxHeight: "min(42vh, 320px)",
                        overflowY: "auto",
                        WebkitOverflowScrolling: "touch",
                      }}
                    >
                      <div style={{ ...controlsSectionLabelStyle, color: "#ccb8ff" }}>Action</div>
                      <IsoBottomContextPanels
                        teleportPickTimerModel={teleportPickTimerModel}
                        canOfferSlingshotDock={canOfferSlingshotDock}
                        catapultPicker={catapultPicker}
                        teleportPicker={teleportPicker}
                        magicPortalReady={magicPortalReady}
                        immersiveInventoryPick={immersiveInventoryPick}
                        showMoveGrid={showMoveGrid}
                        mazeMapView={mazeMapView}
                        catapultIsoPhase={catapultIsoPhase}
                        slingshotCellAvailable={slingshotCellAvailable}
                        cp={cp}
                        openSlingshotFromDock={openSlingshotFromDock}
                        catapultDragRef={catapultDragRef}
                        setCatapultMode={setCatapultMode}
                        setCatapultPicker={setCatapultPicker}
                        setCatapultDragOffset={setCatapultDragOffset}
                        setCatapultAimClient={setCatapultAimClient}
                        setCatapultIsoPhase={setCatapultIsoPhase}
                        manualTeleportPendingRef={manualTeleportPendingRef}
                        setTeleportPicker={setTeleportPicker}
                        handleTeleportSelect={handleTeleportSelect}
                        handleMagicPortalOpen={handleMagicPortalOpen}
                        setImmersiveInventoryPick={setImmersiveInventoryPick}
                        applyImmersiveInventoryPick={applyImmersiveInventoryPick}
                        immersiveApplyDisabled={immersiveApplyDisabled}
                      />
                    </div>
                  ) : (
                  <div style={{ ...controlsSectionStyle, border: "1px solid #554466", marginTop: 0 }}>
                    <div style={{ ...controlsSectionLabelStyle, color: "#ccb8ff" }}>Bomb &amp; artifacts</div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "row",
                        gap: 8,
                        overflowX: "auto",
                        paddingBottom: 4,
                        width: "100%",
                        WebkitOverflowScrolling: "touch",
                      }}
                    >
              {(cp?.bombs ?? 0) > 0 && (
                <button
                  type="button"
                  onClick={handleUseBomb}
                  disabled={bombUseDisabled}
                  style={{
                    ...buttonStyle,
                            flex: "0 0 auto",
                            display: "flex",
                            flexDirection: "column",
                    alignItems: "center",
                            gap: 4,
                            padding: "8px 12px",
                            borderRadius: 10,
                            border: "1px solid #444",
                            background: "rgba(255,136,68,0.2)",
                            color: "#ddd",
                            cursor: "pointer",
                            minWidth: BOTTOM_DOCK_INVENTORY_CHIP_MIN_WIDTH,
                    opacity: bombUseDisabled ? 0.45 : 1,
                  }}
                          title={
                            combatState ? "Explode 3×3 to clear monster (no move cost)" : "Explode 3×3 area (uses 1 move)"
                          }
                        >
                          <BottomDockInventoryIcon variant="bomb" />
                          <span style={{ fontSize: "0.7rem", fontWeight: 700 }}>Bomb ×{cp?.bombs ?? 0}</span>
                </button>
              )}
              {STORED_ARTIFACT_ORDER.map((kind) => {
                const n = storedArtifactCount(cp, kind);
                if (n <= 0) return null;
                const mazeOnlyLocked = inCombatDock && isStoredArtifactMazePhaseOnly(kind);
                const combatOnlyLocked = !inCombatDock && isStoredArtifactCombatPhaseOnly(kind);
                const healFull = kind === "healing" && (cp?.hp ?? DEFAULT_PLAYER_HP) >= DEFAULT_PLAYER_HP;
                const cantReveal = kind === "reveal" && peekRevealBatchSize(lab, totalDiamondsDock) <= 0;
                const disabled = !cp || mazeOnlyLocked || combatOnlyLocked || healFull || cantReveal;
                return (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => handleUseArtifact(kind)}
                    disabled={disabled}
                    style={{
                      ...buttonStyle,
                              flex: "0 0 auto",
                              display: "flex",
                              flexDirection: "column",
                      alignItems: "center",
                              gap: 4,
                              padding: "8px 12px",
                              borderRadius: 10,
                              border: "1px solid #444",
                              background: "rgba(42,42,53,0.95)",
                              color: "#ddd",
                              cursor: "pointer",
                              minWidth: BOTTOM_DOCK_INVENTORY_CHIP_MIN_WIDTH,
                      opacity: disabled ? 0.45 : 1,
                    }}
                    title={
                              `${STORED_ARTIFACT_TITLE[kind]} ×${n} — ` +
                              (mazeOnlyLocked
                        ? `${STORED_ARTIFACT_TOOLTIP[kind]} (not during combat)`
                        : combatOnlyLocked
                          ? `${STORED_ARTIFACT_TOOLTIP[kind]} (use during combat)`
                        : healFull
                          ? "Already at full HP"
                          : cantReveal
                            ? "Nothing hidden to reveal right now"
                                    : STORED_ARTIFACT_TOOLTIP[kind])
                            }
                          >
                            <BottomDockInventoryIcon variant={storedArtifactIconVariant(kind)} />
                            <span style={{ fontSize: "0.7rem", fontWeight: 700 }}>
                              {STORED_ARTIFACT_TITLE[kind]} ×{n}
                    </span>
                  </button>
                );
              })}
                      {(cp?.bombs ?? 0) <= 0 &&
                        !STORED_ARTIFACT_ORDER.some((k) => storedArtifactCount(cp, k) > 0) && (
                          <div
                            style={{
                              color: "#666",
                              fontSize: "0.75rem",
                              width: "100%",
                              textAlign: "center",
                              alignSelf: "center",
                            }}
                          >
                            None
                          </div>
              )}
            </div>
                  </div>
                  )}
                  {desktopDockThreeColumn && lab ? (
                    <div
                      style={{
                        ...controlsSectionStyle,
                        border: "1px solid #3a3d52",
                        marginTop: 0,
                        padding: "8px 10px",
                      }}
                    >
                      <div style={{ ...controlsSectionLabelStyle, color: "#9aa4b8", fontSize: "0.68rem" }}>
                        Turn
                      </div>
                      <div style={{ display: "flex", gap: 8, width: "100%", marginTop: 6 }}>
                    <button
                      type="button"
                      onClick={scrollToCurrentPlayerOnMap}
                      disabled={
                        winner !== null ||
                        !lab ||
                        (lab.eliminatedPlayers?.has(currentPlayer) ?? false)
                      }
                      style={{
                        ...buttonStyle,
                        ...secondaryButtonStyle,
                        flex: 1,
                        minWidth: 0,
                        fontSize: "0.85rem",
                        padding: "8px 12px",
                      }}
                      title="Scroll the maze so the active player’s cell is centered"
                    >
                      Locate player
                    </button>
                    <button
                      type="button"
                      onClick={endTurn}
                      className="secondary"
                          disabled={
                            winner !== null ||
                            !!catapultPicker ||
                            !!teleportPicker ||
                            !!combatState ||
                            !!pendingCombatOffer
                          }
                      style={{
                        ...buttonStyle,
                        ...secondaryButtonStyle,
                        flex: 1,
                        minWidth: 0,
                        fontSize: "0.85rem",
                        padding: "8px 12px",
                      }}
                      title={
                        combatState ? "Cannot end turn during combat — fight or run first" : undefined
                      }
                    >
                      End turn
                    </button>
                  </div>
                </div>
                  ) : (
                    <div style={{ display: "flex", gap: 8, width: "100%" }}>
                      <button
                        type="button"
                        onClick={scrollToCurrentPlayerOnMap}
                        disabled={
                          winner !== null ||
                          !lab ||
                          (lab.eliminatedPlayers?.has(currentPlayer) ?? false)
                        }
                    style={{
                          ...buttonStyle,
                          ...secondaryButtonStyle,
                          flex: 1,
                          minWidth: 0,
                          fontSize: "0.85rem",
                          padding: "8px 12px",
                        }}
                        title="Scroll the maze so the active player’s cell is centered"
                      >
                        Locate player
                      </button>
                      <button
                        type="button"
                        onClick={endTurn}
                        className="secondary"
                        disabled={
                          winner !== null ||
                          !!catapultPicker ||
                          !!teleportPicker ||
                          !!combatState ||
                          !!pendingCombatOffer
                        }
                        style={{
                          ...buttonStyle,
                          ...secondaryButtonStyle,
                          flex: 1,
                          minWidth: 0,
                          fontSize: "0.85rem",
                          padding: "8px 12px",
                        }}
                        title={
                          combatState ? "Cannot end turn during combat — fight or run first" : undefined
                        }
                      >
                        End turn
                      </button>
                    </div>
                  )}
                </div>
                {desktopDockThreeColumn && lab && !desktopWindowedIsoAllHudOnCanvas ? (
                  <div style={{ flexShrink: 0 }}>
                      <div
                        style={{
                          ...controlsSectionStyle,
                        border: "1px solid #554466",
                          marginTop: 0,
                          padding: 6,
                        boxSizing: "border-box",
                      }}
                    >
                      <div style={{ ...controlsSectionLabelStyle, color: "#ccb8ff" }}>Move</div>
                      <IsoHudJoystickMoveRing
                        diameter={ISO_HUD_MOVE_RING_PX}
                        dimPadOverMinimap={false}
                        placement="standalone"
                        canMoveUp={canMoveUp}
                        canMoveDown={canMoveDown}
                        canMoveLeft={canMoveLeft}
                        canMoveRight={canMoveRight}
                        relativeForward={relativeForward}
                        relativeBackward={relativeBackward}
                        relativeLeft={relativeLeft}
                        relativeRight={relativeRight}
                        doMove={doMoveStrafe}
                        scrollToCurrentPlayerOnMap={scrollToCurrentPlayerOnMap}
                        focusDisabled={
                          winner !== null || !lab || (lab.eliminatedPlayers?.has(currentPlayer) ?? false)
                        }
                      />
                    </div>
                  </div>
                ) : (((lab && mazeMapView === "iso") || (showMoveGrid && lab)) &&
                    !desktopWindowedIsoAllHudOnCanvas) ? (
                  <div
                              style={{
                                display: "flex",
                      flexDirection: "row",
                      alignItems: "stretch",
                      gap: 8,
                      flexShrink: 0,
                      alignSelf: splitIsoHudOppositeScreen && !isMobile ? "stretch" : "flex-start",
                      width: splitIsoHudOppositeScreen && !isMobile ? "100%" : undefined,
                      maxWidth: splitIsoHudOppositeScreen && !isMobile ? "min(560px, 100%)" : undefined,
                    }}
                  >
                      <div
                        style={{
                          ...controlsSectionStyle,
                          marginTop: 0,
                          padding: 6,
                          flexShrink: 0,
                        width: splitIsoHudOppositeScreen && !isMobile ? "100%" : undefined,
                        boxSizing: "border-box",
                      }}
                    >
                      <div style={controlsSectionLabelStyle}>
                        {mazeMapView === "iso"
                          ? splitIsoHudOppositeScreen
                            ? "2D mini map · Move"
                            : "2D mini map & move"
                          : "Move"}
                      </div>
                      {splitIsoHudOppositeScreen && !isMobile ? (
                        <div
                          style={{
                              display: "flex",
                            flexDirection: "row",
                            justifyContent: "space-between",
                              alignItems: "center",
                            gap: 16,
                            width: "100%",
                          }}
                        >
                          {mazeMapView === "iso" ? (
                            <MobileLandscapeMinimapOrbitWrap
                              mazeIsoViewRef={mazeIsoViewRef}
                              diameter={ISO_HUD_MOVE_RING_PX}
                              lab={lab!}
                              currentPlayer={currentPlayer}
                              playerFacing={playerFacing}
                              fogIntensityMap={fogIntensityMap}
                              playerCells={playerCells}
                              isoMiniMapZoom={isoMiniMapZoom}
                              setIsoMiniMapZoom={setIsoMiniMapZoom}
                              isoMiniMapPinchStartRef={isoMiniMapPinchStartRef}
                              onOpenGrid={switchToGridAndFocusCurrentPlayer}
                              bearingAngleDeg={isoCameraBearingDeg}
                            />
                          ) : (
                            <div style={{ flex: 1, minWidth: 0 }} />
                          )}
                          <IsoHudJoystickMoveRing
                            diameter={ISO_HUD_MOVE_RING_PX}
                            dimPadOverMinimap={false}
                            placement="standalone"
                            canMoveUp={canMoveUp}
                            canMoveDown={canMoveDown}
                            canMoveLeft={canMoveLeft}
                            canMoveRight={canMoveRight}
                            relativeForward={relativeForward}
                            relativeBackward={relativeBackward}
                            relativeLeft={relativeLeft}
                            relativeRight={relativeRight}
                            doMove={doMoveStrafe}
                            scrollToCurrentPlayerOnMap={scrollToCurrentPlayerOnMap}
                            focusDisabled={
                              winner !== null || !lab || (lab.eliminatedPlayers?.has(currentPlayer) ?? false)
                            }
                          />
                        </div>
                      ) : (
                        <CircularIsoMinimapMoveHud
                          diameter={ISO_HUD_MOVE_RING_PX}
                          showMinimap={!!lab && mazeMapView === "iso"}
                          lab={lab!}
                          currentPlayer={currentPlayer}
                          playerFacing={playerFacing}
                          fogIntensityMap={fogIntensityMap}
                          playerCells={playerCells}
                          isoMiniMapZoom={isoMiniMapZoom}
                          setIsoMiniMapZoom={setIsoMiniMapZoom}
                          isoMiniMapPinchStartRef={isoMiniMapPinchStartRef}
                          onOpenGrid={switchToGridAndFocusCurrentPlayer}
                          canMoveUp={canMoveUp}
                          canMoveDown={canMoveDown}
                          canMoveLeft={canMoveLeft}
                          canMoveRight={canMoveRight}
                          relativeForward={relativeForward}
                          relativeBackward={relativeBackward}
                          relativeLeft={relativeLeft}
                          relativeRight={relativeRight}
                          doMove={doMoveStrafe}
                          scrollToCurrentPlayerOnMap={scrollToCurrentPlayerOnMap}
                          focusDisabled={
                            winner !== null || !lab || (lab.eliminatedPlayers?.has(currentPlayer) ?? false)
                          }
                          bearingAngleDeg={isoCameraBearingDeg}
                          mazeIsoViewRef={mazeIsoViewRef}
                        />
                      )}
                    </div>
                  </div>
                ) : null}
        </div>
            )}

            {isMobile && (
              <div style={{ display: "flex", gap: 8, marginTop: 8, width: "100%" }}>
        <button
                  type="button"
                  onClick={scrollToCurrentPlayerOnMap}
                  disabled={
                    winner !== null ||
                    !lab ||
                    (lab.eliminatedPlayers?.has(currentPlayer) ?? false)
                  }
                  style={{
                    ...buttonStyle,
                    ...secondaryButtonStyle,
                    flex: 1,
                    minWidth: 0,
                    fontSize: "0.82rem",
                    padding: "8px 10px",
                  }}
                  title="Scroll the maze so the active player’s cell is centered"
                >
                  Locate
                </button>
                <button
                  type="button"
          onClick={endTurn}
          className="secondary"
                  disabled={
                    winner !== null ||
                    !!catapultPicker ||
                    !!teleportPicker ||
                    !!combatState ||
                    !!pendingCombatOffer
                  }
                  style={{
                    ...buttonStyle,
                    ...secondaryButtonStyle,
                    flex: 1,
                    minWidth: 0,
                    fontSize: "0.82rem",
                    padding: "8px 10px",
                  }}
                  title={combatState ? "Cannot end turn during combat — fight or run first" : undefined}
        >
          End turn
        </button>
              </div>
            )}
          </>
        )}
        {error && <div className="error" style={errorStyle}>{error}</div>}
        </div>
      ) : (
        error ? (
          <div className="error" style={errorStyle}>
            {error}
          </div>
        ) : null
      )}
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
          <FullscreenPortal target={fsPortalTarget}>
          <div
            style={{
              ...movementDiceModalOverlayStyle,
              ...(isLandscapeCompact
                ? { alignItems: "stretch", justifyContent: "center" as const }
                : {}),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                ...movementDiceModalPanelStyle,
                alignSelf: isLandscapeCompact ? "stretch" : "center",
                width: isLandscapeCompact
                  ? `min(${MOVEMENT_DICE_MODAL_MAX_W}px, calc(100vw - 16px))`
                  : `min(96vw, ${MOVEMENT_DICE_MODAL_MAX_W}px)`,
                maxHeight:
                  "calc(100dvh - max(16px, env(safe-area-inset-top, 0px) + env(safe-area-inset-bottom, 0px)))",
                height:
                  "calc(100dvh - max(16px, env(safe-area-inset-top, 0px) + env(safe-area-inset-bottom, 0px)))",
                overflowY: "auto",
                WebkitOverflowScrolling: "touch",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 style={movementDiceModalTitleStyle}>
                {playerNames[currentPlayer] ?? `Player ${currentPlayer + 1}`} — Roll for moves
              </h3>
              <p style={movementDiceModalHintStyle}>
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
                  flex: 1,
                  minHeight: MOVEMENT_DICE_VIEWPORT_MIN_H,
                  borderRadius: 14,
                  overflow: "hidden",
                  border: `2px solid ${START_MENU_BORDER_MUTE}`,
                  boxSizing: "border-box",
                  background: "#10080a",
                  boxShadow: "inset 0 0 24px rgba(40, 12, 10, 0.5)",
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
                className="start-menu-cta"
                onClick={() => !rolling && diceRef.current?.roll()}
                disabled={rolling}
                style={{
                  ...startButtonStyle,
                  alignSelf: "center",
                  marginTop: "clamp(12px, 2dvh, 20px)",
                  flexShrink: 0,
                  padding: "14px 40px",
                  fontSize: "1.08rem",
                  fontWeight: 800,
                  minWidth: 220,
                  borderRadius: 10,
                }}
              >
                {rolling ? "Rolling…" : "Roll dice"}
              </button>
            </div>
          </div>
          </FullscreenPortal>
        )}

      {winner !== null && (
        <FullscreenPortal target={fsPortalTarget}>
        <div
          style={{
            ...gameOverOverlayStyle,
            ...(mazeMapView === "iso"
              ? {
                  background: "rgba(5,6,14,0.78)",
                  backdropFilter: "blur(14px)",
                  WebkitBackdropFilter: "blur(14px)",
                }
              : {}),
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            style={{
              ...gameOverModalStyle,
              ...(mazeMapView === "iso"
                ? {
                    maxWidth: 440,
                    border: "1px solid rgba(0,255,136,0.38)",
                    boxShadow:
                      "0 0 52px rgba(0,255,136,0.18), 0 28px 72px rgba(0,0,0,0.72), inset 0 1px 0 rgba(255,255,255,0.06)",
                    background: "linear-gradient(165deg, rgba(24,26,38,0.98) 0%, rgba(12,13,22,0.99) 100%)",
                  }
                : {}),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={gameOverTitleStyle}>
              {winner >= 0 ? "🏆 Victory!" : "💀 Game Over"}
            </h2>
            {mazeMapView === "iso" && (
              <p
                style={{
                  margin: "-0.35rem 0 0.85rem 0",
                  fontSize: "0.72rem",
                  textAlign: "center",
                  color: "#7a8a9a",
                  letterSpacing: "0.04em",
                  textTransform: "uppercase" as const,
                }}
              >
                3D view
              </p>
            )}
            <p style={{ ...gameOverResultStyle, color: winner >= 0 ? "#00ff88" : "#ff6666" }}>
              {winner >= 0
                ? `${playerNames[winner] ?? `Player ${winner + 1}`} wins!`
                : gameOverReason === "dracula"
                  ? "Dracula has slain you — the labyrinth claims another soul."
                  : "Monsters win!"}
            </p>
            {winner !== null && winner < 0 ? (
              <p
                style={{
                  margin: "0 0 1.25rem 0",
                  fontSize: "0.95rem",
                  textAlign: "center",
                  color: "#8e9aaa",
                  lineHeight: 1.5,
                }}
              >
                {gameOverReason === "dracula"
                  ? "There is no respawn from Dracula's attack. Use Restart Game to begin a fresh maze."
                  : "Use Restart Game to try again."}
              </p>
            ) : null}
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
            <button
              type="button"
              onClick={() => newGame({ initSource: "game_over_restart" })}
              style={gameOverRestartButtonStyle}
            >
              Restart Game
            </button>
          </div>
        </div>
        </FullscreenPortal>
      )}
    </div>
  );
}

const HEADER_HEIGHT = 64;
/** Above ISO immersive fallback (ISO_IMMERSIVE_Z) so combat / roll UI stays visible. */
const COMBAT_MODAL_Z = 10090;
/** Above combat overlay so menu / mobile backdrop work when combat is closed; settings use SETTINGS_MODAL_Z */
const HEADER_Z_INDEX = 1300;
/** Game setup — above immersive menu dropdown (ISO_IMMERSIVE_HUD_Z + 70) */
const SETTINGS_MODAL_Z = 10150;

const gameOverOverlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.8)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: GAME_OVER_OVERLAY_Z,
  boxSizing: "border-box",
  paddingLeft: "max(12px, env(safe-area-inset-left, 0px))",
  paddingRight: "max(12px, env(safe-area-inset-right, 0px))",
  paddingTop: "max(12px, env(safe-area-inset-top, 0px))",
  paddingBottom: "max(12px, env(safe-area-inset-bottom, 0px))",
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
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  width: "100%",
  maxWidth: "100%",
  height: "100dvh",
  minHeight: "100vh",
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
  zIndex: HEADER_Z_INDEX,
};

/** Title label image (`GAME_TITLE_LABEL_SRC`) — scaled for header bar */
const headerTitleWrapStyle: React.CSSProperties = {
  margin: 0,
  lineHeight: 0,
  display: "flex",
  alignItems: "center",
};

const headerLogoImgStyle: React.CSSProperties = {
  width: "auto",
  height: "auto",
  display: "block",
  objectFit: "contain",
  objectPosition: "left center",
  filter: "drop-shadow(0 4px 22px rgba(0,0,0,0.9))",
};

const headerButtonStyle: React.CSSProperties = {
  padding: "0.4rem 0.8rem",
  fontSize: "0.85rem",
};

/** Header ☰ / Menu — matches start-menu ember / title reds */
const headerMenuTriggerStyle: React.CSSProperties = {
  fontFamily: "inherit",
  background: START_MENU_CTRL_BG,
  color: "#ecc0b0",
  border: `1px solid ${START_MENU_BORDER_MUTE}`,
  borderRadius: 8,
  cursor: "pointer",
};

/** Mobile / desktop header dropdown (role="menu") */
const headerDropdownPanelStyle: React.CSSProperties = {
  padding: "12px 14px",
  background: "rgba(18, 8, 10, 0.97)",
  border: `1px solid ${START_MENU_BORDER}`,
  borderRadius: 10,
  boxShadow: "0 12px 40px rgba(0,0,0,0.55), 0 0 28px rgba(142, 34, 21, 0.22)",
  zIndex: HEADER_Z_INDEX + 2,
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const headerDropdownMutedStyle: React.CSSProperties = {
  color: "#9a7268",
};

const headerDropdownBodyStyle: React.CSSProperties = {
  fontSize: "0.8rem",
  color: "#d8c8c0",
  lineHeight: 1.45,
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const headerDropdownSecondaryBtnStyle: React.CSSProperties = {
  ...headerButtonStyle,
  width: "100%",
  justifyContent: "center",
  display: "flex",
  fontFamily: "inherit",
  background: START_MENU_CTRL_BG,
  color: "#ecc0b0",
  border: `1px solid ${START_MENU_BORDER_MUTE}`,
  borderRadius: 8,
  cursor: "pointer",
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

const startMenuLoadingInnerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 18,
};

const startMenuLoadingTextStyle: React.CSSProperties = {
  margin: 0,
  color: "#c9a090",
  fontSize: "0.82rem",
  letterSpacing: "0.35em",
  textTransform: "uppercase",
  fontFamily: "system-ui, sans-serif",
};

const startModalOverlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  backgroundColor: "#050508",
  backgroundImage: `linear-gradient(90deg, rgba(5,3,6,0.96) 0%, rgba(8,5,9,0.88) min(44vw, 540px), rgba(10,6,10,0.42) 70%, rgba(4,3,5,0.72) 100%), url("${START_MENU_COVER_BG}")`,
  backgroundSize: "cover, cover",
  backgroundPosition: "center, 68% center",
  backgroundRepeat: "no-repeat, no-repeat",
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
  background: "rgba(18, 8, 10, 0.88)",
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
  padding: "2.5rem 2.75rem",
  borderRadius: 14,
  border: `1px solid ${START_MENU_BORDER}`,
  boxShadow: `0 16px 56px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255, 152, 103, 0.12), 0 0 36px rgba(142, 34, 21, 0.35)`,
  minWidth: 0,
  maxWidth: 620,
  width: "min(calc(100vw - 24px), 620px)",
  boxSizing: "border-box",
  margin: 0,
};

const startModalTitleWrapStyle: React.CSSProperties = {
  margin: "0 0 0.45rem 0",
  textAlign: "center",
};

const startModalSubtitleStyle: React.CSSProperties = {
  margin: "0 0 1.75rem 0",
  color: "#b8a298",
  fontSize: "1rem",
  textAlign: "center",
};

const startModalFormStyle: React.CSSProperties = {
  marginBottom: "1.5rem",
};

const startModalLabelStyle: React.CSSProperties = {
  color: "#c9a090",
  fontSize: "0.92rem",
  minWidth: 140,
};

const startModalLabelStyleMobile: React.CSSProperties = {
  color: "#c9a090",
  fontSize: "0.88rem",
  minWidth: 0,
  width: "100%",
};

const startModalSelectStyle: React.CSSProperties = {
  padding: "0.5rem 0.75rem",
  fontSize: "0.95rem",
  fontFamily: "inherit",
  background: START_MENU_CTRL_BG,
  border: `1px solid ${START_MENU_BORDER_MUTE}`,
  color: "#d8c8c0",
  borderRadius: 6,
  flex: 1,
};

const startModalInputStyle: React.CSSProperties = {
  padding: "0.5rem 0.75rem",
  fontSize: "0.95rem",
  fontFamily: "inherit",
  background: START_MENU_CTRL_BG,
  border: `1px solid ${START_MENU_BORDER_MUTE}`,
  color: "#d8c8c0",
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
  background: "linear-gradient(180deg, #f07852 0%, #9a2818 100%)",
  color: "#140605",
  border: "1px solid rgba(255, 160, 120, 0.35)",
  borderRadius: 8,
  cursor: "pointer",
  transition: "all 0.2s",
  boxShadow: "0 0 22px rgba(180, 50, 30, 0.45), inset 0 1px 0 rgba(255, 200, 170, 0.25)",
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
  zIndex: COMBAT_MODAL_Z,
  paddingLeft: "max(8px, env(safe-area-inset-left, 0px))",
  paddingRight: "max(8px, env(safe-area-inset-right, 0px))",
  paddingTop: "max(8px, env(safe-area-inset-top, 0px))",
  paddingBottom: "max(8px, env(safe-area-inset-bottom, 0px))",
  boxSizing: "border-box",
};

/** Movement roll — same full-viewport stack as combat (above header); mutually exclusive with combat UI */
const movementDiceModalOverlayStyle: React.CSSProperties = {
  ...combatModalOverlayStyle,
};

/** Large movement dice modal — wide panel + 3D viewport fills remaining height */
const MOVEMENT_DICE_MODAL_MIN_W = 520;
const MOVEMENT_DICE_MODAL_MAX_W = 720;
const MOVEMENT_DICE_VIEWPORT_MIN_H = 260;

const movementDiceModalPanelStyle: React.CSSProperties = {
  background: "linear-gradient(180deg, rgba(34, 16, 18, 0.98) 0%, rgba(12, 6, 8, 0.99) 100%)",
  padding: "clamp(0.75rem, 3dvh, 2rem) clamp(1.25rem, 4vw, 2.75rem)",
  borderRadius: 16,
  border: `2px solid ${START_MENU_BORDER}`,
  boxShadow: "0 0 44px rgba(142, 34, 21, 0.3), 0 20px 60px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255, 152, 103, 0.08)",
  display: "flex",
  flexDirection: "column",
  alignItems: "stretch",
  width: `min(96vw, ${MOVEMENT_DICE_MODAL_MAX_W}px)`,
  minWidth: `min(94vw, ${MOVEMENT_DICE_MODAL_MIN_W}px)`,
  maxWidth: MOVEMENT_DICE_MODAL_MAX_W,
  minHeight: 0,
  boxSizing: "border-box",
};

const movementDiceModalTitleStyle: React.CSSProperties = {
  margin: "0 0 0.35rem 0",
  color: START_MENU_ACCENT_BRIGHT,
  fontSize: "clamp(1.2rem, 3.2vw, 1.75rem)",
  fontWeight: 800,
  textAlign: "center",
  letterSpacing: "0.02em",
  flexShrink: 0,
};

const movementDiceModalHintStyle: React.CSSProperties = {
  margin: "0 0 0.75rem 0",
  color: "#b8a090",
  fontSize: "0.92rem",
  textAlign: "center",
  lineHeight: 1.4,
  flexShrink: 0,
};

const combatModalStyle: React.CSSProperties = {
  background: "linear-gradient(180deg, #1e1e2a 0%, #16161e 100%)",
  padding: "0.4rem clamp(0.4rem, 2vw, 0.65rem) 0.35rem",
  borderRadius: 16,
  border: "3px solid #ffcc00",
  boxShadow: "0 0 60px rgba(255,204,0,0.4), inset 0 0 40px rgba(0,0,0,0.3)",
  width: `min(${COMBAT_MODAL_WIDTH}px, calc(100vw - 16px))`,
  minWidth: 0,
  maxWidth: "100%",
  maxHeight: "calc(100dvh - 16px)",
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

/** Face-off grid — names above portraits, HP under portraits */
const combatModalVersusGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 28px minmax(0, 1fr)",
  gridTemplateRows: "minmax(20px, auto) minmax(18px, auto) minmax(180px, auto) auto minmax(10px, auto)",
  alignItems: "stretch",
  alignContent: "start",
  columnGap: 6,
  /** Vertical air between badge row ↔ names ↔ portraits ↔ HP (no margin on those cells — this is the only row spacing). */
  rowGap: 8,
  marginTop: 0,
  width: "100%",
  maxWidth: 480,
  marginLeft: "auto",
  marginRight: "auto",
  padding: "0 4px",
  overflow: "visible",
};

/** Landscape combat: face-off column + dice between portraits + HP + roll/run row */
const combatLandscapeFaceoffWrapStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: "min(920px, 100%)",
  marginLeft: "auto",
  marginRight: "auto",
  padding: "0 4px",
  display: "flex",
  flexDirection: "column",
  /** Extra air above HP bars + Roll/Run (pushes bottom UI down vs sprites) */
  gap: 14,
  boxSizing: "border-box",
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
  gap: 2,
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
  maxWidth: 300,
  flexShrink: 0,
  marginTop: 0,
  marginBottom: 0,
  padding: "2px 6px 4px",
  borderRadius: 8,
  border: "1px solid #00ff8866",
  background: "linear-gradient(180deg, rgba(0,40,30,0.55) 0%, rgba(10,25,20,0.9) 100%)",
  boxShadow: "0 0 12px rgba(0,255,136,0.12), inset 0 1px 0 rgba(255,255,255,0.04)",
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
  justifyContent: "flex-start",
  gap: 4,
};

const combatBonusLootTitleStyle: React.CSSProperties = {
  color: "#00ffcc",
  fontWeight: "bold",
  textAlign: "center",
  fontSize: "0.7rem",
  marginBottom: 0,
  lineHeight: 1.15,
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

const mazeViewToggleButtonStyle = (active: boolean): React.CSSProperties => ({
  ...mazeZoomButtonStyle,
  width: "auto",
  minWidth: 56,
  padding: "0 10px",
  fontSize: "0.72rem",
  fontWeight: 600,
  background: active ? "rgba(0,255,136,0.18)" : "#2a2a35",
  border: active ? "1px solid #00ff88" : "1px solid #444",
  color: active ? "#00ff88" : "#aaa",
});

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
  width: 40,
  height: 40,
  borderRadius: "50%",
  margin: "auto",
  opacity: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxSizing: "border-box",
  overflow: "hidden",
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

const teleportPickTimerPillStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "4px 10px",
  borderRadius: 8,
  fontSize: "0.72rem",
  fontWeight: 700,
  background: "rgba(58,32,96,0.92)",
  border: "1px solid rgba(196,156,255,0.45)",
  color: "#e8ddff",
  whiteSpace: "nowrap",
};

function TeleportPickTimerBadge({
  model,
  compact,
}: {
  model: { kind: "manual" } | { kind: "pending" } | { kind: "countdown"; seconds: number } | null;
  compact?: boolean;
}) {
  if (!model) return null;
  const style: React.CSSProperties = {
    ...teleportPickTimerPillStyle,
    ...(compact ? { fontSize: "0.65rem", padding: "3px 8px" } : {}),
  };
  if (model.kind === "manual") {
    return <span style={style}>No auto-pick — choose a cell or Random</span>;
  }
  if (model.kind === "pending") {
    return <span style={style}>Timer…</span>;
  }
  return (
    <span style={style}>
      Random in <strong style={{ color: "#ffb8e8" }}>{model.seconds}s</strong>
    </span>
  );
}

/** Slingshot / teleport / magic / immersive item consent — lives in the bottom dock in place of the artifact strip. */
function IsoBottomContextPanels({
  dense,
  teleportPickTimerModel,
  canOfferSlingshotDock,
  catapultPicker,
  teleportPicker,
  magicPortalReady,
  immersiveInventoryPick,
  showMoveGrid,
  mazeMapView,
  catapultIsoPhase,
  slingshotCellAvailable,
  cp,
  openSlingshotFromDock,
  onDismissContextPrompt,
  catapultDragRef,
  setCatapultMode,
  setCatapultPicker,
  setCatapultDragOffset,
  setCatapultAimClient,
  setCatapultIsoPhase,
  manualTeleportPendingRef,
  setTeleportPicker,
  handleTeleportSelect,
  handleMagicPortalOpen,
  setImmersiveInventoryPick,
  applyImmersiveInventoryPick,
  immersiveApplyDisabled,
}: {
  dense?: boolean;
  teleportPickTimerModel: { kind: "manual" } | { kind: "pending" } | { kind: "countdown"; seconds: number } | null;
  canOfferSlingshotDock: boolean;
  catapultPicker: { playerIndex: number; from: [number, number]; viaCharge?: boolean } | null;
  teleportPicker: { options: [number, number][] } | null;
  magicPortalReady: boolean;
  immersiveInventoryPick: MobileDockAction | null;
  showMoveGrid: boolean;
  mazeMapView: "grid" | "iso";
  catapultIsoPhase: "orient" | "pull";
  slingshotCellAvailable: boolean;
  cp: { catapultCharges?: number } | null | undefined;
  openSlingshotFromDock: () => void;
  /** Optional (e.g. mobile): “Not now” collapses dock / defers without acting. */
  onDismissContextPrompt?: () => void;
  catapultDragRef: MutableRefObject<{ startX: number; startY: number; cellX: number; cellY: number } | null>;
  setCatapultMode: (v: boolean) => void;
  setCatapultPicker: (v: null) => void;
  setCatapultDragOffset: (v: null) => void;
  setCatapultAimClient: (v: null) => void;
  setCatapultIsoPhase: (v: "orient" | "pull") => void;
  manualTeleportPendingRef: MutableRefObject<boolean>;
  setTeleportPicker: (v: null) => void;
  handleTeleportSelect: (x: number, y: number) => void;
  handleMagicPortalOpen: () => void;
  setImmersiveInventoryPick: (v: MobileDockAction | null) => void;
  applyImmersiveInventoryPick: () => void;
  immersiveApplyDisabled: boolean;
}) {
  const pad = dense ? "6px 8px" : "10px 12px";
  const titleFs = dense ? "0.62rem" : "0.68rem";
  const bodyFs = dense ? "0.68rem" : "0.78rem";
  const btnFs = dense ? "0.68rem" : "0.76rem";
  const cardRadius = dense ? 10 : 14;
  return (
    <>
      {canOfferSlingshotDock && !catapultPicker ? (
        <div
          style={{
            borderRadius: cardRadius,
            padding: pad,
            background: "linear-gradient(180deg, rgba(22,24,36,0.97) 0%, rgba(12,13,22,0.99) 100%)",
            border: "1px solid rgba(255,204,0,0.35)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
          }}
        >
          <div
            style={{
              fontSize: titleFs,
              fontWeight: 700,
              color: "#9aa0b8",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Slingshot
          </div>
          {!dense ? (
            <p style={{ margin: "6px 0 8px", fontSize: bodyFs, color: "#c8cdd8", lineHeight: 1.45 }}>
              {slingshotCellAvailable ? (
                <>
                  You are on a <strong style={{ color: "#ffcc66" }}>slingshot tile</strong>. Tap below when you are ready to aim.
                </>
              ) : (
                <>
                  Use a <strong style={{ color: "#ffcc66" }}>slingshot charge</strong> ({cp?.catapultCharges ?? 0} left) from your current tile.
                </>
              )}
            </p>
          ) : (
            <p style={{ margin: "4px 0 6px", fontSize: bodyFs, color: "#c8cdd8", lineHeight: 1.35 }}>
              {slingshotCellAvailable ? <>Slingshot tile — open aim when ready.</> : <>Charge ×{cp?.catapultCharges ?? 0} — aim from here.</>}
            </p>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: dense ? 6 : 8, marginTop: dense ? 4 : 6 }}>
          <button
            type="button"
            onClick={openSlingshotFromDock}
            style={{
              ...buttonStyle,
              alignSelf: "flex-start",
              background: "#1a3d2a",
              color: "#b8ffcc",
              border: "1px solid #00ff88",
              fontSize: dense ? "0.72rem" : "0.78rem",
              padding: dense ? "5px 10px" : "6px 12px",
            }}
          >
            Use slingshot
          </button>
            {onDismissContextPrompt ? (
              <button
                type="button"
                onClick={onDismissContextPrompt}
                style={{
                  ...buttonStyle,
                  ...secondaryButtonStyle,
                  fontSize: dense ? "0.66rem" : "0.74rem",
                  padding: dense ? "5px 10px" : "6px 12px",
                }}
              >
                Not now
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {catapultPicker ? (
        <div
          style={{
            borderRadius: cardRadius,
            padding: pad,
            background: "linear-gradient(180deg, rgba(22,24,36,0.97) 0%, rgba(12,13,22,0.99) 100%)",
            border: "1px solid rgba(255,204,0,0.35)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
          }}
        >
          <div
            style={{
              fontSize: titleFs,
              fontWeight: 700,
              color: "#9aa0b8",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Slingshot
          </div>
          {mazeMapView === "iso" && catapultIsoPhase === "orient" ? (
            <p style={{ margin: dense ? "4px 0" : "6px 0", fontSize: bodyFs, color: "#c8cdd8", lineHeight: 1.45 }}>
              <strong style={{ color: "#ffcc66" }}>Step 1 — Orient.</strong>{" "}
              {dense ? (
                <>Orbit the 3D view, then tap Ready to aim.</>
              ) : (
                <>Drag on the 3D maze (right mouse, trackpad, or minimap ring), then continue to step 2.</>
              )}
            </p>
          ) : mazeMapView === "iso" ? (
            <p style={{ margin: dense ? "4px 0" : "6px 0", fontSize: bodyFs, color: "#c8cdd8", lineHeight: 1.45 }}>
              <strong style={{ color: "#ffcc66" }}>Step 2 — Pull.</strong>{" "}
              {dense ? (
                <>Drag on 3D, release to fire.</>
              ) : (
                <>Drag on the 3D view opposite where you want to land, then release.</>
              )}
            </p>
          ) : (
            <p style={{ margin: dense ? "4px 0" : "6px 0", fontSize: bodyFs, color: "#c8cdd8", lineHeight: 1.45 }}>
              Drag on the <strong style={{ color: "#ffcc66" }}>grid</strong> from your tile to aim, then release.
            </p>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: dense ? 6 : 8, marginTop: dense ? 4 : 6 }}>
            {mazeMapView === "iso" && catapultIsoPhase === "orient" ? (
              <button
                type="button"
                onClick={() => {
                  catapultDragRef.current = null;
                  setCatapultDragOffset(null);
                  setCatapultAimClient(null);
                  setCatapultIsoPhase("pull");
                }}
                style={{
                  ...buttonStyle,
                  background: "#1a3d2a",
                  color: "#b8ffcc",
                  border: "1px solid #00ff88",
                  fontSize: btnFs,
                  padding: dense ? "5px 10px" : "6px 12px",
                }}
              >
                Ready to aim (step 2)
              </button>
            ) : null}
            {mazeMapView === "iso" && catapultIsoPhase === "pull" ? (
              <button
                type="button"
                onClick={() => {
                  catapultDragRef.current = null;
                  setCatapultDragOffset(null);
                  setCatapultAimClient(null);
                  setCatapultIsoPhase("orient");
                }}
                style={{
                  ...buttonStyle,
                  background: "#2a2830",
                  color: "#ccc",
                  border: "1px solid #666",
                  fontSize: dense ? "0.66rem" : "0.74rem",
                  padding: dense ? "5px 8px" : "6px 10px",
                }}
              >
                Adjust camera (step 1)
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setCatapultMode(false);
                setCatapultPicker(null);
                setCatapultDragOffset(null);
              }}
              style={{
                ...buttonStyle,
                background: "#664400",
                color: "#ffeecc",
                border: "1px solid #ffcc00",
                fontSize: btnFs,
                padding: dense ? "5px 10px" : "6px 12px",
              }}
            >
              Cancel slingshot
            </button>
          </div>
        </div>
      ) : null}
      {teleportPicker ? (
        <div
          style={{
            borderRadius: cardRadius,
            padding: pad,
            background: "linear-gradient(180deg, rgba(22,24,36,0.97) 0%, rgba(12,13,22,0.99) 100%)",
            border: "1px solid rgba(170,102,255,0.35)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
          }}
        >
          <div
            style={{
              fontSize: titleFs,
              fontWeight: 700,
              color: "#9aa0b8",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Teleport
          </div>
          <p style={{ margin: dense ? "4px 0 6px" : "6px 0 8px", fontSize: bodyFs, color: "#c8cdd8", lineHeight: 1.45 }}>
            {dense ? (
              <>Tap highlight or Random.</>
            ) : (
              <>
                Tap a highlighted cell, or <strong style={{ color: "#aa66ff" }}>Random</strong>.
              </>
            )}
          </p>
          <div style={{ marginBottom: dense ? 6 : 8 }}>
            <TeleportPickTimerBadge model={teleportPickTimerModel} compact={dense} />
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: dense ? 6 : 8 }}>
            <button
              type="button"
              onClick={() => {
                manualTeleportPendingRef.current = false;
                setTeleportPicker(null);
              }}
              style={{ ...buttonStyle, background: "#664400", fontSize: btnFs, padding: dense ? "5px 10px" : "6px 12px" }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                const opts = teleportPicker.options;
                if (opts.length === 0) return;
                const pick = opts[Math.floor(Math.random() * opts.length)]!;
                handleTeleportSelect(pick[0], pick[1]);
              }}
              style={{
                ...buttonStyle,
                background: "#2a2048",
                color: "#e8ddff",
                border: "1px solid #8866cc",
                fontSize: btnFs,
                padding: dense ? "5px 10px" : "6px 12px",
              }}
            >
              Random destination
            </button>
          </div>
        </div>
      ) : null}
      {magicPortalReady && !teleportPicker ? (
        <div
          style={{
            borderRadius: cardRadius,
            padding: pad,
            background: "linear-gradient(180deg, rgba(22,24,36,0.97) 0%, rgba(12,13,22,0.99) 100%)",
            border: "1px solid rgba(170,102,255,0.35)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
          }}
        >
          <div
            style={{
              fontSize: titleFs,
              fontWeight: 700,
              color: "#9aa0b8",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Magic cell
          </div>
          {!dense ? (
            <p style={{ margin: "6px 0 8px", fontSize: bodyFs, color: "#c8cdd8", lineHeight: 1.45 }}>
              Standing on a magic portal. After you consent, the teleport picker opens; in <strong style={{ color: "#c49cff" }}>3D</strong>, purple
              beacons show valid destinations.
            </p>
          ) : (
            <p style={{ margin: "4px 0 6px", fontSize: bodyFs, color: "#c8cdd8", lineHeight: 1.35 }}>
              Magic portal — consent to open picker (3D: purple beacons).
            </p>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: dense ? 6 : 8, marginTop: dense ? 4 : 6 }}>
          <button
            type="button"
            onClick={handleMagicPortalOpen}
            style={{
              ...buttonStyle,
              ...secondaryButtonStyle,
              alignSelf: "flex-start",
              fontSize: dense ? "0.72rem" : "0.78rem",
              padding: dense ? "5px 10px" : "6px 12px",
            }}
          >
            Use magic portal
          </button>
            {onDismissContextPrompt ? (
              <button
                type="button"
                onClick={onDismissContextPrompt}
                style={{
                  ...buttonStyle,
                  background: "#2a2830",
                  color: "#aaa",
                  border: "1px solid #555",
                  fontSize: dense ? "0.66rem" : "0.74rem",
                  padding: dense ? "5px 10px" : "6px 12px",
                }}
              >
                Not now
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {immersiveInventoryPick !== null && showMoveGrid ? (
        <div
          style={{
            borderRadius: cardRadius,
            padding: pad,
            background: "linear-gradient(180deg, rgba(22,24,36,0.97) 0%, rgba(12,13,22,0.99) 100%)",
            border: "1px solid rgba(0,255,136,0.22)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span style={{ fontSize: dense ? "0.76rem" : "0.85rem", fontWeight: 700, color: "#00ff88" }}>
              {immersiveInventoryPick === "bomb"
                ? "Bomb"
                : immersiveInventoryPick === "catapultCharge"
                  ? "Slingshot charge"
                  : STORED_ARTIFACT_TITLE[immersiveInventoryPick]}
            </span>
            <button
              type="button"
              onClick={() => setImmersiveInventoryPick(null)}
              style={{
                ...secondaryButtonStyle,
                padding: dense ? "3px 8px" : "4px 10px",
                fontSize: dense ? "0.62rem" : "0.7rem",
                border: "1px solid #555",
                background: "#2a2a35",
                color: "#aaa",
              }}
            >
              Close
            </button>
          </div>
          {!dense ? (
            <p style={{ margin: "6px 0 8px", fontSize: "0.76rem", color: "#a8aeb8", lineHeight: 1.5 }}>
              {immersiveInventoryPick === "bomb"
                ? "Explodes a 3×3 area on the map (uses 1 move while not in combat)."
                : immersiveInventoryPick === "catapultCharge"
                  ? "Spend one charge to open slingshot aim from your current tile (no catapult cell required)."
                  : STORED_ARTIFACT_TOOLTIP[immersiveInventoryPick]}
            </p>
          ) : (
            <p style={{ margin: "4px 0 6px", fontSize: "0.65rem", color: "#a8aeb8", lineHeight: 1.4 }}>
              {immersiveInventoryPick === "bomb"
                ? "3×3 blast (1 move)."
                : immersiveInventoryPick === "catapultCharge"
                  ? "Opens slingshot from here."
                  : STORED_ARTIFACT_TOOLTIP[immersiveInventoryPick]}
            </p>
          )}
          <button
            type="button"
            onClick={applyImmersiveInventoryPick}
            disabled={immersiveApplyDisabled}
            style={{
              ...buttonStyle,
              alignSelf: "flex-start",
              opacity: immersiveApplyDisabled ? 0.45 : 1,
              fontSize: dense ? "0.72rem" : "0.78rem",
              padding: dense ? "5px 12px" : "6px 14px",
            }}
          >
            Use{" "}
            {immersiveInventoryPick === "bomb"
              ? "bomb"
              : immersiveInventoryPick === "catapultCharge"
                ? "slingshot"
                : STORED_ARTIFACT_TITLE[immersiveInventoryPick]}
          </button>
        </div>
      ) : null}
    </>
  );
}

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
