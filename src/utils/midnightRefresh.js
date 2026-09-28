// The nightly page reload that resets the timeline to the new day (App.jsx).
//
// WHY 30 SECONDS AFTER MIDNIGHT, NOT ONE: the routine day-rollover in
// useRoutines runs on the app clock tick, which fires every 15s at an
// arbitrary offset. A reload at 00:00:01 raced it — on the nights the tick
// landed inside that first second the in-app rollover ran and was torn down
// mid-flight by the reload; on every other night the reload won and the
// launch-on-a-new-day path handled the date change instead. Two code paths
// for one event, chosen by chance. That race is how a sync cycle once pushed
// yesterday's routine completions stamped at today's midnight (the seed of the
// routineCompletions push loop, PRs #1674 / #1679).
//
// 30s is past the worst-case first tick (14.99s), the file-tier upload
// debounce (5s) and a vault sync cycle, so the in-app rollover ALWAYS runs
// and settles before the reload. Longer buys nothing.
export const MIDNIGHT_REFRESH_OFFSET_SECONDS = 30;

// Milliseconds from `now` until the next local 00:00:30. Built from local
// setDate/setHours so a DST change overnight still lands on the local clock
// time, not 24h later.
export const msUntilMidnightRefresh = (now = new Date()) => {
  const target = new Date(now);
  target.setDate(target.getDate() + 1);
  target.setHours(0, 0, MIDNIGHT_REFRESH_OFFSET_SECONDS, 0);
  return target.getTime() - now.getTime();
};

// ── The view survives the nightly reload ─────────────────────────────────
// The reload resets the day, not the user's place: whichever view was on
// screen (desktop and phone alike) is handed across it in sessionStorage,
// which outlives a reload of the same tab, and the next start opens it
// instead of the default view. The note is read once and cleared, and one
// older than a couple of minutes is ignored, so an ordinary reload later on
// still opens the default. Storage can be unavailable; the reload then
// simply lands on the default view, as it always did.
export const MIDNIGHT_VIEW_KEY = 'dg-midnight-view';
const MIDNIGHT_VIEW_MAX_AGE_MS = 2 * 60 * 1000;

/** Just before the nightly reload: remember the views on screen. */
export const rememberViewsForMidnight = ({ desktop, mobile }, now = Date.now()) => {
  try { sessionStorage.setItem(MIDNIGHT_VIEW_KEY, JSON.stringify({ desktop, mobile, at: now })); } catch { /* default view instead */ }
};

/** On start: the views handed across the nightly reload, or null. */
export const readMidnightViews = (now = Date.now()) => {
  try {
    const saved = JSON.parse(sessionStorage.getItem(MIDNIGHT_VIEW_KEY) || 'null');
    if (!saved || typeof saved.at !== 'number' || now - saved.at > MIDNIGHT_VIEW_MAX_AGE_MS || now < saved.at) return null;
    return { desktop: saved.desktop ?? null, mobile: saved.mobile ?? null };
  } catch {
    return null;
  }
};

/** Once the start has read it: the handoff is spent. */
export const clearMidnightViews = () => {
  try { sessionStorage.removeItem(MIDNIGHT_VIEW_KEY); } catch { /* nothing to clear */ }
};
