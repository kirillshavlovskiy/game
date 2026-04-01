"use client";

import { Monster3dContactPairLab } from "@/components/Monster3dContactPairLab";
import { Monster3dReferenceViewer } from "@/components/Monster3dReferenceViewer";

/**
 * Client bundle for `/monster-3d-animations`: no `next/dynamic` wrapper so controls mount immediately
 * (avoids an empty or stuck “Loading 3D preview…” shell).
 */
export function Monster3dAnimationsLabs() {
  return (
    <>
      <Monster3dReferenceViewer />
      <Monster3dContactPairLab />
    </>
  );
}
