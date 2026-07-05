// Re-exports from @glance-apps/sync.
// dayGLANCE tasks use `lastModified` for the per-item timestamp, so
// mergeTaskArrays pins timestampField rather than re-exporting the alias
// directly (which would default to `updatedAt`).
import { mergeArrayById, mergeSyncData as upstreamMergeSyncData, pruneTombstones } from '@glance-apps/sync';

export const mergeTaskArrays = (local, remote, deletedIds, syncHorizon = null) =>
  mergeArrayById(local, remote, deletedIds, syncHorizon, { timestampField: 'lastModified' });

// mergeSyncData (since @glance-apps/sync v1.3.0) merges the multi-user roster
// (`users`, last-write-wins per user keyed by `syncId`) while deliberately
// leaving the per-device `multiUserEnabled` toggle alone. dayGLANCE previously
// wrapped this function to patch the roster in; that stopgap is no longer
// needed — the upstream merge covers every sync path directly.

// Settings the upstream file-tier merge resolves last-writer-wins but which we
// override back to this device's local value so they don't propagate. Mirrors
// the vault tier (src/sync/dbAdapter.js):
//  - obsidianConfig is ALWAYS device-local (the vault differs per machine).
//  - the feature toggles are device-local ONLY when multi-user is on; a
//    single-user install keeps syncing them LWW across that user's own devices.
const ALWAYS_LOCAL_KEYS = ['obsidianConfig'];
// syncUrl/taskCalendarUrl are device-local in multi-user because each user's
// calendar config travels per-user via the calendarConfigByUser map instead.
const MULTIUSER_LOCAL_KEYS = ['habitsEnabled', 'routinesEnabled', 'goalsProjectsEnabled', 'syncUrl', 'taskCalendarUrl'];

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

/**
 * Habit-log merge with a deterministic tie-break.
 *
 * The upstream `mergeHabitLogs` resolves an equal per-(day, habit) timestamp by
 * keeping the LOCAL count (`lTime >= rTime ? local : remote`). That means two
 * devices that end up with the same timestamp but different counts — e.g. a
 * count that changed without its timestamp advancing — each keep their own
 * value forever. The result is a permanent split-brain that no amount of syncing
 * reconciles (observed: Water 4↔2 and Candy 1↔0 with identical timestamps).
 *
 * Fix: on an exact timestamp tie, fall back to `Math.max` — the same rule the
 * no-timestamp legacy branch already uses — so both devices compute the same
 * winner and converge. Strict last-writer-wins still applies whenever the
 * timestamps differ, so genuine decrements made later are preserved.
 *
 * Implemented here (not in the package) so the fix ships with the app and no
 * `@glance-apps/sync` release/bump is required. `mergeSyncData` below routes the
 * habit-log portion of every full sync through this function.
 */
export const mergeHabitLogs = (localLogs, remoteLogs, localTs = {}, remoteTs = {}) => {
  const allDates = new Set([...Object.keys(localLogs), ...Object.keys(remoteLogs)]);
  const merged = {};
  const mergedTimestamps = { ...localTs };
  let localChanged = false;
  let remoteChanged = false;

  // Union the timestamp maps, keeping the newer of each key.
  for (const [k, v] of Object.entries(remoteTs)) {
    if (!mergedTimestamps[k] || new Date(v) > new Date(mergedTimestamps[k])) {
      mergedTimestamps[k] = v;
    }
  }

  for (const dateKey of allDates) {
    const local = localLogs[dateKey];
    const remote = remoteLogs[dateKey];

    if (local && !remote) {
      merged[dateKey] = local;
      remoteChanged = true;
    } else if (!local && remote) {
      merged[dateKey] = remote;
      localChanged = true;
    } else {
      const allHabitIds = new Set([...Object.keys(local), ...Object.keys(remote)]);
      const dayMerged = {};
      for (const habitId of allHabitIds) {
        const localCount = local[habitId] !== undefined ? local[habitId] : 0;
        const remoteCount = remote[habitId] !== undefined ? remote[habitId] : 0;
        const tsKey = `${dateKey}:${habitId}`;
        const lTime = localTs[tsKey] ? new Date(localTs[tsKey]).getTime() : 0;
        const rTime = remoteTs[tsKey] ? new Date(remoteTs[tsKey]).getTime() : 0;

        let winner;
        if (lTime > rTime) {
          winner = localCount;          // local is strictly newer
        } else if (rTime > lTime) {
          winner = remoteCount;         // remote is strictly newer
        } else {
          // Equal timestamps (or both missing): deterministic on both devices
          // so a stuck split-brain reconciles instead of each side keeping its
          // own value.
          winner = Math.max(localCount, remoteCount);

          // Diagnostic (harmless, behaviour-neutral): an equal *present*
          // timestamp with diverging counts is the split-brain signature — a
          // count drifted without its timestamp advancing. We can't yet repro
          // the seed, so this surfaces the event if it ever recurs on-device,
          // with enough context to trace which write decoupled them. Both-
          // missing (legacy entries with no timestamp) is normal and not logged.
          if (lTime > 0 && localCount !== remoteCount) {
            try {
              console.warn(
                `[habit-sync] split-brain healed at equal timestamp — ${tsKey}: ` +
                `local=${localCount} remote=${remoteCount} → ${winner} ` +
                `(ts=${localTs[tsKey] ?? remoteTs[tsKey]})`
              );
            } catch (_) { /* console unavailable — ignore */ }
          }
        }

        if (winner !== localCount) localChanged = true;
        if (winner !== remoteCount) remoteChanged = true;
        dayMerged[habitId] = winner;
      }
      merged[dateKey] = dayMerged;
    }
  }

  return { merged, mergedTimestamps, localChanged, remoteChanged };
};

