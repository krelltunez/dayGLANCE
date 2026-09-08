import React from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, AlertCircle, Loader } from 'lucide-react';
import { useSyncCtx } from '../context/SyncContext.jsx';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { obsidianToastKey } from '../utils/obsidianToastCopy.js';

const ObsidianSyncToast = () => {
  const { t } = useTranslation();
  const { obsidianSyncStatus, obsidianSyncError, obsidianSyncNotice, setObsidianSyncStatus, setObsidianSyncError, bridgeHeartbeatRef } = useSyncCtx();
  // THE HOLDING POSTURE (2026-09-06 ruling, utils/obsidianVaultPosture.js): a
  // paired device with Obsidian closed never touches its vault — the cycle
  // reads the stream and queues intents. The toast names that, so it never
  // contradicts the settings line saying vault changes wait for Obsidian.
  const vaultPosture = bridgeHeartbeatRef?.current?.vaultPosture;
  const { cardBg, borderClass, textPrimary, textSecondary, isMobile } = useDayPlannerCtx();

  // Fire-and-forget NOTICE (e.g. a two-sided retitle resolution): neutral
  // styling, never red — nothing failed, two edits disagreed and one won.
  // It self-clears (the setter schedules its own dismiss) and deliberately
  // does not touch the status machine below.
  const notice = obsidianSyncStatus === 'idle' || obsidianSyncStatus === 'success'
    ? obsidianSyncNotice
    : null;

  if (obsidianSyncStatus === 'idle' && !notice) return null;

  const isSyncing = obsidianSyncStatus === 'syncing';
  const isSuccess = obsidianSyncStatus === 'success';
  const isError = !notice && !isSyncing && !isSuccess;
  // An error only cleared on the next successful cycle; on a phone every
  // note edit re-raised it, so it stayed until a restart (2026-09-05). A
  // tap dismisses it; the underlying condition, if it persists, raises it
  // again on the next write and is still shown in Settings.
  const dismiss = () => {
    if (!isError) return;
    setObsidianSyncError?.(null);
    setObsidianSyncStatus?.('idle');
  };

  let icon, message, accentColor;
  if (notice) {
    icon = <CheckCircle size={16} className="text-blue-500 flex-shrink-0" />;
    message = notice;
    accentColor = 'bg-blue-500';
  } else if (isSyncing) {
    icon = <Loader size={16} className="text-blue-500 animate-spin flex-shrink-0" />;
    message = t(obsidianToastKey('syncing', vaultPosture));
    accentColor = 'bg-blue-500';
  } else if (isSuccess) {
    icon = <CheckCircle size={16} className="text-green-500 flex-shrink-0" />;
    message = t(obsidianToastKey('success', vaultPosture));
    accentColor = 'bg-green-500';
  } else {
    icon = <AlertCircle size={16} className="text-red-500 flex-shrink-0" />;
    message = obsidianSyncError || t('sync.obsidianToast.failed');
    accentColor = 'bg-red-500';
  }

  return (
    <div
      className={`fixed z-50 animate-in slide-in-from-bottom-2 duration-200 ${isMobile ? 'left-0 right-0 flex justify-center' : 'bottom-6 left-6'}`}
      style={isMobile ? { bottom: 'calc(4.5rem + env(safe-area-inset-bottom, 0px))' } : undefined}
    >
      <div
        className={`flex items-center gap-3 ${cardBg} border ${borderClass} rounded-xl shadow-xl px-4 py-3 max-w-xs ${isError ? 'cursor-pointer' : ''}`}
        role={isError ? 'button' : undefined}
        tabIndex={isError ? 0 : undefined}
        onClick={dismiss}
        onKeyDown={(e) => { if (isError && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); dismiss(); } }}
        aria-label={isError ? t('sync.obsidianToast.dismissError') : undefined}
      >
        <div className={`w-1.5 self-stretch rounded-full flex-shrink-0 ${accentColor}`} />
        {icon}
        <div className="min-w-0">
          <p className={`text-sm font-medium ${textPrimary}`}>{message}</p>
          {isError && <p className={`text-xs ${textSecondary}`}>{t('sync.obsidianToast.tapToDismiss')}</p>}
        </div>
      </div>
    </div>
  );
};

export default ObsidianSyncToast;
