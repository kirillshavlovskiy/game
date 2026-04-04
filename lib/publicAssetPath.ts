/**
 * itch.io HTML5 hosts the game at `https://html.itch.zone/html/<id>/` (or similar).
 * Root-absolute paths like `/models/foo.glb` resolve to `https://html.itch.zone/models/...`
 * and return **403**. Use `./models/...` so requests stay under the upload root.
 *
 * Set only for static export (`ITCH_EXPORT=1` → `next.config.js`).
 */
export function publicAssetPath(relativeFromPublicRoot: string): string {
  const p = relativeFromPublicRoot.replace(/^\//, "");
  if (process.env.NEXT_PUBLIC_RELATIVE_PUBLIC_ASSETS === "1") {
    return `./${p}`;
  }
  return `/${p}`;
}
