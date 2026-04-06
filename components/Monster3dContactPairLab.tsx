"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { MonsterType } from "@/lib/labyrinth";
import { getMonsterName } from "@/lib/labyrinth";
import type { StrikeTarget } from "@/lib/combatSystem";
import { CombatScene3D, combatFaceOffPositions } from "@/components/MonsterModel3D";
import { COMBAT_FACEOFF_APPROACH_DURATION_MS, resolveCombat3dClipLeads } from "@/lib/combat3dContact";
import {
  draculaAttackVariantFromStrikeTarget,
  getMonsterGltfPathForReference,
  isMergedMeshyStrikePortraitType,
  MONSTER_3D_VISUAL_STATES,
  playerHurtVariantFromStrikeTarget,
  PLAYER_3D_GLB,
  type Monster3DSpriteState,
} from "@/lib/monsterModels3d";
import {
  DEFAULT_LAB_PLAYER_WEAPON_GLB,
  PLAYER_OFFHAND_ARMOUR_GLB_OPTIONS,
  PLAYER_WEAPON_GLB_OPTIONS,
} from "@/lib/playerArmourGlbs";
import {
  resolveWeaponAttachPose,
  WEAPON_ATTACH_BLADE_TWIST_RAD,
  WEAPON_ATTACH_EXTRA_EULER_RAD,
  WEAPON_ATTACH_GRIP_POSITION_LOCAL,
  WEAPON_ATTACH_HAND,
  type WeaponAttachHand,
} from "@/lib/weaponAttachConfig";
import { combatFaceoff3dCanvasSizeDesktopPx } from "@/lib/combat3dFaceoffViewport";

async function glbReachable(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: "HEAD", cache: "no-store" });
    if (r.ok) return true;
    if (r.status === 405 || r.status === 404) {
      const g = await fetch(url, { method: "GET", cache: "no-store" });
      return g.ok;
    }
    return false;
  } catch {
    return false;
  }
}

const VARIANTS = ["spell", "skill", "light"] as const;

const LAB_MONSTER_TYPES: MonsterType[] = ["V", "K", "Z", "S", "L", "G", "O"];

type Preset = {
  label: string;
  player: Monster3DSpriteState;
  monster: Monster3DSpriteState;
  pVar: (typeof VARIANTS)[number];
  mVar: (typeof VARIANTS)[number];
};

/**
 * Presets match **one roll’s net outcome** in the real combat modal: either the player dealt more damage to the
 * monster (player `attack` vs monster `hurt` / `knockdown`) or the monster dealt more to the player (`attack` vs
 * `hurt` / `knockdown`). The game does not show both fighters in full attack clips at once for that beat.
 */
/** After a player-win strike, merged Dracula/skeleton hurt clips use HP/max — 7/9 is the doc “light flinch” band. */
const LAB_PLAYER_WIN_MONSTER_HURT_HP = 7;
const LAB_PLAYER_WIN_MONSTER_HURT_MAX = 9;

const STRIKE_PRESETS: Preset[] = [
  { label: "Player net win · P spell strike / M hurt", player: "attack", monster: "hurt", pVar: "spell", mVar: "spell" },
  { label: "Player net win · P skill strike / M hurt", player: "attack", monster: "hurt", pVar: "skill", mVar: "skill" },
  { label: "Player net win · P light strike / M hurt", player: "attack", monster: "hurt", pVar: "light", mVar: "light" },
  { label: "Player net win · P spell strike / M knockdown", player: "attack", monster: "knockdown", pVar: "spell", mVar: "spell" },
  { label: "Player net win · P skill strike / M knockdown", player: "attack", monster: "knockdown", pVar: "skill", mVar: "skill" },
  { label: "Monster net win · M spell strike / P hurt", player: "hurt", monster: "attack", pVar: "spell", mVar: "spell" },
  { label: "Monster net win · M skill strike / P hurt", player: "hurt", monster: "attack", pVar: "skill", mVar: "skill" },
  { label: "Monster net win · M light strike / P hurt", player: "hurt", monster: "attack", pVar: "light", mVar: "light" },
  { label: "Monster net win · M light strike / P knockdown", player: "knockdown", monster: "attack", pVar: "light", mVar: "light" },
  { label: "Between rolls · both idle", player: "idle", monster: "idle", pVar: "light", mVar: "light" },
];

function labIsContactExchange(p: Monster3DSpriteState, m: Monster3DSpriteState): boolean {
  return (
    (p === "attack" || p === "angry" || p === "hurt" || p === "knockdown") &&
    (m === "attack" || m === "hurt" || m === "knockdown" || m === "angry")
  );
}

type LabSeqPhase = "off" | "idle" | "hunt";
type DraculaMonsterAttackAimSource = "preset" | StrikeTarget;
type PlayerHurtClipSource = "preset" | StrikeTarget;

type LabBladeTwistPreset = "0" | "90" | "180" | "270";

function labBladeTwistRadFromPreset(p: LabBladeTwistPreset): number {
  switch (p) {
    case "0":
      return 0;
    case "90":
      return Math.PI / 2;
    case "180":
      return Math.PI;
    case "270":
      return (3 * Math.PI) / 2;
  }
}

