// Re-exports from @glance-apps/sync.
// dayGLANCE tasks use `lastModified` for the per-item timestamp, so
// mergeTaskArrays pins timestampField rather than re-exporting the alias
// directly (which would default to `updatedAt`).
import { mergeArrayById, mergeSyncData as upstreamMergeSyncData, pruneTombstones } from '@glance-apps/sync';
import { canonicalJson } from './sync/snapshotMergeExplain.js';
import { mergeDeferrals } from './utils/deferrals.js';
import { mergePlanTrail, sameTrail } from './utils/planTrail.js';
import { sameOccurrenceEdits, withMergedExceptions } from '@glance-apps/dayglance-vault';
import { earlierCreatedAt } from './utils/createdAt.js';
import {
  TOMBSTONE_BUNDLE_KEYS,
  tombstoneCutoff,
  pruneTombstoneMap,
  unionNewerIso as unionTombstones,
  pruneCompletedTaskUids,
} from '@glance-apps/dayglance-vault';
import { mergeRetiredTaskIds, pruneRetiredTaskIds, applyRetirementsToTaskLists } from './utils/retiredTaskIds.js';
import { dropTombstonedObsidianTasks, dropTombstonedObsidianNotes } from './utils/obsidianDeletions.js';
import { containObsidianGhostRows } from './utils/obsidianGhostRows.js';
import { mergeDayWindowMaps, dayWindowMapsEqual, migrateDayWindows } from '@glance-apps/dayglance-vault';
import { mergeJoboCollections } from './jobo/ledger.js';
import { mergeHabitLogs, mergeRoutineCompletions, mergeCompletedDates } from '@glance-apps/dayglance-vault';

/**
 * Resolves the one case the id-keyed merge cannot: the same id on both sides
 * with EQUAL timestamps and DIFFERENT content. The upstream merge keeps the
 * local copy there, which is fine between a device and a server (the server
 * is one copy) and never converges between two devices sharing a file: each
 * writes its own copy, reads the other's, keeps its own, writes again. Two
 * Macs did exactly that over a Nextcloud folder for most of an hour
 * (2026-10-05), on two Obsidian-imported inbox tasks whose bookkeeping fields
 * (not edit-stamped by design, utils/stampTimestamps.js) had drifted while one
 * Mac was cut off from the vault.
 *
 * The pick is a total order on content (the canonical JSON that sorts lower),
 * so both devices choose the same copy whichever side they see it from, and
 * choosing it twice changes nothing. Equal stamps mean no user edit separates
 * the copies, only bookkeeping either device re-derives, so which copy wins
 * matters less than that they agree.
 *
 * @returns {{merged: Array, localChanged: boolean, remoteChanged: boolean}}
 */
export function breakTimestampTies(merged, local, remote, tsField = 'lastModified') {
  const byId = (list) => new Map((list || []).filter((t) => t && t.id !== undefined).map((t) => [String(t.id), t]));
  const localById = byId(local);
  const remoteById = byId(remote);
  let localChanged = false;
  let remoteChanged = false;
  const out = (merged || []).map((item) => {
    if (!item || item.id === undefined) return item;
    const l = localById.get(String(item.id));
    const r = remoteById.get(String(item.id));
    if (!l || !r) return item;
    if (new Date(l[tsField] || 0).getTime() !== new Date(r[tsField] || 0).getTime()) return item;
    const cl = canonicalJson(l);
    const cr = canonicalJson(r);
    if (cl === cr) return item;
    const pick = cl < cr ? l : r;
    if (pick === r) localChanged = true; else remoteChanged = true;
    return pick;
  });
  return { merged: out, localChanged, remoteChanged };
}

export const mergeTaskArrays = (local, remote, deletedIds, syncHorizon = null) => {
  const r = mergeArrayById(local, remote, deletedIds, syncHorizon, { timestampField: 'lastModified' });
  const t = breakTimestampTies(r.merged, local, remote);
  return { merged: t.merged, localChanged: r.localChanged || t.localChanged, remoteChanged: r.remoteChanged || t.remoteChanged };
};

/**
 * The id-keyed lists the upstream merge resolves by lastModified. `habits` is
 * here since 2026-10-09: an iPhone held a copy of the Steps habit with the
 * same stamp as the folder's but different content (the upstream habit merge
 * keeps local on a tie), so its dry run read "habits: 1 changed" forever and
 * the two copies never converged.
 */
const TIMESTAMPED_LISTS = ['tasks', 'unscheduledTasks', 'recycleBin', 'recurringTasks', 'todayRoutines', 'habits'];

/** The task lists governed by `deletedTaskIds`, where the epoch restore applies. */
const TASK_LISTS = ['tasks', 'unscheduledTasks', 'recycleBin', 'recurringTasks'];

/** A stamp that means "not stamped yet", not "ancient": absent, or the epoch. */
const isUnstamped = (ts) => !ts || !(new Date(ts).getTime() > 0);

