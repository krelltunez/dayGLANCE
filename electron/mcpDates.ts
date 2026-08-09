// Local-calendar-date semantics for the MCP tool surface (spec §5.3), extracted
// as pure functions so the correctness core of Phase 2 can be unit-tested
// without booting Electron (same pattern as startupQuit.ts / calendarCache.ts).
//
// THE §5.3 RULES THIS ENCODES:
//  - All dates in the tool surface are LOCAL calendar dates, YYYY-MM-DD, no
//    time component, no UTC, no offsets, no `Z`.
//  - Every response echoes the resolved date and the IANA timezone.
//  - The server never infers the current date from the client: `get_today`
//    resolves it here, from the machine clock and the machine timezone.
//
// Both functions take the clock reading and timezone as ARGUMENTS (injectable,
// like calendarCache's `now`), so tests can cross DST boundaries in any zone
// without touching process state.

/**
 * Strict local-calendar-date validation: exactly `YYYY-MM-DD`, and a date that
 * actually exists (2026-02-30 and 2026-13-01 are rejected; 2028-02-29 is
 * accepted — leap year). No time component, no offset, no `Z` — a client that
 * sends `2026-08-09T00:00:00Z` is asking a UTC question the tool surface
 * refuses to answer (§5.3).
 *
 * Note DST does NOT shorten the calendar: every local date exists even when
 * one of its wall-clock hours does not (2026-03-08 in America/Chicago has no
 * 02:30, but the DATE is valid). Nonexistent/ambiguous TIMES matter only for
 * Phase 3 writes.
 */
export function isValidLocalDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day >= 1 && day <= daysInMonth;
}

/**
 * The local calendar date of `epochMs` in `timeZone`, as `YYYY-MM-DD`.
 *
 * en-CA is the locale whose date format IS YYYY-MM-DD; Intl does the timezone
 * math (including DST) that hand-rolled offset arithmetic always gets wrong at
 * the boundaries. This is the ONLY place `get_today` resolves from — never the
 * client's idea of the date (§5.3).
 */
export function localDateOf(epochMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(epochMs));
}

/**
 * The `{date, timezone}` echo every dated tool response carries (§5.3).
 * Validation of caller-supplied dates happens BEFORE this — by construction an
 * envelope only ever contains a date this module produced or validated.
 */
export interface DateEnvelope {
  /** The resolved local calendar date the response is about. */
  date: string;
  /** The IANA timezone the server resolved (e.g. "America/Chicago"). */
  timezone: string;
}

export function dateEnvelope(date: string, timeZone: string): DateEnvelope {
  return { date, timezone: timeZone };
}
