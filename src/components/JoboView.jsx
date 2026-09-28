import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, FoldVertical, PanelRightClose, PanelRightOpen, Plus, UnfoldVertical } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import { dateToString } from '../utils/taskUtils.js';
import useDayViewHourHeight from '../hooks/useDayViewHourHeight.js';
import { DayViewColumn } from './DayView.jsx';
import DoColumn, { snapMinute, estimateCompletion, windowRange } from './jobo/DoColumn.jsx';
import useJoboPreference from '../hooks/useJoboPreference.js';
import useMinWidth from '../hooks/useMinWidth.js';
import JoboNotesSidebar from './jobo/JoboNotesSidebar.jsx';
import DoEditor from './jobo/DoEditor.jsx';
import ExecutionDetails from './jobo/ExecutionDetails.jsx';
import { assignOverlapColumns, buildJoboDayModel } from '../jobo/viewModel.js';
import { intervalFromMarker } from '../jobo/completionMarker.js';
import { doLinkCandidates } from '../jobo/linkCandidates.js';
import { prepareDoEdit, commitDoEdit } from '../jobo/viewActions.js';
import useJoboViewWriter from '../hooks/useJoboViewWriter.js';

// JOBO: Plan and Do for one day, side by side on one hour axis.
//
// The Plan side IS the app's timeline: DAY's own column over 24 hours, so it
// has the real task cards, drag and drop (Inbox included), the blue hover
// line, click-to-add, the timeline context menu, Frames and the now line,
// and the native checkbox completes the task through the usual handler (the
// slice 4 detector then records the Do). Nothing here re-implements them.
//
// The Do side is drawn to the same grid (DoColumn) from the day model
// (src/jobo/viewModel.js). It reads committed `joboRecords` only and writes
// through `recordJobo`, via the receipt hook that never calls a pending
// write saved. Gestures snap to 15 minutes like every other view.

