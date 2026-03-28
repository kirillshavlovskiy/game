"use client";

import React, {
  Component,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { Canvas, invalidate, useThree } from "@react-three/fiber";
import { Center, useAnimations, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import type { MonsterType } from "@/lib/labyrinth";
import type { Monster3DSpriteState } from "@/lib/monsterModels3d";
import { glbSlugFromPathOrUrl, resolveMonsterAnimationClipName, resolvePlayerAnimationClipName } from "@/lib/monsterModels3d";

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
}) {
  const groupRef = useRef<THREE.Group>(null);
  const { scene, animations } = useGLTF(url);
  const { actions, names, mixer } = useAnimations(animations, groupRef);
  const onFinishedRef = useRef(onOneShotAnimationFinished);
  onFinishedRef.current = onOneShotAnimationFinished;
  const prevVisualStateRef = useRef<Monster3DSpriteState>(visualState);

  useEffect(() => {
    useGLTF.preload(url);
  }, [url]);

  const hurtHp = draculaHurtHp?.hp;
  const hurtMaxHp = draculaHurtHp?.maxHp;

  useEffect(() => {
    const prevState = prevVisualStateRef.current;
    prevVisualStateRef.current = visualState;

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
    const hurtCtx =
      hurtHp != null && hurtMaxHp != null ? { hp: hurtHp, maxHp: hurtMaxHp } : draculaHurtHp ?? null;
    const pick = isPlayerModel
      ? resolvePlayerAnimationClipName(visualState, names, draculaAttackVariant)
      : resolveMonsterAnimationClipName(visualState, names, {
          monsterType,
          glbSlug,
          draculaAttackVariant,
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
  }, [actions, names, mixer, url, visualState, monsterType, draculaAttackVariant, hurtHp, hurtMaxHp, draculaLoopAngrySkill01, isPlayerModel]);

  useEffect(() => {
    invalidate();
  }, [url, tightFraming]);

  /** Merged Meshy rigs (Dracula + skeleton): same scale in combat so framing matches. */
  const scale = (tightFraming ? 1.14 : 1) * (isPlayerModel ? 0.9 : (monsterType === "V" || monsterType === "K" || monsterType === "Z" || monsterType === "S" ? 0.9 : 1));

  return (
    <Center>
      <group ref={groupRef} scale={scale} rotation={isPlayerModel ? [0, Math.PI, 0] : undefined}>
        <primitive object={scene} />
      </group>
    </Center>
  );
}

/**
 * Fixed camera for merged Meshy rigs — all skeleton/dracula animation clips have their
 * root X/Z locked so the model never drifts. Camera stays completely static; no per-state
 * offsets, no movement between clips.
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
          enabled={isPlayerModel || monsterType === "V" || monsterType === "K" || monsterType === "Z" || monsterType === "S"}
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
  const mergedMeshyCombat = isDracula || isSkeleton || isZombie;
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

  const canvasLayoutKey = `${tightFraming ? "tight" : "wide"}-${referenceViewerStyle ? "ref" : "mod"}${isDracula ? "-v" : ""}${isSkeleton ? "-k" : ""}${isZombie ? "-z" : ""}`;
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
