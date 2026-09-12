import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { pruneCache, mergeResponse, importTask, reconcileLists, normalizeSettings } from './core.js';
import { clearIdleCache, stateKey } from './client.js';

const item = (id, patch = {}) => ({ id, content: 'Task', priority: 4, checked: false, is_deleted: false, ...patch });
const cache = items => mergeResponse({}, {
  full_sync: true, sync_token: 'cursor', user: { id: 'account' }, items,
  projects: [{ id: 'live' }, { id: 'deleted', is_deleted: true }],
  labels: [{ id: 'label' }, { id: 'deleted-label', is_deleted: 1 }],
});
const storage = data => {
  const records = new Map(Object.entries(data));
  return {
    getItem: key => records.get(key) ?? null,
    setItem: (key, value) => records.set(key, value),
    removeItem: key => records.delete(key),
  };
};

describe('Todoist cache retention', () => {
  it('drops unlinked completed/deleted entries while retaining active tasks', () => {
    const source = cache([item('active'), item('done', { checked: 1 }), item('deleted', { is_deleted: true })]);
    assert.deepEqual(Object.keys(pruneCache(source).items), ['active']);
  });
  it('retains inactive items referenced by local tasks or pending operations', () => {
    const source = cache([item('linked', { checked: true }), item('queued', { is_deleted: 1 }), item('unlinked', { checked: true })]);
    const next = pruneCache(source, new Set(['linked', 'queued']));
    assert.deepEqual(Object.keys(next.items), ['linked', 'queued']);
    assert.equal(next.cursor, 'cursor');
    assert.equal(next.user, source.user);
  });
  it('prunes deleted projects and labels without mutating source maps', () => {
    const source = cache([item('active'), item('done', { checked: true })]);
    const before = JSON.stringify(source);
    const next = pruneCache(source);
    assert.deepEqual(Object.keys(next.projects), ['live']);
    assert.deepEqual(Object.keys(next.labels), ['label']);
    assert.equal(JSON.stringify(source), before);
  });
  it('releases previously retained inactive items after their references disappear', () => {
    const first = pruneCache(cache([item('done', { checked: true })]), new Set(['done']));
    assert.equal(Object.keys(pruneCache(first).items).length, 0);
  });
  it('does not accumulate a history of unlinked completed tasks across deltas', () => {
    let current = cache([item('active')]);
    for (let index = 0; index < 100; index++) {
      current = pruneCache(mergeResponse(current, {
        full_sync: false, sync_token: `cursor-${index}`,
        items: [item(`done-${index}`, { checked: true })], projects: [], labels: [],
      }));
      assert.equal(Object.keys(current.items).length, 1);
    }
    assert.equal(current.cursor, 'cursor-99');
  });
  it('preserves explicit completion evidence until linked tasks have reconciled', () => {
    const settings = normalizeSettings({ mode: 'all' });
    const now = '2026-09-12T01:00:00Z';
    const initial = cache([item('linked')]);
    const local = importTask(initial.items.linked, initial, settings, now);
    const completed = pruneCache(cache([item('linked', { checked: true })]), new Set(['linked']));
    const result = reconcileLists({ tasks: [], unscheduledTasks: [local], cache: completed, settings, now });
    assert.equal(result.unscheduledTasks[0].completed, true);
    assert.equal(result.recycleBin.length, 0);
  });
});

describe('Disconnect cache cleanup', () => {
  it('clears an idle account cache and leaves other accounts and imported tasks alone', () => {
    const store = storage({
      [stateKey('a')]: JSON.stringify({ cache: cache([]), queue: [], lastSync: 'before' }),
      [stateKey('b')]: 'other-account',
      'day-planner-tasks': '[{"id":"local"}]',
    });
    assert.equal(clearIdleCache(store, 'a'), 0);
    assert.equal(store.getItem(stateKey('a')), null);
    assert.equal(store.getItem(stateKey('b')), 'other-account');
    assert.equal(store.getItem('day-planner-tasks'), '[{"id":"local"}]');
  });
  it('preserves the entire pending receipt, including the original request UUID', () => {
    const raw = JSON.stringify({ cache: cache([]), queue: [{ uuid: 'original-uuid', args: { id: 'task' } }] });
    const store = storage({ [stateKey('a')]: raw });
    assert.equal(clearIdleCache(store, 'a'), 1);
    assert.equal(store.getItem(stateKey('a')), raw);
  });
  it('clears a legacy cache with no queue and tolerates missing cache keys', () => {
    const store = storage({ [stateKey('a')]: JSON.stringify({ cache: cache([]) }) });
    assert.equal(clearIdleCache(store, 'a'), 0);
    assert.equal(clearIdleCache(store, 'missing'), 0);
  });
  it('fails closed on corrupt queue data instead of dropping possible receipts', () => {
    for (const raw of ['broken JSON', 'null', '[]', '{"queue":{}}']) {
      const store = storage({ [stateKey('a')]: raw });
      assert.throws(() => clearIdleCache(store, 'a'), /storageCorrupt/);
      assert.equal(store.getItem(stateKey('a')), raw);
    }
  });
  it('reports an unavailable storage write without pretending cleanup succeeded', () => {
    const store = storage({});
    store.removeItem = () => { throw new Error('denied'); };
    assert.throws(() => clearIdleCache(store, 'a'), /storageFull/);
  });
});
