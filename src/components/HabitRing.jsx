import React from 'react';
import { RefreshCw, Target } from 'lucide-react';
import { HABIT_ICONS, HABIT_COLORS } from '../constants/habits.js';

const HabitRing = ({ size = 40, habit, count = 0, onClick, onContextMenu, onMouseDown, onMouseUp, onMouseLeave, onTouchStart, onTouchEnd, darkMode, autoSynced = false }) => {
  const { type, target, color, icon } = habit;
  const colorObj = HABIT_COLORS.find(c => c.name === color) || HABIT_COLORS[0];
  const IconComponent = HABIT_ICONS[icon] || Target;
  const radius = size * 0.38;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;
  const strokeWidth = size >= 30 ? 3 : 2;
  const iconSize = size >= 30 ? size * 0.4 : size * 0.45;

  let ringColor, progress, showCheck, showX;
  if (type === 'doMore') {
    progress = target > 0 ? Math.min(count / target, 1) : 0;
    ringColor = count === 0 ? (darkMode ? '#4b5563' : '#d1d5db') : colorObj.ring;
    showCheck = count >= target && target > 0;
    showX = false;
  } else {
    // Limit type: ring is always full, color shifts green → yellow → red
    progress = 1;
    if (count === 0) {
      ringColor = '#22c55e'; // green
    } else if (count <= target) {
      // Graduated yellow/amber
      const ratio = count / target;
      if (ratio <= 0.5) ringColor = '#eab308'; // yellow
      else ringColor = '#f59e0b'; // amber
    } else {
      ringColor = '#ef4444'; // red
    }
    showCheck = false;
    showX = count > target;
  }

  const dashOffset = circumference * (1 - progress);

  return (
    <button
      data-ctx-menu
      onClick={autoSynced ? undefined : onClick}
      onContextMenu={autoSynced ? undefined : onContextMenu}
      onMouseDown={autoSynced ? undefined : onMouseDown}
      onMouseUp={autoSynced ? undefined : onMouseUp}
      onMouseLeave={autoSynced ? undefined : onMouseLeave}
      onTouchStart={autoSynced ? undefined : onTouchStart}
      onTouchEnd={autoSynced ? undefined : onTouchEnd}
      className={`flex flex-col items-center gap-0.5 select-none transition-transform ${autoSynced ? 'cursor-default' : 'active:scale-95'}`}
      style={{ width: size + 8 }}
    >
      <div className="relative">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          {/* Background circle */}
          <circle
            cx={center} cy={center} r={radius}
            fill="none" strokeWidth={strokeWidth}
            stroke={darkMode ? '#374151' : '#e5e7eb'}
          />
          {/* Progress arc */}
          <circle
            cx={center} cy={center} r={radius}
            fill="none" strokeWidth={strokeWidth}
            stroke={ringColor}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            className="transition-all duration-300"
          />
        </svg>
        {/* Icon overlay — always show the habit icon so users can identify it;
            colour it green on success or red when a limit is exceeded */}
        <div className="absolute inset-0 flex items-center justify-center">
          <IconComponent
            size={iconSize}
            style={{ color: showCheck ? '#22c55e' : showX ? '#ef4444' : (ringColor === (darkMode ? '#4b5563' : '#d1d5db') ? (darkMode ? '#9ca3af' : '#9ca3af') : ringColor) }}
          />
        </div>
        {/* Auto-sync indicator — small dot in top-right corner */}
        {autoSynced && (
          <div className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-green-500 flex items-center justify-center">
            <RefreshCw size={7} className="text-white" />
          </div>
        )}
      </div>
      {/* Count label */}
      {size >= 30 && (
        <span className={`text-[10px] font-semibold leading-none ${darkMode ? 'text-gray-400' : 'text-stone-500'}`}>
          {count}/{target}
        </span>
      )}
    </button>
  );
};

// MiniHabitRing — tiny display-only ring for date headers
const MiniHabitRing = ({ habit, count = 0, darkMode }) => {
  const size = 16;
  const { type, target, color } = habit;
  const colorObj = HABIT_COLORS.find(c => c.name === color) || HABIT_COLORS[0];
  const radius = 5.5;
  const circumference = 2 * Math.PI * radius;
  const strokeWidth = 2;

  let ringColor, progress;
  if (type === 'doMore') {
    progress = target > 0 ? Math.min(count / target, 1) : 0;
    ringColor = count === 0 ? (darkMode ? '#4b5563' : '#d1d5db') : colorObj.ring;
  } else {
    progress = 1;
    if (count === 0) ringColor = '#22c55e';
    else if (count <= target) ringColor = '#f59e0b';
    else ringColor = '#ef4444';
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90 flex-shrink-0">
      <circle cx={8} cy={8} r={radius} fill="none" strokeWidth={strokeWidth} stroke={darkMode ? '#374151' : '#e5e7eb'} />
      <circle cx={8} cy={8} r={radius} fill="none" strokeWidth={strokeWidth} stroke={ringColor} strokeLinecap="round"
        strokeDasharray={circumference} strokeDashoffset={circumference * (1 - progress)}
      />
    </svg>
  );
};

export { HabitRing, MiniHabitRing };
