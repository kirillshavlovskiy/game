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
          if (!box || disabled) return 1;

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

      const initDice = async () => {
        const el = containerRef.current;
        if (!el) return;
        el.id = "dice-scene-" + Math.random().toString(36).slice(2);
        const id = el.id;
        const { default: DiceBox } = await import("@3d-dice/dice-box-threejs");
        const box = new DiceBox("#" + id, {
          theme_surface: "green-felt",
          theme_material: "glass",
          theme_colorset: "white",
          sounds: false,
          shadows: true,
          baseScale: 100,
          strength: 1.2,
        });
        diceBoxRef.current = box;
      };

      initDice();
      return () => {
        diceBoxRef.current = null;
      };
    }, []);

    return (
      <div className="dice-tray" style={{ position: "relative" }}>
        <div
          ref={containerRef}
          style={{
            width: "100%",
            minHeight: 140,
            height: 140,
            borderRadius: 12,
            overflow: "hidden",
            background: "#0d0d12",
            border: "1px solid #333",
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
