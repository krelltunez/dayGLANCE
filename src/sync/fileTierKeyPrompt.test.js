import 'fake-indexeddb/auto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// #2453: A and B share a WebDAV folder in plaintext; A turns encryption on and
// seals the file. B, switch off, cannot read it: PASSPHRASE_REQUIRED, sync
// stops. Walked through dayGLANCE's own engine factory (adapter.js) and the
// package's REAL WebDAV provider, so the decrypt-by-body read and the
// encrypt-by-switch upload are the installed ones, against a scripted server
// at fetch.

const store = new Map();
const originalLocalStorage = globalThis.localStorage;
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => { store.clear(); },
  key: (i) => Array.from(store.keys())[i] ?? null,
  get length() { return store.size; },
};
const originalFetch = globalThis.fetch;
afterAll(() => { globalThis.localStorage = originalLocalStorage; globalThis.fetch = originalFetch; });

const { createDayGlanceEngine } = await import('./adapter.js');
const { syncPassphrasePromptWanted, fileTierConfigAfterUnlock } = await import('./fileTierKeyPrompt.js');
const crypto = await import('../utils/crypto.js');

const PASSPHRASE = 'correct horse battery staple';
const CONFIG_KEY = 'day-planner-cloud-sync-config';
const B_CONFIG = { enabled: true, provider: 'nextcloud', nextcloudUrl: 'https://dav.example', username: 'b', appPassword: 'x', syncFolder: 'GLANCE/dayglance', encryptionEnabled: false };
const A_TASK = { id: 'a1', title: 'from A', lastModified: '2026-11-26T10:00:00.000Z' };
const B_TASK = { id: 'b1', title: 'from B', lastModified: '2026-11-27T09:00:00.000Z' };

// The one file on the server, and every PUT body it was sent.
const server = { body: null, etag: null, n: 0, puts: [] };
function fakeWebdav(url, init = {}) {
  const method = init.method || 'GET';
  if (method === 'GET') {
    if (server.body == null) return Promise.resolve(new Response(null, { status: 404 }));
    return Promise.resolve(new Response(server.body, { status: 200, headers: { etag: server.etag } }));
  }
  if (method === 'PUT') {
    server.puts.push(init.body);
    server.body = init.body;
    server.etag = `"v${++server.n}"`;
    return Promise.resolve(new Response(null, { status: 201, headers: { etag: server.etag } }));
  }
  return Promise.resolve(new Response(null, { status: 201 }));
}

// Device A: encryption on, uploads a sealed file, then leaves this process's
// key state the way device B has it (none).
async function sealRemoteAsDeviceA() {
  await crypto.setupEncryptionKey(PASSPHRASE);
  const envelope = await crypto.encryptData({ version: 2, data: { tasks: [A_TASK], unscheduledTasks: [] }, lastModified: A_TASK.lastModified });
  server.body = JSON.stringify(envelope);
  server.etag = '"a1"';
  await crypto.clearEncryptionKey();
}

function deviceB() {
  const calls = { passphraseRequired: 0, errors: [] };
  const engine = createDayGlanceEngine({
    buildPayload: async () => ({ data: { tasks: [B_TASK], unscheduledTasks: [] }, lastModified: B_TASK.lastModified }),
    buildBackupPayload: async () => ({}),
    applyPayload: async () => {},
    onStatusChange: () => {},
    onError: (msg, code) => { if (msg) calls.errors.push(code); },
    onLastSyncedChange: () => {},
    onConflict: () => {},
    onPassphraseRequired: () => { calls.passphraseRequired += 1; },
    onFirstSyncReload: () => {},
    getSyncRetentionDays: () => 90,
  });
  localStorage.setItem(CONFIG_KEY, JSON.stringify(B_CONFIG));
  localStorage.setItem('day-planner-tasks', JSON.stringify([B_TASK]));
  localStorage.setItem('day-planner-cloud-sync-last-synced', '2026-11-25T00:00:00.000Z');
  return { engine, calls };
}

// What the prompt's unlock does in App: the passphrase into session memory and
// (or not, for the mutation check) the config through fileTierConfigAfterUnlock.
function unlock({ turnEncryptionOn = true } = {}) {
  crypto.setSyncPassphrase(PASSPHRASE);
  const config = JSON.parse(localStorage.getItem(CONFIG_KEY));
  localStorage.setItem(CONFIG_KEY, JSON.stringify(turnEncryptionOn ? fileTierConfigAfterUnlock(config) : config));
}

