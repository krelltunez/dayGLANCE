// Health-sourced habit-log filtering for the iCloud sync path.
//
// Apple guideline 5.1.3 forbids storing HealthKit-derived data in iCloud. Step
// and sleep counts pulled from the health store (HealthKit on iOS, Health
// Connect on Android) land in `habitLogs`, keyed by the health habit's id. Those
// counts are re-derived from the health store on every device, so stripping them
// from the iCloud payload loses nothing: the habit DEFINITION (name, target,
// unit, source) still syncs, and each device repopulates its own counts from its
// own health store. Only the derived COUNTS are excluded.
//
// This is applied to the iCloud transport only. WebDAV / GLANCEvault sync to the
// user's own server (not Apple iCloud) and are outside guideline 5.1.3; keeping
// health counts there also preserves cross-platform (e.g. Android → iOS) sync.

// A habit is "health-sourced" when its counts come from a device health store.
const HEALTH_SOURCES = new Set(['healthKit', 'healthConnect']);

/**
 * Set of habit ids (as strings) whose logs are health-store-derived.
 * @param {Array<{id?: any, source?: string}>} habits
 * @returns {Set<string>}
 */
export function healthSourcedHabitIds(habits = []) {
  const ids = new Set();
  for (const h of habits || []) {
    if (h && HEALTH_SOURCES.has(h.source)) ids.add(String(h.id));
  }
  return ids;
}

/**
 * Return a copy of `payload` with health-sourced habit-log entries (and their
 * sibling `habitLogTimestamps`) removed from `payload.data`. Pure: the input is
 * not mutated. Returns the input unchanged when there is nothing to strip (no
 * health habits, or no `habitLogs`).
 *
 * @param {{data?: {habitLogs?: object, habitLogTimestamps?: object}}} payload
 * @param {Array<{id?: any, source?: string}>} habits
 */
export function stripHealthSourcedLogs(payload, habits = []) {
  const healthIds = healthSourcedHabitIds(habits);
  const data = payload?.data;
  if (!healthIds.size || !data?.habitLogs) return payload;

  const habitLogs = {};
  for (const [dateStr, entries] of Object.entries(data.habitLogs)) {
    const kept = {};
    for (const [habitId, count] of Object.entries(entries || {})) {
      if (!healthIds.has(String(habitId))) kept[habitId] = count;
    }
    habitLogs[dateStr] = kept;
  }

  const nextData = { ...data, habitLogs };

  if (data.habitLogTimestamps) {
    const habitLogTimestamps = {};
    for (const [key, value] of Object.entries(data.habitLogTimestamps)) {
      // Keys are `${YYYY-MM-DD}:${habitId}`; the date part never contains ':',
      // so everything after the first ':' is the habit id.
      const habitId = key.slice(key.indexOf(':') + 1);
      if (!healthIds.has(String(habitId))) habitLogTimestamps[key] = value;
    }
    nextData.habitLogTimestamps = habitLogTimestamps;
  }

  return { ...payload, data: nextData };
}
