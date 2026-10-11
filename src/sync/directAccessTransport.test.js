import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createDirectAccessTransport,
  DIRECT_ACCESS_LAST_SYNCED_KEY,
  DIRECT_ACCESS_PREF_KEY,
  DIRECT_ACCESS_PICK_TIMEOUT_MS,
  DIRECT_ACCESS_ENCRYPT_KEY,
  directAccessEncryptsWrites,
} from './directAccessTransport.js';
import { classifySnapshotText } from './snapshotFileSync.js';

const makeStorage = (initial = {}) => {
  const m = { ...initial };
  return {
    getItem: (k) => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: (k) => { delete m[k]; },
    dump: () => ({ ...m }),
  };
};

/** A fake of window.electronAPI.directAccess with a scriptable folder. */
const makeBridge = (over = {}) => {
  const b = {
    folder: { configured: true, path: '/Users/me/Drive/GLANCE', name: 'GLANCE', reachable: true },
    file: { kind: 'absent' },
    changed: null,
    restore: vi.fn(async () => b.folder),
    status: vi.fn(async () => b.folder),
    pick: vi.fn(async () => b.folder),
    disconnect: vi.fn(async () => true),
    read: vi.fn(async () => b.file),
    write: vi.fn(async () => true),
    deleteFile: vi.fn(async () => true),
    onChanged: vi.fn((cb) => { b.changed = cb; return () => { b.changed = null; }; }),
    ...over,
  };
  return b;
};

const flush = () => new Promise((r) => setTimeout(r, 0));

const make = ({ bridge = makeBridge(), storage = makeStorage(), present = true, ...rest } = {}) => {
  const transport = createDirectAccessTransport({
    bridge: () => (present ? bridge : null),
    storage: () => storage,
    log: { warn: vi.fn() },
    ...rest,
  });
  return { transport, bridge, storage };
};

describe('support and availability', () => {
  it('is unsupported without the Electron bridge, and schedules nothing', () => {
    const { transport } = make({ present: false });
    expect(transport.isSupported()).toBe(false);
    expect(transport.isAvailable()).toBe(false);
    expect(transport.getSnapshot()).toMatchObject({ supported: false, status: 'unknown', connected: false });
  });

  it('restores the remembered folder on first use, and is available once it has', async () => {
    const { transport, bridge } = make();
    expect(transport.isAvailable()).toBe(false); // kicks the restore
    await flush();
    expect(bridge.restore).toHaveBeenCalledTimes(1);
    expect(transport.isAvailable()).toBe(true);
    expect(transport.getSnapshot()).toMatchObject({ status: 'connected', name: 'GLANCE', connected: true, enabled: true });
    // Only once per session.
    transport.isAvailable();
    await flush();
    expect(bridge.restore).toHaveBeenCalledTimes(1);
  });

  it('with no folder remembered it is disconnected and unavailable', async () => {
    const bridge = makeBridge({ folder: { configured: false } });
    const { transport } = make({ bridge });
    transport.subscribe(() => {});
    await flush();
    expect(transport.getSnapshot()).toMatchObject({ status: 'disconnected', connected: false, name: null });
    expect(transport.isAvailable()).toBe(false);
    expect(transport.isConnected()).toBe(false);
  });

  it('a folder that is remembered but not reachable is connected-but-unreachable, and re-probed on each availability check', async () => {
    const bridge = makeBridge();
    bridge.folder = { ...bridge.folder, reachable: false };
    const { transport } = make({ bridge });
    const kicks = vi.fn();
    transport.onChanged(kicks);
    transport.subscribe(() => {});
    await flush();
    expect(transport.getSnapshot()).toMatchObject({ status: 'unreachable', connected: true });
    expect(transport.isAvailable()).toBe(false);
    await flush();
    expect(bridge.status).toHaveBeenCalledTimes(1);
    expect(kicks).not.toHaveBeenCalled();

    // The share mounts: the next check sees it and kicks a cycle.
    bridge.folder = { ...bridge.folder, reachable: true };
    expect(transport.isAvailable()).toBe(false);
    await flush();
    expect(transport.getSnapshot().status).toBe('connected');
    expect(transport.isAvailable()).toBe(true);
    expect(kicks).toHaveBeenCalledTimes(1);
  });

  it('a restore that throws leaves the device disconnected rather than stuck on unknown', async () => {
    const bridge = makeBridge({ restore: vi.fn(async () => { throw new Error('ipc down'); }) });
    const { transport } = make({ bridge });
    transport.subscribe(() => {});
    await flush();
    expect(transport.getSnapshot().status).toBe('disconnected');
  });
});

