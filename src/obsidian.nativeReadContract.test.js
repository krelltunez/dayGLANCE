import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  syncObsidianVaultNative,
  writeTaskStateNative,
  appendTaskToDailyNoteNative,
} from './obsidian.js';
import { nativeGetNote, nativeGetTasksFromNote } from './native.js';
import { detectObsidianDeletions } from './utils/obsidianDeletions.js';

// The native READ contract — the read-side twin of the write contract
// (obsidian.nativeWriteContract.test.js): a read that FAILED must be
// distinguishable from a read that legitimately found nothing, because the
// vault scan feeds the deletion detector. Signals: getDailyNote null (Android
// nullable return / iOS 500→null via the XHR shim) = failed; batch reads
// return a JSON OBJECT {"error":…} where success is an ARRAY (survives the
// iOS string transport, which cannot carry booleans or exceptions).

const NOTE = '## Tasks\n- [ ] Buy milk\n- [ ] Walk dog\n';

function installBridge(overrides = {}) {
  const bridge = {
    getAllDailyNotes: vi.fn(() => JSON.stringify([{ date: '2026-08-28', text: NOTE, lastModified: '2026-08-28T10:00:00.000Z' }])),
    getDailyNote: vi.fn(() => NOTE),
    writeDailyNote: vi.fn(() => true),
    listNotes: vi.fn(() => JSON.stringify(['2026-08-28.md'])),
    getNote: vi.fn(() => JSON.stringify({ text: 'hi', lastModified: '2026-08-28T10:00:00.000Z' })),
    getTasksFromNote: vi.fn(() => JSON.stringify([])),
    ...overrides,
  };
  global.window = { DayGlanceObsidian: bridge };
  return bridge;
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  delete global.window;
  vi.restoreAllMocks();
});

describe('syncObsidianVaultNative — the scan fails loudly on failed reads', () => {
  it('a healthy scan resolves with notes and tasks', async () => {
    installBridge();
    const r = await syncObsidianVaultNative('', 0, [], []);
    expect(r.dailyNotes['2026-08-28'].text).toBe(NOTE);
    expect(r.scheduledTasks.length + r.inboxTasks.length).toBe(2);
  });

  it('an iOS-style error envelope (object, not array) REJECTS the scan', async () => {
    installBridge({ getAllDailyNotes: vi.fn(() => JSON.stringify({ error: 'vault access failed — the stored folder bookmark could not be opened' })) });
    await expect(syncObsidianVaultNative('', 0, [], [])).rejects.toThrow(/vault access failed/);
  });

  it('an Android-style thrown read (revoked grant, unreadable note) REJECTS the scan', async () => {
    installBridge({ getAllDailyNotes: vi.fn(() => { throw new Error('Vault access has been revoked — re-select the vault folder in Settings'); }) });
    await expect(syncObsidianVaultNative('', 0, [], [])).rejects.toThrow(/revoked/);
  });

  it('async path: a dispatched error REJECTS the scan', async () => {
    installBridge({
      getAllDailyNotesAsync: vi.fn((folder, cutoff, id) => {
        setTimeout(() => {
          const cb = global.window.__obsidianCbs[id];
          delete global.window.__obsidianCbs[id];
          cb(null, 'Could not read daily note 2026-08-28.md from the vault');
        }, 0);
      }),
    });
    await expect(syncObsidianVaultNative('', 0, [], [])).rejects.toThrow(/Could not read daily note/);
  });

  it('async path: an error-envelope result REJECTS the scan', async () => {
    installBridge({
      getAllDailyNotesAsync: vi.fn((folder, cutoff, id) => {
        setTimeout(() => {
          const cb = global.window.__obsidianCbs[id];
          delete global.window.__obsidianCbs[id];
          cb(JSON.stringify({ error: 'could not read daily note 2026-08-28.md from the vault' }), null);
        }, 0);
      }),
    });
    await expect(syncObsidianVaultNative('', 0, [], [])).rejects.toThrow(/could not read/);
  });

  it('legacy fallback: a LISTED note whose read returns null REJECTS the scan instead of silently vanishing', async () => {
    installBridge({
      getAllDailyNotes: undefined,
      getAllDailyNotesAsync: undefined,
      getDailyNote: vi.fn(() => null),
    });
    await expect(syncObsidianVaultNative('', 0, [], [])).rejects.toThrow(/Could not read daily note 2026-08-28/);
  });
});

