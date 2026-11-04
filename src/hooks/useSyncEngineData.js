// The sync payload and the sync apply: what this device sends to both sync
// tiers, and how a merged or pulled copy lands in storage and state. Moved
// out of App.jsx verbatim (the comments inside are the record of why each
// line is there); the deps object is every piece of App state, setter, ref
// and helper the two functions read, so that a second root can supply its
// own. The headless refresh root (src/headless/) is that second root: it
// loads the same slices from storage and runs the same two functions, so
// what a headless cycle pushes and applies is exactly what the app would.
//
// "Adding a field to a task" in CLAUDE.md is the checklist for a new field;
// every rule it names that lives here is a comment in the function bodies.
//
// Every key in SYNC_ENGINE_DATA_DEPS must be supplied. A missing setter is
// a TypeError at the first apply; a missing value is worse: the payload
// sends `undefined` for that slice with a fresh lastModified, and the merge
// reads it as this device's word. missingSyncEngineDeps names the gaps, and
// the hook reports them in development.

import { dateToString } from '../utils/taskUtils.js';
import { isNativeApp } from '../native.js';
import { tombstoneCutoff, pruneCompletedTaskUids } from '@glance-apps/dayglance-vault';
import { keepImportedTask } from '../sync/payloadExclusions.js';
import { dropResurrectedTasks } from '../utils/dropResurrectedTasks.js';
import { preserveStickyFields } from '../utils/preserveStickyFields.js';
import { stripProjectRefs, stripGoalRefs, resolveDeletedIds } from '../utils/referentialIntegrity.js';
import { rescueUnsyncedTasks } from '../utils/rescueUnsyncedTasks.js';
import { readRetiredTaskIds, applyTaskRetirements, RETIRED_TASK_IDS_STORAGE_KEY } from '../utils/retiredTaskIds.js';
import { dropTombstonedObsidianTasks, dropTombstonedObsidianNotes } from '../utils/obsidianDeletions.js';
import { containObsidianGhostRows, persistDerivedGhostRetirements } from '../utils/obsidianGhostRows.js';
import { ICS_CALENDARS_KEY, loadIcsCalendars, stripIcsCalendarCredentials, applyRemoteIcsCalendars, PRIMARY_CAL_META_KEY, injectPrimaryStub, splitPrimaryStub } from '../utils/icsFeedSync.js';
import { normalizeBucketConfig } from '../utils/bucketList.js';
import { dailyNotesSyncable, writeDailyNotes } from '../utils/dailyNotesStore.js';
import { sanitizeMergedRoutineCompletions, startOfTodayIso } from './useRoutines.js';

/** Every key the hook reads, by kind. */
export const SYNC_ENGINE_DATA_DEPS = Object.freeze({
  values: Object.freeze(['allTodayRoutines', 'areas', 'bucketConfig', 'completedTaskUids', 'dailyNotes', 'dayWindowsRef', 'goals', 'goalsProjectsEnabled', 'gtdFrames', 'habitLogs', 'habits', 'habitsEnabled', 'icsCalendars', 'joboRecordsRef', 'minimizedSections', 'multiUserEnabled', 'obsidianCompletionDates', 'obsidianConfig', 'primaryCalendarMeta', 'projects', 'recurringTasks', 'recycleBin', 'removedTodayRoutineIds', 'routineCompletionTimestamps', 'routineCompletions', 'routineDefinitions', 'routinesDate', 'routinesEnabled', 'syncUrl', 'taskCalendarUrl', 'tasks', 'tasksLiveRef', 'unscheduledLiveRef', 'unscheduledOrderTimestamp', 'unscheduledTasks', 'use24HourClock', 'users', 'weatherTempUnit', 'weatherZip']),
  setters: Object.freeze(['setAreas', 'setBucketConfig', 'setCompletedTaskUids', 'setDailyNotes', 'setGoals', 'setGoalsProjectsEnabled', 'setGtdFrames', 'setHabitLogs', 'setHabits', 'setHabitsEnabled', 'setIcsCalendars', 'setMultiUserEnabled', 'setObsidianCompletionDates', 'setObsidianConfig', 'setPrimaryCalendarMeta', 'setProjects', 'setRecurringTasks', 'setRecycleBin', 'setRemovedTodayRoutineIds', 'setRoutineCompletionTimestamps', 'setRoutineCompletions', 'setRoutineDefinitions', 'setRoutinesDate', 'setRoutinesEnabled', 'setSyncUrl', 'setTaskCalendarAuth', 'setTaskCalendarUrl', 'setTasks', 'setTodayRoutines', 'setUnscheduledOrderTimestamp', 'setUnscheduledTasks', 'setUse24HourClock', 'setUsers', 'setWeatherTempUnit', 'setWeatherZip']),
  refs: Object.freeze(['applyingRemoteDataRef', 'suppressClearPendingRef', 'suppressCloudUploadRef', 'suppressTimestampRef']),
  functions: Object.freeze(['applyRemoteDayWindows', 'applyRemoteJobo', 'stampTaskTimestamps']),
});

const ALL_DEPS = [...SYNC_ENGINE_DATA_DEPS.values, ...SYNC_ENGINE_DATA_DEPS.setters, ...SYNC_ENGINE_DATA_DEPS.refs, ...SYNC_ENGINE_DATA_DEPS.functions];

/** The keys a deps object leaves undefined (a wiring check for both roots). */
export function missingSyncEngineDeps(deps) {
  return ALL_DEPS.filter((key) => deps?.[key] === undefined);
}

