#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANDROID_DIR="$SCRIPT_DIR/dayglance-android"
OUT_DIR="$SCRIPT_DIR/outputs"

# Flags
FULL_CLEAN=false
RELEASE=false
AAB=false
for arg in "$@"; do
  if [[ "$arg" == "--clean" ]]; then FULL_CLEAN=true
  elif [[ "$arg" == "--release" ]]; then RELEASE=true
  elif [[ "$arg" == "--aab" ]]; then AAB=true; RELEASE=true
  else echo "Unknown flag: $arg (valid flags: --clean, --release, --aab)" && exit 1
  fi
done

if $AAB; then
  AAB_SRC="$ANDROID_DIR/app/build/outputs/bundle/release/app-release.aab"
  AAB_DEST="$OUT_DIR/dayglance.aab"
  GRADLE_TASK="bundleRelease"
elif $RELEASE; then
  APK_SRC="$ANDROID_DIR/app/build/outputs/apk/release/dayglance.apk"
  APK_DEST="$OUT_DIR/dayglance.apk"
  GRADLE_TASK="assembleRelease"
else
  APK_SRC="$ANDROID_DIR/app/build/outputs/apk/debug/app-debug.apk"
  APK_DEST="$OUT_DIR/dayglance-debug.apk"
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

if $AAB; then
  echo "==> Building Android AAB (${GRADLE_TASK})..."
else
  echo "==> Building Android APK (${GRADLE_TASK})..."
fi
cd "$ANDROID_DIR"
./gradlew "$GRADLE_TASK"

# Copy output to project-root outputs/ — bypasses Gradle's macOS hidden-flag
# behaviour entirely. The outputs/ dir is gitignored.
mkdir -p "$OUT_DIR"
if $AAB; then
  cp "$AAB_SRC" "$AAB_DEST"
  echo "==> AAB ready: outputs/dayglance.aab"
  echo "==> Done! Upload to Google Play Console."
elif $RELEASE; then
  cp "$APK_SRC" "$APK_DEST"
  echo "==> Release APK: outputs/dayglance.apk"
  echo "==> Done! Copy to your F-Droid repo."
else
  cp "$APK_SRC" "$APK_DEST"
  echo "==> Installing on connected device..."
  adb install -r "$APK_DEST"
  echo "==> Done! App installed."
fi
