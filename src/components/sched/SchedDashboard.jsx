import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Eye, EyeOff, Plus, X } from 'lucide-react';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../../context/FeaturesContext.jsx';
import { useTranslation } from 'react-i18next';
import { dateToString } from '../../utils/taskUtils.js';
import { TASK_COLORS } from '../../utils/colorUtils.js';
import { EMPTY_SCHED_FILTERS, toggleSchedFilter, groupProjectsForFilter } from '../../utils/schedAgenda.js';
import useSchedAgendaState, { LOAD_MORE_DAYS } from './useSchedAgendaState.js';
import SchedTaskCard from './SchedTaskCard.jsx';

/** One collapsible section of the desktop filter rail. */
const RailSection = ({ title, count, children, defaultOpen = true }) => {
  const { borderClass, textPrimary, textSecondary, hoverBg } = useDayPlannerCtx();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`border-b ${borderClass} pb-3`}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center justify-between py-1.5 px-1 rounded ${hoverBg} transition-colors`}
      >
        <span className={`text-xs font-semibold uppercase tracking-wide ${textPrimary}`}>
          {title}{count ? <span className="ml-1.5 text-blue-500">{count}</span> : null}
        </span>
        {open ? <ChevronDown size={13} className={textSecondary} /> : <ChevronRight size={13} className={textSecondary} />}
      </button>
      {open && <div className="pt-1.5">{children}</div>}
    </div>
  );
};

/**
 * Desktop SCHED dashboard — Todoist-Upcoming-style day-grouped agenda that
 * replaces the timeline when the view cycler is on SCHED. The date navigation
 * above sets the agenda's starting day; filters live in the right-hand rail.
 */
const SchedDashboard = () => {
  const { cardBg, borderClass, textPrimary, textSecondary, hoverBg } = useDayPlannerCtx();
  const { projects, goals, goalsProjectsEnabled } = useFeaturesCtx();
  const { t } = useTranslation();

  const {
    visibleDays, filtersActive,
    filters, setFilters,
    availableColors, availableTags,
    showEmptyDays, toggleEmptyDays,
    showMoreDays,
    addTaskOnDay,
  } = useSchedAgendaState();

  const todayStr = dateToString(new Date());
  const tomorrowStr = dateToString(new Date(Date.now() + 86400000));

  const dayLabel = (day) => {
    const base = day.date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    if (day.dateStr === todayStr) return `${base} · ${t('common.today', 'Today')}`;
    if (day.dateStr === tomorrowStr) return `${base} · ${t('common.tomorrow', 'Tomorrow')}`;
    return base;
  };

  const colorOptions = TASK_COLORS.filter(c => availableColors.has(c.class));
  const projectGroups = goalsProjectsEnabled ? groupProjectsForFilter(projects, goals) : [];

  const chip = (selected) => `px-2 py-0.5 rounded-full text-xs font-medium border transition-colors ${
    selected
      ? 'bg-blue-600 text-white border-blue-600'
      : `${borderClass} ${textSecondary} ${hoverBg}`
  }`;

  return (
    <div className="flex items-start">
      {/* Agenda */}
      <div className="flex-1 min-w-0 px-6 py-4">
        <div className="max-w-2xl mx-auto flex flex-col gap-4">
          {visibleDays.map(day => (
            <div key={day.dateStr} className="flex flex-col gap-1.5">
              <div className={`flex items-center justify-between border-b ${borderClass} pb-1`}>
                <span className={`text-sm font-semibold ${day.dateStr === todayStr ? 'text-blue-500' : textPrimary}`}>
                  {dayLabel(day)}
                </span>
                <button
                  onClick={() => addTaskOnDay(day.dateStr)}
                  className={`p-1 rounded ${hoverBg} ${textSecondary} transition-colors`}
                  title={t('task.addTask', 'Add task')}
                  aria-label={`Add task on ${day.dateStr}`}
                >
                  <Plus size={14} />
                </button>
              </div>
              {day.tasks.length > 0 ? (
                day.tasks.map(task => <SchedTaskCard key={task.id} task={task} showProject />)
              ) : (
                <button
                  onClick={() => addTaskOnDay(day.dateStr)}
                  className={`flex items-center justify-center gap-1.5 rounded-xl border border-dashed ${borderClass} py-2 text-xs ${textSecondary} ${hoverBg} transition-colors`}
                >
                  <Plus size={13} />
                  {t('task.addTask', 'Add task')}
                </button>
              )}
            </div>
          ))}

          {visibleDays.length === 0 && (
            <p className={`text-sm ${textSecondary} text-center py-10`}>
              {filtersActive ? 'No tasks match the current filters.' : 'Nothing scheduled in this window.'}
            </p>
          )}

          <button
            onClick={showMoreDays}
            className={`flex items-center justify-center gap-1.5 py-2 text-xs font-medium ${textSecondary} ${hoverBg} rounded-xl border ${borderClass} transition-colors`}
          >
            <ChevronDown size={13} />
            Show {LOAD_MORE_DAYS} more days
          </button>
        </div>
      </div>

      {/* Filter panel — floats in the space right of the agenda */}
      <div
        className={`w-64 flex-shrink-0 rounded-xl border ${borderClass} ${cardBg} shadow-sm px-3 py-3 mr-6 my-4 flex flex-col gap-3`}
        style={{ position: 'sticky', top: 'calc(var(--header-row-h, 40px) + 12px)' }}
      >
        <div className="flex items-center justify-between px-1">
          <span className={`text-xs font-semibold uppercase tracking-wide ${textSecondary}`}>Filters</span>
          {filtersActive && (
            <button
              onClick={() => setFilters(EMPTY_SCHED_FILTERS)}
              className="flex items-center gap-1 text-xs font-medium text-blue-500"
            >
              <X size={11} />
              Clear
            </button>
          )}
        </div>

        <RailSection title="Colors" count={filters.colors.length}>
          {colorOptions.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 px-1">
              {colorOptions.map(c => (
                <button
                  key={c.class}
                  onClick={() => setFilters(f => toggleSchedFilter(f, 'colors', c.class))}
                  className={`w-6 h-6 rounded-full ${c.class} transition-transform ${
                    filters.colors.includes(c.class) ? 'ring-2 ring-offset-2 ring-blue-500 scale-110' : 'hover:scale-110 opacity-80'
                  }`}
                  aria-label={c.name}
                />
              ))}
            </div>
          ) : <p className={`text-xs ${textSecondary} px-1`}>No colors in view.</p>}
        </RailSection>

        <RailSection title="Tags" count={filters.tags.length}>
          {availableTags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 px-1">
              {availableTags.map(tag => (
                <button key={tag} onClick={() => setFilters(f => toggleSchedFilter(f, 'tags', tag))} className={chip(filters.tags.includes(tag))}>
                  #{tag}
                </button>
              ))}
            </div>
          ) : <p className={`text-xs ${textSecondary} px-1`}>No tags in view.</p>}
        </RailSection>

        {goalsProjectsEnabled && (
          <RailSection title="Projects" count={filters.projectIds.length}>
            {projectGroups.length > 0 ? (
              <div className="flex flex-col gap-2 px-1">
                {projectGroups.map(group => (
                  <div key={group.label} className="flex flex-col gap-1">
                    <span className={`text-[10px] font-semibold uppercase tracking-wide ${textSecondary} opacity-60`}>{group.label}</span>
                    {group.projects.map(p => (
                      <button
                        key={p.id}
                        onClick={() => setFilters(f => toggleSchedFilter(f, 'projectIds', p.id))}
                        className={`text-left ${chip(filters.projectIds.includes(p.id))} truncate`}
                      >
                        {p.title}
                      </button>
                    ))}
                  </div>
                ))}
                <button
                  onClick={() => setFilters(f => toggleSchedFilter(f, 'projectIds', 'none'))}
                  className={`text-left ${chip(filters.projectIds.includes('none'))}`}
                >
                  No project
                </button>
              </div>
            ) : <p className={`text-xs ${textSecondary} px-1`}>No active projects.</p>}
          </RailSection>
        )}

        <button
          onClick={toggleEmptyDays}
          className={`flex items-center gap-1.5 text-xs font-medium px-2 py-1.5 rounded-lg border ${borderClass} ${textSecondary} ${hoverBg} transition-colors`}
        >
          {showEmptyDays ? <Eye size={13} /> : <EyeOff size={13} />}
          {showEmptyDays ? 'Hide empty days' : 'Show empty days'}
        </button>
      </div>
    </div>
  );
};

export default SchedDashboard;
