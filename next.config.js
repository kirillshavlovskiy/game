/** @type {import('next').NextConfig} */
const itchExport = process.env.ITCH_EXPORT === "1";

const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
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
