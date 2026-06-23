const DB_NAME = 'dayglance-intents-crypto';
const DB_VERSION = 1;
const STORE = 'keys';

// Two DISTINCT key slots share this store but NEVER collide:
//   - ROOT_KEY_RECORD       — the WebDAV intents root key (derived from the
//                             WebDAV-stored salt). Untouched by the vault path.
//   - VAULT_ROOT_KEY_RECORD — the GLANCEvault intents root key (derived from the
//                             vault server's /salt/:accountId salt). A different
//                             key from a different salt; it MUST live under its
//                             own record so the two can't clobber each other.
const ROOT_KEY_RECORD = 'root-key';
const VAULT_ROOT_KEY_RECORD = 'vault-root-key';

// Module-level caches: avoid an IDB round-trip on every emit/poll cycle. Each
// slot has its own cache, cleared synchronously by its clear* function.
let _cachedRootKey = null;
let _cachedVaultRootKey = null;

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

// ─── WebDAV intents key slot (unchanged) ─────────────────────────────────────

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

// ─── GLANCEvault intents key slot (distinct record, distinct cache) ──────────
//
// Mirrors the WebDAV slot's lifecycle exactly but against VAULT_ROOT_KEY_RECORD.
// Like the WebDAV key, the derived CryptoKey is cached in IndexedDB so it
// survives a reload WITHOUT re-deriving from the passphrase — the deliverer just
// loads it. (The one-time derivation that populates this slot is stage 2b.)

export async function storeVaultIntentsRootKey(cryptoKey) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(cryptoKey, VAULT_ROOT_KEY_RECORD);
    tx.oncomplete = () => { _cachedVaultRootKey = cryptoKey; resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadVaultIntentsRootKey() {
  if (_cachedVaultRootKey !== null) return _cachedVaultRootKey;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(VAULT_ROOT_KEY_RECORD);
    req.onsuccess = () => {
      _cachedVaultRootKey = req.result ?? null;
      resolve(_cachedVaultRootKey);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function clearVaultIntentsRootKey() {
  _cachedVaultRootKey = null;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(VAULT_ROOT_KEY_RECORD);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
