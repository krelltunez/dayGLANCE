import { describe, it, expect, vi } from 'vitest';
import { createNativeDirectAccessBridge, isNativeDirectAccessAvailable, ASYNC_CALL_TIMEOUT_MS } from './directAccessNativeBridge.js';
import { createDirectAccessTransport } from './directAccessTransport.js';
import { classifySnapshotText } from './snapshotFileSync.js';

/**
 * Fakes of the two native bridges. Android's JavascriptInterface answers with
 * real booleans; iOS's dgbridge:// proxy answers everything as text, so its
 * booleans are the strings "true"/"false" and void calls answer "null".
 */
const makeNative = (platform = 'android', over = {}) => {
  const bool = (b) => (platform === 'ios' ? String(b) : b);
  const n = {
    folder: { configured: true, name: 'Sync', path: platform === 'ios' ? '/private/var/mobile/Sync' : 'content://tree/x', reachable: true },
    file: { kind: 'absent' },
    status: vi.fn(() => JSON.stringify(n.folder)),
    read: vi.fn(() => JSON.stringify(n.file)),
    write: vi.fn(() => bool(true)),
    deleteSnapshot: vi.fn(() => bool(true)),
    disconnect: vi.fn(() => bool(true)),
    __platform: platform,
    pickFolder: vi.fn(() => (platform === 'ios' ? 'null' : undefined)),
    // iOS only: the roster as its own bookmarked file (DirectAccessBridge.swift).
    ...(platform === 'ios' ? {
      usersStatus: vi.fn(() => JSON.stringify({ configured: false, name: null, path: null, reachable: false })),
      readUsers: vi.fn(() => JSON.stringify({ kind: 'error', error: 'no roster file chosen' })),
      writeUsers: vi.fn(() => 'true'),
      forgetUsers: vi.fn(() => 'true'),
      eventsStatus: vi.fn(() => JSON.stringify({ configured: false, name: null, path: null, reachable: false })),
      readEvents: vi.fn(() => JSON.stringify({ kind: 'error', error: 'no events file chosen' })),
      writeEvents: vi.fn(() => 'true'),
      forgetEvents: vi.fn(() => 'true'),
    } : {}),
    // Android only: files by path (DirectAccessBridge.kt).
    ...(platform === 'android' ? {
      listFiles: vi.fn(() => '["glance-users.json"]'),
      readFile: vi.fn(() => JSON.stringify({ kind: 'text', text: '{"users":[]}' })),
      writeFile: vi.fn(() => true),
      deleteFileAt: vi.fn(() => true),
      makeDir: vi.fn(() => true),
    } : {}),
    // iOS only: the sync file itself. Android's bridge has neither.
    ...(platform === 'ios' ? { pickFile: vi.fn(() => 'null'), createFile: vi.fn(() => 'null') } : {}),
    ...over,
  };
  return n;
};

const make = (native = makeNative(), platform = native.__platform ?? 'android') => {
  const w = {};
  const bridge = createNativeDirectAccessBridge({ native: () => native, win: () => w, platform });
  return { bridge, native, w };
};

describe('availability', () => {
  it('is false outside the native shells', () => {
    expect(isNativeDirectAccessAvailable()).toBe(false);
  });
});

describe.each(['android', 'ios'])('synchronous calls mapped to promises (%s)', (platform) => {
  it('status and restore parse the status JSON', async () => {
    const { bridge, native } = make(makeNative(platform));
    expect(await bridge.restore()).toEqual(native.folder);
    expect(await bridge.status()).toEqual(native.folder);
  });

  it('read parses the classification; garbage reads as null (an error to the transport)', async () => {
    const { bridge, native } = make(makeNative(platform));
    native.file = { kind: 'text', text: '{"version":2}' };
    expect(await bridge.read()).toEqual({ kind: 'text', text: '{"version":2}' });
    native.read = () => 'not json';
    expect(await bridge.read()).toBeNull();
    native.read = () => null; // iOS: the scheme handler answered 500
    expect(await bridge.read()).toBeNull();
  });

  it('write, deleteFile and disconnect return strict booleans whatever the native type', async () => {
    const { bridge, native } = make(makeNative(platform));
    expect(await bridge.write('{}')).toBe(true);
    expect(native.write).toHaveBeenCalledWith('{}');
    native.write = () => (platform === 'ios' ? 'false' : false);
    expect(await bridge.write('{}')).toBe(false);
    native.write = () => null;
    expect(await bridge.write('{}')).toBe(false);
    expect(await bridge.deleteFile()).toBe(true);
    expect(await bridge.disconnect()).toBe(true);
  });

  it('has no folder watcher', () => {
    const { bridge } = make(makeNative(platform));
    expect(bridge.onChanged).toBeUndefined();
  });
});

