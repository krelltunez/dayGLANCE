import { describe, it, expect, vi } from 'vitest';
import { isConflictCopy, conflictCopiesIn, listConflictCopies, sweepConflictCopies, lastSweep, SNAPSHOT_FILENAME, USERS_FILENAME } from './conflictCopies.js';
import { mergeSyncData } from '../mergeSync.js';

// The copies a syncing tool leaves beside the Direct Access files, and the
// sweep that merges and removes them (docs/direct-access-sync.md, Phase 8).

const T0 = Date.parse('2026-10-10T21:00:00.000Z');
const task = (id, title, lastModified, extra = {}) => ({ id, title, date: '2026-10-10', completed: false, notes: '', subtasks: [], lastModified, ...extra });
const snapshot = (tasks, lastModified = '2026-10-10T17:17:47.000Z') => JSON.stringify({ version: 2, lastModified, data: { tasks, unscheduledTasks: [] } });

const makeStorage = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } }; };

/** A folder: `files` maps rel path → text (or a classification object). */
const fakeTransport = (files, { supported = true } = {}) => ({
  id: 'fake-da',
  lastSyncedKey: 'fake-da',
  files: {
    supported: () => supported,
    list: vi.fn(async (dir) => Object.keys(files).filter((k) => (dir ? k.startsWith(dir + '/') && !k.slice(dir.length + 1).includes('/') : !k.includes('/'))).map((k) => k.slice(dir ? dir.length + 1 : 0))),
    read: vi.fn(async (rel) => (rel in files ? (typeof files[rel] === 'string' ? files[rel] : JSON.stringify(files[rel])) : null)),
    remove: vi.fn(async (rel) => { delete files[rel]; return true; }),
  },
});

const io = (over = {}) => ({
  buildSyncPayload: () => ({ version: 2, data: { tasks: [task('a', 'A', '2026-10-10T10:00:00.000Z')], unscheduledTasks: [] } }),
  applyEngineData: vi.fn(),
  mergeSyncData,
  syncRetentionDays: 90,
  isEncryptedEnvelope: (v) => !!v && v.v === 1 && v.enc === 'AES-GCM-256',
  decryptData: vi.fn(async () => { const e = new Error('Encryption key not available'); e.code = 'PASSPHRASE_REQUIRED'; throw e; }),
  storage: makeStorage(),
  log: { info: vi.fn(), warn: vi.fn() },
  ...over,
});

describe('isConflictCopy', () => {
  it('recognises what each tool leaves beside the file, and nothing else', () => {
    for (const name of [
      'dayglance-sync (conflicted copy 2026-10-10 111717).json',   // Nextcloud
      "dayglance-sync (Jason's conflicted copy 2026-10-10).json",  // Dropbox
      'dayglance-sync (1).json',                                   // Google Drive
      'dayglance-sync.sync-conflict-20261010-111717-ABCDEFG.json', // Syncthing
      'dayglance-sync-DESKTOP-ABC123.json',                        // OneDrive
    ]) expect(isConflictCopy(name, SNAPSHOT_FILENAME), name).toBe(true);
    for (const name of ['dayglance-sync.json', 'dayglance-syncopated.json', 'dayglance-sync (1).json.bak', 'glance-users (1).json', 'notes.json', null]) {
      expect(isConflictCopy(name, SNAPSHOT_FILENAME), String(name)).toBe(false);
    }
    expect(isConflictCopy('glance-users (conflicted copy 2026-10-09 000033).json', USERS_FILENAME)).toBe(true);
    expect(conflictCopiesIn(['b (1).json', 'dayglance-sync (2).json', 'dayglance-sync (1).json'], SNAPSHOT_FILENAME)).toEqual(['dayglance-sync (1).json', 'dayglance-sync (2).json']);
    expect(conflictCopiesIn(null, SNAPSHOT_FILENAME)).toEqual([]);
  });
});

describe('listConflictCopies', () => {
  it('looks beside the snapshot, the roster and the event set, with their paths; null where the folder cannot be listed', async () => {
    const t = fakeTransport({
      'dayglance-sync.json': '{}',
      'dayglance-sync (1).json': '{}',
      'GLANCE/users/glance-users.json': '{}',
      'GLANCE/users/glance-users (conflicted copy 2026-10-09 000033).json': '{}',
      'GLANCE/events/glance-events.json': '{}',
      'GLANCE/events/glance-events.sync-conflict-1-X.json': '{}',
      'Shared/ev/glance-events (1).json': '{}',
    });
    expect(await listConflictCopies(t)).toEqual([
      { rel: 'dayglance-sync (1).json', name: 'dayglance-sync (1).json', kind: 'snapshot' },
      { rel: 'GLANCE/users/glance-users (conflicted copy 2026-10-09 000033).json', name: 'glance-users (conflicted copy 2026-10-09 000033).json', kind: 'roster' },
      { rel: 'GLANCE/events/glance-events.sync-conflict-1-X.json', name: 'glance-events.sync-conflict-1-X.json', kind: 'events' },
    ]);
    expect((await listConflictCopies(t, { eventsPath: '/Shared/ev/' })).map((c) => c.rel)).toContain('Shared/ev/glance-events (1).json');
    expect(await listConflictCopies(fakeTransport({}, { supported: false }))).toBeNull();
    expect(await listConflictCopies({ files: { supported: () => true, list: async () => null } })).toEqual([]);
  });
});

