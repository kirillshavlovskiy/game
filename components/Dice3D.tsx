"use client";

import { useEffect, useRef, useImperativeHandle, forwardRef } from "react";

export interface Dice3DRef {
  roll: () => Promise<number>;
}

export interface Dice3DProps {
  onRollComplete: (value: number) => void;
  disabled?: boolean;
}

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
  function Dice3D({ onRollComplete, disabled = false }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const diceBoxRef = useRef<{
      roll: (notation: string) => Promise<unknown>;
    } | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        roll: async () => {
          const box = diceBoxRef.current;
          if (!box || disabled) {
            const fallback = Math.floor(Math.random() * 6) + 1;
            onRollComplete(fallback);
            return fallback;
          }

          try {
            const result = await box.roll("1d6");
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
      [onRollComplete, disabled]
    );

    useEffect(() => {
      if (!containerRef.current) return;
      let mounted = true;

      const initDice = async () => {
        const el = containerRef.current;
        if (!el || !mounted) return;
        el.id = "dice-scene-" + Math.random().toString(36).slice(2);
        const id = el.id;

        // Wait for container to have dimensions (layout complete)
        await new Promise<void>((resolve) => {
          if (el.clientWidth > 0 && el.clientHeight > 0) {
            resolve();
            return;
          }
          const check = () => {
            if (!mounted || !containerRef.current) return;
            if (el.clientWidth > 0 && el.clientHeight > 0) resolve();
            else requestAnimationFrame(check);
          };
          requestAnimationFrame(check);
        });

        if (!mounted) return;

        const { default: DiceBox } = await import("@3d-dice/dice-box-threejs");
        if (!mounted) return;

        // Ensure element is still in DOM (React Strict Mode may have unmounted)
        const target = document.getElementById(id);
        if (!target || !mounted) return;

        const box = new DiceBox("#" + id, {
          assetPath: "https://cdn.jsdelivr.net/gh/MajorVictory/3DDiceRoller@master/textures/envmap/",
          theme_surface: "taverntable",
          theme_material: "glass",
          theme_customColorset: { background: "#00ff88", foreground: "#000000", outline: "#00ff88" },
          sounds: false,
          shadows: true,
          baseScale: 100,
          strength: 1.2,
        });
        await box.initialize();
        if (mounted) diceBoxRef.current = box;
      };

      initDice();
      return () => {
        mounted = false;
        diceBoxRef.current = null;
      };
    }, []);

    return (
      <div className="dice-tray" style={{ position: "relative", width: "100%", minWidth: 0 }}>
        <div
          ref={containerRef}
          className="dice-container"
          style={{
            width: "100%",
            minWidth: 0,
            minHeight: 120,
            height: 120,
            borderRadius: 12,
            overflow: "hidden",
            background: "#0d0d12",
            pointerEvents: disabled ? "none" : "auto",
            opacity: disabled ? 0.6 : 1,
          }}
        />
        <span
          className="hint"
          style={{
            position: "absolute",
            bottom: "0.5rem",
            left: 0,
            right: 0,
            textAlign: "center",
            fontSize: "0.7rem",
            color: "#555",
          }}
        >
          Click dice area or &quot;Roll dice&quot; button
        </span>
      </div>
    );
  }
);

export default Dice3D;