describe('read mapping onto the shared cycle contract', () => {
  let t;
  beforeEach(async () => {
    t = make();
    t.transport.subscribe(() => {});
    await flush();
  });

  it('absent → null, downloading → placeholder, text → text', async () => {
    t.bridge.file = { kind: 'absent' };
    expect(classifySnapshotText(await t.transport.read())).toEqual({ kind: 'absent' });
    t.bridge.file = { kind: 'downloading' };
    expect(classifySnapshotText(await t.transport.read())).toEqual({ kind: 'downloading' });
    t.bridge.file = { kind: 'text', text: '{"version":2,"data":{"tasks":[]}}' };
    expect(classifySnapshotText(await t.transport.read())).toMatchObject({ kind: 'snapshot' });
    expect(t.transport.getSnapshot().status).toBe('connected');
  });

  it('an error marks the folder unreachable so later cycles wait quietly', async () => {
    t.bridge.file = { kind: 'error', error: 'folder not found' };
    expect(classifySnapshotText(await t.transport.read())).toEqual({ kind: 'error', error: 'folder not found' });
    expect(t.transport.getSnapshot().status).toBe('unreachable');
    expect(t.transport.isAvailable()).toBe(false);
  });

  it('an unexpected shape is an error, never an absent file', async () => {
    t.bridge.file = undefined;
    expect(classifySnapshotText(await t.transport.read()).kind).toBe('error');
  });

  it('write and deleteSnapshot pass through as booleans', async () => {
    expect(await t.transport.write('{}')).toBe(true);
    expect(t.bridge.write).toHaveBeenCalledWith('{}');
    t.bridge.write = vi.fn(async () => undefined);
    expect(await t.transport.write('{}')).toBe(false);
    expect(await t.transport.deleteSnapshot()).toBe(true);
  });
});

describe('transport contract constants', () => {
  it('never reseeds plaintext over an unreadable encrypted file, never prompts, throttles longer than iCloud', () => {
    const { transport } = make();
    expect(transport.allowsPlaintextReseed).toBe(false);
    // The user's own cloud, not Apple's: health-store counts ride in the file
    // (iCloud strips them for guideline 5.1.3).
    expect(transport.stripsHealthLogs).toBe(false);
    expect(transport.firstRunDecided()).toBe(true);
    expect(transport.writeThrottleMs).toBeGreaterThan(5000);
    expect(transport.lastSyncedKey).toBe(DIRECT_ACCESS_LAST_SYNCED_KEY);
    expect(transport.kicksOnVisibility()).toBe(true);
  });
});

describe('per-device switch', () => {
  it('is on by default once connected, off only when stored as off, and re-enabling kicks a cycle', async () => {
    const { transport, storage } = make();
    const kicks = vi.fn();
    transport.onChanged(kicks);
    expect(transport.isEnabled()).toBe(true);
    transport.setEnabled(false);
    expect(storage.getItem(DIRECT_ACCESS_PREF_KEY)).toBe('false');
    expect(transport.isEnabled()).toBe(false);
    expect(transport.getSnapshot().enabled).toBe(false);
    expect(kicks).not.toHaveBeenCalled();
    transport.setEnabled(true);
    expect(transport.isEnabled()).toBe(true);
    expect(kicks).toHaveBeenCalledTimes(1);
  });
});

