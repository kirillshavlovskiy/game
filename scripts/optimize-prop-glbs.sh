#!/usr/bin/env bash
# Recompress weapon / shield / maze pickup GLBs: WebP textures (max 1024), meshopt geometry,
# no mesh simplification (keeps thin shields / web strands stable). Requires: npm i -D @gltf-transform/cli
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
BIN="${ROOT}/node_modules/.bin/gltf-transform"
if [[ ! -x "$BIN" ]]; then
  echo "Missing gltf-transform. Run: npm install"
  exit 1
fi
for dir in public/models/armour public/models/maze-collectibles; do
  shopt -s nullglob
  for f in "$dir"/*.glb; do
    tmp="$(mktemp "${TMPDIR:-/tmp}/gltf-opt-XXXXXX.glb")"
    echo "→ $f"
    if ! "$BIN" optimize "$f" "$tmp" --simplify false --texture-compress webp --texture-size 1024; then
      rm -f "$tmp"
      exit 1
    fi
    mv "$tmp" "$f"
  done
  shopt -u nullglob
done
echo "Done."
