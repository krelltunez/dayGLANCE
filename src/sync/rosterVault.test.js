import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./dbEngine.js', () => ({ nativeKeyConfig: () => ({}), vaultFetchImpl: () => undefined }));

import {
  ROSTER_VAULT_APP, applyRosterEntity, applyRosterDelete, getLocalRosterEntity,
  createRosterDbEngine, isUnknownAppError,
} from './rosterVault.js';

const T1 = '2026-10-01T10:00:00.000Z';
const T2 = '2026-10-02T10:00:00.000Z';
const T3 = '2026-10-03T10:00:00.000Z';

function memoryStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
const usersOf = (s) => JSON.parse(s.getItem('dayglance-users') || '[]');
const withUsers = (users, extra = {}) => memoryStorage({
  'dayglance-users': JSON.stringify(users), 'dayglance-multi-user-enabled': 'true', ...extra,
});

// A stand-in for createDbSyncEngine over one shared in-memory vault: a cycle
// pushes the dirty set (getLocalEntity null → soft-delete) and applies every
// row another device wrote since this one's cursor.
function fakeVault() {
  const rows = new Map(); // id -> { entity|null, seq, device }
  let seq = 0;
  const engines = [];
  const create = (cfg) => {
    const dirty = new Set();
    let cursor = 0;
    let lastSynced = null;
    const eng = {
      cfg,
      markDirty: (id) => dirty.add(id),
      getLastSynced: () => lastSynced,
      dbSyncCycle: async () => {
        for (const id of dirty) {
          const entity = await cfg.getLocalEntity(id);
          rows.set(id, { entity, seq: ++seq, device: cfg.deviceId });
        }
        dirty.clear();
        for (const [id, r] of [...rows.entries()].sort((a, b) => a[1].seq - b[1].seq)) {
          if (r.seq <= cursor || r.device === cfg.deviceId) continue;
          if (r.entity) await cfg.applyRemoteEntity(id, r.entity); else await cfg.applyRemoteDelete(id);
        }
        cursor = seq;
        lastSynced = `t${seq}`;
        return { applied: 0, skipped: 0, skippedEntityIds: [] };
      },
    };
    engines.push(eng);
    return eng;
  };
  return { rows, create, engines };
}

let devices = 0;
beforeEach(() => { devices = 0; });
const engineOn = (vault, storage, opts = {}) => {
  const n = ++devices;
  return createRosterDbEngine({
    storage,
    createEngine: (cfg) => vault.create({ ...cfg, deviceId: `device-${n}` }),
    ...opts,
  });
};

