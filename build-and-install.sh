#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANDROID_DIR="$SCRIPT_DIR/dayglance-android"
OUT_DIR="$SCRIPT_DIR/outputs"

# Flags
FULL_CLEAN=false
RELEASE=false
BUILD_NUMBER=""
prev_arg=""
for arg in "$@"; do
  if [ "$prev_arg" = "--build" ]; then
    BUILD_NUMBER="$arg"
    prev_arg=""
    continue
  fi
  case "$arg" in
    --clean)   FULL_CLEAN=true ;;
    --release) RELEASE=true ;;
    --build)   prev_arg="--build" ;;
    *) echo "Unknown flag: $arg (valid flags: --clean, --release, --build N)" && exit 1 ;;
  esac
done
if [ "$prev_arg" = "--build" ]; then
  echo "--build requires a number (e.g. --build 186)" && exit 1
fi
if [ -n "$BUILD_NUMBER" ] && ! [[ "$BUILD_NUMBER" =~ ^[0-9]+$ ]]; then
  echo "--build must be a positive integer, got: $BUILD_NUMBER" && exit 1
fi

# ── Android versionCode (release builds) ───────────────────────────────────
# The versionCode is set per-build here instead of via a commit per upload:
# build.gradle.kts reads -PversionCode when provided. The last number used is
# recorded in outputs/.last-versioncode (gitignored) so the suggested next
# code stays correct even when the checked-in gradle fallback goes stale.
VERSIONCODE_FILE="$OUT_DIR/.last-versioncode"
resolve_versioncode() {
  if [ -n "$BUILD_NUMBER" ]; then
    VERSION_CODE="$BUILD_NUMBER"
    return
  fi
  local last="" gradle_default suggested
  [ -f "$VERSIONCODE_FILE" ] && last="$(cat "$VERSIONCODE_FILE" 2>/dev/null | tr -dc '0-9')"
  gradle_default="$(grep -o '?: [0-9]*' "$ANDROID_DIR/app/build.gradle.kts" | head -1 | tr -dc '0-9')"
  if [ -n "$last" ]; then
    suggested=$((last + 1))
  else
    suggested=$(( ${gradle_default:-0} + 1 ))
  fi
  if [ -t 0 ]; then
    read -r -p "==> Android versionCode for this release [$suggested]: " VERSION_CODE
    VERSION_CODE="${VERSION_CODE:-$suggested}"
  else
    VERSION_CODE="$suggested"
  fi
  if ! [[ "$VERSION_CODE" =~ ^[0-9]+$ ]]; then
    echo "versionCode must be a positive integer, got: $VERSION_CODE" && exit 1
  fi
}

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
  resolve_versioncode
  echo "==> Using Android versionCode $VERSION_CODE"

  echo "==> Building Android web assets..."
  cd "$SCRIPT_DIR"
  npm run build:android

  echo "==> Building Android APK + AAB (play) and GitHub APK..."
  cd "$ANDROID_DIR"
  ./gradlew -PversionCode="$VERSION_CODE" assemblePlayRelease bundlePlayRelease assembleGithubRelease
  echo "$VERSION_CODE" > "$VERSIONCODE_FILE"

  cp "app/build/outputs/apk/play/release/dayglance.apk" "$OUT_DIR/dayglance.apk"
  echo "    APK (Play)   → outputs/dayglance.apk"
  cp "app/build/outputs/bundle/playRelease/app-play-release.aab" "$OUT_DIR/dayglance.aab"
  echo "    AAB (Play)   → outputs/dayglance.aab"
  cp "app/build/outputs/apk/github/release/dayglance.apk" "$OUT_DIR/dayglance-github.apk"
  echo "    APK (GitHub) → outputs/dayglance-github.apk"

  echo ""
  echo "==> Android release build complete (versionCode $VERSION_CODE). outputs/:"
  ls -lh "$OUT_DIR"

else
  # ── Debug APK + install ────────────────────────────────────────────────
  echo "==> Building web assets..."
  cd "$SCRIPT_DIR"
  npm run build:android

  APK_SRC="$ANDROID_DIR/app/build/outputs/apk/play/debug/app-play-debug.apk"
  APK_DEST="$OUT_DIR/dayglance-debug.apk"

  echo "==> Building debug APK..."
  cd "$ANDROID_DIR"
  ./gradlew assemblePlayDebug

  cp "$APK_SRC" "$APK_DEST"
  echo "==> Installing on connected device..."
  adb install -r "$APK_DEST"
  echo "==> Done! App installed."
fi
