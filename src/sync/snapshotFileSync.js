/**
 * dayGLANCE's snapshot-file cycle: `@glance-apps/sync` 2.1.0's
 * `runSnapshotFileCycle` with this app's seams filled in.
 *
 * A snapshot-file transport is a local file that something else ferries
 * between devices: the iCloud ubiquity container, a Google Drive / Dropbox /
 * Syncthing folder with Direct Access (docs/direct-access-sync.md). The cycle
 * itself (seed guard, empty-state guard, first-run prompt, envelope rules,
 * content gate, made-here versus relay, writer-rank stagger) lives in the
 * package so lastGLANCE and lifeGLANCE run the identical loop; the package
 * spec (docs/SYNC_PACKAGE_SPEC.md there, "Snapshot-File Cycle") is its
 * contract and its tests are the guards' tests. The scenarios in
 * snapshotFileSync.test.js hold this wrapper to the same behaviour over the
 * real package.
 *
 * What is dayGLANCE's, and supplied here:
 *
 *   • the two device-local stamps, LOCAL_MODIFIED_KEY (shared with the WebDAV
 *     engine) and LOCAL_EDIT_KEY (set by the persist pass for an edit made
 *     here, not for an apply; hooks/useDataPersistence.js);
 *   • what counts as data: tasks and inbox items (utils/icloudSyncPref.js),
 *     both for the empty-state guard and for the first-run prompt;
 *   • what is written: health-store counts are stripped from every copy
 *     written out on the transports that ask for it (`transport.stripsHealthLogs`,
 *     absent means strip): iCloud does, for Apple's guideline 5.1.3; Direct
 *     Access is someone else's folder and carries them, exactly as GLANCEvault
 *     and WebDAV do. Stripping there is what kept an Android phone's Health
 *     Connect steps from ever reaching the Macs (2026-10-07).
 *
 * Nothing here touches React. The hook (hooks/useSnapshotFileSync.js) owns the
 * poll, the mutex and the prompt state; App.jsx owns i18n and status UI.
 */

import { runSnapshotFileCycle as runPackageCycle } from '@glance-apps/sync';
import { payloadHasData } from '../utils/icloudSyncPref.js';

export {
  classifySnapshotText,
  relayDecision,
  relayWaitMs,
  noteWriter,
  readWriters,
  RELAY_CONFIRM_MS,
  RELAY_STAGGER_MS,
} from '@glance-apps/sync';

/** Shared with the WebDAV engine: when this device last changed synced data. */
export const LOCAL_MODIFIED_KEY = 'day-planner-cloud-sync-local-modified';

/**
 * When this device itself last changed its data. Set by the persist pass for
 * an edit made here and not for an apply from a transport
 * (hooks/useDataPersistence.js). Device-local, never synced.
 */
export const LOCAL_EDIT_KEY = 'day-planner-local-edit-at';

const count = (storage, key) => {
  try { return JSON.parse(storage.getItem(key) || '[]').length; }
  catch { return 0; }
};

/**
 * Runs one cycle. Same arguments and outcomes as the package's
 * `runSnapshotFileCycle`, plus dayGLANCE's own:
 *
 * @param {object} args
 * @param {object} args.transport                                 see the package
 * @param {boolean} [args.transport.stripsHealthLogs=true]        strip health-store counts from what is written
 * @param {object} args.io                                        see the package
 * @param {(payload: object, habits: Array) => object} args.io.stripHealthSourcedLogs
 * @param {Array}    args.io.habits
 * @param {() => string|null} [args.io.lastLocalEditAt]           default: LOCAL_EDIT_KEY in storage
 * @param {object} args.state                                     carried between cycles
 */
export async function runSnapshotFileCycle({ transport, io, state }) {
  const outgoing = transport.stripsHealthLogs === false
    ? (payload) => payload
    : (payload) => io.stripHealthSourcedLogs(payload, io.habits);
  return runPackageCycle({
    transport,
    io: {
      ...io,
      localModifiedKey: LOCAL_MODIFIED_KEY,
      lastLocalEditAt: io.lastLocalEditAt ?? (() => io.storage.getItem(LOCAL_EDIT_KEY)),
      localItemCount: () => count(io.storage, 'day-planner-tasks') + count(io.storage, 'day-planner-unscheduled'),
      hasData: payloadHasData,
      outgoing,
    },
    state,
  });
}
