import { useState, useRef, useEffect } from 'react';

const useObsidian = () => {
  const [obsidianConfig, setObsidianConfig] = useState(() => {
    try {
      const saved = localStorage.getItem('day-planner-obsidian-config');
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });
  const [obsidianSyncStatus, setObsidianSyncStatus] = useState('idle'); // 'idle' | 'syncing' | 'success' | 'error'
  const [obsidianSyncError, setObsidianSyncError] = useState(null);
  const [obsidianLastSynced, setObsidianLastSynced] = useState(() =>
    localStorage.getItem('day-planner-obsidian-last-synced') || null
  );
  const obsidianVaultHandleRef = useRef(null);
  const obsidianSyncInProgressRef = useRef(false);
  const obsidianPrevTaskStateRef = useRef({}); // tracks {id: {completed, startTime, title}} for change detection
  // Always-fresh refs so performObsidianSync (called from a long-lived interval)
  // never reads stale task state from a closed-over render.
  const obsidianTasksRef = useRef([]);
  const obsidianInboxRef = useRef([]);

  // Persist Obsidian config
  useEffect(() => {
    if (obsidianConfig) {
      localStorage.setItem('day-planner-obsidian-config', JSON.stringify(obsidianConfig));
    } else {
      localStorage.removeItem('day-planner-obsidian-config');
    }
  }, [obsidianConfig]);

  return {
    obsidianConfig, setObsidianConfig,
    obsidianSyncStatus, setObsidianSyncStatus,
    obsidianSyncError, setObsidianSyncError,
    obsidianLastSynced, setObsidianLastSynced,
    obsidianVaultHandleRef,
    obsidianSyncInProgressRef,
    obsidianPrevTaskStateRef,
    obsidianTasksRef,
    obsidianInboxRef,
  };
};

export default useObsidian;
