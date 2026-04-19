"use client";

import { Monster3dContactPairLab } from "@/components/Monster3dContactPairLab";
import { Monster3dReferenceViewer } from "@/components/Monster3dReferenceViewer";

/**
 * Client bundle for `/monster-3d-animations`: no `next/dynamic` wrapper so controls mount immediately
 * (avoids an empty or stuck “Loading 3D preview…” shell).
 *
 * **Face-off tuning:** spacing and clip lead-ins come from `lib/combat3dContact.ts` (`resolveCombat3dClipLeads`,
 * contact matrices). The contact lab below uses `buildContactPairLabFaceOffSyncKey` from `lib/combatFaceoffSyncKey.ts`
 * — production combat uses `buildCombat3dFaceOffSyncKey` with the same contract (no visual states / approach blend in
 * the key; post-fight modal freezes the tail so clips are not replayed).
 */
export function Monster3dAnimationsLabs() {
  return (
    <>
      <Monster3dReferenceViewer />
      <Monster3dContactPairLab />
    </>
  );
}
