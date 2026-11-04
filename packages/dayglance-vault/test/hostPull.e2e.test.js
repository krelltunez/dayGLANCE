// @vitest-environment node
// The GLANCEvault-client host's read path, end to end, in plain Node (#2280).
//
// "Device A" is a dayGLANCE device: the real createDbSyncEngine from
// @glance-apps/sync (2.4.0), with Map-backed `storage`, its root key derived
// from the passphrase and kept through nativeGetSyncKey / nativeStoreSyncKey,
// and this package's adapter over a realistic data object. It pushes. "The
// host" is a fresh engine with its own storage and key slot, the same
// passphrase, the same vault, the same adapter over an EMPTY data object. It
// pulls, runs the two post-pull steps the app's wrapper runs every cycle
// (reconcileCrossList, pruneAllTombstones), and answers the MCP read model
// (@glance-apps/dayglance-mcp/model) for one user in an IANA zone. The answers
// must equal what the same calls give on Device A's own data.
//
// The vault is an in-memory server behind a fetch shim, so the engine builds
// its REAL vault client and the REAL per-entity crypto runs: nothing between
// the adapter and the wire is stubbed.
//
// One account per process: the root key is module state in @glance-apps/sync.
// The two devices take turns in this one process, and `endProcess()` drops the
// in-memory key between turns (touching neither device's stored key), so each
// turn has to get its key the way a fresh process would: from its own key slot,
// or from the passphrase and the vault's salt.
import { describe, it, expect, beforeAll } from 'vitest';
import {
  createDbSyncEngine,
  setSyncPassphrase,
  clearDbRootKey,
  hasDbRootKey,
  decryptEntity,
} from '@glance-apps/sync';
import { buildMcpReadState, handleMcpRequest } from '@glance-apps/dayglance-mcp/model';
import {
  vaultEngineCallbacks,
  shredState,
  reassembleState,
  reconcileCrossList,
  pruneAllTombstones,
  tombstoneCutoff,
} from '../src/index.js';

// ── The in-memory GLANCEvault ────────────────────────────────────────────────
// The routes the vault client calls (glance-vault's routes/sync.ts and the
// salt route, as the client contracts them): a monotonic per-server seq, rows
// upserted by entityId, soft deletes carrying the deletedAt the pusher sent,
// insert-only (first-write-wins) rows for the key verifier, and a
// first-write-wins salt.
function createMemoryVault() {
  let seq = 0;
  const tables = new Map(); // app -> Map(entityId -> row)
  const salts = new Map();
  const requests = [];
  const table = (app) => {
    if (!tables.has(app)) tables.set(app, new Map());
    return tables.get(app);
  };
  const respond = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    requests.push({ method, path: u.pathname, since: u.searchParams.get('since') });
    const body = init.body ? JSON.parse(init.body) : {};
    let m = /^\/salt\/([^/]+)$/.exec(u.pathname);
    if (m) {
      const acct = decodeURIComponent(m[1]);
      if (method === 'GET') return salts.has(acct) ? respond(200, { salt: salts.get(acct) }) : respond(404, { error: 'not found' });
      if (method === 'PUT') {
        if (!salts.has(acct)) salts.set(acct, body.salt);
        return respond(200, { salt: salts.get(acct) });
      }
    }
    m = /^\/sync\/([^/]+)\/([^/]+)$/.exec(u.pathname);
    if (!m) return respond(404, { error: 'not found' });
    const t = table(decodeURIComponent(m[1]));
    const tail = decodeURIComponent(m[2]);
    if (method === 'POST' && tail === 'batch') {
      let written = 0;
      for (const r of body.rows || []) {
        const prev = t.get(r.entityId);
        if (r.insertOnly && prev && !prev.deleted) continue;
        t.set(r.entityId, { entityId: r.entityId, envelope: r.envelope, seq: ++seq, deleted: false, createdAt: r.createdAt });
        written += 1;
      }
      return respond(200, { written, maxSeq: seq });
    }
    if (method === 'POST' && tail === 'device') return respond(200, { updated: true });
    if (method === 'GET' && tail === 'list') {
      const since = Number(u.searchParams.get('since')) || 0;
      const rows = [...t.values()].filter((r) => r.seq > since).sort((a, b) => a.seq - b.seq);
      return respond(200, { rows, hasMore: false });
    }
    if (method === 'GET') return t.has(tail) ? respond(200, t.get(tail)) : respond(404, { error: 'not found' });
    if (method === 'DELETE') {
      const prev = t.get(tail);
      const deletedAt = Number(u.searchParams.get('deletedAt')) || undefined;
      t.set(tail, { entityId: tail, envelope: null, seq: ++seq, deleted: true, deletedAt, createdAt: prev?.createdAt });
      return respond(200, { seq });
    }
    return respond(404, { error: 'not found' });
  };
  return { fetch, requests, rows: (app) => [...table(app).values()] };
}

