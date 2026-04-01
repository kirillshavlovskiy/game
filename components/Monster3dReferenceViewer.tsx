"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { Canvas, invalidate, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { MonsterType } from "@/lib/labyrinth";
import { getMonsterName } from "@/lib/labyrinth";
import { MONSTER_3D_GLB_SLUG_BY_TYPE, MONSTER_3D_VISUAL_STATES, type Monster3DSpriteState } from "@/lib/monsterModels3d";
import { Monster3dGltfSceneContent } from "@/components/MonsterModel3D";

const TYPES: MonsterType[] = ["V", "Z", "S", "G", "K", "L"];

function SpinningTorus() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    const m = ref.current;
    if (!m) return;
    m.rotation.x += dt * 0.22;
    m.rotation.y += dt * 0.38;
    invalidate();
  });
  return (
    <mesh ref={ref}>
      <torusGeometry args={[0.52, 0.18, 28, 52]} />
      <meshStandardMaterial color="#6b3d5c" emissive="#1a0a14" emissiveIntensity={0.35} metalness={0.25} roughness={0.55} />
    </mesh>
  );
}

function PlaceholderScene() {
  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[2.5, 4.5, 3]} intensity={1} />
      <SpinningTorus />
    </>
  );
}

async function glbExists(url: string): Promise<boolean> {
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

export function Monster3dReferenceViewer() {
  const [monsterType, setMonsterType] = useState<MonsterType>("V");
  const [visualState, setVisualState] = useState<Monster3DSpriteState>("idle");
  const [draculaAttackVariant, setDraculaAttackVariant] = useState<"spell" | "skill" | "light">("spell");
  const [defeatPreviewMode, setDefeatPreviewMode] = useState<"single" | "sequence">("sequence");
  const [tight, setTight] = useState(false);
  const [glbUrl, setGlbUrl] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [playbackVisualState, setPlaybackVisualState] = useState<Monster3DSpriteState>("idle");
  const queuedVisualStateRef = useRef<Monster3DSpriteState | null>(null);
  const [previewRunId, setPreviewRunId] = useState(0);

  const slug = MONSTER_3D_GLB_SLUG_BY_TYPE[monsterType];
  const path = `/models/monsters/${slug}.glb`;

  useEffect(() => {
    let cancelled = false;
    setChecking(true);
    void (async () => {
      const ok = await glbExists(path);
      if (!cancelled) {
        setGlbUrl(ok ? path : null);
        setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path]);

  const canSequenceDefeat = monsterType !== "G" && (visualState === "defeated" || visualState === "knockdown");

  useEffect(() => {
    queuedVisualStateRef.current = null;
    if (visualState === "defeated" && defeatPreviewMode === "sequence" && monsterType !== "G") {
      setPlaybackVisualState("knockdown");
      queuedVisualStateRef.current = "defeated";
      return;
    }
    setPlaybackVisualState(visualState);
  }, [monsterType, visualState, defeatPreviewMode, previewRunId]);

  const mergedAttackVariant =
    (monsterType === "V" || monsterType === "K" || monsterType === "Z" || monsterType === "S" || monsterType === "L") && playbackVisualState === "attack"
      ? draculaAttackVariant
      : undefined;

  /** Demo tiers for merged Meshy hurt clips — matches combat when footer passes HP. */
  const demoHurtHp =
    (monsterType === "V" || monsterType === "K" || monsterType === "Z" || monsterType === "S" || monsterType === "L") && playbackVisualState === "hurt"
      ? { hp: 6, maxHp: 9 }
      : undefined;

  const handleOneShotFinished = () => {
    const queued = queuedVisualStateRef.current;
    if (!queued) return;
    queuedVisualStateRef.current = null;
    setPlaybackVisualState(queued);
  };

  return (
    <section
      style={{
        marginBottom: 32,
        padding: 16,
        borderRadius: 12,
        background: "rgba(0,0,0,0.45)",
        border: "1px solid rgba(255,152,103,0.2)",
      }}
    >
      <h2 style={{ fontSize: "1.15rem", margin: "0 0 10px", color: "#b8f0c8" }}>Live 3D preview</h2>
      <p style={{ margin: "0 0 14px", fontSize: "0.88rem", color: "#a89cb0" }}>
        One <code style={{ color: "#c4b8d4" }}>&lt;slug&gt;.glb</code> per type. <strong>Dracula</strong> and{" "}
        <strong>skeleton</strong> use merged Meshy GLBs; portrait state switches clips on the same rig (as in combat).
        Purple torus: file missing. No <code>NEXT_PUBLIC_MONSTER_3D=1</code> required here.
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 12, alignItems: "center" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.8rem", color: "#b8afc8" }}>
          Monster
          <select
            value={monsterType}
            onChange={(e) => setMonsterType(e.target.value as MonsterType)}
            style={{
              minWidth: 160,
              padding: "6px 8px",
              borderRadius: 8,
              background: "#1a1520",
              color: "#e8e4ec",
              border: "1px solid rgba(255,255,255,0.15)",
            }}
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t} — {getMonsterName(t)}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.8rem", color: "#b8afc8" }}>
          Portrait state (clip picker)
          <select
            value={visualState}
            onChange={(e) => setVisualState(e.target.value as Monster3DSpriteState)}
            style={{
              minWidth: 160,
              padding: "6px 8px",
              borderRadius: 8,
              background: "#1a1520",
              color: "#e8e4ec",
              border: "1px solid rgba(255,255,255,0.15)",
            }}
          >
            {MONSTER_3D_VISUAL_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        {(monsterType === "V" || monsterType === "K" || monsterType === "Z" || monsterType === "S" || monsterType === "L") && playbackVisualState === "attack" ? (
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.8rem", color: "#b8afc8" }}>
            Attack clip priority
            <select
              value={draculaAttackVariant}
              onChange={(e) => setDraculaAttackVariant(e.target.value as "spell" | "skill" | "light")}
              style={{
                minWidth: 200,
                padding: "6px 8px",
                borderRadius: 8,
                background: "#1a1520",
                color: "#e8e4ec",
                border: "1px solid rgba(255,255,255,0.15)",
              }}
            >
              <option value="spell">
                {monsterType === "K" ? "spell first (combo → charged → slash…)" : "spell first (Charged_Spell_Cast_2 → …)"}
              </option>
              <option value="skill">
                {monsterType === "K" ? "skill first (slash → skills…)" : "skill first (Skill_03 → …)"}
              </option>
              <option value="light">light tier first</option>
            </select>
          </label>
        ) : null}
        {canSequenceDefeat ? (
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.8rem", color: "#b8afc8" }}>
            Defeat preview
            <select
              value={defeatPreviewMode}
              onChange={(e) => setDefeatPreviewMode(e.target.value as "single" | "sequence")}
              style={{
                minWidth: 220,
                padding: "6px 8px",
                borderRadius: 8,
                background: "#1a1520",
                color: "#e8e4ec",
                border: "1px solid rgba(255,255,255,0.15)",
              }}
            >
              <option value="single">Selected state only</option>
              <option value="sequence">Play knockdown then defeated</option>
            </select>
          </label>
        ) : null}
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: "0.85rem",
            color: "#b8afc8",
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          <input type="checkbox" checked={tight} onChange={(e) => setTight(e.target.checked)} />
          Tight framing (Dracula attack style)
        </label>
        <button
          type="button"
          onClick={() => setPreviewRunId((n) => n + 1)}
          style={{
            padding: "7px 12px",
            borderRadius: 8,
            background: "#23192d",
            color: "#f2eefe",
            border: "1px solid rgba(255,255,255,0.14)",
            cursor: "pointer",
          }}
        >
          Replay preview
        </button>
      </div>

      {(visualState === "defeated" || visualState === "knockdown") && monsterType !== "G" ? (
        <p style={{ margin: "0 0 8px", fontSize: "0.8rem", color: "#b8afc8" }}>
          {defeatPreviewMode === "sequence"
            ? "Preview mode: knockdown fall first, then final defeated pose."
            : "Preview mode: only the selected defeat state is played."}{" "}
          Current playback state: <code style={{ color: "#c4e8ff" }}>{playbackVisualState}</code>
        </p>
      ) : null}

      <p style={{ margin: "0 0 8px", fontSize: "0.82rem", fontFamily: "ui-monospace, monospace", color: "#7ec8ff" }}>
        {checking ? "Checking file…" : glbUrl ? `Loading: ${glbUrl}` : `Missing file: ${path}`}
      </p>

      <div
        style={{
          width: "100%",
          height: 320,
          maxHeight: "min(50vh, 360px)",
          borderRadius: 10,
          overflow: "hidden",
          background: "#08060c",
        }}
      >
        <Canvas
          style={{ width: "100%", height: "100%", display: "block" }}
          frameloop="always"
          dpr={[1, 2]}
          gl={{ antialias: true, alpha: false }}
          camera={{ position: [0, tight ? 0.95 : 1.05, tight ? 2.2 : 2.85], fov: 38, near: 0.1, far: 80 }}
          onCreated={({ gl }) => {
            gl.setClearColor("#08060c", 1);
          }}
        >
          <Suspense fallback={null}>
            {glbUrl ? (
              <Monster3dGltfSceneContent
                key={`${glbUrl}-${tight}-${mergedAttackVariant ?? "na"}-${demoHurtHp ? "hurt" : "nh"}-${previewRunId}`}
                url={glbUrl}
                visualState={playbackVisualState}
                tightFraming={tight}
                monsterType={monsterType}
                draculaAttackVariant={mergedAttackVariant}
                draculaHurtHp={demoHurtHp}
                onOneShotAnimationFinished={handleOneShotFinished}
              />
            ) : (
              <PlaceholderScene />
            )}
          </Suspense>
        </Canvas>
      </div>
    </section>
  );
}
