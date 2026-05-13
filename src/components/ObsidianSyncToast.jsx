import React from 'react';
import { CheckCircle, AlertCircle, Loader } from 'lucide-react';
import { useSyncCtx } from '../context/SyncContext.jsx';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';

const ObsidianSyncToast = () => {
  const { obsidianSyncStatus, obsidianSyncError } = useSyncCtx();
  const { cardBg, borderClass, textPrimary, textSecondary, isMobile } = useDayPlannerCtx();

  if (obsidianSyncStatus === 'idle') return null;

  const isSyncing = obsidianSyncStatus === 'syncing';
  const isSuccess = obsidianSyncStatus === 'success';

  let icon, message, accentColor;
  if (isSyncing) {
    icon = <Loader size={16} className="text-blue-500 animate-spin flex-shrink-0" />;
    message = 'Syncing Obsidian vault…';
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
    <div
      className={`fixed z-50 animate-in slide-in-from-bottom-2 duration-200 ${isMobile ? 'left-1/2 -translate-x-1/2' : 'bottom-6 left-6'}`}
      style={isMobile ? { bottom: 'calc(4.5rem + env(safe-area-inset-bottom, 0px))' } : undefined}
    >
      <div className={`flex items-center gap-3 ${cardBg} border ${borderClass} rounded-xl shadow-xl px-4 py-3 max-w-xs`}>
        <div className={`w-1.5 self-stretch rounded-full flex-shrink-0 ${accentColor}`} />
        {icon}
        <p className={`text-sm font-medium ${textPrimary}`}>{message}</p>
      </div>
    </div>
  );
};

export default ObsidianSyncToast;