/**
 * Routine-completion merge with per-routine timestamps.
 *
 * Routine completions are a `{routineId → 'YYYY-MM-DD'}` map, but the only
 * top-level signal was the bare date, so the upstream/vault merge could only
 * grow-union them: a key, once present, never goes away. That breaks the toggle.
 * UN-completing a routine deletes its key locally (useRoutines.toggleRoutineCompletion),
 * and a grow-union immediately resurrects it from any device that still has the
 * completion — so the routine flips between done/undone on every sync round-trip
 * with no user action (the same zombie-resurrection class fixed for tasks).
 *
 * Fix: carry a parallel `{routineId → ISO}` timestamp map, stamped on EVERY
 * toggle (complete AND un-complete), and resolve each routine by last-writer-wins
 * on that timestamp — so a later un-complete (key absent, newer ts) beats an
 * earlier complete. Presence/absence in the completions map is the value; the
 * timestamp decides the winner. Legacy entries with no timestamp fall back to the
 * old grow-union (present wins), so nothing regresses on first upgrade.
 *
 * Mirrors mergeHabitLogs above (count↔presence, day-key↔routine-id); routed
 * through mergeSyncData below and the vault adapter (src/sync/dbAdapter.js).
 */
export const mergeRoutineCompletions = (localC = {}, remoteC = {}, localTs = {}, remoteTs = {}) => {
  const ids = new Set([
    ...Object.keys(localC), ...Object.keys(remoteC),
    ...Object.keys(localTs), ...Object.keys(remoteTs),
  ]);
  const merged = {};
  const mergedTimestamps = {};
  let localChanged = false;
  let remoteChanged = false;

  for (const id of ids) {
    const lHas = Object.prototype.hasOwnProperty.call(localC, id);
    const rHas = Object.prototype.hasOwnProperty.call(remoteC, id);
    const lTime = localTs[id] ? new Date(localTs[id]).getTime() : 0;
    const rTime = remoteTs[id] ? new Date(remoteTs[id]).getTime() : 0;

    // Keep the newer timestamp per id so the marker (incl. a tombstone) converges.
    const newerTs = rTime > lTime ? remoteTs[id] : (localTs[id] ?? remoteTs[id]);
    if (newerTs) mergedTimestamps[id] = newerTs;

    let present, date;
    if (lTime > rTime) {
      present = lHas; date = localC[id];          // local strictly newer
    } else if (rTime > lTime) {
      present = rHas; date = remoteC[id];         // remote strictly newer
    } else {
      // Equal timestamps (or both missing — legacy): present wins, so a
      // completion is never silently dropped, matching the old grow-union.
      present = lHas || rHas;
      date = (lHas && rHas)
        ? (localC[id] > remoteC[id] ? localC[id] : remoteC[id])
        : (lHas ? localC[id] : remoteC[id]);
    }
    if (present) merged[id] = date;
    if (present !== lHas) localChanged = true;
    if (present !== rHas) remoteChanged = true;
  }

  return { merged, mergedTimestamps, localChanged, remoteChanged };
};

