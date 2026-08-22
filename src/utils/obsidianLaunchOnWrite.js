/**
 * Launch-on-write (Obsidian build-out Phase 1): device-local setting helpers.
 *
 * The toggle deliberately lives OUTSIDE obsidianConfig. obsidianConfig
 * cloud-syncs, and between non-native devices the incoming copy wholesale
 * replaces the local one (see applySyncedData in App.jsx) — a launchOnWrite
 * field inside it would leak a Mac's "on" to a Windows machine and defeat the
 * per-platform defaults. A separate `day-planner-*` key is captured by local
 * device backups via the prefix rule in utils/deviceSettings.js while staying
 * out of the cloud payload — the same posture as darkMode and reminderSettings.
 *
 * Stored value is a tri-state: 'on' | 'off' | absent. Absent means the
 * platform default, so changing a default never fights an explicit choice.
 */

export const OBSIDIAN_LAUNCH_ON_WRITE_KEY = 'day-planner-obsidian-launch-on-write';

/**
 * Platform default for launch-on-write. On only on macOS, where
 * `{ activate: false }` launches Obsidian without stealing focus. Windows has
 * no background launch (Obsidian takes focus), Linux obsidian:// handler
 * registration is unreliable (AppImage installs), and Android fires a
 * foreground intent — all default off.
 *
 * If `activate: false` turns out to steal focus under the Mac App Store
 * sandbox, the fallback is flipping the macOS default off — a one-line change
 * here and nowhere else.
 *
 * @param platform `process.platform` on Electron ('darwin' | 'win32' |
 *   'linux'), or 'android' for the native bridge.
 */
export function defaultLaunchOnWrite(platform) {
  return platform === 'darwin';
}

/** Resolve the stored tri-state; anything but 'on'/'off' means unset. */
export function effectiveLaunchOnWrite(stored, platform) {
  if (stored === 'on') return true;
  if (stored === 'off') return false;
  return defaultLaunchOnWrite(platform);
}
