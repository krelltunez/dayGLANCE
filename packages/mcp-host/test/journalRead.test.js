// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { appendEntry, journalPage, publicJournalEntry, journalFilterKey } from '../src/journal.js';
import { MAX_LIST_LIMIT, DEFAULT_LIST_LIMIT } from '../src/pagination.js';

// The journal read back for a tool (#2321). Load-bearing: the op (before-state
// copies of user data) and the idempotency key never reach a row, whatever
// the op or the app's describe holds; the id filter narrows to rows whose ids
// match every filter given; the page is bounded by the kit's limit cap; and
// nothing trims the journal, so total counts every matching entry. The op
// vocabulary and its description are the app's: dayGLANCE's is pinned in
// electron/mcpJournalRead.test.ts. These tests use a minimal one.

const SECRET = 'before-state that must stay host-side';

/** A minimal describe: tasks and goals, with the before values it kept. */
function describeOp(op) {
  switch (op?.kind) {
    case 'remove_created':
      return { ids: { task_id: op.taskId } };
    case 'restore_fields':
      return {
        ids: { task_id: op.taskId },
        changes: Object.entries(op.before).map(([field, before]) => ({ field, before })),
      };
    case 'restore_goal':
      return { ids: { goal_id: op.goalId } };
    default:
      throw new Error(`unknown kind ${op?.kind}`);
  }
}

function journal(records) {
  let entries = [];
  records.forEach((record, i) => {
    entries = appendEntry(entries, record, `2026-10-04T10:${String(i).padStart(2, '0')}:00.000Z`);
  });
  return entries;
}

const history = journal([
  { tool: 'app_create_task', summary: 'Created “Alpha”', idempotencyKey: 'key-alpha', op: { kind: 'remove_created', taskId: 'a', beforeTask: { secret: SECRET } } },
  { tool: 'app_create_task', summary: 'Created “Beta”', op: { kind: 'remove_created', taskId: 'b' } },
  { tool: 'app_update_task', summary: 'Edited “Alpha” (title)', op: { kind: 'restore_fields', taskId: 'a', before: { title: 'Alpha draft' } } },
  { tool: 'app_update_goal', summary: 'Edited goal “Home”', op: { kind: 'restore_goal', goalId: 'g1', before: { secret: SECRET } } },
]);

const read = (opts = {}) => journalPage(history, { describe: describeOp, ...opts });

describe('journalPage — the journal as a read tool shows it', () => {
  it('newest first, every entry, with total, truncated and no cursor when it fits', () => {
    const page = read();
    expect(page.ok).toBe(true);
    expect(page.items.map((r) => r.summary)).toEqual([
      'Edited goal “Home”', 'Edited “Alpha” (title)', 'Created “Beta”', 'Created “Alpha”',
    ]);
    expect(page).toMatchObject({ total: 4, truncated: false, nextCursor: null });
  });

  it('a row is at, tool, summary, the ids, and the changes the app kept: nothing else', () => {
    const page = read();
    expect(page.items[1]).toEqual({
      at: '2026-10-04T10:02:00.000Z',
      tool: 'app_update_task',
      summary: 'Edited “Alpha” (title)',
      task_id: 'a',
      changes: [{ field: 'title', before: 'Alpha draft' }],
    });
    // A create keeps no field-level before: no changes key at all.
    expect(page.items[3]).toEqual({ at: '2026-10-04T10:00:00.000Z', tool: 'app_create_task', summary: 'Created “Alpha”', task_id: 'a' });
  });

  it('never carries the op, its before-state, the idempotency key or the seq, in any row', () => {
    const page = read();
    const raw = JSON.stringify(page.items);
    expect(raw).not.toContain(SECRET);
    expect(raw).not.toContain('key-alpha');
    expect(raw).not.toContain('remove_created');
    expect(raw).not.toContain('restore_');
    for (const row of page.items) {
      expect(row).not.toHaveProperty('op');
      expect(row).not.toHaveProperty('idempotencyKey');
      expect(row).not.toHaveProperty('seq');
    }
  });

  it('an app id may not take over a row key, and only string ids are kept', () => {
    const { row, ids } = publicJournalEntry(
      { at: 'x', tool: 't', summary: 's', op: {} },
      { describe: () => ({ ids: { summary: 'forged', op: 'forged', task_id: 'a', goal_id: 7, project_id: null } }) },
    );
    expect(row).toEqual({ at: 'x', tool: 't', summary: 's', task_id: 'a' });
    expect(ids).toEqual({ task_id: 'a' });
  });

  it('change items are rebuilt from field, before and after alone', () => {
    const { row } = publicJournalEntry(
      { at: 'x', tool: 't', summary: 's', op: {} },
      { describe: () => ({ changes: [
        { field: 'title', before: 'Old', op: { kind: 'leak' } },
        { field: 'notes', before: undefined, after: 'New' },
        { before: 'no field name' },
        null,
      ] }) },
    );
    expect(row.changes).toEqual([
      { field: 'title', before: 'Old' },
      { field: 'notes', before: null, after: 'New' },
    ]);
  });

  it('formatAt renders the stored time in the app\'s wire form', () => {
    const page = read({ formatAt: (at) => ({ date: at.slice(0, 10), time: at.slice(11, 16) }) });
    expect(page.items[0].at).toEqual({ date: '2026-10-04', time: '10:03' });
  });

  it('an op the app cannot describe is still listed, without ids, and matches no filter', () => {
    const entries = journal([{ tool: 'app_bulk', summary: 'Rescheduled 3 tasks', op: { kind: 'bulk_reschedule', secret: SECRET } }]);
    const all = journalPage(entries, { describe: describeOp });
    expect(all.items).toEqual([{ at: '2026-10-04T10:00:00.000Z', tool: 'app_bulk', summary: 'Rescheduled 3 tasks' }]);
    expect(JSON.stringify(all.items)).not.toContain(SECRET);
    expect(journalPage(entries, { describe: describeOp, match: { task_id: 'a' } }).items).toEqual([]);
  });

  it('an empty journal is an empty page, not an error', () => {
    expect(journalPage([], { describe: describeOp })).toEqual({ ok: true, items: [], truncated: false, nextCursor: null, total: 0 });
  });
});

