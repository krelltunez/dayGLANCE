import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  resetAppData,
  clearWebStorage,
  clearCacheStorage,
  clearICloudSnapshot,
  deleteIndexedDbDatabases,
  isResetInProgress,
  __resetGuardForTests,
  ICLOUD_SYNC_FILE,
  KNOWN_INDEXEDDB_NAMES,
} from './resetAppData.js';

// ── Fakes ──────────────────────────────────────────────────────────────────

const fakeStorage = () => ({ clear: vi.fn() });

// deleteDatabase returns a request object whose handlers the caller assigns
// after the call, so fire them asynchronously like a real IDB request does.
const fakeIndexedDB = ({ databases, failFor = [], blockFor = [] } = {}) => ({
  deleted: [],
  databases: databases ? vi.fn(async () => databases) : undefined,
  deleteDatabase(name) {
    const req = { error: null };
    queueMicrotask(() => {
      if (blockFor.includes(name)) return; // never settles → timeout path
      if (failFor.includes(name)) {
        req.error = new Error('boom');
        req.onerror?.();
      } else {
        this.deleted.push(name);
        req.onsuccess?.();
      }
    });
    return req;
  },
});

const fakeCaches = (keys = []) => {
  const remaining = new Set(keys);
  return {
    keys: vi.fn(async () => [...remaining]),
    delete: vi.fn(async (k) => remaining.delete(k)),
    remaining,
  };
};

const fakeIcloud = ({ available = true, ok = true, throws = false } = {}) => ({
  isAvailable: () => available,
  deleteFile: vi.fn(async (path) => {
    if (throws) throw new Error('bridge exploded');
    return ok && path === ICLOUD_SYNC_FILE;
  }),
});

const deps = (over = {}) => ({
  localStorage: fakeStorage(),
  sessionStorage: fakeStorage(),
  indexedDB: fakeIndexedDB(),
  caches: fakeCaches(),
  icloud: fakeIcloud(),
  ...over,
});

beforeEach(() => {
  __resetGuardForTests();
});

// ── clearWebStorage ────────────────────────────────────────────────────────

describe('clearWebStorage', () => {
  it('clears both storages', () => {
    const d = deps();
    const errors = [];
    clearWebStorage(d, errors);
    expect(d.localStorage.clear).toHaveBeenCalled();
    expect(d.sessionStorage.clear).toHaveBeenCalled();
    expect(errors).toEqual([]);
  });

  it('records a failure on one storage and still clears the other', () => {
    const d = deps({
      localStorage: { clear: () => { throw new Error('denied'); } },
    });
    const errors = [];
    clearWebStorage(d, errors);
    expect(errors).toEqual(['localStorage: denied']);
    expect(d.sessionStorage.clear).toHaveBeenCalled();
  });

  it('tolerates storages being absent', () => {
    const errors = [];
    expect(() => clearWebStorage({ localStorage: null, sessionStorage: null }, errors)).not.toThrow();
    expect(errors).toEqual([]);
  });
});

// ── deleteIndexedDbDatabases ───────────────────────────────────────────────

describe('deleteIndexedDbDatabases', () => {
  it('deletes every known database when databases() is unavailable', async () => {
    const idb = fakeIndexedDB();
    const deleted = await deleteIndexedDbDatabases({ indexedDB: idb }, []);
    expect(deleted.sort()).toEqual([...KNOWN_INDEXEDDB_NAMES].sort());
  });

  it('unions databases() results with the known list', async () => {
    const idb = fakeIndexedDB({ databases: [{ name: 'some-future-db' }, { name: 'dayglance-obsidian' }] });
    const deleted = await deleteIndexedDbDatabases({ indexedDB: idb }, []);
    expect(deleted).toContain('some-future-db');
    // No duplicate for the name present in both sources.
    expect(deleted.filter((n) => n === 'dayglance-obsidian')).toHaveLength(1);
  });

  it('records a per-database failure and keeps going', async () => {
    const idb = fakeIndexedDB({ failFor: ['dayglance-obsidian'] });
    const errors = [];
    const deleted = await deleteIndexedDbDatabases({ indexedDB: idb }, errors);
    expect(deleted).not.toContain('dayglance-obsidian');
    expect(deleted).toContain('dayglance-crypto');
    expect(errors).toEqual(['indexedDB "dayglance-obsidian": boom']);
  });

  it('times out on a blocked delete instead of hanging', async () => {
    vi.useFakeTimers();
    try {
      const idb = fakeIndexedDB({ blockFor: ['dayglance-crypto'] });
      const errors = [];
      const pending = deleteIndexedDbDatabases({ indexedDB: idb }, errors);
      await vi.runAllTimersAsync();
      const deleted = await pending;
      expect(deleted).not.toContain('dayglance-crypto');
      expect(errors[0]).toMatch(/dayglance-crypto.*blocked/);
      // The remaining databases were still deleted.
      expect(deleted).toContain('dayglance-obsidian');
    } finally {
      vi.useRealTimers();
    }
  });

  it('records a databases() failure but still deletes the known list', async () => {
    const idb = fakeIndexedDB();
    idb.databases = vi.fn(async () => { throw new Error('nope'); });
    const errors = [];
    const deleted = await deleteIndexedDbDatabases({ indexedDB: idb }, errors);
    expect(errors).toEqual(['indexedDB.databases(): nope']);
    expect(deleted.sort()).toEqual([...KNOWN_INDEXEDDB_NAMES].sort());
  });

  it('is a no-op without indexedDB', async () => {
    expect(await deleteIndexedDbDatabases({ indexedDB: null }, [])).toEqual([]);
  });
});

