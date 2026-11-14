import { useEffect } from 'react';
import { useNotifyTrayOnChange } from '../utils/trayNotify.js';
import { isTrayMode } from '../utils/trayMode.js';
import { dailyNotesSyncable, writeDailyNotes } from '../utils/dailyNotesStore.js';
import { writeItem } from '../utils/storageWrites.js';
import { INBOX_SORT_KEY } from '../utils/inboxFilter.js';

export default function useLocalStoragePersist({
  minimizedSections,
  use24HourClock,
  inboxPriorityFilter,
  hideCompletedInbox,
  hideProjectTasksInbox,
  hideStandaloneTasksInbox,
  inboxTagFilter,
  inboxProjectFilter,
  inboxSort,
  priorityPromptDismissed,
  sectionInfoDismissed, skipOnboardingPersist,
  dailyNotes, suppressCloudUploadRef, cloudSyncConfig, cloudSyncInitialDoneRef,
  dailyNoteTemplate,
  calendarUrlAuth,
  autoBackupConfig,
  calendarFilter,
}) {
  // Persist minimizedSections to localStorage
  useEffect(() => {
    writeItem('minimizedSections', JSON.stringify(minimizedSections));
  }, [minimizedSections]);

  // Persist use24HourClock to localStorage
  useEffect(() => {
    writeItem('day-planner-use-24h-clock', JSON.stringify(use24HourClock));
  }, [use24HourClock]);

  // Persist inboxPriorityFilter to localStorage
  useEffect(() => {
    writeItem('inboxPriorityFilter', JSON.stringify(inboxPriorityFilter));
  }, [inboxPriorityFilter]);

  // Persist hideCompletedInbox to localStorage
  useEffect(() => {
    writeItem('hideCompletedInbox', hideCompletedInbox.toString());
  }, [hideCompletedInbox]);

  // Persist hideProjectTasksInbox to localStorage
  useEffect(() => {
    writeItem('hideProjectTasksInbox', hideProjectTasksInbox.toString());
  }, [hideProjectTasksInbox]);

  // Persist hideStandaloneTasksInbox to localStorage
  useEffect(() => {
    writeItem('hideStandaloneTasksInbox', hideStandaloneTasksInbox.toString());
  }, [hideStandaloneTasksInbox]);

  // Persist the Inbox sort (utils/inboxFilter.js), on this device like the filters
  useEffect(() => {
    writeItem(INBOX_SORT_KEY, inboxSort);
  }, [inboxSort]);

  // Persist inbox tag and project filters to localStorage
  useEffect(() => {
    writeItem('inboxTagFilter', JSON.stringify(inboxTagFilter));
  }, [inboxTagFilter]);

  useEffect(() => {
    writeItem('inboxProjectFilter', JSON.stringify(inboxProjectFilter));
  }, [inboxProjectFilter]);

  // Persist priorityPromptDismissed to localStorage
  useEffect(() => {
    writeItem('priorityPromptDismissed', priorityPromptDismissed.toString());
  }, [priorityPromptDismissed]);

  useEffect(() => {
    if (!skipOnboardingPersist.current) {
      writeItem('sectionInfoDismissed', JSON.stringify(sectionInfoDismissed));
    }
  }, [sectionInfoDismissed, skipOnboardingPersist]);

  // Persist dailyNotes (utils/dailyNotesStore.js: IndexedDB, per date, or
  // localStorage where there is no database) and trigger cloud sync upload.
  // Nothing is written, or stamped, until the notes have loaded: not loaded is
  // not empty, and the map in state before that is not the user's (#2141).
  // Unreadable notes stay protected the same way (#2138). The tray never writes.
  useEffect(() => {
    if (isTrayMode || !dailyNotesSyncable()) return;
    writeDailyNotes(dailyNotes);
    if (!suppressCloudUploadRef.current && (!cloudSyncConfig?.enabled || cloudSyncInitialDoneRef.current)) {
      writeItem('day-planner-cloud-sync-local-modified', new Date().toISOString());
      // A note edited here (useDataPersistence stamps the same key for the rest).
      writeItem('day-planner-local-edit-at', new Date().toISOString());
    }
    // Keyed on dailyNotes only: this persists on note change and reads the sync
    // guards (refs + current enabled flag) as live values. Adding cloudSyncConfig
    // would re-persist and re-mark dirty on a mere sync-toggle, which is wrong.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dailyNotes]);

  // Persist daily note template
  useEffect(() => {
    writeItem('day-planner-daily-note-template', dailyNoteTemplate);
  }, [dailyNoteTemplate]);

  // Persist calendar URL auth to localStorage
  useEffect(() => {
    writeItem('day-planner-calendar-url-auth', JSON.stringify(calendarUrlAuth));
  }, [calendarUrlAuth]);

  // Persist auto-backup config
  useEffect(() => {
    writeItem('day-planner-auto-backup-config', JSON.stringify(autoBackupConfig));
  }, [autoBackupConfig]);

  // Persist calendar filter whenever it changes.
  //
  // Tray-guarded, matching the invariant enforced in loadData and saveData: the
  // popup holds a snapshot as of its last reload and must never write to
  // localStorage. This key is not merely written on mount like the others — the
  // tray can actively CHANGE it, because applyEvents calls setCalendarFilter
  // when it finds an event whose calendar getCalendars() did not report, and
  // the tray runs that same fetch. The popup still holds the value in state for
  // its own render; it just stops persisting it.
  useEffect(() => {
    if (isTrayMode) return;
    writeItem('day-planner-calendar-filter', JSON.stringify(calendarFilter));
  }, [calendarFilter]);

  // ── Tray popup invalidation ───────────────────────────────────────────────
  // Only for keys the tray actually re-reads on mount. The tray renders its
  // agenda through formatTime (use24HourClock) and shows native calendar events
  // filtered by calendarFilter, so a change to either leaves the popup rendering
  // a stale snapshot until something else happens to reload it.
  //
  // Everything else this hook persists is a main-window view preference —
  // inbox filters, minimizedSections, onboarding dismissals, note template —
  // which the tray either does not render or is better off keeping its own copy
  // of, so those deliberately do NOT nudge the tray.
  useNotifyTrayOnChange(use24HourClock);
  useNotifyTrayOnChange(calendarFilter);
}
