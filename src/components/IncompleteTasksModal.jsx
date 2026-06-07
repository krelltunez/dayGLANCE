import React from 'react';
import { ChevronRight, X } from 'lucide-react';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { stripWikilinks } from '../utils/taskUtils.js';
import { useTranslation } from 'react-i18next';

const IncompleteTasksModal = () => {
  const {
    showIncompleteTasks, setShowIncompleteTasks,
    todayIncompleteTasks, allTimeIncompleteTasks,
    cardBg, borderClass, textPrimary, textSecondary,
    darkMode, isMobile,
    setSelectedDate, setShowMobileDailySummary, setMobileActiveTab,
    calendarRef, timeGridRef,
    formatTime, timeToMinutes,
  } = useDayPlannerCtx();
  const { t } = useTranslation();

  if (!showIncompleteTasks) return null;

  const isDaily = showIncompleteTasks === 'today';
  const items = isDaily ? todayIncompleteTasks : allTimeIncompleteTasks;

  return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowIncompleteTasks(null)} onKeyDown={(e) => { if (e.key === 'Escape') setShowIncompleteTasks(null); }} tabIndex={-1} ref={el => el && el.focus()}>
            <div
              className={`${cardBg} rounded-lg shadow-xl ${borderClass} border max-w-md w-full mx-4 flex flex-col`}
              style={{ maxHeight: '70vh' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className={`flex items-center justify-between p-4 border-b ${borderClass}`}>
                <div>
                  <h2 className={`text-lg font-bold ${textPrimary}`}>{t('app.incompleteTasks')}</h2>
                  <p className={`text-xs ${textSecondary}`}>{isDaily ? 'Today' : 'All Time'} — {items.length} task{items.length !== 1 ? 's' : ''}</p>
                </div>
                <button onClick={() => setShowIncompleteTasks(null)} className={`${textSecondary} hover:${textPrimary}`}>
                  <X size={20} />
                </button>
              </div>
              <div className="overflow-y-auto p-4">
                {items.length === 0 ? (
                  <p className={`text-center ${textSecondary} py-6`}>{t('app.allTasksCompleted')}</p>
                ) : (
                  <div className="space-y-2">
                    {items.map(task => (
                      <button
                        key={task.id}
                        className={`w-full flex items-center gap-3 p-2 rounded text-left cursor-pointer ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-stone-50'} transition-colors`}
                        onClick={() => {
                          if (isMobile) {
                            if (task.date) {
                              setSelectedDate(new Date(task.date + 'T12:00:00'));
                            }
                            setShowIncompleteTasks(null);
                            setShowMobileDailySummary(false);
                            setMobileActiveTab('timeline');
                            setTimeout(() => {
                              const el = document.querySelector(`[data-task-id="${task.id}"]`);
                              if (el && calendarRef.current) {
                                const container = calendarRef.current;
                                const elTop = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
                                const scrollTarget = Math.max(0, elTop - container.clientHeight / 2 + el.offsetHeight / 2);
                                container.scrollTo({ top: scrollTarget, behavior: 'smooth' });
                                el.classList.add('ring-2', 'ring-blue-400');
                                setTimeout(() => el.classList.remove('ring-2', 'ring-blue-400'), 2000);
                              }
                            }, 200);
                          } else {
                            if (task.date) {
                              setSelectedDate(new Date(task.date + 'T12:00:00'));
                            }
                            if (task.startTime && calendarRef.current) {
                              setTimeout(() => {
                                const minutes = timeToMinutes(task.startTime);
                                const hourHeight = timeGridRef.current?.children?.[1]?.offsetHeight || 161;
                                const scrollPosition = Math.max(0, (minutes / 60 - 1) * hourHeight);
                                calendarRef.current.scrollTo({ top: scrollPosition, behavior: 'smooth' });
                              }, 150);
                            }
                            setShowIncompleteTasks(null);
                          }
                        }}
                      >
                        <span className={`w-3 h-3 rounded-full flex-shrink-0 ${task.color || 'bg-blue-500'}`} />
                        <div className="min-w-0 flex-1">
                          <div className={`text-sm ${textPrimary} truncate`}>{stripWikilinks(task.title)}</div>
                          <div className={`text-xs ${textSecondary}`}>
                            {isDaily
                              ? (task.startTime ? formatTime(task.startTime) : 'All day')
                              : [task.date && new Date(task.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), task.startTime && formatTime(task.startTime)].filter(Boolean).join(' · ') || 'No date'}
                          </div>
                        </div>
                        <ChevronRight size={14} className={`${textSecondary} flex-shrink-0 opacity-40`} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className={`p-4 border-t ${borderClass}`}>
                <button
                  onClick={() => setShowIncompleteTasks(null)}
                  className={`w-full px-4 py-2 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-200 hover:bg-stone-300'} ${textPrimary} rounded-lg transition-colors text-sm`}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
  );
};

export default IncompleteTasksModal;
