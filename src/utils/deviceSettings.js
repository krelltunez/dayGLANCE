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
 * string values), minus an exclusion list of (a) stores the backup payload
 * already carries as first-class fields, and (b) volatile sync cursors and
 * caches that would be stale or meaningless after a restore. Prefix capture is
 * deliberate — new settings keys added later ride along automatically instead
 * of re-opening this gap.
 */

const KEY_PREFIX = 'day-planner-';

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
  typeof key === 'string' && key.startsWith(KEY_PREFIX) && !EXCLUDED_KEYS.has(key);

/**
 * Snapshot all capturable day-planner-* keys as { key: rawString }.
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
 * Write a captured settings map back into storage. Only day-planner-* keys
 * outside the exclusion list are applied (a hand-edited backup can't plant
 * arbitrary keys), and only string values. Returns the number applied.
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
