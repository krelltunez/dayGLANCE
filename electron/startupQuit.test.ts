import { describe, it, expect } from 'vitest';
import { shouldQuitOnAllWindowsClosed, shouldUnregisterShortcutsOnQuit } from './startupQuit.js';

// Regression test for the Windows/Linux "installs but never launches" bug: the
// storage migration creates and destroys hidden BrowserWindows BEFORE the main
// window exists, firing window-all-closed with zero real windows. The handler
// must NOT quit in that state, or the process exits mid-startup.

describe('shouldQuitOnAllWindowsClosed', () => {
  describe('macOS — never quits on window-all-closed (stays in tray/dock)', () => {
    it('does not quit before the main window is created', () => {
      expect(shouldQuitOnAllWindowsClosed('darwin', false)).toBe(false);
    });
    it('does not quit after the main window is created either', () => {
      expect(shouldQuitOnAllWindowsClosed('darwin', true)).toBe(false);
    });
  });

  describe('Windows/Linux — must survive transient startup windows', () => {
    it('does NOT quit before the main window exists (the migration reader/writer case)', () => {
      // THE REGRESSION: a hidden migration window closing during startup must not
      // trip app.quit(). If this ever returns true again, Windows/Linux first
      // launch dies before showing a window.
      expect(shouldQuitOnAllWindowsClosed('win32', false)).toBe(false);
      expect(shouldQuitOnAllWindowsClosed('linux', false)).toBe(false);
    });

    it('DOES quit once the main window has been created and all windows later close', () => {
      expect(shouldQuitOnAllWindowsClosed('win32', true)).toBe(true);
      expect(shouldQuitOnAllWindowsClosed('linux', true)).toBe(true);
    });
  });
});

// Regression test for issue #1352: a will-quit that fires before app-ready
// (electronmon's kill sequence during a slow/colliding startup) must skip the
// globalShortcut teardown. globalShortcut throws before ready, and the throw
// aborts the rest of the synchronous will-quit emit chain: under electronmon
// the skipped listener is app.exit(signal), and the observed result was a
// "killed" app that resumed startup and kept the single-instance lock and the
// ws://7892 port, plus a modal error dialog from electronmon's
// uncaughtException handler.

describe('shouldUnregisterShortcutsOnQuit', () => {
  it('unregisters on a normal quit (app is ready)', () => {
    // If this returns false, every quit leaks registered global hotkeys until
    // the OS reclaims them at process exit.
    expect(shouldUnregisterShortcutsOnQuit(true)).toBe(true);
  });

  it('skips before app-ready: globalShortcut would throw and abort the quit', () => {
    // THE REGRESSION: returning true here re-introduces the issue #1352 throw.
    // Nothing is lost by skipping: hotkeys register via renderer IPC, which
    // requires a ready app, so pre-ready there is nothing to unregister.
    expect(shouldUnregisterShortcutsOnQuit(false)).toBe(false);
  });
});