// ── A device: its own storage, key slot and data, over the shared vault ─────
const ACCOUNT = 'acct-e2e';
const PASSPHRASE = 'correct horse battery staple';

function createDevice(name, vault, data) {
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  const keySlot = { value: null, writes: 0 };
  const device = { name, data, store, keySlot, engine: null };
  // A fresh engine is a fresh process: only the storage and the key slot
  // carry over from the last one.
  device.start = () => {
    const engine = createDbSyncEngine({
      storageKeyPrefix: `e2e-${name}`,
      appId: 'dayglance',
      accountId: ACCOUNT,
      vaultUrl: 'https://vault.test',
      vaultToken: `token-${name}`,
      fetchImpl: vault.fetch,
      deviceId: `device-${name}`,
      cryptoDBName: 'unused-with-hooks',
      storage,
      nativeGetSyncKey: async () => keySlot.value,
      nativeStoreSyncKey: (v) => { keySlot.value = v; keySlot.writes += 1; },
      ...vaultEngineCallbacks(() => device.data, (id) => engine.markDirty(id)),
    });
    device.engine = engine;
    return engine;
  };
  return device;
}

/** The in-memory key goes, as at a process exit; neither device's key slot is touched. */
async function endProcess() {
  await clearDbRootKey({ cryptoDBName: 'unused', nativeGetSyncKey: async () => null, nativeStoreSyncKey: () => {} });
  setSyncPassphrase(null);
}

/**
 * Mark what changed between two copies of a device's data, as the app's
 * snapshot diff does (src/sync/dbEngine.js): a row whose content changed is an
 * upsert, a row that vanished is a delete, unless it is held back (the app's
 * snapshot guard withholds a vanish-delete it cannot prove; peers converge on
 * the stale copy through reconcileCrossList).
 */
function markChanges(engine, before, after, { holdDeletes = [] } = {}) {
  const prev = new Map(shredState(before).map((r) => [r.entityId, JSON.stringify(r.entity)]));
  const next = new Map(shredState(after).map((r) => [r.entityId, JSON.stringify(r.entity)]));
  for (const [id, json] of next) if (prev.get(id) !== json) engine.markDirty(id);
  for (const id of prev.keys()) if (!next.has(id) && !holdDeletes.includes(id)) engine.markDirty(id);
}

/** A pull, then the two steps the app's wrapper runs after every pull. */
async function hostPull(host) {
  const engine = host.start();
  const pull = await engine.pullRemoteChanges();
  reconcileCrossList(host.data, (id) => engine.markDirty(id));
  pruneAllTombstones(host.data, tombstoneCutoff());
  return pull;
}

// ── The user's data on Device A ──────────────────────────────────────────────
const ZONE = 'America/Los_Angeles';
const NOW = Date.parse('2026-10-22T03:30:00Z'); // 20:30 PDT on Wednesday 2026-10-21
const TODAY = '2026-10-21';
const TOMORROW = '2026-10-22';
const ME = 'u-me';
const OTHER = 'u-other';
const T0 = '2026-10-15T16:00:00.000Z';
const at = (minutes) => new Date(Date.parse('2026-10-20T16:00:00.000Z') + minutes * 60000).toISOString();
// Tombstones are stamped against the real clock: the host prunes them at the
// fixed 60-day window from now, as every writer does.
const recently = (days) => new Date(Date.now() - days * 86400000).toISOString();
const GONE_AT = recently(3);

const joboRecord = {
  id: 'do:t1:2026-10-21T17:15:00.000Z',
  taskId: 't1',
  title: 'Write report',
  source: 'completion',
  progress: 'completed',
  deleted: false,
  createdAt: '2026-10-21T17:15:00.000Z',
  updatedAt: '2026-10-21T17:15:00.000Z',
  observedAt: '2026-10-21T17:15:02.000Z',
  date: TODAY,
  timing: 'untimed',
  startTime: null,
  endDate: null,
  endTime: null,
  planSnapshot: { date: TODAY, startTime: '09:00', duration: 60 },
};

