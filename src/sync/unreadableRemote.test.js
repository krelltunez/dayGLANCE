import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webdavFetch } from '@glance-apps/sync';

// #2409: an upload was cut off and left half a JSON document on the server.
// Every cycle after it failed, was reported as a network error, and could not
// recover: the file is there, so nothing seeds; it cannot be read, so nothing
// merges. Walked through dayGLANCE's own engine factory (adapter.js), with a
// provider scripted at the engine's transport seam, as adapterSeedOverwrite
// does for the missing file.

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
afterAll(() => { globalThis.localStorage = originalLocalStorage; });

const { createDayGlanceEngine } = await import('./adapter.js');
const {
  REMOTE_UNREADABLE_CODE, isUnreadableRemoteError, isUnusablePayload,
  createUnreadableRemoteTracker, installUnreadableRemoteGuard,
} = await import('./unreadableRemote.js');
const { createVerifiedWriteGuard, CYCLE_READ_TTL_MS } = await import('./verifiedWriteGuard.js');
const { createAbsentRemoteSeedGuard } = await import('./absentRemoteSeedGuard.js');
const { VERIFIED_REMOTE_KEY } = await import('./verifiedRemote.js');

const LAST_SYNCED_KEY = 'day-planner-cloud-sync-last-synced';
const T0 = new Date('2026-11-15T19:47:00.000Z');
const SYNCED_BEFORE = '2026-11-14T00:00:00.000Z';
const LOCAL_TASKS = [{ id: 't1', title: 'mine', lastModified: '2026-11-14T00:00:00.000Z' }];
const REMOTE = { payload: { data: { tasks: [{ id: 'r1', title: 'theirs', lastModified: '2026-11-15T00:00:00.000Z' }], unscheduledTasks: [] }, lastModified: '2026-11-15T00:00:00.000Z' }, etag: '"good"' };

// What the package's Electron and Android transports throw for a 200 whose body
// is not JSON, and what the web transport's Response throws.
const nonJson = () => new Error('Server returned non-JSON response (status 200)');
const unreadable = () => { throw nonJson(); };

function build({ download, localTasks = LOCAL_TASKS, payloadTasks = LOCAL_TASKS }) {
  const calls = { status: [], lastSynced: [], errors: [], messages: [] };
  const script = { download };
  const downloadSpy = vi.fn(async () => (typeof script.download === 'function' ? script.download() : script.download));
  const uploadSpy = vi.fn(async () => true);
  const provider = { name: 'fake', configFields: [], download: downloadSpy, upload: uploadSpy, test: vi.fn() };
  const engine = createDayGlanceEngine({
    buildPayload: async () => ({ data: { tasks: payloadTasks, unscheduledTasks: [] }, lastModified: '2026-11-14T00:00:00.000Z' }),
    buildBackupPayload: async () => ({}),
    applyPayload: async () => {},
    onStatusChange: (s) => calls.status.push(s),
    onError: (msg, code) => { if (msg) { calls.errors.push(code); calls.messages.push(msg); } },
    onLastSyncedChange: (iso) => calls.lastSynced.push(iso),
    onConflict: () => {},
    onPassphraseRequired: () => {},
    onFirstSyncReload: () => {},
    getSyncRetentionDays: () => 90,
  }, { providers: { fake: provider } });
  expect(provider.download.absentRemoteSeedGuarded).toBe(true);
  localStorage.setItem('day-planner-cloud-sync-config', JSON.stringify({ enabled: true, provider: 'fake' }));
  localStorage.setItem('day-planner-tasks', JSON.stringify(localTasks));
  localStorage.setItem(LAST_SYNCED_KEY, SYNCED_BEFORE);
  return { engine, script, downloadSpy, uploadSpy, calls };
}

const settle = async (promise) => { await vi.advanceTimersByTimeAsync(3000); return promise; };
const runCycle = (engine) => settle(engine.download());
const replace = (engine) => settle(engine.replaceUnreadableRemote());
// The ETag argument each PUT carried: null is a write the server cannot refuse.
const etags = (uploadSpy) => uploadSpy.mock.calls.map((call) => call[2] ?? null);

