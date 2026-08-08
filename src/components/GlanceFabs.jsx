import { BookOpen, ChevronDown, ChevronUp, GitBranch, NotebookPen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useSyncCtx } from '../context/SyncContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import useGlanceFabs from '../hooks/useGlanceFabs.js';
import { glanceFabStagger, glanceFabVisibilityClass } from '../utils/glanceFabs.js';

/**
 * The GLANCE panel's action pills (daily note, Goals & Projects) plus the handle
 * that collapses them, for desktop AND tablet landscape — DesktopLayout renders
 * the same panel twice (its own 340px sidebar and the tablet's), and carried two
 * verbatim copies of these buttons before this component existed.
 *
 * Absolutely positioned in the panel's bottom-left corner, so the wrapper is
 * pointer-events-none: it spans a box wider than the pills themselves, and the
 * GLANCE content underneath has to stay clickable around them.
 *
 * The handle is always the bottom-most element and never collapses — it is the
 * only way back. The pills stack upward from it, so the one that folds away last
 * is always the one beside it (see glanceFabStagger).
 *
 * The phone's version of this lives in MobileLayout: same handle, same state
 * key, same timing, but circular FABs over the viewport rather than pills in a
 * panel, so only the behaviour is shared (utils/glanceFabs.js), not the markup.
 */
export default function GlanceFabs() {
  const { darkMode, setDailyNotesModalDate, getTodayStr } = useDayPlannerCtx();
  const { obsidianConfig } = useSyncCtx();
  const { goalsProjectsEnabled, setShowGoalsDashboard } = useFeaturesCtx();
  const { t } = useTranslation();
  const { collapsed, toggle } = useGlanceFabs();

  // Listed TOP-DOWN, the order they render. The stagger index counts up FROM
  // the handle, so it is the reverse of this list's index.
  const actions = [
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

  const pillClass = `h-9 px-3 rounded-full shadow-lg flex items-center gap-1.5 transition-all duration-300 ease-out ${
    darkMode ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
  }`;

  return (
    <div className="absolute bottom-6 left-4 z-10 flex flex-col items-start gap-2 pointer-events-none">
      {actions.map((action, i) => (
        <button
          key={action.key}
          onClick={action.onClick}
          title={action.title}
          style={{ transitionDelay: `${glanceFabStagger(collapsed, actions.length - 1 - i, actions.length)}ms` }}
          className={`${pillClass} ${glanceFabVisibilityClass(collapsed)}`}
        >
          {action.icon}
          <span className="text-xs font-medium whitespace-nowrap">{action.label}</span>
        </button>
      ))}
      <button
        onClick={toggle}
        aria-expanded={!collapsed}
        aria-label={collapsed ? t('common.showActions') : t('common.hideActions')}
        className={`pointer-events-auto w-8 h-8 rounded-full shadow-lg flex items-center justify-center backdrop-blur-sm transition-colors ${
          darkMode ? 'bg-gray-700/90 text-gray-400 hover:bg-gray-600' : 'bg-stone-100/90 text-stone-500 hover:bg-stone-200'
        }`}
      >
        {collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
    </div>
  );
}
