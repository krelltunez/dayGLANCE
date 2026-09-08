import { describe, it, expect } from 'vitest';
import {
  trmnlContentFingerprint, trmnlPushDecision, trmnlBackoffAfterRateLimit, parseRetryAfter,
  readTrmnlPushState, writeTrmnlPushState,
  TRMNL_MIN_GAP_MS, TRMNL_TIME_REFRESH_MS, TRMNL_BACKOFF_MAX_MS,
} from './trmnlPushPolicy.js';

const payload = (over = {}) => ({
  date: '2026-09-08', day_name: 'Tuesday', current_time: '1:51 PM', weather: '',
  schedule: [{ time: '9:00 AM', dur: '30m', title: 'Standup', done: true, pri: '', allDay: false, past: true }],
  total: 1, completed: 1, overdue: 0, pct: 100, time_planned: '30m',
  upcoming: [], next_task: null, inbox_count: 4, habits: [], routines: [], note: '',
  ...over,
});

describe('trmnlContentFingerprint', () => {
  it('ignores the clock: time of day, overdue, upcoming, next task, and the past marks', () => {
    const a = trmnlContentFingerprint(payload());
    const b = trmnlContentFingerprint(payload({
      current_time: '1:52 PM', overdue: 1, upcoming: [{ time: '3:00 PM', title: 'x' }], next_task: { time: '3:00 PM', title: 'x' },
      schedule: [{ ...payload().schedule[0], past: false }],
    }));
    expect(a).toBe(b);
  });

  it('changes when the content changes', () => {
    expect(trmnlContentFingerprint(payload({ inbox_count: 5 }))).not.toBe(trmnlContentFingerprint(payload()));
    expect(trmnlContentFingerprint(payload({ schedule: [{ ...payload().schedule[0], done: false }] }))).not.toBe(trmnlContentFingerprint(payload()));
  });
});

describe('trmnlPushDecision', () => {
  const now = 1_000_000_000_000;
  it('THE INCIDENT: unchanged content within the refresh window is not pushed', () => {
    const d = trmnlPushDecision({ now, fingerprint: 'f', lastFingerprint: 'f', lastPushAt: now - 60_000 });
    expect(d.push).toBe(false);
    expect(d.reason).toBe('unchanged');
    expect(d.waitMs).toBe(TRMNL_TIME_REFRESH_MS - 60_000);
  });

  it('changed content pushes once the floor has passed, and waits for it otherwise', () => {
    expect(trmnlPushDecision({ now, fingerprint: 'g', lastFingerprint: 'f', lastPushAt: now - TRMNL_MIN_GAP_MS })).toMatchObject({ push: true, reason: 'changed' });
    const d = trmnlPushDecision({ now, fingerprint: 'g', lastFingerprint: 'f', lastPushAt: now - 1000 });
    expect(d).toMatchObject({ push: false, reason: 'floor', waitMs: TRMNL_MIN_GAP_MS - 1000 });
  });

  it('unchanged content is refreshed after the refresh window', () => {
    expect(trmnlPushDecision({ now, fingerprint: 'f', lastFingerprint: 'f', lastPushAt: now - TRMNL_TIME_REFRESH_MS })).toMatchObject({ push: true, reason: 'time-refresh' });
  });

  it('a backoff in force blocks everything automatic until it ends', () => {
    const d = trmnlPushDecision({ now, fingerprint: 'g', lastFingerprint: 'f', lastPushAt: 0, backoffUntil: now + 5000 });
    expect(d).toMatchObject({ push: false, reason: 'backoff', waitMs: 5000 });
  });

  it('a manual sync always pushes', () => {
    expect(trmnlPushDecision({ now, fingerprint: 'f', lastFingerprint: 'f', lastPushAt: now, backoffUntil: now + 5000, manual: true })).toMatchObject({ push: true, reason: 'manual' });
  });

  it('a first run (no fingerprint yet) pushes', () => {
    expect(trmnlPushDecision({ now, fingerprint: 'f', lastFingerprint: null, lastPushAt: 0 })).toMatchObject({ push: true, reason: 'changed' });
  });
});

describe('trmnlBackoffAfterRateLimit', () => {
  const now = 1_000_000_000_000;
  it('doubles from 5 minutes and caps at 60', () => {
    let s = { count: 0 };
    const mins = [];
    for (let i = 0; i < 6; i++) { s = trmnlBackoffAfterRateLimit({ now, count: s.count }); mins.push((s.until - now) / 60000); }
    expect(mins).toEqual([5, 10, 20, 40, 60, 60]);
    expect(s.until - now).toBe(TRMNL_BACKOFF_MAX_MS);
  });

  it('never waits less than Retry-After', () => {
    const s = trmnlBackoffAfterRateLimit({ now, count: 0, retryAfterSeconds: 900 });
    expect(s.until - now).toBe(900_000);
    const t = trmnlBackoffAfterRateLimit({ now, count: 0, retryAfterSeconds: 30 });
    expect(t.until - now).toBe(5 * 60_000);
  });
});

describe('parseRetryAfter', () => {
  it('reads delay-seconds and HTTP dates, and rejects junk', () => {
    const now = Date.parse('2026-09-08T20:00:00Z');
    expect(parseRetryAfter('120')).toBe(120);
    expect(parseRetryAfter('Tue, 08 Sep 2026 20:10:00 GMT', now)).toBe(600);
    expect(parseRetryAfter('soon')).toBeNull();
    expect(parseRetryAfter(null)).toBeNull();
  });
});

describe('push state persistence', () => {
  it('round-trips and defaults on absence or junk', () => {
    const store = new Map();
    const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
    expect(readTrmnlPushState(storage)).toEqual({ lastPushAt: 0, backoffUntil: 0, backoffCount: 0, lastFingerprint: null });
    writeTrmnlPushState({ lastPushAt: 5, backoffUntil: 9, backoffCount: 2, lastFingerprint: 'f' }, storage);
    expect(readTrmnlPushState(storage)).toEqual({ lastPushAt: 5, backoffUntil: 9, backoffCount: 2, lastFingerprint: 'f' });
    store.set('day-planner-trmnl-push-state', '{oops');
    expect(readTrmnlPushState(storage).lastPushAt).toBe(0);
  });
});
