// When the TRMNL auto-sync may push, and how it backs off. Pure, so the
// rules are tested where they live.
//
// Field incident, 2026-09-08: the device had not updated since August 30.
// Every push was answered 429. The auto-sync was keyed on array identity, and
// the sync engine hands out new arrays on nearly every cycle, so the push ran
// at the throttle's cadence around the clock whether or not anything on the
// screen had changed; the payload carried the clock, so no two pushes were
// ever equal; and the backoff lived in memory, so every launch started again
// at full speed. The webhook limit is per plugin, shared by every pusher.
//
// Rules:
//   - push when the CONTENT changed: the payload minus its clock-driven
//     fields (the time of day, and the overdue/upcoming/next/past marks that
//     move as the day goes on without anyone touching anything);
//   - never two pushes closer than TRMNL_MIN_GAP_MS;
//   - unchanged content is refreshed no more than every TRMNL_TIME_REFRESH_MS,
//     which is how often the display redraws anyway, so the clock marks stay
//     roughly right;
//   - a 429 backs off exponentially from 5 min, capped at 60, and never
//     shorter than the server's Retry-After; the backoff and the last push
//     time are persisted so a relaunch resumes the wait instead of resetting it.

export const TRMNL_MIN_GAP_MS = 5 * 60 * 1000;
export const TRMNL_TIME_REFRESH_MS = 15 * 60 * 1000;
export const TRMNL_BACKOFF_BASE_MS = 5 * 60 * 1000;
export const TRMNL_BACKOFF_MAX_MS = 60 * 60 * 1000;
export const TRMNL_PUSH_STATE_KEY = 'day-planner-trmnl-push-state';

const CLOCK_FIELDS = new Set(['current_time', 'overdue', 'upcoming', 'next_task']);

/** The payload with every clock-driven field removed, as a comparable string. */
export function trmnlContentFingerprint(mergeVars) {
  const out = {};
  for (const [k, v] of Object.entries(mergeVars || {})) {
    if (CLOCK_FIELDS.has(k)) continue;
    out[k] = k === 'schedule' && Array.isArray(v)
      ? v.map((row) => { const { past: _past, ...rest } = row || {}; return rest; })
      : v;
  }
  return JSON.stringify(out);
}

/**
 * @returns {{ push: boolean, reason: string, waitMs?: number }}
 *   push=false carries waitMs: how long until this decision could change on
 *   its own (the floor or the refresh interval expiring, or the backoff ending).
 */
export function trmnlPushDecision({ now, fingerprint, lastFingerprint, lastPushAt = 0, backoffUntil = 0, manual = false }) {
  if (manual) return { push: true, reason: 'manual' };
  if (backoffUntil > now) return { push: false, reason: 'backoff', waitMs: backoffUntil - now };
  const since = now - (lastPushAt || 0);
  if (fingerprint !== lastFingerprint) {
    if (since >= TRMNL_MIN_GAP_MS) return { push: true, reason: 'changed' };
    return { push: false, reason: 'floor', waitMs: TRMNL_MIN_GAP_MS - since };
  }
  if (since >= TRMNL_TIME_REFRESH_MS) return { push: true, reason: 'time-refresh' };
  return { push: false, reason: 'unchanged', waitMs: TRMNL_TIME_REFRESH_MS - since };
}

/** The backoff after a 429: exponential from the base, capped, never shorter than Retry-After. */
export function trmnlBackoffAfterRateLimit({ now, count = 0, retryAfterSeconds = null }) {
  const next = (count || 0) + 1;
  const exponential = Math.min(TRMNL_BACKOFF_BASE_MS * 2 ** (next - 1), TRMNL_BACKOFF_MAX_MS);
  const hinted = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : 0;
  return { count: next, until: now + Math.max(exponential, hinted) };
}

/** Parse a Retry-After header (delay-seconds or an HTTP date) into seconds, or null. */
export function parseRetryAfter(value, now = Date.now()) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  if (/^\d+$/.test(s)) return Number(s);
  const at = Date.parse(s);
  return Number.isNaN(at) ? null : Math.max(0, Math.ceil((at - now) / 1000));
}

const EMPTY = { lastPushAt: 0, backoffUntil: 0, backoffCount: 0, lastFingerprint: null };

export function readTrmnlPushState(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(TRMNL_PUSH_STATE_KEY);
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === 'object' ? { ...EMPTY, ...v } : { ...EMPTY };
  } catch { return { ...EMPTY }; }
}

export function writeTrmnlPushState(state, storage = globalThis.localStorage) {
  try { storage?.setItem(TRMNL_PUSH_STATE_KEY, JSON.stringify({ ...EMPTY, ...state })); } catch { /* storage unavailable */ }
}
