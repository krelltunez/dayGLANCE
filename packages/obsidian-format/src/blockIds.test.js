import { describe, it, expect } from 'vitest';
import {
  parseTasksFromMarkdown,
  updateTaskLines,
  deriveBlockId,
  splitBlockId,
  hasForeignBlockId,
  blockIdSuffix,
  legacyObsidianId,
  appIdForBlockId,
  simpleHash,
} from './index.js';

// Phase 2 block-id FORMAT pins: helpers, parse identity, and updateTaskLines'
// line-rewrite mechanics (moved from dayGLANCE's obsidian.blockIds.test.js in
// the format-package extraction). Note the write-time title guard tests here
// pin MECHANICS — divergence detected, the line's title kept, the callback
// fired; what the caller DOES about the conflict is policy and its tests
// stay in dayGLANCE. The write/sync round trips stay there too.

describe('block-id helpers', () => {
  it('deriveBlockId produces 8 lowercase base36 chars, distinct for distinct lines, identical for the same line', () => {
    const a = deriveBlockId('2026-08-22', 'Ship the report');
    const b = deriveBlockId('2026-08-22', 'Walk the dog');
    expect(a).toMatch(/^[a-z0-9]{8}$/);
    expect(b).toMatch(/^[a-z0-9]{8}$/);
    expect(a).not.toBe(b);
    expect(deriveBlockId('2026-08-22', 'Ship the report')).toBe(a);
  });

  it('splitBlockId strips only a TRAILING ^dg- token', () => {
    expect(splitBlockId('Review proposal ^dg-a1b2c3d4'))
      .toEqual({ text: 'Review proposal', blockId: 'a1b2c3d4' });
    // Mid-line ^dg- is title text, not an id.
    expect(splitBlockId('see ^dg-a1b2c3d4 for context').blockId).toBeNull();
    // A user's own block ref is not ours.
    expect(splitBlockId('Quote of the day ^quote1').blockId).toBeNull();
    // A bare caret is just a character.
    expect(splitBlockId('x^2 + y^2').blockId).toBeNull();
  });

  it('hasForeignBlockId / blockIdSuffix: never append after a user block ref', () => {
    expect(hasForeignBlockId('Quote of the day ^quote1')).toBe(true);
    expect(hasForeignBlockId('plain title')).toBe(false);
    expect(blockIdSuffix('abc12345', 'Quote of the day ^quote1')).toBe('');
    expect(blockIdSuffix('abc12345', 'plain title')).toBe(' ^dg-abc12345');
    expect(blockIdSuffix(null, 'plain title')).toBe('');
  });
});

