// The local date rules, on their own entry point (@glance-apps/mcp-host/dates)
// so code that runs in a browser bundle can use them without loading the
// listener and node:http. The package root re-exports them.

/** Strict YYYY-MM-DD of a date that exists. */
export function isValidLocalDate(value: unknown): value is string;

/** The local calendar date of `epochMs` in `timeZone`, as YYYY-MM-DD. */
export function localDateOf(epochMs: number, timeZone: string): string;

/** The local wall-clock time of `epochMs` in `timeZone`, as minutes since local midnight (0-1439). */
export function localMinutesOf(epochMs: number, timeZone: string): number;

/** The `{date, timezone}` echo every dated tool response carries (§5.3). */
export interface DateEnvelope {
  /** The resolved local calendar date the response is about. */
  date: string;
  /** The IANA timezone the server resolved (e.g. "America/Chicago"). */
  timezone: string;
}

export function dateEnvelope(date: string, timeZone: string): DateEnvelope;
