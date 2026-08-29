import { describe, it, expect } from 'vitest';
import { createLaunchScheduler, heartbeatSuppressesLaunch, LAUNCH_ON_WRITE_QUIET_MS } from './obsidianLaunch.js';

// The debounce contract for launch-on-write (spec §6 Phase 1): a burst of
// writes within the quiet window produces exactly one launch, writes separated
// by more than the window produce one each, and the toggle off produces none.
// Timers are injected as a deterministic fake so no test ever sleeps.

function fakeTimers() {
  let now = 0;
  let nextId = 1;
  const tasks = new Map<number, { at: number; fn: () => void }>();
  return {
    timers: {
      setTimeout: (fn: () => void, ms: number) => {
        const id = nextId++;
        tasks.set(id, { at: now + ms, fn });
        return id;
      },
      clearTimeout: (handle: unknown) => {
        tasks.delete(handle as number);
      },
    },
    advance(ms: number) {
      const target = now + ms;
      for (;;) {
        const due = [...tasks.entries()]
          .filter(([, t]) => t.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        tasks.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = target;
    },
  };
}

function setup(quietMs = LAUNCH_ON_WRITE_QUIET_MS) {
  const { timers, advance } = fakeTimers();
  const launches: string[] = [];
  const scheduler = createLaunchScheduler((p) => launches.push(p), quietMs, timers);
  return { scheduler, launches, advance };
}

describe('createLaunchScheduler', () => {
  it('coalesces a burst of writes within the quiet window into one launch of the last file', () => {
    const { scheduler, launches, advance } = setup();
    scheduler.setEnabled(true);
    scheduler.noteWrite('/vault/a.md');
    advance(3_000);
    scheduler.noteWrite('/vault/b.md');
    advance(3_000);
    scheduler.noteWrite('/vault/c.md');
    // 6s in, nothing yet — every write reset the window.
    expect(launches).toEqual([]);
    advance(LAUNCH_ON_WRITE_QUIET_MS);
    expect(launches).toEqual(['/vault/c.md']);
    // And nothing more fires later.
    advance(60_000);
    expect(launches).toEqual(['/vault/c.md']);
  });

  it('launches once per write when writes are separated by more than the window', () => {
    const { scheduler, launches, advance } = setup();
    scheduler.setEnabled(true);
    scheduler.noteWrite('/vault/a.md');
    advance(LAUNCH_ON_WRITE_QUIET_MS);
    scheduler.noteWrite('/vault/b.md');
    advance(LAUNCH_ON_WRITE_QUIET_MS);
    expect(launches).toEqual(['/vault/a.md', '/vault/b.md']);
  });

  it('produces no launch while disabled (the initial state)', () => {
    const { scheduler, launches, advance } = setup();
    scheduler.noteWrite('/vault/a.md');
    advance(60_000);
    expect(launches).toEqual([]);
    // Enabling later must not resurrect the ignored write.
    scheduler.setEnabled(true);
    advance(60_000);
    expect(launches).toEqual([]);
  });

  it('toggling off clears a pending launch', () => {
    const { scheduler, launches, advance } = setup();
    scheduler.setEnabled(true);
    scheduler.noteWrite('/vault/a.md');
    scheduler.setEnabled(false);
    advance(60_000);
    expect(launches).toEqual([]);
  });

  it('disconnect then a fresh pick: pending is dropped but the enabled flag is not left stale', () => {
    // The obsidian:disconnect / obsidian:pick handlers call cancelPending() —
    // a launch must not fire against a vault the user just swapped away from,
    // but the user's toggle survives the swap, so a write into the NEW vault
    // schedules normally.
    const { scheduler, launches, advance } = setup();
    scheduler.setEnabled(true);
    scheduler.noteWrite('/old-vault/a.md');
    scheduler.cancelPending(); // disconnect + pick of a different vault
    advance(60_000);
    expect(launches).toEqual([]);
    scheduler.noteWrite('/new-vault/b.md');
    advance(LAUNCH_ON_WRITE_QUIET_MS);
    expect(launches).toEqual(['/new-vault/b.md']);
  });

  it('flush fires a pending launch immediately, exactly once', () => {
    // App quit inside the quiet window: the edit still propagates.
    const { scheduler, launches, advance } = setup();
    scheduler.setEnabled(true);
    scheduler.noteWrite('/vault/a.md');
    scheduler.flush();
    expect(launches).toEqual(['/vault/a.md']);
    // The original timer was cancelled — no double fire.
    advance(60_000);
    expect(launches).toEqual(['/vault/a.md']);
  });

  it('flush with nothing pending is a no-op', () => {
    const { scheduler, launches } = setup();
    scheduler.setEnabled(true);
    scheduler.flush();
    expect(launches).toEqual([]);
  });
});

// ── Phase 5: heartbeat suppression at fire time ─────────────────────────────

function setupWithSuppress(quietMs = LAUNCH_ON_WRITE_QUIET_MS) {
  const { timers, advance } = fakeTimers();
  const launches: string[] = [];
  const state = { suppress: false as boolean, throwing: false };
  const scheduler = createLaunchScheduler((p) => launches.push(p), quietMs, timers, () => {
    if (state.throwing) throw new Error('probe broke');
    return state.suppress;
  });
  return { scheduler, launches, advance, state };
}

describe('heartbeat suppression (Phase 5)', () => {
  it('evaluated at FIRE time, not write time: Obsidian opening during the quiet window suppresses the pending launch', () => {
    const { scheduler, launches, advance, state } = setupWithSuppress();
    scheduler.setEnabled(true);
    scheduler.noteWrite('/vault/a.md'); // heartbeat stale at write…
    state.suppress = true;              // …Obsidian opens before the window expires
    advance(LAUNCH_ON_WRITE_QUIET_MS);
    expect(launches).toEqual([]);       // consumed, not deferred
    // A later write with Obsidian closed again fires normally.
    state.suppress = false;
    scheduler.noteWrite('/vault/b.md');
    advance(LAUNCH_ON_WRITE_QUIET_MS);
    expect(launches).toEqual(['/vault/b.md']);
  });

  it('flush (app quit) honors suppression too', () => {
    const { scheduler, launches, state } = setupWithSuppress();
    scheduler.setEnabled(true);
    scheduler.noteWrite('/vault/a.md');
    state.suppress = true;
    scheduler.flush();
    expect(launches).toEqual([]);
  });

  it('a broken probe never blocks the launch; no predicate behaves exactly as before Phase 5', () => {
    const { scheduler, launches, advance, state } = setupWithSuppress();
    scheduler.setEnabled(true);
    state.throwing = true;
    scheduler.noteWrite('/vault/a.md');
    advance(LAUNCH_ON_WRITE_QUIET_MS);
    expect(launches).toEqual(['/vault/a.md']);

    const plain = setup();
    plain.scheduler.setEnabled(true);
    plain.scheduler.noteWrite('/vault/x.md');
    plain.advance(LAUNCH_ON_WRITE_QUIET_MS);
    expect(plain.launches).toEqual(['/vault/x.md']);
  });
});

describe('heartbeatSuppressesLaunch — mirrors src/utils/obsidianHeartbeat.js (pointer pinned there too)', () => {
  const NOW = Date.parse('2026-08-29T12:00:00.000Z');
  const beat = (ts: string) => JSON.stringify({ paired: false, accountId: null, deviceId: 'd', ts });

  it('fresh suppresses; stale, missing, malformed, bad-ts, and far-future do not', () => {
    expect(heartbeatSuppressesLaunch(beat('2026-08-29T11:58:00.000Z'), NOW)).toBe(true);
    expect(heartbeatSuppressesLaunch(beat('2026-08-29T11:54:59.000Z'), NOW)).toBe(false); // > 5 min
    expect(heartbeatSuppressesLaunch(null, NOW)).toBe(false);
    expect(heartbeatSuppressesLaunch('', NOW)).toBe(false);
    expect(heartbeatSuppressesLaunch('not json', NOW)).toBe(false);
    expect(heartbeatSuppressesLaunch(JSON.stringify({ ts: 'never' }), NOW)).toBe(false);
    expect(heartbeatSuppressesLaunch(beat('2026-08-29T13:00:00.000Z'), NOW)).toBe(false); // far future
  });

  it('exactly at the threshold is stale (strict <)', () => {
    expect(heartbeatSuppressesLaunch(beat('2026-08-29T11:55:00.000Z'), NOW)).toBe(false);
    expect(heartbeatSuppressesLaunch(beat('2026-08-29T11:55:00.001Z'), NOW)).toBe(true);
  });
});
