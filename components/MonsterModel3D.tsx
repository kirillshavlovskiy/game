"use client";

import React, {
  Component,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { Canvas, invalidate, useThree, useFrame } from "@react-three/fiber";
import { Center, OrbitControls, useAnimations, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { MonsterType } from "@/lib/labyrinth";
import type { StrikeTarget } from "@/lib/combatSystem";
import type { Monster3DSpriteState } from "@/lib/monsterModels3d";
import { rowMonsterHitsPlayer, rowPlayerHitsMonster } from "@/lib/combat3dContact";
import {
  glbSlugFromPathOrUrl,
  isMergedMeshyStrikePortraitType,
  isMeshyPostAttackCalmState,
  resolveMonsterAnimationClipName,
  resolvePlayerAnimationClipName,
  resolveWalkFightBackClipName,
} from "@/lib/monsterModels3d";

/**
 * World X half-separation (|playerX| = |monsterX|). Looping stances lock armature root; one-shot attacks
 * keep baked root motion. Spell/jump clips (Jumping_Punch, spins) travel forward in authoring space —
 * if this half-gap is too large, the swing peaks short of the defender; too small, overshoot / interpenetrate.
 * Tuned against merged player + monster GLBs in the face-off box.
 */
const COMBAT_IDLE_SEPARATION_HALF = 1.38;
/** Same half used during strike-pick / dice roll — kept for **all** resolved-hit face-offs so jump/skill clips align with contact (variant-tiny halves read as long-range hits). */
const COMBAT_STRIKE_PICK_SEPARATION_HALF = 0.92;
/**
 * Standing attacker vs **knockdown** defender — tighter than `COMBAT_STRIKE_PICK_SEPARATION_HALF` so the blow reads on the
 * downed figure (merged rigs are `Center`‑ed; 0.92 leaves too much air for knockdown clips).
 */
const COMBAT_ATTACK_VS_KNOCKDOWN_HALF = 0.42;
function combatContactHalfXForVariant(variant: "spell" | "skill" | "light" | undefined): number {
  const v = variant ?? "light";
  /** Wider spread so jump/spell vs leg reads clearly; spell ~cheek‑to‑cheek for merged GLBs. */
  if (v === "spell") return 0.06;
  if (v === "skill") return 0.28;
  return 0.38;
}

/**
 * Strike-contact spacing uses tiny half-widths so jump/spell clips reach the defender, but each glTF is `Center`‑ed on
 * its bbox — centers only ~0.12 apart (2×0.06 spell) stack both rigs in the same volume. Floor keeps a readable gap;
 * forward root motion on attacks still closes distance in motion.
 */
const COMBAT_CONTACT_HALF_X_MIN = 0.38;

/** Exposed for `/monster-3d-animations` contact lab — same math as `CombatScene3D` face-off X. */
export function combatFaceOffPositions(args: {
  /** When true, same half as exchange spacing (kept for API compat — spacing is always strike-pick style for hit beats). */
  strikePickActive: boolean;
  isContactExchange: boolean;
  /** 0 = idle spacing, 1 = closed to strike range while dice roll */
  rollingApproachBlend: number;
  playerVisualState: Monster3DSpriteState;
  monsterVisualState: Monster3DSpriteState;
  playerAttackVariant?: "spell" | "skill" | "light";
  draculaAttackVariant?: "spell" | "skill" | "light";
}): { playerPosX: number; monsterPosX: number } {
  const {
    strikePickActive: _strikePickActive,
    isContactExchange,
    rollingApproachBlend,
    playerVisualState,
    monsterVisualState,
    playerAttackVariant,
    draculaAttackVariant,
  } = args;
  void _strikePickActive;
  /**
   * Old logic only used tight spacing when `isContactExchange` (both sides in hit/attack/knockdown/angry).
   * While the attacker plays `attack`, the defender is often still calm `idle`/`hunt` — we stayed on idle
   * lerp (~1.38→0.92) so jump punches never read as reaching. Any `attack` must pull into contact range.
   *
   * **Light / quick jabs:** the player `attack` clip often ends before the monster `hurt` clip. Then the player is
   * already `idle` while the defender is still `hurt` — `isContactExchange` becomes false and we fell through to the
   * `rollingApproachBlend` path; when blend is 0 (e.g. recovery phase just flipped `ready`) the scene snapped back to
   * idle separation (~1.38). Keep strike-range X while either side is still hurt / recover / knockdown.
   */
  const inPostHitPose =
    playerVisualState === "hurt" ||
    monsterVisualState === "hurt" ||
    playerVisualState === "recover" ||
    monsterVisualState === "recover" ||
    playerVisualState === "knockdown" ||
    monsterVisualState === "knockdown";
  const useStrikeContactSpacing =
    isContactExchange ||
    playerVisualState === "attack" ||
    monsterVisualState === "attack" ||
    inPostHitPose;
  if (!useStrikeContactSpacing) {
    const idle = COMBAT_IDLE_SEPARATION_HALF;
    const t = Math.max(0, Math.min(1, rollingApproachBlend));
    const close = COMBAT_STRIKE_PICK_SEPARATION_HALF;
    const h = idle * (1 - t) + close * t;
    return { playerPosX: -h, monsterPosX: h };
  }

  const pAtk = playerVisualState === "attack";
  const mAtk = monsterVisualState === "attack";
  const pKd = playerVisualState === "knockdown";
  const mKd = monsterVisualState === "knockdown";
  /** Direct attack vs knockdown poses. */
  const attackVsKnockdown =
    (pKd && mAtk && !pAtk) || (mKd && pAtk && !mAtk);
  /**
   * Combat 3D mirrors sides: player heavy on monster often shows **monster `knockdown` + player `angry`**
   * (see `LabyrinthGame` `playerGltfVisualState` swap), not `attack` + `knockdown`.
   */
  const mirroredHeavyKnockdown =
    monsterVisualState === "knockdown" && playerVisualState === "angry";

  if (attackVsKnockdown || mirroredHeavyKnockdown) {
    if (mAtk && !pAtk) {
      const h = rowMonsterHitsPlayer(draculaAttackVariant, playerVisualState).separationHalf;
      return { playerPosX: -h, monsterPosX: h };
    }
    if (pAtk && !mAtk) {
      const h = rowPlayerHitsMonster(playerAttackVariant, monsterVisualState).separationHalf;
      return { playerPosX: -h, monsterPosX: h };
    }
    if (mirroredHeavyKnockdown) {
      const h = rowPlayerHitsMonster(playerAttackVariant, "knockdown").separationHalf;
      return { playerPosX: -h, monsterPosX: h };
    }
    const h = COMBAT_ATTACK_VS_KNOCKDOWN_HALF;
    return { playerPosX: -h, monsterPosX: h };
  }

  if (pAtk && mAtk) {
    const half = Math.max(
      combatContactHalfXForVariant(playerAttackVariant),
      combatContactHalfXForVariant(draculaAttackVariant),
      COMBAT_CONTACT_HALF_X_MIN,
    );
    return { playerPosX: -half, monsterPosX: half };
  }

  /**
   * Monster `attack` vs non-attacking player (hunt / hurt / idle / …): use `MONSTER_HITS_PLAYER` halves — same as
   * `resolveCombat3dFaceOffSeparationHalf`. The old path kept **spell** at 0.92 and **skill** at 0.68 (e.g. skeleton
   * strikes read long-range and out of sync with the table-tuned clip leads).
   */
  if (mAtk && !pAtk) {
    const h = rowMonsterHitsPlayer(draculaAttackVariant, playerVisualState).separationHalf;
    return { playerPosX: -h, monsterPosX: h };
  }

  /**
   * Player `attack` vs calm monster (`hunt` / `idle` / …): must use `rowPlayerHitsMonster` (defender pose → **hurt** column),
   * same as `resolveCombat3dFaceOffSeparationHalf`. Defaulting to 0.92 here left skill jump clips (tight table half 0.42 +
   * `attackerLeadInSec` 0) starting with huge air — root motion read as the player jumping **past** the defender.
   */
  if (pAtk && !mAtk) {
    let h = rowPlayerHitsMonster(playerAttackVariant, monsterVisualState).separationHalf;
    if (playerAttackVariant === "skill" && monsterVisualState === "recover") {
      h = rowPlayerHitsMonster("spell", "hurt").separationHalf;
    }
    return { playerPosX: -h, monsterPosX: h };
  }

  const h = COMBAT_STRIKE_PICK_SEPARATION_HALF;
  return { playerPosX: -h, monsterPosX: h };
}

export interface MonsterModel3DProps {
  gltfPath: string;
  /** Shown if WebGL or model load fails, and as Suspense fallback is a plain box (see below). */
  fallback: ReactNode;
  width: number;
  height: number;
  visualState: Monster3DSpriteState;
  /** Used to pick Meshy / per-creature animation clip lists (e.g. `Z` zombie, `V` dracula). */
  monsterType?: MonsterType | null;
  /** Stronger zoom (Dracula wide attack frame) — matches 2D `object-fit: cover` intent. */
  tightFraming?: boolean;
  /**
   * Match `/monster-3d-animations` camera (fov 38, distance) without changing the GL backdrop — combat stays transparent.
   */
  referenceViewerStyle?: boolean;
  /**
   * Fires once when the current non-looping clip ends (Three.js mixer `finished`). Looping states (`idle`, `hunt`, `rolling`, Dracula loss `angry`+`Skill_01`, …) never call this.
   * Use to advance combat UI instead of fixed millisecond timers. If no clip matches, called next frame so the game cannot soft-lock.
   */
  onOneShotAnimationFinished?: () => void;
  /** Merged `dracula.glb`: spell vs skill clip order when `visualState` is `attack` or `angry`. */
  draculaAttackVariant?: "spell" | "skill" | "light";
  /** Dracula + `hurt`: HP after the strike (with max) selects light / medium / heavy hit clips. */
  draculaHurtHp?: { hp: number; maxHp: number } | null;
  /** Dracula: head/body/legs from strike pick — overrides HP tier for hurt clips; legs also biases knockdown to `falling_down`. */
  draculaHurtStrikeZone?: StrikeTarget | null;
  /** Player-loss banner: loop `Skill_01` on `angry` until the user continues. */
  draculaLoopAngrySkill01?: boolean;
}

function shouldLoopVisualState(state: Monster3DSpriteState, draculaLoopAngrySkill01: boolean): boolean {
  if (state === "angry" && draculaLoopAngrySkill01) return true;
  return state === "idle" || state === "neutral" || state === "hunt" || state === "rolling";
}

/**
 * Let authored one-shot clips use their baked root motion (jump-ins, knockdowns,
 * defeats, stand-ups). Only looping stance states stay pinned in place.
 */
function shouldLockRootMotionForState(state: Monster3DSpriteState, draculaLoopAngrySkill01: boolean): boolean {
  return shouldLoopVisualState(state, draculaLoopAngrySkill01);
}

/**
 * Pin root only for looping stance clips (idle / hunt / rolling / …). Do **not** lock during player `attack`:
 * wasteland-drifter strikes are authored with root motion; locking made the torso read “frozen” at the face-off X
 * while only extremities moved. World placement stays from the parent group `positionX` + clip lead-ins in
 * `combat3dContact` / `resolveCombat3dClipLeads`.
 */
function useCombatRootMotionLock(
  scene: THREE.Object3D,
  visualState: Monster3DSpriteState,
  draculaLoopAngrySkill01: boolean,
): void {
  const lock = shouldLockRootMotionForState(visualState, draculaLoopAngrySkill01);
  useRootMotionLock(scene, lock);
}

/** Skip Meshy “wind-up” at t=0 on player `hurt` so flinch aligns with merged monster contact (see `mergedMeshyMonsterHitPlayerHurtClipStartTimeSec`). */
function applyPlayerHurtClipContactSync(
  act: THREE.AnimationAction,
  isPlayerModel: boolean,
  visualState: Monster3DSpriteState,
  startSec: number,
  fatalJumpKill: boolean,
): void {
  if (!isPlayerModel || visualState !== "hurt" || fatalJumpKill || !(startSec > 0)) return;
  const clip = act.getClip();
  if (!clip || clip.duration <= 0) return;
  act.time = Math.min(startSec, Math.max(0, clip.duration - 0.04));
}

/** Skip Meshy wind-up at t=0 on monster `hurt` / `knockdown` when the player lands a strike — pairs with `PLAYER_HITS_MONSTER` + `resolveCombat3dClipLeads`. */
function applyMonsterHurtClipContactSync(
  act: THREE.AnimationAction,
  isPlayerModel: boolean,
  visualState: Monster3DSpriteState,
  startSec: number,
): void {
  if (isPlayerModel || (visualState !== "hurt" && visualState !== "knockdown") || !(startSec > 0)) return;
  const clip = act.getClip();
  if (!clip || clip.duration <= 0) return;
  act.time = Math.min(startSec, Math.max(0, clip.duration - 0.04));
}

/** Player `attack`: skip into clip (lead-in from `combat3dContact` / `resolveCombat3dClipLeads`). */
function applyPlayerAttackClipSkillLeadIn(
  act: THREE.AnimationAction,
  isPlayerModel: boolean,
  visualState: Monster3DSpriteState,
  leadInSec: number,
): void {
  if (!isPlayerModel || visualState !== "attack" || !(leadInSec > 0)) return;
  const clip = act.getClip();
  if (!clip || clip.duration <= 0) return;
  act.time = Math.min(leadInSec, Math.max(0, clip.duration - 0.04));
}

class ModelErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.warn("[MonsterModel3D]", error?.message ?? error, info?.componentStack);
  }

  render(): ReactNode {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

/** Optional weapon GLB: load failures must not unmount the whole combat `Canvas`. */
class WeaponLoadErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.warn("[WeaponLoadErrorBoundary]", error?.message ?? error, info?.componentStack);
  }

  render(): ReactNode {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

/**
 * Find the Armature / root Object3D whose `.position` track is driven by
 * Meshy root-motion clips.  Returns `null` when none is found.
 */
function findArmatureRoot(scene: THREE.Object3D): THREE.Object3D | null {
  for (const child of scene.children) {
    if (child.name === "Armature" || child.name === "Root" || child.name === "Hips") return child;
  }
  let first: THREE.Object3D | null = null;
  scene.traverse((obj) => {
    if (!first && obj !== scene && (obj instanceof THREE.Bone || obj.type === "Bone")) {
      first = obj;
    }
  });
  if (first != null && (first as THREE.Object3D).parent === scene) return first;
  return null;
}

/**
 * Per-frame root-motion lock: after the animation mixer has updated,
 * restore the Armature to its bind offset so looping stance clips cannot
 * drift across the combat scene. One-shot actions may opt out and use the
 * GLB's authored translation.
 */
function useRootMotionLock(scene: THREE.Object3D, enabled: boolean) {
  const armRef = useRef<THREE.Object3D | null>(null);
  const basePosRef = useRef<THREE.Vector3 | null>(null);
  useEffect(() => {
    const arm = findArmatureRoot(scene);
    armRef.current = arm;
    basePosRef.current = arm ? arm.position.clone() : null;
  }, [scene]);
  useFrame(() => {
    if (!enabled) return;
    const arm = armRef.current;
    const basePos = basePosRef.current;
    if (!arm || !basePos) return;
    arm.position.copy(basePos);
  });
}

/** Outgoing clip for `crossFadeTo` — avoids `stopAllAction` snapping hunt/rolling pose back to bind before `attack`. */
function pickDominantPlayingAction(actions: Record<string, THREE.AnimationAction | null>): THREE.AnimationAction | null {
  let best: THREE.AnimationAction | null = null;
  let bestW = 0;
  for (const a of Object.values(actions)) {
    if (!a) continue;
    const w = a.getEffectiveWeight();
    if (w > bestW) {
      bestW = w;
      best = a;
    }
  }
  return bestW > 1e-3 ? best : null;
}

/**
 * When hunt/rolling → strike, `pickDominantPlayingAction` can return null (e.g. cross-fade ramp, drei's action map).
 * Resolve the expected locomotion clip and use it if it is still running so `crossFadeTo` has a real outgoing action.
 */
function pickLocomotionHandoffOutgoing(
  actions: Record<string, THREE.AnimationAction | null>,
  names: readonly string[],
  url: string,
  prevState: Monster3DSpriteState | null,
  isPlayerModel: boolean,
  monsterType: MonsterType | null | undefined,
  draculaAttackVariant: "spell" | "skill" | "light" | undefined,
  monsterResolveOpts: {
    draculaHurtHp?: { hp: number; maxHp: number } | null;
    draculaHurtStrikeZone?: StrikeTarget | null;
  },
): THREE.AnimationAction | null {
  const dom = pickDominantPlayingAction(actions);
  if (dom && dom.getEffectiveWeight() > 1e-4) return dom;
  if (prevState !== "hunt" && prevState !== "rolling") return dom;

  const glbSlug = glbSlugFromPathOrUrl(url);
  const clip = isPlayerModel
    ? resolvePlayerAnimationClipName(prevState, names, draculaAttackVariant)
    : resolveMonsterAnimationClipName(prevState, names, {
        monsterType: monsterType ?? null,
        glbSlug,
        draculaAttackVariant,
        draculaHurtHp: monsterResolveOpts.draculaHurtHp ?? null,
        draculaHurtStrikeZone: monsterResolveOpts.draculaHurtStrikeZone ?? null,
        /** `prevState` is only `hunt` / `rolling` here — never `angry`. */
        draculaAngryLockSkill01: false,
      });
  const a = clip ? actions[clip] ?? null : null;
  if (a && a.isRunning()) return a;
  return dom;
}

const PLAYER_LOCOMOTION_TO_ATTACK_CROSSFADE_SEC = 0.38;

function GltfSubject({
  url,
  visualState,
  tightFraming,
  monsterType,
  draculaAttackVariant,
  draculaHurtHp,
  draculaHurtStrikeZone,
  draculaLoopAngrySkill01 = false,
  onOneShotAnimationFinished,
  isPlayerModel = false,
  playerFatalJumpKill = false,
  playerHurtAnimContext = null,
  playerHurtClipStartTimeSec = 0,
}: {
  url: string;
  visualState: Monster3DSpriteState;
  tightFraming: boolean;
  monsterType?: MonsterType | null;
  draculaAttackVariant?: "spell" | "skill" | "light";
  draculaHurtHp?: { hp: number; maxHp: number } | null;
  draculaHurtStrikeZone?: StrikeTarget | null;
  draculaLoopAngrySkill01?: boolean;
  onOneShotAnimationFinished?: () => void;
  isPlayerModel?: boolean;
  /** Lethal spell strike (e.g. Jumping_Punch) — prefer `Shot_and_Fall_Backward` on player `hurt`. */
  playerFatalJumpKill?: boolean;
  /** Standing hurt: HP lost this strike + optional strike zone (else inferred from segment). */
  playerHurtAnimContext?: { hpLost: number; strikeZone?: StrikeTarget } | null;
  /** Skip this many seconds into player `hurt` so impact matches merged monster contact. */
  playerHurtClipStartTimeSec?: number;
}) {
  /** Mixer root = glTF scene (not the scaled wrapper group) — matches skinned-clip roots across merged Meshy exports. */
  const animSceneRootRef = useRef<THREE.Object3D | null>(null);
  const { scene, animations } = useGLTF(url);
  useLayoutEffect(() => {
    animSceneRootRef.current = scene;
  }, [scene]);
  const { actions, names, mixer } = useAnimations(animations, animSceneRootRef);
  const onFinishedRef = useRef(onOneShotAnimationFinished);
  onFinishedRef.current = onOneShotAnimationFinished;
  /** `null` until first clip run — keeps `attack → walk-back` chains (prev stays `attack` until realign ends). */
  const prevVisualStateRef = useRef<Monster3DSpriteState | null>(null);
  /**
   * `sameAsClampedPrev` must not skip the **second** mount in React Strict dev (mount → cleanup → remount): the first
   * run sets `prevVisualStateRef` and plays; cleanup stops the mixer; without this flag the remount returns early and
   * nothing plays (looks like the GLB never loaded).
   */
  const playedClampedStateThisEffectRef = useRef(false);
  const draculaVariantRef = useRef(draculaAttackVariant);
  draculaVariantRef.current = draculaAttackVariant;
  const draculaHurtRef = useRef(draculaHurtHp);
  draculaHurtRef.current = draculaHurtHp;
  const playerJumpKillRef = useRef(playerFatalJumpKill);
  playerJumpKillRef.current = playerFatalJumpKill;
  const playerHurtCtxRef = useRef(playerHurtAnimContext);
  playerHurtCtxRef.current = playerHurtAnimContext;
  const playerHurtAnimKey = playerHurtAnimContext
    ? `${playerHurtAnimContext.hpLost}:${playerHurtAnimContext.strikeZone ?? ""}`
    : "";
  const playerHurtStartRef = useRef(playerHurtClipStartTimeSec);
  playerHurtStartRef.current = playerHurtClipStartTimeSec;
  /** Skip mixer churn while `Walk_Fight_Back` → calm is playing (prev still `attack`, next already `idle`). */
  const attackToIdleRealignLockRef = useRef(false);

  useCombatRootMotionLock(scene, visualState, !!draculaLoopAngrySkill01);

  useEffect(() => {
    useGLTF.preload(url);
  }, [url]);

  useEffect(() => {
    const prevState = prevVisualStateRef.current;

    if (visualState === "attack") attackToIdleRealignLockRef.current = false;
    if (visualState === "hunt" || visualState === "rolling") {
      attackToIdleRealignLockRef.current = false;
    }

    // Skip replaying a clamped one-shot clip (e.g. defeated) when re-rendered with the same state.
    /** `hurt` excluded — hurt opts / lead-in can change without a state change (see `PositionedGltfSubject`). */
    const sameAsClampedPrev =
      playedClampedStateThisEffectRef.current &&
      prevState !== null &&
      prevState === visualState &&
      !shouldLoopVisualState(visualState, !!draculaLoopAngrySkill01) &&
      visualState !== "hurt";
    if (sameAsClampedPrev) return;

    if (
      attackToIdleRealignLockRef.current &&
      prevState === "attack" &&
      isMeshyPostAttackCalmState(visualState) &&
      visualState !== "hunt" &&
      visualState !== "rolling"
    ) {
      return;
    }

    /**
     * Connected sequences: the outgoing clip's final clamped pose must blend
     * into the incoming clip's first frame so the model doesn't jump through
     * bind/T-pose between them.
     *   knockdown → recover   (lying down → Arise starts from the floor)
     *   knockdown → defeated  (lying down → Dead, stays clamped on the ground)
     *   hurt      → recover   (stagger → recovery stance)
     *   recover   → idle      (Arise ends partially standing → idle completes the stand-up)
     */
    const crossFade =
      (prevState === "knockdown" && (visualState === "recover" || visualState === "defeated")) ||
      (prevState === "hurt" && visualState === "recover") ||
      (prevState === "recover" && (visualState === "idle" || visualState === "neutral")) ||
      (isPlayerModel &&
        (prevState === "hunt" || prevState === "rolling") &&
        (visualState === "hurt" || visualState === "knockdown"));
    let fadeDuration = crossFade ? 0.4 : 0.18;
    if (!crossFade && isPlayerModel && visualState === "hurt") {
      fadeDuration = Math.min(fadeDuration, 0.05);
    }

    const tryWalkBack =
      !crossFade &&
      prevState === "attack" &&
      isMeshyPostAttackCalmState(visualState) &&
      visualState !== "hunt" &&
      visualState !== "rolling" &&
      (isPlayerModel || isMergedMeshyStrikePortraitType(monsterType));
    if (tryWalkBack) {
      const wb = resolveWalkFightBackClipName(url, names, { isPlayerModel, monsterType });
      if (wb && actions[wb]) {
        mixer.stopAllAction();
        attackToIdleRealignLockRef.current = true;
        const actWb = actions[wb]!;
        actWb.reset();
        actWb.setLoop(THREE.LoopOnce, 1);
        actWb.clampWhenFinished = true;
        let actForListener: THREE.AnimationAction | null = actWb;
        let didNotify = false;
        const notifyOnce = () => {
          if (didNotify) return;
          didNotify = true;
          onFinishedRef.current?.();
        };
        const onWbFin = (e: THREE.AnimationMixerEventMap["finished"]) => {
          if (e.action !== actForListener) return;
          mixer.removeEventListener("finished", onWbFin);
          actForListener = null;
          const glbSlug = glbSlugFromPathOrUrl(url);
          const dHurt = draculaHurtRef.current;
          const hurtCtx =
            dHurt?.hp != null && dHurt?.maxHp != null ? { hp: dHurt.hp, maxHp: dHurt.maxHp } : dHurt ?? null;
          const calmPick = isPlayerModel
            ? resolvePlayerAnimationClipName(visualState, names, draculaVariantRef.current, {
                fatalJumpKill: playerJumpKillRef.current,
                playerHurtHpLost: playerHurtCtxRef.current?.hpLost,
                playerHurtStrikeZone: playerHurtCtxRef.current?.strikeZone,
              })
            : resolveMonsterAnimationClipName(visualState, names, {
                monsterType,
                glbSlug,
                draculaAttackVariant: draculaVariantRef.current,
                draculaHurtHp: hurtCtx,
                draculaHurtStrikeZone: draculaHurtStrikeZone ?? null,
                draculaAngryLockSkill01: draculaLoopAngrySkill01 && visualState === "angry",
              });
          const loops = shouldLoopVisualState(visualState, !!draculaLoopAngrySkill01);
          const onCalmFin = (ev: THREE.AnimationMixerEventMap["finished"]) => {
            if (ev.action !== actForListener) return;
            mixer.removeEventListener("finished", onCalmFin);
            actForListener = null;
            notifyOnce();
          };
          if (calmPick && actions[calmPick]) {
            const act = actions[calmPick]!;
            act.reset();
            applyPlayerHurtClipContactSync(
              act,
              isPlayerModel,
              visualState,
              playerHurtStartRef.current,
              playerJumpKillRef.current,
            );
            if (loops) {
              act.setLoop(THREE.LoopRepeat, Infinity);
              act.clampWhenFinished = false;
            } else {
              act.setLoop(THREE.LoopOnce, 1);
              act.clampWhenFinished = true;
              if (onFinishedRef.current) {
                actForListener = act;
                mixer.addEventListener("finished", onCalmFin);
              }
            }
            act.fadeIn(fadeDuration).play();
          }
          attackToIdleRealignLockRef.current = false;
          prevVisualStateRef.current = visualState;
          invalidate();
        };
        mixer.addEventListener("finished", onWbFin);
        actWb.fadeIn(0.12).play();
        playedClampedStateThisEffectRef.current = true;
        invalidate();
        return () => {
          playedClampedStateThisEffectRef.current = false;
          attackToIdleRealignLockRef.current = false;
          mixer.removeEventListener("finished", onWbFin);
          for (const a of Object.values(actions)) {
            a?.fadeOut(0.12);
          }
        };
      }
    }

    prevVisualStateRef.current = visualState;

    if (!crossFade) {
    mixer.stopAllAction();
    }

    const glbSlug = glbSlugFromPathOrUrl(url);
    const dHurt = draculaHurtRef.current;
    const hurtCtx =
      dHurt?.hp != null && dHurt?.maxHp != null ? { hp: dHurt.hp, maxHp: dHurt.maxHp } : dHurt ?? null;
    const pick = isPlayerModel
      ? resolvePlayerAnimationClipName(visualState, names, draculaVariantRef.current, {
          fatalJumpKill: playerJumpKillRef.current,
          playerHurtHpLost: playerHurtCtxRef.current?.hpLost,
          playerHurtStrikeZone: playerHurtCtxRef.current?.strikeZone,
        })
      : resolveMonsterAnimationClipName(visualState, names, {
      monsterType,
      glbSlug,
      draculaAttackVariant: draculaVariantRef.current,
      draculaHurtHp: hurtCtx,
      draculaHurtStrikeZone: draculaHurtStrikeZone ?? null,
      draculaAngryLockSkill01: draculaLoopAngrySkill01 && visualState === "angry",
    });
    const loops = shouldLoopVisualState(visualState, !!draculaLoopAngrySkill01);
    let actForListener: THREE.AnimationAction | null = null;
    let didNotify = false;
    const notifyFinishedOnce = () => {
      if (didNotify) return;
      didNotify = true;
      onFinishedRef.current?.();
    };

    const onMixerFinished = (e: THREE.AnimationMixerEventMap["finished"]) => {
      if (e.action !== actForListener) return;
      mixer.removeEventListener("finished", onMixerFinished);
      actForListener = null;
      notifyFinishedOnce();
    };

    if (pick && actions[pick]) {
      const act = actions[pick]!;
      act.reset();
      applyPlayerHurtClipContactSync(
        act,
        isPlayerModel,
        visualState,
        playerHurtStartRef.current,
        playerJumpKillRef.current,
      );
      if (loops) {
        act.setLoop(THREE.LoopRepeat, Infinity);
        act.clampWhenFinished = false;
      } else {
        act.setLoop(THREE.LoopOnce, 1);
        act.clampWhenFinished = true;
        if (onFinishedRef.current) {
          actForListener = act;
          mixer.addEventListener("finished", onMixerFinished);
        }
      }
      if (crossFade) {
        for (const a of Object.values(actions)) {
          if (a && a !== act) a.fadeOut(fadeDuration);
        }
      }
      act.fadeIn(fadeDuration).play();
      playedClampedStateThisEffectRef.current = true;
    }

    invalidate();
    return () => {
      playedClampedStateThisEffectRef.current = false;
      if (actForListener) {
        mixer.removeEventListener("finished", onMixerFinished);
        actForListener = null;
      }
      for (const a of Object.values(actions)) {
        a?.fadeOut(0.12);
      }
    };
  }, [
    actions,
    names,
    mixer,
    url,
    visualState,
    monsterType,
    draculaLoopAngrySkill01,
    isPlayerModel,
    draculaAttackVariant,
    draculaHurtHp,
    draculaHurtStrikeZone,
    playerFatalJumpKill,
    playerHurtAnimKey,
    playerHurtClipStartTimeSec,
  ]);

  useEffect(() => {
    invalidate();
  }, [url, tightFraming]);

  /** Merged Meshy rigs (Dracula + skeleton): same scale in combat so framing matches. */
  const scale =
    (tightFraming ? 1.14 : 1) *
    (isPlayerModel ? 0.9 : monsterType === "V" || monsterType === "K" || monsterType === "Z" || monsterType === "G" || monsterType === "S" || monsterType === "L" ? 0.9 : 1);

  return (
    <Center>
      <group scale={scale} rotation={isPlayerModel ? [0, Math.PI, 0] : undefined}>
        <primitive object={scene} />
      </group>
    </Center>
  );
}

/** Same as GltfSubject but positioned at an explicit X offset (for shared combat scene). */
function PositionedGltfSubject(
  props: Parameters<typeof GltfSubject>[0] & {
    positionX?: number;
    weaponUrl?: string | null;
    hitRootRef?: React.MutableRefObject<THREE.Group | null> | null;
    /**
     * When set (e.g. face-off lab), any change restarts the current clip from t=0 on both fighters so
     * paired actions start together. Omit in live combat.
     */
    animationSyncKey?: string;
    /**
     * Face-off lab: with `onPairPlaybackMixerReady`, fire once per `pairGateToken` when the mixer has actions
     * so the parent can align start times after both GLBs finish Suspense loading.
     */
    pairGateToken?: number;
    pairPlaybackRole?: "player" | "monster";
    onPairPlaybackMixerReady?: (role: "player" | "monster", gateToken: number) => void;
    /** Player `attack`: seconds to skip into the clip (skill-tier strike — earlier hit phase). */
    playerAttackClipLeadInSec?: number;
    /** Rotates merged player `attack` clip try-order (strike-pick repeats during one roll). */
    playerAttackClipCycleIndex?: number;
    /** Monster `hurt`: seconds into reaction clip when player connects (player `attack` beat). */
    monsterHurtClipStartTimeSec?: number;
    /**
     * Hunt/rolling → player `attack` crossfade duration (sec). Shorter = jump clips begin visible sooner; omit for default {@link PLAYER_LOCOMOTION_TO_ATTACK_CROSSFADE_SEC}.
     */
    playerLocomotionToAttackCrossfadeSec?: number;
    /** Merged monster: hunt/roll → `attack` blend (`MONSTER_HUNT_TO_ATTACK_CROSSFADE_SEC_BY_TIER` from `resolveCombat3dClipLeads`). */
    monsterLocomotionToAttackCrossfadeSec?: number;
  }
) {
  const {
    positionX = 0,
    weaponUrl,
    hitRootRef,
    animationSyncKey,
    pairGateToken,
    pairPlaybackRole,
    onPairPlaybackMixerReady,
    playerAttackClipLeadInSec = 0,
    playerAttackClipCycleIndex = 0,
    monsterHurtClipStartTimeSec = 0,
    playerLocomotionToAttackCrossfadeSec,
    monsterLocomotionToAttackCrossfadeSec,
    ...rest
  } = props;
  const groupRef = useRef<THREE.Group | null>(null);
  const setGroupRef = (node: THREE.Group | null) => {
    groupRef.current = node;
    if (hitRootRef) hitRootRef.current = node;
  };
  const { scene, animations } = useGLTF(rest.url);
  const innerRef = useRef<THREE.Group>(null);
  const { actions, names, mixer } = useAnimations(animations, innerRef);
  const onFinishedRef = useRef(rest.onOneShotAnimationFinished);
  onFinishedRef.current = rest.onOneShotAnimationFinished;
  const prevVisualStateRef = useRef<Monster3DSpriteState | null>(null);
  /** See `playedClampedStateThisEffectRef` on `GltfSubject` — Strict Mode remount must replay clips. */
  const playedClampedStateThisEffectRef = useRef(false);
  const prevAnimationSyncKeyRef = useRef<string | undefined>(undefined);
  const draculaVariantRef = useRef(rest.draculaAttackVariant);
  draculaVariantRef.current = rest.draculaAttackVariant;
  const draculaHurtRef = useRef(rest.draculaHurtHp);
  draculaHurtRef.current = rest.draculaHurtHp;
  const playerJumpKillRef = useRef(rest.playerFatalJumpKill);
  playerJumpKillRef.current = rest.playerFatalJumpKill;
  const playerHurtCtxRef = useRef(rest.playerHurtAnimContext);
  playerHurtCtxRef.current = rest.playerHurtAnimContext;
  const playerHurtAnimKey = rest.playerHurtAnimContext
    ? `${rest.playerHurtAnimContext.hpLost}:${rest.playerHurtAnimContext.strikeZone ?? ""}`
    : "";
  const playerHurtStartRef = useRef(rest.playerHurtClipStartTimeSec ?? 0);
  playerHurtStartRef.current = rest.playerHurtClipStartTimeSec ?? 0;
  const playerAttackLeadRef = useRef(playerAttackClipLeadInSec);
  playerAttackLeadRef.current = playerAttackClipLeadInSec;
  const playerAttackCycleRef = useRef(playerAttackClipCycleIndex);
  playerAttackCycleRef.current = playerAttackClipCycleIndex;
  const monsterHurtStartRef = useRef(monsterHurtClipStartTimeSec);
  monsterHurtStartRef.current = monsterHurtClipStartTimeSec;

  const locomotionToAttackFadeSec =
    rest.isPlayerModel && typeof playerLocomotionToAttackCrossfadeSec === "number"
      ? playerLocomotionToAttackCrossfadeSec
      : !rest.isPlayerModel && typeof monsterLocomotionToAttackCrossfadeSec === "number"
        ? monsterLocomotionToAttackCrossfadeSec
        : PLAYER_LOCOMOTION_TO_ATTACK_CROSSFADE_SEC;

  const hurtHpKey =
    rest.draculaHurtHp?.hp != null && rest.draculaHurtHp?.maxHp != null
      ? `${rest.draculaHurtHp.hp}/${rest.draculaHurtHp.maxHp}`
      : "—";
  const hurtZoneKey = rest.draculaHurtStrikeZone ?? "—";
  const attackToIdleRealignLockRef = useRef(false);
  const prevPlayerAttackTimingKeyRef = useRef("");
  const playerAttackTimingKey =
    rest.isPlayerModel && rest.visualState === "attack"
      ? `${playerAttackClipLeadInSec}:${playerAttackClipCycleIndex}`
      : "";
  const playerAttackTimingKeyChanged =
    rest.isPlayerModel &&
    rest.visualState === "attack" &&
    prevPlayerAttackTimingKeyRef.current !== playerAttackTimingKey;

  useCombatRootMotionLock(scene, rest.visualState, !!rest.draculaLoopAngrySkill01);

  useEffect(() => {
    if (!rest.isPlayerModel || rest.visualState !== "attack") {
      prevPlayerAttackTimingKeyRef.current = "";
    }
  }, [rest.isPlayerModel, rest.visualState]);

  useEffect(() => { useGLTF.preload(rest.url); }, [rest.url]);

  useEffect(() => {
    if (onPairPlaybackMixerReady == null || pairPlaybackRole == null || pairGateToken == null) return;
    /** No clips — still ack so face-off lab does not wait forever on `animationSyncKey` (static mesh only). */
    if (animations.length === 0) {
      onPairPlaybackMixerReady(pairPlaybackRole, pairGateToken);
      return;
    }
    if (Object.keys(actions).length === 0) return;
    onPairPlaybackMixerReady(pairPlaybackRole, pairGateToken);
  }, [actions, animations.length, pairGateToken, pairPlaybackRole, onPairPlaybackMixerReady]);

  useEffect(() => {
    const syncKeyBump =
      animationSyncKey != null &&
      animationSyncKey !== prevAnimationSyncKeyRef.current;
    if (syncKeyBump) prevAnimationSyncKeyRef.current = animationSyncKey;

    const prevState = prevVisualStateRef.current;

    if (rest.visualState === "attack") attackToIdleRealignLockRef.current = false;
    if (rest.visualState === "hunt" || rest.visualState === "rolling") {
      attackToIdleRealignLockRef.current = false;
    }

    /**
     * Do **not** treat `hurt` as “same as previous” — footer / lead-in / context can update while `visualState`
     * stays `hurt`. Skipping the effect after cleanup faded the mixer leaves the rig frozen (no actions) until state
     * changes (notably monster **light** strike vs merged player hurt timing).
     */
    const sameAsClampedPrev =
      playedClampedStateThisEffectRef.current &&
      !syncKeyBump &&
      !playerAttackTimingKeyChanged &&
      prevState !== null &&
      prevState === rest.visualState &&
      !shouldLoopVisualState(rest.visualState, !!rest.draculaLoopAngrySkill01) &&
      rest.visualState !== "hurt";
    if (sameAsClampedPrev) return;

    if (
      !syncKeyBump &&
      attackToIdleRealignLockRef.current &&
      prevState === "attack" &&
      isMeshyPostAttackCalmState(rest.visualState) &&
      rest.visualState !== "hunt" &&
      rest.visualState !== "rolling"
    ) {
      return;
    }

    /** Same idea as `GltfSubject` recover chains — never `stopAllAction()` between these, or the rig flashes bind/T-pose. */
    const recoverContinuityCrossFade =
      !syncKeyBump &&
      ((prevState === "knockdown" && (rest.visualState === "recover" || rest.visualState === "defeated")) ||
        (prevState === "hurt" && rest.visualState === "recover") ||
        (prevState === "recover" && (rest.visualState === "idle" || rest.visualState === "neutral")));
    /**
     * Hunt/rolling → strike: if we `stopAllAction()` when `pickDominantPlayingAction` returns null (e.g. low weight edge),
     * the player snaps to rest pose before the attack clip — looks like a hard reset to “origin”. Keep the locomotion
     * mixer alive and cross-fade into `attack` / `hurt` / `knockdown` instead.
     */
    const locomotionHandoffToStrike =
      !syncKeyBump &&
      (prevState === "hunt" || prevState === "rolling") &&
      ((rest.isPlayerModel &&
        (rest.visualState === "attack" ||
          rest.visualState === "hurt" ||
          rest.visualState === "knockdown")) ||
        (!rest.isPlayerModel &&
          isMergedMeshyStrikePortraitType(rest.monsterType) &&
          (rest.visualState === "attack" ||
            rest.visualState === "hurt" ||
            rest.visualState === "knockdown")));

    const crossFade = recoverContinuityCrossFade || locomotionHandoffToStrike;
    /** Player hunt→defender hit: do not reuse short spell/skill hunt→attack fades — those snap hurt on too early. */
    const locomotionHandoffFadeSec =
      locomotionHandoffToStrike &&
      rest.isPlayerModel &&
      (rest.visualState === "hurt" || rest.visualState === "knockdown")
        ? PLAYER_LOCOMOTION_TO_ATTACK_CROSSFADE_SEC
        : locomotionToAttackFadeSec;
    let fadeDuration = recoverContinuityCrossFade
      ? 0.4
      : locomotionHandoffToStrike
        ? locomotionHandoffFadeSec
        : 0.18;
    if (!crossFade && rest.isPlayerModel && rest.visualState === "hurt") {
      fadeDuration = Math.min(fadeDuration, 0.05);
    }
    if (syncKeyBump) fadeDuration = Math.min(fadeDuration, 0.06);

    const tryWalkBack =
      !syncKeyBump &&
      !crossFade &&
      prevState === "attack" &&
      isMeshyPostAttackCalmState(rest.visualState) &&
      rest.visualState !== "hunt" &&
      rest.visualState !== "rolling" &&
      (rest.isPlayerModel || isMergedMeshyStrikePortraitType(rest.monsterType));
    if (tryWalkBack) {
      const wb = resolveWalkFightBackClipName(rest.url, names, {
        isPlayerModel: !!rest.isPlayerModel,
        monsterType: rest.monsterType,
      });
      if (wb && actions[wb]) {
        mixer.stopAllAction();
        attackToIdleRealignLockRef.current = true;
        const actWb = actions[wb]!;
        actWb.reset();
        actWb.setLoop(THREE.LoopOnce, 1);
        actWb.clampWhenFinished = true;
        let actForListener: THREE.AnimationAction | null = actWb;
        let didNotify = false;
        const notifyOnce = () => {
          if (didNotify) return;
          didNotify = true;
          onFinishedRef.current?.();
        };
        const onWbFin = (e: THREE.AnimationMixerEventMap["finished"]) => {
          if (e.action !== actForListener) return;
          mixer.removeEventListener("finished", onWbFin);
          actForListener = null;
          const glbSlug = glbSlugFromPathOrUrl(rest.url);
          const dHurt = draculaHurtRef.current;
          const hurtCtx =
            dHurt?.hp != null && dHurt?.maxHp != null ? { hp: dHurt.hp, maxHp: dHurt.maxHp } : dHurt ?? null;
          const calmPick = rest.isPlayerModel
            ? resolvePlayerAnimationClipName(rest.visualState, names, draculaVariantRef.current, {
                fatalJumpKill: playerJumpKillRef.current,
                playerHurtHpLost: playerHurtCtxRef.current?.hpLost,
                playerHurtStrikeZone: playerHurtCtxRef.current?.strikeZone,
                playerAttackClipCycleIndex: playerAttackCycleRef.current,
              })
            : resolveMonsterAnimationClipName(rest.visualState, names, {
                monsterType: rest.monsterType,
                glbSlug,
                draculaAttackVariant: draculaVariantRef.current,
                draculaHurtHp: hurtCtx,
                draculaHurtStrikeZone: rest.draculaHurtStrikeZone ?? null,
                draculaAngryLockSkill01: rest.draculaLoopAngrySkill01 && rest.visualState === "angry",
              });
          const loops = shouldLoopVisualState(rest.visualState, !!rest.draculaLoopAngrySkill01);
          const onCalmFin = (ev: THREE.AnimationMixerEventMap["finished"]) => {
            if (ev.action !== actForListener) return;
            mixer.removeEventListener("finished", onCalmFin);
            actForListener = null;
            notifyOnce();
          };
          if (calmPick && actions[calmPick]) {
            const act = actions[calmPick]!;
            act.reset();
            applyPlayerHurtClipContactSync(
              act,
              !!rest.isPlayerModel,
              rest.visualState,
              playerHurtStartRef.current,
              !!playerJumpKillRef.current,
            );
            applyMonsterHurtClipContactSync(act, !!rest.isPlayerModel, rest.visualState, monsterHurtStartRef.current);
            if (loops) {
              act.setLoop(THREE.LoopRepeat, Infinity);
              act.clampWhenFinished = false;
            } else {
              act.setLoop(THREE.LoopOnce, 1);
              act.clampWhenFinished = true;
              if (onFinishedRef.current) {
                actForListener = act;
                mixer.addEventListener("finished", onCalmFin);
              }
            }
            act.fadeIn(fadeDuration).play();
          }
          attackToIdleRealignLockRef.current = false;
          prevVisualStateRef.current = rest.visualState;
          invalidate();
        };
        mixer.addEventListener("finished", onWbFin);
        actWb.fadeIn(0.12).play();
        playedClampedStateThisEffectRef.current = true;
        invalidate();
        return () => {
          playedClampedStateThisEffectRef.current = false;
          attackToIdleRealignLockRef.current = false;
          mixer.removeEventListener("finished", onWbFin);
          for (const a of Object.values(actions)) {
            a?.fadeOut(0.12);
          }
        };
      }
    }

    prevVisualStateRef.current = rest.visualState;

    const mergedLocomotionIntoStrike = locomotionHandoffToStrike;

    const outgoingLocomotion = mergedLocomotionIntoStrike
      ? pickLocomotionHandoffOutgoing(
          actions,
          names,
          rest.url,
          prevState,
          !!rest.isPlayerModel,
          rest.monsterType,
          draculaVariantRef.current,
          {
            draculaHurtHp: draculaHurtRef.current,
            draculaHurtStrikeZone: rest.draculaHurtStrikeZone ?? null,
          },
        )
      : null;

    /**
     * `crossFade` already covers `locomotionHandoffToStrike` so we skip `stopAllAction` and blend out hunt/rolling.
     * Still allow an explicit `crossFadeTo` when we can name the outgoing action (often smoother than parallel fades).
     */
    if (!crossFade && !(mergedLocomotionIntoStrike && outgoingLocomotion)) {
      mixer.stopAllAction();
    }

    const glbSlug = glbSlugFromPathOrUrl(rest.url);
    const dHurt = draculaHurtRef.current;
    const hurtCtx =
      dHurt?.hp != null && dHurt?.maxHp != null ? { hp: dHurt.hp, maxHp: dHurt.maxHp } : dHurt ?? null;
    const pick = rest.isPlayerModel
      ? resolvePlayerAnimationClipName(rest.visualState, names, draculaVariantRef.current, {
          fatalJumpKill: playerJumpKillRef.current,
          playerHurtHpLost: playerHurtCtxRef.current?.hpLost,
          playerHurtStrikeZone: playerHurtCtxRef.current?.strikeZone,
          playerAttackClipCycleIndex: playerAttackCycleRef.current,
        })
      : resolveMonsterAnimationClipName(rest.visualState, names, {
          monsterType: rest.monsterType,
          glbSlug,
          draculaAttackVariant: draculaVariantRef.current,
          draculaHurtHp: hurtCtx,
          draculaHurtStrikeZone: rest.draculaHurtStrikeZone ?? null,
          draculaAngryLockSkill01: rest.draculaLoopAngrySkill01 && rest.visualState === "angry",
        });
    const loops = shouldLoopVisualState(rest.visualState, !!rest.draculaLoopAngrySkill01);
    let actForListener: THREE.AnimationAction | null = null;
    let didNotify = false;
    const notifyOnce = () => { if (didNotify) return; didNotify = true; onFinishedRef.current?.(); };
    const onFin = (e: THREE.AnimationMixerEventMap["finished"]) => {
      if (e.action !== actForListener) return;
      mixer.removeEventListener("finished", onFin);
      actForListener = null;
      notifyOnce();
    };
    if (pick && actions[pick]) {
      const act = actions[pick]!;
      act.reset();
      applyPlayerHurtClipContactSync(
        act,
        !!rest.isPlayerModel,
        rest.visualState,
        playerHurtStartRef.current,
        !!playerJumpKillRef.current,
      );
      applyMonsterHurtClipContactSync(act, !!rest.isPlayerModel, rest.visualState, monsterHurtStartRef.current);
      applyPlayerAttackClipSkillLeadIn(act, !!rest.isPlayerModel, rest.visualState, playerAttackLeadRef.current);
      if (loops) { act.setLoop(THREE.LoopRepeat, Infinity); act.clampWhenFinished = false; }
      else { act.setLoop(THREE.LoopOnce, 1); act.clampWhenFinished = true; if (onFinishedRef.current) { actForListener = act; mixer.addEventListener("finished", onFin); } }
      const useLocomotionCross =
        mergedLocomotionIntoStrike &&
        outgoingLocomotion &&
        outgoingLocomotion !== act &&
        (outgoingLocomotion.getEffectiveWeight() > 1e-4 || outgoingLocomotion.isRunning());
      if (useLocomotionCross) {
        act.play();
        outgoingLocomotion.crossFadeTo(act, locomotionHandoffFadeSec, false);
        /** `crossFadeTo` can leave the incoming action at t≈0 for the blend — re-seek player strike contact. */
        applyPlayerAttackClipSkillLeadIn(act, !!rest.isPlayerModel, rest.visualState, playerAttackLeadRef.current);
      } else {
        if (crossFade) { for (const a of Object.values(actions)) { if (a && a !== act) a.fadeOut(fadeDuration); } }
        act.fadeIn(fadeDuration).play();
      }
      playedClampedStateThisEffectRef.current = true;
      if (rest.isPlayerModel && rest.visualState === "attack") {
        prevPlayerAttackTimingKeyRef.current = playerAttackTimingKey;
      }
    }
    invalidate();
    return () => {
      playedClampedStateThisEffectRef.current = false;
      if (actForListener) {
        mixer.removeEventListener("finished", onFin);
        actForListener = null;
      }
      for (const a of Object.values(actions)) {
        a?.fadeOut(0.12);
      }
    };
  }, [
    actions,
    names,
    mixer,
    rest.url,
    rest.visualState,
    rest.monsterType,
    rest.draculaLoopAngrySkill01,
    rest.isPlayerModel,
    rest.draculaAttackVariant,
    rest.playerFatalJumpKill,
    rest.playerHurtClipStartTimeSec,
    playerHurtAnimKey,
    hurtHpKey,
    hurtZoneKey,
    animationSyncKey,
    playerAttackClipLeadInSec,
    playerAttackClipCycleIndex,
    monsterHurtClipStartTimeSec,
    locomotionToAttackFadeSec,
    monsterLocomotionToAttackCrossfadeSec,
  ]);

  const scale =
    (rest.tightFraming ? 1.14 : 1) *
    (rest.isPlayerModel
      ? 0.9
      : rest.monsterType === "V" ||
          rest.monsterType === "K" ||
          rest.monsterType === "Z" ||
          rest.monsterType === "G" ||
          rest.monsterType === "S" ||
          rest.monsterType === "L"
        ? 0.9
        : 1);

  const yRotation = rest.isPlayerModel ? Math.PI / 2 : -Math.PI / 2;

  return (
    <>
      <group ref={setGroupRef} position={[positionX, 0, 0]}>
        <Center>
          <group ref={innerRef} scale={scale} rotation={[0, yRotation, 0]}>
            <primitive object={scene} />
          </group>
        </Center>
      </group>
      {rest.isPlayerModel && weaponUrl ? (
        <WeaponLoadErrorBoundary key={weaponUrl}>
          <Suspense fallback={null}>
            <BoneAttachedWeapon parentScene={scene} url={weaponUrl} />
          </Suspense>
        </WeaponLoadErrorBoundary>
      ) : null}
    </>
  );
}

/**
 * Fixed camera for merged Meshy rigs — stance clips stay pinned while authored
 * one-shot actions may use root motion. Camera stays completely static; no
 * per-state offsets, no movement between clips.
 */
function MeshyCombatCameraFraming({
  enabled,
  baseZ,
  baseY,
  baseFov,
  /** Bump when the viewed GLB set changes so camera + FOV re-apply (no sticky one-shot after monster swap). */
  frameKey,
}: {
  enabled: boolean;
  visualState: Monster3DSpriteState;
  baseZ: number;
  baseY: number;
  baseFov: number;
  frameKey: string;
}) {
  const { camera } = useThree();

  useLayoutEffect(() => {
    if (!enabled) return;
    const cam = camera as THREE.PerspectiveCamera;
    cam.position.set(0, baseY, baseZ);
    cam.fov = baseFov;
    cam.updateProjectionMatrix();
    invalidate();
  }, [camera, enabled, baseZ, baseY, baseFov, frameKey]);

  return null;
}

function Scene({
  url,
  visualState,
  tightFraming,
  monsterType,
  draculaAttackVariant,
  draculaHurtHp,
  draculaHurtStrikeZone,
  draculaLoopAngrySkill01,
  onOneShotAnimationFinished,
  meshyCameraBases,
  isPlayerModel = false,
}: {
  url: string;
  visualState: Monster3DSpriteState;
  tightFraming: boolean;
  monsterType?: MonsterType | null;
  draculaAttackVariant?: "spell" | "skill" | "light";
  draculaHurtHp?: { hp: number; maxHp: number } | null;
  draculaHurtStrikeZone?: StrikeTarget | null;
  draculaLoopAngrySkill01?: boolean;
  onOneShotAnimationFinished?: () => void;
  meshyCameraBases?: { baseZ: number; baseY: number; baseFov: number } | null;
  isPlayerModel?: boolean;
}) {
  return (
    <>
      {meshyCameraBases ? (
        <MeshyCombatCameraFraming
          enabled={
            isPlayerModel ||
            monsterType === "V" ||
            monsterType === "K" ||
            monsterType === "Z" ||
            monsterType === "G" ||
            monsterType === "S" ||
            monsterType === "L"
          }
          visualState={visualState}
          baseZ={meshyCameraBases.baseZ}
          baseY={meshyCameraBases.baseY}
          baseFov={meshyCameraBases.baseFov}
          frameKey={url}
        />
      ) : null}
      <ambientLight intensity={0.38} />
      <directionalLight position={[3.2, 5.5, 2.8]} intensity={1.05} />
      <directionalLight position={[-2.5, 2.5, 4]} intensity={0.35} />
      <GltfSubject
        url={url}
        visualState={visualState}
        tightFraming={tightFraming}
        monsterType={monsterType}
        draculaAttackVariant={draculaAttackVariant}
        draculaHurtHp={draculaHurtHp}
        draculaHurtStrikeZone={draculaHurtStrikeZone}
        draculaLoopAngrySkill01={draculaLoopAngrySkill01}
        onOneShotAnimationFinished={onOneShotAnimationFinished}
        isPlayerModel={isPlayerModel}
      />
    </>
  );
}

/** Lights + animated glTF — use inside `<Canvas>` and `<Suspense>` (e.g. dev reference viewer). */
export function Monster3dGltfSceneContent({
  url,
  visualState,
  tightFraming = false,
  monsterType = null,
  draculaAttackVariant,
  draculaHurtHp,
  draculaHurtStrikeZone,
  draculaLoopAngrySkill01,
  onOneShotAnimationFinished,
  meshyCameraBases = null,
}: {
  url: string;
  visualState: Monster3DSpriteState;
  tightFraming?: boolean;
  monsterType?: MonsterType | null;
  draculaAttackVariant?: "spell" | "skill" | "light";
  draculaHurtHp?: { hp: number; maxHp: number } | null;
  draculaHurtStrikeZone?: StrikeTarget | null;
  draculaLoopAngrySkill01?: boolean;
  onOneShotAnimationFinished?: () => void;
  meshyCameraBases?: { baseZ: number; baseY: number; baseFov: number } | null;
}) {
  return (
    <Scene
      url={url}
      visualState={visualState}
      tightFraming={tightFraming}
      monsterType={monsterType}
      draculaAttackVariant={draculaAttackVariant}
      draculaHurtHp={draculaHurtHp}
      draculaHurtStrikeZone={draculaHurtStrikeZone}
      draculaLoopAngrySkill01={draculaLoopAngrySkill01}
      onOneShotAnimationFinished={onOneShotAnimationFinished}
      meshyCameraBases={meshyCameraBases}
    />
  );
}

/** R3F `camera` prop is only read on mount — cameraZ / cameraY are tied to `tightFraming` via Canvas `key`. */
export function MonsterModel3D({
  gltfPath,
  fallback,
  width,
  height,
  visualState,
  monsterType = null,
  tightFraming = false,
  referenceViewerStyle = false,
  onOneShotAnimationFinished,
  draculaAttackVariant,
  draculaHurtHp,
  draculaHurtStrikeZone,
  draculaLoopAngrySkill01,
}: MonsterModel3DProps) {
  const isDracula = monsterType === "V";
  const isSkeleton = monsterType === "K";
  const isZombie = monsterType === "Z";
  const isSpider = monsterType === "S";
  const isLava = monsterType === "L";
  const isGhost = monsterType === "G";
  const mergedMeshyCombat = isDracula || isSkeleton || isZombie || isGhost || isSpider || isLava;
  const cameraZBase = referenceViewerStyle ? (tightFraming ? 2.2 : 2.85) : tightFraming ? 2.12 : 2.82;
  const cameraYBase = referenceViewerStyle ? (tightFraming ? 0.95 : 1.05) : tightFraming ? 0.98 : 1.06;
  const mergedMeshyCameraZExtra = mergedMeshyCombat ? 0.62 : 0;
  const mergedMeshyCameraYExtra = mergedMeshyCombat ? -0.06 : 0;
  const cameraZ = cameraZBase + mergedMeshyCameraZExtra;
  const cameraY = cameraYBase + mergedMeshyCameraYExtra;
  const fov = referenceViewerStyle ? (mergedMeshyCombat ? 40 : 38) : 36;
  const meshyCameraBases = mergedMeshyCombat ? { baseZ: cameraZ, baseY: cameraY, baseFov: fov } : null;

  /**
   * Keep the previous GLB on screen while a **new URL** is being fetched. `visualState` always
   * passes straight through so clip changes on the *same* GLB never restart via committed-path churn.
   */
  const [committedUrl, setCommittedUrl] = useState(gltfPath);

  useEffect(() => {
    if (gltfPath === committedUrl) return;
    let cancelled = false;
    const ac = new AbortController();
    const run = async () => {
      try {
        const r = await fetch(gltfPath, { signal: ac.signal });
        if (!r.ok) throw new Error(String(r.status));
        await r.arrayBuffer();
        await Promise.resolve(useGLTF.preload(gltfPath) as PromiseLike<unknown> | undefined);
      } catch (err: unknown) {
        if (cancelled || (err instanceof DOMException && err.name === "AbortError")) return;
      }
      if (!cancelled) setCommittedUrl(gltfPath);
    };
    void run();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [gltfPath, committedUrl]);

  const canvasLayoutKey = `${tightFraming ? "tight" : "wide"}-${referenceViewerStyle ? "ref" : "mod"}-${monsterType ?? "?"}`;
  const errorBoundaryKey = `${monsterType ?? "?"}-${canvasLayoutKey}`;

  // Skeletal clips need a continuous frame loop; `demand` only redraws on `invalidate()` and stutters.
  return (
    <ModelErrorBoundary key={errorBoundaryKey} fallback={fallback}>
      <Canvas
        key={canvasLayoutKey}
        style={{
          width,
          height,
          display: "block",
          verticalAlign: "top",
        }}
        frameloop="always"
        dpr={[1, 2]}
        gl={{
          alpha: true,
          antialias: true,
          powerPreference: "high-performance",
        }}
        camera={{ position: [0, cameraY, cameraZ], fov, near: 0.1, far: 80 }}
        onCreated={() => invalidate()}
      >
        <Suspense fallback={null}>
          <Scene
            url={committedUrl}
            visualState={visualState}
            tightFraming={tightFraming}
            monsterType={monsterType}
            draculaAttackVariant={draculaAttackVariant}
            draculaHurtHp={draculaHurtHp}
            draculaHurtStrikeZone={draculaHurtStrikeZone}
            draculaLoopAngrySkill01={draculaLoopAngrySkill01}
            onOneShotAnimationFinished={onOneShotAnimationFinished}
            meshyCameraBases={meshyCameraBases}
          />
        </Suspense>
      </Canvas>
    </ModelErrorBoundary>
  );
}

/** Static (non-animated) GLB prop positioned near the player — weapons / armour pieces. */
function StaticGltfProp({ url, position, scale: s = 0.5, rotationY = 0 }: { url: string; position: [number, number, number]; scale?: number; rotationY?: number }) {
  const { scene } = useGLTF(url);
  useEffect(() => { useGLTF.preload(url); }, [url]);
  const cloned = React.useMemo(() => scene.clone(true), [scene]);
  return (
    <group position={position}>
      <primitive object={cloned} scale={s} rotation={[0, rotationY, 0]} />
    </group>
  );
}

/**
 * Exact names for the **right hand** bone only — never forearm (weapon was sinking “above the wrist” when
 * `RightForeArm` matched before a differently named hand bone).
 */
const RIGHT_HAND_EXACT_NAMES: readonly string[] = [
  "mixamorigRightHand",
  "RightHand",
  "rightHand",
  "Right_Hand",
  "hand_R",
  "Hand_R",
  "CC_Base_R_Hand",
  "R_Hand",
  "Bip001 R Hand",
  "Bip001_R_Hand",
];

function boneNameLooksForearmOrUpper(name: string): boolean {
  const n = name.replace(/\s/g, "");
  return /forearm|lowerarm|upperarm|shoulder|clavicle|elbow|spine|chest|neck|head/i.test(n);
}

function findHandBone(root: THREE.Object3D): THREE.Bone | null {
  for (const name of RIGHT_HAND_EXACT_NAMES) {
    const found = root.getObjectByName(name);
    if (found && (found as THREE.Bone).isBone) return found as THREE.Bone;
  }

  let rightHand: THREE.Bone | null = null;
  let anyHand: THREE.Bone | null = null;
  let leftHand: THREE.Bone | null = null;
  root.traverse((child) => {
    if (!(child as THREE.Bone).isBone) return;
    const n = child.name;
    if (!/(hand|wrist)/i.test(n)) return;
    if (boneNameLooksForearmOrUpper(n)) return;
    const compact = n.replace(/\s/g, "");
    const isRight =
      /right|hand_r|^r_hand|_r_hand|mixamorigright|\.r\.|_r\./i.test(compact) || /Hand_R|HAND_R/i.test(n);
    const isLeft =
      /left|hand_l|^l_hand|_l_hand|mixamorigleft|\.l\.|_l\.|Hand_L|HAND_L/i.test(compact);
    const b = child as THREE.Bone;
    if (isRight && !isLeft) rightHand = b;
    else if (isLeft && !isRight) {
      if (!leftHand) leftHand = b;
    } else if (!isLeft && !isRight && !anyHand) anyHand = b;
  });
  if (rightHand) return rightHand;
  if (anyHand) return anyHand;
  if (leftHand) return leftHand;

  for (const name of ["mixamorigLeftHand", "LeftHand", "leftHand", "Left_Hand", "hand_L", "Hand_L"] as const) {
    const found = root.getObjectByName(name);
    if (found && (found as THREE.Bone).isBone) return found as THREE.Bone;
  }

  for (const name of ["mixamorigRightForeArm", "RightForeArm", "rightForeArm"] as const) {
    const found = root.getObjectByName(name);
    if (found && (found as THREE.Bone).isBone) return found as THREE.Bone;
  }

  return null;
}

const WEAPON_GRIP_FRACTION_FROM_END = 0.12;

export function BoneAttachedWeapon({ parentScene, url }: { parentScene: THREE.Object3D; url: string }) {
  const { scene: weaponScene } = useGLTF(url);
  const weaponClone = React.useMemo(() => weaponScene.clone(true), [weaponScene]);
  const attachedRef = useRef<{ bone: THREE.Bone; container: THREE.Group; alignFromLocal: THREE.Vector3 } | null>(null);
  const orientedRef = useRef(false);

  useEffect(() => { useGLTF.preload(url); }, [url]);

  useEffect(() => {
    const bone = findHandBone(parentScene);
    if (!bone) {
      if (process.env.NODE_ENV !== "production") console.warn("[BoneAttachedWeapon] no hand bone found");
      return;
    }

    const box = new THREE.Box3().setFromObject(weaponClone);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const axisSizes = [size.x, size.y, size.z];
    const longestAxis = axisSizes.indexOf(Math.max(...axisSizes));
    const longestDim = axisSizes[longestAxis] || Math.max(size.x, size.y, size.z);

    const boneWs = new THREE.Vector3();
    bone.getWorldScale(boneWs);
    const avgWs = (boneWs.x + boneWs.y + boneWs.z) / 3;
    const desiredWorldLen = 0.45;
    const localScale = desiredWorldLen / (longestDim * Math.max(avgWs, 0.001));

    const container = new THREE.Group();
    container.name = "__weapon__";

    const scaleGrp = new THREE.Group();
    scaleGrp.scale.setScalar(localScale);

    const offsetGrp = new THREE.Group();
    const gripPoint = center.clone();
    const mins = [box.min.x, box.min.y, box.min.z];
    gripPoint.setComponent(
      longestAxis,
      mins[longestAxis]! + axisSizes[longestAxis]! * WEAPON_GRIP_FRACTION_FROM_END
    );
    offsetGrp.position.copy(gripPoint.multiplyScalar(-1));

    offsetGrp.add(weaponClone);
    scaleGrp.add(offsetGrp);
    container.add(scaleGrp);
    bone.add(container);

    const alignFromLocal = new THREE.Vector3(
      longestAxis === 0 ? 1 : 0,
      longestAxis === 1 ? 1 : 0,
      longestAxis === 2 ? 1 : 0,
    );

    attachedRef.current = { bone, container, alignFromLocal };
    orientedRef.current = false;

    if (process.env.NODE_ENV !== "production") {
      const bones: string[] = [];
      parentScene.traverse((c) => { if ((c as THREE.Bone).isBone) bones.push(c.name); });
      console.log("[BoneAttachedWeapon] bones:", bones.join(", "));
      console.log("[BoneAttachedWeapon] picked:", bone.name, "parent:", bone.parent?.name);
      console.log("[BoneAttachedWeapon] weaponSize:", size.toArray().map(v => +v.toFixed(3)), "localScale:", +localScale.toFixed(4), "longestAxis:", longestAxis, "gripPoint:", gripPoint.toArray().map(v => +v.toFixed(3)));
    }

    return () => {
      bone.remove(container);
      attachedRef.current = null;
      orientedRef.current = false;
    };
  }, [parentScene, weaponClone, url]);

  useFrame(() => {
    const att = attachedRef.current;
    if (!att || orientedRef.current) return;
    const { bone, container, alignFromLocal } = att;

    bone.updateWorldMatrix(true, false);
    const boneQ = new THREE.Quaternion();
    bone.getWorldQuaternion(boneQ);

    const armDirWorld = new THREE.Vector3(0, 1, 0).applyQuaternion(boneQ);

    const worldUp = new THREE.Vector3(0, 1, 0);
    const dot = worldUp.dot(armDirWorld);
    const bladeDirWorld = new THREE.Vector3()
      .copy(worldUp)
      .addScaledVector(armDirWorld, -dot);
    if (bladeDirWorld.lengthSq() < 0.001) bladeDirWorld.set(0, 0, 1);
    bladeDirWorld.normalize();

    const boneQInv = boneQ.clone().invert();
    const bladeDirLocal = bladeDirWorld.applyQuaternion(boneQInv);

    container.quaternion.setFromUnitVectors(
      alignFromLocal,
      bladeDirLocal,
    );

    orientedRef.current = true;
    if (process.env.NODE_ENV !== "production") {
      console.log("[BoneAttachedWeapon] oriented — armDirWorld:", armDirWorld.toArray().map(v => +v.toFixed(3)),
        "bladeDirWorld:", bladeDirWorld.toArray().map(v => +v.toFixed(3)),
        "bladeDirLocal:", bladeDirLocal.toArray().map(v => +v.toFixed(3)));
    }
  });

  return null;
}

export interface CombatScene3DProps {
  monsterGltfPath: string;
  playerGltfPath: string;
  /** Optional weapon/armour GLB parented to the player rig hand (see `BoneAttachedWeapon`). Empty string = none. */
  armourGltfPath?: string | null;
  monsterVisualState: Monster3DSpriteState;
  playerVisualState: Monster3DSpriteState;
  monsterType?: MonsterType | null;
  draculaAttackVariant?: "spell" | "skill" | "light";
  playerAttackVariant?: "spell" | "skill" | "light";
  draculaHurtHp?: { hp: number; maxHp: number } | null;
  /** Dracula: head/body/legs from strike pick — aim-based hurt clips; legs biases knockdown to `falling_down` first. */
  draculaHurtStrikeZone?: StrikeTarget | null;
  draculaLoopAngrySkill01?: boolean;
  /** Lethal Jumping_Punch (spell) — player plays `Shot_and_Fall_Backward` while hurt. */
  playerFatalJumpKill?: boolean;
  /** Monster hit: HP lost + optional strike zone for standing hurt clips (face / waist / fall). */
  playerHurtAnimContext?: { hpLost: number; strikeZone?: StrikeTarget } | null;
  /** Seconds to skip into player `hurt` clip for contact sync with merged monster attack. */
  playerHurtClipStartTimeSec?: number;
  /** Player `attack`: skip into clip (`combat3dContact` / `resolveCombat3dClipLeads`). */
  playerAttackClipLeadInSec?: number;
  /** Player hunt→attack blend per strike tier (`PLAYER_HUNT_TO_ATTACK_CROSSFADE_SEC_BY_TIER` / `resolveCombat3dClipLeads`). */
  playerLocomotionToAttackCrossfadeSec?: number;
  /** Monster hunt→attack blend per tier (`MONSTER_HUNT_TO_ATTACK_CROSSFADE_SEC_BY_TIER`). */
  monsterLocomotionToAttackCrossfadeSec?: number;
  /** Monster `hurt`: skip into reaction clip when player connects (spell/skill rows in `PLAYER_HITS_MONSTER`). */
  monsterHurtClipStartTimeSec?: number;
  /** Rotates player `attack` clip try-order when the same strike tier is picked repeatedly during one roll. */
  playerAttackClipCycleIndex?: number;
  onOneShotAnimationFinished?: () => void;
  width: number;
  height: number;
  fallback: ReactNode;
  /** Tighter default camera + orbit (used for all combat modals — desktop and mobile). */
  compactCombatViewport?: boolean;
  /** When true, orbit is off and taps on the monster pick head / body / legs by screen Y on the mesh bounds. */
  strikePickActive?: boolean;
  onStrikeTargetPick?: (target: StrikeTarget) => void;
  /** While dice roll: 0–1 lerp from idle spacing toward close range (fighters advance). */
  rollingApproachBlend?: number;
  /**
   * When set (face-off lab only), both rigs restart their clips from the same key change — paired sync.
   * Do not pass from `LabyrinthGame` (would restart every unrelated render if mis-keyed).
   */
  faceOffAnimationSyncKey?: string;
}

/** Same vertical splits as `CombatStrikeZonePicker` raycast (legs / body / head). */
const STRIKE_ZONE_Y_T0 = 0.28;
const STRIKE_ZONE_Y_T1 = 0.62;

function CombatStrikeZonePicker({
  monsterRootRef,
  enabled,
  onPick,
}: {
  monsterRootRef: React.MutableRefObject<THREE.Group | null>;
  enabled: boolean;
  onPick: (zone: StrikeTarget) => void;
}) {
  const { camera, gl } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const ndc = useMemo(() => new THREE.Vector2(), []);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  useEffect(() => {
    if (!enabled) return;
    const el = gl.domElement;
    const onDown = (e: PointerEvent) => {
      const root = monsterRootRef.current;
      if (!root) return;
      const rect = el.getBoundingClientRect();
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObject(root, true);
      if (hits.length === 0) return;
      root.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(root);
      if (box.isEmpty()) return;
      const h = box.max.y - box.min.y;
      if (h < 1e-4) return;
      const pt = hits[0]!.point;
      const t = (pt.y - box.min.y) / h;
      const zone: StrikeTarget =
        t >= STRIKE_ZONE_Y_T1 ? "head" : t >= STRIKE_ZONE_Y_T0 ? "body" : "legs";
      onPickRef.current(zone);
    };
    el.addEventListener("pointerdown", onDown);
    return () => el.removeEventListener("pointerdown", onDown);
  }, [enabled, camera, gl, monsterRootRef, ndc, raycaster]);
  return null;
}

/** Inside Canvas + Suspense: after both GLTF mixers exist, bump a stamp so clips start together (avoids staggered load). */
function CombatFaceOffPairedSubjects({
  faceOffAnimationSyncKey,
  pUrl,
  mUrl,
  playerEl,
  monsterEl,
}: {
  faceOffAnimationSyncKey: string;
  pUrl: string;
  mUrl: string;
  playerEl: React.ReactElement;
  monsterEl: React.ReactElement;
}) {
  const [pairStamp, setPairStamp] = useState(-1);
  const [gateToken, setGateToken] = useState(0);
  const gateReadyRef = useRef({ player: false, monster: false });
  const ackTokenRef = useRef({ player: -1, monster: -1 });
  /** Monotonic suffix so `|pairN` never collides after URL swaps (face-off key string may repeat). */
  const pairSeqRef = useRef(0);
  const syncBase = `${pUrl}\0${mUrl}\0${faceOffAnimationSyncKey}`;
  const prevBaseRef = useRef("");

  useLayoutEffect(() => {
    if (prevBaseRef.current === syncBase) return;
    const prev = prevBaseRef.current;
    prevBaseRef.current = syncBase;
    gateReadyRef.current = { player: false, monster: false };
    ackTokenRef.current = { player: -1, monster: -1 };
    setGateToken((t) => t + 1);
    if (prev !== "") {
      const [pp, pm] = prev.split("\0");
      const [np, nm] = syncBase.split("\0");
      if (pp !== np || pm !== nm) setPairStamp(-1);
    }
  }, [syncBase]);

  const onPairPlaybackMixerReady = useCallback(
    (role: "player" | "monster", token: number) => {
      if (token !== gateToken) return;
      if (role === "player") {
        if (ackTokenRef.current.player === token) return;
        ackTokenRef.current.player = token;
      } else {
        if (ackTokenRef.current.monster === token) return;
        ackTokenRef.current.monster = token;
      }
      gateReadyRef.current[role] = true;
      if (gateReadyRef.current.player && gateReadyRef.current.monster) {
        setPairStamp((p) => {
          if (p >= 0) return p;
          pairSeqRef.current += 1;
          return pairSeqRef.current;
        });
      }
    },
    [gateToken]
  );

  const animationSyncKey =
    faceOffAnimationSyncKey && pairStamp >= 0
      ? `${faceOffAnimationSyncKey}|pair${pairStamp}`
      : undefined;

  return (
    <>
      {React.cloneElement(playerEl, {
        animationSyncKey,
        pairGateToken: gateToken,
        pairPlaybackRole: "player" as const,
        onPairPlaybackMixerReady,
      })}
      {React.cloneElement(monsterEl, {
        animationSyncKey,
        pairGateToken: gateToken,
        pairPlaybackRole: "monster" as const,
        onPairPlaybackMixerReady,
      })}
    </>
  );
}

/** Wheel / dolly zoom stays centered on the orbit target (no drei damping drift; no two-finger pan mixed into pinch). */
function CombatOrbitControls({
  orbitMinD,
  orbitMaxD,
  orbitTargetY,
  minPolarAngle,
  maxPolarAngle,
  enabled = true,
  /** When GLB paths change, reset camera + target so fighters are not framed “nowhere” after orbit drift / canvas reuse. */
  sceneAnchorKey,
  initialCameraPosition,
}: {
  orbitMinD: number;
  orbitMaxD: number;
  orbitTargetY: number;
  minPolarAngle: number;
  maxPolarAngle: number;
  enabled?: boolean;
  sceneAnchorKey: string;
  initialCameraPosition: readonly [number, number, number];
}) {
  const { camera } = useThree();
  const orbitRef = useRef<OrbitControlsImpl>(null);
  const targetArr = useMemo(
    (): [number, number, number] => [0, orbitTargetY, 0],
    [orbitTargetY]
  );
  const syncedRef = useRef(false);

  useEffect(() => {
    const c = camera as THREE.PerspectiveCamera;
    c.position.set(initialCameraPosition[0], initialCameraPosition[1], initialCameraPosition[2]);
    c.up.set(0, 1, 0);
    c.updateProjectionMatrix();
    const oc = orbitRef.current;
    if (oc) {
      oc.target.set(0, orbitTargetY, 0);
      oc.update();
    }
    syncedRef.current = false;
    invalidate();
  }, [sceneAnchorKey, camera, initialCameraPosition, orbitTargetY]);

  useFrame(() => {
    const oc = orbitRef.current;
    if (!oc) return;
    if (!syncedRef.current) {
      oc.target.set(0, orbitTargetY, 0);
      oc.zoomToCursor = false;
      oc.screenSpacePanning = false;
      oc.update();
      syncedRef.current = true;
    }
  });

  useEffect(() => {
    syncedRef.current = false;
  }, [orbitTargetY]);

  return (
    <OrbitControls
      ref={orbitRef}
      enabled={enabled}
      enableDamping={false}
      enablePan={false}
      zoomToCursor={false}
      screenSpacePanning={false}
      enableZoom
      enableRotate
      minDistance={orbitMinD}
      maxDistance={orbitMaxD}
      minPolarAngle={minPolarAngle}
      maxPolarAngle={maxPolarAngle}
      target={targetArr}
      touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE }}
    />
  );
}

export function CombatScene3D({
  monsterGltfPath,
  playerGltfPath,
  armourGltfPath,
  monsterVisualState,
  playerVisualState,
  monsterType = null,
  draculaAttackVariant,
  playerAttackVariant,
  draculaHurtHp,
  draculaHurtStrikeZone,
  draculaLoopAngrySkill01,
  playerFatalJumpKill = false,
  playerHurtAnimContext = null,
  playerHurtClipStartTimeSec = 0,
  playerAttackClipLeadInSec = 0,
  playerLocomotionToAttackCrossfadeSec,
  monsterLocomotionToAttackCrossfadeSec,
  monsterHurtClipStartTimeSec = 0,
  playerAttackClipCycleIndex = 0,
  onOneShotAnimationFinished,
  width,
  height,
  fallback,
  compactCombatViewport = false,
  strikePickActive = false,
  onStrikeTargetPick,
  rollingApproachBlend = 0,
  faceOffAnimationSyncKey,
}: CombatScene3DProps) {
  const monsterHitRootRef = useRef<THREE.Group | null>(null);
  const isMergedMeshy =
    monsterType === "V" || monsterType === "K" || monsterType === "Z" || monsterType === "G" || monsterType === "S" || monsterType === "L";
  const cameraZ = compactCombatViewport ? 3.28 : 5.35;
  const cameraY = compactCombatViewport ? 0.92 : 1.0;
  const fov = compactCombatViewport ? 50 : 40;
  const meshyCameraBases = { baseZ: cameraZ, baseY: cameraY, baseFov: fov };
  const orbitMinD = compactCombatViewport ? 1.12 : 2;
  const orbitMaxD = compactCombatViewport ? 5.8 : 10;
  const orbitTargetY = compactCombatViewport ? 0.56 : 0.8;

  const isContactExchange =
    (playerVisualState === "attack" || playerVisualState === "angry" || playerVisualState === "hurt" || playerVisualState === "knockdown") &&
    (monsterVisualState === "attack" || monsterVisualState === "hurt" || monsterVisualState === "knockdown" || monsterVisualState === "angry");
  const { playerPosX, monsterPosX } = useMemo(
    () =>
      combatFaceOffPositions({
        strikePickActive,
        isContactExchange,
        rollingApproachBlend,
        playerVisualState,
        monsterVisualState,
        playerAttackVariant,
        draculaAttackVariant,
      }),
    [
      strikePickActive,
      isContactExchange,
      rollingApproachBlend,
      playerVisualState,
      monsterVisualState,
      playerAttackVariant,
      draculaAttackVariant,
    ]
  );

  /** Keep in sync with props immediately — delayed updates caused wrong GLB + new `monsterType` (clip lists) in labs/combat. */
  const [mUrl, setMUrl] = useState(monsterGltfPath);
  const [pUrl, setPUrl] = useState(playerGltfPath);

  useEffect(() => {
    setMUrl(monsterGltfPath);
  }, [monsterGltfPath]);

  useEffect(() => {
    setPUrl(playerGltfPath);
  }, [playerGltfPath]);

  useEffect(() => {
    const ac = new AbortController();
    void (async () => {
      try {
        const r = await fetch(monsterGltfPath, { signal: ac.signal });
        if (!r.ok) throw 0;
        await r.arrayBuffer();
        await Promise.resolve(useGLTF.preload(monsterGltfPath) as PromiseLike<unknown> | undefined);
      } catch {
        /* preload best-effort — `mUrl` already matches prop */
      }
    })();
    return () => {
      ac.abort();
    };
  }, [monsterGltfPath]);

  useEffect(() => {
    const ac = new AbortController();
    void (async () => {
      try {
        const r = await fetch(playerGltfPath, { signal: ac.signal });
        if (!r.ok) throw 0;
        await r.arrayBuffer();
        await Promise.resolve(useGLTF.preload(playerGltfPath) as PromiseLike<unknown> | undefined);
      } catch {
        /* preload best-effort */
      }
    })();
    return () => {
      ac.abort();
    };
  }, [playerGltfPath]);

  /** Stable canvas identity: not monster type / URLs — swapping GLB only remounts `PositionedGltfSubject` via `key={url}`. */
  const canvasKey = `meshy-combat-${width}`;
  const sceneAnchorKey = `${monsterGltfPath}|${playerGltfPath}`;
  const initialCombatCamera = useMemo(
    (): readonly [number, number, number] => [0, cameraY, cameraZ],
    [cameraY, cameraZ],
  );

  return (
    <ModelErrorBoundary key={canvasKey} fallback={fallback}>
      <div style={{ width: "100%", maxWidth: width, cursor: strikePickActive ? "crosshair" : undefined }}>
      <Canvas
        key={canvasKey}
        style={{ width: "100%", maxWidth: width, height, display: "block", verticalAlign: "top" }}
        frameloop="always"
        dpr={[1, 2]}
        gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
        camera={{ position: [0, cameraY, cameraZ], fov, near: 0.1, far: 80 }}
        onCreated={() => invalidate()}
      >
        <Suspense fallback={null}>
          <MeshyCombatCameraFraming
            enabled={isMergedMeshy}
            visualState={monsterVisualState}
            baseZ={meshyCameraBases.baseZ}
            baseY={meshyCameraBases.baseY}
            baseFov={meshyCameraBases.baseFov}
            frameKey={sceneAnchorKey}
          />
          <CombatOrbitControls
            orbitMinD={orbitMinD}
            orbitMaxD={orbitMaxD}
            orbitTargetY={orbitTargetY}
            minPolarAngle={Math.PI / 6}
            maxPolarAngle={Math.PI / 2}
            enabled={!strikePickActive}
            sceneAnchorKey={sceneAnchorKey}
            initialCameraPosition={initialCombatCamera}
          />
          <ambientLight intensity={0.38} />
          <directionalLight position={[3.2, 5.5, 2.8]} intensity={1.05} />
          <directionalLight position={[-2.5, 2.5, 4]} intensity={0.35} />
          {faceOffAnimationSyncKey != null && faceOffAnimationSyncKey !== "" ? (
            <CombatFaceOffPairedSubjects
              faceOffAnimationSyncKey={faceOffAnimationSyncKey}
              pUrl={pUrl}
              mUrl={mUrl}
              playerEl={
                <PositionedGltfSubject
                  key={pUrl}
                  url={pUrl}
                  visualState={playerVisualState}
                  tightFraming={false}
                  isPlayerModel
                  draculaAttackVariant={playerAttackVariant}
                  playerFatalJumpKill={playerFatalJumpKill}
                  playerHurtAnimContext={playerHurtAnimContext}
                  playerHurtClipStartTimeSec={playerHurtClipStartTimeSec}
                  playerAttackClipLeadInSec={playerAttackClipLeadInSec}
                  playerLocomotionToAttackCrossfadeSec={playerLocomotionToAttackCrossfadeSec}
                  playerAttackClipCycleIndex={playerAttackClipCycleIndex}
                  positionX={playerPosX}
                  weaponUrl={armourGltfPath}
                />
              }
              monsterEl={
                <PositionedGltfSubject
                  key={mUrl}
                  url={mUrl}
                  visualState={monsterVisualState}
                  tightFraming={false}
                  monsterType={monsterType}
                  draculaAttackVariant={draculaAttackVariant}
                  draculaHurtHp={draculaHurtHp}
                  draculaHurtStrikeZone={draculaHurtStrikeZone}
                  draculaLoopAngrySkill01={draculaLoopAngrySkill01}
                  onOneShotAnimationFinished={onOneShotAnimationFinished}
                  positionX={monsterPosX}
                  hitRootRef={monsterHitRootRef}
                  monsterHurtClipStartTimeSec={monsterHurtClipStartTimeSec}
                  monsterLocomotionToAttackCrossfadeSec={monsterLocomotionToAttackCrossfadeSec}
                />
              }
            />
          ) : (
            <>
              <PositionedGltfSubject
                key={pUrl}
                url={pUrl}
                visualState={playerVisualState}
                tightFraming={false}
                isPlayerModel
                draculaAttackVariant={playerAttackVariant}
                playerFatalJumpKill={playerFatalJumpKill}
                playerHurtAnimContext={playerHurtAnimContext}
                playerHurtClipStartTimeSec={playerHurtClipStartTimeSec}
                playerAttackClipLeadInSec={playerAttackClipLeadInSec}
                playerLocomotionToAttackCrossfadeSec={playerLocomotionToAttackCrossfadeSec}
                playerAttackClipCycleIndex={playerAttackClipCycleIndex}
                positionX={playerPosX}
                weaponUrl={armourGltfPath}
              />
              <PositionedGltfSubject
                key={mUrl}
                url={mUrl}
                visualState={monsterVisualState}
                tightFraming={false}
                monsterType={monsterType}
                draculaAttackVariant={draculaAttackVariant}
                draculaHurtHp={draculaHurtHp}
                draculaHurtStrikeZone={draculaHurtStrikeZone}
                draculaLoopAngrySkill01={draculaLoopAngrySkill01}
                onOneShotAnimationFinished={onOneShotAnimationFinished}
                positionX={monsterPosX}
                hitRootRef={monsterHitRootRef}
                monsterHurtClipStartTimeSec={monsterHurtClipStartTimeSec}
                monsterLocomotionToAttackCrossfadeSec={monsterLocomotionToAttackCrossfadeSec}
              />
            </>
          )}
          {strikePickActive && onStrikeTargetPick ? (
            <CombatStrikeZonePicker
              monsterRootRef={monsterHitRootRef}
              enabled
              onPick={onStrikeTargetPick}
            />
          ) : null}
        </Suspense>
      </Canvas>
      </div>
    </ModelErrorBoundary>
  );
}

export interface PlayerModel3DProps {
  gltfPath: string;
  fallback: ReactNode;
  width: number;
  height: number;
  visualState: Monster3DSpriteState;
  attackVariant?: "spell" | "skill" | "light";
  onOneShotAnimationFinished?: () => void;
}

export function PlayerModel3D({
  gltfPath,
  fallback,
  width,
  height,
  visualState,
  attackVariant,
  onOneShotAnimationFinished,
}: PlayerModel3DProps) {
  const cameraZ = 3.44;
  const cameraY = 1.0;
  const fov = 40;
  const meshyCameraBases = { baseZ: cameraZ, baseY: cameraY, baseFov: fov };

  const [committedUrl, setCommittedUrl] = useState(gltfPath);

  useEffect(() => {
    if (gltfPath === committedUrl) return;
    let cancelled = false;
    const ac = new AbortController();
    const run = async () => {
      try {
        const r = await fetch(gltfPath, { signal: ac.signal });
        if (!r.ok) throw new Error(String(r.status));
        await r.arrayBuffer();
        await Promise.resolve(useGLTF.preload(gltfPath) as PromiseLike<unknown> | undefined);
      } catch (err: unknown) {
        if (cancelled || (err instanceof DOMException && err.name === "AbortError")) return;
      }
      if (!cancelled) setCommittedUrl(gltfPath);
    };
    void run();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [gltfPath, committedUrl]);

  const canvasLayoutKey = `player-${width}-${height}`;

  return (
    <ModelErrorBoundary key={canvasLayoutKey} fallback={fallback}>
      <Canvas
        key={canvasLayoutKey}
        style={{ width, height, display: "block", verticalAlign: "top" }}
        frameloop="always"
        dpr={[1, 2]}
        gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
        camera={{ position: [0, cameraY, cameraZ], fov, near: 0.1, far: 80 }}
        onCreated={() => invalidate()}
      >
        <Suspense fallback={null}>
          <Scene
            url={committedUrl}
            visualState={visualState}
            tightFraming={false}
            isPlayerModel
            draculaAttackVariant={attackVariant}
            onOneShotAnimationFinished={onOneShotAnimationFinished}
            meshyCameraBases={meshyCameraBases}
          />
        </Suspense>
      </Canvas>
    </ModelErrorBoundary>
  );
}
