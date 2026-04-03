"use client";

import {
  Suspense,
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import type { ReactNode, Ref } from "react";
import { Canvas, useThree, useFrame, ThreeEvent } from "@react-three/fiber";
import { OrbitControls, useAnimations, useGLTF, useTexture } from "@react-three/drei";
import * as THREE from "three";
import { MAZE_FLOOR_TEXTURE, MAZE_ISO_WALL_SIDE_TEXTURE } from "@/lib/mazeCellTheme";
import {
  WALL,
  type DraculaState,
  type MonsterType,
  type StoredArtifactKind,
} from "@/lib/labyrinth";
import { ARTIFACT_KIND_VISUAL_GLB, COLLECTIBLE_ARTIFACT_GLB_URLS } from "@/lib/storedArtifactGlbs";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import {
  getMonsterGltfPathForReference,
  PLAYER_3D_GLB,
  resolveMonsterAnimationClipName,
  resolvePlayerAnimationClipName,
  resolvePlayerHuntLocomotionClipName,
  resolvePlayerJumpLocomotionClipName,
  resolvePlayerShieldBlockClipName,
  type IsoCombatPlayerMoment,
  type PlayerIsoLocomotionAxis,
} from "@/lib/monsterModels3d";
import {
  mapRotationDebugEnabled,
  mapRotationLog,
  mapRotationLogSnapshot,
} from "@/lib/mapRotationDebug";
import { WEAPON_ATTACH_HAND } from "@/lib/weaponAttachConfig";
import { BoneAttachedWeapon, WeaponLoadErrorBoundary } from "@/components/MonsterModel3D";

type MiniMonster = { x: number; y: number; type?: string; draculaState?: DraculaState };

export type CatapultTrajectoryPreviewResult = {
  arcPoints: [number, number][];
  destX: number;
  destY: number;
} | null;

export type CatapultTrajectoryPreviewFn = (
  fromX: number,
  fromY: number,
  dx: number,
  dy: number,
  strength: number,
) => CatapultTrajectoryPreviewResult;

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
  /** Slingshot / catapult aim in 3D: raised camera; trajectory is drawn in-scene from the launch cell. */
  catapultMode?: boolean;
  /** Slingshot source tile — yellow floor hint on the launch cell. */
  catapultFrom?: [number, number] | null;
  /** While dragging on the parent overlay: current pointer (client coords) for floor raycast + arc preview. */
  catapultAimClient?: { x: number; y: number } | null;
  /** Grid-space arc preview (same rules as launch). */
  catapultTrajectoryPreview?: CatapultTrajectoryPreviewFn;
  /**
   * Slingshot: when false while `catapultMode`, player may orbit the camera (step 1: frame the maze).
   * When true, camera is locked to auto framing like teleport (step 2: pull to aim).
   */
  catapultLockCameraForPull?: boolean;
  /** While on magic (portal not open yet): possible teleport destinations (purple). */
  magicPortalPreviewOptions?: [number, number][] | null;
  /** Tint teleport beacons: magic = purple (2D hole style), portal = cyan. */
  teleportSourceType?: "magic" | "gem" | "artifact" | null;
  focusVersion?: number;
  miniMonsters?: MiniMonster[];
  fogIntensityMap?: Map<string, number>;
  /** Path cells with spider webs (slow tiles) — textured wall webs in iso. */
  spiderWebCells?: ReadonlyArray<readonly [number, number]>;
  /** Mobile: WebGL fills the parent (e.g. fixed viewport); chrome stacks above in the shell. */
  fillViewport?: boolean;
  /**
   * Touch / coarse-pointer play: no orbit pan on the canvas; after tapping "Rotate View", aim the camera by
   * tilting the device (where supported) or dragging on the canvas. Parent should not wire floor taps for walking.
   */
  touchUi?: boolean;
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
  /**
   * Bump when the parent clears `isoCameraBearingDeg` (e.g. left 3D mode) so the next ISO session re-emits bearing.
   * Otherwise `lastEmittedBearingDegRef` can match the unchanged camera and the minimap falls back to cardinal facing.
   */
  isoBearingSyncKey?: number;
  /** In-maze combat flow: click 3D view to roll, then play attack pulses in-scene. */
  combatActive?: boolean;
  combatRolling?: boolean;
  combatRollFace?: number | null;
  combatPulseVersion?: number;
  combatMonster?: { x: number; y: number; type?: string } | null;
  onCombatRollRequest?: () => void;
  onCombatRun?: () => void;
  onCombatShieldToggle?: () => void;
  combatShieldOn?: boolean;
  combatShieldAvailable?: boolean;
  combatRunDisabled?: boolean;
  /** Dynamic player GLB path based on selected avatar. Falls back to wasteland-drifter. */
  playerGlbPath?: string;
  /** Optional weapon/armour GLB — same hand attach as combat `CombatScene3D` (`BoneAttachedWeapon`). */
  playerWeaponGltfPath?: string | null;
  /** Rotating 3D pickups for artifact cells (grid indices; hidden/fog excluded by parent). */
  artifactPickups?: Array<{ x: number; y: number; kind: StoredArtifactKind }>;
  /** Last resolved strike cue (dice + shield + portrait) — read when combat pulse fires. */
  isoCombatPlayerCue?: {
    moment: IsoCombatPlayerMoment;
    variant: "spell" | "skill" | "light";
    fatalJump: boolean;
  } | null;
  /** Bumps when the current player performs a maze jump move — plays `Run_and_Jump` (merged GLB) in iso. */
  playerJumpPulseVersion?: number;
  /** While choosing a teleport destination: countdown / manual-pick hint above the 3D view. */
  teleportPickTimerOverlay?: ReactNode;
};

export type MazeIsoViewImperativeHandle = {
  activateRotate: () => void;
  /** While rotate mode is active, extend the auto-exit timer (e.g. continuous minimap ring drag). */
  bumpRotateSession: () => void;
  resetCameraView: () => void;
  /**
   * While the mini-map orbit ring pointer is down: keeps auto-follow off. `rotateMode` from React can lag one
   * frame after `activateRotate()` on touch, which otherwise lets auto-follow fight the ring and can snap the map.
   */
  setOrbitRingPointerHeld: (held: boolean) => void;
  /** Apply the same orbit deltas as dragging on the 3D canvas (e.g. mini-map ring in landscape). */
  orbitLookByPixelDelta: (dxPx: number, dyPx: number) => void;
  /**
   * Slingshot in 3D: map pointer to grid launch from `from` using floor raycast (orbit / tilt safe).
   * Returns null if the ray misses the floor or pull is too small.
   */
  resolveCatapultLaunchAtClient: (
    from: [number, number],
    clientX: number,
    clientY: number,
  ) => { dx: number; dy: number; strength: number } | null;
};

/** Suppresses floor-tile clicks after a camera drag so releasing the mouse button doesn't trigger a move. */
let _suppressNextFloorClick = false;
const DRAG_SUPPRESS_THRESHOLD_PX = 6;

/**
 * World size of one grid step. Path cells are one CS wide between wall centers, so raising CS widens
 * corridors in world space and reduces side walls eating the frustum when the camera sits behind the pawn.
 */
const CS = 3.55;
const FLOOR_Y = 0;
/** Ballistic preview: max “peakH” input (world units); combined with `SLING_ARC_APEX_SCALE` stays near wall top. */
const SLING_ARC_PEAK_MAX = 2.78;
/** Higher floor for short hops so the arc clearly climbs above the surface. */
const SLING_ARC_PEAK_MIN = 1.18;
/** Extra height vs horizontal chord length (world units along ground). */
const SLING_ARC_PEAK_PER_CHORD = 0.82;
/**
 * Parabola `peakH * scale * t * (1-t)` peaks at `t=0.5` with value `peakH * scale / 4`.
 * Scale 4.5 vs 4 yields a ~12.5% higher apex for the same peakH.
 */
const SLING_ARC_APEX_SCALE = 4.5;
/** Curve samples + shader dash segments (must match SlingshotTrajectoryArc). */
const SLING_ARC_SEG_STEPS = 56;

/** Ray from screen → horizontal floor plane (y = planeY). Respects current camera / canvas rect (orbit-safe aim). */
function intersectClientWithFloor(
  camera: THREE.PerspectiveCamera,
  domEl: HTMLElement,
  clientX: number,
  clientY: number,
  planeY: number,
): THREE.Vector3 | null {
  const rect = domEl.getBoundingClientRect();
  const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
  const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
  const clip = new THREE.Vector3(ndcX, ndcY, 0.5);
  clip.unproject(camera);
  const origin = camera.position;
  const dir = clip.sub(origin).normalize();
  if (Math.abs(dir.y) < 1e-5) return null;
  const t = (planeY - origin.y) / dir.y;
  if (t <= 0) return null;
  return origin.clone().addScaledVector(dir, t);
}

const SLING_ANCHOR_MIN_WORLD = 0.09;
const SLING_STRENGTH_MIN = 16;
const SLING_STRENGTH_MAX = 260;
/** Screen pull length (px) maps to trajectory strength (matches grid drag feel). */
const SLING_STRENGTH_PER_SCREEN_PX = 2.55;

function projectWorldPointToClient(
  camera: THREE.PerspectiveCamera,
  domEl: HTMLElement,
  wx: number,
  wy: number,
  wz: number,
): { x: number; y: number } {
  const v = new THREE.Vector3(wx, wy, wz).project(camera);
  const rect = domEl.getBoundingClientRect();
  const x = (v.x * 0.5 + 0.5) * rect.width + rect.left;
  const y = (-v.y * 0.5 + 0.5) * rect.height + rect.top;
  return { x, y };
}

/**
 * Slingshot aim from screen pull relative to the **on-screen** launch ring (Angry-Birds style).
 * Launch direction = floor hit along the opposite of screen pull, so “pull down” shoots toward the top of the view.
 */
function computeSlingLaunchScreenPull(
  from: [number, number],
  fingerClientX: number,
  fingerClientY: number,
  camera: THREE.PerspectiveCamera,
  domEl: HTMLElement,
): { dx: number; dy: number; strength: number } | null {
  const ax = from[0] * CS;
  const az = from[1] * CS;
  const anchorClient = projectWorldPointToClient(camera, domEl, ax, FLOOR_Y + 0.12, az);
  const pullSx = fingerClientX - anchorClient.x;
  const pullSy = fingerClientY - anchorClient.y;
  const pullLen = Math.hypot(pullSx, pullSy);
  if (pullLen < 14) return null;
  const lux = -pullSx / pullLen;
  const luy = -pullSy / pullLen;
  const extendPx = Math.min(580, Math.max(100, pullLen * 2.5));
  const tryHit = (mult: number) =>
    intersectClientWithFloor(
      camera,
      domEl,
      anchorClient.x + lux * extendPx * mult,
      anchorClient.y + luy * extendPx * mult,
      FLOOR_Y + 0.06,
    );
  const hit = tryHit(1) ?? tryHit(0.55) ?? tryHit(0.3);
  if (!hit) return null;
  const launchX = hit.x - ax;
  const launchZ = hit.z - az;
  const wlen = Math.hypot(launchX, launchZ);
  if (wlen < SLING_ANCHOR_MIN_WORLD) return null;
  const strength = Math.min(
    SLING_STRENGTH_MAX,
    Math.max(SLING_STRENGTH_MIN, pullLen * SLING_STRENGTH_PER_SCREEN_PX),
  );
  return { dx: launchX / CS, dy: launchZ / CS, strength };
}

