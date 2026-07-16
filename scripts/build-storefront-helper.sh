#!/usr/bin/env bash
#
# Compiles the macOS StoreKit storefront helper to a universal (x64 + arm64)
# binary that electron-builder bundles into the app via `mac.extraResources`.
#
# Output: electron/native/storefront-helper/build/dayglance-storefront-helper
#
# No-op (exit 0) on non-macOS hosts or when `swiftc` is unavailable, so the rest
# of the build pipeline still runs on Linux/Windows/CI — the helper is macOS-only
# and is only required when producing a macOS (dmg/zip/mas) build.

set -euo pipefail

HELPER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../electron/native/storefront-helper" && pwd)"
SRC="$HELPER_DIR/Sources/main.swift"
OUT_DIR="$HELPER_DIR/build"
OUT="$OUT_DIR/dayglance-storefront-helper"

if [[ "$(uname)" != "Darwin" ]]; then
  echo "build-storefront-helper: skipping (not macOS)"
  exit 0
fi

if ! command -v swiftc >/dev/null 2>&1; then
  echo "build-storefront-helper: skipping (swiftc not found — install Xcode command line tools)"
  exit 0
fi

mkdir -p "$OUT_DIR"

echo "build-storefront-helper: compiling universal binary → $OUT"
swiftc -O \
  -framework StoreKit -framework Foundation \
  -target arm64-apple-macos11.0 \
  -o "$OUT_DIR/dayglance-storefront-helper-arm64" \
  "$SRC"

swiftc -O \
  -framework StoreKit -framework Foundation \
  -target x86_64-apple-macos11.0 \
  -o "$OUT_DIR/dayglance-storefront-helper-x64" \
  "$SRC"

lipo -create \
  "$OUT_DIR/dayglance-storefront-helper-arm64" \
  "$OUT_DIR/dayglance-storefront-helper-x64" \
  -output "$OUT"

rm -f "$OUT_DIR/dayglance-storefront-helper-arm64" "$OUT_DIR/dayglance-storefront-helper-x64"
chmod +x "$OUT"

echo "build-storefront-helper: done"
lipo -info "$OUT" || true
