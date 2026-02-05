import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Plus, Clock, X, GripVertical, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Moon, Sun, Upload, Inbox, AlertCircle, Calendar, Check, RefreshCw, Palette, CalendarPlus, Trash2, Undo2, BarChart3, SkipForward, Hash, MoreHorizontal, Save, Menu, MailPlus, UserPlus, BrainCircuit, Mail, AlertTriangle, FileText, ExternalLink, CheckSquare, HelpCircle, Sparkles, Link, GripHorizontal } from 'lucide-react';

// Hook to determine how many days to show based on window width
const useVisibleDays = () => {
  const [visibleDays, setVisibleDays] = useState(() => {
    if (typeof window !== 'undefined') {
      if (window.innerWidth >= 1600) return 3;
      if (window.innerWidth >= 1200) return 2;
    }
    return 1;
  });

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1600) setVisibleDays(3);
      else if (window.innerWidth >= 1200) setVisibleDays(2);
      else setVisibleDays(1);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return visibleDays;
};

// URL detection regex for notes
const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g;

// Check if entire text is just a URL (with optional whitespace)
const isOnlyUrl = (text) => {
  if (!text) return false;
  const trimmed = text.trim();
  const match = trimmed.match(URL_REGEX);
  return match && match.length === 1 && match[0] === trimmed;
};