describe('the encryption switch (Phase 6)', () => {
  it('is off until stored as on, kicks a cycle when turned on (the upgrade is written now), and is readable without a transport for the launch key gate', () => {
    const { transport, storage } = make();
    const kicks = vi.fn();
    transport.onChanged(kicks);
    expect(transport.encryptsWrites()).toBe(false);
    expect(transport.getSnapshot().encrypt).toBe(false);
    transport.setEncryptsWrites(true);
    expect(storage.getItem(DIRECT_ACCESS_ENCRYPT_KEY)).toBe('true');
    expect(transport.encryptsWrites()).toBe(true);
    expect(transport.getSnapshot().encrypt).toBe(true);
    expect(kicks).toHaveBeenCalledTimes(1);
    expect(directAccessEncryptsWrites(() => storage)).toBe(true);
    transport.setEncryptsWrites(false);
    expect(storage.getItem(DIRECT_ACCESS_ENCRYPT_KEY)).toBeNull();
    expect(kicks).toHaveBeenCalledTimes(1);                           // off changes nothing until the file is replaced
    expect(directAccessEncryptsWrites(() => { throw new Error('no storage'); })).toBe(false);
  });

  it('is forgotten with the folder on disconnect, like the last-synced stamp', async () => {
    const { transport, storage } = make();
    transport.subscribe(() => {});
    await flush();
    transport.setEncryptsWrites(true);
    await transport.disconnect();
    expect(storage.getItem(DIRECT_ACCESS_ENCRYPT_KEY)).toBeNull();
    expect(transport.getSnapshot().encrypt).toBe(false);
  });
});

