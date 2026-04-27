#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANDROID_DIR="$SCRIPT_DIR/dayglance-android"
OUT_DIR="$SCRIPT_DIR/outputs"

# Flags
FULL_CLEAN=false
RELEASE=false
for arg in "$@"; do
  case "$arg" in
    --clean)   FULL_CLEAN=true ;;
    --release) RELEASE=true ;;
    *) echo "Unknown flag: $arg (valid flags: --clean, --release)" && exit 1 ;;
  esac
done

# ── Clean ──────────────────────────────────────────────────────────────────
if $FULL_CLEAN; then
  echo "==> Full clean..."
  cd "$ANDROID_DIR" && ./gradlew clean
  cd "$SCRIPT_DIR"
  rm -rf dist
else
  # Vite produces a new content-hashed bundle on every build, so Gradle's
  # incremental asset pipeline accumulates stale .jar files for the old
  # hashes and then fails with "already contains entry". Wipe just that
  # intermediates directory — it is cheap and rebuilt every assembleDebug.
  STALE_ASSETS="$ANDROID_DIR/app/build/intermediates/compressed_assets"
  if [ -d "$STALE_ASSETS" ]; then
    echo "==> Clearing stale asset intermediates..."
    rm -rf "$STALE_ASSETS"
  fi
fi

mkdir -p "$OUT_DIR"

if $RELEASE; then
  # ── Android ────────────────────────────────────────────────────────────
  echo "==> Building Android web assets..."
  cd "$SCRIPT_DIR"
  npm run build:android

  echo "==> Building Android APK + AAB..."
  cd "$ANDROID_DIR"
  ./gradlew assembleRelease bundleRelease

  cp "app/build/outputs/apk/release/dayglance.apk" "$OUT_DIR/dayglance.apk"
  echo "    APK  → outputs/dayglance.apk"
  cp "app/build/outputs/bundle/release/app-release.aab" "$OUT_DIR/dayglance.aab"
  echo "    AAB  → outputs/dayglance.aab"

  echo ""
  echo "==> Android release build complete. outputs/:"
  ls -lh "$OUT_DIR"

else
  # ── Debug APK + install ────────────────────────────────────────────────
  echo "==> Building web assets..."
  cd "$SCRIPT_DIR"
  npm run build:android

  APK_SRC="$ANDROID_DIR/app/build/outputs/apk/debug/app-debug.apk"
  APK_DEST="$OUT_DIR/dayglance-debug.apk"

  echo "==> Building debug APK..."
  cd "$ANDROID_DIR"
  ./gradlew assembleDebug

  cp "$APK_SRC" "$APK_DEST"
  echo "==> Installing on connected device..."
  adb install -r "$APK_DEST"
  echo "==> Done! App installed."
fi
