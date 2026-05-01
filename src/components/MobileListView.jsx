import React, {
  useState, useRef, useEffect, useLayoutEffect,
  useMemo, useCallback,
} from 'react';
import {
  Check, ChevronDown, ChevronRight, ChevronUp,
  Clock, Edit2, ExternalLink, FileText, Inbox, SkipForward, Zap,
} from 'lucide-react';
import * as LucideIcons from 'lucide-react';
import { renderTitle, isLinkOnlyTask, getLinkUrl, hasNotesOrSubtasks } from '../utils/textFormatting.jsx';
import { dateToString } from '../utils/taskUtils.js';
import { taskColorToHex } from '../utils/colorUtils.js';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import { getHGBarsForDate, isHGSessionReachable } from '../hooks/useHyperGlance.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const SPINE_COL_W    = 32;   // w-8
const TIME_COL_W     = 56;   // w-14
const CONNECTOR_W    = 16;   // half of spine col — reaches spine centre
const TASK_H         = 72;
const ROUTINE_H      = 38;
const HG_SESSION_H   = TASK_H;
const ALLDAY_H       = 44;

// ─── Spine colour gradient (orange→green→blue, 6 am→noon→6 pm) ───────────────

function lerpColour(a, b, t) {
  return [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * t));
}
const C_ORANGE = [254, 139,   0];
const C_GREEN  = [ 34, 197,  94];
const C_BLUE   = [ 59, 130, 246];

function spineColorAt(timeMin) {
  let rgb;
  if      (timeMin <= 360)  rgb = C_ORANGE;
  else if (timeMin <= 720)  rgb = lerpColour(C_ORANGE, C_GREEN,  (timeMin - 360) / 360);
  else if (timeMin <= 1080) rgb = lerpColour(C_GREEN,  C_BLUE,   (timeMin - 720) / 360);
  else                      rgb = C_BLUE;
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

function dashedGradient(colour) {
  return `repeating-linear-gradient(to bottom,${colour} 0px,${colour} 4px,transparent 4px,transparent 9px)`;
}

// ─── Gap height (px) based on free-time duration ─────────────────────────────

function gapHeight(gapMin) {
  if (gapMin <  15) return 12;
  if (gapMin <  30) return 20;
  if (gapMin <  60) return 32;
  if (gapMin < 120) return 48;
  if (gapMin < 240) return 64;
  return 80;
}

// ─── Duration label ───────────────────────────────────────────────────────────

function durLabel(min) {
  if (!min) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h)      return `${h}h`;
  return `${m}m`;
}

// ─── Format countdown text ────────────────────────────────────────────────────

function countdownText(diffMin) {
  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h)      return `${h}h`;
  return `${m}m`;
}

// ─── SpineMarker ─────────────────────────────────────────────────────────────

function SpineMarker({ kind, completed, colour, pageBg }) {
  const base = {
    width: 16, height: 16, flexShrink: 0, position: 'relative', zIndex: 2,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };

  if (kind === 'routine') {
    return (
      <div style={{ ...base, borderRadius: '50%', background: colour, opacity: completed ? 0.5 : 1 }} />
    );
  }
  if (kind === 'hg-session') {
    return (
      <div style={{ ...base, overflow: 'visible' }}>
        {/* Line extending right from icon centre to Col2/Col3 boundary */}
        <div style={{
          position: 'absolute', left: '50%', top: '50%', marginTop: -1,
          width: CONNECTOR_W, height: 2, background: colour,
          opacity: completed ? 0.4 : 1, zIndex: 1,
        }} />
        <Zap size={18} strokeWidth={2.5}
          style={{ color: colour, opacity: completed ? 0.4 : 1, position: 'relative', zIndex: 2 }}
        />
      </div>
    );
  }
  if (kind === 'calendar-event') {
    return (
      <div style={{ ...base, borderRadius: 2, background: colour }} />
    );
  }
  // task
  return (
    <div
      style={{
        ...base,
        borderRadius: 4,
        border: `2px solid ${colour}`,
        background: completed ? colour : pageBg,
      }}
    >
      {completed && <Check size={9} strokeWidth={3} color="#fff" />}
    </div>
  );
}

// ─── Connector (horizontal line from spine to card) ───────────────────────────

function Connector({ colour }) {
  return (
    <div
      style={{
        position: 'absolute',
        right: '100%',
        width: CONNECTOR_W,
        height: 2,
        top: '50%',
        marginTop: -1,
        background: colour,
        pointerEvents: 'none',
      }}
    />
  );
}

// ─── TaskCard ─────────────────────────────────────────────────────────────────

