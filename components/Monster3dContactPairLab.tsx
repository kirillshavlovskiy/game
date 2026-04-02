"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { MonsterType } from "@/lib/labyrinth";
import { getMonsterName } from "@/lib/labyrinth";
import type { StrikeTarget } from "@/lib/combatSystem";
import { combatFaceOffPositions } from "@/components/MonsterModel3D";
import { resolveCombat3dClipLeads } from "@/lib/combat3dContact";
import {
  draculaAttackVariantFromStrikeTarget,
  getMonsterGltfPathForReference,
  isMergedMeshyStrikePortraitType,
  MONSTER_3D_VISUAL_STATES,
  playerHurtVariantFromStrikeTarget,
  PLAYER_3D_GLB,
  type Monster3DSpriteState,
} from "@/lib/monsterModels3d";
import { DEFAULT_LAB_PLAYER_WEAPON_GLB, PLAYER_ARMOUR_GLB_OPTIONS } from "@/lib/playerArmourGlbs";

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

const CombatScene3D = dynamic(
  () => import("@/components/MonsterModel3D").then((m) => m.CombatScene3D),
  {
    ssr: false,
    loading: () => (
      <div
        style={{
          height: 300,
          borderRadius: 12,
          background: "rgba(0,0,0,0.4)",
          border: "1px solid rgba(255,152,103,0.2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#8a8098",
          fontSize: "0.9rem",
        }}
      >
        Loading face-off scene…
      </div>
    ),
  }
);

const VARIANTS = ["spell", "skill", "light"] as const;

