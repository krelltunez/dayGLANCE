import { describe, it, expect, vi } from 'vitest';
import {
  collectICloudDiagnostics,
  classifySnapshot,
  probeDirectAccess,
  detectPlatform,
  detectDevicePlatform,
  dryRunMerge,
  probeAvailability,
  readLocalState,
  formatBytes,
  formatDiagnosticsReport,
  readSyncTransports,
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
    expect(detectPlatform({ electronAPI: { platform: 'darwin', readICloud: async () => null } })).toBe('macos');
  });

  it('prefers iOS when somehow both are present', () => {
    expect(detectPlatform({
      nativeBridge: { iCloudAvailable: () => '{}' },
      electronAPI: { platform: 'darwin', readICloud: async () => null },
    })).toBe('ios');
  });

  it('reports none on Android/web', () => {
    expect(detectPlatform({})).toBe('none');
  });

  // The preload exposes readICloud on every Electron platform, but the main
  // process only serves it on darwin — Windows/Linux must not claim macOS.
  it('reports none on Windows/Linux Electron despite the exposed API', () => {
    expect(detectPlatform({ electronAPI: { platform: 'win32', readICloud: async () => null } })).toBe('none');
    expect(detectPlatform({ electronAPI: { platform: 'linux', readICloud: async () => null } })).toBe('none');
  });
});

