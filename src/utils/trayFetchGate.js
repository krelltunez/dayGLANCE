// Should this renderer run the native (device) calendar event fetch?
//
// Extracted as a pure function so the gating rule is unit-testable without
// React or Electron (same pattern as electron/startupQuit.ts and
// electron/calendarCache.ts).
//
// WHY: every calendar:get-events call spawns the Swift EventKit helper as a
// child process. The tray popup runs the same App tree as the main window, so
// it repeats that spawn on each of its reloads — and those reloads are
// scheduled precisely when the popup is NOT on screen (electron/main.ts defers
// a reload to the next blur when it is visible). The common case was therefore
// a hidden popup spawning the helper for events nobody would look at.
//
// Visibility comes from the main process over `tray:visibility` rather than
// document.visibilityState: main.ts owns every show/hide call site, so it is
// the authority, and this avoids depending on how Chromium reports a hidden
// BrowserWindow's page visibility on macOS.
export function shouldFetchNativeEvents({ isTrayMode, popupVisible }) {
  // The main window is never gated. It is the renderer that owns sync, notifies
  // the tray, and serves the Stream Deck payload; its fetch must not depend on
  // an unrelated popup being on screen.
  if (!isTrayMode) return true;

  // In the tray, fetch only while the popup is actually on screen. Strict true
  // so the pre-IPC initial state (and any missing bridge) reads as "not visible"
  // — the popup is created hidden, so that is also the correct default.
  return popupVisible === true;
}
