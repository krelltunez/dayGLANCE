import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { pruneCache, mergeResponse, importTask, reconcileLists, normalizeSettings } from './core.js';
import { clearIdleCache, stateKey, cacheKey, readAccountState, writeAccountState } from './client.js';
import { createMemoryKeyValue } from '../utils/idbKeyValue.js';

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

describe('Account state is split across two homes', () => {
  // The cache is bulk derived data and belongs in IndexedDB. The receipts are
  // tiny and safety-critical: a command UUID must be durable BEFORE its request
  // goes out, so they stay in synchronous localStorage.
  it('writes the cache to the store and the receipts to localStorage', async () => {
    const kv = createMemoryKeyValue();
    const store = storage({});
    await writeAccountState('a', { cache: cache([item('x')]), queue: [{ uuid: 'u' }], lastSync: 'now' }, store, kv);

    const receipts = JSON.parse(store.getItem(stateKey('a')));
    assert.deepEqual(receipts, { queue: [{ uuid: 'u' }], lastSync: 'now' });
    assert.equal(receipts.cache, undefined); // the bulk is NOT in localStorage
    assert.ok((await kv.get(cacheKey('a'))).items.x);
  });

  it('reads the two halves back as one object', async () => {
    const kv = createMemoryKeyValue();
    const store = storage({});
    await writeAccountState('a', { cache: cache([item('x')]), queue: [], lastSync: 'now' }, store, kv);
    const read = await readAccountState('a', store, kv);
    assert.equal(read.lastSync, 'now');
    assert.ok(read.cache.items.x);
  });

  it('adopts a pre-split blob and strips the cache from localStorage', async () => {
    const kv = createMemoryKeyValue();
    const legacy = { cache: cache([item('x')]), queue: [{ uuid: 'u' }], lastSync: 'before' };
    const store = storage({ [stateKey('a')]: JSON.stringify(legacy) });

    const read = await readAccountState('a', store, kv);
    assert.ok(read.cache.items.x);          // the caller sees no difference
    assert.equal(read.lastSync, 'before');
    // ...but the bytes actually moved, which is the point of the migration.
    assert.equal(JSON.parse(store.getItem(stateKey('a'))).cache, undefined);
    assert.deepEqual(JSON.parse(store.getItem(stateKey('a'))).queue, [{ uuid: 'u' }]);
    assert.ok((await kv.get(cacheKey('a'))).items.x);
  });

  it('returns an empty state for an account it has never seen', async () => {
    assert.deepEqual(await readAccountState('nobody', storage({}), createMemoryKeyValue()), {});
  });
});

describe('Disconnect cache cleanup', () => {
  it('clears an idle account cache and leaves other accounts and imported tasks alone', async () => {
    const kv = createMemoryKeyValue();
    const store = storage({
      [stateKey('a')]: JSON.stringify({ queue: [], lastSync: 'before' }),
      [stateKey('b')]: 'other-account',
      'day-planner-tasks': '[{"id":"local"}]',
    });
    await kv.set(cacheKey('a'), cache([]));
    await kv.set(cacheKey('b'), cache([]));

    assert.equal(await clearIdleCache(store, 'a', kv), 0);
    assert.equal(store.getItem(stateKey('a')), null);
    assert.equal(await kv.get(cacheKey('a')), undefined);   // both homes cleared
    assert.equal(store.getItem(stateKey('b')), 'other-account');
    assert.ok(await kv.get(cacheKey('b')));                 // the other account is untouched
    assert.equal(store.getItem('day-planner-tasks'), '[{"id":"local"}]');
  });
  it('preserves the entire pending receipt, including the original request UUID', async () => {
    const kv = createMemoryKeyValue();
    const raw = JSON.stringify({ queue: [{ uuid: 'original-uuid', args: { id: 'task' } }] });
    const store = storage({ [stateKey('a')]: raw });
    await kv.set(cacheKey('a'), cache([]));

    assert.equal(await clearIdleCache(store, 'a', kv), 1);
    assert.equal(store.getItem(stateKey('a')), raw);
    // The cache survives too: a retained queue means this account is expected back.
    assert.ok(await kv.get(cacheKey('a')));
  });
  it('clears a legacy cache with no queue and tolerates missing cache keys', async () => {
    const kv = createMemoryKeyValue();
    const store = storage({ [stateKey('a')]: JSON.stringify({ cache: cache([]) }) });
    assert.equal(await clearIdleCache(store, 'a', kv), 0);
    assert.equal(await clearIdleCache(store, 'missing', kv), 0);
  });
  it('fails closed on corrupt queue data instead of dropping possible receipts', async () => {
    for (const raw of ['broken JSON', 'null', '[]', '{"queue":{}}']) {
      const store = storage({ [stateKey('a')]: raw });
      await assert.rejects(() => clearIdleCache(store, 'a', createMemoryKeyValue()), /storageCorrupt/);
      assert.equal(store.getItem(stateKey('a')), raw);
    }
  });
  it('reports an unavailable storage write without pretending cleanup succeeded', async () => {
    const store = storage({});
    store.removeItem = () => { throw new Error('denied'); };
    await assert.rejects(() => clearIdleCache(store, 'a', createMemoryKeyValue()), /storageFull/);
  });
});
