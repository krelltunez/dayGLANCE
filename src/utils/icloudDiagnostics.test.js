import { describe, it, expect, vi } from 'vitest';
import {
  collectICloudDiagnostics,
  classifySnapshot,
  detectPlatform,
  probeAvailability,
  readLocalState,
  formatBytes,
  formatDiagnosticsReport,
  utf8Bytes,
} from './icloudDiagnostics.js';

const payload = (over = {}) => JSON.stringify({
  version: 2,
  lastModified: '2026-08-07T12:00:00.000Z',
  data: { tasks: [{ id: 1 }, { id: 2 }], unscheduledTasks: [{ id: 3 }] },
  ...over,
});

const fakeLocalStorage = (map = {}) => ({ getItem: (k) => (k in map ? map[k] : null) });

// ── detectPlatform ─────────────────────────────────────────────────────────

describe('detectPlatform', () => {
  it('detects iOS from the native bridge', () => {
    expect(detectPlatform({ nativeBridge: { iCloudAvailable: () => '{}' } })).toBe('ios');
  });

  it('detects macOS from the electron API', () => {
    expect(detectPlatform({ electronAPI: { readICloud: async () => null } })).toBe('macos');
  });

  it('prefers iOS when somehow both are present', () => {
    expect(detectPlatform({
      nativeBridge: { iCloudAvailable: () => '{}' },
      electronAPI: { readICloud: async () => null },
    })).toBe('ios');
  });

  it('reports none on Android/web', () => {
    expect(detectPlatform({})).toBe('none');
  });
});

// ── probeAvailability ──────────────────────────────────────────────────────

describe('probeAvailability', () => {
  // The reading the whole feature exists for.
  it('reports true when the container resolves', () => {
    const r = probeAvailability({ nativeBridge: { iCloudAvailable: () => '{"available":true}' } });
    expect(r.value).toBe(true);
    expect(r.raw).toBe('{"available":true}');
    expect(r.error).toBeNull();
  });

  it('reports false when the container does not resolve', () => {
    expect(probeAvailability({ nativeBridge: { iCloudAvailable: () => '{"available":false}' } }).value).toBe(false);
  });

  it('treats an error payload as unavailable and keeps the message', () => {
    const r = probeAvailability({ nativeBridge: { iCloudAvailable: () => '{"error":"iCloud not available"}' } });
    expect(r.value).toBe(false);
    expect(r.error).toBe('iCloud not available');
  });

  it('returns null (not false) when the probe is unavailable on this platform', () => {
    const r = probeAvailability({});
    expect(r.value).toBeNull();
    expect(r.error).toBeNull();
  });

  it('returns null and the message when the bridge throws', () => {
    const r = probeAvailability({ nativeBridge: { iCloudAvailable: () => { throw new Error('bridge down'); } } });
    expect(r.value).toBeNull();
    expect(r.error).toBe('bridge down');
  });

  it('returns null on unparseable output rather than guessing', () => {
    expect(probeAvailability({ nativeBridge: { iCloudAvailable: () => 'not json' } }).value).toBeNull();
  });
});

// ── classifySnapshot ───────────────────────────────────────────────────────

describe('classifySnapshot', () => {
  it('parses a present snapshot with counts and timestamp', () => {
    const s = classifySnapshot(payload());
    expect(s.state).toBe('present');
    expect(s.taskCount).toBe(2);
    expect(s.inboxCount).toBe(1);
    expect(s.lastModified).toBe('2026-08-07T12:00:00.000Z');
    expect(s.version).toBe(2);
    expect(s.bytes).toBeGreaterThan(0);
  });

  it.each([['null'], [''], [null], [undefined]])('treats %p as absent', (raw) => {
    expect(classifySnapshot(raw).state).toBe('absent');
  });

  it('detects the downloading sentinel', () => {
    expect(classifySnapshot('{"downloading":true}').state).toBe('downloading');
  });

  it('detects the error sentinel and keeps the message', () => {
    const s = classifySnapshot('{"error":"iCloud not available"}');
    expect(s.state).toBe('error');
    expect(s.error).toBe('iCloud not available');
  });

  // A corrupt file still means the file EXISTS, which is the fact under
  // investigation — so it must not be reported as absent.
  it('reports unparseable bytes as an error while still counting them', () => {
    const s = classifySnapshot('{"data": trunc');
    expect(s.state).toBe('error');
    expect(s.bytes).toBeGreaterThan(0);
    expect(s.error).toMatch(/unparseable/);
  });

  it('leaves counts null when data arrays are missing', () => {
    const s = classifySnapshot(JSON.stringify({ version: 2, data: {} }));
    expect(s.state).toBe('present');
    expect(s.taskCount).toBeNull();
    expect(s.inboxCount).toBeNull();
  });
});

// ── readLocalState ─────────────────────────────────────────────────────────

describe('readLocalState', () => {
  it('counts local tasks and reads the sync record', () => {
    const r = readLocalState({
      localStorage: fakeLocalStorage({
        'day-planner-tasks': '[{"id":1},{"id":2},{"id":3}]',
        'day-planner-unscheduled': '[{"id":4}]',
        'day-planner-cloud-sync-last-synced': '2026-08-07T10:00:00.000Z',
      }),
    });
    expect(r).toEqual({ taskCount: 3, inboxCount: 1, lastSynced: '2026-08-07T10:00:00.000Z' });
  });

  it('reports zeroes and never-synced on an empty store', () => {
    expect(readLocalState({ localStorage: fakeLocalStorage() }))
      .toEqual({ taskCount: 0, inboxCount: 0, lastSynced: null });
  });

  it('survives corrupt JSON in storage', () => {
    const r = readLocalState({ localStorage: fakeLocalStorage({ 'day-planner-tasks': '{oops' }) });
    expect(r.taskCount).toBe(0);
  });

  it('survives storage access throwing', () => {
    const r = readLocalState({ localStorage: { getItem: () => { throw new Error('denied'); } } });
    expect(r).toEqual({ taskCount: 0, inboxCount: 0, lastSynced: null });
  });
});

