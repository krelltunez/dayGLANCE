// electron-builder afterSign hook: submit the signed .app to Apple's
// notary service and staple the ticket so Gatekeeper accepts it offline.
//
// Only runs when CSC_LINK is set (i.e. a real Developer ID build).
// The afterPack ad-hoc hook still runs first; this runs after codesign.
//
// Required env vars (set in CI secrets or a local .env.release file):
//   APPLE_ID                     your Apple ID email
//   APPLE_APP_SPECIFIC_PASSWORD  app-specific password from appleid.apple.com
//   APPLE_TEAM_ID                10-char Team ID from developer.apple.com/account

const { notarize } = require('@electron/notarize');
const path = require('path');

exports.default = async function notarizeApp({ appOutDir, packager, electronPlatformName }) {
  if (packager.platform.name !== 'mac') return;
  // MAS builds are distributed through the App Store, which runs its own
  // notarization — never submit them to the notary service (it would fail).
  // electronPlatformName is 'mas' for App Store targets and 'darwin' otherwise.
  if (electronPlatformName === 'mas') return;
  if (!process.env.CSC_LINK) return; // skip ad-hoc / dev builds

  const appPath = path.join(appOutDir, `${packager.appInfo.productName}.app`);
  console.log(`[notarize] Submitting ${appPath} to Apple notary service…`);

  await notarize({
    appPath,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  });

  console.log('[notarize] Notarization complete.');
};
