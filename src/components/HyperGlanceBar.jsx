import React from 'react';
import * as Icons from 'lucide-react';
import { Zap } from 'lucide-react';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import { isHGSessionReachable } from '../hooks/useHyperGlance.js';

/**
 * Renders a single hyperGLANCE project bar inside the left half of a
 * timeline day column. When the session is completed it shrinks to a small pill.
 */
const HyperGlanceBar = ({ project, date, isCompleted, isOverdue }) => {
  const { minutesToPosition, currentTime, use24HourClock, tasks, unscheduledTasks } = useDayPlannerCtx();
  const { enterHyperGlanceMode } = useFeaturesCtx();

  const hg = project.hyperglance;
  const [startH, startM] = (hg.scheduledTime || '0:0').split(':').map(Number);
  const startMinutes = startH * 60 + startM;
  const durationMin = hg.scheduledDuration || 60;
  const endMinutes = startMinutes + durationMin;

  const top = Math.round(minutesToPosition(startMinutes));
  const bottom = Math.round(minutesToPosition(endMinutes));
  const fullHeight = Math.max(bottom - top - 1, 24);

  // Completed pill: ~15 min tall at the start position
  const pillHeight = Math.max(Math.round(minutesToPosition(startMinutes + 15) - minutesToPosition(startMinutes)) - 1, 18);

  const barColor = hg.color || '#4f46e5';
  const IconComp = Icons[hg.icon] || Icons.Sparkles;
  const canEnter = !isCompleted && isHGSessionReachable({ date, isOverdue: false }, hg, currentTime);

  // Incomplete task count for this project (shown on future bars)
  const incompleteTaskCount = [...(tasks || []), ...(unscheduledTasks || [])].filter(
    t => t.projectId === project.id && !t.archived && !t.completed
  ).length;

  const timeLabel = (() => {
    if (!hg.scheduledTime) return '';
    if (use24HourClock) return hg.scheduledTime;
    const hour12 = startH === 0 ? 12 : startH > 12 ? startH - 12 : startH;
    const ampm = startH < 12 ? 'a' : 'p';
    return startM === 0 ? `${hour12}${ampm}` : `${hour12}:${String(startM).padStart(2, '0')}${ampm}`;
  })();

  const taskCountLabel = incompleteTaskCount > 0
    ? `${incompleteTaskCount} task${incompleteTaskCount !== 1 ? 's' : ''}`
    : null;

  if (isCompleted) {
    return (
      <div
        className="absolute pointer-events-none"
        style={{ top: `${top}px`, left: 2, right: 2, height: `${pillHeight}px`, zIndex: 6 }}
      >
        <div
          className="h-full rounded-full flex items-center justify-center gap-1 opacity-60"
          style={{ backgroundColor: barColor }}
        >
          <IconComp size={9} style={{ color: 'white', flexShrink: 0 }} />
          <Icons.Check size={9} className="text-white flex-shrink-0" />
          <span className="text-white text-[9px] font-medium truncate px-1">{project.title}</span>
        </div>
      </div>
    );
  }

  // Large bar: icon centered + big when there's room (≥90px ≈ 60+ min session)
  const isLarge = fullHeight >= 90;

  return (
    <div
      className="absolute"
      style={{ top: `${top}px`, left: 2, right: 2, height: `${fullHeight}px`, zIndex: 6 }}
    >
      <div
        className="h-full rounded-md flex flex-col items-center overflow-hidden select-none"
        style={{
          backgroundColor: `${barColor}18`,
          borderLeft: `3px solid ${barColor}`,
          borderTop: `1px solid ${barColor}30`,
          borderRight: `1px solid ${barColor}30`,
          borderBottom: `1px solid ${barColor}30`,
        }}
      >
        {isLarge ? (
          // Large layout: centered icon + title
          <>
            <div className="flex-1 flex flex-col items-center justify-center gap-1 w-full px-1 pt-2">
              <IconComp size={20} style={{ color: barColor }} />
              {fullHeight > 110 && (
                <span
                  className="text-[10px] font-semibold leading-tight text-center w-full truncate px-1"
                  style={{ color: barColor }}
                >
                  {project.title}
                </span>
              )}
              {isOverdue && (
                <span className="text-[9px] font-semibold text-orange-500">overdue</span>
              )}
            </div>
            {/* CTA at bottom */}
            <div className="flex-shrink-0 pb-2">
              {canEnter ? (
                <button
                  onClick={() => enterHyperGlanceMode(project.id, date)}
                  className="flex items-center gap-0.5 px-2 py-1 rounded-full text-white text-[9px] font-bold animate-pulse pointer-events-auto"
                  style={{ backgroundColor: barColor }}
                  title="Enter hyperGLANCE"
                >
                  <Zap size={8} />
                  hyperGLANCE
                </button>
              ) : !isOverdue ? (
                <span className="text-[9px] font-bold opacity-30" style={{ color: barColor }}>
                  {timeLabel}{taskCountLabel ? ` · ${taskCountLabel}` : ''}
                </span>
              ) : (
                <button
                  onClick={() => enterHyperGlanceMode(project.id, date)}
                  className="flex items-center gap-0.5 px-2 py-0.5 rounded-full text-white text-[9px] font-bold pointer-events-auto opacity-80"
                  style={{ backgroundColor: barColor }}
                >
                  <Zap size={8} />
                  hG
                </button>
              )}
            </div>
          </>
        ) : (
          // Compact layout: icon + time + small label
          <>
            <div className="flex items-center gap-0.5 pt-1 px-1 w-full">
              <IconComp size={12} style={{ color: barColor, flexShrink: 0 }} />
              {fullHeight > 30 && timeLabel && (
                <span className="text-[9px] font-medium opacity-70 ml-0.5 truncate" style={{ color: barColor }}>
                  {timeLabel}{taskCountLabel ? ` · ${taskCountLabel}` : ''}
                </span>
              )}
            </div>
            {fullHeight > 38 && (
              <span
                className="text-[10px] font-semibold leading-tight text-center px-1 w-full truncate"
                style={{ color: barColor }}
              >
                {project.title}
              </span>
            )}
            {isOverdue && fullHeight > 50 && (
              <span className="text-[9px] font-semibold text-orange-500 px-1">overdue</span>
            )}
            <div className="flex-1" />
            {canEnter && fullHeight > 50 && (
              <button
                onClick={() => enterHyperGlanceMode(project.id, date)}
                className="mb-1.5 flex items-center gap-0.5 px-2 py-0.5 rounded-full text-white text-[9px] font-bold animate-pulse pointer-events-auto"
                style={{ backgroundColor: barColor }}
                title="Enter hyperGLANCE"
              >
                <Zap size={8} />
                hG
              </button>
            )}
            {!canEnter && !isOverdue && fullHeight > 50 && (
              <span className="mb-1.5 text-[9px] font-bold opacity-40" style={{ color: barColor }}>hG</span>
            )}
            {isOverdue && !canEnter && fullHeight > 50 && (
              <button
                onClick={() => enterHyperGlanceMode(project.id, date)}
                className="mb-1.5 flex items-center gap-0.5 px-2 py-0.5 rounded-full text-white text-[9px] font-bold pointer-events-auto opacity-80"
                style={{ backgroundColor: barColor }}
              >
                <Zap size={8} />
                hG
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default HyperGlanceBar;
