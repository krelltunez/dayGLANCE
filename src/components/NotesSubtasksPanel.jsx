import React, { useState, useEffect, useMemo, useRef } from 'react';
import { BookOpen, Loader, Sparkles, X, Check, Plus, ExternalLink, GripVertical } from 'lucide-react';
import { noteTextHash } from '@glance-apps/obsidian-format';
import { useTranslation } from 'react-i18next';
import { isOnlyUrl, renderFormattedText } from '../utils/textFormatting.jsx';
import { activeLocale, formatLocalizedDate } from '../utils/localeFormatting.js';
import { formatDuration } from '../utils/formatDuration.js';
import { isCalendarEventRow } from '../utils/eventNotes.js';
import { noteFocusTarget } from '../utils/noteFocusTarget.js';
import { autoSizeTextarea } from '../utils/autoSizeTextarea.js';
import { useSyncCtx } from '../context/SyncContext.jsx';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { taskLink } from '../utils/followUp.js';
import { buildLinkIndex, canLinkTask, findBacklinks, insertTaskLink, linkCandidates, pickerQueryAt, taskThread } from '../utils/taskLinks.js';
import TaskLinkPicker from './TaskLinkPicker.jsx';
import TaskThread from './TaskThread.jsx';
import { dropIndex } from '../utils/subtaskOrder.js';
import { beginLongPressReorder } from '../utils/longPressReorder.js';
import { aiFeatureOn } from '../ai.js';
import { describeAgo } from '../utils/bridgeStatus.js';

/** Format an ISO timestamp as a human-readable relative or absolute string. */
function formatNoteTimestamp(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const relativeTime = new Intl.RelativeTimeFormat(activeLocale(), { numeric: 'auto', style: 'narrow' });
  if (diffMin < 1) return relativeTime.format(0, 'second');
  if (diffMin < 60) return relativeTime.format(-diffMin, 'minute');
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return relativeTime.format(-diffH, 'hour');
  return formatLocalizedDate(d, { month: 'short', day: 'numeric' });
}

// When the Obsidian plugin reported a note the panel shows from its report
// (#2291 follow-up), or null for a note read from the vault folder.
const reportedAtOf = (r) => (r?.source === 'report' && typeof r.observedAt === 'string' ? r.observedAt : null);

// Why a linked note cannot be shown, as the task-note loader says it
// (useObsidianSync's loadTaskNote): the message for each reason.
const UNAVAILABLE_MESSAGES = {
  not_found: 'task.wikiNoteNotFound',
  not_set_up: 'task.wikiNoteNotSetUp',
  not_shared: 'task.wikiNoteNotShared',
  ambiguous: 'task.wikiNoteAmbiguous',
  deleted: 'task.wikiNoteDeleted',
  unreachable: 'task.wikiNoteUnreachable',
};

/**
 * Render note text with [[wikilink]] patterns as clickable buttons.
 * Non-wikilink segments are passed through renderFormattedText.
 */
function renderNoteContent(text, onWikilinkClick, darkMode, t) {
  if (!text) return null;
  const segments = text.split(/(\[\[[^\]]+\]\])/g);
  return segments.map((seg, i) => {
    const m = seg.match(/^\[\[([^\]]+)\]\]$/);
    if (m) {
  return (
        <button
          key={i}
          type="button"
          onClick={(e) => { e.stopPropagation(); onWikilinkClick(m[1]); }}
          title={t('task.openWikiNote', { name: m[1] })}
          className={`underline decoration-dashed underline-offset-2 transition-colors ${darkMode ? 'text-purple-300 hover:text-purple-200' : 'text-purple-600 hover:text-purple-700'}`}
        >
          {m[1]}
        </button>
      );
    }
    return <span key={i} style={{ whiteSpace: 'pre-wrap' }}>{renderFormattedText(seg)}</span>;
  });
}

// A blur because the user switched to another app or window, not because
// they clicked elsewhere here: the editor keeps its place for their return.
// (The window has already lost focus when the editor's blur arrives.)
const leftTheWindow = () => typeof document !== 'undefined' && typeof document.hasFocus === 'function' && !document.hasFocus();

