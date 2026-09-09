import { describe, it, expect, vi } from 'vitest';
import {
  gateLateObservations, applyLateObservationGate, readLastAppliedMtimes,
  LAST_APPLIED_MTIME_KEY, LAST_APPLIED_RETAIN_DAYS,
} from './lateObservationGate.js';

const T0 = '2026-09-08T10:00:00.000Z';
const T1 = '2026-09-08T11:00:00.000Z';
const T2 = '2026-09-08T12:00:00.000Z';
const NOW = Date.parse('2026-09-09T00:00:00.000Z');

function storage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

describe('gateLateObservations (spec 2.7, newest mtime wins for text)', () => {
  it('an observation strictly older than the last applied mtime is skipped, text and evidence both', () => {
    const r = gateLateObservations(
      { '2026-09-08': { text: 'stale', lastModified: T0 } },
      { '2026-09-08': T0 },
      { '2026-09-08': T1 },
      { now: NOW },
    );
    expect(r.fresh).toEqual({});
    expect(r.evidence).toEqual({});
    expect(r.skipped).toEqual([{ date: '2026-09-08', mtime: T0, lastApplied: T1 }]);
    expect(r.next).toEqual({ '2026-09-08': T1 }); // memory unchanged by a skip
  });

  it('equal applies (idempotent re-observation) and newer applies and advances the memory', () => {
    const equal = gateLateObservations({ d: { text: 'same' } }, { d: T1 }, { d: T1 }, { now: NOW });
    expect(equal.fresh).toEqual({ d: { text: 'same' } });
    expect(equal.skipped).toEqual([]);
    const newer = gateLateObservations({ d: { text: 'new' } }, { d: T2 }, { d: T1 }, { now: NOW });
    expect(newer.fresh).toEqual({ d: { text: 'new' } });
    expect(newer.evidence).toEqual({ d: T2 });
    expect(newer.next).toEqual({ d: T2 });
  });

  it('a first observation of a date always applies and is remembered', () => {
    const r = gateLateObservations({ d: { text: 'first' } }, { d: T0 }, {}, { now: NOW });
    expect(r.fresh).toEqual({ d: { text: 'first' } });
    expect(r.next).toEqual({ d: T0 });
  });

  it('an observation without a real mtime applies and neither reads nor writes the memory', () => {
    const r = gateLateObservations({ d: { text: 'no evidence' } }, {}, { d: T2 }, { now: NOW });
    expect(r.fresh).toEqual({ d: { text: 'no evidence' } });
    expect(r.evidence).toEqual({});
    expect(r.next).toEqual({ d: T2 });
  });

  it('evidence for notes the gate did not judge passes through (scoped notes keyed by path)', () => {
    const r = gateLateObservations({ d: { text: 'x' } }, { d: T1, 'Projects/House.md': T2 }, {}, { now: NOW });
    expect(r.evidence).toEqual({ d: T1, 'Projects/House.md': T2 });
  });

  it('memory for dates older than the retention window falls out', () => {
    const old = new Date(NOW - (LAST_APPLIED_RETAIN_DAYS + 1) * 86400000).toISOString().slice(0, 10);
    const r = gateLateObservations({}, {}, { [old]: T0, '2026-09-01': T0 }, { now: NOW });
    expect(r.next).toEqual({ '2026-09-01': T0 });
  });
});

describe('applyLateObservationGate (storage round trip and the console line)', () => {
  it('persists the memory, skips a late observation on the next call, and logs it', () => {
    const s = storage();
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const first = applyLateObservationGate({ d: { text: 'v1' } }, { d: T1 }, s);
    expect(first.dailyNotes).toEqual({ d: { text: 'v1' } });
    expect(readLastAppliedMtimes(s)).toEqual({ d: T1 });
    const late = applyLateObservationGate({ d: { text: 'v0' } }, { d: T0 }, s);
    expect(late.dailyNotes).toEqual({});
    expect(late.skipped).toHaveLength(1);
    expect(info).toHaveBeenCalledWith(expect.stringContaining('late observation skipped'), expect.stringContaining('d '));
    info.mockRestore();
  });

  it('with no storage at all the gate degrades to always apply', () => {
    const r = applyLateObservationGate({ d: { text: 'x' } }, { d: T0 }, null);
    expect(r.dailyNotes).toEqual({ d: { text: 'x' } });
  });

  it('an unreadable memory value reads as empty', () => {
    const s = storage();
    s.setItem(LAST_APPLIED_MTIME_KEY, '{nope');
    expect(readLastAppliedMtimes(s)).toEqual({});
  });
});