function deviceAData() {
  return {
    multiUserEnabled: true,
    multiUserEnabledUpdatedAt: T0,
    users: [
      { id: 1, syncId: ME, name: 'Alex', updatedAt: T0 },
      { id: 2, syncId: OTHER, name: 'Sam', updatedAt: T0 },
    ],
    tasks: [
      { id: 't1', title: 'Write report', date: TODAY, startTime: '09:00', duration: 60, projectId: 'p1', assignedUserSyncIds: [ME], completed: true, createdAt: T0, completedAt: '2026-10-21T17:15:00.000Z', lastModified: at(10), deferrals: 2, planTrail: [{ at: Date.parse(at(5)), date: TODAY, startTime: '09:00' }] },
      { id: 't2', title: 'Sam: dentist', date: TODAY, startTime: '10:00', duration: 30, assignedUserSyncIds: [OTHER], lastModified: at(11) },
      { id: 't3', title: 'Groceries', date: TODAY, startTime: '18:00', duration: 30, projectId: 'p1', lastModified: at(12) },
      { id: 't4', title: 'Call the plumber', date: TODAY, startTime: '12:00', duration: 15, lastModified: at(13) },
      { id: 't5', title: 'Dentist follow-up', date: TOMORROW, startTime: '08:00', duration: 30, lastModified: at(14), archived: true, originalPlan: { date: TODAY, startTime: '08:00' } },
    ],
    recurringTasks: [
      {
        id: 'standup', title: 'Standup', startTime: '08:30', duration: 15,
        recurrence: { type: 'daily', startDate: '2026-10-01' },
        completedDates: ['2026-10-19', '2026-10-20'],
        completedDatesTimestamps: { '2026-10-19': at(-1400), '2026-10-20': at(20) },
        exceptions: { [TODAY]: { startTime: '08:45' }, [TOMORROW]: { title: 'Standup (short)', duration: 10 } },
        exceptionsTimestamps: { [TODAY]: at(21), [TOMORROW]: at(22) },
        createdAt: T0, lastModified: at(22),
      },
    ],
    unscheduledTasks: [
      { id: 'u1', title: 'Plan trip', lastModified: at(30) },
      { id: 'u2', title: 'Draft outline', projectId: 'p1', duration: 45, lastModified: at(31) },
      { id: 'u3', title: 'Old errand', completed: true, lastModified: at(32) },
      { id: 'u4', title: 'Learn piano', bucketId: 'b2', lastModified: at(33) },
      { id: 'u5', title: 'Sam: call bank', assignedUserSyncIds: [OTHER], lastModified: at(34) },
    ],
    recycleBin: [{ id: 't-binned', title: 'Binned', date: TODAY, startTime: '07:00', duration: 15, lastModified: at(35) }],
    todayRoutines: [
      { id: 'r-mine', name: 'Stretch', startTime: '07:00', duration: 15, ownerSyncId: ME, lastModified: at(40) },
      { id: 'r-other', name: 'Sam: yoga', startTime: '06:00', duration: 30, ownerSyncId: OTHER, lastModified: at(41) },
    ],
    routinesDate: TODAY,
    routineCompletions: { 'r-mine': TODAY },
    routineCompletionTimestamps: { 'r-mine': at(42) },
    routinesEnabled: true,
    routinesEnabledUpdatedAt: T0,
    gtdFrames: [
      { id: 'f-mine', label: 'Evening focus', enabled: true, days: [3], start: '19:00', end: '21:00', bufferMinutes: 0, ownerSyncId: ME, lastModified: at(50) },
      { id: 'f-other', label: 'Sam: deep work', enabled: true, days: [3], start: '19:00', end: '21:00', ownerSyncId: OTHER, lastModified: at(51) },
    ],
    goals: [
      { id: 'g1', title: 'Ship the website', status: 'active', areaId: 'a1', targetDate: '2026-12-01', updatedAt: at(60), obsidianNotePath: 'Goals/Ship the website.md' },
      { id: 'g2', title: 'Old goal', status: 'archived', updatedAt: at(61) },
    ],
    projects: [
      { id: 'p1', title: 'Website', status: 'active', goalId: 'g1', updatedAt: at(62) },
      { id: 'p2', title: 'Side project', status: 'active', updatedAt: at(63) },
    ],
    areas: [{ id: 'a1', name: 'Work', order: 0, updatedAt: at(64) }],
    dailyNotes: { [TODAY]: { text: 'Gym after work.', lastModified: at(70) } },
    bucketConfig: { headings: { b1: 'Anytime', b2: 'Someday maybe' }, updatedAt: at(71) },
    deletedTaskIds: { 't-gone': GONE_AT },
    joboRecords: [joboRecord],
  };
}

