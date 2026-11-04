// Local wall-clock time semantics for MCP write tools (dayGLANCE MCP spec
// §5.3), as pure functions in the dates.js style.
//
// THE §5.3 RULE THIS ENCODES: a write landing in a nonexistent or ambiguous
// local hour returns a VALIDATION ERROR rather than silently picking one.
// Spring-forward deletes an hour (02:30 does not exist); fall-back repeats one
// (01:30 happens twice). An app that stores wall-clock strings needs not an
// instant but a refusal of times the wall clock will not show (nonexistent) or
// will show twice (ambiguous) on that date — either would silently mean
// something other than what the model asked for.
//
// Everything takes the timezone as an ARGUMENT; Intl does the zone math.

/**
 * Strict local wall-clock time: HH:MM, 24h, zero-padded.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidWallTime(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** The wall-clock (hour, minute) that `epochMs` shows in `timeZone`. */
function wallClockAt(epochMs, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(epochMs));
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '';
  return { h: Number(get('hour')), m: Number(get('minute')), date: `${get('year')}-${get('month')}-${get('day')}` };
}

/**
 * Classify a local (date, HH:MM) in `timeZone`: `unique`, `nonexistent`
 * (spring-forward gap: the wall clock skips this time) or `ambiguous`
 * (fall-back repeat: the wall clock shows this time twice).
 *
 * Method: candidate UTC instants are derived from the zone offsets in effect
 * around that date (offset at local-noon ± 1 day covers every real transition;
 * no zone shifts more than a few hours). Each candidate that formats back to
 * exactly the requested wall time is a real occurrence: 0 occurrences →
 * nonexistent, 1 → unique, 2 → ambiguous.
 *
 * @param {string} date
 * @param {string} time
 * @param {string} timeZone
 * @returns {{ kind: 'unique' } | { kind: 'nonexistent' } | { kind: 'ambiguous' }}
 */
export function resolveLocalTime(date, time, timeZone) {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);

  // Offsets in force shortly before and after: derive from how far the zone's
  // wall clock is from UTC at probe instants a day apart.
  const offsets = new Set();
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
 *
 * @param {string} date
 * @param {string} time
 * @param {string} timeZone
 * @returns {string | null}
 */
export function validateStartTime(date, time, timeZone) {
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
