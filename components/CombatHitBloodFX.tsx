"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Monster3DSpriteState } from "@/lib/monsterModels3d";

const DROP_COUNT = 22;
const LIFETIME_SEC = 0.52;
const GRAVITY = 6.2;

type BurstParticle = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  scale0: number;
};

function computeHitPhase(
  playerVisualState: Monster3DSpriteState,
  monsterVisualState: Monster3DSpriteState,
): boolean {
  const pAtk = playerVisualState === "attack";
  const mAtk = monsterVisualState === "attack";
  const pHurt = playerVisualState === "hurt" || playerVisualState === "knockdown";
  const mHurt = monsterVisualState === "hurt" || monsterVisualState === "knockdown";
  return (pAtk && mHurt && !mAtk) || (mAtk && pHurt && !pAtk);
}

function spawnParticles(playerHitsMonster: boolean, cx: number, cy: number, cz: number): BurstParticle[] {
  const out: BurstParticle[] = [];
  const outward = playerHitsMonster ? 1 : -1;
  for (let i = 0; i < DROP_COUNT; i++) {
    const speed = 0.85 + Math.random() * 1.35;
    const spread = 0.95;
    const vx = outward * (0.35 + Math.random() * 0.85) * speed * 0.22 + (Math.random() - 0.5) * spread * 0.35;
    const vy = (0.25 + Math.random() * 1.1) * speed * 0.2;
    const vz = (Math.random() - 0.5) * spread * 0.5;
    out.push({
      x: cx + (Math.random() - 0.5) * 0.04,
      y: cy + (Math.random() - 0.5) * 0.06,
      z: cz + (Math.random() - 0.5) * 0.04,
      vx,
      vy,
      vz,
      scale0: 0.65 + Math.random() * 0.55,
    });
  }
  return out;
}

export interface CombatHitBloodFXProps {
  playerPosX: number;
  monsterPosX: number;
  playerVisualState: Monster3DSpriteState;
  monsterVisualState: Monster3DSpriteState;
  /** Face-off lab: replay bumps this so another burst can fire without leaving the hit pose. */
  faceOffAnimationSyncKey?: string | null;
}

/**
 * Short blood droplet burst at merged 3D contact — player hits monster or monster hits player.
 * Triggered on the rising edge of the corresponding visual-state pair (aligned with tuned clip lead-ins).
 */
export function CombatHitBloodFX({
  playerPosX,
  monsterPosX,
  playerVisualState,
  monsterVisualState,
  faceOffAnimationSyncKey,
}: CombatHitBloodFXProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const particlesRef = useRef<BurstParticle[]>([]);
  const burstTimeRef = useRef(-1);
  const prevHitPhaseRef = useRef(false);

  const geometry = useMemo(() => new THREE.SphereGeometry(0.016, 5, 5), []);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(0x5c070c),
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
      }),
    [],
  );

  useLayoutEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  const hitPhase = useMemo(
    () => computeHitPhase(playerVisualState, monsterVisualState),
    [playerVisualState, monsterVisualState],
  );

  useEffect(() => {
    prevHitPhaseRef.current = false;
  }, [faceOffAnimationSyncKey]);

  useEffect(() => {
    if (hitPhase && !prevHitPhaseRef.current) {
      prevHitPhaseRef.current = true;
      const playerHitsMonster =
        playerVisualState === "attack" &&
        (monsterVisualState === "hurt" || monsterVisualState === "knockdown");
      const t = 0.55;
      const cx = THREE.MathUtils.lerp(playerPosX, monsterPosX, playerHitsMonster ? t : 1 - t);
      const cy = 0.88 + Math.random() * 0.14;
      const cz = (Math.random() - 0.5) * 0.06;
      particlesRef.current = spawnParticles(playerHitsMonster, cx, cy, cz);
      burstTimeRef.current = 0;
    } else if (!hitPhase) {
      prevHitPhaseRef.current = false;
    }
  }, [
    hitPhase,
    playerVisualState,
    monsterVisualState,
    playerPosX,
    monsterPosX,
    faceOffAnimationSyncKey,
  ]);

  useFrame((_, dt) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const t = burstTimeRef.current;
    if (t < 0) {
      material.opacity = 0.92;
      for (let i = 0; i < DROP_COUNT; i++) {
        dummy.position.set(0, -500, 0);
        dummy.scale.setScalar(0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      return;
    }

    burstTimeRef.current = t + dt;
    const u = burstTimeRef.current / LIFETIME_SEC;
    const parts = particlesRef.current;
    if (u >= 1 || parts.length === 0) {
      burstTimeRef.current = -1;
      particlesRef.current = [];
      for (let i = 0; i < DROP_COUNT; i++) {
        dummy.position.set(0, -500, 0);
        dummy.scale.setScalar(0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      return;
    }

    const fade = 1 - u * u;
    for (let i = 0; i < DROP_COUNT; i++) {
      const p = parts[i];
      if (!p) continue;
      p.vy -= GRAVITY * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      dummy.position.set(p.x, p.y, p.z);
      const s = p.scale0 * 0.022 * fade;
      dummy.scale.setScalar(Math.max(0.001, s));
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    material.opacity = Math.min(0.92, 0.92 * fade * 1.15);
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[geometry, material, DROP_COUNT]} frustumCulled={false} renderOrder={10} />
  );
}
