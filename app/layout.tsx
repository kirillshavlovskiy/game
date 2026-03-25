import type { Metadata } from "next";
import Script from "next/script";
import "@fontsource/creepster";
import { CrazyGamesSdk } from "@/components/CrazyGamesSdk";
import { MAZE_LITE_TEXTURES } from "@/lib/mazeCellTheme";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dice Of The Damned",
  description: "Dice Of The Damned - 3D dice maze game",
};

/** Inline so `url()` resolves from the HTML document (portal subpaths). Linked CSS would resolve from `/_next/static/`. */
const MAZE_TEXTURE_CSS_VARS_FULL = `
:root {
  --maze-wall-tex: url("./textures/maze/Stone/Horror_Stone_02-256x256.png");
  --maze-floor-tex: url("./textures/maze/Brick/Horror_Brick_07-256x256.png");
  --maze-noise-tex: url("./textures/maze/noise_grain.png");
}
`;

/** Lite build: no PNG fetches — grain overlay uses CSS-only fallback in `globals.css`. */
const MAZE_TEXTURE_CSS_VARS_LITE = `
:root {
  --maze-wall-tex: none;
  --maze-floor-tex: none;
  --maze-noise-tex: none;
}
`;

const MAZE_TEXTURE_CSS_VARS = MAZE_LITE_TEXTURES ? MAZE_TEXTURE_CSS_VARS_LITE : MAZE_TEXTURE_CSS_VARS_FULL;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: MAZE_TEXTURE_CSS_VARS }} />
        {/**
         * Official URL — CrazyGames requires this for automatic SDK updates (see portal checklist).
         * No npm package: HTML5 v3 is browser-only; `CrazyGamesSdk` reads `window.CrazyGames.SDK` after load.
         * Offline / self-host fallback: vendor to `public/crazygames-sdk-v3.js` and point `src` at `./crazygames-sdk-v3.js`.
         */}
        <Script src="https://sdk.crazygames.com/crazygames-sdk-v3.js" strategy="beforeInteractive" />
      </head>
      <body>
        <CrazyGamesSdk />
        {children}
      </body>
    </html>
  );
}
