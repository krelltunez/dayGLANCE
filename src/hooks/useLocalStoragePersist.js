import { useEffect } from 'react';

export default function useLocalStoragePersist({
  minimizedSections,
  use24HourClock,
  inboxPriorityFilter,
  hideCompletedInbox,
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

  // Persist priorityPromptDismissed to localStorage
  useEffect(() => {
    localStorage.setItem('priorityPromptDismissed', priorityPromptDismissed.toString());
  }, [priorityPromptDismissed]);

  useEffect(() => {
    if (!skipOnboardingPersist.current) {
      localStorage.setItem('sectionInfoDismissed', JSON.stringify(sectionInfoDismissed));
    }
  }, [sectionInfoDismissed]);

  // Persist dailyNotes to localStorage and trigger cloud sync upload
  useEffect(() => {
    localStorage.setItem('day-planner-daily-notes', JSON.stringify(dailyNotes));
    if (!suppressCloudUploadRef.current && (!cloudSyncConfig?.enabled || cloudSyncInitialDoneRef.current)) {
      localStorage.setItem('day-planner-cloud-sync-local-modified', new Date().toISOString());
    }
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
