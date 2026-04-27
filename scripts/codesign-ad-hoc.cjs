// electron-builder afterPack hook: ad-hoc sign the macOS .app bundle before it
// is packaged into a DMG or ZIP. This replaces the hard "damaged and can't be
// opened" Gatekeeper block with the softer "unidentified developer" prompt that
// users can bypass with right-click → Open, without needing a Terminal command.
//
// Ad-hoc signing (--sign -) does not require a certificate and is distinct from
// App Store / notarized signing. It satisfies macOS code signature requirements
// without being trusted by Gatekeeper's CA chain.

const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function codesignAdHoc({ appOutDir, packager }) {
  if (packager.platform.name !== 'mac') return;
  const appPath = path.join(appOutDir, `${packager.appInfo.productName}.app`);
  // Strip extended attributes (resource forks, Finder metadata) — codesign
  // refuses to sign a bundle that contains them.
  console.log(`[codesign-ad-hoc] Clearing xattrs on ${appPath}`);
  execFileSync('xattr', ['-cr', appPath], { stdio: 'inherit' });
  console.log(`[codesign-ad-hoc] Signing ${appPath}`);
  execFileSync('codesign', ['--sign', '-', '--deep', '--force', appPath], { stdio: 'inherit' });
};
