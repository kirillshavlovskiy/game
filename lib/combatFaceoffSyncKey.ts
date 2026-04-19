/**
 * Face-off **paired sync key** contract (`CombatFaceOffPairedSubjects` + `PositionedGltfSubject` in
 * `components/MonsterModel3D.tsx`):
 *
 * **Purpose:** When this string changes, `syncBase` bumps → gate reset → `animationSyncKey` changes →
 * `syncKeyBump` can restart mixers (short fade / full clip from t=0). Only embed fields that **must** force a
 * deliberate re-pair (new encounter, lab replay, tier/weapon used for attachment or clip try-order).
 *
 * **Forbidden:** Monster/player visual states (`idle` / `attack` / `defeated` / …), `rollingApproachBlend`, canvas
 * pixel width — those update every beat or on layout; they belong in `combatFaceOffPositions` and
 * `resolveCombat3dClipLeads`, not here.
 *
 * **Tuning workflow:** Edit separation and lead-ins in `lib/combat3dContact.ts`, verify spacing and timing in
 * `/monster-3d-animations` (`Monster3dContactPairLab`), then ship — production combat reads the same matrices.
 */

/** Stable token for every “tail” segment while the outcome modal is open (`!combatState && combatResult`). */
export const COMBAT_POST_FACEOFF_SYNC_FREEZE_TOKEN = "postCombat";

export type Combat3dFaceOffSyncKeyParts = {
  /**
   * Stable encounter id for the **whole** fight + outcome modal — must **not** switch when `combatState` clears
   * (e.g. `enc-${sessionId}-${monsterIndex}-${monsterType}-${playerIndex}`). A `live-` / `post-` swap was bumping
   * `CombatFaceOffPairedSubjects` and replaying the finisher under bonus loot.
   */
  sessionPrefix: string;
  monsterType: string;
  playerIndex: number;
  /** When true, all tier/footer/weapon/cycle segments are frozen — no replay on footer dismiss or prop churn. */
  postCombatFreeze: boolean;
  monsterDraculaVariant: string | null | undefined;
  playerAttackVariantForClipLeads: string | null | undefined;
  combatStrikePickDuringRoll: boolean;
  draculaHurtHpStr: string;
  fatalJumpSegment: string;
  strikePortrait: string;
  playerRoll: string;
  strikeTargetPick: string;
  playerAttackClipCycleIndex: number;
  combatWeaponPath: string;
  combatOffhandArmourPath: string;
};

/**
 * Builds the `faceOffAnimationSyncKey` string for merged 3D combat in `LabyrinthGame` (must stay byte-stable for the
 * whole post-fight window when `postCombatFreeze` is true).
 */
export function buildCombat3dFaceOffSyncKey(p: Combat3dFaceOffSyncKeyParts): string {
  const fz = p.postCombatFreeze;
  const tail = COMBAT_POST_FACEOFF_SYNC_FREEZE_TOKEN;
  return [
    p.sessionPrefix,
    p.monsterType,
    String(p.playerIndex),
    fz ? tail : (p.monsterDraculaVariant ?? "na"),
    fz ? tail : (p.playerAttackVariantForClipLeads ?? "na"),
    fz ? tail : p.combatStrikePickDuringRoll ? "sp1" : "sp0",
    fz ? tail : p.draculaHurtHpStr,
    fz ? tail : p.fatalJumpSegment,
    fz ? tail : p.strikePortrait,
    fz ? tail : p.playerRoll,
    fz ? tail : p.strikeTargetPick,
    fz ? tail : String(p.playerAttackClipCycleIndex),
    fz ? tail : p.combatWeaponPath,
    fz ? tail : p.combatOffhandArmourPath,
  ].join("|");
}

export type ContactPairLabFaceOffSyncKeyParts = {
  monsterType: string;
  playerVariant: string;
  monsterVariant: string;
  strikePick: boolean;
  showMonsterHurtTier: boolean;
  hurtHp: number;
  hurtMax: number;
  fatalJump: boolean;
  replayNonce: number;
  draculaHurtAim: string;
  draculaMonsterAttackAim: string;
  playerHurtClipSource: string;
  labPlayerWeaponGlb: string;
  labPlayerOffhandGlb: string;
  labWeaponHand: string;
  labBladeTwistPreset: string;
  labExtraEulerCsv: string;
  labGripPosCsv: string;
  labOffhandBladeTwistPreset: string;
  labOffhandExtraEulerCsv: string;
  labOffhandGripPosCsv: string;
};

/** Same segment order as `Monster3dContactPairLab` `faceOffAnimationSyncKey` useMemo (do not reorder silently). */
export function buildContactPairLabFaceOffSyncKey(p: ContactPairLabFaceOffSyncKeyParts): string {
  return [
    p.monsterType,
    p.playerVariant,
    p.monsterVariant,
    p.strikePick ? "1" : "0",
    p.showMonsterHurtTier ? `${p.hurtHp}/${p.hurtMax}` : "x",
    p.fatalJump ? "1" : "0",
    String(p.replayNonce),
    p.draculaHurtAim,
    p.draculaMonsterAttackAim,
    p.playerHurtClipSource,
    p.labPlayerWeaponGlb,
    p.labPlayerOffhandGlb,
    p.labWeaponHand,
    p.labBladeTwistPreset,
    p.labExtraEulerCsv,
    p.labGripPosCsv,
    p.labOffhandBladeTwistPreset,
    p.labOffhandExtraEulerCsv,
    p.labOffhandGripPosCsv,
  ].join("|");
}
