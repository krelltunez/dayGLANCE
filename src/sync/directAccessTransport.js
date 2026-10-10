/**
 * Direct Access as a snapshot-file transport (sync/snapshotFileSync.js).
 *
 * The user picks a folder that a third-party tool already keeps in step across
 * devices (Google Drive for desktop, Dropbox, OneDrive, Syncthing, a network
 * share). dayGLANCE reads and writes dayglance-sync.json in it; the tool moves
 * it. The cycle, the merge and every data-safety guard are the ones iCloud
 * uses (docs/direct-access-sync.md); this module is the bridge to the Electron
 * main process (electron/directAccess.ts), which holds the folder, plus the
 * small state machine the settings panel renders.
 *
 * Differences from the iCloud transport, each deliberate:
 *
 *   • OFF until a folder is picked. There is no entitlement to come back on by
 *     itself, so there is no tri-state preference and no first-run prompt:
 *     picking the folder IS the decision, and the snapshot in it is applied.
 *   • `allowsPlaintextReseed` is false. The folder is someone else's cloud; an
 *     encrypted file this device cannot read is left exactly as it is.
 *   • `stripsHealthLogs` is false. The iCloud file leaves out HealthKit-derived
 *     counts for Apple's guideline 5.1.3, which is about Apple's container. This
 *     folder is the user's own cloud, so the file carries health-store counts
 *     like GLANCEvault and WebDAV do, and an Android phone's Health Connect
 *     steps reach the Macs (which have no health store of their own).
 *   • A longer write throttle: third-party tools round-trip slower than the
 *     iCloud daemon, and each write inside that window risks a conflict copy.
 *   • An unreachable folder (the streaming tool not running, a share not
 *     mounted) is reported once and then waited out quietly: the transport
 *     marks itself unreachable, the hook stops cycling, and each poll tick
 *     re-probes the folder so sync resumes by itself when it is back.
 *
 * The folder path and the macOS bookmark live in the main process only (on
 * Android the SAF tree URI, and on iOS the security-scoped bookmark, live in
 * the app's preferences). The renderer sees a folder name for the settings
 * card and nothing else.
 */

import { createNativeDirectAccessBridge, isNativeDirectAccessAvailable } from './directAccessNativeBridge.js';

/** Poll cadence: the tool does the network work; we read the local file. */
export const DIRECT_ACCESS_POLL_MS = 15 * 1000;
/** Drive, Dropbox and OneDrive take seconds to a minute to round-trip a change. */
export const DIRECT_ACCESS_WRITE_THROTTLE_MS = 15 * 1000;
/** Stamped by the shared cycle on every read of a real snapshot (seed guard). */
export const DIRECT_ACCESS_LAST_SYNCED_KEY = 'dayglance-direct-access-last-synced';
/** 'true' | 'false' | absent. Absent means ON once a folder is connected. */
export const DIRECT_ACCESS_PREF_KEY = 'dayglance-direct-access-enabled';
/**
 * 'true' | absent. The per-device "encrypt the file" switch (Phase 6): it
 * decides the FIRST write, seeding an absent file or upgrading a plaintext
 * one; from then on the file decides for every device. Forgotten with the
 * folder on disconnect, like the last-synced stamp.
 */
export const DIRECT_ACCESS_ENCRYPT_KEY = 'dayglance-direct-access-encrypt';

/** Read without a transport: the launch-time key gate (hooks/useCloudSync.js) runs before any folder is restored. */
export const directAccessEncryptsWrites = (storage = defaultStorage) => {
  try { return storage()?.getItem(DIRECT_ACCESS_ENCRYPT_KEY) === 'true'; }
  catch { return false; }
};