// ── clearCacheStorage ──────────────────────────────────────────────────────

describe('clearCacheStorage', () => {
  it('deletes every cache', async () => {
    const caches = fakeCaches(['assets-v1', 'assets-v2']);
    const deleted = await clearCacheStorage({ caches }, []);
    expect(deleted.sort()).toEqual(['assets-v1', 'assets-v2']);
    expect(caches.remaining.size).toBe(0);
  });

  it('is a no-op where Cache Storage is unavailable', async () => {
    expect(await clearCacheStorage({ caches: undefined }, [])).toEqual([]);
  });
});

// ── clearICloudSnapshot ────────────────────────────────────────────────────

describe('clearICloudSnapshot', () => {
  it('deletes the sync snapshot by name', async () => {
    const icloud = fakeIcloud();
    const result = await clearICloudSnapshot({ icloud }, []);
    expect(icloud.deleteFile).toHaveBeenCalledWith('dayglance-sync.json');
    expect(result).toEqual({ attempted: true, ok: true });
  });

  it('reports not-attempted (not an error) where iCloud is unavailable', async () => {
    const icloud = fakeIcloud({ available: false });
    const errors = [];
    expect(await clearICloudSnapshot({ icloud }, errors)).toEqual({ attempted: false, ok: false });
    expect(icloud.deleteFile).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
  });

  it('records an error when the bridge reports failure', async () => {
    const errors = [];
    const result = await clearICloudSnapshot({ icloud: fakeIcloud({ ok: false }) }, errors);
    expect(result).toEqual({ attempted: true, ok: false });
    expect(errors).toEqual(['iCloud snapshot could not be deleted']);
  });

  it('records an error when the bridge throws', async () => {
    const errors = [];
    const result = await clearICloudSnapshot({ icloud: fakeIcloud({ throws: true }) }, errors);
    expect(result).toEqual({ attempted: true, ok: false });
    expect(errors).toEqual(['iCloud snapshot: bridge exploded']);
  });
});

// ── resetAppData ───────────────────────────────────────────────────────────

describe('resetAppData', () => {
  it("device scope leaves the iCloud snapshot alone", async () => {
    const d = deps();
    const result = await resetAppData({ scope: 'device' }, d);
    expect(d.icloud.deleteFile).not.toHaveBeenCalled();
    expect(result.cloud).toEqual({ attempted: false, ok: false });
    expect(d.localStorage.clear).toHaveBeenCalled();
  });

  it('defaults to device scope', async () => {
    const d = deps();
    const result = await resetAppData(undefined, d);
    expect(result.scope).toBe('device');
    expect(d.icloud.deleteFile).not.toHaveBeenCalled();
  });

  it('everywhere scope deletes the iCloud snapshot as well as local data', async () => {
    const d = deps({ caches: fakeCaches(['assets-v1']) });
    const result = await resetAppData({ scope: 'everywhere' }, d);
    expect(d.icloud.deleteFile).toHaveBeenCalledWith(ICLOUD_SYNC_FILE);
    expect(result.cloud).toEqual({ attempted: true, ok: true });
    expect(result.caches).toEqual(['assets-v1']);
    expect(result.indexedDb.length).toBe(KNOWN_INDEXEDDB_NAMES.length);
    expect(d.localStorage.clear).toHaveBeenCalled();
    expect(d.sessionStorage.clear).toHaveBeenCalled();
    expect(result.errors).toEqual([]);
  });

  // The ordering guarantee: if local were cleared first, a sync cycle firing in
  // the gap would see an empty device plus a live snapshot and restore it all.
  it('deletes the cloud snapshot before clearing local storage', async () => {
    const order = [];
    const d = deps({
      icloud: {
        isAvailable: () => true,
        deleteFile: async () => { order.push('cloud'); return true; },
      },
      localStorage: { clear: () => order.push('local') },
    });
    await resetAppData({ scope: 'everywhere' }, d);
    expect(order).toEqual(['cloud', 'local']);
  });

  it('still clears local data when the cloud delete fails', async () => {
    const d = deps({ icloud: fakeIcloud({ ok: false }) });
    const result = await resetAppData({ scope: 'everywhere' }, d);
    expect(d.localStorage.clear).toHaveBeenCalled();
    expect(result.errors).toEqual(['iCloud snapshot could not be deleted']);
  });

  it('raises the reset guard so saves and syncs stop writing data back', async () => {
    expect(isResetInProgress()).toBe(false);
    const guardDuringWipe = [];
    const d = deps({ localStorage: { clear: () => guardDuringWipe.push(isResetInProgress()) } });
    await resetAppData({ scope: 'device' }, d);
    expect(guardDuringWipe).toEqual([true]);
    expect(isResetInProgress()).toBe(true);
  });

  it('raises the guard before any wipe step runs', async () => {
    const d = deps({
      icloud: {
        isAvailable: () => true,
        deleteFile: async () => { expect(isResetInProgress()).toBe(true); return true; },
      },
    });
    await resetAppData({ scope: 'everywhere' }, d);
  });
});
