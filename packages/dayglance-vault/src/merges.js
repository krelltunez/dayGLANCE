// The per-key merges both sync tiers apply to habit logs, routine completions
// and a recurring series' completedDates. Moved verbatim from the app's
// src/mergeSync.js (#2280), which imports them back: "mergeSyncData below"
// in the comments is the file-tier merge there, and the vault adapter
// (./adapter.js) calls the same functions, so each rule exists once.

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
 * through mergeSyncData below and the vault adapter (./adapter.js).
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
