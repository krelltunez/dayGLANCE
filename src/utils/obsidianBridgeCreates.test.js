import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupDbRootKey, clearDbRootKey } from '@glance-apps/sync';
import { getDbRootKey } from '@glance-apps/sync/src/dbCrypto.js';
import {
  deriveBridgeSubkey,
  sealBridgeEnvelope,
  encodePlainBridgeRow,
  BRIDGE_ACTION_PREFIX,
  BRIDGE_CREATE_ACTION_PREFIX,
} from '@glance-apps/obsidian-format';
import {
  bridgeCreatedTaskId,
  sanitizeBridgeTaskTitle,
  buildBridgeCreatedTask,
  planBridgeTaskCreates,
  addBridgeCreatedTasks,
  readSavedTaskIds,
  fetchBridgeTaskCreates,
  runBridgeTaskCreatePass,
  CREATE_HWM_KEY,
} from './obsidianBridgeCreates.js';
import { fetchBridgeActions } from './obsidianBridgeActions.js';

// Tasks added from Obsidian (companion spec 4.2.1). The planner is pure and
// carries the data-safety rules: one task per action on any number of
// devices, never a resurrection, a plain app task, and the row deleted only
// once the task is saved. The end-to-end walk (plugin → stream → a
// folderless device) is the bridge harness's addTask.scenarios.test.ts.

vi.mock('./bridgeKeyGate.js', async () => {
  const { getDbRootKey } = await import('@glance-apps/sync/src/dbCrypto.js');
  return { verifiedBridgeRootKey: async () => getDbRootKey(), resetBridgeKeyGate: () => {} };
});

const NOW = Date.parse('2026-11-06T12:00:00.000Z');
const ACTION_ID = '0f8b7c2e-1d2a-4c3b-9e8f-0123456789ab';
const create = (over = {}) => ({
  v: 1, kind: 'action', type: 'task_create', actionId: ACTION_ID,
  title: 'Call the plumber [[Daily/2026-11-06]]', notePath: 'Daily/2026-11-06.md',
  createdAt: '2026-11-06T11:59:00+00:00', ...over,
});
const ID = `bridge-add-${ACTION_ID}`;
const plan = (actions, ctx = {}) => planBridgeTaskCreates(actions, { nowMs: NOW, ...ctx });

describe('the created task id', () => {
  it('is derived from the actionId alone, so every device builds the same one', () => {
    expect(bridgeCreatedTaskId(ACTION_ID)).toBe(ID);
    expect(bridgeCreatedTaskId(ACTION_ID)).toBe(bridgeCreatedTaskId(ACTION_ID));
    expect(bridgeCreatedTaskId('dgi-lx2k3-abcdefghij')).toBe('bridge-add-dgi-lx2k3-abcdefghij');
  });

  it('can never read as an Obsidian-import id', () => {
    expect(ID.startsWith('obsidian')).toBe(false);
    expect(/^obsidian-(\d{4}-\d{2}-\d{2})-/.test(ID)).toBe(false);
  });

  it('refuses an actionId a plugin does not mint (empty, too short, odd characters)', () => {
    for (const bad of [undefined, null, '', 'short', 'has space in it', 'a/b/c/d/e/f', 'x'.repeat(65), 42]) {
      expect(bridgeCreatedTaskId(bad)).toBe(null);
    }
  });
});

describe('the title', () => {
  it('is one trimmed line', () => {
    expect(sanitizeBridgeTaskTitle('  Buy\nmilk\r\n and   eggs  ')).toBe('Buy milk and eggs');
    expect(sanitizeBridgeTaskTitle(' \n ')).toBe('');
    expect(sanitizeBridgeTaskTitle(null)).toBe('');
  });

  it('loses the #obsidian command tag, never what a link names', () => {
    expect(sanitizeBridgeTaskTitle('Draft #obsidian intro #writing [[Notes/Plan]]')).toBe('Draft intro #writing [[Notes/Plan]]');
    expect(sanitizeBridgeTaskTitle('#Obsidian setup [[Notes/Plan]]')).toBe('setup [[Notes/Plan]]');
    expect(sanitizeBridgeTaskTitle('Read [[Notes/Plan#obsidian stuff]]')).toBe('Read [[Notes/Plan#obsidian stuff]]');
    expect(sanitizeBridgeTaskTitle('#obsidianish stays')).toBe('#obsidianish stays');
  });

  it('loses a stray ^dg- token outside the links, keeps a link to a stamped line', () => {
    expect(sanitizeBridgeTaskTitle('Fix gutter ^dg-8w230vhc [[Daily/2026-11-06#^dg-8w230vhc]]'))
      .toBe('Fix gutter [[Daily/2026-11-06#^dg-8w230vhc]]');
  });
});