function labBladeTwistPresetFromConfigRad(rad: number): LabBladeTwistPreset {
  const presets: LabBladeTwistPreset[] = ["0", "90", "180", "270"];
  let best: LabBladeTwistPreset = "180";
  let bestD = Infinity;
  for (const p of presets) {
    const d = Math.abs(rad - labBladeTwistRadFromPreset(p));
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/** Grip / twist / Euler for the lab UI — from `weaponAttachConfig` saved map + globals. */
function savedWeaponLabAttachState(weaponPath: string | null): {
  hand: WeaponAttachHand;
  bladePreset: LabBladeTwistPreset;
  eulerDeg: [number, number, number];
  grip: [number, number, number];
} {
  if (!weaponPath) {
    return {
      hand: WEAPON_ATTACH_HAND,
      bladePreset: labBladeTwistPresetFromConfigRad(WEAPON_ATTACH_BLADE_TWIST_RAD),
      eulerDeg: [
        (WEAPON_ATTACH_EXTRA_EULER_RAD[0] * 180) / Math.PI,
        (WEAPON_ATTACH_EXTRA_EULER_RAD[1] * 180) / Math.PI,
        (WEAPON_ATTACH_EXTRA_EULER_RAD[2] * 180) / Math.PI,
      ],
      grip: [...WEAPON_ATTACH_GRIP_POSITION_LOCAL] as [number, number, number],
    };
  }
  const p = resolveWeaponAttachPose(weaponPath, {});
  return {
    hand: WEAPON_ATTACH_HAND,
    bladePreset: labBladeTwistPresetFromConfigRad(p.bladeTwistRad),
    eulerDeg: [
      (p.extraEulerRad[0] * 180) / Math.PI,
      (p.extraEulerRad[1] * 180) / Math.PI,
      (p.extraEulerRad[2] * 180) / Math.PI,
    ],
    grip: [p.gripPositionLocal[0], p.gripPositionLocal[1], p.gripPositionLocal[2]],
  };
}

/** Shield / off-hand pose from `weaponAttachConfig` (hand is always **left** for roster shields in 3D). */
function savedOffhandLabAttachState(shieldPath: string | null): {
  bladePreset: LabBladeTwistPreset;
  eulerDeg: [number, number, number];
  grip: [number, number, number];
} {
  if (!shieldPath) {
    return {
      bladePreset: labBladeTwistPresetFromConfigRad(WEAPON_ATTACH_BLADE_TWIST_RAD),
      eulerDeg: [
        (WEAPON_ATTACH_EXTRA_EULER_RAD[0] * 180) / Math.PI,
        (WEAPON_ATTACH_EXTRA_EULER_RAD[1] * 180) / Math.PI,
        (WEAPON_ATTACH_EXTRA_EULER_RAD[2] * 180) / Math.PI,
      ],
      grip: [...WEAPON_ATTACH_GRIP_POSITION_LOCAL] as [number, number, number],
    };
  }
  const p = resolveWeaponAttachPose(shieldPath, {});
  return {
    bladePreset: labBladeTwistPresetFromConfigRad(p.bladeTwistRad),
    eulerDeg: [
      (p.extraEulerRad[0] * 180) / Math.PI,
      (p.extraEulerRad[1] * 180) / Math.PI,
      (p.extraEulerRad[2] * 180) / Math.PI,
    ],
    grip: [p.gripPositionLocal[0], p.gripPositionLocal[1], p.gripPositionLocal[2]],
  };
}

const LAB_WEAPON_ATTACH_UI_DEFAULT = savedWeaponLabAttachState(DEFAULT_LAB_PLAYER_WEAPON_GLB);
const LAB_OFFHAND_ATTACH_UI_DEFAULT = savedOffhandLabAttachState(null);

const selectStyle: CSSProperties = {
  padding: "6px 8px",
  borderRadius: 8,
  background: "rgba(0,0,0,0.45)",
  border: "1px solid rgba(255,255,255,0.12)",
  color: "#e8e4ec",
  fontSize: "0.82rem",
};

const btnStyle: CSSProperties = {
  padding: "6px 10px",
  borderRadius: 8,
  border: "1px solid rgba(255,152,103,0.35)",
  background: "rgba(255,120,80,0.15)",
  color: "#ffcba4",
  fontSize: "0.72rem",
  cursor: "pointer",
  textAlign: "left" as const,
};

/** Full-width scenario triggers under the canvas (aligned to viewport width). */
const scenarioBtnStyle: CSSProperties = {
  ...btnStyle,
  width: "100%",
  padding: "10px 12px",
  fontSize: "0.8rem",
  borderRadius: 10,
  border: "1px solid rgba(255,152,103,0.42)",
  background: "rgba(255,120,80,0.2)",
};

export function Monster3dContactPairLab() {
  const [monsterType, setMonsterType] = useState<MonsterType>("V");
  const [playerState, setPlayerState] = useState<Monster3DSpriteState>("attack");
  const [monsterState, setMonsterState] = useState<Monster3DSpriteState>("hurt");
  const [playerVariant, setPlayerVariant] = useState<(typeof VARIANTS)[number]>("spell");
  const [monsterVariant, setMonsterVariant] = useState<(typeof VARIANTS)[number]>("spell");
  /** When on, matches combat strike-pick UI (crosshair, orbit off). Default off so the lab canvas can orbit + zoom. */
  const [strikePick, setStrikePick] = useState(false);
  /** Default 1 = same full approach as in-game merged 3D between rolls (`combat3dApproachBlend` when not rolling). */
  const [approach, setApproach] = useState(1);
  const [hurtHp, setHurtHp] = useState(LAB_PLAYER_WIN_MONSTER_HURT_HP);
  const [hurtMax, setHurtMax] = useState(9);
  const [fatalJump, setFatalJump] = useState(false);
  const [showMonsterHurtTier, setShowMonsterHurtTier] = useState(true);
  /** Dracula + hurt: preview aim-based reactions (head / body / legs) vs HP tiers. */
  const [draculaHurtAim, setDraculaHurtAim] = useState<"hp" | StrikeTarget>("hp");
  /** Bump to restart both GLB mixers from frame 0 with the same scenario (paired sync). */
  const [replayNonce, setReplayNonce] = useState(0);
  /** Idle → hunt → close in (approach 0→1) → strike, for connected face-off beats. */
  const [playConnectedSequence, setPlayConnectedSequence] = useState(true);
  const [seqPhase, setSeqPhase] = useState<LabSeqPhase>("off");
  const seqSessionRef = useRef(0);
  const pendingScenarioRef = useRef<Preset | null>(null);
  /** Dracula **attack** clips: use scenario tier, or map like combat strike aim (head = jump tier, …). */
  const [draculaMonsterAttackAim, setDraculaMonsterAttackAim] = useState<DraculaMonsterAttackAimSource>("preset");
  /** Player **hurt**: scenario spell/skill/light vs strike-aim → same tier as monster segment (head/body/legs). */
  const [playerHurtClipSource, setPlayerHurtClipSource] = useState<PlayerHurtClipSource>("preset");
  /** Same `armourGltfPath` as combat / maze — `BoneAttachedWeapon` on player rig. */
  const [labPlayerWeaponGlb, setLabPlayerWeaponGlb] = useState<string | null>(DEFAULT_LAB_PLAYER_WEAPON_GLB);
  const [labPlayerOffhandGlb, setLabPlayerOffhandGlb] = useState<string | null>(null);
  const [weaponFileOk, setWeaponFileOk] = useState<boolean | null>(null);
  const [offhandFileOk, setOffhandFileOk] = useState<boolean | null>(null);
  const [labWeaponHand, setLabWeaponHand] = useState<WeaponAttachHand>(LAB_WEAPON_ATTACH_UI_DEFAULT.hand);
  const [labBladeTwistPreset, setLabBladeTwistPreset] = useState<LabBladeTwistPreset>(
    LAB_WEAPON_ATTACH_UI_DEFAULT.bladePreset,
  );
  const labBladeTwistRad = labBladeTwistRadFromPreset(labBladeTwistPreset);
  const [labExtraEulerDeg, setLabExtraEulerDeg] = useState<[number, number, number]>(LAB_WEAPON_ATTACH_UI_DEFAULT.eulerDeg);
  /** Hand bone local (meters) — same as `WEAPON_ATTACH_GRIP_POSITION_LOCAL`; tune with both fighters idle. */
  const [labGripPosM, setLabGripPosM] = useState<[number, number, number]>(LAB_WEAPON_ATTACH_UI_DEFAULT.grip);

  const [labOffhandBladeTwistPreset, setLabOffhandBladeTwistPreset] = useState<LabBladeTwistPreset>(
    LAB_OFFHAND_ATTACH_UI_DEFAULT.bladePreset,
  );
  const labOffhandBladeTwistRad = labBladeTwistRadFromPreset(labOffhandBladeTwistPreset);
  const [labOffhandExtraEulerDeg, setLabOffhandExtraEulerDeg] = useState<[number, number, number]>(
    LAB_OFFHAND_ATTACH_UI_DEFAULT.eulerDeg,
  );
  const [labOffhandGripPosM, setLabOffhandGripPosM] = useState<[number, number, number]>(LAB_OFFHAND_ATTACH_UI_DEFAULT.grip);

  useEffect(() => {
    if (!labPlayerWeaponGlb) {
      setWeaponFileOk(null);
      return;
    }
    let cancelled = false;
    setWeaponFileOk(null);
    void (async () => {
      const ok = await glbReachable(labPlayerWeaponGlb);
      if (!cancelled) setWeaponFileOk(ok);
    })();
    return () => {
      cancelled = true;
    };
  }, [labPlayerWeaponGlb]);

  useEffect(() => {
    if (!labPlayerOffhandGlb) {
      setOffhandFileOk(null);
      return;
    }
    let cancelled = false;
    setOffhandFileOk(null);
    void (async () => {
      const ok = await glbReachable(labPlayerOffhandGlb);
      if (!cancelled) setOffhandFileOk(ok);
    })();
    return () => {
      cancelled = true;
    };
  }, [labPlayerOffhandGlb]);

  /** Dropdown weapon → saved pose in `weaponAttachConfig` (`WEAPON_ATTACH_POSE_BY_URL` + globals). */
  useEffect(() => {
    const s = savedWeaponLabAttachState(labPlayerWeaponGlb);
    setLabWeaponHand(s.hand);
    setLabBladeTwistPreset(s.bladePreset);
    setLabExtraEulerDeg(s.eulerDeg);
    setLabGripPosM(s.grip);
  }, [labPlayerWeaponGlb]);

  /** Dropdown shield → saved pose from `weaponAttachConfig` (left hand is fixed in `BoneAttachedWeapon`). */
  useEffect(() => {
    const s = savedOffhandLabAttachState(labPlayerOffhandGlb);
    setLabOffhandBladeTwistPreset(s.bladePreset);
    setLabOffhandExtraEulerDeg(s.eulerDeg);
    setLabOffhandGripPosM(s.grip);
  }, [labPlayerOffhandGlb]);

  const monsterPath = getMonsterGltfPathForReference(monsterType, "idle");

  const isContactExchange = labIsContactExchange(playerState, monsterState);

  const effectiveMonsterVariant = useMemo((): (typeof VARIANTS)[number] => {
    if (monsterType !== "V" || monsterState !== "attack") return monsterVariant;
    if (draculaMonsterAttackAim === "preset") return monsterVariant;
    return draculaAttackVariantFromStrikeTarget(draculaMonsterAttackAim);
  }, [monsterType, monsterState, monsterVariant, draculaMonsterAttackAim]);

  const effectivePlayerVariant = useMemo((): (typeof VARIANTS)[number] => {
    if (playerState === "hurt" && playerHurtClipSource !== "preset") {
      return playerHurtVariantFromStrikeTarget(playerHurtClipSource);
    }
    return playerVariant;
  }, [playerState, playerVariant, playerHurtClipSource]);

  const playerPath = PLAYER_3D_GLB;

  const spacing = useMemo(
    () =>
      combatFaceOffPositions({
        strikePickActive: strikePick,
        isContactExchange,
        rollingApproachBlend: approach,
        playerVisualState: playerState,
        monsterVisualState: monsterState,
        playerAttackVariant: effectivePlayerVariant,
        draculaAttackVariant: effectiveMonsterVariant,
        monsterType,
      }),
    [
      strikePick,
      isContactExchange,
      approach,
      playerState,
      monsterState,
      effectivePlayerVariant,
      effectiveMonsterVariant,
      monsterType,
    ]
  );

  const useStrikeContactSpacing =
    isContactExchange || playerState === "attack" || monsterState === "attack";

  const draculaHurtHp =
    monsterState === "hurt" && showMonsterHurtTier
      ? { hp: Math.max(0, hurtHp), maxHp: Math.max(1, hurtMax) }
      : null;

  const playerHurtAnimContext = useMemo(() => {
    if (playerState !== "hurt") return null;
    const hpLost = playerVariant === "light" ? 1 : playerVariant === "skill" ? 3 : 5;
    const strikeZone = playerHurtClipSource !== "preset" ? playerHurtClipSource : undefined;
    return { hpLost, strikeZone };
  }, [playerState, playerVariant, playerHurtClipSource]);

  const meshyCombat3dClipLeads = useMemo(
    () =>
      resolveCombat3dClipLeads({
        isMergedMeshy: isMergedMeshyStrikePortraitType(monsterType),
        monsterType,
        playerVisualState: playerState,
        monsterVisualState: monsterState,
        draculaAttackVariant: effectiveMonsterVariant,
        playerAttackVariant: effectivePlayerVariant,
        playerFatalJumpKill: fatalJump && playerState === "hurt",
        rollingApproachBlend: approach,
      }),
    [
      monsterType,
      playerState,
      monsterState,
      effectiveMonsterVariant,
      effectivePlayerVariant,
      fatalJump,
      approach,
    ]
  );

  /**
   * Paired GLB restart key — **must not** include `rollingApproachBlend` / approach lerp: during connected sequence that
   * value updates every RAF frame; bumping the key would re-run `CombatFaceOffPairedSubjects` gates and restart hunt
   * clips from t=0 every frame (visible jitter). World X still follows `approach` via `combatFaceOffPositions` only.
   */
  const faceOffAnimationSyncKey = useMemo(
    () =>
      [
        monsterType,
        playerState,
        monsterState,
        playerVariant,
        monsterVariant,
        strikePick ? "1" : "0",
        showMonsterHurtTier ? `${hurtHp}/${hurtMax}` : "x",
        fatalJump ? "1" : "0",
        String(replayNonce),
        draculaHurtAim,
        seqPhase,
        draculaMonsterAttackAim,
        playerHurtClipSource,
        labPlayerWeaponGlb ?? "",
        labPlayerOffhandGlb ?? "",
        labWeaponHand,
        labBladeTwistPreset,
        labExtraEulerDeg.join(","),
        labGripPosM.join(","),
        labOffhandBladeTwistPreset,
        labOffhandExtraEulerDeg.join(","),
        labOffhandGripPosM.join(","),
      ].join("|"),
    [
      monsterType,
      playerState,
      monsterState,
      playerVariant,
      monsterVariant,
      strikePick,
      showMonsterHurtTier,
      hurtHp,
      hurtMax,
      fatalJump,
      replayNonce,
      draculaHurtAim,
      seqPhase,
      draculaMonsterAttackAim,
      playerHurtClipSource,
      labPlayerWeaponGlb,
      labPlayerOffhandGlb,
      labWeaponHand,
      labBladeTwistPreset,
      labExtraEulerDeg,
      labGripPosM,
      labOffhandBladeTwistPreset,
      labOffhandExtraEulerDeg,
      labOffhandGripPosM,
    ]
  );

  const labArmourExtraEulerRad = useMemo(
    (): readonly [number, number, number] => [
      (labExtraEulerDeg[0] * Math.PI) / 180,
      (labExtraEulerDeg[1] * Math.PI) / 180,
      (labExtraEulerDeg[2] * Math.PI) / 180,
    ],
    [labExtraEulerDeg],
  );

  const labArmourGripPositionLocal = useMemo((): readonly [number, number, number] => [...labGripPosM], [labGripPosM]);

  const labOffhandExtraEulerRad = useMemo(
    (): readonly [number, number, number] => [
      (labOffhandExtraEulerDeg[0] * Math.PI) / 180,
      (labOffhandExtraEulerDeg[1] * Math.PI) / 180,
      (labOffhandExtraEulerDeg[2] * Math.PI) / 180,
    ],
    [labOffhandExtraEulerDeg],
  );

  const labOffhandGripPositionLocal = useMemo(
    (): readonly [number, number, number] => [...labOffhandGripPosM],
    [labOffhandGripPosM],
  );

  const labDraculaHurtStrikeZone: StrikeTarget | undefined =
    monsterType === "V" && monsterState === "hurt" && draculaHurtAim !== "hp" ? draculaHurtAim : undefined;

  /** Match desktop combat modal `CombatScene3D` props so camera distance / FOV (`compactAspect`) match in-game. */
  const [labFaceoffVp, setLabFaceoffVp] = useState(() =>
    typeof window !== "undefined"
      ? combatFaceoff3dCanvasSizeDesktopPx(window.innerHeight)
      : { width: 920, height: 380 }
  );
  useEffect(() => {
    const sync = () => setLabFaceoffVp(combatFaceoff3dCanvasSizeDesktopPx(window.innerHeight));
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);
  const viewportW = labFaceoffVp.width;
  const viewportH = labFaceoffVp.height;

  const applyPreset = useCallback((pr: Preset) => {
    setPlayerState(pr.player);
    setMonsterState(pr.monster);
    setPlayerVariant(pr.pVar);
    setMonsterVariant(pr.mVar);
    if (pr.monster === "hurt" && pr.player === "attack") {
      setHurtHp(LAB_PLAYER_WIN_MONSTER_HURT_HP);
      setHurtMax(LAB_PLAYER_WIN_MONSTER_HURT_MAX);
    }
    setReplayNonce((n) => n + 1);
  }, []);

  const cancelLabSequence = useCallback(() => {
    seqSessionRef.current += 1;
    pendingScenarioRef.current = null;
    setSeqPhase("off");
  }, []);

  const snapIdleWide = useCallback(() => {
    cancelLabSequence();
    setPlayerState("idle");
    setMonsterState("idle");
    setApproach(0);
    setReplayNonce((n) => n + 1);
  }, [cancelLabSequence]);

  const copyWeaponAttachSnippet = useCallback(() => {
    const [gx, gy, gz] = labGripPosM;
    const [ex, ey, ez] = labArmourExtraEulerRad;
    const twist = labBladeTwistRad;
    const text = `// Paste into lib/weaponAttachConfig.ts
export const WEAPON_ATTACH_GRIP_POSITION_LOCAL: readonly [number, number, number] = [${gx}, ${gy}, ${gz}];
export const WEAPON_ATTACH_EXTRA_EULER_RAD: readonly [number, number, number] = [${ex}, ${ey}, ${ez}];
export const WEAPON_ATTACH_BLADE_TWIST_RAD = ${twist};
`;
    void navigator.clipboard?.writeText(text);
  }, [labGripPosM, labArmourExtraEulerRad, labBladeTwistRad]);

  const copyShieldAttachSnippet = useCallback(() => {
    if (!labPlayerOffhandGlb) return;
    const [gx, gy, gz] = labOffhandGripPosM;
    const [ex, ey, ez] = labOffhandExtraEulerRad;
    const twist = labOffhandBladeTwistRad;
    const text = `// Add / update in WEAPON_ATTACH_POSE_BY_URL for ${labPlayerOffhandGlb}
gripPositionLocal: [${gx}, ${gy}, ${gz}],
extraEulerRad: [${ex}, ${ey}, ${ez}],
bladeTwistRad: ${twist},
`;
    void navigator.clipboard?.writeText(text);
  }, [labPlayerOffhandGlb, labOffhandGripPosM, labOffhandExtraEulerRad, labOffhandBladeTwistRad]);

  const startScenario = useCallback(
    (pr: Preset) => {
      const skipApproach = pr.player === "idle" && pr.monster === "idle";
      if (playConnectedSequence && !skipApproach) {
        seqSessionRef.current += 1;
        pendingScenarioRef.current = pr;
        setSeqPhase("idle");
        setPlayerState("idle");
        setMonsterState("idle");
        setApproach(0);
        setReplayNonce((n) => n + 1);
      } else {
        cancelLabSequence();
        applyPreset(pr);
      }
    },
    [playConnectedSequence, applyPreset, cancelLabSequence]
  );

  useEffect(() => {
    if (seqPhase !== "idle" || !pendingScenarioRef.current) return;
    const session = seqSessionRef.current;
    const id = window.setTimeout(() => {
      if (seqSessionRef.current !== session || !pendingScenarioRef.current) return;
      setSeqPhase("hunt");
      setPlayerState("hunt");
      setMonsterState("hunt");
    }, 780);
    return () => window.clearTimeout(id);
  }, [seqPhase, replayNonce]);

  useEffect(() => {
    if (playConnectedSequence) return;
    seqSessionRef.current += 1;
    pendingScenarioRef.current = null;
    setSeqPhase("off");
  }, [playConnectedSequence]);

  useEffect(() => {
    if (seqPhase !== "hunt" || !pendingScenarioRef.current) return;
    const session = seqSessionRef.current;
    const pr = pendingScenarioRef.current;
    const durationMs = COMBAT_FACEOFF_APPROACH_DURATION_MS;
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      if (seqSessionRef.current !== session) return;
      const linear = Math.min(1, (now - t0) / durationMs);
      /** smoothstep — ease-in-out so spacing closes without a harsh linear “slide” against hunt locomotion. */
      const u = linear * linear * (3 - 2 * linear);
      setApproach(u);
      if (u < 1) {
        raf = window.requestAnimationFrame(step);
      } else {
        pendingScenarioRef.current = null;
        setPlayerState(pr.player);
        setMonsterState(pr.monster);
        setPlayerVariant(pr.pVar);
        setMonsterVariant(pr.mVar);
        if (pr.monster === "hurt" && pr.player === "attack") {
          setHurtHp(LAB_PLAYER_WIN_MONSTER_HURT_HP);
          setHurtMax(LAB_PLAYER_WIN_MONSTER_HURT_MAX);
        }
        setSeqPhase("off");
      }
    };
    raf = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(raf);
  }, [seqPhase]);

  const monsterPillStyle = (active: boolean): CSSProperties => ({
    padding: "5px 10px",
    borderRadius: 8,
    border: active ? "1px solid rgba(110,200,255,0.85)" : "1px solid rgba(255,255,255,0.14)",
    background: active ? "rgba(50,100,150,0.55)" : "rgba(0,0,0,0.58)",
    color: "#e4f2ff",
    fontSize: "0.72rem",
    fontWeight: active ? 700 : 500,
    cursor: "pointer",
    whiteSpace: "nowrap",
  });

  return (
    <section
      style={{
        marginBottom: 40,
        padding: "16px 18px",
        borderRadius: 14,
        background: "rgba(0,0,0,0.32)",
        border: "1px solid rgba(120,200,255,0.18)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: viewportW,
          margin: "0 auto 12px",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 10,
          fontSize: "0.8rem",
          color: "#c8d8e8",
        }}
      >
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <span style={{ color: "#9ee8ff", fontWeight: 600 }}>Weapon</span>
          <select
            value={labPlayerWeaponGlb ?? ""}
            onChange={(e) => setLabPlayerWeaponGlb(e.target.value === "" ? null : e.target.value)}
            style={selectStyle}
          >
            <option value="">None</option>
            {PLAYER_WEAPON_GLB_OPTIONS.map((o) => (
              <option key={o.path} value={o.path}>
                {o.emoji} {o.label}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <span style={{ color: "#9ee8ff", fontWeight: 600 }}>Shield</span>
          <select
            value={labPlayerOffhandGlb ?? ""}
            onChange={(e) => setLabPlayerOffhandGlb(e.target.value === "" ? null : e.target.value)}
            style={selectStyle}
          >
            <option value="">None</option>
            {PLAYER_OFFHAND_ARMOUR_GLB_OPTIONS.map((o) => (
              <option key={o.path} value={o.path}>
                {o.emoji} {o.label}
              </option>
            ))}
          </select>
        </label>
        <span style={{ color: "#7ec8ff", fontWeight: 600, width: "100%", marginTop: 4 }}>Weapon attach</span>
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: "#9ee8ff" }}>Hand</span>
          <select
            value={labWeaponHand}
            onChange={(e) => setLabWeaponHand(e.target.value as WeaponAttachHand)}
            style={selectStyle}
          >
            <option value="right">Right</option>
            <option value="left">Left</option>
          </select>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: "#9ee8ff" }}>Twist</span>
          <select
            value={labBladeTwistPreset}
            onChange={(e) => setLabBladeTwistPreset(e.target.value as LabBladeTwistPreset)}
            style={selectStyle}
          >
            <option value="0">0°</option>
            <option value="90">90°</option>
            <option value="180">180°</option>
            <option value="270">270°</option>
          </select>
        </label>
        <span style={{ color: "#9ee8ff" }}>Euler°</span>
        {(["X", "Y", "Z"] as const).map((axis, i) => (
          <label key={axis} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {axis}
            <input
              type="number"
              step={5}
              value={labExtraEulerDeg[i]}
              onChange={(e) => {
                const v = Number(e.target.value);
                setLabExtraEulerDeg((prev) => {
                  const next: [number, number, number] = [...prev];
                  next[i] = Number.isFinite(v) ? v : 0;
                  return next;
                });
              }}
              style={{ ...selectStyle, width: 64 }}
            />
          </label>
        ))}
      </div>
      <div
        style={{
          width: "100%",
          maxWidth: viewportW,
          margin: "0 auto 12px",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 10,
          fontSize: "0.78rem",
          color: "#c8d8e8",
        }}
      >
        <span style={{ color: "#9ee8ff", fontWeight: 600 }}>Weapon grip (m)</span>
        {(["X", "Y", "Z"] as const).map((axis, i) => (
          <label key={`g-${axis}`} style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: "0.68rem" }}>
            <span style={{ color: "#8ab0c8" }}>{axis}</span>
            <input
              type="number"
              step={0.001}
              value={labGripPosM[i]}
              onChange={(e) => {
                const v = Number(e.target.value);
                setLabGripPosM((prev) => {
                  const next: [number, number, number] = [...prev];
                  next[i] = Number.isFinite(v) ? v : 0;
                  return next;
                });
              }}
              style={{ ...selectStyle, width: 76 }}
            />
            <input
              type="range"
              min={-0.5}
              max={0.5}
              step={0.002}
              value={Math.min(0.5, Math.max(-0.5, labGripPosM[i]))}
              onChange={(e) => {
                const v = Number(e.target.value);
                setLabGripPosM((prev) => {
                  const next: [number, number, number] = [...prev];
                  next[i] = v;
                  return next;
                });
              }}
              style={{ width: 88 }}
            />
          </label>
        ))}
        <button type="button" onClick={snapIdleWide} style={{ ...btnStyle, textAlign: "center" }}>
          Idle + wide
        </button>
        <button type="button" onClick={copyWeaponAttachSnippet} style={{ ...btnStyle, textAlign: "center" }}>
          Copy weapon
        </button>
      </div>

      {labPlayerOffhandGlb ? (
        <>
          <div
            style={{
              width: "100%",
              maxWidth: viewportW,
              margin: "0 auto 12px",
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 10,
              fontSize: "0.8rem",
              color: "#c8d8e8",
            }}
          >
            <span style={{ color: "#a8e8c8", fontWeight: 600, width: "100%" }}>
              Shield attach (off-hand — <strong style={{ color: "#cfe" }}>left hand bone</strong>, fixed)
            </span>
            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: "#9ee8ff" }}>Twist</span>
              <select
                value={labOffhandBladeTwistPreset}
                onChange={(e) => setLabOffhandBladeTwistPreset(e.target.value as LabBladeTwistPreset)}
                style={selectStyle}
              >
                <option value="0">0°</option>
                <option value="90">90°</option>
                <option value="180">180°</option>
                <option value="270">270°</option>
              </select>
            </label>
            <span style={{ color: "#9ee8ff" }}>Euler°</span>
            {(["X", "Y", "Z"] as const).map((axis, i) => (
              <label key={`sh-${axis}`} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                {axis}
                <input
                  type="number"
                  step={5}
                  value={labOffhandExtraEulerDeg[i]}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setLabOffhandExtraEulerDeg((prev) => {
                      const next: [number, number, number] = [...prev];
                      next[i] = Number.isFinite(v) ? v : 0;
                      return next;
                    });
                  }}
                  style={{ ...selectStyle, width: 64 }}
                />
              </label>
            ))}
          </div>
          <div
            style={{
              width: "100%",
              maxWidth: viewportW,
              margin: "0 auto 12px",
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 10,
              fontSize: "0.78rem",
              color: "#c8d8e8",
            }}
          >
            <span style={{ color: "#a8e8c8", fontWeight: 600 }}>Shield grip (m)</span>
            {(["X", "Y", "Z"] as const).map((axis, i) => (
              <label key={`sg-${axis}`} style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: "0.68rem" }}>
                <span style={{ color: "#8ab0a8" }}>{axis}</span>
                <input
                  type="number"
                  step={0.001}
                  value={labOffhandGripPosM[i]}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setLabOffhandGripPosM((prev) => {
                      const next: [number, number, number] = [...prev];
                      next[i] = Number.isFinite(v) ? v : 0;
                      return next;
                    });
                  }}
                  style={{ ...selectStyle, width: 76 }}
                />
                <input
                  type="range"
                  min={-0.5}
                  max={0.5}
                  step={0.002}
                  value={Math.min(0.5, Math.max(-0.5, labOffhandGripPosM[i]))}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setLabOffhandGripPosM((prev) => {
                      const next: [number, number, number] = [...prev];
                      next[i] = v;
                      return next;
                    });
                  }}
                  style={{ width: 88 }}
                />
              </label>
            ))}
            <button type="button" onClick={copyShieldAttachSnippet} style={{ ...btnStyle, textAlign: "center" }}>
              Copy shield
            </button>
          </div>
        </>
      ) : null}

      {labPlayerWeaponGlb && weaponFileOk === false ? (
        <div
          style={{
            width: "100%",
            maxWidth: viewportW,
            margin: "0 auto 10px",
            padding: "8px 10px",
            borderRadius: 8,
            background: "rgba(180, 50, 50, 0.2)",
            border: "1px solid rgba(255,120,100,0.45)",
            fontSize: "0.76rem",
            color: "#ffc8c0",
          }}
        >
          Missing weapon: <code style={{ color: "#fff" }}>{labPlayerWeaponGlb}</code>
        </div>
      ) : null}
      {labPlayerOffhandGlb && offhandFileOk === false ? (
        <div
          style={{
            width: "100%",
            maxWidth: viewportW,
            margin: "0 auto 10px",
            padding: "8px 10px",
            borderRadius: 8,
            background: "rgba(180, 50, 50, 0.2)",
            border: "1px solid rgba(255,120,100,0.45)",
            fontSize: "0.76rem",
            color: "#ffc8c0",
          }}
        >
          Missing shield: <code style={{ color: "#fff" }}>{labPlayerOffhandGlb}</code>
        </div>
      ) : null}

      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: viewportW,
          margin: "0 auto",
          borderRadius: 10,
          overflow: "hidden",
          lineHeight: 0,
        }}
      >
        <CombatScene3D
          monsterGltfPath={monsterPath}
          playerGltfPath={playerPath}
          armourGltfPath={labPlayerWeaponGlb}
          armourAttachHand={labWeaponHand}
          armourBladeTwistRad={labBladeTwistRad}
          armourExtraEulerRad={labArmourExtraEulerRad}
          armourGripPositionLocal={labArmourGripPositionLocal}
          armourOffhandGltfPath={labPlayerOffhandGlb}
          armourOffhandBladeTwistRad={labOffhandBladeTwistRad}
          armourOffhandExtraEulerRad={labOffhandExtraEulerRad}
          armourOffhandGripPositionLocal={labOffhandGripPositionLocal}
          monsterVisualState={monsterState}
          playerVisualState={playerState}
          monsterType={monsterType}
          draculaAttackVariant={effectiveMonsterVariant}
          playerAttackVariant={effectivePlayerVariant}
          draculaHurtHp={draculaHurtHp}
          draculaHurtStrikeZone={labDraculaHurtStrikeZone}
          draculaLoopAngrySkill01={false}
          playerFatalJumpKill={fatalJump && playerState === "hurt"}
          playerHurtAnimContext={playerHurtAnimContext}
          playerHurtClipStartTimeSec={meshyCombat3dClipLeads.meshyPlayerHurtLeadInSec}
          playerHurtHandoffCrossfadeSec={meshyCombat3dClipLeads.meshyPlayerHurtHandoffCrossfadeSec}
          playerAttackClipLeadInSec={meshyCombat3dClipLeads.meshyPlayerAttackLeadInSec}
          playerLocomotionToAttackCrossfadeSec={meshyCombat3dClipLeads.meshyPlayerHuntToAttackCrossfadeSec}
          monsterLocomotionToAttackCrossfadeSec={meshyCombat3dClipLeads.meshyMonsterHuntToAttackCrossfadeSec}
          monsterHurtClipStartTimeSec={meshyCombat3dClipLeads.meshyMonsterHurtLeadInSec}
          width={viewportW}
          height={viewportH}
          compactCombatViewport
          strikePickActive={strikePick}
          orbitMinDistance={0.48}
          orbitMaxDistance={11}
          rollingApproachBlend={approach}
          faceOffAnimationSyncKey={faceOffAnimationSyncKey}
          combatSceneSessionKey="monster-3d-contact-lab"
          fallback={
            <div
              style={{
                width: viewportW,
                height: viewportH,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(0,0,0,0.5)",
                color: "#9888a8",
                fontSize: "0.8rem",
                borderRadius: 8,
              }}
            >
              Load error
            </div>
          }
        />
        <div
          style={{
            position: "absolute",
            left: 8,
            top: 6,
            right: 8,
            fontSize: "0.65rem",
            color: "rgba(200,220,255,0.75)",
            textAlign: "right",
            pointerEvents: "none",
            lineHeight: 1.35,
            zIndex: 2,
            textShadow: "0 1px 4px rgba(0,0,0,0.85)",
          }}
        >
          {strikePick ? "Strike-pick: tap zones · orbit off" : "Drag rotate · wheel / pinch zoom"}
        </div>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            padding: "8px 6px",
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            justifyContent: "center",
            alignItems: "center",
            background: "linear-gradient(0deg, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.35) 55%, transparent 100%)",
            pointerEvents: "none",
            lineHeight: 1.2,
            zIndex: 2,
          }}
        >
          {LAB_MONSTER_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              style={{ ...monsterPillStyle(monsterType === t), pointerEvents: "auto" }}
              onClick={() => {
                cancelLabSequence();
                setApproach(1);
                setMonsterType(t);
                setReplayNonce((n) => n + 1);
              }}
            >
              {t} · {getMonsterName(t)}
            </button>
          ))}
        </div>
      </div>

      <div
        style={{
          width: "100%",
          maxWidth: viewportW,
          margin: "14px auto 0",
          paddingTop: 14,
          borderTop: "1px solid rgba(120,200,255,0.2)",
        }}
      >
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 10,
            fontSize: "0.78rem",
            color: "#c8d8e8",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={playConnectedSequence}
            onChange={(e) => setPlayConnectedSequence(e.target.checked)}
          />
          Connected idle → hunt → approach → strike
        </label>
        {seqPhase !== "off" ? (
          <p style={{ margin: "0 0 10px", fontSize: "0.74rem", color: "#7ec8ff" }}>
            {seqPhase === "idle" ? "Idle" : "Hunt + approach"}
          </p>
        ) : null}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          <button
            type="button"
            onClick={() => setReplayNonce((n) => n + 1)}
            style={{
              ...btnStyle,
              fontWeight: 700,
              border: "1px solid rgba(120,200,255,0.45)",
              background: "rgba(60,100,140,0.35)",
              flex: "1 1 160px",
              minWidth: 140,
              textAlign: "center",
            }}
          >
            Replay
          </button>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 8,
          }}
        >
          {STRIKE_PRESETS.map((pr) => (
            <button key={pr.label} type="button" onClick={() => startScenario(pr)} style={scenarioBtnStyle}>
              {pr.label}
            </button>
          ))}
        </div>
      </div>

      <details
        style={{
          marginTop: 18,
          padding: "12px 14px",
          borderRadius: 12,
          background: "rgba(0,0,0,0.22)",
          border: "1px solid rgba(120,200,255,0.12)",
        }}
      >
        <summary
          style={{
            cursor: "pointer",
            fontSize: "0.85rem",
            fontWeight: 600,
            color: "#b8d8f0",
            listStyle: "none",
          }}
        >
          More
        </summary>
        <div style={{ marginTop: 14 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
          gap: 12,
          marginBottom: 14,
          alignItems: "end",
        }}
      >
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.78rem", color: "#b8afc8" }}>
          Player visual
          <select
            value={playerState}
            onChange={(e) => {
              cancelLabSequence();
              setPlayerState(e.target.value as Monster3DSpriteState);
            }}
            style={selectStyle}
          >
            {MONSTER_3D_VISUAL_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.78rem", color: "#b8afc8" }}>
          Monster visual
          <select
            value={monsterState}
            onChange={(e) => {
              cancelLabSequence();
              setMonsterState(e.target.value as Monster3DSpriteState);
            }}
            style={selectStyle}
          >
            {MONSTER_3D_VISUAL_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.78rem", color: "#b8afc8" }}>
          Player strike tier
          <select
            value={playerVariant}
            onChange={(e) => setPlayerVariant(e.target.value as (typeof VARIANTS)[number])}
            style={selectStyle}
          >
            {VARIANTS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        {playerState === "hurt" ? (
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.78rem", color: "#b8afc8" }}>
            Player hurt source
            <select
              value={playerHurtClipSource}
              onChange={(e) => setPlayerHurtClipSource(e.target.value as PlayerHurtClipSource)}
              style={selectStyle}
            >
              <option value="preset">Preset tier</option>
              <option value="head">Aim head → spell</option>
              <option value="body">Aim body → skill</option>
              <option value="legs">Aim legs → light</option>
            </select>
          </label>
        ) : null}
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.78rem", color: "#b8afc8" }}>
          Monster strike tier
          <select
            value={monsterVariant}
            onChange={(e) => setMonsterVariant(e.target.value as (typeof VARIANTS)[number])}
            style={selectStyle}
          >
            {VARIANTS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        {monsterType === "V" && monsterState === "attack" ? (
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.78rem", color: "#b8afc8" }}>
            Dracula attack source
            <select
              value={draculaMonsterAttackAim}
              onChange={(e) =>
                setDraculaMonsterAttackAim(e.target.value as DraculaMonsterAttackAimSource)
              }
              style={selectStyle}
            >
              <option value="preset">Preset tier</option>
              <option value="head">Aim head → spell</option>
              <option value="body">Aim body → skill</option>
              <option value="legs">Aim legs → light</option>
            </select>
          </label>
        ) : null}
        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: "0.78rem", color: "#b8afc8" }}>
          <span>
            <input type="checkbox" checked={strikePick} onChange={(e) => setStrikePick(e.target.checked)} /> Strike-pick (crosshair, orbit off)
          </span>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.78rem", color: "#b8afc8" }}>
          Approach blend{" "}
          {useStrikeContactSpacing || seqPhase !== "off" ? "(N/A)" : ""}
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={approach}
            disabled={useStrikeContactSpacing || seqPhase !== "off"}
            onChange={(e) => setApproach(Number(e.target.value))}
            style={{ width: "100%" }}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: "0.78rem", color: "#b8afc8" }}>
          <span>
            <input
              type="checkbox"
              checked={showMonsterHurtTier}
              onChange={(e) => setShowMonsterHurtTier(e.target.checked)}
            />{" "}
            Monster hurt uses HP tier
          </span>
        </label>
        {monsterType === "V" && monsterState === "hurt" ? (
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.78rem", color: "#b8afc8" }}>
            Dracula hurt source
            <select
              value={draculaHurtAim}
              onChange={(e) => setDraculaHurtAim(e.target.value as "hp" | StrikeTarget)}
              style={selectStyle}
            >
              <option value="hp">HP tier</option>
              <option value="head">Head</option>
              <option value="body">Body</option>
              <option value="legs">Legs</option>
            </select>
          </label>
        ) : null}
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.78rem", color: "#b8afc8" }}>
          Hurt HP / max
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="number"
              min={0}
              value={hurtHp}
              onChange={(e) => setHurtHp(Number(e.target.value))}
              style={{ ...selectStyle, width: 72 }}
            />
            <input
              type="number"
              min={1}
              value={hurtMax}
              onChange={(e) => setHurtMax(Number(e.target.value))}
              style={{ ...selectStyle, width: 72 }}
            />
          </div>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: "0.78rem", color: "#b8afc8" }}>
          <span>
            <input type="checkbox" checked={fatalJump} onChange={(e) => setFatalJump(e.target.checked)} /> Fatal jump (player hurt)
          </span>
        </label>
      </div>
        </div>
      </details>
    </section>
  );
}
