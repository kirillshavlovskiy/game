#!/usr/bin/env bash
# Compress merged character GLBs: WebP textures (max 1024), meshopt, no mesh simplify (keeps skinned animation quality).
# Writes via mktemp under /tmp then replaces (avoids gltf-transform JSON stub bug next to huge inputs).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/node_modules/.bin/gltf-transform"
if [[ ! -x "$BIN" ]]; then
  echo "Missing gltf-transform. Run: npm install"
  exit 1
fi
opt_file() {
  local f="$1"
  local tmp
  tmp="$(mktemp /tmp/gltf-merged-XXXXXX.glb)"
  echo "→ $f"
  if ! "$BIN" optimize "$f" "$tmp" --simplify false --texture-compress webp --texture-size 1024; then
    rm -f "$tmp"
    return 1
  fi
  mv "$tmp" "$f"
}
shopt -s nullglob
for f in "$ROOT"/public/models/monsters/*.glb; do opt_file "$f"; done
for f in "$ROOT"/public/models/player/*.glb; do opt_file "$f"; done
for f in "$ROOT"/public/models/player/animation-overrides/*.glb; do opt_file "$f"; done
shopt -u nullglob
echo "Done."
