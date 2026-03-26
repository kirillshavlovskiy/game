"use client";

import React, { Component, Suspense, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { Canvas, invalidate } from "@react-three/fiber";
import { Center, useAnimations, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import type { MonsterType } from "@/lib/labyrinth";
import type { Monster3DSpriteState } from "@/lib/monsterModels3d";
import { glbSlugFromPathOrUrl, resolveMonsterAnimationClipName } from "@/lib/monsterModels3d";

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
  draculaAttackVariant?: "spell" | "skill";
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
}: {
  url: string;
  visualState: Monster3DSpriteState;
  tightFraming: boolean;
  monsterType?: MonsterType | null;
  draculaAttackVariant?: "spell" | "skill";
  draculaHurtHp?: { hp: number; maxHp: number } | null;
  draculaLoopAngrySkill01?: boolean;
  onOneShotAnimationFinished?: () => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const { scene, animations } = useGLTF(url);
  const { actions, names, mixer } = useAnimations(animations, groupRef);
  /** Parent often recreates closures; including them in the play effect restarts clips and can stack `finished` / RAF callbacks. */
  const onFinishedRef = useRef(onOneShotAnimationFinished);
  onFinishedRef.current = onOneShotAnimationFinished;

  useEffect(() => {
    useGLTF.preload(url);
  }, [url]);

  const hurtHp = draculaHurtHp?.hp;
  const hurtMaxHp = draculaHurtHp?.maxHp;

  useEffect(() => {
    /** Hard stop so a clamped `falling_down` pose cannot stay blended when switching to `idle` / calm clips. */
    mixer.stopAllAction();

    const glbSlug = glbSlugFromPathOrUrl(url);
    const hurtCtx =
      hurtHp != null && hurtMaxHp != null ? { hp: hurtHp, maxHp: hurtMaxHp } : draculaHurtHp ?? null;
    const pick = resolveMonsterAnimationClipName(visualState, names, {
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
      act.fadeIn(0.18).play();
    }
    // Do not auto-fire completion when no clip matched: that instantly chained hurt→recover→ready with no real animation.

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
    // Primitives only: parent often passes a fresh `{ hp, maxHp }` object each render — object identity must not restart clips.
  }, [actions, names, mixer, url, visualState, monsterType, draculaAttackVariant, hurtHp, hurtMaxHp, draculaLoopAngrySkill01]);

  useEffect(() => {
    invalidate();
  }, [url, tightFraming]);

  /** Merged Dracula clips (falls, lunges) travel in world space — keep him smaller in frame than other GLBs. */
  const scale = (tightFraming ? 1.14 : 1) * (monsterType === "V" ? 0.9 : 1);

  return (
    <Center>
      <group ref={groupRef} scale={scale}>
        <primitive object={scene} />
      </group>
    </Center>
  );
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
}: {
  url: string;
  visualState: Monster3DSpriteState;
  tightFraming: boolean;
  monsterType?: MonsterType | null;
  draculaAttackVariant?: "spell" | "skill";
  draculaHurtHp?: { hp: number; maxHp: number } | null;
  draculaLoopAngrySkill01?: boolean;
  onOneShotAnimationFinished?: () => void;
}) {
  return (
    <>
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
}: {
  url: string;
  visualState: Monster3DSpriteState;
  tightFraming?: boolean;
  monsterType?: MonsterType | null;
  draculaAttackVariant?: "spell" | "skill";
  draculaHurtHp?: { hp: number; maxHp: number } | null;
  draculaLoopAngrySkill01?: boolean;
  onOneShotAnimationFinished?: () => void;
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
  const cameraZBase = referenceViewerStyle ? (tightFraming ? 2.2 : 2.85) : tightFraming ? 2.12 : 2.82;
  const cameraYBase = referenceViewerStyle ? (tightFraming ? 0.95 : 1.05) : tightFraming ? 0.98 : 1.06;
  /** Extra pullback so knockdown / attack root motion stays in front of the lens (not past `near`). */
  const draculaCameraZExtra = isDracula ? 0.62 : 0;
  const draculaCameraYExtra = isDracula ? -0.06 : 0;
  const cameraZ = cameraZBase + draculaCameraZExtra;
  const cameraY = cameraYBase + draculaCameraYExtra;
  const fov = referenceViewerStyle ? (isDracula ? 40 : 38) : 36;

  /** Keep showing the last loaded GLB until the next URL has been fetched (e.g. switching monster type in dev tools). */
  const [committedPath, setCommittedPath] = useState(gltfPath);
  const [committedVisualState, setCommittedVisualState] = useState(visualState);

  useEffect(() => {
    if (gltfPath === committedPath) {
      setCommittedVisualState((v) => (v === visualState ? v : visualState));
      return;
    }
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
      if (!cancelled) {
        setCommittedPath(gltfPath);
        setCommittedVisualState(visualState);
      }
    };
    void run();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [gltfPath, visualState, committedPath]);

  const canvasLayoutKey = `${tightFraming ? "tight" : "wide"}-${referenceViewerStyle ? "ref" : "mod"}${isDracula ? "-v" : ""}`;
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
            url={committedPath}
            visualState={committedVisualState}
            tightFraming={tightFraming}
            monsterType={monsterType}
            draculaAttackVariant={draculaAttackVariant}
            draculaHurtHp={draculaHurtHp}
            draculaLoopAngrySkill01={draculaLoopAngrySkill01}
            onOneShotAnimationFinished={onOneShotAnimationFinished}
          />
        </Suspense>
      </Canvas>
    </ModelErrorBoundary>
  );
}
