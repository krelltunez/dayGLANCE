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

import { withProjectMetadata } from './index.js';

// Companion §4.3, ruling G as amended: the project rides the line as a
// Dataview field whose value may be a wikilink.
describe('the project field and withProjectMetadata', () => {
  it('a wikilink value nests inside the field: recognized as metadata, stripped from the display text, read back raw', () => {
    const raw = 'Call the plumber [project:: [[Projects/House|House]]] ⏳ 2026-09-12';
    const split = splitTasksMetadata(raw);
    expect(split.text).toBe('Call the plumber');
    expect(split.metaText).toBe(' [project:: [[Projects/House|House]]] ⏳ 2026-09-12');
    expect(split.fields.project).toBe('[[Projects/House|House]]');
    expect(split.fields.scheduled).toBe('2026-09-12');
    expect(splitTasksMetadata('Call the plumber [project:: House]').fields.project).toBe('House');
    expect(splitTasksMetadata('Call the plumber').fields.project).toBe(null);
  });
  it('appends, replaces, removes, and keeps the other segments verbatim', () => {
    expect(withProjectMetadata('Call the plumber', '[[Projects/House|House]]')).toBe('Call the plumber [project:: [[Projects/House|House]]]');
    expect(withProjectMetadata('Call the plumber [project:: House] 📅 2026-09-20', '[[Projects/House|House]]')).toBe('Call the plumber 📅 2026-09-20 [project:: [[Projects/House|House]]]');
    expect(withProjectMetadata('Call the plumber ⏳ 2026-09-12 [project:: [[Projects/House|House]]]', null)).toBe('Call the plumber ⏳ 2026-09-12');
    expect(withProjectMetadata('Call the plumber', null)).toBe('Call the plumber');
    // The parser reads the written line back under the same identity rules as any other line.
    const line = `- [ ] ${withProjectMetadata('Order tiles', '[[Projects/House|House]]')} ^dg-22222222\n`;
    const { inboxTasks } = parseTasksFromMarkdown(line, '2026-09-02');
    expect(inboxTasks[0].title).toBe('Order tiles #obsidian');
    expect(splitTasksMetadata(inboxTasks[0].obsidianRawTitle).fields.project).toBe('[[Projects/House|House]]');
  });
});
