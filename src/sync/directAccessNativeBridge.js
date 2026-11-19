/**
 * Direct Access on the native apps: window.DayGlanceDirectAccess (Android's
 * DirectAccessBridge.kt, iOS's DirectAccessBridge.swift) adapted to the
 * promise-based bridge shape the transport already consumes on Electron
 * (electronAPI.directAccess), so sync/directAccessTransport.js, the hook and
 * the cycle run unchanged on every platform.
 *
 * The native calls are synchronous and answer with JSON text: the page's JS
 * thread waits for each one, so a folder lookup that takes a moment holds
 * taps and rendering for that moment, twice every 15-second poll (the
 * snapshot and the intents file). Android's shell also offers
 * `callAsync(method, argsJson, callbackId)`, which runs the same call on a
 * worker thread and answers through `window.__dgDirectAccessDispatch`; the
 * adapter uses it whenever it is there. Android's
 * JavascriptInterface returns real booleans; iOS answers every dgbridge:// call
 * as text, so its booleans arrive as the strings "true"/"false". The adapter
 * accepts both. The one asynchronous step is the folder picker: pickFolder()
 * launches the platform's picker (the Storage Access Framework tree picker,
 * the Files folder picker) and the result is delivered through
 * `window.__dgDirectAccessPicked(statusOrNull)`.
 *
 * Neither platform offers a folder watcher for a picked folder, so `onChanged`
 * is absent; the poll and the foreground kick carry remote changes.
 */

/** Present inside the Android WebView and the iOS shell, never on the web. */
export const isNativeDirectAccessAvailable = () =>
  typeof window !== 'undefined' && !!window.DayGlanceDirectAccess;

const PICK_CALLBACK = '__dgDirectAccessPicked';
const DISPATCH = '__dgDirectAccessDispatch';

/**
 * A call the shell has not answered in this long is given up as an error, the
 * way a thrown synchronous call is. The shell's worker runs calls in order, so
 * one still running when it is given up delays the next rather than racing it.
 */
export const ASYNC_CALL_TIMEOUT_MS = 60_000;

/** iOS answers booleans as text; Android as booleans. */
const truthy = (value) => value === true || value === 'true';

/**
 * @param {object} [deps]
 * @param {() => object} [deps.native]  the native bridge object
 * @param {() => object} [deps.win]     where the pick callback is registered
 */
