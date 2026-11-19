import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  markMilestone, timeSync, timeAsync, noteLongTask, startLongTaskObserver,
  perfSnapshot, formatPerfLines, __resetPerfTraceForTests,
} from './perfTrace.js';

let clock = 0;
beforeEach(() => {
  __resetPerfTraceForTests();
  clock = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
});

const busy = (ms) => () => { clock += ms; return 'done'; };

describe('the responsiveness trace', () => {
  it('keeps the first time each milestone is reached', () => {
    clock = 120; markMilestone('bundle');
    clock = 900; markMilestone('bundle');
    expect(perfSnapshot().marks).toEqual({ bundle: 120 });
  });

  it('returns what the work returns and rethrows what it throws', async () => {
    expect(timeSync('a', busy(5))).toBe('done');
    expect(() => timeSync('b', () => { throw new Error('x'); })).toThrow('x');
    await expect(timeAsync('c', async () => 7)).resolves.toBe(7);
    await expect(timeAsync('d', async () => { throw new Error('y'); })).rejects.toThrow('y');
    expect(perfSnapshot().phases.map((p) => p.name).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('sums each phase by name', () => {
    timeSync('save', busy(10));
    timeSync('save', busy(30));
    const save = perfSnapshot().phases.find((p) => p.name === 'save');
    expect(save).toMatchObject({ count: 2, totalMs: 40, maxMs: 30, async: false });
  });

  it('names the blocking phase inside a long task first, and what was only in flight after', async () => {
    let release;
    const cycle = timeAsync('vault sync cycle', () => new Promise((r) => { release = r; }));
    clock = 1000;
    timeSync('vault: read app state', busy(400));
    clock = 5000;
    release();
    await cycle;
    noteLongTask(1000, 400);
    expect(perfSnapshot().long).toEqual([
      { start: 1000, duration: 400, during: ['vault: read app state', 'vault sync cycle (in flight)'] },
    ]);
  });

  it('keeps the slowest long tasks, slowest first, and counts them all', () => {
    for (let i = 0; i < 40; i += 1) noteLongTask(i * 100, 50 + i);
    const snap = perfSnapshot();
    expect(snap.longCount).toBe(40);
    expect(snap.long).toHaveLength(25);
    expect(snap.long[0].duration).toBe(89);
    expect(snap.long.at(-1).duration).toBe(65);
  });

  it('observes long tasks where the browser reports them, buffered ones included', () => {
    const observe = vi.fn();
    let feed;
    class PO { constructor(cb) { feed = cb; } observe(o) { observe(o); } }
    PO.supportedEntryTypes = ['longtask'];
    expect(startLongTaskObserver(PO)).toBe(true);
    expect(observe).toHaveBeenCalledWith({ type: 'longtask', buffered: true });
    feed({ getEntries: () => [{ startTime: 10, duration: 70 }] });
    expect(perfSnapshot().longCount).toBe(1);
    expect(startLongTaskObserver(PO)).toBe(false);
  });

  it('says so where the browser does not report long tasks', () => {
    class PO {}
    PO.supportedEntryTypes = ['mark'];
    expect(startLongTaskObserver(PO)).toBe(false);
    expect(formatPerfLines(perfSnapshot()).join('\n')).toContain('not reported by this browser');
  });

  it('formats a report a person can read', () => {
    const PO = class { observe() {} };
    PO.supportedEntryTypes = ['longtask'];
    startLongTaskObserver(PO);
    clock = 300; markMilestone('bundle');
    clock = 6400; markMilestone('data on screen');
    clock = 6400; timeSync('save to storage', busy(250));
    noteLongTask(6400, 250);
    clock = 9000;
    const text = formatPerfLines(perfSnapshot()).join('\n');
    expect(text).toContain('responsiveness:  up 9.0s');
    expect(text).toContain('startup:       bundle 0.3s, data on screen 6.4s');
    expect(text).toContain('long tasks:    1 (0.3s blocked in all)');
    expect(text).toContain('at 6.4s: 250 ms during save to storage');
    expect(text).toContain('save to storage: 1x, 250 ms total, 250 ms max');
  });
});
