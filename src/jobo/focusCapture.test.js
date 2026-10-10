import { describe, expect, it } from 'vitest';
import {
  attributeFocusCapture, beginFocusCapture, captureFocusCandidates,
  pauseFocusCapture, resumeFocusCapture, sealFocusCapture,
} from './focusCapture.js';

const at = Date.parse('2026-10-09T09:00:20.000Z');
const task = { id: 't1', title: 'Write', date: '2026-10-09', startTime: '09:00', duration: 60 };
const begin = (tasks = [task]) => beginFocusCapture({ id: 'focus:session:phase:0', tasks });

describe('raw Focus work-phase capture', () => {
  it('starts only on resume, and repeated resume preserves the first instant and id', () => {
    const initial = begin();
    expect(initial.active).toBeNull();
    const running = resumeFocusCapture(initial, at);
    expect(resumeFocusCapture(running, at + 1000)).toBe(running);
    expect(running.active).toMatchObject({ id: 'focus:session:phase:0:0', startedAt: at });
  });

  it('keeps an 80-second segment intact before any persistence conversion', () => {
    const ended = sealFocusCapture(resumeFocusCapture(begin(), at), at + 80000);
    expect(ended.segments).toMatchObject([{ id: 'focus:session:phase:0:0', startedAt: at, endedAt: at + 80000 }]);
  });

  it('splits every explicit pause, excluding the gap without asking for a task', () => {
    const running = resumeFocusCapture(begin(), at);
    const paused = pauseFocusCapture(running, at + 30000);
    expect(paused.sealed).toBe(false);
    expect(pauseFocusCapture(paused, at + 50000)).toBe(paused);
    const ended = sealFocusCapture(resumeFocusCapture(paused, at + 90000), at + 100000);
    expect(ended.segments.map(({ startedAt, endedAt }) => endedAt - startedAt)).toEqual([30000, 10000]);
    expect(ended.segments.map(({ id }) => id)).toEqual(['focus:session:phase:0:0', 'focus:session:phase:0:1']);
  });

  it('seals a paused phase without extending it to exit time', () => {
    const paused = pauseFocusCapture(resumeFocusCapture(begin(), at), at + 10000);
    expect(sealFocusCapture(paused, at + 120000).segments).toEqual(paused.segments);
  });

  it('makes repeat end, skip or exit delivery a no-op, even after a late resume', () => {
    const ended = sealFocusCapture(resumeFocusCapture(begin(), at), at + 10000);
    expect(sealFocusCapture(ended, at + 20000)).toBe(ended);
    expect(pauseFocusCapture(ended, at + 30000)).toBe(ended);
    expect(resumeFocusCapture(ended, at + 40000)).toBe(ended);
  });

  it('never creates a zero-length segment or reuses its consumed identity', () => {
    const paused = pauseFocusCapture(resumeFocusCapture(begin(), at), at);
    expect(paused.segments).toEqual([]);
    expect(resumeFocusCapture(paused, at + 1000).active.id).toBe('focus:session:phase:0:1');
  });

  it('retains the exact endpoints across midnight', () => {
    const start = Date.parse('2026-10-09T23:59:50Z');
    const ended = sealFocusCapture(resumeFocusCapture(begin(), start), start + 20000);
    expect(ended.segments[0]).toMatchObject({ startedAt: start, endedAt: Date.parse('2026-10-10T00:00:10Z') });
  });

  it('captures the title and plan once, separately from the live task', () => {
    const live = { ...task };
    const capture = begin([live]);
    live.title = 'Renamed'; live.startTime = '11:00'; live.duration = 90;
    expect(capture.candidates[0]).toMatchObject({ title: 'Write', planSnapshot: { date: task.date, startTime: '09:00', duration: 60 } });
  });

  it('keeps recurring native occurrence action identity separate from ledger task identity', () => {
    const [candidate] = captureFocusCandidates([{ ...task, id: 'recurring-r1-2026-10-09', recurringTemplateId: 'r1' }]);
    expect(candidate).toMatchObject({ actionId: 'recurring-r1-2026-10-09', taskId: 'r1', occurrenceDate: '2026-10-09' });
  });

  it('attributes the whole phase to one candidate without splitting work among tasks', () => {
    const capture = sealFocusCapture(resumeFocusCapture(begin([task, { ...task, id: 't2', title: 'Read' }]), at), at + 10000);
    const chosen = attributeFocusCapture(capture, 't2');
    expect(chosen.candidate.taskId).toBe('t2');
    expect(chosen.segments).toEqual(capture.segments);
    chosen.segments[0].endedAt += 1;
    expect(capture.segments[0].endedAt).toBe(at + 10000);
    expect(() => attributeFocusCapture(capture, 'outside')).toThrow(/captured block/);
    expect(() => attributeFocusCapture(begin(), 't1')).toThrow(/running/);
  });

  it('keeps repeated block entries unique and does not infer a timed plan for all-day work', () => {
    expect(captureFocusCandidates([task, { ...task }, null])).toHaveLength(1);
    expect(captureFocusCandidates([{ ...task, isAllDay: true }])[0].planSnapshot).toBeNull();
  });

  it('refuses invalid or backwards instants instead of inventing a positive interval', () => {
    expect(() => resumeFocusCapture(begin(), NaN)).toThrow(/instant/);
    const running = resumeFocusCapture(begin(), at);
    expect(() => pauseFocusCapture(running, at - 1)).toThrow(/backwards/);
    expect(running.active.startedAt).toBe(at);
  });
});
