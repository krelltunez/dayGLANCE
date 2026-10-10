import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import { snapMinute } from '../components/jobo/DoColumn.jsx';
import { doLinkCandidates } from '../jobo/linkCandidates.js';
import { prepareDoEdit, commitDoEdit, offersCompleteTask } from '../jobo/viewActions.js';
import { canLinkDo } from '../jobo/core.js';
import useJoboViewWriter from './useJoboViewWriter.js';

const clock = (minute) => `${String(Math.floor((minute % 1440) / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

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

/**
 * The timed patch for an interval of a day. Midnight is the next day's 00:00,
 * the shape core expects.
 */
export function timedPatch(date, start, end) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return {
    timing: 'timed', date, startTime: clock(start),
    endDate: end >= 1440 ? next.toISOString().slice(0, 10) : date, endTime: clock(end % 1440),
  };
}

/**
 * The toast's words for one accepted Do write: added (nothing before it),
 * deleted (a tombstone after), or saved.
 */
export function doWriteMessageKey(before, after) {
  if (!before) return 'jobo.mobile.doAdded';
  if (after?.deleted) return 'jobo.mobile.doDeleted';
  return 'jobo.mobile.doSaved';
}

/**
 * What both JOBO views do to a day's Do, apart from dragging: add, edit,
 * continue and keep an estimate, through the Do editor and the ledger's
 * writer, which makes every accepted write a step of the app's undo history.
 * The desktop view adds its drag gestures on top through `saveEdit`; the
 * phone's (slice 8 step 2) uses these alone. One place, so the two cannot
 * write a Do differently.
 *
 * `beforeOpen` runs before the editor opens (the desktop view closes a card's
 * details popover there). With `announce`, each accepted write also shows the
 * app's undo toast: a phone has no keyboard, so the toast is its way to undo,
 * as it is for a task.
 */
export default function useJoboDoActions({ date, model, doItems, currentTime, nowDate, beforeOpen, announce = false }) {
  const { t } = useTranslation();
  const ctx = useDayPlannerCtx();
  const { joboRecords, joboLoaded, joboWritable, recordJobo, recordJoboUndo, goalsProjectsEnabled, projects, goals, isVisibleForUser } = useFeaturesCtx();
  const { setUndoToast } = ctx;
  const onWritten = useCallback((before, after) => {
    recordJoboUndo?.(before, after);
    if (announce) setUndoToast?.({ message: t(doWriteMessageKey(before, after)), actionable: true });
  }, [recordJoboUndo, announce, setUndoToast, t]);
  const writer = useJoboViewWriter({ records: joboRecords, recordJobo, onWritten });
  const [editor, setEditor] = useState(null);
  const [error, setError] = useState('');
  const live = useRef(null);
  live.current = { joboRecords, joboWritable, joboLoaded, pendingIds: writer.pendingIds };
  const { selectedDate, getTasksForDate } = ctx;

  // What a new Do can link to, built only while an editor is open.
  const linkCandidates = useMemo(
    () => (editor && !editor.record
      ? doLinkCandidates({
        // The day's tasks arrive filtered for this household member; the
        // Inbox is filtered here the same way.
        dayTasks: getTasksForDate(selectedDate, false),
        inboxTasks: (ctx.unscheduledTasks || []).filter((task) => typeof isVisibleForUser !== 'function' || isVisibleForUser(task)),
        ...(goalsProjectsEnabled ? { projects: projects || [], goals: goals || [] } : {}),
      })
      : []),
    [editor, getTasksForDate, selectedDate, ctx.unscheduledTasks, goalsProjectsEnabled, projects, goals, isVisibleForUser],
  );
  const closeEditor = useCallback(() => setEditor(null), []);
  // "Complete task" in the editor is the linked task's checkbox: the same
  // handler, with the Inbox flag the Inbox's own checkbox passes. The Do
  // record is never written by it; the detector records the completion.
  const completeTaskFor = (record) => {
    const task = record ? model.resolveRecordTask(record) : null;
    if (!offersCompleteTask(record, task) || typeof ctx.toggleComplete !== 'function') return undefined;
    const fromInbox = (ctx.unscheduledTasks || []).some((inboxTask) => inboxTask.id === task.id);
    return () => ctx.toggleComplete(task.id, fromInbox);
  };
  // Editing an estimate opens with the estimated times filled in, so saving
  // it is the explicit "keep as shown"; clearing the start keeps the marker.
  const openEdit = (record) => {
    beforeOpen?.();
    const shown = doItems.find((item) => item.record?.id === record.id && item.estimate);
    setEditor(shown
      ? { record, initial: { patch: { startTime: clock(shown.startMinute), endTime: shown.time, date: shown.date } } }
      : { record });
  };
  const openAdd = (startMinute) => { beforeOpen?.(); setEditor({ initial: { date, startMinute, duration: 30 } }); };
  // Continue an unfinished attempt: a new Do on the same task and captured
  // plan, so it joins the original as another session of one execution. It
  // starts where the attempt ended, or now if that has already passed today.
  const openContinue = (item) => {
    beforeOpen?.();
    const { record } = item;
    const ended = snapMinute(item.markerMinute ?? item.endMinute);
    const nowMinute = snapMinute(currentTime.getHours() * 60 + currentTime.getMinutes());
    const startMinute = Math.min(1410, date === nowDate ? Math.max(ended, nowMinute) : ended);
    setEditor({ initial: continueInitial(record, date, startMinute) });
  };

  const saveEdit = async (record, patch) => {
    const current = live.current;
    if (!current.joboLoaded || !current.joboWritable || current.pendingIds.includes(record.id)) return;
    setError('');
    try {
      const next = prepareDoEdit({ records: current.joboRecords, record, patch, now: Date.now() });
      if (!next) { setError(t('jobo.view.recordChanged')); return; }
      await commitDoEdit(writer.write, next);
    } catch (failure) {
      setError(t(failure.code === 'recordChanged' ? 'jobo.view.recordChanged' : 'jobo.view.updateFailed'));
    }
  };

  // Keep an estimate as shown: the same timed write a move or an editor save
  // makes, under the same id, with the times the card displays.
  const keepEstimate = (item) => {
    if (!item.estimate) return;
    saveEdit(item.record, timedPatch(item.date, item.startMinute, item.endMinute));
  };

  // The editor's props, as both views render it.
  const editorProps = editor ? {
    ...editor,
    taskCompleted: model.resolveRecordTask(editor.record)?.completed === true,
    onCompleteTask: completeTaskFor(editor.record),
    // "Make a task" from an unlinked Do, where the app offers it (App.jsx
    // openMakeTask, only while the ledger can take the link).
    onMakeTask: editor.record && canLinkDo(editor.record) && typeof ctx.openMakeTask === 'function'
      ? () => ctx.openMakeTask(editor.record) : undefined,
    linkCandidates: editor.record ? undefined : linkCandidates,
    records: joboRecords || [],
    writable: joboWritable,
    recordJobo: writer.write,
    onClose: closeEditor,
    pendingIds: writer.pendingIds,
  } : null;

  return {
    writer, editor, editorProps, error, setError,
    openAdd, openEdit, openContinue, keepEstimate, saveEdit, closeEditor,
  };
}