describe('the folder picker round trip', () => {
  it('resolves with the status the shell posts back, and clears its callback', async () => {
    const { bridge, native, w } = make();
    const picked = bridge.pick();
    expect(native.pickFolder).toHaveBeenCalledTimes(1);
    expect(typeof w.__dgDirectAccessPicked).toBe('function');
    // Kotlin and Swift both pass the JSON object as a JS literal.
    w.__dgDirectAccessPicked({ configured: true, name: 'Drive', path: '/x', reachable: true });
    expect(await picked).toMatchObject({ configured: true, name: 'Drive' });
    expect(w.__dgDirectAccessPicked).toBeUndefined();
  });

  it('pickFile and createFile (iOS) use the same callback; on Android they resolve null', async () => {
    const ios = make(makeNative('ios'));
    const picked = ios.bridge.pickFile();
    expect(ios.native.pickFile).toHaveBeenCalledTimes(1);
    ios.w.__dgDirectAccessPicked({ configured: true, name: 'dayglance-sync.json', path: '/x/dayglance-sync.json', reachable: true });
    expect(await picked).toMatchObject({ name: 'dayglance-sync.json' });
    const created = ios.bridge.createFile();
    expect(ios.native.createFile).toHaveBeenCalledTimes(1);
    ios.w.__dgDirectAccessPicked({ configured: true, name: 'dayglance-sync.json', path: '/y/dayglance-sync.json', reachable: true });
    expect(await created).toMatchObject({ path: '/y/dayglance-sync.json' });
    const android = make(makeNative('android'));
    expect(await android.bridge.pickFile()).toBeNull();
    expect(await android.bridge.createFile()).toBeNull();
    expect(android.w.__dgDirectAccessPicked).toBeUndefined();
  });

  it('a cancelled picker resolves null', async () => {
    const { bridge, w } = make();
    const picked = bridge.pick();
    w.__dgDirectAccessPicked(null);
    expect(await picked).toBeNull();
  });

  it('a failed pick the shell reports resolves with the error, logs the reason, and clears its callback', async () => {
    // A Nextcloud folder picked on an iPhone did nothing and nothing said why
    // (2026-10-08): the shell now posts {error, …}, which the transport shows.
    const { bridge, w } = make();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const picked = bridge.pick();
      w.__dgDirectAccessPicked({ error: 'bookmark: permission denied', path: '/x', scoped: false });
      expect(await picked).toMatchObject({ error: 'bookmark: permission denied' });
      expect(spy).toHaveBeenCalledWith('[direct-access] folder pick failed:', expect.objectContaining({ error: 'bookmark: permission denied' }));
      expect(w.__dgDirectAccessPicked).toBeUndefined();
    } finally { spy.mockRestore(); }
  });

  it('a bridge that throws on launch resolves null and leaves no callback behind', async () => {
    const native = makeNative('android', { pickFolder: () => { throw new Error('no activity'); } });
    const { bridge, w } = make(native);
    expect(await bridge.pick()).toBeNull();
    expect(w.__dgDirectAccessPicked).toBeUndefined();
  });

  it('a second pick before the first result settles the first as cancelled', async () => {
    const { bridge, w } = make();
    const first = bridge.pick();
    const second = bridge.pick();
    expect(await first).toBeNull();
    w.__dgDirectAccessPicked({ configured: true, name: 'Later', path: 'p', reachable: true });
    expect(await second).toMatchObject({ name: 'Later' });
  });
});

describe('through the shared transport', () => {
  const storage = () => {
    const m = {};
    return { getItem: (k) => m[k] ?? null, setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } };
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it.each(['android', 'ios'])('connects from the native status and maps reads onto the cycle contract (%s)', async (platform) => {
    const native = makeNative(platform);
    const { bridge } = make(native);
    const transport = createDirectAccessTransport({ bridge: () => bridge, storage: storage, log: { warn: vi.fn() } });
    transport.subscribe(() => {});
    await flush();
    expect(transport.getSnapshot()).toMatchObject({ status: 'connected', name: 'Sync', connected: true });
    expect(transport.isAvailable()).toBe(true);

    expect(classifySnapshotText(await transport.read())).toEqual({ kind: 'absent' });
    native.file = { kind: 'downloading' };
    expect(classifySnapshotText(await transport.read())).toEqual({ kind: 'downloading' });
    expect(await transport.write('{"version":2}')).toBe(true);
    native.file = { kind: 'error', error: 'permission denied' };
    expect(classifySnapshotText(await transport.read())).toEqual({ kind: 'error', error: 'permission denied' });
    expect(transport.getSnapshot().status).toBe('unreachable');
  });

  it('a revoked grant at launch is connected-but-unreachable, and picking again reconnects', async () => {
    const native = makeNative();
    native.folder = { ...native.folder, reachable: false };
    const { bridge, w } = make(native);
    const transport = createDirectAccessTransport({ bridge: () => bridge, storage: storage, log: { warn: vi.fn() } });
    transport.subscribe(() => {});
    await flush();
    expect(transport.getSnapshot()).toMatchObject({ status: 'unreachable', connected: true });

    const picking = transport.pickFolder();
    w.__dgDirectAccessPicked({ configured: true, name: 'Sync', path: 'content://tree/x', reachable: true });
    expect(await picking).toMatchObject({ status: 'connected', enabled: true });
  });
});

