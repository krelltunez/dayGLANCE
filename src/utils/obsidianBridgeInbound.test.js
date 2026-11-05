import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupDbRootKey, clearDbRootKey } from '@glance-apps/sync';
import { getDbRootKey } from '@glance-apps/sync/src/dbCrypto.js';
import {
  deriveBridgeSubkey,
  sealBridgeEnvelope,
  encodePlainBridgeRow,
  observationEntityId,
  noteTextHash,
} from '@glance-apps/obsidian-format';
import {
  fetchReportedNoteDescription,
  REPORTED_NOTE_READ_BUDGET_MS,
  REPORTED_NOTE_READ_CONCURRENCY,
  createReadLimiter,
  fetchBridgeObservations,
  commitBridgeObservationCursor,
  applyBridgeObservations,
  pendingBridgeObservations,
} from './obsidianBridgeInbound.js';

// The key gate (bridgeKeyGate.js) proves the root key against the account's
// verifier row; it has its own tests. Here the installed key is taken as
// proven so these tests keep to the stream they cover.
const keyGate = vi.hoisted(() => ({ verified: true }));
vi.mock('./bridgeKeyGate.js', async () => {
  const { getDbRootKey } = await import('@glance-apps/sync/src/dbCrypto.js');
  return { verifiedBridgeRootKey: async () => (keyGate.verified ? getDbRootKey() : null), resetBridgeKeyGate: () => {} };
});


// The inbound half's load-bearing claims: observations flow through the
// SAME per-note pipeline as a scan (title ownership, per-field adoption —
// §3.10 lives in one place), the deletion detector's baselines are never
// touched, the cursor advances only when the caller commits it, and rows
// sealed under a rotated-away generation are skipped, not fatal.

const VAULT_CONFIG_KEY = 'dayglance-vault-config';
const OBS_HWM_KEY = 'dayglance-bridge-obs-hwm';
const SALT = new Uint8Array(16).fill(5);
const SALT_B64 = btoa(String.fromCharCode(...SALT));
const META = { v: 1, kind: 'pairing-meta', generation: SALT_B64, pairingSalt: SALT_B64, pairedAt: '2026-08-29T00:00:00Z' };

const nativeStub = { get: () => null, store: () => {} };

beforeEach(async () => {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  localStorage.setItem(VAULT_CONFIG_KEY, JSON.stringify({
    enabled: true, vaultUrl: 'https://vault.example', vaultToken: 'tok', accountId: 'acct-1',
  }));
  const { __resetBridgeStreamForTests } = await import('./obsidianBridgeStream.js');
  __resetBridgeStreamForTests();
  await setupDbRootKey('pw', new Uint8Array(16).fill(9), {
    nativeGetSyncKey: nativeStub.get, nativeStoreSyncKey: nativeStub.store,
  });
});
afterEach(async () => {
  keyGate.verified = true;
  await clearDbRootKey({ nativeGetSyncKey: nativeStub.get, nativeStoreSyncKey: nativeStub.store });
  delete globalThis.localStorage;
  delete globalThis.fetch;
});

