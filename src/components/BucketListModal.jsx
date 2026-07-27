import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRightLeft, CalendarClock, Eye, EyeOff, GripVertical, Inbox, Plus, Telescope, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import { BUCKET_LIST_IDS, promoteToInbox } from '../utils/bucketList.js';
import { renderFormattedText } from '../utils/textFormatting.jsx';

// Same iOS detection as ProjectPlanner/ProjectCard: grip-only touch drag on
// iOS, where whole-row HTML5 drag hijacks the gesture.
const IS_IOS = typeof navigator !== 'undefined' && (
  /iP(hone|ad|od)/.test(navigator.platform || '') ||
  (/Mac/.test(navigator.platform || '') && (navigator.maxTouchPoints || 0) > 1) ||
  (typeof window !== 'undefined' && !!window.DayGlanceIOS)
);

/**
 * Bucket List — the someday/maybe space. A PLANNER without a project: same
 * shell (shared notes panel, task rows, quick-add, drag-to-reorder), two
 * lists max with user-editable headings, second list hideable. Items are
 * unscheduledTasks with a bucketId, excluded from all Inbox machinery
 * (see utils/bucketList.js). Accessed from GLANCE.
 */
const BucketListModal = () => {
  const {
    isMobile,
    darkMode, cardBg, borderClass, textPrimary, textSecondary, hoverBg,
    unscheduledTasks, setUnscheduledTasks, reorderUnscheduledTasks,
    scheduleTaskAtNextSlot, moveToRecycleBin, openMobileEditTask,
    bucketConfig, updateBucketConfig,
    setShowBucketList,
    pushUndo, setUndoToast,
    colors,
  } = useDayPlannerCtx();
  const { isVisibleForUser } = useFeaturesCtx();
  const { t } = useTranslation();

  const [notes, setNotes] = useState(bucketConfig.notes || '');
  const [editingNotes, setEditingNotes] = useState(!(bucketConfig.notes || '').trim());
  const [editingHeading, setEditingHeading] = useState(null); // 'b1' | 'b2' | null
  const [headingDraft, setHeadingDraft] = useState('');
  const [quickAdd, setQuickAdd] = useState({ b1: '', b2: '' });
  const [showCompleted, setShowCompleted] = useState(true);
  const [drag, setDrag] = useState({ listId: null, idx: null, overIdx: null });
  const touchDragRef = useRef({ active: false, listId: null, fromIdx: null, overIdx: null });

  const saveNotes = () => {
    if ((bucketConfig.notes || '') !== notes) {
      updateBucketConfig({ notes: notes.trim() });
    }
  };
  const closeModal = () => { saveNotes(); setShowBucketList(false); };

  // Save notes on unmount too (ProjectPlanner's pattern) — Escape-close and
  // the editor opening over us bypass closeModal/blur.
  const saveNotesRef = useRef(saveNotes);
  saveNotesRef.current = saveNotes;
  useEffect(() => () => saveNotesRef.current(), []);

  // Items per list; completed sink to the bottom of their list.
  const lists = useMemo(() => {
    const byList = {};
    for (const id of BUCKET_LIST_IDS) {
      let items = unscheduledTasks.filter(t => t.bucketId === id && !t.archived && isVisibleForUser(t));
      if (!showCompleted) items = items.filter(t => !t.completed);
      byList[id] = items.sort((a, b) => (a.completed ? 1 : 0) - (b.completed ? 1 : 0));
    }
    return byList;
  }, [unscheduledTasks, isVisibleForUser, showCompleted]);

  const hasAnyCompleted = useMemo(
    () => unscheduledTasks.some(t => t.bucketId && !t.archived && t.completed),
    [unscheduledTasks]
  );
  const hiddenCount = useMemo(
    () => unscheduledTasks.filter(t => t.bucketId === 'b2' && !t.archived && !t.completed && isVisibleForUser(t)).length,
    [unscheduledTasks, isVisibleForUser]
  );

  // ── Row actions ───────────────────────────────────────────────────────────

  const stamp = () => new Date().toISOString();

  const toggleComplete = (task) => {
    setUnscheduledTasks(prev => prev.map(t => t.id === task.id
      ? { ...t, completed: !t.completed, completedAt: !t.completed ? stamp() : undefined, lastModified: stamp() }
      : t));
  };

  const sendToInbox = (task) => {
    pushUndo();
    setUnscheduledTasks(prev => prev.map(t => t.id === task.id ? promoteToInbox(t) : t));
    setUndoToast({ message: `"${task.title}" sent to Inbox`, actionable: true });
  };

  const scheduleNextSlot = (task) => {
    pushUndo();
    // scheduleTaskAtNextSlot strips bucketId when moving to the timeline.
    scheduleTaskAtNextSlot(task.id, true);
  };

  const moveToOtherList = (task) => {
    const other = task.bucketId === 'b1' ? 'b2' : 'b1';
    setUnscheduledTasks(prev => prev.map(t => t.id === task.id
      ? { ...t, bucketId: other, lastModified: stamp() }
      : t));
  };

  const deleteItem = (task) => {
    moveToRecycleBin(task.id, true);
  };

  const editItem = (task) => {
    saveNotes();
    // Inbox flavor — bucket items live in unscheduledTasks, and the inbox
    // save path spread-updates in place, preserving bucketId.
    openMobileEditTask(task, true);
  };

  const handleQuickAdd = (e, listId) => {
    e.preventDefault();
    const title = (quickAdd[listId] || '').trim();
    if (!title) return;
    setUnscheduledTasks(prev => [...prev, {
      id: crypto.randomUUID(),
      title,
      duration: 30,
      color: colors[0].class,
      completed: false,
      isAllDay: false,
      notes: '',
      subtasks: [],
      priority: 0,
      bucketId: listId,
      lastModified: stamp(),
    }]);
    setQuickAdd(prev => ({ ...prev, [listId]: '' }));
  };

  // ── Headings ──────────────────────────────────────────────────────────────

  const startHeadingEdit = (id) => {
    setEditingHeading(id);
    setHeadingDraft(bucketConfig.headings[id]);
  };
  const saveHeading = () => {
    const value = headingDraft.trim();
    if (value && value !== bucketConfig.headings[editingHeading]) {
      updateBucketConfig({ headings: { ...bucketConfig.headings, [editingHeading]: value } });
    }
    setEditingHeading(null);
  };

  // ── Drag-to-reorder within a list (ProjectPlanner's pattern) ─────────────

  const incompleteOf = (listId) => lists[listId].filter(t => !t.completed);

  const applyReorder = (listId, fromIdx, toIdx) => {
    const items = incompleteOf(listId);
    const fromId = items[fromIdx]?.id;
    const toId = items[toIdx]?.id;
    if (!fromId || !toId) return;
    const next = [...unscheduledTasks];
    const fromFull = next.findIndex(t => t.id === fromId);
    const toFull = next.findIndex(t => t.id === toId);
    const [moved] = next.splice(fromFull, 1);
    next.splice(toFull, 0, moved);
    reorderUnscheduledTasks(next);
  };

  const handleDrop = (e, listId, idx) => {
    e.preventDefault();
    if (drag.listId === listId && drag.idx !== null && drag.idx !== idx) {
      applyReorder(listId, drag.idx, idx);
    }
    setDrag({ listId: null, idx: null, overIdx: null });
  };

  // Grip-only touch drag for iOS (document-level non-passive listeners,
  // dragstart cancelled for the gesture — ProjectCard's proven pattern).
  const handleGripTouchStart = (e, listId, idx) => {
    touchDragRef.current = { active: true, listId, fromIdx: idx, overIdx: null };
    setDrag({ listId, idx, overIdx: null });

    const onMove = (moveEvent) => {
      if (!touchDragRef.current.active) return;
      moveEvent.preventDefault();
      const touch = moveEvent.touches[0];
      if (!touch) return;
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      const taskEl = el?.closest(`[data-bucket-drag="${listId}"]`);
      if (taskEl) {
        const overIdx = parseInt(taskEl.getAttribute('data-drag-idx'), 10);
        if (!isNaN(overIdx)) {
          touchDragRef.current.overIdx = overIdx;
          setDrag(prev => ({ ...prev, overIdx }));
        }
      }
    };
    const preventDrag = (de) => de.preventDefault();
    const onEnd = () => {
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
      document.removeEventListener('dragstart', preventDrag);
      const { active, listId: lId, fromIdx, overIdx } = touchDragRef.current;
      touchDragRef.current = { active: false, listId: null, fromIdx: null, overIdx: null };
      if (active && fromIdx !== null && overIdx !== null && fromIdx !== overIdx) {
        applyReorder(lId, fromIdx, overIdx);
      }
      setDrag({ listId: null, idx: null, overIdx: null });
    };
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);
    document.addEventListener('dragstart', preventDrag);
  };

  // ── Render helpers ────────────────────────────────────────────────────────

  const renderRow = (task, listId, idx, draggable) => {
    const isDragOver = drag.listId === listId && drag.overIdx === idx;
    return (
      <div
        key={task.id}
        data-bucket-drag={draggable ? listId : undefined}
        data-drag-idx={draggable ? idx : undefined}
        draggable={draggable && !IS_IOS}
        onDragStart={draggable && !IS_IOS ? (e) => { setDrag({ listId, idx, overIdx: null }); e.dataTransfer.effectAllowed = 'move'; } : undefined}
        onDragOver={draggable ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (drag.listId === listId && idx !== drag.overIdx) setDrag(prev => ({ ...prev, overIdx: idx })); } : undefined}
        onDrop={draggable ? (e) => handleDrop(e, listId, idx) : undefined}
        onDragEnd={draggable ? () => setDrag({ listId: null, idx: null, overIdx: null }) : undefined}
        className={`group flex items-center gap-2 px-2 py-2 rounded-lg border ${borderClass} ${darkMode ? 'bg-gray-700/40' : 'bg-stone-50'} ${isDragOver ? 'ring-2 ring-sky-400' : ''}`}
      >
        {draggable && (
          <span
            className={`flex-shrink-0 cursor-grab touch-none ${textSecondary} opacity-40 group-hover:opacity-80`}
            onTouchStart={IS_IOS ? (e) => handleGripTouchStart(e, listId, idx) : undefined}
          >
            <GripVertical size={14} />
          </span>
        )}
        <input
          type="checkbox"
          checked={!!task.completed}
          onChange={() => toggleComplete(task)}
          className="flex-shrink-0 w-4 h-4 rounded accent-sky-500 cursor-pointer"
        />
        <button
          type="button"
          onClick={() => editItem(task)}
          className={`flex-1 min-w-0 text-left text-sm truncate ${task.completed ? `line-through ${textSecondary}` : textPrimary}`}
        >
          {task.title}
        </button>
        <div className={`flex items-center gap-0.5 flex-shrink-0 ${isMobile ? '' : 'opacity-0 group-hover:opacity-100 transition-opacity'}`}>
          {!task.completed && (
            <>
              <button type="button" onClick={() => sendToInbox(task)} title={t('bucket.sendToInbox')} className={`p-1 rounded ${hoverBg}`}>
                <Inbox size={14} className={textSecondary} />
              </button>
              <button type="button" onClick={() => scheduleNextSlot(task)} title={t('bucket.scheduleNextSlot')} className={`p-1 rounded ${hoverBg}`}>
                <CalendarClock size={14} className={textSecondary} />
              </button>
              <button
                type="button"
                onClick={() => moveToOtherList(task)}
                title={t('bucket.moveToList', { list: bucketConfig.headings[task.bucketId === 'b1' ? 'b2' : 'b1'] })}
                className={`p-1 rounded ${hoverBg}`}
              >
                <ArrowRightLeft size={14} className={textSecondary} />
              </button>
            </>
          )}
          <button type="button" onClick={() => deleteItem(task)} title={t('bucket.delete')} className={`p-1 rounded ${hoverBg}`}>
            <Trash2 size={14} className={textSecondary} />
          </button>
        </div>
      </div>
    );
  };

  const renderList = (listId) => {
    const items = lists[listId];
    const incomplete = items.filter(t => !t.completed);
    const completed = items.filter(t => t.completed);
    return (
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          {editingHeading === listId ? (
            <input
              type="text"
              value={headingDraft}
              onChange={(e) => setHeadingDraft(e.target.value)}
              onBlur={saveHeading}
              onKeyDown={(e) => { if (e.key === 'Enter') saveHeading(); if (e.key === 'Escape') setEditingHeading(null); }}
              autoFocus
              maxLength={40}
              className={`text-sm font-semibold px-1.5 py-0.5 rounded border ${borderClass} ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} focus:outline-none focus:ring-2 focus:ring-sky-500 min-w-0`}
            />
          ) : (
            <button
              type="button"
              onClick={() => startHeadingEdit(listId)}
              title={t('bucket.renameList')}
              className={`text-sm font-semibold ${textPrimary} hover:underline decoration-dotted truncate`}
            >
              {bucketConfig.headings[listId]}
              <span className={`ml-1.5 font-normal ${textSecondary}`}>{incomplete.length || ''}</span>
            </button>
          )}
          {listId === 'b2' && (
            <button
              type="button"
              onClick={() => updateBucketConfig({ secondListHidden: true })}
              title={t('bucket.hideList')}
              className={`p-1 rounded ${hoverBg} flex-shrink-0`}
            >
              <EyeOff size={14} className={textSecondary} />
            </button>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          {incomplete.map((task, idx) => renderRow(task, listId, idx, true))}
          {incomplete.length === 0 && (
            <p className={`text-xs italic ${textSecondary} px-2 py-3`}>{t('bucket.empty')}</p>
          )}
          {showCompleted && completed.map((task) => renderRow(task, listId, null, false))}
        </div>

        <form onSubmit={(e) => handleQuickAdd(e, listId)} className="flex items-center gap-1.5 mt-1">
          <input
            type="text"
            value={quickAdd[listId]}
            onChange={(e) => setQuickAdd(prev => ({ ...prev, [listId]: e.target.value }))}
            placeholder={t('bucket.addToList', { list: bucketConfig.headings[listId] })}
            className={`flex-1 min-w-0 px-2.5 py-1.5 text-sm border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 ${darkMode ? 'bg-gray-700 text-white placeholder:text-gray-500' : 'bg-white text-stone-900 placeholder:text-stone-400'}`}
          />
          <button
            type="submit"
            disabled={!(quickAdd[listId] || '').trim()}
            className="p-1.5 rounded-lg bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-40 flex-shrink-0"
          >
            <Plus size={14} />
          </button>
        </form>
      </div>
    );
  };

  return (
    <div
      className={`fixed inset-0 z-[70] flex ${isMobile ? 'flex-col justify-end' : 'items-center justify-center p-6'}`}
      onClick={closeModal}
    >
      <div className="absolute inset-0 bg-black/45" />
      <div
        onClick={e => e.stopPropagation()}
        className={`relative ${cardBg} shadow-2xl flex flex-col ${
          isMobile
            ? 'rounded-t-2xl max-h-[92dvh] w-full overflow-y-auto overscroll-contain'
            : 'rounded-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden'
        }`}
        style={isMobile ? { WebkitOverflowScrolling: 'touch' } : undefined}
      >
        {/* Header — sticky while the mobile sheet scrolls (PLANNER pattern) */}
        <div className={isMobile ? 'sticky top-0 z-10' : 'flex-shrink-0'}>
          <div className="h-1.5 bg-sky-500" />
          <div className={`flex items-center justify-between px-4 py-3 border-b ${borderClass} ${cardBg}`}>
            <div className="flex items-center gap-2 min-w-0">
              <Telescope size={18} className="text-sky-500 flex-shrink-0" />
              <div className="flex flex-col min-w-0">
                <span className={`text-base font-semibold ${textPrimary}`}>{t('bucket.title')}</span>
                <span className={`text-xs ${textSecondary}`}>{t('bucket.subtitle')}</span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {hasAnyCompleted && (
                <button
                  type="button"
                  onClick={() => setShowCompleted(v => !v)}
                  title={showCompleted ? t('bucket.hideCompleted') : t('bucket.showCompleted')}
                  className={`p-1.5 rounded-lg ${hoverBg}`}
                >
                  {showCompleted ? <Eye size={16} className={textSecondary} /> : <EyeOff size={16} className={textSecondary} />}
                </button>
              )}
              <button type="button" onClick={closeModal} className={`p-1.5 rounded-lg ${hoverBg}`}>
                <X size={18} className={textSecondary} />
              </button>
            </div>
          </div>
        </div>

        <div className={`p-4 flex flex-col gap-4 ${isMobile ? '' : 'overflow-y-auto'}`}>
          {/* Shared bucket-level notes (one panel, not per-list) */}
          {editingNotes ? (
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => { saveNotes(); if (notes.trim()) setEditingNotes(false); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); saveNotes(); if (notes.trim()) setEditingNotes(false); } }}
              placeholder={t('bucket.notesPlaceholder')}
              rows={2}
              className={`w-full px-3 py-2 text-sm border ${borderClass} rounded-lg resize-y focus:outline-none focus:ring-2 focus:ring-sky-500 ${darkMode ? 'bg-gray-700 text-white placeholder:text-gray-500' : 'bg-white text-stone-900 placeholder:text-stone-400'}`}
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditingNotes(true)}
              className={`text-left text-sm ${textSecondary} whitespace-pre-wrap px-3 py-2 rounded-lg ${hoverBg}`}
            >
              {renderFormattedText(notes)}
            </button>
          )}

          {/* The two lists — side by side on desktop, stacked on mobile */}
          <div className={`flex gap-6 ${isMobile ? 'flex-col' : 'flex-row'}`}>
            {renderList('b1')}
            {!bucketConfig.secondListHidden && renderList('b2')}
          </div>

          {bucketConfig.secondListHidden && (
            <button
              type="button"
              onClick={() => updateBucketConfig({ secondListHidden: false })}
              className={`self-start text-xs ${textSecondary} hover:underline flex items-center gap-1`}
            >
              <Eye size={12} />
              {t('bucket.showList', { list: bucketConfig.headings.b2 })}{hiddenCount > 0 ? ` (${hiddenCount})` : ''}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default BucketListModal;
