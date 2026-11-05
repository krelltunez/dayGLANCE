// Where the index of reported note paths lives, and how it is kept current
// (#2291 follow-up: task notes). The structure and the resolution are pure,
// in utils/reportedNotePaths.js; this is the storage and the two feeds.
//
// DEVICE-LOCAL. Paths only, never content. Not synced, not in the sync
// payload or a backup, not a task field: every device builds its own from
// the stream. One IndexedDB value (a few thousand paths is plausible, too
// much for the localStorage budget), falling back to localStorage where
// there is no IndexedDB (utils/idbKeyValue.js). It is keyed to the pairing
// (reportedNoteIndexKey): another vault, account or re-pair reads as no
// index and is rebuilt over it.
//
// NOT LOADED IS NOT EMPTY. A value that cannot be read, or is for another
// pairing, is an INCOMPLETE index, never "no notes": the task panel then
// resolves a name the way it did before the index (taskNoteSources.js
// taskNoteCandidates), and the next listing from zero rebuilds it.
//
// TWO FEEDS, ONE CURSOR OF ITS OWN.
//  • The sync cycle's observation pull, on a device on the stream side
//    (useObsidianSync): the batch it already decrypted, handed over as
//    paths with their row seqs. Applied only where it continues the index
//    (it starts at or below the index's seq); the cycle's cursor and its
//    commit-after-merge rule are untouched. In the holding posture, where
//    the index is read, a batch that does not continue it starts the
//    listing below.
//  • A listing of the index's own (listReportedNotePaths), from the index's
//    seq, or ONCE from zero while it has never been completed: when the
//    task panel resolves a name (a device without the folder runs no cycle
//    at all), and from the cycle as above. It reads past the cycle's cursor
//    without moving it. Complete only once a listing from zero has read
//    every page; a failed listing leaves the index as it was.
//
// Every read-modify-write runs in order, and applying is per path by row
// seq, so the two feeds may land in either order.

import { createIdbKeyValue } from './idbKeyValue.js';
import { getVaultConfig } from '../sync/vaultConfig.js';
import { getBridgePairingMeta } from './obsidianBridgeStream.js';
import { listReportedNotePaths } from './obsidianBridgeInbound.js';
import { reportedNoteIndexKey, readableReportedNoteIndex, mergeReportedNotePaths } from './reportedNotePaths.js';

export const REPORTED_NOTE_INDEX_DB = 'dayglance-bridge-note-paths';
export const REPORTED_NOTE_INDEX_STORAGE_KEY = 'dayglance-bridge-note-paths';
/** How long a task panel waits for the index to catch up before it resolves with what is stored (or, with no index yet, guesses). */
export const REPORTED_NOTE_INDEX_BUDGET_MS = 3000;

let kv = createIdbKeyValue(REPORTED_NOTE_INDEX_DB);
/** For tests: another key/value store (createMemoryKeyValue), or null for the real one. */
export function __setReportedNoteIndexStorageForTests(store) {
  kv = store ?? createIdbKeyValue(REPORTED_NOTE_INDEX_DB);
  refreshInFlight = null;
}

let chain = Promise.resolve();
function inOrder(work) {
  const run = chain.then(work, work);
  chain = run.catch(() => {});
  return run;
}

async function readStored() {
  try { return await kv.get(REPORTED_NOTE_INDEX_STORAGE_KEY); } catch { return undefined; }
}

// The pairing this device reads now, or null (no GLANCEvault, unpaired).
async function currentIndexKey() {
  const cfg = getVaultConfig();
  if (!cfg?.enabled || !cfg.vaultUrl || !cfg.vaultToken || !cfg.accountId) return null;
  try { return reportedNoteIndexKey(cfg, await getBridgePairingMeta()); } catch { return null; }
}

/**
 * Apply one listing (the cycle's pathListing, or listReportedNotePaths') to
 * the stored index: { index, applied }. `index` is the index for the
 * listing's pairing as it stands afterwards (null when there is none).
 * Applied in memory even if the write fails, so the caller can use it now;
 * the next listing from the stored seq covers the write that was lost.
 */
export function applyReportedNoteListing(listing) {
  return inOrder(async () => {
    if (!listing?.key) return { index: null, applied: false };
    const held = readableReportedNoteIndex(await readStored(), listing.key);
    const { index, applied } = mergeReportedNotePaths(held, listing);
    if (!applied) return { index: held, applied: false };
    try { await kv.set(REPORTED_NOTE_INDEX_STORAGE_KEY, index); } catch { /* used this time; rebuilt from the stored seq */ }
    return { index, applied: true };
  });
}

let refreshInFlight = null;
/**
 * Bring the index up to the stream: a listing from its seq, or from zero
 * while it has never been completed. Resolves to the complete index, or null
 * when no listing could be made or applied (the stored index is untouched).
 * One at a time: a call while one runs shares it.
 */
export function refreshReportedNoteIndex() {
  if (refreshInFlight) return refreshInFlight;
  const run = (async () => {
    try {
      const key = await currentIndexKey();
      if (!key) return null;
      const held = readableReportedNoteIndex(await readStored(), key);
      const listing = await listReportedNotePaths({ since: held?.complete ? held.seq : 0 });
      if (!listing) return null;
      const { index, applied } = await applyReportedNoteListing(listing);
      return applied && index?.complete ? index : null;
    } catch {
      return null;
    } finally {
      if (refreshInFlight === run) refreshInFlight = null;
    }
  })();
  refreshInFlight = run;
  return run;
}

/**
 * The index to resolve a task's link against, for the task panel: brought
 * up to the stream first, within a budget. { index, fresh }: `fresh` when
 * the listing finished in time (the index is current), else the stored
 * index as it is (the listing carries on and saves when it lands). `index`
 * is null, or not complete, when there is none to trust yet.
 */
export async function reportedNoteIndexForRead({ budgetMs = REPORTED_NOTE_INDEX_BUDGET_MS } = {}) {
  let timer;
  const late = Symbol('late');
  const refreshed = await Promise.race([
    refreshReportedNoteIndex(),
    new Promise((resolve) => { timer = setTimeout(() => resolve(late), budgetMs); }),
  ]);
  clearTimeout(timer);
  if (refreshed && refreshed !== late) return { index: refreshed, fresh: true };
  try {
    const key = await currentIndexKey();
    return { index: readableReportedNoteIndex(await readStored(), key), fresh: false };
  } catch {
    return { index: null, fresh: false };
  }
}

/**
 * The sync cycle's pull, handed over (fetchBridgeObservations' pathListing).
 * Applied where it continues the index. With `catchUp` (the holding
 * posture, where the index is read) a pull that does not continue it, or an
 * index never completed, starts a listing of the index's own. Never throws;
 * the cycle does not wait on it.
 */
export async function noteCyclePathListing(listing, { catchUp = false } = {}) {
  try {
    const { index, applied } = listing ? await applyReportedNoteListing(listing) : { index: null, applied: false };
    if (applied) return index;
    return catchUp ? await refreshReportedNoteIndex() : null;
  } catch {
    return null;
  }
}
