/** @type {import('next').NextConfig} */
const path = require("path");

const itchExport = process.env.ITCH_EXPORT === "1";
/**
 * Crazy Games **lite** HTML5 zip only (`npm run build:crazygames-lite`). Do not set for Vercel, dev, or itch.io.
 * Inlined as `NEXT_PUBLIC_CRAZYGAMES_LITE` so random `.env` keys cannot enable gradient-only maze on other builds.
 */
const crazygamesMazeLiteBuild = process.env.CRAZYGAMES_LITE === "1";

const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  env: {
    NEXT_PUBLIC_CRAZYGAMES_LITE: crazygamesMazeLiteBuild ? "1" : "0",
    /** Root `/textures/...` for dev & Vercel; `./textures/...` for `ITCH_EXPORT` static zip (subpath hosts). */
    NEXT_PUBLIC_MAZE_TEXTURE_PREFIX: itchExport ? "./" : "/",
  },
  /** Set ITCH_EXPORT=1 for static HTML in `out/` (itch.io / Crazy Games HTML5). Omit for Vercel / API routes. */
  ...(itchExport
    ? {
        output: "export",
        trailingSlash: true,
        /** Relative `_next` URLs so the game loads when hosted under a subpath (itch.io HTML5). */
        assetPrefix: "./",
      }
    : {}),
  webpack: (config, { dev }) => {
    if (dev) config.cache = false;
    /** One `three` instance for app + @react-three/* + dice-box-threejs (avoids cross-realm Object3D / duplicate WebGL load). */
    config.resolve.alias = {
      ...config.resolve.alias,
      three: path.resolve(__dirname, "node_modules/three"),
    };
    return config;
  },
};

module.exports = nextConfig;
