import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { connectAccount } from './client.js';
import { normalizeSettings, matches, mergeResponse, importTask, reconcileTask, reconcileLists,
  dueParts, dateParts, prepareOutbox } from './core.js';
const now = '2026-09-10T06:00:00.000Z';
const config = patch => normalizeSettings(patch);
const item = patch => ({ id: 'task1', project_id: 'work', content: 'Task', description: '', labels: ['focus'],
  priority: 1, checked: false, is_deleted: false, due: { date: '2026-09-10' }, ...patch });
const cache = (items = [item()]) => mergeResponse({}, { full_sync: true, sync_token: 'cursor',
  user: { id: 'account', full_name: 'Test', tz_info: { timezone: 'Asia/Singapore' } },
  items, projects: [{ id: 'work', name: 'Work' }], labels: [] });
const plan = (c = cache(), settings = config(), patch = {}) => reconcileLists({ tasks: [], unscheduledTasks: [],
  recycleBin: [], cache: c, settings, now, ...patch });

describe('V2 defaults and date scopes', () => {
  it('uses today without writes or automatic sync for a fresh install', () => {
    const s = config();
    assert.equal(s.mode, 'today'); assert.equal(s.destination, 'today');
    assert.equal(s.enabled, false); assert.equal(s.completionWriteback, false);
  });
  it('migrates legacy rules without broadening the selection or moving calendar blocks', () => {
    const s = config({ priorities: [2], labels: ['legacy'], enabled: true });
    assert.equal(s.mode, 'filtered'); assert.equal(s.destination, 'inbox');
    assert.deepEqual(s.priorities, [2]); assert.deepEqual(s.labels, ['legacy']);
  });
  it('today ignores P1/P2, project, and label filters', () => {
    assert(matches(item(), config({ mode: 'today', priorities: [1], projects: ['absent'], labels: ['absent'] }), {}, now, 'Asia/Singapore'));
  });
  it('all active scope ignores stale todayOnly and advanced filters', () => {
    assert(matches(item({ due: null }), config({ mode: 'all', todayOnly: true, priorities: [1] }), {}, now));
  });
  it('excludes no-date, tomorrow and overdue by default', () => {
    for (const due of [null, { date: '2026-09-09' }, { date: '2026-09-11' }]) assert(!matches(item({ due }), config(), {}, now, 'Asia/Singapore'));
  });
  it('overdue is opt-in and imported to Today without inventing a deadline', () => {
    const p = plan(cache([item({ due: { date: '2026-09-08' } })]), config({ includeOverdue: true }));
    assert.equal(p.tasks[0].date, '2026-09-10'); assert.equal(p.tasks[0].deadline, null);
  });
  it('filtered today is an additional constraint, not an OR group', () => {
    const s = config({ mode: 'filtered', priorities: [4], todayOnly: true, match: 'any', labels: ['focus'] });
    assert(!matches(item({ due: { date: '2026-09-11' } }), s, {}, now, 'Asia/Singapore'));
  });
  it('empty filtered rules still fail closed', () => {
    assert.equal(plan(cache(), config({ mode: 'filtered', priorities: [] })).report.matched, 0);
  });
  it('normalizes fixed UTC due times across midnight in the account timezone', () => {
    assert.deepEqual(dueParts({ date: '2026-09-09T17:30:00Z' }, 'Asia/Singapore'), { date: '2026-09-10', time: '01:30' });
    assert.equal(dateParts('2026-09-09T17:30:00Z', 'Asia/Singapore').date, '2026-09-10');
  });
  it('preserves floating wall-clock times and date-only values', () => {
    assert.deepEqual(dueParts({ date: '2026-09-10T09:15:00' }, 'America/Los_Angeles'), { date: '2026-09-10', time: '09:15' });
    assert.deepEqual(dueParts({ date: '2026-09-10' }), { date: '2026-09-10', time: null });
  });
  it('rejects malformed and nonexistent dates instead of silently shifting them', () => {
    for (const date of ['2026-02-30', 'bad', '2026-09-10T25:00:00', '2026-09-10T00:91:00']) assert.equal(dueParts({ date }).date, null);
  });
  it('puts timed, date-only and undated tasks into the correct buckets', () => {
    const p = plan(cache([item(), item({ id: 'timed', due: { date: '2026-09-10T09:30:00' }, duration: { unit: 'minute', amount: 60 } }), item({ id: 'inbox', due: null })]), config({ mode: 'all', destination: 'due' }));
    assert.equal(p.tasks.length, 2); assert.equal(p.unscheduledTasks.length, 1);
    assert.equal(p.tasks[0].isAllDay, true); assert.equal(p.tasks[1].startTime, '09:30'); assert.equal(p.tasks[1].duration, 60);
  });
});
describe('V2 diagnostics and nondestructive pull', () => {
  it('adds once, then reports unchanged without duplicates', () => {
    const first = plan(); const second = plan(cache(), config(), first);
    assert.equal(first.report.added, 1); assert.equal(second.report.added, 0);
    assert.equal(second.report.unchanged, 1); assert.equal(second.tasks.length, 1);
  });
  it('moves legacy imported inbox tasks to today on an explicit mode switch', () => {
    const t = importTask(item(), cache(), config({ mode: 'filtered', priorities: [4], destination: 'inbox' }), now);
    const p = plan(cache(), config(), { unscheduledTasks: [t] });
    assert.equal(p.tasks.length, 1); assert.equal(p.unscheduledTasks.length, 0);
  });
  it('does not overwrite a manually scheduled time block in ordinary pull mode', () => {
    const t = { ...plan().tasks[0], date: '2026-09-12', startTime: '14:00', duration: 90 };
    const p = plan(cache(), config(), { tasks: [t] });
    assert.equal(p.tasks[0].date, '2026-09-12'); assert.equal(p.tasks[0].startTime, '14:00');
  });
  it('never changes native task buckets, even when a native task has a date', () => {
    const native = { id: 'native', title: 'Private local task', date: '2026-09-10' };
    const p = plan(cache(), config(), { unscheduledTasks: [native] });
    assert.equal(p.unscheduledTasks[0], native);
  });
  it('distinguishes empty account, no today match, filter mismatch and suppressed deletes', () => {
    assert.equal(plan(cache([])).report.reason, 'noActive');
    assert.equal(plan(cache([item({ due: null })])).report.reason, 'noToday');
    assert.equal(plan(cache(), config({ mode: 'filtered', priorities: [1] })).report.reason, 'noMatch');
    const p = plan(cache(), config(), { blockedIds: new Set(['todoist:account:task1']) });
    assert.equal(p.report.reason, 'suppressed'); assert.equal(p.report.suppressed, 1);
  });
  it('captures explicit completion after a task ages out of Today without changing its historical date', () => {
    const t = plan().tasks[0]; const c = cache([item({ checked: true, completed_at: now })]);
    const next = reconcileTask(t, c, config(), '2026-09-11T06:00:00Z');
    assert.equal(next.completed, true); assert.equal(next.date, '2026-09-10');
  });
  it('merges sparse incremental deletion fields into the known source', () => {
    const c = mergeResponse(cache(), { full_sync: false, sync_token: 'next', items: [{ id: 'task1', is_deleted: true }], projects: [], labels: [] });
    assert.equal(c.items.task1.content, 'Task'); assert.equal(c.items.task1.is_deleted, true);
  });
});
describe('Non-destructive selective import', () => {
  it('migrates experimental mirror settings without enabling automation or writes', () => {
    for (const mirrorScope of ['today', 'all', 'filtered']) {
      const s = config({ mode: 'mirror', mirrorScope, enabled: true, completionWriteback: true, labels: ['focus'] });
      assert.equal(s.mode, mirrorScope);
      assert.equal(s.enabled, false);
      assert.equal(s.completionWriteback, false);
      assert.deepEqual(s.labels, ['focus']);
      assert(!Object.keys(s).some(key => key.startsWith('mirror')));
    }
    assert.equal(config({ mode: 'mirror' }).mode, 'filtered');
  });
  it('keeps explicitly deleted linked tasks and never changes the recycle bin', () => {
    const t = plan().tasks[0];
    const bin = [{ id: 'previously-removed' }];
    const p = plan(cache([item({ is_deleted: true })]), config(), { tasks: [t], recycleBin: bin });
    assert.equal(p.tasks.length, 1);
    assert.equal(p.tasks[0].completed, false);
    assert.equal(p.tasks[0].todoist.remoteDeleted, true);
    assert.equal(p.recycleBin, bin);
  });
  it('keeps linked tasks that move out of the filter', () => {
    const s = config({ mode: 'filtered', priorities: [4], projects: ['work'] });
    const t = plan().tasks[0];
    const p = plan(cache([item({ project_id: 'other' })]), s, { tasks: [t] });
    assert.equal(p.tasks.length, 1);
    assert.equal(p.tasks[0].todoist.inScope, false);
    assert.deepEqual(p.recycleBin, []);
  });
  it('never restores deleted copies, including former experimental mirror archives', () => {
    const t = plan().tasks[0];
    for (const mirrorRemoved of [undefined, 'scope', 'deleted']) {
      const archived = { ...t, deletedAt: now, todoist: { ...t.todoist, mirrorRemoved } };
      const bin = [archived];
      const p = plan(cache(), config(), { recycleBin: bin });
      assert.equal(p.tasks.length, 0);
      assert.equal(p.report.suppressed, 1);
      assert.equal(p.recycleBin, bin);
    }
  });
  it('retains missing source records and reports uncertainty', () => {
    const t = plan().tasks[0];
    const p = plan(cache([]), config(), { tasks: [t] });
    assert.equal(p.tasks[0], t);
    assert.equal(p.report.unknown, 1);
    assert.equal(p.recycleBin.length, 0);
  });
  it('preserves completion history instead of deleting completed tasks', () => {
    const t = plan().tasks[0];
    const p = plan(cache([item({ checked: true })]), config(), { tasks: [t] });
    assert.equal(p.tasks[0].completed, true);
    assert.equal(p.recycleBin.length, 0);
  });
  it('does not emit write commands unless completion writeback is enabled', () => {
    const t = { ...plan().tasks[0], completed: true };
    assert.deepEqual(prepareOutbox([], [t], cache(), config(), () => 'uuid', now).send, []);
  });
});

describe('V2 connection freshness', () => {
  it('follows even a first full response with an incremental read-only request', async () => {
    const cursors = [];
    const responses = [
      { full_sync: true, sync_token: 'full', user: { id: 'account' }, items: [], projects: [], labels: [] },
      { full_sync: false, sync_token: 'delta', items: [item()], projects: [], labels: [] },
    ];
    const result = await connectAccount('mock-token', () => ({}), { fetchImpl: async (url, init) => {
      cursors.push(init.body.get('sync_token'));
      assert(!init.body.has('commands'));
      return { ok: true, json: async () => responses.shift() };
    } });
    assert.deepEqual(cursors, ['*', 'full']); assert.equal(result.cache.items.task1.content, 'Task');
  });
});
