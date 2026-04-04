import type { MonsterType } from "@/lib/labyrinth";
import { Monster3dAnimationsLabs } from "./Monster3dAnimationsLabs";
import { getMonsterName } from "@/lib/labyrinth";
import {
  getMonsterGltfPathForReference,
  getPreferredClipNamesForState,
  glbSlugFromPathOrUrl,
  MONSTER_3D_GLB_SLUG_BY_TYPE,
  MONSTER_3D_VISUAL_STATES,
  type Monster3DSpriteState,
} from "@/lib/monsterModels3d";

const DRACULA_TABLE_SLUG = "dracula";
const SKELETON_TABLE_SLUG = "skeleton";

function formatDraculaReferenceCell(state: Monster3DSpriteState) {
  const combatReadyIdleNote =
    state === "recover" ? (
      <p
        style={{
          margin: "8px 0 0",
          fontSize: "0.72rem",
          lineHeight: 1.45,
          opacity: 0.78,
          fontFamily: "system-ui, Segoe UI, sans-serif",
          color: "#c8b8d4",
        }}
      >
        <strong style={{ color: "#ddb8c4" }}>Combat nuance:</strong> merged 3D{" "}
        <code style={{ color: "#c4e8ff" }}>gltfVisualState</code> follows{" "}
        <code style={{ color: "#c4e8ff" }}>headerMonsterCombatState</code> (e.g. <code>hunt</code> between rolls when surprise
        stance is hunt) so hunt→strike crossfades work; 2D recover art can still differ when the header uses recover sprites.
      </p>
    ) : null;

  if (state === "hurt") {
    const exLight = getPreferredClipNamesForState("hurt", "V", DRACULA_TABLE_SLUG, undefined, { hp: 7, maxHp: 9 });
    const exMedium = getPreferredClipNamesForState("hurt", "V", DRACULA_TABLE_SLUG, undefined, { hp: 4, maxHp: 9 });
    const exHeavy = getPreferredClipNamesForState("hurt", "V", DRACULA_TABLE_SLUG, undefined, { hp: 3, maxHp: 9 });
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <code style={{ color: "#c4e8ff" }}>dracula.glb</code>
        <p style={{ margin: 0, fontSize: "0.72rem", opacity: 0.85, fontFamily: "system-ui, sans-serif", color: "#c8b8d4" }}>
          Clip order depends on <strong>HP / max</strong> after the strike (only when <code>gltfVisualState</code> is{" "}
          <code>hurt</code>, not <code>knockdown</code> at 1–2 HP):<br />
          <strong style={{ color: "#ddb8c4" }}>light</strong> — HP share &gt; ⅔ · <strong style={{ color: "#ddb8c4" }}>medium</strong> — &gt; ⅓ ·{" "}
          <strong style={{ color: "#ddb8c4" }}>heavy</strong> — ≤ ⅓ (still ≥ 3 HP).
        </p>
        <div style={{ fontSize: "0.78rem", opacity: 0.9, lineHeight: 1.35 }}>
          <div>
            <span style={{ color: "#ff9a8a" }}>light</span> (e.g. 7/9): {exLight.slice(0, 6).join(" → ")}…
          </div>
          <div style={{ marginTop: 6 }}>
            <span style={{ color: "#ff9a8a" }}>medium</span> (4/9): {exMedium.slice(0, 6).join(" → ")}…
          </div>
          <div style={{ marginTop: 6 }}>
            <span style={{ color: "#ff9a8a" }}>heavy</span> (3/9): {exHeavy.slice(0, 6).join(" → ")}…
          </div>
        </div>
      </div>
    );
  }

  if (state === "attack") {
    const spellClips = getPreferredClipNamesForState(state, "V", DRACULA_TABLE_SLUG, "spell");
    const skillClips = getPreferredClipNamesForState(state, "V", DRACULA_TABLE_SLUG, "skill");
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <code style={{ color: "#c4e8ff" }}>dracula.glb</code>
        <div>
          <span style={{ color: "#ff9a8a", fontWeight: 700, fontSize: "0.75rem" }}>spell first</span>
          <div style={{ marginTop: 4, fontSize: "0.8rem", opacity: 0.88, lineHeight: 1.35 }}>{spellClips.join(" → ")}</div>
        </div>
        <div>
          <span style={{ color: "#ff9a8a", fontWeight: 700, fontSize: "0.75rem" }}>skill first</span>
          <div style={{ marginTop: 4, fontSize: "0.8rem", opacity: 0.88, lineHeight: 1.35 }}>{skillClips.join(" → ")}</div>
        </div>
        <p style={{ margin: "8px 0 0", fontSize: "0.72rem", opacity: 0.78, fontFamily: "system-ui, sans-serif", color: "#c8b8d4" }}>
          Combat: <code style={{ color: "#c4e8ff" }}>combatFooterSnapshot.draculaAttackSegment</code> →{" "}
          <code style={{ color: "#c4e8ff" }}>MonsterModel3D</code> <code>draculaAttackVariant</code> (only for{" "}
          <code style={{ color: "#c4e8ff" }}>attack</code>, not <code style={{ color: "#c4e8ff" }}>angry</code>).
        </p>
      </div>
    );
  }

  if (state === "angry") {
    const clips = getPreferredClipNamesForState(state, "V", DRACULA_TABLE_SLUG);
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <code style={{ color: "#c4e8ff" }}>dracula.glb</code>
        <p style={{ margin: 0, fontSize: "0.72rem", opacity: 0.85, fontFamily: "system-ui, sans-serif", color: "#c8b8d4" }}>
          Surprise stance “angry”: 3D leads with <strong>Skill_01</strong>, then other strike-adjacent clips — not the same list as{" "}
          <code style={{ color: "#c4e8ff" }}>hunt</code> (which uses <strong>Mummy_Stagger</strong> first). 2D may still show{" "}
          <code style={{ color: "#c4e8ff" }}>hunt.png</code>.
        </p>
        <div style={{ fontSize: "0.8rem", opacity: 0.88, lineHeight: 1.35 }}>{clips.join(" → ")}</div>
      </div>
    );
  }
  const clips = getPreferredClipNamesForState(state, "V", DRACULA_TABLE_SLUG);
  return (
    <div>
      <code style={{ color: "#c4e8ff" }}>dracula.glb</code>
      <div style={{ marginTop: 4, fontSize: "0.8rem", opacity: 0.88, lineHeight: 1.35 }}>{clips.join(" → ")}</div>
      {combatReadyIdleNote}
    </div>
  );
}

