import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowLeft, Eye, EyeOff, PanelRightClose, PanelRightOpen, Plus, X, Zap } from 'lucide-react';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../../context/FeaturesContext.jsx';
import { useSyncCtx } from '../../context/SyncContext.jsx';
import { noteLinkOf } from '../../utils/obsidianProjectNotes.js';
import { noteTextHash } from '@glance-apps/obsidian-format';
import { BookOpen, ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { dateToString } from '../../utils/taskUtils.js';
import { formatLocalizedDate } from '../../utils/localeFormatting.js';
import { getNextOccurrence } from '../../utils/recurrenceEngine.js';
import { getProjectColor, taskColorToHex, hexToRgba } from '../../utils/colorUtils.js';
import { beginLongPressReorder, isLongPressRowDevice } from '../../utils/longPressReorder.js';
import { plannerColumns } from '../../utils/plannerColumns.js';
import { renderFormattedText } from '../../utils/textFormatting.jsx';
import { isSelectionKey, moveSelection } from '../../utils/plannerSelection.js';
import TaskNotesPane from '../TaskNotesPane.jsx';
import useBackClose from '../../hooks/useBackClose.js';

// Same iOS detection as ProjectCard: grip-only touch drag on iOS, where
// whole-row HTML5 drag hijacks the gesture (see ProjectCard's IS_IOS note).
const IS_IOS = typeof navigator !== 'undefined' && (
  /iP(hone|ad|od)/.test(navigator.platform || '') ||
  (/Mac/.test(navigator.platform || '') && (navigator.maxTouchPoints || 0) > 1) ||
  (typeof window !== 'undefined' && !!window.DayGlanceIOS)
);

// Android and other non-iOS touch devices: the row itself carries a
// long-press touch reorder (utils/longPressReorder.js) and is not an HTML5
// draggable, so hold-anywhere-on-the-row no longer depends on the WebView
// starting a drag from a long press.
const IS_LONG_PRESS_ROW = isLongPressRowDevice();

// How long "Send to bottom" stays offered after a quick-add.
const SEND_TO_BOTTOM_MS = 15000;
// This device's choice of the notes sidebar (desktop and landscape tablet).
const NOTES_SIDEBAR_KEY = 'dg-planner-notes-sidebar';
import SchedTaskCard from '../sched/SchedTaskCard.jsx';
import HyperGlanceEditor from './HyperGlanceEditor.jsx';
import RecurringSeriesRow from './RecurringSeriesRow.jsx';
import { sortByProjectOrder, applyProjectReorder, projectReorderIds, topProjectOrder, sendToBottomIds } from '../../utils/projectOrder.js';

/**
 * PLANNER — a per-project planning dashboard, themed to the project's color.
 * Bottom sheet on mobile, centered modal on desktop. Hosts the project's
 * notes and hyperGLANCE settings (both moved here from the Edit Project form)
 * plus scheduled/unscheduled task columns with a quick-add.
 */
const ProjectPlanner = ({ project, onClose, initialHyperglanceOpen = false }) => {
  const {
    isMobile, isTablet, isLandscape,
    darkMode, cardBg, borderClass, textPrimary, textSecondary, hoverBg,
    tasks, unscheduledTasks, setUnscheduledTasks, reorderUnscheduledTasks,
    recurringTasks,
    openMobileEditTask, scheduleTaskAtNextSlot, showAddTask,
  } = useDayPlannerCtx();
  const { goals, updateProject, isVisibleForUser } = useFeaturesCtx();
  const { t } = useTranslation();

  const parentGoal = project.goalId ? goals.find(g => g.id === project.goalId) : null;
  const projectColor = getProjectColor(project, parentGoal);
  const projectHex = taskColorToHex(projectColor);

  const [notes, setNotes] = useState(project.description || '');
  // Notes behave like the app's other notes panels: Shift+Enter (or clicking
  // away) saves and switches to the formatted preview; clicking the preview
  // returns to editing. Starts in preview when notes already exist.
  const [editingNotes, setEditingNotes] = useState(!(project.description || '').trim());
  // THE LINKED NOTE'S DESCRIPTION (owner ruling 2026-10-03): for a project
  // linked to an Obsidian note, this box IS the section under the note's
  // title. Loaded from the vault when the planner opens, edited here, written
  // back as that section; refused and reloaded when the section moved in
  // Obsidian meanwhile. The record's description is empty for such a
  // project (it migrated into the note). Where this device cannot read the
  // vault, the box says where the notes live instead of offering an editor.
  const { loadNoteDescription, saveNoteDescription, openInObsidian } = useSyncCtx() || {};
  const noteLink = noteLinkOf(project);
  const vaultNotes = !!noteLink && !noteLink.missing;
  const [vault, setVault] = useState({ text: '', base: null, loading: vaultNotes, unavailable: false, error: null, conflict: false });
  const vaultRef = useRef(vault);
  vaultRef.current = vault;
  useEffect(() => {
    if (!vaultNotes) return undefined;
    if (!loadNoteDescription) { setVault((v) => ({ ...v, loading: false, unavailable: true })); return undefined; }
    let cancelled = false;
    loadNoteDescription(noteLink.path).then((r) => {
      if (cancelled) return;
      if (!r || r.notFound) { setVault({ text: '', base: null, loading: false, unavailable: true, error: r ? 'not_found' : null, conflict: false }); return; }
      setVault({ text: r.text, base: r.base, loading: false, unavailable: false, error: null, conflict: false });
      setNotes(r.text);
      setEditingNotes(!r.text.trim());
    }).catch((err) => { if (!cancelled) setVault({ text: '', base: null, loading: false, unavailable: true, error: err?.message || String(err), conflict: false }); });
    return () => { cancelled = true; };
    // The link's path is the identity of what is loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteLink?.path, loadNoteDescription]);
  const [quickAddTitle, setQuickAddTitle] = useState('');
  // The task just quick-added (to the top), offering "Send to bottom" for a
  // short while after; cleared by the timer or a newer add.
  const [justAdded, setJustAdded] = useState(null);
  useEffect(() => {
    if (!justAdded) return undefined;
    const timer = setTimeout(() => setJustAdded(null), SEND_TO_BOTTOM_MS);
    return () => clearTimeout(timer);
  }, [justAdded]);
  // Persisted on the project record like plannerScheduledHidden below, so
  // each planner remembers its own choice and it syncs with the project.
  const showCompleted = !project.plannerCompletedHidden;
  // Mobile shows the two task columns as tabs (they'd otherwise stack, hiding
  // Unscheduled below the fold); desktop keeps them side by side.
  const [activeTab, setActiveTab] = useState('scheduled');
  // Per-project SCHEDULED-list hiding (the Bucket List secondListHidden
  // pattern): persisted on the project record like its notes, so each
  // planner remembers its own choice and it syncs with the project.
  const scheduledHidden = !!project.plannerScheduledHidden;
  const { effectiveTab, showTabs, showScheduled, showUnscheduled, gridColumns } =
    plannerColumns({ isMobile, activeTab, scheduledHidden });
  const [dragIdx, setDragIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const touchDragRef = useRef({ active: false, fromIdx: null, overIdx: null });

  const saveNotes = () => {
    if (vaultNotes) {
      const v = vaultRef.current;
      if (v.loading || v.unavailable || !saveNoteDescription || notes === v.text) return;
      saveNoteDescription('project', project.id, noteLink.path, notes, { base: v.base }).then((r) => {
        if (r?.refused) {
          // The section moved in Obsidian: reload it, keep the unsaved text
          // below it for the user to settle, and say so.
          const merged = `${r.text}\n\n${notes}`.trim();
          setVault({ text: r.text, base: noteTextHash(r.text), loading: false, unavailable: false, error: null, conflict: true });
          setNotes(merged);
          setEditingNotes(true);
          return;
        }
        if (r?.ok) setVault((prev) => ({ ...prev, text: notes, base: noteTextHash(notes), conflict: false }));
      }).catch(() => {});
      return;
    }
    if ((project.description || '') !== notes) {
      updateProject(project.id, { description: notes.trim() });
    }
  };

  const closePlanner = () => { saveNotes(); onClose(); };

  // ESC is owned by GoalDashboard's capture-phase priority chain (notes panel
  // → task editor → PLANNER → forms → dashboard) — see its Escape handler.
  // The planner deliberately has no ESC listener of its own; it just needs to
  // flush unsaved notes when the chain unmounts it.
  const notesRef = useRef(notes);
  notesRef.current = notes;
  useEffect(() => () => {
    if (vaultNotes) {
      // The unmount flush writes without a base, as the task panel's does:
      // nothing can be shown or reloaded on the way out.
      const v = vaultRef.current;
      if (!v.loading && !v.unavailable && saveNoteDescription && notesRef.current !== v.text) {
        saveNoteDescription('project', project.id, noteLink.path, notesRef.current).catch(() => {});
      }
      return;
    }
    if ((project.description || '') !== notesRef.current) {
      updateProject(project.id, { description: notesRef.current.trim() });
    }
    // Unmount-only flush; project identity is fixed for a mounted planner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tapping a task opens the project-flavored editor (isInbox=false, matching
  // ProjectCard's task rows) ON TOP of the planner, which stays open. The
  // planner is rendered at the app top level (App.jsx, beside the task modals)
  // so plain z-index ordering applies: dashboard 60 < planner 70 < editor 80.
  // Do NOT portal it to document.body or nest it inside dashboard DOM — both
  // put it in a different stacking context and break this ordering.
  const editTask = (task) => {
    saveNotes();
    // The keyboard picks up from the task just edited.
    setSelectedId(task.id);
    openMobileEditTask(task, false);
  };

  // ── Notes sidebar and keyboard (desktop and landscape tablet) ────────────
  // The planner takes the keyboard as it opens, however it was opened, and
  // again when the task editor above it closes: the arrow keys move the
  // selection (utils/plannerSelection.js) and Enter opens the selected task.
  // The sidebar is opt-in, and remembered on this device like a remembered
  // tab. Closed, a card click opens the editor as it always has. Open, a
  // click selects the task and the sidebar shows its notes; a double-click
  // or Enter opens the editor.
  const wide = !isMobile && !(isTablet && !isLandscape);
  const [notesPreferred, setNotesPreferred] = useState(() => {
    try { return localStorage.getItem(NOTES_SIDEBAR_KEY) === '1'; } catch { return false; }
  });
  const rememberNotes = (open) => {
    try { localStorage.setItem(NOTES_SIDEBAR_KEY, open ? '1' : '0'); } catch { /* not remembered */ }
    setNotesPreferred(open);
  };
  // hyperGLANCE is set up once and rarely touched, so it is not a section of
  // the planner but a place the header opens: on a wide screen it takes the
  // notes panel's place (the lists stay), on a phone or portrait tablet it
  // is the sheet's other page, with a way back to the tasks. Not
  // remembered: the planner opens on its tasks.
  const [hyperOpen, setHyperOpen] = useState(initialHyperglanceOpen);
  // Notes and hyperGLANCE share the panel: Notes from hyperGLANCE switches
  // back to the notes (opening them if they were closed).
  const toggleNotesSidebar = () => {
    if (wide && hyperOpen) { setHyperOpen(false); if (!notesPreferred) rememberNotes(true); return; }
    rememberNotes(!notesPreferred);
  };
  const sidebar = wide && notesPreferred && !hyperOpen;
  const hyperPanel = wide && hyperOpen;
  const hyperPage = !wide && hyperOpen;
  const panelOpen = sidebar || hyperPanel;
  const hyperOn = !!project.hyperglance?.enabled;
  // Back (the phone's gesture or button) closes hyperGLANCE first, then the
  // planner, saving the notes as the X does (hooks/useBackClose.js).
  useBackClose({ key: 'dgPlannerSheet', onClose: closePlanner });
  useBackClose({ open: hyperOpen, key: 'dgPlannerHyperglance', onClose: () => setHyperOpen(false) });
  const [selectedId, setSelectedId] = useState(null);
  // E puts the cursor in the selected task's note in the sidebar.
  const [noteFocusRequest, setNoteFocusRequest] = useState(0);
  const panelRef = useRef(null);
  const takeKeyboard = () => panelRef.current?.focus({ preventScroll: true });
  useEffect(() => {
    if (wide) takeKeyboard();
    // On open only; the editor effect below covers its return.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const editorWasOpen = useRef(!!showAddTask);
  useEffect(() => {
    if (editorWasOpen.current && !showAddTask && wide) takeKeyboard();
    editorWasOpen.current = !!showAddTask;
  }, [showAddTask, wide]);
  const selectTask = (task) => {
    setSelectedId(task.id);
    // The panel takes the keyboard, so the arrows move from here.
    takeKeyboard();
  };

  // Project tasks, split into the two columns. Completed tasks sink to the
  // bottom of their column; scheduled tasks group by day.
  const { scheduledDays, unscheduled } = useMemo(() => {
    const mine = (list) => list.filter(task =>
      task.projectId === project.id && !task.archived && isVisibleForUser(task));
    const scheduled = mine(tasks).sort((a, b) =>
      (a.completed ? 1 : 0) - (b.completed ? 1 : 0) ||
      (a.date || '').localeCompare(b.date || '') ||
      (a.startTime || '').localeCompare(b.startTime || ''));
    const byDay = [];
    for (const task of scheduled.filter(task => !task.completed)) {
      const last = byDay[byDay.length - 1];
      if (last && last.dateStr === task.date) last.tasks.push(task);
      else byDay.push({ dateStr: task.date, tasks: [task] });
    }
    const completedScheduled = scheduled.filter(task => task.completed);
    if (showCompleted && completedScheduled.length) byDay.push({ dateStr: null, tasks: completedScheduled });
    // projectOrder first (utils/projectOrder.js), then completed last; both sorts are stable.
    let inbox = sortByProjectOrder(mine(unscheduledTasks)).sort((a, b) => (a.completed ? 1 : 0) - (b.completed ? 1 : 0));
    if (!showCompleted) inbox = inbox.filter(task => !task.completed);
    return { scheduledDays: byDay, unscheduled: inbox };
  }, [tasks, unscheduledTasks, project.id, isVisibleForUser, showCompleted]);

  const hasAnyCompleted = useMemo(() =>
    [...tasks, ...unscheduledTasks].some(task => task.projectId === project.id && !task.archived && task.completed),
    [tasks, unscheduledTasks, project.id]);

  // Recurring series of this project — listed once per template at the top of
  // the Scheduled column (never expanded per occurrence, so a daily task
  // appears exactly once). Ended series (past endDate / maxOccurrences
  // exhausted) are hidden so finished templates don't become permanent clutter.
  const projectRecurring = useMemo(() =>
    recurringTasks.filter(task => task.projectId === project.id && !task.archived && isVisibleForUser(task) && getNextOccurrence(task) !== null),
    [recurringTasks, project.id, isVisibleForUser]);

  const incompleteScheduledCount = scheduledDays.reduce((n, g) => n + (g.dateStr ? g.tasks.length : 0), 0);

  const todayStr = dateToString(new Date());
  const dayHeading = (dateStr) => {
    if (!dateStr) return t('common.completed', 'Completed');
    const d = new Date(dateStr + 'T00:00:00');
    const base = formatLocalizedDate(d, { weekday: 'short', month: 'short', day: 'numeric' });
    return dateStr === todayStr ? `${t('common.today', 'Today')} · ${base}` : base;
  };

  // ── Drag-to-reorder (unscheduled column) — mirrors ProjectCard ────────────
  const incompleteUnscheduled = unscheduled.filter(task => !task.completed);

  // The selection, as the lists stand: an edit or a completion keeps it on
  // the same task, and a task that leaves the planner drops it.
  const scheduledList = scheduledDays.flatMap(group => group.tasks);
  const selectedTask = wide
    ? [...scheduledList, ...unscheduled].find(task => String(task.id) === String(selectedId)) || null
    : null;
  const selectionLists = [
    ...(showScheduled ? [{ column: 'scheduled', ids: scheduledList.map(task => task.id) }] : []),
    ...(showUnscheduled ? [{ column: 'unscheduled', ids: unscheduled.map(task => task.id) }] : []),
  ];
  const onPanelKeyDown = (e) => {
    // Only with the panel itself focused: a field, or a button in the
    // planner, keeps its own keys.
    if (!wide || showAddTask || e.target !== panelRef.current || e.ctrlKey || e.metaKey || e.altKey) return;
    if (isSelectionKey(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      const next = moveSelection(selectionLists, selectedTask?.id ?? null, e.key);
      if (next != null) setSelectedId(next);
    } else if (e.key === 'Enter' && selectedTask) {
      e.preventDefault();
      e.stopPropagation();
      editTask(selectedTask);
    } else if ((e.key === 'e' || e.key === 'E') && sidebar && selectedTask) {
      // The app's own E (end-of-day reschedule) already stands down while
      // the planner is open; stopping it here keeps it that way.
      e.preventDefault();
      e.stopPropagation();
      setNoteFocusRequest((n) => n + 1);
    }
  };
  useEffect(() => {
    if (selectedId == null) return;
    const el = panelRef.current?.querySelector(`[data-sched-task="${CSS.escape(String(selectedId))}"]`);
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedId]);
  // What a card's click does: select with the sidebar open, edit without.
  // Either way the keyboard's selection shows.
  const cardProps = (task) => (sidebar
    ? { onEdit: selectTask, onOpen: editTask, selected: selectedTask?.id === task.id }
    : { onEdit: editTask, selected: selectedTask?.id === task.id });

  const applyReorder = (fromIdx, toIdx) => {
    const ordered = incompleteUnscheduled.map(task => task.id);
    if (!ordered[fromIdx] || !ordered[toIdx]) return;
    const [moved] = ordered.splice(fromIdx, 1);
    ordered.splice(toIdx, 0, moved);
    // A field on each task (utils/projectOrder.js): syncs on both tiers and
    // survives the Obsidian cycle. Array positions move too, as before.
    reorderUnscheduledTasks(applyProjectReorder(unscheduledTasks, projectReorderIds(ordered, unscheduled)));
  };

  const handleDragStart = (e, idx) => {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e, idx) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (idx !== dragOverIdx) setDragOverIdx(idx);
  };

  const handleDrop = (e, idx) => {
    e.preventDefault();
    if (dragIdx !== null && dragIdx !== idx) applyReorder(dragIdx, idx);
    setDragIdx(null);
    setDragOverIdx(null);
  };

  const handleDragEnd = () => {
    setDragIdx(null);
    setDragOverIdx(null);
  };

  // Grip-only touch drag for iOS — document-level non-passive listeners, and
  // dragstart cancelled for the gesture so native HTML5 drag can't hijack it
  // (ProjectCard's proven pattern).
  const handleGripTouchStart = (e, idx) => {
    touchDragRef.current = { active: true, fromIdx: idx, overIdx: null };
    setDragIdx(idx);

    const onMove = (moveEvent) => {
      if (!touchDragRef.current.active) return;
      moveEvent.preventDefault(); // honoured: this listener is non-passive
      const touch = moveEvent.touches[0];
      if (!touch) return;
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      const taskEl = el?.closest('[data-drag-idx]');
      if (taskEl) {
        const overIdx = parseInt(taskEl.getAttribute('data-drag-idx'), 10);
        if (!isNaN(overIdx)) {
          touchDragRef.current.overIdx = overIdx;
          setDragOverIdx(overIdx);
        }
      }
    };
    const preventDrag = (de) => de.preventDefault();
    const onEnd = () => {
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
      document.removeEventListener('dragstart', preventDrag);
      const { active, fromIdx, overIdx } = touchDragRef.current;
      touchDragRef.current = { active: false, fromIdx: null, overIdx: null };
      if (active && fromIdx !== null && overIdx !== null && fromIdx !== overIdx) {
        applyReorder(fromIdx, overIdx);
      }
      setDragIdx(null);
      setDragOverIdx(null);
    };
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);
    document.addEventListener('dragstart', preventDrag);
  };

  // Whole-row long-press reorder on non-iOS touch devices (the card's
  // pattern; utils/longPressReorder.js owns the hold and the listeners).
  const handleRowTouchStart = (e, idx) => {
    beginLongPressReorder(e, {
      idx,
      onActivate: (fromIdx) => {
        touchDragRef.current = { active: true, fromIdx, overIdx: null };
        setDragIdx(fromIdx);
      },
      onOver: (overIdx) => {
        touchDragRef.current.overIdx = overIdx;
        setDragOverIdx(overIdx);
      },
      onEnd: ({ activated, fromIdx, overIdx }) => {
        if (!activated) return;
        touchDragRef.current = { active: false, fromIdx: null, overIdx: null };
        if (fromIdx !== null && overIdx !== null && fromIdx !== overIdx) applyReorder(fromIdx, overIdx);
        setDragIdx(null);
        setDragOverIdx(null);
      },
    });
  };

  // The project's whole inbox (open and completed, whatever the Completed
  // toggle shows), which the order helpers number against.
  const projectInbox = () => unscheduledTasks.filter(task =>
    task.projectId === project.id && !task.archived && isVisibleForUser(task));

  // Quick-add an unscheduled project task — same inheritance as the card
  // quick-add: effective project color + the project's assigned users. It
  // lands at the TOP of the list (utils/projectOrder.js topProjectOrder), so
  // it is seen beside the field it was typed in; "Send to bottom" undoes that
  // for a while.
  const handleQuickAdd = (e) => {
    e.preventDefault();
    const title = quickAddTitle.trim();
    if (!title) return;
    const id = crypto.randomUUID();
    const projectOrder = topProjectOrder(projectInbox());
    setUnscheduledTasks(prev => [...prev, {
      id,
      projectOrder,
      title,
      duration: 30,
      color: projectColor,
      completed: false,
      isAllDay: false,
      notes: '',
      subtasks: [],
      priority: 0,
      projectId: project.id,
      ...(project.assignedUserSyncIds?.length ? { assignedUserSyncIds: project.assignedUserSyncIds } : {}),
      lastModified: new Date().toISOString(),
    }]);
    setQuickAddTitle('');
    setJustAdded({ id, title });
    // On the phone the new task is on the Unscheduled tab: show it.
    if (showTabs) setActiveTab('unscheduled');
  };

  const sendToBottom = () => {
    const ids = justAdded && sendToBottomIds(projectInbox(), justAdded.id);
    if (ids) reorderUnscheduledTasks(applyProjectReorder(unscheduledTasks, ids));
    setJustAdded(null);
  };

  return (
    <div
      className={`fixed inset-0 z-[70] flex ${isMobile ? 'flex-col justify-end' : 'items-center justify-center p-6'}`}
      onClick={closePlanner}
    >
      <div className="absolute inset-0 bg-black/45" />
      <div
        onClick={e => e.stopPropagation()}
        className={`relative ${cardBg} shadow-2xl flex flex-col ${
          isMobile
            // On mobile the SHEET is the scroll container (like
            // MobileNewTaskModal) — an inner flex-child scroller doesn't
            // respond to touch here because the momentum-scrolling CSS is
            // scoped to .mobile-timeline-layout and this overlay lives
            // outside it. dvh, not vh, so the sheet can't extend below the
            // visible viewport.
            ? 'rounded-t-2xl max-h-[92dvh] w-full overflow-y-auto overscroll-contain'
            : `rounded-2xl w-full ${panelOpen ? 'max-w-[104rem]' : 'max-w-3xl'} max-h-[85vh] overflow-hidden outline-none`
        }`}
        style={isMobile ? { WebkitOverflowScrolling: 'touch' } : undefined}
        ref={panelRef}
        tabIndex={-1}
        onKeyDown={onPanelKeyDown}
        data-planner-notes-sidebar={sidebar ? 'open' : undefined}
        data-planner-hyperglance={hyperPanel ? 'panel' : hyperPage ? 'page' : undefined}
      >
        {/* Project color bar + header — sticky while the mobile sheet scrolls.
            The tint goes on backgroundImage so cardBg keeps the header opaque
            (content must not show through when stuck). */}
        <div className={`flex-shrink-0 ${isMobile ? 'sticky top-0 z-10' : ''}`}>
        <div className="h-1.5" style={{ background: projectHex }} />
        <div
          className={`flex items-center justify-between px-4 py-3 border-b ${borderClass} ${cardBg}`}
          style={{ backgroundImage: `linear-gradient(${hexToRgba(projectHex, darkMode ? 0.12 : 0.07)}, ${hexToRgba(projectHex, darkMode ? 0.12 : 0.07)})` }}
        >
          <div className="flex flex-col min-w-0">
            <span className={`text-base font-semibold ${textPrimary} truncate`}>{project.title}</span>
            <span className={`text-xs ${textSecondary}`}>
              {parentGoal ? parentGoal.title : t('planner.standaloneProject', 'Standalone project')} · Planner
            </span>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              type="button"
              onClick={() => updateProject(project.id, { plannerScheduledHidden: !scheduledHidden })}
              aria-pressed={!scheduledHidden}
              data-planner-scheduled-toggle
              className={`flex items-center gap-1.5 text-xs font-medium px-2 py-1.5 rounded-lg ${hoverBg} ${textSecondary} transition-colors`}
              title={scheduledHidden ? t('planner.showScheduled', 'Show Scheduled') : t('planner.hideScheduled', 'Hide Scheduled list')}
            >
              {scheduledHidden ? <EyeOff size={13} /> : <Eye size={13} />}
              {t('planner.scheduled', 'Scheduled')}
              {scheduledHidden && incompleteScheduledCount > 0 && <span className="opacity-70">{incompleteScheduledCount}</span>}
            </button>
            {hasAnyCompleted && (
              <button
                onClick={() => updateProject(project.id, { plannerCompletedHidden: showCompleted })}
                className={`flex items-center gap-1.5 text-xs font-medium px-2 py-1.5 rounded-lg ${hoverBg} ${textSecondary} transition-colors`}
                title={showCompleted ? t('planner.hideCompleted', 'Hide completed tasks') : t('planner.showCompleted', 'Show completed tasks')}
              >
                {showCompleted ? <Eye size={13} /> : <EyeOff size={13} />}
                {t('common.completed', 'Completed')}
              </button>
            )}
            {/* hyperGLANCE: its settings in the panel (wide) or as the
                sheet's other page; ON says whether the project has one. */}
            <button
              type="button"
              onClick={() => setHyperOpen(open => !open)}
              aria-pressed={hyperOpen}
              aria-label="hyperGLANCE"
              data-planner-hyperglance-toggle
              className={`flex items-center gap-1.5 text-xs font-medium px-2 py-1.5 rounded-lg transition-colors ${
                hyperOpen ? (darkMode ? 'bg-gray-700' : 'bg-stone-200') : hoverBg
              } ${hyperOn ? textPrimary : textSecondary}`}
              title={hyperOpen ? t('planner.hideHyperglance') : t('planner.showHyperglance')}
            >
              <Zap size={13} className={hyperOn ? 'text-yellow-400' : undefined} />
              {!isMobile && 'hyperGLANCE'}
              {hyperOn && (
                <span data-planner-hyperglance-on className="text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-400/20 text-yellow-400 font-semibold">ON</span>
              )}
            </button>
            {/* Notes opens the panel on the right, so it sits on the right */}
            {wide && (
              <button
                type="button"
                onClick={toggleNotesSidebar}
                aria-pressed={sidebar}
                data-planner-notes-toggle
                className={`flex items-center gap-1.5 text-xs font-medium px-2 py-1.5 rounded-lg ${hoverBg} ${textSecondary} transition-colors`}
                title={sidebar ? t('planner.hideNotesSidebar') : t('planner.showNotesSidebar')}
              >
                {sidebar ? <PanelRightClose size={13} /> : <PanelRightOpen size={13} />}
                {t('task.notes', 'Notes')}
              </button>
            )}
            <button
              onClick={closePlanner}
              className={`p-1.5 rounded-lg ${hoverBg}`}
              aria-label={t('planner.close', 'Close planner')}
            >
              <X size={16} className={textSecondary} />
            </button>
          </div>
        </div>
        </div>

        {/* Body — scrolls itself on desktop; on mobile the sheet scrolls (see
            above) and the bottom padding clears the iOS home indicator.
            Every section below carries flex-shrink-0: this is a flex COLUMN
            with a bounded height, so a section that doesn't opt out is
            SQUASHED when the content overflows instead of the body scrolling
            past it. (hyperGLANCE, which once sat here, clips its own overflow
            and collapsed to its two border pixels; it now opens from the
            header, below, and keeps the same opt-out.) */}
        {/* On desktop the body shares a row with the notes sidebar; the
            phone sheet holds the body directly (its header and body are
            the sheet's two sections). */}
        {(() => { const body = (
        <div
          className={`p-4 flex flex-col gap-4 ${isMobile ? 'flex-shrink-0' : `flex-1 min-h-0 overflow-y-auto min-w-0${panelOpen ? ' max-w-[48rem]' : ''}`}`}
          style={isMobile ? { paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' } : undefined}
        >
          {/* Notes — same interaction model as task notes panels; for a
              linked project, the linked note's description section. */}
          <div className="flex flex-col gap-1 flex-shrink-0" data-notes-source={vaultNotes ? 'vault' : 'record'}>
            <label className={`text-xs font-medium ${textSecondary} flex items-center gap-1.5`}>
              {vaultNotes && <BookOpen size={11} />}
              <span className="flex-1">{vaultNotes ? noteLink.name : t('task.notes', 'Notes')}</span>
              {vaultNotes && openInObsidian && (
                <button
                  type="button"
                  onClick={() => openInObsidian(noteLink.name)}
                  title={t('task.openWikiNoteInObsidian', { name: noteLink.name })}
                  aria-label={t('task.openWikiNoteInObsidian', { name: noteLink.name })}
                  className={`flex items-center gap-1 px-1 py-0.5 rounded font-normal ${textSecondary} ${hoverBg}`}
                >
                  <ExternalLink size={11} />
                  <span>{t('task.openInObsidian')}</span>
                </button>
              )}
            </label>
            {vaultNotes && vault.loading ? (
              <p className={`text-xs italic ${textSecondary}`}>{t('planner.notesLoading', 'Loading from the linked note…')}</p>
            ) : vaultNotes && vault.unavailable ? (
              <p data-notes-in-vault={vault.error === 'not_found' ? 'missing' : 'unreadable'} className={`text-xs italic ${vault.error === 'not_found' ? 'text-amber-500' : textSecondary}`}>
                {vault.error === 'not_found'
                  ? t('planner.notesNoteMissing', 'The linked note was not found in the vault. Check the note name, or create the note in Obsidian.')
                  : vault.error
                    ? t('planner.notesLoadFailed', { error: vault.error })
                    : t('planner.notesInVault', 'Notes live in the linked note in Obsidian.')}
              </p>
            ) : editingNotes ? (
              <textarea
                autoFocus={!!(project.description || '').trim()}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                onBlur={() => { saveNotes(); if (notes.trim()) setEditingNotes(false); }}
                onKeyDown={e => {
                  if (e.key === 'Enter' && e.shiftKey) {
                    e.preventDefault();
                    saveNotes();
                    if (notes.trim()) setEditingNotes(false);
                  }
                }}
                placeholder={t('planner.notesPlaceholder', 'Add notes... (**bold**, *italic*, __underline__, URLs) - Shift+Enter to save')}
                rows={3}
                className={`px-3 py-2 text-sm rounded-lg border ${borderClass} focus:outline-none focus:ring-2 resize-none ${
                  darkMode ? 'bg-gray-700 text-gray-100 placeholder-gray-500' : 'bg-white text-stone-900 placeholder-stone-400'
                }`}
                style={{ '--tw-ring-color': projectHex }}
              />
            ) : (
              <div
                onClick={() => setEditingNotes(true)}
                className={`px-3 py-2 text-sm rounded-lg border ${borderClass} cursor-text whitespace-pre-wrap ${textPrimary} ${hoverBg}`}
                title={t('planner.clickToEditNotes', 'Click to edit notes')}
              >
                {renderFormattedText(notes)}
              </div>
            )}
            {vaultNotes && vault.conflict && (
              <p data-notes-conflict className="text-xs text-amber-500">{t('planner.notesChanged')}</p>
            )}
          </div>

          {/* Quick-add — under the notes, above the lists, so it is in reach
              however long the lists are. New tasks go to the top of Unscheduled. */}
          <div className="flex flex-col gap-1.5 flex-shrink-0">
            <form onSubmit={handleQuickAdd} className="flex gap-2" data-planner-quick-add>
              <input
                value={quickAddTitle}
                onChange={e => setQuickAddTitle(e.target.value)}
                placeholder={t('planner.addTaskPlaceholder', 'Add a task…')}
                className={`flex-1 min-w-0 px-2.5 py-1.5 text-sm rounded-lg border ${borderClass} focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  darkMode ? 'bg-gray-700 text-gray-100 placeholder-gray-500' : 'bg-white text-stone-900 placeholder-stone-400'
                }`}
              />
              <button
                type="submit"
                disabled={!quickAddTitle.trim()}
                className="px-2.5 py-1.5 rounded-lg text-white disabled:opacity-40 transition-opacity"
                style={{ background: projectHex }}
                aria-label={t('planner.addTaskToProject', 'Add task to project')}
              >
                <Plus size={14} />
              </button>
            </form>
            {justAdded && (
              <div data-planner-just-added className={`flex items-center gap-2 text-xs ${textSecondary}`} role="status">
                <span className="truncate min-w-0">{t('planner.addedToTop', { title: justAdded.title })}</span>
                <button
                  type="button"
                  onClick={sendToBottom}
                  className="flex-shrink-0 flex items-center gap-1 font-medium text-blue-500 hover:text-blue-600 px-1 rounded"
                >
                  <ArrowDownToLine size={12} />
                  {t('planner.sendToBottom')}
                </button>
              </div>
            )}
          </div>

          {/* Task columns — tabbed on mobile, side by side on desktop */}
          {showTabs && (
            <div className={`flex rounded-lg border ${borderClass} p-0.5 gap-0.5 flex-shrink-0`}>
              {[
                { key: 'scheduled', label: t('planner.scheduled', 'Scheduled'), count: incompleteScheduledCount },
                { key: 'unscheduled', label: t('task.unscheduled', 'Unscheduled'), count: incompleteUnscheduled.length },
              ].map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wide transition-colors ${
                    effectiveTab === tab.key ? 'text-white' : `${textSecondary} ${hoverBg}`
                  }`}
                  style={effectiveTab === tab.key ? { background: projectHex } : undefined}
                >
                  {tab.label}
                  {tab.count > 0 && <span className="opacity-70">{tab.count}</span>}
                </button>
              ))}
            </div>
          )}
          <div className={`grid gap-4 flex-shrink-0 ${gridColumns === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {/* Scheduled */}
            {showScheduled && (
            <div className="flex flex-col gap-2 min-w-0">
              {!isMobile && (
                <span className={`text-xs font-semibold uppercase tracking-wide ${textSecondary}`}>
                  {t('planner.scheduled', 'Scheduled')}
                </span>
              )}
              {projectRecurring.length > 0 && (
                <div className="flex flex-col gap-1">
                  <span className={`text-[11px] font-semibold ${textSecondary}`}>
                    {t('sched.recurring')}
                  </span>
                  {projectRecurring.map(template => (
                    <RecurringSeriesRow key={template.id} template={template} projectHex={projectHex} />
                  ))}
                </div>
              )}
              {scheduledDays.length > 0 ? scheduledDays.map(group => (
                <div key={group.dateStr ?? 'completed'} className="flex flex-col gap-1">
                  <span className={`text-[11px] font-semibold ${group.dateStr === todayStr ? 'text-blue-500' : textSecondary} ${group.dateStr ? '' : 'opacity-60'}`}>
                    {dayHeading(group.dateStr)}
                  </span>
                  {group.tasks.map(task => <SchedTaskCard key={task.id} task={task} {...cardProps(task)} />)}
                </div>
              )) : projectRecurring.length === 0 && (
                <p className={`text-xs ${textSecondary} opacity-70 py-2`}>{t('planner.nothingScheduledYet', 'Nothing scheduled yet.')}</p>
              )}
            </div>
            )}

            {/* Unscheduled */}
            {showUnscheduled && (
            <div className="flex flex-col gap-2 min-w-0">
              {!isMobile && (
                <span className={`text-xs font-semibold uppercase tracking-wide ${textSecondary}`}>
                  {t('task.unscheduled', 'Unscheduled')}
                </span>
              )}
              {unscheduled.length > 0 ? (
                unscheduled.map(task => {
                  const idx = incompleteUnscheduled.findIndex(u => u.id === task.id);
                  const draggable = idx !== -1 && incompleteUnscheduled.length > 1;
                  return (
                    <SchedTaskCard
                      key={task.id}
                      task={task}
                      isInbox
                      {...cardProps(task)}
                      onSchedule={task.completed ? null : (t) => scheduleTaskAtNextSlot(t.id, true)}
                      dnd={draggable ? {
                        idx,
                        rowDraggable: !IS_IOS && !IS_LONG_PRESS_ROW,
                        onDragStart: handleDragStart,
                        onDragEnd: handleDragEnd,
                        onDragOver: handleDragOver,
                        onDrop: handleDrop,
                        isSource: dragIdx === idx,
                        isTarget: dragOverIdx === idx && dragIdx !== idx,
                        onGripTouchStart: IS_IOS ? handleGripTouchStart : null,
                        onRowTouchStart: IS_LONG_PRESS_ROW ? handleRowTouchStart : null,
                      } : null}
                    />
                  );
                })
              ) : (
                <p className={`text-xs ${textSecondary} opacity-70 py-2`}>{t('planner.noUnscheduledTasks', 'No unscheduled tasks.')}</p>
              )}
            </div>
            )}
          </div>
        </div>
        );
        // hyperGLANCE's settings, wherever the header opened them. The editor
        // writes every change to the project as it is made, so closing it
        // needs no save.
        const hyperEditor = (twoColumns) => (
          <HyperGlanceEditor
            value={project.hyperglance}
            onChange={hg => updateProject(project.id, { hyperglance: hg })}
            wide={twoColumns}
          />
        );
        // Phone and portrait tablet: the sheet's other page, in the body's place.
        const hyperPageBody = hyperPage && (
          <div
            data-planner-hyperglance-page
            className={`p-4 flex flex-col gap-4 ${isMobile ? 'flex-shrink-0' : 'flex-1 min-h-0 overflow-y-auto min-w-0'}`}
            style={isMobile ? { paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' } : undefined}
          >
            <button
              type="button"
              onClick={() => setHyperOpen(false)}
              className={`self-start flex-shrink-0 flex items-center gap-1 text-xs font-medium px-1.5 py-1 -ml-1.5 rounded-lg ${hoverBg} ${textSecondary}`}
            >
              <ArrowLeft size={13} />
              {t('planner.backToTasks')}
            </button>
            {hyperEditor(!isMobile)}
          </div>
        );
        const aside = hyperPanel ? (
          <aside data-planner-hyperglance-panel className={`flex-1 min-w-[24rem] max-w-[56rem] border-l ${borderClass} overflow-y-auto p-4`} aria-label="hyperGLANCE">
            {hyperEditor(false)}
          </aside>
        ) : sidebar && (
          // The lists keep the planner's usual width and the notes take the
          // rest: half the row on a narrower screen, up to 56rem on a wide one.
          <aside data-planner-notes className={`flex-1 min-w-[24rem] max-w-[56rem] border-l ${borderClass} overflow-y-auto p-4`} aria-label={t('task.notes', 'Notes')}>
            {selectedTask ? (
              <TaskNotesPane
                key={selectedTask.id}
                task={selectedTask}
                autoFocus={false}
                focusNoteRequest={noteFocusRequest}
                // Saved with Shift+Enter: the arrows move the selection again.
                onNoteSaved={() => requestAnimationFrame(takeKeyboard)}
              />
            ) : (
              <p className={`text-sm ${textSecondary}`}>{t('planner.selectForNotes')}</p>
            )}
            <p className={`mt-4 text-xs ${textSecondary} opacity-80`}>{t('planner.notesKeysHint')}</p>
          </aside>
        );
        if (hyperPage) return isMobile ? hyperPageBody : <div className="flex-1 min-h-0 flex">{hyperPageBody}</div>;
        return isMobile ? body : <div className="flex-1 min-h-0 flex">{body}{aside}</div>;
        })()}
      </div>
    </div>
  );
};

export default ProjectPlanner;