beforeEach(() => {
  store.clear();
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('what the installed package throws for a body that is not JSON', () => {
  it('Electron: the main-process transport parses the body itself', async () => {
    const wf = webdavFetch({ electronProxyFetch: async () => ({ status: 200, ok: true, statusText: 'OK', body: '{"version":2,"data":{"tasks":[{"id":"t' }) });
    const res = await wf('GET', 'https://dav.example/dayglance-sync.json', {});
    const err = await res.json().catch((e) => e);
    expect(isUnreadableRemoteError(err)).toBe(true);
  });

  it('Android: the native bridge does the same', async () => {
    const wf = webdavFetch({ nativeHttpRequest: async () => ({ status: 200, ok: true, body: '<html>Not found</html>' }) });
    const err = await (await wf('GET', 'https://dav.example/dayglance-sync.json', {})).json().catch((e) => e);
    expect(isUnreadableRemoteError(err)).toBe(true);
  });

  it('web and iOS: a real Response', async () => {
    const err = await new Response('{"version":2,"data":{"tas', { status: 200 }).json().catch((e) => e);
    expect(isUnreadableRemoteError(err)).toBe(true);
  });

  it('an empty 200, as a server sends for a path that is not there', async () => {
    const wf = webdavFetch({ electronProxyFetch: async () => ({ status: 200, ok: true, statusText: 'OK', body: '' }) });
    const err = await (await wf('GET', 'https://dav.example/missing.json', {})).json().catch((e) => e);
    expect(isUnreadableRemoteError(err)).toBe(true);
  });

  it('is not what a failed request, a refusal or a wrong passphrase looks like', () => {
    for (const message of ['Download failed: 500 Internal Server Error', 'FORBIDDEN', 'PASSPHRASE_REQUIRED', 'Failed to fetch', 'Sync request timed out (server did not respond within 30 s)']) {
      expect(isUnreadableRemoteError(new Error(message)), message).toBe(false);
    }
    expect(isUnreadableRemoteError(Object.assign(new Error('x'), { name: 'OperationError' }))).toBe(false);
    expect(isUnreadableRemoteError(null)).toBe(false);
  });
});

describe('JSON that is not a sync file', () => {
  it.each([[{ payload: null }], [{ payload: {} }], [{ payload: [] }], [{ payload: { error: 'not found' } }], [{ payload: 'ok' }]])('%j is unusable', (result) => {
    expect(isUnusablePayload(result)).toBe(true);
  });

  it('a sync file, an absent file and a 304 are not judged', () => {
    expect(isUnusablePayload(REMOTE)).toBe(false);
    expect(isUnusablePayload(null)).toBe(false);
    expect(isUnusablePayload({ notModified: true, etag: '"good"' })).toBe(false);
  });
});

describe('a cycle that meets an unreadable remote file', () => {
  it('writes nothing and does not claim to have synced', async () => {
    const { engine, uploadSpy, calls } = build({ download: unreadable });
    await runCycle(engine);
    expect(uploadSpy).not.toHaveBeenCalled();
    expect(calls.lastSynced).toEqual([]);
    expect(localStorage.getItem(LAST_SYNCED_KEY)).toBe(SYNCED_BEFORE);
  });

  it('says what it is, not "network error"', async () => {
    const { engine, calls } = build({ download: unreadable });
    await runCycle(engine);
    expect(calls.errors).toEqual([REMOTE_UNREADABLE_CODE]);
    expect(calls.errors).not.toContain('NETWORK_ERROR');
    expect(calls.messages[0]).toMatch(/Nothing was written over it/);
    expect(calls.status).toContain('error');
  });

  it('keeps saying so on every cycle while the file stays that way', async () => {
    const { engine, calls } = build({ download: unreadable });
    await runCycle(engine);
    await runCycle(engine);
    expect(calls.errors).toEqual([REMOTE_UNREADABLE_CODE, REMOTE_UNREADABLE_CODE]);
  });

  it('treats JSON that is not a sync file the same way, and not as a verified read', async () => {
    const { engine, uploadSpy, calls } = build({ download: { payload: { error: 'no such file' }, etag: '"junk"' } });
    await runCycle(engine);
    expect(calls.errors).toEqual([REMOTE_UNREADABLE_CODE]);
    expect(uploadSpy).not.toHaveBeenCalled();
    // The junk's ETag must not become something a later write is conditional on.
    expect(localStorage.getItem(VERIFIED_REMOTE_KEY) || '').not.toContain('junk');
  });

  it('leaves a real network failure as it was', async () => {
    const { engine, calls } = build({ download: () => { throw new Error('Failed to fetch'); } });
    await runCycle(engine);
    expect(calls.errors).toEqual(['NETWORK_ERROR']);
  });

  it('recovers by itself once the file reads again, with a normal merge', async () => {
    const { engine, script, uploadSpy, calls } = build({ download: unreadable });
    await runCycle(engine);
    script.download = REMOTE;
    await runCycle(engine);
    expect(calls.errors).toEqual([REMOTE_UNREADABLE_CODE]);
    expect(calls.lastSynced.length).toBeGreaterThan(0);
    // The cycle's own write is held to the ETag it read: never unconditional.
    expect(etags(uploadSpy).every((etag) => etag === '"good"')).toBe(true);
  });

  it('does not let an unreadable read authorize a later bare upload', async () => {
    const { engine, uploadSpy } = build({ download: unreadable });
    await runCycle(engine);
    await settle(engine.upload());
    expect(etags(uploadSpy)).not.toContain(null);
  });
});

describe('"Replace the server copy"', () => {
  it('puts this device\'s data over a file it has just found unreadable', async () => {
    const { engine, uploadSpy, downloadSpy, calls } = build({ download: unreadable });
    await runCycle(engine);
    const result = await replace(engine);
    expect(result).toEqual({ outcome: 'replaced' });
    expect(downloadSpy).toHaveBeenCalledTimes(2);
    expect(uploadSpy).toHaveBeenCalledTimes(1);
    expect(etags(uploadSpy)).toEqual([null]);
    expect(uploadSpy.mock.calls[0][1].data.tasks).toEqual(LOCAL_TASKS);
    expect(calls.lastSynced.length).toBe(1);
    // The read it made for itself is evidence, not a second error.
    expect(calls.errors).toEqual([REMOTE_UNREADABLE_CODE]);
  });

  it('needs no earlier failed cycle: it reads for itself', async () => {
    const { engine, uploadSpy } = build({ download: unreadable });
    expect(await replace(engine)).toEqual({ outcome: 'replaced' });
    expect(etags(uploadSpy)).toEqual([null]);
  });

  it('never replaces a file that reads normally: that is an ordinary cycle', async () => {
    const { engine, script, uploadSpy, calls } = build({ download: unreadable });
    await runCycle(engine);
    script.download = REMOTE;
    expect(await replace(engine)).toEqual({ outcome: 'not-needed' });
    expect(etags(uploadSpy)).not.toContain(null);
    expect(calls.lastSynced.length).toBeGreaterThan(0);
  });

  it('never seeds over a file that is merely missing: the timed rule decides that', async () => {
    const { engine, script, uploadSpy, calls } = build({ download: unreadable });
    await runCycle(engine);
    script.download = null;
    expect(await replace(engine)).toEqual({ outcome: 'not-needed' });
    expect(uploadSpy).not.toHaveBeenCalled();
    expect(calls.errors).toContain('ABSENT_REMOTE_HOLD');
  });

  it('does nothing when the server cannot be reached', async () => {
    const { engine, script, uploadSpy, calls } = build({ download: unreadable });
    await runCycle(engine);
    script.download = () => { throw new Error('Failed to fetch'); };
    expect(await replace(engine)).toEqual({ outcome: 'failed' });
    expect(uploadSpy).not.toHaveBeenCalled();
    expect(calls.errors.at(-1)).toBe('SYNC_FAILED');
  });

  it('still refuses to upload nothing over a device that holds tasks', async () => {
    const { engine, uploadSpy } = build({ download: unreadable, payloadTasks: [] });
    expect(await replace(engine)).toEqual({ outcome: 'failed' });
    expect(uploadSpy).not.toHaveBeenCalled();
  });

  it('is one-shot: the write after it is held to what was read', async () => {
    const { engine, script, uploadSpy } = build({ download: unreadable });
    await replace(engine);
    script.download = unreadable;
    await settle(engine.upload());
    expect(etags(uploadSpy).filter((etag) => etag === null)).toHaveLength(1);
  });

  it('reports a failed upload as what it is, not as the unreadable file again', async () => {
    const { engine, uploadSpy, calls } = build({ download: unreadable });
    uploadSpy.mockRejectedValueOnce(new Error('Upload failed: 500 Internal Server Error'));
    expect(await replace(engine)).toEqual({ outcome: 'failed' });
    expect(calls.errors).toEqual(['NETWORK_ERROR']);
  });

  it('leaves nothing armed when its upload never reached a decision', async () => {
    // A refusal the engine treats as a hard stop: upload() then returns at once.
    const { engine, script, uploadSpy } = build({ download: () => { throw new Error('FORBIDDEN'); } });
    await runCycle(engine);
    expect(engine.isHardStopped()).toBe(true);
    script.download = unreadable;
    expect(await replace(engine)).toEqual({ outcome: 'failed' });
    expect(uploadSpy).not.toHaveBeenCalled();

    // Moments later the stop is cleared, a cycle finds the file unreadable
    // again, and something uploads bare. The spent request must not cover it.
    engine.clearHardStop();
    await runCycle(engine);
    await settle(engine.upload());
    expect(etags(uploadSpy)).not.toContain(null);
  });

  it('is off when sync is', async () => {
    const { engine, uploadSpy, downloadSpy } = build({ download: unreadable });
    localStorage.setItem('day-planner-cloud-sync-config', JSON.stringify({ enabled: false, provider: 'fake' }));
    expect(await replace(engine)).toEqual({ outcome: 'disabled' });
    expect(downloadSpy).not.toHaveBeenCalled();
    expect(uploadSpy).not.toHaveBeenCalled();
  });
});

describe('the write guard\'s replace mode', () => {
  let clock;
  const guard = () => createVerifiedWriteGuard({
    seedGuard: createAbsentRemoteSeedGuard({ hasSyncedBefore: () => true, now: () => clock }),
    targetKey: () => 'target', storage: globalThis.localStorage, now: () => clock,
  });
  beforeEach(() => { clock = T0.getTime(); });

  it('needs an unreadable read and the request, both fresh', () => {
    const g = guard();
    expect(g.authorizeReplace()).toBe(false);
    expect(g.decideWrite().mode).toBe('unverified');

    g.observeUnreadable();
    expect(g.decideWrite().mode).toBe('unverified');

    g.observeUnreadable();
    expect(g.authorizeReplace()).toBe(true);
    expect(g.decideWrite()).toEqual({ allowed: true, mode: 'replace' });
    expect(g.consumeWritePlan()).toEqual({ mode: 'replace', etag: null });
  });

  it('is spent by the decision it was made for', () => {
    const g = guard();
    g.observeUnreadable();
    g.authorizeReplace();
    expect(g.decideWrite().mode).toBe('replace');
    expect(g.decideWrite().mode).toBe('unverified');
    // Another unreadable read, moments later, is not covered by the old request.
    g.observeUnreadable();
    expect(g.decideWrite().mode).toBe('unverified');
  });

  it('expires: an old unreadable read cannot be acted on', () => {
    const g = guard();
    g.observeUnreadable();
    clock += CYCLE_READ_TTL_MS + 1;
    expect(g.authorizeReplace()).toBe(false);

    g.observeUnreadable();
    expect(g.authorizeReplace()).toBe(true);
    clock += CYCLE_READ_TTL_MS + 1;
    expect(g.decideWrite().mode).toBe('unverified');
  });

  it('a read that resolves withdraws it', () => {
    const g = guard();
    g.observeUnreadable();
    g.authorizeReplace();
    g.observeRead({ etag: '"good"' });
    expect(g.decideWrite()).toMatchObject({ allowed: true, mode: 'cycle', etag: '"good"' });
  });

  it('can be cancelled', () => {
    const g = guard();
    g.observeUnreadable();
    g.authorizeReplace();
    g.cancelReplace();
    expect(g.decideWrite().mode).toBe('unverified');
  });
});

describe('the tracker and the wrapper', () => {
  it('reports each unreadable read once, and counts the streak from its first', () => {
    let clock = 1000;
    const tracker = createUnreadableRemoteTracker({ now: () => clock });
    expect(tracker.takeReport()).toBe(false);
    tracker.observeUnreadable();
    clock = 5000;
    tracker.observeUnreadable();
    expect(tracker.state().since).toBe(1000);
    expect(tracker.takeReport()).toBe(true);
    expect(tracker.takeReport()).toBe(false);
    tracker.observeRead();
    expect(tracker.state()).toEqual({ since: 0, pending: false });
  });

  it('wraps once, keeps the receiver and the arguments, and passes other errors through', async () => {
    const provider = {
      url: 'u',
      download: vi.fn(async function (cfg, opts) { return { payload: { data: {} }, etag: `${this.url}:${cfg.id}:${opts?.ifNoneMatch}` }; }),
    };
    const providers = { fake: provider, broken: null, bare: {} };
    installUnreadableRemoteGuard(providers);
    const once = provider.download;
    installUnreadableRemoteGuard(providers);
    expect(provider.download).toBe(once);
    expect((await provider.download({ id: 7 }, { ifNoneMatch: 'e' })).etag).toBe('u:7:e');

    const failing = { download: async () => { throw new Error('Download failed: 500'); } };
    installUnreadableRemoteGuard({ failing });
    await expect(failing.download({})).rejects.toThrow('Download failed: 500');
  });
});
