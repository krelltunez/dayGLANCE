import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupDbRootKey, clearDbRootKey } from '@glance-apps/sync';
import { getDbRootKey } from '@glance-apps/sync/src/dbCrypto.js';
import { deriveBridgeSubkey, sealBridgeEnvelope, encodePlainBridgeRow, observationEntityId } from '@glance-apps/obsidian-format';
import { createMemoryKeyValue } from './idbKeyValue.js';
import {
  refreshReportedNoteIndex, reportedNoteIndexForRead, noteCyclePathListing, applyReportedNoteListing,
  __setReportedNoteIndexStorageForTests, REPORTED_NOTE_INDEX_STORAGE_KEY,
} from './reportedNoteIndexStore.js';
import {
  fetchBridgeObservations, commitBridgeObservationCursor, listReportedNotePaths, lastBridgeInboundFailure,
  pendingBridgeObservations, __resetProbedPageForTests,
} from './obsidianBridgeInbound.js';
import { resolveIndexedTaskNote, reportedNoteIndexKey } from './reportedNotePaths.js';
import { parseTaskNoteLink } from './taskNoteSources.js';

// The index of reported note paths, stored and fed (#2291 follow-up: task
// notes): the bootstrap listing from zero, the index's own cursor beside the
// cycle's, and the cycle's pull handed over. Real listing and decryption
// against a fake GLANCEvault; the key gate is taken as proven, as in
// obsidianBridgeInbound.test.js. Each guard was mutation-checked.

vi.mock('./bridgeKeyGate.js', async () => {
  const { getDbRootKey } = await import('@glance-apps/sync/src/dbCrypto.js');
  return { verifiedBridgeRootKey: async () => getDbRootKey(), resetBridgeKeyGate: () => {} };
});

const VAULT_CONFIG_KEY = 'dayglance-vault-config';
const OBS_HWM_KEY = 'dayglance-bridge-obs-hwm';
const CFG = { enabled: true, vaultUrl: 'https://vault.example', vaultToken: 'tok', accountId: 'acct-1' };
const SALT = new Uint8Array(16).fill(5);
const SALT_B64 = btoa(String.fromCharCode(...SALT));
const META = { v: 1, kind: 'pairing-meta', generation: SALT_B64, pairingSalt: SALT_B64, pairedAt: '2026-08-29T00:00:00Z' };
const KEY = reportedNoteIndexKey(CFG, META);
const nativeStub = { get: () => null, store: () => {} };

// A fake GLANCEvault's bridge namespace: upserted rows with a monotonic seq,
// listed `since` a cursor in pages of PAGE rows.
const PAGE = 2;
let rows;
let seq;
let requests;
let failLists;
let kv;
let subkey;
async function put(payload, entityId = null) {
  const id = entityId ?? await observationEntityId(payload.path);
  rows.set(id, { entityId: id, seq: ++seq, deleted: false, envelope: await sealBridgeEnvelope(subkey, { v: 1, kind: 'observation', ...payload }) });
}
const reportNote = (path, content = `# ${path}`) => put({ path, content, mtime: 1, observedAt: '2026-11-05T10:00:00.000Z' });
const reportDeleted = (path) => put({ path, deleted: true, observedAt: '2026-11-05T10:00:00.000Z' });
const reportWithdrawn = (path) => put({ path, withdrawn: true, observedAt: '2026-11-05T10:00:00.000Z' });
const lists = () => requests.filter((u) => u.includes('/list'));
const stored = () => kv.get(REPORTED_NOTE_INDEX_STORAGE_KEY);
const resolve = (name, index) => resolveIndexedTaskNote(parseTaskNoteLink(name), index);

