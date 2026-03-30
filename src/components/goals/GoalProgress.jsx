import React from 'react';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';

/**
 * Progress bar for a single goal.
 * The filled portion uses the goal's own color so each goal looks distinct.
 */
const GoalProgress = ({ progress, color }) => {
  const { darkMode, textSecondary } = useDayPlannerCtx();
  const pct = Math.round((progress || 0) * 100);

  return (
    <div
      className={`w-full h-2 rounded-full overflow-hidden ${
        darkMode ? 'bg-gray-700' : 'bg-stone-200'
      }`}
    >
      <div
        className={`h-full rounded-full transition-all duration-500 ${color || 'bg-blue-500'}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
};

export default GoalProgress;
