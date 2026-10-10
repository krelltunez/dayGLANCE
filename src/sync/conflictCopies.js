/**
 * Conflict copies in the Direct Access folder (docs/direct-access-sync.md,
 * Phase 8).
 *
 * When two devices write one file inside a syncing tool's round trip, the
 * tool keeps the losing write beside the file under its own name: Nextcloud
 * "dayglance-sync (conflicted copy 2026-10-10 111717).json", Dropbox
 * "dayglance-sync (Mac's conflicted copy 2026-10-10).json", Google Drive
 * "dayglance-sync (1).json", Syncthing "dayglance-sync.sync-conflict-
 * 20261010-111717-ABCDEFG.json", OneDrive "dayglance-sync-DESKTOP-X.json".
 * The write rules keep these rare now; this sweep deals with the ones that
 * still happen and with the ones already there.
 *
 *   • A snapshot copy is merged into this device's data with the same merge
 *     the live file gets (task-level, last writer wins, tombstones honoured),
 *     applied when it changes anything, and then removed. Whatever it held
 *     that was newer is now in this device's state, which the vault pushes
 *     and the file cycle relays; a copy that held nothing newer is removed
 *     the same.
 *   • A roster copy is reconciled into the roster the same way the roster
 *     sync reconciles the live file, then removed.
 *   • An events copy is removed without a merge: the event set is a union
 *     and every sender keeps a ledger of its own events, so a copy holds
 *     nothing the next cycle does not restore (intents/folderIntents.js).
 *   • An encrypted copy this device cannot open is left where it is and
 *     reported; one that is still being delivered is left for next time.
 *
 * Desktop and Android only: an iPhone holds bookmarks to files and cannot
 * list a directory (its folder is swept by the Macs). The sweep runs on the
 * snapshot cycle's hook every SWEEP_INTERVAL_MS, and from the diagnostics
 * panel on demand; the last result is kept for the panel.
 */

import { classifySnapshotText } from './snapshotFileSync.js';
import { sliceDiffs } from './snapshotMergeExplain.js';
import { reconcileRoster, relativeRosterPaths } from '../intents/sharedUsers.js';
import { relativeEventsPath, EVENTS_FILENAME } from '../intents/folderIntents.js';

export const SNAPSHOT_FILENAME = 'dayglance-sync.json';
export const USERS_FILENAME = 'glance-users.json';
export const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

/**
 * A sibling the syncing tool made from `filename`: same stem, `.json`, not
 * the file itself, and the stem followed by what the tools append (a space,
 * a dot, a dash or a bracket), so "dayglance-sync-notes.json" is one too and
 * "dayglance-syncopated.json" is not.
 */