const TaskCard = React.memo(({
  item, accentHex, isCalendarEvent, darkMode, textPrimary, textSecondary,
  formatTime, minutesToTime, timeToMinutes,
  setExpandedNotesTaskId, postponeTask, moveToInbox, openMobileEditTask,
  dateStr,
}) => {
  const endMin = timeToMinutes(item.startTime) + (item.duration || 30);
  const timeStr = `${formatTime(item.startTime)}–${formatTime(minutesToTime(endMin))} · ${durLabel(item.duration)}`;

  const cardBg   = `${accentHex}30`;
  const barStyle = { width: 4, flexShrink: 0, background: accentHex, borderRadius: '6px 0 0 6px' };
  const cardStyle = {
    display: 'flex', borderRadius: 6, overflow: 'hidden',
    border: `1px solid ${accentHex}44`,
    background: cardBg,
    minHeight: TASK_H,
  };

  const noteIcon = isLinkOnlyTask(item) ? ExternalLink : FileText;
  const NoteIcon = noteIcon;
  const hasNotes = hasNotesOrSubtasks(item) || isLinkOnlyTask(item);

  return (
    <div style={cardStyle}>
      {/* Left colour bar */}
      <div style={barStyle} />
      {/* Text content */}
      <div style={{ flex: 1, minWidth: 0, padding: '7px 0 7px 8px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 3 }}>
        {/* Title */}
        <div
          className={`text-sm font-medium leading-snug ${textPrimary} ${item.completed ? 'line-through opacity-50' : ''}`}
          style={{ overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}
        >
          {renderTitle(item.title)}
        </div>
        {/* Time meta */}
        <div className={`text-[10px] leading-none ${textSecondary}`}>
          {timeStr}
        </div>
      </div>
      {/* Full-height 2×2 action grid (tasks only) */}
      {!isCalendarEvent && (
        <div
          style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr',
            flexShrink: 0, alignSelf: 'stretch', width: 72,
          }}
        >
          {/* Notes */}
          <button
            onClick={e => {
              e.stopPropagation();
              if (isLinkOnlyTask(item)) window.open(getLinkUrl(item), '_blank', 'noopener,noreferrer');
              else setExpandedNotesTaskId(prev => prev === item.id ? null : item.id);
            }}
            className={`flex items-center justify-center transition-colors ${darkMode ? 'hover:bg-white/10 active:bg-white/20' : 'hover:bg-black/10 active:bg-black/15'}`}
            style={{ opacity: hasNotes ? 0.85 : 0.35 }}
            title="Notes / links"
          >
            <NoteIcon size={14} style={{ color: accentHex }} />
          </button>
          {/* Postpone */}
          <button
            onClick={e => { e.stopPropagation(); postponeTask(item.id); }}
            className={`flex items-center justify-center transition-colors ${darkMode ? 'hover:bg-white/10 active:bg-white/20' : 'hover:bg-black/10 active:bg-black/15'}`}
            style={{ opacity: 0.7 }}
            title="Postpone"
          >
            <SkipForward size={14} style={{ color: accentHex }} />
          </button>
          {/* Move to inbox */}
          <button
            onClick={e => { e.stopPropagation(); moveToInbox(item.id, dateStr); }}
            className={`flex items-center justify-center transition-colors ${darkMode ? 'hover:bg-white/10 active:bg-white/20' : 'hover:bg-black/10 active:bg-black/15'}`}
            style={{ opacity: 0.7 }}
            title="Move to inbox"
          >
            <Inbox size={14} style={{ color: accentHex }} />
          </button>
          {/* Edit */}
          <button
            onClick={e => { e.stopPropagation(); openMobileEditTask(item, false); }}
            className={`flex items-center justify-center transition-colors ${darkMode ? 'hover:bg-white/10 active:bg-white/20' : 'hover:bg-black/10 active:bg-black/15'}`}
            style={{ opacity: 0.7 }}
            title="Edit"
          >
            <Edit2 size={14} style={{ color: accentHex }} />
          </button>
        </div>
      )}
    </div>
  );
});
TaskCard.displayName = 'TaskCard';

// ─── RoutineChip ──────────────────────────────────────────────────────────────

function RoutineChip({ routine, completed, onToggle, darkMode }) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onToggle(routine.id); }}
      className={`flex items-center gap-1.5 px-3 rounded-full text-xs font-medium transition-colors
        ${darkMode ? 'bg-teal-700 text-teal-100 active:bg-teal-600' : 'bg-teal-600 text-white active:bg-teal-700'}
        ${completed ? 'opacity-50 line-through' : ''}`}
      style={{ height: ROUTINE_H, maxWidth: '100%' }}
    >
      <span className="truncate">{routine.name}</span>
      {routine.duration ? (
        <span className="opacity-60 flex-shrink-0 text-[10px]">{durLabel(routine.duration)}</span>
      ) : null}
    </button>
  );
}

// ─── HGSessionCard ────────────────────────────────────────────────────────────

