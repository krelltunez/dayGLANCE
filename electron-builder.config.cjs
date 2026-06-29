// Release signing is controlled entirely by environment variables.
// When CSC_LINK / CSC_KEY_PASSWORD are absent the build falls back to
// ad-hoc signing via the afterPack hook — safe for local dev and CI
// branches that don't have the cert.
//
// Required env vars for a notarized release build:
//   CSC_LINK                         path to .p12 OR base64-encoded .p12
//   CSC_KEY_PASSWORD                 password for the .p12
//   APPLE_ID                         your Apple ID email
//   APPLE_APP_SPECIFIC_PASSWORD      app-specific password generated at appleid.apple.com
//   APPLE_TEAM_ID                    10-char Team ID from developer.apple.com/account
//
// Mac App Store build (build:electron:mas) — no env vars required for a normal run:
//   - Drop your provisioning profile at electron/dayglance.mas.provisionprofile
//     (git-ignored). It carries the App ID + iCloud + IAP capabilities. Override
//     the path with MAC_PROVISIONING_PROFILE if you keep it elsewhere.
//   - Signing certs come from the login keychain automatically: the
//     "3rd Party Mac Developer Application" (or "Apple Distribution") cert signs
//     the .app, and the "3rd Party Mac Developer Installer" (or "Mac Installer
//     Distribution") cert signs the .pkg. Both must be present.
//   - CFBundleVersion defaults to the app `version` (bump it per release, as usual);
//     set BUILD_NUMBER only if you need to upload twice under the same version.

const hasCert = Boolean(process.env.CSC_LINK);
// MAS builds sign from the keychain (no CSC_LINK), so they must never inherit the
// dev ad-hoc `identity: null` below — that would skip signing entirely. The mas
// script is the only thing that sets DAYGLANCE_APP_ID, so it's a reliable signal.
const isMasBuild = process.env.DAYGLANCE_APP_ID === 'com.dayglance';

/** @type {import('electron-builder').Configuration} */
module.exports = {
  // Developer ID (dmg/zip) keeps the original com.dayglance.app identity so
  // existing GitHub users are undisturbed. Only the MAS build overrides this to
  // com.dayglance (via DAYGLANCE_APP_ID, set by the build:electron:mas script) so
  // it matches the iOS app for Universal Purchase. electron-builder has a single
  // global appId — there is no per-target override — hence the env switch.
  appId: process.env.DAYGLANCE_APP_ID || 'com.dayglance.app',
  productName: 'dayGLANCE',
  // CFBundleVersion — the App Store requires a value that increases on every
  // upload. Falls back to `version` when BUILD_NUMBER is unset (local/dev).
  buildVersion: process.env.BUILD_NUMBER || undefined,
  afterPack: './scripts/codesign-ad-hoc.cjs',
  afterSign: hasCert ? './scripts/notarize.cjs' : undefined,
  directories: {
    buildResources: 'public',
    output: 'dist-app',
  },
  files: ['dist/**/*', 'dist-electron/**/*'],
  mac: {
    // null → ad-hoc (dev); undefined → electron-builder auto-selects the signing
    // cert from the Keychain (Developer ID when CSC_LINK is set; the Apple
    // Distribution cert for MAS, which the mas block inherits).
    identity: hasCert || isMasBuild ? undefined : null,
    hardenedRuntime: hasCert,
    notarize: false, // handled by afterSign hook (scripts/notarize.cjs)
    category: 'public.app-category.productivity',
    entitlements: 'electron/entitlements.mac.plist',
    entitlementsInherit: 'electron/entitlements.mac.plist',
    // Calendar (EventKit) permission strings shown in the system prompt. macOS 14+
    // uses the FullAccess variant; older releases use NSCalendarsUsageDescription.
    extendInfo: {
      NSCalendarsUsageDescription: 'dayGLANCE shows your calendar events alongside your tasks.',
      NSCalendarsFullAccessUsageDescription: 'dayGLANCE shows your calendar events alongside your tasks.',
    },
    // Bundle the signed EventKit helper (built by scripts/build-calendar-helper.sh)
    // into Contents/Resources/calendar-helper. electron-builder signs nested binaries.
    extraResources: [
      { from: 'electron/native/calendar-helper/build/dayglance-calendar-helper', to: 'calendar-helper/dayglance-calendar-helper' },
      { from: 'electron/native/icloud-helper/build/dayglance-icloud-helper', to: 'icloud-helper/dayglance-icloud-helper' },
    ],
    target: [
      { target: 'dmg', arch: ['x64', 'arm64'] },
      { target: 'zip', arch: ['x64', 'arm64'] },
    ],
  },
  mas: {
    hardenedRuntime: false, // MAS builds must NOT use Hardened Runtime — sandbox replaces it
    entitlements: 'electron/entitlements.mas.plist',
    // Child binaries (Electron Helpers + bundled Swift helpers) get the minimal
    // sandbox+inherit set; only the main app carries iCloud/IAP/etc.
    entitlementsInherit: 'electron/entitlements.mas.inherit.plist',
    // Embedded provisioning profile (App ID + iCloud + IAP capabilities). Defaults
    // to a fixed git-ignored path so a normal build needs no env setup — just drop
    // the file there once. MAC_PROVISIONING_PROFILE overrides the location.
    provisioningProfile: process.env.MAC_PROVISIONING_PROFILE || 'electron/dayglance.mas.provisionprofile',
    category: 'public.app-category.productivity',
    extendInfo: {
      NSCalendarsUsageDescription: 'dayGLANCE shows your calendar events alongside your tasks.',
      NSCalendarsFullAccessUsageDescription: 'dayGLANCE shows your calendar events alongside your tasks.',
    },
    extraResources: [
      { from: 'electron/native/calendar-helper/build/dayglance-calendar-helper', to: 'calendar-helper/dayglance-calendar-helper' },
      { from: 'electron/native/icloud-helper/build/dayglance-icloud-helper', to: 'icloud-helper/dayglance-icloud-helper' },
    ],
  },
  win: {
    target: [{ target: 'nsis' }],
  },
  linux: {
    target: [{ target: 'AppImage' }],
  },
};
