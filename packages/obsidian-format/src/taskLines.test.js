import { describe, it, expect } from 'vitest';
import { parseTasksFromMarkdown, legacyObsidianId } from './index.js';

// Tasks-metadata PARSE-MAPPING pins, beside the grammar (moved from
// dayGLANCE's obsidian.tasksMetadataRead.test.js in the format-package
// extraction). The per-field vault-edit ADOPTION suites — ownership policy —
// stay in dayGLANCE, where the policy lives.

const DATE = '2026-09-01';
const BLOCK = 'aaaa1111';

describe('parse mapping', () => {
  it('⏳ scheduled → all-day task on that date; rawTitle stays FULL; display is stripped', () => {
    const { scheduledTasks } = parseTasksFromMarkdown(`- [ ] Water plants ⏳ 2026-09-05 ^dg-${BLOCK}`, DATE);
    expect(scheduledTasks).toHaveLength(1);
    const t = scheduledTasks[0];
    expect(t.date).toBe('2026-09-05');
    expect(t.isAllDay).toBe(true);
    expect(t.obsidianRawTitle).toBe('Water plants ⏳ 2026-09-05'); // frozen full text
    expect(t.title).toBe('Water plants #obsidian');               // display stripped
  });

  it('⏳ + a leading time prefix → timed task at that time on the ⏳ date', () => {
    const { scheduledTasks } = parseTasksFromMarkdown(`- [ ] 14:00 Standup ⏳ 2026-09-05`, DATE);
    expect(scheduledTasks[0]).toMatchObject({ date: '2026-09-05', startTime: '14:00', isAllDay: false });
  });

  it('an explicit inline date prefix WINS over ⏳ (dayGLANCEʼs own reschedule channel)', () => {
    const { scheduledTasks } = parseTasksFromMarkdown(`- [ ] 2026-09-07 Task ⏳ 2026-09-05 ^dg-${BLOCK}`, DATE);
    expect(scheduledTasks[0].date).toBe('2026-09-07');
  });

  it('📅-only stays INBOX, with the due date as deadline', () => {
    const { scheduledTasks, inboxTasks } = parseTasksFromMarkdown(`- [ ] Pay rent 📅 2026-09-10`, DATE);
    expect(scheduledTasks).toEqual([]);
    expect(inboxTasks[0]).toMatchObject({ deadline: '2026-09-10' });
    expect(inboxTasks[0].title).toBe('Pay rent #obsidian');
  });

  it('priority maps with the collapse; 🔁 sets the badge flag; both work on untagged lines too', () => {
    const { inboxTasks } = parseTasksFromMarkdown(`- [ ] Sharpen saw ⏫ 🔁 every week`, DATE);
    expect(inboxTasks[0]).toMatchObject({ priority: 3, obsidianRecurrence: true });
    expect(inboxTasks[0].title).toBe('Sharpen saw #obsidian');
    // Untagged identity is the hash of the FULL text — display stripping
    // must not perturb it.
    expect(inboxTasks[0].id).toBe(legacyObsidianId(DATE, 'Sharpen saw ⏫ 🔁 every week'));
  });

  it('✅ composition: trailing completion marker (tagged) + metadata both resolve, no duplication', () => {
    const { scheduledTasks } = parseTasksFromMarkdown(
      `- [x] Water plants ⏳ 2026-09-05 ✅ 2026-09-06 ^dg-${BLOCK}`, DATE);
    const t = scheduledTasks[0];
    expect(t.completedAt).toBe('2026-09-06');                      // #1470's channel
    expect(t.date).toBe('2026-09-05');                             // Step 2's mapping
    expect(t.obsidianRawTitle).toBe('Water plants ⏳ 2026-09-05'); // marker out, metadata frozen in
    expect(t.title).toBe('Water plants #obsidian');
  });
});
