// Spawn-avoidance cache for the macOS calendar helper, extracted from
// calendar.ts so the caching decisions can be unit-tested without spawning the
// Swift binary or booting Electron (same pattern as startupQuit.ts).
//
// WHY THIS EXISTS: every calendar:* IPC call runs execFile() against the helper
// binary — one process per call, no reuse. Both renderers hit those handlers
// independently: the tray popup runs the same App tree as the main window, so a
// tray reload repeats the access + calendar-list pair the main window already
// performed. Neither result changes often enough to justify that.
//
// Deliberately NOT cached here: calendar:get-events. It is parameterised by date
// range and is the query users expect to reflect edits immediately.

/** A cached value plus the clock reading at which it was stored. */
export interface TimedEntry<T> {
  value: T;
  storedAt: number;
}

/** Calendars change rarely, but they do change (a new subscription, a removed account). */
export const CALENDAR_LIST_TTL_MS = 5 * 60 * 1000;

/**
 * How long a DENIED access result may be reused.
 *
 * Deliberately short: the user can flip the permission in System Settings ›
 * Privacy & Security › Calendars at any moment and reasonably expects the app
 * to notice without a restart. A granted result, by contrast, is stable for the
 * process lifetime — macOS cannot silently downgrade it without terminating us.
 */
export const ACCESS_DENIAL_TTL_MS = 10 * 1000;

/**
 * Whether a cached entry may still be served.
 *
 * `ttlMs` of Infinity means "never expires"; a non-positive TTL means "never
 * cache". A negative age (the clock jumped backwards, e.g. an NTP correction or
 * a laptop waking in a new timezone) is treated as stale rather than as
 * infinitely fresh — the failure mode of one extra spawn is strictly better
 * than serving a value that never expires.
 */
export function isFresh<T>(entry: TimedEntry<T> | null, now: number, ttlMs: number): boolean {
  if (!entry) return false;
  if (ttlMs <= 0) return false;
  const age = now - entry.storedAt;
  if (age < 0) return false;
  return age < ttlMs;
}

/** Grants stick for the process lifetime; denials expire quickly. See ACCESS_DENIAL_TTL_MS. */
export function accessTtlMs(granted: boolean): number {
  return granted ? Number.POSITIVE_INFINITY : ACCESS_DENIAL_TTL_MS;
}

/**
 * Whether a calendar-list result is worth storing.
 *
 * An empty list is never cached. It is the exact state the "Refresh" button in
 * Settings › Device calendars exists to recover from ("No calendars loaded —
 * tap Refresh"), and caching it would make that button appear broken for the
 * whole TTL.
 */
export function shouldCacheCalendars(list: unknown): list is unknown[] {
  return Array.isArray(list) && list.length > 0;
}

export interface AccessResult { granted: boolean }

export interface CalendarCacheOptions {
  /** Injectable clock so tests can advance time without waiting. */
  now?: () => number;
  calendarListTtlMs?: number;
}

/**
 * Process-wide cache over the two idempotent helper calls.
 *
 * One instance is created at module scope in calendar.ts, so both renderers
 * share it — the cache is keyed by nothing at all, never by sender.
 *
 * Concurrent callers are also de-duplicated: the main window and the tray popup
 * mount within the same second at launch, so without single-flight they would
 * both miss the cache and both spawn. In-flight promises are shared and cleared
 * on settle, so a rejection never poisons later calls.
 */
export function createCalendarCache(opts: CalendarCacheOptions = {}) {
  const now = opts.now ?? Date.now;
  const calendarListTtlMs = opts.calendarListTtlMs ?? CALENDAR_LIST_TTL_MS;

  let access: TimedEntry<AccessResult> | null = null;
  let calendars: TimedEntry<unknown[]> | null = null;
  let accessInFlight: Promise<AccessResult> | null = null;
  let calendarsInFlight: Promise<unknown[]> | null = null;

  return {
    /**
     * `fetchAccess` performs the real spawn. It is only invoked on a miss, and
     * only once for concurrent callers.
     */
    async requestAccess(fetchAccess: () => Promise<AccessResult>): Promise<AccessResult> {
      if (access && isFresh(access, now(), accessTtlMs(access.value.granted))) return access.value;
      if (accessInFlight) return accessInFlight;

      accessInFlight = (async () => {
        const value = await fetchAccess();
        access = { value, storedAt: now() };
        return value;
      })();
      try {
        return await accessInFlight;
      } finally {
        accessInFlight = null;
      }
    },

    /**
     * `force` bypasses a fresh entry and refills it — wired to the Settings
     * "Refresh" button so an explicit user refresh always re-queries EventKit.
     */
    async getCalendars(fetchCalendars: () => Promise<unknown[]>, force = false): Promise<unknown[]> {
      if (!force && isFresh(calendars, now(), calendarListTtlMs)) return calendars!.value;
      if (!force && calendarsInFlight) return calendarsInFlight;

      const run = (async () => {
        const list = await fetchCalendars();
        if (shouldCacheCalendars(list)) calendars = { value: list, storedAt: now() };
        return list;
      })();
      if (!force) calendarsInFlight = run;
      try {
        return await run;
      } finally {
        if (calendarsInFlight === run) calendarsInFlight = null;
      }
    },

    /** Test/diagnostic aid — drops both entries. */
    reset(): void {
      access = null;
      calendars = null;
    },
  };
}