// ── What the host answers ────────────────────────────────────────────────────
// The host's configuration: who it answers as, and what the device settings
// would have said. Some settings never arrive from the vault, by design: the
// adapter keeps the receiving device's value. multiUserEnabled is always
// device-local, and while it is on, so are the feature toggles
// (routinesEnabled, habitsEnabled, goalsProjectsEnabled), so that one
// member's choice is not everyone's. A host is configured with them, as with
// the zone and the week start; without routinesEnabled here, the host would
// silently show no routines.
const HOST_CONFIG = { userSyncId: ME, timeZone: ZONE, weekStartDay: 1 };
const HOST_SETTINGS = { multiUserEnabled: true, routinesEnabled: true };

function answers(data) {
  const state = buildMcpReadState(data, { now: NOW, ...HOST_CONFIG });
  const ask = (method, params) => handleMcpRequest(state, { method, params });
  return {
    today: ask('get_day', { date: TODAY, include_native: false }),
    tomorrow: ask('get_day', { date: TOMORROW, include_native: false }),
    goals: ask('goal_progress', { window: 'all' }),
    inbox: ask('list_unscheduled', { filter: { scope: 'all', includeCompleted: false } }),
  };
}

const titles = (r) => r.data.blocks.map((b) => b.title);

describe('a GLANCEvault-client host, in plain Node', () => {
  const vault = createMemoryVault();
  const deviceA = createDevice('A', vault, deviceAData());
  const host = createDevice('host', vault, { ...HOST_SETTINGS });
  const expected = answers(deviceAData());

  it('runs with no browser globals at all', () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
    expect(typeof localStorage).toBe('undefined');
    expect(typeof indexedDB).toBe('undefined');
  });

  beforeAll(async () => {
    // Device A's first push: every row is new.
    setSyncPassphrase(PASSPHRASE);
    const engine = deviceA.start();
    for (const row of shredState(deviceA.data)) engine.markDirty(row.entityId);
    const pushed = await engine.pushDirtyRows();
    expect(pushed.written).toBe(shredState(deviceA.data).length);
    await endProcess();
  });

  it('Device A pushed ciphertext only, with its bookkeeping in the injected storage and its key in its slot', () => {
    const rows = vault.rows('dayglance');
    expect(rows.length).toBeGreaterThan(30);
    for (const r of rows) expect(r.envelope).not.toMatch(/Write report|Groceries|Plan trip/);
    expect([...deviceA.store.keys()].some((k) => k.startsWith('e2e-A-db-sync'))).toBe(true);
    expect(deviceA.keySlot.value).toEqual(expect.any(String));
  });

  it('the host pulls with the passphrase alone and answers exactly as Device A does', async () => {
    setSyncPassphrase(PASSPHRASE);
    expect(hasDbRootKey()).toBe(false);
    const pull = await hostPull(host);
    expect(pull.skipped).toBe(0);
    // The host derived the key itself (the vault's salt, its own slot), and
    // kept its cursor in its own storage.
    expect(host.keySlot.writes).toBe(1);
    expect(Number(host.store.get('e2e-host-db-sync-hwm'))).toBeGreaterThan(0);

    const got = answers(host.data);
    expect(got).toEqual(expected);
    // and the answers say something: the scoping, the occurrence edit, the tree
    expect(titles(got.today)).toEqual(expect.arrayContaining(['Stretch', 'Write report', 'Groceries', 'Call the plumber']));
    expect(titles(got.today)).not.toContain('Sam: yoga');
    expect(got.today.data.blocks.find((b) => b.title === 'Standup')).toMatchObject({ start_time: '08:45' });
    expect(titles(got.tomorrow)).toContain('Standup (short)');
    expect(got.goals.data.goals.map((g) => g.title)).toEqual(expect.arrayContaining(['Ship the website', 'Old goal']));
    expect(got.inbox.data.items.map((i) => i.title)).toEqual(expect.arrayContaining(['Plan trip', 'Draft outline']));
    expect(got.inbox.data.items.map((i) => i.title)).not.toContain('Learn piano');

    // What the read model does not show arrived too: the JOBO record, the
    // tombstone, the sticky fields, the routine completion's stamp.
    expect(host.data.joboRecords).toEqual([joboRecord]);
    expect(host.data.deletedTaskIds).toEqual({ 't-gone': GONE_AT });
    expect(host.data.tasks.find((t) => t.id === 't5')).toMatchObject({ archived: true, originalPlan: { date: TODAY, startTime: '08:00' } });
    expect(host.data.tasks.find((t) => t.id === 't1')).toMatchObject({ deferrals: 2 });
    expect(host.data.routineCompletionTimestamps).toEqual({ 'r-mine': at(42) });
  });

  it('a full read of the vault (decrypt every live row, reassembleState) answers the same', async () => {
    // The host's key is in memory from the pull above.
    const rows = [];
    for (const r of vault.rows('dayglance')) {
      if (r.deleted || r.entityId.startsWith('__glance_')) continue;
      rows.push({ entity: await decryptEntity(r.envelope, r.entityId) });
    }
    const data = { ...reassembleState(rows), ...HOST_SETTINGS };
    expect(answers(data)).toEqual(expected);
    await endProcess();
  });

  it('edits on Device A reach the host on its next pull: a completion, an occurrence change, a move, a delete', async () => {
    // Device A starts again from its key slot: no passphrase this time.
    expect(hasDbRootKey()).toBe(false);
    const engine = deviceA.start();
    const before = JSON.parse(JSON.stringify(deviceA.data));
    const d = deviceA.data;
    // Complete a task.
    Object.assign(d.tasks.find((t) => t.id === 't3'), { completed: true, completedAt: at(100), lastModified: at(100) });
    // Move today's standup, and complete it.
    const standup = d.recurringTasks[0];
    standup.exceptions = { ...standup.exceptions, [TODAY]: { startTime: '09:30' } };
    standup.exceptionsTimestamps = { ...standup.exceptionsTimestamps, [TODAY]: at(101) };
    standup.completedDates = [...standup.completedDates, TODAY];
    standup.completedDatesTimestamps = { ...standup.completedDatesTimestamps, [TODAY]: at(101) };
    standup.lastModified = at(101);
    // Delete a task outright: gone from its list, with a tombstone.
    d.tasks = d.tasks.filter((t) => t.id !== 't2');
    d.deletedTaskIds = { ...d.deletedTaskIds, t2: recently(0) };
    // Move a task to the bin. The app's snapshot guard holds a vanish-delete
    // it cannot prove back, so the vault keeps the stale tasks:t4 row here,
    // and the host is left holding t4 under two lists after its pull.
    const t4 = d.tasks.find((t) => t.id === 't4');
    d.tasks = d.tasks.filter((t) => t.id !== 't4');
    d.recycleBin = [...d.recycleBin, { ...t4, lastModified: at(102) }];
    markChanges(engine, before, d, { holdDeletes: ['tasks:t4'] });
    await engine.pushDirtyRows();
    expect(deviceA.keySlot.writes).toBe(1); // loaded from the slot, not derived again
    await endProcess();

    const listsBefore = vault.requests.filter((r) => r.path.endsWith('/list')).length;
    setSyncPassphrase(PASSPHRASE);
    const pull = await hostPull(host);
    expect(pull.applied).toBeGreaterThan(0);
    // The host resumed from its stored cursor, and its key came from its slot.
    const list = vault.requests.filter((r) => r.path.endsWith('/list'))[listsBefore];
    expect(Number(list.since)).toBeGreaterThan(0);
    expect(host.keySlot.writes).toBe(1);

    const got = answers(host.data);
    // What Device A itself answers now (its data holds the edits).
    expect(got).toEqual(answers(d));
    const today = got.today.data.blocks;
    expect(today.find((b) => b.title === 'Groceries')).toMatchObject({ completed: true });
    expect(today.find((b) => b.title === 'Standup')).toMatchObject({ completed: true, start_time: '09:30' });
    expect(titles(got.today)).not.toContain('Sam: dentist'); // deleted (and Sam's anyway)
    expect(host.data.tasks.some((t) => t.id === 't2')).toBe(false);
    expect(host.data.deletedTaskIds).toHaveProperty('t2');
    // The bin move: one copy, the newer one, in the bin.
    expect(titles(got.today)).not.toContain('Call the plumber');
    expect(host.data.tasks.some((t) => t.id === 't4')).toBe(false);
    expect(host.data.recycleBin.map((t) => t.id)).toContain('t4');
    // The tombstone for the stale tasks:t4 row is the host's to push: marked dirty.
    expect(host.engine.getDirtySet()).toContain('tasks:t4');
    // A tomorrow occurrence's edit made earlier is untouched by today's.
    expect(titles(got.tomorrow)).toContain('Standup (short)');
    await endProcess();
  });
});
