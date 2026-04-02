import React, { useState, useEffect } from 'react';
import { AlertCircle, BarChart3, CalendarDays, CheckSquare, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock, Flag, Flame, FolderOpen, Loader, RefreshCw, Sparkles, Target, TrendingUp, Trophy, X, Zap } from 'lucide-react';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { dateToString, stripWikilinks } from '../utils/taskUtils.js';
import { getOccurrencesInRange } from '../utils/recurrenceEngine.js';
import { calculateProjectProgress, isProjectStalled } from '../utils/projectProgress.js';
import { calculateGoalProgress } from '../utils/goalProgress.js';

const WeeklyReviewModal = () => {
  const {
    showWeeklyReview, setShowWeeklyReview,
    mobileReviewPage, setMobileReviewPage,
    weeklyAISummary, setWeeklyAISummary,
    weeklyAILoading,
    weeklyAIError, setWeeklyAIError,
    generateWeeklyAISummary,
    reviewScrollRef,
    tasks, recurringTasks, unscheduledTasks,
    goals, projects, goalsProjectsEnabled,
    habitsEnabled, habits, habitLogs,
    gtdFrames,
    selectedDate,
    isMobile, isTablet,
    darkMode,
    cardBg, borderClass, textPrimary, textSecondary, hoverBg,
    use24HourClock,
    formatTime, timeToMinutes,
    aiConfig,
  } = useDayPlannerCtx();

  // Local collapse state for past-week HABITS and FRAME UTILIZATION sections
  const [habitsCollapsed, setHabitsCollapsed] = useState(true);
  const [framesCollapsed, setFramesCollapsed] = useState(true);

  // Reset to page 0 whenever the modal opens so chevrons are never stale
  useEffect(() => { setMobileReviewPage(0); }, []);

  if (!showWeeklyReview) return null;

        // Compute rolling 7-day boundaries
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Past 7 days: 6 days ago through today
        const pastStart = new Date(today);
        pastStart.setDate(pastStart.getDate() - 6);

        // Next 7 days: tomorrow through 7 days from now
        const nextStart = new Date(today);
        nextStart.setDate(nextStart.getDate() + 1);
        const nextEnd = new Date(today);
        nextEnd.setDate(nextEnd.getDate() + 7);

        const pastWeekDates = [];
        for (let i = 0; i < 7; i++) {
          const d = new Date(pastStart);
          d.setDate(d.getDate() + i);
          pastWeekDates.push(dateToString(d));
        }
        const nextWeekDates = [];
        for (let i = 0; i < 7; i++) {
          const d = new Date(nextStart);
          d.setDate(d.getDate() + i);
          nextWeekDates.push(dateToString(d));
        }

        const pastStartStr = pastWeekDates[0];
        const pastEndStr = pastWeekDates[6];
        const nextStartStr = nextWeekDates[0];
        const nextEndStr = nextWeekDates[6];

        // Helper to identify today's tasks that haven't started yet
        const todayStr = dateToString(today);
        const actualNow = new Date();
        const actualNowMin = actualNow.getHours() * 60 + actualNow.getMinutes();
        const isFutureToday = (date, startTime) => {
          if (date !== todayStr) return false;
          if (!startTime) return false;
          const [h, m] = startTime.split(':').map(Number);
          return h * 60 + m > actualNowMin;
        };

        // Past week stats - regular tasks (exclude future today tasks)
        const pastRegular = tasks.filter(t => !t.imported && pastWeekDates.includes(t.date) && !isFutureToday(t.date, t.startTime));
        const pastRegularCompleted = pastRegular.filter(t => t.completed);

        // Past week stats - recurring tasks
        let pastRecurringScheduled = 0;
        let pastRecurringCompleted = 0;
        const pastRecurringIncomplete = [];
        recurringTasks.forEach(t => {
          const occurrences = getOccurrencesInRange(t, pastStartStr, pastEndStr)
            .filter(ds => !isFutureToday(ds, t.exceptions?.[ds]?.startTime || t.startTime));
          pastRecurringScheduled += occurrences.length;
          occurrences.forEach(ds => {
            const completed = (t.completedDates || []).includes(ds);
            if (completed) {
              pastRecurringCompleted++;
            } else {
              pastRecurringIncomplete.push({
                id: `recurring-${t.id}-${ds}`,
                title: t.title,
                date: ds,
                startTime: t.exceptions?.[ds]?.startTime || t.startTime,
                color: t.color,
                duration: t.duration || 0,
                isRecurring: true,
              });
            }
          });
        });

        const pastScheduled = pastRegular.length + pastRecurringScheduled;
        const pastCompleted = pastRegularCompleted.length + pastRecurringCompleted;
        const pastCompletionRate = pastScheduled > 0 ? Math.round((pastCompleted / pastScheduled) * 100) : 0;

        // Time stats
        const pastTimeSpent = pastRegularCompleted.reduce((sum, t) => sum + (t.duration || 0), 0)
          + recurringTasks.reduce((sum, t) => {
            const occs = getOccurrencesInRange(t, pastStartStr, pastEndStr)
              .filter(ds => !isFutureToday(ds, t.exceptions?.[ds]?.startTime || t.startTime));
            return sum + occs.filter(ds => (t.completedDates || []).includes(ds)).length * (t.duration || 0);
          }, 0);
        const pastTimePlanned = pastRegular.reduce((sum, t) => sum + (t.duration || 0), 0)
          + recurringTasks.reduce((sum, t) => {
            return sum + getOccurrencesInRange(t, pastStartStr, pastEndStr)
              .filter(ds => !isFutureToday(ds, t.exceptions?.[ds]?.startTime || t.startTime)).length * (t.duration || 0);
          }, 0);
        const pastFocusMinutes = pastRegularCompleted.reduce((sum, t) => sum + (t.focusMinutes || 0), 0)
          + unscheduledTasks.filter(t => t.completed && t.completedAt && t.completedAt >= pastStartStr && t.completedAt <= pastEndStr + 'T99').reduce((sum, t) => sum + (t.focusMinutes || 0), 0);

        // Best day
        const dayCompletions = {};
        pastRegularCompleted.forEach(t => {
          dayCompletions[t.date] = (dayCompletions[t.date] || 0) + 1;
        });
        recurringTasks.forEach(t => {
          const occs = getOccurrencesInRange(t, pastStartStr, pastEndStr)
            .filter(ds => !isFutureToday(ds, t.exceptions?.[ds]?.startTime || t.startTime));
          occs.forEach(ds => {
            if ((t.completedDates || []).includes(ds)) {
              dayCompletions[ds] = (dayCompletions[ds] || 0) + 1;
            }
          });
        });
        let bestDay = null;
        let bestDayCount = 0;
        Object.entries(dayCompletions).forEach(([ds, count]) => {
          if (count > bestDayCount) {
            bestDay = ds;
            bestDayCount = count;
          }
        });
        const bestDayName = bestDay ? new Date(bestDay + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' }) : null;

        // Incomplete list (future-today tasks already excluded from pastRegular/pastRecurringIncomplete)
        const pastIncomplete = [
          ...pastRegular.filter(t => !t.completed).map(t => ({ ...t, isRecurring: false })),
          ...pastRecurringIncomplete,
        ].sort((a, b) => a.date.localeCompare(b.date));

        // Next week stats - regular tasks
        const nextRegular = tasks.filter(t => !t.imported && nextWeekDates.includes(t.date));
        const nextImported = tasks.filter(t => t.imported && nextWeekDates.includes(t.date));

        let nextRecurringCount = 0;
        let nextRecurringMinutes = 0;
        recurringTasks.forEach(t => {
          const occs = getOccurrencesInRange(t, nextStartStr, nextEndStr);
          nextRecurringCount += occs.length;
          nextRecurringMinutes += occs.length * (t.duration || 0);
        });

        const nextScheduled = nextRegular.length + nextRecurringCount;
        const nextPlannedMinutes = nextRegular.reduce((sum, t) => sum + (t.duration || 0), 0) + nextRecurringMinutes;

        // Frame availability for next week
        let nextFrameTotalMinutes = 0;
        gtdFrames.filter(f => f.enabled && !f.singleDate).forEach(frame => {
          nextWeekDates.forEach(ds => {
            const dayOfWeek = new Date(ds + 'T12:00:00').getDay();
            if (!frame.days.includes(dayOfWeek)) return;
            const exception = frame.exceptions?.[ds];
            if (exception?.deleted) return;
            const instanceStart = exception?.start || frame.start;
            const instanceEnd = exception?.end || frame.end;
            const cap = timeToMinutes(instanceEnd) - timeToMinutes(instanceStart);
            if (cap > 0) nextFrameTotalMinutes += cap;
          });
        });
        const nextFrameAvailableMinutes = Math.max(0, nextFrameTotalMinutes - nextPlannedMinutes);

        // Day load map
        const dayLoad = {};
        nextWeekDates.forEach(ds => { dayLoad[ds] = { count: 0, totalMinutes: 0 }; });
        nextRegular.forEach(t => {
          if (dayLoad[t.date]) {
            dayLoad[t.date].count++;
            dayLoad[t.date].totalMinutes += (t.duration || 0);
          }
        });
        nextImported.forEach(t => {
          if (dayLoad[t.date]) {
            dayLoad[t.date].count++;
            dayLoad[t.date].totalMinutes += (t.duration || 0);
          }
        });
        recurringTasks.forEach(t => {
          const occs = getOccurrencesInRange(t, nextStartStr, nextEndStr);
          occs.forEach(ds => {
            if (dayLoad[ds]) {
              dayLoad[ds].count++;
              dayLoad[ds].totalMinutes += (t.duration || 0);
            }
          });
        });

        // Busiest day
        let busiestDay = null;
        let busiestMinutes = 0;
        Object.entries(dayLoad).forEach(([ds, load]) => {
          if (load.totalMinutes > busiestMinutes) {
            busiestDay = ds;
            busiestMinutes = load.totalMinutes;
          }
        });
        const busiestDayName = busiestDay ? new Date(busiestDay + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' }) : null;

        // Open days (< 60 min of commitments)
        const openDays = nextWeekDates.filter(ds => dayLoad[ds].totalMinutes < 60);
        const openDayNames = openDays.map(ds => new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' }));

        // Format date range
        const formatRange = (start, end) => {
          const s = new Date(start + 'T12:00:00');
          const e = new Date(end + 'T12:00:00');
          const sMonth = s.toLocaleDateString('en-US', { month: 'short' });
          const eMonth = e.toLocaleDateString('en-US', { month: 'short' });
          if (sMonth === eMonth) {
            return `${sMonth} ${s.getDate()} \u2014 ${e.getDate()}, ${s.getFullYear()}`;
          }
          return `${sMonth} ${s.getDate()} \u2014 ${eMonth} ${e.getDate()}, ${e.getFullYear()}`;
        };

        const formatMinutes = (min) => {
          const h = Math.floor(min / 60);
          const m = min % 60;
          if (h === 0) return `${m}m`;
          if (m === 0) return `${h}h`;
          return `${h}h ${m}m`;
        };

        // Tag breakdown for AI summary
        const tagStats = {};
        pastRegular.forEach(t => {
          const taskTags = (t.title.match(/#(\w+)/g) || []).map(tag => tag.slice(1));
          taskTags.forEach(tag => {
            if (!tagStats[tag]) tagStats[tag] = { total: 0, completed: 0 };
            tagStats[tag].total++;
            if (t.completed) tagStats[tag].completed++;
          });
        });
        const tagBreakdown = Object.entries(tagStats).map(([tag, s]) => ({ tag, ...s })).sort((a, b) => b.total - a.total).slice(0, 8);

        // Habit stats for past week
        const habitColorMap = {
          blue: '#3b82f6', green: '#22c55e', red: '#ef4444', amber: '#f59e0b',
          purple: '#a855f7', pink: '#ec4899', cyan: '#06b6d4', orange: '#f97316',
        };
        const habitStats = (habitsEnabled && habits.length > 0)
          ? habits.filter(h => h.enabled !== false).map(h => {
              const days = pastWeekDates.map(ds => {
                const count = (habitLogs?.[ds]?.[h.id]) ?? 0;
                return h.type === 'limit' ? count <= h.target : count >= h.target;
              });
              return {
                id: h.id,
                name: h.name,
                type: h.type,
                target: h.target,
                hexColor: habitColorMap[h.color] || '#3b82f6',
                days,
                daysHit: days.filter(Boolean).length,
              };
            })
          : [];

        // Frame utilization for past week
        const frameStats = gtdFrames.filter(f => f.enabled && !f.singleDate).map(frame => {
          let totalCapacityMin = 0;
          let scheduledMin = 0;
          pastWeekDates.forEach(ds => {
            const dayOfWeek = new Date(ds + 'T12:00:00').getDay();
            if (!frame.days.includes(dayOfWeek)) return;
            const exception = frame.exceptions?.[ds];
            if (exception?.deleted) return;
            const instanceStart = exception?.start || frame.start;
            const instanceEnd = exception?.end || frame.end;
            const capacityMin = timeToMinutes(instanceEnd) - timeToMinutes(instanceStart);
            if (capacityMin <= 0) return;
            totalCapacityMin += capacityMin;
            tasks
              .filter(t => !t.imported && t.date === ds && t.startTime &&
                timeToMinutes(t.startTime) >= timeToMinutes(instanceStart) &&
                timeToMinutes(t.startTime) < timeToMinutes(instanceEnd))
              .forEach(t => { scheduledMin += (t.duration || 0); });
            recurringTasks.forEach(rt => {
              if (getOccurrencesInRange(rt, ds, ds).length === 0) return;
              const rtStart = rt.exceptions?.[ds]?.startTime || rt.startTime;
              if (!rtStart) return;
              if (timeToMinutes(rtStart) >= timeToMinutes(instanceStart) &&
                  timeToMinutes(rtStart) < timeToMinutes(instanceEnd)) {
                scheduledMin += (rt.duration || 0);
              }
            });
          });
          if (totalCapacityMin === 0) return null;
          return {
            frameId: frame.id,
            label: frame.label,
            totalCapacityMin,
            scheduledMin,
            utilizationPct: Math.round((scheduledMin / totalCapacityMin) * 100),
          };
        }).filter(Boolean).sort((a, b) => b.totalCapacityMin - a.totalCapacityMin);

        // Goals & Projects completed this past week
        const pastCompletedGoals = goalsProjectsEnabled
          ? goals.filter(g => g.status === 'completed' && g.updatedAt && g.updatedAt >= pastStartStr && g.updatedAt <= pastEndStr + 'T99')
          : [];
        const pastCompletedProjects = goalsProjectsEnabled
          ? projects.filter(p => p.status === 'completed' && p.updatedAt && p.updatedAt >= pastStartStr && p.updatedAt <= pastEndStr + 'T99')
          : [];
        const pastUnscheduledProjectDone = goalsProjectsEnabled
          ? unscheduledTasks.filter(t => t.projectId && t.completed && t.completedAt && t.completedAt >= pastStartStr && t.completedAt <= pastEndStr + 'T99')
          : [];

        // Consecutive day streak (reuse same logic as useStats)
        const weeklyStreak = (() => {
          let streak = 0;
          const d0 = new Date(today);
          for (let i = 0; i < 365; i++) {
            const d = new Date(d0);
            d.setDate(d.getDate() - i);
            const ds = dateToString(d);
            const hadCompletion =
              tasks.some(t => !t.imported && t.completed && t.date === ds) ||
              recurringTasks.some(t => (t.completedDates || []).includes(ds)) ||
              unscheduledTasks.some(t => t.completed && t.completedAt?.startsWith(ds));
            if (hadCompletion) { streak++; } else { break; }
          }
          return streak;
        })();

        // Goals & Projects stats for AI weekly summary
        const allTasksCombined = [...tasks, ...unscheduledTasks];

        const goalStats = (goalsProjectsEnabled && goals.length > 0)
          ? goals
              .filter(g => g.status !== 'archived')
              .map(g => {
                const progress = calculateGoalProgress(g.id, projects, allTasksCombined);
                let daysToTarget = null;
                if (g.targetDate) {
                  const target = new Date(g.targetDate + 'T12:00:00');
                  const todayMidnight = new Date();
                  todayMidnight.setHours(0, 0, 0, 0);
                  daysToTarget = Math.ceil((target - todayMidnight) / (1000 * 60 * 60 * 24));
                }
                return { id: g.id, title: g.title, progressPct: Math.round(progress * 100), daysToTarget };
              })
          : [];

        const projectStats = (goalsProjectsEnabled && projects.length > 0)
          ? projects
              .filter(p => p.status !== 'archived')
              .map(p => {
                const projectTasks = allTasksCombined.filter(t => t.projectId === p.id && !t.archived);
                const weekTasks = projectTasks.filter(t => pastWeekDates.includes(t.date));
                const weekCompleted = weekTasks.filter(t => t.completed).length;
                const weekTotal = weekTasks.length;
                const overallProgress = calculateProjectProgress(p.id, allTasksCombined);
                const stalled = isProjectStalled(p.id, allTasksCombined, p);
                return {
                  id: p.id,
                  title: p.title,
                  weekCompleted,
                  weekTotal,
                  overallProgressPct: Math.round(overallProgress * 100),
                  stalled,
                };
              })
              .filter(p => p.weekTotal > 0 || p.stalled)
          : [];

        // Stats for AI weekly summary (used by click-to-reveal prompt)
        const nextWeekTopTasks = nextRegular
          .filter(t => !t.isExample)
          .sort((a, b) => (b.priority || 0) - (a.priority || 0))
          .slice(0, 5)
          .map(t => ({ title: t.title, date: t.date, priority: t.priority || 0 }));
        const nextWeekCalendarEvents = nextImported
          .filter(t => !t.isTaskCalendar)
          .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.startTime || '').localeCompare(b.startTime || ''))
          .slice(0, 5)
          .map(t => ({ title: t.title, date: t.date, time: t.startTime, isAllDay: t.isAllDay || false }));

        // Goals due in next 7 days (only goals with targetDate in range)
        const nextWeekDueGoals = goalsProjectsEnabled
          ? goals.filter(g => g.status === 'active' && g.targetDate && g.targetDate >= nextStartStr && g.targetDate <= nextEndStr)
              .map(g => {
                const progress = calculateGoalProgress(g.id, projects, allTasksCombined);
                const target = new Date(g.targetDate + 'T12:00:00');
                const todayMidnight = new Date(todayStr + 'T00:00:00');
                const daysLeft = Math.ceil((target - todayMidnight) / (1000 * 60 * 60 * 24));
                const childProjects = projects.filter(p => p.goalId === g.id && p.status !== 'archived');
                const totalTasks = allTasksCombined.filter(t => childProjects.some(p => p.id === t.projectId) && !t.archived).length;
                const completedTasks = allTasksCombined.filter(t => childProjects.some(p => p.id === t.projectId) && !t.archived && t.completed).length;
                return { id: g.id, title: g.title, progressPct: Math.round(progress * 100), daysLeft, totalTasks, completedTasks };
              })
              .sort((a, b) => a.daysLeft - b.daysLeft)
          : [];

        // Active projects — with momentum indicator
        // Momentum: green = completion in last 7 days, amber = no completion 7-14 days, red = no activity 14+ days
        const sevenDaysAgoStr = dateToString(new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000));
        const fourteenDaysAgoStr = dateToString(new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000));
        const nextWeekProjects = goalsProjectsEnabled
          ? projects.filter(p => p.status === 'active' && !p.goalId).map(p => {
              const pTasks = allTasksCombined.filter(t => t.projectId === p.id && !t.archived);
              const totalTasks = pTasks.length;
              const completedTasks = pTasks.filter(t => t.completed).length;
              const progressPct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
              const lastCompletion = pTasks
                .filter(t => t.completed && t.completedAt)
                .map(t => t.completedAt.slice(0, 10))
                .sort()
                .pop() || null;
              let momentum; // 'green' | 'amber' | 'red'
              if (!lastCompletion) {
                momentum = 'red';
              } else if (lastCompletion >= sevenDaysAgoStr) {
                momentum = 'green';
              } else if (lastCompletion >= fourteenDaysAgoStr) {
                momentum = 'amber';
              } else {
                momentum = 'red';
              }
              return { id: p.id, title: p.title, totalTasks, completedTasks, progressPct, momentum };
            }).filter(p => p.totalTasks > 0)
          : [];

        const weeklyAIStats = {
          dateRange: `${pastStartStr} to ${pastEndStr}`,
          tasksCompleted: pastCompleted,
          tasksScheduled: pastScheduled,
          completionRate: pastCompletionRate,
          timeSpent: pastTimeSpent,
          timePlanned: pastTimePlanned,
          focusMinutes: pastFocusMinutes,
          recurringCompleted: pastRecurringCompleted,
          recurringScheduled: pastRecurringScheduled,
          bestDay: bestDayName,
          bestDayCount,
          incompleteCount: pastIncomplete.length,
          tagBreakdown,
          inboxCount: unscheduledTasks.filter(t => !t.completed && !t.isExample && (!goalsProjectsEnabled || !t.projectId)).length,
          projectTaskCount: goalsProjectsEnabled ? unscheduledTasks.filter(t => !t.completed && !t.isExample && t.projectId).length : 0,
          nextWeekTaskCount: nextScheduled,
          nextWeekTopTasks,
          nextWeekCalendarEvents,
          habitStats: habitStats.map(h => ({ name: h.name, type: h.type, target: h.target, daysHit: h.daysHit })),
          frameStats: frameStats.map(f => ({ label: f.label, totalCapacityMin: f.totalCapacityMin, scheduledMin: f.scheduledMin, utilizationPct: f.utilizationPct })),
          goalStats,
          projectStats,
        };

        const StatCard = ({ value, label, icon }) => (
          <div className={`${darkMode ? 'bg-gray-700/50' : 'bg-stone-50'} rounded-lg p-3`}>
            <div className={`text-xl font-bold ${textPrimary} flex items-center gap-1.5`}>
              {icon}
              {value}
            </div>
            <div className={`text-xs ${textSecondary} mt-0.5`}>{label}</div>
          </div>
        );

        return (
          <div className="fixed inset-0 z-50 flex flex-col justify-end items-start" style={!isMobile ? { width: '320px' } : undefined} onClick={() => { setShowWeeklyReview(false); setMobileReviewPage(0); setWeeklyAISummary(null); setWeeklyAIError(''); }}>
            <div className="bg-black/30 absolute inset-0" />
            <div
              className={`relative ${cardBg} rounded-t-2xl shadow-xl max-h-[85vh] flex flex-col w-full`}
              style={{ paddingBottom: isMobile ? 'calc(1rem + env(safe-area-inset-bottom, 0px))' : '1rem' }}
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
                  <span className={`font-semibold ${textPrimary}`}>Weekly Review</span>
                </div>
                <div className="flex items-center gap-1">
                  {/* Desktop chevron nav */}
                  {!isMobile && !isTablet && (
                    <>
                      <button
                        onClick={() => {
                          reviewScrollRef.current?.scrollTo({ left: 0, behavior: 'smooth' });
                        }}
                        disabled={mobileReviewPage === 0}
                        className={`p-1 rounded-lg transition-colors ${mobileReviewPage === 0 ? 'opacity-30 cursor-default' : darkMode ? 'hover:bg-white/10' : 'hover:bg-stone-100'}`}
                        aria-label="Previous page"
                      >
                        <ChevronLeft size={16} className={textSecondary} />
                      </button>
                      <button
                        onClick={() => {
                          reviewScrollRef.current?.scrollTo({ left: reviewScrollRef.current.clientWidth, behavior: 'smooth' });
                        }}
                        disabled={mobileReviewPage === 1}
                        className={`p-1 rounded-lg transition-colors ${mobileReviewPage === 1 ? 'opacity-30 cursor-default' : darkMode ? 'hover:bg-white/10' : 'hover:bg-stone-100'}`}
                        aria-label="Next page"
                      >
                        <ChevronRight size={16} className={textSecondary} />
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => { setShowWeeklyReview(false); setMobileReviewPage(0); setWeeklyAISummary(null); setWeeklyAIError(''); }}
                    className={`p-1.5 rounded-lg ${darkMode ? 'bg-white/10 hover:bg-white/20' : 'bg-stone-100 hover:bg-stone-200'} transition-colors`}
                    aria-label="Close weekly review"
                  >
                    <X size={16} className={textSecondary} />
                  </button>
                </div>
              </div>

              {/* Swipeable cards */}
              <div
                ref={reviewScrollRef}
                className="flex-1 min-h-0 flex overflow-x-auto overflow-y-hidden review-carousel"
                style={{ scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                onScroll={(e) => {
                  const page = Math.round(e.target.scrollLeft / e.target.clientWidth);
                  if (page !== mobileReviewPage) setMobileReviewPage(page);
                }}
              >
                {/* Card 1: Past 7 Days */}
                <div className="flex-shrink-0 w-full h-full overflow-y-auto px-4 pb-4" style={{ scrollSnapAlign: 'start' }}>
                  <h3 className={`text-xs font-semibold uppercase ${textSecondary} tracking-wider mb-1`}>Past 7 Days</h3>
                  <p className={`text-xs ${textSecondary} mb-4`}>{formatRange(pastStartStr, pastEndStr)}</p>

                  {pastScheduled === 0 ? (
                    <p className={`text-sm ${textSecondary} italic`}>No tasks were scheduled in the past 7 days</p>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-3 mb-3">
                        <StatCard value={`${pastCompleted}/${pastScheduled}`} label="Tasks done" icon={<CheckSquare size={16} className="text-green-400" />} />
                        <StatCard value={`${pastCompletionRate}%`} label="Completion" icon={<Target size={16} className="text-blue-400" />} />
                      </div>
                      <div className="grid grid-cols-2 gap-3 mb-3">
                        <StatCard value={formatMinutes(pastTimeSpent)} label="Time spent" icon={<Clock size={16} className="text-orange-400" />} />
                        <StatCard value={formatMinutes(pastFocusMinutes)} label="Focus time" icon={<Target size={16} className="text-purple-400" />} />
                      </div>
                      <div className="grid grid-cols-2 gap-3 mb-3">
                        <StatCard value={`${pastRecurringCompleted}/${pastRecurringScheduled}`} label="Recurring" icon={<RefreshCw size={14} className="text-blue-400" />} />
                        {bestDayName && (
                          <StatCard value={bestDayName} label={`Best day (${bestDayCount})`} icon={<Trophy size={16} className="text-yellow-400" />} />
                        )}
                      </div>
                      {goalsProjectsEnabled && (pastCompletedGoals.length > 0 || pastCompletedProjects.length > 0 || pastUnscheduledProjectDone.length > 0) && (
                        <div className="grid grid-cols-2 gap-3 mb-3">
                          {pastCompletedGoals.length > 0 && (
                            <StatCard value={pastCompletedGoals.length} label={pastCompletedGoals.length === 1 ? 'Goal completed' : 'Goals completed'} icon={<Flag size={16} className="text-amber-400" />} />
                          )}
                          {pastCompletedProjects.length > 0 && (
                            <StatCard value={pastCompletedProjects.length} label={pastCompletedProjects.length === 1 ? 'Project completed' : 'Projects completed'} icon={<FolderOpen size={16} className="text-blue-400" />} />
                          )}
                          {pastUnscheduledProjectDone.length > 0 && (
                            <StatCard value={pastUnscheduledProjectDone.length} label="Project queue done" icon={<TrendingUp size={16} className="text-green-400" />} />
                          )}
                        </div>
                      )}
                      {weeklyStreak >= 2 && (
                        <div className={`flex items-center gap-2 rounded-lg px-3 py-2 mb-3 text-sm font-medium ${darkMode ? 'bg-orange-900/30 text-orange-300' : 'bg-orange-50 text-orange-700'}`}>
                          <Flame size={15} className="flex-shrink-0" />
                          {weeklyStreak} day streak — keep it going!
                        </div>
                      )}
                    </>
                  )}

                  {/* Habits — collapsible, default collapsed */}
                  {habitsEnabled && habitStats.length > 0 && (
                    <div className="mb-3">
                      <button
                        className={`flex items-center justify-between w-full py-1.5 text-xs font-semibold uppercase ${textSecondary} tracking-wider`}
                        onClick={() => setHabitsCollapsed(c => !c)}
                      >
                        <span>Habits</span>
                        {habitsCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                      </button>
                      {!habitsCollapsed && (
                        <div className="space-y-2 mt-1">
                          {habitStats.map(h => (
                            <div key={h.id} className="flex items-center gap-2">
                              <span className={`text-xs ${textPrimary} w-20 truncate flex-shrink-0`}>{h.name}</span>
                              <div className="flex gap-1 flex-1">
                                {h.days.map((hit, i) => (
                                  <div
                                    key={i}
                                    className="w-4 h-4 rounded-full flex-shrink-0"
                                    style={{ backgroundColor: hit ? h.hexColor : (darkMode ? '#374151' : '#e7e5e4') }}
                                    title={new Date(pastWeekDates[i] + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                                  />
                                ))}
                              </div>
                              <span className={`text-xs ${textSecondary} flex-shrink-0`}>{h.daysHit}/7</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Frame Utilization — collapsible, default collapsed */}
                  {frameStats.length > 0 && (
                    <div className="mb-3">
                      <button
                        className={`flex items-center justify-between w-full py-1.5 text-xs font-semibold uppercase ${textSecondary} tracking-wider`}
                        onClick={() => setFramesCollapsed(c => !c)}
                      >
                        <span>Frame Utilization</span>
                        {framesCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                      </button>
                      {!framesCollapsed && (
                        <div className="space-y-2 mt-1">
                          {frameStats.map(f => {
                            const pct = Math.min(f.utilizationPct, 100);
                            const barColor = f.utilizationPct >= 70 ? '#22c55e' : f.utilizationPct >= 30 ? '#3b82f6' : (darkMode ? '#4b5563' : '#d6d3d1');
                            return (
                              <div key={f.frameId}>
                                <div className="flex justify-between items-center mb-1">
                                  <span className={`text-xs ${textPrimary} truncate flex-1 mr-2`}>{f.label}</span>
                                  <span className={`text-xs ${textSecondary} flex-shrink-0`}>{f.utilizationPct}% &middot; {formatMinutes(f.scheduledMin)}</span>
                                </div>
                                <div className={`h-1.5 rounded-full w-full ${darkMode ? 'bg-gray-700' : 'bg-stone-200'}`}>
                                  <div
                                    className="h-full rounded-full transition-all"
                                    style={{ width: `${pct}%`, backgroundColor: barColor }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Incomplete list */}
                  {pastIncomplete.length > 0 && (
                    <div className={`rounded-lg border ${darkMode ? 'border-red-800 bg-red-900/20' : 'border-red-200 bg-red-50'} p-3`}>
                      <div className={`flex items-center gap-2 ${darkMode ? 'text-red-300' : 'text-red-700'} font-bold text-sm mb-2`}>
                        <AlertCircle size={16} />
                        {pastIncomplete.length} incomplete
                      </div>
                      <div className="max-h-40 overflow-y-auto -mx-1">
                        {pastIncomplete.map((task) => (
                          <button
                            key={task.id}
                            className={`w-full flex items-center gap-3 px-2 py-1.5 rounded text-left ${isMobile || isTablet ? (darkMode ? 'active:bg-red-900/40' : 'active:bg-red-100/60') : (darkMode ? 'hover:bg-red-900/40' : 'hover:bg-red-100/60')} transition-colors`}
                            onClick={() => {
                              const d = new Date(task.date + 'T12:00:00');
                              setSelectedDate(d);
                              setShowWeeklyReview(false);
                              setMobileReviewPage(0);
                            }}
                          >
                            <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${task.color || 'bg-blue-500'}`} />
                            <span className={`text-xs ${darkMode ? 'text-red-200' : 'text-red-900'} truncate flex-1`}>{stripWikilinks(task.title)}</span>
                            <span className={`text-xs ${darkMode ? 'text-red-400' : 'text-red-500'} flex-shrink-0`}>
                              {new Date(task.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                              {!isMobile && task.startTime ? ` \u00b7 ${formatTime(task.startTime)}` : ''}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* AI Weekly Insights */}
                  {aiConfig.enabled && aiConfig.features.weeklySummary && (
                    (weeklyAISummary || weeklyAILoading || weeklyAIError) ? (
                    <div className={`mt-3 rounded-lg border p-3 ${darkMode ? 'border-purple-800/50 bg-purple-900/20' : 'border-purple-200 bg-purple-50'}`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Sparkles size={14} className="text-purple-500" />
                          <span className={`text-xs font-semibold uppercase tracking-wider ${darkMode ? 'text-purple-300' : 'text-purple-700'}`}>AI Insights</span>
                        </div>
                        {weeklyAILoading && <Loader size={12} className={`animate-spin ${textSecondary}`} />}
                      </div>
                      {weeklyAILoading && !weeklyAISummary && (
                        <p className={`text-xs ${textSecondary}`}>Analyzing your week...</p>
                      )}
                      {weeklyAIError && (
                        <p className={`text-xs ${darkMode ? 'text-red-400' : 'text-red-600'}`}>{weeklyAIError}</p>
                      )}
                      {weeklyAISummary && (
                        <p className={`text-sm leading-relaxed ${textPrimary}`}>{weeklyAISummary}</p>
                      )}
                    </div>
                    ) : (
                    <div
                      className={`mt-3 flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${darkMode ? 'border-purple-800/50 bg-purple-900/20 hover:bg-purple-900/30' : 'border-purple-200 bg-purple-50 hover:bg-purple-100'}`}
                      onClick={() => generateWeeklyAISummary(weeklyAIStats)}
                    >
                      <Sparkles size={14} className="text-purple-500 flex-shrink-0" />
                      <span className={`text-sm ${darkMode ? 'text-purple-300' : 'text-purple-700'}`}>Click here to see AI insights</span>
                    </div>
                    )
                  )}
                </div>

                {/* Card 2: Next 7 Days */}
                <div className="flex-shrink-0 w-full h-full overflow-y-auto px-4 pb-4" style={{ scrollSnapAlign: 'start' }}>
                  <h3 className={`text-xs font-semibold uppercase ${textSecondary} tracking-wider mb-1`}>Next 7 Days</h3>
                  <p className={`text-xs ${textSecondary} mb-4`}>{formatRange(nextStartStr, nextEndStr)}</p>

                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <StatCard value={nextScheduled} label="Scheduled" icon={<CalendarDays size={16} className="text-blue-400" />} />
                    <StatCard value={formatMinutes(nextPlannedMinutes)} label="Planned" icon={<Clock size={16} className="text-orange-400" />} />
                  </div>
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    {busiestDayName && busiestMinutes > 0 && (
                      <StatCard value={busiestDayName} label="Busiest" icon={<Zap size={16} className="text-amber-400" />} />
                    )}
                    {nextRecurringCount > 0 && (
                      <StatCard value={nextRecurringCount} label="Recurring" icon={<RefreshCw size={14} className="text-blue-400" />} />
                    )}
                    {nextFrameTotalMinutes > 0 && (
                      <StatCard value={formatMinutes(nextFrameAvailableMinutes)} label="Frame availability" icon={<CalendarDays size={16} className="text-green-400" />} />
                    )}
                  </div>

                  {/* Goals due this week */}
                  {goalsProjectsEnabled && nextWeekDueGoals.length > 0 && (
                    <div className="mb-4">
                      <div className={`text-xs font-semibold uppercase ${textSecondary} tracking-wider mb-2`}>Goals Due This Week</div>
                      <div className="space-y-2">
                        {nextWeekDueGoals.map(g => (
                          <div key={g.id} className={`rounded-lg border p-3 ${darkMode ? 'border-gray-600 bg-gray-700/40' : 'border-stone-200 bg-stone-50'}`}>
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <Flag size={13} className="text-amber-400 flex-shrink-0" />
                                <span className={`text-sm font-medium ${textPrimary} truncate`}>{g.title}</span>
                              </div>
                              <span className={`text-xs flex-shrink-0 font-medium px-1.5 py-0.5 rounded ${g.progressPct >= 80 ? (darkMode ? 'bg-green-900/40 text-green-300' : 'bg-green-100 text-green-700') : (darkMode ? 'bg-amber-900/40 text-amber-300' : 'bg-amber-100 text-amber-700')}`}>
                                {g.daysLeft === 0 ? 'Due today' : g.daysLeft === 1 ? 'Due tomorrow' : `${g.daysLeft}d left`}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className={`flex-1 h-1.5 rounded-full ${darkMode ? 'bg-gray-600' : 'bg-stone-200'}`}>
                                <div
                                  className="h-full rounded-full"
                                  style={{ width: `${g.progressPct}%`, backgroundColor: g.progressPct >= 80 ? '#22c55e' : g.progressPct >= 40 ? '#f59e0b' : '#ef4444' }}
                                />
                              </div>
                              <span className={`text-xs ${textSecondary} flex-shrink-0`}>{g.progressPct}%</span>
                              {g.totalTasks > 0 && (
                                <span className={`text-xs ${textSecondary} flex-shrink-0`}>{g.completedTasks}/{g.totalTasks}</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Standalone projects */}
                  {goalsProjectsEnabled && nextWeekProjects.length > 0 && (
                    <div className="mb-4">
                      <div className={`text-xs font-semibold uppercase ${textSecondary} tracking-wider mb-2`}>Standalone Projects</div>
                      <div className="space-y-2">
                        {nextWeekProjects.map(p => {
                          const momentumColor = p.momentum === 'green' ? '#22c55e' : p.momentum === 'amber' ? '#f59e0b' : '#ef4444';
                          const momentumLabel = p.momentum === 'green' ? 'Active' : p.momentum === 'amber' ? 'Slowing' : 'Stalled';
                          const barColor = p.progressPct >= 100 ? '#22c55e' : p.progressPct >= 50 ? '#3b82f6' : p.progressPct >= 20 ? '#f59e0b' : '#ef4444';
                          return (
                            <div key={p.id} className="flex items-center gap-2">
                              <div
                                className="w-2 h-2 rounded-full flex-shrink-0"
                                style={{ backgroundColor: momentumColor }}
                                title={momentumLabel}
                              />
                              <span className={`text-sm ${textPrimary} flex-1 min-w-0 truncate`}>{p.title}</span>
                              <div className={`flex-shrink-0 w-16 h-1.5 rounded-full ${darkMode ? 'bg-gray-600' : 'bg-stone-200'}`}>
                                <div
                                  className="h-full rounded-full"
                                  style={{ width: `${p.progressPct}%`, backgroundColor: barColor }}
                                />
                              </div>
                              <span className={`text-xs ${textSecondary} flex-shrink-0 w-10 text-right`}>{p.completedTasks}/{p.totalTasks}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Open days nudge */}
                  {openDays.length > 0 && (
                    <div className={`rounded-lg border ${darkMode ? 'border-green-800 bg-green-900/20' : 'border-green-200 bg-green-50'} p-3`}>
                      <div className={`flex items-center gap-2 ${darkMode ? 'text-green-300' : 'text-green-700'} font-medium text-sm`}>
                        <Sparkles size={16} />
                        {openDayNames.join(', ')} {openDays.length === 1 ? 'is' : 'are'} open for deep work.
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Dot indicators (mobile + tablet) / Page label (desktop) */}
              <div className="flex justify-center items-center gap-2 py-3">
                {(isMobile || isTablet) ? (
                  [0, 1].map(i => (
                    <button
                      key={i}
                      className={`w-2.5 h-2.5 rounded-full transition-colors ${mobileReviewPage === i ? 'bg-blue-500' : darkMode ? 'bg-gray-600' : 'bg-stone-300'}`}
                      onClick={() => {
                        reviewScrollRef.current?.scrollTo({ left: i * reviewScrollRef.current.clientWidth, behavior: 'smooth' });
                      }}
                    />
                  ))
                ) : (
                  <span className={`text-xs ${textSecondary}`}>{mobileReviewPage === 0 ? 'Past 7 Days' : 'Next 7 Days'} &middot; {mobileReviewPage + 1}/2</span>
                )}
              </div>
            </div>
          </div>
        );
};

export default WeeklyReviewModal;
