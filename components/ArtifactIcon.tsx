"use client";

/** Artifact icon variants mapped to /artifacts/* assets */
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
  | "holyCross";

const ARTIFACT_PATHS: Record<ArtifactIconVariant, string> = {
  bomb: "/artifacts/bmb.PNG",
  diamond: "/artifacts/diamond.png",
  shield: "/artifacts/shield.png",
  magic: "/artifacts/teleport.PNG",
  web: "/artifacts/spider web.PNG",
  catapult: "/artifacts/ctplt.PNG",
  dice: "/artifacts/teleport.PNG",
  healing: "/artifacts/shield.png",
  reveal: "/artifacts/teleport.PNG",
  jump: "/artifacts/ctplt.PNG",
  torch: "/artifacts/torch.PNG",
  trap: "/artifacts/trap.PNG",
  holySword: "/artifacts/holy-sword.png",
  holyCross: "/artifacts/holy-cross.png",
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
