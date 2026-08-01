import { describe, it, expect, vi } from 'vitest';
import {
  createCalendarCache,
  isFresh,
  accessTtlMs,
  shouldCacheCalendars,
  CALENDAR_LIST_TTL_MS,
  ACCESS_DENIAL_TTL_MS,
} from './calendarCache.js';

// Every calendar:* IPC call spawns the Swift helper via execFile — one process
// per call. Both renderers hit those handlers independently (the tray popup runs
// the same App tree as the main window), so a tray reload used to repeat the
// access + calendar-list spawns the main window had already done. These tests
// pin the spawn count, which is the whole point of the cache.

// A stub for the "real spawn" callback. Counting calls IS the assertion: one
// call here == one helper process in production.
function spawnCounter<T>(value: T) {
  const fn = vi.fn(async () => value);
  return fn;
}

// Injectable clock so TTL expiry is tested without waiting.
function fakeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe('isFresh', () => {
  it('treats a missing entry as stale', () => {
    expect(isFresh(null, 0, 1000)).toBe(false);
  });

  it('serves an entry inside its TTL and not at/after it', () => {
    const entry = { value: 'x', storedAt: 100 };
    expect(isFresh(entry, 100, 1000)).toBe(true);
    expect(isFresh(entry, 1099, 1000)).toBe(true);
    expect(isFresh(entry, 1100, 1000)).toBe(false); // boundary is exclusive
    expect(isFresh(entry, 5000, 1000)).toBe(false);
  });

  it('never caches with a non-positive TTL', () => {
    expect(isFresh({ value: 'x', storedAt: 100 }, 100, 0)).toBe(false);
    expect(isFresh({ value: 'x', storedAt: 100 }, 100, -1)).toBe(false);
  });

  it('never expires with an infinite TTL', () => {
    expect(isFresh({ value: 'x', storedAt: 0 }, Number.MAX_SAFE_INTEGER, Number.POSITIVE_INFINITY)).toBe(true);
  });

  it('treats a backwards clock jump as stale rather than infinitely fresh', () => {
    // NTP correction / wake in a new timezone. One extra spawn beats a value
    // that can never expire.
    expect(isFresh({ value: 'x', storedAt: 5000 }, 1000, 1_000_000)).toBe(false);
  });
});

describe('accessTtlMs', () => {
  it('keeps a grant for the process lifetime', () => {
    expect(accessTtlMs(true)).toBe(Number.POSITIVE_INFINITY);
  });

  it('keeps a denial only briefly, so System Settings changes are noticed', () => {
    expect(accessTtlMs(false)).toBe(ACCESS_DENIAL_TTL_MS);
    expect(ACCESS_DENIAL_TTL_MS).toBeLessThanOrEqual(30_000);
  });
});

describe('shouldCacheCalendars', () => {
  it('caches a non-empty list', () => {
    expect(shouldCacheCalendars([{ id: 'a' }])).toBe(true);
  });

  it('does NOT cache an empty list', () => {
    // "No calendars loaded — tap Refresh" is the state the Settings refresh
    // button exists to recover from; caching it would make that button look broken.
    expect(shouldCacheCalendars([])).toBe(false);
  });

  it('does NOT cache a non-array (helper returned junk)', () => {
    expect(shouldCacheCalendars(null)).toBe(false);
    expect(shouldCacheCalendars({ nope: true })).toBe(false);
  });
});