// ── byte helpers ───────────────────────────────────────────────────────────

describe('utf8Bytes / formatBytes', () => {
  it('counts UTF-8 bytes, not UTF-16 code units', () => {
    expect(utf8Bytes('abc')).toBe(3);
    expect(utf8Bytes('🎉')).toBe(4);   // str.length would say 2
    expect(utf8Bytes('é')).toBe(2);    // str.length would say 1
  });

  it('formats across unit boundaries', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(NaN)).toBe('—');
  });
});

// ── collectICloudDiagnostics ───────────────────────────────────────────────

describe('collectICloudDiagnostics', () => {
  it('gathers a full iOS report', async () => {
    const r = await collectICloudDiagnostics({
      nativeBridge: {
        iCloudAvailable: () => '{"available":true}',
        readICloudSync: () => payload(),
      },
      localStorage: fakeLocalStorage({ 'day-planner-tasks': '[{"id":1}]' }),
    });
    expect(r.platform).toBe('ios');
    expect(r.available.value).toBe(true);
    expect(r.snapshot.state).toBe('present');
    expect(r.snapshot.taskCount).toBe(2);
    expect(r.local.taskCount).toBe(1);
  });

  // The exact signature of the suspected bug: the app resolves a container and
  // finds a populated file on a device where the user turned iCloud off.
  it('captures container-available-with-data, the state under investigation', async () => {
    const r = await collectICloudDiagnostics({
      nativeBridge: {
        iCloudAvailable: () => '{"available":true}',
        readICloudSync: () => payload(),
      },
      localStorage: fakeLocalStorage(),
    });
    expect(r.available.value).toBe(true);
    expect(r.snapshot.state).toBe('present');
    expect(r.snapshot.taskCount).toBeGreaterThan(0);
    expect(r.local.taskCount).toBe(0);
  });

  it('gathers a macOS report and awaits the async read', async () => {
    const r = await collectICloudDiagnostics({
      electronAPI: { readICloud: async () => payload() },
      localStorage: fakeLocalStorage(),
    });
    expect(r.platform).toBe('macos');
    expect(r.available.value).toBeNull();   // not probeable on macOS
    expect(r.snapshot.state).toBe('present');
  });

  it('reports unsupported on Android/web without touching bridges', async () => {
    const r = await collectICloudDiagnostics({ localStorage: fakeLocalStorage() });
    expect(r.platform).toBe('none');
    expect(r.snapshot.state).toBe('unsupported');
  });

  it('captures a throwing read instead of rejecting', async () => {
    const r = await collectICloudDiagnostics({
      nativeBridge: {
        iCloudAvailable: () => '{"available":true}',
        readICloudSync: () => { throw new Error('bridge exploded'); },
      },
      localStorage: fakeLocalStorage(),
    });
    expect(r.snapshot.state).toBe('error');
    expect(r.snapshot.error).toBe('bridge exploded');
  });

  it('never writes, deletes, or triggers a sync', async () => {
    const writeICloudSync = vi.fn();
    const iCloudDeleteFile = vi.fn();
    const iCloudWriteFile = vi.fn();
    await collectICloudDiagnostics({
      nativeBridge: {
        iCloudAvailable: () => '{"available":true}',
        readICloudSync: () => payload(),
        writeICloudSync, iCloudDeleteFile, iCloudWriteFile,
      },
      localStorage: fakeLocalStorage(),
    });
    expect(writeICloudSync).not.toHaveBeenCalled();
    expect(iCloudDeleteFile).not.toHaveBeenCalled();
    expect(iCloudWriteFile).not.toHaveBeenCalled();
  });
});

// ── formatDiagnosticsReport ────────────────────────────────────────────────

describe('formatDiagnosticsReport', () => {
  it('renders the available-container case in copyable form', async () => {
    const r = await collectICloudDiagnostics({
      nativeBridge: {
        iCloudAvailable: () => '{"available":true}',
        readICloudSync: () => payload(),
      },
      localStorage: fakeLocalStorage({ 'day-planner-tasks': '[{"id":1}]' }),
    });
    const text = formatDiagnosticsReport(r);
    expect(text).toMatch(/platform:\s+ios/);
    expect(text).toMatch(/container:\s+AVAILABLE/);
    expect(text).toMatch(/snapshot file:\s+present/);
    expect(text).toMatch(/tasks\/inbox:\s+2 \/ 1/);
    expect(text).toMatch(/last synced:\s+never/);
  });

  it('says so plainly when the platform cannot probe availability', () => {
    const text = formatDiagnosticsReport({
      platform: 'macos',
      available: { value: null, raw: null, error: null },
      snapshot: { state: 'absent', bytes: 0, lastModified: null, taskCount: null, inboxCount: null, error: null },
      local: { taskCount: 0, inboxCount: 0, lastSynced: null },
    });
    expect(text).toMatch(/not probeable on this platform/);
  });
});