describe('journalPage — the id filter', () => {
  it('narrows to the rows whose ids match, and total counts the filtered rows', () => {
    const page = read({ match: { task_id: 'a' } });
    expect(page.items.map((r) => r.summary)).toEqual(['Edited “Alpha” (title)', 'Created “Alpha”']);
    expect(page.total).toBe(2);
  });

  it('every filter given must match; an undefined filter is no filter', () => {
    expect(read({ match: { task_id: 'a', goal_id: 'g1' } }).items).toEqual([]);
    expect(read({ match: { goal_id: 'g1', task_id: undefined } }).items.map((r) => r.summary)).toEqual(['Edited goal “Home”']);
  });

  it('an id nothing touched is an empty page with total 0', () => {
    expect(read({ match: { task_id: 'nope' } })).toMatchObject({ ok: true, items: [], total: 0 });
  });

  it('a non-string filter value is refused, not coerced', () => {
    expect(read({ match: { task_id: 7 } })).toEqual({ ok: false, reason: 'task_id must be a string, got 7' });
  });
});

describe('journalPage — pagination', () => {
  const many = journal(Array.from({ length: 250 }, (_, i) => ({
    tool: 'app_create_task', summary: `Created “t${i}”`, op: { kind: 'remove_created', taskId: `t${i % 2}` },
  })));

  it('defaults to the kit\'s page and walks the rest with the cursor', () => {
    const first = journalPage(many, { describe: describeOp });
    expect(first.items).toHaveLength(DEFAULT_LIST_LIMIT);
    expect(first).toMatchObject({ total: 250, truncated: true });
    expect(first.items[0].summary).toBe('Created “t249”');
    const second = journalPage(many, { describe: describeOp, cursor: first.nextCursor });
    expect(second.items[0].summary).toBe(`Created “t${249 - DEFAULT_LIST_LIMIT}”`);
  });

  it('caps the limit: above the kit\'s maximum is refused, never a dump', () => {
    expect(journalPage(many, { describe: describeOp, limit: MAX_LIST_LIMIT + 1 })).toMatchObject({ ok: false, reason: expect.stringMatching(/<= 200/) });
    expect(journalPage(many, { describe: describeOp, limit: MAX_LIST_LIMIT }).items).toHaveLength(MAX_LIST_LIMIT);
    expect(journalPage(many, { describe: describeOp, limit: 0 })).toMatchObject({ ok: false });
  });

  it('a cursor is bound to its filter: changing the filter mid-walk is refused', () => {
    const first = journalPage(many, { describe: describeOp, match: { task_id: 't0' }, limit: 10 });
    expect(first.total).toBe(125);
    expect(journalPage(many, { describe: describeOp, match: { task_id: 't0' }, cursor: first.nextCursor }).ok).toBe(true);
    const changed = journalPage(many, { describe: describeOp, match: { task_id: 't1' }, cursor: first.nextCursor });
    expect(changed).toMatchObject({ ok: false, reason: expect.stringMatching(/different filter/) });
  });

  it('honours the host\'s cursor prefix', () => {
    const first = journalPage(many, { describe: describeOp, cursorPrefix: 'app1.' });
    expect(first.nextCursor).toMatch(/^app1\./);
  });
});

describe('journalFilterKey', () => {
  it('names only the filters set, in a stable order', () => {
    expect(journalFilterKey()).toBe('journal:all');
    expect(journalFilterKey({ task_id: undefined })).toBe('journal:all');
    expect(journalFilterKey({ task_id: 'a', goal_id: 'g' })).toBe(journalFilterKey({ goal_id: 'g', task_id: 'a' }));
  });
});
