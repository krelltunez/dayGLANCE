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
// Required env vars for a Mac App Store build (build:electron:mas):
//   CSC_LINK                         path to .p12 for the "3rd Party Mac Developer Application" cert
//   CSC_KEY_PASSWORD                 password for the .p12
//   APPLE_TEAM_ID                    10-char Team ID

const hasCert = Boolean(process.env.CSC_LINK);

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.dayglance.app',
  productName: 'dayGLANCE',
  afterPack: './scripts/codesign-ad-hoc.cjs',
  afterSign: hasCert ? './scripts/notarize.cjs' : undefined,
  directories: {
    buildResources: 'public',
    output: 'dist-app',
  },
  files: ['dist/**/*', 'dist-electron/**/*'],
  mac: {
    // null → ad-hoc (dev); undefined → electron-builder auto-selects the
    // Developer ID Application cert from Keychain when CSC_LINK is set.
    identity: hasCert ? undefined : null,
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
    ],
    target: [
      { target: 'dmg', arch: ['x64', 'arm64'] },
      { target: 'zip', arch: ['x64', 'arm64'] },
    ],
  },
  mas: {
    hardenedRuntime: false, // MAS builds must NOT use Hardened Runtime — sandbox replaces it
    entitlements: 'electron/entitlements.mas.plist',
    entitlementsInherit: 'electron/entitlements.mas.plist',
    category: 'public.app-category.productivity',
    extendInfo: {
      NSCalendarsUsageDescription: 'dayGLANCE shows your calendar events alongside your tasks.',
      NSCalendarsFullAccessUsageDescription: 'dayGLANCE shows your calendar events alongside your tasks.',
    },
    extraResources: [
      { from: 'electron/native/calendar-helper/build/dayglance-calendar-helper', to: 'calendar-helper/dayglance-calendar-helper' },
    ],
  },
  win: {
    target: [{ target: 'nsis' }],
  },
  linux: {
    target: [{ target: 'AppImage' }],
  },
};