// Render formatted text with URLs, **bold**, *italic*, __underline__
const renderFormattedText = (text) => {
  if (!text) return null;

  const elements = [];
  let lastIndex = 0;
  let key = 0;

  // Combined regex for all formatting: **bold**, *italic*, __underline__, URLs
  const formatRegex = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(__(.+?)__)|(https?:\/\/[^\s<>"{}|\\^`[\]]+)/g;
  let match;

  while ((match = formatRegex.exec(text)) !== null) {
    // Add text before match
    if (match.index > lastIndex) {
      elements.push(<span key={key++}>{text.slice(lastIndex, match.index)}</span>);
    }

    if (match[1]) {
      // **bold**
      elements.push(<strong key={key++}>{match[2]}</strong>);
    } else if (match[3]) {
      // *italic*
      elements.push(<em key={key++}>{match[4]}</em>);
    } else if (match[5]) {
      // __underline__
      elements.push(<span key={key++} className="underline">{match[6]}</span>);
    } else if (match[7]) {
      // URL
      elements.push(
        <a
          key={key++}
          href={match[7]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 hover:text-blue-300 underline break-all"
          onClick={(e) => e.stopPropagation()}
        >
          {match[7]}
        </a>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    elements.push(<span key={key++}>{text.slice(lastIndex)}</span>);
  }

  return elements;
};

// Check if task has any notes or subtasks
const hasNotesOrSubtasks = (task) => {
  return (task.notes && task.notes.trim()) || (task.subtasks && task.subtasks.length > 0);
};

// Check if task has only a link (note is URL-only, no subtasks)
const isLinkOnlyTask = (task) => {
  if (task.subtasks && task.subtasks.length > 0) return false;
  return isOnlyUrl(task.notes);
};

// Get the link URL from a link-only task
const getLinkUrl = (task) => {
  return task.notes?.trim() || null;
};

// Check if task has only subtasks (no notes)
const hasOnlySubtasks = (task) => {
  return (!task.notes || !task.notes.trim()) && task.subtasks && task.subtasks.length > 0;
};

// Notes & Subtasks Panel component - defined outside DayPlanner to prevent remount on re-render
const NotesSubtasksPanel = ({
  task,
  isInbox,
  darkMode,
  updateTaskNotes,
  addSubtask,
  toggleSubtask,
  deleteSubtask,
  updateSubtaskTitle,
  compact = true // Use compact mode for inbox, expanded for timeline
}) => {
  const [editingSubtaskId, setEditingSubtaskId] = useState(null);
  const [editingSubtaskText, setEditingSubtaskText] = useState('');
  const [localNotes, setLocalNotes] = useState(task.notes || '');
  const [localSubtaskText, setLocalSubtaskText] = useState('');
  const [isEditingNotes, setIsEditingNotes] = useState(!task.notes); // Edit mode only if no content
  const localNotesRef = useRef(localNotes);
  const taskNotesRef = useRef(task.notes || '');
  const taskIdRef = useRef(task.id);
  const isInboxRef = useRef(isInbox);
  const updateTaskNotesRef = useRef(updateTaskNotes);

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
    setIsEditingNotes(!task.notes); // Edit mode only if no content
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
      className={`mt-2 p-3 rounded-lg ${darkMode ? 'bg-black/30' : 'bg-white/30'} text-white`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Notes section */}
      <div className="mb-3">
        <div className="text-xs font-semibold opacity-75 mb-1">Notes</div>
        {isEditingNotes ? (
          <textarea
            value={localNotes}
            onChange={handleNotesChange}
            onKeyDown={handleNotesKeyDown}
            onBlur={handleNotesBlur}
            placeholder="Add notes... (**bold**, *italic*, __underline__, URLs) - Shift+Enter for preview"
            className={`w-full bg-white/10 text-white text-sm px-2 py-1.5 rounded border border-white/20 outline-none focus:bg-white/20 focus:border-white/40 placeholder:text-white/40 ${compact ? 'resize-none' : 'resize-y'}`}
            rows={compact ? 3 : 8}
            autoFocus
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

      {/* Subtasks section */}
      <div>
        <div className="text-xs font-semibold opacity-75 mb-1">
          Subtasks {task.subtasks?.length > 0 && `(${task.subtasks.filter(st => st.completed).length}/${task.subtasks.length})`}
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
                  </span>
                )}
                <button
                  onClick={() => deleteSubtask(task.id, subtask.id, isInbox)}
                  className="opacity-0 group-hover:opacity-100 hover:bg-white/20 rounded p-0.5 transition-opacity"
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

const DayPlanner = () => {
  const visibleDays = useVisibleDays();
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('darkMode');
    return saved ? JSON.parse(saved) : false;
  });
  const [selectedDate, setSelectedDate] = useState(() => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    return today;
  });
  const [tasks, setTasks] = useState([]);
  const [unscheduledTasks, setUnscheduledTasks] = useState([]);
  const [recycleBin, setRecycleBin] = useState([]);
  const [showAddTask, setShowAddTask] = useState(false);
  const [newTask, setNewTask] = useState({ title: '', startTime: '09:00', duration: 30 });
  const [draggedTask, setDraggedTask] = useState(null);
  const [dragSource, setDragSource] = useState(null);
  const [conflicts, setConflicts] = useState([]);
  const [minimizedSections, setMinimizedSections] = useState(() => {
    const saved = localStorage.getItem('minimizedSections');
    return saved ? JSON.parse(saved) : {
      overdue: false,
      inbox: false,
      dailySummary: false,
      allTimeSummary: false,
      recycleBin: false,
      tags: false
    };
  });
  const [selectedTags, setSelectedTags] = useState(() => {
    const saved = localStorage.getItem('day-planner-selected-tags');
    return saved ? JSON.parse(saved) : [];
  });
  const [pendingPriorities, setPendingPriorities] = useState({});
  const [showSyncSettings, setShowSyncSettings] = useState(false);
  const [syncUrl, setSyncUrl] = useState('');
  const [currentTime, setCurrentTime] = useState(new Date());
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(null);
  const [expandedTaskMenu, setExpandedTaskMenu] = useState(null);
  const [expandedNotesTaskId, setExpandedNotesTaskId] = useState(null);
  const longPressTriggeredRef = useRef(false); // Track if long press just triggered to prevent click
  const longPressTimerRef = useRef(null);
  const hasCheckedInitialWelcome = useRef(false); // Track if we've done the initial welcome check
  const skipOnboardingPersist = useRef(false); // Skip persisting onboarding dismissal (for testing)
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [deadlinePickerTaskId, setDeadlinePickerTaskId] = useState(null); // Task ID for deadline date picker
  const [showNewTaskDeadlinePicker, setShowNewTaskDeadlinePicker] = useState(false); // Deadline dropdown for new inbox task
  const [showMonthView, setShowMonthView] = useState(false);
  const [viewedMonth, setViewedMonth] = useState(() => new Date());
  const [showEmptyBinConfirm, setShowEmptyBinConfirm] = useState(false);
  const [syncNotification, setSyncNotification] = useState(null); // { type: 'success' | 'error' | 'info', message: string }
  const [isSyncing, setIsSyncing] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [editingTaskText, setEditingTaskText] = useState('');
  const [taskCalendarUrl, setTaskCalendarUrl] = useState('');
  const [completedTaskUids, setCompletedTaskUids] = useState(new Set());
  const [pendingImportFile, setPendingImportFile] = useState(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [pendingBackupFile, setPendingBackupFile] = useState(null);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const [showBackupMenu, setShowBackupMenu] = useState(false);
  const [weather, setWeather] = useState(null);
  const [dailyContent, setDailyContent] = useState({
    dadJoke: null,
    funFact: null,
    quote: null,
    history: null
  });
  const [contentRotation, setContentRotation] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('sidebarCollapsed');
    return saved ? JSON.parse(saved) : false;
  });
  const [dragPreviewTime, setDragPreviewTime] = useState(null);
  const [dragPreviewDate, setDragPreviewDate] = useState(null);
  const [dragOverAllDay, setDragOverAllDay] = useState(null);
  const [dragOverInbox, setDragOverInbox] = useState(false);
  const [dragOverRecycleBin, setDragOverRecycleBin] = useState(false);
  const [hoverPreviewTime, setHoverPreviewTime] = useState(null);
  const [hoverPreviewDate, setHoverPreviewDate] = useState(null);
  const [isResizing, setIsResizing] = useState(false);
  const [inboxPriorityFilter, setInboxPriorityFilter] = useState(() => {
    const saved = localStorage.getItem('inboxPriorityFilter');
    return saved ? JSON.parse(saved) : 0;
  }); // 0 = show all, 1-3 = show >= that priority
  const [priorityPromptDismissed, setPriorityPromptDismissed] = useState(() => {
    return localStorage.getItem('priorityPromptDismissed') === 'true';
  });
  // Onboarding state
  const [showWelcome, setShowWelcome] = useState(() => {
    return localStorage.getItem('welcomeDismissed') !== 'true';
  });
  const [sectionInfoDismissed, setSectionInfoDismissed] = useState(() => {
    const saved = localStorage.getItem('sectionInfoDismissed');
    return saved ? JSON.parse(saved) : { inbox: false, tags: false, recycleBin: false };
  });
  const [expandedSectionInfo, setExpandedSectionInfo] = useState(null); // 'inbox' | 'tags' | 'recycleBin' | null
  const [gettingStartedDismissed, setGettingStartedDismissed] = useState(() => {
    return localStorage.getItem('gettingStartedDismissed') === 'true';
  });
  const [onboardingComplete, setOnboardingComplete] = useState(false); // Session-only: user clicked "I'm Good to Go"
  const [onboardingProgress, setOnboardingProgress] = useState(() => {
    const saved = localStorage.getItem('onboardingProgress');
    return saved ? JSON.parse(saved) : {
      hasAddedInboxTask: false,
      hasAddedScheduledTask: false,
      hasDraggedToTimeline: false,
      hasAddedDeadline: false,
      hasSetPriority: false,
      hasAddedNotes: false,
      hasUsedTags: false,
      hasUsedActionButtons: false,
      hasCompletedTask: false,
      hasSetupSync: false,
    };
  });
  const [suggestions, setSuggestions] = useState([]); // Array of { type: 'tag'|'date'|'time', value, display, ... }
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionContext, setSuggestionContext] = useState(null); // 'newTask' | 'editing'
  const [showDeadlinePicker, setShowDeadlinePicker] = useState(null); // task id or null
  const calendarRef = useRef(null);
  const newTaskInputRef = useRef(null);
  const editingInputRef = useRef(null);
  const timeGridRef = useRef(null);
  const currentTimeRef = useRef(null);
  const priorityTimeouts = useRef({});
  const taskElementRefs = useRef({});
  const [taskWidths, setTaskWidths] = useState({});

  // Show all 24 hours (full day) - scrollable
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const firstHour = 0; // Always start at midnight for positioning
  const colors = [
    { name: 'Blue', class: 'bg-blue-500' },
    { name: 'Purple', class: 'bg-purple-500' },
    { name: 'Green', class: 'bg-green-500' },
    { name: 'Orange', class: 'bg-orange-500' },
    { name: 'Pink', class: 'bg-pink-500' },
    { name: 'Indigo', class: 'bg-indigo-500' },
    { name: 'Red', class: 'bg-red-500' },
    { name: 'Teal', class: 'bg-teal-500' },
    { name: 'Yellow', class: 'bg-yellow-500' },
  ];
  const durationOptions = [15, 30, 45, 60, 90, 120];

  // Measure task widths using ResizeObserver
  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      const newWidths = {};
      let hasChanges = false;

      for (const entry of entries) {
        const taskId = entry.target.dataset.taskId;
        if (taskId) {
          const width = entry.contentRect.width;
          if (taskWidths[taskId] !== width) {
            newWidths[taskId] = width;
            hasChanges = true;
          }
        }
      }

      if (hasChanges) {
        setTaskWidths(prev => ({ ...prev, ...newWidths }));
      }
    });

    // Observe all registered task elements
    Object.values(taskElementRefs.current).forEach(el => {
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [tasks, visibleDays]); // Re-setup when tasks or visible days change

  // Ref callback for task elements
  const setTaskRef = (taskId) => (element) => {
    if (element) {
      taskElementRefs.current[taskId] = element;
      // Measure immediately on first attach
      const width = element.offsetWidth;
      if (taskWidths[taskId] !== width) {
        setTaskWidths(prev => ({ ...prev, [taskId]: width }));
      }
    } else {
      delete taskElementRefs.current[taskId];
    }
  };

  const extractTags = (title) => {
    // Only match tags that start with a letter (not pure numbers)
    const matches = title.match(/#([a-zA-Z]\w*)/g);
    return matches ? matches.map(tag => tag.slice(1).toLowerCase()) : [];
  };

  const renderTitle = (title) => {
    // Only style tags that start with a letter (not pure numbers)
    const parts = title.split(/(#[a-zA-Z]\w*)/g);
    return parts.map((part, i) => {
      if (part.match(/^#[a-zA-Z]\w*$/)) {
        return <span key={i} className="text-xs italic opacity-75">{part}</span>;
      }
      return part;
    });
  };

  const renderTitleWithoutTags = (title) => {
    // Remove tags and trim extra whitespace
    return title.replace(/#[a-zA-Z]\w*/g, '').replace(/\s+/g, ' ').trim();
  };

  const TITLE_MAX_LENGTH = 32;

  // Check if title (excluding tags) is within limit
  const isTitleWithinLimit = (title) => {
    return renderTitleWithoutTags(title).length <= TITLE_MAX_LENGTH;
  };

  // Extract partial tag being typed at cursor position
  const getPartialTag = (text, cursorPos) => {
    // Scan backwards from cursor to find #
    let startIndex = cursorPos - 1;
    while (startIndex >= 0) {
      const char = text[startIndex];
      if (char === '#') {
        const partial = text.slice(startIndex + 1, cursorPos);
        // Only match if partial starts with a letter (valid tag format)
        if (partial === '' || /^[a-zA-Z]\w*$/.test(partial)) {
          return { tag: partial.toLowerCase(), startIndex };
        }
        return null;
      }
      // Stop if we hit a space or other non-word character (except # which we're looking for)
      if (!/\w/.test(char)) {
        return null;
      }
      startIndex--;
    }
    return null;
  };

  // Filter tags matching partial (case-insensitive prefix match)
  const getFilteredTags = (partial, allTagsList) => {
    if (!partial && partial !== '') return [];
    const lowerPartial = partial.toLowerCase();
    return allTagsList
      .filter(tag => tag.toLowerCase().startsWith(lowerPartial))
      .sort();
  };

  // Replace partial tag with completed tag
  const applyTagCompletion = (text, cursorPos, selectedTag) => {
    const partialInfo = getPartialTag(text, cursorPos);
    if (!partialInfo) return { text, newCursorPos: cursorPos };

    const before = text.slice(0, partialInfo.startIndex);
    const after = text.slice(cursorPos);
    const completedTag = `#${selectedTag}`;
    const newText = before + completedTag + after;
    const newCursorPos = before.length + completedTag.length;

    return { text: newText, newCursorPos };
  };

  // Extract partial date being typed at cursor position (triggered by @)
  const getPartialDate = (text, cursorPos) => {
    // Scan backwards from cursor to find @
    let startIndex = cursorPos - 1;
    while (startIndex >= 0) {
      const char = text[startIndex];
      if (char === '@') {
        const partial = text.slice(startIndex + 1, cursorPos);
        // Require at least 1 character after @ and allow letters, numbers, spaces, slashes, dashes
        if (partial.length >= 1 && /^[\w\s\/\-,]*$/.test(partial)) {
          return { partial, startIndex };
        }
        return null;
      }
      // Stop if we hit certain characters that wouldn't be part of a date
      if (/[#~!$]/.test(char)) {
        return null;
      }
      startIndex--;
    }
    return null;
  };

  // Extract partial time being typed at cursor position (triggered by ~)
  const getPartialTime = (text, cursorPos) => {
    // Scan backwards from cursor to find ~
    let startIndex = cursorPos - 1;
    while (startIndex >= 0) {
      const char = text[startIndex];
      if (char === '~') {
        const partial = text.slice(startIndex + 1, cursorPos);
        // Require at least 1 character after ~ and allow letters, numbers, colons, spaces
        if (partial.length >= 1 && /^[\w\s:]*$/.test(partial)) {
          return { partial, startIndex };
        }
        return null;
      }
      // Stop if we hit certain characters that wouldn't be part of a time
      if (/[#@!$]/.test(char)) {
        return null;
      }
      startIndex--;
    }
    return null;
  };

  // Extract partial deadline being typed at cursor position (triggered by $)
  const getPartialDeadline = (text, cursorPos) => {
    // Scan backwards from cursor to find $
    let startIndex = cursorPos - 1;
    while (startIndex >= 0) {
      const char = text[startIndex];
      if (char === '$') {
        const partial = text.slice(startIndex + 1, cursorPos);
        // Require at least 1 character after $ and allow letters, numbers, spaces, slashes, dashes
        if (partial.length >= 1 && /^[\w\s\/\-,]*$/.test(partial)) {
          return { partial, startIndex };
        }
        return null;
      }
      // Stop if we hit certain characters that wouldn't be part of a deadline
      if (/[#@~!]/.test(char)) {
        return null;
      }
      startIndex--;
    }
    return null;
  };

  // Extract priority being typed at cursor position (triggered by !, !!, or !!!)
  const getPartialPriority = (text, cursorPos) => {
    // Scan backwards from cursor to count consecutive ! marks
    let endIndex = cursorPos;
    let startIndex = cursorPos - 1;
    let count = 0;

    while (startIndex >= 0 && text[startIndex] === '!') {
      count++;
      startIndex--;
    }

    if (count === 0) return null;

    // Require ! to be preceded by whitespace or start of string
    if (startIndex >= 0 && !/\s/.test(text[startIndex])) {
      return null;
    }

    // Cap at 3
    const priority = Math.min(count, 3);

    return {
      count: priority,
      startIndex: startIndex + 1,
      endIndex
    };
  };

  // Parse flexible date formats and return parsed date info
  const parseFlexibleDate = (partial) => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const currentYear = today.getFullYear();
    const lowerPartial = partial.toLowerCase().trim();

    // Natural language dates
    if (lowerPartial === 'today' || lowerPartial === 'tod') {
      return { date: today, display: 'Today' };
    }
    if (lowerPartial === 'tomorrow' || lowerPartial === 'tom') {
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return { date: tomorrow, display: 'Tomorrow' };
    }
    if (lowerPartial === 'yesterday') {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      return { date: yesterday, display: 'Yesterday' };
    }

    // Day names (next occurrence)
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayAbbrevs = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    let dayIndex = dayNames.findIndex(d => d.startsWith(lowerPartial));
    if (dayIndex === -1) dayIndex = dayAbbrevs.findIndex(d => d === lowerPartial);
    if (dayIndex !== -1) {
      const targetDate = new Date(today);
      const currentDay = today.getDay();
      let daysToAdd = dayIndex - currentDay;
      if (daysToAdd <= 0) daysToAdd += 7; // Next occurrence
      targetDate.setDate(targetDate.getDate() + daysToAdd);
      return { date: targetDate, display: dayNames[dayIndex].charAt(0).toUpperCase() + dayNames[dayIndex].slice(1) };
    }

    // "next week" - same day next week
    if (lowerPartial === 'next week') {
      const nextWeek = new Date(today);
      nextWeek.setDate(nextWeek.getDate() + 7);
      return { date: nextWeek, display: 'Next week' };
    }

    // "next monday", "next tuesday", etc.
    const nextDayMatch = lowerPartial.match(/^next\s+(\w+)$/);
    if (nextDayMatch) {
      const dayName = nextDayMatch[1];
      let idx = dayNames.findIndex(d => d.startsWith(dayName));
      if (idx === -1) idx = dayAbbrevs.findIndex(d => d === dayName);
      if (idx !== -1) {
        const targetDate = new Date(today);
        const currentDay = today.getDay();
        let daysToAdd = idx - currentDay;
        if (daysToAdd <= 0) daysToAdd += 7;
        targetDate.setDate(targetDate.getDate() + daysToAdd);
        return { date: targetDate, display: `Next ${dayNames[idx]}` };
      }
    }

    // Month names
    const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    const monthAbbrevs = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

    // "Feb 15" or "February 15" or "Feb 15 2026" or "February 15, 2026"
    const monthDayMatch = lowerPartial.match(/^(\w+)\s+(\d{1,2})(?:[,\s]+(\d{4}))?$/);
    if (monthDayMatch) {
      const [, monthStr, dayStr, yearStr] = monthDayMatch;
      let monthIdx = monthNames.findIndex(m => m.startsWith(monthStr));
      if (monthIdx === -1) monthIdx = monthAbbrevs.findIndex(m => m === monthStr);
      if (monthIdx !== -1) {
        const day = parseInt(dayStr, 10);
        const year = yearStr ? parseInt(yearStr, 10) : currentYear;
        if (day >= 1 && day <= 31) {
          const targetDate = new Date(year, monthIdx, day, 12, 0, 0);
          if (!isNaN(targetDate.getTime())) {
            return { date: targetDate, display: targetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) };
          }
        }
      }
    }

    // MM-DD-YYYY or MM-DD
    const dashMatch = partial.match(/^(\d{1,2})-(\d{1,2})(?:-(\d{4}))?$/);
    if (dashMatch) {
      const [, monthStr, dayStr, yearStr] = dashMatch;
      const month = parseInt(monthStr, 10);
      const day = parseInt(dayStr, 10);
      const year = yearStr ? parseInt(yearStr, 10) : currentYear;
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        const targetDate = new Date(year, month - 1, day, 12, 0, 0);
        if (!isNaN(targetDate.getTime())) {
          return { date: targetDate, display: targetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) };
        }
      }
    }

    // M/D/YYYY or M/D
    const slashMatch = partial.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
    if (slashMatch) {
      const [, monthStr, dayStr, yearStr] = slashMatch;
      const month = parseInt(monthStr, 10);
      const day = parseInt(dayStr, 10);
      const year = yearStr ? parseInt(yearStr, 10) : currentYear;
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        const targetDate = new Date(year, month - 1, day, 12, 0, 0);
        if (!isNaN(targetDate.getTime())) {
          return { date: targetDate, display: targetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) };
        }
      }
    }

    return null;
  };

  // Parse flexible time formats and return parsed time info
  const parseFlexibleTime = (partial) => {
    const lowerPartial = partial.toLowerCase().trim();

    // Natural language times
    if (lowerPartial === 'noon') {
      return { time: '12:00', display: '12:00 PM (Noon)' };
    }
    if (lowerPartial === 'midnight') {
      return { time: '00:00', display: '12:00 AM (Midnight)' };
    }
    if (lowerPartial === 'morning' || lowerPartial === 'morn') {
      return { time: '09:00', display: '9:00 AM' };
    }
    if (lowerPartial === 'afternoon') {
      return { time: '14:00', display: '2:00 PM' };
    }
    if (lowerPartial === 'evening' || lowerPartial === 'eve') {
      return { time: '18:00', display: '6:00 PM' };
    }
    if (lowerPartial === 'night') {
      return { time: '21:00', display: '9:00 PM' };
    }

    // Military time: HH:MM or H:MM
    const militaryMatch = partial.match(/^(\d{1,2}):(\d{2})$/);
    if (militaryMatch) {
      const hours = parseInt(militaryMatch[1], 10);
      const minutes = militaryMatch[2];
      if (hours >= 0 && hours <= 23) {
        const timeStr = `${hours.toString().padStart(2, '0')}:${minutes}`;
        const displayHour = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
        const ampm = hours >= 12 ? 'PM' : 'AM';
        return { time: timeStr, display: `${displayHour}:${minutes} ${ampm}` };
      }
    }

    // 12-hour format: 2pm, 2:30pm, 2:30 pm, 2 pm
    const twelveHourMatch = lowerPartial.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
    if (twelveHourMatch) {
      let hours = parseInt(twelveHourMatch[1], 10);
      const minutes = twelveHourMatch[2] || '00';
      const ampm = twelveHourMatch[3];

      if (hours >= 1 && hours <= 12 && parseInt(minutes, 10) <= 59) {
        // Convert to 24-hour
        if (ampm === 'pm' && hours !== 12) hours += 12;
        if (ampm === 'am' && hours === 12) hours = 0;

        const timeStr = `${hours.toString().padStart(2, '0')}:${minutes}`;
        const displayHour = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
        const displayAmpm = hours >= 12 ? 'PM' : 'AM';
        return { time: timeStr, display: `${displayHour}:${minutes} ${displayAmpm}` };
      }
    }

    return null;
  };

  // Format time for display (12-hour format)
  const formatTimeDisplay = (timeStr) => {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const displayHour = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
    const ampm = hours >= 12 ? 'PM' : 'AM';
    return `${displayHour}:${minutes.toString().padStart(2, '0')} ${ampm}`;
  };

  // Remove detected date/time from title text
  const removeFromTitle = (text, startIndex, endIndex) => {
    const before = text.slice(0, startIndex);
    const after = text.slice(endIndex);
    // Clean up multiple spaces but preserve single trailing space for chaining
    return (before + after).replace(/\s+/g, ' ').trimStart();
  };

  useEffect(() => {
    loadData();
    fetchWeather();
    fetchAllDailyContent();

    // Rotate content every 15 minutes
    const rotationInterval = setInterval(() => {
      setContentRotation(prev => (prev + 1) % 4);
    }, 15 * 60 * 1000);

    // Refresh weather every hour
    const weatherInterval = setInterval(() => {
      fetchWeather();
    }, 60 * 60 * 1000);

    return () => {
      clearInterval(rotationInterval);
      clearInterval(weatherInterval);
    };
  }, []);

  // Close month view when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (showMonthView && !e.target.closest('.month-view-container') && !e.target.closest('.month-view-toggle')) {
        setShowMonthView(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMonthView]);

  // Close task menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (expandedTaskMenu && !e.target.closest('.task-menu-container')) {
        setExpandedTaskMenu(null);
      }
      if (showColorPicker && !e.target.closest('.color-picker-container')) {
        setShowColorPicker(null);
      }
      if (showDeadlinePicker && !e.target.closest('.deadline-picker-container')) {
        setShowDeadlinePicker(null);
      }
      if (expandedNotesTaskId && !e.target.closest('.notes-panel-container') && !e.target.closest('.notes-toggle-button')) {
        setExpandedNotesTaskId(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [expandedTaskMenu, showColorPicker, showDeadlinePicker, expandedNotesTaskId]);

  // Close notes panel on ESC
  useEffect(() => {
    if (!expandedNotesTaskId) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setExpandedNotesTaskId(null);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [expandedNotesTaskId]);

  // Persist darkMode to localStorage
  useEffect(() => {
    localStorage.setItem('darkMode', JSON.stringify(darkMode));
  }, [darkMode]);

  // Persist minimizedSections to localStorage
  useEffect(() => {
    localStorage.setItem('minimizedSections', JSON.stringify(minimizedSections));
  }, [minimizedSections]);

  // Persist selectedTags to localStorage
  useEffect(() => {
    localStorage.setItem('day-planner-selected-tags', JSON.stringify(selectedTags));
  }, [selectedTags]);

  // Persist sidebarCollapsed to localStorage
  useEffect(() => {
    localStorage.setItem('sidebarCollapsed', JSON.stringify(sidebarCollapsed));
  }, [sidebarCollapsed]);

  // Persist inboxPriorityFilter to localStorage
  useEffect(() => {
    localStorage.setItem('inboxPriorityFilter', JSON.stringify(inboxPriorityFilter));
  }, [inboxPriorityFilter]);

  // Persist priorityPromptDismissed to localStorage
  useEffect(() => {
    localStorage.setItem('priorityPromptDismissed', priorityPromptDismissed.toString());
  }, [priorityPromptDismissed]);

  // Persist onboarding state to localStorage (handled in effect after hasZeroRealTasks is computed)

  useEffect(() => {
    if (!skipOnboardingPersist.current) {
      localStorage.setItem('sectionInfoDismissed', JSON.stringify(sectionInfoDismissed));
    }
  }, [sectionInfoDismissed]);

  useEffect(() => {
    if (gettingStartedDismissed && !skipOnboardingPersist.current) {
      localStorage.setItem('gettingStartedDismissed', 'true');
    }
  }, [gettingStartedDismissed]);

  useEffect(() => {
    localStorage.setItem('onboardingProgress', JSON.stringify(onboardingProgress));
  }, [onboardingProgress]);

  // Track for onboarding when sync is set up
  useEffect(() => {
    if (!onboardingProgress.hasSetupSync && (syncUrl.trim() || taskCalendarUrl.trim())) {
      setOnboardingProgress(prev => ({ ...prev, hasSetupSync: true }));
    }
  }, [syncUrl, taskCalendarUrl, onboardingProgress.hasSetupSync]);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);

    return () => clearInterval(timer);
  }, []);

  // Auto-refresh page at midnight (00:00:01) to reset the timeline to the new day
  useEffect(() => {
    const calculateMsUntilMidnight = () => {
      const now = new Date();
      const midnight = new Date(now);
      midnight.setDate(midnight.getDate() + 1);
      midnight.setHours(0, 0, 1, 0); // 00:00:01
      return midnight.getTime() - now.getTime();
    };

    const scheduleRefresh = () => {
      const msUntilMidnight = calculateMsUntilMidnight();
      return setTimeout(() => {
        window.location.reload();
      }, msUntilMidnight);
    };

    const midnightTimer = scheduleRefresh();

    return () => clearTimeout(midnightTimer);
  }, []);

  // Auto-sync calendars every 15 minutes when URLs are configured
  useEffect(() => {
    if (!syncUrl && !taskCalendarUrl) return;

    const syncTimer = setInterval(() => {
      syncAll({ silent: true });
    }, 15 * 60 * 1000); // 15 minutes

    return () => clearInterval(syncTimer);
  }, [syncUrl, taskCalendarUrl]);

  useEffect(() => {
    const isToday = dateToString(selectedDate) === dateToString(new Date());
    if (isToday && calendarRef.current) {
      setTimeout(() => {
        const currentHour = new Date().getHours();
        // Scroll to show 2 hours before current time (each hour is 161px: 160px height + 1px border)
        const scrollPosition = Math.max(0, (currentHour - 2) * 161);
        calendarRef.current.scrollTop = scrollPosition;
      }, 100);
    }
  }, [selectedDate]);

  useEffect(() => {
    saveData();
    checkConflicts();
  }, [tasks, unscheduledTasks, recycleBin, taskCalendarUrl, completedTaskUids]);

  const loadData = () => {
    try {
      const tasksData = localStorage.getItem('day-planner-tasks');
      const unscheduledData = localStorage.getItem('day-planner-unscheduled');
      const recycleBinData = localStorage.getItem('day-planner-recycle-bin');
      const darkModeData = localStorage.getItem('day-planner-darkmode');
      const syncUrlData = localStorage.getItem('day-planner-sync-url');
      const taskCalendarUrlData = localStorage.getItem('day-planner-task-calendar-url');
      const completedTaskUidsData = localStorage.getItem('day-planner-task-completed-uids');
      const welcomeDismissed = localStorage.getItem('welcomeDismissed') === 'true';

      // Parse existing data
      const parsedTasks = tasksData ? JSON.parse(tasksData).map(t => ({
        ...t,
        notes: t.notes ?? '',
        subtasks: t.subtasks ?? []
      })) : [];

      const parsedUnscheduled = unscheduledData ? JSON.parse(unscheduledData).map(t => ({
        ...t,
        notes: t.notes ?? '',
        subtasks: t.subtasks ?? []
      })) : [];

      // Filter out imported tasks when checking if empty (only count user tasks)
      const userScheduledTasks = parsedTasks.filter(t => !t.imported);
      const userInboxTasks = parsedUnscheduled;

      // Show example tasks if both inbox and scheduled are empty (no saved tasks at all)
      const shouldShowExamples = userScheduledTasks.length === 0 && userInboxTasks.length === 0;

      if (shouldShowExamples) {
        // Create example tasks
        const today = new Date();
        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

        const exampleScheduledTasks = [
          {
            id: 'example-scheduled-1',
            title: 'Example: Morning standup #work',
            startTime: '09:00',
            duration: 30,
            date: todayStr,
            color: 'bg-blue-500',
            completed: false,
            isExample: true,
            notes: '',
            subtasks: []
          },
          {
            id: 'example-scheduled-2',
            title: 'Example: Deep work session #focus',
            startTime: '10:00',
            duration: 120,
            date: todayStr,
            color: 'bg-purple-500',
            completed: false,
            isExample: true,
            notes: 'Tasks can have notes! Try adding a link:\nhttps://example.com',
            subtasks: [
              { id: 'sub-1', title: 'Break down the problem', completed: true },
              { id: 'sub-2', title: 'Write initial code', completed: false },
              { id: 'sub-3', title: 'Test and refine', completed: false }
            ]
          },
          {
            id: 'example-allday-1',
            title: 'Example: Team offsite #work',
            startTime: '00:00',
            duration: 60,
            date: tomorrowStr,
            color: 'bg-green-500',
            completed: false,
            isAllDay: true,
            isExample: true,
            notes: '',
            subtasks: []
          }
        ];

        const exampleInboxTasks = [
          {
            id: 'example-inbox-1',
            title: 'Example: Review quarterly report #work #review',
            color: 'bg-amber-500',
            completed: false,
            priority: 0,
            isExample: true,
            notes: '',
            subtasks: []
          },
          {
            id: 'example-inbox-2',
            title: 'Example: Submit expense report #admin',
            color: 'bg-rose-500',
            completed: false,
            priority: 0,
            deadline: tomorrowStr,
            isExample: true,
            notes: '',
            subtasks: []
          },
          {
            id: 'example-inbox-3',
            title: 'Example: Call mom #personal',
            color: 'bg-cyan-500',
            completed: true,
            priority: 0,
            isExample: true,
            notes: '',
            subtasks: []
          }
        ];

        const exampleRecycleBin = [
          {
            id: 'example-deleted-1',
            title: 'Example: Restore me!',
            color: 'bg-gray-500',
            completed: false,
            deletedAt: new Date().toISOString(),
            _deletedFrom: 'inbox',
            isExample: true,
            notes: '',
            subtasks: []
          }
        ];

        // Keep any imported tasks, add example tasks
        setTasks([...parsedTasks.filter(t => t.imported), ...exampleScheduledTasks]);
        setUnscheduledTasks(exampleInboxTasks);
        setRecycleBin(exampleRecycleBin);
      } else {
        // Load normally
        setTasks(parsedTasks);
        setUnscheduledTasks(parsedUnscheduled);
        if (recycleBinData) {
          setRecycleBin(JSON.parse(recycleBinData));
        }
      }

      if (darkModeData) {
        setDarkMode(JSON.parse(darkModeData));
      }
      if (syncUrlData) {
        setSyncUrl(JSON.parse(syncUrlData));
      }
      if (taskCalendarUrlData) {
        setTaskCalendarUrl(JSON.parse(taskCalendarUrlData));
      }
      if (completedTaskUidsData) {
        setCompletedTaskUids(new Set(JSON.parse(completedTaskUidsData)));
      }
    } catch (error) {
      console.log('No existing data found, starting fresh');
    }
  };

  const saveData = () => {
    try {
      localStorage.setItem('day-planner-tasks', JSON.stringify(tasks));
      localStorage.setItem('day-planner-unscheduled', JSON.stringify(unscheduledTasks));
      localStorage.setItem('day-planner-recycle-bin', JSON.stringify(recycleBin));
      localStorage.setItem('day-planner-darkmode', JSON.stringify(darkMode));
      localStorage.setItem('day-planner-sync-url', JSON.stringify(syncUrl));
      localStorage.setItem('day-planner-task-calendar-url', JSON.stringify(taskCalendarUrl));
      localStorage.setItem('day-planner-task-completed-uids', JSON.stringify([...completedTaskUids]));
    } catch (error) {
      console.error('Error saving data:', error);
    }
  };

  const getNextQuarterHour = () => {
    const now = new Date();
    const minutes = now.getMinutes();
    const nextQuarter = Math.ceil(minutes / 15) * 15;
    
    if (nextQuarter === 60) {
      now.setHours(now.getHours() + 1);
      now.setMinutes(0);
    } else {
      now.setMinutes(nextQuarter);
    }
    
    return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
  };

  const fetchWeather = async () => {
    try {
      // Using Open-Meteo API (free, no API key needed)
      // Erie, CO coordinates: 40.0503, -105.0497
      const response = await fetch('https://api.open-meteo.com/v1/forecast?latitude=40.0503&longitude=-105.0497&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code&temperature_unit=fahrenheit&timezone=America%2FDenver&forecast_days=6');
      const data = await response.json();
      
      if (data.current && data.daily) {
        // Build forecast array for next 5 days (starting from tomorrow)
        const forecast = [];
        for (let i = 1; i <= 5; i++) {
          // Append T12:00:00 to avoid timezone issues (date-only strings are parsed as UTC midnight)
          const date = new Date(data.daily.time[i] + 'T12:00:00');
          forecast.push({
            day: date.toLocaleDateString('en-US', { weekday: 'short' }),
            high: Math.round(data.daily.temperature_2m_max[i]),
            low: Math.round(data.daily.temperature_2m_min[i]),
            icon: getWeatherIcon(data.daily.weather_code[i]),
            code: data.daily.weather_code[i] // For debugging
          });
        }
        
        setWeather({
          temp: Math.round(data.current.temperature_2m),
          condition: getWeatherCondition(data.current.weather_code),
          icon: getWeatherIcon(data.current.weather_code),
          high: Math.round(data.daily.temperature_2m_max[0]),
          low: Math.round(data.daily.temperature_2m_min[0]),
          forecast: forecast
        });
      }
    } catch (error) {
      console.error('Failed to fetch weather:', error);
      // Set a fallback so we know it tried
      setWeather({
        temp: '--',
        condition: 'Unable to load',
        icon: '🌡️',
        high: '--',
        low: '--',
        forecast: []
      });
    }
  };

  const fetchAllDailyContent = async () => {
    const today = new Date().toDateString();
    const cached = localStorage.getItem('dailyContent');

    if (cached) {
      const { content, date } = JSON.parse(cached);
      if (date === today) {
        setDailyContent(content);
        return;
      }
    }

    const content = { dadJoke: null, funFact: null, quote: null, history: null };

    // Fetch dad joke
    try {
      const response = await fetch('https://icanhazdadjoke.com/', {
        headers: { 'Accept': 'application/json' }
      });
      const data = await response.json();
      if (data.joke) content.dadJoke = data.joke;
    } catch (error) {
      console.error('Failed to fetch dad joke:', error);
    }

    // Fetch fun fact
    try {
      const response = await fetch('https://uselessfacts.jsph.pl/api/v2/facts/random?language=en');
      const data = await response.json();
      if (data.text) content.funFact = data.text;
    } catch (error) {
      console.error('Failed to fetch fun fact:', error);
    }

    // Fetch quote
    try {
      const response = await fetch('https://api.quotable.io/random');
      const data = await response.json();
      if (data.content) content.quote = { text: data.content, author: data.author };
    } catch (error) {
      console.error('Failed to fetch quote:', error);
    }

    // Fetch this day in history
    try {
      const now = new Date();
      const response = await fetch(`https://history.muffinlabs.com/date/${now.getMonth() + 1}/${now.getDate()}`);
      const data = await response.json();
      if (data.data?.Events?.length > 0) {
        const randomEvent = data.data.Events[Math.floor(Math.random() * data.data.Events.length)];
        content.history = { year: randomEvent.year, text: randomEvent.text };
      }
    } catch (error) {
      console.error('Failed to fetch history:', error);
    }

    setDailyContent(content);
    localStorage.setItem('dailyContent', JSON.stringify({ content, date: today }));
  };

  const getTaskCalendarStyle = (task, isDarkMode) => {
    if (!task.isTaskCalendar) return {};

    if (task.completed) {
      // Completed: solid muted gray with lower opacity
      return {
        backgroundColor: isDarkMode ? '#4b5563' : '#6b7280',
        opacity: 0.5
      };
    }

    // Active: -45° diagonal stripes
    const color1 = isDarkMode ? '#4b5563' : '#6b7280';
    const color2 = isDarkMode ? '#6b7280' : '#9ca3af';

    return {
      background: `repeating-linear-gradient(
        -45deg,
        ${color1},
        ${color1} 8px,
        ${color2} 8px,
        ${color2} 16px
      )`
    };
  };

  const getWeatherCondition = (code) => {
    if (code === 0) return 'Clear';
    if ([1, 2, 3].includes(code)) return 'Partly Cloudy';
    if ([45, 48].includes(code)) return 'Foggy';
    if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return 'Rainy';
    if ([71, 73, 75, 77, 85, 86].includes(code)) return 'Snowy';
    if ([95, 96, 99].includes(code)) return 'Stormy';
    return 'Cloudy';
  };

  const getWeatherIcon = (code) => {
    // WMO Weather interpretation codes
    if (code === 0) return '☀️'; // Clear sky
    if (code === 1) return '🌤️'; // Mainly clear
    if (code === 2) return '⛅'; // Partly cloudy
    if (code === 3) return '☁️'; // Overcast
    if ([45, 48].includes(code)) return '🌁'; // Fog
    if ([51, 53, 55].includes(code)) return '🌦️'; // Drizzle
    if ([56, 57].includes(code)) return '🌧️'; // Freezing drizzle
    if ([61, 63, 65].includes(code)) return '🌧️'; // Rain
    if ([66, 67].includes(code)) return '🌧️'; // Freezing rain
    if ([71, 73, 75].includes(code)) return '🌨️'; // Snow fall
    if (code === 77) return '🌨️'; // Snow grains
    if ([80, 81, 82].includes(code)) return '🌧️'; // Rain showers
    if ([85, 86].includes(code)) return '🌨️'; // Snow showers
    if (code === 95) return '⛈️'; // Thunderstorm
    if ([96, 99].includes(code)) return '⛈️'; // Thunderstorm with hail
    
    console.warn('Unknown weather code:', code);
    return '☁️'; // Default fallback
  };

  const timeToMinutes = (time) => {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  };

  const minutesToTime = (minutes) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
  };

  const dateToString = (date) => {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const checkConflicts = () => {
    const dateStr = dateToString(selectedDate);
    // Exclude all-day tasks and imported events (not task calendar) from conflict detection
    const todayTasks = tasks.filter(t => t.date === dateStr && !t.isAllDay && (!t.imported || t.isTaskCalendar));
    const newConflicts = [];

    for (let i = 0; i < todayTasks.length; i++) {
      for (let j = i + 1; j < todayTasks.length; j++) {
        const task1 = todayTasks[i];
        const task2 = todayTasks[j];
        const start1 = timeToMinutes(task1.startTime);
        const end1 = start1 + task1.duration;
        const start2 = timeToMinutes(task2.startTime);
        const end2 = start2 + task2.duration;

        if ((start1 < end2 && end1 > start2)) {
          if (!newConflicts.find(c => c.includes(task1.id) && c.includes(task2.id))) {
            newConflicts.push([task1.id, task2.id, Math.min(start1, start2)]);
          }
        }
      }
    }
    setConflicts(newConflicts);
  };

  const getConflictingTasks = (task, allTasks) => {
    const start = timeToMinutes(task.startTime);
    const end = start + task.duration;

    return allTasks.filter(t => {
      if (t.id === task.id) return false;
      const tStart = timeToMinutes(t.startTime);
      const tEnd = tStart + t.duration;
      return start < tEnd && end > tStart;
    });
  };

  // Check if a task placement would conflict with imported calendar events or reminders
  // Returns { conflicted: boolean, adjustedStartTime: string, conflictingEvent: task }
  const getAdjustedTimeForImportedConflicts = (taskId, startTime, duration, dateStr) => {
    // Get all imported calendar events and task calendar reminders for this date
    const importedEvents = tasks.filter(t =>
      t.date === dateStr &&
      t.imported &&
      !t.isAllDay &&
      t.id !== taskId
    );

    if (importedEvents.length === 0) {
      return { conflicted: false, adjustedStartTime: startTime, conflictingEvent: null };
    }

    let currentStart = timeToMinutes(startTime);
    let currentEnd = currentStart + duration;
    let conflictingEvent = null;
    let wasAdjusted = false;

    // Keep adjusting until no conflicts with imported events
    let maxIterations = 100; // Prevent infinite loops
    while (maxIterations > 0) {
      maxIterations--;
      let foundConflict = false;

      for (const event of importedEvents) {
        const eventStart = timeToMinutes(event.startTime);
        const eventEnd = eventStart + event.duration;

        // Check for overlap
        if (currentStart < eventEnd && currentEnd > eventStart) {
          foundConflict = true;
          wasAdjusted = true;
          conflictingEvent = event;
          // Move to end of this event
          currentStart = eventEnd;
          currentEnd = currentStart + duration;
          break;
        }
      }

      if (!foundConflict) break;
    }

    // Cap at end of day
    if (currentStart >= 24 * 60) {
      currentStart = 24 * 60 - duration;
    }

    return {
      conflicted: wasAdjusted,
      adjustedStartTime: minutesToTime(currentStart),
      conflictingEvent
    };
  };

  const toggleSection = (sectionName) => {
    setMinimizedSections(prev => ({
      ...prev,
      [sectionName]: !prev[sectionName]
    }));
  };

  const toggleTag = (tag) => {
    setSelectedTags(prev =>
      prev.includes(tag)
        ? prev.filter(t => t !== tag)
        : [...prev, tag]
    );
  };

  const clearTagFilter = () => {
    setSelectedTags([]);
  };

  const selectAllTags = () => {
    setSelectedTags([...allTags]);
  };

  // Get today's date string for overdue comparisons
  const getTodayStr = () => dateToString(new Date());

  // Get overdue tasks: incomplete scheduled tasks from past dates + inbox tasks with past deadlines
  const getOverdueTasks = () => {
    const todayStr = getTodayStr();

    // Incomplete scheduled tasks from past dates (not imported events)
    const overdueScheduled = tasks.filter(t =>
      t.date < todayStr &&
      !t.completed &&
      !t.imported
    ).map(t => ({ ...t, _overdueType: 'scheduled' }));

    // Inbox tasks with past deadlines
    const overdueDeadlines = unscheduledTasks.filter(t =>
      t.deadline && t.deadline < todayStr
    ).map(t => ({ ...t, _overdueType: 'deadline' }));

    return [...overdueScheduled, ...overdueDeadlines];
  };

  // Get inbox tasks with deadlines for a specific date (not overdue)
  const getDeadlineTasksForDate = (dateStr) => {
    const todayStr = getTodayStr();
    return unscheduledTasks.filter(t =>
      t.deadline === dateStr && t.deadline >= todayStr
    );
  };

  // Set deadline on inbox task
  const setDeadline = (taskId, deadline) => {
    setUnscheduledTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, deadline } : t
    ));
    setShowDeadlinePicker(null);
    // Track for onboarding
    if (!onboardingProgress.hasAddedDeadline) {
      setOnboardingProgress(prev => ({ ...prev, hasAddedDeadline: true }));
    }
  };

  // Clear deadline from inbox task
  const clearDeadline = (taskId) => {
    setUnscheduledTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, deadline: null } : t
    ));
    setShowDeadlinePicker(null);
  };

  // Format deadline date for display
  const formatDeadlineDate = (deadline) => {
    if (!deadline) return null;
    const todayStr = getTodayStr();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = dateToString(tomorrow);

    if (deadline === todayStr) return 'Today';
    if (deadline === tomorrowStr) return 'Tomorrow';

    const date = new Date(deadline + 'T12:00:00');
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const cyclePriority = (taskId) => {
    const task = unscheduledTasks.find(t => t.id === taskId);
    const currentPriority = pendingPriorities[taskId] ?? task?.priority ?? 0;
    const newPriority = (currentPriority + 1) % 4;

    // Update visual immediately
    setPendingPriorities(prev => ({ ...prev, [taskId]: newPriority }));

    // Track for onboarding
    if (!onboardingProgress.hasSetPriority) {
      setOnboardingProgress(prev => ({ ...prev, hasSetPriority: true }));
    }

    // Cancel any pending timeout for this task
    if (priorityTimeouts.current[taskId]) {
      clearTimeout(priorityTimeouts.current[taskId]);
    }

    // Update actual priority (triggers reorder) after delay
    // Longer delay allows for multiple clicks to reach desired priority
    priorityTimeouts.current[taskId] = setTimeout(() => {
      setUnscheduledTasks(prev => prev.map(t =>
        t.id === taskId ? { ...t, priority: newPriority } : t
      ));
      setPendingPriorities(prev => {
        const { [taskId]: _, ...rest } = prev;
        return rest;
      });
      delete priorityTimeouts.current[taskId];
    }, 1200);
  };

  const calculateConflictPosition = (task, allTasks) => {
    // Imported events (not task calendar) are excluded from layout logic - always full width
    if (task.imported && !task.isTaskCalendar) return { left: 2, right: 2, width: null, totalColumns: 1 };

    // Filter out imported events from conflict calculations
    const nonImportedTasks = allTasks.filter(t => !t.imported || t.isTaskCalendar);
    const conflicting = getConflictingTasks(task, nonImportedTasks);
    if (conflicting.length === 0) return { left: 2, right: 2, width: null, totalColumns: 1 };

    // Build the full conflict cluster using transitive closure
    const buildConflictCluster = (startTask) => {
      const cluster = new Set([startTask.id]);
      const queue = [startTask];

      while (queue.length > 0) {
        const current = queue.shift();
        const currentConflicts = getConflictingTasks(current, nonImportedTasks);
        for (const t of currentConflicts) {
          if (!cluster.has(t.id)) {
            cluster.add(t.id);
            queue.push(t);
          }
        }
      }

      return nonImportedTasks.filter(t => cluster.has(t.id));
    };

    const cluster = buildConflictCluster(task);

    // Sort by start time, then by duration (longer first), then by id for stability
    const sorted = [...cluster].sort((a, b) => {
      const aStart = timeToMinutes(a.startTime);
      const bStart = timeToMinutes(b.startTime);
      if (aStart !== bStart) return aStart - bStart;
      if (a.duration !== b.duration) return b.duration - a.duration;
      return a.id - b.id;
    });

    // Greedy column assignment: place each task in the first column where it fits
    const columns = []; // Each column tracks the end time of the last task in it
    const taskColumns = new Map();

    for (const t of sorted) {
      const tStart = timeToMinutes(t.startTime);
      const tEnd = tStart + t.duration;

      // Find first column where this task fits (doesn't overlap)
      let placed = false;
      for (let col = 0; col < columns.length; col++) {
        if (columns[col] <= tStart) {
          columns[col] = tEnd;
          taskColumns.set(t.id, col);
          placed = true;
          break;
        }
      }

      // If no column fits, create a new one
      if (!placed) {
        taskColumns.set(t.id, columns.length);
        columns.push(tEnd);
      }
    }

    const totalColumns = columns.length;
    const column = taskColumns.get(task.id);
    const allCompleted = cluster.every(t => t.completed);

    const widthPercent = 100 / totalColumns;
    const leftPercent = widthPercent * column;

    // Use tighter margins when all completed (no red border to account for)
    const margin = allCompleted ? '0.125rem' : '0.25rem';
    const totalMargin = allCompleted ? '0.25rem' : '0.5rem';

    return {
      left: `calc(${leftPercent}% + ${margin})`,
      right: 'auto',
      width: `calc(${widthPercent}% - ${totalMargin})`,
      totalColumns
    };
  };

  const wouldExceedMaxColumns = (droppedTask, startTime, dropDateStr, maxColumns = 3) => {
    // Get existing tasks for this date, excluding the dropped task if it's already scheduled
    // Also exclude imported events (not task calendar) from conflict calculations
    const existingTasks = tasks.filter(t => t.date === dropDateStr && t.id !== droppedTask.id && !t.isAllDay && (!t.imported || t.isTaskCalendar));

    // Create a hypothetical task with the new position
    const hypotheticalTask = { ...droppedTask, startTime, date: dropDateStr };
    const allTasks = [...existingTasks, hypotheticalTask];

    // Check if this task would conflict with anything
    const conflicting = getConflictingTasks(hypotheticalTask, allTasks);
    if (conflicting.length === 0) return false;

    // Build conflict cluster and calculate columns (same logic as calculateConflictPosition)
    const buildCluster = (startTask) => {
      const cluster = new Set([startTask.id]);
      const queue = [startTask];
      while (queue.length > 0) {
        const current = queue.shift();
        const currentConflicts = getConflictingTasks(current, allTasks);
        for (const t of currentConflicts) {
          if (!cluster.has(t.id)) {
            cluster.add(t.id);
            queue.push(t);
          }
        }
      }
      return allTasks.filter(t => cluster.has(t.id));
    };

    const cluster = buildCluster(hypotheticalTask);
    const sorted = [...cluster].sort((a, b) => {
      const aStart = timeToMinutes(a.startTime);
      const bStart = timeToMinutes(b.startTime);
      if (aStart !== bStart) return aStart - bStart;
      if (a.duration !== b.duration) return b.duration - a.duration;
      return a.id - b.id;
    });

    // Greedy column assignment
    const columns = [];
    for (const t of sorted) {
      const tStart = timeToMinutes(t.startTime);
      const tEnd = tStart + t.duration;
      let placed = false;
      for (let col = 0; col < columns.length; col++) {
        if (columns[col] <= tStart) {
          columns[col] = tEnd;
          placed = true;
          break;
        }
      }
      if (!placed) {
        columns.push(tEnd);
      }
    }

    return columns.length > maxColumns;
  };

  const addTask = (toInbox = false) => {
    if (newTask.title.trim()) {
      const taskId = Date.now();
      const task = {
        id: taskId,
        title: newTask.title,
        duration: newTask.duration,
        color: newTask.color || colors[0].class,
        completed: false,
        isAllDay: newTask.isAllDay || false,
        notes: '',
        subtasks: []
      };

      if (toInbox) {
        const inboxTask = { ...task, priority: newTask.priority ?? 0 };
        if (newTask.deadline) {
          inboxTask.deadline = newTask.deadline;
        }
        setUnscheduledTasks([...unscheduledTasks, inboxTask]);
      } else {
        const requestedStartTime = newTask.isAllDay ? '00:00' : newTask.startTime;
        const taskDate = newTask.date || dateToString(selectedDate);

        // Check for conflicts with imported calendar events (not for all-day tasks)
        const { conflicted, adjustedStartTime, conflictingEvent } = newTask.isAllDay
          ? { conflicted: false, adjustedStartTime: requestedStartTime, conflictingEvent: null }
          : getAdjustedTimeForImportedConflicts(taskId, requestedStartTime, newTask.duration, taskDate);

        setTasks([...tasks, {
          ...task,
          startTime: adjustedStartTime,
          date: taskDate
        }]);

        // Show notification if task was rescheduled to avoid calendar conflict
        if (conflicted && conflictingEvent) {
          setSyncNotification({
            type: 'info',
            title: 'Task Rescheduled',
            message: `Task moved to ${adjustedStartTime} to avoid conflict with "${conflictingEvent.title}"`
          });
        }
      }

      setNewTask({ title: '', startTime: getNextQuarterHour(), duration: 30, date: dateToString(selectedDate), isAllDay: false });
      setShowAddTask(false);

      // Track for onboarding
      if (toInbox && !onboardingProgress.hasAddedInboxTask) {
        setOnboardingProgress(prev => ({ ...prev, hasAddedInboxTask: true }));
      }
      if (!toInbox && !onboardingProgress.hasAddedScheduledTask) {
        setOnboardingProgress(prev => ({ ...prev, hasAddedScheduledTask: true }));
      }
      // Track if task has tags
      if (!onboardingProgress.hasUsedTags && extractTags(newTask.title).length > 0) {
        setOnboardingProgress(prev => ({ ...prev, hasUsedTags: true }));
      }
    }
  };

  const changeTaskColor = (taskId, newColor, fromInbox = false) => {
    if (fromInbox) {
      setUnscheduledTasks(unscheduledTasks.map(task =>
        task.id === taskId ? { ...task, color: newColor } : task
      ));
    } else {
      setTasks(tasks.map(task =>
        task.id === taskId ? { ...task, color: newColor } : task
      ));
    }
    setShowColorPicker(null);
    // Track for onboarding
    if (!onboardingProgress.hasUsedActionButtons) {
      setOnboardingProgress(prev => ({ ...prev, hasUsedActionButtons: true }));
    }
  };

  const toggleComplete = (id, fromInbox = false) => {
    // Track for onboarding - check if we're completing (not uncompleting) a task
    const taskToToggle = fromInbox
      ? unscheduledTasks.find(t => t.id === id)
      : tasks.find(t => t.id === id);
    if (!onboardingProgress.hasCompletedTask && taskToToggle && !taskToToggle.completed) {
      setOnboardingProgress(prev => ({ ...prev, hasCompletedTask: true }));
    }

    if (fromInbox) {
      setUnscheduledTasks(unscheduledTasks.map(task =>
        task.id === id ? { ...task, completed: !task.completed } : task
      ));
    } else {
      // Find the task to check if it's a task calendar item
      const task = tasks.find(t => t.id === id);
      if (task?.isTaskCalendar && task?.icalUid) {
        // Persist completion state for task calendar items
        setCompletedTaskUids(prev => {
          const newSet = new Set(prev);
          if (task.completed) {
            newSet.delete(task.icalUid);
          } else {
            newSet.add(task.icalUid);
          }
          return newSet;
        });
      }
      setTasks(tasks.map(task =>
        task.id === id ? { ...task, completed: !task.completed } : task
      ));
    }
  };

  const postponeTask = (id) => {
    const task = tasks.find(t => t.id === id);
    if (!task || !task.startTime || !task.date) return; // Only postpone scheduled tasks

    // Calculate next day's date based on task's current date
    const nextDay = new Date(task.date + 'T12:00:00');
    nextDay.setDate(nextDay.getDate() + 1);

    // Update the task with the new date (same time)
    setTasks(tasks.map(t =>
      t.id === id ? { ...t, date: nextDay.toISOString().split('T')[0] } : t
    ));

    // Track for onboarding
    if (!onboardingProgress.hasUsedActionButtons) {
      setOnboardingProgress(prev => ({ ...prev, hasUsedActionButtons: true }));
    }
  };

  const moveToInbox = (id) => {
    const task = tasks.find(t => t.id === id);
    if (!task) return;

    // Remove scheduling info and move to inbox
    const unscheduledTask = {
      ...task,
      startTime: null,
      date: null,
      isAllDay: false,
      priority: task.priority || 0
    };

    setTasks(tasks.filter(t => t.id !== id));
    setUnscheduledTasks([...unscheduledTasks, unscheduledTask]);

    // Track for onboarding
    if (!onboardingProgress.hasUsedActionButtons) {
      setOnboardingProgress(prev => ({ ...prev, hasUsedActionButtons: true }));
    }
  };

  const startEditingTask = (task, isInbox = false) => {
    if (task.imported) return; // Don't allow editing imported tasks
    // Reset any existing tag suggestions
    setShowSuggestions(false);
    setSuggestions([]);
    setSelectedSuggestionIndex(0);
    setEditingTaskId(task.id);
    setEditingTaskText(task.title);
  };

  const saveTaskTitle = (isInbox = false) => {
    if (!editingTaskId || !editingTaskText.trim()) {
      cancelEditingTask();
      return;
    }

    if (isInbox) {
      setUnscheduledTasks(unscheduledTasks.map(t =>
        t.id === editingTaskId ? { ...t, title: editingTaskText.trim() } : t
      ));
    } else {
      setTasks(tasks.map(t =>
        t.id === editingTaskId ? { ...t, title: editingTaskText.trim() } : t
      ));
    }

    // Track for onboarding if task has tags
    if (!onboardingProgress.hasUsedTags && extractTags(editingTaskText.trim()).length > 0) {
      setOnboardingProgress(prev => ({ ...prev, hasUsedTags: true }));
    }

    setEditingTaskId(null);
    setEditingTaskText('');
    setShowSuggestions(false);
    setSuggestions([]);
    setSelectedSuggestionIndex(0);
  };

  const cancelEditingTask = () => {
    setEditingTaskId(null);
    setEditingTaskText('');
    setShowSuggestions(false);
    setSuggestions([]);
    setSelectedSuggestionIndex(0);
  };

  // Notes & Subtasks CRUD functions
  const updateTaskNotes = (taskId, notes, isInbox) => {
    if (isInbox) {
      setUnscheduledTasks(prev => prev.map(t =>
        t.id === taskId ? { ...t, notes } : t
      ));
    } else {
      setTasks(prev => prev.map(t =>
        t.id === taskId ? { ...t, notes } : t
      ));
    }
    // Track for onboarding when notes are added (not cleared)
    if (!onboardingProgress.hasAddedNotes && notes && notes.trim()) {
      setOnboardingProgress(prev => ({ ...prev, hasAddedNotes: true }));
    }
  };

  const addSubtask = (taskId, title, isInbox) => {
    if (!title.trim()) return;
    const newSubtask = {
      id: Date.now().toString(),
      title: title.trim(),
      completed: false
    };
    if (isInbox) {
      setUnscheduledTasks(prev => prev.map(t =>
        t.id === taskId ? { ...t, subtasks: [...(t.subtasks || []), newSubtask] } : t
      ));
    } else {
      setTasks(prev => prev.map(t =>
        t.id === taskId ? { ...t, subtasks: [...(t.subtasks || []), newSubtask] } : t
      ));
    }
    // Track for onboarding
    if (!onboardingProgress.hasAddedNotes) {
      setOnboardingProgress(prev => ({ ...prev, hasAddedNotes: true }));
    }
  };

  const toggleSubtask = (taskId, subtaskId, isInbox) => {
    if (isInbox) {
      setUnscheduledTasks(prev => prev.map(t =>
        t.id === taskId ? {
          ...t,
          subtasks: (t.subtasks || []).map(st =>
            st.id === subtaskId ? { ...st, completed: !st.completed } : st
          )
        } : t
      ));
    } else {
      setTasks(prev => prev.map(t =>
        t.id === taskId ? {
          ...t,
          subtasks: (t.subtasks || []).map(st =>
            st.id === subtaskId ? { ...st, completed: !st.completed } : st
          )
        } : t
      ));
    }
  };

  const deleteSubtask = (taskId, subtaskId, isInbox) => {
    if (isInbox) {
      setUnscheduledTasks(prev => prev.map(t =>
        t.id === taskId ? {
          ...t,
          subtasks: (t.subtasks || []).filter(st => st.id !== subtaskId)
        } : t
      ));
    } else {
      setTasks(prev => prev.map(t =>
        t.id === taskId ? {
          ...t,
          subtasks: (t.subtasks || []).filter(st => st.id !== subtaskId)
        } : t
      ));
    }
  };

  const updateSubtaskTitle = (taskId, subtaskId, newTitle, isInbox) => {
    if (isInbox) {
      setUnscheduledTasks(prev => prev.map(t =>
        t.id === taskId ? {
          ...t,
          subtasks: (t.subtasks || []).map(st =>
            st.id === subtaskId ? { ...st, title: newTitle } : st
          )
        } : t
      ));
    } else {
      setTasks(prev => prev.map(t =>
        t.id === taskId ? {
          ...t,
          subtasks: (t.subtasks || []).map(st =>
            st.id === subtaskId ? { ...st, title: newTitle } : st
          )
        } : t
      ));
    }
  };

  const handleEditKeyDown = (e, isInbox = false) => {
    // Handle autocomplete keyboard navigation
    if (showSuggestions && suggestions.length > 0) {
      const selected = suggestions[selectedSuggestionIndex];
      // Tab, Enter, or Space (for date/time/deadline/priority) accepts the suggestion
      if (e.key === 'Tab' || e.key === 'Enter' ||
          (e.key === ' ' && (selected.type === 'date' || selected.type === 'time' || selected.type === 'deadline' || selected.type === 'priority'))) {
        e.preventDefault();
        applySuggestionForEdit(selected, e.target, isInbox);
        return;
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedSuggestionIndex(prev => (prev + 1) % suggestions.length);
        return;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedSuggestionIndex(prev => (prev - 1 + suggestions.length) % suggestions.length);
        return;
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setShowSuggestions(false);
        setSuggestions([]);
        setSelectedSuggestionIndex(0);
        return;
      }
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      saveTaskTitle(isInbox);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEditingTask();
    }
  };

  // Apply a suggestion for editing a task
  const applySuggestionForEdit = (suggestion, inputElement, isInbox) => {
    if (suggestion.type === 'tag') {
      // Complete the tag
      const cursorPos = inputElement?.selectionStart || editingTaskText.length;
      const { text: newText, newCursorPos } = applyTagCompletion(editingTaskText, cursorPos, suggestion.value);
      setEditingTaskText(newText);
      setShowSuggestions(false);
      setSuggestions([]);
      setSelectedSuggestionIndex(0);
      setTimeout(() => {
        if (inputElement) {
          inputElement.selectionStart = newCursorPos;
          inputElement.selectionEnd = newCursorPos;
        }
      }, 0);
    } else if (suggestion.type === 'date' || suggestion.type === 'time') {
      // Remove the date/time from title and update the task
      const newTitle = removeFromTitle(editingTaskText, suggestion.startIndex, suggestion.endIndex);
      setEditingTaskText(newTitle);

      // Update the task's date or time
      if (isInbox) {
        setUnscheduledTasks(unscheduledTasks.map(t => {
          if (t.id === editingTaskId) {
            if (suggestion.type === 'date') {
              return { ...t, title: newTitle, scheduledDate: suggestion.value };
            } else {
              return { ...t, title: newTitle, scheduledTime: suggestion.value };
            }
          }
          return t;
        }));
      } else {
        // For calendar tasks, check for conflicts with imported events when changing time
        if (suggestion.type === 'time') {
          const editingTask = tasks.find(t => t.id === editingTaskId);
          if (editingTask && !editingTask.isAllDay) {
            const { conflicted, adjustedStartTime, conflictingEvent } = getAdjustedTimeForImportedConflicts(
              editingTaskId,
              suggestion.value,
              editingTask.duration,
              editingTask.date
            );

            setTasks(tasks.map(t =>
              t.id === editingTaskId
                ? { ...t, title: newTitle, startTime: adjustedStartTime }
                : t
            ));

            if (conflicted && conflictingEvent) {
              setSyncNotification({
                type: 'info',
                title: 'Task Rescheduled',
                message: `Task moved to ${adjustedStartTime} to avoid conflict with "${conflictingEvent.title}"`
              });
            }
          } else {
            setTasks(tasks.map(t =>
              t.id === editingTaskId
                ? { ...t, title: newTitle, startTime: suggestion.value }
                : t
            ));
          }
        } else {
          setTasks(tasks.map(t =>
            t.id === editingTaskId
              ? { ...t, title: newTitle, date: suggestion.value }
              : t
          ));
        }
      }

      setShowSuggestions(false);
      setSuggestions([]);
      setSelectedSuggestionIndex(0);

      setTimeout(() => {
        if (inputElement) {
          inputElement.focus();
        }
      }, 0);
    } else if (suggestion.type === 'deadline') {
      // Remove the deadline from title and update the inbox task's deadline
      const newTitle = removeFromTitle(editingTaskText, suggestion.startIndex, suggestion.endIndex);
      setEditingTaskText(newTitle);

      // Only inbox tasks can have deadlines
      if (isInbox) {
        setUnscheduledTasks(unscheduledTasks.map(t => {
          if (t.id === editingTaskId) {
            return { ...t, title: newTitle, deadline: suggestion.value };
          }
          return t;
        }));
      }

      setShowSuggestions(false);
      setSuggestions([]);
      setSelectedSuggestionIndex(0);

      setTimeout(() => {
        if (inputElement) {
          inputElement.focus();
        }
      }, 0);
    } else if (suggestion.type === 'priority') {
      // Remove the priority markers from title and update the inbox task's priority
      const newTitle = removeFromTitle(editingTaskText, suggestion.startIndex, suggestion.endIndex);
      setEditingTaskText(newTitle);

      // Only inbox tasks can have priority
      if (isInbox) {
        setUnscheduledTasks(unscheduledTasks.map(t => {
          if (t.id === editingTaskId) {
            return { ...t, title: newTitle, priority: suggestion.value };
          }
          return t;
        }));
      }

      setShowSuggestions(false);
      setSuggestions([]);
      setSelectedSuggestionIndex(0);

      setTimeout(() => {
        if (inputElement) {
          inputElement.focus();
        }
      }, 0);
    }
  };

  // Build suggestions from text (tags, dates, times)
  // isInbox: when true, skip date (@) and time (~) suggestions since inbox tasks don't get scheduled
  const buildSuggestions = (text, cursorPos, isInbox = false) => {
    const allSuggestions = [];

    // Check for partial tag at cursor (triggered by #)
    const tagInfo = getPartialTag(text, cursorPos);
    if (tagInfo) {
      const filtered = getFilteredTags(tagInfo.tag, allTags);
      filtered.forEach(tag => {
        allSuggestions.push({
          type: 'tag',
          value: tag,
          display: tag,
          startIndex: tagInfo.startIndex,
          endIndex: cursorPos
        });
      });
    }

    // Check for partial date at cursor (triggered by @) - skip for inbox tasks
    if (!isInbox) {
      const dateInfo = getPartialDate(text, cursorPos);
      if (dateInfo) {
        const parsed = parseFlexibleDate(dateInfo.partial);
        if (parsed) {
          const dateStr = `${parsed.date.getFullYear()}-${(parsed.date.getMonth() + 1).toString().padStart(2, '0')}-${parsed.date.getDate().toString().padStart(2, '0')}`;
          allSuggestions.push({
            type: 'date',
            value: dateStr,
            display: parsed.display,
            startIndex: dateInfo.startIndex,
            endIndex: cursorPos
          });
        }
      }
    }

    // Check for partial time at cursor (triggered by ~) - skip for inbox tasks
    if (!isInbox) {
      const timeInfo = getPartialTime(text, cursorPos);
      if (timeInfo) {
        const parsed = parseFlexibleTime(timeInfo.partial);
        if (parsed) {
          allSuggestions.push({
            type: 'time',
            value: parsed.time,
            display: parsed.display,
            startIndex: timeInfo.startIndex,
            endIndex: cursorPos
          });
        }
      }
    }

    // Check for partial deadline at cursor (triggered by $) - only for inbox tasks
    if (isInbox) {
      const deadlineInfo = getPartialDeadline(text, cursorPos);
      if (deadlineInfo) {
        const parsed = parseFlexibleDate(deadlineInfo.partial);
        if (parsed) {
          const dateStr = `${parsed.date.getFullYear()}-${(parsed.date.getMonth() + 1).toString().padStart(2, '0')}-${parsed.date.getDate().toString().padStart(2, '0')}`;
          allSuggestions.push({
            type: 'deadline',
            value: dateStr,
            display: `Deadline: ${parsed.display}`,
            startIndex: deadlineInfo.startIndex,
            endIndex: cursorPos
          });
        }
      }
    }

    // Check for priority at cursor (triggered by !, !!, !!!) - only for inbox tasks
    if (isInbox) {
      const priorityInfo = getPartialPriority(text, cursorPos);
      if (priorityInfo) {
        const priorityLabels = ['Low priority (!)', 'Medium priority (!!)', 'High priority (!!!)'];
        allSuggestions.push({
          type: 'priority',
          value: priorityInfo.count,
          display: priorityLabels[priorityInfo.count - 1],
          startIndex: priorityInfo.startIndex,
          endIndex: priorityInfo.endIndex
        });
      }
    }

    return allSuggestions
  };

  // Handle suggestions for editing task input
  const handleEditInputChange = (e, isInbox = false) => {
    const value = e.target.value;
    if (!isTitleWithinLimit(value)) return;

    setEditingTaskText(value);
    editingInputRef.current = e.target;

    const cursorPos = e.target.selectionStart;
    const allSuggestions = buildSuggestions(value, cursorPos, isInbox);

    if (allSuggestions.length > 0) {
      setSuggestions(allSuggestions);
      setSelectedSuggestionIndex(0);
      setShowSuggestions(true);
      setSuggestionContext('editing');
    } else {
      setShowSuggestions(false);
      setSuggestions([]);
    }
  };

  // Handle suggestions for new task input
  const handleNewTaskInputChange = (e) => {
    const value = e.target.value;
    if (!isTitleWithinLimit(value)) return;

    setNewTask({ ...newTask, title: value });

    const cursorPos = e.target.selectionStart;
    const allSuggestions = buildSuggestions(value, cursorPos, newTask.openInInbox);

    if (allSuggestions.length > 0) {
      setSuggestions(allSuggestions);
      setSelectedSuggestionIndex(0);
      setShowSuggestions(true);
      setSuggestionContext('newTask');
    } else {
      setShowSuggestions(false);
      setSuggestions([]);
    }
  };

  // Handle keyboard for new task input with suggestions
  const handleNewTaskInputKeyDown = (e) => {
    if (showSuggestions && suggestions.length > 0) {
      const selected = suggestions[selectedSuggestionIndex];
      // Tab, Enter, or Space (for date/time/deadline/priority) accepts the suggestion
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey) ||
          (e.key === ' ' && (selected.type === 'date' || selected.type === 'time' || selected.type === 'deadline' || selected.type === 'priority'))) {
        e.preventDefault();
        e.stopPropagation();
        applySuggestionForNewTask(selected);
        return;
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedSuggestionIndex(prev => (prev + 1) % suggestions.length);
        return;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedSuggestionIndex(prev => (prev - 1 + suggestions.length) % suggestions.length);
        return;
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setShowSuggestions(false);
        setSuggestions([]);
        setSelectedSuggestionIndex(0);
        return;
      }
    }
  };

  // Apply a suggestion for new task
  const applySuggestionForNewTask = (suggestion) => {
    if (suggestion.type === 'tag') {
      // Complete the tag
      const cursorPos = newTaskInputRef.current?.selectionStart || newTask.title.length;
      const { text: newText, newCursorPos } = applyTagCompletion(newTask.title, cursorPos, suggestion.value);
      setNewTask({ ...newTask, title: newText });
      setShowSuggestions(false);
      setSuggestions([]);
      setSelectedSuggestionIndex(0);
      setTimeout(() => {
        if (newTaskInputRef.current) {
          newTaskInputRef.current.selectionStart = newCursorPos;
          newTaskInputRef.current.selectionEnd = newCursorPos;
        }
      }, 0);
    } else if (suggestion.type === 'date') {
      // Remove the date from title and set task date
      const newTitle = removeFromTitle(newTask.title, suggestion.startIndex, suggestion.endIndex);
      setNewTask({ ...newTask, title: newTitle, date: suggestion.value });
      setShowSuggestions(false);
      setSuggestions([]);
      setSelectedSuggestionIndex(0);
      setTimeout(() => {
        if (newTaskInputRef.current) {
          newTaskInputRef.current.focus();
        }
      }, 0);
    } else if (suggestion.type === 'time') {
      // Remove the time from title and set task start time
      const newTitle = removeFromTitle(newTask.title, suggestion.startIndex, suggestion.endIndex);
      setNewTask({ ...newTask, title: newTitle, startTime: suggestion.value });
      setShowSuggestions(false);
      setSuggestions([]);
      setSelectedSuggestionIndex(0);
      setTimeout(() => {
        if (newTaskInputRef.current) {
          newTaskInputRef.current.focus();
        }
      }, 0);
    } else if (suggestion.type === 'deadline') {
      // Remove the deadline from title and set task deadline
      const newTitle = removeFromTitle(newTask.title, suggestion.startIndex, suggestion.endIndex);
      setNewTask({ ...newTask, title: newTitle, deadline: suggestion.value });
      setShowSuggestions(false);
      setSuggestions([]);
      setSelectedSuggestionIndex(0);
      setTimeout(() => {
        if (newTaskInputRef.current) {
          newTaskInputRef.current.focus();
        }
      }, 0);
    } else if (suggestion.type === 'priority') {
      // Remove the priority markers from title and set task priority
      const newTitle = removeFromTitle(newTask.title, suggestion.startIndex, suggestion.endIndex);
      setNewTask({ ...newTask, title: newTitle, priority: suggestion.value });
      setShowSuggestions(false);
      setSuggestions([]);
      setSelectedSuggestionIndex(0);
      setTimeout(() => {
        if (newTaskInputRef.current) {
          newTaskInputRef.current.focus();
        }
      }, 0);
    }
  };

  // Close tag suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (showSuggestions && !e.target.closest('.tag-autocomplete-container')) {
        setShowSuggestions(false);
        setSuggestions([]);
        setSelectedSuggestionIndex(0);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showSuggestions]);

  // Reset tag suggestions when add task modal closes
  useEffect(() => {
    if (!showAddTask) {
      setShowSuggestions(false);
      setSuggestions([]);
      setSelectedSuggestionIndex(0);
    }
  }, [showAddTask]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      // Don't trigger if typing in an input or textarea
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
        return;
      }

      // 'n' for new scheduled task
      if (e.key === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setNewTask({
          title: '',
          startTime: getNextQuarterHour(),
          duration: 30,
          date: dateToString(selectedDate),
          isAllDay: false,
          openInInbox: false
        });
        setShowAddTask(true);
      }

      // 'i' for new inbox task
      if (e.key === 'i' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setNewTask({
          title: '',
          duration: 30,
          openInInbox: true
        });
        setShowAddTask(true);
      }
    };

    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, [selectedDate]);

  const moveToRecycleBin = (id, fromInbox = false) => {
    const task = fromInbox
      ? unscheduledTasks.find(t => t.id === id)
      : tasks.find(t => t.id === id);

    if (task) {
      // Close notes panel if this task was expanded
      if (expandedNotesTaskId === id) {
        setExpandedNotesTaskId(null);
      }
      // Store original location with the task
      const taskWithMeta = {
        ...task,
        _deletedFrom: fromInbox ? 'inbox' : 'calendar'
      };
      setRecycleBin([...recycleBin, taskWithMeta]);
      if (fromInbox) {
        setUnscheduledTasks(unscheduledTasks.filter(t => t.id !== id));
      } else {
        setTasks(tasks.filter(t => t.id !== id));
      }

      // Track for onboarding
      if (!onboardingProgress.hasUsedActionButtons) {
        setOnboardingProgress(prev => ({ ...prev, hasUsedActionButtons: true }));
      }
    }
  };

  const undeleteTask = (id) => {
    const task = recycleBin.find(t => t.id === id);
    if (task) {
      const { _deletedFrom, ...cleanTask } = task; // Remove metadata
      
      if (_deletedFrom === 'inbox') {
        setUnscheduledTasks([...unscheduledTasks, cleanTask]);
      } else {
        setTasks([...tasks, cleanTask]);
      }
      
      setRecycleBin(recycleBin.filter(t => t.id !== id));
    }
  };

  const emptyRecycleBin = () => {
    setShowEmptyBinConfirm(true);
  };

  const confirmEmptyBin = () => {
    setRecycleBin([]);
    setShowEmptyBinConfirm(false);
  };

  const formatDate = (date) => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}`;
  };

  const formatDateRange = (dates) => {
    if (dates.length === 1) {
      return formatDate(dates[0]);
    }
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const first = dates[0];
    const last = dates[dates.length - 1];

    if (first.getMonth() === last.getMonth() && first.getFullYear() === last.getFullYear()) {
      // Same month: "Jan 31 - Feb 2"
      return `${months[first.getMonth()]} ${first.getDate()} - ${last.getDate()}, ${first.getFullYear()}`;
    } else if (first.getFullYear() === last.getFullYear()) {
      // Different months, same year: "Jan 31 - Feb 2, 2026"
      return `${months[first.getMonth()]} ${first.getDate()} - ${months[last.getMonth()]} ${last.getDate()}, ${first.getFullYear()}`;
    } else {
      // Different years
      return `${months[first.getMonth()]} ${first.getDate()}, ${first.getFullYear()} - ${months[last.getMonth()]} ${last.getDate()}, ${last.getFullYear()}`;
    }
  };

  const formatShortDate = (date) => {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}`;
  };

  const changeDate = (direction) => {
    // Move by the number of visible days (1, 2, or 3) in the given direction
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() + (direction * visibleDays));
    newDate.setHours(12, 0, 0, 0); // Maintain noon to avoid timezone issues
    setSelectedDate(newDate);
  };

  const goToToday = () => {
    const today = new Date();
    today.setHours(12, 0, 0, 0); // Set to noon to avoid timezone issues
    setSelectedDate(today);
  };

  const goToDate = (date) => {
    const newDate = new Date(date);
    newDate.setHours(12, 0, 0, 0);
    setSelectedDate(newDate);
    setShowMonthView(false);
  };

  const changeViewedMonth = (delta) => {
    setViewedMonth(prev => {
      const newMonth = new Date(prev);
      newMonth.setDate(1); // Set to 1st to avoid month rollover issues
      newMonth.setMonth(newMonth.getMonth() + delta);
      return newMonth;
    });
  };

  const getMonthDays = () => {
    const year = viewedMonth.getFullYear();
    const month = viewedMonth.getMonth();
    
    // First day of the month
    const firstDay = new Date(year, month, 1);
    const firstDayOfWeek = firstDay.getDay(); // 0 = Sunday
    
    // Last day of the month
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    
    // Generate array of days
    const days = [];
    
    // Add empty slots for days before month starts
    for (let i = 0; i < firstDayOfWeek; i++) {
      days.push(null);
    }
    
    // Add all days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      days.push(new Date(year, month, day));
    }
    
    return days;
  };

  const hasTasksOnDate = (date) => {
    if (!date) return false;
    const dateStr = date.toISOString().split('T')[0];
    return tasks.some(task => task.date === dateStr);
  };

  const openNewTaskForm = () => {
    setNewTask({ 
      title: '', 
      startTime: getNextQuarterHour(), 
      duration: 30,
      date: dateToString(selectedDate),
      isAllDay: false
    });
    setShowAddTask(true);
  };

  const openNewInboxTask = () => {
    setNewTask({
      title: '',
      startTime: getNextQuarterHour(),
      duration: 30,
      date: dateToString(selectedDate),
      isAllDay: false,
      openInInbox: true,
      deadline: null,
      priority: 0
    });
    setShowAddTask(true);
  };

  // Helper function to convert cursor Y position to time
  const getTimeFromCursorPosition = (e, options = {}) => {
    const { roundTo = 15, maxMinutes = 23 * 60 + 45, taskDuration = 0 } = options;
    const rect = calendarRef.current.getBoundingClientRect();
    const scrollTop = calendarRef.current.scrollTop;
    // Get header height (distance from container top to time grid top in content space)
    const headerHeight = timeGridRef.current ? timeGridRef.current.offsetTop : 0;
    // Calculate y position relative to the time grid content
    const y = Math.max(0, e.clientY - rect.top + scrollTop - headerHeight);

    // Each hour is 161px (160px content + 1px border)
    const hourFromTop = Math.floor(y / 161);
    const pixelsIntoHour = y - (hourFromTop * 161);
    const minutesIntoHour = (Math.min(pixelsIntoHour, 160) / 160) * 60;
    const totalMinutesFromTop = hourFromTop * 60 + minutesIntoHour;

    // Round to nearest interval
    const totalMinutesRounded = Math.round(totalMinutesFromTop / roundTo) * roundTo;
    const hours = Math.floor(totalMinutesRounded / 60) + firstHour;
    const minutes = totalMinutesRounded % 60;

    const totalMinutes = Math.max(0, Math.min(maxMinutes - taskDuration, hours * 60 + minutes));
    return minutesToTime(totalMinutes);
  };

  const openNewTaskAtTime = (e, targetDate = null) => {
    // Only trigger if clicking on the empty calendar area, not on tasks
    if (e.target.classList.contains('calendar-slot')) {
      const clickedTime = getTimeFromCursorPosition(e);

      setNewTask({
        title: '',
        startTime: clickedTime,
        duration: 30,
        date: dateToString(targetDate || selectedDate),
        isAllDay: false
      });
      setShowAddTask(true);
    }
  };

  const handleCalendarMouseMove = (e, targetDate) => {
    if (draggedTask) return; // Don't show hover preview while dragging
    if (!e.target.classList.contains('calendar-slot')) {
      setHoverPreviewTime(null);
      setHoverPreviewDate(null);
      return;
    }
    const time = getTimeFromCursorPosition(e);
    setHoverPreviewTime(time);
    setHoverPreviewDate(targetDate);
  };

  const handleCalendarMouseLeave = () => {
    setHoverPreviewTime(null);
    setHoverPreviewDate(null);
  };

  // Convert minutes from midnight to pixel position (accounting for 1px borders between hours)
  const minutesToPosition = (minutes) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return hours * 161 + mins * 160 / 60; // 160px per hour + 1px border
  };

  const calculateTaskPosition = (task) => {
    const startMinutes = timeToMinutes(task.startTime);
    const endMinutes = startMinutes + task.duration;
    const top = Math.round(minutesToPosition(startMinutes));
    const endPos = Math.round(minutesToPosition(endMinutes));
    const height = endPos - top - 1; // -1 for consistent tiny gap between tasks
    return { top, height };
  };

  const handleDragStart = (task, source, e) => {
    setDraggedTask(task);
    setDragSource(source);
    setDragPreviewTime(null);
    setExpandedNotesTaskId(null); // Close notes panel when dragging
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    setDraggedTask(null);
    setDragSource(null);
    setDragPreviewTime(null);
    setDragPreviewDate(null);
    setDragOverAllDay(null);
    setDragOverInbox(false);
    setDragOverRecycleBin(false);
  };

  const handleDragOver = (e, targetDate = null) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    // Clear other drop indicators when back in timeline
    setDragOverAllDay(null);
    setDragOverInbox(false);
    setDragOverRecycleBin(false);

    // Show preview time while dragging
    if (draggedTask && calendarRef.current) {
      const time = getTimeFromCursorPosition(e, {
        maxMinutes: 24 * 60,
        taskDuration: draggedTask.duration
      });
      setDragPreviewTime(time);

      // Track which date column we're dragging over
      if (targetDate) {
        setDragPreviewDate(targetDate);
      }
    }
  };

  const handleDragOverInbox = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    // Clear timeline preview when over inbox
    setDragPreviewTime(null);
    setDragOverAllDay(null);
    setDragOverRecycleBin(false);
    setDragOverInbox(true);
  };

  const handleDragOverRecycleBin = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    // Clear timeline preview when over recycle bin
    setDragPreviewTime(null);
    setDragOverAllDay(null);
    setDragOverInbox(false);
    setDragOverRecycleBin(true);
  };

  const handleDropOnCalendar = (e, targetDate = null) => {
    e.preventDefault();
    if (!draggedTask) return;

    const requestedStartTime = getTimeFromCursorPosition(e, {
      maxMinutes: 24 * 60,
      taskDuration: draggedTask.duration
    });

    // Use the target date from the column, falling back to dragPreviewDate or selectedDate
    const dropDate = targetDate || dragPreviewDate || selectedDate;
    const dropDateStr = dateToString(dropDate);

    // Check for conflicts with imported calendar events and adjust if needed
    const { conflicted, adjustedStartTime, conflictingEvent } = getAdjustedTimeForImportedConflicts(
      draggedTask.id,
      requestedStartTime,
      draggedTask.duration,
      dropDateStr
    );

    const startTime = adjustedStartTime;

    // Prevent drops that would create 4+ side-by-side tasks
    if (wouldExceedMaxColumns(draggedTask, startTime, dropDateStr)) {
      setDraggedTask(null);
      setDragSource(null);
      setDragPreviewTime(null);
      setDragPreviewDate(null);
      return;
    }

    if (dragSource === 'inbox') {
      setUnscheduledTasks(unscheduledTasks.filter(t => t.id !== draggedTask.id));
      const { priority, deadline, ...taskWithoutPriorityAndDeadline } = draggedTask;
      setTasks([...tasks, {
        ...taskWithoutPriorityAndDeadline,
        startTime,
        date: dropDateStr,
        isAllDay: false
      }]);
      // Track for onboarding
      if (!onboardingProgress.hasDraggedToTimeline) {
        setOnboardingProgress(prev => ({ ...prev, hasDraggedToTimeline: true }));
      }
    } else if (dragSource === 'calendar') {
      setTasks(tasks.map(t =>
        t.id === draggedTask.id
          ? { ...t, startTime, date: dropDateStr, isAllDay: false }
          : t
      ));
    } else if (dragSource === 'recycleBin') {
      // Remove metadata and add to calendar
      const { _deletedFrom, ...cleanTask } = draggedTask;
      setRecycleBin(recycleBin.filter(t => t.id !== draggedTask.id));
      setTasks([...tasks, {
        ...cleanTask,
        startTime,
        date: dropDateStr,
        isAllDay: false
      }]);
    } else if (dragSource === 'overdue') {
      // Handle overdue tasks - they can be scheduled or deadline tasks
      if (draggedTask._overdueType === 'scheduled') {
        // Reschedule an existing scheduled task
        setTasks(tasks.map(t =>
          t.id === draggedTask.id
            ? { ...t, startTime, date: dropDateStr, isAllDay: false }
            : t
        ));
      } else if (draggedTask._overdueType === 'deadline') {
        // Schedule an overdue inbox task - remove from inbox, add to calendar
        setUnscheduledTasks(unscheduledTasks.filter(t => t.id !== draggedTask.id));
        const { priority, deadline, _overdueType, ...taskWithoutMeta } = draggedTask;
        setTasks([...tasks, {
          ...taskWithoutMeta,
          startTime,
          date: dropDateStr,
          isAllDay: false
        }]);
      }
    }

    // Show notification if task was rescheduled to avoid calendar conflict
    if (conflicted && conflictingEvent) {
      setSyncNotification({
        type: 'info',
        title: 'Task Rescheduled',
        message: `Task moved to ${startTime} to avoid conflict with "${conflictingEvent.title}"`
      });
    }

    setDraggedTask(null);
    setDragSource(null);
    setDragPreviewTime(null);
    setDragPreviewDate(null);
  };

  const handleDropOnInbox = (e) => {
    e.preventDefault();
    if (!draggedTask) return;

    // Only allow calendar, recycle bin, overdue scheduled tasks, and inbox tasks with deadlines to be moved to inbox
    if (dragSource !== 'calendar' && dragSource !== 'recycleBin' && dragSource !== 'overdue' && !(dragSource === 'inbox' && draggedTask.deadline)) return;

    if (dragSource === 'calendar') {
      setTasks(tasks.filter(t => t.id !== draggedTask.id));
      const { startTime, date, ...taskWithoutSchedule } = draggedTask;
      setUnscheduledTasks([...unscheduledTasks, { ...taskWithoutSchedule, priority: taskWithoutSchedule.priority || 0 }]);
    } else if (dragSource === 'recycleBin') {
      setRecycleBin(recycleBin.filter(t => t.id !== draggedTask.id));
      const { _deletedFrom, startTime, date, ...taskWithoutSchedule } = draggedTask;
      setUnscheduledTasks([...unscheduledTasks, { ...taskWithoutSchedule, priority: taskWithoutSchedule.priority || 0 }]);
    } else if (dragSource === 'overdue' && draggedTask._overdueType === 'scheduled') {
      // Move overdue scheduled task back to inbox
      setTasks(tasks.filter(t => t.id !== draggedTask.id));
      const { startTime, date, _overdueType, ...taskWithoutSchedule } = draggedTask;
      setUnscheduledTasks([...unscheduledTasks, { ...taskWithoutSchedule, priority: taskWithoutSchedule.priority || 0 }]);
    } else if (dragSource === 'overdue' && draggedTask._overdueType === 'deadline') {
      // Clear deadline from overdue inbox task to move it back to regular inbox view
      clearDeadline(draggedTask.id);
    } else if (dragSource === 'inbox' && draggedTask.deadline) {
      // Clear deadline from inbox task (moving from all-day section back to inbox)
      clearDeadline(draggedTask.id);
    }

    setDraggedTask(null);
    setDragSource(null);
    setDragPreviewTime(null);
    setDragOverInbox(false);
  };

  const handleDropOnRecycleBin = (e) => {
    e.preventDefault();
    if (!draggedTask) return;

    // Determine source and clean up task metadata
    let deletedFrom = 'calendar';
    let cleanTask = { ...draggedTask };

    if (dragSource === 'inbox') {
      deletedFrom = 'inbox';
    } else if (dragSource === 'overdue') {
      if (draggedTask._overdueType === 'scheduled') {
        deletedFrom = 'calendar';
      } else {
        deletedFrom = 'inbox';
      }
      // Remove overdue metadata
      const { _overdueType, ...rest } = cleanTask;
      cleanTask = rest;
    }

    // Add to recycle bin with metadata about where it came from
    const taskWithMeta = {
      ...cleanTask,
      _deletedFrom: deletedFrom
    };
    setRecycleBin([...recycleBin, taskWithMeta]);

    // Remove from original location
    if (dragSource === 'inbox') {
      setUnscheduledTasks(unscheduledTasks.filter(t => t.id !== draggedTask.id));
    } else if (dragSource === 'calendar') {
      setTasks(tasks.filter(t => t.id !== draggedTask.id));
    } else if (dragSource === 'overdue') {
      if (draggedTask._overdueType === 'scheduled') {
        setTasks(tasks.filter(t => t.id !== draggedTask.id));
      } else {
        setUnscheduledTasks(unscheduledTasks.filter(t => t.id !== draggedTask.id));
      }
    }

    setDraggedTask(null);
    setDragSource(null);
    setDragPreviewTime(null);
    setDragOverRecycleBin(false);
  };

  const handleDropOnDateHeader = (e, targetDate) => {
    e.preventDefault();
    if (!draggedTask) return;

    const dropDateStr = dateToString(targetDate);

    if (dragSource === 'inbox') {
      setUnscheduledTasks(unscheduledTasks.filter(t => t.id !== draggedTask.id));
      const { priority, deadline, ...taskWithoutPriorityAndDeadline } = draggedTask;
      setTasks([...tasks, {
        ...taskWithoutPriorityAndDeadline,
        startTime: '00:00',
        date: dropDateStr,
        isAllDay: true
      }]);
    } else if (dragSource === 'calendar') {
      setTasks(tasks.map(t =>
        t.id === draggedTask.id
          ? { ...t, startTime: '00:00', date: dropDateStr, isAllDay: true }
          : t
      ));
    } else if (dragSource === 'recycleBin') {
      const { _deletedFrom, ...cleanTask } = draggedTask;
      setRecycleBin(recycleBin.filter(t => t.id !== draggedTask.id));
      setTasks([...tasks, {
        ...cleanTask,
        startTime: '00:00',
        date: dropDateStr,
        isAllDay: true
      }]);
    } else if (dragSource === 'overdue') {
      // Handle overdue tasks - they can be scheduled or deadline tasks
      if (draggedTask._overdueType === 'scheduled') {
        // Reschedule an existing scheduled task to a new all-day slot
        setTasks(tasks.map(t =>
          t.id === draggedTask.id
            ? { ...t, startTime: '00:00', date: dropDateStr, isAllDay: true }
            : t
        ));
      } else if (draggedTask._overdueType === 'deadline') {
        // Schedule an overdue inbox task - remove from inbox, add to calendar
        setUnscheduledTasks(unscheduledTasks.filter(t => t.id !== draggedTask.id));
        const { priority, deadline, _overdueType, ...taskWithoutMeta } = draggedTask;
        setTasks([...tasks, {
          ...taskWithoutMeta,
          startTime: '00:00',
          date: dropDateStr,
          isAllDay: true
        }]);
      }
    }

    setDraggedTask(null);
    setDragSource(null);
    setDragPreviewTime(null);
    setDragPreviewDate(null);
    setDragOverAllDay(null);
  };

  const handleResizeStart = (task, e) => {
    e.stopPropagation();
    e.preventDefault();
    setIsResizing(true);

    const startY = e.clientY;
    const startDuration = task.duration;

    const handleMouseMove = (moveEvent) => {
      const deltaY = moveEvent.clientY - startY;
      const deltaMinutes = Math.round((deltaY / 80) * 60 / 15) * 15;
      const newDuration = Math.max(15, startDuration + deltaMinutes);

      setTasks(prevTasks => prevTasks.map(t =>
        t.id === task.id ? { ...t, duration: newDuration } : t
      ));
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const parseICS = (icsContent) => {
    const lines = icsContent.split('\n').map(line => line.trim());
    const events = [];
    let currentEvent = null;
    let currentType = null; // 'event' or 'todo'

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line === 'BEGIN:VEVENT') {
        currentEvent = {};
        currentType = 'event';
      } else if (line === 'BEGIN:VTODO') {
        currentEvent = {};
        currentType = 'todo';
      } else if ((line === 'END:VEVENT' || line === 'END:VTODO') && currentEvent) {
        // For VTODOs, use DUE as dtstart if no DTSTART present
        if (currentType === 'todo' && !currentEvent.dtstart && currentEvent.due) {
          currentEvent.dtstart = currentEvent.due;
          currentEvent.isAllDay = currentEvent.dueIsAllDay;
        }
        if (currentEvent.summary && currentEvent.dtstart) {
          events.push(currentEvent);
        }
        currentEvent = null;
        currentType = null;
      } else if (currentEvent) {
        if (line.startsWith('SUMMARY:')) {
          // Unescape ICS escape sequences: \, -> , and \; -> ; and \\ -> \ and \n -> newline
          currentEvent.summary = line.substring(8)
            .replace(/\\,/g, ',')
            .replace(/\\;/g, ';')
            .replace(/\\n/gi, '\n')
            .replace(/\\\\/g, '\\');
        } else if (line.startsWith('DTSTART')) {
          // Detect all-day events (VALUE=DATE or 8-character date)
          if (line.includes('VALUE=DATE') || line.split(':')[1]?.length === 8) {
            currentEvent.isAllDay = true;
          }
          const dateStr = line.split(':')[1];
          currentEvent.dtstart = dateStr;
        } else if (line.startsWith('DTEND')) {
          const dateStr = line.split(':')[1];
          currentEvent.dtend = dateStr;
        } else if (line.startsWith('DUE')) {
          // Handle VTODO due dates
          if (line.includes('VALUE=DATE') || line.split(':')[1]?.length === 8) {
            currentEvent.dueIsAllDay = true;
          }
          const dateStr = line.split(':')[1];
          currentEvent.due = dateStr;
        } else if (line.startsWith('UID:')) {
          currentEvent.uid = line.substring(4);
        }
      }
    }

    return events;
  };

  const parseDatetime = (dtstr) => {
    if (dtstr.length === 8) {
      return new Date(
        parseInt(dtstr.substr(0, 4)),
        parseInt(dtstr.substr(4, 2)) - 1,
        parseInt(dtstr.substr(6, 2))
      );
    } else if (dtstr.length >= 15) {
      return new Date(
        parseInt(dtstr.substr(0, 4)),
        parseInt(dtstr.substr(4, 2)) - 1,
        parseInt(dtstr.substr(6, 2)),
        parseInt(dtstr.substr(9, 2)),
        parseInt(dtstr.substr(11, 2))
      );
    }
    return new Date();
  };

  // Helper to expand multi-day events into separate tasks for each day
  const expandMultiDayEvent = (event, options = {}) => {
    const { asTaskCalendar = false, freshCompletedUids = new Set() } = options;
    const startDate = parseDatetime(event.dtstart);
    const endDate = event.dtend ? parseDatetime(event.dtend) : new Date(startDate.getTime() + 60 * 60 * 1000);
    const duration = Math.round((endDate - startDate) / (1000 * 60));

    const isAllDay = event.isAllDay ||
      (startDate.getHours() === 0 && startDate.getMinutes() === 0 && duration >= 1440);

    // Calculate number of days this event spans
    const startDateOnly = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    const endDateOnly = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
    // For all-day events, DTEND is exclusive (event on Jan 1-3 has DTEND of Jan 4)
    const dayCount = isAllDay
      ? Math.max(1, Math.round((endDateOnly - startDateOnly) / (1000 * 60 * 60 * 24)))
      : 1;

    const tasks = [];
    for (let i = 0; i < dayCount; i++) {
      const taskDate = new Date(startDateOnly);
      taskDate.setDate(taskDate.getDate() + i);

      const baseId = event.uid || `imported-${Date.now()}-${Math.random()}`;
      const taskId = dayCount > 1 ? `${baseId}-day${i + 1}` : baseId;

      // Add day indicator for multi-day events
      const titleSuffix = dayCount > 1 ? ` (Day ${i + 1}/${dayCount})` : '';

      tasks.push({
        id: taskId,
        icalUid: event.uid,
        title: event.summary + titleSuffix,
        startTime: `${startDate.getHours().toString().padStart(2, '0')}:${startDate.getMinutes().toString().padStart(2, '0')}`,
        duration: isAllDay ? 60 : (duration > 0 ? duration : (asTaskCalendar ? 15 : 60)),
        date: dateToString(taskDate),
        color: asTaskCalendar ? 'task-calendar' : 'bg-gray-600',
        completed: asTaskCalendar ? freshCompletedUids.has(event.uid) : false,
        imported: true,
        isTaskCalendar: asTaskCalendar,
        isAllDay: isAllDay
      });
    }

    return tasks;
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setPendingImportFile(file);
    setShowImportModal(true);
    e.target.value = '';
  };

  const processImportFile = (asTaskCalendar) => {
    if (!pendingImportFile) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const icsContent = event.target.result;
      const events = parseICS(icsContent);

      // Read fresh completedTaskUids from localStorage to avoid stale closure
      const freshCompletedUids = new Set(
        JSON.parse(localStorage.getItem('day-planner-task-completed-uids') || '[]')
      );

      const importedTasks = events.flatMap(event =>
        expandMultiDayEvent(event, { asTaskCalendar, freshCompletedUids })
      );

      if (asTaskCalendar) {
        const nonTaskCalendarTasks = tasks.filter(t => !t.isTaskCalendar);
        setTasks([...nonTaskCalendarTasks, ...importedTasks]);
      } else {
        const nonImportedTasks = tasks.filter(t => !t.imported || t.isTaskCalendar);
        setTasks([...nonImportedTasks, ...importedTasks]);
      }

      setPendingImportFile(null);
      setShowImportModal(false);
    };
    reader.readAsText(pendingImportFile);
  };

  // Export all app data as a JSON backup file
  const exportBackup = () => {
    const backup = {
      version: 1,
      exportedAt: new Date().toISOString(),
      data: {
        tasks: JSON.parse(localStorage.getItem('day-planner-tasks') || '[]'),
        unscheduledTasks: JSON.parse(localStorage.getItem('day-planner-unscheduled') || '[]'),
        recycleBin: JSON.parse(localStorage.getItem('day-planner-recycle-bin') || '[]'),
        darkMode: JSON.parse(localStorage.getItem('day-planner-darkmode') || 'false'),
        syncUrl: JSON.parse(localStorage.getItem('day-planner-sync-url') || 'null'),
        taskCalendarUrl: JSON.parse(localStorage.getItem('day-planner-task-calendar-url') || 'null'),
        completedTaskUids: JSON.parse(localStorage.getItem('day-planner-task-completed-uids') || '[]'),
        selectedTags: JSON.parse(localStorage.getItem('day-planner-selected-tags') || '[]'),
        minimizedSections: JSON.parse(localStorage.getItem('minimizedSections') || '{}')
      }
    };

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `day-planner-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Handle backup file selection
  const handleBackupFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setPendingBackupFile(file);
    setShowBackupMenu(false);
    setShowRestoreConfirm(true);
    e.target.value = '';
  };

  // Restore data from backup file
  const restoreBackup = () => {
    if (!pendingBackupFile) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const backup = JSON.parse(e.target.result);

        // Validate structure
        if (!backup.data || !backup.version) {
          throw new Error('Invalid backup file format');
        }

        // Restore all data
        const { data } = backup;
        if (data.tasks) localStorage.setItem('day-planner-tasks', JSON.stringify(data.tasks));
        if (data.unscheduledTasks) localStorage.setItem('day-planner-unscheduled', JSON.stringify(data.unscheduledTasks));
        if (data.recycleBin) localStorage.setItem('day-planner-recycle-bin', JSON.stringify(data.recycleBin));
        if (data.darkMode !== undefined) localStorage.setItem('day-planner-darkmode', JSON.stringify(data.darkMode));
        if (data.syncUrl !== undefined) localStorage.setItem('day-planner-sync-url', JSON.stringify(data.syncUrl));
        if (data.taskCalendarUrl !== undefined) localStorage.setItem('day-planner-task-calendar-url', JSON.stringify(data.taskCalendarUrl));
        if (data.completedTaskUids) localStorage.setItem('day-planner-task-completed-uids', JSON.stringify(data.completedTaskUids));
        if (data.selectedTags) localStorage.setItem('day-planner-selected-tags', JSON.stringify(data.selectedTags));
        if (data.minimizedSections) localStorage.setItem('minimizedSections', JSON.stringify(data.minimizedSections));

        // Reload app to reflect changes
        window.location.reload();
      } catch (err) {
        alert('Failed to restore backup: ' + err.message);
        setPendingBackupFile(null);
        setShowRestoreConfirm(false);
      }
    };
    reader.readAsText(pendingBackupFile);
  };

  // Returns { success: boolean, count?: number, error?: string }
  const syncWithCalendar = async () => {
    if (!syncUrl) {
      return { success: false, error: 'no-url' };
    }

    try {
      // Use proxy to bypass CORS restrictions
      // Note: URL is not encoded because nginx's $arg_url doesn't auto-decode
      const proxyUrl = `/api/calendar-proxy/?url=${syncUrl}`;
      const response = await fetch(proxyUrl);
      if (!response.ok) throw new Error('Failed to fetch calendar');

      const icsContent = await response.text();
      const events = parseICS(icsContent);

      const importedTasks = events.flatMap(event =>
        expandMultiDayEvent(event, { asTaskCalendar: false })
      );

      // Remove old regular imported events (not task calendar) and add the fresh ones
      // Use functional form to avoid stale closure when both syncs run in parallel
      setTasks(prevTasks => {
        const nonImportedTasks = prevTasks.filter(t => !t.imported || t.isTaskCalendar);
        return [...nonImportedTasks, ...importedTasks];
      });
      return { success: true, count: importedTasks.length };
    } catch (error) {
      console.error('Sync error:', error);
      return { success: false, error: 'calendar' };
    }
  };

  // Returns { success: boolean, count?: number, error?: string }
  const syncTaskCalendar = async () => {
    if (!taskCalendarUrl) {
      return { success: false, error: 'no-url' };
    }

    try {
      const proxyUrl = `/api/calendar-proxy/?url=${taskCalendarUrl}`;
      const response = await fetch(proxyUrl);
      if (!response.ok) throw new Error('Failed to fetch task calendar');

      const icsContent = await response.text();
      const events = parseICS(icsContent);

      // Read fresh completedTaskUids from localStorage to avoid stale closure
      const freshCompletedUids = new Set(
        JSON.parse(localStorage.getItem('day-planner-task-completed-uids') || '[]')
      );

      const taskCalendarItems = events.flatMap(event =>
        expandMultiDayEvent(event, { asTaskCalendar: true, freshCompletedUids })
      );

      // Remove old task calendar items and add the fresh ones (preserve regular imports + user tasks)
      // Use functional form to avoid stale closure when both syncs run in parallel
      setTasks(prevTasks => {
        const nonTaskCalendarTasks = prevTasks.filter(t => !t.isTaskCalendar);
        return [...nonTaskCalendarTasks, ...taskCalendarItems];
      });
      return { success: true, count: taskCalendarItems.length };
    } catch (error) {
      console.error('Task calendar sync error:', error);
      return { success: false, error: 'task-calendar' };
    }
  };

  // Combined sync function that shows a single notification
  const syncAll = async ({ silent = false } = {}) => {
    if (!syncUrl && !taskCalendarUrl) {
      if (!silent) setSyncNotification({ type: 'info', message: 'Please enter a calendar URL in sync settings' });
      return;
    }

    setIsSyncing(true);
    try {
      const [calendarResult, taskResult] = await Promise.all([
        syncWithCalendar(),
        syncTaskCalendar()
      ]);

      if (silent) return;

      // Build notification message
      const successes = [];
      const errors = [];

      if (calendarResult.success) {
        successes.push(`${calendarResult.count} event${calendarResult.count !== 1 ? 's' : ''}`);
      } else if (calendarResult.error === 'calendar') {
        errors.push('calendar');
      }

      if (taskResult.success) {
        successes.push(`${taskResult.count} task${taskResult.count !== 1 ? 's' : ''}`);
      } else if (taskResult.error === 'task-calendar') {
        errors.push('task calendar');
      }

      if (errors.length > 0 && successes.length === 0) {
        setSyncNotification({ type: 'error', message: `Failed to sync with ${errors.join(' and ')}. Make sure the URL is correct and publicly accessible.` });
      } else if (errors.length > 0) {
        setSyncNotification({ type: 'error', message: `Synced ${successes.join(' and ')}, but failed to sync ${errors.join(' and ')}` });
      } else if (successes.length > 0) {
        setSyncNotification({ type: 'success', message: `Synced ${successes.join(' and ')}` });
      }
    } finally {
      setIsSyncing(false);
    }
  };

  // Deadline picker popover for inbox tasks
  const DeadlinePickerPopover = ({ taskId, currentDeadline, onClose }) => {
    const [showCalendar, setShowCalendar] = useState(false);
    const [calendarPos, setCalendarPos] = useState({ x: 0, y: 0 });
    const [viewDate, setViewDate] = useState(() => {
      if (currentDeadline) {
        const parts = currentDeadline.split('-');
        return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, 1);
      }
      return new Date();
    });

    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const todayStr = dateToString(today);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = dateToString(tomorrow);

    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);
    const nextWeekStr = dateToString(nextWeek);

    const handleQuickOption = (dateStr) => {
      setDeadline(taskId, dateStr);
    };

    const getDaysInMonth = () => {
      const year = viewDate.getFullYear();
      const month = viewDate.getMonth();
      const firstDay = new Date(year, month, 1);
      const lastDay = new Date(year, month + 1, 0);
      const daysInMonth = lastDay.getDate();
      const startingDayOfWeek = firstDay.getDay();

      const days = [];
      for (let i = 0; i < startingDayOfWeek; i++) {
        days.push(null);
      }
      for (let i = 1; i <= daysInMonth; i++) {
        days.push(new Date(year, month, i));
      }
      return days;
    };

    const changeMonth = (delta) => {
      setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + delta, 1));
    };

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    if (showCalendar) {
      const days = getDaysInMonth();
      return (
        <div
            className="deadline-picker-container fixed z-[9999]"
            style={{ left: calendarPos.x - 130, top: calendarPos.y - 150 }}
          >
          <div
            className={`${cardBg} rounded-lg shadow-xl border ${borderClass} p-3 w-[260px]`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2">
              <button
                onClick={() => changeMonth(-1)}
                className={`p-1 rounded ${hoverBg}`}
              >
                <ChevronLeft size={16} className={textSecondary} />
              </button>
              <span className={`text-sm font-semibold ${textPrimary}`}>
                {monthNames[viewDate.getMonth()]} {viewDate.getFullYear()}
              </span>
              <button
                onClick={() => changeMonth(1)}
                className={`p-1 rounded ${hoverBg}`}
              >
                <ChevronRight size={16} className={textSecondary} />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-0.5 mb-1">
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => (
                <div key={i} className={`text-center text-xs font-semibold p-1 ${textSecondary}`}>
                  {day}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-0.5">
              {days.map((day, index) => {
                if (!day) {
                  return <div key={`empty-${index}`} className="p-1"></div>;
                }
                const dayStr = dateToString(day);
                const isSelected = dayStr === currentDeadline;
                const isToday = dayStr === todayStr;

                return (
                  <button
                    key={index}
                    onClick={() => {
                      setDeadline(taskId, dayStr);
                      onClose();
                    }}
                    className={`p-1 text-center text-sm rounded transition-colors ${
                      isSelected
                        ? 'bg-blue-600 text-white font-bold'
                        : isToday
                          ? darkMode ? 'bg-blue-900 text-blue-200 font-semibold' : 'bg-blue-100 text-blue-900 font-semibold'
                          : darkMode
                            ? 'hover:bg-gray-700 text-gray-300'
                            : 'hover:bg-gray-100 text-gray-700'
                    }`}
                  >
                    {day.getDate()}
                  </button>
                );
              })}
            </div>

            <div className={`border-t ${borderClass} mt-2 pt-2 flex gap-2`}>
              <button
                onClick={() => setShowCalendar(false)}
                className={`flex-1 px-2 py-1 text-sm rounded ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} ${textPrimary} ${hoverBg}`}
              >
                Back
              </button>
              {currentDeadline && (
                <button
                  onClick={() => {
                    clearDeadline(taskId);
                    onClose();
                  }}
                  className="flex-1 px-2 py-1 text-sm rounded bg-red-600 text-white hover:bg-red-700"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="deadline-picker-container absolute top-full right-0 mt-1 z-30">
        <div
          className={`${cardBg} rounded-lg shadow-xl border ${borderClass} p-2 min-w-[160px]`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="space-y-1">
            <button
              onClick={() => handleQuickOption(todayStr)}
              className={`w-full text-left px-3 py-2 rounded text-sm ${textPrimary} ${hoverBg} flex items-center gap-2`}
            >
              <Calendar size={14} />
              Today
            </button>
            <button
              onClick={() => handleQuickOption(tomorrowStr)}
              className={`w-full text-left px-3 py-2 rounded text-sm ${textPrimary} ${hoverBg} flex items-center gap-2`}
            >
              <Calendar size={14} />
              Tomorrow
            </button>
            <button
              onClick={() => handleQuickOption(nextWeekStr)}
              className={`w-full text-left px-3 py-2 rounded text-sm ${textPrimary} ${hoverBg} flex items-center gap-2`}
            >
              <Calendar size={14} />
              Next week
            </button>
            <div className={`border-t ${borderClass} my-1`}></div>
            <button
              onClick={(e) => {
                setCalendarPos({ x: e.clientX, y: e.clientY });
                setShowCalendar(true);
              }}
              className={`w-full text-left px-3 py-2 rounded text-sm ${textPrimary} ${hoverBg} flex items-center gap-2`}
            >
              <Calendar size={14} />
              Pick date...
            </button>
            {currentDeadline && (
              <>
                <div className={`border-t ${borderClass} my-1`}></div>
                <button
                  onClick={() => clearDeadline(taskId)}
                  className={`w-full text-left px-3 py-2 rounded text-sm text-red-500 ${hoverBg} flex items-center gap-2`}
                >
                  <X size={14} />
                  Clear deadline
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  const ClockTimePicker = ({ value, onChange, onClose }) => {
    const [selectedHour, setSelectedHour] = useState(parseInt(value.split(':')[0]));
    const [selectedMinute, setSelectedMinute] = useState(parseInt(value.split(':')[1]));
    const [mode, setMode] = useState('hour');

    const handleConfirm = () => {
      const timeStr = `${selectedHour.toString().padStart(2, '0')}:${selectedMinute.toString().padStart(2, '0')}`;
      onChange(timeStr);
      onClose();
    };

    const renderClock = () => {
      const numbers = mode === 'hour' ? Array.from({ length: 24 }, (_, i) => i) : [0, 15, 30, 45];
      const radius = 100;
      const centerX = 120;
      const centerY = 120;

      return (
        <div className="relative" style={{ width: '240px', height: '240px' }}>
          <svg width="240" height="240" className="absolute top-0 left-0">
            <circle cx={centerX} cy={centerY} r={radius} fill="none" stroke={darkMode ? '#374151' : '#e5e7eb'} strokeWidth="2" />
            
            {/* Selected time indicator */}
            {mode === 'hour' && (
              <line
                x1={centerX}
                y1={centerY}
                x2={centerX + radius * Math.sin((selectedHour * 15) * Math.PI / 180)}
                y2={centerY - radius * Math.cos((selectedHour * 15) * Math.PI / 180)}
                stroke="#3b82f6"
                strokeWidth="2"
              />
            )}
            {mode === 'minute' && (
              <line
                x1={centerX}
                y1={centerY}
                x2={centerX + radius * Math.sin((selectedMinute * 6) * Math.PI / 180)}
                y2={centerY - radius * Math.cos((selectedMinute * 6) * Math.PI / 180)}
                stroke="#3b82f6"
                strokeWidth="2"
              />
            )}
            
            {/* Center dot */}
            <circle cx={centerX} cy={centerY} r="4" fill="#3b82f6" />
          </svg>

          {numbers.map((num) => {
            const angle = mode === 'hour' ? (num * 15 - 90) : (num * 6 - 90);
            const x = centerX + radius * Math.cos(angle * Math.PI / 180);
            const y = centerY + radius * Math.sin(angle * Math.PI / 180);
            const isSelected = mode === 'hour' ? num === selectedHour : num === selectedMinute;

            return (
              <button
                key={num}
                onClick={() => {
                  if (mode === 'hour') {
                    setSelectedHour(num);
                    setMode('minute');
                  } else {
                    setSelectedMinute(num);
                  }
                }}
                className={`absolute w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                  isSelected 
                    ? 'bg-blue-600 text-white' 
                    : darkMode 
                      ? 'hover:bg-gray-700 text-gray-300' 
                      : 'hover:bg-gray-200 text-gray-700'
                }`}
                style={{
                  left: `${x - 20}px`,
                  top: `${y - 20}px`,
                }}
              >
                {mode === 'hour' ? num : num.toString().padStart(2, '0')}
              </button>
            );
          })}
        </div>
      );
    };

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]" onClick={onClose}>
        <div
          className={`${cardBg} rounded-lg shadow-xl p-6 ${borderClass} border`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className={`text-lg font-semibold ${textPrimary}`}>Select Time</h3>
            <button onClick={onClose} className={`p-1 rounded ${hoverBg}`}>
              <X size={20} className={textSecondary} />
            </button>
          </div>

          <div className="flex justify-center mb-4">
            <div className="flex gap-2 items-center">
              <button
                onClick={() => setMode('hour')}
                className={`text-3xl font-bold px-3 py-1 rounded ${
                  mode === 'hour' ? 'bg-blue-600 text-white' : textSecondary
                }`}
              >
                {selectedHour.toString().padStart(2, '0')}
              </button>
              <span className={`text-3xl ${textPrimary}`}>:</span>
              <button
                onClick={() => setMode('minute')}
                className={`text-3xl font-bold px-3 py-1 rounded ${
                  mode === 'minute' ? 'bg-blue-600 text-white' : textSecondary
                }`}
              >
                {selectedMinute.toString().padStart(2, '0')}
              </button>
            </div>
          </div>

          <div className="flex justify-center mb-4">
            {renderClock()}
          </div>

          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              className={`px-4 py-2 rounded-lg ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} ${textPrimary} ${hoverBg}`}
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Confirm
            </button>
          </div>
        </div>
      </div>
    );
  };

  // FIX 2: Add missing DatePicker component
  const DatePicker = ({ value, onChange, onClose }) => {
    const [viewDate, setViewDate] = useState(() => {
      if (value) {
        const parts = value.split('-');
        return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, 1);
      }
      return new Date();
    });

    const getDaysInMonth = () => {
      const year = viewDate.getFullYear();
      const month = viewDate.getMonth();
      const firstDay = new Date(year, month, 1);
      const lastDay = new Date(year, month + 1, 0);
      const daysInMonth = lastDay.getDate();
      const startingDayOfWeek = firstDay.getDay();
      
      const days = [];
      // Add empty slots for days before the first of the month
      for (let i = 0; i < startingDayOfWeek; i++) {
        days.push(null);
      }
      // Add all days in the month
      for (let i = 1; i <= daysInMonth; i++) {
        days.push(new Date(year, month, i));
      }
      return days;
    };

    const changeMonth = (delta) => {
      setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + delta, 1));
    };

    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                       'July', 'August', 'September', 'October', 'November', 'December'];
    const days = getDaysInMonth();
    const today = dateToString(new Date());

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]" onClick={onClose}>
        <div
          className={`${cardBg} rounded-lg shadow-xl p-6 ${borderClass} border max-w-sm w-full mx-4`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => changeMonth(-1)}
              className={`p-2 rounded ${hoverBg}`}
            >
              <ChevronLeft size={20} className={textSecondary} />
            </button>
            <h3 className={`text-lg font-semibold ${textPrimary}`}>
              {monthNames[viewDate.getMonth()]} {viewDate.getFullYear()}
            </h3>
            <button
              onClick={() => changeMonth(1)}
              className={`p-2 rounded ${hoverBg}`}
            >
              <ChevronRight size={20} className={textSecondary} />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 mb-2">
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => (
              <div key={day} className={`text-center text-sm font-semibold p-2 ${textSecondary}`}>
                {day}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {days.map((day, index) => {
              if (!day) {
                return <div key={`empty-${index}`} className="p-2"></div>;
              }
              const dayStr = dateToString(day);
              const isSelected = dayStr === value;
              const isToday = dayStr === today;

              return (
                <button
                  key={index}
                  onClick={() => {
                    onChange(dayStr);
                    onClose();
                  }}
                  className={`p-2 text-center rounded-lg transition-colors ${
                    isSelected 
                      ? 'bg-blue-600 text-white font-bold' 
                      : isToday
                        ? darkMode ? 'bg-blue-900 text-blue-200 font-semibold' : 'bg-blue-100 text-blue-900 font-semibold'
                        : darkMode 
                          ? 'hover:bg-gray-700 text-gray-300' 
                          : 'hover:bg-gray-100 text-gray-700'
                  }`}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>

          <div className="flex gap-2 mt-4">
            <button
              onClick={() => {
                onChange(dateToString(new Date()));
                onClose();
              }}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Today
            </button>
            <button
              onClick={onClose}
              className={`flex-1 px-4 py-2 rounded-lg ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} ${textPrimary} ${hoverBg}`}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  };

  const todayTasks = tasks.filter(t => t.date === dateToString(selectedDate));

  // Extract all unique tags from calendar tasks that are affected by tag filtering
  // (excludes imported events since they bypass filtering, excludes completed tasks)
  const allTags = useMemo(() => {
    const tagSet = new Set();
    tasks.filter(t => !t.completed && !t.imported).forEach(task => {
      extractTags(task.title).forEach(tag => tagSet.add(tag));
    });
    return Array.from(tagSet).sort();
  }, [tasks]);

  // Getting Started checklist - uses persistent progress tracking
  const gettingStartedItems = useMemo(() => {
    return [
      { id: 'inbox', label: 'Add your first inbox task', completed: onboardingProgress.hasAddedInboxTask },
      { id: 'scheduled', label: 'Add your first scheduled task', completed: onboardingProgress.hasAddedScheduledTask },
      { id: 'drag', label: 'Drag a task to the timeline', completed: onboardingProgress.hasDraggedToTimeline },
      { id: 'deadline', label: 'Add a deadline to an inbox task', completed: onboardingProgress.hasAddedDeadline },
      { id: 'priority', label: 'Set a priority on an inbox task', completed: onboardingProgress.hasSetPriority },
      { id: 'notes', label: 'Add notes or subtasks to a task', completed: onboardingProgress.hasAddedNotes },
      { id: 'tags', label: 'Use #tags in a task title', completed: onboardingProgress.hasUsedTags },
      { id: 'actions', label: 'Use the action buttons on a task', completed: onboardingProgress.hasUsedActionButtons },
      { id: 'complete', label: 'Complete a task', completed: onboardingProgress.hasCompletedTask },
      { id: 'sync', label: 'Set up calendar sync', completed: onboardingProgress.hasSetupSync },
    ];
  }, [onboardingProgress]);

  const allGettingStartedComplete = gettingStartedItems.every(item => item.completed);

  // Check if user has zero real tasks (for showing onboarding)
  const hasZeroRealTasks = useMemo(() => {
    const realScheduledTasks = tasks.filter(t => !t.isExample && !t.imported);
    const realInboxTasks = unscheduledTasks.filter(t => !t.isExample);
    return realScheduledTasks.length === 0 && realInboxTasks.length === 0;
  }, [tasks, unscheduledTasks]);

  // Show onboarding when user has zero real tasks OR hasn't completed/dismissed (but not if they clicked "I'm Good to Go")
  const showOnboarding = !onboardingComplete && (hasZeroRealTasks || (!gettingStartedDismissed && !allGettingStartedComplete));

  // Persist welcome dismissal only when user has real tasks
  useEffect(() => {
    if (!showWelcome && !hasZeroRealTasks) {
      localStorage.setItem('welcomeDismissed', 'true');
    }
  }, [showWelcome, hasZeroRealTasks]);

  // Show welcome only on initial load with zero tasks (not when zeroing out during session)
  useEffect(() => {
    if (!hasCheckedInitialWelcome.current) {
      hasCheckedInitialWelcome.current = true;
      if (hasZeroRealTasks) {
        setShowWelcome(true);
        localStorage.removeItem('welcomeDismissed');
      } else {
        setShowWelcome(false);
      }
    }
  }, [hasZeroRealTasks]);

  // Autocomplete dropdown component for tags, dates, and times
  const SuggestionAutocomplete = ({ suggestions, selectedIndex, onSelect }) => {
    if (suggestions.length === 0) return null;

    const getIcon = (type) => {
      switch (type) {
        case 'date': return <Calendar size={14} className="flex-shrink-0" />;
        case 'time': return <Clock size={14} className="flex-shrink-0" />;
        default: return <Hash size={14} className="flex-shrink-0" />;
      }
    };

    return (
      <div className={`absolute top-full left-0 mt-1 ${cardBg} rounded-lg p-1 z-50 shadow-xl border ${borderClass} min-w-[160px] max-h-40 overflow-y-auto`}>
        {suggestions.map((suggestion, index) => (
          <button
            key={`${suggestion.type}-${suggestion.value}-${index}`}
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onSelect(suggestion);
            }}
            onMouseDown={(e) => e.preventDefault()} // Prevent blur before click
            className={`w-full text-left px-2 py-1.5 rounded text-sm flex items-center gap-2 ${
              index === selectedIndex
                ? 'bg-blue-500 text-white'
                : `${textPrimary} ${hoverBg}`
            }`}
          >
            {getIcon(suggestion.type)}
            <span className="truncate">{suggestion.display}</span>
          </button>
        ))}
      </div>
    );
  };

  // Compute array of visible dates based on selectedDate and visibleDays
  const visibleDates = useMemo(() => {
    return Array.from({ length: visibleDays }, (_, i) => {
      const date = new Date(selectedDate);
      date.setDate(date.getDate() + i);
      return date;
    });
  }, [selectedDate, visibleDays]);

  // Auto-select new tags when they appear
  useEffect(() => {
    const newTags = allTags.filter(tag => !selectedTags.includes(tag));
    if (newTags.length > 0) {
      setSelectedTags(prev => [...prev, ...newTags]);
    }
  }, [allTags]);

  // Filter tasks by selected tags (OR logic - show tasks matching ANY selected tag)
  // Tasks with no tags are always shown (they can't be filtered by tags)
  const filterByTags = (taskList) => {
    return taskList.filter(task => {
      const taskTags = extractTags(task.title);
      // Always show untagged tasks and imported events
      if (taskTags.length === 0 || task.imported) return true;
      // If no tags are selected, hide tagged tasks
      if (selectedTags.length === 0) return false;
      // Show tagged tasks only if they match a selected tag
      return selectedTags.some(tag => taskTags.includes(tag));
    });
  };

  // Inbox tasks are not filtered by tags, only by priority
  // Exclude tasks with deadlines (they appear in the timeline all-day area)
  // Exclude tasks with overdue deadlines (they appear in Overdue section)
  const todayStr = getTodayStr();
  const nonOverdueInboxTasks = unscheduledTasks
    .filter(task => !task.deadline || task.deadline >= todayStr);
  const filteredUnscheduledTasks = nonOverdueInboxTasks
    .filter(task => !task.deadline) // Exclude deadline tasks - they're shown in timeline
    .filter(task => inboxPriorityFilter === 0 || (task.priority || 0) >= inboxPriorityFilter)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0));
  const filteredTodayTasks = filterByTags(todayTasks);

  // Helper to get tasks for a specific date (must be after filterByTags)
  const getTasksForDate = (date) => {
    const dateStr = dateToString(date);
    return filterByTags(tasks.filter(t => t.date === dateStr));
  };

  // Calculate all-time stats (excluding imported events)
  const nonImportedTasks = tasks.filter(t => !t.imported);
  const allCompletedTasks = nonImportedTasks.filter(t => t.completed);
  const totalCompletedMinutes = allCompletedTasks.reduce((sum, task) => sum + task.duration, 0);
  const totalScheduledMinutes = nonImportedTasks.reduce((sum, task) => sum + task.duration, 0);

  // Daily Summary stats - always use actual current date, not selected date
  const actualTodayTasks = tasks.filter(t => t.date === getTodayStr());
  const actualTodayNonImportedTasks = actualTodayTasks.filter(t => !t.imported);
  const actualTodayCompletedTasks = actualTodayNonImportedTasks.filter(t => t.completed);
  const actualTodayCompletedMinutes = actualTodayCompletedTasks.reduce((sum, task) => sum + task.duration, 0);
  const actualTodayPlannedMinutes = actualTodayNonImportedTasks.reduce((sum, task) => sum + task.duration, 0);

  const isToday = dateToString(selectedDate) === dateToString(new Date());
  const currentTimeMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();
  const currentHour = currentTime.getHours();
  const currentTimeTop = currentHour * 160 + currentHour + (currentTime.getMinutes() * 160 / 60);
  const showCurrentTimeLine = isToday;

  const bgClass = darkMode ? 'bg-gray-900' : 'bg-gray-50';
  const cardBg = darkMode ? 'bg-gray-800' : 'bg-white';
  const borderClass = darkMode ? 'border-gray-700' : 'border-gray-200';
  const textPrimary = darkMode ? 'text-gray-100' : 'text-gray-900';
  const textSecondary = darkMode ? 'text-gray-400' : 'text-gray-600';
  const hoverBg = darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100';

  return (
    <div className={`min-h-screen ${bgClass}`}>
      <div className={`${cardBg} border-b ${borderClass}`}>
        <div className="max-w-[2000px] mx-auto px-6 py-4">
          <div className="flex gap-4">
            {/* Sidebar area - date navigator centered with Today button below */}
            <div className={`${sidebarCollapsed ? 'w-[59px]' : 'w-72'} flex-shrink-0 transition-[width] duration-200 relative`} style={{ height: '76px' }}>
              {/* Collapsed date navigator */}
              <div className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${sidebarCollapsed ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                <button onClick={() => changeDate(-1)} className={`p-0.5 rounded ${hoverBg}`}>
                  <ChevronLeft size={16} className={textSecondary} />
                </button>
                <button
                  onClick={goToToday}
                  className={`p-1 rounded ${hoverBg}`}
                  title="Go to today"
                >
                  <Calendar size={20} className={textSecondary} />
                </button>
                <button onClick={() => changeDate(1)} className={`p-0.5 rounded ${hoverBg}`}>
                  <ChevronRight size={16} className={textSecondary} />
                </button>
              </div>

              {/* Expanded date navigator */}
              <div className={`absolute inset-0 flex flex-col items-center justify-center transition-opacity duration-200 ${sidebarCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
                <div className="flex items-center gap-2 relative">
                    <button onClick={() => changeDate(-1)} className={`p-1 rounded ${hoverBg}`}>
                      <ChevronLeft size={20} className={textSecondary} />
                    </button>
                    <button
                      onClick={() => {
                        if (!showMonthView) setViewedMonth(new Date(selectedDate));
                        setShowMonthView(!showMonthView);
                      }}
                      className={`month-view-toggle ${textPrimary} font-bold text-lg hover:bg-gray-100 dark:hover:bg-gray-700 rounded px-2 py-1 transition-colors cursor-pointer`}
                    >
                      {formatDateRange(visibleDates)}
                    </button>
                    <button onClick={() => changeDate(1)} className={`p-1 rounded ${hoverBg}`}>
                      <ChevronRight size={20} className={textSecondary} />
                    </button>

                    {/* Month View Popup */}
                    {showMonthView && (
                      <div className={`month-view-container absolute top-full left-1/2 -translate-x-1/2 mt-2 ${cardBg} rounded-lg shadow-xl border ${borderClass} p-4 z-50 min-w-[300px]`}>
                        <div className="flex items-center justify-between mb-3">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); changeViewedMonth(-1); }}
                            className={`p-1 rounded ${hoverBg}`}
                          >
                            <ChevronLeft size={18} className={textSecondary} />
                          </button>
                          <div className={`font-bold ${textPrimary}`}>
                            {viewedMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                          </div>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); changeViewedMonth(1); }}
                            className={`p-1 rounded ${hoverBg}`}
                          >
                            <ChevronRight size={18} className={textSecondary} />
                          </button>
                        </div>

                        {/* Day headers */}
                        <div className="grid grid-cols-7 gap-1 mb-2">
                          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => (
                            <div key={day} className={`text-xs font-semibold ${textSecondary} text-center`}>
                              {day}
                            </div>
                          ))}
                        </div>

                        {/* Calendar days */}
                        <div className="grid grid-cols-7 gap-1">
                          {getMonthDays().map((day, index) => {
                            const isDayToday = day && day.toDateString() === new Date().toDateString();
                            const isSelected = day && day.toDateString() === selectedDate.toDateString();
                            const hasTasks = hasTasksOnDate(day);

                            return (
                              <button
                                key={index}
                                onClick={() => day && goToDate(day)}
                                disabled={!day}
                                className={`
                                  h-10 rounded text-sm relative
                                  ${!day ? 'invisible' : ''}
                                  ${isSelected ? 'bg-blue-600 text-white font-bold' : ''}
                                  ${!isSelected && isDayToday ? 'bg-blue-100 dark:bg-blue-900 font-semibold' : ''}
                                  ${!isSelected && !isDayToday ? `${textPrimary} hover:bg-gray-100 dark:hover:bg-gray-700` : ''}
                                  ${!day ? '' : 'cursor-pointer'}
                                `}
                              >
                                {day && day.getDate()}
                                {hasTasks && (
                                  <div className={`absolute bottom-1 left-1/2 transform -translate-x-1/2 w-1 h-1 rounded-full ${isSelected ? 'bg-white' : 'bg-blue-600'}`} />
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                </div>
                <button
                  onClick={goToToday}
                  className="mt-2 px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  Today
                </button>
              </div>
            </div>
            {/* Calendar area - weather aligned with left edge */}
            <div className="flex-1 flex items-center gap-6">
              {weather && (
                <>
                  {/* Current weather */}
                  <div className={`flex items-center gap-3 px-4 py-2 ${darkMode ? 'bg-gray-700' : 'bg-gray-100'} rounded-lg`}>
                    <div className="text-2xl">{weather.icon}</div>
                    <div>
                      <div className={`text-lg font-bold ${textPrimary}`}>{weather.temp}°F</div>
                      <div className={`text-xs ${textSecondary}`}>H: {weather.high}° L: {weather.low}°</div>
                    </div>
                  </div>
                  
                  {/* 5-day forecast (hidden in narrow mode) */}
                  {visibleDays > 1 && weather.forecast && weather.forecast.length > 0 && (
                    <div className={`flex items-center gap-2`}>
                      {weather.forecast.map((day, index) => (
                        <div key={index} className={`px-3 py-2 ${darkMode ? 'bg-gray-700' : 'bg-gray-100'} rounded-lg text-center`}>
                          <div className={`text-xs font-semibold ${textSecondary}`}>{day.day}</div>
                          <div className="text-lg my-1">{day.icon}</div>
                          <div className={`text-xs ${textPrimary}`}>
                            <span className="font-semibold">{day.high}°</span>
                            <span className={`${textSecondary} ml-1`}>{day.low}°</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* Rotating Daily Content - shows 2 of 4 content types (widescreen only) */}
              {visibleDays === 3 && (() => {
                const contentItems = [
                  { key: 'dadJoke', icon: '😄', label: 'Dad Joke', content: dailyContent.dadJoke },
                  { key: 'funFact', icon: '💡', label: 'Fun Fact', content: dailyContent.funFact },
                  { key: 'quote', icon: '💬', label: 'Quote', content: dailyContent.quote ? `"${dailyContent.quote.text}" — ${dailyContent.quote.author}` : null },
                  { key: 'history', icon: '📜', label: 'This Day in History', content: dailyContent.history ? `${dailyContent.history.year}: ${dailyContent.history.text}` : null }
                ].filter(item => item.content);

                if (contentItems.length === 0) return null;

                const idx1 = contentRotation % contentItems.length;
                const idx2 = (contentRotation + 1) % contentItems.length;
                const visibleItems = contentItems.length === 1 ? [contentItems[0]] : [contentItems[idx1], contentItems[idx2]];

                return visibleItems.map(item => (
                  <div key={item.key} className={`flex-1 max-w-md h-[92px] px-4 py-2 ${darkMode ? 'bg-gray-700' : 'bg-gray-100'} rounded-lg overflow-hidden`}>
                    <div className={`text-xs font-semibold ${textSecondary} mb-1`}>{item.icon} {item.label}</div>
                    <div className={`text-sm ${textPrimary} leading-snug line-clamp-3`}>{item.content}</div>
                  </div>
                ));
              })()}

              <div className="flex items-center gap-1 ml-auto">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        if (isSyncing) return;
                        if (syncUrl || taskCalendarUrl) {
                          syncAll();
                        } else {
                          setShowSyncSettings(true);
                        }
                      }}
                      disabled={isSyncing}
                      className={`flex-1 px-3 py-2 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} rounded-lg ${hoverBg} flex items-center justify-center gap-2 ${isSyncing ? 'opacity-70 cursor-not-allowed' : ''}`}
                      title={isSyncing ? "Syncing..." : ((syncUrl || taskCalendarUrl) ? "Sync now" : "Configure calendar sync")}
                    >
                      <RefreshCw size={18} className={`${textSecondary} ${isSyncing ? 'animate-spin' : ''}`} />
                      <span className={`text-sm ${textPrimary}`}>{isSyncing ? 'Syncing...' : 'Sync'}</span>
                    </button>
                    {(syncUrl || taskCalendarUrl) && (
                      <button
                        onClick={() => setShowSyncSettings(!showSyncSettings)}
                        className={`p-2 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} rounded-lg ${hoverBg}`}
                        title="Sync settings"
                      >
                        <Calendar size={18} className={textSecondary} />
                      </button>
                    )}
                  </div>
                  <label className={`cursor-pointer px-3 py-2 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} rounded-lg ${hoverBg} flex items-center justify-center gap-2 whitespace-nowrap`}>
                    <Upload size={18} className={textSecondary} />
                    <span className={`text-sm ${textPrimary}`}>Import iCal</span>
                    <input type="file" accept=".ics" onChange={handleFileUpload} className="hidden" />
                  </label>
                </div>
                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => setDarkMode(!darkMode)}
                    className={`p-2 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} rounded-lg ${hoverBg}`}
                    title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
                  >
                    {darkMode ? <Sun size={18} className={textSecondary} /> : <Moon size={18} className={textSecondary} />}
                  </button>
                  <button
                    onClick={() => setShowBackupMenu(true)}
                    className={`p-2 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} rounded-lg ${hoverBg}`}
                    title="Backup or restore data"
                  >
                    <Save size={18} className={textSecondary} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-[2000px] mx-auto px-6 py-6">
        {showSyncSettings && (
          <div className={`${cardBg} rounded-lg shadow-sm border ${borderClass} p-4 mb-6`}>
            <h3 className={`font-semibold ${textPrimary} mb-4`}>Calendar Sync Settings</h3>
            <div className="space-y-4">
              <div>
                <label className={`block text-sm ${textSecondary} mb-2`}>
                  Calendar URL (iCal/CalDAV)
                </label>
                <input
                  type="url"
                  placeholder="https://nextcloud.example.com/remote.php/dav/calendars/user/calendar-name/?export"
                  value={syncUrl}
                  onChange={(e) => setSyncUrl(e.target.value)}
                  className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'}`}
                />
                <p className={`text-xs ${textSecondary} mt-2`}>
                  For Nextcloud: Go to Calendar → Settings → Copy the public link for your calendar
                </p>
              </div>
              <div>
                <label className={`block text-sm ${textSecondary} mb-2`}>
                  Task Calendar URL (iCal/CalDAV)
                </label>
                <input
                  type="url"
                  placeholder="https://nextcloud.example.com/remote.php/dav/calendars/user/tasks/?export"
                  value={taskCalendarUrl}
                  onChange={(e) => setTaskCalendarUrl(e.target.value)}
                  className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'}`}
                />
                <p className={`text-xs ${textSecondary} mt-2`}>
                  Tasks appear with striped pattern; completion state persists across syncs
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => syncAll()}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
                >
                  <RefreshCw size={16} />
                  Sync Now
                </button>
                <button
                  onClick={() => setShowSyncSettings(false)}
                  className={`px-4 py-2 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} ${textPrimary} rounded-lg ${hoverBg}`}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-4">
          <div className={`${sidebarCollapsed ? 'w-[59px]' : 'w-72'} flex-shrink-0 transition-[width] duration-200 flex flex-col`} style={{ height: '1168px' }}>
            {sidebarCollapsed ? (
              /* Collapsed sidebar - icon-only buttons */
              <div className="flex flex-col gap-2 flex-1">
                {/* Action buttons - matching expanded view */}
                <div className="flex flex-col gap-2">
                  <button
                    onClick={openNewTaskForm}
                    className="w-[51px] h-[51px] flex items-center justify-center bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    title="New Scheduled Task"
                  >
                    <CalendarPlus size={24} />
                  </button>
                  <button
                    onClick={openNewInboxTask}
                    className="w-[51px] h-[51px] flex items-center justify-center bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    title="New Inbox Task"
                  >
                    <MailPlus size={24} />
                  </button>
                  <button
                    className="w-[51px] h-[51px] flex items-center justify-center bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors opacity-50 cursor-default"
                    title="Coming soon"
                  >
                    <UserPlus size={24} />
                  </button>
                  <button
                    className="w-[51px] h-[51px] flex items-center justify-center bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors opacity-50 cursor-default"
                    title="Coming soon"
                  >
                    <BrainCircuit size={24} />
                  </button>
                  <button
                    onClick={() => setSidebarCollapsed(false)}
                    className="w-[51px] h-[51px] flex items-center justify-center bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    title="Expand sidebar"
                  >
                    <ChevronsRight size={24} />
                  </button>
                </div>

                {/* Section icons - clicking expands sidebar */}
                <div className={`${cardBg} rounded-lg shadow-sm border ${borderClass} w-[51px] py-2 flex flex-col items-center gap-2`}>
                  {getOverdueTasks().length > 0 && (
                    <button
                      onClick={() => setSidebarCollapsed(false)}
                      className={`p-2 rounded ${hoverBg} relative`}
                      title="Overdue"
                    >
                      <AlertTriangle size={20} className="text-orange-500" />
                      <span className="absolute -top-1 -right-1 bg-orange-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                        {getOverdueTasks().length > 9 ? '9+' : getOverdueTasks().length}
                      </span>
                    </button>
                  )}
                  <button
                    onClick={() => setSidebarCollapsed(false)}
                    className={`p-2 rounded ${hoverBg} relative`}
                    title="Inbox"
                  >
                    <Mail size={20} className={textSecondary} />
                    {filteredUnscheduledTasks.length > 0 && (
                      <span className="absolute -top-1 -right-1 bg-blue-600 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                        {filteredUnscheduledTasks.length > 9 ? '9+' : filteredUnscheduledTasks.length}
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => setSidebarCollapsed(false)}
                    className={`p-2 rounded ${hoverBg}`}
                    title="Tags"
                  >
                    <Hash size={20} className={textSecondary} />
                  </button>
                  <button
                    onClick={() => setSidebarCollapsed(false)}
                    className={`p-2 rounded ${hoverBg}`}
                    title="Daily Summary"
                  >
                    <BarChart3 size={20} className={textSecondary} />
                  </button>
                  <button
                    onClick={() => setSidebarCollapsed(false)}
                    className={`p-2 rounded ${hoverBg} relative`}
                    title="Recycle Bin"
                  >
                    <Trash2 size={20} className={textSecondary} />
                    {recycleBin.length > 0 && (
                      <span className="absolute -top-1 -right-1 bg-red-600 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                        {recycleBin.length > 9 ? '9+' : recycleBin.length}
                      </span>
                    )}
                  </button>
                </div>
              </div>
            ) : (
              /* Expanded sidebar - full content */
              <div className="flex-1 min-h-0">
                <div className={`h-full overflow-y-auto w-[calc(100%+14px)] ${darkMode ? 'dark-scrollbar' : ''}`}>
                <div className="w-72">
                <div className={`flex gap-2 mb-4`}>
                  {/* CalendarPlus - new scheduled task */}
                  <button
                    onClick={openNewTaskForm}
                    className="w-[51px] h-[51px] flex items-center justify-center bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    title="New Scheduled Task"
                  >
                    <CalendarPlus size={24} />
                  </button>
                  {/* InboxPlus - add to inbox */}
                  <button
                    onClick={openNewInboxTask}
                    className="w-[51px] h-[51px] flex items-center justify-center bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    title="New Inbox Task"
                  >
                    <MailPlus size={24} />
                  </button>
                  {/* Placeholder 1 */}
                  <button
                    className="w-[51px] h-[51px] flex items-center justify-center bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors opacity-50 cursor-default"
                    title="Coming soon"
                  >
                    <UserPlus size={24} />
                  </button>
                  {/* Placeholder 2 */}
                  <button
                    className="w-[51px] h-[51px] flex items-center justify-center bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors opacity-50 cursor-default"
                    title="Coming soon"
                  >
                    <BrainCircuit size={24} />
                  </button>
                  {/* Collapse sidebar */}
                  <button
                    onClick={() => setSidebarCollapsed(true)}
                    className="w-[51px] h-[51px] flex items-center justify-center bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    title="Collapse sidebar"
                  >
                    <ChevronsLeft size={24} />
                  </button>
                </div>

            {/* Getting Started Checklist */}
            {showOnboarding && (
              <div className={`${cardBg} rounded-lg shadow-sm border ${borderClass} p-4 mb-4`}>
                <div className="flex items-center justify-between mb-3">
                  <h3 className={`font-semibold ${textPrimary} flex items-center gap-2`}>
                    <Sparkles size={18} className="text-blue-500" />
                    Getting Started
                  </h3>
                </div>
                <div className="space-y-2">
                  {gettingStartedItems.map(item => (
                    <div
                      key={item.id}
                      className={`flex items-center gap-2 text-sm ${item.completed ? textSecondary : textPrimary}`}
                    >
                      <div className={`w-4 h-4 rounded flex-shrink-0 flex items-center justify-center ${
                        item.completed
                          ? 'bg-green-500 text-white'
                          : `border-2 ${darkMode ? 'border-gray-600' : 'border-gray-300'}`
                      }`}>
                        {item.completed && <Check size={10} strokeWidth={3} />}
                      </div>
                      <span className={item.completed ? 'line-through' : ''}>{item.label}</span>
                    </div>
                  ))}
                </div>
                <div className={`mt-3 text-xs ${textSecondary}`}>
                  {gettingStartedItems.filter(i => i.completed).length} of {gettingStartedItems.length} complete
                </div>
                <button
                  onClick={() => {
                    // Skip persisting these changes (for testing - reload will show onboarding again)
                    skipOnboardingPersist.current = true;
                    // Remove all example tasks
                    setTasks(prev => prev.filter(t => !t.isExample));
                    setUnscheduledTasks(prev => prev.filter(t => !t.isExample));
                    setRecycleBin(prev => prev.filter(t => !t.isExample));
                    // Mark onboarding as complete (hides Getting Started and ? buttons)
                    setOnboardingComplete(true);
                  }}
                  className="mt-4 w-full bg-blue-500 hover:bg-blue-600 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                >
                  I'm Good to Go!
                </button>
              </div>
            )}

            {/* Overdue Tasks Section */}
            {getOverdueTasks().length > 0 && (
              <div className={`${cardBg} rounded-lg shadow-sm border ${borderClass} border-orange-500/50 p-4 mb-4`}>
                <div className={`flex items-center justify-between ${minimizedSections.overdue ? '' : 'mb-4'}`}>
                  <h3 className={`font-semibold text-orange-500 flex items-center gap-2`}>
                    <AlertTriangle size={18} />
                    Overdue
                  </h3>
                  <div className="flex items-center gap-2">
                    <span className={`text-sm text-orange-500`}>{getOverdueTasks().length}</span>
                    <button
                      onClick={() => toggleSection('overdue')}
                      className={`text-orange-500 hover:text-orange-400 transition-colors`}
                      title={minimizedSections.overdue ? "Expand" : "Minimize"}
                    >
                      {minimizedSections.overdue ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                    </button>
                  </div>
                </div>

                {!minimizedSections.overdue && (
                  <div className="space-y-2">
                    {getOverdueTasks().map(task => (
                      <div
                        key={task.id}
                        draggable
                        onDragStart={(e) => handleDragStart(task, 'overdue', e)}
                        onDragEnd={handleDragEnd}
                        className={`${task.color} rounded-lg p-3 cursor-move shadow-sm ${task.completed ? 'opacity-50' : ''} relative border-2 border-orange-500/50`}
                      >
                        <div className="flex items-start justify-between text-white">
                          <div className="flex items-start gap-2 flex-1 min-w-0">
                            <button
                              onClick={() => toggleComplete(task.id, task._overdueType === 'deadline')}
                              className={`mt-0.5 rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center hover:bg-white/30 transition-colors`}
                            >
                              {task.completed && <Check size={10} strokeWidth={3} />}
                            </button>
                            <div className="flex-1 min-w-0">
                              <div className={`font-medium text-sm ${task.completed ? 'line-through' : ''}`}>
                                {renderTitle(task.title)}
                              </div>
                              <div className="text-xs opacity-90 mt-1 flex items-center gap-1">
                                {task._overdueType === 'scheduled' ? (
                                  <>
                                    <Clock size={10} />
                                    {task.date} {task.isAllDay ? '' : `• ${task.startTime}`}
                                  </>
                                ) : (
                                  <>
                                    <AlertCircle size={10} />
                                    Due: {formatDeadlineDate(task.deadline)}
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-start gap-1 flex-shrink-0">
                            {task._overdueType === 'scheduled' ? (
                              <button
                                onClick={() => {
                                  setTasks(tasks.filter(t => t.id !== task.id));
                                  const { startTime, date, _overdueType, ...taskWithoutSchedule } = task;
                                  setUnscheduledTasks([...unscheduledTasks, { ...taskWithoutSchedule, priority: taskWithoutSchedule.priority || 0 }]);
                                }}
                                className="hover:bg-white/20 rounded p-1"
                                title="Move to Inbox"
                              >
                                <Mail size={14} />
                              </button>
                            ) : (
                              <button
                                onClick={() => clearDeadline(task.id)}
                                className="hover:bg-white/20 rounded p-1"
                                title="Move to Inbox (clear deadline)"
                              >
                                <Mail size={14} />
                              </button>
                            )}
                            <button
                              onClick={() => moveToRecycleBin(task.id, task._overdueType === 'deadline')}
                              className="hover:bg-white/20 rounded p-1"
                              title="Move to Recycle Bin"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div
              onDragOver={handleDragOverInbox}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget)) {
                  setDragOverInbox(false);
                }
              }}
              onDrop={handleDropOnInbox}
              className={`${cardBg} rounded-lg shadow-sm border ${borderClass} p-4 mb-4 transition-colors ${dragOverInbox ? (darkMode ? 'bg-green-900/40 ring-2 ring-inset ring-green-400' : 'bg-green-100 ring-2 ring-inset ring-green-500') : ''}`}
            >
              <div className={`flex items-center justify-between ${minimizedSections.inbox ? '' : 'mb-4'}`}>
                <h3 className={`font-semibold ${textPrimary} flex items-center gap-2`}>
                  <Mail size={18} />
                  Inbox
                  {!minimizedSections.inbox && nonOverdueInboxTasks.filter(t => !t.deadline).length > 0 && (
                    <button
                      onClick={() => setInboxPriorityFilter(prev => (prev + 1) % 4)}
                      className={`flex gap-0.5 ${hoverBg} rounded px-1.5 py-1 transition-colors ml-1`}
                      title={inboxPriorityFilter === 0 ? 'Showing all priorities (click to filter)' : `Showing priority ${inboxPriorityFilter}+ (click to change)`}
                    >
                      {[0, 1, 2].map(i => (
                        <span
                          key={i}
                          className={`w-2 h-0.5 rounded-full ${
                            inboxPriorityFilter === 0
                              ? `${darkMode ? 'bg-gray-500' : 'bg-gray-400'}`
                              : i < inboxPriorityFilter
                                ? 'bg-blue-500'
                                : `${darkMode ? 'bg-gray-600' : 'bg-gray-300'}`
                          }`}
                        />
                      ))}
                    </button>
                  )}
                </h3>
                <div className="flex items-center gap-2">
                  {filteredUnscheduledTasks.length > 0 && (
                    <span className={`text-sm ${textSecondary}`}>
                      {filteredUnscheduledTasks.length}
                    </span>
                  )}
                  {!onboardingComplete && (hasZeroRealTasks || !sectionInfoDismissed.inbox) && (
                    <button
                      onClick={() => setExpandedSectionInfo(expandedSectionInfo === 'inbox' ? null : 'inbox')}
                      className={`${expandedSectionInfo === 'inbox' ? 'text-blue-500' : textSecondary} hover:text-blue-500 transition-colors`}
                      title="How to use Inbox"
                    >
                      <HelpCircle size={16} />
                    </button>
                  )}
                  <button
                    onClick={() => toggleSection('inbox')}
                    className={`${textSecondary} hover:${textPrimary} transition-colors`}
                    title={minimizedSections.inbox ? "Expand" : "Minimize"}
                  >
                    {minimizedSections.inbox ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                  </button>
                </div>
              </div>

              {/* Inbox info popup */}
              {expandedSectionInfo === 'inbox' && (
                <div className={`mb-3 p-3 rounded-lg ${darkMode ? 'bg-blue-900/30 border border-blue-700' : 'bg-blue-50 border border-blue-200'}`}>
                  <div className="flex items-start gap-2">
                    <HelpCircle size={18} className={`flex-shrink-0 mt-0.5 ${darkMode ? 'text-blue-400' : 'text-blue-600'}`} />
                    <div className="flex-1">
                      <p className={`text-sm font-medium ${darkMode ? 'text-blue-200' : 'text-blue-800'}`}>
                        Inbox Tips
                      </p>
                      <ul className={`text-xs mt-1 ${darkMode ? 'text-blue-300/80' : 'text-blue-600'} space-y-1 list-disc list-inside`}>
                        <li>Drag inbox tasks to the timeline to schedule them</li>
                        <li>Set priorities with the bars icon (filter with the header control)</li>
                        <li>Add deadlines by clicking the calendar icon on an inbox task</li>
                        <li>Add notes or subtasks by clicking the paper icon</li>
                      </ul>
                      <button
                        onClick={() => {
                          setExpandedSectionInfo(null);
                          setSectionInfoDismissed(prev => ({ ...prev, inbox: true }));
                        }}
                        className={`text-xs mt-2 ${darkMode ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-800'} underline`}
                      >
                        Got it, don't show again
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {!minimizedSections.inbox && (
                <>
                  {/* Priority prompt for unprioritized inbox */}
                  {!priorityPromptDismissed &&
                   nonOverdueInboxTasks.filter(t => !t.deadline).length > 5 &&
                   nonOverdueInboxTasks.filter(t => !t.deadline).every(t => !t.priority || t.priority === 0) && (
                    <div className={`mb-3 p-3 rounded-lg ${darkMode ? 'bg-blue-900/30 border border-blue-700' : 'bg-blue-50 border border-blue-200'}`}>
                      <div className="flex items-start gap-2">
                        <AlertCircle size={18} className={`flex-shrink-0 mt-0.5 ${darkMode ? 'text-blue-400' : 'text-blue-600'}`} />
                        <div className="flex-1">
                          <p className={`text-sm font-medium ${darkMode ? 'text-blue-200' : 'text-blue-800'}`}>
                            Prioritize your inbox
                          </p>
                          <p className={`text-xs mt-1 ${darkMode ? 'text-blue-300/80' : 'text-blue-600'}`}>
                            You have {nonOverdueInboxTasks.filter(t => !t.deadline).length} tasks without priorities.
                            Set priorities (click the bars on each task) then use the filter above to focus on what matters most.
                          </p>
                          <button
                            onClick={() => setPriorityPromptDismissed(true)}
                            className={`text-xs mt-2 ${darkMode ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-800'} underline`}
                          >
                            Don't show again
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                <div className="space-y-2">
                  {filteredUnscheduledTasks.length === 0 ? (
                    <p className={`text-sm ${textSecondary} text-center py-2`}>
                      {unscheduledTasks.length === 0
                        ? "Drag tasks here to unschedule them"
                        : nonOverdueInboxTasks.length === 0
                          ? "All tasks have overdue deadlines"
                          : "No tasks match current filter"}
                    </p>
                  ) : (
                    filteredUnscheduledTasks.map(task => (
                    <div
                      key={task.id}
                      className="notes-panel-container"
                    >
                      <div
                        draggable
                        onDragStart={(e) => handleDragStart(task, 'inbox', e)}
                        onDragEnd={handleDragEnd}
                        className={`${task.color} rounded-lg p-3 cursor-move shadow-sm ${task.completed ? 'opacity-50' : ''} relative ${task.isExample ? 'border-2 border-dashed border-white/50' : ''}`}
                      >
                        {task.isExample && (
                          <span className="absolute -top-2 -right-2 bg-yellow-400 text-yellow-900 text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm">
                            Example
                          </span>
                        )}
                        <div className="flex items-start justify-between text-white">
                          <div className="flex items-start gap-2 flex-1 min-w-0">
                            <button
                              onClick={() => toggleComplete(task.id, true)}
                              className={`mt-0.5 rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center hover:bg-white/30 transition-colors`}
                            >
                              {task.completed && <Check size={10} strokeWidth={3} />}
                            </button>
                            <div className="flex-1 min-w-0">
                              {editingTaskId === task.id ? (
                                <div className="relative tag-autocomplete-container">
                                  <input
                                    type="text"
                                    value={editingTaskText}
                                    onChange={(e) => handleEditInputChange(e, true)}
                                    onKeyDown={(e) => handleEditKeyDown(e, true)}
                                    onBlur={() => {
                                      // Delay blur to allow click on autocomplete
                                      setTimeout(() => {
                                        if (!showSuggestions) {
                                          saveTaskTitle(true);
                                        }
                                      }, 100);
                                    }}
                                    autoFocus
                                    className="w-full bg-white/20 text-white font-medium text-sm px-1 py-0.5 rounded border border-white/30 outline-none focus:bg-white/30"
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                  {showSuggestions && suggestionContext === 'editing' && (
                                    <SuggestionAutocomplete
                                      suggestions={suggestions}
                                      selectedIndex={selectedSuggestionIndex}
                                      onSelect={(suggestion) => applySuggestionForEdit(suggestion, editingInputRef.current, true)}
                                    />
                                  )}
                                </div>
                              ) : (
                                <div
                                  className={`font-medium text-sm ${task.completed ? 'line-through' : ''} cursor-text`}
                                  onDoubleClick={(e) => {
                                    e.stopPropagation();
                                    startEditingTask(task, true);
                                  }}
                                  title="Double-click to edit"
                                >
                                  {renderTitle(task.title)}
                                </div>
                              )}
                              <div className="text-xs opacity-90 mt-1 flex items-center gap-2">
                                <span>{task.duration} min</span>
                                {task.deadline && (
                                  <span className="flex items-center gap-1">
                                    <AlertCircle size={10} />
                                    {formatDeadlineDate(task.deadline)}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1 flex-shrink-0">
                            <div className="flex items-start gap-1">
                              {/* Notes button - opens link directly if link-only, long press to edit */}
                              <button
                                onMouseDown={() => {
                                  if (isLinkOnlyTask(task)) {
                                    longPressTriggeredRef.current = false;
                                    longPressTimerRef.current = setTimeout(() => {
                                      longPressTriggeredRef.current = true;
                                      setExpandedNotesTaskId(expandedNotesTaskId === task.id ? null : task.id);
                                    }, 500);
                                  }
                                }}
                                onMouseUp={() => {
                                  if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
                                }}
                                onMouseLeave={() => {
                                  if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (isLinkOnlyTask(task)) {
                                    if (!longPressTriggeredRef.current) {
                                      window.open(getLinkUrl(task), '_blank', 'noopener,noreferrer');
                                    }
                                    longPressTriggeredRef.current = false;
                                  } else {
                                    setExpandedNotesTaskId(expandedNotesTaskId === task.id ? null : task.id);
                                  }
                                }}
                                className={`hover:bg-white/20 rounded p-1 transition-colors ${hasNotesOrSubtasks(task) ? '' : 'opacity-40'}`}
                                title={isLinkOnlyTask(task) ? `${getLinkUrl(task)} (hold to edit)` : "Notes & subtasks"}
                              >
                                {isLinkOnlyTask(task) ? <ExternalLink size={14} /> : hasOnlySubtasks(task) ? <CheckSquare size={14} /> : <FileText size={14} />}
                              </button>
                              {/* Deadline picker */}
                              <div className="deadline-picker-container relative">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setShowDeadlinePicker(showDeadlinePicker === task.id ? null : task.id);
                                  }}
                                  className={`hover:bg-white/20 rounded p-1 transition-colors ${task.deadline ? 'bg-white/20' : ''}`}
                                  title={task.deadline ? `Deadline: ${formatDeadlineDate(task.deadline)}` : 'Set deadline'}
                                >
                                  <Calendar size={14} />
                                </button>
                                {showDeadlinePicker === task.id && (
                                  <DeadlinePickerPopover
                                    taskId={task.id}
                                    currentDeadline={task.deadline}
                                    onClose={() => setShowDeadlinePicker(null)}
                                  />
                                )}
                              </div>
                              <div className="color-picker-container relative">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setShowColorPicker(showColorPicker === task.id ? null : task.id);
                                  }}
                                  className="hover:bg-white/20 rounded p-1 transition-colors"
                                  title="Change color"
                                >
                                  <Palette size={14} />
                                </button>
                                {showColorPicker === task.id && (
                                  <div className="absolute top-full right-0 mt-1 bg-white dark:bg-gray-800 rounded-lg p-2 z-20 shadow-xl border border-gray-200 dark:border-gray-700 min-w-[120px]">
                                    <div className="grid grid-cols-3 gap-1">
                                      {colors.map((color) => (
                                        <button
                                          key={color.class}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            changeTaskColor(task.id, color.class, true);
                                          }}
                                          className={`${color.class} w-8 h-8 rounded-full hover:scale-110 transition-transform ${task.color === color.class ? 'ring-2 ring-offset-2 ring-white' : ''}`}
                                          title={color.name}
                                        />
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                              <button
                                onClick={() => moveToRecycleBin(task.id, true)}
                                className="hover:bg-white/20 rounded p-1"
                                title="Move to Recycle Bin"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                cyclePriority(task.id);
                              }}
                              className="flex gap-0.5 hover:bg-white/20 rounded px-2 py-1.5 mt-1 transition-colors"
                              title={['No priority', 'Low priority', 'Medium priority', 'High priority'][pendingPriorities[task.id] ?? task.priority ?? 0]}
                            >
                              {[0, 1, 2].map(i => (
                                <span
                                  key={i}
                                  className={`w-2 h-0.5 rounded-full bg-white ${i < (pendingPriorities[task.id] ?? task.priority ?? 0) ? 'opacity-100' : 'opacity-30'}`}
                                />
                              ))}
                            </button>
                          </div>
                        </div>
                        {/* Notes panel - inline below task */}
                        {expandedNotesTaskId === task.id && (
                          <NotesSubtasksPanel
                            task={task}
                            isInbox={true}
                            darkMode={darkMode}
                            updateTaskNotes={updateTaskNotes}
                            addSubtask={addSubtask}
                            toggleSubtask={toggleSubtask}
                            deleteSubtask={deleteSubtask}
                            updateSubtaskTitle={updateSubtaskTitle}
                          />
                        )}
                      </div>
                    </div>
                  ))
                )}
                </div>
                </>
              )}
            </div>

            <div className={`${cardBg} rounded-lg shadow-sm border ${borderClass} p-4 mt-4`}>
              <div className={`flex items-center justify-between ${minimizedSections.tags ? '' : 'mb-4'}`}>
                <h3 className={`font-semibold ${textPrimary} flex items-center gap-2`}>
                  <Hash size={18} />
                  Tags
                </h3>
                <div className="flex items-center gap-2">
                  {!minimizedSections.tags && allTags.length > 0 && (
                    allTags.every(tag => selectedTags.includes(tag)) ? (
                      <button
                        onClick={clearTagFilter}
                        className={`text-xs ${textSecondary} hover:${textPrimary} transition-colors`}
                      >
                        Clear
                      </button>
                    ) : (
                      <button
                        onClick={selectAllTags}
                        className={`text-xs ${textSecondary} hover:${textPrimary} transition-colors`}
                      >
                        Select All
                      </button>
                    )
                  )}
                  {!onboardingComplete && (hasZeroRealTasks || !sectionInfoDismissed.tags) && (
                    <button
                      onClick={() => setExpandedSectionInfo(expandedSectionInfo === 'tags' ? null : 'tags')}
                      className={`${expandedSectionInfo === 'tags' ? 'text-blue-500' : textSecondary} hover:text-blue-500 transition-colors`}
                      title="How to use Tags"
                    >
                      <HelpCircle size={16} />
                    </button>
                  )}
                  <button
                    onClick={() => toggleSection('tags')}
                    className={`${textSecondary} hover:${textPrimary} transition-colors`}
                    title={minimizedSections.tags ? "Expand" : "Minimize"}
                  >
                    {minimizedSections.tags ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                  </button>
                </div>
              </div>

              {/* Tags info popup */}
              {expandedSectionInfo === 'tags' && (
                <div className={`mb-3 p-3 rounded-lg ${darkMode ? 'bg-blue-900/30 border border-blue-700' : 'bg-blue-50 border border-blue-200'}`}>
                  <div className="flex items-start gap-2">
                    <HelpCircle size={18} className={`flex-shrink-0 mt-0.5 ${darkMode ? 'text-blue-400' : 'text-blue-600'}`} />
                    <div className="flex-1">
                      <p className={`text-sm font-medium ${darkMode ? 'text-blue-200' : 'text-blue-800'}`}>
                        Tags Tips
                      </p>
                      <ul className={`text-xs mt-1 ${darkMode ? 'text-blue-300/80' : 'text-blue-600'} space-y-1 list-disc list-inside`}>
                        <li>Add #tags in task titles (e.g., "Meeting #work #urgent")</li>
                        <li>Check or uncheck tags to filter the tasks visible on the timeline</li>
                        <li>Tag counts show incomplete tasks only</li>
                      </ul>
                      <button
                        onClick={() => {
                          setExpandedSectionInfo(null);
                          setSectionInfoDismissed(prev => ({ ...prev, tags: true }));
                        }}
                        className={`text-xs mt-2 ${darkMode ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-800'} underline`}
                      >
                        Got it, don't show again
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {!minimizedSections.tags && (
                <div className={`text-sm ${textSecondary}`}>
                  {allTags.length === 0 ? (
                    <p className="text-center py-2">Add #tags to task titles</p>
                  ) : (
                    <div className="space-y-1">
                      {allTags.map(tag => {
                        const tagCount = tasks.filter(t => !t.completed && !t.imported && extractTags(t.title).includes(tag)).length;
                        if (tagCount === 0) return null;
                        return (
                          <label
                            key={tag}
                            className={`flex items-center gap-2 cursor-pointer hover:${textPrimary} transition-colors`}
                          >
                            <input
                              type="checkbox"
                              checked={selectedTags.includes(tag)}
                              onChange={() => toggleTag(tag)}
                              className="rounded"
                            />
                            <span>{tag} <span className={`text-xs ${textSecondary}`}>({tagCount})</span></span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className={`${cardBg} rounded-lg shadow-sm border ${borderClass} p-4 mt-4`}>
              <div className={`flex items-center justify-between ${minimizedSections.dailySummary ? '' : 'mb-2'}`}>
                <h3 className={`font-semibold ${textPrimary} flex items-center gap-2`}>
                  <BarChart3 size={18} />
                  Daily Summary
                </h3>
                <button
                  onClick={() => toggleSection('dailySummary')}
                  className={`${textSecondary} hover:${textPrimary} transition-colors`}
                  title={minimizedSections.dailySummary ? "Expand" : "Minimize"}
                >
                  {minimizedSections.dailySummary ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                </button>
              </div>
              {!minimizedSections.dailySummary && (
                <div className={`text-sm ${textSecondary} space-y-1`}>
                  <div>{actualTodayNonImportedTasks.length} tasks scheduled</div>
                  <div>{actualTodayCompletedTasks.length} tasks completed</div>
                  <div>{Math.floor(actualTodayCompletedMinutes / 60)}h {actualTodayCompletedMinutes % 60}m time spent</div>
                  <div>{Math.floor(actualTodayPlannedMinutes / 60)}h {actualTodayPlannedMinutes % 60}m time planned</div>
                  {actualTodayNonImportedTasks.length > 0 && (
                    <div className="pt-1">
                      <div className="font-semibold">{Math.round((actualTodayCompletedTasks.length / actualTodayNonImportedTasks.length) * 100)}% completion rate</div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className={`${cardBg} rounded-lg shadow-sm border ${borderClass} p-4 mt-4`}>
              <div className={`flex items-center justify-between ${minimizedSections.allTimeSummary ? '' : 'mb-2'}`}>
                <h3 className={`font-semibold ${textPrimary} flex items-center gap-2`}>
                  <BarChart3 size={18} />
                  All Time Summary
                </h3>
                <button
                  onClick={() => toggleSection('allTimeSummary')}
                  className={`${textSecondary} hover:${textPrimary} transition-colors`}
                  title={minimizedSections.allTimeSummary ? "Expand" : "Minimize"}
                >
                  {minimizedSections.allTimeSummary ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                </button>
              </div>
              {!minimizedSections.allTimeSummary && (
                <div className={`text-sm ${textSecondary} space-y-1`}>
                  <div>{nonImportedTasks.length} tasks scheduled</div>
                  <div>{allCompletedTasks.length} tasks completed</div>
                  <div>{Math.floor(totalCompletedMinutes / 60)}h {totalCompletedMinutes % 60}m time spent</div>
                  <div>{Math.floor(totalScheduledMinutes / 60)}h {totalScheduledMinutes % 60}m time planned</div>
                  {nonImportedTasks.length > 0 && (
                    <div className="pt-1">
                      <div className="font-semibold">{Math.round((allCompletedTasks.length / nonImportedTasks.length) * 100)}% completion rate</div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div
              onDragOver={handleDragOverRecycleBin}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget)) {
                  setDragOverRecycleBin(false);
                }
              }}
              onDrop={handleDropOnRecycleBin}
              className={`${cardBg} rounded-lg shadow-sm border ${borderClass} p-4 mt-4 transition-colors ${dragOverRecycleBin ? (darkMode ? 'bg-red-900/40 ring-2 ring-inset ring-red-400' : 'bg-red-100 ring-2 ring-inset ring-red-500') : ''}`}
            >
              <div className={`flex items-center justify-between ${minimizedSections.recycleBin ? '' : 'mb-4'}`}>
                <h3 className={`font-semibold ${textPrimary} flex items-center gap-2`}>
                  <Trash2 size={18} />
                  Recycle Bin
                </h3>
                <div className="flex items-center gap-2">
                  {recycleBin.length > 0 && (
                    <span className={`text-sm ${textSecondary}`}>{recycleBin.length}</span>
                  )}
                  {!onboardingComplete && (hasZeroRealTasks || !sectionInfoDismissed.recycleBin) && (
                    <button
                      onClick={() => setExpandedSectionInfo(expandedSectionInfo === 'recycleBin' ? null : 'recycleBin')}
                      className={`${expandedSectionInfo === 'recycleBin' ? 'text-blue-500' : textSecondary} hover:text-blue-500 transition-colors`}
                      title="How to use Recycle Bin"
                    >
                      <HelpCircle size={16} />
                    </button>
                  )}
                  <button
                    onClick={() => toggleSection('recycleBin')}
                    className={`${textSecondary} hover:${textPrimary} transition-colors`}
                    title={minimizedSections.recycleBin ? "Expand" : "Minimize"}
                  >
                    {minimizedSections.recycleBin ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                  </button>
                </div>
              </div>

              {/* Recycle Bin info popup */}
              {expandedSectionInfo === 'recycleBin' && (
                <div className={`mb-3 p-3 rounded-lg ${darkMode ? 'bg-blue-900/30 border border-blue-700' : 'bg-blue-50 border border-blue-200'}`}>
                  <div className="flex items-start gap-2">
                    <HelpCircle size={18} className={`flex-shrink-0 mt-0.5 ${darkMode ? 'text-blue-400' : 'text-blue-600'}`} />
                    <div className="flex-1">
                      <p className={`text-sm font-medium ${darkMode ? 'text-blue-200' : 'text-blue-800'}`}>
                        Recycle Bin Tips
                      </p>
                      <ul className={`text-xs mt-1 ${darkMode ? 'text-blue-300/80' : 'text-blue-600'} space-y-1 list-disc list-inside`}>
                        <li>Deleted tasks are kept in the recycle bin for 30 days</li>
                        <li>Drag tasks back to Inbox or timeline to restore</li>
                        <li>Click the restore icon (↩) on any task to restore it</li>
                        <li>Use "Empty Bin" to permanently delete all items</li>
                      </ul>
                      <button
                        onClick={() => {
                          setExpandedSectionInfo(null);
                          setSectionInfoDismissed(prev => ({ ...prev, recycleBin: true }));
                        }}
                        className={`text-xs mt-2 ${darkMode ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-800'} underline`}
                      >
                        Got it, don't show again
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {!minimizedSections.recycleBin && (
                <>
                  <div className="space-y-2">
                    {recycleBin.length === 0 ? (
                      <p className={`text-sm ${textSecondary} text-center py-2`}>Drag tasks here to delete them</p>
                    ) : (
                      recycleBin.map(task => (
                        <div
                          key={task.id}
                          draggable
                          onDragStart={(e) => handleDragStart(task, 'recycleBin', e)}
                          onDragEnd={handleDragEnd}
                          className={`${task.color} rounded-lg p-3 shadow-sm opacity-50 relative cursor-move ${task.isExample ? 'border-2 border-dashed border-white/50' : ''}`}
                        >
                          {task.isExample && (
                            <span className="absolute -top-2 -right-2 bg-yellow-400 text-yellow-900 text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm z-10">
                              Example
                            </span>
                          )}
                          <div className="flex items-start justify-between text-white">
                            <div className="flex items-start gap-2 flex-1 min-w-0">
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm truncate">{renderTitle(task.title)}</div>
                                <div className="text-xs opacity-75 mt-1">
                                  {task._deletedFrom === 'inbox' ? (
                                    <>Inbox • {task.duration}min</>
                                  ) : task.startTime ? (
                                    <>{task.startTime} • {task.duration}min</>
                                  ) : (
                                    <>{task.duration}min</>
                                  )}
                                </div>
                              </div>
                            </div>
                            <button
                              onClick={() => undeleteTask(task.id)}
                              className="hover:bg-white/20 rounded p-1 transition-colors"
                              title="Restore Task"
                            >
                              <Undo2 size={14} />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  {recycleBin.length > 0 && (
                    <button
                      onClick={emptyRecycleBin}
                      className={`w-full mt-2 px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm font-medium`}
                    >
                      Empty Recycle Bin
                    </button>
                  )}
                </>
              )}
            </div>
                </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div
              ref={calendarRef}
              className={`${cardBg} rounded-lg shadow-sm border ${borderClass} overflow-y-scroll ${darkMode ? 'dark-scrollbar' : ''} relative`}
              style={{ height: '1168px' }}
            >
              {/* Date headers row - sticky at top */}
              <div className={`flex border-b ${borderClass} sticky top-0 z-20 ${cardBg}`}>
                <div className={`w-20 flex-shrink-0 border-r ${borderClass}`}></div>
                {visibleDates.map((date, idx) => {
                  const isDateToday = dateToString(date) === dateToString(new Date());
                  const dateStr = dateToString(date);
                  const isDragOverThis = dragOverAllDay === dateStr;
                  return (
                    <div
                      key={dateStr}
                      className={`flex-1 py-2 px-3 text-center cursor-pointer hover:bg-opacity-80 transition-colors ${idx > 0 ? `border-l ${borderClass}` : ''} ${isDateToday ? (darkMode ? 'bg-blue-900/30 hover:bg-blue-900/50' : 'bg-blue-50 hover:bg-blue-100') : `${cardBg} ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`} ${isDragOverThis ? (darkMode ? 'bg-green-700 ring-2 ring-inset ring-green-400' : 'bg-green-200 ring-2 ring-inset ring-green-500') : ''}`}
                      onClick={() => {
                        setNewTask({
                          title: '',
                          startTime: getNextQuarterHour(),
                          duration: 30,
                          date: dateStr,
                          isAllDay: true
                        });
                        setShowAddTask(true);
                      }}
                      onDragOver={(e) => e.preventDefault()}
                      onDragEnter={(e) => {
                        e.preventDefault();
                        setDragOverAllDay(dateStr);
                        setDragPreviewTime(null);
                      }}
                      onDragLeave={(e) => {
                        if (!e.currentTarget.contains(e.relatedTarget)) {
                          setDragOverAllDay(null);
                        }
                      }}
                      onDrop={(e) => handleDropOnDateHeader(e, date)}
                      title={draggedTask ? "Drop to make all-day task" : "Click to add all-day task"}
                    >
                      <div className={`font-bold ${isDateToday ? 'text-blue-600' : textPrimary}`}>
                        {formatShortDate(date)}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* All-day tasks section - sticky below date headers */}
              {visibleDates.some(date => getTasksForDate(date).some(t => t.isAllDay) || getDeadlineTasksForDate(dateToString(date)).length > 0) && (
                <div className={`flex border-b ${borderClass} sticky top-[41px] z-20 ${cardBg}`}>
                  <div className={`w-20 flex-shrink-0 px-3 py-2 text-xs font-semibold ${textSecondary} border-r ${borderClass}`}>
                    ALL DAY
                  </div>
                  {visibleDates.map((date, idx) => {
                    const dayTasks = getTasksForDate(date).filter(t => t.isAllDay);
                    const dateStr = dateToString(date);
                    const deadlineTasks = getDeadlineTasksForDate(dateStr);
                    const isDragOverThis = dragOverAllDay === dateStr;
                    return (
                      <div
                        key={dateStr}
                        className={`flex-1 p-2 space-y-1 ${idx > 0 ? `border-l ${borderClass}` : ''} ${isDragOverThis ? (darkMode ? 'bg-green-700/50' : 'bg-green-100') : ''}`}
                        onDragOver={(e) => e.preventDefault()}
                        onDragEnter={(e) => {
                          e.preventDefault();
                          setDragOverAllDay(dateStr);
                          setDragPreviewTime(null);
                        }}
                        onDragLeave={(e) => {
                          if (!e.currentTarget.contains(e.relatedTarget)) {
                            setDragOverAllDay(null);
                          }
                        }}
                        onDrop={(e) => handleDropOnDateHeader(e, date)}
                      >
                        {dayTasks.map((task) => {
                          const isImported = task.imported;
                          const taskCalendarStyle = getTaskCalendarStyle(task, darkMode);

                          // Action buttons for all-day tasks (same as regular scheduled tasks)
                          const AllDayActionButtons = ({ inMenu = false }) => (
                            <>
                              <button
                                onMouseDown={() => {
                                  if (isLinkOnlyTask(task)) {
                                    longPressTriggeredRef.current = false;
                                    longPressTimerRef.current = setTimeout(() => {
                                      longPressTriggeredRef.current = true;
                                      setExpandedNotesTaskId(expandedNotesTaskId === task.id ? null : task.id);
                                    }, 500);
                                  }
                                }}
                                onMouseUp={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
                                onMouseLeave={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (isLinkOnlyTask(task)) {
                                    if (!longPressTriggeredRef.current) {
                                      window.open(getLinkUrl(task), '_blank', 'noopener,noreferrer');
                                    }
                                    longPressTriggeredRef.current = false;
                                  } else {
                                    setExpandedNotesTaskId(expandedNotesTaskId === task.id ? null : task.id);
                                  }
                                }}
                                className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''} ${hasNotesOrSubtasks(task) ? '' : 'opacity-40'}`}
                                title={isLinkOnlyTask(task) ? `${getLinkUrl(task)} (hold to edit)` : "Notes & subtasks"}
                              >
                                {isLinkOnlyTask(task) ? <ExternalLink size={14} /> : hasOnlySubtasks(task) ? <CheckSquare size={14} /> : <FileText size={14} />}
                                {inMenu && <span className="text-xs">{isLinkOnlyTask(task) ? 'Open Link' : 'Notes'}</span>}
                              </button>
                              <button
                                onClick={() => postponeTask(task.id)}
                                className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''}`}
                                title="Postpone to tomorrow"
                              >
                                <SkipForward size={14} />
                                {inMenu && <span className="text-xs">Postpone</span>}
                              </button>
                              <button
                                onClick={() => moveToInbox(task.id)}
                                className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''}`}
                                title="Move to Inbox"
                              >
                                <Mail size={14} />
                                {inMenu && <span className="text-xs">To Inbox</span>}
                              </button>
                              <div className="color-picker-container relative">
                                <button
                                  onClick={() => setShowColorPicker(showColorPicker === task.id ? null : task.id)}
                                  className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''}`}
                                  title="Change color"
                                >
                                  <Palette size={14} />
                                  {inMenu && <span className="text-xs">Color</span>}
                                </button>
                                {showColorPicker === task.id && (
                                  <div className="absolute top-full right-0 mt-1 bg-white dark:bg-gray-800 rounded-lg p-2 z-30 shadow-xl border border-gray-200 dark:border-gray-700 min-w-[120px]">
                                    <div className="grid grid-cols-3 gap-1">
                                      {colors.map((color) => (
                                        <button
                                          key={color.class}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            changeTaskColor(task.id, color.class, false);
                                          }}
                                          className={`${color.class} w-8 h-8 rounded-full hover:scale-110 transition-transform ${task.color === color.class ? 'ring-2 ring-offset-2 ring-white' : ''}`}
                                          title={color.name}
                                        />
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                              <button
                                onClick={() => moveToRecycleBin(task.id)}
                                className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''}`}
                                title="Move to Recycle Bin"
                              >
                                <Trash2 size={14} />
                                {inMenu && <span className="text-xs">Delete</span>}
                              </button>
                            </>
                          );

                          // Width-based layout for all-day tasks (no height concern)
                          const allDayTaskWidth = taskWidths[task.id];
                          const useFullLayout = allDayTaskWidth >= 200;

                          return (
                            <div
                              key={task.id}
                              ref={setTaskRef(task.id)}
                              data-task-id={task.id}
                              draggable={!isImported || task.isTaskCalendar}
                              onDragStart={(e) => (!isImported || task.isTaskCalendar) && handleDragStart(task, 'calendar', e)}
                              onDragEnd={handleDragEnd}
                              onDragOver={(e) => e.preventDefault()}
                              onDragEnter={(e) => {
                                e.preventDefault();
                                setDragOverAllDay(dateStr);
                                setDragPreviewTime(null);
                              }}
                              onDrop={(e) => handleDropOnDateHeader(e, date)}
                              className={`notes-panel-container ${task.isTaskCalendar ? '' : task.color} rounded-lg shadow-sm ${isImported && !task.isTaskCalendar ? 'cursor-default' : 'cursor-move'} ${task.completed && !task.isTaskCalendar ? 'opacity-50' : ''} relative ${task.isExample ? 'border-2 border-dashed border-white/50' : ''}`}
                              style={taskCalendarStyle}
                            >
                              {task.isExample && (
                                <span className="absolute -top-2 -right-2 bg-yellow-400 text-yellow-900 text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm z-10">
                                  Example
                                </span>
                              )}
                              <div className="p-2 text-white">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2 flex-1 min-w-0">
                                    {(!isImported || task.isTaskCalendar) && (
                                      <button
                                        onClick={() => toggleComplete(task.id)}
                                        className={`rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center hover:bg-white/30 transition-colors`}
                                      >
                                        {task.completed && <Check size={10} strokeWidth={3} />}
                                      </button>
                                    )}
                                    <Calendar size={14} className="flex-shrink-0" />
                                    <div
                                      className={`${task.isTaskCalendar ? 'font-bold' : 'font-semibold'} text-sm truncate ${task.completed ? 'line-through' : ''} ${!isImported ? 'cursor-text' : ''}`}
                                      onDoubleClick={(e) => {
                                        if (!isImported) {
                                          e.stopPropagation();
                                          startEditingTask(task, false);
                                        }
                                      }}
                                      title={task.title}
                                    >
                                      {renderTitle(task.title)}
                                    </div>
                                  </div>
                                  {!isImported && (
                                    useFullLayout ? (
                                      // Full layout: show action buttons inline
                                      <div className="flex items-center gap-0.5 flex-shrink-0">
                                        <AllDayActionButtons />
                                      </div>
                                    ) : (
                                      // Compact layout: show overflow menu
                                      <button
                                        onClick={() => setExpandedTaskMenu(expandedTaskMenu === task.id ? null : task.id)}
                                        className="task-menu-container hover:bg-white/20 rounded p-1 transition-colors flex-shrink-0"
                                      >
                                        <MoreHorizontal size={14} />
                                        {expandedTaskMenu === task.id && (
                                          <div className="task-menu-container absolute top-full right-2 mt-1 bg-white dark:bg-gray-800 rounded-lg p-1 z-30 shadow-xl border border-gray-200 dark:border-gray-700 min-w-[100px] text-gray-800 dark:text-white">
                                            <AllDayActionButtons inMenu={true} />
                                          </div>
                                        )}
                                      </button>
                                    )
                                  )}
                                </div>
                              </div>
                              {/* Notes panel for all-day tasks */}
                              {expandedNotesTaskId === task.id && !isImported && (
                                <div className="notes-panel-container">
                                  <NotesSubtasksPanel
                                    task={task}
                                    isInbox={false}
                                    darkMode={darkMode}
                                    updateTaskNotes={updateTaskNotes}
                                    addSubtask={addSubtask}
                                    toggleSubtask={toggleSubtask}
                                    deleteSubtask={deleteSubtask}
                                    updateSubtaskTitle={updateSubtaskTitle}
                                    compact={false}
                                  />
                                </div>
                              )}
                            </div>
                          );
                        })}

                        {/* Deadline tasks from inbox */}
                        {deadlineTasks.map((task) => (
                          <div
                            key={`deadline-${task.id}`}
                            draggable
                            onDragStart={(e) => handleDragStart(task, 'inbox', e)}
                            onDragEnd={handleDragEnd}
                            onDragOver={(e) => e.preventDefault()}
                            onDragEnter={(e) => {
                              e.preventDefault();
                              setDragOverAllDay(dateStr);
                              setDragPreviewTime(null);
                            }}
                            onDrop={(e) => handleDropOnDateHeader(e, date)}
                            className={`${task.color} rounded-lg shadow-sm cursor-move ${task.completed ? 'opacity-50' : 'opacity-90'} relative border-2 border-dashed border-white/60`}
                          >
                            {task.isExample && (
                              <span className="absolute -top-2 -right-2 bg-yellow-400 text-yellow-900 text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm z-10">
                                Example
                              </span>
                            )}
                            <div className="p-2 text-white">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                  <button
                                    onClick={() => toggleComplete(task.id, true)}
                                    className={`rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center hover:bg-white/30 transition-colors`}
                                  >
                                    {task.completed && <Check size={10} strokeWidth={3} />}
                                  </button>
                                  <AlertCircle size={14} className="flex-shrink-0" />
                                  <div
                                    className={`font-semibold text-sm truncate ${task.completed ? 'line-through' : ''}`}
                                    title={task.title}
                                  >
                                    {renderTitle(task.title)}
                                  </div>
                                </div>
                                <div className="flex items-center gap-0.5 flex-shrink-0">
                                  <button
                                    onMouseDown={() => {
                                      if (isLinkOnlyTask(task)) {
                                        longPressTriggeredRef.current = false;
                                        longPressTimerRef.current = setTimeout(() => {
                                          longPressTriggeredRef.current = true;
                                          setExpandedNotesTaskId(expandedNotesTaskId === task.id ? null : task.id);
                                        }, 500);
                                      }
                                    }}
                                    onMouseUp={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
                                    onMouseLeave={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (isLinkOnlyTask(task)) {
                                        if (!longPressTriggeredRef.current) {
                                          window.open(getLinkUrl(task), '_blank', 'noopener,noreferrer');
                                        }
                                        longPressTriggeredRef.current = false;
                                      } else {
                                        setExpandedNotesTaskId(expandedNotesTaskId === task.id ? null : task.id);
                                      }
                                    }}
                                    className={`notes-toggle-button hover:bg-white/20 rounded p-1 transition-colors ${hasNotesOrSubtasks(task) ? '' : 'opacity-40'}`}
                                    title={isLinkOnlyTask(task) ? `${getLinkUrl(task)} (hold to edit)` : "Notes & subtasks"}
                                  >
                                    {isLinkOnlyTask(task) ? <ExternalLink size={14} /> : hasOnlySubtasks(task) ? <CheckSquare size={14} /> : <FileText size={14} />}
                                  </button>
                                  <button
                                    onClick={() => clearDeadline(task.id)}
                                    className="hover:bg-white/20 rounded p-1 transition-colors"
                                    title="Move to Inbox"
                                  >
                                    <Mail size={14} />
                                  </button>
                                  <button
                                    onClick={() => moveToRecycleBin(task.id, true)}
                                    className="hover:bg-white/20 rounded p-1 transition-colors"
                                    title="Move to Recycle Bin"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              </div>
                            </div>
                            {/* Notes panel for deadline tasks */}
                            {expandedNotesTaskId === task.id && (
                              <div className="notes-panel-container">
                                <NotesSubtasksPanel
                                  task={task}
                                  isInbox={true}
                                  darkMode={darkMode}
                                  updateTaskNotes={updateTaskNotes}
                                  addSubtask={addSubtask}
                                  toggleSubtask={toggleSubtask}
                                  deleteSubtask={deleteSubtask}
                                  updateSubtaskTitle={updateSubtaskTitle}
                                />
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Main calendar grid */}
              <div
                ref={timeGridRef}
                className="relative"
                onDragLeave={(e) => {
                  // Clear preview when leaving the calendar grid entirely
                  if (!e.currentTarget.contains(e.relatedTarget)) {
                    setDragPreviewTime(null);
                    setDragPreviewDate(null);
                  }
                }}
              >
                {hours.map((hour, index) => (
                  <div key={hour} className="relative">
                    {/* Main hour row with solid border */}
                    <div className={`flex border-b ${index === 0 ? `border-t` : ''} ${borderClass}`}>
                      <div className={`w-20 flex-shrink-0 px-3 py-1 text-sm ${textSecondary} border-r ${borderClass}`}>
                        {hour.toString().padStart(2, '0')}:00
                      </div>
                      {visibleDates.map((date, idx) => (
                        <div
                          key={dateToString(date)}
                          className={`flex-1 relative h-40 calendar-slot ${idx > 0 ? `border-l ${borderClass}` : ''}`}
                          data-date={dateToString(date)}
                          onDragOver={(e) => handleDragOver(e, date)}
                          onDrop={(e) => handleDropOnCalendar(e, date)}
                          onClick={(e) => openNewTaskAtTime(e, date)}
                          onMouseMove={(e) => handleCalendarMouseMove(e, date)}
                          onMouseLeave={handleCalendarMouseLeave}
                        ></div>
                      ))}
                    </div>
                    {/* Half-hour dashed line (no label) */}
                    <div className="absolute left-0 right-0 pointer-events-none" style={{ top: '80px' }}>
                      <div className={`flex border-b border-dashed ${borderClass} opacity-50`}>
                        <div className="w-20 flex-shrink-0"></div>
                        {visibleDates.map((date, idx) => (
                          <div key={dateToString(date)} className={`flex-1 ${idx > 0 ? `border-l ${borderClass}` : ''}`}></div>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}

                {/* Task overlay for each day column */}
                <div className="absolute top-0 left-20 right-0 bottom-0 pointer-events-none flex">
                  {visibleDates.map((date, dayIndex) => {
                    const dateStr = dateToString(date);
                    const isDateToday = dateStr === dateToString(new Date());
                    const dayTasks = getTasksForDate(date).filter(t => !t.isAllDay);

                    return (
                      <div
                        key={dateStr}
                        className={`flex-1 relative ${dayIndex > 0 ? `border-l ${borderClass}` : ''}`}
                      >
                        {/* Current time line - only on today */}
                        {isDateToday && (
                          <div
                            ref={currentTimeRef}
                            className="absolute left-0 right-0 pointer-events-none z-10"
                            style={{ top: `${currentTimeTop}px` }}
                          >
                            <div className="flex items-center">
                              <div className="w-2 h-2 bg-red-500 rounded-full -ml-1"></div>
                              <div className="flex-1 h-0.5 bg-red-500"></div>
                            </div>
                          </div>
                        )}

                        {/* Tasks for this day */}
                        {dayTasks.map((task) => {
                          const { top, height } = calculateTaskPosition(task);
                          const isConflicted = conflicts.some(c => c.includes(task.id));
                          const conflictPos = calculateConflictPosition(task, dayTasks);
                          const isImported = task.imported;
                          const taskCalendarStyle = getTaskCalendarStyle(task, darkMode);

                          // Height-based tiers (160px/hour: 15min=39px, 30min=79px, 45min=119px)
                          const isMicroHeight = height < 40;  // 15min tasks
                          const isShortHeight = height < 80;  // 15-30min tasks
                          const isMediumHeight = height < 120; // 15-45min tasks

                          // Width-based tiers using measured pixel width
                          const taskWidth = taskWidths[task.id];
                          const isMeasured = taskWidth !== undefined;
                          const isVeryNarrowWidth = taskWidth < 120;
                          const isNarrowWidth = taskWidth < 200;

                          // Combined layout modes - height constraints only apply when width is also limited
                          // Wide tasks (>= 200px) always get full layout regardless of height
                          // Micro: micro height AND narrow, or short AND very narrow
                          const useMicroLayout = (isMicroHeight && isNarrowWidth) || (isShortHeight && isVeryNarrowWidth);
                          // Compact: very narrow (but not micro), or short AND narrow
                          const useCompactLayout = !useMicroLayout && (isVeryNarrowWidth || (isShortHeight && isNarrowWidth));
                          // Medium: narrow width (but not compact or micro)
                          const useMediumLayout = !useMicroLayout && !useCompactLayout && isNarrowWidth;
                          // Full layout is the default when none of the above apply (wide tasks)

                          // Action buttons component (reused in different layouts)
                          const ActionButtons = ({ inMenu = false }) => (
                            <>
                              <button
                                onMouseDown={() => {
                                  if (isLinkOnlyTask(task)) {
                                    longPressTriggeredRef.current = false;
                                    longPressTimerRef.current = setTimeout(() => {
                                      longPressTriggeredRef.current = true;
                                      setExpandedNotesTaskId(expandedNotesTaskId === task.id ? null : task.id);
                                    }, 500);
                                  }
                                }}
                                onMouseUp={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
                                onMouseLeave={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (isLinkOnlyTask(task)) {
                                    if (!longPressTriggeredRef.current) {
                                      window.open(getLinkUrl(task), '_blank', 'noopener,noreferrer');
                                    }
                                    longPressTriggeredRef.current = false;
                                  } else {
                                    setExpandedNotesTaskId(expandedNotesTaskId === task.id ? null : task.id);
                                  }
                                }}
                                className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''} ${hasNotesOrSubtasks(task) ? '' : 'opacity-40'}`}
                                title={isLinkOnlyTask(task) ? `${getLinkUrl(task)} (hold to edit)` : "Notes & subtasks"}
                              >
                                {isLinkOnlyTask(task) ? <ExternalLink size={14} /> : hasOnlySubtasks(task) ? <CheckSquare size={14} /> : <FileText size={14} />}
                                {inMenu && <span className="text-xs">{isLinkOnlyTask(task) ? 'Open Link' : 'Notes'}</span>}
                              </button>
                              <button
                                onClick={() => postponeTask(task.id)}
                                className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''}`}
                                title="Postpone to tomorrow"
                              >
                                <SkipForward size={14} />
                                {inMenu && <span className="text-xs">Postpone</span>}
                              </button>
                              <button
                                onClick={() => moveToInbox(task.id)}
                                className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''}`}
                                title="Move to Inbox"
                              >
                                <Mail size={14} />
                                {inMenu && <span className="text-xs">To Inbox</span>}
                              </button>
                              <div className="color-picker-container relative">
                                <button
                                  onClick={() => setShowColorPicker(showColorPicker === task.id ? null : task.id)}
                                  className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''}`}
                                  title="Change color"
                                >
                                  <Palette size={14} />
                                  {inMenu && <span className="text-xs">Color</span>}
                                </button>
                                {showColorPicker === task.id && (
                                  <div className="absolute top-full right-0 mt-1 bg-white dark:bg-gray-800 rounded-lg p-2 z-30 shadow-xl border border-gray-200 dark:border-gray-700 min-w-[120px]">
                                    <div className="grid grid-cols-3 gap-1">
                                      {colors.map((color) => (
                                        <button
                                          key={color.class}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            changeTaskColor(task.id, color.class, false);
                                          }}
                                          className={`${color.class} w-8 h-8 rounded-full hover:scale-110 transition-transform ${task.color === color.class ? 'ring-2 ring-offset-2 ring-white' : ''}`}
                                          title={color.name}
                                        />
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                              <button
                                onClick={() => moveToRecycleBin(task.id)}
                                className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''}`}
                                title="Move to Recycle Bin"
                              >
                                <Trash2 size={14} />
                                {inMenu && <span className="text-xs">Delete</span>}
                              </button>
                            </>
                          );

                          return (
                            <div
                              key={task.id}
                              ref={setTaskRef(task.id)}
                              data-task-id={task.id}
                              draggable={!isImported || task.isTaskCalendar}
                              onDragStart={(e) => (!isImported || task.isTaskCalendar) && handleDragStart(task, 'calendar', e)}
                              onDragEnd={handleDragEnd}
                              onDragOver={(e) => handleDragOver(e, date)}
                              onDrop={(e) => handleDropOnCalendar(e, date)}
                              className={`absolute notes-panel-container ${task.isTaskCalendar ? '' : task.color} rounded-lg shadow-md pointer-events-auto ${isImported && !task.isTaskCalendar ? 'cursor-default' : 'cursor-move'} ${isConflicted && !task.completed ? 'ring-4 ring-red-500' : ''} ${task.completed && !task.isTaskCalendar ? 'opacity-50' : ''} ${expandedNotesTaskId === task.id ? 'overflow-visible z-30' : ''} ${task.isExample ? 'border-2 border-dashed border-white/50' : ''}`}
                              style={{
                                top: `${top}px`,
                                height: `${height}px`,
                                minHeight: useMicroLayout ? '27px' : '39px',
                                left: conflictPos.left,
                                right: conflictPos.right,
                                width: conflictPos.width,
                                visibility: isMeasured ? 'visible' : 'hidden',
                                ...taskCalendarStyle
                              }}
                            >
                              {task.isExample && (
                                <span className="absolute -top-2 -right-2 bg-yellow-400 text-yellow-900 text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm z-10">
                                  Example
                                </span>
                              )}
                              <div className={`${useMicroLayout ? 'px-1.5 py-1' : 'p-2'} h-full flex flex-col text-white ${useMicroLayout ? 'justify-center' : 'justify-between'} rounded-lg relative`}>
                                {/* IMPORTED EVENT LAYOUT: Always show time on right with truncated title */}
                                {isImported && !task.isTaskCalendar ? (
                                  <div className="flex items-center justify-between gap-2">
                                    <div
                                      className="font-semibold text-sm leading-tight truncate flex-1 min-w-0"
                                      title={task.title}
                                    >
                                      {renderTitleWithoutTags(task.title)}
                                    </div>
                                    <div className="text-xs opacity-90 whitespace-nowrap flex-shrink-0 flex items-center gap-1">
                                      <Clock size={10} />
                                      {task.startTime} • {task.duration}m
                                    </div>
                                  </div>
                                ) : useMicroLayout ? (
                                  /* MICRO LAYOUT: Single line - checkbox + truncated title + ... menu in top-right */
                                  <>
                                    {!isImported && (
                                      <button
                                        onClick={() => setExpandedTaskMenu(expandedTaskMenu === task.id ? null : task.id)}
                                        className="task-menu-container absolute top-0.5 right-0.5 hover:bg-white/20 rounded p-0.5 transition-colors z-10"
                                      >
                                        <MoreHorizontal size={12} />
                                        {expandedTaskMenu === task.id && (
                                          <div className="task-menu-container absolute top-full right-0 mt-1 bg-white dark:bg-gray-800 rounded-lg p-1 z-30 shadow-xl border border-gray-200 dark:border-gray-700 min-w-[100px] text-gray-800 dark:text-white">
                                            <ActionButtons inMenu={true} />
                                          </div>
                                        )}
                                      </button>
                                    )}
                                    <div className="flex items-center gap-1 min-w-0 pr-5">
                                      {(!isImported || task.isTaskCalendar) && (
                                        <button
                                          onClick={() => toggleComplete(task.id)}
                                          className={`rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-3.5 h-3.5 flex items-center justify-center hover:bg-white/30 transition-colors`}
                                        >
                                          {task.completed && <Check size={8} strokeWidth={3} />}
                                        </button>
                                      )}
                                      <div
                                        className={`flex-1 min-w-0 ${task.isTaskCalendar ? 'font-bold' : 'font-semibold'} text-sm leading-tight truncate ${task.completed ? 'line-through' : ''} ${!isImported ? 'cursor-text' : ''}`}
                                        onDoubleClick={(e) => {
                                          if (!isImported) {
                                            e.stopPropagation();
                                            startEditingTask(task, false);
                                          }
                                        }}
                                        title={task.title}
                                      >
                                        {renderTitleWithoutTags(task.title)}
                                      </div>
                                    </div>
                                  </>
                                ) : useCompactLayout ? (
                                  /* COMPACT LAYOUT: Single row - checkbox, truncated title, ... menu in top-right */
                                  <>
                                    {!isImported && (
                                      <button
                                        onClick={() => setExpandedTaskMenu(expandedTaskMenu === task.id ? null : task.id)}
                                        className="task-menu-container absolute top-1 right-1 hover:bg-white/20 rounded p-0.5 transition-colors z-10"
                                      >
                                        <MoreHorizontal size={14} />
                                        {expandedTaskMenu === task.id && (
                                          <div className="task-menu-container absolute top-full right-0 mt-1 bg-white dark:bg-gray-800 rounded-lg p-1 z-30 shadow-xl border border-gray-200 dark:border-gray-700 min-w-[100px] text-gray-800 dark:text-white">
                                            <ActionButtons inMenu={true} />
                                          </div>
                                        )}
                                      </button>
                                    )}
                                    <div className="flex items-center gap-1 pr-5">
                                      {(!isImported || task.isTaskCalendar) && (
                                        <button
                                          onClick={() => toggleComplete(task.id)}
                                          className={`rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center hover:bg-white/30 transition-colors`}
                                        >
                                          {task.completed && <Check size={10} strokeWidth={3} />}
                                        </button>
                                      )}
                                      <div className="flex-1 min-w-0 overflow-hidden">
                                        {editingTaskId === task.id ? (
                                          <div className="relative tag-autocomplete-container">
                                            <input
                                              type="text"
                                              value={editingTaskText}
                                              onChange={(e) => handleEditInputChange(e, false)}
                                              onKeyDown={(e) => handleEditKeyDown(e, false)}
                                              onBlur={() => {
                                                setTimeout(() => {
                                                  if (!showSuggestions) {
                                                    saveTaskTitle(false);
                                                  }
                                                }, 100);
                                              }}
                                              autoFocus
                                              className="w-full bg-white/20 text-white font-semibold text-sm px-1 rounded border border-white/30 outline-none focus:bg-white/30"
                                              onClick={(e) => e.stopPropagation()}
                                            />
                                            {showSuggestions && suggestionContext === 'editing' && (
                                              <SuggestionAutocomplete
                                                suggestions={suggestions}
                                                selectedIndex={selectedSuggestionIndex}
                                                onSelect={(suggestion) => applySuggestionForEdit(suggestion, editingInputRef.current, false)}
                                              />
                                            )}
                                          </div>
                                        ) : (
                                          <div
                                            className={`${task.isTaskCalendar ? 'font-bold' : 'font-semibold'} text-sm leading-tight truncate ${task.completed ? 'line-through' : ''} ${!isImported ? 'cursor-text' : ''}`}
                                            onDoubleClick={(e) => {
                                              if (!isImported) {
                                                e.stopPropagation();
                                                startEditingTask(task, false);
                                              }
                                            }}
                                            title={task.title}
                                          >
                                            {renderTitleWithoutTags(task.title)}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </>
                                ) : useMediumLayout ? (
                                  /* MEDIUM LAYOUT: Title can wrap (clamped), tags, time, ... menu in top-right */
                                  <>
                                    {!isImported && (
                                      <button
                                        onClick={() => setExpandedTaskMenu(expandedTaskMenu === task.id ? null : task.id)}
                                        className="task-menu-container absolute top-1 right-1 hover:bg-white/20 rounded p-0.5 transition-colors z-10"
                                      >
                                        <MoreHorizontal size={14} />
                                        {expandedTaskMenu === task.id && (
                                          <div className="task-menu-container absolute top-full right-0 mt-1 bg-white dark:bg-gray-800 rounded-lg p-1 z-30 shadow-xl border border-gray-200 dark:border-gray-700 min-w-[100px] text-gray-800 dark:text-white">
                                            <ActionButtons inMenu={true} />
                                          </div>
                                        )}
                                      </button>
                                    )}
                                    <div className="pr-5">
                                      <div className="flex items-start gap-1">
                                        {(!isImported || task.isTaskCalendar) && (
                                          <button
                                            onClick={() => toggleComplete(task.id)}
                                            className={`mt-0.5 rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center hover:bg-white/30 transition-colors`}
                                          >
                                            {task.completed && <Check size={10} strokeWidth={3} />}
                                          </button>
                                        )}
                                        <div className="flex-1 min-w-0">
                                          {editingTaskId === task.id ? (
                                            <div className="relative tag-autocomplete-container">
                                              <input
                                                type="text"
                                                value={editingTaskText}
                                                onChange={(e) => handleEditInputChange(e, false)}
                                                onKeyDown={(e) => handleEditKeyDown(e, false)}
                                                onBlur={() => {
                                                  setTimeout(() => {
                                                    if (!showSuggestions) {
                                                      saveTaskTitle(false);
                                                    }
                                                  }, 100);
                                                }}
                                                autoFocus
                                                className="w-full bg-white/20 text-white font-semibold text-sm px-1 py-0.5 rounded border border-white/30 outline-none focus:bg-white/30"
                                                onClick={(e) => e.stopPropagation()}
                                              />
                                              {showSuggestions && suggestionContext === 'editing' && (
                                                <SuggestionAutocomplete
                                                  suggestions={suggestions}
                                                  selectedIndex={selectedSuggestionIndex}
                                                  onSelect={(suggestion) => applySuggestionForEdit(suggestion, editingInputRef.current, false)}
                                                />
                                              )}
                                            </div>
                                          ) : (
                                            <div
                                              className={`${task.isTaskCalendar ? 'font-bold' : 'font-semibold'} text-sm leading-tight line-clamp-2 ${task.completed ? 'line-through' : ''} ${!isImported ? 'cursor-text' : ''}`}
                                              onDoubleClick={(e) => {
                                                if (!isImported) {
                                                  e.stopPropagation();
                                                  startEditingTask(task, false);
                                                }
                                              }}
                                              title={task.title}
                                            >
                                              {renderTitleWithoutTags(task.title)}
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                      {extractTags(task.title).length > 0 && (
                                        <div className="text-xs italic opacity-75 truncate mt-0.5">
                                          {extractTags(task.title).map(tag => `#${tag}`).join(' ')}
                                        </div>
                                      )}
                                      <div className="flex items-center gap-1 mt-auto">
                                        <div className="text-xs opacity-90 whitespace-nowrap flex items-center gap-1">
                                          <Clock size={10} />
                                          {task.startTime} • {task.duration}m
                                        </div>
                                      </div>
                                    </div>
                                  </>
                                ) : (
                                  /* FULL LAYOUT: Title can wrap, tags inline, time and full action buttons */
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="flex items-start gap-2 flex-1 min-w-0">
                                      {(!isImported || task.isTaskCalendar) && (
                                        <button
                                          onClick={() => toggleComplete(task.id)}
                                          className={`mt-0.5 rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center hover:bg-white/30 transition-colors`}
                                        >
                                          {task.completed && <Check size={10} strokeWidth={3} />}
                                        </button>
                                      )}
                                      <div className="flex-1 min-w-0">
                                        {editingTaskId === task.id ? (
                                          <div className="relative tag-autocomplete-container">
                                            <input
                                              type="text"
                                              value={editingTaskText}
                                              onChange={(e) => handleEditInputChange(e, false)}
                                              onKeyDown={(e) => handleEditKeyDown(e, false)}
                                              onBlur={() => {
                                                setTimeout(() => {
                                                  if (!showSuggestions) {
                                                    saveTaskTitle(false);
                                                  }
                                                }, 100);
                                              }}
                                              autoFocus
                                              className="w-full bg-white/20 text-white font-semibold text-sm px-1 py-0.5 rounded border border-white/30 outline-none focus:bg-white/30"
                                              onClick={(e) => e.stopPropagation()}
                                            />
                                            {showSuggestions && suggestionContext === 'editing' && (
                                              <SuggestionAutocomplete
                                                suggestions={suggestions}
                                                selectedIndex={selectedSuggestionIndex}
                                                onSelect={(suggestion) => applySuggestionForEdit(suggestion, editingInputRef.current, false)}
                                              />
                                            )}
                                          </div>
                                        ) : (
                                          <div
                                            className={`${task.isTaskCalendar ? 'font-bold' : 'font-semibold'} text-sm leading-tight ${task.completed ? 'line-through' : ''} ${!isImported ? 'cursor-text' : ''}`}
                                            onDoubleClick={(e) => {
                                              if (!isImported) {
                                                e.stopPropagation();
                                                startEditingTask(task, false);
                                              }
                                            }}
                                            title={!isImported ? "Double-click to edit" : undefined}
                                          >
                                            {renderTitle(task.title)}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                    <div className="flex items-start gap-1 flex-shrink-0">
                                      <div className="text-xs opacity-90 whitespace-nowrap mr-1 mt-0.5 flex items-center gap-1">
                                        <Clock size={12} />
                                        {task.startTime} • {task.duration}min
                                      </div>
                                      {!isImported && <ActionButtons />}
                                    </div>
                                  </div>
                                )}
                                {/* Resize handle at bottom - solid white for visibility */}
                                {!useMicroLayout && !isImported && (
                                  <div
                                    onMouseDown={(e) => handleResizeStart(task, e)}
                                    className="absolute bottom-0 left-1/3 right-1/3 h-3 cursor-ns-resize hover:bg-white/20 flex items-center justify-center"
                                    style={{ marginBottom: '-4px' }}
                                  >
                                    <div className="w-12 h-1 bg-white rounded-full"></div>
                                  </div>
                                )}
                                {/* Notes panel - floating below task (or above for 22:00+ hour) */}
                                {expandedNotesTaskId === task.id && !isImported && (() => {
                                  const hour = parseInt(task.startTime?.split(':')[0] || '0', 10);
                                  const showAbove = hour >= 22;
                                  return (
                                    <div
                                      className="notes-panel-container absolute left-0 right-0 z-40"
                                      style={showAbove ? { bottom: `${height}px` } : { top: `${height}px` }}
                                    >
                                      <div className={`${task.color} rounded-lg shadow-lg ${showAbove ? 'mb-1' : 'mt-1'}`}>
                                        <NotesSubtasksPanel
                                          task={task}
                                          isInbox={false}
                                          darkMode={darkMode}
                                          updateTaskNotes={updateTaskNotes}
                                          addSubtask={addSubtask}
                                          toggleSubtask={toggleSubtask}
                                          deleteSubtask={deleteSubtask}
                                          updateSubtaskTitle={updateSubtaskTitle}
                                          compact={false}
                                        />
                                      </div>
                                    </div>
                                  );
                                })()}
                              </div>
                            </div>
                          );
                        })}

                        {/* Hover preview line - shows where a new task would start */}
                        {hoverPreviewTime && !draggedTask && !isResizing && hoverPreviewDate && dateToString(hoverPreviewDate) === dateStr && (
                          <div
                            className="absolute left-0 right-0 pointer-events-none z-30"
                            style={{
                              top: `${(Math.floor(timeToMinutes(hoverPreviewTime) / 60) * 161) + (timeToMinutes(hoverPreviewTime) % 60 * 160 / 60)}px`
                            }}
                          >
                            <div className="absolute left-0 right-12 h-0.5 bg-blue-400/60"></div>
                            <div className="absolute right-1 bg-blue-500/80 text-white text-xs px-1.5 py-0.5 rounded -translate-y-1/2">
                              {hoverPreviewTime}
                            </div>
                          </div>
                        )}

                        {/* Drag preview - only show in the column being dragged over */}
                        {dragPreviewTime && draggedTask && dragPreviewDate && dateToString(dragPreviewDate) === dateStr && (
                          <>
                            {/* Time label above the box */}
                            <div
                              className="absolute left-2 bg-blue-600 text-white px-2 py-1 rounded text-sm font-bold pointer-events-none z-20 shadow-lg"
                              style={{
                                top: `${(Math.floor(timeToMinutes(dragPreviewTime) / 60) * 161) + (timeToMinutes(dragPreviewTime) % 60 * 160 / 60) - 30}px`
                              }}
                            >
                              {dragPreviewTime}
                            </div>
                            {/* Preview box */}
                            <div
                              className="absolute left-2 right-2 bg-blue-500/50 border-2 border-blue-500 rounded-lg flex items-center justify-center text-white font-bold text-lg pointer-events-none z-5"
                              style={{
                                top: `${(Math.floor(timeToMinutes(dragPreviewTime) / 60) * 161) + (timeToMinutes(dragPreviewTime) % 60 * 160 / 60)}px`,
                                height: `${draggedTask.duration * 160 / 60}px`,
                                minHeight: '39px'
                              }}
                            >
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showTimePicker && (
        <ClockTimePicker
          value={newTask.startTime}
          onChange={(time) => setNewTask({ ...newTask, startTime: time })}
          onClose={() => setShowTimePicker(false)}
        />
      )}

      {showDatePicker && (
        <DatePicker
          value={newTask.date}
          onChange={(date) => setNewTask({ ...newTask, date })}
          onClose={() => setShowDatePicker(false)}
        />
      )}

      {deadlinePickerTaskId && (
        <DatePicker
          value={deadlinePickerTaskId === 'newTask'
            ? (newTask.deadline || dateToString(new Date()))
            : (unscheduledTasks.find(t => t.id === deadlinePickerTaskId)?.deadline || dateToString(new Date()))}
          onChange={(date) => {
            if (deadlinePickerTaskId === 'newTask') {
              setNewTask({ ...newTask, deadline: date });
            } else {
              setDeadline(deadlinePickerTaskId, date);
            }
            setDeadlinePickerTaskId(null);
          }}
          onClose={() => setDeadlinePickerTaskId(null)}
        />
      )}

      {showEmptyBinConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowEmptyBinConfirm(false)}>
          <div
            className={`${cardBg} rounded-lg shadow-xl p-6 ${borderClass} border max-w-sm w-full mx-4`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-full bg-red-100 dark:bg-red-900/30">
                <Trash2 size={20} className="text-red-600 dark:text-red-400" />
              </div>
              <h3 className={`text-lg font-semibold ${textPrimary}`}>Empty Recycle Bin</h3>
            </div>
            <p className={`${textSecondary} mb-6`}>
              Are you sure you want to permanently delete all {recycleBin.length} task{recycleBin.length !== 1 ? 's' : ''} in the recycle bin? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowEmptyBinConfirm(false)}
                className={`px-4 py-2 rounded-lg ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} ${textPrimary} ${hoverBg}`}
              >
                Cancel
              </button>
              <button
                onClick={confirmEmptyBin}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                Delete All
              </button>
            </div>
          </div>
        </div>
      )}

      {showImportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => { setShowImportModal(false); setPendingImportFile(null); }}>
          <div
            className={`${cardBg} rounded-lg shadow-xl p-6 ${borderClass} border max-w-sm w-full mx-4`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-full bg-blue-100 dark:bg-blue-900/30">
                <Upload size={20} className="text-blue-600 dark:text-blue-400" />
              </div>
              <h3 className={`text-lg font-semibold ${textPrimary}`}>Import Calendar</h3>
            </div>
            <p className={`${textSecondary} mb-6`}>
              How would you like to import "{pendingImportFile?.name}"?
            </p>
            <div className="space-y-3">
              <button
                onClick={() => processImportFile(false)}
                className={`w-full px-4 py-3 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-100 hover:bg-gray-200'} ${textPrimary} rounded-lg text-left transition-colors`}
              >
                <div className="font-medium">As Calendar Events</div>
                <div className={`text-sm ${textSecondary}`}>Read-only events (solid gray)</div>
              </button>
              <button
                onClick={() => processImportFile(true)}
                className={`w-full px-4 py-3 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-100 hover:bg-gray-200'} ${textPrimary} rounded-lg text-left transition-colors`}
              >
                <div className="font-medium">As Task Calendar</div>
                <div className={`text-sm ${textSecondary}`}>Checkable tasks (striped pattern)</div>
              </button>
            </div>
            <div className="flex justify-end mt-4">
              <button
                onClick={() => { setShowImportModal(false); setPendingImportFile(null); }}
                className={`px-4 py-2 ${darkMode ? 'bg-gray-600' : 'bg-gray-200'} ${textPrimary} rounded-lg ${hoverBg}`}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showBackupMenu && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowBackupMenu(false)}>
          <div
            className={`${cardBg} rounded-lg shadow-xl p-6 ${borderClass} border max-w-sm w-full mx-4`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-full bg-blue-100 dark:bg-blue-900/30">
                <Save size={20} className="text-blue-600 dark:text-blue-400" />
              </div>
              <h3 className={`text-lg font-semibold ${textPrimary}`}>Backup & Restore</h3>
            </div>
            <p className={`${textSecondary} mb-4`}>
              Export your data to a file or restore from a previous backup.
            </p>
            <div className="space-y-3">
              <button
                onClick={() => { exportBackup(); setShowBackupMenu(false); }}
                className={`w-full px-4 py-3 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-100 hover:bg-gray-200'} ${textPrimary} rounded-lg text-left transition-colors`}
              >
                <div className="font-medium flex items-center gap-2">
                  <Upload size={16} className="rotate-180" />
                  Export Backup
                </div>
                <div className={`text-sm ${textSecondary}`}>Download all tasks and settings as JSON</div>
              </button>
              <label className={`block w-full px-4 py-3 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-100 hover:bg-gray-200'} ${textPrimary} rounded-lg text-left transition-colors cursor-pointer`}>
                <div className="font-medium flex items-center gap-2">
                  <Upload size={16} />
                  Restore Backup
                </div>
                <div className={`text-sm ${textSecondary}`}>Load data from a backup file</div>
                <input type="file" accept=".json" onChange={handleBackupFileSelect} className="hidden" />
              </label>
            </div>
            <div className="flex justify-end mt-4">
              <button
                onClick={() => setShowBackupMenu(false)}
                className={`px-4 py-2 ${darkMode ? 'bg-gray-600' : 'bg-gray-200'} ${textPrimary} rounded-lg ${hoverBg}`}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showRestoreConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => { setShowRestoreConfirm(false); setPendingBackupFile(null); }}>
          <div
            className={`${cardBg} rounded-lg shadow-xl p-6 ${borderClass} border max-w-sm w-full mx-4`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-full bg-amber-100 dark:bg-amber-900/30">
                <AlertCircle size={20} className="text-amber-600 dark:text-amber-400" />
              </div>
              <h3 className={`text-lg font-semibold ${textPrimary}`}>Restore Backup</h3>
            </div>
            <p className={`${textSecondary} mb-2`}>
              Restore from "{pendingBackupFile?.name}"?
            </p>
            <p className={`${textSecondary} mb-6 text-sm`}>
              This will replace all your current tasks, inbox items, recycle bin, and settings with the data from this backup. The page will reload after restoration.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowRestoreConfirm(false); setPendingBackupFile(null); }}
                className={`px-4 py-2 rounded-lg ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} ${textPrimary} ${hoverBg}`}
              >
                Cancel
              </button>
              <button
                onClick={restoreBackup}
                className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700"
              >
                Restore
              </button>
            </div>
          </div>
        </div>
      )}

      {syncNotification && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setSyncNotification(null)}>
          <div
            className={`${cardBg} rounded-lg shadow-xl p-6 ${borderClass} border max-w-sm w-full mx-4`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className={`p-2 rounded-full ${
                syncNotification.type === 'success' ? 'bg-green-100 dark:bg-green-900/30' :
                syncNotification.type === 'error' ? 'bg-red-100 dark:bg-red-900/30' :
                'bg-blue-100 dark:bg-blue-900/30'
              }`}>
                {syncNotification.type === 'success' ? (
                  <Check size={20} className="text-green-600 dark:text-green-400" />
                ) : syncNotification.type === 'error' ? (
                  <AlertCircle size={20} className="text-red-600 dark:text-red-400" />
                ) : (
                  <RefreshCw size={20} className="text-blue-600 dark:text-blue-400" />
                )}
              </div>
              <h3 className={`text-lg font-semibold ${textPrimary}`}>
                {syncNotification.title ? syncNotification.title :
                 syncNotification.type === 'success' ? 'Sync Complete' :
                 syncNotification.type === 'error' ? 'Sync Failed' : 'Calendar Sync'}
              </h3>
            </div>
            <p className={`${textSecondary} mb-6`}>
              {syncNotification.message}
            </p>
            <div className="flex justify-end">
              <button
                onClick={() => setSyncNotification(null)}
                className={`px-4 py-2 ${
                  syncNotification.type === 'success' ? 'bg-green-600 hover:bg-green-700' :
                  syncNotification.type === 'error' ? 'bg-red-600 hover:bg-red-700' :
                  'bg-blue-600 hover:bg-blue-700'
                } text-white rounded-lg`}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Task Modal */}
      {showAddTask && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => { setShowAddTask(false); setShowNewTaskDeadlinePicker(false); }}>
          <form
            className={`${cardBg} rounded-lg shadow-xl p-6 ${borderClass} border max-w-lg w-full mx-4`}
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              const addToInbox = e.nativeEvent.submitter?.dataset.inbox === 'true' || newTask.openInInbox;
              addTask(addToInbox);
              setShowNewTaskDeadlinePicker(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setShowAddTask(false);
                setShowNewTaskDeadlinePicker(false);
              } else if (e.key === '%' && !newTask.openInInbox) {
                // '%' toggles Full Day for scheduled tasks
                e.preventDefault();
                setNewTask({ ...newTask, isAllDay: !newTask.isAllDay });
              } else if (e.key === ' ' && e.target.tagName !== 'INPUT') {
                // Prevent SPACE from activating buttons
                e.preventDefault();
              }
            }}
          >
            <h3 className={`font-semibold ${textPrimary} mb-4 text-lg`}>
              {newTask.openInInbox ? 'New Inbox Task' : 'New Scheduled Task'}
            </h3>
            <div className="space-y-4">
              <div className="relative tag-autocomplete-container">
                <input
                  ref={newTaskInputRef}
                  type="text"
                  placeholder={newTask.openInInbox ? "Task title (#tag, $deadline, !priority)" : "Task title (#tag, @date, ~time)"}
                  value={newTask.title}
                  onChange={handleNewTaskInputChange}
                  onKeyDown={handleNewTaskInputKeyDown}
                  autoFocus
                  className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'}`}
                />
                {showSuggestions && suggestionContext === 'newTask' && (
                  <SuggestionAutocomplete
                    suggestions={suggestions}
                    selectedIndex={selectedSuggestionIndex}
                    onSelect={applySuggestionForNewTask}
                  />
                )}
              </div>
              <div className="grid grid-cols-3 gap-3">
                {newTask.openInInbox ? (
                  <>
                    <div>
                      <label className={`block text-sm ${textSecondary} mb-1`}>Color</label>
                      <div className="relative color-picker-container">
                        <button
                          type="button"
                          onClick={() => setShowColorPicker(showColorPicker === 'newTask' ? null : 'newTask')}
                          className={`w-full h-10 ${newTask.color || colors[0].class} rounded-lg border ${borderClass}`}
                        />
                        {showColorPicker === 'newTask' && (
                          <div className={`absolute top-12 left-0 ${cardBg} rounded-lg p-2 shadow-xl z-20 border ${borderClass} min-w-[120px]`}>
                            <div className="grid grid-cols-3 gap-1">
                              {colors.map((color) => (
                                <button
                                  type="button"
                                  key={color.class}
                                  onClick={() => {
                                    setNewTask({ ...newTask, color: color.class });
                                    setShowColorPicker(null);
                                  }}
                                  className={`${color.class} w-8 h-8 rounded-full hover:scale-110 transition-transform`}
                                  title={color.name}
                                />
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    <div>
                      <label className={`block text-sm ${textSecondary} mb-1`}>Priority</label>
                      <button
                        type="button"
                        onClick={() => setNewTask({ ...newTask, priority: ((newTask.priority || 0) + 1) % 4 })}
                        className={`w-full h-10 px-3 border ${borderClass} rounded-lg ${darkMode ? 'bg-gray-700' : 'bg-white'} flex items-center justify-center gap-1`}
                        title={['No priority', 'Low priority', 'Medium priority', 'High priority'][newTask.priority || 0]}
                      >
                        {[1, 2, 3].map((level) => (
                          <div
                            key={level}
                            className={`w-4 h-1 rounded-full ${(newTask.priority || 0) >= level ? 'bg-orange-500' : darkMode ? 'bg-gray-600' : 'bg-gray-300'}`}
                          />
                        ))}
                      </button>
                    </div>
                    <div>
                      <label className={`block text-sm ${textSecondary} mb-1`}>Deadline</label>
                      <div className="relative deadline-picker-container">
                        <button
                          type="button"
                          onClick={() => setShowNewTaskDeadlinePicker(!showNewTaskDeadlinePicker)}
                          className={`w-full px-3 py-2 border ${borderClass} rounded-lg text-left text-sm ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'} flex items-center gap-2`}
                        >
                          <Calendar size={14} className={textSecondary} />
                          {newTask.deadline
                            ? new Date(newTask.deadline + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                            : 'None'}
                        </button>
                        {showNewTaskDeadlinePicker && (
                          <div className={`absolute top-12 left-0 ${cardBg} rounded-lg shadow-xl border ${borderClass} p-2 min-w-[160px] z-20`}>
                            <div className="space-y-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setNewTask({ ...newTask, deadline: dateToString(new Date()) });
                                  setShowNewTaskDeadlinePicker(false);
                                }}
                                className={`w-full text-left px-3 py-2 rounded text-sm ${textPrimary} ${hoverBg} flex items-center gap-2`}
                              >
                                <Calendar size={14} />
                                Today
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const tomorrow = new Date();
                                  tomorrow.setDate(tomorrow.getDate() + 1);
                                  setNewTask({ ...newTask, deadline: dateToString(tomorrow) });
                                  setShowNewTaskDeadlinePicker(false);
                                }}
                                className={`w-full text-left px-3 py-2 rounded text-sm ${textPrimary} ${hoverBg} flex items-center gap-2`}
                              >
                                <Calendar size={14} />
                                Tomorrow
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const nextWeek = new Date();
                                  nextWeek.setDate(nextWeek.getDate() + 7);
                                  setNewTask({ ...newTask, deadline: dateToString(nextWeek) });
                                  setShowNewTaskDeadlinePicker(false);
                                }}
                                className={`w-full text-left px-3 py-2 rounded text-sm ${textPrimary} ${hoverBg} flex items-center gap-2`}
                              >
                                <Calendar size={14} />
                                Next week
                              </button>
                              <div className={`border-t ${borderClass} my-1`}></div>
                              <button
                                type="button"
                                onClick={() => {
                                  setShowNewTaskDeadlinePicker(false);
                                  setDeadlinePickerTaskId('newTask');
                                }}
                                className={`w-full text-left px-3 py-2 rounded text-sm ${textPrimary} ${hoverBg} flex items-center gap-2`}
                              >
                                <Calendar size={14} />
                                Pick date...
                              </button>
                              {newTask.deadline && (
                                <>
                                  <div className={`border-t ${borderClass} my-1`}></div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setNewTask({ ...newTask, deadline: null });
                                      setShowNewTaskDeadlinePicker(false);
                                    }}
                                    className={`w-full text-left px-3 py-2 rounded text-sm text-red-500 ${hoverBg} flex items-center gap-2`}
                                  >
                                    <X size={14} />
                                    Clear deadline
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    {/* Row 1: Color, Date, Recurrence */}
                    <div>
                      <label className={`block text-sm ${textSecondary} mb-1`}>Color</label>
                      <div className="relative color-picker-container">
                        <button
                          type="button"
                          onClick={() => setShowColorPicker(showColorPicker === 'newTask' ? null : 'newTask')}
                          className={`w-full h-10 ${newTask.color || colors[0].class} rounded-lg border ${borderClass}`}
                        />
                        {showColorPicker === 'newTask' && (
                          <div className={`absolute top-12 left-0 ${cardBg} rounded-lg p-2 shadow-xl z-20 border ${borderClass} min-w-[120px]`}>
                            <div className="grid grid-cols-3 gap-1">
                              {colors.map((color) => (
                                <button
                                  type="button"
                                  key={color.class}
                                  onClick={() => {
                                    setNewTask({ ...newTask, color: color.class });
                                    setShowColorPicker(null);
                                  }}
                                  className={`${color.class} w-8 h-8 rounded-full hover:scale-110 transition-transform`}
                                  title={color.name}
                                />
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    <div>
                      <label className={`block text-sm ${textSecondary} mb-1`}>Date</label>
                      <button
                        type="button"
                        onClick={() => setShowDatePicker(true)}
                        className={`w-full px-3 py-2 border ${borderClass} rounded-lg text-left text-sm ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'}`}
                      >
                        {newTask.date ? new Date(newTask.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Select'}
                      </button>
                    </div>
                    <div>
                      <label className={`block text-sm ${textSecondary} mb-1`}>Recurrence</label>
                      <button
                        type="button"
                        disabled
                        className={`w-full px-3 py-2 border ${borderClass} rounded-lg text-left text-sm ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'} opacity-50 cursor-not-allowed`}
                      >
                        None
                      </button>
                    </div>
                    {/* Row 2: Time, Duration, All Day */}
                    <div>
                      <label className={`block text-sm ${textSecondary} mb-1`}>Time</label>
                      <button
                        type="button"
                        onClick={() => !newTask.isAllDay && setShowTimePicker(true)}
                        disabled={newTask.isAllDay}
                        className={`w-full px-3 py-2 border ${borderClass} rounded-lg text-left ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'} ${newTask.isAllDay ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        {newTask.isAllDay ? 'All Day' : newTask.startTime}
                      </button>
                    </div>
                    <div>
                      <label className={`block text-sm ${textSecondary} mb-1`}>Duration</label>
                      <select
                        value={newTask.duration}
                        onChange={(e) => setNewTask({ ...newTask, duration: parseInt(e.target.value) })}
                        disabled={newTask.isAllDay}
                        className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'} ${newTask.isAllDay ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        {durationOptions.map(minutes => (
                          <option key={minutes} value={minutes}>
                            {minutes} min
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={`block text-sm ${textSecondary} mb-1`}>All Day</label>
                      <label className="flex items-center h-10 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={newTask.isAllDay}
                          onChange={(e) => setNewTask({ ...newTask, isAllDay: e.target.checked })}
                          className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                        />
                        <span className={`ml-2 text-sm ${textPrimary}`}>Full day</span>
                      </label>
                    </div>
                  </>
                )}
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  {newTask.openInInbox ? 'Add to Inbox' : 'Add to Schedule'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowAddTask(false); setShowNewTaskDeadlinePicker(false); }}
                  className={`px-4 py-2 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} ${textPrimary} rounded-lg ${hoverBg}`}
                >
                  Cancel
                </button>
              </div>
              <div className={`text-xs ${textSecondary} text-center`}>
                <kbd className={`px-1.5 py-0.5 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} rounded`}>Enter</kbd> add to {newTask.openInInbox ? 'inbox' : 'schedule'}
                {' '} • <kbd className={`px-1.5 py-0.5 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} rounded`}>Esc</kbd> cancel
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Welcome Modal for New Users */}
      {showWelcome && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowWelcome(false)}>
          <div
            className={`${cardBg} rounded-lg shadow-xl p-6 ${borderClass} border max-w-lg w-full mx-4`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-lg">
                <Sparkles size={24} className="text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h2 className={`text-xl font-bold ${textPrimary}`}>Welcome to Day Planner!</h2>
                <p className={`text-sm ${textSecondary}`}>Let's get you started</p>
              </div>
            </div>

            <div className={`space-y-4 ${textPrimary}`}>
              <div className="space-y-3">
                <h3 className="font-semibold flex items-center gap-2">
                  <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm">1</span>
                  Two Ways to Add Tasks
                </h3>
                <div className={`text-sm ${textSecondary} ml-8 space-y-2`}>
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 bg-blue-600 text-white rounded flex items-center justify-center flex-shrink-0">
                      <CalendarPlus size={16} />
                    </span>
                    <span><strong className={textPrimary}>Scheduled</strong> — tasks with a specific time slot (or press <kbd className={`px-1.5 py-0.5 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} rounded text-xs`}>N</kbd>)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 bg-blue-600 text-white rounded flex items-center justify-center flex-shrink-0">
                      <MailPlus size={16} />
                    </span>
                    <span><strong className={textPrimary}>Inbox</strong> — tasks to organize later (or press <kbd className={`px-1.5 py-0.5 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} rounded text-xs`}>I</kbd>)</span>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="font-semibold flex items-center gap-2">
                  <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm">2</span>
                  Interacting with Tasks
                </h3>
                <ul className={`text-sm ${textSecondary} ml-8 space-y-1 list-disc list-inside`}>
                  <li>Click on the <strong className={textPrimary}>timeline</strong> to add a task at that time</li>
                  <li>Click on the <strong className={textPrimary}>date header</strong> to add an all-day task</li>
                  <li>Drag tasks from Inbox to timeline to schedule them</li>
                  <li>Drag the bottom edge of a task to resize its duration</li>
                  <li>Double-click a task title to edit it</li>
                  <li>Drag tasks to Recycle Bin to delete them</li>
                </ul>
              </div>

              <div className="space-y-3">
                <h3 className="font-semibold flex items-center gap-2">
                  <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm">3</span>
                  Sync Your Calendar
                </h3>
                <p className={`text-sm ${textSecondary} ml-8`}>
                  Click <Upload size={14} className="inline mx-1" /> in the top bar to import iCal files, or <Link size={14} className="inline mx-1" /> to sync with a calendar URL (Google, Outlook, etc.).
                </p>
              </div>

              <div className="space-y-3">
                <h3 className="font-semibold flex items-center gap-2">
                  <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm">4</span>
                  Settings & Backup
                </h3>
                <div className={`text-sm ${textSecondary} ml-8 space-y-2`}>
                  <div className="flex items-center gap-2">
                    <span className={`w-7 h-7 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} rounded flex items-center justify-center flex-shrink-0`}>
                      {darkMode ? <Sun size={16} className={textPrimary} /> : <Moon size={16} className={textPrimary} />}
                    </span>
                    <span>Toggle between <strong className={textPrimary}>light and dark mode</strong></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`w-7 h-7 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} rounded flex items-center justify-center flex-shrink-0`}>
                      <Save size={16} className={textPrimary} />
                    </span>
                    <span><strong className={textPrimary}>Backup & restore</strong> your data as a JSON file</span>
                  </div>
                  <p className="text-xs opacity-75 mt-1">Your data is stored locally in your browser. Use backup to transfer between devices or keep a safe copy.</p>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="font-semibold flex items-center gap-2">
                  <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm">5</span>
                  More to Come
                </h3>
                <p className={`text-sm ${textSecondary} ml-8`}>
                  <strong className={textPrimary}>Recurring tasks</strong>, <strong className={textPrimary}>routines</strong>, and <strong className={textPrimary}>goals</strong> are coming soon! You may notice placeholders here and there for future functionality.
                </p>
              </div>

              <div className={`p-3 rounded-lg ${darkMode ? 'bg-gray-700/50' : 'bg-gray-100'}`}>
                <p className={`text-sm ${textSecondary}`}>
                  <strong className={textPrimary}>QUICK TIP:</strong> Look for <HelpCircle size={14} className="inline text-blue-500 mx-0.5" /> icons in the sidebar for tips on how to use each section.
                </p>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setShowWelcome(false)}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
              >
                Get Started
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DayPlanner;