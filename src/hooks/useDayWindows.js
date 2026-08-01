import { useCallback, useState } from 'react';

// Per-day START/STOP markers for the timeline — the user's declared day window,
// set directly on the timeline (via the summary strip's day-window menu) rather
// than in settings. The summary strip measures unblocked time against it.
//
// STICKY-FORWARD SEMANTICS: setting a day's window also becomes the default for
// every day without its own entry (the alarm-clock mental model — you adjust
// today and tomorrow inherits it). Clearing writes an explicit "off" entry for
// that day only, so one quiet Sunday doesn't erase the defaults.
//
// Resolution order per date: explicit entry (including explicit off) → defaults
// → none. A consequence worth stating: past days without an explicit entry
// resolve to the CURRENT defaults, not whatever the defaults were at the time.
// Freezing history would require stamping every day as it passes; not worth it
// until something (weekly review?) consumes historical windows.
//
// DEVICE-LOCAL, deliberately: syncing this needs a file-tier merge rule, a
// GLANCEvault _kind, and iOS awareness — its own change. Until then two devices
// can disagree about a day's window; the blocks themselves still sync.

const STORAGE_KEY = 'day-planner-day-windows';

// Shape: { defaults: {start,stop}|null, byDate: { 'YYYY-MM-DD': {start,stop} } }
// where start/stop are 'HH:MM' or null (explicit off).
function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (raw && typeof raw === 'object') {
      return { defaults: raw.defaults ?? null, byDate: raw.byDate ?? {} };
    }
  } catch { /* corrupt — start fresh */ }
  return { defaults: null, byDate: {} };
}

export default function useDayWindows() {
  const [windows, setWindows] = useState(load);

  // Persist inside the mutators, not an on-change effect: the tray popup runs
  // this hook too (same App tree), and an effect would write on tray mount.
  // Mutators are unreachable from the tray — it renders no timeline — so writes
  // stay main-window-only without needing the tray guard.
  const persist = (next) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  };

  /** Resolved window for a date: {start, stop} with 'HH:MM'|null fields, or null when none applies. */
  const getDayWindow = useCallback((dateStr) => {
    const entry = windows.byDate[dateStr];
    const w = entry !== undefined ? entry : windows.defaults;
    if (!w || (!w.start && !w.stop)) return null;
    return { start: w.start ?? null, stop: w.stop ?? null };
  }, [windows]);

  /** Set a day's window; sticky-forward, so it also becomes the default. */
  const setDayWindow = useCallback((dateStr, { start = null, stop = null }) => {
    setWindows((prev) => persist({
      defaults: { start, stop },
      byDate: { ...prev.byDate, [dateStr]: { start, stop } },
    }));
  }, []);

  /** Explicitly no window for this day; defaults stay intact for other days. */
  const clearDayWindow = useCallback((dateStr) => {
    setWindows((prev) => persist({
      defaults: prev.defaults,
      byDate: { ...prev.byDate, [dateStr]: { start: null, stop: null } },
    }));
  }, []);

  return { getDayWindow, setDayWindow, clearDayWindow };
}
