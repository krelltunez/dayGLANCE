const DB_NAME = 'dayglance-intents-crypto';
const DB_VERSION = 1;
const STORE = 'keys';
const ROOT_KEY_RECORD = 'root-key';

// Module-level cache: avoids an IDB round-trip on every emit/poll cycle.
// Cleared synchronously by clearIntentsRootKey().
let _cachedRootKey = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function storeIntentsRootKey(cryptoKey) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(cryptoKey, ROOT_KEY_RECORD);
    tx.oncomplete = () => { _cachedRootKey = cryptoKey; resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadIntentsRootKey() {
  if (_cachedRootKey !== null) return _cachedRootKey;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(ROOT_KEY_RECORD);
    req.onsuccess = () => {
      _cachedRootKey = req.result ?? null;
      resolve(_cachedRootKey);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function clearIntentsRootKey() {
  _cachedRootKey = null;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(ROOT_KEY_RECORD);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
