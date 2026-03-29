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
import { Canvas, invalidate, useThree, useFrame } from "@react-three/fiber";
import { Center, OrbitControls, useAnimations, useGLTF } from "@react-three/drei";
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
function PositionedGltfSubject(props: Parameters<typeof GltfSubject>[0] & { positionX?: number; weaponUrl?: string | null }) {
  const { positionX = 0, weaponUrl, ...rest } = props;
  const groupRef = useRef<THREE.Group>(null);
  const { scene, animations } = useGLTF(rest.url);
  const innerRef = useRef<THREE.Group>(null);
  const { actions, names, mixer } = useAnimations(animations, innerRef);
  const onFinishedRef = useRef(rest.onOneShotAnimationFinished);
  onFinishedRef.current = rest.onOneShotAnimationFinished;
  const prevVisualStateRef = useRef<Monster3DSpriteState>(rest.visualState);

  useEffect(() => { useGLTF.preload(rest.url); }, [rest.url]);

  const hurtHp = rest.draculaHurtHp?.hp;
  const hurtMaxHp = rest.draculaHurtHp?.maxHp;

  useEffect(() => {
    const prevState = prevVisualStateRef.current;
    prevVisualStateRef.current = rest.visualState;
    const crossFade =
      (prevState === "knockdown" && (rest.visualState === "recover" || rest.visualState === "defeated")) ||
      (prevState === "hurt" && rest.visualState === "recover") ||
      (prevState === "recover" && (rest.visualState === "idle" || rest.visualState === "neutral"));
    const fadeDuration = crossFade ? 0.4 : 0.18;
    if (!crossFade) mixer.stopAllAction();

    const glbSlug = glbSlugFromPathOrUrl(rest.url);
    const hurtCtx = hurtHp != null && hurtMaxHp != null ? { hp: hurtHp, maxHp: hurtMaxHp } : rest.draculaHurtHp ?? null;
    const pick = rest.isPlayerModel
      ? resolvePlayerAnimationClipName(rest.visualState, names, rest.draculaAttackVariant)
      : resolveMonsterAnimationClipName(rest.visualState, names, {
          monsterType: rest.monsterType,
          glbSlug,
          draculaAttackVariant: rest.draculaAttackVariant,
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
  }, [actions, names, mixer, rest.url, rest.visualState, rest.monsterType, rest.draculaAttackVariant, hurtHp, hurtMaxHp, rest.draculaLoopAngrySkill01, rest.isPlayerModel]);

  const scale = (rest.tightFraming ? 1.14 : 1) * (rest.isPlayerModel ? 0.9 : (rest.monsterType === "V" || rest.monsterType === "K" || rest.monsterType === "Z" || rest.monsterType === "S" || rest.monsterType === "L" ? 0.9 : 1));

  const yRotation = rest.isPlayerModel ? Math.PI / 2 : -Math.PI / 2;

  return (
    <>
      <group ref={groupRef} position={[positionX, 0, 0]}>
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

function BoneAttachedWeapon({ parentScene, url }: { parentScene: THREE.Object3D; url: string }) {
  const { scene: weaponScene } = useGLTF(url);
  const weaponClone = React.useMemo(() => weaponScene.clone(true), [weaponScene]);
  const attachedRef = useRef<{ bone: THREE.Bone; container: THREE.Group } | null>(null);
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
    const maxDim = Math.max(size.x, size.y, size.z);

    const boneWs = new THREE.Vector3();
    bone.getWorldScale(boneWs);
    const avgWs = (boneWs.x + boneWs.y + boneWs.z) / 3;
    const desiredWorldLen = 0.45;
    const localScale = desiredWorldLen / (maxDim * Math.max(avgWs, 0.001));

    const container = new THREE.Group();
    container.name = "__weapon__";

    const scaleGrp = new THREE.Group();
    scaleGrp.scale.setScalar(localScale);

    const offsetGrp = new THREE.Group();
    const handleY = box.min.y + size.y * 0.15;
    offsetGrp.position.set(-center.x, -handleY, -center.z);

    offsetGrp.add(weaponClone);
    scaleGrp.add(offsetGrp);
    container.add(scaleGrp);
    bone.add(container);

    attachedRef.current = { bone, container };
    orientedRef.current = false;

    if (process.env.NODE_ENV !== "production") {
      const bones: string[] = [];
      parentScene.traverse((c) => { if ((c as THREE.Bone).isBone) bones.push(c.name); });
      console.log("[BoneAttachedWeapon] bones:", bones.join(", "));
      console.log("[BoneAttachedWeapon] picked:", bone.name, "parent:", bone.parent?.name);
      console.log("[BoneAttachedWeapon] weaponSize:", size.toArray().map(v => +v.toFixed(3)), "localScale:", +localScale.toFixed(4));
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
    const { bone, container } = att;

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
      new THREE.Vector3(0, 1, 0),
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
  onOneShotAnimationFinished?: () => void;
  width: number;
  height: number;
  fallback: ReactNode;
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
  onOneShotAnimationFinished,
  width,
  height,
  fallback,
}: CombatScene3DProps) {
  const isMergedMeshy = monsterType === "V" || monsterType === "K" || monsterType === "Z" || monsterType === "S" || monsterType === "L";
  const cameraZ = 5.2;
  const cameraY = 1.0;
  const fov = 40;
  const meshyCameraBases = { baseZ: cameraZ, baseY: cameraY, baseFov: fov };

  const isContactExchange =
    (playerVisualState === "attack" || playerVisualState === "angry" || playerVisualState === "hurt" || playerVisualState === "knockdown") &&
    (monsterVisualState === "attack" || monsterVisualState === "hurt" || monsterVisualState === "knockdown" || monsterVisualState === "angry");
  const playerPosX = isContactExchange ? -0.55 : -0.85;
  const monsterPosX = isContactExchange ? 0.55 : 0.85;

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
          <OrbitControls
            enablePan={false}
            enableZoom={true}
            enableRotate={true}
            minDistance={2}
            maxDistance={10}
            minPolarAngle={Math.PI / 6}
            maxPolarAngle={Math.PI / 2}
            target={[0, 0.8, 0]}
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
