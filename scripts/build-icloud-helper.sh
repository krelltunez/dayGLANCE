#!/usr/bin/env bash
#
# Compiles the macOS iCloud container helper to a universal (x64 + arm64) binary
# that electron-builder bundles into the app via `mac.extraResources`.
#
# Output: electron/native/icloud-helper/build/dayglance-icloud-helper
#
# No-op (exit 0) on non-macOS hosts or when `swiftc` is unavailable, so the rest
# of the build pipeline still runs on Linux/Windows/CI — the helper is macOS-only
# and is only required when producing a macOS (dmg/zip/mas) build.

set -euo pipefail

HELPER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../electron/native/icloud-helper" && pwd)"
SRC="$HELPER_DIR/Sources/main.swift"
OUT_DIR="$HELPER_DIR/build"
OUT="$OUT_DIR/dayglance-icloud-helper"

if [[ "$(uname)" != "Darwin" ]]; then
  echo "build-icloud-helper: skipping (not macOS)"
  exit 0
fi

if ! command -v swiftc >/dev/null 2>&1; then
  echo "build-icloud-helper: skipping (swiftc not found — install Xcode command line tools)"
  exit 0
fi

mkdir -p "$OUT_DIR"

echo "build-icloud-helper: compiling universal binary → $OUT"
swiftc -O \
  -framework Foundation \
  -target arm64-apple-macos11.0 \
  -o "$OUT_DIR/dayglance-icloud-helper-arm64" \
  "$SRC"

swiftc -O \
  -framework Foundation \
  -target x86_64-apple-macos11.0 \
  -o "$OUT_DIR/dayglance-icloud-helper-x64" \
  "$SRC"

lipo -create \
  "$OUT_DIR/dayglance-icloud-helper-arm64" \
  "$OUT_DIR/dayglance-icloud-helper-x64" \
  -output "$OUT"

rm -f "$OUT_DIR/dayglance-icloud-helper-arm64" "$OUT_DIR/dayglance-icloud-helper-x64"
chmod +x "$OUT"

echo "build-icloud-helper: done"
lipo -info "$OUT" || true
