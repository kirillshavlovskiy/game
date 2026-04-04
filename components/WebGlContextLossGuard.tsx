"use client";

import { useEffect } from "react";
import { useThree } from "@react-three/fiber";

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
    };
    const onRestored = () => {
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