describe('fetchBridgeObservations', () => {
  it('decrypts observation rows, keeps per-path latest, ignores intent rows, and does NOT advance the cursor', async () => {
    const subkey = await deriveBridgeSubkey(getDbRootKey(), SALT);
    const obsId = await observationEntityId('2026-08-29.md');
    const rows = [
      { entityId: 'int:abc', seq: 1, envelope: await sealBridgeEnvelope(subkey, { v: 1, kind: 'intent', type: 'daily_note_write' }) },
      { entityId: obsId, seq: 2, envelope: await sealBridgeEnvelope(subkey, { v: 1, kind: 'observation', path: '2026-08-29.md', content: 'old', mtime: 1000, observedAt: 'x' }) },
      { entityId: obsId, seq: 3, envelope: await sealBridgeEnvelope(subkey, { v: 1, kind: 'observation', path: '2026-08-29.md', content: 'new', mtime: 2000, observedAt: 'y' }) },
      { entityId: 'obs:deadbeef', seq: 4, envelope: 'not decryptable (rotated generation)' },
    ];
    globalThis.fetch = async (url) => {
      if (url.includes('/meta')) return { ok: true, status: 200, json: async () => ({ entityId: 'meta:pairing', envelope: encodePlainBridgeRow(META) }) };
      if (url.includes('/list')) return { ok: true, status: 200, json: async () => ({ rows, hasMore: false }) };
      return { ok: false, status: 404, json: async () => ({}) };
    };
    const result = await fetchBridgeObservations();
    expect(result.maxSeq).toBe(4);
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0]).toMatchObject({ path: '2026-08-29.md', content: 'new' });
    // Cursor untouched until the caller has durably applied the batch.
    expect(localStorage.getItem(OBS_HWM_KEY)).toBe(null);
    commitBridgeObservationCursor(result.maxSeq);
    expect(localStorage.getItem(OBS_HWM_KEY)).toBe('4');
  });

  it('a configured vault whose root key is not loaded yet fails as key-pending, not unconfigured (the first-cycle hold)', async () => {
    const { lastBridgeInboundFailure } = await import('./obsidianBridgeInbound.js');
    await clearDbRootKey({ nativeGetSyncKey: nativeStub.get, nativeStoreSyncKey: nativeStub.store });
    globalThis.fetch = async () => { throw new Error('must not be called'); };
    expect(await fetchBridgeObservations()).toBe(null);
    expect(lastBridgeInboundFailure()).toBe('key-pending');
    // Incomplete config is still plain unconfigured, key or no key.
    localStorage.setItem(VAULT_CONFIG_KEY, JSON.stringify({ enabled: true, vaultUrl: '', vaultToken: 'tok', accountId: 'acct-1' }));
    expect(await fetchBridgeObservations()).toBe(null);
    expect(lastBridgeInboundFailure()).toBe('unconfigured');
    await setupDbRootKey('pw', new Uint8Array(16).fill(9), { nativeGetSyncKey: nativeStub.get, nativeStoreSyncKey: nativeStub.store });
  });

  it('unpaired (no meta row) → null, and nothing touched', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
    expect(await fetchBridgeObservations()).toBe(null);
  });
});

