import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "@fontsource/creepster";
import { CrazyGamesSdk } from "@/components/CrazyGamesSdk";
import { MAZE_FLOOR_TEXTURE, MAZE_LITE_TEXTURES, MAZE_NOISE_TEXTURE, MAZE_WALL_TEXTURE } from "@/lib/mazeCellTheme";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dice Of The Damned",
  description: "Dice Of The Damned - 3D dice maze game",
  /** iOS: Share → Add to Home Screen opens in standalone mode (no Safari tabs). See `app/manifest.ts`. */
  appleWebApp: {
    capable: true,
    title: "Dice Of The Damned",
    statusBarStyle: "black-translucent",
  },
};

/** Safe areas + best-effort edge-to-edge on notched phones; pairs with `100dvh` / `-webkit-fill-available` in CSS. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0a0f",
};

/**
 * Root-relative `/textures/...` via `mazeCellTheme` URLs — required so `url()` works when Next bundles CSS under `/_next/static/css/`.
 * `./textures/...` would resolve relative to that CSS URL (404). For static export under a subpath only, set `basePath` / `assetPrefix`
 * or drive URLs from env in `mazeCellTheme`.
 */
const MAZE_TEXTURE_CSS_VARS_FULL = `
:root {
  --maze-wall-tex: url(${JSON.stringify(MAZE_WALL_TEXTURE)});
  --maze-floor-tex: url(${JSON.stringify(MAZE_FLOOR_TEXTURE)});
  --maze-noise-tex: url(${JSON.stringify(MAZE_NOISE_TEXTURE)});
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
        <meta name="mobile-web-app-capable" content="yes" />
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