const promptFor = (over = {}) => syncPassphrasePromptWanted({
  cloudSyncConfig: B_CONFIG, vaultEnabled: false, dbIntentsEnabled: false,
  directAccessEncrypt: false, directAccessKeyWanted: false, fileTierKeyWanted: false,
  syncKeyReady: false, ...over,
});

beforeEach(async () => {
  store.clear();
  Object.assign(server, { body: null, etag: null, n: 0, puts: [] });
  globalThis.fetch = vi.fn(fakeWebdav);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  await crypto.clearEncryptionKey();
});
afterEach(() => { vi.restoreAllMocks(); });

describe('a device whose switch is off reads a file another device encrypted (#2453)', () => {
  it('stops at PASSPHRASE_REQUIRED and writes nothing', async () => {
    await sealRemoteAsDeviceA();
    const { engine, calls } = deviceB();
    await engine.download();
    expect(calls.passphraseRequired).toBe(1);
    expect(calls.errors).toContain('PASSPHRASE_REQUIRED');
    expect(server.puts).toEqual([]);
  });

  it('the prompt shows for it, where the local switches alone never showed one', () => {
    expect(promptFor()).toBe(false);
    expect(promptFor({ fileTierKeyWanted: true })).toBe(true);
  });

  it('after unlocking, the next upload is sealed with the file\'s key and carries both devices\' tasks', async () => {
    await sealRemoteAsDeviceA();
    const { engine, calls } = deviceB();
    await engine.download();
    unlock();
    expect(JSON.parse(localStorage.getItem(CONFIG_KEY)).encryptionEnabled).toBe(true);

    await engine.download();
    expect(calls.passphraseRequired).toBe(1);
    expect(server.puts.length).toBeGreaterThan(0);
    const written = JSON.parse(server.puts.at(-1));
    expect(crypto.isEncryptedEnvelope(written)).toBe(true);
    // A, holding only its passphrase, reads what B wrote.
    await crypto.clearEncryptionKey();
    crypto.setSyncPassphrase(PASSPHRASE);
    const read = await crypto.decryptData(written);
    expect(read.data.tasks.map((t) => t.id).sort()).toEqual(['a1', 'b1']);
  });

  it('the next launch restores the key instead of asking again', async () => {
    await sealRemoteAsDeviceA();
    const { engine } = deviceB();
    await engine.download();
    unlock();
    await engine.download();
    // A relaunch: nothing in memory, the switch now on, so the launch check
    // (useCloudSync needFileKey) looks for the key the read cached.
    crypto.setSyncPassphrase(null);
    expect(await crypto.initSessionKey()).toBe(true);
  });

  it('without turning encryption on, the same unlock writes PLAINTEXT over the envelope (why the flip exists)', async () => {
    await sealRemoteAsDeviceA();
    const { engine } = deviceB();
    await engine.download();
    unlock({ turnEncryptionOn: false });
    await engine.download();
    expect(server.puts.length).toBeGreaterThan(0);
    expect(crypto.isEncryptedEnvelope(JSON.parse(server.puts.at(-1)))).toBe(false);
  });
});

describe('syncPassphrasePromptWanted', () => {
  it('never shows while the key is ready or the launch check is pending', () => {
    for (const syncKeyReady of [true, null]) {
      expect(promptFor({ syncKeyReady, fileTierKeyWanted: true, directAccessKeyWanted: true })).toBe(false);
    }
  });

  it('keeps every reason it had before', () => {
    expect(promptFor({ cloudSyncConfig: { ...B_CONFIG, encryptionEnabled: true } })).toBe(true);
    expect(promptFor({ vaultEnabled: true })).toBe(true);
    expect(promptFor({ dbIntentsEnabled: true })).toBe(true);
    expect(promptFor({ directAccessEncrypt: true })).toBe(true);
    expect(promptFor({ directAccessKeyWanted: true })).toBe(true);
    expect(promptFor({ cloudSyncConfig: null })).toBe(false);
  });
});

describe('fileTierConfigAfterUnlock', () => {
  it('turns encryption on and keeps the rest', () => {
    expect(fileTierConfigAfterUnlock(B_CONFIG)).toEqual({ ...B_CONFIG, encryptionEnabled: true });
    expect(B_CONFIG.encryptionEnabled).toBe(false);
  });

  it('returns the same object when there is nothing to change, so a state updater does not re-render', () => {
    const on = { ...B_CONFIG, encryptionEnabled: true };
    expect(fileTierConfigAfterUnlock(on)).toBe(on);
    expect(fileTierConfigAfterUnlock(null)).toBe(null);
  });
});