describe('household roster on GLANCEvault (glance-users)', () => {
  it('syncs the shared app every GLANCE app reads, in the SharedUser wire shape', () => {
    const vault = fakeVault();
    engineOn(vault, withUsers([]));
    expect(ROSTER_VAULT_APP).toBe('glance-users');
    expect(vault.engines[0].cfg.appId).toBe('glance-users');
    expect(vault.engines[0].cfg.vaultApp).toBe('glance-users');
    const s = withUsers([{ id: 'local-1', syncId: 'u1', name: 'Maggie', updatedAt: T1 }]);
    expect(getLocalRosterEntity(s, 'u1')).toEqual({ id: 'u1', name: 'Maggie', updatedAt: T1 });
    expect(getLocalRosterEntity(s, 'local-1')).toBeNull();
  });

  it('seeds the roster, then carries an add, a rename and a delete to another app', async () => {
    const vault = fakeVault();
    const a = withUsers([{ id: 'u1', syncId: 'u1', name: 'Jason', updatedAt: T1 }]);
    const b = withUsers([]);
    const applied = vi.fn();
    const ea = engineOn(vault, a);
    const eb = engineOn(vault, b, { onUsersApplied: applied });

    await ea.dbSyncCycle();
    await eb.dbSyncCycle();
    expect(usersOf(b)).toEqual([{ id: 'u1', syncId: 'u1', name: 'Jason', updatedAt: T1 }]);
    expect(applied).toHaveBeenCalledTimes(1);

    a.setItem('dayglance-users', JSON.stringify([
      { id: 'u1', syncId: 'u1', name: 'Jay', updatedAt: T2 },
      { id: 'u2', syncId: 'u2', name: 'Maggie', updatedAt: T2 },
    ]));
    await ea.dbSyncCycle();
    await eb.dbSyncCycle();
    expect(usersOf(b).map((u) => u.name).sort()).toEqual(['Jay', 'Maggie']);

    a.setItem('dayglance-users', JSON.stringify([
      { id: 'u1', syncId: 'u1', name: 'Jay', updatedAt: T2 },
      { id: 'u2', syncId: 'u2', name: 'Maggie', updatedAt: T3, deleted: true },
    ]));
    await ea.dbSyncCycle();
    await eb.dbSyncCycle();
    expect(usersOf(b).find((u) => u.syncId === 'u2')).toMatchObject({ deleted: true });
  });

  it('does not push back what it just pulled', async () => {
    const vault = fakeVault();
    const a = withUsers([{ id: 'u1', syncId: 'u1', name: 'Jason', updatedAt: T1 }]);
    const b = withUsers([]);
    const ea = engineOn(vault, a);
    const eb = engineOn(vault, b);
    await ea.dbSyncCycle();
    await eb.dbSyncCycle();
    const seqAfterPull = vault.rows.get('u1').seq;
    await eb.dbSyncCycle();
    expect(vault.rows.get('u1').seq).toBe(seqAfterPull);
  });

  it('idles while multi-user is off on this device', async () => {
    const vault = fakeVault();
    const s = withUsers([{ id: 'u1', syncId: 'u1', name: 'Jason', updatedAt: T1 }], { 'dayglance-multi-user-enabled': 'false' });
    await engineOn(vault, s).dbSyncCycle();
    expect(vault.rows.size).toBe(0);
  });

  it('keeps a newer local copy, a local deletion included', () => {
    const s = withUsers([
      { id: 'u1', syncId: 'u1', name: 'Mags', updatedAt: T2 },
      { id: 'u2', syncId: 'u2', name: 'Old', updatedAt: T3, deleted: true },
    ]);
    expect(applyRosterEntity(s, 'u1', { id: 'u1', name: 'Maggie', updatedAt: T1 })).toBe(false);
    expect(applyRosterEntity(s, 'u2', { id: 'u2', name: 'Old', updatedAt: T2 })).toBe(false);
    expect(applyRosterEntity(s, 'u1', { id: 'u2', name: 'Wrong', updatedAt: T3 })).toBe(false);
    expect(applyRosterEntity(s, 'u1', { id: 'u1', name: 'Margaret', updatedAt: T3 })).toBe(true);
    expect(usersOf(s)[0]).toEqual({ id: 'u1', syncId: 'u1', name: 'Margaret', updatedAt: T3 });
  });

  it('a re-add newer than the deletion brings the member back', () => {
    const s = withUsers([{ id: 'u1', syncId: 'u1', name: 'Maggie', updatedAt: T1, deleted: true }]);
    expect(applyRosterEntity(s, 'u1', { id: 'u1', name: 'Maggie', updatedAt: T2 })).toBe(true);
    expect(usersOf(s)[0].deleted).toBeUndefined();
    expect(applyRosterDelete(s, 'u1', () => T3)).toBe(true);
    expect(usersOf(s)[0]).toMatchObject({ deleted: true, updatedAt: T3 });
    expect(applyRosterDelete(s, 'u1')).toBe(false);
  });

  it('stands down on a server without glance-users and keeps the roster to offer later', async () => {
    expect(isUnknownAppError('list failed: 400')).toBe(true);
    expect(isUnknownAppError('list failed: 500')).toBe(false);
    const unsupported = vi.fn();
    const s = withUsers([{ id: 'u1', syncId: 'u1', name: 'Jason', updatedAt: T1 }]);
    let cfg;
    const eng = createRosterDbEngine({
      storage: s,
      onUnsupported: unsupported,
      createEngine: (c) => {
        cfg = c;
        return { markDirty: () => {}, getLastSynced: () => null, dbSyncCycle: async () => { c.onError('list failed: 400', 'HTTP'); return {}; } };
      },
    });
    await eng.dbSyncCycle();
    await eng.dbSyncCycle();
    expect(unsupported).toHaveBeenCalledTimes(1);
    expect(s.getItem('dayglance-glance-users-db-sync-snapshot')).toBeNull();
    expect(cfg.deviceId).toMatch(/-roster$/);
  });
});
