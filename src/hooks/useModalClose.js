import { useEffect } from 'react';

export default function useModalClose({
  taskContextMenu, setTaskContextMenu,
  timelineContextMenu, setTimelineContextMenu,
  quickAddFrameModal, setQuickAddFrameModal,
  frameContextMenu, setFrameContextMenu,
  frameAdjustModal, setFrameAdjustModal,
  frameScheduleModal, setFrameScheduleModal,
  showFramesModal, setShowFramesModal, setEditingFrame,
  showSpotlight, setShowSpotlight,
  showHelpModal, setShowHelpModal,
  showShortcutHelp, setShowShortcutHelp,
  editingRecurrenceTaskId, setEditingRecurrenceTaskId,
  showMonthView, setShowMonthView,
  showAutoBackupManager, setShowAutoBackupManager, setAutoBackupRestoreConfirm,
  showBackupMenu, setShowBackupMenu,
  showVoiceInput, setShowVoiceInput,
  showSettings, setShowSettings,
  showRemindersSettings, setShowRemindersSettings,
  showWeeklyReview, setShowWeeklyReview,
  showMobileDailySummary, setShowMobileDailySummary,
  showAddTask, setShowAddTask, setShowNewTaskDeadlinePicker,
  showRecurrencePicker, setShowRecurrencePicker,
}) {
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key !== 'Escape') return;

      // Escape to close modals/dialogs (works even when focus is on body)
      if (taskContextMenu) {
        e.preventDefault();
        setTaskContextMenu(null);
        return;
      }
      if (timelineContextMenu) {
        e.preventDefault();
        setTimelineContextMenu(null);
        return;
      }
      if (quickAddFrameModal) {
        e.preventDefault();
        setQuickAddFrameModal(null);
        return;
      }
      if (frameContextMenu) {
        e.preventDefault();
        setFrameContextMenu(null);
        return;
      }
      if (frameAdjustModal) {
        e.preventDefault();
        setFrameAdjustModal(null);
        return;
      }
      if (frameScheduleModal) {
        e.preventDefault();
        setFrameScheduleModal(null);
        return;
      }
      if (showFramesModal) {
        e.preventDefault();
        setShowFramesModal(false);
        setEditingFrame(null);
        return;
      }
      if (showSpotlight) {
        e.preventDefault();
        setShowSpotlight(false);
        return;
      }
      if (showHelpModal) {
        e.preventDefault();
        setShowHelpModal(false);
        return;
      }
      if (showShortcutHelp) {
        e.preventDefault();
        setShowShortcutHelp(false);
        return;
      }
      if (editingRecurrenceTaskId) {
        e.preventDefault();
        setEditingRecurrenceTaskId(null);
        return;
      }
      if (showMonthView) {
        e.preventDefault();
        setShowMonthView(false);
        return;
      }
      if (showAutoBackupManager) {
        e.preventDefault();
        setShowAutoBackupManager(false);
        setAutoBackupRestoreConfirm(null);
        return;
      }
      if (showBackupMenu) {
        e.preventDefault();
        setShowBackupMenu(false);
        return;
      }
      if (showVoiceInput) {
        e.preventDefault();
        setShowVoiceInput(false);
        return;
      }
      if (showSettings) {
        e.preventDefault();
        setShowSettings(false);
        return;
      }
      if (showRemindersSettings) {
        e.preventDefault();
        setShowRemindersSettings(false);
        return;
      }
      if (showWeeklyReview) {
        e.preventDefault();
        setShowWeeklyReview(false);
        return;
      }
      if (showMobileDailySummary) {
        e.preventDefault();
        setShowMobileDailySummary(false);
        return;
      }
      if (showAddTask) {
        e.preventDefault();
        if (showRecurrencePicker) {
          setShowRecurrencePicker(false);
        } else {
          setShowAddTask(false);
          setShowNewTaskDeadlinePicker(false);
        }
        return;
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [taskContextMenu, timelineContextMenu, quickAddFrameModal, frameContextMenu, frameAdjustModal, frameScheduleModal, showFramesModal, showSpotlight, showHelpModal, showShortcutHelp, editingRecurrenceTaskId, showMonthView, showAutoBackupManager, showBackupMenu, showVoiceInput, showSettings, showRemindersSettings, showWeeklyReview, showMobileDailySummary, showAddTask, showRecurrencePicker]);
}