/** Same layout as Dracula — merged `skeleton.glb` uses Meshy titles that match Dracula where names align (`Skill_01`, `Mummy_Stagger`, …). */
function formatSkeletonReferenceCell(state: Monster3DSpriteState) {
  const combatReadyIdleNote =
    state === "recover" ? (
      <p
        style={{
          margin: "8px 0 0",
          fontSize: "0.72rem",
          lineHeight: 1.45,
          opacity: 0.78,
          fontFamily: "system-ui, Segoe UI, sans-serif",
          color: "#c8b8d4",
        }}
      >
        <strong style={{ color: "#ddb8c4" }}>Combat nuance:</strong> between-strikes calm uses{" "}
        <code style={{ color: "#c4e8ff" }}>idle</code> + <strong>Idle_11</strong> (same pattern as Dracula’s{" "}
        <code style={{ color: "#c4e8ff" }}>Idle_6</code>).
      </p>
    ) : null;

  if (state === "hurt") {
    const exLight = getPreferredClipNamesForState("hurt", "K", SKELETON_TABLE_SLUG, undefined, { hp: 7, maxHp: 9 });
    const exMedium = getPreferredClipNamesForState("hurt", "K", SKELETON_TABLE_SLUG, undefined, { hp: 4, maxHp: 9 });
    const exHeavy = getPreferredClipNamesForState("hurt", "K", SKELETON_TABLE_SLUG, undefined, { hp: 3, maxHp: 9 });
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <code style={{ color: "#c4e8ff" }}>skeleton.glb</code>
        <p style={{ margin: 0, fontSize: "0.72rem", opacity: 0.85, fontFamily: "system-ui, sans-serif", color: "#c8b8d4" }}>
          HP-tiered hurt (same bands as Dracula); light flinch uses <strong>Face_Punch_Reaction_1</strong> (skeleton has no
          undecorated <code>Face_Punch_Reaction</code> in the Meshy set).
        </p>
        <div style={{ fontSize: "0.78rem", opacity: 0.9, lineHeight: 1.35 }}>
          <div>
            <span style={{ color: "#ff9a8a" }}>light</span> (e.g. 7/9): {exLight.slice(0, 8).join(" → ")}…
          </div>
          <div style={{ marginTop: 6 }}>
            <span style={{ color: "#ff9a8a" }}>medium</span> (4/9): {exMedium.slice(0, 8).join(" → ")}…
          </div>
          <div style={{ marginTop: 6 }}>
            <span style={{ color: "#ff9a8a" }}>heavy</span> (3/9): {exHeavy.slice(0, 8).join(" → ")}…
          </div>
        </div>
      </div>
    );
  }

  if (state === "attack") {
    const spellClips = getPreferredClipNamesForState(state, "K", SKELETON_TABLE_SLUG, "spell");
    const skillClips = getPreferredClipNamesForState(state, "K", SKELETON_TABLE_SLUG, "skill");
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <code style={{ color: "#c4e8ff" }}>skeleton.glb</code>
        <div>
          <span style={{ color: "#ff9a8a", fontWeight: 700, fontSize: "0.75rem" }}>spell first</span>
          <div style={{ marginTop: 4, fontSize: "0.8rem", opacity: 0.88, lineHeight: 1.35 }}>{spellClips.join(" → ")}</div>
        </div>
        <div>
          <span style={{ color: "#ff9a8a", fontWeight: 700, fontSize: "0.75rem" }}>skill first</span>
          <div style={{ marginTop: 4, fontSize: "0.8rem", opacity: 0.88, lineHeight: 1.35 }}>{skillClips.join(" → ")}</div>
        </div>
        <p style={{ margin: "8px 0 0", fontSize: "0.72rem", opacity: 0.78, fontFamily: "system-ui, sans-serif", color: "#c8b8d4" }}>
          Uses the same <code style={{ color: "#c4e8ff" }}>draculaAttackSegment</code> → <code>draculaAttackVariant</code> wiring
          as Dracula for strike alternation.
        </p>
      </div>
    );
  }

  if (state === "angry") {
    const clips = getPreferredClipNamesForState(state, "K", SKELETON_TABLE_SLUG);
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <code style={{ color: "#c4e8ff" }}>skeleton.glb</code>
        <p style={{ margin: 0, fontSize: "0.72rem", opacity: 0.85, fontFamily: "system-ui, sans-serif", color: "#c8b8d4" }}>
          Surprise stance: <strong>Skill_01</strong> first, then slash / spell clips — <strong>Alert</strong> and{" "}
          <strong>Left_Slash</strong> are skeleton-specific fills next to shared Dracula titles.
        </p>
        <div style={{ fontSize: "0.8rem", opacity: 0.88, lineHeight: 1.35 }}>{clips.join(" → ")}</div>
      </div>
    );
  }

  const clips = getPreferredClipNamesForState(state, "K", SKELETON_TABLE_SLUG);
  return (
    <div>
      <code style={{ color: "#c4e8ff" }}>skeleton.glb</code>
      <div style={{ marginTop: 4, fontSize: "0.8rem", opacity: 0.88, lineHeight: 1.35 }}>{clips.join(" → ")}</div>
      {combatReadyIdleNote}
    </div>
  );
}

