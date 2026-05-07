import React from 'react';
import { TAILWIND_TO_HEX } from '../utils/colorUtils.js';

const GoalRing = ({ goal, progressPct, daysLeft, projectBars = [], darkMode, onClick }) => {
  const hex = goal.color?.startsWith('#')
    ? goal.color
    : (TAILWIND_TO_HEX[goal.color] || '#3b82f6');

  const size = 44;
  const radius = size * 0.38;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;
  const strokeWidth = 3.5;
  const dashOffset = circumference * (1 - Math.min(progressPct / 100, 1));

  const urgencyColor = daysLeft !== null && daysLeft < 0 ? '#ef4444'
    : daysLeft !== null && daysLeft <= 3 ? '#f59e0b'
    : null;

  const daysLabel = daysLeft === null ? null
    : daysLeft < 0 ? 'overdue'
    : daysLeft === 0 ? 'due today'
    : daysLeft === 1 ? '1d left'
    : `${daysLeft}d left`;

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2.5 active:opacity-70 transition-opacity select-none text-left"
    >
      {/* Arc ring */}
      <div className="relative flex-shrink-0">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle
            cx={center} cy={center} r={radius}
            fill="none" strokeWidth={strokeWidth}
            stroke={darkMode ? '#374151' : '#e5e7eb'}
          />
          <circle
            cx={center} cy={center} r={radius}
            fill="none" strokeWidth={strokeWidth}
            stroke={hex} strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            className="transition-all duration-300"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[9px] font-bold leading-none" style={{ color: hex }}>
            {progressPct}%
          </span>
        </div>
      </div>

      {/* Text column */}
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-medium truncate leading-tight ${darkMode ? 'text-gray-200' : 'text-stone-800'}`}>
          {goal.title}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          {projectBars.length > 1 ? (
            <div className="flex flex-1 gap-0.5">
              {projectBars.map(bar => (
                <div
                  key={bar.id}
                  className={`flex-1 h-1 rounded-sm overflow-hidden ${darkMode ? 'bg-gray-600' : 'bg-stone-200'}`}
                >
                  <div
                    className="h-full rounded-sm transition-all duration-300"
                    style={{ width: `${bar.progress}%`, backgroundColor: hex }}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className={`flex-1 h-1 rounded-full ${darkMode ? 'bg-gray-600' : 'bg-stone-200'}`}>
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width: `${projectBars.length === 1 ? projectBars[0].progress : progressPct}%`, backgroundColor: hex }}
              />
            </div>
          )}
          {daysLabel && (
            <span
              className="text-[10px] flex-shrink-0 font-medium"
              style={{ color: urgencyColor || (darkMode ? '#9ca3af' : '#78716c') }}
            >
              {daysLabel}
            </span>
          )}
        </div>
      </div>
    </button>
  );
};

export default GoalRing;