describe('files by path (Android)', () => {
  it('maps the Kotlin answers onto the paths shape the transport reads', async () => {
    const { bridge, native } = make(makeNative('android'));
    expect(await bridge.paths.list('GLANCE/users')).toEqual(['glance-users.json']);
    expect(native.listFiles).toHaveBeenCalledWith('GLANCE/users');
    expect(await bridge.paths.read('GLANCE/users/glance-users.json')).toEqual({ kind: 'text', text: '{"users":[]}' });
    expect(await bridge.paths.write('GLANCE/users/glance-users.json', '{}')).toBe(true);
    expect(native.writeFile).toHaveBeenCalledWith('GLANCE/users/glance-users.json', '{}');
    expect(await bridge.paths.remove('GLANCE/users/glance-users.json')).toBe(true);
    expect(await bridge.paths.makeDir('GLANCE/users')).toBe(true);
    // A refused path: the shell answers "null" for a listing and false for the rest.
    native.listFiles = () => 'null';
    native.writeFile = () => false;
    expect(await bridge.paths.list('../x')).toBeNull();
    expect(await bridge.paths.write('../x', '{}')).toBe(false);
    // Garbage from the shell is an error, never a crash.
    native.readFile = () => 'not json';
    expect(await bridge.paths.read('x')).toEqual({ kind: 'error', error: 'bad answer from the shell' });
  });

  it('an iPhone has no files by path', () => {
    expect(make(makeNative('ios')).bridge.paths).toBeUndefined();
  });
});

describe('the roster as its own bookmarked file (iOS)', () => {
  it('maps the Swift answers onto the users shape the transport reads, and passes the slot to the picks', async () => {
    const { bridge, native, w } = make(makeNative('ios'));
    expect(await bridge.users.status()).toEqual({ configured: false, name: null, path: null, reachable: false });
    expect(await bridge.users.read()).toEqual({ kind: 'error', error: 'no roster file chosen' });
    expect(await bridge.users.write('{"users":[]}')).toBe(true);
    expect(native.writeUsers).toHaveBeenCalledWith('{"users":[]}');
    expect(await bridge.users.forget()).toBe(true);
    const picked = bridge.pickFile('users');
    expect(native.pickFile).toHaveBeenCalledWith('users');
    w.__dgDirectAccessPicked({ configured: true, name: 'glance-users.json', path: '/x/glance-users.json', reachable: true, slot: 'users' });
    expect(await picked).toMatchObject({ slot: 'users' });
    const created = bridge.createFile();
    expect(native.createFile).toHaveBeenCalledWith('snapshot');
    w.__dgDirectAccessPicked(null);
    expect(await created).toBeNull();
    native.readUsers = () => 'garbage';
    expect(await bridge.users.read()).toEqual({ kind: 'error', error: 'bad answer from the shell' });
  });

  it('Android has no users slot', () => {
    expect(make(makeNative('android')).bridge.users).toBeUndefined();
    expect(make(makeNative('android')).bridge.events).toBeUndefined();
  });

  it('the events file (Phase 7) is a third slot of the same shape, and the picks carry its slot name', async () => {
    const { bridge, native, w } = make(makeNative('ios'));
    expect(await bridge.events.status()).toEqual({ configured: false, name: null, path: null, reachable: false });
    expect(await bridge.events.read()).toEqual({ kind: 'error', error: 'no events file chosen' });
    expect(await bridge.events.write('{"version":1,"events":[]}')).toBe(true);
    expect(native.writeEvents).toHaveBeenCalledWith('{"version":1,"events":[]}');
    expect(await bridge.events.forget()).toBe(true);
    const picked = bridge.createFile('events');
    expect(native.createFile).toHaveBeenCalledWith('events');
    w.__dgDirectAccessPicked({ configured: true, name: 'glance-events.json', path: '/x/glance-events.json', reachable: true, slot: 'events' });
    expect(await picked).toMatchObject({ slot: 'events' });
    native.readEvents = () => 'garbage';
    expect(await bridge.events.read()).toEqual({ kind: 'error', error: 'bad answer from the shell' });
  });
});

