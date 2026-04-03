import React from 'react';
import {
  BarChart3, CalendarDays, Check, CheckCircle, ChevronDown, ChevronUp,
  Clock, Filter, Flag, Flame, FolderOpen, Hash, Inbox,
  MoreHorizontal, Target, Trash2, TrendingUp, Trophy, Undo2, X,
} from 'lucide-react';
import { renderTitle } from '../utils/textFormatting.jsx';
import { dateToString, extractTags } from '../utils/taskUtils.js';
import { HABIT_COLORS, HABIT_ICONS } from '../constants/habits.js';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';

const MobileBottomSheets = () => {
  const {
    visibleDates,
    darkMode,
    cardBg, borderClass, textPrimary, textSecondary, hoverBg,
    tasks,
    expandedRecurringTasks,
    unscheduledTasks,
    recycleBin, setRecycleBin,
    completedTaskUids,
    selectedTags,
    allTags,
    showUntagged, setShowUntagged,
    showMobileRecycleBin, setShowMobileRecycleBin,
    showMobileTagFilter, setShowMobileTagFilter,
    showMobileDailySummary, setShowMobileDailySummary,
    activeHabits, habitStreaks, habitLogs, habitsEnabled,
    focusLog,
    goals, projects,
    goalsProjectsEnabled,
    showIncompleteTasks, setShowIncompleteTasks,
    dailyStatsAllTimeCollapsed, setDailyStatsAllTimeCollapsed,
    dailyStatsHabitsCollapsed, setDailyStatsHabitsCollapsed,
    actualTodayNonImportedTasks, actualTodayCompletedTasks,
    actualTodayCompletedMinutes, actualTodayPlannedMinutes, actualTodayFocusMinutes,
    allTimeFocusMinutes, allTimeProjectFocusMinutes,
    inboxCompletedTodayCount, inboxCompletedTodayMinutes,
    allTimeInboxCompletedCount, allTimeInboxCompletedMinutes,
    projectTasksCompletedTodayCount,
    allTimeUnscheduledProjectDoneCount, allTimeUnscheduledProjectDoneMinutes,
    allTimeScheduledCount, allTimeCompletedCount,
    totalCompletedMinutes, totalScheduledMinutes,
    consecutiveDayStreak,
    todayCompletedGoals, todayCompletedProjects,
    allTimeGoalsCreated, allTimeGoalsCompleted,
    allTimeProjectsCreated, allTimeProjectsCompleted,
    allTimeIncompleteTasks,
    todayIncompleteTasks,
    formatTime,
    toggleTag,
    selectAllTags, clearTagFilter,
    restoreFromRecycleBin, emptyRecycleBin, undeleteTask,
    getTasksForDate,
  } = useDayPlannerCtx();

  return (
    <>
{/* Mobile Recycle Bin Bottom Sheet */}
{showMobileRecycleBin && (
  <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={() => setShowMobileRecycleBin(false)}>
    <div className="bg-black/30 absolute inset-0" />
    <div
      className={`relative ${cardBg} rounded-t-2xl shadow-xl max-h-[70vh] flex flex-col`}
      style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
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
          <span className={`font-semibold ${textPrimary}`}>Recycle Bin</span>
          <span className={`text-xs px-1.5 py-0.5 rounded-full ${darkMode ? 'bg-gray-700 text-gray-400' : 'bg-stone-200 text-stone-500'}`}>
            {recycleBin.filter(t => !t.isExample).length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {recycleBin.filter(t => !t.isExample).length > 0 && (
            <button
              onClick={emptyRecycleBin}
              className="text-xs text-red-500 font-medium px-2 py-1 rounded-lg hover:bg-red-500/5 active:bg-red-500/10 dark:hover:bg-red-500/10 dark:active:bg-red-500/20 transition-colors"
            >
              Empty All
            </button>
          )}
          <button
            onClick={() => setShowMobileRecycleBin(false)}
            className={`p-1.5 rounded-lg ${darkMode ? 'bg-white/10 hover:bg-white/20' : 'bg-stone-100 hover:bg-stone-200'} transition-colors`}
            aria-label="Close recycle bin"
          >
            <X size={16} className={textSecondary} />
          </button>
        </div>
      </div>
      {/* Task list */}
      <div className="overflow-y-auto px-4 pb-2 space-y-2">
        {recycleBin.filter(t => !t.isExample).length === 0 ? (
          <p className={`text-sm ${textSecondary} text-center py-8`}>Recycle bin is empty</p>
        ) : (
          recycleBin.filter(t => !t.isExample).map(task => (
            <div
              key={`mobile-bin-${task.id}`}
              className={`${task.color} rounded-lg p-3 opacity-60`}
            >
              <div className="flex items-start justify-between text-white">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{renderTitle(task.title)}</div>
                  <div className="text-xs opacity-75 mt-1">
                    {task._deletedFrom === 'inbox' ? (
                      <>Inbox • {task.duration}min</>
                    ) : task.startTime ? (
                      <>{formatTime(task.startTime)} • {task.duration}min</>
                    ) : (
                      <>{task.duration}min</>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => { undeleteTask(task.id); if (recycleBin.filter(t => !t.isExample).length <= 1) setShowMobileRecycleBin(false); }}
                    className="bg-white/20 rounded-lg p-1.5 hover:bg-white/25 active:bg-white/30 transition-colors"
                    title="Restore"
                  >
                    <Undo2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  </div>
)}

{/* Mobile Tag Filter Bottom Sheet */}
{showMobileTagFilter && (
  <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={() => setShowMobileTagFilter(false)}>
    <div className="bg-black/30 absolute inset-0" />
    <div
      className={`relative ${cardBg} rounded-t-2xl shadow-xl`}
      style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Handle */}
      <div className="flex justify-center pt-3 pb-1">
        <div className={`w-10 h-1 rounded-full ${darkMode ? 'bg-gray-600' : 'bg-stone-300'}`} />
      </div>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <Filter size={18} className={textSecondary} />
          <span className={`font-semibold ${textPrimary}`}>Filter by Tag</span>
        </div>
        <div className="flex items-center gap-3">
          {allTags.every(tag => selectedTags.includes(tag)) ? (
            <button
              onClick={clearTagFilter}
              className="text-sm text-blue-500 hover:text-blue-600 active:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 dark:active:text-blue-200 font-medium transition-colors"
            >
              Clear
            </button>
          ) : (
            <button
              onClick={selectAllTags}
              className="text-sm text-blue-500 hover:text-blue-600 active:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 dark:active:text-blue-200 font-medium transition-colors"
            >
              Select All
            </button>
          )}
          <button
            onClick={() => setShowMobileTagFilter(false)}
            className={`p-1.5 rounded-lg ${darkMode ? 'bg-white/10 hover:bg-white/20' : 'bg-stone-100 hover:bg-stone-200'} transition-colors`}
            aria-label="Close tag filter"
          >
            <X size={16} className={textSecondary} />
          </button>
        </div>
      </div>
      {/* Tag list */}
      <div className="px-4 pb-4 space-y-1 max-h-[50vh] overflow-y-auto">
        {(() => {
          const visibleDateStrs = new Set(visibleDates.map(d => dateToString(d)));
          const tagCounts = {};
          for (const t of tasks) {
            if (t.imported || !visibleDateStrs.has(t.date)) continue;
            for (const tag of extractTags(t.title)) tagCounts[tag] = (tagCounts[tag] || 0) + 1;
          }
          for (const t of expandedRecurringTasks) {
            if (!visibleDateStrs.has(t.date)) continue;
            for (const tag of extractTags(t.title)) tagCounts[tag] = (tagCounts[tag] || 0) + 1;
          }
          return allTags.map(tag => {
          const tagCount = tagCounts[tag] || 0;
          return (
            <button
              key={tag}
              onClick={() => toggleTag(tag)}
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-colors ${
                tagCount === 0 ? 'opacity-40' : ''
              } ${
                selectedTags.includes(tag)
                  ? darkMode ? 'bg-blue-500/20' : 'bg-blue-50'
                  : darkMode ? 'active:bg-white/5' : 'active:bg-stone-50'
              }`}
            >
              <div className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border transition-colors ${
                selectedTags.includes(tag)
                  ? 'bg-blue-500 border-blue-500'
                  : darkMode ? 'border-gray-600' : 'border-stone-300'
              }`}>
                {selectedTags.includes(tag) && <Check size={14} className="text-white" />}
              </div>
              <Hash size={14} className={textSecondary} />
              <span className={`flex-1 text-left text-sm ${textPrimary}`}>{tag}</span>
              {tagCount > 0 && <span className={`text-xs ${textSecondary} tabular-nums`}>{tagCount}</span>}
            </button>
          );
        });
        })()}
      </div>
    </div>
  </div>
)}

{/* Mobile Daily Summary Bottom Sheet */}
{showMobileDailySummary && (
  <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={() => setShowMobileDailySummary(false)}>
    <div className="bg-black/30 absolute inset-0" />
    <div
      className={`relative ${cardBg} rounded-t-2xl shadow-xl`}
      style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Handle */}
      <div className="flex justify-center pt-3 pb-1">
        <div className={`w-10 h-1 rounded-full ${darkMode ? 'bg-gray-600' : 'bg-stone-300'}`} />
      </div>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <BarChart3 size={18} className={textSecondary} />
          <span className={`font-semibold ${textPrimary}`}>Daily Summary</span>
        </div>
        <button
          onClick={() => setShowMobileDailySummary(false)}
          className={`p-1.5 rounded-lg ${darkMode ? 'bg-white/10 hover:bg-white/20' : 'bg-stone-100 hover:bg-stone-200'} transition-colors`}
          aria-label="Close daily summary"
        >
          <X size={16} className={textSecondary} />
        </button>
      </div>
      {/* Stats */}
      <div className="px-4 pb-4">
        {actualTodayNonImportedTasks.length === 0 ? (
          <p className={`text-sm ${textSecondary} text-center py-4`}>No tasks scheduled for today</p>
        ) : (() => {
          const pct = Math.round(((actualTodayCompletedTasks.length + inboxCompletedTodayCount) / actualTodayNonImportedTasks.length) * 100);
          const ringColor = pct >= 100 ? 'stroke-green-500' : pct >= 50 ? 'stroke-amber-500' : 'stroke-red-500';
          return (
          <>
            {/* Progress ring + headline */}
            <div className="flex items-center gap-4 mb-4">
              <div className="relative w-16 h-16 flex-shrink-0">
                <svg viewBox="0 0 36 36" className="w-16 h-16 -rotate-90">
                  <circle cx="18" cy="18" r="15.5" fill="none" strokeWidth="3" className={darkMode ? 'stroke-gray-700' : 'stroke-gray-200'} />
                  <circle cx="18" cy="18" r="15.5" fill="none" strokeWidth="3" strokeLinecap="round" className={ringColor}
                    strokeDasharray={`${(pct / 100) * 97.4} 97.4`}
                  />
                </svg>
                <span className={`absolute inset-0 flex items-center justify-center text-sm font-bold ${textPrimary}`}>
                  {pct}%
                </span>
              </div>
              <div>
                <div className={`text-lg font-bold ${textPrimary}`}>{actualTodayCompletedTasks.length} of {actualTodayNonImportedTasks.length} done</div>
                {todayIncompleteTasks.length > 0 && (
                  <button
                    onClick={() => { setShowIncompleteTasks('today'); setShowMobileDailySummary(false); }}
                    className="text-sm text-blue-500 active:text-blue-600"
                  >
                    {todayIncompleteTasks.length} incomplete
                  </button>
                )}
                {inboxCompletedTodayCount > 0 && (
                  <div className={`text-sm ${textSecondary}`}>+ {inboxCompletedTodayCount} inbox {inboxCompletedTodayCount === 1 ? 'task' : 'tasks'} done</div>
                )}
                {goalsProjectsEnabled && projectTasksCompletedTodayCount > 0 && (
                  <div className={`text-sm ${textSecondary}`}>+ {projectTasksCompletedTodayCount} project {projectTasksCompletedTodayCount === 1 ? 'task' : 'tasks'} done</div>
                )}
                {consecutiveDayStreak > 1 && (
                  <div className="flex items-center gap-1 text-sm text-orange-500 font-medium mt-0.5">
                    <Flame size={13} />
                    {consecutiveDayStreak} day streak
                  </div>
                )}
              </div>
            </div>
            {/* Goal / Project completion callouts */}
            {goalsProjectsEnabled && (todayCompletedGoals.length > 0 || todayCompletedProjects.length > 0) && (
              <div className="space-y-1.5 mb-3">
                {todayCompletedGoals.map(g => (
                  <div key={g.id} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${darkMode ? 'bg-amber-900/30 text-amber-300' : 'bg-amber-50 text-amber-700'}`}>
                    <Flag size={14} className="flex-shrink-0" />
                    <span className="truncate">Goal complete: {g.title}</span>
                  </div>
                ))}
                {todayCompletedProjects.map(p => (
                  <div key={p.id} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${darkMode ? 'bg-green-900/30 text-green-300' : 'bg-green-50 text-green-700'}`}>
                    <FolderOpen size={14} className="flex-shrink-0" />
                    <span className="truncate">Project complete: {p.title}</span>
                  </div>
                ))}
              </div>
            )}
            {/* Stat rows */}
            <div className={`space-y-3 ${textSecondary}`}>
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2"><Clock size={14} className="text-orange-400" /> Time spent</div>
                <span className={`font-medium ${textPrimary}`}>{Math.floor((actualTodayCompletedMinutes + inboxCompletedTodayMinutes) / 60)}h {(actualTodayCompletedMinutes + inboxCompletedTodayMinutes) % 60}m</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2"><Clock size={14} className="text-blue-400" /> Time planned</div>
                <span className={`font-medium ${textPrimary}`}>{Math.floor(actualTodayPlannedMinutes / 60)}h {actualTodayPlannedMinutes % 60}m</span>
              </div>
              {actualTodayFocusMinutes > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2"><Target size={14} className="text-purple-400" /> Focus time</div>
                  <span className={`font-medium ${textPrimary}`}>{Math.floor(actualTodayFocusMinutes / 60)}h {Math.round(actualTodayFocusMinutes % 60)}m</span>
                </div>
              )}
            </div>
          </>
          );
        })()}

        {/* Habit Streaks — collapsible, default collapsed */}
        {habitsEnabled && activeHabits.length > 0 && (
          <div className={`mt-4 pt-4 border-t ${borderClass}`}>
            <button
              className="flex items-center justify-between w-full mb-0"
              onClick={() => setDailyStatsHabitsCollapsed(c => !c)}
            >
              <div className="flex items-center gap-2">
                <Flame size={18} className="text-orange-500" />
                <span className={`font-semibold ${textPrimary}`}>Habit Streaks</span>
              </div>
              {dailyStatsHabitsCollapsed ? <ChevronDown size={16} className={textSecondary} /> : <ChevronUp size={16} className={textSecondary} />}
            </button>
            {!dailyStatsHabitsCollapsed && (
              <div className="space-y-2 mt-3">
                {(() => {
                  const overflow = activeHabits.length > 5;
                  const visible = overflow ? activeHabits.slice(0, 5) : activeHabits;
                  const remaining = activeHabits.length - 5;
                  return (
                    <>
                      {visible.map(habit => {
                        const s = habitStreaks[habit.id] || { current: 0, best: 0 };
                        const IconComp = HABIT_ICONS[habit.icon] || Target;
                        const colorObj = HABIT_COLORS.find(c => c.name === habit.color) || HABIT_COLORS[0];
                        return (
                          <div key={habit.id} className="flex items-center gap-2">
                            <IconComp size={16} style={{ color: colorObj.ring }} className="flex-shrink-0" />
                            <span className={`text-sm flex-1 min-w-0 truncate ${textPrimary}`}>{habit.name}</span>
                            <div className="flex items-center gap-3 flex-shrink-0">
                              <span className={`text-sm font-semibold ${s.current > 0 ? 'text-orange-500' : textSecondary}`}>
                                {s.current}d
                              </span>
                              <span className={`text-xs ${textSecondary}`}>
                                best {s.best}d
                              </span>
                            </div>
                          </div>
                        );
                      })}
                      {overflow && (
                        <div className={`flex items-center gap-2 text-sm ${textSecondary}`}>
                          <MoreHorizontal size={16} className="flex-shrink-0" />
                          <span>+{remaining} more habits</span>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        )}

        {/* All-Time Summary — collapsible, default collapsed */}
        <div className={`mt-4 pt-4 border-t ${borderClass}`}>
          <button
            className="flex items-center justify-between w-full mb-0"
            onClick={() => setDailyStatsAllTimeCollapsed(c => !c)}
          >
            <div className="flex items-center gap-2">
              <TrendingUp size={18} className={textSecondary} />
              <span className={`font-semibold ${textPrimary}`}>All-Time Summary</span>
            </div>
            {dailyStatsAllTimeCollapsed ? <ChevronDown size={16} className={textSecondary} /> : <ChevronUp size={16} className={textSecondary} />}
          </button>
          {!dailyStatsAllTimeCollapsed && (
            <div className={`space-y-2 text-sm ${textSecondary} mt-3`}>
              {goalsProjectsEnabled && allTimeGoalsCreated > 0 && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2"><Flag size={14} className="text-amber-400" /> Goals</div>
                  <span className={`font-medium ${textPrimary}`}>{allTimeGoalsCompleted}/{allTimeGoalsCreated} completed</span>
                </div>
              )}
              {goalsProjectsEnabled && allTimeProjectsCreated > 0 && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2"><FolderOpen size={14} className="text-blue-400" /> Projects</div>
                  <span className={`font-medium ${textPrimary}`}>{allTimeProjectsCompleted}/{allTimeProjectsCreated} completed</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><CalendarDays size={14} className="text-blue-400" /> Tasks scheduled</div>
                <span className={`font-medium ${textPrimary}`}>{allTimeScheduledCount}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><CheckCircle size={14} className="text-green-400" /> Tasks completed</div>
                <span className={`font-medium ${textPrimary}`}>
                  {allTimeCompletedCount}
                  {allTimeIncompleteTasks.length > 0 && (
                    <button
                      onClick={() => { setShowIncompleteTasks('allTime'); setShowMobileDailySummary(false); }}
                      className="ml-1 text-blue-500 active:text-blue-400"
                    >
                      ({allTimeIncompleteTasks.length} incomplete)
                    </button>
                  )}
                </span>
              </div>
              {allTimeInboxCompletedCount > 0 && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2"><Inbox size={14} className="text-amber-400" /> Inbox done</div>
                  <span className={`font-medium ${textPrimary}`}>{allTimeInboxCompletedCount}</span>
                </div>
              )}
              {goalsProjectsEnabled && allTimeUnscheduledProjectDoneCount > 0 && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2"><FolderOpen size={14} className="text-green-400" /> Project queue done</div>
                  <span className={`font-medium ${textPrimary}`}>{allTimeUnscheduledProjectDoneCount}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><Clock size={14} className="text-orange-400" /> Time spent</div>
                <span className={`font-medium ${textPrimary}`}>{Math.floor((totalCompletedMinutes + allTimeInboxCompletedMinutes + allTimeUnscheduledProjectDoneMinutes) / 60)}h {(totalCompletedMinutes + allTimeInboxCompletedMinutes + allTimeUnscheduledProjectDoneMinutes) % 60}m</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><Clock size={14} className="text-blue-400" /> Time planned</div>
                <span className={`font-medium ${textPrimary}`}>{Math.floor(totalScheduledMinutes / 60)}h {totalScheduledMinutes % 60}m</span>
              </div>
              {allTimeFocusMinutes > 0 && (
                <>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2"><Target size={14} className="text-purple-400" /> Focus time</div>
                    <span className={`font-medium ${textPrimary}`}>{Math.floor(allTimeFocusMinutes / 60)}h {Math.round(allTimeFocusMinutes % 60)}m</span>
                  </div>
                  {goalsProjectsEnabled && allTimeProjectFocusMinutes > 0 && (
                    <div className="flex items-center justify-between pl-5">
                      <div className="flex items-center gap-2"><FolderOpen size={12} className="text-purple-300" /> From projects</div>
                      <span className={`text-xs font-medium ${textSecondary}`}>{Math.floor(allTimeProjectFocusMinutes / 60)}h {Math.round(allTimeProjectFocusMinutes % 60)}m</span>
                    </div>
                  )}
                </>
              )}
              {allTimeScheduledCount > 0 && (
                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center gap-2"><Trophy size={14} className="text-amber-400" /> <span className={`font-semibold ${textPrimary}`}>Completion rate</span></div>
                  <span className={`font-semibold ${textPrimary}`}>{Math.round((allTimeCompletedCount / allTimeScheduledCount) * 100)}%</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  </div>
)}
    </>
  );
};

export default MobileBottomSheets;
