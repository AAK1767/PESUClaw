#!/bin/bash
# build.sh — Assemble Chrome and Firefox extensions from shared source
# Usage:
#   ./build.sh                # build both
#   ./build.sh chrome         # chrome only
#   ./build.sh firefox        # firefox only
#   ./build.sh --zip          # build both + create zip packages
#   ./build.sh chrome --zip   # chrome only + zip

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SRC="$ROOT/src"
PLATFORMS="$ROOT/platforms"
BUILD="$ROOT/build"
ZIP=false

build_extension() {
  local name="$1"
  local out="$BUILD/$name"
  local plat="$PLATFORMS/$name"

  rm -rf "$out"
  mkdir -p "$out"

  # Shared source
  cp "$SRC/content.js"  "$out/"
  cp "$SRC/popup.html"  "$out/"
  cp "$SRC/panel.css"   "$out/"
  cp -r "$SRC/lib"      "$out/lib"
  cp -r "$SRC/icons"    "$out/icons"

  # Platform-specific files
  cp "$plat"/* "$out/" 2>/dev/null || true

  echo "Built $name -> build/$name/"

  if $ZIP; then
    local zipfile="$BUILD/PESUClaw-${name}.zip"
    rm -f "$zipfile"
    (cd "$out" && zip -r "$zipfile" .)
    echo "Packaged $name -> PESUClaw-${name}.zip"
  fi
}

# Parse arguments
TARGET="all"
for arg in "$@"; do
  case "$arg" in
    --zip) ZIP=true ;;
    all|chrome|firefox) TARGET="$arg" ;;
    *)
      echo "Usage: $0 [all|chrome|firefox] [--zip]"
      exit 1
      ;;
  esac
done

case "$TARGET" in
  all)
    build_extension chrome
    build_extension firefox
    ;;
  chrome)
    build_extension chrome
    ;;
  firefox)
    build_extension firefox
    ;;
esac

echo "Done."