const HGSessionCard = React.memo(({
  bar, accentHex, darkMode, textPrimary, textSecondary,
  formatTime, canEnter, incompleteTaskCount,
  enterHyperGlanceMode, setPendingEditProjectId,
}) => {
  const { project, date, isCompleted, isOverdue } = bar;
  const hg = project.hyperglance;
  const IconComp = LucideIcons[hg.icon] || LucideIcons.Sparkles;

  const effectiveTime = hg.scheduledTimeOverrides?.[date] || hg.scheduledTime || '0:0';
  const [startH, startM] = effectiveTime.split(':').map(Number);
  const durationMin = hg.scheduledDurationOverrides?.[date] || hg.scheduledDuration || 60;
  const normalizedTime = `${String(startH).padStart(2, '0')}:${String(startM || 0).padStart(2, '0')}`;
  const endH = Math.floor((startH * 60 + (startM || 0) + durationMin) / 60);
  const endM = (startH * 60 + (startM || 0) + durationMin) % 60;
  const endTime = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
  const timeStr = `${formatTime(normalizedTime)}–${formatTime(endTime)}`;
  const taskLabel = incompleteTaskCount > 0
    ? `${incompleteTaskCount} task${incompleteTaskCount !== 1 ? 's' : ''}`
    : null;

  const cardStyle = {
    display: 'flex', borderRadius: 6, overflow: 'hidden',
    border: `1px solid ${accentHex}44`,
    background: `${accentHex}18`,
    minHeight: HG_SESSION_H,
    opacity: isCompleted ? 0.65 : 1,
  };
  const barStyle = { width: 4, flexShrink: 0, background: accentHex, borderRadius: '6px 0 0 6px' };

  const hgButton = isCompleted ? (
    <span className="text-[10px] font-semibold opacity-50" style={{ color: accentHex }}>✓</span>
  ) : canEnter ? (
    <button
      onClick={e => { e.stopPropagation(); enterHyperGlanceMode(project.id, date); }}
      className="flex items-center gap-0.5 px-2 py-1 rounded-full text-white text-[10px] font-bold animate-pulse"
      style={{ background: accentHex }}
    >
      <Zap size={10} />hG
    </button>
  ) : isOverdue ? (
    <button
      onClick={e => { e.stopPropagation(); enterHyperGlanceMode(project.id, date); }}
      className="flex items-center gap-0.5 px-2 py-1 rounded-full text-white text-[10px] font-bold opacity-80"
      style={{ background: accentHex }}
    >
      <Zap size={10} />Start
    </button>
  ) : (
    <span className="text-[10px] font-bold opacity-30" style={{ color: accentHex }}>hG</span>
  );

  return (
    <div style={cardStyle}>
      <div style={barStyle} />
      {/* Left: icon + title, then time meta */}
      <div style={{ flex: 1, minWidth: 0, padding: '7px 0 7px 8px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 3 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <IconComp size={16} style={{ color: accentHex, flexShrink: 0 }} />
          <span
            className={`text-sm font-semibold flex-1 min-w-0 truncate ${isCompleted ? 'line-through opacity-60' : ''}`}
            style={{ color: accentHex }}
          >
            {project.title}
          </span>
        </div>
        <div className={`text-[10px] leading-none ${textSecondary}`}>
          {timeStr}
          {taskLabel && <span className="ml-1.5">· {taskLabel}</span>}
          {isOverdue && <span className="ml-1.5 text-orange-500 font-semibold">overdue</span>}
        </div>
      </div>
      {/* Right column: pencil (top) + hG control (bottom) — mirrors task card action grid */}
      <div style={{ display: 'grid', gridTemplateRows: '1fr 1fr', flexShrink: 0, alignSelf: 'stretch', width: 72 }}>
        <button
          onClick={e => { e.stopPropagation(); setPendingEditProjectId(project.id); }}
          className={`flex items-center justify-center transition-colors ${darkMode ? 'hover:bg-white/10 active:bg-white/20' : 'hover:bg-black/10 active:bg-black/15'}`}
          title="Edit project"
        >
          <Edit2 size={14} style={{ color: accentHex, opacity: 0.7 }} />
        </button>
        <div className="flex items-center justify-center">
          {hgButton}
        </div>
      </div>
    </div>
  );
});
HGSessionCard.displayName = 'HGSessionCard';

// ─── Row wrapper (3 columns) ──────────────────────────────────────────────────

function Row({ timeLabel, timeColour, spineColour, spineStyle, marker, cardHeight, accentHex, children, isNow, pageBg, onMarkerClick, noConnector }) {
  return (
    <div style={{ display: 'flex', minHeight: cardHeight }}>
      {/* Col 1 — time */}
      <div
        style={{
          width: TIME_COL_W, flexShrink: 0,
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
          paddingRight: 8, textAlign: 'right',
        }}
      >
        {timeLabel && (
          <span
            className="text-[10px] font-semibold leading-none"
            style={{ color: timeColour || spineColour }}
          >
            {timeLabel}
          </span>
        )}
        {isNow && <Clock size={11} style={{ color: timeColour, marginLeft: 'auto', marginTop: 2 }} />}
      </div>

      {/* Col 2 — spine marker; tappable for completion when onMarkerClick is provided */}
      <div
        style={{ width: SPINE_COL_W, flexShrink: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: onMarkerClick ? 'pointer' : undefined }}
        onClick={onMarkerClick}
      >
        {marker}
      </div>

      {/* Col 3 — card area */}
      <div style={{ flex: 1, minWidth: 0, position: 'relative', paddingRight: 8 }}>
        {accentHex && !noConnector && <Connector colour={accentHex} />}
        {children}
      </div>
    </div>
  );
}

// ─── GapRow ───────────────────────────────────────────────────────────────────

function GapRow({ fromMin, toMin, spineColour, textSecondary, formatTime, minutesToTime, dragTargetMin, dragBlocked, darkMode, pageBg }) {
  const h = gapHeight(toMin - fromMin);
  const showLabel = (toMin - fromMin) >= 45;
  const isTarget = dragTargetMin !== null && dragTargetMin >= fromMin && dragTargetMin < toMin;

  return (
    <div
      data-gap-from={fromMin}
      data-gap-to={toMin}
      style={{ display: 'flex', height: h }}
    >
      {/* Time col */}
      <div style={{ width: TIME_COL_W, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 8 }}>
        {showLabel && (
          <span className={`text-[9px] leading-none ${textSecondary}`} style={{ opacity: 0.5 }}>
            {formatTime(minutesToTime(fromMin))}
          </span>
        )}
      </div>
      {/* Spine col */}
      <div style={{ width: SPINE_COL_W, flexShrink: 0, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {/* Long gaps (≥30 min): cover solid spine then overlay dashes to show free time */}
        {(toMin - fromMin) >= 30 && pageBg && (
          <>
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', marginLeft: -1, width: 2, background: pageBg, zIndex: 1, pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', marginLeft: -1, width: 2, background: dashedGradient(spineColour), zIndex: 2, pointerEvents: 'none' }} />
          </>
        )}
        {/* Drag preview indicator on spine */}
        {isTarget && (
          <div
            style={{
              position: 'absolute', top: '50%', transform: 'translateY(-50%)',
              left: '50%', marginLeft: -8,
              width: 16, height: 16, borderRadius: '50%',
              background: dragBlocked ? '#ef4444' : '#22c55e',
              border: '2px solid white',
              zIndex: 3,
            }}
          />
        )}
      </div>
      {/* Content col */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', paddingLeft: 4 }}>
        {isTarget ? (
          <span
            className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
            style={{
              background: dragBlocked ? (darkMode ? '#7f1d1d' : '#fee2e2') : (darkMode ? '#14532d' : '#dcfce7'),
              color: dragBlocked ? (darkMode ? '#fca5a5' : '#991b1b') : (darkMode ? '#86efac' : '#166534'),
            }}
          >
            {dragBlocked ? 'Blocked' : formatTime(minutesToTime(dragTargetMin))}
          </span>
        ) : (
          showLabel && (toMin - fromMin) >= 60 && (
            <span className={`text-[10px] ${textSecondary}`} style={{ opacity: 0.35 }}>
              {durLabel(toMin - fromMin)} free
            </span>
          )
        )}
      </div>
    </div>
  );
}

// ─── NowRow ───────────────────────────────────────────────────────────────────

function NowRow({ nowMin, nextItem, formatTime, textSecondary, darkMode, use24HourClock, pageBg }) {
  const nowLabel = (() => {
    const h = Math.floor(nowMin / 60);
    const m = nowMin % 60;
    const pad = v => String(v).padStart(2, '0');
    if (use24HourClock) return `${pad(h)}:${pad(m)}`;
    const period = h >= 12 ? 'p' : 'a';
    const h12 = h % 12 || 12;
    return `${h12}:${pad(m)}${period}`;
  })();

  const diff = nextItem ? timeToMinutes_pure(nextItem.startTime) - nowMin : null;
  const rawTitle = nextItem?.title || nextItem?.name || nextItem?.label || '';
  const cleanTitle = rawTitle.replace(/#\S+/g, '').replace(/\s+/g, ' ').trim();
  const countdownStr = diff !== null && diff > 0
    ? `${countdownText(diff)} until ${cleanTitle}`
    : 'Nothing planned';

  return (
    <div style={{ display: 'flex', minHeight: 40, alignItems: 'center' }}>
      {/* Time col */}
      <div style={{ width: TIME_COL_W, flexShrink: 0, paddingRight: 8, textAlign: 'right', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
        <span className="text-[11px] font-bold" style={{ color: '#ef4444' }}>{nowLabel}</span>
      </div>
      {/* Spine col: background spine handles the line; just render the marker */}
      <div style={{ width: SPINE_COL_W, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 16, height: 16, borderRadius: '50%', background: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', zIndex: 2 }}>
          <Clock size={9} color="#fff" />
        </div>
      </div>
      {/* Countdown */}
      <div style={{ flex: 1, minWidth: 0, paddingLeft: 4, paddingRight: 8 }}>
        <span
          className="text-xs font-medium"
          style={{ color: darkMode ? '#fca5a5' : '#991b1b' }}
        >
          {countdownStr}
        </span>
      </div>
    </div>
  );
}

// Pure helper (no hook) so NowRow can call it
function timeToMinutes_pure(t) {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

// ─── AllDayCard ───────────────────────────────────────────────────────────────

function AllDayCard({ item, accentHex, darkMode, textPrimary, toggleComplete }) {
  return (
    <div
      style={{
        display: 'flex', borderRadius: 6, overflow: 'hidden', minHeight: ALLDAY_H,
        border: `1px solid ${accentHex}44`, background: `${accentHex}28`,
      }}
    >
      <div style={{ width: 4, flexShrink: 0, background: accentHex, borderRadius: '6px 0 0 6px' }} />
      <div style={{ flex: 1, minWidth: 0, padding: '6px 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
        <button
          onClick={e => { e.stopPropagation(); toggleComplete(item.id); }}
          style={{
            flexShrink: 0, width: 16, height: 16, borderRadius: '50%',
            border: `2px solid ${accentHex}`,
            background: item.completed ? accentHex : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {item.completed && <Check size={8} strokeWidth={3} color="#fff" />}
        </button>
        <span className={`text-sm font-medium truncate ${textPrimary} ${item.completed ? 'line-through opacity-50' : ''}`}>
          {renderTitle(item.title)}
        </span>
      </div>
    </div>
  );
}

// ─── MobileListView ───────────────────────────────────────────────────────────

const MobileListView = () => {
  const {
    selectedDate, currentTime,
    tasks, setTasks, unscheduledTasks, setUnscheduledTasks,
    expandedRecurringTasks,
    calendarRef, use24HourClock,
    darkMode, cardBg, borderClass, textPrimary, textSecondary,
    formatTime, timeToMinutes, minutesToTime,
    getTasksForDate, getTaskCalendarStyle,
    toggleComplete, postponeTask, moveToInbox, openMobileEditTask,
    setExpandedNotesTaskId,
    pushUndo, playUISound,
  } = useDayPlannerCtx();

  const {
    routinesEnabled, todayRoutines, routineCompletions, toggleRoutineCompletion,
    projects, enterHyperGlanceMode, setPendingEditProjectId,
  } = useFeaturesCtx();

  // ── State ──────────────────────────────────────────────────────────────────
  const [showPast, setShowPast]       = useState(false);
  const [inboxOpen, setInboxOpen]     = useState(false);
  const [inboxPinned, setInboxPinned] = useState(false);
  const [dragTargetMin, setDragTargetMin] = useState(null);
  const [dragBlocked, setDragBlocked] = useState(false);
  const [activeDragTask, setActiveDragTask] = useState(null);
  const [inboxHandleTop, setInboxHandleTop] = useState(160);

  const nowRowRef  = useRef(null);
  const dragRef    = useRef({ active: false, task: null, startX: 0, startY: 0 });

  // ── Derived ────────────────────────────────────────────────────────────────
  const dateStr = dateToString(selectedDate);
  const isToday = dateStr === dateToString(new Date());
  const nowMin  = currentTime.getHours() * 60 + currentTime.getMinutes();

  const allDayItems = useMemo(() =>
    getTasksForDate(selectedDate).filter(t => t.isAllDay && !t.isExample),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedDate, tasks, expandedRecurringTasks],
  );

  const scheduledTasks = useMemo(() =>
    getTasksForDate(selectedDate).filter(t => !t.isAllDay && !t.isExample),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedDate, tasks, expandedRecurringTasks],
  );

  const scheduledRoutines = useMemo(() =>
    routinesEnabled && isToday
      ? todayRoutines.filter(r => r.startTime && !r.isAllDay && !String(r.id).startsWith('example-'))
      : [],
    [routinesEnabled, isToday, todayRoutines],
  );

  const hgBars = useMemo(() => {
    const nowMin = isToday ? currentTime.getHours() * 60 + currentTime.getMinutes() : undefined;
    return getHGBarsForDate(projects || [], dateStr, nowMin);
  }, [projects, dateStr, isToday, currentTime]);

  // Combine and sort all scheduled items
  const allItems = useMemo(() => {
    const items = [
      ...scheduledTasks.map(t => ({ ...t, _kind: t.imported && !t.isTaskCalendar ? 'calendar-event' : 'task' })),
      ...scheduledRoutines.map(r => ({ ...r, _kind: 'routine', _routineId: r.id, id: `routine-${r.id}`, title: r.name, startTime: r.startTime })),
      ...hgBars.map(bar => {
        const hg = bar.project.hyperglance;
        const rawTime = hg.scheduledTimeOverrides?.[bar.date] || hg.scheduledTime || '0:0';
        const [h, m] = rawTime.split(':').map(Number);
        const normalizedTime = `${String(h).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}`;
        const duration = hg.scheduledDurationOverrides?.[bar.date] || hg.scheduledDuration || 60;
        return { ...bar, _kind: 'hg-session', id: `hg-${bar.project.id}`, startTime: normalizedTime, duration };
      }),
    ];
    return items.sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
  }, [scheduledTasks, scheduledRoutines, hgBars, timeToMinutes]);

  const isItemPast = useCallback((item) => {
    if (!isToday) return false;
    const endMin = timeToMinutes(item.startTime) + (item.duration || 30);
    return endMin <= nowMin;
  }, [isToday, nowMin, timeToMinutes]);

  const pastItems   = useMemo(() => allItems.filter(isItemPast),   [allItems, isItemPast]);
  const futureItems = useMemo(() => allItems.filter(i => !isItemPast(i)), [allItems, isItemPast]);
  const visibleItems = showPast ? allItems : futureItems;

  // Item currently in progress (overlaps nowMin)
  const inProgressItem = useMemo(() => {
    if (!isToday) return null;
    return allItems.find(item => {
      const s = timeToMinutes(item.startTime);
      return nowMin >= s && nowMin < s + (item.duration || 30);
    });
  }, [allItems, isToday, nowMin, timeToMinutes]);

  // Next non-completed item starting after now
  const nextItem = useMemo(() => {
    return futureItems.find(i => {
      if (timeToMinutes(i.startTime) <= nowMin) return false; // skip in-progress
      if (i._kind === 'routine')        return !routineCompletions[i._routineId];
      if (i._kind === 'frame')          return true;
      if (i._kind === 'calendar-event') return true;
      return !i.completed;
    });
  }, [futureItems, routineCompletions, nowMin, timeToMinutes]);

  // Inbox tasks
  const inboxTasks = useMemo(() =>
    unscheduledTasks.filter(t => !t.isExample && !t.completed),
    [unscheduledTasks],
  );

  // ── Conflict helpers ───────────────────────────────────────────────────────
  const isBlockedByRoutine = useCallback((startMin, durMin) => {
    const endMin = startMin + durMin;
    return scheduledRoutines.some(r => {
      const s = timeToMinutes(r.startTime);
      const e = s + (r.duration || 30);
      return startMin < e && endMin > s;
    });
  }, [scheduledRoutines, timeToMinutes]);

  const getSnapMin = useCallback((rawMin, durMin) => {
    const base = Math.round(rawMin / 15) * 15;
    for (let d = 0; d <= 24 * 60; d += 15) {
      const fwd = base + d;
      if (fwd >= 0 && fwd + durMin <= 24 * 60 && !isBlockedByRoutine(fwd, durMin)) return fwd;
      if (d > 0) {
        const bck = base - d;
        if (bck >= 0 && !isBlockedByRoutine(bck, durMin)) return bck;
      }
    }
    return base;
  }, [isBlockedByRoutine]);

  // ── Drag handlers ──────────────────────────────────────────────────────────
  const handleInboxTouchStart = useCallback((e, task) => {
    const t = e.touches[0];
    dragRef.current = { active: false, task, startX: t.clientX, startY: t.clientY };
  }, []);

  const handleInboxTouchMove = useCallback((e) => {
    const state = dragRef.current;
    if (!state.task) return;
    const t = e.touches[0];
    const dx = t.clientX - state.startX;
    const dy = t.clientY - state.startY;

    if (!state.active && Math.sqrt(dx * dx + dy * dy) > 8) {
      state.active = true;
      setActiveDragTask(state.task);
      setInboxPinned(true);
    }
    if (!state.active) return;
    e.preventDefault();

    // Find which gap segment the finger is over
    const el = document.elementFromPoint(t.clientX, t.clientY);
    const gapEl = el?.closest('[data-gap-from]');
    if (gapEl) {
      const rect = gapEl.getBoundingClientRect();
      const fromMin = parseInt(gapEl.dataset.gapFrom, 10);
      const toMin   = parseInt(gapEl.dataset.gapTo, 10);
      const frac    = Math.max(0, Math.min(1, (t.clientY - rect.top) / rect.height));
      const rawMin  = fromMin + frac * (toMin - fromMin);
      const durMin  = state.task.duration || 30;
      const snapped = getSnapMin(rawMin, durMin);
      setDragTargetMin(snapped);
      setDragBlocked(isBlockedByRoutine(snapped, durMin));
    } else {
      setDragTargetMin(null);
      setDragBlocked(false);
    }
  }, [getSnapMin, isBlockedByRoutine]);

  const handleInboxTouchEnd = useCallback(() => {
    const state = dragRef.current;
    if (state.active && dragTargetMin !== null && !dragBlocked) {
      pushUndo();
      setTasks(prev => [...prev, {
        ...state.task,
        date: dateStr,
        startTime: minutesToTime(dragTargetMin),
        duration: state.task.duration || 30,
        color: state.task.color || 'bg-blue-500',
        isAllDay: false,
      }]);
      setUnscheduledTasks(prev => prev.filter(t => t.id !== state.task.id));
      playUISound('pop');
    }
    dragRef.current = { active: false, task: null };
    setActiveDragTask(null);
    setInboxPinned(false);
    setDragTargetMin(null);
    setDragBlocked(false);
    if (!inboxOpen) setInboxOpen(false);
  }, [dragTargetMin, dragBlocked, minutesToTime, dateStr, pushUndo,
      setTasks, setUnscheduledTasks, playUISound, inboxOpen]);

  // ── Scroll to "now" on mount / date change ─────────────────────────────────
  useEffect(() => {
    if (!isToday || !nowRowRef.current || !calendarRef?.current) return;
    const timer = setTimeout(() => {
      const container = calendarRef.current;
      const nowEl     = nowRowRef.current;
      if (!container || !nowEl) return;
      const cRect  = container.getBoundingClientRect();
      const nRect  = nowEl.getBoundingClientRect();
      const target = container.scrollTop + (nRect.top - cRect.top) - 32;
      container.scrollTo({ top: Math.max(0, target), behavior: 'auto' });
    }, 60);
    return () => clearTimeout(timer);
  }, [dateStr, isToday, calendarRef]);

  // ── Keep inbox handle anchored to the bottom of the sticky header ──────────
  // calendarRef's first child is the sticky header group (date row + optional
  // "Now" banner). Measuring its bottom edge keeps the handle correctly aligned
  // regardless of whether the banner is visible or not.
  useLayoutEffect(() => {
    const el = calendarRef?.current;
    if (!el) return;
    const stickyHeader = el.firstElementChild;
    if (!stickyHeader) return;
    // Use container top + header offsetHeight — avoids sticky-positioning quirks
    // in getBoundingClientRect() that caused incorrect viewport-relative values.
    const update = () => setInboxHandleTop(el.getBoundingClientRect().top + stickyHeader.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(stickyHeader);
    ro.observe(el);
    window.addEventListener('resize', update);
    return () => { ro.disconnect(); window.removeEventListener('resize', update); };
  }, [calendarRef]);

  // ── Segment builder ────────────────────────────────────────────────────────
  const segments = useMemo(() => {
    const segs = [];
    const items = visibleItems;
    if (items.length === 0) return segs;

    // Start time of first item (or nowMin for today)
    let cursor = isToday ? Math.min(nowMin, timeToMinutes(items[0]?.startTime ?? '00:00')) : timeToMinutes(items[0]?.startTime ?? '00:00');

    items.forEach((item, idx) => {
      const startMin = timeToMinutes(item.startTime);
      const durMin   = item.duration || 30;
      const endMin   = startMin + durMin;

      // Gap before this item
      const gapMin = startMin - cursor;
      if (gapMin >= 5) {
        segs.push({ type: 'gap', id: `gap-${idx}`, fromMin: cursor, toMin: startMin });
      }

      segs.push({ type: 'item', id: item.id, item, startMin, endMin });
      cursor = Math.max(cursor, endMin);
    });

    // Trailing gap so last item isn't at very bottom
    segs.push({ type: 'gap', id: 'gap-trail', fromMin: cursor, toMin: cursor + 30 });
    return segs;
  }, [visibleItems, isToday, nowMin, timeToMinutes]);

  // Page background colour — used behind markers (checkbox fill) and long-gap dashed overlays
  const pageBg = darkMode ? '#1f2937' : '#ffffff';

  // Single continuous background spine gradient covering the visible time range
  const bgSpineGradient = useMemo(() => {
    const startMin = isToday
      ? Math.min(nowMin, segments[0]?.fromMin ?? segments[0]?.startMin ?? nowMin)
      : (segments[0]?.fromMin ?? segments[0]?.startMin ?? 0);
    const lastSeg = segments[segments.length - 1];
    const endMin = lastSeg?.toMin ?? lastSeg?.endMin ?? (startMin + 120);
    const range = Math.max(endMin - startMin, 1);
    const stops = [0, 0.25, 0.5, 0.75, 1].map(t => {
      const min = startMin + t * range;
      return `${spineColorAt(min)} ${(t * 100).toFixed(0)}%`;
    });
    return `linear-gradient(to bottom, ${stops.join(', ')})`;
  }, [segments, isToday, nowMin]);

  // Compute the y-offset (px from timed-body top) of each spine marker so we can
  // build a CSS mask that genuinely fades the spine to transparent at those positions.
  const spineMarkerYs = useMemo(() => {
    let y = 0;
    const ys = [];
    if (isToday && !inProgressItem) {
      y += 16;           // height-16 padding div
      ys.push(y + 20);  // NowRow minHeight=40, marker at vertical centre
      y += 40;
      if (visibleItems.length > 0) y += 12; // height-12 padding div
    }
    segments.forEach(seg => {
      if (seg.type === 'gap') {
        y += gapHeight(seg.toMin - seg.fromMin);
      } else {
        const cardH = seg.item._kind === 'routine'    ? ROUTINE_H
                    : seg.item._kind === 'hg-session' ? HG_SESSION_H
                    : TASK_H;
        const rowH = cardH + 8; // 4px marginTop + 4px marginBottom on card wrapper
        ys.push(y + rowH / 2);
        y += rowH;
      }
    });
    return ys;
  }, [segments, isToday, inProgressItem, visibleItems]);

  // CSS mask: spine fades to transparent BEFORE each marker's top edge, holds
  // invisible through the marker, then fades back after the marker's bottom edge.
  const bgSpineMask = useMemo(() => {
    if (spineMarkerYs.length === 0) return undefined;
    const MARKER_R  = 8;  // half of 16px marker height
    const PRE_FADE  = 12; // fade-out distance ending at marker top edge
    const POST_FADE = 12; // fade-in distance starting at marker bottom edge
    const stops = ['black 0px'];
    let prev = 0;
    spineMarkerYs.forEach(cy => {
      const fadeOutStart = cy - MARKER_R - PRE_FADE;  // where spine starts fading
      const fadeOutEnd   = cy - MARKER_R;              // fully transparent by here
      const fadeInStart  = cy + MARKER_R;              // starts returning after marker
      const fadeInEnd    = cy + MARKER_R + POST_FADE;  // back to opaque
      if (fadeOutStart > prev) stops.push(`black ${fadeOutStart}px`);
      stops.push(`transparent ${fadeOutEnd}px`);
      stops.push(`transparent ${fadeInStart}px`);
      stops.push(`black ${fadeInEnd}px`);
      prev = fadeInEnd;
    });
    stops.push('black 9999px');
    return `linear-gradient(to bottom, ${stops.join(', ')})`;
  }, [spineMarkerYs]);

  // ── Render helpers ─────────────────────────────────────────────────────────
  const getAccentHex = (item) => {
    if (item._kind === 'calendar-event') {
      const s = getTaskCalendarStyle(item, darkMode);
      return s?.backgroundColor || '#6b7280';
    }
    if (item._kind === 'routine')    return darkMode ? '#14b8a6' : '#0d9488';
    if (item._kind === 'hg-session') return item.project.hyperglance.color || '#4f46e5';
    return taskColorToHex(item.color) || '#3b82f6';
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── All-day section ── */}
      {allDayItems.length > 0 && (
        <div className={`border-b ${borderClass} px-2 py-2 flex flex-col gap-1.5`}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
            <div style={{ width: TIME_COL_W, flexShrink: 0, textAlign: 'right', paddingRight: 8 }}>
              <span className={`text-[9px] font-bold uppercase tracking-widest ${textSecondary}`}>All day</span>
            </div>
            <div style={{ flex: 1 }} />
          </div>
          {allDayItems.map(item => {
            const hex = taskColorToHex(item.color) || '#3b82f6';
            return (
              <div key={item.id} style={{ display: 'flex' }}>
                <div style={{ width: TIME_COL_W + SPINE_COL_W, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                  <AllDayCard item={item} accentHex={hex} darkMode={darkMode} textPrimary={textPrimary} toggleComplete={toggleComplete} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Expand-past row ── */}
      {isToday && pastItems.length > 0 && (
        <button
          onClick={() => setShowPast(v => !v)}
          className={`w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium ${textSecondary} border-b ${borderClass} ${darkMode ? 'hover:bg-white/5 active:bg-white/10' : 'hover:bg-black/5 active:bg-black/8'} transition-colors`}
        >
          {showPast ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          {showPast ? 'Hide earlier items' : `Show ${pastItems.length} earlier item${pastItems.length !== 1 ? 's' : ''}`}
        </button>
      )}

      {/* ── Timed body — single continuous background spine ── */}
      <div style={{ position: 'relative' }}>
        {/* One unbroken spine line behind all rows */}
        {(visibleItems.length > 0 || (isToday && !inProgressItem)) && (
          <div
            style={{
              position: 'absolute', top: 0, bottom: 0, zIndex: 0, pointerEvents: 'none',
              left: TIME_COL_W + SPINE_COL_W / 2 - 1,
              width: 2,
              background: bgSpineGradient,
              ...(bgSpineMask ? { WebkitMaskImage: bgSpineMask, maskImage: bgSpineMask } : {}),
            }}
          />
        )}

        {/* Padding above "now" */}
        {isToday && !inProgressItem && <div style={{ height: 16 }} />}

        {/* Now row */}
        {isToday && !inProgressItem && (
          <div ref={nowRowRef}>
            <NowRow
              nowMin={nowMin}
              nextItem={nextItem}
              formatTime={formatTime}
              textSecondary={textSecondary}
              darkMode={darkMode}
              use24HourClock={use24HourClock}
              pageBg={pageBg}
            />
          </div>
        )}

        {/* Padding below "now" */}
        {isToday && !inProgressItem && visibleItems.length > 0 && <div style={{ height: 12 }} />}

        {/* Empty state */}
        {visibleItems.length === 0 && (
          <div className={`flex flex-col items-center justify-center py-16 ${textSecondary}`}>
            <p className="text-sm">No items scheduled</p>
            {isToday && <p className="text-xs mt-1 opacity-60">Tap + to add a task</p>}
          </div>
        )}

        {/* Segment list */}
        {segments.map(seg => {
        if (seg.type === 'gap') {
          const midMin = Math.round((seg.fromMin + seg.toMin) / 2);
          return (
            <GapRow
              key={seg.id}
              fromMin={seg.fromMin}
              toMin={seg.toMin}
              spineColour={spineColorAt(midMin)}
              textSecondary={textSecondary}
              formatTime={formatTime}
              minutesToTime={minutesToTime}
              dragTargetMin={dragTargetMin}
              dragBlocked={dragBlocked}
              darkMode={darkMode}
              pageBg={pageBg}
            />
          );
        }

        if (seg.type === 'item') {
          const { item, startMin } = seg;
          const accentHex = getAccentHex(item);
          const sc = spineColorAt(startMin);

          if (item._kind === 'routine') {
            const completed = !!routineCompletions[item._routineId];
            return (
              <Row
                key={seg.id}
                timeLabel={formatTime(item.startTime)}
                spineColour={sc}
                spineStyle="solid"
                marker={<SpineMarker kind="routine" colour="#14b8a6" completed={completed} pageBg={pageBg} />}
                cardHeight={ROUTINE_H}
                accentHex="#14b8a6"
                pageBg={pageBg}
              >
                <div style={{ marginTop: 4, marginBottom: 4 }}>
                  <RoutineChip
                    routine={item}
                    completed={completed}
                    onToggle={toggleRoutineCompletion}
                    darkMode={darkMode}
                  />
                </div>
              </Row>
            );
          }

          if (item._kind === 'hg-session') {
            const hg = item.project.hyperglance;
            const allProjectTasks = [...(tasks || []), ...(unscheduledTasks || [])];
            const alreadyInstantiated = allProjectTasks.some(
              t => t.projectId === item.project.id && t.hyperglanceSessionDate === item.date,
            );
            const incompleteTaskCount =
              allProjectTasks.filter(t => t.projectId === item.project.id && !t.archived && !t.completed).length
              + (alreadyInstantiated ? 0 : (hg.templateTasks?.length || 0));
            const canEnter = !item.isCompleted && isHGSessionReachable(
              { date: item.date, isOverdue: item.isOverdue },
              hg, currentTime,
            );
            const isPast = isItemPast(item);
            return (
              <Row
                key={seg.id}
                timeLabel={formatTime(item.startTime)}
                spineColour={sc}
                spineStyle="solid"
                marker={<SpineMarker kind="hg-session" colour={accentHex} completed={item.isCompleted} pageBg={pageBg} />}
                cardHeight={HG_SESSION_H}
                accentHex={accentHex}
                pageBg={pageBg}
                noConnector
              >
                <div style={{ opacity: isPast && !item.isCompleted ? 0.5 : 1, marginTop: 4, marginBottom: 4 }}>
                  <HGSessionCard
                    bar={item}
                    accentHex={accentHex}
                    darkMode={darkMode}
                    textPrimary={textPrimary}
                    textSecondary={textSecondary}
                    formatTime={formatTime}
                    canEnter={canEnter}
                    incompleteTaskCount={incompleteTaskCount}
                    enterHyperGlanceMode={enterHyperGlanceMode}
                    setPendingEditProjectId={setPendingEditProjectId}
                  />
                </div>
              </Row>
            );
          }

          // task or calendar-event
          const isCalendarEvent = item._kind === 'calendar-event';
          const isPast = isItemPast(item);
          return (
            <Row
              key={seg.id}
              timeLabel={formatTime(item.startTime)}
              spineColour={sc}
              spineStyle="solid"
              marker={
                <SpineMarker
                  kind={isCalendarEvent ? 'calendar-event' : 'task'}
                  completed={item.completed}
                  colour={accentHex}
                  pageBg={pageBg}
                />
              }
              cardHeight={TASK_H}
              accentHex={accentHex}
              pageBg={pageBg}
              onMarkerClick={isCalendarEvent ? undefined : e => { e.stopPropagation(); toggleComplete(item.id); }}
            >
              <div style={{ opacity: isPast ? 0.5 : 1, marginTop: 4, marginBottom: 4 }}>
                <TaskCard
                  item={item}
                  accentHex={accentHex}
                  isCalendarEvent={isCalendarEvent}
                  darkMode={darkMode}
                  textPrimary={textPrimary}
                  textSecondary={textSecondary}
                  formatTime={formatTime}
                  minutesToTime={minutesToTime}
                  timeToMinutes={timeToMinutes}
                  setExpandedNotesTaskId={setExpandedNotesTaskId}
                  postponeTask={postponeTask}
                  moveToInbox={moveToInbox}
                  openMobileEditTask={openMobileEditTask}
                  dateStr={dateStr}
                />
              </div>
            </Row>
          );
        }

        return null;
      })}
      </div>{/* end timed body */}

      {/* ── Inbox drawer ── */}
      {/* Collapsed handle — fixed to viewport */}
      {!inboxOpen && (
        <div
          style={{
            position: 'fixed',
            right: 0,
            top: inboxHandleTop,
            zIndex: 40,
          }}
        >
          <button
            onClick={() => setInboxOpen(true)}
            className={`flex flex-col items-center justify-center gap-1 rounded-l-xl shadow-lg py-3 px-1.5 transition-colors
              ${darkMode ? 'bg-gray-700 hover:bg-gray-600 active:bg-gray-600' : 'bg-white hover:bg-stone-50 active:bg-stone-100'}
              border ${borderClass}`}
            style={{ width: 32 }}
            title="Open inbox"
          >
            <Inbox size={14} className={textSecondary} />
            <span
              className="font-semibold"
              style={{
                writingMode: 'vertical-rl',
                textOrientation: 'mixed',
                fontSize: 9,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              <span className={textSecondary}>Inbox</span>
            </span>
          </button>
        </div>
      )}

      {/* Expanded panel — fixed to viewport */}
      {(inboxOpen || inboxPinned) && (
        <div
          style={{
            position: 'fixed',
            right: 0,
            top: inboxHandleTop,
            bottom: 'calc(3.5rem + env(safe-area-inset-bottom, 0px))',
            width: 160,
            zIndex: 40,
            display: 'flex',
            flexDirection: 'column',
          }}
          className={`shadow-xl border-l ${borderClass} rounded-tl-xl overflow-hidden ${darkMode ? 'bg-gray-800' : 'bg-white'}`}
        >
          {/* Panel header */}
          <div className={`flex items-center justify-between px-3 py-2 border-b ${borderClass} flex-shrink-0`}>
            <div className="flex items-center gap-1.5">
              <Inbox size={13} className={textSecondary} />
              <span className={`text-xs font-semibold ${textSecondary}`}>Inbox</span>
            </div>
            <button
              onClick={() => { setInboxOpen(false); setInboxPinned(false); }}
              className={`p-0.5 rounded transition-colors ${darkMode ? 'hover:bg-white/10' : 'hover:bg-black/10'}`}
            >
              <ChevronRight size={14} className={textSecondary} />
            </button>
          </div>

          {/* Task list — vertical scroll */}
          <div className="flex-1 overflow-y-auto py-2 px-2 space-y-1.5">
            {inboxTasks.length === 0 ? (
              <p className={`text-[10px] ${textSecondary} text-center py-4`}>Empty</p>
            ) : (
              inboxTasks.map(task => {
                const hex = taskColorToHex(task.color) || '#3b82f6';
                const isDragging = activeDragTask?.id === task.id;
                return (
                  <div
                    key={task.id}
                    style={{
                      borderRadius: 6,
                      border: `1px solid ${hex}44`,
                      borderLeft: `3px solid ${hex}`,
                      background: `${hex}25`,
                      padding: '6px 8px',
                      touchAction: 'none',
                      opacity: isDragging ? 0.3 : 1,
                      transition: 'opacity 0.12s',
                      cursor: 'grab',
                    }}
                    onTouchStart={e => handleInboxTouchStart(e, task)}
                    onTouchMove={handleInboxTouchMove}
                    onTouchEnd={handleInboxTouchEnd}
                  >
                    <div className={`text-[11px] font-medium leading-snug ${textPrimary} overflow-hidden`}
                      style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                      {renderTitle(task.title)}
                    </div>
                    <div className={`text-[9px] mt-0.5 ${textSecondary}`}>{durLabel(task.duration)}</div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default MobileListView;
