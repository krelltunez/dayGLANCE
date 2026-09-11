import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, normalizeSettings, matches, mergeResponse, importTask,
  reconcileTask, additions, taskId, prepareOutbox, acknowledge, writebackReason, remoteFields } from './core.js';
import { requestSync, connectAccount, TODOIST_ENDPOINT, CONFIG_KEY, TOKEN_KEY, stateKey, readJSON, writeJSON } from './client.js';
const now = '2026-09-10T06:00:00.000Z';
const settings = patch => normalizeSettings({ ...DEFAULT_SETTINGS, mode: 'filtered', destination: 'inbox', ...patch });
const item = patch => ({ id: 'aBc123', content: 'Review plan', description: 'Notes', priority: 4,
  project_id: 'child', labels: ['work'], checked: false, is_deleted: false, ...patch });
const payload = patch => ({ full_sync: true, sync_token: 'cursor-1', user: { id: 'user1', full_name: 'Tester' },
  items: [item()], projects: [{ id: 'parent', name: 'Work' }, { id: 'child', name: 'Design', parent_id: 'parent' }], labels: [], ...patch });
const cache = patch => mergeResponse({}, payload(patch));
const local = patch => ({ ...importTask(item(), cache(), settings(), now), ...patch });

describe('selective rules', () => {
  it('defaults to disabled P1/P2, with no writes', () => {
    assert.equal(settings().enabled, false); assert.equal(settings().completionWriteback, false);
    assert.deepEqual(settings().priorities, [1, 2]);
  });
  it('maps all four visual priority values correctly', () => {
    for (let p = 1; p <= 4; p++) {
      assert(matches(item({ priority: 5 - p }), settings({ priorities: [p] })));
      assert.equal(remoteFields(item({ priority: 5 - p })).priority, 4 - p);
    }
  });
  it('fails closed with no filters', () => assert.equal(matches(item(), settings({ priorities: [] })), false));
  it('supports AND/OR between groups', () => {
    const config = { priorities: [2], labels: ['work'] };
    assert.equal(matches(item(), settings(config)), false);
    assert.equal(matches(item(), settings({ ...config, match: 'any' })), true);
  });
  it('supports all/any labels without changing case', () => {
    assert(matches(item(), settings({ priorities: [], labels: ['work', 'other'] })));
    assert(!matches(item(), settings({ priorities: [], labels: ['work', 'other'], labelMatch: 'all' })));
    assert(!matches(item(), settings({ priorities: [], labels: ['Work'] })));
  });
  it('includes subprojects only when selected', () => {
    assert(matches(item(), settings({ projects: ['parent'] }), cache().projects));
    assert(!matches(item(), settings({ projects: ['parent'], subprojects: false }), cache().projects));
  });
  it('terminates with a malformed project cycle', () => {
    assert(!matches(item(), settings({ projects: ['missing'] }), { child: { parent_id: 'child' } }));
  });
  it('normalizes settings and refuses invalid priorities/intervals', () => {
    assert.deepEqual(settings({ priorities: [0, 2, 2, 9] }).priorities, [2]);
    assert.equal(settings({ intervalMinutes: -1 }).intervalMinutes, 5);
    assert.deepEqual(settings({ priorities: 'bad' }).priorities, [1, 2]);
  });
});
describe('source reconciliation', () => {
  it('uses account-qualified string IDs and distinct deadline semantics', () => {
    const r = item({ due: { date: '2026-09-12T09:00:00', timezone: 'Asia/Singapore' } });
    const task = importTask(r, cache(), settings(), now);
    assert.equal(task.id, 'todoist:user1:aBc123'); assert.equal(task.deadline, null);
    assert.equal(task.date, null); assert.deepEqual(task.todoist.due, r.due);
    assert.equal(task.imported, false);
  });
  it('does not import completed or deleted records', () => {
    const c = cache({ items: [item({ checked: true }), item({ id: 'gone', is_deleted: true })] });
    assert.deepEqual(additions([], c, settings(), new Set(), now), []);
  });
  it('deduplicates across lists, tombstones and linked IDs', () => {
    assert.equal(additions([local()], cache(), settings(), new Set(), now).length, 0);
    assert.equal(additions([], cache(), settings(), new Set([taskId('user1', 'aBc123')]), now).length, 0);
    assert.equal(additions([local({ id: 'legacy-id' })], cache(), settings(), new Set(), now).length, 0);
  });
  it('preserves schedule and local-only fields during a pull', () => {
    const t = local({ date: '2026-09-20', startTime: '14:30', duration: 90, color: 'bg-blue-500' });
    const next = reconcileTask(t, cache({ items: [item({ content: 'Updated' })] }), settings(), now);
    assert.equal(next.title, 'Updated');
    for (const field of ['date', 'startTime', 'duration', 'color']) assert.equal(next[field], t[field]);
  });
  it('preserves local edits made while the request was in flight', () => {
    const t = local({ title: 'My change' });
    const next = reconcileTask(t, cache({ items: [item({ content: 'Their change' })] }), settings(), now);
    assert.equal(next.title, 'My change'); assert.equal(next.todoist.conflicts.title, 'Their change');
    assert.equal(reconcileTask(next, cache({ items: [item({ content: 'Their change' })] }), settings(), now).todoist.conflicts.title, 'Their change');
  });
  it('keeps local-only edits without inventing a conflict', () => {
    const next = reconcileTask(local({ title: 'My change' }), cache(), settings(), now);
    assert.equal(next.title, 'My change'); assert.deepEqual(next.todoist.conflicts, {});
  });
  it('never converts absent or deleted source records into local completion', () => {
    const t = local(); assert.equal(reconcileTask(t, cache({ items: [] }), settings(), now), t);
    const deleted = reconcileTask(t, cache({ items: [item({ is_deleted: true })] }), settings(), now);
    assert.equal(deleted.completed, false); assert.equal(deleted.todoist.remoteDeleted, true);
  });
  it('keeps out-of-scope rows but stops field updates', () => {
    const next = reconcileTask(local(), cache({ items: [item({ priority: 1, content: 'Changed' })] }), settings(), now);
    assert.equal(next.title, 'Review plan'); assert.equal(next.todoist.inScope, false);
  });
  it('merges explicit incremental completions and deletions', () => {
    const c = mergeResponse(cache(), payload({ full_sync: false, items: [item({ checked: true })], projects: [], labels: [] }));
    assert.equal(c.items.aBc123.checked, true); assert.equal(c.projects.parent.name, 'Work');
    assert.equal(reconcileTask(local(), c, settings(), now).completed, true);
  });
  it('rejects malformed snapshots and account crossovers', () => {
    assert.throws(() => mergeResponse(cache(), {}));
    assert.throws(() => mergeResponse(cache(), payload({ user: { id: 'someoneElse' } })), /accountChanged/);
  });
  it('does not modify other accounts or native tasks', () => {
    const t = local(); t.todoist.accountId = 'another';
    assert.equal(reconcileTask(t, cache(), settings(), now), t);
    const own = { id: 'local-task', title: 'Local' };
    assert.equal(reconcileTask(own, cache(), settings(), now), own);
  });
  it('returns identical objects for no-op syncs', () => {
    const t = local(); assert.equal(reconcileTask(t, cache(), settings(), now), t);
  });
});
describe('guarded completion outbox', () => {
  const config = settings({ completionWriteback: true });
  it('never emits deletes, edits or local task creation', () => {
    const result = prepareOutbox([], [{ id: 'native', completed: true }, local({ completed: true })], cache(), config, () => 'uuid1');
    assert.equal(result.send.length, 1); assert.equal(result.send[0].type, 'item_close');
    assert.deepEqual(result.send[0].args, { id: 'aBc123' });
  });
  it('never resends with a new UUID after an unconfirmed request', () => {
    const first = prepareOutbox([], [local({ completed: true })], cache(), config, () => 'original');
    const retried = prepareOutbox(first.queue, [local({ completed: true })], cache(), config, () => { throw Error('must not generate'); });
    assert.equal(retried.send[0].uuid, 'original');
  });
  it('retains operation errors despite HTTP 200', () => {
    const op = { uuid: 'one' };
    assert.equal(acknowledge([op], [op], { sync_status: { one: { error_code: 1 } } }).queue.length, 1);
    assert.equal(acknowledge([op], [op], { sync_status: { one: 'ok' } }).queue.length, 0);
    assert.equal(acknowledge([op], [op], {}).failed.length, 1);
  });
  it('does not close recurring tasks or parents with unselected children', () => {
    assert.equal(writebackReason(local({ completed: true }), cache({ items: [item({ due: { is_recurring: true } })] }), config), 'recurring');
    const c = cache({ items: [item(), item({ id: 'sub', parent_id: 'aBc123', priority: 1 })] });
    assert.equal(writebackReason(local({ completed: true }), c, config), 'parent');
  });
  it('does not complete someone else’s assigned task', () => {
    assert.equal(writebackReason(local({ completed: true }), cache({ items: [item({ responsible_uid: 'other' })] }), config), 'assignedElsewhere');
  });
  it('pauses queued writes after filter changes, undo or local deletion', () => {
    const first = prepareOutbox([], [local({ completed: true })], cache(), config, () => 'uuid');
    assert.equal(prepareOutbox(first.queue, [local({ completed: true })], cache(), settings({ completionWriteback: true, priorities: [4] }), () => '').send.length, 0);
    assert.equal(prepareOutbox(first.queue, [local()], cache(), config, () => '').send.length, 0);
    assert.equal(prepareOutbox(first.queue, [], cache(), config, () => '').send.length, 0);
  });
  it('retires a receipt when the server already reports completion', () => {
    const first = prepareOutbox([], [local({ completed: true })], cache(), config, () => 'uuid');
    const c = cache({ items: [item({ checked: true })] });
    assert.equal(prepareOutbox(first.queue, [local({ completed: true })], c, config, () => '').queue.length, 0);
  });
});
describe('transport and storage boundaries', () => {
  it('uses v1 Sync, a bearer header and no credential-bearing URL/proxy', async () => {
    let captured;
    await requestSync('secret', '*', [], { fetchImpl: async (url, init) => {
      captured = { url, init }; return { ok: true, json: async () => payload() };
    } });
    assert.equal(captured.url, TODOIST_ENDPOINT); assert(!captured.url.includes('secret'));
    assert.equal(captured.init.headers.Authorization, 'Bearer secret');
    assert.equal(captured.init.credentials, 'omit');
    assert.equal(captured.init.body.get('sync_token'), '*');
    assert.equal(captured.init.body.has('commands'), false);
  });
  it('honors rate-limit backoff and rejects invalid JSON/auth', async () => {
    await assert.rejects(requestSync('secret', '*', [], { fetchImpl: async () => ({ ok: false, status: 429, headers: new Headers({ 'Retry-After': '120' }) }) }), error => error.message === 'rateLimited' && error.retryAfter === 120);
    await assert.rejects(requestSync('secret', '*', [], { fetchImpl: async () => ({ ok: false, status: 401 }) }), /unauthorized/);
    await assert.rejects(requestSync('secret', '*', [], { fetchImpl: async () => ({ ok: true, json: async () => { throw Error('bad'); } }) }), /invalidResponse/);
  });
  it('does not use the cloud/device-backup namespace for secrets and cache', () => {
    for (const key of [CONFIG_KEY, TOKEN_KEY, stateKey('account')]) assert(!key.startsWith('day-planner-'));
  });
  it('fails closed on corrupt storage or full disk', () => {
    assert.throws(() => readJSON({ getItem: () => '{bad' }, 'key', {}), /storageCorrupt/);
    assert.throws(() => writeJSON({ setItem: () => { throw Error('full'); } }, 'key', {}), /storageFull/);
  });
});

describe('read-only reconnect', () => {
  it('resumes the saved cursor and captures completions while closed', async () => {
    const seen = [];
    const stored = { cache: cache(), queue: [{ uuid: 'pending' }] };
    const result = await connectAccount('secret', () => stored, { fetchImpl: async (url, init) => {
      seen.push(init.body.get('sync_token'));
      assert.equal(init.body.has('commands'), false);
      return { ok: true, json: async () => seen.length === 1 ? payload({ items: [] })
        : payload({ full_sync: false, items: [item({ checked: true })] }) };
    } });
    assert.deepEqual(seen, ['*', 'cursor-1']);
    assert.equal(result.cache.items.aBc123.checked, true);
    assert.equal(result.stored.queue[0].uuid, 'pending');
  });
  it('never loads another account cache under the old account ID', async () => {
    let loaded;
    await connectAccount('secret', id => { loaded = id; return {}; }, {
      fetchImpl: async () => ({ ok: true, json: async () => payload({ user: { id: 'new-user' } }) }),
    });
    assert.equal(loaded, 'new-user');
  });
});