describe('parseTasksFromMarkdown — ^dg- ids', () => {
  it('a tagged line gets the block-derived id, with the id stripped from title and hash', () => {
    const { inboxTasks } = parseTasksFromMarkdown('- [ ] Review proposal ^dg-a1b2c3d4', '2026-08-22');
    expect(inboxTasks).toHaveLength(1);
    const t = inboxTasks[0];
    expect(t.id).toBe(appIdForBlockId('a1b2c3d4'));
    expect(t.obsidianBlockId).toBe('a1b2c3d4');
    expect(t.obsidianRawTitle).toBe('Review proposal');
    expect(t.title).toBe('Review proposal #obsidian');
    // The legacy hint equals what the SAME line untagged would derive.
    const { inboxTasks: untagged } = parseTasksFromMarkdown('- [ ] Review proposal', '2026-08-22');
    expect(t.obsidianLegacyId).toBe(untagged[0].id);
  });

  it('the id survives time and inline-date prefixes (timed and all-day forms)', () => {
    const { scheduledTasks } = parseTasksFromMarkdown(
      [
        '- [ ] 09:00-10:00 Timed task ^dg-aaaaaaaa',
        '- [x] 2026-08-25 Moved task ^dg-bbbbbbbb',
      ].join('\n'),
      '2026-08-22',
    );
    expect(scheduledTasks.map(t => t.id)).toEqual([
      appIdForBlockId('aaaaaaaa'),
      appIdForBlockId('bbbbbbbb'),
    ]);
    expect(scheduledTasks[0].startTime).toBe('09:00');
    expect(scheduledTasks[0].duration).toBe(60);
    expect(scheduledTasks[1].date).toBe('2026-08-25');
    expect(scheduledTasks[1].completed).toBe(true);
  });

  it('the id is identical regardless of position in the file (reorder survival)', () => {
    const a = parseTasksFromMarkdown('- [ ] A ^dg-xxxxxxxx\n- [ ] B', '2026-08-22');
    const b = parseTasksFromMarkdown('- [ ] B\n- [ ] A ^dg-xxxxxxxx', '2026-08-22');
    expect(a.inboxTasks.find(t => t.obsidianBlockId).id)
      .toBe(b.inboxTasks.find(t => t.obsidianBlockId).id);
  });

  it('the id is identical regardless of which file the line is in (move survival)', () => {
    const seen1 = new Set();
    const inFileA = parseTasksFromMarkdown('- [ ] Task ^dg-xxxxxxxx', '2026-08-20', seen1);
    const seen2 = new Set();
    const inFileB = parseTasksFromMarkdown('- [ ] Task ^dg-xxxxxxxx', '2026-08-22', seen2);
    expect(inFileA.inboxTasks[0].id).toBe(inFileB.inboxTasks[0].id);
    expect(inFileA.inboxTasks[0].obsidianFileDate).toBe('2026-08-20');
    expect(inFileB.inboxTasks[0].obsidianFileDate).toBe('2026-08-22');
  });

  it('a retitled tagged line keeps its id (the Phase 2 exit criterion)', () => {
    const before = parseTasksFromMarkdown('- [ ] Old title ^dg-xxxxxxxx', '2026-08-22');
    const after = parseTasksFromMarkdown('- [ ] Completely new words ^dg-xxxxxxxx', '2026-08-22');
    expect(after.inboxTasks[0].id).toBe(before.inboxTasks[0].id);
    expect(after.inboxTasks[0].obsidianRawTitle).toBe('Completely new words');
  });

  it('duplicate ids (copy-paste): first occurrence wins, later ones parse as untagged', () => {
    const { inboxTasks } = parseTasksFromMarkdown(
      '- [ ] Original ^dg-xxxxxxxx\n- [ ] Original ^dg-xxxxxxxx',
      '2026-08-22',
    );
    expect(inboxTasks).toHaveLength(2);
    expect(inboxTasks[0].id).toBe(appIdForBlockId('xxxxxxxx'));
    expect(inboxTasks[1].id).toBe(legacyObsidianId('2026-08-22', 'Original'));
    expect(inboxTasks[1].obsidianBlockId).toBeUndefined();
  });

  it('the duplicate rule spans files when the sync shares one seen-set', () => {
    const seen = new Set();
    const fileA = parseTasksFromMarkdown('- [ ] Copied ^dg-xxxxxxxx', '2026-08-20', seen);
    const fileB = parseTasksFromMarkdown('- [ ] Copied ^dg-xxxxxxxx', '2026-08-22', seen);
    expect(fileA.inboxTasks[0].id).toBe(appIdForBlockId('xxxxxxxx'));
    expect(fileB.inboxTasks[0].id).toBe(legacyObsidianId('2026-08-22', 'Copied'));
  });

  it('untagged lines keep the legacy content-derived id exactly (fallback path intact)', () => {
    const { inboxTasks } = parseTasksFromMarkdown('- [ ] Plain old task', '2026-08-22');
    expect(inboxTasks[0].id).toBe(`obsidian-2026-08-22-${simpleHash('Plain old task')}`);
    expect(inboxTasks[0].obsidianBlockId).toBeUndefined();
    expect(inboxTasks[0].obsidianLegacyId).toBeUndefined();
  });

  it('a user-typed ^ in a title does not break parsing or matching', () => {
    const { inboxTasks } = parseTasksFromMarkdown(
      '- [ ] solve x^2 + y^2 = z^2\n- [ ] read note ^quote1\n- [ ] tagged x^2 task ^dg-cccccccc',
      '2026-08-22',
    );
    expect(inboxTasks[0].obsidianRawTitle).toBe('solve x^2 + y^2 = z^2');
    // A user block ref stays part of the title, exactly as before Phase 2.
    expect(inboxTasks[1].obsidianRawTitle).toBe('read note ^quote1');
    expect(inboxTasks[1].obsidianBlockId).toBeUndefined();
    // A caret in the title does not confuse the trailing-id strip.
    expect(inboxTasks[2].obsidianRawTitle).toBe('tagged x^2 task');
    expect(inboxTasks[2].obsidianBlockId).toBe('cccccccc');
  });
});

