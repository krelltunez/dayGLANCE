import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, ChevronUp, MoreHorizontal, NotebookPen, Plus, Star, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../../context/FeaturesContext.jsx';
import { renderTitleWithoutTags } from '../../utils/textFormatting.jsx';
import * as C from '../../utils/jobo.js';
import { MOBILE_HOUR_HEIGHT, latestMobileAttempt, mobileRecordDraft, mobileRecordSources, mobileScrollMinute, mobileTapTime, saveMobileRecord } from '../../utils/joboMobile.js';
import S from '../../jobo/store.js';
import './mobileJobo.css';

// This is an optional phone presentation, not a second task store. Task/date
// editors, daily notes, theme colours and navigation stay owned by dayGLANCE.
export default function MobileJoboView() {
  const ctx = useDayPlannerCtx();
  const features = useFeaturesCtx();
  const { t } = useTranslation();
  const state = useSyncExternalStore(S.subscribe, S.get, S.get);
  const storageError = useSyncExternalStore(S.subscribe, S.error, S.error);
  const [editor, setEditor] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [tools, setTools] = useState(false);
  const [message, setMessage] = useState('');
  const scroll = useRef(null);
  const date = C.dateString(ctx.selectedDate);
  const dayTasks = useMemo(() => ctx.getTasksForDate(ctx.selectedDate).filter(task =>
    !task.isExample && (!features.projectFilter || task.projectId === features.projectFilter)),
  [ctx, features.projectFilter]);
  const plans = dayTasks.filter(task => !task.isAllDay && C.schedule(task)).map(task => ({ ...task, ...C.schedule(task) }));
  const checklist = dayTasks.filter(task => !task.imported);
  const records = C.recordsOnDate(state, date).filter(record => !features.projectFilter || record.projectId === features.projectFilter);
  const sources = [...ctx.tasks, ...ctx.unscheduledTasks, ...(ctx.expandedRecurringTasks || [])];
  const nativeSources = mobileRecordSources(sources);
  const sourceFor = record => sources.find(task => String(task.id) === record?.sourceTaskId);
  const startAt = useRef(0);
  startAt.current = mobileScrollMinute([...plans, ...records], date, ctx.currentTime);

  useEffect(() => {
    try {
      S.capture([...ctx.tasks, ...dayTasks]);
      S.syncNotes([...ctx.tasks, ...ctx.unscheduledTasks, ...dayTasks]);
    } catch (error) { setMessage(error.message); }
  }, [ctx.tasks, ctx.unscheduledTasks, dayTasks]);

  useLayoutEffect(() => {
    if (scroll.current) scroll.current.scrollTop = startAt.current * MOBILE_HOUR_HEIGHT / 60;
  }, [date]);

  function openRecord(record) {
    setEditor({ record, source: sourceFor(record) });
  }
  function addPlan(time) {
    ctx.setNewTask({ title: '', date, startTime: time || mobileTapTime(ctx.currentTimeMinutes * MOBILE_HOUR_HEIGHT / 60), duration: 30, isAllDay: false, recurrence: null });
    ctx.setShowRecurrencePicker(false);
    ctx.setShowAddTask(true);
  }
  function exportJournal() {
    const blob = new Blob([JSON.stringify({
      format: 'dayglance-jobo-5.2', baseVersion: '5.2.0', ledger: S.get(),
      tasks: ctx.tasks, inbox: ctx.unscheduledTasks, dailyNotes: ctx.dailyNotes,
    }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `Jobo-${date}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setTools(false);
  }
  function lane(role, items) {
    return <div className="jobo-mobile-lane" data-mobile-lane={role}>
      {/* Empty slots are explicit touch targets. Native drag/resize remains in GRID. */}
      {Array.from({ length: 48 }, (_, index) => <button type="button" key={index}
        className={`jobo-mobile-slot border-b ${ctx.borderClass} ${index % 2 ? 'border-dashed' : ''}`}
        aria-label={`${t(role === 'plan' ? 'jobo.plan' : 'jobo.addDo')} ${C.clock(index * 30)}`}
        onClick={() => role === 'plan' ? addPlan(C.clock(index * 30)) : setEditor({ initial: C.clock(index * 30) })} />)}
      {C.lanes(items, MOBILE_HOUR_HEIGHT, 36).map(({ item, left, width }) => {
        const original = role === 'do' ? state.records.find(record => record.id === item.id) : item;
        const color = (role === 'do' ? sourceFor(item)?.color : null) || item.color || 'bg-blue-500';
        const end = C.clock(C.minutes(item.startTime) + item.duration);
        return <button type="button" key={item.id} data-mobile-card={role} data-record-id={item.id}
          className={`jobo-mobile-card text-white rounded-lg shadow-sm ${item.isTaskCalendar ? '' : color}`}
          style={{
            top: C.minutes(item.startTime) * MOBILE_HOUR_HEIGHT / 60,
            height: Math.max(36, item.duration * MOBILE_HOUR_HEIGHT / 60 - 2),
            left: `calc(${left * 100}% + 3px)`, width: `calc(${width * 100}% - 6px)`,
            ...(item.imported ? ctx.getTaskCalendarStyle(item, ctx.darkMode) : {}),
          }}
          aria-label={`${t(role === 'plan' ? 'jobo.plan' : 'jobo.do')}: ${item.title}, ${ctx.formatTime(item.startTime)}–${ctx.formatTime(end)}`}
          onClick={() => {
            if (role === 'do') openRecord(original);
            else if (item._native && item.nativeEventId) ctx.openMobileEditNativeEvent(item);
            else if (!item.imported) ctx.openMobileEditTask(item, false);
          }}>
          <span className="jobo-mobile-card-title">{renderTitleWithoutTags(item.title)}</span>
          {width >= .45 && <span className="jobo-mobile-card-time">{ctx.formatTime(item.startTime)}–{ctx.formatTime(end)}</span>}
        </button>;
      })}
    </div>;
  }
  return <section data-jobo-mobile className={`jobo-mobile ${ctx.textPrimary}`}>
    <section className={`jobo-mobile-tasks border-b ${ctx.borderClass}`}>
      <div className="jobo-mobile-section-title">
        <button type="button" className="jobo-mobile-list-toggle" onClick={() => setExpanded(value => !value)} aria-expanded={expanded} aria-controls="jobo-mobile-task-list">
          <Star size={14} className="text-orange-500" /><b>{t('joboMobile.tasks')}</b><span className={ctx.textSecondary}>{checklist.length}</span>
          {checklist.length > 3 && (expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
        </button>
        <button type="button" className={`jobo-mobile-icon ${ctx.hoverBg}`} aria-label={t('joboMobile.tools')} aria-expanded={tools} onClick={() => setTools(value => !value)}><MoreHorizontal size={18} /></button>
      </div>
      {tools && <div className={`jobo-mobile-tools border ${ctx.borderClass} rounded-lg`}>
        <button type="button" onClick={exportJournal}>{t('jobo.backup')}</button>
        <button type="button" onClick={() => { try { S.undo(); setTools(false); } catch (error) { setMessage(error.message); } }}>{t('jobo.undo')}</button>
      </div>}
      <div id="jobo-mobile-task-list">
        {(expanded ? checklist : checklist.slice(0, 3)).map(task => {
          const latest = latestMobileAttempt(state, task.id);
          const checked = latest && ['mostly', 'complete'].includes(latest.progress);
          return <div className="jobo-mobile-task-row" key={task.id}>
            <button type="button" className="jobo-mobile-record-task" aria-label={t('joboMobile.recordTask', { title: task.title })}
              onClick={() => latest ? openRecord(latest) : setEditor({ source: task })}>
              <span className={`jobo-mobile-check ${checked ? 'bg-blue-600 border-blue-600 text-white' : ctx.borderClass}`}>{checked && <Check size={13} />}</span>
            </button>
            <button type="button" className="jobo-mobile-task-name" onClick={() => ctx.openMobileEditTask(task, false)}>{renderTitleWithoutTags(task.title)}</button>
            <span aria-hidden="true" className={`jobo-mobile-color ${task.color || 'bg-blue-500'}`} />
          </div>;
        })}
      </div>
      <button type="button" className={`jobo-mobile-quick-add ${ctx.textSecondary} ${ctx.hoverBg}`} onClick={() => ctx.openNewAllDayTask(date)}><Plus size={16} />{t('joboMobile.addTask')}</button>
    </section>
    <section aria-label={t('joboMobile.view')} className="jobo-mobile-comparison">
      <div className={`jobo-mobile-head border-b ${ctx.borderClass}`}>
        <div><b>{t('jobo.plan')}</b><button type="button" className="jobo-mobile-icon text-orange-500" aria-label={t('joboMobile.addPlan')} onClick={() => addPlan()}><Plus size={18} /></button></div>
        <span />
        <div><b>{t('jobo.do')}</b><button type="button" className="jobo-mobile-icon text-blue-500" aria-label={t('jobo.addDo')} onClick={() => setEditor({})}><Plus size={18} /></button></div>
      </div>
      <div className={`jobo-mobile-timeline ${ctx.darkMode ? 'dark-scrollbar' : ''}`} ref={scroll} data-mobile-timeline>
        <div className="jobo-mobile-grid" style={{ height: 24 * MOBILE_HOUR_HEIGHT }}>
          {lane('plan', plans)}
          <div className={`jobo-mobile-axis ${ctx.cardBg}`} data-mobile-axis aria-label={t('joboMobile.timeAxis')}>
            {Array.from({ length: 25 }, (_, hour) => <div key={hour} className="jobo-mobile-hour" style={{ top: hour * MOBILE_HOUR_HEIGHT }}>
              <span className={`border ${ctx.borderClass} ${ctx.cardBg} ${ctx.textSecondary}`}>{String(hour).padStart(2, '0')}</span>
            </div>)}
          </div>
          {lane('do', records)}
          {date === C.dateString(ctx.currentTime) && <div className="jobo-mobile-now" aria-hidden="true" style={{ top: ctx.currentTimeMinutes * MOBILE_HOUR_HEIGHT / 60 }} />}
        </div>
      </div>
    </section>
    <section className={`jobo-mobile-notes border-t ${ctx.borderClass}`}>
      <div className="jobo-mobile-section-title"><b>{t('joboMobile.daily')}</b><NotebookPen size={15} className={ctx.textSecondary} /></div>
      <button type="button" data-mobile-daily-note className={`jobo-mobile-note-preview ${ctx.hoverBg} ${ctx.dailyNotes[date]?.text ? '' : ctx.textSecondary}`}
        aria-label={t('joboMobile.editNote')} onClick={() => ctx.setDailyNotesModalDate(date)}>
        {ctx.dailyNotes[date]?.text || t('joboMobile.notePlaceholder')}
      </button>
    </section>
    {(message || storageError) && <div role="alert" className="jobo-mobile-error">{message || storageError}<button type="button" aria-label={t('common.close')} onClick={() => setMessage('')}><X size={16} /></button></div>}
    {editor && <MobileRecordSheet key={`${date}:${editor.record?.id || editor.source?.id || 'new'}`} {...editor} date={date} sources={nativeSources}
      onClose={() => setEditor(null)} onSaved={() => { setEditor(null); setMessage(''); }}
      onRepeat={record => setEditor({ source: sourceFor(record), seed: { title: record.title, color: record.color, notes: record.notes } })} />}
  </section>;
}

function MobileRecordSheet({ record, source: initialSource, seed, initial, date, sources, onClose, onSaved, onRepeat }) {
  const ctx = useDayPlannerCtx();
  const { t } = useTranslation();
  const [source, setSource] = useState(initialSource);
  const [form, setForm] = useState(() => mobileRecordDraft({ record, source: initialSource, seed, date, initial, now: ctx.currentTime }));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const attemptId = useRef(null);
  const panel = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const inputClass = `${ctx.cardBg} border ${ctx.borderClass} ${ctx.textPrimary}`;
  const field = (key, value) => setForm(current => ({ ...current, [key]: value }));
  useLayoutEffect(() => {
    const previous = document.activeElement;
    const el = panel.current;
    // Existing records open on the close control (no keyboard jumping). A new
    // unlinked record focuses its title; linked records are one Save away.
    el.querySelector(record || initialSource ? 'button' : 'input')?.focus({ preventScroll: true });
    const keydown = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const controls = [...el.querySelectorAll('button, input, textarea, select, summary')].filter(item => !item.disabled && item.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    el.addEventListener('keydown', keydown);
    return () => { el.removeEventListener('keydown', keydown); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [record, initialSource]);
  // visualViewport is also what the native app's daily-note editor follows.
  useEffect(() => {
    const viewport = window.visualViewport;
    const resize = () => {
      if (panel.current) {
        panel.current.style.maxHeight = `${(viewport?.height || window.innerHeight) - 16}px`;
        panel.current.parentElement.style.paddingBottom = `${Math.max(0, window.innerHeight - (viewport?.height || window.innerHeight) - (viewport?.offsetTop || 0))}px`;
      }
    };
    resize(); viewport?.addEventListener('resize', resize); viewport?.addEventListener('scroll', resize);
    return () => { viewport?.removeEventListener('resize', resize); viewport?.removeEventListener('scroll', resize); };
  }, []);
  function save(event) {
    event.preventDefault();
    if (saving.current || event.nativeEvent?.isComposing) return;
    saving.current = true;
    setBusy(true);
    try {
      if (!attemptId.current) attemptId.current = crypto.randomUUID();
      const currentSource = sources.find(task => String(task.id) === String(source?.id)) || source;
      saveMobileRecord(S, { record, source: currentSource, form }, attemptId.current);
      onSaved();
    } catch (err) {
      const code = ['title', 'date', 'time', 'progress', 'missing'].includes(err.message) ? err.message : 'storage';
      setError(t(`joboMobile.error${code[0].toUpperCase()}${code.slice(1)}`));
      saving.current = false;
      setBusy(false);
    }
  }
  return createPortal(<div className="jobo-mobile-mask" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <form ref={panel} onSubmit={save} className={`jobo-mobile-sheet ${ctx.cardBg} ${ctx.textPrimary}`} role="dialog" aria-modal="true" aria-labelledby="jobo-mobile-sheet-title">
      <div className="jobo-mobile-sheet-title"><b id="jobo-mobile-sheet-title">{record ? t('jobo.record') : t('jobo.addDo')}</b><button type="button" className="jobo-mobile-icon" aria-label={t('common.close')} onClick={onClose}><X size={20} /></button></div>
      <label>{t('jobo.title')}<input className={inputClass} value={form.title} onChange={event => field('title', event.target.value)} required maxLength={2000} /></label>
      <label>{t('jobo.date')}<input className={inputClass} type="date" value={form.date} onChange={event => field('date', event.target.value)} required /></label>
      <div className="jobo-mobile-times"><label>{t('jobo.start')}<input className={inputClass} type="time" value={form.startTime} onChange={event => field('startTime', event.target.value)} required /></label><label>{t('jobo.end')}<input className={inputClass} type="time" value={form.end} onChange={event => field('end', event.target.value)} required /></label></div>
      {C.minutes(form.end) < C.minutes(form.startTime) && <small className={ctx.textSecondary}>{t('joboMobile.nextDay')}</small>}
      <details className="jobo-mobile-details"><summary>{t('joboMobile.details')}</summary>
      {!record && <label>{t('joboMobile.linkTask')}<select className={inputClass} value={source?.id || ''} onChange={event => {
        const task = sources.find(item => String(item.id) === event.target.value);
        setSource(task);
        if (task) setForm(current => ({ ...current, title: task.title, color: task.color || current.color, notes: task.notes || '' }));
      }}><option value="">{t('joboMobile.unlinked')}</option>{sources.map(task => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label>}
        <label>{t('jobo.progress')}<select className={inputClass} value={form.progress} onChange={event => field('progress', event.target.value)}>{C.PROGRESS.map(value => <option key={value} value={value}>{t(`jobo.${value}`)}</option>)}</select></label>
        <label>{t('jobo.custom')}<input className={inputClass} value={form.tags} onChange={event => field('tags', event.target.value)} /></label>
        {!source && <label>{t('jobo.notes')}<textarea className={inputClass} rows={3} value={form.notes} onChange={event => field('notes', event.target.value)} /></label>}
        {source && <button type="button" className={`jobo-mobile-source-note ${ctx.hoverBg}`} onClick={() => { onClose(); ctx.openMobileEditTask(source, ctx.unscheduledTasks.some(task => task.id === source.id)); }}>{t('joboMobile.sourceNotes')}</button>}
        <div className="jobo-mobile-colors">{ctx.colors.map(color => <button key={color.class} type="button" aria-label={t(`colors.${color.name.toLowerCase()}`, { defaultValue: color.name })} aria-pressed={form.color === color.class} className={`jobo-mobile-color-choice ${color.class} ${form.color === color.class ? 'ring-2 ring-blue-500 ring-offset-2' : ''}`} onClick={() => field('color', color.class)} />)}</div>
      </details>
      {error && <p role="alert" className="text-red-500 text-sm">{error}</p>}
      {record && <button type="button" data-mobile-repeat className={`flex items-center justify-center gap-2 w-full min-h-[44px] rounded-lg text-[13px] mt-1 border ${ctx.borderClass} ${ctx.hoverBg}`} onClick={() => onRepeat(record)}><Plus size={16} />{t('jobo.addDo')}</button>}
      <div className="jobo-mobile-sheet-actions">
        {record && <button type="button" className="jobo-mobile-icon text-red-500" aria-label={t('jobo.remove')} onClick={() => {
          if (!window.confirm(t('joboMobile.deleteConfirm'))) return;
          try { S.remove(record.id); onSaved(); } catch { setError(t('joboMobile.errorStorage')); }
        }}><Trash2 size={18} /></button>}
        <button type="button" className={`border ${ctx.borderClass} ${ctx.hoverBg}`} onClick={onClose}>{t('jobo.cancel')}</button>
        <button type="submit" disabled={busy} className="bg-blue-600 text-white hover:bg-blue-700">{t('jobo.save')}</button>
      </div>
    </form>
  </div>, document.body);
}
