import { useCallback, useRef, useState } from 'react';
import { schedulePush as scheduleVaultPush } from '../sync/dirtyTracker.js';
import {
  DAY_WINDOWS_STORAGE_KEY,
  DEFAULTS_KEY,
  migrateDayWindows,
  mergeDayWindowMaps,
  resolveDayWindow,
} from '../sync/dayWindowSync.js';

// Per-day START/STOP markers for the timeline — the user's declared day window,
// set directly on the timeline (via the summary strip's day-window menu) rather
// than in settings. The summary strip measures unblocked time against it.
//
// STICKY-FORWARD SEMANTICS: setting a day's window also becomes the default for
// every day without its own entry (the alarm-clock mental model — you adjust
// today and tomorrow inherits it). Clearing writes an explicit "off" entry for
// that day only, so one quiet Sunday doesn't erase the defaults. In storage the
// default is just the reserved 'defaults' entry of the same map, so it syncs
// LWW like any date and needs no special casing anywhere.
//
// SYNCED: the map rides the sync payload as `dayWindows` — merged per-entry
// LWW on the file tier (mergeSync.js) and as a vault singleton bundle
// (dbAdapter.js), all through the shared primitives in sync/dayWindowSync.js.
// Shape, migration from the phase-A device-local format, and resolution live
// there too. iOS/Android inherit automatically: they run this same App tree.

export default function useDayWindows() {
  const [windows, setWindows] = useState(() => {
    try {
      return migrateDayWindows(JSON.parse(localStorage.getItem(DAY_WINDOWS_STORAGE_KEY) || 'null'));
    } catch {
      return {};
    }
  });

  // buildSyncPayload runs from render-time closures that can be a beat stale;
  // the ref always reads the freshest map.
  const windowsRef = useRef(windows);
  windowsRef.current = windows;

  // Persist inside the mutators, not an on-change effect: the tray popup runs
  // this hook too (same App tree), and an effect would write on tray mount.
  // Mutators are unreachable from the tray — it renders no timeline — so writes
  // stay main-window-only without needing the tray guard.
  const persist = (next) => {
    try { localStorage.setItem(DAY_WINDOWS_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  };

  /** Resolved window for a date: {start, stop} with 'HH:MM'|null fields, or null when none applies. */
  const getDayWindow = useCallback((dateStr) => resolveDayWindow(windows, dateStr), [windows]);

  /**
   * Set a day's window; sticky-forward, so it also becomes the default. Both
   * entries are stamped so the edit wins LWW on every other device.
   */
  const setDayWindow = useCallback((dateStr, { start = null, stop = null }) => {
    const stamp = new Date().toISOString();
    setWindows((prev) => persist({
      ...prev,
      [dateStr]: { start, stop, lastModified: stamp },
      [DEFAULTS_KEY]: { start, stop, lastModified: stamp },
    }));
    // Push-on-write to the vault (debounced, off-safe no-op when disabled).
    // The file tier picks the change up via its own effect deps in App.jsx.
    scheduleVaultPush();
  }, []);

  /**
   * Explicitly no window for this day; defaults stay intact for other days.
   * An explicit-off ENTRY, not a deletion — which is why this slice needs no
   * tombstones to make clears propagate.
   */
  const clearDayWindow = useCallback((dateStr) => {
    setWindows((prev) => persist({
      ...prev,
      [dateStr]: { start: null, stop: null, lastModified: new Date().toISOString() },
    }));
    scheduleVaultPush();
  }, []);

  /**
   * Merge a pulled map into local state (per-entry LWW; local wins ties).
   * Called from applyPayload on every sync apply — NOT a user edit, so it never
   * schedules a push itself; echo suppression is the sync engines' concern.
   */
  const applyRemoteDayWindows = useCallback((remoteMap) => {
    setWindows((prev) => {
      const merged = mergeDayWindowMaps(prev, migrateDayWindows(remoteMap));
      return merged === prev ? prev : persist(merged);
    });
  }, []);

  return { dayWindows: windows, dayWindowsRef: windowsRef, getDayWindow, setDayWindow, clearDayWindow, applyRemoteDayWindows };
}
