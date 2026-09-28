import React, { useEffect, useRef, useState } from 'react';
import { BookOpen, Check, CheckCircle2, CheckSquare, Clock, FileText, Pencil, Plus } from 'lucide-react';
import { renderTitleWithoutTags, hasNotesOrSubtasks, hasOnlySubtasks, isObsidianNoteOnlyTask } from '../../utils/textFormatting.jsx';
import DoNotesPanel from './DoNotesPanel.jsx';
import { extractWikilinks, stripWikilinks } from '../../utils/taskUtils.js';
import { timingRows } from './ExecutionAxes.jsx';
import { completionMoment } from '../../jobo/completionMarker.js';

// The Do side of JOBO, drawn with the same grid as the Plan side (DAY's own
// column): alternating hour rows, the dashed half-hour line, the now line,
// the blue hover line with its time label, and cards styled like the app's
// task cards. Every gesture snaps to 15 minutes, as the rest of the app does;
// exact minutes are typed in the editor.
//
// It only renders and reports gestures. Writes go through the callbacks, and
// from there through recordJobo, the ledger's only writer.

export const SNAP_MINUTES = 15;
export const snapMinute = (minute) =>
  Math.max(0, Math.min(1440, Math.round(minute / SNAP_MINUTES) * SNAP_MINUTES));
