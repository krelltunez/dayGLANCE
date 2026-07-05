import { useEffect } from 'react';
import { isNativeAndroid, isNativeApp } from '../native.js';
import { installUnscheduledStoreProbe } from '../utils/debugArchivedProbe.js';

const isTrayMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('tray');

export default function useAppInit({
  loadData, fetchAllDailyContent, setContentRotation,
  dailyContentEnabled,
  dataLoaded, hasZeroRealTasks,
  hasCheckedInitialWelcome,
  showWelcome, setShowWelcome,
}) {
  // Load data and fetch daily content on mount; rotate content every 15 minutes
  useEffect(() => {
    // DEBUG (gated): watch every day-planner-unscheduled store write for an
    // archived strip, with a stack trace. Installed before loadData so its
    // write-back is covered. Inert unless dayglance-debug-stamp === '1'.
    installUnscheduledStoreProbe();
    loadData();
    if (isTrayMode) return;
    if (dailyContentEnabled && !isNativeApp()) {
      fetchAllDailyContent();
    }

    // Rotate content every 15 minutes
    const rotationInterval = setInterval(() => {
      setContentRotation(prev => (prev + 1) % 4);
    }, 15 * 60 * 1000);

    return () => {
      clearInterval(rotationInterval);
    };
    // Mount-once: load data and start the rotation interval exactly once. Re-running
    // on dependency changes would reload data and reset the interval.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist welcome dismissal only when user has real tasks
  useEffect(() => {
    if (isTrayMode) return;
    if (!showWelcome && !hasZeroRealTasks) {
      localStorage.setItem('welcomeDismissed', 'true');
    }
  }, [showWelcome, hasZeroRealTasks]);

  // Show welcome only on initial load with zero tasks (not when zeroing out during session)
  useEffect(() => {
    if (isTrayMode) return;
    if (dataLoaded && !hasCheckedInitialWelcome.current) {
      hasCheckedInitialWelcome.current = true;
      if (hasZeroRealTasks) {
        setShowWelcome(true);
        localStorage.removeItem('welcomeDismissed');
      } else {
        setShowWelcome(false);
      }
    }
  }, [dataLoaded, hasZeroRealTasks, hasCheckedInitialWelcome, setShowWelcome]);
}