// Electron (every desktop platform) exposes the bridge directly; the Android
// WebView and the iOS shell expose synchronous native methods as
// window.DayGlanceDirectAccess, which the adapter wraps into the same shape.
// The web has no folder access a page could hold across sessions.
let nativeBridge = null;
const defaultBridge = () => {
  if (typeof window === 'undefined') return null;
  if (window.electronAPI?.directAccess) return window.electronAPI.directAccess;
  if (isNativeDirectAccessAvailable()) {
    nativeBridge ??= createNativeDirectAccessBridge();
    return nativeBridge;
  }
  return null;
};
const defaultStorage = () =>
  (typeof window !== 'undefined' ? window.localStorage : null);

/** Desktop Electron and the Android and iOS apps. Decides whether the poll even starts. */
export const isDirectAccessSupported = () => !!defaultBridge();

/**
 * @param {object} [deps]
 * @param {() => object|null} [deps.bridge]   window.electronAPI.directAccess, or a fake
 * @param {() => Storage|null} [deps.storage]
 * @param {Pick<Console,'warn'>} [deps.log]
 */
/**
 * A folder picker that never answers (a delegate that is not called, a result
 * lost on the way back into the page) would otherwise leave the card's button
 * disabled and say nothing. Long enough to browse a slow Files location.
 */
export const DIRECT_ACCESS_PICK_TIMEOUT_MS = 3 * 60 * 1000;

