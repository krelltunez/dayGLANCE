// Decision logic for the `window-all-closed` → `app.quit()` handler, extracted
// as a pure function so the startup-safety invariant can be unit-tested without
// booting Electron (same pattern as appProtocol.ts).
//
// THE BUG THIS ENCODES: startup runs migrateFileToAppStorage() BEFORE the main
// window is created, and that migration briefly opens then destroys hidden
// BrowserWindows (the file:// localStorage reader / app:// writer). Destroying
// the last of those fires `window-all-closed` while zero real windows exist yet.
// If the handler quits on that, the app exits mid-startup and never shows a
// window — the "installs but never launches" failure seen on Windows/Linux.
// macOS was unaffected only because it never quits on window-all-closed.

/**
 * Whether the `window-all-closed` event should quit the app.
 *
 *  - macOS (`darwin`): never — the app stays alive in the tray/dock and is
 *    reopened from there. (Matches long-standing platform convention.)
 *  - Windows/Linux: only once the real main window has been created. Before
 *    that, a `window-all-closed` can only be coming from a transient startup
 *    utility window, and quitting on it would kill the app before launch.
 *
 * @param platform          `process.platform`
 * @param mainWindowCreated whether `createWindow()` has run at least once
 */
export function shouldQuitOnAllWindowsClosed(
  platform: NodeJS.Platform,
  mainWindowCreated: boolean,
): boolean {
  if (platform === 'darwin') return false;
  return mainWindowCreated;
}

/**
 * Whether the `will-quit` teardown may call into globalShortcut (issue #1352).
 *
 * Every globalShortcut API throws "globalShortcut cannot be used before the
 * app is ready", and `will-quit` CAN fire before ready: electronmon's kill
 * sequence (hook.js exit -> reset) registers its own will-quit listener and
 * calls app.quit() the moment its reset message arrives, which during a slow
 * or colliding startup lands before app-ready.
 *
 * The throw is worse than the visible error dialog: it aborts the rest of the
 * synchronous will-quit emit chain, so listeners registered after ours never
 * run. Under electronmon the skipped listener is `app.exit(signal)`, and the
 * observed result is a "killed" app that resumes startup, creates its window,
 * and keeps holding the single-instance lock and the ws://7892 port the
 * restarted instance needs.
 *
 * Skipping the unregister before ready loses nothing: hotkeys are registered
 * only via renderer IPC (set-global-hotkey / set-main-window-hotkey), which
 * requires a ready app with a loaded window, so before ready there is nothing
 * registered to clean up.
 *
 * @param appIsReady `app.isReady()` at the moment `will-quit` fires
 */
export function shouldUnregisterShortcutsOnQuit(appIsReady: boolean): boolean {
  return appIsReady;
}
