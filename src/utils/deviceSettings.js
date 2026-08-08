/**
 * Per-device settings capture for LOCAL backups.
 *
 * Cloud sync deliberately excludes device-scoped state (view defaults, weather
 * config, daily-content toggle, SCHED preferences, …) — each device keeps its
 * own. But the folder backup exists to resurrect a SINGLE device after a
 * profile wipe, so "device-scoped" is exactly what it must carry: without it,
 * every wipe-on-exit session starts with factory settings.
 *
 * Approach: capture every `day-planner-*` localStorage key verbatim (raw
 * string values), plus a fixed list of older keys that predate that naming
 * convention, minus an exclusion list of (a) stores the backup payload already
 * carries as first-class fields, and (b) volatile sync cursors and caches that
 * would be stale or meaningless after a restore. Prefix capture is deliberate —
 * new settings keys added later ride along automatically instead of re-opening
 * this gap.
 */

const KEY_PREFIX = 'day-planner-';

// Settings written before the `day-planner-` convention existed. The prefix
// rule silently missed every one, so a restored profile came back with a reset
// inbox filter bar and one-time prompts the user had already dismissed.
//
// Named rather than renamed: migrating these keys to the prefix would strand
// the values already sitting in every existing browser profile, and would need
// a read-both-write-new shim in each of their owners. This list is closed —
// nothing should ever be added to it, because anything new gets the prefix and
// is captured for free.
//
// Deliberately NOT here:
//  - minimizedSections, gettingStartedDismissed, onboardingProgress: the backup
//    payload already carries these as first-class fields, and duplicating them
//    is the two-sources-of-truth problem EXCLUDED_KEYS exists to prevent.
//  - dailyContent: a date-stamped quote/history fetch cache, refetched on the
//    first run of any new day and therefore stale the moment it is restored.
const LEGACY_KEYS = new Set([
  // The inbox filter bar, in full: priority, tag and project filters plus the
  // three hide toggles. Losing these is what surfaced this gap.
  'inboxPriorityFilter',
  'inboxTagFilter',
  'inboxProjectFilter',
  'hideCompletedInbox',
  'hideProjectTasksInbox',
  'hideStandaloneTasksInbox',
  // One-time prompts and warnings already dismissed. A restore that re-shows
  // them reads as the app having forgotten, which is what a backup is for.
  'priorityPromptDismissed',
  'sectionInfoDismissed',
  'welcomeDismissed',
  'storageWarnDismissed',
]);

const EXCLUDED_KEYS = new Set([
  // Already first-class fields in the auto-backup payload's `data` object —
  // duplicating them would bloat the file and create two sources of truth.
  'day-planner-tasks',
  'day-planner-unscheduled',
  'day-planner-recycle-bin',
  'day-planner-recurring-tasks',
  'day-planner-routine-definitions',
  'day-planner-habits',
  'day-planner-habit-logs',
  'day-planner-goals',
  'day-planner-projects',
  'day-planner-areas',
  'day-planner-task-completed-uids',
  'day-planner-calendar-filter',
  'day-planner-cloud-sync-config',
  'day-planner-reminder-settings',
  'day-planner-ai-config',
  'day-planner-obsidian-config',
  'day-planner-auto-backup-config',
  'day-planner-darkmode',
  'day-planner-sync-url',
  'day-planner-task-calendar-url',
  'day-planner-task-calendar-auth',

  // Volatile markers, sync cursors, and caches — stale after a restore; the
  // owning subsystems rebuild them on their own.
  'day-planner-folder-backup-live-last',
  'day-planner-folder-backup-snapshot-last',
  'day-planner-auto-backup-local-last',
  'day-planner-auto-backup-remote-last',
  'day-planner-cloud-sync-last-synced',
  'day-planner-cloud-sync-local-modified',
  'day-planner-cal-sync-last-synced',
  'day-planner-obsidian-last-scanned',
  'day-planner-obsidian-last-synced',
  'day-planner-trmnl-last-synced',
  'day-planner-steps-cache',
]);

const isCapturable = (key) =>
  typeof key === 'string'
  && (key.startsWith(KEY_PREFIX) || LEGACY_KEYS.has(key))
  && !EXCLUDED_KEYS.has(key);

/**
 * Snapshot all capturable keys as { key: rawString }.
 * Includes device settings AND device-local data stores the payload doesn't
 * carry as fields (daily notes, frames, focus log, routine state, deletion
 * tombstones), which a wiped profile would otherwise lose.
 */
export function collectDeviceSettings(storage = localStorage) {
  const out = {};
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!isCapturable(key)) continue;
    const value = storage.getItem(key);
    if (value !== null) out[key] = value;
  }
  return out;
}

/**
 * Write a captured settings map back into storage. Only keys isCapturable
 * accepts are applied — the day-planner-* prefix or the closed legacy list,
 * minus the exclusions — so a hand-edited backup still can't plant arbitrary
 * keys, and only string values. Returns the number applied.
 */
export function applyDeviceSettings(settings, storage = localStorage) {
  if (!settings || typeof settings !== 'object') return 0;
  let applied = 0;
  for (const [key, value] of Object.entries(settings)) {
    if (!isCapturable(key) || typeof value !== 'string') continue;
    storage.setItem(key, value);
    applied++;
  }
  return applied;
}
