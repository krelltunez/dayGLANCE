// The IndexedDB path, exercised against a real IndexedDB implementation.
//
// WHY THIS FILE IS SEPARATE
// jsdom ships no IndexedDB, so every other test in the repo runs
// createIdbKeyValue's localStorage fallback. That left the IndexedDB half —
// opening the database, creating the object store on upgrade, the transaction
// and request plumbing — with zero executions anywhere, including CI, while
// three merged changes came to depend on it.
//
// Importing fake-indexeddb/auto installs the globals for THIS FILE ONLY: vitest
// isolates each test file's environment by default. Installing it globally would
// be wrong, because the suites that assert on the fallback (idbKeyValue.test.js,
// the Todoist hook tests, dbEngineWiring) would silently stop testing it.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createIdbKeyValue } from './idbKeyValue.js';

function memLocalStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
}

// A fresh database name per test: createIdbKeyValue caches one connection per
// name for the life of the module, which is the behaviour we want in the app and
// a cross-test leak we do not want here.
let counter = 0;
const freshStore = () => createIdbKeyValue(`kv-test-${++counter}`);

beforeEach(() => { global.localStorage = memLocalStorage(); });
afterAll(() => { delete global.localStorage; });

describe('the IndexedDB path', () => {
  it('creates its object store and round-trips a value', async () => {
    // Proves openDatabase resolved a real connection and onupgradeneeded ran:
    // without the store, the transaction would throw and this would fall back.
    const store = freshStore();
    await store.set('baseline', { 'tasks:1': 'hash-a' });
    expect(await store.get('baseline')).toEqual({ 'tasks:1': 'hash-a' });
    // ...and it is genuinely in IndexedDB, not the fallback.
    expect(localStorage.getItem('baseline')).toBeNull();
  });

  it('stores structured clones, so nesting survives without a JSON round trip', async () => {
    const store = freshStore();
    const value = { items: { a: { id: 'a', labels: ['x', 'y'], due: null } }, cursor: 'abc' };
    await store.set('cache', value);
    const read = await store.get('cache');
    expect(read).toEqual(value);
    expect(read).not.toBe(value); // a clone, not the same reference
  });

  it('returns undefined for a key that was never written', async () => {
    expect(await freshStore().get('missing')).toBeUndefined();
  });

  it('overwrites rather than merging', async () => {
    const store = freshStore();
    await store.set('k', { a: 1 });
    await store.set('k', { b: 2 });
    expect(await store.get('k')).toEqual({ b: 2 });
  });

  it('deletes, and a deleted key reads as undefined again', async () => {
    const store = freshStore();
    await store.set('k', { a: 1 });
    await store.del('k');
    expect(await store.get('k')).toBeUndefined();
  });

  it('keeps keys independent', async () => {
    const store = freshStore();
    await store.set('one', { a: 1 });
    await store.set('two', { b: 2 });
    await store.del('one');
    expect(await store.get('two')).toEqual({ b: 2 });
  });

  it('keeps databases independent', async () => {
    const a = freshStore();
    const b = freshStore();
    await a.set('shared-key', { from: 'a' });
    expect(await b.get('shared-key')).toBeUndefined();
  });

  it('reuses its connection across calls', async () => {
    // The connection is cached per database name, so a second call must not
    // re-run the upgrade and lose what the first one wrote.
    const store = freshStore();
    await store.set('k', { a: 1 });
    expect(await store.get('k')).toEqual({ a: 1 });
    expect(await store.get('k')).toEqual({ a: 1 });
  });
});

describe('migrating off localStorage', () => {
  it('reads a value an older version left in localStorage', async () => {
    // The read falls through to localStorage when IndexedDB has nothing, which
    // is what lets the sync snapshot and the Todoist cache carry their existing
    // state across the upgrade instead of starting cold.
    localStorage.setItem('legacy', JSON.stringify({ 'tasks:1': 'hash' }));
    expect(await freshStore().get('legacy')).toEqual({ 'tasks:1': 'hash' });
  });

  it('clears the localStorage copy once the value is written to IndexedDB', async () => {
    // Otherwise the bytes are never actually reclaimed, which was the point.
    const store = freshStore();
    localStorage.setItem('legacy', JSON.stringify({ old: true }));
    await store.set('legacy', { migrated: true });
    expect(localStorage.getItem('legacy')).toBeNull();
    expect(await store.get('legacy')).toEqual({ migrated: true });
  });

  it('prefers IndexedDB over a stale localStorage copy', async () => {
    const store = freshStore();
    await store.set('k', { source: 'idb' });
    localStorage.setItem('k', JSON.stringify({ source: 'stale localStorage' }));
    expect(await store.get('k')).toEqual({ source: 'idb' });
  });

  it('removes both copies on delete', async () => {
    const store = freshStore();
    await store.set('k', { a: 1 });
    localStorage.setItem('k', JSON.stringify({ a: 1 }));
    await store.del('k');
    expect(await store.get('k')).toBeUndefined();
    expect(localStorage.getItem('k')).toBeNull();
  });
});
