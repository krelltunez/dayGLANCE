import React, { useState, useEffect, useRef } from 'react';
import { Plus, Clock, X, GripVertical, ChevronLeft, ChevronRight, Moon, Sun, Upload, Inbox, AlertCircle, Calendar, Check, RefreshCw, Palette, CalendarPlus } from 'lucide-react';

const DayPlanner = () => {
  const [darkMode, setDarkMode] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    return today;
  });
  const [tasks, setTasks] = useState([]);
  const [unscheduledTasks, setUnscheduledTasks] = useState([]);
  const [showAddTask, setShowAddTask] = useState(false);
  const [newTask, setNewTask] = useState({ title: '', startTime: '09:00', duration: 30 });
  const [draggedTask, setDraggedTask] = useState(null);
  const [dragSource, setDragSource] = useState(null);
  const [conflicts, setConflicts] = useState([]);
  const [ignoredConflicts, setIgnoredConflicts] = useState([]);
  const [showSyncSettings, setShowSyncSettings] = useState(false);
  const [syncUrl, setSyncUrl] = useState('');
  const [currentTime, setCurrentTime] = useState(new Date());
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [weather, setWeather] = useState(null);
  const [dragPreviewTime, setDragPreviewTime] = useState(null);
  const calendarRef = useRef(null);
  const currentTimeRef = useRef(null);

  const hours = Array.from({ length: 17 }, (_, i) => i + 7);
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
  const durationOptions = Array.from({ length: 9 }, (_, i) => (i + 1) * 15); // 15 to 120 minutes

  useEffect(() => {
    loadData();
    fetchWeather(); // FIX 1: Call fetchWeather on mount
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const isToday = dateToString(selectedDate) === dateToString(new Date());
    if (isToday && currentTimeRef.current) {
      setTimeout(() => {
        currentTimeRef.current.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'center' 
        });
      }, 100);
    }
  }, [selectedDate]);

  useEffect(() => {
    saveData();
    checkConflicts();
  }, [tasks, unscheduledTasks]);

  const loadData = () => {
    try {
      const tasksData = localStorage.getItem('day-planner-tasks');
      const unscheduledData = localStorage.getItem('day-planner-unscheduled');
      const darkModeData = localStorage.getItem('day-planner-darkmode');
      const syncUrlData = localStorage.getItem('day-planner-sync-url');
      
      if (tasksData) {
        setTasks(JSON.parse(tasksData));
      }
      if (unscheduledData) {
        setUnscheduledTasks(JSON.parse(unscheduledData));
      }
      if (darkModeData) {
        setDarkMode(JSON.parse(darkModeData));
      }
      if (syncUrlData) {
        setSyncUrl(JSON.parse(syncUrlData));
      }
    } catch (error) {
      console.log('No existing data found, starting fresh');
    }
  };

  const saveData = () => {
    try {
      localStorage.setItem('day-planner-tasks', JSON.stringify(tasks));
      localStorage.setItem('day-planner-unscheduled', JSON.stringify(unscheduledTasks));
      localStorage.setItem('day-planner-darkmode', JSON.stringify(darkMode));
      localStorage.setItem('day-planner-sync-url', JSON.stringify(syncUrl));
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
      // Denver coordinates: 39.7392, -104.9903
      const response = await fetch('https://api.open-meteo.com/v1/forecast?latitude=39.7392&longitude=-104.9903&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&timezone=America%2FDenver&forecast_days=1');
      const data = await response.json();
      
      if (data.current && data.daily) {
        setWeather({
          temp: Math.round(data.current.temperature_2m),
          condition: getWeatherCondition(data.current.weather_code),
          icon: getWeatherIcon(data.current.weather_code),
          high: Math.round(data.daily.temperature_2m_max[0]),
          low: Math.round(data.daily.temperature_2m_min[0])
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
        low: '--'
      });
    }
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
    if (code === 0) return '☀️';
    if ([1, 2].includes(code)) return '⛅';
    if (code === 3) return '☁️';
    if ([45, 48].includes(code)) return '🌫️';
    if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return '🌧️';
    if ([71, 73, 75, 77, 85, 86].includes(code)) return '🌨️';
    if ([95, 96, 99].includes(code)) return '⛈️';
    return '☁️';
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
    return date.toISOString().split('T')[0];
  };

  const checkConflicts = () => {
    const dateStr = dateToString(selectedDate);
    const todayTasks = tasks.filter(t => t.date === dateStr && !t.isAllDay); // Exclude all-day tasks
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
            const conflictKey = [task1.id, task2.id].sort().join('-');
            // Only add if not ignored
            if (!ignoredConflicts.includes(conflictKey)) {
              newConflicts.push([task1.id, task2.id, Math.min(start1, start2)]); // Include conflict time
            }
          }
        }
      }
    }
    setConflicts(newConflicts);
  };

  const ignoreConflict = (conflict) => {
    const conflictKey = [conflict[0], conflict[1]].sort().join('-');
    setIgnoredConflicts([...ignoredConflicts, conflictKey]);
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

  const calculateConflictPosition = (task, allTasks) => {
    const conflicting = getConflictingTasks(task, allTasks);
    if (conflicting.length === 0) return { left: 2, right: 2, width: null };
    
    const allConflicted = [task, ...conflicting].sort((a, b) => a.id - b.id);
    const index = allConflicted.findIndex(t => t.id === task.id);
    const total = allConflicted.length;
    
    const widthPercent = 100 / total;
    const leftPercent = widthPercent * index;
    
    return {
      left: `${leftPercent}%`,
      right: 'auto',
      width: `${widthPercent - 1}%`
    };
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
        setUnscheduledTasks([...unscheduledTasks, task]);
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
      setTasks(tasks.map(task => 
        task.id === id ? { ...task, completed: !task.completed } : task
      ));
    }
  };

  const deleteTask = (id, fromInbox = false) => {
    if (fromInbox) {
      setUnscheduledTasks(unscheduledTasks.filter(task => task.id !== id));
    } else {
      setTasks(tasks.filter(task => task.id !== id));
    }
  };

  const formatDate = (date) => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}`;
  };

  const changeDate = (days) => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() + days);
    newDate.setHours(12, 0, 0, 0); // Maintain noon to avoid timezone issues
    setSelectedDate(newDate);
  };

  const goToToday = () => {
    const today = new Date();
    today.setHours(12, 0, 0, 0); // Set to noon to avoid timezone issues
    setSelectedDate(today);
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

  const openNewTaskAtTime = (e) => {
    // Only trigger if clicking on the empty calendar area, not on tasks
    if (e.target.classList.contains('calendar-slot')) {
      const rect = calendarRef.current.getBoundingClientRect();
      const scrollTop = calendarRef.current.scrollTop;
      const y = e.clientY - rect.top + scrollTop;
      
      const totalMinutesFromTop = (y / 80) * 60;
      const hours = Math.floor(totalMinutesFromTop / 60) + 7;
      const minutes = Math.round((totalMinutesFromTop % 60) / 15) * 15;
      const totalMinutes = Math.max(7 * 60, Math.min(23 * 60 - 60, hours * 60 + minutes));
      const clickedTime = minutesToTime(totalMinutes);
      
      setNewTask({ 
        title: '', 
        startTime: clickedTime, 
        duration: 30,
        date: dateToString(selectedDate),
        isAllDay: false
      });
      setShowAddTask(true);
    }
  };

  const calculateTaskPosition = (task) => {
    const startMinutes = timeToMinutes(task.startTime);
    const startHour = Math.floor(startMinutes / 60);
    const minutesIntoHour = startMinutes % 60;
    const top = (startHour - 7) * 80 + (minutesIntoHour / 60) * 80;
    const height = (task.duration / 60) * 80;
    return { top, height };
  };

  const handleDragStart = (task, source, e) => {
    setDraggedTask(task);
    setDragSource(source);
    setDragPreviewTime(null);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    
    // Show preview time while dragging
    if (draggedTask && e.currentTarget === calendarRef.current) {
      const rect = e.currentTarget.getBoundingClientRect();
      const scrollTop = e.currentTarget.scrollTop;
      const y = e.clientY - rect.top + scrollTop;
      const totalMinutesFromTop = (y / 80) * 60;
      const hours = Math.floor(totalMinutesFromTop / 60) + 7;
      const minutes = Math.round((totalMinutesFromTop % 60) / 15) * 15;
      const totalMinutes = Math.max(7 * 60, Math.min(23 * 60 - draggedTask.duration, hours * 60 + minutes));
      setDragPreviewTime(minutesToTime(totalMinutes));
    }
  };

  const handleDropOnCalendar = (e) => {
    e.preventDefault();
    if (!draggedTask) return;

    const calendarElement = e.currentTarget;
    const rect = calendarElement.getBoundingClientRect();
    
    // Get the scroll position of the calendar container
    const scrollTop = calendarElement.scrollTop;
    
    // Calculate position relative to the top of the scrollable content
    const y = e.clientY - rect.top + scrollTop;
    
    // Calculate the time based on pixel position
    const totalMinutesFromTop = (y / 80) * 60;
    const hours = Math.floor(totalMinutesFromTop / 60) + 7; // Add 7 for 7 AM offset
    const minutes = Math.round((totalMinutesFromTop % 60) / 15) * 15; // Round to 15 min
    
    // Ensure time is within bounds
    const totalMinutes = Math.max(7 * 60, Math.min(23 * 60 - draggedTask.duration, hours * 60 + minutes));
    const startTime = minutesToTime(totalMinutes);

    if (dragSource === 'inbox') {
      setUnscheduledTasks(unscheduledTasks.filter(t => t.id !== draggedTask.id));
      setTasks([...tasks, {
        ...draggedTask,
        startTime,
        date: dateToString(selectedDate)
      }]);
    } else if (dragSource === 'calendar') {
      setTasks(tasks.map(t => 
        t.id === draggedTask.id 
          ? { ...t, startTime, date: dateToString(selectedDate) }
          : t
      ));
    }

    setDraggedTask(null);
    setDragSource(null);
    setDragPreviewTime(null);
  };

  const handleDropOnInbox = (e) => {
    e.preventDefault();
    if (!draggedTask || dragSource !== 'calendar') return;

    setTasks(tasks.filter(t => t.id !== draggedTask.id));
    const { startTime, date, ...taskWithoutSchedule } = draggedTask;
    setUnscheduledTasks([...unscheduledTasks, taskWithoutSchedule]);
    
    setDraggedTask(null);
    setDragSource(null);
    setDragPreviewTime(null);
  };

  const handleResizeStart = (task, e) => {
    e.stopPropagation();
    e.preventDefault();
    
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
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const parseICS = (icsContent) => {
    const lines = icsContent.split('\n').map(line => line.trim());
    const events = [];
    let currentEvent = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      if (line === 'BEGIN:VEVENT') {
        currentEvent = {};
      } else if (line === 'END:VEVENT' && currentEvent) {
        if (currentEvent.summary && currentEvent.dtstart) {
          events.push(currentEvent);
        }
        currentEvent = null;
      } else if (currentEvent) {
        if (line.startsWith('SUMMARY:')) {
          currentEvent.summary = line.substring(8);
        } else if (line.startsWith('DTSTART')) {
          const dateStr = line.split(':')[1];
          currentEvent.dtstart = dateStr;
        } else if (line.startsWith('DTEND')) {
          const dateStr = line.split(':')[1];
          currentEvent.dtend = dateStr;
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

    const reader = new FileReader();
    reader.onload = (event) => {
      const icsContent = event.target.result;
      const events = parseICS(icsContent);
      
      const importedTasks = events.map(event => {
        const startDate = parseDatetime(event.dtstart);
        const endDate = event.dtend ? parseDatetime(event.dtend) : new Date(startDate.getTime() + 60 * 60 * 1000);
        const duration = Math.round((endDate - startDate) / (1000 * 60));

        return {
          id: Date.now() + Math.random(),
          title: event.summary,
          startTime: `${startDate.getHours().toString().padStart(2, '0')}:${startDate.getMinutes().toString().padStart(2, '0')}`,
          duration: duration > 0 ? duration : 60,
          date: dateToString(startDate),
          color: colors[Math.floor(Math.random() * colors.length)],
          completed: false
        };
      });

      setTasks([...tasks, ...importedTasks]);
      e.target.value = '';
    };
    reader.readAsText(file);
  };

  const syncWithCalendar = async () => {
    if (!syncUrl) {
      alert('Please enter a calendar URL in sync settings');
      return;
    }

    try {
      const response = await fetch(syncUrl);
      if (!response.ok) throw new Error('Failed to fetch calendar');
      
      const icsContent = await response.text();
      const events = parseICS(icsContent);
      
      const importedTasks = events.map(event => {
        const startDate = parseDatetime(event.dtstart);
        const endDate = event.dtend ? parseDatetime(event.dtend) : new Date(startDate.getTime() + 60 * 60 * 1000);
        const duration = Math.round((endDate - startDate) / (1000 * 60));

        return {
          id: Date.now() + Math.random(),
          title: event.summary,
          startTime: `${startDate.getHours().toString().padStart(2, '0')}:${startDate.getMinutes().toString().padStart(2, '0')}`,
          duration: duration > 0 ? duration : 60,
          date: dateToString(startDate),
          color: colors[Math.floor(Math.random() * colors.length)],
          completed: false
        };
      });

      setTasks([...tasks, ...importedTasks]);
      alert(`Synced ${importedTasks.length} events from calendar`);
    } catch (error) {
      alert('Failed to sync with calendar. Make sure the URL is correct and publicly accessible.');
      console.error('Sync error:', error);
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
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
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
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
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
  const hasConflicts = conflicts.length > 0;

  // Calculate all-time stats
  const allCompletedTasks = tasks.filter(t => t.completed);
  const totalCompletedMinutes = allCompletedTasks.reduce((sum, task) => sum + task.duration, 0);
  const totalScheduledMinutes = tasks.reduce((sum, task) => sum + task.duration, 0);

  const isToday = dateToString(selectedDate) === dateToString(new Date());
  const currentTimeMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();
  const currentTimeTop = ((currentTime.getHours() - 7) * 80) + ((currentTime.getMinutes() / 60) * 80);
  const showCurrentTimeLine = isToday && currentTime.getHours() >= 7 && currentTime.getHours() < 23;

  const bgClass = darkMode ? 'bg-gray-900' : 'bg-gray-50';
  const cardBg = darkMode ? 'bg-gray-800' : 'bg-white';
  const borderClass = darkMode ? 'border-gray-700' : 'border-gray-200';
  const textPrimary = darkMode ? 'text-gray-100' : 'text-gray-900';
  const textSecondary = darkMode ? 'text-gray-400' : 'text-gray-600';
  const hoverBg = darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100';

  return (
    <div className={`min-h-screen ${bgClass}`}>
      <div className={`${cardBg} border-b ${borderClass} px-6 py-4`}>
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className={`text-2xl font-bold ${textPrimary}`}>&nbsp;&nbsp;Here's what your day looks like!</h1>
            <div className="flex items-center gap-6 mt-2">
              <div className="flex items-center gap-2">
                <button onClick={() => changeDate(-1)} className={`p-1 rounded ${hoverBg}`}>
                  <ChevronLeft size={20} className={textSecondary} />
                </button>
                <span className={`${textPrimary} font-bold text-xl min-w-[220px] text-center`}>{formatDate(selectedDate)}</span>
                <button onClick={() => changeDate(1)} className={`p-1 rounded ${hoverBg}`}>
                  <ChevronRight size={20} className={textSecondary} />
                </button>
              </div>
              <button
                onClick={goToToday}
                className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Today
              </button>
              {weather && (
                <div className={`flex items-center gap-3 px-4 py-2 ${darkMode ? 'bg-gray-700' : 'bg-gray-100'} rounded-lg`}>
                  <div className="text-2xl">{weather.icon}</div>
                  <div>
                    <div className={`text-lg font-bold ${textPrimary}`}>{weather.temp}°F</div>
                    <div className={`text-xs ${textSecondary}`}>H: {weather.high}° L: {weather.low}°</div>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowSyncSettings(!showSyncSettings)}
              className={`px-3 py-2 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} rounded-lg ${hoverBg} flex items-center gap-2`}
            >
              <RefreshCw size={18} className={textSecondary} />
              <span className={`text-sm ${textPrimary}`}>Sync</span>
            </button>
            <label className={`cursor-pointer px-3 py-2 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} rounded-lg ${hoverBg} flex items-center gap-2`}>
              <Upload size={18} className={textSecondary} />
              <span className={`text-sm ${textPrimary}`}>Import iCal</span>
              <input type="file" accept=".ics" onChange={handleFileUpload} className="hidden" />
            </label>
            <button
              onClick={() => setDarkMode(!darkMode)}
              className={`p-2 rounded-lg ${hoverBg}`}
            >
              {darkMode ? <Sun size={20} className={textSecondary} /> : <Moon size={20} className={textSecondary} />}
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6">
        {showSyncSettings && (
          <div className={`${cardBg} rounded-lg shadow-sm border ${borderClass} p-4 mb-6`}>
            <h3 className={`font-semibold ${textPrimary} mb-4`}>Calendar Sync Settings</h3>
            <div className="space-y-3">
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
              <div className="flex gap-2">
                <button
                  onClick={syncWithCalendar}
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

        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-3">
            <div className={`flex gap-2 mb-4`}>
              <button
                onClick={openNewTaskForm}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                title="New Scheduled Task"
              >
                <CalendarPlus size={18} />
                <span className="font-medium">Schedule</span>
              </button>
              <button
                onClick={openNewInboxTask}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                title="Add to Inbox"
              >
                <Plus size={18} />
                <span className="font-medium">Inbox</span>
              </button>
            </div>

            <div className={`${cardBg} rounded-lg shadow-sm border ${borderClass} p-4 mb-4`}>
              <div className="flex items-center justify-between mb-4">
                <h3 className={`font-semibold ${textPrimary} flex items-center gap-2`}>
                  <Inbox size={18} />
                  Inbox
                </h3>
                <span className={`text-sm ${textSecondary}`}>{unscheduledTasks.length}</span>
              </div>
              
              <div
                onDragOver={handleDragOver}
                onDrop={handleDropOnInbox}
                className={`space-y-2 ${unscheduledTasks.length === 0 ? 'min-h-[100px] flex items-center justify-center' : ''}`}
              >
                {unscheduledTasks.length === 0 ? (
                  <p className={`text-sm ${textSecondary} text-center`}>Drag tasks here to unschedule them</p>
                ) : (
                  unscheduledTasks.map(task => (
                    <div
                      key={task.id}
                      draggable
                      onDragStart={() => handleDragStart(task, 'inbox')}
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
                            <div className={`font-medium text-sm ${task.completed ? 'line-through' : ''}`}>{task.title}</div>
                            <div className="text-xs opacity-90 mt-1">{task.duration} min</div>
                          </div>
                        </div>
                        <div className="flex items-start gap-1 flex-shrink-0">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowColorPicker(showColorPicker === task.id ? null : task.id);
                            }}
                            className="hover:bg-white/20 rounded p-1 transition-colors relative"
                          >
                            <Palette size={14} />
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
                          </button>
                          <button
                            onClick={() => deleteTask(task.id, true)}
                            className="hover:bg-white/20 rounded p-1"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {hasConflicts && (
              <div className={`${cardBg} rounded-lg shadow-sm border border-orange-500 p-4 mt-4`}>
                <div className="flex items-start gap-2 text-orange-600">
                  <AlertCircle size={18} className="mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <div className="font-semibold text-sm mb-2">Time Conflicts</div>
                    <div className="space-y-2">
                      {conflicts.map((conflict, index) => (
                        <div key={index} className="flex items-center justify-between text-xs">
                          <span>Conflict at {minutesToTime(conflict[2])}</span>
                          <button
                            onClick={() => ignoreConflict(conflict)}
                            className="px-2 py-1 bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-200 rounded hover:bg-orange-200 dark:hover:bg-orange-800 transition-colors"
                          >
                            Ignore
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className={`${cardBg} rounded-lg shadow-sm border ${borderClass} p-4 mt-4`}>
              <h3 className={`font-semibold ${textPrimary} mb-2`}>Today's Summary</h3>
              <div className={`text-sm ${textSecondary} space-y-1`}>
                <div>{todayTasks.length} tasks scheduled</div>
                <div>{todayTasks.reduce((sum, task) => sum + task.duration, 0)} minutes planned</div>
                <div>{unscheduledTasks.length} tasks in inbox</div>
              </div>
            </div>

            <div className={`${cardBg} rounded-lg shadow-sm border ${borderClass} p-4 mt-4`}>
              <h3 className={`font-semibold ${textPrimary} mb-3`}>All Time Summary</h3>
              <div className={`text-sm ${textSecondary} space-y-2`}>
                <div className="flex justify-between">
                  <span>Total tasks:</span>
                  <span className={textPrimary}>{tasks.length}</span>
                </div>
                <div className="flex justify-between">
                  <span>Completed:</span>
                  <span className={textPrimary}>{allCompletedTasks.length}</span>
                </div>
                <div className="flex justify-between">
                  <span>Time spent:</span>
                  <span className={textPrimary}>{Math.floor(totalCompletedMinutes / 60)}h {totalCompletedMinutes % 60}m</span>
                </div>
                <div className="flex justify-between">
                  <span>Total planned:</span>
                  <span className={textPrimary}>{Math.floor(totalScheduledMinutes / 60)}h {totalScheduledMinutes % 60}m</span>
                </div>
                {tasks.length > 0 && (
                  <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
                    <div className="flex justify-between font-semibold">
                      <span>Completion:</span>
                      <span className={textPrimary}>{Math.round((allCompletedTasks.length / tasks.length) * 100)}%</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="col-span-9">
            {showAddTask && (
              <div className={`${cardBg} rounded-lg shadow-sm border ${borderClass} p-4 mb-6`}>
                <h3 className={`font-semibold ${textPrimary} mb-4`}>New Task</h3>
                <div className="space-y-3">
                  <input
                    type="text"
                    placeholder="Task title"
                    value={newTask.title}
                    onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                    className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'}`}
                  />
                  <div className="grid grid-cols-6 gap-3">
                    {!newTask.openInInbox && (
                      <>
                        <div>
                          <label className={`block text-sm ${textSecondary} mb-1`}>Date</label>
                          <button
                            onClick={() => setShowDatePicker(true)}
                            className={`w-full px-3 py-2 border ${borderClass} rounded-lg text-left text-sm ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'}`}
                          >
                            {newTask.date ? new Date(newTask.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Select'}
                          </button>
                        </div>
                        <div>
                          <label className={`block text-sm ${textSecondary} mb-1`}>Time</label>
                          <button
                            onClick={() => !newTask.isAllDay && setShowTimePicker(true)}
                            disabled={newTask.isAllDay}
                            className={`w-full px-3 py-2 border ${borderClass} rounded-lg text-left ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'} ${newTask.isAllDay ? 'opacity-50 cursor-not-allowed' : ''}`}
                          >
                            {newTask.isAllDay ? 'All Day' : newTask.startTime}
                          </button>
                        </div>
                      </>
                    )}
                    <div className={newTask.openInInbox ? 'col-span-3' : ''}>
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
                    <div className={newTask.openInInbox ? 'col-span-3' : ''}>
                      <label className={`block text-sm ${textSecondary} mb-1`}>Color</label>
                      <div className="relative">
                        <button
                          onClick={() => setShowColorPicker('newTask')}
                          className={`w-full h-10 ${newTask.color || colors[0].class} rounded-lg border ${borderClass}`}
                        />
                        {showColorPicker === 'newTask' && (
                          <div className={`absolute top-12 left-0 ${cardBg} rounded-lg p-2 shadow-xl z-20 border ${borderClass} min-w-[120px]`}>
                            <div className="grid grid-cols-3 gap-1">
                              {colors.map((color) => (
                                <button
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
                      <div className="col-span-2">
                        <label className={`block text-sm ${textSecondary} mb-1`}>All Day Event</label>
                        <label className="flex items-center h-10 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={newTask.isAllDay}
                            onChange={(e) => setNewTask({ ...newTask, isAllDay: e.target.checked })}
                            className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                          />
                          <span className={`ml-2 text-sm ${textPrimary}`}>Full day reminder</span>
                        </label>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => addTask(newTask.openInInbox || false)}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                      {newTask.openInInbox ? 'Add to Inbox' : 'Add to Schedule'}
                    </button>
                    {!newTask.openInInbox && (
                      <button
                        onClick={() => addTask(true)}
                        className={`px-4 py-2 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} ${textPrimary} rounded-lg ${hoverBg}`}
                      >
                        Add to Inbox
                      </button>
                    )}
                    <button
                      onClick={() => setShowAddTask(false)}
                      className={`px-4 py-2 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} ${textPrimary} rounded-lg ${hoverBg}`}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className={`${cardBg} rounded-lg shadow-sm border ${borderClass} overflow-hidden`}>
              {/* FIX 3: All-day tasks section at the top */}
              {todayTasks.filter(t => t.isAllDay).length > 0 && (
                <div className={`border-b ${borderClass} p-2 ${cardBg}`}>
                  <div className={`text-xs font-semibold ${textSecondary} mb-2 px-2`}>ALL DAY</div>
                  <div className="space-y-2">
                    {todayTasks.filter(t => t.isAllDay).map((task) => (
                      <div
                        key={task.id}
                        draggable
                        onDragStart={(e) => handleDragStart(task, 'calendar', e)}
                        className={`${task.color} rounded-lg shadow-sm cursor-move ${task.completed ? 'opacity-50' : ''} relative`}
                      >
                        <div className="p-2 text-white">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              <button
                                onClick={() => toggleComplete(task.id)}
                                className={`rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center hover:bg-white/30 transition-colors`}
                              >
                                {task.completed && <Check size={10} strokeWidth={3} />}
                              </button>
                              <Calendar size={14} className="flex-shrink-0" />
                              <div className={`font-semibold text-sm truncate ${task.completed ? 'line-through' : ''}`}>
                                {task.title}
                              </div>
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <button
                                onClick={() => setShowColorPicker(showColorPicker === task.id ? null : task.id)}
                                className="hover:bg-white/20 rounded p-1 transition-colors relative"
                              >
                                <Palette size={14} />
                                {showColorPicker === task.id && (
                                  <div className="absolute top-full right-0 mt-1 bg-white dark:bg-gray-800 rounded-lg p-2 z-20 shadow-xl border border-gray-200 dark:border-gray-700 min-w-[120px]">
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
                                onClick={() => deleteTask(task.id)}
                                className="hover:bg-white/20 rounded p-1 transition-colors"
                              >
                                <X size={14} />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div
                ref={calendarRef}
                onDragOver={handleDragOver}
                onDrop={handleDropOnCalendar}
                onClick={openNewTaskAtTime}
                className="relative overflow-y-auto"
                style={{ maxHeight: 'calc(100vh - 300px)' }}
              >
                {hours.map((hour) => (
                  <div key={hour} className={`flex border-b ${borderClass}`}>
                    <div className={`w-20 flex-shrink-0 py-2 px-3 text-sm ${textSecondary} border-r ${borderClass}`}>
                      {hour.toString().padStart(2, '0')}:00
                    </div>
                    <div className="flex-1 relative h-20 calendar-slot"></div>
                  </div>
                ))}

                <div className="absolute top-0 left-20 right-0 bottom-0 pointer-events-none">
                  {showCurrentTimeLine && (
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

                  {todayTasks.filter(t => !t.isAllDay).map((task) => {
                    const { top, height } = calculateTaskPosition(task);
                    const isConflicted = conflicts.some(c => c.includes(task.id));
                    const conflictPos = calculateConflictPosition(task, todayTasks);
                    const isVeryShort = height < 20;
                    
                    return (
                      <div
                        key={task.id}
                        draggable
                        onDragStart={(e) => handleDragStart(task, 'calendar', e)}
                        className={`absolute ${task.color} rounded-lg shadow-md pointer-events-auto cursor-move ${isConflicted ? 'ring-2 ring-orange-500' : ''} ${task.completed ? 'opacity-50' : ''} overflow-visible`}
                        style={{ 
                          top: `${top}px`, 
                          height: `${height}px`, 
                          minHeight: '40px',
                          left: conflictPos.left,
                          right: conflictPos.right,
                          width: conflictPos.width
                        }}
                      >
                        <div className={`p-2 h-full flex flex-col text-white ${isVeryShort ? 'justify-center' : 'justify-between'}`}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-start gap-2 flex-1 min-w-0">
                              <button
                                onClick={() => toggleComplete(task.id)}
                                className={`mt-0.5 rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center hover:bg-white/30 transition-colors`}
                              >
                                {task.completed && <Check size={10} strokeWidth={3} />}
                              </button>
                              <div className="flex-1 min-w-0">
                                <div className={`font-semibold text-base leading-tight ${task.completed ? 'line-through' : ''}`}>
                                  {task.title}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-start gap-1 flex-shrink-0">
                              <div className="text-xs opacity-90 whitespace-nowrap mr-1 mt-0.5 flex items-center gap-1">
                                <Clock size={12} />
                                {task.startTime} • {task.duration}min
                              </div>
                              <button
                                onClick={() => setShowColorPicker(showColorPicker === task.id ? null : task.id)}
                                className="hover:bg-white/20 rounded p-1 transition-colors relative"
                              >
                                <Palette size={14} />
                                {showColorPicker === task.id && (
                                  <div className="absolute top-full right-0 mt-1 bg-white dark:bg-gray-800 rounded-lg p-2 z-20 shadow-xl border border-gray-200 dark:border-gray-700 min-w-[120px]">
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
                                onClick={() => deleteTask(task.id)}
                                className="hover:bg-white/20 rounded p-1 transition-colors"
                              >
                                <X size={14} />
                              </button>
                            </div>
                          </div>
                          {/* Resize handle at bottom - solid white for visibility */}
                          {!isVeryShort && (
                            <div
                              onMouseDown={(e) => handleResizeStart(task, e)}
                              className="absolute bottom-0 left-0 right-0 h-3 cursor-ns-resize hover:bg-white/20 flex items-center justify-center"
                              style={{ marginBottom: '-4px' }}
                            >
                              <div className="w-8 h-1 bg-white rounded-full"></div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  
                  {/* Drag preview - FIX 4: Lower z-index so time indicator is visible */}
                  {dragPreviewTime && draggedTask && (
                    <div className="absolute left-2 right-2 bg-blue-500/30 border-2 border-blue-500 border-dashed rounded-lg flex items-center justify-center text-white font-bold text-lg pointer-events-none z-5"
                      style={{
                        top: `${((timeToMinutes(dragPreviewTime) - 7 * 60) / 60) * 80}px`,
                        height: `${(draggedTask.duration / 60) * 80}px`,
                        minHeight: '40px'
                      }}
                    >
                      {dragPreviewTime}
                    </div>
                  )}
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
    </div>
  );
};

export default DayPlanner;