describe('the task row', () => {
  it('is a plain inbox task, built the way the app builds one, stamped at the action', () => {
    const t = buildBridgeCreatedTask(create(), { nowMs: NOW });
    expect(t).toEqual({
      id: ID, title: 'Call the plumber [[Daily/2026-11-06]]', duration: 30, color: 'bg-blue-500',
      completed: false, isAllDay: false, notes: '', subtasks: [], priority: 0,
      createdAt: '2026-11-06T11:59:00+00:00', lastModified: '2026-11-06T11:59:00.000Z',
    });
    for (const k of ['importSource', 'obsidianBlockId', 'obsidianNotePath', 'obsidianFileDate', 'obsidianRawTitle', 'date', 'startTime']) {
      expect(t).not.toHaveProperty(k);
    }
  });

  it('a title carrying #obsidian is still a plain app task', () => {
    const t = buildBridgeCreatedTask(create({ title: 'Plan #obsidian trip [[Trips]]' }), { nowMs: NOW });
    expect(t.title).toBe('Plan trip [[Trips]]');
    expect(t).not.toHaveProperty('importSource');
    expect(t).not.toHaveProperty('obsidianBlockId');
  });

  it('a stamp from a fast clock elsewhere is clamped to now; an unreadable one is now, with createdAt left to the persist pass', () => {
    expect(buildBridgeCreatedTask(create({ createdAt: '2026-11-07T00:00:00Z' }), { nowMs: NOW }).lastModified).toBe(new Date(NOW).toISOString());
    const t = buildBridgeCreatedTask(create({ createdAt: 'yesterday' }), { nowMs: NOW });
    expect(t.lastModified).toBe(new Date(NOW).toISOString());
    expect(t).not.toHaveProperty('createdAt');
  });

  it('keeps a valid deadline and priority, drops invalid ones', () => {
    const ok = buildBridgeCreatedTask(create({ deadline: '2026-11-20', priority: 3 }), { nowMs: NOW });
    expect(ok).toMatchObject({ deadline: '2026-11-20', priority: 3 });
    for (const [deadline, priority] of [['2026-02-30', 4], ['20/11/2026', -1], [20261120, 1.5], ['', '2']]) {
      const t = buildBridgeCreatedTask(create({ deadline, priority }), { nowMs: NOW });
      expect(t).not.toHaveProperty('deadline');
      expect(t.priority).toBe(0);
    }
  });

  it('sets the project only when it exists and is active; otherwise drops it and still creates', () => {
    const projects = [
      { id: 'p1', title: 'House', status: 'active' },
      { id: 'p2', title: 'Old', status: 'archived' },
      { id: 'p3', title: 'Done', status: 'completed' },
    ];
    expect(buildBridgeCreatedTask(create({ projectId: 'p1' }), { projects, nowMs: NOW }).projectId).toBe('p1');
    for (const projectId of ['p2', 'p3', 'gone', '']) {
      const t = buildBridgeCreatedTask(create({ projectId }), { projects, nowMs: NOW });
      expect(t).toBeTruthy();
      expect(t).not.toHaveProperty('projectId');
    }
  });

  it('is the vault viewer\'s in a multi-user account, and only for a live member', () => {
    const users = [{ syncId: 'u-ann', name: 'Ann' }, { syncId: 'u-old', name: 'Old', deleted: true }];
    expect(buildBridgeCreatedTask(create({ viewer: 'u-ann' }), { users, multiUserEnabled: true, nowMs: NOW }).assignedUserSyncIds).toEqual(['u-ann']);
    expect(buildBridgeCreatedTask(create({ viewer: 'u-ann' }), { users, multiUserEnabled: false, nowMs: NOW })).not.toHaveProperty('assignedUserSyncIds');
    expect(buildBridgeCreatedTask(create({ viewer: 'u-old' }), { users, multiUserEnabled: true, nowMs: NOW })).not.toHaveProperty('assignedUserSyncIds');
    expect(buildBridgeCreatedTask(create({ viewer: 'u-nobody' }), { users, multiUserEnabled: true, nowMs: NOW })).not.toHaveProperty('assignedUserSyncIds');
  });
});