describe('updateTaskLines — ID-first matching with title fallback', () => {
  it('matches by id even when the title was edited in Obsidian — and KEEPS that edit', () => {
    const lines = ['- [ ] Renamed in Obsidian ^dg-xxxxxxxx'];
    const updated = updateTaskLines(lines, {
      obsidianRawTitle: 'Old title dayGLANCE knew',
      completed: true, startTime: null, newRawTitle: undefined,
      duration: null, targetDate: undefined, blockId: 'xxxxxxxx',
    });
    expect(updated).toBe(true);
    // The title match would have failed; the id pinned the line. The state
    // change lands, and — per the two-sided retitle policy's write-time
    // guard — the line's own title survives: a state write must never revert
    // an Obsidian retitle. (This test previously pinned the opposite,
    // pre-policy behavior: rebuilding the line from the stale app title.)
    expect(lines[0]).toBe('- [x] Renamed in Obsidian ^dg-xxxxxxxx');
  });

  it('with an id match, an untagged same-title line is left alone', () => {
    const lines = [
      '- [ ] Same title ^dg-xxxxxxxx',
      '- [ ] Same title',
    ];
    updateTaskLines(lines, {
      obsidianRawTitle: 'Same title',
      completed: true, startTime: null, newRawTitle: undefined,
      duration: null, targetDate: undefined, blockId: 'xxxxxxxx',
    });
    expect(lines).toEqual([
      '- [x] Same title ^dg-xxxxxxxx',
      '- [ ] Same title',
    ]);
  });

  it('fallback: no line carries the id → title match, and the id is stamped (opportunistic migration)', () => {
    const lines = ['- [ ] Legacy task', '- [ ] Other task'];
    const updated = updateTaskLines(lines, {
      obsidianRawTitle: 'Legacy task',
      completed: true, startTime: null, newRawTitle: undefined,
      duration: null, targetDate: undefined, blockId: 'yyyyyyyy',
    });
    expect(updated).toBe(true);
    expect(lines).toEqual(['- [x] Legacy task ^dg-yyyyyyyy', '- [ ] Other task']);
  });

  it('fallback never touches a line tagged with a DIFFERENT id (it is another task now)', () => {
    const lines = ['- [ ] Same title ^dg-other0000'];
    const updated = updateTaskLines(lines, {
      obsidianRawTitle: 'Same title',
      completed: true, startTime: null, newRawTitle: undefined,
      duration: null, targetDate: undefined, blockId: 'xxxxxxxx',
    });
    expect(updated).toBe(false);
    expect(lines[0]).toBe('- [ ] Same title ^dg-other0000');
  });

  it('a title ending in a user block ref is matched but NOT stamped', () => {
    const lines = ['- [ ] read note ^quote1'];
    const updated = updateTaskLines(lines, {
      obsidianRawTitle: 'read note ^quote1',
      completed: true, startTime: null, newRawTitle: undefined,
      duration: null, targetDate: undefined, blockId: 'zzzzzzzz',
    });
    expect(updated).toBe(true);
    expect(lines[0]).toBe('- [x] read note ^quote1');
  });

  it('a line that already carries our id keeps it even when the title now ends in a user block ref', () => {
    const lines = ['- [ ] cite ^src1 ^dg-xxxxxxxx'];
    updateTaskLines(lines, {
      obsidianRawTitle: 'cite ^src1',
      completed: true, startTime: null, newRawTitle: undefined,
      duration: null, targetDate: undefined, blockId: 'xxxxxxxx',
    });
    expect(lines[0]).toBe('- [x] cite ^src1 ^dg-xxxxxxxx');
  });

  it('untagged task with no blockId behaves exactly as before (pure legacy path)', () => {
    const lines = ['- [ ] Legacy task'];
    const updated = updateTaskLines(lines, {
      obsidianRawTitle: 'Legacy task',
      completed: true, startTime: '09:00', newRawTitle: undefined,
      duration: 30, targetDate: undefined, blockId: null,
    });
    expect(updated).toBe(true);
    expect(lines[0]).toBe('- [x] 09:00-09:30 Legacy task');
  });

  it('a rename via writeback rewrites the line and keeps the id at end of line', () => {
    const lines = ['- [ ] Old name ^dg-xxxxxxxx'];
    updateTaskLines(lines, {
      obsidianRawTitle: 'Old name',
      completed: false, startTime: null, newRawTitle: 'New name',
      duration: null, targetDate: undefined, blockId: 'xxxxxxxx',
    });
    expect(lines[0]).toBe('- [ ] New name ^dg-xxxxxxxx');
  });

  it('a reschedule to another day writes the inline date prefix and keeps the id', () => {
    const lines = ['- [ ] 09:00-09:30 Meeting ^dg-xxxxxxxx'];
    updateTaskLines(lines, {
      obsidianRawTitle: 'Meeting',
      completed: false, startTime: '10:00', newRawTitle: undefined,
      duration: 30, targetDate: '2026-08-25', blockId: 'xxxxxxxx',
    });
    expect(lines[0]).toBe('- [ ] 2026-08-25 10:00-10:30 Meeting ^dg-xxxxxxxx');
  });
});