describe('write paths refuse to act on a failed read', () => {
  it('writeTaskStateNative: null daily note → false, nothing written', () => {
    const bridge = installBridge({ getDailyNote: vi.fn(() => null) });
    expect(writeTaskStateNative('2026-08-28', 'Buy milk', true, null)).toBe(false);
    expect(bridge.writeDailyNote).not.toHaveBeenCalled();
  });

  it('appendTaskToDailyNoteNative: null daily note → false, nothing written (a template fallback would overwrite the unreadable note)', () => {
    const bridge = installBridge({ getDailyNote: vi.fn(() => null) });
    const ok = appendTaskToDailyNoteNative('2026-08-28', { title: 'New' }, '## Tasks', '# My Template');
    expect(ok).toBe(false);
    expect(bridge.writeDailyNote).not.toHaveBeenCalled();
  });

  it('appendTaskToDailyNoteNative: "" (determinately absent/empty) still appends', () => {
    const bridge = installBridge({ getDailyNote: vi.fn(() => '') });
    expect(appendTaskToDailyNoteNative('2026-08-28', { title: 'New' }, '## Tasks', '')).toBe(true);
    expect(bridge.writeDailyNote).toHaveBeenCalledTimes(1);
    expect(bridge.writeDailyNote.mock.calls[0][1]).toContain('New');
  });
});

describe('wiki-note read wrappers surface the failure envelope as null, never as content', () => {
  it('nativeGetNote: {"error":…} → null (logged), success object passes', () => {
    installBridge({ getNote: vi.fn(() => JSON.stringify({ error: 'note read failed' })) });
    expect(nativeGetNote('My Note')).toBeNull();
    expect(console.warn).toHaveBeenCalled();
    installBridge({ getNote: vi.fn(() => JSON.stringify({ text: 'content', lastModified: 'x' })) });
    expect(nativeGetNote('My Note')).toEqual({ text: 'content', lastModified: 'x' });
  });

  it('nativeGetTasksFromNote: non-array → null, array passes', () => {
    installBridge({ getTasksFromNote: vi.fn(() => JSON.stringify({ error: 'note read failed' })) });
    expect(nativeGetTasksFromNote('My Note')).toBeNull();
    installBridge({ getTasksFromNote: vi.fn(() => JSON.stringify([{ text: 'a', completed: false, line: 1 }])) });
    expect(nativeGetTasksFromNote('My Note')).toEqual([{ text: 'a', completed: false, line: 1 }]);
  });
});

describe('why reads must fail loudly: the detector tombstones a silently-emptied note', () => {
  it('a note read as "" keeps its note key but loses its task keys — and within the drop threshold those keys WOULD be tombstoned', () => {
    // The pre-fix hazard, pinned as documentation: this is what a silent ""
    // read fed the detector. The fully-empty scan is caught ('empty-scan'),
    // and a huge drop is caught ('drop-too-large') — but a PARTIAL silent
    // failure walks right through and its deletions would sync fleet-wide.
    const lastScanned = ['2026-08-28', 'obsidian-2026-08-28-h1', 'obsidian-2026-08-28-h2', '2026-08-27', 'obsidian-2026-08-27-h3'];
    const currentWithSilentEmptyRead = ['2026-08-28', '2026-08-27', 'obsidian-2026-08-27-h3']; // 28th read as "" — note key present, task keys gone
    const { deletions, skipped } = detectObsidianDeletions(lastScanned, currentWithSilentEmptyRead, null);
    expect(skipped).toBe(false);
    expect(deletions).toEqual(['obsidian-2026-08-28-h1', 'obsidian-2026-08-28-h2']);
    // Post-fix, this input can no longer be PRODUCED by a failed read: every
    // native read path above throws or returns null instead of "".
  });
});
