#!/usr/bin/env bash
# Build static HTML (out/) and zip for CrazyGames HTML5 upload (full maze textures).
# Smaller bundle without PNG tiles: npm run package:crazygames-lite
# Upload dist/creep-labyrinth-crazygames.zip via developer.crazygames.com
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
npm run build:itch
mkdir -p dist
OUT_ZIP="dist/creep-labyrinth-crazygames.zip"
rm -f "$OUT_ZIP"
(cd out && zip -q -r "../$OUT_ZIP" . -x "*.DS_Store")
echo "Created $OUT_ZIP ($(du -h "$OUT_ZIP" | cut -f1)) — CrazyGames: developer.crazygames.com → Upload HTML5 → this zip."
