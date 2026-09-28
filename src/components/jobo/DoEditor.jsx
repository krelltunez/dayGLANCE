import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { completionMarker } from '../../jobo/completionMarker.js';
import { Link2, Trash2, X } from 'lucide-react';
import ClockTimePicker from '../ClockTimePicker.jsx';
import DatePicker from '../DatePicker.jsx';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { formatLocalizedDate } from '../../utils/localeFormatting.js';
import { canCompleteDo, DO_PROGRESS, DO_TIMING } from '../../jobo/core.js';
import { doIntervalAt, prepareDoDelete, commitDoEdit } from '../../jobo/viewActions.js';
import { createManualDo, prepareDoEdit } from '../../jobo/viewActions.js';
import { receiptState } from '../../hooks/useJoboViewWriter.js';
import SuggestionAutocomplete from '../SuggestionAutocomplete.jsx';
import { matchDoLinks, linkFor } from '../../jobo/linkCandidates.js';
import { stripWikilinks, stripWikilinksAndTags } from '../../utils/taskUtils.js';

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
export default function DoEditor({ record, taskCompleted = false, initial, linkCandidates = [], records, writable, recordJobo, onClose, pendingIds = [], t, cardBg, textPrimary, textSecondary = '', borderClass, darkMode = false }) {
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
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState(null); // 'date' | 'startTime' | 'endTime'
  const { formatTime, use24HourClock, isTablet } = useDayPlannerCtx() || {};
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
  const matches = canLink && suggestOpen ? matchDoLinks(linkCandidates, draft.title) : [];
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
    dialogRef.current?.querySelector('input:not(:disabled),select,button')?.focus();
    return () => previous?.isConnected && previous.focus();
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
  const progressOptions = PROGRESS.filter(value => value !== DO_PROGRESS.COMPLETED
    || record?.progress === DO_PROGRESS.COMPLETED || completionAllowed || draft.progress === DO_PROGRESS.COMPLETED);

  const input = `w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'}`;
  const label = `block text-sm ${textSecondary} mb-1`;
  const kbd = `px-1.5 py-0.5 ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} rounded`;
  const busy = saving || waiting || !writable;

  return createPortal(<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[80]" onMouseDown={(event) => {
    if (event.target === event.currentTarget && !saving) onClose();
  }}>
    <section ref={dialogRef} onKeyDown={onKeyDown} role="dialog" aria-modal="true" aria-labelledby="jobo-do-editor-title"
      className={`${cardBg} rounded-lg shadow-xl p-6 ${borderClass} border max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto`}>
      <h3 id="jobo-do-editor-title" className={`font-semibold ${textPrimary} mb-4 text-lg`}>{record ? t('common.edit') : initial?.continuing ? t('jobo.view.continueDo') : t('jobo.view.addDo')}</h3>
      <form onSubmit={(event) => { event.preventDefault(); save(); }}>
        <fieldset disabled={busy} className="space-y-4">
          <div>
            <label className={label} htmlFor="jobo-do-title">{t('task.title')}</label>
            <div className="relative">
              {/* A linked title is the task's own and is saved as written;
                  the field shows it as it reads, and Unlink makes it editable. */}
              <input id="jobo-do-title" className={input} required autoComplete="off"
                value={link && !record ? stripWikilinks(draft.title) : draft.title}
                readOnly={!!link && !record}
                onChange={(event) => { set('title')(event); setSuggestOpen(true); setSuggestIndex(-1); }}
                onKeyDown={onTitleKeyDown}
                onBlur={() => setSuggestOpen(false)}
                aria-autocomplete={canLink ? 'list' : undefined}
                aria-expanded={canLink ? matches.length > 0 : undefined}
                disabled={!!record || saving} />
              {matches.length > 0 && (
                <SuggestionAutocomplete
                  suggestions={matches.map((candidate) => ({
                    type: 'task',
                    value: candidate.task.id,
                    display: `${stripWikilinksAndTags(candidate.task.title)} · ${where(candidate)}`,
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
              <p data-jobo-link className={`mt-1.5 text-xs ${textSecondary} flex items-center gap-1 min-w-0`}>
                <Link2 size={12} className="flex-shrink-0" aria-hidden="true" />
                <span className="truncate">{t('jobo.view.linkedTo', { title: stripWikilinksAndTags(link.title) })}{link.where ? ` · ${link.where}` : ''}</span>
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
              : record && <p className={`mt-1 text-xs ${textSecondary}`}>{t(record.progress === DO_PROGRESS.COMPLETED ? 'jobo.view.completedStays' : 'jobo.view.completionUnavailable')}</p>}
          </div>
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
        <div className={`mt-3 text-xs ${textSecondary} text-center`}>
          <kbd className={kbd}>Enter</kbd> {t('common.save')} • <kbd className={kbd}>Esc</kbd> {t('common.cancel')}
        </div>
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
