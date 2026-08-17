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
  // NSHumanReadableCopyright in the bundle's Info.plist. Keeps the packaged
  // metadata consistent with the runtime About panel (set via
  // app.setAboutPanelOptions in electron/main.ts).
  copyright: 'Copyright © 2026 GLANCE Apps',
  // CFBundleVersion (the *build* number) — must strictly increase on every App
  // Store upload, independent of the marketing version (CFBundleShortVersionString,
  // which stays `version` from package.json, e.g. 3.8.1). Auto-derived from the
  // build date+time as YYYYMMDD.HHMM so it always increases and never needs a manual
  // bump; set BUILD_NUMBER to override. This scheme also stays greater than the very
  // first upload (which used "3.8.1"): its leading component (e.g. 20260630) dwarfs
  // "3", so Apple's component-wise comparison always sees it as newer.
  buildVersion: process.env.BUILD_NUMBER || (() => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.${p(d.getHours())}${p(d.getMinutes())}`;
  })(),
  afterPack: './scripts/codesign-ad-hoc.cjs',
  afterSign: hasCert ? './scripts/notarize.cjs' : undefined,
  directories: {
    buildResources: 'public',
    output: 'dist-app',
  },
  // Exclude .map files: main-process sourcemaps (dist-electron/**/*.js.map) would
  // otherwise ship inside the app bundle, exposing readable source with no runtime
  // benefit. tsconfig keeps sourceMap on for local debugging; this drops them from
  // the packaged build only.
  //
  // The MAS §7 exclusions live HERE, in the same array as the positives, not in a
  // per-target mas.files block. electron-builder normalizes this top-level array
  // into one file-set matcher; a per-target files array becomes a SEPARATE matcher
  // whose negations cannot exclude anything the top-level matcher includes (the
  // walks are unioned). Worse, a negation-only per-target array gets '**/*'
  // prepended, which drags the whole project directory into app.asar.
  // scripts/verify-mas-compileout.mjs asserts both properties on built artifacts.
  files: [
    'dist/**/*',
    'dist-electron/**/*',
    '!**/*.map',
    ...(isMasBuild ? ['!dist-electron/mcpDesktopSetup*', '!dist-electron/mcpDesktopConfig*'] : []),
  ],
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
    // Bundle the signed EventKit calendar helper (built by scripts/build-calendar-helper.sh)
    // into Contents/Resources/calendar-helper. electron-builder signs nested binaries.
    // The MCP bridge (spec §3.2) rides along into Contents/Resources/mcp-bridge for
    // DIRECT builds only, so it is conditionally omitted here. It must NOT be handled
    // by giving the mas block its own extraResources: electron-builder's deepAssign
    // CONCATENATES arrays when merging mac options into mas options (it does not
    // replace them), so anything listed here rides into the MAS artifact regardless
    // of what the mas block declares. MAS links to documentation instead (§7).
    // scripts/verify-mas-compileout.mjs asserts this against the built artifact.
    extraResources: [
      { from: 'electron/native/calendar-helper/build/dayglance-calendar-helper', to: 'calendar-helper/dayglance-calendar-helper' },
      ...(isMasBuild ? [] : [{ from: 'node_modules/@glance-apps/mcp-bridge', to: 'mcp-bridge' }]),
    ],
    target: [
      { target: 'dmg', arch: ['x64', 'arm64'] },
      { target: 'zip', arch: ['x64', 'arm64'] },
    ],
  },
  mas: {
    // §7 build-time separation: the Claude Desktop setup path is compiled out
    // of the MAS artifact, not runtime-gated. Two mechanisms: the renderer's
    // button is dead-code-eliminated by the __MAS_BUILD__ define (see
    // vite.config.electron.js and the build:electron:mas script), and the
    // main-process setup modules are excluded from packaging by the isMasBuild
    // conditional in the TOP-LEVEL files array above — deliberately not by a
    // files array here, which would become a separate matcher whose negations
    // don't compose (see the comment on the top-level files array).
    // main.ts loads mcpDesktopSetup dynamically, so this absence is a no-op.
    // Verify against the built artifact with scripts/verify-mas-compileout.mjs.
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
      // Export compliance: the app uses only standard HTTPS/TLS (exempt encryption),
      // no proprietary or user-facing crypto. Declaring this in the binary stops
      // App Store Connect from prompting for encryption docs on every upload.
      ITSAppUsesNonExemptEncryption: false,
    },
    // No extraResources here: deepAssign CONCATENATES this array with mac's when
    // merging (declaring the calendar helper again would copy it twice). The MAS
    // artifact inherits mac's extraResources, which the isMasBuild conditional
    // above already trims to the calendar helper only.
    // Universal (x86_64 + arm64) so the App Store accepts the build for every Mac.
    // Without this it defaults to the host arch only (arm64), which Apple rejects
    // unless the deployment target is 12.0+. The bundled Swift helpers are already
    // universal (lipo'd in their build scripts), so they slot in cleanly.
    target: [{ target: 'pkg', arch: 'universal' }],
    // The bundled Swift helpers are already universal (x86_64+arm64), so they're
    // byte-identical in the x64 and arm64 sub-builds. @electron/universal refuses
    // to merge identical Mach-O files unless they're declared here — this tells it
    // to take them as-is instead of trying to lipo two copies of the same fat binary.
    x64ArchFiles: '**/dayglance-*-helper',
  },
  win: {
    // The MCP bridge must be declared HERE too, not only under mac. extraResources
    // is a per-platform option: mac's array does not reach the Windows artifact, so
    // omitting it here shipped an installer with no resources/mcp-bridge at all,
    // while the "Set up Claude Desktop" button still wrote a config pointing into
    // it (fixed alongside this; the setup handler now refuses to write when the
    // bridge is absent rather than reporting success).
    //
    // Deliberately NOT hoisted to a top-level extraResources to cover both at once:
    // the mac block's array would then merge with it, and the mac/mas deepAssign
    // concatenation documented above makes that merge's result the exact thing this
    // file already has to reason carefully about. Per-platform is verbose and
    // obvious; hoisting is terse and subtle.
    //
    // isMasBuild is a whole-build env flag, not a per-target one, so it is not
    // needed here (MAS is a mac-only target), but no Windows build ever sets it.
    extraResources: [
      { from: 'node_modules/@glance-apps/mcp-bridge', to: 'mcp-bridge' },
    ],
    target: [{ target: 'nsis' }],
  },
  linux: {
    // No bridge, by design (§7): there is no Claude Desktop on Linux, and an
    // AppImage's mount path changes every launch, so an absolute path written into
    // a config would go stale on the next run. Linux connects via npx instead, and
    // the renderer's setup button does not render there.
    //
    // arch is EXPLICIT here, and must stay that way. Omitting it does not mean
    // "every architecture", it means "whatever the build host happens to be" —
    // and the host is ubuntu-latest, so for three releases the only Linux artifact
    // was x64. Nothing decided to exclude ARM; the default decided, silently, and
    // a Raspberry Pi user downloading the AppImage got "cannot execute binary
    // file" with nothing explaining why. mac had arch spelled out from the start
    // because Apple Silicon makes the omission fail loudly; Linux never forced
    // the question.
    //
    // Cross-packaging arm64 from an x64 runner is sound HERE specifically because
    // no runtime dependency is native (every .node in node_modules is build
    // tooling: rolldown, rollup, lightningcss). electron-builder fetches the
    // arm64 Electron dist and wraps the same JS, so there is nothing to compile.
    // Adding a native runtime dep invalidates that and this needs an arm64 runner
    // (ubuntu-24.04-arm) instead.
    //
    // 64-bit only. 32-bit Raspberry Pi OS reports armv7l and is not covered.
    //
    // artifactName exists to force the arch into EVERY name, including x64's.
    // electron-builder suppresses the arch suffix for a platform's default arch
    // unless a pattern is user-specified: expandArtifactNamePattern only strips it
    // when `!isUserForced`, and artifactPatternConfig sets isUserForced from the
    // mere presence of artifactName (app-builder-lib/out/platformPackager.js).
    // Without this, the pair ships as dayGLANCE-4.4.0.AppImage (x64, unlabelled)
    // and dayGLANCE-4.4.0-arm64.AppImage, so the x64 build reads as the generic
    // one and gets downloaded onto ARM hardware, where it fails with a bare
    // "exec format error". Both names now carry their arch.
    //
    // ${arch} expands through Arch[arch], so the values are x64 and arm64, not
    // x86_64. Matching electron-builder's own vocabulary beats inventing a
    // synonym, and "x86" would be wrong outright since it reads as 32-bit.
    // Desktop-entry metadata. electron-builder writes Name, Exec, Type, Terminal,
    // Icon and StartupWMClass itself (LinuxTargetHelper), so only the keys it
    // cannot infer are set here. All three of these were missing:
    //
    // category — REQUIRED, not optional. Left unset, LinuxTargetHelper tries to
    //   map mac.category, and its macToLinuxCategory table has no entry for
    //   public.app-category.productivity (graphics-design, developer-tools,
    //   education, games, video, utilities, social-networking, finance, music
    //   only). The mapping fails, Categories is omitted entirely, and the app
    //   lands in the launcher's catch-all "Other" section. Office is the main
    //   freedesktop category; Calendar is a registered additional one.
    //
    // icon — without it, computeDesktopIcons falls through every source
    //   (linux.icon, mac.icon, config.icon) and then looks for a `public/icons`
    //   directory, which does not exist, so it reaches getDefaultFrameworkIcon
    //   and ships the GENERIC ELECTRON ICON. resolveIcon logs "default Electron
    //   icon is used" when that happens, which has been in the build output all
    //   along. Resolved against buildResources (public/) first, so the bare
    //   filename is the right form. icon-512.png is 512x512 RGBA, comfortably
    //   over the 256x256 floor for generating a Linux icon set.
    //
    // description — becomes the .desktop Comment, shown as the tooltip and in
    //   launcher search results. package.json has no description field, so
    //   getDescription resolved to empty and the key was dropped. Set here
    //   rather than in package.json to keep the change scoped to Linux.
    category: 'Office;Calendar',
    description: 'Your day, at a glance',
    icon: 'icon-512.png',
    desktop: {
      entry: {
        // Launcher search terms. Trailing semicolon per the freedesktop spec for
        // list values; electron-builder appends one to Categories but not here.
        Keywords: 'planner;schedule;tasks;todo;calendar;timeblocking;habits;goals;',
      },
    },
    // maintainer is REQUIRED by the deb target and by nothing else. FpmTarget's
    // checkOptions throws before building on a missing homepage (package.json,
    // added alongside this) or a missing maintainer, taken from here or from a
    // package.json author carrying an email. Declaring a deb target without both
    // does not degrade, it FAILS THE LINUX BUILD.
    //
    // This address ships inside every published package and is readable by anyone
    // who installs one, so it is deliberately the project's public contact rather
    // than a personal address.
    maintainer: 'GLANCE Apps <hello@glance-apps.com>',
    target: [
      // artifactName sits on the TARGET, not the platform: at platform level it
      // would rename the deb too, and Debian's convention is
      // name_version_arch.deb with arch as amd64, not ${productName}-...-x64.deb.
      // Target-specific patterns still set isUserForced, so x64 keeps its suffix.
      { target: 'AppImage', arch: ['x64', 'arm64'],
        artifactName: '${productName}-${version}-${arch}.${ext}' },
      // deb exists because an AppImage is not installed: it is a loose executable
      // that never creates a menu entry, so "where is it after installing" had no
      // good answer. A deb unpacks to /opt, registers the .desktop file written
      // from the metadata above, and uninstalls with apt like anything else.
      // AppImage stays for distros without dpkg and for people who want portable.
      { target: 'deb', arch: ['x64', 'arm64'] },
    ],
  },
};
