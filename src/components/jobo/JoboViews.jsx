import React, { useState, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Check, Clock, FileText, Pencil, Trash2, Plus, X, ChevronDown, Save, Undo2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DayPlannerContext, useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../../context/FeaturesContext.jsx';
import NativeTaskContent from '../TimelineTaskCardContent.jsx';
import NativeWeekView from '../WeekView.jsx';
import { renderTitle } from '../../utils/textFormatting.jsx';
import { frameColorBg, frameColorBorder } from '../../utils/colorUtils.js';
import * as C from '../../utils/jobo.js';
import S from '../../jobo/store.js';
import './jobo.css';
const I = {
  check: Check,
  clock: Clock,
  notes: FileText,
  edit: Pencil,
  trash: Trash2,
  plus: Plus,
  close: X,
  down: ChevronDown,
  save: Save,
  undo: Undo2
};
/* Uses native dayGLANCE React contexts, task-card content/actions, calendar colours and Week column. */

const statusColors = {
  within: '#23844c',
  delayed: '#c36a18',
  overrun: '#b38b12',
  notStarted: '#c44245',
  unplanned: '#8755bd',
  interrupted: '#258c9b'
};
const progressColors = {
  started: '#d97722',
  partial: '#c79d23',
  mostly: '#87ad5d',
  complete: '#3d965e'
};
function useLang() {
  return useTranslation().t;
}
function useLedger() {
  return useSyncExternalStore(S.subscribe, S.get, S.get);
}
function useTick() {
  const [now, set] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => set(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
  return now;
}
function icon(name, size = 12) {
  const Comp = I[name] || I.clock;
  return <Comp size={size} />;
}
function notify(message) {
  window.dispatchEvent(new CustomEvent('jobo-message', {
    detail: message
  }));
}
function safe(fn) {
  try {
    return fn();
  } catch (e) {
    notify(String(e.message || e));
    return null;
  }
}
function useToast() {
  const [text, set] = useState('');
  useEffect(() => {
    let timer;
    const handle = e => {
      set(e.detail);
      clearTimeout(timer);
      timer = setTimeout(() => set(''), 6000);
    };
    window.addEventListener('jobo-message', handle);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('jobo-message', handle);
    };
  }, []);
  return text;
}
function duration(n, t) {
  return t('jobo.minutes', {
    count: n
  });
}
function sourceTask(ctx, id) {
  return [...ctx.tasks, ...ctx.unscheduledTasks, ...(ctx.expandedRecurringTasks || [])].find(x => String(x.id) === String(id));
}
function Badge({
  status,
  progress = false,
  children
}) {
  const t = useLang(),
    color = (progress ? progressColors : statusColors)[status];
  return <span className="jobo-badge" style={{
    '--badge-color': color
  }} title={t(`jobo.${status}`)}>{progress ? icon('check', 9) : icon('clock', 9)}{children || t(`jobo.${status}`)}</span>;
}
function Progress({
  record
}) {
  const t = useLang(),
    ctx = useDayPlannerCtx(),
    anchor = useRef(null),
    menu = useRef(null),
    [open, setOpen] = useState(false),
    [position, setPosition] = useState({
      left: 0,
      top: 0
    });
  const items = useRef([]);
  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const place = () => {
      if (!anchor.current) return;
      const box = anchor.current.getBoundingClientRect();
      const width = menu.current?.offsetWidth || 180,
        height = menu.current?.offsetHeight || 128;
      const next = {
        left: Math.max(8, Math.min(box.left, window.innerWidth - width - 8)),
        top: box.bottom + height + 8 < window.innerHeight ? box.bottom + 4 : Math.max(8, box.top - height - 4)
      };
      setPosition(prev => prev.left === next.left && prev.top === next.top ? prev : next);
    };
    place();
    items.current[C.PROGRESS.indexOf(record.progress)]?.focus({
      preventScroll: true
    });
    const outside = e => {
      if (!anchor.current?.contains(e.target) && !menu.current?.contains(e.target)) setOpen(false);
    };
    // Layout/scroll can happen while opening a popup, especially in narrow translated rows.
    // Keep it anchored rather than discarding the click before the user can choose.
    const scroll = e => {
      if (!menu.current?.contains(e.target)) place();
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', scroll);
    document.addEventListener('scroll', scroll, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', scroll);
      document.removeEventListener('scroll', scroll, true);
    };
  }, [open, record.progress]);
  if (!record) return null;
  const close = () => {
    setOpen(false);
    anchor.current?.focus({
      preventScroll: true
    });
  };
  const choose = p => {
    safe(() => S.update(record.id, {
      progress: p
    }));
    close();
  };
  function keys(e) {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
    const delta = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (delta) {
      e.preventDefault();
      const i = items.current.indexOf(document.activeElement);
      items.current[(i + delta + C.PROGRESS.length) % C.PROGRESS.length]?.focus();
    }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      items.current[e.key === 'Home' ? 0 : C.PROGRESS.length - 1]?.focus();
    }
  }
  return <><button ref={anchor} type="button" data-jobo-progress={record.id} className="jobo-badge jobo-progress" style={{
      '--badge-color': progressColors[record.progress]
    }} aria-label={`${t('jobo.progress')} ${record.startTime}–${C.clock(C.minutes(record.startTime) + record.duration)}`} aria-haspopup="listbox" aria-expanded={open} title={`${record.startTime}–${C.clock(C.minutes(record.startTime) + record.duration)} · ${t('jobo.progress')}: ${t(`jobo.${record.progress}`)}`} onPointerDown={e => e.stopPropagation()} onClick={e => {
      e.stopPropagation();
      setOpen(v => !v);
    }} onKeyDown={e => {
      e.stopPropagation();
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setOpen(true);
      }
    }}>{icon('check', 9)}{t(`jobo.${record.progress}`)}</button>
      {open && createPortal(<div ref={menu} role="listbox" aria-label={t('jobo.progress')} className={`jobo-progress-menu ${ctx.cardBg} ${ctx.textPrimary} border ${ctx.borderClass}`} style={position} onKeyDown={keys} onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
        {C.PROGRESS.map((p, i) => <button key={p} ref={el => items.current[i] = el} role="option" type="button" aria-selected={record.progress === p} tabIndex={-1} onClick={() => choose(p)} className={ctx.hoverBg}><span className="jobo-progress-dot" style={{
          background: progressColors[p]
        }} />{t(`jobo.${p}`)}{record.progress === p && icon('check', 11)}</button>)}
      </div>, document.body)}
    </>;
}
function CustomTags({
  role,
  task,
  record
}) {
  const state = useLedger(),
    t = useLang(),
    [editing, setEditing] = useState(false),
    [value, setValue] = useState(''),
    input = useRef(null),
    handled = useRef(false);
  const custom = [...new Set([...C.tags(task.title), ...(record?.tags || []), ...(role === 'plan' ? state.planTags?.[String(task.id)] || [] : [])])];
  useEffect(() => {
    if (editing) {
      handled.current = false;
      input.current?.focus({
        preventScroll: true
      });
      input.current?.scrollIntoView({
        block: 'nearest',
        inline: 'nearest'
      });
    }
  }, [editing]);
  function commit() {
    if (handled.current) return;
    handled.current = true;
    const text = C.normalizeTags([value])[0];
    if (text && !custom.includes(text)) safe(() => S.addTag(role, task.id, text));
    setValue('');
    setEditing(false);
  }
  return <>{custom.map(tag => <span className="jobo-badge jobo-custom-tag" key={tag} title={'#' + tag}>#{tag}</span>)}
      {editing ? <input ref={input} className="jobo-tag-input jobo-badge" aria-label={t('jobo.custom')} placeholder={t('jobo.tagPlaceholder')} value={value} maxLength={80} style={{
      width: `${Math.max(6, Math.min(20, value.length + 3))}ch`
    }} onChange={e => setValue(e.target.value)} onBlur={commit} onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()} onKeyDown={e => {
      e.stopPropagation();
      if (e.nativeEvent.isComposing) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handled.current = true;
        setEditing(false);
        setValue('');
      }
    }} /> : <button type="button" className="jobo-badge jobo-tag-add" aria-label={t('jobo.addTag')} title={t('jobo.addTag')} onPointerDown={e => e.stopPropagation()} onClick={e => {
      e.stopPropagation();
      setEditing(true);
    }}>+</button>}
    </>;
}
function NotesAction({
  task
}) {
  const ctx = useDayPlannerCtx(),
    t = useLang();
  return <button type="button" className="jobo-send-note hover:bg-white/20 rounded p-1 transition-colors" title={t('jobo.addNote')} aria-label={t('jobo.addNote')} onPointerDown={e => e.stopPropagation()} onClick={e => {
    e.stopPropagation();
    ctx.setExpandedNotesTaskId(task.id);
  }}>
      {icon('notes', 13)}<svg className="jobo-note-arrow" width="8" height="10" viewBox="0 0 8 10" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M0 5H7M4 2L7 5L4 8" /></svg>
    </button>;
}
// Optional compact variant of the ORIGINAL TimelineTaskCardContent.
// Its original ActionButtons / NotesButton remain supplied by that component.
function Compact({
  task,
  ActionButtons,
  NotesButton
}) {
  const ctx = useDayPlannerCtx(),
    state = useLedger(),
    t = useLang(),
    now = useTick();
  const role = task._joboRole,
    record = role === 'do' ? state.records.find(r => r.id === task.id) : null;
  const related = role === 'plan' ? C.recordsFor(state, task.id) : [];
  const progressRecord = record || C.latestRecord(state, task.id);
  const checked = role === 'plan' && C.planChecked(state, task.id);
  const showLabels = role === 'plan' || role === 'do' && !record?.planId; // Linked Do stays title/time only.
  const statuses = record ? C.labelsForRecord(state, record, now) : state.plans[String(task.id)] ? C.labels(state, task.id, now, task) : [];
  const title = task.title.replace(/\s*#[\p{L}\p{N}_/-]+/gu, '').trim();
  return <div className="jobo-native-content px-2 py-1 flex-1 min-w-0 h-full flex flex-col">
      <div className="jobo-title-row flex items-center justify-between gap-1">
        <div className="flex items-center gap-1 flex-1 min-w-0">
          {role === 'plan' && !task.imported && <button aria-label={checked ? t('jobo.recorded') : t('jobo.checkDo')} title={checked ? t('jobo.recorded') : t('jobo.checkDo')} role="checkbox" aria-checked={checked} className={`jobo-check rounded flex-shrink-0 ${checked ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center hover:bg-white/30 transition-colors`} onClick={e => {
          e.stopPropagation();
          ctx.toggleComplete(task.id);
        }}>{checked && icon('check', 10)}</button>}
          {ctx.editingTaskId === task.id && role === 'plan' ? <input autoFocus className="jobo-title-input" value={ctx.editingTaskText} onChange={e => ctx.handleEditInputChange(e, false)} onKeyDown={e => ctx.handleEditKeyDown(e, false)} onBlur={() => ctx.saveTaskTitle(false)} /> : <div className="font-semibold text-sm leading-tight truncate flex-1 min-w-0" title={title} onDoubleClick={e => {
          e.stopPropagation();
          role === 'plan' ? ctx.startEditingTask(task, false) : ctx.openMobileEditTask(task, false);
        }}>{renderTitle(title)}</div>}
        </div>
        <div className="jobo-native-actions flex items-center gap-0.5 flex-shrink-0">
          {role === 'plan' && !task.imported ? <ActionButtons /> : <><NotesAction task={task} /><button className="hover:bg-white/20 rounded p-1 transition-colors" title={t('jobo.edit')} onClick={e => {
            e.stopPropagation();
            ctx.openMobileEditTask(task, false);
          }}>{icon('edit', 13)}</button><button className="hover:bg-white/20 rounded p-1 transition-colors" title={t('jobo.remove')} onClick={e => {
            e.stopPropagation();
            safe(() => S.remove(task.id));
          }}>{icon('trash', 13)}</button></>}
        </div>
      </div>
      <div className="jobo-meta-row text-xs flex items-center gap-1" data-jobo-meta>
        <button className="jobo-time" title={t('jobo.edit')} onClick={e => {
        e.stopPropagation();
        ctx.openMobileEditTask(task, false);
      }}>{ctx.formatTime(task.startTime)}–{ctx.formatTime(C.clock(C.minutes(task.startTime) + task.duration))}</button>
        <span className="jobo-duration">{duration(task.duration, t)}</span>
        {showLabels && <>{statuses.map(st => <Badge key={st} status={st} />)}
          {progressRecord && <Progress key={progressRecord.id} record={progressRecord} />}
          <CustomTags role={role} task={task} record={record} />
        </>}
      </div>
    </div>;
}
function LedgerEditor({
  record,
  initial,
  onClose
}) {
  const ctx = useDayPlannerCtx(),
    t = useLang(),
    state = useLedger();
  const noteSource = record?.sourceTaskId ? sourceTask(ctx, record.sourceTaskId) : null;
  const [form, set] = useState(() => record ? {
    ...record,
    notes: noteSource ? noteSource.notes || '' : record.notes || '',
    end: C.recordEndClock(record),
    tags: record.tags.join(' ')
  } : {
    title: '',
    date: C.dateString(ctx.selectedDate),
    startTime: initial || '09:00',
    end: C.clock(C.minutes(initial || '09:00') + 30),
    color: 'bg-purple-500',
    notes: '',
    tags: '',
    progress: 'complete'
  });
  const field = (name, value) => set(v => ({
    ...v,
    [name]: value
  }));
  function save() {
    safe(() => {
      const start = C.minutes(form.startTime),
        end = C.minutes(form.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end === start) throw Error(t('jobo.start') + ' < ' + t('jobo.end'));
      const patch = {
        ...form,
        duration: end > start ? end - start : 1440 - start + end,
        tags: form.tags.split(/\s+/).filter(Boolean),
        notesOwn: !noteSource
      };
      if (record) {
        S.update(record.id, patch);
        if (noteSource) writeNote(ctx, {
          task: noteSource,
          role: 'plan'
        }, form.notes);
      } else {
        const id = S.create(null, patch);
        S.update(id, {
          progress: form.progress,
          tags: patch.tags
        });
      }
      onClose();
    });
  }
  useEffect(() => {
    const fn = e => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);
  return <div className="jobo-modal-mask" onMouseDown={e => {
    if (e.target === e.currentTarget) onClose();
  }}><div role="dialog" aria-modal="true" className={`jobo-dialog ${ctx.cardBg} ${ctx.textPrimary} border ${ctx.borderClass}`}>
      <div className="flex items-center justify-between mb-3"><b>{record ? t('jobo.record') : t('jobo.addDo')}</b><button aria-label={t('jobo.cancel')} onClick={onClose}>{icon('close', 18)}</button></div>
      <label>{t('jobo.title')}<input autoFocus value={form.title} onChange={e => field('title', e.target.value)} /></label>
      <div className="jobo-edit-times"><label>{t('jobo.date')}<input type="date" value={form.date} onChange={e => field('date', e.target.value)} /></label><label>{t('jobo.start')}<input type="time" value={form.startTime} onChange={e => field('startTime', e.target.value)} /></label><label>{t('jobo.end')}<input type="text" value={form.end} onChange={e => field('end', e.target.value)} placeholder="24:00" /></label></div>
      <label>{t('jobo.progress')}<select value={form.progress} onChange={e => field('progress', e.target.value)}>{C.PROGRESS.map(p => <option key={p} value={p}>{t(`jobo.${p}`)}</option>)}</select></label>
      <label>{t('jobo.custom')}<input value={form.tags} onChange={e => field('tags', e.target.value)} placeholder="#" /></label>
      <label>{t('jobo.notes')}<textarea aria-label={t('jobo.notes')} rows={4} value={form.notes} onChange={e => field('notes', e.target.value)} /></label>
      <div className="flex items-center gap-2 my-2">{ctx.colors.map(c => <button type="button" key={c} className={`${c} jobo-color ${form.color === c ? 'ring-2 ring-blue-500' : ''}`} aria-label={c} onClick={() => field('color', c)} />)}</div>
      {record?.planId && <small className={ctx.textSecondary}>{t('jobo.original')}: {state.plans[record.planId]?.date} {state.plans[record.planId]?.startTime}</small>}
      <div className="jobo-dialog-actions"><button onClick={onClose}>{t('jobo.cancel')}</button><button className="bg-blue-600 text-white" onClick={save}>{t('jobo.save')}</button></div>
    </div></div>;
}
function startResize(e, task, edge, scale, onPreview, onCommit) {
  e.preventDefault();
  e.stopPropagation();
  const y = e.clientY,
    start = C.minutes(task.startTime),
    end = start + task.duration;
  const move = ev => {
    const delta = Math.round((ev.clientY - y) * 60 / scale / 5) * 5;
    let a = start,
      b = end;
    if (edge === 'top') a = Math.max(0, Math.min(end - 5, start + delta));else b = Math.min(1440, Math.max(start + 5, end + delta));
    onPreview({
      startTime: C.clock(a),
      duration: b - a
    });
  };
  const finish = ev => {
    move(ev);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', cancel);
    onCommit();
  };
  const cancel = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', cancel);
    onPreview(null);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', finish, {
    once: true
  });
  window.addEventListener('pointercancel', cancel, {
    once: true
  });
}
function Card({
  task,
  role,
  state,
  scale,
  startHour,
  rect,
  onFocus,
  onEdit,
  onNote,
  onDrag,
  setDrag,
  viewRef,
  onResizePlan,
  gutter = 0,
  onGesture
}) {
  const ctx = useDayPlannerCtx(),
    t = useLang(),
    [resize, setResize] = useState(null),
    latest = useRef(null),
    now = useTick();
  const shown = {
      ...task,
      ...resize,
      _joboRole: role
    },
    id = String(task.id);
  const original = role === 'do' ? state.records.find(r => r.id === id) || task : task;
  const doRecords = role === 'plan' ? C.recordsFor(state, id) : [];
  const adapted = {
    ...ctx,
    expandedNotesTaskId: role === 'plan' ? ctx.expandedNotesTaskId : null,
    toggleComplete: () => {
      const created = safe(() => S.checkNow(task));
      if (created) {
        const date = C.dateString(new Date());
        if (C.dateString(ctx.selectedDate) !== date) ctx.setSelectedDate?.(new Date());
      }
      onFocus({
        role: 'plan',
        id
      });
    },
    setExpandedNotesTaskId: role === 'plan' ? ctx.setExpandedNotesTaskId : () => onNote(task, role),
    updateTaskNotes: (taskId, text, isInbox) => {
      ctx.updateTaskNotes(taskId, text, isInbox);
      safe(() => S.syncNotes([{
        id: taskId,
        notes: text
      }]));
    },
    openMobileEditTask: (item, inbox) => {
      role === 'do' ? onEdit(state.records.find(r => r.id === task.id) || task) : ctx.openMobileEditTask(task, inbox);
    },
    startEditingTask: (item, inbox) => {
      role === 'do' ? onEdit(state.records.find(r => r.id === task.id) || task) : ctx.startEditingTask(task, inbox);
    }
  };
  const timeTop = (C.minutes(shown.startTime) - startHour * 60) * scale / 60,
    height = Math.max(40, shown.duration * scale / 60 - 2);
  const calStyle = task.imported ? ctx.getTaskCalendarStyle(task, ctx.darkMode) : {};
  function resizeStart(e, edge) {
    onGesture?.(true);
    latest.current = null;
    startResize(e, task, edge, scale, patch => {
      latest.current = patch;
      setResize(patch);
      if (!patch) onGesture?.(false);
    }, () => {
      onGesture?.(false);
      const patch = latest.current;
      setResize(null);
      if (patch) safe(() => role === 'do' ? S.update(id, C.resizeRecord(original, task, patch, edge)) : onResizePlan(task, patch));
    });
  }
  return <div data-jobo-card={role} data-task-id={id} data-jobo-id={`${role}:${id}`} data-ctx-menu draggable={!resize} onDragStart={e => {
    if (e.target.closest('button,select,input,textarea')) {
      e.preventDefault();
      return;
    }
    e.stopPropagation();
    e.dataTransfer.setData('application/x-jobo', JSON.stringify({
      role,
      id
    }));
    e.dataTransfer.setData('text/plain', task.title);
    e.dataTransfer.effectAllowed = role === 'plan' ? 'copyMove' : 'move';
    setDrag({
      role,
      id,
      task
    });
    onFocus({
      role,
      id
    });
  }} onDragEnd={() => {
    setDrag(null);
    onDrag(null);
  }} onMouseEnter={() => onFocus({
    role,
    id
  })} onMouseLeave={() => onFocus(null)} onClick={e => e.stopPropagation()} onContextMenu={e => {
    e.preventDefault();
    e.stopPropagation();
    role === 'do' ? onEdit(original) : ctx.setTaskContextMenu({
      x: e.clientX,
      y: e.clientY,
      taskId: task.id,
      isRecurring: String(task.id).startsWith('recurring-'),
      isImported: !!task.imported,
      isAllDay: false,
      dateStr: task.date
    });
  }} className={`jobo-native-card absolute pointer-events-auto shadow-md notes-panel-container text-white rounded-lg cursor-grab active:cursor-grabbing ${task.isTaskCalendar ? '' : task.color || 'bg-blue-500'}`} style={{
    top: timeTop,
    height,
    left: `calc(${rect.left * 100}% - ${gutter * rect.left}px + 3px)`,
    width: `calc(${rect.width * 100}% - ${gutter * rect.width + 6}px)`,
    ...calStyle
  }}><DayPlannerContext.Provider value={adapted}><NativeTaskContent task={shown} height={height} isNarrowWidth={false} compactRenderer={role === 'plan' && task.imported ? undefined : Compact} /></DayPlannerContext.Provider>
      {(!task._joboProjected || C.startEpoch(task) === C.startEpoch(original)) && <div className="jobo-resize-top" aria-label="resize-start" onPointerDown={e => resizeStart(e, 'top')} />}{(!task._joboProjected || C.endEpoch(task) === C.endEpoch(original)) && <div className="jobo-resize-bottom" aria-label="resize-end" onPointerDown={e => resizeStart(e, 'bottom')}><span /></div>}
    </div>;
}
function NotesColumn({
  plans,
  records,
  state,
  date,
  onFocus,
  noteRequest,
  setNoteRequest
}) {
  const ctx = useDayPlannerCtx(),
    t = useLang();
  const all = [...ctx.tasks, ...ctx.unscheduledTasks, ...(ctx.expandedRecurringTasks || [])],
    map = new Map(all.map(x => [String(x.id), x]));
  const items = [],
    keys = new Set();
  function add(task, key, role, links) {
    if (keys.has(key) || state.notePresence?.[key] === false || !String(task.notes || '').trim() && !state.notePresence?.[key]) return;
    keys.add(key);
    items.push({
      task,
      key,
      role,
      links
    });
  }
  for (const task of plans) {
    const rs = records.filter(r => r.sourceTaskId === String(task.id) && !r.notesOwn);
    if (rs.length || state.notePresence?.['task:' + task.id]) add(task, 'task:' + task.id, 'plan', rs.length ? rs.map(r => 'do:' + r.id) : ['plan:' + task.id]);
  }
  for (const r of records) {
    const src = map.get(r.sourceTaskId);
    if (src && !r.notesOwn) add(src, 'task:' + src.id, 'plan', records.filter(x => x.sourceTaskId === r.sourceTaskId && !x.notesOwn).map(x => 'do:' + x.id));else add(r, 'do:' + r.id, 'do', ['do:' + r.id]);
  }
  items.sort((a, b) => C.minutes(a.task.startTime || '00:00') - C.minutes(b.task.startTime || '00:00'));
  useEffect(() => {
    if (!noteRequest) return;
    const id = noteRequest.key || noteRequest;
    const tile = document.querySelector(`[data-jobo-note="${CSS.escape(id)}"]`);
    if (tile) {
      tile.scrollIntoView({
        block: 'nearest',
        behavior: 'instant'
      });
      tile.querySelector('textarea')?.focus({
        preventScroll: true
      });
      tile.classList.add('jobo-flash');
      const timer = setTimeout(() => tile.classList.remove('jobo-flash'), 800);
      return () => clearTimeout(timer);
    }
  }, [noteRequest, items.length]);
  const dailyKey = 'daily:' + date,
    dailyText = ctx.dailyNotes[date]?.text || '';
  const dailyVisible = !!dailyText.trim() || state.notePresence?.[dailyKey] !== false;
  return <div className={`jobo-notes-column border-l ${ctx.borderClass}`} data-jobo-notes>
      {!items.length && <div className={`jobo-empty-notes text-xs ${ctx.textSecondary}`}>{t('jobo.emptyNotes')}</div>}
      {items.map(item => <NoteTile key={item.key} item={item} state={state} onFocus={onFocus} />)}
      {dailyVisible ? <NoteTile key={dailyKey} item={{
      key: dailyKey,
      role: 'daily',
      task: {
        title: t('jobo.daily'),
        notes: dailyText,
        date,
        color: ctx.darkMode ? 'bg-gray-800' : 'bg-white'
      },
      links: []
    }} state={state} onFocus={onFocus} /> : <button className={`jobo-add-daily ${ctx.hoverBg} ${ctx.textSecondary}`} onClick={() => {
      safe(() => S.noteVisibility(dailyKey, true));
      setNoteRequest({
        key: dailyKey,
        nonce: Date.now()
      });
    }}>{icon('plus', 12)}{t('jobo.addDaily')}</button>}
    </div>;
}
function writeNote(ctx, item, text) {
  const {
    task,
    role
  } = item;
  if (role === 'daily') {
    if (ctx.updateDailyNote) ctx.updateDailyNote(task.date, text);else ctx.setDailyNotes(prev => ({
      ...prev,
      [task.date]: {
        ...prev[task.date],
        text,
        lastModified: new Date().toISOString()
      }
    }));
  } else if (role === 'do') S.update(task.id, {
    notes: text,
    notesOwn: true
  });else {
    // Keep inherited snapshots aligned too, so deleting a source task cannot resurrect an old note.
    const current = S.get();
    S.commit(C.syncSourceNotes(current, [{
      id: task.id,
      notes: text
    }]));
    ctx.updateTaskNotes(task.id, text, false);
  }
}
function NoteTile({
  item,
  state,
  onFocus
}) {
  const ctx = useDayPlannerCtx(),
    t = useLang(),
    {
      task,
      key,
      role,
      links
    } = item,
    ref = useRef(null),
    focused = useRef(false),
    [text, setText] = useState(task.notes || '');
  useEffect(() => {
    setText(task.notes || '');
  }, [task.notes]);
  function change(value) {
    setText(value);
    safe(() => writeNote(ctx, item, value));
  }
  function remove() {
    safe(() => {
      writeNote(ctx, item, '');
      setText('');
      S.noteVisibility(key, false);
      onFocus(null);
    });
  }
  function resize(e) {
    e.preventDefault();
    e.stopPropagation();
    const y = e.clientY,
      h = ref.current.offsetHeight;
    const move = ev => {
      if (ref.current) {
        ref.current.style.height = `${Math.max(80, Math.min(1000, h + ev.clientY - y))}px`;
        window.dispatchEvent(new Event('jobo-note-resize'));
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointercancel', up);
      if (ref.current) safe(() => S.height(key, ref.current.offsetHeight));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, {
      once: true
    });
    window.addEventListener('pointercancel', up, {
      once: true
    });
  }
  return <section ref={ref} data-jobo-note={key} data-jobo-links={JSON.stringify(links)} className={`jobo-note-tile shadow-md rounded-lg border ${ctx.borderClass} ${role === 'daily' ? `${ctx.cardBg} ${ctx.textPrimary}` : `${task.color || 'bg-blue-500'} text-white`}`} style={{
    height: state.noteHeights[key] || Math.min(260, Math.max(role === 'daily' ? 150 : 100, 70 + Math.ceil(text.length / 36) * 18))
  }} onMouseEnter={() => onFocus({
    role: 'note',
    id: key
  })} onMouseLeave={() => onFocus(null)}>
      <div className="jobo-note-title flex items-center justify-between gap-2 px-2 py-1"><b className="text-xs truncate">{task.title.replace(/\s*#[\p{L}\p{N}_/-]+/gu, '')}</b><button type="button" title={role === 'daily' ? t('jobo.deleteDaily') : t('jobo.deleteNote')} aria-label={role === 'daily' ? t('jobo.deleteDaily') : t('jobo.deleteNote')} className="jobo-note-delete p-1 rounded hover:bg-white/20" onClick={remove}>{icon('trash', 12)}</button></div>
      <textarea aria-label={role === 'daily' ? t('jobo.daily') : t('jobo.notes')} placeholder={t('jobo.notePlaceholder')} value={text} onChange={e => change(e.target.value)} onFocus={() => {
      focused.current = true;
      onFocus({
        role: 'note',
        id: key
      });
    }} onBlur={() => {
      focused.current = false;
    }} className="jobo-note-editor" />
      <div className="jobo-note-resizer" title={t('jobo.noteSize')} onPointerDown={resize}><span /></div>
    </section>;
}
function Connections({
  root,
  focus,
  dragPreview,
  state,
  dep
}) {
  const [paths, setPaths] = useState([]);
  useEffect(() => {
    let raf;
    const update = () => {
      if (!root.current) return;
      const host = root.current,
        box = host.getBoundingClientRect(),
        out = [];
      const get = (kind, id) => host.querySelector(`[data-jobo-${kind}="${CSS.escape(id)}"]`);
      const connect = (a, b, color, key) => {
        if (!a || !b) return;
        const ar = a.getBoundingClientRect(),
          br = b.getBoundingClientRect();
        const x1 = ar.right - box.left,
          y1 = ar.top + Math.min(ar.height / 2, 24) - box.top,
          x2 = br.left - box.left,
          y2 = br.top + Math.min(br.height / 2, 24) - box.top;
        out.push({
          key,
          d: `M${x1},${y1} C${x1 + 25},${y1} ${x2 - 25},${y2} ${x2},${y2}`,
          color
        });
      };
      const lane = host.querySelector('[data-jobo-lane="do"]');
      if (lane) {
        const lr = lane.getBoundingClientRect(),
          groups = new Map();
        for (const r of state.records) {
          if (!r.planId) continue;
          const el = get('id', 'do:' + r.id);
          if (el) {
            if (!groups.has(r.planId)) groups.set(r.planId, []);
            groups.get(r.planId).push(el);
          }
        }
        let rail = 0;
        for (const [id, elements] of groups) {
          if (elements.length < 2) continue;
          const boxes = elements.map(el => el.getBoundingClientRect()).sort((a, b) => a.top - b.top);
          const x = lr.right - box.left - 4 - rail++ % 5 * 7,
            ys = boxes.map(b => b.top + Math.min(b.height / 2, 22) - box.top);
          let d = `M${x},${ys[0]} V${ys[ys.length - 1]}`;
          boxes.forEach((b, i) => {
            d += ` M${b.right - box.left + 1},${ys[i]} H${x}`;
          });
          out.push({
            key: 'interruption:' + id,
            bracket: true,
            d,
            color: getComputedStyle(elements[0]).backgroundColor
          });
        }
      }
      if (focus) {
        const ids = new Set();
        if (focus.role === 'plan') ids.add(focus.id);
        if (focus.role === 'do') {
          const r = state.records.find(x => x.id === focus.id);
          if (r?.planId) ids.add(r.planId);
        }
        for (const id of ids) for (const r of C.recordsFor(state, id)) {
          const a = get('id', 'plan:' + id),
            b = get('id', 'do:' + r.id);
          connect(a, b, a ? getComputedStyle(a).backgroundColor : '#3b82f6', 'pd:' + r.id);
        }
        for (const n of host.querySelectorAll('[data-jobo-note]')) {
          const linked = JSON.parse(n.dataset.joboLinks || '[]');
          if (focus.role === 'note' && n.dataset.joboNote === focus.id || linked.includes(focus.role + ':' + focus.id) || linked.some(id => id.startsWith('do:') && ids.has(state.records.find(r => 'do:' + r.id === id)?.planId))) for (const id of linked) {
            const a = get('id', id);
            connect(a, n, a ? getComputedStyle(a).backgroundColor : '#3b82f6', 'useDayPlannerCtx:' + id + n.dataset.joboNote);
          }
        }
      }
      if (dragPreview?.source) {
        const a = get('id', dragPreview.source),
          lane = host.querySelector('[data-jobo-lane="do"]');
        if (a && lane) {
          const ar = a.getBoundingClientRect(),
            lr = lane.getBoundingClientRect();
          const x1 = ar.right - box.left,
            y1 = ar.top + 20 - box.top,
            x2 = lr.left - box.left + 5,
            y2 = dragPreview.y;
          out.push({
            key: 'drag',
            d: `M${x1},${y1} C${x1 + 30},${y1} ${x2 - 30},${y2} ${x2},${y2}`,
            color: getComputedStyle(a).backgroundColor
          });
        }
      }
      setPaths(out);
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    schedule();
    const ro = new ResizeObserver(schedule);
    if (root.current) ro.observe(root.current);
    window.addEventListener('resize', schedule);
    window.addEventListener('jobo-note-resize', schedule);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('jobo-note-resize', schedule);
    };
  }, [focus, dragPreview, state, dep, root]);
  return <svg className="jobo-connections" aria-hidden="true">{paths.map(p => <path key={p.key} d={p.d} fill="none" stroke={p.color} strokeWidth={p.bracket ? 2 : 1.4} opacity={p.bracket ? .95 : .65} strokeLinejoin="miter" strokeLinecap="square" data-jobo-interruption={p.bracket ? p.key : undefined} strokeDasharray={p.key === 'drag' ? '4 3' : undefined} />)}</svg>;
}
function Day() {
  const ctx = useDayPlannerCtx(),
    features = useFeaturesCtx(),
    t = useLang(),
    state = useLedger(),
    now = useTick(),
    toast = useToast();
  const date = C.dateString(ctx.selectedDate),
    root = useRef(null),
    scroll = useRef(null),
    blockAddUntil = useRef(0),
    [focus, setFocus] = useState(null),
    [drag, setDrag] = useState(null),
    [preview, setPreview] = useState(null),
    [editor, setEditor] = useState(null),
    [noteRequest, setNoteRequest] = useState(null);
  const plans = ctx.getTasksForDate(ctx.selectedDate).filter(task => !task.isAllDay && task.startTime && (!features.projectFilter || task.projectId === features.projectFilter));
  const records = C.recordsOnDate(state, date).filter(r => !features.projectFilter || r.projectId === features.projectFilter);
  useEffect(() => {
    if (ctx.dataLoaded) safe(() => {
      S.capture([...ctx.tasks, ...plans]);
      S.syncNotes([...ctx.tasks, ...ctx.unscheduledTasks, ...plans]);
    });
  }, [ctx.dataLoaded, ctx.tasks, ctx.unscheduledTasks, plans]);
  const earliest = Math.min(8 * 60, ...plans.concat(records).map(p => C.minutes(p.startTime)).filter(Number.isFinite));
  const startHour = state.prefs.allHours ? 0 : Math.max(0, Math.floor(earliest / 60)),
    scale = state.prefs.dayScale,
    height = (24 - startHour) * scale;
  useLayoutEffect(() => {
    const el = ctx.calendarRef.current;
    if (!el) return;
    const before = {
      overflowY: el.style.overflowY
    };
    el.style.overflowY = 'hidden';
    return () => {
      el.style.overflowY = before.overflowY;
    };
  }, [ctx.calendarRef]);
  useEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const wheel = e => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      safe(() => S.prefs({
        dayScale: Math.max(44, Math.min(144, scale + (e.deltaY < 0 ? 4 : -4)))
      }));
    };
    el.addEventListener('wheel', wheel, {
      passive: false
    });
    return () => el.removeEventListener('wheel', wheel);
  }, [scale]);
  function updatePlan(task, patch) {
    S.capture([task]);
    ctx.setTasks(prev => prev.map(x => String(x.id) === String(task.id) ? {
      ...x,
      ...patch,
      lastModified: new Date().toISOString(),
      transitionId: crypto.randomUUID()
    } : x));
  }
  function note(task, role) {
    const source = role === 'do' && sourceTask(ctx, task.sourceTaskId),
      target = source || task;
    const key = (source || role === 'plan' ? 'task:' : 'do:') + target.id;
    safe(() => S.noteVisibility(key, true));
    setNoteRequest({
      key,
      nonce: Date.now()
    });
    setFocus({
      role: 'note',
      id: key
    });
  }
  function dropAt(e, role) {
    e.preventDefault();
    const lane = e.currentTarget,
      rect = lane.getBoundingClientRect(),
      m = Math.round((e.clientY - rect.top) * 60 / scale / 5) * 5 + startHour * 60;
    let payload = drag;
    if (!payload) {
      try {
        const d = JSON.parse(e.dataTransfer.getData('application/x-jobo'));
        payload = d.role === 'do' ? {
          ...d,
          task: state.records.find(r => r.id === d.id)
        } : {
          ...d,
          task: sourceTask(ctx, d.id)
        };
      } catch {}
    }
    if (!payload && ctx.draggedTask) payload = {
      role: 'external',
      task: ctx.draggedTask,
      id: String(ctx.draggedTask.id)
    };
    if (!payload?.task) return;
    const task = payload.role === 'do' ? state.records.find(r => r.id === payload.task.id) || payload.task : payload.task,
      start = Math.max(0, Math.min(1440 - (task.duration || 30), m)),
      at = {
        date,
        startTime: C.clock(start),
        duration: task.duration || 30
      };
    safe(() => {
      if (role === 'do') {
        payload.role === 'do' ? S.update(task.id, at) : S.create(task, at);
      } else if (payload.role === 'do') return;else if (payload.role === 'external') ctx.handleDropOnCalendar(e, ctx.selectedDate, C.clock(start));else updatePlan(task, at);
    });
    setDrag(null);
    setPreview(null);
    ctx.handleDragEnd?.();
  }
  const grouped = new Map();
  for (const r of records) if (r.planId) grouped.set(r.planId, (grouped.get(r.planId) || 0) + 1);
  const doGutter = Math.min(5, [...grouped.values()].filter(n => n > 1).length) * 7;
  const lanes = (role, tasks) => {
    const placements = C.lanes(tasks, scale, 40);
    return <div className={`jobo-time-lane ${role === 'do' ? `border-l ${ctx.borderClass}` : ''}`} data-jobo-lane={role} onDragOver={e => {
      if (!drag && !ctx.draggedTask) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = role === 'do' && drag?.role !== 'do' ? 'copy' : 'move';
      const b = e.currentTarget.getBoundingClientRect(),
        m = Math.max(0, Math.min(1440, Math.round((e.clientY - b.top) * 60 / scale / 5) * 5 + startHour * 60));
      setPreview({
        role,
        time: m,
        source: drag ? `${drag.role}:${drag.id}` : null,
        y: (m - startHour * 60) * scale / 60
      });
    }} onDrop={e => dropAt(e, role)} onClick={e => {
      if (Date.now() < blockAddUntil.current) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.target.closest('[data-jobo-card]')) return;
      const b = e.currentTarget.getBoundingClientRect(),
        m = Math.max(0, Math.min(1410, Math.round((e.clientY - b.top) * 60 / scale / 15) * 15 + startHour * 60));
      role === 'do' ? setEditor({
        initial: C.clock(m)
      }) : (ctx.setNewTask({
        title: '',
        date,
        startTime: C.clock(m),
        duration: 30,
        isAllDay: false
      }), ctx.setShowAddTask(true));
    }}>
        {Array.from({
        length: 24 - startHour
      }, (_, i) => <div className={`jobo-hour border-b ${ctx.borderClass} ${i % 2 ? ctx.darkMode ? 'bg-white/[0.04]' : 'bg-stone-100/50' : ''}`} style={{
        height: scale
      }} key={i}><div className={`jobo-half border-b border-dashed ${ctx.borderClass}`} /></div>)}
        {role === 'plan' && features.getFrameInstancesForDate?.(ctx.selectedDate).map(frame => {
        const a = C.minutes(frame.start),
          b = C.minutes(frame.end);
        return <div key={frame.frameId} className="jobo-frame" style={{
          top: (a - startHour * 60) * scale / 60,
          height: (b - a) * scale / 60,
          background: frameColorBg(frame.color, ctx.darkMode),
          borderLeft: `3px solid ${frameColorBorder(frame.color, ctx.darkMode)}`
        }}><small>{frame.label}</small></div>;
      })}
        {placements.map(p => <Card key={p.item.id} task={p.item} role={role} state={state} scale={scale} startHour={startHour} rect={p} onFocus={setFocus} onEdit={record => setEditor({
        record
      })} onNote={note} onDrag={setPreview} setDrag={setDrag} onResizePlan={updatePlan} gutter={role === 'do' ? doGutter : 0} onGesture={active => {
        blockAddUntil.current = active ? Infinity : Date.now() + 400;
      }} />)}
        {preview?.role === role && <div className="jobo-drop-line" style={{
        top: preview.y
      }}><span>{C.clock(preview.time)}</span></div>}
      </div>;
  };
  return <div className={`jobo-day-root ${ctx.darkMode ? 'jobo-dark' : ''}`} data-jobo-day>
      <div className={`jobo-column-head border-b ${ctx.borderClass} ${ctx.cardBg}`}>
        <div className="jobo-head-plan"><b>{t('jobo.plan')}</b><button title={t('jobo.allHours')} onClick={() => S.prefs({
          allHours: !state.prefs.allHours
        })} className={ctx.hoverBg}>{state.prefs.allHours ? t('jobo.compactHours') : t('jobo.allHours')}</button></div><div />
        <div className="jobo-head-do"><b>{t('jobo.do')}</b><button title={t('jobo.addDo')} onClick={() => setEditor({
          initial: '09:00'
        })}>{icon('plus', 14)}</button></div>
        <div className="jobo-head-notes"><b>{t('jobo.notes')}</b><Tools /></div>
      </div>
      <div className={`jobo-day-scroll ${ctx.darkMode ? 'dark-scrollbar' : ''}`} ref={scroll}>
        <div ref={root} className="jobo-day-grid" style={{
        minHeight: height
      }}>
          {lanes('plan', plans)}
          <div className={`jobo-time-ruler border-l border-r ${ctx.borderClass} ${ctx.cardBg}`}>
            {Array.from({
            length: 24 - startHour
          }, (_, i) => <div className={`border-b ${ctx.borderClass} ${ctx.textSecondary}`} style={{
            height: scale
          }} key={i}>{ctx.formatTime(C.clock((startHour + i) * 60))}</div>)}
          </div>
          {lanes('do', records)}
          <NotesColumn plans={plans} records={records} state={state} date={date} onFocus={setFocus} noteRequest={noteRequest} setNoteRequest={setNoteRequest} />
          <Connections root={root} focus={focus} dragPreview={preview} state={state} dep={scale} />
          {date === C.dateString(new Date(now)) && new Date(now).getHours() * 60 + new Date(now).getMinutes() >= startHour * 60 && <div className="jobo-now-line" data-jobo-now style={{
          gridColumn: '1 / 4',
          top: (new Date(now).getHours() * 60 + new Date(now).getMinutes() - startHour * 60) * scale / 60
        }} />}
        </div>
      </div>
      {editor && <LedgerEditor {...editor} onClose={() => setEditor(null)} />}
      {toast && <div role="status" className="jobo-toast">{toast}</div>}{S.error() && <div role="alert" className="jobo-toast">{S.error()}</div>}
    </div>;
}
function CarryButton() {
  const ctx = useDayPlannerCtx(),
    state = useLedger(),
    t = useLang(),
    [open, setOpen] = useState(false),
    [selected, setSelected] = useState(new Set());
  const options = C.carryCandidates(state, ctx.tasks, ctx.unscheduledTasks);
  return <><button data-jobo-carry className="jobo-carry-button px-2.5 flex items-center justify-center gap-1 py-1.5 text-white rounded-lg transition-colors" title={t('jobo.carry')} onClick={() => {
      setSelected(new Set(options.map(o => o.token)));
      setOpen(true);
    }}>{icon('undo', 14)}<span className="text-xs font-medium">{t('jobo.carry')}</span></button>{open && <div className="jobo-modal-mask"><div role="dialog" aria-modal="true" className={`jobo-dialog ${ctx.cardBg} ${ctx.textPrimary} border ${ctx.borderClass}`}><b>{t('jobo.carry')}</b><div className="jobo-carry-list">{options.length ? options.map(o => <label key={o.token}><input type="checkbox" checked={selected.has(o.token)} onChange={() => setSelected(prev => {
              const n = new Set(prev);
              n.has(o.token) ? n.delete(o.token) : n.add(o.token);
              return n;
            })} /><span>{o.task.title}</span><Badge status={o.kind} progress={o.kind !== 'notStarted'} /></label>) : <p>{t('jobo.carryEmpty')}</p>}</div><div className="jobo-dialog-actions"><button onClick={() => setOpen(false)}>{t('jobo.cancel')}</button><button className="bg-blue-600 text-white" disabled={!selected.size} onClick={() => {
            ctx.setUnscheduledTasks(prev => {
              const exists = new Set(prev.map(t => t.joboCarrySource));
              return [...prev, ...options.filter(o => selected.has(o.token) && !exists.has(o.token)).map(o => C.carryTask(o, crypto.randomUUID()))];
            });
            setOpen(false);
          }}>{t('jobo.carryConfirm')}</button></div></div></div>}</>;
}
function download(name, data) {
  const u = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json'
    })),
    a = document.createElement('a');
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
function Tools() {
  const ctx = useDayPlannerCtx(),
    state = useLedger(),
    t = useLang(),
    input = useRef(null),
    [open, setOpen] = useState(false);
  async function restore(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text());
      if (raw.format !== 'dayglance-jobo-5.2' || !Array.isArray(raw.tasks) || !Array.isArray(raw.inbox) || typeof raw.dailyNotes !== 'object') throw Error(t('jobo.backupError'));
      const ledger = C.validate(raw.ledger);
      if (!window.confirm(t('jobo.restoreConfirm'))) return;
      S.restore(ledger);
      ctx.setTasks(raw.tasks);
      ctx.setUnscheduledTasks(raw.inbox);
      ctx.setDailyNotes(raw.dailyNotes);
    } catch (err) {
      notify(String(err.message));
    } finally {
      input.current.value = '';
    }
  }
  return <div className="jobo-tools"><button title={t('jobo.zoom')} onClick={() => S.prefs({
      dayScale: Math.max(44, state.prefs.dayScale - 8)
    })}>−</button><button title={t('jobo.reset')} onClick={() => S.prefs({
      dayScale: 84,
      weekScale: 1
    })}>{Math.round(state.prefs.dayScale / 84 * 100)}%</button><button title={t('jobo.zoom')} onClick={() => S.prefs({
      dayScale: Math.min(144, state.prefs.dayScale + 8)
    })}>＋</button><button title="Jobo" onClick={() => setOpen(v => !v)}>⋯</button>{open && <div className={`jobo-tools-menu ${ctx.cardBg} border ${ctx.borderClass} ${ctx.textPrimary}`}><button onClick={() => {
        safe(() => S.undo());
        setOpen(false);
      }}>{t('jobo.undo')}</button><button onClick={() => {
        download(`Jobo-${C.dateString()}.json`, {
          format: 'dayglance-jobo-5.2',
          baseVersion: '5.2.0',
          ledger: S.get(),
          tasks: ctx.tasks,
          inbox: ctx.unscheduledTasks,
          dailyNotes: ctx.dailyNotes
        });
        setOpen(false);
      }}>{t('jobo.backup')}</button><button onClick={() => {
        input.current.click();
        setOpen(false);
      }}>{t('jobo.restore')}</button><button onClick={() => {
        if (window.confirm(t('jobo.demoConfirm'))) loadDemo(ctx, t);
        setOpen(false);
      }}>{t('jobo.demo')}</button></div>}<input hidden ref={input} type="file" accept="application/json,.json" onChange={restore} /></div>;
}
function loadDemo(ctx, t) {
  const date = C.dateString(ctx.selectedDate),
    y = new Date(ctx.selectedDate);
  y.setDate(y.getDate() - 1);
  const yesterday = C.dateString(y);
  const rows = [['report', t('jobo.demoReport'), '09:00', 90, 'bg-blue-500', t('jobo.demoReportNotes')], ['design', t('jobo.demoDesign'), '11:00', 60, 'bg-orange-500', t('jobo.demoDesignNotes')], ['read', t('jobo.demoReading'), '14:00', 60, 'bg-purple-500', '']];
  const tasks = rows.map(([id, title, startTime, duration, color, notes]) => ({
    id: `jobo-demo-${date}-${id}`,
    title,
    startTime,
    duration,
    color,
    notes,
    date,
    completed: false,
    joboDemo: true
  }));
  ctx.setTasks(prev => [...prev, ...tasks.filter(t => !prev.some(p => p.id === t.id))]);
  safe(() => {
    let s = C.capture(S.get(), tasks);
    const entries = [['a', tasks[0], '09:00', 30, 'partial'], ['b', tasks[0], '10:00', 30, 'complete'], ['c', tasks[1], '11:20', 70, 'mostly']];
    for (const [id, task, startTime, duration, progress] of entries) {
      const rid = `jobo-demo-${date}-${id}`;
      s = C.createRecord(s, task, {
        date,
        startTime,
        duration
      }, rid);
      s = C.updateRecord(s, rid, {
        progress
      });
    }
    s = C.createRecord(s, null, {
      date,
      startTime: '09:30',
      duration: 30,
      title: t('jobo.demoConversation'),
      notes: t('jobo.demoConversationNotes'),
      color: 'bg-teal-500'
    }, `jobo-demo-${date}-unplanned`);
    for (const [i, r] of s.records.filter(r => r.date === date && r.id.startsWith('jobo-demo-')).entries()) {
      const rid = `jobo-demo-${yesterday}-${i}`;
      s = C.createRecord(s, null, {
        ...r,
        date: yesterday
      }, rid);
      s = C.updateRecord(s, rid, {
        progress: r.progress
      });
    }
    S.commit(s);
  });
  ctx.setDailyNotes(prev => prev[date]?.text ? prev : {
    ...prev,
    [date]: {
      text: t('jobo.demoDaily'),
      lastModified: new Date().toISOString()
    }
  });
  notify(t('jobo.demoDone'));
}
function Week() {
  const ctx = useDayPlannerCtx(),
    features = useFeaturesCtx(),
    state = useLedger(),
    t = useLang(),
    today = C.dateString(),
    ref = useRef(null),
    [editor, setEditor] = useState(null),
    toast = useToast();
  useEffect(() => {
    if (ctx.dataLoaded) safe(() => S.capture([...ctx.tasks, ...ctx.weekViewDates.flatMap(d => ctx.getTasksForDate(d))]));
  }, [ctx]);
  const getTasksForDate = date => C.dateString(date) < today ? C.recordsOnDate(state, C.dateString(date)).map(r => ({
    ...r,
    completed: false,
    _joboRole: 'do',
    _joboWeek: true
  })) : ctx.getTasksForDate(date);
  const adapted = {
    ...ctx,
    getTasksForDate,
    joboTaskRenderer: Compact,
    openMobileEditTask: (task, flag) => task._joboRole === 'do' ? setEditor({
      record: task
    }) : ctx.openMobileEditTask(task, flag),
    setTaskContextMenu: menu => {
      const record = state.records.find(r => r.id === menu.taskId);
      record ? setEditor({
        record
      }) : ctx.setTaskContextMenu(menu);
    },
    setExpandedNotesTaskId: () => {},
    handleDragStart: (task, src, e) => {
      if (task._joboRole === 'do') {
        e.preventDefault();
        setEditor({
          record: task
        });
      } else ctx.handleDragStart(task, src, e);
    }
  };
  useLayoutEffect(() => {
    if (!ref.current) return;
    const host = ref.current.closest('.jobo-week-host');
    const repaint = () => {
      for (const el of ref.current.querySelectorAll('[data-task-id]')) {
        const id = el.dataset.taskId,
          r = state.records.find(x => x.id === id);
        if (!r) continue;
        const sts = C.labelsForRecord(state, r),
          base = ctx.darkMode ? '#1f2937' : '#ffffff',
          text = ctx.darkMode ? {
            started: '#f9fafb',
            partial: '#e5e7eb',
            mostly: '#cbd5e1',
            complete: '#aab4c2'
          } : {
            started: '#111827',
            partial: '#374151',
            mostly: '#4b5563',
            complete: '#606a78'
          };
        el.classList.add('jobo-week-do');
        el.style.opacity = '1';
        if (r.progress === 'complete') el.style.backgroundColor = base;else el.style.backgroundColor = ctx.darkMode ? '#374151' : '#eef1f4';
        el.style.color = text[r.progress];
        el.style.borderLeft = `3px solid ${statusColors[sts[0]]}`;
        el.style.borderBottom = sts[1] ? `2px solid ${statusColors[sts[1]]}` : '';
        el.style.borderRight = sts[2] ? `2px solid ${statusColors[sts[2]]}` : '';
        el.style.setProperty('--jobo-progress', progressColors[r.progress]);
        el.title = `${r.title}\n${r.startTime}–${C.recordEndClock(r)} · ${sts.map(status => t(`jobo.${status}`)).join(' / ')} · ${t(`jobo.${r.progress}`)}`;
      }
    };
    repaint();
    const observer = new MutationObserver(repaint);
    observer.observe(ref.current, {
      childList: true,
      subtree: true
    });
    return () => observer.disconnect();
  }, [state, ctx.darkMode, ctx.weekViewDates, t]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const wheel = e => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      safe(() => S.prefs({
        weekScale: Math.max(.7, Math.min(4, state.prefs.weekScale + (e.deltaY < 0 ? .1 : -.1)))
      }));
    };
    el.addEventListener('wheel', wheel, {
      passive: false
    });
    return () => el.removeEventListener('wheel', wheel);
  }, [state.prefs.weekScale]);
  return <div className={`jobo-week-host ${ctx.darkMode ? 'jobo-dark' : ''}`} data-jobo-week><div className={`jobo-week-zoom ${ctx.textSecondary}`} title={t('jobo.legend')}><span>{t('jobo.legend')}</span><button onClick={() => S.prefs({
        weekScale: Math.max(.7, state.prefs.weekScale - .2)
      })}>−</button><button onClick={() => S.prefs({
        weekScale: 1
      })}>{Math.round(state.prefs.weekScale * 100)}%</button><button onClick={() => S.prefs({
        weekScale: Math.min(4, state.prefs.weekScale + .2)
      })}>＋</button></div><div className="jobo-week-scroll" ref={ref}><DayPlannerContext.Provider value={adapted}><NativeWeekView hourScale={state.prefs.weekScale} /></DayPlannerContext.Provider></div>{editor && <LedgerEditor {...editor} onClose={() => setEditor(null)} />} {toast && <div role="status" className="jobo-toast">{toast}</div>}</div>;
}
export { Day as JoboDayView, Week as JoboWeekView, CarryButton as JoboCarryButton, Compact };
