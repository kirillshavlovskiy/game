"use client";

import { useEffect, useRef, useImperativeHandle, forwardRef, type CSSProperties } from "react";

export interface Dice3DRef {
  roll: () => Promise<number>;
}

/** Internal dice-box API we need for layout sync (not in package typings). */
type DiceBoxInstance = {
  roll: (notation: string) => Promise<unknown>;
  initialize: () => Promise<void>;
  setDimensions: (size: { x: number; y: number }) => void;
};

export interface Dice3DProps {
  onRollComplete: (value: number) => void;
  disabled?: boolean;
  /** Fill parent (needs explicit parent height); avoids gap below fixed 120px canvas */
  fitContainer?: boolean;
  /** Hide overlay hint (e.g. when parent shows instructions) */
  hideHint?: boolean;
}

/** Base URL for `public/dice-roller/` (works on itch subpaths via relative resolution). */
function getDiceRollerAssetBase(): string {
  if (typeof window === "undefined") return "/dice-roller/";
  return new URL("./dice-roller/", window.location.href).href;
}

/** WebGL viewport chrome: original dark grey behind the canvas */
const DICE_VIEWPORT_BG = "#10080a";

/**
 * Solid plastic d6 (`texture: "none"`). Faces: darker coral→ember (same family as menu title `#ff9867` → `#8e2215`).
 */
const DICE_OF_THE_DAMNED_COLORSET = {
  name: "dice-of-the-damned",
  foreground: "#ffffff",
  background: [
    "#d97850",
    "#c26a44",
    "#ae5d3a",
    "#964d31",
    "#7f3e28",
    "#5c140c",
  ],
  outline: "#2a0c08",
  texture: "none",
  material: "plastic",
} as const;

function getValueFromResult(result: unknown): number {
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    // dice-box-threejs returns { sets: [{ rolls: [{ value: N }, ...] }] }
    const sets = r.sets as Array<{ rolls?: Array<{ value?: number }> }> | undefined;
    if (Array.isArray(sets) && sets[0]?.rolls?.[0]) {
      const v = sets[0].rolls[0].value;
      if (typeof v === "number") return Math.min(6, Math.max(1, v));
    }
    if (Array.isArray(r.values)) return Math.min(6, Math.max(1, r.values[0] ?? 1));
    if (Array.isArray(r.dice)) {
      const v = (r.dice[0] as { value?: number })?.value;
      if (typeof v === "number") return Math.min(6, Math.max(1, v));
    }
    if (Array.isArray(r.rolls)) {
      const v = (r.rolls[0] as { value?: number })?.value;
      if (typeof v === "number") return Math.min(6, Math.max(1, v));
    }
  }
  return 1;
}

