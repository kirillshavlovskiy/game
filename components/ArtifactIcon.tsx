"use client";

/** Artifact icon variants mapped to /artifacts/* assets */
export type ArtifactIconVariant =
  | "bomb"
  | "diamond"
  | "shield"
  | "magic"
  | "web"
  | "catapult"
  | "torch"
  | "trap";

const ARTIFACT_PATHS: Record<ArtifactIconVariant, string> = {
  bomb: "/artifacts/bmb.png",
  diamond: "/artifacts/diamond.png",
  shield: "/artifacts/shield.png",
  magic: "/artifacts/magic.png",
  web: "/artifacts/web.png",
  catapult: "/artifacts/ctplt.png",
  torch: "/artifacts/torch.PNG",
  trap: "/artifacts/trap.PNG",
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
