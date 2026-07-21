import React from 'react';
import { X } from 'lucide-react';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../../context/FeaturesContext.jsx';
import { TASK_COLORS } from '../../utils/colorUtils.js';
import { hasActiveSchedFilters, toggleSchedFilter, EMPTY_SCHED_FILTERS, groupProjectsForFilter } from '../../utils/schedAgenda.js';

/**
 * SCHED filter sheet: colors, tags, projects. Empty selection in a section
 * means "everything"; selections within a section OR together, sections AND.
 * `availableColors`/`availableTags` come from the visible agenda window so the
 * sheet never offers options that can't match anything.
 */
const SchedFilterPopup = ({ filters, setFilters, availableColors, availableTags, nextInstanceOnly, toggleNextInstanceOnly, onClose }) => {
  const { darkMode, cardBg, borderClass, textPrimary, textSecondary, hoverBg } = useDayPlannerCtx();
  const { projects, goals, goalsProjectsEnabled } = useFeaturesCtx();

  const colorOptions = TASK_COLORS.filter(c => availableColors.has(c.class));
  const projectGroups = goalsProjectsEnabled ? groupProjectsForFilter(projects, goals) : [];

  const chip = (selected) => `px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
    selected
      ? 'bg-blue-600 text-white border-blue-600'
      : `${borderClass} ${textSecondary} ${hoverBg}`
  }`;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end sm:items-center sm:justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        onClick={e => e.stopPropagation()}
        className={`relative ${cardBg} rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md max-h-[75vh] overflow-y-auto p-5 flex flex-col gap-4`}
      >
        <div className="flex items-center justify-between">
          <h3 className={`text-base font-semibold ${textPrimary}`}>Filter tasks</h3>
          <div className="flex items-center gap-2">
            {hasActiveSchedFilters(filters) && (
              <button
                onClick={() => setFilters(EMPTY_SCHED_FILTERS)}
                className="text-xs font-medium text-blue-500"
              >
                Clear all
              </button>
            )}
            <button onClick={onClose} className={`p-1 rounded-lg ${hoverBg}`} aria-label="Close filters">
              <X size={16} className={textSecondary} />
            </button>
          </div>
        </div>

        {/* Colors */}
        {colorOptions.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className={`text-xs font-medium ${textSecondary}`}>Colors</span>
            <div className="flex flex-wrap gap-2">
              {colorOptions.map(c => (
                <button
                  key={c.class}
                  onClick={() => setFilters(f => toggleSchedFilter(f, 'colors', c.class))}
                  className={`w-7 h-7 rounded-full ${c.class} transition-transform ${
                    filters.colors.includes(c.class) ? 'ring-2 ring-offset-2 ring-blue-500 scale-110' : 'hover:scale-110 opacity-80'
                  }`}
                  aria-label={c.name}
                />
              ))}
            </div>
          </div>
        )}

        {/* Tags */}
        {availableTags.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className={`text-xs font-medium ${textSecondary}`}>Tags</span>
            <div className="flex flex-wrap gap-1.5">
              {availableTags.map(tag => (
                <button key={tag} onClick={() => setFilters(f => toggleSchedFilter(f, 'tags', tag))} className={chip(filters.tags.includes(tag))}>
                  #{tag}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Projects */}
        {goalsProjectsEnabled && projectGroups.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className={`text-xs font-medium ${textSecondary}`}>Projects</span>
            {projectGroups.map(group => (
              <div key={group.label} className="flex flex-col gap-1">
                <span className={`text-[10px] font-semibold uppercase tracking-wide ${textSecondary} opacity-60`}>{group.label}</span>
                <div className="flex flex-wrap gap-1.5">
                  {group.projects.map(p => (
                    <button key={p.id} onClick={() => setFilters(f => toggleSchedFilter(f, 'projectIds', p.id))} className={chip(filters.projectIds.includes(p.id))}>
                      {p.title}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <button onClick={() => setFilters(f => toggleSchedFilter(f, 'projectIds', 'none'))} className={`self-start ${chip(filters.projectIds.includes('none'))}`}>
              No project
            </button>
          </div>
        )}

        {/* Recurring tasks — view preference, not part of the filter badge */}
        <div className="flex flex-col gap-1.5">
          <span className={`text-xs font-medium ${textSecondary}`}>Recurring tasks</span>
          <div className="flex gap-1.5">
            <button onClick={() => nextInstanceOnly && toggleNextInstanceOnly()} className={chip(!nextInstanceOnly)}>
              All instances
            </button>
            <button onClick={() => !nextInstanceOnly && toggleNextInstanceOnly()} className={chip(nextInstanceOnly)}>
              Next only
            </button>
          </div>
        </div>

        {colorOptions.length === 0 && availableTags.length === 0 && projectGroups.length === 0 && (
          <p className={`text-sm ${textSecondary}`}>Nothing to filter yet — schedule some tasks first.</p>
        )}

        <p className={`text-[11px] ${textSecondary} ${darkMode ? 'opacity-50' : 'opacity-60'}`}>
          Selections within a section match any; sections combine.
        </p>
      </div>
    </div>
  );
};

export default SchedFilterPopup;