/**
 * Keeps local-only tasks the upstream fence dropped for carrying no real stamp.
 *
 * The fence (mergeArrayById): a local-only task whose lastModified is older
 * than the remote's `tombstonePrunedBefore` is presumed deleted elsewhere with
 * its tombstone already pruned, and is dropped rather than uploaded. Right for
 * a task with a real old stamp. Wrong for a fresh Obsidian import or a bridge
 * inbound row, which carry lastModified = epoch ON PURPOSE (obsidian.js,
 * obsidianBridgeInbound.js) so that any real edit elsewhere outranks them: the
 * fence read 1970 as ancient, so the file tier never uploaded a fresh note
 * line, and the apply then dropped it from state every cycle while the rescue
 * put it back (two Macs, 2026-10-07: "unscheduledTasks: -2 only on other side
 * (obsidian-dg-…)" on every check). The vault tier carried such tasks all
 * along; the file tier now does too.
 *
 * A task with ANY tombstone stays dropped: every tombstone is newer than the
 * epoch, so the deletion wins exactly as the upstream rule has it. Order-
 * independent and idempotent: the restored copy is appended, and a second
 * merge finds it on the remote side and keeps it by the normal rule.
 *
 * @returns {{merged: Array, restored: number}}
 */
export function restoreUnstampedLocalOnly(merged, local, remote, deletedIds = {}) {
  const have = new Set((merged || []).filter((t) => t && t.id !== undefined).map((t) => String(t.id)));
  const onRemote = new Set((remote || []).filter((t) => t && t.id !== undefined).map((t) => String(t.id)));
  const out = [...(merged || [])];
  let restored = 0;
  for (const t of local || []) {
    if (!t || t.id === undefined) continue;
    const id = String(t.id);
    if (have.has(id) || onRemote.has(id)) continue;   // kept, or resolved against a remote copy
    if (!isUnstamped(t.lastModified)) continue;        // a real old stamp: the fence's zombie call stands
    if (deletedIds && deletedIds[id]) continue;        // deleted somewhere: stays deleted
    out.push(t);
    restored += 1;
  }
  return { merged: out, restored };
}

// mergeSyncData (since @glance-apps/sync v1.3.0) merges the multi-user roster
// (`users`, last-write-wins per user keyed by `syncId`) while deliberately
// leaving the per-device `multiUserEnabled` toggle alone. dayGLANCE previously
// wrapped this function to patch the roster in; that stopgap is no longer
// needed — the upstream merge covers every sync path directly.

// Settings the upstream file-tier merge resolves last-writer-wins but which we
// override back to this device's local value so they don't propagate. Mirrors
// the vault tier (packages/dayglance-vault/src/adapter.js):
//  - obsidianConfig is ALWAYS device-local (the vault differs per machine).
//  - the feature toggles are device-local ONLY when multi-user is on; a
//    single-user install keeps syncing them LWW across that user's own devices.
const ALWAYS_LOCAL_KEYS = ['obsidianConfig'];
// syncUrl/taskCalendarUrl/icsCalendars are device-local in multi-user because
// each user's calendar config travels per-user via the calendarConfigByUser map instead.
const MULTIUSER_LOCAL_KEYS = ['habitsEnabled', 'routinesEnabled', 'goalsProjectsEnabled', 'syncUrl', 'taskCalendarUrl', 'icsCalendars', 'obsidianCompletionDates'];

// Per-user calendar config: {syncId → {syncUrl, taskCalendarUrl, auth?, updatedAt}}.
// Union by syncId, keeping the newer entry per user (LWW). Each device reads only
// its own syncId's entry, so concurrent edits by different users never collide.
export const mergeCalendarConfigByUser = (local = {}, remote = {}) => {
  const out = { ...(local || {}) };
  for (const [sid, entry] of Object.entries(remote || {})) {
    const newer = !out[sid] || new Date(entry?.updatedAt || 0) > new Date(out[sid]?.updatedAt || 0);
    if (newer) out[sid] = entry;
  }
  return out;
};
export {
  mergeDailyNotes,
  mergeHabits,
  mergeRoutineDefinitions,
} from '@glance-apps/sync';
export { pruneTombstones };

// mergeHabitLogs, mergeRoutineCompletions and mergeCompletedDates live in
// @glance-apps/dayglance-vault (merges.js, #2280), beside the vault adapter
// that applies them too; mergeSyncData below uses them from there.
export { mergeHabitLogs, mergeRoutineCompletions, mergeCompletedDates };

// Order-independent equality of two date lists (used to flag re-push/persist).
const sameDateSet = (a = [], b = []) => {
  const sa = new Set(a), sb = new Set(b);
  return sa.size === sb.size && [...sa].every((x) => sb.has(x));
};

// Same keys, same values (order-insensitive) — used to decide whether the
// 60-day tombstone override actually changed a bundle vs one side.
const tombstoneMapsEqual = (a = {}, b = {}) => {
  const ak = Object.keys(a), bk = Object.keys(b);
  return ak.length === bk.length && ak.every((k) => a[k] === b[k]);
};

/**
 * Full-sync merge. Delegates to the upstream merge, then overrides the
 * habit-log portion with the deterministic tie-break above so existing stuck
 * habit counts self-heal across the fleet (no manual re-touch, no package bump).
 */