describe('fetchReportedNoteDescription (#2291: a linked note\'s section from the plugin\'s report)', () => {
  const NOTE = '---\ndayglance-id: p1\n---\n# House\nKeep the roof dry.\n\n## Tasks\n';
  // A fake vault holding observation rows by entity id; records every request.
  async function serve(observations) {
    const subkey = await deriveBridgeSubkey(getDbRootKey(), SALT);
    const rows = new Map();
    for (const obs of observations) {
      const id = await observationEntityId(obs.path);
      rows.set(id, { entityId: id, seq: 1, deleted: false, envelope: await sealBridgeEnvelope(subkey, { v: 1, kind: 'observation', ...obs }) });
    }
    const requests = [];
    globalThis.fetch = async (url) => {
      requests.push(url);
      const id = decodeURIComponent(new URL(url).pathname.split('/').pop());
      if (id === 'meta:pairing') return { ok: true, status: 200, json: async () => ({ entityId: 'meta:pairing', envelope: encodePlainBridgeRow(META) }) };
      const row = rows.get(id);
      return row ? { ok: true, status: 200, json: async () => row } : { ok: false, status: 404, json: async () => ({ error: 'not found' }) };
    };
    return requests;
  }

  it('reads the ONE row the plugin keeps for the path, and answers what the shared reader answers', async () => {
    const requests = await serve([{ path: 'Projects/House.md', content: NOTE, mtime: Date.parse('2026-11-05T09:59:00.000Z'), observedAt: '2026-11-05T10:00:00.000Z' }]);
    expect(await fetchReportedNoteDescription('[[Projects/House]]')).toEqual({
      text: 'Keep the roof dry.', base: noteTextHash('Keep the roof dry.'), observedAt: '2026-11-05T10:00:00.000Z', lastModified: '2026-11-05T09:59:00.000Z',
    });
    const obsId = await observationEntityId('Projects/House.md');
    expect(requests.filter((u) => u.includes('/sync/dayglance-bridge/obs'))).toEqual([expect.stringContaining(encodeURIComponent(obsId))]);
    // No list, and the cycle's cursor is untouched: nothing is kept.
    expect(requests.some((u) => u.includes('/list'))).toBe(false);
    expect(localStorage.getItem(OBS_HWM_KEY)).toBe(null);
  });

  it('a deletion reads as not found; a path never reported is no information (null)', async () => {
    await serve([{ path: 'Projects/House.md', content: null, deleted: true, mtime: null, observedAt: '2026-11-05T10:00:00.000Z' }]);
    expect(await fetchReportedNoteDescription('Projects/House.md')).toEqual({ notFound: true });
    expect(await fetchReportedNoteDescription('Projects/Elsewhere.md')).toBe(null);
  });

  it('a report slower than the budget is no information this time: a slow vault never holds the reading hostage', async () => {
    vi.useFakeTimers();
    try {
      globalThis.fetch = () => new Promise(() => {});
      const pending = fetchReportedNoteDescription('Projects/House.md');
      await vi.advanceTimersByTimeAsync(REPORTED_NOTE_READ_BUDGET_MS);
      await expect(pending).resolves.toBe(null);
    } finally {
      vi.useRealTimers();
    }
  });

  it('finds a note Obsidian names in decomposed form (the plugin keys the row on its own path)', async () => {
    const nfd = 'Projects/Café.md'.normalize('NFD');
    await serve([{ path: nfd, content: NOTE, mtime: null, observedAt: '2026-11-05T10:00:00.000Z' }]);
    expect(await fetchReportedNoteDescription('Projects/Café.md')).toMatchObject({ text: 'Keep the roof dry.' });
  });

  it('the cycle\'s gates: unpaired, a key not proven against the account, no key, an unconfigured vault, an unreachable one: null, never a throw', async () => {
    const report = [{ path: 'Projects/House.md', content: NOTE, mtime: null, observedAt: '2026-11-05T10:00:00.000Z' }];
    // Unpaired: the meta row is missing, no observation is asked for.
    let requests = [];
    globalThis.fetch = async (url) => { requests.push(url); return { ok: false, status: 404, json: async () => ({}) }; };
    expect(await fetchReportedNoteDescription('Projects/House.md')).toBe(null);
    expect(requests.some((u) => u.includes('/obs'))).toBe(false);
    // Paired (the cached "unpaired" answer forgotten), but the key gate has
    // not proven this device's key.
    localStorage.removeItem('dayglance-bridge-pairing-meta');
    requests = await serve(report);
    keyGate.verified = false;
    expect(await fetchReportedNoteDescription('Projects/House.md')).toBe(null);
    expect(requests.some((u) => u.includes('/obs'))).toBe(false);
    keyGate.verified = true;
    expect(await fetchReportedNoteDescription('Projects/House.md')).toMatchObject({ text: 'Keep the roof dry.' });
    // No root key in memory.
    await clearDbRootKey({ nativeGetSyncKey: nativeStub.get, nativeStoreSyncKey: nativeStub.store });
    expect(await fetchReportedNoteDescription('Projects/House.md')).toBe(null);
    await setupDbRootKey('pw', new Uint8Array(16).fill(9), { nativeGetSyncKey: nativeStub.get, nativeStoreSyncKey: nativeStub.store });
    // Unreachable.
    globalThis.fetch = async () => { throw new Error('offline'); };
    expect(await fetchReportedNoteDescription('Projects/House.md')).toBe(null);
    // GLANCEvault not configured on this device.
    localStorage.setItem(VAULT_CONFIG_KEY, JSON.stringify({ enabled: false }));
    expect(await fetchReportedNoteDescription('Projects/House.md')).toBe(null);
    expect(await fetchReportedNoteDescription('')).toBe(null);
  });
});

