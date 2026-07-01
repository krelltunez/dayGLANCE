#!/usr/bin/env bash
#
# Generates the iOS Xcode project (and Info.plists) from dayglance-ios/project.yml
# with version numbers injected to mirror the macOS app:
#
#   CFBundleShortVersionString (marketing) ← package.json "version"
#       so iOS and macOS always show the same marketing version (e.g. 3.8.1).
#   CFBundleVersion (build)                ← auto date-based YYYYMMDD.HHMM
#       so it always increases and never needs a manual bump. Set BUILD_NUMBER
#       to override (matches the macOS electron-builder behavior).
#
# Run this INSTEAD of a bare `xcodegen generate`: project.yml reads the values via
# ${DG_MARKETING_VERSION} / ${DG_BUILD_NUMBER}, which a bare run would leave empty.
#
# Usage:  npm run ios:generate

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v xcodegen >/dev/null 2>&1; then
  echo "gen-ios-project: xcodegen not found — install with 'brew install xcodegen'" >&2
  exit 1
fi

DG_MARKETING_VERSION="$(node -p "require('./package.json').version")"
if [[ -z "$DG_MARKETING_VERSION" ]]; then
  echo "gen-ios-project: could not read version from package.json" >&2
  exit 1
fi
export DG_MARKETING_VERSION
export DG_BUILD_NUMBER="${BUILD_NUMBER:-$(date +%Y%m%d.%H%M)}"

echo "gen-ios-project: marketing=$DG_MARKETING_VERSION  build=$DG_BUILD_NUMBER"
cd "$ROOT/dayglance-ios"
xcodegen generate
echo "gen-ios-project: done — open dayglance-ios/DayGlance.xcodeproj in Xcode to archive."