describe('picking and disconnecting', () => {
  it('guard: picking a folder forgets the old last-synced stamp, turns the switch on, and kicks a cycle', async () => {
    const storage = makeStorage({ [DIRECT_ACCESS_LAST_SYNCED_KEY]: '2026-10-01T00:00:00.000Z', [DIRECT_ACCESS_PREF_KEY]: 'false' });
    const bridge = makeBridge({ folder: { configured: false } });
    const { transport } = make({ bridge, storage });
    const kicks = vi.fn();
    transport.onChanged(kicks);
    transport.subscribe(() => {});
    await flush();
    expect(transport.getSnapshot().status).toBe('disconnected');

    bridge.pick = vi.fn(async () => ({ configured: true, path: '/x/Dropbox/dg', name: 'dg', reachable: true }));
    const snap = await transport.pickFolder();
    expect(snap).toMatchObject({ status: 'connected', name: 'dg', enabled: true });
    // Without this the seed guard would read an empty new folder as an
    // eviction of the old one and wait out the grace window before seeding.
    expect(storage.getItem(DIRECT_ACCESS_LAST_SYNCED_KEY)).toBeNull();
    expect(storage.getItem(DIRECT_ACCESS_PREF_KEY)).toBe('true');
    expect(kicks).toHaveBeenCalledTimes(1);
    expect(transport.isAvailable()).toBe(true);
  });

  it('a pick the shell reports as failed is shown as pickError, returns null, and changes nothing else', async () => {
    const { transport, bridge, storage } = make({ log: { warn: vi.fn() } });
    const seen = [];
    transport.subscribe(() => seen.push(transport.getSnapshot().pickError));
    await flush();
    storage.setItem(DIRECT_ACCESS_LAST_SYNCED_KEY, 'stamp');
    bridge.pick = vi.fn(async () => ({ error: 'bookmark: permission denied', path: '/Nextcloud/dg', scoped: false }));
    expect(await transport.pickFolder()).toBeNull();
    expect(transport.getSnapshot().pickError).toBe('bookmark: permission denied (/Nextcloud/dg)');
    expect(seen.at(-1)).toBe('bookmark: permission denied (/Nextcloud/dg)');
    expect(storage.getItem(DIRECT_ACCESS_LAST_SYNCED_KEY)).toBe('stamp');
    expect(transport.getSnapshot().status).toBe('connected');
    // The next successful pick clears it.
    bridge.pick = vi.fn(async () => ({ configured: true, path: '/x', name: 'x', reachable: true }));
    await transport.pickFolder();
    expect(transport.getSnapshot().pickError).toBeNull();
  });

  it('a picker that never answers is reported after the timeout instead of hanging the card', async () => {
    const timers = [];
    const setTimer = vi.fn((fn, ms) => { timers.push({ fn, ms }); return timers.length; });
    const clearTimer = vi.fn();
    const { transport, bridge } = make({ setTimer, clearTimer });
    transport.subscribe(() => {});
    await flush();
    bridge.pick = vi.fn(() => new Promise(() => {}));
    const picked = transport.pickFolder();
    expect(timers[0].ms).toBe(DIRECT_ACCESS_PICK_TIMEOUT_MS);
    timers[0].fn();
    expect(await picked).toBeNull();
    expect(transport.getSnapshot().pickError).toBe('the picker returned no result');
    expect(clearTimer).toHaveBeenCalled();
  });

  it('probeStatus hands back the shell\'s own status for the diagnostics report', async () => {
    const { transport, bridge } = make();
    expect(await transport.probeStatus()).toEqual(await bridge.status());
  });

  it('pickFile and createFile (iOS) connect exactly as pickFolder does; a bridge without them says so', async () => {
    const storage = makeStorage({ [DIRECT_ACCESS_LAST_SYNCED_KEY]: 'stamp', [DIRECT_ACCESS_PREF_KEY]: 'false' });
    const file = { configured: true, path: '/x/dayglance-sync.json', name: 'dayglance-sync.json', reachable: true };
    const bridge = makeBridge({ folder: { configured: false }, pickFile: vi.fn(async () => file), createFile: vi.fn(async () => file) });
    const { transport } = make({ bridge, storage });
    const kicks = vi.fn();
    transport.onChanged(kicks);
    transport.subscribe(() => {});
    await flush();
    expect(await transport.pickFile()).toMatchObject({ status: 'connected', name: 'dayglance-sync.json', enabled: true });
    expect(storage.getItem(DIRECT_ACCESS_LAST_SYNCED_KEY)).toBeNull();
    expect(kicks).toHaveBeenCalledTimes(1);
    expect(await transport.createFile()).toMatchObject({ status: 'connected' });
    expect(bridge.createFile).toHaveBeenCalledTimes(1);
    // Desktop and Android bridges have no file pick: reported, not thrown.
    const plain = make({ bridge: makeBridge() });
    plain.transport.subscribe(() => {});
    await flush();
    expect(await plain.transport.pickFile()).toBeNull();
    expect(plain.transport.getSnapshot().pickError).toBe('not available on this platform');
  });

  it('a cancelled picker changes nothing', async () => {
    const { transport, bridge, storage } = make();
    transport.subscribe(() => {});
    await flush();
    storage.setItem(DIRECT_ACCESS_LAST_SYNCED_KEY, 'stamp');
    bridge.pick = vi.fn(async () => null);
    expect(await transport.pickFolder()).toBeNull();
    expect(storage.getItem(DIRECT_ACCESS_LAST_SYNCED_KEY)).toBe('stamp');
    expect(transport.getSnapshot().status).toBe('connected');
  });

  it('disconnecting forgets the folder and the stamp, and makes the transport unavailable', async () => {
    const { transport, bridge, storage } = make();
    transport.subscribe(() => {});
    await flush();
    storage.setItem(DIRECT_ACCESS_LAST_SYNCED_KEY, 'stamp');
    await transport.disconnect();
    expect(bridge.disconnect).toHaveBeenCalled();
    expect(storage.getItem(DIRECT_ACCESS_LAST_SYNCED_KEY)).toBeNull();
    expect(transport.getSnapshot()).toMatchObject({ status: 'disconnected', connected: false, name: null });
    expect(transport.isAvailable()).toBe(false);
    expect(transport.isConnected()).toBe(false);
  });
});

describe('change events and status subscription', () => {
  it('forwards the main process watcher to one subscriber set and unsubscribes cleanly', () => {
    const { transport, bridge } = make();
    const a = vi.fn(); const b = vi.fn();
    const offA = transport.onChanged(a);
    const offB = transport.onChanged(b);
    expect(bridge.onChanged).toHaveBeenCalledTimes(1);
    bridge.changed();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    offA();
    bridge.changed();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
    offB();
    expect(bridge.changed).toBeNull();
  });

  it('status listeners get a stable snapshot object between changes', async () => {
    const { transport } = make();
    const seen = [];
    transport.subscribe((s) => seen.push(s));
    await flush();
    const s1 = transport.getSnapshot();
    expect(transport.getSnapshot()).toBe(s1);
    transport.setEnabled(false);
    const s2 = transport.getSnapshot();
    expect(s2).not.toBe(s1);
    expect(s2.enabled).toBe(false);
    expect(seen.at(-1)).toBe(s2);
  });
});

