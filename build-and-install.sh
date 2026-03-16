#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANDROID_DIR="$SCRIPT_DIR/dayglance-android"

# Flags
FULL_CLEAN=false
RELEASE=false
for arg in "$@"; do
  [[ "$arg" == "--clean" ]] && FULL_CLEAN=true
  [[ "$arg" == "--release" ]] && RELEASE=true
done

if $RELEASE; then
  APK_PATH="$ANDROID_DIR/app/build/outputs/apk/release/dayglance.apk"
  GRADLE_TASK="assembleRelease"
else
  APK_PATH="$ANDROID_DIR/app/build/outputs/apk/debug/app-debug.apk"
  GRADLE_TASK="assembleDebug"
fi

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

echo "==> Building Android APK (${GRADLE_TASK})..."
cd "$ANDROID_DIR"
./gradlew "$GRADLE_TASK"

if $RELEASE; then
  RELEASE_DIR="$ANDROID_DIR/app/build/outputs/apk/release"
  ACTUAL_APK=$(find "$RELEASE_DIR" -name "*.apk" 2>/dev/null | head -1)
  if [ -z "$ACTUAL_APK" ]; then
    echo "==> ERROR: No APK found in $RELEASE_DIR"
    exit 1
  fi
  if [ "$ACTUAL_APK" != "$APK_PATH" ]; then
    mv "$ACTUAL_APK" "$APK_PATH"
  fi
  echo "==> Release APK: $APK_PATH"
  echo "==> Done! Copy dayglance.apk to your F-Droid repo."
else
  echo "==> Installing on connected device..."
  adb install -r "$APK_PATH"
  echo "==> Done! App installed."
fi
