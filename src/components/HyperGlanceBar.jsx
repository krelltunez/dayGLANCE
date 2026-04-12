import React from 'react';
import * as Icons from 'lucide-react';
import { Zap } from 'lucide-react';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import { isHGSessionReachable } from '../hooks/useHyperGlance.js';

/**
 * Renders a single hyperGLANCE project bar inside the left half of a
 * timeline day column. When the session is completed it shrinks to a pill.
 */
const HyperGlanceBar = ({ project, date, isCompleted, isOverdue }) => {
  const { minutesToPosition, timeToMinutes, currentTime, darkMode, formatTime, use24HourClock } = useDayPlannerCtx();
  const { enterHyperGlanceMode } = useFeaturesCtx();

  const hg = project.hyperglance;
  const [startH, startM] = (hg.scheduledTime || '0:0').split(':').map(Number);
  const startMinutes = startH * 60 + startM;
  const durationMin = hg.scheduledDuration || 60;
  const endMinutes = startMinutes + durationMin;

  const top = Math.round(minutesToPosition(startMinutes));
  const bottom = Math.round(minutesToPosition(endMinutes));
  const height = Math.max(bottom - top - 1, isCompleted ? 18 : 24);

  const barColor = hg.color || '#4f46e5';
  const IconComp = Icons[hg.icon] || Icons.Sparkles;
  const instance = isCompleted ? null : { date, isOverdue };
  const canEnter = !isCompleted && isHGSessionReachable({ date, isOverdue: false }, hg, currentTime);

  // Format start time label
  const timeLabel = (() => {
    if (!hg.scheduledTime) return '';
    if (use24HourClock) return hg.scheduledTime;
    const hour12 = startH === 0 ? 12 : startH > 12 ? startH - 12 : startH;
    const ampm = startH < 12 ? 'a' : 'p';
    return startM === 0 ? `${hour12}${ampm}` : `${hour12}:${String(startM).padStart(2, '0')}${ampm}`;
  })();

  if (isCompleted) {
    // Render as a small completion pill
    return (
      <div
        className="absolute pointer-events-none"
        style={{ top: `${top}px`, left: 2, right: 2, height: `${height}px`, zIndex: 6 }}
      >
        <div
          className="h-full rounded-full flex items-center justify-center gap-1 opacity-50"
          style={{ backgroundColor: barColor }}
        >
          <Icons.Check size={9} className="text-white flex-shrink-0" />
          <span className="text-white text-[9px] font-medium truncate px-1">{project.title}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="absolute"
      style={{ top: `${top}px`, left: 2, right: 2, height: `${height}px`, zIndex: 6 }}
    >
      <div
        className="h-full rounded-md flex flex-col items-center justify-start overflow-hidden select-none"
        style={{
          backgroundColor: `${barColor}18`,
          borderLeft: `3px solid ${barColor}`,
          borderTop: `1px solid ${barColor}30`,
          borderRight: `1px solid ${barColor}30`,
          borderBottom: `1px solid ${barColor}30`,
        }}
      >
        {/* Icon + time label row */}
        <div className="flex items-center gap-0.5 pt-1 px-1 w-full">
          <IconComp size={12} style={{ color: barColor, flexShrink: 0 }} />
          {height > 30 && timeLabel && (
            <span className="text-[9px] font-medium opacity-70 ml-0.5 truncate" style={{ color: barColor }}>
              {timeLabel}
            </span>
          )}
        </div>

        {/* Project title */}
        {height > 38 && (
          <span
            className="text-[10px] font-semibold leading-tight text-center px-1 w-full truncate"
            style={{ color: barColor }}
          >
            {project.title}
          </span>
        )}

        {/* Overdue badge */}
        {isOverdue && height > 50 && (
          <span className="text-[9px] font-semibold text-orange-500 px-1">overdue</span>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* HG enter button — pulsing when session is live */}
        {canEnter && height > 50 && (
          <button
            onClick={() => enterHyperGlanceMode(project.id, date)}
            className="mb-1.5 flex items-center gap-0.5 px-2 py-0.5 rounded-full text-white text-[9px] font-bold animate-pulse pointer-events-auto"
            style={{ backgroundColor: barColor }}
            title="Enter hyperGLANCE"
          >
            <Zap size={8} />
            HG
          </button>
        )}

        {/* Pre-session: show small HG label (not pulsing) */}
        {!canEnter && !isOverdue && height > 50 && (
          <span
            className="mb-1.5 text-[9px] font-bold opacity-40"
            style={{ color: barColor }}
          >
            HG
          </span>
        )}
      </div>
    </div>
  );
};

export default HyperGlanceBar;