describe('the household roster slot (Phase 5)', () => {
  const rel = 'GLANCE/users/glance-users.json';
  const withPaths = (files = {}, over = {}) => {
    const dirs = new Set();
    const paths = {
      // The folder root is ''; a listing is the files directly in the directory.
      list: vi.fn(async (d) => Object.keys(files).filter((k) => (d ? k.startsWith(d + '/') : true)).map((k) => (d ? k.slice(d.length + 1) : k)).filter((k) => !k.includes('/'))),
      read: vi.fn(async (p) => (p in files ? files[p] : { kind: 'absent' })),
      write: vi.fn(async (p, text) => {
        const dir = p.slice(0, p.lastIndexOf('/'));
        if (!dirs.has(dir) && !over.autoDirs) return false;   // a tool that refuses to create parents
        files[p] = { kind: 'text', text };
        return true;
      }),
      remove: vi.fn(async (p) => { delete files[p]; return true; }),
      makeDir: vi.fn(async (d) => { dirs.add(d); return true; }),
    };
    return { bridge: makeBridge({ paths }), paths, files, dirs };
  };

  it('maps a path read onto the snapshot read contract, and reports the shell\'s errors', async () => {
    const { bridge, files } = withPaths();
    const { transport } = make({ bridge });
    transport.subscribe(() => {});
    await flush();
    expect(transport.rosterSupported()).toBe(true);
    expect(classifySnapshotText(await transport.rosterRead(rel))).toEqual({ kind: 'absent' });
    files[rel] = { kind: 'downloading' };
    expect(classifySnapshotText(await transport.rosterRead(rel))).toEqual({ kind: 'downloading' });
    files[rel] = { kind: 'text', text: '{"version":1,"users":[]}' };
    expect(await transport.rosterRead(rel)).toBe('{"version":1,"users":[]}');
    files[rel] = { kind: 'error', error: 'folder not found' };
    expect(classifySnapshotText(await transport.rosterRead(rel))).toEqual({ kind: 'error', error: 'folder not found' });
  });

  it('a write that fails for a missing directory creates it and tries once more', async () => {
    const { bridge, paths, files, dirs } = withPaths();
    const { transport } = make({ bridge });
    expect(await transport.rosterWrite(rel, '{"version":1}')).toBe(true);
    expect(paths.makeDir).toHaveBeenCalledWith('GLANCE/users');
    expect(dirs.has('GLANCE/users')).toBe(true);
    expect(files[rel]).toEqual({ kind: 'text', text: '{"version":1}' });
    expect(paths.write).toHaveBeenCalledTimes(2);
  });

  it('an iPhone offers the roster as its own bookmarked file: the path is ignored', async () => {
    const users = { read: vi.fn(async () => ({ kind: 'text', text: '{"users":[]}' })), write: vi.fn(async () => true) };
    const { transport } = make({ bridge: makeBridge({ users }) });
    expect(transport.rosterSupported()).toBe(true);
    expect(await transport.rosterRead(rel)).toBe('{"users":[]}');
    expect(await transport.rosterWrite(rel, 'x')).toBe(true);
    expect(users.write).toHaveBeenCalledWith('x');
  });

  it('files by path (Phase 8): list, read and remove through the paths bridge; absent on an iPhone', async () => {
    const { bridge, files } = withPaths({ 'dayglance-sync (1).json': { kind: 'text', text: '{"version":2}' }, 'GLANCE/users/glance-users.json': { kind: 'text', text: '{}' } });
    const { transport } = make({ bridge });
    expect(transport.files.supported()).toBe(true);
    expect(await transport.files.list('')).toEqual(['dayglance-sync (1).json']);
    expect(await transport.files.list('GLANCE/users')).toEqual(['glance-users.json']);
    expect(await transport.files.read('dayglance-sync (1).json')).toBe('{"version":2}');
    expect(await transport.files.read('nope.json')).toBeNull();
    expect(await transport.files.remove('dayglance-sync (1).json')).toBe(true);
    expect(files['dayglance-sync (1).json']).toBeUndefined();
    const iphone = make({ bridge: makeBridge({ users: { read: vi.fn(), write: vi.fn() } }) }).transport;
    expect(iphone.files.supported()).toBe(false);
    expect(await iphone.files.list('')).toBeNull();
    expect(classifySnapshotText(await iphone.files.read('x')).kind).toBe('error');
    expect(await iphone.files.remove('x')).toBe(false);
  });

  it('a bridge with neither is reported, not thrown, and never written', async () => {
    const { transport } = make({ bridge: makeBridge() });
    expect(transport.rosterSupported()).toBe(false);
    expect(classifySnapshotText(await transport.rosterRead(rel)).kind).toBe('error');
    expect(await transport.rosterWrite(rel, 'x')).toBe(false);
  });

  it('the intents event set (Phase 7) is the same slot shape: by path on desktop and Android, a bookmarked file on an iPhone', async () => {
    const ev = 'GLANCE/events/glance-events.json';
    const { bridge, files } = withPaths({ [ev]: { kind: 'text', text: '{"version":1,"events":[]}' } });
    const byPath = make({ bridge }).transport;
    expect(byPath.eventsSupported()).toBe(true);
    expect(await byPath.eventsRead(ev)).toBe('{"version":1,"events":[]}');
    expect(await byPath.eventsWrite(ev, '{"version":1,"events":[1]}')).toBe(true);
    expect(files[ev]).toEqual({ kind: 'text', text: '{"version":1,"events":[1]}' });
    const events = { read: vi.fn(async () => ({ kind: 'absent' })), write: vi.fn(async () => true) };
    const iphone = make({ bridge: makeBridge({ events }) }).transport;
    expect(iphone.eventsSupported()).toBe(true);
    expect(await iphone.eventsRead(ev)).toBeNull();
    expect(await iphone.eventsWrite(ev, 'x')).toBe(true);
    expect(events.write).toHaveBeenCalledWith('x');
    const none = make({ bridge: makeBridge() }).transport;
    expect(none.eventsSupported()).toBe(false);
    expect(classifySnapshotText(await none.eventsRead(ev)).kind).toBe('error');
    expect(await none.eventsWrite(ev, 'x')).toBe(false);
  });
});

