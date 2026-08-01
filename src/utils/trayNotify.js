import { useEffect, useRef } from 'react';
import { isTrayMode } from './trayMode.js';

// The macOS tray popup renders from a snapshot of localStorage taken at its last
// reload, so it has to be told when a value it reads has changed. This module is
// the ONE definition of that nudge — never inline
// `window.electronAPI?.notifyDataChanged?.()` at a call site.
//
// The tray guard lives here rather than at each call site because the popup runs
// the same App tree as the main window, so every persist effect that emits also
// runs inside the tray. Guarding centrally means a new call site cannot forget it
// and send the popup into a reload loop. The predicate itself lives in
// trayMode.js — this module is one of its consumers, not its owner.

// Off-safe everywhere: no-ops on web (no electronAPI), under SSR/tests (no
// window), and inside the tray popup itself.
export function notifyTrayDataChanged() {
  if (isTrayMode) return;
  if (typeof window === 'undefined') return;
  window.electronAPI?.notifyDataChanged?.();
}

// Nudge the tray whenever `value` changes, skipping the mount pass.
//
// The mount skip is the point of the hook: every persist effect in the app fires
// once on mount with the value it just read back out of localStorage. Emitting
// there would reload the tray popup on every main-window load, which is exactly
// the wasted reload this signal exists to avoid.
export function useNotifyTrayOnChange(value) {
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    notifyTrayDataChanged();
  }, [value]);
}