beforeEach(async () => {
  const ls = {};
  globalThis.localStorage = {
    getItem: (k) => (k in ls ? ls[k] : null),
    setItem: (k, v) => { ls[k] = String(v); },
    removeItem: (k) => { delete ls[k]; },
  };
  localStorage.setItem(VAULT_CONFIG_KEY, JSON.stringify(CFG));
  const { __resetBridgeStreamForTests } = await import('./obsidianBridgeStream.js');
  __resetBridgeStreamForTests();
  __resetProbedPageForTests();
  await setupDbRootKey('pw', new Uint8Array(16).fill(9), { nativeGetSyncKey: nativeStub.get, nativeStoreSyncKey: nativeStub.store });
  subkey = await deriveBridgeSubkey(getDbRootKey(), SALT);
  kv = createMemoryKeyValue();
  __setReportedNoteIndexStorageForTests(kv);
  rows = new Map();
  seq = 0;
  requests = [];
  failLists = 0;
  globalThis.fetch = async (url) => {
    requests.push(url);
    const u = new URL(url);
    const tail = decodeURIComponent(u.pathname.split('/').pop());
    if (tail === 'meta:pairing') return { ok: true, status: 200, json: async () => ({ entityId: 'meta:pairing', envelope: encodePlainBridgeRow(META) }) };
    if (tail === 'list') {
      if (failLists > 0) { failLists -= 1; return { ok: false, status: 502, json: async () => ({ error: 'bad gateway' }) }; }
      const since = Number(u.searchParams.get('since')) || 0;
      const above = [...rows.values()].filter((r) => r.seq > since).sort((a, b) => a.seq - b.seq);
      return { ok: true, status: 200, json: async () => ({ rows: above.slice(0, PAGE), hasMore: above.length > PAGE }) };
    }
    return { ok: false, status: 404, json: async () => ({ error: 'not found' }) };
  };
});
afterEach(async () => {
  __setReportedNoteIndexStorageForTests(null);
  await clearDbRootKey({ nativeGetSyncKey: nativeStub.get, nativeStoreSyncKey: nativeStub.store });
  delete globalThis.localStorage;
  delete globalThis.fetch;
});

describe('listReportedNotePaths (the index\'s own lister)', () => {
  it('reads every page from the cursor it is given, the paths only, skipping link rows, other rows and unreadable ones', async () => {
    await reportNote('Work/Alpha/Plan.md');
    await put({ path: 'Projects/House.md', link: true, targetId: 'p1' }, 'obs:link-row');
    rows.set('int:abc', { entityId: 'int:abc', seq: ++seq, envelope: 'sealed intent' });
    rows.set('obs:junk', { entityId: 'obs:junk', seq: ++seq, envelope: 'not decryptable (rotated generation)' });
    await reportDeleted('Old.md');
    const listing = await listReportedNotePaths();
    expect(listing).toEqual({
      key: KEY, since: 0, maxSeq: 5, full: true,
      reports: [{ path: 'Work/Alpha/Plan.md', seq: 1, state: 'n' }, { path: 'Old.md', seq: 5, state: 'd' }],
    });
    expect(lists().length).toBeGreaterThan(1); // paged
    const later = await listReportedNotePaths({ since: 4 });
    expect(later).toMatchObject({ since: 4, maxSeq: 5, full: false, reports: [{ path: 'Old.md', seq: 5, state: 'd' }] });
  });
  it('a failed page, or a page that says more follow but carries none, is no listing at all (never a partial one)', async () => {
    await reportNote('A.md');
    await reportNote('B.md');
    await reportNote('C.md');
    failLists = 1;
    expect(await listReportedNotePaths()).toBe(null);
    const real = globalThis.fetch;
    globalThis.fetch = async (url) => (url.includes('/list')
      ? { ok: true, status: 200, json: async () => ({ rows: [], hasMore: true }) }
      : real(url));
    expect(await listReportedNotePaths()).toBe(null);
  });
  it('leaves everything the cycle owns alone: its cursor, the probe\'s held page, its failure reason', async () => {
    await reportNote('A.md');
    localStorage.setItem(OBS_HWM_KEY, '0');
    expect(await pendingBridgeObservations()).toBe(true); // holds its page for the cycle
    failLists = 0;
    const before = lists().length;
    await listReportedNotePaths();
    expect(localStorage.getItem(OBS_HWM_KEY)).toBe('0');
    // The cycle's fetch still consumes the held page: no list of its own.
    const listsBefore = lists().length;
    expect(listsBefore).toBeGreaterThan(before);
    await fetchBridgeObservations();
    expect(lists().length).toBe(listsBefore);
    // A failed index listing is not the cycle's failure.
    failLists = 1;
    expect(await listReportedNotePaths()).toBe(null);
    expect(lastBridgeInboundFailure()).toBe(null);
  });
});

