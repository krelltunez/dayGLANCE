// The Windows AppUserModelID (AUMID) dayGLANCE runs under (#2446).
//
// The taskbar groups windows, pins and jump lists by AUMID. The NSIS installer
// stamps every shortcut it writes with electron-builder's `appId`
// (electron-builder.config.cjs), but a process gets that ID only by being
// started from such a shortcut. Started from the exe, from an older shortcut,
// or from a pin Windows made off a running window, it ran as Electron's
// default (electron.app.dayGLANCE), and the same app showed up as two taskbar
// buttons. Setting it explicitly makes every launch path one application, and
// matches the Start Menu shortcut that Windows toast notifications look up.
//
// Must equal the Windows build's appId. The MAS build overrides appId with
// DAYGLANCE_APP_ID, which is why this is a constant and not read from there;
// windowsAppId.test.ts holds the two together.
export const WINDOWS_APP_USER_MODEL_ID = 'com.dayglance.app';

/** Whether this launch should set the AUMID: a packaged Windows build only. */
export function shouldSetAppUserModelId(platform: NodeJS.Platform, isPackaged: boolean): boolean {
  // Dev runs stay under Electron's default so an unpackaged window never groups
  // with (or takes the pin of) the installed app.
  return platform === 'win32' && isPackaged;
}