describe('sweepConflictCopies', () => {
  it('a snapshot copy with something newer is merged into this device (the live file is never touched) and removed; one with nothing newer is just removed', async () => {
    const files = {
      'dayglance-sync.json': snapshot([task('a', 'A', '2026-10-10T10:00:00.000Z')]),
      'dayglance-sync (conflicted copy 2026-10-10 111717).json': snapshot([task('a', 'A renamed on the laptop', '2026-10-10T11:00:00.000Z'), task('b', 'B', '2026-10-10T11:00:00.000Z')]),
      'dayglance-sync (conflicted copy 2026-10-10 113004).json': snapshot([task('a', 'A', '2026-10-10T09:00:00.000Z')]),
    };
    const t = fakeTransport(files);
    const i = io();
    const r = await sweepConflictCopies({ transport: t, io: i, now: () => T0 });
    expect(r.copies.map((c) => [c.name, c.outcome])).toEqual([
      ['dayglance-sync (conflicted copy 2026-10-10 111717).json', 'merged'],
      ['dayglance-sync (conflicted copy 2026-10-10 113004).json', 'removed'],
    ]);
    expect(i.applyEngineData).toHaveBeenCalledTimes(1);
    const applied = i.applyEngineData.mock.calls[0][0];
    expect(applied.tasks.map((x) => x.title).sort()).toEqual(['A renamed on the laptop', 'B']);
    expect(Object.keys(files)).toEqual(['dayglance-sync.json']);          // the live file untouched, the copies gone
    expect(lastSweep(i.storage, t)).toMatchObject({ at: '2026-10-10T21:00:00.000Z' });
    expect(lastSweep(i.storage, t).copies).toHaveLength(2);
  });

  it('guard: an encrypted copy this device cannot open is left where it is and reported; with the key it is merged', async () => {
    const sealed = { v: 1, enc: 'AES-GCM-256', data: 'abc' };
    const files = { 'dayglance-sync (1).json': sealed };
    const t = fakeTransport(files);
    const r = await sweepConflictCopies({ transport: t, io: io(), now: () => T0 });
    expect(r.copies[0]).toMatchObject({ outcome: 'needs-key' });
    expect(files['dayglance-sync (1).json']).toBe(sealed);
    const opened = io({ decryptData: async () => JSON.parse(snapshot([task('z', 'Z', '2026-10-10T12:00:00.000Z')])) });
    const r2 = await sweepConflictCopies({ transport: t, io: opened, now: () => T0 });
    expect(r2.copies[0].outcome).toBe('merged');
    expect(opened.applyEngineData).toHaveBeenCalled();
    expect(files['dayglance-sync (1).json']).toBeUndefined();
  });

  it('an events copy is removed without a merge; a roster copy is reconciled into the roster and removed', async () => {
    const files = {
      'GLANCE/events/glance-events (1).json': JSON.stringify({ version: 1, events: [{ event_id: 'x' }] }),
      'GLANCE/users/glance-users (1).json': JSON.stringify({ version: 1, users: [{ id: 'u1', name: 'Ann (renamed)', updatedAt: '2026-10-10T12:00:00.000Z' }], updated_at: 'x' }),
    };
    const t = fakeTransport(files);
    const applyUsers = vi.fn();
    const r = await sweepConflictCopies({ transport: t, io: io({ localUsers: [{ syncId: 'u1', name: 'Ann', updatedAt: '2026-10-01T00:00:00.000Z' }], applyUsers }), now: () => T0 });
    expect(r.copies.map((c) => [c.kind, c.outcome])).toEqual([['roster', 'merged'], ['events', 'removed']]);
    expect(applyUsers).toHaveBeenCalledTimes(1);
    expect(applyUsers.mock.calls[0][0][0].name).toBe('Ann (renamed)');
    expect(t.files.read).not.toHaveBeenCalledWith('GLANCE/events/glance-events (1).json');
    expect(Object.keys(files)).toEqual([]);
  });

  it('a copy still being delivered waits; garbage is removed; a failed removal is reported and nothing is lost', async () => {
    const files = {
      'dayglance-sync (1).json': '{"downloading":true}',
      'dayglance-sync (2).json': '{"version":2,"da',
      'dayglance-sync (3).json': snapshot([task('q', 'Q', '2026-10-10T12:00:00.000Z')]),
    };
    const t = fakeTransport(files);
    t.files.remove = vi.fn(async (rel) => { if (rel.includes('(3)')) return false; delete files[rel]; return true; });
    const i = io();
    const r = await sweepConflictCopies({ transport: t, io: i, now: () => T0 });
    expect(r.copies.map((c) => [c.name, c.outcome])).toEqual([
      ['dayglance-sync (1).json', 'downloading'],
      ['dayglance-sync (2).json', 'removed'],
      ['dayglance-sync (3).json', 'remove-failed'],
    ]);
    expect(i.applyEngineData).toHaveBeenCalledTimes(1);                   // (3) was merged before the removal failed
    expect(files['dayglance-sync (1).json']).toBeDefined();
    // Without a listing (iPhone) the sweep does nothing and says so.
    expect(await sweepConflictCopies({ transport: fakeTransport({}, { supported: false }), io: io(), now: () => T0 })).toBeNull();
  });

  it('a throwing read is a row, not a crash, and the other copies are still swept', async () => {
    const files = { 'dayglance-sync (1).json': 'x', 'dayglance-sync (2).json': snapshot([]) };
    const t = fakeTransport(files);
    const read = t.files.read;
    t.files.read = vi.fn(async (rel) => { if (rel.includes('(1)')) throw new Error('bridge gone'); return read(rel); });
    const r = await sweepConflictCopies({ transport: t, io: io(), now: () => T0 });
    expect(r.copies.map((c) => c.outcome)).toEqual(['unreadable', 'removed']);
    expect(r.copies[0].detail).toBe('bridge gone');
  });
});
