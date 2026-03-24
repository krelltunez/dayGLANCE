import { useState, useEffect } from 'react';

const useCalendarSync = () => {
  const [calSyncStatus, setCalSyncStatus] = useState(null); // null | 'success' | 'error'
  const [calSyncLastSynced, setCalSyncLastSynced] = useState(() =>
    localStorage.getItem('day-planner-cal-sync-last-synced') || null
  );
  const [taskCalendarUrl, setTaskCalendarUrl] = useState('');
  const [taskCalendarAuth, setTaskCalendarAuth] = useState(() => {
    const saved = localStorage.getItem('day-planner-task-calendar-auth');
    return saved ? JSON.parse(saved) : { username: '', appPassword: '', caldavBaseUrl: '' };
  });
  const [syncRetentionDays, setSyncRetentionDays] = useState(() => {
    const saved = localStorage.getItem('day-planner-sync-retention-days');
    return saved ? JSON.parse(saved) : 30;
  });
  const [completedTaskUids, setCompletedTaskUids] = useState(new Set());
  const [pendingImportFile, setPendingImportFile] = useState(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importColor, setImportColor] = useState('bg-gray-600');

  // Persist task calendar auth to localStorage
  useEffect(() => {
    localStorage.setItem('day-planner-task-calendar-auth', JSON.stringify(taskCalendarAuth));
  }, [taskCalendarAuth]);

  return {
    calSyncStatus, setCalSyncStatus,
    calSyncLastSynced, setCalSyncLastSynced,
    taskCalendarUrl, setTaskCalendarUrl,
    taskCalendarAuth, setTaskCalendarAuth,
    syncRetentionDays, setSyncRetentionDays,
    completedTaskUids, setCompletedTaskUids,
    pendingImportFile, setPendingImportFile,
    showImportModal, setShowImportModal,
    importColor, setImportColor,
  };
};

export default useCalendarSync;
