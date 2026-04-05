import React, { useState, useEffect, useRef } from 'react';
import { CheckCircle, AlertCircle, Loader } from 'lucide-react';
import { useSyncCtx } from '../context/SyncContext.jsx';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';

// Minimum time (ms) to show the "syncing" state, even if the sync itself was
// instant. On cold open, syncObsidianVaultNative blocks the JS thread, so React
// cannot paint the syncing state before the freeze ends. This ensures the user
// always sees the "building…" message for at least this long.
const MIN_SYNCING_MS = 1500;

const ObsidianSyncToast = () => {
  const { obsidianSyncStatus, obsidianSyncError } = useSyncCtx();
  const { cardBg, borderClass, textPrimary, textSecondary } = useDayPlannerCtx();

  // displayStatus is what the toast actually shows — it may lag behind
  // obsidianSyncStatus to enforce the minimum syncing display time.
  const [displayStatus, setDisplayStatus] = useState('idle');
  const syncingStartRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    if (obsidianSyncStatus === 'syncing') {
      syncingStartRef.current = Date.now();
      setDisplayStatus('syncing');
    } else if (obsidianSyncStatus === 'success' || obsidianSyncStatus === 'error') {
      const elapsed = syncingStartRef.current != null ? Date.now() - syncingStartRef.current : MIN_SYNCING_MS;
      const remaining = Math.max(0, MIN_SYNCING_MS - elapsed);
      clearTimeout(timerRef.current);
      if (remaining > 0) {
        // Hold on "syncing" until the minimum time is up, then flip to final status
        timerRef.current = setTimeout(() => setDisplayStatus(obsidianSyncStatus), remaining);
      } else {
        setDisplayStatus(obsidianSyncStatus);
      }
    } else {
      clearTimeout(timerRef.current);
      setDisplayStatus('idle');
    }
    return () => clearTimeout(timerRef.current);
  }, [obsidianSyncStatus]);

  if (displayStatus === 'idle') return null;

  const isSyncing = displayStatus === 'syncing';
  const isSuccess = displayStatus === 'success';

  let icon, message, accentColor;
  if (isSyncing) {
    icon = <Loader size={16} className="text-blue-500 animate-spin flex-shrink-0" />;
    message = 'Building Obsidian vault index…';
    accentColor = 'bg-blue-500';
  } else if (isSuccess) {
    icon = <CheckCircle size={16} className="text-green-500 flex-shrink-0" />;
    message = 'Obsidian vault synced';
    accentColor = 'bg-green-500';
  } else {
    icon = <AlertCircle size={16} className="text-red-500 flex-shrink-0" />;
    message = obsidianSyncError || 'Obsidian sync failed';
    accentColor = 'bg-red-500';
  }

  return (
    <div className="fixed bottom-6 left-6 z-50 animate-in slide-in-from-bottom-2 duration-200">
      <div className={`flex items-center gap-3 ${cardBg} border ${borderClass} rounded-xl shadow-xl px-4 py-3 max-w-xs`}>
        <div className={`w-1.5 self-stretch rounded-full flex-shrink-0 ${accentColor}`} />
        {icon}
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium ${textPrimary}`}>{message}</p>
          {isSyncing && (
            <p className={`text-xs ${textSecondary} mt-0.5`}>The app may be slow for a moment</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default ObsidianSyncToast;
