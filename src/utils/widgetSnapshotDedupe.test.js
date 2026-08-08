import { describe, it, expect } from 'vitest';
import { snapshotFingerprint, evaluateSnapshotPush } from './widgetSnapshotDedupe.js';

const snap = (over = {}) => ({
  date: '2026-08-08',
  sections: [{ id: 1, title: 'Work' }],
  daySummary: {
    unblockedMinutes: 120,
    done: '1h/4h',
    upNext: {
      title: 'Standup',
      inProgress: false,
      timeLabel: 'at 9:30 AM',
      countdownStartMs: 1_700_000_000_000,
      countdownEndMs: 1_700_000_600_000,
    },
  },
  updatedAt: 1_700_000_000_000,
  ...over,
});

// Same snapshot a tick later: both wall-clock stamps have moved, nothing else.
const tickedSnap = (ms) => {
  const s = snap({ updatedAt: ms });
  s.daySummary = { ...s.daySummary, upNext: { ...s.daySummary.upNext, countdownStartMs: ms } };
  return s;
};

describe('snapshotFingerprint', () => {
  // The whole point: updatedAt changes on every build and must not count.
  it('ignores updatedAt', () => {
    expect(snapshotFingerprint(snap({ updatedAt: 1 })))
      .toBe(snapshotFingerprint(snap({ updatedAt: 999_999_999 })));
  });

  // Regression: the first version excluded only updatedAt, so this stamp kept the
  // fingerprint moving and the dedupe did nothing on device.
  it('ignores daySummary.upNext.countdownStartMs, the other wall-clock stamp', () => {
    expect(snapshotFingerprint(tickedSnap(1)))
      .toBe(snapshotFingerprint(tickedSnap(999_999_999)));
  });

  it('still notices a real change to upNext alongside the moving stamp', () => {
    const a = tickedSnap(1);
    const b = tickedSnap(2);
    b.daySummary.upNext.timeLabel = 'until 10:00 AM';
    b.daySummary.upNext.inProgress = true;
    expect(snapshotFingerprint(a)).not.toBe(snapshotFingerprint(b));
  });

  it('still notices a change to countdownEndMs, which is not a live stamp', () => {
    const a = tickedSnap(1);
    const b = tickedSnap(1);
    b.daySummary.upNext = { ...b.daySummary.upNext, countdownEndMs: 1_700_000_999_000 };
    expect(snapshotFingerprint(a)).not.toBe(snapshotFingerprint(b));
  });

  it('handles a snapshot with no upNext entry', () => {
    const a = snap({ daySummary: { unblockedMinutes: 120, upNext: null } });
    const b = snap({ daySummary: { unblockedMinutes: 120, upNext: null }, updatedAt: 42 });
    expect(snapshotFingerprint(a)).toBe(snapshotFingerprint(b));
  });

  it('handles a snapshot with no daySummary at all', () => {
    const a = snap({ daySummary: undefined });
    const b = snap({ daySummary: undefined, updatedAt: 42 });
    expect(snapshotFingerprint(a)).toBe(snapshotFingerprint(b));
  });

  it('changes when real content changes', () => {
    expect(snapshotFingerprint(snap()))
      .not.toBe(snapshotFingerprint(snap({ sections: [{ id: 1, title: 'Home' }] })));
  });

  it('notices a nested change', () => {
    expect(snapshotFingerprint(snap()))
      .not.toBe(snapshotFingerprint(snap({ daySummary: { unblockedMinutes: 90, done: '1h/4h' } })));
  });

  it('notices a field being added or removed', () => {
    expect(snapshotFingerprint(snap())).not.toBe(snapshotFingerprint(snap({ extra: true })));
  });

  it('returns empty for non-objects', () => {
    expect(snapshotFingerprint(null)).toBe('');
    expect(snapshotFingerprint(undefined)).toBe('');
    expect(snapshotFingerprint('nope')).toBe('');
  });

  it('returns empty rather than throwing on a cyclic snapshot', () => {
    const cyclic = snap();
    cyclic.self = cyclic;
    expect(snapshotFingerprint(cyclic)).toBe('');
  });
});

describe('evaluateSnapshotPush', () => {
  it('pushes the first snapshot, when nothing has been sent yet', () => {
    const r = evaluateSnapshotPush(snap(), '');
    expect(r.push).toBe(true);
    expect(r.fingerprint).not.toBe('');
  });

  // The 108-identical-pushes case from the device.
  it('skips a re-push whose only difference is the timestamp', () => {
    const first = evaluateSnapshotPush(snap({ updatedAt: 1 }), '');
    const second = evaluateSnapshotPush(snap({ updatedAt: 2 }), first.fingerprint);
    expect(second.push).toBe(false);
    expect(second.fingerprint).toBe(first.fingerprint);
  });

  it('pushes again once content actually changes', () => {
    const first = evaluateSnapshotPush(snap(), '');
    const changed = evaluateSnapshotPush(snap({ date: '2026-08-09' }), first.fingerprint);
    expect(changed.push).toBe(true);
    expect(changed.fingerprint).not.toBe(first.fingerprint);
  });

  // The device case: 88 pushes of an idle snapshot where BOTH wall-clock stamps
  // moved each tick. With only updatedAt excluded this returned 88.
  it('collapses a long idle run to a single push, with both stamps moving', () => {
    let last = '';
    let pushes = 0;
    for (let i = 0; i < 108; i++) {
      const r = evaluateSnapshotPush(tickedSnap(1_700_000_000_000 + i * 15_000), last);
      if (r.push) pushes++;
      last = r.fingerprint;
    }
    expect(pushes).toBe(1);
  });

  // Failing toward "send it": a widget showing stale data is worse than a
  // redundant bridge call.
  it('pushes when the snapshot cannot be fingerprinted', () => {
    const cyclic = snap();
    cyclic.self = cyclic;
    expect(evaluateSnapshotPush(cyclic, 'anything').push).toBe(true);
  });

  it('pushes a fresh snapshot after an unserialisable one, not suppressing it', () => {
    const cyclic = snap();
    cyclic.self = cyclic;
    const bad = evaluateSnapshotPush(cyclic, '');
    expect(bad.fingerprint).toBe('');
    // The empty fingerprint must not match the next real one and swallow it.
    expect(evaluateSnapshotPush(snap(), bad.fingerprint).push).toBe(true);
  });
});