describe('pendingBridgeObservations (the SSE-nudge probe)', () => {
  // The /events stream carries only {seq} on an account counter shared
  // across apps, so this probe is the discriminator: one list page, an
  // obs:-prefix presence check, no decryption. dayGLANCE's own bridge
  // writes are int:/meta: rows — structurally excluded, a second damping
  // layer under the coalescer's exact-ack suppression.
  const listFetch = (payload, calls = []) => async (url) => {
    calls.push(url);
    if (url.includes('/list')) return { ok: true, status: 200, json: async () => payload };
    return { ok: false, status: 404, json: async () => ({}) };
  };

  it('wakes ONLY on live obs: rows above the cursor — int:/meta rows and tombstones never wake; hasMore wakes conservatively', async () => {
    globalThis.fetch = listFetch({ rows: [
      { entityId: 'int:abc', seq: 6 },
      { entityId: 'meta:config', seq: 7 },
      { entityId: 'obs:deadbeef', seq: 8, deleted: true },
    ], hasMore: false });
    expect(await pendingBridgeObservations()).toBe(false);

    globalThis.fetch = listFetch({ rows: [
      { entityId: 'int:abc', seq: 6 },
      { entityId: 'obs:deadbeef', seq: 8 },
    ], hasMore: false });
    expect(await pendingBridgeObservations()).toBe(true);

    // Page boundary: the obs row could be on page 2 — wake, don't paginate.
    globalThis.fetch = listFetch({ rows: [{ entityId: 'int:abc', seq: 6 }], hasMore: true });
    expect(await pendingBridgeObservations()).toBe(true);
  });

  it('wakes on a live act: row too (2026-09-06: a sidebar completion is consumed by the same cycle, and used to wait for the poll under live sync); a consumed (soft-deleted) action never wakes', async () => {
    globalThis.fetch = listFetch({ rows: [{ entityId: 'act:complete:obsidian-dg-abc', seq: 9 }], hasMore: false });
    expect(await pendingBridgeObservations()).toBe(true);
    globalThis.fetch = listFetch({ rows: [{ entityId: 'act:complete:obsidian-dg-abc', seq: 9, deleted: true }], hasMore: false });
    expect(await pendingBridgeObservations()).toBe(false);
  });

  it('lists from the persisted cursor, never advances it, and answers false on any doubt (disabled config, unreachable server)', async () => {
    localStorage.setItem(OBS_HWM_KEY, '41');
    const calls = [];
    globalThis.fetch = listFetch({ rows: [], hasMore: false }, calls);
    expect(await pendingBridgeObservations()).toBe(false);
    expect(calls.some((u) => u.includes('since=41'))).toBe(true);
    expect(localStorage.getItem(OBS_HWM_KEY)).toBe('41'); // cursor untouched

    // Disabled vault: no request at all.
    const calls2 = [];
    globalThis.fetch = listFetch({ rows: [] }, calls2);
    localStorage.setItem(VAULT_CONFIG_KEY, JSON.stringify({ enabled: false }));
    expect(await pendingBridgeObservations()).toBe(false);
    expect(calls2).toHaveLength(0);

    // Unreachable: false, poll floor covers.
    localStorage.setItem(VAULT_CONFIG_KEY, JSON.stringify({
      enabled: true, vaultUrl: 'https://vault.example', vaultToken: 'tok', accountId: 'acct-1',
    }));
    globalThis.fetch = async () => { throw new Error('network down'); };
    expect(await pendingBridgeObservations()).toBe(false);
  });
});

describe('the probe hands its page to the cycle (2026-10-04, the per-IP budget)', () => {
  it('a positive probe followed by a fetch from the same cursor costs ONE list; a cursor that moved, or a stale page, re-fetches', async () => {
    const { __resetProbedPageForTests } = await import('./obsidianBridgeInbound.js');
    __resetProbedPageForTests();
    localStorage.setItem(OBS_HWM_KEY, '41');
    const calls = [];
    globalThis.fetch = async (url) => {
      calls.push(url);
      if (url.includes('/meta')) return { ok: true, status: 200, json: async () => ({ entityId: 'meta:pairing', envelope: encodePlainBridgeRow(META) }) };
      if (url.includes('/list')) return { ok: true, status: 200, json: async () => ({ rows: [{ entityId: 'obs:deadbeef', seq: 42, envelope: 'junk' }], hasMore: false }) };
      return { ok: false, status: 404, json: async () => ({}) };
    };
    expect(await pendingBridgeObservations()).toBe(true);
    expect(calls.filter((u) => u.includes('/list'))).toHaveLength(1);
    // The cycle's fetch consumes the held page: no second list. (The row is
    // undecryptable junk here, which the fetch skips; the count is the point.)
    const r = await fetchBridgeObservations();
    expect(r).toBeTruthy();
    expect(calls.filter((u) => u.includes('/list'))).toHaveLength(1);
    // The page is consumed once: a second fetch lists again.
    await fetchBridgeObservations();
    expect(calls.filter((u) => u.includes('/list'))).toHaveLength(2);
    // A cursor that moved between probe and fetch discards the held page.
    expect(await pendingBridgeObservations()).toBe(true);
    localStorage.setItem(OBS_HWM_KEY, '99');
    await fetchBridgeObservations();
    expect(calls.filter((u) => u.includes('/list'))).toHaveLength(4);
    // A negative probe holds nothing.
    __resetProbedPageForTests();
    globalThis.fetch = async (url) => {
      calls.push(url);
      if (url.includes('/meta')) return { ok: true, status: 200, json: async () => ({ entityId: 'meta:pairing', envelope: encodePlainBridgeRow(META) }) };
      return { ok: true, status: 200, json: async () => ({ rows: [{ entityId: 'int:x', seq: 100 }], hasMore: false }) };
    };
    expect(await pendingBridgeObservations()).toBe(false);
    await fetchBridgeObservations();
    expect(calls.filter((u) => u.includes('/list'))).toHaveLength(6);
  });
});

