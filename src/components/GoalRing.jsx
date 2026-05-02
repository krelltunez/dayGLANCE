import React from 'react';
import { TAILWIND_TO_HEX } from '../utils/colorUtils.js';

const GoalRing = ({ goal, progressPct, daysLeft, darkMode, size = 60, onClick }) => {
  const hex = goal.color?.startsWith('#')
    ? goal.color
    : (TAILWIND_TO_HEX[goal.color] || '#3b82f6');
  const radius = size * 0.38;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;
  const strokeWidth = 3.5;
  const dashOffset = circumference * (1 - Math.min(progressPct / 100, 1));

  const badgeBg = daysLeft !== null && daysLeft <= 0 ? '#ef4444'
    : daysLeft !== null && daysLeft <= 3 ? '#f59e0b'
    : '#3b82f6';

  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1 active:scale-95 transition-transform select-none"
      style={{ width: size + 16 }}
    >
      <div className="relative">
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
          <span className="text-[11px] font-bold leading-none" style={{ color: hex }}>
            {progressPct}%
          </span>
        </div>
        {daysLeft !== null && daysLeft <= 7 && (
          <div
            className="absolute -top-0.5 -right-0.5 min-w-[14px] h-3.5 rounded-full flex items-center justify-center px-0.5"
            style={{ backgroundColor: badgeBg }}
          >
            <span className="text-[8px] font-bold text-white leading-none">
              {daysLeft <= 0 ? '!' : daysLeft}
            </span>
          </div>
        )}
      </div>
      <span
        className={`text-[10px] font-medium leading-tight text-center ${darkMode ? 'text-gray-400' : 'text-stone-500'}`}
        style={{
          maxWidth: size + 8,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          wordBreak: 'break-word',
        }}
      >
        {goal.title}
      </span>
    </button>
  );
};

export default GoalRing;