describe('createCalendarCache — requestAccess', () => {
  it('miss spawns, hit does not', async () => {
    const clock = fakeClock();
    const cache = createCalendarCache({ now: clock.now });
    const spawn = spawnCounter({ granted: true });

    expect(await cache.requestAccess(spawn)).toEqual({ granted: true });
    expect(spawn).toHaveBeenCalledTimes(1); // miss → one helper process

    expect(await cache.requestAccess(spawn)).toEqual({ granted: true });
    expect(spawn).toHaveBeenCalledTimes(1); // hit → still one
  });

  it('keeps a grant indefinitely — a tray reload an hour later spawns nothing', async () => {
    const clock = fakeClock();
    const cache = createCalendarCache({ now: clock.now });
    const spawn = spawnCounter({ granted: true });

    await cache.requestAccess(spawn);
    clock.advance(60 * 60 * 1000);
    await cache.requestAccess(spawn);

    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('does NOT cache a denial for long — re-spawns once the short TTL lapses', async () => {
    const clock = fakeClock();
    const cache = createCalendarCache({ now: clock.now });
    const spawn = spawnCounter({ granted: false });

    await cache.requestAccess(spawn);
    expect(spawn).toHaveBeenCalledTimes(1);

    // Still inside the denial window — reused.
    clock.advance(ACCESS_DENIAL_TTL_MS - 1);
    await cache.requestAccess(spawn);
    expect(spawn).toHaveBeenCalledTimes(1);

    // Past it — the user may have granted access in System Settings meanwhile.
    clock.advance(2);
    await cache.requestAccess(spawn);
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('picks up a grant issued after an earlier denial', async () => {
    const clock = fakeClock();
    const cache = createCalendarCache({ now: clock.now });
    const spawn = vi.fn()
      .mockResolvedValueOnce({ granted: false })
      .mockResolvedValueOnce({ granted: true });

    expect(await cache.requestAccess(spawn)).toEqual({ granted: false });
    clock.advance(ACCESS_DENIAL_TTL_MS + 1);
    expect(await cache.requestAccess(spawn)).toEqual({ granted: true });

    // And the grant now sticks.
    clock.advance(60 * 60 * 1000);
    expect(await cache.requestAccess(spawn)).toEqual({ granted: true });
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('de-duplicates concurrent callers into one spawn', async () => {
    // The main window and the tray popup mount within the same second at launch.
    const clock = fakeClock();
    const cache = createCalendarCache({ now: clock.now });
    const spawn = spawnCounter({ granted: true });

    const [a, b] = await Promise.all([cache.requestAccess(spawn), cache.requestAccess(spawn)]);

    expect(a).toEqual({ granted: true });
    expect(b).toEqual({ granted: true });
    expect(spawn).toHaveBeenCalledTimes(1);
  });
});

describe('createCalendarCache — getCalendars', () => {
  const CALS = [{ id: 'work' }, { id: 'home' }];

  it('miss spawns, hit does not', async () => {
    const clock = fakeClock();
    const cache = createCalendarCache({ now: clock.now });
    const spawn = spawnCounter(CALS);

    expect(await cache.getCalendars(spawn)).toEqual(CALS);
    expect(spawn).toHaveBeenCalledTimes(1);

    expect(await cache.getCalendars(spawn)).toEqual(CALS);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('re-spawns once the TTL expires', async () => {
    const clock = fakeClock();
    const cache = createCalendarCache({ now: clock.now });
    const spawn = spawnCounter(CALS);

    await cache.getCalendars(spawn);

    clock.advance(CALENDAR_LIST_TTL_MS - 1);
    await cache.getCalendars(spawn);
    expect(spawn).toHaveBeenCalledTimes(1); // still fresh

    clock.advance(2);
    await cache.getCalendars(spawn);
    expect(spawn).toHaveBeenCalledTimes(2); // expired → re-spawn
  });

  it('never caches an empty list, so every call retries', async () => {
    const clock = fakeClock();
    const cache = createCalendarCache({ now: clock.now });
    const spawn = spawnCounter([] as unknown[]);

    await cache.getCalendars(spawn);
    await cache.getCalendars(spawn);
    await cache.getCalendars(spawn);

    expect(spawn).toHaveBeenCalledTimes(3);
  });

  it('force bypasses a fresh entry — the Settings Refresh button', async () => {
    const clock = fakeClock();
    const cache = createCalendarCache({ now: clock.now });
    const spawn = spawnCounter(CALS);

    await cache.getCalendars(spawn);
    expect(spawn).toHaveBeenCalledTimes(1);

    await cache.getCalendars(spawn, true);
    expect(spawn).toHaveBeenCalledTimes(2); // refreshed despite being fresh
  });

  it('force refills the cache rather than just bypassing it', async () => {
    const clock = fakeClock();
    const cache = createCalendarCache({ now: clock.now });
    const spawn = vi.fn()
      .mockResolvedValueOnce([{ id: 'old' }])
      .mockResolvedValueOnce([{ id: 'old' }, { id: 'new' }]);

    await cache.getCalendars(spawn);
    expect(await cache.getCalendars(spawn, true)).toEqual([{ id: 'old' }, { id: 'new' }]);

    // Subsequent non-forced reads see the refreshed list without spawning again.
    expect(await cache.getCalendars(spawn)).toEqual([{ id: 'old' }, { id: 'new' }]);
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('de-duplicates concurrent callers into one spawn', async () => {
    const clock = fakeClock();
    const cache = createCalendarCache({ now: clock.now });
    const spawn = spawnCounter(CALS);

    await Promise.all([cache.getCalendars(spawn), cache.getCalendars(spawn)]);

    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('a rejected spawn does not poison later calls', async () => {
    const clock = fakeClock();
    const cache = createCalendarCache({ now: clock.now });
    const spawn = vi.fn()
      .mockRejectedValueOnce(new Error('helper missing'))
      .mockResolvedValueOnce(CALS);

    await expect(cache.getCalendars(spawn)).rejects.toThrow('helper missing');
    expect(await cache.getCalendars(spawn)).toEqual(CALS);
  });
});

describe('createCalendarCache — shared across renderers', () => {
  it('one instance serves both windows: 2 spawns for a launch, 0 for a tray reload', async () => {
    // The scenario this whole change exists for. Main window mounts (access +
    // calendars), then the tray popup mounts and reloads repeatedly.
    const clock = fakeClock();
    const cache = createCalendarCache({ now: clock.now });
    const accessSpawn = spawnCounter({ granted: true });
    const calendarsSpawn = spawnCounter([{ id: 'work' }]);

    // Main window mount.
    await cache.requestAccess(accessSpawn);
    await cache.getCalendars(calendarsSpawn);

    // Tray popup mount, then three reloads.
    for (let i = 0; i < 4; i++) {
      await cache.requestAccess(accessSpawn);
      await cache.getCalendars(calendarsSpawn);
    }

    expect(accessSpawn).toHaveBeenCalledTimes(1);
    expect(calendarsSpawn).toHaveBeenCalledTimes(1);
  });
});
