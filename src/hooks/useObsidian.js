import { useState, useRef, useEffect } from 'react';
import { OBSIDIAN_LAUNCH_ON_WRITE_KEY } from '../utils/obsidianLaunchOnWrite.js';

const useObsidian = () => {
  const [obsidianConfig, setObsidianConfig] = useState(() => {
    try {
      const saved = localStorage.getItem('day-planner-obsidian-config');
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });
  const [obsidianSyncStatus, setObsidianSyncStatus] = useState('idle'); // 'idle' | 'syncing' | 'success' | 'error'
  const [obsidianSyncError, setObsidianSyncError] = useState(null);
  // Fire-and-forget neutral notice (e.g. a two-sided retitle resolution) —
  // separate from the ERROR channel on purpose: a conflict is a one-shot
  // event, not a failure, and must never latch or show red.
  const [obsidianSyncNotice, setObsidianSyncNotice] = useState(null);
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

  // Launch-on-write toggle — DEVICE-LOCAL tri-state ('on' | 'off' | null =
  // platform default), deliberately kept out of obsidianConfig: that object
  // cloud-syncs and would leak a macOS "on" to a Windows device. See
  // utils/obsidianLaunchOnWrite.js.
  const [obsidianLaunchOnWrite, setObsidianLaunchOnWrite] = useState(() => {
    const saved = localStorage.getItem(OBSIDIAN_LAUNCH_ON_WRITE_KEY);
    return saved === 'on' || saved === 'off' ? saved : null;
  });

  // "Write completion dates to Obsidian" — a SYNCED top-level setting
  // (habitsEnabled pattern: value + UpdatedAt sibling, LWW across a user's
  // own devices), default ON. Deliberately NOT a field of obsidianConfig:
  // that object is device-local on every merge tier (mergeSync
  // ALWAYS_LOCAL_KEYS, dbAdapter ALWAYS_DEVICE_LOCAL — the vault genuinely
  // differs per machine), so a field there would never propagate — and this
  // is a vault CONVENTION the user wants consistent fleet-wide, not a device
  // preference. Aesthetic, not correctness: OFF means markers stop being
  // regenerated and lines converge clean on their next touch (no sweep);
  // reading both marker formats stays unconditional.
  const [obsidianCompletionDates, setObsidianCompletionDates] = useState(() => {
    try {
      const saved = localStorage.getItem('day-planner-obsidian-completion-dates');
      return saved === null ? true : JSON.parse(saved) === true;
    } catch { return true; }
  });

  useEffect(() => {
    localStorage.setItem('day-planner-obsidian-completion-dates', JSON.stringify(obsidianCompletionDates));
  }, [obsidianCompletionDates]);

  // Persist Obsidian config
  useEffect(() => {
    if (obsidianConfig) {
      localStorage.setItem('day-planner-obsidian-config', JSON.stringify(obsidianConfig));
    } else {
      localStorage.removeItem('day-planner-obsidian-config');
    }
  }, [obsidianConfig]);

  // Persist the launch-on-write tri-state (unset clears the key, so a future
  // platform-default change reaches devices that never made an explicit choice)
  useEffect(() => {
    if (obsidianLaunchOnWrite === 'on' || obsidianLaunchOnWrite === 'off') {
      localStorage.setItem(OBSIDIAN_LAUNCH_ON_WRITE_KEY, obsidianLaunchOnWrite);
    } else {
      localStorage.removeItem(OBSIDIAN_LAUNCH_ON_WRITE_KEY);
    }
  }, [obsidianLaunchOnWrite]);

  return {
    obsidianConfig, setObsidianConfig,
    obsidianLaunchOnWrite, setObsidianLaunchOnWrite,
    obsidianCompletionDates, setObsidianCompletionDates,
    obsidianSyncStatus, setObsidianSyncStatus,
    obsidianSyncNotice, setObsidianSyncNotice,
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