describe('the roster file on an iPhone (Phase 5)', () => {
  const usersBridge = (configured = false) => {
    const users = {
      status: vi.fn(async () => ({ configured, name: configured ? 'glance-users.json' : null, path: configured ? '/x/glance-users.json' : null, reachable: configured })),
      read: vi.fn(async () => (configured ? { kind: 'text', text: '{"users":[]}' } : { kind: 'error', error: 'no roster file chosen' })),
      write: vi.fn(async () => true),
      forget: vi.fn(async () => true),
    };
    const bridge = makeBridge({
      users,
      pickFile: vi.fn(async (slot) => (slot === 'users'
        ? { configured: true, name: 'glance-users.json', path: '/x/glance-users.json', reachable: true, slot: 'users' }
        : { configured: true, name: 'dayglance-sync.json', path: '/x/dayglance-sync.json', reachable: true })),
      createFile: vi.fn(async (slot) => ({ configured: true, name: slot === 'users' ? 'glance-users.json' : 'dayglance-sync.json', path: '/y', reachable: true, slot })),
    });
    return { bridge, users };
  };

  it('restores the roster status with the snapshot, and reports it in the snapshot', async () => {
    const { transport } = make({ bridge: usersBridge(true).bridge });
    transport.subscribe(() => {});
    await flush();
    expect(transport.getSnapshot().roster).toEqual({ configured: true, name: 'glance-users.json', path: '/x/glance-users.json', reachable: true });
    const { transport: t2 } = make({ bridge: makeBridge() });
    t2.subscribe(() => {});
    await flush();
    expect(t2.getSnapshot().roster).toBeNull();            // a folder platform: no roster file
  });

  it('picking or creating the roster file sets the roster and leaves the snapshot connection alone', async () => {
    const storage = makeStorage({ [DIRECT_ACCESS_LAST_SYNCED_KEY]: 'stamp' });
    const { bridge } = usersBridge(false);
    const { transport } = make({ bridge, storage });
    const kicks = vi.fn();
    transport.onChanged(kicks);
    transport.subscribe(() => {});
    await flush();
    expect(transport.getSnapshot().roster.configured).toBe(false);
    const snap = await transport.pickUsersFile();
    expect(bridge.pickFile).toHaveBeenCalledWith('users');
    expect(snap.roster).toEqual({ configured: true, name: 'glance-users.json', path: '/x/glance-users.json', reachable: true });
    expect(snap.status).toBe('connected');
    expect(snap.name).toBe('GLANCE');                        // the snapshot connection, untouched
    expect(storage.getItem(DIRECT_ACCESS_LAST_SYNCED_KEY)).toBe('stamp');
    expect(kicks).not.toHaveBeenCalled();
    await transport.createUsersFile();
    expect(bridge.createFile).toHaveBeenCalledWith('users');
    await transport.forgetUsersFile();
    expect(bridge.users.forget).toHaveBeenCalled();
    expect(transport.getSnapshot().roster).toEqual({ configured: false, name: null, path: null, reachable: false });
  });

  it('the events file (Phase 7): restored with the snapshot, picked, created and forgotten like the roster', async () => {
    const events = {
      status: vi.fn(async () => ({ configured: true, name: 'glance-events.json', path: '/x/glance-events.json', reachable: true })),
      read: vi.fn(async () => ({ kind: 'text', text: '{"version":1,"events":[]}' })),
      write: vi.fn(async () => true),
      forget: vi.fn(async () => true),
    };
    const bridge = makeBridge({
      events,
      pickFile: vi.fn(async (slot) => ({ configured: true, name: 'glance-events.json', path: '/y/glance-events.json', reachable: true, slot })),
      createFile: vi.fn(async (slot) => ({ configured: true, name: 'glance-events.json', path: '/z/glance-events.json', reachable: true, slot })),
    });
    const { transport } = make({ bridge });
    transport.subscribe(() => {});
    await flush();
    expect(transport.getSnapshot().events).toEqual({ configured: true, name: 'glance-events.json', path: '/x/glance-events.json', reachable: true });
    await transport.pickEventsFile();
    expect(bridge.pickFile).toHaveBeenCalledWith('events');
    expect(transport.getSnapshot().events.path).toBe('/y/glance-events.json');
    expect(transport.getSnapshot().name).toBe('GLANCE');                 // the snapshot connection is untouched
    await transport.createEventsFile();
    expect(bridge.createFile).toHaveBeenCalledWith('events');
    expect(transport.getSnapshot().events.path).toBe('/z/glance-events.json');
    await transport.forgetEventsFile();
    expect(events.forget).toHaveBeenCalled();
    expect(transport.getSnapshot().events).toEqual({ configured: false, name: null, path: null, reachable: false });
    expect(transport.getSnapshot().roster).toBeNull();                   // no users slot on this bridge
    // Without the slot the pick is reported, not thrown.
    const plain = make({ bridge: makeBridge({ pickFile: vi.fn() }) }).transport;
    expect(await plain.pickEventsFile()).toBeNull();
    expect(plain.getSnapshot().pickError).toBe('not available on this platform');
    expect(plain.getSnapshot().events).toBeNull();
  });

  it('a platform without the roster file reports the pick as unavailable', async () => {
    const { transport } = make({ bridge: makeBridge({ pickFile: vi.fn() }) });
    transport.subscribe(() => {});
    await flush();
    expect(await transport.pickUsersFile()).toBeNull();
    expect(transport.getSnapshot().pickError).toBe('not available on this platform');
  });

  it('the roster slot reads and writes the bookmarked file; without one the read is an error and nothing is written', async () => {
    const chosen = usersBridge(true);
    const { transport } = make({ bridge: chosen.bridge });
    expect(await transport.rosterRead('GLANCE/users/glance-users.json')).toBe('{"users":[]}');
    expect(await transport.rosterWrite('GLANCE/users/glance-users.json', 'x')).toBe(true);
    const none = usersBridge(false);
    const { transport: t2 } = make({ bridge: none.bridge });
    expect(classifySnapshotText(await t2.rosterRead('GLANCE/users/glance-users.json'))).toEqual({ kind: 'error', error: 'no roster file chosen' });
  });
});
