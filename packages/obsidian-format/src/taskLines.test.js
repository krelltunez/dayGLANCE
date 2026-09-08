import { describe, it, expect } from 'vitest';
import { parseTasksFromMarkdown, legacyObsidianId, updateTaskLines, stampUntaggedTaskLines, planStampInsertions, splitNoteLines } from './index.js';

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

// ── noteDate: a target date equal to the note's own date clears the prefix ──
// (2026-09-06 field incident: "2026-09-06 …" prefixes written inside the
// 2026-09-06 note when tasks moved back onto the note's day.)
describe('updateTaskLines — noteDate and the inline date prefix', () => {
  const base = { obsidianRawTitle: 'Water the plants', completed: false, startTime: null, duration: null, blockId: 'abc12345' };

  it('writes the prefix when the target date differs from the note date', () => {
    const lines = ['- [ ] Water the plants ^dg-abc12345'];
    expect(updateTaskLines(lines, { ...base, targetDate: '2026-09-10', noteDate: '2026-09-06' })).toBe(true);
    expect(lines[0]).toBe('- [ ] 2026-09-10 Water the plants ^dg-abc12345');
  });

  it('clears an existing prefix when the target date IS the note date', () => {
    const lines = ['- [ ] 2026-09-10 Water the plants ^dg-abc12345'];
    expect(updateTaskLines(lines, { ...base, targetDate: '2026-09-06', noteDate: '2026-09-06' })).toBe(true);
    expect(lines[0]).toBe('- [ ] Water the plants ^dg-abc12345');
  });

  it('without noteDate the target date is written as given (older callers)', () => {
    const lines = ['- [ ] Water the plants ^dg-abc12345'];
    updateTaskLines(lines, { ...base, targetDate: '2026-09-06' });
    expect(lines[0]).toBe('- [ ] 2026-09-06 Water the plants ^dg-abc12345');
  });
});

describe('time prefix validation — hours AND minutes, and the stripper mirrors the parser (audit low, 2026-09-06)', () => {
  const DATE = '2026-09-06';
  it('minutes 60–99 do not parse as a time: the line is an inbox task whose title keeps the prefix text', () => {
    const { scheduledTasks, inboxTasks } = parseTasksFromMarkdown('- [ ] 09:60 Bad clock', DATE);
    expect(scheduledTasks).toHaveLength(0);
    expect(inboxTasks).toHaveLength(1);
    expect(inboxTasks[0].obsidianRawTitle).toBe('09:60 Bad clock');
  });
  it('a bad minute on either end of a range refuses the whole range, like a bad hour does', () => {
    for (const line of ['- [ ] 09:00-10:75 Long', '- [ ] 09:99-10:00 Long', '- [ ] 25:00-26:00 Long']) {
      const { scheduledTasks, inboxTasks } = parseTasksFromMarkdown(line, DATE);
      expect(scheduledTasks, line).toHaveLength(0);
      expect(inboxTasks, line).toHaveLength(1);
    }
    const ok = parseTasksFromMarkdown('- [ ] 09:00-10:59 Long', DATE).scheduledTasks;
    expect(ok).toHaveLength(1);
    expect(ok[0].duration).toBe(119);
  });
  it('the boundary minutes still parse: :00 and :59', () => {
    const t = parseTasksFromMarkdown('- [ ] 23:59 Late\n- [ ] 00:00 Early', DATE).scheduledTasks;
    expect(t.map((x) => x.startTime)).toEqual(['23:59', '00:00']);
  });
  it('a completion toggle on a line whose prefix the parser refused leaves that prefix in the title', () => {
    // The parser kept "25:00 Not a time" as the raw title. The write path
    // used to strip "25:00 " with its own looser regex, so the completed
    // line came back as "- [x] Not a time" — a title change nobody asked for.
    // [line body, the raw title the parser derives from it, the line after a completion toggle]
    const cases = [
      ['25:00 Not a time', '25:00 Not a time', '- [x] 25:00 Not a time'],
      ['09:60 Not a time', '09:60 Not a time', '- [x] 09:60 Not a time'],
      // A date prefix still parses (all-day); only the refused time stays in the title.
      ['2026-09-06 09:60 Not a time', '09:60 Not a time', '- [x] 2026-09-06 09:60 Not a time'],
    ];
    for (const [body, rawTitle, after] of cases) {
      const parsed = parseTasksFromMarkdown(`- [ ] ${body}`, DATE);
      const task = [...parsed.scheduledTasks, ...parsed.inboxTasks][0];
      expect(task.obsidianRawTitle, body).toBe(rawTitle);
      const lines = [`- [ ] ${body}`];
      expect(updateTaskLines(lines, { obsidianRawTitle: rawTitle, completed: true, startTime: null, duration: null, targetDate: null, noteDate: DATE }), body).toBe(true);
      expect(lines[0], body).toBe(after);
    }
  });
});

describe('CRLF notes (audit low, 2026-09-06)', () => {
  const DATE = '2026-09-06';
  const LF = '# Day\n\n- [ ] 09:00 Standup\n- [x] Water plants ✅ 2026-09-06\n';
  const CRLF = LF.replace(/\n/g, '\r\n');
  it('splitNoteLines: CRLF and bare CR split to clean lines and report the eol; LF reports LF', () => {
    expect(splitNoteLines(CRLF)).toEqual({ lines: ['# Day', '', '- [ ] 09:00 Standup', '- [x] Water plants ✅ 2026-09-06', ''], eol: '\r\n' });
    expect(splitNoteLines('a\rb\n').lines).toEqual(['a', 'b', '']);
    expect(splitNoteLines(LF).eol).toBe('\n');
    expect(splitNoteLines('').lines).toEqual(['']);
  });
  it('a CRLF note parses to the same tasks, titles, times and identities as its LF twin', () => {
    const a = parseTasksFromMarkdown(LF, DATE);
    const b = parseTasksFromMarkdown(CRLF, DATE);
    expect(b).toEqual(a);
    const all = [...a.scheduledTasks, ...a.inboxTasks];
    expect(all).toHaveLength(2);
    expect(a.scheduledTasks.map((t) => t.obsidianRawTitle)).toEqual(['Standup']);
    expect(all.some((t) => /\r/.test(t.obsidianRawTitle) || /\r/.test(t.title))).toBe(false);
  });
  it('stamping a CRLF note keeps every line ending CRLF and stamps the same ids as the LF twin', () => {
    const a = stampUntaggedTaskLines(LF, DATE);
    const b = stampUntaggedTaskLines(CRLF, DATE);
    expect(b.changed).toBe(true);
    expect(b.stamped.map((x) => x.blockId)).toEqual(a.stamped.map((x) => x.blockId));
    expect(b.text).toBe(a.text.replace(/\n/g, '\r\n'));
    expect(b.text).not.toMatch(/[^\r]\n/);
  });
  it('an already-stamped CRLF note round-trips byte-identical through the stamper', () => {
    const stamped = stampUntaggedTaskLines(CRLF, DATE).text;
    const again = stampUntaggedTaskLines(stamped, DATE);
    expect(again.changed).toBe(false);
    expect(again.text).toBe(stamped);
  });
  it('the stamp plan offsets are within the CR-free line, as the editor sees it', () => {
    const plan = planStampInsertions(CRLF, DATE);
    expect(plan).toHaveLength(2);
    for (const p of plan) {
      expect(p.fromCh).toBe(p.toCh);
      expect(splitNoteLines(CRLF).lines[p.line]).toHaveLength(p.toCh);
    }
  });
});
