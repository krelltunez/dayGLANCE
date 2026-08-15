import { describe, it, expect } from 'vitest';
import {
  decideRecovery,
  RECOVER_REASONS,
  RECOVERY_WINDOW_MS,
  MAX_RECOVERY_ATTEMPTS,
} from './rendererRecovery.js';

// The contract: recover exactly on the four crash reasons plus launch-failed,
// never during quit or clean-exit, escalate reload -> recreate -> stop inside
// the rolling window, and forget attempts outside it.

const T0 = 1_000_000;
const d = (over: Partial<Parameters<typeof decideRecovery>[0]> = {}) =>
  decideRecovery({ reason: 'crashed', isQuitting: false, attempts: [], now: T0, ...over });

describe('decideRecovery — reason filtering', () => {
  it('recovers on crashed, oom, killed, abnormal-exit', () => {
    for (const reason of RECOVER_REASONS) {
      expect(d({ reason }).action, reason).toBe('reload');
    }
  });

  it('clean-exit never triggers recovery (ordinary teardown and navigation)', () => {
    expect(d({ reason: 'clean-exit' }).action).toBe('ignore');
  });

  it('unknown reasons are log-only, fail-safe', () => {
    for (const reason of ['integrity-failure', 'weird-future-reason', '']) {
      expect(d({ reason }).action, reason).toBe('ignore');
    }
  });

  it('launch-failed gets a full loadURL, not a reload of a never-loaded frame', () => {
    expect(d({ reason: 'launch-failed' }).action).toBe('load-url');
  });
});

describe('decideRecovery — quit guard', () => {
  it('bails when isQuitting, whatever the reason', () => {
    for (const reason of [...RECOVER_REASONS, 'launch-failed']) {
      expect(d({ reason, isQuitting: true }).action, reason).toBe('ignore');
    }
  });
});

describe('decideRecovery — the crash-loop ladder', () => {
  it('escalates reload, then recreate, then gives up and stays quiet', () => {
    expect(MAX_RECOVERY_ATTEMPTS).toBe(3);
    const first = d({});
    expect(first.action).toBe('reload');
    const second = d({ attempts: first.attempts, now: T0 + 1000 });
    expect(second.action).toBe('recreate');
    const third = d({ attempts: second.attempts, now: T0 + 2000 });
    expect(third.action).toBe('give-up');
    // Still quiet on the fourth: give-up does not consume ladder positions.
    const fourth = d({ attempts: third.attempts, now: T0 + 3000 });
    expect(fourth.action).toBe('give-up');
  });

  it('launch-failed escalates through the same rungs', () => {
    const first = d({ reason: 'launch-failed' });
    expect(first.action).toBe('load-url');
    expect(d({ reason: 'launch-failed', attempts: first.attempts, now: T0 + 1000 }).action).toBe('recreate');
  });

  it('attempts outside the rolling window are forgotten: a later crash is a new incident', () => {
    const first = d({});
    const later = d({ attempts: first.attempts, now: T0 + RECOVERY_WINDOW_MS + 1 });
    expect(later.action).toBe('reload');
    expect(later.attempts).toHaveLength(1);
  });

  it('acting appends the attempt; ignoring and giving up do not', () => {
    expect(d({}).attempts).toEqual([T0]);
    expect(d({ reason: 'clean-exit' }).attempts).toEqual([]);
    expect(d({ isQuitting: true }).attempts).toEqual([]);
    const atCap = [T0 - 100, T0 - 50];
    expect(d({ attempts: atCap }).attempts).toEqual(atCap);
  });
});
