import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Plus, Clock, X, GripVertical, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Moon, Sun, Upload, Inbox, AlertCircle, Calendar, Check, RefreshCw, Palette, CalendarPlus, Trash2, Undo2, BarChart3, SkipForward, Hash, MoreHorizontal, Save, Menu, MailPlus, UserPlus, BrainCircuit, Mail } from 'lucide-react';

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
  const [showDatePicker, setShowDatePicker] = useState(false);
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
  const [hoverPreviewTime, setHoverPreviewTime] = useState(null);
  const [hoverPreviewDate, setHoverPreviewDate] = useState(null);
  const [isResizing, setIsResizing] = useState(false);
  const [inboxPriorityFilter, setInboxPriorityFilter] = useState(0); // 0 = show all, 1-3 = show >= that priority
  const [suggestions, setSuggestions] = useState([]); // Array of { type: 'tag'|'date'|'time', value, display, ... }
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionContext, setSuggestionContext] = useState(null); // 'newTask' | 'editing'
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
        // Allow letters, numbers, spaces, slashes, dashes for date input
        if (partial === '' || /^[\w\s\/\-,]*$/.test(partial)) {
          return { partial, startIndex };
        }
        return null;
      }
      // Stop if we hit certain characters that wouldn't be part of a date
      if (/[#~]/.test(char)) {
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
        // Allow letters, numbers, colons, spaces for time input
        if (partial === '' || /^[\w\s:]*$/.test(partial)) {
          return { partial, startIndex };
        }
        return null;
      }
      // Stop if we hit certain characters that wouldn't be part of a time
      if (/[#@]/.test(char)) {
        return null;
      }
      startIndex--;
    }
    return null;
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
    // Clean up extra spaces
    return (before + after).replace(/\s+/g, ' ').trim();
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
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [expandedTaskMenu, showColorPicker]);

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

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);

    return () => clearInterval(timer);
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

      if (tasksData) {
        setTasks(JSON.parse(tasksData));
      }
      if (unscheduledData) {
        setUnscheduledTasks(JSON.parse(unscheduledData));
      }
      if (recycleBinData) {
        setRecycleBin(JSON.parse(recycleBinData));
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

  const cyclePriority = (taskId) => {
    const task = unscheduledTasks.find(t => t.id === taskId);
    const currentPriority = pendingPriorities[taskId] ?? task?.priority ?? 0;
    const newPriority = (currentPriority + 1) % 4;

    // Update visual immediately
    setPendingPriorities(prev => ({ ...prev, [taskId]: newPriority }));

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
      const task = {
        id: Date.now(),
        title: newTask.title,
        duration: newTask.duration,
        color: newTask.color || colors[0].class,
        completed: false,
        isAllDay: newTask.isAllDay || false
      };

      if (toInbox) {
        setUnscheduledTasks([...unscheduledTasks, { ...task, priority: 0 }]);
      } else {
        setTasks([...tasks, {
          ...task,
          startTime: newTask.isAllDay ? '00:00' : newTask.startTime,
          date: newTask.date || dateToString(selectedDate)
        }]);
      }
      
      setNewTask({ title: '', startTime: getNextQuarterHour(), duration: 30, date: dateToString(selectedDate), isAllDay: false });
      setShowAddTask(false);
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
  };

  const toggleComplete = (id, fromInbox = false) => {
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
  };

  const moveToInbox = (id) => {
    const task = tasks.find(t => t.id === id);
    if (!task) return;

    // Remove scheduling info and move to inbox
    const unscheduledTask = {
      ...task,
      startTime: null,
      date: null,
      isAllDay: false
    };

    setTasks(tasks.filter(t => t.id !== id));
    setUnscheduledTasks([...unscheduledTasks, unscheduledTask]);
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

  const handleEditKeyDown = (e, isInbox = false) => {
    // Handle autocomplete keyboard navigation
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        const selected = suggestions[selectedSuggestionIndex];
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
        setTasks(tasks.map(t => {
          if (t.id === editingTaskId) {
            if (suggestion.type === 'date') {
              return { ...t, title: newTitle, date: suggestion.value };
            } else {
              return { ...t, title: newTitle, startTime: suggestion.value };
            }
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
  const buildSuggestions = (text, cursorPos) => {
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

    // Check for partial date at cursor (triggered by @)
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

    // Check for partial time at cursor (triggered by ~)
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

    return allSuggestions;
  };

  // Handle suggestions for editing task input
  const handleEditInputChange = (e, isInbox = false) => {
    const value = e.target.value;
    if (!isTitleWithinLimit(value)) return;

    setEditingTaskText(value);
    editingInputRef.current = e.target;

    const cursorPos = e.target.selectionStart;
    const allSuggestions = buildSuggestions(value, cursorPos);

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
    const allSuggestions = buildSuggestions(value, cursorPos);

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
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        e.stopPropagation();
        const selected = suggestions[selectedSuggestionIndex];
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
      openInInbox: true
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
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e, targetDate = null) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

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

  const handleDropOnCalendar = (e, targetDate = null) => {
    e.preventDefault();
    if (!draggedTask) return;

    const startTime = getTimeFromCursorPosition(e, {
      maxMinutes: 24 * 60,
      taskDuration: draggedTask.duration
    });

    // Use the target date from the column, falling back to dragPreviewDate or selectedDate
    const dropDate = targetDate || dragPreviewDate || selectedDate;
    const dropDateStr = dateToString(dropDate);

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
      const { priority, ...taskWithoutPriority } = draggedTask;
      setTasks([...tasks, {
        ...taskWithoutPriority,
        startTime,
        date: dropDateStr
      }]);
    } else if (dragSource === 'calendar') {
      setTasks(tasks.map(t =>
        t.id === draggedTask.id
          ? { ...t, startTime, date: dropDateStr }
          : t
      ));
    } else if (dragSource === 'recycleBin') {
      // Remove metadata and add to calendar
      const { _deletedFrom, ...cleanTask } = draggedTask;
      setRecycleBin(recycleBin.filter(t => t.id !== draggedTask.id));
      setTasks([...tasks, {
        ...cleanTask,
        startTime,
        date: dropDateStr
      }]);
    }

    setDraggedTask(null);
    setDragSource(null);
    setDragPreviewTime(null);
    setDragPreviewDate(null);
  };

  const handleDropOnInbox = (e) => {
    e.preventDefault();
    if (!draggedTask) return;
    
    // Only allow calendar and recycle bin tasks to be moved to inbox
    if (dragSource !== 'calendar' && dragSource !== 'recycleBin') return;

    if (dragSource === 'calendar') {
      setTasks(tasks.filter(t => t.id !== draggedTask.id));
      const { startTime, date, ...taskWithoutSchedule } = draggedTask;
      setUnscheduledTasks([...unscheduledTasks, taskWithoutSchedule]);
    } else if (dragSource === 'recycleBin') {
      setRecycleBin(recycleBin.filter(t => t.id !== draggedTask.id));
      const { _deletedFrom, startTime, date, ...taskWithoutSchedule } = draggedTask;
      setUnscheduledTasks([...unscheduledTasks, taskWithoutSchedule]);
    }
    
    setDraggedTask(null);
    setDragSource(null);
    setDragPreviewTime(null);
  };

  const handleDropOnRecycleBin = (e) => {
    e.preventDefault();
    if (!draggedTask) return;

    // Add to recycle bin with metadata about where it came from
    const taskWithMeta = {
      ...draggedTask,
      _deletedFrom: dragSource === 'inbox' ? 'inbox' : 'calendar'
    };
    setRecycleBin([...recycleBin, taskWithMeta]);
    
    // Remove from original location
    if (dragSource === 'inbox') {
      setUnscheduledTasks(unscheduledTasks.filter(t => t.id !== draggedTask.id));
    } else if (dragSource === 'calendar') {
      setTasks(tasks.filter(t => t.id !== draggedTask.id));
    }
    
    setDraggedTask(null);
    setDragSource(null);
    setDragPreviewTime(null);
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
          currentEvent.summary = line.substring(8);
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

      const importedTasks = events.map(event => {
        const startDate = parseDatetime(event.dtstart);
        const endDate = event.dtend ? parseDatetime(event.dtend) : new Date(startDate.getTime() + 60 * 60 * 1000);
        const duration = Math.round((endDate - startDate) / (1000 * 60));

        const isAllDay = event.isAllDay ||
          (startDate.getHours() === 0 && startDate.getMinutes() === 0 && duration >= 1440);

        return {
          id: event.uid || `imported-${Date.now()}-${Math.random()}`,
          icalUid: event.uid,
          title: event.summary,
          startTime: `${startDate.getHours().toString().padStart(2, '0')}:${startDate.getMinutes().toString().padStart(2, '0')}`,
          duration: isAllDay ? 60 : (duration > 0 ? duration : 60),
          date: dateToString(startDate),
          color: asTaskCalendar ? 'task-calendar' : 'bg-gray-600',
          completed: asTaskCalendar ? completedTaskUids.has(event.uid) : false,
          imported: true,
          isTaskCalendar: asTaskCalendar,
          isAllDay: isAllDay
        };
      });

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

      const importedTasks = events.map(event => {
        const startDate = parseDatetime(event.dtstart);
        const endDate = event.dtend ? parseDatetime(event.dtend) : new Date(startDate.getTime() + 60 * 60 * 1000);
        const duration = Math.round((endDate - startDate) / (1000 * 60));

        // Detect all-day events: either explicitly marked, or starts at midnight and lasts 24+ hours
        const isAllDay = event.isAllDay ||
          (startDate.getHours() === 0 && startDate.getMinutes() === 0 && duration >= 1440);

        return {
          id: event.uid || `imported-${Date.now()}-${Math.random()}`,
          icalUid: event.uid,
          title: event.summary,
          startTime: `${startDate.getHours().toString().padStart(2, '0')}:${startDate.getMinutes().toString().padStart(2, '0')}`,
          duration: isAllDay ? 60 : (duration > 0 ? duration : 60),
          date: dateToString(startDate),
          color: 'bg-gray-600',
          completed: false,
          imported: true,
          isAllDay: isAllDay
        };
      });

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

      const taskCalendarItems = events.map(event => {
        const startDate = parseDatetime(event.dtstart);
        const endDate = event.dtend ? parseDatetime(event.dtend) : null;
        const duration = endDate ? Math.round((endDate - startDate) / (1000 * 60)) : 0;

        const isAllDay = event.isAllDay ||
          (startDate.getHours() === 0 && startDate.getMinutes() === 0 && duration >= 1440);

        return {
          id: event.uid || `task-cal-${Date.now()}-${Math.random()}`,
          icalUid: event.uid,
          title: event.summary,
          startTime: `${startDate.getHours().toString().padStart(2, '0')}:${startDate.getMinutes().toString().padStart(2, '0')}`,
          duration: isAllDay ? 60 : (duration > 0 ? duration : 15),
          date: dateToString(startDate),
          color: 'task-calendar',
          completed: completedTaskUids.has(event.uid),
          imported: true,
          isTaskCalendar: true,
          isAllDay: isAllDay
        };
      });

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

  // Extract all unique tags from all tasks
  const allTags = useMemo(() => {
    const tagSet = new Set();
    [...tasks, ...unscheduledTasks].forEach(task => {
      extractTags(task.title).forEach(tag => tagSet.add(tag));
    });
    return Array.from(tagSet).sort();
  }, [tasks, unscheduledTasks]);

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
  const filteredUnscheduledTasks = unscheduledTasks
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
  const todayNonImportedTasks = todayTasks.filter(t => !t.imported);
  const todayCompletedTasks = todayNonImportedTasks.filter(t => t.completed);
  const allCompletedTasks = nonImportedTasks.filter(t => t.completed);
  const totalCompletedMinutes = allCompletedTasks.reduce((sum, task) => sum + task.duration, 0);
  const totalScheduledMinutes = nonImportedTasks.reduce((sum, task) => sum + task.duration, 0);
  const todayCompletedMinutes = todayCompletedTasks.reduce((sum, task) => sum + task.duration, 0);
  const todayPlannedMinutes = todayNonImportedTasks.reduce((sum, task) => sum + task.duration, 0);

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
                    title="Add to Inbox"
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
                  <button
                    onClick={() => setSidebarCollapsed(false)}
                    className={`p-2 rounded ${hoverBg} relative`}
                    title="Inbox"
                  >
                    <Mail size={20} className={textSecondary} />
                    {unscheduledTasks.length > 0 && (
                      <span className="absolute -top-1 -right-1 bg-blue-600 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                        {unscheduledTasks.length > 9 ? '9+' : unscheduledTasks.length}
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
                    title="Add to Inbox"
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

            <div className={`${cardBg} rounded-lg shadow-sm border ${borderClass} p-4 mb-4`}>
              <div className={`flex items-center justify-between ${minimizedSections.inbox ? '' : 'mb-4'}`}>
                <h3 className={`font-semibold ${textPrimary} flex items-center gap-2`}>
                  <Mail size={18} />
                  Inbox
                  {!minimizedSections.inbox && unscheduledTasks.length > 0 && (
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
                  {unscheduledTasks.length > 0 && (
                    <span className={`text-sm ${textSecondary}`}>
                      {inboxPriorityFilter > 0 ? `${filteredUnscheduledTasks.length}/` : ''}{unscheduledTasks.length}
                    </span>
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
              
              {!minimizedSections.inbox && (
                <div
                  onDragOver={handleDragOver}
                  onDrop={handleDropOnInbox}
                  className="space-y-2"
                >
                  {filteredUnscheduledTasks.length === 0 ? (
                    <p className={`text-sm ${textSecondary} text-center py-2`}>
                      {unscheduledTasks.length === 0
                        ? "Drag tasks here to unschedule them"
                        : "No tasks match current filter"}
                    </p>
                  ) : (
                    filteredUnscheduledTasks.map(task => (
                    <div
                      key={task.id}
                      draggable
                      onDragStart={(e) => handleDragStart(task, 'inbox', e)}
                      className={`${task.color} rounded-lg p-3 cursor-move shadow-sm ${task.completed ? 'opacity-50' : ''} relative`}
                    >
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
                            <div className="text-xs opacity-90 mt-1">{task.duration} min</div>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1 flex-shrink-0">
                          <div className="flex items-start gap-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setShowColorPicker(showColorPicker === task.id ? null : task.id);
                              }}
                              className="hover:bg-white/20 rounded p-1 transition-colors relative"
                            >
                              <Palette size={14} />
                              {showColorPicker === task.id && (
                                <div className="color-picker-container absolute top-full right-0 mt-1 bg-white dark:bg-gray-800 rounded-lg p-2 z-20 shadow-xl border border-gray-200 dark:border-gray-700 min-w-[120px]">
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
                            </button>
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
                    </div>
                  ))
                )}
                </div>
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
                  <button
                    onClick={() => toggleSection('tags')}
                    className={`${textSecondary} hover:${textPrimary} transition-colors`}
                    title={minimizedSections.tags ? "Expand" : "Minimize"}
                  >
                    {minimizedSections.tags ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                  </button>
                </div>
              </div>
              {!minimizedSections.tags && (
                <div className={`text-sm ${textSecondary}`}>
                  {allTags.length === 0 ? (
                    <p className="text-center py-2">Add #tags to task titles</p>
                  ) : (
                    <div className="space-y-1">
                      {allTags.map(tag => {
                        const tagCount = [...tasks, ...unscheduledTasks].filter(t => !t.completed && extractTags(t.title).includes(tag)).length;
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
                  <div>{todayNonImportedTasks.length} tasks scheduled</div>
                  <div>{todayCompletedTasks.length} tasks completed</div>
                  <div>{Math.floor(todayCompletedMinutes / 60)}h {todayCompletedMinutes % 60}m time spent</div>
                  <div>{Math.floor(todayPlannedMinutes / 60)}h {todayPlannedMinutes % 60}m time planned</div>
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
                  <div>{nonImportedTasks.length} total tasks</div>
                  <div>{allCompletedTasks.length} completed</div>
                  <div>{Math.floor(totalCompletedMinutes / 60)}h {totalCompletedMinutes % 60}m time spent</div>
                  <div>{Math.floor(totalScheduledMinutes / 60)}h {totalScheduledMinutes % 60}m total planned</div>
                  {nonImportedTasks.length > 0 && (
                    <div className="pt-1">
                      <div className="font-semibold">{Math.round((allCompletedTasks.length / nonImportedTasks.length) * 100)}% completion rate</div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className={`${cardBg} rounded-lg shadow-sm border ${borderClass} p-4 mt-4`}>
              <div className={`flex items-center justify-between ${minimizedSections.recycleBin ? '' : 'mb-4'}`}>
                <h3 className={`font-semibold ${textPrimary} flex items-center gap-2`}>
                  <Trash2 size={18} />
                  Recycle Bin
                </h3>
                <div className="flex items-center gap-2">
                  {recycleBin.length > 0 && (
                    <span className={`text-sm ${textSecondary}`}>{recycleBin.length}</span>
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
              
              {!minimizedSections.recycleBin && (
                <>
                  <div
                    onDragOver={handleDragOver}
                    onDrop={handleDropOnRecycleBin}
                    className="space-y-2"
                  >
                    {recycleBin.length === 0 ? (
                      <p className={`text-sm ${textSecondary} text-center py-2`}>Drag tasks here to delete them</p>
                    ) : (
                      recycleBin.map(task => (
                        <div
                          key={task.id}
                          draggable
                          onDragStart={(e) => handleDragStart(task, 'recycleBin', e)}
                          className={`${task.color} rounded-lg p-3 shadow-sm opacity-50 relative cursor-move`}
                        >
                          <div className="flex items-start justify-between text-white">
                            <div className="flex items-start gap-2 flex-1 min-w-0">
                              <div className="flex-1 min-w-0">
                                <div className="font-medium truncate">{renderTitle(task.title)}</div>
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
                  return (
                    <div
                      key={dateToString(date)}
                      className={`flex-1 py-2 px-3 text-center ${idx > 0 ? `border-l ${borderClass}` : ''} ${isDateToday ? (darkMode ? 'bg-blue-900/30' : 'bg-blue-50') : cardBg}`}
                    >
                      <div className={`font-bold ${isDateToday ? 'text-blue-600' : textPrimary}`}>
                        {formatShortDate(date)}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* All-day tasks section - sticky below date headers */}
              {visibleDates.some(date => getTasksForDate(date).some(t => t.isAllDay)) && (
                <div className={`flex border-b ${borderClass} sticky top-[41px] z-20 ${cardBg}`}>
                  <div className={`w-20 flex-shrink-0 px-3 py-2 text-xs font-semibold ${textSecondary} border-r ${borderClass}`}>
                    ALL DAY
                  </div>
                  {visibleDates.map((date, idx) => {
                    const dayTasks = getTasksForDate(date).filter(t => t.isAllDay);
                    return (
                      <div
                        key={dateToString(date)}
                        className={`flex-1 p-2 space-y-1 ${idx > 0 ? `border-l ${borderClass}` : ''}`}
                      >
                        {dayTasks.map((task) => {
                          const isImported = task.imported;
                          const taskCalendarStyle = getTaskCalendarStyle(task, darkMode);
                          return (
                            <div
                              key={task.id}
                              draggable={!isImported || task.isTaskCalendar}
                              onDragStart={(e) => (!isImported || task.isTaskCalendar) && handleDragStart(task, 'calendar', e)}
                              className={`${task.isTaskCalendar ? '' : task.color} rounded-lg shadow-sm ${isImported && !task.isTaskCalendar ? 'cursor-default' : 'cursor-move'} ${task.completed && !task.isTaskCalendar ? 'opacity-50' : ''} relative`}
                              style={taskCalendarStyle}
                            >
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
                                      className={`${task.isTaskCalendar ? 'font-bold' : 'font-semibold'} text-sm truncate ${task.completed ? 'line-through' : ''}`}
                                    >
                                      {renderTitle(task.title)}
                                    </div>
                                  </div>
                                  {!isImported && (
                                    <button
                                      onClick={() => moveToRecycleBin(task.id)}
                                      className="hover:bg-white/20 rounded p-1 transition-colors flex-shrink-0"
                                      title="Move to Recycle Bin"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Main calendar grid */}
              <div ref={timeGridRef} className="relative">
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

                          // Combined layout modes
                          // Micro: very short height, or short+very narrow - single line, minimal info
                          const useMicroLayout = isMicroHeight || (isShortHeight && isVeryNarrowWidth);
                          // Compact: short height (regardless of width), or very narrow - two rows, truncated
                          const useCompactLayout = !useMicroLayout && (isShortHeight || isVeryNarrowWidth);
                          // Medium: narrow width or medium height - title wraps, has time row
                          const useMediumLayout = !useMicroLayout && !useCompactLayout && (isNarrowWidth || isMediumHeight);
                          // Full layout is the default when none of the above apply

                          // Action buttons component (reused in different layouts)
                          const ActionButtons = ({ inMenu = false }) => (
                            <>
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
                                <Inbox size={14} />
                                {inMenu && <span className="text-xs">To Inbox</span>}
                              </button>
                              <button
                                onClick={() => setShowColorPicker(showColorPicker === task.id ? null : task.id)}
                                className={`hover:bg-white/20 rounded p-1 transition-colors relative ${inMenu ? 'flex items-center gap-2 w-full' : ''}`}
                              >
                                <Palette size={14} />
                                {inMenu && <span className="text-xs">Color</span>}
                                {showColorPicker === task.id && (
                                  <div className="color-picker-container absolute top-full right-0 mt-1 bg-white dark:bg-gray-800 rounded-lg p-2 z-30 shadow-xl border border-gray-200 dark:border-gray-700 min-w-[120px]">
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
                              </button>
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
                              onDragOver={(e) => handleDragOver(e, date)}
                              onDrop={(e) => handleDropOnCalendar(e, date)}
                              className={`absolute ${task.isTaskCalendar ? '' : task.color} rounded-lg shadow-md pointer-events-auto ${isImported && !task.isTaskCalendar ? 'cursor-default' : 'cursor-move'} ${isConflicted && !task.completed ? 'ring-4 ring-red-500' : ''} ${task.completed && !task.isTaskCalendar ? 'opacity-50' : ''}`}
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
                              <div className={`${useMicroLayout ? 'px-1.5 py-1' : 'p-2'} h-full flex flex-col text-white ${useMicroLayout ? 'justify-center' : 'justify-between'} rounded-lg`}>
                                {/* IMPORTED EVENT LAYOUT: Always show time on right with truncated title */}
                                {isImported && !task.isTaskCalendar ? (
                                  <div className="flex items-center justify-between gap-2">
                                    <div
                                      className={`font-semibold ${useMicroLayout || useCompactLayout || useMediumLayout ? 'text-sm' : 'text-base'} leading-tight truncate flex-1 min-w-0`}
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
                                  /* MICRO LAYOUT: Single line - checkbox + truncated title + ... menu */
                                  <div className="flex items-center gap-1 min-w-0">
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
                                    {!isImported && (
                                      <button
                                        onClick={() => setExpandedTaskMenu(expandedTaskMenu === task.id ? null : task.id)}
                                        className="task-menu-container hover:bg-white/20 rounded p-0.5 transition-colors flex-shrink-0 relative"
                                      >
                                        <MoreHorizontal size={12} />
                                        {expandedTaskMenu === task.id && (
                                          <div className="task-menu-container absolute bottom-full right-0 mb-1 bg-white dark:bg-gray-800 rounded-lg p-1 z-30 shadow-xl border border-gray-200 dark:border-gray-700 min-w-[100px] text-gray-800 dark:text-white">
                                            <ActionButtons inMenu={true} />
                                          </div>
                                        )}
                                      </button>
                                    )}
                                  </div>
                                ) : useCompactLayout ? (
                                  /* COMPACT LAYOUT: Single row - checkbox, truncated title, ... menu */
                                  <div className="flex items-center gap-1">
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
                                    {!isImported && (
                                      <button
                                        onClick={() => setExpandedTaskMenu(expandedTaskMenu === task.id ? null : task.id)}
                                        className="task-menu-container hover:bg-white/20 rounded p-0.5 transition-colors flex-shrink-0 relative"
                                      >
                                        <MoreHorizontal size={14} />
                                        {expandedTaskMenu === task.id && (
                                          <div className="task-menu-container absolute bottom-full right-0 mb-1 bg-white dark:bg-gray-800 rounded-lg p-1 z-30 shadow-xl border border-gray-200 dark:border-gray-700 min-w-[100px] text-gray-800 dark:text-white">
                                            <ActionButtons inMenu={true} />
                                          </div>
                                        )}
                                      </button>
                                    )}
                                  </div>
                                ) : useMediumLayout ? (
                                  /* MEDIUM LAYOUT: Title can wrap (clamped), tags, time, and ... menu or compact actions */
                                  <div>
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
                                              className="w-full bg-white/20 text-white font-semibold text-base px-1 py-0.5 rounded border border-white/30 outline-none focus:bg-white/30"
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
                                    <div className="flex items-center justify-between gap-1 mt-auto">
                                      <div className="text-xs opacity-90 whitespace-nowrap flex items-center gap-1">
                                        <Clock size={10} />
                                        {task.startTime} • {task.duration}m
                                      </div>
                                      {!isImported && (
                                        <button
                                          onClick={() => setExpandedTaskMenu(expandedTaskMenu === task.id ? null : task.id)}
                                          className="task-menu-container hover:bg-white/20 rounded p-0.5 transition-colors flex-shrink-0 relative"
                                        >
                                          <MoreHorizontal size={14} />
                                          {expandedTaskMenu === task.id && (
                                            <div className="task-menu-container absolute bottom-full right-0 mb-1 bg-white dark:bg-gray-800 rounded-lg p-1 z-30 shadow-xl border border-gray-200 dark:border-gray-700 min-w-[100px] text-gray-800 dark:text-white">
                                              <ActionButtons inMenu={true} />
                                            </div>
                                          )}
                                        </button>
                                      )}
                                    </div>
                                  </div>
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
                                              className="w-full bg-white/20 text-white font-semibold text-base px-1 py-0.5 rounded border border-white/30 outline-none focus:bg-white/30"
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
                                            className={`${task.isTaskCalendar ? 'font-bold' : 'font-semibold'} text-base leading-tight ${task.completed ? 'line-through' : ''} ${!isImported ? 'cursor-text' : ''}`}
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
                              </div>
                            </div>
                          );
                        })}

                        {/* Hover preview line - shows where a new task would start */}
                        {hoverPreviewTime && !draggedTask && !isResizing && hoverPreviewDate && dateToString(hoverPreviewDate) === dateStr && (
                          <div
                            className="absolute left-0 right-0 pointer-events-none z-10"
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
                {syncNotification.type === 'success' ? 'Sync Complete' :
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowAddTask(false)}>
          <form
            className={`${cardBg} rounded-lg shadow-xl p-6 ${borderClass} border max-w-lg w-full mx-4`}
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              const addToInbox = e.nativeEvent.submitter?.dataset.inbox === 'true' || newTask.openInInbox;
              addTask(addToInbox);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setShowAddTask(false);
              } else if (e.key === 'Enter' && e.shiftKey && !newTask.openInInbox) {
                e.preventDefault();
                addTask(true);
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
                  placeholder="Task title (press Enter to add)"
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
              <div className={`grid ${newTask.openInInbox ? 'grid-cols-2' : 'grid-cols-3'} gap-3`}>
                {!newTask.openInInbox && (
                  <>
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
                  </>
                )}
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
                  <label className={`block text-sm ${textSecondary} mb-1`}>Color</label>
                  <div className="relative color-picker-container">
                    <button
                      type="button"
                      onClick={() => setShowColorPicker('newTask')}
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
                {!newTask.openInInbox && (
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
                )}
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  {newTask.openInInbox ? 'Add to Inbox' : 'Add to Schedule'}
                </button>
                {!newTask.openInInbox && (
                  <button
                    type="submit"
                    data-inbox="true"
                    className={`px-4 py-2 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} ${textPrimary} rounded-lg ${hoverBg}`}
                  >
                    Add to Inbox
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowAddTask(false)}
                  className={`px-4 py-2 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} ${textPrimary} rounded-lg ${hoverBg}`}
                >
                  Cancel
                </button>
              </div>
              <div className={`text-xs ${textSecondary} text-center`}>
                <kbd className={`px-1.5 py-0.5 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} rounded`}>Enter</kbd> add to {newTask.openInInbox ? 'inbox' : 'schedule'}
                {!newTask.openInInbox && <> • <kbd className={`px-1.5 py-0.5 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} rounded`}>Shift+Enter</kbd> add to inbox</>}
                {' '} • <kbd className={`px-1.5 py-0.5 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} rounded`}>Esc</kbd> cancel
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default DayPlanner;