describe('planBridgeTaskCreates', () => {
  it('a new action is applied AND held: the row stays until the task is saved', () => {
    const p = plan([create()]);
    expect(p.apply).toHaveLength(1);
    expect(p.apply[0].task.id).toBe(ID);
    expect(p.hold).toEqual([create()]);
    expect(p.consume).toEqual([]);
  });

  it('created but not yet saved: held, not applied again; saved: consumed', () => {
    const inbox = [{ id: ID, title: 'x' }];
    const unsaved = plan([create()], { unscheduledTasks: inbox });
    expect(unsaved.apply).toEqual([]);
    expect(unsaved.hold).toHaveLength(1);
    const saved = plan([create()], { unscheduledTasks: inbox, persistedIds: new Set([ID]) });
    expect(saved.consume).toEqual([{ action: create(), reason: 'saved' }]);
    expect(saved.hold).toEqual([]);
  });

  it('a task that exists in ANY list (scheduled since, or completed) is never created again', () => {
    for (const ctx of [{ tasks: [{ id: ID, date: '2026-11-07' }] }, { unscheduledTasks: [{ id: ID, completed: true }] }, { recurringTasks: [{ id: ID }] }]) {
      const p = plan([create()], { ...ctx, persistedIds: new Set([ID]) });
      expect(p.apply).toEqual([]);
      expect(p.consume.map((c) => c.reason)).toEqual(['saved']);
    }
  });

  it('NO RESURRECTION: deleted, binned, or retired onto a successor → consumed without applying', () => {
    expect(plan([create()], { deletedTaskIds: { [ID]: '2026-11-06T12:00:00Z' } }).consume[0].reason).toBe('tombstoned');
    expect(plan([create()], { deletedObsidianKeys: { [ID]: '2026-11-06T12:00:00Z' } }).consume[0].reason).toBe('tombstoned');
    expect(plan([create()], { recycleBin: [{ id: ID }] }).consume[0].reason).toBe('binned');
    expect(plan([create()], { isRetired: (id) => id === ID }).consume[0].reason).toBe('retired');
    for (const ctx of [{ deletedTaskIds: { [ID]: 'x' } }, { recycleBin: [{ id: ID }] }, { isRetired: () => true }]) {
      const p = plan([create()], ctx);
      expect(p.apply).toEqual([]);
      expect(p.hold).toEqual([]);
    }
  });

  it('a row older than the tombstone window is consumed unapplied', () => {
    const p = plan([create({ createdAt: '2026-08-01T00:00:00Z' })]);
    expect(p.apply).toEqual([]);
    expect(p.consume[0].reason).toBe('expired');
    expect(plan([create({ createdAt: '2026-10-20T00:00:00Z' })]).apply).toHaveLength(1);
  });

  it('unusable actions are consumed, never held (they would wedge the cursor)', () => {
    const p = plan([create({ title: '  ' }), create({ actionId: 'x' }), create({ type: 'task_complete' }), null]);
    expect(p.apply).toEqual([]);
    expect(p.hold).toEqual([]);
    expect(p.consume.map((c) => c.reason)).toEqual(['invalid', 'invalid', 'invalid', 'invalid']);
  });

  it('two devices applying the same action build the same row', () => {
    const a = plan([create({ projectId: 'p1', deadline: '2026-11-20' })], { projects: [{ id: 'p1', status: 'active' }] }).apply[0].task;
    const b = plan([create({ projectId: 'p1', deadline: '2026-11-20' })], { projects: [{ id: 'p1', status: 'active' }], nowMs: NOW + 3_600_000 }).apply[0].task;
    expect(b).toEqual(a);
  });
});

describe('addBridgeCreatedTasks', () => {
  it('appends what the list lacks and returns the same array otherwise', () => {
    const t = buildBridgeCreatedTask(create(), { nowMs: NOW });
    const list = [{ id: 'a' }];
    const out = addBridgeCreatedTasks(list, [t]);
    expect(out.map((x) => x.id)).toEqual(['a', ID]);
    expect(addBridgeCreatedTasks(out, [t])).toBe(out);
    expect(addBridgeCreatedTasks(list, [])).toBe(list);
  });
});

// ── the stream: own prefix, own cursor, delete after save ─────────────────

const VAULT_CONFIG_KEY = 'dayglance-vault-config';
const SALT = new Uint8Array(16).fill(5);
const SALT_B64 = btoa(String.fromCharCode(...SALT));
const META = { v: 1, kind: 'pairing-meta', generation: SALT_B64, pairingSalt: SALT_B64, pairedAt: '2026-08-29T00:00:00Z' };
const nativeStub = { get: () => null, store: () => {} };