const Dice3D = forwardRef<Dice3DRef, Dice3DProps>(
  function Dice3D({ onRollComplete, disabled = false, fitContainer = false, hideHint = false }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const diceBoxRef = useRef<DiceBoxInstance | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        /** Always runs the roll — parent gates via button state. `disabled` is visual/pointer-events only; deferring roll (e.g. mobile rAF after setRolling) would otherwise see disabled=true and skip onRollComplete. */
        roll: async () => {
          const box = diceBoxRef.current;
          if (!box) {
            const fallback = Math.floor(Math.random() * 6) + 1;
            onRollComplete(fallback);
            return fallback;
          }

          try {
            /** `dpip` = same physics as d6, faces drawn with pips (●) instead of digits */
            const result = await box.roll("1dpip");
            const v = getValueFromResult(result);
            onRollComplete(v);
            return v;
          } catch {
            const fallback = Math.floor(Math.random() * 6) + 1;
            onRollComplete(fallback);
            return fallback;
          }
        },
      }),
      [onRollComplete]
    );

    useEffect(() => {
      if (!containerRef.current) return;
      let mounted = true;
      let resizeObserver: ResizeObserver | null = null;

      const initDice = async () => {
        const el = containerRef.current;
        if (!el || !mounted) return;
        el.id = "dice-scene-" + Math.random().toString(36).slice(2);
        const id = el.id;

        // Wait for container to have dimensions (layout complete), with timeout to prevent infinite loop
        const DIMENSION_WAIT_MS = 3000;
        const start = Date.now();
        await new Promise<void>((resolve) => {
          if (el.clientWidth > 0 && el.clientHeight > 0) {
            resolve();
            return;
          }
          const check = () => {
            if (!mounted || !containerRef.current) return;
            if (el.clientWidth > 0 && el.clientHeight > 0) {
              resolve();
              return;
            }
            if (Date.now() - start > DIMENSION_WAIT_MS) resolve(); // Proceed anyway to avoid infinite loop
            else requestAnimationFrame(check);
          };
          requestAnimationFrame(check);
        });

        if (!mounted) return;

        // Ensure minimum dimensions for WebGL canvas (avoids init failure when parent was hidden)
        if (el.clientWidth < 100 || el.clientHeight < 100) {
          el.style.minWidth = "120px";
          el.style.minHeight = "120px";
          el.style.width = "120px";
          el.style.height = "120px";
          await new Promise((r) => requestAnimationFrame(r)); // Let layout apply
        }

        const { default: DiceBox } = await import("@3d-dice/dice-box-threejs");
        if (!mounted) return;

        // Ensure element is still in DOM (React Strict Mode may have unmounted)
        const target = document.getElementById(id);
        if (!target || !mounted) return;

        const box = new DiceBox("#" + id, {
          assetPath: getDiceRollerAssetBase(),
          theme_surface: "mahogany",
          theme_material: "plastic",
          theme_customColorset: { ...DICE_OF_THE_DAMNED_COLORSET },
          color_spotlight: 0xff9867,
          light_intensity: 1.15,
          sounds: false,
          shadows: true,
          baseScale: 100,
          strength: 1.2,
        }) as unknown as DiceBoxInstance;
        try {
          await box.initialize();
        } catch (e) {
          console.error("Dice3D: dice-box initialize failed", e);
          return;
        }
        if (!mounted || !el.isConnected) return;

        diceBoxRef.current = box;

        const syncDimensions = () => {
          const node = containerRef.current;
          const b = diceBoxRef.current;
          if (!node || !b) return;
          const w = node.clientWidth;
          const h = node.clientHeight;
          if (w < 2 || h < 2) return;
          b.setDimensions({ x: w, y: h });
        };

        syncDimensions();
        resizeObserver = new ResizeObserver(() => {
          requestAnimationFrame(syncDimensions);
        });
        resizeObserver.observe(el);
      };

      void initDice();
      return () => {
        mounted = false;
        resizeObserver?.disconnect();
        resizeObserver = null;
        diceBoxRef.current = null;
      };
    }, []);

    const trayStyle: React.CSSProperties = fitContainer
      ? {
          position: "relative",
          width: "100%",
          minWidth: 0,
          height: "100%",
          minHeight: 0,
          flex: 1,
          display: "flex",
          flexDirection: "column",
        }
      : { position: "relative", width: "100%", minWidth: 0 };

    const containerStyle: CSSProperties = {
      width: "100%",
      minWidth: 0,
      borderRadius: 10,
      overflow: "hidden",
      background: DICE_VIEWPORT_BG,
      pointerEvents: disabled ? "none" : "auto",
      opacity: disabled ? 0.6 : 1,
      ...(fitContainer
        ? { flex: 1, minHeight: 100, height: "100%" }
        : { minHeight: 120, height: 120 }),
    };

    return (
      <div className="dice-tray" style={trayStyle}>
        <div ref={containerRef} className="dice-container" style={containerStyle} />
        {!hideHint && (
          <span
            className="hint"
            style={{
              position: "absolute",
              bottom: "0.5rem",
              left: 0,
              right: 0,
              textAlign: "center",
              fontSize: "0.7rem",
              color: "#888",
            }}
          >
            Click dice area or &quot;Roll dice&quot; button
          </span>
        )}
      </div>
    );
  }
);

export default Dice3D;
