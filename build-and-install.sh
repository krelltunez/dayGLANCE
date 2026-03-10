#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APK_PATH="$SCRIPT_DIR/dayglance-android/app/build/outputs/apk/debug/app-debug.apk"

echo "==> Building web assets..."
cd "$SCRIPT_DIR"
npm run build:android

echo "==> Building Android APK..."
cd "$SCRIPT_DIR/dayglance-android"
./gradlew assembleDebug

echo "==> Installing on connected device..."
adb install -r "$APK_PATH"

echo "==> Done! App installed."