describe('applyBridgeObservations', () => {
  const NOTE = '## Tasks\n- [ ] 09:00 Vault task #obsidian ^dg-abc12345\n';

  it('an observed daily note flows through the real scan pipeline — parse, existing-task merge, app-field ownership', () => {
    const existing = [{
      id: 'obsidian-dg-abc12345', importSource: 'obsidian', obsidianBlockId: 'abc12345',
      obsidianRawTitle: 'Vault task', title: 'Vault task #obsidian', date: '2026-08-29',
      completed: false, color: 'bg-purple-500', duration: 45, lastModified: '2026-08-20T00:00:00Z',
    }];
    const out = applyBridgeObservations(
      [{ path: 'Daily/2026-08-29.md', content: NOTE, mtime: 1756400000000, observedAt: '2026-08-29T12:00:00Z' }],
      { existingTasks: existing, existingInbox: [], dailyNotesPath: 'Daily', dailyNotePattern: 'yyyy-MM-dd' },
    );
    expect(out.dailyNotes['2026-08-29']).toMatchObject({ text: NOTE, fromObsidian: true });
    expect(out.scheduledTasks).toHaveLength(1);
    const task = out.scheduledTasks[0];
    // App-controlled fields carried exactly as the scan merge carries them.
    expect(task.color).toBe('bg-purple-500');
    expect(task.duration).toBe(45);
    expect(task.lastModified).toBe('2026-08-20T00:00:00Z');
    expect(out.scannedIds.has(String(task.id))).toBe(true);
  });

  it('out-of-scope paths are returned unapplied; a DELETED daily note is returned as evidence (deletedDailyNotes); nothing is tombstoned here', () => {
    const out = applyBridgeObservations(
      [
        { path: 'Some Note.md', content: 'wiki body' },
        { path: 'Daily/2026-08-28.md', content: null, deleted: true, observedAt: '2026-08-29T12:00:00Z' },
        { path: 'Daily/notadate.md', content: 'x' },
      ],
      { existingTasks: [], existingInbox: [], dailyNotesPath: 'Daily' },
    );
    expect(Object.keys(out.dailyNotes)).toHaveLength(0);
    expect(out.deletedDailyNotes).toEqual({ '2026-08-28': { lastModified: '2026-08-29T12:00:00Z' } });
    expect(out.scheduledTasks).toHaveLength(0);
    expect(out.unapplied).toHaveLength(2);
    // The detector's baselines are not this module's to touch.
    expect(localStorage.getItem('day-planner-obsidian-last-scanned')).toBe(null);
    expect(localStorage.getItem('day-planner-deleted-obsidian-keys')).toBe(null);
  });

  it('a fresh vault task with no local match imports at epoch (cloud merge yields to real edits)', () => {
    const out = applyBridgeObservations(
      [{ path: '2026-08-29.md', content: NOTE }],
      { existingTasks: [], existingInbox: [], dailyNotesPath: '' },
    );
    expect(out.scheduledTasks).toHaveLength(1);
    expect(out.scheduledTasks[0].lastModified).toBe(new Date(0).toISOString());
  });
});

