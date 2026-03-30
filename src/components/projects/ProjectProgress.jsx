import React from 'react';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';

/**
 * Progress bar for a single project.
 * Uses blue normally; switches to green when complete.
 * `compact` mode omits the percentage label and uses a thinner bar.
 */
const ProjectProgress = ({ progress, compact = false }) => {
  const { darkMode, textSecondary } = useDayPlannerCtx();
  const pct = Math.round((progress || 0) * 100);

  return (
    <div className="w-full">
      <div
        className={`w-full rounded-full overflow-hidden ${
          compact ? 'h-1.5' : 'h-2'
        } ${darkMode ? 'bg-gray-700' : 'bg-stone-200'}`}
      >
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            pct === 100 ? 'bg-green-500' : 'bg-blue-500'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {!compact && (
        <div className="flex justify-end mt-0.5">
          <span
            className={`text-xs font-medium ${
              pct === 100 ? 'text-green-500' : textSecondary
            }`}
          >
            {pct}%
          </span>
        </div>
      )}
    </div>
  );
};

export default ProjectProgress;
