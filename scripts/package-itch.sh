#!/usr/bin/env bash
# Build static HTML (out/) and zip for itch.io HTML upload.
# Upload dist/creep-labyrinth-itch.zip — kind: HTML, index.html at zip root.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
npm run build:itch
mkdir -p dist
OUT_ZIP="dist/creep-labyrinth-itch.zip"
rm -f "$OUT_ZIP"
(cd out && zip -q -r "../$OUT_ZIP" . -x "*.DS_Store")
echo "Created $OUT_ZIP ($(du -h "$OUT_ZIP" | cut -f1)) — itch.io: New Project → Uploads → HTML → this zip."
