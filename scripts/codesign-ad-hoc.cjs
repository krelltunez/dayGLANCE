// electron-builder afterPack hook: ad-hoc sign the macOS .app bundle before it
// is packaged into a DMG or ZIP. This replaces the hard "damaged and can't be
// opened" Gatekeeper block with the softer "unidentified developer" prompt that
// users can bypass with right-click → Open, without needing a Terminal command.
//
// Ad-hoc signing (--sign -) does not require a certificate and is distinct from
// App Store / notarized signing. It satisfies macOS code signature requirements
// without being trusted by Gatekeeper's CA chain.
//
// When CSC_LINK is set, electron-builder handles real Developer ID signing and
// the xattr/detritus cleanup still runs (it's harmless and prevents codesign
// failures on CI), but the ad-hoc --sign - step is skipped.

const { execSync } = require('child_process');
const path = require('path');

exports.default = async function codesignAdHoc({ appOutDir, packager, electronPlatformName }) {
  if (packager.platform.name !== 'mac') return;
  const appPath = path.join(appOutDir, `${packager.appInfo.productName}.app`);

  // codesign --deep traverses nested executables (Electron framework, helpers)
  // and fails with "detritus not allowed" if any file has a resource fork or
  // extended attribute. Two sources of detritus need clearing:
  //   1. ._* files — resource fork proxy files macOS creates on non-HFS+ copies
  //   2. Extended attributes on all files including symlinks (com.apple.FinderInfo etc.)
  // xattr -cr handles all file types including symlinks inside Electron frameworks
  // (e.g. Versions/Current) that the previous find -not -type l approach skipped.
  console.log(`[codesign-ad-hoc] Removing ._* resource fork files from ${appPath}`);
  execSync(`find ${JSON.stringify(appPath)} -name "._*" -delete`);
  console.log(`[codesign-ad-hoc] Clearing xattrs on ${appPath}`);
  execSync(`xattr -cr ${JSON.stringify(appPath)}`);
  // MAS builds are always signed by electron-builder with the Mac App Store
  // distribution identity (from the keychain) — never ad-hoc sign them, or the
  // App Store signature would be invalid. The xattr cleanup above still helps.
  if (electronPlatformName === 'mas') {
    console.log('[codesign-ad-hoc] MAS build — electron-builder signs with the distribution identity; skipping ad-hoc sign.');
    return;
  }
  if (process.env.CSC_LINK) {
    console.log('[codesign-ad-hoc] CSC_LINK set — skipping ad-hoc sign (electron-builder will use Developer ID).');
    return;
  }
  console.log(`[codesign-ad-hoc] Signing ${appPath}`);
  execSync(`codesign --sign - --deep --force ${JSON.stringify(appPath)}`);
};
