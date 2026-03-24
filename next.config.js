/** @type {import('next').NextConfig} */
const itchExport = process.env.ITCH_EXPORT === "1";

const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  /** Baked at build time so maze `url(...)` matches itch.io CDN paths (see `lib/mazeCellTheme.ts`). */
  env: {
    NEXT_PUBLIC_ITCH_STATIC: itchExport ? "1" : "0",
  },
  /** Set ITCH_EXPORT=1 for static HTML in `out/` (itch.io). Omit for Vercel / API routes. */
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
    return config;
  },
};

module.exports = nextConfig;
