import { useEffect } from 'react';

export default function useLocalStoragePersist({
  minimizedSections,
  use24HourClock,
  inboxPriorityFilter,
  hideCompletedInbox,
  hideProjectTasksInbox,
  hideStandaloneTasksInbox,
  inboxTagFilter,
  inboxProjectFilter,
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
    localStorage.setItem('minimizedSections', JSON.stringify(minimizedSections));
  }, [minimizedSections]);

  // Persist use24HourClock to localStorage
  useEffect(() => {
    localStorage.setItem('day-planner-use-24h-clock', JSON.stringify(use24HourClock));
  }, [use24HourClock]);

  // Persist inboxPriorityFilter to localStorage
  useEffect(() => {
    localStorage.setItem('inboxPriorityFilter', JSON.stringify(inboxPriorityFilter));
  }, [inboxPriorityFilter]);

  // Persist hideCompletedInbox to localStorage
  useEffect(() => {
    localStorage.setItem('hideCompletedInbox', hideCompletedInbox.toString());
  }, [hideCompletedInbox]);

  // Persist hideProjectTasksInbox to localStorage
  useEffect(() => {
    localStorage.setItem('hideProjectTasksInbox', hideProjectTasksInbox.toString());
  }, [hideProjectTasksInbox]);

  // Persist hideStandaloneTasksInbox to localStorage
  useEffect(() => {
    localStorage.setItem('hideStandaloneTasksInbox', hideStandaloneTasksInbox.toString());
  }, [hideStandaloneTasksInbox]);

  // Persist inbox tag and project filters to localStorage
  useEffect(() => {
    localStorage.setItem('inboxTagFilter', JSON.stringify(inboxTagFilter));
  }, [inboxTagFilter]);

  useEffect(() => {
    localStorage.setItem('inboxProjectFilter', JSON.stringify(inboxProjectFilter));
  }, [inboxProjectFilter]);

  // Persist priorityPromptDismissed to localStorage
  useEffect(() => {
    localStorage.setItem('priorityPromptDismissed', priorityPromptDismissed.toString());
  }, [priorityPromptDismissed]);

  useEffect(() => {
    if (!skipOnboardingPersist.current) {
      localStorage.setItem('sectionInfoDismissed', JSON.stringify(sectionInfoDismissed));
    }
  }, [sectionInfoDismissed, skipOnboardingPersist]);

  // Persist dailyNotes to localStorage and trigger cloud sync upload
  useEffect(() => {
    localStorage.setItem('day-planner-daily-notes', JSON.stringify(dailyNotes));
    if (!suppressCloudUploadRef.current && (!cloudSyncConfig?.enabled || cloudSyncInitialDoneRef.current)) {
      localStorage.setItem('day-planner-cloud-sync-local-modified', new Date().toISOString());
    }
    // Keyed on dailyNotes only: this persists on note change and reads the sync
    // guards (refs + current enabled flag) as live values. Adding cloudSyncConfig
    // would re-persist and re-mark dirty on a mere sync-toggle, which is wrong.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dailyNotes]);

  // Persist daily note template
  useEffect(() => {
    localStorage.setItem('day-planner-daily-note-template', dailyNoteTemplate);
  }, [dailyNoteTemplate]);

  // Persist calendar URL auth to localStorage
  useEffect(() => {
    localStorage.setItem('day-planner-calendar-url-auth', JSON.stringify(calendarUrlAuth));
  }, [calendarUrlAuth]);

  // Persist auto-backup config
  useEffect(() => {
    localStorage.setItem('day-planner-auto-backup-config', JSON.stringify(autoBackupConfig));
  }, [autoBackupConfig]);

  // Persist calendar filter whenever it changes
  useEffect(() => {
    localStorage.setItem('day-planner-calendar-filter', JSON.stringify(calendarFilter));
  }, [calendarFilter]);
}