describe('applyBridgeObservations — duplicate-token dedupe is vault-wide (audit low, 2026-08-31)', () => {
  // The existing owner of ^dg-abc12345 is the 2026-08-29 daily note.
  const OWNER_TEXT = '## Tasks\n- [ ] Vault task ^dg-abc12345\n';
  const COPY_TEXT = '## Tasks\n- [ ] Vault task ^dg-abc12345\n';
  const owner = () => [{
    id: 'obsidian-dg-abc12345', importSource: 'obsidian', obsidianBlockId: 'abc12345',
    obsidianRawTitle: 'Vault task', title: 'Vault task #obsidian', obsidianFileDate: '2026-08-29',
    completed: false, lastModified: '2026-08-20T00:00:00Z',
  }];
  const opts = (extra = {}) => ({
    existingTasks: [], existingInbox: owner(), dailyNotesPath: 'Daily', dailyNotePattern: 'yyyy-MM-dd',
    knownDailyNotes: { '2026-08-29': { text: OWNER_TEXT } },
    ...extra,
  });
  const obs = (date, content) => ({ path: `Daily/${date}.md`, content, mtime: 1756400000000, observedAt: '2026-08-30T12:00:00Z' });

  it('a copy-pasted line observed in ANOTHER note, alone in its batch, falls through as untagged: the owner keeps the token', () => {
    const out = applyBridgeObservations([obs('2026-08-30', COPY_TEXT)], opts());
    const copies = [...out.scheduledTasks, ...out.inboxTasks];
    expect(copies).toHaveLength(1);
    expect(copies[0].obsidianBlockId).toBeUndefined();
    expect(copies[0].id).not.toBe('obsidian-dg-abc12345');
    expect(copies[0].obsidianFileDate).toBe('2026-08-30');
  });

  it('both notes in one batch, the copy FIRST in batch order: the owner still wins (no order dependence)', () => {
    const out = applyBridgeObservations([obs('2026-08-30', COPY_TEXT), obs('2026-08-29', OWNER_TEXT)], opts());
    const all = [...out.scheduledTasks, ...out.inboxTasks];
    const tagged = all.filter((t) => t.obsidianBlockId === 'abc12345');
    expect(tagged).toHaveLength(1);
    expect(tagged[0].obsidianFileDate).toBe('2026-08-29');
    expect(all.find((t) => t.obsidianFileDate === '2026-08-30').obsidianBlockId).toBeUndefined();
  });

  it('a line CUT from the owner and pasted elsewhere re-homes the identity: the stored owner text no longer carries the token', () => {
    const out = applyBridgeObservations([obs('2026-08-30', COPY_TEXT)], opts({ knownDailyNotes: { '2026-08-29': { text: '## Tasks\n' } } }));
    const all = [...out.scheduledTasks, ...out.inboxTasks];
    expect(all).toHaveLength(1);
    expect(all[0].obsidianBlockId).toBe('abc12345');
    expect(all[0].id).toBe('obsidian-dg-abc12345');
  });

  it('a renamed daily note whose old date was already consumed (no stored text) re-homes the identity too', () => {
    const out = applyBridgeObservations([obs('2026-08-30', COPY_TEXT)], opts({ knownDailyNotes: {} }));
    expect([...out.scheduledTasks, ...out.inboxTasks][0].obsidianBlockId).toBe('abc12345');
  });

  it('a token owned by a SCOPED note outside the batch is not asserted from memory (no stored text to check)', () => {
    const scopedOwner = [{ ...owner()[0], obsidianFileDate: undefined, obsidianNotePath: 'Projects/House.md' }];
    const out = applyBridgeObservations([obs('2026-08-30', COPY_TEXT)], opts({ existingInbox: scopedOwner, knownDailyNotes: {} }));
    expect([...out.scheduledTasks, ...out.inboxTasks][0].obsidianBlockId).toBe('abc12345');
  });
});

describe('applyBridgeObservations — vault task scope (companion §6)', () => {
  const HOUSE = [
    '# House',
    '- [ ] Call the plumber ^dg-aaaaaaaa',
    '- [ ] Order tiles ⏳ 2026-09-12 ^dg-bbbbbbbb',
    '- [x] Pick paint ✅ 2026-08-30 ^dg-cccccccc',
    '- [x] Ancient but tracked ✅ 2024-01-01 ^dg-dddddddd',
    '- [x] Ancient and untracked ✅ 2024-01-01',
  ].join('\n');

  it('a scoped note parses under its path: dateless lines are inbox, ⏳ schedules, an UNTRACKED old completion drops (a tracked one is kept), no daily-note entry is made', () => {
    const out = applyBridgeObservations(
      [{ path: 'Projects/House.md', content: HOUSE, mtime: 1756400000000, observedAt: '2026-09-02T12:00:00Z', scoped: true }],
      { existingTasks: [], existingInbox: [], dailyNotesPath: 'Daily', scope: { completionWindowDays: 30 }, today: '2026-09-02' },
    );
    expect(Object.keys(out.dailyNotes)).toEqual([]);
    expect(out.scopedNotes['Projects/House.md']).toMatchObject({ lastModified: new Date(1756400000000).toISOString() });
    expect(out.scheduledTasks.map((t) => t.id)).toEqual(['obsidian-dg-bbbbbbbb']);
    expect(out.scheduledTasks[0]).toMatchObject({ date: '2026-09-12', obsidianNotePath: 'Projects/House.md' });
    // The window governs ADOPTION: a block-tagged completion is tracked
    // whatever its date (ruling E as amended by the harness finding).
    expect(out.inboxTasks.map((t) => t.id).sort()).toEqual(['obsidian-dg-aaaaaaaa', 'obsidian-dg-cccccccc', 'obsidian-dg-dddddddd']);
    expect(out.inboxTasks.every((t) => t.obsidianNotePath === 'Projects/House.md' && t.obsidianFileDate === undefined)).toBe(true);
    expect(out.scannedIds.has('obsidian-dg-dddddddd')).toBe(true);
    expect(out.inboxTasks.some((t) => t.title.startsWith('Ancient and untracked'))).toBe(false);
    expect(out.unapplied).toEqual([]);
  });

  it('a withdrawn note and a deleted scoped note are reported for the caller, not parsed', () => {
    const out = applyBridgeObservations(
      [
        { path: 'Projects/Old.md', withdrawn: true, observedAt: '2026-09-02T12:00:00Z' },
        { path: 'Projects/Gone.md', deleted: true, content: null, scoped: true, observedAt: '2026-09-02T12:00:00Z' },
      ],
      { existingTasks: [], existingInbox: [], dailyNotesPath: 'Daily', today: '2026-09-02' },
    );
    expect(out.withdrawn).toEqual(['Projects/Old.md']);
    expect(out.scopedNotes['Projects/Gone.md']).toMatchObject({ deleted: true, lastModified: '2026-09-02T12:00:00Z' });
    expect(out.scheduledTasks).toEqual([]);
    expect(out.inboxTasks).toEqual([]);
  });
});