export function createNativeDirectAccessBridge({
  native = () => window.DayGlanceDirectAccess,
  win = () => window,
  // Which shell: Android's bridge offers files by path (`paths`), an iPhone's
  // offers the roster as its own bookmarked file (`users`, a later PR). The
  // iOS proxy answers any method name, so this cannot be felt out at runtime.
  platform = (typeof window !== 'undefined' && window.DayGlanceIOS) ? 'ios' : 'android',
} = {}) {
  const parse = (value) => {
    if (value == null) return null;
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value); } catch { return null; }
  };

  // The off-thread path: Android's shell only (the iOS bridge is a Proxy that
  // answers any method name, so presence proves nothing there).
  let nextId = 0;
  const canCallAsync = () => {
    if (platform !== 'android') return false;
    try { return typeof native()?.callAsync === 'function'; } catch { return false; }
  };
  const callAsync = (method, args) => new Promise((resolve, reject) => {
    const w = win();
    const pending = w.__dgDirectAccessCbs || (w.__dgDirectAccessCbs = {});
    if (typeof w[DISPATCH] !== 'function') {
      w[DISPATCH] = (id, value, error) => {
        const cb = w.__dgDirectAccessCbs?.[id];
        if (cb) cb(value, error);
      };
    }
    nextId = (nextId + 1) % 1e9;
    const id = `da_${nextId}`;
    const timer = setTimeout(() => {
      delete pending[id];
      reject(new Error(`direct access ${method} timed out`));
    }, ASYNC_CALL_TIMEOUT_MS);
    pending[id] = (value, error) => {
      clearTimeout(timer);
      delete pending[id];
      if (error != null) reject(new Error(String(error)));
      else resolve(value);
    };
    try {
      native().callAsync(method, JSON.stringify(args), id);
    } catch (err) {
      clearTimeout(timer);
      delete pending[id];
      reject(err);
    }
  });
  /** One folder call: off the JS thread where the shell can, else as before. */
  const call = async (method, ...args) => (canCallAsync()
    ? callAsync(method, args)
    : native()[method](...args));

  return {
    restore: async () => parse(await call('status')),
    status: async () => parse(await call('status')),

    // Resolves with the new status, or null when the picker was cancelled or
    // could not be launched. One pick at a time: a second call before the
    // first resolves replaces its callback, and the earlier promise settles
    // null when the result finally arrives for the later one.
    pick: () => launch('pickFolder'),
    // iOS only: a file itself, picked or created (DirectAccessBridge.swift):
    // the snapshot, with slot 'users' the household roster, with 'events' the
    // intents event set. Android's bridge has neither method; the call throws
    // and resolves null.
    pickFile: (slot = 'snapshot') => launch('pickFile', slot),
    createFile: (slot = 'snapshot') => launch('createFile', slot),

    disconnect: async () => truthy(native().disconnect()),
    read: async () => parse(await call('read')),
    write: async (text) => truthy(await call('write', text)),
    deleteFile: async () => truthy(await call('deleteSnapshot')),

    // Files by path, relative to the folder and confined to it in the shell
    // (DirectAccessPath.kt). Android only: docs/direct-access-sync.md, Phase 5.
    // The household roster as its own bookmarked file. iOS only: there is no
    // folder to find it in (docs/direct-access-sync.md, Phase 5).
    ...(platform === 'ios' ? {
      users: {
        status: async () => parse(native().usersStatus()),
        read: async () => parse(native().readUsers()) ?? { kind: 'error', error: 'bad answer from the shell' },
        write: async (text) => truthy(native().writeUsers(text)),
        forget: async () => truthy(native().forgetUsers()),
      },
      // The intents event set, a third bookmarked file (Phase 7).
      events: {
        status: async () => parse(native().eventsStatus()),
        read: async () => parse(native().readEvents()) ?? { kind: 'error', error: 'bad answer from the shell' },
        write: async (text) => truthy(native().writeEvents(text)),
        forget: async () => truthy(native().forgetEvents()),
      },
    } : {}),
    ...(platform === 'android' ? {
      paths: {
        list: async (rel) => { const v = parse(await call('listFiles', rel)); return Array.isArray(v) ? v : null; },
        read: async (rel) => parse(await call('readFile', rel)) ?? { kind: 'error', error: 'bad answer from the shell' },
        write: async (rel, text) => truthy(await call('writeFile', rel, text)),
        remove: async (rel) => truthy(await call('deleteFileAt', rel)),
        makeDir: async (rel) => truthy(await call('makeDir', rel)),
      },
    } : {}),
  };

  function launch(method, ...args) {
    return new Promise((resolve) => {
      const w = win();
      const previous = w[PICK_CALLBACK];
      const handler = (result) => {
        if (w[PICK_CALLBACK] === handler) delete w[PICK_CALLBACK];
        const parsed = parse(result);
        // A failed pick is reported, not swallowed: the shell says what went
        // wrong (no bookmark, no view controller) and the transport carries
        // {error, …} to the card and the diagnostics report.
        if (parsed && typeof parsed === 'object' && parsed.error) console.error('[direct-access] folder pick failed:', parsed);
        resolve(parsed);
      };
      w[PICK_CALLBACK] = handler;
      if (typeof previous === 'function') previous(null);
      try {
        native()[method](...args);
      } catch {
        if (w[PICK_CALLBACK] === handler) delete w[PICK_CALLBACK];
        resolve(null);
      }
    });
  }
}
