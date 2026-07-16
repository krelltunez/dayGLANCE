import { describe, it, expect } from 'vitest';
import { shouldQuitOnAllWindowsClosed } from './startupQuit.js';

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
