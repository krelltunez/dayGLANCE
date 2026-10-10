import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { completionMarker } from '../../jobo/completionMarker.js';
import { CheckCircle2, Link2, ListPlus, Trash2, X } from 'lucide-react';
import ClockTimePicker from '../ClockTimePicker.jsx';
import DatePicker from '../DatePicker.jsx';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { formatLocalizedDate } from '../../utils/localeFormatting.js';
import { canCompleteDo, DO_PROGRESS, DO_TIMING } from '../../jobo/core.js';
import { doIntervalAt, prepareDoDelete, commitDoEdit } from '../../jobo/viewActions.js';
import { createManualDo, prepareDoEdit } from '../../jobo/viewActions.js';
import { receiptState } from '../../hooks/useJoboViewWriter.js';
import SuggestionAutocomplete from '../SuggestionAutocomplete.jsx';
import { matchDoLinks, linkFor, doTagSuggestions, completeDoTag } from '../../jobo/linkCandidates.js';
import { stripWikilinks, stripWikilinksAndTags } from '../../utils/taskUtils.js';
import useBackClose, { ABOVE_EDITORS } from '../../hooks/useBackClose.js';

const PROGRESS = [DO_PROGRESS.STARTED, DO_PROGRESS.PARTIAL, DO_PROGRESS.MOSTLY, DO_PROGRESS.COMPLETED];
const minute = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
// An end before the start is the next day, the way people read "23:00 to
// 01:00". The form has no separate end-date field. An end equal to the start
// stays on the same day, so core refuses it as an empty interval rather than
// the form quietly recording 24 hours.
export const endDateFor = (date, startTime, endTime) => {
  if (!date || !startTime || !endTime || minute(endTime) >= minute(startTime)) return date;
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
};

// Styled after DesktopNewTaskModal: the same shell, labels, inputs, footer
// and keyboard hint, and the app's own DatePicker and ClockTimePicker opened
// from buttons exactly as the new-task modal opens them, so adding a Do reads
// like adding a task.
/**
 * `sheet`: the phone's form of the editor (JOBO slice 8, step 2), a sheet
 * from the bottom of the screen that the phone's back closes, and that opens
 * without bringing up the keyboard.
 */
/**
 * Close the editor, then open the task form ("Make a task"). As a sheet the
 * editor leaves through its back entry a tick after it closes
 * (hooks/useBackClose.js); the form copies the state it opens on, so that
 * late pop would land on the form and close it. Wait for the pop, with a
 * short fallback for when there is none.
 */
export function makeTaskAfterClose({ sheet, onClose, onMakeTask, win = typeof window === 'undefined' ? null : window }) {
  onClose();
  if (!sheet || !win) { onMakeTask(); return; }
  let done = false;
  const open = () => {
    if (done) return;
    done = true;
    win.removeEventListener('popstate', open);
    onMakeTask();
  };
  win.addEventListener('popstate', open);
  win.setTimeout(open, 500);
}

