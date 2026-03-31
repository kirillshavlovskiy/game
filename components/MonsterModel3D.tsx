"use client";

import React, {
  Component,
  Suspense,
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
import { glbSlugFromPathOrUrl, resolveMonsterAnimationClipName, resolvePlayerAnimationClipName } from "@/lib/monsterModels3d";

/**
 * World X half-separation (|playerX| = |monsterX|). Looping stances lock armature root; one-shot attacks
 * keep baked root motion. Spell/jump clips (Jumping_Punch, spins) travel forward in authoring space —
 * if this half-gap is too large, the swing peaks short of the defender; too small, overshoot / interpenetrate.
 * Tuned against merged player + monster GLBs in the face-off box.
 */
const COMBAT_IDLE_SEPARATION_HALF = 1.38;
const COMBAT_STRIKE_PICK_SEPARATION_HALF = 0.92;

function combatContactHalfXForVariant(variant: "spell" | "skill" | "light" | undefined): number {
  const v = variant ?? "light";
  if (v === "spell") return 0.11;
  if (v === "skill") return 0.34;
  return 0.32;
}

function combatFaceOffPositions(args: {
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
    strikePickActive,
    isContactExchange,
    rollingApproachBlend,
    playerVisualState,
    monsterVisualState,
    playerAttackVariant,
    draculaAttackVariant,
  } = args;
  if (strikePickActive) {
    const h = COMBAT_STRIKE_PICK_SEPARATION_HALF;
    return { playerPosX: -h, monsterPosX: h };
  }
  if (!isContactExchange) {
    const idle = COMBAT_IDLE_SEPARATION_HALF;
    const t = Math.max(0, Math.min(1, rollingApproachBlend));
    const close = COMBAT_STRIKE_PICK_SEPARATION_HALF;
    const h = idle * (1 - t) + close * t;
    return { playerPosX: -h, monsterPosX: h };
  }
  const pAtk = playerVisualState === "attack";
  const mAtk = monsterVisualState === "attack";
  let half: number;
  if (pAtk && !mAtk) {
    half = combatContactHalfXForVariant(playerAttackVariant);
  } else if (mAtk && !pAtk) {
    half = combatContactHalfXForVariant(draculaAttackVariant);
  } else if (pAtk && mAtk) {
    half = Math.max(
      combatContactHalfXForVariant(playerAttackVariant),
      combatContactHalfXForVariant(draculaAttackVariant)
    );
  } else {
    half = 0.32;
  }
  return { playerPosX: -half, monsterPosX: half };
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

function GltfSubject({
  url,
  visualState,
  tightFraming,
  monsterType,
  draculaAttackVariant,
  draculaHurtHp,
  draculaLoopAngrySkill01 = false,
  onOneShotAnimationFinished,
  isPlayerModel = false,
  playerFatalJumpKill = false,
}: {
  url: string;
  visualState: Monster3DSpriteState;
  tightFraming: boolean;
  monsterType?: MonsterType | null;
  draculaAttackVariant?: "spell" | "skill" | "light";
  draculaHurtHp?: { hp: number; maxHp: number } | null;
  draculaLoopAngrySkill01?: boolean;
  onOneShotAnimationFinished?: () => void;
  isPlayerModel?: boolean;
  /** Lethal spell strike (e.g. Jumping_Punch) — prefer `Shot_and_Fall_Backward` on player `hurt`. */
  playerFatalJumpKill?: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const { scene, animations } = useGLTF(url);
  const { actions, names, mixer } = useAnimations(animations, groupRef);
  const onFinishedRef = useRef(onOneShotAnimationFinished);
  onFinishedRef.current = onOneShotAnimationFinished;
  const prevVisualStateRef = useRef<Monster3DSpriteState>(visualState);
  const draculaVariantRef = useRef(draculaAttackVariant);
  draculaVariantRef.current = draculaAttackVariant;
  const draculaHurtRef = useRef(draculaHurtHp);
  draculaHurtRef.current = draculaHurtHp;
  const playerJumpKillRef = useRef(playerFatalJumpKill);
  playerJumpKillRef.current = playerFatalJumpKill;

  useRootMotionLock(scene, shouldLockRootMotionForState(visualState, !!draculaLoopAngrySkill01));

  useEffect(() => {
    useGLTF.preload(url);
  }, [url]);

  useEffect(() => {
    const prevState = prevVisualStateRef.current;
    prevVisualStateRef.current = visualState;

    // Skip replaying a clamped one-shot clip (e.g. defeated) when re-rendered with the same state.
    const sameAsClampedPrev =
      prevState === visualState &&
      !shouldLoopVisualState(visualState, !!draculaLoopAngrySkill01);
    if (sameAsClampedPrev) return;

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
      (prevState === "recover" && (visualState === "idle" || visualState === "neutral"));
    const fadeDuration = crossFade ? 0.4 : 0.18;

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
        })
      : resolveMonsterAnimationClipName(visualState, names, {
      monsterType,
      glbSlug,
      draculaAttackVariant: draculaVariantRef.current,
      draculaHurtHp: hurtCtx,
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
    }

    invalidate();
    return () => {
      if (actForListener) {
        mixer.removeEventListener("finished", onMixerFinished);
        actForListener = null;
      }
      for (const a of Object.values(actions)) {
        a?.fadeOut(0.12);
      }
    };
  }, [actions, names, mixer, url, visualState, monsterType, draculaLoopAngrySkill01, isPlayerModel]);

  useEffect(() => {
    invalidate();
  }, [url, tightFraming]);

  /** Merged Meshy rigs (Dracula + skeleton): same scale in combat so framing matches. */
  const scale = (tightFraming ? 1.14 : 1) * (isPlayerModel ? 0.9 : (monsterType === "V" || monsterType === "K" || monsterType === "Z" || monsterType === "S" || monsterType === "L" ? 0.9 : 1));

  return (
    <Center>
      <group ref={groupRef} scale={scale} rotation={isPlayerModel ? [0, Math.PI, 0] : undefined}>
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
  }
) {
  const { positionX = 0, weaponUrl, hitRootRef, ...rest } = props;
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
  const prevVisualStateRef = useRef<Monster3DSpriteState>(rest.visualState);
  const draculaVariantRef = useRef(rest.draculaAttackVariant);
  draculaVariantRef.current = rest.draculaAttackVariant;
  const draculaHurtRef = useRef(rest.draculaHurtHp);
  draculaHurtRef.current = rest.draculaHurtHp;
  const playerJumpKillRef = useRef(rest.playerFatalJumpKill);
  playerJumpKillRef.current = rest.playerFatalJumpKill;

  useRootMotionLock(scene, shouldLockRootMotionForState(rest.visualState, !!rest.draculaLoopAngrySkill01));

  useEffect(() => { useGLTF.preload(rest.url); }, [rest.url]);

  useEffect(() => {
    const prevState = prevVisualStateRef.current;
    prevVisualStateRef.current = rest.visualState;
    const sameAsClampedPrev =
      prevState === rest.visualState &&
      !shouldLoopVisualState(rest.visualState, !!rest.draculaLoopAngrySkill01);
    if (sameAsClampedPrev) return;
    const crossFade =
      (prevState === "knockdown" && (rest.visualState === "recover" || rest.visualState === "defeated")) ||
      (prevState === "hurt" && rest.visualState === "recover") ||
      (prevState === "recover" && (rest.visualState === "idle" || rest.visualState === "neutral"));
    const fadeDuration = crossFade ? 0.4 : 0.18;
    if (!crossFade) mixer.stopAllAction();

    const glbSlug = glbSlugFromPathOrUrl(rest.url);
    const dHurt = draculaHurtRef.current;
    const hurtCtx =
      dHurt?.hp != null && dHurt?.maxHp != null ? { hp: dHurt.hp, maxHp: dHurt.maxHp } : dHurt ?? null;
    const pick = rest.isPlayerModel
      ? resolvePlayerAnimationClipName(rest.visualState, names, draculaVariantRef.current, {
          fatalJumpKill: playerJumpKillRef.current,
        })
      : resolveMonsterAnimationClipName(rest.visualState, names, {
          monsterType: rest.monsterType,
          glbSlug,
          draculaAttackVariant: draculaVariantRef.current,
          draculaHurtHp: hurtCtx,
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
      if (loops) { act.setLoop(THREE.LoopRepeat, Infinity); act.clampWhenFinished = false; }
      else { act.setLoop(THREE.LoopOnce, 1); act.clampWhenFinished = true; if (onFinishedRef.current) { actForListener = act; mixer.addEventListener("finished", onFin); } }
      if (crossFade) { for (const a of Object.values(actions)) { if (a && a !== act) a.fadeOut(fadeDuration); } }
      act.fadeIn(fadeDuration).play();
    }
    invalidate();
    return () => { if (actForListener) { mixer.removeEventListener("finished", onFin); actForListener = null; } for (const a of Object.values(actions)) { a?.fadeOut(0.12); } };
  }, [actions, names, mixer, rest.url, rest.visualState, rest.monsterType, rest.draculaLoopAngrySkill01, rest.isPlayerModel]);

  const scale = (rest.tightFraming ? 1.14 : 1) * (rest.isPlayerModel ? 0.9 : (rest.monsterType === "V" || rest.monsterType === "K" || rest.monsterType === "Z" || rest.monsterType === "S" || rest.monsterType === "L" ? 0.9 : 1));

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
        <BoneAttachedWeapon parentScene={scene} url={weaponUrl} />
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
}: {
  enabled: boolean;
  visualState: Monster3DSpriteState;
  baseZ: number;
  baseY: number;
  baseFov: number;
}) {
  const { camera } = useThree();
  const appliedRef = useRef(false);

  useLayoutEffect(() => {
    if (!enabled || appliedRef.current) return;
    appliedRef.current = true;
    const cam = camera as THREE.PerspectiveCamera;
    cam.position.set(0, baseY, baseZ);
    cam.fov = baseFov;
    cam.updateProjectionMatrix();
    invalidate();
  }, [camera, enabled, baseZ, baseY, baseFov]);

  return null;
}

function Scene({
  url,
  visualState,
  tightFraming,
  monsterType,
  draculaAttackVariant,
  draculaHurtHp,
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
  draculaLoopAngrySkill01?: boolean;
  onOneShotAnimationFinished?: () => void;
  meshyCameraBases?: { baseZ: number; baseY: number; baseFov: number } | null;
  isPlayerModel?: boolean;
}) {
  return (
    <>
      {meshyCameraBases ? (
        <MeshyCombatCameraFraming
          enabled={isPlayerModel || monsterType === "V" || monsterType === "K" || monsterType === "Z" || monsterType === "S" || monsterType === "L"}
          visualState={visualState}
          baseZ={meshyCameraBases.baseZ}
          baseY={meshyCameraBases.baseY}
          baseFov={meshyCameraBases.baseFov}
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
  draculaLoopAngrySkill01,
}: MonsterModel3DProps) {
  const isDracula = monsterType === "V";
  const isSkeleton = monsterType === "K";
  const isZombie = monsterType === "Z";
  const isSpider = monsterType === "S";
  const isLava = monsterType === "L";
  const mergedMeshyCombat = isDracula || isSkeleton || isZombie || isSpider || isLava;
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

/** Common hand-bone names across Mixamo / Meshy rigs (right hand preferred for weapons). */
const HAND_BONE_CANDIDATES = [
  "mixamorigRightHand",
  "RightHand",
  "rightHand",
  "Right_Hand",
  "hand_R",
  "Hand_R",
  "mixamorigRightForeArm",
  "RightForeArm",
  "mixamorigLeftHand",
  "LeftHand",
] as const;

function findHandBone(root: THREE.Object3D): THREE.Bone | null {
  for (const name of HAND_BONE_CANDIDATES) {
    const found = root.getObjectByName(name);
    if (found && (found as THREE.Bone).isBone) return found as THREE.Bone;
  }
  let fallback: THREE.Bone | null = null;
  root.traverse((child) => {
    if (!fallback && (child as THREE.Bone).isBone && /hand|wrist/i.test(child.name)) {
      fallback = child as THREE.Bone;
    }
  });
  return fallback;
}

const WEAPON_GRIP_FRACTION_FROM_END = 0.12;

function BoneAttachedWeapon({ parentScene, url }: { parentScene: THREE.Object3D; url: string }) {
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
  /** Optional weapon/armour GLB rendered as a static prop near the player. Empty string = none. */
  armourGltfPath?: string | null;
  monsterVisualState: Monster3DSpriteState;
  playerVisualState: Monster3DSpriteState;
  monsterType?: MonsterType | null;
  draculaAttackVariant?: "spell" | "skill" | "light";
  playerAttackVariant?: "spell" | "skill" | "light";
  draculaHurtHp?: { hp: number; maxHp: number } | null;
  draculaLoopAngrySkill01?: boolean;
  /** Lethal Jumping_Punch (spell) — player plays `Shot_and_Fall_Backward` while hurt. */
  playerFatalJumpKill?: boolean;
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

/** Wheel / dolly zoom stays centered on the orbit target (no drei damping drift; no two-finger pan mixed into pinch). */
function CombatOrbitControls({
  orbitMinD,
  orbitMaxD,
  orbitTargetY,
  minPolarAngle,
  maxPolarAngle,
  enabled = true,
}: {
  orbitMinD: number;
  orbitMaxD: number;
  orbitTargetY: number;
  minPolarAngle: number;
  maxPolarAngle: number;
  enabled?: boolean;
}) {
  const orbitRef = useRef<OrbitControlsImpl>(null);
  const targetArr = useMemo(
    (): [number, number, number] => [0, orbitTargetY, 0],
    [orbitTargetY]
  );
  const syncedRef = useRef(false);

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
  draculaLoopAngrySkill01,
  playerFatalJumpKill = false,
  onOneShotAnimationFinished,
  width,
  height,
  fallback,
  compactCombatViewport = false,
  strikePickActive = false,
  onStrikeTargetPick,
  rollingApproachBlend = 0,
}: CombatScene3DProps) {
  const monsterHitRootRef = useRef<THREE.Group | null>(null);
  const isMergedMeshy = monsterType === "V" || monsterType === "K" || monsterType === "Z" || monsterType === "S" || monsterType === "L";
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

  const [mUrl, setMUrl] = useState(monsterGltfPath);
  const [pUrl, setPUrl] = useState(playerGltfPath);

  useEffect(() => {
    if (monsterGltfPath === mUrl) return;
    let c = false;
    const ac = new AbortController();
    (async () => {
      try { const r = await fetch(monsterGltfPath, { signal: ac.signal }); if (!r.ok) throw 0; await r.arrayBuffer(); await Promise.resolve(useGLTF.preload(monsterGltfPath) as PromiseLike<unknown> | undefined); } catch { if (c) return; }
      if (!c) setMUrl(monsterGltfPath);
    })();
    return () => { c = true; ac.abort(); };
  }, [monsterGltfPath, mUrl]);

  useEffect(() => {
    if (playerGltfPath === pUrl) return;
    let c = false;
    const ac = new AbortController();
    (async () => {
      try { const r = await fetch(playerGltfPath, { signal: ac.signal }); if (!r.ok) throw 0; await r.arrayBuffer(); await Promise.resolve(useGLTF.preload(playerGltfPath) as PromiseLike<unknown> | undefined); } catch { if (c) return; }
      if (!c) setPUrl(playerGltfPath);
    })();
    return () => { c = true; ac.abort(); };
  }, [playerGltfPath, pUrl]);

  const canvasKey = `combat-${monsterType ?? "?"}-${width}`;

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
          />
          <CombatOrbitControls
            orbitMinD={orbitMinD}
            orbitMaxD={orbitMaxD}
            orbitTargetY={orbitTargetY}
            minPolarAngle={Math.PI / 6}
            maxPolarAngle={Math.PI / 2}
            enabled={!strikePickActive}
          />
          <ambientLight intensity={0.38} />
          <directionalLight position={[3.2, 5.5, 2.8]} intensity={1.05} />
          <directionalLight position={[-2.5, 2.5, 4]} intensity={0.35} />
          <PositionedGltfSubject
            url={pUrl}
            visualState={playerVisualState}
            tightFraming={false}
            isPlayerModel
            draculaAttackVariant={playerAttackVariant}
            playerFatalJumpKill={playerFatalJumpKill}
            positionX={playerPosX}
            weaponUrl={armourGltfPath}
          />
          <PositionedGltfSubject
            url={mUrl}
            visualState={monsterVisualState}
            tightFraming={false}
            monsterType={monsterType}
            draculaAttackVariant={draculaAttackVariant}
            draculaHurtHp={draculaHurtHp}
            draculaLoopAngrySkill01={draculaLoopAngrySkill01}
            onOneShotAnimationFinished={onOneShotAnimationFinished}
            positionX={monsterPosX}
            hitRootRef={monsterHitRootRef}
          />
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