// Android's shell runs folder calls off the JS thread through callAsync and
// answers on window.__dgDirectAccessDispatch (DirectAccessBridge.kt). The fake
// shell queues each call and answers when the test says, with the same text
// the synchronous twin would return (booleans as "true"/"false").
describe('the off-thread path (Android callAsync)', () => {
  const makeAsyncShell = (platform = 'android') => {
    const native = makeNative(platform);
    const queue = [];
    native.callAsync = vi.fn((method, argsJson, id) => { queue.push({ method, args: JSON.parse(argsJson), id }); });
    const w = {};
    const bridge = createNativeDirectAccessBridge({ native: () => native, win: () => w, platform });
    const answerNext = ({ value, error = null } = {}) => {
      const c = queue.shift();
      let v = value;
      if (v === undefined) {
        const r = native[c.method](...c.args);
        v = typeof r === 'boolean' ? String(r) : r;
      }
      w.__dgDirectAccessDispatch(c.id, v, error);
      return c;
    };
    return { bridge, native, w, queue, answerNext };
  };

  it('never makes the synchronous call when the shell offers callAsync', async () => {
    const { bridge, native, queue, answerNext } = makeAsyncShell();
    native.status.mockClear();
    const p = bridge.status();
    await Promise.resolve();
    expect(native.status).not.toHaveBeenCalled();
    expect(queue).toHaveLength(1);
    answerNext();
    expect(await p).toEqual(native.folder);
  });

  it('carries arguments and parses each answer as the synchronous call would', async () => {
    const { bridge, native, queue, answerNext } = makeAsyncShell();
    native.file = { kind: 'text', text: '{"a":1}' };
    const read = bridge.read();
    const write = bridge.write('{"b":2}');
    const list = bridge.paths.list('intents');
    const readFile = bridge.paths.read('glance-users.json');
    const writeFile = bridge.paths.write('a/b.json', 'x');
    await Promise.resolve();
    expect(queue.map((c) => [c.method, c.args])).toEqual([
      ['read', []], ['write', ['{"b":2}']], ['listFiles', ['intents']],
      ['readFile', ['glance-users.json']], ['writeFile', ['a/b.json', 'x']],
    ]);
    for (let i = 0; i < 5; i += 1) answerNext();
    expect(await read).toEqual(native.file);
    expect(await write).toBe(true);
    expect(await list).toEqual(['glance-users.json']);
    expect(await readFile).toEqual({ kind: 'text', text: '{"users":[]}' });
    expect(await writeFile).toBe(true);
    expect(native.writeFile).toHaveBeenCalledWith('a/b.json', 'x');
  });

  it('reads a "false" answer as a failed write', async () => {
    const { bridge, queue, answerNext } = makeAsyncShell();
    const p = bridge.write('x');
    await Promise.resolve();
    expect(queue).toHaveLength(1);
    answerNext({ value: 'false' });
    expect(await p).toBe(false);
  });

  it('rejects on a shell error, as a thrown synchronous call does', async () => {
    const { bridge, answerNext } = makeAsyncShell();
    const p = bridge.read();
    await Promise.resolve();
    answerNext({ value: null, error: 'boom' });
    await expect(p).rejects.toThrow('boom');
  });

  it('gives up a call the shell never answers', async () => {
    vi.useFakeTimers();
    try {
      const { bridge, w } = makeAsyncShell();
      const p = bridge.read();
      const settled = expect(p).rejects.toThrow(/timed out/);
      await vi.advanceTimersByTimeAsync(ASYNC_CALL_TIMEOUT_MS);
      await settled;
      expect(Object.keys(w.__dgDirectAccessCbs)).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('settles each call by its own id when answers arrive out of order', async () => {
    const { bridge, native, w, queue } = makeAsyncShell();
    const a = bridge.status();
    const b = bridge.read();
    await Promise.resolve();
    const [ca, cb] = queue;
    w.__dgDirectAccessDispatch(cb.id, JSON.stringify({ kind: 'absent' }), null);
    w.__dgDirectAccessDispatch(ca.id, JSON.stringify(native.folder), null);
    expect(await a).toEqual(native.folder);
    expect(await b).toEqual({ kind: 'absent' });
  });

  it('keeps iOS on the synchronous calls (its proxy answers any method name)', async () => {
    const { bridge, native } = makeAsyncShell('ios');
    expect(await bridge.status()).toEqual(native.folder);
    expect(native.callAsync).not.toHaveBeenCalled();
    expect(native.status).toHaveBeenCalled();
  });
});
