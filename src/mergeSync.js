// Re-exports from @glance-apps/sync.
// dayGLANCE tasks use `lastModified` for the per-item timestamp, so
// mergeTaskArrays pins timestampField rather than re-exporting the alias
// directly (which would default to `updatedAt`).
import { mergeArrayById } from '@glance-apps/sync';

export const mergeTaskArrays = (local, remote, deletedIds, syncHorizon = null) =>
  mergeArrayById(local, remote, deletedIds, syncHorizon, { timestampField: 'lastModified' });

export {
  mergeDailyNotes,
  mergeHabits,
  mergeHabitLogs,
  mergeRoutineDefinitions,
  mergeSyncData,
  pruneTombstones,
} from '@glance-apps/sync';
