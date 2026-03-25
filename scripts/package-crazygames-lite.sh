#!/usr/bin/env bash
# Crazy Games HTML5 **only**: `CRAZYGAMES_LITE=1` (via `npm run build:crazygames-lite`) — gradient maze, no textures/maze in zip.
# Not used for itch.io or Vercel. Strips `out/textures/maze` after build, then zips.
# Upload dist/creep-labyrinth-crazygames-lite.zip — same flow as package:crazygames.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
npm run build:crazygames-lite
rm -rf out/textures/maze
mkdir -p dist
OUT_ZIP="dist/creep-labyrinth-crazygames-lite.zip"
rm -f "$OUT_ZIP"
(cd out && zip -q -r "../$OUT_ZIP" . -x "*.DS_Store")
echo "Created $OUT_ZIP ($(du -h "$OUT_ZIP" | cut -f1)) — CrazyGames lite (classic flat maze; no textures/maze in zip)."
