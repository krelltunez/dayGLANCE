import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFocusSession } from './focusSession.js';
import { createLedger } from './ledger.js';

const start = Date.parse('2026-10-09T09:00:00Z');
const task = { id: 'a', title: 'Write', date: '2026-10-09', startTime: '09:00', duration: 25 };
let state, session, review, at, next;
const move = (before, after, delta = 0) => { at += delta; return session.transition({ before, after, at }); };
const running = { phase: 'work', running: true };
const paused = { phase: 'work', running: false };
function stop() { move(running, paused, 120000); expect(session.settle(next)).toBe(true); }
beforeEach(() => {
  at = start;
  next = vi.fn();
  state = { enabled: true, loaded: true, writable: true, records: [],
    resolveBlock: block => block, recordJobo: vi.fn(async () => ({ ok: true })), complete: vi.fn(() => ({ allCompleted: false, completedActionId: 'b' })) };
  session = createFocusSession({ getState: () => state, publish: value => { review = value; }, makeId: () => 'session', now: () => at });
  session.begin([task]);
});

describe('Focus settlement through the ledger writer', () => {
  it('single task: one timed partial row, then continuation; in-progress never completes', async () => {
    move(paused, running); stop();
    await session.save('a', false);
    expect(state.recordJobo).toHaveBeenCalledTimes(1);
    expect(state.recordJobo.mock.calls[0][0]).toMatchObject([{ source: 'focus', progress: 'partial', startTime: '09:00', endTime: '09:02' }]);
    expect(state.complete).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
    expect(review).toBeNull();
  });
  it('pause/resume does not review; breaks and settlement waiting produce no work', async () => {
    move(paused, running);
    move(running, paused, 60000);
    expect(review).toBeNull();
    move(paused, running, 60000);
    move(running, paused, 60000);
    session.settle(next);
    expect(review.summary.recordedMinutes).toBe(2);
    expect(move(paused, running, 60000)).toBe(false);
    await session.save('a', false);
    move(paused, { phase: 'shortBreak', running: false });
    move({ phase: 'shortBreak', running: false }, { phase: 'shortBreak', running: true });
    move({ phase: 'shortBreak', running: true }, running, 300000);
    stop();
    await session.save('a', false);
    const batches = state.recordJobo.mock.calls.map(([rows]) => rows);
    expect(batches[0].map(row => [row.startTime, row.endTime])).toEqual([['09:00', '09:01'], ['09:02', '09:03']]);
    expect(batches[1][0].startTime).toBe('09:09');
    expect(batches[1][0].id).not.toBe(batches[0][0].id);
  });
  it('multi task selects exactly one frozen block task, without interval splitting', async () => {
    session.begin([task, { ...task, id: 'b', title: 'Read' }]);
    move(paused, running); stop();
    await session.save('b', true);
    expect(state.recordJobo.mock.calls[0][0]).toMatchObject([{ taskId: 'b', startTime: '09:00', endTime: '09:02' }]);
    expect(state.complete).toHaveBeenCalledWith('b');
    expect(next).toHaveBeenCalledWith({ allCompleted: false, completedActionId: 'b' });
  });
  it('freezes the title/plan before running even if task state changes during work', async () => {
    const current = { ...task }; state.resolveBlock = () => [current];
    move(paused, running); current.title = 'Changed'; current.startTime = '10:00'; stop();
    await session.save('a', false);
    expect(state.recordJobo.mock.calls[0][0][0]).toMatchObject({ title: 'Write', planSnapshot: { startTime: '09:00' } });
  });
  it('equal rounded endpoints still review and support completion without a timed row', async () => {
    at = start + 40000;
    move(paused, running); move(running, paused, 40000); session.settle(next);
    expect(review.summary).toMatchObject({ workMilliseconds: 40000, recordedMinutes: 0, recordedDifferenceMilliseconds: -40000 });
    await session.save('a', true);
    expect(state.recordJobo).not.toHaveBeenCalled();
    expect(state.complete).toHaveBeenCalledOnce();
  });
  it('double-click, repeated exit and native resume cannot duplicate an in-flight settlement', async () => {
    let resolve; state.recordJobo = vi.fn(() => new Promise(r => { resolve = r; }));
    move(paused, running); stop();
    const saving = session.save('a', true);
    await session.save('a', true);
    const exit = vi.fn(); session.settle(exit, { exiting: true });
    expect(session.begin([task])).toBe(false);
    expect(move(paused, running)).toBe(false);
    resolve({ ok: true }); await saving;
    await session.save('a', true);
    expect(state.recordJobo).toHaveBeenCalledOnce();
    expect(state.complete).toHaveBeenCalledOnce();
    expect(next).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledOnce();
  });
  it.each([{ loaded: false, records: undefined }, { writable: false }, { enabled: false }])('unavailable ledger refuses safely: %j', async flags => {
    move(paused, running); stop(); Object.assign(state, flags);
    await session.save('a', true);
    expect(review.error).toBe('unavailable');
    expect(state.recordJobo).not.toHaveBeenCalled();
    expect(state.complete).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    session.dismiss(); expect(next).toHaveBeenCalledOnce();
  });
  it('failed/held write keeps stable rows and locks attribution for retry; no early completion', async () => {
    session.begin([task, { ...task, id: 'b' }]);
    state.recordJobo.mockResolvedValueOnce({ ok: false, held: true }).mockResolvedValue({ ok: true });
    move(paused, running); stop();
    await session.save('a', true);
    const first = state.recordJobo.mock.calls[0][0];
    expect(review.error).toBe('held');
    expect(state.complete).not.toHaveBeenCalled();
    at += 500000;
    await session.save('b', false); expect(state.recordJobo).toHaveBeenCalledTimes(1);
    await session.save('a', true);
    expect(state.recordJobo.mock.calls[1][0]).toEqual(first);
    expect(state.complete).toHaveBeenCalledOnce();
  });
  it('retry sees an intervening manual edit or tombstone and never recreates it', async () => {
    state.recordJobo.mockResolvedValueOnce({ ok: false, held: true });
    move(paused, running); stop(); await session.save('a', false);
    state.records = state.recordJobo.mock.calls[0][0].map(row => ({ ...row, deleted: true, updatedAt: '2026-10-10T00:00:00Z' }));
    await session.save('a', false);
    expect(state.recordJobo).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledOnce();
  });
  it('JOBO off has no capture, record, prompt or retroactive work', async () => {
    state.enabled = false;
    move(paused, running); move(running, paused, 120000);
    expect(session.settle(next)).toBe(false);
    state.enabled = true; move(paused, running, 60000);
    session.disable(); state.enabled = false;
    move(running, paused, 60000);
    expect(session.settle(next)).toBe(false);
    expect(state.recordJobo).not.toHaveBeenCalled(); expect(review).toBeNull();
  });
  it('a backwards clock adjustment does not break Stop or invent work', () => {
    move(paused, running);
    move(running, paused, -1000);
    expect(session.settle(next)).toBe(true);
    expect(review.summary).toMatchObject({ recordedMinutes: 0, clockChanged: true });
  });
  it('commits through a real ledger and preserves Focus history across load and retry', async () => {
    let stored = [];
    const store = { read: async () => ({ ok: true, value: stored }), writable: async () => true,
      update: async fn => { stored = fn(stored); return { ok: true, value: stored }; } };
    const ledger = createLedger({ store }); await ledger.load();
    state.recordJobo = ledger.commit;
    move(paused, running); stop(); await session.save('a', false);
    expect(ledger.get().records).toHaveLength(1);
    expect(stored).toEqual(ledger.get().records);
    ledger.dispose();
  });
});
