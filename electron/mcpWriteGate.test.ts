import { describe, it, expect } from 'vitest';
import { createWriteGate, DEFAULT_VIOLATION_LIMIT } from './mcpWriteGate.js';

// §4.3 under test: exceed the limit → rate_limited tool error; keep hammering
// → writes auto-disable exactly once (the notification edge), and stay off
// until an explicit reset.

function fakeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

const drain = (gate: ReturnType<typeof createWriteGate>, key: string, n: number) => {
  for (let i = 0; i < n; i++) expect(gate.tryWrite(key)).toEqual({ allowed: true });
};

describe('createWriteGate', () => {
  it('admits up to the rate limit, then returns rate_limited', () => {
    const clock = fakeClock();
    const gate = createWriteGate({ limit: 3, windowMs: 1000, now: clock.now });
    drain(gate, 'tok', 3);
    expect(gate.tryWrite('tok')).toEqual({ allowed: false, reason: 'rate_limited', disabledNow: false });
    expect(gate.writesDisabled()).toBe(false);
  });

  it('recovers capacity when the window slides — a single burst never disables', () => {
    const clock = fakeClock();
    const gate = createWriteGate({ limit: 2, windowMs: 1000, now: clock.now });
    drain(gate, 'tok', 2);
    expect(gate.tryWrite('tok').allowed).toBe(false); // one violation
    clock.advance(1100);
    expect(gate.tryWrite('tok')).toEqual({ allowed: true });
    expect(gate.writesDisabled()).toBe(false);
  });

  it(`auto-disables on the ${DEFAULT_VIOLATION_LIMIT}rd violation inside the violation window, flagging the edge once`, () => {
    const clock = fakeClock();
    const gate = createWriteGate({ limit: 1, windowMs: 60_000, violationLimit: 3, violationWindowMs: 300_000, now: clock.now });
    drain(gate, 'tok', 1);
    expect(gate.tryWrite('tok')).toEqual({ allowed: false, reason: 'rate_limited', disabledNow: false });
    clock.advance(1000);
    expect(gate.tryWrite('tok')).toEqual({ allowed: false, reason: 'rate_limited', disabledNow: false });
    clock.advance(1000);
    // Third violation in the window: this is the disable edge — notification fires here.
    expect(gate.tryWrite('tok')).toEqual({ allowed: false, reason: 'writes_disabled', disabledNow: true });
    // After the edge: still refused, but the edge flag never repeats.
    expect(gate.tryWrite('tok')).toEqual({ allowed: false, reason: 'writes_disabled', disabledNow: false });
    expect(gate.writesDisabled()).toBe(true);
  });

  it('violations spaced beyond the violation window do not accumulate to a disable', () => {
    const clock = fakeClock();
    const gate = createWriteGate({ limit: 1, windowMs: 1000, violationLimit: 3, violationWindowMs: 5000, now: clock.now });
    for (let round = 0; round < 5; round++) {
      drain(gate, 'tok', 1);
      expect(gate.tryWrite('tok').reason).toBe('rate_limited'); // one violation per round
      clock.advance(6000); // beyond the violation window — the strike expires
    }
    expect(gate.writesDisabled()).toBe(false);
  });

  it('the disable is process-wide and does not lift with time — only reset() lifts it', () => {
    const clock = fakeClock();
    const gate = createWriteGate({ limit: 1, windowMs: 1000, violationLimit: 2, violationWindowMs: 5000, now: clock.now });
    drain(gate, 'tok', 1);
    gate.tryWrite('tok');
    gate.tryWrite('tok');
    expect(gate.writesDisabled()).toBe(true);
    clock.advance(60 * 60_000); // an hour of waiting changes nothing
    expect(gate.tryWrite('tok')).toEqual({ allowed: false, reason: 'writes_disabled', disabledNow: false });
    expect(gate.tryWrite('other-token').reason).toBe('writes_disabled'); // runaway protection is global
    gate.reset();
    expect(gate.tryWrite('tok')).toEqual({ allowed: true });
  });

  it('reset() clears accumulated strikes, not just the disabled flag', () => {
    const clock = fakeClock();
    const gate = createWriteGate({ limit: 1, windowMs: 60_000, violationLimit: 3, violationWindowMs: 300_000, now: clock.now });
    drain(gate, 'tok', 1);
    gate.tryWrite('tok'); // strike 1
    gate.tryWrite('tok'); // strike 2
    gate.reset();
    drain(gate, 'tok', 1);
    gate.tryWrite('tok'); // post-reset strike 1
    expect(gate.tryWrite('tok')).toEqual({ allowed: false, reason: 'rate_limited', disabledNow: false }); // strike 2, NOT 4
    expect(gate.writesDisabled()).toBe(false);
  });

  it('violation strikes are per token even though the disable is global', () => {
    const clock = fakeClock();
    const gate = createWriteGate({ limit: 1, windowMs: 60_000, violationLimit: 3, violationWindowMs: 300_000, now: clock.now });
    drain(gate, 'a', 1);
    gate.tryWrite('a'); // a: strike 1
    gate.tryWrite('a'); // a: strike 2
    drain(gate, 'b', 1);
    expect(gate.tryWrite('b')).toEqual({ allowed: false, reason: 'rate_limited', disabledNow: false }); // b: strike 1, not 3
    expect(gate.writesDisabled()).toBe(false);
  });
});
