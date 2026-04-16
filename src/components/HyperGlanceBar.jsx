import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import * as Icons from 'lucide-react';
import { Pencil, Zap } from 'lucide-react';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import { isHGSessionReachable } from '../hooks/useHyperGlance.js';

/**
 * Renders a single hyperGLANCE project bar inside the left half of a
 * timeline day column. When the session is completed it shrinks to a small pill.
 */
const HyperGlanceBar = ({ project, date, isCompleted, isOverdue }) => {
  const { minutesToPosition, currentTime, use24HourClock, tasks, unscheduledTasks, getHourHeight, playUISound, frameResizingRef, setHoverPreviewTime, setHoverPreviewDate } = useDayPlannerCtx();
  const { enterHyperGlanceMode, setHgContextMenu, setPendingEditProjectId, updateProject } = useFeaturesCtx();

  const [showStats, setShowStats] = useState(false);
  const [statsPos, setStatsPos] = useState(null);

  const hg = project.hyperglance;
  const effectiveTime = hg.scheduledTimeOverrides?.[date] || hg.scheduledTime || '0:0';
  const [startH, startM] = effectiveTime.split(':').map(Number);
  const startMinutes = startH * 60 + startM;
  const durationMin = hg.scheduledDurationOverrides?.[date] || hg.scheduledDuration || 60;
  const endMinutes = startMinutes + durationMin;

  const top = Math.round(minutesToPosition(startMinutes));
  const bottom = Math.round(minutesToPosition(endMinutes));
  const fullHeight = Math.max(bottom - top - 1, 24);

  // Completed pill: ~15 min tall at the start position
  const pillHeight = Math.max(Math.round(minutesToPosition(startMinutes + 15) - minutesToPosition(startMinutes)) - 1, 18);

  const barColor = hg.color || '#4f46e5';
  const IconComp = Icons[hg.icon] || Icons.Sparkles;
  const canEnter = !isCompleted && isHGSessionReachable({ date, isOverdue: false }, hg, currentTime);

  const handleResizeStart = (edge, e) => {
    e.preventDefault();
    e.stopPropagation();
    setHoverPreviewTime(null);
    setHoverPreviewDate(null);
    const origStartMinutes = startMinutes;
    const origDuration = durationMin;
    const startY = e.clientY;

    const handleMouseMove = (moveEvent) => {
      frameResizingRef.current = true;
      const hourHeight = getHourHeight();
      const deltaMinutes = Math.round(((moveEvent.clientY - startY) / hourHeight) * 60 / 15) * 15;
      if (edge === 'top') {
        const newStartMinutes = Math.max(0, Math.min(origStartMinutes + origDuration - 15, origStartMinutes + deltaMinutes));
        const newDuration = origStartMinutes + origDuration - newStartMinutes;
        const newH = Math.floor(newStartMinutes / 60);
        const newM = newStartMinutes % 60;
        updateProject(project.id, {
          hyperglance: {
            ...hg,
            scheduledTimeOverrides: { ...(hg.scheduledTimeOverrides || {}), [date]: `${newH}:${newM}` },
            scheduledDurationOverrides: { ...(hg.scheduledDurationOverrides || {}), [date]: newDuration },
          },
        });
      } else {
        const newDuration = Math.max(15, Math.min(1440 - origStartMinutes, origDuration + deltaMinutes));
        updateProject(project.id, {
          hyperglance: {
            ...hg,
            scheduledDurationOverrides: { ...(hg.scheduledDurationOverrides || {}), [date]: newDuration },
          },
        });
      }
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      if (frameResizingRef.current) {
        playUISound('tick');
        setTimeout(() => { frameResizingRef.current = false; }, 0);
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setHgContextMenu({ x: e.clientX, y: e.clientY, projectId: project.id, date, isCompleted });
  };

  // Task count for future bars: incomplete real tasks + template tasks.
  // Only add template count if templates haven't been instantiated yet for this
  // session date — otherwise they're already included in the real task count.
  const allProjectTasks = [...(tasks || []), ...(unscheduledTasks || [])];
  const alreadyInstantiated = allProjectTasks.some(
    t => t.projectId === project.id && t.hyperglanceSessionDate === date
  );
  const incompleteTaskCount =
    allProjectTasks.filter(
      t => t.projectId === project.id && !t.archived && !t.completed
    ).length + (alreadyInstantiated ? 0 : (hg.templateTasks?.length || 0));

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
    const completion = (hg.completions || []).find(c => c.date === date);
    const completedAt = completion?.completedAt;
    const completedTimeLabel = (() => {
      if (!completedAt) return null;
      const d = new Date(completedAt);
      const h = d.getHours(), m = d.getMinutes();
      if (use24HourClock) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      const ampm = h < 12 ? 'am' : 'pm';
      return `${h12}:${String(m).padStart(2, '0')}${ampm}`;
    })();

    const allProjectTasks = [...(tasks || []), ...(unscheduledTasks || [])].filter(
      t => t.projectId === project.id && !t.archived
    );
    const completedTaskCount = allProjectTasks.filter(t => t.completed).length;
    const totalTaskCount = allProjectTasks.length;

    const statsCard = showStats && statsPos && ReactDOM.createPortal(
      <>
        <div className="fixed inset-0 z-[69]" onClick={() => setShowStats(false)} />
        <div
          className="fixed z-[70] rounded-xl shadow-2xl p-3 min-w-[170px] bg-white dark:bg-gray-900 border"
          style={{
            left: Math.min(statsPos.x, window.innerWidth - 190),
            top: Math.min(statsPos.y + 6, window.innerHeight - 120),
            borderColor: `${barColor}50`,
          }}
        >
          <div className="flex items-center gap-1.5 mb-2">
            <IconComp size={14} style={{ color: barColor }} />
            <span className="text-sm font-semibold" style={{ color: barColor }}>{project.title}</span>
          </div>
          {completedTimeLabel && (
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
              Completed at <span className="font-medium text-gray-900 dark:text-white">{completedTimeLabel}</span>
            </div>
          )}
          {totalTaskCount > 0 && (
            <div className="text-xs text-gray-500 dark:text-gray-400">
              Tasks <span className="font-medium text-gray-900 dark:text-white">{completedTaskCount}/{totalTaskCount}</span>
            </div>
          )}
        </div>
      </>,
      document.body
    );

    return (
      <>
        <div
          className="absolute pointer-events-auto"
          style={{ top: `${top}px`, left: 2, right: 2, height: `${pillHeight}px`, zIndex: 6 }}
          onContextMenu={handleContextMenu}
        >
          <div
            className="h-full rounded-full flex items-center gap-0.5 opacity-60 px-2 overflow-hidden"
            style={{ backgroundColor: barColor }}
          >
            <IconComp size={12} style={{ color: 'white', flexShrink: 0 }} />
            <span className="text-white text-xs font-semibold line-through truncate flex-1 min-w-0 ml-0.5">
              {project.title}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                const rect = e.currentTarget.closest('.absolute')?.getBoundingClientRect();
                setStatsPos(rect ? { x: rect.left, y: rect.bottom, width: rect.width } : null);
                setShowStats(s => !s);
              }}
              className="flex-shrink-0 ml-0.5 pointer-events-auto opacity-80 hover:opacity-100"
              title="View session stats"
            >
              <Zap size={10} style={{ color: 'white' }} />
            </button>
          </div>
        </div>
        {statsCard}
      </>
    );
  }

  // Large bar: icon centered + big when there's room (≥90px ≈ 60+ min session)
  const isLarge = fullHeight >= 90;

  return (
    <div
      className="absolute pointer-events-auto"
      style={{ top: `${top}px`, left: 2, right: 2, height: `${fullHeight}px`, zIndex: 6 }}
      onContextMenu={handleContextMenu}
    >
      <div
        className="h-full rounded-md flex flex-col items-center overflow-hidden select-none relative"
        style={{
          backgroundColor: `${barColor}18`,
          borderLeft: `3px solid ${barColor}`,
          borderTop: `1px solid ${barColor}30`,
          borderRight: `1px solid ${barColor}30`,
          borderBottom: `1px solid ${barColor}30`,
        }}
      >
        {/* Resize handles */}
        <div
          className="absolute top-0 left-0 right-0 h-2 cursor-n-resize z-10"
          onMouseDown={(e) => handleResizeStart('top', e)}
        />
        <div
          className="absolute bottom-0 left-0 right-0 h-2 cursor-s-resize z-10"
          onMouseDown={(e) => handleResizeStart('bottom', e)}
        />

        {/* Edit button — top-right corner */}
        <button
          onClick={(e) => { e.stopPropagation(); if (frameResizingRef.current) return; setPendingEditProjectId(project.id); }}
          className="absolute top-0.5 right-0.5 p-0.5 rounded opacity-40 hover:opacity-90 transition-opacity pointer-events-auto z-10"
          title="Edit project"
        >
          <Pencil size={9} style={{ color: barColor }} />
        </button>

        {isLarge ? (
          // Large layout: centered icon + title + CTA, time/tasks pinned to bottom
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
              {canEnter && (
                <button
                  onClick={() => enterHyperGlanceMode(project.id, date)}
                  className="flex items-center gap-0.5 px-2 py-1 rounded-full text-white text-[9px] font-bold animate-pulse pointer-events-auto"
                  style={{ backgroundColor: barColor }}
                  title="Enter hyperGLANCE"
                >
                  <Zap size={8} />
                  hyperGLANCE
                </button>
              )}
              {isOverdue && !canEnter && (
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
            {/* Time + task count always visible at bottom */}
            <div className="flex-shrink-0 pb-2">
              <span className="text-[9px] font-bold opacity-30" style={{ color: barColor }}>
                {timeLabel}{taskCountLabel ? ` · ${taskCountLabel}` : ''}
              </span>
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
