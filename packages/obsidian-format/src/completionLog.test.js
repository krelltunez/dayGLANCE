import { describe, it, expect } from 'vitest';
import { formatCompletionLogEntry, completionLogDate, DEFAULT_COMPLETION_LOG_HEADING } from './completionLog.js';
import { parseTasksFromMarkdown, planStampInsertions } from './taskLines.js';

// The entry format's load-bearing claims: the ruled NON-TASK shape (the
// scan-collision constraint — neither the parser nor the stamper may ever
// match a log line), field rendering per the companion spec 4.1 table, tag
// extraction mirroring the app's grammar, and deterministic output for the
// cross-device dedupe story.

describe('formatCompletionLogEntry', () => {
  it('the spec-shaped entry: time, clean label, fields in order, tags after fields', () => {
    const line = formatCompletionLogEntry({
      title: 'Review Q2 contract draft #legal #review',
      completedAt: '2026-04-06T14:32:00-05:00',
      fallbackDate: '2026-04-06',
      projectName: 'Acme migration',
      priority: 2,
    });
    expect(line).toBe('- ✅ 14:32 Review Q2 contract draft [completion:: 2026-04-06T14:32:00-05:00] [project:: Acme migration] [priority:: 2] #legal #review');
  });

  it('THE SCAN-COLLISION PIN: no formattable input can produce a line the task parser or the stamper matches', () => {
    const hostile = [
      { title: '[x] looks like a checkbox', completedAt: '2026-04-06T09:00:00-05:00', fallbackDate: '2026-04-06' },
      { title: '- [ ] a full task line #obsidian', completedAt: null, fallbackDate: '2026-04-06' },
      { title: 'multi\n- [x] smuggled line', completedAt: '2026-04-06T09:00:00', fallbackDate: '2026-04-06' },
      { title: '', fallbackDate: '2026-04-06' },
    ];
    for (const f of hostile) {
      const line = formatCompletionLogEntry(f);
      expect(line.includes('\n')).toBe(false);
      expect(line.startsWith('- ✅')).toBe(true);
      const { scheduledTasks, inboxTasks } = parseTasksFromMarkdown(`## Completed\n${line}\n`, '2026-04-06');
      expect(scheduledTasks.length + inboxTasks.length).toBe(0); // parser blind to it
      expect(planStampInsertions(`${line}\n`, '2026-04-06')).toEqual([]); // stamper blind to it
    }
  });

  it('field omission rules: priority 0 omitted, absent project/due/recurring omitted, bare-date completion has no time', () => {
    expect(formatCompletionLogEntry({ title: 'Call accountant', completedAt: '2026-04-06', fallbackDate: '2026-04-06', priority: 0 }))
      .toBe('- ✅ Call accountant [completion:: 2026-04-06]');
    expect(formatCompletionLogEntry({ title: 'Routine', completedAt: '2026-04-06T07:00:00-05:00', fallbackDate: '2026-04-06', recurring: true, deadline: '2026-04-08' }))
      .toBe('- ✅ 07:00 Routine [completion:: 2026-04-06T07:00:00-05:00] [due:: 2026-04-08] [recurring:: true]');
  });

  it('missing completedAt stays DETERMINISTIC: the fallback date is the completion field and there is no time', () => {
    const line = formatCompletionLogEntry({ title: 'Voice-completed thing', completedAt: null, fallbackDate: '2026-09-02' });
    expect(line).toBe('- ✅ Voice-completed thing [completion:: 2026-09-02]');
  });

  it('an offset-bearing timestamp keeps its OWN wall clock (sliced, never reinterpreted through Date)', () => {
    // A different-timezone Date reinterpretation would shift this; the
    // string's own 23:59 must survive.
    expect(formatCompletionLogEntry({ title: 'Late', completedAt: '2026-04-06T23:59:00+11:00', fallbackDate: '2026-04-06' }))
      .toContain('- ✅ 23:59 Late');
  });

  it('a tags-only title keeps its tags as the label rather than going blank', () => {
    const line = formatCompletionLogEntry({ title: '#inbox #urgent', completedAt: null, fallbackDate: '2026-04-06' });
    expect(line.startsWith('- ✅ #inbox #urgent')).toBe(true);
  });

  it('the default heading is the ruled one', () => {
    expect(DEFAULT_COMPLETION_LOG_HEADING).toBe('## Completed');
  });
});

describe('completionLogDate', () => {
  it('the timestamp\'s own date wins; absent falls back to local today', () => {
    expect(completionLogDate('2026-04-06T23:59:00-05:00', '2026-09-02')).toBe('2026-04-06');
    expect(completionLogDate('2026-04-06', '2026-09-02')).toBe('2026-04-06');
    expect(completionLogDate(null, '2026-09-02')).toBe('2026-09-02');
    expect(completionLogDate('garbage', '2026-09-02')).toBe('2026-09-02');
  });
});