function formatTypeReferenceClips(type: MonsterType, state: Monster3DSpriteState): string {
  const url = getMonsterGltfPathForReference(type, state);
  const slug = glbSlugFromPathOrUrl(url);
  return getPreferredClipNamesForState(state, type, slug).join(" → ");
}

export const metadata = {
  title: "Monster 3D — animation clip map",
  description:
    "Combat portrait states and glTF animation clip names the game tries to play (see lib/monsterModels3d.ts).",
  robots: { index: false, follow: false },
};

const MONSTER_TYPES_ORDER: MonsterType[] = ["V", "Z", "S", "G", "K", "L", "O"];

const STATE_NOTES: Record<Monster3DSpriteState, string> = {
  idle: "Calm portrait (e.g. player-initiated fight, or monster HP above ~⅓).",
  hunt: "Default threatening stance; also used for some “angry” lava paths in 2D.",
  attack: "Monster attacking / aggressive combat moment.",
  angry: "Harder surprise stance (monster chose attack/angry).",
  rolling: "While the d6 is rolling — mapped like attack for 3D clips.",
  hurt:
    "Monster took a hit (player won the roll). Dracula & skeleton 3D: reaction clip scales with HP left / max when tier data is passed (see table).",
  knockdown: "Heavy hit: monster left at 1–2 HP (falling segment before stand-up).",
  defeated: "Monster eliminated.",
  neutral: "Fallback / non-combat-ish label in some UI paths.",
  recover:
    "Weakened portrait when monster HP is in the low band (~≤⅓). Dracula: see table note — `ready` phase plays idle clip on same `dracula.glb`.",
};

