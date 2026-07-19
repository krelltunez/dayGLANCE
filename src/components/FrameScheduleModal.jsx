import React, { useState } from 'react';
import { Inbox, Calendar, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { stripWikilinks } from '../utils/taskUtils.js';
import { filterFrameScheduleTasks } from '../utils/frameScheduleTasks.js';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';

const FrameScheduleModal = () => {
  const { unscheduledTasks, manuallyScheduleTask, darkMode, cardBg, borderClass, textPrimary, textSecondary, hoverBg, inboxTagFilter, inboxProjectFilter } = useDayPlannerCtx();
  const { frameScheduleModal, setFrameScheduleModal, computeAvailableSlots, isVisibleForUser, goalsProjectsEnabled } = useFeaturesCtx();
  const { t } = useTranslation();

  const tagAffinity = frameScheduleModal.frame.tagAffinity || [];
  const hasAffinity = tagAffinity.length > 0;
  // Default to affinity matching when the frame declares one
  const [affinityOnly, setAffinityOnly] = useState(hasAffinity);
  // The inbox project filter only exists when goals/projects is enabled
  // (mirrors useComputedViews, which gates it the same way)
  const effectiveProjectFilter = goalsProjectsEnabled ? inboxProjectFilter : [];
  const inboxFiltersActive = inboxTagFilter.length > 0 || effectiveProjectFilter.length > 0;
  // Local dismissal only; never mutates the persisted inbox filter state
  const [applyInboxFilters, setApplyInboxFilters] = useState(true);

  const inboxTasks = filterFrameScheduleTasks(unscheduledTasks, {
    dateStr: frameScheduleModal.dateStr,
    isVisibleForUser,
    inboxTagFilter,
    inboxProjectFilter: effectiveProjectFilter,
    applyInboxFilters,
    tagAffinity,
    affinityOnly,
  });
  const frameInstance = {
    frameId: frameScheduleModal.frameId,
    date: frameScheduleModal.dateStr,
    start: frameScheduleModal.frame.start,
    end: frameScheduleModal.frame.end,
    bufferMinutes: frameScheduleModal.frame.bufferMinutes ?? 5,
  };
  const availableSlots = computeAvailableSlots(frameInstance, new Date(frameScheduleModal.dateStr + 'T12:00:00'));
  const totalAvailable = availableSlots.reduce((sum, s) => sum + s.minutes, 0);

  const segmentOn = darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900 shadow-sm';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70]" onClick={() => setFrameScheduleModal(null)}>
      <div className={`${cardBg} rounded-lg shadow-xl border ${borderClass} w-80 max-h-[70vh] flex flex-col`} onClick={(e) => e.stopPropagation()}>
        <div className={`p-4 border-b ${borderClass}`}>
          <h3 className={`font-semibold ${textPrimary}`}>{t('frames.manualSchedule')}</h3>
          <p className={`text-xs ${textSecondary} mt-1`}>
            {frameScheduleModal.frame.label} &middot; {frameScheduleModal.dateStr}
          </p>
          <p className="mt-1.5">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${darkMode ? 'bg-blue-900/40 text-blue-300' : 'bg-blue-100 text-blue-700'}`}>{t('frames.minAvailable', { minutes: totalAvailable })}</span>
          </p>
          {hasAffinity && (
            <div className={`flex rounded-lg ${darkMode ? 'bg-gray-800' : 'bg-stone-200'} p-0.5 mt-2`}>
              <button
                onClick={() => setAffinityOnly(true)}
                className={`flex-1 py-1 rounded-md text-xs font-medium transition-colors ${affinityOnly ? segmentOn : textSecondary}`}
              >
                {t('frames.matchingTags')}
              </button>
              <button
                onClick={() => setAffinityOnly(false)}
                className={`flex-1 py-1 rounded-md text-xs font-medium transition-colors ${!affinityOnly ? segmentOn : textSecondary}`}
              >
                {t('frames.allTasks')}
              </button>
            </div>
          )}
          {inboxFiltersActive && applyInboxFilters && (
            <p className="mt-2">
              <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${darkMode ? 'bg-amber-900/40 text-amber-300' : 'bg-amber-100 text-amber-700'}`}>
                {t('frames.inboxFiltersApplied')}
                <button
                  onClick={() => setApplyInboxFilters(false)}
                  className="hover:opacity-70 transition-opacity"
                  title={t('frames.showAllInboxTasks')}
                  aria-label={t('frames.showAllInboxTasks')}
                >
                  <X size={12} />
                </button>
              </span>
            </p>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {inboxTasks.length === 0 ? (
            <div className={`text-center py-8 ${textSecondary} text-sm`}>
              <Inbox size={24} className="mx-auto mb-2 opacity-50" />
              {t('frames.noInboxTasks')}
            </div>
          ) : (
            inboxTasks.map(task => {
              const fits = availableSlots.some(s => s.minutes >= (task.duration || 30));
              return (
                <button
                  key={task.id}
                  className={`w-full text-left px-3 py-2.5 rounded-lg mb-1 transition-colors flex items-start gap-2 ${!fits ? 'opacity-50 cursor-not-allowed' : hoverBg}`}
                  onClick={() => fits && manuallyScheduleTask(task.id)}
                  disabled={!fits}
                  title={!fits ? t('frames.noSlotLargeEnough', { minutes: task.duration || 30 }) : t('frames.scheduleInFrame', { frame: frameScheduleModal.frame.label })}
                >
                  <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${task.color || 'bg-blue-500'}`} />
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm ${textPrimary} truncate`}>{stripWikilinks(task.title)}</div>
                    <div className={`text-xs ${textSecondary} flex items-center gap-2 mt-0.5`}>
                      <span>{t('frames.taskMinutes', { minutes: task.duration || 30 })}</span>
                      {task.priority >= 1 && <span className={task.priority >= 2 ? 'text-red-500' : 'text-amber-500'}>P{task.priority}</span>}
                      {task.deadline && <span className="flex items-center gap-0.5"><Calendar size={10} />{task.deadline}</span>}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
        <div className={`p-3 border-t ${borderClass}`}>
          <button onClick={() => setFrameScheduleModal(null)} className={`w-full px-3 py-2 rounded-lg text-sm ${textSecondary} ${hoverBg} transition-colors`}>{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  );
};

export default FrameScheduleModal;