describe('ruling H: scoped lines in a linked project note adopt the project on first import', () => {
  it('a fresh line gets the project; a known task keeps its own; an unlinked note assigns nothing', () => {
    const content = '- [ ] Order tiles ^dg-aaaaaaaa\n- [ ] Paint hall ^dg-bbbbbbbb\n';
    const known = { id: 'obsidian-dg-bbbbbbbb', title: 'Paint hall #obsidian', obsidianBlockId: 'bbbbbbbb', obsidianRawTitle: 'Paint hall', obsidianNotePath: 'Projects/House.md', projectId: 'other', lastModified: '2026-09-01T00:00:00.000Z', importSource: 'obsidian' };
    const out = applyBridgeObservations(
      [{ path: 'Projects/House.md', content, scoped: true, mtime: Date.parse('2026-09-03T10:00:00Z') }],
      { existingTasks: [], existingInbox: [known], today: '2026-09-03', projectByNotePath: { 'Projects/House.md': 'p1' } },
    );
    const byId = Object.fromEntries(out.inboxTasks.map((t) => [t.id, t]));
    expect(byId['obsidian-dg-aaaaaaaa'].projectId).toBe('p1');
    // A known task is not stamped here (its app-side project is carried by
    // the downstream merge, which keeps app-only fields from the existing row).
    expect(byId['obsidian-dg-bbbbbbbb'].projectId).not.toBe('p1');
    expect(byId['obsidian-dg-bbbbbbbb'].lastModified).toBe('2026-09-01T00:00:00.000Z');
    const none = applyBridgeObservations(
      [{ path: 'Projects/Other.md', content, scoped: true, mtime: Date.parse('2026-09-03T10:00:00Z') }],
      { existingTasks: [], existingInbox: [], today: '2026-09-03', projectByNotePath: { 'Projects/House.md': 'p1' } },
    );
    expect(none.inboxTasks.every((t) => !t.projectId)).toBe(true);
  });
});

describe('ruling G as amended: the [project:: …] field on daily-note lines', () => {
  const projects = [{ id: 'p1', title: 'House', obsidianNotePath: 'Projects/House.md' }, { id: 'p2', title: 'Garden' }];
  const daily = (line) => [{ path: 'Daily/2026-09-04.md', content: `## Tasks\n${line}\n`, mtime: Date.parse('2026-09-04T09:00:00Z') }];

  it('a fresh line carrying the field imports under that project (link by path, bare by title); an unresolvable name imports unassigned', () => {
    const cfg = { existingTasks: [], existingInbox: [], dailyNotesPath: 'Daily', projects };
    expect(applyBridgeObservations(daily('- [ ] Call the plumber [project:: [[Projects/House|House]]] ^dg-aaaaaaaa'), cfg).inboxTasks[0].projectId).toBe('p1');
    expect(applyBridgeObservations(daily('- [ ] Weed the beds [project:: Garden] ^dg-bbbbbbbb'), cfg).inboxTasks[0].projectId).toBe('p2');
    expect(applyBridgeObservations(daily('- [ ] Loose [project:: Nope] ^dg-cccccccc'), cfg).inboxTasks[0].projectId).toBeUndefined();
  });

  it('a vault edit of the field reassigns a known task; removing it unassigns; an untouched field keeps the app assignment', () => {
    const known = {
      id: 'obsidian-dg-aaaaaaaa', title: 'Call the plumber #obsidian', importSource: 'obsidian', obsidianBlockId: 'aaaaaaaa',
      obsidianRawTitle: 'Call the plumber [project:: [[Projects/House|House]]]', obsidianFileDate: '2026-09-04', projectId: 'p1', lastModified: '2026-09-04T08:00:00.000Z',
    };
    const cfg = { existingTasks: [], existingInbox: [known], dailyNotesPath: 'Daily', projects };
    expect(applyBridgeObservations(daily('- [ ] Call the plumber [project:: Garden] ^dg-aaaaaaaa'), cfg).inboxTasks[0].projectId).toBe('p2');
    expect(applyBridgeObservations(daily('- [ ] Call the plumber ^dg-aaaaaaaa'), cfg).inboxTasks[0].projectId).toBeNull(); // explicit: the vault unassigned it
    // App-side reassignment with the line unchanged: the merge keeps the app's project (preserveAppFields carries it downstream).
    const moved = { ...known, projectId: 'p2' };
    const out = applyBridgeObservations(daily('- [ ] Call the plumber [project:: [[Projects/House|House]]] ^dg-aaaaaaaa'), { ...cfg, existingInbox: [moved] });
    expect(out.inboxTasks[0].projectId).toBeUndefined(); // not adopted here; the hook's merge carries the app value
  });
});