/**
 * Merge the completion state of two copies of the SAME recurring template.
 *
 * A recurring task's per-occurrence completions live in `completedDates` INSIDE
 * the shared template row, which both sync tiers otherwise resolve by whole-row
 * last-writer-wins. That silently drops a completion whenever the series is
 * touched concurrently on another device — most easily a completion on one
 * device versus an edit to the same series on another, since the (now
 * series-level) user-assignment write bumps the template's `lastModified`, so its
 * row — which lacks the completion — wins and reverts it on every device. That is
 * the "completed on one device, not the others" report.
 *
 * Union the dates instead so no completion is lost, and use the optional per-date
 * `completedDatesTimestamps` map to let a later UN-complete (date removed, newer
 * stamp) win over an earlier complete — the same presence-by-timestamp model as
 * routine completions above. Legacy rows with no timestamps fall back to a plain
 * union (present wins), so nothing regresses on first upgrade.
 */
export const mergeCompletedDates = (localDates = [], remoteDates = [], localTs = {}, remoteTs = {}) => {
  const lSet = new Set(localDates || []);
  const rSet = new Set(remoteDates || []);
  const allDates = new Set([...lSet, ...rSet, ...Object.keys(localTs), ...Object.keys(remoteTs)]);
  const completedDates = [];
  const completedDatesTimestamps = {};
  for (const d of allDates) {
    const lt = localTs[d] ? new Date(localTs[d]).getTime() : 0;
    const rt = remoteTs[d] ? new Date(remoteTs[d]).getTime() : 0;
    const newerTs = rt > lt ? remoteTs[d] : (localTs[d] ?? remoteTs[d]);
    if (newerTs) completedDatesTimestamps[d] = newerTs;
    let present;
    if (lt > rt) present = lSet.has(d);
    else if (rt > lt) present = rSet.has(d);
    else present = lSet.has(d) || rSet.has(d); // tie / legacy: present wins
    if (present) completedDates.push(d);
  }
  completedDates.sort();
  return { completedDates, completedDatesTimestamps };
};

// Order-independent equality of two date lists (used to flag re-push/persist).
const sameDateSet = (a = [], b = []) => {
  const sa = new Set(a), sb = new Set(b);
  return sa.size === sb.size && [...sa].every((x) => sb.has(x));
};

/**
 * Full-sync merge. Delegates to the upstream merge, then overrides the
 * habit-log portion with the deterministic tie-break above so existing stuck
 * habit counts self-heal across the fleet (no manual re-touch, no package bump).
 */
export const mergeSyncData = (local, remote, retentionDays) => {
  const result = upstreamMergeSyncData(local, remote, retentionDays);
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
  // Recurring completions ride inside the shared template row, which the upstream
  // merge resolves by whole-row LWW — re-merge each series' completedDates by date
  // so a completion is never clobbered by a concurrent edit to the same series
  // (e.g. a series-level assignment change) on another device.
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
      return {
        ...t,
        completedDates,
        ...(Object.keys(completedDatesTimestamps).length ? { completedDatesTimestamps } : {}),
      };
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
    const cutoff = retentionDays > 0 ? new Date(Date.now() - retentionDays * 86400000) : null;
    result.data.deletedAreaIds = pruneTombstones(allDeletedAreaIds, cutoff);
    if (areasMerge.localChanged) result.localChanged = true;
    if (areasMerge.remoteChanged) result.remoteChanged = true;
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

  // Preserve the "sticky" `archived` flag across whole-entity LWW. The upstream
  // merge keeps the newer copy WHOLE, so if that copy simply never carried
  // `archived` (a device that never archived the item, edited later), the archive
  // is dropped — which then re-stamps lastModified on every cold-open (the DB-sync
  // push churn). Restore archived:true when the merged winner OMITS it (undefined)
  // but either original side had archived:true. An explicit archived:false is a
  // real unarchive (present, not undefined) → left as-is so it still propagates.
  for (const listKey of ['tasks', 'unscheduledTasks', 'recycleBin']) {
    const mergedList = result.data[listKey];
    if (!Array.isArray(mergedList)) continue;
    const localById = new Map((local?.[listKey] || []).map((t) => [String(t.id), t]));
    const remoteById = new Map((remote?.[listKey] || []).map((t) => [String(t.id), t]));
    for (const item of mergedList) {
      if (!item || item.archived !== undefined) continue;
      const l = localById.get(String(item.id));
      const r = remoteById.get(String(item.id));
      if (l?.archived === true || r?.archived === true) {
        item.archived = true;
        // The side whose copy we enriched needs the corrected value written back.
        if (l?.archived !== true) result.localChanged = true;
        if (r?.archived !== true) result.remoteChanged = true;
      }
    }
  }

  return result;
};
