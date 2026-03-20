"use client";

/** Artifact icon variants mapped to /artifacts/*.png assets */
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
  | "jump";

const ARTIFACT_PATHS: Record<ArtifactIconVariant, string> = {
  bomb: "/artifacts/bomb.png",
  diamond: "/artifacts/diamond.png",
  shield: "/artifacts/shield.png",
  magic: "/artifacts/magic.png",
  web: "/artifacts/web.png",
  catapult: "/artifacts/catapult.png",
  dice: "/artifacts/magic.png",
  healing: "/artifacts/magic.png",
  reveal: "/artifacts/magic.png",
  jump: "/artifacts/magic.png",
};

interface ArtifactIconProps {
  variant: ArtifactIconVariant;
  size?: number;
  style?: React.CSSProperties;
  title?: string;
  opacity?: number;
  className?: string;
}

export function ArtifactIcon({ variant, size = 28, style, title, opacity = 1, className }: ArtifactIconProps) {
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