describe('the consumer on the stream', () => {
  let rows;
  let deletes;
  beforeEach(async () => {
    const store = {};
    globalThis.localStorage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    };
    localStorage.setItem(VAULT_CONFIG_KEY, JSON.stringify({ enabled: true, vaultUrl: 'https://vault.example', vaultToken: 'tok', accountId: 'acct-1' }));
    const { __resetBridgeStreamForTests } = await import('./obsidianBridgeStream.js');
    __resetBridgeStreamForTests();
    await setupDbRootKey('pw', new Uint8Array(16).fill(9), { nativeGetSyncKey: nativeStub.get, nativeStoreSyncKey: nativeStub.store });
    const subkey = await deriveBridgeSubkey(getDbRootKey(), SALT);
    rows = [
      { entityId: `${BRIDGE_ACTION_PREFIX}c1`, seq: 2, envelope: await sealBridgeEnvelope(subkey, { v: 1, kind: 'action', type: 'task_complete', actionId: 'c1', taskId: 't1', createdAt: '2026-11-06T11:00:00Z' }) },
      { entityId: `${BRIDGE_CREATE_ACTION_PREFIX}${ACTION_ID}`, seq: 3, envelope: await sealBridgeEnvelope(subkey, create()) },
    ];
    deletes = [];
    globalThis.fetch = async (url, init) => {
      if (init?.method === 'DELETE') { deletes.push(decodeURIComponent(new URL(url).pathname.split('/').pop())); return { ok: true, status: 200, json: async () => ({}) }; }
      if (url.includes('/meta')) return { ok: true, status: 200, json: async () => ({ entityId: 'meta:pairing', envelope: encodePlainBridgeRow(META) }) };
      if (url.includes('/list')) {
        const since = Number(new URL(url).searchParams.get('since')) || 0;
        return { ok: true, status: 200, json: async () => ({ rows: rows.filter((r) => r.seq > since), hasMore: false }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };
  });
  afterEach(async () => {
    await clearDbRootKey({ nativeGetSyncKey: nativeStub.get, nativeStoreSyncKey: nativeStub.store });
    delete globalThis.localStorage;
    delete globalThis.fetch;
  });

  it('each consumer reads only its own prefix: the completion fetch never sees a create, the create fetch never a completion', async () => {
    const creates = await fetchBridgeTaskCreates();
    expect(creates.actions.map((a) => a.actionId)).toEqual([ACTION_ID]);
    const completes = await fetchBridgeActions();
    expect(completes.actions.map((a) => a.actionId)).toEqual(['c1']);
  });

  it('DELETE AFTER SAVE: the first pass creates and holds; the row goes only once the task reads back from storage', async () => {
    let inbox = [];
    const pass = () => runBridgeTaskCreatePass({
      read: () => ({ tasks: [], unscheduledTasks: inbox, recurringTasks: [], recycleBin: [], projects: [], users: [], multiUserEnabled: false }),
      addToInbox: (created) => { inbox = addBridgeCreatedTasks(inbox, created); },
      nowMs: NOW,
    });
    expect(await pass()).toEqual({ applied: 1, held: 1, consumed: 0 });
    expect(inbox.map((t) => t.id)).toEqual([ID]);
    expect(deletes).toEqual([]);
    expect(Number(localStorage.getItem(CREATE_HWM_KEY))).toBe(2); // below the held row
    // Not saved yet (the app died before its persist pass, or it has not run):
    // the row stays, and nothing is created twice.
    expect(await pass()).toEqual({ applied: 0, held: 1, consumed: 0 });
    expect(inbox).toHaveLength(1);
    expect(deletes).toEqual([]);
    // Saved: consumed and deleted, the cursor passes it.
    localStorage.setItem('day-planner-unscheduled', JSON.stringify(inbox));
    expect(readSavedTaskIds().has(ID)).toBe(true);
    expect(await pass()).toEqual({ applied: 0, held: 0, consumed: 1 });
    expect(deletes).toEqual([`${BRIDGE_CREATE_ACTION_PREFIX}${ACTION_ID}`]);
    expect(Number(localStorage.getItem(CREATE_HWM_KEY))).toBe(3);
    // The completion row and the completion cursor were never touched.
    expect(localStorage.getItem('dayglance-bridge-act-hwm')).toBe(null);
  });

  it('a crash between the apply and the save replays the action on restart', async () => {
    const pass = (inbox) => runBridgeTaskCreatePass({
      read: () => ({ tasks: [], unscheduledTasks: inbox.list, recurringTasks: [], recycleBin: [], projects: [], users: [], multiUserEnabled: false }),
      addToInbox: (created) => { inbox.list = addBridgeCreatedTasks(inbox.list, created); },
      nowMs: NOW,
    });
    await pass({ list: [] }); // applied in memory, never saved
    const restarted = { list: [] }; // state reloaded from storage: no task
    expect(await pass(restarted)).toMatchObject({ applied: 1 });
    expect(restarted.list.map((t) => t.id)).toEqual([ID]);
  });
});