export default function DoEditor({ record, taskCompleted = false, onCompleteTask, onMakeTask, initial, linkCandidates = [], records, writable, recordJobo, onClose, pendingIds = [], t, cardBg, textPrimary, textSecondary = '', borderClass, darkMode = false, sheet = false }) {
  const [id] = useState(() => record?.id || `manual:${crypto.randomUUID()}`);
  const marker = completionMarker(record);
  const [draft, setDraft] = useState(() => ({
    title: record?.title || initial?.title || '',
    progress: record?.progress || DO_PROGRESS.STARTED,
    ...(record ? {
      timing: record.timing, date: marker?.date || record.date, startTime: record.startTime || '',
      endDate: record.endDate || marker?.date || record.date, endTime: record.endTime || marker?.time || '',
    } : doIntervalAt(initial.date, initial.startMinute, initial.duration || 30)),
    ...initial?.patch,
  }));
  // What the form opened with, so "Complete task" can tell unsaved changes.
  const openedDraft = useRef(draft);
  const [saving, setSaving] = useState(false);
  // The phone's back closes the sheet, as it does any sheet; a picker open
  // above it (z-[90]) takes back first.
  useBackClose({ open: sheet, key: 'joboDoEditor', onClose: () => { if (!saving) onClose(); }, coveredBy: ABOVE_EDITORS });
  const [picker, setPicker] = useState(null); // 'date' | 'startTime' | 'endTime'
  const { formatTime, use24HourClock, isTablet, allTags = [] } = useDayPlannerCtx() || {};
  const showTime = (value) => (value ? (formatTime ? formatTime(value) : value) : '—');
  const [error, setError] = useState('');
  const [accepted, setAccepted] = useState(false);
  const waiting = accepted || pendingIds.includes(id);
  const submitted = useRef(null);
  const savingRef = useRef(false);
  const dialogRef = useRef(null);
  const latestRecords = useRef(records);
  latestRecords.current = records;
  const set = (key) => (event) => setDraft((prev) => ({ ...prev, [key]: event.target.value }));
  // A new Do can be linked to a task by picking it from the suggestions under
  // the title: it then carries that task and its plan, and groups with the
  // task's other attempts instead of reading as unplanned work. A Continue
  // arrives already linked; an existing Do's link is fixed.
  const [link, setLink] = useState(() => (initial?.task
    ? { task: initial.task, planSnapshot: initial.planSnapshot ?? null, title: initial.title, fixed: true }
    : null));
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestIndex, setSuggestIndex] = useState(-1);
  const canLink = !record && !link?.fixed;
  // An unlinked new Do takes #tags in its title the way a new task does:
  // typing # offers the app's existing tags, and Tab or Space completes one.
  // A linked Do carries its task's title, tags included, so it offers none.
  const titleRef = useRef(null);
  const [cursor, setCursor] = useState(null);
  const [tagIndex, setTagIndex] = useState(0);
  const tagMatches = !record && !link && suggestOpen ? doTagSuggestions(draft.title, cursor, allTags) : [];
  const applyTag = (tag) => {
    const next = completeDoTag(draft.title, cursor ?? draft.title.length, tag);
    setDraft((prev) => ({ ...prev, title: next.title }));
    setCursor(next.cursor);
    setTagIndex(0);
    setTimeout(() => {
      titleRef.current?.focus();
      titleRef.current?.setSelectionRange(next.cursor, next.cursor);
    }, 0);
  };
  // While a tag is being typed, its suggestions replace the task ones.
  const matches = canLink && suggestOpen && !tagMatches.length ? matchDoLinks(linkCandidates, draft.title) : [];
  // Where the task sits: its time on the day (or all day), then its goal and
  // project. A project task in the Inbox is named by its project, not "Inbox".
  const where = ({ task, where: place, path }) => {
    const project = path ? [path.goal, path.project].filter(Boolean).join(' › ') : null;
    const when = place === 'inbox'
      ? (project ? null : t('jobo.view.linkInbox'))
      : task.isAllDay || !task.startTime ? t('jobo.view.linkAllDay') : showTime(task.startTime);
    return [when, project].filter(Boolean).join(' · ');
  };
  const pick = (candidate) => {
    setLink({ ...linkFor(candidate.task), title: candidate.task.title, where: where(candidate), typed: draft.title });
    setDraft((prev) => ({ ...prev, title: candidate.task.title }));
    setSuggestOpen(false);
    setSuggestIndex(-1);
  };
  const onTitleKeyDown = (event) => {
    if (tagMatches.length) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setTagIndex((i) => (event.key === 'ArrowDown' ? Math.min(tagMatches.length - 1, i + 1) : Math.max(0, i - 1)));
      } else if (event.key === 'Tab' || event.key === ' ') {
        event.preventDefault();
        applyTag(tagMatches[Math.min(tagIndex, tagMatches.length - 1)]);
      } else if (event.key === 'Escape') {
        event.stopPropagation();
        setSuggestOpen(false);
      }
      return;
    }
    if (!matches.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      // Nothing is highlighted until an arrow key is used, so Enter still
      // saves an unlinked Do; Up from the first entry returns to none.
      setSuggestIndex((i) => (event.key === 'ArrowDown' ? Math.min(matches.length - 1, i + 1) : Math.max(-1, i - 1)));
    } else if (event.key === 'Enter' && suggestIndex >= 0 && suggestIndex < matches.length) {
      event.preventDefault();
      pick(matches[suggestIndex]);
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      setSuggestOpen(false);
      setSuggestIndex(-1);
    }
  };

  useEffect(() => {
    const previous = document.activeElement;
    // A sheet takes focus itself, so the keyboard comes up only on a tap.
    if (sheet) dialogRef.current?.focus();
    else dialogRef.current?.querySelector('input:not(:disabled),select,button')?.focus();
    return () => previous?.isConnected && previous.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!accepted || pendingIds.includes(id) || !submitted.current) return;
    const state = receiptState(submitted.current, records);
    if (state === 'saved') onClose();
    else if (state === 'superseded') { setAccepted(false); setError(t('jobo.view.recordChanged')); }
  }, [accepted, pendingIds, id, onClose, records, t]);

  const save = async (remove = false) => {
    if (!writable || waiting || savingRef.current) return;
    if (!remove && completionUnavailable) { setError(t('jobo.view.completionUnavailable')); return; }
    if (!remove && !draft.title.trim()) { setError(t('jobo.view.titleRequired')); return; }
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      const now = Date.now();
      const hasInterval = !!draft.startTime && !!draft.endTime;
      const keepsPoint = marker && !draft.startTime && draft.date === marker.date && draft.endTime === marker.time;
      if (!remove && !hasInterval && !keepsPoint) throw new TypeError('A complete interval is required');
      const endDate = endDateFor(draft.date, draft.startTime, draft.endTime);
      const patch = hasInterval
        ? { timing: DO_TIMING.TIMED, date: draft.date, startTime: draft.startTime, endDate, endTime: draft.endTime }
        : {};
      let next;
      if (remove) next = prepareDoDelete({ records: latestRecords.current, record, now });
      else if (record) next = prepareDoEdit({ records: latestRecords.current, record, patch, progress: draft.progress, now, taskCompleted });
      else {
        const duration = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${draft.date}T00:00:00Z`)) / 60000
          + minute(draft.endTime) - minute(draft.startTime);
        next = createManualDo({ id, title: draft.title.trim(), task: link?.task ?? null, planSnapshot: link?.planSnapshot ?? null,
          date: draft.date, startMinute: minute(draft.startTime), duration, progress: draft.progress, now });
      }
      if (!next) { setError(t('jobo.view.recordChanged')); return; }
      submitted.current = next;
      const result = next !== record ? await commitDoEdit(recordJobo, next) : { ok: true };
      if (result.held && !result.ok) setAccepted(true);
      else onClose();
    } catch (err) {
      setError(t(err.code === 'completionUnavailable' ? 'jobo.view.completionUnavailable' : err.code === 'readOnly' ? 'jobo.view.readOnly' : err.code === 'notLoaded' ? 'jobo.view.loadError' : err instanceof TypeError || err instanceof RangeError ? 'jobo.view.completeInterval' : 'jobo.view.updateFailed'));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const onKeyDown = (event) => {
    if (event.key === 'Escape') { event.stopPropagation(); if (picker) { setPicker(null); return; } if (!saving) onClose(); }
    if (event.key !== 'Tab') return;
    const fields = [...dialogRef.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)')];
    const target = event.shiftKey ? fields.at(-1) : fields[0];
    if (document.activeElement === (event.shiftKey ? fields[0] : fields.at(-1))) {
      event.preventDefault(); target?.focus();
    }
  };
  const completionAllowed = canCompleteDo(record || {
    source: 'manual', taskId: link?.task?.recurringTemplateId ?? link?.task?.id ?? null,
  }, { taskCompleted });
  // Linking a new manual Do may invalidate a previously chosen Completed.
  // Keep the choice visible, explain it, and require an explicit new choice;
  // neither silently downgrade the draft nor defer the error until save.
  const completionUnavailable = draft.progress === DO_PROGRESS.COMPLETED
    && record?.progress !== DO_PROGRESS.COMPLETED && !completionAllowed;
  // The hint under Progress appears only when Completed is out of reach, and
  // says what to do instead. A Completed record keeps its own reassurance.
  const progressHint = (() => {
    if (!record) return null;
    if (record.progress === DO_PROGRESS.COMPLETED) return 'jobo.view.completedStays';
    if (completionAllowed) return null;
    if (record.source === 'completion') return 'jobo.view.checkTaskAgain';
    if (record.taskId == null) return null;
    if (onCompleteTask) return 'jobo.view.completeTaskInstead';
    return taskCompleted ? 'jobo.view.taskAlreadyDone' : 'jobo.view.linkedNoCompletion';
  })();
  const progressOptions = PROGRESS.filter(value => value !== DO_PROGRESS.COMPLETED
    || record?.progress === DO_PROGRESS.COMPLETED || completionAllowed || draft.progress === DO_PROGRESS.COMPLETED);

  const input = `w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'}`;
  const label = `block text-sm ${textSecondary} mb-1`;
  const kbd = `px-1.5 py-0.5 ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} rounded`;
  const busy = saving || waiting || !writable;

  return createPortal(<div className={`fixed inset-0 bg-black/50 flex justify-center z-[80] ${sheet ? 'items-end' : 'items-center'}`} onMouseDown={(event) => {
    if (event.target === event.currentTarget && !saving) onClose();
  }}>
    <section ref={dialogRef} onKeyDown={onKeyDown} role="dialog" aria-modal="true" aria-labelledby="jobo-do-editor-title"
      tabIndex={sheet ? -1 : undefined} data-jobo-do-editor={sheet ? 'sheet' : 'dialog'}
      className={sheet
        ? `${cardBg} rounded-t-2xl shadow-xl px-5 pt-3 ${borderClass} border-t w-full max-h-[88vh] overflow-y-auto outline-none`
        : `${cardBg} rounded-lg shadow-xl p-6 ${borderClass} border max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto`}
      style={sheet ? { paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' } : undefined}>
      {sheet && <div className={`mx-auto mb-3 h-1 w-10 rounded-full ${darkMode ? 'bg-gray-600' : 'bg-stone-300'}`} aria-hidden="true" />}
      <h3 id="jobo-do-editor-title" className={`font-semibold ${textPrimary} mb-4 text-lg`}>{record ? t('common.edit') : initial?.continuing ? t('jobo.view.continueDo') : t('jobo.view.addDo')}</h3>
      <form onSubmit={(event) => { event.preventDefault(); save(); }}>
        <fieldset disabled={busy} className="space-y-4">
          <div>
            <label className={label} htmlFor="jobo-do-title">{t('task.title')}</label>
            <div className="relative">
              {/* A linked title is the task's own and is saved as written;
                  the field shows it as it reads, and Unlink makes it editable. */}
              <input id="jobo-do-title" ref={titleRef} className={input} required autoComplete="off"
                value={link && !record ? stripWikilinks(draft.title) : draft.title}
                readOnly={!!link && !record}
                onChange={(event) => { set('title')(event); setCursor(event.target.selectionStart); setSuggestOpen(true); setSuggestIndex(-1); setTagIndex(0); }}
                onSelect={(event) => setCursor(event.target.selectionStart)}
                onKeyDown={onTitleKeyDown}
                onBlur={() => setSuggestOpen(false)}
                aria-autocomplete={canLink ? 'list' : undefined}
                aria-expanded={canLink ? matches.length > 0 : undefined}
                disabled={!!record || saving} />
              {tagMatches.length > 0 && (
                <SuggestionAutocomplete
                  suggestions={tagMatches.map((tag) => ({ type: 'tag', value: tag, display: `#${tag}` }))}
                  selectedIndex={Math.min(tagIndex, tagMatches.length - 1)}
                  onSelect={(suggestion) => applyTag(suggestion.value)}
                  cardBg={cardBg}
                  borderClass={borderClass}
                  textPrimary={textPrimary}
                  hoverBg={darkMode ? 'hover:bg-gray-700' : 'hover:bg-stone-100'}
                  fullWidth
                />
              )}
              {matches.length > 0 && (
                <SuggestionAutocomplete
                  suggestions={matches.map((candidate) => ({
                    type: 'task',
                    value: candidate.task.id,
                    display: stripWikilinksAndTags(candidate.task.title),
                    detail: where(candidate),
                    icon: <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${candidate.task.color || 'bg-blue-500'}`} aria-hidden="true" />,
                  }))}
                  selectedIndex={suggestIndex}
                  onSelect={(suggestion) => pick(matches.find((candidate) => candidate.task.id === suggestion.value))}
                  cardBg={cardBg}
                  borderClass={borderClass}
                  textPrimary={textPrimary}
                  hoverBg={darkMode ? 'hover:bg-gray-700' : 'hover:bg-stone-100'}
                  fullWidth
                />
              )}
            </div>
            {record && <p className={`mt-1 text-xs ${textSecondary}`}>{t('jobo.view.capturedTitle')}</p>}
            {!record && link && (
              <p data-jobo-link className={`mt-1.5 text-xs ${textSecondary} flex items-start gap-1 min-w-0`}>
                <Link2 size={12} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
                {/* Wraps rather than truncating, so a long goal and project
                    path stays readable. */}
                <span className="min-w-0 break-words">{t('jobo.view.linkedTo', { title: stripWikilinksAndTags(link.title) })}{link.where ? ` · ${link.where}` : ''}</span>
                {!link.fixed && (
                  <button type="button" className={`ml-1 underline flex-shrink-0 ${darkMode ? 'hover:text-white' : 'hover:text-stone-900'}`}
                    onClick={() => { setDraft((prev) => ({ ...prev, title: link.typed ?? prev.title })); setLink(null); }}>{t('jobo.view.unlink')}</button>
                )}
              </p>
            )}
            {canLink && !link && <p className={`mt-1.5 text-xs ${textSecondary}`}>{t('jobo.view.linkHint')}</p>}
          </div>
          {marker && <p className={`text-xs ${textSecondary}`}>{t('jobo.view.completionPoint', { time: `${marker.date} ${marker.time}` })}</p>}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <span className={label}>{t('common.date')}</span>
              <button type="button" id="jobo-do-date" className={`${input} text-left`} disabled={saving} onClick={() => setPicker('date')}>
                {draft.date ? formatLocalizedDate(new Date(`${draft.date}T12:00:00`), { month: 'short', day: 'numeric' }) : '—'}
              </button>
            </div>
            <div>
              <span className={label}>{t('common.start')}</span>
              <div className="relative">
                <button type="button" id="jobo-do-start" className={`${input} text-left`} disabled={saving} onClick={() => setPicker('startTime')}>
                  {showTime(draft.startTime)}
                </button>
                {/* A completion can stay a moment: clearing the start keeps it untimed. */}
                {marker && draft.startTime && (
                  <button type="button" className={`absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded ${darkMode ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}
                    aria-label={`${t('common.clear')}: ${t('common.start')}`} title={t('common.clear')}
                    onClick={() => setDraft((prev) => ({ ...prev, startTime: '', endTime: marker.time, date: marker.date }))}>
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>
            <div>
              <span className={label}>{t('common.end')}</span>
              <button type="button" id="jobo-do-end" className={`${input} text-left`} disabled={saving} onClick={() => setPicker('endTime')}>
                {showTime(draft.endTime)}
              </button>
            </div>
          </div>
          <div>
            <label className={label} htmlFor="jobo-do-progress">{t('jobo.view.progressLabel')}</label>
            <select id="jobo-do-progress" className={input} value={draft.progress} onChange={set('progress')} disabled={saving}>
              {progressOptions.map((value) => <option key={value} value={value} disabled={value === DO_PROGRESS.COMPLETED && completionUnavailable}>{value === DO_PROGRESS.COMPLETED ? t('common.completed') : t(`jobo.view.progress.${value}`)}</option>)}
            </select>
            {/* On a Completed record the rule reads as a limit it is not:
                saving new times keeps it Completed. */}
            {completionUnavailable
              ? <p className={`mt-1 text-xs ${textSecondary}`} role="status">{t('jobo.view.completionUnavailable')}</p>
              : progressHint && <p data-jobo-progress-hint className={`mt-1 text-xs ${textSecondary}`}>{t(progressHint)}</p>}
          </div>
          {/* The linked task's own checkbox, placed here. It checks the task off
              through the app's handler and closes; the completion then arrives
              as its own Do, and this one stays as recorded. Unsaved changes
              would be lost, so they come first. */}
          {onCompleteTask && (() => {
            const unsaved = JSON.stringify(draft) !== JSON.stringify(openedDraft.current);
            return (
              <div data-jobo-complete-task>
                <button type="button" disabled={unsaved}
                  className={`w-full px-4 py-2 border ${borderClass} rounded-lg flex items-center justify-center gap-2 ${textPrimary} ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-stone-100'} disabled:opacity-50 transition-colors`}
                  onClick={() => { onCompleteTask(); onClose(); }}>
                  <CheckCircle2 size={16} className="text-green-500" aria-hidden="true" />{t('jobo.view.completeTask')}
                </button>
                <p className={`mt-1 text-xs ${textSecondary}`}>{t(unsaved ? 'jobo.view.completeTaskSaveFirst' : 'jobo.view.completeTaskHint')}</p>
              </div>
            );
          })()}
          {/* "Make a task" from unlinked work: the new-task form, which links
              this Do once the task is saved. It links the Do as opened, so
              unsaved changes come first, as for Complete task. */}
          {onMakeTask && (() => {
            const unsaved = JSON.stringify(draft) !== JSON.stringify(openedDraft.current);
            return (
              <div data-jobo-make-task>
                <button type="button" disabled={unsaved}
                  className={`w-full px-4 py-2 border ${borderClass} rounded-lg flex items-center justify-center gap-2 ${textPrimary} ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-stone-100'} disabled:opacity-50 transition-colors`}
                  onClick={() => makeTaskAfterClose({ sheet, onClose, onMakeTask })}>
                  <ListPlus size={16} className="text-blue-500" aria-hidden="true" />{t('jobo.makeTask')}
                </button>
                <p className={`mt-1 text-xs ${textSecondary}`}>{t(unsaved ? 'jobo.view.completeTaskSaveFirst' : 'jobo.makeTaskHint')}</p>
              </div>
            );
          })()}
        </fieldset>
        {waiting && <p className={`mt-3 text-xs ${textSecondary}`} role="status">{t('jobo.view.pendingSave')}</p>}
        {error && <p className={`mt-3 p-2 rounded-lg text-sm ${darkMode ? 'bg-red-900/30 text-red-300' : 'bg-red-50 text-red-700'}`} role="alert">{error}</p>}
        <div className="flex gap-2 pt-4">
          <button type="submit" className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50" disabled={busy || completionUnavailable}>
            {saving ? t('common.loading') : record ? t('common.save') : t('jobo.view.addDo')}
          </button>
          {record && (
            <button type="button" className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-1"
              onClick={() => save(true)} disabled={busy}>
              <Trash2 size={14} />{t('common.delete')}
            </button>
          )}
          <button type="button" onClick={onClose} disabled={saving}
            className={`px-4 py-2 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-200 hover:bg-stone-300'} ${textPrimary} rounded-lg transition-colors`}>
            {t(waiting ? 'common.close' : 'common.cancel')}
          </button>
        </div>
        {!sheet && (
          <div className={`mt-3 text-xs ${textSecondary} text-center`}>
            <kbd className={kbd}>Enter</kbd> {t('common.save')} • <kbd className={kbd}>Esc</kbd> {t('common.cancel')}
          </div>
        )}
      </form>
      {picker === 'date' && (
        <DatePicker value={draft.date} onChange={(date) => setDraft((prev) => ({ ...prev, date }))} onClose={() => setPicker(null)} />
      )}
      {(picker === 'startTime' || picker === 'endTime') && (
        <ClockTimePicker
          value={draft[picker] || marker?.time || draft.startTime || '09:00'}
          onChange={(value) => setDraft((prev) => ({ ...prev, [picker]: value }))}
          onClose={() => setPicker(null)}
          darkMode={darkMode}
          isTablet={isTablet ?? false}
          use24HourClock={use24HourClock}
        />
      )}
    </section>
  </div>, document.body);
}