export function createDirectAccessTransport({ bridge = defaultBridge, storage = defaultStorage, log = console, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  // status: 'unknown' until the main process has restored its config, then
  // 'disconnected' | 'connected' | 'unreachable'. pickError is why the last
  // folder pick failed, shown on the card and in the diagnostics report until
  // the next pick; a picker that was cancelled clears it.
  // roster: on an iPhone, the roster file's own status ({configured, name,
  // path, reachable}); null where the roster is a path in the folder.
  // events: likewise for the intents event set (Phase 7).
  const state = { status: 'unknown', name: null, path: null, pickError: null, roster: null, events: null };
  const statusListeners = new Set();
  const changeListeners = new Set();
  let unsubscribeBridge = null;
  let initPromise = null;
  let reprobing = false;

  const readPref = () => {
    try { return storage()?.getItem(DIRECT_ACCESS_PREF_KEY) ?? null; }
    catch { return null; }
  };
  const isEnabled = () => readPref() !== 'false';
  const encryptsWrites = () => directAccessEncryptsWrites(storage);
  const isConnected = () => state.status === 'connected' || state.status === 'unreachable';

  // The settings panel reads this through useSyncExternalStore, which needs
  // the same object back until something changed.
  const compute = () => ({
    supported: !!bridge(),
    status: state.status,
    name: state.name,
    path: state.path,
    connected: isConnected(),
    enabled: isEnabled(),
    encrypt: encryptsWrites(),
    pickError: state.pickError,
    roster: state.roster,
    events: state.events,
  });
  let snapshot = compute();
  const notify = () => {
    snapshot = compute();
    for (const l of statusListeners) {
      try { l(snapshot); } catch { /* a listener error must not break the others */ }
    }
  };
  const emitChanged = () => {
    for (const cb of changeListeners) {
      try { cb(); } catch { /* ditto */ }
    }
  };

  const applyStatus = (st) => {
    if (!st || !st.configured) {
      state.status = 'disconnected';
      state.name = null;
      state.path = null;
    } else {
      state.status = st.reachable ? 'connected' : 'unreachable';
      state.name = st.name ?? null;
      state.path = st.path ?? null;
    }
    notify();
  };

  // Ask the main process to re-open the folder it remembers. Once per session;
  // every entry point funnels through here so the order of first use does not
  // matter.
  const ensureInit = () => {
    if (initPromise) return initPromise;
    const b = bridge();
    if (!b) {
      initPromise = Promise.resolve();
      return initPromise;
    }
    initPromise = (async () => {
      try {
        applyStatus(await b.restore());
      } catch (e) {
        log.warn('[direct-access] restore failed:', e?.message ?? e);
        applyStatus(null);
      }
      if (b.users?.status) {
        try { state.roster = normalizeFileStatus(await b.users.status()); notify(); } catch { /* unknown until a pick */ }
      }
      if (b.events?.status) {
        try { state.events = normalizeFileStatus(await b.events.status()); notify(); } catch { /* unknown until a pick */ }
      }
    })();
    return initPromise;
  };

  // While unreachable, each poll tick asks the main process whether the folder
  // is back. Resuming also kicks a cycle, so a change that landed while the
  // folder was away is picked up at once rather than a poll later.
  const reprobe = async () => {
    if (reprobing) return;
    reprobing = true;
    try {
      const st = await bridge()?.status();
      const was = state.status;
      applyStatus(st);
      if (was !== 'connected' && state.status === 'connected') emitChanged();
    } catch { /* still away */ }
    finally { reprobing = false; }
  };

  const normalizeFileStatus = (st) => (st && st.configured
    ? { configured: true, name: st.name ?? null, path: st.path ?? null, reachable: !!st.reachable }
    : { configured: false, name: null, path: null, reachable: false });

  const clearLastSynced = () => {
    try { storage()?.removeItem(DIRECT_ACCESS_LAST_SYNCED_KEY); } catch { /* ignore */ }
  };
  const writePref = (enabled) => {
    try { storage()?.setItem(DIRECT_ACCESS_PREF_KEY, enabled ? 'true' : 'false'); } catch { /* ignore */ }
  };
  const writeEncryptPref = (on) => {
    try {
      if (on) storage()?.setItem(DIRECT_ACCESS_ENCRYPT_KEY, 'true');
      else storage()?.removeItem(DIRECT_ACCESS_ENCRYPT_KEY);
    } catch { /* ignore */ }
  };

  // A file slot beside the snapshot: the household roster (Phase 5) and the
  // intents event set (Phase 7). Desktop and Android bridges offer files by
  // path (`paths`, confined to the folder in the shell); an iPhone has no
  // folder and offers each as its own bookmarked file (`users`, `events`).
  // The caller never branches on which: it hands over the relative path and
  // gets the same string contract the snapshot read has (classifySnapshotText).
  const fileSlot = (name, label) => ({
    supported: () => {
      const b = bridge();
      return !!(b && (b.paths || b[name]));
    },
    read: async (relPath) => {
      const b = bridge();
      if (!b) return JSON.stringify({ error: 'no bridge' });
      let r;
      try {
        if (b[name]) r = await b[name].read();
        else if (b.paths) r = await b.paths.read(relPath);
        else return JSON.stringify({ error: `the ${label} is not reachable on this platform` });
      } catch (err) {
        return JSON.stringify({ error: err?.message ?? String(err) });
      }
      switch (r?.kind) {
        case 'absent': return null;
        case 'downloading': return JSON.stringify({ downloading: true });
        case 'text': return r.text;
        default: return JSON.stringify({ error: r?.error ?? `${label} unavailable` });
      }
    },
    // Creates the directory on a failed write, the way the iCloud roster sync
    // does; an iPhone's bookmarked file has no directory to create.
    write: async (relPath, text) => {
      const b = bridge();
      if (!b) return false;
      try {
        if (b[name]) return (await b[name].write(text)) === true;
        if (!b.paths) return false;
        if ((await b.paths.write(relPath, text)) === true) return true;
        const dir = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '';
        if (dir) await b.paths.makeDir(dir);
        return (await b.paths.write(relPath, text)) === true;
      } catch {
        return false;
      }
    },
    /** iOS: forget the bookmarked file for this slot. */
    forget: async () => {
      const b = bridge();
      try { await b?.[name]?.forget?.(); } catch { /* forgotten on this side regardless */ }
      const next = b?.[name] ? normalizeFileStatus(null) : null;
      if (name === 'users') state.roster = next; else state.events = next;
      notify();
    },
  });
  const usersSlot = fileSlot('users', 'roster');
  const eventsSlot = fileSlot('events', 'event set');

  // Files by path, confined to the folder in the shell: what the conflict
  // copy sweep (sync/conflictCopies.js) lists, reads and removes. Desktop and
  // Android only; an iPhone holds bookmarks to files and cannot list.
  const files = {
    supported: () => !!bridge()?.paths,
    list: async (dir) => {
      const b = bridge();
      if (!b?.paths) return null;
      try { const v = await b.paths.list(dir); return Array.isArray(v) ? v : null; } catch { return null; }
    },
    read: async (rel) => {
      const b = bridge();
      if (!b?.paths) return JSON.stringify({ error: 'files by path are not reachable on this platform' });
      let r;
      try { r = await b.paths.read(rel); } catch (err) { return JSON.stringify({ error: err?.message ?? String(err) }); }
      switch (r?.kind) {
        case 'absent': return null;
        case 'downloading': return JSON.stringify({ downloading: true });
        case 'text': return r.text;
        default: return JSON.stringify({ error: r?.error ?? 'file unavailable' });
      }
    },
    remove: async (rel) => {
      const b = bridge();
      if (!b?.paths) return false;
      try { return (await b.paths.remove(rel)) === true; } catch { return false; }
    },
  };

  return {
    id: 'direct-access',
    pollMs: DIRECT_ACCESS_POLL_MS,
    writeThrottleMs: DIRECT_ACCESS_WRITE_THROTTLE_MS,
    lastSyncedKey: DIRECT_ACCESS_LAST_SYNCED_KEY,
    allowsPlaintextReseed: false,
    stripsHealthLogs: false,

    isSupported: () => !!bridge(),

    isAvailable: () => {
      if (!bridge()) return false;
      if (state.status === 'unknown') { ensureInit(); return false; }
      if (state.status === 'unreachable') { reprobe(); return false; }
      return state.status === 'connected';
    },

    // Maps the main process's classification onto the string contract the
    // shared cycle reads (classifySnapshotText).
    read: async () => {
      const r = await bridge().read();
      switch (r?.kind) {
        case 'absent': return null;
        case 'downloading': return JSON.stringify({ downloading: true });
        case 'text': return r.text;
        default: {
          // The folder went away under us. Say so once (the cycle surfaces the
          // error), then wait quietly: see reprobe().
          if (state.status === 'connected') {
            state.status = 'unreachable';
            notify();
          }
          return JSON.stringify({ error: r?.error ?? 'folder unavailable' });
        }
      }
    },

    write: async (text) => (await bridge().write(text)) === true,

    // ── The household roster (docs/direct-access-sync.md, Phase 5) ──────
    // glance-users.json at a path relative to the folder, the same place the
    // WebDAV tier keeps it (fileSlot above).
    rosterSupported: usersSlot.supported,
    rosterRead: usersSlot.read,
    rosterWrite: usersSlot.write,
    // ── The intents event set (Phase 7): glance-events.json, likewise. ──
    eventsSupported: eventsSlot.supported,
    eventsRead: eventsSlot.read,
    eventsWrite: eventsSlot.write,
    // ── Files by path (Phase 8: conflict copies). ──
    files,

    // Push signals: the main process's folder watcher, a folder picked or
    // re-enabled in settings, and a folder that came back from unreachable.
    onChanged: (cb) => {
      changeListeners.add(cb);
      if (!unsubscribeBridge) unsubscribeBridge = bridge()?.onChanged?.(() => emitChanged()) ?? null;
      return () => {
        changeListeners.delete(cb);
        if (changeListeners.size === 0 && unsubscribeBridge) {
          unsubscribeBridge();
          unsubscribeBridge = null;
        }
      };
    },

    kicksOnVisibility: () => true,

    isEnabled,
    setEnabled: (enabled) => {
      writePref(enabled);
      notify();
      if (enabled) emitChanged();
    },
    /** Phase 6. Turning it on kicks a cycle so the upgrade is written now; off changes nothing until the file is replaced. */
    encryptsWrites,
    setEncryptsWrites: (on) => {
      writeEncryptPref(!!on);
      notify();
      if (on) emitChanged();
    },
    // Picking the folder is the decision; the snapshot in it is applied.
    firstRunDecided: () => true,

    // ── Settings surface ─────────────────────────────────────────────────
    subscribe: (listener) => {
      statusListeners.add(listener);
      ensureInit();
      return () => statusListeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    isConnected,

    /**
     * Native folder picker. Resolves to the new snapshot, or null when the
     * picker was cancelled, failed (snapshot.pickError says why), or never
     * answered. A Nextcloud folder picked on an iPhone did nothing, and
     * nothing on the device said why (2026-10-08).
     */
    pickFolder: async () => runPick('pick'),
    /** iOS: the sync file itself, picked (pickFile) or created in a chosen folder (createFile). */
    pickFile: async () => runPick('pickFile'),
    createFile: async () => runPick('createFile'),
    /** iOS: the household roster, a second bookmarked file (Phase 5). */
    pickUsersFile: async () => runPick('pickFile', 'users'),
    createUsersFile: async () => runPick('createFile', 'users'),
    forgetUsersFile: usersSlot.forget,
    /** iOS: the intents event set, a third bookmarked file (Phase 7). */
    pickEventsFile: async () => runPick('pickFile', 'events'),
    createEventsFile: async () => runPick('createFile', 'events'),
    forgetEventsFile: eventsSlot.forget,

    disconnect: async () => {
      try { await bridge()?.disconnect(); } catch { /* the renderer side still forgets it */ }
      clearLastSynced();
      writeEncryptPref(false);
      applyStatus(null);
    },

    /** The shell's own view of the folder, verbatim, for the diagnostics report. */
    probeStatus: async () => {
      const b = bridge();
      if (!b) return null;
      try { return await b.status(); } catch (err) { return { error: err?.message ?? String(err) }; }
    },

    /** Deletes the snapshot in the folder (reset scope "everywhere"). */
    deleteSnapshot: async () => (await bridge()?.deleteFile()) === true,
  };

  async function runPick(method, slot = 'snapshot') {
    const b = bridge();
    if (!b) return null;
    if (typeof b[method] !== 'function' || (slot !== 'snapshot' && !b[slot])) {
      state.pickError = 'not available on this platform';
      notify();
      return null;
    }
    let timer = null;
    const timeout = new Promise((resolve) => {
      timer = setTimer(() => resolve({ error: 'the picker returned no result' }), DIRECT_ACCESS_PICK_TIMEOUT_MS);
    });
    let st;
    try { st = await Promise.race([method === 'pick' ? b.pick() : b[method](slot), timeout]); }
    catch (err) { st = { error: err?.message ?? String(err) }; }
    finally { clearTimer(timer); }
    if (st && typeof st === 'object' && st.error) {
      state.pickError = st.error + (st.path ? ` (${st.path})` : '');
      log.warn?.('[direct-access] folder pick failed:', st);
      notify();
      return null;
    }
    if (state.pickError) { state.pickError = null; notify(); }
    if (!st) return null;
    if (slot !== 'snapshot') {
      // The roster or events file: its own status, nothing about the snapshot changes.
      if (slot === 'users') state.roster = normalizeFileStatus(st);
      else state.events = normalizeFileStatus(st);
      notify();
      return snapshot;
    }
    // A different folder has its own history: the seed guard must not read
    // an empty new folder as an eviction of the old one and wait ten
    // minutes before seeding it.
    clearLastSynced();
    writePref(true);
    applyStatus(st);
    emitChanged();
    return snapshot;
  }
}

/** The app's one Direct Access transport. */
export const directAccessTransport = createDirectAccessTransport();
