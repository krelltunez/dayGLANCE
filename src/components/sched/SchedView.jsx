import React, { useState } from 'react';
import { ChevronDown, Eye, EyeOff, ListFilter, Plus } from 'lucide-react';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { useTranslation } from 'react-i18next';
import { dateToString } from '../../utils/taskUtils.js';
import useSchedAgendaState, { LOAD_MORE_DAYS } from './useSchedAgendaState.js';
import SchedTaskCard from './SchedTaskCard.jsx';
import SchedFilterPopup from './SchedFilterPopup.jsx';

/**
 * SCHED — scrollable day-grouped agenda of scheduled tasks, starting at the
 * currently selected day. Third mobile/tablet view alongside GRID and LIST;
 * the desktop dashboard (SchedDashboard) shares the same agenda state.
 */
const SchedView = () => {
  const { borderClass, textSecondary, hoverBg } = useDayPlannerCtx();
  const { t } = useTranslation();
  const [showFilters, setShowFilters] = useState(false);

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
    const base = day.date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
    if (day.dateStr === todayStr) return `${t('common.today', 'Today')} · ${base}`;
    if (day.dateStr === tomorrowStr) return `${t('common.tomorrow', 'Tomorrow')} · ${base}`;
    return base;
  };

  return (
    <div className="flex flex-col gap-3 px-3 pb-24 pt-2">
      {/* Controls */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowFilters(true)}
          className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-colors ${
            filtersActive
              ? 'bg-blue-600 text-white border-blue-600'
              : `${borderClass} ${textSecondary} ${hoverBg}`
          }`}
        >
          <ListFilter size={13} />
          Filter{filtersActive ? ` · ${filters.colors.length + filters.tags.length + filters.projectIds.length}` : ''}
        </button>
        <button
          onClick={toggleEmptyDays}
          className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border ${borderClass} ${textSecondary} ${hoverBg} transition-colors`}
          title={showEmptyDays ? 'Hide empty days' : 'Show empty days'}
        >
          {showEmptyDays ? <Eye size={13} /> : <EyeOff size={13} />}
          Empty days
        </button>
      </div>

      {/* Day groups */}
      {visibleDays.map(day => (
        <div key={day.dateStr} className="flex flex-col gap-1.5">
          <div className={`text-xs font-semibold uppercase tracking-wide ${day.dateStr === todayStr ? 'text-blue-500' : textSecondary} pt-1`}>
            {dayLabel(day)}
          </div>
          {day.tasks.length > 0 ? (
            day.tasks.map(task => <SchedTaskCard key={task.id} task={task} />)
          ) : (
            <button
              onClick={() => addTaskOnDay(day.dateStr)}
              className={`flex items-center justify-center gap-1.5 rounded-xl border border-dashed ${borderClass} py-2.5 text-xs ${textSecondary} ${hoverBg} transition-colors`}
            >
              <Plus size={13} />
              {t('task.addTask', 'Add task')}
            </button>
          )}
        </div>
      ))}

      {visibleDays.length === 0 && (
        <p className={`text-sm ${textSecondary} text-center py-8`}>
          {filtersActive ? 'No tasks match the current filters.' : 'Nothing scheduled in this window.'}
        </p>
      )}

      {/* Extend window */}
      <button
        onClick={showMoreDays}
        className={`flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium ${textSecondary} ${hoverBg} rounded-xl border ${borderClass} transition-colors`}
      >
        <ChevronDown size={13} />
        Show {LOAD_MORE_DAYS} more days
      </button>

      {showFilters && (
        <SchedFilterPopup
          filters={filters}
          setFilters={setFilters}
          availableColors={availableColors}
          availableTags={availableTags}
          onClose={() => setShowFilters(false)}
        />
      )}
    </div>
  );
};

export default SchedView;