export default function Monster3dAnimationsReferencePage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #0e0c10 0%, #1a1520 100%)",
        color: "#e8e4ec",
        fontFamily: "system-ui, Segoe UI, sans-serif",
        padding: "clamp(16px, 4vw, 40px)",
        lineHeight: 1.5,
      }}
    >
      <main style={{ maxWidth: 900, margin: "0 auto" }}>
        <h1 style={{ fontSize: "1.65rem", fontWeight: 700, marginBottom: 8, color: "#ffcba4" }}>
          Monster 3D — animation clip map
        </h1>
        <p style={{ marginBottom: 24, color: "#a89cb0", fontSize: "0.95rem" }}>
          With <code style={{ color: "#c4b8d4" }}>public/models/monsters/*.glb</code> and{" "}
          <code style={{ color: "#c4b8d4" }}>NEXT_PUBLIC_MONSTER_3D=1</code>, combat shows glTF. <strong>Dracula</strong> and{" "}
          <strong>skeleton</strong> each use one merged GLB; portrait state only changes which clip plays (cross-fades in{" "}
          <code style={{ color: "#c4b8d4" }}>MonsterModel3D</code>). Skeleton mapping mirrors Dracula where Meshy clip titles
          match, and substitutes similar moves otherwise (e.g. <code>Left_Slash</code> / <code>Triple_Combo_Attack</code>{" "}
          instead of <code>Jumping_Punch</code>). See <code style={{ color: "#c4b8d4" }}>lib/monsterModels3d.ts</code>.
        </p>
        <p style={{ marginBottom: 20, color: "#b8c8e8", fontSize: "0.9rem" }}>
          <strong>Below:</strong> <em>Live 3D preview</em> — monster type + portrait state (and attack priority on merged rigs).{" "}
          <em>Combat face-off lab</em> — <strong>monster</strong> + <strong>scenario</strong> menus, optional{" "}
          <strong>player weapon</strong> GLB (same paths as in-game armour, hand-attached like combat 3D); spacing and clip
          sync come from <code style={{ color: "#c4b8d4" }}>lib/combat3dContact.ts</code> (idle → hunt → fight).
        </p>

        <div
          style={{
            marginBottom: 20,
            padding: "12px 14px",
            borderRadius: 10,
            background: "rgba(180, 60, 60, 0.12)",
            border: "1px solid rgba(255,120,100,0.35)",
            fontSize: "0.88rem",
            color: "#ddb8c4",
          }}
        >
          <strong style={{ color: "#ff9a8a" }}>Dev server broken?</strong> If you see{" "}
          <code style={{ color: "#f0c0c0" }}>Cannot find module &apos;./XXX.js&apos;</code> or 500s on{" "}
          <code style={{ color: "#f0c0c0" }}>/_next/static/...</code>, stop the server and run:{" "}
          <code style={{ color: "#f0c0c0" }}>rm -rf .next && npm run dev</code> (stale webpack chunks after upgrades or
          interrupted builds).
        </div>

        <Monster3dAnimationsLabs />

        <h2 style={{ fontSize: "1.15rem", marginBottom: 12, color: "#b8f0c8" }}>Portrait state → GLB + clip priority</h2>
        <div style={{ overflowX: "auto", marginBottom: 36 }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "0.88rem",
              background: "rgba(0,0,0,0.35)",
              borderRadius: 10,
              overflow: "hidden",
            }}
          >
            <thead>
              <tr style={{ background: "rgba(255,152,103,0.12)", textAlign: "left" }}>
                <th style={{ padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.08)", minWidth: 88 }}>
                  State
                </th>
                <th style={{ padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.08)", minWidth: 200 }}>
                  In combat UI (summary)
                </th>
                <th style={{ padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.08)", minWidth: 220 }}>
                  Dracula <code style={{ color: "#c4b8d4" }}>(V)</code> — <code>dracula.glb</code>
                </th>
                <th style={{ padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.08)", minWidth: 220 }}>
                  Skeleton <code style={{ color: "#c4b8d4" }}>(K)</code> — <code>skeleton.glb</code>
                </th>
                <th style={{ padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.08)", minWidth: 200 }}>
                  Zombie <code style={{ color: "#c4b8d4" }}>(Z)</code> — <code>zombie.glb</code>
                </th>
                <th style={{ padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.08)", minWidth: 160 }}>
                  Generic fallback only
                </th>
              </tr>
            </thead>
            <tbody>
              {MONSTER_3D_VISUAL_STATES.map((state) => (
                <tr key={state} style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  <td style={{ padding: "10px 12px", verticalAlign: "top", fontWeight: 600, color: "#7ec8ff" }}>
                    <code>{state}</code>
                  </td>
                  <td style={{ padding: "10px 12px", verticalAlign: "top", color: "#b8afc8" }}>
                    {STATE_NOTES[state]}
                  </td>
                  <td style={{ padding: "10px 12px", verticalAlign: "top", fontFamily: "ui-monospace, monospace" }}>
                    {formatDraculaReferenceCell(state)}
                  </td>
                  <td style={{ padding: "10px 12px", verticalAlign: "top", fontFamily: "ui-monospace, monospace" }}>
                    {formatSkeletonReferenceCell(state)}
                  </td>
                  <td style={{ padding: "10px 12px", verticalAlign: "top", fontFamily: "ui-monospace, monospace" }}>
                    {formatTypeReferenceClips("Z", state)}
                  </td>
                  <td style={{ padding: "10px 12px", verticalAlign: "top", fontFamily: "ui-monospace, monospace", opacity: 0.85 }}>
                    {getPreferredClipNamesForState(state).join(" → ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2 style={{ fontSize: "1.15rem", marginBottom: 12, color: "#b8f0c8" }}>Monster type → GLB file</h2>
        <div style={{ overflowX: "auto", marginBottom: 16 }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "0.88rem",
              background: "rgba(0,0,0,0.35)",
              borderRadius: 10,
              overflow: "hidden",
            }}
          >
            <thead>
              <tr style={{ background: "rgba(255,152,103,0.12)", textAlign: "left" }}>
                <th style={{ padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>Type</th>
                <th style={{ padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>Name</th>
                <th style={{ padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>Expected path</th>
              </tr>
            </thead>
            <tbody>
              {MONSTER_TYPES_ORDER.map((t) => (
                <tr key={t} style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  <td style={{ padding: "10px 12px" }}>
                    <code>{t}</code>
                  </td>
                  <td style={{ padding: "10px 12px", color: "#b8afc8" }}>{getMonsterName(t)}</td>
                  <td style={{ padding: "10px 12px", fontFamily: "ui-monospace, monospace", verticalAlign: "top" }}>
                    {t === "V" ? (
                      <span style={{ color: "#ddb8c4" }}>
                        <code style={{ color: "#c4e8ff" }}>/models/monsters/dracula.glb</code> (merged Meshy clips). Optional
                        segment exports under <code style={{ color: "#c4e8ff" }}>dracula-*.glb</code> for Blender/pipeline only
                        — not loaded by the game.
                      </span>
                    ) : t === "K" ? (
                      <span style={{ color: "#ddb8c4" }}>
                        <code style={{ color: "#c4e8ff" }}>/models/monsters/skeleton.glb</code> — merged Meshy biped (Blender:{" "}
                        <code style={{ color: "#c4e8ff" }}>blender_merge_skeleton_animation_glbs.py</code> +{" "}
                        <code style={{ color: "#c4e8ff" }}>retarget-glb-animation-nodes.mjs</code>).
                      </span>
                    ) : (
                      <>/models/monsters/{MONSTER_3D_GLB_SLUG_BY_TYPE[t]}.glb</>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p style={{ fontSize: "0.9rem", color: "#7a7088" }}>
          In real combat: enable <code>NEXT_PUBLIC_MONSTER_3D=1</code>, add the matching <code>.glb</code>, then fight a
          monster — the portrait uses the same states as this table.
        </p>
        <p style={{ marginTop: 16 }}>
          <a href="/" style={{ color: "#ff9867" }}>
            ← Back to game
          </a>
        </p>
      </main>
    </div>
  );
}
