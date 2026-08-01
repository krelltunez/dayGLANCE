import { describe, it, expect } from 'vitest';
import { shouldFetchNativeEvents } from './trayFetchGate.js';

// Each allowed fetch spawns the Swift EventKit helper as a child process. The
// tray popup runs the same App tree as the main window and reloads precisely
// when it is NOT on screen (main.ts defers a reload to the next blur while the
// popup is visible), so the pre-gate common case was a hidden popup spawning
// the helper for events nobody would see.

describe('shouldFetchNativeEvents', () => {
  describe('main window — never gated', () => {
    it('fetches regardless of the popup being off screen', () => {
      // The main window owns sync, the tray nudge and the Stream Deck payload;
      // its fetch must not depend on an unrelated popup's visibility.
      expect(shouldFetchNativeEvents({ isTrayMode: false, popupVisible: false })).toBe(true);
      expect(shouldFetchNativeEvents({ isTrayMode: false, popupVisible: true })).toBe(true);
      expect(shouldFetchNativeEvents({ isTrayMode: false, popupVisible: undefined })).toBe(true);
    });
  });

  describe('tray popup — gated on being on screen', () => {
    it('hidden suppresses the fetch', () => {
      expect(shouldFetchNativeEvents({ isTrayMode: true, popupVisible: false })).toBe(false);
    });

    it('visible allows the fetch', () => {
      expect(shouldFetchNativeEvents({ isTrayMode: true, popupVisible: true })).toBe(true);
    });

    it('transition hidden → visible flips the gate open', () => {
      // The renderer keeps popupVisible in the effect's dependency array, so
      // this flip is what re-runs the effect: events load on show rather than
      // waiting for selectedDate/calendarFilter to change.
      const hidden = shouldFetchNativeEvents({ isTrayMode: true, popupVisible: false });
      const shown = shouldFetchNativeEvents({ isTrayMode: true, popupVisible: true });
      expect([hidden, shown]).toEqual([false, true]);
    });

    it('treats unknown visibility as hidden', () => {
      // Pre-IPC initial state, and any build whose preload lacks the bridge.
      // The popup is created hidden, so "not yet told" and "hidden" agree.
      expect(shouldFetchNativeEvents({ isTrayMode: true, popupVisible: undefined })).toBe(false);
      expect(shouldFetchNativeEvents({ isTrayMode: true, popupVisible: null })).toBe(false);
    });

    it('requires a strict boolean true, not a truthy value', () => {
      expect(shouldFetchNativeEvents({ isTrayMode: true, popupVisible: 1 })).toBe(false);
      expect(shouldFetchNativeEvents({ isTrayMode: true, popupVisible: 'yes' })).toBe(false);
    });
  });
});
