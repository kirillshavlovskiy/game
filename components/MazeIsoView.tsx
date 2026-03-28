"use client";

import {
  Suspense,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import type { Ref } from "react";
import { Canvas, useThree, useFrame, ThreeEvent } from "@react-three/fiber";
import { Billboard, OrbitControls, Text, useAnimations, useGLTF, useTexture } from "@react-three/drei";
import * as THREE from "three";
import { MAZE_FLOOR_TEXTURE, MAZE_ISO_WALL_SIDE_TEXTURE } from "@/lib/mazeCellTheme";
import { WALL, type DraculaState, type MonsterType } from "@/lib/labyrinth";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { getMonsterGltfPathForReference, resolveMonsterAnimationClipName } from "@/lib/monsterModels3d";

type MiniMonster = { x: number; y: number; type?: string; draculaState?: DraculaState };

type Props = {
  grid: string[][];
  mapWidth: number;
  mapHeight: number;
  playerX: number;
  playerY: number;
  facingDx: number;
  facingDy: number;
  zoom?: number;
  visible: boolean;
  onCellClick?: (x: number, y: number) => void;
  teleportOptions?: [number, number][];
  teleportMode?: boolean;
  /** Slingshot / catapult aim in 3D: raised camera + trajectory overlay. */
  catapultMode?: boolean;
  /** Grid-space arc samples from `Labyrinth.getCatapultTrajectory` (preview). */
  catapultArcPoints?: [number, number][] | null;
  /** Screen drag length (px) for arc height / parabola scale. */
  catapultTrajectoryStrength?: number;
  /** Slingshot source tile — yellow actionable hint. */
  catapultFrom?: [number, number] | null;
  /** While on magic (portal not open yet): possible teleport destinations (purple). */
  magicPortalPreviewOptions?: [number, number][] | null;
  /** Tint teleport beacons: magic = purple (2D hole style), portal = cyan. */
  teleportSourceType?: "magic" | "gem" | "artifact" | null;
  focusVersion?: number;
  miniMonsters?: MiniMonster[];
  fogIntensityMap?: Map<string, number>;
  /** Mobile: WebGL fills the parent (e.g. fixed viewport); chrome stacks above in the shell. */
  fillViewport?: boolean;
  /**
   * Touch / coarse-pointer play: no orbit pan on the canvas; after tapping "Rotate View", aim the camera by
   * tilting the device (where supported) or dragging on the canvas. Parent should not wire floor taps for walking.
   */
  touchUi?: boolean;
  /** Phone landscape: parent renders Rotate / Reset in the top control strip — hide the in-canvas overlay. */
  hideOverlayViewButtons?: boolean;
  /** Notifies parent when temporary camera-rotate mode is active (for chrome button highlight). */
  onRotateModeChange?: (active: boolean) => void;
  /**
   * Cardinal “into the view” from camera aim, snapped to grid (±1,0)/(0,±1).
   * Touch: always synced. Desktop: only while right-drag / Ctrl+drag / Rotate mode so left-drag pan still works.
   */
  onTouchCameraForwardGrid?: (dx: number, dy: number) => void;
  /**
   * Touch play: continuous compass bearing (deg) for “into the view” on the map plane, same convention as
   * `IsoDockGridMiniMap`’s `atan2(dy,dx)+90`. Lets the mini-map rotate with orbit, not only cardinal facing snaps.
   */
  onIsoCameraBearingDeg?: (deg: number) => void;
};

export type MazeIsoViewImperativeHandle = {
  activateRotate: () => void;
  /** While rotate mode is active, extend the auto-exit timer (e.g. continuous minimap ring drag). */
  bumpRotateSession: () => void;
  resetCameraView: () => void;
  /** Apply the same orbit deltas as dragging on the 3D canvas (e.g. mini-map ring in landscape). */
  orbitLookByPixelDelta: (dxPx: number, dyPx: number) => void;
};

/**
 * World size of one grid step. Path cells are one CS wide between wall centers, so raising CS widens
 * corridors in world space and reduces side walls eating the frustum when the camera sits behind the pawn.
 */
const CS = 3.55;
/** Wall blocks fill the full cell — adjacent walls form solid continuous walls. */
const WALL_SIZE = CS;
const WALL_HEIGHT = 3.25;
const WALL_TOP_COLOR = "#3a3a4c";
const FLOOR_Y = 0;
const ROTATE_TIMEOUT_MS = 3000;

/* ------------------------------------------------------------------ */
/*  Floor                                                              */
/* ------------------------------------------------------------------ */
function FloorTiles({
  grid, mapWidth, mapHeight, onCellClick,
}: {
  grid: string[][]; mapWidth: number; mapHeight: number;
  onCellClick?: (x: number, y: number) => void;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const floorTex = useTexture(MAZE_FLOOR_TEXTURE);
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  floorTex.repeat.set(0.8, 0.8);

  const count = mapWidth * mapHeight;
  const cellMap = useRef<Array<[number, number]>>([]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    const map: Array<[number, number]> = [];
    let idx = 0;
    for (let y = 0; y < mapHeight; y++) {
      for (let x = 0; x < mapWidth; x++) {
        dummy.position.set(x * CS, FLOOR_Y - 0.01, y * CS);
        dummy.rotation.x = -Math.PI / 2;
        dummy.updateMatrix();
        mesh.setMatrixAt(idx, dummy.matrix);
        map.push([x, y]);
        idx++;
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    cellMap.current = map;
  }, [grid, mapWidth, mapHeight]);

  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    if (!onCellClick || e.instanceId === undefined) return;
    e.stopPropagation();
    const cell = cellMap.current[e.instanceId];
    if (cell) onCellClick(cell[0], cell[1]);
  }, [onCellClick]);

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]} onClick={handleClick} receiveShadow>
      <planeGeometry args={[CS, CS]} />
      <meshStandardMaterial
        map={floorTex}
        roughness={0.72}
        metalness={0.04}
        color="#6a5d56"
      />
    </instancedMesh>
  );
}

/* ------------------------------------------------------------------ */
/*  Walls                                                              */
/* ------------------------------------------------------------------ */
function WallBlocks({
  grid, mapWidth, mapHeight,
}: {
  grid: string[][]; mapWidth: number; mapHeight: number;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const wallSideTex = useTexture(MAZE_ISO_WALL_SIDE_TEXTURE);
  wallSideTex.wrapS = wallSideTex.wrapT = THREE.RepeatWrapping;
  wallSideTex.repeat.set(0.5, 0.5);

  const wallCells = useMemo(() => {
    const cells: Array<[number, number]> = [];
    for (let y = 0; y < mapHeight; y++)
      for (let x = 0; x < mapWidth; x++)
        if (grid[y]?.[x] === WALL) cells.push([x, y]);
    return cells;
  }, [grid, mapWidth, mapHeight]);

  const wallMaterials = useMemo(() => {
    const sideMat = new THREE.MeshStandardMaterial({ map: wallSideTex, roughness: 0.9, metalness: 0, color: "#7a6a5a" });
    const sideMatDark = new THREE.MeshStandardMaterial({ map: wallSideTex, roughness: 0.9, metalness: 0, color: "#5a4a3a" });
    // Keep top faces permanently darker than side walls in low-light areas.
    const topMat = new THREE.MeshBasicMaterial({ map: wallSideTex, color: "#2f2722" });
    return [sideMat, sideMatDark, topMat, topMat, sideMat, sideMatDark];
  }, [wallSideTex]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < wallCells.length; i++) {
      const [x, y] = wallCells[i];
      dummy.position.set(x * CS, FLOOR_Y + WALL_HEIGHT / 2, y * CS);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [wallCells]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, wallCells.length]}
      material={wallMaterials}
      castShadow
      receiveShadow
    >
      <boxGeometry args={[WALL_SIZE, WALL_HEIGHT, WALL_SIZE]} />
    </instancedMesh>
  );
}

