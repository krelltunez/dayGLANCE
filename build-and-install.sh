#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APK_PATH="$SCRIPT_DIR/dayglance-android/app/build/outputs/apk/debug/app-debug.apk"
ANDROID_DIR="$SCRIPT_DIR/dayglance-android"

# --clean: full Gradle clean (slow; use after a crashed build or Kotlin cache corruption)
FULL_CLEAN=false
for arg in "$@"; do
  [[ "$arg" == "--clean" ]] && FULL_CLEAN=true
done

if $FULL_CLEAN; then
  echo "==> Full clean..."
  cd "$ANDROID_DIR"
  ./gradlew clean
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

echo "==> Building web assets..."
cd "$SCRIPT_DIR"
npm run build:android

echo "==> Building Android APK..."
cd "$ANDROID_DIR"
./gradlew assembleDebug

echo "==> Installing on connected device..."
adb install -r "$APK_PATH"

echo "==> Done! App installed."
