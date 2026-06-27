import React, { useState, useEffect, useRef } from 'react';
import { BookOpen, Loader, Sparkles, X, Check, Plus, ExternalLink } from 'lucide-react';
import { isOnlyUrl, renderFormattedText } from '../utils/textFormatting.jsx';

/** Format an ISO timestamp as a human-readable relative or absolute string. */
function formatNoteTimestamp(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Render note text with [[wikilink]] patterns as clickable buttons.
 * Non-wikilink segments are passed through renderFormattedText.
 */
function renderNoteContent(text, onWikilinkClick, darkMode) {
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
          title={`Open "${m[1]}"`}
          className={`underline decoration-dashed underline-offset-2 transition-colors ${darkMode ? 'text-purple-300 hover:text-purple-200' : 'text-purple-600 hover:text-purple-700'}`}
        >
          {m[1]}
        </button>
      );
    }
    return <span key={i} style={{ whiteSpace: 'pre-wrap' }}>{renderFormattedText(seg)}</span>;
  });
}

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
  wikilinks,          // string[] — note names extracted from task title
  onLoadWikiNote,     // async (noteName) => { text } | null
  onSaveWikiNote,     // async (noteName, content) => void
  onOpenInObsidian,   // (noteName) => void — opens note in Obsidian app/desktop
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
  const [linkedNoteStates, setLinkedNoteStates] = useState({}); // { noteName: { text, lastModified, loading, error } }
  const [linkedNoteEditing, setLinkedNoteEditing] = useState({}); // { noteName: boolean }
  const linkedNoteTextsRef = useRef({}); // { noteName: currentText } — for save-on-unmount
  const linkedNoteOriginalRef = useRef({}); // { noteName: textAtLoad } — to detect changes
  const onSaveWikiNoteRef = useRef(onSaveWikiNote);
  useEffect(() => { onSaveWikiNoteRef.current = onSaveWikiNote; }, [onSaveWikiNote]);

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

  const loadNote = (noteName) => {
    if (linkedNoteStates[noteName]) return; // already loaded or loading
    setLinkedNoteStates(prev => ({ ...prev, [noteName]: { text: '', lastModified: null, loading: true, error: null } }));
    onLoadWikiNote?.(noteName).then(result => {
      if (result === null) {
        setLinkedNoteStates(prev => ({ ...prev, [noteName]: { text: '', lastModified: null, loading: false, error: 'not_found' } }));
        return;
      }
      const text = result?.text ?? '';
      setLinkedNoteStates(prev => ({ ...prev, [noteName]: { text, lastModified: result?.lastModified ?? null, loading: false, error: null } }));
      setLinkedNoteEditing(prev => ({ ...prev, [noteName]: !text }));
      linkedNoteTextsRef.current[noteName] = text;
      linkedNoteOriginalRef.current[noteName] = text;
    }).catch(err => {
      setLinkedNoteStates(prev => ({ ...prev, [noteName]: { text: '', lastModified: null, loading: false, error: err.message } }));
    });
  };

  const handleContentWikilinkClick = (noteName) => {
    if (!additionalNotes.includes(noteName)) {
      setAdditionalNotes(prev => [...prev, noteName]);
    }
    loadNote(noteName);
  };

  // Load wiki notes on mount
  useEffect(() => {
    if (!wikilinks || wikilinks.length === 0 || !onLoadWikiNote) return;
    wikilinks.forEach(noteName => loadNote(noteName));
    // Load only on mount; wikilinks/loaders are read once when the panel opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      Object.entries(texts).forEach(([noteName, text]) => {
        if (text !== (originals[noteName] ?? '')) {
          onSaveWikiNoteRef.current(noteName, text);
        }
      });
    };
  }, []);

  // Keep refs in sync
  useEffect(() => { localNotesRef.current = localNotes; }, [localNotes]);
  useEffect(() => { taskNotesRef.current = task.notes || ''; }, [task.notes]);
  useEffect(() => {
    taskIdRef.current = task.id;
    isInboxRef.current = isInbox;
  }, [task.id, isInbox]);
  useEffect(() => { updateTaskNotesRef.current = updateTaskNotes; }, [updateTaskNotes]);

  // Sync local notes with task notes when task changes (e.g., switching between tasks)
  useEffect(() => {
    setLocalNotes(task.notes || '');
    setIsEditingNotes(!task.notes);
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

  const handleNotesChange = (e) => setLocalNotes(e.target.value);

  const handleNotesKeyDown = (e) => {
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      if (localNotes !== (task.notes || '')) updateTaskNotes(task.id, localNotes, isInbox);
      if (localNotes) setIsEditingNotes(false);
    }
  };

  const handleNotesBlur = () => {
    if (localNotes !== (task.notes || '')) updateTaskNotes(task.id, localNotes, isInbox);
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
  const noteMinH = compact ? 'min-h-[4.5rem]' : 'min-h-[12rem]';
  const textareaClass = `w-full text-sm px-2 py-1.5 rounded border outline-none ${th.textarea} ${noteMinH} ${compact ? 'resize-none' : 'resize-y'}`;

  return (
    <div
      className={`mt-2 p-3 rounded-lg ${th.panel}`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Notes section — replaced by linked vault note for Obsidian wikilink tasks */}
      {wikilinks && wikilinks.length > 0 && onLoadWikiNote ? (
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
                      title={`Open "${noteName}" in Obsidian`}
                      className={`flex items-center gap-1 transition-opacity px-1 py-0.5 rounded ${th.obsBtn}`}
                    >
                      <ExternalLink size={12} />
                      <span className="text-xs">Open in Obsidian</span>
                    </button>
                  )}
                </div>
                {state.loading ? (
                  <div className={`flex items-center gap-1.5 py-2 text-xs opacity-60 ${noteMinH} ${th.label}`}>
                    <Loader size={12} className="animate-spin" />
                    Loading…
                  </div>
                ) : state.error ? (
                  <div className={`text-xs italic opacity-60 ${noteMinH} ${th.label}`}>
                    {state.error === 'not_found'
                      ? 'Note not found in vault — check that your vault is configured and the note exists.'
                      : `Could not load note: ${state.error}`}
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
                      if (text !== (linkedNoteOriginalRef.current[noteName] ?? '') && onSaveWikiNote) {
                        onSaveWikiNote(noteName, text);
                        linkedNoteOriginalRef.current[noteName] = text;
                      }
                      if (text) setLinkedNoteEditing(prev => ({ ...prev, [noteName]: false }));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && e.shiftKey) {
                        e.preventDefault();
                        const text = linkedNoteTextsRef.current[noteName] ?? '';
                        if (text !== (linkedNoteOriginalRef.current[noteName] ?? '') && onSaveWikiNote) {
                          onSaveWikiNote(noteName, text);
                          linkedNoteOriginalRef.current[noteName] = text;
                        }
                        if (text) setLinkedNoteEditing(prev => ({ ...prev, [noteName]: false }));
                      }
                    }}
                    placeholder="Empty note — start typing to create it in your vault"
                    className={textareaClass}
                    autoFocus={!noAutoFocus}
                  />
                ) : (
                  <div
                    onClick={() => setLinkedNoteEditing(prev => ({ ...prev, [noteName]: true }))}
                    className={`text-sm cursor-text p-2 rounded ${th.preview} ${noteMinH}`}
                  >
                    {renderNoteContent(state.text, handleContentWikilinkClick, darkMode)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mb-3">
          <div className={`text-xs font-semibold mb-1 ${th.label}`}>Notes</div>
          {isEditingNotes ? (
            <textarea
              value={localNotes}
              onChange={handleNotesChange}
              onKeyDown={handleNotesKeyDown}
              onBlur={handleNotesBlur}
              placeholder="Add notes... (**bold**, *italic*, __underline__, URLs) - Shift+Enter for preview"
              className={textareaClass}
              autoFocus={!noAutoFocus}
            />
          ) : (
            <div
              onClick={() => setIsEditingNotes(true)}
              className={`text-sm whitespace-pre-wrap cursor-text p-2 rounded ${th.preview} ${noteMinH}`}
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
        </div>
      )}

      {/* Subtasks section */}
      <div>
        <div className={`text-xs font-semibold mb-1 flex items-center gap-1.5 ${th.label}`}>
          <span>Subtasks {task.subtasks?.length > 0 && `(${task.subtasks.filter(st => st.completed).length}/${task.subtasks.length})`}</span>
          {aiConfig?.enabled && aiConfig.features?.aiSubtasks && onGenerateSubtasks && (
            <button
              type="button"
              onClick={() => onGenerateSubtasks(task.id, task.title, task.notes, isInbox)}
              disabled={isGeneratingSubtasks}
              title="Generate subtasks with AI"
              className={`flex items-center gap-1 transition-colors disabled:opacity-40 ${th.aiBtn}`}
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
              <div key={subtask.id} className="flex items-center gap-2 group">
                <button
                  onClick={() => toggleSubtask(task.id, subtask.id, isInbox)}
                  className={`rounded flex-shrink-0 border-2 w-4 h-4 flex items-center justify-center transition-colors ${th.checkbox} ${subtask.completed ? 'opacity-60' : ''}`}
                >
                  {subtask.completed && <Check size={10} strokeWidth={3} className={th.checkIcon} />}
                </button>
                {editingSubtaskId === subtask.id ? (
                  <input
                    type="text"
                    value={editingSubtaskText}
                    onChange={(e) => setEditingSubtaskText(e.target.value)}
                    onBlur={saveSubtaskEdit}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveSubtaskEdit();
                      if (e.key === 'Escape') { setEditingSubtaskId(null); setEditingSubtaskText(''); }
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
                        · {subtask.duration < 60 ? `${subtask.duration}m` : `${Math.round(subtask.duration / 60 * 10) / 10}h`}
                      </span>
                    )}
                  </span>
                )}
                <button
                  onClick={() => deleteSubtask(task.id, subtask.id, isInbox)}
                  className={`md:opacity-0 md:group-hover:opacity-100 opacity-60 rounded p-0.5 transition-opacity ${th.deleteBtn}`}
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
          <Plus size={14} className={th.addIcon} />
          <input
            type="text"
            value={localSubtaskText}
            onChange={(e) => setLocalSubtaskText(e.target.value)}
            placeholder="Add subtask..."
            className={`flex-1 bg-transparent text-sm px-1 py-0.5 outline-none border-b ${th.addInput} ${th.addBorder}`}
          />
        </form>
      </div>

    </div>
  );
};

export default NotesSubtasksPanel;