/* ------------------------------------------------------------------ */
/*  Player avatar on the ground                                        */
/* ------------------------------------------------------------------ */
function PlayerMarker({
  playerX, playerY, facingDx, facingDy,
}: {
  playerX: number; playerY: number; facingDx: number; facingDy: number;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const targetPos = useRef(new THREE.Vector3(playerX * CS, 0.4, playerY * CS));
  const didInitPosRef = useRef(false);

  useEffect(() => { targetPos.current.set(playerX * CS, 0.4, playerY * CS); }, [playerX, playerY]);

  useFrame(() => {
    if (!groupRef.current) return;
    if (!didInitPosRef.current) {
      groupRef.current.position.copy(targetPos.current);
      didInitPosRef.current = true;
    }
    groupRef.current.position.lerp(targetPos.current, 0.08);
    groupRef.current.rotation.y = -Math.atan2(facingDy, facingDx);
  });

  return (
    <group ref={groupRef}>
      {/* Follow light bound to player marker so nearby floor/walls stay readable while moving. */}
      <pointLight
        position={[0, 1.15, 0]}
        color="#a8ffd6"
        intensity={2.35}
        distance={CS * 4.2}
        decay={1.85}
      />
      <mesh castShadow receiveShadow>
        <cylinderGeometry args={[0.45, 0.45, 0.8, 16]} />
        <meshStandardMaterial color="#00ff88" emissive="#00ff44" emissiveIntensity={0.6} />
      </mesh>
      <mesh position={[0.55, 0, 0]} rotation={[0, 0, -Math.PI / 2]} castShadow>
        <coneGeometry args={[0.2, 0.5, 8]} />
        <meshStandardMaterial color="#0a0a0f" />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/*  Wall torches (same sparse placement as 2D view)                    */
/* ------------------------------------------------------------------ */
type TorchPlacement = {
  x: number;
  y: number;
  z: number;
  dirX: number;
  dirZ: number;
  cellX: number;
  cellY: number;
  seed: number;
};

function WallTorch({ torch, active }: { torch: TorchPlacement; active: boolean }) {
  const flameOuterRef = useRef<THREE.Mesh>(null);
  const flameInnerRef = useRef<THREE.Mesh>(null);
  const flameWispRef = useRef<THREE.Mesh>(null);
  const flameHaloRef = useRef<THREE.Mesh>(null);
  const emberRef = useRef<THREE.Mesh>(null);
  const flameLightRef = useRef<THREE.PointLight>(null);
  const flameFillLightRef = useRef<THREE.PointLight>(null);
  const yaw = Math.atan2(torch.dirX, torch.dirZ);
  // Keep all flame parts in cup-local coordinates so fire stays attached.
  const CUP_Y = 0.23;
  const CUP_Z = 0.37;
  const CUP_HEIGHT = 0.16;
  const CUP_TOP_Y = CUP_Y + CUP_HEIGHT * 0.5;
  const FLAME_BASE_Y = CUP_TOP_Y + 0.012;
  const FLAME_Z = CUP_Z + 0.005;

  useFrame(({ clock }) => {
    if (!active) return;
    const t = clock.getElapsedTime() * 7.5 + torch.seed * 3.1;
    const pulse = 0.92 + Math.sin(t) * 0.12 + Math.sin(t * 1.93) * 0.05;
    const flicker = 0.84 + Math.sin(t * 1.37) * 0.13 + Math.sin(t * 3.9) * 0.08;
    const swayX = Math.sin(t * 0.45) * 0.02;
    const swayZ = Math.cos(t * 0.37) * 0.015;

    if (flameOuterRef.current) {
      flameOuterRef.current.scale.set(1, Math.max(0.75, pulse), 1);
      flameOuterRef.current.position.x = swayX;
      flameOuterRef.current.position.y = FLAME_BASE_Y + 0.11 + pulse * 0.01;
      flameOuterRef.current.position.z = FLAME_Z + swayZ;
    }
    if (flameInnerRef.current) {
      flameInnerRef.current.scale.set(1, Math.max(0.8, pulse * 0.95), 1);
      flameInnerRef.current.position.x = swayX * 0.7;
      flameInnerRef.current.position.y = FLAME_BASE_Y + 0.085 + pulse * 0.008;
      flameInnerRef.current.position.z = FLAME_Z + swayZ * 0.7;
    }
    if (flameWispRef.current) {
      flameWispRef.current.scale.set(1, Math.max(0.72, pulse * 1.05), 1);
      flameWispRef.current.position.x = -swayX * 0.85;
      flameWispRef.current.position.y = FLAME_BASE_Y + 0.125 + pulse * 0.012;
      flameWispRef.current.position.z = FLAME_Z + 0.01 - swayZ * 0.5;
    }
    if (flameHaloRef.current) {
      flameHaloRef.current.scale.setScalar(0.92 + flicker * 0.22);
      flameHaloRef.current.position.y = FLAME_BASE_Y + 0.012;
    }
    if (emberRef.current) {
      emberRef.current.scale.setScalar(0.95 + Math.sin(t * 1.6) * 0.12);
      emberRef.current.position.y = FLAME_BASE_Y + 0.015;
    }
    if (flameLightRef.current) {
      flameLightRef.current.intensity = 5.4 + flicker * 2.7;
      flameLightRef.current.distance = CS * (5.6 + flicker * 0.65);
      flameLightRef.current.position.x = swayX * 0.8;
      flameLightRef.current.position.y = FLAME_BASE_Y + 0.12;
      flameLightRef.current.position.z = FLAME_Z + swayZ * 0.8;
    }
    if (flameFillLightRef.current) {
      flameFillLightRef.current.intensity = 1.6 + flicker * 0.95;
      flameFillLightRef.current.position.x = swayX * 0.55;
      flameFillLightRef.current.position.y = FLAME_BASE_Y + 0.05;
      flameFillLightRef.current.position.z = FLAME_Z - 0.01 + swayZ * 0.55;
    }
  });

  return (
    <group position={[torch.x, torch.y, torch.z]} rotation={[0, yaw, 0]}>
      {active && (
        <>
          <pointLight
            ref={flameLightRef}
            position={[0, FLAME_BASE_Y + 0.12, FLAME_Z]}
            color="#ffb45a"
            intensity={6.6}
            distance={CS * 6}
            decay={1.7}
          />
          <pointLight
            ref={flameFillLightRef}
            position={[0, FLAME_BASE_Y + 0.05, FLAME_Z - 0.01]}
            color="#ff6a2f"
            intensity={1.9}
            distance={CS * 3.1}
            decay={2.1}
          />
        </>
      )}
      {/* Wall plate */}
      <mesh position={[0, 0.04, -0.04]} castShadow receiveShadow>
        <boxGeometry args={[0.2, 0.44, 0.06]} />
        <meshStandardMaterial color="#2b2520" roughness={0.9} metalness={0.08} />
      </mesh>
      {/* Arm */}
      <mesh position={[0, 0.08, 0.14]} castShadow receiveShadow>
        <boxGeometry args={[0.06, 0.06, 0.32]} />
        <meshStandardMaterial color="#3b322a" roughness={0.85} metalness={0.16} />
      </mesh>
      {/* Torch cup */}
      <mesh position={[0, CUP_Y, CUP_Z]} castShadow receiveShadow>
        <cylinderGeometry args={[0.08, 0.1, CUP_HEIGHT, 10]} />
        <meshStandardMaterial color="#2a231d" roughness={0.82} metalness={0.2} />
      </mesh>
      {/* Flame body */}
      <mesh ref={flameOuterRef} position={[0, FLAME_BASE_Y + 0.11, FLAME_Z]}>
        <coneGeometry args={[0.085, 0.22, 12]} />
        <meshStandardMaterial
          color="#ff7a2f"
          emissive="#ff5a1f"
          emissiveIntensity={1.7}
          roughness={0.35}
          metalness={0}
          side={THREE.DoubleSide}
          transparent
          opacity={0.9}
        />
      </mesh>
      {/* Flame core */}
      <mesh ref={flameInnerRef} position={[0, FLAME_BASE_Y + 0.085, FLAME_Z]}>
        <coneGeometry args={[0.05, 0.16, 12]} />
        <meshStandardMaterial
          color="#ffe7ae"
          emissive="#ffd47d"
          emissiveIntensity={2.35}
          roughness={0.25}
          metalness={0}
          side={THREE.DoubleSide}
          transparent
          opacity={0.95}
        />
      </mesh>
      {/* Secondary wisp for a less static, more natural flame silhouette */}
      <mesh ref={flameWispRef} position={[0, FLAME_BASE_Y + 0.125, FLAME_Z + 0.01]}>
        <coneGeometry args={[0.04, 0.14, 10]} />
        <meshStandardMaterial
          color="#ffc36a"
          emissive="#ffb85e"
          emissiveIntensity={1.95}
          roughness={0.25}
          metalness={0}
          side={THREE.DoubleSide}
          transparent
          opacity={0.85}
        />
      </mesh>
      {/* Soft emissive halo near the flame base */}
      <mesh ref={flameHaloRef} position={[0, FLAME_BASE_Y + 0.012, FLAME_Z - 0.005]}>
        <sphereGeometry args={[0.055, 10, 10]} />
        <meshStandardMaterial
          color="#ffbb68"
          emissive="#ff9a45"
          emissiveIntensity={1.35}
          roughness={0.2}
          metalness={0}
          transparent
          opacity={0.56}
        />
      </mesh>
      {/* Ember */}
      <mesh ref={emberRef} position={[0, FLAME_BASE_Y + 0.015, FLAME_Z - 0.006]}>
        <sphereGeometry args={[0.022, 8, 8]} />
        <meshStandardMaterial color="#ffce74" emissive="#ffbe56" emissiveIntensity={1.75} />
      </mesh>
    </group>
  );
}

function WallTorches({
  grid, mapWidth, mapHeight, playerX, playerY, fogIntensityMap,
}: {
  grid: string[][];
  mapWidth: number;
  mapHeight: number;
  playerX: number;
  playerY: number;
  fogIntensityMap?: Map<string, number>;
}) {
  const isW = (cx: number, cy: number) => grid[cy]?.[cx] === WALL;
  const walkable = (cx: number, cy: number) =>
    cx >= 0 && cy >= 0 && cx < mapWidth && cy < mapHeight && !isW(cx, cy);

  const torches = useMemo(() => {
    const result: TorchPlacement[] = [];
    let seed = 0;
    for (let y = 0; y < mapHeight; y++) {
      for (let x = 0; x < mapWidth; x++) {
        if (!walkable(x, y)) continue;
        const vn = (walkable(x, y - 1) ? 1 : 0) + (walkable(x, y + 1) ? 1 : 0);
        const hn = (walkable(x + 1, y) ? 1 : 0) + (walkable(x - 1, y) ? 1 : 0);
        const vert = vn > hn;
        if (vert) {
          if ((y & 1) === 1) continue;
          const e = isW(x + 1, y), w = isW(x - 1, y);
          if (e && w) {
            const s = (y >>> 1) % 2 === 0 ? 1 : -1;
            result.push({
              x: x * CS + s * CS * 0.42, y: WALL_HEIGHT * 0.55, z: y * CS,
              dirX: s > 0 ? -1 : 1, dirZ: 0, cellX: x, cellY: y, seed: seed++,
            });
          } else if (e) {
            result.push({
              x: x * CS + CS * 0.42, y: WALL_HEIGHT * 0.55, z: y * CS,
              dirX: -1, dirZ: 0, cellX: x, cellY: y, seed: seed++,
            });
          } else if (w) {
            result.push({
              x: x * CS - CS * 0.42, y: WALL_HEIGHT * 0.55, z: y * CS,
              dirX: 1, dirZ: 0, cellX: x, cellY: y, seed: seed++,
            });
          }
        } else {
          if ((x & 1) === 1) continue;
          const n = isW(x, y - 1), s = isW(x, y + 1);
          if (n && s) {
            const d = (x >>> 1) % 2 === 0 ? -1 : 1;
            result.push({
              x: x * CS, y: WALL_HEIGHT * 0.55, z: y * CS + d * CS * 0.42,
              dirX: 0, dirZ: d > 0 ? -1 : 1, cellX: x, cellY: y, seed: seed++,
            });
          } else if (n) {
            result.push({
              x: x * CS, y: WALL_HEIGHT * 0.55, z: y * CS - CS * 0.42,
              dirX: 0, dirZ: 1, cellX: x, cellY: y, seed: seed++,
            });
          } else if (s) {
            result.push({
              x: x * CS, y: WALL_HEIGHT * 0.55, z: y * CS + CS * 0.42,
              dirX: 0, dirZ: -1, cellX: x, cellY: y, seed: seed++,
            });
          }
        }
      }
    }
    return result;
  }, [grid, mapWidth, mapHeight]);

  return (
    <>
      {torches.map((t, i) => {
        const fog = fogIntensityMap?.get(`${t.cellX},${t.cellY}`) ?? 0;
        if (fog > 0.02) return null;
        const near = Math.hypot(t.cellX - playerX, t.cellY - playerY) <= 6.5;
        return <WallTorch key={i} torch={t} active={near} />;
      })}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Gothic details: ornaments, webs, relics                           */
/* ------------------------------------------------------------------ */
function cellNoise(x: number, y: number, salt = 0): number {
  const n = ((x * 374761393 + y * 668265263 + salt * 1440865359) >>> 0) % 10000;
  return n / 10000;
}

function GothicWallOrnaments({
  grid, mapWidth, mapHeight, fogIntensityMap,
}: {
  grid: string[][];
  mapWidth: number;
  mapHeight: number;
  fogIntensityMap?: Map<string, number>;
}) {
  const isW = (cx: number, cy: number) => grid[cy]?.[cx] === WALL;
  const walkable = (cx: number, cy: number) =>
    cx >= 0 && cy >= 0 && cx < mapWidth && cy < mapHeight && !isW(cx, cy);

  const ornaments = useMemo(() => {
    const out: Array<{ x: number; y: number; z: number; yaw: number; variant: number; cellX: number; cellY: number }> = [];
    for (let y = 0; y < mapHeight; y++) {
      for (let x = 0; x < mapWidth; x++) {
        if (!isW(x, y)) continue;
        if (cellNoise(x, y, 31) > 0.16) continue;
        const exposed: Array<{ dx: number; dy: number }> = [];
        if (walkable(x + 1, y)) exposed.push({ dx: 1, dy: 0 });
        if (walkable(x - 1, y)) exposed.push({ dx: -1, dy: 0 });
        if (walkable(x, y + 1)) exposed.push({ dx: 0, dy: 1 });
        if (walkable(x, y - 1)) exposed.push({ dx: 0, dy: -1 });
        if (exposed.length === 0) continue;
        const picked = exposed[Math.floor(cellNoise(x, y, 37) * exposed.length)]!;
        out.push({
          x: x * CS + picked.dx * CS * 0.49,
          y: WALL_HEIGHT * (0.45 + cellNoise(x, y, 41) * 0.22),
          z: y * CS + picked.dy * CS * 0.49,
          yaw: Math.atan2(picked.dx, picked.dy),
          variant: cellNoise(x, y, 53) > 0.5 ? 1 : 0,
          cellX: x,
          cellY: y,
        });
      }
    }
    return out;
  }, [grid, mapHeight, mapWidth]);

  return (
    <>
      {ornaments.map((o, i) => {
        const fog = fogIntensityMap?.get(`${o.cellX},${o.cellY}`) ?? 0;
        if (fog > 0.15) return null;
        return (
          <group key={`orn-${i}`} position={[o.x, o.y, o.z]} rotation={[0, o.yaw, 0]}>
            <mesh castShadow receiveShadow>
              <boxGeometry args={[0.42, 0.62, 0.08]} />
              <meshStandardMaterial color="#3a302b" roughness={0.9} metalness={0.06} />
            </mesh>
            {o.variant === 0 ? (
              <>
                <mesh position={[0, 0.02, 0.04]} castShadow>
                  <boxGeometry args={[0.07, 0.46, 0.05]} />
                  <meshStandardMaterial color="#181417" roughness={0.7} metalness={0.22} />
                </mesh>
                <mesh position={[0, 0.02, 0.04]} castShadow>
                  <boxGeometry args={[0.3, 0.07, 0.05]} />
                  <meshStandardMaterial color="#181417" roughness={0.7} metalness={0.22} />
                </mesh>
              </>
            ) : (
              <>
                <mesh position={[0, 0.06, 0.04]} castShadow>
                  <coneGeometry args={[0.12, 0.22, 6]} />
                  <meshStandardMaterial color="#20181b" roughness={0.8} metalness={0.14} />
                </mesh>
                <mesh position={[0, -0.18, 0.04]} castShadow>
                  <boxGeometry args={[0.2, 0.12, 0.05]} />
                  <meshStandardMaterial color="#20181b" roughness={0.8} metalness={0.14} />
                </mesh>
              </>
            )}
          </group>
        );
      })}
    </>
  );
}

function CornerCobwebs({
  grid, mapWidth, mapHeight, fogIntensityMap,
}: {
  grid: string[][];
  mapWidth: number;
  mapHeight: number;
  fogIntensityMap?: Map<string, number>;
}) {
  void grid;
  void mapWidth;
  void mapHeight;
  void fogIntensityMap;
  return null;
}

function HorrorCornerRelics({
  grid, mapWidth, mapHeight, fogIntensityMap,
}: {
  grid: string[][];
  mapWidth: number;
  mapHeight: number;
  fogIntensityMap?: Map<string, number>;
}) {
  const isW = (cx: number, cy: number) => grid[cy]?.[cx] === WALL;
  const walkable = (cx: number, cy: number) =>
    cx >= 0 && cy >= 0 && cx < mapWidth && cy < mapHeight && !isW(cx, cy);

  const relics = useMemo(() => {
    const out: Array<{ x: number; z: number; rot: number; cellX: number; cellY: number }> = [];
    for (let y = 1; y < mapHeight - 1; y++) {
      for (let x = 1; x < mapWidth - 1; x++) {
        if (!walkable(x, y)) continue;
        if (cellNoise(x, y, 101) > 0.1) continue;
        const nearCorner =
          (isW(x + 1, y) && isW(x, y + 1)) ||
          (isW(x - 1, y) && isW(x, y + 1)) ||
          (isW(x + 1, y) && isW(x, y - 1)) ||
          (isW(x - 1, y) && isW(x, y - 1));
        if (!nearCorner) continue;
        out.push({
          x: x * CS + (cellNoise(x, y, 103) - 0.5) * CS * 0.35,
          z: y * CS + (cellNoise(x, y, 107) - 0.5) * CS * 0.35,
          rot: cellNoise(x, y, 109) * Math.PI * 2,
          cellX: x,
          cellY: y,
        });
      }
    }
    return out;
  }, [grid, mapHeight, mapWidth]);

  return (
    <>
      {relics.map((r, i) => {
        const fog = fogIntensityMap?.get(`${r.cellX},${r.cellY}`) ?? 0;
        if (fog > 0.1) return null;
        return (
          <group key={`relic-${i}`} position={[r.x, FLOOR_Y + 0.06, r.z]} rotation={[0, r.rot, 0]}>
            <mesh castShadow receiveShadow>
              <boxGeometry args={[0.34, 0.08, 0.24]} />
              <meshStandardMaterial color="#2a2321" roughness={0.92} metalness={0.06} />
            </mesh>
            <mesh position={[0, 0.1, 0]} castShadow>
              <sphereGeometry args={[0.08, 10, 10]} />
              <meshStandardMaterial color="#d5c5ad" roughness={0.78} metalness={0.03} />
            </mesh>
            <mesh position={[-0.07, 0.13, 0.055]}>
              <sphereGeometry args={[0.015, 6, 6]} />
              <meshBasicMaterial color="#1e1714" />
            </mesh>
            <mesh position={[0.07, 0.13, 0.055]}>
              <sphereGeometry args={[0.015, 6, 6]} />
              <meshBasicMaterial color="#1e1714" />
            </mesh>
            <mesh position={[0.16, 0.07, -0.03]}>
              <cylinderGeometry args={[0.018, 0.022, 0.12, 8]} />
              <meshStandardMaterial color="#d9d2c2" roughness={0.6} metalness={0.03} />
            </mesh>
            <mesh position={[0.16, 0.15, -0.03]}>
              <sphereGeometry args={[0.016, 7, 7]} />
              <meshStandardMaterial color="#ffbf69" emissive="#ff9448" emissiveIntensity={1.1} />
            </mesh>
          </group>
        );
      })}
    </>
  );
}

function MazeSetPieces({
  grid, mapWidth, mapHeight, playerX, playerY, fogIntensityMap,
}: {
  grid: string[][];
  mapWidth: number;
  mapHeight: number;
  playerX: number;
  playerY: number;
  fogIntensityMap?: Map<string, number>;
}) {
  const isW = (cx: number, cy: number) => grid[cy]?.[cx] === WALL;
  const walkable = (cx: number, cy: number) =>
    cx >= 0 && cy >= 0 && cx < mapWidth && cy < mapHeight && !isW(cx, cy);

  const wallProps = useMemo(() => {
    const out: Array<{
      x: number; y: number; z: number; yaw: number;
      type: "portal" | "door" | "grille" | "sign";
      cellX: number; cellY: number; seed: number;
    }> = [];
    for (let y = 1; y < mapHeight - 1; y++) {
      for (let x = 1; x < mapWidth - 1; x++) {
        if (!isW(x, y)) continue;
        const r = cellNoise(x, y, 201);
        if (r > 0.16) continue;
        const sides: Array<{ dx: number; dy: number }> = [];
        if (walkable(x + 1, y)) sides.push({ dx: 1, dy: 0 });
        if (walkable(x - 1, y)) sides.push({ dx: -1, dy: 0 });
        if (walkable(x, y + 1)) sides.push({ dx: 0, dy: 1 });
        if (walkable(x, y - 1)) sides.push({ dx: 0, dy: -1 });
        if (!sides.length) continue;
        const s = sides[Math.floor(cellNoise(x, y, 211) * sides.length)]!;
        const t: "portal" | "door" | "grille" | "sign" =
          r < 0.025 ? "portal" : r < 0.06 ? "door" : r < 0.11 ? "grille" : "sign";
        out.push({
          x: x * CS + s.dx * CS * 0.506,
          y: t === "portal" ? 1.18 : t === "door" ? 1.22 : 1.42,
          z: y * CS + s.dy * CS * 0.506,
          yaw: Math.atan2(s.dx, s.dy),
          type: t,
          cellX: x,
          cellY: y,
          seed: (x * 92821 + y * 68917) & 1023,
        });
      }
    }
    return out;
  }, [grid, mapHeight, mapWidth]);

  const sculptures = useMemo(() => {
    const out: Array<{ x: number; z: number; rot: number; cellX: number; cellY: number }> = [];
    for (let y = 1; y < mapHeight - 1; y++) {
      for (let x = 1; x < mapWidth - 1; x++) {
        if (!walkable(x, y)) continue;
        if (cellNoise(x, y, 231) > 0.07) continue;
        const wallNear =
          isW(x + 1, y) || isW(x - 1, y) || isW(x, y + 1) || isW(x, y - 1);
        if (!wallNear) continue;
        out.push({
          x: x * CS + (cellNoise(x, y, 233) - 0.5) * CS * 0.28,
          z: y * CS + (cellNoise(x, y, 239) - 0.5) * CS * 0.28,
          rot: cellNoise(x, y, 241) * Math.PI * 2,
          cellX: x,
          cellY: y,
        });
      }
    }
    return out;
  }, [grid, mapHeight, mapWidth]);

  return (
    <>
      {wallProps.map((p, i) => {
        const fog = fogIntensityMap?.get(`${p.cellX},${p.cellY}`) ?? 0;
        if (fog > 0.14) return null;
        const near = Math.hypot(p.cellX - playerX, p.cellY - playerY) <= 6.2;
        if (p.type === "portal") {
          return (
            <group key={`portal-${i}`} position={[p.x, p.y, p.z]} rotation={[0, p.yaw, 0]}>
              <mesh castShadow receiveShadow>
                <torusGeometry args={[0.45, 0.08, 10, 22]} />
                <meshStandardMaterial color="#1f1a22" metalness={0.35} roughness={0.55} />
              </mesh>
              <mesh position={[0, 0, -0.03]} renderOrder={3}>
                <circleGeometry args={[0.36, 24]} />
                <meshBasicMaterial color="#8d6cff" transparent opacity={0.45} />
              </mesh>
              {near && <pointLight position={[0, 0, 0.05]} color="#8c68ff" intensity={0.85} distance={2.6} decay={2.4} />}
            </group>
          );
        }
        if (p.type === "door") {
          return (
            <group key={`door-${i}`} position={[p.x, p.y, p.z]} rotation={[0, p.yaw, 0]}>
              <mesh castShadow receiveShadow>
                <boxGeometry args={[0.96, 1.84, 0.1]} />
                <meshStandardMaterial color="#4a3527" roughness={0.92} metalness={0.04} />
              </mesh>
              <mesh position={[0, 0.82, 0.035]}>
                <coneGeometry args={[0.17, 0.12, 3]} />
                <meshStandardMaterial color="#2b1f18" roughness={0.82} metalness={0.12} />
              </mesh>
              <mesh position={[0.35, -0.05, 0.06]}>
                <sphereGeometry args={[0.035, 8, 8]} />
                <meshStandardMaterial color="#76654e" roughness={0.42} metalness={0.45} />
              </mesh>
            </group>
          );
        }
        if (p.type === "grille") {
          return (
            <group key={`grille-${i}`} position={[p.x, p.y, p.z]} rotation={[0, p.yaw, 0]}>
              <mesh castShadow receiveShadow>
                <boxGeometry args={[1.0, 1.2, 0.06]} />
                <meshStandardMaterial color="#27272e" roughness={0.8} metalness={0.28} />
              </mesh>
              {[-0.33, -0.11, 0.11, 0.33].map((bx, bi) => (
                <mesh key={`gb-${i}-${bi}`} position={[bx, 0, 0.035]} castShadow>
                  <boxGeometry args={[0.05, 1.08, 0.04]} />
                  <meshStandardMaterial color="#17171d" roughness={0.74} metalness={0.45} />
                </mesh>
              ))}
            </group>
          );
        }
        return (
          <group key={`sign-${i}`} position={[p.x, p.y, p.z]} rotation={[0, p.yaw, 0]}>
            <mesh renderOrder={3}>
              <circleGeometry args={[0.28, 16]} />
              <meshStandardMaterial
                color="#131016"
                emissive="#7f2ce8"
                emissiveIntensity={0.75}
                roughness={0.7}
                metalness={0.06}
                transparent
                opacity={0.84}
              />
            </mesh>
            <mesh position={[0, 0, 0.02]} rotation={[0, 0, Math.PI * (p.seed % 7) / 7]} renderOrder={4}>
              <ringGeometry args={[0.08, 0.16, 3]} />
              <meshBasicMaterial color="#cfa5ff" transparent opacity={0.8} />
            </mesh>
            {near && <pointLight position={[0, 0, 0.06]} color="#8f5cff" intensity={0.32} distance={1.9} decay={2.6} />}
          </group>
        );
      })}
      {sculptures.map((s, i) => {
        const fog = fogIntensityMap?.get(`${s.cellX},${s.cellY}`) ?? 0;
        if (fog > 0.14) return null;
        return (
          <group key={`sculpt-${i}`} position={[s.x, FLOOR_Y + 0.04, s.z]} rotation={[0, s.rot, 0]}>
            <mesh castShadow receiveShadow>
              <cylinderGeometry args={[0.15, 0.19, 0.22, 10]} />
              <meshStandardMaterial color="#2a2528" roughness={0.93} metalness={0.04} />
            </mesh>
            <mesh position={[0, 0.21, 0]} castShadow receiveShadow>
              <sphereGeometry args={[0.11, 9, 9]} />
              <meshStandardMaterial color="#6f6660" roughness={0.86} metalness={0.04} />
            </mesh>
            <mesh position={[-0.038, 0.23, 0.088]}>
              <sphereGeometry args={[0.014, 7, 7]} />
              <meshBasicMaterial color="#130f0f" />
            </mesh>
            <mesh position={[0.038, 0.23, 0.088]}>
              <sphereGeometry args={[0.014, 7, 7]} />
              <meshBasicMaterial color="#130f0f" />
            </mesh>
          </group>
        );
      })}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Blood/mud stain decals on walkable floor tiles                     */
/* ------------------------------------------------------------------ */
const STAIN_PATHS = [
  "/textures/maze/Stains/Horror_Stain_01-256x256.png",
  "/textures/maze/Stains/Horror_Stain_02-256x256.png",
  "/textures/maze/Stains/Horror_Stain_03-256x256.png",
  "/textures/maze/Stains/Horror_Stain_04-256x256.png",
  "/textures/maze/Stains/Horror_Stain_05-256x256.png",
  "/textures/maze/Stains/Horror_Stain_06-256x256.png",
  "/textures/maze/Stains/Horror_Stain_08-256x256.png",
  "/textures/maze/Stains/Horror_Stain_09-256x256.png",
  "/textures/maze/Stains/Horror_Stain_10-256x256.png",
  "/textures/maze/Stains/Horror_Stain_13-256x256.png",
  "/textures/maze/Stains/Horror_Stain_14-256x256.png",
];
function WallWebDecals({
  grid, mapWidth, mapHeight, fogIntensityMap,
}: {
  grid: string[][];
  mapWidth: number;
  mapHeight: number;
  fogIntensityMap?: Map<string, number>;
}) {
  void grid;
  void mapWidth;
  void mapHeight;
  void fogIntensityMap;
  return null;
}

/** Deterministic hash for per-cell stain placement. */
function cellHash(x: number, y: number, salt: number) {
  return ((x * 374761393 + y * 668265263 + salt * 1440865359) >>> 0) % 1000;
}

function FloorStains({
  grid, mapWidth, mapHeight,
}: {
  grid: string[][]; mapWidth: number; mapHeight: number;
}) {
  const stainTextures = useTexture(STAIN_PATHS);

  const stains = useMemo(() => {
    const result: Array<{ x: number; z: number; rot: number; scale: number; texIdx: number }> = [];
    for (let y = 0; y < mapHeight; y++) {
      for (let x = 0; x < mapWidth; x++) {
        if (grid[y]?.[x] === WALL) continue;
        const h = cellHash(x, y, 0);
        if (h > 220) continue;
        const texIdx = cellHash(x, y, 1) % stainTextures.length;
        const rot = (cellHash(x, y, 2) / 1000) * Math.PI * 2;
        const scale = 0.6 + (cellHash(x, y, 3) / 1000) * 1.2;
        const ox = ((cellHash(x, y, 4) / 1000) - 0.5) * CS * 0.4;
        const oz = ((cellHash(x, y, 5) / 1000) - 0.5) * CS * 0.4;
        result.push({ x: x * CS + ox, z: y * CS + oz, rot, scale, texIdx });
      }
    }
    return result;
  }, [grid, mapWidth, mapHeight, stainTextures.length]);

  return (
    <>
      {stains.map((s, i) => (
        <mesh
          key={i}
          position={[s.x, FLOOR_Y + 0.02, s.z]}
          rotation={[-Math.PI / 2, 0, s.rot]}
        >
          <planeGeometry args={[CS * s.scale, CS * s.scale]} />
          <meshStandardMaterial
            map={stainTextures[s.texIdx]}
            transparent
            alphaTest={0.05}
            depthWrite={false}
            roughness={0.95}
            metalness={0}
            color="#8a3030"
          />
        </mesh>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Slingshot aim trajectory (above maze, fades before “impact”)       */
/* ------------------------------------------------------------------ */
const CATAPULT_TRAJ_VERT = `
attribute float alpha;
varying float vAlpha;
void main() {
  vAlpha = alpha;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const CATAPULT_TRAJ_FRAG = `
uniform vec3 uColor;
varying float vAlpha;
void main() {
  if (vAlpha < 0.02) discard;
  gl_FragColor = vec4(uColor, vAlpha * 0.88);
}
`;

function densifyArcPoints2D(arcPoints: [number, number][], outCount: number): [number, number][] {
  if (arcPoints.length < 2 || outCount < 2) return arcPoints;
  const out: [number, number][] = [];
  const nSeg = arcPoints.length - 1;
  for (let s = 0; s < outCount; s++) {
    const t = s / (outCount - 1);
    const f = t * nSeg;
    const i = Math.min(nSeg - 1, Math.floor(f));
    const lt = f - i;
    const [x0, y0] = arcPoints[i]!;
    const [x1, y1] = arcPoints[i + 1]!;
    out.push([x0 + (x1 - x0) * lt, y0 + (y1 - y0) * lt]);
  }
  return out;
}

function CatapultTrajectory3D({
  arcPoints,
  strength,
}: {
  arcPoints: [number, number][];
  strength: number;
}) {
  const linePayload = useMemo(() => {
    const dense = densifyArcPoints2D(arcPoints, 48);
    const n = dense.length;
    if (n < 2) return null;
    const cum: number[] = [0];
    for (let i = 1; i < n; i++) {
      const [xa, ya] = dense[i - 1]!;
      const [xb, yb] = dense[i]!;
      const dx = (xb - xa) * CS;
      const dz = (yb - ya) * CS;
      cum.push(cum[i - 1]! + Math.hypot(dx, dz));
    }
    const pathLen = Math.max(0.001, cum[n - 1] ?? 1);
    const H = Math.min(
      8.8,
      0.75 + strength * 0.034 + pathLen * 0.24
    );
    const positions = new Float32Array(n * 3);
    const alphas = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = (cum[i] ?? 0) / pathLen;
      const [gx, gy] = dense[i]!;
      const wx = gx * CS;
      const wz = gy * CS;
      const arch = H * 4 * u * (1 - u);
      let wy = FLOOR_Y + 0.42 + arch;
      if (u > 0.52) {
        const v = (u - 0.52) / 0.48;
        wy += v * v * (1.6 + strength * 0.018);
      }
      positions[i * 3] = wx;
      positions[i * 3 + 1] = wy;
      positions[i * 3 + 2] = wz;
      let a = 1;
      if (u > 0.34) {
        a *= 1 - THREE.MathUtils.smoothstep(u, 0.34, 0.84);
      }
      if (u > 0.72) {
        a *= 1 - THREE.MathUtils.smoothstep(u, 0.72, 0.95);
      }
      alphas[i] = Math.max(0, Math.min(1, a));
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("alpha", new THREE.BufferAttribute(alphas, 1));
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uColor: { value: new THREE.Color("#ffcc66") } },
      vertexShader: CATAPULT_TRAJ_VERT,
      fragmentShader: CATAPULT_TRAJ_FRAG,
    });
    const line = new THREE.Line(geometry, material);
    line.frustumCulled = false;
    line.renderOrder = 920;
    return { line, geometry, material };
  }, [arcPoints, strength]);

  useEffect(() => {
    if (!linePayload) return undefined;
    return () => {
      linePayload.geometry.dispose();
      linePayload.material.dispose();
    };
  }, [linePayload]);

  if (!linePayload) return null;
  return <primitive object={linePayload.line} />;
}

/* ------------------------------------------------------------------ */
/*  Camera controller: smooth follow, pan default, rotate on demand    */
/* ------------------------------------------------------------------ */
/** Camera height above the floor while auto-following (slightly high so side walls clear the marker in 1-wide halls). */
const CAM_HEIGHT = 5.42;
/**
 * Camera sits this far behind the pawn along facing. Tied to CS (~0.9 cell) so it stays “on your shoulder”
 * instead of deep in the previous cell where back faces can swallow the view next to a wall.
 */
const CAM_BEHIND = CS * 0.9;
/** Orbit / follow target Y at the pawn (not floor) so framing favors the marker against a wall ahead. */
const CAM_LOOK_AT_Y = 0.52;
/** How fast the camera follows position (0-1 per frame). */
const CAM_POS_LERP = 0.2;
/** How fast the camera rotates to face behind the player (0-1 per frame). */
const CAM_ROT_LERP = 0.18;

function applyManualOrbitFromDelta(
  camera: THREE.Camera,
  controlsRef: { current: any },
  dxPx: number,
  dyPx: number,
  hasManualCameraRef: { current: boolean },
  manualOffsetRef: { current: THREE.Vector3 | null },
) {
  const ctrl = controlsRef.current;
  if (!ctrl) return;
  const target = ctrl.target;
  const offset = camera.position.clone().sub(target);
  const spherical = new THREE.Spherical().setFromVector3(offset);
  spherical.theta -= dxPx * 0.005;
  spherical.phi = Math.max(0.2, Math.min(Math.PI / 2.2, spherical.phi - dyPx * 0.005));
  offset.setFromSpherical(spherical);
  camera.position.copy(target).add(offset);
  camera.lookAt(target);
  hasManualCameraRef.current = true;
  manualOffsetRef.current = camera.position.clone().sub(target);
}

function CameraController({
  grid, mapWidth, mapHeight, playerX, playerY, facingDx, facingDy, zoom, rotateMode, resetTick, teleportMode, catapultMode, focusVersion,
  touchUi,
  onTouchCameraForwardGrid,
  onIsoCameraBearingDeg,
  orbitLookApplierRef,
}: {
  grid: string[][];
  mapWidth: number;
  mapHeight: number;
  playerX: number;
  playerY: number;
  facingDx: number;
  facingDy: number;
  zoom: number;
  rotateMode: boolean;
  resetTick: number;
  teleportMode: boolean;
  catapultMode: boolean;
  focusVersion?: number;
  touchUi: boolean;
  onTouchCameraForwardGrid?: (dx: number, dy: number) => void;
  onIsoCameraBearingDeg?: (deg: number) => void;
  orbitLookApplierRef: MutableRefObject<((dxPx: number, dyPx: number) => void) | null>;
}) {
  const { camera, gl } = useThree();
  const controlsRef = useRef<any>(null);
  const prevResetTick = useRef(resetTick);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const hasManualCameraRef = useRef(false);
  const manualOffsetRef = useRef<THREE.Vector3 | null>(null);
  const prevPlayerPosRef = useRef<{ x: number; y: number }>({ x: playerX, y: playerY });
  const prevFacingRef = useRef<{ dx: number; dy: number }>({ dx: Math.sign(facingDx), dy: Math.sign(facingDy) });
  const prevFocusVersionRef = useRef(focusVersion);
  const transitionBlendRef = useRef(0);
  const autoDirRef = useRef<{ dx: number; dy: number }>({
    dx: Math.abs(facingDx) + Math.abs(facingDy) > 0 ? Math.sign(facingDx) : 0,
    dy: Math.abs(facingDx) + Math.abs(facingDy) > 0 ? Math.sign(facingDy) : 1,
  });
  const lastOrientRef = useRef<{ g: number; b: number } | null>(null);
  /** One-time snap so touch sessions start behind the pawn (Canvas default camera is a fixed diagonal). */
  const touchCameraBootstrappedRef = useRef(false);
  const lastTouchForwardGridRef = useRef<{ dx: number; dy: number } | null>(null);
  const onTouchCameraForwardGridRef = useRef(onTouchCameraForwardGrid);
  const onIsoCameraBearingDegRef = useRef(onIsoCameraBearingDeg);
  const lastEmittedBearingDegRef = useRef<number | null>(null);
  onTouchCameraForwardGridRef.current = onTouchCameraForwardGrid;
  onIsoCameraBearingDegRef.current = onIsoCameraBearingDeg;
  /** Smoothed grid (dx,dy) for auto camera offset — eases orbit when facing/turn changes instead of snapping. */
  const smoothFollowDirRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 1 });

  const teleportLikeFraming = teleportMode || catapultMode;

  useLayoutEffect(() => {
    orbitLookApplierRef.current = (dxPx: number, dyPx: number) => {
      applyManualOrbitFromDelta(camera, controlsRef, dxPx, dyPx, hasManualCameraRef, manualOffsetRef);
    };
    return () => {
      orbitLookApplierRef.current = null;
    };
  }, [camera, orbitLookApplierRef]);

  useEffect(() => {
    lastTouchForwardGridRef.current = null;
  }, [focusVersion, playerX, playerY]);

  useEffect(() => {
    if (camera instanceof THREE.PerspectiveCamera) {
      let baseFov = THREE.MathUtils.clamp(92 - zoom * 16, 58, 95);
      if (touchUi && !teleportLikeFraming) {
        baseFov = THREE.MathUtils.clamp(baseFov + 5, 58, 99);
      }
      // Magic portal + slingshot: same raised wide view as teleport targeting.
      camera.fov = teleportLikeFraming
        ? THREE.MathUtils.clamp(baseFov + 18, 72, 108)
        : baseFov;
      camera.updateProjectionMatrix();
    }
  }, [camera, zoom, teleportLikeFraming, touchUi]);

  const prevCatapultRef = useRef(false);
  useEffect(() => {
    if (catapultMode && !prevCatapultRef.current) {
      hasManualCameraRef.current = false;
      manualOffsetRef.current = null;
    }
    prevCatapultRef.current = catapultMode;
  }, [catapultMode]);

  /* Desktop: right-drag (or Ctrl+left) orbits and aims; left-drag stays pan. Touch: rotateMode + one-finger drag. */
  useEffect(() => {
    const canvas = gl.domElement;

    const onMouseDown = (e: MouseEvent) => {
      if (touchUi) return;
      const rightOrbit = e.button === 2;
      const ctrlOrbit = e.button === 0 && e.ctrlKey;
      const rotateLeftOrbit = e.button === 0 && rotateMode;
      if (!rightOrbit && !ctrlOrbit && !rotateLeftOrbit) return;
      dragRef.current = { x: e.clientX, y: e.clientY };
      if (rightOrbit || ctrlOrbit || rotateLeftOrbit) e.preventDefault();
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.x;
      const dy = e.clientY - dragRef.current.y;
      dragRef.current = { x: e.clientX, y: e.clientY };
      applyManualOrbitFromDelta(camera, controlsRef, dx, dy, hasManualCameraRef, manualOffsetRef);
    };
    const onMouseUp = () => { dragRef.current = null; };
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };
    const onWheel = () => {
      if (touchUi) return;
      const ctrl = controlsRef.current;
      if (!ctrl) return;
      const target = ctrl.target;
      hasManualCameraRef.current = true;
      manualOffsetRef.current = camera.position.clone().sub(target);
    };

    /** Touch UI: one-finger drag on the canvas adjusts orbit (same as rotate mode) without tapping Rotate. */
    const onTouchStart = (e: TouchEvent) => {
      if (!touchUi) return;
      if (e.touches.length !== 1) return;
      e.preventDefault();
      dragRef.current = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY };
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!touchUi || !dragRef.current || e.touches.length !== 1) return;
      e.preventDefault();
      const t = e.touches[0]!;
      const dx = t.clientX - dragRef.current.x;
      const dy = t.clientY - dragRef.current.y;
      dragRef.current = { x: t.clientX, y: t.clientY };
      applyManualOrbitFromDelta(camera, controlsRef, dx, dy, hasManualCameraRef, manualOffsetRef);
    };
    const onTouchEnd = () => {
      if (touchUi) dragRef.current = null;
    };

    const capMouse: AddEventListenerOptions = { capture: true };
    canvas.addEventListener("mousedown", onMouseDown, capMouse);
    canvas.addEventListener("contextmenu", onContextMenu);
    canvas.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd);
    canvas.addEventListener("touchcancel", onTouchEnd);
    return () => {
      canvas.removeEventListener("mousedown", onMouseDown, capMouse);
      canvas.removeEventListener("contextmenu", onContextMenu);
      canvas.removeEventListener("wheel", onWheel);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
      canvas.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [camera, gl, rotateMode, touchUi]);

  useEffect(() => {
    if (!touchUi || !rotateMode) {
      lastOrientRef.current = null;
      return;
    }
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;
      const prev = lastOrientRef.current;
      lastOrientRef.current = { g: e.gamma, b: e.beta };
      if (!prev) return;
      let dg = e.gamma - prev.g;
      let db = e.beta - prev.b;
      if (dg > 180) dg -= 360;
      if (dg < -180) dg += 360;
      if (Math.abs(dg) > 55 || Math.abs(db) > 55) return;
      applyManualOrbitFromDelta(camera, controlsRef, dg * 4, db * 4, hasManualCameraRef, manualOffsetRef);
    };
    window.addEventListener("deviceorientation", onOrient, true);
    return () => window.removeEventListener("deviceorientation", onOrient, true);
  }, [touchUi, rotateMode, camera]);

  /** Touch play: turn off OrbitControls entirely so one/two-finger drags never pan, rotate, or pinch-zoom the camera. */
  useLayoutEffect(() => {
    const apply = () => {
      const c = controlsRef.current;
      if (!c) return false;
      c.enabled = !touchUi;
      return true;
    };
    if (apply()) return undefined;
    const id = requestAnimationFrame(() => {
      apply();
    });
    return () => cancelAnimationFrame(id);
  }, [touchUi]);

  useFrame(() => {
    const ctrl = controlsRef.current;
    if (!ctrl) return;
    const wantEnabled = !touchUi;
    if (ctrl.enabled !== wantEnabled) ctrl.enabled = wantEnabled;

    const isWalkable = (cx: number, cy: number) =>
      cx >= 0 && cy >= 0 && cx < mapWidth && cy < mapHeight && grid[cy]?.[cx] !== WALL;
    const neighbors = [
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 0, dy: -1 },
    ].filter((d) => isWalkable(playerX + d.dx, playerY + d.dy));
    const forward = {
      dx: Math.abs(facingDx) + Math.abs(facingDy) > 0 ? Math.sign(facingDx) : autoDirRef.current.dx,
      dy: Math.abs(facingDx) + Math.abs(facingDy) > 0 ? Math.sign(facingDy) : autoDirRef.current.dy,
    };

    // Camera heading follows marker facing direction to avoid opposite-facing resets.
    let desiredDir = Math.abs(forward.dx) + Math.abs(forward.dy) > 0 ? forward : autoDirRef.current;
    if (Math.abs(desiredDir.dx) + Math.abs(desiredDir.dy) === 0 && neighbors.length > 0) {
      desiredDir = neighbors[0]!;
    }
    autoDirRef.current = desiredDir;

    const len = Math.hypot(desiredDir.dx, desiredDir.dy) || 1;
    const px = playerX * CS;
    const pz = playerY * CS;
    const desiredTarget = new THREE.Vector3(px, CAM_LOOK_AT_Y, pz);
    const followDist = teleportLikeFraming ? CAM_BEHIND * 2 : CAM_BEHIND;
    const followHeight = teleportLikeFraming ? CAM_HEIGHT * 1.7 : CAM_HEIGHT;

    const ndx = desiredDir.dx / len;
    const ndy = desiredDir.dy / len;
    const sPrev = smoothFollowDirRef.current;
    const followSmooth = THREE.MathUtils.lerp(0.085, 0.2, Math.min(1, transitionBlendRef.current));
    let sx = THREE.MathUtils.lerp(sPrev.dx, ndx, followSmooth);
    let sy = THREE.MathUtils.lerp(sPrev.dy, ndy, followSmooth);
    const slen = Math.hypot(sx, sy) || 1;
    sx /= slen;
    sy /= slen;
    smoothFollowDirRef.current = { dx: sx, dy: sy };

    const autoCameraPos = new THREE.Vector3(
      px - sx * followDist,
      followHeight,
      pz - sy * followDist
    );
    const autoOffset = autoCameraPos.clone().sub(desiredTarget);

    const prevPosForMove = prevPlayerPosRef.current;
    const movedFar = Math.hypot(playerX - prevPosForMove.x, playerY - prevPosForMove.y) > 1.01;
    if (movedFar && !rotateMode && !dragRef.current && !teleportLikeFraming) {
      hasManualCameraRef.current = false;
      manualOffsetRef.current = null;
      transitionBlendRef.current = Math.max(transitionBlendRef.current, 0.42);
    }

    const desiredOffset =
      hasManualCameraRef.current && manualOffsetRef.current && !teleportLikeFraming
        ? manualOffsetRef.current.clone()
        : autoOffset.clone();

    if (
      touchUi &&
      !touchCameraBootstrappedRef.current &&
      !hasManualCameraRef.current &&
      manualOffsetRef.current == null &&
      !teleportLikeFraming
    ) {
      touchCameraBootstrappedRef.current = true;
      smoothFollowDirRef.current = { dx: ndx, dy: ndy };
      camera.position.set(px - ndx * followDist, followHeight, pz - ndy * followDist);
      ctrl.target.copy(desiredTarget);
      ctrl.update();
      prevPlayerPosRef.current = { x: playerX, y: playerY };
      return;
    }

    const facingNow = { dx: Math.sign(facingDx), dy: Math.sign(facingDy) };
    const facingChanged =
      (Math.abs(facingNow.dx) + Math.abs(facingNow.dy) > 0) &&
      (facingNow.dx !== prevFacingRef.current.dx || facingNow.dy !== prevFacingRef.current.dy);
    prevPlayerPosRef.current = { x: playerX, y: playerY };
    prevFacingRef.current = facingNow;
    const turnChanged = prevFocusVersionRef.current !== focusVersion;
    prevFocusVersionRef.current = focusVersion;

    if (prevResetTick.current !== resetTick) {
      prevResetTick.current = resetTick;
      hasManualCameraRef.current = false;
      manualOffsetRef.current = null;
      transitionBlendRef.current = 0;
      touchCameraBootstrappedRef.current = true;
      smoothFollowDirRef.current = { dx: ndx, dy: ndy };
      lastEmittedBearingDegRef.current = null;
      camera.position.set(px - ndx * followDist, followHeight, pz - ndy * followDist);
      ctrl.target.copy(desiredTarget);
      ctrl.update();
      return;
    }

    if (turnChanged) {
      hasManualCameraRef.current = false;
      manualOffsetRef.current = null;
      const facingCandidate = {
        dx: Math.abs(facingDx) + Math.abs(facingDy) > 0 ? Math.sign(facingDx) : 0,
        dy: Math.abs(facingDx) + Math.abs(facingDy) > 0 ? Math.sign(facingDy) : 0,
      };
      const resetDir =
        (Math.abs(facingCandidate.dx) + Math.abs(facingCandidate.dy) > 0)
          ? facingCandidate
          : (neighbors[0] ?? autoDirRef.current);
      autoDirRef.current = resetDir;
      transitionBlendRef.current = Math.max(transitionBlendRef.current, 0.55);
    }

    // Facing direction changed: ease camera behind the marker (smoothFollowDirRef does the heavy lifting).
    // Touch UI: facing is often driven from camera→pawn cardinals; clearing manual orbit here makes the
    // minimap ring / orbit stop after a tiny nudge. Desktop keeps the old reset-on-turn behavior.
    if (facingChanged && !rotateMode && !touchUi) {
      hasManualCameraRef.current = false;
      manualOffsetRef.current = null;
      autoDirRef.current = desiredDir;
      transitionBlendRef.current = Math.max(transitionBlendRef.current, 0.32);
    }

    // Keep manual camera adjustment persistent while following the player.
    // Reset: explicit reset, turn/facing change, teleport/catapult framing, or a touch step to a new tile.

    // Auto-follow current player and orient behind movement direction unless user is actively rotating.
    if (!rotateMode && !dragRef.current) {
      const transitionBlend = transitionBlendRef.current;
      const posLerp = THREE.MathUtils.lerp(CAM_POS_LERP, 0.42, transitionBlend);
      const rotLerp = THREE.MathUtils.lerp(CAM_ROT_LERP, 0.34, transitionBlend);
      ctrl.target.lerp(desiredTarget, posLerp);
      // Keep a stable camera offset from the current target to prevent tilt drift.
      const desiredCameraPos = ctrl.target.clone().add(desiredOffset);
      camera.position.lerp(desiredCameraPos, rotLerp);
      transitionBlendRef.current = Math.max(0, transitionBlend * 0.9 - 0.012);
      ctrl.update();
    }

    /* Walk “forward” = into the view: camera→pawn on XZ, snapped to cardinals. Touch: always. Desktop: while aiming. */
    const cameraDrivesFacingGrid =
      !!onTouchCameraForwardGridRef.current &&
      !teleportLikeFraming &&
      (touchUi || hasManualCameraRef.current || dragRef.current != null || rotateMode);
    if (cameraDrivesFacingGrid) {
      const toPawn = new THREE.Vector3().subVectors(ctrl.target, camera.position);
      toPawn.y = 0;
      const hLen = toPawn.length();
      if (hLen > 1e-4) {
        toPawn.multiplyScalar(1 / hLen);
        let gdx: number;
        let gdy: number;
        if (Math.abs(toPawn.x) >= Math.abs(toPawn.z)) {
          gdx = toPawn.x >= 0 ? 1 : -1;
          gdy = 0;
        } else {
          gdx = 0;
          gdy = toPawn.z >= 0 ? 1 : -1;
        }
        const prev = lastTouchForwardGridRef.current;
        if (prev == null || prev.dx !== gdx || prev.dy !== gdy) {
          lastTouchForwardGridRef.current = { dx: gdx, dy: gdy };
          onTouchCameraForwardGridRef.current!(gdx, gdy);
        }
      }
    }

    /* Mini-map: continuous bearing matches 3D orbit (touch drag, right-drag desktop, mini-map ring, etc.). */
    if (!teleportLikeFraming && onIsoCameraBearingDegRef.current) {
      const toB = new THREE.Vector3().subVectors(ctrl.target, camera.position);
      toB.y = 0;
      const hB = toB.length();
      if (hB > 1e-4) {
        toB.multiplyScalar(1 / hB);
        const bearingDeg = (Math.atan2(toB.z, toB.x) * 180) / Math.PI + 90;
        const prevB = lastEmittedBearingDegRef.current;
        const bearingThresh =
          hasManualCameraRef.current || dragRef.current != null || rotateMode ? 0.04 : 0.12;
        if (prevB == null || Math.abs(bearingDeg - prevB) > bearingThresh) {
          lastEmittedBearingDegRef.current = bearingDeg;
          onIsoCameraBearingDegRef.current(bearingDeg);
        }
      }
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      target={[playerX * CS, CAM_LOOK_AT_Y, playerY * CS]}
      enableDamping={false}
      enableRotate={false}
      enablePan={!touchUi}
      enableZoom={!touchUi}
      minDistance={2.2}
      maxDistance={180}
      zoomSpeed={1.6}
      mouseButtons={{ LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }}
    />
  );
}

const TELEPORT_MARKER_PALETTE = {
  portal: {
    beam: "#9fddff",
    cone: "#b9ebff",
    ring: "#8fd8ff",
  },
  /** 2D magic / hole-cell purple family */
  magic: {
    beam: "#c49cff",
    cone: "#e8d4ff",
    ring: "#aa66ff",
  },
} as const;

function TeleportTargetMarkers({
  options,
  onSelect,
  accent = "portal",
  previewOnly = false,
}: {
  options: [number, number][];
  onSelect?: (x: number, y: number) => void;
  accent?: "portal" | "magic";
  previewOnly?: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const colors = TELEPORT_MARKER_PALETTE[accent];
  const dim = previewOnly ? 0.72 : 1;

  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group) return;
    const t = clock.getElapsedTime();
    const bob = previewOnly ? 0.07 : 0.12;
    const spin = previewOnly ? 1.1 : 1.8;
    group.children.forEach((child, i) => {
      const g = child as THREE.Group;
      g.rotation.y = t * spin + i * 0.45;
      g.position.y = FLOOR_Y + 1.25 + Math.sin(t * 3 + i) * bob;
    });
  });

  return (
    <group ref={groupRef}>
      {options.map(([x, y], i) => (
        <group
          key={`teleport-target-${i}-${x}-${y}`}
          position={[x * CS, FLOOR_Y + 0.35, y * CS]}
          onClick={
            previewOnly || !onSelect
              ? undefined
              : (e) => {
                  e.stopPropagation();
                  onSelect(x, y);
                }
          }
        >
          <mesh renderOrder={995}>
            <cylinderGeometry args={[0.05, 0.05, 1.15, 10]} />
            <meshBasicMaterial
              color={colors.beam}
              depthTest={false}
              depthWrite={false}
              transparent
              opacity={0.95 * dim}
            />
          </mesh>
          <mesh position={[0, -0.62, 0]} rotation={[Math.PI, 0, 0]} renderOrder={996}>
            <coneGeometry args={[0.24, 0.42, 16]} />
            <meshBasicMaterial
              color={colors.cone}
              depthTest={false}
              depthWrite={false}
              transparent
              opacity={dim}
            />
          </mesh>
          <mesh position={[0, -1.18, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={994}>
            <ringGeometry args={[0.32, 0.48, 24]} />
            <meshBasicMaterial
              color={colors.ring}
              depthTest={false}
              depthWrite={false}
              transparent
              opacity={0.9 * dim}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Yellow slingshot cue on the launch tile (2D catapult accent). */
function SlingshotSourceHint({ cellX, cellY }: { cellX: number; cellY: number }) {
  const ringRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const m = ringRef.current;
    if (!m) return;
    const t = clock.getElapsedTime();
    const s = 1 + Math.sin(t * 2.6) * 0.06;
    m.scale.setScalar(s);
  });
  return (
    <group position={[cellX * CS, FLOOR_Y + 0.08, cellY * CS]}>
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} renderOrder={910}>
        <ringGeometry args={[0.42, 0.62, 32]} />
        <meshBasicMaterial
          color="#ffcc00"
          depthTest={false}
          depthWrite={false}
          transparent
          opacity={0.92}
        />
      </mesh>
      <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={909}>
        <ringGeometry args={[0.55, 0.78, 32]} />
        <meshBasicMaterial
          color="#ffaa22"
          depthTest={false}
          depthWrite={false}
          transparent
          opacity={0.35}
        />
      </mesh>
      <Billboard position={[0, 2.15, 0]}>
        <Text
          fontSize={0.32}
          color="#ffcc66"
          outlineWidth={0.03}
          outlineColor="#1a1206"
          anchorX="center"
          anchorY="bottom"
        >
          Slingshot — pull to aim
        </Text>
      </Billboard>
    </group>
  );
}

function MagicPortalActionHint({ playerX, playerY }: { playerX: number; playerY: number }) {
  return (
    <Billboard position={[playerX * CS, 2.35, playerY * CS]}>
      <Text
        fontSize={0.3}
        color="#d4a8ff"
        outlineWidth={0.028}
        outlineColor="#1a0a24"
        anchorX="center"
        anchorY="bottom"
      >
        Magic — tap a purple beacon or open portal
      </Text>
    </Billboard>
  );
}

/* ------------------------------------------------------------------ */
/*  Scene                                                              */
/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/*  3D Monsters ? billboard sprites that always face the camera        */
/* ------------------------------------------------------------------ */
const MONSTER_SPRITE_MAP: Record<string, string> = {
  V: "/monsters/dracula/idle.png",
  Z: "/monsters/zombie/idle.png",
  S: "/monsters/spider/idle.png",
  G: "/monsters/ghost/idle.png",
  K: "/monsters/skeleton/idle.png",
  L: "/monsters/lava/neutral.png",
};

const DRACULA_GLB_PATH = getMonsterGltfPathForReference("V");

function DraculaModel3D({
  visualState,
  actionVersion = 0,
}: {
  visualState: "idle" | "hunt" | "attack";
  actionVersion?: number;
}) {
  const rootRef = useRef<THREE.Group>(null);
  const eyesRigRef = useRef<THREE.Group>(null);
  const headNodeRef = useRef<THREE.Object3D | null>(null);
  const leftEyeNodeRef = useRef<THREE.Object3D | null>(null);
  const rightEyeNodeRef = useRef<THREE.Object3D | null>(null);
  const { scene, animations } = useGLTF(DRACULA_GLB_PATH);
  const clonedScene = useMemo(() => SkeletonUtils.clone(scene), [scene]);
  const { actions, names } = useAnimations(animations, rootRef);
  const tmpWorldPos = useMemo(() => new THREE.Vector3(), []);
  const tmpHeadQ = useMemo(() => new THREE.Quaternion(), []);
  const tmpForward = useMemo(() => new THREE.Vector3(), []);
  const tmpUp = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    let pickedHead: THREE.Object3D | null = null;
    let leftEye: THREE.Object3D | null = null;
    let rightEye: THREE.Object3D | null = null;
    clonedScene.traverse((obj) => {
      if (!pickedHead && /head/i.test(obj.name)) {
        pickedHead = obj;
      }
      if (!leftEye && /(eye|eyeball).*(left|\.l|\bl\b)|\blefteye\b|eye_l/i.test(obj.name)) {
        leftEye = obj;
      }
      if (!rightEye && /(eye|eyeball).*(right|\.r|\br\b)|\brighteye\b|eye_r/i.test(obj.name)) {
        rightEye = obj;
      }
      if (obj instanceof THREE.Light) {
        // Ignore any GLB-embedded lights so Dracula reacts to maze lighting only.
        obj.visible = false;
        return;
      }
      if (obj instanceof THREE.Mesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          // Some exports are emissive-heavy, which makes the model appear uniformly lit.
          if (m instanceof THREE.MeshStandardMaterial || m instanceof THREE.MeshPhysicalMaterial) {
            m.roughness = Math.max(0.65, m.roughness ?? 0.75);
            m.metalness = Math.min(0.25, m.metalness ?? 0.12);
            m.envMapIntensity = 0.45;
            m.emissiveIntensity = Math.min(0.12, m.emissiveIntensity ?? 0);
            m.needsUpdate = true;
          } else if (m instanceof THREE.MeshBasicMaterial) {
            // Convert unlit/basic materials to lit PBR-ish materials for proper light response.
            const lit = new THREE.MeshStandardMaterial({
              map: m.map ?? null,
              color: m.color,
              transparent: m.transparent,
              opacity: m.opacity,
              alphaTest: m.alphaTest,
              side: m.side,
              roughness: 0.82,
              metalness: 0.08,
            });
            obj.material = lit;
          }
        }
      }
    });
    headNodeRef.current = pickedHead;
    leftEyeNodeRef.current = leftEye;
    rightEyeNodeRef.current = rightEye;
  }, [clonedScene]);

  useFrame(() => {
    const rig = eyesRigRef.current;
    const root = rootRef.current;
    const head = headNodeRef.current;
    if (!rig || !root) return;
    if (!head) {
      // Fallback if head node name is absent in a re-export.
      rig.position.set(0, 1.28, 0.2);
      return;
    }
    head.getWorldPosition(tmpWorldPos);
    head.getWorldQuaternion(tmpHeadQ);
    tmpForward.set(0, 0, 1).applyQuaternion(tmpHeadQ);
    tmpUp.set(0, 1, 0).applyQuaternion(tmpHeadQ);
    // Fallback eye rig when explicit eye joints are unavailable.
    tmpWorldPos.addScaledVector(tmpForward, 0.058).addScaledVector(tmpUp, 0.046);
    root.worldToLocal(tmpWorldPos);
    rig.position.copy(tmpWorldPos);
  });

  useEffect(() => {
    // In-maze attack should read as a strike prep/impact without root-motion loop snapping.
    const resolveState = visualState === "attack" ? "angry" : visualState;
    const clip = resolveMonsterAnimationClipName(resolveState, names, {
      monsterType: "V",
      glbSlug: "dracula",
    });
    for (const action of Object.values(actions)) {
      action?.fadeOut(0.14);
    }
    if (!clip) return;
    const action = actions[clip];
    if (!action) return;
    action.reset();
    if (visualState === "attack") {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = false;
      action.fadeIn(0.08).play();
    } else {
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.clampWhenFinished = false;
      action.fadeIn(0.16).play();
    }
    return () => {
      action.fadeOut(0.14);
    };
  }, [actions, names, visualState, actionVersion]);

  return (
    <group ref={rootRef} scale={0.82}>
      <primitive object={clonedScene} />
      {/* Tiny red eye dots only (no extra spill lights). */}
      {leftEyeNodeRef.current && (
        <primitive object={leftEyeNodeRef.current}>
          <mesh position={[0, 0, 0.016]} renderOrder={20}>
            <sphereGeometry args={[0.0065, 8, 8]} />
            <meshBasicMaterial color="#ff2424" transparent opacity={0.98} depthWrite={false} />
          </mesh>
        </primitive>
      )}
      {rightEyeNodeRef.current && (
        <primitive object={rightEyeNodeRef.current}>
          <mesh position={[0, 0, 0.016]} renderOrder={20}>
            <sphereGeometry args={[0.0065, 8, 8]} />
            <meshBasicMaterial color="#ff2424" transparent opacity={0.98} depthWrite={false} />
          </mesh>
        </primitive>
      )}
      {!leftEyeNodeRef.current && !rightEyeNodeRef.current && (
        <group ref={eyesRigRef}>
          <mesh position={[-0.017, 0, 0]} renderOrder={20}>
            <sphereGeometry args={[0.0065, 8, 8]} />
            <meshBasicMaterial color="#ff2424" transparent opacity={0.98} depthWrite={false} />
          </mesh>
          <mesh position={[0.017, 0, 0]} renderOrder={20}>
            <sphereGeometry args={[0.0065, 8, 8]} />
            <meshBasicMaterial color="#ff2424" transparent opacity={0.98} depthWrite={false} />
          </mesh>
        </group>
      )}
    </group>
  );
}

function DraculaInMaze({
  x, y, playerX, playerY, draculaState,
}: {
  x: number;
  y: number;
  playerX: number;
  playerY: number;
  draculaState?: DraculaState;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const [visualState, setVisualState] = useState<"idle" | "hunt" | "attack">("idle");
  const visualStateRef = useRef<"idle" | "hunt" | "attack">("idle");
  const prevStateRef = useRef<DraculaState | undefined>(draculaState);
  const attackUntilRef = useRef(0);
  const attackStartRef = useRef(0);
  const [actionVersion, setActionVersion] = useState(0);
  const smoothPosRef = useRef(new THREE.Vector3(x * CS, 0.02, y * CS));
  const targetPosRef = useRef(new THREE.Vector3(x * CS, 0.02, y * CS));
  const seed = useMemo(() => ((x * 73856093) ^ (y * 19349663)) & 1023, [x, y]);

  useEffect(() => {
    targetPosRef.current.set(x * CS, 0.02, y * CS);
  }, [x, y]);

  useFrame(({ clock }) => {
    const g = groupRef.current;
    if (!g) return;
    const t = clock.getElapsedTime();
    const wx = smoothPosRef.current.x / CS;
    const wy = smoothPosRef.current.z / CS;
    const dx = playerX - wx;
    const dy = playerY - wy;
    const dist = Math.hypot(dx, dy);
    const stateChanged = prevStateRef.current !== draculaState;
    if (stateChanged) prevStateRef.current = draculaState;
    const enteringAttack =
      stateChanged &&
      (draculaState === "telegraphAttack" || draculaState === "attack");
    if (enteringAttack) {
      attackStartRef.current = t;
      attackUntilRef.current = t + 0.72;
      setActionVersion((v) => v + 1);
    }
    const attackWindowActive = t < attackUntilRef.current;
    const attacking = draculaState === "attack" || attackWindowActive;
    const activeHunt =
      draculaState === "hunt" ||
      draculaState === "telegraphTeleport" ||
      draculaState === "teleport" ||
      draculaState === "recover";
    const transitDist = smoothPosRef.current.distanceTo(targetPosRef.current);
    const movingAcrossTiles = transitDist > 0.05;
    const next: "idle" | "hunt" | "attack" =
      attacking ? "attack" : ((activeHunt && movingAcrossTiles) ? "hunt" : "idle");
    if (next !== visualStateRef.current) {
      visualStateRef.current = next;
      setVisualState(next);
    }
    const moveLerp = next === "hunt" || next === "attack" ? 0.11 : 0.06;
    smoothPosRef.current.lerp(targetPosRef.current, moveLerp);
    // Short forward lunge on attack: push toward player, then settle back.
    let lunge = 0;
    if (attackWindowActive) {
      const phase = Math.min(1, Math.max(0, (t - attackStartRef.current) / 0.72));
      lunge = Math.sin(phase * Math.PI) * 0.38;
    }
    const dirLen = Math.hypot(dx, dy) || 1;
    const lungeX = (dx / dirLen) * lunge;
    const lungeZ = (dy / dirLen) * lunge;
    g.position.set(
      smoothPosRef.current.x + lungeX,
      0.02 + Math.sin(t * 1.8 + seed) * 0.03,
      smoothPosRef.current.z + lungeZ
    );
    const yaw = Math.atan2(dx, dy);
    g.rotation.y = THREE.MathUtils.lerp(g.rotation.y, yaw, 0.08);
  });

  return (
    <group ref={groupRef}>
      <Suspense fallback={<MonsterBillboard x={x} y={y} type="V" />}>
        <DraculaModel3D visualState={visualState} actionVersion={actionVersion} />
      </Suspense>
    </group>
  );
}

function MonsterBillboard({ x, y, type }: { x: number; y: number; type: string }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const spritePath = MONSTER_SPRITE_MAP[type] || MONSTER_SPRITE_MAP.Z;
  const tex = useTexture(spritePath);

  useFrame(({ camera }) => {
    if (meshRef.current) {
      meshRef.current.quaternion.copy(camera.quaternion);
    }
  });

  return (
    <mesh ref={meshRef} position={[x * CS, 1.2, y * CS]}>
      <planeGeometry args={[2, 2.4]} />
      <meshStandardMaterial
        map={tex}
        transparent
        alphaTest={0.1}
        depthWrite={false}
        side={THREE.DoubleSide}
        emissive="#ff4444"
        emissiveIntensity={0.15}
      />
    </mesh>
  );
}

function Monsters3D({
  monsters,
  playerX,
  playerY,
}: {
  monsters: MiniMonster[];
  playerX: number;
  playerY: number;
}) {
  return (
    <>
      {monsters.map((m, i) => (
        (m.type as MonsterType | undefined) === "V"
          ? (
            <DraculaInMaze
              key={`m3d-dracula-${i}`}
              x={m.x}
              y={m.y}
              playerX={playerX}
              playerY={playerY}
              draculaState={m.draculaState}
            />
          )
          : <MonsterBillboard key={`m3d-${i}`} x={m.x} y={m.y} type={m.type ?? "Z"} />
      ))}
    </>
  );
}

function MazeScene({
  grid, mapWidth, mapHeight, playerX, playerY, facingDx, facingDy,
  zoom, rotateMode, onCellClick, resetTick, teleportOptions, teleportMode, catapultMode, catapultArcPoints,
  catapultTrajectoryStrength, catapultFrom, magicPortalPreviewOptions, teleportSourceType,
  focusVersion, miniMonsters, fogIntensityMap,
  touchUi = false,
  onTouchCameraForwardGrid,
  onIsoCameraBearingDeg,
  orbitLookApplierRef,
}: Omit<Props, "visible"> & {
  rotateMode: boolean;
  resetTick: number;
  teleportOptions?: [number, number][];
  teleportMode?: boolean;
  catapultMode?: boolean;
  catapultArcPoints?: [number, number][] | null;
  catapultTrajectoryStrength?: number;
  catapultFrom?: [number, number] | null;
  magicPortalPreviewOptions?: [number, number][] | null;
  teleportSourceType?: "magic" | "gem" | "artifact" | null;
  onTouchCameraForwardGrid?: (dx: number, dy: number) => void;
  orbitLookApplierRef: MutableRefObject<((dxPx: number, dyPx: number) => void) | null>;
}) {
  const shadowRange = Math.max(mapWidth, mapHeight) * CS;
  return (
    <>
      {/* Very low global light: unlit corridors stay dark; torches do the local lighting. */}
      <ambientLight intensity={0.015} />
      <directionalLight
        position={[18, 26, 10]}
        intensity={0.2}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={0.5}
        shadow-camera-far={220}
        shadow-camera-left={-shadowRange}
        shadow-camera-right={shadowRange}
        shadow-camera-top={shadowRange}
        shadow-camera-bottom={-shadowRange}
        shadow-bias={-0.00018}
      />
      <directionalLight position={[-12, 12, -12]} intensity={0.08} color="#b9c8ff" />

      <FloorTiles grid={grid} mapWidth={mapWidth} mapHeight={mapHeight} onCellClick={onCellClick} />
      <FloorStains grid={grid} mapWidth={mapWidth} mapHeight={mapHeight} />
      <WallTorches
        grid={grid}
        mapWidth={mapWidth}
        mapHeight={mapHeight}
        playerX={playerX}
        playerY={playerY}
        fogIntensityMap={fogIntensityMap}
      />
      <GothicWallOrnaments grid={grid} mapWidth={mapWidth} mapHeight={mapHeight} fogIntensityMap={fogIntensityMap} />
      <MazeSetPieces
        grid={grid}
        mapWidth={mapWidth}
        mapHeight={mapHeight}
        playerX={playerX}
        playerY={playerY}
        fogIntensityMap={fogIntensityMap}
      />
      <HorrorCornerRelics grid={grid} mapWidth={mapWidth} mapHeight={mapHeight} fogIntensityMap={fogIntensityMap} />
      <WallBlocks grid={grid} mapWidth={mapWidth} mapHeight={mapHeight} />
      {miniMonsters && miniMonsters.length > 0 && (
        <Monsters3D monsters={miniMonsters} playerX={playerX} playerY={playerY} />
      )}
      <PlayerMarker playerX={playerX} playerY={playerY} facingDx={facingDx} facingDy={facingDy} />
      {magicPortalPreviewOptions &&
        magicPortalPreviewOptions.length > 0 &&
        !teleportMode && (
          <>
            <MagicPortalActionHint playerX={playerX} playerY={playerY} />
            <TeleportTargetMarkers options={magicPortalPreviewOptions} accent="magic" previewOnly />
          </>
        )}
      {catapultFrom && <SlingshotSourceHint cellX={catapultFrom[0]} cellY={catapultFrom[1]} />}
      {catapultArcPoints && catapultArcPoints.length >= 2 && (
        <CatapultTrajectory3D
          arcPoints={catapultArcPoints}
          strength={Math.max(12, catapultTrajectoryStrength ?? 0)}
        />
      )}
      <CameraController
        grid={grid}
        mapWidth={mapWidth}
        mapHeight={mapHeight}
        playerX={playerX}
        playerY={playerY}
        facingDx={facingDx}
        facingDy={facingDy}
        zoom={zoom ?? 1}
        rotateMode={rotateMode}
        resetTick={resetTick}
        teleportMode={!!teleportMode}
        catapultMode={!!catapultMode}
        focusVersion={focusVersion}
        touchUi={touchUi}
        onTouchCameraForwardGrid={onTouchCameraForwardGrid}
        onIsoCameraBearingDeg={onIsoCameraBearingDeg}
        orbitLookApplierRef={orbitLookApplierRef}
      />
      {teleportMode && !!teleportOptions?.length && (
        <TeleportTargetMarkers
          options={teleportOptions}
          onSelect={onCellClick}
          accent={teleportSourceType === "magic" ? "magic" : "portal"}
        />
      )}
    </>
  );
}

type MiniMapStripProps = {
  grid: string[][];
  mapWidth: number;
  mapHeight: number;
  playerX: number;
  playerY: number;
  facingDx: number;
  facingDy: number;
  onExpandToGrid?: () => void;
  miniPlayers?: Array<{ x: number; y: number; isCurrent?: boolean; isEliminated?: boolean }>;
  miniMonsters?: Array<{ x: number; y: number }>;
  fogIntensityMap?: Map<string, number>;
  mode?: "overlay" | "dock";
  showHeader?: boolean;
  showExpandButton?: boolean;
};

export function MiniMapStrip({
  grid,
  mapWidth,
  mapHeight,
  playerX,
  playerY,
  facingDx,
  facingDy,
  onExpandToGrid,
  miniPlayers,
  miniMonsters,
  fogIntensityMap,
  mode = "overlay",
  showHeader = true,
  showExpandButton = true,
}: MiniMapStripProps) {
  const inDock = mode === "dock";
  const miniCell = Math.max(3, Math.min(10, Math.floor(280 / Math.max(mapWidth, mapHeight))));
  const miniWidth = mapWidth * miniCell;
  const miniHeight = mapHeight * miniCell;

  const dirLen = Math.hypot(facingDx, facingDy) || 1;
  const arrowLen = Math.max(6, miniCell * 2.2);
  const playerCenterX = (playerX + 0.5) * miniCell;
  const playerCenterY = (playerY + 0.5) * miniCell;
  const arrowEndX = playerCenterX + (facingDx / dirLen) * arrowLen;
  const arrowEndY = playerCenterY + (facingDy / dirLen) * arrowLen;

  return (
    <div
      role={inDock && onExpandToGrid ? "button" : undefined}
      tabIndex={inDock && onExpandToGrid ? 0 : undefined}
      onClick={inDock ? onExpandToGrid : undefined}
      onKeyDown={
        inDock && onExpandToGrid
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onExpandToGrid();
              }
            }
          : undefined
      }
      title={inDock && onExpandToGrid ? "Switch to full 2D grid map" : undefined}
      style={{
        position: inDock ? "relative" : "absolute",
        right: inDock ? undefined : 12,
        bottom: inDock ? undefined : 12,
        zIndex: 9,
        width: inDock ? "100%" : "min(320px, 45%)",
        maxWidth: inDock ? 320 : undefined,
        height: inDock ? 128 : 160,
        background: "#1a1a24",
        borderRadius: 8,
        border: "1px solid #333",
        boxShadow: "0 0 20px rgba(0, 255, 136, 0.1)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "8px",
        cursor: inDock && onExpandToGrid ? "pointer" : "default",
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 8,
          border: "1px solid #31313d",
          background: "rgba(10,10,16,0.98)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "auto",
          position: "relative",
        }}
      >
        {showHeader && (
          <div
            style={{
              position: "absolute",
              top: 6,
              left: 8,
              right: 8,
              zIndex: 2,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              pointerEvents: "none",
            }}
          >
            <span
              style={{
                fontSize: "0.66rem",
                letterSpacing: "0.04em",
                color: "#9aa0ad",
                fontFamily: "monospace",
                textTransform: "uppercase",
                background: "rgba(8,8,14,0.75)",
                border: "1px solid rgba(120,120,150,0.35)",
                borderRadius: 4,
                padding: "2px 6px",
              }}
            >
              Mini 2D Map
            </span>
            {showExpandButton && (
              <button
                type="button"
                onClick={onExpandToGrid}
                style={{
                  pointerEvents: "auto",
                  fontSize: "0.68rem",
                  fontFamily: "monospace",
                  color: "#cfe3d8",
                  background: "rgba(16,30,24,0.92)",
                  border: "1px solid rgba(0,255,136,0.45)",
                  borderRadius: 4,
                  padding: "2px 6px",
                  cursor: onExpandToGrid ? "pointer" : "default",
                  opacity: onExpandToGrid ? 1 : 0.55,
                }}
                disabled={!onExpandToGrid}
                title="Switch to full 2D map view"
              >
                Expand 2D
              </button>
            )}
          </div>
        )}
        <div
          style={{
            width: miniWidth,
            height: miniHeight,
            display: "grid",
            gridTemplateColumns: `repeat(${mapWidth}, ${miniCell}px)`,
            gridTemplateRows: `repeat(${mapHeight}, ${miniCell}px)`,
            boxShadow: "0 0 0 1px rgba(255,255,255,0.06)",
            position: "relative",
          }}
        >
          {Array.from({ length: mapHeight }).map((_, y) =>
            Array.from({ length: mapWidth }).map((_, x) => {
              const isWall = grid[y]?.[x] === WALL;
              const fog = fogIntensityMap?.get(`${x},${y}`) ?? 0;
              return (
                <div
                  key={`${x}-${y}`}
                  style={{
                    width: miniCell,
                    height: miniCell,
                    position: "relative",
                    background: isWall
                      ? "linear-gradient(180deg, #2a2a34 0%, #1d1d26 100%)"
                      : "linear-gradient(180deg, #5b4f49 0%, #473c37 100%)",
                    border: "1px solid rgba(0,0,0,0.28)",
                    boxSizing: "border-box",
                  }}
                >
                  {fog > 0 && (
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        background: `rgba(4, 4, 10, ${Math.min(0.92, 0.16 + fog * 0.76)})`,
                        boxShadow: "inset 0 0 5px rgba(0,0,0,0.45)",
                        pointerEvents: "none",
                      }}
                    />
                  )}
                </div>
              );
            })
          )}

          {(miniMonsters ?? []).map((m, i) => {
            const fog = fogIntensityMap?.get(`${m.x},${m.y}`) ?? 0;
            if (fog > 0) return null;
            return (
              <div
                key={`monster-${i}-${m.x}-${m.y}`}
                style={{
                  position: "absolute",
                  left: m.x * miniCell + miniCell * 0.2,
                  top: m.y * miniCell + miniCell * 0.2,
                  width: miniCell * 0.6,
                  height: miniCell * 0.6,
                  borderRadius: "50%",
                  background: "#ff6464",
                  border: "1px solid #3a0f0f",
                  boxShadow: "0 0 6px rgba(255,80,80,0.65)",
                  pointerEvents: "none",
                }}
                title="Monster"
              />
            );
          })}

          {(miniPlayers ?? []).map((p, i) => {
            if (p.isEliminated) return null;
            return (
              <div
                key={`player-${i}-${p.x}-${p.y}`}
                style={{
                  position: "absolute",
                  left: p.x * miniCell + miniCell * 0.16,
                  top: p.y * miniCell + miniCell * 0.16,
                  width: miniCell * 0.68,
                  height: miniCell * 0.68,
                  borderRadius: "50%",
                  background: p.isCurrent ? "#00ff88" : "#55b8ff",
                  border: p.isCurrent ? "1px solid #05331f" : "1px solid #0c2234",
                  boxShadow: p.isCurrent
                    ? "0 0 6px rgba(0,255,136,0.75)"
                    : "0 0 4px rgba(85,184,255,0.55)",
                  pointerEvents: "none",
                }}
                title={p.isCurrent ? "Current player" : "Player"}
              />
            );
          })}

          <svg
            width={miniWidth}
            height={miniHeight}
            viewBox={`0 0 ${miniWidth} ${miniHeight}`}
            style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
            aria-hidden
          >
            <line
              x1={playerCenterX}
              y1={playerCenterY}
              x2={arrowEndX}
              y2={arrowEndY}
              stroke="#00ff88"
              strokeWidth={Math.max(1.5, miniCell * 0.35)}
              strokeLinecap="round"
            />
            <circle
              cx={playerCenterX}
              cy={playerCenterY}
              r={Math.max(2.5, miniCell * 0.6)}
              fill="#00ff88"
              stroke="#062214"
              strokeWidth={1}
            />
          </svg>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Exported component                                                 */
/* ------------------------------------------------------------------ */
const MazeIsoView = forwardRef(function MazeIsoView(
  {
    grid, mapWidth, mapHeight, playerX, playerY, facingDx, facingDy,
    zoom = 1,
    visible,
    onCellClick,
    teleportOptions,
    teleportMode,
    catapultMode = false,
    catapultArcPoints = null,
    catapultTrajectoryStrength = 0,
    catapultFrom = null,
    magicPortalPreviewOptions = null,
    teleportSourceType = null,
    focusVersion,
    miniMonsters,
    fogIntensityMap,
    fillViewport = false,
    touchUi = false,
    hideOverlayViewButtons = false,
    onRotateModeChange,
    onTouchCameraForwardGrid,
    onIsoCameraBearingDeg,
  }: Props,
  ref: Ref<MazeIsoViewImperativeHandle>,
) {
  const [btnRotate, setBtnRotate] = useState(false);
  const [ctrlHeld, setCtrlHeld] = useState(false);
  const [resetTick, setResetTick] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const btnRotateRef = useRef(false);
  btnRotateRef.current = btnRotate;
  const rotateMode = btnRotate || ctrlHeld;
  const orbitLookApplierRef = useRef<((dxPx: number, dyPx: number) => void) | null>(null);

  const resetCameraView = useCallback(() => {
    setBtnRotate(false);
    setResetTick((t) => t + 1);
  }, []);

  const activateRotate = useCallback(() => {
    const enable = () => {
      setBtnRotate(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setBtnRotate(false), ROTATE_TIMEOUT_MS);
    };
    if (touchUi && typeof window !== "undefined") {
      const DO = DeviceOrientationEvent as typeof DeviceOrientationEvent & {
        requestPermission?: () => Promise<"granted" | "denied">;
      };
      if (typeof DO.requestPermission === "function") {
        void DO.requestPermission().then(enable).catch(enable);
        return;
      }
    }
    enable();
  }, [touchUi]);

  const bumpRotateSession = useCallback(() => {
    if (!btnRotateRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setBtnRotate(false), ROTATE_TIMEOUT_MS);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      activateRotate,
      bumpRotateSession,
      resetCameraView,
      orbitLookByPixelDelta: (dxPx: number, dyPx: number) => {
        orbitLookApplierRef.current?.(dxPx, dyPx);
      },
    }),
    [activateRotate, bumpRotateSession, resetCameraView],
  );

  useEffect(() => {
    onRotateModeChange?.(rotateMode);
  }, [rotateMode, onRotateModeChange]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === "Control") setCtrlHeld(true); };
    const up = (e: KeyboardEvent) => { if (e.key === "Control") setCtrlHeld(false); };
    const blur = () => setCtrlHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  if (!visible) return null;

  const camDist = 10;

  return (
    <div
      style={{
        width: "100%",
        maxWidth: "100%",
        flex: 1,
        minHeight: 0,
        height: fillViewport ? "100%" : undefined,
        margin: "0 auto",
        borderRadius: fillViewport ? 0 : 8,
        overflow: "hidden",
        border: fillViewport ? "none" : "1px solid #333",
        boxShadow: fillViewport ? "none" : "inset 0 0 24px rgba(0,0,0,0.5)",
        background: "#06060a",
        position: "relative",
        display: "flex",
        flexDirection: "column",
      }}
      aria-label="Isometric 3D map view"
    >
      {!hideOverlayViewButtons ? (
        <div
          style={{
            position: "absolute",
            top: fillViewport ? "max(8px, env(safe-area-inset-top, 0px))" : 8,
            right: fillViewport ? "max(8px, env(safe-area-inset-right, 0px))" : 8,
            zIndex: 10,
            display: "flex",
            gap: 8,
          }}
        >
          <button
            onMouseDown={activateRotate}
            onTouchStart={activateRotate}
            style={{
              padding: "6px 12px", borderRadius: 6,
              border: rotateMode ? "1px solid #00ff88" : "1px solid #555",
              background: rotateMode ? "rgba(0,255,136,0.15)" : "rgba(20,20,30,0.85)",
              color: rotateMode ? "#00ff88" : "#aaa",
              fontSize: "0.75rem", fontFamily: "monospace",
              cursor: "pointer", transition: "all 0.2s", userSelect: "none",
            }}
            title={
              touchUi
                ? "Tap: then tilt the device or drag on the 3D view to aim the camera. Walking uses the dock controls only."
                : "Right-drag on the 3D view to aim the camera (or hold Ctrl and left-drag). Optional: Rotate View then left-drag."
            }
          >
            {rotateMode ? "Rotating..." : "Rotate View"}
          </button>
          <button
            type="button"
            onClick={resetCameraView}
            style={{
              padding: "6px 12px", borderRadius: 6,
              border: "1px solid #555",
              background: "rgba(20,20,30,0.85)",
              color: "#aaa",
              fontSize: "0.75rem", fontFamily: "monospace",
              cursor: "pointer", transition: "all 0.2s", userSelect: "none",
            }}
            title="Reset camera to default 3rd-person view behind the player"
          >
            Reset View
          </button>
        </div>
      ) : null}

      <Canvas
        shadows
        camera={{ position: [camDist, CAM_HEIGHT, camDist], fov: THREE.MathUtils.clamp(92 - zoom * 16, 58, 95), near: 0.1, far: 800 }}
        style={
          fillViewport
            ? {
                position: "absolute",
                left: 0,
                top: 0,
                width: "100%",
                height: "100%",
                display: "block",
                touchAction: touchUi ? "none" : "auto",
              }
            : { width: "100%", flex: 1, minHeight: 0, ...(touchUi ? { touchAction: "none" as const } : {}) }
        }
        gl={{ antialias: true, alpha: false }}
        dpr={[1, 1.4]}
        onCreated={({ gl }) => { gl.setClearColor("#06060a"); }}
      >
        <MazeScene
          grid={grid} mapWidth={mapWidth} mapHeight={mapHeight}
          playerX={playerX} playerY={playerY}
          facingDx={facingDx} facingDy={facingDy}
          zoom={zoom}
          rotateMode={rotateMode}
          onCellClick={onCellClick}
          resetTick={resetTick}
          teleportOptions={teleportOptions}
          teleportMode={teleportMode}
          catapultMode={catapultMode}
          catapultArcPoints={catapultArcPoints}
          catapultTrajectoryStrength={catapultTrajectoryStrength}
          catapultFrom={catapultFrom}
          magicPortalPreviewOptions={magicPortalPreviewOptions}
          teleportSourceType={teleportSourceType}
          focusVersion={focusVersion}
          miniMonsters={miniMonsters}
          fogIntensityMap={fogIntensityMap}
          touchUi={touchUi}
          onTouchCameraForwardGrid={onTouchCameraForwardGrid}
          onIsoCameraBearingDeg={onIsoCameraBearingDeg}
          orbitLookApplierRef={orbitLookApplierRef}
        />
      </Canvas>
    </div>
  );
});

MazeIsoView.displayName = "MazeIsoView";

export default MazeIsoView;
