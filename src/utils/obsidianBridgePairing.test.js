import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupDbRootKey, clearDbRootKey } from '@glance-apps/sync';
import { getDbRootKey } from '@glance-apps/sync/src/dbCrypto.js';
import {
  openPairingOffer,
  deriveBridgeSubkey,
  exportBridgeSubkey,
} from '@glance-apps/obsidian-format';
import { startBridgePairing, cancelBridgePairing } from './obsidianBridgePairing.js';

// The app-side pairing flow: preconditions produce TYPED errors (the
// Settings UI shows the actual fix), a successful start drops a sealed
// offer at .dayglance/pairing that opens with the returned code, and the
// carried subkey is exactly what re-deriving from the root key + the
// carried salt produces (the §3.4 property the plugin's re-pair check
// leans on). Cancel overwrites with the '{}' form, which opens to null.

const VAULT_CONFIG_KEY = 'dayglance-vault-config';

// Minimal writable FSA mock: records what writeVaultDotFile writes.
const writableVault = () => {
  const files = {};
  return {
    files,
    kind: 'directory',
    async getDirectoryHandle(dirName, opts) {
      if (!opts?.create && !files[dirName]) { const e = new Error('nf'); e.name = 'NotFoundError'; throw e; }
      files[dirName] ??= {};
      return {
        async getFileHandle(fileName) {
          return {
            async createWritable() {
              return {
                async write(content) { files[dirName][fileName] = content; },
                async close() {},
              };
            },
          };
        },
      };
    },
  };
};

// Root-key lifecycle without IndexedDB: the native-store path takes plain
// callbacks, so an in-memory stub works in the node test environment.
const nativeStub = { get: () => null, store: () => {} };
const installRootKey = () => setupDbRootKey('test-passphrase', new Uint8Array(16).fill(9), {
  nativeGetSyncKey: nativeStub.get, nativeStoreSyncKey: nativeStub.store,
});
const removeRootKey = () => clearDbRootKey({
  nativeGetSyncKey: nativeStub.get, nativeStoreSyncKey: nativeStub.store,
});

const CONFIG = { enabled: true, vaultUrl: 'https://vault.example', vaultToken: 'app-tok', accountId: 'acct-1' };

beforeEach(() => {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  localStorage.setItem(VAULT_CONFIG_KEY, JSON.stringify(CONFIG));
});
afterEach(async () => { await removeRootKey(); delete globalThis.localStorage; vi.restoreAllMocks(); });

const codeOf = async (fn) => {
  try { await fn(); } catch (e) { return e.code; }
  return null;
};

describe('preconditions → typed errors', () => {
  it('no direct vault access (falsy handle, or the native sentinel)', async () => {
    await installRootKey();
    expect(await codeOf(() => startBridgePairing(null, 'tok'))).toBe('pairing_no_vault_access');
    expect(await codeOf(() => startBridgePairing('native', 'tok'))).toBe('pairing_no_vault_access');
  });

  it('GLANCEvault not configured / not enabled', async () => {
    await installRootKey();
    localStorage.removeItem(VAULT_CONFIG_KEY);
    expect(await codeOf(() => startBridgePairing(writableVault(), 'tok'))).toBe('pairing_no_glancevault');
    localStorage.setItem(VAULT_CONFIG_KEY, JSON.stringify({ ...CONFIG, enabled: false }));
    expect(await codeOf(() => startBridgePairing(writableVault(), 'tok'))).toBe('pairing_no_glancevault');
  });

  it('root sync key not initialized on this device', async () => {
    await removeRootKey();
    expect(await codeOf(() => startBridgePairing(writableVault(), 'tok'))).toBe('pairing_no_root_key');
  });

  it('missing or blank device token', async () => {
    await installRootKey();
    expect(await codeOf(() => startBridgePairing(writableVault(), ''))).toBe('pairing_no_token');
    expect(await codeOf(() => startBridgePairing(writableVault(), '   '))).toBe('pairing_no_token');
  });
});

describe('the drop', () => {
  it('writes a sealed offer that opens with the returned code; subkey re-derives from root + carried salt', async () => {
    await installRootKey();
    const vault = writableVault();
    const { code } = await startBridgePairing(vault, '  bridge-tok  ');

    const text = vault.files['.dayglance']?.pairing;
    expect(text).toBeTruthy();
    expect(text).not.toContain('bridge-tok'); // sealed, not plaintext

    const creds = await openPairingOffer(text, code);
    expect(creds).toMatchObject({
      v: 1, vaultUrl: CONFIG.vaultUrl, accountId: CONFIG.accountId, deviceToken: 'bridge-tok',
    });
    expect(creds.generation).toBe(creds.pairingSalt); // the salt IS the generation

    const salt = Uint8Array.from(atob(creds.pairingSalt), (c) => c.charCodeAt(0));
    const rederived = await exportBridgeSubkey(await deriveBridgeSubkey(getDbRootKey(), salt));
    expect(creds.subkeyB64).toBe(rederived);
  });

  it('two pairings mint distinct codes, salts, and subkeys (the rotation property, end to end)', async () => {
    await installRootKey();
    const v1 = writableVault(); const v2 = writableVault();
    const a = await startBridgePairing(v1, 'tok');
    const b = await startBridgePairing(v2, 'tok');
    expect(a.code).not.toBe(b.code);
    const ca = await openPairingOffer(v1.files['.dayglance'].pairing, a.code);
    const cb = await openPairingOffer(v2.files['.dayglance'].pairing, b.code);
    expect(ca.pairingSalt).not.toBe(cb.pairingSalt);
    expect(ca.subkeyB64).not.toBe(cb.subkeyB64);
  });

  it('cancel overwrites with the cancel form, which opens to null', async () => {
    await installRootKey();
    const vault = writableVault();
    const { code } = await startBridgePairing(vault, 'tok');
    await cancelBridgePairing(vault);
    expect(vault.files['.dayglance'].pairing).toBe('{}');
    expect(await openPairingOffer('{}', code)).toBe(null);
    await cancelBridgePairing(null); // no vault access → silent no-op
  });
});
