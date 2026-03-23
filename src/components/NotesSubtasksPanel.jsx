import React, { useState, useEffect, useRef } from 'react';
import { BookOpen, Loader, Sparkles, X, Check, Plus, ExternalLink } from 'lucide-react';
import { isOnlyUrl, renderFormattedText } from '../utils/textFormatting.jsx';

const NotesSubtasksPanel = ({
  task,
  isInbox,
  darkMode,
  updateTaskNotes,
  addSubtask,
  toggleSubtask,
  deleteSubtask,
  updateSubtaskTitle,
  compact = true, // Use compact mode for inbox, expanded for timeline
  noAutoFocus = false,
  aiConfig,
  aiSubtasksLoadingForTask,
  onGenerateSubtasks,
  // Wikilink note props (desktop + Obsidian tasks only)
  wikilinks,       // string[] — note names extracted from task title
  onLoadWikiNote,  // async (noteName) => { text } | null
  onSaveWikiNote,  // async (noteName, content) => void
}) => {
  const isGeneratingSubtasks = aiSubtasksLoadingForTask === task.id;
  const [editingSubtaskId, setEditingSubtaskId] = useState(null);
  const [editingSubtaskText, setEditingSubtaskText] = useState('');
  const [localNotes, setLocalNotes] = useState(task.notes || '');
  const [localSubtaskText, setLocalSubtaskText] = useState('');
  const [isEditingNotes, setIsEditingNotes] = useState(!task.notes); // Edit mode when no content
  const localNotesRef = useRef(localNotes);
  const taskNotesRef = useRef(task.notes || '');
  const taskIdRef = useRef(task.id);
  const isInboxRef = useRef(isInbox);
  const updateTaskNotesRef = useRef(updateTaskNotes);

  // Linked wiki note state (desktop Obsidian tasks only)
  const [linkedNoteStates, setLinkedNoteStates] = useState({}); // { noteName: { text, loading, error } }
  const linkedNoteTextsRef = useRef({}); // { noteName: currentText } — for save-on-unmount
  const linkedNoteOriginalRef = useRef({}); // { noteName: textAtLoad } — to detect changes
  const onSaveWikiNoteRef = useRef(onSaveWikiNote);
  useEffect(() => { onSaveWikiNoteRef.current = onSaveWikiNote; }, [onSaveWikiNote]);

  // Load wiki notes on mount
  useEffect(() => {
    if (!wikilinks || wikilinks.length === 0 || !onLoadWikiNote) return;
    wikilinks.forEach(async (noteName) => {
      setLinkedNoteStates(prev => ({ ...prev, [noteName]: { text: '', loading: true, error: null } }));
      try {
        const result = await onLoadWikiNote(noteName);
        const text = result?.text ?? '';
        setLinkedNoteStates(prev => ({ ...prev, [noteName]: { text, loading: false, error: null } }));
        linkedNoteTextsRef.current[noteName] = text;
        linkedNoteOriginalRef.current[noteName] = text;
      } catch (err) {
        setLinkedNoteStates(prev => ({ ...prev, [noteName]: { text: '', loading: false, error: err.message } }));
      }
    });
  }, []); // load only on mount

  // Save unsaved linked note changes on unmount
  useEffect(() => {
    return () => {
      if (!onSaveWikiNoteRef.current) return;
      Object.entries(linkedNoteTextsRef.current).forEach(([noteName, text]) => {
        if (text !== (linkedNoteOriginalRef.current[noteName] ?? '')) {
          onSaveWikiNoteRef.current(noteName, text);
        }
      });
    };
  }, []);

  // Keep refs in sync
  useEffect(() => {
    localNotesRef.current = localNotes;
  }, [localNotes]);

  useEffect(() => {
    taskNotesRef.current = task.notes || '';
  }, [task.notes]);

  useEffect(() => {
    taskIdRef.current = task.id;
    isInboxRef.current = isInbox;
  }, [task.id, isInbox]);

  useEffect(() => {
    updateTaskNotesRef.current = updateTaskNotes;
  }, [updateTaskNotes]);

  // Sync local notes with task notes when task changes (e.g., switching between tasks)
  useEffect(() => {
    setLocalNotes(task.notes || '');
    setIsEditingNotes(!task.notes); // Edit mode when no content
  }, [task.id]);

  // Save notes on unmount only (e.g., when ESC is pressed or panel closes)
  useEffect(() => {
    return () => {
      if (localNotesRef.current !== taskNotesRef.current) {
        updateTaskNotesRef.current(taskIdRef.current, localNotesRef.current, isInboxRef.current);
      }
    };
  }, []); // Empty deps = only runs on mount/unmount

  const handleNotesChange = (e) => {
    setLocalNotes(e.target.value);
  };

  const handleNotesKeyDown = (e) => {
    // SHIFT+ENTER switches to preview mode
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      // Save notes and switch to preview
      if (localNotes !== (task.notes || '')) {
        updateTaskNotes(task.id, localNotes, isInbox);
      }
      if (localNotes) {
        setIsEditingNotes(false);
      }
    }
  };

  const handleNotesBlur = () => {
    // Save notes on blur
    if (localNotes !== (task.notes || '')) {
      updateTaskNotes(task.id, localNotes, isInbox);
    }
  };

  const handleAddSubtask = (e) => {
    e.preventDefault();
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

  return (
    <div
      className={`mt-2 p-3 rounded-lg ${darkMode ? 'bg-black/50' : 'bg-black/25'} text-white`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Notes section — replaced by linked vault note for Obsidian wikilink tasks */}
      {wikilinks && wikilinks.length > 0 && onLoadWikiNote ? (
        <div className="mb-3 space-y-3">
          {wikilinks.map((noteName) => {
            const state = linkedNoteStates[noteName] || { text: '', loading: true, error: null };
            return (
              <div key={noteName}>
                <div className="text-xs font-semibold opacity-90 mb-1 flex items-center gap-1.5">
                  <BookOpen size={11} />
                  <span>{noteName}</span>
                </div>
                {state.loading ? (
                  <div className="flex items-center gap-1.5 py-2 opacity-60 text-xs">
                    <Loader size={12} className="animate-spin" />
                    Loading…
                  </div>
                ) : state.error ? (
                  <div className="text-xs opacity-60 italic">Could not load note: {state.error}</div>
                ) : (
                  <textarea
                    value={state.text}
                    onChange={(e) => {
                      const newText = e.target.value;
                      setLinkedNoteStates(prev => ({ ...prev, [noteName]: { ...prev[noteName], text: newText } }));
                      linkedNoteTextsRef.current[noteName] = newText;
                    }}
                    onBlur={() => {
                      const text = linkedNoteTextsRef.current[noteName] ?? '';
                      if (text !== (linkedNoteOriginalRef.current[noteName] ?? '') && onSaveWikiNote) {
                        onSaveWikiNote(noteName, text);
                        linkedNoteOriginalRef.current[noteName] = text;
                      }
                    }}
                    placeholder="Empty note — start typing to create it in your vault"
                    className={`w-full bg-white/10 text-white text-sm px-2 py-1.5 rounded border border-white/20 outline-none focus:bg-white/20 focus:border-white/40 placeholder:text-white/40 resize-y`}
                    rows={compact ? 4 : 8}
                    autoFocus={!noAutoFocus && !state.loading}
                  />
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mb-3">
          <div className="text-xs font-semibold opacity-90 mb-1">Notes</div>
          {isEditingNotes ? (
            <textarea
              value={localNotes}
              onChange={handleNotesChange}
              onKeyDown={handleNotesKeyDown}
              onBlur={handleNotesBlur}
              placeholder="Add notes... (**bold**, *italic*, __underline__, URLs) - Shift+Enter for preview"
              className={`w-full bg-white/10 text-white text-sm px-2 py-1.5 rounded border border-white/20 outline-none focus:bg-white/20 focus:border-white/40 placeholder:text-white/40 ${compact ? 'resize-none' : 'resize-y'}`}
              rows={compact ? 3 : 8}
              autoFocus={!noAutoFocus}
            />
          ) : (
            <div
              onClick={() => setIsEditingNotes(true)}
              className="text-sm whitespace-pre-wrap cursor-text min-h-[4.5rem] p-2 rounded bg-white/10 hover:bg-white/15"
            >
              {urlOnlyNote ? (
                <a
                  href={noteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-blue-300 hover:text-blue-200 font-medium break-all"
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
        </div>
      )}

      {/* Subtasks section */}
      <div>
        <div className="text-xs font-semibold opacity-90 mb-1 flex items-center gap-1.5">
          <span>Subtasks {task.subtasks?.length > 0 && `(${task.subtasks.filter(st => st.completed).length}/${task.subtasks.length})`}</span>
          {aiConfig?.enabled && aiConfig.features?.aiSubtasks && onGenerateSubtasks && (
            <button
              type="button"
              onClick={() => onGenerateSubtasks(task.id, task.title, task.notes, isInbox)}
              disabled={isGeneratingSubtasks}
              title="Generate subtasks with AI"
              className="flex items-center gap-1 text-white/60 hover:text-white/90 transition-colors disabled:opacity-40"
            >
              {isGeneratingSubtasks
                ? <Loader size={11} className="animate-spin" />
                : <Sparkles size={11} />}
              <span className="text-[10px] font-normal">{isGeneratingSubtasks ? 'Generating…' : 'Generate with AI'}</span>
            </button>
          )}
        </div>

        {/* Subtasks list */}
        {task.subtasks?.length > 0 && (
          <div className="space-y-1 mb-2">
            {task.subtasks.map((subtask) => (
              <div
                key={subtask.id}
                className="flex items-center gap-2 group"
              >
                <button
                  onClick={() => toggleSubtask(task.id, subtask.id, isInbox)}
                  className={`rounded flex-shrink-0 ${subtask.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center hover:bg-white/30 transition-colors`}
                >
                  {subtask.completed && <Check size={10} strokeWidth={3} />}
                </button>
                {editingSubtaskId === subtask.id ? (
                  <input
                    type="text"
                    value={editingSubtaskText}
                    onChange={(e) => setEditingSubtaskText(e.target.value)}
                    onBlur={saveSubtaskEdit}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveSubtaskEdit();
                      if (e.key === 'Escape') {
                        setEditingSubtaskId(null);
                        setEditingSubtaskText('');
                      }
                    }}
                    autoFocus
                    className="flex-1 bg-white/20 text-white text-sm px-1 py-0.5 rounded border border-white/30 outline-none focus:bg-white/30"
                  />
                ) : (
                  <span
                    className={`flex-1 text-sm ${subtask.completed ? 'line-through opacity-60' : ''} cursor-text`}
                    onDoubleClick={() => startEditingSubtask(subtask)}
                  >
                    {subtask.title}
                    {subtask.duration && (
                      <span className="opacity-40 text-xs ml-1.5">
                        · {subtask.duration < 60 ? `${subtask.duration}m` : `${Math.round(subtask.duration / 60 * 10) / 10}h`}
                      </span>
                    )}
                  </span>
                )}
                <button
                  onClick={() => deleteSubtask(task.id, subtask.id, isInbox)}
                  className="md:opacity-0 md:group-hover:opacity-100 opacity-60 hover:bg-white/20 rounded p-0.5 transition-opacity"
                  title="Delete subtask"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Add subtask input */}
        <form onSubmit={handleAddSubtask} className="flex items-center gap-2">
          <Plus size={14} className="opacity-50" />
          <input
            type="text"
            value={localSubtaskText}
            onChange={(e) => setLocalSubtaskText(e.target.value)}
            placeholder="Add subtask..."
            className="flex-1 bg-transparent text-white text-sm px-1 py-0.5 outline-none placeholder:text-white/40 border-b border-transparent focus:border-white/30"
          />
        </form>
      </div>

    </div>
  );
};

export default NotesSubtasksPanel;
