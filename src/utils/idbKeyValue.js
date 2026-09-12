// A tiny async key/value store backed by IndexedDB, with a localStorage
// fallback.
//
// WHY THIS EXISTS
// localStorage is capped at roughly 5 MiB per origin and, being synchronous,
// never grows with the machine: the browser has to hold it in memory and block
// the main thread on every access, so the limit has not moved in fifteen years.
// IndexedDB is governed by the origin storage quota instead, which is a share of
// free disk and measured in gigabytes.
//
// dayGLANCE stores almost everything in localStorage, and the single largest
// consumer is derived data rather than anything irreplaceable. This is the
// shared door out for those values, one key at a time.
//
// THE FALLBACK IS NOT DECORATION
// Where IndexedDB is unavailable or refuses to open (private windows, locked-down
// webviews, blocked site data) callers must still work, so every operation falls
// back to the same key in localStorage. That gives up the space win on those
// platforms and keeps the behaviour identical, which is the right trade: a value
// that used to live in localStorage is no worse off there than it was before.
//
// Values are structured-cloned by IndexedDB, so plain JSON-shaped objects go in
// and come back out without a stringify round trip. The localStorage fallback
// does stringify, so keep values JSON-safe.

const STORE = 'kv';

// One connection per database name, opened lazily. `null` means "IndexedDB is
// not usable here", cached so a blocked environment is not re-probed on every
// read during a sync cycle.
const connections = new Map();

function openDatabase(dbName) {
  if (connections.has(dbName)) return connections.get(dbName);
  const promise = new Promise((resolve) => {
    let request;
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB) return resolve(null);
      request = indexedDB.open(dbName, 1);
    } catch {
      return resolve(null); // SecurityError in some sandboxed contexts.
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  }).catch(() => null);
  connections.set(dbName, promise);
  return promise;
}

function runTransaction(db, mode, work) {
  return new Promise((resolve, reject) => {
    let transaction;
    try {
      transaction = db.transaction(STORE, mode);
    } catch (err) {
      return reject(err);
    }
    const request = work(transaction.objectStore(STORE));
    // Resolve on the REQUEST, not the transaction: a read has its value at
    // request time, and a write is durable once the transaction completes.
    transaction.oncomplete = () => resolve(request?.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

const readFallback = (key) => {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? undefined : JSON.parse(raw);
  } catch { return undefined; }
};

/**
 * Create a store bound to one IndexedDB database name.
 *
 * Every method resolves rather than rejects. A caller in the middle of a sync
 * cycle should not have to distinguish "storage is broken" from "nothing stored
 * yet"; both mean "no value", and the caller's existing empty-value path is
 * already the safe one.
 */
export function createIdbKeyValue(dbName) {
  return {
    async get(key) {
      const db = await openDatabase(dbName);
      if (db) {
        try {
          const value = await runTransaction(db, 'readonly', (store) => store.get(key));
          if (value !== undefined) return value;
        } catch { /* fall through to the fallback below */ }
      }
      return readFallback(key);
    },

    async set(key, value) {
      const db = await openDatabase(dbName);
      if (db) {
        try {
          await runTransaction(db, 'readwrite', (store) => store.put(value, key));
          // Drop any copy left in localStorage by the fallback or by a previous
          // version of the app, so the value is not stored twice.
          try { localStorage.removeItem(key); } catch { /* ignore */ }
          return true;
        } catch { /* fall through */ }
      }
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch { return false; }
    },

    async del(key) {
      const db = await openDatabase(dbName);
      if (db) {
        try { await runTransaction(db, 'readwrite', (store) => store.delete(key)); } catch { /* ignore */ }
      }
      try { localStorage.removeItem(key); } catch { /* ignore */ }
      return true;
    },
  };
}

/** An in-memory store with the same shape, for tests and for injection. */
export function createMemoryKeyValue(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    async get(key) { return map.get(key); },
    async set(key, value) { map.set(key, value); return true; },
    async del(key) { map.delete(key); return true; },
  };
}