export function isConflictCopy(name, filename) {
  if (typeof name !== 'string' || name === filename) return false;
  const stem = filename.replace(/\.json$/, '');
  if (!name.startsWith(stem) || !name.endsWith('.json')) return false;
  return /^[ .\-(]/.test(name.slice(stem.length));
}

export const conflictCopiesIn = (names, filename) =>
  (Array.isArray(names) ? names : []).filter((n) => isConflictCopy(n, filename)).sort();

const dirOf = (rel) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
const joinRel = (dir, name) => (dir ? `${dir}/${name}` : name);

/**
 * The copies in the folder: `{ rel, name, kind }` per file, for the three
 * files this tier keeps. Null when the transport cannot list (an iPhone).
 */
export async function listConflictCopies(transport, { usersPath, eventsPath } = {}) {
  if (!transport?.files?.supported?.()) return null;
  const places = [
    { dir: '', filename: SNAPSHOT_FILENAME, kind: 'snapshot' },
    { dir: relativeRosterPaths(usersPath).dirPath.replace(/\/$/, ''), filename: USERS_FILENAME, kind: 'roster' },
    { dir: dirOf(relativeEventsPath(eventsPath)), filename: EVENTS_FILENAME, kind: 'events' },
  ];
  const out = [];
  for (const { dir, filename, kind } of places) {
    const names = await transport.files.list(dir);
    for (const name of conflictCopiesIn(names, filename)) out.push({ rel: joinRel(dir, name), name, kind });
  }
  return out;
}

export const sweepStorageKey = (transport) => `${transport.lastSyncedKey ?? transport.id ?? 'direct-access'}:conflicts`;

/** The last sweep's result for the diagnostics panel, or null. */
export function lastSweep(storage, transport) {
  try {
    const raw = storage?.getItem(sweepStorageKey(transport));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/**
 * Merges and removes the copies. Never throws for a copy: each gets a row
 * `{ rel, name, kind, outcome, detail? }` with outcome one of 'merged'
 * (snapshot or roster, data applied), 'removed' (nothing newer, or an
 * events copy), 'needs-key', 'downloading', 'unreadable', 'remove-failed'.
 *
 * @param {object} args
 * @param {object} args.transport   files.{supported,list,read,remove}, lastSyncedKey
 * @param {object} args.io
 * @param {() => object} args.io.buildSyncPayload
 * @param {(data: object, opts: object) => void} args.io.applyEngineData
 * @param {(local: object, remote: object, days: number) => {data, localChanged}} args.io.mergeSyncData
 * @param {number} [args.io.syncRetentionDays]
 * @param {(v: object) => boolean} args.io.isEncryptedEnvelope
 * @param {(v: object) => Promise<object>} args.io.decryptData
 * @param {Array} [args.io.localUsers]        the roster, for a roster copy
 * @param {(merged: Array) => void} [args.io.applyUsers]
 * @param {string} [args.io.usersPath]
 * @param {string} [args.io.eventsPath]
 * @param {Storage} [args.io.storage]          where the result is kept
 * @param {Console} [args.io.log]
 * @param {() => number} [args.now]
 * @returns {Promise<{at: string, copies: Array}|null>} null when the transport cannot list
 */
export async function sweepConflictCopies({ transport, io, now = Date.now }) {
  const log = io.log ?? console;
  const copies = await listConflictCopies(transport, { usersPath: io.usersPath, eventsPath: io.eventsPath });
  if (!copies) return null;
  const rows = [];
  for (const copy of copies) {
    const row = { ...copy };
    try {
      const outcome = await sweepOne(transport, io, copy);
      Object.assign(row, outcome);
    } catch (err) {
      row.outcome = 'unreadable';
      row.detail = err?.message ?? String(err);
    }
    if (row.outcome !== 'needs-key' && row.outcome !== 'downloading') log.info?.(`[direct-access] conflict copy ${row.name}: ${row.outcome}`);
    rows.push(row);
  }
  const result = { at: new Date(now()).toISOString(), copies: rows };
  try { io.storage?.setItem(sweepStorageKey(transport), JSON.stringify(result)); } catch { /* ignore */ }
  return result;
}

async function sweepOne(transport, io, copy) {
  const remove = async (outcome, detail) => {
    const ok = await transport.files.remove(copy.rel);
    return ok ? { outcome, ...(detail ? { detail } : {}) } : { outcome: 'remove-failed', detail: detail ?? outcome };
  };
  if (copy.kind === 'events') return remove('removed', 'the event set restores its own');

  const read = classifySnapshotText(await transport.files.read(copy.rel));
  if (read.kind === 'absent') return { outcome: 'removed', detail: 'already gone' };
  if (read.kind === 'downloading') return { outcome: 'downloading' };
  if (read.kind === 'error') return { outcome: 'unreadable', detail: read.error };
  if (read.kind === 'unparseable') return remove('removed', 'not a snapshot');

  if (copy.kind === 'roster') {
    const r = reconcileRoster(JSON.stringify(read.remote), io.localUsers ?? []);
    if (r && Array.isArray(io.localUsers) && typeof io.applyUsers === 'function') {
      const before = JSON.stringify([...io.localUsers].map((u) => [u.syncId ?? u.id, u.updatedAt]).sort());
      const after = JSON.stringify(r.merged.map((u) => [u.syncId ?? u.id, u.updatedAt]).sort());
      if (before !== after) { io.applyUsers(r.merged); return remove('merged'); }
    }
    return remove('removed', 'nothing newer');
  }

  // The snapshot.
  let remote = read.remote;
  if (io.isEncryptedEnvelope(remote)) {
    try { remote = await io.decryptData(remote); }
    catch (err) { return { outcome: 'needs-key', detail: err?.message ?? String(err) }; }
  }
  if (!remote?.data) return remove('removed', 'not a snapshot');
  const local = io.buildSyncPayload()?.data;
  if (!local) return { outcome: 'unreadable', detail: 'no local payload' };
  const { data, localChanged } = io.mergeSyncData(local, remote.data, io.syncRetentionDays ?? 90);
  const changed = localChanged && sliceDiffs(data, local, { ignoreDropped: true }).length > 0;
  if (changed) {
    io.applyEngineData(data, { allowEmpty: true });
    return remove('merged');
  }
  return remove('removed', 'nothing newer');
}