describe('detectDevicePlatform', () => {
  // The report's first line is the device, not the iCloud bridge: an Android
  // phone printed "platform: none" (2026-10-08).
  it('names every shell', () => {
    expect(detectDevicePlatform({ isIOS: true, nativeBridge: {} })).toBe('ios');
    expect(detectDevicePlatform({ nativeBridge: { iCloudAvailable: () => '{}' } })).toBe('ios');
    expect(detectDevicePlatform({ nativeBridge: {} })).toBe('android');
    expect(detectDevicePlatform({ electronAPI: { platform: 'darwin' } })).toBe('macos');
    expect(detectDevicePlatform({ electronAPI: { platform: 'win32' } })).toBe('windows');
    expect(detectDevicePlatform({ electronAPI: { platform: 'linux' } })).toBe('linux');
    expect(detectDevicePlatform({})).toBe('web');
    expect(detectDevicePlatform()).toBe('web');
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

  // Regression: a sentinel is the bridge's status object, not file content.
  // Reporting its length made an unavailable container look like a 32-byte file.
  it('reports no size for sentinel responses', () => {
    expect(classifySnapshot('{"error":"iCloud not available"}').bytes).toBe(0);
    expect(classifySnapshot('{"downloading":true}').bytes).toBe(0);
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

// ── readSyncTransports ─────────────────────────────────────────────────────

describe('readSyncTransports', () => {
  it('reports both tiers unconfigured on a bare store', () => {
    const r = readSyncTransports({ localStorage: fakeLocalStorage() });
    expect(r.webdav).toEqual({ configured: false, provider: null, lastSynced: null });
    expect(r.vault).toMatchObject({ configured: false, lastSynced: null, hasConfig: false });
    expect(r.icloud).toEqual({ lastSynced: null });
  });

  // iCloud's record is its own key. Reading the WebDAV one is the bug that made
  // an iCloud-only device report "never" no matter how much it had synced.
  it("reports iCloud's own sync record, not the WebDAV one", () => {
    const r = readSyncTransports({
      localStorage: fakeLocalStorage({
        'dayglance-icloud-last-synced': '2026-08-08T11:00:00.000Z',
        'day-planner-cloud-sync-last-synced': '2020-01-01T00:00:00.000Z',
      }),
    });
    expect(r.icloud.lastSynced).toBe('2026-08-08T11:00:00.000Z');
    expect(r.webdav.lastSynced).toBe('2020-01-01T00:00:00.000Z');
  });

  it('reports a configured WebDAV tier with provider and record', () => {
    const r = readSyncTransports({
      localStorage: fakeLocalStorage({
        'day-planner-cloud-sync-config': '{"enabled":true,"provider":"nextcloud"}',
        'day-planner-cloud-sync-last-synced': '2026-08-08T09:00:00.000Z',
      }),
    });
    expect(r.webdav).toEqual({
      configured: true, provider: 'nextcloud', lastSynced: '2026-08-08T09:00:00.000Z',
    });
  });

  it('does not count a WebDAV config that exists but is disabled', () => {
    const r = readSyncTransports({
      localStorage: fakeLocalStorage({ 'day-planner-cloud-sync-config': '{"enabled":false,"provider":"koofr"}' }),
    });
    expect(r.webdav.configured).toBe(false);
  });

  // Mirrors isVaultEnabled(): every field must be present, not just `enabled`.
  it('requires a complete vault config, not just the enabled flag', () => {
    const partial = readSyncTransports({
      localStorage: fakeLocalStorage({ 'dayglance-vault-config': '{"enabled":true,"vaultUrl":"https://v"}' }),
    });
    expect(partial.vault.configured).toBe(false);

    const complete = readSyncTransports({
      localStorage: fakeLocalStorage({
        'dayglance-vault-config': '{"enabled":true,"vaultUrl":"https://v","vaultToken":"t","accountId":"a"}',
        'dayglance-vault-db-sync-last-synced': '2026-08-08T10:00:00.000Z',
      }),
    });
    expect(complete.vault).toMatchObject({ configured: true, lastSynced: '2026-08-08T10:00:00.000Z' });
  });

  // The phone whose vault read "never" for months (2026-10-06): the report has
  // to say WHICH of the four gate fields is missing, and what the engine's own
  // persisted state looks like, or the line cannot be acted on.
  it('names the missing vault config field and reads the engine\'s persisted state', () => {
    const r = readSyncTransports({
      localStorage: fakeLocalStorage({
        'dayglance-vault-config': '{"enabled":true,"vaultUrl":"https://vault.example.net/api","vaultToken":"t"}',
        'dayglance-vault-db-sync-hwm': '4812',
        'dayglance-vault-db-sync-push-ack': '4790',
        'dayglance-vault-db-sync-dirty': '["a","b"]',
        'dayglance-vault-db-sync-quarantine': '[{"id":"q"}]',
        'dayglance-vault-db-sync-credential-halt': '{"message":"token rejected","at":"2026-09-01T00:00:00.000Z"}',
      }),
    });
    expect(r.vault).toMatchObject({
      configured: false, hasConfig: true, enabled: true, hasUrl: true, hasToken: true, hasAccountId: false,
      host: 'vault.example.net', highWaterMark: '4812', pushAck: '4790', dirtyCount: 2, quarantineCount: 1,
      credentialHalt: { message: 'token rejected', at: '2026-09-01T00:00:00.000Z' },
    });
    const text = formatDiagnosticsReport({
      platform: 'none', available: { value: null }, snapshot: { state: 'unsupported', bytes: 0 },
      local: { taskCount: 1, inboxCount: 0 }, transports: { icloud: {}, webdav: {}, vault: r.vault }, syncEnabled: true,
    });
    expect(text).toMatch(/config:\s+enabled yes \/ url yes \(vault.example.net\) \/ token yes \/ account id NO/);
    expect(text).toMatch(/cursor:\s+pull 4812 \/ push ack 4790/);
    expect(text).toMatch(/rows:\s+2 pending \/ 1 quarantined/);
    expect(text).toMatch(/credential halt: 2026-09-01T00:00:00.000Z token rejected/);
  });

  it('a device with no vault config says so in one line, and a healthy one prints no halt', () => {
    const none = readSyncTransports({ localStorage: fakeLocalStorage() });
    const t1 = formatDiagnosticsReport({
      platform: 'none', available: { value: null }, snapshot: { state: 'unsupported', bytes: 0 },
      local: { taskCount: 0, inboxCount: 0 }, transports: { icloud: {}, webdav: {}, vault: none.vault }, syncEnabled: true,
    });
    expect(t1).toMatch(/config:\s+\(none saved on this device\)/);
    const ok = readSyncTransports({
      localStorage: fakeLocalStorage({
        'dayglance-vault-config': '{"enabled":true,"vaultUrl":"https://v","vaultToken":"t","accountId":"a"}',
        'dayglance-vault-db-sync-last-synced': '2026-10-06T10:00:00.000Z',
      }),
    });
    const t2 = formatDiagnosticsReport({
      platform: 'none', available: { value: null }, snapshot: { state: 'unsupported', bytes: 0 },
      local: { taskCount: 0, inboxCount: 0 }, transports: { icloud: {}, webdav: {}, vault: ok.vault }, syncEnabled: true,
    });
    expect(t2).toMatch(/glancevault:\s+configured/);
    expect(t2).not.toMatch(/credential halt/);
  });

  it('survives corrupt config JSON and throwing storage', () => {
    expect(readSyncTransports({ localStorage: fakeLocalStorage({ 'dayglance-vault-config': '{oops' }) }).vault.configured).toBe(false);
    expect(readSyncTransports({ localStorage: { getItem: () => { throw new Error('denied'); } } }).webdav.configured).toBe(false);
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
    expect(formatBytes(-1)).toBe('(none)');
    expect(formatBytes(NaN)).toBe('(none)');
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

  // A device can resolve the container perfectly and still be deliberately not
  // syncing (#1333's "start fresh"). Reporting only availability shows that as
  // healthy, which is the state the panel most needs to distinguish.
  it('reports the in-app sync preference alongside availability', async () => {
    const bridge = {
      iCloudAvailable: () => '{"available":true}',
      readICloudSync: () => payload(),
    };
    const on = await collectICloudDiagnostics({
      nativeBridge: bridge, localStorage: fakeLocalStorage(),
    });
    expect(on.syncEnabled).toBe(true);          // absence of a preference means on

    const off = await collectICloudDiagnostics({
      nativeBridge: bridge,
      localStorage: fakeLocalStorage({ 'dayglance-icloud-sync-enabled': 'false' }),
    });
    expect(off.syncEnabled).toBe(false);
    expect(off.available.value).toBe(true);     // container fine, sync off anyway
    expect(formatDiagnosticsReport(off)).toMatch(/sync on device:\s+OFF/);
  });

  it('gathers a macOS report and awaits the async read', async () => {
    const r = await collectICloudDiagnostics({
      electronAPI: { platform: 'darwin', readICloud: async () => payload() },
      localStorage: fakeLocalStorage(),
    });
    expect(r.platform).toBe('macos');
    expect(r.available.value).toBeNull();   // not probeable on macOS
    expect(r.snapshot.state).toBe('present');
  });

  it('reports unsupported on Android/web without touching bridges, and names the device', async () => {
    const r = await collectICloudDiagnostics({ localStorage: fakeLocalStorage() });
    expect(r.platform).toBe('web');
    expect(r.icloudPlatform).toBe('none');
    expect(r.icloud).toBe(false);
    expect(r.snapshot.state).toBe('unsupported');
    const android = await collectICloudDiagnostics({ nativeBridge: {}, localStorage: fakeLocalStorage() });
    expect(android).toMatchObject({ platform: 'android', icloudPlatform: 'none', icloud: false });
    expect(formatDiagnosticsReport(android)).toMatch(/^dayGLANCE sync diagnostics\nplatform: +android\nwebdav sync:/);
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

// ── probeDirectAccess ──────────────────────────────────────────────────────

const fakeDirectAccess = ({ supported = true, status = 'connected', name = 'GLANCE', enabled = true, read = async () => payload() } = {}) => ({
  stripsHealthLogs: false,
  isSupported: () => supported,
  getSnapshot: () => ({ supported, status, name, enabled, connected: status === 'connected' || status === 'unreachable' }),
  read: vi.fn(read),
  write: vi.fn(),
  deleteSnapshot: vi.fn(),
});

describe('probeDirectAccess', () => {
  const data = { tasks: [{ id: 1, title: 'a', lastModified: '2026-10-01T00:00:00.000Z' }], unscheduledTasks: [] };
  const quiet = (l, r) => ({ data: r, localChanged: false, remoteChanged: false });

  it('is absent on a platform without the bridge, and never reads a folder that is not connected', async () => {
    expect(await probeDirectAccess({ directAccess: null })).toBeNull();
    expect(await probeDirectAccess({ directAccess: fakeDirectAccess({ supported: false }) })).toBeNull();
    const off = fakeDirectAccess({ status: 'disconnected', name: null });
    expect(await probeDirectAccess({ directAccess: off })).toEqual({ status: 'disconnected', name: null, enabled: true, encrypt: false, keyReady: null, pickError: null, native: null, roster: null, events: null, conflicts: null, lastSweep: null, snapshot: null, merge: null });
    expect(off.read).not.toHaveBeenCalled();
  });

  it('carries the last pick failure and the shell\'s own status into the report (the iPhone pick that did nothing, 2026-10-08)', async () => {
    const t = fakeDirectAccess({ status: 'disconnected', name: null });
    t.getSnapshot = () => ({ supported: true, status: 'disconnected', name: null, enabled: true, connected: false, pickError: 'bookmark: permission denied (/Nextcloud/dg)' });
    t.probeStatus = async () => ({ configured: false, name: null, path: null, reachable: false });
    const r = await probeDirectAccess({ directAccess: t });
    expect(r.pickError).toBe('bookmark: permission denied (/Nextcloud/dg)');
    expect(r.native).toEqual({ configured: false, name: null, path: null, reachable: false });
    const text = formatDiagnosticsReport({
      platform: 'ios', icloud: false, available: { value: null }, snapshot: { state: 'unsupported', bytes: 0 },
      local: { taskCount: 1, inboxCount: 0 }, transports: { icloud: {}, webdav: {}, vault: {} }, syncEnabled: true, directAccess: r,
    });
    expect(text).toMatch(/direct access: +not connected\n  sync on device: on\n  last pick: +FAILED: bookmark: permission denied \(\/Nextcloud\/dg\)\n  shell status: +\{"configured":false/);
    // An iPhone's roster file has its own line; a folder platform has none.
    t.getSnapshot = () => ({ supported: true, status: 'disconnected', name: null, enabled: true, connected: false, roster: { configured: true, name: 'glance-users.json', reachable: true } });
    const withRoster = formatDiagnosticsReport({
      platform: 'ios', icloud: false, available: { value: null }, snapshot: { state: 'unsupported', bytes: 0 },
      local: { taskCount: 1, inboxCount: 0 }, transports: { icloud: {}, webdav: {}, vault: {} }, syncEnabled: true, directAccess: await probeDirectAccess({ directAccess: t }),
    });
    expect(withRoster).toMatch(/roster file: +chosen \(glance-users.json\)/);
    const withEvents = formatDiagnosticsReport({
      platform: 'ios', icloud: false, available: { value: null }, snapshot: { state: 'unsupported', bytes: 0 },
      local: { taskCount: 1, inboxCount: 0 }, transports: { icloud: {}, webdav: {}, vault: {} }, syncEnabled: true,
      directAccess: { status: 'connected', name: 'dayglance-sync.json', enabled: true, pickError: null, native: null, roster: null, events: { configured: false, name: null, path: null, reachable: false }, snapshot: null, merge: null },
    });
    expect(withEvents).toMatch(/events file: +not chosen/);
    expect(withEvents).not.toMatch(/roster file/);
    // A transport without the probe, or with nothing to report, prints neither line.
    const plain = formatDiagnosticsReport({
      platform: 'ios', icloud: false, available: { value: null }, snapshot: { state: 'unsupported', bytes: 0 },
      local: { taskCount: 1, inboxCount: 0 }, transports: { icloud: {}, webdav: {}, vault: {} }, syncEnabled: true,
      directAccess: { status: 'disconnected', name: null, enabled: true, pickError: null, native: null, snapshot: null, merge: null },
    });
    expect(plain).not.toMatch(/last pick|shell status|roster file/);
  });

  it('Phase 6: reports an envelope, decrypts it for the dry run when the device has the key, and says whether the key is ready', async () => {
    const seal = (p) => JSON.stringify({ v: 1, enc: 'AES-GCM-256', data: Buffer.from(JSON.stringify(p)).toString('base64') });
    const open = async (e) => JSON.parse(Buffer.from(e.data, 'base64').toString());
    const t = fakeDirectAccess({ read: async () => seal({ version: 2, lastModified: 'x', data }) });
    t.getSnapshot = () => ({ supported: true, status: 'connected', name: 'GLANCE', enabled: true, connected: true, encrypt: true });
    // With the key: the counts and the dry run come from the plaintext; the row still says it is an envelope.
    const withKey = await probeDirectAccess({ directAccess: t, buildSyncPayload: () => ({ data }), merge: quiet, decryptData: open, encryptionReady: () => true });
    expect(withKey).toMatchObject({ encrypt: true, keyReady: true, snapshot: { state: 'present', encrypted: true, taskCount: 1, lastModified: 'x' }, merge: { wouldWrite: false } });
    expect(withKey.snapshot.bytes).toBeGreaterThan(0);
    // Without: the envelope is reported as such, nothing is merged, and the key row says what to do.
    const noKey = await probeDirectAccess({ directAccess: t, buildSyncPayload: () => ({ data }), merge: quiet, decryptData: async () => { const e = new Error('Encryption key not available'); e.code = 'PASSPHRASE_REQUIRED'; throw e; }, encryptionReady: () => false });
    expect(noKey).toMatchObject({ keyReady: false, snapshot: { state: 'present', encrypted: true, taskCount: null }, merge: null });
    expect(noKey.snapshot.error).toMatch(/cannot decrypt/);
    // A caller without crypto (older callers, tests) gets the envelope row and no key row.
    const bare = await probeDirectAccess({ directAccess: t, buildSyncPayload: () => ({ data }), merge: quiet });
    expect(bare).toMatchObject({ keyReady: null, snapshot: { encrypted: true }, merge: null });
    const text = formatDiagnosticsReport({
      platform: 'macos', icloud: false, available: { value: null }, snapshot: { state: 'unsupported', bytes: 0 },
      local: { taskCount: 1, inboxCount: 0 }, transports: { icloud: {}, webdav: {}, vault: {} }, syncEnabled: true, directAccess: noKey,
    });
    expect(text).toMatch(/encryption: +envelope\n  encrypt switch: on\n  key: +needed/);
    const plainText = formatDiagnosticsReport({
      platform: 'macos', icloud: false, available: { value: null }, snapshot: { state: 'unsupported', bytes: 0 },
      local: { taskCount: 1, inboxCount: 0 }, transports: { icloud: {}, webdav: {}, vault: {} }, syncEnabled: true,
      directAccess: await probeDirectAccess({ directAccess: fakeDirectAccess({ read: async () => JSON.stringify({ version: 2, lastModified: 'x', data }) }), buildSyncPayload: () => ({ data }), merge: quiet, encryptionReady: () => true }),
    });
    expect(plainText).toMatch(/encryption: +plaintext\n  encrypt switch: off\n  key: +ready/);
  });

  it('reads the connected folder through the transport and dry-runs the merge on it', async () => {
    const t = fakeDirectAccess({ read: async () => JSON.stringify({ version: 2, lastModified: 'x', data }) });
    const r = await probeDirectAccess({ directAccess: t, buildSyncPayload: () => ({ data }), merge: quiet });
    expect(r.status).toBe('connected');
    expect(r.name).toBe('GLANCE');
    expect(r.snapshot.state).toBe('present');
    expect(r.snapshot.taskCount).toBe(1);
    expect(r.merge).toMatchObject({ wouldWrite: false, wouldApply: false, fileDiffs: [] });
    expect(t.write).not.toHaveBeenCalled();
    expect(t.deleteSnapshot).not.toHaveBeenCalled();
  });

  it('names the slice this device would rewrite, which is the question the panel exists to answer', async () => {
    const edited = { ...data, tasks: [{ ...data.tasks[0], title: 'b', lastModified: '2026-10-05T01:00:00.000Z' }] };
    const t = fakeDirectAccess({ read: async () => JSON.stringify({ version: 2, lastModified: 'x', data }) });
    const r = await probeDirectAccess({ directAccess: t, buildSyncPayload: () => ({ data: edited }), merge: (l) => ({ data: l, localChanged: false, remoteChanged: true }) });
    expect(r.merge.wouldWrite).toBe(true);
    expect(r.merge.fileDiffs.map((d) => d.summary)).toEqual(['tasks: 1 changed (1: lastModified, title)']);
  });

  it('maps the transport contract: absent, downloading, error, a throwing read, an unreachable folder', async () => {
    expect((await probeDirectAccess({ directAccess: fakeDirectAccess({ read: async () => null }) })).snapshot.state).toBe('absent');
    expect((await probeDirectAccess({ directAccess: fakeDirectAccess({ read: async () => '{"downloading":true}' }) })).snapshot.state).toBe('downloading');
    const err = await probeDirectAccess({ directAccess: fakeDirectAccess({ read: async () => '{"error":"folder unavailable"}' }) });
    expect(err.snapshot).toMatchObject({ state: 'error', error: 'folder unavailable' });
    const thrown = await probeDirectAccess({ directAccess: fakeDirectAccess({ read: async () => { throw new Error('bridge gone'); } }) });
    expect(thrown.snapshot).toMatchObject({ state: 'error', error: 'bridge gone' });
    const unreachable = await probeDirectAccess({ directAccess: fakeDirectAccess({ status: 'unreachable', read: async () => '{"error":"ENOENT"}' }) });
    expect(unreachable.status).toBe('unreachable');
    expect(unreachable.snapshot.state).toBe('error');
  });

  it('rides along in the full report, and the text report carries its own block', async () => {
    const r = await collectICloudDiagnostics({
      electronAPI: { platform: 'darwin', readICloud: async () => payload() },
      localStorage: fakeLocalStorage(),
      buildSyncPayload: () => ({ data }),
      merge: quiet,
      directAccess: fakeDirectAccess({ read: async () => JSON.stringify({ version: 2, lastModified: '2026-10-05T18:00:00.000Z', data }) }),
    });
    expect(r.directAccess.status).toBe('connected');
    const text = formatDiagnosticsReport(r);
    expect(text).toMatch(/direct access:\s+connected \(GLANCE\)/);
    expect(text).toMatch(/\n  file:\s+present/);
    expect(text).toMatch(/\n    lastModified:\s+2026-10-05T18:00:00.000Z/);
    expect(text).toMatch(/\n  merge dry-run:\s+would write: no \/ would apply: no/);

    const off = formatDiagnosticsReport({ ...r, directAccess: { status: 'disconnected', name: null, enabled: true, snapshot: null, merge: null } });
    expect(off).toMatch(/direct access:\s+not connected/);
    expect(off).not.toMatch(/\n  file:/);
    expect(formatDiagnosticsReport({ ...r, directAccess: null })).not.toMatch(/direct access:/);
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
    expect(text).toMatch(/webdav sync:\s+not configured/);
    expect(text).toMatch(/glancevault:\s+not configured/);
  });

  // The shape of the real report that closed this investigation: container
  // unavailable, no network tier configured, yet a full local dataset.
  it('shows an unavailable container with no transports and local data intact', async () => {
    const r = await collectICloudDiagnostics({
      nativeBridge: {
        iCloudAvailable: () => '{"available":false}',
        readICloudSync: () => '{"error":"iCloud not available"}',
      },
      localStorage: fakeLocalStorage({
        'day-planner-tasks': JSON.stringify(Array.from({ length: 543 }, (_, i) => ({ id: i }))),
        'day-planner-unscheduled': JSON.stringify(Array.from({ length: 373 }, (_, i) => ({ id: i }))),
      }),
    });
    const text = formatDiagnosticsReport(r);
    expect(text).toMatch(/container:\s+unavailable/);
    expect(text).toMatch(/webdav sync:\s+not configured/);
    expect(text).toMatch(/glancevault:\s+not configured/);
    expect(text).toMatch(/local tasks:\s+543/);
    // No size line: the sentinel is not a file.
    expect(text).not.toMatch(/size:/);
  });

  it('prints the iCloud block only where iCloud exists', () => {
    const base = {
      available: { value: null, raw: null, error: null },
      snapshot: { state: 'unsupported', bytes: 0, lastModified: null, taskCount: null, inboxCount: null, error: null },
      local: { taskCount: 3, inboxCount: 1 }, transports: { icloud: {}, webdav: {}, vault: {} }, syncEnabled: true,
      merge: { remoteChanged: false, localChanged: false, wouldWrite: false, wouldApply: false, fileDiffs: [], deviceDiffs: [], flagWithoutDiff: false },
    };
    const android = formatDiagnosticsReport({ ...base, platform: 'android', icloud: false });
    expect(android).toMatch(/^dayGLANCE sync diagnostics\nplatform: +android\nwebdav sync:/);
    for (const gone of ['container:', 'snapshot file:', 'sync on device:', 'icloud synced:', 'merge dry-run:']) expect(android).not.toContain(gone);
    expect(android).toMatch(/glancevault:/);
    expect(android).toMatch(/local tasks: +3/);
    const mac = formatDiagnosticsReport({ ...base, platform: 'macos', icloud: true });
    for (const kept of ['container:', 'snapshot file:', 'sync on device:', 'icloud synced:', 'merge dry-run:']) expect(mac).toContain(kept);
    // A report built without the flag keeps the block.
    expect(formatDiagnosticsReport({ ...base, platform: 'macos' })).toContain('container:');
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

// ── dryRunMerge ────────────────────────────────────────────────────────────

describe('dryRunMerge', () => {
  const data = { tasks: [{ id: 1, title: 'a', lastModified: '2026-10-01T00:00:00.000Z' }], unscheduledTasks: [] };
  const file = JSON.stringify({ version: 2, lastModified: '2026-10-05T00:00:00.000Z', data });
  const quiet = (l, r) => ({ data: r, localChanged: false, remoteChanged: false });

  it('is skipped without a payload builder, a snapshot, or data', () => {
    expect(dryRunMerge(file, { merge: quiet })).toBeNull();
    expect(dryRunMerge('{"downloading":true}', { buildSyncPayload: () => ({ data }), merge: quiet })).toBeNull();
    expect(dryRunMerge('{"version":2}', { buildSyncPayload: () => ({ data }), merge: quiet })).toBeNull();
    expect(dryRunMerge('not json', { buildSyncPayload: () => ({ data }), merge: quiet })).toBeNull();
  });

  it('runs the injected merge with the device payload, the file data and the retention', () => {
    const merge = vi.fn((l, r) => ({ data: r, localChanged: false, remoteChanged: false }));
    const r = dryRunMerge(file, { buildSyncPayload: () => ({ data }), getSyncRetentionDays: () => 30, merge });
    expect(merge).toHaveBeenCalledWith(data, data, 30);
    expect(r).toMatchObject({ remoteChanged: false, localChanged: false, fileDiffs: [], deviceDiffs: [], flagWithoutDiff: false });
  });

  it('names the slice a write would change', () => {
    const edited = { tasks: [{ id: 1, title: 'b', lastModified: '2026-10-05T01:00:00.000Z' }], unscheduledTasks: [] };
    const merge = (l) => ({ data: l, localChanged: false, remoteChanged: true });
    const r = dryRunMerge(file, { buildSyncPayload: () => ({ data: edited }), merge });
    expect(r.remoteChanged).toBe(true);
    expect(r.fileDiffs.map((d) => d.summary)).toEqual(['tasks: 1 changed (1: lastModified, title)']);
    expect(r.flagWithoutDiff).toBe(false);
  });

  it('strips HealthKit-derived counts before asking whether the file would change', () => {
    // The 2026-10-05 case: the device holds counts the file never carries.
    const habits = [{ id: 'steps', name: 'Steps', source: 'healthKit' }];
    const withCounts = { ...data, habits, habitLogs: { '2026-10-01': { steps: 8000 } } };
    const onFile = JSON.stringify({ version: 2, lastModified: '2026-10-02T00:00:00.000Z', data: { ...data, habits, habitLogs: {} } });
    const merge = (l) => ({ data: l, localChanged: false, remoteChanged: true });
    const r = dryRunMerge(onFile, { buildSyncPayload: () => ({ data: withCounts }), merge });
    expect(r.remoteChanged).toBe(true);
    expect(r.fileDiffs).toEqual([]);
    expect(r.wouldWrite).toBe(false);
    expect(r.flagWithoutDiff).toBe(true);
  });

  it('asked for a transport that carries health counts, the same counts ARE a write (Direct Access)', () => {
    const habits = [{ id: 'steps', name: 'Steps', source: 'healthConnect' }];
    const withCounts = { ...data, habits, habitLogs: { '2026-10-07': { steps: 6543 } } };
    const onFile = JSON.stringify({ version: 2, lastModified: '2026-10-02T00:00:00.000Z', data: { ...data, habits, habitLogs: {} } });
    const merge = (l) => ({ data: l, localChanged: false, remoteChanged: true });
    const r = dryRunMerge(onFile, { buildSyncPayload: () => ({ data: withCounts }), merge }, { stripsHealthLogs: false });
    expect(r.wouldWrite).toBe(true);
    expect(r.fileDiffs.map((d) => d.key)).toEqual(['habitLogs']);
    // The default is the iCloud question.
    expect(dryRunMerge(onFile, { buildSyncPayload: () => ({ data: withCounts }), merge }).wouldWrite).toBe(false);
  });

  it('a payload builder that throws is reported, not thrown', () => {
    const r = dryRunMerge(file, { buildSyncPayload: () => { throw new Error('no state'); }, merge: quiet });
    expect(r.error).toBe('payload: no state');
  });

  it('the text report carries the dry-run lines', () => {
    const base = { platform: 'macos', available: { value: null }, snapshot: { state: 'present', bytes: 10, lastModified: 'x', taskCount: 1, inboxCount: 0 },
      local: { taskCount: 1, inboxCount: 0 }, transports: { icloud: {}, webdav: {}, vault: {} }, syncEnabled: true };
    const text = formatDiagnosticsReport({ ...base, merge: { remoteChanged: true, localChanged: false, wouldWrite: true, wouldApply: false, fileDiffs: [{ summary: 'tasks: 1 changed (1)' }], deviceDiffs: [], flagWithoutDiff: false } });
    expect(text).toContain('merge dry-run:   would write: YES / would apply: no');
    expect(text).toContain('merge flags:   write YES / apply no');
    expect(text).toContain('file differs:  tasks: 1 changed (1)');
    // The effective decision, not the merge's flag, is what the headline shows.
    const flagged = formatDiagnosticsReport({ ...base, merge: { remoteChanged: true, localChanged: false, wouldWrite: false, wouldApply: false, fileDiffs: [], deviceDiffs: [], flagWithoutDiff: true } });
    expect(flagged).toContain('merge dry-run:   would write: no / would apply: no');
    expect(flagged).toContain('merge flags:   write YES / apply no');
    expect(flagged).toContain('the write is skipped');
    // The flag is named. An apply flag with no device difference is not a write (Mac over Direct Access, 2026-10-08).
    const applyOnly = formatDiagnosticsReport({ ...base, merge: { remoteChanged: false, localChanged: true, wouldWrite: false, wouldApply: false, fileDiffs: [], deviceDiffs: [], writeFlagWithoutDiff: false, applyFlagWithoutDiff: true, flagWithoutDiff: true } });
    expect(applyOnly).toContain('flagged an apply although nothing would change on this device; the apply is skipped');
    expect(applyOnly).not.toContain('flagged a write');
    const both = formatDiagnosticsReport({ ...base, merge: { remoteChanged: true, localChanged: true, wouldWrite: false, wouldApply: false, fileDiffs: [], deviceDiffs: [], writeFlagWithoutDiff: true, applyFlagWithoutDiff: true, flagWithoutDiff: true } });
    expect(both).toContain('flagged a write and an apply');
    expect(formatDiagnosticsReport(base)).toContain('dayGLANCE sync diagnostics');
    expect(formatDiagnosticsReport(base)).not.toContain('merge dry-run');
  });
});

describe('probeDirectAccess: conflict copies (Phase 8)', () => {
  it('lists the copies the folder holds beside each file, reports the last sweep, and prints both', async () => {
    const data = { tasks: [], unscheduledTasks: [] };
    const t = fakeDirectAccess({ read: async () => JSON.stringify({ version: 2, lastModified: 'x', data }) });
    t.lastSyncedKey = 'fake-da';
    t.files = {
      supported: () => true,
      list: async (dir) => (dir === '' ? ['dayglance-sync.json', 'dayglance-sync (conflicted copy 2026-10-10 111717).json', 'GLANCE'] : dir === 'GLANCE/events' ? ['glance-events.json', 'glance-events (1).json'] : []),
    };
    const storage = { getItem: (k) => (k === 'fake-da:conflicts' ? JSON.stringify({ at: '2026-10-10T20:00:00.000Z', copies: [{ outcome: 'merged' }, { outcome: 'removed' }, { outcome: 'needs-key' }] }) : null) };
    const r = await probeDirectAccess({ directAccess: t, buildSyncPayload: () => ({ data }), merge: (l, rr) => ({ data: rr, localChanged: false, remoteChanged: false }), localStorage: storage });
    expect(r.conflicts).toEqual([
      { rel: 'dayglance-sync (conflicted copy 2026-10-10 111717).json', name: 'dayglance-sync (conflicted copy 2026-10-10 111717).json', kind: 'snapshot' },
      { rel: 'GLANCE/events/glance-events (1).json', name: 'glance-events (1).json', kind: 'events' },
    ]);
    expect(r.lastSweep.at).toBe('2026-10-10T20:00:00.000Z');
    const text = formatDiagnosticsReport({
      platform: 'macos', icloud: false, available: { value: null }, snapshot: { state: 'unsupported', bytes: 0 },
      local: { taskCount: 1, inboxCount: 0 }, transports: { icloud: {}, webdav: {}, vault: {} }, syncEnabled: true, directAccess: r,
    });
    expect(text).toMatch(/conflict copies: 2\n    snapshot: dayglance-sync \(conflicted copy 2026-10-10 111717\).json\n    events: glance-events \(1\).json\n  last sweep: +2026-10-10T20:00:00.000Z \(1 merged, 1 removed, 1 needs-key\)/);
    // An iPhone cannot list: no rows, no lines.
    const ios = fakeDirectAccess({ read: async () => JSON.stringify({ version: 2, lastModified: 'x', data }) });
    const ri = await probeDirectAccess({ directAccess: ios, buildSyncPayload: () => ({ data }), merge: (l, rr) => ({ data: rr, localChanged: false, remoteChanged: false }) });
    expect(ri.conflicts).toBeNull();
    expect(formatDiagnosticsReport({ platform: 'ios', icloud: false, available: { value: null }, snapshot: { state: 'unsupported', bytes: 0 }, local: { taskCount: 1, inboxCount: 0 }, transports: { icloud: {}, webdav: {}, vault: {} }, syncEnabled: true, directAccess: ri })).not.toMatch(/conflict copies/);
  });
});
