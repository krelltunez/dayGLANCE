import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The file tier's idle gate (@glance-apps/sync 2.3.0, #2142): after a cycle
// that changed nothing on either side, the next poll asks the server
// "anything newer than this ETag?" and a 304 ends it there, with no download
// and no merge.
//
// The engine passes that as the SECOND argument of `provider.download`, and
// dayGLANCE wraps `download` to observe every read. The wrapper took only
// `cfg`, so the question never reached the server and every quiet poll, about
// once a minute per device, fetched the whole sync file. Walked through the
// app's own engine factory (adapter.js) so the wrappers under test are the
// ones the app installs, as adapterSeedOverwrite.test.js does.

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
const { VERIFIED_REMOTE_KEY } = await import('./verifiedRemote.js');

const LAST_SYNCED_KEY = 'day-planner-cloud-sync-last-synced';
const T0 = new Date('2026-11-15T12:00:00.000Z');
const TASKS = [{ id: 't1', title: 'same on both sides', lastModified: '2026-11-14T00:00:00.000Z' }];
const ETAG = '"e1"';
const remoteOf = (tasks, etag = ETAG) => ({
  payload: { version: 2, lastModified: '2026-11-14T00:00:00.000Z', data: { tasks, unscheduledTasks: [] } },
  etag,
});

function build() {
  const calls = { status: [], lastSynced: [], errors: [], applied: [] };
  const local = { tasks: TASKS };
  // The scripted server: answers 304 to a conditional read of the ETag it holds.
  const server = { tasks: TASKS, etag: ETAG, honoursConditional: true };
  const downloadSpy = vi.fn(async (cfg, opts) => {
    if (server.honoursConditional && opts?.ifNoneMatch && opts.ifNoneMatch === server.etag) {
      return { notModified: true, etag: opts.ifNoneMatch };
    }
    return remoteOf(server.tasks, server.etag);
  });
  const uploadSpy = vi.fn(async () => true);
  const provider = { name: 'fake', configFields: [], download: downloadSpy, upload: uploadSpy, test: vi.fn() };
  const engine = createDayGlanceEngine({
    buildPayload: async () => ({ data: { tasks: local.tasks, unscheduledTasks: [] }, lastModified: '2026-11-14T00:00:00.000Z' }),
    buildBackupPayload: async () => ({}),
    applyPayload: async (data) => { calls.applied.push(data); },
    onStatusChange: (s) => calls.status.push(s),
    onError: (msg, code) => { if (msg) calls.errors.push(code); },
    onLastSyncedChange: (iso) => calls.lastSynced.push(iso),
    onConflict: () => {},
    onPassphraseRequired: () => {},
    onFirstSyncReload: () => {},
    getSyncRetentionDays: () => 90,
  }, { providers: { fake: provider } });
  expect(provider.download.absentRemoteSeedGuarded).toBe(true);
  localStorage.setItem('day-planner-cloud-sync-config', JSON.stringify({ enabled: true, provider: 'fake' }));
  localStorage.setItem('day-planner-tasks', JSON.stringify(TASKS));
  localStorage.setItem(LAST_SYNCED_KEY, '2026-11-14T00:00:00.000Z');
  return { engine, local, server, downloadSpy, uploadSpy, calls };
}

const settle = async (promise) => { await vi.advanceTimersByTimeAsync(3000); return promise; };
const runCycle = (engine) => settle(engine.download());
// What each read asked the server: the ETag it was conditional on, or null.
const asked = (downloadSpy) => downloadSpy.mock.calls.map((call) => call[1]?.ifNoneMatch ?? null);
const etags = (uploadSpy) => uploadSpy.mock.calls.map((call) => call[2] ?? null);

