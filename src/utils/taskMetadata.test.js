import { describe, it, expect } from 'vitest';
import { taskMoments, formatStamp } from './taskMetadata.js';

// parseStamp is tested with agenda-core (stamps.test.js), wireStamp with
// @glance-apps/dayglance-mcp (test/wireStamp.test.js).

describe('taskMoments', () => {
  it('reports a concrete task\'s stamps, and no completion while it is open', () => {
    expect(taskMoments({ createdAt: 'c', completed: true, completedAt: 'd' })).toEqual({ createdAt: 'c', completedAt: 'd' });
    expect(taskMoments({ createdAt: 'c', completed: false, completedAt: 'stale' })).toEqual({ createdAt: 'c', completedAt: null });
  });

  it('resolves an occurrence from its series: created once, completed per date', () => {
    const recurringTasks = [{ id: 'r1', createdAt: 'series', completedDatesTimestamps: { '2026-10-22': 'done-22' } }];
    expect(taskMoments({ isRecurring: true, recurringTemplateId: 'r1', date: '2026-10-22', completed: true }, { recurringTasks }))
      .toEqual({ createdAt: 'series', completedAt: 'done-22' });
    expect(taskMoments({ isRecurring: true, recurringTemplateId: 'r1', date: '2026-10-23', completed: false }, { recurringTasks }))
      .toEqual({ createdAt: 'series', completedAt: null });
  });
});

describe('formatStamp', () => {
  const now = new Date(2026, 9, 22, 12);
  const formatTime = (hhmm) => `<${hhmm}>`;

  it('shows the date and the app\'s clock format, without the year this year', () => {
    expect(formatStamp('2026-10-19T09:14:00', { formatTime, now, language: 'en-US' })).toBe('Oct 19, <09:14>');
  });

  it('adds the year for another year, and shows a bare date alone', () => {
    expect(formatStamp('2025-03-02T18:00:00', { formatTime, now, language: 'en-US' })).toBe('Mar 2, 2025, <18:00>');
    expect(formatStamp('2026-08-01', { formatTime, now, language: 'en-US' })).toBe('Aug 1');
  });

  it('is null when there is nothing to show', () => {
    expect(formatStamp(null, { formatTime, now })).toBeNull();
  });
});
