import { describe, it, expect, vi } from 'vitest';
import { deriveEnvelopeKey } from '@glance-apps/intents';
import {
  ensureVaultIntentsKey,
  setupVaultIntentsEncryption,
  VaultIntentsSetupError,
} from './vaultIntentsSetup.js';

// ─────────────────────────────────────────────────────────────────────────────
// Vault intents KEY SETUP (stage 2b-i). Exercises the REAL derivation
// (deriveIntentsRootKey via setupVaultIntentsEncryption) with the vault client,
// store slot, and passphrase source injected — no network, no IndexedDB.
//
// The store slot is modelled by an in-memory { storeKey, loadKey } pair (the
// repo has no fake-indexeddb; existing tests inject stores the same way), so
// "a key is now loadable from the vault slot" is asserted via that pair.
// ─────────────────────────────────────────────────────────────────────────────

const CONN = { vaultUrl: 'https://vault.example.com', vaultToken: 'tok-123', accountId: 'acct-1' };
const SALT = new Uint8Array(16).fill(5);

// An in-memory vault key slot mirroring storeVaultIntentsRootKey / loadVaultIntentsRootKey.
function memSlot(initial = null) {
  let key = initial;
  return {
    storeKey: vi.fn(async (k) => { key = k; }),
    loadKey: vi.fn(async () => key),
    peek: () => key,
  };
}

const okVaultClient = (salt = SALT) => ({ getSalt: vi.fn(async () => salt) });

describe('ensureVaultIntentsKey', () => {
  it('with a passphrase available, derives and caches a vault key loadable from the slot', async () => {
    const slot = memSlot();
    const vaultClient = okVaultClient();

    const res = await ensureVaultIntentsKey({
      loadKey: slot.loadKey,
      storeKey: slot.storeKey,
      getSyncPassphrase: () => 'correct horse battery staple',
      connection: CONN,
      vaultClient,
    });

    expect(res).toEqual({ ok: true });
    expect(vaultClient.getSalt).toHaveBeenCalledWith('acct-1');
    expect(slot.storeKey).toHaveBeenCalledTimes(1);

    // A key is now loadable from the vault slot...
    const cached = await slot.loadKey();
    expect(cached).not.toBeNull();
    // ...and it is a usable HKDF root key (deriveEnvelopeKey accepts it).
    const envKey = await deriveEnvelopeKey(cached, new Uint8Array(16).fill(1));
    expect(envKey).toBeDefined();
    expect(envKey.type).toBe('secret'); // a real AES-GCM CryptoKey
  });

  it('with NO passphrase, returns needsPassphrase and caches nothing (prompt path)', async () => {
    const slot = memSlot();
    const vaultClient = okVaultClient();

    const res = await ensureVaultIntentsKey({
      loadKey: slot.loadKey,
      storeKey: slot.storeKey,
      getSyncPassphrase: () => null,   // passphrase gone (e.g. after reload)
      connection: CONN,                // connection present, but that is NOT sufficient
      vaultClient,
    });

    expect(res).toEqual({ ok: false, needsPassphrase: true });
    expect(slot.storeKey).not.toHaveBeenCalled();      // nothing cached
    expect(vaultClient.getSalt).not.toHaveBeenCalled(); // no derivation attempted
    expect(slot.peek()).toBeNull();
  });

  it('cancel path: not deriving leaves vault intents key absent', async () => {
    // Models the UI cancel: the user declines the passphrase prompt, so
    // setupVaultIntentsEncryption is never called and the slot stays empty.
    const slot = memSlot();
    const res = await ensureVaultIntentsKey({
      loadKey: slot.loadKey,
      storeKey: slot.storeKey,
      getSyncPassphrase: () => null,
      connection: CONN,
      vaultClient: okVaultClient(),
    });
    expect(res.needsPassphrase).toBe(true);
    // The handler would now leave the toggle OFF; no key was ever cached.
    expect(await slot.loadKey()).toBeNull();
  });

  it('already set up: returns alreadySetUp without re-deriving or prompting', async () => {
    const slot = memSlot('already-cached-key');
    const getPass = vi.fn(() => { throw new Error('should not read passphrase'); });
    const vaultClient = okVaultClient();

    const res = await ensureVaultIntentsKey({
      loadKey: slot.loadKey,
      storeKey: slot.storeKey,
      getSyncPassphrase: getPass,
      connection: CONN,
      vaultClient,
    });

    expect(res).toEqual({ ok: true, alreadySetUp: true });
    expect(getPass).not.toHaveBeenCalled();
    expect(vaultClient.getSalt).not.toHaveBeenCalled();
    expect(slot.storeKey).not.toHaveBeenCalled();
  });

  it('surfaces NO_VAULT_SALT when the server has no salt (does not invent one)', async () => {
    const slot = memSlot();
    const vaultClient = { getSalt: vi.fn(async () => null) }; // 404 / no salt yet

    await expect(ensureVaultIntentsKey({
      loadKey: slot.loadKey,
      storeKey: slot.storeKey,
      getSyncPassphrase: () => 'pw',
      connection: CONN,
      vaultClient,
    })).rejects.toMatchObject({ code: 'NO_VAULT_SALT' });

    expect(slot.storeKey).not.toHaveBeenCalled(); // never cache a fabricated key
  });
});

describe('setupVaultIntentsEncryption', () => {
  it('throws NO_CONNECTION when no vault connection is configured', async () => {
    await expect(setupVaultIntentsEncryption('pw', { connection: null }))
      .rejects.toBeInstanceOf(VaultIntentsSetupError);
    await expect(setupVaultIntentsEncryption('pw', { connection: null }))
      .rejects.toMatchObject({ code: 'NO_CONNECTION' });
  });

  it('derives from the vault salt and caches into the provided slot', async () => {
    const slot = memSlot();
    const key = await setupVaultIntentsEncryption('pw', {
      connection: CONN,
      vaultClient: okVaultClient(),
      storeKey: slot.storeKey,
    });
    expect(key).toBeDefined();
    expect(slot.peek()).toBe(key);
  });
});
