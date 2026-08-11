// Local wall-clock time semantics for MCP write tools (spec §5.3), extracted
// as pure functions in the mcpDates.ts style.
//
// THE §5.3 RULE THIS ENCODES: a schedule_task / move_block call landing in a
// nonexistent or ambiguous local hour returns a VALIDATION ERROR rather than
// silently picking one. Spring-forward deletes an hour (02:30 does not exist);
// fall-back repeats one (01:30 happens twice). dayGLANCE stores wall-clock
// strings, so what matters is not resolving an instant but refusing times the
// wall clock will not show (nonexistent) or will show twice (ambiguous) on
// that date — either would silently mean something other than what the model
// asked for.
//
// Everything takes the timezone as an ARGUMENT; Intl does the zone math.

/** Strict local wall-clock time: HH:MM, 24h, zero-padded. */
export function isValidWallTime(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** The wall-clock (hour, minute) that `epochMs` shows in `timeZone`. */
function wallClockAt(epochMs: number, timeZone: string): { h: number; m: number; date: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(epochMs));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { h: Number(get('hour')), m: Number(get('minute')), date: `${get('year')}-${get('month')}-${get('day')}` };
}

export type LocalTimeResolution =
  | { kind: 'unique' }
  | { kind: 'nonexistent' }   // spring-forward gap: the wall clock skips this time
  | { kind: 'ambiguous' };    // fall-back repeat: the wall clock shows this time twice

/**
 * Classify a local (date, HH:MM) in `timeZone`.
 *
 * Method: candidate UTC instants are derived from the zone offsets in effect
 * around that date (offset at local-noon ± 1 day covers every real transition;
 * no zone shifts more than a few hours). Each candidate that formats back to
 * exactly the requested wall time is a real occurrence: 0 occurrences →
 * nonexistent, 1 → unique, 2 → ambiguous.
 */
export function resolveLocalTime(date: string, time: string, timeZone: string): LocalTimeResolution {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);

  // Offsets in force shortly before and after: derive from how far the zone's
  // wall clock is from UTC at probe instants a day apart.
  const offsets = new Set<number>();
  for (const probe of [asUtc - 24 * 3600_000, asUtc, asUtc + 24 * 3600_000]) {
    const wc = wallClockAt(probe, timeZone);
    const wcUtc = Date.UTC(
      Number(wc.date.slice(0, 4)), Number(wc.date.slice(5, 7)) - 1, Number(wc.date.slice(8, 10)),
      wc.h, wc.m,
    );
    offsets.add(wcUtc - probe);
  }

  let occurrences = 0;
  for (const offset of offsets) {
    const candidate = asUtc - offset;
    const wc = wallClockAt(candidate, timeZone);
    if (wc.date === date && wc.h === h && wc.m === mi) occurrences++;
  }

  if (occurrences === 0) return { kind: 'nonexistent' };
  if (occurrences === 1) return { kind: 'unique' };
  return { kind: 'ambiguous' };
}

/**
 * Validate a wall-clock start for a given local date (§5.3). Returns null when
 * acceptable, or the validation message the tool returns verbatim.
 */
export function validateStartTime(date: string, time: string, timeZone: string): string | null {
  if (!isValidWallTime(time)) {
    return `start time must be local wall-clock HH:MM (24h, zero-padded), got ${JSON.stringify(time)}`;
  }
  const res = resolveLocalTime(date, time, timeZone);
  if (res.kind === 'nonexistent') {
    return `${time} does not exist on ${date} in ${timeZone} (DST skips it); pick a time outside the transition gap`;
  }
  if (res.kind === 'ambiguous') {
    return `${time} occurs twice on ${date} in ${timeZone} (DST repeats it); pick an unambiguous time`;
  }
  return null;
}

/** Duration bounds for schedule/resize: a block is 1 minute to 24 hours. */
export function validateDurationMinutes(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return `duration_minutes must be an integer, got ${JSON.stringify(value)}`;
  }
  if (value < 1 || value > 1440) {
    return `duration_minutes must be between 1 and 1440, got ${value}`;
  }
  return null;
}
