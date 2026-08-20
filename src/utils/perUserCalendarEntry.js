/**
 * Decides what to write for this device's own entry in the per-user calendar
 * config map (calendarConfigByUser[meUserSyncId]) — or null for "don't write".
 *
 * Entries merge whole-entry last-writer-wins by updatedAt across the fleet, so
 * every write is a claim that THIS device holds the newest config. Two writes
 * must therefore never happen:
 *
 *  - a write whose content equals the stored entry — it would bump updatedAt
 *    for nothing, letting stale-but-restamped content beat a genuinely newer
 *    entry from another device;
 *  - a first write (no stored entry yet) of an EMPTY config — a fresh install
 *    knows nothing, and seeding {'', '', []} with a brand-new updatedAt wins
 *    LWW against the fleet's real entry, silently discarding every calendar
 *    configured on the user's other devices.
 *
 * @param {object|null|undefined} cur - the stored entry for this user, if any
 * @param {{syncUrl: string, taskCalendarUrl: string, icsCalendars: Array<object>, auth?: object}} desired
 * @param {string} nowIso - timestamp for the write
 * @returns {object|null} the entry to store, or null when no write should happen
 */
export function nextPerUserCalendarEntry(cur, desired, nowIso) {
  const sameContent = !!cur
    && (cur.syncUrl ?? '') === (desired.syncUrl ?? '')
    && (cur.taskCalendarUrl ?? '') === (desired.taskCalendarUrl ?? '')
    && JSON.stringify(cur.icsCalendars ?? []) === JSON.stringify(desired.icsCalendars ?? [])
    && JSON.stringify(cur.auth ?? null) === JSON.stringify(desired.auth ?? null);
  if (sameContent) return null;

  const empty = !desired.syncUrl && !desired.taskCalendarUrl
    && !(desired.icsCalendars || []).length && !desired.auth;
  if (!cur && empty) return null;

  return { ...desired, updatedAt: nowIso };
}
