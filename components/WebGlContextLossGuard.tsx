"use client";

import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { reportClientEvent } from "@/lib/clientLogIngest";

/**
 * Prevents default page reload on context loss; after restore, invalidates R3F and optionally notifies the parent
 * so it can remount `<Canvas key=…>` (mixers / skinned meshes often need a full tree reset after GPU reset).
 */
export function WebGlContextLossGuard({ onContextRestored }: { onContextRestored?: () => void }) {
  const { gl, invalidate } = useThree();
  useEffect(() => {
    const canvas = gl.domElement;
    const onLost = (e: Event) => {
      e.preventDefault();
      reportClientEvent(
        "webgl.contextlost",
        "WebGL context lost (GPU reset / tab background / driver)",
        "warn",
        { canvasW: canvas.width, canvasH: canvas.height },
      );
    };
    const onRestored = () => {
      reportClientEvent("webgl.contextrestored", "WebGL context restored", "info");
      invalidate();
      onContextRestored?.();
    };
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
    return () => {
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
    };
  }, [gl, invalidate, onContextRestored]);
  return null;
}
