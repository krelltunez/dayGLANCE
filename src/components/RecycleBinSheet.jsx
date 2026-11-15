import React from 'react';
import { Trash2, Undo2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { renderTitle } from '../utils/textFormatting.jsx';
import { formatTaskDuration } from '../utils/formatDuration.js';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useSyncCtx } from '../context/SyncContext.jsx';

// The Recycle Bin: what was deleted, with a way back for each task and a way
// out for each task (#2406) or for all of them.
//
// One component for the phone's bottom sheet and the desktop's left-hand card.
// They were two copies of the same markup (MobileBottomSheets.jsx and
// App.jsx), and had already drifted: the desktop one still wrote "308min"
// after the phone's had moved to hours and minutes.
//
// `variant` is where it sits: 'phone' spans the screen above the home
// indicator; 'desktop' is 320px wide at the bottom left, over the side panel.
export default function RecycleBinSheet({ variant = 'phone' }) {
  const {
    recycleBin, cardBg, darkMode, textPrimary, textSecondary, formatTime,
    undeleteTask, emptyRecycleBin, deleteFromBin,
  } = useDayPlannerCtx();
  const { showMobileRecycleBin, setShowMobileRecycleBin } = useSyncCtx();
  const { t } = useTranslation();

  if (!showMobileRecycleBin) return null;

  const desktop = variant === 'desktop';
  const items = recycleBin.filter(task => !task.isExample);
  const close = () => setShowMobileRecycleBin(false);
  // Taking the last task out, either way, leaves nothing to look at.
  const closeIfLast = () => { if (items.length <= 1) close(); };
  const rowButton = 'bg-white/20 rounded-lg p-1.5 hover:bg-white/25 active:bg-white/30 transition-colors';

  return (
    <div
      data-recycle-bin-sheet={variant}
      className={`fixed inset-0 z-50 flex flex-col justify-end ${desktop ? 'items-start' : ''}`}
      onClick={close}
    >
      <div className="bg-black/30 absolute inset-0" />
      <div
        className={`relative ${cardBg} rounded-t-2xl shadow-xl max-h-[70vh] flex flex-col`}
        style={desktop
          ? { paddingBottom: '1rem', width: '320px' }
          : { paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className={`w-10 h-1 rounded-full ${darkMode ? 'bg-gray-600' : 'bg-stone-300'}`} />
        </div>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <Trash2 size={18} className={textSecondary} />
            <span className={`font-semibold ${textPrimary}`}>{t('app.recycleBin')}</span>
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${darkMode ? 'bg-gray-700 text-gray-400' : 'bg-stone-200 text-stone-500'}`}>
              {items.length}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {items.length > 0 && (
              <button
                data-recycle-bin-empty
                onClick={emptyRecycleBin}
                className="text-xs text-red-500 font-medium px-2 py-1 rounded-lg hover:bg-red-500/5 active:bg-red-500/10 dark:hover:bg-red-500/10 dark:active:bg-red-500/20 transition-colors"
              >
                {t('app.emptyAll')}
              </button>
            )}
            <button
              onClick={close}
              className={`p-1.5 rounded-lg ${darkMode ? 'bg-white/10 hover:bg-white/20' : 'bg-stone-100 hover:bg-stone-200'} transition-colors`}
              aria-label={t('app.closeRecycleBin')}
            >
              <X size={16} className={textSecondary} />
            </button>
          </div>
        </div>
        {/* Task list */}
        <div className="overflow-y-auto px-4 pb-2 space-y-2">
          {items.length === 0 ? (
            <p className={`text-sm ${textSecondary} text-center py-8`}>{t('app.recycleBinEmpty')}</p>
          ) : (
            items.map(task => (
              <div key={`bin-${task.id}`} data-recycle-bin-row={task.id} className={`${task.color} rounded-lg p-3 opacity-60`}>
                <div className="flex items-start justify-between text-white">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{renderTitle(task.title)}</div>
                    <div className="text-xs opacity-75 mt-1">
                      {task._deletedFrom === 'inbox' ? (
                        <>{t('app.recycleBinInbox')} • {formatTaskDuration(task.duration, t)}</>
                      ) : task.startTime ? (
                        <>{formatTime(task.startTime)} • {formatTaskDuration(task.duration, t)}</>
                      ) : (
                        <>{formatTaskDuration(task.duration, t)}</>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 ml-2 shrink-0">
                    <button
                      data-recycle-bin-restore
                      onClick={() => { undeleteTask(task.id); closeIfLast(); }}
                      className={rowButton}
                      title={t('common.restore')}
                      aria-label={t('common.restore')}
                    >
                      <Undo2 size={14} />
                    </button>
                    <button
                      data-recycle-bin-delete
                      onClick={() => { deleteFromBin(task.id); closeIfLast(); }}
                      className={rowButton}
                      title={t('app.deleteForever')}
                      aria-label={t('app.deleteForever')}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