function CanvasContextBridge({
  cameraRef,
  glDomRef,
}: {
  cameraRef: MutableRefObject<THREE.Camera | null>;
  glDomRef: MutableRefObject<HTMLCanvasElement | null>;
}) {
  const { camera, gl } = useThree();
  useFrame(() => {
    cameraRef.current = camera;
    glDomRef.current = gl.domElement;
  });
  return null;
}

/** Default browser behavior on context loss can leave the maze canvas blank; after restore, force a R3F frame. */
function WebGlContextLossGuard() {
  const { gl, invalidate } = useThree();
  useEffect(() => {
    const canvas = gl.domElement;
    const onLost = (e: Event) => {
      e.preventDefault();
    };
    const onRestored = () => {
      invalidate();
    };
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
    return () => {
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
    };
  }, [gl, invalidate]);
  return null;
}

const SLING_ARC_VERTS = SLING_ARC_SEG_STEPS + 1;

const SLING_ARC_VERTEX_SHADER = /* glsl */ `
  attribute float progress;
  varying float vProg;
  void main() {
    vProg = progress;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SLING_ARC_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  uniform float uBaseOpacity;
  uniform float uDashRepeat;
  uniform float uDashDuty;
  varying float vProg;
  void main() {
    float d = fract(vProg * uDashRepeat);
    if (d > uDashDuty) discard;
    float fade = 1.0 - smoothstep(0.28, 0.86, vProg);
    gl_FragColor = vec4(uColor, uBaseOpacity * fade);
  }
`;

/** World-space arc from slingshot cell, matching `getCatapultTrajectory` and current orbit. */
function SlingshotTrajectoryArc({
  from,
  aimClient,
  previewFn,
}: {
  from: [number, number];
  aimClient: { x: number; y: number } | null;
  previewFn: CatapultTrajectoryPreviewFn;
}) {
  const { camera, gl } = useThree();
  const lineObj = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(SLING_ARC_VERTS * 3);
    const prog = new Float32Array(SLING_ARC_VERTS);
    for (let i = 0; i < SLING_ARC_VERTS; i++) {
      prog[i] = i / SLING_ARC_SEG_STEPS;
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("progress", new THREE.BufferAttribute(prog, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(0xffdd88) },
        uBaseOpacity: { value: 0.92 },
        uDashRepeat: { value: 32 },
        uDashDuty: { value: 0.5 },
      },
      vertexShader: SLING_ARC_VERTEX_SHADER,
      fragmentShader: SLING_ARC_FRAGMENT_SHADER,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const line = new THREE.Line(geo, mat);
    line.renderOrder = 920;
    return line;
  }, []);

  useEffect(() => {
    return () => {
      lineObj.geometry.dispose();
      (lineObj.material as THREE.ShaderMaterial).dispose();
    };
  }, [lineObj]);

  useFrame(() => {
    const line = lineObj;
    if (!aimClient) {
      line.visible = false;
      return;
    }
    const launch = computeSlingLaunchScreenPull(
      from,
      aimClient.x,
      aimClient.y,
      camera as THREE.PerspectiveCamera,
      gl.domElement,
    );
    if (!launch) {
      line.visible = false;
      return;
    }
    const traj = previewFn(from[0], from[1], launch.dx, launch.dy, launch.strength);
    if (!traj?.arcPoints?.length) {
      line.visible = false;
      return;
    }
    line.visible = true;
    /**
     * `getCatapultTrajectory` adds a sideways bend in **grid X/Y** (perp offset) for a 2D map arc.
     * Lifting those points by Y-only height yields a 3D curve that is **not** in one vertical plane, so the
     * arc looked “tilted” vs the floor. Preview: straight chord on the floor from launch → landing, height
     * only — one vertical plane, orthogonal to the maze surface (same landing as game logic).
     */
    const g0x = from[0];
    const g0y = from[1];
    const g1x = traj.destX;
    const g1y = traj.destY;
    if (g0x === g1x && g0y === g1y) {
      line.visible = false;
      return;
    }
    const horizChord = Math.hypot((g1x - g0x) * CS, (g1y - g0y) * CS);
    const peakH = Math.min(
      SLING_ARC_PEAK_MAX,
      Math.max(SLING_ARC_PEAK_MIN, horizChord * SLING_ARC_PEAK_PER_CHORD),
    );
    const geo = line.geometry as THREE.BufferGeometry;
    const posArr = (geo.attributes.position as THREE.BufferAttribute).array as Float32Array;
    for (let i = 0; i < SLING_ARC_VERTS; i++) {
      const t = i / SLING_ARC_SEG_STEPS;
      const gx = g0x + (g1x - g0x) * t;
      const gy = g0y + (g1y - g0y) * t;
      const wy = FLOOR_Y + 0.08 + peakH * SLING_ARC_APEX_SCALE * t * (1 - t);
      posArr[i * 3] = gx * CS;
      posArr[i * 3 + 1] = wy;
      posArr[i * 3 + 2] = gy * CS;
    }
    geo.attributes.position.needsUpdate = true;
    geo.computeBoundingSphere();
  });

  return <primitive object={lineObj} />;
}

