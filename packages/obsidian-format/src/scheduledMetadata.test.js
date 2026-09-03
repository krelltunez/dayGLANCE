import { describe, it, expect } from 'vitest';
import { withScheduledMetadata, splitTasksMetadata, parseTasksFromMarkdown } from './index.js';

// Companion §6, ruling B: a non-daily task's schedule lives on its line as
// metadata. The writer replaces, appends or removes the scheduled segment
// and leaves every other segment verbatim; the parser reads it back.

describe('withScheduledMetadata', () => {
  it('appends when absent, replaces when present (either format), removes on null, keeps other metadata', () => {
    expect(withScheduledMetadata('Order tiles', '2026-09-12', 'tasks')).toBe('Order tiles ⏳ 2026-09-12');
    expect(withScheduledMetadata('Order tiles', '2026-09-12', 'dataview')).toBe('Order tiles [scheduled:: 2026-09-12]');
    expect(withScheduledMetadata('Order tiles ⏳ 2026-09-12 📅 2026-09-20', '2026-09-15', 'tasks')).toBe('Order tiles 📅 2026-09-20 ⏳ 2026-09-15');
    expect(withScheduledMetadata('Order tiles [scheduled:: 2026-09-12] [due:: 2026-09-20]', '2026-09-15', 'dataview')).toBe('Order tiles [due:: 2026-09-20] [scheduled:: 2026-09-15]');
    expect(withScheduledMetadata('Order tiles ⏳ 2026-09-12 🔁 every week', null, 'tasks')).toBe('Order tiles 🔁 every week');
    expect(withScheduledMetadata('Order tiles ⏳ 2026-09-12', null)).toBe('Order tiles');
    expect(withScheduledMetadata('Order tiles', null)).toBe('Order tiles');
  });

  it('round-trips through the parser: the written date schedules the line, removal sends it to the inbox', () => {
    const raw = withScheduledMetadata('Order tiles', '2026-09-12', 'tasks');
    const scheduled = parseTasksFromMarkdown(`- [ ] ${raw} ^dg-22222222\n`, '2026-09-02', new Set(), { notePath: 'Projects/House.md' });
    expect(scheduled.scheduledTasks[0]).toMatchObject({ date: '2026-09-12', isAllDay: true, obsidianRawTitle: raw });
    expect(splitTasksMetadata(raw).fields.scheduled).toBe('2026-09-12');
    const cleared = parseTasksFromMarkdown(`- [ ] ${withScheduledMetadata(raw, null)} ^dg-22222222\n`, '2026-09-02', new Set(), { notePath: 'Projects/House.md' });
    expect(cleared.scheduledTasks).toHaveLength(0);
    expect(cleared.inboxTasks).toHaveLength(1);
  });
});