const MIN_CARD_PX = 27; // the task cards' minimum height (DayView getTaskSlice)
const minuteOf = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const clock = (minute) => `${String(Math.floor((minute % 1440) / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
// How far past its planned start a completion can land and still read as
// "started as planned": up to three times the planned length. Beyond that the
// planned start says little about when the work began.
const PLAN_START_REACH = 3;

/**
 * A completion whose captured plan has a duration is drawn as the block it most
 * likely was. DISPLAY ONLY. Nothing is stored until the user keeps, moves or
 * resizes it (or saves it from the editor), so the ledger, and every measured
 * figure built on it, never contains a guess. A completion with no planned
 * duration (an Inbox task) stays a marker.
 *
 * The guess: the work began at the planned start and ended at the completion,
 * so a task finished late reads as running long, and one finished early as
 * running short. That holds when the completion falls on the plan's day, after
 * its start, and within reach of it; otherwise the planned length, ending at
 * the completion. Work already recorded for the task that day moves the start
 * to where it ended: after a partial 09:00 to 09:30, a completion at 10:00 is
 * the 09:30 to 10:00 that finished it, not a second copy of the same hour.
 */
export function estimateCompletion(item) {
  if (!item?.point || item.estimate) return item;
  const plan = item.record?.planSnapshot;
  const duration = plan?.duration;
  if (!(Number.isFinite(duration) && duration > 0)) return item;
  const end = item.startMinute;
  const planStart = /^\d{2}:\d{2}$/.test(plan.startTime || '')
    ? Number(plan.startTime.slice(0, 2)) * 60 + Number(plan.startTime.slice(3))
    : null;
  const startedAsPlanned = planStart != null && plan.date === item.date
    && planStart < end && end - planStart <= duration * PLAN_START_REACH;
  const guess = startedAsPlanned ? planStart : Math.max(0, end - duration);
  const earlierEnds = (item.attempts || [])
    .filter((other) => other.id !== item.record.id && other.timing === 'timed' && other.endDate === item.date)
    .map((other) => minuteOf(other.endTime))
    .filter((minute) => minute > guess && minute <= end);
  const start = Math.max(guess, ...earlierEnds);
  if (end - start < 1) return item;
  return { ...item, markerMinute: end, startMinute: start, endMinute: end, estimate: true };
}

/**
 * The hours a day's START/END window covers, widened to whole hours the way
 * the timeline draws them: START's hour to the hour END falls in or before.
 * A missing edge is the day's own edge, and a window that does not run
 * forward (END at or before START) is the whole day.
 */
export function windowRange(dayWindow) {
  const minute = (time) => (/^\d{2}:\d{2}$/.test(time || '') ? Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) : null);
  const start = minute(dayWindow?.start);
  const stop = minute(dayWindow?.stop);
  const startHour = start == null ? 0 : Math.floor(start / 60);
  const endHour = stop == null ? 24 : Math.min(24, Math.ceil(stop / 60));
  return endHour > startHour ? { startHour, endHour } : { startHour: 0, endHour: 24 };
}

// When an attempt's work ended, as "YYYY-MM-DD HH:MM" so two compare as
// strings: a timed interval's end, or the moment a completion was made.
function attemptEnd(record) {
  if (record?.timing === 'timed') return record.endDate && record.endTime ? `${record.endDate} ${record.endTime.slice(0, 5)}` : null;
  const civil = completionMoment(record?.createdAt);
  return civil ? `${civil.date} ${civil.time}` : null;
}

/**
 * An unfinished attempt whose task a later attempt completed. The record
 * stays Partial, which is true of that session; the card adds that the work
 * did get finished. Derived from the group, nothing stored.
 */
export function finishedLater(item) {
  const record = item?.record;
  if (!record || record.progress === 'completed') return false;
  const own = attemptEnd(record);
  if (!own) return false;
  return (item.attempts || []).some((other) => other.id !== record.id
    && other.progress === 'completed' && (attemptEnd(other) ?? '') >= own);
}

const progressText = (progress, t) => t(progress === 'completed' ? 'common.completed' : `jobo.view.progress.${progress}`);

/**
 * The card's timing signals, split by where they sit. A single status (no Do
 * time recorded, nothing started, no plan to compare against) reads as part
 * of the status line: "09:00–09:45 · Partial · Unplanned". The start, finish
 * and duration comparison keeps a line of its own.
 */
export function cardSignals(comparison, t) {
  const rows = comparison ? timingRows(comparison, t) : [];
  if (rows.length === 1 && !rows[0].state) {
    const [row] = rows;
    return { inline: row.key === 'incomplete' ? { ...row, text: t('jobo.view.timeIncompleteShort'), title: row.text } : row, rows: [] };
  }
  return { inline: null, rows };
}

// Only an unfinished attempt linked to a task can be continued: the follow-up
// shares its task and captured plan, so the two group as one execution. An
// unlinked Do has nothing to tie a follow-up to.
export const canContinue = (record) => !!record && record.taskId != null && record.progress !== 'completed';

function DoCard({ item, hourHeight, offsetMin = 0, limitMin = 1440, ctx, t, writable, pending, highlighted, notesOpen, onEdit, onKeep, onContinue, onNotes, onHover, onDetails, onPointGesture, onResizeGesture }) {
  const { record } = item;
  // Drawn within the visible hours: a card that runs past a trimmed edge is
  // cut at it, as DAY cuts a task at its column's edge.
  const shownStart = Math.max(item.startMinute, offsetMin);
  const shownEnd = Math.min(item.endMinute, limitMin);
  const top = (Math.min(shownStart, limitMin) - offsetMin) * hourHeight / 60;
  const height = Math.max(MIN_CARD_PX, (shownEnd - shownStart) * hourHeight / 60 - 2);
  const isMicro = height <= 40;
  const color = item.task?.color || item.sourceTask?.color || 'bg-purple-500';
  const timeLabel = item.estimate
    ? `~${ctx.formatTime(clock(item.startMinute))}–${ctx.formatTime(item.time)}`
    : item.point
      ? ctx.formatTime(item.time)
      : `${ctx.formatTime(record.startTime)}–${record.endDate !== record.date ? `${record.endDate} ` : ''}${ctx.formatTime(record.endTime)}`;
  const { inline, rows: signals } = !item.point ? cardSignals(item.comparison, t) : { inline: null, rows: [] };
  const status = pending ? t('jobo.view.pendingSave') : item.estimate ? t('jobo.view.estimatedShort') : progressText(record.progress, t);
  const finished = !pending && finishedLater(item);
  const continuable = writable && !pending && !item.estimate && canContinue(record);
  // An interval that ends on another day is clipped here; resizing it from
  // this column would move an end the column cannot show.
  const canResize = writable && !pending && (item.estimate || (!item.point && record.endDate === record.date));
  const movable = writable && !pending && item.point;
  const startsGesture = (event) => !event.target.closest('button');
  // The task this attempt belongs to, as the Plan side shows it: the key for
  // hover pairing and whose notes the Notes button opens.
  const task = item.sourceTask || null;

  return (
    <div
      data-jobo-record={record.id}
      data-jobo-point={item.point ? 'true' : undefined}
      data-jobo-estimate={item.estimate ? 'true' : undefined}
      className={`absolute pointer-events-auto rounded-lg overflow-hidden text-white ${color}
        ${item.estimate ? 'bg-opacity-60 border-2 border-dashed border-white/80' : 'shadow-md'}
        ${movable ? (item.estimate ? 'cursor-grab active:cursor-grabbing' : 'cursor-ns-resize') : 'cursor-pointer'}
        ${pending ? 'opacity-60' : ''}
        ${notesOpen ? 'overflow-visible z-30' : ''}`}
      style={{
        top, height, left: `calc(${item.leftPct}% + 2px)`, width: `calc(${item.widthPct}% - 4px)`, touchAction: item.point ? 'none' : undefined,
        ...(highlighted ? { outline: '2px solid rgb(59 130 246)', outlineOffset: '1px' } : {}),
      }}
      onMouseEnter={() => onHover(task?.id ?? null)}
      onMouseLeave={() => onHover(null)}
      onClick={(event) => { event.stopPropagation(); if (startsGesture(event)) onDetails(item, event.currentTarget); }}
      onPointerDown={(event) => { if (movable && startsGesture(event)) onPointGesture(event, item); }}
      title={item.estimate
        ? `${t('jobo.view.inferredPlanDuration')} ${t('jobo.view.dragCompletion')}`
        : item.point && writable ? t('jobo.view.dragCompletion') : undefined}
    >
      {/* A completion is a moment: the white rule marks it exactly, at the
          top of a marker and at the bottom (its end) of an estimate. */}
      {item.point && <div className={`absolute ${item.estimate ? 'bottom-0' : 'top-0'} left-0 right-0 h-0.5 bg-white pointer-events-none`} aria-hidden="true" />}
      <div className="px-2 py-1 h-full flex flex-col min-w-0">
        <div className="flex items-center gap-1 min-w-0">
          {item.point && <CheckCircle2 size={12} className="flex-shrink-0 opacity-90" aria-hidden="true" />}
          <div className="font-semibold text-sm leading-tight truncate flex-1 min-w-0" title={stripWikilinks(record.title)}>
            {renderTitleWithoutTags(record.title)}
          </div>
          {task && (
            <button
              type="button"
              data-jobo-notes-toggle
              onClick={(event) => { event.stopPropagation(); onNotes(notesOpen ? null : item.id); }}
              // The timeline card's rule: lit when there is something to
              // open, notes, subtasks or a linked Obsidian note.
              className={`flex-shrink-0 hover:bg-white/20 rounded p-1 transition-colors ${hasNotesOrSubtasks(task) || extractWikilinks(task.title).length > 0 ? '' : 'opacity-40'}`}
              aria-label={`${t('task.notes')}: ${stripWikilinks(record.title)}`}
              aria-expanded={notesOpen}
              title={t('sched.notesSubtasks')}
            >
              {hasOnlySubtasks(task) ? <CheckSquare size={12} /> : isObsidianNoteOnlyTask(task) ? <BookOpen size={12} /> : <FileText size={12} />}
            </button>
          )}
          {/* Keep the estimate as shown: one click records it as a timed Do,
              the same write as saving it from the editor. */}
          {item.estimate && writable && !pending && (
            <button
              type="button"
              data-jobo-keep
              onClick={(event) => { event.stopPropagation(); onKeep(item); }}
              className="flex-shrink-0 hover:bg-white/20 rounded p-1 transition-colors"
              aria-label={`${t('jobo.view.keepEstimate')}: ${stripWikilinks(record.title)}`}
              title={t('jobo.view.keepEstimate')}
            >
              <Check size={12} />
            </button>
          )}
          {continuable && (
            <button
              type="button"
              data-jobo-continue
              onClick={(event) => { event.stopPropagation(); onContinue(item); }}
              className="flex-shrink-0 hover:bg-white/20 rounded p-1 transition-colors"
              aria-label={`${t('jobo.view.continueDo')}: ${stripWikilinks(record.title)}`}
              title={t('jobo.view.continueDoHint')}
            >
              <Plus size={12} />
            </button>
          )}
          {writable && !pending && (
            <button
              type="button"
              onClick={(event) => { event.stopPropagation(); onEdit(record); }}
              className="flex-shrink-0 hover:bg-white/20 rounded p-1 transition-colors"
              aria-label={`${t('common.edit')}: ${stripWikilinks(record.title)}`}
            >
              <Pencil size={12} />
            </button>
          )}
          {isMicro && (
            <div className="text-xs opacity-90 whitespace-nowrap flex items-center gap-1 flex-shrink-0">
              <Clock size={10} />{timeLabel}
            </div>
          )}
        </div>
        {!isMicro && (
          <div className="text-xs opacity-90 flex items-center gap-1 min-w-0 whitespace-nowrap">
            <Clock size={10} className="flex-shrink-0" />
            <span className="truncate" title={inline?.title}>
              {timeLabel} · {status}
              {finished && <span data-jobo-finished-later title={t('jobo.view.finishedLaterHint')}> · {t('jobo.view.finishedLater')}</span>}
              {inline && <span data-jobo-axis={inline.key}> · {inline.text}</span>}
            </span>
          </div>
        )}
        {!isMicro && signals.length > 0 && height > 60 && (
          <div className="text-xs opacity-80 flex gap-1 min-w-0 overflow-hidden mt-0.5">
            {signals.map((row) => (
              <span key={row.key} data-jobo-axis={row.key} title={row.text} className="truncate border-l border-white/40 pl-1 first:border-l-0 first:pl-0">{row.text}</span>
            ))}
          </div>
        )}
      </div>
      {canResize && (
        <div
          onPointerDown={(event) => { event.stopPropagation(); onResizeGesture(event, item); }}
          onClick={(event) => event.stopPropagation()}
          className="absolute bottom-0 left-1/3 right-1/3 h-3 cursor-ns-resize hover:bg-white/20 flex items-center justify-center select-none"
          style={{ marginBottom: '-4px', touchAction: 'none' }}
          aria-hidden="true"
        >
          <div className="w-12 h-1 bg-white rounded-full" />
        </div>
      )}
      {notesOpen && task && <DoNotesPanel task={task} height={height} above={item.endMinute >= 22 * 60} />}
    </div>
  );
}

export default function DoColumn({
  date, hourHeight, items, ctx, t,
  writable, pendingIds = [], preview,
  onAddAt, onEdit, onKeep, onContinue, onDetails, onPointGesture, onResizeGesture,
  hoverTaskId = null, onHoverTask = () => {},
  startHour = 0, endHour = 24,
  onNotesInSidebar,
  laneRef,
}) {
  const [hoverMinute, setHoverMinute] = useState(null);
  // One notes panel at a time, JOBO's own: the global expanded-notes id
  // would also open the same task's panel on its Plan card.
  const [notesFor, setNotesFor] = useState(null);
  useEffect(() => {
    if (!notesFor) return undefined;
    const close = (event) => {
      if (event.type === 'keydown' ? event.key === 'Escape' : !event.target.closest?.('[data-jobo-notes],[data-jobo-notes-toggle]')) setNotesFor(null);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [notesFor]);
  const ownRef = useRef(null);
  const lane = laneRef || ownRef;
  const { darkMode, borderClass, currentTime } = ctx;
  const altRow = darkMode ? 'bg-white/[0.04]' : 'bg-stone-100/50';
  const offsetMin = startHour * 60;
  const limitMin = endHour * 60;
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  // Only what shows within the visible hours; a moment at the bottom edge
  // (a completion at END) still shows.
  const shown = items.filter((item) => (item.startMinute === item.endMinute
    ? item.startMinute >= offsetMin && item.startMinute <= limitMin
    : item.endMinute > offsetMin && item.startMinute < limitMin));
  const now = currentTime instanceof Date ? currentTime : new Date();
  const isToday = date === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const nowMinute = now.getHours() * 60 + now.getMinutes();
  const nowY = (nowMinute - offsetMin) * hourHeight / 60;

  const minuteFromEvent = (event) => {
    const rect = lane.current?.getBoundingClientRect();
    if (!rect) return null;
    return snapMinute((event.clientY - rect.top) / hourHeight * 60 + offsetMin);
  };
  const overCard = (target) => !!target.closest?.('[data-jobo-record]');

  return (
    <div className={`min-w-0 border-l ${borderClass} ${isToday ? (darkMode ? 'bg-blue-900/10' : 'bg-blue-50/40') : ''}`}>
      <div
        ref={lane}
        data-jobo-lane="do"
        className="relative"
        onMouseMove={(event) => {
          if (preview || overCard(event.target)) { if (hoverMinute !== null) setHoverMinute(null); return; }
          setHoverMinute(minuteFromEvent(event));
        }}
        onMouseLeave={() => setHoverMinute(null)}
        onClick={(event) => {
          if (!writable || overCard(event.target)) return;
          const minute = minuteFromEvent(event);
          if (minute !== null) onAddAt(Math.min(minute, limitMin - 30));
        }}
      >
        {hours.map((hour, i) => (
          <div key={hour} className="relative" style={{ height: `${hourHeight}px` }}>
            <div className={`border-b h-full ${borderClass} ${i % 2 === 1 ? altRow : ''} ${writable ? 'cursor-pointer' : ''}`} />
            <div className={`absolute left-0 right-0 border-b border-dashed ${borderClass} opacity-50 pointer-events-none`} style={{ top: `${hourHeight / 2}px` }} />
          </div>
        ))}

        {isToday && nowMinute >= offsetMin && nowMinute <= limitMin && (
          <div className="absolute left-0 right-0 pointer-events-none z-10" style={{ top: `${nowY}px` }}>
            {/* Same structure as DAY's now line (dot, then line, centred), so
                the two sides meet at exactly the same height. */}
            <div className="flex items-center"><div className="w-2 h-2 -ml-1" /><div className="flex-1 h-0.5 bg-red-500" /></div>
          </div>
        )}

        {shown.map((item) => (
          <DoCard
            key={item.id}
            item={item}
            hourHeight={hourHeight}
            offsetMin={offsetMin}
            limitMin={limitMin}
            ctx={ctx}
            t={t}
            writable={writable}
            pending={pendingIds.includes(item.id)}
            onEdit={onEdit}
            onKeep={onKeep}
            onContinue={onContinue}
            highlighted={hoverTaskId != null && item.sourceTask?.id === hoverTaskId}
            notesOpen={notesFor === item.id}
            // With the notes sidebar open, a card's Notes shows its task there.
            onNotes={onNotesInSidebar ? () => onNotesInSidebar(item.sourceTask) : setNotesFor}
            onHover={onHoverTask}
            onDetails={onDetails}
            onPointGesture={onPointGesture}
            onResizeGesture={onResizeGesture}
          />
        ))}

        {preview && (
          <div
            data-jobo-gesture-preview
            className="absolute left-1 right-1 pointer-events-none rounded-lg border-2 border-dashed border-blue-500 bg-blue-500/15 z-20"
            style={{ top: `${(preview.start - offsetMin) * hourHeight / 60}px`, height: `${Math.max(2, (preview.end - preview.start) * hourHeight / 60)}px` }}
          >
            <div className="absolute right-1 -top-3 bg-blue-500/80 text-white text-xs px-1.5 py-0.5 rounded">
              {ctx.formatTime(clock(preview.start))}–{ctx.formatTime(clock(preview.end))}
            </div>
          </div>
        )}

        {hoverMinute !== null && !preview && writable && (
          <div className="absolute left-0 right-0 pointer-events-none z-30" style={{ top: `${(hoverMinute - offsetMin) * hourHeight / 60}px` }}>
            <div className="absolute left-0 right-12 h-0.5 bg-blue-400/60" />
            <div className="absolute right-1 bg-blue-500/80 text-white text-xs px-1.5 py-0.5 rounded -translate-y-1/2">
              {ctx.formatTime(clock(hoverMinute))}
            </div>
          </div>
        )}

        {!shown.length && (
          <p className={`absolute top-3 inset-x-2 text-xs text-center pointer-events-none ${ctx.textSecondary}`}>{t('jobo.view.emptyDo')}</p>
        )}
      </div>
    </div>
  );
}
