// Is this renderer the macOS tray popup?
//
// The popup loads the SAME entry point as the main window with `?tray=1`
// appended (electron/main.ts createTrayWindow), so it runs the entire App tree.
// Every module that must behave differently there — skip a poll, skip a write,
// render the compact view — tests this predicate. It had been copy-pasted
// verbatim into 13 modules; this is the single definition.
//
// Evaluated once at module load, exactly as the copies it replaces were: the
// query string cannot change without a reload, and the popup is reloaded rather
// than navigated (see the 'tray:data-changed' handler in electron/main.ts).
//
// `window.location?.search ?? ''` rather than `window.location.search`: the
// optional chaining is what utils/trayNotify.js already used, and it keeps the
// predicate total under SSR/test environments where a stubbed `window` may have
// no `location`. In a browser the two are indistinguishable.
export const isTrayMode =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location?.search ?? '').has('tray');