describe('the bootstrap (an index never completed lists ONCE from zero)', () => {
  it('a full listing marks the index complete; the real cursor is untouched', async () => {
    await reportNote('Tags/Anywhere/Gutter repair.md');
    await reportNote('Daily/2026-09-04.md');
    await reportNote('Work/Alpha/Plan.md');
    localStorage.setItem(OBS_HWM_KEY, '3'); // the cycle has long passed these rows
    const index = await refreshReportedNoteIndex();
    expect(index).toMatchObject({ key: KEY, complete: true, seq: 3 });
    expect(lists()[0]).toContain('since=0');
    expect(await stored()).toEqual(index);
    expect(localStorage.getItem(OBS_HWM_KEY)).toBe('3');
    expect(resolve('Gutter repair', index)).toEqual({ path: 'Tags/Anywhere/Gutter repair.md' });
    expect(resolve('2026-09-04', index)).toEqual({ path: 'Daily/2026-09-04.md' });
    expect(resolve('Alpha/Plan', index)).toEqual({ path: 'Work/Alpha/Plan.md' });
  });
  it('a failed listing leaves it incomplete (nothing stored), and the next one bootstraps again', async () => {
    await reportNote('A.md');
    await reportNote('B.md');
    await reportNote('C.md');
    // The SECOND page fails: the first page's rows are not an index.
    let calls = 0;
    const real = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (url.includes('/list') && ++calls === 2) return { ok: false, status: 502, json: async () => ({}) };
      return real(url);
    };
    expect(await refreshReportedNoteIndex()).toBe(null);
    expect(await stored()).toBeUndefined();
    // The panel's read meanwhile: no index to trust (it guesses, as before).
    globalThis.fetch = async (url) => (url.includes('/list') ? { ok: false, status: 502, json: async () => ({}) } : real(url));
    expect(await reportedNoteIndexForRead()).toEqual({ index: null, fresh: false });
    globalThis.fetch = real;
    const index = await refreshReportedNoteIndex();
    expect(index).toMatchObject({ complete: true, seq: 3 });
    expect(Object.keys(index.paths)).toEqual(['A.md', 'B.md', 'C.md']);
  });
  it('once complete, a refresh lists from the INDEX\'s seq, and a deletion, a withdrawal and a rename reach it', async () => {
    await reportNote('Projects/Plan.md');
    await reportNote('Areas/Budget.md');
    await refreshReportedNoteIndex();
    requests.length = 0;
    await reportDeleted('Projects/Plan.md');
    await reportNote('Projects/Roadmap.md'); // the rename: old path deleted, new one reported
    await reportWithdrawn('Areas/Budget.md');
    const index = await refreshReportedNoteIndex();
    expect(lists()[0]).toContain('since=2');
    expect(index.seq).toBe(5);
    expect(resolve('Plan', index)).toEqual({ none: 'deleted' });
    expect(resolve('Roadmap', index)).toEqual({ path: 'Projects/Roadmap.md' });
    expect(resolve('Budget', index)).toEqual({ none: 'withdrawn' });
  });
  it('NOT LOADED IS NOT EMPTY: an unreadable or foreign stored value is an incomplete index, rebuilt from zero', async () => {
    await reportNote('A.md');
    await kv.set(REPORTED_NOTE_INDEX_STORAGE_KEY, { garbage: true });
    // While no listing can complete it, the stored value is no index at all.
    failLists = 1;
    expect(await reportedNoteIndexForRead()).toEqual({ index: null, fresh: false });
    const index = await refreshReportedNoteIndex();
    expect(lists().pop()).toContain('since=0');
    expect(index).toMatchObject({ complete: true, paths: { 'A.md': [1, 'n'] } });
  });
  it('a RE-PAIR (another generation and salt) does not reuse the old index: it is rebuilt from zero under the new key', async () => {
    await reportNote('Old pairing.md');
    const first = await refreshReportedNoteIndex();
    expect(first.key).toBe(KEY);
    // Re-paired: a new salt, so the old rows no longer open.
    const salt2 = new Uint8Array(16).fill(6);
    const meta2 = { ...META, generation: 'gen-2', pairingSalt: btoa(String.fromCharCode(...salt2)) };
    const { __resetBridgeStreamForTests, getBridgePairingMeta } = await import('./obsidianBridgeStream.js');
    __resetBridgeStreamForTests();
    subkey = await deriveBridgeSubkey(getDbRootKey(), salt2);
    await reportNote('New pairing.md');
    const real = globalThis.fetch;
    globalThis.fetch = async (url) => (decodeURIComponent(new URL(url).pathname).endsWith('meta:pairing')
      ? { ok: true, status: 200, json: async () => ({ entityId: 'meta:pairing', envelope: encodePlainBridgeRow(meta2) }) }
      : real(url));
    await getBridgePairingMeta({ force: true });
    requests.length = 0;
    const second = await refreshReportedNoteIndex();
    expect(lists()[0]).toContain('since=0');
    expect(second.key).toBe(reportedNoteIndexKey(CFG, meta2));
    expect(Object.keys(second.paths)).toEqual(['New pairing.md']);
  });
  it('the read waits a budget, not the listing: a slow bootstrap leaves the index incomplete this time and lands later', async () => {
    vi.useFakeTimers();
    try {
      await reportNote('A.md');
      const real = globalThis.fetch;
      let release;
      const held = new Promise((r) => { release = r; });
      globalThis.fetch = async (url) => { if (url.includes('/list')) await held; return real(url); };
      const read = reportedNoteIndexForRead({ budgetMs: 1000 });
      await vi.advanceTimersByTimeAsync(1000);
      expect(await read).toEqual({ index: null, fresh: false });
      release();
      vi.useRealTimers();
      await vi.waitFor(async () => expect((await stored())?.complete).toBe(true));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the cycle\'s pull, handed to the index', () => {
  it('a cycle from cursor zero completes the index with no listing of its own; later pulls continue it; the cycle\'s commit is its own', async () => {
    await reportNote('Daily/2026-09-04.md');
    const fetched = await fetchBridgeObservations();
    expect(fetched.pathListing).toMatchObject({ key: KEY, since: 0, full: true });
    requests.length = 0;
    const index = await noteCyclePathListing(fetched.pathListing);
    expect(lists()).toHaveLength(0);
    expect(index).toMatchObject({ complete: true, seq: 1, paths: { 'Daily/2026-09-04.md': [1, 'n'] } });
    expect(localStorage.getItem(OBS_HWM_KEY)).toBe(null); // the cycle commits its own cursor, after its merges
    commitBridgeObservationCursor(fetched.maxSeq);
    await reportNote('Tags/Note.md');
    const next = await fetchBridgeObservations();
    expect(next.pathListing).toMatchObject({ since: 1, full: false });
    expect(await noteCyclePathListing(next.pathListing)).toMatchObject({ seq: 2, paths: { 'Tags/Note.md': [2, 'n'] } });
  });
  it('a pull that does not continue the index (it was never built here, the cycle\'s cursor is ahead) is dropped; holding, it starts the bootstrap, and the cycle\'s cursor stays where the cycle put it', async () => {
    await reportNote('Before the index.md');
    await reportNote('Also before.md');
    localStorage.setItem(OBS_HWM_KEY, '2');
    await reportNote('After.md');
    const fetched = await fetchBridgeObservations();
    expect(fetched.pathListing).toMatchObject({ since: 2, full: false });
    // The plugin posture: no listing, no index.
    expect(await noteCyclePathListing(fetched.pathListing)).toBe(null);
    expect(await stored()).toBeUndefined();
    // Holding: the bootstrap, from zero.
    requests.length = 0;
    const index = await noteCyclePathListing(fetched.pathListing, { catchUp: true });
    expect(lists()[0]).toContain('since=0');
    expect(Object.keys(index.paths).sort()).toEqual(['After.md', 'Also before.md', 'Before the index.md']);
    expect(localStorage.getItem(OBS_HWM_KEY)).toBe('2');
  });
  it('the two feeds land in either order: an older pull applied after a newer listing does not bring a deleted note back', async () => {
    await reportNote('Plan.md');
    const stale = await fetchBridgeObservations(); // Plan.md present, seq 1
    await reportDeleted('Plan.md');
    const index = await refreshReportedNoteIndex();
    expect(resolve('Plan', index)).toEqual({ none: 'deleted' });
    const after = await noteCyclePathListing(stale.pathListing);
    expect(resolve('Plan', after)).toEqual({ none: 'deleted' });
    expect(after.seq).toBe(2);
  });
  it('a listing for no pairing is ignored', async () => {
    expect(await applyReportedNoteListing({ key: null, since: 0, maxSeq: 1, reports: [], full: true })).toEqual({ index: null, applied: false });
    expect(await noteCyclePathListing(null)).toBe(null);
  });
});
