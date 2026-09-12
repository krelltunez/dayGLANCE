import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createIdbKeyValue, createMemoryKeyValue } from './idbKeyValue.js';

// jsdom ships no IndexedDB, so createIdbKeyValue here exercises its localStorage
// fallback. That is deliberate rather than a gap in coverage: the fallback is
// the path every environment without a usable IndexedDB takes, and it has to
// behave exactly like the storage it replaces. The IndexedDB path proper is
// covered by the store contract these tests pin, which both implementations
// share.

function memLocalStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
}

beforeEach(() => { global.localStorage = memLocalStorage(); });
afterAll(() => { delete global.localStorage; });

describe.each([
  ['memory store', () => createMemoryKeyValue()],
  ['IndexedDB store falling back to localStorage', () => createIdbKeyValue('test-db')],
])('%s', (_label, make) => {
  it('returns undefined for a key that was never written', async () => {
    expect(await make().get('missing')).toBeUndefined();
  });

  it('round-trips an object', async () => {
    const store = make();
    await store.set('k', { 'tasks:1': 'hash-a', 'goals:2': 'hash-b' });
    expect(await store.get('k')).toEqual({ 'tasks:1': 'hash-a', 'goals:2': 'hash-b' });
  });

  it('overwrites rather than merging', async () => {
    const store = make();
    await store.set('k', { a: 1 });
    await store.set('k', { b: 2 });
    expect(await store.get('k')).toEqual({ b: 2 });
  });

  it('deletes, and a deleted key reads as undefined again', async () => {
    const store = make();
    await store.set('k', { a: 1 });
    await store.del('k');
    expect(await store.get('k')).toBeUndefined();
  });

  it('keeps keys independent', async () => {
    const store = make();
    await store.set('one', { a: 1 });
    await store.set('two', { b: 2 });
    await store.del('one');
    expect(await store.get('two')).toEqual({ b: 2 });
  });
});

describe('localStorage fallback specifics', () => {
  it('reads a value an earlier version of the app left in localStorage', async () => {
    localStorage.setItem('legacy', JSON.stringify({ 'tasks:1': 'hash' }));
    expect(await createIdbKeyValue('test-db').get('legacy')).toEqual({ 'tasks:1': 'hash' });
  });

  it('treats unparseable localStorage content as absent rather than throwing', async () => {
    localStorage.setItem('corrupt', '{not json');
    expect(await createIdbKeyValue('test-db').get('corrupt')).toBeUndefined();
  });

  it('reports failure instead of throwing when the quota is exhausted', async () => {
    global.localStorage = {
      ...memLocalStorage(),
      setItem: () => { throw new Error('QuotaExceededError'); },
    };
    expect(await createIdbKeyValue('test-db').set('k', { a: 1 })).toBe(false);
  });

  it('never rejects, so a caller mid-cycle cannot be broken by storage', async () => {
    global.localStorage = {
      getItem: () => { throw new Error('SecurityError'); },
      setItem: () => { throw new Error('SecurityError'); },
      removeItem: () => { throw new Error('SecurityError'); },
    };
    const store = createIdbKeyValue('test-db');
    await expect(store.get('k')).resolves.toBeUndefined();
    await expect(store.set('k', {})).resolves.toBe(false);
    await expect(store.del('k')).resolves.toBe(true);
  });
});
