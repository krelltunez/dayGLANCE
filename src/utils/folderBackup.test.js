import { describe, it, expect } from 'vitest';
import {
  LIVE_BACKUP_FILENAME,
  payloadHasData,
  snapshotFilename,
  listSnapshots,
  pruneSnapshots,
  readLiveBackup,
  writeLiveBackup,
  writeSnapshotBackup,
} from './folderBackup.js';

// Minimal in-memory FileSystemDirectoryHandle: just the surface folderBackup.js
// drives (entries/getFileHandle/removeEntry, file read + atomic-ish write).
function makeDirHandle(files = {}) {
  const store = new Map(Object.entries(files));
  return {
    kind: 'directory',
    name: 'TestFolder',
    async *entries() {
      for (const name of store.keys()) yield [name, { kind: 'file' }];
    },
    async getFileHandle(name, opts) {
      if (!store.has(name)) {
        if (!opts?.create) {
          const e = new Error(`${name} not found`);
          e.name = 'NotFoundError';
          throw e;
        }
        store.set(name, '');
      }
      return {
        kind: 'file',
        async getFile() {
          return { text: async () => store.get(name) };
        },
        async createWritable() {
          let buf = '';
          return {
            write: async (chunk) => { buf += chunk; },
            close: async () => { store.set(name, buf); },
          };
        },
      };
    },
    async removeEntry(name) {
      if (!store.delete(name)) {
        const e = new Error(`${name} not found`);
        e.name = 'NotFoundError';
        throw e;
      }
    },
    _store: store,
  };
}

const payloadWith = (data) => ({ type: 'auto-backup', version: 1, timestamp: '2026-07-19T09:00:00.000Z', data });

describe('payloadHasData', () => {
  it('is false for null, missing data, and empty collections', () => {
    expect(payloadHasData(null)).toBe(false);
    expect(payloadHasData({})).toBe(false);
    expect(payloadHasData(payloadWith({}))).toBe(false);
    expect(payloadHasData(payloadWith({
      tasks: [], unscheduledTasks: [], habits: [], goals: [], routineDefinitions: { morning: [] },
    }))).toBe(false);
  });

  it('is true when any user collection has entries', () => {
    expect(payloadHasData(payloadWith({ tasks: [{ id: 1 }] }))).toBe(true);
    expect(payloadHasData(payloadWith({ tasks: [], habits: [{ id: 'h' }] }))).toBe(true);
    expect(payloadHasData(payloadWith({ recycleBin: [{ id: 1 }] }))).toBe(true);
    expect(payloadHasData(payloadWith({ routineDefinitions: { morning: [{ id: 'r' }] } }))).toBe(true);
  });
});

describe('snapshotFilename', () => {
  it('formats a zero-padded local timestamp that sorts chronologically', () => {
    const name = snapshotFilename(new Date(2026, 0, 5, 7, 3));
    expect(name).toBe('dayglance-backup-2026-01-05-0703.json');
    const later = snapshotFilename(new Date(2026, 0, 5, 12, 0));
    expect([later, name].sort()).toEqual([name, later]);
  });
});

describe('live file read/write', () => {
  it('round-trips a payload through the live file', async () => {
    const dir = makeDirHandle();
    const payload = payloadWith({ tasks: [{ id: 1, title: 'write me' }] });
    await writeLiveBackup(dir, payload);
    expect(await readLiveBackup(dir)).toEqual(payload);
  });

  it('returns null when the live file is missing or corrupt', async () => {
    expect(await readLiveBackup(makeDirHandle())).toBe(null);
    const corrupt = makeDirHandle({ [LIVE_BACKUP_FILENAME]: '{not json' });
    expect(await readLiveBackup(corrupt)).toBe(null);
  });
});

describe('snapshots', () => {
  it('lists only snapshot-named files, newest first', async () => {
    const dir = makeDirHandle({
      [LIVE_BACKUP_FILENAME]: '{}',
      'dayglance-backup-2026-07-18-0900.json': '{}',
      'dayglance-backup-2026-07-19-0900.json': '{}',
      'unrelated.json': '{}',
      // Manual exports use the date-only name; they are not snapshots and
      // must never be pruned.
      'dayglance-backup-2026-07-19.json': '{}',
    });
    expect(await listSnapshots(dir)).toEqual([
      'dayglance-backup-2026-07-19-0900.json',
      'dayglance-backup-2026-07-18-0900.json',
    ]);
  });

  it('prunes oldest snapshots beyond the retention count', async () => {
    const dir = makeDirHandle({
      'dayglance-backup-2026-07-16-0900.json': '{}',
      'dayglance-backup-2026-07-17-0900.json': '{}',
      'dayglance-backup-2026-07-18-0900.json': '{}',
    });
    const kept = await pruneSnapshots(dir, 2);
    expect(kept).toEqual([
      'dayglance-backup-2026-07-18-0900.json',
      'dayglance-backup-2026-07-17-0900.json',
    ]);
    expect(dir._store.has('dayglance-backup-2026-07-16-0900.json')).toBe(false);
  });

  it('writeSnapshotBackup writes the snapshot then applies retention', async () => {
    const dir = makeDirHandle({
      'dayglance-backup-2026-07-17-0900.json': '{}',
      'dayglance-backup-2026-07-18-0900.json': '{}',
    });
    await writeSnapshotBackup(dir, payloadWith({ tasks: [{ id: 1 }] }), 2, new Date(2026, 6, 19, 9, 0));
    expect([...dir._store.keys()].sort()).toEqual([
      'dayglance-backup-2026-07-18-0900.json',
      'dayglance-backup-2026-07-19-0900.json',
    ]);
    expect(JSON.parse(dir._store.get('dayglance-backup-2026-07-19-0900.json')).data.tasks).toHaveLength(1);
  });
});