export default function useSyncEngineData(deps) {
  if (import.meta.env.DEV) {
    const missing = missingSyncEngineDeps(deps);
    if (missing.length) console.error('[sync] useSyncEngineData is missing deps:', missing.join(', '));
  }
  const {
    allTodayRoutines, areas, bucketConfig, completedTaskUids, dailyNotes, dayWindowsRef,
    goals, goalsProjectsEnabled, gtdFrames, habitLogs, habits, habitsEnabled,
    icsCalendars, joboRecordsRef, minimizedSections, multiUserEnabled, obsidianCompletionDates, obsidianConfig,
    primaryCalendarMeta, projects, recurringTasks, recycleBin, removedTodayRoutineIds, routineCompletionTimestamps,
    routineCompletions, routineDefinitions, routinesDate, routinesEnabled, syncUrl, taskCalendarUrl,
    tasks, tasksLiveRef, unscheduledLiveRef, unscheduledOrderTimestamp, unscheduledTasks, use24HourClock,
    users, weatherTempUnit, weatherZip, setAreas, setBucketConfig, setCompletedTaskUids,
    setDailyNotes, setGoals, setGoalsProjectsEnabled, setGtdFrames, setHabitLogs, setHabits,
    setHabitsEnabled, setIcsCalendars, setMultiUserEnabled, setObsidianCompletionDates, setObsidianConfig, setPrimaryCalendarMeta,
    setProjects, setRecurringTasks, setRecycleBin, setRemovedTodayRoutineIds, setRoutineCompletionTimestamps, setRoutineCompletions,
    setRoutineDefinitions, setRoutinesDate, setRoutinesEnabled, setSyncUrl, setTaskCalendarAuth, setTaskCalendarUrl,
    setTasks, setTodayRoutines, setUnscheduledOrderTimestamp, setUnscheduledTasks, setUse24HourClock, setUsers,
    setWeatherTempUnit, setWeatherZip, applyingRemoteDataRef, suppressClearPendingRef, suppressCloudUploadRef, suppressTimestampRef,
    applyRemoteDayWindows, applyRemoteJobo, stampTaskTimestamps,
  } = deps;

  const buildSyncPayload = () => {
    // Read directly from React state (always current) rather than localStorage to
    // avoid a stale-read race when a state change hasn't flushed to localStorage yet.
    // Task arrays need timestamp-stamping (mirrors saveData); tombstone maps that
    // have no React state counterpart still fall back to localStorage.
    // completedTaskUids prunes at the FIXED window every writer applies
    // (packages/dayglance-vault/src/tombstoneRetention.js, audit fix M7) — not at syncRetentionDays,
    // which is per device and ping-ponged with the vault tier's union.
    const prunedUids = pruneCompletedTaskUids(completedTaskUids);
    // Imported-task sync rule — the actual predicate lives in
    // src/sync/payloadExclusions.js (single source of truth, shared with the
    // DB engine's snapshot-delete classifier; see that module for the rule
    // text and why the two sides must never drift).
    const keepImported = (t) => keepImportedTask(t, multiUserEnabled);

    // Per-user calendar config (multi-user). Read-only here: the device's own
    // entry is maintained by an effect (see "maintain per-user calendar entry"),
    // NOT seeded here. buildSyncPayload runs from the engine's render-time closure
    // and could otherwise fire mid-migration with a stale syncUrl while the
    // migrated flag is already set, writing a leaked URL into this device's entry.
    let calendarConfigByUser = {};
    try { calendarConfigByUser = JSON.parse(localStorage.getItem('day-planner-calendar-config-by-user') || '{}'); } catch { calendarConfigByUser = {}; }
    // Never push a task this device's own tombstones say is deleted — otherwise a
    // stale local copy resurrects a genuinely-deleted task fleet-wide (the delete↔
    // re-add war). Drops only tombstoned-and-older tasks; a restored task (newer than
    // its tombstone) is kept. See utils/dropResurrectedTasks.js.
    let payloadDeletedTaskIds = {};
    try { payloadDeletedTaskIds = JSON.parse(localStorage.getItem('day-planner-deleted-task-ids') || '{}'); } catch { payloadDeletedTaskIds = {}; }
    return {
      version: 2,
      lastModified: new Date().toISOString(),
      data: {
        tasks: stampTaskTimestamps(
          dropResurrectedTasks(tasks.filter(t => !t._native && keepImported(t)), payloadDeletedTaskIds),
          'day-planner-tasks'
        ),
        unscheduledTasks: stampTaskTimestamps(
          dropResurrectedTasks(unscheduledTasks.filter(keepImported), payloadDeletedTaskIds),
          'day-planner-unscheduled'
        ),
        unscheduledOrderTimestamp,
        recycleBin: stampTaskTimestamps(recycleBin, 'day-planner-recycle-bin'),
        syncUrl,
        taskCalendarUrl,
        // Additional calendars sync at the top level with credentials stripped
        // (the apply side restores locally stored creds by entry id). Full
        // entries ride per-user inside calendarConfigByUser when opted in.
        // Whole-list LWW by the sibling icsCalendarsUpdatedAt on both tiers.
        // The primary calendar rides as a URL-less stub carrying its display
        // meta; its URL travels in syncUrl above (see injectPrimaryStub).
        icsCalendars: injectPrimaryStub(stripIcsCalendarCredentials(icsCalendars), primaryCalendarMeta, !!syncUrl),
        icsCalendarsUpdatedAt: localStorage.getItem('day-planner-ics-calendars-updated-at') || null,
        calendarConfigByUser,
        // taskCalendarAuth is intentionally excluded from the top level — credentials
        // ride per-user inside calendarConfigByUser (only when opted in and encrypted),
        // never as a shared top-level field.
        completedTaskUids: prunedUids,
        recurringTasks: stampTaskTimestamps(recurringTasks, 'day-planner-recurring-tasks'),
        routineDefinitions,
        todayRoutines: stampTaskTimestamps(allTodayRoutines, 'day-planner-today-routines'),
        routinesDate,
        routineCompletions,
        // Sibling LWW timestamps for routine completions, read from the SAME
        // render as the completions above — never from localStorage. The two
        // must always describe one state: the open-across-midnight rollover
        // (useRoutines) writes its midnight tombstones to localStorage
        // synchronously while the completions only clear on the next render,
        // so a payload built in that gap from localStorage carried yesterday's
        // completions stamped at today's midnight. That pair is the seed of the
        // one-write-per-pull loop PR #1674 heals (a stale completion tied at
        // the midnight stamp). React commits both state updates together, so
        // reading both from state cannot produce it.
        routineCompletionTimestamps,
        minimizedSections,
        use24HourClock,
        weatherZip,
        weatherTempUnit,
        // Tombstone maps have no React state — read from localStorage (they only
        // change during sync, never between a state change and the next flush).
        deletedTaskIds: JSON.parse(localStorage.getItem('day-planner-deleted-task-ids') || '{}'),
        deletedRoutineChipIds: JSON.parse(localStorage.getItem('day-planner-deleted-routine-chip-ids') || '{}'),
        deletedFrameIds: JSON.parse(localStorage.getItem('day-planner-deleted-frame-ids') || '{}'),
        deletedObsidianKeys: JSON.parse(localStorage.getItem('day-planner-deleted-obsidian-keys') || '{}'),
        // Id-retirement record ({oldId → {retiredAt, successor}}) — like the
        // tombstone maps it has no React state and only changes during sync
        // or the Obsidian write-commit. See utils/retiredTaskIds.js.
        retiredTaskIds: readRetiredTaskIds(),
        removedTodayRoutineIds,
        // Omitted, not {}, until the notes have loaded from IndexedDB (or for a
        // session in which they could not be): not loaded is not empty. The
        // vault diff carries an omitted map forward (dbAdapter
        // absentCollectionKinds); the file-tier merge keeps the remote's notes.
        ...(dailyNotesSyncable() ? { dailyNotes } : {}),
        // Per-day START/STOP timeline markers (flat date map + 'defaults',
        // per-entry lastModified). Read through the ref: the engine can call
        // this closure a beat after a render.
        dayWindows: dayWindowsRef.current,
        habits,
        habitLogs,
        habitLogTimestamps: JSON.parse(localStorage.getItem('day-planner-habit-log-timestamps') || '{}'),
        habitsEnabled,
        habitsEnabledUpdatedAt: localStorage.getItem('day-planner-habits-enabled-updated-at') || null,
        deletedHabitIds: JSON.parse(localStorage.getItem('day-planner-deleted-habit-ids') || '{}'),
        routinesEnabled,
        routinesEnabledUpdatedAt: localStorage.getItem('day-planner-routines-enabled-updated-at') || null,
        gtdFrames,
        bucketConfig,
        goals,
        deletedGoalIds: JSON.parse(localStorage.getItem('day-planner-deleted-goal-ids') || '{}'),
        projects,
        deletedProjectIds: JSON.parse(localStorage.getItem('day-planner-deleted-project-ids') || '{}'),
        areas,
        deletedAreaIds: JSON.parse(localStorage.getItem('day-planner-deleted-area-ids') || '{}'),
        // JOBO ledger, only once loaded (see useJoboLedger above). Both tiers
        // treat an absent key as "does not carry it"; [] would mean empty.
        ...(joboRecordsRef.current !== undefined ? { joboRecords: joboRecordsRef.current } : {}),
        goalsProjectsEnabled,
        goalsProjectsEnabledUpdatedAt: localStorage.getItem('day-planner-goals-projects-enabled-updated-at') || null,
        obsidianConfig: obsidianConfig ?? null,
        obsidianConfigUpdatedAt: localStorage.getItem('day-planner-obsidian-config-updated-at') || null,
        obsidianCompletionDates,
        obsidianCompletionDatesUpdatedAt: localStorage.getItem('day-planner-obsidian-completion-dates-updated-at') || null,
        multiUserEnabled,
        multiUserEnabledUpdatedAt: localStorage.getItem('dayglance-multi-user-enabled-updated-at') || null,
        users,
        // The resurrection fence: local-only items older than this are presumed
        // pruned-and-deleted elsewhere and dropped rather than resurrected
        // (merge.js syncHorizon). It MUST equal the tombstone-GC window, because a
        // tombstone only lives 60 days (packages/dayglance-vault/src/tombstoneRetention.js): <60d-old
        // deletions are caught by the surviving tombstone, >60d ones by this fence,
        // and the two windows must abut with no gap. So the fence is the SAME fixed
        // tombstoneCutoff() — NOT syncRetentionDays.
        //
        // Because it is now a pure function of the current UTC day, every device
        // computes the identical value with no cross-device information, so the
        // vault/file merges recompute-and-overwrite it (dbAdapter.js, mergeSync.js)
        // instead of newerIso/max()-merging it. That is what escapes the monotonic-
        // max() trap that made a fixed value churn forever (PR #1142): a peer's
        // value can never be "newer" in a way we must preserve. Day-floored (via
        // tombstoneCutoff) so the value is STABLE across the many cycles within a
        // day — the snapshot-diff sees no change → no push → no SSE self-nudge.
        // Residual: at UTC midnight the cutoff advances one day, so a single
        // tombstonePrunedBefore change appears once and self-heals within a cycle.
        tombstonePrunedBefore: tombstoneCutoff().toISOString(),
      }
    };
  };


  const applyEngineData = (data, { allowEmpty = false } = {}) => {
    // Safety check: if remote/merged data has zero tasks but local has data,
    // something went wrong in the merge — skip applying to avoid data wipe.
    // Exception: if the remote had a valid lastModified, an empty result is an
    // intentional "delete everything" propagation (allowEmpty=true) and must go through.
    const localTaskCount = JSON.parse(localStorage.getItem('day-planner-tasks') || '[]').length;
    const localInboxCount = JSON.parse(localStorage.getItem('day-planner-unscheduled') || '[]').length;
    const remoteTaskCount = (data.tasks?.length || 0) + (data.unscheduledTasks?.length || 0);
    if (!allowEmpty && localTaskCount + localInboxCount > 0 && remoteTaskCount === 0) {
      console.error('applyEngineData aborted: remote has 0 tasks but local has', localTaskCount + localInboxCount);
      return;
    }

    // Suppress config timestamp tracking effects during remote data application so
    // they don't overwrite the remote timestamps with Date.now(). Clear after
    // 500ms to match the suppressCloudUploadRef window — React post-state-change
    // effects run after setState flushes, which is after the current microtask
    // completes, so setTimeout(0) clears too early.
    applyingRemoteDataRef.current = true;
    setTimeout(() => { applyingRemoteDataRef.current = false; }, 500);

    suppressCloudUploadRef.current = true;
    suppressTimestampRef.current = true;

    // Per-user calendar mode: when multi-user is on and a user is selected, this
    // device's calendar config comes from calendarConfigByUser[mySyncId], not the
    // top-level syncUrl/taskCalendarUrl (which are device-local in multi-user).
    // Read meUserSyncId fresh from localStorage to avoid a stale closure.
    const meSidForCal = (() => {
      try { return JSON.parse(localStorage.getItem('dayglance-multi-user-config') || '{}').meUserSyncId || null; } catch { return null; }
    })();
    // data.multiUserEnabled can be ABSENT: the upstream file-tier merge outputs
    // an explicit key list that does not carry the per-device toggle, so a
    // WebDAV/iCloud pull arrives without it. Falling back to this device's own
    // flag is required — treating absence as false skipped the per-user apply
    // below, so calendarConfigByUser changes were stored but never applied, and
    // the per-user maintenance effect then re-stamped this device's stale
    // calendar list over the fleet's newer entry (calendars added on another
    // device silently vanished).
    const localMultiUser = (() => {
      try { return JSON.parse(localStorage.getItem('dayglance-multi-user-enabled') || 'false') === true; } catch { return false; }
    })();
    const perUserCalendar = !!((data.multiUserEnabled ?? localMultiUser) && meSidForCal);

    // Normalize task defaults so localStorage and React state are identical.
    // Without this, stampTaskTimestamps detects spurious differences (e.g.
    // missing notes/subtasks) and re-stamps lastModified, making stale local
    // tasks appear newer than actual remote changes during merge.
    const normalizeTasks = (tasks) => tasks.map(t => ({ ...t, notes: t.notes ?? '', subtasks: t.subtasks ?? [] }));

    // Source of the app-only "sticky" fields (`archived`, `originalPlan`) for the
    // apply below: this is the FULL live task list, not a filtered one, because a
    // merged/remote copy that OMITS such a field must fall back to whatever this
    // device currently holds for that task. Without it, an apply silently
    // un-archives items and re-stamps lastModified every sync (confirmed via the
    // archived probe: applyEngineData is the second-pass stripper), and drops the
    // original-plan baseline outright. A real remote unarchive sends
    // archived:false explicitly and still propagates; only an ABSENT value falls
    // back to local. Read the LIVE refs (not the closure, which can predate the
    // heal render) for the localStorage writes; the setState calls below use their
    // own `prev` (the authoritative current state). See utils/preserveStickyFields.js.
    const stickyFieldSource = [...tasksLiveRef.current, ...unscheduledLiveRef.current];

    // Drop CalDAV-imported calendar events from the cloud sync payload — they are ephemeral
    // derivatives of the remote feed and must not be cloud-synced or the merge engine will
    // resurrect deleted events. On native, the OS bridge re-provides them; on PWA, CalDAV
    // sync re-imports them on every fetch. Calendar tasks (isTaskCalendar:true) and ICS file
    // imports (importSource:'file') are first-class user data and are kept as normal.
    // In multi-user also drop subscription-derived ('sync') items — they ride
    // per-user via the calendar URL, not the shared payload (mirrors buildSyncPayload).
    const filterTasks = tasks => tasks.filter(t =>
      !(t.imported && !t.isTaskCalendar && t.importSource !== 'file')
      && !(multiUserEnabled && t.imported && t.importSource === 'sync'));

    let normalizedTasks = data.tasks ? preserveStickyFields(filterTasks(normalizeTasks(data.tasks)), stickyFieldSource) : null;
    let normalizedUnsched = data.unscheduledTasks ? preserveStickyFields(filterTasks(normalizeTasks(data.unscheduledTasks)), stickyFieldSource) : null;

    // Id-retirement supersede pass (utils/retiredTaskIds.js): a merged/pulled
    // row whose id the record maps to a LIVE successor is dropped — with its
    // content redirected onto the successor when it is the newer edit —
    // REGARDLESS of timestamps. Retirement is an identity move, not a
    // deletion: without this, a retired-id copy re-stamped newer than its
    // tombstone (offline edit crossing a stamp, peer re-stamp) landed here as
    // a resurrected duplicate and fed the scan-evict ↔ guard-heal war. The
    // live-id set spans BOTH lists AND the recycle bin (audit M8: a binned
    // successor is still the identity the content moved to, exactly as the
    // snapshot-delete partition judges it), so a cross-list or binned
    // successor still counts as live; a row with no live successor is left
    // alone (deletion tombstones still govern it).
    const retiredRecord = data.retiredTaskIds || readRetiredTaskIds();
    const retiredLiveIds = new Set([
      ...(normalizedTasks || tasksLiveRef.current || []),
      ...(normalizedUnsched || unscheduledLiveRef.current || []),
      ...(data.recycleBin || recycleBin || []),
    ].filter(Boolean).map(t => String(t.id)));
    if (normalizedTasks) normalizedTasks = applyTaskRetirements(normalizedTasks, retiredRecord, retiredLiveIds);
    if (normalizedUnsched) normalizedUnsched = applyTaskRetirements(normalizedUnsched, retiredRecord, retiredLiveIds);

    // Symmetric enforcement of deletedObsidianKeys at the APPLY boundary
    // (utils/obsidianDeletions.js — the shared gate both tiers use). The
    // channel used to be honored on the way OUT but ignored on the way IN:
    // every deleting path consulted it while this apply admitted pulled rows
    // unfiltered — the asymmetry behind the tombstone echo war
    // (obsidianTombstoneEchoWar.test.js) and issue #1448. Same LWW as the
    // scan merge: a genuinely restored/re-created copy (lastModified newer
    // than its tombstone) passes and propagates.
    const obsidianTombs = data.deletedObsidianKeys
      || (() => { try { return JSON.parse(localStorage.getItem('day-planner-deleted-obsidian-keys') || '{}'); } catch { return {}; } })();
    if (normalizedTasks) normalizedTasks = dropTombstonedObsidianTasks(normalizedTasks, obsidianTombs);
    if (normalizedUnsched) normalizedUnsched = dropTombstonedObsidianTasks(normalizedUnsched, obsidianTombs);

    // Ghost-row CONTAINMENT (utils/obsidianGhostRows.js): a row an old client
    // minted by parsing a block-id-stamped line — its title still carries the
    // swallowed ^dg- token, which names its own successor — is superseded
    // here (dropped, or its newer edits redirected onto the real task), and
    // the derived retirement is PERSISTED so the guard propagates the ghost's
    // delete and the vault row dies instead of echoing. Containment, not
    // prevention: the minting device keeps its local duplicate until it
    // updates — at which point this same pass self-repairs its state.
    {
      const ghostIn = {
        tasks: normalizedTasks || tasksLiveRef.current || [],
        unscheduledTasks: normalizedUnsched || unscheduledLiveRef.current || [],
      };
      const contained = containObsidianGhostRows(ghostIn);
      persistDerivedGhostRetirements(contained.derived);
      if (normalizedTasks) normalizedTasks = contained.tasks;
      if (normalizedUnsched) normalizedUnsched = contained.unscheduledTasks;
    }

    // Referential self-heal at the APPLY boundary (#2137). A peer's deletion
    // arrives as a tombstone in the same payload; rows that still point at the
    // deleted entity must lose the reference here too, or this device keeps
    // hiding the task (the Inbox treats any "project task" as belonging to a
    // project) or the project (neither under its goal nor standalone) forever.
    //
    // The map to trust is the PAYLOAD's when it carries one: both tiers merge
    // tombstone bundles grow-only into the payload, so it already includes this
    // device's deletions — and a restore replaces the local maps with the
    // backup's, so a project restored from a backup written before its
    // deletion comes back WITH its tasks attached. Falling back to the local
    // map is only for a payload from a client that omits the key (the apply
    // leaves the local map in force then).
    //
    // The repair runs before storage/state are written, unstamped: it is a
    // deterministic function of the tombstone, so every device computes the
    // same one and a last-writer-wins tie converges (unlike the earlier "id not
    // in my project list means deleted" inference, which differed by device).
    const localTombstones = (key) => {
      try {
        const parsed = JSON.parse(localStorage.getItem(key) || '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      } catch { return {}; }
    };
    const deletedProjectIds = resolveDeletedIds(
      data.deletedProjectIds,
      localTombstones('day-planner-deleted-project-ids'),
    );
    const deletedGoalIds = resolveDeletedIds(
      data.deletedGoalIds,
      localTombstones('day-planner-deleted-goal-ids'),
    );
    if (normalizedTasks) normalizedTasks = stripProjectRefs(normalizedTasks, deletedProjectIds);
    if (normalizedUnsched) normalizedUnsched = stripProjectRefs(normalizedUnsched, deletedProjectIds);
    const recycleBinForApply = Array.isArray(data.recycleBin)
      ? stripProjectRefs(data.recycleBin, deletedProjectIds)
      : null;
    const recurringForApply = Array.isArray(data.recurringTasks)
      ? stripProjectRefs(data.recurringTasks, deletedProjectIds)
      : null;
    const projectsForApply = Array.isArray(data.projects)
      ? stripGoalRefs(data.projects, deletedGoalIds)
      : null;

    // Update localStorage
    if (normalizedTasks) localStorage.setItem('day-planner-tasks', JSON.stringify(normalizedTasks));
    if (normalizedUnsched) localStorage.setItem('day-planner-unscheduled', JSON.stringify(normalizedUnsched));
    if (recycleBinForApply) localStorage.setItem('day-planner-recycle-bin', JSON.stringify(recycleBinForApply));
    // Calendar URLs: apply whenever remote explicitly includes them (even empty string,
    // which propagates an intentional URL clear). Only skip when the key is absent.
    // In per-user mode the top-level URLs are device-local — config is applied from
    // calendarConfigByUser[mySyncId] below instead.
    if (!perUserCalendar && data.syncUrl !== undefined) localStorage.setItem('day-planner-sync-url', data.syncUrl);
    if (!perUserCalendar && data.taskCalendarUrl !== undefined) localStorage.setItem('day-planner-task-calendar-url', data.taskCalendarUrl);
    // Additional calendars: the shared payload strips credentials, so restore
    // the locally stored ones by entry id before persisting/applying. The
    // primary's URL-less stub splits off into its meta key; a list without a
    // stub (older client) leaves the local meta untouched.
    if (!perUserCalendar && data.icsCalendars !== undefined) {
      const { meta: remotePrimaryMeta, extras: remoteExtras } = splitPrimaryStub(data.icsCalendars);
      localStorage.setItem(ICS_CALENDARS_KEY, JSON.stringify(applyRemoteIcsCalendars(remoteExtras, loadIcsCalendars())));
      if (remotePrimaryMeta) localStorage.setItem(PRIMARY_CAL_META_KEY, JSON.stringify(remotePrimaryMeta));
      if (data.icsCalendarsUpdatedAt) localStorage.setItem('day-planner-ics-calendars-updated-at', data.icsCalendarsUpdatedAt);
    }
    // taskCalendarAuth is not applied from the top level — credentials are device-local
    // unless they arrive per-user inside calendarConfigByUser (applied below).
    if (data.completedTaskUids) localStorage.setItem('day-planner-task-completed-uids', JSON.stringify(data.completedTaskUids));
    if (recurringForApply) localStorage.setItem('day-planner-recurring-tasks', JSON.stringify(recurringForApply));
    if (data.routineDefinitions) localStorage.setItem('day-planner-routine-definitions', JSON.stringify(data.routineDefinitions));
    // Only apply todayRoutines/routinesDate if the remote data is from today.
    // If it's from a previous day, skip it — local state (already cleared by loadData) is correct.
    const todayStr = dateToString(new Date());
    // Sanitize merged completions for today (#1196 symptom 2): a merged payload
    // can carry a PRIOR-day completion this device never tombstoned (offline
    // overnight while another device completed the routine), and the mirror's
    // routinesDate merges to newest so the today-gate above always passes.
    // Applying it verbatim renders the routine already-done. Drop stale entries
    // and raise their timestamps to the midnight tombstone so the heal also
    // propagates back to the fleet on the next push; genuine today-completions
    // and un-complete markers pass through verbatim (see the helper's doc).
    const sanitizedRoutineState = data.routineCompletions
      ? sanitizeMergedRoutineCompletions(
          data.routineCompletions, data.routineCompletionTimestamps || {}, todayStr, startOfTodayIso(),
        )
      : null;
    if (data.routinesDate === todayStr) {
      if (data.todayRoutines) localStorage.setItem('day-planner-today-routines', JSON.stringify(data.todayRoutines));
      localStorage.setItem('day-planner-routines-date', data.routinesDate);
      if (sanitizedRoutineState) {
        localStorage.setItem('day-planner-routine-completions', JSON.stringify(sanitizedRoutineState.completions));
        localStorage.setItem('day-planner-routine-completion-timestamps', JSON.stringify(sanitizedRoutineState.timestamps));
      } else if (data.routineCompletionTimestamps) {
        localStorage.setItem('day-planner-routine-completion-timestamps', JSON.stringify(data.routineCompletionTimestamps));
      }
    }
    // selectedTags is a per-device UI preference and is not applied to state here.
    // minimizedSections is synced to localStorage so the same section layout follows the user across devices.
    if (data.minimizedSections) localStorage.setItem('minimizedSections', JSON.stringify(data.minimizedSections));
    if (data.use24HourClock !== undefined) localStorage.setItem('day-planner-use-24h-clock', JSON.stringify(data.use24HourClock));
    if (data.weatherZip !== undefined) localStorage.setItem('day-planner-weather-zip', data.weatherZip);
    if (data.weatherTempUnit !== undefined) localStorage.setItem('day-planner-weather-temp-unit', data.weatherTempUnit);
    if (data.deletedTaskIds) localStorage.setItem('day-planner-deleted-task-ids', JSON.stringify(data.deletedTaskIds));
    if (data.deletedRoutineChipIds) localStorage.setItem('day-planner-deleted-routine-chip-ids', JSON.stringify(data.deletedRoutineChipIds));
    if (data.deletedFrameIds) localStorage.setItem('day-planner-deleted-frame-ids', JSON.stringify(data.deletedFrameIds));
    if (data.deletedObsidianKeys) localStorage.setItem('day-planner-deleted-obsidian-keys', JSON.stringify(data.deletedObsidianKeys));
    if (data.retiredTaskIds) localStorage.setItem(RETIRED_TASK_IDS_STORAGE_KEY, JSON.stringify(data.retiredTaskIds));
    if (data.removedTodayRoutineIds) {
      localStorage.setItem('day-planner-removed-today-routine-ids', JSON.stringify(data.removedTodayRoutineIds));
      setRemovedTodayRoutineIds(data.removedTodayRoutineIds);
    }
    if (data.dailyNotes) {
      // Same apply-boundary gate as the task lists above: a note whose
      // deletion tombstone is the newest word must not be re-admitted by a
      // pulled/merged map (this replace used to be the notes' half of the
      // echo war). A note re-created later (newer lastModified) passes.
      const gatedNotes = dropTombstonedObsidianNotes(data.dailyNotes, obsidianTombs);
      // Written here as well as by the app's notes effect, because the headless
      // root has no such effect. Per date, and a no-op while the notes are not
      // loaded (utils/dailyNotesStore.js).
      writeDailyNotes(gatedNotes);
      setDailyNotes(gatedNotes);
    }
    // Day windows MERGE (per-entry LWW) rather than overwrite like the slices
    // above: applyRemoteDayWindows also persists, and is a no-op (no write, no
    // state change) when nothing pulled is newer.
    if (data.dayWindows) applyRemoteDayWindows(data.dayWindows);
    if (data.habits) {
      localStorage.setItem('day-planner-habits', JSON.stringify(data.habits));
      setHabits(data.habits);
    }
    if (data.deletedHabitIds) localStorage.setItem('day-planner-deleted-habit-ids', JSON.stringify(data.deletedHabitIds));
    if (data.habitLogs) {
      localStorage.setItem('day-planner-habit-logs', JSON.stringify(data.habitLogs));
      setHabitLogs(data.habitLogs);
    }
    if (data.habitLogTimestamps) {
      // Merge with local timestamps, keeping the newer of each entry.
      const localTs = JSON.parse(localStorage.getItem('day-planner-habit-log-timestamps') || '{}');
      const merged = { ...localTs };
      for (const [k, v] of Object.entries(data.habitLogTimestamps)) {
        if (!merged[k] || new Date(v) > new Date(merged[k])) merged[k] = v;
      }
      localStorage.setItem('day-planner-habit-log-timestamps', JSON.stringify(merged));
    }
    if (data.habitsEnabled !== undefined) {
      localStorage.setItem('day-planner-habits-enabled', JSON.stringify(data.habitsEnabled));
      setHabitsEnabled(data.habitsEnabled);
      if (data.habitsEnabledUpdatedAt) localStorage.setItem('day-planner-habits-enabled-updated-at', data.habitsEnabledUpdatedAt);
    }
    if (data.routinesEnabled !== undefined) {
      localStorage.setItem('day-planner-routines-enabled', JSON.stringify(data.routinesEnabled));
      setRoutinesEnabled(data.routinesEnabled);
      if (data.routinesEnabledUpdatedAt) localStorage.setItem('day-planner-routines-enabled-updated-at', data.routinesEnabledUpdatedAt);
    }
    if (data.gtdFrames) {
      localStorage.setItem('day-planner-gtd-frames', JSON.stringify(data.gtdFrames));
      setGtdFrames(data.gtdFrames);
    }
    if (data.bucketConfig) {
      const normalized = normalizeBucketConfig(data.bucketConfig);
      localStorage.setItem('day-planner-bucket-config', JSON.stringify(normalized));
      setBucketConfig(normalized);
    }
    if (data.goals) {
      localStorage.setItem('day-planner-goals', JSON.stringify(data.goals));
      setGoals(data.goals);
    }
    if (projectsForApply) {
      localStorage.setItem('day-planner-projects', JSON.stringify(projectsForApply));
      setProjects(projectsForApply);
    }
    if (data.areas) {
      localStorage.setItem('day-planner-areas', JSON.stringify(data.areas));
      setAreas(data.areas);
    }
    if (data.deletedAreaIds) localStorage.setItem('day-planner-deleted-area-ids', JSON.stringify(data.deletedAreaIds));
    // JOBO ledger rows go through the hook, the only writer: merged by id with
    // incoming timestamps untouched, held until the ledger has loaded.
    if (Array.isArray(data.joboRecords)) applyRemoteJobo(data.joboRecords);
    if (data.goalsProjectsEnabled !== undefined) {
      localStorage.setItem('day-planner-goals-projects-enabled', JSON.stringify(data.goalsProjectsEnabled));
      setGoalsProjectsEnabled(data.goalsProjectsEnabled);
      if (data.goalsProjectsEnabledUpdatedAt) localStorage.setItem('day-planner-goals-projects-enabled-updated-at', data.goalsProjectsEnabledUpdatedAt);
    }
    if (data.users !== undefined) {
      const localUsers = JSON.parse(localStorage.getItem('dayglance-users') || '[]');
      const merged = new Map(localUsers.map(u => [u.syncId ?? u.id, u]));
      for (const u of data.users) {
        const key = u.syncId ?? u.id;
        const existing = merged.get(key);
        if (!existing || u.updatedAt > existing.updatedAt) merged.set(key, u);
      }
      const mergedArr = [...merged.values()];
      localStorage.setItem('dayglance-users', JSON.stringify(mergedArr));
      setUsers(mergedArr);
    }
    if (data.multiUserEnabled !== undefined) {
      localStorage.setItem('dayglance-multi-user-enabled', JSON.stringify(data.multiUserEnabled));
      setMultiUserEnabled(data.multiUserEnabled);
      if (data.multiUserEnabledUpdatedAt) localStorage.setItem('dayglance-multi-user-enabled-updated-at', data.multiUserEnabledUpdatedAt);
    }
    if (data.calendarConfigByUser) {
      // Store the merged per-user map, then — in per-user mode — apply MY own
      // entry to this device's live calendar config. Other users' entries are
      // stored but never read here, which is what keeps calendars isolated.
      localStorage.setItem('day-planner-calendar-config-by-user', JSON.stringify(data.calendarConfigByUser));
      if (perUserCalendar) {
        const mine = data.calendarConfigByUser[meSidForCal];
        if (mine) {
          if (mine.syncUrl !== undefined) { localStorage.setItem('day-planner-sync-url', mine.syncUrl); setSyncUrl(mine.syncUrl); }
          if (mine.taskCalendarUrl !== undefined) { localStorage.setItem('day-planner-task-calendar-url', mine.taskCalendarUrl); setTaskCalendarUrl(mine.taskCalendarUrl); }
          if (mine.icsCalendars !== undefined) {
            const { meta: minePrimaryMeta, extras: mineExtras } = splitPrimaryStub(mine.icsCalendars);
            const merged = applyRemoteIcsCalendars(mineExtras, loadIcsCalendars());
            localStorage.setItem(ICS_CALENDARS_KEY, JSON.stringify(merged));
            setIcsCalendars(merged);
            if (minePrimaryMeta) {
              localStorage.setItem(PRIMARY_CAL_META_KEY, JSON.stringify(minePrimaryMeta));
              setPrimaryCalendarMeta(minePrimaryMeta);
            }
          }
          if (mine.auth) { localStorage.setItem('day-planner-task-calendar-auth', JSON.stringify(mine.auth)); setTaskCalendarAuth(mine.auth); }
        }
      }
    }
    if (data.deletedGoalIds) localStorage.setItem('day-planner-deleted-goal-ids', JSON.stringify(data.deletedGoalIds));
    if (data.deletedProjectIds) localStorage.setItem('day-planner-deleted-project-ids', JSON.stringify(data.deletedProjectIds));
    if (data.obsidianCompletionDates !== undefined) {
      localStorage.setItem('day-planner-obsidian-completion-dates', JSON.stringify(data.obsidianCompletionDates));
      setObsidianCompletionDates(data.obsidianCompletionDates === true);
      if (data.obsidianCompletionDatesUpdatedAt) localStorage.setItem('day-planner-obsidian-completion-dates-updated-at', data.obsidianCompletionDatesUpdatedAt);
    }
    if (data.obsidianConfig) {
      // On native apps, vault path and pattern are managed via native storage — only apply
      // the app-level fields so a desktop value doesn't break the native integration.
      // The startup useEffect always re-seeds path/pattern from native config anyway.
      if (isNativeApp()) {
        setObsidianConfig(prev => prev ? {
          ...prev,
          taskHeading: data.obsidianConfig.taskHeading ?? prev.taskHeading,
          dailyNoteTemplate: data.obsidianConfig.dailyNoteTemplate ?? prev.dailyNoteTemplate,
          newNotesFolder: data.obsidianConfig.newNotesFolder ?? prev.newNotesFolder,
        } : prev);
        const existing = JSON.parse(localStorage.getItem('day-planner-obsidian-config') || 'null');
        if (existing) localStorage.setItem('day-planner-obsidian-config', JSON.stringify({
          ...existing,
          taskHeading: data.obsidianConfig.taskHeading ?? existing.taskHeading,
          dailyNoteTemplate: data.obsidianConfig.dailyNoteTemplate ?? existing.dailyNoteTemplate,
          newNotesFolder: data.obsidianConfig.newNotesFolder ?? existing.newNotesFolder,
        }));
      } else {
        localStorage.setItem('day-planner-obsidian-config', JSON.stringify(data.obsidianConfig));
        // Keep the state object when the committed config is content-equal so
        // an unchanged sync cycle doesn't re-render the app (and doesn't churn
        // the identity the config-timestamp effect above used to key on).
        setObsidianConfig(prev => (JSON.stringify(prev ?? null) === JSON.stringify(data.obsidianConfig) ? prev : data.obsidianConfig));
      }
      if (data.obsidianConfigUpdatedAt) localStorage.setItem('day-planner-obsidian-config-updated-at', data.obsidianConfigUpdatedAt);
    }
    // darkMode, reminderSettings, and soundEnabled are device-specific — not synced

    // Update React state directly (avoid page reload).
    // Preserve imported events and native tasks from prev that the merge didn't
    // see.  buildSyncPayload() reads the current `tasks` state variable, but a
    // concurrent calendar sync may have queued a setTasks updater that React
    // hasn't rendered yet.  Without this, those queued imported events are
    // silently discarded by the replacement, causing them to vanish until the
    // next calendar sync re-imports them.
    // Preserve archived against `prev` — the ACTUAL current state at update time,
    // which React guarantees is fresh (the closure/refs above can lag the very
    // latest heal). This is what stops the setState from clobbering a locally-
    // archived item when the merged copy omits the flag.
    // Rescue local-only native/imported/intent tasks the merge didn't govern, but
    // NEVER re-add a task the merge has tombstoned (deletedTaskIds, merged post-pull)
    // — that resurrects a task deleted on another device (the seed-task ping-pong).
    // See utils/rescueUnsyncedTasks.js.
    const rescueDeletedIds = data.deletedTaskIds || {};
    // The merge's fence, for the horizon guard: a prev-only task the payload
    // would have sent, older than this, was dropped by the merge as a zombie
    // (tombstone pruned); rescuing it re-applied every cycle (2026-10-06).
    const rescueOpts = {
      horizon: data.tombstonePrunedBefore || null,
      isGoverned: (t) => !t._native && keepImportedTask(t, multiUserEnabled),
    };
    // Obsidian tasks are rescuable (re-derived from the local vault), but a
    // genuinely vault-deleted one must stay gone — honor its deletedObsidianKeys
    // tombstone. See utils/rescueUnsyncedTasks.js (the ala7ur flicker fix).
    const rescueObsidianTombstones = data.deletedObsidianKeys || {};
    // The retirement pass runs AGAIN on the rescue output: rescue can re-add a
    // prev-only copy of a retired id (this device's own offline edit under the
    // old id). Same rule as above — dropped when its successor is live, with
    // the newer content redirected onto the successor first — so the edit
    // reaches the vault via the successor's normal writeback instead of
    // resurrecting the retired row.
    // The rescue takes the same live-id set (both lists + bin): a prev-only copy
    // of an id the result placed in the OTHER list is a cross-list move the
    // reconcile already resolved, and rescuing it undid that move every cycle
    // (utils/rescueUnsyncedTasks.js, the cross-list guard).
    // The strip runs AGAIN on the setState output because the rescue pass can
    // re-add a device-local row (`_native`, imported, intent) the merge never
    // carried: the invariant is that no state list may reference a tombstoned
    // project, not just the rows the payload happened to contain.
    if (normalizedTasks) setTasks(prev => stripProjectRefs(applyTaskRetirements(
      rescueUnsyncedTasks(preserveStickyFields(normalizedTasks, prev), prev, rescueDeletedIds, undefined, rescueObsidianTombstones, retiredLiveIds, rescueOpts),
      retiredRecord, retiredLiveIds), deletedProjectIds));
    if (normalizedUnsched) setUnscheduledTasks(prev => stripProjectRefs(applyTaskRetirements(
      rescueUnsyncedTasks(preserveStickyFields(normalizedUnsched, prev), prev, rescueDeletedIds, undefined, rescueObsidianTombstones, retiredLiveIds, rescueOpts),
      retiredRecord, retiredLiveIds), deletedProjectIds));
    if (data.unscheduledOrderTimestamp) {
      setUnscheduledOrderTimestamp(data.unscheduledOrderTimestamp);
      localStorage.setItem('day-planner-unscheduled-order-ts', data.unscheduledOrderTimestamp);
    }
    if (recycleBinForApply) setRecycleBin(recycleBinForApply);
    if (!perUserCalendar && data.syncUrl !== undefined) setSyncUrl(data.syncUrl);
    if (!perUserCalendar && data.taskCalendarUrl !== undefined) setTaskCalendarUrl(data.taskCalendarUrl);
    if (!perUserCalendar && data.icsCalendars !== undefined) {
      const { meta: remotePrimaryMeta, extras: remoteExtras } = splitPrimaryStub(data.icsCalendars);
      setIcsCalendars(prev => applyRemoteIcsCalendars(remoteExtras, prev));
      if (remotePrimaryMeta) setPrimaryCalendarMeta(remotePrimaryMeta);
    }
    if (data.completedTaskUids) setCompletedTaskUids(new Set(data.completedTaskUids));
    // Templates take the same carry as the task lists, for `createdAt`
    // (utils/createdAt.js): a series this device stamped moments before the
    // merge built its payload must not lose the stamp to the apply. The other
    // sticky fields are never on a template, so for them it is a no-op.
    if (recurringForApply) setRecurringTasks(prev =>
      stripProjectRefs(rescueUnsyncedTasks(preserveStickyFields(recurringForApply, prev), prev, rescueDeletedIds, t => !!t._intentKey), deletedProjectIds));
    if (data.routineDefinitions) setRoutineDefinitions(data.routineDefinitions);
    // Only apply today's routine state if the remote data is from today — matching
    // the localStorage guard above. If routinesDate is stale/off, applying it would
    // trigger the auto-clear effect in useRoutines and wipe todayRoutines to [].
    // Completions apply SANITIZED (#1196 symptom 2 — see sanitizedRoutineState above).
    if (data.routinesDate === todayStr) {
      if (data.todayRoutines) setTodayRoutines(data.todayRoutines);
      setRoutinesDate(data.routinesDate);
      if (sanitizedRoutineState) {
        setRoutineCompletions(sanitizedRoutineState.completions);
        setRoutineCompletionTimestamps(sanitizedRoutineState.timestamps);
      } else if (data.routineCompletionTimestamps) {
        setRoutineCompletionTimestamps(data.routineCompletionTimestamps);
      }
    }
    if (data.use24HourClock !== undefined) setUse24HourClock(data.use24HourClock);
    if (data.weatherZip !== undefined) setWeatherZip(data.weatherZip);
    if (data.weatherTempUnit !== undefined) setWeatherTempUnit(data.weatherTempUnit);

    // Flag for the save effect to clear suppress after the initial (merged-data) save pass.
    // This avoids a fixed 500ms window that could swallow user actions.
    suppressClearPendingRef.current = true;

    // Safety net: if none of the conditional state setters above fired (all data
    // was already identical), useSaveOnChange never re-runs and the suppress flags
    // remain stuck. Clear them unconditionally after a short delay so subsequent
    // user actions are never permanently blocked.
    setTimeout(() => {
      if (suppressClearPendingRef.current) {
        suppressClearPendingRef.current = false;
        suppressCloudUploadRef.current = false;
        suppressTimestampRef.current = false;
      }
    }, 500);
  };

  return { buildSyncPayload, applyEngineData };
}
