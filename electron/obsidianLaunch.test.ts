import { describe, it, expect } from 'vitest';
import { createLaunchScheduler, LAUNCH_ON_WRITE_QUIET_MS } from './obsidianLaunch.js';

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