/** Wall blocks fill the full cell — adjacent walls form solid continuous walls. */
const WALL_SIZE = CS;
const WALL_HEIGHT = 3.25;
const WALL_TOP_COLOR = "#3a3a4c";
const ROTATE_TIMEOUT_MS = 3000;
/** Minimap / imperative orbit: block auto-follow briefly after each apply so it does not fight finger drag (rotateMode state can lag one frame). */
const ORBIT_RING_SUPPRESS_AUTO_FOLLOW_MS = 240;

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
    if (_suppressNextFloorClick) {
      _suppressNextFloorClick = false;
      return;
    }
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
function PlayerAvatar3D({
  visualState,
  actionVersion = 0,
  locomotionAxis = "forward",
  jumpPulseVersion = 0,
  glbPath,
  weaponGltfPath,
  combatPlayback,
}: {
  visualState: "idle" | "hunt" | "attack";
  actionVersion?: number;
  /** Movement vs facing while walking the maze — drives directional crouch-walk clips. */
  locomotionAxis?: PlayerIsoLocomotionAxis;
  /** Monotonic bump from parent on jump move — one-shot jump animation. */
  jumpPulseVersion?: number;
  glbPath?: string;
  /** When set, uses the same bone attach as combat 3D (`BoneAttachedWeapon`). */
  weaponGltfPath?: string | null;
  /** One-shot combat clip (strike / counter / shield) — overrides locomotion visualState. */
  combatPlayback?: {
    moment: IsoCombatPlayerMoment;
    variant: "spell" | "skill" | "light";
    fatalJump?: boolean;
  } | null;
}) {
  const url = glbPath || PLAYER_3D_GLB;
  const rootRef = useRef<THREE.Group>(null);
  const [placeholderHand, setPlaceholderHand] = useState<THREE.Object3D | null>(null);
  const lastJumpPulseRef = useRef(0);
  const jumpWindowStartSecRef = useRef(-1e9);
  const [locomotionRefresh, setLocomotionRefresh] = useState(0);
  const { scene, animations } = useGLTF(url);
  const clonedScene = useMemo(() => SkeletonUtils.clone(scene), [scene]);
  const { actions, names } = useAnimations(animations, rootRef);

  useEffect(() => {
    clonedScene.traverse((obj) => {
      if (obj instanceof THREE.Light) {
        obj.visible = false;
        return;
      }
      if (obj instanceof THREE.Mesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
  }, [clonedScene]);

  useEffect(() => {
    if (weaponGltfPath) {
      setPlaceholderHand(null);
      return;
    }
    let rightHand: THREE.Object3D | null = null;
    clonedScene.traverse((obj) => {
      if (!rightHand && /(hand|wrist).*(right|\.r|\br\b)|\br_hand\b|hand_r|right_hand/i.test(obj.name)) {
        rightHand = obj;
      }
    });
    setPlaceholderHand(rightHand);
  }, [clonedScene, weaponGltfPath]);

  useEffect(() => {
    if (jumpPulseVersion > lastJumpPulseRef.current) {
      lastJumpPulseRef.current = jumpPulseVersion;
      jumpWindowStartSecRef.current = performance.now() / 1000;
      setLocomotionRefresh((v) => v + 1);
      const tid = window.setTimeout(() => setLocomotionRefresh((v) => v + 1), 920);
      return () => window.clearTimeout(tid);
    }
  }, [jumpPulseVersion]);

  useEffect(() => {
    let clip: string | null = null;
    let loopOnce = false;
    const pb = combatPlayback;
    if (pb) {
      loopOnce = true;
      if (pb.moment === "shield") {
        clip = resolvePlayerShieldBlockClipName(names);
      } else if (pb.moment === "hurt") {
        clip = resolvePlayerAnimationClipName("hurt", names, pb.variant, { fatalJumpKill: !!pb.fatalJump });
      } else {
        clip = resolvePlayerAnimationClipName("attack", names, pb.variant);
      }
    } else {
      const nowSec = performance.now() / 1000;
      const inJumpWindow =
        jumpWindowStartSecRef.current > -1e8 && nowSec - jumpWindowStartSecRef.current < 0.9;
      if (inJumpWindow) {
        clip = resolvePlayerJumpLocomotionClipName(names);
        if (!clip) clip = resolvePlayerHuntLocomotionClipName(names, locomotionAxis);
        loopOnce = true;
      } else if (visualState === "hunt") {
        clip = resolvePlayerHuntLocomotionClipName(names, locomotionAxis);
        loopOnce = false;
      } else {
        clip = resolvePlayerAnimationClipName(visualState, names);
        loopOnce = visualState === "attack";
      }
    }
    for (const action of Object.values(actions)) {
      action?.fadeOut(0.12);
    }
    if (!clip) return;
    const action = actions[clip];
    if (!action) return;
    action.reset();
    if (loopOnce) {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = false;
    } else {
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.clampWhenFinished = false;
    }
    action.fadeIn(0.16).play();
    return () => { action.fadeOut(0.12); };
  }, [actions, names, visualState, actionVersion, combatPlayback, locomotionAxis, locomotionRefresh]);

  return (
    <group ref={rootRef} scale={0.9} rotation={[0, Math.PI / 2, 0]}>
      <primitive object={clonedScene} />
      {weaponGltfPath ? (
        <WeaponLoadErrorBoundary key={weaponGltfPath}>
          <Suspense fallback={null}>
            <BoneAttachedWeapon parentScene={clonedScene} url={weaponGltfPath} attachHand={WEAPON_ATTACH_HAND} />
          </Suspense>
        </WeaponLoadErrorBoundary>
      ) : null}
      {!weaponGltfPath && placeholderHand ? (
        <primitive object={placeholderHand}>
          {/* Placeholder gauntlet when no equipped weapon GLB. */}
          <group position={[0.015, -0.01, 0.035]} rotation={[0.1, 0.25, -0.12]}>
            <mesh castShadow receiveShadow>
              <boxGeometry args={[0.065, 0.08, 0.07]} />
              <meshStandardMaterial color="#6f7684" metalness={0.5} roughness={0.45} />
            </mesh>
            <mesh position={[0, -0.04, -0.028]} rotation={[0.1, 0, 0]} castShadow receiveShadow>
              <cylinderGeometry args={[0.028, 0.03, 0.07, 8]} />
              <meshStandardMaterial color="#525866" metalness={0.46} roughness={0.52} />
            </mesh>
          </group>
        </primitive>
      ) : null}
    </group>
  );
}

function combatHoldSeconds(moment: IsoCombatPlayerMoment, fatalJump: boolean): number {
  if (moment === "hurt") return fatalJump ? 1.35 : 0.92;
  if (moment === "shield") return 0.62;
  return 0.78;
}

function PlayerMarker({
  playerX,
  playerY,
  facingDx,
  facingDy,
  combatPulse = 0,
  playerGlbPath,
  playerWeaponGltfPath,
  isoCombatPlayerCue,
  playerJumpPulseVersion = 0,
}: {
  playerX: number;
  playerY: number;
  facingDx: number;
  facingDy: number;
  combatPulse?: number;
  playerGlbPath?: string;
  playerWeaponGltfPath?: string | null;
  isoCombatPlayerCue?: {
    moment: IsoCombatPlayerMoment;
    variant: "spell" | "skill" | "light";
    fatalJump: boolean;
  } | null;
  playerJumpPulseVersion?: number;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const modelAnchorRef = useRef<THREE.Group>(null);
  const targetPos = useRef(new THREE.Vector3(playerX * CS, FLOOR_Y + 0.02, playerY * CS));
  const targetYawRef = useRef(0);
  const facingDxRef = useRef(facingDx);
  const facingDyRef = useRef(facingDy);
  facingDxRef.current = facingDx;
  facingDyRef.current = facingDy;
  const didInitPosRef = useRef(false);
  const groundLiftRef = useRef(0);
  const groundBox = useMemo(() => new THREE.Box3(), []);
  const [visualState, setVisualState] = useState<"idle" | "hunt" | "attack">("idle");
  const visualStateRef = useRef<"idle" | "hunt" | "attack">("idle");
  const [locomotionAxis, setLocomotionAxis] = useState<PlayerIsoLocomotionAxis>("forward");
  const locomotionAxisRef = useRef<PlayerIsoLocomotionAxis>("forward");
  const [actionVersion, setActionVersion] = useState(0);
  const [combatPlayback, setCombatPlayback] = useState<{
    moment: IsoCombatPlayerMoment;
    variant: "spell" | "skill" | "light";
    fatalJump: boolean;
  } | null>(null);
  const combatPlaybackRef = useRef(combatPlayback);
  combatPlaybackRef.current = combatPlayback;
  const queuedCombatPulseRef = useRef(false);
  const combatAttackUntilRef = useRef(0);
  const prevCombatPulseRef = useRef(combatPulse);
  const cueSnapshotRef = useRef(isoCombatPlayerCue);
  cueSnapshotRef.current = isoCombatPlayerCue;

  useEffect(() => { targetPos.current.set(playerX * CS, FLOOR_Y + 0.02, playerY * CS); }, [playerX, playerY]);
  useEffect(() => {
    if (combatPulse <= 0) return;
    if (combatPulse === prevCombatPulseRef.current) return;
    prevCombatPulseRef.current = combatPulse;
    queuedCombatPulseRef.current = true;
  }, [combatPulse]);

  useFrame(() => {
    if (!groupRef.current) return;
    const fdx = facingDxRef.current;
    const fdy = facingDyRef.current;
    const facingLen = Math.hypot(fdx, fdy);
    if (facingLen > 0.01) {
      /* Grid-facing yaw — same basis as movement / minimap arrow. Do not blend toward camera (that made forward walk read as strafe). */
      targetYawRef.current = -Math.atan2(fdy, fdx);
    }
    if (!didInitPosRef.current) {
      groupRef.current.position.copy(targetPos.current);
      groupRef.current.rotation.y = targetYawRef.current;
      didInitPosRef.current = true;
    }
    groupRef.current.position.lerp(targetPos.current, 0.08);

    const delta = THREE.MathUtils.euclideanModulo(targetYawRef.current - groupRef.current.rotation.y + Math.PI, Math.PI * 2) - Math.PI;
    groupRef.current.rotation.y += delta * 0.14;
    const transit = groupRef.current.position.distanceTo(targetPos.current);
    const tNow = performance.now() * 0.001;
    if (queuedCombatPulseRef.current) {
      queuedCombatPulseRef.current = false;
      const cue = cueSnapshotRef.current ?? { moment: "strike" as const, variant: "skill" as const, fatalJump: false };
      const hold = combatHoldSeconds(cue.moment, cue.fatalJump);
      combatAttackUntilRef.current = tNow + hold;
      setCombatPlayback(cue);
      setActionVersion((v) => v + 1);
    }
    const inCombatClip = tNow < combatAttackUntilRef.current;
    if (!inCombatClip && combatPlaybackRef.current != null) {
      setCombatPlayback(null);
    }
    const attacking = inCombatClip;
    const next: "idle" | "hunt" | "attack" = attacking ? "attack" : (transit > 0.06 ? "hunt" : "idle");
    if (next !== visualStateRef.current) {
      visualStateRef.current = next;
      setVisualState(next);
    }
    if (!attacking && transit > 0.06) {
      const gx = targetPos.current.x - groupRef.current.position.x;
      const gz = targetPos.current.z - groupRef.current.position.z;
      const glen = Math.hypot(gx, gz);
      let axis: PlayerIsoLocomotionAxis = "forward";
      if (glen > 1e-5) {
        const vx = gx / glen;
        const vz = gz / glen;
        const fdx = facingDxRef.current;
        const fdy = facingDyRef.current;
        const fl = Math.hypot(fdx, fdy);
        if (fl > 1e-5) {
          const fx = fdx / fl;
          const fy = fdy / fl;
          const forwardDot = vx * fx + vz * fy;
          const rightDot = vx * (-fy) + vz * fx;
          const adf = Math.abs(forwardDot);
          const adr = Math.abs(rightDot);
          if (adf >= adr) {
            axis = forwardDot >= 0 ? "forward" : "back";
          } else {
            axis = rightDot >= 0 ? "right" : "left";
          }
        }
      }
      if (axis !== locomotionAxisRef.current) {
        locomotionAxisRef.current = axis;
        setLocomotionAxis(axis);
      }
    } else if (!attacking && transit <= 0.06 && locomotionAxisRef.current !== "forward") {
      locomotionAxisRef.current = "forward";
      setLocomotionAxis("forward");
    }
    const modelAnchor = modelAnchorRef.current;
    if (modelAnchor) {
      groundBox.setFromObject(modelAnchor);
      const desiredMinY = FLOOR_Y + 0.015;
      const neededLift = Math.max(0, desiredMinY - groundBox.min.y);
      // Keep feet on floor if clip root offsets dip below the maze plane.
      groundLiftRef.current = Math.max(groundLiftRef.current * 0.9, neededLift);
      modelAnchor.position.y = groundLiftRef.current;
    }
  });

  return (
    <group ref={groupRef}>
      {/* Floor locator — reads on dark stone; independent of GLB load. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.018, 0]} renderOrder={1}>
        <ringGeometry args={[0.46, 0.72, 40]} />
        <meshBasicMaterial color="#6dffd8" transparent opacity={0.62} depthWrite={false} />
      </mesh>
      {/* Follow light bound to player marker so nearby floor/walls stay readable while moving. */}
      <pointLight
        position={[0, 1.15, 0]}
        color="#a8ffd6"
        intensity={3.1}
        distance={CS * 5.2}
        decay={1.75}
      />
      <group ref={modelAnchorRef}>
        <Suspense
          fallback={(
            <>
              <mesh castShadow receiveShadow>
                <cylinderGeometry args={[0.45, 0.45, 0.8, 16]} />
                <meshStandardMaterial color="#00ff88" emissive="#00ff44" emissiveIntensity={0.6} />
              </mesh>
              <mesh position={[0.55, 0, 0]} rotation={[0, 0, -Math.PI / 2]} castShadow>
                <coneGeometry args={[0.2, 0.5, 8]} />
                <meshStandardMaterial color="#0a0a0f" />
              </mesh>
            </>
          )}
        >
          <PlayerAvatar3D
            key={`${playerGlbPath ?? PLAYER_3D_GLB}|${playerWeaponGltfPath ?? ""}`}
            visualState={visualState}
            actionVersion={actionVersion}
            locomotionAxis={locomotionAxis}
            jumpPulseVersion={playerJumpPulseVersion}
            glbPath={playerGlbPath}
            weaponGltfPath={playerWeaponGltfPath}
            combatPlayback={combatPlayback}
          />
        </Suspense>
      </group>
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

const MAZE_SPIDER_WEB_DECAL_TEXTURE = "/textures/maze/Effects/spider_web_decal.png";
const MAZE_CORRIDOR_FOG_TEXTURE = "/textures/maze/Effects/corridor_fog_tile.png";

void useTexture.preload(MAZE_SPIDER_WEB_DECAL_TEXTURE);
void useTexture.preload(MAZE_CORRIDOR_FOG_TEXTURE);

/** Scene linear fog — materials use default `fog: true`. */
function MazeAtmosphericFog() {
  const { scene } = useThree();
  useLayoutEffect(() => {
    const prev = scene.fog;
    scene.fog = new THREE.Fog(0x06080e, 14, 132);
    return () => {
      scene.fog = prev ?? null;
    };
  }, [scene]);
  return null;
}

/** Volumetric-style mist sheets in fogged path cells (tile texture). */
function CorridorFogVolumes({
  grid,
  mapWidth,
  mapHeight,
  fogIntensityMap,
}: {
  grid: string[][];
  mapWidth: number;
  mapHeight: number;
  fogIntensityMap?: Map<string, number>;
}) {
  const fogTex = useTexture(MAZE_CORRIDOR_FOG_TEXTURE);
  useEffect(() => {
    fogTex.wrapS = fogTex.wrapT = THREE.RepeatWrapping;
    fogTex.repeat.set(2.2, 2.2);
  }, [fogTex]);

  const cells = useMemo(() => {
    const out: Array<{ cx: number; cy: number; f: number; rot: number }> = [];
    for (let y = 0; y < mapHeight; y++) {
      for (let x = 0; x < mapWidth; x++) {
        if (grid[y]?.[x] === WALL) continue;
        const f = fogIntensityMap?.get(`${x},${y}`) ?? 0;
        if (f < 0.035) continue;
        out.push({ cx: x, cy: y, f, rot: cellNoise(x, y, 701) * Math.PI * 2 });
      }
    }
    return out;
  }, [grid, mapHeight, mapWidth, fogIntensityMap]);

  return (
    <>
      {cells.map((c) => {
        const px = c.cx * CS + CS * 0.5;
        const pz = c.cy * CS + CS * 0.5;
        const op = Math.min(0.72, 0.1 + c.f * 0.78);
        return (
          <group key={`fog-${c.cx}-${c.cy}`}>
            <mesh position={[px, 0.22 + c.f * 0.35, pz]} rotation={[-Math.PI / 2, 0, c.rot]} renderOrder={1}>
              <planeGeometry args={[CS * 0.94, CS * 0.94]} />
              <meshStandardMaterial
                map={fogTex}
                transparent
                opacity={op * 0.55}
                depthWrite={false}
                roughness={1}
                metalness={0}
                color="#9aa8c4"
                emissive="#2a3144"
                emissiveIntensity={0.04}
                polygonOffset
                polygonOffsetFactor={-2}
                polygonOffsetUnits={-1}
              />
            </mesh>
            <mesh position={[px, 0.85 + c.f * 0.45, pz]} rotation={[-Math.PI / 2, 0, c.rot + 1.7]} renderOrder={1}>
              <planeGeometry args={[CS * 0.78, CS * 0.78]} />
              <meshStandardMaterial
                map={fogTex}
                transparent
                opacity={op * 0.42}
                depthWrite={false}
                roughness={1}
                metalness={0}
                color="#8a96b0"
                emissive="#252a3a"
                emissiveIntensity={0.03}
                polygonOffset
                polygonOffsetFactor={-2}
                polygonOffsetUnits={-1}
              />
            </mesh>
          </group>
        );
      })}
    </>
  );
}

/** Realistic web decals on maze-web cells + sparse corner cobwebs. */
function SpiderWebDecor({
  grid,
  mapWidth,
  mapHeight,
  fogIntensityMap,
  spiderWebCells = [],
}: {
  grid: string[][];
  mapWidth: number;
  mapHeight: number;
  fogIntensityMap?: Map<string, number>;
  spiderWebCells?: ReadonlyArray<readonly [number, number]>;
}) {
  const webTex = useTexture(MAZE_SPIDER_WEB_DECAL_TEXTURE);

  const isW = (cx: number, cy: number) => grid[cy]?.[cx] === WALL;
  const walkable = (cx: number, cy: number) =>
    cx >= 0 && cy >= 0 && cx < mapWidth && cy < mapHeight && !isW(cx, cy);

  const cornerWebs = useMemo(() => {
    const out: Array<{
      x: number;
      y: number;
      z: number;
      yaw: number;
      scale: number;
      cellX: number;
      cellY: number;
    }> = [];
    for (let y = 1; y < mapHeight - 1; y++) {
      for (let x = 1; x < mapWidth - 1; x++) {
        if (!walkable(x, y)) continue;
        if (cellNoise(x, y, 151) > 0.88) continue;
        const nearCorner =
          (isW(x + 1, y) && isW(x, y + 1)) ||
          (isW(x - 1, y) && isW(x, y + 1)) ||
          (isW(x + 1, y) && isW(x, y - 1)) ||
          (isW(x - 1, y) && isW(x, y - 1));
        if (!nearCorner) continue;
        const yaw = cellNoise(x, y, 157) * Math.PI * 2;
        const scale = CS * (0.55 + cellNoise(x, y, 163) * 0.35);
        out.push({
          x: x * CS + (cellNoise(x, y, 167) - 0.5) * CS * 0.38,
          y: WALL_HEIGHT * (0.38 + cellNoise(x, y, 173) * 0.28),
          z: y * CS + (cellNoise(x, y, 179) - 0.5) * CS * 0.38,
          yaw,
          scale,
          cellX: x,
          cellY: y,
        });
      }
    }
    return out;
  }, [grid, mapHeight, mapWidth]);

  const mazeWebWallDecals = useMemo(() => {
    const out: Array<{
      x: number;
      y: number;
      z: number;
      yaw: number;
      scale: number;
      cellX: number;
      cellY: number;
    }> = [];
    for (const pair of spiderWebCells) {
      const wx = pair[0];
      const wy = pair[1];
      if (!walkable(wx, wy)) continue;
      const fog = fogIntensityMap?.get(`${wx},${wy}`) ?? 0;
      if (fog > 0.2) continue;
      const pushIf = (wcx: number, wcy: number, pos: { x: number; z: number }, dirX: number, dirZ: number) => {
        if (!isW(wcx, wcy)) return;
        out.push({
          x: pos.x,
          y: WALL_HEIGHT * (0.44 + cellNoise(wx, wy, 509) * 0.2),
          z: pos.z,
          yaw: Math.atan2(dirX, dirZ),
          scale: CS * (0.92 + cellNoise(wx, wy, 517) * 0.28),
          cellX: wx,
          cellY: wy,
        });
      };
      pushIf(wx + 1, wy, { x: wx * CS + CS * 0.42, z: wy * CS }, -1, 0);
      pushIf(wx - 1, wy, { x: wx * CS - CS * 0.42, z: wy * CS }, 1, 0);
      pushIf(wx, wy + 1, { x: wx * CS, z: wy * CS + CS * 0.42 }, 0, -1);
      pushIf(wx, wy - 1, { x: wx * CS, z: wy * CS - CS * 0.42 }, 0, 1);
    }
    return out;
  }, [fogIntensityMap, grid, mapHeight, mapWidth, spiderWebCells]);

  const webMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: webTex,
        transparent: true,
        alphaTest: 0.08,
        side: THREE.DoubleSide,
        depthWrite: false,
        roughness: 0.94,
        metalness: 0.02,
        color: new THREE.Color("#eef2ff"),
        emissive: new THREE.Color("#c5d0ec"),
        emissiveIntensity: 0.07,
        opacity: 0.94,
      }),
    [webTex],
  );

  return (
    <>
      {cornerWebs.map((w, i) => {
        const fog = fogIntensityMap?.get(`${w.cellX},${w.cellY}`) ?? 0;
        if (fog > 0.16) return null;
        return (
          <group key={`cweb-${i}`} position={[w.x, w.y, w.z]} rotation={[0, w.yaw, 0]}>
            <mesh material={webMat} renderOrder={6}>
              <planeGeometry args={[w.scale, w.scale * 1.05]} />
            </mesh>
          </group>
        );
      })}
      {mazeWebWallDecals.map((w, i) => (
        <group key={`wweb-${i}`} position={[w.x, w.y, w.z]} rotation={[0, w.yaw, 0]}>
          <mesh material={webMat} renderOrder={7}>
            <planeGeometry args={[w.scale, w.scale * 1.08]} />
          </mesh>
        </group>
      ))}
    </>
  );
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

for (const _mazeArtifactPreloadUrl of COLLECTIBLE_ARTIFACT_GLB_URLS) {
  void useGLTF.preload(_mazeArtifactPreloadUrl);
}

function GenericRotatingArtifactOrb({ x, y }: { x: number; y: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 1.25;
  });
  const px = x * CS + CS * 0.5;
  const pz = y * CS + CS * 0.5;
  return (
    <group ref={ref} position={[px, FLOOR_Y + 0.36, pz]}>
      <mesh castShadow>
        <octahedronGeometry args={[0.2, 0]} />
        <meshStandardMaterial
          color="#9b87f5"
          emissive="#5b21b6"
          emissiveIntensity={0.5}
          metalness={0.35}
          roughness={0.38}
        />
      </mesh>
    </group>
  );
}

function RotatingArtifactGlbPickup({ x, y, url }: { x: number; y: number; url: string }) {
  const { scene } = useGLTF(url);
  const clone = useMemo(() => SkeletonUtils.clone(scene), [scene]);
  const spinRef = useRef<THREE.Group>(null);
  useEffect(() => {
    clone.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
  }, [clone]);
  useLayoutEffect(() => {
    clone.scale.setScalar(1);
    const box = new THREE.Box3().setFromObject(clone);
    const size = box.getSize(new THREE.Vector3());
    const maxD = Math.max(size.x, size.y, size.z, 1e-4);
    const u = 0.54 / maxD;
    clone.scale.setScalar(u);
    clone.updateMatrixWorld(true);
    const b2 = new THREE.Box3().setFromObject(clone);
    clone.position.set(0, -b2.min.y + 0.02, 0);
  }, [clone]);
  useFrame((_, dt) => {
    if (spinRef.current) spinRef.current.rotation.y += dt * 1.05;
  });
  const px = x * CS + CS * 0.5;
  const pz = y * CS + CS * 0.5;
  return (
    <group position={[px, FLOOR_Y + 0.02, pz]}>
      <group ref={spinRef}>
        <primitive object={clone} />
      </group>
    </group>
  );
}

function MazeArtifactPickups({
  pickups,
}: {
  pickups: Array<{ x: number; y: number; kind: StoredArtifactKind }>;
}) {
  if (!pickups.length) return null;
  return (
    <>
      {pickups.map((p) => {
        const url = ARTIFACT_KIND_VISUAL_GLB[p.kind];
        const key = `${p.x},${p.y},${p.kind}`;
        if (url) {
          return <RotatingArtifactGlbPickup key={key} x={p.x} y={p.y} url={url} />;
        }
        return <GenericRotatingArtifactOrb key={key} x={p.x} y={p.y} />;
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
/**
 * Slingshot aim: stay just above wall tops with a small extra lift on large maps (not satellite height).
 */
const CATAPULT_CAM_ABOVE_WALL = 1.12;
const CATAPULT_CAM_EXTRA_PER_CELL = 0.036;
const CATAPULT_CAM_EXTRA_MAX = 2.65;
const CATAPULT_CAM_BACK_BASE = 1.72;
/** Extra pull-back along facing, capped so huge maps do not move the rig too far horizontally. */
const CATAPULT_CAM_BACK_EXTRA_MAX = 1.95;
const CATAPULT_CAM_BACK_PER_CELL = 0.068;
/** Look-at near the launch tile floor so the grid and arc read as a plan view. */
const CATAPULT_LOOK_AT_Y = 0.14;
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
  grid, mapWidth, mapHeight, playerX, playerY, facingDx, facingDy, zoom, rotateMode, resetTick, teleportMode, catapultMode,
  catapultLockCameraForPull,
  focusVersion,
  touchUi,
  onTouchCameraForwardGrid,
  onIsoCameraBearingDeg,
  isoBearingSyncKey = 0,
  orbitLookApplierRef,
  orbitRingPointerHeldRef,
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
  catapultLockCameraForPull: boolean;
  focusVersion?: number;
  touchUi: boolean;
  onTouchCameraForwardGrid?: (dx: number, dy: number) => void;
  onIsoCameraBearingDeg?: (deg: number) => void;
  isoBearingSyncKey?: number;
  orbitLookApplierRef: MutableRefObject<((dxPx: number, dyPx: number) => void) | null>;
  orbitRingPointerHeldRef: MutableRefObject<boolean>;
}) {
  const { camera, gl } = useThree();
  const controlsRef = useRef<any>(null);
  const prevResetTick = useRef(resetTick);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  /** Which mouse button started the current canvas drag (0 = left, 2 = right). Touch drags leave this null. */
  const mouseOrbitButtonRef = useRef<number | null>(null);
  const dragAccumRef = useRef(0);
  /** True for exactly the frame when orbitLookByPixelDelta (minimap ring) applied a delta — synchronous guard like dragRef. */
  const lastOrbitRingApplyMsRef = useRef(0);
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

  /** Teleport destination picking: allow orbit / minimap ring so the player can inspect beacons; slingshot pull still locks. */
  const lockCameraToAutoFraming = catapultMode && catapultLockCameraForPull;

  useLayoutEffect(() => {
    orbitLookApplierRef.current = (dxPx: number, dyPx: number) => {
      mapRotationLog("orbitLookByPixelDelta", { dxPx, dyPx, source: "ringOrCanvasRef" }, 60);
      applyManualOrbitFromDelta(camera, controlsRef, dxPx, dyPx, hasManualCameraRef, manualOffsetRef);
      lastOrbitRingApplyMsRef.current =
        typeof performance !== "undefined" ? performance.now() : typeof Date !== "undefined" ? Date.now() : 0;
    };
    return () => {
      orbitLookApplierRef.current = null;
    };
  }, [camera, orbitLookApplierRef]);

  useEffect(() => {
    lastTouchForwardGridRef.current = null;
  }, [focusVersion, playerX, playerY]);

  useEffect(() => {
    lastEmittedBearingDegRef.current = null;
    mapRotationLog("isoBearingSyncKey", { clearedLastEmittedBearing: true, isoBearingSyncKey });
  }, [isoBearingSyncKey]);

  useEffect(() => {
    if (camera instanceof THREE.PerspectiveCamera) {
      let baseFov = THREE.MathUtils.clamp(92 - zoom * 16, 58, 95);
      // Teleport: wide FOV. Slingshot: modest extra (camera sits near wall height, not far above).
      let fovBoost = 0;
      if (teleportMode || catapultMode) {
        fovBoost = 18 + (catapultMode ? 4 : 0);
      }
      camera.fov =
        fovBoost > 0 ? THREE.MathUtils.clamp(baseFov + fovBoost, 72, 108) : baseFov;
      camera.updateProjectionMatrix();
    }
  }, [camera, zoom, teleportMode, catapultMode]);

  const prevCatapultRef = useRef(false);
  useEffect(() => {
    if (catapultMode && !prevCatapultRef.current) {
      hasManualCameraRef.current = false;
      manualOffsetRef.current = null;
    }
    prevCatapultRef.current = catapultMode;
  }, [catapultMode]);

  /* Camera orbit: left/right mouse-drag uses 1:1 pixels. One-finger canvas swipe: same 1:1 when not touchUi
     (match desktop + minimap ring); boosted only in touchUi “tilt / coarse pointer” mode. */
  const TOUCH_ORBIT_SENSITIVITY = 2.45;
  useEffect(() => {
    const canvas = gl.domElement;
    const touchSens = touchUi ? TOUCH_ORBIT_SENSITIVITY : 1;

    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 0 || e.button === 2) {
        dragRef.current = { x: e.clientX, y: e.clientY };
        mouseOrbitButtonRef.current = e.button;
        dragAccumRef.current = 0;
        mapRotationLog("canvasPointer", { phase: "down", button: e.button, touchUi });
        e.preventDefault();
      }
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.x;
      const dy = e.clientY - dragRef.current.y;
      dragAccumRef.current += Math.abs(dx) + Math.abs(dy);
      dragRef.current = { x: e.clientX, y: e.clientY };
      mapRotationLog("canvasOrbitDelta", { dx, dy, kind: "mouse", touchUi }, 80);
      applyManualOrbitFromDelta(camera, controlsRef, dx, dy, hasManualCameraRef, manualOffsetRef);
    };
    const onMouseUp = () => {
      if (dragAccumRef.current > DRAG_SUPPRESS_THRESHOLD_PX) {
        _suppressNextFloorClick = true;
      }
      mapRotationLog("canvasPointer", { phase: "up", touchUi });
      dragRef.current = null;
      mouseOrbitButtonRef.current = null;
      dragAccumRef.current = 0;
    };
    const onContextMenu = (e: MouseEvent) => { e.preventDefault(); };
    const onWheel = () => {
      const ctrl = controlsRef.current;
      if (!ctrl) return;
      mapRotationLog("canvasWheel", { action: "marksManualCameraOffset" });
      hasManualCameraRef.current = true;
      manualOffsetRef.current = camera.position.clone().sub(ctrl.target);
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      e.preventDefault();
      dragRef.current = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY };
      dragAccumRef.current = 0;
      mapRotationLog("canvasPointer", { phase: "touchStart", touchUi, touchSens });
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!dragRef.current || e.touches.length !== 1) return;
      e.preventDefault();
      const t = e.touches[0]!;
      const rawDx = t.clientX - dragRef.current.x;
      const rawDy = t.clientY - dragRef.current.y;
      dragAccumRef.current += Math.abs(rawDx) + Math.abs(rawDy);
      const dx = rawDx * touchSens;
      const dy = rawDy * touchSens;
      dragRef.current = { x: t.clientX, y: t.clientY };
      mapRotationLog("canvasOrbitDelta", { dx, dy, rawDx, rawDy, kind: "touch", touchUi }, 80);
      applyManualOrbitFromDelta(camera, controlsRef, dx, dy, hasManualCameraRef, manualOffsetRef);
    };
    const onTouchEnd = () => {
      if (dragAccumRef.current > DRAG_SUPPRESS_THRESHOLD_PX) {
        _suppressNextFloorClick = true;
      }
      mapRotationLog("canvasPointer", { phase: "touchEnd", touchUi });
      dragRef.current = null;
      dragAccumRef.current = 0;
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
  }, [camera, gl, touchUi]);

  useEffect(() => {
    if (!rotateMode || !touchUi) {
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
  }, [rotateMode, touchUi, camera]);

  /** Keep OrbitControls enabled only for scroll-wheel zoom; pan/rotate are handled by our manual drag. */
  useLayoutEffect(() => {
    const apply = () => {
      const c = controlsRef.current;
      if (!c) return false;
      c.enablePan = false;
      c.enableRotate = false;
      c.enableZoom = true;
      return true;
    };
    if (apply()) return undefined;
    const id = requestAnimationFrame(() => { apply(); });
    return () => cancelAnimationFrame(id);
  }, []);

  useFrame(() => {
    const ctrl = controlsRef.current;
    if (!ctrl) return;

    const now =
      typeof performance !== "undefined" ? performance.now() : typeof Date !== "undefined" ? Date.now() : 0;
    const orbitRingRecently = now - lastOrbitRingApplyMsRef.current < ORBIT_RING_SUPPRESS_AUTO_FOLLOW_MS;
    const orbitRingGesture =
      orbitRingRecently || orbitRingPointerHeldRef.current;

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
    const mapSpan = Math.max(8, mapWidth, mapHeight);
    const lookY = catapultMode ? CATAPULT_LOOK_AT_Y : CAM_LOOK_AT_Y;
    const desiredTarget = new THREE.Vector3(px, lookY, pz);

    let followDist: number;
    let followHeight: number;
    if (catapultMode) {
      const wallTop = FLOOR_Y + WALL_HEIGHT;
      const spanExtra = Math.min(CATAPULT_CAM_EXTRA_MAX, mapSpan * CS * CATAPULT_CAM_EXTRA_PER_CELL);
      followHeight = wallTop + CATAPULT_CAM_ABOVE_WALL + spanExtra;
      followDist =
        CS *
        (CATAPULT_CAM_BACK_BASE +
          Math.min(CATAPULT_CAM_BACK_EXTRA_MAX, mapSpan * CATAPULT_CAM_BACK_PER_CELL));
    } else if (teleportMode) {
      followDist = CAM_BEHIND * 2;
      followHeight = CAM_HEIGHT * 1.7;
    } else {
      followDist = CAM_BEHIND;
      followHeight = CAM_HEIGHT;
    }

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
    if (movedFar && !rotateMode && !dragRef.current && !orbitRingGesture && !lockCameraToAutoFraming) {
      mapRotationLog("manualCameraCleared", {
        reason: "playerMovedFar_noOrbitGesture",
        playerX,
        playerY,
      });
      hasManualCameraRef.current = false;
      manualOffsetRef.current = null;
      transitionBlendRef.current = Math.max(transitionBlendRef.current, 0.42);
    }

    const desiredOffset =
      hasManualCameraRef.current && manualOffsetRef.current && !lockCameraToAutoFraming
        ? manualOffsetRef.current.clone()
        : autoOffset.clone();

    if (
      !touchCameraBootstrappedRef.current &&
      !hasManualCameraRef.current &&
      manualOffsetRef.current == null &&
      !lockCameraToAutoFraming
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
      mapRotationLog("manualCameraCleared", { reason: "resetCameraView_resetTick" });
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
      mapRotationLog("manualCameraCleared", { reason: "focusTurnChanged", focusVersion });
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

    /**
     * Do not clear manual orbit when the player facing flips to a cardinal **because** we are orbiting:
     * `onTouchCameraForwardGrid` snaps view→grid to N/E/S/W while the minimap ring or canvas drag runs.
     * `activateRotate()` commits one frame late; without this guard, `facingChanged && !rotateMode` wiped
     * `manualOffsetRef` and the camera jumped in coarse steps (especially on mobile landscape ring drag).
     */
    if (facingChanged && !rotateMode && !dragRef.current && !orbitRingGesture) {
      mapRotationLog("manualCameraCleared", {
        reason: "gridFacingChanged_whileNotOrbiting",
        facingNow,
      });
      hasManualCameraRef.current = false;
      manualOffsetRef.current = null;
      autoDirRef.current = desiredDir;
      transitionBlendRef.current = Math.max(transitionBlendRef.current, 0.32);
    }

    // Keep manual camera adjustment persistent while following the player.
    // Reset: explicit reset, turn/facing change, teleport/catapult framing, or a touch step to a new tile.

    // Auto-follow current player and orient behind movement direction unless user is actively rotating.
    if (!rotateMode && !dragRef.current && !orbitRingGesture) {
      const transitionBlend = transitionBlendRef.current;
      let posLerp = THREE.MathUtils.lerp(CAM_POS_LERP, 0.42, transitionBlend);
      let rotLerp = THREE.MathUtils.lerp(CAM_ROT_LERP, 0.34, transitionBlend);
      if (catapultMode) {
        posLerp = Math.max(posLerp, 0.46);
        rotLerp = Math.max(rotLerp, 0.44);
      }
      ctrl.target.lerp(desiredTarget, posLerp);
      // Keep a stable camera offset from the current target to prevent tilt drift.
      const desiredCameraPos = ctrl.target.clone().add(desiredOffset);
      camera.position.lerp(desiredCameraPos, rotLerp);
      transitionBlendRef.current = Math.max(0, transitionBlend * 0.9 - 0.012);
      ctrl.update();
    }

    /* Walk “forward” = into the view: camera→pawn on XZ, snapped to cardinals.
     * Any canvas orbit (left/right mouse or one-finger touch) should update grid facing so the 3D pawn matches
     * the view; also rotate mode, minimap ring, and post-wheel manual offset on touch. */
    const cameraDrivesFacingGrid =
      !!onTouchCameraForwardGridRef.current &&
      !lockCameraToAutoFraming &&
      (orbitRingGesture ||
        rotateMode ||
        (touchUi && (dragRef.current != null || hasManualCameraRef.current)) ||
        (!touchUi && dragRef.current != null));
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
    if (!lockCameraToAutoFraming && onIsoCameraBearingDegRef.current) {
      const toB = new THREE.Vector3().subVectors(ctrl.target, camera.position);
      toB.y = 0;
      const hB = toB.length();
      if (hB > 1e-4) {
        toB.multiplyScalar(1 / hB);
        const bearingDeg = (Math.atan2(toB.z, toB.x) * 180) / Math.PI + 90;
        const prevB = lastEmittedBearingDegRef.current;
        // Emit whenever bearing changes (no degree-step gate): threshold caused visible 90°-ish minimap jumps
        // when parent fell back to cardinal `playerFacing` between sparse updates.
        const deltaB = prevB == null ? 999 : Math.abs(bearingDeg - prevB);
        const wrappedDelta = prevB == null ? 999 : Math.min(deltaB, 360 - deltaB);
        if (prevB == null || wrappedDelta > 1e-4) {
          lastEmittedBearingDegRef.current = bearingDeg;
          onIsoCameraBearingDegRef.current(bearingDeg);
          mapRotationLog(
            "bearingEmitted",
            { bearingDeg: Math.round(bearingDeg * 1000) / 1000, wrappedDelta },
            120,
          );
        }
      }
    }

    if (mapRotationDebugEnabled()) {
      let hBLen: number | null = null;
      let bearingDiag: string;
      if (lockCameraToAutoFraming) bearingDiag = "blocked_catapultLock";
      else if (!onIsoCameraBearingDegRef.current) {
        bearingDiag = "blocked_noParentCallback_isGridOrUnwired";
      } else {
        const toBD = new THREE.Vector3().subVectors(ctrl.target, camera.position);
        toBD.y = 0;
        hBLen = toBD.length();
        bearingDiag = hBLen <= 1e-4 ? "blocked_degenerateCameraRay" : "emitting_ok";
      }
      mapRotationLogSnapshot("cameraController", {
        rotateMode,
        dragActive: !!dragRef.current,
        mouseOrbitBtn: mouseOrbitButtonRef.current,
        touchUi,
        orbitRingPointerHeld: orbitRingPointerHeldRef.current,
        orbitRingRecently,
        orbitRingGesture,
        lockCameraToAutoFraming,
        hasManualCamera: hasManualCameraRef.current,
        autoFollowLerping: !rotateMode && !dragRef.current && !orbitRingGesture,
        cameraDrivesFacingGrid,
        bearingDiag,
        hB_len: hBLen,
      });
    }

  });

  return (
    <OrbitControls
      ref={controlsRef}
      target={[playerX * CS, catapultMode ? CATAPULT_LOOK_AT_Y : CAM_LOOK_AT_Y, playerY * CS]}
      enableDamping={false}
      enableRotate={false}
      enablePan={false}
      enableZoom={true}
      minDistance={2.2}
      maxDistance={180}
      zoomSpeed={1.6}
      mouseButtons={{ LEFT: undefined as unknown as THREE.MOUSE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: undefined as unknown as THREE.MOUSE }}
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

/** Launch cell: floor rings only (no extra world-space “trajectory” geometry). */
function SlingshotSourceHint({ cellX, cellY }: { cellX: number; cellY: number }) {
  const ringRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const m = ringRef.current;
    if (!m) return;
    m.scale.setScalar(1 + Math.sin(clock.getElapsedTime() * 2.6) * 0.06);
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
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={909}>
        <ringGeometry args={[0.55, 0.78, 32]} />
        <meshBasicMaterial
          color="#ffaa22"
          depthTest={false}
          depthWrite={false}
          transparent
          opacity={0.35}
        />
      </mesh>
    </group>
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
const MONSTER_GLB_SLUG: Record<MonsterType, string> = {
  V: "dracula",
  Z: "zombie",
  S: "spider",
  G: "ghost",
  K: "skeleton",
  L: "lava",
};

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
  x, y, playerX, playerY, draculaState, combatPulse = 0,
}: {
  x: number;
  y: number;
  playerX: number;
  playerY: number;
  draculaState?: DraculaState;
  combatPulse?: number;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const [visualState, setVisualState] = useState<"idle" | "hunt" | "attack">("idle");
  const visualStateRef = useRef<"idle" | "hunt" | "attack">("idle");
  const prevStateRef = useRef<DraculaState | undefined>(draculaState);
  const attackUntilRef = useRef(0);
  const attackStartRef = useRef(0);
  const [actionVersion, setActionVersion] = useState(0);
  const queuedCombatPulseRef = useRef(false);
  const prevCombatPulseRef = useRef(combatPulse);
  const smoothPosRef = useRef(new THREE.Vector3(x * CS, 0.02, y * CS));
  const targetPosRef = useRef(new THREE.Vector3(x * CS, 0.02, y * CS));
  const seed = useMemo(() => ((x * 73856093) ^ (y * 19349663)) & 1023, [x, y]);

  useEffect(() => {
    targetPosRef.current.set(x * CS, 0.02, y * CS);
  }, [x, y]);
  useEffect(() => {
    if (combatPulse <= 0) return;
    if (combatPulse === prevCombatPulseRef.current) return;
    prevCombatPulseRef.current = combatPulse;
    queuedCombatPulseRef.current = true;
  }, [combatPulse]);

  useFrame(({ clock }) => {
    const g = groupRef.current;
    if (!g) return;
    const t = clock.getElapsedTime();
    if (queuedCombatPulseRef.current) {
      queuedCombatPulseRef.current = false;
      attackStartRef.current = t;
      attackUntilRef.current = Math.max(attackUntilRef.current, t + 0.62);
      setActionVersion((v) => v + 1);
    }
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

function MonsterModel3DInMaze({
  type,
  visualState,
  actionVersion = 0,
}: {
  type: MonsterType;
  visualState: "idle" | "hunt" | "attack";
  actionVersion?: number;
}) {
  const rootRef = useRef<THREE.Group>(null);
  const glbPath = useMemo(() => getMonsterGltfPathForReference(type), [type]);
  const { scene, animations } = useGLTF(glbPath);
  const clonedScene = useMemo(() => SkeletonUtils.clone(scene), [scene]);
  const { actions, names } = useAnimations(animations, rootRef);

  useEffect(() => {
    clonedScene.traverse((obj) => {
      if (obj instanceof THREE.Light) {
        obj.visible = false;
        return;
      }
      if (obj instanceof THREE.Mesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          if (m instanceof THREE.MeshStandardMaterial || m instanceof THREE.MeshPhysicalMaterial) {
            m.roughness = Math.max(0.6, m.roughness ?? 0.75);
            m.metalness = Math.min(0.25, m.metalness ?? 0.12);
            m.envMapIntensity = 0.45;
            m.emissiveIntensity = Math.min(0.1, m.emissiveIntensity ?? 0);
            m.needsUpdate = true;
          } else if (m instanceof THREE.MeshBasicMaterial) {
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
  }, [clonedScene]);

  useEffect(() => {
    const clip = resolveMonsterAnimationClipName(visualState, names, {
      monsterType: type,
      glbSlug: MONSTER_GLB_SLUG[type],
    });
    for (const action of Object.values(actions)) {
      action?.fadeOut(0.12);
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
      action.fadeIn(0.15).play();
    }
    return () => { action.fadeOut(0.12); };
  }, [actions, names, type, visualState, actionVersion]);

  const scale =
    type === "S" ? 0.78
      : type === "G" ? 0.9
        : type === "L" ? 0.88
          : 0.82;

  return (
    <group ref={rootRef} scale={scale}>
      <primitive object={clonedScene} />
    </group>
  );
}

/** Cap iso maze monster foot lift so unstable skinned bounds cannot spike the rig above the cell. */
const MAZE_MONSTER_GROUND_LIFT_MAX = 0.5;
const MAZE_MONSTER_BBOX_HEIGHT_MIN = 0.015;
const MAZE_MONSTER_BBOX_HEIGHT_MAX = 28;

function MonsterInMaze({
  x, y, playerX, playerY, type, combatPulse = 0,
}: {
  x: number;
  y: number;
  playerX: number;
  playerY: number;
  type: MonsterType;
  combatPulse?: number;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const modelRef = useRef<THREE.Group>(null);
  const [visualState, setVisualState] = useState<"idle" | "hunt" | "attack">("idle");
  const visualStateRef = useRef<"idle" | "hunt" | "attack">("idle");
  const [actionVersion, setActionVersion] = useState(0);
  const smoothPosRef = useRef(new THREE.Vector3(x * CS, 0.02, y * CS));
  const targetPosRef = useRef(new THREE.Vector3(x * CS, 0.02, y * CS));
  const nearPlayerRef = useRef(false);
  const attackUntilRef = useRef(0);
  const queuedCombatPulseRef = useRef(false);
  const prevCombatPulseRef = useRef(combatPulse);
  const groundLiftRef = useRef(0);
  const groundBox = useMemo(() => new THREE.Box3(), []);
  const seed = useMemo(() => ((x * 83492791) ^ (y * 29765743)) & 1023, [x, y]);

  useEffect(() => {
    targetPosRef.current.set(x * CS, 0.02, y * CS);
  }, [x, y]);
  useEffect(() => {
    if (combatPulse <= 0) return;
    if (combatPulse === prevCombatPulseRef.current) return;
    prevCombatPulseRef.current = combatPulse;
    queuedCombatPulseRef.current = true;
  }, [combatPulse]);

  useFrame(({ clock }) => {
    const g = groupRef.current;
    if (!g) return;
    const t = clock.getElapsedTime();
    if (queuedCombatPulseRef.current) {
      queuedCombatPulseRef.current = false;
      attackUntilRef.current = Math.max(attackUntilRef.current, t + 0.52);
      setActionVersion((v) => v + 1);
    }
    const wx = smoothPosRef.current.x / CS;
    const wy = smoothPosRef.current.z / CS;
    const dx = playerX - wx;
    const dy = playerY - wy;
    const dist = Math.hypot(dx, dy);
    const nearPlayer = dist <= 1.2;
    if (nearPlayer && !nearPlayerRef.current) {
      nearPlayerRef.current = true;
      attackUntilRef.current = t + 0.52;
      setActionVersion((v) => v + 1);
    } else if (!nearPlayer) {
      nearPlayerRef.current = false;
    }
    const transitDist = smoothPosRef.current.distanceTo(targetPosRef.current);
    /**
     * Non-ghost: `hunt` = walk/run clip while lerping toward a new grid cell.
     * Ghost (`G`): never use `hunt` for animation — smooth drift + bob already sells motion; the prior
     * `transitDist > 0.05` gate stayed true almost always (lerp tail + target updates), so Walking loop
     * never dropped to idle.
     */
    const movingAcrossTiles = type !== "G" && transitDist > 0.05;
    const reacting = t < attackUntilRef.current;
    const next: "idle" | "hunt" | "attack" = reacting ? "attack" : (movingAcrossTiles ? "hunt" : "idle");
    if (next !== visualStateRef.current) {
      visualStateRef.current = next;
      setVisualState(next);
    }

    const moveLerp = next === "hunt" || next === "attack" ? 0.1 : 0.06;
    smoothPosRef.current.lerp(targetPosRef.current, moveLerp);
    const isGhost = type === "G";
    const bob = isGhost
      ? Math.sin(t * 1.9 + seed) * 0.08
      : Math.max(0, Math.sin(t * 1.9 + seed)) * 0.012;
    const baseY = isGhost ? 0.25 : 0.06;
    g.position.set(
      smoothPosRef.current.x,
      baseY + bob,
      smoothPosRef.current.z
    );
    const model = modelRef.current;
    if (model) {
      if (!isGhost) {
        groundBox.setFromObject(model);
        const bboxH = groundBox.max.y - groundBox.min.y;
        const bboxOk =
          Number.isFinite(groundBox.min.y) &&
          Number.isFinite(groundBox.max.y) &&
          bboxH >= MAZE_MONSTER_BBOX_HEIGHT_MIN &&
          bboxH <= MAZE_MONSTER_BBOX_HEIGHT_MAX;
        if (!bboxOk) {
          groundLiftRef.current = Math.min(
            MAZE_MONSTER_GROUND_LIFT_MAX,
            groundLiftRef.current * 0.88
          );
        } else {
          const desiredMinY = FLOOR_Y + 0.015;
          const neededLift = Math.max(0, desiredMinY - groundBox.min.y);
          // Keep feet above floor even if animation clips dip root/bones down.
          groundLiftRef.current = Math.min(
            MAZE_MONSTER_GROUND_LIFT_MAX,
            Math.max(groundLiftRef.current * 0.9, neededLift)
          );
        }
        model.position.y = groundLiftRef.current;
      } else {
        groundLiftRef.current = 0;
        model.position.y = 0;
      }
    }
    const yaw = Math.atan2(dx, dy);
    g.rotation.y = THREE.MathUtils.lerp(g.rotation.y, yaw, 0.08);
  });

  return (
    <group ref={groupRef}>
      <group ref={modelRef}>
        <Suspense fallback={<MonsterBillboard x={x} y={y} type={type} />}>
          <MonsterModel3DInMaze type={type} visualState={visualState} actionVersion={actionVersion} />
        </Suspense>
      </group>
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
  combatMonster,
  combatPulseVersion = 0,
}: {
  monsters: MiniMonster[];
  playerX: number;
  playerY: number;
  combatMonster?: { x: number; y: number; type?: string } | null;
  combatPulseVersion?: number;
}) {
  return (
    <>
      {monsters.map((m, i) => {
        const isCombatTarget =
          !!combatMonster &&
          m.x === combatMonster.x &&
          m.y === combatMonster.y &&
          (combatMonster.type == null || m.type == null || combatMonster.type === m.type);
        return (
        (m.type as MonsterType | undefined) === "V"
          ? (
            <DraculaInMaze
              key={`m3d-dracula-${i}`}
              x={m.x}
              y={m.y}
              playerX={playerX}
              playerY={playerY}
              draculaState={m.draculaState}
              combatPulse={isCombatTarget ? combatPulseVersion : 0}
            />
          )
          : (
            <MonsterInMaze
              key={`m3d-${i}-${m.type ?? "Z"}`}
              x={m.x}
              y={m.y}
              playerX={playerX}
              playerY={playerY}
              type={(m.type as MonsterType | undefined) ?? "Z"}
              combatPulse={isCombatTarget ? combatPulseVersion : 0}
            />
          )
      )})}
    </>
  );
}

function MazeScene({
  grid, mapWidth, mapHeight, playerX, playerY, facingDx, facingDy,
  zoom, rotateMode, onCellClick, resetTick, teleportOptions, teleportMode, catapultMode,
  catapultFrom, catapultAimClient, catapultTrajectoryPreview, catapultLockCameraForPull,
  magicPortalPreviewOptions, teleportSourceType,
  focusVersion, miniMonsters, fogIntensityMap, combatPulseVersion, combatMonster,
  touchUi = false,
  onTouchCameraForwardGrid,
  onIsoCameraBearingDeg,
  isoBearingSyncKey = 0,
  orbitLookApplierRef,
  orbitRingPointerHeldRef,
  playerGlbPath,
  playerWeaponGltfPath,
  isoCombatPlayerCue,
  playerJumpPulseVersion = 0,
  spiderWebCells = [],
  artifactPickups,
}: Omit<Props, "visible"> & {
  rotateMode: boolean;
  resetTick: number;
  teleportOptions?: [number, number][];
  teleportMode?: boolean;
  catapultMode?: boolean;
  catapultFrom?: [number, number] | null;
  catapultAimClient?: { x: number; y: number } | null;
  catapultTrajectoryPreview?: CatapultTrajectoryPreviewFn;
  catapultLockCameraForPull?: boolean;
  magicPortalPreviewOptions?: [number, number][] | null;
  teleportSourceType?: "magic" | "gem" | "artifact" | null;
  combatPulseVersion?: number;
  combatMonster?: { x: number; y: number; type?: string } | null;
  onTouchCameraForwardGrid?: (dx: number, dy: number) => void;
  orbitLookApplierRef: MutableRefObject<((dxPx: number, dyPx: number) => void) | null>;
  orbitRingPointerHeldRef: MutableRefObject<boolean>;
}) {
  const shadowRange = Math.max(mapWidth, mapHeight) * CS;
  return (
    <>
      <MazeAtmosphericFog />
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
      <CorridorFogVolumes grid={grid} mapWidth={mapWidth} mapHeight={mapHeight} fogIntensityMap={fogIntensityMap} />
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
      <Suspense fallback={null}>
        <MazeArtifactPickups pickups={artifactPickups ?? []} />
      </Suspense>
      <WallBlocks grid={grid} mapWidth={mapWidth} mapHeight={mapHeight} />
      <SpiderWebDecor
        grid={grid}
        mapWidth={mapWidth}
        mapHeight={mapHeight}
        fogIntensityMap={fogIntensityMap}
        spiderWebCells={spiderWebCells}
      />
      {miniMonsters && miniMonsters.length > 0 && (
        <Monsters3D
          monsters={miniMonsters}
          playerX={playerX}
          playerY={playerY}
          combatMonster={combatMonster}
          combatPulseVersion={combatPulseVersion}
        />
      )}
      <PlayerMarker
        playerX={playerX}
        playerY={playerY}
        facingDx={facingDx}
        facingDy={facingDy}
        combatPulse={combatPulseVersion}
        playerGlbPath={playerGlbPath}
        playerWeaponGltfPath={playerWeaponGltfPath}
        isoCombatPlayerCue={isoCombatPlayerCue}
        playerJumpPulseVersion={playerJumpPulseVersion}
      />
      {magicPortalPreviewOptions &&
        magicPortalPreviewOptions.length > 0 &&
        !teleportMode && (
          <TeleportTargetMarkers options={magicPortalPreviewOptions} accent="magic" previewOnly />
        )}
      {catapultFrom && <SlingshotSourceHint cellX={catapultFrom[0]} cellY={catapultFrom[1]} />}
      {catapultFrom && catapultTrajectoryPreview && (
        <SlingshotTrajectoryArc
          from={catapultFrom}
          aimClient={catapultAimClient ?? null}
          previewFn={catapultTrajectoryPreview}
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
        catapultLockCameraForPull={catapultLockCameraForPull ?? true}
        focusVersion={focusVersion}
        touchUi={touchUi}
        onTouchCameraForwardGrid={onTouchCameraForwardGrid}
        onIsoCameraBearingDeg={onIsoCameraBearingDeg}
        isoBearingSyncKey={isoBearingSyncKey}
        orbitLookApplierRef={orbitLookApplierRef}
        orbitRingPointerHeldRef={orbitRingPointerHeldRef}
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
  const minimapGlowFilterId = useId().replace(/:/g, "");
  const inDock = mode === "dock";
  /** Extra scale on top of base cell size (scroll wheel adjusts; passive:false listener). */
  const [stripScrollZoom, setStripScrollZoom] = useState(1.22);
  const miniMapStripWheelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = miniMapStripWheelRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const dir = -Math.sign(e.deltaY);
      if (dir === 0) return;
      setStripScrollZoom((z) => Math.max(0.88, Math.min(1.72, z + dir * 0.1)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const miniCellRaw = Math.max(4, Math.min(15, Math.floor(320 / Math.max(mapWidth, mapHeight))));
  const miniCell = Math.max(4, Math.min(22, Math.round(miniCellRaw * stripScrollZoom)));
  const miniWidth = mapWidth * miniCell;
  const miniHeight = mapHeight * miniCell;

  const dirLen = Math.hypot(facingDx, facingDy) || 1;
  const arrowLen = Math.max(8, miniCell * 2.55);
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
      title={
        inDock && onExpandToGrid
          ? "Switch to full 2D grid map — scroll wheel on the map to zoom"
          : "Scroll wheel on the mini map to zoom"
      }
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
        ref={miniMapStripWheelRef}
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
            const dot = Math.max(5, miniCell * 0.82);
            const inset = Math.max(0, (miniCell - dot) / 2);
            return (
              <div
                key={`player-${i}-${p.x}-${p.y}`}
                style={{
                  position: "absolute",
                  left: p.x * miniCell + inset,
                  top: p.y * miniCell + inset,
                  width: dot,
                  height: dot,
                  borderRadius: "50%",
                  background: p.isCurrent ? "#00ff88" : "#55b8ff",
                  border: p.isCurrent ? "2px solid #05331f" : "1px solid #0c2234",
                  boxShadow: p.isCurrent
                    ? "0 0 10px rgba(0,255,136,0.9), 0 0 2px rgba(0,0,0,0.5)"
                    : "0 0 6px rgba(85,184,255,0.65)",
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
            <defs>
              <filter id={minimapGlowFilterId} x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation={Math.max(1.2, miniCell * 0.12)} result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <line
              x1={playerCenterX}
              y1={playerCenterY}
              x2={arrowEndX}
              y2={arrowEndY}
              stroke="#d4fff0"
              strokeWidth={Math.max(2.8, miniCell * 0.52)}
              strokeLinecap="round"
              filter={`url(#${minimapGlowFilterId})`}
              opacity={0.98}
            />
            <circle
              cx={playerCenterX}
              cy={playerCenterY}
              r={Math.max(4.2, miniCell * 0.98)}
              fill="#00ff88"
              stroke="#0a3d28"
              strokeWidth={Math.max(2, miniCell * 0.16)}
              filter={`url(#${minimapGlowFilterId})`}
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
    catapultFrom = null,
    catapultAimClient = null,
    catapultTrajectoryPreview,
    catapultLockCameraForPull = true,
    magicPortalPreviewOptions = null,
    teleportSourceType = null,
    focusVersion,
    miniMonsters,
    fogIntensityMap,
    combatActive = false,
    combatRolling = false,
    combatRollFace = null,
    combatPulseVersion = 0,
    combatMonster = null,
    onCombatRollRequest,
    onCombatRun,
    onCombatShieldToggle,
    combatShieldOn = false,
    combatShieldAvailable = false,
    combatRunDisabled = false,
    playerGlbPath,
    playerWeaponGltfPath = null,
    artifactPickups,
    isoCombatPlayerCue = null,
    playerJumpPulseVersion = 0,
    spiderWebCells = [],
    teleportPickTimerOverlay = null,
    fillViewport = false,
  touchUi = false,
  onRotateModeChange,
  onTouchCameraForwardGrid,
  onIsoCameraBearingDeg,
  isoBearingSyncKey = 0,
}: Props,
  ref: Ref<MazeIsoViewImperativeHandle>,
) {
  const canvasCameraRef = useRef<THREE.Camera | null>(null);
  const canvasGlDomRef = useRef<HTMLCanvasElement | null>(null);
  const [btnRotate, setBtnRotate] = useState(false);
  const [ctrlHeld, setCtrlHeld] = useState(false);
  const [resetTick, setResetTick] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const btnRotateRef = useRef(false);
  btnRotateRef.current = btnRotate;
  const rotateMode = btnRotate || ctrlHeld;
  const orbitLookApplierRef = useRef<((dxPx: number, dyPx: number) => void) | null>(null);
  const orbitRingPointerHeldRef = useRef(false);

  const resetCameraView = useCallback(() => {
    setBtnRotate(false);
    setResetTick((t) => t + 1);
  }, []);

  /** Auto-exit rotate mode after inactivity — disabled while the minimap orbit ring is held so long drags never cut out. */
  const scheduleRotateSessionEnd = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (orbitRingPointerHeldRef.current) {
      timerRef.current = null;
      mapRotationLog("rotateSessionTimer", { action: "cleared_ringHeld_noExpiryWhileDragging" }, 800);
      return;
    }
    timerRef.current = setTimeout(() => setBtnRotate(false), ROTATE_TIMEOUT_MS);
    mapRotationLog("rotateSessionTimer", { action: "scheduled", ms: ROTATE_TIMEOUT_MS }, 500);
  }, []);

  const activateRotate = useCallback(() => {
    const enable = () => {
      setBtnRotate(true);
      mapRotationLog("activateRotate", { touchUi, ringHeld: orbitRingPointerHeldRef.current }, 400);
      scheduleRotateSessionEnd();
    };
    btnRotateRef.current = true;
    /**
     * Gyro + permission prompt only in explicit touch-first mode (`touchUi`).
     * Otherwise minimap / canvas orbit matches desktop (no deviceorientation fighting finger drags on iOS).
     */
    if (typeof window !== "undefined" && touchUi) {
      const DO = DeviceOrientationEvent as typeof DeviceOrientationEvent & {
        requestPermission?: () => Promise<"granted" | "denied">;
      };
      if (typeof DO.requestPermission === "function") {
        void DO.requestPermission().then(enable).catch(enable);
        return;
      }
    }
    enable();
  }, [touchUi, scheduleRotateSessionEnd]);

  const bumpRotateSession = useCallback(() => {
    if (!btnRotateRef.current) return;
    scheduleRotateSessionEnd();
  }, [scheduleRotateSessionEnd]);

  useImperativeHandle(
    ref,
    () => ({
      activateRotate,
      bumpRotateSession,
      resetCameraView,
      setOrbitRingPointerHeld: (held: boolean) => {
        mapRotationLog("orbitRingPointerHeld", { held });
        orbitRingPointerHeldRef.current = held;
        if (held) {
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = null;
        } else if (btnRotateRef.current) {
          scheduleRotateSessionEnd();
        }
      },
      orbitLookByPixelDelta: (dxPx: number, dyPx: number) => {
        orbitLookApplierRef.current?.(dxPx, dyPx);
      },
      resolveCatapultLaunchAtClient: (from, clientX, clientY) => {
        const cam = canvasCameraRef.current;
        const el = canvasGlDomRef.current;
        if (!cam || !el) return null;
        return computeSlingLaunchScreenPull(from, clientX, clientY, cam as THREE.PerspectiveCamera, el);
      },
    }),
    [activateRotate, bumpRotateSession, resetCameraView, scheduleRotateSessionEnd],
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
        margin: 0,
        alignSelf: "stretch",
        boxSizing: "border-box",
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
      <Canvas
        shadows
        camera={{ position: [camDist, CAM_HEIGHT, camDist], fov: THREE.MathUtils.clamp(92 - zoom * 16, 58, 95), near: 0.1, far: 800 }}
        style={
          fillViewport
            ? {
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                display: "block",
                touchAction: "auto",
              }
            : {
                width: "100%",
                flex: 1,
                minHeight: 0,
                alignSelf: "stretch",
                touchAction: "auto" as const,
              }
        }
        gl={{ antialias: true, alpha: false }}
        dpr={[1, 1.4]}
        onCreated={({ gl }) => { gl.setClearColor("#06060a"); }}
        onPointerDown={(e) => {
          if (!combatActive || !onCombatRollRequest) return;
          if ((e.nativeEvent as PointerEvent).button !== 0) return;
          onCombatRollRequest();
        }}
      >
        <CanvasContextBridge cameraRef={canvasCameraRef} glDomRef={canvasGlDomRef} />
        <WebGlContextLossGuard />
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
          catapultFrom={catapultFrom}
          catapultAimClient={catapultAimClient}
          catapultTrajectoryPreview={catapultTrajectoryPreview}
          catapultLockCameraForPull={catapultLockCameraForPull}
          magicPortalPreviewOptions={magicPortalPreviewOptions}
          teleportSourceType={teleportSourceType}
          focusVersion={focusVersion}
          miniMonsters={miniMonsters}
          fogIntensityMap={fogIntensityMap}
          combatPulseVersion={combatPulseVersion}
          combatMonster={combatMonster}
          touchUi={touchUi}
          onTouchCameraForwardGrid={onTouchCameraForwardGrid}
          onIsoCameraBearingDeg={onIsoCameraBearingDeg}
          isoBearingSyncKey={isoBearingSyncKey}
          orbitLookApplierRef={orbitLookApplierRef}
          orbitRingPointerHeldRef={orbitRingPointerHeldRef}
          playerGlbPath={playerGlbPath}
          playerWeaponGltfPath={playerWeaponGltfPath}
          artifactPickups={artifactPickups}
          isoCombatPlayerCue={isoCombatPlayerCue}
          playerJumpPulseVersion={playerJumpPulseVersion}
          spiderWebCells={spiderWebCells}
        />
      </Canvas>
      {teleportMode && teleportPickTimerOverlay ? (
        <div
          style={{
            position: "absolute",
            left: "50%",
            transform: "translateX(-50%)",
            top: "max(10px, env(safe-area-inset-top, 0px))",
            zIndex: 24,
            pointerEvents: "none",
            maxWidth: "min(92%, 380px)",
          }}
        >
          <div style={{ pointerEvents: "auto", display: "flex", justifyContent: "center" }}>
            {teleportPickTimerOverlay}
          </div>
        </div>
      ) : null}
      {combatActive && (
        <>
          {/* Top-center combat hint */}
          <div
            style={{
              position: "absolute",
              top: "max(12px, env(safe-area-inset-top, 0px))",
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 20,
              pointerEvents: "none",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 4,
              background: "rgba(6,8,14,0.82)",
              border: "1px solid rgba(143,216,255,0.5)",
              borderRadius: 12,
              padding: "8px 16px",
              boxShadow: "0 8px 28px rgba(0,0,0,0.5)",
            }}
          >
            <div style={{ fontSize: "0.82rem", color: "#bde9ff", fontWeight: 700 }}>
              {combatRolling ? "Rolling..." : "Tap to roll strike"}
            </div>
            {combatRollFace != null && (
              <div style={{ fontSize: "0.9rem", color: "#ffdca8" }}>
                d6 result: <strong>{combatRollFace}</strong>
              </div>
            )}
          </div>
          {/* Left-side combat action buttons */}
          <div
            style={{
              position: "absolute",
              left: "max(12px, env(safe-area-inset-left, 0px))",
              top: "50%",
              transform: "translateY(-50%)",
              zIndex: 20,
              display: "flex",
              flexDirection: "column",
              gap: 10,
              pointerEvents: "auto",
            }}
          >
            <button
              type="button"
              onClick={onCombatRollRequest}
              disabled={combatRolling}
              style={{
                width: 56,
                height: 56,
                borderRadius: 14,
                border: "2px solid rgba(143,216,255,0.6)",
                background: combatRolling ? "rgba(30,40,55,0.7)" : "rgba(14,28,48,0.88)",
                color: combatRolling ? "#6a8aa4" : "#bde9ff",
                fontSize: "1.4rem",
                fontWeight: 900,
                cursor: combatRolling ? "default" : "pointer",
                boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: combatRolling ? 0.5 : 1,
                transition: "opacity 0.15s, background 0.15s",
              }}
              title="Roll strike"
            >
              🎲
            </button>
            {combatShieldAvailable && (
              <button
                type="button"
                onClick={onCombatShieldToggle}
                disabled={combatRolling}
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 14,
                  border: combatShieldOn
                    ? "2px solid rgba(0,255,136,0.7)"
                    : "2px solid rgba(140,140,160,0.45)",
                  background: combatShieldOn
                    ? "rgba(0,60,30,0.85)"
                    : "rgba(30,30,40,0.8)",
                  color: combatShieldOn ? "#66ffaa" : "#999",
                  fontSize: "1.4rem",
                  fontWeight: 900,
                  cursor: combatRolling ? "default" : "pointer",
                  boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: combatRolling ? 0.5 : 1,
                  transition: "opacity 0.15s, background 0.15s, border 0.15s",
                }}
                title={combatShieldOn ? "Shield ON — absorbs next hit" : "Shield OFF"}
              >
                🛡
              </button>
            )}
            <button
              type="button"
              onClick={onCombatRun}
              disabled={combatRolling || combatRunDisabled}
              style={{
                width: 56,
                height: 56,
                borderRadius: 14,
                border: "2px solid rgba(200,140,130,0.5)",
                background: "rgba(48,24,24,0.85)",
                color: combatRunDisabled ? "#664444" : "#f0bbaa",
                fontSize: "1.4rem",
                fontWeight: 900,
                cursor: combatRolling || combatRunDisabled ? "default" : "pointer",
                boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: combatRolling || combatRunDisabled ? 0.4 : 1,
                transition: "opacity 0.15s, background 0.15s",
              }}
              title="Run from combat"
            >
              🏃
            </button>
          </div>
        </>
      )}
    </div>
  );
});

MazeIsoView.displayName = "MazeIsoView";

export default MazeIsoView;
