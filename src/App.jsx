import React, { useState, useEffect, useRef } from 'react';
import { Plus, Clock, X, GripVertical, ChevronLeft, ChevronRight, Moon, Sun, Upload, Inbox, AlertCircle, Calendar, Check, RefreshCw } from 'lucide-react';

const DayPlanner = () => {
  const [darkMode, setDarkMode] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [tasks, setTasks] = useState([]);
  const [unscheduledTasks, setUnscheduledTasks] = useState([]);
  const [showAddTask, setShowAddTask] = useState(false);
  const [newTask, setNewTask] = useState({ title: '', startTime: '09:00', duration: 60 });
  const [draggedTask, setDraggedTask] = useState(null);
  const [dragSource, setDragSource] = useState(null);
  const [conflicts, setConflicts] = useState([]);
  const [showSyncSettings, setShowSyncSettings] = useState(false);
  const [syncUrl, setSyncUrl] = useState('');
  const [currentTime, setCurrentTime] = useState(new Date());
  const calendarRef = useRef(null);
  const currentTimeRef = useRef(null);

  const hours = Array.from({ length: 17 }, (_, i) => i + 7);
  const colors = ['bg-blue-500', 'bg-purple-500', 'bg-green-500', 'bg-orange-500', 'bg-pink-500', 'bg-indigo-500'];

  useEffect(() => {
    loadData();
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

  const loadData = async () => {
    try {
      const tasksResult = await window.storage.get('day-planner-tasks');
      const unscheduledResult = await window.storage.get('day-planner-unscheduled');
      const darkModeResult = await window.storage.get('day-planner-darkmode');
      const syncUrlResult = await window.storage.get('day-planner-sync-url');
      
      if (tasksResult?.value) {
        setTasks(JSON.parse(tasksResult.value));
      }
      if (unscheduledResult?.value) {
        setUnscheduledTasks(JSON.parse(unscheduledResult.value));
      }
      if (darkModeResult?.value) {
        setDarkMode(JSON.parse(darkModeResult.value));
      }
      if (syncUrlResult?.value) {
        setSyncUrl(JSON.parse(syncUrlResult.value));
      }
    } catch (error) {
      console.log('No existing data found, starting fresh');
    }
  };

  const saveData = async () => {
    try {
      await window.storage.set('day-planner-tasks', JSON.stringify(tasks));
      await window.storage.set('day-planner-unscheduled', JSON.stringify(unscheduledTasks));
      await window.storage.set('day-planner-darkmode', JSON.stringify(darkMode));
      await window.storage.set('day-planner-sync-url', JSON.stringify(syncUrl));
    } catch (error) {
      console.error('Error saving data:', error);
    }
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
    const todayTasks = tasks.filter(t => t.date === dateStr);
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
            newConflicts.push([task1.id, task2.id]);
          }
        }
      }
    }
    setConflicts(newConflicts);
  };

  const addTask = (toInbox = false) => {
    if (newTask.title.trim()) {
      const task = {
        id: Date.now(),
        title: newTask.title,
        duration: newTask.duration,
        color: colors[Math.floor(Math.random() * colors.length)],
        completed: false
      };

      if (toInbox) {
        setUnscheduledTasks([...unscheduledTasks, task]);
      } else {
        setTasks([...tasks, {
          ...task,
          startTime: newTask.startTime,
          date: dateToString(selectedDate)
        }]);
      }
      
      setNewTask({ title: '', startTime: '09:00', duration: 60 });
      setShowAddTask(false);
    }
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
    setSelectedDate(newDate);
  };

  const goToToday = () => {
    setSelectedDate(new Date());
  };

  const calculateTaskPosition = (task) => {
    const startMinutes = timeToMinutes(task.startTime);
    const startHour = Math.floor(startMinutes / 60);
    const minutesIntoHour = startMinutes % 60;
    const top = (startHour - 7) * 80 + (minutesIntoHour / 60) * 80;
    const height = (task.duration / 60) * 80;
    return { top, height };
  };

  const handleDragStart = (task, source) => {
    setDraggedTask(task);
    setDragSource(source);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDropOnCalendar = (e) => {
    e.preventDefault();
    if (!draggedTask) return;

    const rect = calendarRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top + window.scrollY;
    const clickedHour = Math.floor(y / 80) + 7;
    const pixelsIntoHour = y % 80;
    const minutesIntoHour = Math.round((pixelsIntoHour / 80) * 60 / 15) * 15;
    const totalMinutes = clickedHour * 60 + minutesIntoHour;
    const startTime = minutesToTime(Math.max(0, Math.min(1440 - draggedTask.duration, totalMinutes)));

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
  };

  const handleDropOnInbox = (e) => {
    e.preventDefault();
    if (!draggedTask || dragSource !== 'calendar') return;

    setTasks(tasks.filter(t => t.id !== draggedTask.id));
    const { startTime, date, ...taskWithoutSchedule } = draggedTask;
    setUnscheduledTasks([...unscheduledTasks, taskWithoutSchedule]);
    
    setDraggedTask(null);
    setDragSource(null);
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

  const todayTasks = tasks.filter(t => t.date === dateToString(selectedDate));
  const hasConflicts = conflicts.length > 0;

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
            <h1 className={`text-2xl font-bold ${textPrimary}`}>Day Planner</h1>
            <div className="flex items-center gap-4 mt-2">
              <div className="flex items-center gap-2">
                <button onClick={() => changeDate(-1)} className={`p-1 rounded ${hoverBg}`}>
                  <ChevronLeft size={20} className={textSecondary} />
                </button>
                <span className={`${textSecondary} min-w-[200px] text-center`}>{formatDate(selectedDate)}</span>
                <button onClick={() => changeDate(1)} className={`p-1 rounded ${hoverBg}`}>
                  <ChevronRight size={20} className={textSecondary} />
                </button>
              </div>
              <button
                onClick={goToToday}
                className={`px-3 py-1 text-sm ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} ${textPrimary} rounded ${hoverBg}`}
              >
                Today
              </button>
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
            <div className={`${cardBg} rounded-lg shadow-sm border ${borderClass} p-4`}>
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
                className={`min-h-[200px] space-y-2 ${unscheduledTasks.length === 0 ? 'flex items-center justify-center' : ''}`}
              >
                {unscheduledTasks.length === 0 ? (
                  <p className={`text-sm ${textSecondary} text-center`}>Drag tasks here to unschedule them</p>
                ) : (
                  unscheduledTasks.map(task => (
                    <div
                      key={task.id}
                      draggable
                      onDragStart={() => handleDragStart(task, 'inbox')}
                      className={`${task.color} rounded-lg p-3 cursor-move shadow-sm ${task.completed ? 'opacity-50' : ''}`}
                    >
                      <div className="flex items-start justify-between text-white">
                        <div className="flex items-start gap-2 flex-1">
                          <button
                            onClick={() => toggleComplete(task.id, true)}
                            className={`mt-0.5 rounded ${task.completed ? 'bg-white/30' : 'bg-white/10'} p-0.5 hover:bg-white/40 transition-colors`}
                          >
                            {task.completed && <Check size={14} />}
                            {!task.completed && <div className="w-3.5 h-3.5"></div>}
                          </button>
                          <GripVertical size={16} className="mt-0.5 opacity-70" />
                          <div className="flex-1">
                            <div className={`font-medium text-sm ${task.completed ? 'line-through' : ''}`}>{task.title}</div>
                            <div className="text-xs opacity-90 mt-1">{task.duration} min</div>
                          </div>
                        </div>
                        <button
                          onClick={() => deleteTask(task.id, true)}
                          className="hover:bg-white/20 rounded p-1"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <button
                onClick={() => setShowAddTask(!showAddTask)}
                className="w-full mt-4 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                <Plus size={18} />
                New Task
              </button>
            </div>

            {hasConflicts && (
              <div className={`${cardBg} rounded-lg shadow-sm border border-orange-500 p-4 mt-4`}>
                <div className="flex items-start gap-2 text-orange-600">
                  <AlertCircle size={18} className="mt-0.5" />
                  <div>
                    <div className="font-semibold text-sm">Time Conflicts</div>
                    <div className="text-xs mt-1">You have {conflicts.length} overlapping task{conflicts.length > 1 ? 's' : ''}</div>
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
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className={`block text-sm ${textSecondary} mb-1`}>Start Time</label>
                      <input
                        type="time"
                        value={newTask.startTime}
                        onChange={(e) => setNewTask({ ...newTask, startTime: e.target.value })}
                        className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'}`}
                      />
                    </div>
                    <div>
                      <label className={`block text-sm ${textSecondary} mb-1`}>Duration (min)</label>
                      <input
                        type="number"
                        value={newTask.duration}
                        onChange={(e) => setNewTask({ ...newTask, duration: parseInt(e.target.value) || 0 })}
                        className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'}`}
                        min="15"
                        step="15"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => addTask(false)}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                      Add to Schedule
                    </button>
                    <button
                      onClick={() => addTask(true)}
                      className={`px-4 py-2 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} ${textPrimary} rounded-lg ${hoverBg}`}
                    >
                      Add to Inbox
                    </button>
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
              <div
                ref={calendarRef}
                onDragOver={handleDragOver}
                onDrop={handleDropOnCalendar}
                className="relative overflow-y-auto max-h-[calc(100vh-300px)]"
              >
                {hours.map((hour) => (
                  <div key={hour} className={`flex border-b ${borderClass}`}>
                    <div className={`w-20 flex-shrink-0 py-2 px-3 text-sm ${textSecondary} border-r ${borderClass}`}>
                      {hour.toString().padStart(2, '0')}:00
                    </div>
                    <div className="flex-1 relative h-20"></div>
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

                  {todayTasks.map((task) => {
                    const { top, height } = calculateTaskPosition(task);
                    const isConflicted = conflicts.some(c => c.includes(task.id));
                    return (
                      <div
                        key={task.id}
                        draggable
                        onDragStart={() => handleDragStart(task, 'calendar')}
                        className={`absolute left-2 right-2 ${task.color} rounded-lg shadow-md pointer-events-auto cursor-move ${isConflicted ? 'ring-2 ring-orange-500' : ''} ${task.completed ? 'opacity-50' : ''}`}
                        style={{ top: `${top}px`, height: `${height}px`, minHeight: '40px' }}
                      >
                        <div className="p-3 h-full flex flex-col justify-between text-white">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-start gap-2 flex-1 min-w-0">
                              <button
                                onClick={() => toggleComplete(task.id)}
                                className={`mt-0.5 rounded flex-shrink-0 ${task.completed ? 'bg-white/30' : 'bg-white/10'} p-0.5 hover:bg-white/40 transition-colors`}
                              >
                                {task.completed && <Check size={14} />}
                                {!task.completed && <div className="w-3.5 h-3.5"></div>}
                              </button>
                              <GripVertical size={16} className="flex-shrink-0 mt-0.5 opacity-70" />
                              <div className="flex-1 min-w-0">
                                <div className={`font-semibold truncate ${task.completed ? 'line-through' : ''}`}>{task.title}</div>
                                <div className="text-xs opacity-90 flex items-center gap-1 mt-1">
                                  <Clock size={12} />
                                  {task.startTime} • {task.duration}min
                                </div>
                              </div>
                            </div>
                            <button
                              onClick={() => deleteTask(task.id)}
                              className="flex-shrink-0 hover:bg-white/20 rounded p-1 transition-colors"
                            >
                              <X size={16} />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DayPlanner;