const NotesSubtasksPanel = ({
  task,
  isInbox,
  darkMode,
  updateTaskNotes,
  addSubtask,
  toggleSubtask,
  deleteSubtask,
  updateSubtaskTitle,
  // Reorders a subtask (#2176); defaults to the planner's. Focus mode passes
  // its own, which keeps its session copy of the task in step.
  moveSubtask: moveSubtaskProp,
  compact = true, // Use compact mode for inbox, expanded for timeline
  noAutoFocus = false,
  aiConfig,
  aiSubtasksLoadingForTask,
  onGenerateSubtasks,
  // Wikilink note props (desktop + Obsidian tasks only)
  wikilinks,          // string[] — note names extracted from task title
  onLoadWikiNote,     // async (noteName) => { text } | null
  onSaveWikiNote,     // async (noteName, content) => void
  onOpenInObsidian,   // (noteName) => void — opens note in Obsidian app/desktop
  // Bump to put the cursor in the note from outside (the planner's E key).
  focusNoteRequest = 0,
  // Called after Shift+Enter saves a note, so the host can take the keyboard
  // back (the planner returns it to its list).
  onNoteSaved,
}) => {
  const { t } = useTranslation();
  // A calendar event's `notes` are its description from the calendar, which
  // every refresh rebuilds: shown read-only, while the note you edit is your
  // own, kept apart (utils/eventNotes.js). Events take no subtasks, which
  // would be lost the same way.
  const isEvent = isCalendarEventRow(task);
  // The wikilink hint (2026-10-04, a field report: a user kept notes in his
  // vault and never found that [[Note]] in the title brings the note here).
  // Shown under a task's own notes while no note is linked, only where the
  // Obsidian vault is enabled; every surface that mounts this panel wires
  // the linked-note editor, so the promise holds wherever it shows.
  const obsidianEnabled = !!useSyncCtx()?.obsidianConfig?.enabled;
  const ownNotes = (isEvent ? task.eventNote : task.notes) || '';
  const isGeneratingSubtasks = aiSubtasksLoadingForTask === task.id;
  const [editingSubtaskId, setEditingSubtaskId] = useState(null);
  const [editingSubtaskText, setEditingSubtaskText] = useState('');
  const [localNotes, setLocalNotes] = useState(ownNotes);
  const [localSubtaskText, setLocalSubtaskText] = useState('');
  const [isEditingNotes, setIsEditingNotes] = useState(!ownNotes); // Edit mode when no content
  const localNotesRef = useRef(localNotes);
  const taskNotesRef = useRef(ownNotes);
  const taskIdRef = useRef(task.id);
  const isInboxRef = useRef(isInbox);
  const updateTaskNotesRef = useRef(updateTaskNotes);

  // Linked wiki note state (desktop Obsidian tasks only)
  const [linkedNoteStates, setLinkedNoteStates] = useState({}); // { noteName: { text, lastModified, loading, error } }
  const [linkedNoteEditing, setLinkedNoteEditing] = useState({}); // { noteName: boolean }
  const linkedNoteTextsRef = useRef({}); // { noteName: currentText } — for save-on-unmount
  const linkedNoteOriginalRef = useRef({}); // { noteName: textAtLoad } — to detect changes
  const linkedNoteFromReportRef = useRef({}); // { noteName: true } while it shows the plugin's report
  const onSaveWikiNoteRef = useRef(onSaveWikiNote);
  useEffect(() => { onSaveWikiNoteRef.current = onSaveWikiNote; }, [onSaveWikiNote]);
  const requestedNotesRef = useRef(new Set()); // note names a load has been started for
  // Notes the vault migration just moved out of this record: the linked note
  // shows them until the plugin has written it (see the wikilinks effect).
  const migratedNotesRef = useRef(null);

  // Additional notes navigated to via [[wikilink]] clicks inside note content
  const [additionalNotes, setAdditionalNotes] = useState([]);

  // ── Theme tokens ──────────────────────────────────────────────────────────
  const th = darkMode ? {
    panel:        'bg-black/50 text-white',
    label:        'text-white/80',
    textarea:     'bg-white/10 text-white border-white/20 focus:bg-white/20 focus:border-white/40 placeholder:text-white/40',
    preview:      'bg-white/10 hover:bg-white/15 text-white',
    aiBtn:        'text-white/60 hover:text-white/90',
    checkbox:     'bg-white/20 border-white',
    checkIcon:    'text-white',
    subtaskText:  'text-white',
    deleteBtn:    'hover:bg-white/20 text-white/60',
    subtaskInput: 'bg-white/20 text-white border-white/30 focus:bg-white/30',
    addInput:     'text-white placeholder:text-white/40 focus:border-white/30',
    addIcon:      'text-white/50',
    addBorder:    'border-transparent focus:border-white/30',
    url:          'text-blue-300 hover:text-blue-200',
    obsBtn:       'hover:bg-white/10 active:bg-white/10 text-white/70 hover:text-white',
    noteTs:       'text-white/40',
  } : {
    panel:        'bg-gray-100 text-gray-800 border border-gray-200',
    label:        'text-gray-500',
    textarea:     'bg-white text-gray-900 border-gray-300 focus:border-blue-400 placeholder:text-gray-400',
    preview:      'bg-white hover:bg-gray-50 text-gray-800 border border-gray-200',
    aiBtn:        'text-gray-400 hover:text-gray-700',
    checkbox:     'bg-gray-200 border-gray-400',
    checkIcon:    'text-gray-700',
    subtaskText:  'text-gray-800',
    deleteBtn:    'hover:bg-gray-200 text-gray-400',
    subtaskInput: 'bg-gray-50 text-gray-900 border-gray-300 focus:bg-white',
    addInput:     'text-gray-800 placeholder:text-gray-400 focus:border-gray-300',
    addIcon:      'text-gray-400',
    addBorder:    'border-transparent focus:border-gray-300',
    url:          'text-blue-600 hover:text-blue-700',
    obsBtn:       'hover:bg-gray-100 active:bg-gray-100 text-gray-500 hover:text-gray-700',
    noteTs:       'text-gray-400',
  };

  /**
   * Start a load for a linked note, once. With `seededText` the panel already
   * shows the text the migration moved into this note, so an absent or
   * unreadable note keeps that text instead of an empty editor or an error;
   * only a note the vault actually returns replaces it.
   */
  const loadNote = (noteName, seededText = null) => {
    if (requestedNotesRef.current.has(noteName)) return; // already loaded or loading
    requestedNotesRef.current.add(noteName);
    const seeded = seededText !== null;
    if (!seeded) setLinkedNoteStates(prev => ({ ...prev, [noteName]: { text: '', lastModified: null, loading: true, error: null } }));
    // The task-note loader (#2291 follow-up): the note from the vault folder
    // or from the Obsidian plugin's report of it, and, when neither can show
    // it, WHY (`unavailable`), so the panel can say so honestly.
    onLoadWikiNote?.(noteName, { taskPanel: true }).then(result => {
      if (seeded && (result === null || result?.notFound || result?.unavailable)) return;
      if (result === null || result?.unavailable === 'read_failed') {
        // Vault unavailable or the read failed — no editor, fail closed.
        setLinkedNoteStates(prev => ({ ...prev, [noteName]: { text: '', lastModified: null, loading: false, error: 'not_found' } }));
        return;
      }
      if (result?.unavailable) {
        // Nothing to show, and no editor: no folder here and the note is not
        // reported (or is ambiguous, deleted, or could not be asked for).
        const hint = result.newNotesFolderOutsideScope ? { newNotesFolder: result.newNotesFolder } : null;
        setLinkedNoteStates(prev => ({ ...prev, [noteName]: { text: '', lastModified: null, loading: false, error: result.unavailable, hint } }));
        return;
      }
      if (result?.notFound) {
        // The vault is reachable but the note doesn't exist yet: seed an
        // EMPTY editor (not a dead-end error) so typing here creates the
        // note — the ordinary save paths (blur / Shift+Enter / unmount
        // flush) route through onSaveWikiNote's creation path.
        setLinkedNoteStates(prev => ({ ...prev, [noteName]: { text: '', lastModified: null, loading: false, error: null } }));
        setLinkedNoteEditing(prev => ({ ...prev, [noteName]: true }));
        linkedNoteTextsRef.current[noteName] = '';
        linkedNoteOriginalRef.current[noteName] = '';
        return;
      }
      const text = result?.text ?? '';
      // From the plugin's report: when it was reported, said under the note.
      const reportedAt = reportedAtOf(result);
      setLinkedNoteStates(prev => ({ ...prev, [noteName]: { text, lastModified: result?.lastModified ?? null, loading: false, error: null, reportedAt } }));
      setLinkedNoteEditing(prev => ({ ...prev, [noteName]: !text }));
      linkedNoteTextsRef.current[noteName] = text;
      linkedNoteOriginalRef.current[noteName] = text;
      linkedNoteFromReportRef.current[noteName] = result?.source === 'report';
    }).catch(err => {
      if (seeded) return;
      setLinkedNoteStates(prev => ({ ...prev, [noteName]: { text: '', lastModified: null, loading: false, error: err.message } }));
    });
  };

  // REFUSE ON CHANGE (owner ruling 2026-10-03): the save carries the hash of
  // the text as loaded; a note that moved in Obsidian meanwhile is not
  // overwritten. The newer text is loaded, the unsaved text kept below it
  // for the user to settle, and the panel says so.
  const saveLinkedNote = (noteName, text) => {
    const original = linkedNoteOriginalRef.current[noteName] ?? '';
    if (text === original || !onSaveWikiNote) return;
    linkedNoteOriginalRef.current[noteName] = text;
    Promise.resolve(onSaveWikiNote(noteName, text, { base: noteTextHash(original), taskPanel: true })).then((r) => {
      if (r?.ok && r.mode === 'queued') {
        // Sent from this device: the note now shows what it wrote, not a
        // report's age (it still lives on the stream's side, for the flush).
        setLinkedNoteStates(prev => ({ ...prev, [noteName]: { ...(prev[noteName] || {}), reportedAt: null } }));
      }
      if (!r?.refused) return;
      const merged = `${r.text}\n\n${text}`.trim();
      linkedNoteOriginalRef.current[noteName] = r.text;
      linkedNoteTextsRef.current[noteName] = merged;
      linkedNoteFromReportRef.current[noteName] = r.source === 'report';
      setLinkedNoteStates(prev => ({ ...prev, [noteName]: { ...(prev[noteName] || {}), text: merged, lastModified: r.lastModified ?? null, loading: false, error: null, conflict: true, reportedAt: reportedAtOf(r) } }));
      setLinkedNoteEditing(prev => ({ ...prev, [noteName]: true }));
    }).catch(() => {});
  };

  const handleContentWikilinkClick = (noteName) => {
    if (!additionalNotes.includes(noteName)) {
      setAdditionalNotes(prev => [...prev, noteName]);
    }
    loadNote(noteName);
  };

  // Save unsaved linked note changes on unmount. Intentionally reads the refs'
  // CURRENT values at unmount to flush the latest edits — the lint suggestion to
  // snapshot at mount would capture the initial (empty) state instead.
  useEffect(() => {
    return () => {
      if (!onSaveWikiNoteRef.current) return;
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const texts = linkedNoteTextsRef.current;
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const originals = linkedNoteOriginalRef.current;
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const fromReport = linkedNoteFromReportRef.current;
      Object.entries(texts).forEach(([noteName, text]) => {
        if (text !== (originals[noteName] ?? '')) {
          // A note shown from the plugin's report is only ever sent under
          // the base of the text shown, so the plugin can refuse it if the
          // note moved; a folder note flushes as it always has.
          if (fromReport[noteName]) onSaveWikiNoteRef.current(noteName, text, { base: noteTextHash(originals[noteName] ?? ''), taskPanel: true });
          else onSaveWikiNoteRef.current(noteName, text);
        }
      });
    };
  }, []);

  // Keep refs in sync
  useEffect(() => { localNotesRef.current = localNotes; }, [localNotes]);
  useEffect(() => {
    const next = ownNotes;
    // An external change to the record (another device, or the vault
    // migration that moved these notes into a linked note and cleared
    // them here) is adopted when this panel holds no unsaved edit: the
    // local text still equals what the record said before. With an edit
    // in flight the local text wins, as it always did.
    if (localNotesRef.current === taskNotesRef.current && localNotesRef.current !== next) {
      // The migration clears the notes as the wikilink joins the title:
      // keep the text for the linked note that appears in the same commit.
      if (!next && taskNotesRef.current) migratedNotesRef.current = taskNotesRef.current;
      setLocalNotes(next);
      setIsEditingNotes(!next);
    }
    taskNotesRef.current = next;
  }, [ownNotes]);

  // Load the linked notes: those the panel opened with, and any the title
  // gains while it is open (the vault migration adds one). A note the
  // migration just created is shown with the migrated text at once and
  // refreshed from the vault when the plugin has written it, so the panel
  // never sits on "Loading" or offers an empty editor for text it just had.
  // Declared after the notes effect above, which records that text first.
  const wikilinksKey = (wikilinks || []).join('\n');
  useEffect(() => {
    if (!wikilinksKey || !onLoadWikiNote) return;
    for (const noteName of wikilinks) {
      if (requestedNotesRef.current.has(noteName)) continue;
      const migrated = migratedNotesRef.current;
      migratedNotesRef.current = null;
      if (migrated) {
        setLinkedNoteStates(prev => ({ ...prev, [noteName]: { text: migrated, lastModified: null, loading: false, error: null } }));
        setLinkedNoteEditing(prev => ({ ...prev, [noteName]: false }));
        linkedNoteTextsRef.current[noteName] = migrated;
        linkedNoteOriginalRef.current[noteName] = migrated;
      }
      loadNote(noteName, migrated);
    }
    // loadNote reads only refs and the loader; the key stands in for the array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wikilinksKey, onLoadWikiNote]);
  useEffect(() => {
    taskIdRef.current = task.id;
    isInboxRef.current = isInbox;
  }, [task.id, isInbox]);
  useEffect(() => { updateTaskNotesRef.current = updateTaskNotes; }, [updateTaskNotes]);

  // Sync local notes with task notes when task changes (e.g., switching between tasks)
  useEffect(() => {
    setLocalNotes(ownNotes);
    setIsEditingNotes(!ownNotes);
    // Keyed on task.id only — re-syncing on task.notes would overwrite the user's
    // in-progress edits in this panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  // Save notes on unmount only (e.g., when ESC is pressed or panel closes)
  useEffect(() => {
    return () => {
      if (localNotesRef.current !== taskNotesRef.current) {
        updateTaskNotesRef.current(taskIdRef.current, localNotesRef.current, isInboxRef.current);
      }
    };
  }, []); // Empty deps = only runs on mount/unmount

  // Task links (#2145): `@@` in the note opens a picker of tasks to link to,
  // and the tasks whose notes link here are listed under the note. Both read
  // the planner's lists; outside a planner (a bare test mount) there are none.
  // With three or more linked tasks the list is the whole thread instead.
  const planner = useDayPlannerCtx();
  const plannerTasks = planner?.tasks;
  const plannerInbox = planner?.unscheduledTasks;
  const [picker, setPicker] = useState(null); // { start, caret, query } while `@@` is being typed
  const [pickerIndex, setPickerIndex] = useState(0);
  const notesFieldElRef = useRef(null);
  const pickerCandidates = useMemo(() => (picker
    ? linkCandidates({ tasks: plannerTasks || [], unscheduledTasks: plannerInbox || [] }, picker.query, { excludeId: task.id })
    : []), [picker, plannerTasks, plannerInbox, task.id]);
  const backlinks = useMemo(() => (!isEvent && canLinkTask(task)
    ? findBacklinks(task.id, { tasks: plannerTasks || [], unscheduledTasks: plannerInbox || [] })
    : []), [isEvent, task, plannerTasks, plannerInbox]);
  const thread = useMemo(() => {
    if (isEvent || !canLinkTask(task) || !plannerTasks) return null;
    const lists = { tasks: plannerTasks, unscheduledTasks: plannerInbox || [] };
    return taskThread(task.id, buildLinkIndex(lists), { ...lists, recurringTasks: planner?.recurringTasks || [], recycleBin: planner?.recycleBin || [] });
  }, [isEvent, task, plannerTasks, plannerInbox, planner?.recurringTasks, planner?.recycleBin]);
  const updatePicker = (el) => {
    notesFieldElRef.current = el;
    const caret = el.selectionStart ?? el.value.length;
    const found = el.selectionStart === el.selectionEnd ? pickerQueryAt(el.value, caret) : null;
    if (!found) { if (picker) setPicker(null); return; }
    if (!picker || picker.query !== found.query) setPickerIndex(0);
    setPicker({ ...found, caret });
  };
  const pickTask = (target) => {
    if (!picker) return;
    const next = insertTaskLink(localNotes, picker, target, taskLink);
    setLocalNotes(next.text);
    setPicker(null);
    const el = notesFieldElRef.current;
    if (el) requestAnimationFrame(() => { el.focus(); el.setSelectionRange(next.caret, next.caret); });
  };

  const handleNotesChange = (e) => { setLocalNotes(e.target.value); updatePicker(e.target); };

  // Subtask reordering (#2176). A grip on each row: drag it (pointer), hold
  // and move it (touch), or focus it and press Up/Down. The panel often sits
  // inside a card that is itself draggable (timeline, Inbox), so every drag
  // event the grip and rows handle stops here: the grip, being draggable
  // itself, is the drag's source, and the card never hears of it.
  const moveSubtask = moveSubtaskProp || planner?.moveSubtask;
  const subtaskCount = task.subtasks?.length || 0;
  const canReorder = !!moveSubtask && !isEvent && subtaskCount > 1;
  const [subtaskDrag, setSubtaskDrag] = useState(null); // { id, from, over, lower }
  const gripRefs = useRef(new Map());
  const focusGripAfterMove = (id) => requestAnimationFrame(() => gripRefs.current.get(id)?.focus());
  const moveTo = (id, toIndex) => moveSubtask(task.id, id, toIndex, isInbox);
  const subtaskRowSelector = `[data-subtask-of="${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(String(task.id)) : String(task.id)}"]`;
  const gripProps = (subtask, idx) => ({
    draggable: true,
    onDragStart: (e) => {
      e.stopPropagation();
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/x-dayglance-subtask', subtask.id); } catch { /* some browsers refuse custom types */ }
      setSubtaskDrag({ id: subtask.id, from: idx, over: null, lower: false });
    },
    onDragEnd: (e) => { e.stopPropagation(); setSubtaskDrag(null); },
    onTouchStart: (e) => {
      e.stopPropagation();
      beginLongPressReorder(e, {
        idx,
        hitSelector: subtaskRowSelector,
        onActivate: () => setSubtaskDrag({ id: subtask.id, from: idx, over: idx, lower: false }),
        onOver: (over) => setSubtaskDrag(d => (d ? { ...d, over, lower: over > d.from } : d)),
        onEnd: ({ activated, fromIdx, overIdx }) => {
          setSubtaskDrag(null);
          if (activated && overIdx != null && overIdx !== fromIdx) moveTo(subtask.id, overIdx);
        },
      });
    },
    onKeyDown: (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      e.stopPropagation();
      const to = idx + (e.key === 'ArrowUp' ? -1 : 1);
      if (to < 0 || to >= subtaskCount) return;
      moveTo(subtask.id, to);
      focusGripAfterMove(subtask.id);
    },
  });
  const rowDropProps = (idx) => (subtaskDrag ? {
    onDragOver: (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      const rect = e.currentTarget.getBoundingClientRect();
      const lower = e.clientY > rect.top + rect.height / 2;
      if (subtaskDrag.over !== idx || subtaskDrag.lower !== lower) setSubtaskDrag(d => (d ? { ...d, over: idx, lower } : d));
    },
    onDrop: (e) => {
      e.preventDefault();
      e.stopPropagation();
      const drag = subtaskDrag;
      setSubtaskDrag(null);
      if (drag) moveTo(drag.id, dropIndex(drag.from, idx, drag.lower));
    },
  } : {});

  const handleNotesKeyDown = (e) => {
    // The picker has the arrows, Enter, Tab and Escape while it is open; the
    // note keeps every other key, so typing goes on narrowing it.
    if (picker) {
      const count = pickerCandidates.length;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        e.nativeEvent?.stopImmediatePropagation?.();
        setPicker(null);
        return;
      }
      if (count > 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        setPickerIndex(i => (i + (e.key === 'ArrowDown' ? 1 : -1) + count) % count);
        return;
      }
      if (count > 0 && ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab')) {
        e.preventDefault();
        e.stopPropagation();
        pickTask(pickerCandidates[Math.min(pickerIndex, count - 1)].task);
        return;
      }
    }
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      if (localNotes !== ownNotes) updateTaskNotes(task.id, localNotes, isInbox);
      if (localNotes) setIsEditingNotes(false);
      onNoteSaved?.();
    }
  };

  const handleNotesBlur = () => {
    setPicker(null);
    if (localNotes !== ownNotes) updateTaskNotes(task.id, localNotes, isInbox);
    // Leaving the note shows it formatted, as Shift+Enter does and as the
    // linked note's editor already did (#2247): it used to stay raw until the
    // panel was reopened. An empty note stays open for typing.
    if (localNotes && !leftTheWindow()) setIsEditingNotes(false);
  };

  // Called from the add-subtask input's Enter keydown and nothing else.
  // preventDefault matters when the panel renders inside the task editor's
  // <form> (bucket items): the input's form owner is that outer form, so an
  // unhandled Enter would implicitly submit it — saving and closing the
  // editor. stopPropagation keeps the keydown from the editor's onKeyDown.
  const handleAddSubtask = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (localSubtaskText.trim()) {
      addSubtask(task.id, localSubtaskText, isInbox);
      setLocalSubtaskText('');
    }
  };

  const startEditingSubtask = (subtask) => {
    setEditingSubtaskId(subtask.id);
    setEditingSubtaskText(subtask.title);
  };

  const saveSubtaskEdit = () => {
    if (editingSubtaskText.trim()) {
      updateSubtaskTitle(task.id, editingSubtaskId, editingSubtaskText.trim(), isInbox);
    }
    setEditingSubtaskId(null);
    setEditingSubtaskText('');
  };

  const urlOnlyNote = isOnlyUrl(localNotes);
  const noteUrl = urlOnlyNote ? localNotes.trim() : null;
  const noteMinH = compact ? 'min-h-[4.5rem]' : 'min-h-[12rem]';
  // One height policy for both states (#2067): the editor sizes to its content
  // (autoSizeTextarea) and the preview grows to it, both capped at the same
  // share of the viewport and scrolling past it, so clicking to edit no longer
  // collapses a long note to the min-height floor.
  const noteMaxH = 'max-h-[60vh]';
  const textareaClass = `w-full text-sm px-2 py-1.5 rounded border outline-none ${th.textarea} ${noteMinH} ${noteMaxH} ${compact ? 'resize-none' : 'resize-y'}`;

  const showLinked = !!(wikilinks && wikilinks.length > 0 && onLoadWikiNote);
  // Keyed on the local draft too, so the block does not vanish mid-edit.
  const hasLocalNotes = !!((localNotes || '').trim() || ownNotes.trim());

  // A request from outside to put the cursor in the note, the one
  // noteFocusTarget picks. A note shown as a preview switches to its editor
  // first, so the field is found once it has rendered.
  const noteFieldsRef = useRef(new Map()); // 'own' | noteName -> textarea
  const pendingFocusRef = useRef(null);
  // A bump counts, not the value: a pane mounted for the next selected task
  // inherits the count and must leave the keyboard where it is.
  const seenFocusRequestRef = useRef(focusNoteRequest);
  const noteFieldRef = (key) => (el) => {
    if (el) {
      noteFieldsRef.current.set(key, el);
      // Open the editor at the note's own height, not the min-height floor.
      autoSizeTextarea(el);
    } else noteFieldsRef.current.delete(key);
  };
  useEffect(() => {
    if (focusNoteRequest === seenFocusRequestRef.current) return;
    seenFocusRequestRef.current = focusNoteRequest;
    const target = noteFocusTarget({ wikilinks, showLinked, linkedNoteStates, hasLocalNotes });
    if (!target) return;
    pendingFocusRef.current = target;
    if (target === 'own') setIsEditingNotes(true);
    else setLinkedNoteEditing(prev => ({ ...prev, [target]: true }));
    // Only a new request moves the cursor, never a change to the notes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNoteRequest]);
  useEffect(() => {
    const key = pendingFocusRef.current;
    const field = key && noteFieldsRef.current.get(key);
    if (!field) return;
    pendingFocusRef.current = null;
    field.focus({ preventScroll: true });
    field.setSelectionRange?.(field.value.length, field.value.length);
  });
  // A click on a note's preview opens its editor with the cursor in it. Where
  // the panel does not take focus as it opens (noAutoFocus: the task modals,
  // the sidebars), the editor appeared without it, and took a second click.
  const editNote = (key) => {
    pendingFocusRef.current = key;
    if (key === 'own') setIsEditingNotes(true);
    else setLinkedNoteEditing(prev => ({ ...prev, [key]: true }));
  };

  return (
    <div
      className={`mt-2 p-3 rounded-lg ${th.panel}`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Notes section: the linked vault note for a wikilinked task, and
          beneath it the local notes whenever the record holds any (a note
          can live in both places: the report in PR #1690, F4). */}
      {showLinked && (
        <div className="mb-3 space-y-3">
          {[...(wikilinks || []), ...additionalNotes].map((noteName) => {
            const state = linkedNoteStates[noteName] || { text: '', lastModified: null, loading: true, error: null };
            const isEditingWiki = linkedNoteEditing[noteName] ?? false;
            const ts = formatNoteTimestamp(state.lastModified);
            return (
              <div key={noteName}>
                <div className={`text-xs font-semibold mb-1 flex items-center gap-1.5 ${th.label}`}>
                  <BookOpen size={11} />
                  <span className="flex-1">{noteName}</span>
                  {ts && <span className={`font-normal ${th.noteTs}`}>{ts}</span>}
                  {onOpenInObsidian && (
                    <button
                      type="button"
                      onClick={() => onOpenInObsidian(noteName)}
                      title={t('task.openWikiNoteInObsidian', { name: noteName })}
                      aria-label={t('task.openWikiNoteInObsidian', { name: noteName })}
                      className={`flex items-center gap-1 transition-opacity px-1 py-0.5 rounded ${th.obsBtn}`}
                    >
                      <ExternalLink size={12} />
                      <span className="text-xs">{t('task.openInObsidian')}</span>
                    </button>
                  )}
                </div>
                {state.conflict && (
                  <p data-linked-note-conflict className="text-xs text-amber-500 mb-1">{t('task.wikiNoteChanged')}</p>
                )}
                {state.loading ? (
                  <div className={`flex items-center gap-1.5 py-2 text-xs opacity-60 ${noteMinH} ${th.label}`}>
                    <Loader size={12} className="animate-spin" />
                    {t('common.loading')}
                  </div>
                ) : state.error ? (
                  <div data-linked-note-unavailable={UNAVAILABLE_MESSAGES[state.error] ? state.error : 'load_failed'} className={`text-xs italic opacity-60 ${noteMinH} ${th.label}`}>
                    {UNAVAILABLE_MESSAGES[state.error]
                      ? t(UNAVAILABLE_MESSAGES[state.error], { name: noteName.split('|')[0].split('#')[0].split('/').pop().trim() })
                      : t('task.wikiNoteLoadFailed', { error: state.error })}
                    {state.error === 'not_shared' && state.hint?.newNotesFolder && (
                      <span data-linked-note-scope-hint className="block mt-1">{t('task.wikiNoteNewNotesFolderNotShared', { folder: state.hint.newNotesFolder })}</span>
                    )}
                    {state.error === 'not_set_up' && planner?.openSettings && (
                      <button
                        type="button"
                        data-linked-note-settings
                        onClick={(e) => { e.stopPropagation(); planner.openSettings('integrations', 'obsidian'); }}
                        className={`block mt-1 not-italic underline underline-offset-2 ${th.obsBtn}`}
                      >
                        {t('task.wikiNoteOpenObsidianSettings')}
                      </button>
                    )}
                  </div>
                ) : isEditingWiki ? (
                  <textarea
                    value={state.text}
                    onChange={(e) => {
                      const newText = e.target.value;
                      setLinkedNoteStates(prev => ({ ...prev, [noteName]: { ...prev[noteName], text: newText } }));
                      linkedNoteTextsRef.current[noteName] = newText;
                    }}
                    onBlur={() => {
                      const text = linkedNoteTextsRef.current[noteName] ?? '';
                      saveLinkedNote(noteName, text);
                      if (text && !leftTheWindow()) setLinkedNoteEditing(prev => ({ ...prev, [noteName]: false }));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && e.shiftKey) {
                        e.preventDefault();
                        const text = linkedNoteTextsRef.current[noteName] ?? '';
                        saveLinkedNote(noteName, text);
                        if (text) setLinkedNoteEditing(prev => ({ ...prev, [noteName]: false }));
                        onNoteSaved?.();
                      }
                    }}
                    ref={noteFieldRef(noteName)}
                    placeholder={t('task.emptyWikiNotePlaceholder')}
                    aria-label={t('task.editWikiNote', { name: noteName })}
                    className={textareaClass}
                    onInput={(e) => autoSizeTextarea(e.currentTarget)}
                    autoFocus={!noAutoFocus}
                  />
                ) : (
                  <div
                    onClick={() => editNote(noteName)}
                    className={`text-sm cursor-text p-2 rounded overflow-y-auto ${th.preview} ${noteMinH} ${noteMaxH}`}
                  >
                    {renderNoteContent(state.text, handleContentWikilinkClick, darkMode, t)}
                  </div>
                )}
                {state.reportedAt && !state.loading && !state.error && Number.isFinite(Date.parse(state.reportedAt)) && (
                  <p data-linked-note-reported={state.reportedAt} className={`text-xs italic mt-1 ${th.noteTs}`}>
                    {t('planner.notesReportedByObsidian', { when: describeAgo(Date.parse(state.reportedAt), Date.now(), activeLocale()) })}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
      {isEvent && (task.notes || '').trim() && (
        <div className="mb-3" data-event-description>
          <div className={`text-xs font-semibold mb-1 ${th.label}`}>{t('task.calendarDescription')}</div>
          <div className={`text-sm whitespace-pre-wrap p-2 rounded max-h-40 overflow-y-auto ${th.preview}`}>{renderFormattedText(task.notes)}</div>
        </div>
      )}
      {(!showLinked || hasLocalNotes) && (
        <div className="mb-3" data-local-notes={showLinked ? 'beside-linked' : 'only'}>
          <div className={`text-xs font-semibold mb-1 ${th.label}`}>{showLinked ? t('task.localNotes') : isEvent ? t('task.yourNotes') : t('task.notes')}</div>
          {isEditingNotes ? (
            <textarea
              value={localNotes}
              onChange={handleNotesChange}
              onKeyDown={handleNotesKeyDown}
              onBlur={handleNotesBlur}
              // A caret moved by click or arrow key opens or closes the picker.
              onSelect={(e) => updatePicker(e.currentTarget)}
              // While the picker is open, Escape closes it, not what holds the
              // note (the Goals space's chain yields to it: the planner, #2132).
              data-owns-escape={picker ? true : undefined}
              ref={noteFieldRef('own')}
              placeholder={t('task.notesFormattingPlaceholder')}
              aria-label={t('task.notes')}
              className={textareaClass}
              onInput={(e) => autoSizeTextarea(e.currentTarget)}
              autoFocus={!noAutoFocus}
            />
          ) : (
            <div
              onClick={() => editNote('own')}
              className={`text-sm whitespace-pre-wrap cursor-text p-2 rounded overflow-y-auto ${th.preview} ${noteMinH} ${noteMaxH}`}
            >
              {urlOnlyNote ? (
                <a
                  href={noteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`inline-flex items-center gap-2 font-medium break-all ${th.url}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink size={14} className="flex-shrink-0" />
                  {noteUrl}
                </a>
              ) : (
                renderFormattedText(localNotes)
              )}
            </div>
          )}
          {/* Only while the task has nothing of its own yet: a user who has
              typed notes or subtasks here has chosen this panel, and a nudge
              to move to a vault note would read as "replace what you did". */}
          {isEditingNotes && picker && (
            <TaskLinkPicker candidates={pickerCandidates} index={pickerIndex} onPick={pickTask} darkMode={darkMode} />
          )}
          {obsidianEnabled && !showLinked && !isEvent && !hasLocalNotes && !(task.subtasks?.length > 0) && (
            <p data-wikilink-hint className={`text-[11px] italic mt-1 ${th.label}`}>{t('task.wikilinkHint')}</p>
          )}
        </div>
      )}
      <TaskThread thread={thread} backlinks={backlinks} darkMode={darkMode} className="mb-3" />

      {/* Subtasks section */}
      {!isEvent && (
      <div>
        <div className={`text-xs font-semibold mb-1 flex items-center gap-1.5 ${th.label}`}>
          <span>{t('task.subtasks')} {task.subtasks?.length > 0 && `(${task.subtasks.filter(st => st.completed).length}/${task.subtasks.length})`}</span>
          {aiFeatureOn(aiConfig, 'aiSubtasks') && onGenerateSubtasks && (
            <button
              type="button"
              onClick={() => onGenerateSubtasks(task.id, task.title, task.notes, isInbox)}
              disabled={isGeneratingSubtasks}
              title={t('task.generateSubtasks')}
              className={`flex items-center gap-1 transition-colors disabled:opacity-40 ${th.aiBtn}`}
            >
              {isGeneratingSubtasks
                ? <Loader size={11} className="animate-spin" />
                : <Sparkles size={11} />}
              <span className="text-[10px] font-normal">{isGeneratingSubtasks ? t('task.generatingSubtasks') : t('task.generateSubtasks')}</span>
            </button>
          )}
        </div>

        {/* Subtasks list */}
        {task.subtasks?.length > 0 && (
          <div className="space-y-1 mb-2">
            {task.subtasks.map((subtask, idx) => (
              <div
                key={subtask.id}
                data-subtask-of={String(task.id)}
                data-drag-idx={idx}
                {...rowDropProps(idx)}
                className={`flex items-center gap-2 group ${subtaskDrag?.id === subtask.id ? 'opacity-40' : ''} ${
                  subtaskDrag && subtaskDrag.over === idx && subtaskDrag.id !== subtask.id
                    ? (subtaskDrag.lower ? 'shadow-[inset_0_-2px_0_0_rgb(59,130,246)]' : 'shadow-[inset_0_2px_0_0_rgb(59,130,246)]')
                    : ''
                }`}
              >
                {canReorder && (
                  <button
                    type="button"
                    ref={(el) => { if (el) gripRefs.current.set(subtask.id, el); else gripRefs.current.delete(subtask.id); }}
                    data-subtask-grip={subtask.id}
                    aria-label={t('task.moveSubtask', { title: subtask.title })}
                    title={t('task.moveSubtaskHint')}
                    {...gripProps(subtask, idx)}
                    className={`flex-shrink-0 -ml-1 cursor-grab active:cursor-grabbing touch-none select-none md:opacity-0 md:group-hover:opacity-60 md:focus-visible:opacity-100 opacity-40 rounded ${th.deleteBtn}`}
                  >
                    <GripVertical size={12} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => toggleSubtask(task.id, subtask.id, isInbox)}
                  title={t(subtask.completed ? 'task.markSubtaskIncomplete' : 'task.markSubtaskComplete')}
                  aria-label={t(subtask.completed ? 'task.markSubtaskIncomplete' : 'task.markSubtaskComplete')}
                  className={`rounded flex-shrink-0 border-2 w-4 h-4 flex items-center justify-center transition-colors ${th.checkbox} ${subtask.completed ? 'opacity-60' : ''}`}
                >
                  {subtask.completed && <Check size={10} strokeWidth={3} className={th.checkIcon} />}
                </button>
                {editingSubtaskId === subtask.id ? (
                  <input
                    type="text"
                    value={editingSubtaskText}
                    aria-label={t('task.editSubtask')}
                    onChange={(e) => setEditingSubtaskText(e.target.value)}
                    onBlur={saveSubtaskEdit}
                    onKeyDown={(e) => {
                      // Both stay in the field: inside the task editor's
                      // <form>, Enter would submit it and Escape close it.
                      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); saveSubtaskEdit(); }
                      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditingSubtaskId(null); setEditingSubtaskText(''); }
                    }}
                    autoFocus
                    className={`flex-1 text-sm px-1 py-0.5 rounded border outline-none ${th.subtaskInput}`}
                  />
                ) : (
                  <span
                    className={`flex-1 text-sm ${subtask.completed ? 'line-through opacity-50' : ''} cursor-text ${th.subtaskText}`}
                    onDoubleClick={() => startEditingSubtask(subtask)}
                  >
                    {subtask.title}
                    {subtask.duration && (
                      <span className="opacity-40 text-xs ml-1.5">
                        · {formatDuration(subtask.duration, t)}
                      </span>
                    )}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => deleteSubtask(task.id, subtask.id, isInbox)}
                  className={`md:opacity-0 md:group-hover:opacity-100 opacity-60 rounded p-0.5 transition-opacity ${th.deleteBtn}`}
                  title={t('task.deleteSubtask')}
                  aria-label={t('task.deleteSubtask')}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Add subtask input. Deliberately NOT a <form>: the panel can render
            inside the task editor's <form> (bucket items), and a nested form
            is invalid HTML whose submit bypasses React entirely — the browser
            performs a native GET submission and reloads the whole app. Enter
            is handled on the input instead (preventDefault also stops the
            outer form's implicit submission). */}
        <div className="flex items-center gap-2">
          <Plus size={14} className={th.addIcon} />
          <input
            type="text"
            value={localSubtaskText}
            onChange={(e) => setLocalSubtaskText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAddSubtask(e); }}
            placeholder={t('task.subtaskPlaceholder')}
            aria-label={t('task.addSubtask')}
            className={`flex-1 bg-transparent text-sm px-1 py-0.5 outline-none border-b ${th.addInput} ${th.addBorder}`}
          />
        </div>
      </div>
      )}

    </div>
  );
};

export default NotesSubtasksPanel;