const LAB_MONSTER_TYPES: MonsterType[] = ["V", "K", "Z", "S", "L", "G"];

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
  /** Matches combat: aim overlay + locked orbit during tuning; face-off **spacing** is unchanged (always strike-range for hit beats). */
  const [strikePick, setStrikePick] = useState(true);
  /** Default 1 = same strike-pick half as in-game merged 3D between rolls (`combat3dRollingApproachBlend`). */
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
  const [weaponFileOk, setWeaponFileOk] = useState<boolean | null>(null);

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
      }),
    [
      strikePick,
      isContactExchange,
      approach,
      playerState,
      monsterState,
      effectivePlayerVariant,
      effectiveMonsterVariant,
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
    ]
  );

  const labDraculaHurtStrikeZone: StrikeTarget | undefined =
    monsterType === "V" && monsterState === "hurt" && draculaHurtAim !== "hp" ? draculaHurtAim : undefined;

  const viewportW = 640;
  const viewportH = 320;

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
    const durationMs = 2200;
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
        setReplayNonce((n) => n + 1);
      }
    };
    raf = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(raf);
  }, [seqPhase]);

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
      <h2 style={{ fontSize: "1.2rem", marginTop: 0, marginBottom: 8, color: "#9ee8ff" }}>
        Face-off lab — player + monster (spacing + Meshy clip timing)
      </h2>
      <p
        style={{
          margin: "0 0 14px",
          fontSize: "0.84rem",
          color: "#a89cb0",
          lineHeight: 1.55,
          maxWidth: viewportW,
        }}
      >
        Same <strong style={{ color: "#dce6f0" }}>X spacing</strong> and{" "}
        <strong style={{ color: "#dce6f0" }}>player/monster clip lead-ins</strong> as the combat modal for merged Meshy (V/K/Z/S/L) via{" "}
        <code style={{ color: "#c4e8ff" }}>resolveCombat3dClipLeads</code>. With{" "}
        <strong style={{ color: "#dce6f0" }}>Connected approach → strike</strong> on,
        each scenario runs <strong style={{ color: "#dce6f0" }}>idle</strong> → both <strong style={{ color: "#dce6f0" }}>hunt</strong> while
        the fighters <strong style={{ color: "#dce6f0" }}>close in</strong> (approach blend), then the strike result. Dracula’s{" "}
        <strong style={{ color: "#dce6f0" }}>Jumping_Punch</strong> is reserved for the <strong style={{ color: "#dce6f0" }}>spell</strong>{" "}
        attack tier (and head aim in real combat); skill/light use grounded clips. Open{" "}
        <strong style={{ color: "#dce6f0" }}>Advanced</strong> for tiers, Dracula hurt/attack clip source, and readouts.
      </p>

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
          <span style={{ color: "#9ee8ff", fontWeight: 600 }}>Player weapon</span>
          <select
            value={labPlayerWeaponGlb ?? ""}
            onChange={(e) => setLabPlayerWeaponGlb(e.target.value === "" ? null : e.target.value)}
            style={selectStyle}
          >
            <option value="">None</option>
            {PLAYER_ARMOUR_GLB_OPTIONS.map((o) => (
              <option key={o.path} value={o.path}>
                {o.emoji} {o.label}
              </option>
            ))}
          </select>
        </label>
        <span style={{ fontSize: "0.72rem", color: "#8a9aac", lineHeight: 1.4 }}>
          Same GLBs as in-game armour — wired to <code style={{ color: "#c4e8ff" }}>CombatScene3D</code>{" "}
          <code style={{ color: "#c4e8ff" }}>armourGltfPath</code> (hand attach). Default = first weapon in the list.
        </span>
      </div>
      {labPlayerWeaponGlb && weaponFileOk === false ? (
        <div
          style={{
            width: "100%",
            maxWidth: viewportW,
            margin: "0 auto 10px",
            padding: "10px 12px",
            borderRadius: 10,
            background: "rgba(180, 50, 50, 0.2)",
            border: "1px solid rgba(255,120,100,0.45)",
            fontSize: "0.78rem",
            color: "#ffc8c0",
            lineHeight: 1.45,
          }}
        >
          <strong>Weapon GLB not found:</strong> <code style={{ color: "#fff" }}>{labPlayerWeaponGlb}</code>
          <br />
          Add files under <code style={{ color: "#c4e8ff" }}>public/models/armour/</code> (see{" "}
          <code style={{ color: "#c4e8ff" }}>lib/playerArmourGlbs.ts</code>) or pick <strong>None</strong>. Without assets the
          battle scene still runs but no weapon mesh appears.
        </div>
      ) : null}

      <div style={{ width: "100%", maxWidth: viewportW, margin: "0 auto" }}>
        <CombatScene3D
          monsterGltfPath={monsterPath}
          playerGltfPath={playerPath}
          armourGltfPath={labPlayerWeaponGlb}
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
          playerAttackClipLeadInSec={meshyCombat3dClipLeads.meshyPlayerAttackLeadInSec}
          playerLocomotionToAttackCrossfadeSec={meshyCombat3dClipLeads.meshyPlayerHuntToAttackCrossfadeSec}
          monsterLocomotionToAttackCrossfadeSec={meshyCombat3dClipLeads.meshyMonsterHuntToAttackCrossfadeSec}
          monsterHurtClipStartTimeSec={meshyCombat3dClipLeads.meshyMonsterHurtLeadInSec}
          width={viewportW}
          height={viewportH}
          compactCombatViewport
          strikePickActive={strikePick}
          rollingApproachBlend={approach}
          faceOffAnimationSyncKey={faceOffAnimationSyncKey}
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
                fontSize: "0.85rem",
                borderRadius: 8,
              }}
            >
              WebGL / model load failed — check console and GLB paths
            </div>
          }
        />
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
        <p style={{ margin: "0 0 10px", fontSize: "0.82rem", fontWeight: 600, color: "#9ee8ff" }}>Combat scenarios</p>
        <p style={{ margin: "0 0 12px", fontSize: "0.76rem", color: "#8a9aac", lineHeight: 1.45 }}>
          One button per net outcome. Connected mode runs idle → hunt → close in → strike; “Between rolls · both idle” skips
          the approach. Turn it off to snap straight to the strike pose like before.
        </p>
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
          Connected approach → strike (idle → hunt → close in → hit)
        </label>
        {seqPhase !== "off" ? (
          <p style={{ margin: "0 0 10px", fontSize: "0.76rem", color: "#7ec8ff" }}>
            Sequence: <strong>{seqPhase === "idle" ? "Calm (idle)" : "Closing in (hunt + approach)"}</strong>
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
            Replay both (sync from t=0)
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
            fontSize: "0.88rem",
            fontWeight: 600,
            color: "#b8d8f0",
            listStyle: "none",
          }}
        >
          Advanced face-off controls (monster type, visuals, spacing, hurt tiers, readouts)
        </summary>
        <div style={{ marginTop: 14 }}>
          <div
            style={{
              margin: "0 0 16px",
              fontSize: "0.82rem",
              color: "#a89cb0",
              lineHeight: 1.55,
            }}
          >
            <p style={{ margin: "0 0 12px" }}>
              The 3D box uses the same left–right spacing rules as the real combat modal. Each strike roll resolves to a{" "}
              <strong style={{ color: "#dce6f0" }}>single net exchange</strong>: either the monster lost more HP (you see your strike while the monster
              is <strong style={{ color: "#dce6f0" }}>hurt</strong> or <strong style={{ color: "#dce6f0" }}>knockdown</strong>) or you lost more (the monster is{" "}
              <strong style={{ color: "#dce6f0" }}>attack</strong> while you are hurt or knockdown). The modal does not stage two full attack clips at
              once for that result. Here there is still no dice or real HP—only those paired poses and spacing.
            </p>
            <p style={{ margin: "0 0 8px", color: "#9ee8ff", fontWeight: 600 }}>Step by step</p>
            <ol style={{ margin: "0 0 12px", paddingLeft: 22, color: "#b8afc8" }}>
              <li style={{ marginBottom: 8 }}>
                Choose <strong style={{ color: "#dce6f0" }}>Monster type</strong>, then <strong style={{ color: "#dce6f0" }}>Player visual</strong> and{" "}
                <strong style={{ color: "#dce6f0" }}>Monster visual</strong>, or use a scenario button above—each scenario is one of those net outcomes (plus{" "}
                <strong style={{ color: "#dce6f0" }}>Between rolls · both idle</strong> for calm spacing).
              </li>
              <li style={{ marginBottom: 8 }}>
                <strong style={{ color: "#dce6f0" }}>Player strike tier</strong> only drives clips when <strong style={{ color: "#dce6f0" }}>Player visual</strong> is{" "}
                <strong style={{ color: "#dce6f0" }}>attack</strong>. <strong style={{ color: "#dce6f0" }}>Monster strike tier</strong> only drives clips when{" "}
                <strong style={{ color: "#dce6f0" }}>Monster visual</strong> is <strong style={{ color: "#dce6f0" }}>attack</strong>. On hurt / knockdown rows,
                use <strong style={{ color: "#dce6f0" }}>Hurt HP / max</strong>, <strong style={{ color: "#dce6f0" }}>Dracula hurt clip source</strong>, and{" "}
                <strong style={{ color: "#dce6f0" }}>Player fatal jump kill</strong> where the labels apply.
              </li>
              <li style={{ marginBottom: 8 }}>
                Turn <strong style={{ color: "#dce6f0" }}>Strike-pick spacing (ignores contact tiers)</strong> on to preview the tighter layout used
                when you aim strikes at the monster in the real game. Leave it off to use the normal spacing rules from the other controls.
              </li>
              <li style={{ marginBottom: 8 }}>
                Drag <strong style={{ color: "#dce6f0" }}>Approach blend (idle → close)</strong> only when the slider is not marked <strong style={{ color: "#c8b8d4" }}>N/A</strong>{" "}
                (it is disabled while Strike-pick spacing is on or while the readout line <strong style={{ color: "#c8e8ff" }}>useStrikeContactSpacing</strong> is{" "}
                <strong style={{ color: "#c8e8ff" }}>true</strong>).
              </li>
              <li style={{ marginBottom: 8 }}>
                For <strong style={{ color: "#dce6f0" }}>Monster type</strong> <strong style={{ color: "#dce6f0" }}>V — Dracula</strong> and{" "}
                <strong style={{ color: "#dce6f0" }}>Monster visual</strong> <strong style={{ color: "#dce6f0" }}>hurt</strong>, use{" "}
                <strong style={{ color: "#dce6f0" }}>Dracula hurt clip source</strong>: either <strong style={{ color: "#dce6f0" }}>HP tier</strong> (with{" "}
                <strong style={{ color: "#dce6f0" }}>Monster hurt HP tier</strong> + <strong style={{ color: "#dce6f0" }}>Hurt HP / max</strong>) or{" "}
                <strong style={{ color: "#dce6f0" }}>head</strong> / <strong style={{ color: "#dce6f0" }}>body</strong> / <strong style={{ color: "#dce6f0" }}>legs</strong> to
                match in-combat strike aim. Otherwise keep <strong style={{ color: "#dce6f0" }}>Monster hurt HP tier</strong> and{" "}
                <strong style={{ color: "#dce6f0" }}>Hurt HP / max</strong> as above for other monsters.
              </li>
              <li style={{ marginBottom: 8 }}>
                For <strong style={{ color: "#dce6f0" }}>Player visual</strong> set to <strong style={{ color: "#dce6f0" }}>hurt</strong>, optionally turn on{" "}
                <strong style={{ color: "#dce6f0" }}>Player fatal jump kill (hurt clips)</strong> to preview the alternate hurt sequence.
              </li>
              <li style={{ marginBottom: 0 }}>
                Press <strong style={{ color: "#dce6f0" }}>Replay both</strong> under the canvas to run the same combination again from the first frame
                on both characters. Scenario buttons also bump replay so each tap restarts in sync.
              </li>
            </ol>
            <p style={{ margin: 0, color: "#8ab8c8", fontSize: "0.8rem" }}>
              The blue readout shows <strong style={{ color: "#c8e8ff" }}>isContactExchange</strong>,{" "}
              <strong style={{ color: "#c8e8ff" }}>useStrikeContactSpacing</strong>, <strong style={{ color: "#c8e8ff" }}>playerPosX</strong>,{" "}
              <strong style={{ color: "#c8e8ff" }}>monsterPosX</strong>, and <strong style={{ color: "#c8e8ff" }}>GLBs:</strong> — use those numbers to compare spacing between setups.
            </p>
          </div>

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
          Monster type
          <select
            value={monsterType}
            onChange={(e) => {
              cancelLabSequence();
              setApproach(1);
              setMonsterType(e.target.value as MonsterType);
              setReplayNonce((n) => n + 1);
            }}
            style={selectStyle}
          >
            {LAB_MONSTER_TYPES.map((t) => (
              <option key={t} value={t}>
                {t} — {getMonsterName(t)}
              </option>
            ))}
          </select>
        </label>
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
          Player strike tier (attack clips)
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
            Player hurt clip source (monster hit)
            <select
              value={playerHurtClipSource}
              onChange={(e) => setPlayerHurtClipSource(e.target.value as PlayerHurtClipSource)}
              style={selectStyle}
            >
              <option value="preset">Scenario tier (spell / skill / light from preset)</option>
              <option value="head">Strike aim head → spell tier (hard fall)</option>
              <option value="body">Strike aim body → skill tier (stagger)</option>
              <option value="legs">Strike aim legs → light tier (flinch)</option>
            </select>
          </label>
        ) : null}
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.78rem", color: "#b8afc8" }}>
          Monster strike tier (attack clips)
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
            Dracula attack clip source
            <select
              value={draculaMonsterAttackAim}
              onChange={(e) =>
                setDraculaMonsterAttackAim(e.target.value as DraculaMonsterAttackAimSource)
              }
              style={selectStyle}
            >
              <option value="preset">Scenario tier (spell / skill / light)</option>
              <option value="head">Strike aim head → spell (Jumping_Punch tier)</option>
              <option value="body">Strike aim body → skill (grounded)</option>
              <option value="legs">Strike aim legs → light (quick / throw)</option>
            </select>
          </label>
        ) : null}
        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: "0.78rem", color: "#b8afc8" }}>
          <span>
            <input type="checkbox" checked={strikePick} onChange={(e) => setStrikePick(e.target.checked)} /> Strike-pick
            UI (aim / orbit off) — spacing is fixed in `combatFaceOffPositions`
          </span>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.78rem", color: "#b8afc8" }}>
          Approach blend (idle → close){" "}
          {useStrikeContactSpacing || seqPhase !== "off" ? "— N/A (contact exchange or sequence)" : ""}
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
            Monster hurt HP tier (clip choice)
          </span>
        </label>
        {monsterType === "V" && monsterState === "hurt" ? (
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.78rem", color: "#b8afc8" }}>
            Dracula hurt clip source
            <select
              value={draculaHurtAim}
              onChange={(e) => setDraculaHurtAim(e.target.value as "hp" | StrikeTarget)}
              style={selectStyle}
            >
              <option value="hp">HP tier (light / medium / heavy)</option>
              <option value="head">Head strike (face punch reaction 2)</option>
              <option value="body">Body / waist strike</option>
              <option value="legs">Leg strike (falling down)</option>
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
            <input type="checkbox" checked={fatalJump} onChange={(e) => setFatalJump(e.target.checked)} /> Player fatal
            jump kill (hurt clips)
          </span>
        </label>
      </div>

      <div
        style={{
          marginBottom: 12,
          padding: "10px 12px",
          borderRadius: 10,
          background: "rgba(40,80,120,0.2)",
          fontSize: "0.78rem",
          fontFamily: "ui-monospace, monospace",
          color: "#c8e8ff",
          lineHeight: 1.55,
        }}
      >
        <div>
          <strong>isContactExchange</strong> (hurt/attack overlap): {String(isContactExchange)}
        </div>
        <div>
          <strong>useStrikeContactSpacing</strong> (attack on either side): {String(useStrikeContactSpacing)}
        </div>
        <div>
          <strong>playerPosX</strong> {spacing.playerPosX.toFixed(3)} · <strong>monsterPosX</strong>{" "}
          {spacing.monsterPosX.toFixed(3)} (half-gap {Math.abs(spacing.playerPosX).toFixed(3)})
        </div>
        <div style={{ marginTop: 6, opacity: 0.85 }}>
          GLBs: <code>{playerPath}</code> + <code>{monsterPath}</code>
        </div>
      </div>
        </div>
      </details>
    </section>
  );
}