beforeEach(() => {
  store.clear();
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('the conditional read reaches the provider', () => {
  it('a first cycle reads in full, and a quiet one after it asks by ETag', async () => {
    const { engine, downloadSpy } = build();
    await runCycle(engine);
    expect(asked(downloadSpy)).toEqual([null]);
    await runCycle(engine);
    expect(asked(downloadSpy)).toEqual([null, ETAG]);
  });

  it('a 304 ends the cycle there: nothing merged, applied or uploaded, and the device still counts as synced', async () => {
    const { engine, uploadSpy, calls } = build();
    await runCycle(engine);
    const syncedAfterFirst = calls.lastSynced.length;
    await runCycle(engine);
    expect(uploadSpy).not.toHaveBeenCalled();
    expect(calls.applied).toEqual([]);
    expect(calls.errors).toEqual([]);
    expect(calls.lastSynced.length).toBe(syncedAfterFirst + 1);
    expect(calls.status.at(-1)).not.toBe('error');
  });

  it('keeps asking by ETag on every quiet poll', async () => {
    const { engine, downloadSpy } = build();
    for (let i = 0; i < 4; i++) await runCycle(engine);
    expect(asked(downloadSpy)).toEqual([null, ETAG, ETAG, ETAG]);
  });

  // A 304 gives the write guard nothing a full quiet read did not already give
  // it: the same read record, bounded by the same few seconds.
  it('leaves the write guard exactly where a full quiet read leaves it', async () => {
    const afterQuietPoll = async (honoursConditional) => {
      store.clear();
      const { engine, server, uploadSpy } = build();
      server.honoursConditional = honoursConditional;
      await runCycle(engine);
      await runCycle(engine);
      await settle(engine.upload());
      return etags(uploadSpy);
    };
    expect(await afterQuietPoll(true)).toEqual(await afterQuietPoll(false));
  });
});

describe('what ends the shortcut', () => {
  it('a local edit: the next cycle reads in full and writes against the ETag it read', async () => {
    const { engine, local, downloadSpy, uploadSpy } = build();
    await runCycle(engine);
    await runCycle(engine);
    local.tasks = [...TASKS, { id: 't2', title: 'new here', lastModified: '2026-11-15T11:59:00.000Z' }];
    await runCycle(engine);
    expect(asked(downloadSpy)).toEqual([null, ETAG, null]);
    expect(uploadSpy).toHaveBeenCalledTimes(1);
    expect(etags(uploadSpy)).toEqual([ETAG]);
    expect(uploadSpy.mock.calls[0][1].data.tasks.map((t) => t.id).sort()).toEqual(['t1', 't2']);
  });

  it('a change on the server: the conditional read comes back with the file, and it is merged', async () => {
    const { engine, server, downloadSpy, calls } = build();
    await runCycle(engine);
    server.tasks = [...TASKS, { id: 'r2', title: 'new there', lastModified: '2026-11-15T11:59:00.000Z' }];
    server.etag = '"e2"';
    await runCycle(engine);
    expect(asked(downloadSpy)).toEqual([null, ETAG]);
    expect(calls.applied).toHaveLength(1);
    expect(calls.applied[0].tasks.map((t) => t.id).sort()).toEqual(['r2', 't1']);
  });

  it('ten minutes: a full read runs regardless', async () => {
    const { engine, downloadSpy } = build();
    await runCycle(engine);
    await runCycle(engine);
    vi.setSystemTime(Date.now() + 10 * 60 * 1000 + 1000);
    await runCycle(engine);
    expect(asked(downloadSpy)).toEqual([null, ETAG, null]);
  });

  it('a server that ignores the condition still works: the full answer with the same ETag ends the cycle', async () => {
    const { engine, server, downloadSpy, uploadSpy, calls } = build();
    server.honoursConditional = false;
    await runCycle(engine);
    await runCycle(engine);
    expect(asked(downloadSpy)).toEqual([null, ETAG]);
    expect(uploadSpy).not.toHaveBeenCalled();
    expect(calls.applied).toEqual([]);
    expect(calls.errors).toEqual([]);
  });
});

// The same walk with the package's own WebDAV provider and a scripted server
// behind fetch, so the header that leaves and the 304 that comes back pass
// through every wrapper the app installs.
describe('with the real WebDAV provider', () => {
  it('sends If-None-Match on a quiet poll and takes the 304', async () => {
    const requests = [];
    const body = JSON.stringify({ version: 2, lastModified: '2026-11-14T00:00:00.000Z', data: { tasks: TASKS, unscheduledTasks: [] } });
    vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
      const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
      requests.push({ method: init.method, target: new URL(url, 'http://app.test').searchParams.get('url'), ifNoneMatch: headers['if-none-match'] ?? null });
      if (init.method !== 'GET') return new Response('', { status: 201 });
      if (headers['if-none-match'] === ETAG) return new Response(null, { status: 304, headers: { ETag: ETAG } });
      return new Response(body, { status: 200, headers: { ETag: ETAG, 'Content-Type': 'application/json' } });
    }));
    const calls = { errors: [], applied: [] };
    const engine = createDayGlanceEngine({
      buildPayload: async () => ({ data: { tasks: TASKS, unscheduledTasks: [] }, lastModified: '2026-11-14T00:00:00.000Z' }),
      buildBackupPayload: async () => ({}),
      applyPayload: async (data) => { calls.applied.push(data); },
      onStatusChange: () => {},
      onError: (msg, code) => { if (msg) calls.errors.push(code); },
      onLastSyncedChange: () => {},
      onConflict: () => {},
      onPassphraseRequired: () => {},
      onFirstSyncReload: () => {},
      getSyncRetentionDays: () => 90,
    });
    localStorage.setItem('day-planner-cloud-sync-config', JSON.stringify({
      enabled: true, provider: 'webdav', webdavUrl: 'https://dav.example', username: 'u', appPassword: 'p',
    }));
    localStorage.setItem('day-planner-tasks', JSON.stringify(TASKS));
    localStorage.setItem(LAST_SYNCED_KEY, '2026-11-14T00:00:00.000Z');

    await runCycle(engine);
    // A 304 is a read of the target too: the server has just confirmed the
    // file is the one already merged, so the record is written again.
    const verifiedAfterFullRead = JSON.parse(localStorage.getItem(VERIFIED_REMOTE_KEY));
    expect(verifiedAfterFullRead).toMatchObject({ etag: ETAG });
    localStorage.removeItem(VERIFIED_REMOTE_KEY);
    await runCycle(engine);
    expect(JSON.parse(localStorage.getItem(VERIFIED_REMOTE_KEY))).toMatchObject({ etag: ETAG, targetKey: verifiedAfterFullRead.targetKey });

    const reads = requests.filter((r) => r.method === 'GET');
    expect(reads.map((r) => r.ifNoneMatch)).toEqual([null, ETAG]);
    expect(reads[0].target).toBe('https://dav.example/GLANCE/dayglance/dayglance-sync.json');
    expect(requests.filter((r) => r.method === 'PUT')).toEqual([]);
    expect(calls.errors).toEqual([]);
    expect(calls.applied).toEqual([]);
    vi.unstubAllGlobals();
  });
});