// Plan's cell holds the 4rem hour gutter plus its half; Do gets the other half.
const GRID = 'grid grid-cols-[calc(50%+2rem)_minmax(0,1fr)]';
const clock = (minute) => `${String(Math.floor((minute % 1440) / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

// A task id inside an attribute selector. CSS.escape where the platform has
// it; otherwise quotes and backslashes, the only characters that can break
// out of the quoted value.
const cssEscape = (value) => (typeof CSS !== 'undefined' && CSS.escape
  ? CSS.escape(String(value))
  : String(value).replace(/["\\]/g, '\\$&'));

/**
 * The editor's opening state for continuing `record`: its title, its task and
 * its captured plan. createManualDo derives the taskId from `task`, so passing
 * the record's own taskId keeps a recurring template id as it is.
 */
export const continueInitial = (record, date, startMinute) => ({
  date, startMinute, duration: 30,
  title: record.title,
  task: { id: record.taskId },
  planSnapshot: record.planSnapshot ?? null,
  continuing: true,
});

export default function JoboView() {
  const { t } = useTranslation();
  const ctx = useDayPlannerCtx();
  const { joboRecords, joboLoaded, joboWritable, joboError, reloadJobo, recordJobo, goalsProjectsEnabled, projects, goals } = useFeaturesCtx();
  const writer = useJoboViewWriter({ records: joboRecords, recordJobo });
  const hourHeight = useDayViewHourHeight(ctx.calendarRef, ctx.stickyHeaderRef);

  const [editor, setEditor] = useState(null);
  const [details, setDetails] = useState(null);
  const [preview, setPreview] = useState(null);
  const [gestureError, setGestureError] = useState('');
  // Hover pairing: the task under the pointer on either side. Its Plan card
  // and every Do card that belongs to it are outlined together, which reads
  // where colour alone cannot (two tasks can share a colour).
  const [hoverTaskId, setHoverTaskId] = useState(null);
  // The notes sidebar, on wide screens only: the Daily Note, and the notes
  // of the task last clicked on either side (or picked with a Do card's
  // Notes button, which then opens here instead of below the card).
  const wide = useMinWidth(1600);
  const [notesPreferred, toggleNotesSidebar] = useJoboPreference('notes-sidebar');
  const sidebar = wide && notesPreferred;
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const scrollRef = useRef(null);
  const doLane = useRef(null);
  const gestureCleanup = useRef(null);
  const live = useRef(null);
  live.current = { joboRecords, joboWritable, joboLoaded, pendingIds: writer.pendingIds };

  const { selectedDate, getTasksForDate } = ctx;
  const date = dateToString(selectedDate);
  const dayStart = useMemo(() => { const d = new Date(selectedDate); d.setHours(0, 0, 0, 0); return d; }, [selectedDate]);
  // START to END only, when the day has a window and the toggle is on. Both
  // sides draw the same hours; every minute/pixel conversion below goes
  // through windowStart.
  const { getDayWindow } = useFeaturesCtx();
  const [windowOnly, toggleWindowOnly] = useJoboPreference('window-only');
  const dayWindow = getDayWindow?.(date) ?? null;
  const fullDay = { startHour: 0, endHour: 24 };
  const windowHours = dayWindow ? windowRange(dayWindow) : fullDay;
  const canTrim = windowHours.startHour !== 0 || windowHours.endHour !== 24;
  const { startHour, endHour } = windowOnly && canTrim ? windowHours : fullDay;
  const windowStart = startHour * 60;
  const planColumn = useMemo(() => ({ date: dayStart, dateStr: date, startHour, endHour }), [dayStart, date, startHour, endHour]);
  const currentTime = ctx.currentTime instanceof Date ? ctx.currentTime : new Date();
  const nowDate = dateToString(currentTime);
  const nowTime = clock(currentTime.getHours() * 60 + currentTime.getMinutes());

  const dayTasks = useMemo(
    () => getTasksForDate(selectedDate, false).filter((task) => !task.isAllDay && task.startTime),
    [getTasksForDate, selectedDate],
  );
  const lookup = useMemo(
    () => [...(ctx.tasks || []), ...(ctx.unscheduledTasks || []), ...(ctx.expandedRecurringTasks || []), ...dayTasks],
    [ctx.tasks, ctx.unscheduledTasks, ctx.expandedRecurringTasks, dayTasks],
  );
  const model = useMemo(() => buildJoboDayModel({
    date, tasks: dayTasks, taskLookup: lookup, recurringTasks: ctx.recurringTasks,
    records: joboRecords || [], scale: hourHeight, isVisibleForUser: ctx.isVisibleForUser,
    now: { date: nowDate, time: nowTime },
  }), [date, dayTasks, lookup, ctx.recurringTasks, joboRecords, hourHeight, ctx.isVisibleForUser, nowDate, nowTime]);
  const doItems = useMemo(
    () => assignOverlapColumns(
      [...model.timedRecords, ...model.untimedRecords.map(estimateCompletion)],
      { scale: hourHeight, minHeightPx: 27, gapPx: 2 },
    ),
    [model.timedRecords, model.untimedRecords, hourHeight],
  );
  const liveDetail = details && doItems.find((item) => item.id === details.item.id);
  // The selected task as it is now, so the sidebar follows edits and sync.
  const selectedTask = selectedTaskId == null ? null : lookup.find((task) => String(task.id) === String(selectedTaskId)) || null;

  // Open on the part of the day that matters: an hour before now on today,
  // otherwise an hour before the first Plan or Do.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const firstMinute = Math.min(
      ...model.plans.map((item) => item.startMinute),
      ...doItems.map((item) => item.startMinute),
      8 * 60,
    );
    const anchorMinute = date === nowDate ? currentTime.getHours() * 60 : firstMinute;
    el.scrollTop = Math.max(0, (anchorMinute - 60 - windowStart) * hourHeight / 60);
    // Only on a new day, hour height or visible range, never on an ordinary
    // re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, hourHeight, windowStart]);

  useEffect(() => () => gestureCleanup.current?.(), []);
  useEffect(() => { gestureCleanup.current?.(); }, [date]);

  // What a new Do can link to, built only while an editor is open.
  const linkCandidates = useMemo(
    () => (editor && !editor.record
      ? doLinkCandidates({
        dayTasks: getTasksForDate(selectedDate, false), inboxTasks: ctx.unscheduledTasks,
        ...(goalsProjectsEnabled ? { projects: projects || [], goals: goals || [] } : {}),
      })
      : []),
    [editor, getTasksForDate, selectedDate, ctx.unscheduledTasks, goalsProjectsEnabled, projects, goals],
  );
  const closeEditor = useCallback(() => setEditor(null), []);
  const closeDetails = useCallback(() => setDetails(null), []);
  // Editing an estimate opens with the estimated times filled in, so saving
  // it is the explicit "keep as shown"; clearing the start keeps the marker.
  const openEdit = (record) => {
    closeDetails();
    const shown = doItems.find((item) => item.record?.id === record.id && item.estimate);
    setEditor(shown
      ? { record, initial: { patch: { startTime: clock(shown.startMinute), endTime: shown.time, date: shown.date } } }
      : { record });
  };
  const openAdd = (startMinute) => { closeDetails(); setEditor({ initial: { date, startMinute, duration: 30 } }); };
  // Continue an unfinished attempt: a new Do on the same task and captured
  // plan, so it joins the original as another session of one execution. It
  // starts where the attempt ended, or now if that has already passed today.
  const openContinue = (item) => {
    closeDetails();
    const { record } = item;
    const ended = snapMinute(item.markerMinute ?? item.endMinute);
    const nowMinute = snapMinute(currentTime.getHours() * 60 + currentTime.getMinutes());
    const startMinute = Math.min(1410, date === nowDate ? Math.max(ended, nowMinute) : ended);
    setEditor({ initial: continueInitial(record, date, startMinute) });
  };

  const saveEdit = async (record, patch) => {
    const current = live.current;
    if (!current.joboLoaded || !current.joboWritable || current.pendingIds.includes(record.id)) return;
    setGestureError('');
    try {
      const next = prepareDoEdit({ records: current.joboRecords, record, patch, now: Date.now() });
      if (!next) { setGestureError(t('jobo.view.recordChanged')); return; }
      await commitDoEdit(writer.write, next);
    } catch (error) {
      setGestureError(t(error.code === 'recordChanged' ? 'jobo.view.recordChanged' : 'jobo.view.updateFailed'));
    }
  };

  // One pointer gesture on the Do column, with a live preview. `toRange`
  // turns the snapped minute under the pointer (and the one it went down on)
  // into { start, end } or null; `toPatch` turns the final range into the
  // record patch.
  const runGesture = (event, { toRange, toPatch, record }) => {
    if (event.button !== 0 || !joboWritable || writer.pendingIds.includes(record.id)) return;
    event.preventDefault();
    event.stopPropagation();
    gestureCleanup.current?.();
    const startY = event.clientY;
    const laneTop = doLane.current?.getBoundingClientRect().top ?? 0;
    const downMinute = (startY - laneTop) / hourHeight * 60 + windowStart;
    let range = null;
    const move = (e) => {
      if (Math.abs(e.clientY - startY) < 5) { range = null; setPreview(null); return; }
      const bounds = doLane.current?.getBoundingClientRect();
      if (!bounds) return;
      const minute = (e.clientY - bounds.top) / hourHeight * 60 + windowStart;
      range = toRange(snapMinute(minute), minute - downMinute);
      setPreview(range);
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cleanup);
      window.removeEventListener('keydown', escape, true);
      setPreview(null);
      gestureCleanup.current = null;
    };
    const escape = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); cleanup(); } };
    const finish = (e) => {
      move(e);
      const chosen = range;
      cleanup();
      // The browser follows a drag's pointerup with a click on whatever is
      // under it: the empty column (which would open Add Do) or the card
      // (its details). A drag is not a click, so swallow that one click.
      if (Math.abs(e.clientY - startY) >= 5) {
        const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
        window.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener('click', swallow, true), 0);
      }
      const patch = chosen && toPatch(chosen);
      if (patch) saveEdit(record, patch);
    };
    gestureCleanup.current = cleanup;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
    window.addEventListener('pointercancel', cleanup, { once: true });
    window.addEventListener('keydown', escape, true);
  };

  // The timed patch for an interval of the item's day. Midnight is the next
  // day's 00:00, the shape core expects.
  const timedPatch = (date, start, end) => {
    const next = new Date(`${date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    return {
      timing: 'timed', date, startTime: clock(start),
      endDate: end >= 1440 ? next.toISOString().slice(0, 10) : date, endTime: clock(end % 1440),
    };
  };

  // Keep an estimate as shown: the same timed write a move or an editor save
  // makes, under the same id, with the times the card displays.
  const keepEstimate = (item) => {
    if (!item.estimate) return;
    saveEdit(item.record, timedPatch(item.date, item.startMinute, item.endMinute));
  };

  // Drag an estimate to where the work really was: it moves whole, its start
  // snapped to 15 minutes, and saving it makes it a timed Do under the same id.
  const onEstimateMove = (event, item) => {
    const duration = item.endMinute - item.startMinute;
    runGesture(event, {
      record: item.record,
      toRange: (_minute, delta) => {
        const start = Math.max(0, Math.min(1440 - duration, snapMinute(item.startMinute + delta)));
        return start === item.startMinute ? null : { start, end: start + duration };
      },
      toPatch: (range) => timedPatch(item.date, range.start, range.end),
    });
  };

  // Drag from a completion marker: the marker is one end of the interval,
  // the pointer the other. Same id; the record becomes timed. An estimate
  // moves instead.
  const onPointGesture = (event, item) => (item.estimate ? onEstimateMove(event, item) : runGesture(event, {
    record: item.record,
    toRange: (minute) => (minute === item.startMinute ? null
      : { start: Math.min(item.startMinute, minute), end: Math.max(item.startMinute, minute) }),
    toPatch: (range) => intervalFromMarker(item, range.start === item.startMinute ? range.end : range.start),
  }));

  // Drag the bottom handle of a timed Do to move its end, as with a task. On
  // an estimate it sets the real end, keeping the estimated start.
  const onResizeGesture = (event, item) => (item.estimate ? runGesture(event, {
    record: item.record,
    toRange: (minute) => (minute > item.startMinute && minute !== item.endMinute ? { start: item.startMinute, end: minute } : null),
    toPatch: (range) => timedPatch(item.date, range.start, range.end),
  }) : runGesture(event, {
    record: item.record,
    toRange: (minute) => (minute > item.startMinute ? { start: item.startMinute, end: minute } : null),
    toPatch: (range) => {
      if (range.end === item.endMinute) return null;
      // Midnight is the next day's 00:00, the shape core expects.
      if (range.end >= 1440) {
        const next = new Date(`${item.record.date}T00:00:00Z`);
        next.setUTCDate(next.getUTCDate() + 1);
        return { endDate: next.toISOString().slice(0, 10), endTime: '00:00' };
      }
      return { endDate: item.record.date, endTime: clock(range.end) };
    },
  }));

  if (!joboLoaded) {
    return (
      <div data-jobo-view className={`h-full flex items-center justify-center gap-2 p-6 ${ctx.textSecondary}`} role={joboError ? 'alert' : 'status'}>
        {joboError ? (
          <>
            <AlertTriangle size={16} />{t('jobo.view.loadError')}
            {reloadJobo && <button type="button" className="underline" onClick={() => reloadJobo()}>{t('jobo.view.retryLoad')}</button>}
          </>
        ) : t('common.loading')}
      </div>
    );
  }

  const status = gestureError
    || (writer.conflict ? t('jobo.view.recordChanged')
      : joboError ? t('jobo.view.storageError')
        : !joboWritable ? t('jobo.view.readOnly')
          : model.invalidRecordCount > 0 ? t('jobo.view.invalidRecords', { count: model.invalidRecordCount }) : '');

  return (
    <div data-jobo-view className={`flex-1 min-h-0 min-w-0 flex flex-col ${ctx.textPrimary}`}>
      {status && (
        <div className="flex items-center gap-2 px-3 py-1 text-xs" role="status"><AlertTriangle size={14} />{status}</div>
      )}
      <div className="flex-1 min-h-0 min-w-0 flex">
      <div ref={scrollRef} className={`flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden ${ctx.darkMode ? 'dark-scrollbar' : ''}`}>
        <div className={`${GRID} sticky top-0 z-40 border-b text-sm font-semibold ${ctx.cardBg} ${ctx.borderClass}`}>
          <div className="flex min-w-0">
            <div className={`w-16 flex-shrink-0 border-r ${ctx.borderClass} flex items-center justify-center`}>
              {/* Over the hour gutter: trim to the day's START and END, or
                  show every hour again. Only when the day has a window. */}
              {canTrim && (
                <button
                  type="button"
                  data-jobo-window-toggle
                  onClick={toggleWindowOnly}
                  aria-pressed={windowOnly}
                  className={`p-1 rounded-lg transition-colors ${windowOnly ? 'text-blue-500' : ctx.textSecondary} ${ctx.darkMode ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}
                  title={windowOnly ? t('jobo.view.showAllHours') : t('jobo.view.showWindowOnly', { start: t('strip.markerStart').toLocaleUpperCase(), end: t('strip.markerEnd').toLocaleUpperCase() })}
                  aria-label={windowOnly ? t('jobo.view.showAllHours') : t('jobo.view.showWindowOnly', { start: t('strip.markerStart').toLocaleUpperCase(), end: t('strip.markerEnd').toLocaleUpperCase() })}
                >
                  {windowOnly ? <UnfoldVertical size={16} /> : <FoldVertical size={16} />}
                </button>
              )}
            </div>
            <div className="flex-1 min-w-0 px-3 py-1.5 flex items-center">{t('jobo.view.plan')}</div>
          </div>
          <div className={`min-w-0 px-3 py-1 border-l ${ctx.borderClass} flex items-center justify-between gap-2`}>
            <span>{t('jobo.view.do')}</span>
            <div className="flex items-center gap-1.5">
            <button
              type="button"
              data-jobo-add
              // The Inbox's New Task button, so adding reads the same everywhere.
              className="h-7 px-2.5 flex items-center justify-center gap-1 whitespace-nowrap bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-40"
              disabled={!joboWritable}
              onClick={() => openAdd(date === nowDate
                ? Math.min(1410, snapMinute(currentTime.getHours() * 60 + currentTime.getMinutes()))
                : 9 * 60)}
            >
              <Plus size={14} strokeWidth={3} /><span className="text-xs font-medium">{t('jobo.view.addDo')}</span>
            </button>
            {wide && (
              <button
                type="button"
                data-jobo-notes-sidebar-toggle
                onClick={toggleNotesSidebar}
                aria-pressed={notesPreferred}
                className={`p-1 rounded-lg transition-colors ${notesPreferred ? 'text-blue-500' : ctx.textSecondary} ${ctx.darkMode ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}
                title={t(notesPreferred ? 'jobo.view.hideNotesSidebar' : 'jobo.view.showNotesSidebar')}
                aria-label={t(notesPreferred ? 'jobo.view.hideNotesSidebar' : 'jobo.view.showNotesSidebar')}
              >
                {notesPreferred ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
              </button>
            )}
            </div>
          </div>
        </div>
        <div className={GRID}>
          {/* `contents` keeps DAY's column the grid cell; the wrapper only
              listens, and scopes the outline rule to the Plan side. */}
          <div
            className="contents"
            data-jobo-pairing
            // Capture: DAY's cards stop their own clicks from bubbling.
            onClickCapture={(event) => {
              const id = event.target.closest?.('[data-task-id]')?.getAttribute('data-task-id');
              if (sidebar && id != null) setSelectedTaskId(id);
            }}
            onMouseOver={(event) => {
              // Always set: a Do card's leave may have just queued null, and a
              // comparison against this render's value would skip the update.
              setHoverTaskId(event.target.closest?.('[data-task-id]')?.getAttribute('data-task-id') ?? null);
            }}
            onMouseLeave={() => setHoverTaskId(null)}
          >
            {hoverTaskId != null && (
              <style>{`[data-jobo-pairing] [data-task-id="${cssEscape(hoverTaskId)}"]{outline:2px solid rgb(59 130 246);outline-offset:1px}`}</style>
            )}
            <DayViewColumn col={planColumn} colIdx={0} hourHeight={hourHeight} />
          </div>
          <DoColumn
            date={date}
            hourHeight={hourHeight}
            items={doItems}
            ctx={ctx}
            t={t}
            writable={joboWritable}
            pendingIds={writer.pendingIds}
            preview={preview}
            laneRef={doLane}
            onAddAt={openAdd}
            onEdit={openEdit}
            onKeep={keepEstimate}
            onContinue={openContinue}
            hoverTaskId={hoverTaskId}
            onHoverTask={setHoverTaskId}
            startHour={startHour}
            endHour={endHour}
            onDetails={(item, anchor) => {
              setDetails({ item, anchor });
              if (sidebar && item.sourceTask) setSelectedTaskId(item.sourceTask.id);
            }}
            onNotesInSidebar={sidebar ? (task) => setSelectedTaskId(task.id) : undefined}
            onPointGesture={onPointGesture}
            onResizeGesture={onResizeGesture}
          />
        </div>
      </div>
      {sidebar && (
        <JoboNotesSidebar date={date} task={selectedTask} onClearTask={() => setSelectedTaskId(null)} t={t} />
      )}
      </div>
      {liveDetail && (
        <ExecutionDetails
          item={liveDetail}
          anchor={details.anchor}
          onClose={closeDetails}
          onEdit={({ record }) => openEdit(record)}
          ctx={ctx}
          t={t}
          writable={joboWritable}
          pendingIds={writer.pendingIds}
        />
      )}
      {editor && (
        <DoEditor
          {...editor}
          taskCompleted={!!doItems.find(item => item.record?.id === editor.record?.id)?.sourceTask?.completed}
          linkCandidates={editor.record ? undefined : linkCandidates}
          records={joboRecords || []}
          writable={joboWritable}
          recordJobo={writer.write}
          onClose={closeEditor}
          pendingIds={writer.pendingIds}
          t={t}
          cardBg={ctx.cardBg}
          textPrimary={ctx.textPrimary}
          textSecondary={ctx.textSecondary}
          borderClass={ctx.borderClass}
          darkMode={ctx.darkMode}
        />
      )}
    </div>
  );
}