describe('AUDIT FIX M10 (revival half) — observation mtimes: real ones are evidence, a missing one is not', () => {
  it('noteMtimes carries only notes the plugin reported an mtime for (daily and scoped); the text stamp still falls back to the observation time', () => {
    const out = applyBridgeObservations(
      [
        { path: 'Daily/2026-08-29.md', content: '## Tasks\n', mtime: 1756400000000, observedAt: '2026-08-29T12:00:00Z' },
        { path: 'Daily/2026-08-30.md', content: '## Tasks\n', observedAt: '2026-08-30T12:00:00Z' },
        { path: 'Projects/P.md', content: '- [ ] x\n', scoped: true, mtime: 1756500000000, observedAt: '2026-08-30T12:00:00Z' },
        { path: 'Projects/Q.md', content: '- [ ] y\n', scoped: true, observedAt: '2026-08-30T12:00:00Z' },
      ],
      { existingTasks: [], existingInbox: [], dailyNotesPath: 'Daily', dailyNotePattern: 'yyyy-MM-dd', scope: { folders: ['Projects'] } },
    );
    expect(out.dailyNotes['2026-08-30'].lastModified).toBe('2026-08-30T12:00:00Z'); // the observation time, as before
    expect(out.noteMtimes).toEqual({
      '2026-08-29': new Date(1756400000000).toISOString(),
      'Projects/P.md': new Date(1756500000000).toISOString(),
    });
  });
});

describe('createReadLimiter (the cap on report reads, #2291)', () => {
  const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
  const tick = () => new Promise((r) => setImmediate(r));

  it('runs at most `max` jobs at once, the rest in order as slots free', async () => {
    const limiter = createReadLimiter(2);
    const gates = [deferred(), deferred(), deferred(), deferred()];
    const started = [];
    const results = gates.map((g, i) => limiter.run(async () => { started.push(i); await g.promise; return i; }));
    await tick();
    expect(started).toEqual([0, 1]);
    expect(limiter.stats()).toEqual({ active: 2, waiting: 2 });
    gates[0].resolve(); await tick();
    expect(started).toEqual([0, 1, 2]);
    gates[1].resolve(); gates[2].resolve(); gates[3].resolve();
    await expect(Promise.all(results)).resolves.toEqual([0, 1, 2, 3]);
    expect(limiter.stats()).toEqual({ active: 0, waiting: 0 });
  });

  it('never runs a job whose caller gave up while it waited, and frees its slot', async () => {
    const limiter = createReadLimiter(1);
    const gate = deferred();
    const ran = [];
    const first = limiter.run(async () => { ran.push('first'); await gate.promise; });
    let cancelled = false;
    const second = limiter.run(async () => { ran.push('second'); }, { isCancelled: () => cancelled });
    cancelled = true; // its budget ran out while queued
    gate.resolve();
    await first;
    await expect(second).resolves.toBeUndefined();
    expect(ran).toEqual(['first']);
    expect(limiter.stats()).toEqual({ active: 0, waiting: 0 });
    // A job that throws still frees its slot.
    await expect(limiter.run(async () => { throw new Error('x'); })).rejects.toThrow('x');
    await expect(limiter.run(async () => 'next')).resolves.toBe('next');
  });

  it('the report reads share one limiter of REPORTED_NOTE_READ_CONCURRENCY', () => {
    expect(REPORTED_NOTE_READ_CONCURRENCY).toBe(4);
  });
});

