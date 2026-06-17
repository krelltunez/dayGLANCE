// Re-exports from @glance-apps/sync.
// dayGLANCE tasks use `lastModified` for the per-item timestamp, so
// mergeTaskArrays pins timestampField rather than re-exporting the alias
// directly (which would default to `updatedAt`).
import { mergeArrayById, mergeSyncData as upstreamMergeSyncData } from '@glance-apps/sync';

export const mergeTaskArrays = (local, remote, deletedIds, syncHorizon = null) =>
  mergeArrayById(local, remote, deletedIds, syncHorizon, { timestampField: 'lastModified' });

// mergeSyncData (since @glance-apps/sync v1.3.0) merges the multi-user roster
// (`users`, last-write-wins per user keyed by `syncId`) while deliberately
// leaving the per-device `multiUserEnabled` toggle alone. dayGLANCE previously
// wrapped this function to patch the roster in; that stopgap is no longer
// needed — the upstream merge covers every sync path directly.
export {
  mergeDailyNotes,
  mergeHabits,
  mergeRoutineDefinitions,
  pruneTombstones,
} from '@glance-apps/sync';

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
  return result;
};
