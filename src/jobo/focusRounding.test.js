import { describe, expect, it } from 'vitest';
import { focusMinuteInterval, summarizeFocusCapture, buildFocusDoRecords } from './focusRecords.js';
import { compareExecutionToPlan, createDoRecord } from './core.js';
import { beginFocusCapture, resumeFocusCapture, sealFocusCapture } from './focusCapture.js';
const at = time => Date.parse(`2026-10-09T${time}Z`);
const segment = (start, end) => ({ startedAt: at(start), endedAt: at(end), startOffset: 0, endOffset: 0 });

describe('nearest-minute Focus boundaries', () => {
  it('rounds each boundary, with a half-minute rounding forward', () => {
    expect(focusMinuteInterval(segment('09:00:29.999', '09:01:30.000'))).toMatchObject({ startTime: '09:00', endTime: '09:02', minutes: 2 });
    expect(focusMinuteInterval(segment('09:00:30.000', '09:02:29.999'))).toMatchObject({ startTime: '09:01', endTime: '09:02', minutes: 1 });
  });
  it('omits equal rounded endpoints, not all short durations', () => {
    expect(focusMinuteInterval(segment('09:00:40', '09:01:20'))).toBeNull();
    expect(focusMinuteInterval(segment('09:00:29', '09:00:31'))).toMatchObject({ startTime: '09:00', endTime: '09:01', minutes: 1 });
  });
  it('preserves chronological ordering across every pause boundary', () => {
    for (let pause = 0; pause < 60; pause++) {
      for (let resume = pause; resume < 60; resume++) {
        const a = focusMinuteInterval(segment('09:00:00', `09:01:${String(pause).padStart(2, '0')}`));
        const b = focusMinuteInterval(segment(`09:01:${String(resume).padStart(2, '0')}`, '09:03:00'));
        expect(a.endTime <= b.startTime).toBe(true);
      }
    }
  });
  it('reports signed differences that can accumulate past a minute across segments', () => {
    const more = summarizeFocusCapture({ segments: [segment('09:00:29', '09:01:31'), segment('09:02:29', '09:03:31')] });
    expect(more).toMatchObject({ workMilliseconds: 124000, recordedMinutes: 4, recordedDifferenceMilliseconds: 116000 });
    const less = summarizeFocusCapture({ segments: [segment('09:00:31', '09:02:29'), segment('09:02:31', '09:04:29')] });
    expect(less).toMatchObject({ workMilliseconds: 236000, recordedMinutes: 2, recordedDifferenceMilliseconds: -116000 });
  });
  it('uses the rounded date on either side of midnight', () => {
    expect(focusMinuteInterval(segment('23:58:40', '23:59:40'))).toEqual({ date: '2026-10-09', startTime: '23:59', endDate: '2026-10-10', endTime: '00:00', minutes: 1 });
    expect(focusMinuteInterval({ ...segment('23:59:40', '23:59:41'), endedAt: Date.parse('2026-10-10T00:01:00Z') })).toEqual({ date: '2026-10-10', startTime: '00:00', endDate: '2026-10-10', endTime: '00:01', minutes: 1 });
  });
  it('keeps a same-interval manual row and reports overlap without doubling coverage', () => {
    const task = { id: 'a', title: 'Write', date: '2026-10-09', startTime: '09:00', duration: 2 };
    const capture = sealFocusCapture(resumeFocusCapture(beginFocusCapture({ id: 's', tasks: [task] }), at('09:00:00')), at('09:02:00'));
    const [focus] = buildFocusDoRecords(capture, 'a', []);
    const manual = createDoRecord({ ...focus, id: 'manual', source: 'manual' });
    expect(buildFocusDoRecords(capture, 'a', [manual])).toEqual([focus]);
    const baseline = compareExecutionToPlan(focus.planSnapshot, [focus]);
    const combined = compareExecutionToPlan(focus.planSnapshot, [focus, manual]);
    expect(combined.metrics.recordedMinutes).toBe(baseline.metrics.recordedMinutes);
    expect(combined.metrics).toMatchObject({ recordedMinutes: 2, overlapMinutes: 2 });
  });
});