/**
 * A writable merged item for the sticky-field passes in mergeSyncData. The
 * upstream merge returns the callers' own objects as merged items (the
 * winning side's copy is `local`'s or `remote`'s row itself), so a field
 * written onto it would change the caller's data AND hide the change from the
 * flags: the side whose object it is would then compare equal to the result.
 * Returns a function that, on its first call, replaces the item at `index`
 * with a shallow copy when it is one of the inputs, and returns the item to
 * write to. `onCopy` lets a loop keep its own reference current.
 */
function ownedItem(list, index, l, r, onCopy) {
  let owned = false;
  return () => {
    if (!owned) {
      owned = true;
      const current = list[index];
      if (current === l || current === r) {
        const copy = { ...current };
        list[index] = copy;
        if (onCopy) onCopy(copy);
      }
    }
    return list[index];
  };
}

export const mergeSyncData = (local, remote, retentionDays) => {
  const result = upstreamMergeSyncData(local, remote, retentionDays);
  // Unstamped local-only tasks are not zombies (restoreUnstampedLocalOnly):
  // keep them, and flag the write that uploads them. The union of both sides'
  // tombstones is what the upstream merge judged them against.
  const allTombstones = { ...(local?.deletedTaskIds || {}), ...(remote?.deletedTaskIds || {}) };
  for (const key of TASK_LISTS) {
    if (!Array.isArray(result.data?.[key])) continue;
    const r = restoreUnstampedLocalOnly(result.data[key], local?.[key], remote?.[key], allTombstones);
    if (r.restored) {
      result.data[key] = r.merged;
      result.remoteChanged = true;
    }
  }
  // Equal-stamp ties converge on one copy (breakTimestampTies). Runs before
  // the carries below so a sticky field is restored onto the picked copy.
  for (const key of TIMESTAMPED_LISTS) {
    if (!Array.isArray(result.data?.[key])) continue;
    const t = breakTimestampTies(result.data[key], local?.[key], remote?.[key]);
    result.data[key] = t.merged;
    if (t.localChanged) result.localChanged = true;
    if (t.remoteChanged) result.remoteChanged = true;
  }
  // Tombstone GC is its OWN fixed 60-day policy (packages/dayglance-vault/src/tombstoneRetention.js),
  // NOT the user's "Keep past events" window (retentionDays). The upstream merge
  // prunes completedTaskUids at retentionDays; that is overridden below too
  // (audit fix M7): the set is re-unioned from BOTH raw sides and pruned at the
  // fixed window every writer applies, so the file tier, the vault tier and the
  // app's payload build agree on one set regardless of any device's setting.
  const tsCutoff = tombstoneCutoff();
  const uidsMerged = pruneCompletedTaskUids([...(local?.completedTaskUids || []), ...(remote?.completedTaskUids || [])]);
  const uidSetEq = (a = [], b = []) => a.length === b.length && new Set(a).size === new Set([...a, ...b]).size;
  result.data.completedTaskUids = uidsMerged;
  if (!uidSetEq(uidsMerged, local?.completedTaskUids || [])) result.localChanged = true;
  if (!uidSetEq(uidsMerged, remote?.completedTaskUids || [])) result.remoteChanged = true;
  const habitLogsFix = mergeHabitLogs(
    local?.habitLogs || {},
    remote?.habitLogs || {},
    local?.habitLogTimestamps || {},
    remote?.habitLogTimestamps || {},
  );
  result.data.habitLogs = habitLogsFix.merged;
  result.data.habitLogTimestamps = habitLogsFix.mergedTimestamps;
  // Make sure a heal (one side's count changing) actually triggers a write/push.
  if (habitLogsFix.localChanged) result.localChanged = true;
  if (habitLogsFix.remoteChanged) result.remoteChanged = true;
  // Routine completions: resolve by per-routine timestamp so an un-complete
  // propagates instead of being resurrected by the grow-union (the flip-flop bug).
  if (local?.routineCompletions || remote?.routineCompletions ||
      local?.routineCompletionTimestamps || remote?.routineCompletionTimestamps) {
    const rcFix = mergeRoutineCompletions(
      local?.routineCompletions || {}, remote?.routineCompletions || {},
      local?.routineCompletionTimestamps || {}, remote?.routineCompletionTimestamps || {},
    );
    result.data.routineCompletions = rcFix.merged;
    result.data.routineCompletionTimestamps = rcFix.mergedTimestamps;
    if (rcFix.localChanged) result.localChanged = true;
    if (rcFix.remoteChanged) result.remoteChanged = true;
  }
  // Day windows (per-day START/STOP timeline markers): per-entry LWW over a
  // flat map of dates plus the 'defaults' key — same grain as the vault bundle
  // (dbAdapter.js), through the same shared merge, so the tiers cannot drift.
  // The upstream merge predates this slice and drops unknown keys, hence the
  // wrapper. migrateDayWindows also absorbs a phase-A-shaped map arriving from
  // a device that wrote the slice before it synced.
  if (local?.dayWindows || remote?.dayWindows) {
    const lw = migrateDayWindows(local?.dayWindows);
    const rw = migrateDayWindows(remote?.dayWindows);
    const mergedW = mergeDayWindowMaps(lw, rw);
    result.data.dayWindows = mergedW;
    // Same change-flag contract as habitLogs above: localChanged triggers the
    // local write/apply, remoteChanged triggers the re-upload that heals a
    // remote file missing our entries (e.g. one written by an older client).
    if (mergedW !== lw) result.localChanged = true;
    if (!dayWindowMapsEqual(mergedW, rw)) result.remoteChanged = true;
  }

  // Bucket List config (headings / secondListHidden / notes): whole-object LWW
  // by its embedded updatedAt (stamped on every setBucketConfig edit). The
  // upstream merge predates this slice and DROPS unknown keys, so without this
  // wrapper the merged file silently lost bucketConfig on every file-tier
  // merge — heading edits never propagated between devices, and each re-upload
  // removed the slice from the file. Remote wins ties (pickConfigByTs
  // convention), matching the vault bundle's mergeBundle case exactly so the
  // two tiers cannot disagree.
  if (local?.bucketConfig || remote?.bucketConfig) {
    const lb = local?.bucketConfig || null;
    const rb = remote?.bucketConfig || null;
    const bts = (v) => { const t = new Date(v ?? 0).getTime(); return Number.isNaN(t) ? 0 : t; };
    const winner = bts(rb?.updatedAt) >= bts(lb?.updatedAt) ? (rb || lb) : lb;
    result.data.bucketConfig = winner;
    // Same change-flag contract as dayWindows above: localChanged triggers the
    // local apply, remoteChanged the re-upload that heals a remote file
    // missing the slice (one written by an older client — or by any client
    // before this fix existed).
    if (winner !== lb) result.localChanged = true;
    if (winner !== rb) result.remoteChanged = true;
  }

  // Additional ICS calendars: whole-list LWW by the sibling icsCalendarsUpdatedAt
  // (stamped on every local edit). The upstream merge predates this slice and
  // DROPS unknown keys, so without this wrapper the merged file would silently
  // lose it (the same failure mode bucketConfig had). Remote wins ties, matching
  // the vault bundle's pickByTs convention (dbAdapter.js 'icsCalendars') so the
  // two tiers cannot disagree. In multi-user the device-local override below
  // (MULTIUSER_LOCAL_KEYS) restores the local list afterwards.
  if (local?.icsCalendars !== undefined || remote?.icsCalendars !== undefined) {
    const its = (v) => { const t = new Date(v ?? 0).getTime(); return Number.isNaN(t) ? 0 : t; };
    const lts = its(local?.icsCalendarsUpdatedAt);
    const rts = its(remote?.icsCalendarsUpdatedAt);
    const winner = rts >= lts
      ? (remote?.icsCalendars ?? local?.icsCalendars ?? [])
      : (local?.icsCalendars ?? []);
    result.data.icsCalendars = winner;
    result.data.icsCalendarsUpdatedAt = rts >= lts
      ? (remote?.icsCalendarsUpdatedAt ?? local?.icsCalendarsUpdatedAt ?? null)
      : (local?.icsCalendarsUpdatedAt ?? null);
    // Content-compared change flags (identity would churn on equal lists):
    // localChanged triggers the local apply, remoteChanged the re-upload that
    // heals a remote file missing the slice (one written by an older client).
    const wj = JSON.stringify(winner);
    if (wj !== JSON.stringify(local?.icsCalendars ?? null)) result.localChanged = true;
    if (wj !== JSON.stringify(remote?.icsCalendars ?? null)) result.remoteChanged = true;
  }

  // "Write completion dates to Obsidian" (obsidianCompletionDates): scalar LWW
  // by its UpdatedAt sibling, same shape as icsCalendars above. A SYNCED
  // top-level key on purpose — it could not live inside obsidianConfig, which
  // is ALWAYS_LOCAL_KEYS on this tier (and ALWAYS_DEVICE_LOCAL on the vault
  // tier) because the vault genuinely differs per machine; this toggle is a
  // vault CONVENTION the user wants consistent fleet-wide. The upstream merge
  // predates the key and DROPS unknowns, hence this wrapper block. Remote wins
  // ties, matching the vault bundle's pickByTs convention (dbAdapter.js) so
  // the two tiers cannot disagree. In multi-user the device-local override
  // below (MULTIUSER_LOCAL_KEYS) restores the local value afterwards — same
  // reasoning as the feature toggles: one household member's choice must not
  // flip everyone's vault convention.
  if (local?.obsidianCompletionDates !== undefined || remote?.obsidianCompletionDates !== undefined) {
    const cts = (v) => { const t = new Date(v ?? 0).getTime(); return Number.isNaN(t) ? 0 : t; };
    const lts = cts(local?.obsidianCompletionDatesUpdatedAt);
    const rts = cts(remote?.obsidianCompletionDatesUpdatedAt);
    const remoteWins = rts >= lts && remote?.obsidianCompletionDates !== undefined;
    const winner = remoteWins ? remote.obsidianCompletionDates : local?.obsidianCompletionDates;
    result.data.obsidianCompletionDates = winner;
    result.data.obsidianCompletionDatesUpdatedAt = remoteWins
      ? (remote?.obsidianCompletionDatesUpdatedAt ?? null)
      : (local?.obsidianCompletionDatesUpdatedAt ?? null);
    if (winner !== local?.obsidianCompletionDates) result.localChanged = true;
    if (winner !== remote?.obsidianCompletionDates) result.remoteChanged = true;
  }

  // Recurring completions ride inside the shared template row, which the upstream
  // merge resolves by whole-row LWW — re-merge each series' completedDates by date
  // so a completion is never clobbered by a concurrent edit to the same series
  // (e.g. a series-level assignment change) on another device. Occurrence edits
  // (exceptions) merge per date the same way (packages/dayglance-vault/src/recurringExceptions.js).
  if (local?.recurringTasks || remote?.recurringTasks) {
    const lById = new Map((local?.recurringTasks || []).map((t) => [String(t.id), t]));
    const rById = new Map((remote?.recurringTasks || []).map((t) => [String(t.id), t]));
    result.data.recurringTasks = (result.data.recurringTasks || []).map((t) => {
      const l = lById.get(String(t.id));
      const r = rById.get(String(t.id));
      if (!l || !r) return t; // present on only one side — nothing concurrent to merge
      const { completedDates, completedDatesTimestamps } = mergeCompletedDates(
        l.completedDates || [], r.completedDates || [],
        l.completedDatesTimestamps || {}, r.completedDatesTimestamps || {},
      );
      if (!sameDateSet(completedDates, l.completedDates || [])) result.localChanged = true;
      if (!sameDateSet(completedDates, r.completedDates || [])) result.remoteChanged = true;
      const merged = withMergedExceptions({
        ...t,
        completedDates,
        ...(Object.keys(completedDatesTimestamps).length ? { completedDatesTimestamps } : {}),
      }, l, r);
      if (!sameOccurrenceEdits(merged, l)) result.localChanged = true;
      if (!sameOccurrenceEdits(merged, r)) result.remoteChanged = true;
      return merged;
    });
  }
  // Per-user calendar config merges by syncId (the upstream merge doesn't know
  // this key), so resolve it explicitly here from both sides.
  if (local?.calendarConfigByUser || remote?.calendarConfigByUser) {
    result.data.calendarConfigByUser = mergeCalendarConfigByUser(
      local?.calendarConfigByUser, remote?.calendarConfigByUser,
    );
  }
  // Areas are a dayGLANCE-only collection the upstream merge doesn't know about,
  // so it drops them (its output is an explicit key list). Merge them here by id
  // with the same LWW-on-updatedAt + tombstone strategy the package uses for
  // goals/projects, and prune stale tombstones to the retention window. Without
  // this, areas would be lost on every WebDAV/iCloud sync round-trip.
  if (local?.areas || remote?.areas || local?.deletedAreaIds || remote?.deletedAreaIds) {
    const allDeletedAreaIds = { ...(local?.deletedAreaIds || {}) };
    for (const [id, tsVal] of Object.entries(remote?.deletedAreaIds || {})) {
      if (!allDeletedAreaIds[id] || new Date(tsVal) > new Date(allDeletedAreaIds[id])) {
        allDeletedAreaIds[id] = tsVal;
      }
    }
    const areasMerge = mergeArrayById(
      local?.areas || [], remote?.areas || [], allDeletedAreaIds, null,
      { timestampField: 'updatedAt' },
    );
    result.data.areas = areasMerge.merged;
    // Tombstones prune at the fixed 60-day window, not the event-retention setting.
    result.data.deletedAreaIds = pruneTombstoneMap(allDeletedAreaIds, tsCutoff);
    if (areasMerge.localChanged) result.localChanged = true;
    if (areasMerge.remoteChanged) result.remoteChanged = true;
  }
  // Frame sets (#2305, agenda-core frameSets.js): a dayGLANCE-only collection
  // the upstream merge drops. Merged here by id the way the upstream merges
  // the frames they group: last-writer-wins on lastModified, a tombstone in
  // deletedFrameSetIds newer than a copy removes it, no sync horizon (as for
  // areas). Equal stamps with different content converge on one copy
  // (breakTimestampTies). The tombstone map itself is unioned and pruned with
  // the other bundles below. A side without the key carries nothing: the
  // payload omits it until the sets have been read (not loaded is not empty),
  // and a build that predates sets never had it. When neither side has it the
  // result omits it too, so nothing reads as an empty list.
  if (Array.isArray(local?.frameSets) || Array.isArray(remote?.frameSets)) {
    const deletedSetIds = unionTombstones(local?.deletedFrameSetIds, remote?.deletedFrameSetIds);
    const localSets = Array.isArray(local?.frameSets) ? local.frameSets : [];
    const remoteSets = Array.isArray(remote?.frameSets) ? remote.frameSets : [];
    const setsMerge = mergeArrayById(localSets, remoteSets, deletedSetIds, null, { timestampField: 'lastModified' });
    const setsTies = breakTimestampTies(setsMerge.merged, localSets, remoteSets);
    result.data.frameSets = setsTies.merged;
    if (setsMerge.localChanged || setsTies.localChanged) result.localChanged = true;
    if (setsMerge.remoteChanged || setsTies.remoteChanged) result.remoteChanged = true;
  }
  // JOBO ledger (docs/jobo-ledger-persistence.md): a dayGLANCE-only
  // collection the upstream merge drops, re-merged here by id with core's
  // pickJoboRecord. No tombstone map (deletions are rows) and NO sync
  // horizon: the horizon drops old local-only rows, which for the ledger are
  // real records and the tombstones that keep stale copies out, and a merge
  // against a payload from a build that predates the collection would
  // otherwise drop every row older than the window. A side without the key
  // did not carry the collection and is never read as empty.
  {
    const jobo = mergeJoboCollections(local?.joboRecords, remote?.joboRecords);
    if (jobo.merged !== undefined) {
      result.data.joboRecords = jobo.merged;
      if (jobo.localChanged) result.localChanged = true;
      if (jobo.remoteChanged) result.remoteChanged = true;
    }
  }
  // Keep device-local settings on this device's own value rather than the
  // last-writer-wins result. Feature toggles only when multi-user is on, so a
  // household member's toggle never propagates; single-user keeps syncing them.
  const keepLocalKeys = local?.multiUserEnabled
    ? [...ALWAYS_LOCAL_KEYS, ...MULTIUSER_LOCAL_KEYS]
    : ALWAYS_LOCAL_KEYS;
  for (const key of keepLocalKeys) {
    if (local && Object.prototype.hasOwnProperty.call(local, key)) {
      result.data[key] = local[key];
      const tsKey = `${key}UpdatedAt`;
      if (Object.prototype.hasOwnProperty.call(local, tsKey)) result.data[tsKey] = local[tsKey];
    }
  }
  // The keys every device keeps its own value for: these, their stamps, and
  // the UI and device preferences the upstream merge keeps local. A snapshot
  // file carries whichever device wrote last, no device adopts them from it,
  // and so a difference in them is never worth a write (sync/snapshotFileSync.js
  // and the diagnostics dry run read this list; an iPhone's iCloud dry run said
  // "would write: YES" over use24HourClock and minimizedSections, 2026-10-09).
  result.deviceLocalKeys = [
    ...keepLocalKeys,
    ...keepLocalKeys.map((k) => `${k}UpdatedAt`),
    'minimizedSections',
    'use24HourClock',
  ];

  // Preserve the "sticky" `archived` flag across whole-entity LWW. The upstream
  // merge keeps the newer copy WHOLE, so if that copy simply never carried
  // `archived` (a device that never archived the item, edited later), the archive
  // is dropped — which then re-stamps lastModified on every cold-open (the DB-sync
  // push churn). Restore archived:true when the merged winner OMITS it (undefined)
  // but either original side had archived:true. An explicit archived:false is a
  // real unarchive (present, not undefined) → left as-is so it still propagates.
  //
  // Every write below goes through `own()`. The upstream merge hands back the
  // callers' own objects as merged items: the winning side's copy IS `l` or
  // `r`. Writing onto it would both mutate the caller's data and make that
  // side look as if it already held the value, so the flag that should send
  // the corrected copy back to it was never raised.
  for (const listKey of ['tasks', 'unscheduledTasks', 'recycleBin']) {
    const mergedList = result.data[listKey];
    if (!Array.isArray(mergedList)) continue;
    const localById = new Map((local?.[listKey] || []).map((t) => [String(t.id), t]));
    const remoteById = new Map((remote?.[listKey] || []).map((t) => [String(t.id), t]));
    for (let i = 0; i < mergedList.length; i += 1) {
      let item = mergedList[i];
      if (!item) continue;
      const l = localById.get(String(item.id));
      const r = remoteById.get(String(item.id));
      const own = ownedItem(mergedList, i, l, r, (next) => { item = next; });
      if (item.archived === undefined && (l?.archived === true || r?.archived === true)) {
        own().archived = true;
        // The side whose copy we enriched needs the corrected value written back.
        if (l?.archived !== true) result.localChanged = true;
        if (r?.archived !== true) result.remoteChanged = true;
      }
      // `originalPlan` is sticky for the same reason, and carried unconditionally:
      // it is write-once and nothing can clear it, so absent on the winner can
      // only mean that side never had it. Either side's copy will do — a task has
      // at most one baseline, so they cannot disagree.
      if (item.originalPlan === undefined) {
        const plan = l?.originalPlan ?? r?.originalPlan;
        if (plan !== undefined) {
          own().originalPlan = plan;
          if (l?.originalPlan === undefined) result.localChanged = true;
          if (r?.originalPlan === undefined) result.remoteChanged = true;
        }
      }
      // `clientId` (intents/launcherWrites.js), the launcher's id for the write
      // that created the task, is write-once in the same way.
      if (item.clientId === undefined) {
        const cid = l?.clientId ?? r?.clientId;
        if (cid !== undefined) {
          own().clientId = cid;
          if (l?.clientId === undefined) result.localChanged = true;
          if (r?.clientId === undefined) result.remoteChanged = true;
        }
      }
      // `starredDate` likewise. An unstar writes an explicit null, so only an
      // absent value means the side never carried the field; a null from either
      // side is a real unstar and is left to win on its own timestamp.
      if (item.starredDate === undefined) {
        const starred = l?.starredDate !== undefined ? l.starredDate : r?.starredDate;
        if (starred !== undefined) {
          own().starredDate = starred;
          if (l?.starredDate === undefined) result.localChanged = true;
          if (r?.starredDate === undefined) result.remoteChanged = true;
        }
      }
      // `deferrals` merges by MAX, not by carrying: both sides may have watched
      // the same slip, so summing double-counts, and the lower side needs the
      // corrected value written back.
      {
        const count = mergeDeferrals(l?.deferrals, r?.deferrals);
        if (count !== undefined && count !== item.deferrals) own().deferrals = count;
        if (count !== undefined) {
          if ((Number(l?.deferrals) || 0) < count) result.localChanged = true;
          if ((Number(r?.deferrals) || 0) < count) result.remoteChanged = true;
        }
      }
      // `planTrail` merges by UNION, the list-shaped version of that same rule:
      // each side may hold slips the other never saw, and a carry-forward would
      // keep only one side's. Either side missing a stop has to be written back.
      {
        const trail = mergePlanTrail(l?.planTrail, r?.planTrail);
        if (trail !== undefined && !sameTrail(trail, item.planTrail)) own().planTrail = trail;
        if (trail !== undefined) {
          if (!sameTrail(trail, l?.planTrail)) result.localChanged = true;
          if (!sameTrail(trail, r?.planTrail)) result.remoteChanged = true;
        }
      }
    }
  }

  // `createdAt` (utils/createdAt.js) is write-once like `originalPlan`, so a
  // winner without it only means that side never had it. It is merged rather
  // than carried, keeping the EARLIER stamp: either side may hold one, and in
  // the rare case both do (two devices met the same id), the earlier is the
  // creation and the choice does not depend on which side is local. Recurring
  // templates carry it too (a series is created once), hence the fourth list.
  for (const listKey of ['tasks', 'unscheduledTasks', 'recycleBin', 'recurringTasks']) {
    const mergedList = result.data[listKey];
    if (!Array.isArray(mergedList)) continue;
    const localById = new Map((local?.[listKey] || []).map((t) => [String(t?.id), t]));
    const remoteById = new Map((remote?.[listKey] || []).map((t) => [String(t?.id), t]));
    for (let i = 0; i < mergedList.length; i += 1) {
      const item = mergedList[i];
      if (!item) continue;
      const l = localById.get(String(item.id));
      const r = remoteById.get(String(item.id));
      const created = earlierCreatedAt(l?.createdAt, r?.createdAt);
      if (created === undefined) continue;
      if (l && l.createdAt !== created) result.localChanged = true;
      if (r && r.createdAt !== created) result.remoteChanged = true;
      // Onto a copy when the item is one of the inputs (see ownedItem).
      if (item.createdAt !== created) ownedItem(mergedList, i, l, r)().createdAt = created;
    }
  }

  // Override the upstream tombstone pruning (which used `retentionDays`) with the
  // fixed 60-day window so the file-tier and the vault DB tier keep the SAME set.
  // Reconstruct each bundle from both sides' raw maps (grow-union, newest ts per
  // id) then prune at 60 days. deletedAreaIds is handled in the areas block above.
  for (const key of TOMBSTONE_BUNDLE_KEYS) {
    if (key === 'deletedAreaIds') continue;
    const merged = pruneTombstoneMap(unionTombstones(local?.[key], remote?.[key]), tsCutoff);
    result.data[key] = merged;
    // Only ever RAISE the change flags (never clear another writer's true): if the
    // 60-day set differs from a side, that side needs the corrected bundle written.
    if (!tombstoneMapsEqual(merged, local?.[key] || {})) result.localChanged = true;
    if (!tombstoneMapsEqual(merged, remote?.[key] || {})) result.remoteChanged = true;
  }

  // Id-retirement record ({oldId → {retiredAt, successor}} — see
  // utils/retiredTaskIds.js): union with per-key LWW on retiredAt, pruned at
  // the SAME fixed window as the deletion bundles so the two transports stay
  // in lockstep. Its object values can't ride unionTombstones/pruneTombstoneMap.
  const retiredEntryEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const retiredMapsEqual = (a = {}, b = {}) => {
    const ka = Object.keys(a); const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => retiredEntryEq(a[k], b[k]));
  };
  // The successor-tombstone bundles (already merged + pruned above) extend an
  // aged entry's life while they still name its successor (audit fix M9).
  const retiredMerged = pruneRetiredTaskIds(
    mergeRetiredTaskIds(local?.retiredTaskIds || {}, remote?.retiredTaskIds || {}), tsCutoff,
    [result.data.deletedTaskIds, result.data.deletedObsidianKeys],
  );
  result.data.retiredTaskIds = retiredMerged;
  if (!retiredMapsEqual(retiredMerged, local?.retiredTaskIds || {})) result.localChanged = true;
  if (!retiredMapsEqual(retiredMerged, remote?.retiredTaskIds || {})) result.remoteChanged = true;

  // Supersede retired ids in the merged task lists: a row whose id the record
  // maps to a LIVE successor is dropped (its newer content, if any, redirected
  // onto the successor) REGARDLESS of timestamps — retirement is an identity
  // move, not a deletion, so the LWW that lets a genuinely deleted task revive
  // must not resurrect a retired id. This also keeps retired rows out of the
  // uploaded sync file, so the v4.7.x fleet stops re-ingesting them.
  const retApplied = applyRetirementsToTaskLists(
    { tasks: result.data.tasks, unscheduledTasks: result.data.unscheduledTasks, recycleBin: result.data.recycleBin },
    retiredMerged,
  );
  if (retApplied.tasks !== result.data.tasks || retApplied.unscheduledTasks !== result.data.unscheduledTasks) {
    result.data.tasks = retApplied.tasks;
    result.data.unscheduledTasks = retApplied.unscheduledTasks;
    result.localChanged = true;
    result.remoteChanged = true;
  }

  // Symmetric enforcement of deletedObsidianKeys in the FILE-TIER merge — the
  // fix for issue #1448 ("deletedObsidianKeys never reaches the file-tier task
  // merge"). The channel was honored on the way OUT but ignored on the way IN:
  // every deleting path consulted it while this merge unioned tombstoned rows
  // straight back from the remote file — the vaultless-device resurrection
  // loop, and the file-tier face of the tombstone echo war
  // (src/sync/obsidianTombstoneEchoWar.test.js; applyEngineData carries the
  // apply-side of the same gate). Cleansing the MERGE OUTPUT also cleanses the
  // uploaded file, so a zombie row cannot sit in the remote file waiting to
  // resurrect the day its tombstone hits the 60-day GC. Same shared LWW
  // helpers as the apply boundary (utils/obsidianDeletions.js): a row or note
  // re-created after its deletion (newer lastModified) survives and syncs.
  const obsTombs = result.data.deletedObsidianKeys || {};
  const obsCleanTasks = dropTombstonedObsidianTasks(result.data.tasks, obsTombs);
  const obsCleanUnsched = dropTombstonedObsidianTasks(result.data.unscheduledTasks, obsTombs);
  const obsCleanNotes = dropTombstonedObsidianNotes(result.data.dailyNotes, obsTombs);
  if (obsCleanTasks !== result.data.tasks || obsCleanUnsched !== result.data.unscheduledTasks
      || obsCleanNotes !== result.data.dailyNotes) {
    result.data.tasks = obsCleanTasks;
    result.data.unscheduledTasks = obsCleanUnsched;
    result.data.dailyNotes = obsCleanNotes;
    // Both sides need the cleansed result: local state applies it, and the
    // remote file is rewritten without the zombies.
    result.localChanged = true;
    result.remoteChanged = true;
  }

  // Ghost-row CONTAINMENT at the file-tier merge (utils/obsidianGhostRows.js):
  // a duplicate an old client minted from a block-id-stamped line carries the
  // swallowed ^dg- token in its title — the pointer to its own successor. The
  // merged output (which is also the uploaded file) is cleansed of ghosts
  // whose successor is live, with a newer ghost's edits redirected onto the
  // successor. Ephemeral here (a pure merge persists nothing); the derived
  // retirement is recorded at the apply boundary. Containment, not
  // prevention: the minting client keeps its local copy until it updates.
  const ghostContained = containObsidianGhostRows(
    { tasks: result.data.tasks, unscheduledTasks: result.data.unscheduledTasks },
  );
  if (ghostContained.tasks !== result.data.tasks || ghostContained.unscheduledTasks !== result.data.unscheduledTasks) {
    result.data.tasks = ghostContained.tasks;
    result.data.unscheduledTasks = ghostContained.unscheduledTasks;
    result.localChanged = true;
    result.remoteChanged = true;
  }

  // Override the upstream resurrection fence (which was max(localFence, remoteFence)
  // — the monotonic-max() trap that made a fixed fence churn forever, PR #1142)
  // with the locally-recomputed cutoff. The fence must equal the 60-day tombstone-GC
  // window (entries younger are caught by the surviving tombstone, older by the
  // fence, the two abutting with no gap), and it is a pure function of the current
  // UTC day, so every device recomputes the identical value — no cross-device
  // information to preserve, hence overwrite rather than merge. Same canonical
  // tombstoneCutoff() the payload (buildSyncPayload) and vault merge (dbAdapter.js)
  // use — one flooring implementation, no skew.
  //
  // Deliberately does NOT raise localChanged/remoteChanged: the fence is a derived
  // value every device recomputes for itself (buildSyncPayload emits it fresh, and
  // this merge overwrites any pulled value), so a stored copy that differs is
  // self-healing on read and needs no propagation. Flagging it would re-introduce a
  // per-cycle write/upload — the very churn this rework removes.
  result.data.tombstonePrunedBefore = tombstoneCutoff().toISOString();

  return result;
};
