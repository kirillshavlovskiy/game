"use client";

/** Artifact icon variants mapped to `public/artifacts/*` (relative URLs for itch.io subpaths). */
export type ArtifactIconVariant =
  | "bomb"
  | "diamond"
  | "shield"
  | "magic"
  | "web"
  | "catapult"
  | "dice"
  | "healing"
  | "reveal"
  | "jump"
  | "torch"
  | "trap"
  | "holySword"
  | "holyCross"
  | "artifact"; // Generic artifact/box (treasure from monster bonus)

const ARTIFACT_PATHS: Record<ArtifactIconVariant, string> = {
  bomb: "artifacts/bmb.PNG",
  diamond: "artifacts/diamond.png",
  shield: "artifacts/shield.png",
  magic: "artifacts/teleport.PNG",
  web: "artifacts/spider web.PNG",
  catapult: "artifacts/ctplt.PNG",
  dice: "artifacts/teleport.PNG",
  healing: "artifacts/shield.png",
  reveal: "artifacts/teleport.PNG",
  jump: "artifacts/ctplt.PNG",
  torch: "artifacts/torch.PNG",
  trap: "artifacts/trap.PNG",
  holySword: "artifacts/holy-sword.png",
  holyCross: "artifacts/holy-cross.png",
  artifact: "artifacts/diamond.png",
};

/** Emoji-based artifact rows (🎲 ❤️) only — keeps custom /artifacts images at full size */
const EMOJI_ARTIFACT_SCALE = 0.5;

interface ArtifactIconProps {
  variant: ArtifactIconVariant;
  size?: number;
  style?: React.CSSProperties;
  title?: string;
  opacity?: number;
  className?: string;
}

export function ArtifactIcon({ variant, size = 28, style, title, opacity = 1, className }: ArtifactIconProps) {
  // Dice: use emoji 🎲 (clear combat affordance; dice asset may be shared placeholder)
  if (variant === "dice") {
    return (
      <span
        role="img"
        aria-label="dice"
        title={title}
        className={className}
        style={{
          fontSize: size * 0.9 * EMOJI_ARTIFACT_SCALE,
          lineHeight: 1,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: size,
          height: size,
          opacity,
          ...style,
        }}
      >
        🎲
      </span>
    );
  }
  if (variant === "healing") {
    return (
      <span
        role="img"
        aria-label="healing"
        title={title}
        className={className}
        style={{
          fontSize: size * 0.92 * EMOJI_ARTIFACT_SCALE,
          lineHeight: 1,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: size,
          height: size,
          opacity,
          ...style,
        }}
      >
        ❤️
      </span>
    );
  }
  return (
    <img
      src={ARTIFACT_PATHS[variant]}
      alt={variant}
      title={title}
      className={className}
      style={{
        width: size,
        height: size,
        objectFit: "contain",
        display: "inline-block",
        verticalAlign: "middle",
        opacity,
        ...style,
      }}
    />
  );
}
