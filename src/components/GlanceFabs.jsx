import { BarChart3, BookOpen, ChevronDown, ChevronUp, GitBranch, NotebookPen, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useSyncCtx } from '../context/SyncContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import useGlanceFabs from '../hooks/useGlanceFabs.js';
import { glanceFabStagger, glanceFabVisibilityClass } from '../utils/glanceFabs.js';

/**
 * Every GLANCE panel action button on desktop and tablet, and the one handle
 * that collapses them — the same two-column arrangement the phone has in
 * MobileLayout: labelled pills bottom-left (daily note, Goals & Projects),
 * circular FABs bottom-right (weekly review, daily stats ring, recycle bin),
 * with the handle at the foot of the right-hand column.
 *
 * ONE component for both columns is the point, not tidiness. The collapsed flag
 * is component state, so a second copy of this hook somewhere else would be a
 * second, independent flag: the handle would fold its own column and leave the
 * other one sitting there. The right-hand column used to live in App.jsx —
 * twice, once per platform — which is exactly how it got left behind.
 *
 * DesktopLayout renders this in both its own 340px sidebar and the tablet's, so
 * everything is absolutely positioned against that panel rather than the
 * viewport (the right column was `fixed left: 268px`, hard-coding the panel's
 * 340px width minus a button and a margin). Both wrappers are
 * pointer-events-none: they span boxes wider and taller than the buttons in
 * them, and the GLANCE content underneath has to stay clickable around them.
 *
 * The handle never collapses — it is the only way back.
 */
export default function GlanceFabs() {
  const {
    darkMode, textPrimary, setDailyNotesModalDate, getTodayStr,
    recycleBin, setShowMobileDailySummary,
    actualTodayNonImportedTasks, actualTodayCompletedTasks, inboxCompletedTodayCount,
  } = useDayPlannerCtx();
  const { obsidianConfig, setShowMobileRecycleBin } = useSyncCtx();
  const {
    goalsProjectsEnabled, setShowGoalsDashboard,
    setShowWeeklyReview, showWeeklyReviewReminder, setShowWeeklyReviewReminder,
    weeklyReviewDismissedRef, lastWeeklyReviewFiredRef,
  } = useFeaturesCtx();
  const { t } = useTranslation();
  const { collapsed, toggle } = useGlanceFabs();

  const binCount = recycleBin.filter((task) => !task.isExample).length;

  // The handle sits in the right column, so that column's height sets the
  // rhythm both columns animate on. It varies: no recycle-bin button when the
  // bin is empty.
  const stackCount = binCount > 0 ? 3 : 2;
  const delay = (index) => ({ transitionDelay: `${glanceFabStagger(collapsed, index, stackCount)}ms` });

  const fabClass = (extra) => `w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all duration-300 ease-out ${extra} ${glanceFabVisibilityClass(collapsed)}`;
  const neutralFab = darkMode ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-stone-200 text-stone-600 hover:bg-stone-300';
  const pillClass = `h-9 px-3 rounded-full shadow-lg flex items-center gap-1.5 transition-all duration-300 ease-out ${
    darkMode ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
  } ${glanceFabVisibilityClass(collapsed)}`;

  // Listed TOP-DOWN, the order they render; the stagger counts up FROM the
  // handle, so it is the reverse of this list's index.
  const pills = [
    {
      key: 'dailyNote',
      icon: obsidianConfig?.enabled ? <BookOpen size={15} /> : <NotebookPen size={15} />,
      label: t('common.dailyNote'),
      title: "Today's daily note",
      onClick: () => setDailyNotesModalDate(getTodayStr()),
    },
    goalsProjectsEnabled && {
      key: 'goals',
      icon: <GitBranch size={15} />,
      label: t('settings.goalsProjects'),
      title: 'Goals & Projects',
      onClick: () => setShowGoalsDashboard(true),
    },
  ].filter(Boolean);

  const donePct = actualTodayNonImportedTasks.length > 0
    ? Math.round(((actualTodayCompletedTasks.length + inboxCompletedTodayCount) / actualTodayNonImportedTasks.length) * 100)
    : 0;
  const ringColor = donePct >= 100 ? 'stroke-green-500' : donePct >= 50 ? 'stroke-amber-500' : 'stroke-red-500';

  return (
    <>
      {/* Left column — labelled pills. */}
      <div className="absolute bottom-6 left-4 z-10 flex flex-col items-start gap-2 pointer-events-none">
        {pills.map((pill, i) => (
          <button
            key={pill.key}
            onClick={pill.onClick}
            title={pill.title}
            style={delay(pills.length - 1 - i)}
            className={pillClass}
          >
            {pill.icon}
            <span className="text-xs font-medium whitespace-nowrap">{pill.label}</span>
          </button>
        ))}
      </div>

      {/* Right column — circular FABs, resting on the handle. A flex stack, as
          on the phone: it keeps the narrower handle centred under the 56px
          buttons and closes the gap by itself when the bin empties. */}
      <div className="absolute bottom-6 right-4 z-10 flex flex-col items-center gap-2 pointer-events-none">
        {binCount > 0 && (
          <button
            onClick={() => setShowMobileRecycleBin(true)}
            className={fabClass(neutralFab)}
            style={delay(2)}
          >
            <div className="relative">
              <Trash2 size={22} />
              <span className="absolute -top-2 -right-3 bg-red-500 text-white text-[10px] font-bold min-w-[16px] h-[16px] flex items-center justify-center rounded-full px-0.5">
                {binCount > 9 ? '9+' : binCount}
              </span>
            </div>
          </button>
        )}
        <button
          onClick={() => setShowMobileDailySummary(true)}
          className={fabClass(darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-200 hover:bg-stone-300')}
          style={delay(1)}
        >
          <div className="relative w-11 h-11">
            <svg viewBox="0 0 36 36" className="w-11 h-11 -rotate-90">
              <circle cx="18" cy="18" r="14" fill="none" strokeWidth="3" className={darkMode ? 'stroke-gray-600' : 'stroke-gray-200'} />
              <circle cx="18" cy="18" r="14" fill="none" strokeWidth="3" strokeLinecap="round" className={ringColor}
                strokeDasharray={`${(donePct / 100) * 87.96} 87.96`}
              />
            </svg>
            <span className={`absolute inset-0 flex items-center justify-center text-[10px] font-bold ${textPrimary}`}>
              <ChevronUp size={16} />
            </span>
          </div>
        </button>
        <button
          onClick={() => {
            if (showWeeklyReviewReminder) {
              weeklyReviewDismissedRef.current = lastWeeklyReviewFiredRef.current;
              localStorage.setItem('day-planner-weekly-review-dismissed', lastWeeklyReviewFiredRef.current);
              setShowWeeklyReviewReminder(false);
            }
            setShowWeeklyReview(true);
          }}
          className={fabClass(showWeeklyReviewReminder ? 'bg-blue-600 text-white hover:bg-blue-700' : neutralFab)}
          style={delay(0)}
        >
          <BarChart3 size={22} />
        </button>
        <button
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? t('common.showActions') : t('common.hideActions')}
          className={`pointer-events-auto w-11 h-11 rounded-full shadow-lg flex items-center justify-center backdrop-blur-sm transition-colors ${
            darkMode ? 'bg-gray-700/90 text-gray-400 hover:bg-gray-600' : 'bg-stone-200/90 text-stone-500 hover:bg-stone-300'
          }`}
        >
          {collapsed ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>
      </div>
    </>
  );
}
