// electron-builder afterPack hook: ad-hoc sign the macOS .app bundle before it
// is packaged into a DMG or ZIP. This replaces the hard "damaged and can't be
// opened" Gatekeeper block with the softer "unidentified developer" prompt that
// users can bypass with right-click → Open, without needing a Terminal command.
//
// Ad-hoc signing (--sign -) does not require a certificate and is distinct from
// App Store / notarized signing. It satisfies macOS code signature requirements
// without being trusted by Gatekeeper's CA chain.

const { execSync } = require('child_process');
const path = require('path');

exports.default = async function codesignAdHoc({ appOutDir, packager }) {
  if (packager.platform.name !== 'mac') return;
  const appPath = path.join(appOutDir, `${packager.appInfo.productName}.app`);

  // codesign --deep traverses nested executables (Electron framework, helpers)
  // and fails with "detritus not allowed" if any file has a resource fork or
  // extended attribute. Two sources of detritus need clearing:
  //   1. ._* files — resource fork proxy files macOS creates on non-HFS+ copies
  //   2. Extended attributes on regular files (com.apple.FinderInfo etc.)
  // xattr -cr alone misses ._* files; find + delete handles them explicitly.
  // xargs -0 on non-symlinks avoids xattr choking on symlinks inside frameworks.
  console.log(`[codesign-ad-hoc] Removing ._* resource fork files from ${appPath}`);
  execSync(`find ${JSON.stringify(appPath)} -name "._*" -delete`);
  console.log(`[codesign-ad-hoc] Clearing xattrs on ${appPath}`);
  execSync(`find ${JSON.stringify(appPath)} -not -type l -print0 | xargs -0 xattr -c`);
  console.log(`[codesign-ad-hoc] Signing ${appPath}`);
  execSync(`codesign --sign - --deep --force ${JSON.stringify(appPath)}`);
};
